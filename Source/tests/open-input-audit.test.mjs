import test from 'node:test';import assert from 'node:assert/strict';
import {createMainStoryState} from '../../game/astra-main-story.js';import {createAstraOpening} from '../../game/astra-opening.js';import {validateAstraNarration} from '../../game/astra-validator.js';import {createAiTurnRunner} from '../../game/ai-turn.js';
const setup=()=>createAstraOpening(createMainStoryState('顾长生',()=> 'open-audit')).state;
test('walking toward a person or doorway is not rejected as an invalid world-map journey',async()=>{
 for(const action of ['我走向林小满，忽然开始跳舞','我前往门边，敲三下门']){
  const s=setup();let calls=0;const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>{calls++;return JSON.stringify({blocks:[{type:'narr',text:'我挪动脚步，林小满朝门边看了一眼。'},{type:'dlg',name:'林小满',text:'轻一点，外面的人还没走。你想让我替你望风吗？'}]});}}});
  const r=await runner.runWorld({state:s,input:{action},settings:{narrativePolicy:'playable'}});assert.equal(r.ok,true,r.error);assert.equal(calls,1);assert.equal(r.state.astraWorld.player.locationId,s.astraWorld.player.locationId);
 }
});
test('second-person words inside quoted NPC speech do not invalidate a first-person scene',()=>{
 const s=setup(),r=validateAstraNarration(s,[{type:'narr',text:'我忽然跳起舞来，听见林小满在旁边嘀咕：“你还真有闲心。”'}]);assert.equal(r.ok,true,JSON.stringify(r.errors));
});
test('remembering a dead character speaking does not resurrect or activate them',()=>{
 const s=setup(),w=s.astraWorld,n=w.characters['npc:cast-0'];n.alive=false;n.health=0;
 const r=validateAstraNarration(s,[{type:'narr',text:`我想起${n.name}生前说过的话，脚步停了一下。`}]);assert.equal(r.ok,true,JSON.stringify(r.errors));
 assert.equal(validateAstraNarration(s,[{type:'dlg',name:n.name,text:'我现在就站在这里。'}]).ok,false);
});
test('speaking about a dead NPC or wishing for their revival does not make the corpse speak',()=>{
 const s=setup(),n=s.astraWorld.characters['npc:cast-0'];n.alive=false;n.health=0;
 for(const text of [`林小满看着${n.name}的尸体，低声说道：“先离开这里吧。”`,`林小满说她希望${n.name}能够复活。`])assert.equal(validateAstraNarration(s,[{type:'narr',text}]).ok,true,text);
 assert.equal(validateAstraNarration(s,[{type:'narr',text:`我想起${n.name}生前的话，但${n.name}此刻开口说道：“我回来了。”`}]).ok,false);
});
test('an unrelated action can finish without a cloud repair for a minor viewpoint issue in playable mode',async()=>{
 const s=setup();let calls=0;const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>{calls++;return JSON.stringify({blocks:[{type:'narr',text:'你忽然跳起一段滑稽的舞，林小满忍不住笑出了声。'},{type:'dlg',name:'林小满',text:'先停停，门口的人还在催呢。你这是打算逗他笑，还是想让我替你望风？'}],worldPlan:{operations:[]}});}}});
 const r=await runner.runWorld({state:s,input:{action:'无端端跳一段滑稽的舞'},settings:{narrativePolicy:'playable'}});assert.equal(r.ok,true,r.error);assert.equal(calls,1);assert.ok(r.state.astraWorld.minute>s.astraWorld.minute);
});
test('playable policy still refuses an unrecorded revival and preserves the world',async()=>{
 const s=setup(),n=s.astraWorld.characters['npc:cast-0'];n.alive=false;n.health=0;const before=structuredClone(s.astraWorld);
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async()=>JSON.stringify({blocks:[{type:'dlg',name:n.name,text:'我复活了，来和你跳舞。'}]})}});
 const r=await runner.runWorld({state:s,input:{action:'跳舞'},settings:{narrativePolicy:'playable'}});assert.equal(r.ok,false);assert.deepEqual(r.state.astraWorld,before);
});
test('removing a duplicate paragraph preserves a fresh NPC response without another AI request',async()=>{
 const s=setup(),old='柴门外的脚步声又响了起来，潮湿的空气沉沉地压在柴草上。';let calls=0;
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[{blocks:[{type:'narr',text:old}]}],appendTurn:async()=>{}},aiClient:{narrate:async()=>{calls++;return JSON.stringify({blocks:[{type:'narr',text:old},{type:'dlg',name:'林小满',text:'你这转身差点撞到门。先看清脚下，我替你听着外面。'}]});}}});
 const r=await runner.runWorld({state:s,input:{action:'转身跳一支舞'},settings:{narrativePolicy:'playable'}});assert.equal(r.ok,true,r.error);assert.equal(calls,1);assert.ok(!r.blocks.some(b=>b.text===old));assert.ok(r.blocks.some(b=>b.type==='dlg'));
});
