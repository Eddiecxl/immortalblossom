import{evaluateCondition}from './astra-expression.js';
import{parseInventoryCommand,reachableItemOptions,itemUsageOptions}from './astra-inventory.js';
const present=(w,n)=>n?.alive&&!n.travel&&!w.player.travel&&n.locationId===w.player.locationId;
const text=(s,n)=>typeof s==='string'?s.trim().slice(0,n):'';
function usable(w,id){
 if(id==='player')return true;
 if(w.characters[id])return present(w,w.characters[id]);
 const item=w.items[id];if(item)return !item.destroyed&&item.quantity>0&&(item.ownerId==='player'||present(w,w.characters[item.ownerId])||!item.ownerId&&item.locationId===w.player.locationId);
 if(w.locations[id])return id===w.player.locationId||w.edges.some(e=>e.from===w.player.locationId&&e.to===id&&!e.closed&&!w.locations[id].destroyed&&!w.locations[id].closed);
 if(w.quests[id])return ['available','active','mutated'].includes(w.quests[id].state);
 return false;
}
function checked(w,row){
 if(!row||typeof row!=='object')return null;const label=text(row.label,28),speech=text(row.speech,400),action=text(row.action,400);
 if(!label||(!speech&&!action)||/言出法随/u.test(speech+action))return null;
 const ids=Array.isArray(row.targetIds)?row.targetIds.slice(0,8):[];
 if(ids.some(id=>typeof id!=='string'||!usable(w,id)))return null;
 // Even an author omitting targetIds cannot keep a dead/departed named listener.
 if(Object.values(w.characters).some(n=>n.name&&(speech+action).includes(n.name)&&!present(w,n)))return null;
 if(action){try{const c=parseInventoryCommand(w,action);if(c){const item=w.items[c.itemId];if(['take','accept','decline'].includes(c.action)?!reachableItemOptions(w,item).some(o=>o.action===c.action):item.ownerId!=='player'||!itemUsageOptions(w,item).some(o=>o.action===c.action&&!o.disabled))return null;}}catch{return null;}}
 try{if(row.requires&&!evaluateCondition(w,row.requires))return null;}catch{return null;}
 return {label,...(speech?{speech}:{}),...(action?{action}:{}),targetIds:ids,...(row.requires?{requires:structuredClone(row.requires)}:{})};
}
export function rememberSceneChoices(world,rows,{turnId}={}){
 const choices=[];for(const row of Array.isArray(rows)?rows:[]){const c=checked(world,row);if(c&&!choices.some(x=>x.speech===c.speech&&x.action===c.action))choices.push(c);if(choices.length===4)break;}
 world.flags.playerChoices={sourceId:turnId,minute:world.minute,locationId:world.player.locationId,rows:choices};
}
export function sceneChoices(world){
 if(!world.player.alive||world.terminal?.ended)return [];
 if(world.player.travel){const n=Math.max(1,Math.ceil(world.player.travel.arriveAt-world.minute));return [{label:'继续这段行程',action:`等待${n}分钟`},{label:'看看沿途的情形',action:'观察路途'}];}
 const saved=world.flags.playerChoices;
 if(saved?.minute===world.minute&&saved.locationId===world.player.locationId){const rows=saved.rows.map(r=>checked(world,r)).filter(Boolean);if(rows.length)return rows;}
 const choices=[],scene=world.flags.playerScene,people=Object.values(world.characters).filter(n=>present(world,n));
 const npc=people.find(n=>n.id===scene?.actorId)||people.find(n=>n.id===world.flags.conversation?.npcId)||people[0];
 const last=scene?.state==='active'&&scene.locationId===world.player.locationId?String(scene.lastBeat||''):'';
 const offer=Object.values(world.simulation?.commitments||{}).find(c=>c.state==='pending'&&c.toId==='player'&&present(world,world.characters[c.fromId])&&world.items[c.itemId]?.ownerId===c.fromId);
 if(offer){const item=world.items[offer.itemId],name=world.characters[offer.fromId].name;choices.push({label:`收下${item.name}`,action:`从${name}手中收下${item.name}`,targetIds:[offer.fromId,item.id]},{label:'婉拒这份好意',speech:`多谢${name}，但这件${item.name}我先不收。`,targetIds:[offer.fromId,item.id]});}
 if(npc){const quoted=(last.startsWith(npc.name)?last.slice(npc.name.length).replace(/^[：:]/u,''):last).replace(/[\r\n]+/g,' ').slice(-36);
  choices.push({label:`接着和${npc.name}说`,speech:quoted?`你刚才说“${quoted}”，能再说清楚一点吗？`:`${npc.name}，我想和你聊聊。`,targetIds:[npc.id]},
   {label:'先说说自己的想法',speech:'先别急，我也有自己的想法。',targetIds:[npc.id]});
 }
 if(world.player.health<world.player.maxHealth&&/伤|药/u.test(last)){
  const medicine=(world.player.inventory||[]).map(id=>world.items[id]).find(i=>i&&!i.destroyed&&i.ownerId==='player'&&i.quantity>0&&i.effects?.some(e=>e.type==='heal'));
  if(medicine)choices.unshift({label:`用${medicine.name}处理伤势`,action:`使用${medicine.name}`,targetIds:[medicine.id]});
 }
 const road=world.edges.find(e=>e.from===world.player.locationId&&!e.closed&&!world.locations[e.to]?.destroyed&&!world.locations[e.to]?.closed);
 if(road)choices.push({label:`动身去${world.locations[road.to].name}`,action:`前往${world.locations[road.to].name}`,targetIds:[road.to]});
 if(!choices.length)choices.push({label:'仔细看看眼前的情形',action:'观察周围的人和可互动的事物'});
 return choices.slice(0,4);
}
export const SCENE_CHOICES_PROMPT='同一次JSON另给choices数组，2至3个当前最后一拍可选的自然回应，随玩家本轮意图和人物反应变化；不是固定的观察/修炼/等待菜单。每项{label:"短按钮文字",speech:"主角可说的原话"或action:"主角可做的具体动作",targetIds:[事实中相关的真实编号]}。每条约30字即可，不写长台词。不要全是同意或强推原路线，可解释、追问、拒绝、顺势互动或改话题。它们只是草稿，不代表玩家已经同意、做过或得到东西；不用言出法随作为普通推荐选项，不透露未揭示的事实。';
