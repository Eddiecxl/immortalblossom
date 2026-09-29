import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
import { createQuestArc } from '../../game/astra-quests.js';

function harness(raw = '{"blocks":[{"type":"narr","text":"我在晨风里看见集市逐渐忙起来。"}]}') {
  const turns = [];
  const aiClient = { narrate: async () => raw };
  const transcriptStore = { recentTurns: async () => turns, allTurns: async () => turns,
    appendTurn: async (_id, turn) => { turns.push(turn); }, deleteTurn: async (_id, id) => {
      const index = turns.findIndex(turn => turn.id === id); if (index >= 0) turns.splice(index, 1);
    } };
  return { turns, runner: createAiTurnRunner({ aiClient, transcriptStore, idFactory: () => 'test-turn' }) };
}

test('speech advances authoritative time while preserving exact player speech', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-speech');
  const { runner, turns } = harness();
  const result = await runner.runWorld({ state: before, input: { speech: '今日市集如何？', action: '' }, settings: { provider: 'groq', model: 'qwen/qwen3.8-27b' } });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.state.astraWorld.minute > before.astraWorld.minute);
  assert.equal(before.astraWorld.minute, 360);
  assert.equal(result.state.story.minuteOfDay, result.state.astraWorld.minute % 1440);
  assert.equal(result.blocks.filter(block => block.exactPlayerSpeech === '今日市集如何？').length, 1);
  assert.equal(turns.length, 1);
});

test('bad model response cannot commit Engine world or transcript', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-fail');
  for (const npc of Object.values(before.astraWorld.characters)) if (npc.alive) npc.locationId = 'loc:elsewhere';
  const { runner, turns } = harness('not json');
  const result = await runner.runWorld({ state: before, input: { speech: '你好', action: '' }, settings: { provider: 'groq', model: 'qwen/qwen3.8-27b' } });
  assert.equal(result.ok, false);
  assert.equal(before.astraWorld.minute, 360);
  assert.equal(turns.length, 0);
});

test('reality command is applied mechanically and remains terminal after save normalization', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-end');
  const { runner } = harness('bad response should not be used');
  const result = await runner.runWorld({ state: before, input: { speech: '', action: '言出法随：让全宇宙所有生命消失' }, settings: { provider: 'groq' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.terminal.ending, 'civilization_extinct');
  assert.equal(result.state.story.flags.playerDead, true);
});

test('system companion reads world truth without advancing time', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-system');
  const { runner } = harness('{"blocks":[{"type":"sys","text":"宿主，先看清周围的路。"}]}');
  const result = await runner.runSystem({ state: before, input: '我们在哪里？', settings: { provider: 'groq' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.minute, before.astraWorld.minute);
  assert.equal(result.state.story.location, before.story.location);
});

test('explicit quest work changes quest state and transfers a reward through Engine', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-quest');
  const quest = createQuestArc(before.astraWorld, 'quest:repair-bridge:urgent', { locationId: before.astraWorld.player.locationId });
  quest.state = 'active';
  const wealth = before.astraWorld.player.wealth;
  const { runner } = harness();
  const result = await runner.runWorld({ state: before, input: { speech: '', action: '修好桥梁，完成委托' }, settings: { provider: 'groq' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.quests[quest.id].state, 'completed');
  assert.ok(result.state.astraWorld.player.wealth > wealth);
});

test('narrative loop is rejected before a second identical turn can be saved', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-loop');
  for (const npc of Object.values(before.astraWorld.characters)) if (npc.alive) npc.locationId = 'loc:elsewhere';
  const phrase = '我在晨风里看见集市逐渐忙起来。';
  const { runner, turns } = harness(JSON.stringify({ blocks: [{ type: 'narr', text: phrase }] }));
  const first = await runner.runWorld({ state: before, input: { speech: '你好', action: '' }, settings: { provider: 'groq' } });
  assert.equal(first.ok, true, first.error);
  const second = await runner.runWorld({ state: first.state, input: { speech: '还有什么事？', action: '' }, settings: { provider: 'groq' } });
  assert.equal(second.ok, false);
  assert.equal(turns.length, 1);
  assert.equal(second.state.astraWorld.minute, first.state.astraWorld.minute);
});

test('only present NPCs hear and remember player speech', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-hearing');
  const lin = before.astraWorld.characters['npc:lin-xiaoman'];
  lin.locationId = before.astraWorld.player.locationId;
  lin.metPlayer = true;
  const remote = Object.values(before.astraWorld.characters).find(npc => npc.alive && npc.locationId !== lin.locationId);
  const { runner } = harness();
  const result = await runner.runWorld({ state: before, input: { speech: '林小满，谢谢你帮忙。', action: '' }, settings: { provider: 'groq' } });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.state.astraWorld.characters[lin.id].memories.some(memory => memory.summary.includes('谢谢你帮忙')));
  assert.equal(result.state.astraWorld.characters[remote.id].memories.some(memory => memory.summary?.includes('谢谢你帮忙')), false);
});

test('model echo of exact player speech is removed before the turn is stored', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-no-echo');
  const speech = '那为什么我打不到你?';
  const { runner, turns } = harness(JSON.stringify({ blocks: [
    { type: 'narr', text: `我盯着自己的手：“${speech}”掌心还留着红印。` }
  ] }));
  const result = await runner.runWorld({ state: before, input: { speech, action: '' }, settings: { provider: 'groq' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.blocks.filter(block => block.text.includes(speech)).length, 1);
  assert.equal(turns[0].summary, result.turn.summary);
});

test('speech command remains speech, while explicit spoken reality invocation uses Engine', async () => {
  const before = createGameState('试行者', 'ai', () => 'integration-spoken-law');
  const { runner } = harness();
  const speech = await runner.runWorld({ state: before, input: { speech: '把门打开。', action: '' }, settings: { provider: 'groq' } });
  assert.equal(speech.ok, true, speech.error);
  assert.equal(speech.turn.provider, 'groq');
  const law = await runner.runWorld({ state: speech.state,
    input: { speech: '言出法随：让全宇宙所有生命消失', action: '' }, settings: { provider: 'groq' } });
  assert.equal(law.ok, true, law.error);
  assert.equal(law.turn.provider, 'engine');
  assert.equal(law.state.astraWorld.terminal.ended, true);
});
