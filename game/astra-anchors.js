import { seedHash } from './astra-seed.js';
import { createQuestArc, reconcileQuestArcs } from './astra-quests.js';
import { QUEST_TEMPLATES } from './astra-content.js';

function variant(world, anchor) {
  const relevantFaction = anchor.family === 'sect-crisis' ? world.factions?.['faction:qingxuan'] :
    world.factions?.[world.locations?.[anchor.locationId]?.controllerFactionId];
  if (relevantFaction && !relevantFaction.active) return 'variant:faction-fallen';
  if (world.locations?.[anchor.locationId]?.destroyed) return 'variant:place-destroyed';
  const events = anchor.eventIds || [];
  return events[seedHash(world.seed, `${anchor.id}:${anchor.windowStart}:${relevantFaction?.power ?? 0}`) % events.length] || 'variant:local-change';
}

export function resolveDueAnchors(world) {
  const changes = [];
  for (const anchor of Object.values(world.anchors || {})) {
    if (anchor.state === 'pending' && world.minute >= anchor.windowStart) {
      anchor.state = 'open';
      anchor.selectedEventId = variant(world, anchor);
      world.history.push({ id: `anchor:open:${anchor.id}`, minute: anchor.windowStart, type: 'anchor_open',
        locationId: anchor.locationId, summary: `${anchor.family}因果开启：${anchor.selectedEventId}`,
        playerWitnessed: world.player.locationId === anchor.locationId });
      // An active anchor creates a quest opportunity; ignoring it is a real option.
      const template = QUEST_TEMPLATES.find(entry => entry.originFamily === (anchor.family === 'sect-crisis' ? 'protect-disciple' : 'carry-warning'));
      if (template && world.locations[anchor.locationId] && !world.locations[anchor.locationId].destroyed) {
        createQuestArc(world, template.id, { id: `quest-anchor:${anchor.id}`, locationId: anchor.locationId, eventId: `anchor:open:${anchor.id}` });
      }
      changes.push({ anchorId: anchor.id, state: anchor.state, variant: anchor.selectedEventId });
    }
    if (anchor.state === 'open' && world.minute > anchor.windowEnd) {
      anchor.state = 'resolved-offscreen';
      anchor.resolvedAt = world.minute;
      world.history.push({ id: `anchor:resolved:${anchor.id}`, minute: world.minute, type: 'anchor_resolved',
        locationId: anchor.locationId, summary: `${anchor.family}因果不等玩家，在场外落定。`,
        playerWitnessed: false });
      changes.push({ anchorId: anchor.id, state: anchor.state });
    }
  }
  reconcileQuestArcs(world, { type: 'time' });
  return changes;
}
