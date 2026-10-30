import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {createAstraOpening} from '../../game/astra-opening.js';
import {advanceAstraWorld} from '../../game/astra-scheduler.js';
import {selectAstraHandoff} from '../../game/astra-handoff.js';

test('fresh seeds start in a real directed encounter, including formerly empty starts',()=>{
 const kinds=new Set(),places=new Set(),backgrounds=new Set();
 for(let i=0;i<256;i++){
  const source=createGameState('顾长生','ai',()=>`opening-audit-${i}`),before=JSON.stringify(source);
  const {state,turn}=createAstraOpening(source),w=state.astraWorld,s=w.flags.playerScene;
  assert.ok(s,`missing encounter for seed ${i}`);kinds.add(s.kind);places.add(w.player.locationId);backgrounds.add(w.player.background);
  assert.equal(turn.handoff.kind,'encounter');assert.equal(s.actorId,'npc:lin-xiaoman');
  const npc=w.characters[s.actorId];assert.ok(npc.alive&&!npc.travel&&npc.locationId===w.player.locationId);
  assert.equal(turn.blocks.at(-1).type,'dlg');assert.equal(turn.blocks.at(-1).name,npc.name);
  assert.ok(turn.blocks.filter(b=>b.type==='narr').map(b=>b.text).join('').length>=230,'opening needs an actual scene, not a location card');
  assert.ok(turn.blocks.some(b=>b.type==='sys'&&/言出法随/u.test(b.text)));
  assert.ok(w.history.some(e=>e.id===s.id));assert.ok(npc.memories.some(m=>m.eventId===s.id));
  assert.ok(!w.eventQueue.some(e=>e.type==='lin_first_encounter'));
  assert.equal(JSON.stringify(source),before);
 }
 assert.ok(kinds.size>=6);assert.equal(places.size,14);assert.equal(backgrounds.size,19);
});
test('opening reentry retains time, scene and identities rather than rerolling the encounter',()=>{
 const first=createAstraOpening(createGameState('旅人','ai',()=> 'opening-reentry'));
 const again=createAstraOpening(first.state);
 assert.equal(JSON.stringify(again),JSON.stringify(first));
});
test('new encounter never resurrects or recalls Lin in an existing journey',()=>{
 const source=createGameState('旅人','ai',()=> 'old-opening');source.story.flags.seededOpening=true;
 const w=source.astraWorld,npc=w.characters['npc:lin-xiaoman'];npc.alive=false;npc.locationId=null;
 w.history.push({id:'old-death',type:'death',minute:w.minute,actors:[npc.id]});
 const result=createAstraOpening(source);assert.equal(result.state.astraWorld.characters[npc.id].alive,false);
 assert.equal(result.state.astraWorld.characters[npc.id].locationId,null);
});
test('the delayed first encounter cannot summon Lin again after her completed opening',()=>{
 const {state}=createAstraOpening(createGameState('旅人','ai',()=> 'lin-once'));
 const w=state.astraWorld,npc=w.characters['npc:lin-xiaoman'];const other=Object.keys(w.locations).find(id=>id!==w.player.locationId);
 npc.locationId=other;npc.lastPlanBucket=Math.floor((w.minute+1)/20);
 w.eventQueue.push({id:'legacy-lin-encounter',type:'lin_first_encounter',dueAt:w.minute+1,priority:10,payload:{characterId:npc.id}});
 const after=advanceAstraWorld(w,1).world;assert.equal(after.characters[npc.id].locationId,other);
 assert.notEqual(selectAstraHandoff(after)?.targetId,npc.id);
});
