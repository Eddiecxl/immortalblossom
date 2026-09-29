import { NPCS } from './game-data.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const clean = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

const EARLY_PURSUIT_LOCATIONS = new Set(['赵府柴房', '赵府杂役区', '青石镇', '无名山洞', '山林深处', '荒废山神庙']);
const ZHAO_EVENT_ID = 'event:zhao-pursuit-arrival';

export function absoluteWorldMinutes(state) {
  return (Math.max(1, Number(state?.story?.day || 1)) - 1) * 1440
    + clamp(state?.story?.minuteOfDay ?? 360, 0, 1439);
}

export function periodForMinute(minute) {
  const value = ((Math.floor(Number(minute) || 0) % 1440) + 1440) % 1440;
  if (value < 360) return '夜晚';
  if (value < 720) return '清晨';
  if (value < 1020) return '白昼';
  if (value < 1200) return '黄昏';
  return '夜晚';
}

function explicitDurationMinutes(text) {
  const raw = String(text || '');
  let match = raw.match(/(?:等|等待|过|休息|修炼|闭关)?\s*(\d{1,3})\s*分钟/u);
  if (match) return clamp(Number(match[1]), 1, 720);
  match = raw.match(/(?:等|等待|过|休息|修炼|闭关)?\s*(\d{1,2})\s*(?:个)?小时/u);
  if (match) return clamp(Number(match[1]) * 60, 5, 1440);
  match = raw.match(/(?:等|等待|过|休息|修炼|闭关)?\s*(\d{1,2})\s*(?:天|日)/u);
  if (match) return clamp(Number(match[1]) * 1440, 60, 14 * 1440);
  if (/半个时辰|半时辰/u.test(raw)) return 60;
  match = raw.match(/(\d{1,2})\s*(?:个)?时辰/u);
  if (match) return clamp(Number(match[1]) * 120, 30, 2880);
  if (/一刻钟/u.test(raw)) return 15;
  if (/半刻钟/u.test(raw)) return 8;
  if (/整夜|睡到天亮/u.test(raw)) return 480;
  return 0;
}

export function estimateTurnMinutes(playerTurn, action = {}) {
  const speech = clean(playerTurn?.speech, 1000);
  const actionText = clean(playerTurn?.action, 1600);
  // A duration mentioned in dialogue is not an instruction to wait.
  const explicit = explicitDurationMinutes(actionText);
  if (explicit) return Math.floor(explicit);

  if (!actionText && speech) {
    if (speech.length <= 18) return 2;
    if (speech.length <= 60) return 3;
    return 5;
  }

  const kind = String(action?.kind || '');
  let minutes = 5;
  if (kind === 'rest') minutes = /小憩|眯一会|歇一会/u.test(actionText) ? 30 : 180;
  else if (kind === 'cultivate') minutes = /稍微|片刻|吐纳/u.test(actionText) ? 30 : 90;
  else if (kind === 'combat') minutes = 10;
  else if (kind === 'investigate') minutes = /随便|简单|快速|扫一眼/u.test(actionText) ? 5 : 12;
  else if (kind === 'talk') minutes = 3;
  else if (kind === 'wish') minutes = 1;
  else if (/赶路|长途|跋涉|出城|回城|前往.+(?:山|城|宗|镇)/u.test(actionText)) minutes = 60;
  else if (/去|前往|返回|离开|进入|走到|跑到|赶往/u.test(actionText)) minutes = 15;
  else if (/搜索|翻找|调查|检查|查看|寻找/u.test(actionText)) minutes = 10;
  else if (/吃饭|用膳/u.test(actionText)) minutes = 25;
  else if (/洗澡|沐浴/u.test(actionText)) minutes = 20;
  else if (/换衣|整理|收拾/u.test(actionText)) minutes = 5;

  if (speech && actionText) minutes += Math.min(3, Math.max(1, Math.ceil(speech.length / 35)));
  return Math.floor(clamp(minutes, 1, 14 * 1440));
}

export function ensureDeterministicSchedules(state) {
  if (!state?.story) return state;
  state.story.flags ||= {};
  state.director ||= {};
  state.director.dangerClocks ||= {};
  state.worldState ||= {};
  state.worldState.eventLedger ||= [];

  const flags = state.story.flags;
  const active = !flags.zhaoPursuitResolved && !flags.zhaoPursuitArrived
    && EARLY_PURSUIT_LOCATIONS.has(state.story.location);
  if (active && !Number.isFinite(Number(flags.zhaoPursuitDueAbs))) {
    const existing = clamp(state.director.dangerClocks.zhaoPursuit || 0, 0, 3);
    const remaining = Math.max(5, Math.round((4 - existing) * 5));
    flags.zhaoPursuitDueAbs = absoluteWorldMinutes(state) + remaining;
  }
  return state;
}

function hhmmFromAbsolute(value) {
  const minute = ((Math.floor(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function previewTemporalAdvance(source, elapsedMinutes) {
  const state = structuredClone(source);
  ensureDeterministicSchedules(state);
  const beforeAbs = absoluteWorldMinutes(state);
  const afterAbs = beforeAbs + Math.max(0, Math.floor(Number(elapsedMinutes) || 0));
  const due = [];
  const dueAt = Number(state.story.flags?.zhaoPursuitDueAbs);
  const pursuitActive = !state.story.flags?.zhaoPursuitResolved && !state.story.flags?.zhaoPursuitArrived
    && EARLY_PURSUIT_LOCATIONS.has(state.story.location) && Number.isFinite(dueAt);
  if (pursuitActive && dueAt <= afterAbs) {
    due.push({
      id: ZHAO_EVENT_ID,
      type: 'npc-arrival',
      actor: '赵天霸',
      target: state.story.location,
      dueAt,
      instruction: `本回合结束前赵天霸已经抵达${state.story.location}附近。禁止继续写“仍在接近/还在赶来”。`
    });
  }
  const remainingMinutes = pursuitActive && dueAt > afterAbs ? Math.max(0, dueAt - afterAbs) : 0;
  return {
    elapsedMinutes: Math.max(0, Math.floor(Number(elapsedMinutes) || 0)),
    beforeAbsolute: beforeAbs,
    afterAbsolute: afterAbs,
    beforeClock: hhmmFromAbsolute(beforeAbs),
    afterClock: hhmmFromAbsolute(afterAbs),
    remainingPursuitMinutes: remainingMinutes,
    dueEvents: due
  };
}

export function advanceWorldClock(state, elapsedMinutes) {
  const minutes = Math.max(0, Math.floor(Number(elapsedMinutes) || 0));
  const after = absoluteWorldMinutes(state) + minutes;
  state.story.day = Math.floor(after / 1440) + 1;
  state.story.minuteOfDay = ((after % 1440) + 1440) % 1440;
  state.story.period = periodForMinute(state.story.minuteOfDay);
  return state;
}

function ensureZhaoEntity(state, location) {
  state.memory ||= { chapterSummaries: {}, facts: [], entities: {}, turnCount: 0 };
  state.memory.entities ||= {};
  const id = NPCS['赵天霸']?.id || 'npc:zhao-tianba';
  const current = state.memory.entities[id] || {};
  state.memory.entities[id] = {
    id,
    kind: 'npc',
    name: '赵天霸',
    status: current.status || 'alive',
    location,
    purpose: '追捕顾长生；已抵达当前区域附近',
    traits: Array.isArray(current.traits) ? current.traits : [],
    knownFactIds: Array.isArray(current.knownFactIds) ? current.knownFactIds : [],
    facts: Array.isArray(current.facts) ? current.facts : [],
    createdTurnId: current.createdTurnId || `time-engine:${state.memory.turnCount || 0}`,
    lastSeenTurn: Number(state.memory.turnCount || 0)
  };
  state.codex ||= {};
  state.codex.characters = [...new Set([...(state.codex.characters || []), '赵天霸'])];
  return id;
}

function ensureArrivalFact(state, location) {
  state.memory.facts ||= [];
  const id = 'fact:time:zhao-pursuit-arrived';
  const object = `赵天霸已经抵达${location}附近；从此不能再描述为“仍在赶来”。`;
  const existing = state.memory.facts.find((fact) => fact?.id === id);
  if (existing) {
    existing.object = object;
    existing.locked = true;
    return;
  }
  state.memory.facts.push({
    id,
    subjectId: NPCS['赵天霸']?.id || 'npc:zhao-tianba',
    predicate: 'arrived-nearby',
    object,
    sourceTurnId: `time-engine:${state.memory.turnCount || 0}`,
    createdAtTurn: Number(state.memory.turnCount || 0),
    locked: true
  });
}

export function settleScheduledEvents(state) {
  ensureDeterministicSchedules(state);
  const dueAt = Number(state.story.flags?.zhaoPursuitDueAbs);
  const nowAbs = absoluteWorldMinutes(state);
  const events = [];

  const pursuitActive = !state.story.flags?.zhaoPursuitResolved && !state.story.flags?.zhaoPursuitArrived
    && EARLY_PURSUIT_LOCATIONS.has(state.story.location) && Number.isFinite(dueAt);
  if (pursuitActive && dueAt <= nowAbs) {
    const location = state.story.location;
    state.story.flags.zhaoPursuitArrived = true;
    state.story.flags.zhaoPursuitDueAbs = dueAt;
    state.director.dangerClocks.zhaoPursuit = 4;
    const zhaoId = ensureZhaoEntity(state, location);
    if (['赵府柴房', '赵府杂役区'].includes(location)) {
      state.worldState.presentActorIds = [...new Set([...(state.worldState.presentActorIds || []), zhaoId])].slice(0, 12);
    }
    ensureArrivalFact(state, location);
    state.worldState.eventLedger = [...new Set([...(state.worldState.eventLedger || []), ZHAO_EVENT_ID])].slice(-24);
    events.push({
      id: ZHAO_EVENT_ID,
      text: `时间已经推进。赵天霸在本回合结束前抵达${location}附近，“还在赶来”这一阶段已经结束。`
    });
  } else if (pursuitActive) {
    const remaining = Math.max(0, dueAt - nowAbs);
    const stage = clamp(4 - Math.ceil(remaining / 5), 0, 3);
    state.director.dangerClocks.zhaoPursuit = stage;
  }

  return {
    state,
    events,
    remainingPursuitMinutes: pursuitActive && !events.length ? Math.max(0, dueAt - nowAbs) : 0
  };
}

export function settleDeterministicTime(state, elapsedMinutes) {
  ensureDeterministicSchedules(state);
  const beforeAbs = absoluteWorldMinutes(state);
  advanceWorldClock(state, elapsedMinutes);
  const settled = settleScheduledEvents(state);
  return {
    ...settled,
    elapsedMinutes: Math.max(0, absoluteWorldMinutes(state) - beforeAbs)
  };
}

export function pursuitEta(state) {
  ensureDeterministicSchedules(state);
  if (state.story.flags?.zhaoPursuitResolved) return { status: 'resolved', minutes: null };
  if (state.story.flags?.zhaoPursuitArrived) return { status: 'arrived', minutes: 0 };
  const due = Number(state.story.flags?.zhaoPursuitDueAbs);
  if (!Number.isFinite(due)) return { status: 'unknown', minutes: null };
  return { status: 'approaching', minutes: Math.max(0, due - absoluteWorldMinutes(state)) };
}
