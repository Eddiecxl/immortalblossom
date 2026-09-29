import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
import { resolveAstraConversation, validateAstraConversation, fallbackAstraConversation } from '../../game/astra-interaction.js';
import { seedHash } from '../../game/astra-seed.js';
import { runNpcPlans } from '../../game/astra-npc.js';
import { compileAstraContext } from '../../game/astra-context.js';
import { validateAstraNarration } from '../../game/astra-validator.js';

test('conversation targets are resolved from live world state across many seeds', () => {
  for (let n = 0; n < 48; n++) {
    const world = createGameState('顾长生', 'ai', () => `conversation-seed-${n}`).astraWorld;
    const npc = world.characters['npc:lin-xiaoman'];
    npc.locationId = world.player.locationId;
    const plan = resolveAstraConversation(world, `${npc.name}，你怎么看这件事？`);
    assert.equal(plan.targetId, npc.id);
    npc.alive = false;
    assert.equal(resolveAstraConversation(world, `${npc.name}，你怎么看这件事？`).targetId, null);
  }
});

test('a conversation remains with the same NPC only while that NPC is present', () => {
  const world = createGameState('顾长生', 'ai', () => 'conversation-continuity').astraWorld;
  const npc = world.characters['npc:lin-xiaoman'];
  npc.locationId = world.player.locationId;
  world.flags.conversation = { npcId: npc.id, locationId: world.player.locationId, minute: world.minute };
  assert.equal(resolveAstraConversation(world, '后来那件事呢？').targetId, npc.id);
  npc.locationId = 'loc:elsewhere';
  assert.notEqual(resolveAstraConversation(world, '后来那件事呢？').targetId, npc.id);
});

test('the reply contract rejects generic echoes and accepts a grounded answer', () => {
  const world = createGameState('顾长生', 'ai', () => 'conversation-validation').astraWorld;
  const npc = world.characters['npc:lin-xiaoman'];
  npc.locationId = world.player.locationId;
  const plan = resolveAstraConversation(world, `${npc.name}，你的名字是什么？`);
  assert.equal(validateAstraConversation([{ type: 'dlg', name: npc.name, text: '你问的，我已听见。' }], plan, []).ok, false);
  assert.equal(validateAstraConversation([{ type: 'dlg', name: npc.name, text: `我叫${npc.name}，你找我有什么事？` }], plan, []).ok, true);
});

test('fallback uses the addressed NPC and world facts when local model loops', async () => {
  for (let n = 0; n < 12; n++) {
    const state = createGameState('顾长生', 'ai', () => `conversation-fallback-${n}`);
    const npc = state.astraWorld.characters['npc:lin-xiaoman'];
    npc.locationId = state.astraWorld.player.locationId;
    const turns = [];
    let calls = 0;
    const runner = createAiTurnRunner({
      aiClient: { narrate: async () => { calls++; return JSON.stringify({ blocks: [{ type: 'dlg', name: npc.name, text: '你问的，我已听见。' }] }); } },
      transcriptStore: { recentTurns: async () => turns, allTurns: async () => turns,
        appendTurn: async (_id, turn) => turns.push(turn) }
    });
    const result = await runner.runWorld({ state, input: { speech: `${npc.name}，你是谁？`, action: '' }, settings: { mode: 'local' } });
    assert.equal(result.ok, true, result.error);
    assert.equal(calls, 2, JSON.stringify({ blocks: result.blocks, turn: result.turn }));
    assert.equal(result.turn.provider, 'engine');
    const endNpc = result.state.astraWorld.characters[npc.id];
    if (endNpc.locationId === result.state.astraWorld.player.locationId && !endNpc.travel)
      assert.equal(result.state.astraWorld.flags.conversation?.npcId, npc.id);
    assert.ok(result.blocks.some(block => block.type === 'dlg' && block.name === npc.name && block.text.includes(npc.name)));
  }
});

test('fallback never speaks for a missing NPC', () => {
  const world = createGameState('顾长生', 'ai', () => 'conversation-absent').astraWorld;
  const npc = world.characters['npc:lin-xiaoman'];
  npc.locationId = 'loc:elsewhere';
  const plan = resolveAstraConversation(world, `${npc.name}，听得见吗？`);
  assert.equal(plan.targetId, null);
  assert.equal(fallbackAstraConversation(world, plan), null);
});

test('a departing NPC is absent afterward but can answer speech heard before departure', () => {
  let world, npc;
  for (let n = 0; n < 200; n++) {
    const candidate = createGameState('顾长生', 'ai', () => `departure-seed-${n}`).astraWorld;
    const actor = candidate.characters['npc:lin-xiaoman'];
    const bucket = Math.floor(candidate.minute / 20);
    if (seedHash(candidate.seed, `npc:${actor.id}:${bucket}`) % 16 === 1) { world = candidate; npc = actor; break; }
  }
  assert.ok(world, 'a deterministic departure seed exists');
  npc.locationId = world.player.locationId;
  const plan = resolveAstraConversation(world, `${npc.name}，请等一下`);
  assert.equal(plan.targetId, npc.id);
  assert.ok(runNpcPlans(world, world.minute).some(event => event.actorId === npc.id && event.type === 'depart'));
  assert.equal(npc.locationId, null);
  assert.equal(compileAstraContext({ astraWorld: world }, '说话').presentNpcs.some(person => person.id === npc.id), false);
  const blocks = [{ type: 'dlg', name: npc.name, text: '我先去办事，回来再说。' }];
  assert.equal(validateAstraNarration(world, blocks, {}).ok, false);
  assert.equal(validateAstraNarration(world, blocks, { conversation: { targetId: npc.id, presentAtStart: true } }).ok, true);
});
