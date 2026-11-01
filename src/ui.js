// What apps draw with: a clipped View onto the screen, click targets, buttons, and two editors (one line, many lines).

import { mix, len, fit, clamp, line as bres } from './util.js';

export class View {
  // x, y, w, h: this view's area on the screen, in cells. `mouse` is the pointer {x, y} in screen cells.
  constructor(cv, x, y, w, h, mouse = { x: -1, y: -1 }) {
    this.cv = cv;
    this.x = x;
    this.y = y;
    this.w = Math.max(0, w);
    this.h = Math.max(0, h);
    this.mouse = mouse;
  }
  get pw() {
    return this.cv.pw;
  }
  get ph() {
    return this.cv.ph;
  }
  get pxW() {
    return this.w * this.cv.pw;
  }
  get pxH() {
    return this.h * this.cv.ph;
  }
  sub(x, y, w, h) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    return new View(this.cv, this.x + x0, this.y + y0, x1 - x0, y1 - y0, this.mouse);
  }
  // Is the pointer over this cell rectangle (relative to the view)?
  hover(x, y, w = 1, h = 1) {
    const mx = this.mouse.x - this.x;
    const my = this.mouse.y - this.y;
    return mx >= x && mx < x + w && my >= y && my < y + h;
  }
  rect(x, y, w, h, c) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    if (x1 > x0 && y1 > y0) this.cv.cellFill(this.x + x0, this.y + y0, x1 - x0, y1 - y0, c);
  }
  fill(c) {
    this.rect(0, 0, this.w, this.h, c);
  }
  text(x, y, s, fg, bg = -1) {
    if (y < 0 || y >= this.h || x >= this.w) return;
    let str = s;
    if (x < 0) {
      str = [...s].slice(-x).join('');
      x = 0;
    }
    const room = this.w - x;
    if (len(str) > room) str = [...str].slice(0, room).join('');
    if (str) this.cv.text(this.x + x, this.y + y, str, fg, bg);
  }
  // Pixel drawing, with (0, 0) the top-left pixel of the view.
  px(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.pxW && y < this.pxH) this.cv.px(this.x * this.pw + x, this.y * this.ph + y, c);
  }
  pxRect(x, y, w, h, c) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.pxW, x + w);
    const y1 = Math.min(this.pxH, y + h);
    if (x1 > x0 && y1 > y0) this.cv.pxRect(this.x * this.pw + x0, this.y * this.ph + y0, x1 - x0, y1 - y0, c);
  }
  blendRect(x, y, w, h, c, a) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.pxW, x + w);
    const y1 = Math.min(this.pxH, y + h);
    if (x1 > x0 && y1 > y0) this.cv.blendRect(this.x * this.pw + x0, this.y * this.ph + y0, x1 - x0, y1 - y0, c, a);
  }
  pxLine(x0, y0, x1, y1, c) {
    bres(x0, y0, x1, y1, (x, y) => this.px(x, y, c));
  }
  // Remove any text from a cell rectangle (so pixels drawn there show).
  clearText(x, y, w, h) {
    this.cv.clearText(this.x + x, this.y + y, w, h);
  }
  // A small picture from strings: each character is a palette key, '.' or ' ' is see-through.
  sprite(x, y, rows, palette) {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (palette[r[i]] !== undefined) this.px(x + i, y + j, palette[r[i]]);
    });
  }
}

// Click targets: draw code adds them, mouse code asks which one was hit.
export class Hits {
  constructor() {
    this.items = [];
  }
  reset() {
    this.items.length = 0;
  }
  add(x, y, w, h, fn, id) {
    this.items.push({ x, y, w, h, fn, id });
  }
  at(x, y) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h) return it;
    }
    return null;
  }
  click(x, y) {
    const it = this.at(x, y);
    if (it) {
      it.fn(x - it.x, y - it.y);
      return true;
    }
    return false;
  }
}

// A rounded-looking button: one row of colour with a space of padding each side. Returns its width.
export function button(v, hits, x, y, label, th, fn, { primary = false, active = false, danger = false, width = 0 } = {}) {
  const w = Math.max(width, len(label) + 2);
  const over = v.hover(x, y, w, 1);
  let bg = primary ? th.accent : danger ? th.danger : active ? th.sel : th.ctrl;
  if (over) bg = mix(bg, th.dark ? 0xffffff : 0x000000, 0.14);
  const fg = primary || danger ? 0xffffff : th.text;
  v.rect(x, y, w, 1, bg);
  const pad = Math.floor((w - len(label)) / 2);
  v.text(x + pad, y, label, fg);
  if (hits) hits.add(x, y, w, 1, fn);
  return w;
}

export function checkbox(v, hits, x, y, label, on, th, fn) {
  v.text(x, y, on ? '◉' : '○', on ? th.accent : th.dim);
  v.text(x + 2, y, label, th.text);
  hits.add(x, y, 2 + len(label), 1, fn);
}

// --- a one-line text field ---

export class LineInput {
  constructor(text = '') {
    this.text = text;
    this.cur = [...text].length;
    this.left = 0; // first character shown
  }
  set(text) {
    this.text = text;
    this.cur = [...text].length;
  }
  // Returns true if the key was an editing key. Enter and Escape are left to the caller.
  key(e) {
    const chars = [...this.text];
    const put = (s) => {
      chars.splice(this.cur, 0, ...s);
      this.cur += [...s].length;
    };
    if (e.ctrl) {
      if (e.key === 'a') this.cur = 0;
      else if (e.key === 'e') this.cur = chars.length;
      else if (e.key === 'u') {
        chars.splice(0, this.cur);
        this.cur = 0;
      } else if (e.key === 'k') chars.splice(this.cur);
      else if (e.key === 'w') {
        let i = this.cur;
        while (i > 0 && chars[i - 1] === ' ') i--;
        while (i > 0 && chars[i - 1] !== ' ') i--;
        chars.splice(i, this.cur - i);
        this.cur = i;
      } else return false;
    } else if (e.key === 'left') this.cur = Math.max(0, this.cur - 1);
    else if (e.key === 'right') this.cur = Math.min(chars.length, this.cur + 1);
    else if (e.key === 'home') this.cur = 0;
    else if (e.key === 'end') this.cur = chars.length;
    else if (e.key === 'backspace') {
      if (this.cur > 0) {
        chars.splice(this.cur - 1, 1);
        this.cur--;
      }
    } else if (e.key === 'delete') chars.splice(this.cur, 1);
    else if (e.text && !e.alt) put(e.text);
    else return false;
    this.text = chars.join('');
    return true;
  }
  // Draw into w cells of row y; the cursor is a filled cell when focused.
  draw(v, x, y, w, th, { focus = true, fg = th.text, bg = th.field, mask = false } = {}) {
    const chars = [...(mask ? this.text.replace(/./gu, '•') : this.text)];
    if (this.cur < this.left) this.left = this.cur;
    if (this.cur >= this.left + w - 1) this.left = this.cur - w + 2;
    if (this.left < 0) this.left = 0;
    v.rect(x, y, w, 1, bg);
    const shown = chars.slice(this.left, this.left + w);
    v.text(x, y, shown.join(''), fg);
    if (focus) {
      const cx = this.cur - this.left;
      if (cx >= 0 && cx < w) v.text(x + cx, y, chars[this.cur] ?? ' ', th.dark ? 0x000000 : 0xffffff, th.accent);
    }
  }
}

// --- many lines of text ---

const JS_WORDS = new Set('const let var function return if else for while do break continue new class extends import export from default async await try catch finally throw typeof instanceof this null undefined true false of in switch case'.split(' '));

function highlightJs(line, th) {
  const out = [];
  const colors = th.dark ? { kw: 0xc792ea, str: 0xc3e88d, num: 0xf78c6c, com: 0x6c7a89, fn: 0x82aaff } : { kw: 0x8a2be2, str: 0x2a7a2a, num: 0xc25e00, com: 0x8a8f98, fn: 0x1b5fc0 };
  const re = /(\/\/.*$)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(\s*\()?|(\s+)|(.)/gu;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) out.push([m[1], colors.com]);
    else if (m[2]) out.push([m[2], colors.str]);
    else if (m[3]) out.push([m[3], colors.num]);
    else if (m[4]) {
      if (JS_WORDS.has(m[4])) out.push([m[4], colors.kw]);
      else out.push([m[4], m[5] ? colors.fn : th.text]);
      if (m[5]) out.push([m[5], th.text]);
    } else out.push([m[0], th.text]);
  }
  return out;
}

export class TextArea {
  constructor(text = '', { lang = '', onChange = null } = {}) {
    this.lang = lang;
    this.onChange = onChange;
    this.setText(text);
  }
  setText(text) {
    this.lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    this.cx = 0;
    this.cy = 0;
    this.goal = 0;
    this.top = 0;
    this.left = 0;
    this.modified = false;
    this.undoStack = [];
    this.redoStack = [];
    this.lastEdit = '';
    this.lastEditAt = 0;
    this.follow = true;
  }
  getText() {
    return this.lines.join('\n');
  }
  snapshot() {
    return { lines: this.lines.slice(), cx: this.cx, cy: this.cy };
  }
  // Call before changing the text. Typing in a row (or deleting in a row) is one undo step.
  remember(kind) {
    const now = Date.now();
    if (kind !== this.lastEdit || now - this.lastEditAt > 900) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 200) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.lastEdit = kind;
    this.lastEditAt = now;
  }
  changed() {
    this.modified = true;
    this.follow = true;
    if (this.onChange) this.onChange();
  }
  restore(s) {
    this.lines = s.lines.slice();
    this.cx = s.cx;
    this.cy = s.cy;
    this.goal = this.cx;
    this.changed();
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.lastEdit = '';
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.lastEdit = '';
    this.restore(s);
  }
  insert(str) {
    this.remember('type');
    const parts = str.split('\n');
    const cur = this.lines[this.cy];
    const before = cur.slice(0, this.cx);
    const after = cur.slice(this.cx);
    if (parts.length === 1) {
      this.lines[this.cy] = before + str + after;
      this.cx += str.length;
    } else {
      this.lines.splice(this.cy, 1, before + parts[0], ...parts.slice(1, -1), parts[parts.length - 1] + after);
      this.cy += parts.length - 1;
      this.cx = parts[parts.length - 1].length;
    }
    this.goal = this.cx;
    this.changed();
  }
  // Returns true when the key was used.
  key(e, pageRows = 10) {
    const L = this.lines;
    const clampCx = () => {
      this.cx = Math.min(this.cx, L[this.cy].length);
    };
    if (e.ctrl) {
      if (e.key === 'z') return this.undo(), true;
      if (e.key === 'y') return this.redo(), true;
      if (e.key === 'a') return (this.cx = 0), (this.goal = 0), (this.follow = true), true;
      if (e.key === 'e') return (this.cx = L[this.cy].length), (this.goal = this.cx), (this.follow = true), true;
      if (e.key === 'd') {
        this.remember('line');
        if (L.length > 1) L.splice(this.cy, 1);
        else L[0] = '';
        this.cy = Math.min(this.cy, L.length - 1);
        clampCx();
        this.changed();
        return true;
      }
      if (e.key === 'k') {
        this.remember('kill');
        L[this.cy] = L[this.cy].slice(0, this.cx);
        this.changed();
        return true;
      }
      return false;
    }
    this.follow = true;
    switch (e.key) {
      case 'left':
        if (this.cx > 0) this.cx--;
        else if (this.cy > 0) {
          this.cy--;
          this.cx = L[this.cy].length;
        }
        this.goal = this.cx;
        return true;
      case 'right':
        if (this.cx < L[this.cy].length) this.cx++;
        else if (this.cy < L.length - 1) {
          this.cy++;
          this.cx = 0;
        }
        this.goal = this.cx;
        return true;
      case 'up':
        if (this.cy > 0) this.cy--;
        this.cx = Math.min(this.goal, L[this.cy].length);
        return true;
      case 'down':
        if (this.cy < L.length - 1) this.cy++;
        this.cx = Math.min(this.goal, L[this.cy].length);
        return true;
      case 'pageup':
        this.cy = Math.max(0, this.cy - pageRows);
        this.cx = Math.min(this.goal, L[this.cy].length);
        return true;
      case 'pagedown':
        this.cy = Math.min(L.length - 1, this.cy + pageRows);
        this.cx = Math.min(this.goal, L[this.cy].length);
        return true;
      case 'home':
        this.cx = 0;
        this.goal = 0;
        return true;
      case 'end':
        this.cx = L[this.cy].length;
        this.goal = this.cx;
        return true;
      case 'enter': {
        this.remember('enter');
        const indent = /^\s*/.exec(L[this.cy].slice(0, this.cx))[0];
        const rest = L[this.cy].slice(this.cx);
        L[this.cy] = L[this.cy].slice(0, this.cx);
        L.splice(this.cy + 1, 0, indent + rest);
        this.cy++;
        this.cx = indent.length;
        this.goal = this.cx;
        this.changed();
        return true;
      }
      case 'backspace':
        this.remember('back');
        if (this.cx > 0) {
          L[this.cy] = L[this.cy].slice(0, this.cx - 1) + L[this.cy].slice(this.cx);
          this.cx--;
        } else if (this.cy > 0) {
          this.cx = L[this.cy - 1].length;
          L[this.cy - 1] += L[this.cy];
          L.splice(this.cy, 1);
          this.cy--;
        } else return true;
        this.goal = this.cx;
        this.changed();
        return true;
      case 'delete':
        this.remember('back');
        if (this.cx < L[this.cy].length) L[this.cy] = L[this.cy].slice(0, this.cx) + L[this.cy].slice(this.cx + 1);
        else if (this.cy < L.length - 1) {
          L[this.cy] += L[this.cy + 1];
          L.splice(this.cy + 1, 1);
        } else return true;
        this.changed();
        return true;
      case 'tab':
        if (e.shift) return true;
        this.insert('  ');
        return true;
      default:
        if (e.text && !e.alt) {
          this.insert(e.text);
          return true;
        }
        return false;
    }
  }
  wheel(dir) {
    this.top = clamp(this.top + dir * 3, 0, Math.max(0, this.lines.length - 1));
    this.follow = false;
  }
  gutterWidth() {
    return String(this.lines.length).length + 2;
  }
  // Put the cursor where a click at view cell (x, y) points. Call after draw (uses the layout it made).
  click(x, y) {
    const gw = this.gw || 0;
    this.cy = clamp(this.top + y, 0, this.lines.length - 1);
    this.cx = clamp(this.left + x - gw, 0, this.lines[this.cy].length);
    this.goal = this.cx;
    this.follow = false;
  }
  draw(v, th, { focus = true, gutter = true } = {}) {
    const gw = gutter ? this.gutterWidth() : 0;
    this.gw = gw;
    const tw = Math.max(1, v.w - gw - 1);
    if (this.follow) {
      if (this.cy < this.top) this.top = this.cy;
      if (this.cy >= this.top + v.h) this.top = this.cy - v.h + 1;
      if (this.cx < this.left) this.left = this.cx;
      if (this.cx >= this.left + tw) this.left = this.cx - tw + 1;
      this.follow = false;
    }
    this.top = clamp(this.top, 0, Math.max(0, this.lines.length - 1));
    v.fill(th.field);
    if (gutter) v.rect(0, 0, gw, v.h, th.side);
    const curBg = mix(th.field, th.accent, 0.12);
    for (let r = 0; r < v.h; r++) {
      const i = this.top + r;
      if (i >= this.lines.length) break;
      const isCur = i === this.cy;
      if (isCur && focus) v.rect(gw, r, v.w - gw, 1, curBg);
      if (gutter) v.text(0, r, String(i + 1).padStart(gw - 1) + ' ', isCur ? th.text : th.dim);
      const text = this.lines[i];
      if (this.lang === 'js') {
        let pos = 0;
        for (const [seg, color] of highlightJs(text, th)) {
          const from = Math.max(0, this.left - pos);
          const to = Math.min(seg.length, this.left + tw - pos);
          if (to > from) v.text(gw + pos + from - this.left, r, seg.slice(from, to), color);
          pos += seg.length;
        }
      } else {
        v.text(gw, r, text.slice(this.left, this.left + tw), th.text);
      }
    }
    if (focus && this.cy >= this.top && this.cy < this.top + v.h) {
      const cx = gw + this.cx - this.left;
      if (cx >= gw && cx < v.w) v.text(cx, this.cy - this.top, this.lines[this.cy][this.cx] ?? ' ', th.dark ? 0x000000 : 0xffffff, th.accent);
    }
    // a thin scrollbar
    if (this.lines.length > v.h) {
      const h = Math.max(1, Math.round((v.h * v.h) / this.lines.length));
      const y = Math.round((this.top / this.lines.length) * v.h);
      v.rect(v.w - 1, 0, 1, v.h, th.field);
      v.rect(v.w - 1, y, 1, h, th.ctrlHi);
    }
  }
}

export { fit, len };
