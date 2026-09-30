// The director chooses an affordance from Engine facts. After repeated quiet
// turns it records a real local rumor, rather than asking the narrator to
// manufacture progress in prose.
const dangerText = {
  bandits: '商路有山匪活动的消息', flood: '上游水势正在上涨的消息',
  illness: '附近有人染病的消息', monster: '山野出现陌生兽迹的消息',
  'political dispute': '地方权势争执影响生计的消息'
};

export function directAstraScene(world, events = []) {
  world.flags ||= {};
  const director = world.flags.sceneDirector ||= { quietTurns: 0, sequence: 0 };
  const local = (events || []).filter(event => event?.playerWitnessed && event.summary
    && !['player_speech', 'opening_cue', 'scene_director'].includes(event.type));
  const current = world.locations?.[world.player?.locationId];
  const causalOpportunity = Object.values(world.characters || {}).find(npc => npc.alive && !npc.travel
    && npc.locationId === world.player.locationId && npc.currentPlan?.causeEventId && npc.currentPlan?.type === 'support'
    && ['pending', 'acting'].includes(npc.currentPlan.state));
  if (causalOpportunity) return { hook: causalOpportunity.name + '记得此前的事情，有意相助；可以问问对方愿意提供什么。', event: null };
  if (local.length) {
    director.quietTurns = 0;
    return { hook: local.at(-1).summary, event: null };
  }
  director.quietTurns += 1;
  const quest = Object.values(world.quests || {}).find(entry =>
    ['active', 'available', 'mutated'].includes(entry.state) && entry.targetLocationId === world.player.locationId);
  if (director.quietTurns < 3) {
    return { hook: quest ? `${quest.title}仍在推进，期限和相关人物不会停等。`
      : `我仍在${current?.name || '此地'}，身边人物与世界时辰继续变化。`, event: null };
  }
  director.quietTurns = 0;
  const id = `director:${world.minute}:${director.sequence++}`;
  const roads = (world.edges || []).filter(edge => edge.from === world.player.locationId
    && !edge.closed && !world.locations?.[edge.to]?.destroyed);
  const dangerousRoads = roads.filter(edge => Number(edge.risk || 0) >= 70);
  const road = dangerousRoads.length ? dangerousRoads[director.sequence % dangerousRoads.length] : null;
  const summary = road
    ? `${current?.name || '此地'}传出警示：通往${world.locations[road.to]?.name || '邻地'}的路近来不太平，出发前最好先打听。`
    : `${current?.name || '此地'}出现${dangerText[world.flags.earlyDanger] || '局势变化的消息'}，当地人开始留意。`;
  const present = Object.values(world.characters || {}).filter(npc => npc.alive && npc.locationId === world.player.locationId);
  const rumorId = `rumor:${id}`;
  world.rumors ||= [];
  world.rumors.push({ id: rumorId, originEventId: id, locationId: world.player.locationId,
    summary, truthConfidence: road ? 1 : 0.65, sourceCredibility: road ? 1 : 0.65,
    regionSpread: [world.player.locationId], spreadCount: 0, distortion: '',
    knownBy: present.slice(0, 5).map(npc => npc.id) });
  for (const npc of present.slice(0, 5)) {
    npc.knowledge ||= [];
    npc.knowledge.push(rumorId);
    npc.knowledge = [...new Set(npc.knowledge)].slice(-80);
  }
  const event = { id, minute: world.minute, type: 'scene_director', locationId: world.player.locationId,
    actors: present.slice(0, 5).map(npc => npc.id), summary, playerWitnessed: true };
  world.history.push(event);
  return { hook: summary, event };
}
