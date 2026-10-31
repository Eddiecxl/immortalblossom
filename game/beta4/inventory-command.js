import {performInventoryAction} from '../game-engine.js';
import {useAstraInventory} from '../astra-inventory.js';
import {reconcileMainStory} from '../astra-main-story.js';
import {captureWorldChanges,propagateCausality} from '../astra-causality.js';
import {projectAstraWorld} from '../astra-turn.js';
// Same journal-first commit protocol as world turns; no network dependency.
export async function commitInventoryAction(state,command,{stateStore,transcriptStore}){
 if(state.transactionJournal)state=await stateStore.recoverPendingTurn('ai',state,transcriptStore);
 const turnId=globalThis.crypto?.randomUUID?.()||`inventory-${Date.now()}-${Math.random()}`;
 let result;
 if(state.astraWorld){
  let used;
  try{used=useAstraInventory(state.astraWorld,command,{turnId});}catch(error){return {ok:false,state,error:error.message};}
  captureWorldChanges(state.astraWorld,used.world,{turnId,action:'inventory'});propagateCausality(used.world);reconcileMainStory(used.world);
  result={ok:true,state:projectAstraWorld(state,used.world),blocks:[{type:'narr',text:used.summary}],summary:used.summary};
 }else result=performInventoryAction(state,command);
 if(!result.ok)return result;
 result.state.updatedAt=new Date().toISOString();
 const verb={equip:'装备',use:'使用',read:'阅读',inspect:'查看'}[command.action]||'查看';
 const turn={id:turnId,kind:'world',blocks:result.blocks,summary:result.summary||`${verb}${command.name}`,userText:`${verb}${command.name}`,createdAt:new Date().toISOString(),provider:'engine',model:'确定性物品结算'};
 let committed=await stateStore.saveAutoIfJourney('ai',{...result.state,transactionJournal:{type:'ai-world-turn',turn}},state.journeyId,state.revision);
 let historyPending=false;
 try{committed=await stateStore.recoverPendingTurn('ai',committed,transcriptStore);}catch{historyPending=true;}
 return {...result,state:committed,turn,historyPending};
}
