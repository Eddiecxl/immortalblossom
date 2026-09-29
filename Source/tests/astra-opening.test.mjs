import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAstraOpening } from '../../game/astra-opening.js';

test('mortal opening describes the seeded place without forcing a Zhao escape or Lin meeting', () => {
  const state = createGameState('试行者', 'ai', () => 'opening-seed');
  const result = createAstraOpening(state);
  const visible = result.turn.blocks.map(block => block.text).join('');
  assert.equal(result.state.story.location, state.astraWorld.locations[state.astraWorld.player.locationId].name);
  assert.ok(visible.includes(result.state.story.location));
  assert.equal(result.state.astraWorld.flags.encounterLinResolved, false);
  assert.ok(result.state.astraWorld.eventQueue.some(event => event.type === 'lin_first_encounter'));
  assert.ok(!visible.includes('赵府柴房'));
});

test('different seeds yield different real opening situations', () => {
  const openings = Array.from({ length: 12 }, (_, index) => {
    const state = createGameState('试行者', 'ai', () => `opening-${index}`);
    return createAstraOpening(state).turn.blocks.map(block => block.text).join('');
  });
  assert.ok(new Set(openings).size >= 8);
});
