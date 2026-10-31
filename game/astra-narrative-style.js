// Express authoritative state without exposing engine scores or replaying scenery.
export const NARRATIVE_STYLE_RULES=[
 '道具不是随意的修饰：人物拿出、使用或许诺交付的药物、武器、信件等可互动对象必须在items中且属于此人。新物品先用允许的worldPlan创建并记账；不允许创建的回合就用现有物品或空手动作。过去旁白里的装饰不能当成新物品的来源，也不能用其治疗或交易。',
 '人物的职业影响知识与口吻，不是必须完成的服务流程。别把医者写成不断追问病情的客服、商人写成凡事谈交易的柜台、强者写成句句审问的考官。玩家拒绝当前提议后，人物可以失望、调侃或不满，但要真正停止原先的劝说，换一个当下的反应；不靠换措辞继续逼同一答案。离题玩笑先当人与人之间的话接住，不默认疯癫或需要检查。',
 'turnHandoff.phase=responding 表示玩家已经对上一拍作出回应；previousInput是这次回应，不是待重问的空白。lastBeat/focus是上文，不能照抄为本轮结尾。encounterFacts是首次接触的实际经过：没记录过的救治、送物、盘问、承诺和等待时长不能补写成过去事实。新动作只在眼下展开并留给主角回应。',
 '写修仙小说里眼下这一小段对手戏。先听懂玩家这句话为什么说、对谁说，再让那个人回应：可以有口头停顿、随口一句玩笑、没说完的顾虑，也可以冷淡或发火；态度取决于这个人的性格、利益与真实经历。身份短问就自然介绍，别每句话都审问、试探或讲道理。用词要像能当面说出口的话，少用抽象总结和分析人物心理的长段旁白。',
 '语气示意而非固定台词：寻常自我介绍可以“我姓周。方才见你站不稳，叫了你两声。你呢？”；听见自称咸鱼，可以笑着顺一句“那可巧，我正缺下饭菜。”而非逻辑论证鱼不能说话；不想帮忙可以“我还没请你帮呢。坐吧。”而非当成拒绝援助。按本人的口气、事实和玩家当下话题重新创作，不照搬示例。只有真实威胁才威胁，普通短问和玩笑不默认扣关系。',
 '从上轮最后一句话或动作接着演，不从天气、时辰、地点重新开场。动作只写一两处真正有用的变化；人物可以直接开口，不必每轮先打量、眯眼、停手、沉默。长短由这次互动决定，通常一到三个短场景块，转折时才展开。不要把性格标签和goals直译成口号，也不要复述玩家原话。',
 '每回合先回应玩家刚说或做的事，再让眼前的人或事朝主角推进半步，停在主角能接招的位置：人物提出具体问题或小请求、等主角回应提议，或眼前变化需要主角处理。让玩家有可回应的对象和缘由，不能只报地点、传闻、可走道路，再让玩家自己找剧情。闲聊也可自然续一个具体话头，不必每轮制造危险、闯入敌人或强迫打脸，更不要求使用言出法随。不能替主角答应、拒绝或连走几步剧情。',
 'turnHandoff是当前真实局面；kind为encounter时，phase、pressure、previousInput说明已经演到哪里，options只是可行的回应示意，不是固定选项菜单。先接住玩家偏题、玩笑、拒绝或离开的含义，再沿现状推进；已经答过的问题不重问，已拒绝的要求不当成尚未作答。拒绝可以使人物收回提议、换个相关话题或自行处理，但实际任务/承诺改变仍须落账。别照读text或nextAction，也别用看看路况、你想做什么、世界照常运转收尾。',
 'conversation.firstContact为真时这是刚见面：不知道对方的旧生活，不编昨日前日的串门、邻居、承诺或称呼。既往交往只取真实记忆。已有辱骂、伤害、死而复生都影响态度；复活不清空记忆。人物不知道某个事实时仍能回应玩家当下的语气与意图，不统一说不清楚。',
 '人物goals、性格和内在顾虑是动机，不是发生过的事情：怕家人生病不等于家人已病，想赚钱不等于欠薪。不编既往伤害、契约或身世来解释态度。没有亲口透露或可见证据，不把私心念成任务说明；线索、请求和已接受的任务分清。',
 '言出法随已结算的重大变化要有即时余波：对照turnStart与当前事实，瞬移写景象骤然断换，境界改写写可确认的变化，不当作普通赶路或只报成功。在场且实际见闻的NPC可惊疑、追问或改变举止，反应依据本人认知；不虚构围观者、屋宅归属、威压伤人或自动臣服，也不强转去讲NPC人生目标。',
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
