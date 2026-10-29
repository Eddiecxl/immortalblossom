import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAstraOpening } from '../../game/astra-opening.js';
import { directAstraScene } from '../../game/astra-director.js';

function scene(seed = 'handoff-fixture') {
  const state = createGameState('旅人', 'ai', () => seed), world = state.astraWorld;
  for (const npc of Object.values(world.characters)) npc.locationId = 'loc:elsewhere';
  const npc = world.characters['npc:lin-xiaoman'];
  npc.alive = true; npc.travel = null; npc.locationId = world.player.locationId;
  npc.currentGoals = ['keep boat safe'];
  return { state, world, npc };
}

test('seeded openings end at a grounded response or action across occupied and empty starts', () => {
  let contacts = 0, routes = 0;
  for (let i = 0; i < 64; i++) {
    const source = createGameState('旅人', 'ai', () => `handoff-start-${i}`);
    const before = JSON.stringify(source), { state, turn } = createAstraOpening(source);
    assert.ok(turn.handoff, 'opening must expose its concrete current opportunity');
    const last = turn.blocks.at(-1), world = state.astraWorld;
    assert.notEqual(last.type, 'sys', 'the final beat belongs to the current scene');
    assert.doesNotMatch(last.text, /你想做什么|另选去向|自由选择|接下来怎么办/u);
    if (turn.handoff.targetId) {
      contacts++;
      const npc = world.characters[turn.handoff.targetId];
      assert.ok(npc.alive && !npc.travel && npc.locationId === world.player.locationId);
      assert.equal(last.name, npc.name);
      assert.equal(last.type, 'dlg');
      assert.equal(world.flags.conversation.npcId, npc.id);
      assert.ok(world.history.some(e => e.type === 'opening_contact' && e.actors.includes(npc.id) && e.summary.includes(last.text)));
      assert.ok(npc.memories.some(m => m.summary.includes(last.text)));
    } else {
      routes++;
      assert.equal(turn.handoff.kind, 'route');
      assert.ok(world.edges.some(e => e.id === turn.handoff.subjectId && !e.closed));
      assert.ok(last.text.includes(world.locations[turn.handoff.destinationId].name));
    }
    assert.equal(JSON.stringify(source), before, 'opening must not mutate its source');
  }
  assert.ok(contacts > 0 && routes > 0);
});

test('director returns a specific current contact on quiet turns without creating an encounter', () => {
  const { world, npc } = scene();
  const before = structuredClone(world.characters);
  const result = directAstraScene(world, [], { targetId: npc.id });
  assert.equal(result.handoff?.targetId, npc.id);
  assert.match(result.handoff.focus, /保住船只/u);
  assert.equal(result.event, null);
  assert.deepEqual(world.characters, before);
});

test('pending offer handoffs require current presence and real unchanged ownership', () => {
  const { world, npc } = scene('handoff-offer');
  const item = Object.values(world.items)[0];
  world.player.inventory = world.player.inventory.filter(id => id !== item.id);
  item.ownerId = npc.id; npc.inventory = [item.id];
  world.simulation = { commitments: { offer: { id: 'offer', kind: 'item-transfer', state: 'pending', fromId: npc.id,
    toId: 'player', itemId: item.id, quantity: item.quantity, expiresAt: world.minute + 10 } } };
  const offer = world.simulation.commitments.offer;
  assert.equal(directAstraScene(world).handoff?.kind, 'commitment');
  assert.equal(offer.state, 'pending'); assert.equal(item.ownerId, npc.id);
  for (const state of ['fulfilled', 'declined', 'withdrawn', 'expired', 'invalidated']) {
    offer.state = state;
    assert.notEqual(directAstraScene(world).handoff?.kind, 'commitment');
  }
  offer.state = 'pending'; item.ownerId = 'player';
  assert.notEqual(directAstraScene(world).handoff?.kind, 'commitment');
  item.ownerId = npc.id; offer.expiresAt = world.minute - 1;
  assert.notEqual(directAstraScene(world).handoff?.kind, 'commitment');
  offer.expiresAt = world.minute + 10; npc.travel = { from: world.player.locationId, to: 'loc:elsewhere' };
  assert.notEqual(directAstraScene(world).handoff?.targetId, npc.id);
});

test('current travel has an actionable destination and never uses departure residents', () => {
  const { world, npc } = scene('handoff-travel');
  const road = world.edges.find(e => e.from === world.player.locationId);
  world.player.travel = { from: road.from, to: road.to, departAt: world.minute, arriveAt: world.minute + 23 };
  const result = directAstraScene(world, [], { targetId: npc.id });
  assert.equal(result.handoff?.kind, 'travel');
  assert.equal(result.handoff.targetId, undefined);
  assert.equal(result.handoff.destinationId, road.to);
  assert.equal(result.handoff.remainingMinutes, 23);
  assert.match(result.handoff.nextAction, /等待23分钟/u);
  assert.doesNotMatch(result.hook, new RegExp(npc.name));
});

test('isolated scenes retain a real inspectable subject without inventing people or roads', () => {
  const { world, npc } = scene('handoff-isolated');
  npc.alive = false; world.edges = [];
  const result = directAstraScene(world);
  assert.equal(result.handoff?.kind, 'inspect');
  assert.ok(result.handoff.subjectId === world.player.locationId || world.player.inventory.includes(result.handoff.subjectId));
  assert.equal(result.handoff.targetId, undefined);
});

test('terminal worlds do not receive a new opportunity or director rumor', () => {
  const { world } = scene('handoff-terminal');
  world.terminal.ended = true; world.player.alive = false;
  const before = JSON.stringify(world);
  for (let i = 0; i < 4; i++) {
    const result = directAstraScene(world);
    assert.equal(result.handoff, null);
    assert.equal(result.event, null);
  }
  assert.equal(JSON.stringify(world), before);
});
