import{resolveAstraPronouns}from './astra-interaction.js';
const numeral=s=>{if(/^\d+$/u.test(s))return Number(s);const d={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};let total=0,value=0;for(const c of s){if(c==='十'||c==='百'){total+=(value||1)*(c==='十'?10:100);value=0;}else if(c in d)value=d[c];else return NaN;}return total+value;};
const duration=/([零一二两三四五六七八九十百\d]+)\s*(分钟|刻钟|小时|时辰|秒钟|秒|刻|天)/u;
const contacts='亲吻|舌吻|亲|拥抱|抱住|抱一抱|牵住|牵|握住|握|抚摸|摸|轻拍|拍|搂住|搂';
const gestures='挥手|鞠躬|跳舞|微笑|大笑|哭泣|站起|站起来|坐下|跪下';
// Whole clauses only. This compiler produces no guessed numeric/ownership or
// emotional effect; an unsupported clause sends the entire command to planning.
export function compileLocalInteraction(world,statement){
 const original=String(statement||'').replace(/^言出法随\s*[:：]?\s*/u,'').trim();
 if(!original||/如果|除非|只要|每当|一旦|不要|不许|别|假如|是否/u.test(original))return null;
 if(/同时/u.test(original)&&/然后|接着|再/u.test(original))return null;
 const people=Object.values(world.characters).filter(n=>n.name).sort((a,b)=>b.name.length-a.name.length);
 const aliases=new Map();let canonical=original;
 people.forEach((n,i)=>{if(canonical.includes(n.name)){const token='@'+i+'#';aliases.set(token,n.id);canonical=canonical.split(n.name).join(token);}});
 const refs=resolveAstraPronouns(world,original,world.flags.conversation?.npcId);let previous=refs.length===1?refs[0]:null;
 canonical=canonical.replace(/^(?:让我|使我|令我|我|本人|主角)/u,'');
 const clauses=canonical.split(/[，,。；;]+|然后|并且|同时|接着/u).map(s=>s.trim()).filter(Boolean),operations=[];let elapsed=0;
 for(let clause of clauses){
  clause=clause.replace(/^(?:再|我)/u,'');let minutes=0;const dm=clause.match(duration);
  if(dm){minutes=numeral(dm[1])*({分钟:1,刻钟:15,刻:15,小时:60,时辰:120,秒钟:1/60,秒:1/60,天:1440}[dm[2]]);if(!Number.isFinite(minutes)||minutes<0||minutes>525600)return null;clause=clause.replace(dm[0],'');}
  const contact=clause.match(new RegExp('^('+contacts+')(?:(@\\d+#)|([她他你]))?(?:的)?(?:脸颊|脸|手|双手|肩膀|肩头|额头|头发|胳膊|嘴唇)?(?:上)?(?:轻轻|一下|一口|一次|一会儿|一阵|不停|不放)?(?:至口水直流)?[！!？?\\s]*$','u'));
  const gesture=new RegExp('^(?:向)?(?:(@\\d+#)|([她他你]))?(?:'+gestures+')(?:一下|一次|一会儿)?[！!？?\\s]*$','u').test(clause);
  if(!contact&&!gesture)return null;
  const named=[...clause.matchAll(/@\d+#/gu)].map(m=>aliases.get(m[0])).filter(Boolean),pronoun=clause.match(/[她他你]/u)?.[0];
  const references=pronoun?resolveAstraPronouns(world,pronoun,previous):[];
  if(pronoun&&!named.length&&references.length!==1)return null;
  const targetId=named[0]||(pronoun?references[0]:previous);
  if(contact&&!targetId)return null;
  if(targetId){const n=world.characters[targetId];if(!n||n.travel||world.player.travel||n.locationId!==world.player.locationId)return null;previous=targetId;}
  let description=clause.replace(/@\d+#/gu,t=>world.characters[aliases.get(t)].name);
  if(contact&&!named.length)description=description.replace(new RegExp('^('+contacts+')[她他你]?','u'),(_,verb)=>verb+world.characters[targetId].name);
  if(minutes)description+=`，持续${dm[0]}`;
  operations.push({type:'experience.record',actorId:'player',targetIds:targetId?[targetId]:[],kind:contact?'contact':'gesture',description:world.player.name+description+'。',evidence:original,startsAfterMinutes:/同时/u.test(original)?0:elapsed,durationMinutes:minutes});
  elapsed+=minutes;
 }
 if(!operations.length)return null;
 return {type:'interaction',request:original,operations,elapsedMinutes:/同时/u.test(original)?Math.max(...operations.map(o=>o.durationMinutes||0)):elapsed};
}
