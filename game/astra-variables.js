import { initialAstraRules } from './astra-rules.js';
import { reconcileQuestArcs } from './astra-quests.js';

// All numeric effects use this registry. A save may tighten or extend bounds,
// while the engine still controls which entity fields are writable.
const DEFAULTS = initialAstraRules().variables;
const ENTITY_MAP = Object.freeze({ character: 'characters', faction: 'factions', location: 'locations' });
const LABELS = Object.freeze({ health: '气血', maxHealth: '气血上限', wealth: '财富', safety: '安全',
  power: '实力', stability: '稳定', population: '人口', risk: '危险' });
const fieldNames = Object.freeze({
  player: { '气血上限': 'maxHealth', 气血: 'health', 财富: 'wealth', 安全: 'safety' },
  character: { 财富: 'wealth' },
  faction: { 实力: 'power', 财富: 'wealth', 稳定: 'stability' },
  location: { 人口: 'population', 危险: 'risk' }
});

export function numericRule(world, kind, field) {
  const base = Object.hasOwn(DEFAULTS, kind) && Object.hasOwn(DEFAULTS[kind], field) ? DEFAULTS[kind][field] : null;
  if (!base) throw new Error('Engine 不支持修改该数值字段。');
  const override = world.rules?.variables?.[kind]?.[field];
  const candidate = override && typeof override === 'object' && !Array.isArray(override) ? override : {};
  const result = { ...base };
  for (const key of ['min', 'max']) if (Object.hasOwn(candidate, key)) {
    const value = Number(candidate[key]);
    if (!Number.isFinite(value)) throw new Error('世界数值边界无效。');
    result[key] = value;
  }
  if (result.max !== undefined && result.min > result.max) throw new Error('世界数值上下界冲突。');
  return result;
}

export function clampNumeric(world, kind, field, value, target) {
  const rule = numericRule(world, kind, field);
  const ref = rule.maxRef ? Number(target?.[rule.maxRef]) : Infinity;
  if (!Number.isFinite(ref) && ref !== Infinity) throw new Error('关联的数值上限无效。');
  const max = Math.min(rule.max ?? Infinity, ref);
  if (max < (rule.min ?? -Infinity)) throw new Error('当前数值边界相互冲突。');
  return Math.max(rule.min ?? -Infinity, Math.min(max, value));
}

export function applyNumericMutation(world, mutation) {
  const { kind, id, field, operation } = mutation || {};
  const rule = numericRule(world, kind, field);
  if (!['set', 'delta'].includes(operation)) throw new Error('数值操作无效。');
  const amount = Number(mutation.value);
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1000000) throw new Error('数值变化幅度无效。');
  const target = kind === 'player' && id === world.player?.id ? world.player : world[ENTITY_MAP[kind]]?.[id];
  if (!target || target.id !== id || kind === 'character' && !target.alive
    || kind === 'faction' && !target.active || kind === 'location' && target.destroyed)
    throw new Error('数值目标当前不可结算。');
  const before = Number(target[field]);
  if (!Number.isFinite(before)) throw new Error('目标的原有数值无效。');
  const after = clampNumeric(world, kind, field, operation === 'set' ? amount : before + amount, target);
  target[field] = after;
  const related = [];
  if (kind === 'player' && field === 'maxHealth' && target.health > after) {
    related.push({ field: 'health', from: target.health, to: after });
    target.health = after;
  }
  if (kind === 'faction' && (field === 'power' || field === 'stability')
    && (target.power <= 0 || target.stability <= 0) && target.active) {
    const formerMembers = Object.values(world.characters || {})
      .filter(character => character.factionId === target.id).map(character => character.id);
    target.active = false;
    target.wars = [];
    for (const location of Object.values(world.locations || {}))
      if (location.controllerFactionId === target.id) location.controllerFactionId = null;
    for (const character of Object.values(world.characters || {}))
      if (character.factionId === target.id) character.factionId = null;
    target.territories = [];
    target.memberIds = [];
    target.leaderId = null;
    related.push({ field: 'active', from: true, to: false });
    reconcileQuestArcs(world, { type: 'faction_change', factionId: target.id, affectedActorIds: formerMembers });
  }
  return { applied: after !== before || related.length > 0, kind, targetId: id, field,
    requested: amount, actualDelta: after - before, before, after, related,
    summary: after === before && !related.length ? `${LABELS[field]}已到当前边界，数值未变。`
      : `${target.name || '目标'}的${LABELS[field]}变为${after}${related.some(change => change.field === 'active') ? '，势力随之瓦解' : related.length ? '，气血随上限调整' : ''}。` };
}

export function parseNumericWish(world, request) {
  const match = String(request).match(/(气血上限|气血|财富|安全|实力|稳定|人口|危险)\s*(增加|提升|提高|减少|降低|设为|改为|变成)\s*(\d{1,7})/u);
  if (!match) return null;
  const [, label, verb, digits] = match;
  const named = [
    ...Object.values(world.characters || {}).map(entity => ({ entity, kind: 'character' })),
    ...Object.values(world.factions || {}).map(entity => ({ entity, kind: 'faction' })),
    ...Object.values(world.locations || {}).map(entity => ({ entity, kind: 'location' }))
  ].filter(({ entity }) => entity?.name && request.includes(entity.name))
    .sort((a, b) => b.entity.name.length - a.entity.name.length)[0];
  const target = named || (/我(?:的)?|自己(?:的)?|本人(?:的)?|主角(?:的)?/u.test(request)
    ? { entity: world.player, kind: 'player' } : null);
  if (!target) throw new Error('数值改写需要指明当前存在的人物、势力、地点或自己。');
  const field = fieldNames[target.kind][label];
  if (!field) throw new Error('目标没有可以这样改写的属性。');
  const value = Number(digits);
  if (value > 1000000) throw new Error('数值变化幅度无效。');
  const operation = /设为|改为|变成/u.test(verb) ? 'set' : 'delta';
  return { kind: target.kind, id: target.entity.id, field, operation,
    value: /减少|降低/u.test(verb) ? -value : value };
}
