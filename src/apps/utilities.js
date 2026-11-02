import { Hits, button, LineInput } from '../ui.js';
import { fit, clamp } from '../util.js';

// Arithmetic parser: never evaluates JavaScript or looks up arbitrary names.
export function calculate(expression) {
  const s=String(expression).trim();
  if(!s || s.length>256) throw Error('Enter an expression (up to 256 characters).');
  let at=0,depth=0;
  const space=()=>{while(at<s.length&&/\s/.test(s[at]))at++;};
  const take=c=>{space();return s[at]===c?(at++,true):false;};
  const primary=()=>{
    if(++depth>64) throw Error('Too many nested parentheses.');
    space();
    let n;
    if(take('(')){n=sum();if(!take(')'))throw Error('Missing closing parenthesis.');}
    else { const m=/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(s.slice(at));if(!m)throw Error('Expected a number.');at+=m[0].length;n=Number(m[0]); }
    while(take('%')) n/=100;
    depth--;return n;
  };
  const power=()=>{let n=primary();if(take('^'))n=n**unary();return n;};
  const unary=()=>{if(take('+'))return unary();if(take('-'))return -unary();return power();};
  const product=()=>{let n=unary();for(;;){if(take('*'))n*=unary();else if(take('/')){const d=unary();if(d===0)throw Error('Cannot divide by zero.');n/=d;}else return n;}};
  const sum=()=>{let n=product();for(;;){if(take('+'))n+=product();else if(take('-'))n-=product();else return n;}};
  const result=sum();
  if(at!==s.length)throw Error('Use numbers, + - * / ^ % and parentheses.');
  if(!Number.isFinite(result))throw Error('Result is outside the supported range.');
  return Object.is(result,-0)?0:result;
}
const number=n=>Number(n.toPrecision(12)).toString();

export const calculator={
  id:'calculator',name:'Calculator',desc:'Arithmetic, parentheses, powers, percentages and calculation history.',icon:'calculator',size:[44,25],minSize:[34,21],
  create(os,win,saved={}) {
    saved = saved ?? {};
    const input=new LineInput(String(saved.input||'').slice(0,256)),hits=new Hits();
    let result=String(saved.result||'0'),error=false;
    const history=Array.isArray(saved.history)?saved.history.filter(h=>typeof h?.expression==='string'&&typeof h?.result==='string').slice(-30):[];
    const run=()=>{try{result=number(calculate(input.text));error=false;history.push({expression:input.text,result});if(history.length>30)history.shift();}catch(e){result=e.message;error=true;}};
    const key=label=>{if(label==='=')run();else if(label==='C'){input.set('');result='0';error=false;}else if(input.text.length<256) input.key({key:label,text:label});};
    return {
      draw(v,focused){const th=os.th;v.fill(th.bg);hits.reset();v.text(2,0,'Calculator',th.text);input.draw(v,2,2,v.w-4,th,{focus:focused});v.text(2,4,fit(result,v.w-4),error?th.danger:th.accent);
        const keys=['(',')','%','C','7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'];
        const width=Math.floor((v.w-4)/4);
        keys.forEach((label,i)=>button(v,hits,2+i%4*width,7+Math.floor(i/4)*2,label,th,()=>key(label),{width:width-1,primary:label==='='}));
        let y=18;history.slice(-Math.max(0,v.h-20)).reverse().forEach(h=>{if(y>=v.h-2)return;v.text(2,y,fit(h.expression+' = '+h.result,v.w-4),th.dim);hits.add(2,y++,v.w-4,1,()=>input.set(h.result));});
        v.text(1,v.h-1,fit('Enter = result   Ctrl+U = clear   % = /100',v.w-2),th.dim);
      },
      key(e){if(e.key==='enter'||e.key==='='){run();return true;}if(e.ctrl&&e.key==='u'){key('C');return true;}if(input.key(e)){if(input.text.length>256)input.set(input.text.slice(0,256));return true;}return false;},
      mouse(e){if(e.kind==='down'&&e.button===0)hits.click(e.x,e.y);},
      save(){return {input:input.text,result,history};},
    };
  },
};

export const UNIT_GROUPS=[
  {name:'Length',units:[['Metres',1],['Kilometres',1000],['Centimetres',.01],['Millimetres',.001],['Inches',.0254],['Feet',.3048],['Yards',.9144],['Miles',1609.344]]},
  {name:'Mass',units:[['Kilograms',1],['Grams',.001],['Milligrams',.000001],['Pounds',.45359237],['Ounces',.028349523125]]},
  {name:'Temperature',units:[['Celsius',1],['Fahrenheit',1],['Kelvin',1]]},
  {name:'Volume',units:[['Litres',1],['Millilitres',.001],['US gallons',3.785411784],['US cups',.2365882365],['US fluid oz',.0295735295625]]},
  {name:'Speed',units:[['Metres/second',1],['Km/hour',1/3.6],['Miles/hour',.44704],['Knots',.5144444444444445]]},
  {name:'Time',units:[['Seconds',1],['Minutes',60],['Hours',3600],['Days',86400],['Weeks',604800]]},
];
export function convert(value,category,from,to){
  const group=UNIT_GROUPS[category];
  if(!Number.isFinite(value)||!group?.units[from]||!group.units[to])throw Error('Enter a finite number and valid units.');
  let answer;
  if(category===2){const c=from===0?value:from===1?(value-32)*5/9:value-273.15;if(c < -273.150000001)throw Error('Temperature is below absolute zero.');answer=to===0?c:to===1?c*9/5+32:c+273.15;}
  else answer=value*group.units[from][1]/group.units[to][1];
  if(!Number.isFinite(answer))throw Error('Result is outside the supported range.');
  return answer;
}
export const converter={
  id:'unit-converter',name:'Unit Converter',desc:'Convert length, mass, temperature, volume, speed and time offline.',icon:'converter',size:[54,23],minSize:[48,22],
  create(os,win,saved={}){
    saved = saved ?? {};
    const index=(n,max,fallback)=>Number.isInteger(n)&&n>=0&&n<max?n:fallback;
    let category=index(saved.category,UNIT_GROUPS.length,0),from=index(saved.from,UNIT_GROUPS[category].units.length,0),to=index(saved.to,UNIT_GROUPS[category].units.length,1);
    const input=new LineInput(String(saved.input??'1').slice(0,64)),hits=new Hits();
    const setCategory=n=>{category=n;from=0;to=1;};
    const cycle=(source,dir=1)=>{const n=UNIT_GROUPS[category].units.length;if(source)from=(from+dir+n)%n;else to=(to+dir+n)%n;};
    const swap=()=>{try{if(input.text.trim())input.set(number(convert(Number(input.text),category,from,to)));}catch{}[from,to]=[to,from];};
    return {
      draw(v,focused){const th=os.th;v.fill(th.bg);hits.reset();
        const cw=Math.floor((v.w-2)/3);UNIT_GROUPS.forEach((g,i)=>button(v,hits,1+i%3*cw,1+Math.floor(i/3)*2,g.name,th,()=>setCategory(i),{width:cw-1,active:i===category}));
        v.text(2,6,'Value',th.dim);input.draw(v,9,6,v.w-11,th,{focus:focused});
        const group=UNIT_GROUPS[category];
        v.text(2,9,'From',th.dim);button(v,hits,9,9,'<',th,()=>cycle(true,-1));v.text(15,9,group.units[from][0],th.text);button(v,hits,v.w-6,9,'>',th,()=>cycle(true));
        v.text(2,12,'To',th.dim);button(v,hits,9,12,'<',th,()=>cycle(false,-1));v.text(15,12,group.units[to][0],th.text);button(v,hits,v.w-6,12,'>',th,()=>cycle(false));
        button(v,hits,2,15,'Swap',th,swap);
        let message='Enter a value',bad=false;try{if(input.text.trim())message=number(convert(Number(input.text),category,from,to))+' '+group.units[to][0];}catch(e){message=e.message;bad=true;}
        v.text(2,18,fit(message,v.w-4),bad?th.danger:th.accent);v.text(1,v.h-1,fit('Tab category   F from   T to   S swap',v.w-2),th.dim);
      },
      key(e){if(e.key==='tab'){setCategory((category+(e.shift?5:1))%6);return true;}if(!e.ctrl&&!e.alt&&['f','t','s'].includes(e.key.toLowerCase())){const k=e.key.toLowerCase();if(k==='s')swap();else cycle(k==='f');return true;}if(input.key(e)){if(input.text.length>64)input.set(input.text.slice(0,64));return true;}return false;},
      mouse(e){if(e.kind==='down'&&e.button===0)hits.click(e.x,e.y);},
      save(){return {input:input.text,category,from,to};},
    };
  },
};

export function monthDays(year,month){return new Date(year,month+1,0).getDate();}
export function monthGrid(year,month){const first=new Date(year,month,1).getDay(),days=monthDays(year,month);return Array.from({length:42},(_,i)=>i>=first&&i<first+days?i-first+1:0);}
export const calendar={
  id:'calendar',name:'Calendar',desc:'Browse months, jump to today and keep a note for any date.',icon:'calendar',size:[54,25],minSize:[44,22],
  create(os,win,saved={}){
    saved = saved ?? {};
    const now=new Date();let year=Number.isInteger(saved.year)&&saved.year>=100&&saved.year<=9999?saved.year:now.getFullYear(),month=Number.isInteger(saved.month)&&saved.month>=0&&saved.month<12?saved.month:now.getMonth();
    let selected=Number.isInteger(saved.selected)?clamp(saved.selected,1,monthDays(year,month)):year===now.getFullYear()&&month===now.getMonth()?now.getDate():1;
    const notes={};if(saved.notes&&typeof saved.notes==='object')for(const [k,v]of Object.entries(saved.notes).slice(-1000))if(/^\d{4}-\d{2}-\d{2}$/.test(k)&&typeof v==='string')notes[k]=v.slice(0,500);
    const hits=new Hits(),id=()=>`${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}-${String(selected).padStart(2,'0')}`;
    const move=delta=>{const d=new Date(year,month+delta,1);if(d.getFullYear()<100||d.getFullYear()>9999)return;year=d.getFullYear();month=d.getMonth();selected=Math.min(selected,monthDays(year,month));};
    const today=()=>{const d=new Date();year=d.getFullYear();month=d.getMonth();selected=d.getDate();};
    const edit=()=>{const key=id();os.ask('Note for '+key,'Write a note for this date.',notes[key]||'',value=>{if(value==null)return;if(value.trim())notes[key]=value.slice(0,500);else delete notes[key];});};
    return {
      draw(v){const th=os.th;v.fill(th.bg);hits.reset();const d=new Date();
        button(v,hits,1,0,'<',th,()=>move(-1));v.text(7,0,new Date(year,month,1).toLocaleDateString(undefined,{month:'long',year:'numeric'}),th.text);button(v,hits,v.w-6,0,'>',th,()=>move(1));
        const cell=Math.floor((v.w-2)/7),start=Math.floor((v.w-cell*7)/2);
        ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((n,i)=>v.text(start+i*cell,3,n,th.dim));
        monthGrid(year,month).forEach((day,i)=>{if(!day)return;const x=start+i%7*cell,y=5+Math.floor(i/7)*2,key=`${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const isToday=year===d.getFullYear()&&month===d.getMonth()&&day===d.getDate();if(day===selected)v.rect(x,y,cell-1,1,th.sel);v.text(x,y,String(day).padStart(2,' ')+(notes[key]?' *':''),isToday?th.accent:th.text);hits.add(x,y,cell-1,1,()=>selected=day);
        });
        button(v,hits,1,18,'Today',th,today);button(v,hits,11,18,'Edit note',th,edit);v.text(1,20,fit(id()+'  '+(notes[id()]||'No note for this date.'),v.w-2),th.dim);if(v.h>22)v.text(1,v.h-1,fit('Arrows select  PgUp/PgDn month  Enter note',v.w-2),th.dim);
      },
      key(e){if(e.key==='pageup'){move(-1);return true;}if(e.key==='pagedown'){move(1);return true;}if(e.key==='t'){today();return true;}if(e.key==='enter'){edit();return true;}const steps={left:-1,right:1,up:-7,down:7};if(steps[e.key]){const d=new Date(year,month,selected+steps[e.key]);if(d.getFullYear()>=100&&d.getFullYear()<=9999){year=d.getFullYear();month=d.getMonth();selected=d.getDate();}return true;}return false;},
      mouse(e){if(e.kind==='down'&&e.button===0)hits.click(e.x,e.y);},
      tick(){const day=new Date().toDateString();if(this.lastDay===day)return false;this.lastDay=day;return true;},
      save(){return {year,month,selected,notes};},
    };
  },
};
