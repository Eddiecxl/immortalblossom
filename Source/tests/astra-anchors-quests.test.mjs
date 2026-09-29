import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld } from '../../game/astra-world.js';
import { createQuestArc, reconcileQuestArcs, QUEST_STATES } from '../../game/astra-quests.js';
import { resolveDueAnchors } from '../../game/astra-anchors.js';

test('quest state machine supports the nine required states', () => {
  assert.deepEqual(QUEST_STATES, ['available','active','mutated','completed','failed','expired','abandoned','resolved-by-other','invalidated']);
  const world = createAstraWorld('quest-nine');
  const quest = createQuestArc(world, 'quest:deliver-medicine:urgent', { locationId: world.player.locationId });
  assert.equal(quest.state, 'available');
  assert.ok(quest.deadline > world.minute);
  assert.ok(quest.primaryGoals.length);
});

test('dead giver mutates an accepted quest and destroyed target invalidates it', () => {
  const world = createAstraWorld('quest-death');
  const giver = world.characters['npc:lin-xiaoman'];
  const quest = createQuestArc(world, 'quest:deliver-medicine:urgent', { locationId: world.player.locationId, giverId: giver.id });
  quest.state = 'active';
  giver.alive = false;
  reconcileQuestArcs(world, { type: 'death', actorId: giver.id });
  assert.equal(quest.state, 'mutated');
  world.locations[quest.targetLocationId].destroyed = true;
  reconcileQuestArcs(world, { type: 'location_destroyed', locationId: quest.targetLocationId });
  assert.equal(quest.state, 'invalidated');
  assert.ok(world.history.some(entry => entry.type === 'quest_state'));
});

test('deadline and completion by another actor cause real loss of rewards', () => {
  const world = createAstraWorld('quest-deadline');
  const quest = createQuestArc(world, 'quest:find-traveler:urgent', { locationId: world.player.locationId });
  quest.state = 'active';
  reconcileQuestArcs(world, { type: 'resolved_by_other', questId: quest.id, actorId: 'npc:lin-xiaoman' });
  assert.equal(quest.state, 'resolved-by-other');
  assert.ok(quest.lostRewards.length);
  const later = createQuestArc(world, 'quest:repair-bridge:urgent', { locationId: world.player.locationId });
  world.minute = later.deadline + 1;
  reconcileQuestArcs(world, { type: 'time' });
  assert.equal(later.state, 'expired');
});

test('completion transfers an Engine reward and records a follow-up opportunity', () => {
  const world = createAstraWorld('quest-reward');
  const quest = createQuestArc(world, 'quest:repair-bridge:urgent', { locationId: world.player.locationId });
  quest.state = 'active';
  const wealth = world.player.wealth;
  reconcileQuestArcs(world, { type: 'complete', questId: quest.id });
  assert.equal(quest.state, 'completed');
  assert.ok(world.player.wealth > wealth);
  assert.ok(quest.followUpArcs.length);
  assert.ok(world.history.some(entry => entry.type === 'quest_state' && entry.summary.includes('completed')));
});

test('an anchor chooses a seed and world dependent variant, then resolves offscreen', () => {
  const world = createAstraWorld('anchor-seed');
  const anchor = Object.values(world.anchors).find(a => a.family === 'sect-crisis');
  world.minute = anchor.windowStart;
  resolveDueAnchors(world);
  assert.equal(anchor.state, 'open');
  assert.ok(anchor.selectedEventId);
  const branch = anchor.selectedEventId;
  const changed = createAstraWorld('anchor-seed');
  const changedAnchor = changed.anchors[anchor.id];
  changed.factions['faction:qingxuan'].active = false;
  changed.minute = changedAnchor.windowStart;
  resolveDueAnchors(changed);
  assert.notEqual(changedAnchor.selectedEventId, branch);
  changed.minute = changedAnchor.windowEnd + 1;
  resolveDueAnchors(changed);
  assert.equal(changedAnchor.state, 'resolved-offscreen');
});
