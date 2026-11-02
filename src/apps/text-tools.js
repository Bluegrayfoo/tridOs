export function textStats(text){return {characters:[...text].length,words:(text.match(/\S+/gu)||[]).length,lines:text.split('\n').length};}
export function transformText(text,action){
 switch(action){case 'upper':return text.toUpperCase();case 'lower':return text.toLowerCase();case 'trim':return text.split('\n').map(l=>l.trimEnd()).join('\n');case 'sort':return text.split('\n').sort((a,b)=>a.localeCompare(b)).join('\n');case 'unique':return [...new Set(text.split('\n'))].join('\n');default:return text;}
}
// A safe, text-only Markdown preview: no HTML, scripts or remote resources.
export function markdownLines(text,width){
 const rows=[];let code=false;
 const add=(s,kind)=>{const chars=[...s];if(!chars.length)rows.push({text:'',kind});for(let i=0;i<chars.length;i+=width)rows.push({text:chars.slice(i,i+width).join(''),kind});};
 for(const raw of text.split('\n')){if(/^\s*```/.test(raw)){code=!code;add(code?'[Code]':'[End code]','dim');continue;}if(code){add('  '+raw,'code');continue;}
  let kind='text',s=raw;if(/^#{1,6}\s/.test(s)){kind='heading';s=s.replace(/^#{1,6}\s+/,'');}else if(/^\s*>/.test(s)){kind='quote';s=s.replace(/^\s*>\s?/,'> ');}else if(/^\s*[-*+]\s/.test(s))s=s.replace(/^\s*[-*+]\s+/,'• ');
  if(/^\s*(---+|___+|\*\*\*+)\s*$/.test(s)){add('─'.repeat(width),'dim');continue;}
  s=s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'[Image: $1] ($2)').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'$1 ($2)').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\*([^*]+)\*/g,'$1');add(s,kind);
 }
 return rows;
}
