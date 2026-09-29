// UI memory aid. Authoritative facts remain in the Engine world and turn ledger.
const shorten = (value, limit = 100) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
const different = (a, b) => Number(a || 0) !== Number(b || 0);

export function summarizeWorldTurn({ before = {}, after = {}, input = {}, action = {}, events = [] } = {}) {
  const place = after.locations?.[after.player?.locationId]?.name || '此地';
  const parts = [];
  if (before.player?.locationId !== after.player?.locationId) {
    const oldPlace = before.locations?.[before.player?.locationId]?.name || '原处';
    parts.push(`从${oldPlace}来到${place}`);
  } else if (action.type === 'accept_quest') parts.push(`在${place}承接一段委托`);
  else if (action.type === 'quest_work') parts.push(`在${place}推进已接的委托`);
  else if (action.type === 'attack') parts.push(`在${place}与人交手`);
  else if (action.type === 'wait') parts.push(`在${place}休整并等待局势变化`);
  else if (action.type === 'reality') parts.push(`在${place}发动言出法随，命簿记录了实际改写`);
  else if (input.speech) parts.push(`在${place}与在场人物交谈${/[？?]$/u.test(input.speech.trim()) ? '并提出疑问' : ''}`);
  else if (input.action) parts.push(`在${place}尝试行动`);
  else parts.push(`在${place}观察事态`);

  const healthDelta = Number(after.player?.health || 0) - Number(before.player?.health || 0);
  if (healthDelta < 0) parts.push(`气血减少 ${-healthDelta}`);
  else if (healthDelta > 0) parts.push(`气血恢复 ${healthDelta}`);
  const wealthDelta = Number(after.player?.wealth || 0) - Number(before.player?.wealth || 0);
  if (wealthDelta) parts.push(`钱财${wealthDelta > 0 ? '增加' : '减少'} ${Math.abs(wealthDelta)}`);
  for (const [id, quest] of Object.entries(after.quests || {})) {
    if (quest?.state && quest.state !== before.quests?.[id]?.state) {
      parts.push(`${shorten(quest.title, 24)}转为${quest.state}`);
      if (parts.length >= 4) break;
    }
  }
  const seen = new Set();
  for (const event of events) {
    const detail = shorten(event?.summary, 55);
    if (detail && !seen.has(detail) && parts.length < 4) { parts.push(detail); seen.add(detail); }
  }
  if (parts.length === 1) {
    const elapsed = Math.max(0, Number(after.minute || 0) - Number(before.minute || 0));
    if (elapsed) parts.push(`世界时辰前进 ${elapsed} 分钟，周围的人和事件仍按各自进程变化`);
  }
  return shorten(`${parts.join('；')}。`, 120);
}

export function recentEchoSummary(turn = {}) {
  if (shorten(turn.summary, 160)) return shorten(turn.summary, 160);
  // Older transcripts have no summary. This fallback is deliberately generic
  // instead of copying narrative prose or a player's exact dialogue.
  if (turn.speech || turn.action || turn.actionText) {
    if (turn.speech && (turn.action || turn.actionText)) return '你在此地交谈并采取行动；经过已记入命簿。';
    if (turn.speech) return '你与在场人物交谈；谈话及随后的变化已记入命簿。';
    return '你采取行动；结果与周围局势已记入命簿。';
  }
  return '此世已展开；开篇的人物与局势已记入命簿。';
}
