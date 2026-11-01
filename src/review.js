// The screen shown before an app from someone else is installed: who made it, what it is, the checks it failed, and its source.
// Used by the App Store and the App Distributor.

import { TextArea, button } from './ui.js';
import { scanSource } from './pack.js';
import { fit } from './util.js';

const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export class ReviewPanel {
  constructor(os, pkg, source) {
    this.os = os;
    this.pkg = pkg;
    this.source = source;
    this.findings = scanSource(pkg.code);
    this.existing = os.userApps[`community:${pkg.id}.js`];
    this.own = os.userApps[`user:${pkg.id}.js`];
    this.ta = new TextArea(pkg.code, { lang: 'js' });
    this.ta.follow = false;
  }
  get canInstall() {
    return this.findings.length === 0;
  }
  // Fills the whole view. hits: the app's Hits; onInstall / onCancel: what the buttons do.
  draw(v, hits, { onInstall, onCancel }) {
    const th = this.os.th;
    const p = this.pkg;
    v.fill(th.bg);
    v.text(2, 1, `Install “${p.name}”?`, th.text);
    v.text(2, 2, fit(`by ${p.author || 'someone'}  ·  v${p.version}  ·  ${kb(p.code.length)}  ·  checksum ${p.sha256.slice(0, 12)}`, v.w - 4), th.dim);
    v.text(2, 3, fit(`from ${this.source}`, v.w - 4), th.dim);
    let y = 4;
    if (this.own) v.text(2, y++, 'You already have an app of yours with this name. Both will be in the Dock.', th.warn);
    if (this.existing) v.text(2, y++, `This replaces the version you have (v${this.existing.version}).`, th.warn);
    for (const line of ['This app is code that runs on your computer. TridOS fences it in but cannot', 'fully sandbox it: read the source, and install only apps from people you trust.']) v.text(2, y++, fit(line, v.w - 4), th.warn);
    if (this.findings.length) {
      for (const f of this.findings.slice(0, 3)) v.text(2, y++, fit(`Not allowed: ${f.what} (line ${f.line})`, v.w - 4), th.danger);
      v.text(2, y++, 'TridOS will not install this app.', th.danger);
    }
    const bottom = v.h - 3;
    this.ta.draw(v.sub(1, y + 1, v.w - 2, bottom - y - 1), th, { focus: false });
    v.text(2, y, 'Source:', th.dim);
    const by = v.h - 2;
    button(v, hits, v.w - 13, by, this.canInstall ? 'Install' : 'Cannot install', th, onInstall, { primary: this.canInstall, width: 12 });
    button(v, hits, v.w - 23, by, 'Cancel', th, onCancel, { width: 9 });
    v.text(2, by, 'Up/Down scroll   Enter install   Esc cancel', th.dim);
  }
  // Returns true if the key was used.
  key(e, { onInstall, onCancel }) {
    const k = e.key;
    if (k === 'escape') return onCancel(), true;
    if (k === 'enter') return onInstall(), true;
    if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(k)) {
      this.ta.key(e, 8);
      this.ta.follow = true;
      return true;
    }
    return false;
  }
  wheel(dir) {
    this.ta.wheel(dir);
  }
}
