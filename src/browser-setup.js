// Sets up what the Tricycle browser needs: the `playwright` and `pngjs` packages, and a Chromium to drive (or an installed Google Chrome).
// It runs three ways:
//   - by tlib while installing TridOS:   node src/browser-setup.js --install     (always exits 0: a failed browser setup must not stop TridOS installing)
//   - by hand:                           node src/browser-setup.js
//   - by Tricycle the first time it is opened (ensureBrowser, with progress shown in its window)
// Packages go next to TridOS when that folder is writable (the same place `npm install` puts them), otherwise in ~/.tridos/browser.
// Set TRIDOS_BROWSER_NO_SETUP=1 to turn the automatic setup off.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.TRIDOS_HOME || path.join(os.homedir(), '.tridos');
export const FALLBACK_DIR = path.join(HOME, 'browser');
export const PACKAGES = ['playwright', 'pngjs'];
const npmCmd = () => process.env.TRIDOS_NPM || (process.platform === 'win32' ? 'npm.cmd' : 'npm');

const writable = (dir) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// Where packages are looked for, and where they are installed. (TRIDOS_BROWSER_DIR forces one place: for tests.)
export const searchDirs = () => (process.env.TRIDOS_BROWSER_DIR ? [process.env.TRIDOS_BROWSER_DIR] : [REPO, FALLBACK_DIR]);
export const installDir = () => process.env.TRIDOS_BROWSER_DIR || (writable(REPO) ? REPO : FALLBACK_DIR);

// A package from any of the places it might be, or null.
export function loadPackage(name) {
  for (const dir of searchDirs()) {
    try {
      return { module: createRequire(path.join(dir, 'x.js'))(name), dir };
    } catch {}
  }
  return null;
}

export const chromeInstalled = () => process.platform === 'darwin' && !process.env.TRIDOS_NO_SYSTEM_CHROME && fs.existsSync('/Applications/Google Chrome.app');

// What is already in place: { playwright, pngjs, chromium: true | 'chrome' | false, ready }
export function status() {
  const playwright = loadPackage('playwright');
  const pngjs = loadPackage('pngjs');
  let chromium = false;
  if (playwright) {
    try {
      if (fs.existsSync(playwright.module.chromium.executablePath())) chromium = true;
    } catch {}
    if (!chromium && (chromeInstalled() || process.env.TRIDOS_BROWSER_CHANNEL)) chromium = 'chrome';
  }
  return { playwright: !!playwright, pngjs: !!pngjs, chromium, ready: !!(playwright && pngjs && chromium) };
}

// Run a command, calling onLine(text) for each line it prints (progress bars use \r, so those count as lines too).
function run(cmd, args, { cwd, onLine, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, error: e.message });
    }
    let tail = '';
    const feed = (d) => {
      const parts = (tail + d.toString()).split(/[\r\n]+/);
      tail = parts.pop();
      for (const l of parts) if (l.trim()) onLine?.(l.trim());
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => resolve({ code: -1, error: e.code === 'ENOENT' ? `${cmd} was not found` : e.message }));
    child.on('close', (code) => {
      if (tail.trim()) onLine?.(tail.trim());
      resolve({ code });
    });
  });
}

// Install whatever is missing. -> { ok, error? }. onProgress(message) is called with plain-English progress.
export async function setupBrowser({ onProgress = () => {} } = {}) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) return { ok: false, error: `The browser needs Node 18 or newer (this is ${process.versions.node}).` };
  let st = status();
  if (st.ready) return { ok: true };
  const dir = installDir();
  if (!st.playwright || !st.pngjs) {
    onProgress(`Installing the browser packages (${PACKAGES.join(', ')})…`);
    if (dir !== REPO) {
      fs.mkdirSync(dir, { recursive: true });
      const pj = path.join(dir, 'package.json');
      if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: 'tridos-browser', private: true, description: 'Packages for the TridOS Tricycle browser' }, null, 2));
    }
    const args = dir === REPO && fs.existsSync(path.join(REPO, 'package.json')) ? ['install', '--no-audit', '--no-fund', '--loglevel=error'] : ['install', '--no-audit', '--no-fund', '--loglevel=error', ...PACKAGES];
    const r = await run(npmCmd(), args, { cwd: dir, onLine: (l) => onProgress(l.slice(0, 120)) });
    if (r.code !== 0) return { ok: false, error: r.error || 'npm could not install the browser packages (are you online?).' };
    st = status();
    if (!st.playwright || !st.pngjs) return { ok: false, error: 'The browser packages did not install.' };
  }
  if (!st.chromium) {
    onProgress('Downloading Chromium, the web engine (about 150 MB, once)…');
    const pw = loadPackage('playwright');
    // (Playwright's package.json does not export cli.js, so find the package folder through package.json and look beside it.)
    const cli = (() => {
      try {
        const folder = path.dirname(createRequire(path.join(pw.dir, 'x.js')).resolve('playwright/package.json'));
        if (fs.existsSync(path.join(folder, 'cli.js'))) return path.join(folder, 'cli.js');
      } catch {}
      const guess = path.join(pw.dir, 'node_modules', 'playwright', 'cli.js');
      return fs.existsSync(guess) ? guess : null;
    })();
    if (!cli) return { ok: false, error: 'Could not find the Playwright installer.' };
    const r = await run(process.execPath, [cli, 'install', 'chromium'], { cwd: pw.dir, onLine: (l) => onProgress(l.slice(0, 120)) });
    if (r.code !== 0) return { ok: false, error: r.error || 'Chromium did not download (are you online?).' };
    if (!status().ready) return { ok: false, error: 'Chromium did not install.' };
  }
  onProgress('The browser is ready.');
  return { ok: true };
}

// For the browser engine: the playwright and pngjs modules, setting things up first if they are missing.
export async function ensureBrowser({ onProgress = () => {} } = {}) {
  let st = status();
  if (!st.ready) {
    if (process.env.TRIDOS_BROWSER_NO_SETUP) throw new Error('The browser is not set up. Run: node src/browser-setup.js');
    const r = await setupBrowser({ onProgress });
    if (!r.ok) throw new Error(`${r.error} To set it up by hand, run: node src/browser-setup.js`);
    st = status();
  }
  return { chromium: loadPackage('playwright').module.chromium, PNG: loadPackage('pngjs').module.PNG, chrome: st.chromium === 'chrome' };
}

// ---- command line ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const installing = process.argv.includes('--install'); // from tlib: never fail the install
  const say = (m) => console.log(`[browser] ${m}`);
  try {
    if (status().ready) say('Already set up.');
    else if (process.env.TRIDOS_BROWSER_NO_SETUP) say('Skipped (TRIDOS_BROWSER_NO_SETUP is set).');
    else {
      const r = await setupBrowser({ onProgress: say });
      if (!r.ok) {
        say(`Could not finish: ${r.error}`);
        say('TridOS works without it. The Tricycle browser sets itself up the first time you open it.');
        if (!installing) process.exitCode = 1;
      }
    }
  } catch (e) {
    say(`Could not finish: ${e.message}`);
    if (!installing) process.exitCode = 1;
  }
}
