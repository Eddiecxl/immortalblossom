import {SOUNDTRACK} from './soundtrack.js';

// Original locally synthesized stereo recordings, with equal-power transitions.
export function createScore(getSettings, options = {}) {
 const doc=options.document||globalThis.document;
 const tracks=options.tracks||SOUNDTRACK, listeners=new Set(), cache=new Map();
 const every=options.setInterval||globalThis.setInterval, cancel=options.clearInterval||globalThis.clearInterval;
 let ctx,master,music,effects,timer,scene='title',enabled=true,current=null,loading=null,disposed=false,unlocked=false,blocked=Boolean(options.blocked),generation=0;
 const active=new Set(),crossfade=3;
 const clamp=value=>Math.max(0,Math.min(100,Number(value)||0))/100;
 function ensure(){
  if(ctx||disposed||blocked)return;
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!options.contextFactory&&!Audio)return;
  ctx=options.contextFactory?options.contextFactory():new Audio();
  master=ctx.createGain();music=ctx.createGain();effects=ctx.createGain();
  const compressor=ctx.createDynamicsCompressor();
  music.connect(master);effects.connect(master);master.connect(compressor);compressor.connect(ctx.destination);
 }
 function apply(){
  if(!ctx)return;
  const s=getSettings(),now=ctx.currentTime;
  master.gain.setTargetAtTime(enabled&&!blocked?clamp(s.master):0,now,.08);
  music.gain.setTargetAtTime(clamp(s.music)*.82,now,.12);
  effects.gain.setTargetAtTime(clamp(s.sfx)*.32,now,.08);
  if(blocked||!enabled||(doc?.hidden&&s.muteBackground)){if(ctx.state==='running')void ctx.suspend().catch(()=>{});}
  else if(unlocked&&ctx.state==='suspended')void ctx.resume().catch(()=>{});
 }
 function pool(){return tracks.filter(t=>t.scenes.includes(scene));}
 function nextCandidate(){
  const candidates=pool().length?pool():tracks;
  if(!current)return candidates[0];
  const start=tracks.findIndex(t=>t.id===current.track.id);
  for(let step=1;step<=tracks.length;step++){const t=tracks[(start+step)%tracks.length];if(candidates.includes(t)&&t.id!==current.track.id)return t;}
  return candidates[0];
 }
 async function load(track){
  if(cache.has(track.id))return cache.get(track.id);
  const pending=options.loadBuffer?options.loadBuffer(track,ctx):(async()=>{
   const response=await fetch(new URL('../assets/audio/'+track.file,import.meta.url));
   if(!response.ok)throw new Error('Soundtrack unavailable: '+response.status);
   return ctx.decodeAudioData(await response.arrayBuffer());
  })();
  cache.set(track.id,pending);
  try{return await pending;}catch(error){cache.delete(track.id);throw error;}
 }
 function metadata(){
  if(!current)return null;
  const {track,buffer,start}=current;
  return {id:track.id,title:track.title,composer:track.composer||'落仙原创',index:tracks.indexOf(track)+1,total:tracks.length,duration:buffer.duration,position:Math.max(0,ctx.currentTime-start),scene};
 }
 function announce(){const detail=metadata();for(const fn of listeners){try{fn(detail);}catch(error){console.warn('Soundtrack subscriber',error);}}if(doc&&typeof CustomEvent!=='undefined')doc.dispatchEvent(new CustomEvent('lx:track',{detail}));}
 function fade(gain,from,to,at,duration){
  const curve=new Float32Array(64);
  for(let i=0;i<curve.length;i++){const phase=i/(curve.length-1)*Math.PI/2;curve[i]=to>from?Math.sin(phase):Math.cos(phase);}
  gain.cancelScheduledValues(at);gain.setValueAtTime(from,at);gain.setValueCurveAtTime(curve,at,duration);
 }
 function prefetch(){const track=nextCandidate();if(track)void load(track).catch(()=>{});}
 function retire(){
  for(const entry of active){
   entry.gain.gain.cancelScheduledValues(ctx.currentTime);entry.gain.gain.setValueAtTime(0,ctx.currentTime);
   try{entry.source.stop(ctx.currentTime);}catch{}
   entry.source.disconnect();entry.gain.disconnect();
  }
  active.clear();
 }
 function setBlocked(value){
  blocked=Boolean(value);
  if(blocked){generation++;loading=null;if(ctx)retire();current=null;}
  apply();return blocked;
 }
 async function advance(manual=false){
  if(manual&&ctx)retire();
  if(loading)return loading;
  if(!ctx||disposed||blocked||!enabled)return null;
  const epoch=generation;
  const task=(async()=>{
   const track=nextCandidate();if(!track)return null;
   if(manual)current=null;
   let buffer;
   try{buffer=await load(track);}catch(error){console.warn('落仙音乐载入失败',error);return metadata();}
   if(disposed||blocked||!enabled||epoch!==generation)return null;
   const source=ctx.createBufferSource(),gain=ctx.createGain(),at=ctx.currentTime+.025;
   source.buffer=buffer;source.connect(gain);gain.connect(music);
   const overlap=Math.min(crossfade,buffer.duration/3);
   if(current){fade(gain.gain,0,1,at,overlap);for(const previous of active){
     if(previous!==current){try{previous.source.stop(at+.05);}catch{}continue;}
     fade(previous.gain.gain,1,0,at,overlap);try{previous.source.stop(at+overlap+.02);}catch{}
   }}else{gain.gain.setValueAtTime(0,at);gain.gain.setTargetAtTime(1,at,.45);}
   const entry={track,buffer,source,gain,start:at,end:at+buffer.duration,overlap};
   active.add(entry);current=entry;
   source.onended=()=>{active.delete(entry);source.disconnect();gain.disconnect();};
   source.start(at);announce();
   const successor=nextCandidate();for(const id of cache.keys())if(id!==track.id&&id!==successor?.id)cache.delete(id);
   prefetch();return metadata();
  })();
  loading=task;
  try{return await task;}finally{if(loading===task)loading=null;}
 }
 function tick(){if(!disposed&&!blocked&&enabled&&ctx?.state==='running'&&!loading&&(!current||ctx.currentTime>=current.end-current.overlap))void advance();}
 async function unlock(){
  if(blocked||!enabled||disposed)return false;
  ensure();if(!ctx)return false;unlocked=true;
  if(!(doc?.hidden&&getSettings().muteBackground))await ctx.resume().catch(()=>{});
  if(blocked||!enabled||disposed){apply();return false;}
  apply();if(!timer)timer=every(tick,250);
  if(!current)await advance();return ctx.state==='running';
 }
 function note(freq,duration,volume,delay=0){
  if(!ctx||ctx.state!=='running')return;
  const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();
  o.type='sine';o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(volume,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  o.connect(g);g.connect(effects);o.onended=()=>{o.disconnect();g.disconnect();};o.start(t);o.stop(t+duration+.05);
 }
 function sfx(kind='click'){
  if(!enabled||blocked||disposed)return;
  const tones=kind==='hover'?[659]:kind==='death'?[294,220,147,110]:kind==='danger'?[147,139]:kind==='law'||kind==='realm'?[294,440,587,880]:kind==='quest'?[392,494,587]:[587,880];
  tones.forEach((f,i)=>note(f,kind==='hover'?.07:kind==='death'?1.2:.36,kind==='hover'?.04:.16,i*.09));
 }
 function setScene(value){
  if(scene===value||!['intro','title','game','danger'].includes(value))return;
  scene=value;
  if(current&&!current.track.scenes.includes(scene))void advance();else if(ctx)prefetch();
 }
 function onVisibility(){apply();}
 doc?.addEventListener('pointerdown',unlock,{once:true});doc?.addEventListener('keydown',unlock,{once:true});doc?.addEventListener('visibilitychange',onVisibility);
 return {
  unlock,sfx,apply,setScene,setBlocked,
  setIntensity:level=>{if(scene==='game'||scene==='danger')setScene(level>=2?'danger':'game');},
  setEnabled:value=>{enabled=Boolean(value);apply();if(enabled&&!current)void unlock();return enabled;},
  isEnabled:()=>enabled,
  nextTrack:async()=>{if(blocked||!enabled||disposed)return null;if(!ctx){await unlock();return metadata();}return advance(true);},
  getNowPlaying:metadata,
  subscribe:fn=>{listeners.add(fn);if(current)fn(metadata());return()=>listeners.delete(fn);},
  getPlaybackState:()=>({scene,enabled,blocked,contextState:ctx?.state||'locked',activeSources:active.size,crossfade,loading:Boolean(loading)}),
  dispose:()=>{disposed=true;cancel(timer);for(const entry of active){try{entry.source.stop();}catch{}}active.clear();cache.clear();listeners.clear();doc?.removeEventListener('pointerdown',unlock);doc?.removeEventListener('keydown',unlock);doc?.removeEventListener('visibilitychange',onVisibility);void ctx?.close?.();},
 };
}
