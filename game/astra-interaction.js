// World-backed conversation planning. Names, presence and knowledge come from
// the active seed's instances; no opening scene or specific NPC is hard-coded.
import { sceneAffordances, isOrientationSpeech } from './astra-affordances.js';
const clean = value => String(value ?? '').trim();
const present = world => Object.values(world.characters || {})
  .filter(npc => !world.player.travel && npc.alive && npc.locationId === world.player.locationId && !npc.travel);
const sayable = value => clean(value).replace(/危险程度为\d+\/100/gu, '路上有险');
const normalized = value => clean(value).replace(/[\s\p{P}\p{S}]/gu, '');
const subjectGrams = value => {
  const phrases = [...clean(value).matchAll(/[\p{Script=Han}]{2,}/gu)].map(match => match[0]);
  return [...new Set(phrases.flatMap(phrase => Array.from({ length: phrase.length - 1 }, (_, i) => phrase.slice(i, i + 2))))];
};

function knownFacts(world, npc) {
  const quests = [], rumors = [], events = [];
  for (const quest of Object.values(world.quests || {})) {
    if (quest.giverId === npc.id && ['available', 'active', 'mutated'].includes(quest.state))
      quests.push({ id: quest.id, kind: 'quest', summary: `${quest.title}尚未了结` });
  }
  for (const rumor of world.rumors || []) {
    if ((rumor.knownBy || []).includes(npc.id) && rumor.summary)
      rumors.push({ id: rumor.id, kind: 'rumor', summary: sayable(rumor.summary) });
  }
  for (const event of world.history || []) {
    if ((event.actors || []).includes(npc.id) && event.summary
      && !['player_speech', 'opening_cue', 'scene_director'].includes(event.type))
      events.push({ id: event.id, kind: 'event', summary: sayable(event.summary) });
  }
  return [...quests.slice(-8), ...rumors.slice(-12), ...events.slice(-12)];
}

export function conversationEvidence(plan, limit = 8) {
  const grams = subjectGrams(plan?.speech);
  return (plan?.facts || []).map((entry, index) => ({ entry, index,
    score: grams.filter(gram => entry.summary.includes(gram)).length }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit).map(hit => hit.entry);
}

export function resolveAstraConversation(world, rawSpeech, recentTurns = []) {
  const speech = clean(rawSpeech);
  if (!speech) return { targetId: null, targetName: null, facts: [], speech };
  const people = present(world);
  const named = Object.values(world.characters || {}).filter(npc => npc.name && speech.includes(npc.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  // An explicitly named absent person must never be replaced by a bystander.
  if (named && !people.some(npc => npc.id === named.id))
    return { targetId: null, targetName: null, absentName: named.name, facts: [], speech };
  const byRole = people.find(npc => [npc.role, npc.occupation]
    .some(label => typeof label === 'string' && /[\p{Script=Han}]{2,}/u.test(label) && speech.includes(label)));
  const ongoing = world.flags?.conversation;
  const focused = people.find(npc => npc.id === ongoing?.npcId
    && ongoing.locationId === world.player.locationId && world.minute - Number(ongoing.minute || 0) <= 240);
  const prior = (recentTurns || []).slice(-2).flatMap(turn => turn.blocks || [])
    .filter(block => block.type === 'dlg').at(-1);
  const lastSpeaker = people.find(npc => npc.name === prior?.name);
  const callout = /有人|谁在|喂/u.test(speech) || isOrientationSpeech(speech);
  const target = named || byRole || focused || lastSpeaker || (people.length === 1 || callout ? people[0] : null);
  return { targetId: target?.id || null, targetName: target?.name || null,
    facts: target ? knownFacts(world, target) : [], speech };
}

export function validateAstraConversation(blocks, plan, recentTurns = []) {
  if (!plan?.targetId) return { ok: true, errors: [] };
  const reply = (Array.isArray(blocks) ? blocks : []).find(block => block?.type === 'dlg' && block.name === plan.targetName);
  const errors = [];
  if (!reply) errors.push('本轮没有被问人物的回应');
  else {
    const line = normalized(reply.text);
    if (line.length < 2 || /^(?:你问的我已听见|我已听见|我听见了|帮你|你说什么|不知道|嗯嗯|哦哦)$/u.test(line))
      errors.push('回应只是复读或空泛应声');
    const earlier = (recentTurns || []).slice(-4).flatMap(turn => turn.blocks || [])
      .filter(block => block.type === 'dlg' && block.name === plan.targetName)
      .map(block => normalized(block.text));
    if (line.length >= 6 && earlier.includes(line)) errors.push('人物重复了上一轮原话');
    const oldSentences = (recentTurns || []).slice(-4).flatMap(turn => turn.blocks || [])
      .filter(block => block.type === 'dlg' && block.name === plan.targetName)
      .flatMap(block => String(block.text || '').split(/[。！？!?]/u).map(normalized)).filter(part => part.length >= 14);
    const reused = String(reply.text || '').split(/[。！？!?]/u).map(normalized)
      .filter(part => part.length >= 14 && oldSentences.includes(part));
    if (reused.reduce((sum,part)=>sum+part.length,0) >= Math.max(14,line.length*0.3))
      errors.push('人物更换了开头，却重复使用上一轮的大段回应');
  }
  return { ok: errors.length === 0, errors };
}

export function fallbackAstraConversation(world, plan) {
  const npc = world.characters?.[plan?.targetId];
  if (world.player.travel || !npc?.alive || npc.locationId !== world.player.locationId || npc.travel) return null;
  const speech = plan.speech || '';
  const grams = subjectGrams(speech);
  const fact = [...(plan.facts || [])].reverse().map(entry => ({ entry,
    score: grams.filter(gram => entry.summary.includes(gram)).length }))
    .sort((a, b) => b.score - a.score)[0];
  const known = fact?.score > 0 ? fact.entry.summary : '';
  const quest = (plan.facts || []).find(entry => entry.kind === 'quest');
  const identity = /(?:你|您).*(?:是谁|叫什么|名字)|(?:你|您)谁/u.test(speech);
  const offer = /(?:我|让).*?(?:帮|协助|助你)/u.test(speech);
  const question = /[?？]|(?:什么|为何|怎么|哪里|何时|谁)/u.test(speech);
  const view = sceneAffordances(world,npc.id);
  const itemRows=Object.values(world.items||{}).filter(item=>!item.destroyed&&(item.ownerId==='player'||item.ownerId===npc.id));
  const namedItem=itemRows.find(item=>item.name&&speech.includes(item.name.split('·')[0]));
  const recentItem=itemRows.filter(item=>item.transferHistory?.some(row=>[row.from,row.to].includes(npc.id)&&[row.from,row.to].includes('player')))
    .sort((a,b)=>Number(b.transferHistory.at(-1).minute)-Number(a.transferHistory.at(-1).minute))[0];
  const askingOutcome=/决定|约定|接下来|下一步/u.test(speech);
  const recentAgreement=Object.values(world.simulation?.commitments||{}).filter(row=>row.fromId===npc.id&&row.toId==='player'&&row.itemId)
    .sort((a,b)=>Number(b.updatedAt??b.createdAt)-Number(a.updatedAt??a.createdAt))[0];
  const item=namedItem||(/东西|物品|拿|收|归|谁那里/u.test(speech)?recentItem:null)
    ||(askingOutcome&&recentAgreement?itemRows.find(row=>row.id===recentAgreement.itemId):null)
    ||(askingOutcome?recentItem:null);
  const agreement=item&&Object.values(world.simulation?.commitments||{}).filter(row=>row.itemId===item.id&&row.fromId===npc.id)
    .sort((a,b)=>Number(b.createdAt)-Number(a.createdAt))[0];
  const itemAnswer=item?`${item.name}${item.ownerId===npc.id?'还在我这里':'现在在你那里'}。${agreement?.state==='pending'?'我们约定了交付，但你还没有收下。':agreement?.state==='declined'?'你拒绝了这次交付，我没有把它给你。':item.ownerId===npc.id?'我还没有把它交给你。':'东西已经交给你，你可以自行处置。'}`:'';
  const askingMemory=/(?:刚才|之前|记得|上次|过去).*(?:我|说|话|讲)/u.test(speech);
  const heard=(npc.memories||[]).filter(row=>row.source==='player-speech'&&row.summary&&row.summary!==`玩家说过：“${speech.slice(0,120)}”`).slice(-5);
  const memoryAnswer=askingMemory&&heard.length?`我听你说过：${heard.map(row=>row.summary.replace(/^玩家说过：/u,'')).join('；')}。这些话我记得。`:'';
  const orientation = `这里是${view.locationName}。我是${npc.name}，${view.role}。${view.goal ? `我眼下想${view.goal}。` : ''}${quest ? `${quest.summary}，可以先听听具体要求。` : '刚听到的消息还须核实，你可以问我知道哪一条。'}`;
  const answer = itemAnswer || memoryAnswer || (identity || isOrientationSpeech(speech) ? orientation
    : offer && quest ? `多谢。${quest.summary}，你愿意先听我说明吗？`
      : known ? `${known}。我知道的就这些；你还想问哪一处？`
        : offer ? `多谢。${view.goal ? `我眼下想${view.goal}。` : `这里是${view.locationName}。`}尚没有约定委托；你想怎么相助，我们可以先商量。`
          : question ? '这件事我眼下不清楚；你能说得具体些吗？'
            : '我记下你说的话了。眼下还有什么要紧的事？');
  return { targetId: npc.id, blocks: [{ type: 'dlg', name: npc.name, text: answer }] };
}
