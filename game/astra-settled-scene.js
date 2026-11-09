// Author the visible aftermath of an already settled change. This never runs
// the action again, advances time, writes a save, or substitutes canned prose.
import { compileAstraContext } from './astra-context.js';
import { projectAstraWorld } from './astra-turn.js';
import { compactNarrativePacket } from './astra-narrative-budget.js';
import { NARRATIVE_STYLE_RULES,ROLEPLAY_INTERPLAY_RULES } from './astra-narrative-style.js';
import { worldPlanPrompt } from './astra-plan-prompt.js';
import { parseNarration } from './ai-client.js';
import { normalizePlayerTurnInput, stripExactPlayerSpeechEcho, hasInventedPlayerDialogue } from './player-turn.js';
import { applyWorldPlan, settleWorldRules } from './astra-operations.js';
import { propagateCausality } from './astra-causality.js';
import { validateAstraNarration,preparePlayableNarration } from './astra-validator.js';
import {dialogueFrame,DIALOGUE_OPERATIONS}from './astra-dialogue.js';
import { validateAstraConversation } from './astra-interaction.js';
import {SCENE_CHOICES_PROMPT}from './astra-choices.js';

const reactions = new Set(['social.observe', 'commitment.offer', 'commitment.respond', 'quest.create', 'quest.respond','story.propose','story.respond']);
const short = value => String(value || '').replace(/[\u0000-\u001f]/gu, ' ').slice(0, 240);
const present = (world, id) => !world.player.travel && world.characters[id]?.alive
  && !world.characters[id].travel && world.characters[id].locationId === world.player.locationId;
function cancelled(signal) {
  if (signal?.aborted) throw Object.assign(Error('本回合已取消。'), { code: 'AI_CANCELLED' });
}

export async function narrateSettledScene({ sourceWorld, world, state, input, settings = {}, transactionId,
  aiClient, recent = [], signal, impact, handoff, actionType = 'reality' }) {
  cancelled(signal);
  const turnInput = normalizePlayerTurnInput(input), base = structuredClone(world);
  const before = sourceWorld || state.astraWorld;
  const packet = compileAstraContext(projectAstraWorld(state, base), [turnInput.speech,turnInput.action].filter(Boolean).join('\n'), recent);
  const targetId = present(base, handoff?.targetId) ? handoff.targetId : packet.presentNpcs[0]?.id;
  const target = base.characters[targetId];
  const conversation = target ? { targetId, targetName: target.name,
    firstContact: !target.metPlayer && !(target.memories || []).some(row => row.source === 'player-speech'),
    presentAtStart: present(before, targetId) } : null;
  packet.playerTurn = { turnId: transactionId, speech: turnInput.speech, action: turnInput.action,
    text: turnInput.speech || turnInput.action, targetId: targetId || null };
  packet.conversation = conversation;
  packet.turnStart = { minute: before.minute, locationId: before.player.locationId,
    locationName: before.locations[before.player.locationId]?.name || '',
    travel: structuredClone(before.player.travel || null), cultivation: structuredClone(before.player.cultivation),
    health: before.player.health, invincible: Boolean(before.player.invincible) };
  packet.turnHandoff = handoff || null;
  packet.settledAction = actionType;
  packet.planMode = actionType === 'reality' ? 'reality' : 'ordinary';
  packet.realityApplied = actionType === 'reality';
  packet.settledImpact = structuredClone(impact || {});
  packet.recentImpacts=(before.flags?.recentSceneImpacts||[]).slice(-2);
  packet.narrativeContinuity = { sameScene: before.player.locationId === base.player.locationId,
    recentOpenings: recent.slice(-3).map(turn => (turn.blocks || []).find(block => block.type === 'narr'
      && !block.engineOwnedPlayerSpeech)?.text || '').filter(Boolean).map(line => line.slice(0, 80)) };
  const compact=dialogueFrame(packet,{aftermath:true});
  const author = compact||compactNarrativePacket(packet);
  const messages = [
    { role: 'system', content: '你是《落仙》的场景作者。本轮行动已经由Engine执行并支付代价；任务是写它刚发生后的具体场面。' +
      'settledImpact与当前事实表示已经实现的结果，turnStart只供前后对照，不能重放命令、重新施法或再次移动。' +
      '写我亲眼可见的骤变和真实在场人物的反应，人物可以惊疑、询问、保持戒备或顺势回应。停在主角可接话或采取行动之处。' +
      '没有人物就写实际落脚处与可处理的眼前情形，不制造围观者或住户。输出完整JSON，顶层blocks和worldPlan，dlg只有人物直接说的话，narr用第一人称所见。\n' +
      '必须使用此结构：{"blocks":[{"type":"narr","text":"眼下的变化"},{"type":"dlg","name":"真实在场人物名","text":"直接对白"}],"worldPlan":{"operations":[]}}。blocks是平坦的顺序列表，每块都有type与text，不能把narr和dlg写成嵌套字段，不能用speakerId代替name。\n' +
      '另外用顶层turnCue写最后一拍，格式同单个block；例如{"type":"dlg","name":"真实人物名","text":"具体要主角回应的话"}。无人时用narr写可立即应对的现场动作或岔路抉择，而非看清环境的建议。它会接在blocks后显示，别只惊讶完就停住。\n' +
      worldPlanPrompt('ordinary') + '\n本轮仅允许这些后续反应操作：social.observe、commitment.offer、commitment.respond、quest.create、quest.respond。' +
      '没有新增反应用operations:[]；禁止entity.update/create、rule、effect.apply、resource.transfer或concept.defer，原动作已结算，不能重复或扩展。' +
      '社会判断须有本轮输入原文证据且对象真实在场；不强迫好感改变，不凭空赠物或替主角接受任务。\n' + NARRATIVE_STYLE_RULES },
    { role: 'user', content: '结算后的世界事实：' + JSON.stringify(author) + '\n只写当前余波与互动，不把人物私心念成任务介绍，不用结算通告代替场面。' }
  ];
  if(compact)messages[0].content='刚才的行动已经由Engine完成并保存。只写紧接着的余波：实际在场人物现在就回应，或出现我可观察的现场变化，不能只复述动作。2至4个短blocks，顺序可narr/dlg/sys/dlg；sys只在左侧按这一步显示，不替NPC说话。原命令不是要再次执行的动作，不再施法、收费、移动或推进时间。停在玩家可接话或选择之处，不代替玩家答应、躲避或出发。返回完整JSON {"blocks":[{"type":"dlg","name":"真实人物名","text":"人物反应"}],"worldPlan":{"operations":[]}}。'+DIALOGUE_OPERATIONS+'\n仅允许social.observe、commitment、quest、story反应操作，其他效果已执行，不能重复。\n'+ROLEPLAY_INTERPLAY_RULES+'\n最新命簿优先于旧对白：不制造未发生的生死、移动、物品交付或同意。不替主角决定，说话只写人物原话，旁白用我。数值只留在面板。系统回应已发生的上一拍，不提前透露后续。';
  messages[0].content+='\n'+SCENE_CHOICES_PROMPT;
  let raw = '', errors = [], truncated = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    cancelled(signal);
    const requestMessages = attempt ? [...messages,
      ...(raw && !truncated ? [{ role: 'assistant', content: raw.slice(0, 10000) }] : []),
      { role: 'user', content: '上一候选未通过：' + errors.join('；') +
        '。social.observe.evidence必须逐字引用playerTurn.action或speech，不能引用你刚写的旁白；仅想写惊讶反应可不改数值，operations留空。' +
        '。保留有效的场面，只修问题，输出完整JSON。blocks每块必须有type和text，对白另有name，不得嵌套narr/dlg数组。原行动已执行，不重复它；允许operations为空。' }] : messages;
    try {
      raw = await aiClient.narrate(settings, { requestType: attempt ? 'repair' : 'world',
        transactionId: `${transactionId}:settled-scene:${attempt}`, messages: requestMessages,
        maxTokens: truncated ? 1200 : compact ? 850 : 1100, signal, protectBudget: true });
    } catch (error) {
      if (['AI_INVALID_JSON', 'AI_OUTPUT_TRUNCATED', 'json_validate_failed'].includes(error?.code) || error instanceof SyntaxError) {
        truncated = error.code === 'AI_OUTPUT_TRUNCATED';
        errors = ['回复未形成完整JSON，请缩短场面并保留完整blocks和worldPlan。'];
        continue;
      }
      // In particular, quota/network errors keep the caller's pending action.
      throw error;
    }
    cancelled(signal);
    try {
      const parsed = parseNarration(raw, 'world');
      const blocks = stripExactPlayerSpeechEcho(parsed.blocks, turnInput.speech);
      if (hasInventedPlayerDialogue(blocks, turnInput.speech)) throw Error('不能替主角发言。');
      if (Object.keys(parsed.effects || {}).length) throw Error('不能重新提出已经结算的Engine效果。');
      const plan = parsed.worldPlan || { operations: [] };
      if (!Array.isArray(plan.operations) || plan.operations.some(op => !reactions.has(op?.type)))
        throw Error('原动作已经结算，只能提出普通的在场人物、约定或任务反应，不能再次改写或执行动作。');
      const applied = applyWorldPlan(base, plan, { turnId: `${transactionId}:settled-reaction`,
        mode: 'ordinary', input: turnInput, conversationTargetId: handoff?.targetId || targetId,
        settledAction: actionType, enforceScope: true });
      settleWorldRules(applied.world, applied.events);
      propagateCausality(applied.world);
      const candidatePacket = compileAstraContext(projectAstraWorld(state, applied.world), turnInput.action || turnInput.speech, recent);
      Object.assign(candidatePacket, { playerTurn: packet.playerTurn, conversation,
        narrativeContinuity: packet.narrativeContinuity, turnHandoff: handoff || null,
        planMode: packet.planMode, realityApplied: packet.realityApplied, settledAction: actionType });
      const checked = settings.narrativePolicy==='playable'?preparePlayableNarration(applied.world,blocks,candidatePacket):validateAstraNarration(applied.world, blocks, candidatePacket);
      const answered = validateAstraConversation(checked.blocks, present(applied.world, targetId) ? conversation : null, recent);
      if (!checked.ok || !answered.ok) throw Error([...checked.errors.map(error => error.message), ...answered.errors].join('；'));
      return { world: applied.world, blocks: checked.blocks,choices:parsed.choices };
    } catch (error) {
      errors = [short(error.message) || '场景格式无效'];
      truncated = false;
    }
  }
  throw Object.assign(Error('场景回复尚未通过校验，原输入和世界保留。' + errors.join('；')),
    { code: 'AI_NARRATIVE_INVALID' });
}
