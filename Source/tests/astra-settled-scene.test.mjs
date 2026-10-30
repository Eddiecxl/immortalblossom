import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { narrateSettledScene } from '../../game/astra-settled-scene.js';

function fixture() {
  const state = createGameState('旅人', 'ai', () => 'settled-scene');
  const sourceWorld = structuredClone(state.astraWorld), world = structuredClone(sourceWorld);
  const npc = world.characters['npc:lin-xiaoman'];
  npc.alive = true; npc.travel = null; npc.locationId = world.player.locationId;
  world.player.invincible = true; world.flags.causalDebt = 60;
  const handoff = { kind: 'encounter', subjectId: 'scene:law', targetId: npc.id, targetName: npc.name,
    locationId: npc.locationId, focus: '人物看见主角刚才的变化', nextAction: '回应人物的追问' };
  const options = { sourceWorld, world, state, input: { action: '言出法随：让我无敌', speech: '' },
    settings: { mode: 'groq' }, transactionId: 'settled-law', actionType: 'reality',
    impact: { kind: 'invincible', summary: '护身法则已经生效，未造成旁人伤亡。' }, handoff };
  const prose = [{ type: 'narr', text: '四周的声音忽然清晰起来，先前绷紧的身体松缓下来。' },
    { type: 'dlg', name: npc.name, text: '刚才那一下，是怎么回事？你还好吧？' }];
  return { options, npc, prose };
}
const response = (blocks, operations = []) => JSON.stringify({ blocks, worldPlan: { operations } });

test('settled law gets a grounded NPC aftermath without repeating its mutation or changing caller state', async () => {
  const { options, npc, prose } = fixture(), before = structuredClone(options);
  const requests = [];
  const result = await narrateSettledScene({ ...options, aiClient: { narrate: async (settings, request) => {
    requests.push(request);
    return response(prose, [{ type: 'social.observe', observerId: npc.id, subjectId: 'player',
      meaning: '惊疑', evidence: '无敌', valence: 0, reason: '看见异变，暂时还在确认情况。' }]);
  } } });
  assert.equal(requests.length, 1);
  assert.equal(result.world.player.invincible, true); assert.equal(result.world.flags.causalDebt, 60);
  assert.equal(result.world.minute, options.world.minute);
  assert.ok(result.blocks.some(b => b.type === 'dlg' && b.name === npc.name));
  assert.ok(Object.values(result.world.simulation.beliefs).some(b => b.meaning === '惊疑'));
  assert.deepEqual(options, before);
});

test('a proposed second reality mutation is rejected and repaired as ordinary reaction only', async () => {
  const { options, prose } = fixture(); const requests = [];
  const result = await narrateSettledScene({ ...options, aiClient: { narrate: async (_, request) => {
    requests.push(request);
    return response(prose, requests.length === 1 ? [{ type: 'entity.update', targetId: 'player', changes: { wealth: 999999 } }] : []);
  } } });
  assert.equal(requests.length, 2);
  assert.equal(result.world.player.wealth, options.world.player.wealth);
  assert.equal(result.world.flags.causalDebt, 60);
  assert.notEqual(requests[0].transactionId, requests[1].transactionId);
  assert.ok(requests[1].messages.some(message => message.role === 'assistant'));
});

test('truncated format gets one bounded repair with increased output space, not a partial commit', async () => {
  const { options, prose } = fixture(); const requests = [];
  await narrateSettledScene({ ...options, aiClient: { narrate: async (_, request) => {
    requests.push(request);
    if (requests.length === 1) throw Object.assign(Error('truncated'), { code: 'AI_OUTPUT_TRUNCATED', status: 422 });
    return response(prose);
  } } });
  assert.equal(requests.length, 2); assert.equal(requests[0].maxTokens, 1100); assert.equal(requests[1].maxTokens, 1200);
});

test('429 propagates unchanged with no fallback or secondary generation', async () => {
  const { options } = fixture(), before = structuredClone(options);
  const limit = Object.assign(Error('quota'), { code: 'AI_RATE_LIMIT', status: 429, retryAfterMs: 3210 });
  let calls = 0;
  await assert.rejects(narrateSettledScene({ ...options, aiClient: { narrate: async () => { calls++; throw limit; } } }), error => error === limit);
  assert.equal(calls, 1); assert.deepEqual(options, before);
});

test('an incomplete JSON body gets repaired without accepting its complete-looking dialogue prefix', async () => {
  const { options, prose } = fixture(); let calls = 0;
  const result = await narrateSettledScene({ ...options, aiClient: { narrate: async () => {
    calls++;
    return calls === 1 ? '{"blocks":[{"type":"narr","text":"残缺的旧候选。"}],"worldPlan":' : response(prose);
  } } });
  assert.equal(calls, 2);
  assert.ok(result.blocks.every(block => !block.text.includes('残缺的旧候选')));
});

test('invalid speakers after two attempts reject the whole candidate including its relationship change', async () => {
  const { options, npc } = fixture(), before = structuredClone(options); let calls = 0;
  await assert.rejects(narrateSettledScene({ ...options, aiClient: { narrate: async () => {
    calls++;
    return response([{ type: 'dlg', name: '不存在的围观人', text: '仙人，收我为徒吧！' }],
      [{ type: 'social.observe', observerId: npc.id, subjectId: 'player', meaning: '敬畏', evidence: '无敌', valence: 1, reason: '看见异变。' }]);
  } } }), { code: 'AI_NARRATIVE_INVALID' });
  assert.equal(calls, 2); assert.deepEqual(options, before);
});

test('arrival aftermath cannot speak through a resident left behind at the departure location', async () => {
  const { options, npc } = fixture(), sourceLocation = options.world.player.locationId;
  const destination = Object.keys(options.world.locations).find(id => id !== sourceLocation);
  options.world.player.locationId = destination;
  for (const actor of Object.values(options.world.characters)) actor.locationId = sourceLocation;
  options.actionType = 'travel'; options.handoff = { kind: 'route', locationId: destination };
  options.input = { action: '前往新地点', speech: '' };
  let calls = 0;
  const result = await narrateSettledScene({ ...options, aiClient: { narrate: async () => {
    calls++;
    return calls === 1 ? response([{ type: 'dlg', name: npc.name, text: '到了这儿先歇一会吧。' }])
      : response([{ type: 'narr', text: '脚下的路已换了一段，前方的岔口近了。' }]);
  } } });
  assert.equal(calls, 2); assert.ok(result.blocks.every(b => b.type !== 'dlg'));
  assert.equal(result.world.player.locationId, destination);
});
