import { REALMS, NPCS, LOCATIONS, TECHNIQUES } from './game-data.js';
import { actionOutcome } from './narrative-continuity.js';
import { explicitSelfDeath, isPlayerDead, resolvePlayerHealth } from './rpg-rules.js';

const text = (v, n = 180) => String(v || '').trim().slice(0, n);
export function fateHash(value) { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }
const openingCauses = [
  ['他们要你担下药材亏空，真正的账目还藏在柴房', '查清药材去向，争取离开的机会'],
  ['我在暴雨里把你救回赵府，一封错送的家书就压在枕边', '问清救命经过与家书来历'],
  ['有人把你认成了失踪学徒，得赶在换班前把事情说清楚', '弄清被认错的身份，决定是否澄清'],
  ['我让你在柴房暂歇，行商还没出发，方才隔墙却传来求救声', '决定如何回应近处的求救声'],
  ['你在药炉失火时昏倒，刚才有人来找你要药方', '厘清失火责任与药方的主人'],
  ['原定的假死脱身出了意外，约好接应的人还没来', '确认暗号与退路，寻找失约原因'],
  ['你运货受了伤，暂时借宿赵府，夜里有块樱纹玉片忽然发热', '照看伤势，查明玉片为何异动'],
  ['你替老杂役值夜时忽然昏倒，外面还在忙着筹备喜宴', '摸清身份，在热闹喜宴中寻找机缘']
];
export function openingForSeed(seed) {
  const pick = (label, values) => values[fateHash(`${seed}:${label}`) % values.length];
  const [cause, opportunity] = pick('cause', openingCauses);
  const setting=pick('location',[['赵府柴房',['东侧草席','旧药箱旁','靠井后窗']],['赵府杂役区',['洗药石阶','避雨门廊','旧车棚下']],['青石镇',['河埠茶棚','药铺后廊','渡口草席']]]);
  return { cause: setting[0]==='赵府柴房'?cause:setting[0]==='青石镇'?'我在镇口发现你昏倒，已经把你带到了能歇脚的地方。赵府正在找人，咱们得先弄清缘由。':'我刚把你从运药车旁扶开，你身上有赵府的杂役腰牌。先在这里歇一会，别挡着换班的路。', opportunity, location:setting[0], scene: pick('scene',setting[1]),
    weather: pick('weather', ['细雨', '雨后初晴', '闷热无风', '薄雾', '微雪', '晴朗']),
    period: pick('period', [['清晨', 360], ['午后', 810], ['黄昏', 1080], ['夜晚', 1260]]),
    cue: pick('cue', ['来人有话不敢明说', '附近有一条可查证的小线索', '一件不起眼的东西被人放错位置', '有人愿意帮忙，但需要先建立信任']) };
}
export function initializeOpening(source) {
  const state = structuredClone(source);
  if (state.memory.turnCount || state.journeyWorld.openingApplied) return state;
  const opening = openingForSeed(state.journeyWorld.seed || state.journeyId);
  state.journeyWorld.opening = opening;
  state.journeyWorld.openingApplied = true;
  state.story.location=opening.location;
  state.codex.locations=[opening.location];
  state.worldState.weather = opening.weather;
  state.worldState.sceneLabel = `${state.story.location}·${opening.scene}`;
  [state.story.period, state.story.minuteOfDay] = opening.period;
  state.director.sceneGoal = opening.opportunity;
  return state;
}

export const ADVANCE_INPUT = '我暂时留在原地，留意眼前的人和事，让当前局势自然发展一小段；遇到需要我表态或冒险的地方停下。';
export function actionContract(state, input) {
  const raw = text(input, 2000);
  const wish = raw.match(/^\s*言出法随\s*[:：]\s*([\s\S]+)/u)?.[1];
  const targets = [...new Set([...Object.keys(NPCS), ...Object.values(state.memory.entities).map(e => e.name)])].filter(n => raw.includes(n));
  // Conditions and negations remain in the AI contract, but never trigger
  // automatic resource rewards merely because they contain a keyword.
  const mechanical = !/如果|假如|等到|先不|不再|暂不|不.{0,4}(?:休息|歇|睡|修炼|吐纳|打坐|练功)|别|没有|并未/.test(raw);
  const kind = wish ? 'wish' : raw === ADVANCE_INPUT ? 'advance' : mechanical && /休息|歇一|歇息|睡一|小憩/.test(raw) ? 'rest'
    : mechanical && /修炼|吐纳|打坐|练功/.test(raw) ? 'cultivate' : /问|说|告诉|解释|谢谢|安慰|道歉|威胁|承诺|答应/.test(raw) ? 'talk'
    : /攻击|施展|拔剑|出拳|防御/.test(raw) ? 'combat' : /观察|查看|调查|寻找|检查/.test(raw) ? 'investigate' : 'act';
  return { kind, input: raw, targets, wish: text(wish, 320),
    instruction: kind === 'advance' ? '只让现有局势变化一小段，绝不替主角承诺、恋爱、转场或选择；给出可接手的具体事件。'
      : kind === 'rest' ? '先让主角获得真实休整，不突然插入危机；当前人际互动可继续。'
      : `第一段直接落实这次${kind === 'talk' ? '说话并让对象回应' : '行动'}，写出可感知的结果，再发展后续；保留否定、条件与行动顺序。` };
}

export function planWish(state, input) {
  const request = text(String(input).match(/^\s*言出法随\s*[:：]\s*([\s\S]+)/u)?.[1], 320);
  if (!request) return { active: false, scale: 'none', consequence: '', cost: '', cooldownTurns: 0 };
  const h = fateHash(`${state.journeyId}:${state.memory.turnCount}:${request}`);
  const debt = Math.max(0, Number(state.journeyWorld.lawDebt || 0));
  const intensity = /天道|世界|所有|一切|改变世界|永远|无敌|不死|永生|飞升|渡劫/.test(request) ? 4
    : /复活|元婴|化神|逆转生死|重塑|毁灭|无限/.test(request) ? 3
    : /筑基|结丹|金丹|瞬移|传送|突破|成为|穿越|治好|痊愈|恢复/.test(request) ? 2 : 1;
  const tiers = {
    1: { name: '凡愿', hp: [.01, .035], spirit: [0, 2], prices: ['指尖微麻，因果留下一丝余温', '耳畔轻鸣一瞬，转眼便散', '经脉微热，需要片刻调息', '心口掠过短促的失重感'] },
    2: { name: '重愿', hp: [.035, .085], spirit: [2, 6], prices: ['经脉灼热，灵台一阵发沉', '神魂短暂震荡，视野泛起金纹', '因果回响压过心口，需要认真调息', '灵觉被天机刺痛，数息后才稳定'] },
    3: { name: '逆命', hp: [.08, .155], spirit: [5, 11], prices: ['逆命回响贯穿经脉，神魂明显疲惫', '天地因果倒卷片刻，五感出现短暂错位', '灵台承受重压，需较长时间温养', '命线剧烈震颤，气血与灵力同时被抽走一截'] },
    4: { name: '天命', hp: [.13, .22], spirit: [9, 18], prices: ['天道回响如雷贯体，命线留下沉重余震', '世界因果被强行改写，神魂承受巨大反噬', '金色天纹压入经脉，需长时间才能完全平复', '命数被撬动，天地回声在识海中久久不散'] }
  };
  const tier = tiers[intensity];
  const hpRatio = tier.hp[0] + ((h >>> 3) % 1000) / 999 * (tier.hp[1] - tier.hp[0]) + Math.min(.035, debt / 3000);
  const hpCost = Math.min(Math.max(0, state.player.hp), Math.max(0, Math.floor(state.player.maxHp * Math.min(.22, hpRatio))));
  const spiritSpan = tier.spirit[1] - tier.spirit[0] + 1;
  const spiritCost = Math.min(state.player.spirit, tier.spirit[0] + ((h >>> 11) % Math.max(1, spiritSpan)));
  const price = tier.prices[(h >>> 19) % tier.prices.length];
  const npc = Object.keys(NPCS).find(name => ['让', '令', '使', '复活', '救活', '治好'].some(verb => request.includes(`${verb}${name}`))
    || ['复活', '突破', '成为', '直接', '立刻', '恢复'].some(verb => request.includes(`${name}${verb}`)));
  let targetRealm = REALMS.findIndex(r => r.name !== '凡人' && request.includes(r.name));
  if (targetRealm < 0) targetRealm = REALMS.findIndex(r => r.name !== '凡人' && request.replace('结丹', '金丹').includes(r.name.replace(/初期|中期|后期|大圆满|期$/u, '')));
  if (targetRealm < 0 && /突破/.test(request)) targetRealm = Math.min(REALMS.length - 1, state.player.realm + 1);
  const destination = Object.keys(LOCATIONS).find(name => request.includes(name) && /到|去|瞬移|传送/.test(request));
  const cost = `【${tier.name}】${price}；气血-${hpCost}，灵力-${spiritCost}，因果负担+${intensity}`;
  return { active: true, request, intensity, tier: tier.name, scale: intensity > 1 ? 'heaven-defying' : 'major',
    id: `law:${state.memory.turnCount}:${h}`, cost, hpCost, spiritCost, cooldownTurns: 0,
    targetRealm, npc, destination, selfDeath: explicitSelfDeath(request),
    consequence: `宿主原境界${REALMS[state.player.realm].name}。愿望「${request}」永久完整实现，不打折不失败。「我」字段是结算后状态，勿重复扣数；正文只写体感不报点数。唯一代价${cost}。系统欢呼撑场。` };
}

export function applyWish(state, plan) {
  if (!plan?.active || state.journeyWorld.laws?.some(l => l.id === plan.id)) return state;
  if (isPlayerDead(state)) return state;
  const before = state.player.realm;
  if (plan.targetRealm >= 0 && !plan.npc) {
    state.player.realm = Math.max(before, plan.targetRealm);
    for (let realm = before + 1; realm <= state.player.realm; realm++) {
      state.player.maxHp += 18 + realm * 2;
      state.player.attack += 4 + Math.floor(realm / 3); state.player.defense += 2 + Math.floor(realm / 5);
    }
    state.player.maxSpirit = Math.max(state.player.maxSpirit, 30 + state.player.realm * 12);
    state.player.hp = state.player.maxHp; state.player.spirit = state.player.maxSpirit;
  }
  if (!plan.npc && /恢复|治好|痊愈|回满/.test(plan.request)) { state.player.hp = state.player.maxHp; state.player.spirit = state.player.maxSpirit; }
  if (plan.destination) {
    state.story.location = plan.destination; state.worldState.sceneLabel = plan.destination;
    state.worldState.presentActorIds = []; state.codex.locations = [...new Set([...state.codex.locations, plan.destination])];
  }
  if (plan.npc) {
    const npc = NPCS[plan.npc];
    const entity = state.memory.entities[npc.id] ||= { id: npc.id, kind: 'npc', name: plan.npc, location: state.story.location,
      purpose: npc.role, status: 'alive', traits: [], knownFactIds: [], facts: [] };
    if (/复活|救活/.test(plan.request)) entity.status = 'alive';
    if (plan.targetRealm >= 0) entity.realm = REALMS[plan.targetRealm].name;
  }
  const money = plan.request.match(/(\d{1,6})\s*(?:枚|块|颗)?\s*(?:灵石|金币)/);
  if (money) state.player.gold = Math.min(999999, state.player.gold + Number(money[1]));
  if (/无限.*灵石|灵石.*无限/.test(plan.request)) { state.story.flags.lawInfiniteGold = true; state.player.gold = 999999; }
  resolvePlayerHealth(state, { delta: -plan.hpCost, explicitLethal: plan.selfDeath,
    cause: plan.selfDeath ? `言出法随：${plan.request}` : '言出法随的因果代价', sourceId: plan.id });
  state.player.spirit = Math.max(0, state.player.spirit - plan.spiritCost);
  state.journeyWorld.lawDebt = Math.min(100, Number(state.journeyWorld.lawDebt || 0) + plan.intensity);
  const record = { id: plan.id, request: plan.request, cost: plan.cost, turn: state.memory.turnCount + 1, status: 'fulfilled' };
  state.journeyWorld.laws = [...(state.journeyWorld.laws || []), record].slice(-30);
  state.journeyWorld.hard = [...state.journeyWorld.hard, `言出法随已实现：${plan.request}；${plan.cost}`].slice(-100);
  state.systemCompanion.cooldownTurns = 0;
  state.systemCompanion.charges = 1;
  return state;
}

export function commitPlayerAction(state, action, narration) {
  const result = actionOutcome(narration);
  state.journeyWorld.lastAction = { input: text(action.input, 280), kind: action.kind, targets: action.targets.slice(0, 4), result, turn: state.memory.turnCount };
  if (action.kind === 'rest') state.journeyWorld.lawDebt = Math.max(0, (state.journeyWorld.lawDebt || 0) - 2);
  return state;
}

export function commitCastObservations(state, narration) {
  const visible = narration.blocks.filter(b => b.type !== 'sys').map(b => `${b.name || ''}${b.text}`).join(' ');
  for (const cast of narration.cast || []) {
    if (!cast.name || !cast.evidence || !visible.includes(cast.name) || !visible.includes(cast.evidence)) continue;
    const entity = Object.values(state.memory.entities).find(e => e.kind === 'npc' && e.name === cast.name);
    if (!entity || !state.codex.characters.includes(cast.name)) continue;
    entity.observation = { mood: text(cast.mood, 40), condition: text(cast.condition, 50), evidence: text(cast.evidence, 120), turn: state.memory.turnCount };
    if (cast.realm && cast.evidence.includes(cast.realm)) entity.realm = text(cast.realm, 30);
    const relation = state.relationshipStates[cast.name] ||= { trust: 0, closeness: 0, wariness: 0, hostility: 0, debt: 0, affection: 0, lastEvent: '' };
    if (!narration.effects?.relationships?.[cast.name]) {
      for (const key of ['trust', 'closeness']) relation[key] = Math.max(-100, Math.min(100, relation[key] + Math.max(-3, Math.min(3, Number(cast[key]) || 0))));
    }
    relation.lastEvent = text(cast.evidence, 120);
  }
  return state;
}

// Mechanics enter the same response transaction as the narrative, so a failed
// request spends no resources, progresses no quest and does not consume a wish.
export function resolveActionEffects(state, action, narration) {
  // Wishes settle their own mechanical changes. A model's speculative chapter
  // completion must neither teleport the player nor veto a successful wish.
  if (action.kind === 'wish') return { ...narration, effects: {}, progress: { ...narration.progress,
    advanced: (narration.progress?.advanced || []).filter(id => !id.startsWith('chapter:')) } };
  const effects = { ...narration.effects };
  const shown = narration.blocks.map(b => b.text).join('');
  if (action.kind === 'rest' && effects.qi > 0 && !/吐纳|修炼|打坐|吸纳.*灵气|灵气.*入体|服下.*丹|炼化.*丹|顿悟/.test(shown)) delete effects.qi;
  if (action.kind === 'rest' && /休息|歇|坐|睡|躺|呼吸/.test(shown)) {
    effects.hp = Math.max(Number(effects.hp) || 0, Math.min(12, state.player.maxHp - state.player.hp));
    effects.spirit = Math.max(Number(effects.spirit) || 0, Math.min(12, state.player.maxSpirit - state.player.spirit));
  }
  if (action.kind === 'cultivate' && /吐纳|修炼|灵气|周天|运转|打坐/.test(shown)) effects.qi = Math.max(Number(effects.qi) || 0, 4 + Math.min(12, state.player.realm));
  const castIntent = /施展|使用|使出|释放|运起|练习/.test(action.input) && !/不|未|别|如果/.test(action.input);
  const skill = castIntent && state.techniques.known.find(name => action.input.includes(name));
  const cost = skill && (state.journeyWorld.skills[skill]?.cost ?? TECHNIQUES[skill]?.cost ?? 0);
  if (cost && shown.includes(skill) && state.player.spirit >= cost && !/失败|未能|没有成功/.test(shown)) effects.spirit = -cost;
  if (state.story.flags.lawInfiniteGold && effects.gold < 0) effects.gold = 0;
  return { ...narration, effects };
}
