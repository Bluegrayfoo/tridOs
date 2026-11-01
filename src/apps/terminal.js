// Terminal: TridOS commands (help lists them) and, for anything else, your real shell, run in the folder you are in.

import fs from 'node:fs';
import path from 'node:path';
import os_ from 'node:os';
import { spawn } from 'node:child_process';
import { LineInput } from '../ui.js';
import { DISK, inDisk, listDir, displayPath, freeName, moveToTrash, niceSize } from '../fs.js';
import { clamp, len } from '../util.js';

const MAX_LINES = 2000;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/\r/g, '');

class Terminal {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.cwd = inDisk(data?.cwd || DISK);
    this.user = (() => {
      try {
        return os_.userInfo().username;
      } catch {
        return 'user';
      }
    })();
    this.lines = (data?.lines || []).slice(-300);
    if (!this.lines.length) this.print('TridOS Terminal. Type help for commands; anything else goes to your shell.', 'dim');
    this.input = new LineInput();
    this.history = data?.history || [];
    this.hi = -1;
    this.back = 0; // lines scrolled up from the bottom
    this.child = null;
    this.cols = 80;
  }
  save() {
    return { cwd: this.cwd, history: this.history.slice(-100), lines: this.lines.slice(-200) };
  }
  title() {
    return `Terminal — ${displayPath(this.cwd)}`;
  }
  close() {
    if (this.child) this.child.kill('SIGKILL');
  }
  print(text, kind = '') {
    for (const l of String(text).split('\n')) this.lines.push({ t: l, k: kind });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.back = 0;
    this.os.dirty = true;
  }
  prompt() {
    return `${this.user}@tridos ${this.cwd === DISK ? '~' : path.basename(this.cwd)} % `;
  }
  resolve(p) {
    if (!p) return this.cwd;
    return inDisk(path.resolve(this.cwd, p.replace(/^~(?=$|\/)/, DISK)));
  }
  run(cmdline) {
    const text = cmdline.trim();
    this.print(this.prompt() + cmdline, 'cmd');
    if (!text) return;
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    this.hi = -1;
    const parts = text.match(/"[^"]*"|'[^']*'|\S+/g).map((s) => s.replace(/^(["'])(.*)\1$/, '$2'));
    const [cmd, ...args] = parts;
    const fn = this.builtins()[cmd];
    if (fn) {
      try {
        fn(args, text);
      } catch (e) {
        this.print(`${cmd}: ${e.message}`, 'err');
      }
      return;
    }
    this.shell(text);
  }
  shell(text) {
    if (this.child) return this.print('A command is still running. Press Ctrl+C to stop it.', 'err');
    const child = spawn('/bin/sh', ['-c', text], { cwd: this.cwd, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', HOME: DISK }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let buf = '';
    const flush = (final) => {
      const parts = buf.split('\n');
      buf = final ? '' : parts.pop();
      for (const l of final ? parts.filter((l, i) => l || i < parts.length - 1) : parts) this.print(stripAnsi(l));
    };
    const timer = setTimeout(() => {
      this.print('(stopped after 60 seconds)', 'err');
      child.kill('SIGKILL');
    }, 60000);
    child.stdout.on('data', (d) => ((buf += d.toString()), flush(false)));
    child.stderr.on('data', (d) => ((buf += d.toString()), flush(false)));
    child.on('error', (e) => this.print(`sh: ${e.message}`, 'err'));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf) flush(true);
      if (code && code !== 143 && code !== 137) this.print(`(exit ${code})`, 'dim');
      this.child = null;
      this.os.dirty = true;
    });
  }
  builtins() {
    const os = this.os;
    return {
      help: () =>
        this.print(
          [
            'TridOS commands:',
            '  ls [-l] [dir]      list files        cd [dir]        change folder',
            '  pwd                where am I        cat <file>      show a file',
            '  mkdir <dir>        make a folder     touch <file>    make an empty file',
            '  rm [-r] <path>     move to Trash     date, whoami, uname, neofetch',
            '  edit <file>        open in Text Editor   open <file|app>   open a file or app',
            '  apps               list apps         settings        open System Settings',
            '  history            clear (Ctrl+L)    exit',
            'Anything else runs in your real shell, here, for up to a minute (Ctrl+C stops it).',
          ].join('\n'),
        ),
      clear: () => (this.lines = []),
      pwd: () => this.print(displayPath(this.cwd)),
      cd: ([p]) => {
        const abs = this.resolve(p || '~');
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return this.print(`cd: no such folder: ${p}`, 'err');
        this.cwd = abs;
      },
      ls: (args) => {
        const long = args.includes('-l') || args.includes('-la');
        const dir = this.resolve(args.find((a) => !a.startsWith('-')));
        const items = listDir(dir);
        if (!items.length) return;
        if (long) for (const i of items) this.print(`${i.dir ? 'd' : '-'}  ${(i.dir ? '' : niceSize(i.size)).padStart(9)}  ${new Date(i.mtime).toLocaleDateString()}  ${i.name}${i.dir ? '/' : ''}`);
        else this.print(items.map((i) => i.name + (i.dir ? '/' : '')).join('  '));
      },
      cat: (args) => {
        for (const a of args) this.print(fs.readFileSync(this.resolve(a), 'utf8').replace(/\n$/, ''));
      },
      mkdir: (args) => {
        for (const a of args) fs.mkdirSync(this.resolve(a), { recursive: true });
      },
      touch: (args) => {
        for (const a of args) {
          const p = this.resolve(a);
          if (!fs.existsSync(p)) fs.writeFileSync(p, '');
        }
      },
      rm: (args) => {
        for (const a of args.filter((a) => !a.startsWith('-'))) {
          const p = this.resolve(a);
          if (p === DISK) throw new Error('not removing the top of the disk');
          moveToTrash(p);
          this.print(`moved ${a} to the Trash`, 'dim');
        }
      },
      date: () => this.print(new Date().toString()),
      whoami: () => this.print(this.user),
      uname: () => this.print('TridOS 0.1 (' + process.platform + ' ' + os_.arch() + ')'),
      history: () => this.history.forEach((h, i) => this.print(`${String(i + 1).padStart(4)}  ${h}`)),
      exit: () => os.closeWindow(this.win),
      apps: () => {
        for (const d of Object.values(os.apps)) if (!d.system) this.print(`${os.isInstalled(d.id) ? '●' : '○'} ${d.name.padEnd(14)} ${d.desc || ''}`);
        this.print('● installed  ○ get it from the App Store', 'dim');
      },
      open: ([a]) => {
        if (!a) return this.print('open: what?', 'err');
        const app = Object.values(os.apps).find((d) => d.name.toLowerCase() === a.toLowerCase() || d.id === a);
        if (app) {
          if (!os.isInstalled(app.id) && !app.system) return this.print(`${app.name} is not installed. Get it from the App Store.`, 'err');
          return void os.launch(app.id);
        }
        const p = this.resolve(a);
        if (!fs.existsSync(p)) return this.print(`open: ${a}: not found`, 'err');
        os.openFile(p);
      },
      edit: ([a]) => {
        const p = this.resolve(a || freeName(this.cwd, 'untitled', '.txt'));
        if (!os.isInstalled('editor')) return this.print('Text Editor is not installed. Get it from the App Store.', 'err');
        os.launch('editor', { file: p });
      },
      settings: () => os.openSettings(),
      neofetch: () => {
        const cv = os.cv;
        this.print(
          [
            `  ${this.user}@tridos`,
            '  ─────────────────',
            `  OS      TridOS 0.1`,
            `  Host    ${os_.hostname()}`,
            `  Shell   TridOS Terminal`,
            `  Screen  ${cv.cols}x${cv.rows} cells, ${cv.W}x${cv.H} pixels`,
            `  Pixels  ${cv.mode}`,
            `  Colour  ${os.truecolor ? '24-bit' : '256'}`,
            `  Apps    ${os.installed.length} installed`,
            `  Disk    ${DISK}`,
          ].join('\n'),
          'accent',
        );
      },
    };
  }
  complete() {
    const text = this.input.text;
    const m = /(\S*)$/.exec(text);
    const word = m[1];
    const dirPart = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : '';
    const base = word.slice(dirPart.length);
    const dir = this.resolve(dirPart || '.');
    const matches = listDir(dir).filter((i) => i.name.startsWith(base));
    if (!matches.length) return;
    if (matches.length === 1) this.input.set(text.slice(0, text.length - base.length) + matches[0].name + (matches[0].dir ? '/' : ' '));
    else {
      this.print(matches.map((i) => i.name + (i.dir ? '/' : '')).join('  '), 'dim');
      let common = matches[0].name;
      for (const i of matches) while (!i.name.startsWith(common)) common = common.slice(0, -1);
      if (common.length > base.length) this.input.set(text.slice(0, text.length - base.length) + common);
    }
  }
  draw(v, focused) {
    const th = this.os.th;
    const bg = th.dark ? 0x0c0c0f : 0xfbfbfd;
    const fg = th.dark ? 0xe6e6eb : 0x202024;
    const kinds = { dim: th.dim, err: th.danger, cmd: fg, accent: th.accent };
    v.fill(bg);
    this.cols = v.w - 2;
    // wrap every line to the width, newest at the bottom
    const rows = [];
    for (const l of this.lines.slice(-600)) {
      const t = l.t;
      if (!t) rows.push(['', l.k]);
      else for (let i = 0; i < t.length; i += this.cols) rows.push([t.slice(i, i + this.cols), l.k]);
    }
    const prompt = this.prompt();
    const inputRows = Math.max(1, Math.ceil((len(prompt) + len(this.input.text) + 1) / this.cols));
    const visible = v.h - 0;
    const total = rows.length + inputRows;
    this.back = clamp(this.back, 0, Math.max(0, total - visible));
    const first = Math.max(0, total - visible - this.back);
    for (let i = 0; i < visible; i++) {
      const idx = first + i;
      if (idx < rows.length) v.text(1, i, rows[idx][0], kinds[rows[idx][1]] || fg);
    }
    // the prompt line(s)
    const base = rows.length - first;
    if (base >= 0 && base < visible + 0) {
      const text = prompt + this.input.text;
      const user = this.user + '@tridos';
      for (let r = 0; r < inputRows; r++) {
        const y = base + r;
        if (y >= visible) break;
        v.text(1, y, text.slice(r * this.cols, (r + 1) * this.cols), fg);
        if (r === 0) v.text(1, y, user, 0x30d158);
        if (r === 0) v.text(1 + len(user) + 1, y, this.cwd === DISK ? '~' : path.basename(this.cwd), 0x4aa3ff);
      }
      if (focused && !this.child) {
        const pos = len(prompt) + this.input.cur;
        const cy = base + Math.floor(pos / this.cols);
        if (cy < visible) v.text(1 + (pos % this.cols), cy, [...this.input.text][this.input.cur] ?? ' ', th.dark ? 0x000000 : 0xffffff, th.accent);
      }
    }
    if (this.back > 0) v.text(v.w - 12, 0, ` ↓ ${this.back} more `, 0xffffff, th.accent);
  }
  key(e) {
    const k = e.key;
    if (e.ctrl && k === 'c') {
      if (this.child) {
        this.child.kill('SIGINT');
        this.print('^C', 'dim');
      } else {
        this.print(this.prompt() + this.input.text + '^C', 'dim');
        this.input.set('');
      }
      return true;
    }
    if (e.ctrl && k === 'l') return (this.lines = []), true;
    if (k === 'enter') {
      const text = this.input.text;
      this.input.set('');
      this.run(text);
      return true;
    }
    if (k === 'up') {
      if (this.history.length) {
        this.hi = this.hi < 0 ? this.history.length - 1 : Math.max(0, this.hi - 1);
        this.input.set(this.history[this.hi]);
      }
      return true;
    }
    if (k === 'down') {
      if (this.hi >= 0) {
        this.hi++;
        if (this.hi >= this.history.length) {
          this.hi = -1;
          this.input.set('');
        } else this.input.set(this.history[this.hi]);
      }
      return true;
    }
    if (k === 'pageup') return (this.back += Math.max(1, this.win.h - 4)), true;
    if (k === 'pagedown') return (this.back = Math.max(0, this.back - Math.max(1, this.win.h - 4))), true;
    if (k === 'tab') return this.complete(), true;
    this.back = 0;
    return this.input.key(e);
  }
  mouse(e) {
    if (e.kind === 'wheel') this.back = Math.max(0, this.back - e.dir * 3);
  }
  menus() {
    return [
      {
        title: 'Shell',
        items: [
          { label: 'Clear', fn: () => (this.lines = []) },
          { label: 'Stop Running Command', fn: () => this.child?.kill('SIGINT') },
          { label: 'Home Folder', fn: () => (this.cwd = DISK) },
        ],
      },
    ];
  }
}

export default {
  id: 'terminal',
  name: 'Terminal',
  desc: 'A command line: TridOS commands and your real shell.',
  icon: 'terminal',
  size: [80, 22],
  minSize: [30, 6],
  create: (os, win, data) => new Terminal(os, win, data),
};
