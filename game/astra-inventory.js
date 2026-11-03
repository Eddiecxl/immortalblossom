import {consumeGeneratedItem} from './astra-effects.js';
import {ITEM_TEMPLATES} from './astra-content.js';
import {respondCommitment} from './astra-commitments.js';
import {reconcileQuestArcs} from './astra-quests.js';
const family=item=>String(item.templateId||'').split(':')[1]||item.category;
const medicine=new Set(['herb','medicine','heart-elixir','healing-pill','qi-pill']);
const weapons=new Set(['training-staff','short-knife','sword','saber','flying-sword','bow','spear','seal-blade','escort-saber','hunting-bow','soul-bell','life-artifact']);
const papers=new Set(['family-letter','manual','travel-pass','contract','map','void-chart','birth-record']);
const live=item=>item&&!item.destroyed&&item.quantity>0;
export function reachableItemOptions(world,item){
 if(!live(item)||!world.player.alive||world.player.travel)return [];
 if(item.ownerId==null&&item.locationId===world.player.locationId)return [{action:'take',label:'拾取'}];
 const offer=Object.values(world.simulation?.commitments||{}).find(o=>o.kind==='item-transfer'&&o.state==='pending'&&o.toId===world.player.id&&o.itemId===item.id);
 const owner=world.characters[item.ownerId];
 return offer&&offer.fromId===item.ownerId&&owner?.alive&&!owner.travel&&owner.locationId===world.player.locationId
  ?[{action:'accept',label:'收下'},{action:'decline',label:'谢绝'}]:[];
}
export function parseInventoryCommand(world,text){
 const verb=String(text||'').match(/服下|服用|吃下|吃掉|吞下|喝下|喝掉|使用|装备|穿上|戴上|拿起|捡起|拾取|收下|接受|谢绝|阅读|读信|查看/u)?.[0];
 if(!verb||/(?:交给|递给|送给|喂给)/u.test(text))return null;
 const matches=Object.values(world.items||{}).filter(live).map(item=>({item,score:Math.max(0,...[item.name,String(item.name||'').split('·')[0]].filter(Boolean).filter(n=>text.includes(n)).map(n=>n.length))})).filter(x=>x.score>0);
 if(!matches.length)return null;
 // Multiple explicitly named items belong to the open action planner. Do not
 // silently execute just the item with the longest name in a compound action.
 const named=matches.filter(x=>x.item.name&&text.includes(x.item.name));
 if(named.filter(x=>!named.some(y=>y!==x&&y.item.name!==x.item.name&&y.item.name.includes(x.item.name))).length>1)return null;
 const best=Math.max(...matches.map(x=>x.score)),candidates=matches.filter(x=>x.score===best);
 if(candidates.length>1)throw Error('有多件同名物品，请在行囊中选择具体那一件。');
 const item=candidates[0].item,owned=item.ownerId===world.player.id&&world.player.inventory.includes(item.id);
 const action=/谢绝/u.test(verb)?'decline':/收下|接受/u.test(verb)?'accept'
  :/捡起|拾取|拿起/u.test(verb)?owned?'inspect':reachableItemOptions(world,item).some(o=>o.action==='accept')?'accept':'take'
  :/装备|穿上|戴上/u.test(verb)?'equip':/阅读|读信/u.test(verb)?'read':verb==='查看'?'inspect':'use';
 return {itemId:item.id,action};
}
export function itemUsageOptions(world,item){
 const kind=family(item),options=[];
 const passive=item.effects?.some(e=>e?.type==='prevent_lethal');
 if(!passive&&(medicine.has(kind)||item.generated&&item.effects?.some(e=>typeof e==='object')))options.push({action:'use',label:'使用'});
 if(weapons.has(kind)||['weapon','armor','accessory'].includes(item.category))options.push({action:'equip',label:'装备'});
 if(papers.has(kind)||['book','document','manual','letter','map'].includes(item.category))options.push({action:'read',label:'阅读'});
 if(kind==='talisman'||passive)options.push({action:'passive',label:'致命攻击时自动护身',disabled:true});
 options.push({action:'inspect',label:'查看用途'});return options;
}
export function useAstraInventory(source,command,{turnId='inventory:'+Date.now()}={}){
 const world=structuredClone(source),player=world.player;
 if(!player.alive||world.terminal?.ended)throw Error('此世已终结，不能使用物品。');
 if(['take','accept','decline'].includes(command.action)){
  const item=world.items[command.itemId];
  if(!reachableItemOptions(world,item).some(o=>o.action===command.action))throw Error('这件物品当前不在可拿取的位置，或尚未有有效赠予；不能直接拿走他人的东西。');
  let summary;
  if(command.action==='take'){
   item.ownerId=player.id;item.locationId=player.locationId;player.inventory=[...new Set([...player.inventory,item.id])];
   item.transferHistory||=[];item.transferHistory.push({minute:world.minute,from:null,to:player.id,source:turnId});
   summary='我拾起'+item.name+'，收进行囊。';
  }else{
   const offer=Object.values(world.simulation.commitments).find(o=>o.itemId===item.id&&o.state==='pending'&&o.toId===player.id);
   const evidence=(command.action==='accept'?'收下':'拒绝')+item.name;
   respondCommitment(world,{commitmentId:offer.id,actorId:player.id,response:command.action==='accept'?'accept':'decline',evidence},{turnId,input:{action:evidence},conversationTargetId:offer.fromId});
   summary=command.action==='accept'?'我接过'+item.name+'，将它收好。':'我谢绝了这份赠予，'+item.name+'仍留在对方手中。';
  }
  reconcileQuestArcs(world);
  const event={id:turnId,type:command.action==='decline'?'item_declined':'item_acquired',minute:world.minute,locationId:player.locationId,actors:[player.id],itemId:item.id,summary,playerWitnessed:true};world.history.push(event);return {world,event,summary};
 }
 const matches=Object.values(world.items).filter(i=>!i.destroyed&&i.quantity>0&&i.ownerId===player.id&&player.inventory.includes(i.id)&&(command.itemId?i.id===command.itemId:i.name===command.name));
 if(matches.length>1)throw Error('持有多件同名物品，请在背包中指定其中一件。');
 const item=matches[0];if(!item)throw Error('未持有这件物品。');
 const type=command.action,kind=family(item);let summary='';
 if(!itemUsageOptions(world,item).some(o=>o.action===type&&!o.disabled))throw Error('这是材料或被动道具，不能按消耗品使用；请查看用途。');
 if(type==='use'){
  if(item.generated)return consumeGeneratedItem(world,item.id);
  if(kind==='qi-pill'){
   player.maxSpirit=Number(player.maxSpirit)||30;player.spirit=Number.isFinite(player.spirit)?player.spirit:player.maxSpirit;
   if(player.spirit>=player.maxSpirit)throw Error('灵力已满，无需浪费丹药。');player.spirit=Math.min(player.maxSpirit,player.spirit+20);
  }else{
   if(player.health>=player.maxHealth)throw Error('目前伤势已愈，气血已满，无需浪费药物。');
   player.health=Math.min(player.maxHealth,player.health+30);player.physicalCondition=player.health===player.maxHealth?'healthy':player.health/player.maxHealth<=.25?'critically_injured':'injured';if(player.health===player.maxHealth)player.injuries=[];
  }
  item.quantity--;item.destroyed=item.quantity<=0;if(item.destroyed)player.inventory=player.inventory.filter(id=>id!==item.id);
  item.transferHistory||=[];item.transferHistory.push({minute:world.minute,from:player.id,to:null,source:turnId});summary=kind==='qi-pill'?'丹药化开，枯涩的灵力渐渐续上。':'药力渐渐化开，身上的疼痛轻了些。';
 }else if(type==='equip'){
  player.equipment||={};player.equipment[item.category==='armor'?'armor':item.category==='accessory'?'accessory':'weapon']=item.id;summary='我将'+item.name+'装备妥当，接下来的交锋会用上它。';
 }else if(type==='read'){
  player.knowledge=[...new Set([...(player.knowledge||[]),item.id])];summary=item.description||'我仔细读过'+item.name+'，其中的内容已经记下。';
 }else{
  const template=ITEM_TEMPLATES.find(t=>t.id===item.templateId);summary=item.description||({talisman:'随身持有即可在致命攻击时护住性命，触发后会消耗。',rope:'可用于攀援、捆扎或具体任务；查看并不消耗绳索。','iron-ore':'这是锻造材料，交付或制作时才会使用。'}[kind])||'这件'+(template?.name||item.name)+'仍归我持有。它可用于对应的装备、任务、交易或制作，不会因查看而消耗。';
 }
 const event={id:turnId,type:type==='use'?'item_consumed':type==='read'?'item_read':type==='equip'?'item_equipped':'item_inspected',minute:world.minute,locationId:player.locationId,actors:['player'],itemId:item.id,summary,playerWitnessed:true};world.history.push(event);return {world,event,summary};
}
