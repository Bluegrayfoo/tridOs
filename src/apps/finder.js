// Finder: browse the TridOS disk (~/.tridos/disk), make folders and files, rename, trash, open.

import fs from 'node:fs';
import path from 'node:path';
import { Hits, button } from '../ui.js';
import { DISK, TRASH, listDir, freeName, moveToTrash, niceSize, displayPath, inDisk, isInDisk } from '../fs.js';
import { clamp, fit, len, mix } from '../util.js';

const SIDE = 16;
const FAVORITES = [
  ['Home', DISK],
  ['Desktop', path.join(DISK, 'Desktop')],
  ['Documents', path.join(DISK, 'Documents')],
  ['Downloads', path.join(DISK, 'Downloads')],
  ['Trash', TRASH],
];

class Finder {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.cwd = inDisk(data?.path || DISK);
    this.back = [];
    this.fwd = [];
    this.sel = 0;
    this.scroll = 0;
    this.items = [];
    this.loadedAt = 0;
    this.hits = new Hits();
    this.last = { t: 0, i: -1 };
    this.refresh();
  }
  save() {
    return { path: this.cwd };
  }
  title() {
    return this.cwd === DISK ? 'Home' : path.basename(this.cwd);
  }
  refresh() {
    this.items = listDir(this.cwd);
    this.loadedAt = Date.now();
    this.sel = clamp(this.sel, 0, Math.max(0, this.items.length - 1));
  }
  goTo(p, push = true) {
    const abs = inDisk(p);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
    if (push && abs !== this.cwd) {
      this.back.push(this.cwd);
      this.fwd = [];
    }
    this.cwd = abs;
    this.sel = 0;
    this.scroll = 0;
    this.refresh();
    this.os.changed();
  }
  goBack() {
    const p = this.back.pop();
    if (p) {
      this.fwd.push(this.cwd);
      this.goTo(p, false);
    }
  }
  goFwd() {
    const p = this.fwd.pop();
    if (p) {
      this.back.push(this.cwd);
      this.goTo(p, false);
    }
  }
  up() {
    if (this.cwd !== DISK) this.goTo(path.dirname(this.cwd));
  }
  cur() {
    return this.items[this.sel] || null;
  }
  open(it = this.cur()) {
    if (!it) return;
    const p = path.join(this.cwd, it.name);
    if (it.dir) this.goTo(p);
    else this.os.openFile(p);
  }
  newFolder() {
    this.os.ask('New Folder', 'Name of the new folder:', freeName(this.cwd, 'untitled folder'), (name) => {
      name = name.trim();
      if (!name || /[\\/]/.test(name)) return this.os.toast('That is not a good name.');
      try {
        fs.mkdirSync(path.join(this.cwd, name));
      } catch (e) {
        return this.os.toast(e.message);
      }
      this.refresh();
      this.sel = Math.max(0, this.items.findIndex((i) => i.name === name));
    });
  }
  newFile() {
    this.os.ask('New Text File', 'Name of the new file:', freeName(this.cwd, 'untitled', '.txt'), (name) => {
      name = name.trim();
      if (!name || /[\\/]/.test(name)) return this.os.toast('That is not a good name.');
      try {
        fs.writeFileSync(path.join(this.cwd, name), '', { flag: 'wx' });
      } catch (e) {
        return this.os.toast(e.message);
      }
      this.refresh();
      this.sel = Math.max(0, this.items.findIndex((i) => i.name === name));
    });
  }
  rename() {
    const it = this.cur();
    if (!it) return;
    this.os.ask('Rename', `New name for "${it.name}":`, it.name, (name) => {
      name = name.trim();
      if (!name || /[\\/]/.test(name)) return this.os.toast('That is not a good name.');
      try {
        if (fs.existsSync(path.join(this.cwd, name))) throw new Error('Something with that name is already here.');
        fs.renameSync(path.join(this.cwd, it.name), path.join(this.cwd, name));
      } catch (e) {
        return this.os.toast(e.message);
      }
      this.refresh();
    });
  }
  trash() {
    const it = this.cur();
    if (!it) return;
    if (this.cwd === TRASH) {
      this.os.confirm('Delete Forever', `Delete "${it.name}" for good? This cannot be undone.`, 'Delete', () => {
        try {
          fs.rmSync(path.join(this.cwd, it.name), { recursive: true, force: true });
        } catch (e) {
          this.os.toast(e.message);
        }
        this.refresh();
      }, true);
      return;
    }
    try {
      moveToTrash(path.join(this.cwd, it.name));
      this.os.toast(`Moved "${it.name}" to the Trash.`);
    } catch (e) {
      this.os.toast(e.message);
    }
    this.refresh();
  }
  emptyTrash() {
    this.os.confirm('Empty Trash', 'Delete everything in the Trash for good?', 'Empty', () => {
      for (const n of fs.readdirSync(TRASH)) fs.rmSync(path.join(TRASH, n), { recursive: true, force: true });
      this.refresh();
    }, true);
  }
  menus() {
    return [
      {
        title: 'File',
        items: [
          { label: 'Open', fn: () => this.open() },
          { label: 'New Folder', fn: () => this.newFolder() },
          { label: 'New Text File', fn: () => this.newFile() },
          { label: 'Rename…', fn: () => this.rename() },
          { sep: true },
          { label: 'Move to Trash', fn: () => this.trash() },
          { label: 'Empty Trash…', fn: () => this.emptyTrash() },
        ],
      },
      {
        title: 'Go',
        items: [
          { label: 'Back', fn: () => this.goBack() },
          { label: 'Forward', fn: () => this.goFwd() },
          { label: 'Enclosing Folder', fn: () => this.up() },
          { sep: true },
          ...FAVORITES.map(([n, p]) => ({ label: n, fn: () => this.goTo(p) })),
        ],
      },
    ];
  }
  tick() {
    if (Date.now() - this.loadedAt > 2000) {
      const before = JSON.stringify(this.items.map((i) => [i.name, i.size, i.mtime]));
      this.refresh();
      return before !== JSON.stringify(this.items.map((i) => [i.name, i.size, i.mtime]));
    }
    return false;
  }
  draw(v, focused) {
    const th = this.os.th;
    this.hits.reset();
    v.fill(th.bg);
    v.rect(0, 0, SIDE, v.h, th.side);
    v.text(2, 1, 'Favorites', th.dim);
    FAVORITES.forEach(([name, p], i) => {
      const y = 2 + i;
      const on = this.cwd === p;
      if (on) v.rect(1, y, SIDE - 2, 1, th.sel);
      v.text(2, y, name === 'Trash' ? '▪' : '◼', on ? th.accent : th.dim);
      v.text(4, y, name, th.text);
      this.hits.add(0, y, SIDE, 1, () => this.goTo(p));
    });
    // toolbar
    const mx = SIDE + 1;
    let x = mx;
    x += button(v, this.hits, x, 0, '‹', th, () => this.goBack(), { width: 3 }) + 1;
    x += button(v, this.hits, x, 0, '›', th, () => this.goFwd(), { width: 3 }) + 1;
    x += button(v, this.hits, x, 0, '↑', th, () => this.up(), { width: 3 }) + 1;
    const right = [['New Folder', () => this.newFolder()], ['New File', () => this.newFile()], [this.cwd === TRASH ? 'Delete' : 'Trash', () => this.trash()]];
    let rx = v.w - 1;
    for (let i = right.length - 1; i >= 0; i--) {
      const w = len(right[i][0]) + 2;
      rx -= w;
      if (rx > x + 6) button(v, this.hits, rx, 0, right[i][0], th, right[i][1]);
      rx -= 1;
    }
    v.text(x + 1, 0, fit(displayPath(this.cwd), Math.max(4, rx - x - 1)), th.text);
    for (let k = mx; k < v.w; k++) v.text(k, 1, '─', th.line);
    // columns
    const lw = v.w - mx;
    const sizeX = v.w - 12;
    v.text(mx + 3, 2, 'Name', th.dim);
    v.text(sizeX, 2, 'Size', th.dim);
    const rows = Math.max(1, v.h - 5);
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + rows) this.scroll = this.sel - rows + 1;
    if (!this.items.length) v.text(mx + 3, 4, 'This folder is empty.', th.dim);
    this.items.slice(this.scroll, this.scroll + rows).forEach((it, i) => {
      const idx = this.scroll + i;
      const y = 3 + i;
      const on = idx === this.sel;
      if (on) v.rect(mx, y, lw, 1, focused ? th.accent : th.sel);
      const fg = on && focused ? 0xffffff : th.text;
      v.text(mx + 1, y, it.dir ? '◼' : '▫', on && focused ? 0xffffff : it.dir ? 0x4aa3ff : th.dim);
      v.text(mx + 3, y, fit(it.name, sizeX - mx - 4), fg);
      v.text(sizeX, y, it.dir ? '--' : niceSize(it.size), on && focused ? 0xffffff : th.dim);
      this.hits.add(mx, y, lw, 1, () => this.clickRow(idx));
    });
    const it = this.cur();
    v.rect(mx, v.h - 1, lw, 1, th.side);
    v.text(mx + 1, v.h - 1, `${this.items.length} item${this.items.length === 1 ? '' : 's'}` + (it ? `  ·  ${it.name}` : ''), th.dim);
  }
  clickRow(i) {
    const now = Date.now();
    const again = this.last.i === i && now - this.last.t < 450;
    this.sel = i;
    this.last = { t: now, i };
    if (again) this.open();
  }
  key(e) {
    const k = e.key;
    const page = Math.max(1, this.win.h - 6);
    if (k === 'up') this.sel = Math.max(0, this.sel - 1);
    else if (k === 'down') this.sel = Math.min(this.items.length - 1, this.sel + 1);
    else if (k === 'pageup') this.sel = Math.max(0, this.sel - page);
    else if (k === 'pagedown') this.sel = Math.min(this.items.length - 1, this.sel + page);
    else if (k === 'home') this.sel = 0;
    else if (k === 'end') this.sel = Math.max(0, this.items.length - 1);
    else if (k === 'enter' || k === 'right') this.open();
    else if (k === 'backspace' && !e.ctrl) this.up();
    else if (k === 'left') this.up();
    else if (k === 'delete') this.trash();
    else if (!e.ctrl && !e.alt && k === 'n') this.newFolder();
    else if (!e.ctrl && !e.alt && k === 'f') this.newFile();
    else if (!e.ctrl && !e.alt && k === 'r') this.rename();
    else if (!e.ctrl && !e.alt && k === 't') this.trash();
    else if (!e.ctrl && !e.alt && k === 'h') this.goTo(DISK);
    else return false;
    return true;
  }
  mouse(e) {
    if (e.kind === 'wheel') this.scroll = clamp(this.scroll + e.dir * 2, 0, Math.max(0, this.items.length - 1));
    else if (e.kind === 'down' && e.button === 0) this.hits.click(e.x, e.y);
  }
}

export default {
  id: 'finder',
  name: 'Finder',
  desc: 'Browse, make and trash files on your TridOS disk.',
  icon: 'finder',
  size: [76, 22],
  minSize: [50, 10],
  create: (os, win, data) => new Finder(os, win, data),
};
