import { EVENT_TEMPLATES } from './astra-content.js';
import { seedHash } from './astra-seed.js';
import { runNpcPlans } from './astra-npc.js';
import { runFactionTick } from './astra-faction.js';
import { resolveDueAnchors } from './astra-anchors.js';
import { createQuestArc, reconcileQuestArcs } from './astra-quests.js';

const DAY = 1440;
const queueCache = new WeakMap();
const historyCache = new WeakMap();
const compare = (a, b) => a.dueAt - b.dueAt || a.priority - b.priority || a.id.localeCompare(b.id);
const idsFor = (cache, world, key) => {
  let set = cache.get(world);
  if (!set) {
    set = new Set((world[key] || []).map(entry => entry.id));
    if (key === 'history') for (const id of world.resolvedEventIds || []) set.add(id);
    cache.set(world, set);
  }
  return set;
};

function archiveRoutineHistory(world) {
  while (world.history.length > 4000) {
    const old = world.history.findIndex(entry => !entry.major && ['world_event','npc_action','faction_tick','region_tick','macro_tick'].includes(entry.type));
    if (old < 0) break;
    const [archived] = world.history.splice(old, 1);
    world.resolvedEventIds ||= [];
    world.resolvedEventIds.push(archived.id);
    world.historyArchive ||= { counts: {}, lastMinute: 0 };
    world.historyArchive.counts[archived.type] = (world.historyArchive.counts[archived.type] || 0) + 1;
    world.historyArchive.lastMinute = archived.minute;
  }
}

export function scheduleEvent(world, event) {
  if (!event?.id || !Number.isFinite(Number(event.dueAt)) || !event.type) throw new Error('世界事件缺少编号、时间或类型。');
  world.eventQueue ||= [];
  const queued = idsFor(queueCache, world, 'eventQueue');
  const resolved = idsFor(historyCache, world, 'history');
  if (queued.has(event.id) || resolved.has(event.id)) return false;
  const entry = { id: String(event.id), dueAt: Math.max(0, Math.floor(Number(event.dueAt))),
    priority: Number.isFinite(Number(event.priority)) ? Number(event.priority) : 50,
    type: String(event.type), payload: event.payload && typeof event.payload === 'object' ? structuredClone(event.payload) : {} };
  let low = 0, high = world.eventQueue.length;
  while (low < high) { const middle = (low + high) >> 1; if (compare(world.eventQueue[middle], entry) <= 0) low = middle + 1; else high = middle; }
  world.eventQueue.splice(low, 0, entry);
  queued.add(entry.id);
  return true;
}

function applyAction(world, action) {
  if (!action || action.type === 'speech' || action.type === 'wait') return;
  if (action.type === 'travel') {
    if (world.player.travel) throw new Error('当前旅程尚未抵达，不能再次出发。');
    const edge = world.edges.find(candidate => candidate.from === world.player.locationId && candidate.to === action.destinationId && !candidate.closed);
    if (!edge || world.locations[action.destinationId]?.destroyed || world.locations[action.destinationId]?.closed) throw new Error('此路当前无法通行。');
    world.player.travel = { from: edge.from, to: edge.to, departAt: world.minute, arriveAt: world.minute + edge.minutes };
    scheduleEvent(world, { id: `arrival:player:${world.minute}:${edge.to}`, dueAt: world.player.travel.arriveAt,
      priority: 5, type: 'player_arrival', payload: { destinationId: edge.to } });
  }
}

function resolve(world, event) {
  const payload = event.payload || {};
  const locationId = payload.locationId || world.player.locationId;
  let summary = '';
  switch (event.type) {
    case 'lin_first_encounter': {
      const lin = world.characters?.[payload.characterId || 'npc:lin-xiaoman'];
      if (lin?.alive) {
        lin.locationId = world.player.locationId;
        lin.travel = null;
        lin.metPlayer = true;
        world.flags.encounterLinResolved = true;
        summary = `林小满在${world.locations[world.player.locationId]?.name || '途中'}与玩家相遇；她仍有自己的生计与目标。`;
      } else summary = '林小满在相遇前身亡；世界记录这一不可逆变故。';
      break;
    }
    case 'player_arrival': {
      if (world.player.travel?.to === payload.destinationId) {
        world.player.locationId = payload.destinationId;
        world.player.travel = null;
        world.locations[payload.destinationId].discovered = true;
        world.flags.visitedLocations = [...new Set([...(world.flags.visitedLocations || []), payload.destinationId])];
        summary = `玩家抵达${world.locations[payload.destinationId]?.name || payload.destinationId}。`;
      }
      break;
    }
    case 'npc_arrival': {
      const npc = world.characters?.[payload.actorId];
      if (npc?.alive && npc.travel?.to === payload.destinationId) {
        npc.locationId = payload.destinationId;
        npc.travel = null;
        summary = `${npc.name}抵达${world.locations[payload.destinationId]?.name || payload.destinationId}。`;
      }
      break;
    }
    case 'npc_action': {
      const plans = runNpcPlans(world, event.dueAt);
      for (const plan of plans) if (plan.type === 'depart') scheduleEvent(world, {
        id: `arrival:${plan.actorId}:${plan.arriveAt}`, dueAt: plan.arriveAt, priority: 20,
        type: 'npc_arrival', payload: { actorId: plan.actorId, destinationId: plan.destinationId }
      });
      scheduleEvent(world, { id: `npc-action:${event.dueAt + DAY}`, dueAt: event.dueAt + DAY, priority: 65, type: 'npc_action' });
      summary = `在场外，${plans.length}位人物按自己的目标行动。`;
      break;
    }
    case 'faction_tick': {
      const result = runFactionTick(world, payload.factionId, event.dueAt);
      if (result) {
        summary = `${world.factions[payload.factionId].name}的势力变化为${result.swing >= 0 ? '+' : ''}${result.swing}。${result.changes.join('；')}`;
        event.major = result.changes.length > 0;
      }
      if (result?.active) scheduleEvent(world, { id: `faction:${payload.factionId}:${event.dueAt + 7 * DAY}`, dueAt: event.dueAt + 7 * DAY,
        priority: 70, type: 'faction_tick', payload });
      break;
    }
    case 'region_tick': {
      for (const loc of Object.values(world.locations)) if (!loc.destroyed && loc.layer === 'mortal') {
        const delta = seedHash(world.seed, `economy:${loc.id}:${event.dueAt}`) % 5 - 2;
        loc.economy.prosperity = Math.max(0, Math.min(100, Number(loc.economy.prosperity || 0) + delta));
      }
      for (const rumor of world.rumors.slice(-100)) {
        rumor.regionSpread ||= [rumor.locationId];
        if (Number(rumor.spreadCount || 0) >= 3) continue;
        const sourceId = rumor.regionSpread.at(-1);
        const edges = world.edges.filter(edge => edge.from === sourceId && !edge.closed && !world.locations[edge.to]?.destroyed);
        const edge = edges[seedHash(world.seed, `rumor:${rumor.id}:${event.dueAt}`) % edges.length];
        if (!edge) continue;
        rumor.regionSpread = [...new Set([...rumor.regionSpread, edge.to])];
        rumor.spreadCount = Number(rumor.spreadCount || 0) + 1;
        rumor.truthConfidence = Math.max(0.1, Number(rumor.truthConfidence || 0.5) - 0.08);
        rumor.sourceCredibility = Math.max(0.1, Number(rumor.sourceCredibility || 0.5) - 0.04);
        rumor.knownBy = [...new Set([...(rumor.knownBy || []), ...Object.values(world.characters)
          .filter(npc => npc.alive && npc.locationId === edge.to).map(npc => npc.id)])];
        rumor.distortion = rumor.spreadCount > 1 ? '转述中出现偏差' : '';
      }
      scheduleEvent(world, { id: `region:${event.dueAt + 7 * DAY}`, dueAt: event.dueAt + 7 * DAY, priority: 75, type: 'region_tick' });
      summary = '周边经济与物资在一周中发生变化。';
      break;
    }
    case 'macro_tick': {
      world.flags.worldAge += 1;
      scheduleEvent(world, { id: `macro:${event.dueAt + 360 * DAY}`, dueAt: event.dueAt + 360 * DAY, priority: 90, type: 'macro_tick' });
      summary = '一轮岁月更替，天下格局继续演变。';
      break;
    }
    case 'anchor_window': {
      const anchor = world.anchors?.[payload.anchorId];
      if (anchor?.state === 'pending') {
        resolveDueAnchors(world);
        if (anchor.selectedEventId?.startsWith('event:')) scheduleEvent(world, {
          id: `anchor-event:${anchor.id}`, dueAt: Math.min(anchor.windowEnd, event.dueAt + DAY),
          priority: 35, type: 'world_event', payload: { templateId: anchor.selectedEventId,
            locationId: anchor.locationId, anchorId: anchor.id }
        });
        scheduleEvent(world, { id: `anchor-close:${anchor.id}`, dueAt: anchor.windowEnd, priority: 41,
          type: 'anchor_close', payload: { anchorId: anchor.id } });
        summary = `${anchor.family}因果窗口开启。`;
      }
      break;
    }
    case 'anchor_close': {
      const anchor = world.anchors?.[payload.anchorId];
      if (anchor?.state === 'open') {
        anchor.state = 'resolved-offscreen'; anchor.resolvedAt = event.dueAt;
        summary = `${anchor.family}因果在场外落定。`;
        world.history.push({ id: `anchor:resolved:${anchor.id}`, minute: event.dueAt, type: 'anchor_resolved',
          locationId: anchor.locationId, summary, major: true, playerWitnessed: false });
      }
      break;
    }
    case 'world_event': {
      const template = EVENT_TEMPLATES.find(item => item.id === payload.templateId);
      const place = world.locations[locationId];
      if (place && !place.destroyed) {
        const dangerous = template?.pressure === 'danger';
        const delta = dangerous ? -5 : seedHash(world.seed, `event:${event.id}`) % 5 - 2;
        place.economy.prosperity = Math.max(0, Math.min(100, Number(place.economy.prosperity || 0) + delta));
        if (/(?:plague|siege|fire|bandits|storm)/u.test(template?.family || '') && dangerous)
          place.population = Math.max(0, place.population - Math.max(1, Math.floor(place.population / 50)));
        const faction = world.factions[place.controllerFactionId];
        if (faction && /(?:siege|rebellion|betrayal|treasury|treaty)/u.test(template?.family || '')) {
          faction.power = Math.max(0, faction.power + (template.family === 'treaty' ? 2 : -3));
          faction.stability = Math.max(0, faction.stability + (template.family === 'treaty' ? 3 : -4));
          if (!faction.power || !faction.stability) faction.active = false;
          reconcileQuestArcs(world, { type: 'faction_change', factionId: faction.id });
        }
        if (dangerous) {
          const candidates = Object.values(world.characters).filter(npc => npc.alive && npc.locationId === locationId
            && (npc.id !== 'npc:lin-xiaoman' || world.flags.encounterLinResolved));
          const doomed = candidates.find(npc => seedHash(world.seed, `danger:${event.id}:${npc.id}`) % 11 === 0);
          if (doomed) {
            doomed.alive = false; doomed.physicalCondition = 'dead'; doomed.deathAt = event.dueAt;
            doomed.lastKnownLocationId = doomed.locationId; doomed.locationId = null;
            doomed.travel = null; doomed.currentPlan = null;
            reconcileQuestArcs(world, { type: 'death', actorId: doomed.id });
          }
        }
        summary = template ? `${place.name}发生${template.id}，${template.effects?.[0] || '当地生活随之改变'}。` : `${place.name}发生一件场外事务，地方生计产生变化。`;
        if (template) world.rumors.push({ id: `rumor:${event.id}`, originEventId: event.id,
          locationId, summary, truthConfidence: 0.8, sourceCredibility: 0.6,
          regionSpread: [locationId], spreadCount: 0, distortion: '',
          knownBy: Object.values(world.characters).filter(npc => npc.alive && npc.locationId === locationId).slice(0, 4).map(npc => npc.id) });
        if (payload.opening && template) {
          const questFamily = ({ harvest: 'protect-farm', caravan: 'escort-caravan', inspection: 'carry-warning',
            wedding: 'mediate-wedding', theft: 'recover-heirloom', illness: 'deliver-medicine',
            bandits: 'trace-bandits', fire: 'investigate-fire' })[template.family];
          if (questFamily) createQuestArc(world, `quest:${questFamily}:urgent`, {
            id: `quest:opening:${questFamily}`, locationId, eventId: event.id
          });
        }
      }
      break;
    }
    default: summary = `世界事件${event.type}已结算。`;
  }
  const record = { id: event.id, type: event.type, minute: event.dueAt, locationId,
    summary: summary.slice(0, 100), playerWitnessed: event.type === 'lin_first_encounter'
      || (locationId === world.player.locationId && !['npc_action','faction_tick','region_tick','macro_tick'].includes(event.type)),
    major: ['lin_first_encounter','player_arrival','npc_arrival','anchor_window','anchor_close'].includes(event.type)
      || event.major === true || event.type === 'world_event' && Boolean(payload.anchorId || payload.templateId && EVENT_TEMPLATES.find(item => item.id === payload.templateId)?.pressure === 'danger') };
  world.history.push(record);
  idsFor(historyCache, world, 'history').add(record.id);
  archiveRoutineHistory(world);
  return record;
}

export function advanceAstraWorld(source, elapsedMinutes, action = null) {
  const elapsed = Number(elapsedMinutes);
  if (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 10_000_000) throw new Error('世界时间跨度无效。');
  const world = structuredClone(source);
  world.history ||= [];
  world.eventQueue ||= [];
  world.eventQueue.sort(compare);
  const target = world.minute + elapsed;
  if (world.terminal?.ended) return { world, events: [] };
  applyAction(world, action);
  scheduleEvent(world, { id: `npc-action:${Math.ceil(world.minute / DAY) * DAY}`, dueAt: Math.ceil(world.minute / DAY) * DAY,
    priority: 65, type: 'npc_action' });
  scheduleEvent(world, { id: `region:${Math.ceil(world.minute / (7 * DAY)) * 7 * DAY}`, dueAt: Math.ceil(world.minute / (7 * DAY)) * 7 * DAY,
    priority: 75, type: 'region_tick' });
  scheduleEvent(world, { id: `macro:${Math.ceil(world.minute / (360 * DAY)) * 360 * DAY}`, dueAt: Math.ceil(world.minute / (360 * DAY)) * 360 * DAY,
    priority: 90, type: 'macro_tick' });
  const events = [];
  while (world.eventQueue.length && world.eventQueue[0].dueAt <= target) {
    const event = world.eventQueue.shift();
    idsFor(queueCache, world, 'eventQueue').delete(event.id);
    if (idsFor(historyCache, world, 'history').has(event.id)) continue;
    world.minute = Math.max(world.minute, event.dueAt);
    events.push(resolve(world, event));
    if (events.length > 100_000) throw new Error('世界事件链超出安全上限。');
  }
  world.minute = target;
  if (action?.type === 'speech') {
    for (const [index, outcome] of runNpcPlans(world, target).entries()) {
      if (outcome.type === 'depart') scheduleEvent(world, {
        id: `arrival:${outcome.actorId}:${outcome.arriveAt}`, dueAt: outcome.arriveAt, priority: 20,
        type: 'npc_arrival', payload: { actorId: outcome.actorId, destinationId: outcome.destinationId }
      });
      const npc = world.characters[outcome.actorId];
      world.history.push({ id: `npc-plan:${target}:${index}:${outcome.actorId}`, type: 'npc_action', minute: target,
        locationId: npc?.locationId, summary: (outcome.text || `${npc?.name || '人物'}按自己的目标行动。`).slice(0, 100),
        playerWitnessed: npc?.locationId === world.player.locationId });
      archiveRoutineHistory(world);
    }
  }
  resolveDueAnchors(world);
  return { world, events };
}
