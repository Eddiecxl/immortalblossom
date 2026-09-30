import { migrateGameState } from './game-state.js';
import { parseNarration } from './ai-client.js';
import { normalizePlayerTurnInput, serializePlayerTurn, injectExactPlayerSpeech, stripExactPlayerSpeechEcho, hasInventedPlayerDialogue } from './player-turn.js';
import { advanceAstraWorld } from './astra-scheduler.js';
import { compileAstraContext } from './astra-context.js';
import { validateAstraNarration } from './astra-validator.js';
import { applyRealityMutation, planRealityMutation, killNpc } from './astra-reality.js';
import { checkTerminalWorld } from './astra-terminal.js';
import { reconcileQuestArcs, acceptQuestArc } from './astra-quests.js';
import { ITEM_TEMPLATES } from './astra-content.js';
import { summarizeWorldTurn } from './turn-summary.js';
import { directAstraScene } from './astra-director.js';
import { consumeGeneratedItem } from './astra-effects.js';
import { resolveAstraConversation, validateAstraConversation, fallbackAstraConversation, conversationEvidence } from './astra-interaction.js';
import { buildAstraLocalMessages } from './astra-local-prompt.js';
import { WORLD_PLAN_PROMPT } from './astra-plan-prompt.js';
import { applyWorldPlan, settleWorldRules } from './astra-operations.js';
import { ensureSimulation, captureWorldChanges, propagateCausality, assessIntent, companionNotification } from './astra-causality.js';

const clean = (value, max = 2000) => String(value ?? '').replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max);
let localModelNamePromise;
async function localModelName(settings) {
  if (settings?.localModelName) return String(settings.localModelName);
  if (!localModelNamePromise) localModelNamePromise = (async () => {
    if (globalThis.lxNative && typeof globalThis.nativeAction === 'function') {
      try { return String((await globalThis.nativeAction('model-status'))?.active || ''); } catch {}
    }
    try { return globalThis.localStorage?.getItem('luoxian_active_local_model') || ''; } catch { return ''; }
  })();
  return localModelNamePromise;
}
const itemNames = Object.fromEntries(ITEM_TEMPLATES.map(item => [item.id, item.name]));
const periodAt = minute => minute < 360 ? '夜晚' : minute < 600 ? '清晨' : minute < 1020 ? '白昼' : minute < 1200 ? '黄昏' : '夜晚';
const questVerbs = {
  'deliver-medicine': /交付|送药|送去/u, 'find-traveler': /找到|救出|寻回/u,
  'escort-caravan': /护送|送达/u, 'repair-bridge': /修好|修复|修桥/u,
  'collect-debt': /还债|收债|结清/u, 'investigate-fire': /查明|调查/u,
  'gather-herbs': /采集|交付草药/u, 'protect-farm': /守住|保护/u,
  'trace-bandits': /追查|找到山匪/u, 'recover-heirloom': /找回|交还/u,
  'mediate-wedding': /调解|和解/u, 'pass-exam': /通过考试|考中/u,
  'map-ruin': /绘制|绘好地图/u, 'guard-seal': /守住封印|修补封印/u,
  'find-miner': /救出矿工|找到矿工/u, 'test-roots': /检测灵根|测试灵根/u,
  'sect-entry': /通过试选|入宗/u, 'protect-disciple': /保护弟子|救下弟子/u,
  'recover-treasury': /找回宝库|追回财物/u, 'negotiate-truce': /促成停战|缔结和约/u,
  'evacuate-city': /疏散|撤离百姓/u, 'treat-plague': /治疗瘟疫|救治病人/u,
  'expose-traitor': /揭发叛徒|查出叛徒/u, 'track-beast': /追踪灵兽|找到灵兽/u,
  'carry-warning': /送达警报|传达警告/u
};

function mechanicalAction(world, input) {
  const action = clean(input.action, 1800);
  const speech = clean(input.speech, 1200);
  if (/^言出法随\s*[:：]/u.test(speech)) return { type: 'reality', statement: speech };
  if (/^言出法随\s*[:：]/u.test(action)) return { type: 'reality', statement: action };
  if (/(?:服下|服用|吃下|吞下|使用)/u.test(action)) {
    const item = Object.values(world.items || {}).find(entry => entry.generated && !entry.destroyed
      && entry.ownerId === world.player.id && action.includes(entry.name));
    if (item) return { type: 'use_generated_item', itemId: item.id, minutes: 2 };
  }
  if (/(?:等待|休息|睡|闭关)/u.test(action)) {
    const match = action.match(/(\d+)\s*(分钟|小时|天|日)/u);
    const amount = match ? Math.min(365, Math.max(1, Number(match[1]))) : 1;
    const unit = match?.[2];
    return { type: 'wait', minutes: unit === '天' || unit === '日' ? amount * 1440 : unit === '小时' ? amount * 60 : unit === '分钟' ? amount : 60 };
  }
  if (/(?:前往|去往|前去|走向|赶往|旅行|出发|前往)/u.test(action)) {
    const possibilities = world.edges.filter(edge => edge.from === world.player.locationId && !edge.closed && !world.locations[edge.to]?.destroyed);
    const edge = possibilities.find(candidate => action.includes(world.locations[candidate.to]?.name));
    if (edge) return { type: 'travel', destinationId: edge.to, minutes: 5 };
    if (action) throw new Error('目的地不在当前可通行道路上；请先查看地图。');
  }
  if (/(?:接取|接受|承接)/u.test(action)) {
    const quest = Object.values(world.quests || {}).find(entry => entry.state === 'available'
      && entry.targetLocationId === world.player.locationId
      && (action.includes(entry.title) || action.includes(entry.id) || /委托|任务/u.test(action)));
    if (quest) return { type: 'accept_quest', questId: quest.id, minutes: 5 };
  }
  const quest = Object.values(world.quests || {}).find(entry => ['active','mutated'].includes(entry.state)
    && entry.targetLocationId === world.player.locationId
    && questVerbs[entry.templateId?.split(':')[1]]?.test(action));
  if (quest) return { type: 'quest_work', questId: quest.id, minutes: 90 };
  if (/(?:杀死|击杀|刺杀)/u.test(action)) {
    const npc = Object.values(world.characters || {}).find(entry => entry.alive && entry.locationId === world.player.locationId && action.includes(entry.name));
    if (npc) return { type: 'attack', actorId: npc.id, minutes: 15 };
  }
  return { type: 'speech', minutes: input.speech ? 5 : 10 };
}

function settleOrdinaryAction(world, action) {
  if (action.type === 'accept_quest') acceptQuestArc(world, action.questId);
  if (action.type === 'quest_work') {
    const quest = world.quests[action.questId];
    const family = quest.templateId.split(':')[1];
    if (['deliver-medicine','gather-herbs','recover-heirloom'].includes(family)) {
      const itemId = world.player.inventory.find(id => {
        const item = world.items[id];
        return item && !item.destroyed && (family === 'recover-heirloom'
          ? /heirloom|jade|family-letter/u.test(item.templateId)
          : /herb|medicine|pill|elixir/u.test(item.templateId));
      });
      if (!itemId) throw new Error('完成委托所需物品尚不在行囊中。');
      const item = world.items[itemId];
      item.quantity -= 1;
      if (item.quantity <= 0) { item.destroyed = true; world.player.inventory = world.player.inventory.filter(id => id !== itemId); }
      item.transferHistory.push({ minute: world.minute, from: world.player.id, to: quest.giverId || 'quest', source: quest.id });
    }
    reconcileQuestArcs(world, { type: 'complete', questId: quest.id });
  }
  if (action.type === 'attack') {
    const npc = world.characters[action.actorId];
    const hasWeapon = world.player.inventory.some(id => {
      const item = world.items[id]; return item && /knife|sword|saber|bow|blade|spear/u.test(item.templateId);
    });
    const outmatched = npc.cultivation?.realm !== 'none' && world.player.cultivation?.realm === 'none';
    if (!hasWeapon || outmatched) {
      world.player.health = Math.max(0, world.player.health - (outmatched ? 35 : 10));
      world.history.push({ id: `battle:${world.minute}:${npc.id}`, minute: world.minute, type: 'battle',
        actors: ['player', npc.id], locationId: world.player.locationId,
        summary: outmatched ? '凡人袭击修行者失败，对方反击。' : '玩家徒手袭击，对方反击。', playerWitnessed: true });
    } else {
      killNpc(world, npc, `battle:${world.minute}:${npc.id}`);
      world.history.push({ id: `death:${world.minute}:${npc.id}`, minute: world.minute, type: 'death',
        actors: ['player', npc.id], locationId: world.player.locationId, summary: `${npc.name}在袭击中身亡。`, playerWitnessed: true });
    }
  }
  checkTerminalWorld(world);
}

function recordHeardSpeech(world, speech, targetId = null) {
  const spoken = clean(speech, 1200);
  if (!spoken) return;
  const present = Object.values(world.characters || {}).filter(npc => npc.alive && !npc.travel && npc.locationId === world.player.locationId);
  const addressed = present.filter(npc => spoken.includes(npc.name));
  const focus = present.find(npc => npc.id === targetId);
  const witnesses = addressed.length ? addressed : focus
    ? [focus, ...present.filter(npc => npc.id !== focus.id).slice(0, 4)] : present.slice(0, 5);
  for (const npc of witnesses) {
    npc.memories ||= [];
    const id = `memory:heard:${world.minute}:${world.history.length}:${npc.id}`;
    npc.memories.push({ id, minute: world.minute, locationId: world.player.locationId,
      summary: `玩家说过：“${spoken.slice(0, 120)}”`, source: 'player-speech' });
    npc.memories = npc.memories.slice(-40);
    npc.knowledge ||= [];
    npc.knowledge.push(id);
    npc.knowledge = [...new Set(npc.knowledge)].slice(-80);
    npc.relationships ||= {};
    const delta = /谢谢|请|帮忙|帮你|愿意|救/u.test(spoken) ? 1 : /威胁|滚|去死/u.test(spoken) ? -2 : 0;
    if (delta) npc.relationships[world.player.id] = Math.max(-100, Math.min(100, Number(npc.relationships[world.player.id] || 0) + delta));
  }
  world.history.push({ id: `speech:${world.minute}:${world.history.length}`, type: 'player_speech',
    minute: world.minute, locationId: world.player.locationId, actors: witnesses.map(npc => npc.id),
    summary: `玩家在场说话；${witnesses.length}人听见。`, playerWitnessed: true });
}

export function projectAstraWorld(source, world) {
  const state = structuredClone(source);
  state.astraWorld = world;
  const location = world.locations[world.player.locationId];
  state.story.day = Math.floor(world.minute / 1440) + 1;
  state.story.minuteOfDay = world.minute % 1440;
  state.story.period = periodAt(state.story.minuteOfDay);
  state.story.location = location?.name || state.story.location;
  state.story.flags.playerDead = !world.player.alive || world.terminal?.ended;
  state.player.hp = Math.max(0, Math.floor(world.player.health));
  state.player.maxHp = Math.max(1, Math.floor(world.player.maxHealth));
  state.player.gold = Math.max(0, Math.floor(world.player.wealth));
  const majorRealmLevels = { none: 0, qi_refining: 1, foundation: 10, golden_core: 14,
    nascent_soul: 17, spirit_transformation: 19, void_refining: 20, integration: 21, tribulation: 22 };
  state.player.realm = majorRealmLevels[world.player.cultivation?.realm] ?? state.player.realm;
  state.worldState.sceneLabel = state.story.location;
  state.worldState.presentActorIds = Object.values(world.characters).filter(npc => npc.alive && !npc.travel && npc.locationId === world.player.locationId).map(npc => npc.id);
  state.codex.locations = [...new Set([...(state.codex.locations || []), ...(world.flags.visitedLocations || []).map(id => world.locations[id]?.name).filter(Boolean)])].slice(-100);
  state.codex.characters = [...new Set([...(state.codex.characters || []), ...Object.values(world.characters).filter(npc => npc.metPlayer).map(npc => npc.name)])].slice(-100);
  state.inventory.items = {};
  for (const itemId of world.player.inventory || []) {
    const instance = world.items[itemId];
    if (!instance || instance.destroyed || instance.ownerId !== world.player.id) continue;
    const name = instance.name || itemNames[instance.templateId] || instance.templateId;
    state.inventory.items[name] = (state.inventory.items[name] || 0) + Number(instance.quantity || 1);
  }
  state.quests.active = Object.values(world.quests || {}).filter(quest => ['active','mutated'].includes(quest.state))
    .map(quest => ({ id: quest.id, progress: 0, target: 1 }));
  state.stats.turns += 1;
  state.memory.turnCount += 1;
  return state;
}

function asError(error, input, transactionId, state) {
  return { ok: false, error: clean(error?.message || error || '回合失败。', 600),
    code: error?.code || 'ASTRA_TURN_FAILED', retryAfterMs: error?.retryAfterMs || 0,
    retry: { input, transactionId }, state };
}

export async function runAstraWorldTurn({ source, input, settings = {}, transactionId, signal, onProgress = () => {},
  aiClient, transcriptStore, stateStore, now = () => Date.now() }) {
  const turnInput = normalizePlayerTurnInput(input);
  const rawInput = serializePlayerTurn(turnInput);
  const txId = clean(transactionId || globalThis.crypto?.randomUUID?.() || `turn-${Date.now()}`, 100);
  const mode = source?.mode === 'v13' ? 'v13' : 'ai';
  let state = source;
  try {
    if (signal?.aborted) throw new Error('本回合已取消。');
    state = migrateGameState(source, mode);
    if (state.transactionJournal) {
      if (!stateStore?.recoverPendingTurn) throw new Error('上一回合待恢复，请重新读取自动存档。');
      state = await stateStore.recoverPendingTurn(mode, state, transcriptStore);
    }
    if (state.astraWorld.terminal?.ended || !state.astraWorld.player.alive) throw new Error('此世已经终结。');
    const recent = await transcriptStore.recentTurns(state.journeyId, 6);
    const action = mechanicalAction(state.astraWorld, turnInput);
    let knownRealityPlan = null;
    if (action.type === 'reality') {
      try { knownRealityPlan = planRealityMutation(state.astraWorld, action.statement); }
      catch { action.minutes = 1; }
    }
    let world, events, narration;
    let engineConversation = false;
    if (knownRealityPlan) {
      const plan = knownRealityPlan;
      world = applyRealityMutation(state.astraWorld, plan);
      captureWorldChanges(state.astraWorld, world, { turnId: txId, action: 'rewrite' });
      ({ world, events } = advanceAstraWorld(world, 1));
      const outcome = world.history.find(entry => entry.id === plan.id);
      narration = { blocks: [
        { type: 'narr', text: `言出法随落定：${outcome?.summary || plan.request}` },
        { type: 'sys', text: `【因果】改写范围：${plan.type}；实际代价：${outcome?.cost ?? plan.cost}。世界状态已由命簿结算。` }
      ] };
    } else {
      const conversation = action.type !== 'reality' && !turnInput.action && turnInput.speech
        ? resolveAstraConversation(state.astraWorld, turnInput.speech, recent) : null;
      const draft = structuredClone(state.astraWorld);
      ensureSimulation(draft);
      const intentTarget = Object.values(draft.characters).find(npc => npc.alive && !npc.travel
        && npc.locationId === draft.player.locationId && rawInput.includes(npc.name))?.id || conversation?.targetId;
      const intent = assessIntent(draft, turnInput, intentTarget);
      draft.simulation.intents[txId] = { ...intent, id: txId, minute: draft.minute };
      if (intent.warning) companionNotification(draft, 'intent:' + txId, intent.warning, txId, 'urgent');
      recordHeardSpeech(draft, turnInput.speech, conversation?.targetId);
      const settled = advanceAstraWorld(draft, action.minutes, action.type === 'travel'
        ? { type: 'travel', destinationId: action.destinationId } : { type: 'speech' });
      world = settled.world;
      events = settled.events;
      const beforeAction = structuredClone(world);
      if (action.type === 'use_generated_item') {
        const used = consumeGeneratedItem(world, action.itemId);
        world = used.world;
        events.push(used.event);
      } else settleOrdinaryAction(world, action);
      captureWorldChanges(beforeAction, world, { turnId: txId + ':mechanical', action: action.type });
      propagateCausality(world);
      settleWorldRules(world, Object.values(ensureSimulation(world).events).filter(event => event.sourceId === txId + ':mechanical'));
      const directed = directAstraScene(world, events);
      if (directed.event) events.push(directed.event);
      const projected = projectAstraWorld(state, world);
      const packet = compileAstraContext(projected, turnInput.action || turnInput.speech, recent);
      if (globalThis.lxNative && typeof globalThis.nativeAction === 'function') {
        try {
          packet.recalledSummaries = (await globalThis.nativeAction('world-memory-search', {
            worldId: state.journeyId, query: turnInput.action || turnInput.speech
          })).slice(0, 4);
        } catch { packet.recalledSummaries = []; }
      }
      packet.playerTurn = { turnId: txId, mode: turnInput.action && !turnInput.speech ? 'action' : 'speech',
        text: turnInput.speech || turnInput.action, speech: turnInput.speech, action: turnInput.action,
        targetId: null, timestamp: now() };
      packet.directorHook = directed.hook;
      packet.planMode = action.type === 'reality' ? 'reality' : 'ordinary';
      packet.settledAction = action.type;
      packet.intent = intent;
      if (conversation) {
        packet.playerTurn.targetId = conversation.targetId;
        packet.conversation = { targetId: conversation.targetId, targetName: conversation.targetName,
          absentName: conversation.absentName || null, presentAtStart: Boolean(conversation.targetId),
          startMinute: state.astraWorld.minute,
          knownFacts: conversationEvidence(conversation, 8) };
      }
      const visibleEvents = events.filter(event => event.playerWitnessed).slice(-6);
      const messages = [
        { role: 'system', content: '你是《落仙》的叙事作者。Game Engine 世界状态是唯一事实来源。只写主角第一人称所见所闻，不替玩家说话，不生成物品、修行、移动、死亡或任务效果。NPC 只能在场且存活才可发言，只能知道其已知事实。世界事件已经结算，不可倒退。conversation.targetId 是本轮真实在场的说话对象：若非空，必须让该人物针对玩家本轮话语作出有内容的新回应；不知情就明确说不知情，不要复读上一轮或空泛应声。若 absentName 非空，此人缺席，不得让其发言。传闻不等于人在眼前。不要重述上一轮景物或留下“我说，”一类空句。数值只供引擎计算，不作为人物口中的刻度。仅返回严格 JSON：{"blocks":[{"type":"narr","text":"..."},{"type":"dlg","name":"...","text":"..."}]}。不可填 effects。' },
        { role: 'user', content: `世界事实：${JSON.stringify(packet)}\n本回合已结算事件：${JSON.stringify(visibleEvents)}\n玩家输入按 playerTurn.speech 与 playerTurn.action 分开；只说话时绝不当成动作。叙事末段自然承接 directorHook，让玩家看见下一步可做的事；勿强迫选择。\n请据此写出当下场景与明确结果，不能杜撰 Engine 结果。` }
      ];
      messages[0].content += '\n' + WORLD_PLAN_PROMPT;
      messages[0].content = messages[0].content.replace('不生成物品、修行、移动、死亡或任务效果。', '不在文字中直接生成物品、修行、移动、死亡或任务效果；新变化须经 worldPlan。');
      const baseDraft = structuredClone(world);
      const localName = settings.mode === 'local' ? await localModelName(settings) : '';
      let raw = '';
      let errors = [];
      const attempts = settings.mode === 'hybrid-assist' ? 3 : 2;
      for (let attempt = 0; !narration && attempt < attempts; attempt++) {
        if (signal?.aborted) throw new Error('本回合已取消。');
        onProgress(attempt ? 'repair' : 'generating');
        try {
          const requestMessages = settings.mode === 'local'
            ? buildAstraLocalMessages(packet, visibleEvents, localName, attempt ? errors : [])
            : attempt ? [...messages, { role: 'user', content: `上一候选违反世界事实：${errors.join('；')}。仅修正内容，勿改变世界。` }] : messages;
          raw = await aiClient.narrate(attempt === 2 ? { ...settings, forceCloudAssist: true } : settings,
            { requestType: attempt ? 'repair' : 'world', transactionId: txId,
              messages: requestMessages,
              signal, protectBudget: true });
        } catch (error) {
          if (!conversation?.targetId || signal?.aborted) throw error;
          errors = [clean(error?.message || '叙事服务暂不可用', 100)];
          break;
        }
        onProgress('validating');
        let parsed;
        try { parsed = parseNarration(raw, 'world'); }
        catch (error) { errors = [clean(error?.message || '叙事格式无效', 100)]; continue; }
        parsed.blocks = stripExactPlayerSpeechEcho(parsed.blocks, turnInput.speech);
        if (hasInventedPlayerDialogue(parsed.blocks, turnInput.speech)) { errors = ['擅自代玩家说话']; continue; }
        if (Object.keys(parsed.effects || {}).length) { errors = ['模型试图提出 Engine 效果']; continue; }
        let candidateWorld = structuredClone(baseDraft);
        try {
          if (action.type === 'reality' && (!parsed.worldPlan?.operations?.length))
            throw new Error('开放式言灵必须给出有范围的世界提案，或保存未结算的概念。');
          if (parsed.worldPlan) {
            const applied = applyWorldPlan(baseDraft, parsed.worldPlan, { turnId: txId,
              mode: action.type === 'reality' ? 'reality' : 'ordinary', input: turnInput,
              settledAction: action.type, enforceScope: true });
            candidateWorld = applied.world;
            settleWorldRules(candidateWorld, applied.events);
            propagateCausality(candidateWorld);
          }
        } catch (error) { errors = [clean(error.message, 240)]; continue; }
        const candidatePacket = compileAstraContext(projectAstraWorld(state, candidateWorld), turnInput.action || turnInput.speech, recent);
        const checked = validateAstraNarration(candidateWorld, parsed.blocks, candidatePacket);
        const answered = validateAstraConversation(checked.blocks, conversation, recent);
        if (checked.ok && answered.ok) { world = candidateWorld; narration = { blocks: checked.blocks }; break; }
        errors = [...checked.errors.map(error => error.message), ...answered.errors];
      }
      if (!narration && conversation?.targetId && action.type !== 'reality') {
        const fallback = fallbackAstraConversation(state.astraWorld, conversation);
        const checked = fallback && validateAstraNarration(world, fallback.blocks, { ...packet, recentTurns: [] });
        if (checked?.ok) { narration = { blocks: checked.blocks }; engineConversation = true; }
      }
      if (!narration) throw Object.assign(new Error(`叙事没有通过世界校验：${errors.join('；')}`), { code: 'AI_NARRATIVE_INVALID' });
      const continuingNpc = world.characters?.[conversation?.targetId];
      if (continuingNpc?.alive && !continuingNpc.travel && continuingNpc.locationId === world.player.locationId
        && narration.blocks.some(block => block.type === 'dlg' && block.name === conversation.targetName)) {
        world.flags ||= {};
        world.flags.conversation = { npcId: conversation.targetId, locationId: world.player.locationId, minute: world.minute };
      }
      if (directed.event && !narration.blocks.some(block => String(block.text || '').includes(directed.event.summary))) {
        narration.blocks.push({ type: 'sys', text: `【山河动静】${directed.event.summary}` });
      }
    }
    propagateCausality(world);
    settleWorldRules(world, []);
    if (world.player.cultivation.realm !== state.astraWorld.player.cultivation.realm)
      companionNotification(world, 'realm:' + txId, '宿主，你的境界已经改变；相关上限和效果会按现在的规则重新计算。', txId);
    if (world.terminal?.ended)
      companionNotification(world, 'terminal:' + txId, '此世的终局已经落定。命簿保存了造成这一刻的变化。', txId, 'urgent');
    const previousNotices = state.astraWorld.simulation?.notifications || {};
    for (const notice of Object.values(ensureSimulation(world).notifications).filter(row => !previousNotices[row.id]).slice(-8)) {
      narration.blocks.push({ type: 'sys', text: notice.message, sourceId: notice.sourceId });
    }
    if (signal?.aborted) throw new Error('本回合已取消。');
    narration = injectExactPlayerSpeech(narration, turnInput.speech);
    const committed = projectAstraWorld(state, world);
    committed.systemCompanion ||= {};
    committed.systemCompanion.dialogueMemory = [...(committed.systemCompanion.dialogueMemory || []),
      ...narration.blocks.filter(block => block.type === 'sys').map(block => ({ role: 'system', text: block.text }))].slice(-24);
    committed.updatedAt = new Date(now()).toISOString();
    const summary = summarizeWorldTurn({ before: state.astraWorld, after: world, input: turnInput, action, events });
    const actualProvider = knownRealityPlan || engineConversation ? 'engine' : aiClient.loadSticky?.(state.journeyId)?.provider || settings.provider || 'local';
    const turn = { id: txId, kind: 'world', userText: rawInput, speech: turnInput.speech,
      actionText: turnInput.action, provider: actualProvider,
      cloudAssist: settings.mode === 'hybrid-assist' && actualProvider !== 'local' && actualProvider !== 'engine',
      model: knownRealityPlan ? 'reality-mutation' : engineConversation ? 'grounded-interaction' : settings.model || '',
      summary, blocks: narration.blocks, createdAt: committed.updatedAt };
    onProgress('saving');
    if (stateStore) {
      let journaled = migrateGameState({ ...committed, transactionJournal: { type: 'ai-world-turn', turn } }, mode);
      journaled = stateStore.saveAutoIfJourney
        ? await stateStore.saveAutoIfJourney(mode, journaled, state.journeyId, state.revision)
        : stateStore.saveAuto(mode, journaled) || journaled;
      try {
        await transcriptStore.appendTurn(committed.journeyId, turn);
      } catch (error) {
        // Leave the journal to be recovered on the next launch.
        throw error;
      }
      const clear = migrateGameState({ ...journaled, transactionJournal: null }, mode);
      state = stateStore.saveAutoIfJourney
        ? await stateStore.saveAutoIfJourney(mode, clear, state.journeyId, journaled.revision, txId)
        : stateStore.saveAuto(mode, clear) || clear;
    } else {
      await transcriptStore.appendTurn(committed.journeyId, turn);
      state = migrateGameState(committed, mode);
    }
    return { ok: true, state, blocks: narration.blocks, turn };
  } catch (error) { return asError(error, rawInput, txId, state); }
}
