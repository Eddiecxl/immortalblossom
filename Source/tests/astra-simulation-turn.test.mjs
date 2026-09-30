import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
function harness(state, candidates) {
  const turns = [], calls = [];
  const runner = createAiTurnRunner({ aiClient: { narrate: async (_, request) => {
    calls.push(request); return JSON.stringify(candidates[Math.min(calls.length - 1, candidates.length - 1)]);
  } }, transcriptStore: { recentTurns: async () => turns, appendTurn: async (_, turn) => turns.push(turn) } });
  return { run: input => runner.runWorld({ state, input, transactionId: 'simulation:test', settings: { mode: 'local', localModelName: 'other' } }), turns, calls };
}
test('one existing AI request carries a generic identity rewrite and persists the exact stable entity', async () => {
  const state = createGameState('测试', 'ai', () => 'rewrite-gender');
  const npc = Object.values(state.astraWorld.characters).find(n => n.alive && n.locationId === state.astraWorld.player.locationId);
  npc.gender = '男';
  const h = harness(state, [{ worldPlan: { operations: [{ type: 'entity.update', targetId: npc.id, changes: { gender: '女' } }] },
    blocks: [{ type: 'narr', text: '我看见眼前人的形貌改变，她仍记得此前的往事。' }] }]);
  const result = await h.run({ speech: '言出法随：将' + npc.name + '变成女性', action: '' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.characters[npc.id].gender, '女');
  assert.equal(state.astraWorld.characters[npc.id].gender, '男');
  assert.equal(h.calls.length, 1);
});
test('narration rejection restores the same draft before retrying a social plan', async () => {
  const state = createGameState('测试', 'ai', () => 'plan-repair');
  const npc = Object.values(state.astraWorld.characters).find(n => n.alive && n.locationId === state.astraWorld.player.locationId);
  const op = { type: 'social.observe', observerId: npc.id, subjectId: 'player', meaning: 'affection', evidence: '你好', valence: 1 };
  const h = harness(state, [
    { worldPlan: { operations: [op] }, blocks: [{ type: 'dlg', name: '不存在的幽灵', text: '你好' }] },
    { worldPlan: { operations: [op] }, blocks: [{ type: 'dlg', name: npc.name, text: '早，今天街口开了新摊，你可以过去看看。' }] }
  ]);
  const result = await h.run({ speech: npc.name + '，你好', action: '' });
  assert.equal(result.ok, true, result.error);
  assert.equal(h.calls.length, 2);
  const beliefs = Object.values(result.state.astraWorld.simulation.beliefs).filter(b => b.meaning === 'affection');
  assert.equal(beliefs.length, 1);
  assert.equal(beliefs[0].appraisal, 6);
});
test('the system proactively warns about an outmatched threat without waiting for a system query', async () => {
  const state = createGameState('测试', 'ai', () => 'companion-warning');
  const npc = Object.values(state.astraWorld.characters).find(n => n.alive && n.locationId === state.astraWorld.player.locationId);
  npc.cultivation.realm = 'tribulation';
  const h = harness(state, [{ blocks: [{ type: 'dlg', name: npc.name, text: '把兵器收起来，我们有话可以说。' }] }]);
  const result = await h.run({ speech: npc.name + '，我要杀了你', action: '' });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.blocks.some(b => b.type === 'sys' && /境界/u.test(b.text)));
  assert.ok(result.state.systemCompanion.dialogueMemory.some(row => /境界/u.test(row.text)));
  assert.equal(result.state.astraWorld.characters[npc.id].alive, true);
  assert.equal(h.calls.length, 1);
});
test('a new AI-proposed character is committed as an engine entity across seeds', async () => {
  for (const seed of ['new-cast-a', 'new-cast-b', 'new-cast-c']) {
    const state = createGameState('测试', 'ai', () => seed);
    const h = harness(state, [{ worldPlan: { operations: [{ type: 'entity.create', kind: 'character',
      entity: { id: 'npc:generated:traveler', name: '云舟客', occupation: 'traveler', goals: ['寻找安稳的住处'] } }] },
      blocks: [{ type: 'narr', text: '我看见一名旅人立在路旁，肩上背着旧行囊。' }] }]);
    const result = await h.run({ speech: '言出法随：创造一位名叫云舟客的旅人', action: '' });
    assert.equal(result.ok, true, result.error);
    const npc = result.state.astraWorld.characters['npc:generated:traveler'];
    assert.equal(npc.locationId, result.state.astraWorld.player.locationId);
    assert.equal(npc.goals[0], '寻找安稳的住处');
    assert.equal(h.calls.length, 1);
  }
});
test('a live speaker offers a dynamic quest whose giver and funds exist', async () => {
  const state = createGameState('测试', 'ai', () => 'offered-task');
  const npc = Object.values(state.astraWorld.characters).find(n => n.alive);
  npc.locationId = state.astraWorld.player.locationId; npc.travel = null;
  npc.lastPlanBucket = Math.floor(state.astraWorld.minute / 20);
  npc.wealth = 30;
  const destination = state.astraWorld.edges.find(edge => edge.from === state.astraWorld.player.locationId && !edge.closed).to;
  const h = harness(state, [{ worldPlan: { operations: [{ type: 'quest.create', quest: {
    id: 'quest:generated:visit', title: '去邻地查看', summary: '到邻地查看道路', giverId: npc.id,
    targetLocationId: destination, condition: { op: 'eq', left: { entityId: 'player', field: 'locationId' }, right: destination },
    reward: [{ type: 'stat.delta', target: 'player', field: 'wealth', magnitude: 3 }]
  } }] }, blocks: [{ type: 'dlg', name: npc.name, text: '邻地那段路近来少人走，你愿意帮我去看看吗？我出三枚钱。' }] }]);
  const result = await h.run({ speech: npc.name + '，我能帮你做什么？', action: '' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.quests['quest:generated:visit'].reservedReward, 3);
  assert.equal(state.astraWorld.quests['quest:generated:visit'], undefined);
});
