// Isolated Chromium integration probe: real UI and MP3 decoding, no AI or saves.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=await fs.mkdtemp(path.join(os.tmpdir(),'Luoxian-audio-film-'));
const chrome=process.env.LUOXIAN_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile=path.join(output,'profile'),errors=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const harness="import {createExperience} from '/game/beta4/experience.js';window.__experience=createExperience({aiClient:{loadSettings:()=>({mode:'local',models:{}}),status:async()=>({local:{runtimeInstalled:true,modelInstalled:true},cloud:{configured:{}}})},onReady:async()=>{},onAiSettings:()=>{},onTitle:()=>{}});";
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.mp3':'audio/mpeg','.mp4':'video/mp4','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/api/status'){res.setHeader('Content-Type','application/json');res.end('{"healthy":true}');return;}
  if(pathname==='/visual-harness.js'){res.setHeader('Content-Type','text/javascript');res.end(harness);return;}
  const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  let data=await fs.readFile(target);
  if(target===path.join(root,'game/v4/index.html'))data=Buffer.from(data.toString().replace('src="./v4.js"','src="/visual-harness.js"'));
  res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  if(range){const start=Number(range[1]),end=Math.min(data.length-1,range[2]?Number(range[2]):data.length-1);res.writeHead(206,{'Accept-Ranges':'bytes','Content-Range':'bytes '+start+'-'+end+'/'+data.length,'Content-Length':end-start+1});res.end(data.subarray(start,end+1));}
  else{res.setHeader('Content-Length',data.length);res.end(data);}
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=spawn(chrome,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--autoplay-policy=no-user-gesture-required','--mute-audio','--window-size=1600,900','about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,serial=0;const pending=new Map();
browser.on('error',error=>errors.push(String(error)));
async function send(method,params={}){
 const id=++serial;return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);
  pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});
  socket.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expression){
 const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.text+' '+(result.exceptionDetails.exception?.description||''));
 return result.result.value;
}
async function screenshot(name){
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 const filename=path.join(output,name+'.png');await fs.writeFile(filename,Buffer.from(shot.data,'base64'));console.log(filename);
}
try{
 let port;
 for(let i=0;i<80;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await wait(100);}}
 if(!port)throw Error('Isolated Chromium did not start: '+errors.join(', '));
 const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
 socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
 socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p?.reject(Error(message.error.message));else p?.resolve(message.result);}
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
 });
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/game/v4/'});
 await wait(4400);
 const first=await evaluate('window.__experience?.audio.getNowPlaying()');
 assert.equal(first?.id,'luoxian-wish');assert.equal(first.scene,'intro');
 assert.ok(await evaluate("!document.getElementById('cinematic').hidden && getComputedStyle(document.querySelector('.film-title')).opacity>.7"));
 await screenshot('logo-film');
 await wait(7000);
 assert.ok(await evaluate("document.getElementById('cinematic').hidden && document.getElementById('titleScreen').classList.contains('menu-ready')"));
  const cover=await evaluate('window.__experience.audio.getNowPlaying()');
  assert.equal(cover.id,'luoxian-wish');assert.equal(cover.scene,'title');assert.ok(cover.position>first.position);
  await wait(850);
  const video=await evaluate("(()=>{const v=document.getElementById('menuLoopVideo');return {readyState:v.readyState,error:v.error?.message||null,currentTime:v.currentTime,paused:v.paused,muted:v.muted};})()");
  assert.ok(video.readyState>=2);assert.equal(video.error,null);assert.equal(video.paused,false);assert.equal(video.muted,true);
  assert.ok(await evaluate("document.getElementById('titleScreen').classList.contains('video-ready')"));
  const poster=await evaluate("(()=>{const v=document.getElementById('menuLoopVideo'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png').split(',')[1];})()");
  await fs.writeFile(path.join(output,'original-cover-frame.png'),Buffer.from(poster,'base64'));
  console.log(JSON.stringify({coverVideo:video}));
  await screenshot('animated-cover');
 await evaluate('window.__experience.audio.nextTrack()');
 assert.equal((await evaluate('window.__experience.audio.getNowPlaying()')).id,'luoxian-battle');
 await evaluate('window.__experience.audio.nextTrack()');
 assert.equal((await evaluate('window.__experience.audio.getNowPlaying()')).id,'luoxian-music');
 await evaluate("window.__experience.enter(()=>{document.getElementById('titleScreen').hidden=true;document.getElementById('gameShell').hidden=false;})");
 await wait(3400);
 assert.equal((await evaluate('window.__experience.audio.getNowPlaying()')).id,'luoxian-loop');
 assert.equal((await evaluate('window.__experience.audio.getPlaybackState()')).activeSources,1);
 const sequence=['luoxian-loop'];
 for(let i=0;i<3;i++){await evaluate('window.__experience.audio.nextTrack()');sequence.push((await evaluate('window.__experience.audio.getNowPlaying()')).id);}
  assert.deepEqual(sequence,['luoxian-loop','luoxian-music','luoxian-battle','luoxian-loop']);
  await wait(3400);assert.equal((await evaluate('window.__experience.audio.getPlaybackState()')).activeSources,1);
  await evaluate("(async()=>{const a=window.__experience.audio;a.setEnabled(false);a.setScene('title');a.setEnabled(true);await a.unlock();})()");
  assert.equal((await evaluate('window.__experience.audio.getNowPlaying()')).id,'luoxian-wish');
  await evaluate("(async()=>{const a=window.__experience.audio;a.setEnabled(false);a.setScene('game');a.setEnabled(true);await a.unlock();})()");
  assert.equal((await evaluate('window.__experience.audio.getNowPlaying()')).id,'luoxian-loop');
  await wait(3400);assert.equal((await evaluate('window.__experience.audio.getPlaybackState()')).activeSources,1);
 const recordings=await evaluate("(async()=>{const {GAME_SOUNDTRACK}=await import('/game/beta4/game-soundtrack.js');const ctx=new AudioContext();const result=[];for(const track of GAME_SOUNDTRACK){const bytes=await fetch('/game/assets/audio/'+track.file).then(r=>r.arrayBuffer());const buffer=await ctx.decodeAudioData(bytes);let energy=0;const data=buffer.getChannelData(0);for(let i=0;i<data.length;i+=1000)energy+=Math.abs(data[i]);result.push({id:track.id,duration:buffer.duration,channels:buffer.numberOfChannels,energy});}await ctx.close();return result;})()");
 assert.equal(recordings.length,4);for(const recording of recordings){assert.ok(recording.duration>20);assert.ok(recording.energy>1);}
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,first,cover,sequence,recordings,output},null,2));
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({passed:true,first,cover,sequence,recordings,output},null,2));
}finally{
 try{if(socket?.readyState===WebSocket.OPEN){await send('Browser.close');}}catch{}
 socket?.close();if(browser.exitCode===null)browser.kill();server.close();
}
