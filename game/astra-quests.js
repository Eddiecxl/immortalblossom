import { QUEST_TEMPLATES } from './astra-content.js';
import { reconcileCommitments, commitmentLost } from './astra-commitments.js';
import { isSpeculativeInput, companionNotification } from './astra-causality.js';
import { conditionCanStillBecomeTrue } from './astra-expression.js';

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
  quest.stateHistory ||= [];
  quest.stateHistory.push({ minute: world.minute, from: old, to: next, cause: String(cause || '') });
  if (terminal.has(next) && next !== 'completed') quest.lostRewards = [...(quest.rewards || [])];
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
  reconcileCommitments(world);
  const changes = [];
  const quests = Object.values(world.quests || {});
  for (let pass=0;pass<Math.min(129,quests.length+1);pass++) {
  const beforeCount=changes.length;
  for (const quest of Object.values(world.quests || {})) {
    if (terminal.has(quest.state)) continue;
    let next = null;
    const giver = world.characters?.[quest.giverId];
    const target = world.characters?.[quest.targetId];
    const location = world.locations?.[quest.targetLocationId];
    const broken = (quest.requiredCommitmentIds || []).find(id => commitmentLost(world.simulation?.commitments?.[id]?.state)
      || !world.simulation?.commitments?.[id]);
    let detail = cause.type;
    if (broken) { next = ['active', 'mutated'].includes(quest.state) ? 'failed' : 'invalidated'; detail = 'required commitment lost: ' + broken; }
    else if (quest.condition && !conditionCanStillBecomeTrue(world,quest.condition)) {
      next = ['active','mutated'].includes(quest.state) ? 'failed' : 'invalidated'; detail = 'terminal prerequisite cannot be satisfied';
    }
    else if (location?.destroyed || !location) next = 'invalidated';
    else if (cause.type === 'resolved_by_other' && cause.questId === quest.id) next = 'resolved-by-other';
    else if (cause.type === 'complete' && cause.questId === quest.id) next = 'completed';
    else if (cause.type === 'fail' && cause.questId === quest.id) next = 'failed';
    else if (cause.type === 'abandon' && cause.questId === quest.id) next = 'abandoned';
    else if (world.minute > quest.deadline) next = 'expired';
    else if (giver && !giver.alive || target && !target.alive) next = 'mutated';
    else if (cause.type === 'faction_change' && (quest.participants.includes(cause.factionId)
      || quest.participants.some(id => cause.affectedActorIds?.includes(id)))) next = 'mutated';
    if (next && transition(world, quest, next, detail)) {
      if (next === 'mutated') {
        quest.primaryGoals = quest.primaryGoals.map(goal => `${goal}（原委托或目标已有变故，需重新判断）`);
        quest.worldConsequences.push('原计划不可原样继续');
      }
      changes.push({ questId: quest.id, state: next });
      if (['failed','invalidated'].includes(next)) companionNotification(world,quest.id+':'+next,
        '宿主，“'+quest.title+'”的前置条件或来源已无法继续，命簿已更新关联任务。',quest.id);
    }
  }
  if (changes.length===beforeCount) {if(world.simulation)world.simulation.dependencyPending=false;break;}
  if(pass===128&&world.simulation)world.simulation.dependencyPending=true;
  }
  return changes;
}

export function acceptQuestArc(world, questId) {
  const quest = world.quests?.[questId];
  if (!quest || quest.state !== 'available') throw new Error('任务已不可接取。');
  transition(world, quest, 'active', 'player accepted');
  return quest;
}

export function respondQuestArc(world, op, context) {
  const quest = world.quests?.[op.questId];
  const input = (String(context.input?.speech || '') + ' ' + String(context.input?.action || '')).trim();
  if (!quest || terminal.has(quest.state) || !['player',quest.giverId].includes(op.actorId)) throw new Error('任务决定的主体或当前状态无效。');
  if (typeof op.evidence !== 'string' || !op.evidence.trim() || !input.includes(op.evidence) || isSpeculativeInput(input))
    throw new Error('任务决定缺少本轮真实原话证据。');
  const giver = world.characters[quest.giverId];
  const present = !world.player.travel && giver?.alive && !giver.travel && giver.locationId === world.player.locationId;
  let next;
  if (op.response === 'accept') {
    if (op.actorId !== 'player' || quest.state !== 'available' || !present || quest.originEventId === context.turnId
      || context.conversationTargetId && context.conversationTargetId !== giver.id
      || /不接|不接受|不要|拒绝/u.test(input)) throw new Error('不能替玩家接受未说明或被拒绝的委托。');
    next = 'active';
  } else if (op.response === 'decline' && op.actorId === 'player') {
    next = quest.state === 'available' ? 'invalidated' : 'abandoned';
  } else if (op.response === 'withdraw' && op.actorId === quest.giverId && present) {
    next = ['active','mutated'].includes(quest.state) ? 'failed' : 'invalidated';
  } else throw new Error('任务决定类型或人物不在场。');
  transition(world,quest,next,context.turnId + ': ' + op.evidence);
  const labels={active:'已接取',invalidated:'已取消',abandoned:'已放弃',failed:'已失败'};
  companionNotification(world,context.turnId+':quest:'+quest.id,'宿主，“'+quest.title+'”'+labels[next]+'，命簿已记录这次决定。',context.turnId);
}
