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
  assert.ok(result.turn.blocks.some(block => /[？?]|留意|看看/u.test(block.text)));
  assert.ok(result.turn.summary);
});

test('anti-stall creates a persistent rumor and visible Engine event after quiet turns', () => {
  const world = createGameState('试行者', 'ai', () => 'director-stall').astraWorld;
  let change;
  for (let turn = 0; turn < 3; turn++) change = directAstraScene(world, []);
  assert.equal(change.event?.type, 'scene_director');
  assert.ok(world.rumors.some(rumor => rumor.originEventId === change.event.id));
  assert.ok(world.history.some(event => event.id === change.event.id));
  assert.ok(change.hook);
});
