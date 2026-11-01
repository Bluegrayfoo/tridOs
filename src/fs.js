// TridOS keeps everything under ~/.tridos: state.json (settings, installed apps, windows), disk/ (the Finder's world),
// and apps/ (apps you write in Code Studio). TRIDOS_HOME can point somewhere else (tests).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.TRIDOS_HOME || path.join(os.homedir(), '.tridos');
export const DISK = path.join(HOME, 'disk');
export const APPS_DIR = path.join(HOME, 'apps');
export const STATE_FILE = path.join(HOME, 'state.json');
export const TRASH = path.join(DISK, '.Trash');

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: 'blue',
  wallpaper: 'waves',
  pixelMode: 'octant',
  textScale: 0, // 0 = Auto: the biggest text that fits
  colorMode: 'auto',
  clock24: false,
  showSeconds: false,
  dockSize: 'medium',
  dockIndicators: true,
  boot: true,
};

const WELCOME = `Welcome to TridOS!

This is your disk. Files you make in Finder, Terminal and Text Editor live here:
  ${DISK}

Pointer or keyboard: click things with the mouse, or press Esc to use the keyboard
(arrows move, Enter chooses, Esc goes back). Open System Settings from the  menu to
change the theme and wallpaper.

Open the App Store (it is the only app at first) to get more apps. Code Studio lets
you write apps of your own.
`;

export function ensureDirs() {
  for (const d of [HOME, DISK, APPS_DIR, TRASH, path.join(DISK, 'Desktop'), path.join(DISK, 'Documents'), path.join(DISK, 'Downloads')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const welcome = path.join(DISK, 'Documents', 'Welcome.txt');
  if (!fs.existsSync(welcome) && !fs.existsSync(STATE_FILE)) fs.writeFileSync(welcome, WELCOME);
}

export function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (s && typeof s === 'object') return s;
  } catch {}
  return {};
}

export function saveState(state) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}

// Paths inside the disk only: anything that would leave it is clamped back to the disk's top.
export function inDisk(p) {
  const abs = path.resolve(DISK, p);
  return abs === DISK || abs.startsWith(DISK + path.sep) ? abs : DISK;
}
export const isInDisk = (abs) => abs === DISK || abs.startsWith(DISK + path.sep);

export function listDir(abs) {
  let names = [];
  try {
    names = fs.readdirSync(abs);
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith('.'))
    .map((name) => {
      let st = null;
      try {
        st = fs.statSync(path.join(abs, name));
      } catch {}
      return { name, dir: !!st && st.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.dir ? -1 : 1));
}

// A name that is not taken in that folder: "untitled", "untitled 2", ...
export function freeName(dir, base, ext = '') {
  let n = 1;
  let name = base + ext;
  while (fs.existsSync(path.join(dir, name))) {
    n++;
    name = `${base} ${n}${ext}`;
  }
  return name;
}

export function moveToTrash(abs) {
  fs.mkdirSync(TRASH, { recursive: true });
  const base = path.basename(abs);
  const dot = base.lastIndexOf('.');
  const name = freeName(TRASH, dot > 0 ? base.slice(0, dot) : base, dot > 0 ? base.slice(dot) : '');
  fs.renameSync(abs, path.join(TRASH, name));
}

export const niceSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function displayPath(abs) {
  if (abs === DISK) return '~';
  return isInDisk(abs) ? '~/' + path.relative(DISK, abs) : abs;
}
