import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAstraOpening } from '../../game/astra-opening.js';
import { resolveAstraInteraction } from '../../game/astra-interaction.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';

test('opening does not claim a healer is visible without a real healer', () => {
  const state = createGameState('顾长生', 'ai', () => 'doctor-rumor');
  state.astraWorld.flags.earlyOpportunity = 'local healer';
  const result = createAstraOpening(state);
  const prose = result.turn.blocks.map(block => block.text).join('');
  assert.match(prose, /医者/);
  assert.doesNotMatch(prose, /一位乡间医者正在寻人帮忙/);
});

test('direct identity question gets a grounded answer from a present NPC', () => {
  const world = createGameState('顾长生', 'ai', () => 'npc-answer').astraWorld;
  const npc = world.characters['npc:lin-xiaoman'];
  npc.locationId = world.player.locationId;
  const answer = resolveAstraInteraction(world, '你谁啊', []);
  assert.equal(answer?.targetId, npc.id);
  assert.equal(answer.blocks[0].type, 'dlg');
  assert.match(answer.blocks[0].text, /林小满/);
});

test('offer of help responds with an actual local goal and never reverses who offered', () => {
  const world = createGameState('顾长生', 'ai', () => 'npc-offer').astraWorld;
  const npc = world.characters['npc:lin-xiaoman'];
  npc.locationId = world.player.locationId;
  const answer = resolveAstraInteraction(world, '我来帮你', []);
  assert.equal(answer?.targetId, npc.id);
  assert.doesNotMatch(answer.blocks[0].text, /^帮你[？?]/);
  assert.match(answer.blocks[0].text, /多谢|先/);
});

test('asking for a rumored healer does not make an absent healer reply', () => {
  const world = createGameState('顾长生', 'ai', () => 'absent-healer').astraWorld;
  for (const npc of Object.values(world.characters)) npc.locationId = 'loc:elsewhere';
  const answer = resolveAstraInteraction(world, '你找人？', []);
  assert.equal(answer?.targetId, null);
  assert.equal(answer.blocks[0].type, 'narr');
  assert.match(answer.blocks[0].text, /医者/);
});

test('direct dialogue commits without a cloud or local model request', async () => {
  const state = createGameState('顾长生', 'ai', () => 'offline-interaction');
  const npc = state.astraWorld.characters['npc:lin-xiaoman'];
  npc.locationId = state.astraWorld.player.locationId;
  let requests = 0;
  const turns = [];
  const runner = createAiTurnRunner({
    aiClient: { narrate: async () => { requests++; throw new Error('model unavailable'); } },
    transcriptStore: { recentTurns: async () => turns, allTurns: async () => turns,
      appendTurn: async (_journey, turn) => turns.push(turn) }
  });
  const result = await runner.runWorld({ state, input: { speech: '有人吗', action: '' }, settings: { mode: 'local' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(requests, 0);
  assert.equal(result.turn.provider, 'engine');
  assert.ok(result.blocks.some(block => block.type === 'dlg' && block.name === npc.name));
});

test('an NPC explains only a rumor they know, without reading Engine risk numbers aloud', () => {
  const world = createGameState('顾长生', 'ai', () => 'known-rumor').astraWorld;
  const npc = world.characters['npc:lin-xiaoman'];
  npc.locationId = world.player.locationId;
  world.rumors.push({ id: 'rumor:road', locationId: world.player.locationId,
    knownBy: [npc.id], summary: '东岭关道路危险程度为65/100。' });
  const answer = resolveAstraInteraction(world, '发生什么了', []);
  assert.match(answer.blocks[0].text, /东岭关/);
  assert.doesNotMatch(answer.blocks[0].text, /65\/100/);
  world.rumors[0].knownBy = [];
  assert.doesNotMatch(resolveAstraInteraction(world, '发生什么了', []).blocks[0].text, /东岭关/);
});
