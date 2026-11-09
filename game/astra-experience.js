import{assertSafeData,worldEntity,evaluateCondition}from './astra-expression.js';
import{ensureSimulation,recordCausalEvent}from './astra-causality.js';
import{seedHash}from './astra-seed.js';
export function recordRealityExperience(world,op,context,index){
 assertSafeData(op);
 if(context.mode!=='reality')throw Error('亲身经历改写仅由明确言灵执行；普通互动仍按真实行动与人物反应结算。');
 if(Object.keys(op).some(k=>!['type','actorId','targetIds','kind','description','evidence','claims','durationMinutes','startsAfterMinutes'].includes(k)))throw Error('经历不能代替生死、资源或修为字段；请使用相应实体操作。');
 if(op.startsAfterMinutes!==undefined&&(!Number.isFinite(op.startsAfterMinutes)||op.startsAfterMinutes<0||op.startsAfterMinutes>525600))throw Error('经历开始时间无效。');
 if(op.durationMinutes!==undefined&&(!Number.isFinite(op.durationMinutes)||op.durationMinutes<0||op.durationMinutes>525600))throw Error('经历持续时间无效。');
 if((op.durationMinutes>0||op.startsAfterMinutes>0)&&!context.timedInteraction)throw Error('持续互动须与本轮实际推进的世界时间一起结算，不能仅写一个未来经历锁住人物。');
 const input=[context.input?.speech,context.input?.action,context.realityStatement].filter(Boolean).join(' ');
 if(typeof op.evidence!=='string'||!op.evidence.trim()||!input.includes(op.evidence))throw Error('经历须来自本轮明确指令原文。');
 if(!['contact','gesture','posture','sensation'].includes(op.kind)||typeof op.description!=='string'||!op.description.trim()||op.description.length>600)throw Error('经历仅记录接触、姿态、手势或感受；生死、修为、移动与资源须使用实际实体操作。');
 const actor=worldEntity(world,op.actorId),targets=op.targetIds;
 if(!actor||!['player',...Object.keys(world.characters)].includes(op.actorId)||!Array.isArray(targets)||targets.length>16||targets.some(id=>!worldEntity(world,id)))throw Error('经历的行动者或对象不存在。');
 for(const claim of op.claims||[])if(!evaluateCondition(world,{op:'eq',left:{entityId:claim.entityId,field:claim.field},right:claim.value}))throw Error('经历描述不能代替尚未执行的实际字段变更。');
 const sim=ensureSimulation(world);sim.experiences||={};const id=context.turnId.slice(0,60)+':exp:'+seedHash(world.seed,context.turnId+':'+index).toString(16);
 const locationId=actor.locationId||world.player.locationId;
 const minute=world.minute+(op.startsAfterMinutes||0);
 const fact={id,actorId:op.actorId,targetIds:[...new Set(targets)],kind:op.kind.trim(),description:op.description.trim(),state:'occurred',minute,locationId,sourceId:context.turnId,...(op.durationMinutes!==undefined?{durationMinutes:op.durationMinutes,endsAt:minute+op.durationMinutes}:{})};
 sim.experiences[id]=fact;const event=recordCausalEvent(world,{id,actorId:actor.id,action:'experience',targetIds:fact.targetIds,locationId,summary:fact.description,sourceId:context.turnId,impacts:[]});event.minute=minute;
 world.history.push({id,type:'experience',minute,locationId,actors:[actor.id,...fact.targetIds],summary:fact.description,playerWitnessed:!world.player.travel&&world.player.locationId===locationId});
 return fact;
}
