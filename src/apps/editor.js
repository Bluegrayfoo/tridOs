// Text Editor: plain text and code files on the TridOS disk. Ctrl+S saves.

import fs from 'node:fs';
import path from 'node:path';
import { TextArea } from '../ui.js';
import { DISK, inDisk, freeName, displayPath } from '../fs.js';
import { fit } from '../util.js';
import { markdownLines, textStats, transformText } from './text-tools.js';

class Editor {
  constructor(os, win, data) {
    this.os = os;
    this.preview = false;
    this.previewTop = 0;
    this.win = win;
    this.file = data?.file ? inDisk(data.file) : null;
    const lang = this.langFor(this.file);
    this.ta = new TextArea('', { lang });
    if (this.file) this.load(this.file);
    if (data?.text != null) { this.ta.setText(data.text); this.ta.modified = data.modified === true; }
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
    return { file: this.file, text: this.ta.getText(), modified: this.ta.modified };
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
      if (p == null) return;
      p = p.trim().replace(/^~\/?/, '');
      if (!p) return;
      const abs = inDisk(p);
      if (abs === DISK || (fs.existsSync(abs) && fs.statSync(abs).isDirectory())) return this.os.toast('Give a file name.');
      this.write(abs);
    });
  }
  openPath() {
    this.os.ask('Open', 'Path of a file on the disk:', '~/Documents/', (p) => {
      if (p == null) return;
      p = p.trim().replace(/^~\/?/, '');
      const abs = inDisk(p);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return this.os.toast('There is no such file.');
      this.os.openFile(abs);
    });
  }
  transform(action) {
    this.ta.remember('transform');
    this.ta.lines = transformText(this.ta.getText(), action).split('\n');
    this.ta.cy = Math.min(this.ta.cy, this.ta.lines.length - 1);
    this.ta.cx = Math.min(this.ta.cx, this.ta.lines[this.ta.cy].length);
    this.ta.changed();
  }
  menus() {
    return [
      { title: 'Tools', items: [
        { label: 'Markdown preview (Ctrl+P)', fn: () => this.preview = !this.preview },
        { label: 'Word and character count', fn: () => { const s = textStats(this.ta.getText()); this.os.toast(`${s.words} words, ${s.characters} characters, ${s.lines} lines`); } },
        ...[['Uppercase','upper'],['Lowercase','lower'],['Trim trailing spaces','trim'],['Sort lines','sort'],['Remove duplicate lines','unique']].map(([label, action]) => ({ label, fn: () => this.transform(action) })),
      ] },
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
    if (this.preview) {
      body.fill(th.bg);
      const rows = markdownLines(this.ta.getText(), Math.max(1, v.w - 4));
      this.previewTop = Math.max(0, Math.min(this.previewTop, rows.length - body.h));
      rows.slice(this.previewTop, this.previewTop + body.h).forEach((r, i) => body.text(2, i, r.text, r.kind === 'heading' ? th.accent : ['dim','quote'].includes(r.kind) ? th.dim : th.text));
    } else this.ta.draw(body, th, { focus: focused });
    v.rect(0, v.h - 1, v.w, 1, th.side);
    const status = this.preview ? 'Preview • Ctrl+P edit' : `Ln ${this.ta.cy + 1}, Col ${this.ta.cx + 1}`;
    v.text(1, v.h - 1, status, th.dim);
    v.text(v.w - 1 - Math.min(v.w - 20, 40), v.h - 1, fit(this.file ? displayPath(this.file) : 'Untitled (Ctrl+S to save)', Math.min(v.w - 20, 40)), th.dim);
  }
  key(e) {
    if (e.ctrl && e.key === 'p') return this.preview = !this.preview, true;
    if (this.preview) {
      if (e.key === 'escape') return this.preview = false, true;
      const delta = { up:-1, down:1, pageup:-10, pagedown:10 };
      if (delta[e.key]) { this.previewTop = Math.max(0, this.previewTop + delta[e.key]); return true; }
    }
    if (e.ctrl && e.key === 's') return this.saveFile(), true;
    if (e.ctrl && e.key === 'o') return this.openPath(), true;
    if (this.preview) return false;
    return this.ta.key(e, Math.max(1, this.win.h - 4));
  }
  mouse(e) {
    if (this.preview) { if (e.kind === 'wheel') this.previewTop = Math.max(0, this.previewTop + e.dir * 3); return; }
    if (e.kind === 'wheel') this.ta.wheel(e.dir);
    else if (e.kind === 'down' && e.button === 0 && e.y < this.win.h - 2) this.ta.click(e.x, e.y);
  }
}

export default {
  id: 'editor',
  name: 'Text Editor',
  desc: 'Write text and code, preview Markdown, count words, sort lines and clean up text.',
  icon: 'editor',
  size: [78, 24],
  minSize: [40, 8],
  multi: true,
  create: (os, win, data) => new Editor(os, win, data),
};
