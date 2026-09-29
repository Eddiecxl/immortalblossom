import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAstraContext } from '../../game/astra-context.js';
import { validateAstraNarration } from '../../game/astra-validator.js';
import { createAstraWorld } from '../../game/astra-world.js';

function world() {
  return {
    seed: 'test', minute: 120, player: { name: '阿青', locationId: 'market', cultivation: 'none', skills: [] },
    locations: {
      market: { id: 'market', name: '青石集', status: 'active' },
      gate: { id: 'gate', name: '北门', status: 'active' },
      ruin: { id: 'ruin', name: '旧祠堂', status: 'destroyed' },
      remote: { id: 'remote', name: '远山', status: 'active' }
    },
    edges: [{ from: 'market', to: 'gate', minutes: 20 }, { from: 'gate', to: 'ruin', minutes: 30 }],
    characters: {
      lin: { id: 'lin', name: '林小满', status: 'alive', locationId: 'market', goal: '找到药草', knownFactIds: ['public-1'], memories: ['集市有药铺'] },
      ghost: { id: 'ghost', name: '张三', status: 'dead', locationId: 'market', knownFactIds: [] },
      traveler: { id: 'traveler', name: '李四', status: 'alive', locationId: 'remote', knownFactIds: [] }
    },
    quests: { herb: { id: 'herb', title: '采药', state: 'active', locationId: 'market' }, old: { id: 'old', title: '旧事', state: 'completed' } },
    eventQueue: [{ id: 'arrival', type: 'arrival', dueAt: 100, payload: { actorId: 'lin' } }, { id: 'future', dueAt: 200, locationId: 'market' }],
    history: [{ id: 'public-1', timestamp: 80, locationId: 'market', summary: '集市开张', playerWitnessed: true }],
    rumors: [{ id: 'rumor-1', text: '北门有商队', knownBy: ['lin'], locationId: 'market' }],
    secrets: [{ id: 'secret-1', text: '宗主藏有天命玉玺', knownBy: ['traveler'] }],
    items: { sword: { id: 'sword', name: '青锋剑', ownerId: 'player', provenance: 'engine:gift' } },
    terminal: null
  };
}

test('context is bounded and selects local graph, actors, knowledge and recent turns', () => {
  const w = world();
  for (let n = 0; n < 10_000; n++) w.history.push({ id: `h${n}`, timestamp: n, locationId: 'remote', summary: '远方消息'.repeat(20) });
  const turns = Array.from({ length: 20 }, (_, n) => ({ id: `t${n}`, userText: `第${n}回合`, blocks: [{ type: 'narr', text: '交谈' }] }));
  const packet = compileAstraContext({ astraWorld: w }, '林小满，药草在哪？', turns);
  assert.equal(packet.minute, 120);
  assert.equal(packet.location.id, 'market');
  assert.deepEqual(packet.nearbyLocations.map(x => x.id), ['gate']);
  assert.deepEqual(packet.nearbyEdges.map(x => [x.from, x.to, x.minutes]), [['market', 'gate', 20]]);
  assert.deepEqual(packet.presentNpcs.map(x => x.id), ['lin']);
  assert.deepEqual(packet.activeQuests.map(x => x.id), ['herb']);
  assert.ok(packet.dueEvents.some(x => x.id === 'arrival'));
  assert.ok(packet.recentTurns.length >= 3 && packet.recentTurns.length <= 6);
  assert.ok(JSON.stringify(packet).length < 20_000);
  assert.equal(JSON.stringify(packet).includes('宗主藏有天命玉玺'), false);
});

test('context includes only secrets and rumors known by an eligible local speaker', () => {
  const w = world();
  w.secrets.push({ id: 'lin-secret', text: '林家密钥在井中', knownBy: ['lin'] });
  const packet = compileAstraContext({ astraWorld: w }, '林小满，告诉我秘密', []);
  assert.ok(packet.presentNpcs[0].allowedSecrets.some(x => x.id === 'lin-secret'));
  assert.ok(packet.rumors.some(x => x.id === 'rumor-1'));
  assert.equal(JSON.stringify(packet).includes('宗主藏有天命玉玺'), false);
});

test('dead and remote NPC dialogue is rejected without returning unsupported blocks', () => {
  const w = world();
  const blocks = [{ type: 'dlg', name: '张三', text: '我还活着。' }, { type: 'dlg', name: '李四', text: '我到了。' }, { type: 'narr', text: '风吹过集市。' }];
  const result = validateAstraNarration(w, blocks, compileAstraContext({ astraWorld: w }, '', []));
  assert.equal(result.ok, false);
  assert.deepEqual(result.blocks, [blocks[2]]);
  assert.ok(result.errors.some(x => x.code === 'dead-speaker'));
  assert.ok(result.errors.some(x => x.code === 'absent-speaker'));
});

test('prose cannot casually declare a dead NPC alive again', () => {
  const scene = createAstraWorld('dead-prose');
  const npc = scene.characters['npc:lin-xiaoman'];
  npc.locationId = scene.player.locationId;
  npc.alive = false;
  const checked = validateAstraNarration(scene, [{ type: 'narr', text: `${npc.name}又活着站在我面前。` }],
    compileAstraContext({ astraWorld: scene }, '看看周围'));
  assert.equal(checked.ok, false);
});

test('impossible location and intact destroyed place are rejected', () => {
  const w = world();
  const blocks = [{ type: 'narr', locationId: 'remote', text: '我一步来到远山。' }, { type: 'narr', text: '旧祠堂完好无损，香火依旧。' }];
  const result = validateAstraNarration(w, blocks, compileAstraContext({ astraWorld: w }, '', []));
  assert.equal(result.blocks.length, 0);
  assert.ok(result.errors.some(x => x.code === 'impossible-location'));
  assert.ok(result.errors.some(x => x.code === 'destroyed-location'));
});

test('item and skill claims require recorded Engine provenance', () => {
  const w = world();
  const blocks = [{ type: 'narr', text: '我得到天命玉玺。', claims: [{ type: 'item', id: 'new-item' }] }, { type: 'narr', text: '我学会飞升术。', claims: [{ type: 'skill', id: 'ascend' }] }, { type: 'narr', text: '青锋剑仍在我手中。', claims: [{ type: 'item', id: 'sword' }] }];
  const result = validateAstraNarration(w, blocks, compileAstraContext({ astraWorld: w }, '', []));
  assert.deepEqual(result.blocks, [blocks[2]]);
  assert.ok(result.errors.some(x => x.code === 'unsupported-item'));
  assert.ok(result.errors.some(x => x.code === 'unsupported-skill'));
});

test('NPC cannot disclose a restricted secret or restart a completed quest', () => {
  const w = world();
  const blocks = [{ type: 'dlg', name: '林小满', text: '宗主藏有天命玉玺。' }, { type: 'narr', text: '旧事任务重新开始。' }];
  const result = validateAstraNarration(w, blocks, compileAstraContext({ astraWorld: w }, '', []));
  assert.equal(result.blocks.length, 0);
  assert.ok(result.errors.some(x => x.code === 'forbidden-secret'));
  assert.ok(result.errors.some(x => x.code === 'finished-quest'));
});

test('terminal extinction, stale ETA and reversed time are rejected', () => {
  const w = world();
  w.terminal = { type: 'all-life-destroyed', active: true };
  const blocks = [{ type: 'narr', text: '集市人声鼎沸，商贩照常叫卖。' }, { type: 'narr', text: '林小满仍在赶来，还有十分钟。' }, { type: 'narr', minute: 80, text: '午后转回清晨。' }];
  const result = validateAstraNarration(w, blocks, compileAstraContext({ astraWorld: w }, '', []));
  assert.equal(result.blocks.length, 0);
  assert.ok(result.errors.some(x => x.code === 'terminal-ordinary-life'));
  assert.ok(result.errors.some(x => x.code === 'stale-eta'));
  assert.ok(result.errors.some(x => x.code === 'time-reversal'));
});

test('substantial exact repetition from recent narration is rejected', () => {
  const w = world();
  const repeated = '我望见北门的白旗在风里缓缓摇动，药铺的门仍然紧闭。';
  const packet = compileAstraContext({ astraWorld: w }, '', [{ id: 't1', blocks: [{ type: 'narr', text: repeated }] }]);
  const result = validateAstraNarration(w, [{ type: 'narr', text: repeated }], packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(x => x.code === 'repetition'));
});

test('context remains capped when individual saved fields are very large', () => {
  const w = world();
  w.characters.lin.goals = Array.from({ length: 10_000 }, () => '长目标'.repeat(100));
  w.player.skills = Array.from({ length: 10_000 }, () => '功法'.repeat(100));
  w.eventQueue[0].payload = { notes: '大量备注'.repeat(20_000) };
  const packet = compileAstraContext({ astraWorld: w }, '你好'.repeat(10_000), []);
  assert.ok(JSON.stringify(packet).length <= 18_000);
  assert.equal(packet.input.length, 500);
});

test('dialogue fact IDs must belong to the speaker knowledge set', () => {
  const w = world();
  const blocks = [{ type: 'dlg', name: '林小满', text: '我知道这个。', factIds: ['secret-1'] }];
  const result = validateAstraNarration(w, blocks, compileAstraContext({ astraWorld: w }, '', []));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(x => x.code === 'unknown-fact'));
});

test('plain prose cannot award an unrecorded item or skill', () => {
  const w = world();
  const blocks = [{ type: 'narr', text: '我得到天命玉玺。' }, { type: 'narr', text: '我学会飞升术。' }];
  const result = validateAstraNarration(w, blocks, compileAstraContext({ astraWorld: w }, '', []));
  assert.equal(result.blocks.length, 0);
  assert.ok(result.errors.some(x => x.code === 'unsupported-item'));
  assert.ok(result.errors.some(x => x.code === 'unsupported-skill'));
});

test('terminal extinction disallows ordinary NPC dialogue', () => {
  const w = world();
  w.terminal = { type: 'all-life-destroyed', active: true };
  const result = validateAstraNarration(w, [{ type: 'dlg', name: '林小满', text: '早上好。' }], compileAstraContext({ astraWorld: w }, '', []));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(x => x.code === 'terminal-ordinary-life'));
});

test('compiler and validator accept foundation world fields', () => {
  const w = createAstraWorld('context-foundation', '阿青');
  const id = w.player.locationId;
  w.characters['npc:lin-xiaoman'].locationId = id;
  w.characters['npc:lin-xiaoman'].alive = false;
  w.locations[id].destroyed = true;
  const packet = compileAstraContext({ astraWorld: w }, '看看附近', []);
  assert.equal(packet.location.id, id);
  assert.equal(packet.location.destroyed, true);
  assert.equal(packet.presentNpcs.some(npc => npc.id === 'npc:lin-xiaoman'), false);
  const result = validateAstraNarration(w, [{ type: 'dlg', name: '林小满', text: '你好。' }], packet);
  assert.ok(result.errors.some(x => x.code === 'dead-speaker'));
});
