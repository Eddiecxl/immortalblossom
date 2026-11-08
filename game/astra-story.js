import {worldEntity,validateConditionReferences,evaluateCondition,assertSafeData} from './astra-expression.js';
import {recordCausalEvent} from './astra-causality.js';
const terminal=new Set(['resolved','declined','withdrawn','missed','cancelled']);
const fail=m=>{throw Error(m);};
function record(world,thread,state,sourceId,reason){
 thread.state=state;thread.updatedAt=world.minute;thread.stateHistory.push({state,minute:world.minute,sourceId,reason});
 const summary=`「${thread.title}」${({pending:'尚待回应',planned:'仍在计划中',accepted:'已答应，但尚未实际完成',resolved:'已经达成',declined:'已明确拒绝',withdrawn:'已撤回',missed:'已错过约定时辰',cancelled:'因相关人或地点变化而终止'})[state]}。`;
 const id=`story:${sourceId}:${thread.id}:${state}`;
 world.history.push({id,type:'story_state',minute:world.minute,locationId:thread.locationId,actors:thread.participants,summary,playerWitnessed:thread.visibility!=='private',storyId:thread.id,sourceId});
 if(thread.visibility!=='private')recordCausalEvent(world,{id,actorId:thread.ownerId,action:'story_state',targetIds:[thread.id],locationId:thread.locationId,summary,sourceId,impacts:[]});
 const npc=world.characters[thread.ownerId];if(npc){npc.memories||=[];npc.memories.push({id,eventId:id,summary,source:'story-plan',storyId:thread.id,minute:world.minute});}
}
export function proposeStory(world,spec,context={}){
 assertSafeData(spec);const sim=world.simulation||={};sim.storyThreads||={};
 if(spec&&typeof spec.summary==='string'&&context.mode!=='reality'){
  const named=Object.values(world.locations).filter(loc=>!loc.destroyed&&loc.name?.length>1&&spec.summary.includes(loc.name));
  if(named.length===1&&!world.locations[spec.locationId])spec={...spec,locationId:named[0].id};
 }
 if(spec?.time){
  const {dayOffset,hour,minute=0,durationMinutes=60}=spec.time;
  if(!Number.isSafeInteger(dayOffset)||dayOffset<0||dayOffset>365||!Number.isSafeInteger(hour)||hour<0||hour>23||!Number.isSafeInteger(minute)||minute<0||minute>59||!Number.isSafeInteger(durationMinutes)||durationMinutes<1||durationMinutes>1440)fail('邀约日期字段无效。');
  const startsAt=Math.floor(world.minute/1440)*1440+dayOffset*1440+hour*60+minute;
  spec={...spec,startsAt,dueAt:startsAt+durationMinutes};
 }
 if(!spec||!/^[a-zA-Z][a-zA-Z0-9:._-]{1,99}$/u.test(spec.id)||['constructor','prototype','__proto__'].includes(spec.id)||worldEntity(world,spec.id)||Object.hasOwn(sim.storyThreads,spec.id))fail('故事线索编号无效或已存在；旧邀约不能无故重开。');
 if(!['invitation','plan','clue','foreshadow'].includes(spec.kind)||typeof spec.title!=='string'||!spec.title.trim()||spec.title.length>100||typeof spec.summary!=='string'||!spec.summary.trim()||spec.summary.length>600)fail('故事线索内容无效。');
 const owner=worldEntity(world,spec.ownerId),loc=world.locations[spec.locationId];
 if(!loc||loc.destroyed)fail('邀约地点须用已存在地点的ID或人物homeId，不能把未登记茶馆当作地点。');
 if(!owner||world.player.travel||owner.id!=='player'&&(!owner.alive||owner.travel||owner.locationId!==world.player.locationId))fail('ownerId须为实际在场人物的ID，不是人物姓名；只有在场者可以提出邀约。');
 if(spec.dueAt!=null&&(!Number.isSafeInteger(spec.dueAt)||spec.dueAt<=world.minute||spec.dueAt>world.minute+365*1440))fail('计划时辰无效。');
 if(spec.startsAt!=null&&(!Number.isSafeInteger(spec.startsAt)||spec.startsAt<world.minute||spec.startsAt>world.minute+365*1440||spec.dueAt!=null&&spec.startsAt>spec.dueAt))fail('计划开始时辰无效。');
 const relative=[...spec.summary.matchAll(/明天|明早|明晚|明日|后天|后日|大后天/gu)].at(-1)?.[0];
 if(relative&&spec.startsAt!=null){const days=relative==='大后天'?3:['后天','后日'].includes(relative)?2:1;if(Math.floor(spec.startsAt/1440)-Math.floor(world.minute/1440)!==days)fail('邀约日期与说明不一致；明天请用time:{dayOffset:1,hour,minute,durationMinutes}，让Engine换算，不要自己计算绝对分钟。');}
 for(const condition of [spec.condition,spec.revealWhen])if(condition)validateConditionReferences(world,condition);
 const ids=[...new Set([spec.ownerId,'player',...(spec.participants||[])])];if(ids.length>16||ids.some(id=>!worldEntity(world,id)))fail('故事线索牵涉不存在的人或物。');
 const t={id:spec.id,kind:spec.kind,title:spec.title.trim(),summary:spec.summary.trim(),ownerId:spec.ownerId,locationId:spec.locationId,participants:ids,startsAt:spec.startsAt??world.minute,dueAt:spec.dueAt??null,condition:spec.condition?structuredClone(spec.condition):null,revealWhen:spec.revealWhen?structuredClone(spec.revealWhen):null,visibility:spec.visibility==='private'?'private':'public',stateHistory:[],createdAt:world.minute};
 sim.storyThreads[t.id]=t;record(world,t,t.kind==='invitation'?'pending':'planned',context.turnId||'proposed','人物提出，尚非已经发生');
 world.eventQueue||=[];for(const [kind,at]of [['start',t.startsAt],['deadline',t.dueAt==null?null:t.dueAt+1]])if(at!=null&&at>world.minute)world.eventQueue.push({id:`story-clock:${t.id}:${kind}`,type:'story_checkpoint',dueAt:at,priority:60,payload:{storyId:t.id}});
 return t;
}
export function respondStory(world,op,context={}){
 const t=world.simulation?.storyThreads?.[op.id];if(!t||terminal.has(t.state))fail('这条故事线索已经终止或不存在。');
 if(t.visibility==='private'&&t.ownerId!=='player'||t.dueAt!=null&&world.minute>t.dueAt)fail('尚未知晓或已经过期的邀约不能被提前答应。');
 const input=[context.input?.speech,context.input?.action].filter(Boolean).join(' '),e=op.evidence;
 if(typeof e!=='string'||!e.trim()||!input.includes(e)||/[?？]|如果|假如/u.test(e))fail('回应须有玩家本轮明确原话，不能替玩家选择。');
 if(!['accept','decline','withdraw'].includes(op.response))fail('回应方式无效。');
 if(op.response==='accept'&&/不去|不参加|不接受|拒绝|谢绝/u.test(e))fail('玩家拒绝不能被记成答应。');
 if(op.response==='accept'){
  const at=input.lastIndexOf(e),scope=input.slice(Math.max(0,at-8),at+e.length);
  if(/(?:还没|尚未|未曾|没有|没)(?:有)?(?:答应|同意|决定)|不去|不参加|不接受|拒绝|谢绝/u.test(scope))fail('尚未同意不能被记成答应。');
 }
 if(op.response==='accept'&&t.state==='accepted')return t;
 record(world,t,({accept:'accepted',decline:'declined',withdraw:'withdrawn'})[op.response],context.turnId||'response','玩家明确回应');return t;
}
export function reconcileStories(world){
 for(const t of Object.values(world.simulation?.storyThreads||{})){
  if(t.visibility==='private'&&t.revealWhen&&evaluateCondition(world,t.revealWhen))t.visibility='public';
  if(terminal.has(t.state))continue;const owner=worldEntity(world,t.ownerId),venue=world.locations[t.locationId];let state=null;
  if(['invitation','plan'].includes(t.kind)&&(!owner||owner.alive===false||!venue||venue.destroyed))state='cancelled';
  else if(t.kind==='invitation'&&t.state==='accepted'&&world.minute>=(t.startsAt??t.createdAt)&&!world.player.travel&&!owner.travel&&world.player.locationId===t.locationId&&owner.locationId===t.locationId&&(!t.condition||evaluateCondition(world,t.condition)))state='resolved';
  else if(t.kind!=='invitation'&&t.condition&&evaluateCondition(world,t.condition))state='resolved';
  else if(t.dueAt!=null&&world.minute>t.dueAt)state='missed';
  if(state)record(world,t,state,'reconcile:'+world.minute,'实际世界条件变化');
 }
}
export function storyView(world,{limit=12}={}){const all=Object.values(world.simulation?.storyThreads||{}).filter(t=>t.visibility!=='private');const chosen=limit===Infinity?all:[...all.filter(t=>!terminal.has(t.state)).slice(-8),...all.filter(t=>terminal.has(t.state)).slice(-4)];return chosen.map(t=>({id:t.id,kind:t.kind,title:t.title,summary:t.summary,state:t.state,ownerId:t.ownerId,locationId:t.locationId,startsAt:t.startsAt,dueAt:t.dueAt,condition:t.condition,participants:t.participants}));}
