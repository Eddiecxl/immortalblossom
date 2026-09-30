import test from 'node:test';
import assert from 'node:assert/strict';
import {createScore} from '../../game/beta4/audio.js';

// The external audio device is simulated; playlist and transition logic is real.
const tracks=[
 {id:'wish',title:'若还能见你',file:'wish.mp3',scenes:['intro','title']},
 {id:'battle',title:'打斗版',file:'battle.mp3',scenes:['intro','title','game','danger']},
 {id:'music',title:'音乐版',file:'music.mp3',scenes:['intro','title','game','danger']},
 {id:'loop',title:'loop版',file:'loop.mp3',scenes:['game','danger']},
];
const opening=['wish','battle','music'],journey=['loop','music','battle'];
const playlists={intro:opening,title:opening,game:journey,danger:journey};
function fixture(extra={}){
 const nodes=[],sources=[];let tick;
 const param=()=>({value:1,events:[],cancelScheduledValues(t){this.events.push(['cancel',t]);},setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);},setTargetAtTime(v,t,c){this.value=v;this.events.push(['target',v,t,c]);},setValueCurveAtTime(v,t,d){this.events.push(['curve',Array.from(v),t,d]);}});
 const node=()=>({gain:param(),connect(destination){this.connection=destination;},disconnect(){this.disconnected=true;}});
 const ctx={state:'running',currentTime:0,createGain(){const n=node();nodes.push(n);return n;},createDynamicsCompressor:node,createBufferSource(){const n={...node(),stops:[],start(t){this.startTime=t;},stop(t=ctx.currentTime){this.stops.push(t);}};sources.push(n);return n;},async resume(){this.state='running';},async suspend(){this.state='suspended';},async close(){this.state='closed';}};
 const doc={hidden:false,addEventListener(){},removeEventListener(){},dispatchEvent(){}};
 const score=createScore(()=>({master:75,music:60,sfx:65}),{contextFactory:()=>ctx,document:doc,tracks,playlists,initialScene:'intro',smoothManual:true,setInterval(fn){tick=fn;return 1;},clearInterval(){},loadBuffer:async track=>({duration:40,id:track.id}),...extra});
 return {score,ctx,sources,nodes,tick:()=>tick?.(),async settle(){await Promise.resolve();await Promise.resolve();await Promise.resolve();},endOld(){for(const s of sources)if(s.stops.some(t=>t<=ctx.currentTime)&&!s.disconnected)s.onended?.();}};
}

test('opening plays the requested songs in order and retains position at the cover',async()=>{
 const f=fixture();await f.score.unlock();assert.equal(f.score.getNowPlaying().id,'wish');assert.equal(f.score.getNowPlaying().scene,'intro');
 f.ctx.currentTime=5;f.score.setScene('title');await f.settle();assert.equal(f.sources.length,1);assert.equal(f.score.getNowPlaying().position,4.975);
 await f.score.nextTrack();assert.equal(f.score.getNowPlaying().id,'battle');
 await f.score.nextTrack();assert.equal(f.score.getNowPlaying().id,'music');f.score.dispose();
});
test('entering the game resets the gameplay playlist to loop even from a shared song',async()=>{
 const f=fixture();await f.score.unlock();await f.score.nextTrack();await f.score.nextTrack();
 f.score.setScene('game');await f.settle();assert.equal(f.score.getNowPlaying().id,'loop');assert.equal(f.score.getNowPlaying().total,3);f.score.dispose();
});
test('automatic game progression loops loop music battle without danger reordering',async()=>{
 const f=fixture();f.score.setScene('game');await f.score.unlock();const heard=[f.score.getNowPlaying().id];
 for(let i=0;i<6;i++){f.ctx.currentTime+=38;f.tick();await f.settle();f.endOld();heard.push(f.score.getNowPlaying().id);f.score.setIntensity(i%2?4:0);await f.settle();}
 assert.deepEqual(heard,['loop','music','battle','loop','music','battle','loop']);f.score.dispose();
});
test('game manual next fades the outgoing recording and schedules its stop',async()=>{
 const f=fixture();await f.score.unlock();f.ctx.currentTime=5;await f.score.nextTrack();
 assert.equal(f.score.getNowPlaying().id,'battle');assert.equal(f.sources.length,2);
 assert.ok(f.sources[0].stops[0]>f.ctx.currentTime+.5);assert.ok(f.sources[0].stops[0]<f.ctx.currentTime+4);
 const curves=f.nodes.flatMap(n=>n.gain.events).filter(e=>e[0]==='curve');assert.ok(curves.length>=2);
 f.ctx.currentTime=10;f.endOld();assert.equal(f.score.getPlaybackState().activeSources,1);f.score.dispose();
});
test('scene changes discard stale opening decode and never start the wrong recording',async()=>{
 let resolveWish;const wish=new Promise(resolve=>{resolveWish=resolve;});
 const f=fixture({loadBuffer:track=>track.id==='wish'?wish:Promise.resolve({duration:40,id:track.id})});
 const starting=f.score.unlock();f.score.setScene('game');await f.settle();resolveWish({duration:40,id:'wish'});await starting;await f.settle();
 assert.equal(f.score.getNowPlaying().id,'loop');assert.deepEqual(f.sources.map(s=>s.buffer.id),['loop']);f.score.dispose();
});
test('leaving gameplay starts the opening playlist while intro replay shares it with title',async()=>{
 const f=fixture();f.score.setScene('game');await f.score.unlock();await f.score.nextTrack();
 f.score.setScene('title');await f.settle();assert.equal(f.score.getNowPlaying().id,'wish');const count=f.sources.length;
 f.score.setScene('intro');await f.settle();assert.equal(f.sources.length,count);f.score.dispose();
});
test('blocking audio during decoding prevents a late source from reviving',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});const f=fixture({loadBuffer:()=>pending});
 const start=f.score.unlock();f.score.setBlocked(true);resolve({duration:40});await start;
 assert.equal(f.sources.length,0);assert.equal(f.score.getPlaybackState().activeSources,0);f.score.dispose();
});
test('launcher keeps its original soundtrack and immediate manual stop behavior',async()=>{
 const f=fixture({tracks:undefined,playlists:undefined,initialScene:undefined,smoothManual:undefined});
 await f.score.unlock();assert.equal(f.score.getNowPlaying().id,'gate');assert.equal(f.score.getNowPlaying().total,6);
 f.ctx.currentTime=5;await f.score.nextTrack();assert.equal(f.score.getNowPlaying().id,'clouds');assert.equal(f.sources[0].stops[0],5);f.score.dispose();
});

test('paused handoffs retain the first-track reset in both directions',async()=>{
 const f=fixture();await f.score.unlock();
 for(const [scene,id] of [['game','loop'],['title','wish']]){
  f.score.setEnabled(false);f.score.setScene(scene);await f.settle();
  f.score.setEnabled(true);await f.score.unlock();await f.settle();
  assert.equal(f.score.getNowPlaying().id,id);assert.equal(f.score.getNowPlaying().index,1);
 }
 f.score.dispose();
});

test('rapid skips fade every audible retiring source to silence before stopping',async()=>{
 const f=fixture();await f.score.unlock();f.ctx.currentTime=5;await f.score.nextTrack();
 const first=f.sources[0],gain=first.connection.gain;gain.value=.8;
 f.ctx.currentTime=5.1;await f.score.nextTrack();
 const curve= gain.events.filter(event=>event[0]==='curve').at(-1),stop=first.stops.at(-1);
 assert.ok(stop-f.ctx.currentTime>.25,'audible old track needs a real fade tail');
 assert.ok(curve[2]+curve[3]<=stop,'gain must reach silence before source stops');
 assert.ok(Math.abs(curve[1].at(-1))<.000001);
 f.ctx.currentTime=10;f.endOld();assert.equal(f.score.getPlaybackState().activeSources,1);f.score.dispose();
});
