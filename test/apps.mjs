import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Canvas } from '../src/gfx.js';
import * as ui from '../src/ui.js';
import * as util from '../src/util.js';
import clock from '../src/apps/clock-app.cjs';
import { address, BrowserSession } from '../src/browser-engine.js';
import { Tricycle } from '../src/apps/tricycle.js';
import { loadBuiltinApps } from '../src/apps/index.js';
import { scanSource, makePackage, encodePackage, decodePackage } from '../src/pack.js';

const th={bg:0xffffff,text:0x222222,dim:0x777777,accent:0x1166cc,line:0xcccccc,field:0xeeeeee,side:0xeeeeee,ctrl:0xdddddd,sel:0xaaccff};
const os={ui,util,th,settings:{clock24:true},dirty:false,toast() {}};
const source=fs.readFileSync(new URL('../src/apps/clock-app.cjs',import.meta.url),'utf8');
assert.deepEqual(scanSource(source),[]);
const pkg=makePackage({...clock,code:source});
assert.equal(decodePackage(encodePackage(pkg)).code,source);
assert.ok(loadBuiltinApps()['tricycle-browser']);
assert.ok(loadBuiltinApps()['clock-stopwatch']);

let mono=1000, wall=10000;
const context=vm.createContext({ module:{exports:{}}, performance:{now:()=>mono}, Date:class extends Date { static now(){return wall;} } });
vm.runInContext(source,context);
const def=context.module.exports;
const app=def.create(os,{},{});
app.key({key:'tab'}); app.key({key:' '}); mono+=1234;
assert.equal(app.save().elapsed,1234);
// Changing the system clock must not change an active stopwatch.
wall+=3600000; assert.equal(app.save().elapsed,1234);
app.key({key:'l'}); assert.equal(app.save().laps[0],1234);
app.key({key:' '}); mono+=4000; assert.equal(app.save().elapsed,1234);
app.key({key:' '}); mono+=1000; assert.equal(app.save().elapsed,2234);
const running=app.save(); wall+=3000;
const restored=def.create(os,{},running); assert.equal(restored.save().elapsed,5234);
app.key({key:'r'}); assert.equal(app.save().elapsed,2234); // running reset is ignored
app.key({key:' '}); app.key({key:'r'}); assert.equal(app.save().elapsed,0);
for(const [w,h] of [[36,17],[54,24],[100,40]]) {
 const cv=new Canvas(w*3,Math.ceil(h*10/4)); const v=new ui.View(cv,0,0,w,h);
 app.draw(v); app.key({key:'tab'}); app.draw(v); app.key({key:'tab'});
 assert.ok(cv.pix.some(c=>c!==th.bg));
}
assert.equal(address('example.com'),'https://example.com/');
assert.equal(address('http://localhost:4312/path'),'http://localhost:4312/path');
assert.equal(address('localhost:4312'),'http://localhost:4312/');
assert.match(address('terminal desktop'),/duckduckgo/);
for(const s of ['file:///etc/passwd','javascript:alert(1)','data:text/html,hi']) assert.throws(()=>address(s));

// Drive input forwarding through the actual app controller without starting a browser.
const events=[];
const fake={page:{keyboard:{insertText:async t=>events.push(['text',t]),press:async k=>events.push(['key',k])},mouse:{move:async(x,y)=>events.push(['move',x,y]),down:async b=>events.push(['down',b.button]),up:async b=>events.push(['up',b.button]),wheel:async(x,y)=>events.push(['wheel',x,y])}},width:600,height:300,queue:Promise.resolve(),closed:false,act:BrowserSession.prototype.act,fail(e){throw e;}};
const browser=Object.create(Tricycle.prototype);
Object.assign(browser,{os,engine:fake,ready:Promise.resolve(),editing:false,view:{pw:6,ph:10,width:600,height:300}});
browser.key({key:'a',text:'a'}); await fake.queue;
browser.key({key:'tab'}); await fake.queue;
browser.mouse({kind:'down',button:0,px:50,py:80,x:8,y:8}); await fake.queue;
browser.mouse({kind:'up',button:0,px:50,py:80,x:8,y:8}); await fake.queue;
browser.mouse({kind:'wheel',dir:1,px:50,py:80,x:8,y:8}); await fake.queue;
assert.deepEqual(events,[['text','a'],['key','Tab'],['move',50,40],['down','left'],['move',50,40],['up','left'],['move',50,40],['wheel',0,120]]);
console.log('PASS: app registration, clock drawing, monotonic stopwatch, laps, restore/reset, package scan/checksum, browser addresses and input forwarding');
