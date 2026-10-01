import {ITEMS,QUESTS,REALMS,TECHNIQUES} from '../game-data.js';
export function inventoryRows(state){
 const assets=Object.values(state.rpg?.assets||{}).filter(a=>a.kind==='item');
 const names=new Set([...Object.keys(state.inventory?.items||{}),...Object.keys(state.inventory?.materials||{}),...assets.map(a=>a.name)]);
 return [...names].filter(Boolean).map(name=>{
  const copies=assets.filter(a=>a.name===name),live=copies.filter(a=>a.charges>0);
  const generated=Object.values(state.astraWorld?.items||{}).find(entry=>entry.generated&&!entry.destroyed
   &&entry.ownerId===state.astraWorld.player.id&&entry.name===name);
  const item=ITEMS[name]||generated||{};
  const chosen=live.at(-1)||copies.at(-1),asset=chosen?{...chosen,charges:live.reduce((sum,a)=>sum+a.charges,0),provenance:{...chosen.provenance,source:[...new Set(live.map(a=>a.provenance?.source).filter(Boolean))].join('、')||chosen.provenance?.source}}:null;
  const protection=live.length?`致命时自动触发并消耗一份护命；恢复气血比例：${[...new Set(live.map(a=>Math.round(a.restoreRatio*100)+'%'))].join('、')}。` : '';
  return {name,amount:Number(state.inventory?.items?.[name]||state.inventory?.materials?.[name]||0),description:protection||item.description||'旅途中取得的物品，具体用途以已确认的规则为准。',type:item.type||item.category||asset?.kind||'未知',asset,
   usable:Boolean(generated?.effects?.length)||(item.type==='consumable'&&Boolean(item.heal||item.qi)&&!asset),equippable:['weapon','armor','accessory'].includes(item.type)};
 }).filter(r=>r.amount>0||Number(r.asset?.charges)>0);
}
export function questRows(state){
 if(state.astraWorld?.quests)return Object.values(state.astraWorld.quests).map(q=>({
  id:q.id,title:q.title,status:({available:'可接取',active:'进行中',mutated:'待重议',completed:'已完成',failed:'已失败',expired:'已过期',invalidated:'已失效',abandoned:'已放弃','resolved-by-other':'已由他人解决'})[q.state]||q.state,
  description:q.summary||(q.primaryGoals||[]).join('；')||'任务状态已记入命簿。',progress:q.state==='completed'?'已完成':q.deadline?'期限：第'+(Math.floor(q.deadline/1440)+1)+'日':'等待条件达成'
 }));
 const rows=[];
 for(const [key,status] of [['active','进行中'],['completed','已完成'],['failed','已失败']])for(const value of state.quests?.[key]||[]){
  const id=typeof value==='string'?value:value.id,history=state.quests?.history?.[id]||{},data=QUESTS[id]||{};
  rows.push({id,status,title:data.title||value.title||history.title||id,description:data.description||value.description||history.description||'此项任务的状态已记入命簿。',progress:key==='completed'?'已完成':`${value.progress??history.progress??0} / ${value.target??history.target??data.target??1}`});
 }
 return rows;
}
export function characterRows(state){
 return {realm:REALMS[state.player?.realm]?.name||'未知',equipment:Object.entries(state.equipment?.slots||{}).filter(([,v])=>v),techniques:(state.techniques?.known||[]).map(name=>({name,description:TECHNIQUES[name]?.description||state.journeyWorld?.skills?.[name]?.description||'已掌握',equipped:state.techniques?.equipped?.includes(name)}))};
}
export function newLedgerEvents(before,after){const old=new Set((before.rpg?.ledger||[]).map(x=>x.id));return (after.rpg?.ledger||[]).filter(x=>!old.has(x.id));}
export function commitmentRows(state){
 const world=state.astraWorld;if(!world)return [];
 const name=id=>id==='player'?world.player.name:world.characters[id]?.name||'去向已变化';
 const labels={pending:'待接受',fulfilled:'已交付',declined:'已拒绝',withdrawn:'已撤回',expired:'已过期',invalidated:'已失效'};
 return Object.values(world.simulation?.commitments||{}).filter(row=>row.kind==='item-transfer'&&row.toId==='player')
  .sort((a,b)=>Number(b.state==='pending')-Number(a.state==='pending')||Number(b.createdAt||0)-Number(a.createdAt||0))
  .map(row=>({id:row.id,state:row.state,status:labels[row.state]||'待核实',fromName:name(row.fromId),
   itemName:world.items[row.itemId]?.name||'原物品',ownerName:world.items[row.itemId]?.destroyed?'已损毁':name(world.items[row.itemId]?.ownerId),
   description:row.state==='pending'?'提出赠予仍需收下；物品尚未进入行囊。':'决定和实际交付已经记入命簿。'}));
}
