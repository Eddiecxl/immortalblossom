import { normalizeAstraWorld } from './astra-world.js';
import { advanceAstraWorld } from './astra-scheduler.js';

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
  bandits: '近来商路传出山匪的消息', flood: '上游的雨水令河面渐涨',
  illness: '附近有人染上急病', monster: '山野里出现陌生的兽迹',
  'political dispute': '地方上的权势争执正影响日常生计'
};
const CHANCES = {
  'local healer': '有人传来消息，说乡间医者正在寻人帮忙；医者此刻的去向还需打听',
  'merchant route': '商队招募同行者的消息传来，具体去处还需打听',
  'sect examination': '远处宗门的试选消息传进镇里',
  'wandering mentor': '有人说一位游方前辈将经过此地',
  'ancient rumor': '古迹传闻偶尔从路过的旅人口中流出'
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
  const people = Object.values(world.characters || {}).filter(npc => npc.alive && npc.locationId === world.player.locationId);
  const witnessed = people[0]?.name ? `${people[0].name}也在此地，正忙于自己的事情` : '街巷里已有人开始一天的奔走';
  const cue = `${danger}；${chance}。${witnessed}。`;
  world.history.push({ id: 'opening:cue', type: 'opening_cue', minute: world.minute,
    locationId: world.player.locationId, summary: cue, playerWitnessed: true, major: true });
  state.story.location = location.name;
  state.story.scene = 'astra-opening';
  state.story.day = Math.floor(world.minute / 1440) + 1;
  state.story.minuteOfDay = world.minute % 1440;
  state.story.period = state.story.minuteOfDay < 360 ? '夜晚' : state.story.minuteOfDay < 600 ? '清晨'
    : state.story.minuteOfDay < 1020 ? '白昼' : state.story.minuteOfDay < 1200 ? '黄昏' : '夜晚';
  state.worldState.origin = `我在${location.name}开始此世，原本是${background}。`;
  state.worldState.sceneLabel = location.name;
  state.codex.locations = [...new Set([...(state.codex.locations || []), location.name])];
  state.director.sceneGoal = '先弄清眼前人事，决定此世的第一步。';
  state.story.flags.seededOpening = true;
  const blocks = [
    { type: 'narr', text: `清晨，我在${location.name}醒来。此世我是一名${background}；家人与生计各有牵挂，脚下的路也尚未写定。` },
    { type: 'narr', text: `${cue}街巷仍按自己的时辰运转，谁也不会因为我停下。` },
    { type: 'sys', text: `宿主，我在。你身处${location.name}；眼前的异动已经发生。你想先问问在场的人，还是亲自查看？接下来的事不会停等。` }
  ];
  const turn = {
    id: 'opening:astra', kind: 'world', userText: '', speech: '', actionText: '',
    provider: 'engine', model: 'seeded-world', summary: cue, blocks, createdAt: state.updatedAt
  };
  return { state, turn };
}
