import { dispatchLocalCommand, getAvailableActions, LOCATIONS, NPCS, REALMS } from './game-engine.js';
import { createGameState, migrateGameState } from './game-state.js';
import { actionContract, planWish, applyWish, commitPlayerAction } from './play-contract.js';
import { commitJourneyWorld } from './journey-world.js';
import { tickWorldState } from './world-state.js';
import { isPlayerDead, rpgEventsSince } from './rpg-rules.js';
import {
  normalizePlayerTurnInput, playerTurnIsEmpty, serializePlayerTurn,
  actionInputForTurn, makeExactSpeechBlock
} from './player-turn.js';
import { ensureDeterministicSchedules, estimateTurnMinutes, settleDeterministicTime } from './time-engine.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const uniq = (values) => [...new Set(values.filter(Boolean))];

function clean(value, max = 220) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function narr(text) { return { type: 'narr', text: clean(text, 2400) }; }
function dlg(name, text) { return { type: 'dlg', name: clean(name, 40), text: clean(text, 1800) }; }
function sys(text) { return { type: 'sys', text: clean(text, 1600) }; }

function ensureFact(state, fact) {
  state.memory ||= { chapterSummaries: {}, facts: [], entities: {}, turnCount: 0 };
  state.memory.facts ||= [];
  if (!state.memory.facts.some((entry) => entry?.id === fact.id)) state.memory.facts.push(fact);
}

function ensureCanon(state) {
  const turn = Number(state.memory?.turnCount || 0);
  const astra = state.astraWorld;
  if (astra && !astra.flags?.legacyMigration) {
    const location = astra.locations?.[astra.player?.locationId]?.name || state.story.location;
    state.worldState ||= {};
    state.worldState.origin ||= `我带着前世记忆来到此世，从凡人身份在${location}开始。`;
    ensureFact(state, {
      id: 'canon:origin:astra', subjectId: 'player', predicate: 'origin',
      object: state.worldState.origin, sourceTurnId: 'opening:astra', createdAtTurn: 0, locked: true
    });
    return;
  }
  const canon = [
    {
      id: 'canon:origin:transmigrator',
      subjectId: 'player:gu-changsheng',
      predicate: 'origin',
      object: '顾长生带着前世记忆穿越到此世，在赵府柴房醒来。',
      sourceTurnId: 'v31:canon',
      createdAtTurn: 0,
      locked: true
    },
    {
      id: 'canon:system:companion',
      subjectId: 'player:gu-changsheng',
      predicate: 'system',
      object: '顾长生拥有会回应他的系统；系统是世界规则的一部分，不是临时幻觉。',
      sourceTurnId: 'v31:canon',
      createdAtTurn: 0,
      locked: true
    },
    {
      id: 'canon:law:words-become-law',
      subjectId: 'player:gu-changsheng',
      predicate: 'ability',
      object: '顾长生拥有言出法随；已经兑现的愿望必须持续有效并留下因果记录。',
      sourceTurnId: 'v31:canon',
      createdAtTurn: 0,
      locked: true
    }
  ];
  for (const fact of canon) ensureFact(state, { ...fact, createdAtTurn: Math.min(turn, fact.createdAtTurn) });
  state.worldState ||= {};
  state.worldState.origin ||= '我带着前世记忆穿越而来，在赵府柴房醒来。';
}

function entityByName(state, name) {
  return Object.values(state.memory?.entities || {}).find((entity) => entity?.name === name);
}

function ensureNpcEntity(state, name, location = state.story.location) {
  const npc = NPCS[name];
  if (!npc) return null;
  state.memory.entities ||= {};
  const existing = state.memory.entities[npc.id] || entityByName(state, name);
  const entity = existing || {
    id: npc.id,
    kind: 'npc',
    name,
    status: 'alive',
    purpose: npc.role,
    traits: [],
    knownFactIds: [],
    facts: [],
    createdTurnId: `v31:${state.memory.turnCount || 0}`
  };
  entity.location = location;
  entity.lastSeenTurn = Number(state.memory.turnCount || 0);
  state.memory.entities[npc.id] = entity;
  state.codex.characters = uniq([...(state.codex.characters || []), name]);
  return entity;
}

function dynamicLocationName(input) {
  const raw = String(input || '');
  if (/山洞|洞穴|洞里|洞中|岩洞|石洞/.test(raw)) return '无名山洞';
  if (/树林|林子|密林/.test(raw)) return '山林深处';
  if (/破庙|荒庙/.test(raw)) return '荒废山神庙';
  if (/屋顶/.test(raw)) return '屋脊';
  return '';
}

function applyDynamicMovement(state, before, input, blocks) {
  const raw = String(input || '');
  if (!/(?:去|进|进入|躲|藏|钻|逃到|跑到|来到|前往)/.test(raw)) return false;
  const authored = Object.keys(LOCATIONS).find((name) => raw.includes(name));
  if (authored) return false;
  const name = dynamicLocationName(raw);
  if (!name) return false;

  const parent = before.story.location;
  const old = entityByName(state, name);
  const id = old?.id || `generated:location:v31-${clean(name, 30).replace(/\s+/g, '-')}-${state.memory.turnCount || 0}`;
  state.memory.entities[id] = {
    ...(old || {}),
    id,
    kind: 'location',
    name,
    location: parent,
    status: 'known',
    description: `${parent}附近可藏身的一处地点。`,
    createdTurnId: old?.createdTurnId || `v31:${state.memory.turnCount || 0}`,
    lastSeenTurn: Number(state.memory.turnCount || 0)
  };
  state.story.location = name;
  state.worldState.sceneLabel = name;
  state.worldState.presentActorIds = [];
  state.codex.locations = uniq([...(state.codex.locations || []), name]);
  blocks.push(narr(`我从${parent}离开，沿着能避开视线的路钻进${name}。石壁把外面的声音压低了一层，这处藏身地从此被记进地图。`));
  ensureFact(state, {
    id: `fact:move:${state.memory.turnCount || 0}:${id}`,
    subjectId: 'player:gu-changsheng',
    predicate: 'moved',
    object: `顾长生从${parent}进入${name}藏身。`,
    sourceTurnId: `v31:${state.memory.turnCount || 0}`,
    createdAtTurn: Number(state.memory.turnCount || 0),
    locked: false
  });
  return true;
}

function memoryAnswer(state, input) {
  const raw = String(input || '');
  if (!/(?:怎么|为什么|为何|之前|刚才|记得|发生过)/.test(raw)) return null;
  if (/(?:洞|这里|当前位置)/.test(raw)) {
    const current = state.story.location;
    const fact = [...(state.memory.facts || [])].reverse().find((entry) =>
      entry?.predicate === 'moved' && String(entry.object || '').includes(current));
    if (fact) return [
      narr(`我记得很清楚：${fact.object}现在我仍在${current}，并没有被莫名其妙地挪回别处。`),
      sys(`记忆核验 · 地点 ${current} · 记录存在`)
    ];
  }
  const recent = [...(state.journeyWorld?.beats || [])].reverse().find((beat) => beat?.result);
  if (recent) return [narr(`我回想刚才发生的事：${recent.result}`)];
  return null;
}

function visibleResult(blocks) {
  const texts = (blocks || []).filter((block) => block?.type !== 'sys').map((block) => clean(block.text, 700)).filter(Boolean);
  return texts.at(-1) || texts[0] || '';
}

function recordTurnMemory(state, input, blocks, before) {
  const result = visibleResult(blocks);
  if (!result) return;
  ensureFact(state, {
    id: `fact:turn:${state.memory.turnCount || 0}`,
    subjectId: 'player:gu-changsheng',
    predicate: 'turn-outcome',
    object: clean(`在${before.story.location}，顾长生“${clean(input, 80)}”；结果：${result}`, 260),
    sourceTurnId: `v31:${state.memory.turnCount || 0}`,
    createdAtTurn: Number(state.memory.turnCount || 0),
    locked: false
  });
}

function relationshipMemory(state, input, blocks) {
  const raw = String(input || '');
  const mentioned = Object.keys(NPCS).find((name) => raw.includes(name) || blocks.some((block) => block?.name === name));
  if (!mentioned) return;
  const relation = state.relationshipStates?.[mentioned];
  const result = visibleResult(blocks);
  ensureNpcEntity(state, mentioned, state.story.location);
  if (relation && result) relation.lastEvent = clean(result, 160);
}

function wishNarration(state, plan) {
  if (!plan.active) return [sys('言灵没有形成完整愿望。')];
  const realm = REALMS[state.player.realm]?.name || '未知境界';
  const target = plan.npc ? `，目标是${plan.npc}` : '';
  return [
    narr(`我说出“言出法随：${plan.request}”。规则没有把这句话当作普通对白；现实按已经结算的结果发生改变${target}。`),
    sys(`言出法随 · 已兑现 · 当前境界 ${realm} · ${plan.cost}`)
  ];
}

function systemReply(state, input) {
  if (!/(?:系统|面板|言出法随是什么|我是穿越)/.test(String(input || ''))) return null;
  const realm = REALMS[state.player.realm]?.name || '凡人';
  return [
    dlg('系统', `宿主顾长生，穿越记录仍在。当前境界：${realm}。言出法随已经兑现的记录不会因为换场景或重开界面而失效。`),
    sys(`系统记录 · 已兑现言灵 ${state.journeyWorld?.laws?.length || 0} 条 · 第 ${state.story.day} 日 ${state.story.period}`)
  ];
}

function speechOnlyReaction(state, speech) {
  const presentIds = new Set(Array.isArray(state.worldState?.presentActorIds) ? state.worldState.presentActorIds : []);
  const candidates = Object.entries(NPCS)
    .filter(([, npc]) => presentIds.has(npc.id) || npc.location === state.story.location)
    .map(([name]) => name);
  const mentioned = candidates.find(name => speech.includes(name));
  const observer = mentioned || candidates[0];
  if (!observer) {
    return [narr('我的话音落下，周围没有已确认在场的人立刻回答；远处的环境动静仍按时间继续。')];
  }
  ensureNpcEntity(state, observer, state.story.location);
  const npc = NPCS[observer];
  let reply;

  if (/你是谁|你叫什么|叫什么名字|你是何人|你的身份/u.test(speech)) {
    if (observer === '林小满') reply = '我叫林小满，药铺的学徒。顾长生，你连我都不记得了？';
    else reply = `我是${observer}，${npc.role}。`;
  } else if (/我是谁|我叫什么|你认识我吗|你认得我吗/u.test(speech)) {
    if (observer === '林小满') reply = `你是顾长生。我当然认识你——只是你今天醒来以后，怎么看都像少了好大一截记忆。`;
    else reply = `你是顾长生。至于我知道你多少，只能按我们真正经历过的事来说。`;
  } else if (/^(?:你好|嗨|喂|在吗)[!！。,.，？?\s]*$/u.test(speech)) {
    reply = observer === '林小满' ? '我在。你今天怎么怪怪的？先别发愣，外头可不太平。' : '我在。有什么话，直说便是。';
  } else if (/这里是哪|这是哪|我们在哪|现在在哪/u.test(speech)) {
    reply = `这里是${state.story.location}。`;
  } else if (/发生了什么|怎么回事|现在什么情况/u.test(speech)) {
    const last = clean(state.journeyWorld?.lastAction?.result || '', 120);
    reply = last ? `刚才已经发生的是：${last}` : `眼下我们在${state.story.location}，其余我只说自己确实知道的。`;
  } else if (/[a-zA-Z]/.test(speech)) {
    reply = '你方才夹着说的那些音节我没听懂。若那是你前世的说法，你得告诉我是什么意思。';
  } else if (/[?？]/.test(speech)) {
    reply = `你问的是“${clean(speech, 90)}”。我若知道会直接答，不知道也不会装懂。`;
  } else if (/谢谢|多谢|感激/.test(speech)) {
    reply = '这句话我记下了。眼下先把这里的事处理好。';
  } else if (/别|不要|安静|嘘/.test(speech)) {
    reply = '好，我不出声。';
  } else {
    reply = observer === '林小满' ? '我听着。你继续说。' : '我听着。';
  }
  return [dlg(observer, reply)];
}

export function ensureV31Canon(source, mode = source?.mode || 'ai') {
  let state = migrateGameState(structuredClone(source), mode);
  ensureCanon(state);
  return migrateGameState(state, mode);
}

export function createV31State(name = '顾长生', idFactory) {
  const state = createGameState(name, 'local', idFactory);
  ensureCanon(state);
  return migrateGameState(state, 'local');
}

export function runV31Turn(source, input, { random = Math.random } = {}) {
  const playerTurn = normalizePlayerTurnInput(input);
  if (playerTurnIsEmpty(playerTurn)) return {
    ok: false,
    state: migrateGameState(source, source?.mode || 'local'),
    blocks: [sys('至少填写“说话”或“行动”其中一项。')],
    suggestions: getAvailableActions(source),
    error: 'empty_input'
  };
  const raw = serializePlayerTurn(playerTurn);
  const mechanicalInput = actionInputForTurn(playerTurn);
  const actionInput = mechanicalInput || (playerTurn.speech ? '说话' : '');

  const mode = source?.mode || 'local';
  const before = migrateGameState(structuredClone(source), mode);
  if (isPlayerDead(before)) return { ok: false, state: before, blocks: [sys('此世命途已经终止。')], suggestions: [], error: 'player_dead', ending: { id: 'fallen' } };
  ensureCanon(before);
  ensureDeterministicSchedules(before);
  const action = actionContract(before, actionInput);
  let state = structuredClone(before);
  let blocks = [];
  let ending = null;

  const remembered = memoryAnswer(state, raw);
  const companion = systemReply(state, mechanicalInput);
  if (action.kind === 'wish') {
    const plan = planWish(state, mechanicalInput);
    applyWish(state, plan);
    state.stats.turns += 1;
    blocks = wishNarration(state, plan);
  } else if (remembered) {
    state.stats.turns += 1;
    blocks = remembered;
  } else if (companion) {
    state.stats.turns += 1;
    blocks = companion;
  } else if (!mechanicalInput && playerTurn.speech) {
    state.stats.turns += 1;
    blocks = speechOnlyReaction(state, playerTurn.speech);
  } else {
    const result = dispatchLocalCommand(state, mechanicalInput, random);
    state = result.state;
    blocks = [...(result.blocks || [])];
    ending = result.ending || null;
  }

  state = migrateGameState(state, mode);
  ensureCanon(state);
  for (const event of rpgEventsSince(before, state)) if (!blocks.some(b => b.text === event.text)) blocks.push(sys(event.text));
  if (isPlayerDead(state)) ending = { id: 'fallen' };

  const exactSpeech = makeExactSpeechBlock(playerTurn.speech);
  if (exactSpeech) blocks = [exactSpeech, ...blocks];

  const movedDynamically = applyDynamicMovement(state, before, mechanicalInput, blocks);
  const minutes = estimateTurnMinutes(playerTurn, action);
  // Some legacy local handlers touched the clock themselves. Beta v1 always
  // starts from the authoritative pre-turn time, then advances exactly once.
  state.story.day = before.story.day;
  state.story.minuteOfDay = before.story.minuteOfDay;
  state.story.period = before.story.period;
  const temporal = settleDeterministicTime(state, minutes);
  state = temporal.state;
  for (const event of temporal.events) {
    if (!blocks.some((block) => String(block?.text || '').includes('已经抵达'))) blocks.push(narr(event.text));
  }

  // The local engine historically advanced days directly. Beta v1 owns one central
  // clock so every action has one deterministic time cost.
  if (!movedDynamically && LOCATIONS[state.story.location]) {
    state.worldState.sceneLabel = state.story.location;
    state.codex.locations = uniq([...(state.codex.locations || []), state.story.location]);
  }

  relationshipMemory(state, raw, blocks);

  const narration = {
    blocks,
    effects: {},
    progress: { advanced: [`scene:v31:${state.memory.turnCount || 0}`], consequences: [visibleResult(blocks) || '世界时间继续推进。'] },
    memory: { facts: [], entities: [] },
    timeCost: 'brief'
  };

  commitPlayerAction(state, action, narration);
  if (playerTurn.speech) {
    state.journeyWorld.lastSpeech = {
      text: playerTurn.speech,
      turn: Number(state.memory?.turnCount || 0),
      at: state.updatedAt || ''
    };
  }
  commitJourneyWorld(state, narration, raw);
  recordTurnMemory(state, raw, blocks, before);
  state = tickWorldState(state);
  state.memory.turnCount = Number(state.memory.turnCount || 0) + 1;
  state.updatedAt = new Date().toISOString();
  state.revision = Number(state.revision || 0) + 1;

  // Persist the current-location invariant after all migration/legacy handlers.
  if (!state.worldState.sceneLabel) state.worldState.sceneLabel = state.story.location;
  ensureCanon(state);
  state = migrateGameState(state, mode);

  return {
    ok: true,
    state,
    blocks,
    suggestions: getAvailableActions(state),
    elapsedMinutes: minutes,
    ending
  };
}

export function v31Snapshot(state) {
  const current = migrateGameState(state, state?.mode || 'local');
  return {
    player: {
      name: current.player.name,
      realm: REALMS[current.player.realm]?.name || '凡人',
      hp: current.player.hp,
      spirit: current.player.spirit,
      qi: current.player.qi,
      gold: current.player.gold
    },
    time: {
      day: current.story.day,
      period: current.story.period,
      minuteOfDay: current.story.minuteOfDay,
      turn: current.memory.turnCount
    },
    location: current.story.location,
    knownLocations: [...current.codex.locations],
    knownCharacters: [...current.codex.characters],
    quests: structuredClone(current.quests),
    threats: structuredClone(current.director.dangerClocks),
    laws: structuredClone(current.journeyWorld?.laws || []),
    recentMemory: (current.memory.facts || []).slice(-8).map((fact) => fact.object)
  };
}
