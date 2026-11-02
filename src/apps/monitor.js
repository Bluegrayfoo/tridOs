import system from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DISK, niceSize } from '../fs.js';
import { Hits, button } from '../ui.js';
import { fit } from '../util.js';

const safe=(fn,fallback)=>{try{return fn();}catch{return fallback;}};
export function cpuTotals(){return safe(()=>system.cpus(),[]).reduce((s,c)=>({idle:s.idle+c.times.idle,total:s.total+Object.values(c.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});}
export const monitor={
 id:'system-monitor',name:'System Monitor',desc:'Live host CPU, memory, uptime and TridOS process usage.',icon:'monitor',size:[60,24],minSize:[42,18],
 create(os){let prev=cpuTotals(),last=0,cpu=0,history=[];
  return {tick(){const now=Date.now();if(now-last<1000)return false;last=now;const next=cpuTotals(),delta=next.total-prev.total;cpu=delta>0?Math.max(0,Math.min(100,100*(1-(next.idle-prev.idle)/delta))):0;prev=next;history.push(cpu);history=history.slice(-100);return true;},
   draw(v){const th=os.th;v.fill(th.bg);const total=safe(()=>system.totalmem(),0),free=safe(()=>system.freemem(),0),mem=process.memoryUsage(),uptime=safe(()=>system.uptime(),null);
    const lines=[safe(()=>system.hostname(),'Host')+' • '+system.platform()+' '+system.arch(),'Host CPU: '+cpu.toFixed(1)+'%  ('+safe(()=>system.cpus().length,0)+' logical cores)','Host memory used: '+niceSize(total-free)+' / '+niceSize(total),'TridOS process RSS: '+niceSize(mem.rss),'TridOS JS heap: '+niceSize(mem.heapUsed)+' / '+niceSize(mem.heapTotal),'Host uptime: '+(uptime===null?'Unavailable':Math.floor(uptime/3600)+'h '+Math.floor(uptime/60)%60+'m')];
    lines.forEach((s,i)=>v.text(2,1+i*2,fit(s,v.w-4),i===0?th.accent:th.text));
    const h=Math.max(1,v.h-15),n=Math.min(history.length,v.w-4);history.slice(-n).forEach((value,i)=>{const bar=Math.round(h*value/100);v.rect(2+i,13+h-bar,1,bar,th.accent);});v.text(2,v.h-1,fit('CPU samples every second • Memory includes caches',v.w-4),th.dim);
   },save(){return {};}};
 },
};

// Iterative, async traversal; never follow symbolic links or cross the TridOS disk.
export async function scanDisk(root=DISK,{cancelled=()=>false,limit=100000}={}){
 const result=[],queue=[];let visited=0,unreadable=0,truncated=false;
 const entries=await fs.readdir(root,{withFileTypes:true});
 for(const e of entries){if(e.isSymbolicLink())continue;const row={name:e.name,bytes:0,files:0};result.push(row);queue.push({file:path.join(root,e.name),row});}
 while(queue.length){if(cancelled())return null;if(++visited>limit){truncated=true;break;}const {file,row}=queue.pop();
  try{const st=await fs.lstat(file);if(st.isSymbolicLink())continue;if(st.isDirectory()){for(const e of await fs.readdir(file,{withFileTypes:true}))if(!e.isSymbolicLink())queue.push({file:path.join(file,e.name),row});}else if(st.isFile()){row.bytes+=st.size;row.files++;}}catch{unreadable++;}
 }
 return {rows:result.sort((a,b)=>b.bytes-a.bytes),unreadable,truncated};
}
export const diskUsage={
 id:'disk-usage',name:'Disk Usage',desc:'Find large folders and files on the TridOS disk; read-only, no deletions.',icon:'disk',size:[62,25],minSize:[42,16],
 create(os){let data=null,message='Choose Scan to measure the TridOS disk.',busy=false,closed=false,scroll=0;const hits=new Hits();
  const scan=async()=>{if(busy)return;busy=true;message='Scanning…';os.dirty=true;try{data=await scanDisk(DISK,{cancelled:()=>closed});if(!closed)message=data?'Total '+niceSize(data.rows.reduce((n,r)=>n+r.bytes,0))+(data.truncated?' • Partial: scan limit reached':'')+(data.unreadable?' • '+data.unreadable+' unreadable':''):'Scan cancelled';}catch(e){message='Could not scan: '+e.message;}finally{busy=false;if(!closed)os.dirty=true;}};
  return {draw(v){const th=os.th;v.fill(th.bg);hits.reset();button(v,hits,1,0,busy?'Scanning':'Scan',th,()=>void scan());v.text(13,0,'TridOS disk',th.text);v.text(1,2,fit(message,v.w-2),th.dim);scroll=Math.max(0,Math.min(scroll,(data?.rows.length??0)-(v.h-6)));const max=Math.max(1,...(data?.rows??[]).map(r=>r.bytes));
    (data?.rows??[]).slice(scroll,scroll+v.h-6).forEach((r,i)=>{const y=4+i;v.rect(1,y,Math.round((v.w-2)*r.bytes/max),1,th.sel);v.text(2,y,fit(r.name,v.w-23),th.text);v.text(v.w-20,y,fit(niceSize(r.bytes)+' / '+r.files,v.w-21),th.text);});v.text(1,v.h-1,fit('R rescan • Size in bytes / file count • Symlinks skipped',v.w-2),th.dim);},
    key(e){if(e.key==='r'){void scan();return true;}if(e.key==='down'){scroll++;return true;}if(e.key==='up'){scroll=Math.max(0,scroll-1);return true;}return false;},mouse(e){if(e.kind==='down'&&e.button===0)hits.click(e.x,e.y);if(e.kind==='wheel')scroll=Math.max(0,scroll+e.dir*3);},close(){closed=true;},save(){return {};}};
 },
};
