// The TridOS app package: one piece of text that carries an app to another TridOS. It is the app's JSON, deflated and
// written in base64url after the prefix TRIDAPP1.  A .tridapp file, a GitHub gist and a message are all just this text.
//
// An app is code. TridOS cannot fully sandbox JavaScript, so a package from someone else is only installed after you have
// seen its source, it is checked for the things apps may not use, and it is checked again every time it is loaded.

import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const PREFIX = 'TRIDAPP1.';
export const MAX_CODE = 200 * 1024;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function makePackage({ name, desc = '', version = '1.0.0', author = '', icon = null, code }) {
  const id = slug(name);
  if (!id) throw new Error('The app needs a name with letters or numbers.');
  if (typeof code !== 'string' || !code.trim()) throw new Error('The app has no code.');
  if (code.length > MAX_CODE) throw new Error('The app is too big to share (200 KB at most).');
  return {
    tridosApp: 1,
    id,
    name: String(name).slice(0, 40),
    desc: String(desc).slice(0, 140),
    version: /^[0-9A-Za-z.+-]{1,20}$/.test(String(version)) ? String(version) : '1.0.0',
    author: String(author).slice(0, 40),
    icon: icon && typeof icon === 'object' ? { color: iconColor(icon.color), glyph: String(icon.glyph || name)[0] || '?', ...iconSymbol(icon.symbol) } : { color: '#5b8def', glyph: String(name)[0] },
    code,
    sha256: sha256(code),
  };
}

function iconColor(c) {
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  return /^#[0-9a-fA-F]{6}$/.test(String(c)) ? String(c) : '#5b8def';
}

// Optional built-in artwork; older clients still have color/glyph as a fallback.
function iconSymbol(symbol) {
  return ['clock', 'tricycle'].includes(symbol) ? { symbol } : {};
}

export function encodePackage(pkg) {
  return PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(pkg), 'utf8'), { level: 9 }).toString('base64url');
}

// Text (a share code, possibly with other words around it) -> a checked package. Throws a plain-English Error.
export function decodePackage(text) {
  const t = String(text || '');
  const at = t.indexOf(PREFIX);
  if (at < 0) throw new Error('That is not a TridOS app code (it should start with TRIDAPP1.).');
  const body = /^[A-Za-z0-9_-]+/.exec(t.slice(at + PREFIX.length));
  if (!body) throw new Error('That app code is empty.');
  let pkg;
  try {
    const raw = zlib.inflateRawSync(Buffer.from(body[0], 'base64url'), { maxOutputLength: MAX_CODE * 2 });
    pkg = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('That app code is damaged or was cut off. Copy all of it again.');
  }
  return checkPackage(pkg);
}

export function checkPackage(pkg) {
  const bad = (m) => {
    throw new Error(m);
  };
  if (!pkg || typeof pkg !== 'object' || pkg.tridosApp !== 1) bad('That is not a TridOS app.');
  for (const k of ['id', 'name', 'version', 'code', 'sha256']) if (typeof pkg[k] !== 'string' || !pkg[k]) bad(`The app is missing its ${k}.`);
  if (!/^[a-z0-9-]{1,40}$/.test(pkg.id) || slug(pkg.name) !== pkg.id) bad('The app has a bad id.');
  if (pkg.name.length > 40 || String(pkg.desc || '').length > 140 || String(pkg.author || '').length > 40) bad('The app details are too long.');
  if (!/^[0-9A-Za-z.+-]{1,20}$/.test(pkg.version)) bad('The app has a bad version.');
  if (pkg.code.length > MAX_CODE) bad('The app is too big.');
  if (sha256(pkg.code) !== pkg.sha256) bad('The app was changed after it was made (its checksum does not match). Do not install it.');
  const icon = pkg.icon && typeof pkg.icon === 'object' ? pkg.icon : {};
  return { ...pkg, desc: String(pkg.desc || ''), author: String(pkg.author || ''), icon: { color: iconColor(icon.color), glyph: String(icon.glyph || pkg.name)[0] || '?', ...iconSymbol(icon.symbol) } };
}

// What an app from someone else may not do. These are refused (not just warned about) because each one reaches outside the app.
const BLOCKED = [
  [/\brequire\b/, 'require (loading modules)'],
  [/\bimport\b\s*[\w{*(]/, 'import'],
  [/\bprocess\b/, 'process'],
  [/\bchild_process\b|\bspawn\b|\bexecSync\b|\bexecFile\b|\bexec\s*\(/, 'running commands'],
  [/\beval\b/, 'eval'],
  [/\bFunction\b/, 'Function'],
  [/\bglobalThis\b|\bglobal\b|\bwindow\b|\bself\b/, 'the global object'],
  [/\.constructor\b|\bconstructor\s*\[|__proto__|\bprototype\b|\bReflect\b|\bProxy\b|\bgetPrototypeOf\b/, 'reaching into object internals'],
  [/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bhttps?\b\s*\./, 'the network'],
  [/\bBuffer\b|\bfs\b\s*\.|\breadFile|\bwriteFile|\bunlink|\brmSync/, 'reading or writing files'],
  [/\bos\.(term|windows|apps|userApps|builtin|installed|saveNow|uninstall|install|reloadUserApps|shutdown|compileUserApp|renderer)\b/, 'the TridOS internals (os.term, os.windows, ...)'],
  [/\\u00|\\x[0-9a-f]{2}|String\.fromCharCode|atob\s*\(/i, 'hidden text (escapes, fromCharCode, atob)'],
];

// obj["name"] and obj['name'] look a property up by text, which can reach anything. (An array of strings, ['a', 'b'], is fine:
// a word like return / case / in in front of the bracket means it starts an array, not a lookup.)
const NOT_A_LOOKUP = new Set(['return', 'case', 'in', 'of', 'typeof', 'void', 'delete', 'throw', 'new', 'else', 'do', 'yield', 'await', 'default', 'instanceof']);
function textLookup(line) {
  const re = /([\w$]+|\]|\))\s*\[\s*['"`]/g;
  let m;
  while ((m = re.exec(line))) if (!NOT_A_LOOKUP.has(m[1])) return true;
  return false;
}

// -> [{ what, line }] for everything not allowed; an empty list means nothing was found (which is not a guarantee).
export function scanSource(code) {
  const found = [];
  const lines = String(code).split('\n');
  const bare = lines.map((l) => l.replace(/\/\/.*$/, ''));
  for (const [re, what] of BLOCKED) {
    const i = bare.findIndex((l) => re.test(l));
    if (i >= 0) found.push({ what, line: i + 1 });
  }
  const j = bare.findIndex(textLookup);
  if (j >= 0) found.push({ what: 'looking up names by text (obj["name"])', line: j + 1 });
  return found;
}
