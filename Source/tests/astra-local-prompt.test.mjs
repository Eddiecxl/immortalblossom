import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAstraLocalMessages } from '../../game/astra-local-prompt.js';

const packet = {
  location: { id: 'courtyard', name: '柴院' }, minute: 390,
  playerTurn: { mode: 'speech', speech: '你是谁？', action: '', targetId: 'lin' },
  conversation: { targetId: 'lin', targetName: '林小满', knownFacts: ['她是守卫'] },
  presentNpcs: [{ id: 'lin', name: '林小满', role: 'guard', occupation: 'guard', goals: ['protect ward'] }],
  rumors: [{ text: '医者寻人帮忙' }], activeQuests: [], history: [], recentTurns: [],
  nearbyLocations: [], nearbyEdges: [], directorHook: '院门有人敲门'
};

test('local prompt preserves speaker identity and separates rumor from presence', () => {
  const messages = buildAstraLocalMessages(packet, [], 'Ministral-3-8B-Instruct.gguf');
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /传闻.*不等于.*身份/u);
  assert.match(messages[0].content, /没有求助事实.*不得.*新造求助/u);
  assert.match(messages[0].content, /必须含被问人物的 dlg/u);
  assert.match(messages[1].content, /"occupation":"guard"/u);
  assert.match(messages[1].content, /医者寻人帮忙/u);
  assert.doesNotMatch(messages[1].content, /\/no_think/u);
});

test('non-conversation local prompt stays in first-person narration', () => {
  const messages = buildAstraLocalMessages({ ...packet, conversation: null, playerTurn:{speech:'',action:'查看道路'} }, [], 'other.gguf');
  assert.match(messages[0].content, /只写 1–2 个 narr 块/u);
  assert.doesNotMatch(messages[0].content, /只写一个 dlg 块/u);
});

test('Qwen3 local prompt disables unbounded thinking without changing non-Qwen requests', () => {
  const qwen = buildAstraLocalMessages(packet, [], 'Qwen3-14B-Q4_K_M.gguf');
  assert.match(qwen[1].content, /\/no_think\s*$/u);
  const other = buildAstraLocalMessages(packet, [], 'other.gguf');
  assert.doesNotMatch(other[1].content, /\/no_think/u);
});
