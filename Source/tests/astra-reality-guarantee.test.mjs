import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld, normalizeAstraWorld } from '../../game/astra-world.js';
import { applyRealityMutation, planRealityMutation, killNpc } from '../../game/astra-reality.js';
import { applyWorldPlan } from '../../game/astra-operations.js';
import { applyNumericMutation } from '../../game/astra-variables.js';
import { effectiveRealmCap, advanceRealm } from '../../game/astra-rules.js';

const seeds = ['guarantee-mountain', 'guarantee-sea', 'guarantee-stars'];
const execute = (world, operations, statement, extra = {}) => applyWorldPlan(world, { operations }, {
  turnId: 'law:guarantee', mode: 'reality', enforceScope: true,
  input: { speech: statement, action: '' }, ...extra
}).world;

test('explicit numeric law exceeds ordinary bounds only for its target and persists through reload', () => {
  for (const seed of seeds) {
    const source = createAstraWorld(seed);
    source.rules.variables.player.safety.max = 60;
    source.player.safety = 60;
    const world = applyRealityMutation(source, planRealityMutation(source, '言出法随：将我的安全设为500'));
    assert.equal(world.player.safety, 500);
    assert.equal(world.rules.variables.player.safety.max, 60, 'personal law does not rewrite global rules');
    assert.ok(world.flags.causalDebt > 0);
    const restored = normalizeAstraWorld(JSON.parse(JSON.stringify(world)));
    applyNumericMutation(restored, { kind: 'player', id: 'player', field: 'safety', operation: 'delta', value: -1 });
    assert.equal(restored.player.safety, 499, 'ordinary follow-up does not erase the persisted rewrite');
    applyNumericMutation(source, { kind: 'player', id: 'player', field: 'safety', operation: 'delta', value: 10 });
    assert.equal(source.player.safety, 60, 'ordinary actions still obey existing caps');
  }
});

test('typed numeric law applies exact health first, maintains linked capacity, and charges once', () => {
  for (const seed of seeds) {
    const source = createAstraWorld(seed);
    const statement = '言出法随：把我的气血设为500';
    const operations = [{ type: 'entity.update', targetId: 'player', changes: { health: 500 } }];
    const changed = execute(source, operations, statement);
    assert.equal(changed.player.maxHealth, 500);
    assert.equal(changed.player.health, 500, 'causal debt balances the law without undoing its requested health');
    assert.ok(changed.flags.causalDebt > (source.flags.causalDebt || 0));
    assert.deepEqual(execute(changed, operations, statement), changed, 'retries are idempotent');
    assert.notEqual(source.player.maxHealth, 500);
  }
});

test('typed relocation ignores roads and travel, updates inventory, and removes stale arrivals', () => {
  for (const seed of seeds) {
    const source = createAstraWorld(seed);
    const npc = Object.values(source.characters).find(row => row.alive);
    const destination = Object.values(source.locations).find(row => row.id !== npc.locationId && !row.destroyed);
    const oldLocation = npc.locationId;
    npc.travel = { from: oldLocation, to: source.player.locationId, arriveAt: source.minute + 30 };
    npc.locationId = null;
    source.eventQueue.push({ id: 'stale:arrival', type: 'npc_arrival', dueAt: source.minute + 30, payload: { actorId: npc.id } });
    source.edges.forEach(edge => { edge.closed = true; });
    const before = JSON.stringify(source);
    const operations = [{ type: 'entity.update', targetId: npc.id, changes: { locationId: destination.id } }];
    const changed = execute(source, operations, `言出法随：把${npc.name}移动到${destination.name}`);
    assert.equal(changed.characters[npc.id].locationId, destination.id);
    assert.equal(changed.characters[npc.id].travel, null);
    assert.equal(changed.eventQueue.some(event => event.id === 'stale:arrival'), false);
    for (const id of npc.inventory) assert.equal(changed.items[id].locationId, destination.id);
    assert.equal(JSON.stringify(source), before);
    assert.throws(() => execute(source, operations, '', { mode: 'ordinary' }));
  }
});

test('typed cultivation law bypasses a lower cap without changing any other actor cap', () => {
  for (const seed of seeds) {
    const source = createAstraWorld(seed);
    source.rules.cultivation.globalMaximum = 'qi_refining';
    const npc = Object.values(source.characters).find(row => row.alive);
    const world = execute(source, [{ type: 'entity.update', targetId: 'player',
      changes: { cultivation: { realm: 'tribulation', level: 1 } } }], '言出法随：让我达到渡劫境');
    assert.equal(world.player.cultivation.realm, 'tribulation');
    assert.equal(effectiveRealmCap(world, world.player), 'tribulation');
    assert.equal(effectiveRealmCap(world, world.characters[npc.id]), 'qi_refining');
    assert.equal(advanceRealm(world, world.player).applied, false);
    assert.equal(normalizeAstraWorld(JSON.parse(JSON.stringify(world))).player.cultivation.realm, 'tribulation');
  }
});

test('resurrection is not blocked by a destroyed former home and preserves identity', () => {
  const source = createAstraWorld('guarantee-revival');
  const npc = Object.values(source.characters).find(row => row.alive && row.locationId !== source.player.locationId
    && row.homeId !== source.player.locationId);
  killNpc(source, npc, 'test:death');
  source.locations[npc.lastKnownLocationId].destroyed = true;
  source.locations[npc.homeId].destroyed = true;
  const world = execute(source, [{ type: 'entity.update', targetId: npc.id, changes: { alive: true } }], `言出法随：复活${npc.name}`);
  assert.equal(world.characters[npc.id].alive, true);
  assert.equal(world.characters[npc.id].locationId, source.player.locationId);
  assert.deepEqual(world.characters[npc.id].family, npc.family);
  assert.equal(world.characters[npc.id].id, npc.id);
});

test('the actual reality channel authorizes a rewrite alongside an ordinary action', () => {
  const source = createAstraWorld('guarantee-channel');
  const npc = Object.values(source.characters).find(row => row.alive);
  const world = execute(source, [{ type: 'entity.update', targetId: npc.id, changes: { gender: '女' } }], '', {
    input: { speech: `言出法随：让${npc.name}变成女性`, action: '我站在原地' }
  });
  assert.equal(world.characters[npc.id].gender, '女');
});

test('compound or differently scoped wishes cannot silently execute the first local match', () => {
  const world = createAstraWorld('guarantee-coverage');
  const [a, b] = Object.values(world.characters).filter(row => row.alive);
  for (const statement of ['言出法随：让我无敌并把财富设为500',
    '言出法随：让我无敌，且让时间长出蓝色翅膀',
    `言出法随：让${a.name}无敌`, `言出法随：让${a.name}和${b.name}死去`,
    `言出法随：让${a.name}治愈身体`]) {
    assert.throws(() => planRealityMutation(world, statement), error => error.code === 'REALITY_SEMANTIC_REQUIRED', statement);
  }
});

test('mixed unresolved and executable reality plans roll back the whole effect and cost', () => {
  const source = createAstraWorld('guarantee-unresolved');
  const before = JSON.stringify(source);
  assert.throws(() => execute(source, [
    { type: 'entity.update', targetId: 'player', changes: { wealth: 900 } },
    { type: 'concept.defer', description: '附加未知机制', reason: '缺少执行语义' }
  ], '言出法随：我的财富变为900且附加未知机制'), /完整|未结算/u);
  assert.equal(JSON.stringify(source), before);
});
