import { realmRank } from './astra-rules.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const text = value => String(value || '').replace(/[\u0000-\u001f]/gu, ' ').slice(0, 400);
export function ensureSimulation(world) {
  const sim = world.simulation ||= {};
  for (const field of ['events', 'beliefs', 'relations', 'rules', 'transactions', 'notifications', 'intents', 'commitments']) sim[field] ||= {};
  sim.pendingReports ||= [];
  sim.reported ||= {};
  sim.schema = 1;
  return sim;
}

export function recordCausalEvent(world, source) {
  const sim = ensureSimulation(world);
  if (!source?.id || !source.actorId || !source.locationId) throw new Error('因果事件缺少来源或地点。');
  if (sim.events[source.id]) return sim.events[source.id];
  const witnesses = Object.values(world.characters).filter(npc => npc.alive && !npc.travel
    && npc.locationId === source.locationId).map(npc => npc.id);
  const event = {
    id: text(source.id), actorId: text(source.actorId), action: text(source.action),
    targetIds: [...new Set(source.targetIds || [])], locationId: source.locationId,
    minute: world.minute, summary: text(source.summary), sourceId: source.sourceId || null,
    impacts: (source.impacts || []).map(impact => ({ entityId: impact.entityId,
      dimension: text(impact.dimension), delta: clamp(Number(impact.delta) || 0, -1, 1) })),
    witnessIds: [...new Set(source.witnessIds || witnesses)], affiliations: source.affiliations || {}, processed: false
  };
  sim.events[event.id] = event;
  return event;
}

function affinity(npc, entityId, sim, event = null) {
  if (npc.id === entityId) return 1;
  if (npc.factionId === entityId || event?.affiliations?.[npc.id] === entityId) return 0.85;
  if ((npc.attachments || []).some(entry => (entry?.entityId || entry) === entityId)) return 0.7;
  const link = Object.values(sim.relations).find(row => row.fromId === npc.id && row.toId === entityId && row.active !== false);
  if (link) return clamp(Number(link.weight ?? 0.5), -1, 1);
  return 0.1 * clamp(Number(npc.relationships?.[entityId] || 0) / 100, -1, 1);
}

function observe(world, npc, event, mode, confidence) {
  const sim = ensureSimulation(world);
  const key = npc.id + '|' + event.id;
  if (sim.beliefs[key]) return;
  const belief = { id: key, holderId: npc.id, eventId: event.id, mode, confidence,
    minute: world.minute, sourceId: event.sourceId, summary: event.summary };
  sim.beliefs[key] = belief;
  npc.knowledge ||= [];
  npc.knowledge.push(event.id);
  npc.knowledge = [...new Set(npc.knowledge)].slice(-80);
  npc.memories ||= [];
  npc.memories.push({ id: 'memory:' + key, eventId: event.id, minute: world.minute, summary: event.summary,
    locationId: event.locationId, source: mode, confidence });
  npc.memories = npc.memories.slice(-40);
  let appraisal = 0;
  for (const impact of event.impacts) {
    appraisal += affinity(npc, impact.entityId, sim, event) * impact.delta;
    // Loss of a known aggressor's power is relief; knowledge is observer-specific.
    if (impact.delta < 0 && ['power', 'life', 'security'].includes(impact.dimension)) {
      for (const knowledgeId of npc.knowledge) {
        const known = sim.beliefs[npc.id + '|' + knowledgeId];
        if (!known) continue;
        const prior = sim.events[known.eventId];
        if (!prior || prior.id === event.id || prior.actorId !== impact.entityId) continue;
        for (const harm of prior.impacts) if (harm.delta < 0)
          appraisal += affinity(npc, harm.entityId, sim) * harm.delta * impact.delta * known.confidence;
      }
    }
  }
  const delta = Math.round(clamp(appraisal, -1, 1) * confidence * 12);
  belief.appraisal = delta;
  if (delta && event.actorId !== npc.id) {
    npc.relationships ||= {};
    npc.relationships[event.actorId] = clamp(Number(npc.relationships[event.actorId] || 0) + delta, -100, 100);
    npc.currentPlan = { id: 'plan:' + key, causeEventId: event.id, targetId: event.actorId,
      type: delta > 0 ? 'support' : 'avoid', confidence, state: 'pending', createdAt: world.minute };
  }
}

function spread(world, event, locationId, confidence, hops) {
  const sim = ensureSimulation(world);
  const key = event.id + '|' + locationId;
  if (sim.reported[key] || hops >= 3) return;
  sim.reported[key] = true;
  for (const edge of world.edges.filter(row => row.from === locationId && !row.closed
    && !world.locations[row.to]?.destroyed).slice(0, 4)) {
    if (sim.reported[event.id + '|' + edge.to]) continue;
    sim.pendingReports.push({ id: event.id + '|' + locationId + '|' + edge.to, eventId: event.id,
      from: locationId, to: edge.to, due: world.minute + Math.max(1, edge.minutes || 60) + 60,
      confidence: confidence * 0.8, hops: hops + 1 });
  }
}

export function propagateCausality(world) {
  const sim = ensureSimulation(world);
  for (const event of Object.values(sim.events).filter(entry => !entry.processed).slice(0, 64)) {
    for (const id of event.witnessIds) {
      const npc = world.characters[id];
      if (npc?.alive) observe(world, npc, event, 'witness', 1);
    }
    event.processed = true;
    if (event.witnessIds.some(id => world.characters[id]?.alive)) spread(world, event, event.locationId, 1, 0);
  }
  const due = sim.pendingReports.filter(row => row.due <= world.minute).slice(0, 32);
  const completed = new Set(due.map(row => row.id));
  sim.pendingReports = sim.pendingReports.filter(row => !completed.has(row.id));
  for (const report of due) {
    const event = sim.events[report.eventId];
    if (!event || world.locations[report.to]?.destroyed
      || report.from && !world.edges.some(edge => edge.from === report.from && edge.to === report.to && !edge.closed)) continue;
    for (const npc of Object.values(world.characters).filter(row => row.alive && !row.travel && row.locationId === report.to))
      observe(world, npc, event, 'report', report.confidence);
    spread(world, event, report.to, report.confidence, report.hops);
  }
  return world;
}

export function isSpeculativeInput(content) {
  const value = String(content || '').replace(/^言出法随\s*[:：]/u, '');
  if (/假如|假设|要是|能否|是否|会不会|会怎样|怎么办|吗[？?]?$|[？?]$/u.test(value)) return true;
  if (/如果/u.test(value) && !/规则|法则|自动|每当|一旦/u.test(value)) return true;
  return /「|“|"/u.test(value);
}
export function assessIntent(world, input, targetId) {
  const spoken = String(input?.speech || '');
  const action = String(input?.action || '');
  const content = action || spoken;
  const hypothetical = isSpeculativeInput(content) || /开玩笑|不是要|不想/u.test(content);
  const target = world.characters[targetId];
  const aggressive = /杀|挑衅|袭击|攻击|灭|威胁|去死/u.test(content);
  const gap = target ? realmRank(world, target.cultivation?.realm) - realmRank(world, world.player.cultivation?.realm) : 0;
  return { performed: !hypothetical && Boolean(action), modality: hypothetical ? 'hypothetical' : action ? 'action' : 'speech',
    targetId: target?.id || null, risk: hypothetical || !aggressive ? 0 : clamp(0.2 + gap * 0.15, 0, 1),
    warning: !hypothetical && aggressive && gap > 0 ? '宿主，话我听见了。眼前这人的境界高过你；现在挑衅，吃亏的恐怕是你。想清楚再动手。' : '' };
}

export function companionNotification(world, id, message, sourceId, priority = 'normal') {
  const sim = ensureSimulation(world);
  if (sim.notifications[id]) return null;
  const notification = { id, message: text(message), sourceId, priority, minute: world.minute };
  sim.notifications[id] = notification;
  return notification;
}

export function captureWorldChanges(before, after, context) {
  const result = [];
  const id = context.turnId;
  const put = (suffix, targetId, dimension, delta, summary) => {
    const prior = before.characters[targetId] || before.factions[targetId] || before.locations[targetId];
    const event = recordCausalEvent(after, { id: id + ':' + suffix, actorId: context.actorId || 'player',
      action: context.action || 'change', locationId: context.locationId || prior?.locationId || prior?.lastKnownLocationId
        || prior?.homeId || before.player.locationId,
      sourceId: id, targetIds: [targetId], impacts: [{ entityId: targetId, dimension, delta }], summary,
      affiliations: Object.fromEntries(Object.values(before.characters).filter(npc => npc.factionId).map(npc => [npc.id, npc.factionId])) });
    result.push(event);
  };
  for (const npc of Object.values(after.characters)) {
    const prior = before.characters[npc.id];
    if (prior?.alive && !npc.alive) put(npc.id + ':death', npc.id, 'life', -1, npc.name + '身亡，原有牵挂随之改变。');
    if (prior && (npc.gender !== prior.gender || npc.name !== prior.name))
      put(npc.id + ':identity', npc.id, 'identity', 0, npc.name + '的身份信息已经改变。');
  }
  for (const faction of Object.values(after.factions)) {
    const prior = before.factions[faction.id];
    if (prior && (prior.active !== faction.active || prior.power !== faction.power))
      put(faction.id + ':power', faction.id, 'power', faction.active === false ? -1 : (faction.power - prior.power) / 100, faction.name + '的势力发生变化。');
  }
  for (const actor of [after.player, ...Object.values(after.characters)]) {
    const prior = actor.id === 'player' ? before.player : before.characters[actor.id];
    if (prior && actor.wealth !== prior.wealth)
      put(actor.id + ':wealth', actor.id, 'resources', (actor.wealth - prior.wealth) / Math.max(10, prior.wealth || 10), (actor.name || '主角') + '的财物发生变化。');
  }
  return result;
}

export function causalSnapshot(world) {
  const map = domain => Object.fromEntries(Object.entries(world[domain]).map(([id, entity]) => [id, { ...entity }]));
  return { player: { ...world.player }, characters: map('characters'), factions: map('factions'), locations: map('locations') };
}
