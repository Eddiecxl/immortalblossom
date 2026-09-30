import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld, normalizeAstraWorld } from '../../game/astra-world.js';
import { planRealityMutation, applyRealityMutation } from '../../game/astra-reality.js';
import { consumeGeneratedItem, resolveStructuredEffect } from '../../game/astra-effects.js';
import { realmRules, realmLabel, effectiveRealmCap } from '../../game/astra-rules.js';
import { compileAstraContext } from '../../game/astra-context.js';
import { createGameState, migrateGameState } from '../../game/game-state.js';
import { projectAstraWorld } from '../../game/astra-turn.js';
import { applyNumericMutation } from '../../game/astra-variables.js';
import { createQuestArc } from '../../game/astra-quests.js';
import { QUEST_TEMPLATES } from '../../game/astra-content.js';

const wish = (world, speech) => applyRealityMutation(world, planRealityMutation(world, speech));
const pill = world => Object.values(world.items).find(item => item.generated && item.name === '破境丹');

test('an ordinary cultivation effect is saturated by the current world cap across seeds', () => {
  for (const seed of ['cap-mountain', 'cap-river', 'cap-stars']) {
    let world = createAstraWorld(seed);
    world = wish(world, '言出法随：让我达到最高境界');
    assert.equal(world.player.cultivation.realm, effectiveRealmCap(world, world.player));
    world = wish(world, '言出法随：创造破境丹：服下后提升一个大境界。');
    const before = { realm: world.player.cultivation.realm, maxHealth: world.player.maxHealth };
    const used = consumeGeneratedItem(world, pill(world).id);
    assert.equal(used.world.player.cultivation.realm, before.realm);
    assert.equal(used.world.player.maxHealth, before.maxHealth);
    assert.equal(used.event.applied, false);
    assert.match(used.summary, /上限|无法提升/u);
    assert.equal(used.world.items[pill(world).id].destroyed, true);
    assert.equal(world.items[pill(world).id].destroyed, false);
  }
});

test('a personal rule rewrite changes only the player cap and survives save normalization', () => {
  const source = createAstraWorld('personal-realm');
  const oldGlobal = realmRules(source).globalMaximum;
  const changed = wish(source, '言出法随：将我的最高境界改为太初境');
  const playerCap = effectiveRealmCap(changed, changed.player);
  assert.notEqual(playerCap, oldGlobal);
  assert.equal(realmRules(changed).globalMaximum, oldGlobal);
  assert.equal(realmLabel(changed, playerCap), '太初境');
  assert.equal(effectiveRealmCap(changed, Object.values(changed.characters)[0]), oldGlobal);
  const restored = normalizeAstraWorld(JSON.parse(JSON.stringify(changed)));
  assert.equal(effectiveRealmCap(restored, restored.player), playerCap);
  assert.equal(realmLabel(restored, playerCap), '太初境');
  const ascended = wish(restored, '言出法随：让我达到最高境界');
  assert.equal(ascended.player.cultivation.realm, playerCap);
});

test('a world-scope rule rewrite changes the shared cap without instantly moving any actor', () => {
  const source = createAstraWorld('global-realm');
  const previous = source.player.cultivation.realm;
  const changed = wish(source, '言出法随：将天下修士的最高境界改为太初境');
  const newCap = realmRules(changed).globalMaximum;
  assert.equal(realmLabel(changed, newCap), '太初境');
  assert.equal(effectiveRealmCap(changed, changed.player), newCap);
  assert.equal(effectiveRealmCap(changed, Object.values(changed.characters)[0]), newCap);
  assert.equal(changed.player.cultivation.realm, previous);
});

test('a raised cap is read by the same ordinary pill rule without changing the pill template', () => {
  let world = createAstraWorld('raised-cap');
  world = wish(world, '言出法随：让我达到最高境界');
  world = wish(world, '言出法随：将我的最高境界改为太初境');
  world = wish(world, '言出法随：创造破境丹：服下后提升一个大境界。');
  const used = consumeGeneratedItem(world, pill(world).id);
  assert.equal(used.event.applied, true);
  assert.equal(used.world.player.cultivation.realm, effectiveRealmCap(world, world.player));
});

test('custom realm rule survives full game save migration and reaches narration context', () => {
  const source = createGameState('顾长生', 'ai', () => 'realm-save');
  const changed = wish(source.astraWorld, '言出法随：将天下修士的最高境界改为太初境');
  const projected = projectAstraWorld(source, changed);
  const restored = migrateGameState(JSON.parse(JSON.stringify(projected)), 'ai');
  const packet = compileAstraContext(restored, '最高境界是什么？');
  assert.equal(packet.cultivationRule.globalMaximumName, '太初境');
  assert.equal(packet.cultivationRule.playerMaximumName, '太初境');
  assert.equal(realmLabel(restored.astraWorld, realmRules(restored.astraWorld).globalMaximum), '太初境');
});

test('no-op rewrites and capped effects record actual changes rather than requested changes', () => {
  const source = createAstraWorld('actual-changes');
  source.player.cultivation.realm = effectiveRealmCap(source, source.player);
  const changed = wish(source, '言出法随：让我达到最高境界');
  const record = changed.history.find(entry => entry.scope === 'cultivation_set_to_cap');
  assert.equal(record.applied, false);
  assert.equal(record.cost, 0);
  assert.equal(changed.flags.causalDebt || 0, source.flags.causalDebt || 0);
  changed.player.health = 50;
  const healing = resolveStructuredEffect(changed, { type: 'heal', target: 'player', magnitude: 'full' });
  assert.equal(healing.applied, true);
  const second = resolveStructuredEffect(changed, { type: 'heal', target: 'player', magnitude: 'full' });
  assert.equal(second.applied, false);
});

test('numeric mutation resolves a current target, clamps linked values, and preserves the source', () => {
  const world = createAstraWorld('variable-river');
  const npc = Object.values(world.characters)[0];
  const before = npc.wealth;
  const changed = applyNumericMutation(world, { kind: 'character', id: npc.id, field: 'wealth', operation: 'delta', value: -1000000 });
  assert.equal(changed.applied, before > 0);
  assert.equal(npc.wealth, 0);
  assert.equal(changed.actualDelta, -before);
  assert.equal(changed.targetId, npc.id);
  world.player.health = 80;
  const max = applyNumericMutation(world, { kind: 'player', id: 'player', field: 'maxHealth', operation: 'set', value: 30 });
  assert.equal(max.applied, true);
  assert.equal(world.player.health, 30);
  assert.equal(world.player.maxHealth, 30);
  assert.throws(() => applyNumericMutation(world, { kind: 'player', id: 'player', field: '__proto__', operation: 'set', value: 1 }));
});

test('natural-language numeric wishes use current entity IDs across seeds and survive save reload', () => {
  for (const seed of ['variable-mountain', 'variable-sea']) {
    const source = createAstraWorld(seed);
    const faction = Object.values(source.factions).find(value => value.active);
    const location = Object.values(source.locations).find(value => !value.destroyed);
    const npc = Object.values(source.characters).find(value => value.alive);
    let world = wish(source, `言出法随：将${faction.name}的实力增加25`);
    const expectedPower = Math.min(100, source.factions[faction.id].power + 25);
    assert.equal(world.factions[faction.id].power, expectedPower);
    world = wish(world, `言出法随：将${location.name}的人口增加30`);
    assert.equal(world.locations[location.id].population, source.locations[location.id].population + 30);
    world = wish(world, `言出法随：将${npc.name}的财富增加15`);
    assert.equal(world.characters[npc.id].wealth, source.characters[npc.id].wealth + 15);
    const restored = normalizeAstraWorld(JSON.parse(JSON.stringify(world)));
    assert.equal(restored.factions[faction.id].power, expectedPower);
    assert.equal(restored.locations[location.id].population, source.locations[location.id].population + 30);
    assert.equal(restored.characters[npc.id].wealth, source.characters[npc.id].wealth + 15);
  }
});

test('zero faction strength closes its dependent territories and associations', () => {
  const world = createAstraWorld('variable-faction-collapse');
  const faction = Object.values(world.factions).find(value => value.active && value.territories.length);
  const controlled = Object.values(world.locations).filter(loc => loc.controllerFactionId === faction.id);
  const linked = Object.values(world.characters).filter(character => character.factionId === faction.id);
  const quest = linked.length ? createQuestArc(world, QUEST_TEMPLATES[0].id,
    { giverId: linked[0].id, locationId: linked[0].locationId || world.player.locationId }) : null;
  const result = applyNumericMutation(world, { kind: 'faction', id: faction.id,
    field: 'power', operation: 'set', value: 0 });
  assert.equal(result.applied, true);
  assert.equal(faction.active, false);
  assert.equal(faction.territories.length, 0);
  assert.ok(controlled.every(loc => loc.controllerFactionId === null));
  assert.ok(linked.every(character => character.factionId === null));
  assert.equal(faction.memberIds.length, 0);
  if (quest) assert.equal(quest.state, 'mutated');
});

test('mutable numeric bounds and no-op history are read at settlement time', () => {
  let world = createAstraWorld('variable-bounds');
  world.rules.variables.player.safety.max = 60;
  world.player.safety = 60;
  const changed = wish(world, '言出法随：将我的安全增加20');
  const record = changed.history.at(-1);
  assert.equal(changed.player.safety, 60);
  assert.equal(record.applied, false);
  assert.equal(record.cost, 0);
  world = wish(changed, '言出法随：将我的财富增加20');
  assert.equal(world.player.wealth, changed.player.wealth + 20);
  assert.equal(world.history.at(-1).applied, true);
});

test('older saves acquire rules without losing their facts, and narration sees current numeric values', () => {
  const legacy = createAstraWorld('older-variable-save');
  const faction = Object.values(legacy.factions)[0];
  legacy.player.wealth = 777;
  delete legacy.rules;
  const restored = normalizeAstraWorld(JSON.parse(JSON.stringify(legacy)));
  assert.equal(restored.player.wealth, 777);
  assert.equal(restored.rules.cultivation.globalMaximum, 'tribulation');
  const packet = compileAstraContext({ astraWorld: restored }, `${faction.name}的实力是多少？`);
  assert.equal(packet.player.wealth, 777);
  assert.equal(packet.numericFacts.find(entry => entry.id === faction.id).power, faction.power);
});
