import test from 'node:test';import assert from 'node:assert/strict';import{createMainStoryState}from '../../game/astra-main-story.js';import{applyWorldPlan}from '../../game/astra-operations.js';import{worldEntity,evaluateCondition}from '../../game/astra-expression.js';import{compileAstraContext}from '../../game/astra-context.js';
import{propagateCausality}from '../../game/astra-causality.js';
const setup=()=>createMainStoryState('顾长生',()=> 'experience-any-seed');
test('a non-numeric law interaction is a persisted fact with real targets, memory and usable conditions',()=>{
 const state=setup(),w=state.astraWorld,input={action:'言出法随：我在林小满脸颊上亲一口'},plan={operations:[{type:'experience.record',actorId:'player',targetIds:['npc:lin-xiaoman'],kind:'contact',description:'顾长生在林小满脸颊上亲了一口。',evidence:'在林小满脸颊上亲一口'}]};
 const result=applyWorldPlan(w,plan,{mode:'reality',turnId:'contact-one',input,enforceScope:true});propagateCausality(result.world);const facts=Object.values(result.world.simulation.experiences);assert.equal(facts.length,1);const fact=facts[0];assert.equal(fact.state,'occurred');assert.equal(worldEntity(result.world,fact.id).actorId,'player');assert.ok(evaluateCondition(result.world,{op:'eq',left:{entityId:fact.id,field:'state'},right:'occurred'}));assert.ok(result.world.characters['npc:lin-xiaoman'].memories.some(m=>m.summary.includes('亲了一口')));assert.equal(w.simulation?.experiences,undefined);
 const p=compileAstraContext({...state,astraWorld:result.world},'她怎么反应？',[]);assert.ok(p.recentExperiences.some(e=>e.id===fact.id));
 const again=applyWorldPlan(result.world,plan,{mode:'reality',turnId:'contact-one',input});assert.equal(Object.keys(again.world.simulation.experiences).length,1);
});
test('experience records cannot smuggle resource or life changes, target outsiders, or trigger from ordinary speech',()=>{
 const w=setup().astraWorld,base={type:'experience.record',actorId:'player',targetIds:['npc:lin-xiaoman'],kind:'gesture',description:'顾长生挥了挥手。',evidence:'挥手'},context={mode:'reality',turnId:'scope-test',input:{action:'言出法随：我向林小满挥手'},enforceScope:true};
 assert.throws(()=>applyWorldPlan(w,{operations:[{...base,alive:false}]},context));assert.throws(()=>applyWorldPlan(w,{operations:[{...base,targetIds:['npc:cast-0']}]},context));assert.throws(()=>applyWorldPlan(w,{operations:[base]},{...context,mode:'ordinary'}));
 assert.throws(()=>applyWorldPlan(w,{operations:[{...base,claims:[{entityId:'npc:lin-xiaoman',field:'alive',value:false}]}]},context));
 assert.throws(()=>applyWorldPlan(w,{operations:[{...base,kind:'death',description:'林小满已经死去。',evidence:'让林小满死去'}]},{...context,input:{action:'言出法随：让林小满死去'}}));
});
test('AI-added ordinary cultivation prerequisites cannot disable an unconditional explicit law',()=>{
 const w=setup().astraWorld;const r=applyWorldPlan(w,{operations:[{type:'entity.update',targetId:'player',condition:{op:'eq',left:{entityId:'player',field:'cultivation.realm'},right:'tribulation'},changes:{invincible:true}}]},{mode:'reality',turnId:'no-ordinary-gate',enforceScope:true,input:{action:'言出法随：让我无敌'}});assert.equal(r.world.player.invincible,true);
});
test('a current unambiguous pronoun refers to the actual person rather than failing the law name-scope check',()=>{
 const w=setup().astraWorld,plan={operations:[{type:'entity.update',targetId:'npc:lin-xiaoman',changes:{personality:'温和'}},{type:'relation.upsert',fromId:'npc:lin-xiaoman',toId:'player',kind:'trust',weight:1}]};
 const r=applyWorldPlan(w,plan,{mode:'reality',turnId:'pronoun-law',enforceScope:true,conversationTargetId:'npc:lin-xiaoman',input:{action:'言出法随：让她变得温和并忠诚于我'}});assert.equal(r.world.characters['npc:lin-xiaoman'].relationships.player,100);
 assert.throws(()=>applyWorldPlan(w,{operations:[{type:'entity.update',targetId:'npc:cast-0',changes:{personality:'温和'}}]},{mode:'reality',turnId:'wrong-pronoun',enforceScope:true,conversationTargetId:'npc:lin-xiaoman',input:{action:'言出法随：让她变得温和'}}));
});
