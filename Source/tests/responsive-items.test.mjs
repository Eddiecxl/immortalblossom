import test from 'node:test';import assert from 'node:assert/strict';
import {createMainStoryState} from '../../game/astra-main-story.js';import {createAstraOpening} from '../../game/astra-opening.js';
import {useAstraInventory,parseInventoryCommand} from '../../game/astra-inventory.js';import {createAiTurnRunner} from '../../game/ai-turn.js';
import {offerCommitment} from '../../game/astra-commitments.js';
const setup=()=>createAstraOpening(createMainStoryState('顾长生',()=> 'responsive-items')).state;
test('compound item commands cannot silently execute only the longest named item',()=>{
 const w=setup().astraWorld;const herb=w.items['item:main-herb'],letter=w.items['item:main-letter'];
 assert.equal(parseInventoryCommand(w,`使用${herb.name}，再阅读${letter.name}`),null);
});
function ground(s){const w=s.astraWorld,i=w.items['item:main-herb'];w.player.inventory=w.player.inventory.filter(id=>id!==i.id);i.ownerId=null;i.locationId=w.player.locationId;return i;}
function offer(s,condition){const w=s.astraWorld,i=ground(s),n=w.characters['npc:lin-xiaoman'];i.ownerId=n.id;n.inventory.push(i.id);offerCommitment(w,{offer:{id:'offer:herb',fromId:n.id,toId:'player',itemId:i.id,...(condition?{condition}:{})}},{turnId:'offer-turn'});return i;}
test('nearby unowned items can be picked up once with actual ownership history',()=>{
 const s=setup(),i=ground(s),before=structuredClone(s.astraWorld);
 const r=useAstraInventory(s.astraWorld,{itemId:i.id,action:'take'},{turnId:'pickup'});
 assert.equal(r.world.items[i.id].ownerId,'player');assert.ok(r.world.player.inventory.includes(i.id));assert.equal(r.world.items[i.id].quantity,2);
 assert.equal(r.world.items[i.id].transferHistory.at(-1).source,'pickup');assert.deepEqual(s.astraWorld,before);
 assert.throws(()=>useAstraInventory(r.world,{itemId:i.id,action:'take'}));
});
test('pickup cannot take remote, travelling or living NPC-owned items',()=>{
 const s=setup(),i=ground(s);i.locationId='loc:linxi';assert.throws(()=>useAstraInventory(s.astraWorld,{itemId:i.id,action:'take'}));
 i.locationId=s.astraWorld.player.locationId;s.astraWorld.player.travel={from:i.locationId,to:'loc:linxi'};assert.throws(()=>useAstraInventory(s.astraWorld,{itemId:i.id,action:'take'}));
 s.astraWorld.player.travel=null;i.ownerId='npc:lin-xiaoman';s.astraWorld.characters[i.ownerId].inventory.push(i.id);assert.throws(()=>useAstraInventory(s.astraWorld,{itemId:i.id,action:'take'}));
});
test('accepting a recorded offer transfers once, while unmet conditions and refusal preserve ownership',()=>{
 const s=setup(),i=offer(s);const r=useAstraInventory(s.astraWorld,{itemId:i.id,action:'accept'},{turnId:'accepted'});
 assert.equal(r.world.items[i.id].ownerId,'player');assert.equal(r.world.simulation.commitments['offer:herb'].state,'fulfilled');
 const no=useAstraInventory(s.astraWorld,{itemId:i.id,action:'decline'},{turnId:'declined'});assert.equal(no.world.items[i.id].ownerId,'npc:lin-xiaoman');assert.equal(no.world.simulation.commitments['offer:herb'].state,'declined');
 const conditional=setup();offer(conditional,{op:'eq',left:{entityId:'player',field:'wealth'},right:999});assert.throws(()=>useAstraInventory(conditional.astraWorld,{itemId:i.id,action:'accept'}));
});
test('typed base names and picking up an already owned herb never require AI or try to equip medicine',async()=>{
 let s=setup(),calls=0;s.astraWorld.items['item:main-herb'].name='止血草·上品';
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>{calls++;throw Error('No network for items');}}});
 for(const action of ['拿起止血草','吃掉止血草']){const r=await runner.runWorld({state:s,input:{action},settings:{renderSettledScenes:false}});assert.equal(r.ok,true,r.error);s=r.state;}
 assert.equal(s.astraWorld.player.health,100);assert.equal(s.astraWorld.items['item:main-herb'].quantity,1);assert.equal(calls,0);
});
test('a named ground item is acquired by typed action without a cloud round trip',async()=>{
 const s=setup(),i=ground(s);let calls=0;const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>{calls++;throw Error('Cloud unavailable');}}});
 const r=await runner.runWorld({state:s,input:{action:'捡起止血草'},settings:{renderSettledScenes:false}});assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.items[i.id].ownerId,'player');assert.equal(calls,0);
});
test('fast known law executes without AI even when the provider is exhausted and counts the committed invocation',async()=>{
 const s=setup();let calls=0;const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>{calls++;throw Object.assign(Error('quota'),{status:429});}}});
 const r=await runner.runWorld({state:s,input:{action:'言出法随：把我提升到最高境界'},settings:{renderSettledScenes:false}});
 assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.player.cultivation.realm,'tribulation');assert.equal(calls,0);assert.equal(r.state.astraWorld.flags.realityInvocations,1);
});
test('valid open-ended reality operations survive invalid optional prose without another cloud request',async()=>{
 const s=setup();let calls=0;
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>{calls++;return JSON.stringify({blocks:[{type:'dlg',name:'不存在的幽灵',text:'你只是凡人，不可能成功。'}],worldPlan:{operations:[{type:'entity.create',kind:'item',entity:{id:'item:morning-jade',name:'晨露玉佩',category:'accessory',ownerId:'player',quantity:1,effects:[{type:'heal',target:'player',magnitude:'full'}]}}]}});}}});
 const r=await runner.runWorld({state:s,input:{action:'言出法随：创造一枚名为晨露玉佩的法器，放进我的行囊；使用一次即可治好我所有伤势。'},settings:{renderSettledScenes:false}});
 assert.equal(r.ok,true,r.error);assert.equal(calls,1);assert.equal(r.state.astraWorld.items['item:morning-jade'].ownerId,'player');
 assert.ok(!r.blocks.some(b=>b.name==='不存在的幽灵'||b.text.includes('不可能成功')));
 const used=useAstraInventory(r.state.astraWorld,{itemId:'item:morning-jade',action:'use'});assert.equal(used.world.player.health,used.world.player.maxHealth);
});
test('immediate reality mode still rejects invalid operations without partial changes',async()=>{
 const s=setup(),before=structuredClone(s);
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{throw Error('Must not commit');}},aiClient:{narrate:async()=>JSON.stringify({blocks:[{type:'narr',text:'敕令落定。'}],worldPlan:{operations:[{type:'entity.create',kind:'item',entity:{id:'item:morning-jade',name:'晨露玉佩',category:'accessory',ownerId:'player',quantity:1,effects:[{type:'invented_unsupported_effect',target:'player'}]}}]}})}});
 const r=await runner.runWorld({state:s,input:{action:'言出法随：创造一枚晨露玉佩，使用一次治好我所有伤势。'},settings:{renderSettledScenes:false}});
 assert.equal(r.ok,false);assert.deepEqual(s,before);assert.equal(r.state.astraWorld.items['item:morning-jade'],undefined);
});
