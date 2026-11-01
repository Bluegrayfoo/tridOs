// Drives TridOS without a terminal: feeds it keys and mouse events, draws frames and checks what is on screen.
import fs from 'node:fs';
import os_ from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os_.tmpdir(), 'tridos-test-')) + '/h';
process.env.TRIDOS_HOME = home;
const OFFLINE_CATALOG = 'http://127.0.0.1:1/contents'; // tests never reach the real GitHub: the catalog is somewhere that refuses
process.env.TRIDOS_CATALOG_API = OFFLINE_CATALOG;
const { OS } = await import('../src/os.js');
const { KeyParser } = await import('../src/term.js');
const { Canvas, Renderer, textLayer } = await import('../src/gfx.js');
const { OCTANTS, SEXTANTS } = await import('../src/glyphs.js');
const { compile } = await import('../src/apps/grapher.js');
const { DISK, APPS_DIR, STATE_FILE } = await import('../src/fs.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('ok -', name);
  } catch (e) {
    console.log('NOT OK -', name);
    console.log(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await sleep(25);
};
const screen = (os) => {
  os.draw();
  return textLayer(os.cv);
};
const key = (os, k, mods = {}, text) => os.onEvent({ type: 'key', key: k, ctrl: false, alt: false, shift: false, ...mods, text });
const type = (os, s) => [...s].forEach((c) => key(os, c, {}, c));
// The terminal reports character cells; tests think in text cells, so turn one into the other (aiming at the middle of the text cell).
const MODES_PX = { octant: [2, 4], sextant: [2, 3], half: [1, 2] };
const term = (os, lx, ly) => [Math.floor(((lx + 0.5) * os.cv.pw) / os.cv.tpw), Math.floor(((ly + 0.5) * os.cv.ph) / os.cv.tph)];
const mouse = (os, kind, lx, ly, button = 0, extra = {}) => {
  const [x, y] = term(os, lx, ly);
  os.onEvent({ type: 'mouse', kind, button, x, y, ...extra });
};
const click = (os, x, y, button = 0) => {
  mouse(os, 'down', x, y, button);
  mouse(os, 'up', x, y, button);
};
const move = (os, x, y) => mouse(os, 'move', x, y);
const drag = (os, x0, y0, x1, y1) => {
  mouse(os, 'down', x0, y0);
  mouse(os, 'drag', x1, y1);
  mouse(os, 'up', x1, y1);
};
// A desktop of 130x40 text cells at text size 1: the terminal needs 130*6 x 40*10 pixels.
const termSize = (mode = 'octant') => {
  const [pw, ph] = MODES_PX[mode];
  return { cols: Math.ceil((130 * 6) / pw), rows: Math.ceil((40 * 10) / ph) };
};
const newOS = (settings = {}) => new OS({ ...termSize(settings.pixelMode), settings: { boot: false, wallpaper: 'graphite', textScale: 1, ...settings } });
const fresh = (settings = {}) => newOS(settings);
const dockIdx = (os, id) => os.dockLayout.findIndex((d) => d.def.id === id);
const tickFor = async (os, seconds) => {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    for (const w of os.windows) w.app?.tick?.(0.05, true);
    await sleep(50);
  }
};

await test('glyph tables: all 256 octant and 64 sextant patterns, every one different', () => {
  assert.equal(OCTANTS.length, 256);
  assert.equal(new Set(OCTANTS).size, 256);
  assert.equal(SEXTANTS.length, 64);
  assert.equal(new Set(SEXTANTS).size, 64);
  assert.equal(OCTANTS[0], ' ');
  assert.equal(OCTANTS[255], '█');
  assert.equal(OCTANTS[0b11], '\u{1FB82}'); // the top two cells: UPPER ONE QUARTER BLOCK
  assert.equal(OCTANTS[0b100], '\u{1CD00}'); // cell 3 alone: BLOCK OCTANT-3
});

await test('key parser: arrows, modifiers, mouse, ctrl, alt and split escape sequences', () => {
  const ev = [];
  const p = new KeyParser((e) => ev.push(e));
  p.feed('\x1b[A\x1b[1;2B\x1b[1;5C\x1bOD');
  assert.deepEqual(ev.map((e) => e.key), ['up', 'down', 'right', 'left']);
  assert.ok(ev[1].shift && ev[2].ctrl);
  ev.length = 0;
  p.feed('\x1b[<0;12;5M\x1b[<0;12;5m\x1b[<35;3;4M\x1b[<32;9;9M\x1b[<64;5;5M\x1b[<65;5;5M');
  assert.deepEqual(ev.map((e) => [e.kind, e.x, e.y]), [['down', 11, 4], ['up', 11, 4], ['move', 2, 3], ['drag', 8, 8], ['wheel', 4, 4], ['wheel', 4, 4]]);
  assert.deepEqual(ev.slice(4).map((e) => e.dir), [-1, 1]);
  ev.length = 0;
  p.feed('a\rA\x03\x7f\tπ\x1bb');
  assert.deepEqual(ev.map((e) => e.key), ['a', 'enter', 'A', 'c', 'backspace', 'tab', 'π', 'b']);
  assert.ok(ev[3].ctrl && ev[2].shift && ev[7].alt);
  assert.equal(ev[2].text, 'A');
  ev.length = 0;
  p.feed('\x1b[');
  p.feed('B');
  p.feed('\x1b[<0;1');
  p.feed('0;20M');
  assert.deepEqual(ev.map((e) => e.key || e.kind), ['down', 'down']);
  assert.equal(ev[1].x, 9);
  assert.equal(ev[1].y, 19);
});

await test('renderer: draws, then sends nothing when the frame has not changed', () => {
  const cv = new Canvas(20, 6, 'octant');
  cv.fill(0x112233);
  cv.pxRect(3, 3, 5, 9, 0xffffff);
  cv.text(2, 1, 'hello', 0xff0000);
  const r = new Renderer({ truecolor: true });
  const a = r.flush(cv);
  assert.ok(a.includes('38;2;255;0;0'), 'the red text pixels were sent');
  assert.equal(cv.tch[1 * cv.cols + 2], 'h', 'and the text is recorded');
  assert.equal(r.flush(cv), '');
  cv.px(0, 0, 0xffffff);
  assert.ok(r.flush(cv).length > 0);
  const r2 = new Renderer({ truecolor: false });
  assert.ok(/38;5;\d+/.test(r2.flush(cv)) || /48;5;\d+/.test(r2.flush(new Canvas(2, 2))));
});

await test('expression language', () => {
  const run = (src, x = 0, vars = {}, funcs = {}) => compile(src, Object.fromEntries(Object.keys(funcs).map((k) => [k, 1])))({ x, vars, funcs });
  assert.equal(run('2x + 1', 3), 7);
  assert.equal(run('x^2', 4), 16);
  assert.equal(run('-x^2', 3), -9);
  assert.equal(run('2^3^2'), 512);
  assert.ok(Math.abs(run('sin(pi/2)') - 1) < 1e-12);
  assert.equal(run('3(x+1)', 1), 6);
  assert.equal(run('(x+1)(x-1)', 3), 8);
  assert.equal(run('a x', 2, { a: 5 }), 10);
  assert.equal(run('abs(-4) + sqrt(9)'), 7);
  assert.equal(run('|x - 5|', 2), 3);
  assert.equal(run('f(3) + 1', 0, {}, { f: (x) => x * 2 }), 7);
  assert.throws(() => compile('2 +'), /too soon/);
  assert.throws(() => compile('3 $ 4'), /Unexpected/);
  assert.throws(() => compile('sin'), /needs/);
});

await test('a fresh TridOS has the App Store and nothing else in the Dock', () => {
  const os = fresh();
  os.start();
  clearInterval(os.timer);
  screen(os);
  assert.deepEqual(os.installed, ['appstore']);
  assert.deepEqual(os.dockItems().map((d) => d.id), ['appstore']);
  assert.ok(fs.existsSync(path.join(DISK, 'Documents', 'Welcome.txt')));
});

await test('App Store: Get downloads an app, it lands in the Dock, and the Finder opens', async () => {
  const os = fresh();
  os.launch('appstore');
  let s = screen(os);
  assert.match(s, /Discover/);
  assert.match(s, /Finder/);
  assert.match(s, /Terminal/);
  assert.match(s, /Text Editor/);
  assert.match(s, /Grapher/);
  assert.match(s, /Code Studio/);
  assert.doesNotMatch(s, /System Settings.*Free/);
  key(os, 'enter'); // Get the first one (Finder)
  await tickFor(os, 2.6);
  assert.ok(os.isInstalled('finder'), 'finder installed');
  s = screen(os);
  assert.ok(dockIdx(os, 'finder') >= 0);
  assert.match(s, /Open/);
  key(os, 'enter'); // now Open
  assert.ok(os.windows.some((w) => w.def.id === 'finder'));
  for (const id of ['terminal', 'editor', 'grapher', 'studio']) os.install(id);
  assert.equal(os.dockItems().length, 6);
});

await test('every app opens, draws a full frame and takes keys without errors', () => {
  const os = fresh();
  for (const id of ['finder', 'terminal', 'editor', 'grapher', 'studio']) os.install(id);
  for (const id of ['appstore', 'finder', 'terminal', 'editor', 'grapher', 'studio', 'settings']) {
    const w = os.launch(id);
    assert.ok(w, id + ' opened');
    screen(os);
    for (const k of ['up', 'down', 'left', 'right', 'tab', 'enter']) key(os, k);
    screen(os);
    assert.ok(!w.errored, id + ' drew without an error');
  }
  assert.ok(os.windows.length >= 7); // (Enter in the App Store opened a second Text Editor: that one allows many windows)
});

await test('windows: drag by the title, resize by the corner, zoom, minimize, close', () => {
  const os = fresh();
  os.install('finder');
  const w = os.launch('finder');
  screen(os);
  const { x, y } = w;
  drag(os, x + 20, y, x + 30, y + 3);
  assert.equal(w.x, x + 10);
  assert.equal(w.y, y + 3);
  const ww = w.w;
  drag(os, w.x + w.w - 1, w.y + w.h - 1, w.x + w.w + 5, w.y + w.h + 1);
  assert.equal(w.w, ww + 6);
  screen(os);
  click(os, w.x + 6, w.y); // green: zoom
  assert.ok(w.zoom);
  assert.equal(w.x, 0);
  click(os, w.x + 6, w.y);
  assert.ok(!w.zoom);
  screen(os);
  click(os, w.x + 4, w.y); // yellow: minimize
  assert.ok(w.minimized);
  screen(os);
  const d = os.dockLayout[dockIdx(os, 'finder')];
  click(os, d.x + 1, d.y + 1); // the Dock brings it back
  assert.ok(!w.minimized);
  screen(os);
  click(os, w.x + 2, w.y); // red: close
  assert.ok(!os.windows.includes(w));
});

await test('menu bar: the Apple menu opens System Settings; keyboard menu navigation works', () => {
  const os = fresh();
  screen(os);
  click(os, 2, 0);
  move(os, 90, 30); // (the pointer would cover the first lines)
  let s = screen(os);
  assert.match(s, /About TridOS/);
  assert.match(s, /System Settings/);
  assert.match(s, /Shut Down/);
  const box = os.menuBox;
  click(os, box.x + 3, box.y + 2); // System Settings...
  assert.ok(os.windows.some((w) => w.def.id === 'settings'));
  // keyboard: Esc, up to the menu bar, down opens, Enter picks
  os.windows.length = 0;
  key(os, 'escape');
  assert.ok(os.nav);
  screen(os);
  key(os, 'up');
  key(os, 'down');
  assert.ok(os.menu);
  key(os, 'down');
  key(os, 'enter');
  assert.ok(os.windows.some((w) => w.def.id === 'settings'));
});

await test('keyboard: Esc, arrows and Enter launch from the Dock; Tab and arrows move windows', () => {
  const os = fresh();
  for (const id of ['finder', 'terminal']) os.install(id);
  screen(os);
  key(os, 'escape');
  assert.equal(os.nav.zone, 'dock');
  key(os, 'right');
  key(os, 'enter');
  assert.ok(os.windows.some((w) => w.def.id === 'finder'));
  assert.equal(os.nav, null);
  key(os, 'escape');
  assert.equal(os.nav.zone, 'win');
  const w = os.focused;
  const x = w.x;
  key(os, 'right');
  assert.equal(w.x, x + 2);
  key(os, 'enter');
  assert.equal(os.nav, null);
});

await test('settings: theme, accent, wallpaper, pixel mode all apply and are saved between sessions', () => {
  const os = fresh();
  const w = os.launch('settings');
  screen(os);
  assert.match(screen(os), /Appearance/);
  os.set = null;
  w.app.set('theme', 'light');
  assert.equal(os.th.dark, false);
  w.app.set('accent', 'green');
  assert.equal(os.th.accent, 0x30d158);
  w.app.set('wallpaper', 'sunset');
  w.app.go('wallpaper');
  assert.match(screen(os), /Sunset/);
  w.app.set('pixelMode', 'sextant');
  assert.equal(os.cv.tph, 3);
  screen(os);
  w.app.set('pixelMode', 'half');
  assert.equal(os.cv.tph, 2);
  screen(os);
  w.app.set('pixelMode', 'octant');
  os.saveNow();
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  assert.equal(saved.settings.theme, 'light');
  assert.equal(saved.settings.accent, 'green');
  assert.equal(saved.settings.wallpaper, 'sunset');
  const again = newOS();
  assert.equal(again.settings.theme, 'light');
  assert.equal(again.th.accent, 0x30d158);
  again.restoreWindows();
  assert.ok(again.windows.some((x) => x.def.id === 'settings'), 'the open Settings window came back');
  // and put the dark theme back for the other tests
  w.app.set('theme', 'dark');
  w.app.set('wallpaper', 'graphite');
});

await test('installed apps and open windows come back after a restart', () => {
  const a = fresh();
  for (const id of ['finder', 'grapher']) a.install(id);
  const g = a.launch('grapher');
  g.app.input.set('y = x^3');
  g.app.commit();
  a.saveNow();
  const b = newOS();
  assert.ok(b.isInstalled('finder') && b.isInstalled('grapher'));
  b.restoreWindows();
  const gw = b.windows.find((w) => w.def.id === 'grapher');
  assert.ok(gw);
  assert.equal(gw.app.exprs[0], 'y = x^3');
});

await test('Finder: new folder, new file, rename, trash, navigate', () => {
  const os = fresh();
  os.install('finder');
  const w = os.launch('finder');
  const f = w.app;
  f.goTo(path.join(DISK, 'Documents'));
  screen(os);
  f.newFolder();
  assert.ok(os.modal, 'asks for a name');
  os.modal.input.li = new os.ui.LineInput('Projects');
  key(os, 'enter');
  assert.ok(fs.existsSync(path.join(DISK, 'Documents', 'Projects')));
  assert.match(screen(os), /Projects/);
  f.sel = f.items.findIndex((i) => i.name === 'Projects');
  key(os, 'enter'); // opens the folder
  assert.equal(path.basename(f.cwd), 'Projects');
  key(os, 'backspace'); // up
  assert.equal(path.basename(f.cwd), 'Documents');
  f.sel = f.items.findIndex((i) => i.name === 'Projects');
  f.trash();
  assert.ok(!fs.existsSync(path.join(DISK, 'Documents', 'Projects')));
  assert.ok(fs.readdirSync(path.join(DISK, '.Trash')).some((n) => n.startsWith('Projects')));
  f.goTo(path.join(DISK, '..', '..'));
  assert.equal(f.cwd, DISK, 'cannot leave the disk');
});

await test('Text Editor: type, save, reopen from Finder, undo', () => {
  const os = fresh();
  os.install('editor');
  const w = os.launch('editor');
  const e = w.app;
  type(os, 'Hello');
  key(os, 'enter');
  type(os, 'World');
  assert.equal(e.ta.getText(), 'Hello\nWorld');
  key(os, 'z', { ctrl: true });
  assert.ok(e.ta.getText().length < 'Hello\nWorld'.length);
  key(os, 'y', { ctrl: true });
  assert.equal(e.ta.getText(), 'Hello\nWorld');
  e.write(path.join(DISK, 'Documents', 'hi.txt'));
  assert.equal(fs.readFileSync(path.join(DISK, 'Documents', 'hi.txt'), 'utf8'), 'Hello\nWorld');
  assert.ok(!e.ta.modified);
  assert.match(w.app.title(), /hi\.txt/);
  os.openFile(path.join(DISK, 'Documents', 'hi.txt'));
  assert.equal(os.windows.filter((x) => x.def.id === 'editor').length, 1, 'the same file focuses its window');
  type(os, '!');
  os.closeWindow(w);
  assert.ok(os.modal && /Unsaved/.test(os.modal.title), 'asks before closing unsaved work');
  key(os, 'escape');
  assert.ok(os.windows.includes(w));
});

await test('Terminal: builtins and the real shell', async () => {
  const os = fresh();
  os.install('terminal');
  const w = os.launch('terminal');
  const t = w.app;
  t.run('echo hello world');
  await sleep(400);
  t.run('mkdir stuff');
  t.run('cd stuff');
  t.run('pwd');
  t.run('cd ..');
  t.run('ls');
  assert.ok(fs.existsSync(path.join(DISK, 'stuff')));
  const text = t.lines.map((l) => l.t).join('\n');
  assert.match(text, /hello world/);
  assert.match(text, /~\/stuff/);
  t.run('echo $((6*7))');
  await sleep(500);
  assert.ok(t.lines.some((l) => l.t === '42'), 'a shell command ran');
  t.run('cd /');
  assert.equal(t.cwd, DISK, 'cd cannot leave the disk');
  assert.match(screen(os), /tridos/);
  type(os, 'ls');
  key(os, 'enter');
  assert.ok(t.history.includes('ls'));
});

await test('Grapher: plots, pans and zooms; bad input shows an error, not a crash', () => {
  const os = fresh();
  os.install('grapher');
  const w = os.launch('grapher');
  const g = w.app;
  let s = screen(os);
  assert.match(s, /Expressions/);
  assert.match(s, /y = sin\(x\)/);
  const before = os.cv.pix.slice();
  g.exprs[0] = 'y = cos(x';
  g.active = 0;
  g.input.set('y = cos(x');
  g.commit();
  s = screen(os);
  assert.match(s, /Missing \)/);
  g.input.set('y = x^2');
  g.commit();
  screen(os);
  const cx = g.cx;
  key(os, 'tab');
  key(os, 'right');
  assert.ok(g.cx > cx, 'panned');
  key(os, '+');
  assert.ok(g.scale > 0, 'zoomed');
  key(os, '0');
  assert.equal(g.scale, 0);
  const gx = w.x + g.geom.gx + 10;
  mouse(os, 'wheel', gx, w.y + 8, 0, { dir: -1 });
  assert.ok(g.scale > 0);
  drag(os, gx, w.y + 8, gx + 6, w.y + 8);
  assert.notEqual(g.cx, 0);
  assert.notDeepEqual(Array.from(before.slice(0, 50)), Array.from(os.cv.pix.slice(0, 50)).map(() => -1));
});

await test('Code Studio: make an app from a template, run it, and it is in the Dock', () => {
  const os = fresh();
  os.install('studio');
  const w = os.launch('studio');
  const st = w.app;
  screen(os);
  st.newApp();
  assert.ok(os.modal && /template/.test(os.modal.message));
  os.closeModal(1); // Hello
  assert.ok(os.modal && /Name/.test(os.modal.message));
  os.modal.input.li = new os.ui.LineInput('Test Thing');
  key(os, 'enter');
  assert.ok(fs.existsSync(path.join(APPS_DIR, 'test-thing.js')));
  assert.equal(st.file, 'test-thing.js');
  assert.match(screen(os), /module\.exports/);
  st.run();
  assert.ok(os.isInstalled('user:test-thing.js'));
  assert.ok(os.windows.some((x) => x.def.id === 'user:test-thing.js'));
  const s = screen(os);
  assert.match(s, /Hello from Test Thing/);
  key(os, 'enter');
  assert.match(screen(os), /Press Enter or click: 1/);
  assert.ok(dockIdx(os, 'user:test-thing.js') >= 0);
  // a broken app reports its error and does not crash the desktop
  st.ta.setText('module.exports = { create() { throw new Error("nope") } }; oops(');
  st.ta.modified = true;
  st.run();
  assert.ok(/Error/.test(st.console[st.console.length - 1].t));
  // fix it: the other templates run too
  for (const tpl of [2, 3]) {
    st.newApp();
    os.closeModal(tpl);
    os.modal.input.li = new os.ui.LineInput('App ' + tpl);
    key(os, 'enter');
    st.run();
    const win = os.windows.find((x) => x.def.id === `user:app-${tpl}.js`);
    assert.ok(win, 'template ' + tpl + ' runs');
    screen(os);
    click(os, win.x + 5, win.y + 3);
    key(os, 'c');
    screen(os);
    assert.ok(!win.errored);
  }
  os.saveNow();
});

await test('apps are saved, so Code Studio apps survive a restart', () => {
  const a = newOS();
  assert.ok(a.userApps['user:test-thing.js']);
  assert.ok(a.isInstalled('user:test-thing.js'));
});

await test('desktop: files on the Desktop show as icons and open on double-click', async () => {
  const os = fresh();
  os.install('editor');
  fs.writeFileSync(path.join(DISK, 'Desktop', 'note.txt'), 'on the desktop');
  os.desk.at = 0;
  let s = screen(os);
  assert.match(s, /note\.txt/);
  const hit = os.hits.items.find((h) => h.id === 'desk0');
  click(os, hit.x + 2, hit.y + 1);
  click(os, hit.x + 2, hit.y + 1);
  assert.ok(os.windows.some((w) => w.def.id === 'editor' && /note\.txt/.test(w.app.title())));
});

await test('dialogs and the shut-down confirmation', () => {
  const os = fresh();
  key(os, 'q', { ctrl: true });
  assert.ok(os.modal && /Shut Down/.test(os.modal.title));
  screen(os);
  key(os, 'escape');
  assert.equal(os.modal, null);
  assert.equal(os.quitting, null);
});

await test('all three pixel modes and both colour depths render', () => {
  for (const mode of ['octant', 'sextant', 'half']) {
    const os = fresh({ pixelMode: mode, wallpaper: 'waves' });
    for (const id of ['finder', 'terminal', 'grapher']) os.install(id);
    os.launch('grapher');
    os.render();
    assert.ok(os.lastOutput.length > 1000, mode);
    os.truecolor = false;
    os.renderer.truecolor = false;
    os.renderer.invalidate();
    os.render();
    assert.ok(/\x1b\[38;5;\d+m/.test(os.lastOutput) || /\x1b\[48;5;\d+m/.test(os.lastOutput));
  }
});

await test('every wallpaper draws, and the too-small message appears in a tiny window', () => {
  const os = fresh();
  for (const id of ['waves', 'aurora', 'sunset', 'ocean', 'forest', 'pixelhills', 'midnight', 'graphite', 'rose']) {
    os.settings.wallpaper = id;
    os.applySettings();
    os.render();
  }
  os.sizeChanged(200, 80);
  assert.match(screen(os), /needs a bigger window/);
  os.sizeChanged(termSize().cols, termSize().rows);
});

await test('text is drawn in pixels: a tiny terminal font does not matter, and no letters are sent to the terminal', () => {
  const os = fresh({ wallpaper: 'graphite' });
  os.launch('appstore');
  os.render();
  const sent = os.lastOutput.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  assert.ok(sent.length > 1000);
  assert.doesNotMatch(sent, /[A-Za-z0-9]/, 'only block characters go to the terminal');
});

await test('the font has every character the desktop draws', async () => {
  const { hasGlyph } = await import('../src/font.js');
  const missing = new Set();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js') && !/glyphs\.js|font\.js/.test(f.name)) {
        for (const ch of fs.readFileSync(p, 'utf8')) if (ch.codePointAt(0) > 126 && !hasGlyph(ch)) missing.add(ch);
      }
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  // (block-element characters in comments and the glyph tables are not text we draw)
  const real = [...missing].filter((c) => !/[▀-▟\u{1fb00}-\u{1fbff}\u{1cd00}-\u{1cdff}]/u.test(c));
  assert.deepEqual(real, [], 'no glyph for: ' + real.join(' '));
});

await test('text size: Auto picks the biggest that fits; Alt+ and Alt- change it; the pointer maps to the right text cell', () => {
  // a 3pt terminal full screen: about 800 x 250 characters
  const os = new OS({ cols: 800, rows: 250, settings: { boot: false, textScale: 0 } });
  assert.equal(os.cv.scale, 2);
  assert.ok(os.cv.cols >= 96 && os.cv.rows >= 28);
  key(os, '-', { alt: true });
  assert.equal(os.cv.scale, 1);
  key(os, '=', { alt: true });
  key(os, '=', { alt: true });
  assert.equal(os.settings.textScale, 3);
  assert.equal(os.cv.scale, 3);
  key(os, '=', { alt: true });
  assert.equal(os.settings.textScale, 4);
  assert.equal(os.cv.scale, 3, 'cannot go bigger than leaves room for the desktop');
  // pixel precision: the pointer's pixels follow the terminal cell, the text cell follows the pixels
  os.settings.textScale = 2;
  os.applySettings();
  os.onEvent({ type: 'mouse', kind: 'move', button: 0, x: 100, y: 40 });
  assert.equal(os.ptr.x, 100 * os.cv.tpw);
  assert.equal(os.mouse.x, Math.floor((100 * os.cv.tpw) / os.cv.pw));
  assert.equal(os.mouse.y, Math.floor((40 * os.cv.tph) / os.cv.ph));
});

// ---------- App Distributor ----------
const { makePackage, encodePackage, decodePackage, scanSource } = await import('../src/pack.js');
const { COMMUNITY_DIR } = await import('../src/fs.js');
const http = await import('node:http');
const clip = path.join(path.dirname(home), 'clipboard.txt');
process.env.TRIDOS_CLIPBOARD_FILE = clip;
const HELLO = `module.exports = { name: 'Sky Clock', desc: 'Shows the sky', version: '2.1.0', icon: { color: '#ff9f0a', glyph: 'S' }, size: [40, 10],
  create(os, win, saved) { let n = (saved && saved.n) || 0; return { draw(v) { v.fill(os.th.bg); v.text(2, 1, 'Hello from a stranger ' + n, os.th.text); }, key(e) { if (e.key === 'enter') n++; }, save() { return { n }; } }; } };`;
const mkPkg = (over = {}) => makePackage({ name: 'Sky Clock', desc: 'Shows the sky', version: '2.1.0', author: 'Sam', icon: { color: '#ff9f0a', glyph: 'S' }, code: HELLO, ...over });

await test('app packages: round trip, a damaged code, a changed app, the things apps may not use', () => {
  const pkg = mkPkg();
  const text = encodePackage(pkg);
  assert.ok(text.startsWith('TRIDAPP1.'));
  assert.deepEqual(decodePackage(`Here you go! ${text} :)`).id, 'sky-clock');
  assert.equal(decodePackage(text).code, HELLO);
  assert.throws(() => decodePackage('hello'), /not a TridOS app code/);
  assert.throws(() => decodePackage(text.slice(0, text.length - 40)), /damaged|cut off/);
  const forged = encodePackage({ ...pkg, code: pkg.code + '\n// extra' }); // same checksum, different code
  assert.throws(() => decodePackage(forged), /checksum/);
  assert.throws(() => makePackage({ name: '!!!', code: 'x' }), /needs a name/);
  assert.equal(scanSource(HELLO).length, 0);
  // an array of strings is fine; looking a property up by text is not
  const ok = (body) => scanSource(`module.exports = { create(os) { ${body} } }`).length === 0;
  assert.ok(ok("const days = ['Mon', 'Tue']; return ['a', 'b'];"), 'arrays of strings');
  assert.ok(ok("foo(['a'], [\"b\"]); const o = { k: ['x'] }; if (x) return [`t`];"), 'arrays after ( , : return');
  assert.ok(!ok("const v = obj['k'];"), 'obj[...]');
  assert.ok(!ok('const v = list[0]["k"];'), 'a[0][...]');
  assert.ok(!ok('const v = f()["k"];'), 'f()[...]');
  for (const bad of ["require('fs')", 'process.exit()', "eval('1')", 'new Function("x")', 'fetch("http://x")', 'globalThis.x', 'os.windows[0]', 'os.term.write("x")', 'a.constructor("x")', 'a["b"]', "'\\x70rocess'", 'String.fromCharCode(1)', "import('x')"]) {
    assert.ok(scanSource(`module.exports = { create(os) { ${bad} } }`).length > 0, 'refused: ' + bad);
  }
});

await test('the Code Studio templates all pass the scan (so apps made from them can be shared)', async () => {
  const os = fresh();
  os.install('studio');
  const st = os.launch('studio').app;
  for (const tpl of [1, 2, 3, 4]) {
    st.newApp();
    os.closeModal(tpl);
    os.modal.input.li = new os.ui.LineInput('Tpl ' + tpl);
    key(os, 'enter');
    assert.equal(scanSource(st.ta.getText()).length, 0, 'template ' + tpl);
  }
});

await test('the Blank template: listed last, makes an empty runnable app that can be shared', () => {
  const os = fresh();
  os.install('studio');
  os.install('distributor');
  const st = os.launch('studio').app;
  st.newApp();
  assert.deepEqual(os.modal.buttons.map((b) => b.label), ['Cancel', 'Hello', 'Counter', 'Paint', 'Blank']);
  screen(os);
  os.closeModal(4); // Blank
  os.modal.input.li = new os.ui.LineInput('Empty One');
  key(os, 'enter');
  const code = st.ta.getText();
  assert.match(code, /name: 'Empty One'/);
  assert.match(code, /draw\(v, focused\) \{\s*v\.fill\(os\.th\.bg\);\s*\}/);
  assert.ok(code.split('\n').length < 22, 'it really is small');
  st.run();
  const w = os.windows.find((x) => x.def.id === 'user:empty-one.js');
  assert.ok(w, 'it runs');
  screen(os);
  assert.ok(!w.errored);
  const pkg = makePackage({ name: 'Empty One', code, author: 'A' });
  assert.equal(scanSource(pkg.code).length, 0, 'and it can be shared');
});

await test('sharing: copy the code, save a file, then install it on another computer, reading the source first', async () => {
  const a = fresh();
  a.settings.author = 'Sam';
  a.install('studio');
  a.install('distributor');
  fs.writeFileSync(path.join(APPS_DIR, 'sky-clock.js'), HELLO);
  a.reloadUserApps();
  const d = a.launch('distributor').app;
  assert.match(screen(a), /Share your apps/);
  assert.match(screen(a), /Sky Clock/);
  d.copyCode(d.myApps().find((x) => x.name === 'Sky Clock'));
  await sleep(100);
  const code = fs.readFileSync(clip, 'utf8');
  assert.equal(decodePackage(code).author, 'Sam');
  assert.match(d.status.t, /Copied the code/);
  d.saveFile(d.myApps().find((x) => x.name === 'Sky Clock'));
  const file = path.join(DISK, 'Desktop', 'sky-clock.tridapp');
  assert.ok(fs.existsSync(file));
  assert.equal(decodePackage(fs.readFileSync(file, 'utf8')).name, 'Sky Clock');
  // the other computer: a new home folder
  fs.rmSync(path.join(APPS_DIR, 'sky-clock.js'));
  a.reloadUserApps();
  const b = fresh();
  b.install('distributor');
  const e = b.launch('distributor').app;
  e.tab = 'get';
  e.input.set(code);
  await e.get();
  assert.ok(e.review, 'a review comes first');
  assert.equal(b.isInstalled('community:sky-clock.js'), false, 'nothing is installed before approval');
  let s = screen(b);
  assert.match(s, /Install “Sky Clock”\?/);
  assert.match(s, /by Sam/);
  assert.match(s, /module\.exports/, 'the source is shown');
  assert.match(s, /trust/);
  key(b, 'enter'); // approve
  assert.ok(b.isInstalled('community:sky-clock.js'));
  const def = b.userApps['community:sky-clock.js'];
  assert.ok(def.external);
  assert.equal(def.author, 'Sam');
  assert.equal(def.version, '2.1.0');
  assert.ok(fs.existsSync(path.join(COMMUNITY_DIR, 'sky-clock.js')) && fs.existsSync(path.join(COMMUNITY_DIR, 'sky-clock.json')));
  const w = b.launch('community:sky-clock.js');
  assert.match(screen(b), /Hello from a stranger 0/);
  key(b, 'enter');
  assert.match(screen(b), /Hello from a stranger 1/);
  b.saveNow();
  const c = newOS(); // it survives a restart, state and all
  assert.ok(c.isInstalled('community:sky-clock.js'));
  c.restoreWindows();
  assert.match(screen(c), /Hello from a stranger 1/);
  assert.ok(w);
});

await test('an app from someone else is fenced: refused if it reaches out, refused if changed after install', async () => {
  const os = fresh();
  os.install('distributor');
  const d = os.launch('distributor').app;
  const evil = mkPkg({ name: 'Evil', code: `module.exports = { name: 'Evil', create(os) { const fs = require('fs'); return { draw(v) {} }; } };` });
  d.openReview(evil, 'test');
  assert.equal(d.review.findings.length > 0, true);
  assert.match(screen(os), /Not allowed: require/);
  d.install(); // the button does nothing
  assert.ok(!os.userApps['community:evil.js']);
  assert.throws(() => os.installPackage(evil), /require/);
  // the fence at run time: the app only sees a small os, and has no require/process even if the scan were fooled
  const sneaky = mkPkg({ name: 'Sneaky', code: `module.exports = { name: 'Sneaky', size: [90, 6], create(os, win) { return { draw(v) { v.fill(os.th.bg); v.text(1, 1, [Object.keys(os).sort().join(' '), typeof win.app, typeof os.cv.pw].join('|'), os.th.text); } }; } };` });
  os.installPackage(sneaky, 'test');
  os.launch('community:sneaky.js');
  assert.match(screen(os), /ask confirm cv dialog mouse settings th toast ui util\|undefined\|number/);
  // and a file edited after it was installed is refused when loaded
  fs.appendFileSync(path.join(COMMUNITY_DIR, 'sneaky.js'), '\n// changed');
  os.reloadUserApps();
  assert.match(os.userApps['community:sneaky.js'].broken, /changed after it was installed/);
});

await test('links: https downloads and GitHub gist pages; other schemes and huge files are refused', async () => {
  const pkgText = encodePackage(mkPkg({ name: 'Linked' }));
  const server = http.createServer((req, res) => {
    if (req.url === '/app') return res.end(pkgText);
    if (req.url === '/big') return res.end('x'.repeat(500 * 1024));
    if (req.url.startsWith('/gists/')) return res.end(JSON.stringify({ files: { 'linked.tridapp': { filename: 'linked.tridapp', content: pkgText, truncated: false } } }));
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.TRIDOS_GIST_API = base + '/gists/';
  const os = fresh();
  os.install('distributor');
  const d = os.launch('distributor').app;
  d.tab = 'get';
  d.input.set(base + '/app');
  await d.get();
  assert.equal(d.review.pkg.name, 'Linked');
  d.review = null;
  d.input.set('https://gist.github.com/someone/0123456789abcdef');
  await d.get();
  assert.equal(d.review.pkg.name, 'Linked', 'a gist page works');
  d.review = null;
  d.input.set(base + '/big');
  await d.get();
  assert.match(d.status.t, /too big/);
  d.input.set(base + '/nothing');
  await d.get();
  assert.match(d.status.t, /404/);
  d.input.set('http://example.com/app');
  await d.get();
  assert.match(d.status.t, /https/);
  d.input.set('hello there');
  await d.get();
  assert.match(d.status.t, /Paste a link/);
  server.close();
});

// A stand-in for the gh command that behaves like the GitHub API: a repo you can edit (direct) or one you cannot (fork + pull request).
const ghStub = (dir) => {
  const log = path.join(dir, 'gh.log');
  const file = path.join(dir, 'gh');
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
let body = '';
try { body = fs.readFileSync(0, 'utf8'); } catch {}
let shown = body;
try { const j = JSON.parse(body); if (j.content) j.content = '...'; shown = JSON.stringify(j); } catch {}
fs.appendFileSync(${JSON.stringify(log)}, a.join(' ') + (body ? ' <<' + shown : '') + '\\n');
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
const fail = (code, msg) => { process.stderr.write('gh: ' + msg + ' (HTTP ' + code + ')'); process.exit(1); };
if (a[0] !== 'api') fail(1, 'only api');
const method = a.includes('-X') ? a[a.indexOf('-X') + 1] : 'GET';
const p = a.find((x, i) => i > 0 && !x.startsWith('-') && a[i - 1] !== '-X' && a[i - 1] !== '--input');
const mode = process.env.STUB_MODE || 'direct';
if (p === 'user') out({ login: 'sam' });
if (p.startsWith('repos/Bluegrayfoo/tridOs/contents/')) {
  if (method === 'GET') { if (process.env.STUB_EXISTS) out({ sha: 'oldsha' }); fail(404, 'Not Found'); }
  if (method === 'PUT') { if (mode === 'pr') fail(403, 'Resource not accessible'); out({ content: { html_url: 'https://github.com/Bluegrayfoo/tridOs/blob/main/apps/x.tridapp' } }); }
  if (method === 'DELETE') out({});
}
if (p === 'repos/Bluegrayfoo/tridOs/forks') out({ full_name: 'sam/tridOs' });
if (p === 'repos/sam/tridOs') out({ full_name: 'sam/tridOs' });
if (p === 'repos/Bluegrayfoo/tridOs') out({ default_branch: 'main' });
if (p.startsWith('repos/Bluegrayfoo/tridOs/git/ref/')) out({ object: { sha: 'basesha' } });
if (p === 'repos/sam/tridOs/git/refs') out({});
if (p.startsWith('repos/sam/tridOs/contents/')) { if (method === 'GET') fail(404, 'Not Found'); out({}); }
if (p === 'repos/Bluegrayfoo/tridOs/pulls') out({ html_url: 'https://github.com/Bluegrayfoo/tridOs/pull/7' });
fail(404, 'unexpected ' + p);
`,
    { mode: 0o755 },
  );
  return { file, log };
};

await test('publishing goes into the tridOs repo: asks first; direct commit with write access, a pull request without; removal', async () => {
  const dir = path.join(path.dirname(home), 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const { file, log } = ghStub(dir);
  process.env.TRIDOS_GH = file;
  const os = fresh();
  os.settings.author = 'Sam';
  os.install('distributor');
  fs.writeFileSync(path.join(APPS_DIR, 'sky-clock.js'), HELLO);
  os.reloadUserApps();
  const d = os.launch('distributor').app;
  const app = () => d.myApps().find((x) => x.name === 'Sky Clock');
  // with write access
  d.publish(app());
  assert.ok(os.modal && /catalog/.test(os.modal.title) && /Bluegrayfoo\/tridOs/.test(os.modal.message) && /public/i.test(os.modal.message));
  assert.ok(!fs.existsSync(log), 'nothing is sent before you say yes');
  os.closeModal(1);
  await until(() => !d.busy);
  assert.equal(d.published.length, 1);
  assert.equal(d.published[0].mode, 'direct');
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /api -X PUT repos\/Bluegrayfoo\/tridOs\/contents\/apps\/sky-clock\.tridapp --input -/);
  const sent = calls.split('\n').find((l) => /-X PUT/.test(l));
  assert.match(sent, /"message":"Add Sky Clock v2\.1\.0 by Sam"/);
  assert.ok(fs.readFileSync(clip, 'utf8').includes('github.com/Bluegrayfoo/tridOs'));
  d.go('published');
  assert.match(screen(os), /in the catalog/);
  // update: the existing file's sha is sent
  fs.writeFileSync(log, '');
  process.env.STUB_EXISTS = '1';
  d.publish(app());
  os.closeModal(1);
  await until(() => !d.busy);
  assert.match(fs.readFileSync(log, 'utf8'), /"sha":"oldsha"/);
  assert.match(fs.readFileSync(log, 'utf8'), /Update Sky Clock/);
  // removing it from the catalog (the file exists there)
  d.unpublish(d.published[0]);
  os.closeModal(1);
  await until(() => !d.busy);
  assert.equal(d.published.length, 0);
  assert.match(fs.readFileSync(log, 'utf8'), /-X DELETE repos\/Bluegrayfoo\/tridOs\/contents\/apps\/sky-clock\.tridapp/);
  delete process.env.STUB_EXISTS;
  // without write access: fork, branch, file, pull request
  fs.writeFileSync(log, '');
  process.env.STUB_MODE = 'pr';
  d.publish(app());
  os.closeModal(1);
  await until(() => !d.busy);
  assert.equal(d.published[0].mode, 'pr');
  assert.equal(d.published[0].url, 'https://github.com/Bluegrayfoo/tridOs/pull/7');
  const pr = fs.readFileSync(log, 'utf8');
  assert.match(pr, /-X POST repos\/Bluegrayfoo\/tridOs\/forks/);
  assert.match(pr, /-X POST repos\/sam\/tridOs\/git\/refs/);
  assert.match(pr, /-X PUT repos\/sam\/tridOs\/contents\/apps\/sky-clock\.tridapp/);
  assert.match(pr, /-X POST repos\/Bluegrayfoo\/tridOs\/pulls/);
  assert.match(d.status.t, /pull request/);
  d.go('published');
  assert.match(screen(os), /waiting for the owner/);
  delete process.env.STUB_MODE;
  // gh missing: a plain explanation
  process.env.TRIDOS_GH = path.join(dir, 'no-such-gh');
  d.publish(app());
  os.closeModal(1);
  await until(() => !d.busy);
  assert.match(d.status.t, /GitHub command \(gh\) is not installed/);
  delete process.env.TRIDOS_GH;
  // an app that reaches out cannot be published
  fs.writeFileSync(path.join(APPS_DIR, 'bad.js'), `module.exports = { name: 'Bad', create() { return require('fs'); } };`);
  os.reloadUserApps();
  const bad = d.myApps().find((x) => x.name === 'Bad');
  d.publish(bad);
  assert.equal(os.modal, null);
  assert.match(d.status.t, /require/);
  fs.rmSync(path.join(APPS_DIR, 'bad.js'));
});

await test('the catalog: lists what is in the repo, shows installed / update, and installs after a review', async () => {
  const pkgA = encodePackage(mkPkg({ name: 'Cat App', version: '1.0.0', author: 'Pat' }));
  const evil = encodePackage(mkPkg({ name: 'Catalog Evil', code: `module.exports = { name: 'x', create() { process.exit(); } };` }));
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/contents') {
      return res.end(JSON.stringify([
        { name: 'cat-app.tridapp', type: 'file', download_url: base + '/raw/cat-app', html_url: base + '/blob/cat-app' },
        { name: 'catalog-evil.tridapp', type: 'file', download_url: base + '/raw/evil', html_url: base + '/blob/evil' },
        { name: 'broken.tridapp', type: 'file', download_url: base + '/raw/broken' },
        { name: 'README.md', type: 'file', download_url: base + '/raw/readme' },
      ]));
    }
    if (req.url === '/raw/cat-app') return res.end(pkgA);
    if (req.url === '/raw/evil') return res.end(evil);
    if (req.url === '/raw/broken') return res.end('TRIDAPP1.AAAA');
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.TRIDOS_CATALOG_API = `http://127.0.0.1:${server.address().port}/contents`;
  const os = fresh();
  os.install('distributor');
  const d = os.launch('distributor', { tab: 'catalog' }).app;
  await sleep(600);
  let s = screen(os);
  assert.match(s, /TridOS catalog/);
  assert.match(s, /Cat App/);
  assert.match(s, /by Pat/);
  assert.doesNotMatch(s, /broken|README/, 'files that are not apps are skipped');
  assert.equal(d.catalog.length, 2);
  d.sel.catalog = d.catalog.findIndex((i) => i.pkg.name === 'Cat App');
  key(os, 'enter'); // review
  assert.ok(d.review);
  assert.match(screen(os), /the TridOS catalog/);
  key(os, 'enter'); // install
  assert.ok(os.isInstalled('community:cat-app.js'));
  assert.equal(os.userApps['community:cat-app.js'].source.includes('catalog'), true);
  d.go('catalog');
  assert.match(screen(os), /Installed/);
  // an app in the catalog that reaches out is refused even if someone merged it
  d.sel.catalog = d.catalog.findIndex((i) => i.pkg.name === 'Catalog Evil');
  key(os, 'enter');
  assert.match(screen(os), /Not allowed: process/);
  key(os, 'enter');
  assert.ok(!os.userApps['community:catalog-evil.js']);
  d.review = null;
  // offline / bad answer: a plain message
  process.env.TRIDOS_CATALOG_API = 'http://127.0.0.1:1/contents';
  await d.loadCatalog();
  assert.match(screen(os), /Could not load the catalog/);
  process.env.TRIDOS_CATALOG_API = OFFLINE_CATALOG;
  server.close();
});

await test('the App Store lists catalog apps in Discover; Get shows the source first; installing puts it in the Dock; updates are spotted', async () => {
  const v1 = encodePackage(mkPkg({ name: 'Shared Toy', desc: 'Something fun', version: '1.0.0', author: 'Kim' }));
  let served = v1;
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/contents') return res.end(JSON.stringify([{ name: 'shared-toy.tridapp', type: 'file', download_url: base + '/raw/toy', html_url: base + '/blob/toy' }]));
    if (req.url === '/raw/toy') return res.end(served);
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.TRIDOS_CATALOG_API = `http://127.0.0.1:${server.address().port}/contents`;
  const os = fresh();
  const store = os.launch('appstore').app;
  await until(() => store.communityState !== 'loading');
  let s = screen(os);
  assert.match(s, /Finder/, 'the built-in apps are still there');
  store.sel = store.list().findIndex((d) => d.name === 'Shared Toy'); // (it is below the built-in ones: scroll to it)
  assert.ok(store.sel > 5);
  s = screen(os);
  assert.match(s, /Shared Toy/, 'and the shared one');
  assert.match(s, /From Kim/);
  assert.match(s, /read first/);
  key(os, 'enter'); // Get -> the source comes first
  assert.ok(store.review);
  assert.equal(os.isInstalled('community:shared-toy.js'), false);
  s = screen(os);
  assert.match(s, /Install “Shared Toy”\?/);
  assert.match(s, /module\.exports/);
  key(os, 'escape');
  assert.equal(store.review, null);
  assert.equal(os.isInstalled('community:shared-toy.js'), false, 'cancelling installs nothing');
  key(os, 'enter');
  key(os, 'enter'); // approve
  assert.ok(os.isInstalled('community:shared-toy.js'));
  s = screen(os);
  assert.match(s, /Open/);
  assert.ok(dockIdx(os, 'community:shared-toy.js') >= 0, 'it is in the Dock');
  key(os, 'enter'); // Open
  assert.ok(os.windows.some((w) => w.def.id === 'community:shared-toy.js'));
  // a newer version is offered as an update
  served = encodePackage(mkPkg({ name: 'Shared Toy', desc: 'Something fun', version: '1.1.0', author: 'Kim' }));
  await store.loadCommunity(true);
  os.focusWindow(os.windows.find((w) => w.def.id === 'appstore'));
  assert.match(screen(os), /Update/);
  // removing it from the Installed tab deletes it
  store.go('installed');
  store.sel = store.list().findIndex((d) => d.name === 'Shared Toy');
  key(os, 'backspace');
  key(os, 'enter');
  assert.ok(!os.userApps['community:shared-toy.js']);
  // offline: the built-in apps still show, with a note
  process.env.TRIDOS_CATALOG_API = OFFLINE_CATALOG;
  store.go('discover');
  await store.loadCommunity(true);
  s = screen(os);
  assert.match(s, /Finder/);
  assert.match(s, /could not be loaded/);
  server.close();
});

await test('a .tridapp file on the Desktop installs by opening it; apps from others can be removed', async () => {
  const os = fresh();
  os.install('distributor');
  os.install('editor');
  const file = path.join(DISK, 'Desktop', 'from-a-friend.tridapp');
  fs.writeFileSync(file, encodePackage(mkPkg({ name: 'From A Friend' })));
  os.openFile(file);
  const w = os.windows.find((x) => x.def.id === 'distributor');
  assert.ok(w.app.review, 'opening the file starts the review');
  key(os, 'enter');
  assert.ok(os.isInstalled('community:from-a-friend.js'));
  assert.match(screen(os), /Installed From A Friend/);
  os.removeCommunityApp('community:from-a-friend.js');
  assert.ok(!os.userApps['community:from-a-friend.js'] && !os.isInstalled('community:from-a-friend.js'));
  assert.ok(!fs.existsSync(path.join(COMMUNITY_DIR, 'from-a-friend.js')));
  // without the Distributor installed, opening one explains
  const plain = fresh();
  plain.uninstall('distributor');
  plain.openFile(file);
  assert.ok(plain.toasts.some((t) => /App Distributor/.test(t.msg)));
});

// ---------- the guide's example apps ----------
await test('the example apps in docs/examples work, as your own apps and as shared apps (scanned and fenced)', async () => {
  const dir = new URL('../docs/examples/', import.meta.url).pathname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(scanSource(code).length, 0, f + ' passes the scan, so it can be shared');
    for (const shared of [false, true]) {
      const os = fresh();
      let def;
      if (shared) {
        const pkg = makePackage({ name: f.replace('.js', ''), code, author: 'Guide' });
        def = os.installPackage(pkg, 'test');
      } else {
        fs.writeFileSync(path.join(APPS_DIR, 'ex-' + f), code);
        os.reloadUserApps();
        def = os.userApps['user:ex-' + f];
        os.install(def.id);
      }
      assert.ok(def && !def.broken, `${f} (${shared ? 'shared' : 'own'}) loads: ${def?.broken}`);
      const w = os.launch(def.id);
      assert.ok(w, f + ' opens');
      screen(os);
      const app = w.app;
      if (f === 'bounce.js') {
        click(os, w.x + 10, w.y + 6);
        click(os, w.x + 20, w.y + 4);
        for (let i = 0; i < 30; i++) assert.equal(app.tick(0.05, true), true);
        assert.match(screen(os), /2 balls/);
        key(os, 'c');
        assert.match(screen(os), /Click anywhere/);
      } else if (f === 'sticky-note.js') {
        type(os, 'Hi');
        assert.match(screen(os), /Hi/);
        assert.match(app.title(), /Sticky Note \(\d+ characters\)/);
        assert.equal(app.save().text.startsWith('Hi'), true);
      }
      os.draw();
      assert.ok(!w.errored, `${f} (${shared ? 'shared' : 'own'}) drew without an error`);
    }
  }
});

await test('an app\'s saved state is written soon after you use it, not only when you quit', () => {
  const os = fresh();
  os.install('editor');
  os.launch('editor');
  os.stateDirty = false;
  os.onEvent({ type: 'mouse', kind: 'move', button: 0, x: 5, y: 5 });
  assert.equal(os.stateDirty, false, 'moving the pointer is not a change');
  type(os, 'x');
  assert.equal(os.stateDirty, true, 'typing is');
  os.saveNow();
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  assert.ok(saved.windows.some((w) => w.app === 'editor'));
});

console.log(`\n${passed} tests passed`);
fs.rmSync(path.dirname(home), { recursive: true, force: true });
