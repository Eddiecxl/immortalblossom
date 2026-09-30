import { normalizeAstraWorld } from './astra-world.js';
import { advanceAstraWorld } from './astra-scheduler.js';
import { sceneAffordances } from './astra-affordances.js';
import { seedHash } from './astra-seed.js';

const BACKGROUND = {
  'farming household': '农家子弟', 'merchant family': '商户子弟',
  'wealthy household': '殷实人家的子弟', 'minor official family': '小吏人家的子弟',
  'ruined clan': '没落家族的子弟', hunter: '猎户', fisherman: '渔人', orphan: '孤儿',
  'medical apprentice': '药铺学徒', courier: '驿路信使', 'guard trainee': '守卫学徒',
  'escort apprentice': '镖局学徒', scholar: '书院学生', 'inn worker': '客栈伙计',
  servant: '府中仆役', 'village craftsman': '乡间匠人',
  'traveling family': '行旅人家的孩子', refugee: '流离失所的人',
  'minor noble household': '小门第的子弟'
};
const DANGER = {
  bandits: '近来有商路山匪活动的消息', flood: '有上游河面渐涨的消息',
  illness: '附近有人染上急病的消息传来', monster: '山野陌生兽迹的传闻流传开来',
  'political dispute': '地方权势争执的消息正影响日常生计'
};
const CHANCES = {
  'local healer': '有人传来消息，说乡间医者正在寻人帮忙；医者此刻的去向还需打听',
  'merchant route': '商队招募同行者的消息传来，具体去处还需打听',
  'sect examination': '远处宗门的试选消息传来',
  'wandering mentor': '有人说一位游方前辈将经过此地',
  'ancient rumor': '古迹的传闻仍在世间流传'
};

/** The opening records what the seed established; it does not resolve future encounters. */
export function createAstraOpening(source) {
  const state = structuredClone(source);
  const world = advanceAstraWorld(normalizeAstraWorld(state.astraWorld, state.journeyId, state.player.name), 1,
    { type: 'speech' }).world;
  state.astraWorld = world;
  const location = world.locations[world.player.locationId];
  if (!location) throw new Error('开篇地点不在世界地图中。');
  const background = BACKGROUND[world.player.background] || world.player.background;
  const danger = DANGER[world.flags.earlyDanger] || '世道并不安宁';
  const chance = CHANCES[world.flags.earlyOpportunity] || '眼前也有新的机会';
  const people = Object.values(world.characters || {}).filter(npc => npc.alive && !npc.travel && npc.locationId === world.player.locationId);
  const affordance = sceneAffordances(world);
  const witnessed = people[0]?.name ? `${people[0].name}在这里；这位${affordance.role}${affordance.goal ? `眼下牵挂着${affordance.goal}` : '可以问话'}` : '眼前暂无可以直接问话的熟面孔';
  const cue = `${danger}；${chance}。${witnessed}。`;
  const rumorId = 'rumor:opening-opportunity';
  world.rumors.push({ id: rumorId, originEventId: 'opening:cue', locationId: world.player.locationId,
    summary: chance, truthConfidence: 0.6, sourceCredibility: 0.6,
    knownBy: people.map(npc => npc.id), regionSpread: [world.player.locationId], spreadCount: 0 });
  world.player.knowledge = [...new Set([...(world.player.knowledge || []), rumorId])];
  for (const npc of people) npc.knowledge = [...new Set([...(npc.knowledge || []), rumorId])];
  world.history.push({ id: 'opening:cue', type: 'opening_cue', minute: world.minute,
    locationId: world.player.locationId, summary: cue, playerWitnessed: true, major: true });
  state.story.location = location.name;
  state.story.scene = 'astra-opening';
  state.story.day = Math.floor(world.minute / 1440) + 1;
  state.story.minuteOfDay = world.minute % 1440;
  state.story.period = state.story.minuteOfDay < 360 ? '夜晚' : state.story.minuteOfDay < 600 ? '清晨'
    : state.story.minuteOfDay < 1020 ? '白昼' : state.story.minuteOfDay < 1200 ? '黄昏' : '夜晚';
  state.worldState.origin = `我穿越后在${location.name}醒来，这具身体原本是${background}。`;
  state.worldState.sceneLabel = location.name;
  state.codex.locations = [...new Set([...(state.codex.locations || []), location.name])];
  state.director.sceneGoal = affordance.nextStep;
  state.story.flags.seededOpening = true;
  world.flags.transmigrated = true;
  const arrivals = [
    `另一世的记忆还在，我却已在${location.name}醒来。这具身体原本是${background}，属于这里的牵挂与我一同醒来。我确实穿越了；该怎样活下去，还得亲自弄清。`,
    `我先记起了另一段人生，然后才认出${location.name}。穿越没有给我现成的答案：此世的身份是${background}，眼前的人和事，需要从头认识。`,
    `我在${location.name}睁开眼，记忆却来自另一世。此世我是${background}；身体记得这段生活，我仍需弄清它。穿越已成事实，第一步该往哪里走？`
  ];
  const blocks = [
    { type: 'narr', text: arrivals[seedHash(world.seed,'opening:arrival') % arrivals.length] },
    { type: 'narr', text: cue },
    { type: 'sys', text: `宿主，先别慌。你现在身处${location.name}。可以先${affordance.nextStep}。刚听到的消息尚是传闻，要核实才能行动；你也可以查看地图，另选去向。` }
  ];
  const turn = {
    id: 'opening:astra', kind: 'world', userText: '', speech: '', actionText: '',
    provider: 'engine', model: 'seeded-world', summary: cue, blocks, createdAt: state.updatedAt
  };
  return { state, turn };
}
