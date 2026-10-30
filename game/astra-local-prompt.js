// A compact view for small local models. The full Engine packet remains authoritative.
import { worldPlanPrompt } from './astra-plan-prompt.js';
import { compactNarrativePacket } from './astra-narrative-budget.js';
import {NARRATIVE_STYLE_RULES} from './astra-narrative-style.js';
export function buildAstraLocalMessages(packet, visibleEvents = [], modelName = '', repairErrors = []) {
  const compactPacket=compactNarrativePacket(packet);
  const encounterNpc=packet.turnHandoff?.kind==='encounter'
    ?(packet.presentNpcs||[]).find(npc=>npc.id===packet.turnHandoff.targetId):null;
  const speakingNpc=[...(packet.presentNpcs||[]),...(packet.departingNpcs||[])].find(npc=>npc.id===packet.conversation?.targetId);
  const focus=speakingNpc?`\n这一次主角在对${speakingNpc.name}说话。对话里的“你”指${speakingNpc.name}，“我”指主角；人物dlg里的“我”才指人物本人。${speakingNpc.name}的身份是${packet.affordances?.role||speakingNpc.occupation||''}，后台动机是${packet.affordances?.goal||speakingNpc.goals?.join('、')||'尚未明确'}，性格是${speakingNpc.personality||'依事实中的表现'}。后台动机用来判断态度，不代表主角已知，也不是自动生成的任务。先站在这个人物的立场作判断，再写出回应，不反过来替玩家回答。此刻是第${packet.clock?.day||1}日${packet.clock?.period||''}，${String(packet.clock?.hour??'').padStart(2,'0')}:${String(packet.clock?.minute??'').padStart(2,'0')}；未来计划不能写成眼下已经发生。`:'';
  const heldReferences=(packet.items||[]).filter(item=>item.ownerId===packet.conversation?.targetId
    &&String(item.name||'').split('·')[0].length>=2
    &&String(packet.playerTurn?.text||packet.playerTurn?.speech||'').includes(item.name.split('·')[0]));
  const delivery=heldReferences.length===1?heldReferences[0]:null;
  const priorOffer=delivery&&(packet.simulationFacts?.commitments||[]).find(offer=>offer.state==='pending'
    &&offer.itemId===delivery.id&&offer.fromId===packet.conversation.targetId);
  const deliveryGuide=!delivery?'':priorOffer
    ? `\n此物真实交付约定是${priorOffer.id}，不能再新建。玩家明确接收时用commitment.respond:{commitmentId:"${priorOffer.id}",actorId:"player",response:"accept",evidence:"本轮原话片段"}；仅问去向不等于接收。`
    : `\n本轮涉及该人物真实持有的${delivery.name}，没有既有交付约定。人物若决定归还/赠予，使用这个真实绑定示例：${JSON.stringify({worldPlan:{operations:[{type:'commitment.offer',offer:{id:'offer:'+String(packet.playerTurn?.turnId||'next-turn').slice(0,70),fromId:delivery.ownerId,toId:'player',itemId:delivery.id}}]},blocks:[{type:'dlg',name:packet.conversation.targetName,text:'我愿意把这件东西交给你，请你自己决定是否收下。'}]})}。人物可拒绝或尚未决定，那就不要许诺已决定归还。玩家声称过去答应不是真实承诺；新提案不能本轮自动替玩家接受。示例中的选择不是强制，须依据人物处境。`;
  const facts = {
    minute: packet.minute,
    narrativeContinuity:packet.narrativeContinuity,
    clock: packet.clock,
    turnStart: packet.turnStart,
    location: packet.location,
    player: packet.player,
    cultivationRule: packet.cultivationRule,
    numericFacts: packet.numericFacts,
    planMode: packet.planMode,
    settledAction: packet.settledAction,
    simulationFacts: packet.simulationFacts,
    items: packet.items,
    playerTurn: packet.playerTurn,
    conversation: packet.conversation,
    affordances: packet.affordances,
    presentNpcs: packet.presentNpcs,
    departingNpcs:packet.departingNpcs,
    activeQuests: packet.activeQuests,
    dueEvents: packet.dueEvents,
    recentHistory: packet.history?.slice(-4),
    // Keep the conversational boundary without feeding a previous answer back
    // as the most recent prose exemplar for small models to copy.
    recentTurns: compactPacket.recentTurns,
    recalledSummaries:packet.recalledSummaries,
    rumors: packet.rumors,
    directorHook: packet.directorHook,
    turnHandoff: packet.turnHandoff,
    settledEvents: visibleEvents
  };
  const system = '你是《落仙》的中文叙事作者。只根据给定的引擎事实写本回合，不能新增职业、人物、身份、委托、物品、地点、行动结果或知识。presentNpcs 才是眼前真实人物；传闻不等于在场人物的身份、职业或委托。不得把传闻里的事安在眼前人物身上。玩家说“我来帮你”时，结合真实goals、activeQuests和turnHandoff已发生的遭遇回应；眼前有人刚求助就承接求助，不再反问想帮什么。没有求助事实时可按当前处境商量，不凭空制造任务。conversation.targetId 有值时，该在场人物必须回应玩家本轮含义；未知事实可以坦言，但仍接住问候、困惑或玩笑，不用一句不清楚结束场面。玩家原话由游戏展示，不要复述，不要写“我说，”。不得替玩家决定行动或发言。引擎已结算的事件不得重算。只输出严格 JSON，不要 effects、代码围栏或额外文字。';
  const shape = packet.planMode === 'reality'
    ? '本轮是玩家明确发动言出法随：先将指令翻译为 worldPlan，再写结果。必须同时返回 worldPlan 与 blocks；仅返回 blocks 是无效回复。支持的字段改写无需再次确认。示例格式（使用事实包中的实际目标 ID 和玩家要求的字段）：{"worldPlan":{"operations":[{"type":"entity.update","targetId":"事实包中的实体ID","changes":{"gender":"玩家指定的新性别"}}]},"blocks":[{"type":"narr","text":"我亲眼见到已结算的改变。"}]}。性别/姓名/职业/目标改写已经受 Engine 支持，不得用 concept.defer 回避这些字段。'
    : packet.departingNpcs?.some(npc=>npc.id===packet.conversation?.targetId)
    ? '本轮是动身人物的最后回应。写1–3个块，必须含conversation.targetName的dlg；用departingNpcs的真实身份与记忆回答新输入，交代离开。worldPlan.operations用空数组，不给已离开的人social.observe、物品交付或任务决定。'
    : packet.conversation?.targetId
    ? '本轮写 1–3 个块，必须含被问人物的 dlg，name 等于 conversation.targetName；可以用一句新的所见反应承接，不重放旧景物。理解本轮语义与人物判断，用worldPlan.operations中的social.observe记录，valence可为0；另有赠予或任务决定时也给对应操作。格式：{"worldPlan":{"operations":[{"type":"social.observe","observerId":"conversation.targetId的实际值","subjectId":"player","meaning":"本轮英文语义","evidence":"原话片段","valence":0,"reason":"人物的判断"}]},"blocks":[{"type":"dlg","name":"在场人物姓名","text":"针对本轮的具体回答"}]}。每块不超过 120 字。玩家只说“？”或表达困惑时，解释所在地点、自己身份、已知线索；这不是未知具体问题，不要只答不清楚。想帮忙时，围绕真实 goals 商量具体方案；若提出委托，必须用有效 quest.create 落账后再叙述，不能口头假装已经有任务。目标、传闻与已接受的任务是三种不同状态。不要把英文原始字段读给玩家，译成自然中文。'
    : packet.presentNpcs?.length && packet.playerTurn?.speech
    ? '本轮写1–3个块。玩家未指定对象时，在场听者可以根据本轮话语自然回应；不得让缺席者回答，也不强迫所有人回应。dlg.name必须是真正在场人物；narr使用第一人称所见。不要把离题输入强拉回当前任务。'
    : encounterNpc
    ? `眼前遭遇尚在进行，${encounterNpc.name}真实在场。即使玩家本轮只做动作，人物也可以根据实际所见接着回应或发问；用narr/dlg连续写到主角下一次回应前。dlg.name用${JSON.stringify(encounterNpc.name)}，只写这个人的直接话语。不重复开场要求，不替主角答应；已结算动作不重做。`
    : '本轮只写 1–2 个 narr 块，旁白必须使用主角第一人称所见；不复述玩家原话或 recentTurns 景物。格式：{"worldPlan":{"operations":[]},"blocks":[{"type":"narr","text":"第一人称当前结果"}]}。每块不超过 100 字。普通动作若交付物品且对方收下，必须用resource.transfer落账；不能写成对方已接过却operations为空。也可以拒绝，但要明确写没有完成；settledAction已结算的使用/移动不要重复提案。';
  const repair = (packet.player?.travel ? '\n玩家尚在旅途：player.locationId 是记录用出发地，不能写成仍在原地或已经抵达，不得让两端居民说话。请按 affordances 与剩余时间叙述路途。' : '')
    +(packet.departingNpcs?.length?'\n departingNpcs是本轮发言时在场、随后动身的对象。用其真实记忆作最后回应并交代离开，不能忘记刚才的交谈；下一轮不再把此人当作在场。':'')
    +(/决定|后果|接下来|下一步/u.test(packet.playerTurn?.text||packet.playerTurn?.speech||'')?'\n玩家问已作决定的后果：依据当前归属、约定、任务和关系说明已发生的变化；没有另一个已约定的行动，就说明尚未另作约定。不重说上一轮的归属答句，不重新自我介绍，也不编造新的后果。':'')
    + (repairErrors.length ? `\n上一候选未通过事实校验：${repairErrors.join('；').slice(0, 240)}。仅纠正这些错误。` : '');
  const noThink = /^qwen3(?:[.\-]|\d)/iu.test(String(modelName).split(/[\\/]/u).at(-1)) ? '\n/no_think' : '';
  const planPrompt = worldPlanPrompt(packet.planMode);
  const writer='\n写一段正在发生的修仙小说互动，让人物有自己的判断，而非客服问答。根据这次输入、性格、目标和先前态度作选择：可以揶揄、拒绝、动摇、讨价还价或主动提出有真实依据的下一步。用新的所见反应与对白连续展开；感官、停顿、神态可以丰富，但不改变已登记的事实。只问自己的想法时回答人物自己的顾虑和打算，不反问玩家的想法。澄清玩笑后承接澄清，道歉不立即抹掉已有不满。不要每次结尾都问玩家想做什么。篇幅随场面变化，可以写2–5块、几段连贯文字，不套固定长度和固定句式；简短输入也能有内容。真正的交付、承诺或任务变化仍必须落账，不替主角作决定。';
  const authorShape=packet.planMode!=='reality'&&speakingNpc&&!speakingNpc.travel
    ? '本轮是小说场面，不是单句问答。用narr/dlg块按发生顺序展开，篇幅随当前交谈变化，不设最低字数，不要求每次补旁白。受问人物dlg要自然、具体，name等于conversation.targetName。narr写人物这次新的反应，dlg体现这个人物自己的判断和态度。输出严格JSON，顶层为worldPlan和blocks；blocks每项仅用type、text（正文）、name（仅dlg）与可选claims。narr从主角的我所见所闻来写，不写玩家、他心想或替主角作选择；dlg.text只含人物直接说出的话，神态和动作另放narr，不在对白里写某某开口道。少量可观察动作即可，不要每轮重复布景；worldPlan.operations理解本轮语义，有社会认知变化用social.observe（中性valence可为0），重要交付/任务变化用相应操作。避免用泛泛的反问代替回应；人物拒绝、协商或主动提出真实可行的行动都可以。'
    : shape.replace('每块不超过 120 字。','').replace('每块不超过 100 字。','');
  const boundedFacts=compactNarrativePacket({...facts,conversation:packet.conversation});
  return [
    { role: 'system', content: system.replace('不能新增职业、人物、身份、委托、物品、地点、行动结果或知识。', '不能在文字中自行新增职业、人物、身份、委托、物品、地点、行动结果或知识；新变化需要有效的 worldPlan。') + '\n' + planPrompt + '\n' + authorShape + writer + NARRATIVE_STYLE_RULES + (packet.departingNpcs?.length?'':deliveryGuide) },
    { role: 'user', content: `引擎事实：${JSON.stringify(boundedFacts)}${repair}\nrecentTurns是先前交谈的记录，不是重新播放的范文；recalledSummaries是本地SQLite召回，不需另一次AI请求。奇怪、离题、粗俗或暧昧也有本轮含义，人物可以拒绝；不要把每句话都解读为问任务。只问自己想法时根据本人的goals/性格回答，不再质疑已经澄清的玩笑。问过去说过什么时检索真实听闻记忆，不用“不清楚”回避已经听见的话。turnStart为行动前，当前事实为结算后；途中等待不是在目的地等候。未登记物件不补材质/出处，猜想不是事实。${focus}\n现在只回应以下本轮新输入，旧回应不作范文：${JSON.stringify(packet.playerTurn)}${noThink}` }
  ];
}
