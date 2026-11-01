// Small helpers shared by everything: colours are 0xRRGGBB integers (a '#rrggbb' string is accepted by col()).

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const R = (c) => (c >> 16) & 255;
export const G = (c) => (c >> 8) & 255;
export const B = (c) => c & 255;
export const rgb = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
export const col = (c) => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c);
export const lum = (c) => 0.299 * R(c) + 0.587 * G(c) + 0.114 * B(c);

export function mix(a, b, t) {
  a = col(a);
  b = col(b);
  return rgb(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t);
}
export const lighten = (c, t) => mix(c, 0xffffff, t);
export const darken = (c, t) => mix(c, 0x000000, t);

// A repeatable pseudo-random number from two integers (stars, dither).
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Bresenham line, calling plot(x, y) for each pixel.
export function line(x0, y0, x1, y1, plot) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 20000; guard++) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export const pad = (n, w = 2) => String(n).padStart(w, '0');

// Text width in cells (everything we draw is one cell wide).
export const len = (s) => [...s].length;
export function fit(s, w) {
  const a = [...s];
  return a.length <= w ? s : w <= 1 ? a.slice(0, Math.max(0, w)).join('') : a.slice(0, w - 1).join('') + '…';
}
