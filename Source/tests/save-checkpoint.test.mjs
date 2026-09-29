import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createSaveSession } from '../../game/beta4/save-session.js';

test('every committed turn updates the continue checkpoint', async () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const transcriptStore = { allTurns: async () => [{ id: 'turn-1' }] };
  const session = createSaveSession({ stateStore: {}, transcriptStore, storage });
  const initial = createGameState('试行者', 'ai', () => 'checkpoint');
  await session.begin(initial);
  const next = structuredClone(initial);
  next.memory.turnCount += 1;
  next.astraWorld.minute += 5;
  assert.equal(await session.committed(next), true);
  assert.equal(session.peek().astraWorld.minute, next.astraWorld.minute);
  assert.equal(session.info().checkpoint.endId, 'turn-1');
});
