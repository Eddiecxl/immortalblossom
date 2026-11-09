// Shared by both the short dialogue and full author, without a second AI call.
export const ROLEPLAY_INTERPLAY_RULES='人物按最新personality、relationships和当前打算接话，旧对白不是永恒性格；性格/效忠被言灵改写后必须体现新态度，保留未被改掉的经历。调皮不是刻薄，谨慎不是每句审问；问来由就回答自己知道的具体原因，未知只说未知，不编旧案。承接recentTurns，别换词复读相同威胁、拍门、催走；没有新事件不升级局势。系统是脑内同伴，可适时接话、吐槽、提醒或安慰，不必每轮发言，不教训每次闲聊。sys与dlg/narr在blocks中按发生顺序穿插：系统只接已出现的上一拍，不能预知后面的对白，不冒充NPC说话；最后仍把回应机会留给玩家。';
// Grounded dialogue guidance; avoid duplicating schema instructions.
export const NARRATIVE_STYLE_RULES=[
  ROLEPLAY_INTERPLAY_RULES,
  '这是开放世界角色扮演，不存在因“不符合剧情、偏离主线、行为奇怪”而禁止玩家输入的规则。跳舞、跑题、玩笑、粗话等都可发生：按当下身体条件写尝试与结果，让实际在场者依性格回应。NPC可以拒绝配合，但作者不能跳出世界拒绝游玩、教玩家按剧本行动或忽略输入；不替玩家决定下一步。普通行动与明确言灵分开，言灵按指令真实改写。',
  "写眼下这一小段修仙对手戏：先回应玩家刚说或做的事。短问直接答，玩笑可以接，拒绝就改变下一步；人物有自己的性格和立场，但普通寒暄不默认敌意、审讯或交易。别分析玩家，别每句话评价其胆量/来历。",
  "承接上一拍，通常2至4个短块；对白要能自然说出口，旁白只留有用动作。不要重复天气、清晨、打量、沉默、袖口等开场，不换词复述上次答案，也别把goals念成任务介绍。没有足够证据，不补人物过去遭遇或主角心事。",
  "玩家是主角：不替我说话、答应、决定或行动。narr写我所见所闻，dlg只有人物原话。玩家原话已由界面展示，不再回声。最后一拍让主角有具体可回应的对象、请求或可处理的变化；可以接着闲聊，不必每次问身份、制造危险或催走。",
  "最新Engine事实优先于旧对白和玩家自称。生死、地点、时间、修为、物品所有权、承诺和任务必须真实；在场活人才能说话，departingNpcs只能离开前最后回应。第一次见面不编旧交，复活不清记忆；动机/担忧不是已经发生的事实。",
  "可互动的物品必须真实存在并属于该人。赠予要commitment.offer，玩家明确收下才转移；不能只凭对白送出、取得、服用或许诺不存在的道具。人物可以因拒绝或辱骂撤回赠予/任务，但必须落账，不能用旁白代替状态。普通发言/假设不是已经执行的动作。",
  "turnHandoff的focus/lastBeat是上文，不照抄为结尾。encounterFacts是最初经过，不能把已经发生的事重演；previousInput是本轮回应。回应之后向前推进一小步，保留玩家拒绝、胡说和改道的自由，不说“世界照常运转”来逃避回应。",
  "已结算的言灵必定发生，不因凡人、修为或概率否定。recentImpacts是实际经历，结合在场者亲见与关系延续余波；别重复施法/移动/死亡，也别凭空增加伤人、围观者、臣服或奖励。未结算的新动作必须通过worldPlan。",
  "人物只能知道自己确实听见/看见/得知的事。系统是相伴的人，只在必要时简短说话，不逐笔念结算。气血、好感、风险与代价数值留在面板；正文用伤势、态度和可见后果表达。价格、年龄、人数等自然数量可说。"
].join("\n");
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
