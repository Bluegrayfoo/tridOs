import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import system from 'node:os';
import vm from 'node:vm';
const home=fs.mkdtempSync(path.join(system.tmpdir(),'tridos-productivity-'));process.env.TRIDOS_HOME=home;process.env.TRIDOS_CATALOG_API='http://127.0.0.1:1/contents';
const {OS}=await import('../src/os.js');
const {Canvas}=await import('../src/gfx.js');
const ui=await import('../src/ui.js'),util=await import('../src/util.js');
const {loadBuiltinApps}=await import('../src/apps/index.js');
const {evaluateSheet,parseCSV,exportCSV}=await import('../src/apps/spreadsheet.js');
const {diskFile}=await import('../src/apps/app-data.js');
const {scanDisk}=await import('../src/apps/monitor.js');
const {parseColor}=await import('../src/apps/productivity.js');
const {markdownLines,textStats,transformText}=await import('../src/apps/text-tools.js');
const {DISK,ensureDirs}=await import('../src/fs.js');ensureDirs();
const th={bg:0xffffff,text:0x222222,dim:0x777777,accent:0x1166cc,line:0xcccccc,field:0xeeeeee,side:0xeeeeee,ctrl:0xdddddd,sel:0xaaccff,danger:0xcc2222};
const os={ui,util,th,settings:{clock24:true},toast(){}};
const ids=['notes','color-picker','system-monitor','disk-usage','spreadsheets'];
const builtin=loadBuiltinApps();
for(const id of ids)for(const saved of [null,undefined,{}])for(const [w,h]of [builtin[id].minSize,builtin[id].size]){
 const app=builtin[id].create(os,{w,h},saved),cv=new Canvas(w*3,Math.ceil(h*10/4));app.draw(new ui.View(cv,0,0,w,h),true);assert.ok(cv.pix.some(c=>c!==th.bg),id);app.close?.();
}
// The real launcher passes null; verify discovery, creation, draw, close and reopen.
const desktop=new OS({cols:780,rows:120});desktop.settings.boot=false;
for(const id of ids){desktop.install(id);const win=desktop.launch(id);assert.ok(win,id);desktop.draw();const data=win.app.save();desktop.closeWindow(win,true);assert.ok(desktop.launch(id,data));}
const store=desktop.launch('appstore').app;for(const id of ids)assert.ok(store.list().some(a=>a.id===id));
console.log('PASS: all new apps launch through the OS, draw at minimum/default sizes, close, reopen and appear in the store');

let done;const noteOS={...os,ask(title,message,initial,callback){done=callback;}};
const note=builtin.notes.create(noteOS,{}, {items:[{title:'Test',text:'[ ] task'}]});note.key({key:'t',ctrl:true});assert.equal(note.save().items[0].text,'[x] task');note.key({key:'n',ctrl:true});done('Second');note.key({key:'H',text:'Hello'});note.close();assert.equal(builtin.notes.create(noteOS,{},null).save().items[1].text,'Hello');
assert.equal(parseColor('#abc'),0xaabbcc);assert.equal(parseColor('rgb(255, 0, 128)'),0xff0080);assert.throws(()=>parseColor('256,0,0'));
assert.deepEqual(textStats('One two\nthree'),{words:3,characters:13,lines:2});assert.equal(transformText('b\na\nb','unique'),'b\na');assert.equal(transformText('b\na','sort'),'a\nb');assert.equal(transformText('a  \nb\t','trim'),'a\nb');
const rendered=markdownLines('# Heading\n\n- **Item**\n```js\nconst x = 1;\n```',30);assert.equal(rendered[0].kind,'heading');assert.ok(rendered.some(r=>r.text==='• Item'));assert.ok(rendered.some(r=>r.kind==='code'));
const editor=builtin.editor.create(os,{},null);editor.ta.setText('b\na\nb');editor.transform('unique');assert.equal(editor.ta.getText(),'b\na');editor.ta.undo();assert.equal(editor.ta.getText(),'b\na\nb');editor.key({key:'p',ctrl:true});editor.draw(new ui.View(new Canvas(180,60),0,0,60,20),true);assert.equal(editor.preview,true);
console.log('PASS: notes survive close/reopen, checklists, colors, Markdown preview and undoable text tools');

const cells={A1:'10',A2:'20',A3:'text',B1:'=SUM(A1:A3)',B2:'=AVERAGE(A1:A3)',B3:'=MAX(A1:A3)-MIN(A1:A3)',C1:'=(B1+B2)*2',D1:'=D2',D2:'=D1',E1:'=A3+1',F1:'=A501',G1:'=SUM(A1:A2,5)',H1:'=2^3',I1:'=1e2',J1:'=SUM(A1:A2)*-2'};
const get=evaluateSheet(cells);for(const [id,result]of Object.entries({B1:30,B2:15,B3:10,C1:90,D1:'#CYCLE!',D2:'#CYCLE!',E1:'#VALUE!',F1:'#REF!',G1:35,H1:8,I1:100,J1:-60}))assert.equal(get(id),result,id);
assert.equal(evaluateSheet({A1:'=process.exit()'})('A1'),'#FORMULA!');assert.equal(evaluateSheet({A1:'=1/0'})('A1'),'#FORMULA!');
const csv='"hello, world","a""b","line1\nline2"\r\n1,2,3\r\n';const imported=parseCSV(csv);assert.equal(imported.A1,'hello, world');assert.equal(imported.B1,'a"b');assert.equal(imported.C1,'line1\nline2');assert.equal(imported.C2,'3');assert.deepEqual({...parseCSV(exportCSV(imported))},{...imported});assert.throws(()=>parseCSV('"open'));assert.throws(()=>parseCSV('"a"oops'));assert.throws(()=>parseCSV('x,'.repeat(26)));
assert.equal(parseCSV(exportCSV({A1:'2',A2:'3',A3:'=SUM(A1:A2)'})).A3,'5');
const sheet=builtin.spreadsheets.create(os,{},{});sheet.key({key:'1',text:'12'});sheet.key({key:'enter'});sheet.key({key:'=',text:'=A1*2'});sheet.key({key:'enter'});assert.equal(evaluateSheet(sheet.save().cells)('A2'),24);sheet.key({key:'z',ctrl:true});assert.equal(sheet.save().cells.A2,undefined);sheet.key({key:'y',ctrl:true});sheet.close();assert.equal(builtin.spreadsheets.create(os,{},null).save().cells.A2,'=A1*2');
const draft=builtin.spreadsheets.create(os,{},{});draft.key({key:'x',text:'draft'});draft.close();assert.equal(builtin.spreadsheets.create(os,{},null).save().cells.A1,'draft');
console.log('PASS: spreadsheet formulas, ranges, errors, cycles, CSV quotes/newlines, values export, undo/redo and draft persistence');

fs.mkdirSync(path.join(DISK,'test'));fs.writeFileSync(path.join(DISK,'test','sample'),'12345');fs.symlinkSync('/tmp',path.join(DISK,'escape'));assert.throws(()=>diskFile('../escape'));assert.throws(()=>diskFile('escape/file'));const scanned=await scanDisk(DISK);assert.equal(scanned.rows.find(r=>r.name==='test').bytes,5);assert.ok(!scanned.rows.some(r=>r.name==='escape'));assert.equal(await scanDisk(DISK,{cancelled:()=>true}),null);assert.equal((await scanDisk(DISK,{limit:1})).truncated,true);
console.log('PASS: disk scan measures real bytes, skips symlinks, supports cancellation and bounded scans');

let mono=1000,wall=10000,notifications=[];const context=vm.createContext({module:{exports:{}},performance:{now:()=>mono},Date:class extends Date{static now(){return wall;}}});vm.runInContext(fs.readFileSync(new URL('../src/apps/clock-app.cjs',import.meta.url),'utf8'),context);const clock=context.module.exports.create({...os,toast:m=>notifications.push(m)},{},{tab:'timer',timerInput:'0.05'});
clock.key({key:'enter'});clock.key({key:' '});mono+=1000;assert.equal(clock.save().timerLeft,2000);wall+=3600000;assert.equal(clock.save().timerLeft,2000);clock.key({key:' '});mono+=5000;assert.equal(clock.save().timerLeft,2000);clock.key({key:' '});clock.key({key:'tab'});mono+=2000;clock.tick();assert.equal(notifications.length,1);assert.equal(clock.save().timerDone,true);clock.tick();assert.equal(notifications.length,1);
const restored=context.module.exports.create(os,{},{tab:'timer',timerLeft:5000,timerRunning:true,savedAt:wall-1000});assert.equal(restored.save().timerLeft,4000);
console.log('PASS: countdown set/start/pause, monotonic time, finish on another tab, one notification and restart restore');
fs.rmSync(home,{recursive:true,force:true});
