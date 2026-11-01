// Stopwatch: buttons, a timer driven by tick(dt), and state that survives a restart through save().
module.exports = {
  name: 'Stopwatch',
  desc: 'Start, stop and lap. Remembers its laps.',
  version: '1.0.0',
  icon: { color: '#ff453a', glyph: 'T' },
  size: [44, 15], // the window's content, in text cells: columns, rows
  create(os, win, saved) {
    const { button, Hits } = os.ui;
    const hits = new Hits(); // click targets, rebuilt on every draw
    let elapsed = (saved && saved.elapsed) || 0; // seconds
    let running = false;
    let laps = (saved && saved.laps) || [];
    const fmt = (s) => {
      const m = Math.floor(s / 60);
      return String(m).padStart(2, '0') + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
    };
    const toggle = () => (running = !running);
    const lap = () => running && laps.unshift(elapsed);
    const reset = () => {
      running = false;
      elapsed = 0;
      laps = [];
    };
    return {
      save: () => ({ elapsed, laps }), // whatever you return comes back as `saved` next time
      tick(dt) {
        if (!running) return false;
        elapsed += dt;
        return true; // true means "something changed, redraw"
      },
      draw(v) {
        const th = os.th;
        hits.reset();
        v.fill(th.bg);
        const big = fmt(elapsed);
        v.text(Math.floor((v.w - big.length) / 2), 1, big, running ? th.accent : th.text);
        let x = 3;
        x += button(v, hits, x, 3, running ? 'Stop' : 'Start', th, toggle, { primary: true, danger: running }) + 1;
        x += button(v, hits, x, 3, 'Lap', th, lap) + 1;
        button(v, hits, x, 3, 'Reset', th, reset);
        laps.slice(0, v.h - 7).forEach((t, i) => v.text(3, 6 + i, `Lap ${laps.length - i}   ${fmt(t)}`, th.dim));
        v.text(3, v.h - 1, 'Space: start/stop   L: lap', th.dim);
      },
      key(e) {
        if (e.key === ' ') toggle();
        else if (e.key === 'l') lap();
      },
      mouse(e) {
        if (e.kind === 'down') hits.click(e.x, e.y);
      },
    };
  },
};
