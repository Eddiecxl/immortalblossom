import {realmRank} from './astra-rules.js';
import {killNpc} from './astra-reality.js';
import {checkTerminalWorld} from './astra-terminal.js';
import {isSpeculativeInput} from './astra-causality.js';

export function parseCombatAction(world,text){
 const raw=String(text||'');
 const nonlethal=/制伏|制服|击晕|留活口/u.test(raw);
 const intended=nonlethal?raw.replace(/(?:但|并且|并|而且)?不杀(?:死)?[他她它]?/gu,''):raw;
 if(isSpeculativeInput(intended)||/我说|喊道|说道|不(?:想|要|会|打算)?(?:攻击|杀|打)|假如|如果/u.test(intended))return null;
 if(!/攻击|挥拳|出拳|砍向|刺向|轰向|击打|打倒|杀死|击杀|刺杀|自爆|自毁|制伏|制服|击晕/u.test(raw))return null;
 let npc=Object.values(world.characters).find(n=>n.name&&raw.includes(n.name));
 if(!npc&&/[他她]/u.test(raw))npc=world.characters[world.flags?.conversation?.npcId];
 const mode=/自爆|自毁/u.test(raw)?'self_destruct':/法术|火球|雷|冰锥|剑气|灵力/u.test(raw)?'spell':'physical';
 if(!npc&&mode!=='self_destruct')return null;
 if(world.player.travel)throw Error('仍在旅途中，无法攻击留在原地的人物。');
 if(npc&&(!npc.alive||npc.travel||npc.locationId!==world.player.locationId))throw Error('目标目前不在场，不能隔空攻击。');
 const skill=(world.player.techniques||[]).find(s=>s&&typeof s==='object'&&s.name&&s.known!==false&&raw.includes(s.name));
 return {actorId:npc?.id||null,mode,nonlethal:nonlethal||/不杀|留活口/u.test(raw),techniqueName:skill?.id||skill?.name};
}
function health(actor){actor.maxHealth=Math.max(1,Number(actor.maxHealth)||100);actor.health=Math.max(0,Math.min(actor.maxHealth,Number.isFinite(actor.health)?actor.health:actor.maxHealth));}
function power(world,actor,mode,technique){
 health(actor);const rank=Math.max(0,realmRank(world,actor.cultivation?.realm||'none'));
 const weapon=world.items[actor.equipment?.weapon];
 const equipped=weapon&&!weapon.destroyed&&weapon.ownerId===actor.id&&actor.inventory?.includes(weapon.id)&&weapon.durability>0;
 const skill=(actor.techniques||[]).find(s=>s&&typeof s==='object'&&(s.id===technique||s.name===technique)&&s.known!==false);
 const special=skill?Math.max(1,Math.min(8,Number(skill.combatMultiplier)||1)):1;
 const ratio=actor.health/actor.maxHealth;
 const injury=/critically|重伤/u.test(actor.physicalCondition||'')?.7:1;
 return Math.pow(5,Math.min(30,rank))*(1+Math.min(99,Number(actor.cultivation?.level)||0)*.025)*Math.max(.001,ratio)*injury*(equipped?1.3:1)*(mode==='spell'?1.2:mode==='self_destruct'?8:1)*special;
}
function damage(world,actor,amount,cause,nonlethal=false){
 if(actor.invincible)return 0;health(actor);const before=actor.health;
 if(nonlethal)actor.health=Math.max(1,actor.health-amount);
 else actor.health=Math.max(0,actor.health-amount);
 if(actor.health<=0){
  const ward=(actor.inventory||[]).map(id=>world.items[id]).find(item=>item&&!item.destroyed&&item.quantity>0&&item.ownerId===actor.id
   &&(/^item:talisman:/u.test(item.templateId||'')||(item.effects||[]).some(e=>e?.type==='prevent_lethal'&&e.charges!==0)));
  if(ward){
   const effect=ward.effects?.find(e=>e.type==='prevent_lethal'&&e.charges!==0);
   if(effect){effect.charges=Math.max(0,(Number(effect.charges)||1)-1);if(effect.charges===0)ward.quantity--;}else ward.quantity--;
   ward.destroyed=ward.quantity<=0;if(ward.destroyed)actor.inventory=actor.inventory.filter(id=>id!==ward.id);
   actor.health=Math.min(actor.maxHealth,Math.max(1,Number(effect?.restoreHealth)||Math.ceil(actor.maxHealth*.2)));
   ward.transferHistory||=[];ward.transferHistory.push({minute:world.minute,from:actor.id,to:ward.destroyed?null:actor.id,source:cause});
   world.history.push({id:cause+':ward:'+actor.id,type:'protection',minute:world.minute,locationId:world.player.locationId,actors:[actor.id],summary:ward.name+'挡下了致命一击，'+(ward.destroyed?'随即耗尽。':'其中一道护命印记散去了。'),playerWitnessed:true});
  }
  else if(actor.id==='player')actor.alive=false;else killNpc(world,actor,cause);
 }
 if(actor.alive&&actor.health<actor.maxHealth){actor.physicalCondition=actor.health/actor.maxHealth<=.25?'critically_injured':'injured';actor.injuries||=[];actor.injuries.push({sourceId:cause,minute:world.minute,severity:actor.health/actor.maxHealth<=.25?'severe':'wound'});actor.injuries=actor.injuries.slice(-12);}
 return Math.max(0,before-actor.health);
}
export function resolveCombatExchange(world,action,turnId){
 const id='battle:'+turnId,existing=world.history.find(e=>e.id===id);if(existing)return existing.result;
 const player=world.player,npc=world.characters[action.actorId];
 if(!player.alive||world.terminal?.ended)throw Error('此世已终结，无法继续战斗。');
 if(player.travel||(!npc&&action.mode!=='self_destruct')||npc&&(!npc.alive||npc.travel||npc.locationId!==player.locationId))throw Error('对手目前不在场。');
 const skill=(player.techniques||[]).find(s=>s&&typeof s==='object'&&s.known!==false&&(s.id===action.techniqueName||s.name===action.techniqueName));
 const skillCost=Math.max(0,Number(skill?.spiritCost)||0);
 if(skillCost){player.maxSpirit=Number(player.maxSpirit)||30;player.spirit=Number.isFinite(player.spirit)?player.spirit:player.maxSpirit;if(player.spirit<skillCost+(action.mode==='spell'?6:0))throw Error('灵力不足以施展这门绝技。');player.spirit-=skillCost;}
 if(action.mode==='spell'){
  if(realmRank(world,player.cultivation?.realm||'none')<1)throw Error('尚未引气，不能凭空施放普通法术；言出法随不受此限制。');
  player.maxSpirit=Math.max(1,Number(player.maxSpirit)||30);player.spirit=Number.isFinite(player.spirit)?player.spirit:player.maxSpirit;
  if(player.spirit<6)throw Error('灵力不足以施放此术。');player.spirit-=6;
 }
 const attack=power(world,player,action.mode,action.techniqueName),defence=npc?power(world,npc,'physical'):1;
 const damageToNpc=npc?damage(world,npc,Math.max(1,Math.round(24*attack/Math.max(.001,defence))),id,action.nonlethal):0;
 let damageToPlayer=0;
 if(action.mode==='self_destruct')damageToPlayer=damage(world,player,player.maxHealth+player.health,id+':self');
 else if(npc?.alive&&!(action.nonlethal&&npc.health===1))damageToPlayer=damage(world,player,Math.max(1,Math.round(22*power(world,npc,'physical')/Math.max(.001,attack))),id+':counter');
 if(npc){npc.relationships||={};npc.relationships.player=Math.max(-100,(Number(npc.relationships.player)||0)-25);}
 const winnerId=!player.alive?npc?.alive?npc.id:null:npc&&(!npc.alive||action.nonlethal&&npc.health===1)?'player':null;
 const summary=!player.alive?action.mode==='self_destruct'?'自爆撕裂了这具身躯，我的性命也在其中断绝。':'这一轮交锋中，我未能承受反击，性命断绝。':npc&&!npc.alive?npc.name+'在交锋中倒下，已无生息。':winnerId==='player'?npc.name+'已失去反抗能力，仍然活着。':npc?.invincible?'攻击被护身法则挡住，对方仍能还手。':!npc?'护命力量截住了致命的伤害，身上的余痛还在。':'攻势与反击已经交错，伤势留在身上，下一步仍由我决定。';
 const result={winnerId,damageToNpc,damageToPlayer,summary};world.history.push({id,type:'battle',minute:world.minute,locationId:player.locationId,actors:['player',npc?.id].filter(Boolean),summary,playerWitnessed:true,result});
 checkTerminalWorld(world);return result;
}
