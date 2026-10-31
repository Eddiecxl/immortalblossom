import {consumeGeneratedItem} from './astra-effects.js';
import {ITEM_TEMPLATES} from './astra-content.js';
const family=item=>String(item.templateId||'').split(':')[1]||item.category;
const medicine=new Set(['herb','medicine','heart-elixir','healing-pill','qi-pill']);
const weapons=new Set(['training-staff','short-knife','sword','saber','flying-sword','bow','spear','seal-blade','escort-saber','hunting-bow','soul-bell','life-artifact']);
const papers=new Set(['family-letter','manual','travel-pass','contract','map','void-chart','birth-record']);
export function itemUsageOptions(world,item){
 const kind=family(item),options=[];
 const passive=item.effects?.some(e=>e?.type==='prevent_lethal');
 if(!passive&&(medicine.has(kind)||item.generated&&item.effects?.some(e=>typeof e==='object')))options.push({action:'use',label:'使用'});
 if(weapons.has(kind)||['weapon','armor','accessory'].includes(item.category))options.push({action:'equip',label:'装备'});
 if(papers.has(kind))options.push({action:'read',label:'阅读'});
 if(kind==='talisman'||passive)options.push({action:'passive',label:'致命攻击时自动护身',disabled:true});
 options.push({action:'inspect',label:'查看用途'});return options;
}
export function useAstraInventory(source,command,{turnId='inventory:'+Date.now()}={}){
 const world=structuredClone(source),player=world.player;
 if(!player.alive||world.terminal?.ended)throw Error('此世已终结，不能使用物品。');
 const matches=Object.values(world.items).filter(i=>!i.destroyed&&i.quantity>0&&i.ownerId===player.id&&player.inventory.includes(i.id)&&(command.itemId?i.id===command.itemId:i.name===command.name));
 if(matches.length>1)throw Error('持有多件同名物品，请在背包中指定其中一件。');
 const item=matches[0];if(!item)throw Error('未持有这件物品。');
 const type=command.action,kind=family(item);let summary='';
 if(!itemUsageOptions(world,item).some(o=>o.action===type&&!o.disabled))throw Error('这是材料或被动道具，不能按消耗品使用；请查看用途。');
 if(type==='use'){
  if(item.generated){const used=consumeGeneratedItem(world,item.id);used.summary=used.event.applied===false?'丹药用尽了，当前境界的边界却没有松动。':'我用了'+item.name+'，药力随气息流转，身上的变化已经记下。';return used;}
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
