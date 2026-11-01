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

// ---------- the catalog: the apps/ folder of the tridOs repo on GitHub ----------
// Browsing needs no account (raw files and the public API). Publishing uses the gh command: someone with write access to the repo
// commits the app straight in; anyone else forks the repo and opens a pull request, so the owner reads every app before it is added.

export const catalogRepo = () => process.env.TRIDOS_CATALOG_REPO || 'knittingCat/tridOs';
export const CATALOG_DIR = 'apps';
const catalogApi = () => process.env.TRIDOS_CATALOG_API || `https://api.github.com/repos/${catalogRepo()}/contents/${CATALOG_DIR}`;
export const catalogUrl = () => `https://github.com/${catalogRepo()}/tree/main/${CATALOG_DIR}`;

// Every package in the catalog: [{ pkg, url }]. Files that are not valid packages are skipped.
export async function fetchCatalog(decode, { limit = 60 } = {}) {
  const list = JSON.parse(await fetchText(catalogApi(), { max: 2 * 1024 * 1024 }));
  if (!Array.isArray(list)) throw new Error('The catalog did not answer properly.');
  const files = list.filter((f) => f.type === 'file' && /\.tridapp$/.test(f.name) && f.download_url).slice(0, limit);
  const out = [];
  for (let i = 0; i < files.length; i += 6) {
    const got = await Promise.all(
      files.slice(i, i + 6).map(async (f) => {
        try {
          return { pkg: decode(await fetchText(f.download_url)), url: f.html_url || f.download_url };
        } catch {
          return null;
        }
      }),
    );
    out.push(...got.filter(Boolean));
  }
  return out;
}

// gh api: JSON in, JSON out. Errors carry the HTTP status.
async function ghJson(args, body = null) {
  const a = ['api', ...args];
  if (body) a.push('--input', '-');
  const r = await run(GH(), a, { input: body ? JSON.stringify(body) : null, timeout: 45000 });
  if (r.code !== 0) {
    const e = new Error(ghMessage(r));
    e.status = Number(/HTTP (\d{3})/.exec(r.err + r.out)?.[1] || 0);
    throw e;
  }
  try {
    return r.out.trim() ? JSON.parse(r.out) : {};
  } catch {
    return {};
  }
}
const notFound = (e) => e.status === 404;

// Add (or update) an app in the catalog. -> { mode: 'direct' | 'pr', url }
export async function publishToCatalog(text, pkg) {
  const repo = catalogRepo();
  const file = `${CATALOG_DIR}/${pkg.id}.tridapp`;
  const login = (await ghJson(['user'])).login;
  let existing = null;
  try {
    existing = await ghJson([`repos/${repo}/contents/${file}`]);
  } catch (e) {
    if (!notFound(e)) throw e;
  }
  const content = Buffer.from(text + '\n').toString('base64');
  const message = `${existing ? 'Update' : 'Add'} ${pkg.name} v${pkg.version}${pkg.author ? ' by ' + pkg.author : ''}`;
  try {
    const r = await ghJson(['-X', 'PUT', `repos/${repo}/contents/${file}`], { message, content, ...(existing ? { sha: existing.sha } : {}) });
    return { mode: 'direct', url: r.content?.html_url || `https://github.com/${repo}/blob/main/${file}` };
  } catch (e) {
    if (![403, 404, 422].includes(e.status)) throw e; // no write access: go through a pull request instead
  }
  const fork = await ghJson(['-X', 'POST', `repos/${repo}/forks`]);
  const forkName = fork.full_name || `${login}/${repo.split('/')[1]}`;
  for (let i = 0; i < 20; i++) {
    try {
      await ghJson([`repos/${forkName}`]);
      break;
    } catch (e) {
      if (!notFound(e) || i === 19) throw e;
      await new Promise((r) => setTimeout(r, process.env.TRIDOS_GH ? 10 : 1500));
    }
  }
  const base = (await ghJson([`repos/${repo}`])).default_branch || 'main';
  const sha = (await ghJson([`repos/${repo}/git/ref/heads/${base}`])).object?.sha;
  const branch = `publish-${pkg.id}-${Date.now().toString(36)}`;
  await ghJson(['-X', 'POST', `repos/${forkName}/git/refs`], { ref: `refs/heads/${branch}`, sha });
  let there = null;
  try {
    there = await ghJson([`repos/${forkName}/contents/${file}?ref=${branch}`]);
  } catch (e) {
    if (!notFound(e)) throw e;
  }
  await ghJson(['-X', 'PUT', `repos/${forkName}/contents/${file}`], { message, content, branch, ...(there ? { sha: there.sha } : {}) });
  const pr = await ghJson(['-X', 'POST', `repos/${repo}/pulls`], {
    title: message,
    head: `${login}:${branch}`,
    base,
    body: `An app for the TridOS catalog, made with App Distributor.\n\n- **${pkg.name}** v${pkg.version}\n- by ${pkg.author || login}\n- ${pkg.desc || 'no description'}\n- checksum \`${pkg.sha256}\`\n\nPlease read \`${file}\` (decode it in App Distributor, Get apps) before merging: it is code that runs on people's computers.`,
  });
  return { mode: 'pr', url: pr.html_url };
}

// Take an app out of the catalog (only works if you have write access).
export async function removeFromCatalog(appId) {
  const repo = catalogRepo();
  const file = `${CATALOG_DIR}/${appId}.tridapp`;
  const existing = await ghJson([`repos/${repo}/contents/${file}`]);
  await ghJson(['-X', 'DELETE', `repos/${repo}/contents/${file}`], { message: `Remove ${appId}`, sha: existing.sha });
}
