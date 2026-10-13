import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveSession} from '../../game/beta4/save-session.js';
import {createGameState} from '../../game/game-state.js';
import {createStorage} from '../../game/storage.js';
import {createTranscriptStore} from '../../game/transcript-store.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';

function memoryStorage() {
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

test('native world database receives a committed state before the browser checkpoint',async()=>{
 const storage=memoryStorage();
 const state=createGameState('顾长生','ai',()=> 'journey-db');
 const turn={id:'turn-db',summary:'丹药已入囊中。',provider:'local'};
 let saved=null;
 const session=createSaveSession({storage,stateStore:{loadAuto:()=>null},transcriptStore:{allTurns:async()=>[turn]},
  nativeAction:async(action,payload)=>{if(action==='world-save'){saved=payload;assert.equal(storage.getItem('luoxian_v33_checkpoint'),null);}return null;}});
 await session.begin(state);
 assert.equal(saved.record.state.journeyId,'journey-db');
 assert.equal(saved.turn.summary,turn.summary);
 assert.ok(storage.getItem('luoxian_v33_checkpoint'));
});

test('native database restores a newer durable checkpoint on startup',async()=>{
 const storage=memoryStorage();
 const state=createGameState('顾长生','ai',()=> 'journey-db');
 const record={state:{...state,revision:4},endId:'turn-4',activeSlot:null,savedAt:new Date().toISOString()};
 const session=createSaveSession({storage,stateStore:{loadAuto:()=>null},transcriptStore:{allTurns:async()=>[]},
  nativeAction:async(action)=>action==='world-load'?record:null});
 await session.initialize();
 assert.equal(session.peek().revision,4);
 assert.equal(JSON.parse(storage.getItem('luoxian_v33_checkpoint')).endId,'turn-4');
});

test('existing browser checkpoint is imported into SQLite on first startup',async()=>{
 const storage=memoryStorage();
 const state=createGameState('顾长生','ai',()=> 'journey-old');
 const record={state,endId:null,activeSlot:null,savedAt:new Date().toISOString()};
 storage.setItem('luoxian_v33_checkpoint',JSON.stringify(record));
 let imported=null;
 const session=createSaveSession({storage,stateStore:{loadAuto:()=>null},transcriptStore:{allTurns:async()=>[]},
  nativeAction:async(action,payload)=>{if(action==='world-save')imported=payload;return null;}});
 await session.initialize();
 assert.equal(imported.record.state.journeyId,'journey-old');
 assert.equal(session.peek().journeyId,'journey-old');
});

test('failed durable save retains the committed browser turn and Continue preserves its journey',async()=>{
 const storage=memoryStorage(),stateStore=createStorage(storage),transcriptStore=createTranscriptStore({indexedDB:null});
 const initial=createGameState('旅人','ai',()=> 'offline-commit');let unavailable=false;
 const nativeAction=async()=>{if(unavailable)throw Error('offline');return null;};
 const session=createSaveSession({storage,stateStore,transcriptStore,nativeAction});
 stateStore.saveAuto('ai',initial);await session.begin(initial);
 const next=stateStore.saveAuto('ai',{...initial,revision:2,astraWorld:{...initial.astraWorld,minute:365}});
 await transcriptStore.appendTurn(next.journeyId,{id:'committed-turn',kind:'world',blocks:[{type:'narr',text:'变化已经结算。'}]});
 unavailable=true;await assert.rejects(()=>session.committed(next));
 const resumed=createSaveSession({storage,stateStore,transcriptStore,nativeAction});
 await resumed.initialize();const loaded=await resumed.load(null);
 assert.equal(loaded.astraWorld.minute,365);assert.equal(loaded.journeyId,'offline-commit');
 assert.equal(resumed.info().checkpoint.endId,'committed-turn');
});

test('a newer same-revision companion autosave is recovered before Continue',async()=>{
 const storage=memoryStorage(),stateStore=createStorage(storage),transcriptStore=createTranscriptStore({memory:new Map()});
 const initial=createGameState('旅人','ai',()=> 'companion-recover');initial.updatedAt='2026-01-01T00:00:00.000Z';
 let durable=null;
 const nativeAction=async(action,payload)=>action==='world-load'?structuredClone(durable):
  action==='world-save'?(durable=structuredClone(payload.record),{saved:true}):null;
 await createSaveSession({storage,stateStore,transcriptStore,nativeAction}).begin(initial);
 const runner=createAiTurnRunner({stateStore,transcriptStore,aiClient:{narrate:async()=>JSON.stringify({blocks:[{type:'sys',text:'宿主，我记住这次对话了。'}]})}});
 const answer=await runner.runSystem({state:initial,input:'记住这次对话',settings:{mode:'groq'}});
 assert.equal(answer.ok,true,answer.error);assert.equal(answer.state.revision,initial.revision);
 const resumed=createSaveSession({storage,stateStore,transcriptStore,nativeAction});
 await resumed.initialize();const loaded=await resumed.load(null);
 assert.deepEqual(loaded.systemCompanion.dialogueMemory,answer.state.systemCompanion.dialogueMemory);
 assert.equal(loaded.systemCompanion.bond,answer.state.systemCompanion.bond);
 assert.equal(loaded.astraWorld.minute,initial.astraWorld.minute);
 assert.equal(durable.endId,answer.turn.id);
});

test('companion checkpoint updates durable history without changing a manual slot or world time',async()=>{
 const storage=memoryStorage(),stateStore=createStorage(storage),transcriptStore=createTranscriptStore({memory:new Map()});
 const initial=createGameState('旅人','ai',()=> 'companion-checkpoint');stateStore.saveAuto('ai',initial);
 const writes=[];
 const session=createSaveSession({storage,stateStore,transcriptStore,nativeAction:async(action,payload)=>{
  if(action==='world-save')writes.push(structuredClone(payload));return null;
 }});
 await session.begin(initial);await session.save(initial,'slot1');
 const slotBefore=storage.getItem('luoying_v3_ai_slot1');
 const runner=createAiTurnRunner({stateStore,transcriptStore,aiClient:{narrate:async()=>JSON.stringify({blocks:[{type:'sys',text:'宿主，这份对话会留在命簿中。'}]})}});
 const answer=await runner.runSystem({state:initial,input:'记住我的选择',settings:{mode:'groq'}});
 assert.equal(answer.ok,true,answer.error);
 assert.equal(typeof session.checkpoint,'function','system chat needs a checkpoint that does not write the active manual slot');
 await session.checkpoint(answer.state);
 assert.equal(storage.getItem('luoying_v3_ai_slot1'),slotBefore);
 assert.equal(writes.at(-1).turn.id,answer.turn.id);assert.equal(writes.at(-1).turn.kind,'system');
 assert.equal(session.info().checkpoint.endId,answer.turn.id);
 assert.equal(session.peek().astraWorld.minute,initial.astraWorld.minute);
 assert.equal(session.peek().revision,initial.revision);
});

test('equal or older companion timestamps and different journeys never replace a checkpoint',async()=>{
 for(const [journeyId,updatedAt] of [['same-journey','2026-02-01T00:00:00.000Z'],
   ['same-journey','2026-01-01T00:00:00.000Z'],['another-journey','2026-03-01T00:00:00.000Z']]){
  const storage=memoryStorage(),stateStore=createStorage(storage),transcriptStore=createTranscriptStore({memory:new Map()});
  const initial=createGameState('旅人','ai',()=> 'same-journey');initial.updatedAt='2026-02-01T00:00:00.000Z';
  await createSaveSession({storage,stateStore,transcriptStore}).begin(initial);
  storage.setItem('luoying_v3_ai_auto',JSON.stringify({...initial,journeyId,updatedAt,
   systemCompanion:{...initial.systemCompanion,bond:99}}));
  const resumed=createSaveSession({storage,stateStore,transcriptStore});await resumed.initialize();
  assert.equal(resumed.peek().journeyId,initial.journeyId);
  assert.equal(resumed.peek().systemCompanion.bond,initial.systemCompanion.bond);
 }
});
