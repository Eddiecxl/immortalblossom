import {performInventoryAction} from '../game-engine.js';
import {consumeGeneratedItem} from '../astra-effects.js';
import {projectAstraWorld} from '../astra-turn.js';
// Same journal-first commit protocol as world turns; no network dependency.
export async function commitInventoryAction(state,command,{stateStore,transcriptStore}){
 if(state.transactionJournal)state=await stateStore.recoverPendingTurn('ai',state,transcriptStore);
 const generated=Object.values(state.astraWorld?.items||{}).find(item=>item.generated&&!item.destroyed
  && item.ownerId===state.astraWorld.player.id&&item.name===command.name);
 let result;
 if(generated&&command.action==='use'){
  const used=consumeGeneratedItem(state.astraWorld,generated.id);
  result={ok:true,state:projectAstraWorld(state,used.world),blocks:[{type:'sys',text:used.summary}],summary:used.summary};
 }else result=performInventoryAction(state,command);
 if(!result.ok)return result;
 const turn={id:globalThis.crypto?.randomUUID?.()||`inventory-${Date.now()}-${Math.random()}`,kind:'world',blocks:result.blocks,summary:result.summary||`在${result.state.story.location}${command.action==='equip'?'装备':'使用'}${command.name}，物品状态已由命簿结算。`,userText:`${command.action==='equip'?'装备':'使用'}${command.name}`,createdAt:new Date().toISOString(),provider:'engine',model:'确定性物品结算'};
 let committed=await stateStore.saveAutoIfJourney('ai',{...result.state,transactionJournal:{type:'ai-world-turn',turn}},state.journeyId,state.revision);
 let historyPending=false;
 try{committed=await stateStore.recoverPendingTurn('ai',committed,transcriptStore);}catch{historyPending=true;}
 return {...result,state:committed,turn,historyPending};
}
