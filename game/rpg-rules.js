// Deterministic RPG authority. Prose, item names and companion chat charges
// cannot grant protection; only a recorded rule with acquisition provenance can.
import { ITEMS } from './game-data.js';

const text = (v, n = 160) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, n);
const number = (v, min, max, fallback = min) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const hash = value => { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0).toString(36); };

export function createRpgState() { return { version: 1, assets: {}, ledger: [], nextEvent: 1 }; }

export function normalizeRpgState(raw) {
  const output = createRpgState();
  if (!record(raw)) return output;
  // Assets (including exhausted ones) are durable state, never a rolling window.
  for (const [key, value] of Object.entries(record(raw.assets) ? raw.assets : {})) {
    if (!record(value) || value.trigger !== 'lethal' || !['item', 'skill', 'system'].includes(value.kind)
      || !value.provenance?.sourceId || !value.provenance?.evidence || !value.name) continue;
    const id = text(key, 100);
    output.assets[id] = {
      id, name: text(value.name, 48), kind: value.kind, trigger: 'lethal',
      charges: Math.floor(number(value.charges, 0, 999)),
      restoreRatio: number(value.restoreRatio, .01, 1, .25),
      provenance: { sourceId: text(value.provenance.sourceId, 100), source: text(value.provenance.source, 80),
        evidence: text(value.provenance.evidence, 240), turn: Math.floor(number(value.provenance.turn, 0, 999999999)) },
      consumed: Math.floor(number(value.consumed, 0, 999999999))
    };
  }
  output.ledger = (Array.isArray(raw.ledger) ? raw.ledger : []).slice(-200).filter(e => record(e) && ['acquired', 'revival', 'death', 'consumed', 'equipped'].includes(e.kind)).map(e => ({
    id: text(e.id, 100), kind: e.kind, assetId: text(e.assetId, 100), name: text(e.name, 48),
    sourceId: text(e.sourceId, 100), cause: text(e.cause), hpBefore: number(e.hpBefore, 0, 9999), hpAfter: number(e.hpAfter, 0, 9999),
    chargesRemaining: number(e.chargesRemaining, 0, 999), turn: number(e.turn, 0, 999999999), text: text(e.text, 320)
  }));
  output.nextEvent = Math.floor(number(raw.nextEvent, 1, Number.MAX_SAFE_INTEGER, output.ledger.length + 1));
  return output;
}

export function appendRpgEvent(state, event) {
  state.rpg ||= createRpgState();
  const entry = { id: `rpg:${state.rpg.nextEvent++}`, turn: Number(state.memory?.turnCount || 0) + 1, ...event };
  state.rpg.ledger = [...state.rpg.ledger, entry].slice(-200);
  return entry;
}
const appendEvent = appendRpgEvent;

export function isPlayerDead(state) { return Boolean(state.story?.flags?.playerDead) || Number(state.player?.hp) <= 0; }

function markDead(state, cause, sourceId, hpBefore, log = true) {
  state.player.hp = 0;
  state.story.flags.playerDead = true;
  state.battle = null;
  state.pending = null;
  for (const list of [state.endings?.unlocked, state.codex?.endings]) if (list && !list.includes('fallen')) list.push('fallen');
  if (log) appendEvent(state, { kind: 'death', name: state.player.name, sourceId, cause, hpBefore, hpAfter: 0,
    text: `气血归零：${cause}。没有可用的已获保命资源，此世命途终止。` });
}

// Save migration only reconciles terminal state. It never spends protection or
// performs resurrection just because an old save has zero health.
export function normalizePlayerLife(state) {
  if (isPlayerDead(state)) markDead(state, '存档中的死亡状态', 'save:migration', 0, false);
  return state;
}

export function explicitSelfDeath(request) {
  const s = text(request, 320).replace(/\s+/g, '');
  if (/(?:不|勿|莫|未|别).{0,8}(?:死|自杀|自尽|自刎|去世)|假装|扮演|演戏|台词|说一句|写一句|梦里|梦中|好像|像是|仿佛/.test(s)) return false;
  if (/[？?]|吗|是否|会不会|怎么|如何|假如|如果|倘若|假设|比喻|社死|笑死|累死|吓死|气死|尴尬死|死心|心死|装死|假死|不要|不想|不愿|拒绝|别|不能|不会|不死|避免|免于|防止|阻止|莫让|未死|没有死/.test(s)) return false;
  return /^(?:让|令|使)?(?:我自己|我|自己|本人)?(?:现在|立刻|立即|马上|当场|直接|就|要|决定|选择|进行|执行)*(?:自杀|自尽|自刎)(?:吧|了)?[。！!]*$/u.test(s)
    || /(?:杀死|杀掉|杀了|处死|弄死|赐死|抹杀|消灭)(?:我自己|我|自己|本人)(?:[，。！!]|$)/u.test(s)
    || /(?:让|令|使)?(?:我自己|我|本人)(?:现在|立刻|立即|马上|当场|直接|彻底|就|真的|原地|的肉身|的生命|的心脏|在此刻|此刻|当即|马上就|现在就)*(?:死亡|去世|死去|死掉|身死|毙命|灰飞烟灭|魂飞魄散|停止跳动|终结|归零|死)(?:吧|去|掉|了)?(?:[，。！!]|$)/u.test(s)
    || /(?:终结|结束)(?:我|自己)的生命(?:[，。！!]|$)/u.test(s);
}

export function validateRpgAcquisition(candidate, visibleText = '') {
  if (!record(candidate)) return null;
  const name = text(candidate.name, 48), evidence = text(candidate.evidence, 240), source = text(candidate.source, 80);
  const visible = String(visibleText);
  if (!name || !evidence || !source || !evidence.includes(name) || !visible.includes(evidence) || !visible.includes(source)
    || !/我|顾长生|宿主/.test(evidence) || !/获得|得到|收下|交给|赠予|学会|掌握|觉醒|授予/.test(evidence)
    || /没有|未能|尚未|不能|如果|假如|传闻|据说/.test(evidence)
    || !/致命|替命|复活|还魂|保命/.test(evidence) || !/一次|1次|一回|一枚|一颗/.test(evidence)
    || !['item', 'skill', 'system'].includes(candidate.kind) || candidate.trigger !== 'lethal'
    || Number(candidate.charges) !== 1 || !Number.isFinite(Number(candidate.restoreRatio))) return null;
  return { name, kind: candidate.kind, trigger: 'lethal', charges: 1,
    restoreRatio: number(candidate.restoreRatio, .01, 1, .25), source, evidence };
}

export function acquireRpgAsset(state, candidate, provenance = {}) {
  const definition = validateRpgAcquisition(candidate, provenance.visibleText);
  if (!definition || !provenance.sourceId || isPlayerDead(state)) return null;
  state.rpg ||= createRpgState();
  const id = `asset:${hash(`${provenance.sourceId}|${definition.name}`)}`;
  if (state.rpg.assets[id]) return state.rpg.assets[id];
  const asset = { id, name: definition.name, kind: definition.kind, trigger: 'lethal', charges: 1,
    restoreRatio: definition.restoreRatio, consumed: 0,
    provenance: { sourceId: text(provenance.sourceId, 100), source: definition.source, evidence: definition.evidence, turn: Number(state.memory?.turnCount || 0) + 1 } };
  state.rpg.assets[id] = asset;
  if (asset.kind === 'item') {
    state.inventory.items[asset.name] = Number(state.inventory.items[asset.name] || 0) + 1;
    if (!state.codex.items.includes(asset.name)) state.codex.items.push(asset.name);
  }
  if (asset.kind === 'skill' && !state.techniques.known.includes(asset.name)) state.techniques.known.push(asset.name);
  appendEvent(state, { kind: 'acquired', assetId: id, name: asset.name, sourceId: asset.provenance.sourceId, chargesRemaining: 1,
    text: `获得${asset.name}：致命时自动保命一次，恢复${Math.round(asset.restoreRatio * 100)}%气血；来源：${asset.provenance.source}。` });
  return asset;
}

// Only catalog entries explicitly authored with a lethal rule qualify. Ordinary
// 九转金丹 remains a healing pill; evocative names never imply resurrection.
export function reconcileCatalogProtection(state, sourceId = 'legacy:catalog') {
  state.rpg ||= createRpgState();
  for (const [name, amount] of Object.entries(state.inventory?.items || {})) {
    const rule = ITEMS[name]?.lifeProtection;
    if (!rule || amount <= 0) continue;
    const assets = Object.values(state.rpg.assets).filter(a => a.kind === 'item' && a.name === name);
    const live = assets.filter(a => a.charges > 0).length;
    for (let index = live; index < amount; index++) {
      const id = `catalog:${hash(name)}:${assets.length + index - live}`;
      state.rpg.assets[id] = { id, name, kind: 'item', trigger: 'lethal', charges: 1, restoreRatio: rule.restoreRatio, consumed: 0,
        provenance: { sourceId: text(sourceId, 100), source: sourceId === 'legacy:catalog' ? '旧存档已持有的规则物品' : '已结算物品获得',
          evidence: ITEMS[name].description, turn: Number(state.memory?.turnCount || 0) } };
    }
  }
  return state;
}

export function availableProtection(state) {
  return Object.values(state.rpg?.assets || {}).filter(a => a.charges > 0 && a.trigger === 'lethal'
    && a.provenance?.sourceId && (a.kind !== 'item' || Number(state.inventory?.items?.[a.name]) > 0)
    && (a.kind !== 'skill' || state.techniques?.known?.includes(a.name)));
}

export function resolvePlayerHealth(state, { delta = 0, cause = '致命伤势', sourceId = 'engine:health', explicitLethal = false } = {}) {
  state.rpg ||= createRpgState();
  if (isPlayerDead(state)) { normalizePlayerLife(state); return null; }
  const hpBefore = Number(state.player.hp);
  state.player.hp = explicitLethal ? 0 : number(hpBefore + Number(delta || 0), 0, state.player.maxHp);
  if (state.player.hp > 0) return null;
  reconcileCatalogProtection(state, sourceId);
  const asset = availableProtection(state)[0];
  if (asset) {
    asset.charges -= 1;
    asset.consumed += 1;
    if (asset.kind === 'item' && asset.charges === 0) {
      state.inventory.items[asset.name] = Math.max(0, Number(state.inventory.items[asset.name] || 0) - 1);
      if (!state.inventory.items[asset.name]) delete state.inventory.items[asset.name];
    }
    state.player.hp = Math.max(1, Math.floor(state.player.maxHp * asset.restoreRatio));
    state.story.flags.playerDead = false;
    return appendEvent(state, { kind: 'revival', assetId: asset.id, name: asset.name, sourceId, cause, hpBefore, hpAfter: state.player.hp,
      chargesRemaining: asset.charges, text: `${cause}使气血归零；已获${asset.name}（来源：${asset.provenance.source}）触发并消耗一次，气血恢复至${state.player.hp}，剩余${asset.charges}次。` });
  }
  markDead(state, cause, sourceId, hpBefore);
  return state.rpg.ledger.at(-1);
}

export function rpgEventsSince(before, after) {
  const ids = new Set((before.rpg?.ledger || []).map(e => e.id));
  return (after.rpg?.ledger || []).filter(e => !ids.has(e.id));
}

export function selectRpgContext(state, input = '') {
  const assets = availableProtection(state);
  const terms = [...new Set(String(input).match(/[\p{L}\p{N}]{2,}/gu) || [])];
  const score = text => terms.reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0);
  const relevant = values => [...values].sort((a, b) => score(JSON.stringify(b)) - score(JSON.stringify(a)));
  // Selection is bounded; the underlying inventory/charges are never trimmed.
  const selected = relevant(assets).slice(0, 3);
  const last = state.rpg?.ledger?.filter(e => e.kind === 'death' || e.kind === 'revival').at(-1);
  return { 生死: isPlayerDead(state) ? '已死亡，不能行动或疗伤复活' : '存活',
    保命: selected.map(a => [a.name, a.kind, a.charges, `致命时自动恢复${Math.round(a.restoreRatio * 100)}%气血`, text(a.provenance.source, 24)]),
    保命总数: assets.reduce((n, a) => n + a.charges, 0),
    ...(last ? { 结算: text(last.text, 100) } : {}),
    任务: relevant([...(state.quests?.active || []).map(q => `${q.id}:${q.progress}/${q.target}`),
      ...(state.quests?.completed || []).map(id => `${id}:已完成`), ...(state.quests?.failed || []).map(id => `${id}:已失败`)]).slice(0, 2),
    人物: relevant(Object.values(state.memory?.entities || {}).filter(e => e.status === 'dead' || e.status === 'missing' || input.includes(e.name)))
      .slice(0, 2).map(e => [e.name, e.status, text(state.relationshipStates?.[e.name]?.lastEvent, 40)]),
    规: '仅已登记保命可触发；普通疗伤、系统聊天次数、名字和正文不授予复活。结算不可改写。' };
}
