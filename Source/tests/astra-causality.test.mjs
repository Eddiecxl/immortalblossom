import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld, normalizeAstraWorld } from '../../game/astra-world.js';
import * as causal from '../../game/astra-causality.js';
import { applyNumericMutation } from '../../game/astra-variables.js';

function cast(seed) {
  const world = createAstraWorld(seed);
  const people = Object.values(world.characters).filter(npc => npc.alive).slice(0, 3);
  for (const npc of people) { npc.locationId = world.player.locationId; npc.travel = null; }
  return { world, people };
}

test('causal events create witnessed beliefs and never double-apply a social reaction', () => {
  assert.equal(typeof causal.recordCausalEvent, 'function');
  const { world, people } = cast('causal-repeat');
  const event = { id: 'event:aid', actorId: 'player', action: 'aid', targetIds: [people[0].id],
    locationId: world.player.locationId, summary: '我帮助了眼前的人。',
    impacts: [{ entityId: people[0].id, dimension: 'resources', delta: 0.6 }] };
  causal.recordCausalEvent(world, event);
  causal.propagateCausality(world);
  const value = people[0].relationships.player;
  assert.ok(value > 0);
  const belief = Object.values(world.simulation.beliefs).find(row => row.holderId === people[0].id && row.eventId === event.id);
  assert.equal(belief.mode, 'witness');
  causal.recordCausalEvent(world, event);
  causal.propagateCausality(world);
  assert.equal(people[0].relationships.player, value);
});

test('the same loss is judged by actual known conduct and affiliation across seeds', () => {
  for (const seed of ['social-valley', 'social-city', 'social-river']) {
    const { world, people: [victim, ally, remote] } = cast(seed);
    const faction = Object.values(world.factions).find(group => group.active);
    victim.factionId = null; victim.attachments = [];
    ally.factionId = faction.id;
    remote.locationId = 'loc:taixu';
    causal.recordCausalEvent(world, { id: 'event:extortion', actorId: faction.id, targetIds: [victim.id],
      locationId: world.player.locationId, witnessIds: [victim.id], action: 'take', summary: '当地人被夺走了生计。',
      impacts: [{ entityId: victim.id, dimension: 'resources', delta: -0.8 }] });
    causal.propagateCausality(world);
    causal.recordCausalEvent(world, { id: 'event:fall', actorId: 'player', targetIds: [faction.id],
      locationId: world.player.locationId, action: 'disable', summary: '掌控此地的势力覆灭。',
      impacts: [{ entityId: faction.id, dimension: 'power', delta: -1 }] });
    causal.propagateCausality(world);
    assert.ok(victim.relationships.player > 0, 'a known victim can feel relief');
    assert.ok(ally.relationships.player < 0, 'an affiliate can resent the same act');
    assert.equal(remote.relationships.player, undefined, 'a distant uninformed observer has no reaction');
    assert.ok(victim.currentPlan?.causeEventId === 'event:fall');
  }
});

test('news spreads only after travel time and persists through reload', () => {
  const { world, people: [witness, distant] } = cast('gossip-timing');
  const road = world.edges.find(edge => edge.from === world.player.locationId && !edge.closed);
  distant.locationId = road.to;
  causal.recordCausalEvent(world, { id: 'event:public', actorId: 'player', targetIds: [witness.id],
    locationId: world.player.locationId, action: 'aid', summary: '我解了当地人的燃眉之急。',
    impacts: [{ entityId: witness.id, dimension: 'security', delta: 0.9 }] });
  causal.propagateCausality(world);
  assert.equal(Object.values(world.simulation.beliefs).some(b => b.holderId === distant.id && b.eventId === 'event:public'), false);
  const restored = normalizeAstraWorld(JSON.parse(JSON.stringify(world)));
  restored.minute += road.minutes + 60;
  causal.propagateCausality(restored);
  const report = Object.values(restored.simulation.beliefs).find(b => b.holderId === distant.id && b.eventId === 'event:public');
  assert.ok(report);
  assert.equal(report.mode, 'report');
  assert.ok(report.confidence < 1);
});

test('risk assessment warns proactively without applying quoted or hypothetical violence', () => {
  const { world, people: [target] } = cast('proactive-risk');
  target.cultivation.realm = 'tribulation';
  const before = JSON.stringify(world.player);
  const risk = causal.assessIntent(world, { speech: `${target.name}，我要杀了你！`, action: '' }, target.id);
  assert.ok(risk.risk >= 0.8);
  assert.equal(JSON.stringify(world.player), before);
  const hypothetical = causal.assessIntent(world, { speech: `假如我去挑衅${target.name}会怎样？`, action: '' }, target.id);
  assert.equal(hypothetical.performed, false);
  assert.equal(target.alive, true);
});
test('actual faction dissolution retains an observer former affiliation as evidence', () => {
  const { world, people: [affiliate] } = cast('former-membership');
  const faction = Object.values(world.factions).find(group => group.active);
  affiliate.factionId = faction.id;
  affiliate.locationId = faction.homeId;
  const before = structuredClone(world);
  applyNumericMutation(world, { kind: 'faction', id: faction.id, field: 'power', operation: 'set', value: 0 });
  causal.captureWorldChanges(before, world, { turnId: 'tx:fall', actorId: 'player' });
  causal.propagateCausality(world);
  assert.equal(affiliate.factionId, null);
  assert.ok(affiliate.relationships.player < 0);
});
