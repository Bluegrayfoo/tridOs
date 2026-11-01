// The screen. Everything, text included, is drawn into one pixel buffer; a Renderer then turns the pixels into block characters
// (2x4 octants, 2x3 sextants or 1x2 half blocks per terminal cell), sending only what changed. Because the text is drawn in pixels
// from a built-in font, it stays readable however small the terminal's own font is.
//
// Two grids:   terminal cells (tcols x trows), each tpw x tph pixels      - what the terminal shows
//              logical cells  (cols x rows),   each pw x ph pixels         - what apps lay out in: one character of text each
// A logical cell is 6x10 pixels times the text scale.

import { OCTANTS, SEXTANTS } from './glyphs.js';
import { glyph } from './font.js';
import { R, G, B, rgb, clamp } from './util.js';

export const MODES = {
  octant: { pw: 2, ph: 4, table: OCTANTS, label: 'Octants (2x4)' },
  sextant: { pw: 2, ph: 3, table: SEXTANTS, label: 'Sextants (2x3)' },
  half: { pw: 1, ph: 2, table: null, label: 'Half blocks (1x2)' },
};
export const CELL_W = 6;
export const CELL_H = 10;

export class Canvas {
  constructor(tcols, trows, mode = 'octant', scale = 1) {
    this.mode = MODES[mode] ? mode : 'octant';
    this.scale = scale;
    this.resize(tcols, trows);
  }
  setMode(mode) {
    this.mode = MODES[mode] ? mode : 'octant';
  }
  setScale(s) {
    this.scale = clamp(Math.round(s) || 1, 1, 4);
  }
  // Allocate for a terminal of tcols x trows cells with the current mode and scale.
  resize(tcols, trows) {
    this.tcols = tcols;
    this.trows = trows;
    this.tpw = MODES[this.mode].pw;
    this.tph = MODES[this.mode].ph;
    this.W = tcols * this.tpw;
    this.H = trows * this.tph;
    this.pw = CELL_W * this.scale;
    this.ph = CELL_H * this.scale;
    this.cols = Math.max(1, Math.floor(this.W / this.pw));
    this.rows = Math.max(1, Math.floor(this.H / this.ph));
    this.pix = new Uint32Array(this.W * this.H);
    const n = this.cols * this.rows;
    // what text is where (a record for tests; the pixels are the real thing)
    this.tch = new Array(n).fill('');
    this.tfg = new Int32Array(n);
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
    const cr = R(c) * a;
    const cg = G(c) * a;
    const cb = B(c) * a;
    const ia = 1 - a;
    for (let yy = y0; yy < y1; yy++) {
      const o = yy * this.W;
      for (let xx = x0; xx < x1; xx++) {
        const p = this.pix[o + xx];
        this.pix[o + xx] = (((R(p) * ia + cr) & 255) << 16) | (((G(p) * ia + cg) & 255) << 8) | ((B(p) * ia + cb) & 255);
      }
    }
  }
  disc(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.px(x, y, c);
  }
  // A cell-aligned filled rectangle (logical cells); also forgets any recorded text there.
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
  // Text, one logical cell per character, drawn from the pixel font. bg -1 leaves the pixels behind it alone.
  text(cx, cy, str, fg, bg = -1) {
    if (cy < 0 || cy >= this.rows) return;
    let x = cx;
    for (const ch of str) {
      if (x >= this.cols) break;
      if (x >= 0) {
        const i = cy * this.cols + x;
        this.tch[i] = ch;
        this.tfg[i] = fg;
        if (bg >= 0) this.pxRect(x * this.pw, cy * this.ph, this.pw, this.ph, bg);
        if (ch !== ' ') this.glyph(ch, x * this.pw, cy * this.ph, fg);
      }
      x++;
    }
  }
  glyph(ch, x0, y0, fg) {
    const s = this.scale;
    const g = glyph(ch);
    if (g === 'mid') return this.pxRect(x0, y0 + 5 * s, this.pw, s, fg);
    if (g === 'top') return this.pxRect(x0, y0, this.pw, s, fg);
    const { W, H, pix } = this;
    for (let col = 0; col < 5; col++) {
      const bits = g[col];
      if (!bits) continue;
      for (let row = 0; row < 8; row++) {
        if (!(bits & (1 << row))) continue;
        const px = x0 + col * s;
        const py = y0 + (row + 1) * s;
        for (let yy = 0; yy < s; yy++) {
          const y = py + yy;
          if (y < 0 || y >= H) continue;
          for (let xx = 0; xx < s; xx++) {
            const x = px + xx;
            if (x >= 0 && x < W) pix[y * W + x] = fg;
          }
        }
      }
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

function mixTwo(a, b, bits, n) {
  let on = 0;
  for (let k = 0; k < n; k++) if (bits & (1 << k)) on++;
  const t = on / n;
  return rgb(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t);
}

// For the pixels of one terminal cell: [character, foreground, background].
function cellFor(cv, tx, ty, out) {
  const { tpw, tph, W, pix } = cv;
  const base = ty * tph * W + tx * tpw;
  const n = tpw * tph;
  let i = 0;
  for (let yy = 0; yy < tph; yy++) for (let xx = 0; xx < tpw; xx++) scratch[i++] = pix[base + yy * W + xx];
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
    const n = cv.tcols * cv.trows;
    let first = false;
    if (!this.prev || this.prev.tcols !== cv.tcols || this.prev.trows !== cv.trows || this.prev.pix.length !== cv.pix.length) {
      this.prev = { tcols: cv.tcols, trows: cv.trows, ch: new Array(n).fill(null), fg: new Int32Array(n).fill(-2), bg: new Int32Array(n).fill(-2), pix: new Uint32Array(cv.pix.length).fill(0xffffffff) };
      first = true;
    }
    const { ch: pch, fg: pfg, bg: pbg, pix: pp } = this.prev;
    const { tpw, tph, W, pix } = cv;
    const out = this.out;
    let s = first ? '\x1b[0m\x1b[2J' : '';
    let curFg = -2;
    let curBg = -2;
    let nextX = -1;
    let nextY = -1;
    for (let ty = 0; ty < cv.trows; ty++) {
      for (let tx = 0; tx < cv.tcols; tx++) {
        // skip cells whose pixels are the same as last frame (the common case)
        const base = ty * tph * W + tx * tpw;
        let same = true;
        for (let yy = 0; yy < tph && same; yy++) {
          const o = base + yy * W;
          for (let xx = 0; xx < tpw; xx++) {
            if (pix[o + xx] !== pp[o + xx]) {
              same = false;
              break;
            }
          }
        }
        if (same) continue;
        for (let yy = 0; yy < tph; yy++) {
          const o = base + yy * W;
          for (let xx = 0; xx < tpw; xx++) pp[o + xx] = pix[o + xx];
        }
        const i = ty * cv.tcols + tx;
        cellFor(cv, tx, ty, out);
        const ch = out[0];
        let fg = out[1];
        const bg = out[2];
        if (ch === ' ') fg = bg;
        if (pch[i] === ch && pbg[i] === bg && (ch === ' ' || pfg[i] === fg)) continue;
        pch[i] = ch;
        pfg[i] = ch === ' ' ? -3 : fg;
        pbg[i] = bg;
        if (nextX !== tx || nextY !== ty) s += `\x1b[${ty + 1};${tx + 1}H`;
        if (curBg !== bg) {
          s += this.bg(bg);
          curBg = bg;
        }
        if (ch !== ' ' && curFg !== fg) {
          s += this.fg(fg);
          curFg = fg;
        }
        s += ch;
        nextX = tx + 1;
        nextY = ty;
      }
    }
    return s;
  }
}

// Only the real text of a canvas, with a space wherever there is none (to see the layout in tests).
export function textLayer(cv) {
  const rows = [];
  for (let cy = 0; cy < cv.rows; cy++) {
    let line = '';
    for (let cx = 0; cx < cv.cols; cx++) line += cv.tch[cy * cv.cols + cx] || ' ';
    rows.push(line.replace(/\s+$/, ''));
  }
  return rows.join('\n');
}

// What the terminal would show, without colour (one character per terminal cell).
export function plainText(cv) {
  const out = [];
  const t = [];
  for (let ty = 0; ty < cv.trows; ty++) {
    let line = '';
    for (let tx = 0; tx < cv.tcols; tx++) {
      cellFor(cv, tx, ty, t);
      line += t[0];
    }
    out.push(line);
  }
  return out.join('\n');
}
