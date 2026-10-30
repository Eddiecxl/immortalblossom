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
import { compactNarrativePacket } from './astra-narrative-budget.js';
import { sceneAffordances } from './astra-affordances.js';
import { worldPlanPrompt } from './astra-plan-prompt.js';
import { applyWorldPlan, settleWorldRules } from './astra-operations.js';
import { ensureSimulation, captureWorldChanges, propagateCausality, assessIntent, companionNotification, isSpeculativeInput } from './astra-causality.js';
import {NARRATIVE_STYLE_RULES,injuryNotice,realityOutcomeText} from './astra-narrative-style.js';
import {explicitRealityStatement} from './astra-reality-intent.js';
import {selectAstraHandoff} from './astra-handoff.js';
import {beginPlayerSceneTurn,rememberPlayerScene,reconcilePlayerScene,ensureSceneResident} from './astra-player-scene.js';
import {describeSceneImpact,conciseEngineAftermath} from './astra-scene-impact.js';
import {narrateSettledScene} from './astra-settled-scene.js';

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
  const statement = explicitRealityStatement(action) || explicitRealityStatement(speech);
  if (statement) return { type: 'reality', statement };
  if (action && (isSpeculativeInput(action) || /[‘'『《]/u.test(action)))
    return { type: 'speech', minutes: 5 };
  // Referring to, quoting or declining the power does not execute its embedded verbs.
  if (action.includes('言出法随')) return { type: 'speech', minutes: 5 };
  if (/(?:服下|服用|吃下|吞下|使用)/u.test(action)) {
    const item = Object.values(world.items || {}).find(entry => entry.generated && !entry.destroyed
      && entry.ownerId === world.player.id && action.includes(entry.name));
    if (item) return { type: 'use_generated_item', itemId: item.id, minutes: 2 };
  }
  if (/(?:等待|休息|睡|闭关)/u.test(action)) {
    const match = action.match(/(\d+)\s*(分钟|小时|天|日)/u);
    const unit = match?.[2];
    const maximum = unit === '分钟' ? 365*1440 : unit === '小时' ? 365*24 : 365;
    const amount = match ? Math.min(maximum, Math.max(1, Number(match[1]))) : 1;
    return { type: 'wait', minutes: unit === '天' || unit === '日' ? amount * 1440 : unit === '小时' ? amount * 60 : unit === '分钟' ? amount : 60 };
  }
  if (/(?:前往|去往|前去|走向|赶往|旅行|出发|前往)/u.test(action)) {
    if(world.player.travel)throw new Error('当前仍在旅途中；请继续赶路或等待抵达，不能从原地再次出发。');
    const possibilities = world.edges.filter(edge => edge.from === world.player.locationId && !edge.closed && !world.locations[edge.to]?.destroyed);
    const edge = possibilities.find(candidate => action.includes(world.locations[candidate.to]?.name));
    if (edge) return { type: 'travel', destinationId: edge.to, minutes: 5 };
    if (action) throw new Error('目的地不在当前可通行道路上；请先查看地图。');
  }
  if (/(?:接取|接受|承接)/u.test(action)) {
    if(world.player.travel)throw new Error('当前仍在旅途中，不能向出发地或目的地的人接取任务。');
    const quest = Object.values(world.quests || {}).find(entry => entry.state === 'available'
      && (entry.offerLocationId || world.characters[entry.giverId]?.locationId || entry.targetLocationId) === world.player.locationId
      && (action.includes(entry.title) || action.includes(entry.id) || /委托|任务/u.test(action)));
    if (quest) return { type: 'accept_quest', questId: quest.id, minutes: 5 };
  }
  const quest = Object.values(world.quests || {}).find(entry => ['active','mutated'].includes(entry.state)
    && entry.targetLocationId === world.player.locationId
    && questVerbs[entry.templateId?.split(':')[1]]?.test(action));
  if (quest) {if(world.player.travel)throw new Error('当前仍在旅途中，尚不能在任务地点开展行动。');return { type: 'quest_work', questId: quest.id, minutes: 90 };}
  if (/(?:杀死|击杀|刺杀)/u.test(action)) {
    if(world.player.travel)throw new Error('当前仍在旅途中，不能攻击留在出发地或目的地的人物。');
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
  const present = Object.values(world.characters || {}).filter(npc => !world.player.travel && npc.alive && !npc.travel && npc.locationId === world.player.locationId);
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
    // Hearing words is not an appraisal: negation, sarcasm and context belong
    // to the AI's grounded social.observe, which settles relationship once.
  }
  world.history.push({ id: `speech:${world.minute}:${world.history.length}`, type: 'player_speech',
    minute: world.minute, locationId: world.player.locationId, actors: witnesses.map(npc => npc.id),
    summary: `玩家在场说话；${witnesses.length}人听见。`, playerWitnessed: true });
}

export function projectAstraWorld(source, world) {
  const state = structuredClone(source);
  state.astraWorld = world;
  state.player.name = world.player.name;
  const location = world.locations[world.player.locationId];
  state.story.day = Math.floor(world.minute / 1440) + 1;
  state.story.minuteOfDay = world.minute % 1440;
  state.story.period = periodAt(state.story.minuteOfDay);
  state.story.location = world.player.travel ? sceneAffordances(world).locationName : location?.name || state.story.location;
  state.story.flags.playerDead = !world.player.alive || world.terminal?.ended;
  state.player.hp = Math.max(0, Math.floor(world.player.health));
  state.player.maxHp = Math.max(1, Math.floor(world.player.maxHealth));
  state.player.gold = Math.max(0, Math.floor(world.player.wealth));
  const majorRealmLevels = { none: 0, qi_refining: 1, foundation: 10, golden_core: 14,
    nascent_soul: 17, spirit_transformation: 19, void_refining: 20, integration: 21, tribulation: 22 };
  state.player.realm = majorRealmLevels[world.player.cultivation?.realm] ?? state.player.realm;
  state.worldState.sceneLabel = state.story.location;
  state.worldState.presentActorIds = Object.values(world.characters).filter(npc => !world.player.travel && npc.alive && !npc.travel && npc.locationId === world.player.locationId).map(npc => npc.id);
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
    terminalJob: Boolean(error?.terminalJob), status: error?.status,
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
    const previousCausalIds = new Set(Object.keys(state.astraWorld.simulation?.events || {}));
    const action = mechanicalAction(state.astraWorld, turnInput);
    let knownRealityPlan = null;
    if (action.type === 'reality') {
      try { knownRealityPlan = planRealityMutation(state.astraWorld, action.statement); }
      catch { action.minutes = 1; }
    }
    let world, events, narration;
    let engineConversation = false, settledAuthored = false;
    const engineAction=!turnInput.speech&&['wait','travel'].includes(action.type);
    let degradation = null;
    if (knownRealityPlan) {
      const plan = knownRealityPlan;
      world = applyRealityMutation(state.astraWorld, plan);
      beginPlayerSceneTurn(world,turnInput,{turnId:txId});
      captureWorldChanges(state.astraWorld, world, { turnId: txId, action: 'rewrite' });
      ({ world, events } = advanceAstraWorld(world, 1));
      settleWorldRules(world, Object.values(ensureSimulation(world).events).filter(event => !previousCausalIds.has(event.id)));
      const outcome = world.history.find(entry => entry.id === plan.id);
      narration = { blocks: [{ type: 'narr', text: realityOutcomeText(plan,outcome,world) }] };
    } else if(engineAction) {
      const settled=advanceAstraWorld(state.astraWorld,action.minutes,action.type==='travel'
        ? {type:'travel',destinationId:action.destinationId}:{type:'wait'});
      world=settled.world;events=settled.events;
      beginPlayerSceneTurn(world,turnInput,{turnId:txId});
      captureWorldChanges(state.astraWorld,world,{turnId:txId,action:action.type});
      propagateCausality(world);
      settleWorldRules(world,Object.values(ensureSimulation(world).events).filter(event=>!previousCausalIds.has(event.id)));
      const scene=sceneAffordances(world);
      const trip=world.player.travel;
      narration={blocks:[{type:'narr',text:trip
        ? `我沿着通往${world.locations[trip.to]?.name||'目的地'}的道路继续前行；还需${Math.max(1,Math.ceil(trip.arriveAt-world.minute))}分钟。沿途的时辰、人物和局势照常变化。`
        : action.type==='travel'?`我抵达了${scene.locationName||'目的地'}，这段行程已走完。`
        : `我在${scene.locationName||world.locations[world.player.locationId]?.name||'此地'}停留了${action.minutes}分钟。`},
        ...events.filter(e=>e.playerWitnessed&&e.summary).slice(-6).map(e=>({type:'sys',text:e.summary}))]};
    } else {
      const conversation = action.type !== 'reality' && !turnInput.action && turnInput.speech
        ? resolveAstraConversation(state.astraWorld, turnInput.speech, recent) : null;
      const draft = structuredClone(state.astraWorld);
      beginPlayerSceneTurn(draft,turnInput,{turnId:txId});
      ensureSimulation(draft);
      const intentTarget = Object.values(draft.characters).find(npc => !draft.player.travel && npc.alive && !npc.travel
        && npc.locationId === draft.player.locationId && rawInput.includes(npc.name))?.id || conversation?.targetId;
      const intent = action.type==='reality'
        ? {performed:true,modality:'reality',targetId:intentTarget||null,risk:0,warning:''}
        : assessIntent(draft, turnInput, intentTarget);
      draft.simulation.intents[txId] = { ...intent, id: txId, minute: draft.minute };
      if (intent.warning) companionNotification(draft, 'intent:' + txId, intent.warning, txId, 'urgent');
      recordHeardSpeech(draft, turnInput.speech, conversation?.targetId);
      const settled = advanceAstraWorld(draft, action.minutes, action.type === 'travel'
        ? { type: 'travel', destinationId: action.destinationId } : { type: 'speech' });
      world = settled.world;
      events = settled.events;
      if(state.story.flags.seededOpening&&!world.flags.playerScene){
        const resident=ensureSceneResident(world,{turnId:txId});
        if(resident&&turnInput.speech)recordHeardSpeech(world,turnInput.speech,resident.id);
      }
      const beforeAction = structuredClone(world);
      if (action.type === 'use_generated_item') {
        const used = consumeGeneratedItem(world, action.itemId);
        world = used.world;
        events.push(used.event);
      } else settleOrdinaryAction(world, action);
      captureWorldChanges(beforeAction, world, { turnId: txId + ':mechanical', action: action.type });
      propagateCausality(world);
      settleWorldRules(world, Object.values(ensureSimulation(world).events).filter(event => !previousCausalIds.has(event.id)));
      const directed = directAstraScene(world, events, {targetId:conversation?.targetId});
      if (directed.event) events.push(directed.event);
      const projected = projectAstraWorld(state, world);
      const participant={...conversation,presentAtStart:Boolean(conversation?.targetId)};
      const packet = compileAstraContext(projected, turnInput.action || turnInput.speech, recent,{conversation:participant});
      packet.turnStart = {minute:state.astraWorld.minute,locationId:state.astraWorld.player.locationId,
        locationName:state.astraWorld.locations[state.astraWorld.player.locationId]?.name||'',
        travel:structuredClone(state.astraWorld.player.travel||null)};
      packet.narrativeContinuity={sameScene:world.player.locationId===state.astraWorld.player.locationId
        &&Boolean(world.player.travel)===Boolean(state.astraWorld.player.travel),
        recentOpenings:recent.slice(-3).map(t=>(t.blocks||[]).find(b=>b.type==='narr'&&!b.engineOwnedPlayerSpeech)?.text||'').filter(Boolean).map(t=>t.slice(0,80))};
      if ((globalThis.lxNative||globalThis.lxCloud) && typeof globalThis.nativeAction === 'function') {
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
      packet.turnHandoff = directed.handoff;
      packet.recentImpacts=state.astraWorld.flags.recentSceneImpacts||[];
      if(state.astraWorld.flags.lastSceneImpact?.atMinute===state.astraWorld.minute)
        packet.recentImpact=state.astraWorld.flags.lastSceneImpact;
      packet.planMode = action.type === 'reality' ? 'reality' : 'ordinary';
      packet.settledAction = action.type;
      packet.settledItemId = action.itemId || null;
      packet.intent = intent;
      if (conversation) {
        const originalNpc=state.astraWorld.characters[conversation.targetId];
        const firstContact=Boolean(originalNpc)&&!(originalNpc.memories||[]).some(m=>m.source==='player-speech'
          || m.source!=='opening-contact'&&m.summary&&/顾长生|主角|玩家/u.test(m.summary));
        packet.playerTurn.targetId = conversation.targetId;
        packet.conversation = { targetId: conversation.targetId, targetName: conversation.targetName,
          firstContact,
          absentName: conversation.absentName || null, presentAtStart: Boolean(conversation.targetId),
          startMinute: state.astraWorld.minute,
          knownFacts: conversationEvidence(conversation, 8) };
        packet.affordances = sceneAffordances(world,conversation.targetId);
      }
      const visibleEvents = events.filter(event => event.playerWitnessed).slice(-6);
      const authorPacket=compactNarrativePacket(packet);
      const messages = [
        { role: 'system', content: "你正在写一部由玩家扮演主角的修仙小说，每次只写眼下这一小段。让人物认真接住本轮话语，围绕他们眼前的事与自己的心思说话；对白要能自然地当面说出口。玩家的原话由游戏显示，作者不用重复，也不能替主角决定下一步。旁白以我所见所闻为限，人物对白放dlg。\n世界事实由Engine保存。人物生死、在场、记忆、持物、任务和时间以事实包为准，新的变化用worldPlan落账后才可叙述。conversation.targetId是本轮听者，须回应这个新输入；departingNpcs可以在离开前回应最后一句，其他缺席者不能说话。\n输出完整JSON：{\"worldPlan\":{\"operations\":[]},\"blocks\":[{\"type\":\"dlg\",\"name\":\"真实人物名\",\"text\":\"直接对白\"}]}。narr只写动作与所见，sys是系统，禁止effects。不要输出解释JSON的文字。" },
        { role: 'user', content: `世界事实：${JSON.stringify(authorPacket)}\n本回合已结算事件：${JSON.stringify(visibleEvents)}\n玩家输入按 playerTurn.speech 与 playerTurn.action 分开；只说话时绝不当成动作。先理解并回应本轮真实含义：离题、粗俗、玩笑或暧昧也要接住，不能每句话都拉回任务。人物依据自己的性格、关系和认知反应；有真实变化就用worldPlan落账。只有自然相关时承接directorHook，玩家可以另外选择。\n请据此写出当下场景与明确结果，不能杜撰 Engine 结果。` }
      ];
      const planPrompt=worldPlanPrompt(packet.planMode);
      messages[0].content += '\n' + planPrompt;
      messages[0].content += '\n玩家表达困惑（如“？”）时，要帮助他理解所在地点、眼前人物与可行的下一步，不要把困惑当成未知具体事件。affordances 来自当局状态，供自然承接；围绕真实目标商量行动，提出新委托须经 quest.create 落账。';
      messages[0].content = messages[0].content.replace('不生成物品、修行、移动、死亡或任务效果。', '不在文字中直接生成物品、修行、移动、死亡或任务效果；新变化须经 worldPlan。');
      messages[0].content+='\n'+NARRATIVE_STYLE_RULES;
      messages[0].content+='\n顶层另给turnCue，作为本轮最后一拍，格式同单个block：{"type":"dlg","name":"实际人物名","text":"具体需要主角回应的话"}，或{"type":"narr","text":"发生在眼前、尚待主角应对的具体动作"}。它会显示在blocks之后；不要写成系统建议或把主角的动作做完。场景人物不能只评价完就结束，必须把正在发生的事递到主角面前。';
      messages[1].content += '\n写正在发生的互动，按本次反应、对白和真实新局势连贯展开，篇幅由内容决定。旁白提到主角只能用“我”，NPC对白才可以称我为“你”。dlg.text只放该人物直接说的话；神态、动作放narr。recentTurns是记忆证据，不能复制其中的对白。若玩家再次问同一问题，人物可以指出已经说过并说明当前的新变化或自己的下一步，而不是重新介绍或复述原答。回应人物自己的判断和动机，允许偏离seed，不替玩家选择。';
      const baseDraft = structuredClone(world);
      const localName = settings.mode === 'local' ? await localModelName(settings) : '';
      let raw = '';
      let errors = [];
      let wasTruncated = false;
      const attempts = settings.mode === 'local' ? 2 : 3;
      for (let attempt = 0; !narration && attempt < attempts; attempt++) {
        if (signal?.aborted) throw new Error('本回合已取消。');
        onProgress(attempt ? 'repair' : 'generating');
        try {
          const requestMessages = settings.mode === 'local'
            ? buildAstraLocalMessages(packet, visibleEvents, localName, attempt ? errors : [])
            : attempt ? [...messages,
              ...(raw&&!wasTruncated?[{role:'assistant',content:raw.slice(0,10000)}]:[]),
              { role: 'user', content: `上一候选未通过：${errors.join('；')}。只修正这些问题，输出完整JSON。若错在worldPlan字段或证据，保留已经合格的场面和人物态度，不要另编一段；若错在复读、事实或空泛结尾，只改相关段落。dlg只留直接对白，动作放narr。每个听者最多一条social.observe，evidence仅用玩家本轮原文。` }] : messages;
          raw = await aiClient.narrate(attempt === 2 && settings.mode==='hybrid-assist' ? { ...settings, forceCloudAssist: true } : settings,
            { requestType: attempt ? 'repair' : 'world', transactionId: `${txId}:narrative:${attempt}`,
              messages: requestMessages,
              ...(action.type==='reality'||wasTruncated?{maxTokens:1500}:{}),
              signal, protectBudget: true });
        } catch (error) {
          if (['AI_INVALID_JSON','AI_OUTPUT_TRUNCATED'].includes(error?.code)) {
            wasTruncated ||= error.code==='AI_OUTPUT_TRUNCATED';
            errors=['上一回复未形成完整JSON。缩短旁白，保留完整worldPlan和blocks并闭合全部括号；不返回半个操作。'];
            continue;
          }
          if (error?.status || /^AI_(?:RATE|TOKEN|INPUT|AUTH|QUOTA|NOT_CONFIGURED|MODEL|NETWORK|TIMEOUT|CANCELLED|BUSY)/u.test(error?.code||'')) throw error;
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
          if (action.type === 'reality' && (!parsed.worldPlan?.operations?.length
            || parsed.worldPlan.operations.some(op=>op.type==='concept.defer')))
            throw new Error('这次是明确言出法随，必须把整个指令转成可执行的操作；不能只记概念或只做一部分。用实体、关系、物品效果与规则表达完整结果。');
          if (parsed.worldPlan) {
            const applied = applyWorldPlan(baseDraft, parsed.worldPlan, { turnId: txId,
              mode: action.type === 'reality' ? 'reality' : 'ordinary', input: turnInput,
              realityStatement:action.statement,
              conversationTargetId: conversation?.targetId,
              settledAction: action.type, settledItemId: action.itemId, enforceScope: true });
            candidateWorld = applied.world;
            settleWorldRules(candidateWorld, applied.events);
            propagateCausality(candidateWorld);
          }
        } catch (error) { errors = [clean(error.message, 240)]; continue; }
        reconcilePlayerScene(candidateWorld);
        // Semantic/compound movement uses this same author candidate, unlike
        // the known-law aftermath pass. Establish the real arrival cast before
        // validating its prose, still only on this uncommitted candidate.
        const candidateArrived=!candidateWorld.player.travel&&(baseDraft.player.locationId!==candidateWorld.player.locationId||baseDraft.player.travel);
        const arrivalResident=state.story.flags.seededOpening&&candidateArrived
          ?ensureSceneResident(candidateWorld,{arrival:true,turnId:txId}):null;
        const candidatePacket = compileAstraContext(projectAstraWorld(state, candidateWorld), turnInput.action || turnInput.speech, recent,{conversation:packet.conversation});
        candidatePacket.playerTurn = packet.playerTurn;
        candidatePacket.conversation = packet.conversation;
        candidatePacket.narrativeContinuity=packet.narrativeContinuity;
        candidatePacket.turnHandoff=selectAstraHandoff(candidateWorld,{events,targetId:conversation?.targetId});
        candidatePacket.planMode = packet.planMode;
        candidatePacket.realityApplied = action.type === 'reality'
          && parsed.worldPlan?.operations?.some(operation => operation.type !== 'concept.defer');
        const checked = validateAstraNarration(candidateWorld, parsed.blocks, candidatePacket);
        const answered = validateAstraConversation(checked.blocks, conversation, recent);
        if (checked.ok && answered.ok) { world = candidateWorld; narration = { blocks: checked.blocks }; break; }
        errors = [...checked.errors.map(error => error.message), ...answered.errors];
        if(arrivalResident)errors.unshift(`候选抵达事实：${candidateWorld.locations[candidateWorld.player.locationId].name}近旁真实在场的是${arrivalResident.name}（${arrivalResident.id}，${arrivalResident.occupation||'当地居民'}）。此人属于候选抵达现场；保留原完整worldPlan并修正现场正文，不能重复执行动作。`);
      }
      if (!narration && settings.mode==='local' && conversation?.targetId && action.type !== 'reality') {
        const fallback = fallbackAstraConversation(state.astraWorld, conversation);
        const checked = fallback && validateAstraNarration(world, fallback.blocks, { ...packet, recentTurns: [] });
        if (checked?.ok) { narration = { blocks: checked.blocks }; engineConversation = true;
          degradation = { degraded: true, code: 'AI_GROUNDED_RECOVERY', reasons: errors.slice(0,3) };
          narration.blocks.push({ type:'sys',text:'叙事 AI 本轮未能给出有效回复。系统依据命簿作了有限回应；没有替 AI 创建新委托。可在设置中检查模型，或继续交谈。' }); }
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
      if (packet.departingNpcs.length) {
        const departing=packet.departingNpcs[0];
        companionNotification(world,'departure:'+txId,`${departing.name}往${world.locations[departing.travel.to]?.name||'别处'}去了。要再找${departing.gender==='female'?'她':'此人'}，得沿那个方向走。`,txId);
      }
    }
    propagateCausality(world);
    settleWorldRules(world, []);
    reconcilePlayerScene(world);
    const arrived=!world.player.travel&&(state.astraWorld.player.locationId!==world.player.locationId||state.astraWorld.player.travel);
    if(state.story.flags.seededOpening&&arrived)ensureSceneResident(world,{arrival:true,turnId:txId});
    const impact=describeSceneImpact(state.astraWorld,world,{actionType:action.type,statement:action.statement});
    if(impact)world.flags.lastSceneImpact={...impact,atMinute:world.minute};
    const majorImpact=impact&&impact.kinds.some(kind=>kind!=='health-change');
    if(majorImpact)world.flags.recentSceneImpacts=[...(state.astraWorld.flags.recentSceneImpacts||[]),{...impact,atMinute:world.minute}].slice(-3);
    if((knownRealityPlan||engineAction)&&majorImpact&&settings.renderSettledScenes!==false&&aiClient?.narrate){
      onProgress('generating');
      const authored=await narrateSettledScene({sourceWorld:state.astraWorld,world,state,input:turnInput,settings,
        transactionId:txId,aiClient,recent,signal,impact,handoff:selectAstraHandoff(world,{events}),actionType:action.type});
      world=authored.world;narration={blocks:authored.blocks};settledAuthored=true;
    }else if((knownRealityPlan||engineAction)&&majorImpact){
      const prose=conciseEngineAftermath(state.astraWorld,world,{actionType:action.type});
      if(prose.length)narration={blocks:prose};
    }
    if (world.terminal?.ended)
      companionNotification(world, 'terminal:' + txId, '此世的终局已经落定。命簿保存了造成这一刻的变化。', txId, 'urgent');
    const previousNotices = state.astraWorld.simulation?.notifications || {};
    for (const notice of Object.values(ensureSimulation(world).notifications).filter(row => !previousNotices[row.id]).slice(-8)) {
      if(action.type==='reality'&&/成了。这次改写|改写牵动的因果|世界状态已由/u.test(notice.message))continue;
      narration.blocks.push({ type: 'sys', text: notice.message, sourceId: notice.sourceId });
    }
    const injury=injuryNotice(state.astraWorld,world);
    if(injury&&action.type!=='reality'&&!narration.blocks.some(b=>/受伤|伤得|疼痛|伤口/u.test(b.text)))narration.blocks.push(injury);
    rememberPlayerScene(world,narration.blocks,{turnId:txId,input:turnInput});
    if (signal?.aborted) throw new Error('本回合已取消。');
    narration = injectExactPlayerSpeech(narration, turnInput.speech);
    const committed = projectAstraWorld(state, world);
    committed.systemCompanion ||= {};
    committed.systemCompanion.dialogueMemory = [...(committed.systemCompanion.dialogueMemory || []),
      ...narration.blocks.filter(block => block.type === 'sys').map(block => ({ role: 'system', text: block.text }))].slice(-24);
    committed.updatedAt = new Date(now()).toISOString();
    const summary = summarizeWorldTurn({ before: state.astraWorld, after: world, input: turnInput, action, events });
    const actualProvider = !settledAuthored&&(knownRealityPlan || engineConversation || engineAction) ? 'engine' : aiClient.loadSticky?.(state.journeyId)?.provider || settings.provider || settings.mode || 'groq';
    const turn = { id: txId, kind: 'world', userText: rawInput, speech: turnInput.speech,
      actionText: turnInput.action, provider: actualProvider,
      cloudAssist: settings.mode === 'hybrid-assist' && actualProvider !== 'local' && actualProvider !== 'engine',
      model: settledAuthored?settings.model||'':knownRealityPlan ? 'reality-mutation' : engineAction ? 'world-clock' : engineConversation ? 'grounded-interaction' : settings.model || '',
      ...(degradation ? { diagnostics: degradation } : {}),
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
