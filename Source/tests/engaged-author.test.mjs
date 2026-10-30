import test from 'node:test';
import assert from 'node:assert/strict';
import { compactNarrativePacket } from '../../game/astra-narrative-budget.js';
import { buildAstraLocalMessages } from '../../game/astra-local-prompt.js';

function encounterPacket() {
  const target = { id: 'npc:requester', name: '行舟', occupation: 'boatman', locationId: 'loc:bank',
    alive: true, personality: 'practical', goals: ['keep boat safe'], memories: [] };
  return {
    minute: 363, location: { id: 'loc:bank', name: '河岸' }, player: { id: 'player', locationId: 'loc:bank' },
    playerTurn: { speech: '我不帮这个忙，我只想问路。', action: '', text: '我不帮这个忙，我只想问路。' },
    conversation: { targetId: null }, planMode: 'ordinary',
    turnHandoff: { kind: 'encounter', subjectId: 'scene:arrival', targetId: target.id, targetName: target.name,
      locationId: 'loc:bank', itemId: 'item:rope', questId: 'quest:boat', phase: 'responding',
      focus: '船夫已听见拒绝，正在处理自己的渡船', nextAction: '听他回应问路，再决定要不要过去',
      pressure: '船夫需要先料理渡船，玩家没有答应帮忙', options: ['询问去路', '走开', '另想办法'],
      previousInput: { speech: '我不帮这个忙，我只想问路。', action: '' } },
    presentNpcs: [target, ...Array.from({ length: 14 }, (_, i) => ({ id: `npc:bystander-${i}`,
      name: `路人${i}`, occupation: 'vendor', description: '无关往事'.repeat(260), memories: [] }))],
    items: [{ id: 'item:rope', name: '麻绳', ownerId: target.id, locationId: 'loc:bank', quantity: 1 },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `item:extra-${i}`, name: `杂物${i}`, description: '无关'.repeat(90) }))],
    activeQuests: [{ id: 'quest:boat', title: '渡船的事', giverId: target.id, state: 'available', targetLocationId: 'loc:bank' }],
    nearbyLocations: [{ id: 'loc:bank', name: '河岸' }], recentTurns: []
  };
}

test('context compaction retains the active encounter actor and concrete dependencies without a speech target', () => {
  const source = encounterPacket(), before = structuredClone(source);
  const compact = compactNarrativePacket(source, { maxChars: 1800 });
  assert.ok(compact.presentNpcs.some(npc => npc.id === source.turnHandoff.targetId), 'Do not leave a prompt asking an absent author-side character to respond');
  assert.ok(compact.items.some(item => item.id === source.turnHandoff.itemId));
  assert.ok(compact.activeQuests.some(quest => quest.id === source.turnHandoff.questId));
  assert.deepEqual(compact.turnHandoff, source.turnHandoff, 'The refusal, current phase and open choices must survive budgeting');
  assert.deepEqual(source, before, 'Prompt reduction must not rewrite the saved encounter or people');
});

test('local author receives the current encounter and refusal even when no NPC was named in player speech', () => {
  const packet = encounterPacket();
  const messages = buildAstraLocalMessages(packet, [], 'qwen3-14b');
  const user = messages.find(message => message.role === 'user').content;
  const start = user.indexOf('引擎事实：') + '引擎事实：'.length;
  const end = user.indexOf('\nrecentTurns');
  const facts = JSON.parse(user.slice(start, end));
  assert.deepEqual(facts.turnHandoff, packet.turnHandoff);
  assert.equal(facts.presentNpcs.find(npc => npc.id === packet.turnHandoff.targetId)?.name, '行舟');
  assert.equal(facts.activeQuests[0].state, 'available', 'An offered path is not an accepted task');
  assert.equal(facts.items.find(item => item.id === 'item:rope')?.ownerId, 'npc:requester');
  assert.equal(messages.length, 2, 'Active scene guidance belongs to the existing request, not another AI call');
});

test('a nonverbal player action does not suppress a present encounter actors next response', () => {
  const packet = encounterPacket();
  packet.playerTurn = { speech: '', action: '观察眼前渡船', text: '观察眼前渡船' };
  const system = buildAstraLocalMessages(packet)[0].content;
  assert.doesNotMatch(system, /本轮只写 1–2 个 narr 块/u, 'The scene still has a real person who can address the protagonist');
  assert.match(system, /行舟/u);
  packet.presentNpcs = packet.presentNpcs.filter(npc => npc.id !== packet.turnHandoff.targetId);
  const absent = buildAstraLocalMessages(packet)[0].content;
  assert.match(absent, /本轮只写 1–2 个 narr 块/u, 'A stale encounter target does not authorize a missing speaker');
});
