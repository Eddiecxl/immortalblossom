import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, migrateGameState, GAME_SCHEMA_VERSION } from '../../game/game-state.js';
import { createStorage } from '../../game/storage.js';

function memoryStorage({ failBackup = false } = {}) {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (failBackup && key.endsWith('_pre_astra_backup')) throw new Error('backup unavailable');
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); }
  };
}

test('new saves begin with a deterministic mortal world and schema 6', () => {
  const first = createGameState('试行者', 'ai', () => 'seed-mortal');
  const second = createGameState('试行者', 'ai', () => 'seed-mortal');
  assert.equal(GAME_SCHEMA_VERSION, 6);
  assert.equal(first.schemaVersion, 6);
  assert.equal(first.player.realm, 0);
  assert.equal(first.astraWorld.player.cultivation.realm, 'none');
  assert.deepEqual(first.astraWorld, second.astraWorld);
  assert.ok(first.astraWorld.eventQueue.some(event => event.type === 'lin_first_encounter'));
});

test('schema 5 migration preserves legacy progress and creates stable world', () => {
  const old = createGameState('旧旅人', 'ai', () => 'legacy-seed');
  old.schemaVersion = 5;
  delete old.astraWorld;
  old.story.day = 17;
  old.story.location = '青石镇';
  const first = migrateGameState(old, 'ai');
  const second = migrateGameState(old, 'ai');
  assert.equal(first.schemaVersion, 6);
  assert.equal(first.story.day, 17);
  assert.equal(first.story.location, '青石镇');
  assert.equal(first.astraWorld.minute, (17 - 1) * 1440 + old.story.minuteOfDay);
  assert.deepEqual(first.astraWorld, second.astraWorld);
});

test('first schema 6 overwrite keeps the original schema 5 JSON exactly once', () => {
  const storage = memoryStorage();
  const key = 'luoying_v3_ai_auto';
  const old = createGameState('旧旅人', 'ai', () => 'legacy-backup');
  old.schemaVersion = 5;
  delete old.astraWorld;
  const original = JSON.stringify(old);
  storage.setItem(key, original);
  const saves = createStorage(storage, { idFactory: () => 'new-id', lockManager: null });
  saves.saveAuto('ai', old);
  assert.equal(storage.getItem(`${key}_pre_astra_backup`), original);
  assert.equal(JSON.parse(storage.getItem(key)).schemaVersion, 6);
  saves.saveAuto('ai', old);
  assert.equal(storage.getItem(`${key}_pre_astra_backup`), original);
});

test('failed migration backup leaves the original save untouched', () => {
  const storage = memoryStorage({ failBackup: true });
  const key = 'luoying_v3_ai_auto';
  const old = createGameState('旧旅人', 'ai', () => 'legacy-failure');
  old.schemaVersion = 5;
  delete old.astraWorld;
  const original = JSON.stringify(old);
  storage.values.set(key, original);
  const saves = createStorage(storage, { idFactory: () => 'new-id', lockManager: null });
  assert.throws(() => saves.saveAuto('ai', old), /backup unavailable/);
  assert.equal(storage.getItem(key), original);
});
