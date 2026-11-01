// The App Store: the only app on a fresh TridOS. Discover lists the apps that come with TridOS and the apps people shared in the
// TridOS catalog (the apps/ folder of the tridOs repo). "Get" on a built-in app downloads it (a short progress bar) and puts it in
// the Dock; "Get" on a community app first shows you its source to read and approve.

import { Hits, button } from '../ui.js';
import { drawIcon } from '../icons.js';
import { decodePackage } from '../pack.js';
import { loadCatalog } from '../net.js';
import { ReviewPanel } from '../review.js';
import { clamp, fit, mix } from '../util.js';

const STORE = ['finder', 'terminal', 'editor', 'grapher', 'studio', 'distributor'];
const SIDE = 17;
const ROW = 4;
const TABS = [['discover', 'Discover'], ['installed', 'Installed'], ['mine', 'My Apps']];

const drawAppIcon = (v, def, x, y, w, h) => drawIcon(v.cv, def.icon, (v.x + x) * v.pw, (v.y + y) * v.ph, w * v.pw, h * v.ph);

class Store {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.tab = data?.tab || 'discover';
    this.sel = 0;
    this.scroll = 0;
    this.downloads = {}; // id -> { p: 0..1, rate }
    this.hits = new Hits();
    this.review = null; // a community app being read before it is installed
    this.community = []; // [{ pkg, url }] from the TridOS catalog
    this.communityState = 'loading'; // loading | ok | offline
    this.loadCommunity();
  }
  save() {
    return { tab: this.tab };
  }
  title() {
    return 'App Store';
  }
  async loadCommunity(force = false) {
    this.communityState = 'loading';
    try {
      this.community = await loadCatalog(decodePackage, { force });
      this.communityState = 'ok';
    } catch {
      this.communityState = 'offline';
    }
    this.os.dirty = true;
  }
  // A catalog entry as something the list can show like any other app.
  communityDef({ pkg, url }) {
    return { id: `community:${pkg.id}.js`, name: pkg.name, desc: pkg.desc, icon: pkg.icon, external: true, remote: true, author: pkg.author, version: pkg.version, pkg, url };
  }
  list() {
    const os = this.os;
    const all = os.apps;
    if (this.tab === 'installed') return os.installed.map((id) => all[id]).filter((d) => d && d.id !== 'appstore' && !d.system);
    if (this.tab === 'mine') return Object.values(os.userApps);
    return [...STORE.map((id) => all[id]).filter(Boolean), ...this.community.map((c) => this.communityDef(c))];
  }
  tick(dt) {
    let any = false;
    for (const [id, d] of Object.entries(this.downloads)) {
      d.p = Math.min(1, d.p + dt * d.rate);
      any = true;
      if (d.p >= 1) {
        delete this.downloads[id];
        this.os.install(id);
        this.os.toast(`${this.os.appDef(id)?.name || id} is installed. Find it in the Dock.`);
      }
    }
    return any;
  }
  // What the main button of an app does.
  state(def) {
    if (def.remote) {
      const local = this.os.userApps[def.id];
      if (local && this.os.isInstalled(def.id)) return local.version === def.version ? 'open' : 'update';
      return 'getRemote';
    }
    if (this.downloads[def.id]) return 'downloading';
    if (this.os.isInstalled(def.id)) return 'open';
    return def.broken ? 'broken' : 'get';
  }
  get(def) {
    if (this.os.isInstalled(def.id) || this.downloads[def.id]) return;
    this.downloads[def.id] = { p: 0, rate: 0.45 + Math.random() * 0.5 };
  }
  act(def) {
    const s = this.state(def);
    if (s === 'getRemote' || s === 'update') this.review = new ReviewPanel(this.os, def.pkg, `the TridOS catalog (${def.url})`);
    else if (s === 'open') this.os.launch(def.id);
    else if (s === 'get') this.get(def);
  }
  install() {
    const r = this.review;
    if (!r || !r.canInstall) return;
    try {
      const def = this.os.installPackage(r.pkg, `the TridOS catalog (${r.source})`);
      this.os.toast(`${def.name} is installed. Find it in the Dock.`);
    } catch (e) {
      this.os.toast(`Could not install it: ${e.message}`);
    }
    this.review = null;
    this.os.dirty = true;
  }
  cancelReview() {
    this.review = null;
    this.os.dirty = true;
  }
  remove(def) {
    if (!this.os.isInstalled(def.id)) return;
    if (def.external) return this.os.confirm('Remove App', `Remove ${def.name} from this computer? Its files are deleted.`, 'Remove', () => this.os.removeCommunityApp(def.id), true);
    this.os.confirm('Remove App', `Remove ${def.name} from the Dock? Your files stay on the disk.`, 'Remove', () => this.os.uninstall(def.id), true);
  }
  menus() {
    return [
      {
        title: 'Store',
        items: [
          ...TABS.map(([id, label]) => ({ label, fn: () => this.go(id) })),
          { sep: true },
          { label: 'Refresh Community Apps', fn: () => this.loadCommunity(true) },
        ],
      },
    ];
  }
  go(tab) {
    this.tab = tab;
    this.sel = 0;
    this.scroll = 0;
    this.review = null;
  }
  draw(v, focused) {
    const th = this.os.th;
    this.hits.reset();
    if (this.review) return this.review.draw(v, this.hits, { onInstall: () => this.install(), onCancel: () => this.cancelReview() });
    v.fill(th.bg);
    v.rect(0, 0, SIDE, v.h, th.side);
    v.text(2, 1, 'App Store', th.text);
    TABS.forEach(([id, label], i) => {
      const y = 3 + i * 2;
      const on = this.tab === id;
      if (on) v.rect(1, y, SIDE - 2, 1, th.sel);
      v.text(3, y, label, on ? th.text : th.dim);
      this.hits.add(1, y, SIDE - 2, 1, () => this.go(id));
    });
    v.text(2, v.h - 2, `${this.os.installed.length - 1} apps installed`, th.dim);
    const mx = SIDE + 2;
    const mw = v.w - mx - 2;
    const heads = { discover: 'Discover', installed: 'Installed', mine: 'My Apps' };
    v.text(mx, 1, heads[this.tab], th.text);
    const sub = {
      mine: 'Apps you made in Code Studio, and apps you installed from other people.',
      installed: 'Apps in your Dock. Select one and press Backspace to remove it.',
      discover: this.communityState === 'ok' ? 'Free apps for TridOS, and apps people shared with everyone.' : this.communityState === 'loading' ? 'Free apps for TridOS. Loading apps people shared…' : 'Free apps for TridOS. (Shared apps could not be loaded: are you online?)',
    };
    v.text(mx, 2, fit(sub[this.tab], mw), this.tab === 'discover' && this.communityState === 'offline' ? th.warn : th.dim);
    for (let x = mx; x < v.w - 1; x++) v.text(x, 3, '─', th.line);
    const list = this.list();
    this.sel = clamp(this.sel, 0, Math.max(0, list.length - 1));
    const rows = Math.max(1, Math.floor((v.h - 4) / ROW));
    if (this.sel < this.scroll) this.scroll = this.sel;
    if (this.sel >= this.scroll + rows) this.scroll = this.sel - rows + 1;
    if (!list.length) {
      v.text(mx, 5, this.tab === 'installed' ? 'Nothing installed yet. Get an app from Discover.' : 'No apps yet. Code Studio makes them (get it from Discover).', th.dim);
    }
    list.slice(this.scroll, this.scroll + rows).forEach((def, i) => {
      const idx = this.scroll + i;
      const y = 4 + i * ROW;
      const on = idx === this.sel;
      if (on) v.rect(mx - 1, y, mw + 2, ROW - 1, mix(th.bg, th.accent, 0.12));
      drawAppIcon(v, def, mx + 1, y, 5, 3);
      v.text(mx + 8, y, def.name, th.text);
      v.text(mx + 8, y + 1, fit(def.desc || '', mw - 22), th.dim);
      const kind = def.external ? `From ${def.author || 'someone'} · v${def.version}${def.remote ? ' · shared' : ''}` : def.user ? 'Made in Code Studio' : 'Free · TridOS';
      v.text(mx + 8, y + 2, fit(kind, mw - 22), th.dim);
      const bx = v.w - 14;
      const s = this.state(def);
      const pick = () => (this.sel = idx);
      if (s === 'downloading') {
        const dl = this.downloads[def.id];
        v.rect(bx, y + 1, 11, 1, th.ctrl);
        v.rect(bx, y + 1, Math.max(1, Math.round(11 * dl.p)), 1, th.accent);
        v.text(bx, y, 'Downloading', th.dim);
      } else if (s === 'open') {
        button(v, this.hits, bx, y + 1, 'Open', th, () => (pick(), this.os.launch(def.id)), { width: 11 });
        if (this.tab !== 'discover') v.text(bx, y + 2, '⌫ remove', th.dim);
      } else if (s === 'broken') {
        v.text(bx, y + 1, 'Has an error', th.danger);
      } else {
        const label = s === 'update' ? 'Update' : 'Get';
        button(v, this.hits, bx, y + 1, label, th, () => (pick(), this.act(def)), { primary: true, width: 11 });
        if (def.remote) v.text(bx, y + 2, 'read first', th.dim);
      }
      this.hits.add(mx - 1, y, mw - 14, ROW - 1, pick);
      for (let x = mx; x < v.w - 1; x++) v.text(x, y + ROW - 1, '·', th.line);
    });
    if (list.length > rows) v.text(v.w - 2, v.h - 1, this.scroll + rows < list.length ? '▾' : ' ', th.dim);
  }
  key(e) {
    if (this.review) return this.review.key(e, { onInstall: () => this.install(), onCancel: () => this.cancelReview() });
    const list = this.list();
    const k = e.key;
    if (k === 'up') this.sel = Math.max(0, this.sel - 1);
    else if (k === 'down') this.sel = Math.min(list.length - 1, this.sel + 1);
    else if (k === 'left' || k === 'right') {
      const order = TABS.map((t) => t[0]);
      this.go(order[(order.indexOf(this.tab) + (k === 'left' ? order.length - 1 : 1)) % order.length]);
    } else if (k === 'enter' && list[this.sel]) this.act(list[this.sel]);
    else if ((k === 'backspace' || k === 'delete') && list[this.sel] && this.tab !== 'discover') this.remove(list[this.sel]);
    else if (k === 'r' && !e.ctrl && this.tab === 'discover') this.loadCommunity(true);
    else return false;
    return true;
  }
  mouse(e) {
    if (e.kind === 'wheel') {
      if (this.review) this.review.wheel(e.dir);
      else this.scroll = Math.max(0, this.scroll + e.dir);
    } else if (e.kind === 'down' && e.button === 0) this.hits.click(e.x, e.y);
  }
}

export default {
  id: 'appstore',
  name: 'App Store',
  desc: 'Get new apps for TridOS.',
  icon: 'appstore',
  size: [78, 28],
  minSize: [60, 14],
  create: (os, win, data) => new Store(os, win, data),
};
