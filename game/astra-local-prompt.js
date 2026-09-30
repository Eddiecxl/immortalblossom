// A compact view for small local models. The full Engine packet remains authoritative.
export function buildAstraLocalMessages(packet, visibleEvents = [], modelName = '', repairErrors = []) {
  const facts = {
    minute: packet.minute,
    location: packet.location,
    player: packet.player,
    playerTurn: packet.playerTurn,
    conversation: packet.conversation,
    presentNpcs: packet.presentNpcs,
    activeQuests: packet.activeQuests,
    dueEvents: packet.dueEvents,
    recentHistory: packet.history?.slice(-4),
    recentTurns: packet.recentTurns?.slice(-2),
    rumors: packet.rumors,
    directorHook: packet.directorHook,
    settledEvents: visibleEvents
  };
  const system = '你是《落仙》的中文叙事作者。只根据给定的引擎事实写本回合，不能新增职业、人物、身份、委托、物品、地点、行动结果或知识。presentNpcs 才是眼前真实人物；传闻不等于在场人物的身份、职业或委托。不得把传闻里的事安在眼前人物身上。玩家说“我来帮你”时，只能根据该人物已登记的 goals 与 activeQuests 回答；没有求助事实时不得替人物新造求助或具体任务，可以请玩家说明想帮什么。conversation.targetId 有值时，该在场人物必须直接回答玩家本轮问话；不知道就明确说不知道，不要答非所问或重复旧话。玩家原话由游戏展示，不要复述，不要写“我说，”。不得替玩家决定行动或发言。引擎已结算的事件不得重算。只输出严格 JSON，不要 effects、代码围栏或额外文字。';
  const shape = packet.conversation?.targetId
    ? '本轮只写一个 dlg 块，不写旁白；name 必须等于 conversation.targetName。格式：{"blocks":[{"type":"dlg","name":"在场人物姓名","text":"针对本轮的具体回答"}]}。对话不超过 100 字。'
    : '本轮只写 1–2 个 narr 块，旁白必须使用主角第一人称所见；不复述玩家原话或 recentTurns 景物。格式：{"blocks":[{"type":"narr","text":"第一人称当前结果"}]}。每块不超过 100 字。';
  const repair = repairErrors.length ? `\n上一候选未通过事实校验：${repairErrors.join('；').slice(0, 240)}。仅纠正这些错误。` : '';
  const noThink = /^qwen3(?:[.\-]|\d)/iu.test(String(modelName).split(/[\\/]/u).at(-1)) ? '\n/no_think' : '';
  return [
    { role: 'system', content: system + shape },
    { role: 'user', content: `引擎事实：${JSON.stringify(facts)}${repair}${noThink}` }
  ];
}
