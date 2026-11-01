// A real Chromium integration test. No public website or credentials needed.
import assert from 'node:assert/strict';
import http from 'node:http';
import { BrowserSession } from '../src/browser-engine.js';
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Type','text/html');
 if(req.url.startsWith('/second')) return res.end('<title>Second page</title><h1>Navigation works</h1>');
 res.end(`<!doctype html><title>Browser test</title><style>body{background:rgb(20,100,180);font:20px sans-serif}button,input,a{display:block;margin:20px}</style><input aria-label="Name"><button onclick="this.textContent='Clicked '+document.querySelector('input').value">Click me</button><a href="/second">Next</a><div style="height:1800px">Scroll me</div>`);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const engine=new BrowserSession();
const base=`http://127.0.0.1:${server.address().port}`;
try {
 await engine.start(base);
 assert.equal(engine.error,'',engine.error);
 assert.equal(engine.tabs.length,1);
 const p=engine.page;
 assert.equal(await p.title(),'Browser test');
 await p.getByRole('textbox',{name:'Name'}).click(); await p.keyboard.insertText('Tricycle');
 await p.getByRole('button').click();
 assert.equal(await p.getByRole('button').textContent(),'Clicked Tricycle');
 await engine.capture(); assert.ok(engine.frame&&engine.frame.data.length>0);
 const i=(10*engine.frame.width+10)*4;
 assert.deepEqual([...engine.frame.data.subarray(i,i+3)],[20,100,180]);
 await p.getByRole('link',{name:'Next'}).click(); await p.waitForURL(base+'/second');
 assert.equal(await p.title(),'Second page');
 await p.goBack(); assert.equal(await p.title(),'Browser test');
 await p.goForward(); assert.equal(await p.title(),'Second page');
 await p.reload(); assert.equal(await p.title(),'Second page');
 engine.width=640;engine.height=360;await engine.capture(); assert.equal(engine.frame.width,640);
 await engine.newTab(); assert.equal(engine.tabs.length,2); assert.equal(await engine.page.title(),'Tricycle');
 await engine.page.close(); assert.equal(engine.tabs.length,1);
 engine.select(0); assert.equal(engine.page,p);
 console.log('PASS: real Chromium HTML/CSS pixels, JavaScript, typed form input, links, back/forward/reload, resize, tabs and cleanup');
} finally { await engine.close(); await new Promise(r=>server.close(r)); }
