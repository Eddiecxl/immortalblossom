import { migrateGameState } from './game-state.js';
import {removeReplayedExposition,commitSceneEvidence,continuityContext} from './scene-continuity.js';
import {campaignContext,advanceCampaign} from './campaign.js';
import { parseNarration, PROVIDERS } from './ai-client.js';
import {
  buildRepairMessages, commitValidatedWorldTurn, createSceneContract, validateAiWorldTurn
} from './director.js';
import {
  applyMemoryCandidates, registerEntityCandidates, selectRelevantMemory, updateChapterSummary
} from './memory.js';
import { applyCommittedDiscoveries, chapterSummaryFromVisibleBlocks, storyVisibleTextFor, hasVisibleFactEvidence } from './discovery.js';
import { answerSystemQuery } from './turn-router.js';
import { LOCATIONS, NPCS, REALMS } from './game-data.js';
import { derivedPlayerStats } from './equipment.js';
import { modelGenerationBudget, modelNarrativeProfile, throwIfCancelled } from './ai-policy.js';
import { commitJourneyWorld, journeyContext, restoreJourneyContinuity } from './journey-world.js';
import { LOCAL_ONLINE_PROFILE } from './local-online-profile.js';
import { actionContract, initializeOpening, resolveActionEffects, commitPlayerAction, commitCastObservations, applyWish, planWish } from './play-contract.js';
import { isPlayerDead, selectRpgContext, rpgEventsSince } from './rpg-rules.js';
import {
  normalizePlayerTurnInput, playerTurnIsEmpty, serializePlayerTurn,
  actionInputForTurn, injectExactPlayerSpeech, hasInventedPlayerDialogue
} from './player-turn.js';
import { ensureDeterministicSchedules, estimateTurnMinutes, previewTemporalAdvance, settleScheduledEvents } from './time-engine.js';
import { runAstraWorldTurn } from './astra-turn.js';
import { compileAstraContext } from './astra-context.js';

const WORLD_BIBLE = `你是中文修仙文字游戏《落仙》的唯一叙事作者。本回合绝不能使用本地预写剧情作后备。
规则：
1. 严格遵守场景契约、已知事实、死亡状态、地点和数值上限。
2. 所有 narr 旁白必须使用主角第一人称“我”，绝不能以“你、主角、玩家”称呼主角。只写我亲眼所见、亲耳所闻、身体感受及有依据的推断；不得切换到场外角色的内心、秘密行动或全知视角。
3. 场景契约 playerTurn.speech 是玩家拥有的逐字对白；引擎会把它原样插入正文，你绝不能重复、改写、扩写或另造主角对白。playerTurn.speech 为空时，绝不能替主角说任何一句带引号的对白。playerTurn.action 只是行动意图，不代表成功；必须由引擎/场景契约结算。不得替我新增承诺、选择、立场、感情或未输入的关键动作；玩家未决定的事必须停在可行动的当下。不要列出选项或问“选择哪个”，玩家只自由输入。不得编造我在开篇前炼丹、服药、许诺或修炼等既往经历。
4. 普通世界回合应由 3–6 个短 blocks 构成、约 280–720 个中文字；先回应玩家刚说的话，再让人物和世界自己行动。用具体场面依次展现“玩家发言/行动落地 → 对方直接回应 → 世界继续发生 → 明确结果/新局势”，不得复述、拖延、绕圈、把一个简单问题拆成多轮试探。
5. 世界不围绕玩家暂停。NPC 有自己的目的、期限与生死，组织、追兵、天气、伤势、任务和场外事件都会随着世界时间继续。即使玩家只聊天，也至少要让一个相关人物/危险/期限产生真实变化。允许错过机会、任务失败、NPC 离开或死亡；玩家也没有剧情护甲，合理的致命后果可把气血降至 0 并结束此世。不要为了保护玩家而让敌人永远只逼近、不出手。
6. 灵气用于境界突破；灵力用于功法消耗，两者绝不混用。场景契约 player 内的 qi、spirit 与上限是绝对事实；正文若提到当前数值或充盈/耗尽状态，必须与它完全一致。qi、spirit、hp、effects、progress 等 JSON 字段只用于结构，绝不能出现在玩家可见正文，正文统一写“灵气、灵力、气血”等中文术语。
7. NPC 只能引用其 knownFactIds 中的事实；新角色和地点必须提供稳定 generated: ID、目的与归属地点。
8. 每段已登记 NPC 对白都要在该 dlg 块的 factIds 列出至少一项实际引用的 knownFactIds；日常对白可引用其 fact:authored:...:identity 固定身份事实，绝不能空引用。usedFactIdsByActor 同时给出角色汇总，其键优先使用 actors 中的精确 id（兼容 name），不得自创 actor: 前缀。NPC 可在 dlg 对白中用“你”称呼我。
9. 任务只允许按场景契约 activeQuests 操作：questProgress 只能推进本回合开始前已接取任务，completeQuests 必须同回合推进至 target，failQuests 只能失败已接取任务；addQuests 不得与推进、完成或失败同回合发生。
10. 提交章节出口时，effects 必须包含一个合法且具体的地点或任务效果目标；玩家本回合原话必须明确肯定并写出同一个目标。仅有出口标记、空 effects、含糊“继续观察”或拒绝目标都不得跳章。chapter.exits 的 targetLocation 是可用于出口的合法目的地。
11. 每次聚焦一个有因果的场面，但世界必须向前。NPC 的措辞、迟疑和动作体现自己的目标；他们可以主动拒绝、离开、追击、求援、杀人、改变计划，不需要等玩家触发。反转必须承接已见线索和动机，不能凭空刷敌人。旧悬念应尽快兑现成答案、代价或新的局势，不要连续两回合停留在“似乎、也许、正在接近”。玩家未做出的选择不能替他做，但世界本身可以因为时间、他人行动或失败条件继续发展。记忆只记正文已出现的事实，既有事实不重复写入。\n11A. 玩家只说话且提出明确问题时，当前被点名或最合理的在场 NPC 必须在首个有效回应中直接回答问题；“你是谁/我是谁/这里是哪/发生什么”等基础问题优先使用已登记身份、地点与已知事实，不得用“我听见了”“你是在问我吗”之类空话拖延，也不得编造未知信息。
12. 物品归属绝对遵守场景契约：只有 player.equipment 和 player.carriedItems 的物品可写为“我手中/我携带”；actors 的 carriedItems 属于对应 NPC，正文未发生交接就不得换手。人物关系、相识状态与称谓必须服从契约事实，熟人不得无故被写成陌生人。
13. effects.hp、qi、spirit、gold 均为本回合的有正负号变化量，绝不能回传总属性值。气血允许降到 0；若危险、战斗或伤势逻辑上足以致命，不得强行留 1 点气血。effects.sceneLabel 可填写准确子场景；它须归属当前或新抵达的大地点，格式为“主地点·小场景”，以便所有地点 UI 同步。
14. 场景契约 temporal 是 Game Engine 已经算好的时间结果。elapsedMinutes 必须视为确定事实；dueEvents 中的事件必须在本回合结束前兑现。若写明某人已抵达，绝不能继续描述为“还在接近/仍在赶来”。AI 不得自行冻结、倒退或重算时间。
只输出一个严格 JSON 对象，不要代码围栏。世界回合格式：
{"blocks":[{"type":"narr","text":"旁白"},{"type":"dlg","name":"角色名","text":"对白","factIds":[]}],"effects":{"hp":0,"qi":0,"spirit":0,"gold":0,"sceneLabel":"主地点·小场景","relationships":{},"actorStatus":{},"addItems":{},"addQuests":[],"location":"地点名"},"progress":{"advanced":["scene:进展ID"],"consequences":["后果"],"openLoops":["loop:悬念ID"],"resolvedLoops":[],"dangerClocks":{}},"memory":{"facts":[{"subjectId":"world:主题","predicate":"事实关系","object":"事实内容","confidence":1}],"entities":[],"chapterSummary":"可选章节摘要"},"usedFactIdsByActor":{},"timeCost":"instant|brief|scene|long"}`;

const cleanText = (value, max = 2_000) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const onlineStateMode = (source) => source?.mode === 'v13' ? 'v13' : 'ai';
const defaultId = () => globalThis.crypto?.randomUUID?.() || `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const importantMoment = (input) => /战斗|交手|杀|重伤|救命|告白|喜欢|亲吻|诀别|真相|身世|背叛|揭密|言出法随|筑基|结丹/u.test(input);

function groundOmittedProgress(narration, contract, requestType) {
  if (!narration || typeof narration !== 'object') return narration;
  const visible = storyVisibleTextFor(narration);
  const narrative = (narration.blocks || []).filter(block => block?.type === 'narr')
    .map(block => cleanText(block.text, 12_000)).join('');
  if (!narrative.trim()) return narration;
  const progress = narration.progress && typeof narration.progress === 'object' ? narration.progress : {};
  const suppliedAdvanced = Array.isArray(progress.advanced) ? progress.advanced.filter(Boolean) : [];
  const consequences = Array.isArray(progress.consequences) ? progress.consequences.filter(Boolean) : [];
  if (requestType === 'opening') {
    if (suppliedAdvanced.includes('opening:awakened')) return narration;
    return { ...narration, progress: { ...progress, advanced: ['opening:awakened'], consequences } };
  }
  const advanced = suppliedAdvanced.filter(value => !String(value).startsWith('opening:'));
  if (advanced.length && consequences.length) {
    return advanced.length === suppliedAdvanced.length
      ? narration
      : { ...narration, progress: { ...progress, advanced, consequences } };
  }
  const sentences = narrative.match(/[^。！？!?]+[。！？!?]?/gu)?.map(value => value.trim()).filter(value => value.length >= 8) || [];
  const consequence = sentences.at(-1);
  if (!consequence || !visible.includes(consequence)) return narration;
  const turnId = cleanText(contract?.turnId || 'current', 80).replace(/[^\p{L}\p{N}_-]/gu, '-');
  return {
    ...narration,
    progress: {
      ...progress,
      advanced: advanced.length ? advanced : [`scene:grounded-${turnId}`],
      consequences: consequences.length ? consequences : [consequence]
    }
  };
}

function recentForPrompt(turns, { limit = 4, textLimit = 500, inputLimit = 300 } = {}) {
  return turns.filter((turn) => turn.kind !== 'system').slice(-limit).map((turn) => ({
    id: cleanText(turn.id, 100),
    kind: turn.kind,
    userText: cleanText(turn.userText, inputLimit),
    blocks: Array.isArray(turn.blocks) ? turn.blocks.slice(-4).map((block) => ({
      type: block.type,
      ...(block.name ? { name: cleanText(block.name, 40) } : {}),
      text: cleanText(block.text, textLimit)
    })) : []
  }));
}

function compactQwenContract(contract) {
  return {
    playerTurn: contract.playerTurn,
    因果: contract.rpg,
    时地: [contract.time.day, contract.time.period, contract.location.name],
    我: [contract.player.name, REALMS[contract.player.realm]?.name || contract.player.realm, `${contract.player.hp}/${contract.player.maxHp}`, contract.player.qi, `${contract.player.spirit}/${contract.player.maxSpirit}`,
      Object.fromEntries(Object.entries(contract.player.equipment).filter(([, items]) => items.length)), contract.player.carriedItems.slice(0, 6)],
    目标: cleanText(contract.sceneGoal, 100),
    连续: contract.continuity,
    路线: contract.campaign,
    物: Object.fromEntries(Object.entries(contract.player.inventoryCounts||{}).sort(([a],[b])=>Number(contract.playerInput.includes(b))-Number(contract.playerInput.includes(a))).slice(0,12)),
    命: contract.journey,
    人: [...contract.actors].sort((a, b) =>
      Number(contract.playerInput.includes(b.name) || contract.world.presentActorIds.includes(b.id))
      - Number(contract.playerInput.includes(a.name) || contract.world.presentActorIds.includes(a.id)))
      .slice(0, 3).map((actor) => [actor.name, actor.location, actor.carriedItems || [], actor.knownFactIds.slice(0, 1),
        cleanText(actor.character?.core, 48), actor.character?.relationship, cleanText(actor.character?.lastEvent, 40)]),
    证: contract.facts.slice(-3).map((fact) => [fact.id, cleanText(fact.object, 60)]),
    势: [contract.dangerClocks.slice(0, 2), contract.openLoopIds.slice(-2), contract.legalLocations.slice(0, 3).map((entry) => entry.name)],
    场: [contract.world?.weather, contract.world?.sceneLabel, contract.world?.exits],
    时进: contract.temporal ? [contract.temporal.elapsedMinutes, contract.temporal.afterClock, contract.temporal.remainingPursuitMinutes,
      contract.temporal.dueEvents?.map((event) => cleanText(event.instruction, 90))] : undefined,
    导: contract.directorBeat?.instruction || '',
    章: { level: contract.pace.level, opportunity: contract.pace.opportunityId,
      required: contract.pace.requiredProgressIds, exits: contract.chapter.exits.map(e => [e.progressId, e.targetLocation]) },
    言: contract.systemInvocation?.active ? contract.systemInvocation.consequence : '',
    行动: contract.action ? [contract.action.kind, contract.action.targets, cleanText(contract.action.instruction, 65)] : undefined,
    开局: contract.opening ? [contract.opening.cause, contract.opening.cue] : undefined
  };
}

function compactQwenMemory(packet) {
  const summary = Object.values(packet?.chapterSummaries || {}).join(' ').slice(-320);
  const facts = Array.isArray(packet?.facts) ? packet.facts.slice(0, 6).map((fact) => ({
    id: fact.id, subjectId: fact.subjectId, object: cleanText(fact.object, 80)
  })) : [];
  return { ...(summary ? { summary } : {}), facts };
}

function buildQwenMessages(contract, memoryPacket, recentTurns, requestType, budget) {
  const opening = requestType === 'opening';
  const v13 = (contract.runtimeMode === LOCAL_ONLINE_PROFILE.mode ? LOCAL_ONLINE_PROFILE.prompt : '')
    + '因果中的保命规则及剩余次数是权威；不得编造护体或复活。新获保命须正文明确来源、交接和一次性效果，effects.rpgAssets:[{name,kind:"item|skill|system",trigger:"lethal",charges:1,restoreRatio:0.25,source,evidence}]，evidence逐字取正文。已有物品不可重复授予。交付或消耗背包物品用effects.removeItems:{物品名:正整数}，正文写明实际数量，不可超出持有数。致命伤用hp负变化量可降到0；保命消耗由引擎结算。';
  const system = v13 + '中文修仙游戏。玩家输入是主角第一人称意图。只写当前可见场景，但世界不会等玩家；每回合必须真实向前。玩家明确问在场 NPC 的身份、地点或眼前事实时必须立刻直接回答，不许用空话回避。玩家对白属于 speech：不得改写、重复或另造；action 只是意图，结果服从场景契约。地点、持物、NPC认知、死亡、任务、时间均以契约为准；NPC只能使用已知事实。已发生事实不得重置成梦。人物明确死亡/失踪时，用 effects.actorStatus 记录 dead/missing。言出法随结果100%成立且代价已由引擎处理。通常3–5短段。玩家以说话为主：先让被问的人直接回应，再让NPC/危险/时间按自己的目的继续，必须出现明确结果或局势变化。不能连续写“仍在接近/继续观察/似乎有动静”。允许合理受伤、失败、错过机会和死亡；不替玩家选择下一步。只返严格JSON：{"blocks":[{"type":"narr","text":""},{"type":"dlg","name":"","text":"","factIds":[]}],"reaction":{"result":""},"effects":{"actorStatus":{}},"progress":{"advanced":[],"consequences":[]},"memory":{"facts":[],"entities":[]},"timeCost":"brief"}。effects为变化量，正文不用JSON字段名。只在开篇标记opening:awakened；正常回合接续既定场景，不要重演苏醒或初见。';
  const compact = compactQwenContract(contract);
  const memory = compactQwenMemory(memoryPacket);
  if (memory.summary || memory.facts?.length) compact.忆 = memory;
  const recent = recentForPrompt(recentTurns, {
    limit: Math.max(1, Number(budget.maxRecentTurns || 2)), textLimit: 220, inputLimit: 160
  });
  if (recent.length) compact.近 = recent;
  // Keep the last visible response even when optional history is trimmed.
  const lastTurn = recentTurns.filter(turn=>turn.kind !== 'system').at(-1);
  if (lastTurn) compact.承接 = (lastTurn.blocks||[]).filter(b=>!b.engineOwnedPlayerSpeech)
    .slice(-2).map(b=>({type:b.type,name:b.name,text:cleanText(b.text,140)}));
  if (contract.action?.kind === 'wish') compact.章 = { level: 'gentle', opportunity: '', required: [], exits: [] };
  compact.格式 = '只返 JSON，所有键必须加双引号。';
  compact.证 = contract.facts.filter(f => contract.actors.some(a => a.knownFactIds[0] === f.id)).slice(0, 3).map(f => [f.id, cleanText(f.object, 32)]);
  compact.导 = cleanText(contract.directorBeat?.instruction, 45);
  if (contract.feedback?.some(v => v.includes('重复'))) compact.导 = '禁止复述上轮。先直接回应玩家，再兑现一个旧悬念或让NPC/危险产生不可逆的新变化。';
  compact.命 = contract.journey ? { ...contract.journey } : undefined;
  if (compact.命) delete compact.命.规;
  const content = () => JSON.stringify(compact) + '\n行=' + contract.playerInput + (opening ? '\n开篇：按本世处境苏醒，停在玩家首次行动前，林小满可自然出现。' : '');
  const size = () => system.length + content().length;
  if (compact.命) {
    while (size() > budget.maxPromptChars && compact.命.忆?.length > 1) compact.命.忆.pop();
  }
  // Drop optional suggestions/redundant facts before asking the player to
  // shorten an ordinary action. Never truncate the input or serialized JSON.
  const trims = [
    () => { if (compact.命) delete compact.命.候选; },
    () => { compact.证 = []; },
    () => { if (compact.命) compact.命.近 = []; },
    () => { if (compact.近?.length > 2) compact.近 = compact.近.slice(-2); },
    () => { if (compact.忆?.facts?.length > 4) compact.忆.facts = compact.忆.facts.slice(0, 4); },
    () => { compact.章.exits = compact.章.exits.slice(0, 1); },
    () => { compact.人 = compact.人.slice(0, 2); },
    () => { if (compact.命) compact.命.忆 = compact.命.忆.slice(0, 1); },
    () => { if (compact.忆?.summary) compact.忆.summary = compact.忆.summary.slice(-180); },
    () => { if (compact.命) delete compact.命.牵挂; },
    () => { if (compact.近?.length > 1) compact.近 = compact.近.slice(-1); },
    () => { if (compact.忆?.facts?.length > 2) compact.忆.facts = compact.忆.facts.slice(0, 2); },
    () => { delete compact.格式; compact.势[1] = []; compact.章.required = []; },
    () => { compact.人 = compact.人.slice(0, 1); compact.章.exits = []; },
    () => { if (compact.命) compact.命.忆 = []; },
    () => { if (compact.近) delete compact.近; },
    () => { if (compact.忆?.summary) delete compact.忆.summary; }
  ];
  const promptCap = Math.max(1800, Math.min(5200, Number(budget.maxPromptChars || 3400)));
  for (const trim of trims) { if (size() + 8 <= promptCap) break; trim(); }
  // Preserve player intent and identities; refuse oversized input, never silently truncate it.
  if (size() + 8 > promptCap) throw new Error('本次行动较长，请拆成两个行动发送；输入已保留。');
  return [{ role: 'system', content: system + '只返 JSON。' }, { role: 'user', content: content() }];
}

function compactContract(contract) {
  return {
    turnId: contract.turnId,
    rpg: contract.rpg,
    playerTurn: contract.playerTurn,
    playerInput: contract.playerInput,
    action: contract.action, opening: contract.opening, systemInvocation: contract.systemInvocation,
    journey: contract.journey, directorBeat: contract.directorBeat,
    continuity: contract.continuity, campaign: contract.campaign,
    chapter: contract.chapter,
    sceneGoal: contract.sceneGoal,
    time: contract.time,
    temporal: contract.temporal,
    location: contract.location,
    actors: contract.actors.slice(0, 8).map((actor) => ({
      id: actor.id, name: actor.name, status: actor.status, location: actor.location,
      purpose: actor.purpose, character: actor.character, carriedItems: actor.carriedItems || [], knownFactIds: actor.knownFactIds.slice(0, 12)
    })),
    facts: contract.facts.filter((fact) => contract.actors.some((actor) => actor.knownFactIds.includes(fact.id))).slice(-16),
    dangerClocks: contract.dangerClocks,
    openLoopIds: contract.openLoopIds.slice(-12),
    legalItemIds: contract.legalItemIds,
    legalLocations: contract.legalLocations,
    legalQuestIds: contract.legalQuestIds,
    activeQuests: contract.activeQuests,
    legalRelationshipIds: contract.legalRelationshipIds,
    effectCaps: contract.effectCaps,
    idleLimit: contract.idleLimit,
    consecutiveIdleTurns: contract.consecutiveIdleTurns,
    pace: contract.pace,
    player: contract.player,
    journey: contract.journey,
    questProtocol: '仅可对 activeQuests 中本回合开始已有任务使用 questProgress；completeQuests 必须同回合推进至 target，failQuests 仅可作用于已接取任务；不得在 addQuests 同回合推进、完成或失败。'
  };
}

function buildWorldMessages(contract, memoryPacket, recentTurns, requestType, profile, importance = 'normal') {
  if (profile.compactContext) {
    const budget = modelGenerationBudget('groq', 'qwen/qwen3.8-27b', requestType === 'opening' ? 'world' : requestType, importance);
    return buildQwenMessages(contract, memoryPacket, recentTurns, requestType, budget);
  }
  const openingRule = requestType === 'opening'
    ? '这是开篇：依据本世 opening 的不同处境从苏醒写起，兼容第一或第三人称，危机或平静由种子决定。停在玩家第一个行动前。progress.advanced 包含 "opening:awakened"。'
    : '这是普通世界行动：逐字尊重场景契约内的 playerInput，并让它产生真实后果。';
  const { actors, facts, playerInput, ...core } = compactContract(contract);
  const recent = recentForPrompt(recentTurns);
  while (JSON.stringify(recent).length > 3500 && recent.length > 1) recent.shift();
  // Keep JSON sections complete: substring truncation used to cut off memory and rules mid-object.
  const messages = [
    { role: 'system', content: `${contract.runtimeMode === LOCAL_ONLINE_PROFILE.mode ? `${LOCAL_ONLINE_PROFILE.prompt}\n` : ''}${WORLD_BIBLE}\n${openingRule}` },
    { role: 'system', content: `场景契约：${JSON.stringify(core)}` },
    { role: 'system', content: `在场人物及其可引用事实：${JSON.stringify({ actors, facts })}` },
    { role: 'system', content: `相关长期记忆：${JSON.stringify(memoryPacket)}` },
    { role: 'user', content: `最近世界回合：${JSON.stringify(recent)}\n本次玩家原话：${playerInput}\n写出一个完整的当下场面，旁白约260–500字，遵守当前时段，不提前替我选下一步。${requestType === 'opening' ? '开篇的 progress.advanced 必须为 ["opening:awakened"]。' : 'progress.advanced 至少一个以 discovery:、scene:、quest: 或 danger: 开头的字符串；progress.consequences 至少一个本次行动实际造成的后果；memory.facts 记录1–3条正文中逐字可见的新证据，object 直接摘抄正文。'}无变化字段用空对象或空数组。只输出严格 JSON，使用英文键名 blocks、effects、progress、memory、timeCost，不可翻译键名。` }
  ];
  if (messages.some((message) => message.content.length > 5800)) throw new Error('本回合上下文过大，请缩短输入后重试。');
  return messages;
}

function narrationFrom(raw, requestType) {
  return parseNarration(raw, requestType === 'system' ? 'system' : 'world');
}

function systemBlocksFromRaw(raw, state) {
  try {
    const parsed = narrationFrom(raw, 'system');
    if (Array.isArray(parsed?.blocks) && parsed.blocks.some(block => cleanText(block?.text, 2000))) return parsed.blocks;
  } catch {}
  let message = '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    try {
      const decoded = JSON.parse(trimmed);
      message = cleanText(decoded?.text || decoded?.message || decoded?.content || '', 1200);
    } catch {
      message = cleanText(trimmed.replace(/^\s*```(?:json)?/iu, '').replace(/```\s*$/u, ''), 1200);
    }
  } else if (raw && typeof raw === 'object') {
    message = cleanText(raw.text || raw.message || raw.content || '', 1200);
  }
  if (message && !/^\s*[\[{]/u.test(message)) return [{ type: 'sys', text: message }];
  const last = cleanText(state?.journeyWorld?.lastAction?.result || '', 180);
  const location = cleanText(state?.story?.location || '当前地点', 80);
  const suffix = last ? `上一回合已确认：${last}` : '';
  return [{
    type: 'sys',
    text: `我在，宿主。刚才那次 AI 回答格式不合规，我没有把坏数据丢给你。你现在仍在${location}，外界时间保持冻结。${suffix}`
  }];
}

function normalizeQwenEffectDeltas(contract, narration) {
  if (!narration?.effects || typeof narration.effects !== 'object') return narration;
  const rawHp = Number(narration.effects.hp);
  const currentHp = Number(contract?.player?.hp);
  const maxHp = Number(contract?.player?.maxHp);
  // The compact prompt formerly invited Qwen to echo the header's 100/100 as
  // `effects.hp: 100`.  That value is a total, not a +100 heal.  Convert only
  // values that can be unambiguously represented as a legal signed delta.
  if (!Number.isFinite(rawHp) || !Number.isFinite(currentHp) || !Number.isFinite(maxHp)
    || rawHp <= 40 || rawHp > maxHp) return narration;
  const delta = rawHp - currentHp;
  if (delta < -80 || delta > 40) return narration;
  return { ...narration, effects: { ...narration.effects, hp: delta } };
}

export function buildSystemCompanionMessages(source, input) {
  const state = migrateGameState(source, onlineStateMode(source));
  if (state.astraWorld) {
    const packet = compileAstraContext(state, input);
    return [
      { role: 'system', content: '你是与宿主一起穿越的伴行系统。只根据 Engine 世界事实直接回答宿主；不知道的秘密明确说不知道。系统对话冻结外界时间，不改变人物、任务、地点或物品。保持自然、简短、有性格。只返回严格 JSON：{"blocks":[{"type":"sys","text":"..."}]}。' },
      { role: 'user', content: `此刻世界事实：${JSON.stringify(packet)}\n近期同行对话：${JSON.stringify((state.systemCompanion?.dialogueMemory || []).slice(-4))}\n宿主：${cleanText(input, 180)}` }
    ];
  }
  const companion = state.systemCompanion || {};
  const memory = Array.isArray(companion.dialogueMemory) ? companion.dialogueMemory.slice(-4) : [];
  const snapshot = {
    我: [state.player.name, state.story.location, state.story.period, state.player.realm],
    时: [state.story.day, state.story.minuteOfDay, state.story.period, state.worldState?.weather || '未知'],
    危: Object.entries(state.director?.dangerClocks || {}).slice(0, 4),
    在场: (state.worldState?.presentActorIds || []).slice(0, 6),
    系统: [companion.bond || 0, companion.charges || 0, companion.cooldownTurns || 0, companion.backlash || 0],
    旧话: memory.map((entry) => [entry.role === 'system' ? '系' : '我', cleanText(entry.text, 90)]),
    刚才: cleanText(state.journeyWorld.lastAction?.result, 90),
    言灵: state.journeyWorld.laws?.slice(-1).map(l => [cleanText(l.request, 60), l.cost]),
    状态: [state.player.hp, state.player.spirit, state.player.qi],
    牵挂: state.journeyWorld.threads.filter(t => t.status === 'open').slice(0, 2).map(t => t.title),
    任务: (state.quests?.active || []).slice(0, 3).map(q => [q.id, q.progress, q.target])
  };
  return [
    {
      role: 'system',
      content: '你是与宿主一起穿越的系统，也是他的实时伴行者。回答必须紧扣当前地点、时间、上一回合真实结果、伤势、人物和正在倒数的危险；别复述问题，别客服腔，别绕圈。可以嘴欠、调侃，但危险时要短、准、直接。系统聊天本身冻结外界时间，不修改NPC、地点、事件或数值；但你清楚刚刚现实里已经发生了什么。言出法随必定实现且代价由Engine结算。只返 {"blocks":[{"type":"sys","text":""}]}，60–140字。'
    },
    { role: 'user', content: `状态=${JSON.stringify(snapshot)}\n宿主：${cleanText(input, 180)}` }
  ];
}

function rememberCompanionDialogue(state, playerText, blocks) {
  const entries = [
    ...(state.systemCompanion?.dialogueMemory || []),
    { role: 'player', text: cleanText(playerText, 180) },
    ...blocks.map((block) => ({ role: 'system', text: cleanText(block.text, 260) }))
  ];
  state.systemCompanion.dialogueMemory = entries.slice(-6);
  state.systemCompanion.bond = Math.min(100, Number(state.systemCompanion.bond || 0) + 1);
  return state;
}

function normalizeQwenResourceLanguage(contract, narration) {
  const spiritAfter = Number(contract.player.spirit) + Number(narration?.effects?.spirit || 0);
  const qiAfter = Number(contract.player.qi) + Number(narration?.effects?.qi || 0);
  const hasUsableSpirit = spiritAfter > Number(contract.player.maxSpirit) * 0.25;
  const hasNoQi = qiAfter <= 0;
  if (!hasUsableSpirit && !hasNoQi) return narration;
  let changed = false;
  const blocks = (narration.blocks || []).map((block) => {
    if (block?.type !== 'narr') return block;
    let text = block.text;
    if (hasUsableSpirit) {
      text = text.replace(/(?:误以为|仿佛|似乎)?灵力[^。！？]{0,12}(?:耗尽|枯竭|空空如也)/gu, '灵力仍可周转');
    }
    if (hasNoQi) {
      text = text.replace(/(?:误以为|仿佛|似乎)?灵气[^。！？]{0,12}(?:充盈|充沛|满溢)/gu, '灵气尚未凝聚');
    }
    if (text !== block.text) changed = true;
    return text === block.text ? block : { ...block, text };
  });
  return changed ? { ...narration, blocks } : narration;
}

function normalizeFlexibleNarration(contract, narration) {
  const protagonist = cleanText(contract?.player?.name || '顾长生', 40);
  let introduced = false;
  let changed = false;
  const blocks = (narration.blocks || []).map((block) => {
    if (block?.type !== 'narr' || !block.text.includes('你')) return block;
    const parts = block.text.split(/(“[^”]*”|"[^"]*")/gu);
    const text = parts.map((part, index) => {
      if (index % 2) return part;
      return part.replace(/你们|你/gu, (value) => {
        changed = true;
        if (!introduced) { introduced = true; return value === '你们' ? `${protagonist}一行人` : protagonist; }
        return value === '你们' ? '他们' : '他';
      });
    }).join('');
    return text === block.text ? block : { ...block, text };
  });
  return changed ? { ...narration, blocks } : narration;
}

function restoreOpeningAgency(narration, contract, requestType) {
  if (requestType !== 'opening') return narration;
  const protagonist = cleanText(contract?.player?.name || '顾长生', 40);
  const escaped = protagonist.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const claimedChoice = new RegExp(`^(?:${escaped}|我)(?:随即|当即|立刻|终于|毫不犹豫地)?(?:答应|同意|拒绝|决定|选择|承诺|发誓|加入|背叛|爱上|说道|回答|开口|告诉|询问|问道|喊道)`, 'u');
  let changed = false;
  const blocks = (narration.blocks || []).map((block) => {
    if (block?.type !== 'narr') return block;
    const sentences = block.text.match(/[^。！？!?]+[。！？!?]?/gu) || [block.text];
    const text = sentences.map((sentence) => {
      if (!claimedChoice.test(sentence.trim())) return sentence;
      changed = true;
      if (/(?:说道|回答|开口|告诉|询问|问道|喊道)/u.test(sentence)) return `话到嘴边，${protagonist}没有替自己作出回答。`;
      if (/(?:爱上|喜悦|幸福|忠诚|爱慕|憎恨)/u.test(sentence)) return `真正的感受尚未落定，${protagonist}没有替自己作出选择。`;
      return `去留与立场仍悬而未决，${protagonist}尚未付诸行动。`;
    }).join('');
    return text === block.text ? block : { ...block, text };
  });
  return changed ? { ...narration, blocks } : narration;
}

function registerVisibleDialogueBookkeeping(narration, contract) {
  const memory = narration.memory && typeof narration.memory === 'object' ? narration.memory : {};
  const entities = Array.isArray(memory.entities) ? [...memory.entities] : [];
  const knownNames = new Set([
    ...(contract.actors || []).map(actor => actor.name),
    ...entities.map(entity => cleanText(entity?.name, 40))
  ]);
  let changed = false;
  for (const block of narration.blocks || []) {
    const name = cleanText(block?.name, 40);
    if (block?.type !== 'dlg' || !name || name === '身份未知' || knownNames.has(name) || Object.hasOwn(NPCS, name)) continue;
    const turn = cleanText(contract?.turnId || 'current', 50).replace(/[^\p{L}\p{N}_-]/gu, '-');
    const safeName = name.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 24);
    entities.push({
      id: `generated:npc:auto-${turn}-${safeName}`.slice(0, 80), kind: 'npc', name,
      location: contract.location.name, purpose: '在当前场景现身并参与对话，真实身份与目的尚待查明', traits: ['身份待查']
    });
    knownNames.add(name);
    changed = true;
  }
  return changed ? { ...narration, memory: { ...memory, entities } } : narration;
}

function failure(error, input, transactionId, contract, state) {
  return {
    ok: false,
    error: cleanText(error?.message || error || 'AI 回合失败。', 600),
    code: error?.code || 'AI_TURN_FAILED',
    ...(error?.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
    retry: { input, transactionId, contract },
    ...(state ? { state } : {})
  };
}

function repetitionScore(text) {
  const normalized = cleanText(text, 20_000).replace(/\s+/g, '');
  if (normalized.length < 4) return 0;
  const grams = [];
  for (let index = 0; index < normalized.length - 2; index += 1) grams.push(normalized.slice(index, index + 3));
  return Number((1 - new Set(grams).size / Math.max(1, grams.length)).toFixed(3));
}

export function createAiTurnRunner({ aiClient, transcriptStore, stateStore, now = () => Date.now(), idFactory = defaultId } = {}) {
  if (!aiClient?.narrate) throw new Error('AI 客户端不可用。');
  if (!transcriptStore?.recentTurns || !transcriptStore?.appendTurn) throw new Error('游戏记录存储不可用。');
  if (stateStore && !stateStore.saveAuto) throw new Error('AI 原子存档组件不可用。');

  async function executeWorld({ state: source, input, settings = {}, transactionId, signal, onProgress = () => {} }, requestType) {
    if (requestType === 'world') return runAstraWorldTurn({ source, input, settings, transactionId, signal, onProgress,
      aiClient, transcriptStore, stateStore, now });
    let contract;
    let failureState = source;
    const playerTurn = requestType === 'opening'
      ? { speech: '', action: cleanText(input, 2_000) }
      : normalizePlayerTurnInput(input);
    const cleanInput = requestType === 'opening' ? cleanText(input, 2_000) : serializePlayerTurn(playerTurn);
    const mechanicalInput = requestType === 'opening' ? cleanInput : actionInputForTurn(playerTurn);
    const actionInput = requestType === 'opening'
      ? cleanInput
      : mechanicalInput || (playerTurn.speech ? '说话' : '');
    const sceneInput = requestType === 'opening' ? cleanInput
      : playerTurn.action
        ? [playerTurn.action, playerTurn.speech].filter(Boolean).join('\n')
        : playerTurn.speech;
    const retryInput = typeof input === 'string' ? cleanText(input, 2_000) : cleanInput;
    const txId = cleanText(transactionId || idFactory(), 100);
    try {
      throwIfCancelled(signal);
      const stateMode = onlineStateMode(source);
      let state = migrateGameState(source, stateMode);
      if (state.transactionJournal) {
        if (!stateStore?.recoverPendingTurn) throw new Error('上一回合仍待恢复，请重新读取自动存档。');
        state = await stateStore.recoverPendingTurn(stateMode, state, transcriptStore);
      }
      if (isPlayerDead(state)) return failure(Object.assign(new Error('此世命途已经终止，不能继续世界行动。'), { code: 'PLAYER_DEAD' }), retryInput, txId, undefined, state);
      if (state.campaign?.status === 'complete') throw Object.assign(new Error('此生已落笔，请回到封面另启一世。'),{code:'CAMPAIGN_COMPLETE'});
      state.director.chapterId=state.campaign.chapterId;
      if (requestType === 'opening') state = initializeOpening(state);
      const historyLimit = stateMode === LOCAL_ONLINE_PROFILE.mode ? 4 : 10;
      const history = !state.journeyWorld.beats.length && transcriptStore.allTurns
        ? await transcriptStore.allTurns(state.journeyId)
        : await transcriptStore.recentTurns(state.journeyId, historyLimit);
      const recentTurns = history.slice(-historyLimit);
      state = restoreJourneyContinuity(state, history);
      if(!state.journeyWorld.sceneEvents?.length){const last=history.filter(t=>t.kind!=='system').at(-1);if(last)commitSceneEvidence(state,last);}
      ensureDeterministicSchedules(state);
      const action = actionContract(state, actionInput);
      const elapsedMinutes = requestType === 'opening' ? 0 : estimateTurnMinutes(playerTurn, action);
      const temporal = previewTemporalAdvance(state, elapsedMinutes);
      contract = {
        ...createSceneContract(state, sceneInput, txId),
        playerInput: cleanInput,
        playerTurn: structuredClone(playerTurn),
        journey: journeyContext(state, cleanInput),
        continuity: continuityContext(state),
        campaign: campaignContext(state,cleanInput),
        action,
        systemInvocation: planWish(state, mechanicalInput),
        temporal,
        opening: requestType === 'opening' ? state.journeyWorld.opening : undefined
      };
      if (contract.systemInvocation?.request) {
        const projected = applyWish(structuredClone(state), contract.systemInvocation);
        contract.player = { ...contract.player, ...projected.player, maxSpirit: derivedPlayerStats(projected).maxSpirit };
        contract.rpg = selectRpgContext(projected, cleanInput);
        contract.actors = contract.actors.map(actor => projected.memory.entities[actor.id]?.status === 'alive'
          ? { ...actor, status: 'alive' } : actor);
      }
      const locationId = LOCATIONS[state.story.location]?.id;
      const memoryPacket = selectRelevantMemory(state, {
        chapterId: contract.chapter.id,
        locationId,
        participantIds: contract.actors.map((actor) => actor.id),
        openLoopIds: contract.openLoopIds,
        questIds: state.quests.active.map((quest) => quest.id)
      });
      // Callers outside the game shell may intentionally omit a model.  Keep
      // the historic first-person contract for those calls; the persisted game
      // settings always supply Qwen explicitly after normalization.
      const selectedProfile = modelNarrativeProfile(settings.provider || 'groq', settings.model || '');
      const profile = stateMode === LOCAL_ONLINE_PROFILE.mode
        ? { ...selectedProfile, perspective: 'flexible', compactContext: true, maxAttempts: 1 }
        : selectedProfile;
      const validationOptions = { narrativePerspective: profile.perspective, validationMode: 'assisted', elapsedMinutes };
      const importance = importantMoment(cleanInput) ? 'important' : 'normal';
      const deterministicDeath = contract.systemInvocation?.selfDeath === true;
      let messages = deterministicDeath ? [] : buildWorldMessages(contract, memoryPacket, recentTurns, requestType, profile, importance);
      let narration;
      let validation;
      let raw = '';

      if (deterministicDeath) {
        const projected = applyWish(structuredClone(state), contract.systemInvocation);
        const result = projected.rpg.ledger.at(-1);
        narration = injectExactPlayerSpeech({
          blocks: [{ type: 'narr', text: result?.kind === 'revival'
            ? `言灵应验，致命的因果截断了我的生命。此前已经获得的${result.name}自动触发；它消耗一次效力，把我从死亡中带回。`
            : '言灵应验，致命的因果落在我自己身上。气血归零，意识随之消散。此世命途在这里终止。' }],
          effects: {}, progress: { advanced: ['scene:law-self-death'], consequences: [result?.text || '言灵已结算。'] },
          memory: { facts: [], entities: [] }, timeCost: 'brief'
        }, playerTurn.speech);
        validation = { ok: true, fingerprint: `engine:${contract.systemInvocation.id}`, normalizedEffects: {} };
      }

      const maxAttempts = deterministicDeath ? 0 : (settings.provider || 'groq') === 'groq' ? 1 : profile.maxAttempts;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        throwIfCancelled(signal);
        onProgress(attempt ? 'repair' : 'generating', attempt ? { errors: validation?.errors, candidate: narration } : {});
        const proxyRequestType = attempt > 0 ? 'repair' : requestType === 'opening' ? 'world' : requestType;
        raw = await aiClient.narrate(settings, { requestType: proxyRequestType, transactionId: txId, messages, signal, importance, protectBudget: true });
        throwIfCancelled(signal);
        onProgress('validating');
        try {
          narration = removeReplayedExposition(narrationFrom(raw, requestType),recentTurns);
          if (requestType !== 'opening') {
            if (hasInventedPlayerDialogue(narration.blocks, playerTurn.speech)) {
              throw new Error('AI 擅自替玩家生成或重复主角对白；本回合拒绝该候选。');
            }
            narration = injectExactPlayerSpeech(narration, playerTurn.speech);
            narration = resolveActionEffects(state, action, narration);
          }
          if (profile.perspective === 'flexible') {
            narration = normalizeFlexibleNarration(contract, narration);
            narration = restoreOpeningAgency(narration, contract, requestType);
            narration = normalizeQwenResourceLanguage(contract, narration);
            narration = registerVisibleDialogueBookkeeping(narration, contract);
            narration = normalizeQwenEffectDeltas(contract, narration);
          }
          if (profile.compactContext) narration = groundOmittedProgress(narration, contract, requestType);
          // Missing reference arrays are optional bookkeeping; they do not
          // grant a character any new knowledge or rewrite their actual words.
          narration.blocks = narration.blocks.map(block => block.type === 'dlg' && !Array.isArray(block.factIds)
            ? { ...block, factIds: [] } : block);
          validation = validateAiWorldTurn(state, contract, narration, recentTurns, validationOptions);
          // Optional bookkeeping must not trigger another generation when the
          // story itself is valid. Never invent substitute text or facts, and
          // never suppress discovery, agency, state, or progression errors.
          if (!validation.ok && validation.errors.length && validation.errors.every(error =>
            /^世界记忆事实 world:.+ 缺少本回合可见正文的直接证据。$/u.test(error))) {
            const visible = storyVisibleTextFor(narration);
            const grounded = { ...narration, memory: { ...narration.memory,
              facts: narration.memory.facts.filter(fact => !fact.subjectId.startsWith('world:') || hasVisibleFactEvidence(fact, visible)) } };
            const checked = validateAiWorldTurn(state, contract, grounded, recentTurns, validationOptions);
            if (checked.ok) { narration = grounded; validation = checked; }
          }
        } catch (error) {
          narration = { blocks: [], raw: cleanText(raw, 12_000) };
          validation = { ok: false, errors: [error.message], fingerprint: '' };
        }
        if (validation.ok) break;
        if (attempt < maxAttempts - 1) {
          messages = [
            ...messages,
            ...buildRepairMessages(contract, narration, validation.errors)
          ];
        }
      }
      if (!validation?.ok) throw Object.assign(new Error(`AI 剧情未通过因果校验（不是网络限流）：${validation?.errors?.join('；') || '未知结构错误'}`), { code: 'AI_NARRATIVE_INVALID' });
      throwIfCancelled(signal);
      onProgress('saving');

      let committed;
      if (deterministicDeath) {
        committed = applyWish(structuredClone(state), contract.systemInvocation);
        const totalMinutes = committed.story.minuteOfDay + elapsedMinutes;
        committed.story.day += Math.floor(totalMinutes / 1440);
        committed.story.minuteOfDay = totalMinutes % 1440;
        const minute = committed.story.minuteOfDay;
        committed.story.period = minute < 360 ? '夜晚' : minute < 600 ? '清晨' : minute < 1020 ? '白昼' : minute < 1200 ? '黄昏' : '夜晚';
        committed.memory.turnCount += 1;
        committed.stats.turns += 1;
        committed.updatedAt = new Date(now()).toISOString();
      } else committed = commitValidatedWorldTurn(state, contract, narration, validationOptions);
      const temporalSettlement = settleScheduledEvents(committed);
      committed = temporalSettlement.state;
      if (temporalSettlement.events.length) {
        const visibleNow = storyVisibleTextFor(narration);
        for (const event of temporalSettlement.events) {
          if (!visibleNow.includes('已经抵达') && !visibleNow.includes('已抵达')) {
            narration.blocks.push({ type: 'narr', text: event.text });
          }
        }
      }
      const visibleText = storyVisibleTextFor(narration);
      const visibleEntityIds = (narration.memory?.entities || [])
        .filter((entity) => visibleText.includes(String(entity?.name || '').trim()))
        .map((entity) => entity.id);
      committed = registerEntityCandidates(committed, narration.memory?.entities || [], txId, { visibleEntityIds });
      committed = applyMemoryCandidates(committed, narration.memory?.facts || [], txId, {
        visibleText,
        visibleSubjectIds: visibleEntityIds,
        movedLocationIds: committed.story.location === state.story.location ? [] : [LOCATIONS[committed.story.location]?.id],
        positiveItems: Object.entries(validation.normalizedEffects?.addItems || {})
          .filter(([, amount]) => Number(amount) > 0).map(([name]) => name),
        acceptedQuestIds: validation.normalizedEffects?.addQuests || []
      });
      committed = applyCommittedDiscoveries(committed, narration);
      committed = commitJourneyWorld(committed, narration, cleanInput);
      committed = commitSceneEvidence(committed,narration);
      if (requestType !== 'opening') {
        committed = commitPlayerAction(committed, action, narration);
        if (playerTurn.speech) {
          committed.journeyWorld.lastSpeech = {
            text: playerTurn.speech,
            turn: Number(committed.memory?.turnCount || 0),
            at: committed.updatedAt || ''
          };
        }
      }
      committed = commitCastObservations(committed, narration);
      committed = advanceCampaign(state,committed,narration,cleanInput);
      for(const text of committed.campaign.events) narration.blocks.push({type:'sys',text});
      if (contract.systemInvocation?.request) narration.blocks.push({ type: 'sys', text: `言出法随已结算：${contract.systemInvocation.request}\n${contract.systemInvocation.cost}` });
      for (const event of rpgEventsSince(state, committed)) narration.blocks.push({ type: 'sys', text: event.text });
      if (committed.story.flags?.playerDead) narration.blocks.push({ type: 'sys', text: '【命簿】宿主的气血已经归零。此世不会因为你是玩家而强行续命；命途在这里终止。系统频道仍在，你可以回到标题重新启程。' });
      if (narration.recovered) narration.blocks.push({ type: 'sys', text: '刚才推演的末尾被截断了。我保住了已经写完整的段落，没写完的物品和数值不会乱记。接着说，咱们不白白重烧一次额度。' });
      committed.systemCompanion.dialogueMemory = [...committed.systemCompanion.dialogueMemory,
        ...narration.blocks.filter(b => b.type === 'sys').map(b => ({ role: 'system', text: cleanText(b.text, 260) }))].slice(-6);
      committed = updateChapterSummary(committed, contract.chapter.id, chapterSummaryFromVisibleBlocks(narration));

      const turn = {
        id: txId,
        kind: 'world',
        userText: requestType === 'opening' ? '' : cleanInput,
        speech: requestType === 'opening' ? '' : playerTurn.speech,
        actionText: requestType === 'opening' ? '' : playerTurn.action,
        provider: settings.provider || 'groq',
        model: settings.model || PROVIDERS[settings.provider || 'groq']?.model || '',
        blocks: narration.blocks,
        fingerprint: validation.fingerprint,
        createdAt: new Date(now()).toISOString()
      };
      if (stateStore) {
        try {
          let journaled = migrateGameState({
            ...committed,
            transactionJournal: { type: 'ai-world-turn', turn }
          }, stateMode);
          if (stateStore.saveAutoIfJourney) {
            journaled = await stateStore.saveAutoIfJourney(stateMode, journaled, state.journeyId, state.revision);
          } else journaled = stateStore.saveAuto(stateMode, journaled) || journaled;
          let transcriptAppended = false;
          try {
            await transcriptStore.appendTurn(committed.journeyId, turn);
            transcriptAppended = true;
            committed = migrateGameState({ ...journaled, transactionJournal: null }, stateMode);
            if (stateStore.saveAutoIfJourney) {
              try {
                committed = await stateStore.saveAutoIfJourney(
                  stateMode, committed, state.journeyId, journaled.revision, txId
                );
              } catch (error) {
                if (!transcriptStore.deleteTurn) throw new Error('自动存档冲突后无法补偿本回合记录。');
                await transcriptStore.deleteTurn(committed.journeyId, turn.id);
                const authoritative = stateStore.loadAuto?.(stateMode);
                failureState = authoritative || journaled;
                const journal = authoritative?.transactionJournal;
                if (stateStore.saveAutoIfJourney
                  && authoritative?.journeyId === state.journeyId
                  && journal?.type === 'ai-world-turn'
                  && journal.turn?.id === turn.id) {
                  try {
                    failureState = await stateStore.saveAutoIfJourney(
                      stateMode, migrateGameState({ ...authoritative, transactionJournal: null }, stateMode),
                      authoritative.journeyId, authoritative.revision, turn.id
                    );
                  } catch {
                    failureState = stateStore.loadAuto?.(stateMode) || authoritative;
                  }
                }
                throw error;
              }
            } else committed = stateStore.saveAuto(stateMode, committed) || committed;
          } catch (error) {
            if (transcriptAppended) throw error;
            committed = journaled;
          }
        } catch (error) {
          throw error;
        }
      } else await transcriptStore.appendTurn(committed.journeyId, turn);
      return { ok: true, state: committed, blocks: narration.blocks, turn };
    } catch (error) {
      return failure(error, retryInput, txId, contract, failureState);
    }
  }

  return {
    async runOpening({ state, settings = {}, transactionId, signal, onProgress } = {}) {
      return executeWorld({
        state,
        input: '生成旅程开篇：主角刚在赵府柴房醒来，等待玩家作出第一个行动。',
        settings,
        transactionId, signal, onProgress
      }, 'opening');
    },
    async runWorld({ state, input, settings = {}, transactionId, signal, onProgress } = {}) {
      if (playerTurnIsEmpty(input)) return failure('至少填写“说话”或“行动”其中一项。', '', cleanText(transactionId || idFactory(), 100), undefined);
      return executeWorld({ state, input, settings, transactionId, signal, onProgress }, 'world');
    },
    async runSystem({ state, input, settings = {}, transactionId, signal } = {}) {
      const txId = cleanText(transactionId || idFactory(), 100);
      const cleanInput = cleanText(input, 2_000);
      try {
        throwIfCancelled(signal);
        const stateMode = onlineStateMode(state);
        let nextState = migrateGameState(state, stateMode);
        let answer = nextState.astraWorld ? { handled: false } : answerSystemQuery(nextState, cleanInput);
        if (answer.handled) {
          // Deterministic answers are already grounded. Do not prepend the same
          // catchphrase every time; the persistent left-side system feed should feel live.
          answer = { ...answer, blocks: answer.blocks.map(block => ({ ...block, text: cleanText(block.text, 1200) })) };
        }
        if (!answer.handled) {
          try {
            const raw = await aiClient.narrate(settings, {
              requestType: 'system', transactionId: txId, signal, protectBudget: true,
              messages: buildSystemCompanionMessages(nextState, cleanInput)
            });
            answer = { handled: true, blocks: systemBlocksFromRaw(raw, nextState) };
          } catch (error) {
            // A provider failure is not an authored companion response.
            throw error;
          }
        }
        // Even deterministic panel answers belong to the companion's ongoing
        // relationship memory; the world itself remains entirely untouched.
        nextState = rememberCompanionDialogue(nextState, cleanInput, answer.blocks);
        const turn = {
          id: txId, kind: 'system', userText: cleanInput,
          provider: settings.provider || 'system', model: settings.model || '',
          blocks: answer.blocks, createdAt: new Date(now()).toISOString()
        };
        throwIfCancelled(signal);
        await transcriptStore.appendTurn(nextState.journeyId, turn);
        if (stateStore) nextState = stateStore.saveAuto(stateMode, nextState) || nextState;
        return { ok: true, state: nextState, blocks: answer.blocks, turn };
      } catch (error) {
        return failure(error, cleanInput, txId, undefined);
      }
    },
    async runTrial({ settings = {}, trial = '宗门夜巡' } = {}) {
      const transactionId = cleanText(idFactory(), 100);
      const startedAt = now();
      let raw = '';
      try {
        raw = await aiClient.narrate(settings, {
          requestType: 'trial', transactionId, protectBudget: true,
          messages: [
            {
              role: 'system',
              content: `${WORLD_BIBLE}\n这是完全隔离的模型试炼，不含任何玩家存档。用一小段场景展示逻辑、对白和推进能力。`
            },
            {
              role: 'user',
              content: `试炼题目：${cleanText(trial, 300)}。固定状态：炼气二层、青石镇、黄昏、正在追查失踪药师。`
            }
          ]
        });
        const parsed = narrationFrom(raw, 'trial');
        const progressPassed = Array.isArray(parsed.progress?.advanced) && parsed.progress.advanced.length > 0;
        return {
          output: raw,
          latencyMs: Math.max(0, now() - startedAt),
          parsePassed: true,
          progressPassed,
          repetitionScore: repetitionScore(parsed.blocks.map((block) => block.text).join(''))
        };
      } catch (error) {
        return {
          output: raw,
          error: cleanText(error?.message || error, 600),
          latencyMs: Math.max(0, now() - startedAt),
          parsePassed: false,
          progressPassed: false,
          repetitionScore: repetitionScore(raw)
        };
      }
    }
  };
}
