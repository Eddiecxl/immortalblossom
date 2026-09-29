import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {SOUNDTRACK} from '../../game/beta4/soundtrack.js';
const out=path.resolve(import.meta.dirname,'../../game/assets/audio');
await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{
 if(req.method==='POST'){const name=decodeURIComponent(req.url.slice(1));if(!SOUNDTRACK.some(t=>t.file===name)){res.writeHead(400).end();return;}const chunks=[];for await(const chunk of req)chunks.push(chunk);await fs.writeFile(path.join(out,name),Buffer.concat(chunks));res.end('ok');return;}
 res.setHeader('Content-Type','text/html');res.end('<html><title>Local original score renderer</title></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report=[];
try{for(const track of SOUNDTRACK){
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async(track)=>{
  const rate=48000,beat=60/track.bpm,bars=24,duration=bars*4*beat+7;
  const ac=new OfflineAudioContext(2,Math.ceil(duration*rate),rate);
  let seed=track.seed;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const mix=ac.createGain();mix.gain.value=.55;
  const dry=ac.createGain();dry.gain.value=.87;mix.connect(dry);dry.connect(ac.destination);
  const verb=ac.createConvolver(),impulse=ac.createBuffer(2,rate*3.7,rate);
  for(let ch=0;ch<2;ch++){const a=impulse.getChannelData(ch);for(let i=0;i<a.length;i++)a[i]=(random()*2-1)*Math.exp(-i/(rate*.82))*(i<rate*.025?0:1);}
  verb.buffer=impulse;const wet=ac.createGain();wet.gain.value=.22;mix.connect(verb);verb.connect(wet);wet.connect(ac.destination);
  const hz=n=>440*2**((n-69)/12),wave=(harmonics)=>{const re=new Float32Array(20),im=new Float32Array(20);harmonics.forEach((v,i)=>im[i+1]=v);return ac.createPeriodicWave(re,im);};
  const stringWave=wave([1,.32,.24,.11,.09,.048,.035,.02,.009]),brassWave=wave([1,.64,.37,.22,.11,.06,.03]),fluteWave=wave([1,.045,.18,.015,.06]),pluckWave=wave([1,.45,.29,.17,.10,.055,.026]);
  const noise=ac.createBuffer(1,rate*4,rate);const nd=noise.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=random()*2-1;
  function voice(midi,t,d,amp,kind='strings',pan=0){
   const gain=ac.createGain(),stereo=ac.createStereoPanner(),filter=ac.createBiquadFilter();filter.type='lowpass';filter.frequency.setValueAtTime(kind==='brass'?950:kind==='pluck'?4200:kind==='flute'?2600:2300,t);filter.Q.value=.4;
   gain.connect(filter);filter.connect(stereo);stereo.pan.value=pan;stereo.connect(mix);
   const attack=kind==='pluck'?.008:kind==='brass'?.12:kind==='flute'?.07:.4;
   gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(amp,t+Math.min(attack,d*.25));
   if(kind==='pluck'){gain.gain.exponentialRampToValueAtTime(Math.max(.0001,amp*.19),t+d*.36);gain.gain.exponentialRampToValueAtTime(.0001,t+d);}else{gain.gain.linearRampToValueAtTime(amp*.72,t+d*.65);gain.gain.linearRampToValueAtTime(0,t+d+.35);}
   const layers=kind==='strings'?3:kind==='brass'?2:1;
   for(let k=0;k<layers;k++){const o=ac.createOscillator();o.setPeriodicWave(kind==='strings'?stringWave:kind==='brass'?brassWave:kind==='pluck'?pluckWave:fluteWave);o.frequency.value=hz(midi);o.detune.value=layers===1?0:(k-(layers-1)/2)*7;const level=ac.createGain();level.gain.value=1/layers;o.connect(level);level.connect(gain);o.start(t);o.stop(t+d+.4);}
  }
  function drum(t,amp,deep=true){const o=ac.createOscillator(),g=ac.createGain();o.frequency.setValueAtTime(deep?114:190,t);o.frequency.exponentialRampToValueAtTime(deep?39:71,t+.18);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(amp,t+.003);g.gain.exponentialRampToValueAtTime(.0001,t+.8);o.connect(g);g.connect(mix);o.start(t);o.stop(t+.85);}
  function cymbal(t,d,amp,reverse=false){const src=ac.createBufferSource(),g=ac.createGain(),hp=ac.createBiquadFilter(),pan=ac.createStereoPanner();src.buffer=noise;src.loop=true;hp.type='highpass';hp.frequency.value=reverse?3800:6200;pan.pan.value=reverse?-.4:.35;g.gain.setValueAtTime(reverse?.0001:amp,t);if(reverse){g.gain.exponentialRampToValueAtTime(amp,t+d-.04);g.gain.linearRampToValueAtTime(0,t+d);}else g.gain.exponentialRampToValueAtTime(.0001,t+d);src.connect(hp);hp.connect(g);g.connect(pan);pan.connect(mix);src.start(t);src.stop(t+d+.02);}
  // Six independent themes, each with a question, answering phrase, lift and cadence.
  const themes=[
   [[12,14,19,17,14,12],[7,12,14,10,7,5],[12,19,22,24,22,19],[17,14,12,10,7,12]],
   [[7,12,14,19,14,12],[10,7,5,7,12,10],[19,22,19,17,14,19],[14,12,10,7,5,7]],
   [[12,12,19,22,19,17],[14,17,14,12,10,7],[19,24,26,24,22,19],[22,19,17,14,12,12]],
   [[19,17,14,12,10,7],[12,14,17,14,10,12],[22,24,22,19,17,14],[17,14,10,7,12,12]],
   [[7,12,15,14,12,7],[10,15,17,15,14,10],[19,22,24,22,19,17],[15,14,12,10,7,12]],
   [[12,14,17,19,22,19],[17,14,12,10,12,14],[19,24,26,24,22,19],[17,19,14,12,10,12]],
  ][Math.floor(track.seed/1100)-1];
  const progressions=[[0,8,3,10,5,8,10,0],[0,5,8,3,10,5,7,0],[0,3,10,5,8,10,7,0],[0,10,8,5,3,8,7,0],[0,8,5,10,0,3,7,0],[0,3,8,10,5,8,10,0]];
  const progression=progressions[Math.floor(track.seed/1100)-1];
  for(let bar=0;bar<bars;bar++){
   const t=.6+bar*4*beat,section=Math.floor(bar/4),climax=bar>=12&&bar<20,build=bar>=4&&bar<20,resolve=bar>=20;
   const energy=bar<4?.42:bar<8?.65:bar<12?.78:climax?1:.54;
   const degree=progression[bar%8],root=track.root+degree-12,third=degree===0||degree===5?3:4;
   const chord=[root,root+7,root+12+third,root+19];
   chord.forEach((n,k)=>voice(n,t,4*beat+.16,.042*energy,'strings',[-.68,.6,-.3,.28][k]));
   voice(root-12,t,3.6*beat,.07*energy,'strings',0);
   const arpeggio=bar%2?[0,2,1,3,2,1,3,2]:[0,1,2,1,3,2,1,2];
   const steps=bar<4||resolve?4:8;
   for(let j=0;j<steps;j++)voice(chord[arpeggio[j]]+12,t+j*(4/steps)*beat,beat*1.15,.062*energy,'pluck',j%2?-.37:.4);
   if(bar%2===0){
    const phrase=themes[(Math.floor(bar/2)+Math.floor(section/2))%4],rhythm=track.id==='blade'||track.id==='storm'?[0,.75,1.5,3,4.5,6]:[0,1,2.5,4,5.5,7];
    phrase.forEach((n,j)=>{const end=j===5?8:rhythm[j+1],len=(end-rhythm[j])*.9*beat;const octave=bar<4?-12:climax&&j>2?0:0;voice(track.root+n+octave,t+rhythm[j]*beat,len,.068*energy,climax?'brass':'flute',-.12);if(climax)voice(track.root+n-12,t+rhythm[j]*beat,len,.036,'strings',.45);});
   }
   if(build){drum(t,.27*energy);drum(t+2*beat,.17*energy);if(bar>=8){drum(t+3*beat,.095,false);if(climax)drum(t+3.5*beat,.09,false);}if(bar%4===3){drum(t+2.75*beat,.11,false);drum(t+3.25*beat,.13,false);drum(t+3.75*beat,.16,false);}}
   if(bar===4||bar===12||bar===20)cymbal(t,3,.062);
   if(bar===11||bar===19)cymbal(t,4*beat,.052,true);
   if(climax&&bar%2===0)[root+12,root+19,root+24+third].forEach((n,k)=>voice(n,t+.06,2.7*beat,.028,'brass',k===0?-.6:.6));
  }
  const end=.6+bars*4*beat;[track.root-12,track.root,track.root+7,track.root+12].forEach((n,k)=>voice(n,end-2*beat,5,.047,'strings',k%2?.45:-.45));
  const buffer=await ac.startRendering(),l=buffer.getChannelData(0),r=buffer.getChannelData(1);
  let peak=0;for(let i=0;i<l.length;i++)peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));
  const scale=.82/peak,bytes=new ArrayBuffer(44+l.length*4),v=new DataView(bytes),str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,l.length*4,true);
  let rms=0;for(let i=0;i<l.length;i++){const fade=Math.min(1,i/(rate*.35),(l.length-i)/(rate*2.5));const left=l[i]*scale*fade,right=r[i]*scale*fade;v.setInt16(44+i*4,Math.round(left*32767),true);v.setInt16(46+i*4,Math.round(right*32767),true);rms+=left*left+right*right;}
  await fetch('/'+encodeURIComponent(track.file),{method:'POST',body:bytes});return {title:track.title,duration:buffer.duration,peak:.82,rms:Math.sqrt(rms/(l.length*2)),bytes:bytes.byteLength};
 },track);report.push(result);console.log(JSON.stringify(result));await page.close();
}await fs.writeFile(path.join(import.meta.dirname,'audio-render-report.json'),JSON.stringify(report,null,2));}
finally{await browser.close();server.close();}
