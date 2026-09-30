import { seededRng } from './astra-seed.js';
import { initialAstraRules, realmRules } from './astra-rules.js';
import {
  LOCATION_TEMPLATES, FACTION_TEMPLATES, NPC_ARCHETYPES,
  EVENT_TEMPLATES, QUEST_TEMPLATES, ANCHOR_FAMILIES, ITEM_TEMPLATES
} from './astra-content.js';

const DAY = 1440;
const STARTS = ['loc:linxi', 'loc:liuhe', 'loc:qinghe', 'loc:heyang', 'loc:yundu', 'loc:riceplain', 'loc:eastpass', 'loc:southmarket'];
const BACKGROUNDS = [
  ['farming household', 'riceplain', 24], ['merchant family', 'southmarket', 90],
  ['wealthy household', 'heyang', 180], ['minor official family', 'qinghe', 110],
  ['ruined clan', 'linxi', 15], ['hunter', 'blackwind', 30],
  ['fisherman', 'yundu', 32], ['orphan', 'liuhe', 8],
  ['medical apprentice', 'huichun', 45], ['courier', 'eastpass', 38],
  ['guard trainee', 'qinghe', 42], ['escort apprentice', 'feihong', 48],
  ['scholar', 'bailu', 65], ['inn worker', 'changle', 35],
  ['servant', 'gumanor', 18], ['village craftsman', 'liuhe', 50],
  ['traveling family', 'yundu', 60], ['refugee', 'eastpass', 6],
  ['minor noble household', 'heyang', 140]
];
const LIN_ROLES = [
  ['childhood neighbor', 'keep her family together', 'losing her home', 'npc-archetype:artisan:household'],
  ['market stranger', 'open a small shop', 'unpaid debt', 'npc-archetype:merchant:independent'],
  ['apothecary apprentice', 'qualify as a healer', 'failing a patient', 'npc-archetype:apothecary:apprentice'],
  ['wealthy daughter', 'choose her own future', 'a forced alliance', 'npc-archetype:scholar:household'],
  ['poor traveler', 'find a secure place to live', 'road violence', 'npc-archetype:courier:independent'],
  ['refugee', 'locate missing kin', 'another forced move', 'npc-archetype:herbalist:independent'],
  ['thief', 'clear a dangerous debt', 'capture by the guard', 'npc-archetype:outlaw:apprentice'],
  ['caravan member', 'earn a permanent trade place', 'bandit raids', 'npc-archetype:escort:apprentice'],
  ['examination candidate', 'pass the county examination', 'wasting family savings', 'npc-archetype:scholar:apprentice'],
  ['sect applicant', 'earn admission on her own terms', 'being used by a sect', 'npc-archetype:disciple:apprentice'],
  ['rival claimant', 'recover an object owed to her family', 'a false accusation', 'npc-archetype:clerk:independent'],
  ['peaceful neighbor', 'build a quiet household', 'family illness', 'npc-archetype:farmer:household']
];
const RULER_IDS = ['faction:daqian', 'faction:beiliang', 'faction:yunmeng', 'faction:easterncourt'];
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cleanName = name => String(name ?? '').replace(/[<>\u0000-\u001f]/gu, '').trim().slice(0, 60) || '无名之人';

export function astraContentCounts() {
  return {
    locations: LOCATION_TEMPLATES.length, factions: FACTION_TEMPLATES.length,
    npcArchetypes: NPC_ARCHETYPES.length, events: EVENT_TEMPLATES.length,
    quests: QUEST_TEMPLATES.length, anchors: ANCHOR_FAMILIES.length,
    items: ITEM_TEMPLATES.length
  };
}

function createGeography(seed, params) {
  const rng = seededRng(seed, 'geography');
  const locations = {};
  const edges = [];
  const groups = { mortal: [], cultivation: [], world: [], upper: [] };
  for (const [index, template] of LOCATION_TEMPLATES.entries()) {
    groups[template.layer].push(template.id);
    const parentId = template.layer === 'mortal'
      ? (['capital', 'city', 'county', 'town', 'village'].includes(template.kind) ? null : 'loc:qinghe')
      : template.layer === 'cultivation' ? 'loc:wanbao'
        : template.layer === 'world' ? 'loc:skyruin' : 'loc:myriadcity';
    const chosenParent = parentId === template.id ? null : parentId;
    const populationScale = template.layer === 'mortal' ? 1 : template.layer === 'cultivation' ? 0.2 : 0.02;
    locations[template.id] = {
      id: template.id, templateId: template.id, name: template.name,
      parentId: chosenParent, layer: template.layer, kind: template.kind,
      coordinates: { x: index % 12 + rng.int(-2, 2), y: Math.floor(index / 12) + rng.int(-2, 2) },
      edges: [], risk: Math.min(100, rng.int(3, 35) + params.danger + (template.layer === 'world' ? 25 : 0)),
      population: Math.floor(rng.int(80, 3500) * populationScale),
      controllerFactionId: null,
      economy: { prosperity: rng.int(15, 75) + Math.floor(params.trade / 5), food: rng.int(20, 90) },
      resources: template.layer === 'mortal' ? ['food', 'timber'] : template.layer === 'cultivation' ? ['spirit herbs', 'ore'] : ['relics'],
      services: ['market', 'city', 'town', 'village'].includes(template.kind) ? ['trade', 'lodging'] : template.kind === 'clinic' ? ['healing'] : [],
      discovered: false, destroyed: false, closed: false, historicalNames: [], tags: [...template.tags]
    };
  }
  const addEdge = (from, to, kind = 'road') => {
    const id = `edge:${from.slice(4)}:${to.slice(4)}`;
    if (edges.some(edge => edge.id === id)) return;
    const minutes = kind === 'road' ? rng.int(15, 720) : kind === 'passage' ? rng.int(720, 10080) : rng.int(60, 2880);
    edges.push({ id, from, to, minutes, risk: Math.max(locations[from].risk, locations[to].risk), kind, closed: false });
    locations[from].edges.push(id);
  };
  for (const ids of Object.values(groups)) {
    for (let i = 0; i < ids.length; i++) {
      const next = ids[(i + 1) % ids.length];
      addEdge(ids[i], next);
      addEdge(next, ids[i]);
    }
    // A seed changes shortcuts and therefore travel choices, not merely labels.
    for (let i = 0; i < Math.floor(ids.length / 4); i++) {
      const a = rng.pick(ids);
      const b = rng.pick(ids);
      if (a !== b) { addEdge(a, b); addEdge(b, a); }
    }
  }
  const bridges = [['loc:daqian','loc:wanbao'],['loc:blackwind','loc:qingxuan'],['loc:swordtomb','loc:skyruin'],['loc:skyruin','loc:taixu']];
  for (const [a, b] of bridges) { addEdge(a, b, 'passage'); addEdge(b, a, 'passage'); }
  return { locations, edges };
}

function createFactions(seed, locations, params) {
  const rng = seededRng(seed, 'factions');
  const factionIds = FACTION_TEMPLATES.map(faction => faction.id);
  const factions = {};
  const layerLocations = {
    dynasty: LOCATION_TEMPLATES.filter(t => t.layer === 'mortal'),
    sect: LOCATION_TEMPLATES.filter(t => t.layer === 'cultivation'),
    demonic: LOCATION_TEMPLATES.filter(t => t.layer === 'cultivation' || t.layer === 'world'),
    clan: LOCATION_TEMPLATES.filter(t => t.layer === 'mortal'),
    guild: LOCATION_TEMPLATES.filter(t => t.layer === 'mortal' || t.layer === 'cultivation'),
    other: LOCATION_TEMPLATES
  };
  for (const template of FACTION_TEMPLATES) {
    const homeId = rng.pick(layerLocations[template.type]).id;
    const power = rng.int(15, 80);
    factions[template.id] = {
      id: template.id, templateId: template.id, name: template.name, type: template.type,
      active: rng.chance(template.type === 'other' ? 0.9 : 0.98),
      homeId, territories: [homeId], leaderId: null, memberIds: [],
      power, wealth: rng.int(20, 120), stability: rng.int(20, 95),
      resources: template.type === 'sect' ? ['spirit stone', 'herbs'] : ['food', 'trade'],
      goals: [...template.goals], allies: [], enemies: [], wars: [], secrets: [],
      succession: 'settled', relations: {}
    };
  }
  for (const location of Object.values(locations)) {
    const owners = location.layer === 'mortal' ? RULER_IDS
      : location.layer === 'cultivation' ? factionIds.filter(id => factions[id].type === 'sect')
        : factionIds.filter(id => factions[id].type === 'other');
    location.controllerFactionId = rng.pick(owners);
  }
  for (const faction of Object.values(factions)) faction.territories = [];
  for (const location of Object.values(locations)) factions[location.controllerFactionId]?.territories.push(location.id);
  for (const id of factionIds) {
    const faction = factions[id];
    const opponent = rng.pick(factionIds.filter(other => other !== id));
    faction.relations[opponent] = Math.max(-100, Math.min(100, rng.int(-70, 50) - Math.floor(params.war / 5)));
    if (faction.relations[opponent] < -45) faction.enemies.push(opponent);
  }
  return factions;
}

function createLin(seed, startId, locations) {
  const rng = seededRng(seed, 'lin-xiaoman');
  const [role, goal, fear, archetypeId] = rng.pick(LIN_ROLES);
  const family = {
    parentsAlive: rng.chance(0.76), siblings: rng.int(0, 3),
    householdWealth: rng.int(5, role === 'wealthy daughter' ? 200 : 90),
    homeId: startId, relationships: {}
  };
  const nearby = [startId, ...Object.keys(locations).filter(id => id.startsWith('loc:') && locations[id].layer === 'mortal').slice(0, 8)];
  return {
    id: 'npc:lin-xiaoman', name: '林小满', archetypeId, role,
    age: rng.int(15, 23), sex: 'female', species: 'human', alive: true,
    locationId: rng.pick(nearby), homeId: family.homeId, factionId: null,
    occupation: role, cultivation: { realm: 'none', level: 0 },
    cultivationPotential: rng.int(0, 100), physicalCondition: 'healthy',
    personality: rng.pick(['curious', 'reserved', 'kind', 'ambitious', 'wary', 'mischievous']),
    goals: [goal, 'maintain her own livelihood'], currentGoals: [goal], fears: [fear],
    attachments: ['family'], family, relationships: {}, inventory: [], wealth: family.householdWealth,
    secrets: [], knowledge: [], memories: [],
    schedule: [{ at: 'morning', activity: 'work' }, { at: 'evening', activity: 'family or private affairs' }],
    travel: null, currentPlan: { type: 'pursue_goal', goal }, injuries: [], questLinks: [], storyFlags: {},
    simulationImportance: 'persistent', metPlayer: false
  };
}

function createOtherCharacters(seed, locations, factions) {
  const rng = seededRng(seed, 'named-cast');
  const names = ['赵天霸', '苏清雪', '陈不归', '顾青山', '李老', '钱多多', '慕容雪', '陆沉舟', '宁无妄', '苏晚晴'];
  const characters = {};
  for (const [index, name] of names.entries()) {
    const archetype = rng.pick(NPC_ARCHETYPES);
    const location = rng.pick(LOCATION_TEMPLATES.filter(t => t.layer === archetype.startingLayer));
    const faction = rng.pick(FACTION_TEMPLATES.filter(t => t.type !== 'other'));
    const id = `npc:cast-${index}`;
    const alive = rng.chance(0.94);
    characters[id] = {
      id, name, archetypeId: archetype.id, role: archetype.title,
      age: rng.int(18, 75), sex: rng.chance(0.5) ? 'female' : 'male', species: 'human',
      alive, locationId: alive ? location.id : null, homeId: location.id,
      factionId: faction.id, occupation: archetype.occupation,
      cultivation: { realm: archetype.startingLayer === 'cultivation' && rng.chance(0.6) ? 'qi_refining' : 'none', level: 0 },
      physicalCondition: 'healthy', personality: rng.pick(['patient','bold','cautious','proud','generous']),
      goals: [...archetype.goals], currentGoals: [archetype.goals[0]], fears: [archetype.constraint],
      attachments: [], family: { parentsAlive: rng.chance(0.6), siblings: rng.int(0, 4) },
      relationships: {}, inventory: [], wealth: rng.int(2, 100), secrets: [], knowledge: [], memories: [],
      schedule: [{ at: 'day', activity: archetype.dailyAction }], travel: null,
      currentPlan: { type: archetype.dailyAction }, injuries: [], questLinks: [], storyFlags: {},
      simulationImportance: index < 4 ? 'regional' : 'background'
    };
    factions[faction.id].memberIds.push(id);
  }
  return characters;
}

function ensureFactionLeaders(seed, factions, characters) {
  const rng = seededRng(seed, 'faction-leaders');
  for (const faction of Object.values(factions)) {
    const known = faction.memberIds.find(id => characters[id]?.alive);
    if (known) { faction.leaderId = known; continue; }
    const id = `npc:leader:${faction.id.slice(8)}`;
    characters[id] = {
      id, name: `${faction.name}掌事`, archetypeId: 'npc-archetype:leader:regional',
      age: rng.int(28, 70), sex: rng.chance(0.5) ? 'female' : 'male', species: 'human', alive: true,
      locationId: faction.homeId, homeId: faction.homeId, factionId: faction.id,
      occupation: 'leader', cultivation: { realm: faction.type === 'sect' ? 'qi_refining' : 'none', level: rng.int(0, 5) },
      physicalCondition: 'healthy', personality: 'pragmatic', goals: [...faction.goals],
      currentGoals: faction.goals.slice(0, 1), fears: ['loss of authority'], attachments: [faction.id],
      family: { parentsAlive: rng.chance(0.5), siblings: rng.int(0, 3) }, relationships: {}, inventory: [],
      wealth: rng.int(20, 100), secrets: [], knowledge: [], memories: [],
      schedule: [{ at: 'day', activity: 'govern' }], travel: null,
      currentPlan: { type: 'govern', factionId: faction.id }, injuries: [], questLinks: [], storyFlags: {},
      simulationImportance: 'regional'
    };
    faction.leaderId = id;
    faction.memberIds.push(id);
  }
}

function createStartingItems(seed, player, locations) {
  const rng = seededRng(seed, 'starting-items');
  const essentials = ['item:copper:small', 'item:family-letter:copy'];
  const extras = ['item:short-knife:serviceable', 'item:herb:standard', 'item:travel-pass:witnessed', 'item:rope:serviceable', 'item:rice:raw'];
  const ids = [...essentials, rng.pick(extras)];
  const templates = Object.fromEntries(ITEM_TEMPLATES.map(template => [template.id, template]));
  const items = {};
  for (const [index, id] of ids.entries()) {
    const template = templates[id];
    const itemId = `item-instance:start-${index}`;
    items[itemId] = {
      id: itemId, templateId: id, ownerId: player.id, locationId: player.locationId,
      quantity: id.startsWith('item:copper:') ? rng.int(2, 20) : 1,
      durability: 100, quality: template.grade, effects: [template.use],
      creationHistory: [{ minute: 0, source: 'mortal household' }], transferHistory: [],
      destroyed: false, unique: false, tier: template.tier
    };
    player.inventory.push(itemId);
  }
  // The catalog remains in code, not duplicated into every save.
  void locations;
  return items;
}

function createOpeningAnchors(seed, startId, locations) {
  const rng = seededRng(seed, 'opening-anchors');
  const chosen = ['hometown','first-contact','personal-life','sect-crisis','regional-conflict','continental-crisis'];
  const anchors = {};
  for (const [index, family] of chosen.entries()) {
    const templates = ANCHOR_FAMILIES.filter(anchor => anchor.family === family);
    const template = templates[index < 3 ? 0 : 1];
    const place = family === 'hometown' || family === 'personal-life' ? startId
      : family === 'first-contact' ? rng.pick(['loc:qingyun','loc:qingxuan','loc:wanbao'])
        : family === 'sect-crisis' ? 'loc:qingxuan'
          : family === 'regional-conflict' ? 'loc:heyang' : 'loc:skyruin';
    const offset = index === 0 ? rng.int(3, 12) : index === 1 ? rng.int(20, 60)
      : index === 2 ? rng.int(7, 30) : rng.int(80, 600);
    const id = `anchor:opening-${index}`;
    anchors[id] = {
      id, templateId: template.id, family, era: template.era, locationId: place,
      windowStart: 360 + offset * DAY, windowEnd: 360 + (offset + template.windowDays[1] - template.windowDays[0]) * DAY,
      eventIds: [...template.eventIds], state: 'pending', selectedEventId: null,
      resolvedAt: null, participants: [], escalation: template.escalation
    };
    locations[place].tags.push('anchor-candidate');
  }
  return anchors;
}

export function createAstraWorld(seed = 'default', playerName = '无名之人') {
  const actualSeed = seed ?? 'default';
  const rng = seededRng(actualSeed, 'initial-conditions');
  const pressure = {
    spiritualDensity: rng.int(0, 100), danger: rng.int(0, 75), politicalStability: rng.int(5, 95),
    demonic: rng.int(0, 100), ruins: rng.int(0, 100), resources: rng.int(0, 100),
    war: rng.int(0, 100), trade: rng.int(0, 100), monsters: rng.int(0, 100),
    heavenInterference: rng.int(0, 100), weather: rng.pick(['temperate','rainy','dry','cold'])
  };
  const background = rng.pick(BACKGROUNDS);
  const startId = rng.chance(0.58) ? `loc:${background[1]}` : rng.pick(STARTS);
  const { locations, edges } = createGeography(actualSeed, pressure);
  locations[startId].discovered = true;
  const factions = createFactions(actualSeed, locations, pressure);
  const familyRng = seededRng(actualSeed, 'player-family');
  const player = {
    id: 'player', name: cleanName(playerName), alive: true, age: familyRng.int(15, 24),
    locationId: startId, homeId: startId, background: background[0],
    family: { parentsAlive: background[0] === 'orphan' ? false : familyRng.chance(0.82),
      siblings: familyRng.int(0, 4), supportive: familyRng.chance(0.73), homeId: startId },
    wealth: Math.max(0, background[2] + familyRng.int(-12, 22)),
    safety: Math.max(0, Math.min(100, 85 - Math.floor(pressure.danger / 2) + familyRng.int(-20, 20))),
    cultivation: { realm: 'none', level: 0, spiritualRootKnown: false },
    factionId: null, invincible: false, inventory: [], relationships: {},
    health: 100, maxHealth: 100, secrets: [], knowledge: [], memories: [], flags: {}
  };
  const lin = createLin(actualSeed, startId, locations);
  const characters = { [lin.id]: lin, ...createOtherCharacters(actualSeed, locations, factions) };
  ensureFactionLeaders(actualSeed, factions, characters);
  const items = createStartingItems(actualSeed, player, locations);
  const anchors = createOpeningAnchors(actualSeed, startId, locations);
  const openingRng = seededRng(actualSeed, 'opening-events');
  const localFamily = openingRng.pick(['harvest','caravan','inspection','wedding','theft','illness','bandits','fire']);
  const firstEvent = EVENT_TEMPLATES.find(template => template.family === localFamily && template.pressure === 'calm');
  const encounterMinutes = openingRng.int(120, 1100);
  const eventQueue = [
    { id: 'event:lin-first-encounter', dueAt: 360 + encounterMinutes, priority: 10,
      type: 'lin_first_encounter', payload: { characterId: lin.id, role: lin.role, locationId: startId } },
    { id: 'event:opening-local', dueAt: 360 + openingRng.int(90, 1000), priority: 20,
      type: 'world_event', payload: { templateId: firstEvent.id, locationId: startId, opening: true } }
  ];
  const factionSchedule = seededRng(actualSeed, 'faction-schedule');
  for (const faction of Object.values(factions)) eventQueue.push({
    id: `event:faction-start:${faction.id}`, dueAt: 360 + factionSchedule.int(1, 7) * DAY,
    priority: 70, type: 'faction_tick', payload: { factionId: faction.id }
  });
  for (const anchor of Object.values(anchors)) eventQueue.push({
    id: `event:activate:${anchor.id}`, dueAt: anchor.windowStart, priority: 40,
    type: 'anchor_window', payload: { anchorId: anchor.id }
  });
  eventQueue.sort((a, b) => a.dueAt - b.dueAt || a.priority - b.priority || a.id.localeCompare(b.id));
  return {
    schema: 1, seed: actualSeed, minute: 360, player, locations, edges, characters,
    rules: initialAstraRules(),
    factions, items, quests: {}, anchors, eventQueue, history: [], historyArchive: { counts: {}, lastMinute: 0 },
    resolvedEventIds: [], rumors: [], secrets: [],
    terminal: { ended: false, ending: null, minute: null },
    flags: { dynastyId: rng.pick(RULER_IDS), worldPressure: pressure, worldAge: rng.int(20, 800),
      earlyOpportunity: openingRng.pick(['local healer','merchant route','sect examination','wandering mentor','ancient rumor']),
      earlyDanger: openingRng.pick(['bandits','flood','illness','monster','political dispute']),
      visitedLocations: [startId], encounterLinResolved: false }
  };
}

export function normalizeAstraWorld(raw, seed = 'default', playerName = '无名之人') {
  if (!isRecord(raw) || !isRecord(raw.player) || !isRecord(raw.locations)) return createAstraWorld(seed, playerName);
  // Save data is JSON. Cloning ensures a failed turn or normalization never
  // mutates the caller's committed copy.
  let saved;
  try { saved = JSON.parse(JSON.stringify(raw)); }
  catch { return createAstraWorld(seed, playerName); }
  const base = createAstraWorld(saved.seed ?? seed, saved.player.name ?? playerName);
  const fields = ['locations','edges','characters','factions','items','quests','anchors','eventQueue','history','historyArchive','resolvedEventIds','rumors','secrets','terminal','flags'];
  const result = { ...base, ...saved, schema: 1, seed: saved.seed ?? base.seed };
  result.minute = Number.isFinite(saved.minute) && saved.minute >= 0 ? Math.floor(saved.minute) : 360;
  result.player = { ...base.player, ...saved.player };
  result.rules = isRecord(saved.rules) ? { ...base.rules, ...saved.rules } : base.rules;
  result.rules.cultivation = structuredClone(realmRules(result));
  for (const key of fields) {
    if (Array.isArray(base[key])) result[key] = Array.isArray(saved[key]) ? saved[key] : base[key];
    else result[key] = isRecord(saved[key]) ? saved[key] : base[key];
  }
  return result;
}
