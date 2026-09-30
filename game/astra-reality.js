import { seedHash } from './astra-seed.js';
import { reconcileQuestArcs } from './astra-quests.js';
import { checkTerminalWorld } from './astra-terminal.js';
import { ITEM_TEMPLATES } from './astra-content.js';
import { parseGeneratedItem } from './astra-effects.js';
import { setRealmToCap, rewriteRealmCap, realmLabel } from './astra-rules.js';
import { applyNumericMutation, parseNumericWish } from './astra-variables.js';

const text = value => String(value ?? '').trim();
const aliveNpcByName = (world, request) => Object.values(world.characters || {})
  .filter(npc => request.includes(npc.name)).sort((a, b) => b.name.length - a.name.length)[0];
const factionByName = (world, request) => Object.values(world.factions || {})
  .filter(faction => request.includes(faction.name)).sort((a, b) => b.name.length - a.name.length)[0];
const locationByName = (world, request) => Object.values(world.locations || {})
  .filter(location => request.includes(location.name)).sort((a, b) => b.name.length - a.name.length)[0];

export function planRealityMutation(world, statement) {
  const request = text(statement).replace(/^言出法随\s*[:：]?\s*/u, '');
  if (!request) throw new Error('言灵没有写下要实现的结果。');
  let type, targetId = null, scale = 1, generatedItem = null, realmName = null, scope = 'personal', numericMutation = null;
  const npc = aliveNpcByName(world, request);
  const faction = factionByName(world, request);
  const location = locationByName(world, request);
  if (/(?:全宇宙|宇宙|世界|天下).*(?:所有|一切).*(?:生命|生灵).*(?:消失|死亡|毁灭|灭绝)|(?:杀死|抹去|消灭).*(?:全宇宙|天下|世界).*(?:生命|生灵)/u.test(request)) {
    type = 'all_life_extinction'; scale = 100;
  } else if (/(?:毁灭|摧毁|抹去).*(?:星球|世界|天地)/u.test(request)) {
    type = 'destroy_world'; scale = 90;
  } else if (/(?:灵气|天地灵气).*(?:消失|枯竭|不存在|归零)|(?:消除|抹去).*(?:灵气)/u.test(request)) {
    type = 'remove_spiritual_energy'; scale = 75;
  } else if (/(?:抹除|消灭|毁灭|解散).*(?:宗|门|教|帮|会)/u.test(request) && faction) {
    type = 'erase_faction'; targetId = faction.id; scale = 55;
  } else if (/(?:摧毁|毁灭|烧毁|淹没|抹除).*(?:城|镇|村|谷|山|海|庙|府|路|桥|门|宗|院|域)/u.test(request) && location) {
    type = 'destroy_location'; targetId = location.id; scale = 45;
  } else if (/(?:复活|重生|活过来)/u.test(request) && npc) {
    type = 'resurrect_npc'; targetId = npc.id; scale = 45;
  } else if (/(?:死去|死亡|杀死|抹杀|死掉)/u.test(request) && npc) {
    type = 'kill_npc'; targetId = npc.id; scale = 30;
  } else if (/(?:所有人|每个人|天下人).*(?:忘记|遗忘).*我/u.test(request)) {
    type = 'forget_player'; scale = 50;
  } else if (/(?:最高境界|修行上限).*(?:改为|改成|设为|提升至|变成)\s*([^，。；\s]{2,32}境)/u.test(request)) {
    realmName = request.match(/(?:最高境界|修行上限).*(?:改为|改成|设为|提升至|变成)\s*([^，。；\s]{2,32}境)/u)[1];
    scope = /(?:全世界|整个世界|世界|天下|所有|全体|全宇宙)/u.test(request) ? 'world' : 'personal';
    type = 'cultivation_rewrite_cap'; scale = scope === 'world' ? 70 : 45;
  } else if (/(?:达到|升到|升至|提升到|提升至|突破到|晋升到).*(?:最高境界|境界巅峰)/u.test(request)
    && /(?:我|自己|主角|本人|顾长生)/u.test(request)
    && !/(?:全世界|整个世界|天下|所有|全体|全宇宙)/u.test(request)) {
    type = 'cultivation_set_to_cap'; scale = 45;
  } else if (/(?:创造|变出|制造|炼成)/u.test(request) && /[:：]/u.test(request)) {
    generatedItem = parseGeneratedItem(request);
    type = 'create_generated_item'; scale = 25;
  } else if (/(?:无敌|不死|永生|刀枪不入)/u.test(request)) {
    type = 'invincible'; scale = 60;
  } else if (/(?:复活|重生|活过来).*(?:我|自己)/u.test(request)) {
    type = 'resurrect_player'; scale = 55;
  } else if (/(?:去|到|传送|瞬移).*(?:这里|那里|地点|城|镇|宗|门|谷|山|海)/u.test(request) && location) {
    type = 'teleport'; targetId = location.id; scale = 25;
  } else if (/(?:治愈|治好|恢复).*(?:伤|病|气血|身体)/u.test(request)) {
    type = 'heal'; scale = 12;
  } else if (/(?:气血上限|气血|财富|安全|实力|稳定|人口|危险)\s*(?:增加|提升|提高|减少|降低|设为|改为|变成)\s*\d+/u.test(request)) {
    numericMutation = parseNumericWish(world, request);
    type = 'numeric_mutation'; targetId = numericMutation.id;
    scale = 14 + Math.ceil(Math.log10(Math.max(1, Math.abs(numericMutation.value)))) * 5;
  } else if (/(?:改写|重写|改变).*(?:历史|过去)/u.test(request)) {
    if (faction) { type = 'rewrite_history'; targetId = faction.id; scale = 75; }
    else if (npc) { type = 'rewrite_history'; targetId = npc.id; scale = 70; }
    else throw new Error('请在改写历史的言灵中指明已有的人物或势力。');
  } else if (/(?:创造|变出|获得)/u.test(request)) {
    const template = ITEM_TEMPLATES.find(item => request.includes(item.name));
    if (!template) throw new Error('要创造的物品不在 Engine 物品目录中。');
    type = 'create_item'; targetId = template.id; scale = 25;
  } else throw new Error('此言灵尚不能被 Engine 解析为明确的现实变更；世界没有被改写。');
  const jitter = seedHash(world.seed, `wish:${world.minute}:${request}`) % 7;
  return { type, targetId, generatedItem, realmName, scope, numericMutation, request, cost: scale + jitter,
    id: `reality:${world.minute}:${seedHash(world.seed, request).toString(16)}` };
}

export function killNpc(world, npc, mutationId) {
  if (!npc?.alive) return;
  const deathLocationId = npc.locationId || npc.travel?.from || npc.homeId || world.player.locationId;
  npc.alive = false;
  npc.physicalCondition = 'dead';
  npc.travel = null;
  npc.currentPlan = null;
  npc.deathAt = world.minute;
  npc.lastKnownLocationId = deathLocationId;
  npc.inventory = npc.inventory || [];
  for (const itemId of npc.inventory) if (world.items[itemId]) {
    world.items[itemId].ownerId = null;
    world.items[itemId].locationId = deathLocationId;
    world.items[itemId].transferHistory ||= [];
    world.items[itemId].transferHistory.push({ minute: world.minute, source: mutationId, from: npc.id, to: null });
  }
  npc.inventory = [];
  npc.locationId = null;
  world.eventQueue = world.eventQueue.filter(event => event.payload?.actorId !== npc.id && event.payload?.characterId !== npc.id);
  reconcileQuestArcs(world, { type: 'death', actorId: npc.id });
}

function destroyLocation(world, location, mutationId) {
  const refuge = world.edges.find(edge => edge.from === location.id && !edge.closed
    && !world.locations[edge.to]?.destroyed && edge.to !== location.id)?.to || null;
  for (const npc of Object.values(world.characters)) if (npc.alive && npc.locationId === location.id) {
    if (refuge && seedHash(world.seed, `escape:${mutationId}:${npc.id}`) % 3 !== 0) {
      npc.locationId = refuge; npc.travel = null;
      npc.memories ||= []; npc.memories.push({ minute: world.minute, summary: `${location.name}毁灭后逃往${world.locations[refuge].name}` });
    } else killNpc(world, npc, mutationId);
  }
  if (world.player.locationId === location.id) {
    if (refuge) world.player.locationId = refuge;
    world.player.health = Math.max(0, Number(world.player.health || 0) - 50);
  }
  location.destroyed = true; location.closed = true; location.population = 0;
  location.economy = { ...(location.economy || {}), prosperity: 0, food: 0 };
  location.services = []; location.resources = [];
  for (const edge of world.edges) if (edge.from === location.id || edge.to === location.id) edge.closed = true;
  reconcileQuestArcs(world, { type: 'location_destroyed', locationId: location.id });
}

export function applyRealityMutation(source, plan) {
  if (!plan?.type || !plan?.id) throw new Error('言灵结算计划无效。');
  const world = structuredClone(source);
  if (world.terminal?.ended) throw new Error('此世已经终结，不能继续改写。');
  if (world.history.some(entry => entry.id === plan.id)) return world;
  let summary = plan.request;
  let changed = true;
  switch (plan.type) {
    case 'numeric_mutation': {
      const outcome = applyNumericMutation(world, plan.numericMutation);
      changed = outcome.applied;
      summary = outcome.summary;
      break;
    }
    case 'cultivation_set_to_cap': {
      const outcome = setRealmToCap(world, world.player);
      changed = outcome.applied;
      if (outcome.applied && outcome.steps > 0) {
        applyNumericMutation(world, { kind: 'player', id: world.player.id,
          field: 'maxHealth', operation: 'delta', value: 20 * outcome.steps });
        applyNumericMutation(world, { kind: 'player', id: world.player.id,
          field: 'health', operation: 'delta', value: 20 * outcome.steps });
      }
      summary = outcome.applied ? `言灵使我达到当前允许的最高境界：${realmLabel(world, outcome.to)}。`
        : '当前已在允许的最高境界，言灵未改变境界。';
      break;
    }
    case 'cultivation_rewrite_cap': {
      const outcome = rewriteRealmCap(world, plan.realmName, plan.scope, world.player);
      changed = outcome.changed;
      summary = changed ? `${plan.scope === 'world' ? '天下' : '我的'}修行上限已改为${outcome.name}；现有境界未被自动提升。`
        : '修行上限已经如此，言灵未再次改变规则。';
      break;
    }
    case 'invincible': world.player.invincible = true; break;
    case 'kill_npc': {
      const npc = world.characters[plan.targetId];
      if (!npc) throw new Error('言灵目标不在世界中。');
      killNpc(world, npc, plan.id);
      summary = `${npc.name}被言灵杀死。`;
      break;
    }
    case 'resurrect_npc': {
      const npc = world.characters[plan.targetId];
      if (!npc) throw new Error('复生目标不在世界中。');
      npc.alive = true;
      npc.physicalCondition = 'recovering';
      npc.deathAt = null;
      npc.locationId = npc.lastKnownLocationId || npc.homeId || world.player.locationId;
      npc.currentPlan = { type: 'recover' };
      summary = `${npc.name}因明确的言灵改写而复活。`;
      break;
    }
    case 'erase_faction': {
      const faction = world.factions[plan.targetId];
      if (!faction) throw new Error('言灵宗门目标不在世界中。');
      const formerMembers = Object.values(world.characters).filter(npc => npc.factionId === faction.id).map(npc => npc.id);
      faction.active = false;
      faction.power = 0;
      faction.wars = [];
      faction.memberIds = [];
      faction.leaderId = null;
      for (const npc of Object.values(world.characters)) if (npc.factionId === faction.id) npc.factionId = null;
      for (const loc of Object.values(world.locations)) if (loc.name === faction.name || loc.controllerFactionId === faction.id)
        destroyLocation(world, loc, plan.id);
      reconcileQuestArcs(world, { type: 'faction_change', factionId: faction.id, affectedActorIds: formerMembers });
      summary = `${faction.name}被抹除，其领地与道路已改变。`;
      break;
    }
    case 'destroy_location': {
      const location = world.locations[plan.targetId];
      if (!location) throw new Error('言灵地点目标不在世界中。');
      destroyLocation(world, location, plan.id);
      summary = `${location.name}被毁，居民、道路、经济与委托随之改变。`;
      break;
    }
    case 'forget_player': {
      for (const npc of Object.values(world.characters)) {
        npc.memories = (npc.memories || []).filter(memory => !JSON.stringify(memory).includes(world.player.name));
        delete npc.relationships?.[world.player.id];
      }
      world.player.relationships = {};
      break;
    }
    case 'remove_spiritual_energy': {
      world.flags.worldPressure.spiritualDensity = 0;
      world.flags.spiritualEnergyRemoved = true;
      for (const loc of Object.values(world.locations)) loc.resources = loc.resources.filter(resource => !/spirit|灵/u.test(resource));
      for (const npc of Object.values(world.characters)) npc.cultivation.suppressed = true;
      break;
    }
    case 'destroy_world': {
      for (const loc of Object.values(world.locations)) { loc.destroyed = true; loc.closed = true; loc.population = 0; }
      for (const edge of world.edges) edge.closed = true;
      for (const npc of Object.values(world.characters)) killNpc(world, npc, plan.id);
      for (const faction of Object.values(world.factions)) faction.active = false;
      world.player.alive = false; world.player.health = 0;
      world.terminal = { ended: true, ending: 'world_destroyed', minute: world.minute, summary: '此界已毁。' };
      world.eventQueue = [];
      break;
    }
    case 'all_life_extinction': {
      for (const npc of Object.values(world.characters)) killNpc(world, npc, plan.id);
      for (const faction of Object.values(world.factions)) faction.active = false;
      for (const loc of Object.values(world.locations)) loc.population = 0;
      world.player.alive = false; world.player.health = 0;
      world.terminal = { ended: true, ending: 'civilization_extinct', minute: world.minute,
        summary: '全宇宙生命归于寂静，此世不再出现寻常人物与日常活动。' };
      world.eventQueue = [];
      for (const quest of Object.values(world.quests || {})) if (!['completed','failed'].includes(quest.state)) {
        quest.state = 'invalidated'; quest.lostRewards = [...(quest.rewards || [])];
      }
      break;
    }
    case 'resurrect_player': world.player.alive = true; world.player.health = Math.max(1, world.player.maxHealth / 2); break;
    case 'teleport': {
      if (!world.locations[plan.targetId] || world.locations[plan.targetId].destroyed) throw new Error('言灵目标地点不存在。');
      world.player.locationId = plan.targetId; world.player.travel = null; world.locations[plan.targetId].discovered = true;
      break;
    }
    case 'heal': world.player.health = world.player.maxHealth; break;
    case 'rewrite_history': {
      const faction = world.factions[plan.targetId];
      const npc = world.characters[plan.targetId];
      if (faction) {
        faction.active = true;
        faction.power = Math.max(20, faction.power);
        for (const loc of Object.values(world.locations)) if (loc.name === faction.name) {
          loc.destroyed = false; loc.closed = false; loc.population = Math.max(1, loc.population);
        }
        for (const edge of world.edges) if (edge.from === faction.homeId || edge.to === faction.homeId) edge.closed = false;
        summary = `历史被改写：${faction.name}的覆灭因果不再成立。`;
      } else if (npc) {
        npc.alive = true; npc.deathAt = null; npc.physicalCondition = 'recovering';
        npc.locationId = npc.lastKnownLocationId || npc.homeId || world.player.locationId;
        summary = `历史被改写：${npc.name}不再死于旧因果。`;
      } else throw new Error('要改写的历史目标已不存在。');
      for (const old of world.history) if (old.targetId === plan.targetId || old.actors?.includes(plan.targetId)) old.supersededBy = plan.id;
      world.flags.historyRewrittenAt = world.minute;
      reconcileQuestArcs(world, { type: 'reality_mutation', targetId: plan.targetId });
      break;
    }
    case 'create_item': {
      const template = ITEM_TEMPLATES.find(item => item.id === plan.targetId);
      if (!template) throw new Error('物品目录中没有目标。');
      const id = `item-instance:wish-${plan.id}`;
      world.items[id] = { id, templateId: template.id, name: template.name, ownerId: world.player.id,
        locationId: world.player.locationId, quantity: 1, durability: 100, quality: 'reality',
        effects: [template.use], creationHistory: [{ minute: world.minute, source: plan.id }], transferHistory: [],
        destroyed: false, unique: true, tier: template.tier };
      world.player.inventory.push(id);
      break;
    }
    case 'create_generated_item': {
      const spec = plan.generatedItem;
      if (!spec?.name || !Array.isArray(spec.effects) || !spec.effects.length) throw new Error('生成物品缺少可结算规则。');
      const id = `item-instance:generated:${plan.id}`;
      world.items[id] = { id, templateId: `generated:${plan.id}`, generated: true, name: spec.name,
        description: spec.description, category: spec.category, creatorId: world.player.id,
        originTurnId: plan.id, ownerId: world.player.id, locationId: world.player.locationId,
        quantity: 1, durability: 100, quality: 'reality', effects: structuredClone(spec.effects),
        creationHistory: [{ minute: world.minute, source: plan.id }], transferHistory: [],
        destroyed: false, unique: true, tier: 'generated' };
      world.player.inventory.push(id);
      summary = `${spec.name}由言灵成形，已收入行囊；其使用规则已记入命簿。`;
      break;
    }
    default: throw new Error('言灵结算类型无效。');
  }
  // The effect happens first. Its cost is recorded, never used as an excuse to
  // silently deny a valid rewrite. Invincibility diverts lethal cost into debt.
  const actualCost = changed ? plan.cost : 0;
  world.flags.causalDebt = Number(world.flags.causalDebt || 0) + actualCost;
  if (!world.player.invincible && !world.terminal.ended && plan.type !== 'resurrect_player')
    world.player.health = Math.max(0, Number(world.player.health || 0) - Math.min(40, Math.ceil(actualCost / 3)));
  world.history.push({ id: plan.id, minute: world.minute, type: 'reality_mutation',
    summary, scope: plan.type, targetId: plan.targetId, locationId: world.player.locationId,
    actors: plan.targetId ? [world.player.id, plan.targetId] : [world.player.id],
    cost: actualCost, applied: changed, playerWitnessed: true });
  checkTerminalWorld(world);
  reconcileQuestArcs(world, { type: 'reality_mutation', targetId: plan.targetId });
  return world;
}
