// The real terminal: raw keys, mouse reporting, the alternate screen. Input comes out as plain events:
//   { type: 'key', key, ctrl, alt, shift, text }   key is 'up', 'enter', 'a', ...; text is set for printable characters
//   { type: 'mouse', kind: 'down'|'up'|'move'|'drag'|'wheel', button, x, y, dir, shift, ctrl, alt }   x, y in cells from 0

import { StringDecoder } from 'node:string_decoder';

const NAMED_CSI = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'tab' };
const TILDE = { 1: 'home', 2: 'insert', 3: 'delete', 4: 'end', 5: 'pageup', 6: 'pagedown', 7: 'home', 8: 'end' };

export class KeyParser {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.buf = '';
    this.timer = null;
  }
  feed(str) {
    this.buf += str;
    clearTimeout(this.timer);
    this.parse();
    // a lone ESC may be the start of a sequence cut by the chunk boundary: give the rest a moment to arrive
    if (this.buf === '\x1b') {
      this.timer = setTimeout(() => {
        if (this.buf === '\x1b') {
          this.buf = '';
          this.onEvent({ type: 'key', key: 'escape', ctrl: false, alt: false, shift: false });
        }
      }, 40);
    }
  }
  key(key, mods = {}, text) {
    this.onEvent({ type: 'key', key, ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift, text });
  }
  parse() {
    let b = this.buf;
    while (b.length) {
      const c = b[0];
      if (c === '\x1b') {
        if (b.length === 1) break;
        if (b[1] === '[') {
          // SGR mouse: ESC [ < b ; x ; y M|m
          let m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(b);
          if (m) {
            this.mouse(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1, m[4] === 'M');
            b = b.slice(m[0].length);
            continue;
          }
          if (/^\x1b\[<[\d;]*$/.test(b)) break; // incomplete mouse report
          // legacy mouse: ESC [ M b x y (one character each, offset by 32)
          if (b.startsWith('\x1b[M')) {
            if (b.length < 6) break;
            this.legacyMouse(b.charCodeAt(3) - 32, b.charCodeAt(4) - 33, b.charCodeAt(5) - 33);
            b = b.slice(6);
            continue;
          }
          m = /^\x1b\[([\d;]*)([A-Za-z~])/.exec(b);
          if (!m) {
            if (/^\x1b\[[\d;]*$/.test(b)) break; // incomplete
            b = b.slice(2);
            continue;
          }
          b = b.slice(m[0].length);
          const nums = m[1].split(';').map(Number);
          const mod = (nums[1] || 1) - 1;
          const mods = { shift: !!(mod & 1), alt: !!(mod & 2), ctrl: !!(mod & 4) };
          if (m[2] === '~') {
            const k = TILDE[nums[0]];
            if (k) this.key(k, mods);
          } else if (NAMED_CSI[m[2]]) {
            const k = NAMED_CSI[m[2]];
            this.key(k, k === 'tab' ? { ...mods, shift: true } : mods);
          }
          continue;
        }
        if (b[1] === 'O') {
          if (b.length < 3) break;
          const k = NAMED_CSI[b[2]];
          if (k) this.key(k);
          b = b.slice(3);
          continue;
        }
        // ESC then a character: Alt + that character
        const ch = [...b.slice(1)][0];
        b = b.slice(1 + ch.length);
        if (ch === '\x7f') this.key('backspace', { alt: true });
        else this.key(ch.toLowerCase(), { alt: true, shift: ch !== ch.toLowerCase() }, undefined);
        continue;
      }
      const ch = [...b][0];
      b = b.slice(ch.length);
      const code = ch.codePointAt(0);
      if (ch === '\r' || ch === '\n') this.key('enter');
      else if (ch === '\t') this.key('tab');
      else if (ch === '\x7f' || ch === '\x08') this.key('backspace');
      else if (code === 0) this.key(' ', { ctrl: true });
      else if (code < 32) this.key(String.fromCharCode(code + 96), { ctrl: true });
      else this.key(ch, { shift: ch !== ch.toLowerCase() && ch === ch.toUpperCase() }, ch);
    }
    this.buf = b;
  }
  mouse(code, x, y, press) {
    const mods = { shift: !!(code & 4), alt: !!(code & 8), ctrl: !!(code & 16) };
    const button = code & 3;
    if (code & 64) {
      if (press) this.onEvent({ type: 'mouse', kind: 'wheel', dir: button & 1 ? 1 : -1, button: 0, x, y, ...mods });
      return;
    }
    if (code & 32) {
      this.onEvent({ type: 'mouse', kind: button === 3 ? 'move' : 'drag', button: button === 3 ? 0 : button, x, y, ...mods });
      return;
    }
    this.onEvent({ type: 'mouse', kind: press ? 'down' : 'up', button, x, y, ...mods });
  }
  legacyMouse(code, x, y) {
    const button = code & 3;
    const release = button === 3 && !(code & 32);
    this.mouse(code, x, y, !release);
    if (release) this.onEvent({ type: 'mouse', kind: 'up', button: 0, x, y, shift: false, alt: false, ctrl: false });
  }
}

export class Terminal {
  constructor() {
    this.out = process.stdout;
    this.inp = process.stdin;
    this.decoder = new StringDecoder('utf8');
    this.onEvent = () => {};
    this.onResize = () => {};
    this.active = false;
    this.parser = new KeyParser((e) => this.onEvent(e));
  }
  get cols() {
    return this.out.columns || 80;
  }
  get rows() {
    return this.out.rows || 24;
  }
  start() {
    if (this.active) return;
    this.active = true;
    // alternate screen, hide the cursor, no wrapping, any-motion mouse reports in SGR form
    this.out.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?1003h\x1b[?1006h\x1b[2J');
    if (this.inp.isTTY) this.inp.setRawMode(true);
    this.inp.resume();
    this.dataHandler = (buf) => this.parser.feed(this.decoder.write(buf));
    this.inp.on('data', this.dataHandler);
    this.resizeHandler = () => this.onResize();
    this.out.on('resize', this.resizeHandler);
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.inp.off('data', this.dataHandler);
    this.out.off('resize', this.resizeHandler);
    this.out.write('\x1b[?1003l\x1b[?1006l\x1b[?7h\x1b[?25h\x1b[0m\x1b[?1049l');
    if (this.inp.isTTY) this.inp.setRawMode(false);
    this.inp.pause();
  }
  write(s) {
    if (s) this.out.write(s);
  }
}
