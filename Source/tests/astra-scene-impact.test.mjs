import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {describeSceneImpact,conciseEngineAftermath} from '../../game/astra-scene-impact.js';

const scene=()=>{
 const before=createGameState('顾长生','ai',()=> 'scene-impact').astraWorld;
 for(const npc of Object.values(before.characters)){npc.locationId=null;npc.travel=null;}
 return {before,after:structuredClone(before),npcIds:Object.keys(before.characters)};
};

test('a wish alone does not create an impact and both helpers are read-only',()=>{
 const {before,after}=scene(),original=JSON.stringify({before,after});
 assert.equal(describeSceneImpact(before,after,{actionType:'reality',statement:'让天下人都跪下'}),null);
 assert.deepEqual(conciseEngineAftermath(before,after,{actionType:'reality'}),[]);
 assert.equal(JSON.stringify({before,after}),original);
});

test('teleport describes the actual destination and only living stationary witnesses there',()=>{
 const {before,after,npcIds}=scene(),origin=before.player.locationId;
 const destination=Object.keys(after.locations).find(id=>id!==origin);
 after.player.locationId=destination;
 const [present,dead,traveling,absent]=npcIds.map(id=>after.characters[id]);
 Object.assign(present,{alive:true,locationId:destination});
 Object.assign(dead,{alive:false,locationId:destination});
 Object.assign(traveling,{alive:true,locationId:destination,travel:{from:destination,to:origin}});
 Object.assign(absent,{alive:true,locationId:origin});
 const original=JSON.stringify({before,after});
 const impact=describeSceneImpact(before,after,{actionType:'reality',statement:'传送到另一处'});
 assert.equal(impact.kind,'teleport');assert.equal(impact.source.id,origin);assert.equal(impact.destination.id,destination);
 assert.equal(impact.destination.name,after.locations[destination].name);
 assert.deepEqual(impact.witnesses.map(n=>n.id),[present.id]);
 assert.ok(impact.sensorySuggestions.length);assert.equal(impact.healthDelta,0);
 assert.equal(JSON.stringify({before,after}),original);
});

test('ordinary travel arrival does not become a teleport and transit excludes residents',()=>{
 const {before,after,npcIds}=scene();const edge=before.edges.find(e=>e.from===before.player.locationId);
 before.player.travel={from:edge.from,to:edge.to,arriveAt:before.minute+20};
 after.player.locationId=edge.to;after.player.travel=null;
 assert.equal(describeSceneImpact(before,after,{actionType:'travel'}).kind,'arrival');
 after.player.travel={from:edge.from,to:edge.to,arriveAt:after.minute+20};
 after.player.cultivation.realm='foundation';
 Object.assign(after.characters[npcIds[0]],{alive:true,locationId:after.player.locationId});
 assert.deepEqual(describeSceneImpact(before,after,{actionType:'reality'}).witnesses,[]);
});

test('realm and identity facts use both real snapshots including custom realm names',()=>{
 const {before,after}=scene();
 after.rules.cultivation.realms.push({id:'realm:star',name:'星海境'});
 after.player.cultivation.realm='realm:star';after.player.name='江行舟';after.player.gender='female';
 const impact=describeSceneImpact(before,after,{actionType:'reality'});
 assert.equal(impact.kind,'realm-change');assert.equal(impact.beforeRealm.name,'凡人');assert.equal(impact.afterRealm.name,'星海境');
 assert.ok(impact.kinds.includes('identity'));assert.equal(impact.identity.name.to,'江行舟');
 assert.equal(impact.identity.gender.to,'female');assert.equal(impact.healthDelta,0);
 assert.equal(impact.invincible,false);
});

test('NPC death and revival retain actual IDs, omit newly created people, and bound context',()=>{
 const {before,after,npcIds}=scene();
 for(const id of npcIds.slice(0,9)){before.characters[id].alive=true;after.characters[id].alive=false;}
 const revivedId=npcIds[9];before.characters[revivedId].alive=false;after.characters[revivedId].alive=true;
 after.characters['npc:new']={id:'npc:new',name:'新人',alive:true,locationId:after.player.locationId};
 const impact=describeSceneImpact(before,after,{actionType:'reality'});
 assert.equal(impact.kind,'death-revival');assert.equal(impact.killed.length,6);assert.equal(impact.killedCount,9);
 assert.deepEqual(impact.revived.map(n=>n.id),[revivedId]);assert.equal(impact.revivedCount,1);
 assert.ok(!impact.revived.some(n=>n.id==='npc:new'));
});

test('engine aftermath adds short embodied beats without granting reactions, damage or dialogue',()=>{
 const {before,after}=scene();after.player.locationId=Object.keys(after.locations).find(id=>id!==before.player.locationId);
 const copy=JSON.stringify(after),blocks=conciseEngineAftermath(before,after,{actionType:'reality'});
 assert.ok(blocks.length>=2&&blocks.length<=3);assert.ok(blocks.every(b=>b.type==='narr'));
 const prose=blocks.map(b=>b.text).join('');
 assert.ok(prose.includes(after.locations[after.player.locationId].name));
 assert.doesNotMatch(prose,/众人|围观|跪下|房屋|房子|屋顶|气血\d|实际代价|你/);
 assert.equal(JSON.stringify(after),copy);
});

test('player life changes and protection are grounded, with no invented nearby people',()=>{
 const {before,after}=scene();before.player.alive=false;before.player.health=0;
 after.player.alive=true;after.player.health=50;after.player.invincible=true;
 const impact=describeSceneImpact(before,after,{actionType:'reality'});
 assert.equal(impact.kind,'death-revival');assert.deepEqual(impact.playerLife,{before:false,after:true});
 assert.equal(impact.healthDelta,50);assert.equal(impact.invincible,true);assert.deepEqual(impact.witnesses,[]);
 const blocks=conciseEngineAftermath(before,after,{actionType:'reality'});
 assert.ok(blocks.map(b=>b.text).join('').includes('呼吸'));
});
