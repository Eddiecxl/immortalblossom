import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld, normalizeAstraWorld } from '../../game/astra-world.js';
import { advanceAstraWorld } from '../../game/astra-scheduler.js';
import { compileAstraContext } from '../../game/astra-context.js';
import { validateAstraNarration } from '../../game/astra-validator.js';

function simulate(seed) {
  let world = createAstraWorld(seed, '长行者');
  let maxPacket = 0;
  for (let turn = 0; turn < 1000; turn++) {
    world = advanceAstraWorld(world, 15, { type: 'speech' }).world;
    if (turn % 100 === 0) {
      const packet = compileAstraContext({ astraWorld: world }, '我在这里说话。');
      maxPacket = Math.max(maxPacket, JSON.stringify(packet).length);
      assert.equal(validateAstraNarration(world, [{ type: 'narr', text: '我听见风从街口吹过。' }], packet).ok, true);
      world = normalizeAstraWorld(JSON.parse(JSON.stringify(world)), seed, '长行者');
    }
  }
  return { world, maxPacket };
}

test('1000 speech turns keep NPC initiative, early meeting, bounded save and deterministic history', () => {
  const first = simulate('soak-1000');
  const second = simulate('soak-1000');
  assert.deepEqual(first.world, second.world);
  assert.equal(first.world.flags.encounterLinResolved, true);
  assert.ok(first.world.history.some(entry => entry.type === 'npc_action'));
  assert.ok(first.world.history.some(entry => entry.type === 'anchor_open'));
  assert.ok(first.maxPacket <= 18_000);
  assert.ok(JSON.stringify(first.world).length < 2_000_000);
});
