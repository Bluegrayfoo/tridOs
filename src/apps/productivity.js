import { Hits, button, TextArea, LineInput } from '../ui.js';
import { fit, clamp } from '../util.js';
import { readAppData, writeAppData } from './app-data.js';

export const notes = {
  id:'notes', name:'Notes & Checklists', desc:'Keep notes and checklists, with search and saved drafts.', icon:'notes', size:[72,26], minSize:[48,16],
  create(os,win,saved) {
    const s=saved??readAppData('notes')??{}, hits=new Hits();
    let items=Array.isArray(s.items)?s.items.filter(n=>n&&typeof n.title==='string'&&typeof n.text==='string').slice(0,200).map(n=>({title:n.title.slice(0,100),text:n.text.slice(0,100000)})):[];
    if(!items.length)items=[{title:'My first note',text:'Write here.\n\n[ ] A task to complete\n[x] A completed task'}];
    let selected=clamp(Number.isInteger(s.selected)?s.selected:0,0,items.length-1), searchMode=false;
    const query=new LineInput(''), area=new TextArea(items[selected].text);
    const sync=()=>items[selected].text=area.getText();
    const choose=i=>{sync();selected=i;area.setText(items[i].text);};
    const add=()=>os.ask('New note','Title:','Untitled',value=>{if(value===null||!value?.trim())return;if(items.length>=200)return os.toast('Up to 200 notes are supported.');sync();items.push({title:value.trim().slice(0,100),text:''});selected=items.length-1;area.setText('');query.set('');});
    const rename=()=>{const item=items[selected];os.ask('Rename note','Title:',item.title,value=>{if(value?.trim())item.title=value.trim().slice(0,100);});};
    const toggle=()=>{const line=area.lines[area.cy];area.remember('check');area.lines[area.cy]=/^\s*\[ \]/.test(line)?line.replace('[ ]','[x]'):/^\s*\[x\]/i.test(line)?line.replace(/\[x\]/i,'[ ]'):'[ ] '+line;area.changed();};
    let left=20, lastWrite='', lastFlush=0;
    const persist=()=>{sync();const data={items,selected},json=JSON.stringify(data);if(json!==lastWrite){writeAppData('notes',data);lastWrite=json;}return data;};
    return {
      draw(v,focused){const th=os.th;v.fill(th.bg);hits.reset();left=Math.min(24,Math.floor(v.w/3));
        button(v,hits,1,0,'New',th,add);button(v,hits,8,0,'Rename',th,rename);button(v,hits,18,0,'Check',th,toggle);
        button(v,hits,27,0,'Delete',th,()=>{const item=items[selected];os.ask('Delete note','Type DELETE to remove '+item.title,'',value=>{if(value!=='DELETE')return;const i=items.indexOf(item);if(i<0)return;sync();items.splice(i,1);if(!items.length)items.push({title:'Untitled',text:''});selected=Math.min(selected,items.length-1);area.setText(items[selected].text);});});
        query.draw(v,1,2,left-2,th,{focus:focused&&searchMode});hits.add(1,2,left-2,1,()=>searchMode=true);
        sync();const found=items.map((n,i)=>({n,i})).filter(({n})=>(n.title+' '+n.text).toLowerCase().includes(query.text.toLowerCase()));
        let start=Math.max(0,found.findIndex(({i})=>i===selected)-(v.h-7));
        found.slice(start,start+v.h-5).forEach(({n,i},j)=>{if(i===selected)v.rect(0,4+j,left,1,th.sel);v.text(1,4+j,fit(n.title,left-2),th.text);hits.add(0,4+j,left,1,()=>{choose(i);searchMode=false;});});
        area.draw(v.sub(left+1,2,v.w-left-1,v.h-3),th,{focus:focused&&!searchMode,gutter:false});
        v.text(1,v.h-1,fit('Ctrl+N new  Ctrl+F search  Ctrl+T check  Tab focus',v.w-2),th.dim);
      },
      key(e){if(e.ctrl&&e.key==='n'){add();return true;}if(e.ctrl&&e.key==='f'){searchMode=true;return true;}if(e.ctrl&&e.key==='t'){toggle();return true;}if(e.key==='tab'){searchMode=!searchMode;return true;}return searchMode?query.key(e):area.key(e);},
      mouse(e){if(e.kind==='wheel')area.wheel(e.dir);else if(e.kind==='down'&&e.button===0){if(!hits.click(e.x,e.y)&&e.x>left&&e.y>=2){searchMode=false;area.click(e.x-left-1,e.y-2);}}},
      tick(){if(Date.now()-lastFlush<2000)return false;lastFlush=Date.now();try{persist();}catch(e){os.toast('Notes could not save: '+e.message);}return false;},
      close(){try{persist();}catch(e){os.toast('Notes could not save: '+e.message);}},
      save(){return persist();},
    };
  },
};

export function parseColor(value){
  const s=String(value).trim();let m=/^#?([\da-f]{6})$/i.exec(s);if(m)return parseInt(m[1],16);
  m=/^#?([\da-f]{3})$/i.exec(s);if(m)return parseInt([...m[1]].map(c=>c+c).join(''),16);
  m=/^(?:rgb\()?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/i.exec(s);
  if(m&&m.slice(1).every(n=>Number(n)<=255))return (Number(m[1])<<16)|(Number(m[2])<<8)|Number(m[3]);
  throw Error('Use #RRGGBB, #RGB or R,G,B (0–255).');
}
export const colorPicker={
  id:'color-picker',name:'Color Picker',desc:'Preview HEX and RGB colors, compare contrast, and keep a palette.',icon:'palette',size:[54,23],minSize:[42,18],
  create(os,win,saved){const s=saved??readAppData('palette')??{},input=new LineInput(typeof s.input==='string'?s.input:'#419bff'),hits=new Hits();let palette=Array.isArray(s.palette)?s.palette.filter(n=>Number.isInteger(n)&&n>=0&&n<=0xffffff).slice(-12):[];
    const hex=c=>'#'+c.toString(16).padStart(6,'0').toUpperCase();
    const keep=()=>{try{const c=parseColor(input.text);palette=[...palette.filter(n=>n!==c),c].slice(-12);}catch(e){os.toast(e.message);}};
    return {draw(v,focused){const th=os.th;v.fill(th.bg);hits.reset();input.draw(v,2,1,v.w-15,th,{focus:focused});button(v,hits,v.w-11,1,'Keep',th,keep);
      try{const c=parseColor(input.text),r=c>>16,g=c>>8&255,b=c&255;v.rect(2,4,v.w-4,6,c);v.text(3,5,'White text',0xffffff);v.text(3,7,'Black text',0);v.text(2,11,hex(c)+'   RGB '+[r,g,b].join(', '),th.text);
        const lum=[r,g,b].map(n=>{const a=n/255;return a<=.04045?a/12.92:((a+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
        v.text(2,13,'Contrast: white '+(1.05/(lum+.05)).toFixed(2)+':1  black '+((lum+.05)/.05).toFixed(2)+':1',th.dim);
      }catch(e){v.text(2,5,fit(e.message,v.w-4),th.danger);}
      const cw=Math.max(3,Math.floor((v.w-4)/12));palette.forEach((c,i)=>{v.rect(2+i*cw,15,cw-1,2,c);hits.add(2+i*cw,15,cw-1,2,()=>input.set(hex(c)));});v.text(2,v.h-1,fit('Enter keeps color • Click a swatch to reuse',v.w-4),th.dim);},
      key(e){if(e.key==='enter'){keep();return true;}const used=input.key(e);if(input.text.length>64)input.set(input.text.slice(0,64));return used;},mouse(e){if(e.kind==='down'&&e.button===0)hits.click(e.x,e.y);},close(){try{writeAppData('palette',{input:input.text,palette});}catch(e){os.toast('Palette could not save: '+e.message);}},save(){const data={input:input.text,palette};writeAppData('palette',data);return data;}};
  },
};
