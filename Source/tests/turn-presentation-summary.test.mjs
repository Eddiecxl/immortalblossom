import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTurnBlocks } from '../../game/beta4/presentation.js';
import { summarizeWorldTurn, recentEchoSummary } from '../../game/turn-summary.js';
import { createTranscriptStore } from '../../game/transcript-store.js';
import { stripExactPlayerSpeechEcho } from '../../game/player-turn.js';
import { validateAstraNarration } from '../../game/astra-validator.js';
import { createAstraWorld } from '../../game/astra-world.js';

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
test('an exact echo-only model block cannot invalidate the otherwise new NPC response',()=>{
 const world=createAstraWorld('speech-echo-quality');const npc=Object.values(world.characters).find(n=>n.alive);
 npc.locationId=world.player.locationId;npc.travel=null;
 for(const speech of ['刚才是开玩笑的。你自己的想法是什么？','谁','有人吗']){
  const blocks=stripExactPlayerSpeechEcho([{type:'narr',text:'我说：“'+speech+'”'},
   {type:'dlg',name:npc.name,text:'我得先照看好自己的事，再考虑别的去向。'}],speech);
  assert.equal(blocks.length,1);
  assert.equal(validateAstraNarration(world,blocks,{playerTurn:{speech}}).ok,true);
 }
 const kept=stripExactPlayerSpeechEcho([{type:'narr',text:'我说：“你好”，风声盖过了最后的尾音。'}],'你好');
 assert.match(kept[0].text,/风声盖过/u);
});
test('transcript reload retains bounded narrative degradation reasons for diagnosis',async()=>{
 const records=new Map();const store=createTranscriptStore({memory:records});
 await store.appendTurn('quality',{id:'quality-turn',kind:'world',diagnostics:{degraded:true,code:'AI_GROUNDED_RECOVERY',reasons:['大段复读']},blocks:[{type:'dlg',name:'测试人物',text:'东西还在这里。'}]});
 const reader=createTranscriptStore({memory:records});
 assert.deepEqual((await reader.allTurns('quality'))[0].diagnostics,{degraded:true,code:'AI_GROUNDED_RECOVERY',reasons:['大段复读']});
});
