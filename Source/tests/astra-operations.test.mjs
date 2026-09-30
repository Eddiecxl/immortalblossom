import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld } from '../../game/astra-world.js';
import * as ops from '../../game/astra-operations.js';
const context = { turnId: 'tx:test', mode: 'reality', input: { speech: '言出法随：改变世界', action: '' } };
const plan = operations => ({ operations });
test('typed changes preserve identity and rollback every earlier operation on failure', () => {
  assert.equal(typeof ops.applyWorldPlan, 'function');
  const world = createAstraWorld('atomic-world');
  const npc = Object.values(world.characters)[0];
  const before = JSON.stringify(world);
  assert.throws(() => ops.applyWorldPlan(world, plan([
    { type: 'entity.update', targetId: npc.id, changes: { gender: '女', name: '新名' } },
    { type: 'entity.update', targetId: 'missing', changes: { name: '幽灵' } }
  ]), context));
  assert.equal(JSON.stringify(world), before);
  const result = ops.applyWorldPlan(world, plan([{ type: 'entity.update', targetId: npc.id,
    changes: { gender: '女', name: '新名' } }]), context);
  assert.equal(result.world.characters[npc.id].id, npc.id);
  assert.equal(result.world.characters[npc.id].gender, '女');
  assert.equal(result.world.characters[npc.id].family.spouseId, npc.family.spouseId);
  assert.equal(ops.applyWorldPlan(result.world, plan([{ type: 'entity.update', targetId: npc.id,
    changes: { name: '重复结算' } }]), context).world.characters[npc.id].name, '新名');
});
test('resource transfers update both inventories and cannot duplicate ownership', () => {
  const world = createAstraWorld('transfer');
  const npc = Object.values(world.characters).find(n => n.alive);
  npc.locationId = world.player.locationId; npc.travel = null;
  const item = world.items[world.player.inventory[0]];
  const result = ops.applyWorldPlan(world, plan([{ type: 'resource.transfer', itemId: item.id,
    fromId: 'player', toId: npc.id }]), { ...context, mode: 'ordinary',
    input: { action: '把' + item.name + '交给' + npc.name, speech: '' } });
  assert.equal(result.world.items[item.id].ownerId, npc.id);
  assert.equal(result.world.player.inventory.includes(item.id), false);
  assert.equal(result.world.characters[npc.id].inventory.includes(item.id), true);
  assert.throws(() => ops.applyWorldPlan(world, plan([{ type: 'resource.transfer', itemId: item.id,
    fromId: npc.id, toId: 'player' }]), context));
});
test('speech threats cannot become mechanical kills; rule code and prototype writes are rejected', () => {
  const world = createAstraWorld('speech-control');
  const npc = Object.values(world.characters)[0];
  assert.throws(() => ops.applyWorldPlan(world, plan([{ type: 'entity.update', targetId: npc.id,
    changes: { alive: false } }]), { ...context, mode: 'ordinary', input: { speech: '我要杀你', action: '' } }));
  assert.equal(npc.alive, true);
  assert.throws(() => ops.applyWorldPlan(world, plan([{ type: 'rule.upsert', rule: { id: 'rule:bad',
    trigger: 'change', condition: { javascript: 'process.exit()' }, effects: [] } }]), context));
  assert.throws(() => ops.applyWorldPlan(world, JSON.parse('{"operations":[{"type":"entity.update","targetId":"player","changes":{"__proto__":{"bad":true}}}]}'), context));
});
test('generic conditions and rewards settle dynamic quests once with branch-safe state', () => {
  const world = createAstraWorld('dynamic-task');
  const npc = Object.values(world.characters)[0];
  npc.locationId = world.player.locationId; npc.travel = null;
  const quest = { id: 'quest:generated:help', title: '帮忙', giverId: npc.id,
    targetLocationId: world.player.locationId, condition: { op: 'gte', left: { entityId: 'player', field: 'wealth' }, right: 1000 },
    reward: [{ type: 'stat.delta', target: 'player', field: 'health', magnitude: 10 }] };
  const created = ops.applyWorldPlan(world, plan([{ type: 'quest.create', quest }]), context).world;
  created.quests[quest.id].state = 'active'; created.player.health = 30;
  ops.settleWorldRules(created, []);
  assert.equal(created.quests[quest.id].state, 'active');
  created.player.wealth = 1000;
  ops.settleWorldRules(created, []);
  assert.equal(created.quests[quest.id].state, 'completed');
  assert.equal(created.player.health, 40);
  ops.settleWorldRules(created, []);
  assert.equal(created.player.health, 40);
  assert.equal(world.quests[quest.id], undefined);
});
test('declarative item effects obey current caps instead of a seed-specific special case', () => {
  for (const seed of ['limit1', 'limit2', 'limit3']) {
    const world = createAstraWorld(seed);
    const result = ops.applyWorldPlan(world, plan([{ type: 'entity.create', kind: 'item', entity: {
      id: 'item:generated:ascend', name: '升境丹', ownerId: 'player', quantity: 1,
      effects: [{ type: 'cultivation.advance_major_realm', target: 'player', magnitude: 1 }]
    } }]), context);
    const cap = result.world.rules.cultivation.globalMaximum;
    result.world.player.cultivation.realm = cap;
    const used = ops.applyWorldPlan(result.world, plan([{ type: 'effect.apply', itemId: 'item:generated:ascend' }]),
      { ...context, turnId: 'tx:use', mode: 'ordinary', input: { action: '服用升境丹', speech: '' } });
    assert.equal(used.world.player.cultivation.realm, cap);
    assert.equal(used.world.items['item:generated:ascend'].destroyed, true);
  }
});
test('declarative rules run once per source event and reject unbounded recursion', () => {
  const world = createAstraWorld('rule-once');
  const result = ops.applyWorldPlan(world, plan([{ type: 'rule.upsert', rule: {
    id: 'rule:care', trigger: 'aid', condition: { op: 'lt', left: { entityId: 'player', field: 'health' }, right: 100 },
    effects: [{ type: 'stat.delta', target: 'player', field: 'health', magnitude: 5 }]
  } }]), context).world;
  result.player.health = 40;
  ops.settleWorldRules(result, [{ id: 'event:one', action: 'aid', actorId: 'player' }]);
  assert.equal(result.player.health, 45);
  ops.settleWorldRules(result, [{ id: 'event:one', action: 'aid', actorId: 'player' }]);
  assert.equal(result.player.health, 45);
});
test('unknown effect conditions are validated at creation and duplicate event delivery runs a rule once', () => {
  const world = createAstraWorld('conditional-item');
  assert.throws(() => ops.applyWorldPlan(world, plan([{ type: 'entity.create', kind: 'item', entity: {
    id: 'item:bad', name: '坏规则物品', effects: [{ type: 'heal', target: 'player', magnitude: 5, condition: { code: 'evil' } }]
  } }]), context));
  const next = ops.applyWorldPlan(world, plan([{ type: 'rule.upsert', rule: {
    id: 'rule:once', trigger: 'aid', condition: { op: 'lt', left: { entityId: 'player', field: 'health' }, right: 100 },
    effects: [{ type: 'heal', target: 'player', magnitude: 5 }]
  } }]), context).world;
  next.player.health = 40;
  ops.settleWorldRules(next, [{ id: 'repeated', action: 'aid' }, { id: 'repeated', action: 'aid' }]);
  assert.equal(next.player.health, 45);
});
test('ordinary quests cannot complete immediately on unrelated facts and oversell one reward budget', () => {
  const world = createAstraWorld('quest-budget');
  const npc = Object.values(world.characters).find(n => n.alive);
  npc.locationId = world.player.locationId; npc.travel = null; npc.wealth = 10;
  const quest = { id: 'quest:bad', title: '白拿奖励', giverId: npc.id, targetLocationId: world.player.locationId,
    condition: { op: 'eq', left: { entityId: 'player', field: 'alive' }, right: true },
    reward: [{ type: 'stat.delta', target: 'player', field: 'wealth', magnitude: 8 }] };
  assert.throws(() => ops.applyWorldPlan(world, plan([{ type: 'quest.create', quest }]), { ...context, mode: 'ordinary' }));
});
