// Starts TridOS in the terminal you run it from.

import { Terminal } from './term.js';
import { OS } from './os.js';
import { plainText, textLayer } from './gfx.js';
import { HOME } from './fs.js';

const args = process.argv.slice(2);

function help() {
  console.log(`TridOS 0.1 - a desktop for the terminal, drawn in block octant pixels

  tridos              start (best in a big or full-screen window: Ctrl+Cmd+F)
  tridos --snapshot   draw one frame as plain text, without starting (for tests)
  tridos --glyphs     show the block characters, to check your font has them
  tridos --reset      forget the saved settings, apps and windows (your files stay)
  tridos --help       this help

Keys: the mouse works everywhere. Press Esc to use the keyboard instead: arrows move,
Enter chooses, Tab goes between windows, Esc goes back. Ctrl+Q shuts down.
Everything is saved in ${HOME}`);
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) return help();
  if (args.includes('--glyphs')) {
    const { OCTANTS, SEXTANTS } = await import('./glyphs.js');
    console.log('Octants (2x4):\n' + OCTANTS.slice(1, 255).join('') + '\n\nSextants (2x3):\n' + SEXTANTS.slice(1, 63).join('') + '\n');
    console.log('If these show as boxes or question marks, pick a font with the Symbols for Legacy Computing');
    console.log('Supplement (Julia Mono works), or choose Sextants / Half blocks in System Settings > Display.');
    return;
  }
  if (args.includes('--reset')) {
    const fs = await import('node:fs');
    const { STATE_FILE } = await import('./fs.js');
    try {
      fs.rmSync(STATE_FILE, { force: true });
    } catch {}
    console.log('Settings, installed apps and windows are forgotten. Your files are still in ' + HOME);
    return;
  }
  if (args.includes('--snapshot')) {
    const cols = Number(process.env.COLUMNS) || 480; // terminal cells (a small font makes many of them)
    const rows = Number(process.env.LINES) || 130;
    const os = new OS({ cols, rows });
    os.settings.boot = false;
    os.restoreWindows();
    os.draw();
    console.log(args.includes('--text') ? textLayer(os.cv) : plainText(os.cv));
    return;
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('TridOS needs a terminal. Run it from Terminal (or --help).');
    process.exit(1);
  }
  const term = new Terminal();
  const os = new OS({ term, cols: term.cols, rows: term.rows });
  term.onEvent = (e) => os.onEvent(e);
  term.onResize = () => os.onResize();
  const restore = () => term.stop();
  process.on('exit', restore);
  for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
  process.on('uncaughtException', (e) => {
    restore();
    console.error('TridOS crashed:', e && e.stack ? e.stack : e);
    process.exit(1);
  });
  term.start();
  os.start();
}

main();
