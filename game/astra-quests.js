import { QUEST_TEMPLATES } from './astra-content.js';

export const QUEST_STATES = Object.freeze([
  'available','active','mutated','completed','failed','expired','abandoned','resolved-by-other','invalidated'
]);
const terminal = new Set(['completed','failed','expired','abandoned','resolved-by-other','invalidated']);

function record(world, quest, from, to, cause) {
  world.history ||= [];
  world.history.push({ id: `quest:${quest.id}:${world.minute}:${to}`, minute: world.minute,
    type: 'quest_state', locationId: quest.targetLocationId, actors: quest.participants,
    summary: `${quest.title}: ${from} → ${to}`, worldImpact: String(cause || ''), playerWitnessed: to === 'completed' });
}

function transition(world, quest, next, cause) {
  if (quest.state === next || terminal.has(quest.state) || !QUEST_STATES.includes(next)) return false;
  const old = quest.state;
  quest.state = next;
  quest.updatedAt = world.minute;
  quest.stateHistory.push({ minute: world.minute, from: old, to: next, cause: String(cause || '') });
  if (terminal.has(next) && next !== 'completed') quest.lostRewards = [...quest.rewards];
  if (next === 'completed') {
    quest.earnedRewards = [...quest.rewards];
    world.player.wealth = Number(world.player.wealth || 0) + 8;
    world.player.reputation = Number(world.player.reputation || 0) + 1;
    const giver = world.characters?.[quest.giverId];
    if (giver?.alive) giver.relationships[world.player.id] = Math.min(100, Number(giver.relationships[world.player.id] || 0) + 5);
    const template = QUEST_TEMPLATES.find(entry => entry.id === quest.templateId);
    const nextTemplate = template && QUEST_TEMPLATES.find(entry => entry.originFamily === template.originFamily
      && entry.id !== template.id && entry.id.endsWith(':standard'));
    if (nextTemplate && !quest.id.startsWith('followup:')) {
      const followUp = createQuestArc(world, nextTemplate.id, {
        id: `followup:${quest.id}`, locationId: quest.targetLocationId, giverId: quest.giverId,
        eventId: `quest:${quest.id}:completed`
      });
      quest.followUpArcs.push(followUp.id);
    }
  }
  record(world, quest, old, next, cause);
  return true;
}

export function createQuestArc(world, templateId, origin = {}) {
  const template = QUEST_TEMPLATES.find(entry => entry.id === templateId);
  if (!template) throw new Error(`未知任务模板：${templateId}`);
  world.quests ||= {};
  const id = origin.id || `quest-instance:${templateId}:${world.minute}:${Object.keys(world.quests).length}`;
  if (world.quests[id]) return world.quests[id];
  const targetLocationId = origin.targetLocationId || origin.locationId || world.player.locationId;
  const quest = {
    id, templateId, title: template.title, state: 'available', originEventId: origin.eventId || null,
    participants: [origin.giverId, origin.targetId].filter(Boolean), giverId: origin.giverId || null,
    targetId: origin.targetId || null, targetLocationId,
    primaryGoals: [...template.objectives], optionalGoals: [], hiddenGoals: [],
    deadline: world.minute + template.deadlineDays * 1440,
    successConditions: [template.successEffect], failureConditions: [template.failureEffect],
    mutationRules: ['giver_death','target_death','location_destroyed','faction_change','resolved_by_other','deadline'],
    possibleEndings: [...QUEST_STATES.slice(2)], worldConsequences: [],
    followUpArcs: [], rewards: [template.reward], lostRewards: [], earnedRewards: [],
    createdAt: world.minute, updatedAt: world.minute, stateHistory: []
  };
  world.quests[id] = quest;
  record(world, quest, 'none', 'available', origin.eventId || 'world opportunity');
  return quest;
}

export function reconcileQuestArcs(world, cause = { type: 'time' }) {
  const changes = [];
  for (const quest of Object.values(world.quests || {})) {
    if (terminal.has(quest.state)) continue;
    let next = null;
    const giver = world.characters?.[quest.giverId];
    const target = world.characters?.[quest.targetId];
    const location = world.locations?.[quest.targetLocationId];
    if (location?.destroyed || !location) next = 'invalidated';
    else if (cause.type === 'resolved_by_other' && cause.questId === quest.id) next = 'resolved-by-other';
    else if (cause.type === 'complete' && cause.questId === quest.id) next = 'completed';
    else if (cause.type === 'fail' && cause.questId === quest.id) next = 'failed';
    else if (cause.type === 'abandon' && cause.questId === quest.id) next = 'abandoned';
    else if (world.minute > quest.deadline) next = 'expired';
    else if (giver && !giver.alive || target && !target.alive) next = 'mutated';
    else if (cause.type === 'faction_change' && (quest.participants.includes(cause.factionId)
      || quest.participants.some(id => cause.affectedActorIds?.includes(id)))) next = 'mutated';
    if (next && transition(world, quest, next, cause.type)) {
      if (next === 'mutated') {
        quest.primaryGoals = quest.primaryGoals.map(goal => `${goal}（原委托或目标已有变故，需重新判断）`);
        quest.worldConsequences.push('原计划不可原样继续');
      }
      changes.push({ questId: quest.id, state: next });
    }
  }
  return changes;
}

export function acceptQuestArc(world, questId) {
  const quest = world.quests?.[questId];
  if (!quest || quest.state !== 'available') throw new Error('任务已不可接取。');
  transition(world, quest, 'active', 'player accepted');
  return quest;
}
