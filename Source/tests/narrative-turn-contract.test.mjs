import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';
import {validateAstraNarration} from '../../game/astra-validator.js';
import {applyWorldPlan} from '../../game/astra-operations.js';
import {parseNarration} from '../../game/ai-client.js';
import {explicitRealityStatement} from '../../game/astra-reality-intent.js';
import {planRealityMutation,killNpc} from '../../game/astra-reality.js';

const setup=(seed='turn-contract')=>{
 const state=createGameState('顾长生','ai',()=>seed),w=state.astraWorld;
 const npc=Object.values(w.characters)[0];
 for(const n of Object.values(w.characters)){n.locationId=null;n.travel=null;}
 npc.alive=true;npc.locationId=w.player.locationId;npc.memories=[];npc.relationships={};
 return {state,w,npc};
};
function runnerFor(narrate){return createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate}});}

test('quoted names inside explicit reality commands execute, including a speech command alongside an action',async()=>{
 for(const channel of ['action','speech']){
  const {state,w}=setup('quoted-'+channel);
  const command='言出法随：把我的名字改成“江行舟”';
  const result=await runnerFor(async()=>JSON.stringify({worldPlan:{operations:[{type:'entity.update',targetId:'player',changes:{name:'江行舟'}}]},blocks:[{type:'narr',text:'名字已随这道敕令改为江行舟。'}]}))
   .runWorld({state,input:channel==='action'?{action:command}:{speech:command,action:'站着'},settings:{mode:'groq'}});
  assert.equal(result.ok,true,result.error);assert.equal(result.state.astraWorld.player.name,'江行舟');
  assert.equal(result.state.player.name,'江行舟','the HUD must project the authoritative renamed protagonist');
  assert.ok(result.state.astraWorld.flags.causalDebt>0);assert.equal(w.player.name,'顾长生');
 }
});
test('negative desired outcome is a law, while discussing or refusing the power is ordinary speech',async()=>{
 const {state}=setup('negative-law');
 const execute=runnerFor(async()=>JSON.stringify({worldPlan:{operations:[{type:'entity.update',targetId:'player',changes:{invincible:true}}]},blocks:[{type:'narr',text:'护身的法则已经落定。'}]}));
 const result=await execute.runWorld({state,input:{action:'言出法随：不要让任何伤害杀死我'},settings:{mode:'groq'}});
 assert.equal(result.ok,true,result.error);assert.equal(result.state.astraWorld.player.invincible,true);
 for(const action of ['我不会使用言出法随让自己无敌','如果我用言出法随让我无敌会怎样？','“言出法随：让我无敌”']){
  const ordinary=await runnerFor(async()=>JSON.stringify({blocks:[{type:'narr',text:'这只是提及那种力量，眼前并没有发生改变。'}]})).runWorld({state,input:{action},settings:{mode:'groq'}});
  assert.equal(ordinary.state.astraWorld.player.invincible,state.astraWorld.player.invincible,action);
 }
});
test('a wholly deferred reality proposal cannot be reported as a successful turn',async()=>{
 const {state}=setup('defer-law');let stored=0;
 const run=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>stored++},aiClient:{narrate:async()=>JSON.stringify({worldPlan:{operations:[{type:'concept.defer',description:'愿望',reason:'暂不支持'}]},blocks:[{type:'narr',text:'一切已经改变。'}]})}});
 const result=await run.runWorld({state,input:{action:'言出法随：将我的性别改为女性'},settings:{mode:'groq'}});
 assert.equal(result.ok,false);assert.equal(stored,0);assert.deepEqual(result.state.astraWorld,state.astraWorld);
});
test('first-contact dialogue cannot invent previous visits but can discuss the speakers own past',()=>{
 const {w,npc}=setup();const packet={conversation:{targetId:npc.id,firstContact:true}};
 assert.ok(validateAstraNarration(w,[{type:'dlg',name:npc.name,text:'昨天我还去过你家，你居然不记得了？'}],packet).errors.some(e=>e.code==='invented-shared-past'));
 assert.equal(validateAstraNarration(w,[{type:'dlg',name:npc.name,text:'我昨天才来这里。你也在找落脚的地方？'}],packet).ok,true);
});
test('generic empty endings are repaired, concrete player-facing questions are accepted',()=>{
 const {w,npc}=setup();const packet={turnHandoff:{kind:'contact',targetId:npc.id,locationId:w.player.locationId}};
 assert.ok(validateAstraNarration(w,[{type:'dlg',name:npc.name,text:'你接下来想做什么？'}],packet).errors.some(e=>e.code==='empty-handoff'));
 assert.equal(validateAstraNarration(w,[{type:'dlg',name:npc.name,text:'刚刚你说不想帮忙，那就坐会儿吧。要喝点水吗？'}],packet).ok,true);
});
test('truncated generations retry a complete candidate once, not a partial world change',async()=>{
 const {state}=setup('truncated-repair');let calls=0;
 const result=await runnerFor(async()=>{
  if(++calls===1)throw Object.assign(new Error('reply length exceeded'),{code:'AI_OUTPUT_TRUNCATED',status:422});
  return JSON.stringify({worldPlan:{operations:[{type:'entity.update',targetId:'player',changes:{gender:'female'}}]},blocks:[{type:'narr',text:'指令改写了身体，我已是女子。'}]});
 }).runWorld({state,input:{action:'言出法随：把我的性别改为女性'},settings:{mode:'groq'}});
 assert.equal(result.ok,true,result.error);assert.equal(calls,2);assert.equal(result.state.astraWorld.player.gender,'female');
});
test('a reality numeric target is not immediately undone by its own health cost',()=>{
 const {w}=setup('health-cost');w.player.health=20;
 const result=applyWorldPlan(w,{operations:[{type:'entity.update',targetId:'player',changes:{health:500}}]},
  {turnId:'health-law',mode:'reality',input:{action:'言出法随：把我的气血设为500'},enforceScope:true});
 assert.equal(result.world.player.health,500);assert.equal(result.world.player.maxHealth,500);
 assert.ok(result.world.flags.causalDebt>0);
});
test('malformed companion JSON is repaired without saving a mechanical placeholder or advancing time',async()=>{
 const {state}=setup('companion-json');const saved=[];let calls=0;
 const run=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async(_,turn)=>saved.push(turn)},aiClient:{narrate:async()=>
  ++calls===1?' {"blocks":[{"type":"sys","text":"半截回复"}':JSON.stringify({blocks:[{type:'sys',text:'我在呢。刚才那个人还在等你的答复。'}]})}});
 const result=await run.runSystem({state,input:'你还在吗',settings:{mode:'groq'}});
 assert.equal(result.ok,true,result.error);assert.equal(calls,2);assert.equal(saved.length,1);
 assert.equal(saved[0].blocks[0].text,'我在呢。刚才那个人还在等你的答复。');
 assert.equal(result.state.astraWorld.minute,state.astraWorld.minute);
});
test('natural semantic labels can record a grounded interpretation without forcing an English taxonomy',()=>{
 const {w,npc}=setup('social-label');
 const updated=applyWorldPlan(w,{operations:[{type:'social.observe',observerId:npc.id,subjectId:'player',
  meaning:'听懂了自嘲',evidence:'开玩笑的',valence:0,reason:'知道对方只是在自嘲，没有改变好恶。'}]},
  {mode:'ordinary',turnId:'semantic-label',input:{speech:'刚才开玩笑的'}}).world;
 assert.equal(updated.characters[npc.id].relationships.player,0);
 assert.ok(Object.values(updated.simulation.beliefs).some(b=>b.meaning==='听懂了自嘲'));
 assert.deepEqual(w.characters[npc.id].relationships,{});
});
test('novel dialogue with quoted speech and stage directions remains ordered instead of reading actions aloud',()=>{
 const result=parseNarration(JSON.stringify({blocks:[{type:'dlg',name:'路人',text:'“坐吧。”她把凳子拉开，“这儿有地方。”'}],worldPlan:{operations:[]}}));
 assert.deepEqual(result.blocks,[{type:'dlg',name:'路人',text:'坐吧。'},{type:'narr',text:'她把凳子拉开，'},{type:'dlg',name:'路人',text:'这儿有地方。'}]);
 assert.deepEqual(result.worldPlan,{operations:[]});
 assert.equal(parseNarration(JSON.stringify({blocks:[{type:'dlg',name:'路人',text:'那本“山经”还在。'}]})).blocks[0].text,'那本“山经”还在。');
});
test('reality cost follows the magnitude of the actual numeric change and a no-op costs nothing',()=>{
 const {w}=setup('scaled-cost');
 const set=value=>applyWorldPlan(w,{operations:[{type:'entity.update',targetId:'player',changes:{wealth:value}}]},
  {mode:'reality',turnId:'scale-'+value,input:{action:'言出法随：把我的财富设为'+value},enforceScope:true}).world;
 assert.ok(set(w.player.wealth+100000).flags.causalDebt>set(w.player.wealth+1).flags.causalDebt);
 assert.equal(set(w.player.wealth).flags.causalDebt||0,w.flags.causalDebt||0);
});
test('creating and customizing a new character in one reality transaction settles atomically',()=>{
 const {w}=setup('create-customize');
 const after=applyWorldPlan(w,{operations:[
  {type:'entity.create',kind:'character',entity:{id:'npc:created',name:'江月',locationId:w.player.locationId,goals:[]}},
  {type:'entity.update',targetId:'npc:created',changes:{gender:'female',cultivation:{realm:'golden_core'}}}
 ]},{mode:'reality',turnId:'create-all',input:{action:'言出法随：创造江月，让江月为女性并拥有金丹境界'},enforceScope:true}).world;
 assert.equal(after.characters['npc:created'].gender,'female');assert.equal(after.characters['npc:created'].cultivation.realm,'golden_core');
 assert.ok(after.flags.causalDebt>0);assert.equal(w.characters['npc:created'],undefined);
});
test('questions and hypothetical law outcomes do not accidentally execute a kill',()=>{
 for(const text of ['言出法随：杀死林小满会成功吗？','言出法随：假设林小满死去','言出法随：假如让我变强'])assert.equal(explicitRealityStatement(text),null,text);
});
test('fast law parsing cannot steal a named NPC teleport or drop a conjunction',()=>{
 const {w,npc}=setup('target-coverage');
 const destination=Object.values(w.locations).find(l=>l.id!==w.player.locationId&&!l.destroyed);
 for(const text of [`言出法随：把${npc.name}传送到${destination.name}`,'言出法随：我的财富增加100和安全设为500'])
  assert.throws(()=>planRealityMutation(w,text),{code:'REALITY_SEMANTIC_REQUIRED'});
});
test('resurrection plus relocation is independent of JSON property order',()=>{
 const {w,npc}=setup('resurrect-order');killNpc(w,npc,'death');
 const destination=Object.values(w.locations).find(l=>l.id!==npc.lastKnownLocationId&&!l.destroyed);
 for(const changes of [{locationId:destination.id,alive:true},{alive:true,locationId:destination.id}]){
  const result=applyWorldPlan(w,{operations:[{type:'entity.update',targetId:npc.id,changes}]},
    {mode:'reality',turnId:'revive-and-move',input:{action:`言出法随：复活${npc.name}并传送到${destination.name}`},enforceScope:true});
  assert.equal(result.world.characters[npc.id].alive,true);assert.equal(result.world.characters[npc.id].locationId,destination.id);
 }
});
