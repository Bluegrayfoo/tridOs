// The App Store: the only app on a fresh TridOS. "Get" downloads (a short progress bar) and puts the app in the Dock.

import { Hits, button } from '../ui.js';
import { drawIcon } from '../icons.js';
import { clamp, fit, len, mix } from '../util.js';

const STORE = ['finder', 'terminal', 'editor', 'grapher', 'studio'];
const SIDE = 17;
const ROW = 4;

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
  }
  save() {
    return { tab: this.tab };
  }
  title() {
    return 'App Store';
  }
  list() {
    const os = this.os;
    const all = os.apps;
    if (this.tab === 'installed') return os.installed.map((id) => all[id]).filter((d) => d && d.id !== 'appstore' && !d.system);
    if (this.tab === 'mine') return Object.values(os.userApps);
    return STORE.map((id) => all[id]).filter(Boolean);
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
  get(def) {
    if (this.os.isInstalled(def.id) || this.downloads[def.id]) return;
    this.downloads[def.id] = { p: 0, rate: 0.45 + Math.random() * 0.5 };
  }
  act(def) {
    if (this.os.isInstalled(def.id)) this.os.launch(def.id);
    else this.get(def);
  }
  remove(def) {
    if (!this.os.isInstalled(def.id)) return;
    this.os.confirm('Remove App', `Remove ${def.name} from the Dock? Your files stay on the disk.`, 'Remove', () => this.os.uninstall(def.id), true);
  }
  menus() {
    return [
      {
        title: 'Store',
        items: [
          { label: 'Discover', fn: () => this.go('discover') },
          { label: 'Installed', fn: () => this.go('installed') },
          { label: 'My Apps', fn: () => this.go('mine') },
        ],
      },
    ];
  }
  go(tab) {
    this.tab = tab;
    this.sel = 0;
    this.scroll = 0;
  }
  draw(v, focused) {
    const th = this.os.th;
    this.hits.reset();
    v.fill(th.bg);
    v.rect(0, 0, SIDE, v.h, th.side);
    v.text(2, 1, 'App Store', th.text);
    const tabs = [['discover', 'Discover'], ['installed', 'Installed'], ['mine', 'My Apps']];
    tabs.forEach(([id, label], i) => {
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
    v.text(mx, 2, this.tab === 'mine' ? 'Apps you made in Code Studio. Open Code Studio to write one.' : this.tab === 'installed' ? 'Apps in your Dock. Select one and press Backspace to remove it.' : 'Free apps for TridOS. Choose Get and it is yours.', th.dim);
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
      drawAppIcon(v, def, mx + 1, y, 8, 3);
      v.text(mx + 11, y, def.name, th.text);
      v.text(mx + 11, y + 1, fit(def.desc || '', mw - 24), th.dim);
      const kind = def.user ? 'Made in Code Studio' : 'Free · TridOS';
      v.text(mx + 11, y + 2, kind, th.dim);
      const bx = v.w - 14;
      const dl = this.downloads[def.id];
      if (dl) {
        const bw = 11;
        v.rect(bx, y + 1, bw, 1, th.ctrl);
        v.rect(bx, y + 1, Math.max(1, Math.round(bw * dl.p)), 1, th.accent);
        v.text(bx, y, 'Downloading', th.dim);
      } else if (this.os.isInstalled(def.id)) {
        button(v, this.hits, bx, y + 1, 'Open', th, () => ((this.sel = idx), this.os.launch(def.id)), { width: 11 });
        if (this.tab !== 'discover') v.text(bx, y + 2, '⌫ remove', th.dim);
      } else if (def.broken) {
        v.text(bx, y + 1, 'Has an error', th.danger);
      } else {
        button(v, this.hits, bx, y + 1, 'Get', th, () => ((this.sel = idx), this.get(def)), { primary: true, width: 11 });
      }
      this.hits.add(mx - 1, y, mw - 14, ROW - 1, () => (this.sel = idx));
      for (let x = mx; x < v.w - 1; x++) v.text(x, y + ROW - 1, '·', th.line);
    });
    if (list.length > rows) v.text(v.w - 2, v.h - 1, this.scroll + rows < list.length ? '▾' : ' ', th.dim);
  }
  key(e) {
    const list = this.list();
    const k = e.key;
    if (k === 'up') this.sel = Math.max(0, this.sel - 1);
    else if (k === 'down') this.sel = Math.min(list.length - 1, this.sel + 1);
    else if (k === 'left' || k === 'right') {
      const order = ['discover', 'installed', 'mine'];
      this.go(order[(order.indexOf(this.tab) + (k === 'left' ? 2 : 1)) % 3]);
    } else if (k === 'enter' && list[this.sel]) this.act(list[this.sel]);
    else if ((k === 'backspace' || k === 'delete') && list[this.sel] && this.tab !== 'discover') this.remove(list[this.sel]);
    else return false;
    return true;
  }
  mouse(e) {
    if (e.kind === 'wheel') this.scroll = Math.max(0, this.scroll + e.dir);
    else if (e.kind === 'down' && e.button === 0) this.hits.click(e.x, e.y + 1 - 1);
  }
}

export default {
  id: 'appstore',
  name: 'App Store',
  desc: 'Get new apps for TridOS.',
  icon: 'appstore',
  size: [78, 24],
  minSize: [60, 14],
  create: (os, win, data) => new Store(os, win, data),
};
