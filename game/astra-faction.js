import { seedHash } from './astra-seed.js';
import { clampNumeric } from './astra-variables.js';

export function runFactionTick(world, factionId, minute = world.minute) {
  const faction = world.factions?.[factionId];
  if (!faction?.active) return null;
  const changes = [];
  if (!world.characters?.[faction.leaderId]?.alive) {
    const successor = faction.memberIds.find(id => world.characters[id]?.alive);
    faction.leaderId = successor || null;
    faction.succession = successor ? 'new leader' : 'vacant';
    faction.stability = clampNumeric(world, 'faction', 'stability', Number(faction.stability || 0) - (successor ? 5 : 15), faction);
    changes.push(successor ? `新掌事${world.characters[successor].name}接任` : '领导位置空缺');
  }
  const swing = (seedHash(world.seed, `faction:${factionId}:${minute}`) % 7) - 3;
  faction.power = clampNumeric(world, 'faction', 'power', Number(faction.power || 0) + swing, faction);
  faction.wealth = clampNumeric(world, 'faction', 'wealth', Number(faction.wealth || 0) + Math.max(-2, swing)
    + Math.floor((faction.territories?.length || 0) / 4), faction);
  faction.stability = clampNumeric(world, 'faction', 'stability', Number(faction.stability || 0) - Math.sign(swing), faction);
  const opponentId = (faction.enemies || []).find(id => world.factions[id]?.active);
  const opponent = world.factions[opponentId];
  if (opponent && seedHash(world.seed, `war:${factionId}:${minute}`) % 4 === 0) {
    faction.wars = [...new Set([...(faction.wars || []), opponentId])];
    opponent.wars = [...new Set([...(opponent.wars || []), factionId])];
    if (faction.power > opponent.power + 10) {
      const target = (opponent.territories || []).find(id => world.locations[id] && !world.locations[id].destroyed);
      if (target) {
        world.locations[target].controllerFactionId = faction.id;
        world.locations[target].economy.prosperity = Math.max(0, world.locations[target].economy.prosperity - 5);
        opponent.territories = opponent.territories.filter(id => id !== target);
        faction.territories = [...new Set([...(faction.territories || []), target])];
        changes.push(`${faction.name}夺取${world.locations[target].name}`);
      }
    }
  }
  if (faction.power === 0 || faction.stability === 0) faction.active = false;
  if (!faction.active) {
    for (const id of faction.territories || []) if (world.locations[id]?.controllerFactionId === faction.id)
      world.locations[id].controllerFactionId = null;
    faction.territories = [];
    faction.wars = [];
    changes.push(`${faction.name}衰亡`);
  }
  return { factionId, swing, active: faction.active, changes };
}
