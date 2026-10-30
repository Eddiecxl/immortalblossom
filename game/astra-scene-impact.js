import {realmLabel} from './astra-rules.js';
import {seedHash} from './astra-seed.js';

const text=value=>String(value??'').replace(/[<>\u0000-\u001f]/gu,' ').trim().slice(0,100);
const worldOf=value=>value?.astraWorld??value;
const living=actor=>actor?.alive!==false&&!(Number.isFinite(actor?.health)&&actor.health<=0);
const place=(world,id)=>world.locations?.[id]?{id,name:text(world.locations[id].name)}:null;
const realm=(world,actor)=>({id:actor.cultivation?.realm||'none',
 name:text(realmLabel(world,actor.cultivation?.realm||'none')),level:Number(actor.cultivation?.level)||0});
const samePlace=(world,npc)=>!world.player.travel&&npc?.alive===true&&!npc.travel
 &&npc.locationId===world.player.locationId;
const row=(world,npc,perceivedHere)=>({id:npc.id,name:text(npc.name),
 location:place(world,npc.locationId||npc.lastKnownLocationId),perceivedHere});

/** Read-only author context. Actual snapshot differences are evidence; the
 * requested statement and optional sensory directions are not extra effects. */
export function describeSceneImpact(beforeValue,afterValue,{actionType,statement}={}) {
 const before=worldOf(beforeValue),after=worldOf(afterValue);
 if(!before?.player||!after?.player)return null;
 const a=before.player,b=after.player,kinds=[];
 const from=place(before,a.travel?.from||a.locationId),to=place(after,b.locationId);
 const moved=!b.travel&&Boolean(to)&&(a.locationId!==b.locationId
   ||Boolean(a.travel&&a.travel.to===b.locationId));
 const beforeRealm=realm(before,a),afterRealm=realm(after,b);
 const realmChanged=beforeRealm.id!==afterRealm.id||beforeRealm.level!==afterRealm.level;
 const playerLife={before:living(a),after:living(b)};
 const healthDelta=Number.isFinite(a.health)&&Number.isFinite(b.health)?b.health-a.health:0;
 const killed=[],revived=[];
 for(const [id,npc] of Object.entries(after.characters||{})) {
  const prior=before.characters?.[id];if(!prior)continue;
  if(prior.alive===true&&npc.alive===false)killed.push(row(after,npc,samePlace(before,prior)));
  if(prior.alive===false&&npc.alive===true)revived.push(row(after,npc,samePlace(after,npc)));
 }
 const identity={};
 for(const field of ['name','gender','occupation']) {
  const oldValue=field==='gender'?a.gender??a.sex:a[field];
  const newValue=field==='gender'?b.gender??b.sex:b[field];
  if(newValue!==undefined&&newValue!==oldValue)identity[field]={from:oldValue??null,to:text(newValue)};
 }
 if(after.terminal?.ended&&!before.terminal?.ended)kinds.push('terminal');
 if(playerLife.before!==playerLife.after)kinds.push('death-revival');
 if(moved)kinds.push(actionType==='teleport'||actionType==='reality'&&!a.travel?'teleport':'arrival');
 if(realmChanged)kinds.push('realm-change');
 if((killed.length||revived.length)&&!kinds.includes('death-revival'))kinds.push('death-revival');
 if(Object.keys(identity).length)kinds.push('identity');
 if(Boolean(a.invincible)!==Boolean(b.invincible))kinds.push('protection');
 if(healthDelta&&!kinds.length)kinds.push('health-change');
 if(!kinds.length)return null;
 const witnesses=Object.values(after.characters||{}).filter(npc=>samePlace(after,npc))
  .sort((x,y)=>String(x.id).localeCompare(String(y.id))).slice(0,6).map(npc=>({id:npc.id,name:text(npc.name)}));
 const sensorySuggestions=[];
 if(kinds.includes('teleport'))sensorySuggestions.push('可写瞬息换景的方向感与脚下落点；不凭空加入房屋、围观者、跌伤或天气。');
 if(kinds.includes('arrival'))sensorySuggestions.push('可写行程结束、认出目的地的短暂感受；未记录的沿途遭遇不是事实。');
 if(realmChanged)sensorySuggestions.push('可写气息与力量运转方式的变化；不额外创造雷劫、山崩、伤人或他人的敬畏。');
 if(killed.length||revived.length||playerLife.before!==playerLife.after)
  sensorySuggestions.push('只描写现场能够感知的生死变化；远处事件是世界记录，不伪装成亲眼见证。');
 if(Object.keys(identity).length)sensorySuggestions.push('可写对自身变化的短暂辨认，不替主角决定喜恶，不假定旁人认识旧身份。');
 return {kind:kinds[0],kinds,source:from,destination:to,beforeRealm,afterRealm,
  invincible:Boolean(b.invincible),healthDelta,playerLife,witnesses,
  killed:killed.slice(0,6),killedCount:killed.length,revived:revived.slice(0,6),revivedCount:revived.length,
  identity,sensorySuggestions,
  ...(after.terminal?.ended?{terminal:text(after.terminal.ending)}:{})};
}

/** Short grounded prose for engine-only turns. This does not replace an AI
 * response, speak for NPCs, create a new encounter, or mutate the world. */
export function conciseEngineAftermath(beforeValue,afterValue,options={}) {
 const after=worldOf(afterValue),impact=describeSceneImpact(beforeValue,after,options);
 if(!impact)return [];
 const pick=(label,lines)=>lines[seedHash(after.seed,`aftermath:${label}:${after.minute}`)%lines.length];
 const lines=[];
 if(impact.kind==='terminal') {
  lines.push(impact.playerLife.after?'这一刻之后，此世的命途已经走到终点。':'呼吸止住，眼前的景象一点点远去。');
  lines.push('一路发生的事留在命簿里，这一段人生已无须再续下去。');
 } else if(impact.playerLife.before!==impact.playerLife.after) {
  lines.push(impact.playerLife.after?'一口气重新涌进胸腔。呼吸回来了，先前断掉的感知也一点点接上。':'最后一口气散去，我再也无法维持眼前的视野。');
  lines.push(impact.playerLife.after?'我重新活在此世，先前发生的一切并没有被抹去。':'方才尚未结束的事情，停在了这具身体之外。');
 } else if(impact.kinds.includes('teleport')||impact.kinds.includes('arrival')) {
  const destination=impact.destination.name;
  lines.push(impact.kinds.includes('teleport')?pick('teleport',[
   `眼前的景物陡然一换，方才所在的${impact.source?.name||'原处'}已不在身边。我落脚的地方，是${destination}。`,
   `远近在一瞬间失去了意义。视野重新定下来时，我已经站在${destination}，这段距离被敕令直接越过。`
  ]):`这段路终于走完，${destination}已在眼前。脚步停下时，来路留在了身后。`);
  lines.push(impact.witnesses.length
   ?`${impact.witnesses[0].name}就在这处地方；此刻与我相隔的，已经是一段能当面说话的距离。`
   :`这里没有正在近旁停留的人。${destination}的实际处境，还要从眼前看清。`);
 } else if(impact.kinds.includes('realm-change')) {
  lines.push(impact.beforeRealm.id!==impact.afterRealm.id
   ?`气息在体内换了一种运行的方式，原先的${impact.beforeRealm.name}已成为过去；我如今身处${impact.afterRealm.name}。`
   :`气息流转间，此境中的修为已经不同于方才。变化真实地落在我身上，不是一个尚未兑现的念头。`);
  lines.push(pick('realm',['力量已经改变，眼前的人和事仍各有来由。下一步怎样用它，仍握在我自己手中。',
   '新的境界与我相随，先前经历过的事情却没有因此消失。此刻的我，已经能带着这份改变继续面对它们。']));
 } else if(impact.killedCount||impact.revivedCount) {
  const lost=impact.killed.filter(n=>n.perceivedHere),returned=impact.revived.filter(n=>n.perceivedHere);
  if(lost.length)lines.push(`${lost.map(n=>n.name).join('、')}的气息断了。方才还能作出回应的人，此刻已失去生机。`);
  if(returned.length)lines.push(`${returned.map(n=>n.name).join('、')}重新有了呼吸，生命回到原本的身体里。`);
  if(!lines.length)lines.push('敕令已落在指定的生死之上；变化发生的地方并不在我眼前。');
  lines.push('这次改变已经留下结果，先前的经历与牵连并没有一并消失。');
 } else if(impact.kinds.includes('identity')) {
  lines.push(impact.identity.name?`如今，我的名字是${impact.identity.name.to}。这个称呼落在我身上，先前的人生却仍是同一段人生。`
   :'敕令改写了我的身份，变化已经成为这具身体与此世经历的一部分。');
  lines.push('我仍记得方才发生的事；改变之后，下一句话和下一步仍由我自己决定。');
 } else if(impact.kinds.includes('protection')) {
  lines.push(impact.invincible?'护身的法则落定，伤害已无法再夺走我的性命。':'原先护住性命的法则收回，身体重新面对此世的伤害。');
  lines.push('眼前的事情并未因此替我作出决定，接下来怎样应对，仍在我手中。');
 } else {
  lines.push(impact.healthDelta>0?'身体的气息稳了下来，方才的虚弱正在退去。':'疼痛传来，身体的状态已经不如方才。');
  lines.push('这份变化留在身上，也会影响我接下来的行动。');
 }
 return lines.slice(0,3).map(line=>({type:'narr',text:line}));
}
