import { seedHash } from './astra-seed.js';

const INITIAL_REALMS = Object.freeze([
  ['none', '凡人'], ['qi_refining', '炼气'], ['foundation', '筑基'],
  ['golden_core', '金丹'], ['nascent_soul', '元婴'],
  ['spirit_transformation', '化神'], ['void_refining', '炼虚'],
  ['integration', '合体'], ['tribulation', '渡劫']
]);

export function initialAstraRules() {
  return { cultivation: {
    realms: INITIAL_REALMS.map(([id, name]) => ({ id, name })),
    globalMaximum: INITIAL_REALMS.at(-1)[0]
  }, variables: {
    player: { health: { min: 0, maxRef: 'maxHealth' }, maxHealth: { min: 1 }, wealth: { min: 0 }, safety: { min: 0, max: 100 } },
    character: { wealth: { min: 0 } },
    faction: { power: { min: 0, max: 100 }, wealth: { min: 0 }, stability: { min: 0, max: 100 } },
    location: { population: { min: 0 }, risk: { min: 0, max: 100 } }
  } };
}

export function realmRules(world) {
  const value = world?.rules?.cultivation;
  const realms = value?.realms;
  if (!Array.isArray(realms) || !realms.length || realms[0]?.id !== 'none'
    || new Set(realms.map(entry => entry?.id)).size !== realms.length) return initialAstraRules().cultivation;
  const globalMaximum = realms.some(entry => entry.id === value.globalMaximum)
    ? value.globalMaximum : realms.at(-1).id;
  return { ...value, realms, globalMaximum };
}

export function realmLabel(world, id) {
  return realmRules(world).realms.find(entry => entry.id === id)?.name || String(id || '未知境界');
}

export function effectiveRealmCap(world, actor) {
  const rules = realmRules(world);
  const personal = actor?.cultivation?.maxRealmId;
  return rules.realms.some(entry => entry.id === personal) ? personal : rules.globalMaximum;
}

export function realmRank(world, id) {
  return realmRules(world).realms.findIndex(entry => entry.id === id);
}

export function advanceRealm(world, actor, requestedSteps = 1) {
  const rules = realmRules(world);
  const current = rules.realms.findIndex(entry => entry.id === (actor?.cultivation?.realm || 'none'));
  const cap = rules.realms.findIndex(entry => entry.id === effectiveRealmCap(world, actor));
  if (current < 0 || cap < 0) throw new Error('当前境界不在世界规则表中，不能结算提升。');
  const steps = Number(requestedSteps);
  if (!Number.isInteger(steps) || steps < 1 || steps > 3) throw new Error('境界提升幅度无效。');
  const target = Math.min(current + steps, cap);
  if (target <= current) return { applied: false, from: rules.realms[current].id,
    to: rules.realms[current].id, steps: 0, reason: '当前境界已达到允许的上限' };
  const from = rules.realms[current].id;
  actor.cultivation = { ...actor.cultivation, realm: rules.realms[target].id, level: 1 };
  return { applied: true, from, to: actor.cultivation.realm, steps: target - current,
    reason: `境界提升至${realmLabel(world, actor.cultivation.realm)}` };
}

export function setRealmToCap(world, actor) {
  const rules = realmRules(world);
  const from = actor?.cultivation?.realm || 'none';
  const to = effectiveRealmCap(world, actor);
  const before = rules.realms.findIndex(entry => entry.id === from);
  const after = rules.realms.findIndex(entry => entry.id === to);
  if (before < 0 || after < 0) throw new Error('境界规则与角色状态不一致。');
  if (before === after) return { applied: false, from, to, steps: 0, reason: '已经处于当前允许的最高境界' };
  actor.cultivation = { ...actor.cultivation, realm: to, level: 1 };
  return { applied: true, from, to, steps: after - before,
    reason: `境界改写为${realmLabel(world, to)}` };
}

export function rewriteRealmCap(world, name, scope = 'personal', actor = world.player) {
  const label = String(name || '').replace(/[<>\u0000-\u001f]/gu, '').trim().slice(0, 32);
  if (!label || !/境$/u.test(label)) throw new Error('请写明新的境界名称（以“境”结尾）。');
  if (!['personal', 'world'].includes(scope)) throw new Error('境界规则改写范围无效。');
  world.rules ||= initialAstraRules();
  world.rules.cultivation = structuredClone(realmRules(world));
  const rules = world.rules.cultivation;
  let realm = rules.realms.find(entry => entry.name === label);
  if (!realm) {
    const id = `realm:generated:${seedHash(world.seed, `realm:${label}`).toString(16)}`;
    realm = { id, name: label, createdAt: world.minute };
    rules.realms.push(realm);
  }
  const previous = scope === 'world' ? rules.globalMaximum : actor?.cultivation?.maxRealmId || rules.globalMaximum;
  if (scope === 'world') rules.globalMaximum = realm.id;
  else {
    if (!actor?.cultivation) throw new Error('个人境界改写缺少目标角色。');
    actor.cultivation.maxRealmId = realm.id;
  }
  return { id: realm.id, name: realm.name, scope, changed: previous !== realm.id };
}
