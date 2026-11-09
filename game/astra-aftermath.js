import {migrateGameState}from './game-state.js';
import {projectAstraWorld}from './astra-turn.js';
import {narrateSettledScene}from './astra-settled-scene.js';
import {rememberPlayerScene}from './astra-player-scene.js';
import {selectAstraHandoff}from './astra-handoff.js';
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,structuredClone(v[k])]));
export function pendingAftermath(before,world,{turnId,input,actionType,impact,targetId}){
 const words=[input.speech,input.action].filter(Boolean).join(' '),target=Object.values(world.characters).find(n=>n.name&&words.includes(n.name));
 return {id:turnId+':aftermath',parentTurnId:turnId,input:structuredClone(input),targetId:targetId||target?.id||null,actionType,impact:structuredClone(impact||{}),generation:0,
  sourceWorld:{minute:before.minute,player:pick(before.player,['id','name','locationId','travel','cultivation','health','invincible']),
   characters:Object.fromEntries(Object.values(before.characters).filter(n=>n.locationId===before.player.locationId).map(n=>[n.id,pick(n,['id','name','alive','locationId','travel'])])),
   locations:{[before.player.locationId]:pick(before.locations[before.player.locationId],['id','name'])},flags:{recentSceneImpacts:structuredClone(before.flags?.recentSceneImpacts||[])}}};
}
export async function runAstraAftermath({source,settings={},aiClient,transcriptStore,stateStore,signal,onProgress=()=>{},now=Date.now}){
 let state=source;const mode=source?.mode==='v13'?'v13':'ai';
 try{
  if(state.transactionJournal){
   const journal=state.transactionJournal;if(!stateStore?.recoverPendingTurn)throw Error('命簿记录待恢复。');
   state=await stateStore.recoverPendingTurn(mode,state,transcriptStore);
   if(journal.turn?.phase==='aftermath')return {ok:true,state,blocks:journal.turn.blocks,turn:journal.turn,recovered:true};
  }
  const pending=state.astraWorld?.flags?.pendingAftermath;if(!pending)return {ok:true,state,blocks:[],alreadyDone:true};
  const recent=await transcriptStore.recentTurns(state.journeyId,6);onProgress('continuing');
  const authored=await narrateSettledScene({sourceWorld:pending.sourceWorld,world:state.astraWorld,state,input:pending.input,settings,
   transactionId:pending.id+':g'+pending.generation,aiClient,recent,signal,impact:pending.impact,handoff:selectAstraHandoff(state.astraWorld,{targetId:pending.targetId}),actionType:pending.actionType});
  if(signal?.aborted)throw Object.assign(Error('后续展示已停止，刚才的变化已保存。'),{code:'AI_CANCELLED'});
  authored.world.flags.pendingAftermath=null;rememberPlayerScene(authored.world,authored.blocks,{turnId:pending.id,input:{}});
  const committed=projectAstraWorld(state,authored.world,{advanceTurn:false});committed.updatedAt=new Date(now()).toISOString();
  committed.systemCompanion.dialogueMemory=[...(committed.systemCompanion.dialogueMemory||[]),...authored.blocks.filter(b=>b.type==='sys').map(b=>({role:'system',text:b.text}))].slice(-24);
  const turn={id:pending.id,kind:'world',phase:'aftermath',parentTurnId:pending.parentTurnId,blocks:authored.blocks,summary:'刚才行动的后续回应；没有再次发动或推进玩家回合。',createdAt:committed.updatedAt,provider:settings.provider||settings.mode||'groq',model:settings.model||''};
  onProgress('saving');
  if(stateStore){
   const journaled=migrateGameState({...committed,transactionJournal:{type:'ai-world-turn',turn}},mode);
   state=stateStore.saveAutoIfJourney?await stateStore.saveAutoIfJourney(mode,journaled,state.journeyId,state.revision):stateStore.saveAuto(mode,journaled)||journaled;
   await transcriptStore.appendTurn(state.journeyId,turn);
   const cleared=migrateGameState({...state,transactionJournal:null},mode);
   state=stateStore.saveAutoIfJourney?await stateStore.saveAutoIfJourney(mode,cleared,state.journeyId,state.revision,turn.id):stateStore.saveAuto(mode,cleared)||cleared;
  }else{await transcriptStore.appendTurn(state.journeyId,turn);state=migrateGameState(committed,mode);}
  return {ok:true,state,blocks:turn.blocks,turn,effectCommitted:true};
 }catch(error){
  try{const latest=stateStore?.loadAuto?.(mode);if(stateStore?.loadAuto&&(!latest||latest.journeyId!==state.journeyId||latest.revision!==state.revision))
    return {ok:false,state,blocks:[],effectCommitted:true,code:'AFTERMATH_STALE',stale:true,currentState:latest,error:'命簿已有更新，这段旧回应不会覆盖新进度。'};
  }catch{/* Preserve the existing journal on a temporary storage read failure. */}
  if((error.code==='AI_NARRATIVE_INVALID'||error.terminalJob)&&state.astraWorld?.flags?.pendingAftermath&&!state.transactionJournal){
   const next=structuredClone(state);next.astraWorld.flags.pendingAftermath.generation++;
   try{state=stateStore?.saveAutoIfJourney?await stateStore.saveAutoIfJourney(mode,next,state.journeyId,state.revision):next;}catch{
    let currentState;try{currentState=stateStore?.loadAuto?.(mode);}catch{/* Storage may still be unavailable. */}
    return {ok:false,state,blocks:[],effectCommitted:true,stale:true,currentState,code:'AFTERMATH_STALE'};
   }
  }
  return {ok:false,state,blocks:[],effectCommitted:true,code:error.code||'AFTERMATH_PENDING',status:error.status,
   error:'刚才的变化已保存，人物的后续回应还在接续。',retryAfterMs:error.retryAfterMs||0,
   diagnostics:{message:String(error.message||'').slice(0,1000)},
   narrativeInvalid:error.code==='AI_NARRATIVE_INVALID',terminalJob:Boolean(error.terminalJob),historyPending:Boolean(state.transactionJournal)};
 }
}
