import test from 'node:test';import assert from 'node:assert/strict';import{createMainStoryState}from'../../game/astra-main-story.js';import{createAstraOpening}from'../../game/astra-opening.js';import{createAiTurnRunner}from'../../game/ai-turn.js';import{createTranscriptStore}from'../../game/transcript-store.js';import{canResolveAstraTurnLocally}from'../../game/astra-turn.js';import{sceneChoices,rememberSceneChoices}from'../../game/astra-choices.js';
import{compileLocalInteraction}from '../../game/astra-local-interaction.js';import{applyWorldPlan}from '../../game/astra-operations.js';import{runNpcPlans}from '../../game/astra-npc.js';
const setup=()=>createAstraOpening(createMainStoryState('顾长生',()=> 'universal-choice-law'));
test('explicit multi-clause interaction law commits all contact details locally, duration and memories included',async()=>{
 const o=setup();let calls=0;const runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>{calls++;throw Error('cloud quota unavailable');}}});
 const input={action:'言出法随：亲林小满十分钟，舌吻至口水直流',invocation:true};assert.equal(canResolveAstraTurnLocally(o.state,input),true);
 const r=await runner.runWorld({state:o.state,input,transactionId:'contact-local',settings:{mode:'groq',autoAftermath:true,renderSettledScenes:false}});assert.equal(r.ok,true,r.error);assert.equal(calls,0);assert.equal(r.state.astraWorld.minute-o.state.astraWorld.minute,10);
 const records=Object.values(r.state.astraWorld.simulation.experiences);assert.equal(records.length,2);assert.ok(records.some(e=>e.description.includes('舌吻')&&e.description.includes('至口水直流')));assert.ok(records.some(e=>e.durationMinutes===10));assert.ok(r.state.astraWorld.characters['npc:lin-xiaoman'].memories.some(m=>m.summary.includes('亲')));assert.ok(r.state.astraWorld.flags.pendingAftermath);
});
test('local law compiler is seed/name independent and cannot partially execute a mixed mechanical command',async()=>{
 const o=setup();o.state.astraWorld.characters['npc:lin-xiaoman'].name='沈青禾';assert.equal(canResolveAstraTurnLocally(o.state,{action:'言出法随：拥抱沈青禾两分钟，再向她挥手',invocation:true}),true);
 assert.equal(canResolveAstraTurnLocally(o.state,{action:'言出法随：亲沈青禾10分钟',invocation:true}),true);
 for(const action of ['亲沈青禾，然后杀死赵天霸','亲沈青禾，同时给我一万灵石','如果沈青禾同意，就拥抱她'])assert.equal(canResolveAstraTurnLocally(o.state,{action:'言出法随：'+action,invocation:true}),false,action);
});
test('accepted author choices change with this scene and remain drafts, with real speech/action fields',async()=>{
 const o=setup(),w=o.state.astraWorld;rememberSceneChoices(w,[{label:'先问她缘由',speech:'你为什么愿意帮我？',targetIds:['npc:lin-xiaoman']},{label:'取出止血草',action:'使用止血草',targetIds:['item:main-herb']}],{turnId:'a'});
 const a=sceneChoices(w);assert.equal(a[0].speech,'你为什么愿意帮我？');assert.equal(a[0].action,undefined);assert.equal(w.items['item:main-herb'].quantity,2);
 rememberSceneChoices(w,[{label:'向她解释',speech:'刚才是我唐突了。',targetIds:['npc:lin-xiaoman']}],{turnId:'b'});assert.equal(sceneChoices(w)[0].speech,'刚才是我唐突了。');assert.ok(!sceneChoices(w).some(c=>c.label==='打坐修炼'));
 w.characters['npc:lin-xiaoman'].alive=false;assert.ok(!sceneChoices(w).some(c=>c.targetIds?.includes('npc:lin-xiaoman')));w.minute++;assert.ok(!sceneChoices(w).some(c=>c.label==='取出止血草'));
});
test('model choices are part of the same actual world response, no extra AI generation',async()=>{
 const o=setup();let calls=0;const runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>{calls++;return JSON.stringify({blocks:[{type:'dlg',name:'林小满',text:'先别急着出去。你想问什么？'}],worldPlan:{operations:[]},choices:[{label:'问受伤缘由',speech:'我为什么受伤？',targetIds:['npc:lin-xiaoman']},{label:'不急着走',speech:'我先缓缓。',targetIds:['npc:lin-xiaoman']}]});}}});
 const r=await runner.runWorld({state:o.state,input:{speech:'小满，等一下。'},settings:{mode:'groq',narrativePolicy:'playable',fastDialogue:true}});assert.equal(r.ok,true,r.error);assert.equal(calls,1);assert.equal(sceneChoices(r.state.astraWorld)[0].label,'问受伤缘由');
});
test('each clause keeps its own pronoun identity and sequential time interval',()=>{
 const w=setup().state.astraWorld;w.characters['npc:lin-xiaoman'].gender='female';const z=w.characters['npc:cast-0'];z.gender='male';
 const p=compileLocalInteraction(w,'拥抱林小满两分钟，然后拥抱他三分钟');assert.ok(p);assert.equal(p.operations[1].targetIds[0],z.id);assert.equal(p.operations[1].startsAfterMinutes,2);assert.equal(p.elapsedMinutes,5);
});
test('contact duration temporarily keeps participants present without changing their personality or plans',()=>{
 const w=setup().state.astraWorld,p=compileLocalInteraction(w,'拥抱林小满十分钟');assert.throws(()=>applyWorldPlan(w,{operations:p.operations},{mode:'reality',input:{action:'言出法随：拥抱林小满十分钟',invocation:true},turnId:'unaccounted-time',enforceScope:true}));const r=applyWorldPlan(w,{operations:p.operations},{mode:'reality',input:{action:'言出法随：拥抱林小满十分钟',invocation:true},turnId:'held-contact',enforceScope:true,timedInteraction:true});
 const n=r.world.characters['npc:lin-xiaoman'];n.lastPlanBucket=-1;const plan=structuredClone(n.currentPlan),personality=n.personality;runNpcPlans(r.world,w.minute+5);assert.equal(n.lastPlanBucket,-1);assert.deepEqual(n.currentPlan,plan);assert.equal(n.personality,personality);
});
test('inventory choices revalidate ownership and custom names are treated as text',()=>{
 const w=setup().state.astraWorld;rememberSceneChoices(w,[{label:'用止血草',action:'使用止血草',targetIds:['item:main-herb']}],{turnId:'use'});assert.equal(sceneChoices(w)[0].label,'用止血草');w.items['item:main-herb'].ownerId='npc:lin-xiaoman';assert.ok(!sceneChoices(w).some(c=>c.label==='用止血草'));
 w.characters['npc:lin-xiaoman'].name='青禾（';assert.doesNotThrow(()=>sceneChoices(w));
});
test('subminute laws preserve exact duration but use a valid whole-minute scheduler step; mixed timing is not truncated',async()=>{
 const o=setup(),runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>{throw Error('must not need cloud');}}});
 const r=await runner.runWorld({state:o.state,input:{action:'言出法随：拥抱林小满三十秒',invocation:true},settings:{mode:'groq',autoAftermath:true}});assert.equal(r.ok,true,r.error);assert.equal(r.state.astraWorld.minute-o.state.astraWorld.minute,1);assert.equal(Object.values(r.state.astraWorld.simulation.experiences)[0].durationMinutes,.5);
 assert.equal(canResolveAstraTurnLocally(o.state,{action:'言出法随：拥抱林小满十分钟，同时向她挥手，然后亲林小满十分钟',invocation:true}),false);
});
