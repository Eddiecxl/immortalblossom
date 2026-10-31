import test from 'node:test';
import assert from 'node:assert/strict';
import { compactNarrativePacket } from '../../game/astra-narrative-budget.js';
import { buildAstraLocalMessages } from '../../game/astra-local-prompt.js';
import { createGameState } from '../../game/game-state.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
const base={playerTurn:{text:'刚才是开玩笑的。你自己的想法是什么？',speech:'刚才是开玩笑的。你自己的想法是什么？'},
 conversation:{targetId:'npc:a',targetName:'当局人物'},clock:{period:'清晨',time:'06:00'},player:{id:'player'},
 presentNpcs:[{id:'npc:a',name:'当局人物',goals:['保住船只'],memories:[]}],items:[],activeQuests:[],
 simulationFacts:{commitments:[]},recentTurns:[{id:'old',userText:'香蕉',blocks:[{type:'dlg',name:'当局人物',text:'OLD_RESPONSE_DO_NOT_COPY'}]}]};
test('ordinary interaction retains a bounded last exchange without replaying old full scenes',()=>{
 const packet=structuredClone(base);
 packet.recentTurns.unshift({id:'older',userText:'更早的问话',blocks:[{type:'dlg',name:'当局人物',text:'OLD_SCENE_NOT_NEEDED'}]});
 const messages=buildAstraLocalMessages(packet,[],'Qwen3-14B-Q4_K_M.gguf');
 assert.ok(!messages[1].content.includes('OLD_SCENE_NOT_NEEDED'));
 assert.ok(messages[1].content.includes('OLD_RESPONSE_DO_NOT_COPY'),'last answer is needed to interpret a follow-up');
 assert.ok(messages[1].content.includes('保住船只'));
});
test('assembled fact budget preserves input, focused NPC and actual delivery bindings without mutating source',()=>{
 const packet=structuredClone(base);packet.playerTurn.text='我收下随身物件';
 packet.items=[{id:'item:real',name:'随身物件',ownerId:'npc:a',quantity:1}];
 packet.simulationFacts.commitments=[{id:'offer:real',itemId:'item:real',fromId:'npc:a',toId:'player',state:'pending',condition:{op:'eq',left:{entityId:'item:real',field:'ownerId'},right:'npc:a'}}];
 packet.history=Array.from({length:30},(_,i)=>({id:'event:'+i,summary:'背景'.repeat(200)}));
 const before=structuredClone(packet),facts=compactNarrativePacket(packet,{maxChars:4000});
 assert.ok(JSON.stringify(facts).length<=4000);
 assert.deepEqual(facts.playerTurn,packet.playerTurn);
 assert.equal(facts.presentNpcs[0].id,'npc:a');
 assert.deepEqual(facts.simulationFacts.commitments[0],packet.simulationFacts.commitments[0]);
 assert.equal(facts.items[0].id,'item:real');
 assert.deepEqual(packet,before);
});

test('full supported speech and action fit without counting lossless input aliases as separate facts',()=>{
 const packet=structuredClone(base),speech='谈话'.repeat(595)+'请记住最后一句',action='动作'.repeat(890)+'；把凭证交给当局人物。';
 packet.playerTurn={speech,action,text:speech,turnId:'tx:full-input'};
 packet.input=speech+'\n'+action;
 packet.turnHandoff={kind:'encounter',targetId:'npc:a',previousInput:packet.input,phase:'responding'};
 packet.items=[{id:'item:credential',name:'凭证',ownerId:'player',quantity:1}];
 packet.simulationFacts.commitments=[{id:'offer:credential',state:'pending',fromId:'player',toId:'npc:a',itemId:'item:credential'}];
 const before=structuredClone(packet),result=compactNarrativePacket(packet,{maxChars:4300});
 assert.equal(result.playerTurn.speech,speech);assert.equal(result.playerTurn.action,action);
 assert.ok(JSON.stringify(result).length<=4300);
 assert.equal(result.items[0].id,'item:credential');assert.deepEqual(result.simulationFacts.commitments,packet.simulationFacts.commitments);
 assert.deepEqual(packet,before);
});

test('distinct input aliases and distinct previous statements are not silently discarded',()=>{
 const packet=structuredClone(base);packet.input='额外授权线索';packet.playerTurn.text='另一个不同的描述';
 packet.turnHandoff={kind:'encounter',previousInput:'这是上一轮的话'};
 const result=compactNarrativePacket(packet);
 assert.equal(result.input,packet.input);assert.equal(result.playerTurn.text,packet.playerTurn.text);
 assert.equal(result.turnHandoff.previousInput,packet.turnHandoff.previousInput);
});
test('budget retains named action targets and recalled history before unrelated cast',()=>{
 const packet=structuredClone(base);
 packet.playerTurn={speech:'请看好了',action:'把远镇人口设为1000；记得此前守门人的话吗？'};
 packet.numericFacts=[{id:'place:far',name:'远镇',population:100}];
 packet.recalledSummaries=[{id:'remember',summary:'守门人此前拒绝了交易。'}];
 packet.presentNpcs.push(...Array.from({length:7},(_,i)=>({id:'extra:'+i,name:'闲人'+i,memories:Array.from({length:4},()=>({summary:'无关背景'.repeat(35)}))})));
 const compact=compactNarrativePacket(packet,{maxChars:4000});
 assert.equal(compact.numericFacts[0]?.id,'place:far');
 assert.equal(compact.recalledSummaries[0]?.id,'remember');
 assert.equal(compact.presentNpcs[0].id,'npc:a');
 assert.ok(JSON.stringify(compact).length<=4000);
});
test('budget keeps transitive quest-item conditions and may drop unrelated outgoing roads',()=>{
 const packet=structuredClone(base);packet.location={id:'here'};
 packet.simulationFacts.commitments=[{id:'offer:a',state:'pending',condition:{left:{entityId:'quest:dep',field:'state'},right:'completed'}}];
 packet.activeQuests=[{id:'quest:dep',giverId:'npc:else',condition:{left:{entityId:'item:dep',field:'ownerId'},right:'player'}}];
 packet.items=[{id:'item:dep',name:'凭证',ownerId:'player'}];
 packet.nearbyEdges=[{from:'here',to:'unrelated',minutes:30,description:'闲路'.repeat(100)}];
 const compact=compactNarrativePacket(packet,{maxChars:900});
 assert.equal(compact.items[0]?.id,'item:dep');
 assert.equal(compact.activeQuests[0]?.id,'quest:dep');
 assert.equal(compact.nearbyEdges.length,0);
});
test('long NPC knowledge indexes do not crowd out the recalled evidence they index',()=>{
 const packet=structuredClone(base);packet.playerTurn.speech=packet.playerTurn.text='记得我说过什么吗？';
 packet.presentNpcs[0].knowledge=Array.from({length:80},(_,i)=>'memory:opaque-id-long-'+i);
 packet.presentNpcs[0].memories=[{id:'memory:opaque-id-long-1',summary:'玩家先前拒绝了帮助。'}];
 const compact=compactNarrativePacket(packet,{maxChars:1200});
 assert.equal(compact.presentNpcs[0].memories[0].summary,'玩家先前拒绝了帮助。');
 assert.equal(packet.presentNpcs[0].knowledge.length,80);
});
test('recall deduplicates mirrored belief evidence without losing the holder, appraisal or earlier words',()=>{
 for(const suffix of ['a','b','c']){
  const packet=structuredClone(base);packet.playerTurn.text=packet.playerTurn.speech='记得我刚才说了什么奇怪的话吗？';
  const summary='我曾说自己是会说话的风筝。'+('人物记住了当时的态度。'.repeat(8));
  packet.presentNpcs[0].memories=[{id:'memory:'+suffix,eventId:'event:'+suffix,summary,source:'witness',confidence:1}];
  packet.simulationFacts.beliefs=[{holderId:'npc:a',eventId:'event:'+suffix,summary,mode:'witness',confidence:1,appraisal:-2},
   {holderId:'npc:a',eventId:'event',summary:'我曾说自己是会说话的风筝。',mode:'interpretation',confidence:0.8,appraisal:-1}];
  const before=structuredClone(packet),compact=compactNarrativePacket(packet,{maxChars:1100});
  assert.ok(JSON.stringify(compact).length<=1100);
  const memory=compact.presentNpcs[0].memories[0];
  assert.equal(memory.summary,summary);assert.equal(memory.eventId,'event:'+suffix);
  assert.equal(memory.beliefEvidence[0].appraisal,-2);assert.equal(compact.presentNpcs[0].id,'npc:a');
  assert.equal(memory.beliefEvidence[1].eventId,'event');assert.equal(memory.beliefEvidence[1].appraisal,-1);
  assert.deepEqual(packet,before);
 }
});
test('explicit recall keeps actual earlier words while ordinary conversation uses summaries',()=>{
 const packet=structuredClone(base);packet.playerTurn.text='你刚才说了什么话？';
 const facts=compactNarrativePacket(packet);
 assert.equal(facts.recentTurns[0].dialogue[0].text,'OLD_RESPONSE_DO_NOT_COPY');
 assert.equal(compactNarrativePacket(base).recentTurns[0].dialogue[0].text,'OLD_RESPONSE_DO_NOT_COPY');
 assert.ok(buildAstraLocalMessages(packet)[1].content.includes('OLD_RESPONSE_DO_NOT_COPY'));
});
test('a cloud turn budgets the assembled request even after several long novel replies',async()=>{
 const state=createGameState('测试','ai',()=> 'cloud-long-dialogue');
 const npc=Object.values(state.astraWorld.characters).find(n=>n.alive);npc.locationId=state.astraWorld.player.locationId;npc.travel=null;
 const recent=Array.from({length:6},(_,i)=>({id:'prior-'+i,kind:'world',userText:'先前的问题'+i,blocks:Array.from({length:4},()=>({type:'dlg',name:npc.name,text:'旧小说描述'.repeat(60)}))}));
 let chars=0;
 const runner=createAiTurnRunner({aiClient:{narrate:async(_settings,context)=>{chars=context.messages.reduce((s,m)=>s+m.content.length,0);return JSON.stringify({blocks:[{type:'dlg',name:npc.name,text:'我先照看自己的事情，再决定是否另作打算。'}]});}},
 transcriptStore:{recentTurns:async()=>recent,appendTurn:async()=>{}}});
 const result=await runner.runWorld({state,input:{speech:npc.name+'，你自己的想法是什么？',action:''},transactionId:'tx:budget-cloud',settings:{mode:'groq',provider:'groq'}});
 assert.equal(result.ok,true);
 assert.ok(chars<=12500,'assembled prompt characters: '+chars);
});
