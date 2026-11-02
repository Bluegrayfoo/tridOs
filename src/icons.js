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
  notes: {c1:0xffd967,c2:0xe99d27,paint(g){g.rect(.18,.17,.64,.68,0xfff9e6);for(let i=0;i<3;i++){g.rect(.26,.32+i*.17,.09,.08,0xe9ae35);g.line(.43,.36+i*.17,.72,.36+i*.17,0x9d804c);}g.line(.25,.51,.29,.55,0x25795f);g.line(.29,.55,.38,.44,0x25795f);}},
  sheets: {c1:0x63cf9a,c2:0x13754e,paint(g){g.rect(.15,.19,.7,.63,0xebfff4);g.rect(.15,.19,.7,.14,0x9bdcbb);for(let i=1;i<4;i++){g.line(.15,.19+i*.16,.85,.19+i*.16,0x248560);g.line(.15+i*.175,.19,.15+i*.175,.82,0x248560);}g.rect(.51,.51,.16,.14,0xf6bf4c);}},
  monitor: {c1:0x4b6580,c2:0x1d2c43,paint(g){g.rect(.12,.19,.76,.55,0x0c1725);const p=[[.16,.53],[.3,.53],[.39,.34],[.49,.66],[.59,.44],[.67,.53],[.84,.53]];for(let i=1;i<p.length;i++)g.line(...p[i-1],...p[i],0x70efb2);g.rect(.46,.74,.08,.12,0xd0dfeb);g.rect(.3,.86,.4,.04,0xd0dfeb);}},
  disk: {c1:0xd6deea,c2:0x7f92aa,paint(g){g.rect(.17,.14,.66,.72,0x3d5067);g.ring(.5,.45,.24,0xe0e7f0,true);g.ring(.5,.45,.07,0x4c657f,true);g.line(.72,.75,.5,.45,0xffba56);g.rect(.23,.77,.1,.04,0x80f1bb);}},
  palette: {c1:0x9770ec,c2:0x48318e,paint(g){g.ring(.5,.5,.35,0xfff5e7,true);for(const [x,y,c] of [[.32,.32,0xff6b73],[.58,.27,0xffcb50],[.74,.48,0x4bcca1],[.57,.7,0x4baeff]])g.ring(x,y,.09,c,true);g.ring(.3,.61,.09,0x7652bf,true);}},
  calculator: {
    c1:0x546476,c2:0x263445,
    paint(g){g.rect(.17,.14,.66,.23,0xccead6);for(let y=0;y<3;y++)for(let x=0;x<3;x++)g.rect(.18+x*.24,.47+y*.15,.15,.1,x===2?0xffa23d:0xd7e0e9);},
  },
  converter: {
    c1:0x52d8b5,c2:0x168c85,
    paint(g){g.line(.2,.35,.8,.35,0xffffff);g.line(.8,.35,.62,.19,0xffffff);g.line(.8,.35,.62,.51,0xffffff);g.line(.8,.68,.2,.68,0xffffff);g.line(.2,.68,.38,.52,0xffffff);g.line(.2,.68,.38,.84,0xffffff);},
  },
  calendar: {
    c1:0xfffbf1,c2:0xdce5ef,
    paint(g){g.rect(.09,.13,.82,.22,0xe45855);g.rect(.26,.08,.07,.15,0x35475c);g.rect(.67,.08,.07,.15,0x35475c);for(let y=0;y<3;y++)for(let x=0;x<3;x++)g.rect(.23+x*.23,.44+y*.16,.1,.08,x===1&&y===1?0xe45855:0x66788f);},
  },
  tricycle: {
    c1: 0x43d5ec,
    c2: 0x1554b9,
    paint(g) {
      g.ring(.5, .5, .36, 0xe7faff, true);
      g.ring(.5, .5, .31, 0x2279c9, true);
      g.ring(.5, .5, .22, 0x83dff2);
      g.line(.19,.5,.81,.5,0x83dff2);
      g.line(.5,.19,.5,.81,0x83dff2);
      // A compass needle over a globe; the warm tip remains clear at dock size.
      for(let i=0;i<12;i++) {
        const t=i/12;
        g.line(.31+t*.19,.67-t*.17,.70-t*.20,.27+t*.23,0xffffff);
      }
      g.line(.50,.50,.70,.27,0xff7157);
      g.line(.53,.50,.70,.27,0xff7157);
      g.ring(.5,.5,.045,0x174681,true);
    },
  },
  clock: {
    c1: 0xffc35a,
    c2: 0xe67625,
    paint(g) {
      g.rect(.42,.10,.16,.06,0xfff5d6);
      g.rect(.47,.15,.06,.07,0xfff5d6);
      g.line(.71,.22,.77,.16,0xfff5d6);
      g.ring(.5,.55,.34,0x724323,true);
      g.ring(.5,.55,.30,0xfffbef,true);
      for(let i=0;i<12;i++) {
        const a=i*Math.PI/6;
        g.line(.5+Math.sin(a)*.24,.55-Math.cos(a)*.24,.5+Math.sin(a)*.27,.55-Math.cos(a)*.27,0x926b4b);
      }
      g.line(.5,.55,.5,.34,0x293746);
      g.line(.5,.55,.66,.63,0x293746);
      g.line(.5,.55,.36,.39,0xe56a28);
      g.ring(.5,.55,.035,0x293746,true);
    },
  },
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
  const key = typeof icon === 'string' ? icon : icon?.symbol;
  const def = Object.hasOwn(ICONS, key) ? ICONS[key] : null;
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
