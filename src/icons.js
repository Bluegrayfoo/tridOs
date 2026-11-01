// App icons, drawn in pixels at whatever size is asked for (a squircle with a gradient and a symbol on it).

import { mix, lighten, darken, col, line as bres } from './util.js';
import { pixelText, FONT_W, FONT_H } from './theme.js';

class IconCtx {
  constructor(cv, x, y, w, h) {
    Object.assign(this, { cv, x, y, w, h });
  }
  X(f) {
    return Math.round(this.x + f * (this.w - 1));
  }
  Y(f) {
    return Math.round(this.y + f * (this.h - 1));
  }
  px(fx, fy, c) {
    this.cv.px(this.X(fx), this.Y(fy), c);
  }
  rect(fx, fy, fw, fh, c) {
    const x0 = this.X(fx);
    const y0 = this.Y(fy);
    this.cv.pxRect(x0, y0, Math.max(1, Math.round(fw * this.w)), Math.max(1, Math.round(fh * this.h)), c);
  }
  line(fx0, fy0, fx1, fy1, c) {
    bres(this.X(fx0), this.Y(fy0), this.X(fx1), this.Y(fy1), (x, y) => this.cv.px(x, y, c));
  }
  ring(fcx, fcy, fr, c, fill = false) {
    const cx = this.X(fcx);
    const cy = this.Y(fcy);
    const rx = fr * (this.w - 1);
    const ry = fr * (this.h - 1);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (fill ? d <= 1 : d <= 1 && d > 1 - 1.2 / Math.min(rx, ry)) this.cv.px(x, y, c);
      }
    }
  }
}

export const ICONS = {
  appstore: {
    c1: 0x4cc9ff,
    c2: 0x0a5fff,
    paint(g) {
      const w = 0xffffff;
      g.line(0.5, 0.17, 0.27, 0.8, w);
      g.line(0.5, 0.17, 0.73, 0.8, w);
      g.line(0.34, 0.62, 0.66, 0.62, w);
      g.line(0.5, 0.17, 0.27, 0.8, w);
    },
  },
  finder: {
    c1: 0x8fdcff,
    c2: 0x1b8cff,
    paint(g) {
      g.rect(0.5, 0.04, 0.5, 0.94, 0x1c74e8);
      g.rect(0.5, 0.04, 0.03, 0.94, 0xeaf6ff);
      g.rect(0.28, 0.3, 0.07, 0.24, 0x16233b);
      g.rect(0.66, 0.3, 0.07, 0.24, 0xffffff);
      g.line(0.25, 0.7, 0.4, 0.8, 0x16233b);
      g.line(0.4, 0.8, 0.62, 0.8, 0x16233b);
      g.line(0.62, 0.8, 0.78, 0.7, 0xffffff);
    },
  },
  terminal: {
    c1: 0x3a3a42,
    c2: 0x0b0b0e,
    paint(g) {
      g.line(0.2, 0.3, 0.45, 0.5, 0xffffff);
      g.line(0.45, 0.5, 0.2, 0.7, 0xffffff);
      g.rect(0.55, 0.72, 0.28, 0.07, 0x30d158);
    },
  },
  editor: {
    c1: 0xffffff,
    c2: 0xd9dde6,
    paint(g) {
      for (let i = 0; i < 4; i++) g.rect(0.2, 0.24 + i * 0.16, 0.5 - (i === 3 ? 0.2 : 0), 0.06, 0x9aa1b0);
      g.line(0.9, 0.12, 0.52, 0.72, 0xff9f0a);
      g.line(0.82, 0.1, 0.46, 0.7, 0xffb340);
      g.px(0.5, 0.78, 0x333a47);
    },
  },
  grapher: {
    c1: 0xffffff,
    c2: 0xe4efff,
    paint(g) {
      g.line(0.12, 0.5, 0.9, 0.5, 0x99a1b3);
      g.line(0.5, 0.1, 0.5, 0.9, 0x99a1b3);
      let prev = null;
      for (let i = 0; i <= 24; i++) {
        const fx = 0.1 + (i / 24) * 0.8;
        const fy = 0.5 - Math.sin((i / 24) * Math.PI * 2) * 0.3;
        if (prev) g.line(prev[0], prev[1], fx, fy, 0xff453a);
        prev = [fx, fy];
      }
    },
  },
  studio: {
    c1: 0x6a4cff,
    c2: 0x1d0f5c,
    paint(g) {
      g.line(0.34, 0.28, 0.14, 0.5, 0xffffff);
      g.line(0.14, 0.5, 0.34, 0.72, 0xffffff);
      g.line(0.66, 0.28, 0.86, 0.5, 0xffffff);
      g.line(0.86, 0.5, 0.66, 0.72, 0xffffff);
      g.line(0.56, 0.22, 0.44, 0.78, 0xff6bd6);
    },
  },
  distributor: {
    c1: 0x3fe0b0,
    c2: 0x0a7a9a,
    paint(g) {
      const w = 0xffffff;
      g.line(0.5, 0.14, 0.5, 0.6, w);
      g.line(0.5, 0.14, 0.3, 0.34, w);
      g.line(0.5, 0.14, 0.7, 0.34, w);
      g.line(0.2, 0.52, 0.2, 0.84, w);
      g.line(0.8, 0.52, 0.8, 0.84, w);
      g.line(0.2, 0.84, 0.8, 0.84, w);
    },
  },
  settings: {
    c1: 0xc9cdd4,
    c2: 0x737982,
    paint(g) {
      const dark = 0x3a3f48;
      for (const [fx, fy] of [[0.5, 0.12], [0.5, 0.88], [0.12, 0.5], [0.88, 0.5], [0.23, 0.23], [0.77, 0.23], [0.23, 0.77], [0.77, 0.77]]) g.ring(fx, fy, 0.09, dark, true);
      g.ring(0.5, 0.5, 0.3, dark, true);
      g.ring(0.5, 0.5, 0.12, 0xc9cdd4, true);
    },
  },
};

// icon: an id from ICONS, or { color, glyph } for apps made in Code Studio.
export function drawIcon(cv, icon, x, y, w, h, { dim = 0 } = {}) {
  const def = typeof icon === 'string' ? ICONS[icon] : null;
  const base = def ? null : col((icon && icon.color) || 0x5b8def);
  const c1 = def ? def.c1 : lighten(base, 0.25);
  const c2 = def ? def.c2 : darken(base, 0.25);
  const r = Math.max(2, Math.round(Math.min(w, h) * 0.22));
  for (let j = 0; j < h; j++) {
    const c = mix(c1, c2, j / Math.max(1, h - 1));
    for (let i = 0; i < w; i++) {
      const dx = Math.max(r - 1 - i, i - (w - r), 0);
      const dy = Math.max(r - 1 - j, j - (h - r), 0);
      if (dx * dx + dy * dy > (r - 0.4) * (r - 0.4) && dx > 0 && dy > 0) continue;
      cv.px(x + i, y + j, c);
    }
  }
  const g = new IconCtx(cv, x, y, w, h);
  if (def) def.paint(g);
  else {
    const letter = String((icon && icon.glyph) || '?')[0] || '?';
    const s = Math.max(1, Math.floor(Math.min((w - 2) / FONT_W, (h - 2) / FONT_H)));
    pixelText(cv, letter, x + Math.floor((w - FONT_W * s) / 2), y + Math.floor((h - FONT_H * s) / 2), s, 0xffffff);
  }
  if (dim) cv.blendRect(x, y, w, h, 0x000000, dim);
}
