// Concrete promises are world data; dialogue alone never transfers ownership.
import { worldEntity, validateConditionReferences, evaluateCondition } from './astra-expression.js';
import { ensureSimulation, recordCausalEvent, companionNotification, isSpeculativeInput } from './astra-causality.js';

const fail=message=>{throw new Error(message);};
const clean=value=>String(value||'').replace(/[<>\u0000-\u001f]/gu,' ').trim().slice(0,240);
const present=(world,id)=>id==='player'?world.player.alive!==false&&!world.player.travel
  :!world.player.travel&&world.characters[id]?.alive&&!world.characters[id].travel&&world.characters[id].locationId===world.player.locationId;
const lost=new Set(['declined','withdrawn','expired','invalidated']);
export const commitmentLost=state=>lost.has(state);

export function transferOwnedItem(world,op,sourceId){
  const item=world.items[op.itemId], from=worldEntity(world,op.fromId), to=worldEntity(world,op.toId);
  if(!item||item.destroyed||item.quantity<=0||item.ownerId!==from?.id||!from?.inventory?.includes(item.id)
    ||!Array.isArray(to?.inventory)||to.alive===false||from.id===to.id)fail('物品转移的所有权或人物无效。');
  from.inventory=from.inventory.filter(id=>id!==item.id);
  to.inventory=[...new Set([...to.inventory,item.id])];
  item.ownerId=to.id;item.locationId=to.locationId;
  item.transferHistory||=[];
  item.transferHistory.push({from:from.id,to:to.id,minute:world.minute,source:sourceId});
  recordCausalEvent(world,{id:sourceId+':transfer:'+item.id,actorId:from.id,targetIds:[to.id],action:'give',
    locationId:world.player.locationId,summary:from.name+'将'+item.name+'交给'+to.name+'。',
    impacts:[{entityId:to.id,dimension:'resources',delta:0.2}]});
}
function changeState(world,offer,state,sourceId,reason){
  const previous=offer.state;
  offer.state=state;offer.updatedAt=world.minute;
  offer.stateHistory||=[];
  offer.stateHistory.push({from:previous,to:state,minute:world.minute,sourceId,reason:clean(reason)});
  const from=worldEntity(world,offer.fromId),to=worldEntity(world,offer.toId),item=world.items[offer.itemId];
  const labels={pending:'提出交付约定',fulfilled:'兑现交付约定',declined:'拒绝交付约定',withdrawn:'撤回交付约定',expired:'交付约定已过期',invalidated:'交付约定已失效'};
  recordCausalEvent(world,{id:sourceId+':commitment:'+offer.id+':'+state,actorId:offer.fromId,targetIds:[offer.toId,offer.itemId],
    locationId:offer.locationId,action:'commitment.'+state,summary:`${from?.name||offer.fromId}与${to?.name||offer.toId}关于${item?.name||offer.itemId}的${labels[state]}。`,sourceId,impacts:[]});
}
export function offerCommitment(world,op,context){
  const spec=op.offer;
  if(!spec||typeof spec.id!=='string'||!/^[a-zA-Z][a-zA-Z0-9:_-]{1,99}$/u.test(spec.id)
    ||['constructor','prototype','__proto__'].includes(spec.id)||worldEntity(world,spec.id))fail('交付约定编号无效或已存在。');
  const from=worldEntity(world,spec.fromId),to=worldEntity(world,spec.toId),item=world.items[spec.itemId];
  if(spec.toId!=='player'||!world.characters[spec.fromId]||!present(world,spec.fromId)||!present(world,'player')
    ||!from?.inventory?.includes(item?.id)||item?.ownerId!==from.id||item.destroyed||item.quantity<=0)
    fail('提出交付须有真实在场的物主、接收者和持有物品。');
  if(context.conversationTargetId&&context.conversationTargetId!==from.id)fail('交付约定不属于当前交谈人物。');
  const sim=ensureSimulation(world);
  if(Object.values(sim.commitments).some(row=>row.kind==='item-transfer'&&row.state==='pending'&&row.itemId===item.id))
    fail('同一件物品已有尚未结束的交付约定。');
  if(spec.condition)validateConditionReferences(world,spec.condition);
  const minutes=spec.durationMinutes;
  if(minutes!==undefined&&(!Number.isSafeInteger(minutes)||minutes<1||minutes>365*1440))fail('交付期限无效。');
  const offer={id:spec.id,kind:'item-transfer',fromId:from.id,toId:to.id,itemId:item.id,quantity:item.quantity,
    locationId:world.player.locationId,condition:spec.condition?structuredClone(spec.condition):null,
    expiresAt:minutes===undefined?null:world.minute+minutes,sourceId:context.turnId,createdAt:world.minute,
    state:'new',stateHistory:[]};
  sim.commitments[offer.id]=offer;
  changeState(world,offer,'pending',context.turnId,'人物提出，等待接收者决定');
}
export function respondCommitment(world,op,context){
  const offer=ensureSimulation(world).commitments[op.commitmentId];
  if(!offer||offer.kind!=='item-transfer'||offer.state!=='pending')fail('交付约定不存在或已经终止。');
  const input=(String(context.input?.speech||'')+' '+String(context.input?.action||'')).trim();
  if(typeof op.evidence!=='string'||!op.evidence.trim()||!input.includes(op.evidence))fail('交付决定缺少本轮原话证据。');
  if(!present(world,offer.fromId)||!present(world,offer.toId))fail('交付双方当前并不在场。');
  if(context.conversationTargetId&&context.conversationTargetId!==offer.fromId)fail('交付决定不属于当前交谈人物。');
  if(op.response==='accept'){
    if(op.actorId!==offer.toId||offer.sourceId===context.turnId)fail('不能替接收者接受本轮刚提出的交付。');
    if(isSpeculativeInput(input)||/(?:不拿|不收|不接|不接受|不要|拒绝)/u.test(input))fail('假设或拒绝不是接受交付。');
    if(offer.condition&&!evaluateCondition(world,offer.condition))fail('交付前置条件尚未满足。');
    if(offer.expiresAt!==null&&world.minute>offer.expiresAt)fail('交付约定已经过期。');
    const item=world.items[offer.itemId];
    if(item?.quantity!==offer.quantity)fail('约定的物品数量已改变，须重新协商。');
    transferOwnedItem(world,offer,context.turnId);
    changeState(world,offer,'fulfilled',context.turnId,op.evidence);
  }else if(op.response==='decline'){
    if(op.actorId!==offer.toId||isSpeculativeInput(input))fail('拒绝交付须由接收者作出真实决定。');
    changeState(world,offer,'declined',context.turnId,op.evidence);
  }else if(op.response==='withdraw'){
    if(op.actorId!==offer.fromId)fail('只有提出者能撤回自己的交付。');
    changeState(world,offer,'withdrawn',context.turnId,op.reason||op.evidence);
  }else fail('交付决定类型无效。');
}
export function reconcileCommitments(world){
  for(const offer of Object.values(world.simulation?.commitments||{})){
    if(offer.kind!=='item-transfer'||offer.state!=='pending')continue;
    const from=worldEntity(world,offer.fromId),to=worldEntity(world,offer.toId),item=world.items[offer.itemId];
    let state=null,reason='';
    if(from?.alive===false||to?.alive===false||!item||item.destroyed||item.quantity!==offer.quantity
      ||item.ownerId!==offer.fromId||!from?.inventory?.includes(item.id)){state='invalidated';reason='人物、物品或所有权已发生变化';}
    else if(offer.expiresAt!==null&&world.minute>offer.expiresAt){state='expired';reason='交付期限已过';}
    if(state){changeState(world,offer,state,'commitment-reconcile:'+world.minute,reason);
      companionNotification(world,offer.id+':'+state,'宿主，一项关于'+(item?.name||'物品')+'的交付约定已无法按原条件继续。',offer.id);}
  }
}
