// System Settings (open it from the  menu): appearance, wallpaper, display, dock. Everything is saved at once.

import fs from 'node:fs';
import { Hits, button } from '../ui.js';
import { ACCENTS, WALLPAPER_IDS, wallpaper, wallpaperName } from '../theme.js';
import { MODES } from '../gfx.js';
import { DEFAULT_SETTINGS, STATE_FILE, DISK } from '../fs.js';
import { clamp, fit, len, mix } from '../util.js';

const SIDE = 18;
const SECTIONS = [['general', 'General'], ['wallpaper', 'Wallpaper'], ['display', 'Display'], ['dock', 'Dock'], ['about', 'About']];

class Settings {
  constructor(os, win, data) {
    this.os = os;
    this.win = win;
    this.section = data?.section || 'general';
    this.item = 0;
    this.focus = 'content';
    this.hits = new Hits();
    this.previews = {};
    this.items = [];
  }
  save() {
    return { section: this.section };
  }
  title() {
    return 'System Settings';
  }
  set(key, value) {
    this.os.settings[key] = value;
    this.os.applySettings();
  }
  go(id) {
    this.section = id;
    this.item = 0;
  }
  // The controls of a section: seg (pick one), swatch (accent colours), toggle, wall (wallpaper grid), text
  buildItems() {
    const s = this.os.settings;
    const seg = (label, key, options) => ({ type: 'seg', label, key, options });
    switch (this.section) {
      case 'general':
        return [
          seg('Appearance', 'theme', [['dark', 'Dark'], ['light', 'Light']]),
          { type: 'swatch', label: 'Accent colour', key: 'accent' },
          { type: 'toggle', label: '24-hour clock', key: 'clock24' },
          { type: 'toggle', label: 'Show seconds in the clock', key: 'showSeconds' },
          { type: 'toggle', label: 'Play the start-up animation', key: 'boot' },
        ];
      case 'wallpaper':
        return [{ type: 'wall', label: 'Wallpaper', key: 'wallpaper' }];
      case 'display':
        return [
          seg('Text size', 'textScale', [[0, 'Auto'], [1, '1x'], [2, '2x'], [3, '3x'], [4, '4x']]),
          seg('Pixels', 'pixelMode', Object.entries(MODES).map(([id, m]) => [id, m.label])),
          seg('Colour', 'colorMode', [['auto', 'Auto'], ['truecolor', '24-bit'], ['256', '256 colours']]),
          { type: 'text', lines: [`Text is drawn in pixels, so it stays readable with a tiny terminal font. Now: ${this.os.cv.scale}x (${this.os.cv.cols}x${this.os.cv.rows} text cells).`, 'Alt + and Alt - change it from anywhere. Octants draw 2x4 pixels per terminal character (needs a', 'font with the Symbols for Legacy Computing Supplement, like Julia Mono); sextants are 2x3;', 'half blocks are 1x2 and work in almost every font.'] },
        ];
      case 'dock':
        return [seg('Dock size', 'dockSize', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]), { type: 'toggle', label: 'Show dots under running apps', key: 'dockIndicators' }];
      default:
        return [
          { type: 'text', lines: ['TridOS 0.1', `${this.os.cv.cols}x${this.os.cv.rows} cells, ${this.os.cv.W}x${this.os.cv.H} pixels (${this.os.cv.mode}), ${this.os.truecolor ? '24-bit' : '256'} colour`, 'Disk: ' + DISK, 'Settings: ' + STATE_FILE] },
          { type: 'button', label: 'Reset Settings…', run: () => this.reset() },
        ];
    }
  }
  reset() {
    this.os.confirm('Reset Settings', 'Put the settings back to normal and remove all apps except the App Store? Your files and your own apps are kept.', 'Reset', () => {
      Object.assign(this.os.settings, DEFAULT_SETTINGS);
      for (const id of this.os.installed.slice()) if (id !== 'appstore') this.os.uninstall(id);
      this.os.applySettings();
    }, true);
  }
  preview(id, w, h) {
    const key = `${id}:${w}x${h}`;
    return this.previews[key] || (this.previews[key] = wallpaper(id, w, h));
  }
  menus() {
    return [{ title: 'View', items: SECTIONS.map(([id, label]) => ({ label, fn: () => this.go(id) })) }];
  }
  draw(v, focused) {
    const th = this.os.th;
    const s = this.os.settings;
    this.hits.reset();
    v.fill(th.bg);
    v.rect(0, 0, SIDE, v.h, th.side);
    v.text(2, 1, 'Settings', th.text);
    SECTIONS.forEach(([id, label], i) => {
      const y = 3 + i * 2;
      const on = this.section === id;
      if (on) v.rect(1, y, SIDE - 2, 1, this.focus === 'side' ? th.accent : th.sel);
      v.text(3, y, label, on && this.focus === 'side' ? 0xffffff : th.text);
      this.hits.add(0, y, SIDE, 1, () => ((this.focus = 'side'), this.go(id)));
    });
    this.items = this.buildItems();
    this.item = clamp(this.item, 0, Math.max(0, this.items.length - 1));
    const x0 = SIDE + 3;
    const w = v.w - x0 - 2;
    v.text(x0, 1, SECTIONS.find((x) => x[0] === this.section)[1], th.text);
    let y = 3;
    this.items.forEach((it, i) => {
      const on = focused && this.focus === 'content' && this.item === i;
      if (it.type === 'seg') {
        v.text(x0, y, it.label, on ? th.accent : th.dim);
        let x = x0;
        for (const [val, label] of it.options) {
          x += button(v, this.hits, x, y + 1, label, th, () => ((this.item = i), this.set(it.key, val)), { primary: s[it.key] === val }) + 1;
        }
        y += 3;
      } else if (it.type === 'swatch') {
        v.text(x0, y, it.label, on ? th.accent : th.dim);
        let x = x0;
        for (const [name, c] of Object.entries(ACCENTS)) {
          const chosen = s.accent === name;
          v.rect(x, y + 1, 4, 1, c);
          if (chosen) v.text(x + 1, y + 1, '✓', 0xffffff, c);
          this.hits.add(x, y + 1, 4, 1, () => ((this.item = i), this.set('accent', name)));
          x += 5;
        }
        v.text(x0, y + 2, s.accent, th.dim);
        y += 4;
      } else if (it.type === 'toggle') {
        const onv = !!s[it.key];
        v.text(x0, y, onv ? '◉' : '○', onv ? th.accent : th.dim);
        v.text(x0 + 2, y, it.label, on ? th.accent : th.text);
        this.hits.add(x0, y, 2 + len(it.label), 1, () => ((this.item = i), this.set(it.key, !onv)));
        y += 2;
      } else if (it.type === 'text') {
        it.lines.forEach((l, k) => v.text(x0, y + k, fit(l, w), th.dim));
        y += it.lines.length + 1;
      } else if (it.type === 'button') {
        button(v, this.hits, x0, y, it.label, th, () => it.run(), { danger: true });
        y += 2;
      } else if (it.type === 'wall') {
        const cols = Math.max(1, Math.floor((w + 2) / 16));
        const pwid = 14;
        const phei = 5;
        WALLPAPER_IDS.forEach((id, k) => {
          const cx = x0 + (k % cols) * 16;
          const cy = y + Math.floor(k / cols) * (phei + 2);
          if (cy + phei + 1 >= v.h) return;
          const chosen = s.wallpaper === id;
          const px = pwid * v.pw;
          const py = phei * v.ph;
          const data = this.preview(id, px, py);
          for (let j = 0; j < py; j++) for (let i2 = 0; i2 < px; i2++) v.px(cx * v.pw + i2, cy * v.ph + j, data[j * px + i2]);
          v.clearText(cx, cy, pwid, phei);
          if (chosen || this.item === 0 && this.sel === k && focused) {
            const c = chosen ? th.accent : th.text;
            v.pxRect(cx * v.pw - 1, cy * v.ph - 1, px + 2, 1, c);
            v.pxRect(cx * v.pw - 1, cy * v.ph + py, px + 2, 1, c);
            v.pxRect(cx * v.pw - 1, cy * v.ph - 1, 1, py + 2, c);
            v.pxRect(cx * v.pw + px, cy * v.ph - 1, 1, py + 2, c);
          }
          v.text(cx, cy + phei, fit(wallpaperName(id), pwid), chosen ? th.accent : th.dim);
          this.hits.add(cx, cy, pwid, phei + 1, () => ((this.sel = k), this.set('wallpaper', id)));
        });
      }
    });
  }
  key(e) {
    const k = e.key;
    const s = this.os.settings;
    if (k === 'tab') {
      this.focus = this.focus === 'side' ? 'content' : 'side';
      return true;
    }
    if (this.focus === 'side') {
      const i = SECTIONS.findIndex((x) => x[0] === this.section);
      if (k === 'up') this.go(SECTIONS[(i + SECTIONS.length - 1) % SECTIONS.length][0]);
      else if (k === 'down') this.go(SECTIONS[(i + 1) % SECTIONS.length][0]);
      else if (k === 'enter' || k === 'right') this.focus = 'content';
      else return false;
      return true;
    }
    const it = this.items[this.item];
    if (!it) return false;
    if (it.type === 'wall') {
      const ids = WALLPAPER_IDS;
      this.sel = this.sel ?? Math.max(0, ids.indexOf(s.wallpaper));
      if (k === 'left') this.sel = (this.sel + ids.length - 1) % ids.length;
      else if (k === 'right') this.sel = (this.sel + 1) % ids.length;
      else if (k === 'up') this.sel = Math.max(0, this.sel - 2);
      else if (k === 'down') this.sel = Math.min(ids.length - 1, this.sel + 2);
      else if (k === 'enter' || k === ' ') this.set('wallpaper', ids[this.sel]);
      else return false;
      return true;
    }
    if (k === 'up') this.item = Math.max(0, this.item - 1);
    else if (k === 'down') this.item = Math.min(this.items.length - 1, this.item + 1);
    else if (k === 'left' && this.items.length && it.type !== 'seg' && it.type !== 'swatch') this.focus = 'side';
    else if (it.type === 'seg' && (k === 'left' || k === 'right')) {
      const i = it.options.findIndex((o) => o[0] === s[it.key]);
      this.set(it.key, it.options[(i + (k === 'left' ? it.options.length - 1 : 1)) % it.options.length][0]);
    } else if (it.type === 'swatch' && (k === 'left' || k === 'right')) {
      const names = Object.keys(ACCENTS);
      const i = names.indexOf(s.accent);
      this.set('accent', names[(i + (k === 'left' ? names.length - 1 : 1)) % names.length]);
    } else if ((k === 'enter' || k === ' ') && it.type === 'toggle') this.set(it.key, !s[it.key]);
    else if (k === 'enter' && it.type === 'button') it.run();
    else return false;
    return true;
  }
  mouse(e) {
    if (e.kind === 'down' && e.button === 0) this.hits.click(e.x, e.y);
  }
}

export default {
  id: 'settings',
  name: 'System Settings',
  desc: 'Theme, wallpaper and display.',
  icon: 'settings',
  system: true,
  size: [92, 26],
  minSize: [60, 16],
  create: (os, win, data) => new Settings(os, win, data),
};
