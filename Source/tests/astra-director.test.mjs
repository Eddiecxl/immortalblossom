import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAstraOpening } from '../../game/astra-opening.js';
import { directAstraScene } from '../../game/astra-director.js';

test('opening advances the world and records a seeded live situation', () => {
  const state = createGameState('试行者', 'ai', () => 'director-opening');
  const result = createAstraOpening(state);
  assert.ok(result.state.astraWorld.minute > state.astraWorld.minute);
  assert.ok(result.state.astraWorld.history.some(event => event.type === 'opening_cue' && event.playerWitnessed));
  assert.ok(result.turn.blocks.some(block => /[？?]|留意|看看|可以先/u.test(block.text)));
  assert.ok(result.turn.summary);
});

test('quiet turns expose the current situation without manufacturing repeated rumors or events', () => {
  const world = createGameState('试行者', 'ai', () => 'director-stall').astraWorld;
  const rumors = structuredClone(world.rumors), history = structuredClone(world.history);
  let change;
  for (let turn = 0; turn < 9; turn++) {
    change = directAstraScene(world, []);
    assert.equal(change.event, null);
  }
  assert.deepEqual(world.rumors, rumors);
  assert.deepEqual(world.history, history);
  assert.ok(change.hook);
});
