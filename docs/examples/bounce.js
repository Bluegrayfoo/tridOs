// Bounce: pixel drawing and animation. Click to add a ball. Pixels are square, so a ball really is round.
module.exports = {
  name: 'Bounce',
  desc: 'Balls bouncing in pixels. Click to add one.',
  version: '1.0.0',
  icon: { color: '#0a84ff', glyph: 'B' },
  size: [56, 18],
  create(os, win) {
    const colors = [0xff453a, 0xff9f0a, 0xffd60a, 0x30d158, 0x0a84ff, 0xbf5af2];
    const balls = [];
    const add = (x, y) => balls.push({ x, y, vx: (Math.random() - 0.5) * 140, vy: (Math.random() - 0.5) * 80, r: 4 + Math.random() * 5, c: colors[balls.length % colors.length] });
    return {
      tick(dt, focused) {
        // v.pxW / v.pxH are only known while drawing, so the ball positions are in pixels and clamped in draw()
        for (const b of balls) {
          b.vy += 160 * dt; // gravity, in pixels per second squared
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        }
        return balls.length > 0;
      },
      draw(v) {
        v.fill(0x111114);
        for (const b of balls) {
          if (b.x < b.r) (b.x = b.r), (b.vx = Math.abs(b.vx));
          if (b.x > v.pxW - b.r) (b.x = v.pxW - b.r), (b.vx = -Math.abs(b.vx));
          if (b.y > v.pxH - b.r) (b.y = v.pxH - b.r), (b.vy = -Math.abs(b.vy) * 0.92);
          if (b.y < b.r) (b.y = b.r), (b.vy = Math.abs(b.vy));
          for (let dy = -b.r; dy <= b.r; dy++) {
            const half = Math.floor(Math.sqrt(b.r * b.r - dy * dy));
            v.pxRect(Math.round(b.x) - half, Math.round(b.y + dy), half * 2 + 1, 1, b.c); // one row of the disc
          }
        }
        v.text(1, 0, balls.length ? `${balls.length} balls   C: clear` : 'Click anywhere', 0x9a9aa6);
      },
      mouse(e) {
        if (e.kind === 'down') add(e.px, e.py); // px, py: the pointer in pixels inside the window
      },
      key(e) {
        if (e.key === 'c') balls.length = 0;
        if (e.key === 'enter') add(os.cv.pw * 10, os.cv.ph * 3);
      },
    };
  },
};
