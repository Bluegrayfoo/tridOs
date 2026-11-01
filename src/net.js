// Getting an app from a link, and putting one on a link: fetch over https, the clipboard, and GitHub gists through the gh command.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GH = () => process.env.TRIDOS_GH || 'gh';
export const MAX_DOWNLOAD = 400 * 1024;

// Run a command and collect what it prints. Never rejects: { code, out, err, missing }.
export function run(cmd, args, { input = null, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (r) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ code: 0, out, err, missing: false, ...r });
      }
    };
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, out, err: e.message, missing: true });
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: -1, err: 'It took too long.' });
    }, timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ code: -1, err: e.message, missing: e.code === 'ENOENT' }));
    child.on('close', (code) => finish({ code }));
    child.stdin.on('error', () => {});
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function copyText(text) {
  if (process.env.TRIDOS_CLIPBOARD_FILE) {
    // (tests: a file stands in for the clipboard)
    fs.writeFileSync(process.env.TRIDOS_CLIPBOARD_FILE, text);
    return true;
  }
  const tools = process.platform === 'darwin' ? [['pbcopy', []]] : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]];
  for (const [cmd, args] of tools) {
    const r = await run(cmd, args, { input: text, timeout: 5000 });
    if (!r.missing && r.code === 0) return true;
  }
  return false;
}

export async function pasteText() {
  if (process.env.TRIDOS_CLIPBOARD_FILE) return fs.existsSync(process.env.TRIDOS_CLIPBOARD_FILE) ? fs.readFileSync(process.env.TRIDOS_CLIPBOARD_FILE, 'utf8') : '';
  const tools = process.platform === 'darwin' ? [['pbpaste', []]] : [['wl-paste', ['-n']], ['xclip', ['-selection', 'clipboard', '-o']]];
  for (const [cmd, args] of tools) {
    const r = await run(cmd, args, { timeout: 5000 });
    if (!r.missing && r.code === 0) return r.out;
  }
  return null;
}

async function readCapped(res, max) {
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error('That download is too big for an app.');
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString('utf8');
}

async function get(url, max, timeout, accept) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'TridOS', accept: accept || '*/*' } });
  if (!res.ok) throw new Error(`The server said ${res.status} ${res.statusText || ''}`.trim());
  return readCapped(res, max);
}

// The text at a link. https only (and http to this computer, for testing). GitHub gist pages are turned into the gist's file.
export async function fetchText(link, { max = MAX_DOWNLOAD, timeout = 15000 } = {}) {
  let u;
  try {
    u = new URL(String(link).trim());
  } catch {
    throw new Error('That does not look like a link.');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Only https links work.');
  try {
    const m = u.hostname === 'gist.github.com' && /^\/(?:[^/]+\/)?([0-9a-f]{8,})\/?$/i.exec(u.pathname);
    if (m) {
      const api = process.env.TRIDOS_GIST_API || 'https://api.github.com/gists/';
      const info = JSON.parse(await get(api + m[1], 2 * 1024 * 1024, timeout, 'application/vnd.github+json'));
      const files = Object.values(info.files || {});
      const file = files.find((f) => /\.tridapp$/.test(f.filename)) || files[0];
      if (!file) throw new Error('That gist has no files.');
      if (file.content && !file.truncated) return file.content;
      return await get(file.raw_url, max, timeout);
    }
    return await get(u.href, max, timeout);
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('The download took too long.');
    if (e.cause && /ENOTFOUND|ECONN|EAI_AGAIN/.test(String(e.cause.code))) throw new Error('Could not reach that address. Are you online?');
    throw e;
  }
}

function ghMessage(r) {
  if (r.missing) return 'The GitHub command (gh) is not installed. Install it from https://cli.github.com and run: gh auth login';
  const e = (r.err || r.out || '').trim();
  if (/auth login|not logged|authentication|HTTP 401|gh_token/i.test(e)) return 'You are not signed in to GitHub. Run this in a terminal: gh auth login';
  return e.split('\n')[0] || 'GitHub said no.';
}

// Put the package text on a public gist (your GitHub account, through gh). -> { url, id }
export async function publishGist(text, filename, desc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tridos-'));
  const file = path.join(dir, filename);
  try {
    fs.writeFileSync(file, text);
    const r = await run(GH(), ['gist', 'create', '--public', '--desc', desc, file], { timeout: 45000 });
    if (r.code !== 0) throw new Error(ghMessage(r));
    const url = r.out.split('\n').map((l) => l.trim()).filter((l) => /^https:\/\/gist\./.test(l)).pop();
    if (!url) throw new Error('GitHub did not give back a link.');
    return { url, id: url.split('/').pop() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function deleteGist(id) {
  const r = await run(GH(), ['gist', 'delete', id, '--yes'], { timeout: 30000 });
  if (r.code !== 0) throw new Error(ghMessage(r));
}
