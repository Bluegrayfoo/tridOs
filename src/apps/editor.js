// Text Editor: plain text and code files on the TridOS disk. Ctrl+S saves.

import fs from 'node:fs';
import path from 'node:path';
import { TextArea } from '../ui.js';
import { DISK, inDisk, freeName, displayPath } from '../fs.js';
import { fit } from '../util.js';

class Editor {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.file = data?.file ? inDisk(data.file) : null;
    const lang = this.langFor(this.file);
    this.ta = new TextArea('', { lang });
    if (this.file) this.load(this.file);
    if (data?.text != null) this.ta.setText(data.text);
  }
  langFor(f) {
    return f && /\.(js|mjs|cjs|json|ts)$/.test(f) ? 'js' : '';
  }
  load(f) {
    try {
      this.ta.setText(fs.readFileSync(f, 'utf8'));
      this.file = f;
      this.ta.lang = this.langFor(f);
    } catch (e) {
      this.os.toast(`Could not open it: ${e.message}`);
    }
  }
  save() {
    return { file: this.file };
  }
  dirty() {
    return this.ta.modified;
  }
  title() {
    return (this.file ? path.basename(this.file) : 'Untitled') + (this.ta.modified ? ' •' : '');
  }
  write(f) {
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, this.ta.getText());
      this.file = f;
      this.ta.modified = false;
      this.ta.lang = this.langFor(f);
      this.os.toast(`Saved ${path.basename(f)}`);
    } catch (e) {
      this.os.toast(`Could not save: ${e.message}`);
    }
  }
  saveFile() {
    if (this.file) this.write(this.file);
    else this.saveAs();
  }
  saveAs() {
    const start = this.file ? displayPath(this.file) : '~/Documents/' + freeName(path.join(DISK, 'Documents'), 'untitled', '.txt');
    this.os.ask('Save As', 'Where to save it (a path on the disk, ~ is the top):', start, (p) => {
      p = p.trim().replace(/^~\/?/, '');
      if (!p) return;
      const abs = inDisk(p);
      if (abs === DISK || (fs.existsSync(abs) && fs.statSync(abs).isDirectory())) return this.os.toast('Give a file name.');
      this.write(abs);
    });
  }
  openPath() {
    this.os.ask('Open', 'Path of a file on the disk:', '~/Documents/', (p) => {
      p = p.trim().replace(/^~\/?/, '');
      const abs = inDisk(p);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return this.os.toast('There is no such file.');
      this.os.openFile(abs);
    });
  }
  menus() {
    return [
      {
        title: 'File',
        items: [
          { label: 'New', fn: () => this.os.launch('editor') },
          { label: 'Open…', fn: () => this.openPath() },
          { sep: true },
          { label: 'Save', fn: () => this.saveFile() },
          { label: 'Save As…', fn: () => this.saveAs() },
        ],
      },
      {
        title: 'Edit',
        items: [
          { label: 'Undo', fn: () => this.ta.undo() },
          { label: 'Redo', fn: () => this.ta.redo() },
          { label: 'Delete Line', fn: () => this.ta.key({ key: 'd', ctrl: true }) },
        ],
      },
    ];
  }
  draw(v, focused) {
    const th = this.os.th;
    const body = v.sub(0, 0, v.w, v.h - 1);
    this.view = body;
    this.ta.draw(body, th, { focus: focused });
    v.rect(0, v.h - 1, v.w, 1, th.side);
    const status = `Ln ${this.ta.cy + 1}, Col ${this.ta.cx + 1}`;
    v.text(1, v.h - 1, status, th.dim);
    v.text(v.w - 1 - Math.min(v.w - 20, 40), v.h - 1, fit(this.file ? displayPath(this.file) : 'Untitled (Ctrl+S to save)', Math.min(v.w - 20, 40)), th.dim);
  }
  key(e) {
    if (e.ctrl && e.key === 's') return this.saveFile(), true;
    if (e.ctrl && e.key === 'o') return this.openPath(), true;
    return this.ta.key(e, Math.max(1, this.win.h - 4));
  }
  mouse(e) {
    if (e.kind === 'wheel') this.ta.wheel(e.dir);
    else if (e.kind === 'down' && e.button === 0 && e.y < this.win.h - 2) this.ta.click(e.x, e.y);
  }
}

export default {
  id: 'editor',
  name: 'Text Editor',
  desc: 'Write and edit plain text and code files.',
  icon: 'editor',
  size: [78, 24],
  minSize: [40, 8],
  multi: true,
  create: (os, win, data) => new Editor(os, win, data),
};
