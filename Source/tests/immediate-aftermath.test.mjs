import test from 'node:test';import assert from 'node:assert/strict';
import {createMainStoryState}from '../../game/astra-main-story.js';import{createAstraOpening}from '../../game/astra-opening.js';import{createAiTurnRunner}from '../../game/ai-turn.js';import{createTranscriptStore}from '../../game/transcript-store.js';
import {createStorage} from '../../game/storage.js';
const setup=()=>createAstraOpening(createMainStoryState('顾长生',()=> 'immediate-after'));
const response=(blocks,operations=[])=>JSON.stringify({blocks,worldPlan:{operations}});
test('an action-only contact gets the addressed character response in the same turn',async()=>{
 const o=setup(),store=createTranscriptStore({memory:new Map()}),seen=[];await store.appendTurn(o.state.journeyId,o.turn);
 const runner=createAiTurnRunner({transcriptStore:store,aiClient:{narrate:async(_,r)=>{seen.push(r);return seen.length===1?response([{type:'narr',text:'我在她脸颊上轻轻亲了一下。'}]):response([{type:'dlg',name:'林小满',text:'你做什么！先退开一点。'}]);}}});
 const r=await runner.runWorld({state:o.state,input:{action:'我凑近，在林小满脸颊上亲了一口'},settings:{mode:'groq',narrativePolicy:'playable',renderSettledScenes:false,autoAftermath:true}});
 assert.equal(r.ok,true,r.error);assert.ok(r.state.astraWorld.flags.pendingAftermath);const after=await runner.runAftermath({state:r.state,settings:{mode:'groq',narrativePolicy:'playable'}});assert.equal(after.ok,true,after.error);assert.ok(after.blocks.some(b=>b.type==='dlg'&&b.name==='林小满'));assert.equal(seen.length,2);
});
test('known law commits first and leaves a persisted automatic aftermath without asking for new player input',async()=>{
 const o=setup(),store=createTranscriptStore({memory:new Map()});let calls=0;const runner=createAiTurnRunner({transcriptStore:store,aiClient:{narrate:async()=>{calls++;return response([{type:'dlg',name:'林小满',text:'刚才那道光怎么回事？你还好吗？'},{type:'sys',text:'成了，先看看她的反应。'}]);}}});
 const first=await runner.runWorld({state:o.state,input:{action:'言出法随：让我无敌'},settings:{mode:'groq',narrativePolicy:'playable',renderSettledScenes:false,autoAftermath:true}});assert.equal(first.ok,true,first.error);assert.equal(first.state.astraWorld.player.invincible,true);assert.equal(calls,0);assert.ok(first.state.astraWorld.flags.pendingAftermath);
 const {minute}=first.state.astraWorld,turns=first.state.memory.turnCount,debt=first.state.astraWorld.flags.causalDebt;
 const next=await runner.runAftermath({state:first.state,settings:{mode:'groq',narrativePolicy:'playable'}});assert.equal(next.ok,true,next.error);assert.equal(calls,1);assert.ok(next.blocks.some(b=>b.type==='dlg'));assert.equal(next.state.memory.turnCount,turns);assert.equal(next.state.astraWorld.minute,minute);assert.equal(next.state.astraWorld.flags.causalDebt,debt);assert.equal(next.state.astraWorld.flags.pendingAftermath,null);
 const again=await runner.runAftermath({state:next.state,settings:{mode:'groq'}});assert.equal(again.blocks.length,0);assert.equal(calls,1);assert.equal((await store.allTurns(o.state.journeyId)).length,2);
});
test('quota or bad aftermath prose cannot roll back or re-charge an already successful law',async()=>{
 const o=setup(),store=createTranscriptStore({memory:new Map()}),runner=createAiTurnRunner({transcriptStore:store,aiClient:{narrate:async()=>{throw Object.assign(Error('quota'),{code:'AI_QUEUE_PENDING',status:202});}}});
 const first=await runner.runWorld({state:o.state,input:{action:'言出法随：让我无敌'},settings:{mode:'groq',renderSettledScenes:false,autoAftermath:true}});assert.equal(first.ok,true);const snapshot=structuredClone(first.state);
 const after=await runner.runAftermath({state:first.state,settings:{mode:'groq'}});assert.equal(after.ok,false);assert.equal(after.effectCommitted,true);assert.deepEqual(after.state,snapshot);assert.equal(after.state.astraWorld.player.invincible,true);
});
test('valid semantic law does not fail because its author also wrote an invalid old-scene sentence',async()=>{
 const o=setup(),runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>response([{type:'dlg',name:'不存在的人',text:'我从空气里冒出来了。'}],[{type:'entity.update',targetId:'npc:lin-xiaoman',changes:{personality:'温和'}}])}});
 const r=await runner.runWorld({state:o.state,input:{action:'言出法随：让林小满的性格变得温和'},settings:{mode:'groq',narrativePolicy:'playable',renderSettledScenes:true,autoAftermath:true}});assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.characters['npc:lin-xiaoman'].personality,'温和');assert.equal(r.state.astraWorld.characters['npc:lin-xiaoman'].alive,true);assert.ok(r.state.astraWorld.flags.pendingAftermath);
});
test('the explicit law button is a separate invocation channel, including a polite question mark',async()=>{
 const o=setup();let calls=0;const runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>{calls++;throw Error('not needed');}}});
 const r=await runner.runWorld({state:o.state,input:{speech:'',action:'言出法随：让我无敌？',invocation:true},settings:{mode:'groq',renderSettledScenes:false,autoAftermath:true}});assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.player.invincible,true);assert.equal(calls,0);assert.equal(r.state.astraWorld.flags.pendingAftermath.input.invocation,true);
});
const durableStore=()=>{const values=new Map();return createStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},{lockManager:null});};
test('an empty optional prose body cannot veto a complete semantic law plan',async()=>{
 const o=setup(),runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>response([],[{type:'entity.update',targetId:'npc:lin-xiaoman',changes:{personality:'温和'}}])}});
 const r=await runner.runWorld({state:o.state,input:{action:'言出法随：让林小满变得温和'},settings:{mode:'groq',autoAftermath:true}});assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.characters['npc:lin-xiaoman'].personality,'温和');assert.ok(r.state.astraWorld.flags.pendingAftermath);
});
test('a bystander reply does not swallow the actual addressed character reaction',async()=>{
 const o=setup(),runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>response([{type:'dlg',name:'赵天霸',text:'我去门口看看，你们先说。'}])}});
 const r=await runner.runWorld({state:o.state,input:{action:'我向林小满伸手，扶住她的胳膊'},settings:{mode:'groq',narrativePolicy:'playable',autoAftermath:true}});assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.flags.pendingAftermath.targetId,'npc:lin-xiaoman');
});
test('a terminal dead cloud job gets a fresh aftermath identity, while genuine queued jobs keep theirs',async()=>{
 const o=setup(),requests=[];let dead=true;const runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async(_,r)=>{requests.push(r.transactionId);throw Object.assign(Error('temporarily unavailable'),dead?{code:'AI_TIMEOUT',terminalJob:true}:{code:'AI_QUEUE_PENDING'});}}});
 const first=await runner.runWorld({state:o.state,input:{action:'言出法随：让我无敌'},settings:{mode:'groq',autoAftermath:true}});
 const a=await runner.runAftermath({state:first.state,settings:{mode:'groq'}});assert.equal(a.terminalJob,true);assert.equal(a.state.astraWorld.flags.pendingAftermath.generation,1);dead=false;
 const b=await runner.runAftermath({state:a.state,settings:{mode:'groq'}});assert.notEqual(requests[0],requests[1]);assert.equal(b.state.astraWorld.flags.pendingAftermath.generation,1);
 await runner.runAftermath({state:b.state,settings:{mode:'groq'}});assert.equal(requests[1],requests[2]);assert.equal(b.state.astraWorld.player.invincible,true);
});
test('interrupted aftermath history is recovered once without replaying the effect or asking AI again',async()=>{
 const o=setup(),stateStore=durableStore(),history=createTranscriptStore({memory:new Map()});let calls=0,fail=false;
 const store={...history,appendTurn:async(id,turn)=>{if(fail&&turn.phase==='aftermath')throw Error('disk unavailable');return history.appendTurn(id,turn);}};
 const runner=createAiTurnRunner({stateStore,transcriptStore:store,aiClient:{narrate:async()=>{calls++;return response([{type:'dlg',name:'林小满',text:'你刚才身上怎么突然亮了一下？'}]);}}});
 const first=await runner.runWorld({state:stateStore.saveAuto('ai',o.state),input:{action:'言出法随：让我无敌'},settings:{mode:'groq',autoAftermath:true}});assert.equal(first.ok,true,first.error);
 fail=true;const interrupted=await runner.runAftermath({state:first.state,settings:{mode:'groq',narrativePolicy:'playable'}});assert.equal(interrupted.ok,false);assert.equal(interrupted.historyPending,true);
 assert.equal(stateStore.loadAuto('ai').astraWorld.player.invincible,true);assert.equal(stateStore.loadAuto('ai').transactionJournal.turn.phase,'aftermath');
 fail=false;const recovered=await runner.runAftermath({state:stateStore.loadAuto('ai'),settings:{mode:'groq'}});assert.equal(recovered.ok,true,recovered.error);assert.equal(calls,1);assert.equal(recovered.state.transactionJournal,null);assert.equal(recovered.state.memory.turnCount,first.state.memory.turnCount);assert.equal(recovered.state.astraWorld.minute,first.state.astraWorld.minute);assert.equal(recovered.state.astraWorld.flags.causalDebt,first.state.astraWorld.flags.causalDebt);
 assert.equal((await history.allTurns(o.state.journeyId)).filter(t=>t.phase==='aftermath').length,1);
});
test('an old in-flight aftermath cannot overwrite a newer save branch',async()=>{
 const o=setup(),stateStore=durableStore(),store=createTranscriptStore({memory:new Map()});let release;const gate=new Promise(r=>release=r);
 const runner=createAiTurnRunner({stateStore,transcriptStore:store,aiClient:{narrate:async()=>{await gate;return response([{type:'dlg',name:'林小满',text:'刚才那一下怎么回事？'}]);}}});
 const first=await runner.runWorld({state:stateStore.saveAuto('ai',o.state),input:{action:'言出法随：让我无敌'},settings:{mode:'groq',autoAftermath:true}});assert.equal(first.ok,true);
 const inFlight=runner.runAftermath({state:first.state,settings:{mode:'groq',narrativePolicy:'playable'}});await new Promise(r=>setTimeout(r,5));
 const newer=structuredClone(first.state);newer.revision++;newer.astraWorld.player.name='新分支';stateStore.saveAuto('ai',newer);release();const stale=await inFlight;
 assert.equal(stale.ok,false);assert.equal(stale.stale,true);assert.equal(stateStore.loadAuto('ai').astraWorld.player.name,'新分支');assert.equal((await store.allTurns(o.state.journeyId)).filter(t=>t.phase==='aftermath').length,0);
});
