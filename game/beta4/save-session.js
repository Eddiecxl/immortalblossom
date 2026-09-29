import {validateImportedState} from '../game-state.js';

// Engine commits remain crash-safe every turn. Player checkpoints have their
// own cadence and an exact transcript boundary, independent of that journal.
export function createSaveSession({stateStore,transcriptStore,storage=localStorage,idFactory=()=>crypto.randomUUID(),nativeAction=globalThis.nativeAction}) {
 const key='luoxian_v33_checkpoint';let activeSlot=null,turns=0;
 function read(){const raw=storage.getItem(key);if(!raw)return null;const record=JSON.parse(raw);record.state=validateImportedState(record.state,'ai');return record;}
 async function checkpoint(state){
  if(state.transactionJournal)throw new Error('行记尚待恢复，请完成恢复后再保存。');
  const clean=validateImportedState(state,'ai');const history=await transcriptStore.allTurns(clean.journeyId);
  const latest=history.at(-1);
  const record={state:clean,endId:latest?.id||null,activeSlot,savedAt:new Date().toISOString(),
   provider:latest?.provider||'engine',model:latest?.model||'',worldMinute:clean.astraWorld?.minute??null,
   locationId:clean.astraWorld?.player?.locationId||null};
  if(typeof nativeAction==='function')await nativeAction('world-save',{record,turn:latest||null});
  storage.setItem(key,JSON.stringify(record));turns=0;return clean;
 }
 async function fork(state,endId){
  let history=await transcriptStore.allTurns(state.journeyId);
  if(endId!==undefined){const index=endId===null?-1:history.findIndex(t=>t.id===endId);if(endId&&index<0)throw new Error('存档行记边界缺失，请保留命簿并重试。');history=history.slice(0,index+1);}
  const next=validateImportedState({...state,journeyId:idFactory(),revision:0,transactionJournal:null},'ai');
  await transcriptStore.importTurns(next.journeyId,history);
  return next;
 }
 return {
  async initialize(){
   let browser=null;try{browser=read();}catch{}
   if(typeof nativeAction==='function'){
    const durable=await nativeAction('world-load',{});
   if(durable?.state){durable.state=validateImportedState(durable.state,'ai');
     if(!browser||durable.state.journeyId!==browser.state.journeyId||durable.state.revision>=browser.state.revision){
      storage.setItem(key,JSON.stringify(durable));browser=durable;
     }else await nativeAction('world-save',{record:browser,turn:null});
    }else if(browser)await nativeAction('world-save',{record:browser,turn:null});
   }
   if(!browser){let old=stateStore.loadAuto('ai');if(old){if(old.transactionJournal)old=await stateStore.recoverPendingTurn('ai',old,transcriptStore);await checkpoint(old);}}
  },
  peek:()=>read()?.state||null,
  info:()=>({activeSlot,turns,checkpoint:read()}),
  async begin(state){activeSlot=null;await checkpoint(state);},
  async committed(state){turns++;await checkpoint(state);return true;},
  async save(state,slot=activeSlot){
   if(state.transactionJournal)throw new Error('行记尚待恢复，暂不能保存。');
   if(slot){await stateStore.saveJourneySlot('ai',slot,state,transcriptStore);activeSlot=slot;}
   await checkpoint(state);return state;
  },
  async load(slot){
   const record=slot?null:read();const snapshot=slot?stateStore.loadSlot('ai',slot):record?.state;
   if(!snapshot)throw new Error('这个存档为空。');
   const next=await fork(snapshot,slot?undefined:record.endId);
   const previous=stateStore.loadAuto('ai'),previousSlot=activeSlot;
   try{stateStore.saveAuto('ai',next);activeSlot=slot||record.activeSlot||null;await checkpoint(next);}
   catch(error){activeSlot=previousSlot;if(previous)stateStore.saveAuto('ai',previous);throw error;}
   return next;
  }
 };
}
