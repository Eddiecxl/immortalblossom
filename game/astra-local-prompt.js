// A compact view for small local models. The full Engine packet remains authoritative.
import { WORLD_PLAN_PROMPT } from './astra-plan-prompt.js';
export function buildAstraLocalMessages(packet, visibleEvents = [], modelName = '', repairErrors = []) {
  const facts = {
    minute: packet.minute,
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
    activeQuests: packet.activeQuests,
    dueEvents: packet.dueEvents,
    recentHistory: packet.history?.slice(-4),
    // Keep the conversational boundary without feeding a previous answer back
    // as the most recent prose exemplar for small models to copy.
    recentTurns: packet.recentTurns?.slice(-2).map(turn=>({id:turn.id,userText:turn.userText,
      speakers:(turn.blocks||[]).filter(b=>b.type==='dlg').map(b=>b.name)})),
    rumors: packet.rumors,
    directorHook: packet.directorHook,
    settledEvents: visibleEvents
  };
  const system = '你是《落仙》的中文叙事作者。只根据给定的引擎事实写本回合，不能新增职业、人物、身份、委托、物品、地点、行动结果或知识。presentNpcs 才是眼前真实人物；传闻不等于在场人物的身份、职业或委托。不得把传闻里的事安在眼前人物身上。玩家说“我来帮你”时，只能根据该人物已登记的 goals 与 activeQuests 回答；没有求助事实时不得替人物新造求助或具体任务，可以请玩家说明想帮什么。conversation.targetId 有值时，该在场人物必须直接回答玩家本轮问话；不知道就明确说不知道，不要答非所问或重复旧话。玩家原话由游戏展示，不要复述，不要写“我说，”。不得替玩家决定行动或发言。引擎已结算的事件不得重算。只输出严格 JSON，不要 effects、代码围栏或额外文字。';
  const shape = packet.planMode === 'reality'
    ? '本轮是玩家明确发动言出法随：先将指令翻译为 worldPlan，再写结果。必须同时返回 worldPlan 与 blocks；仅返回 blocks 是无效回复。支持的字段改写无需再次确认。示例格式（使用事实包中的实际目标 ID 和玩家要求的字段）：{"worldPlan":{"operations":[{"type":"entity.update","targetId":"事实包中的实体ID","changes":{"gender":"玩家指定的新性别"}}]},"blocks":[{"type":"narr","text":"我亲眼见到已结算的改变。"}]}。性别/姓名/职业/目标改写已经受 Engine 支持，不得用 concept.defer 回避这些字段。'
    : packet.conversation?.targetId
    ? '本轮写 1–3 个块，必须含被问人物的 dlg，name 等于 conversation.targetName；可以用一句新的所见反应承接，不重放旧景物。格式：{"blocks":[{"type":"dlg","name":"在场人物姓名","text":"针对本轮的具体回答，并说明可商量的下一步"}]}。每块不超过 120 字。玩家只说“？”或表达困惑时，解释所在地点、自己身份、已知线索；这不是未知具体问题，不要只答不清楚。想帮忙时，围绕真实 goals 商量具体方案；若提出委托，必须用有效 quest.create 落账后再叙述，不能口头假装已经有任务。目标、传闻与已接受的任务是三种不同状态。不要把英文原始字段读给玩家，译成自然中文。'
    : '本轮只写 1–2 个 narr 块，旁白必须使用主角第一人称所见；不复述玩家原话或 recentTurns 景物。格式：{"blocks":[{"type":"narr","text":"第一人称当前结果"}]}。每块不超过 100 字。';
  const repair = (packet.player?.travel ? '\n玩家尚在旅途：player.locationId 是记录用出发地，不能写成仍在原地或已经抵达，不得让两端居民说话。请按 affordances 与剩余时间叙述路途。' : '') + (repairErrors.length ? `\n上一候选未通过事实校验：${repairErrors.join('；').slice(0, 240)}。仅纠正这些错误。` : '');
  const noThink = /^qwen3(?:[.\-]|\d)/iu.test(String(modelName).split(/[\\/]/u).at(-1)) ? '\n/no_think' : '';
  const planPrompt = packet.planMode === 'reality' ? WORLD_PLAN_PROMPT
    : WORLD_PLAN_PROMPT.split('\n').filter(line=>!line.startsWith('reality 模式：')&&!line.startsWith('relation.upsert/remove:')).join('\n');
  return [
    { role: 'system', content: system.replace('不能新增职业、人物、身份、委托、物品、地点、行动结果或知识。', '不能在文字中自行新增职业、人物、身份、委托、物品、地点、行动结果或知识；新变化需要有效的 worldPlan。') + '\n' + planPrompt + '\n' + shape },
    { role: 'user', content: `引擎事实：${JSON.stringify(facts)}${repair}\n本轮唯一要回答的新问题：${JSON.stringify(packet.playerTurn)}。此前话语只说明交谈过，不是要重新播放的内容。turnStart 表示行动之前，当前事实表示结算之后；若起初在途中、此时抵达，等待时间是在赶路，不能写成在目的地原地等候。未登记物件只能按真实目标称“不明物件”，不得补出材质、出处、地点等事实。没有可核实的新线索时说明下一步如何询问或查看，不能把猜想说成事实。${noThink}` }
  ];
}
