import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld, normalizeAstraWorld, astraContentCounts } from '../../game/astra-world.js';
import { advanceAstraWorld } from '../../game/astra-scheduler.js';
import { LOCATION_TEMPLATES, FACTION_TEMPLATES, NPC_ARCHETYPES, EVENT_TEMPLATES, QUEST_TEMPLATES, ANCHOR_FAMILIES, ITEM_TEMPLATES } from '../../game/astra-content.js';

test('a seed creates a bounded, linked world with absolute time', () => {
  const world = createAstraWorld('river-17', '阿青');
  for (const key of ['seed', 'minute', 'player', 'locations', 'edges', 'characters', 'factions', 'items', 'quests', 'anchors', 'eventQueue', 'history', 'rumors', 'secrets', 'terminal', 'flags']) {
    assert.ok(Object.hasOwn(world, key), `missing ${key}`);
  }
  assert.equal(world.minute, 360);
  assert.equal(world.player.name, '阿青');
  assert.ok(world.locations[world.player.locationId]);
  assert.ok(world.edges.length >= 50);
  for (const edge of world.edges) {
    assert.ok(world.locations[edge.from], `unknown edge origin ${edge.from}`);
    assert.ok(world.locations[edge.to], `unknown edge destination ${edge.to}`);
    assert.ok(edge.minutes > 0);
  }
  assert.ok(JSON.stringify(world).length < 300_000, 'initial save must be bounded');
});

test('the same seed recreates the same authoritative world', () => {
  assert.deepEqual(createAstraWorld(4815, '秋'), createAstraWorld(4815, '秋'));
});

test('different seeds change structural conditions rather than only names', () => {
  const samples = Array.from({ length: 20 }, (_, i) => createAstraWorld(i + 1000, '秋'));
  assert.ok(new Set(samples.map(w => w.player.locationId)).size >= 4);
  assert.ok(new Set(samples.map(w => w.player.background)).size >= 5);
  assert.ok(new Set(samples.map(w => w.flags.worldPressure.war)).size >= 4);
  assert.ok(new Set(samples.map(w => w.characters['npc:lin-xiaoman'].role)).size >= 5);
  assert.ok(new Set(samples.map(w => w.flags.dynastyId)).size >= 2);
  assert.ok(new Set(samples.map(w => w.edges.map(e => e.id).join('|'))).size >= 4);
});

test('player starts mortal without inherited power or automatic sect protection', () => {
  for (let seed = 0; seed < 30; seed++) {
    const world = createAstraWorld(seed, '凡人');
    assert.equal(world.player.cultivation.realm, 'none');
    assert.equal(world.player.cultivation.level, 0);
    assert.equal(world.player.factionId, null);
    assert.equal(world.player.invincible, false);
    assert.equal(world.player.alive, true);
    assert.ok(world.player.wealth >= 0);
    assert.ok(Object.values(world.items).every(item => item.ownerId !== world.player.id || item.tier === 'mortal'));
  }
});

test('Lin Xiaoman has her own life and a guaranteed early encounter', () => {
  for (let seed = 0; seed < 20; seed++) {
    const world = createAstraWorld(seed, '旅人');
    const lin = world.characters['npc:lin-xiaoman'];
    assert.equal(lin.name, '林小满');
    assert.equal(lin.alive, true);
    assert.ok(world.locations[lin.locationId]);
    assert.ok(lin.family && typeof lin.family === 'object');
    assert.ok(lin.goals.length > 0);
    assert.ok(lin.fears.length > 0);
    assert.ok(lin.schedule.length > 0);
    assert.ok(Array.isArray(lin.memories));
    assert.ok(lin.relationships && typeof lin.relationships === 'object');
    assert.ok(lin.cultivationPotential !== undefined);
    const encounter = world.eventQueue.find(event => event.id === 'event:lin-first-encounter');
    assert.equal(encounter?.type, 'lin_first_encounter');
    assert.ok(encounter.dueAt > 0 && encounter.dueAt <= 7 * 1440);
  }
});

test('catalogs reach target scale with usable causal templates', () => {
  const counts = astraContentCounts();
  const catalogs = [
    ['locations', LOCATION_TEMPLATES, 50], ['factions', FACTION_TEMPLATES, 30],
    ['npcArchetypes', NPC_ARCHETYPES, 100], ['events', EVENT_TEMPLATES, 200],
    ['quests', QUEST_TEMPLATES, 100], ['anchors', ANCHOR_FAMILIES, 50],
    ['items', ITEM_TEMPLATES, 300]
  ];
  for (const [key, catalog, minimum] of catalogs) {
    assert.ok(counts[key] >= minimum, `${key}: ${counts[key]}`);
    assert.equal(counts[key], catalog.length);
    assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length, `${key} ids must be unique`);
  }
  assert.ok(LOCATION_TEMPLATES.every(t => t.layer && t.kind && t.name));
  assert.ok(FACTION_TEMPLATES.every(t => t.type && t.goals.length));
  assert.ok(NPC_ARCHETYPES.every(t => t.occupation && t.goals.length && t.dailyAction));
  assert.ok(EVENT_TEMPLATES.every(t => t.trigger && t.effects.length && t.participants.length));
  assert.ok(QUEST_TEMPLATES.every(t => t.objectives.length && t.deadlineDays > 0 && t.failureEffect));
  assert.ok(ANCHOR_FAMILIES.every(t => t.era && t.eventIds.length && t.windowDays[1] > t.windowDays[0]));
  assert.ok(ITEM_TEMPLATES.every(t => t.category && t.use && t.value > 0));
});

test('anchor subfamilies vary their causes and reference real events', () => {
  const eventIds = new Set(EVENT_TEMPLATES.map(event => event.id));
  for (const anchor of ANCHOR_FAMILIES) {
    assert.ok(anchor.eventIds.every(id => eventIds.has(id)), `bad event reference from ${anchor.id}`);
    assert.ok(anchor.trigger && anchor.offscreenOutcome, `missing causal rule from ${anchor.id}`);
  }
  const hometown = ANCHOR_FAMILIES.filter(anchor => anchor.family === 'hometown');
  assert.ok(new Set(hometown.map(anchor => anchor.eventIds.join('|'))).size >= 5);
});

test('people already dead at world creation are not present in a location', () => {
  const worlds = Array.from({ length: 20 }, (_, seed) => createAstraWorld(seed, '秋'));
  const dead = worlds.flatMap(world => Object.values(world.characters).filter(character => !character.alive));
  assert.ok(dead.length > 0);
  assert.ok(dead.every(character => character.locationId === null));
});

test('first 20 hours vary background, local events, Lin role and quest opportunity', () => {
  const signatures = Array.from({ length: 12 }, (_, seed) => {
    const world = advanceAstraWorld(createAstraWorld(`twenty-hours-${seed}`), 20 * 60).world;
    assert.equal(world.flags.encounterLinResolved, true);
    assert.ok(Object.values(world.quests).some(quest => quest.originEventId === 'event:opening-local'));
    return [world.player.background, world.player.locationId, world.characters['npc:lin-xiaoman'].role,
      Object.values(world.quests).find(quest => quest.originEventId === 'event:opening-local')?.templateId,
      world.locations[world.player.locationId].controllerFactionId].join('|');
  });
  assert.ok(new Set(signatures).size >= 10);
});

test('normalization preserves committed world facts and isolates input', () => {
  const saved = createAstraWorld(84, '晴');
  saved.minute = 19840;
  saved.characters['npc:lin-xiaoman'].alive = false;
  saved.history.push({ id: 'history:lin-death', minute: 19840, type: 'death' });
  const loaded = normalizeAstraWorld(saved, 999, '错误名字');
  assert.equal(loaded.seed, saved.seed);
  assert.equal(loaded.minute, 19840);
  assert.equal(loaded.player.name, '晴');
  assert.equal(loaded.characters['npc:lin-xiaoman'].alive, false);
  assert.equal(loaded.history.at(-1).id, 'history:lin-death');
  loaded.minute = 12;
  assert.equal(saved.minute, 19840);
  assert.equal(normalizeAstraWorld(null, 84, '晴').minute, 360);
});
