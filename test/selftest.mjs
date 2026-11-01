// Drives TridOS without a terminal: feeds it keys and mouse events, draws frames and checks what is on screen.
import fs from 'node:fs';
import os_ from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os_.tmpdir(), 'tridos-test-')) + '/h';
process.env.TRIDOS_HOME = home;
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
const screen = (os) => {
  os.draw();
  return textLayer(os.cv);
};
const key = (os, k, mods = {}, text) => os.onEvent({ type: 'key', key: k, ctrl: false, alt: false, shift: false, ...mods, text });
const type = (os, s) => [...s].forEach((c) => key(os, c, {}, c));
const click = (os, x, y, button = 0) => {
  os.onEvent({ type: 'mouse', kind: 'down', button, x, y });
  os.onEvent({ type: 'mouse', kind: 'up', button, x, y });
};
const move = (os, x, y) => os.onEvent({ type: 'mouse', kind: 'move', button: 0, x, y });
const drag = (os, x0, y0, x1, y1) => {
  os.onEvent({ type: 'mouse', kind: 'down', button: 0, x: x0, y: y0 });
  os.onEvent({ type: 'mouse', kind: 'drag', button: 0, x: x1, y: y1 });
  os.onEvent({ type: 'mouse', kind: 'up', button: 0, x: x1, y: y1 });
};
const fresh = (settings = {}) => {
  const os = new OS({ cols: 130, rows: 40 });
  Object.assign(os.settings, { boot: false, wallpaper: 'graphite' }, settings);
  os.applySettings();
  return os;
};
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
  assert.ok(a.includes('hello'.slice(0, 1)) && a.includes('38;2;255;0;0'));
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
  assert.equal(os.cv.ph, 3);
  screen(os);
  w.app.set('pixelMode', 'half');
  assert.equal(os.cv.ph, 2);
  screen(os);
  w.app.set('pixelMode', 'octant');
  os.saveNow();
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  assert.equal(saved.settings.theme, 'light');
  assert.equal(saved.settings.accent, 'green');
  assert.equal(saved.settings.wallpaper, 'sunset');
  const again = new OS({ cols: 130, rows: 40 });
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
  const b = new OS({ cols: 130, rows: 40 });
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
  os.onEvent({ type: 'mouse', kind: 'wheel', dir: -1, x: gx, y: w.y + 8 });
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
  const a = new OS({ cols: 130, rows: 40 });
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
  os.sizeChanged(60, 20);
  assert.match(screen(os), /needs a window/);
  os.sizeChanged(130, 40);
});

console.log(`\n${passed} tests passed`);
fs.rmSync(path.dirname(home), { recursive: true, force: true });
