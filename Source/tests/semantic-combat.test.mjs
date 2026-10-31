import test from 'node:test';import assert from 'node:assert/strict';
import {createMainStoryState} from '../../game/astra-main-story.js';import {applyWorldPlan} from '../../game/astra-operations.js';
const source=()=>createMainStoryState().astraWorld;
const action='抄起木棍照赵天霸脑袋来一下',op={type:'combat.exchange',targetId:'npc:cast-0',mode:'physical',evidence:action};
const ctx={turnId:'semantic-strike',mode:'ordinary',input:{action}};
test('AI semantic attack proposal uses the same realm rules, not AI chosen damage; source stays immutable',()=>{
 const w=source(),result=applyWorldPlan(w,{operations:[op]},ctx);assert.equal(result.world.player.alive,false);assert.equal(w.player.health,72);
 assert.ok(result.world.characters['npc:cast-0'].alive);assert.ok(result.world.history.some(e=>e.type==='battle'));
 assert.throws(()=>applyWorldPlan(w,{operations:[{...op,damage:999}]},ctx),/不能指定/u);
 assert.throws(()=>applyWorldPlan(w,{operations:[op,op]},ctx));
});
test('speech, hypothetical action, absent targets, replay and reality cannot borrow ordinary combat',()=>{
 for(const input of [{speech:action},{action:'如果我'+action+'会怎样'}])assert.throws(()=>applyWorldPlan(source(),{operations:[op]},{...ctx,input}));
 assert.throws(()=>applyWorldPlan(source(),{operations:[op]},{...ctx,settledAction:'attack'}));
 assert.throws(()=>applyWorldPlan(source(),{operations:[op]},{...ctx,mode:'reality'}));
 const away=source();away.characters[op.targetId].locationId='loc:linxi';assert.throws(()=>applyWorldPlan(away,{operations:[op]},ctx));
});
