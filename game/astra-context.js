// A bounded, read-only view of the authoritative world for one narration turn.
const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const text = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const idOf = value => typeof value === 'string' ? value : value?.id ?? value?.locationId ?? '';
const status = value => value?.status ?? value?.lifeState ?? value?.state ?? 'alive';
const active = value => value?.alive !== false && !['dead', 'deceased', 'destroyed', 'erased', 'missing'].includes(String(status(value)).toLowerCase());
const locationOf = value => value?.locationId ?? value?.targetLocationId ?? value?.location ?? value?.at ?? '';
const knownBy = value => list(value?.knownBy ?? value?.knownByIds ?? value?.knownByActorIds).map(idOf);
const boundedValue = (value, depth = 0) => {
  if (typeof value === 'string') return text(value, 160);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2 || value == null) return null;
  if (Array.isArray(value)) return value.slice(0, 8).map(entry => boundedValue(entry, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 8)
    .map(([key, entry]) => [text(key, 48), boundedValue(entry, depth + 1)]));
  return null;
};
const compact = (value, fields, limits = {}) => Object.fromEntries(fields
  .filter(key => value?.[key] !== undefined)
  .map(key => [key, typeof value[key] === 'string' ? text(value[key], limits[key] ?? 160) : boundedValue(value[key])]));

// Keep the newest facts, then add older facts that overlap the player's
// question. This uses local state only and does not spend a model request.
function recall(items, query, limit, describe) {
  const rows = list(items);
  const recentStart = Math.max(0, rows.length - Math.ceil(limit / 2));
  const recent = rows.slice(recentStart);
  const phrases = [...String(query).matchAll(/[\p{Script=Han}]{2,}/gu)].map(match => match[0]);
  const grams = [...new Set(phrases.flatMap(phrase => Array.from({ length: phrase.length - 1 }, (_, i) => phrase.slice(i, i + 2))))];
  if (!grams.length) return rows.slice(-limit);
  const older = rows.slice(0, recentStart).map((entry, index) => {
    const value = String(describe(entry) || '');
    return { entry, index, score: grams.filter(gram => value.includes(gram)).length };
  }).filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit - recent.length).map(hit => hit.entry);
  return [...recent, ...older];
}

const RULES = [
  'Engine state is authoritative. Narrate only facts supported by this packet.',
  'Only present, living NPCs may speak; each NPC may use only its listed knowledge.',
  'Do not create items, skills, travel, time changes, quest changes, or resurrection from prose.',
  'Due events resolve at their Engine time. Terminal world state is absorbing.'
];

function edgeEnds(edge) {
  if (Array.isArray(edge)) return [idOf(edge[0]), idOf(edge[1])];
  return [idOf(edge?.from ?? edge?.a ?? edge?.source), idOf(edge?.to ?? edge?.b ?? edge?.target)];
}

function relevant(entry, locationId, input, npcIds) {
  const place = locationOf(entry);
  const actors = list(entry?.actors ?? entry?.actorIds).map(idOf);
  const summary = text(entry?.summary ?? entry?.text ?? entry?.title, 240);
  return place === locationId || actors.some(id => npcIds.includes(id)) || (summary && input.includes(summary.slice(0, 8)));
}

/** Compile at most a few local facts from a schema-6 state. This never mutates state. */
export function compileAstraContext(state, input, recentTurns = []) {
  const world = state?.astraWorld ?? state?.world ?? state ?? {};
  const minute = Number.isFinite(Number(world.minute)) ? Number(world.minute) : 0;
  const player = world.player ?? {};
  const query = text(input, 500);
  const locations = list(world.locations);
  const currentId = idOf(locationOf(player) || world.currentLocationId || state?.story?.location);
  const current = locations.find(loc => idOf(loc) === currentId || loc?.name === currentId) ?? { id: currentId, name: currentId };
  const locationId = idOf(current);
  const nearbyIds = new Set();
  const nearbyEdges = [];
  for (const edge of list(world.edges)) {
    const [from, to] = edgeEnds(edge);
    if (from === locationId && to) {
      nearbyIds.add(to);
      if (nearbyEdges.length < 12) nearbyEdges.push({ from, to,
        ...compact(edge, ['minutes', 'risk', 'kind', 'closed']) });
    }
  }
  const nearbyLocations = locations.filter(loc => nearbyIds.has(idOf(loc))).slice(0, 8)
    .map(loc => compact(loc, ['id', 'name', 'status', 'destroyed', 'closed', 'regionId', 'description'], { description: 100 }));
  const secrets = list(world.secrets);
  const npcs = list(world.characters ?? world.npcs).filter(npc => active(npc) && !npc.travel
    && (locationOf(npc) === locationId || locationOf(npc) === current?.name)).slice(0, 8);
  const npcIds = npcs.map(idOf);
  const presentNpcs = npcs.map(npc => ({
    ...compact(npc, ['id', 'name', 'alive', 'status', 'locationId', 'goal', 'goals', 'currentGoals', 'knownFactIds', 'knowledge', 'relationships'], { goal: 120 }),
    memories: recall(npc.memories, query, 4, x => typeof x === 'string' ? x : x?.summary ?? x?.text)
      .map(x => typeof x === 'string' ? text(x, 140) : compact(x, ['id', 'summary', 'text'], { summary: 140, text: 140 })),
    allowedSecrets: secrets.filter(secret => knownBy(secret).some(id => id === npc.id || id === npc.name))
      .slice(0, 4).map(secret => compact(secret, ['id', 'text', 'summary'], { text: 140, summary: 140 }))
  }));
  const activeQuests = list(world.quests).filter(quest => ['active', 'available', 'in-progress', 'accepted'].includes(String(quest?.state ?? quest?.status)))
    .filter(quest => !locationOf(quest) || locationOf(quest) === locationId || query.includes(text(quest?.title ?? quest?.name, 60)))
    .slice(0, 8).map(quest => compact(quest, ['id', 'title', 'name', 'state', 'status', 'stage', 'deadline', 'locationId', 'summary'], { summary: 120 }));
  const dueEvents = list(world.eventQueue).filter(event => Number(event?.dueAt ?? event?.minute) <= minute)
    .sort((a, b) => Number(a.dueAt ?? a.minute) - Number(b.dueAt ?? b.minute)).slice(0, 8)
    .map(event => compact(event, ['id', 'type', 'dueAt', 'locationId', 'summary', 'payload'], { summary: 120 }));
  const history = recall(list(world.history).filter(entry => (entry?.playerWitnessed || entry?.public || entry?.visibleToPlayer)
    && relevant(entry, locationId, query, npcIds) && entry?.type !== 'player_speech'), query, 8, entry => entry?.summary)
    .map(entry => compact(entry, ['id', 'timestamp', 'type', 'actors', 'locationId', 'summary', 'worldImpact'], { summary: 160, worldImpact: 100 }));
  const rumors = list(world.rumors).filter(entry => knownBy(entry).some(id => npcIds.includes(id)) && relevant(entry, locationId, query, npcIds))
    .slice(-6).map(entry => compact(entry, ['id', 'text', 'summary', 'truthConfidence', 'sourceCredibility'], { text: 140, summary: 140 }));
  const memories = recall(list(world.memories ?? state?.memory?.episodes).filter(entry => relevant(entry, locationId, query, npcIds)),
    query, 6, entry => entry?.summary ?? entry?.text)
    .map(entry => compact(entry, ['id', 'summary', 'text', 'timestamp', 'locationId'], { summary: 140, text: 140 }));
  const turns = Array.isArray(recentTurns) ? recentTurns.filter(turn => turn?.kind !== 'system').slice(-6) : [];
  const packet = {
    systemRules: RULES, minute, input: query,
    location: compact(current, ['id', 'name', 'status', 'destroyed', 'closed', 'regionId', 'description'], { description: 140 }),
    nearbyLocations, nearbyEdges,
    player: compact(player, ['name', 'locationId', 'cultivation', 'realm', 'health', 'hp', 'qi', 'spirit', 'skills', 'inventory'], {}),
    presentNpcs, activeQuests, dueEvents, history, memories, rumors,
    terminal: compact(world.terminal, ['ended', 'ending', 'minute', 'type', 'kind', 'state', 'active', 'summary'], { summary: 120 }),
    recentTurns: turns.map(turn => ({ id: text(turn.id, 60), userText: text(turn.userText ?? turn.input, 220),
      blocks: list(turn.blocks).slice(-4).map(block => compact(block, ['type', 'name', 'text'], { text: 240 })) }))
  };
  // Long saves may contain unusually verbose individual facts. Keep the
  // packet capped even when the stored world was produced by an older build.
  const trimOrder = ['history', 'memories', 'rumors', 'recentTurns', 'activeQuests', 'dueEvents', 'nearbyLocations', 'nearbyEdges', 'presentNpcs'];
  while (JSON.stringify(packet).length > 12_000) {
    const field = trimOrder.find(key => packet[key].length > (key === 'presentNpcs' ? 1 : 0));
    if (!field) break;
    packet[field].shift();
  }
  return packet;
}
