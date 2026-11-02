import fs from 'node:fs';
import path from 'node:path';
import { Hits, button, LineInput } from '../ui.js';
import { fit, clamp } from '../util.js';
import { calculate } from './utilities.js';
import { diskFile, readAppData, writeAppData } from './app-data.js';

export const ROWS=500,COLS=26;
export const cellName=(r,c)=>String.fromCharCode(65+c)+(r+1);
const valid=id=>/^[A-Z](?:[1-9]\d{0,2})$/.test(id)&&Number(id.slice(1))<=ROWS;
export function cleanCells(data){const out=Object.create(null);if(data&&typeof data==='object')for(const [id,value]of Object.entries(data))if(valid(id)&&typeof value==='string'&&value)out[id]=value.slice(0,1000);return out;}
// A bounded expression language. No JavaScript evaluation, network functions or macros.
export function evaluateSheet(cells){
 const cache=new Map(),active=new Set();let budget=100000;
 const value=id=>{
  if(!valid(id))throw Error('#REF!');if(cache.has(id)){const cached=cache.get(id);if(cached instanceof Error)throw cached;return cached;}
  if(active.has(id))throw Error('#CYCLE!');if(active.size>=100)throw Error('#DEPTH!');if(--budget<0)throw Error('#LIMIT!');
  const raw=cells[id]??'';if(!raw.startsWith('=')){const result=raw.trim()!==''&&Number.isFinite(Number(raw))?Number(raw):raw;cache.set(id,result);return result;}
  active.add(id);
  const numeric=ref=>{const n=value(ref);if(n==='')return 0;if(typeof n!=='number')throw Error('#VALUE!');return n;};
  try{
   let expression=raw.slice(1).toUpperCase();
   expression=expression.replace(/\b(SUM|AVERAGE|MIN|MAX)\(([^()]*)\)/g,(_,fn,args)=>{
    const nums=[];for(const arg of args.split(',')){const t=arg.trim(),range=/^([A-Z]\d+):([A-Z]\d+)$/.exec(t);
     if(range){if(!valid(range[1])||!valid(range[2]))throw Error('#REF!');const c1=range[1].charCodeAt(0)-65,c2=range[2].charCodeAt(0)-65,r1=Number(range[1].slice(1))-1,r2=Number(range[2].slice(1))-1;
      for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++)for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++){if(--budget<0)throw Error('#LIMIT!');const n=value(cellName(r,c));if(typeof n==='number')nums.push(n);}
     }else if(valid(t)){const n=value(t);if(typeof n==='number')nums.push(n);}else if(t&&Number.isFinite(Number(t)))nums.push(Number(t));else throw Error('#FORMULA!');
    }
    if(!nums.length){if(fn==='SUM')return '(0)';throw Error('#VALUE!');}
    const n=fn==='SUM'||fn==='AVERAGE'?nums.reduce((a,b)=>a+b,0)/(fn==='AVERAGE'?nums.length:1):fn==='MIN'?Math.min(...nums):Math.max(...nums);
    if(!Number.isFinite(n))throw Error('#NUM!');return '('+n+')';
   });
   expression=expression.replace(/\b[A-Z]+\d+\b/g,ref=>'('+numeric(ref)+')');
   const answer=calculate(expression);cache.set(id,answer);return answer;
  }catch(e){const error=new Error(e.message.startsWith('#')?e.message:'#FORMULA!');cache.set(id,error);throw error;}finally{active.delete(id);}
 };
 return id=>{try{return value(id);}catch(e){return e.message;}};
}

export function parseCSV(text){
 if(text.length>5_000_000)throw Error('CSV is too large (5 MB maximum).');
 const rows=[];let row=[],field='',quoted=false,closed=false;
 const push=()=>{if(field.length>1000)throw Error('Cell exceeds 1,000 characters.');row.push(field);field='';closed=false;if(row.length>COLS)throw Error('Up to 26 columns are supported.');};
 const end=()=>{push();rows.push(row);row=[];if(rows.length>ROWS)throw Error('Up to 500 rows are supported.');};
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
  else if(c===',')push();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;end();}else if(c==='"'&&!field&&!closed)quoted=true;else {if(closed||c==='"')throw Error('Malformed CSV quoting.');field+=c;}}
 if(quoted)throw Error('Unclosed CSV quote.');if(field||row.length||closed)end();
 const cells=Object.create(null);rows.forEach((row,r)=>row.forEach((text,c)=>{if(text)cells[cellName(r,c)]=text;}));return cells;
}
export function exportCSV(cells){
 const ids=Object.keys(cells).filter(valid);if(!ids.length)return '';const height=Math.max(...ids.map(id=>Number(id.slice(1)))),width=Math.max(...ids.map(id=>id.charCodeAt(0)-64));
 const get=evaluateSheet(cells);
 // Export displayed values; protect text from being executed as formulas by other spreadsheets.
 return Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>{let value=get(cellName(r,c));if(typeof value==='string'&&/^[\s]*[=+\-@]/.test(value))value="'"+value;return '"'+String(value).replace(/"/g,'""')+'"';}).join(',')).join('\r\n')+'\r\n';
}

export default {
 id:'spreadsheets',name:'Spreadsheets',desc:'Editable grid, formulas, cell references, SUM/AVERAGE/MIN/MAX and CSV import/export.',icon:'sheets',size:[84,28],minSize:[50,17],
 create(os,win,saved){
  const s=saved??readAppData('spreadsheet')??{},hits=new Hits(),input=new LineInput('');let cells=cleanCells(s.cells),row=clamp(s.row|0,0,ROWS-1),col=clamp(s.col|0,0,COLS-1),top=0,left=0,editing=false,replace=false,message='A–Z / 500 rows • Changes saved automatically',history=[],future=[],lastWrite='',lastFlush=0;
  let get=evaluateSheet(cells);const id=()=>cellName(row,col),refresh=()=>get=evaluateSheet(cells);
  const remember=()=>{history.push({...cells});if(history.length>30)history.shift();future=[];};
  const commit=()=>{if(!editing)return;if(input.text.length>1000){message='Cell exceeds 1,000 characters.';return false;}remember();if(input.text)cells[id()]=input.text;else delete cells[id()];editing=false;refresh();return true;};
  const begin=()=>{input.set(cells[id()]??'');editing=true;replace=true;};
  const move=(r,c)=>{if(commit()===false)return;row=clamp(r,0,ROWS-1);col=clamp(c,0,COLS-1);};
  const persist=()=>{const data={cells:{...cells},row,col};if(editing){if(input.text)data.cells[id()]=input.text.slice(0,1000);else delete data.cells[id()];}const json=JSON.stringify(data);if(json!==lastWrite){writeAppData('spreadsheet',data);lastWrite=json;}return data;};
  const fileAction=kind=>{if(commit()===false)return;os.ask(kind==='import'?'Import CSV':kind==='open'?'Open workbook':'Save '+(kind==='csv'?'CSV values':'workbook'),'Path on the TridOS disk:',kind==='csv'||kind==='import'?'~/Documents/sheet.csv':'~/Documents/sheet.tridsheet',answer=>{if(!answer?.trim())return;try{const file=diskFile(answer);
    if(kind==='import'||kind==='open'){if(fs.statSync(file).size>5_000_000)throw Error('File exceeds 5 MB.');const text=fs.readFileSync(file,'utf8');let next;if(kind==='import')next=parseCSV(text);else{const data=JSON.parse(text);if(data?.format!=='tridos-sheet-1')throw Error('Not a TridOS workbook.');next=cleanCells(data.cells);}remember();cells=next;row=col=top=left=0;refresh();message='Opened '+path.basename(file)+' • Ctrl+Z to undo';}
    else {const data=kind==='csv'?exportCSV(cells):JSON.stringify({format:'tridos-sheet-1',cells},null,2);const write=()=>{try{diskFile(answer);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);message='Saved '+path.basename(file);os.dirty=true;}catch(e){message=e.message;os.toast(e.message);}};if(fs.existsSync(file))os.ask('Replace file?','Type REPLACE to overwrite '+path.basename(file),'',value=>{if(value==='REPLACE')write();});else write();}
   }catch(e){message=e.message;os.toast(e.message);}});};
  return {
   draw(v,focused){const th=os.th;v.fill(th.bg);hits.reset();[['Open',()=>fileAction('open')],['Save',()=>fileAction('save')],['Import CSV',()=>fileAction('import')],['Export CSV',()=>fileAction('csv')]].reduce((x,[label,fn])=>x+button(v,hits,x,0,label,th,fn)+1,1);
    v.text(1,2,id(),th.accent);if(!editing)input.set(cells[id()]??'');input.draw(v,6,2,v.w-7,th,{focus:focused&&editing});hits.add(6,2,v.w-7,1,begin);
    const cw=12,cols=Math.max(1,Math.floor((v.w-5)/cw)),rows=Math.max(1,v.h-7);if(col<left)left=col;if(col>=left+cols)left=col-cols+1;if(row<top)top=row;if(row>=top+rows)top=row-rows+1;
    for(let c=left;c<Math.min(COLS,left+cols);c++){const x=5+(c-left)*cw;v.rect(x,4,cw-1,1,th.side);v.text(x+4,4,String.fromCharCode(65+c),th.dim);for(let r=top;r<Math.min(ROWS,top+rows);r++){const y=5+r-top,active=r===row&&c===col;v.rect(x,y,cw-1,1,active?th.sel:th.field);const value=get(cellName(r,c));v.text(x,y,fit(String(value).replace(/[\r\n]/g,' '),cw-1),String(value).startsWith('#')?th.danger:th.text);hits.add(x,y,cw-1,1,()=>{if(active)begin();else move(r,c);});}}
    for(let r=top;r<Math.min(ROWS,top+rows);r++)v.text(0,5+r-top,String(r+1).padStart(4),th.dim);
    v.text(1,v.h-2,fit(message,v.w-2),th.dim);v.text(1,v.h-1,fit('Enter edit/commit • Esc cancel • Ctrl+Z undo • Ctrl+S save',v.w-2),th.dim);
   },
   key(e){if(e.ctrl&&e.key==='s'){fileAction('save');return true;}if(e.ctrl&&e.key==='o'){fileAction('open');return true;}if(e.ctrl&&['z','y'].includes(e.key)){editing=false;const from=e.key==='z'?history:future,to=e.key==='z'?future:history;if(from.length){to.push({...cells});cells=cleanCells(from.pop());refresh();}return true;}
    if(editing){if(e.key==='escape'){editing=false;return true;}if(e.key==='enter'||e.key==='tab'){if(commit()!==false)move(row+(e.key==='enter'?1:0),col+(e.key==='tab'?(e.shift?-1:1):0));return true;}if(replace&&e.text&&!e.ctrl&&!e.alt)input.set('');replace=false;return input.key(e);}
    const delta={left:[0,-1],right:[0,1],up:[-1,0],down:[1,0],pageup:[-10,0],pagedown:[10,0],tab:[0,e.shift?-1:1]};if(delta[e.key]){move(row+delta[e.key][0],col+delta[e.key][1]);return true;}
    if(e.key==='enter'||e.key==='f2'){begin();return true;}if(e.key==='delete'||e.key==='backspace'){remember();delete cells[id()];refresh();return true;}if(e.text&&!e.ctrl&&!e.alt){begin();input.set(e.text);replace=false;return true;}return false;
   },
   mouse(e){if(e.kind==='down'&&e.button===0)hits.click(e.x,e.y);if(e.kind==='wheel')move(row+e.dir*3,col);},
   tick(){if(Date.now()-lastFlush<2000)return false;lastFlush=Date.now();try{persist();}catch(e){message='Autosave failed: '+e.message;}return false;},
   close(){try{persist();}catch(e){os.toast('Spreadsheet could not save: '+e.message);}},save(){return persist();},
  };
 },
};
