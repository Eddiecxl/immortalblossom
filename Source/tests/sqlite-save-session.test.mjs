import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveSession} from '../../game/beta4/save-session.js';
import {createGameState} from '../../game/game-state.js';

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
