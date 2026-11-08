import test from 'node:test';import assert from 'node:assert/strict';import {createMainStoryState} from '../../game/astra-main-story.js';import {createAstraOpening} from '../../game/astra-opening.js';import {compileAstraContext} from '../../game/astra-context.js';
import {dialogueFrame} from '../../game/astra-dialogue.js';import {proposeStory,respondStory,reconcileStories,storyView} from '../../game/astra-story.js';
import {applyWorldPlan} from '../../game/astra-operations.js';import {migrateGameState} from '../../game/game-state.js';import {createAiTurnRunner} from '../../game/ai-turn.js';
import {advanceAstraWorld} from '../../game/astra-scheduler.js';
const setup=()=>createAstraOpening(createMainStoryState('顾长生',()=> 'fast-story')).state;
test('short dialogue projects a smaller factual view and preserves consent, ownership and current input',()=>{
 const s=setup(),p=compileAstraContext(s,'小满，你为什么帮我？',[]);p.playerTurn={speech:'小满，你为什么帮我？',action:''};p.conversation={targetId:'npc:lin-xiaoman'};
 const f=dialogueFrame(p);assert.ok(f);assert.ok(JSON.stringify(f).length<JSON.stringify(p).length);assert.deepEqual(f.playerTurn,p.playerTurn);assert.equal(f.items.find(i=>i.id==='item:main-herb').ownerId,'player');assert.deepEqual(f.simulationFacts.commitments,p.simulationFacts.commitments);
});
test('long recall and multi-action turns keep the full author view instead of erasing necessary history',()=>{
 const p={playerTurn:{speech:'回顾从前所有的事，梳理已经发生的变化',action:''}};assert.equal(dialogueFrame(p),null);assert.equal(dialogueFrame({playerTurn:{speech:'你好',action:'攻击敌人'}}),null);
});
function invitation(w){return {id:'story:dinner',kind:'invitation',title:'一场邀约',summary:'小满邀请我赴约，但我尚未答应。',ownerId:'npc:lin-xiaoman',locationId:w.player.locationId,dueAt:w.minute+30};}
test('an invitation is not player consent; declining it persists and cannot be overwritten by the author',()=>{
 const w=setup().astraWorld;proposeStory(w,invitation(w),{turnId:'offered'});assert.equal(w.simulation.storyThreads['story:dinner'].state,'pending');respondStory(w,{id:'story:dinner',response:'decline',evidence:'我不去'},{turnId:'declined',input:{speech:'我不去'}});assert.equal(w.simulation.storyThreads['story:dinner'].state,'declined');assert.throws(()=>proposeStory(w,invitation(w),{turnId:'again'}));
});
test('clipping positive-looking evidence out of a negative reply cannot manufacture consent',()=>{
 const w=setup().astraWorld;proposeStory(w,invitation(w),{turnId:'offer'});assert.throws(()=>respondStory(w,{id:'story:dinner',response:'accept',evidence:'答应'},{turnId:'bad',input:{speech:'先说说，我还没答应'}}));assert.equal(w.simulation.storyThreads['story:dinner'].state,'pending');
});
test('relative appointment dates are computed by Engine and cannot contradict tomorrow in the summary',()=>{
 const w=setup().astraWorld,t={...invitation(w),summary:'明天早上八点半见面。',time:{dayOffset:1,hour:8,minute:30,durationMinutes:60}};proposeStory(w,t,{turnId:'clock'});assert.equal(w.simulation.storyThreads[t.id].startsAt,1440+8*60+30);assert.equal(w.simulation.storyThreads[t.id].dueAt,1440+9*60+30);
 const bad=setup().astraWorld;assert.throws(()=>proposeStory(bad,{...invitation(bad),summary:'明天见面。',startsAt:bad.minute+5},{turnId:'bad-clock'}));
});
test('an explicit unique existing place name resolves an invented alias without creating a phantom venue',()=>{
 const w=setup().astraWorld,count=Object.keys(w.locations).length,t={...invitation(w),locationId:'loc:wrong-alias',summary:'邀请我到临溪镇坐坐。'};proposeStory(w,t,{turnId:'named-place'});assert.equal(w.simulation.storyThreads[t.id].locationId,'loc:linxi');assert.equal(Object.keys(w.locations).length,count);
});
test('long waits process the appointment start before its later deadline instead of skipping the whole meeting',()=>{
 const w=setup().astraWorld,t={...invitation(w),startsAt:w.minute+10};proposeStory(w,t,{turnId:'timed'});respondStory(w,{id:t.id,response:'accept',evidence:'我会参加'},{turnId:'yes',input:{speech:'我会参加'}});const r=advanceAstraWorld(w,40);assert.equal(r.world.simulation.storyThreads[t.id].state,'resolved');assert.equal(r.world.simulation.storyThreads[t.id].stateHistory.at(-1).minute,t.startsAt);
});
test('a composite reality operation destroying the real venue cancels linked invitations in the same transaction',()=>{
 const w=setup().astraWorld,t={...invitation(w),locationId:'loc:linhome'};proposeStory(w,t,{turnId:'invite'});const r=applyWorldPlan(w,{operations:[{type:'entity.update',targetId:t.locationId,changes:{destroyed:true}}]},{turnId:'destroy-real-venue',mode:'reality',input:{action:'言出法随：摧毁林家小院'}});assert.equal(r.world.locations[t.locationId].destroyed,true);assert.equal(r.world.simulation.storyThreads[t.id].state,'cancelled');assert.equal(w.locations[t.locationId].destroyed,false);
});
test('future plans end when the host dies, venue is destroyed or time expires',()=>{
 for(const kind of ['death','venue','time']){const w=setup().astraWorld;proposeStory(w,invitation(w),{turnId:'offered'});if(kind==='death')w.characters['npc:lin-xiaoman'].alive=false;if(kind==='venue')w.locations[w.player.locationId].destroyed=true;if(kind==='time')w.minute+=31;reconcileStories(w);assert.equal(w.simulation.storyThreads['story:dinner'].state,kind==='time'?'missed':'cancelled');assert.ok(w.history.some(e=>e.type==='story_state'));}
});
test('accepting a scheduled event never forces attendance, and resolved states are linked to real conditions',()=>{
 const w=setup().astraWorld,thread=invitation(w);thread.locationId='loc:linxi';proposeStory(w,thread,{turnId:'offer'});respondStory(w,{id:thread.id,response:'accept',evidence:'我会参加'},{turnId:'accept',input:{speech:'我会参加'}});reconcileStories(w);assert.equal(w.simulation.storyThreads[thread.id].state,'accepted');w.player.locationId='loc:linxi';reconcileStories(w);assert.equal(w.simulation.storyThreads[thread.id].state,'accepted');w.characters[thread.ownerId].locationId='loc:linxi';reconcileStories(w);assert.equal(w.simulation.storyThreads[thread.id].state,'resolved');
});
test('hidden future intentions are not disclosed before their reveal condition',()=>{
 const w=setup().astraWorld,t={...invitation(w),visibility:'private',revealWhen:{op:'eq',left:{entityId:'player',field:'locationId'},right:'loc:linxi'}};proposeStory(w,t,{turnId:'secret'});assert.equal(storyView(w).length,0);w.player.locationId='loc:linxi';reconcileStories(w);assert.equal(storyView(w).length,1);
});
test('story operations commit atomically, survive saves, and can become quest/rule condition dependencies',()=>{
 const s=setup(),w=s.astraWorld,thread=invitation(w);const applied=applyWorldPlan(w,{operations:[{type:'story.propose',thread}]},{turnId:'story-op',mode:'ordinary',input:{speech:'先说说邀请'}});
 assert.equal(w.simulation?.storyThreads?.[thread.id],undefined);s.astraWorld=applied.world;const restored=migrateGameState(JSON.parse(JSON.stringify(s)),'ai');assert.equal(restored.astraWorld.simulation.storyThreads[thread.id].state,'pending');
 assert.throws(()=>applyWorldPlan(w,{operations:[{type:'story.propose',thread},{type:'entity.update',targetId:'missing',changes:{alive:true}}]},{turnId:'bad-story',mode:'ordinary',input:{speech:'你好'}}));assert.equal(w.simulation?.storyThreads?.[thread.id],undefined);
});
test('quick dialogue makes one short-author request and advances a short exchange rather than five minutes',async()=>{
 const s=setup();let calls=0,request;const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async(_,r)=>{calls++;request=r;return JSON.stringify({blocks:[{type:'dlg',name:'林小满',text:'我叫小满。你先喘口气，慢慢说就好。'}]});}}});
 const r=await runner.runWorld({state:s,input:{speech:'小满，你叫什么？'},settings:{fastDialogue:true,narrativePolicy:'playable'}});assert.equal(r.ok,true,r.error);assert.equal(calls,1);assert.equal(request.maxTokens,768);assert.ok(request.messages.reduce((n,m)=>n+m.content.length,0)<6500);assert.equal(r.state.astraWorld.minute,s.astraWorld.minute+1);
});
test('free-form social meaning is data, not a keyword enum or punctuation restriction',()=>{
 const w=setup().astraWorld;for(const meaning of ['好','愿意了解、先不答应']){
  const r=applyWorldPlan(w,{operations:[{type:'social.observe',observerId:'npc:lin-xiaoman',subjectId:'player',meaning,evidence:'先聊聊',valence:0,reason:'听见玩家想先了解情况'}]},{turnId:'social:'+meaning,mode:'ordinary',input:{speech:'先聊聊'}});assert.ok(Object.values(r.world.simulation.beliefs).some(b=>b.meaning===meaning));
 }
});
test('a clue is not erased just because its source dies, while real invitation timing still matters',()=>{
 const w=setup().astraWorld,t={...invitation(w),id:'story:clue',kind:'clue'};proposeStory(w,t,{turnId:'clue'});w.characters[t.ownerId].alive=false;reconcileStories(w);assert.equal(w.simulation.storyThreads[t.id].state,'planned');
 const another=setup().astraWorld,future={...invitation(another),startsAt:another.minute+10};proposeStory(another,future,{turnId:'future'});respondStory(another,{id:future.id,response:'accept',evidence:'我会参加'},{turnId:'yes',input:{speech:'我会参加'}});reconcileStories(another);assert.equal(another.simulation.storyThreads[future.id].state,'accepted');another.minute+=10;reconcileStories(another);assert.equal(another.simulation.storyThreads[future.id].state,'resolved');
});
