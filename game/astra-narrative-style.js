// Express authoritative state without exposing engine scores or replaying scenery.
export const NARRATIVE_STYLE_RULES='承接上轮最后一个可见动作、话题与人物态度，直接写这次新的反应。没有换地点或明显环境变化，不重新介绍地点、时辰、天气，不用景物开场；recentTurns.narrativeOpening用于避开旧开头，不作范文。篇幅随互动变化：问候、身份短问或一声笑可以只用一两句动作与自然对白；重大转折才展开，不为凑字数描写晨雾、手指、眼皮或尘埃。人物像生活在这里的人，说话直接、具体、各有性格；先直接回答眼前问题，用具体事务或一句日常话体现性格。普通问候、询问身份、随意的口气和真正的侮辱或威胁轻重不同，不把短问自动当成挑衅，不用发疯、脑子有问题等斥责代替普通介绍。没有已记录的过去交往，不编出昨天见过、昔日许诺或相熟的经历。人物个性不等于人人傲慢、刻薄、多疑；不把每个问题变成试探、评估或讨价还价。不擅自规定主角内心、情绪或下一步选择。辱骂、威胁与和解依据真实关系、经历、利益和听闻反应；复活不清除先前记忆和恐惧，但不能无依据对陌生人怀恨。注意最后在场者、离开者、尸体和复活后的真实位置，不能写成大家消失或时间倒流。数值和评分只供引擎与面板使用；人物、旁白、系统用可感知的伤势、戒备、信任或险情表达，不朗读生命值、风险分数、好感点数、操作类型、因果代价或数据库措辞。价格、年龄、人数、日期等世界内自然数量可以正常说。dlg.text只有直接说的话；神态与动作另放narr，不夹引号外舞台说明。';
const normalize=text=>String(text||'').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
export function hasInternalMetric(text){
 return /(?:改写范围|实际代价)\s*[：:]|\b(?:kill_npc|resurrect_npc|social\.observe|entity\.update)\b|(?:危险程度|风险(?:评分|程度|等级)?|好感(?:度)?|信任(?:度)?|气血|生命值|灵力|安全度)[^。！？!?；\n]{0,10}(?:[\d一二三四五六七八九十百零〇]+\s*\/\s*\d+|(?:减少|增加|下降|上升|提升|降低|扣除|扣了|剩余|剩下|还剩|为|是|达|到|[:：])\s*[\d一二三四五六七八九十百零〇]+|[\d一二三四五六七八九十百零〇]+\s*(?:分|点))/u.test(String(text||''));
}
export function repeatsOpening(text,oldOpenings=[]){
 const line=normalize(text).slice(0,60);
 if(line.length<18)return false;
 return oldOpenings.some(old=>{
  const previous=normalize(old).slice(0,60);let prefix=0;
  while(prefix<Math.min(line.length,previous.length)&&line[prefix]===previous[prefix])prefix++;
  // A character name or a short connective does not count as repeated scenery.
  return prefix>=12&&prefix/Math.min(36,line.length,previous.length)>=.4;
 });
}
export function injuryNotice(before,after){
 if(!after.player.alive||after.terminal?.ended||after.player.health>=before.player.health)return null;
 return {type:'sys',text:after.player.health<=after.player.maxHealth*.25
  ?'先缓一缓。你伤得不轻，别再硬撑，找个安全的地方处理伤口。'
  :'你受了伤。疼痛还在，接下来小心些。'};
}
export function realityOutcomeText(plan,outcome,world){
 if(outcome?.applied===false)return '眼下已经是你指定的状态，言出法随没有再次改变它。';
 const npc=world.characters?.[plan.targetId];
 if(plan.type==='kill_npc'&&npc?.alive===false)return `${npc.name}的气息断了，身躯失去了生机。言出法随已经生效。`;
 if(plan.type==='resurrect_npc'&&npc?.alive)return `${npc.name}重新有了呼吸，已经活了过来。先前发生的事仍留在记忆里。`;
 if(plan.type==='numeric_mutation')return '言出法随改变了你指定的事物，变化已经发生。';
 return outcome?.summary||'言出法随已生效，你指定的改变已经发生。';
}
