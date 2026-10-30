// A read-only view of one current opening for player input, never a new event
// or a prescribed outcome. Recompute after proposals change the candidate world.
import { npcGoalLabel } from './astra-affordances.js';
import { evaluateCondition } from './astra-expression.js';
import {playerSceneHandoff} from './astra-player-scene.js';

const liveQuests = new Set(['available', 'active', 'mutated']);
const clean = value => String(value || '').replace(/[<>\u0000-\u001f]/gu, ' ').trim().slice(0, 160);

export function selectAstraHandoff(world, { events = [], targetId = null } = {}) {
  const player = world.player || {};
  if (world.terminal?.ended || player.alive === false || Number(player.health) <= 0) return null;
  const locationId = player.locationId, location = world.locations?.[locationId];
  const locationName = clean(location?.name) || '此地';
  if (player.travel) {
    const trip = player.travel, destination = clean(world.locations?.[trip.to]?.name) || '目的地';
    const remainingMinutes = Math.max(1, Math.ceil(Number(trip.arriveAt) - world.minute));
    return { kind: 'travel', locationId: null, subjectId: trip.to, destinationId: trip.to, remainingMinutes,
      focus: `前往${destination}的旅途尚未结束`, nextAction: `等待${remainingMinutes}分钟继续赶路`,
      text: `去往${destination}的行程还剩${remainingMinutes}分钟；眼下仍在途中，再赶这一程才能抵达。` };
  }
  const people = Object.values(world.characters || {}).filter(npc => npc.alive && !npc.travel && npc.locationId === locationId);
  const conversation = world.flags?.conversation;
  const focusId = targetId || (conversation?.locationId === locationId && world.minute - conversation.minute <= 240 ? conversation.npcId : null);
  const focused = people.find(npc => npc.id === focusId);
  const currentEvents = (events || []).filter(event => event?.playerWitnessed && event.summary && event.locationId === locationId
    && Number(event.minute) <= world.minute && !['player_speech', 'opening_cue', 'opening_contact', 'scene_director'].includes(event.type));
  const offers = Object.values(world.simulation?.commitments || {}).filter(offer => {
    const npc = people.find(person => person.id === offer.fromId), item = world.items?.[offer.itemId];
    return offer.kind === 'item-transfer' && offer.state === 'pending' && offer.toId === 'player' && npc
      && (!focused || npc.id === focused.id) && item && !item.destroyed && item.quantity > 0
      && item.ownerId === npc.id && item.quantity === offer.quantity && npc.inventory?.includes(item.id)
      && (offer.expiresAt == null || world.minute <= offer.expiresAt);
  });
  if (offers.length) {
    const offer = offers[0], npc = world.characters[offer.fromId], item = world.items[offer.itemId];
    let conditionMet = true;
    try { conditionMet = !offer.condition || evaluateCondition(world, offer.condition); } catch { conditionMet = false; }
    return { kind: 'commitment', locationId, subjectId: offer.id, targetId: npc.id, targetName: npc.name,
      itemId: item.id, conditionMet, focus: `${npc.name}关于${item.name}的交付约定仍待回应`,
      nextAction: conditionMet ? `回应${npc.name}对${item.name}的交付约定` : `向${npc.name}核实${item.name}尚未满足的交付条件`,
      text: conditionMet ? `${item.name}仍由${npc.name}持有；关于它的交付约定还等着我的答复。`
        : `${item.name}仍在${npc.name}手中，交付条件尚未满足；得先把这项约定的条件问清。` };
  }
  const quest = Object.values(world.quests || {}).find(q => liveQuests.has(q.state)
    && (q.deadline == null || world.minute <= q.deadline)
    && (!focused || q.giverId === focused.id)
    && (people.some(npc => npc.id === q.giverId) || q.state !== 'available' && q.targetLocationId === locationId));
  if (quest) {
    const giver = people.find(npc => npc.id === quest.giverId);
    return { kind: 'quest', locationId, subjectId: quest.id, questState: quest.state,
      ...(giver ? { targetId: giver.id, targetName: giver.name } : {}), focus: `「${clean(quest.title)}」当前仍有待处理的条件`,
      nextAction: giver ? `向${giver.name}询问「${clean(quest.title)}」的${quest.state === 'available' ? '具体要求' : '当前阻碍'}`
        : `核对「${clean(quest.title)}」在${locationName}的完成条件`,
      text: giver ? `「${clean(quest.title)}」尚未了结，${giver.name}就在这里；这件事的${quest.state === 'available' ? '要求还可以当面问清' : '当前阻碍还可以当面商量'}。`
        : `「${clean(quest.title)}」的目标就在${locationName}；眼下可以先核对这里尚未满足的完成条件。` };
  }
  const event = currentEvents.at(-1);
  const encounter=playerSceneHandoff(world);
  if(encounter&&(!targetId||targetId===encounter.targetId))return encounter;
  if (event && !focused) {
    const witness = people.find(npc => event.actors?.includes(npc.id));
    return { kind: 'event', locationId, subjectId: event.id,
      ...(witness ? { targetId: witness.id, targetName: witness.name } : {}), focus: clean(event.summary),
      nextAction: witness ? `向${witness.name}追问刚才的变故` : `查看${locationName}刚才变故留下的情况`,
      text: witness ? `${witness.name}仍在眼前，刚才这场变故的缘由还可以当面追问。`
        : `刚才的变故就发生在${locationName}；眼下可以近看它留下的情况。` };
  }
  const npc = focused || people[0];
  if (npc) {
    const goal = npcGoalLabel(world, npc);
    return { kind: 'contact', locationId, subjectId: npc.id, targetId: npc.id, targetName: npc.name,
      ...(goal ? { goal } : {}), focus: goal ? `${npc.name}眼下牵挂着${goal}` : `${npc.name}就在${locationName}`,
      nextAction: goal ? `与${npc.name}谈谈${goal}的难处` : `向${npc.name}问清其来意`,
      text: `${npc.name}就在近处。` };
  }
  const road = (world.edges || []).find(edge => edge.from === locationId && !edge.closed
    && world.locations?.[edge.to] && !world.locations[edge.to].destroyed && !world.locations[edge.to].closed);
  if (road) {
    const destination = clean(world.locations[road.to].name);
    return { kind: 'route', locationId, subjectId: road.id, destinationId: road.to,
      focus: `${locationName}通往${destination}的道路仍可通行`, nextAction: `查看通往${destination}的路况`,
      text: `通往${destination}的路就在${locationName}接出，眼下尚可通行；出发前，先在这里看清这段路的情况。` };
  }
  const item = (player.inventory || []).map(id => world.items?.[id]).find(row => row && row.ownerId === 'player' && !row.destroyed && row.quantity > 0);
  return { kind: 'inspect', locationId, subjectId: item?.id || locationId,
    focus: item ? `随身的${clean(item.name)}` : `${locationName}当前没有可通行的出路`,
    nextAction: item ? `查看随身的${clean(item.name)}` : `查看${locationName}的环境与出路`,
    text: item ? `眼下没有能走通的路；随身的${clean(item.name)}还在，可以先拿出来查看。`
      : `${locationName}眼下没有能走通的路，出路得从脚下这处地方查起。` };
}
