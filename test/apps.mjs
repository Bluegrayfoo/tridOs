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
import storeDef from '../src/apps/appstore.js';
import { drawIcon } from '../src/icons.js';
import { calculator, converter, calendar, calculate, convert, monthDays, monthGrid } from '../src/apps/utilities.js';

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

process.env.TRIDOS_CATALOG_API='http://127.0.0.1:1/contents';
const builtin=loadBuiltinApps();
const shopOS={...os,builtin,apps:builtin,userApps:{},installed:['appstore'],
 isInstalled(id){return this.installed.includes(id);},
 install(id){this.installed.push(id);},appDef(id){return this.apps[id];}};
const store=storeDef.create(shopOS,{},{});
assert.ok(store.list().some(d=>d.id==='tricycle-browser'),'browser must actually appear in Discover');
assert.ok(store.list().some(d=>d.id==='clock-stopwatch'),'clock must actually appear in Discover');
assert.ok(!store.list().some(d=>d.id==='settings'||d.id==='appstore'));
// Future built-in apps must appear without maintaining a second list.
shopOS.builtin.future={id:'future',name:'Future App',desc:'A new built-in'};
assert.ok(store.list().some(d=>d.id==='future'));
const search=s=>{store.key({key:'f',ctrl:true});for(const c of s)store.key({key:c,text:c});};
search('TRICYCLE'); assert.deepEqual(store.list().map(d=>d.id),['tricycle-browser']);
assert.equal(store.key({key:'enter'}),true); // leaves search; does not install by accident
assert.equal(shopOS.isInstalled('tricycle-browser'),false);
store.key({key:'enter'}); store.tick(10);
assert.equal(shopOS.isInstalled('tricycle-browser'),true,'filtered Get installs browser');
store.go('installed'); assert.deepEqual(store.list().map(d=>d.id),['tricycle-browser']);
store.go('discover'); search('stopwatch pause'); assert.deepEqual(store.list().map(d=>d.id),['clock-stopwatch']);
search('no such app'); assert.equal(store.list().length,0);
const sc=new Canvas(240,70,'octant',1),sv=new ui.View(sc,0,0,78,28);
store.draw(sv,true); assert.ok(sc.tch.join('').includes('No apps match'));
store.key({key:'escape'}); assert.equal(store.search.text,'');assert.equal(store.searchFocused,false);
store.draw(sv,true); store.mouse({kind:'wheel',dir:1}); store.draw(sv,true);
assert.equal(store.scroll,1,'wheel must not snap back to the previous selection');
store.community=[{pkg:makePackage({name:'Shared example',author:'Ada',code:'module.exports={};'}),url:'https://example.com'}];
search('ada'); assert.equal(store.list()[0].name,'Shared example');
store.searchFocused=false; store.draw(sv,true);
store.mouse({kind:'down',button:0,x:32,y:1});assert.equal(store.searchFocused,true);
store.key({key:'backspace'}); assert.equal(store.search.text,'');
search('clock'); assert.equal(store.save().query,'clock');
assert.equal(decodePackage(encodePackage(pkg)).icon.symbol,'clock');
const unknown=makePackage({...clock,icon:{symbol:'__proto__',glyph:'C'},code:source});
assert.equal(unknown.icon.symbol,undefined);
for(const icon of ['tricycle',{symbol:'clock',color:'#ed9d38',glyph:'C'}]) {
 for(const size of [16,32,64]) {
  const cv=new Canvas(size,size,'half');cv.fill(0);
  drawIcon(cv,icon,0,0,size,size);
  assert.ok(new Set(cv.pix).size>8);
 }
}
console.log('PASS: store discovery, future apps, search by name/description/author, filtered installation, empty results, mouse/keyboard focus, saved search, artwork and safe package icon roundtrip');

for(const [expression,result]of [['2 + 3 * 4',14],['(2+3)*4',20],['-2^2',-4],['2^-2',.25],['2^3^2',512],['200*10%',20],['.5+1e2',100.5],['-(1 + 2)',-3]])assert.equal(calculate(expression),result,expression);
for(const expression of ['','1/0','1 2','foo(1)','1+','(1+2','2**3','1e999','2^9999'])assert.throws(()=>calculate(expression),expression);
assert.ok(Math.abs(convert(1,0,7,0)-1609.344)<1e-9);
assert.equal(convert(1,1,3,0),.45359237);
assert.equal(convert(32,2,1,0),0);assert.equal(convert(0,2,0,2),273.15);
assert.equal(convert(-40,2,0,1),-40);assert.throws(()=>convert(-1,2,2,0));
assert.equal(convert(1,3,2,0),3.785411784);assert.equal(convert(2,5,2,1),120);
assert.ok(Math.abs(convert(60,4,2,1)-96.56064)<1e-8);
assert.throws(()=>convert(Infinity,0,0,1));
assert.equal(monthDays(2000,1),29);assert.equal(monthDays(1900,1),28);assert.equal(monthDays(2024,1),29);
const feb=monthGrid(2024,1);assert.equal(feb.length,42);assert.equal(feb[4],1);assert.equal(feb.filter(Boolean).length,29);
const calc=calculator.create(os,{},{});
for(const c of '7*8')calc.key({key:c,text:c});calc.key({key:'enter'});assert.equal(calc.save().result,'56');
assert.equal(calculator.create(os,{},calc.save()).save().history.length,1);
const conv=converter.create(os,{},{});conv.key({key:'t'});assert.equal(conv.save().to,2);conv.key({key:'tab'});assert.equal(conv.save().category,1);
let noteDone;
const cal=calendar.create({...os,ask(title,message,initial,done){noteDone=done;}},{},{year:2024,month:11,selected:31});
cal.key({key:'right'});assert.equal(cal.save().year,2025);assert.equal(cal.save().month,0);assert.equal(cal.save().selected,1);
cal.key({key:'enter'});cal.key({key:'right'});noteDone('Remember this');assert.equal(cal.save().notes['2025-01-01'],'Remember this');
assert.equal(calendar.create(os,{},cal.save()).save().notes['2025-01-01'],'Remember this');
for(const def of [calculator,converter,calendar]){
 assert.ok(loadBuiltinApps()[def.id]);
 store.clearSearch();store.search.set(def.name);assert.ok(store.list().some(d=>d.id===def.id));
 for(const [w,h]of [def.minSize,def.size]){const cv=new Canvas(w*3,Math.ceil(h*10/4));def.create(os,{},{}).draw(new ui.View(cv,0,0,w,h),true);assert.ok(cv.pix.some(c=>c!==th.bg));}
}
console.log('PASS: utility store discovery, calculator precedence/validation/history, six conversion categories, leap years/month boundaries, date notes and responsive drawing');
