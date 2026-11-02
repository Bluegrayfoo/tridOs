import fs from 'node:fs';
import path from 'node:path';
import { HOME, DISK } from '../fs.js';

export function readAppData(id){try{return JSON.parse(fs.readFileSync(path.join(HOME,'app-data',id+'.json'),'utf8'));}catch{return null;}}
export function writeAppData(id,data){const dir=path.join(HOME,'app-data');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,id+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(file+'.tmp',file);}
// Reject traversal and symlinks, including parent directories, for file import/export.
export function diskFile(value){
 const file=path.resolve(DISK,String(value).trim().replace(/^~\/?/,''));
 if(file===DISK||!file.startsWith(DISK+path.sep))throw Error('Choose a file inside the TridOS disk.');
 let at=DISK;for(const part of path.relative(DISK,file).split(path.sep)){at=path.join(at,part);if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())throw Error('Symbolic links are not supported.');}
 return file;
}
