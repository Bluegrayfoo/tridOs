import { BrowserSession } from '../browser-engine.js';
import { Hits, button, LineInput } from '../ui.js';
import { fit } from '../util.js';

export class Tricycle {
  constructor(os, win, saved) {
    this.os=os; this.win=win; this.hits=new Hits(); this.address=new LineInput('');
    this.editing=false; this.lastCapture=0; this.view=null;
    this.engine=new BrowserSession(() => { os.dirty=true; }, message => os.toast(message));
    this.ready=this.engine.start(saved?.url || 'about:blank');
  }
  title() { return 'Tricycle browser — ' + (this.engine.tabs[this.engine.selected]?.title || 'New tab'); }
  save() { return { url:this.engine.page?.url() || 'about:blank' }; }
  close() { void this.engine.close(); }
  action(fn) { return this.engine.act(async () => { await this.ready; await fn(); }); }
  location() { this.address.set(this.engine.page?.url()==='about:blank'?'':this.engine.page?.url()||''); this.editing=true; this.replaceAddress=true; }
  navigate() { const value=this.address.text; this.editing=false; void this.action(() => this.engine.navigate(value)); }
  draw(v, focused) {
    const th=this.os.th, e=this.engine;
    v.fill(th.bg); this.hits.reset();
    button(v,this.hits,0,0,'Back',th,() => this.action(() => e.page?.goBack({waitUntil:'domcontentloaded'})));
    button(v,this.hits,8,0,'Next',th,() => this.action(() => e.page?.goForward({waitUntil:'domcontentloaded'})));
    button(v,this.hits,16,0,'Reload',th,() => this.action(() => e.page?.reload({waitUntil:'domcontentloaded'})));
    button(v,this.hits,26,0,'Home',th,() => this.action(() => e.navigate('about:blank')));
    button(v,this.hits,34,0,'+',th,() => this.action(() => e.newTab()));
    button(v,this.hits,39,0,'Close tab',th,() => this.action(async () => { await e.page?.close(); if(!e.tabs.length) await e.newTab(); }));
    const tw=Math.max(5,Math.floor(v.w/Math.max(1,e.tabs.length)));
    e.tabs.forEach((t,i) => {
      v.rect(i*tw,1,tw,1,i===e.selected?th.sel:th.side);
      v.text(i*tw+1,1,fit(t.title,tw-2),th.text);
      this.hits.add(i*tw,1,tw,1,() => { e.select(i); this.editing=false; });
    });
    v.text(1,2,'URL',th.dim);
    if(!this.editing) this.address.set(e.page?.url()==='about:blank'?'tricycle:home':e.page?.url()||'');
    this.address.draw(v,5,2,Math.max(1,v.w-12),th,{focus:focused&&this.editing,bg:this.editing&&this.replaceAddress?th.sel:th.field});
    this.hits.add(5,2,Math.max(1,v.w-12),1,() => this.location());
    button(v,this.hits,v.w-6,2,'Go',th,() => this.navigate());
    const content=v.sub(0,4,v.w,Math.max(1,v.h-5));
    this.view={pw:v.pw,ph:v.ph,width:content.pxW,height:content.pxH};
    e.width=Math.max(1,Math.min(2400,content.pxW)); e.height=Math.max(1,Math.min(1800,content.pxH));
    if(e.frame) {
      const {width,height,data}=e.frame;
      for(let y=0;y<content.pxH;y++) for(let x=0;x<content.pxW;x++) {
        const i=(Math.min(height-1,Math.floor(y*height/content.pxH))*width+Math.min(width-1,Math.floor(x*width/content.pxW)))*4;
        content.px(x,y,(data[i]<<16)|(data[i+1]<<8)|data[i+2]);
      }
    } else {
      if(e.error) {
        content.text(2,2,'Browser unavailable',th.danger);
        content.text(2,4,'It tries to set itself up the first time. To do it by hand, run in a terminal:',th.dim);
        content.text(2,6,'node src/browser-setup.js',th.accent);
        content.text(2,7,'(in the TridOS folder; or: npm install, then npm run browser:install)',th.dim);
      } else if(e.settingUp) {
        content.text(2,2,'Setting up the browser (first time only)…',th.text);
        content.text(2,4,fit(e.setupMessage||'Starting…',Math.max(10,content.w-4)),th.accent);
        content.text(2,6,'This downloads Chromium once (about 150 MB) and then it opens by itself.',th.dim);
      } else content.text(2,2,'Starting Chromium…',th.text);
    }
    v.text(1,v.h-1,fit(e.error||'Ctrl+L address  Ctrl+T new tab  Ctrl+R reload  Click page to type',v.w-2),e.error?th.danger:th.dim);
  }
  tick(dt,focused) {
    const now=Date.now();
    if(now-this.lastCapture>(focused?200:1500)) { this.lastCapture=now; void this.engine.capture(); }
    return false;
  }
  key(ev) {
    const k=ev.key;
    if(ev.ctrl&&k==='l') { this.location(); return true; }
    if(ev.ctrl&&k==='t') { void this.action(() => this.engine.newTab()); return true; }
    if(ev.ctrl&&k==='r') { void this.action(() => this.engine.page?.reload({waitUntil:'domcontentloaded'})); return true; }
    if(this.editing) {
      if(k==='enter') this.navigate();
      else if(k==='escape') this.editing=false;
      else if(ev.ctrl&&k==='a') this.replaceAddress=true;
      else {
        if(this.replaceAddress && ((!ev.ctrl&&!ev.alt&&ev.text)||k==='backspace'||k==='delete')) this.address.set('');
        this.replaceAddress=false;
        this.address.key(ev);
      }
      return true;
    }
    if(k==='escape') return false;
    const names={enter:'Enter',backspace:'Backspace',delete:'Delete',tab:'Tab',up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown'};
    void this.action(async () => {
      const page=this.engine.page;
      if(!page) return;
      if(!ev.ctrl&&!ev.alt&&!names[k]&&(ev.text||k.length===1)) await page.keyboard.insertText(ev.text||k);
      else {
        const modifiers=[ev.ctrl?'Control':'',ev.alt?'Alt':'',ev.shift?'Shift':''].filter(Boolean);
        await page.keyboard.press([...modifiers,names[k]||k].join('+'));
      }
    });
    return true;
  }
  mouse(ev) {
    if(ev.kind==='down'&&ev.y<4) { if(ev.button===0) this.hits.click(ev.x,ev.y); return; }
    const v=this.view;
    if(!v || ((!this.pointerDown || ev.kind!=='up') && (ev.py<4*v.ph||ev.py>=4*v.ph+v.height))) return;
    if(ev.kind==='down') this.pointerDown=true;
    if(ev.kind==='up') this.pointerDown=false;
    this.editing=false;
    const x=Math.max(0,Math.min(this.engine.width-1,Math.floor(ev.px*this.engine.width/v.width)));
    const y=Math.max(0,Math.min(this.engine.height-1,Math.floor((ev.py-4*v.ph)*this.engine.height/v.height)));
    void this.action(async () => {
      const page=this.engine.page; if(!page) return;
      await page.mouse.move(x,y);
      if(ev.kind==='wheel') await page.mouse.wheel(0,ev.dir*120);
      const button=['left','middle','right'][ev.button]||'left';
      if(ev.kind==='down') await page.mouse.down({button});
      if(ev.kind==='up') await page.mouse.up({button});
    });
  }
}

export default {
  id:'tricycle-browser', name:'Tricycle browser', version:'1.0.0',
  desc:'A real Chromium browser: websites, JavaScript, forms and tabs in terminal pixels.',
  icon:'tricycle', size:[110,36], minSize:[50,14],
  create:(os,win,saved) => new Tricycle(os,win,saved),
};
