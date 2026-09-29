import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld } from '../../game/astra-world.js';
import { scheduleEvent, advanceAstraWorld } from '../../game/astra-scheduler.js';
import { runFactionTick } from '../../game/astra-faction.js';

test('queue order and replay are deterministic and do not mutate source', () => {
  const source = createAstraWorld('scheduler-order');
  const initial = JSON.stringify(source);
  scheduleEvent(source, { id: 'test:z', dueAt: 365, priority: 5, type: 'world_event', payload: { locationId: source.player.locationId } });
  scheduleEvent(source, { id: 'test:a', dueAt: 365, priority: 5, type: 'world_event', payload: { locationId: source.player.locationId } });
  scheduleEvent(source, { id: 'test:a', dueAt: 365, priority: 5, type: 'world_event', payload: {} });
  const before = JSON.stringify(source);
  const first = advanceAstraWorld(source, 10);
  const second = advanceAstraWorld(source, 10);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(first.events.filter(event => event.id.startsWith('test:')).map(event => event.id), ['test:a','test:z']);
  assert.equal(initial.includes('test:a'), false);
});

test('Lin arrives and the first encounter persists even if the player waited', () => {
  const start = createAstraWorld('scheduler-lin');
  const due = start.eventQueue.find(event => event.type === 'lin_first_encounter').dueAt;
  const { world } = advanceAstraWorld(start, due - start.minute + 1);
  assert.equal(world.flags.encounterLinResolved, true);
  assert.equal(world.characters['npc:lin-xiaoman'].metPlayer, true);
  assert.equal(world.characters['npc:lin-xiaoman'].locationId, world.player.locationId);
  assert.equal(world.history.filter(event => event.type === 'lin_first_encounter').length, 1);
});

test('travel is an Engine arrival, not an immediate teleport', () => {
  const start = createAstraWorld('scheduler-travel');
  const edge = start.edges.find(edge => edge.from === start.player.locationId && !edge.closed);
  const pending = advanceAstraWorld(start, 1, { type: 'travel', destinationId: edge.to }).world;
  assert.equal(pending.player.locationId, start.player.locationId);
  assert.ok(pending.player.travel);
  const arrived = advanceAstraWorld(pending, edge.minutes).world;
  assert.equal(arrived.player.locationId, edge.to);
  assert.equal(arrived.player.travel, null);
});

test('20 speech turns advance time and resolve a scheduled NPC arrival', () => {
  let world = createAstraWorld('scheduler-talking');
  const npc = Object.values(world.characters).find(entry => entry.alive && entry.id !== 'npc:lin-xiaoman');
  const destinationId = world.player.locationId;
  npc.travel = { from: npc.locationId, to: destinationId, departAt: world.minute, arriveAt: world.minute + 60 };
  scheduleEvent(world, { id: 'test:npc-arrival', dueAt: world.minute + 60, priority: 1,
    type: 'npc_arrival', payload: { actorId: npc.id, destinationId } });
  for (let i = 0; i < 20; i++) world = advanceAstraWorld(world, 5, { type: 'speech' }).world;
  assert.equal(world.minute, 460);
  assert.equal(world.characters[npc.id].locationId, destinationId);
  assert.equal(world.characters[npc.id].travel, null);
  assert.ok(world.history.some(entry => entry.id === 'test:npc-arrival'));
});

test('a missed sect event resolves and its opportunity expires while the player sleeps', () => {
  const world = createAstraWorld('scheduler-missed-sect');
  const anchor = Object.values(world.anchors).find(entry => entry.family === 'sect-crisis');
  const result = advanceAstraWorld(world, anchor.windowEnd - world.minute + 60).world;
  assert.equal(result.anchors[anchor.id].state, 'resolved-offscreen');
  assert.equal(result.quests[`quest-anchor:${anchor.id}`].state, 'expired');
  assert.ok(result.history.some(entry => entry.type === 'anchor_resolved'));
});

test('faction leadership and territory follow autonomous state changes', () => {
  const world = createAstraWorld('faction-succession');
  const faction = Object.values(world.factions).find(entry => entry.memberIds.length > 1);
  const oldLeader = faction.leaderId;
  const successor = Object.values(world.characters).find(entry => entry.alive && entry.id !== oldLeader && entry.factionId !== faction.id);
  successor.factionId = faction.id;
  faction.memberIds.push(successor.id);
  world.characters[oldLeader].alive = false;
  const result = runFactionTick(world, faction.id, world.minute + 7 * 1440);
  assert.ok(result);
  assert.notEqual(faction.leaderId, oldLeader);
  assert.ok(world.characters[faction.leaderId].alive);
  assert.ok(faction.territories.every(id => world.locations[id].controllerFactionId === faction.id));
});

test('rumors spread through real roads with decaying confidence', () => {
  const start = createAstraWorld('rumor-regions');
  const after = advanceAstraWorld(start, 8 * 1440).world;
  const rumor = after.rumors.find(entry => entry.originEventId === 'event:opening-local');
  assert.ok(rumor);
  assert.ok(rumor.regionSpread.length > 1);
  assert.ok(rumor.truthConfidence < 0.8);
  assert.ok(rumor.spreadCount > 0);
});

test('ten thousand scheduled events resolve once inside a bounded save', () => {
  const source = createAstraWorld('scheduler-soak');
  for (let i = 0; i < 10_000; i++) scheduleEvent(source, {
    id: `soak:${i}`, dueAt: source.minute + 1 + i, priority: 50,
    type: 'world_event', payload: { locationId: source.player.locationId }
  });
  const { world, events } = advanceAstraWorld(source, 10_010);
  assert.equal(events.filter(event => event.id.startsWith('soak:')).length, 10_000);
  assert.equal(new Set(world.history.map(event => event.id)).size, world.history.length);
  assert.ok(world.historyArchive.counts.world_event > 0);
  assert.equal(scheduleEvent(world, { id: 'soak:0', dueAt: world.minute + 1, type: 'world_event' }), false);
  assert.ok(JSON.stringify(world).length < 2_000_000);
});
