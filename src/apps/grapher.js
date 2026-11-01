// Grapher: plot equations, like Desmos. Lines can be  y = sin(x),  f(x) = x^2,  a = 2,  x = 3  or just  x^2 - 1.
// Drawn in pixels (block octants), so curves are smooth to the pixel.

import { Hits, LineInput } from '../ui.js';
import { clamp, fit, len, mix } from '../util.js';

const COLORS = [0xff453a, 0x0a84ff, 0x30d158, 0xbf5af2, 0xff9f0a, 0x40c8e0, 0xff375f, 0xe6c000];
const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign, sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x), cbrt: Math.cbrt, fract: (x) => x - Math.floor(x),
  max: Math.max, min: Math.min, atan2: Math.atan2, mod: (a, b) => ((a % b) + b) % b, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

// ---- the expression language: compiles text to a function of a scope { x, vars, funcs } ----

function tokenize(src) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_π][A-Za-z_0-9]*)|(.))/gy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) toks.push({ t: 'n', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: 'i', v: m[2] === 'π' ? 'pi' : m[2] });
    else if (m[3] !== undefined) toks.push({ t: 'o', v: m[3] });
    else break;
  }
  return toks;
}

export function compile(src, knownFuncs = {}) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p] && toks[p].t === 'o' && toks[p].v === v;
  const fail = (m) => {
    throw new Error(m);
  };
  function expr() {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      const b = term();
      const l = a;
      a = op === '+' ? (s) => l(s) + b(s) : (s) => l(s) - b(s);
    }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('·')) {
        const op = toks[p++].v;
        const b = unary();
        const l = a;
        a = op === '/' ? (s) => l(s) / b(s) : (s) => l(s) * b(s);
      } else if (peek() && (peek().t === 'n' || peek().t === 'i' || isOp('('))) {
        // implicit multiplication: 2x, 3(x+1), x(x-1), (x+1)(x-1)
        const b = unary();
        const l = a;
        a = (s) => l(s) * b(s);
      } else return a;
    }
  }
  function unary() {
    if (isOp('-')) {
      p++;
      const a = unary();
      return (s) => -a(s);
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp('^')) {
      p++;
      const ex = unary();
      return (s) => Math.pow(base(s), ex(s));
    }
    return base;
  }
  function primary() {
    const t = toks[p];
    if (!t) fail('The expression ends too soon');
    if (t.t === 'n') {
      p++;
      const v = t.v;
      return () => v;
    }
    if (t.t === 'i') {
      p++;
      const name = t.v;
      if (isOp('(') && (FUNCS[name] || knownFuncs[name])) {
        p++;
        const args = [];
        if (!isOp(')')) {
          args.push(expr());
          while (isOp(',')) {
            p++;
            args.push(expr());
          }
        }
        if (!isOp(')')) fail('Missing )');
        p++;
        if (FUNCS[name]) {
          const f = FUNCS[name];
          return args.length === 1 ? (s) => f(args[0](s)) : (s) => f(...args.map((a) => a(s)));
        }
        return (s) => {
          const fn = s.funcs[name];
          return fn ? fn(args[0](s), s) : NaN;
        };
      }
      if (name === 'x') return (s) => s.x;
      if (name in CONSTS) return () => CONSTS[name];
      if (knownFuncs[name] || FUNCS[name]) fail(`${name} needs (…)`);
      return (s) => (name in s.vars ? s.vars[name] : NaN);
    }
    if (t.v === '(') {
      p++;
      const a = expr();
      if (!isOp(')')) fail('Missing )');
      p++;
      return a;
    }
    if (t.v === '|') {
      p++;
      const a = expr();
      if (!isOp('|')) fail('Missing |');
      p++;
      return (s) => Math.abs(a(s));
    }
    return fail(`Unexpected "${t.v}"`);
  }
  if (!toks.length) fail('Empty');
  const f = expr();
  if (p < toks.length) fail(`Unexpected "${toks[p].v}"`);
  return f;
}

// Work out what each line means.
function analyse(lines) {
  const funcs = {};
  const defs = lines.map((raw) => {
    const m = /^\s*([A-Za-z])\s*\(\s*x\s*\)\s*=(.+)$/.exec(raw);
    return m && m[1] !== 'x' ? m[1] : null;
  });
  const known = {};
  defs.forEach((d) => d && (known[d] = true));
  const vars = {};
  const out = lines.map((raw, i) => {
    const r = { raw, kind: 'blank', error: null, fn: null };
    const text = raw.trim();
    if (!text) return r;
    try {
      let m;
      if ((m = /^([A-Za-z])\s*\(\s*x\s*\)\s*=(.+)$/.exec(text)) && m[1] !== 'x') {
        const f = compile(m[2], known);
        funcs[m[1]] = (x, s) => f({ x, vars: s.vars, funcs: s.funcs });
        r.kind = 'func';
      } else if ((m = /^y\s*=(.+)$/.exec(text))) {
        r.kind = 'curve';
        r.fn = compile(m[1], known);
      } else if ((m = /^x\s*=(.+)$/.exec(text))) {
        r.kind = 'vline';
        r.fn = compile(m[1], known);
      } else if ((m = /^([A-Za-z])\s*=(.+)$/.exec(text)) && m[1] !== 'x' && m[1] !== 'y') {
        r.kind = 'var';
        r.name = m[1];
        r.fn = compile(m[2], known);
      } else {
        r.kind = 'curve';
        r.fn = compile(text, known);
      }
    } catch (e) {
      r.kind = 'error';
      r.error = e.message;
    }
    return r;
  });
  // variables, evaluated in order (later lines may use earlier ones)
  const scope = { x: 0, vars, funcs };
  for (const r of out) if (r.kind === 'var') vars[r.name] = r.fn(scope);
  return { lines: out, scope };
}

const niceStep = (raw) => {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
};
const fmt = (n) => {
  if (Math.abs(n) < 1e-12) return '0';
  const s = Math.abs(n) >= 1e5 || Math.abs(n) < 1e-3 ? n.toExponential(1) : String(parseFloat(n.toPrecision(6)));
  return s;
};

class Grapher {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.exprs = data?.exprs?.length ? data.exprs.slice(0, 12) : ['y = sin(x)', 'y = x^2 / 4 - 2', 'a = 1.5', 'y = a x'];
    this.cx = data?.cx ?? 0;
    this.cy = data?.cy ?? 0;
    this.scale = data?.scale ?? 0; // units per pixel; 0 = pick from the window size
    this.active = 0;
    this.focus = 'list';
    this.input = new LineInput(this.exprs[0]);
    this.hits = new Hits();
    this.drag = null;
    this.geom = { gx: 0, gw: 0 };
    this.parsed = analyse(this.exprs);
  }
  save() {
    return { exprs: this.exprs, cx: this.cx, cy: this.cy, scale: this.scale };
  }
  title() {
    return 'Grapher';
  }
  commit() {
    this.exprs[this.active] = this.input.text;
    this.parsed = analyse(this.exprs);
    this.os.stateDirty = true;
  }
  select(i) {
    this.commit();
    this.active = clamp(i, 0, this.exprs.length - 1);
    this.input.set(this.exprs[this.active]);
    this.focus = 'list';
  }
  menus() {
    return [
      {
        title: 'Graph',
        items: [
          { label: 'Add Expression', fn: () => this.add() },
          { label: 'Delete Expression', fn: () => this.del() },
          { sep: true },
          { label: 'Zoom In', fn: () => this.zoom(0.8) },
          { label: 'Zoom Out', fn: () => this.zoom(1.25) },
          { label: 'Reset View', fn: () => ((this.cx = 0), (this.cy = 0), (this.scale = 0)) },
        ],
      },
    ];
  }
  add() {
    this.commit();
    this.exprs.splice(this.active + 1, 0, '');
    this.active++;
    this.input.set('');
    this.focus = 'list';
    this.parsed = analyse(this.exprs);
  }
  del() {
    if (this.exprs.length <= 1) {
      this.exprs[0] = '';
      this.input.set('');
    } else {
      this.exprs.splice(this.active, 1);
      this.active = Math.min(this.active, this.exprs.length - 1);
      this.input.set(this.exprs[this.active]);
    }
    this.parsed = analyse(this.exprs);
  }
  zoom(f, px = null, py = null, W = 0, H = 0) {
    const s = this.scale || 20 / Math.max(1, this.geom.W || 100);
    const ns = clamp(s * f, 1e-6, 1e6);
    if (px != null) {
      // keep the point under the pointer where it is
      this.cx += (px - W / 2) * (s - ns);
      this.cy -= (py - H / 2) * (s - ns);
    }
    this.scale = ns;
    this.os.stateDirty = true;
  }
  draw(v, focused) {
    const th = this.os.th;
    this.hits.reset();
    const pw = Math.min(36, Math.max(24, Math.floor(v.w * 0.36)));
    // --- expression list ---
    v.rect(0, 0, pw, v.h, th.side);
    v.text(1, 0, ' Expressions ', th.dim);
    const perRow = 2;
    const rows = Math.max(1, Math.floor((v.h - 3) / perRow));
    const first = clamp(this.active - rows + 1, 0, Math.max(0, this.exprs.length - rows));
    this.exprs.slice(first, first + rows).forEach((raw, k) => {
      const i = first + k;
      const y = 1 + k * perRow;
      const on = i === this.active;
      const r = this.parsed.lines[i];
      if (on) v.rect(0, y, pw, perRow, this.focus === 'list' ? mix(th.side, th.accent, 0.2) : mix(th.side, th.accent, 0.1));
      const color = r.kind === 'error' ? th.danger : COLORS[i % COLORS.length];
      v.text(1, y, r.kind === 'curve' || r.kind === 'vline' ? '●' : r.kind === 'var' || r.kind === 'func' ? '◆' : r.kind === 'error' ? '!' : '○', color);
      v.text(3, y, String(i + 1), th.dim);
      if (on) this.input.draw(v, 5, y, pw - 6, th, { focus: focused && this.focus === 'list', bg: mix(th.field, th.accent, 0.12) });
      else v.text(5, y, fit(raw, pw - 6), th.text);
      if (r.error) v.text(5, y + 1, fit(r.error, pw - 6), th.danger);
      else if (r.kind === 'var') v.text(5, y + 1, fit(`= ${fmt(this.parsed.scope.vars[r.name])}`, pw - 6), th.dim);
      this.hits.add(0, y, pw, perRow, () => this.select(i));
    });
    v.text(1, v.h - 2, '＋ Enter: new line', th.dim);
    v.text(1, v.h - 1, 'Tab: graph  ±: zoom', th.dim);
    // --- the graph ---
    const gx = pw;
    const gw = v.w - pw;
    const g = v.sub(gx, 0, gw, v.h);
    this.geom = { gx, gw, W: g.pxW, H: g.pxH };
    const W = g.pxW;
    const H = g.pxH;
    const s = this.scale || 20 / W;
    const toPx = (x) => W / 2 + (x - this.cx) / s;
    const toPy = (y) => H / 2 - (y - this.cy) / s;
    g.fill(th.field);
    const dim = (c, t) => mix(th.field, c, t);
    const line = dim(th.dark ? 0xffffff : 0x000000, 0.1);
    const major = dim(th.dark ? 0xffffff : 0x000000, 0.22);
    const axis = dim(th.dark ? 0xffffff : 0x000000, 0.7);
    const step = niceStep(s * 64);
    const minor = step / 5;
    const x0 = this.cx - (W / 2) * s;
    const x1 = this.cx + (W / 2) * s;
    const y0 = this.cy - (H / 2) * s;
    const y1 = this.cy + (H / 2) * s;
    if (minor / s >= 6) {
      for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) g.pxRect(Math.round(toPx(x)), 0, 1, H, line);
      for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) g.pxRect(0, Math.round(toPy(y)), W, 1, line);
    }
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) g.pxRect(Math.round(toPx(x)), 0, 1, H, major);
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) g.pxRect(0, Math.round(toPy(y)), W, 1, major);
    const ax = Math.round(toPx(0));
    const ay = Math.round(toPy(0));
    g.pxRect(0, ay, W, 1, axis);
    g.pxRect(ax, 0, 1, H, axis);
    // curves
    const scope = { x: 0, vars: this.parsed.scope.vars, funcs: this.parsed.scope.funcs };
    this.parsed.lines.forEach((r, i) => {
      const color = COLORS[i % COLORS.length];
      if (r.kind === 'curve') {
        let prev = null;
        for (let px = 0; px < W; px++) {
          scope.x = this.cx + (px - W / 2) * s;
          let y;
          try {
            y = r.fn(scope);
          } catch {
            y = NaN;
          }
          if (!Number.isFinite(y)) {
            prev = null;
            continue;
          }
          const py = toPy(y);
          if (prev !== null && Math.abs(py - prev) < H * 1.5) g.pxLine(px - 1, Math.round(prev), px, Math.round(py), color);
          else if (py > -H && py < 2 * H) g.px(px, Math.round(py), color);
          prev = Math.abs(py) < 1e7 ? py : null;
        }
      } else if (r.kind === 'vline') {
        scope.x = 0;
        const x = r.fn(scope);
        if (Number.isFinite(x)) g.pxRect(Math.round(toPx(x)), 0, 1, H, color);
      }
    });
    // axis numbers
    const pwc = this.os.cv.pw;
    const phc = this.os.cv.ph;
    const labelY = clamp(Math.round(ay / phc) + 1, 0, g.h - 1);
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      if (Math.abs(x) < step / 2) continue;
      const cx = Math.round(toPx(x) / pwc);
      const t = fmt(x);
      g.text(clamp(cx - Math.floor(len(t) / 2), 0, g.w - len(t)), labelY, t, th.dim);
    }
    const labelX = clamp(Math.round(ax / pwc) + 1, 0, g.w - 6);
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      if (Math.abs(y) < step / 2) continue;
      g.text(labelX, clamp(Math.round(toPy(y) / phc), 0, g.h - 1), fmt(y), th.dim);
    }
    g.text(clamp(Math.round(ax / pwc) + 1, 0, g.w - 2), clamp(Math.round(ay / phc) + 1, 0, g.h - 1), '0', th.dim);
    // the pointer's coordinates
    const mx = this.os.mouse.x - (v.x + gx);
    const my = this.os.mouse.y - v.y;
    if (mx >= 0 && my >= 0 && mx < g.w && my < g.h) {
      const wx = this.cx + (this.os.ptr.x - (v.x + gx) * pwc - W / 2) * s;
      const wy = this.cy - (this.os.ptr.y - v.y * phc - H / 2) * s;
      const t = ` (${fmt(wx)}, ${fmt(wy)}) `;
      g.text(g.w - len(t), g.h - 1, t, th.text, mix(th.field, th.accent, 0.25));
    }
    if (this.focus === 'graph') g.text(1, 0, ' arrows pan  +/- zoom  0 reset ', 0xffffff, th.accent);
  }
  key(e) {
    const k = e.key;
    if (k === 'tab') {
      this.focus = this.focus === 'list' ? 'graph' : 'list';
      return true;
    }
    if (this.focus === 'graph') {
      const s = this.scale || 20 / Math.max(1, this.geom.W || 100);
      const W = this.geom.W || 100;
      if (k === 'left') this.cx -= s * W * 0.1;
      else if (k === 'right') this.cx += s * W * 0.1;
      else if (k === 'up') this.cy += s * W * 0.06;
      else if (k === 'down') this.cy -= s * W * 0.06;
      else if (k === '+' || k === '=') this.zoom(0.8);
      else if (k === '-' || k === '_') this.zoom(1.25);
      else if (k === '0' || k === 'r') ((this.cx = 0), (this.cy = 0), (this.scale = 0));
      else return false;
      this.os.stateDirty = true;
      return true;
    }
    if (e.ctrl && k === 'n') return this.add(), true;
    if (e.ctrl && k === 'd') return this.del(), true;
    if (k === 'enter') return this.add(), true;
    if (k === 'up') return this.select(this.active - 1), true;
    if (k === 'down') return this.select(this.active + 1), true;
    if (k === 'backspace' && !this.input.text && this.exprs.length > 1) return this.del(), true;
    const used = this.input.key(e);
    if (used) this.commit();
    return used;
  }
  mouse(e) {
    const { gx, gw, W, H } = this.geom;
    const s = this.scale || 20 / Math.max(1, W || 100);
    const pwc = this.os.cv.pw;
    // e.px, e.py: the pointer in pixels in this window, so panning and zooming follow it smoothly
    const gpx = e.px - gx * pwc;
    if (e.kind === 'wheel') {
      if (e.x >= gx) this.zoom(e.dir > 0 ? 1.15 : 0.87, gpx, e.py, W, H);
      return;
    }
    if (e.kind === 'down' && e.button === 0) {
      if (e.x >= gx) {
        this.focus = 'graph';
        this.drag = { x: e.px, y: e.py, cx: this.cx, cy: this.cy, s };
      } else this.hits.click(e.x, e.y);
    } else if (e.kind === 'drag' && this.drag) {
      this.cx = this.drag.cx - (e.px - this.drag.x) * this.drag.s;
      this.cy = this.drag.cy + (e.py - this.drag.y) * this.drag.s;
      this.scale = this.drag.s;
      this.os.stateDirty = true;
    } else if (e.kind === 'up') this.drag = null;
  }
}

export default {
  id: 'grapher',
  name: 'Grapher',
  desc: 'Plot equations like y = sin(x) and explore them, like Desmos.',
  icon: 'grapher',
  size: [92, 28],
  minSize: [50, 12],
  create: (os, win, data) => new Grapher(os, win, data),
};
