import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTurnBlocks } from '../../game/beta4/presentation.js';
import { summarizeWorldTurn, recentEchoSummary } from '../../game/turn-summary.js';
import { createTranscriptStore } from '../../game/transcript-store.js';

test('player speech appears once even when narration embeds the same quoted line', () => {
  const speech = '那为什么我打不到你?';
  const blocks = [
    { type: 'narr', text: `我说：“${speech}”`, engineOwnedPlayerSpeech: true, exactPlayerSpeech: speech },
    { type: 'narr', text: `我盯着林小满，声音里带着几分急切与困惑：“${speech}”看自己的手，掌心清晰可见。` }
  ];
  const displayed = projectTurnBlocks(blocks, speech);
  assert.equal(displayed.filter(block => block.text.includes(speech)).length, 1);
  assert.equal(displayed[0].type, 'dlg');
  assert.match(displayed[1].text, /掌心清晰可见/);
});

test('turn summary is derived from Engine changes and survives as a stored field', () => {
  const before = { minute: 360, player: { locationId: 'a', health: 100, wealth: 1 },
    locations: { a: { name: '河阳城' } }, quests: {}, characters: {} };
  const after = structuredClone(before);
  after.minute = 365;
  after.player.health = 90;
  const summary = summarizeWorldTurn({ before, after, input: { speech: '那为什么我打不到你?', action: '' },
    action: { type: 'speech' }, events: [] });
  assert.match(summary, /河阳城/);
  assert.match(summary, /气血减少 10/);
  assert.doesNotMatch(summary, /那为什么我打不到你/);
  const stored = { summary, blocks: [{ type: 'narr', text: '一大段应当留在剧情区的原文。' }] };
  assert.equal(recentEchoSummary(stored), summary);
});

test('legacy echo fallback does not copy a story block', () => {
  const turn = { speech: '你是谁？', blocks: [{ type: 'narr', text: '我在院中遇到了许多人，听见了他们对旧事的长篇谈论。' }] };
  const summary = recentEchoSummary(turn);
  assert.notEqual(summary, turn.blocks[0].text);
  assert.match(summary, /交谈/);
});

test('real transcript storage preserves the committed summary across reload', async () => {
  const records = new Map();
  const writer = createTranscriptStore({ memory: records });
  await writer.appendTurn('journey', { id: 'turn-1', kind: 'world', summary: '河阳城传出商路险情；众人开始重新安排路程。',
    blocks: [{ type: 'narr', text: '这里是完整剧情原文。' }] });
  const reader = createTranscriptStore({ memory: records });
  const stored = (await reader.allTurns('journey'))[0];
  assert.equal(recentEchoSummary(stored), '河阳城传出商路险情；众人开始重新安排路程。');
});
