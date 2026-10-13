import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'cloud-public');
const allowed=new Set(['.html','.css','.js','.json','.ttf','.woff','.woff2','.png','.jpg','.jpeg','.webp','.svg','.mp3','.wav','.mp4','.txt']);
let count=0,bytes=0;
async function copy(directory){
 for(const entry of await fs.readdir(path.join(root,directory),{withFileTypes:true})){
  const relative=path.join(directory,entry.name),source=path.join(root,relative);
  if(entry.isSymbolicLink())throw Error('Public asset symlinks are not allowed: '+relative);
  if(entry.isDirectory()){await copy(relative);continue;}
  if(!allowed.has(path.extname(entry.name).toLowerCase()))continue;
  const stat=await fs.stat(source);if(stat.size>25*1024*1024)throw Error('Asset exceeds Cloudflare 25 MiB limit: '+relative);
  await fs.mkdir(path.dirname(path.join(output,relative)),{recursive:true});
  await fs.copyFile(source,path.join(output,relative));count++;bytes+=stat.size;
 }
}
await copy('game');await copy('launcher');
// Git checkout may normalize text line endings on Linux. The web manifest
// describes the deployed bytes; the Windows repair/patch manifest stays intact.
const manifestPath=path.join(output,'game','manifest.json');
const original=await fs.readFile(manifestPath),manifest=JSON.parse(original);
for(const entry of manifest.files){
 if(!/^game\//.test(entry.path)||entry.path.includes('..')||entry.path.includes('\\'))throw Error('Unsafe game manifest path');
 const data=await fs.readFile(path.join(output,entry.path));
 entry.sha256=createHash('sha256').update(data).digest('hex');entry.size=data.byteLength;
}
const deployed=JSON.stringify(manifest);await fs.writeFile(manifestPath,deployed);bytes+=Buffer.byteLength(deployed)-original.byteLength;
console.log(JSON.stringify({files:count,bytes,output}));
