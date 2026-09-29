import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnFlow } from '../../game/turn-flow.js';
import { createRequestGate } from '../../game/beta4/request-gate.js';

test('a committed turn locks once and releases after a short cooldown', () => {
  let time = 1000;
  const flow = createTurnFlow({ clock: () => time, cooldownMs: 1500 });
  assert.equal(flow.begin().ok, true);
  assert.equal(flow.begin().ok, false);
  flow.phase('ai_running');
  assert.equal(flow.state(), 'ai_running');
  flow.phase('engine_commit');
  flow.commit();
  assert.equal(flow.state(), 'cooldown');
  assert.equal(flow.begin().remainingMs, 1500);
  time += 1499;
  assert.equal(flow.begin().ok, false);
  time += 1;
  assert.equal(flow.begin().ok, true);
});

test('failed generation unlocks without committing or cooldown', () => {
  const flow = createTurnFlow();
  flow.begin();
  flow.fail();
  assert.equal(flow.state(), 'idle');
  assert.equal(flow.begin().ok, true);
});

test('provider spacing waits on the same request instead of failing a healthy turn', async () => {
  let time = 0;
  let waits = 0;
  const gate = createRequestGate({ clock: () => time, interval: () => 8000,
    wait: async ms => { waits++; time += ms; }, onState: () => {} });
  assert.equal(await gate.run(async () => 'first', undefined, 'groq'), 'first');
  assert.equal(await gate.run(async () => 'second', undefined, 'groq'), 'second');
  assert.equal(waits, 1);
  assert.equal(time, 8000);
});
