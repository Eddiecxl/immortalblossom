import test from 'node:test';import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {useAstraInventory,itemUsageOptions} from '../../game/astra-inventory.js';
const setup=(base='herb')=>{const w=createGameState('顾长生','ai',()=> 'inventory-truth').astraWorld;const id='item:test';w.items[id]={id,templateId:'item:'+base+':standard',name:'测试物品',ownerId:'player',quantity:2,durability:100,destroyed:false,creationHistory:[{source:'test'}],transferHistory:[]};w.player.inventory.push(id);return {w,id,item:w.items[id]};};
test('standard medicine changes Astra health, consumes one real quantity and leaves source untouched',()=>{
 const {w,id}=setup();w.player.health=40;const r=useAstraInventory(w,{itemId:id,action:'use'},{turnId:'heal'});
 assert.ok(r.world.player.health>40);assert.equal(r.world.items[id].quantity,1);assert.equal(w.player.health,40);assert.equal(w.items[id].quantity,2);
 assert.equal(r.world.history.at(-1).type,'item_consumed');assert.doesNotMatch(r.summary,/\d|气血/u);
});
test('full health does not waste a standard treatment, and missing ownership cannot use the other same-named item',()=>{
 const {w,id,item}=setup();assert.throws(()=>useAstraInventory(w,{itemId:id,action:'use'}),/无需|已满/u);
 w.player.health=30;item.ownerId='npc:other';assert.throws(()=>useAstraInventory(w,{itemId:id,action:'use'}),/持有/u);
});
test('equipment uses stable IDs, is not consumed, and reading a document leaves a persistent knowledge record',()=>{
 const {w,id}=setup('training-staff');const equipped=useAstraInventory(w,{itemId:id,action:'equip'},{turnId:'equip'});
 assert.equal(equipped.world.player.equipment.weapon,id);assert.equal(equipped.world.items[id].quantity,2);
 const paper=setup('family-letter');const read=useAstraInventory(paper.w,{itemId:paper.id,action:'read'},{turnId:'read'});
 assert.ok(read.world.player.knowledge.includes(paper.id));assert.equal(read.world.items[paper.id].quantity,2);
});
test('materials and automatic protection explain legitimate uses without fake consumption; ID rejects ambiguous names',()=>{
 const material=setup('iron-ore');assert.ok(itemUsageOptions(material.w,material.item).some(o=>o.action==='inspect'));assert.throws(()=>useAstraInventory(material.w,{itemId:material.id,action:'use'}),/材料|不能/u);
 const talisman=setup('talisman');assert.ok(itemUsageOptions(talisman.w,talisman.item).some(o=>o.action==='passive'&&o.disabled));
 const second={...material.item,id:'item:second'};material.w.items[second.id]=second;material.w.player.inventory.push(second.id);assert.throws(()=>useAstraInventory(material.w,{name:second.name,action:'inspect'}),/多件/u);
});
test('all catalog weapon/document families expose their real actions, and generated protections are passive',()=>{
 for(const base of ['escort-saber','hunting-bow','soul-bell','life-artifact']){const x=setup(base);x.item.templateId='item:'+base+':serviceable';assert.ok(itemUsageOptions(x.w,x.item).some(o=>o.action==='equip'));}
 const doc=setup('birth-record');doc.item.templateId='item:birth-record:copy';assert.ok(itemUsageOptions(doc.w,doc.item).some(o=>o.action==='read'));
 const ward=setup('ward');ward.item.generated=true;ward.item.effects=[{type:'prevent_lethal',charges:1}];assert.ok(itemUsageOptions(ward.w,ward.item).some(o=>o.action==='passive'));assert.ok(!itemUsageOptions(ward.w,ward.item).some(o=>o.action==='use'));
});
test('healing reconciles the remaining injury grade, spirit medicine restores real spirit, and capped pills do not claim a change',()=>{
 const wound=setup();wound.w.player.health=15;wound.w.player.physicalCondition='critically_injured';const healed=useAstraInventory(wound.w,{itemId:wound.id,action:'use'});assert.equal(healed.world.player.physicalCondition,'injured');
 const qi=setup('qi-pill');qi.w.player.spirit=0;qi.w.player.maxSpirit=30;const restored=useAstraInventory(qi.w,{itemId:qi.id,action:'use'});assert.ok(restored.world.player.spirit>0);assert.equal(restored.world.player.health,100);
 const cap=setup();cap.w.player.cultivation.realm='tribulation';cap.item.generated=true;cap.item.effects=[{type:'cultivation.advance_major_realm',target:'player',magnitude:1}];const used=useAstraInventory(cap.w,{itemId:cap.id,action:'use'});assert.equal(used.event.applied,false);assert.doesNotMatch(used.summary,/效果已经落在身上/u);
});
