import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, migrateGameState } from '../../game/game-state.js';
import { planRealityMutation, applyRealityMutation } from '../../game/astra-reality.js';
import { consumeGeneratedItem } from '../../game/astra-effects.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
import { projectAstraWorld } from '../../game/astra-turn.js';

test('spoken reality rewrite creates a persistent item with a structured effect', () => {
  const state = createGameState('试行者', 'ai', () => 'created-pill');
  const plan = planRealityMutation(state.astraWorld, '言出法随：创造无敌破境丹：服下后直接提升一个大境界。');
  assert.equal(plan.type, 'create_generated_item');
  const world = applyRealityMutation(state.astraWorld, plan);
  const pill = Object.values(world.items).find(item => item.name === '无敌破境丹');
  assert.ok(pill);
  assert.equal(pill.effects[0].type, 'cultivation.advance_major_realm');
  assert.equal(pill.ownerId, world.player.id);
  const restored = migrateGameState({ ...state, astraWorld: JSON.parse(JSON.stringify(world)) }, 'ai');
  assert.ok(restored.astraWorld.items[pill.id]);
});

test('consuming the generated pill changes cultivation and removes the instance', () => {
  const state = createGameState('试行者', 'ai', () => 'consume-pill');
  const plan = planRealityMutation(state.astraWorld, '言出法随：创造无敌破境丹：服下后直接提升一个大境界。');
  const created = applyRealityMutation(state.astraWorld, plan);
  const pill = Object.values(created.items).find(item => item.name === '无敌破境丹');
  const beforeHealth = created.player.maxHealth;
  const result = consumeGeneratedItem(created, pill.id);
  assert.equal(result.world.player.cultivation.realm, 'qi_refining');
  assert.ok(result.world.player.maxHealth > beforeHealth);
  assert.equal(result.world.items[pill.id].destroyed, true);
  assert.ok(!result.world.player.inventory.includes(pill.id));
  assert.ok(result.world.history.some(event => event.type === 'item_consumed' && event.itemId === pill.id));
});

test('unknown generated effects cannot be silently ignored', () => {
  const state = createGameState('试行者', 'ai', () => 'unknown-pill');
  assert.throws(() => planRealityMutation(state.astraWorld,
    '言出法随：创造无名丹：服下后获得完全无法解析的效果。'), /无法解析|规则/u);
});

test('typed Action consumes a generated item and persists the major realm change', async () => {
  const initial = createGameState('试行者', 'ai', () => 'action-consume');
  const plan = planRealityMutation(initial.astraWorld, '言出法随：创造无敌破境丹：服下后直接提升一个大境界。');
  const state = migrateGameState(projectAstraWorld(initial, applyRealityMutation(initial.astraWorld, plan)), 'ai');
  const turns = [];
  const runner = createAiTurnRunner({ aiClient: { narrate: async () => '{"blocks":[{"type":"narr","text":"我服下丹药，气息随之改变。"}]}' },
    transcriptStore: { recentTurns: async () => turns, appendTurn: async (_id, turn) => turns.push(turn) } });
  const result = await runner.runWorld({ state, input: { speech: '', action: '服下无敌破境丹' }, settings: { provider: 'local' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.astraWorld.player.cultivation.realm, 'qi_refining');
  assert.equal(result.state.player.realm, 1);
  assert.ok(!result.state.astraWorld.player.inventory.some(id => result.state.astraWorld.items[id]?.name === '无敌破境丹'));
  const reloaded = migrateGameState(JSON.parse(JSON.stringify(result.state)), 'ai');
  assert.equal(reloaded.astraWorld.player.cultivation.realm, 'qi_refining');
});
