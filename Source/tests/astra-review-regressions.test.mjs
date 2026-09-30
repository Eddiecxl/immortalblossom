import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAstraWorld } from '../../game/astra-world.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
import { applyWorldPlan } from '../../game/astra-operations.js';
import { recordCausalEvent, propagateCausality } from '../../game/astra-causality.js';
import { compileAstraContext } from '../../game/astra-context.js';
const ctx = { turnId: 'review:tx', mode: 'reality', input: { speech: '言出法随：改变世界' } };
function runHarness(state, responses) {
  const turns = [], calls = [];
  const runner = createAiTurnRunner({ aiClient: { narrate: async (_, request) => {
    calls.push(request);
    return JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]);
  } }, transcriptStore: { recentTurns: async () => turns, appendTurn: async (_, turn) => turns.push(turn) } });
  return { calls, run: input => runner.runWorld({ state, input, transactionId: 'review:turn', settings: { provider: 'test' } }) };
}
const narr = [{ type: 'narr', text: '我看清了眼前的路，晨风吹过衣袖。' }];
function withPill(seed) {
  const world = createAstraWorld(seed);
  return applyWorldPlan(world, { operations: [{ type: 'entity.create', kind: 'item', entity: {
    id: 'item:review:heal', name: '回春丹', quantity: 2, effects: [{ type: 'heal', target: 'player', magnitude: 5 }]
  } }] }, ctx).world;
}
test('review: hypothetical known and open reality invocations cannot mutate', async () => {
  for (const phrase of ['言出法随：如果我变成女性会怎样？', '言出法随：如果我让全宇宙所有生命消失会怎样？']) {
    const state = createGameState('测试', 'ai', () => 'hypothetical-review');
    state.astraWorld.player.gender = '男';
    const h = runHarness(state, [{ blocks: narr, worldPlan: { operations: [{ type: 'entity.update', targetId: 'player', changes: { gender: '女' } }] } },
      { blocks: narr, worldPlan: { operations: [] } }]);
    const result = await h.run({ speech: phrase, action: '' });
    assert.equal(result.state.astraWorld.player.gender, '男');
    assert.equal(result.state.astraWorld.terminal.ended, false);
  }
});
test('review: mechanically consumed pills are not consumed again by the AI proposal', async () => {
  const state = createGameState('测试', 'ai', () => 'pill-repeat-review');
  state.astraWorld = withPill('pill-repeat-review');
  const h = runHarness(state, [{ blocks: narr, worldPlan: { operations: [{ type: 'effect.apply', itemId: 'item:review:heal' }] } },
    { blocks: narr, worldPlan: { operations: [] } }]);
  const result = await h.run({ speech: '', action: '服用回春丹' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.items['item:review:heal'].quantity, 1);
  assert.equal(h.calls.length, 2);
  assert.throws(() => applyWorldPlan(withPill('intra-repeat'), { operations: [
    { type: 'effect.apply', itemId: 'item:review:heal' }, { type: 'effect.apply', itemId: 'item:review:heal' }
  ] }, { ...ctx, turnId: 'review:use', mode: 'ordinary', input: { action: '服用回春丹' } }));
});
test('review: personal rewrite cannot secretly create or alter unrelated relations', () => {
  const world = createAstraWorld('scope-review');
  const [npc, other] = Object.values(world.characters).filter(n => n.alive).slice(0, 2);
  const limited = { ...ctx, enforceScope: true, input: { speech: '言出法随：把我变成女性' } };
  assert.throws(() => applyWorldPlan(world, { operations: [{ type: 'entity.create', kind: 'character',
    entity: { id: 'npc:unasked', name: '未请求的旅人' } }] }, limited));
  assert.throws(() => applyWorldPlan(world, { operations: [{ type: 'relation.upsert', fromId: npc.id,
    toId: other.id, kind: 'trust', weight: 1 }] }, limited));
});
test('review: remote mutations are witnessed where the affected entity is', () => {
  const world = createAstraWorld('remote-review');
  const [local, remote] = Object.values(world.characters).filter(n => n.alive).slice(0, 2);
  local.locationId = world.player.locationId; local.travel = null;
  remote.locationId = world.edges.find(edge => edge.from === world.player.locationId && !edge.closed).to; remote.travel = null;
  const next = applyWorldPlan(world, { operations: [{ type: 'entity.update', targetId: remote.id, changes: { gender: '女' } }] }, ctx).world;
  propagateCausality(next);
  const event = Object.values(next.simulation.events).find(e => e.action === 'rewrite');
  assert.equal(event.locationId, remote.locationId);
  assert.equal(Object.values(next.simulation.beliefs).some(b => b.holderId === local.id && b.eventId === event.id), false);
  assert.equal(Object.values(next.simulation.beliefs).some(b => b.holderId === remote.id && b.eventId === event.id && b.mode === 'witness'), true);
});
test('review: known mechanical rewrite dispatches its causal event to declarative rules', async () => {
  const state = createGameState('测试', 'ai', () => 'rule-dispatch-review');
  const npc = Object.values(state.astraWorld.characters).find(n => n.alive && n.name !== '林小满');
  state.astraWorld.simulation = { rules: { 'rule:rewrite': { id: 'rule:rewrite', version: 1, trigger: 'rewrite',
    condition: { op: 'eq', left: true, right: true },
    effects: [{ type: 'stat.delta', target: 'player', field: 'wealth', magnitude: 10 }] } } };
  const wealth = state.astraWorld.player.wealth;
  const result = await runHarness(state, [{ blocks: narr }]).run({ speech: '言出法随：杀死' + npc.name, action: '' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.player.wealth, wealth + 10);
});
test('review: deferred concepts after cloned item effects remain in the final simulation', () => {
  const next = applyWorldPlan(withPill('defer-review'), { operations: [
    { type: 'effect.apply', itemId: 'item:review:heal' },
    { type: 'concept.defer', description: '一种新概念', reason: '尚需规则' }
  ] }, { ...ctx, turnId: 'review:defer', mode: 'ordinary', input: { action: '服用回春丹' } }).world;
  assert.equal(next.simulation.commitments['review:defer'].state, 'unresolved');
});
test('review: conditions cannot reference nonexistent entities or mechanical fields', () => {
  const world = createAstraWorld('missing-condition-review');
  const npc = Object.values(world.characters).find(n => n.alive);
  npc.locationId = world.player.locationId; npc.travel = null; npc.wealth = 100;
  const quest = { id: 'quest:impossible', title: '无效任务', giverId: npc.id, targetLocationId: world.player.locationId,
    condition: { op: 'eq', left: { entityId: 'npc:missing', field: 'alive' }, right: true },
    reward: [{ type: 'stat.delta', target: 'player', field: 'wealth', magnitude: 5 }] };
  assert.throws(() => applyWorldPlan(world, { operations: [{ type: 'quest.create', quest }] }, { ...ctx, mode: 'ordinary' }));
  quest.condition.left = { entityId: 'player', field: 'inexistentAttribute' };
  assert.throws(() => applyWorldPlan(world, { operations: [{ type: 'quest.create', quest }] }, { ...ctx, mode: 'ordinary' }));
});
test('review: an offered destination quest can be accepted at its giver', async () => {
  const state = createGameState('测试', 'ai', () => 'quest-accept-review');
  const world = state.astraWorld, npc = Object.values(world.characters).find(n => n.alive);
  npc.locationId = world.player.locationId; npc.travel = null; npc.wealth = 100;
  const destination = world.edges.find(edge => edge.from === world.player.locationId && !edge.closed).to;
  state.astraWorld = applyWorldPlan(world, { operations: [{ type: 'quest.create', quest: { id: 'quest:visit', title: '去邻地查看',
    giverId: npc.id, targetLocationId: destination,
    condition: { op: 'eq', left: { entityId: 'player', field: 'locationId' }, right: destination },
    reward: [{ type: 'stat.delta', target: 'player', field: 'wealth', magnitude: 5 }]
  } }] }, { ...ctx, mode: 'ordinary' }).world;
  const result = await runHarness(state, [{ blocks: narr }]).run({ action: '接取去邻地查看', speech: '' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.quests['quest:visit'].state, 'active');
});
test('review: recalled old reports retain provenance even after the belief window fills', () => {
  const world = createAstraWorld('report-recall-review');
  const npc = Object.values(world.characters).find(n => n.alive);
  npc.locationId = world.player.locationId; npc.travel = null; npc.memories = []; npc.knowledge = [];
  world.simulation = { beliefs: {} };
  npc.memories.push({ id: 'memory:old', eventId: 'old:report', summary: '河对岸药铺失火', source: 'report', confidence: 0.64 });
  world.simulation.beliefs.old = { id: 'old', holderId: npc.id, eventId: 'old:report', mode: 'report', confidence: 0.64, summary: '河对岸药铺失火' };
  for (let i = 0; i < 10; i++) {
    npc.memories.push({ id: 'memory:' + i, eventId: 'new:' + i, summary: '新近的日常安排' });
    world.simulation.beliefs[i] = { holderId: npc.id, eventId: 'new:' + i, mode: 'witness', confidence: 1 };
  }
  const packet = compileAstraContext(world, '河对岸药铺失火的消息可信吗？');
  const old = packet.presentNpcs.find(row => row.id === npc.id).memories.find(row => row.summary.includes('失火'));
  assert.equal(old.source, 'report');
  assert.equal(old.confidence, 0.64);
});
