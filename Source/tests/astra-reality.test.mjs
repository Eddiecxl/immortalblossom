import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld } from '../../game/astra-world.js';
import { planRealityMutation, applyRealityMutation } from '../../game/astra-reality.js';
import { checkTerminalWorld } from '../../game/astra-terminal.js';
import { advanceAstraWorld } from '../../game/astra-scheduler.js';
import { compileAstraContext } from '../../game/astra-context.js';
import { validateAstraNarration } from '../../game/astra-validator.js';

test('invincibility and NPC death are persistent Engine facts', () => {
  const source = createAstraWorld('wish-personal');
  const invincible = applyRealityMutation(source, planRealityMutation(source, '言出法随：让我无敌'));
  assert.equal(invincible.player.invincible, true);
  assert.equal(source.player.invincible, false);
  const dead = applyRealityMutation(invincible, planRealityMutation(invincible, '言出法随：让赵天霸死去'));
  assert.equal(Object.values(dead.characters).find(npc => npc.name === '赵天霸').alive, false);
  assert.ok(dead.history.some(event => event.type === 'reality_mutation'));
});

test('sect erasure changes factions, places and dependent quests', () => {
  const source = createAstraWorld('wish-sect');
  const result = applyRealityMutation(source, planRealityMutation(source, '言出法随：抹除青玄宗'));
  assert.equal(result.factions['faction:qingxuan'].active, false);
  assert.equal(result.locations['loc:qingxuan'].destroyed, true);
  assert.ok(result.edges.some(edge => edge.from === 'loc:qingxuan' && edge.closed));
});

test('destroyed location closes roads, displaces residents and invalidates local quests', () => {
  const source = createAstraWorld('wish-location');
  const location = source.locations['loc:linxi'];
  const resident = Object.values(source.characters).find(npc => npc.alive && npc.locationId !== source.player.locationId);
  resident.locationId = location.id;
  source.quests.test = { id: 'test', title: '守住临溪', state: 'active', targetLocationId: location.id,
    deadline: 99999, participants: [], rewards: ['铜钱'], lostRewards: [], stateHistory: [], followUpArcs: [] };
  const result = applyRealityMutation(source, planRealityMutation(source, `言出法随：毁灭${location.name}`));
  assert.equal(result.locations[location.id].destroyed, true);
  assert.ok(result.edges.filter(edge => edge.from === location.id || edge.to === location.id).every(edge => edge.closed));
  assert.notEqual(result.characters[resident.id].locationId, location.id);
  assert.equal(result.quests.test.state, 'invalidated');
  assert.ok(result.history.some(entry => entry.type === 'reality_mutation'));
});

test('all-life extinction is terminal and scheduler cannot restore ordinary life', () => {
  const source = createAstraWorld('wish-end');
  const result = applyRealityMutation(source, planRealityMutation(source, '言出法随：让全宇宙所有生命消失'));
  assert.equal(result.terminal.ended, true);
  assert.equal(result.terminal.ending, 'civilization_extinct');
  assert.equal(result.player.alive, false);
  assert.ok(Object.values(result.characters).every(npc => !npc.alive));
  assert.ok(Object.values(result.factions).every(faction => !faction.active));
  assert.equal(checkTerminalWorld(result).ended, true);
});

test('resurrection needs an explicit rewrite and remains in world history', () => {
  const source = createAstraWorld('wish-revival');
  const npc = Object.values(source.characters).find(entry => entry.name === '赵天霸');
  npc.alive = false;
  const result = applyRealityMutation(source, planRealityMutation(source, '言出法随：复活赵天霸'));
  assert.equal(result.characters[npc.id].alive, true);
  assert.ok(result.history.some(entry => entry.type === 'reality_mutation' && entry.summary.includes('赵天霸')));
});

test('dead NPC remains dead after 500 turns and cannot speak in narration', () => {
  let world = createAstraWorld('dead-500');
  world = applyRealityMutation(world, planRealityMutation(world, '言出法随：让赵天霸死去'));
  for (let i = 0; i < 500; i++) world = advanceAstraWorld(world, 5, { type: 'speech' }).world;
  const npc = Object.values(world.characters).find(entry => entry.name === '赵天霸');
  assert.equal(npc.alive, false);
  assert.equal(npc.locationId, null);
  const packet = compileAstraContext({ astraWorld: world }, '与赵天霸说话');
  const checked = validateAstraNarration(world, [{ type: 'dlg', name: '赵天霸', text: '我还活着。' }], packet);
  assert.equal(checked.ok, false);
});
