// Chromium renders the web; TridOS displays its pixels and forwards input.
// No Node bindings or TridOS APIs are exposed to sites.
import fs from 'node:fs';
import { ensureBrowser } from './browser-setup.js';

export function address(text) {
  const s = String(text || '').trim();
  if (!s || s === 'tricycle:home' || s === 'about:blank') return 'about:blank';
  const host = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s);
  const candidate = host ? 'http://' + s : /^[a-z][a-z\d+.-]*:/i.test(s) ? s : /^[^\s]+\.[^\s]+/.test(s) ? 'https://' + s : null;
  if (!candidate) return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
  const u = new URL(candidate);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Enter an http or https address.');
  return u.href;
}

const HOME = `<!doctype html><html><meta charset="utf-8"><title>Tricycle</title>
<style>body{margin:0;background:#eef3f8;color:#243347;font:16px system-ui}main{max-width:650px;margin:10vh auto;padding:24px}h1{font-size:42px;margin:0}p{color:#5a6b80}form{display:flex;gap:8px;margin:30px 0}input{flex:1;min-width:0;padding:14px;border:1px solid #b9c8da;border-radius:8px;font:inherit}button,a{border:0;border-radius:8px;background:#176ab5;color:white;padding:14px;font:inherit}nav{display:flex;flex-wrap:wrap;gap:12px}a{text-decoration:none;background:white;color:#176ab5;border:1px solid #c9d6e4}small{display:block;margin-top:32px;color:#66788c}</style>
<main><h1>Tricycle</h1><p>The real web, inside your terminal desktop.</p>
<form action="https://duckduckgo.com/" method="get"><input name="q" aria-label="Search the web" placeholder="Search the web"><button>Search</button></form>
<nav><a href="https://www.wikipedia.org">Wikipedia</a><a href="https://example.com">Example</a><a href="https://github.com/Bluegrayfoo/tridOs">TridOS</a></nav>
<small>HTML, CSS and JavaScript powered by Chromium. This is a private session: cookies and logins disappear when you close Tricycle.</small></main></html>`;

export class BrowserSession {
  constructor(changed = () => {}, notify = () => {}) {
    this.changed = changed; this.notify = notify;
    this.tabs = []; this.selected = 0; this.closed = false;
    this.frame = null; this.error = ''; this.width = 800; this.height = 500;
    this.queue = Promise.resolve(); this.capturing = false;
    this.settingUp = false; this.setupMessage = ''; // true while the first-time setup runs
  }
  get page() { return this.tabs[this.selected]?.page; }
  async start(url = 'about:blank') {
    try {
      // First time: install the browser packages and Chromium by itself (shown in the window), then carry on.
      const { chromium, PNG } = await ensureBrowser({ onProgress: m => { this.settingUp = true; this.setupMessage = m; this.changed(); } });
      this.settingUp = false;
      this.PNG = PNG;
      let channel = process.env.TRIDOS_BROWSER_CHANNEL;
      if (!channel && !fs.existsSync(chromium.executablePath()) && process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app')) channel = 'chrome';
      this.browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(channel ? { channel } : {}) });
      if (this.closed) { await this.browser.close(); return; }
      this.context = await this.browser.newContext({ viewport: { width: this.width, height: this.height }, acceptDownloads: false });
      this.context.on('page', page => this.attach(page));
      this.browser.on('disconnected', () => { if (!this.closed) this.fail(new Error('Browser stopped. Close and reopen Tricycle.')); });
      await this.newTab(url);
    } catch (e) {
      this.settingUp = false;
      if (!this.closed) this.fail(new Error('Browser could not start. ' + e.message.split('\n')[0]));
    }
  }
  fail(e) { this.error = String(e.message || e).split('\n')[0]; this.changed(); }
  attach(page) {
    if (this.closed || this.tabs.length >= 8) { page.close().catch(() => {}); return; }
    const tab = { page, title: 'New tab', url: 'about:blank' };
    this.tabs.push(tab); this.selected = this.tabs.length - 1; this.frame = null;
    page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(25000);
    const update = async () => {
      if (this.closed || page.isClosed()) return;
      tab.url = page.url();
      try { tab.title = await page.title() || 'New tab'; } catch {}
      this.changed();
    };
    page.on('framenavigated', f => { if (f === page.mainFrame()) { this.error = ''; void update(); } });
    page.on('domcontentloaded', () => void update());
    page.on('close', () => {
      const i = this.tabs.indexOf(tab);
      if(i >= 0) { this.tabs.splice(i,1); this.selected = Math.max(0,Math.min(this.selected,this.tabs.length-1)); }
      this.frame = null; this.changed();
    });
    page.on('dialog', dialog => { this.notify('Page dialog: ' + dialog.message()); dialog.dismiss().catch(() => {}); });
    page.on('download', download => { download.cancel().catch(() => {}); this.notify('Downloads are not supported in this version.'); });
    page.on('filechooser', () => this.notify('File uploads are not supported in this version.'));
    page.on('crash', () => this.fail(new Error('This tab crashed. Close it and open a new tab.')));
    this.changed();
  }
  async newTab(url = 'about:blank') {
    if (this.closed || !this.context || this.tabs.length >= 8) return;
    const page = await this.context.newPage();
    if (!this.closed && !page.isClosed()) await this.navigate(url, page);
  }
  async navigate(value, page = this.page) {
    if (!page || this.closed) return;
    this.error = ''; const url = address(value);
    if (url === 'about:blank') {
      await page.goto('about:blank'); await page.setContent(HOME, { waitUntil: 'domcontentloaded' });
    } else await page.goto(url, { waitUntil: 'domcontentloaded' });
    const tab = this.tabs.find(t => t.page === page);
    if (tab) { tab.url = page.url(); tab.title = await page.title(); }
    this.changed();
  }
  act(fn) {
    this.queue = this.queue.then(async () => { if (!this.closed) await fn(); }).catch(e => { if(!this.closed) this.fail(e); });
    return this.queue;
  }
  select(index) { if (this.tabs[index]) { this.selected=index; this.frame=null; this.error=''; this.changed(); } }
  async capture() {
    const page = this.page;
    if (this.closed || !page || page.isClosed() || this.capturing) return;
    this.capturing = true;
    try {
      const size = page.viewportSize();
      if(size.width !== this.width || size.height !== this.height) await page.setViewportSize({ width:this.width, height:this.height });
      const image = this.PNG.sync.read(await page.screenshot({ type:'png', timeout:5000 }));
      if(!this.closed && page===this.page) { this.frame=image; this.changed(); }
    } catch (e) { if(!this.closed && !page.isClosed()) this.fail(e); }
    finally { this.capturing=false; }
  }
  async close() {
    this.closed=true; this.frame=null;
    if(this.browser) await this.browser.close().catch(() => {});
  }
}
