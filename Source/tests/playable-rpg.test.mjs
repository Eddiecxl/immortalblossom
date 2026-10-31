import test from 'node:test';import assert from 'node:assert/strict';
import {createMainStoryState} from '../../game/astra-main-story.js';import {createAstraOpening} from '../../game/astra-opening.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';import {commitInventoryAction} from '../../game/beta4/inventory-command.js';
import {inventoryRows} from '../../game/beta4/rpg-view.js';
const setup=()=>createAstraOpening(createMainStoryState('顾长生',()=> 'rpg-path')).state;
function harness(source){let state=source,calls=0;const turns=[];const runner=createAiTurnRunner({aiClient:{narrate:async()=>{calls++;throw Error('unexpected AI');}},transcriptStore:{recentTurns:async()=>turns,appendTurn:async(_,t)=>turns.push(t)}});return {get state(){return state},get calls(){return calls},async act(action){const r=await runner.runWorld({state,input:{action},transactionId:'rpg-'+turns.length,settings:{renderSettledScenes:false}});assert.equal(r.ok,true,r.error);state=r.state;return r;}};}
test('main RPG path heals, equips, reads and trains against real state with zero AI overhead',async()=>{
 const h=harness(setup());await h.act('服用止血草');assert.equal(h.state.astraWorld.player.health,100);assert.equal(h.state.astraWorld.items['item:main-herb'].quantity,1);
 await h.act('装备练武木棍');await h.act('阅读贴身旧信');assert.equal(h.state.astraWorld.player.equipment.weapon,'item:main-staff');
 await h.act('前往临溪镇');assert.equal(h.state.astraWorld.flags.mainStory.stage,'escape');
 await h.act('等待15分钟');assert.equal(h.state.astraWorld.player.locationId,'loc:linxi');assert.equal(h.state.astraWorld.flags.mainStory.stage,'cultivation');
 await h.act('打坐修炼一小时');await h.act('打坐修炼一小时');assert.equal(h.state.astraWorld.player.cultivation.realm,'qi_refining');assert.equal(h.state.astraWorld.flags.mainStory.stage,'sect');assert.equal(h.calls,0);
});
test('ordinary attack cannot bypass cultivation, while explicit law succeeds first and allows real nonlethal victory',async()=>{
 const weak=harness(setup());await weak.act('挥拳攻击赵天霸');assert.equal(weak.state.astraWorld.player.alive,false);assert.equal(weak.state.player.hp,0);
 const strong=harness(setup());await strong.act('言出法随：把我的修为提升到当前世界的最高境界');await strong.act('制服赵天霸，但不杀他');
 const n=strong.state.astraWorld.characters['npc:cast-0'];assert.equal(n.alive,true);assert.equal(n.health,1);assert.equal(strong.state.astraWorld.player.cultivation.realm,'tribulation');
});
test('drawer item use commits through the journal with the real instance ID and leaves no legacy-only heal',async()=>{
 const source=setup(),writes=[];const stateStore={saveAutoIfJourney:async(mode,s,id,revision)=>{assert.equal(id,source.journeyId);writes.push(s);return s;},recoverPendingTurn:async(mode,s,store)=>{await store.appendTurn(s.journeyId,s.transactionJournal.turn);return {...s,transactionJournal:null};}};
 const turns=[],rows=inventoryRows(source);assert.ok(rows.find(r=>r.itemId==='item:main-letter').actions.some(a=>a.id==='read'));
 const result=await commitInventoryAction(source,{itemId:'item:main-herb',name:'止血草',action:'use'},{stateStore,transcriptStore:{appendTurn:async(_,t)=>turns.push(t)}});
 assert.equal(result.ok,true);assert.equal(result.state.player.hp,100);assert.equal(result.state.astraWorld.player.health,100);assert.equal(source.player.hp,72);assert.equal(writes.length,1);assert.equal(turns.length,1);assert.equal(result.state.transactionJournal,null);
});
