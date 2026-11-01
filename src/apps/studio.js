// Code Studio: write apps for TridOS in JavaScript. Run saves it, checks it, adds it to the Dock and opens it.
// Apps live in ~/.tridos/apps/<name>.js

import fs from 'node:fs';
import path from 'node:path';
import { Hits, TextArea, button } from '../ui.js';
import { APPS_DIR, moveToTrash } from '../fs.js';
import { clamp, fit, len, mix } from '../util.js';

const TEMPLATES = {
  Hello: (name, glyph) => `// A TridOS app. Save it, then press Run: it appears in the Dock.
module.exports = {
  name: '${name}',
  desc: 'My first TridOS app',
  icon: { color: '#ff9f0a', glyph: '${glyph}' },
  size: [44, 12], // window size in cells: columns, rows
  create(os, win) {
    let count = 0;
    return {
      // draw(v) runs whenever the screen is drawn. v is your window: v.w and v.h are its size in cells.
      draw(v, focused) {
        const th = os.th; // theme colours: bg, text, dim, accent, line, ...
        v.fill(th.bg);
        v.text(2, 1, 'Hello from ' + win.def.name + '!', th.text);
        v.text(2, 3, 'Press Enter or click: ' + count, th.accent);
        v.text(2, v.h - 2, 'Edit me in Code Studio.', th.dim);
      },
      key(e) {
        if (e.key === 'enter') count++; // e.key: 'enter', 'a', 'up', ...  (e.ctrl, e.shift too)
      },
      mouse(e) {
        if (e.kind === 'down') count++; // e.kind: down, up, drag, wheel. e.x, e.y: cells in your window
      },
    };
  },
};
`,
  Counter: (name, glyph) => `// Buttons and a saved value. os.ui has button(), Hits (click targets), LineInput and TextArea.
module.exports = {
  name: '${name}',
  desc: 'A counter that remembers its number',
  icon: { color: '#30d158', glyph: '${glyph}' },
  size: [40, 11],
  create(os, win, saved) {
    const { button, Hits } = os.ui;
    const hits = new Hits();
    let n = (saved && saved.n) || 0;
    return {
      save() { return { n }; }, // whatever you return is handed back as "saved" next time
      draw(v) {
        const th = os.th;
        hits.reset();
        v.fill(th.bg);
        v.text(3, 1, 'Counter', th.dim);
        const big = String(n);
        v.text(Math.floor((v.w - big.length) / 2), 3, big, th.accent);
        button(v, hits, 3, 6, ' − ', th, () => n--);
        button(v, hits, 9, 6, ' + ', th, () => n++);
        button(v, hits, 16, 6, 'Reset', th, () => (n = 0), { primary: true });
      },
      key(e) {
        if (e.key === 'up' || e.key === '+') n++;
        if (e.key === 'down' || e.key === '-') n--;
        if (e.key === '0') n = 0;
      },
      mouse(e) {
        if (e.kind === 'down') hits.click(e.x, e.y);
      },
    };
  },
};
`,
  Paint: (name, glyph) => `// Pixel drawing: v.px(x, y, color) draws one pixel of the block-character screen.
// v.pxW and v.pxH are the window's size in pixels. Mouse events give cells, so we also use e.x * v.pw.
module.exports = {
  name: '${name}',
  desc: 'Draw in pixels with the mouse',
  icon: { color: '#bf5af2', glyph: '${glyph}' },
  size: [48, 18],
  create(os, win) {
    const colors = [0xff453a, 0xff9f0a, 0xffd60a, 0x30d158, 0x0a84ff, 0xbf5af2, 0xffffff, 0x000000];
    let color = colors[4];
    const dots = []; // [x, y, color] in pixels
    let last = null;
    return {
      draw(v) {
        v.fill(0x1c1c20);
        for (const [x, y, c] of dots) v.pxRect(x, y, 2, 2, c);
        colors.forEach((c, i) => {
          v.rect(1 + i * 3, 0, 3, 1, c);
          if (c === color) v.text(2 + i * 3, 0, '•', c === 0x000000 || c === 0x0a84ff ? 0xffffff : 0x000000);
        });
        v.text(v.w - 22, v.h - 1, 'c: clear   click: paint', 0x9a9aa6);
      },
      key(e) {
        if (e.key === 'c') dots.length = 0;
      },
      mouse(e) {
        if (e.kind === 'down' && e.y === 0) {
          const i = Math.floor((e.x - 1) / 3);
          if (colors[i] !== undefined) color = colors[i];
          return;
        }
        if (e.kind === 'down' || e.kind === 'drag') {
          const x = e.x * (os.cv.pw), y = e.y * (os.cv.ph);
          dots.push([x, y, color]);
        }
      },
    };
  },
};
`,
};

// (Blank goes last in the New App list so Hello stays the one Enter picks.)
TEMPLATES.Blank = (name, glyph) => `// A blank app: just the frame. Press Run to open it (an empty window), then fill in draw().
// Guide: docs/GUIDE.md in github.com/knittingCat/tridOs
module.exports = {
  name: '${name}',
  desc: 'What it does, in one line',
  version: '1.0.0',
  icon: { color: '#8e8e93', glyph: '${glyph}' },
  size: [40, 12], // window size in cells: columns, rows
  create(os, win, saved) {
    return {
      draw(v, focused) {
        v.fill(os.th.bg);
      },
    };
  },
};
`;

const DOCS = [
  'The full documentation is on GitHub: github.com/knittingCat/tridOs',
  '  README.md: everything about TridOS.   docs/GUIDE.md: the guide for JavaScript people.',
  '',
  'TridOS app reference (the short version)',
  '',
  'An app is a file that sets module.exports to an object:',
  '  name, desc, icon: { color, glyph }, size: [cols, rows], create(os, win, saved)',
  'create() returns your app: an object with any of these functions:',
  '  draw(v, focused)   draw into your window (called every frame that changes)',
  '  key(e)             a key: e.key, e.ctrl, e.alt, e.shift, e.text (typed character)',
  '  mouse(e)           e.kind (down, up, drag, wheel), e.x, e.y in cells, e.button, e.dir',
  '  tick(dt)           every frame; return true to redraw (animations)',
  '  save()             return a value to keep between sessions (handed back as "saved")',
  '  title(), menus(), close(), dirty()   optional',
  'v (your window):',
  '  v.w, v.h           size in cells         v.pxW, v.pxH  size in pixels',
  '  v.fill(c), v.rect(x, y, w, h, c)         cells filled with colour c (0xRRGGBB)',
  '  v.text(x, y, str, fg, bg?)               write text (one cell per character)',
  '  v.px(x, y, c), v.pxRect(x, y, w, h, c), v.pxLine(x0, y0, x1, y1, c)   pixels',
  '  v.hover(x, y, w, h)                      is the pointer over this area?',
  'os: os.th (theme colours), os.toast(msg), os.dialog(...), os.ask(...),',
  '  os.launch(appId), os.ui (button, Hits, LineInput, TextArea), os.settings',
  'Colours are numbers like 0xff9f0a, or use os.util.mix(a, b, 0.5).',
  'Run saves the file, checks it, puts the app in the Dock and opens it.',
];

class Studio {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.hits = new Hits();
    this.ta = new TextArea('', { lang: 'js' });
    this.file = null;
    this.focus = 'editor';
    this.sel = 0;
    this.console = [{ t: 'Welcome to Code Studio. New makes an app from a template; Run puts it in the Dock.', k: 'dim' }];
    this.showDocs = false;
    this.files = [];
    this.refreshFiles();
    const want = data?.file || this.files[0];
    if (want) this.open(want);
  }
  save() {
    return { file: this.file };
  }
  title() {
    return 'Code Studio' + (this.file ? ' — ' + this.file : '') + (this.ta.modified ? ' •' : '');
  }
  dirty() {
    return this.ta.modified;
  }
  log(t, k = '') {
    this.console.push({ t, k });
    if (this.console.length > 200) this.console.shift();
    this.showDocs = false;
  }
  refreshFiles() {
    try {
      this.files = fs.readdirSync(APPS_DIR).filter((f) => f.endsWith('.js')).sort();
    } catch {
      this.files = [];
    }
  }
  open(file) {
    try {
      this.ta.setText(fs.readFileSync(path.join(APPS_DIR, file), 'utf8'));
      this.file = file;
      this.sel = Math.max(0, this.files.indexOf(file));
      this.focus = 'editor';
    } catch (e) {
      this.log(`Could not open ${file}: ${e.message}`, 'err');
    }
  }
  guardUnsaved(then) {
    if (!this.ta.modified) return then();
    this.os.dialog({
      title: 'Unsaved changes',
      message: `Save ${this.file} first?`,
      buttons: [{ label: 'Cancel', cancel: true }, { label: "Don't Save" }, { label: 'Save', primary: true }],
      onDone: (i) => {
        if (i === 2) {
          this.saveFile();
          then();
        } else if (i === 1) then();
      },
    });
  }
  saveFile() {
    if (!this.file) return false;
    try {
      fs.mkdirSync(APPS_DIR, { recursive: true });
      fs.writeFileSync(path.join(APPS_DIR, this.file), this.ta.getText());
      this.ta.modified = false;
      return true;
    } catch (e) {
      this.log(`Could not save: ${e.message}`, 'err');
      return false;
    }
  }
  newApp() {
    this.os.dialog({
      title: 'New App',
      message: 'Start from a template:',
      buttons: [{ label: 'Cancel', cancel: true }, ...Object.keys(TEMPLATES).map((n, i) => ({ label: n, primary: i === 0 }))],
      onDone: (i) => {
        if (i < 1) return;
        const tpl = Object.keys(TEMPLATES)[i - 1];
        this.os.ask('New App', 'Name your app:', 'My App', (name) => {
          name = name.trim();
          if (!name) return;
          const file = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.js';
          if (!file || file === '.js') return this.log('Use letters or numbers in the name.', 'err');
          const p = path.join(APPS_DIR, file);
          if (fs.existsSync(p)) return this.log(`${file} already exists.`, 'err');
          const clean = name.replace(/['\\\\]/g, '');
          fs.mkdirSync(APPS_DIR, { recursive: true });
          fs.writeFileSync(p, TEMPLATES[tpl](clean, clean[0].toUpperCase()));
          this.refreshFiles();
          this.open(file);
          this.log(`Made ${file} from the ${tpl} template. Press Run.`, 'ok');
        });
      },
    });
  }
  run() {
    if (!this.file) return this.log('Make or open an app first.', 'err');
    if (!this.saveFile()) return;
    const id = 'user:' + this.file;
    for (const w of this.os.windows.filter((w) => w.def.id === id)) this.os.closeWindow(w);
    this.os.reloadUserApps();
    const def = this.os.userApps[id];
    if (!def || def.broken) return this.log(`Error: ${def ? def.broken : 'could not load'}`, 'err');
    this.os.install(id);
    const w = this.os.launch(id);
    if (w) this.log(`Running ${def.name}. It is in the Dock now.`, 'ok');
    else this.log(`${def.name} would not start (see the notice).`, 'err');
  }
  remove() {
    if (!this.file) return;
    const f = this.file;
    this.os.confirm('Delete App', `Delete ${f}? It goes to the Trash.`, 'Delete', () => {
      const id = 'user:' + f;
      this.os.uninstall(id);
      try {
        moveToTrash(path.join(APPS_DIR, f));
      } catch (e) {
        this.log(e.message, 'err');
      }
      this.os.reloadUserApps();
      this.refreshFiles();
      this.file = null;
      this.ta.setText('');
      if (this.files[0]) this.open(this.files[0]);
      this.os.changed();
    }, true);
  }
  menus() {
    return [
      {
        title: 'File',
        items: [
          { label: 'New App…', fn: () => this.newApp() },
          { label: 'Save', fn: () => this.saveFile() && this.log(`Saved ${this.file}`, 'ok') },
          { label: 'Delete App…', fn: () => this.remove() },
        ],
      },
      { title: 'Run', items: [{ label: 'Run', fn: () => this.run() }, { label: 'Show Reference', fn: () => (this.showDocs = !this.showDocs) }] },
    ];
  }
  draw(v, focused) {
    const th = this.os.th;
    this.hits.reset();
    const SIDE = 22;
    v.fill(th.bg);
    v.rect(0, 0, SIDE, v.h, th.side);
    v.text(2, 0, 'My Apps', th.dim);
    this.files.slice(0, v.h - 5).forEach((f, i) => {
      const y = 1 + i;
      const on = f === this.file;
      if (on) v.rect(0, y, SIDE, 1, this.focus === 'list' ? th.accent : th.sel);
      v.text(2, y, fit(f.replace(/\.js$/, ''), SIDE - 3), on && this.focus === 'list' ? 0xffffff : th.text);
      this.hits.add(0, y, SIDE, 1, () => this.guardUnsaved(() => this.open(f)));
    });
    if (!this.files.length) v.text(2, 2, 'No apps yet.', th.dim);
    button(v, this.hits, 1, v.h - 2, '＋ New App', th, () => this.newApp(), { primary: true, width: SIDE - 2 });
    // toolbar
    const x0 = SIDE + 1;
    let x = x0;
    x += button(v, this.hits, x, 0, '▶ Run', th, () => this.run(), { primary: true }) + 1;
    x += button(v, this.hits, x, 0, 'Save', th, () => this.file && this.saveFile() && this.log(`Saved ${this.file}`, 'ok')) + 1;
    x += button(v, this.hits, x, 0, 'Reference', th, () => (this.showDocs = !this.showDocs), { active: this.showDocs }) + 1;
    x += button(v, this.hits, x, 0, 'Delete', th, () => this.remove()) + 1;
    // editor and console
    const conH = this.showDocs ? Math.max(8, Math.floor(v.h * 0.7)) : Math.max(5, Math.floor(v.h * 0.3)); // the Reference gets more room
    const edH = v.h - 1 - conH;
    const ed = v.sub(SIDE, 1, v.w - SIDE, edH);
    this.edView = ed;
    if (this.file) this.ta.draw(ed, th, { focus: focused && this.focus === 'editor' });
    else {
      ed.fill(th.field);
      ed.text(2, 2, 'Make an app with “New App”, or pick one on the left.', th.dim);
    }
    const cv_ = v.sub(SIDE, 1 + edH, v.w - SIDE, conH);
    cv_.fill(th.side);
    cv_.text(1, 0, this.showDocs ? ' Reference ' : ' Console ', th.dim);
    const rows = cv_.h - 1;
    const lines = this.showDocs ? DOCS.map((t) => ({ t })) : this.console;
    const tail = this.showDocs ? lines.slice(0, rows) : lines.slice(-rows);
    tail.forEach((l, i) => cv_.text(1, 1 + i, fit(l.t, cv_.w - 2), l.k === 'err' ? th.danger : l.k === 'ok' ? th.ok : l.k === 'dim' ? th.dim : th.text));
    this.conH = conH;
  }
  key(e) {
    if (e.ctrl && e.key === 's') return this.saveFile() && this.log(`Saved ${this.file}`, 'ok'), true;
    if (e.ctrl && e.key === 'r') return this.run(), true;
    if (e.ctrl && e.key === 'b') return (this.focus = this.focus === 'list' ? 'editor' : 'list'), true;
    if (e.ctrl && e.key === 'n') return this.newApp(), true;
    if (this.focus === 'list') {
      if (e.key === 'up') this.sel = Math.max(0, this.sel - 1);
      else if (e.key === 'down') this.sel = Math.min(this.files.length - 1, this.sel + 1);
      else if (e.key === 'enter' || e.key === 'right') this.guardUnsaved(() => this.files[this.sel] && this.open(this.files[this.sel]));
      else return false;
      return true;
    }
    if (!this.file) return false;
    return this.ta.key(e, Math.max(1, this.win.h - 8));
  }
  mouse(e) {
    if (e.kind === 'wheel') {
      if (e.x >= 22 && this.file) this.ta.wheel(e.dir);
      return;
    }
    if (e.kind !== 'down' || e.button !== 0) return;
    if (this.hits.click(e.x, e.y)) return;
    if (e.x >= 22 && e.y >= 1 && e.y < this.win.h - 1 - this.conH && this.file) {
      this.focus = 'editor';
      this.ta.click(e.x - 22, e.y - 1);
    }
  }
}

export default {
  id: 'studio',
  name: 'Code Studio',
  desc: 'Write your own apps for TridOS in JavaScript and run them here.',
  icon: 'studio',
  size: [96, 28],
  minSize: [60, 14],
  create: (os, win, data) => new Studio(os, win, data),
};
