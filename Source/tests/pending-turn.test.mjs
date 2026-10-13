import test from 'node:test';
import assert from 'node:assert/strict';
import {createPendingTurns} from '../../game/pending-turn.js';
test('cancel and reload resume the same input transaction at the same authoritative revision',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 let n=0;const state={journeyId:'seed-a',revision:8};const input={speech:'奇怪的问话',action:''};
 const route={mode:'groq',models:{groq:'qwen/model'}};
 const first=createPendingTurns(storage,()=>`tx-${++n}`).prepare(state,input,route);
 const resumed=createPendingTurns(storage,()=>`tx-${++n}`);
 assert.deepEqual(resumed.read(state).input,input);assert.equal(resumed.prepare(state,input,route).id,first.id);
 assert.notEqual(resumed.prepare({...state,revision:9},input,route).id,first.id);
});
test('different player input or branch never resumes a cached old world transaction',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 let n=0;const pending=createPendingTurns(storage,()=>`tx-${++n}`),state={journeyId:'seed-a',revision:0},route={mode:'groq'};
 const old=pending.prepare(state,{speech:'你好',action:''},route);
 assert.equal(pending.read({...state,journeyId:'seed-b'}),null);
 assert.notEqual(pending.prepare(state,{speech:'走吧',action:''},route).id,old.id);
 pending.clear();assert.equal(pending.read(state),null);
});
