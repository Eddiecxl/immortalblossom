import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {createAstraOpening} from '../../game/astra-opening.js';
import {beginPlayerSceneTurn,rememberPlayerScene,reconcilePlayerScene} from '../../game/astra-player-scene.js';
import {selectAstraHandoff} from '../../game/astra-handoff.js';
import {directAstraScene} from '../../game/astra-director.js';
import * as scenes from '../../game/astra-player-scene.js';
const setup=()=>createAstraOpening(createGameState('顾长生','ai',()=> 'scene-rejection')).state.astraWorld;
test('refusal and odd speech replace the opening beat without accepting a task or repeating its demand',()=>{
 const w=setup(),quests=JSON.stringify(w.quests),items=JSON.stringify(w.items),original=w.flags.playerScene.line,oldPressure=w.flags.playerScene.pressure;
 beginPlayerSceneTurn(w,{speech:'不需要帮忙，我是一条咸鱼'},{turnId:'fish'});
 rememberPlayerScene(w,[{type:'dlg',name:'林小满',text:'那这条鱼能自己站稳么？我可没打算把你提走。'}],{turnId:'fish',input:{speech:'不需要帮忙，我是一条咸鱼'}});
 const next=selectAstraHandoff(w);assert.equal(next.kind,'encounter');assert.match(next.previousInput,/咸鱼/u);
 assert.doesNotMatch(next.focus,new RegExp(original));assert.match(next.focus,/站稳/u);
 assert.notEqual(next.pressure,oldPressure,'the original demand is no longer a standing objective after the player responds');
 assert.equal(JSON.stringify(w.quests),quests);assert.equal(JSON.stringify(w.items),items);
 assert.ok(w.characters['npc:lin-xiaoman'].memories.some(m=>m.source==='scene-response'));
});
test('death, departure, teleport and terminal state invalidate the previous encounter without reviving anyone',()=>{
 for(const change of [w=>{w.characters['npc:lin-xiaoman'].alive=false},w=>{w.characters['npc:lin-xiaoman'].travel={to:'elsewhere'}},w=>{w.player.locationId=Object.keys(w.locations).find(id=>id!==w.player.locationId)},w=>{w.terminal.ended=true}]){
  const w=setup();change(w);assert.equal(reconcilePlayerScene(w),null);assert.equal(w.flags.playerScene.state,'closed');
  assert.notEqual(selectAstraHandoff(w)?.subjectId,'opening:contact');
 }
});
test('quiet exchanges do not manufacture road alerts or expose a private NPC goal as a known task',()=>{
 const w=setup(),count=w.rumors.length;
 for(let i=0;i<9;i++){const r=directAstraScene(w);assert.equal(r.event,null);assert.doesNotMatch(r.hook,/关于.*这件事|传出警示|出发前最好/u);}
 assert.equal(w.rumors.length,count);
 w.flags.playerScene.state='closed';assert.doesNotMatch(selectAstraHandoff(w).text,/关于.*这件事|保住|守住|建立/u);
});
test('a populated arrival can expose a persistent local resident, without respawning the dead or recalling the absent',()=>{
 assert.equal(typeof scenes.ensureSceneResident,'function');
 const w=setup();w.flags.playerScene.state='closed';for(const npc of Object.values(w.characters))npc.locationId=null;
 w.locations[w.player.locationId].population=100;
 const a=scenes.ensureSceneResident(w,{arrival:true,turnId:'arrived'});assert.ok(a&&a.alive);assert.equal(a.locationId,w.player.locationId);
 assert.equal(w.flags.playerScene.kind,'arrival');assert.ok(w.history.some(e=>e.id==='scene:arrived'));
 const roundtrip=JSON.parse(JSON.stringify(w));assert.equal(scenes.ensureSceneResident(roundtrip,{arrival:true,turnId:'again'}).id,a.id);
 a.alive=false;a.locationId=null;assert.equal(scenes.ensureSceneResident(w,{arrival:true,turnId:'dead'}),null);
 a.alive=true;a.locationId=Object.keys(w.locations).find(id=>id!==w.player.locationId);
 assert.equal(scenes.ensureSceneResident(w,{arrival:true,turnId:'gone'}),null);assert.notEqual(a.locationId,w.player.locationId);
});
test('uninhabited, destroyed, travelling and terminal locations never conjure a helper',()=>{
 assert.equal(typeof scenes.ensureSceneResident,'function');
 for(const mutate of [w=>w.locations[w.player.locationId].population=0,w=>w.locations[w.player.locationId].destroyed=true,w=>w.player.travel={to:'nowhere'},w=>w.terminal.ended=true]){
  const w=setup();for(const n of Object.values(w.characters))n.locationId=null;mutate(w);
  const count=Object.keys(w.characters).length;assert.equal(scenes.ensureSceneResident(w,{arrival:true,turnId:'bad'}),null);assert.equal(Object.keys(w.characters).length,count);
 }
});
