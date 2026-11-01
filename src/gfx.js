// The screen: a grid of terminal cells, each cell a block of pixels (2x4 block octants, 2x3 sextants, or 1x2 half blocks).
// A Canvas holds the pixels and, above them, characters for real text. Draw order is painter's: later draws cover earlier ones.
// A Renderer turns a Canvas into the terminal's escape codes, sending only the cells that changed since the last frame.

import { OCTANTS, SEXTANTS } from './glyphs.js';
import { R, G, B, rgb, clamp } from './util.js';

export const MODES = {
  octant: { pw: 2, ph: 4, table: OCTANTS, label: 'Octants (2x4)' },
  sextant: { pw: 2, ph: 3, table: SEXTANTS, label: 'Sextants (2x3)' },
  half: { pw: 1, ph: 2, table: null, label: 'Half blocks (1x2)' },
};

export class Canvas {
  constructor(cols, rows, mode = 'octant') {
    this.setMode(mode);
    this.resize(cols, rows);
  }
  setMode(mode) {
    this.mode = MODES[mode] ? mode : 'octant';
    this.pw = MODES[this.mode].pw;
    this.ph = MODES[this.mode].ph;
  }
  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.W = cols * this.pw;
    this.H = rows * this.ph;
    this.pix = new Uint32Array(this.W * this.H);
    const n = cols * rows;
    this.tch = new Array(n).fill('');
    this.tfg = new Int32Array(n);
    this.tbg = new Int32Array(n).fill(-1);
  }
  fill(c) {
    this.pix.fill(c);
    this.tch.fill('');
  }
  px(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.pix[y * this.W + x] = c;
  }
  get(x, y) {
    return x >= 0 && y >= 0 && x < this.W && y < this.H ? this.pix[y * this.W + x] : 0;
  }
  pxRect(x, y, w, h, c) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.W, x + w);
    const y1 = Math.min(this.H, y + h);
    for (let yy = y0; yy < y1; yy++) {
      const o = yy * this.W;
      for (let xx = x0; xx < x1; xx++) this.pix[o + xx] = c;
    }
  }
  // Mix colour c into the pixels there, alpha 0..1 (translucent panels, shadows).
  blendRect(x, y, w, h, c, a) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.W, x + w);
    const y1 = Math.min(this.H, y + h);
    const cr = R(c);
    const cg = G(c);
    const cb = B(c);
    const ia = 1 - a;
    for (let yy = y0; yy < y1; yy++) {
      const o = yy * this.W;
      for (let xx = x0; xx < x1; xx++) {
        const p = this.pix[o + xx];
        this.pix[o + xx] = rgb(R(p) * ia + cr * a, G(p) * ia + cg * a, B(p) * ia + cb * a);
      }
    }
  }
  // A cell-aligned filled rectangle: fills the pixels and removes any text underneath.
  cellFill(cx, cy, cw, ch, c) {
    this.pxRect(cx * this.pw, cy * this.ph, cw * this.pw, ch * this.ph, c);
    this.clearText(cx, cy, cw, ch);
  }
  clearText(cx, cy, cw, ch) {
    const x0 = Math.max(0, cx);
    const y0 = Math.max(0, cy);
    const x1 = Math.min(this.cols, cx + cw);
    const y1 = Math.min(this.rows, cy + ch);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.tch[y * this.cols + x] = '';
  }
  // Text, one cell per character. bg -1 keeps whatever the pixels under it look like.
  text(cx, cy, s, fg, bg = -1) {
    if (cy < 0 || cy >= this.rows) return;
    let x = cx;
    for (const ch of s) {
      if (x >= this.cols) break;
      if (x >= 0) {
        const i = cy * this.cols + x;
        this.tch[i] = ch;
        this.tfg[i] = fg;
        this.tbg[i] = bg;
      }
      x++;
    }
  }
  // The pixels in a pixel rectangle, to put back later (rounded corners).
  grab(x, y, w, h) {
    const out = [];
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out.push(this.get(x + xx, y + yy));
    return out;
  }
}

// --- turning pixels into a character and two colours ---

const sq = (a, b) => {
  const dr = R(a) - R(b);
  const dg = G(a) - G(b);
  const db = B(a) - B(b);
  return dr * dr + dg * dg + db * db;
};
const luma = (c) => R(c) * 0.299 + G(c) * 0.587 + B(c) * 0.114;
const scratch = new Array(8);

// For the pixels of one cell: [character, foreground, background].
function cellFor(cv, cx, cy, out) {
  const { pw, ph, W, pix } = cv;
  const base = cy * ph * W + cx * pw;
  const n = pw * ph;
  let i = 0;
  for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) scratch[i++] = pix[base + yy * W + xx];
  let same = true;
  for (let k = 1; k < n; k++) if (scratch[k] !== scratch[0]) same = false;
  if (same) {
    out[0] = ' ';
    out[1] = scratch[0];
    out[2] = scratch[0];
    return;
  }
  if (cv.mode === 'half') {
    out[0] = '▀';
    out[1] = scratch[0];
    out[2] = scratch[1];
    return;
  }
  // two colours: split the pixels around the darkest and lightest, then settle once on the averages
  let lo = 0;
  let hi = 0;
  for (let k = 1; k < n; k++) {
    if (luma(scratch[k]) < luma(scratch[lo])) lo = k;
    if (luma(scratch[k]) > luma(scratch[hi])) hi = k;
  }
  let cLo = scratch[lo];
  let cHi = scratch[hi];
  let bits = 0;
  for (let pass = 0; pass < 2; pass++) {
    bits = 0;
    let rl = 0, gl = 0, bl = 0, nl = 0, rh = 0, gh = 0, bh = 0, nh = 0;
    for (let k = 0; k < n; k++) {
      const c = scratch[k];
      if (sq(c, cHi) < sq(c, cLo)) {
        bits |= 1 << k;
        rh += R(c); gh += G(c); bh += B(c); nh++;
      } else {
        rl += R(c); gl += G(c); bl += B(c); nl++;
      }
    }
    if (nh) cHi = rgb(rh / nh, gh / nh, bh / nh);
    if (nl) cLo = rgb(rl / nl, gl / nl, bl / nl);
  }
  const full = (1 << n) - 1;
  if (bits === 0 || bits === full || sq(cLo, cHi) < 500) {
    // one colour, or two so close (a soft gradient) that a pattern would only be noise
    out[0] = ' ';
    out[1] = out[2] = bits === 0 ? cLo : bits === full ? cHi : mixTwo(cLo, cHi, bits, n);
    return;
  }
  out[0] = MODES[cv.mode].table[bits];
  out[1] = cHi;
  out[2] = cLo;
}

function mixTwo(a, b, bits, n) {
  let on = 0;
  for (let k = 0; k < n; k++) if (bits & (1 << k)) on++;
  const t = on / n;
  return rgb(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t);
}

// 256-colour fallback for terminals without 24-bit colour.
function to256(c) {
  const r = R(c), g = G(c), b = B(c);
  const q = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const cr = q(r), cg = q(g), cb = q(b);
  const cube = 16 + 36 * cr + 6 * cg + cb;
  const lv = [0, 95, 135, 175, 215, 255];
  const cd = sq(c, rgb(lv[cr], lv[cg], lv[cb]));
  const gray = clamp(Math.round((((r + g + b) / 3) - 8) / 10), 0, 23);
  const gv = 8 + gray * 10;
  return sq(c, rgb(gv, gv, gv)) < cd ? 232 + gray : cube;
}

export class Renderer {
  constructor({ truecolor = true } = {}) {
    this.truecolor = truecolor;
    this.prev = null;
    this.out = ['', 0, 0];
  }
  invalidate() {
    this.prev = null;
  }
  fg(c) {
    return this.truecolor ? `\x1b[38;2;${R(c)};${G(c)};${B(c)}m` : `\x1b[38;5;${to256(c)}m`;
  }
  bg(c) {
    return this.truecolor ? `\x1b[48;2;${R(c)};${G(c)};${B(c)}m` : `\x1b[48;5;${to256(c)}m`;
  }
  // The escape codes that bring the terminal from the last frame to this one ('' when nothing changed).
  flush(cv) {
    const n = cv.cols * cv.rows;
    let first = false;
    if (!this.prev || this.prev.cols !== cv.cols || this.prev.rows !== cv.rows) {
      this.prev = { cols: cv.cols, rows: cv.rows, ch: new Array(n).fill(null), fg: new Int32Array(n).fill(-2), bg: new Int32Array(n).fill(-2) };
      first = true;
    }
    const { ch: pch, fg: pfg, bg: pbg } = this.prev;
    const out = this.out;
    let s = first ? '\x1b[0m\x1b[2J' : '';
    let curFg = -2;
    let curBg = -2;
    let nextX = -1;
    let nextY = -1;
    for (let cy = 0; cy < cv.rows; cy++) {
      for (let cx = 0; cx < cv.cols; cx++) {
        const i = cy * cv.cols + cx;
        let ch, fg, bg;
        if (cv.tch[i]) {
          ch = cv.tch[i];
          fg = cv.tfg[i];
          if (cv.tbg[i] >= 0) bg = cv.tbg[i];
          else {
            cellFor(cv, cx, cy, out);
            bg = out[2] === out[1] || out[0] === ' ' ? out[2] : mixAvg(cv, cx, cy);
          }
        } else {
          cellFor(cv, cx, cy, out);
          ch = out[0];
          fg = out[1];
          bg = out[2];
        }
        if (ch === ' ') fg = bg;
        if (pch[i] === ch && pbg[i] === bg && (ch === ' ' || pfg[i] === fg)) continue;
        pch[i] = ch;
        pfg[i] = ch === ' ' ? -3 : fg;
        pbg[i] = bg;
        if (nextX !== cx || nextY !== cy) s += `\x1b[${cy + 1};${cx + 1}H`;
        if (curBg !== bg) {
          s += this.bg(bg);
          curBg = bg;
        }
        if (ch !== ' ' && curFg !== fg) {
          s += this.fg(fg);
          curFg = fg;
        }
        s += ch;
        nextX = cx + 1;
        nextY = cy;
      }
    }
    return s;
  }
}

function mixAvg(cv, cx, cy) {
  const { pw, ph, W, pix } = cv;
  const base = cy * ph * W + cx * pw;
  let r = 0, g = 0, b = 0;
  for (let yy = 0; yy < ph; yy++) {
    for (let xx = 0; xx < pw; xx++) {
      const c = pix[base + yy * W + xx];
      r += R(c); g += G(c); b += B(c);
    }
  }
  const n = pw * ph;
  return rgb(r / n, g / n, b / n);
}

// Only the real text of a canvas, with a space wherever there are just pixels (to see the layout in tests).
export function textLayer(cv) {
  const rows = [];
  for (let cy = 0; cy < cv.rows; cy++) {
    let line = '';
    for (let cx = 0; cx < cv.cols; cx++) line += cv.tch[cy * cv.cols + cx] || ' ';
    rows.push(line.replace(/\s+$/, ''));
  }
  return rows.join('\n');
}

// Plain text of a canvas (tests and --snapshot): the characters as the terminal would show them, without colour.
export function plainText(cv) {
  const out = [];
  const t = [];
  for (let cy = 0; cy < cv.rows; cy++) {
    let line = '';
    for (let cx = 0; cx < cv.cols; cx++) {
      const i = cy * cv.cols + cx;
      if (cv.tch[i]) line += cv.tch[i];
      else {
        cellFor(cv, cx, cy, t);
        line += t[0];
      }
    }
    out.push(line);
  }
  return out.join('\n');
}
