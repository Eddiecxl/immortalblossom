import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld, normalizeAstraWorld } from '../../game/astra-world.js';
import { recordCausalEvent, propagateCausality } from '../../game/astra-causality.js';
import { runNpcPlans } from '../../game/astra-npc.js';
import { applyWorldPlan } from '../../game/astra-operations.js';
test('twenty diverse worlds keep causal records across repeated reload and discarded futures', () => {
  for (let seed = 0; seed < 20; seed++) {
    let world = createAstraWorld('causal-soak-' + seed);
    const npc = Object.values(world.characters).find(n => n.alive);
    npc.locationId = world.player.locationId; npc.travel = null;
    const branch = structuredClone(world);
    for (let tick = 0; tick < 20; tick++) {
      recordCausalEvent(world, { id: 'event:' + tick, actorId: 'player', targetIds: [npc.id], action: 'aid',
        locationId: world.player.locationId, summary: '一次实际相助', impacts: [{ entityId: npc.id, dimension: 'resources', delta: 0.1 }] });
      propagateCausality(world);
      const value = world.characters[npc.id].relationships.player;
      world = normalizeAstraWorld(JSON.parse(JSON.stringify(world)));
      propagateCausality(world);
      assert.equal(world.characters[npc.id].relationships.player, value);
      world.minute += 20;
    }
    assert.equal(Object.keys(world.simulation.events).length, 20);
    assert.equal(branch.simulation, undefined);
    const reloadedBranch = normalizeAstraWorld(branch);
    assert.equal(Object.keys(reloadedBranch.simulation?.events || {}).length, 0);
  }
});
test('causal NPC plans actually change goals and avoidance schedules real travel', () => {
  const world = createAstraWorld('active-plans');
  const [helper, avoider] = Object.values(world.characters).filter(n => n.alive).slice(0, 2);
  for (const npc of [helper, avoider]) {
    npc.locationId = world.player.locationId; npc.travel = null;
    npc.currentPlan = { type: npc === helper ? 'support' : 'avoid', state: 'pending', targetId: 'player', causeEventId: 'cause:1' };
    npc.lastPlanBucket = -1;
  }
  runNpcPlans(world);
  assert.equal(helper.flags.willingToHelp.sourceId, 'cause:1');
  assert.ok(helper.currentGoals[0].includes(world.player.name));
  assert.ok(avoider.travel?.arriveAt > world.minute);
});
test('rule and identity changes obey explicit personal scope', () => {
  const world = createAstraWorld('scope');
  const [named, other] = Object.values(world.characters).filter(n => n.alive).slice(0, 2);
  assert.throws(() => applyWorldPlan(world, { operations: [{ type: 'entity.update', targetId: other.id, changes: { gender: '女' } }] },
    { turnId: 'scope:1', mode: 'reality', enforceScope: true, input: { speech: '言出法随：把' + named.name + '变成女的' } }));
  assert.throws(() => applyWorldPlan(world, { operations: [{ type: 'rule.upsert', rule: {
    id: 'rule:global', trigger: 'aid', condition: { op: 'eq', left: 1, right: 1 }, effects: [{ type: 'heal', target: 'player', magnitude: 1 }]
  } }] }, { turnId: 'scope:2', mode: 'reality', enforceScope: true, input: { speech: '言出法随：改变我的名字' } }));
});
