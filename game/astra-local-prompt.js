// A compact view for small local models. The full Engine packet remains authoritative.
import { WORLD_PLAN_PROMPT } from './astra-plan-prompt.js';
export function buildAstraLocalMessages(packet, visibleEvents = [], modelName = '', repairErrors = []) {
  const recalling=/之前|刚才|记得|说过|答应|承诺|约定|上次|当时|过去/u.test(packet.playerTurn?.text||'');
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
    recentTurns: packet.recentTurns?.slice(recalling ? -6 : -2).map(turn=>({id:turn.id,userText:turn.userText,
      ...(recalling?{dialogue:(turn.blocks||[]).filter(b=>b.type==='dlg').map(b=>({name:b.name,text:b.text.slice(0,120)}))}:{})})),
    recalledSummaries:packet.recalledSummaries,
    rumors: packet.rumors,
    directorHook: packet.directorHook,
    settledEvents: visibleEvents
  };
  const system = '你是《落仙》的中文叙事作者。只根据给定的引擎事实写本回合，不能新增职业、人物、身份、委托、物品、地点、行动结果或知识。presentNpcs 才是眼前真实人物；传闻不等于在场人物的身份、职业或委托。不得把传闻里的事安在眼前人物身上。玩家说“我来帮你”时，只能根据该人物已登记的 goals 与 activeQuests 回答；没有求助事实时不得替人物新造求助或具体任务，可以请玩家说明想帮什么。conversation.targetId 有值时，该在场人物必须直接回答玩家本轮问话；不知道就明确说不知道，不要答非所问或重复旧话。玩家原话由游戏展示，不要复述，不要写“我说，”。不得替玩家决定行动或发言。引擎已结算的事件不得重算。只输出严格 JSON，不要 effects、代码围栏或额外文字。';
  const shape = packet.planMode === 'reality'
    ? '本轮是玩家明确发动言出法随：先将指令翻译为 worldPlan，再写结果。必须同时返回 worldPlan 与 blocks；仅返回 blocks 是无效回复。支持的字段改写无需再次确认。示例格式（使用事实包中的实际目标 ID 和玩家要求的字段）：{"worldPlan":{"operations":[{"type":"entity.update","targetId":"事实包中的实体ID","changes":{"gender":"玩家指定的新性别"}}]},"blocks":[{"type":"narr","text":"我亲眼见到已结算的改变。"}]}。性别/姓名/职业/目标改写已经受 Engine 支持，不得用 concept.defer 回避这些字段。'
    : packet.departingNpcs?.some(npc=>npc.id===packet.conversation?.targetId)
    ? '本轮是动身人物的最后回应。写1–3个块，必须含conversation.targetName的dlg；用departingNpcs的真实身份与记忆回答新输入，交代离开。worldPlan.operations用空数组，不给已离开的人social.observe、物品交付或任务决定。'
    : packet.conversation?.targetId
    ? '本轮写 1–3 个块，必须含被问人物的 dlg，name 等于 conversation.targetName；可以用一句新的所见反应承接，不重放旧景物。理解本轮语义与人物判断，用worldPlan.operations中的social.observe记录，valence可为0；另有赠予或任务决定时也给对应操作。格式：{"worldPlan":{"operations":[{"type":"social.observe","observerId":"conversation.targetId的实际值","subjectId":"player","meaning":"本轮英文语义","evidence":"原话片段","valence":0,"reason":"人物的判断"}]},"blocks":[{"type":"dlg","name":"在场人物姓名","text":"针对本轮的具体回答"}]}。每块不超过 120 字。玩家只说“？”或表达困惑时，解释所在地点、自己身份、已知线索；这不是未知具体问题，不要只答不清楚。想帮忙时，围绕真实 goals 商量具体方案；若提出委托，必须用有效 quest.create 落账后再叙述，不能口头假装已经有任务。目标、传闻与已接受的任务是三种不同状态。不要把英文原始字段读给玩家，译成自然中文。'
    : packet.presentNpcs?.length && packet.playerTurn?.speech
    ? '本轮写1–3个块。玩家未指定对象时，在场听者可以根据本轮话语自然回应；不得让缺席者回答，也不强迫所有人回应。dlg.name必须是真正在场人物；narr使用第一人称所见。不要把离题输入强拉回当前任务。'
    : '本轮只写 1–2 个 narr 块，旁白必须使用主角第一人称所见；不复述玩家原话或 recentTurns 景物。格式：{"worldPlan":{"operations":[]},"blocks":[{"type":"narr","text":"第一人称当前结果"}]}。每块不超过 100 字。普通动作若交付物品且对方收下，必须用resource.transfer落账；不能写成对方已接过却operations为空。也可以拒绝，但要明确写没有完成；settledAction已结算的使用/移动不要重复提案。';
  const repair = (packet.player?.travel ? '\n玩家尚在旅途：player.locationId 是记录用出发地，不能写成仍在原地或已经抵达，不得让两端居民说话。请按 affordances 与剩余时间叙述路途。' : '')
    +(packet.departingNpcs?.length?'\n departingNpcs是本轮发言时在场、随后动身的对象。用其真实记忆作最后回应并交代离开，不能忘记刚才的交谈；下一轮不再把此人当作在场。':'')
    +(/决定|后果|接下来|下一步/u.test(packet.playerTurn?.text||packet.playerTurn?.speech||'')?'\n玩家问已作决定的后果：依据当前归属、约定、任务和关系说明已发生的变化；没有另一个已约定的行动，就说明尚未另作约定。不重说上一轮的归属答句，不重新自我介绍，也不编造新的后果。':'')
    + (repairErrors.length ? `\n上一候选未通过事实校验：${repairErrors.join('；').slice(0, 240)}。仅纠正这些错误。` : '');
  const noThink = /^qwen3(?:[.\-]|\d)/iu.test(String(modelName).split(/[\\/]/u).at(-1)) ? '\n/no_think' : '';
  const planPrompt = packet.planMode === 'reality' ? WORLD_PLAN_PROMPT
    : WORLD_PLAN_PROMPT.split('\n').filter(line=>!line.startsWith('reality 模式：')&&!line.startsWith('relation.upsert/remove:')).join('\n');
  return [
    { role: 'system', content: system.replace('不能新增职业、人物、身份、委托、物品、地点、行动结果或知识。', '不能在文字中自行新增职业、人物、身份、委托、物品、地点、行动结果或知识；新变化需要有效的 worldPlan。') + '\n' + planPrompt + '\n' + shape + (packet.departingNpcs?.length?'':deliveryGuide) },
    { role: 'user', content: `引擎事实：${JSON.stringify(facts)}${repair}\nrecentTurns是先前交谈的记录，不是重新播放的范文；recalledSummaries是本地SQLite召回，不需另一次AI请求。奇怪、离题、粗俗或暧昧也有本轮含义，人物可以拒绝；不要把每句话都解读为问任务。只问自己想法时根据本人的goals/性格回答，不再质疑已经澄清的玩笑。问过去说过什么时检索真实听闻记忆，不用“不清楚”回避已经听见的话。turnStart为行动前，当前事实为结算后；途中等待不是在目的地等候。未登记物件不补材质/出处，猜想不是事实。\n现在只回应以下本轮新输入，旧回应不作范文：${JSON.stringify(packet.playerTurn)}${noThink}` }
  ];
}
