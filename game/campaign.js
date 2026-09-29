import { CHAPTERS, ENDINGS, NPCS, QUESTS } from './game-data.js';
import { hasVisibleFactEvidence, storyVisibleTextFor } from './discovery.js';

// Campaign bookkeeping is engine owned. AI progress IDs and player prose are
// deliberately not inputs to completion. Every step needs a committed outcome.
const clean = (value, limit = 160) => String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, limit);
const count = (s, item) => Math.max(0, Number(s.inventory?.items?.[item]) || 0)+Math.max(0,Number(s.inventory?.materials?.[item])||0);
const done = (s, id) => (s.quests?.completed || []).includes(id);
const realm = (s, minimum) => Number(s.player?.realm) >= minimum;
const at = (s, location) => s.story?.location === location;
const spent = (b, a, key, amount) => Number(b.player?.[key] || 0) - Number(a.player?.[key] || 0) >= amount;
const used = (b, a, item, amount = 1) => count(b, item) - count(a, item) >= amount;
const alive = (s, name) => !['dead', 'destroyed', 'deceased'].includes(s.memory?.entities?.[NPCS[name]?.id]?.status);
const quest = (id) => (b, a) => done(a, id);
const qiCost = (amount) => (b, a) => spent(b, a, 'spirit', amount);
const STEP = (id, goal, topic, check, extra = {}) => ({ id, goal, topic, check, ...extra });

export const CAMPAIGN_CHAPTERS = [
  { title: '异世醒来', why: '你是带着前世记忆的穿越者；先确认身处何地，摆脱眼前威胁。', location: null, steps: [
    STEP('first-meeting', '与最先遇见的林小满交谈，确认赵府的追捕与可用出口', /林小满|赵府|出口/u, (b, a, n) =>
      (n.blocks || []).some(x => x.type === 'dlg' && x.name === '林小满') && alive(a, '林小满'), { encounter: true }),
    STEP('leave-danger', '实际离开醒来地点，保住性命', /脱身|追兵|逃离|出口|赵府/u, (b, a) =>
      (b.story?.location !== a.story?.location || (a.worldState?.sceneLabel && b.worldState?.sceneLabel !== a.worldState.sceneLabel)) && a.player?.hp > 0)
  ] },
  { title: '雨巷抉择', why: '林小满的处境会留下真实后果；你也可以独自脱身。', location: '青石镇', npc: '林小满', steps: [
    STEP('xiaoman-fate', '完成「柴门之外」；或交付一份回春丹援助；或承担失去同行者的代价独自脱身', /小满|追捕|逃亡|独自|遗物/u,
      quest('escape-zhao'), { quest: 'escape-zhao', alternative: (b, a) => at(a, '青石镇') &&
        (used(b, a, '回春丹') || !alive(a, '林小满') || (a.quests?.failed || []).includes('escape-zhao')), alternativeName: '自择去留' })
  ] },
  { title: '第一次引气', why: '修行是远行的基础。李老不在时，仍能靠吐纳自己入门。', location: '青石镇', npc: '李老', steps: [
    STEP('first-qi', '修至炼气一层；完成「醉翁传法」或以吐纳实修取得突破', /引气|吐纳|经脉|突破/u,
      (b, a) => realm(a, 1) && done(a, 'meet-elder'), { quest: 'meet-elder', alternative: (b, a) => realm(a, 1) &&
        (Number(a.player.realm) > Number(b.player.realm) || Number(a.techniques?.mastery?.['吐纳']) > Number(b.techniques?.mastery?.['吐纳'] || 0)), alternativeName: '自行引气' })
  ] },
  { title: '九百石阶', why: '先取得山门的落脚处，再决定入宗或做客卿散修。', location: '落霞宗外门', steps: [
    STEP('mountain-entry', '实际抵达落霞宗外门，寻找落脚点；或支付10灵石取得散修暂住资格', /山门|外门|暂住|客卿/u,
      (b, a) => at(a, '落霞宗外门') && (b.story?.location !== a.story?.location || done(a, 'outer-trial') || a.quests?.active?.some(q => q.id === 'outer-trial')),
      { alternative: (b, a) => at(a, '落霞宗外门') && spent(b, a, 'gold', 10), alternativeName: '散修客卿' })
  ] },
  { title: '外门烟火', why: '三项功课提供根基；散修可用采药、吐纳和兵器训练代替宗门身份。', location: '落霞宗外门', steps: [
    STEP('outer-foundation', '达到炼气二层并完成三项外门试炼；或吐纳熟练度10且交付4株止血草', /功课|试炼|采药|散修|吐纳/u,
      (b, a) => realm(a, 2) && done(a, 'outer-trial'), { quest: 'outer-trial', alternative: (b, a) => realm(a, 2) &&
        Number(a.techniques?.mastery?.['吐纳']) >= 10 && used(b, a, '止血草', 4), alternativeName: '散修根基' })
  ] },
  { title: '后山足迹', why: '从可查证的失踪痕迹入手，决定是否继续追查宗门旧案。', location: '后山樱林', steps: [
    STEP('forest-evidence', '在后山樱林取得失踪线索，调查实际消耗至少5灵力', /失踪|足迹|魔修|后山/u,
      (b, a) => at(a, '后山樱林') && spent(b, a, 'spirit', 5))
  ] },
  { title: '残简疑云', why: '需要失踪案证据与真实玉简；不依赖任何一名证人存活。', location: '落霞宗外门', steps: [
    STEP('missing-case', '完成「后山失踪案」；或付出20灵力独自重建失踪者的路线', /失踪|弟子|路线|调查/u,
      quest('missing-disciples'), { quest: 'missing-disciples', alternative: qiCost(20), alternativeName: '独查失踪案' }),
    STEP('jade-evidence', '完成「残简疑云」并持有残缺玉简；或花费40灵石购买经核实的拓本', /玉简|旧史|拓本|残简/u,
      (b, a) => done(a, 'secret-jade') && count(a, '残缺玉简') > 0,
      { quest: 'secret-jade', alternative: (b, a) => spent(b, a, 'gold', 40), alternativeName: '购买拓本', reward: '残缺玉简' })
  ] },
  { title: '青岚资格', why: '秘境考验修为和入境凭证，比赛、交易与散修路线都可取得资格。', location: '落霞宗外门', steps: [
    STEP('qinglan-token', '达到炼气九层；大比获青岚令，或花费60灵石取得转让令牌', /大比|青岚令|资格|令牌/u,
      (b, a) => realm(a, 9) && done(a, 'sect-tournament') && count(a, '青岚令') > 0,
      { quest: 'sect-tournament', alternative: (b, a) => realm(a, 9) && spent(b, a, 'gold', 60), alternativeName: '转让令牌', reward: '青岚令' })
  ] },
  { title: '青岚开境', why: '凭证必须在手，真正进入秘境后才算跨过界门。', location: '青岚秘境', steps: [
    STEP('enter-realm', '持有青岚令到达青岚秘境，完成「青岚开境」或消耗5灵力稳定界门', /界门|秘境|青岚/u,
      (b, a) => at(a, '青岚秘境') && count(a, '青岚令') > 0 && done(a, 'mystic-entry'),
      { quest: 'mystic-entry', alternative: (b, a) => at(a, '青岚秘境') && count(a, '青岚令') > 0 && spent(b, a, 'spirit', 5), alternativeName: '自行稳门' })
  ] },
  { title: '青雾同路', why: '援救与独行需要不同代价，选择会写入此生路线。', location: '青岚秘境', npc: '慕容雪', steps: [
    STEP('fog-route', '完成「雾中呼救」；或在秘境交付2份回春丹结伴；或承担10气血损失独自穿雾', /雾|救援|结伴|独行/u,
      (b, a) => at(a, '青岚秘境') && done(a, 'mystic-rescue'), { quest: 'mystic-rescue', alternative: (b, a) => at(a, '青岚秘境') &&
        (used(b, a, '回春丹', 2) || spent(b, a, 'hp', 10)), alternativeName: '自择雾路' })
  ] },
  { title: '石碑真名', why: '将已有玉简与石碑核对，给被抹去的人恢复名字。', location: '青岚秘境', steps: [
    STEP('stone-name', '在秘境持有残缺玉简，完成「石碑真名」；或消耗15灵力解读石碑', /石碑|真名|玉简|祖师/u,
      (b, a) => at(a, '青岚秘境') && count(a, '残缺玉简') > 0 && done(a, 'truth-below'), { quest: 'truth-below',
        alternative: (b, a) => at(a, '青岚秘境') && count(a, '残缺玉简') > 0 && spent(b, a, 'spirit', 15), alternativeName: '自行解碑' })
  ] },
  { title: '遗境之心', why: '穿过四重遗迹后必须处理核心，突破到金丹才能面对北境。', location: '青岚秘境', steps: [
    STEP('core-fate', '完成四重「遗境之心」并修至金丹初期；任务失败时可消耗30灵力封住核心后撤', /核心|遗境|封印|崩塌/u,
      (b, a) => realm(a, 14) && done(a, 'mystic-core'), { quest: 'mystic-core', alternative: (b, a) => realm(a, 14) && at(a, '青岚秘境') && spent(b, a, 'spirit', 30), alternativeName: '封核后撤' })
  ] },
  { title: '北境烽火', why: '守关或撤民都要有实际行动，空口承诺不能抵御攻势。', location: '北境天关', npc: '陆沉舟', steps: [
    STEP('north-front', '到达北境并完成五阶段「北境烽火」；或交付6份回春丹组织撤民', /北境|守关|百姓|撤民|伤营/u,
      (b, a) => at(a, '北境天关') && done(a, 'north-defense'), { quest: 'north-defense', alternative: (b, a) => at(a, '北境天关') && used(b, a, '回春丹', 6), alternativeName: '撤民保命' })
  ] },
  { title: '无名俘虏', why: '人证消失时可查遗物，真相不会随一名角色的死亡断绝。', location: '北境天关', steps: [
    STEP('prisoner-truth', '完成「无名俘虏」；或在北境消耗10灵力核验俘虏遗物、军报与口供', /俘虏|军报|遗物|口供/u,
      quest('demon-prisoner'), { quest: 'demon-prisoner', alternative: (b, a) => at(a, '北境天关') && spent(b, a, 'spirit', 10), alternativeName: '独查军报' })
  ] },
  { title: '深入幽冥', why: '星盘碎片是天机台的钥匙。可以与宁无妄合作，也可以自行取出。', location: '幽冥裂隙', npc: '宁无妄', steps: [
    STEP('rift-key', '达到金丹后期并进入幽冥裂隙；完成「深入幽冥」获星盘碎片，或消耗30灵力独自取出', /裂隙|星盘|旧约|碎片/u,
      (b, a) => realm(a, 16) && at(a, '幽冥裂隙') && done(a, 'rift-descent') && count(a, '星盘碎片') > 0,
      { quest: 'rift-descent', alternative: (b, a) => realm(a, 16) && at(a, '幽冥裂隙') && spent(b, a, 'spirit', 30), alternativeName: '独探幽冥', reward: '星盘碎片' })
  ] },
  { title: '山门问罪', why: '真相必须付诸行动；公开、隐瞒或离宗都留下实际关系与立场。', location: '落霞宗外门', steps: [
    STEP('sect-decision', '完成「山门存亡」；或持玉简发表证据，造成至少2点善念、野心或魔道倾向变化', /宗门|证据|公开|离宗|真相/u,
      quest('sect-choice'), { quest: 'sect-choice', alternative: (b, a) => count(a, '残缺玉简') > 0 &&
        ['mercy', 'ambition', 'demonic'].some(k => Math.abs(Number(a.karma?.[k] || 0) - Number(b.karma?.[k] || 0)) >= 2), alternativeName: '自定宗门立场' })
  ] },
  { title: '天机照命', why: '前世记忆与此生因果在星盘上汇合，需要实物与化神修为承受回照。', location: '天机台', steps: [
    STEP('star-memory', '修至化神期，持星盘碎片到天机台并完成三段「天机照命」；或消耗35灵力自行回照', /前世|星盘|因果|回照/u,
      (b, a) => realm(a, 19) && at(a, '天机台') && count(a, '星盘碎片') > 0 && done(a, 'read-stars'),
      { quest: 'read-stars', alternative: (b, a) => realm(a, 19) && at(a, '天机台') && count(a, '星盘碎片') > 0 && spent(b, a, 'spirit', 35), alternativeName: '自行照命' })
  ] },
  { title: '旧约未冷', why: '死者不会被召回；可以履约，也可以面对遗憾、安顿遗物。', location: '天机台', npc: '林小满', steps: [
    STEP('last-promise', '完成「旧约未冷」或「飞升前的饭」；或消耗一份桃花酿告别旧人、安顿遗物', /旧约|承诺|告别|遗物|故人/u,
      (b, a) => done(a, 'broken-promise') || done(a, 'last-meal'), { quest: 'broken-promise', alternative: (b, a) => used(b, a, '桃花酿'), alternativeName: '带憾前行' })
  ] },
  { title: '问心一战', why: '承认前世与今生的执念，带着已做出的选择走向终局。', location: '天机台', steps: [
    STEP('heart-resolution', '达到炼虚期并完成「问心一战」；或消耗清心丹与30灵力直面执念', /心魔|执念|心镜|问心/u,
      (b, a) => realm(a, 20) && done(a, 'heart-demon'), { quest: 'heart-demon', alternative: (b, a) => realm(a, 20) && used(b, a, '清心丹') && spent(b, a, 'spirit', 30), alternativeName: '直面心镜' })
  ] },
  { title: '此生落笔', why: '完成九重天劫，再用实际立场选择飞升、守护、远游或执掌幽冥。', location: '飞升台', steps: [
    STEP('nine-thunders', '修至渡劫期，到达飞升台并完成九阶段「九重天劫」', /天劫|雷劫|九重|渡劫/u,
      (b, a) => realm(a, 22) && at(a, '飞升台') && done(a, 'final-tribulation'), { quest: 'final-tribulation' }),
    STEP('life-ending', '作出最终选择，让实际结局写入此生记录', /飞升|守护|同游|幽冥|结局/u, () => false, { ending: true })
  ] }
].map((chapter, index) => ({ ...chapter, id: CHAPTERS[index].id, act: CHAPTERS[index].act }));

const allSteps = new Set(CAMPAIGN_CHAPTERS.flatMap(c => c.steps.map(s => s.id)));
const hash = value => { let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.codePointAt(0), 16777619); return result >>> 0; };
export function createCampaign(seed = 'luoxian') {
  const stableSeed = clean(seed, 100) || 'luoxian';
  const n = hash(stableSeed);
  const places = ['赵府柴房', '赵府杂役区', '青石镇'];
  const manners = ['林小满隔着木门低声唤醒你，追兵正搜过井台', '林小满把药篮藏到你身旁，示意你避开巡夜灯火', '林小满在雨檐下认出你，递来一块能止住伤口的布'];
  return { version: 1, seed: stableSeed, chapterId: CHAPTERS[0].id, completed: [], routeHistory: [], events: [],
    status: 'active', ending: null, targetHours: 100,
    opening: { location: places[n % places.length], manner: manners[Math.floor(n / 3) % manners.length], firstActorId: 'npc:lin-xiaoman', origin: '保留前世记忆、意外来到此世的穿越者' } };
}

export function normalizeCampaign(raw, seed = 'luoxian') {
  const base = createCampaign(raw?.seed || seed);
  if (!raw || typeof raw !== 'object') return base;
  if(raw.opening) base.opening={...base.opening,location:clean(raw.opening.location,40)||base.opening.location,manner:clean(raw.opening.manner,160)||base.opening.manner,origin:clean(raw.opening.origin,180)||base.opening.origin};
  const index = CAMPAIGN_CHAPTERS.findIndex(c => c.id === raw.chapterId);
  if (index >= 0) base.chapterId = raw.chapterId;
  // Old saves start at their existing chapter; earlier steps are historical,
  // without replaying costs, rewards, or claiming a newly earned completion.
  const historical = CAMPAIGN_CHAPTERS.slice(0, Math.max(0, index)).flatMap(c => c.steps.map(s => s.id));
  base.completed = [...new Set([...historical, ...(Array.isArray(raw.completed) ? raw.completed.filter(id => allSteps.has(id)) : [])])];
  base.routeHistory = (Array.isArray(raw.routeHistory) ? raw.routeHistory : []).filter(x => x && CAMPAIGN_CHAPTERS.some(c => c.id === x.chapterId))
    .slice(-40).map(x => ({ chapterId: x.chapterId, path: clean(x.path, 60) }));
  base.events = (Array.isArray(raw.events) ? raw.events : []).slice(-4).map(x => clean(x, 220));
  if (Object.hasOwn(ENDINGS, raw.ending) && ['complete', 'fallen'].includes(raw.status)) {
    base.ending = raw.ending; base.status = raw.status;
  }
  return base;
}

function campaignFor(state) { return normalizeCampaign(state.campaign || { chapterId: state.director?.chapterId }, state.journeyWorld?.seed || state.journeyId); }
function current(campaign) { return CAMPAIGN_CHAPTERS.find(c => c.id === campaign.chapterId) || CAMPAIGN_CHAPTERS[0]; }
function pending(campaign) { return current(campaign).steps.find(s => !campaign.completed.includes(s.id)); }
export function campaignDestination(state){return state.campaign?.status==='active'?current(campaignFor(state)).location:null;}
function evidence(before, after, narration, step) {
  const oldFacts = new Set((before.memory?.facts || []).map(f => f.id));
  const visible = storyVisibleTextFor(narration);
  return (after.memory?.facts || []).some(f => !oldFacts.has(f.id) && step.topic.test(f.object || '') && hasVisibleFactEvidence(f, visible));
}

export function campaignGuidance(state) {
  const campaign = campaignFor(state), chapter = current(campaign), step = pending(campaign);
  const progress = { completed: campaign.completed.length, total: allSteps.size,
    chapterCompleted: chapter.steps.filter(s => campaign.completed.includes(s.id)).length, chapterTotal: chapter.steps.length };
  if (campaign.status !== 'active') return { chapter: chapter.id, title: ENDINGS[campaign.ending]?.title || chapter.title,
    objective: ENDINGS[campaign.ending]?.description || '此生已落幕。', why: '结局已经保存；可回看此生或另开一程。', options: [], progress, status: campaign.status };
  const dead = chapter.npc && !alive(state, chapter.npc);
  const away = chapter.location && !at(state, chapter.location);
  const options = [{ label: '推进眼前目标', command: `我着手${step?.goal || chapter.why}，先查看可行办法与代价。` }];
  if (away) options.unshift({ label: `寻找通往${chapter.location}的路`, command: `我从${clean(state.story?.location, 30)}寻找通往${chapter.location}的路线，先确认途中条件。` });
  if (step?.alternative) options.push({ label: dead ? '转查遗物与独行路线' : '选择另一条路', command: `我选择${step.alternativeName}这条路，先确认所需物资和实际代价。` });
  options.push({ label: '自由行动', command: '我暂缓主线，检查当前地点可做的修炼、筹资、采药或人情事务。' });
  if(step?.ending)options.splice(0,options.length,...['飞升','守护人间','与同伴远游','执掌幽冥'].map(name=>({label:name,command:`我已经决定，最终选择${name}。`})));
  return { chapter: chapter.id, title: chapter.title, objective: step?.goal || '确认下一段旅程',
    why: `${chapter.why}${dead ? `${chapter.npc}已不在人世，线索转向遗物、记录与独行路线。` : ''}${away ? `当前在${clean(state.story?.location, 30)}，可沿途准备。` : ''}`,
    options: options.slice(0, 4), progress, status: campaign.status };
}

export function campaignContext(state, input = '') {
  const campaign = campaignFor(state), guidance = campaignGuidance(state), step = pending(campaign);
  const opening = campaign.completed.includes('first-meeting') ? '' : `主角是穿越者；首次角色相遇必须是林小满。${campaign.opening.manner}。`;
  const endingRule=step?.ending?'终局须玩家明确选择且正文已实现，memory.facts 中用 predicate:"ending" 记录该可见结果。守护需善念5，幽冥需魔道4，同游需活着的同伴关系20；不足时告知条件与准备办法。':'';
  return `${opening}主线二十章，禁止靠空转凑时长。${endingRule}当前${guidance.title}；目标：${guidance.objective}。缘由：${guidance.why}。${step?.quest ? `关联任务${step.quest}，按实际阶段结算。` : ''}自由行动可绕路；缺物资先提供取得渠道；死亡NPC不得复活。完成条件必须落实在物品、修为、地点、任务或实际消耗，并在正文展示结果、记入一条事实；事实描述须对应本目标。禁止用progress编号或声称完成代替结算。只有结算器推进篇章；未达目标则提供具体下一步。`.slice(0, 600);
}

function finish(state, campaign, id) {
  campaign.ending = id; campaign.status = id === 'fallen' ? 'fallen' : 'complete';
  state.endings ||= { unlocked: [], newGamePlus: false };
  state.endings.unlocked ||= [];
  if (!state.endings.unlocked.includes(id)) state.endings.unlocked.push(id);
  state.endings.newGamePlus = true;
  state.codex ||= {}; state.codex.endings ||= [];
  if (!state.codex.endings.includes(id)) state.codex.endings.push(id);
  campaign.events.push(`此生落笔 · ${ENDINGS[id].title}：${ENDINGS[id].description}`);
}

function eligibleEnding(before, after, narration, input) {
  if(!/(?:选择|决定|我愿|我要|我将)/u.test(input)||/不|没|尚未|考虑|如果|假如|能否|是否|[？?]/u.test(input))return null;
  const added = (after.endings?.unlocked || []).filter(id => !(before.endings?.unlocked || []).includes(id));
  const visible = (narration.blocks||[]).filter(b=>b.type==='narr').map(b=>b.text).join('。').split(/[。！]/u).filter(s=>!/[？?]|如果|假如|尚未|并未|没有|不曾|打算|准备|考虑/u.test(s)).join('。');
  // An explicit committed ending fact is accepted only after all nine trials,
  // with the matching public consequence and the required actual character build.
  const facts = (after.memory?.facts || []).filter(f => f.predicate === 'ending' &&
    !(before.memory?.facts || []).some(old => old.id === f.id) && hasVisibleFactEvidence(f, visible));
  const names = { guardian: /守护|留在人间/u, wanderer: /同游|远游|归隐/u, demonic: /幽冥|魔道/u, ascension: /飞升|开天/u };
  const selected=Object.keys(names).filter(id=>names[id].test(input));if(selected.length!==1)return null;
  for (const id of ['guardian', 'wanderer', 'demonic', 'ascension']) {
    if(id!==selected[0])continue;
    if (!added.includes(id) && !facts.some(f => names[id].test(f.object))) continue;
    if (!names[id].test(visible)) continue;
    if (id === 'guardian' && Number(after.karma?.mercy || 0) < 5) continue;
    if (id === 'demonic' && Number(after.karma?.demonic || 0) < 4) continue;
    if (id === 'wanderer' && !Object.keys(NPCS).some(n => alive(after, n) && Number(after.relationships?.[n]) >= 20)) continue;
    return id;
  }
  return null;
}

export function advanceCampaign(before, after, narration = {}, input = '') {
  // Prefer the latest saved ledger on retries; never reset an already applied
  // reward by reconstructing progress from the transaction's older before-state.
  const campaign = campaignFor(after); after.campaign = campaign;
  after.director.chapterId=campaign.chapterId;
  if (campaign.status !== 'active') return after;
  campaign.events = [];
  if (Number(after.player?.hp) <= 0) { finish(after, campaign, 'fallen'); return after; }
  const chapter = current(campaign), step = pending(campaign);
  if (!step) return after;
  const witnessed = evidence(before, after, narration, step);
  const newQuest = step.quest && done(after, step.quest);
  let path = '主线';
  let fulfilled = step.encounter ? step.check(before, after, narration) :
    (witnessed || newQuest) && step.check(before, after, narration);
  if (step.ending) {
    const id = eligibleEnding(before, after, narration, input);
    if (id) { campaign.completed.push(step.id); finish(after, campaign, id); }
    return after;
  }
  if (!fulfilled && witnessed && step.alternative?.(before, after, narration)) {
    fulfilled = true; path = step.alternativeName;
    if (step.reward && count(after, step.reward) === 0) {
      after.inventory ||= { items: {} }; after.inventory.items ||= {};
      after.inventory.items[step.reward] = 1;
      after.codex ||= {}; after.codex.items ||= [];
      if (!after.codex.items.includes(step.reward)) after.codex.items.push(step.reward);
      campaign.events.push(`路线实物入账 · ${step.reward} × 1（${path}的已结算代价）`);
    }
  }
  if (fulfilled) {
    campaign.completed.push(step.id);
    campaign.routeHistory.push({ chapterId: chapter.id, path });
    campaign.routeHistory = campaign.routeHistory.slice(-40);
    campaign.events.push(`目标达成 · ${step.goal}（${path}）`);
    if (!pending(campaign)) {
      const next = CAMPAIGN_CHAPTERS[CAMPAIGN_CHAPTERS.indexOf(chapter) + 1];
      if (next) { campaign.chapterId = next.id; after.director.chapterTurns=0;after.director.turnsSinceChapterProgress=0;after.director.pacePressure=0;campaign.events.push(`下一篇 · ${next.title}：${next.steps[0].goal}`); }
    }
  }
  const active = current(campaign);
  after.story ||= {}; after.story.act = active.act;after.story.scene=active.id;
  after.director ||= {}; after.director.chapterId = active.id; after.director.sceneGoal = pending(campaign)?.goal || active.why;
  campaign.events = campaign.events.slice(-4);
  return after;
}
