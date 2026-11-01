// App Distributor: send your apps to anyone with TridOS, and install apps other people sent you.
//   Share:     make an app code (paste it in a message), a .tridapp file, or a public link (a GitHub gist, through the gh command)
//   Get apps:  paste a link or a code, or open a .tridapp file. You read the source before anything is installed.
//   Published: the links you made, with a way to take them down.
// Apps from other people are checked and fenced (see pack.js and sandbox.js), but they are still code: install only from people you trust.

import fs from 'node:fs';
import path from 'node:path';
import { Hits, LineInput, TextArea, button } from '../ui.js';
import { APPS_DIR, DISK, PUBLISHED_FILE } from '../fs.js';
import { makePackage, encodePackage, decodePackage, scanSource, PREFIX } from '../pack.js';
import { copyText, pasteText, fetchText, publishGist, deleteGist, run } from '../net.js';
import { drawIcon } from '../icons.js';
import { clamp, fit, len, mix } from '../util.js';

const SIDE = 18;
const TABS = [['share', 'Share'], ['get', 'Get apps'], ['published', 'Published']];

function loadPublished() {
  try {
    const list = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
const savePublished = (list) => {
  try {
    fs.writeFileSync(PUBLISHED_FILE, JSON.stringify(list, null, 2));
  } catch {}
};
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

class Distributor {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.tab = data?.tab || 'share';
    this.sel = { share: 0, get: 0, published: 0 };
    this.input = new LineInput('');
    this.hits = new Hits();
    this.status = { t: '', k: '' };
    this.busy = '';
    this.review = null;
    this.published = loadPublished();
    this.alive = true;
  }
  save() {
    return { tab: this.tab };
  }
  title() {
    return 'App Distributor';
  }
  close() {
    this.alive = false;
  }
  say(t, k = '') {
    this.status = { t, k };
    this.os.dirty = true;
  }
  go(tab) {
    this.tab = tab;
    this.review = null;
    this.os.dirty = true;
  }

  // ----- what there is -----
  myApps() {
    return Object.values(this.os.userApps)
      .filter((d) => d.user && !d.broken)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  installedFromOthers() {
    return Object.values(this.os.userApps)
      .filter((d) => d.external)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  current(tab = this.tab) {
    const list = tab === 'share' ? this.myApps() : tab === 'get' ? this.installedFromOthers() : this.published;
    this.sel[tab] = clamp(this.sel[tab], 0, Math.max(0, list.length - 1));
    return list[this.sel[tab]] || null;
  }

  // ----- sharing -----
  withAuthor(then) {
    if (this.os.settings.author) return then();
    this.os.ask('Your name', 'This name goes on the apps you share (the people who install them see it):', '', (name) => {
      name = name.trim().slice(0, 40);
      if (!name) return this.say('Sharing needs a name on it.', 'err');
      this.os.settings.author = name;
      this.os.changed();
      then();
    });
  }
  // The package for one of your apps, or null (with the reason said) when others' TridOS would refuse it.
  packageFor(def) {
    try {
      const code = fs.readFileSync(path.join(APPS_DIR, def.file), 'utf8');
      const bad = scanSource(code);
      if (bad.length) {
        this.say(`${def.name} uses ${bad[0].what} (line ${bad[0].line}). TridOS refuses that in apps from other people, so take it out before sharing.`, 'err');
        return null;
      }
      return makePackage({ name: def.name, desc: def.desc, version: def.version, author: this.os.settings.author, icon: def.icon, code });
    } catch (e) {
      this.say(e.message, 'err');
      return null;
    }
  }
  copyCode(def) {
    this.withAuthor(async () => {
      const pkg = this.packageFor(def);
      if (!pkg) return;
      const text = encodePackage(pkg);
      if (await copyText(text)) this.say(`Copied the code for ${pkg.name} (${text.length} characters). Paste it in a message; they paste it in Get apps.`, 'ok');
      else this.say('Could not use the clipboard here. Use Save file instead.', 'err');
    });
  }
  saveFile(def) {
    this.withAuthor(() => {
      const pkg = this.packageFor(def);
      if (!pkg) return;
      try {
        const file = path.join(DISK, 'Desktop', `${pkg.id}.tridapp`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, encodePackage(pkg) + '\n');
        this.lastFile = file;
        this.os.desk.at = 0;
        this.say(`Saved ${pkg.id}.tridapp on your Desktop (${file}). Send that file; opening it in TridOS installs it.`, 'ok');
      } catch (e) {
        this.say(e.message, 'err');
      }
    });
  }
  reveal() {
    if (!this.lastFile) return this.say('Save a file first.', 'err');
    if (process.platform === 'darwin') run('open', ['-R', this.lastFile]);
    else run('xdg-open', [path.dirname(this.lastFile)]);
  }
  publish(def) {
    this.withAuthor(() => {
      const pkg = this.packageFor(def);
      if (!pkg) return;
      this.os.dialog({
        title: 'Publish to GitHub',
        message: `This makes a PUBLIC GitHub gist of "${pkg.name}" on your GitHub account (using the gh command). Anyone with the link can read and install it. You can delete it later in Published.`,
        buttons: [{ label: 'Cancel', cancel: true }, { label: 'Publish', primary: true }],
        onDone: async (i) => {
          if (i !== 1) return;
          this.busy = 'Publishing…';
          this.os.dirty = true;
          try {
            const { url, id } = await publishGist(encodePackage(pkg), `${pkg.id}.tridapp`, `TridOS app: ${pkg.name} v${pkg.version}`);
            this.published.unshift({ id, url, name: pkg.name, version: pkg.version, appId: pkg.id, date: new Date().toISOString() });
            savePublished(this.published);
            const copied = await copyText(url);
            this.say(`Published. ${copied ? 'The link is on your clipboard: ' : 'Link: '}${url}`, 'ok');
          } catch (e) {
            this.say(e.message, 'err');
          }
          this.busy = '';
          this.os.dirty = true;
        },
      });
    });
  }
  unpublish(rec) {
    this.os.confirm('Delete the link', `Delete the GitHub gist for "${rec.name}"? The link stops working for everyone.`, 'Delete', async () => {
      this.busy = 'Deleting…';
      try {
        await deleteGist(rec.id);
        this.say(`Deleted the link for ${rec.name}.`, 'ok');
      } catch (e) {
        this.say(`${e.message} (It is removed from this list anyway.)`, 'err');
      }
      this.published = this.published.filter((r) => r !== rec);
      savePublished(this.published);
      this.busy = '';
      this.os.dirty = true;
    }, true);
  }

  // ----- getting -----
  async pasteIn() {
    const t = await pasteText();
    if (t == null) return this.say('Could not read the clipboard here. Type or paste the link into the box.', 'err');
    this.input.set(t.trim().replace(/\s+/g, ' ').slice(0, 20000));
    this.os.dirty = true;
  }
  async get() {
    const text = this.input.text.trim();
    if (!text) return this.say('Paste a link or an app code first.', 'err');
    try {
      let pkg;
      let source = 'an app code';
      if (text.includes(PREFIX)) pkg = decodePackage(text);
      else if (/^https?:\/\//i.test(text)) {
        this.busy = 'Downloading…';
        this.os.dirty = true;
        const body = await fetchText(text);
        pkg = decodePackage(body);
        source = text;
      } else throw new Error('Paste a link (https://…) or an app code (it starts with TRIDAPP1.).');
      this.openReview(pkg, source);
    } catch (e) {
      this.say(e.message, 'err');
    }
    this.busy = '';
    this.os.dirty = true;
  }
  importFile(file) {
    try {
      const st = fs.statSync(file);
      if (st.size > 600 * 1024) throw new Error('That file is too big for an app.');
      this.tab = 'get';
      this.openReview(decodePackage(fs.readFileSync(file, 'utf8')), path.basename(file));
    } catch (e) {
      this.say(e.message, 'err');
    }
  }
  openReview(pkg, source) {
    const existing = this.os.userApps[`community:${pkg.id}.js`];
    const own = this.os.userApps[`user:${pkg.id}.js`];
    this.review = { pkg, source, findings: scanSource(pkg.code), existing, own, ta: new TextArea(pkg.code, { lang: 'js' }) };
    this.review.ta.follow = false;
    this.os.dirty = true;
  }
  install() {
    const r = this.review;
    if (!r || r.findings.length) return;
    try {
      const def = this.os.installPackage(r.pkg, r.source);
      this.review = null;
      this.input.set('');
      this.say(`Installed ${def.name} v${def.version}. It is in your Dock.`, 'ok');
      this.os.toast(`${def.name} is installed. Find it in the Dock.`);
    } catch (e) {
      this.say(`Could not install it: ${e.message}`, 'err');
      this.review = null;
    }
  }
  removeApp(def) {
    this.os.confirm('Remove App', `Remove ${def.name} from this computer? Its files are deleted.`, 'Remove', () => {
      this.os.removeCommunityApp(def.id);
      this.say(`Removed ${def.name}.`, 'ok');
    }, true);
  }

  menus() {
    return [{ title: 'Distribute', items: TABS.map(([id, label]) => ({ label, fn: () => this.go(id) })) }];
  }

  // ----- drawing -----
  draw(v, focused) {
    const th = this.os.th;
    this.hits.reset();
    v.fill(th.bg);
    if (this.review) return this.drawReview(v, focused);
    v.rect(0, 0, SIDE, v.h, th.side);
    v.text(2, 1, 'Distributor', th.text);
    TABS.forEach(([id, label], i) => {
      const y = 3 + i * 2;
      const on = this.tab === id;
      if (on) v.rect(1, y, SIDE - 2, 1, th.sel);
      v.text(3, y, label, on ? th.text : th.dim);
      this.hits.add(1, y, SIDE - 2, 1, () => this.go(id));
    });
    v.text(2, v.h - 3, 'Tab: next page', th.dim);
    const x0 = SIDE + 2;
    const w = v.w - x0 - 2;
    if (this.tab === 'share') this.drawShare(v, x0, w, focused);
    else if (this.tab === 'get') this.drawGet(v, x0, w, focused);
    else this.drawPublished(v, x0, w);
    const s = this.busy ? { t: this.busy, k: '' } : this.status;
    v.rect(SIDE, v.h - 2, v.w - SIDE, 2, th.side);
    const color = s.k === 'err' ? th.danger : s.k === 'ok' ? th.ok : th.dim;
    const lines = [];
    for (let rest = s.t; rest && lines.length < 2; ) {
      lines.push(rest.slice(0, v.w - SIDE - 3));
      rest = rest.slice(v.w - SIDE - 3);
    }
    lines.forEach((l, i) => v.text(SIDE + 1, v.h - 2 + i, l, color));
  }

  appRow(v, x, y, def, on, onClick) {
    const th = this.os.th;
    if (on) v.rect(x - 1, y, v.w - x - 1, 3, mix(th.bg, th.accent, 0.14));
    drawIcon(v.cv, def.icon, (v.x + x) * v.pw, (v.y + y) * v.ph, 3 * v.pw, 2 * v.ph);
    v.text(x + 4, y, fit(def.name + (def.version ? `  v${def.version}` : ''), 36), th.text);
    v.text(x + 4, y + 1, fit(def.desc || '', v.w - x - 8), th.dim);
    this.hits.add(x - 1, y, v.w - x, 3, onClick);
  }

  drawShare(v, x0, w, focused) {
    const th = this.os.th;
    v.text(x0, 1, 'Share your apps', th.text);
    v.text(x0, 2, fit('Send an app to anyone with TridOS: as a code, a file or a link.', w), th.dim);
    const apps = this.myApps();
    const sel = this.current();
    if (!apps.length) {
      v.text(x0, 5, 'You have no apps to share yet. Make one in Code Studio, then come back.', th.dim);
      if (!this.os.isInstalled('studio')) v.text(x0, 6, 'Code Studio is in the App Store.', th.dim);
      return;
    }
    const rows = Math.max(1, Math.floor((v.h - 14) / 3));
    const first = clamp(this.sel.share - rows + 1, 0, Math.max(0, apps.length - rows));
    apps.slice(first, first + rows).forEach((def, k) => this.appRow(v, x0, 4 + k * 3, def, first + k === this.sel.share, () => (this.sel.share = first + k)));
    // the chosen app
    const y = v.h - 9;
    for (let x = x0; x < v.w - 2; x++) v.text(x, y - 1, '─', th.line);
    if (!sel) return;
    let code = '';
    try {
      code = fs.readFileSync(path.join(APPS_DIR, sel.file), 'utf8');
    } catch {}
    const bad = scanSource(code);
    v.text(x0, y, fit(`${sel.name}  v${sel.version}  ·  ${kb(code.length)}  ·  by ${this.os.settings.author || '(you: asked when you share)'}`, w), th.text);
    if (bad.length) {
      v.text(x0, y + 1, fit(`Cannot share yet: it uses ${bad[0].what} (line ${bad[0].line}).`, w), th.danger);
      v.text(x0, y + 2, fit('Apps from other people may not use that, so their TridOS would refuse it.', w), th.dim);
    } else v.text(x0, y + 1, fit('Others see its source before they install it. Version comes from  version: "1.0.0"  in the app.', w), th.dim);
    let x = x0;
    x += button(v, this.hits, x, y + 4, 'Publish link', th, () => this.publish(sel), { primary: !bad.length }) + 1;
    x += button(v, this.hits, x, y + 4, 'Copy code', th, () => this.copyCode(sel)) + 1;
    x += button(v, this.hits, x, y + 4, 'Save file', th, () => this.saveFile(sel)) + 1;
    if (this.lastFile) button(v, this.hits, x, y + 4, 'Show file', th, () => this.reveal());
    v.text(x0, y + 5, 'Keys: p publish, c copy code, s save file, Up/Down choose', th.dim);
  }

  drawGet(v, x0, w, focused) {
    const th = this.os.th;
    v.text(x0, 1, 'Get apps', th.text);
    v.text(x0, 2, fit('Paste a link (a GitHub gist or any https link) or an app code (TRIDAPP1.…).', w), th.dim);
    const bw = 22;
    this.input.draw(v, x0, 4, w - bw - 1, th, { focus: focused, bg: th.field });
    let x = x0 + w - bw;
    x += button(v, this.hits, x, 4, 'Paste', th, () => this.pasteIn()) + 1;
    button(v, this.hits, x, 4, 'Get', th, () => this.get(), { primary: true });
    v.text(x0, 6, 'You can also open a .tridapp file from Finder or the Desktop.', th.dim);
    v.text(x0, 7, 'You will read the app\'s source and approve it before anything is installed.', th.dim);
    v.text(x0, 9, 'Installed from other people', th.text);
    const list = this.installedFromOthers();
    if (!list.length) v.text(x0, 11, 'Nothing yet.', th.dim);
    const rows = Math.max(1, Math.floor((v.h - 17) / 3));
    const first = clamp(this.sel.get - rows + 1, 0, Math.max(0, list.length - rows));
    list.slice(first, first + rows).forEach((def, k) => {
      const y = 11 + k * 3;
      this.appRow(v, x0, y, { ...def, desc: `by ${def.author || 'someone'}${def.source ? '  ·  ' + def.source : ''}` }, first + k === this.sel.get, () => (this.sel.get = first + k));
      button(v, this.hits, v.w - 12, y, 'Remove', th, () => this.removeApp(def), { danger: true });
    });
  }

  drawPublished(v, x0, w) {
    const th = this.os.th;
    v.text(x0, 1, 'Published', th.text);
    v.text(x0, 2, 'The public links you made. Anyone with a link can install the app.', th.dim);
    if (!this.published.length) v.text(x0, 5, 'Nothing published yet. Share → Publish link.', th.dim);
    const rows = Math.max(1, Math.floor((v.h - 10) / 3));
    const first = clamp(this.sel.published - rows + 1, 0, Math.max(0, this.published.length - rows));
    this.published.slice(first, first + rows).forEach((rec, k) => {
      const y = 4 + k * 3;
      const on = first + k === this.sel.published;
      if (on) v.rect(x0 - 1, y, v.w - x0 - 1, 3, mix(th.bg, th.accent, 0.14));
      v.text(x0, y, fit(`${rec.name}  v${rec.version}  ·  ${String(rec.date).slice(0, 10)}`, w), th.text);
      v.text(x0, y + 1, fit(rec.url, w), th.accent);
      this.hits.add(x0 - 1, y, v.w - x0, 3, () => (this.sel.published = first + k));
    });
    const rec = this.current('published');
    if (rec) {
      let x = x0;
      x += button(v, this.hits, x, v.h - 5, 'Copy link', th, async () => this.say((await copyText(rec.url)) ? 'Copied the link.' : 'Could not use the clipboard here.', 'ok')) + 1;
      button(v, this.hits, x, v.h - 5, 'Delete link…', th, () => this.unpublish(rec), { danger: true });
    }
  }

  drawReview(v, focused) {
    const th = this.os.th;
    const r = this.review;
    const p = r.pkg;
    v.text(2, 1, `Install “${p.name}”?`, th.text);
    v.text(2, 2, fit(`by ${p.author || 'someone'}  ·  v${p.version}  ·  ${kb(p.code.length)}  ·  checksum ${p.sha256.slice(0, 12)}`, v.w - 4), th.dim);
    v.text(2, 3, fit(`from ${r.source}`, v.w - 4), th.dim);
    let y = 4;
    if (r.own) v.text(2, y++, 'You already have an app of yours with this name. Both will be in the Dock.', th.warn);
    if (r.existing) v.text(2, y++, `This replaces the version you have (v${r.existing.version}).`, th.warn);
    for (const line of ['This app is code that runs on your computer. TridOS fences it in but cannot', 'fully sandbox it: read the source, and install only apps from people you trust.']) v.text(2, y++, fit(line, v.w - 4), th.warn);
    if (r.findings.length) {
      for (const f of r.findings.slice(0, 3)) v.text(2, y++, fit(`Not allowed: ${f.what} (line ${f.line})`, v.w - 4), th.danger);
      v.text(2, y++, 'TridOS will not install this app.', th.danger);
    }
    const bottom = v.h - 3;
    const src = v.sub(1, y + 1, v.w - 2, bottom - y - 1);
    r.ta.draw(src, th, { focus: false });
    v.text(2, y, 'Source:', th.dim);
    const by = v.h - 2;
    button(v, this.hits, v.w - 13, by, r.findings.length ? 'Cannot install' : 'Install', th, () => this.install(), { primary: !r.findings.length, width: 12 });
    button(v, this.hits, v.w - 23, by, 'Cancel', th, () => ((this.review = null), (this.os.dirty = true)), { width: 9 });
    v.text(2, by, 'Up/Down scroll   Enter install   Esc cancel', th.dim);
    this.reviewSrc = { y: y + 1, h: bottom - y - 1 };
  }

  // ----- input -----
  key(e) {
    const k = e.key;
    if (this.review) {
      if (k === 'escape') return (this.review = null), true;
      if (k === 'enter') return this.install(), true;
      if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(k)) {
        this.review.ta.key(e, 8);
        this.review.ta.follow = true;
        return true;
      }
      return false;
    }
    if (k === 'tab') {
      const i = TABS.findIndex((t) => t[0] === this.tab);
      this.go(TABS[(i + (e.shift ? TABS.length - 1 : 1)) % TABS.length][0]);
      return true;
    }
    const list = this.tab === 'share' ? this.myApps() : this.tab === 'get' ? this.installedFromOthers() : this.published;
    if (k === 'up') return (this.sel[this.tab] = Math.max(0, this.sel[this.tab] - 1)), true;
    if (k === 'down') return (this.sel[this.tab] = Math.min(Math.max(0, list.length - 1), this.sel[this.tab] + 1)), true;
    if (this.tab === 'get') {
      if (k === 'enter') return this.get(), true;
      if (k === 'delete' && !this.input.text && this.current()) return this.removeApp(this.current()), true;
      if (e.ctrl && k === 'v') return this.pasteIn(), true;
      return this.input.key(e);
    }
    const cur = this.current();
    if (this.tab === 'share' && cur && !e.ctrl) {
      if (k === 'p') return this.publish(cur), true;
      if (k === 'c') return this.copyCode(cur), true;
      if (k === 's') return this.saveFile(cur), true;
    }
    if (this.tab === 'published' && cur) {
      if (k === 'delete' || k === 'backspace') return this.unpublish(cur), true;
      if (k === 'c') return copyText(cur.url).then((ok) => this.say(ok ? 'Copied the link.' : 'Could not use the clipboard here.', ok ? 'ok' : 'err')), true;
    }
    return false;
  }
  mouse(e) {
    if (e.kind === 'wheel') {
      if (this.review) {
        this.review.ta.wheel(e.dir);
      } else this.sel[this.tab] = Math.max(0, this.sel[this.tab] + e.dir);
      return;
    }
    if (e.kind === 'down' && e.button === 0) this.hits.click(e.x, e.y);
  }
}

export default {
  id: 'distributor',
  name: 'App Distributor',
  desc: 'Share your apps with anyone who has TridOS, and install theirs.',
  icon: 'distributor',
  size: [88, 28],
  minSize: [60, 18],
  create: (os, win, data) => new Distributor(os, win, data),
};
