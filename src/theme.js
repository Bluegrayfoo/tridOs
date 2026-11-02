// Colours: light and dark themes, accent colours, and the wallpapers (generated at pixel size, so they fit any terminal).

import { mix, rgb, R, G, B, hash2, clamp, lighten, darken } from './util.js';

export const ACCENTS = {
  blue: 0x0a84ff,
  purple: 0xbf5af2,
  pink: 0xff375f,
  red: 0xff453a,
  orange: 0xff9f0a,
  yellow: 0xffd60a,
  green: 0x30d158,
  graphite: 0x98989d,
};

export function makeTheme(settings) {
  const dark = settings.theme !== 'light';
  const accent = ACCENTS[settings.accent] ?? ACCENTS.blue;
  const t = dark
    ? {
        dark,
        bg: 0x1e1e22,
        side: 0x28282e,
        bar: 0x38383f,
        barOff: 0x2c2c32,
        text: 0xf2f2f7,
        dim: 0x9a9aa6,
        line: 0x3f3f48,
        field: 0x131316,
        ctrl: 0x45454e,
        ctrlHi: 0x585863,
        menu: 0x1c1c22,
        menuText: 0xf2f2f7,
        dockBg: 0x202028,
        sheet: 0x2c2c33,
      }
    : {
        dark,
        bg: 0xffffff,
        side: 0xeceaf0,
        bar: 0xe4e2e8,
        barOff: 0xf1eff4,
        text: 0x1d1d1f,
        dim: 0x76767f,
        line: 0xc9c7cf,
        field: 0xffffff,
        ctrl: 0xe3e1e7,
        ctrlHi: 0xd2d0d8,
        menu: 0xf4f2f8,
        menuText: 0x1d1d1f,
        dockBg: 0xf4f4f8,
        sheet: 0xf6f5f9,
      };
  t.accent = accent;
  t.accentText = 0xffffff;
  t.sel = mix(t.bg, accent, dark ? 0.45 : 0.28);
  t.danger = 0xff453a;
  t.ok = 0x30d158;
  t.warn = 0xffd60a;
  t.close = 0xff5f57;
  t.min = 0xfebc2e;
  t.zoom = 0x28c840;
  return t;
}

// --- wallpapers ---
// Each makes W x H pixels as a Uint32Array of 0xRRGGBB.

function gradient(y, H, stops) {
  const t = clamp(y / Math.max(1, H - 1), 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[i], stops[i + 1], t - i);
}

function build(W, H, fn) {
  const a = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = fn(x, y);
  return a;
}

const WALLPAPERS = {
  dunes: {
    name: 'Dunes',
    make(W, H) {
      return build(W, H, (x, y) => {
        const u = x / W, v = y / H;
        let c = gradient(y, H, [0x322849, 0xc98579, 0xf4d3a4]);
        if (Math.hypot((x-W*.73), (y-H*.28)) < Math.min(W,H)*.075) c = 0xffe9bd;
        const layers = [[.49,.08,3.5,0xdaa074],[.65,.11,4.7,0xb86d51],[.83,.12,3.2,0x713d42]];
        layers.forEach(([base,amp,f,color],i) => {
          const edge = base + Math.sin(u*f+i*2)*amp + Math.sin(u*9+i)*.015;
          if(v>edge)c=mix(color,darken(color,.28),clamp((v-edge)*3,0,1));
        });
        return c;
      });
    },
  },
  alpine: {
    name: 'Alpine',
    make(W, H) {
      return build(W, H, (x, y) => {
        const u=x/W,v=y/H;
        let c=gradient(y,H,[0x789ebc,0xc7d7db,0xe9e5d6]);
        const peaks=[[.23,.72,.28,0x71879b],[.61,.62,.20,0x4f687e],[.85,.52,.40,0x354d64]];
        for(const [center,width,top,color] of peaks){
          const ridge=top+Math.abs(u-center)/width*.63;
          if(v>ridge){c=u<center?mix(color,0xdce5e4,.15):color;
            if(v<ridge+.09 && ridge<top+.20+Math.sin(u*41)*.015)c=u<center?0xf1f2e8:0xb7cbd4;}
        }
        if(v>.85+Math.sin(u*9)*.04)c=0x263f4c;
        return c;
      });
    },
  },
  moonlake: {
    name: 'Moonlit Lake',
    make(W, H) {
      const radius=Math.min(W,H)*.09;
      return build(W,H,(x,y)=>{
        const u=x/W,v=y/H;
        let c=gradient(y,H,[0x080d28,0x273e64,0x47617b]);
        if(v<.5 && hash2(x,y)>.9985)c=0xaac7e7;
        if(Math.hypot(x-W*.68,y-H*.25)<radius)c=0xe4e9d7;
        if(v>.54+Math.sin(u*13)*.06+Math.sin(u*29)*.025)c=0x12233c;
        if(v>.66){
          c=gradient(y-H*.66,H*.34,[0x314f6b,0x0a172b]);
          const spread=.025+(v-.66)*.24,shift=Math.sin(v*130)*.018;
          const shimmer=Math.max(0,1-Math.abs(u-.68+shift)/spread);
          c=mix(c,0xb6ced3,shimmer*(.15+.35*Math.max(0,Math.sin(v*220))));
        }
        return c;
      });
    },
  },
  neon: {
    name: 'Neon Grid',
    make(W,H){
      return build(W,H,(x,y)=>{
        const u=x/W,v=y/H;
        let c=gradient(y,H,[0x100c2e,0x351b50,0x100d28]);
        const d=Math.hypot(x-W*.5,y-H*.43),r=Math.min(W,H)*.17;
        if(d<r && (v<.43 || Math.floor(v*100)%4!==0))c=gradient(y-H*.26,H*.34,[0xffce78,0xf752a1]);
        if(v>.63){
          const depth=(v-.63)/.37;
          c=mix(0x201039,0x080c22,depth);
          const ray=(u-.5)/Math.max(.02,depth)*8;
          const rayIndex=Math.round(ray);
          const vertical=Math.abs(rayIndex)<=12 && Math.abs(u-(.5+rayIndex*depth/8))<.65/W;
          const row=Math.round(1/Math.max(.025,depth));
          const horizontal=row<=14 && Math.abs(depth-1/row)<.65/(H*.37);
          if(vertical || horizontal)c=mix(0x7345aa,0xcb59cb,depth);
        }
        return c;
      });
    },
  },
  paper: {
    name: 'Paper',
    make(W,H){
      return build(W,H,(x,y)=>{
        const u=x/W,v=y/H;
        let c=gradient(y,H,[0xeee9de,0xd6cfbf]);
        const shade=Math.max(0,1-Math.abs(u*.7+v-.8)/.5);
        c=mix(c,0xb8b09d,shade*.12);
        return mix(c,0xffffff,hash2(x,y)*.045);
      });
    },
  },

  waves: {
    name: 'Waves',
    make(W, H) {
      const layers = [
        [0x5a2d91, 0.42, 5.2, 0.9, 0.1],
        [0x8e3b9f, 0.52, 3.6, 2.1, 0.09],
        [0xc2478f, 0.62, 4.4, 4.0, 0.08],
        [0xf06a76, 0.72, 3.0, 0.5, 0.07],
        [0xffa15c, 0.83, 3.8, 3.1, 0.06],
      ];
      return build(W, H, (x, y) => {
        let c = gradient(y, H, [0x1b1147, 0x3a2a86, 0x6a4cb0]);
        const u = x / W;
        for (const [color, base, f, ph, amp] of layers) {
          const edge = H * (base + Math.sin(u * f * Math.PI + ph) * amp + Math.sin(u * f * 2.3 * Math.PI + ph * 1.7) * amp * 0.35);
          if (y > edge) c = mix(color, darken(color, 0.25), clamp((y - edge) / (H * 0.35), 0, 1));
        }
        return c;
      });
    },
  },
  aurora: {
    name: 'Aurora',
    make(W, H) {
      return build(W, H, (x, y) => {
        const u = x / W;
        const v = y / H;
        const base = gradient(y, H, [0x050a1c, 0x0b1f3a, 0x10122e]);
        const band = (c, y0, f, ph, w) => {
          const centre = H * (y0 + 0.08 * Math.sin(u * f * Math.PI + ph) + 0.04 * Math.sin(u * f * 2.7 * Math.PI + ph));
          const d = Math.abs(y - centre) / (H * w);
          return d < 1 ? Math.pow(1 - d, 2) * 0.75 : 0;
        };
        let c = base;
        c = mix(c, 0x2effb0, band(0, 0.38, 3.1, 0.3, 0.22));
        c = mix(c, 0x45a1ff, band(0, 0.52, 2.2, 1.7, 0.2));
        c = mix(c, 0xb45cff, band(0, 0.64, 2.8, 3.4, 0.16));
        if (v < 0.5 && hash2(x, y) > 0.998) c = 0xffffff;
        return c;
      });
    },
  },
  sunset: {
    name: 'Sunset',
    make(W, H) {
      const sx = W * 0.5;
      const sy = H * 0.62;
      const sr = Math.min(W, H * 2) * 0.13;
      return build(W, H, (x, y) => {
        let c = gradient(y, H, [0x1d1a4a, 0x7a2d7e, 0xff5e62, 0xffc371]);
        const d = Math.hypot(x - sx, (y - sy) * 1.0);
        if (d < sr) c = mix(0xfff2c4, 0xffb86b, d / sr);
        else if (d < sr * 2.2) c = mix(c, 0xffd28a, (1 - (d - sr) / (sr * 1.2)) * 0.5);
        const hill = H * (0.78 + 0.06 * Math.sin((x / W) * 7) + 0.03 * Math.sin((x / W) * 19));
        if (y > hill) c = mix(0x24142e, 0x0c0612, (y - hill) / (H - hill + 1));
        return c;
      });
    },
  },
  ocean: {
    name: 'Ocean',
    make(W, H) {
      return build(W, H, (x, y) => {
        const c = gradient(y, H, [0x0b1d33, 0x12507a, 0x2aa3c4]);
        const wave = Math.sin(x * 0.045 + y * 0.35) * 0.5 + Math.sin(x * 0.021 - y * 0.2) * 0.5;
        return mix(c, 0xbff3ff, clamp(wave * 0.12 * (y / H), 0, 0.2));
      });
    },
  },
  forest: {
    name: 'Forest',
    make(W, H) {
      const ridges = [
        [0xa9c6b4, 0.5, 0.05],
        [0x6aa07f, 0.6, 0.07],
        [0x3d7a58, 0.7, 0.08],
        [0x1f5238, 0.82, 0.09],
      ];
      return build(W, H, (x, y) => {
        let c = gradient(y, H, [0xbfe3f4, 0xeaf6fb]);
        const u = x / W;
        ridges.forEach(([color, base, amp], i) => {
          const edge = H * (base + Math.sin(u * (5 + i * 2.3) + i * 1.9) * amp + Math.sin(u * (13 + i * 3) + i) * amp * 0.4);
          if (y > edge) c = mix(color, darken(color, 0.3), clamp((y - edge) / (H * 0.3), 0, 1));
        });
        return c;
      });
    },
  },
  pixelhills: {
    name: 'Pixel Hills',
    make(W, H) {
      const step = 6;
      return build(W, H, (x, y) => {
        let c = gradient(y, H, [0x2a2f6e, 0x6a5acd, 0xf6a6c1, 0xffe0a3]);
        const bx = Math.floor(x / step) * step;
        const u = bx / W;
        // a checkerboard dither between the sky bands
        if ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0) c = darken(c, 0.04);
        const sunx = W * 0.72;
        const suny = H * 0.38;
        const sr = Math.min(W, H * 2) * 0.1;
        if (Math.hypot(Math.floor(x / 3) * 3 - sunx, Math.floor(y / 3) * 3 - suny) < sr) c = 0xfff4c2;
        const hills = [
          [0x4d3a8c, 0.6, 0.08, 1.7],
          [0x2f4f8c, 0.7, 0.07, 3.1],
          [0x1f6b6b, 0.8, 0.06, 0.6],
          [0x153d3a, 0.9, 0.05, 2.4],
        ];
        for (const [color, base, amp, ph] of hills) {
          const edge = Math.round((H * (base + Math.sin(u * 9 + ph) * amp + Math.sin(u * 21 + ph) * amp * 0.3)) / step) * step;
          if (y >= edge) c = color;
        }
        return c;
      });
    },
  },
  midnight: {
    name: 'Midnight',
    make(W, H) {
      return build(W, H, (x, y) => {
        const d = Math.hypot((x - W / 2) / W, (y - H / 2) / H);
        let c = mix(0x161a3a, 0x05060f, clamp(d * 1.6, 0, 1));
        const h = hash2(x, y);
        if (h > 0.9965) c = lighten(c, 0.9);
        else if (h > 0.992) c = lighten(c, 0.45);
        return c;
      });
    },
  },
  graphite: {
    name: 'Graphite',
    make(W, H) {
      return build(W, H, (x, y) => gradient(y, H, [0x3a3a40, 0x1c1c20]));
    },
  },
  rose: {
    name: 'Rose',
    make(W, H) {
      return build(W, H, (x, y) => mix(gradient(y, H, [0xffd1dc, 0xf7a8c4, 0xb77bd6]), 0xffffff, hash2(x >> 1, y >> 1) * 0.015));
    },
  },
};

export const WALLPAPER_IDS = Object.keys(WALLPAPERS);
export const wallpaperName = (id) => (WALLPAPERS[id] || WALLPAPERS.waves).name;

const cache = new Map();
export function wallpaper(id, W, H) {
  const key = `${id}:${W}x${H}`;
  if (!cache.has(key)) {
    if (cache.size > 6) cache.clear();
    const gen = (WALLPAPERS[id] || WALLPAPERS.waves).make;
    // a big screen is made at a lower resolution and enlarged (fast, and a little chunkier, like the rest of the pixels)
    const k = Math.max(1, Math.ceil(Math.sqrt((W * H) / 300000)));
    if (k === 1) cache.set(key, gen(W, H));
    else {
      const gw = Math.ceil(W / k);
      const gh = Math.ceil(H / k);
      const small = gen(gw, gh);
      const big = new Uint32Array(W * H);
      for (let y = 0; y < H; y++) {
        const row = Math.floor(y / k) * gw;
        for (let x = 0; x < W; x++) big[y * W + x] = small[row + Math.floor(x / k)];
      }
      cache.set(key, big);
    }
  }
  return cache.get(key);
}

// A tiny pixel font (3x5) for logos and icon letters.
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '.': '000000000000010', '-': '000000111000000', '+': '000010111010000', ' ': '000000000000000',
};
export const FONT_W = 3;
export const FONT_H = 5;
// Draw a string in the pixel font at pixel (x, y), each font pixel s x s screen pixels. Returns the width drawn.
export function pixelText(cv, str, x, y, s, color) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch];
    if (g) {
      for (let i = 0; i < 15; i++) if (g[i] === '1') cv.pxRect(cx + (i % 3) * s, y + Math.floor(i / 3) * s, s, s, color);
    }
    cx += 4 * s;
  }
  return cx - x;
}
export const pixelTextWidth = (str, s) => str.length * 4 * s - s;
