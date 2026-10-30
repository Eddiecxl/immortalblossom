import test from 'node:test';
import assert from 'node:assert/strict';
import * as view from '../../game/beta4/rpg-view.js';
import {detectEvents} from '../../game/beta4/presentation.js';
import {createGameState} from '../../game/game-state.js';
import {createAiTurnRunner,buildSystemCompanionMessages} from '../../game/ai-turn.js';
import {validateAstraNarration} from '../../game/astra-validator.js';
import {compileAstraContext} from '../../game/astra-context.js';
import {compactNarrativePacket} from '../../game/astra-narrative-budget.js';

function scene(seed='natural-world'){
 const state=createGameState('顾长生','ai',()=>seed),w=state.astraWorld;
 const npc=Object.values(w.characters).find(n=>n.alive);
 for(const n of Object.values(w.characters))n.locationId=null;
 npc.locationId=w.player.locationId;npc.travel=null;npc.metPlayer=false;
 return {state,w,npc};
}
test('nearby panel uses living actual presence before an NPC enters the codex, across seeds',()=>{
 assert.equal(typeof view.nearbyCharacterRows,'function');
 for(const seed of ['presence-one','presence-two','presence-three']){
  const {state,w,npc}=scene(seed);state.codex.characters=[];
  assert.deepEqual(view.nearbyCharacterRows(state).map(n=>n.id),[npc.id]);
  npc.alive=false;assert.equal(view.nearbyCharacterRows(state).length,0);
  npc.alive=true;npc.travel={from:w.player.locationId,to:'away'};assert.equal(view.nearbyCharacterRows(state).length,0);
  npc.travel=null;w.player.travel={from:w.player.locationId,to:'away'};assert.equal(view.nearbyCharacterRows(state).length,0);
 }
});
test('ordinary injuries, travel, new tasks and items do not interrupt with a popup',()=>{
 const before=createGameState('顾长生','ai',()=> 'event-policy'),after=structuredClone(before);
 after.player.hp-=12;after.story.location='别处';after.inventory.items['草药']=1;after.quests.active.push({id:'new'});
 assert.deepEqual(detectEvents(before,after),[]);
});
test('actual Astra task completion and failure produce popups, terminal tasks do not repeat',()=>{
 const {state,w}=scene('task-policy');
 w.quests={a:{id:'a',title:'旧约',state:'active'},b:{id:'b',title:'托付',state:'active'}};
 const after=structuredClone(state);after.astraWorld.quests.a.state='completed';after.astraWorld.quests.b.state='failed';
 assert.deepEqual(detectEvents(state,after).map(e=>e.kind).sort(),['failedquest','quest']);
 assert.deepEqual(detectEvents(after,structuredClone(after)),[]);
});
test('similar setting introductions are rejected on a continuing scene, new reactions pass',()=>{
 const {state,w,npc}=scene('opening-policy');
 const old='清晨的雾气还缠在临溪镇的木桥上，林小满低头整理货筐。';
 const packet=compileAstraContext(state,'你谁呀',[{blocks:[{type:'narr',text:old}]}]);
 packet.narrativeContinuity={sameScene:true,recentOpenings:[old]};
 const duplicate=validateAstraNarration(w,[{type:'narr',text:'清晨的雾气还缠在临溪镇的青石板上，林小满抱着手臂靠在摊车旁。'}],packet);
 assert.ok(duplicate.errors.some(e=>e.code==='repeated-opening'));
 assert.equal(validateAstraNarration(w,[{type:'narr',text:'她把账册合上，看了我一眼。'},{type:'dlg',name:npc.name,text:'问我？我在这里管账。'}],packet).ok,true);
 packet.narrativeContinuity.sameScene=false;
 assert.equal(validateAstraNarration(w,[{type:'narr',text:'清晨的雾气还缠在临溪镇的青石板上，眼前道路与先前不同。'}],packet).ok,true);
});
test('author budget retains a short recent narrative opening as continuity evidence',()=>{
 const packet={input:'你好',recentTurns:[{id:'old',blocks:[{type:'narr',text:'她把账册合上，转过身来。'},{type:'dlg',name:'路人',text:'你好。'}]}]};
 const result=compactNarrativePacket(packet);
 assert.equal(result.recentTurns[0].narrativeOpening,'她把账册合上，转过身来。');
 assert.deepEqual(packet.recentTurns[0].blocks.length,2);
});
test('narration cannot empty the surroundings while a living NPC is actually present',()=>{
 const {w}=scene('present-prose');
 const result=validateAstraNarration(w,[{type:'narr',text:'我环顾四周，周围没有别人，只有风声。'}]);
 assert.ok(result.errors.some(e=>e.code==='presence-contradiction'));
});
test('world ending without player death shows an ending popup',()=>{
 const {state}=scene('living-ending'),after=structuredClone(state);
 after.astraWorld.terminal={ended:true,ending:'story_complete'};after.story.flags.playerDead=true;
 assert.deepEqual(detectEvents(state,after).map(e=>e.kind),['ending']);
 after.astraWorld.player.alive=false;
 assert.deepEqual(detectEvents(state,after).map(e=>e.kind),['death']);
});
test('internal scores are rejected but prices, ages and ordinary quantities are valid',()=>{
 const {w,npc}=scene('score-policy');
 for(const text of ['危险程度已达六十五分。','好感度下降 12。','气血减少 3。','改写范围：kill_npc；实际代价：35。'])
  assert.ok(validateAstraNarration(w,[{type:'dlg',name:npc.name,text}]).errors.some(e=>e.code==='internal-metric'),text);
 assert.equal(validateAstraNarration(w,[{type:'dlg',name:npc.name,text:'船票要十八枚铜钱，明早开船。'}]).ok,true);
});
test('explicit reality outcomes keep real mechanics while omitting debug types and cost from prose',async()=>{
 const {state,npc}=scene('law-prose');let requests=0;
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>{
  requests++;return JSON.stringify({blocks:[{type:'narr',text:`${npc.name}的气息骤然断了，身体失去支撑。我胸口的酸痛还未散去，眼前的结果已经无法收回。`}],worldPlan:{operations:[]}});
 }}});
 const result=await runner.runWorld({state,input:{speech:'',action:`我使用言出法随让${npc.name}死去`},settings:{mode:'groq'}});
 assert.equal(result.ok,true,result.error);assert.equal(requests,1);
 assert.equal(result.state.astraWorld.characters[npc.id].alive,false);
 assert.ok(result.state.astraWorld.flags.causalDebt>0);
 assert.doesNotMatch(result.turn.blocks.map(b=>b.text).join(' '),/kill_npc|实际代价|改写范围|气血减少\s*\d/u);
 assert.match(result.turn.blocks.map(b=>b.text).join(' '),/疼|虚弱|伤|气息|胸口/u);
});
test('system repairs an internal score without committing the invalid response or advancing time',async()=>{
 const {state}=scene('system-prose');let calls=0;const stored=[];
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async(_,t)=>stored.push(t)},aiClient:{narrate:async()=>JSON.stringify({blocks:[{type:'sys',text:++calls===1?'当地风险 60/100。':'这附近不太平，出发前先问清路况。'}]})}});
 const result=await runner.runSystem({state,input:'这里危险吗？',settings:{mode:'groq'}});
 assert.equal(result.ok,true,result.error);assert.equal(calls,2);assert.equal(stored.length,1);
 assert.equal(result.state.astraWorld.minute,state.astraWorld.minute);
 assert.doesNotMatch(result.turn.blocks[0].text,/60|100/);
 assert.match(buildSystemCompanionMessages(state,'这里危险吗？')[0].content,/数值|评分/u);
});
