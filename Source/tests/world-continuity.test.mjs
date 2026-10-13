import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';
import {directAstraScene} from '../../game/astra-director.js';
import {scheduleEvent} from '../../game/astra-scheduler.js';
test('quiet turns never manufacture the same local rumor repeatedly across seeds',()=>{
 for(const seed of ['quiet-a','quiet-b','quiet-c']){
  const w=createGameState('旅人','ai',()=>seed).astraWorld;const summaries=[];
  for(let i=0;i<24;i++){w.minute+=5;const r=directAstraScene(w,[]);if(r.event)summaries.push(r.event.summary);}
  assert.equal(new Set(summaries).size,summaries.length,'repeated rumor for '+seed);
 }
});
test('explicit waiting advances real scheduled time and persists a turn without AI quota',async()=>{
 for(const seed of ['wait-a','wait-b','wait-c']){
  const state=createGameState('旅人','ai',()=>seed);let stored;
  scheduleEvent(state.astraWorld,{id:'test:scheduled-encounter',type:'lin_first_encounter',dueAt:state.astraWorld.minute+10,payload:{characterId:'npc:lin-xiaoman'}});
  const runner=createAiTurnRunner({aiClient:{narrate:async()=>{throw Error('AI must not be used for deterministic waiting');}},
   transcriptStore:{recentTurns:async()=>[],appendTurn:async(id,t)=>{stored=t;}}});
  const r=await runner.runWorld({state,input:{speech:'',action:'等待60分钟'},settings:{mode:'groq'}});
  assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.minute,state.astraWorld.minute+60);
  assert.equal(stored.provider,'engine');assert.ok(stored.blocks.length);assert.ok(r.state.astraWorld.history.some(e=>e.id==='test:scheduled-encounter'));
 }
});

test('narrative repair has its own stable request identity inside one world transaction',async()=>{
 const state=createGameState('旅人','ai',()=> 'repair-identity');const requests=[];
 const runner=createAiTurnRunner({aiClient:{narrate:async(settings,context)=>{
  requests.push(context);return requests.length===1?'invalid-json':JSON.stringify({blocks:[{type:'narr',text:'晨风吹过，我留意着眼前的变化。'}]});
 }},transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}}});
 await runner.runWorld({state,input:'这是一次普通问话。',settings:{mode:'groq'},transactionId:'world-tx'});
 assert.equal(requests.length,2);assert.notEqual(requests[0].transactionId,requests[1].transactionId);
 assert.ok(requests.every(r=>r.transactionId.startsWith('world-tx')));
});
