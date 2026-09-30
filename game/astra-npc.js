import { seedHash } from './astra-seed.js';
import { clampNumeric } from './astra-variables.js';

const DAY = 1440;

// Only consequential, persistent characters get scheduled decisions. No frame loop.
export function runNpcPlans(world, minute = world.minute) {
  const outcomes = [];
  for (const npc of Object.values(world.characters || {})) {
    if (!npc.alive || npc.travel) continue;
    const cadence = npc.simulationImportance === 'background' ? 7 * DAY
      : npc.simulationImportance === 'regional' ? 6 * 60 : 20;
    const bucket = Math.floor(minute / cadence);
    if (npc.lastPlanBucket === bucket) continue;
    npc.lastPlanBucket = bucket;
    const year = Math.floor(minute / (360 * DAY));
    if (npc.lastAgeYear === undefined) npc.lastAgeYear = year;
    if (year > npc.lastAgeYear) { npc.age = Number(npc.age || 20) + year - npc.lastAgeYear; npc.lastAgeYear = year; }
    const choice = seedHash(world.seed, `npc:${npc.id}:${bucket}`) % 16;
    if (choice === 0) {
      npc.wealth = clampNumeric(world, 'character', 'wealth', Number(npc.wealth || 0) + 1, npc);
      outcomes.push({ actorId: npc.id, type: 'work', text: `${npc.name}完成了自己的生计安排。` });
    } else if (choice === 1) {
      const possible = world.edges.filter(edge => edge.from === npc.locationId && !edge.closed && !world.locations[edge.to]?.destroyed);
      const edge = possible[seedHash(world.seed, `travel:${npc.id}:${bucket}`) % possible.length];
      if (edge) {
        npc.travel = { from: npc.locationId, to: edge.to, departAt: minute, arriveAt: minute + edge.minutes };
        npc.locationId = null;
        outcomes.push({ actorId: npc.id, type: 'depart', destinationId: edge.to, arriveAt: minute + edge.minutes });
      }
    } else if (choice === 2 && npc.goals?.length) {
      npc.currentGoals = [npc.goals[seedHash(world.seed, `goal:${npc.id}:${bucket}`) % npc.goals.length]];
      outcomes.push({ actorId: npc.id, type: 'goal', text: `${npc.name}改变了当下打算。` });
    } else if (choice === 3 && npc.cultivation?.realm !== 'none') {
      npc.cultivation.level = Math.min(99, Number(npc.cultivation.level || 0) + 1);
      outcomes.push({ actorId: npc.id, type: 'train', text: `${npc.name}继续修炼，修为有所精进。` });
    } else if (choice === 4 && npc.age >= 18 && npc.age < 65 && !npc.family?.spouseId) {
      const partner = Object.values(world.characters).find(other => other.id !== npc.id && other.alive
        && other.locationId === npc.locationId && other.age >= 18 && !other.family?.spouseId);
      if (partner) {
        npc.family ||= {}; partner.family ||= {};
        npc.family.spouseId = partner.id; partner.family.spouseId = npc.id;
        outcomes.push({ actorId: npc.id, type: 'marriage', text: `${npc.name}与${partner.name}成婚，两家关系因此改变。` });
      }
    } else if (choice === 5 && npc.physicalCondition === 'healthy') {
      npc.physicalCondition = 'ill';
      outcomes.push({ actorId: npc.id, type: 'illness', text: `${npc.name}染病，需要休养或医治。` });
    } else if (choice === 6 && npc.physicalCondition === 'ill') {
      npc.physicalCondition = 'recovering';
      outcomes.push({ actorId: npc.id, type: 'healing', text: `${npc.name}的病势开始好转。` });
    } else if (choice === 7 && Number(npc.wealth || 0) > 0) {
      npc.wealth = clampNumeric(world, 'character', 'wealth', npc.wealth - 3, npc);
      outcomes.push({ actorId: npc.id, type: 'loss', text: `${npc.name}在交易或劫掠中损失了财物。` });
    } else if (choice === 8 && !npc.factionId) {
      const faction = Object.values(world.factions || {}).find(entry => entry.active && entry.homeId === npc.locationId);
      if (faction) {
        npc.factionId = faction.id;
        faction.memberIds = [...new Set([...(faction.memberIds || []), npc.id])];
        outcomes.push({ actorId: npc.id, type: 'join_faction', text: `${npc.name}加入${faction.name}。` });
      }
    } else if (choice === 9 && npc.factionId && npc.id !== world.factions[npc.factionId]?.leaderId) {
      const faction = world.factions[npc.factionId];
      if (faction) faction.memberIds = faction.memberIds.filter(id => id !== npc.id);
      npc.factionId = null;
      outcomes.push({ actorId: npc.id, type: 'leave_faction', text: `${npc.name}离开了原先所属的势力。` });
    } else if (choice === 10 && npc.age >= 65 && !npc.retired) {
      npc.retired = true;
      npc.currentPlan = { type: 'retire' };
      outcomes.push({ actorId: npc.id, type: 'retirement', text: `${npc.name}卸下旧职，开始安排身后之事。` });
    } else if (choice === 11 && npc.family?.spouseId && (npc.family.children?.length || 0) < 3) {
      npc.family.children ||= [];
      const childId = `npc:child:${npc.id}:${bucket}`;
      npc.family.children.push(childId);
      const spouse = world.characters[npc.family.spouseId];
      if (spouse) { spouse.family ||= {}; spouse.family.children ||= []; spouse.family.children.push(childId); }
      world.characters[childId] = { id: childId, name: `${npc.name}之子`, alive: true, age: 0,
        locationId: npc.locationId, homeId: npc.homeId, factionId: null, occupation: 'child',
        cultivation: { realm: 'none', level: 0 }, physicalCondition: 'healthy',
        goals: ['grow up'], currentGoals: ['grow up'], family: { parentIds: [npc.id, spouse?.id].filter(Boolean) },
        inventory: [], memories: [], relationships: {}, wealth: 0, travel: null,
        currentPlan: { type: 'childhood' }, simulationImportance: 'background' };
      outcomes.push({ actorId: npc.id, type: 'birth', text: `${npc.name}家中添了新生儿。` });
    } else if (choice === 12 && npc.physicalCondition === 'recovering') {
      npc.physicalCondition = 'healthy';
      outcomes.push({ actorId: npc.id, type: 'recovered', text: `${npc.name}恢复了健康。` });
    }
  }
  return outcomes;
}
