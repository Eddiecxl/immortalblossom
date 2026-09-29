import { LOCATION_EXITS, LOCATIONS, NPCS } from './game-data.js';
import { planWish, applyWish, actionContract } from './play-contract.js';

export function planWordsBecomeLaw(state, input) {
  return /^\s*言出法随\s*[:：]/u.test(input) ? planWish(state, input) : legacyPlanWordsBecomeLaw(state, input);
}
export function applyWordsBecomeLaw(state, plan) {
  return plan?.request ? applyWish(state, plan) : legacyApplyWordsBecomeLaw(state, plan);
}

const cleanText = (value, max = 120) => String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
const cleanId = (value) => cleanText(value, 80).replace(/[^\p{L}\p{N}_.:/\-]/gu, '');
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const baseRelationship = (name) => ({
  trust: name === '林小满' ? 8 : 0,
  closeness: name === '林小满' ? 6 : 0,
  wariness: name === '赵天霸' ? 35 : 8,
  debt: 0, affection: name === '林小满' ? 2 : 0,
  hostility: name === '赵天霸' ? 25 : 0,
  lastEvent: ''
});

export function createWorldState() {
  return {
    weather: '细雨', sceneLabel: '赵府柴房·东侧柴堆',
    presentActorIds: [], unknownPresence: 0,
    eventLedger: [], temporaryBoon: null,
    origin: '我带着前世记忆穿越而来，在赵府柴房醒来。'
  };
}

export function normalizeWorldState(raw) {
  const base = createWorldState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const presentActorIds = Array.isArray(raw.presentActorIds)
    ? [...new Set(raw.presentActorIds.map(cleanId).filter((id) => id.startsWith('npc:') || id.startsWith('generated:npc:') || id === 'unknown:scene'))].slice(0, 12)
    : base.presentActorIds;
  return {
    weather: cleanText(raw.weather, 32) || base.weather,
    sceneLabel: cleanText(raw.sceneLabel, 80) || base.sceneLabel,
    presentActorIds,
    unknownPresence: Math.floor(clamp(raw.unknownPresence, 0, 8)),
    eventLedger: Array.isArray(raw.eventLedger) ? raw.eventLedger.map((entry) => cleanId(entry)).filter(Boolean).slice(-24) : [],
    temporaryBoon: raw.temporaryBoon && typeof raw.temporaryBoon === 'object'
      ? { title: cleanText(raw.temporaryBoon.title, 60), expiresAtTurn: Math.floor(clamp(raw.temporaryBoon.expiresAtTurn, 0, 999999)), price: cleanText(raw.temporaryBoon.price, 120) }
      : null,
    origin: cleanText(raw.origin, 160) || base.origin
  };
}

export function createRelationshipStates(raw) {
  const states = {};
  for (const name of [...new Set([...Object.keys(NPCS), ...Object.keys(raw || {})])].filter(n => !['__proto__', 'constructor', 'prototype'].includes(n))) {
    const source = raw?.[name] || {};
    const base = baseRelationship(name);
    states[name] = {
      trust: Math.floor(clamp(source.trust ?? base.trust, -100, 100)),
      closeness: Math.floor(clamp(source.closeness ?? base.closeness, -100, 100)),
      wariness: Math.floor(clamp(source.wariness ?? base.wariness, 0, 100)),
      debt: Math.floor(clamp(source.debt ?? base.debt, -100, 100)),
      affection: Math.floor(clamp(source.affection ?? base.affection, -100, 100)),
      hostility: Math.floor(clamp(source.hostility ?? base.hostility, 0, 100)),
      lastEvent: cleanText(source.lastEvent ?? base.lastEvent, 160)
    };
  }
  return states;
}

export function applyRelationshipDelta(state, name, delta, note = '') {
  if (!state.relationshipStates?.[name]) return state;
  const value = Math.floor(clamp(delta, -20, 20));
  const relationship = state.relationshipStates[name];
  relationship.trust = Math.floor(clamp(relationship.trust + value, -100, 100));
  relationship.closeness = Math.floor(clamp(relationship.closeness + (value > 0 ? Math.max(1, Math.ceil(value / 2)) : Math.floor(value / 3)), -100, 100));
  relationship.wariness = Math.floor(clamp(relationship.wariness - value, 0, 100));
  relationship.hostility = Math.floor(clamp(relationship.hostility - value, 0, 100));
  if (value > 0 && name === '林小满') relationship.affection = Math.floor(clamp(relationship.affection + 1, -100, 100));
  if (value < 0) relationship.debt = Math.floor(clamp(relationship.debt + Math.abs(value), -100, 100));
  if (note) relationship.lastEvent = cleanText(note, 160);
  return state;
}

export function adjacentLocations(locationName) {
  return (LOCATION_EXITS[locationName] || []).filter((name) => LOCATIONS[name]);
}

export function generatedNeighbors(state) {
  const places = Object.values(state.memory?.entities || {}).filter(e => e.kind === 'location');
  const current = places.find(e => e.name === state.story.location);
  const currentId = current?.id || LOCATIONS[state.story.location]?.id;
  const children = places.filter(e => e.location === state.story.location || (currentId && e.location === currentId));
  const parent = current && (places.find(e => e.id === current.location || e.name === current.location)
    || Object.entries(LOCATIONS).map(([name, p]) => ({ ...p, name })).find(e => e.id === current.location || e.name === current.location));
  return [...children, ...(parent ? [parent] : [])].map(e => ({ id: e.id, name: e.name }));
}

export function reachableLocations(locationName, maxHops = 2) {
  const output = [];
  const visited = new Set([locationName]);
  let frontier = [locationName];
  for (let hop = 0; hop < maxHops; hop += 1) {
    frontier = frontier.flatMap((name) => adjacentLocations(name)).filter((name) => !visited.has(name));
    for (const name of frontier) { visited.add(name); output.push(name); }
  }
  return output;
}

function actorIdByName(contract, name) {
  return contract?.actors?.find((actor) => actor.name === name)?.id || '';
}

function actorName(state, id) {
  const authored = Object.entries(NPCS).find(([, npc]) => npc.id === id)?.[0];
  return authored || state.memory?.entities?.[id]?.name || '';
}

export function reduceScenePresence(source, narration, contract) {
  const state = structuredClone(source);
  state.worldState = normalizeWorldState(state.worldState);
  const visibleText = (narration?.blocks || []).filter(b => b.type !== 'sys').map((block) => cleanText(block?.text, 1000)).join('\n');
  const present = new Set(state.worldState.presentActorIds);
  if (state.story.location !== contract.location.name) {
    present.clear();
    state.worldState.sceneLabel = state.story.location;
  }
  const candidates = [...(contract.actors || []), ...Object.values(state.memory?.entities || {}), ...(narration.memory?.entities || [])];
  for (const actor of candidates) {
    if (!actor.name || actor.status === 'dead') continue;
    const sentences = visibleText.split(/[。！？]/).filter(s => s.includes(actor.name));
    if (sentences.some(sentence => /走来|站在|走进|蹲在|推门|身旁|门外|藏在|伏在|抬头|开口|握住|看着/.test(sentence)
      && !/回忆|听说|想起|曾经|如果|也许|不在|并未|没有出现/.test(sentence))) present.add(actor.id);
  }
  for (const block of narration?.blocks || []) {
    if (block?.type !== 'dlg') continue;
    const id = actorIdByName(contract, cleanText(block.name, 40)) || candidates.find(a => a.name === block.name)?.id;
    if (id) present.add(id);
    else if (cleanText(block.name, 40)) present.add('unknown:scene');
  }
  for (const id of [...present]) {
    const name = actorName(state, id);
    if (name && new RegExp(`${name}.{0,18}(?:转身离开|离开了|快步离去|消失在|出了柴房|出了院门)`, 'u').test(visibleText)) present.delete(id);
  }
  state.worldState.presentActorIds = [...present].slice(0, 12);
  for (const id of state.worldState.presentActorIds) {
    if (state.memory?.entities?.[id]) state.memory.entities[id].location = state.story.location;
  }
  state.worldState.unknownPresence = state.worldState.presentActorIds.includes('unknown:scene') ? 1 : 0;
  return state;
}

export function legacyPlanWordsBecomeLaw(state, input) {
  const text = cleanText(input, 400);
  const requested = /言出法随|言出法随：|系统.{0,8}(?:实现|成真)|直接(?:筑基|结丹|突破)/u.test(text);
  if (!requested) return { active: false, scale: 'none', consequence: '', cooldownTurns: 0, cost: '' };
  const cooldown = Number(state.systemCompanion?.cooldownTurns || 0);
  if (cooldown > 0) return {
    active: false, scale: 'cooldown', cooldownTurns: cooldown,
    cost: `言灵仍在回响，还需 ${cooldown} 个世界回合才能再次承受。`, consequence: '系统会记录这句愿望，但不会替我虚构成功。'
  };
  const heavenDefying = /筑基|结丹|元婴|复活|逆转|天劫|改命/u.test(text);
  return heavenDefying
    ? { active: true, scale: 'heaven-defying', cooldownTurns: 4, cost: '代价：三刻钟临时道果、经脉刺痛与一笔未偿因果。', consequence: '愿望可以成真，但只得三刻钟临时筑基；因果会记下我的名字。' }
    : { active: true, scale: 'major', cooldownTurns: 2, cost: '代价：系统过载，下一次言灵需要等待。', consequence: '愿望会以合乎现场的方式落地，并留下可追溯的代价。' };
}

export function legacyApplyWordsBecomeLaw(state, plan) {
  if (!plan?.active) return state;
  state.systemCompanion.charges = Math.max(0, Number(state.systemCompanion.charges || 0) - 1);
  state.systemCompanion.cooldownTurns = Math.max(Number(state.systemCompanion.cooldownTurns || 0), plan.cooldownTurns);
  state.systemCompanion.backlash = Math.min(99, Number(state.systemCompanion.backlash || 0) + (plan.scale === 'heaven-defying' ? 3 : 1));
  if (plan.scale === 'heaven-defying') state.worldState.temporaryBoon = {
    title: '三刻钟·临时筑基', expiresAtTurn: Number(state.memory.turnCount || 0) + 3, price: plan.cost
  };
  return state;
}

export function tickWorldState(state) {
  if (!state.systemCompanion) return state;
  state.systemCompanion.cooldownTurns = Math.max(0, Number(state.systemCompanion.cooldownTurns || 0) - 1);
  if (state.worldState?.temporaryBoon?.expiresAtTurn <= Number(state.memory?.turnCount || 0)) state.worldState.temporaryBoon = null;
  return state;
}

export function buildDirectorBeat(state, contract) {
  const action = actionContract(state, contract.playerInput || '');
  const turns = Number(state.director?.chapterTurns || 0);
  const stalled = Number(state.director?.turnsSinceChapterProgress || 0);
  const latest = state.journeyWorld?.beats?.at(-1);
  const unfinished = state.journeyWorld?.threads?.find(t => t.status === 'open');
  const linPresent = state.worldState?.presentActorIds?.includes('npc:lin-xiaoman');

  if (action.kind === 'wish') return {
    kind: 'law-consequence', priority: 3, eventId: `beat:law:${turns}`,
    instruction: '先完整兑现言出法随，再立即写世界对此产生的具体反应。愿望实现不等于世界暂停；旁人、组织和危险可以因结果改变行动。'
  };
  if (action.kind === 'rest') return {
    kind: 'rest-with-world', priority: 1, eventId: `beat:rest:${turns}`,
    instruction: '允许休整，但休整消耗真实时间。结尾必须交代在这段时间里至少一个人物、危险、期限或环境发生了什么；世界不能陪玩家一起睡。'
  };
  if (latest && (state.journeyWorld.repeatStreak > 0 || state.director?.feedback?.some(v => v.includes('重复')))) return {
    kind: 'break-loop', priority: 3, eventId: `beat:break-loop:${turns}`,
    instruction: '禁止重述刚才。先直接回应玩家本句，再兑现一个旧悬念、让人物采取新行动，或让危险/期限跨过一个阶段；本回合必须出现不可逆的新事实。'
  };
  if (stalled >= 1) return {
    kind: 'world-pressure', priority: stalled >= 2 ? 3 : 2, eventId: `beat:pressure:${turns}`,
    instruction: '世界不会等待玩家。先回应玩家当前说话/行动，然后让最相关的NPC、追兵、伤势、任务期限或环境主动推进；允许失败、错过、离场、受伤甚至死亡。不要把危险继续写成“还在接近”。'
  };
  if (unfinished && turns > 0 && turns % 3 === 0) return {
    kind: 'thread-return', priority: 2, eventId: `beat:thread:${turns}`,
    instruction: `先回应玩家，再让“${unfinished.title}”在本回合得到一个新答案、代价或结果。不要只新增线索，要有兑现。`
  };
  if (!linPresent && state.codex.characters.includes('林小满') && turns > 0 && turns % 4 === 0) return {
    kind: 'relationship-motion', priority: 2, eventId: `beat:lin:${turns}`,
    instruction: '林小满有自己的行程与目的：让她合理出现、离开、留下消息或因外界事件改变计划。不能瞬移，也不需要围着玩家等待。'
  };
  if (latest) return {
    kind: 'continuation-with-motion', priority: 1, eventId: `beat:motion:${turns}`,
    instruction: '从上一回合的真实后果直接接起。若玩家在说话，被问到的人应直接回答；同时让场景里至少一个人物、危险、期限或环境继续行动，产生新的可验证变化。'
  };
  if (turns > 0 && turns % 2 === 0) return {
    kind: 'opportunity', priority: 1, eventId: `beat:opportunity:${turns}`,
    instruction: '用人物自身目的、宗门作息、天气或正在倒数的事件带出一个可行动的新局势；不是单纯提示，而是已经发生的变化。'
  };
  return {
    kind: 'living-world', priority: 1, eventId: '',
    instruction: '直接回应玩家，并让世界自己向前一步：人物有目的，时间会走，危险会兑现。不要空转。'
  };
}
