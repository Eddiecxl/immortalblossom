import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState } from '../../game/game-state.js';
import { createAstraOpening } from '../../game/astra-opening.js';
import { resolveAstraConversation, fallbackAstraConversation } from '../../game/astra-interaction.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
import { sceneAffordances } from '../../game/astra-affordances.js';

test('guidance respects unavailable quest givers and never substitutes faction business for a personal goal',()=>{
 const w=createGameState('试行者','ai',()=> 'orientation-6').astraWorld;
 const npc=Object.values(w.characters).find(n=>n.name==='陈不归');
 npc.locationId=w.player.locationId;npc.travel=null;npc.currentGoals=['keep the inn solvent'];
 assert.equal(sceneAffordances(w,npc.id).goal,'维持客栈的经营');
 w.quests.q={id:'q',title:'旧委托',giverId:npc.id,targetLocationId:w.player.locationId,state:'mutated'};
 npc.alive=false;
 assert.doesNotMatch(sceneAffordances(w).nextStep,/向陈不归询问/);
 npc.alive=true;npc.currentGoals=['a new unknown freeform goal'];
 assert.equal(sceneAffordances(w,npc.id).goal,'','unknown goal must not become an invented translated fact');
});

test('openings acknowledge transmigration and supply a real next step across seeds', () => {
  for (let i=0;i<48;i++) {
    const source=createGameState('试行者','ai',()=>`orientation-${i}`);
    const result=createAstraOpening(source), w=result.state.astraWorld;
    const visible=result.turn.blocks.map(b=>b.text).join('');
    assert.match(visible,/穿越|另一世|另一段人生/);
    assert.doesNotMatch(visible,/正忙于自己的事情|谁也不会因为我停下/);
    assert.notEqual(result.state.director.sceneGoal,'先弄清眼前人事，决定此世的第一步。');
    const people=Object.values(w.characters).filter(n=>n.alive&&!n.travel&&n.locationId===w.player.locationId);
    if(people.length) assert.ok(visible.includes(people[0].name));
    assert.equal(source.astraWorld.minute,360,'opening must not mutate its caller');
  }
});

test('confusion prompts orient to current world instead of generic ignorance across seeds and changes', () => {
  for(let i=0;i<24;i++) {
    const state=createAstraOpening(createGameState('试行者','ai',()=>`orientation-reply-${i}`)).state;
    const w=state.astraWorld,npc=w.characters['npc:lin-xiaoman'];
    npc.locationId=w.player.locationId;npc.travel=null;npc.goals=['去找我的朋友'];npc.currentGoals=['去找我的朋友'];
    w.flags.conversation={npcId:npc.id,locationId:w.player.locationId,minute:w.minute};
    for(const speech of ['？','啥情况','这里是哪？','我来帮你','接下来怎么办？']) {
      const reply=fallbackAstraConversation(w,resolveAstraConversation(w,speech));
      assert.ok(reply);
      const text=reply.blocks.map(b=>b.text).join('');
      assert.doesNotMatch(text,/这件事我眼下不清楚|你能说得具体些吗/);
      assert.ok(text.includes(w.locations[w.player.locationId].name)||text.includes('去找我的朋友'));
    }
  }
});

test('engine degradation is recorded and disclosed, with no invented quest', async () => {
  const state=createGameState('试行者','ai',()=> 'degradation-test');
  const npc=state.astraWorld.characters['npc:lin-xiaoman'];npc.locationId=state.astraWorld.player.locationId;npc.travel=null;
  const runner=createAiTurnRunner({aiClient:{narrate:async()=>{throw Error('Local runtime unavailable');}},transcriptStore:{recentTurns:async()=>[],allTurns:async()=>[],appendTurn:async()=>{}}});
  const result=await runner.runWorld({state,input:{speech:npc.name+'，这里是哪？'},settings:{mode:'local'}});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.turn.provider,'engine');
  assert.ok(result.turn.diagnostics?.degraded);
  assert.ok(result.blocks.some(b=>b.type==='sys'&&/有限回应/.test(b.text)));
  assert.deepEqual(result.state.astraWorld.quests,state.astraWorld.quests);
});
