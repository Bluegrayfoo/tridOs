// The desktop itself: windows, the menu bar, the dock, desktop icons, dialogs, keyboard navigation, saved state.

import fs from 'node:fs';
import path from 'node:path';
import osmod from 'node:os';
import { Canvas, Renderer, MODES } from './gfx.js';
import { View, Hits, button, LineInput, TextArea } from './ui.js';
import { makeTheme, wallpaper, pixelText, pixelTextWidth, FONT_H } from './theme.js';
import { drawIcon } from './icons.js';
import { clamp, len, fit, mix, pad, lighten, darken } from './util.js';
import { DEFAULT_SETTINGS, ensureDirs, loadState, saveState, DISK, APPS_DIR, COMMUNITY_DIR, listDir, inDisk } from './fs.js';
import { sha256, scanSource } from './pack.js';
import { osFacade, winFacade, HIDDEN_GLOBALS } from './sandbox.js';
import { loadBuiltinApps } from './apps/index.js';

const MIN_COLS = 80; // the smallest desktop, in text cells
const MIN_ROWS = 24;
const DOCK_PX = { small: 36, medium: 52, large: 68 }; // Dock icon size in pixels (at text scale 1; larger text scales it)
const MENU_ROW = 0;
const WANT_COLS = 96; // "Auto" text size: the biggest text that still leaves at least this much room
const WANT_ROWS = 28;

export class OS {
  // cols, rows: the terminal's size in character cells. settings: overrides (tests).
  constructor({ term = null, cols = 400, rows = 110, settings = {} } = {}) {
    this.term = term;
    ensureDirs();
    const st = loadState();
    this.firstRun = Object.keys(st).length === 0;
    this.settings = { ...DEFAULT_SETTINGS, ...(st.settings || {}), ...settings };
    this.ptr = { x: -100, y: -100 }; // the pointer in pixels
    this.installed = Array.isArray(st.installed) && st.installed.length ? st.installed : ['appstore'];
    if (!this.installed.includes('appstore')) this.installed.unshift('appstore');
    this.savedWindows = Array.isArray(st.windows) ? st.windows : [];
    this.th = makeTheme(this.settings);
    this.mouse = { x: -1, y: -1 };
    this.windows = [];
    this.seq = 0;
    this.drag = null;
    this.capture = null;
    this.menu = null; // { idx, item } while a menu is open
    this.nav = null; // keyboard navigation: { zone, idx, item }
    this.modal = null;
    this.toasts = [];
    this.lastClick = { t: 0, x: -1, y: -1, what: '' };
    this.desk = { sel: -1, files: [], at: 0 };
    this.hover = null;
    this.stateDirty = false;
    this.saveAt = 0;
    this.dirty = true;
    this.boot = null;
    this.quitting = null;
    this.userApps = {};
    this.ui = { button, Hits, LineInput, TextArea, View }; // for apps made in Code Studio
    this.util = { mix, clamp, lighten, darken, fit, len };
    this.builtin = loadBuiltinApps();
    this.truecolor = this.detectTruecolor();
    this.renderer = new Renderer({ truecolor: this.truecolor });
    this.cv = new Canvas(cols, rows, this.settings.pixelMode, 1);
    this.wp = null;
    this.hits = new Hits();
    this.dockLayout = [];
    this.menuLayout = [];
    this.lastMinute = -1;
    this.reloadUserApps();
    this.sizeChanged(cols, rows);
  }

  // ---------- environment ----------
  detectTruecolor() {
    const m = this.settings.colorMode;
    if (m === 'truecolor') return true;
    if (m === '256') return false;
    const e = process.env;
    if (/truecolor|24bit/i.test(e.COLORTERM || '')) return true;
    if (['iTerm.app', 'WezTerm', 'vscode', 'ghostty', 'kitty'].includes(e.TERM_PROGRAM || '')) return true;
    if (/kitty|ghostty|alacritty/.test(e.TERM || '')) return true;
    if (e.TERM_PROGRAM === 'Apple_Terminal') return process.platform === 'darwin' && parseInt(osmod.release(), 10) >= 25; // macOS 26 and newer
    return false;
  }

  // The text scale to use for a terminal of this many pixels: the one in Settings, or for Auto the biggest that leaves room.
  pickScale(W, H) {
    const fits = (s) => Math.floor(W / (6 * s)) >= WANT_COLS && Math.floor(H / (10 * s)) >= WANT_ROWS;
    const want = Number(this.settings.textScale) || 0;
    if (want) {
      for (let s = want; s > 1; s--) if (Math.floor(W / (6 * s)) >= MIN_COLS && Math.floor(H / (10 * s)) >= MIN_ROWS) return s;
      return 1;
    }
    for (let s = 4; s > 1; s--) if (fits(s)) return s;
    return 1;
  }

  // The terminal is tcols x trows characters. (Each is a few pixels; the text cells apps lay out in are bigger.)
  sizeChanged(tcols, trows) {
    this.cv.setMode(this.settings.pixelMode);
    const m = MODES[this.cv.mode];
    this.cv.setScale(this.pickScale(tcols * m.pw, trows * m.ph));
    this.cv.resize(tcols, trows);
    this.wp = wallpaper(this.settings.wallpaper, this.cv.W, this.cv.H);
    this.renderer.invalidate();
    for (const w of this.windows) this.clampWindow(w);
    this.dirty = true;
  }

  applySettings() {
    this.th = makeTheme(this.settings);
    this.truecolor = this.detectTruecolor();
    this.renderer.truecolor = this.truecolor;
    this.sizeChanged(this.cv.tcols, this.cv.trows);
    this.changed();
  }

  // Alt + / Alt - and the Apple menu: bigger or smaller text.
  bumpText(delta) {
    const cur = this.cv.scale;
    this.settings.textScale = clamp(cur + delta, 1, 4);
    this.applySettings();
    this.toast(`Text size ${this.cv.scale}x` + (this.cv.scale !== this.settings.textScale ? ' (the biggest that fits)' : ''));
  }

  changed() {
    this.stateDirty = true;
    this.dirty = true;
  }

  // ---------- apps ----------
  get apps() {
    return { ...this.builtin, ...this.userApps };
  }
  appDef(id) {
    return this.builtin[id] || this.userApps[id] || null;
  }
  isInstalled(id) {
    return this.installed.includes(id);
  }
  install(id) {
    if (!this.appDef(id) || this.isInstalled(id)) return;
    this.installed.push(id);
    this.changed();
  }
  uninstall(id) {
    if (id === 'appstore') return;
    for (const w of this.windows.filter((w) => w.def.id === id)) this.closeWindow(w);
    this.installed = this.installed.filter((x) => x !== id);
    this.changed();
  }
  // Apps written in Code Studio live in ~/.tridos/apps/*.js
  // Your own apps (Code Studio) live in ~/.tridos/apps/*.js; apps from other people in ~/.tridos/apps/community/ with a .json beside each.
  reloadUserApps() {
    const next = {};
    const scan = (dir, prefix, external) => {
      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
      } catch {}
      for (const f of files) {
        const id = prefix + f;
        let meta = null;
        let code = '';
        try {
          code = fs.readFileSync(path.join(dir, f), 'utf8');
          if (external) meta = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.js$/, '.json')), 'utf8'));
        } catch {}
        const r = this.compileUserApp(id, f, code, external ? { external: true, meta } : {});
        next[id] = r.def || { id, name: meta?.name || f.replace(/\.js$/, ''), desc: 'This app has an error: ' + r.error, icon: { color: 0x8a8a93, glyph: '!' }, size: [50, 12], user: !external, external, author: meta?.author || '', broken: r.error, file: f, create: () => brokenApp(r.error) };
      }
    };
    scan(APPS_DIR, 'user:', false);
    scan(COMMUNITY_DIR, 'community:', true);
    this.userApps = next;
    this.installed = this.installed.filter((id) => !/^(user|community):/.test(id) || next[id]);
  }
  // Compile an app's source. An app from someone else (external) is checked against its recorded checksum and the list of things apps
  // may not use, gets no require/process/eval, and is handed a small fenced `os` and `win` (see sandbox.js).
  compileUserApp(id, file, code, { external = false, meta = null } = {}) {
    try {
      if (external) {
        if (!meta || meta.sha256 !== sha256(code)) throw new Error('This app was changed after it was installed, so TridOS will not run it. Remove it and install it again.');
        const bad = scanSource(code);
        if (bad.length) throw new Error(`It uses ${bad[0].what} (line ${bad[0].line}), which apps from other people may not.`);
      }
      const mod = { exports: {} };
      const real = (m) => {
        if (!external && ['fs', 'path', 'os', 'child_process', 'node:fs', 'node:path', 'node:os', 'node:child_process'].includes(m)) return require_(m);
        throw new Error(`require('${m}') is not available in TridOS apps`);
      };
      if (external) new Function('module', 'exports', ...HIDDEN_GLOBALS, code)(mod, mod.exports);
      else new Function('module', 'exports', 'require', code)(mod, mod.exports, real);
      const d = mod.exports;
      if (!d || typeof d.create !== 'function') throw new Error('module.exports needs a create(os, win) function');
      const create = external ? (os, win, saved) => d.create(osFacade(os), winFacade(win), saved) : d.create;
      return {
        def: {
          id,
          user: !external,
          external,
          file,
          name: String(external && meta?.name ? meta.name : d.name || file.replace(/\.js$/, '')),
          desc: String(external && meta?.desc ? meta.desc : d.desc || 'An app made in Code Studio'),
          icon: external && meta?.icon ? meta.icon : d.icon || { color: 0x5b8def, glyph: String(d.name || file)[0] },
          version: String((external ? meta?.version : d.version) || '1.0.0'),
          author: external ? String(meta?.author || '') : '',
          source: external ? String(meta?.source || '') : '',
          size: Array.isArray(d.size) ? d.size : [50, 14],
          create,
        },
      };
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  }

  // Put an app from a package on this computer (after the person saw its source). Returns its definition.
  installPackage(pkg, source = '') {
    const bad = scanSource(pkg.code);
    if (bad.length) throw new Error(`It uses ${bad[0].what} (line ${bad[0].line}), which apps from other people may not.`);
    const id = 'community:' + pkg.id + '.js';
    for (const w of this.windows.filter((w) => w.def.id === id)) this.closeWindow(w, true);
    fs.mkdirSync(COMMUNITY_DIR, { recursive: true });
    const js = path.join(COMMUNITY_DIR, pkg.id + '.js');
    const meta = path.join(COMMUNITY_DIR, pkg.id + '.json');
    fs.writeFileSync(js, pkg.code);
    fs.writeFileSync(meta, JSON.stringify({ id: pkg.id, name: pkg.name, desc: pkg.desc, version: pkg.version, author: pkg.author, icon: pkg.icon, sha256: pkg.sha256, source, installedAt: new Date().toISOString() }, null, 2));
    this.reloadUserApps();
    const def = this.userApps[id];
    if (!def || def.broken) {
      const why = def?.broken || 'it would not load';
      fs.rmSync(js, { force: true });
      fs.rmSync(meta, { force: true });
      this.reloadUserApps();
      throw new Error(why);
    }
    this.install(id);
    return def;
  }
  removeCommunityApp(id) {
    const def = this.userApps[id];
    if (!def || !def.external) return;
    this.uninstall(id);
    fs.rmSync(path.join(COMMUNITY_DIR, def.file), { force: true });
    fs.rmSync(path.join(COMMUNITY_DIR, def.file.replace(/\.js$/, '.json')), { force: true });
    this.reloadUserApps();
    this.changed();
  }

  // Open an app (or bring its window forward). data is handed to the app's create().
  launch(id, data = null) {
    const def = this.appDef(id);
    if (!def) return null;
    const existing = this.windows.find((w) => w.def.id === id);
    if (existing && !def.multi) {
      this.focusWindow(existing);
      return existing;
    }
    return this.openWindow(def, data);
  }

  openWindow(def, data = null, geo = null) {
    const [cw, ch] = def.size || [60, 18];
    const rect = this.workArea();
    const w = clamp(geo?.w ?? cw, def.minSize?.[0] ?? 24, rect.w);
    const h = clamp(geo?.h ?? ch + 1, (def.minSize?.[1] ?? 6) + 1, rect.h);
    const n = this.windows.length;
    const win = {
      id: ++this.seq,
      def,
      x: geo?.x ?? clamp(Math.floor((this.cv.cols - w) / 2) + ((n * 3) % 15) - 6, 0, Math.max(0, this.cv.cols - w)),
      y: geo?.y ?? clamp(rect.y + 1 + (n % 5), rect.y, Math.max(rect.y, rect.y + rect.h - h)),
      w,
      h,
      minimized: !!geo?.minimized,
      zoom: geo?.zoom || null,
      app: null,
    };
    try {
      win.app = def.create(this, win, data);
    } catch (e) {
      this.toast(`${def.name} could not start: ${e.message}`);
      return null;
    }
    this.windows.push(win);
    this.clampWindow(win);
    this.focusWindow(win);
    this.changed();
    return win;
  }
  // The Dock's size and place, in pixels.
  dockMetrics(n = this.dockItems().length) {
    const cv = this.cv;
    const S = Math.round((DOCK_PX[this.settings.dockSize] || DOCK_PX.medium) * (0.5 + cv.scale / 2));
    const pad = Math.round(S * 0.16);
    const gap = Math.round(S * 0.16);
    const w = n * S + Math.max(0, n - 1) * gap + 2 * pad;
    const h = S + 2 * pad + Math.max(4, Math.round(S * 0.12));
    const margin = Math.round(cv.ph * 0.5);
    return { S, pad, gap, w, h, x: Math.floor((cv.W - w) / 2), y: cv.H - h - margin };
  }
  workArea() {
    const dockTop = Math.floor(this.dockMetrics().y / this.cv.ph);
    return { x: 0, y: 1, w: this.cv.cols, h: Math.max(8, dockTop - 2) };
  }
  clampWindow(w) {
    w.w = clamp(w.w, 10, this.cv.cols);
    w.h = clamp(w.h, 4, this.cv.rows - 1);
    w.x = clamp(w.x, -(w.w - 8), this.cv.cols - 8);
    w.y = clamp(w.y, 1, this.cv.rows - 2);
  }
  focusWindow(win) {
    if (win.minimized) win.minimized = false;
    const i = this.windows.indexOf(win);
    if (i >= 0) {
      this.windows.splice(i, 1);
      this.windows.push(win);
    }
    this.menu = null;
    this.dirty = true;
    this.stateDirty = true;
  }
  get focused() {
    for (let i = this.windows.length - 1; i >= 0; i--) if (!this.windows[i].minimized) return this.windows[i];
    return null;
  }
  closeWindow(win, force = false) {
    if (!force && win.app?.dirty?.()) {
      this.focusWindow(win);
      this.dialog({
        title: 'Unsaved changes',
        message: `${win.app.title?.().replace(/ •$/, '') || win.def.name} has changes that are not saved.`,
        buttons: [{ label: 'Cancel', cancel: true }, { label: 'Close Anyway', danger: true }],
        onDone: (i) => i === 1 && this.closeWindow(win, true),
      });
      return;
    }
    try {
      win.app?.close?.();
    } catch {}
    this.windows = this.windows.filter((w) => w !== win);
    this.changed();
  }
  minimizeWindow(win) {
    win.minimized = true;
    this.changed();
  }
  toggleZoom(win) {
    if (win.zoom) {
      Object.assign(win, win.zoom);
      win.zoom = null;
    } else {
      win.zoom = { x: win.x, y: win.y, w: win.w, h: win.h };
      const a = this.workArea();
      Object.assign(win, { x: a.x, y: a.y, w: a.w, h: a.h });
    }
    this.changed();
  }
  contentView(win) {
    return new View(this.cv, win.x, win.y + 1, win.w, win.h - 1, this.mouse);
  }

  // ---------- notices and dialogs ----------
  toast(msg, ms = 2800) {
    this.toasts.push({ msg: String(msg), until: Date.now() + ms });
    this.dirty = true;
  }
  // { title, message, input: { value, mask }, buttons: [{ label, primary, cancel }], onDone(index, text) }
  dialog(opts) {
    this.modal = {
      title: opts.title || '',
      message: opts.message || '',
      input: opts.input ? { value: opts.input.value || '', mask: !!opts.input.mask, li: null } : null,
      buttons: opts.buttons || [{ label: 'OK', primary: true }],
      onDone: opts.onDone || (() => {}),
      sel: Math.max(0, (opts.buttons || [{ primary: true }]).findIndex((b) => b.primary)),
      hits: new Hits(),
    };
    this.menu = null;
    this.nav = null;
    this.dirty = true;
    return this.modal;
  }
  closeModal(index) {
    const m = this.modal;
    if (!m) return;
    this.modal = null;
    this.dirty = true;
    m.onDone(index, m.input ? m.input.li.text : '');
  }
  ask(title, message, value, cb) {
    this.dialog({
      title,
      message,
      input: { value },
      buttons: [{ label: 'Cancel', cancel: true }, { label: 'OK', primary: true }],
      onDone: (i, text) => i === 1 && cb(text),
    });
  }
  confirm(title, message, okLabel, cb, danger = false) {
    this.dialog({
      title,
      message,
      buttons: [{ label: 'Cancel', cancel: true }, { label: okLabel, primary: true, danger }],
      onDone: (i) => i === 1 && cb(),
    });
  }

  // ---------- files ----------
  openFile(p) {
    const abs = inDisk(p);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return this.toast('That file is gone.');
    }
    if (st.isDirectory()) {
      if (!this.isInstalled('finder')) return this.toast('Get Finder from the App Store to browse folders.');
      const w = this.launch('finder', { path: abs });
      w?.app?.goTo?.(abs);
      return;
    }
    if (abs.endsWith('.tridapp')) {
      if (!this.isInstalled('distributor')) return this.toast('Get App Distributor from the App Store to install this app.');
      const w = this.launch('distributor', { tab: 'get' });
      w?.app?.importFile?.(abs);
      return;
    }
    if (abs.endsWith('.js') && abs.startsWith(APPS_DIR)) {
      if (this.isInstalled('studio')) return void this.launch('studio', { file: path.basename(abs) });
    }
    if (!this.isInstalled('editor')) return this.toast('Get Text Editor from the App Store to open files.');
    const same = this.windows.find((w) => w.def.id === 'editor' && w.app.file === abs);
    if (same) return this.focusWindow(same);
    this.launch('editor', { file: abs });
  }

  // ---------- saving ----------
  snapshotState() {
    return {
      version: 1,
      settings: this.settings,
      installed: this.installed,
      windows: this.windows.map((w) => ({
        app: w.def.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minimized: w.minimized,
        zoom: w.zoom,
        data: (() => {
          try {
            return w.app?.save?.() ?? null;
          } catch {
            return null;
          }
        })(),
      })),
    };
  }
  saveNow() {
    saveState(this.snapshotState());
    this.stateDirty = false;
  }
  restoreWindows() {
    for (const s of this.savedWindows) {
      const def = this.appDef(s.app);
      if (!def || !(this.isInstalled(def.id) || def.system)) continue;
      this.openWindow(def, s.data ?? null, { x: s.x, y: s.y, w: s.w, h: s.h, minimized: s.minimized, zoom: s.zoom });
    }
    this.savedWindows = [];
  }

  // ---------- lifecycle ----------
  start() {
    this.restoreWindows();
    if (this.firstRun && !this.windows.length) {
      this.launch('appstore'); // a fresh TridOS has just the App Store: open it so there is something to do
      this.toast('Welcome to TridOS! Get apps from the App Store.', 5000);
    }
    if (this.settings.boot) this.boot = { t: 0, len: 1.5 };
    this.last = Date.now();
    this.timer = setInterval(() => this.frame(), 33);
    this.dirty = true;
  }
  shutdown() {
    if (this.quitting) return;
    this.saveNow();
    this.quitting = { t: 0 };
    this.dirty = true;
  }
  finish() {
    clearInterval(this.timer);
    for (const w of this.windows) {
      try {
        w.app?.close?.();
      } catch {}
    }
    this.saveNow();
    this.term?.stop();
    process.exit(0);
  }
  frame() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.last) / 1000);
    this.last = now;
    if (this.boot) {
      this.boot.t += dt;
      this.dirty = true;
      if (this.boot.t >= this.boot.len) this.boot = null;
    }
    if (this.quitting) {
      this.quitting.t += dt;
      this.dirty = true;
      if (this.quitting.t > 0.9) return this.finish();
    }
    for (const w of this.windows) {
      try {
        if (w.app?.tick?.(dt, w === this.focused)) this.dirty = true;
      } catch {}
    }
    if (this.toasts.length) {
      const n = this.toasts.length;
      this.toasts = this.toasts.filter((t) => t.until > now);
      if (this.toasts.length !== n) this.dirty = true;
    }
    const d = new Date();
    const stamp = this.settings.showSeconds ? d.getSeconds() + d.getMinutes() * 60 : d.getMinutes();
    if (stamp !== this.lastMinute) {
      this.lastMinute = stamp;
      this.dirty = true;
    }
    if (this.stateDirty && now - this.saveAt > 2000) {
      this.saveAt = now;
      this.saveNow();
    }
    if (this.dirty) this.render();
  }
  render() {
    this.dirty = false;
    this.draw();
    const out = this.renderer.flush(this.cv);
    if (this.term) this.term.write(out);
    else this.lastOutput = out;
  }

  // ---------- drawing ----------
  draw() {
    const cv = this.cv;
    cv.pix.set(this.wp);
    cv.tch.fill('');
    if (cv.cols < MIN_COLS || cv.rows < MIN_ROWS) return this.drawTooSmall();
    if (this.quitting) return this.drawSplash('Shutting down', Math.min(1, this.quitting.t / 0.8), true);
    if (this.boot) return this.drawSplash('TridOS', this.boot.t / this.boot.len, false);
    this.hits.reset();
    this.drawDesktopIcons();
    for (const w of this.windows) if (!w.minimized) this.drawWindow(w);
    this.drawMenuBar();
    this.drawDock();
    this.drawMenuDropdown();
    this.drawToasts();
    this.drawModal();
    this.drawCursor();
  }

  drawTooSmall() {
    const cv = this.cv;
    cv.fill(0x101014);
    const lines = [
      'TridOS needs a bigger window.',
      `It has ${cv.cols}x${cv.rows} text cells; it needs ${MIN_COLS}x${MIN_ROWS}.`,
      'Ctrl+Cmd+F makes it full screen; Cmd and minus',
      'make the terminal font smaller.',
    ];
    lines.forEach((l, i) => cv.text(Math.max(0, Math.floor((cv.cols - len(l)) / 2)), Math.floor(cv.rows / 2) + i, fit(l, cv.cols), i ? 0x9a9aa6 : 0xffffff));
  }

  drawSplash(label, progress, off) {
    const cv = this.cv;
    cv.pix.fill(0x000000);
    const s = Math.max(2, Math.floor(Math.min(cv.W / 60, cv.H / 18)));
    const tw = pixelTextWidth(label, s);
    const x = Math.floor((cv.W - tw) / 2);
    const y = Math.floor(cv.H * 0.4 - (FONT_H * s) / 2);
    pixelText(cv, label, x, y, s, 0xffffff);
    const bw = Math.min(Math.floor(cv.W * 0.3), 80);
    const bx = Math.floor((cv.W - bw) / 2);
    const by = y + FONT_H * s + s * 4;
    cv.pxRect(bx, by, bw, 2, 0x2b2b30);
    cv.pxRect(bx, by, Math.round(bw * clamp(progress, 0, 1)), 2, 0xffffff);
  }

  drawDesktopIcons() {
    const cv = this.cv;
    const now = Date.now();
    if (now - this.desk.at > 1500) {
      this.desk.at = now;
      this.desk.files = listDir(path.join(DISK, 'Desktop')).slice(0, 12);
    }
    const cols = 12;
    const rowsEach = 6;
    const x = cv.cols - cols - 1;
    this.desk.files.forEach((f, i) => {
      const y = 2 + i * rowsEach;
      if (y + rowsEach > cv.rows - 8) return;
      const sel = this.desk.sel === i;
      const px = (x + 4) * cv.pw;
      const py = y * cv.ph;
      const iw = 4 * cv.pw;
      const ih = 3 * cv.ph;
      if (sel) cv.blendRect(x * cv.pw, y * cv.ph, cols * cv.pw, (rowsEach - 1) * cv.ph, this.th.accent, 0.28);
      if (f.dir) {
        cv.pxRect(px, py + 1, Math.floor(iw * 0.45), 2, 0x4aa3ff);
        cv.pxRect(px, py + 2, iw, ih - 2, 0x2f86ee);
        cv.pxRect(px, py + 2, iw, 1, 0x7cc0ff);
      } else {
        cv.pxRect(px + 1, py, iw - 2, ih, 0xf4f4f8);
        cv.pxRect(px + iw - 3, py, 2, 2, 0xc9c9d3);
        for (let k = 0; k < 3; k++) cv.pxRect(px + 2, py + 3 + k * Math.max(2, Math.floor(ih / 5)), iw - 5, 1, 0xa7a9b6);
      }
      const label = fit(f.name, cols);
      cv.text(x + Math.floor((cols - len(label)) / 2), y + 4, label, 0xffffff, sel ? this.th.accent : -1);
      this.hits.add(x, y, cols, rowsEach - 1, (cx, cy) => this.clickDesktopIcon(i, f), 'desk' + i);
    });
  }
  clickDesktopIcon(i, f) {
    const now = Date.now();
    const again = this.desk.sel === i && now - this.lastClick.t < 450 && this.lastClick.what === 'desk' + i;
    this.desk.sel = i;
    this.lastClick = { t: now, x: this.mouse.x, y: this.mouse.y, what: 'desk' + i };
    if (again) this.openFile(path.join(DISK, 'Desktop', f.name));
  }

  drawWindow(win) {
    const cv = this.cv;
    const th = this.th;
    const focused = win === this.focused;
    const { pw, ph } = cv;
    const x0 = win.x * pw;
    const y0 = win.y * ph;
    const w = win.w * pw;
    const h = win.h * ph;
    // shadow
    const sc = cv.scale;
    for (let k = 3; k >= 1; k--) cv.blendRect(x0 - k * sc, y0 + sc, w + 2 * k * sc, h + (k + 1) * sc, 0x000000, (focused ? 0.05 : 0.03) + (4 - k) * (focused ? 0.035 : 0.02));
    // rounded corners: remember the corner pixels, fill the window, put them back
    const r = Math.max(2, Math.round(ph * 0.3));
    const outside = cornerOutside(x0, y0, w, h, r);
    const saved = outside.map(([x, y]) => cv.get(x, y));
    cv.cellFill(win.x, win.y, win.w, 1, focused ? th.bar : th.barOff);
    cv.cellFill(win.x, win.y + 1, win.w, win.h - 1, th.bg);
    cv.pxRect(x0, y0 + ph - 1, w, 1, th.line);
    outside.forEach(([x, y], i) => cv.px(x, y, saved[i]));
    // traffic lights and title
    const over = this.mouse.y === win.y && this.mouse.x >= win.x + 1 && this.mouse.x <= win.x + 7;
    const dots = [[th.close, '×'], [th.min, '−'], [th.zoom, '+']];
    dots.forEach(([c, sym], i) => {
      const dx = win.x + 2 + i * 2;
      cv.disc(dx * pw + pw / 2, y0 + ph / 2, Math.max(2, ph * 0.3), focused ? c : 0x6a6a72);
      if (over && focused) cv.text(dx, win.y, sym, 0x1a1a1a);
    });
    let title = win.def.name;
    try {
      title = win.app?.title?.() || title;
    } catch {}
    title = fit(title, win.w - 18);
    cv.text(win.x + Math.floor((win.w - len(title)) / 2), win.y, title, focused ? th.text : th.dim);
    // the app
    const v = this.contentView(win);
    try {
      win.app?.draw?.(v, focused);
    } catch (e) {
      v.fill(th.bg);
      v.text(1, 1, 'This app hit an error:', th.danger);
      v.text(1, 2, fit(String((e && e.message) || e), v.w - 2), th.text);
      if (!win.errored) this.toast(`${win.def.name}: ${(e && e.message) || e}`);
      win.errored = true;
    }
    // resize grip
    if (focused && !win.zoom) cv.text(win.x + win.w - 1, win.y + win.h - 1, '◢', th.dim);
    if (this.nav?.zone === 'win' && focused) {
      cv.pxRect(x0, y0, w, 1, th.accent);
      cv.pxRect(x0, y0 + h - 1, w, 1, th.accent);
      cv.pxRect(x0, y0, 1, h, th.accent);
      cv.pxRect(x0 + w - 1, y0, 1, h, th.accent);
    }
  }

  // ----- menu bar -----
  menus() {
    const win = this.focused;
    const name = win ? win.def.name : 'TridOS';
    const appItems = win?.app?.menus?.() || [];
    const m = [];
    m.push({
      title: '',
      items: [
        { label: 'About TridOS', fn: () => this.aboutDialog() },
        { label: 'System Settings…', fn: () => this.openSettings() },
        { sep: true },
        { label: 'Bigger Text   Alt +', fn: () => this.bumpText(1) },
        { label: 'Smaller Text  Alt -', fn: () => this.bumpText(-1) },
        { sep: true },
        { label: 'Shut Down…', fn: () => this.confirm('Shut Down', 'Your windows and settings are saved. Shut down TridOS?', 'Shut Down', () => this.shutdown()) },
      ],
    });
    m.push({
      title: name,
      bold: true,
      items: [
        { label: `About ${name}`, fn: () => this.toast(win ? win.def.desc || name : 'TridOS desktop') },
        ...(win && win.def.id !== 'appstore' ? [{ label: win.def.user ? 'Edit in Code Studio' : 'Hide', disabled: false, fn: () => (win.def.user ? this.launch('studio', { file: win.def.file }) : this.minimizeWindow(win)) }] : []),
        { sep: true },
        { label: win ? `Quit ${name}`.slice(0, 30) : 'Shut Down…', fn: () => (win ? this.closeWindow(win) : this.shutdown()) },
      ],
    });
    for (const g of appItems) m.push(g);
    m.push({
      title: 'Window',
      items: [
        { label: 'Minimize', disabled: !win, fn: () => win && this.minimizeWindow(win) },
        { label: 'Zoom', disabled: !win, fn: () => win && this.toggleZoom(win) },
        { label: 'Close Window', disabled: !win, fn: () => win && this.closeWindow(win) },
        ...(this.windows.length ? [{ sep: true }] : []),
        ...this.windows.slice().reverse().map((w) => ({ label: (w === win ? '✓ ' : '  ') + fit(w.app?.title?.() || w.def.name, 26), fn: () => this.focusWindow(w) })),
      ],
    });
    return m;
  }
  aboutDialog() {
    this.dialog({
      title: 'About TridOS',
      message: `TridOS 0.1\nA desktop for the terminal, drawn in ${MODES[this.cv.mode].label}.\nDisk: ${DISK}\nScreen: ${this.cv.W}x${this.cv.H} pixels (${this.cv.tcols}x${this.cv.trows} terminal cells), text size ${this.cv.scale}x = ${this.cv.cols}x${this.cv.rows} text cells, ${this.truecolor ? '24-bit' : '256'} colour.`,
    });
  }
  openSettings() {
    this.launch('settings');
  }
  drawMenuBar() {
    const cv = this.cv;
    const th = this.th;
    const { pw, ph } = cv;
    cv.blendRect(0, 0, cv.W, ph, th.menu, 0.78);
    cv.pxRect(0, ph - 1, cv.W, 1, mix(th.menu, th.dark ? 0x000000 : 0x808080, 0.35));
    const menus = this.menus();
    this.menuLayout = [];
    let x = 1;
    menus.forEach((m, i) => {
      const w = len(m.title) + 2;
      const open = this.menu && this.menu.idx === i;
      const navOn = this.nav?.zone === 'menu' && this.nav.idx === i;
      const bg = open || navOn ? th.accent : -1;
      cv.text(x, MENU_ROW, ' ' + m.title + ' ', open || navOn ? 0xffffff : th.menuText, bg);
      this.menuLayout.push({ x, w, m });
      this.hits.add(x, MENU_ROW, w, 1, () => this.toggleMenu(i), 'menu' + i);
      x += w;
    });
    // right side: hint when navigating, then the clock
    const d = new Date();
    let time = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const h = this.settings.clock24 ? pad(d.getHours()) : String(d.getHours() % 12 || 12);
    time += '  ' + h + ':' + pad(d.getMinutes()) + (this.settings.showSeconds ? ':' + pad(d.getSeconds()) : '') + (this.settings.clock24 ? '' : d.getHours() < 12 ? ' AM' : ' PM');
    cv.text(cv.cols - len(time) - 1, MENU_ROW, time, th.menuText);
    if (this.nav) {
      const hint = ' keys: ←→↑↓ move  Enter choose  Tab windows  Esc back ';
      cv.text(cv.cols - len(time) - len(hint) - 2, MENU_ROW, hint, 0xffffff, th.accent);
    } else {
      const hint = 'Esc: keyboard';
      cv.text(cv.cols - len(time) - len(hint) - 3, MENU_ROW, hint, th.dim);
    }
  }
  toggleMenu(i) {
    this.menu = this.menu && this.menu.idx === i ? null : { idx: i, item: -1 };
    this.dirty = true;
  }
  drawMenuDropdown() {
    if (!this.menu) return;
    const cv = this.cv;
    const th = this.th;
    const lay = this.menuLayout[this.menu.idx];
    if (!lay) return void (this.menu = null);
    const items = lay.m.items;
    const w = Math.max(18, ...items.map((it) => (it.sep ? 0 : len(it.label) + 4)));
    const x = clamp(lay.x, 0, cv.cols - w - 1);
    const h = items.length + 2;
    const { pw, ph } = cv;
    cv.blendRect(x * pw - 1, ph + 1, w * pw + 3, h * ph, 0x000000, 0.22);
    cv.cellFill(x, 1, w, h, mix(th.sheet, th.menu, 0.2));
    cv.pxRect(x * pw, ph, w * pw, 1, th.line);
    cv.pxRect(x * pw, (1 + h) * ph - 1, w * pw, 1, th.line);
    const hitsHere = [];
    items.forEach((it, i) => {
      const y = 2 + i;
      if (it.sep) {
        for (let k = 1; k < w - 1; k++) cv.text(x + k, y, '─', th.line);
        return;
      }
      const hov = this.mouse.y === y && this.mouse.x >= x && this.mouse.x < x + w;
      const sel = (hov && !it.disabled) || this.menu.item === i;
      if (sel) cv.cellFill(x + 1, y, w - 2, 1, th.accent);
      cv.text(x + 2, y, it.label, it.disabled ? th.dim : sel ? 0xffffff : th.menuText);
      hitsHere.push({ x, y, w, it });
    });
    this.menuBox = { x, y: 1, w, h, items: hitsHere };
  }

  // ----- dock -----
  dockItems() {
    const ids = [...this.installed];
    for (const w of this.windows) if (!ids.includes(w.def.id)) ids.push(w.def.id);
    return ids.map((id) => this.appDef(id)).filter(Boolean);
  }
  drawDock() {
    const cv = this.cv;
    const th = this.th;
    const items = this.dockItems();
    const { S, pad, gap, w, h, x, y } = this.dockMetrics(items.length);
    const { pw, ph, scale } = cv;
    // a translucent rounded panel
    const r = Math.round(S * 0.3);
    const outside = cornerOutside(x, y, w, h, r);
    const saved = outside.map(([a, b]) => cv.get(a, b));
    cv.blendRect(x, y, w, h, th.dockBg, 0.66);
    cv.pxRect(x + r, y, w - 2 * r, scale, lighten(th.dockBg, th.dark ? 0.35 : 0.9));
    outside.forEach(([a, b], i) => cv.px(a, b, saved[i]));
    this.dockLayout = [];
    const mx = this.ptr.x;
    const my = this.ptr.y;
    items.forEach((def, i) => {
      const ix = x + pad + i * (S + gap);
      const hov = mx >= ix - gap / 2 && mx < ix + S + gap / 2 && my >= y && my < y + h;
      const navOn = this.nav?.zone === 'dock' && this.nav.idx === i;
      const iy = y + pad - (hov ? Math.round(S * 0.08) : 0);
      drawIcon(cv, def.icon, ix, iy, S, S);
      if (hov || navOn) cv.blendRect(ix, iy, S, S, 0xffffff, 0.12);
      if (navOn) {
        const c = th.accent;
        cv.pxRect(ix - scale, iy - scale, S + 2 * scale, scale, c);
        cv.pxRect(ix - scale, iy + S, S + 2 * scale, scale, c);
        cv.pxRect(ix - scale, iy - scale, scale, S + 2 * scale, c);
        cv.pxRect(ix + S, iy - scale, scale, S + 2 * scale, c);
      }
      if (this.windows.some((win) => win.def.id === def.id) && this.settings.dockIndicators) {
        cv.pxRect(ix + Math.floor(S / 2) - scale, y + h - Math.round(S * 0.12) - scale, 2 * scale, 2 * scale, th.dark ? 0xffffff : 0x333333);
      }
      // the click area, in text cells
      const cx0 = Math.floor((ix - gap / 2) / pw);
      const cx1 = Math.ceil((ix + S + gap / 2) / pw);
      const cy0 = Math.floor(y / ph);
      this.dockLayout.push({ def, x: cx0, y: cy0, w: cx1 - cx0, h: cv.rows - cy0 });
      this.hits.add(cx0, cy0, cx1 - cx0, cv.rows - cy0, () => this.dockClick(def), 'dock' + def.id);
      if (hov || navOn) {
        const label = ' ' + def.name + ' ';
        const lx = clamp(Math.round((ix + S / 2) / pw - len(label) / 2), 0, cv.cols - len(label));
        cv.text(lx, cy0 - 2, label, th.dark ? 0xf2f2f7 : 0xffffff, th.dark ? 0x38383f : 0x3c3c43);
      }
    });
  }
  dockClick(def) {
    const w = this.windows.filter((w) => w.def.id === def.id);
    if (w.length) this.focusWindow(w[w.length - 1]);
    else this.launch(def.id);
    this.nav = null;
  }

  drawToasts() {
    const cv = this.cv;
    const th = this.th;
    let y = 2;
    for (const t of this.toasts.slice(-3)) {
      const text = ' ' + fit(t.msg, 60) + ' ';
      const x = cv.cols - len(text) - 2;
      cv.blendRect(x * cv.pw - 1, y * cv.ph + 1, (len(text) + 1) * cv.pw + 2, 2 * cv.ph, 0x000000, 0.25);
      cv.cellFill(x, y, len(text) + 1, 2, th.sheet);
      cv.text(x + 1, y, text, th.text);
      cv.text(x + 1, y + 1, ' ' + '▔'.repeat(Math.max(0, len(text) - 1)), th.accent);
      y += 3;
    }
  }

  drawModal() {
    const m = this.modal;
    if (!m) return;
    const cv = this.cv;
    const th = this.th;
    cv.blendRect(0, cv.ph, cv.W, cv.H - cv.ph, 0x000000, 0.4);
    const lines = [];
    for (const para of String(m.message).split('\n')) {
      let s = para;
      if (!s) lines.push('');
      while (s) {
        lines.push(s.slice(0, 54));
        s = s.slice(54);
      }
    }
    const w = clamp(Math.max(36, len(m.title) + 8, ...lines.map((l) => len(l) + 6), m.buttons.reduce((a, b) => a + len(b.label) + 4, 4)), 36, cv.cols - 4);
    const h = 3 + lines.length + (m.input ? 2 : 0) + 3;
    const x = Math.floor((cv.cols - w) / 2);
    const y = Math.max(2, Math.floor((cv.rows - h) / 3));
    cv.blendRect(x * cv.pw - 2, y * cv.ph + 2, w * cv.pw + 4, h * cv.ph + 3, 0x000000, 0.3);
    cv.cellFill(x, y, w, h, th.sheet);
    cv.pxRect(x * cv.pw, y * cv.ph, w * cv.pw, 1, th.line);
    cv.pxRect(x * cv.pw, (y + h) * cv.ph - 1, w * cv.pw, 1, th.line);
    const v = new View(cv, x, y, w, h, this.mouse);
    v.text(Math.floor((w - len(m.title)) / 2), 1, m.title, th.text);
    lines.forEach((l, i) => v.text(3, 3 + i, l, th.text));
    if (m.input) {
      if (!m.input.li) m.input.li = new LineInput(m.input.value);
      m.input.li.draw(v, 3, 3 + lines.length + 1, w - 6, th, { mask: m.input.mask });
    }
    m.hits.reset();
    let bx = w - 3;
    for (let i = m.buttons.length - 1; i >= 0; i--) {
      const b = m.buttons[i];
      const bw = len(b.label) + 4;
      bx -= bw;
      button(v, null, bx, h - 3, b.label, th, null, { primary: b.primary || i === m.sel, danger: !!b.danger, width: bw });
      m.hits.add(x + bx, y + h - 3, bw, 1, () => this.closeModal(i));
      bx -= 1;
    }
  }
  drawCursor() {
    const cv = this.cv;
    if (this.ptr.x < 0 || this.ptr.y < 0) return;
    const ARROW = [
      '1.....',
      '11....',
      '121...',
      '1221..',
      '12221.',
      '122221',
      '12211.',
      '1.121.',
      '..121.',
      '...11.',
    ];
    const s = cv.scale; // the pointer grows with the text
    ARROW.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c !== '.') cv.pxRect(this.ptr.x + i * s, this.ptr.y + j * s, s, s, c === '1' ? 0x000000 : 0xffffff);
      }
    });
  }

  // ---------- input ----------
  onResize() {
    if (!this.term) return;
    this.sizeChanged(this.term.cols, this.term.rows);
  }

  onEvent(e) {
    if (this.quitting) return;
    if (this.boot) {
      if (e.type === 'key') this.boot = null;
      this.dirty = true;
      return;
    }
    this.dirty = true;
    try {
      if (e.type === 'key') this.onKey(e);
      else if (e.type === 'mouse') this.onMouse(e);
    } catch (err) {
      this.toast('Error: ' + ((err && err.message) || err));
    }
  }

  onKey(e) {
    if (this.modal) return this.modalKey(e);
    if (e.ctrl && e.key === 'q') return this.confirm('Shut Down', 'Your windows and settings are saved. Shut down TridOS?', 'Shut Down', () => this.shutdown());
    if (e.alt && (e.key === '=' || e.key === '+')) return this.bumpText(1);
    if (e.alt && (e.key === '-' || e.key === '_')) return this.bumpText(-1);
    if (this.nav) return this.navKey(e);
    if (this.menu) {
      if (e.key === 'escape') this.menu = null;
      return;
    }
    const win = this.focused;
    if (e.key === 'escape') {
      if (win?.app?.key?.(e) === true) return;
      this.nav = { zone: win ? 'win' : 'dock', idx: 0, item: -1 };
      return;
    }
    if (win?.app?.key) win.app.key(e);
  }

  modalKey(e) {
    const m = this.modal;
    if (m.input && !m.input.li) m.input.li = new LineInput(m.input.value);
    if (e.key === 'escape') {
      const c = m.buttons.findIndex((b) => b.cancel);
      return this.closeModal(c >= 0 ? c : m.buttons.length - 1 === 0 ? 0 : -1);
    }
    if (e.key === 'enter') return this.closeModal(m.sel);
    if (e.key === 'tab' || (!m.input && (e.key === 'left' || e.key === 'right'))) {
      m.sel = (m.sel + (e.key === 'left' || e.shift ? m.buttons.length - 1 : 1)) % m.buttons.length;
      return;
    }
    if (m.input) m.input.li.key(e);
  }

  // Esc starts keyboard navigation. Zones: dock (arrows pick an app), menu (menu bar), win (move and resize the focused window).
  navKey(e) {
    const n = this.nav;
    const k = e.key;
    const items = this.dockItems();
    const menus = this.menuLayout;
    if (this.menu && n.zone === 'menu') return this.menuKey(e);
    if (k === 'escape') {
      this.nav = null;
      return;
    }
    if (k === 'tab') {
      // cycle through the windows in the order they were opened
      const list = this.windows.filter((w) => !w.minimized).sort((a, b) => a.id - b.id);
      if (list.length) {
        const i = list.indexOf(this.focused);
        this.focusWindow(list[(i + (e.shift ? list.length - 1 : 1)) % list.length]);
        n.zone = 'win';
      }
      return;
    }
    if (n.zone === 'dock') {
      if (k === 'left') n.idx = (n.idx + items.length - 1) % Math.max(1, items.length);
      else if (k === 'right') n.idx = (n.idx + 1) % Math.max(1, items.length);
      else if (k === 'up') {
        n.zone = 'menu';
        n.idx = 0;
      } else if (k === 'enter') {
        const def = items[n.idx];
        this.nav = null;
        if (def) this.dockClick(def);
      }
      return;
    }
    if (n.zone === 'menu') {
      if (k === 'left') n.idx = (n.idx + menus.length - 1) % menus.length;
      else if (k === 'right') n.idx = (n.idx + 1) % menus.length;
      else if (k === 'down' || k === 'enter') this.menu = { idx: n.idx, item: this.firstItem(menus[n.idx].m.items) };
      return;
    }
    if (n.zone === 'win') {
      const w = this.focused;
      if (!w) return void (n.zone = 'dock');
      const step = e.ctrl ? 8 : 2;
      if (k === 'enter') this.nav = null;
      else if (k === 'up' && !e.shift) w.y = Math.max(1, w.y - 1);
      else if (k === 'down' && !e.shift) w.y = Math.min(this.cv.rows - 3, w.y + 1);
      else if (k === 'left' && !e.shift) w.x -= step;
      else if (k === 'right' && !e.shift) w.x += step;
      else if (k === 'up') w.h -= 1;
      else if (k === 'down') w.h += 1;
      else if (k === 'left') w.w -= step;
      else if (k === 'right') w.w += step;
      else if (k === 'w') this.closeWindow(w);
      else if (k === 'm') this.minimizeWindow(w);
      else if (k === 'z') this.toggleZoom(w);
      else if (k === 'd') n.zone = 'dock';
      else if (k === 'o') {
        n.zone = 'menu';
        n.idx = 0;
      }
      this.clampWindow(w);
      w.zoom = null;
      this.stateDirty = true;
    }
  }
  firstItem(items) {
    return items.findIndex((it) => !it.sep && !it.disabled);
  }
  menuKey(e) {
    const m = this.menu;
    const k = e.key;
    const menus = this.menuLayout;
    const items = menus[m.idx]?.m.items || [];
    const step = (d) => {
      let i = m.item;
      for (let c = 0; c < items.length; c++) {
        i = (i + d + items.length) % items.length;
        if (!items[i].sep && !items[i].disabled) return i;
      }
      return m.item;
    };
    if (k === 'escape') this.menu = null;
    else if (k === 'down') m.item = step(1);
    else if (k === 'up') m.item = step(-1);
    else if (k === 'left' || k === 'right') {
      m.idx = (m.idx + (k === 'left' ? menus.length - 1 : 1)) % menus.length;
      this.nav.idx = m.idx;
      m.item = this.firstItem(menus[m.idx].m.items);
    } else if (k === 'enter') {
      const it = items[m.item];
      this.menu = null;
      this.nav = null;
      if (it && !it.sep && !it.disabled) it.fn?.();
    }
  }

  winAt(x, y) {
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const w = this.windows[i];
      if (!w.minimized && x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) return w;
    }
    return null;
  }

  onMouse(e) {
    // the terminal reports a character cell; the pointer sits at that cell's corner, in pixels, and the text cell under it is what we hit
    const cv = this.cv;
    const px = e.x * cv.tpw;
    const py = e.y * cv.tph;
    this.ptr.x = px;
    this.ptr.y = py;
    e = { ...e, x: Math.floor(px / cv.pw), y: Math.floor(py / cv.ph), px, py };
    this.mouse.x = e.x;
    this.mouse.y = e.y;
    if (e.kind === 'move') return;
    if (this.modal) {
      if (e.kind === 'down' && e.button === 0) this.modal.hits.click(e.x, e.y);
      return;
    }
    // an open menu takes clicks first
    if (this.menu && e.kind === 'down') {
      const box = this.menuBox;
      if (box && e.x >= box.x && e.x < box.x + box.w && e.y >= box.y && e.y < box.y + box.h) {
        const hit = box.items.find((h) => h.y === e.y);
        if (hit && !hit.it.disabled) {
          this.menu = null;
          this.nav = null;
          hit.it.fn?.();
        }
        return;
      }
      if (e.y === MENU_ROW) {
        const l = this.menuLayout.find((m) => e.x >= m.x && e.x < m.x + m.w);
        if (l) return this.toggleMenu(this.menuLayout.indexOf(l));
      }
      this.menu = null;
      return;
    }
    if (this.menu && e.kind === 'move') return;
    // a drag in progress
    if (this.drag && e.kind === 'drag') return this.dragMove(e);
    if (e.kind === 'up') {
      const cap = this.capture;
      this.drag = null;
      this.capture = null;
      if (cap && this.windows.includes(cap)) this.sendMouse(cap, e);
      return;
    }
    if (e.kind === 'drag' && this.capture) {
      if (this.windows.includes(this.capture)) this.sendMouse(this.capture, e);
      return;
    }
    if (e.kind === 'wheel') {
      const w = this.winAt(e.x, e.y);
      if (w) this.sendMouse(w, e);
      return;
    }
    if (e.kind !== 'down') return;
    this.nav = null;
    // The menu bar and the dock are drawn over the windows, so they get the click first.
    const hit = this.hits.at(e.x, e.y);
    if (hit && /^(menu|dock)/.test(hit.id || '')) return void hit.fn();
    const w = this.winAt(e.x, e.y);
    if (w) {
      if (w !== this.focused) this.focusWindow(w);
      const rx = e.x - w.x;
      const ry = e.y - w.y;
      if (ry === 0) {
        if (rx >= 2 && rx <= 6 && rx % 2 === 0) {
          if (rx === 2) this.closeWindow(w);
          else if (rx === 4) this.minimizeWindow(w);
          else this.toggleZoom(w);
          return;
        }
        const now = Date.now();
        if (now - this.lastClick.t < 400 && this.lastClick.what === 'title' + w.id) {
          this.toggleZoom(w);
          this.lastClick = { t: 0, x: 0, y: 0, what: '' };
          return;
        }
        this.lastClick = { t: now, x: e.x, y: e.y, what: 'title' + w.id };
        if (!w.zoom) this.drag = { kind: 'move', win: w, dx: e.x - w.x, dy: e.y - w.y };
        return;
      }
      if (rx >= w.w - 2 && ry >= w.h - 2 && !w.zoom) {
        this.drag = { kind: 'resize', win: w, dx: w.w - rx, dy: w.h - ry };
        return;
      }
      this.capture = w;
      this.sendMouse(w, e);
      return;
    }
    if (hit) return void hit.fn();
    this.desk.sel = -1;
  }
  dragMove(e) {
    const d = this.drag;
    const w = d.win;
    if (d.kind === 'move') {
      w.x = e.x - d.dx;
      w.y = e.y - d.dy;
    } else {
      w.w = e.x - w.x + d.dx;
      w.h = e.y - w.y + d.dy;
      const [mw, mh] = w.def.minSize || [24, 6];
      w.w = Math.max(mw, w.w);
      w.h = Math.max(mh + 1, w.h);
    }
    this.clampWindow(w);
    this.stateDirty = true;
  }
  sendMouse(w, e) {
    if (!w.app?.mouse) return;
    // x, y: text cells in the window; px, py: pixels in the window (for smooth dragging)
    w.app.mouse({ ...e, x: e.x - w.x, y: e.y - w.y - 1, px: e.px - w.x * this.cv.pw, py: e.py - (w.y + 1) * this.cv.ph });
  }
}

// The pixels in the four corners of a w x h rectangle at (x0, y0) that a corner of radius r rounds off.
function cornerOutside(x0, y0, w, h, r) {
  const out = [];
  const corners = [[x0, y0, x0 + r, y0 + r], [x0 + w - r, y0, x0 + w - r, y0 + r], [x0, y0 + h - r, x0 + r, y0 + h - r], [x0 + w - r, y0 + h - r, x0 + w - r, y0 + h - r]];
  for (const [sx, sy, cx, cy] of corners) {
    for (let y = sy; y < sy + r; y++) for (let x = sx; x < sx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) out.push([x, y]);
  }
  return out;
}

// Node's require for apps that need fs, path, os or child_process.
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);

function brokenApp(msg) {
  return {
    draw(v) {
      v.fill(0x201014);
      v.text(1, 1, 'This app could not be loaded:', 0xff6b6b);
      v.text(1, 3, fit(msg, v.w - 2), 0xffffff);
      v.text(1, 5, 'Open it in Code Studio to fix it.', 0x9a9aa6);
    },
  };
}
