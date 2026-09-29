import { TECHNIQUES } from './game-data.js';
import { openingForSeed } from './play-contract.js';
import { actionOutcome, sceneOutcome, repeatsOutcome, endingExcerpt } from './narrative-continuity.js';

const text = (value, max = 120) => String(value ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, max);
function hash(value) { let n = 2166136261; for (const c of String(value)) n = Math.imul(n ^ c.codePointAt(0), 16777619); return n >>> 0; }
const roots = ['灵脉衰退与被隐瞒的药园亏空', '商队失踪与一封错送的家书', '外门账册与长老的私人债务', '旧墓禁制与守山人的沉默', '平静宗门里一次失败的炼丹试验'];
const motifs = ['雨中铜铃', '缺角药牌', '染血账页', '无署名地图', '樱纹残玉'];
const seedFields = {
  faction: ['药园执事', '行商盟', '戒律堂', '隐居丹师', '散修互助会'],
  motive: ['保护亲人而隐瞒', '偿还旧日恩情', '争取平民修行资格', '掩盖错误却非恶意', '寻找失散师友'],
  location: ['废弃药窖', '山涧旧桥', '集市茶棚', '后山雨亭', '商道驿站'],
  encounter: ['求医的旅人', '守口如瓶的账房', '失败过的年轻丹师', '追查家书的剑客', '护送货物的散修'],
  treasure: ['残损温养玉', '辨药铜镜', '引火灵砂', '记路罗盘', '封存半页功法'],
  turn: ['被怀疑的人正在保护证人', '失踪者自愿离开', '宝物的代价曾被隐瞒', '敌对双方各掌握半个真相', '一场意外被人利用']
};

export function createJourneyWorld(seed) {
  const n = hash(seed);
  return { version: 7, seed: text(seed, 80), root: roots[n % roots.length], motif: motifs[(n >>> 8) % motifs.length],
    blueprint: Object.fromEntries(Object.entries(seedFields).map(([key, values]) => [key, values[hash(`${seed}:${key}`) % values.length]])),
    opening: openingForSeed(seed), openingApplied: false, laws: [], lawDebt: 0, lastAction: null, lastSpeech: null,
    hard: [], scene: [], beats: [], repeatStreak: 0, threads: [], skills: {}, lastBeat: -5 };
}

export function normalizeJourneyWorld(raw, seed) {
  const base = createJourneyWorld(text(raw?.seed,80)||seed);
  if (!raw || typeof raw !== 'object') return base;
  base.openingApplied = Boolean(raw.openingApplied);
  base.sceneEvents=(Array.isArray(raw.sceneEvents)?raw.sceneEvents:[]).slice(-24).filter(e=>e&&e.kind==='entered').map(e=>({kind:'entered',target:text(e.target,40),evidence:text(e.evidence,100),location:text(e.location,80),turn:Math.max(0,Number(e.turn)||0),departed:!!e.departed}));
  base.lawDebt = Math.max(0, Math.min(100, Number(raw.lawDebt) || 0));
  base.laws = (Array.isArray(raw.laws) ? raw.laws : []).slice(-30).filter(v => v && v.status === 'fulfilled').map(v => ({
    id: text(v.id, 80), request: text(v.request, 320), cost: text(v.cost, 160), turn: Math.max(0, Number(v.turn) || 0), status: 'fulfilled'
  }));
  if (raw.lastAction && typeof raw.lastAction === 'object') base.lastAction = {
    input: text(raw.lastAction.input, 280), kind: text(raw.lastAction.kind, 20), result: text(raw.lastAction.result, 140),
    targets: (Array.isArray(raw.lastAction.targets) ? raw.lastAction.targets : []).slice(0, 4).map(v => text(v, 40)), turn: Math.max(0, Number(raw.lastAction.turn) || 0)
  };
  if (raw.lastSpeech && typeof raw.lastSpeech === 'object') base.lastSpeech = {
    text: text(raw.lastSpeech.text, 1200),
    turn: Math.max(0, Number(raw.lastSpeech.turn) || 0),
    at: text(raw.lastSpeech.at, 50)
  };
  base.hard = (Array.isArray(raw.hard) ? raw.hard : []).slice(-100).map(v => text(v, 160)).filter(Boolean);
  base.scene = (Array.isArray(raw.scene) ? raw.scene : []).slice(-3).map(v => text(v, 160)).filter(Boolean);
  base.beats = (Array.isArray(raw.beats) ? raw.beats : []).slice(-4).filter(v => v && typeof v === 'object').map(v => ({
    input: text(v.input, 60), result: text(v.result, 180), turn: Math.max(0, Number(v.turn) || 0)
  })).filter(v => v.result);
  base.repeatStreak = Math.max(0, Math.min(9, Number(raw.repeatStreak) || 0));
  base.threads = (Array.isArray(raw.threads) ? raw.threads : []).slice(-40).map(v => ({
    id: text(v.id, 60), kind: text(v.kind, 20), title: text(v.title, 60), evidence: text(v.evidence, 160),
    status: v.status === 'resolved' ? 'resolved' : 'open'
  })).filter(v => v.id && v.title);
  for (const [name, skill] of Object.entries(raw.skills || {}).slice(0, 40)) {
    if (!skill || typeof skill !== 'object') continue;
    base.skills[text(name, 32)] = { type: text(skill.type, 20), source: text(skill.source),
      mastery: Math.max(0, Math.min(100, Number(skill.mastery) || 0)), cost: Math.max(0, Math.min(100, Number(skill.cost) || 0)),
      trait: text(skill.trait, 60), understanding: text(skill.understanding, 80), evolution: text(skill.evolution, 80) };
  }
  base.lastBeat = Number.isFinite(raw.lastBeat) ? raw.lastBeat : -5;
  return base;
}

// Only committed, visible evidence enters long-term memory. No summary API.
export function commitJourneyWorld(state, narration, input) {
  const world = normalizeJourneyWorld(state.journeyWorld, state.journeyId);
  const visible = (narration.blocks || []).filter(b => b.type !== 'sys').map(b => b.text).join(' ');
  const outcome = sceneOutcome(narration);
  const receipt = actionOutcome(narration);
  if (outcome) {
    world.repeatStreak = world.beats.some(b => repeatsOutcome(b.result, outcome)) ? world.repeatStreak + 1 : 0;
    world.beats = [...world.beats, { input: text(input, 60), result: outcome, turn: state.memory.turnCount }].slice(-4);
    world.scene = [...world.scene, endingExcerpt(outcome, 160)].slice(-3);
  }
  const facts = (narration.memory?.facts || []).filter(f => f?.object && visible.includes(f.object))
    .map(f => text(`${f.subjectId}|${f.predicate}|${f.object}`, 160));
  const important = visible.split(/[。！？]/).filter(s => /答应|约定|承诺|救了|救下|欠|背叛|信任|秘密|身世|得到|发现|死去/.test(s));
  // Preserve unexpected outcomes even when the model omitted structured facts.
  // These remain dated observations, not a replacement for authoritative game stats.
  const observed = outcome ? [`第${state.memory.turnCount}回|${endingExcerpt(outcome, 140)}`] : [];
  world.hard = [...new Set([...world.hard, ...facts, ...important.map(s => text(s, 160)), ...observed])].slice(-100);
  for (const candidate of narration.journey?.threads || []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const evidence = text(candidate.evidence, 160);
    if (!evidence || !visible.includes(evidence)) continue;
    const title = text(candidate.title, 60);
    if (!title) continue;
    const id = `thread:${hash(title)}`;
    const old = world.threads.find(t => t.id === id);
    const kind = ['人情', '承诺', '私人目标', '世界事件', '明确任务'].includes(candidate.kind) ? candidate.kind : '私人目标';
    if (old) { old.evidence = evidence; if (candidate.status === 'resolved') old.status = 'resolved'; }
    else world.threads.push({ id, title, kind, evidence, status: candidate.status === 'resolved' ? 'resolved' : 'open' });
  }
  for (const name of state.techniques.known) {
    world.skills[name] ||= { type: TECHNIQUES[name]?.kind || '法术', cost: TECHNIQUES[name]?.cost || 0,
      mastery: state.techniques.mastery[name] || 0, source: '旅途已掌握', trait: TECHNIQUES[name]?.description || '', understanding: '初窥门径', evolution: '由实际练习与机缘领悟' };
    if (input.includes(name) && visible.includes(name) && /施展|使用|使出|释放|运起|练习|修炼|吐纳|打坐/.test(input) && !/不|未|别|如果/.test(input)) {
      world.skills[name].mastery = Math.min(100, world.skills[name].mastery + 1);
      state.techniques.mastery[name] = world.skills[name].mastery;
      world.skills[name].understanding = world.skills[name].mastery >= 30 ? '运转渐趋圆融' : '在实际运用中积累体悟';
      state.techniques.mastery[name] = world.skills[name].mastery;
    }
  }
  for (const candidate of narration.journey?.skills || []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const name = text(candidate.name, 32), evidence = text(candidate.evidence, 160);
    if (!name || !evidence || !evidence.includes(name) || !visible.includes(evidence)
      || !/学会|掌握|领悟|悟出|习得/.test(evidence)) continue;
    const source = text(candidate.source, 60);
    if (!source || !visible.includes(source) || !Number.isFinite(Number(candidate.cost))) continue;
    if (!state.techniques.known.includes(name)) state.techniques.known.push(name);
    world.skills[name] = { mastery: world.skills[name]?.mastery || 0, cost: Math.max(1, Math.min(40, Number(candidate.cost))),
      type: text(candidate.type, 20) || '法术', source, trait: text(candidate.trait, 60),
      understanding: evidence, evolution: text(candidate.evolution, 80) || '尚待实战与机缘' };
  }
  world.threads = world.threads.slice(-40);
  if (receipt && outcome && world.repeatStreak === 0) world.lastBeat = state.memory.turnCount;
  state.journeyWorld = world;
  return state;
}

// Old saves already have full text in IndexedDB. Recover the missing endings
// once from that local transcript; neither the clock nor the AI quota moves.
export function restoreJourneyContinuity(state, turns) {
  if (state.journeyWorld.beats.length) return state;
  const recent = turns.filter(t => t.kind === 'world').slice(-4);
  state.journeyWorld.beats = recent.map((turn, index) => ({
    input: text(turn.userText, 60), result: sceneOutcome(turn),
    turn: Math.max(0, state.memory.turnCount - recent.length + index + 1)
  })).filter(b => b.result);
  const last = state.journeyWorld.beats.at(-1);
  if (last) {
    state.journeyWorld.repeatStreak = state.journeyWorld.beats.slice(0, -1).some(b => repeatsOutcome(b.result, last.result)) ? 1 : 0;
    state.journeyWorld.lastBeat = last.turn;
  }
  return state;
}

export function journeyContext(state, input) {
  const world = normalizeJourneyWorld(state.journeyWorld, state.journeyId);
  const letters = [...String(input).replace(/[\s，。！？、]/gu, '')];
  const terms = [...new Set(letters.slice(0, 150).map((v, i) => v + (letters[i + 1] || '')).filter(v => v.length >= 2))];
  const score = value => terms.reduce((n, term) => n + (value.includes(term) ? 10 : 0), 0);
  const memories = [...world.hard].map((v, i) => ({ v, s: score(v) + i / 100 }))
    .sort((a, b) => b.s - a.s).slice(0, 3).map(v => text(v.v, 70));
  const thread = world.threads.filter(t => t.status === 'open').sort((a, b) => score(b.title + b.evidence) - score(a.title + a.evidence))[0];
  const last = world.beats.at(-1);
  const opening = !state.memory?.turnCount && !last && !world.scene.length;
  return { ...(opening ? { 因: `${world.root}|${world.motif}` } : {}), 忆: memories,
    承: last?.result || world.lastAction?.result || world.scene.at(-1) || '',
    近: world.beats.slice(-2, -1).map(v => `${text(v.input, 30)}→${endingExcerpt(v.result, 80)}`),
    法: world.laws.filter(l => score(l.request) > 0).slice(-1).concat(world.laws.slice(-1)).filter((v, i, a) => a.findIndex(x => x.id === v.id) === i).map(l => text(`已实现：${l.request}`, 80)),
    ...(opening ? { 候选: world.blueprint.encounter + '（仅候选，尚未发生）' } : {}),
    技: Object.entries(world.skills).filter(([name]) => input.includes(name)).slice(0, 2).map(([name, s]) => `${name}|耗灵力${s.cost}|熟练${s.mastery}|${s.understanding}`),
    牵挂: thread ? `${thread.kind}|${thread.title}|${text(thread.evidence, 50)}` : '',
    规: '承为已发生的现场，不重演。意外或反常也须承认并发展后果，不擅改成梦或重置；旧种子不是事实。先回应玩家，再停在新选择前。林小满善良，感情由事件决定。' };
}
