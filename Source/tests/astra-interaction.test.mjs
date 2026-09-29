import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAstraOpening } from '../../game/astra-opening.js';
import { resolveAstraConversation, fallbackAstraConversation } from '../../game/astra-interaction.js';

test('a rumor never turns into an unrecorded person at the opening', () => {
  const opportunities = ['local healer', 'merchant route', 'sect examination', 'wandering mentor', 'ancient rumor'];
  for (let n = 0; n < 40; n++) {
    const state = createGameState('顾长生', 'ai', () => `opening-grounding-${n}`);
    const world = state.astraWorld;
    world.flags.earlyOpportunity = opportunities[n % opportunities.length];
    for (const npc of Object.values(world.characters)) if (npc.locationId === world.player.locationId) npc.locationId = 'loc:elsewhere';
    const result = createAstraOpening(state);
    const visible = result.turn.blocks.map(block => block.text).join('');
    assert.doesNotMatch(visible, /问问在场的人|医者正在眼前|商队正在眼前/);
    assert.ok(result.state.astraWorld.history.some(entry => entry.type === 'opening_cue'));
  }
});

test('a missing named NPC is never replaced by a different speaker', () => {
  const world = createGameState('顾长生', 'ai', () => 'remote-named-person').astraWorld;
  const absent = world.characters['npc:lin-xiaoman'];
  absent.locationId = 'loc:elsewhere';
  const other = Object.values(world.characters).find(npc => npc.id !== absent.id && npc.alive);
  other.locationId = world.player.locationId;
  const plan = resolveAstraConversation(world, `${absent.name}，你能听见吗？`);
  assert.equal(plan.targetId, null);
  assert.equal(plan.absentName, absent.name);
  assert.equal(fallbackAstraConversation(world, plan), null);
});
