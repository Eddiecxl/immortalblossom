import {worldPlanPrompt} from './astra-plan-prompt.js';
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,structuredClone(value[k])]));
// Only the author's view is small: the original world, exact command and full
// transaction validator are unchanged. Named remote targets keep their IDs.
export function realityAuthorMessages(world,packet,input,{lean=false}={}){
 const command={speech:input.speech||'',action:input.action||''},text=[command.speech,command.action].join('\n');
 const rows=[world.player,...Object.values(world.characters),...Object.values(world.locations),...Object.values(world.factions),...Object.values(world.items)];
 const global=/全世界|整个世界|天下|所有人|每个人|全部人物|一切生灵/u.test(text);
 const ids=new Set(rows.filter(e=>e.name&&text.includes(e.name)||global&&world.characters[e.id]).map(e=>e.id));
 for(const npc of packet.presentNpcs||[])if(!lean||npc.id===packet.conversation?.targetId)ids.add(npc.id);
 for(const id of world.player.inventory||[])if(!lean||text.includes(world.items[id]?.name))ids.add(id);
 const selected=rows.filter(e=>ids.has(e.id)&&e.id!=='player');
 const fields=['id','name','gender','personality','occupation','alive','destroyed','closed','locationId','homeId','factionId','cultivation','health','maxHealth','wealth','safety','power','stability','population','risk','ownerId','quantity','category','effects','goals','currentGoals','relationships','invincible'];
 const facts={command,focusId:packet.conversation?.targetId||null,minute:world.minute,player:pick(world.player,fields),targets:selected.map(e=>pick(e,fields)),cultivationRule:packet.cultivationRule,
  rules:Object.values(world.simulation?.rules||{}),worldRules:pick(world.rules,['spiritualEnergy','realmOrder','globalMaxRealmId']),currentLocation:pick(world.locations[world.player.locationId],['id','name','destroyed'])};
 const vocabulary=lean?'Operations: entity.update {targetId,changes:{name,gender,personality,occupation,physicalCondition,goals,currentGoals,health,maxHealth,wealth,alive,locationId,cultivation:{realm,level,maxRealmId},invincible,destroyed,closed}}; entity.create {kind:"character|item|faction|location",entity:{id,name,ownerId,quantity,category,effects,locationId,homeId}}; relation.upsert/remove {fromId,toId,kind:"member|attachment|trust",weight:-1..1}; rule.upsert {rule:{id,trigger,condition,effects}}. Effects: heal {target:"player",magnitude:"full"|number}, stat.delta {target:"player",field:"health|wealth|safety",magnitude:number}, cultivation.advance_major_realm {target:"player",magnitude:1..3}; condition:{op:"eq|ne|lt|lte|gt|gte|exists",left:{entityId,field},right:value}, all/any:{conditions:[]},not:{condition}. Every op needs type.':worldPlanPrompt('reality');
 return [{role:'system',content:'言出法随100%按明确范围实现，凡人也可用。只把本轮完整指令转换成原子worldPlan，不遗漏任何子句，不扩展未指定结果，不用concept.defer。不重复旧事件。personality可改性格，明确效忠可同时用trust关联；改变后当前性格/关系优先于旧态度。返回完整JSON {"blocks":[{"type":"narr","text":"一句简短结果"}],"worldPlan":{"operations":[]}}。用2至4个短blocks承接已发生的效果：实际在场者当场作出自然反应，sys可接着插话；不要只转述命令，不替玩家说话或选择。身体接触成功不等于自动改写对方的意愿或好感。Engine执行、保存和计算代价。'+vocabulary+'\nexperience.record {actorId,targetIds,kind:"contact|gesture|posture|sensation",description,evidence:本轮精确原文,claims?:[{entityId,field,value}]}：接触、姿态等没有已有数值字段的言灵结果也要记录实际发生的经历；不需要凭空改成受伤。生死、修为、持物、移动等已有字段仍须原实体操作，不能只用经历描述代替。'},
 {role:'user',content:JSON.stringify(facts)}];
}
