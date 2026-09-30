import test from 'node:test';import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {advanceAstraWorld} from '../../game/astra-scheduler.js';
import {compileAstraContext} from '../../game/astra-context.js';
import {resolveAstraConversation,fallbackAstraConversation} from '../../game/astra-interaction.js';
import {validateAstraNarration} from '../../game/astra-validator.js';
import {sceneAffordances} from '../../game/astra-affordances.js';
import {projectAstraWorld} from '../../game/astra-turn.js';
import {directAstraScene} from '../../game/astra-director.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';
test('continue travelling honours a minute count longer than 365',async()=>{
 const state=createGameState('旅人','ai',()=> 'long-travel-wait'),w=state.astraWorld;
 const road=w.edges.find(e=>e.from===w.player.locationId&&!e.closed);
 w.player.travel={from:road.from,to:road.to,departAt:w.minute,arriveAt:w.minute+500};
 w.eventQueue.push({id:'long-trip-arrival',type:'player_arrival',dueAt:w.minute+500,payload:{destinationId:road.to}});
 let prompt;
 const runner=createAiTurnRunner({aiClient:{narrate:async(_,request)=>{prompt=request.messages[1].content;return '{"blocks":[{"type":"narr","text":"我走完了漫长的路途，重新查看眼前的去向。"}]}';}},transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}}});
 const result=await runner.runWorld({state,input:{action:'等待500分钟'},settings:{mode:'local'}});
 assert.equal(result.ok,true,result.error);assert.equal(result.state.astraWorld.minute,w.minute+500);
  assert.equal(result.state.astraWorld.player.travel,null);assert.equal(result.state.astraWorld.player.locationId,road.to);
 assert.ok(prompt.includes('"turnStart":'));
 assert.ok(prompt.includes('"arriveAt":860'),'narrator must see the journey at the start of the turn');
});
test('travel cannot attack or accept an origin commission through mechanical shortcuts',async()=>{
 for(const action of ['杀死林小满','接受任务']){
  const state=createGameState('旅人','ai',()=> 'travel-shortcut'),w=state.astraWorld;
  const road=w.edges.find(e=>e.from===w.player.locationId&&!e.closed);
  w.player.travel={from:road.from,to:road.to,departAt:w.minute,arriveAt:w.minute+500};
  const npc=w.characters['npc:lin-xiaoman'];npc.locationId=road.from;npc.travel=null;
  let calls=0,commits=0;
  const runner=createAiTurnRunner({aiClient:{narrate:async()=>{calls++;return '{"blocks":[{"type":"narr","text":"我继续走在路上。"}]}';}},transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{commits++;}}});
  const before=structuredClone(state);const result=await runner.runWorld({state,input:{action,speech:''},settings:{mode:'local'}});
  assert.equal(result.ok,false);assert.match(result.error,/旅途|赶路|途中/);
  assert.equal(calls,0);assert.equal(commits,0);assert.deepEqual(state,before);
 }
});
test('a journey in progress cannot converse with people left at the origin',()=>{
 for(let i=0;i<20;i++){
  const state=createGameState('旅人','ai',()=>`travel-presence-${i}`),before=state.astraWorld;
  const road=before.edges.find(e=>e.from===before.player.locationId&&!e.closed&&e.minutes>5);
  const npc=before.characters['npc:lin-xiaoman'];npc.locationId=road.from;npc.travel=null;
  const w=advanceAstraWorld(before,1,{type:'travel',destinationId:road.to}).world;
  w.characters[npc.id].locationId=road.from;w.characters[npc.id].travel=null;
  const projected=projectAstraWorld(state,w),packet=compileAstraContext(projected,'这里是哪里？',[]);
  assert.ok(packet.player.travel);
  assert.equal(packet.presentNpcs.length,0);
  assert.equal(resolveAstraConversation(w,npc.name+'，这里是哪？').targetId,null);
  assert.equal(fallbackAstraConversation(w,{targetId:npc.id,speech:'？'}),null);
  assert.equal(validateAstraNarration(w,[{type:'dlg',name:npc.name,text:'我还在这里，来跟我说话吧。'}],packet).ok,false);
  assert.ok(projected.story.location.includes(w.locations[road.to].name));
  assert.match(sceneAffordances(w).nextStep,/等待/);
  assert.match(directAstraScene(w,[]).hook,/途中|路上/);
  const arrived=advanceAstraWorld(w,w.player.travel.arriveAt-w.minute,{type:'speech'}).world;
  assert.equal(arrived.player.locationId,road.to);assert.equal(arrived.player.travel,null);
 }
});
