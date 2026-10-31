import {realmRank,realmLabel,effectiveRealmCap,advanceRealm} from './astra-rules.js';
import {isSpeculativeInput} from './astra-causality.js';

export function parseTrainingAction(world,text){
 const raw=String(text||'');
 if(!/修炼|打坐|引气入体/u.test(raw)||isSpeculativeInput(raw)||/不(?:想|要|会|打算)?(?:修炼|打坐)|攻击|杀死|击杀/u.test(raw))return null;
 const match=raw.match(/(\d+|一|二|两|三|半)\s*(?:个)?(分钟|小时|时辰|天|日)/u),numbers={一:1,二:2,两:2,三:3,半:.5};
 const amount=match?(numbers[match[1]]??Number(match[1])):1;
 const unit=match?.[2],minutes=match?amount*(unit==='小时'?60:unit==='时辰'?120:unit==='天'||unit==='日'?1440:1):60;
 return {type:'train',minutes:Math.max(1,Math.min(1440,Math.round(minutes)))};
}

// Progress is earned time, saved on the actor. Realm rules remain authoritative.
export function settleTraining(world,action,turnId){
 const id='training:'+turnId,prior=world.history.find(e=>e.id===id);if(prior)return prior.result;
 const p=world.player;
 if(!p.alive||p.health<=0||world.terminal?.ended)throw Error('生命已经终结，无法继续修炼。');
 if(p.travel)throw Error('仍在旅途中，需先停驻才能修炼。');
 const rank=realmRank(world,p.cultivation.realm),cap=realmRank(world,effectiveRealmCap(world,p));
 const minutes=Math.max(0,Math.min(1440,Number(action.minutes)||0));
 let applied=false,earned=0;
 if(rank<cap){
  earned=minutes*Math.max(.1,Math.min(1,p.health/p.maxHealth));
  p.cultivation.trainingMinutes=(Number(p.cultivation.trainingMinutes)||0)+earned;
  const required=120*Math.pow(4,Math.max(0,rank));
  if(p.cultivation.trainingMinutes>=required){
   const result=advanceRealm(world,p,1);applied=result.applied;
   if(applied)p.cultivation.trainingMinutes-=required;
  }
 }
 const summary=applied?'吐纳终于连成一线，我踏入了'+realmLabel(world,p.cultivation.realm)+'。':rank>=cap?'气息运转渐稳，眼下的境界已无进一步提升的余地。':'我结束这一轮吐纳。积下的功夫还在，尚未跨过下一道关。';
 const result={applied,earned,summary};
 world.history.push({id,type:applied?'breakthrough':'training',minute:world.minute,locationId:p.locationId,actors:['player'],playerWitnessed:true,summary,result});
 return result;
}
