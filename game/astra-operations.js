import { assertSafeData, worldEntity, validateCondition, validateConditionReferences, evaluateCondition } from './astra-expression.js';
import { ensureSimulation, recordCausalEvent, captureWorldChanges, companionNotification, isSpeculativeInput } from './astra-causality.js';
import { applyNumericMutation } from './astra-variables.js';
import { resolveStructuredEffect, consumeGeneratedItem } from './astra-effects.js';
import { killNpc } from './astra-reality.js';
import { checkTerminalWorld } from './astra-terminal.js';
import { reconcileQuestArcs } from './astra-quests.js';
export { evaluateCondition } from './astra-expression.js';

const domains = { character: 'characters', faction: 'factions', location: 'locations', item: 'items' };
const clean = (value, max = 400) => String(value || '').replace(/[<>\u0000-\u001f]/gu, '').trim().slice(0, max);
const fail = message => { throw new Error(message); };
function validId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9:_-]{1,99}$/u.test(id)
    || ['constructor', 'prototype', '__proto__'].includes(id)) fail('世界实体或规则编号无效。');
}
function requireEntity(world, id) { return worldEntity(world, id) || fail('提案引用了不存在的实体：' + id); }
function present(world, id) {
  const npc = world.characters[id];
  return !world.player.travel && npc?.alive && !npc.travel && npc.locationId === world.player.locationId;
}
function inputAction(context) {
  const action = context.input?.action || '';
  return /假如|如果|假设|不要|不想|开玩笑|「|“|"/u.test(action) ? '' : action;
}
const worldScope = value => /天下|全世界|整个世界|世界规则|世界法则|所有(?:人|生命|人物|势力|地点)|全部(?:人|生命|人物|势力|地点)/u.test(value);
function authorizeScope(world, op, context) {
  if (!context.enforceScope || context.mode !== 'reality' || op.type === 'concept.defer') return;
  const input = String(context.input?.action || context.input?.speech || '');
  if (isSpeculativeInput(input)) fail('假设或询问不授权执行言灵。');
  if (worldScope(input)) return;
  const creative = /创造|诞生|变出|制造|炼成|出现|召唤|生成|造出/u.test(input);
  if (op.type === 'entity.create' && !creative) fail('本轮没有授权创造新实体。');
  if (op.type === 'quest.create' && !/任务|委托|目标/u.test(input)) fail('本轮没有授权创造委托。');
  const targetIds = op.type === 'entity.update' ? [op.targetId]
    : op.type.startsWith('relation.') ? [op.fromId, op.toId]
      : op.type === 'resource.transfer' ? [op.fromId, op.toId, op.itemId]
        : op.type === 'effect.apply' ? [op.itemId] : [];
  if (op.type.startsWith('relation.') && !/关系|所属|加入|脱离|信任|依恋|关联|结盟/u.test(input)) fail('本轮没有授权改写关系。');
  for (const id of targetIds) {
    const entity = requireEntity(world, id);
    if (!(id === 'player' ? /我|自己|本人|主角/u.test(input) : input.includes(entity.name))) fail('言灵超出了明确指令中的目标范围。');
  }
  const remoteLocation = op.type === 'entity.create' ? op.entity.locationId || op.entity.homeId
    : op.type === 'quest.create' ? op.quest.targetLocationId : null;
  if (remoteLocation && remoteLocation !== world.player.locationId
    && !input.includes(world.locations[remoteLocation]?.name || '\u0000')) fail('未指定新实体的远处落点。');
}
function effectsValid(effects, world) {
  if (!Array.isArray(effects) || !effects.length || effects.length > 8) fail('效果列表无效。');
  for (const effect of effects) {
    if (effect.condition) validateConditionReferences(world, effect.condition);
    if (!['cultivation.advance_major_realm', 'heal', 'stat.delta'].includes(effect?.type)
      || effect.target !== 'player') fail('效果没有可结算的类型或目标。');
    if (effect.type === 'stat.delta' && (!['health', 'wealth', 'safety'].includes(effect.field)
      || !Number.isSafeInteger(effect.magnitude) || Math.abs(effect.magnitude) > 1000000)) fail('属性效果数值无效。');
    if (effect.type === 'cultivation.advance_major_realm' && (!Number.isInteger(effect.magnitude)
      || effect.magnitude < 1 || effect.magnitude > 3)) fail('境界效果幅度无效。');
    if (effect.type === 'heal' && effect.magnitude !== 'full' && !(Number.isSafeInteger(effect.magnitude) && effect.magnitude > 0)) fail('治愈效果幅度无效。');
  }
}
function createEntity(world, operation, context) {
  if (context.mode !== 'reality') fail('普通输入不能凭空创造实体；可提出有真实来源的任务。');
  const { kind, entity } = operation;
  const domain = domains[kind];
  if (!domain || !entity?.id || !clean(entity.name, 60)) fail('新实体缺少类型、编号或名称。');
  if (worldEntity(world, entity.id)) fail('新实体编号已存在。');
  validId(entity.id);
  const base = { id: entity.id, name: clean(entity.name, 60), generated: true, originTurnId: context.turnId,
    createdAt: world.minute, description: clean(entity.description) };
  if (kind === 'character') {
    const locationId = entity.locationId || world.player.locationId;
    if (!world.locations[locationId] || world.locations[locationId].destroyed) fail('新人物的地点不可用。');
    world[domain][entity.id] = { ...base, alive: true, age: 20, gender: clean(entity.gender, 32),
      occupation: clean(entity.occupation, 60), locationId, homeId: locationId, factionId: null,
      cultivation: { realm: 'none', level: 0 }, physicalCondition: 'healthy', wealth: 0,
      inventory: [], relationships: {}, knowledge: [], memories: [], family: {}, goals: (entity.goals || []).map(x => clean(x, 100)).slice(0, 8),
      currentGoals: [], travel: null, simulationImportance: 'local' };
  } else if (kind === 'item') {
    effectsValid(entity.effects, world);
    const owner = requireEntity(world, entity.ownerId || 'player');
    if (!Array.isArray(owner.inventory) || owner.alive === false) fail('物品所有者无效。');
    const quantity = entity.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) fail('物品数量无效。');
    world[domain][entity.id] = { ...base, templateId: 'generated:' + entity.id, category: clean(entity.category, 30),
      ownerId: owner.id, locationId: owner.locationId, quantity, effects: structuredClone(entity.effects),
      durability: 100, destroyed: false, creationHistory: [{ minute: world.minute, source: context.turnId }], transferHistory: [] };
    owner.inventory.push(entity.id);
  } else if (kind === 'faction') {
    const homeId = entity.homeId || world.player.locationId;
    if (!world.locations[homeId] || world.locations[homeId].destroyed) fail('势力驻地无效。');
    world[domain][entity.id] = { ...base, active: true, homeId, power: 20, stability: 50, wealth: 0,
      leaderId: null, memberIds: [], territories: [], wars: [], relations: {} };
  } else world[domain][entity.id] = { ...base, destroyed: false, closed: false, population: 0,
    risk: 0, controllerFactionId: null, regionId: world.locations[world.player.locationId].regionId };
}
function updateEntity(world, op, context) {
  const target = requireEntity(world, op.targetId);
  const changes = op.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('实体变化无效。');
  const kind = target.id === 'player' ? 'player' : Object.entries(domains).find(([, domain]) => world[domain]?.[target.id])?.[0];
  if (context.enforceScope) {
    const input = String(context.input?.action || context.input?.speech || '');
    const global = worldScope(input);
    if (!global && !(target.id === 'player' ? /我|自己|本人|主角/u.test(input) : input.includes(target.name)))
      fail('言灵提案超出了玩家明确指定的目标范围。');
  }
  for (const [field, value] of Object.entries(changes)) {
    if (context.mode !== 'reality') fail('直接属性改写需要言出法随；普通动作须用有前置条件的效果或转移。');
    if (['name', 'gender', 'occupation', 'description', 'physicalCondition'].includes(field)) {
      if (typeof value !== 'string' || !clean(value)) fail('身份属性无效。');
      target[field] = clean(value, field === 'description' ? 400 : 60);
    } else if (['goals', 'currentGoals'].includes(field)) {
      if (!Array.isArray(value) || value.some(x => typeof x !== 'string')) fail('人物目标无效。');
      target[field] = value.map(x => clean(x, 100)).slice(0, 8);
    } else if (['health', 'maxHealth', 'wealth', 'safety', 'power', 'stability', 'population', 'risk'].includes(field)) {
      applyNumericMutation(world, { kind, id: target.id, field, operation: 'set', value });
    } else if (field === 'alive' && kind === 'character' && typeof value === 'boolean') {
      if (!value) killNpc(world, target, context.turnId);
      else {
        const locationId = target.lastKnownLocationId || target.homeId || world.player.locationId;
        if (world.locations[locationId]?.destroyed) fail('复生人物没有可用的落点。');
        target.alive = true; target.deathAt = null; target.locationId = locationId;
        target.travel = null; target.physicalCondition = 'recovering';
      }
    }
    else fail('属性尚无机械规则：' + field);
  }
}
function transfer(world, op, context) {
  const item = world.items[op.itemId];
  const from = requireEntity(world, op.fromId), to = requireEntity(world, op.toId);
  if (!item || item.destroyed || item.ownerId !== from.id || !from.inventory?.includes(item.id)
    || !Array.isArray(to.inventory) || !to.alive || from.id === to.id) fail('物品转移的所有权或人物无效。');
  if (context.mode !== 'reality') {
    const action = inputAction(context);
    if (from.id !== 'player' || !present(world, to.id) || !action.includes(item.name)
      || !action.includes(to.name) || !/给|交|送|赠/u.test(action)) fail('普通物品转移未获本轮真实动作授权。');
  }
  from.inventory = from.inventory.filter(id => id !== item.id);
  to.inventory.push(item.id);
  item.ownerId = to.id; item.locationId = to.locationId;
  item.transferHistory ||= [];
  item.transferHistory.push({ from: from.id, to: to.id, minute: world.minute, source: context.turnId });
  recordCausalEvent(world, { id: context.turnId + ':transfer:' + item.id, actorId: from.id, targetIds: [to.id],
    action: 'give', locationId: world.player.locationId, summary: from.name + '将' + item.name + '交给' + to.name + '。',
    impacts: [{ entityId: to.id, dimension: 'resources', delta: 0.2 }] });
}
function relation(world, op, context) {
  if (context.mode !== 'reality') fail('普通关系变化应来自社会认知提案。');
  const from = requireEntity(world, op.fromId), to = requireEntity(world, op.toId);
  if (!['member', 'attachment', 'trust'].includes(op.kind)) fail('关联类型尚无机械结算。');
  const sim = ensureSimulation(world), id = from.id + '|' + op.kind + '|' + to.id;
  const active = op.type !== 'relation.remove';
  sim.relations[id] = { id, fromId: from.id, toId: to.id, kind: op.kind, active,
    weight: Math.max(-1, Math.min(1, Number(op.weight ?? 0.5))), sourceId: context.turnId, minute: world.minute };
  if (op.kind === 'member') {
    if (!world.characters[from.id] || !world.factions[to.id]?.active) fail('成员关系目标无效。');
    const old = world.factions[from.factionId];
    if (old) old.memberIds = old.memberIds.filter(id => id !== from.id);
    from.factionId = active ? to.id : null;
    to.memberIds = [...new Set((to.memberIds || []).filter(id => id !== from.id).concat(active ? [from.id] : []))];
  } else if (op.kind === 'attachment') {
    from.attachments = (from.attachments || []).filter(row => (row.entityId || row) !== to.id);
    if (active) from.attachments.push({ entityId: to.id, sourceId: context.turnId });
  } else {
    from.relationships ||= {};
    from.relationships[to.id] = active ? Math.round(sim.relations[id].weight * 100) : 0;
  }
}
function createQuest(world, op, context) {
  const q = op.quest;
  if (!q?.id || worldEntity(world, q.id) || !clean(q.title, 80)) fail('任务编号或标题无效。');
  validId(q.id);
  const giver = world.characters[q.giverId];
  if (!giver?.alive || !world.locations[q.targetLocationId] || world.locations[q.targetLocationId].destroyed) fail('任务来源或地点无效。');
  if (context.mode !== 'reality' && !present(world, giver.id)) fail('普通委托须由真实在场人物提出。');
  validateConditionReferences(world, q.condition);
  if (context.mode !== 'reality' && evaluateCondition(world, q.condition)) fail('新委托不能用当前已满足的无关事实直接领取奖励。');
  effectsValid(q.reward, world);
  if (context.mode !== 'reality') {
    // A gift of money cannot be minted by narration; reserve a real giver budget.
    if (q.reward.some(effect => effect.type !== 'stat.delta' || effect.field !== 'wealth' || effect.magnitude <= 0))
      fail('普通任务奖励必须由委托人真实持有的财物兑现。');
    const budget = q.reward.reduce((sum, effect) => sum + effect.magnitude, 0);
    const reserved = Object.values(world.quests).filter(quest => quest.giverId === giver.id
      && ['active', 'available', 'mutated'].includes(quest.state)).reduce((sum, quest) => sum + Number(quest.reservedReward || 0), 0);
    if (budget + reserved > giver.wealth) fail('委托人无力兑现这些任务奖励。');
  }
  world.quests[q.id] = { id: q.id, title: clean(q.title, 80), summary: clean(q.summary), generated: true,
    originEventId: context.turnId, giverId: giver.id, offerLocationId: giver.locationId, targetId: null, targetLocationId: q.targetLocationId,
    condition: structuredClone(q.condition), rewardEffects: structuredClone(q.reward), state: 'available',
    participants: [giver.id], primaryGoals: [clean(q.summary || q.title)], optionalGoals: [], hiddenGoals: [],
    deadline: world.minute + Math.max(60, Math.min(365 * 1440, Number(q.durationMinutes) || 1440)),
    rewards: ['委托人的实付奖励'], lostRewards: [], earnedRewards: [], followUpArcs: [], worldConsequences: [], stateHistory: [],
    reservedReward: context.mode === 'reality' ? 0 : q.reward.reduce((sum, x) => sum + x.magnitude, 0),
    createdAt: world.minute, updatedAt: world.minute };
  companionNotification(world, q.id + ':available', '宿主，' + giver.name + '提出了“' + clean(q.title, 80) + '”。接不接由你，完成条件和奖励已经记入命簿。', context.turnId);
}
function social(world, op, context) {
  const npc = world.characters[op.observerId];
  if (!npc || !present(world, npc.id) || op.subjectId !== 'player') fail('社会认知必须有真实听者和主体。');
  const input = String(context.input?.speech || '') + String(context.input?.action || '');
  if (!op.evidence || !input.includes(op.evidence)) fail('社会认知缺少本轮输入证据。');
  if (!['threat', 'promise', 'help', 'insult', 'affection', 'question'].includes(op.meaning)
    || !Number.isFinite(op.valence) || Math.abs(op.valence) > 1) fail('社会认知类型无效。');
  const sim = ensureSimulation(world);
  const id = context.turnId + ':social:' + npc.id;
  if (sim.beliefs[id]) fail('同一人物反应重复。');
  const delta = Math.round(op.valence * 6);
  npc.relationships ||= {};
  npc.relationships.player = Math.max(-100, Math.min(100, Number(npc.relationships.player || 0) + delta));
  sim.beliefs[id] = { id, holderId: npc.id, eventId: context.turnId, subjectId: 'player',
    mode: 'interpretation', confidence: 0.8, minute: world.minute, appraisal: delta,
    meaning: op.meaning, summary: clean(op.reason || op.evidence) };
  recordCausalEvent(world, { id, actorId: 'player', action: op.meaning, targetIds: [npc.id],
    sourceId: context.turnId, locationId: world.player.locationId, witnessIds: [npc.id],
    summary: npc.name + '对本轮言行作出了自己的判断。', impacts: [] });
  if (delta) npc.currentPlan = { id: 'plan:' + id, type: delta < 0 ? 'avoid' : 'support',
    state: 'pending', targetId: 'player', causeEventId: id, confidence: 0.8, createdAt: world.minute };
}
export function applyWorldPlan(source, plan, context) {
  assertSafeData(plan);
  if (!context?.turnId || !['ordinary', 'reality'].includes(context.mode)) fail('提案缺少回合或执行范围。');
  if (JSON.stringify(plan).length > 18000 || !Array.isArray(plan?.operations) || plan.operations.length > 24)
    fail('提案超出本轮有界预算。');
  const world = structuredClone(source);
  let sim = ensureSimulation(world);
  if (sim.transactions[context.turnId]) return { world, events: [] };
  const eventStart = new Set(Object.keys(sim.events));
  const consumed = new Set();
  for (const op of plan.operations) {
    sim = ensureSimulation(world);
    authorizeScope(world, op, context);
    if (op.condition) {
      validateConditionReferences(world, op.condition);
      if (!evaluateCondition(world, op.condition)) fail('操作前置条件尚未满足。');
    }
    switch (op.type) {
      case 'entity.create': createEntity(world, op, context); break;
      case 'entity.update': updateEntity(world, op, context); break;
      case 'resource.transfer': transfer(world, op, context); break;
      case 'relation.upsert': case 'relation.remove': relation(world, op, context); break;
      case 'quest.create': createQuest(world, op, context); break;
      case 'social.observe': social(world, op, context); break;
      case 'effect.apply': {
        if (consumed.has(op.itemId) || context.settledAction === 'use_generated_item'
          && (!context.settledItemId || context.settledItemId === op.itemId)) fail('这件物品的本轮使用已经结算，不能重复消费。');
        consumed.add(op.itemId);
        const item = world.items[op.itemId];
        if (context.mode !== 'reality' && (!item || !inputAction(context).includes(item.name)
          || !/用|服|吞|吃/u.test(inputAction(context)))) fail('物品使用未获动作授权。');
        const used = consumeGeneratedItem(world, op.itemId);
        Object.assign(world, used.world); break;
      }
      case 'rule.upsert': {
        if (context.mode !== 'reality') fail('世界规则改写需要明确的言出法随。');
        if (context.enforceScope && !worldScope(context.input?.action || context.input?.speech || ''))
          fail('个人言灵不能暗中改写整个世界规则。');
        const rule = op.rule;
        if (!rule?.id || !rule.trigger || !clean(rule.trigger, 60)) fail('规则缺少事件触发条件。');
        validId(rule.id);
        validateConditionReferences(world, rule.condition, ['actor', 'target']); effectsValid(rule.effects, world);
        world.simulation.rules[rule.id] = { ...structuredClone(rule), version: Number(world.simulation.rules[rule.id]?.version || 0) + 1,
          sourceId: context.turnId, minute: world.minute };
        break;
      }
      case 'concept.defer':
        if (!clean(op.description)) fail('待解释概念缺少说明。');
        sim.commitments[context.turnId] = { id: context.turnId, state: 'unresolved',
          description: clean(op.description), reason: clean(op.reason), minute: world.minute };
        companionNotification(world, 'deferred:' + context.turnId, '宿主，这个改写还没有可验证的规则，暂未生效：' + clean(op.reason || op.description), context.turnId);
        break;
      default: fail('未知世界操作：' + op.type);
    }
  }
  captureWorldChanges(source, world, { ...context, action: context.mode === 'reality' ? 'rewrite' : 'change' });
  if (context.mode === 'reality') {
    const costs = { 'entity.create': 24, 'entity.update': 8, 'relation.upsert': 6, 'relation.remove': 6,
      'rule.upsert': 30, 'quest.create': 12, 'resource.transfer': 4, 'effect.apply': 4 };
    const cost = plan.operations.reduce((sum, op) => {
      if (op.type === 'entity.update') {
        const prior = worldEntity(source, op.targetId);
        if (prior && Object.entries(op.changes).every(([field, value]) => JSON.stringify(prior[field]) === JSON.stringify(value))) return sum;
      }
      return sum + (costs[op.type] || 0);
    }, 0);
    if (cost) {
      world.flags.causalDebt = Number(world.flags.causalDebt || 0) + cost;
      if (!world.player.invincible) world.player.health = Math.max(0, world.player.health - Math.min(40, Math.ceil(cost / 3)));
      companionNotification(world, 'cost:' + context.turnId, '言灵已落账，新增因果债：' + cost + '。', context.turnId);
    }
  }
  reconcileQuestArcs(world); checkTerminalWorld(world);
  world.simulation.transactions[context.turnId] = { id: context.turnId, minute: world.minute, operations: plan.operations.length };
  return { world, events: Object.values(world.simulation.events).filter(event => !eventStart.has(event.id)) };
}

export function settleWorldRules(world, events) {
  if (world.terminal?.ended) return world;
  const sim = ensureSimulation(world);
  sim.pendingRuleEffects ||= [];
  let budget = 64;
  const jobs = [...sim.pendingRuleEffects];
  const queued = new Set(jobs.map(job => job.key));
  for (const rule of Object.values(sim.rules)) for (const event of events) {
    const key = 'rule:' + rule.id + ':' + rule.version + ':' + event.id;
    if (queued.has(key) || world.simulation.transactions[key] || event.action !== rule.trigger) continue;
    queued.add(key); jobs.push({ key, ruleId: rule.id, ruleVersion: rule.version, event: structuredClone(event) });
  }
  world.simulation.pendingRuleEffects = [];
  for (const job of jobs) {
    const rule = world.simulation.rules[job.ruleId], event = job.event, key = job.key;
    if (!rule || rule.version !== job.ruleVersion || world.simulation.transactions[key]) continue;
    if (budget <= 0) { world.simulation.pendingRuleEffects.push(job); continue; }
    if (!evaluateCondition(world, rule.condition, { actor: event.actorId, target: event.targetIds?.[0] })) continue;
    // Validate/apply each rule as a unit, so a bad legacy rule cannot leak partial effects.
    const draft = structuredClone(world);
    try {
      for (const effect of rule.effects) resolveStructuredEffect(draft, effect);
      draft.simulation.transactions[key] = { id: key, sourceId: event.id, minute: world.minute };
      Object.assign(world, draft); budget--;
    } catch (error) { companionNotification(world, 'rule-error:' + key, '一条世界规则暂无法结算：' + clean(error.message), event.id); }
  }
  for (const quest of Object.values(world.quests).filter(q => q.generated && q.condition && q.state === 'active')) {
    if (budget-- <= 0 || !evaluateCondition(world, quest.condition)) continue;
    const giver = world.characters[quest.giverId];
    const reserved = Number(quest.reservedReward || 0);
    if (reserved && (!giver?.alive || giver.wealth < reserved)) continue;
    const draft = structuredClone(world), next = draft.quests[quest.id];
    for (const effect of quest.rewardEffects) resolveStructuredEffect(draft, effect);
    if (reserved) draft.characters[quest.giverId].wealth -= reserved;
    next.state = 'completed'; next.updatedAt = world.minute;
    next.earnedRewards = [...next.rewards];
    draft.history.push({ id: quest.id + ':completed', minute: world.minute, type: 'quest_state',
      locationId: quest.targetLocationId, actors: ['player', quest.giverId], summary: quest.title + '完成，奖励已经兑现。', playerWitnessed: true, major: true });
    companionNotification(draft, quest.id + ':completed', '宿主，' + quest.title + '已经办成，奖励也记到账上了。', quest.id);
    Object.assign(world, draft);
  }
  checkTerminalWorld(world);
  return world;
}
