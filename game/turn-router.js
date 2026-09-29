import { REALMS, TECHNIQUES } from './game-data.js';
import { pursuitEta } from './time-engine.js';
import {
  buildCharacterView,
  buildHistoryView,
  buildInventoryView,
  buildMapView,
  buildQuestView
} from './panel-view.js';

const SLASH_COMMANDS = new Map([
  ['/状态', 'status'], ['/面板', 'status'], ['/境界', 'realm'], ['/灵气', 'qi'], ['/灵力', 'spirit'],
  ['/技能', 'technique'], ['/功法', 'technique'], ['/背包', 'inventory'], ['/装备', 'equipment'],
  ['/任务', 'quest'], ['/关系', 'relationship'], ['/地图', 'map'], ['/位置', 'map'], ['/回顾', 'recap'],
  ['/存档', 'save'], ['/帮助', 'help']
]);

const cleanInput = (value) => String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 2_000);

function inferSystemCommand(input) {
  if (/面板|属性|状态|气血|生命/.test(input)) return 'status';
  if (/突破.*(?:还差|需要|多少)|灵气|修炼进度/.test(input)) return 'qi';
  if (/灵力|法力|施法消耗|功法消耗/.test(input)) return 'spirit';
  if (/技能|功法|法术|招式/.test(input) || Object.keys(TECHNIQUES).some((name) => input.includes(name))) return 'technique';
  if (/装备|武器|护甲|配饰/.test(input)) return 'equipment';
  if (/背包|物品|丹药|材料/.test(input)) return 'inventory';
  if (/任务|主线|支线|目标/.test(input)) return 'quest';
  if (/关系|好感|信任|讨厌|喜欢我吗/.test(input)) return 'relationship';
  if (/地图|位置|在哪里|能去哪里|地点/.test(input)) return 'map';
  if (/回顾|回忆|之前发生|经历过|记得什么/.test(input)) return 'recap';
  if (/存档|保存|读档|导出|导入/.test(input)) return 'save';
  if (/帮助|怎么操作|怎么玩|指令/.test(input)) return 'help';
  if (/境界|修为层次|什么阶段/.test(input)) return 'realm';
  return null;
}

function explicitNpcSpeech(input) {
  return /我(?:对|向|问|告诉|回答|喊住).{0,30}(?:说|问|喊|回答|解释|告诉)|我问(?:林小满|李老|苏晚晴|钱多多|慕容雪|赵天霸|陆沉舟|宁无妄)/.test(input);
}

function explicitWorldAction(input) {
  return /(?:继续|立刻|准备|尝试|我要|我去|我用|我施展)?.{0,8}(?:赶路|前往|攻击|防御|追赶|逃跑|调查|搜索|打开|修炼|闭关|施展|购买|交付|救助|跟踪|潜入|战斗|探索)/.test(input);
}

export function classifyTurn({ mode, channel, input }) {
  const normalizedInput = cleanInput(input);
  if (!normalizedInput) return { kind: 'ambiguous', normalizedInput };
  if (channel === 'system') {
    return { kind: 'system', normalizedInput, command: SLASH_COMMANDS.get(normalizedInput) || inferSystemCommand(normalizedInput) || 'query' };
  }
  if (normalizedInput.startsWith('/')) {
    const command = SLASH_COMMANDS.get(normalizedInput);
    return command
      ? { kind: 'system', normalizedInput, command }
      : { kind: 'ambiguous', normalizedInput };
  }
  if (mode === 'local') {
    if (channel === 'choice' && /^[\p{L}\p{N}_.:/\-]+$/u.test(normalizedInput)) {
      return { kind: 'local-choice', normalizedInput };
    }
    const command = inferSystemCommand(normalizedInput);
    return command
      ? { kind: 'system', normalizedInput, command }
      : { kind: 'ambiguous', normalizedInput };
  }
  if (!['ai', 'v13'].includes(mode)) return { kind: 'ambiguous', normalizedInput };
  if (explicitNpcSpeech(normalizedInput)) return { kind: 'world', normalizedInput };

  const command = inferSystemCommand(normalizedInput);
  const worldAction = explicitWorldAction(normalizedInput);
  if (command && worldAction) return { kind: 'ambiguous', normalizedInput };
  if (command) return { kind: 'system', normalizedInput, command };
  return { kind: 'world', normalizedInput };
}

const systemBlock = (text) => ({ type: 'sys', text });

function statusAnswer(state) {
  const view = buildCharacterView(state);
  return systemBlock(`${view.name} · ${view.realm}｜气血 ${view.hp}/${view.maxHp}｜灵气 ${view.qi}/${view.qiNeed}｜灵力 ${view.spirit}/${view.maxSpirit}｜灵石 ${state.player.gold}｜第 ${state.story.day} 日 ${state.story.period}｜${state.story.location}`);
}

function qiAnswer(state) {
  if (state.player.realm >= REALMS.length - 1) return systemBlock('你已抵达渡劫期；灵气将用于稳固道基与应对天劫。');
  const need = REALMS[state.player.realm].need;
  return systemBlock(`当前灵气 ${state.player.qi}/${need}，距离突破至 ${REALMS[state.player.realm + 1].name} 还差 ${Math.max(0, need - state.player.qi)} 点灵气。灵气只用于修炼突破。`);
}

function spiritAnswer(state) {
  const view = buildCharacterView(state);
  const equippedCosts = view.techniques
    .filter((technique) => technique.equipped)
    .map((technique) => `${technique.name} ${technique.cost}点`)
    .join('、');
  return systemBlock(`当前灵力 ${view.spirit}/${view.maxSpirit}。灵力用于施展功法，不计入突破；已装备功法消耗：${equippedCosts || '暂无可施展功法'}。`);
}

function techniqueAnswer(state) {
  const lines = buildCharacterView(state).techniques
    .map((technique) => `《${technique.name}》· ${technique.equipped ? '已装备' : '未装备'} · 灵力 ${technique.cost} · ${technique.description}`);
  return systemBlock(`已掌握功法：${lines.join('；') || '尚未掌握功法'}。`);
}

function inventoryAnswer(state) {
  const lines = buildInventoryView(state)
    .map((entry) => `${entry.name}×${entry.amount}（${entry.description}）`);
  return systemBlock(`背包：${lines.join('；') || '空'}。`);
}

function equipmentAnswer(state) {
  const view = buildCharacterView(state);
  const { slots } = view;
  return systemBlock(`装备：武器 ${slots.hands || '无'}｜护甲 ${slots.body || '无'}｜配饰 ${slots.neck || '无'}｜攻击 ${view.stats.attack}｜防御 ${view.stats.defense}｜灵力上限 ${view.maxSpirit}。装备详情可在背包面板查看。`);
}

function questAnswer(state) {
  const view = buildQuestView(state);
  const lines = [
    ...view.active.map((entry) => `进行中｜${entry.type === 'main' ? '主线' : '支线'}《${entry.title}》${entry.progress}/${entry.target}：${entry.description}`),
    ...view.completed.map((entry) => `已完成｜《${entry.title}》：${entry.description}`),
    ...view.failed.map((entry) => `已失败｜《${entry.title}》：${entry.description}`)
  ];
  return systemBlock(lines.length ? lines.join('；') : '当前没有已记录的任务。');
}

function relationshipAnswer(state, input) {
  const rows = buildCharacterView(state).relationships;
  const mentioned = rows.filter((row) => input?.includes(row.name));
  const visible = mentioned.length ? mentioned : rows;
  return systemBlock(visible.length
    ? `人物关系：${visible.map((row) => `${row.name} ${row.value}`).join('｜')}。正值代表亲近，负值代表戒备或敌意。`
    : '旅途尚未留下可辨认的人物关系记录。');
}

function mapAnswer(state) {
  const rows = buildMapView(state);
  const current = rows.find((row) => row.current) || rows[0];
  return systemBlock(`当前位置：${current?.name || state.story.location}。${current?.description || ''} 已知地点：${rows.map((row) => row.name).join('、')}。查看地图不会推动时间。`);
}

function recapAnswer(state) {
  const history = buildHistoryView(state);
  const lines = [...history.summaries, ...history.facts];
  return systemBlock(lines.length ? `旅程回顾：${lines.join('；')}` : `你从赵府柴房醒来，如今身在${state.story.location}。更完整的经历会随世界回合写入旅程记录。`);
}

function conversationalSystemAnswer(state, input) {
  const text = cleanInput(input);
  if (!text) return null;
  if (/^(?:你好|嗨|hi|hello|在吗|系统在吗)[!！。,.，？?\s]*$/iu.test(text)) {
    return systemBlock(`在。宿主${state.player.name}，这里是与你一同穿越过来的系统频道。外界时间现在冻结着，你想问状态、人物、地点、刚才发生的事，或者单纯聊两句都行。`);
  }
  if (/你是谁|你叫什么|什么系统|你的身份|你到底是谁/u.test(text)) {
    return systemBlock('我是与你绑定并一同来到此世的系统。我的职责是记录真实世界状态、守住你的记忆与规则、执行言出法随，并在系统频道里回答你；我不会替世界里的 NPC 开口，也不会替你作选择。');
  }
  if (/我是谁|我叫什么|我的身份|你认识我吗/u.test(text)) {
    return systemBlock(`你是${state.player.name}。你带着前世记忆穿越到此世，目前身在${state.story.location}；系统、记忆与已经兑现的言出法随记录都会跟着这条旅程继续。`);
  }
  if (/(?:赵天霸|追兵|外面的人).{0,16}(?:多久|什么时候|何时|到|抵达)|(?:还有多久|什么时候到|何时到).{0,16}(?:赵天霸|追兵|外面的人)/u.test(text)) {
    const eta = pursuitEta(state);
    if (eta.status === 'arrived') return systemBlock(`赵天霸已经抵达${state.story.location}附近，不再处于“正在接近”状态。`);
    if (eta.status === 'resolved') return systemBlock('这段追捕已经解除；当前没有赵天霸正在逼近的倒计时。');
    if (eta.status === 'approaching') return systemBlock(`按 Game Engine 的世界时钟，赵天霸预计还有约 ${eta.minutes} 分钟抵达${state.story.location}附近。这个倒计时会随真实行动耗时减少，不由 AI 自己猜。`);
    return systemBlock('目前没有足够的世界状态可以计算赵天霸的抵达时间；系统不会编一个数字。');
  }
  if (/现在几点|什么时间|现在时间|第几天/u.test(text)) {
    const minute = Number(state.story.minuteOfDay || 0);
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    return systemBlock(`现在是第 ${state.story.day} 日 · ${state.story.period} · ${hh}:${mm}。系统频道冻结现实，所以你在这里聊多久都不会让追兵凭空停住或前进。`);
  }
  if (/谁在这里|谁在场|附近有谁|现在有谁/u.test(text)) {
    const ids = Array.isArray(state.worldState?.presentActorIds) ? state.worldState.presentActorIds : [];
    const names = Object.values(state.memory?.entities || {}).filter(e => ids.includes(e.id)).map(e => e.name).filter(Boolean);
    return systemBlock(names.length ? `当前已确认在场人物：${names.join('、')}。` : '当前没有额外确认在场的人物；未确认的人不会因为系统猜测就被当成真的出现。');
  }
  if (/刚才发生|上一回合|刚刚发生|刚才我做了什么/u.test(text)) {
    const last = cleanInput(state.journeyWorld?.lastAction?.result || '');
    return systemBlock(last ? `上一回合已经落定的结果是：${last}` : '目前还没有可以确认的上一回合行动结果。');
  }
  return null;
}

export function answerSystemQuery(state, input) {
  if (!state || typeof state !== 'object') return { handled: false, blocks: [] };
  const classification = classifyTurn({ mode: state.mode, channel: 'system', input });
  const command = classification.command;
  let block;
  if (command === 'status') block = statusAnswer(state);
  else if (command === 'realm' || command === 'qi') block = qiAnswer(state);
  else if (command === 'spirit') block = spiritAnswer(state);
  else if (command === 'technique') block = techniqueAnswer(state);
  else if (command === 'inventory') block = inventoryAnswer(state);
  else if (command === 'equipment') block = equipmentAnswer(state);
  else if (command === 'quest') block = questAnswer(state);
  else if (command === 'relationship') block = relationshipAnswer(state, classification.normalizedInput);
  else if (command === 'map') block = mapAnswer(state);
  else if (command === 'recap') block = recapAnswer(state);
  else if (command === 'save') block = systemBlock('存档管理位于右上角：本地版与 AI 版各自拥有独立自动存档和三个手动槽位；导出旅程会连同完整文字记录一起保存，但不会包含 API 密钥。');
  else if (command === 'help') block = systemBlock('左侧系统栏随时可聊；系统对话本身冻结时间，但每个现实回合都会让世界继续。可问面板、境界、灵气、灵力、技能、背包、装备、任务、关系、地图、回顾与刚才发生的事。');
  else block = conversationalSystemAnswer(state, classification.normalizedInput);
  if (!block) return { handled: false, blocks: [] };
  return { handled: true, blocks: [block] };
}
