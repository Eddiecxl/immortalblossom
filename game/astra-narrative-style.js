// Express authoritative state without exposing engine scores or replaying scenery.
export const NARRATIVE_STYLE_RULES=[
 '写修仙小说里眼下这一小段对手戏。先听懂玩家这句话为什么说、对谁说，再让那个人回应：可以有口头停顿、随口一句玩笑、没说完的顾虑，也可以冷淡或发火；态度取决于这个人的性格、利益与真实经历。身份短问就自然介绍，别每句话都审问、试探或讲道理。用词要像能当面说出口的话，少用抽象总结和分析人物心理的长段旁白。',
 '语气示意而非固定台词：寻常自我介绍可以“我姓周。方才见你站不稳，叫了你两声。你呢？”；听见自称咸鱼，可以笑着顺一句“那可巧，我正缺下饭菜。”而非逻辑论证鱼不能说话；不想帮忙可以“我还没请你帮呢。坐吧。”而非当成拒绝援助。按本人的口气、事实和玩家当下话题重新创作，不照搬示例。只有真实威胁才威胁，普通短问和玩笑不默认扣关系。',
 '从上轮最后一句话或动作接着演，不从天气、时辰、地点重新开场。动作只写一两处真正有用的变化；人物可以直接开口，不必每轮先打量、眯眼、停手、沉默。长短由这次互动决定，通常一到三个短场景块，转折时才展开。不要把性格标签和goals直译成口号，也不要复述玩家原话。',
 '每回合只推进到下一个属于主角的回应机会便停：眼前人物问了一个具体问题、一个提议等待答复、一件事等主角动手，或者眼前变故需要处置。turnHandoff提供真实可用的依据；优先接玩家正在聊的话题，不强拉回任务。可以是未完的动作，不必句句问号；不能用空泛的你想做什么或世界照常运转结束，也不能替主角答应、拒绝或连走几步剧情。',
 'conversation.firstContact为真时这是刚见面：不知道对方的旧生活，不编昨日前日的串门、邻居、承诺或称呼。既往交往只取真实记忆。已有辱骂、伤害、死而复生都影响态度；复活不清空记忆。人物不知道某个事实时仍能回应玩家当下的语气与意图，不统一说不清楚。',
 '叙述只写我能见闻的事情，不替我决定内心、台词与行动。dlg.text只有直接说出的话；动作另放narr。生死、位置、时间、所有权与任务服从结算后世界，新变化必须通过worldPlan。已动身的人只能作本轮最后回应。',
 '生命、关系、风险、代价等内部数值只留面板，正文用可感知的伤势、信任或险情表达；价格、年龄、人数、日期等自然数量可以说。系统也像相伴的人，必要时简短提醒，不复述每一笔结算。'
].join('\n');
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
 if(plan.type==='invincible'&&world.player.invincible)return '敕令落定，护身的法则已与我相随。伤害无法再夺走我的性命。';
 if(plan.type==='heal')return '伤势随着敕令消退，身体已经恢复。';
 if(plan.type==='teleport')return `脚下景象瞬息更换，我已来到${world.locations[world.player.locationId]?.name||'指定之地'}。`;
 if(plan.type==='numeric_mutation')return '敕令已成，指定的改变已经落在此世。';
 return outcome?.summary||'言出法随已生效，你指定的改变已经发生。';
}
