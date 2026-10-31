import test from 'node:test';import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {resolveCombatExchange,parseCombatAction} from '../../game/astra-combat.js';
const setup=()=>{const w=createGameState('顾长生','ai',()=> 'combat-rules').astraWorld;const n=w.characters['npc:lin-xiaoman'];n.locationId=w.player.locationId;n.travel=null;n.alive=true;n.cultivation={realm:'none',level:0};return {w,n};};
test('ordinary combat compares all realm ranks, not merely mortal versus cultivator or carrying a weapon',()=>{
 const {w,n}=setup();w.player.cultivation={realm:'qi_refining',level:1};n.cultivation={realm:'tribulation',level:1};
 const before=w.player.health;resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'weak-strike');
 assert.equal(n.alive,true);assert.ok(w.player.health<before);assert.equal(w.player.alive,false);
 const second=setup();second.w.player.cultivation={realm:'tribulation',level:1};
 const result=resolveCombatExchange(second.w,{actorId:second.n.id,mode:'physical'},'strong-strike');
 assert.equal(second.n.alive,false);assert.equal(second.w.player.health,100);assert.equal(result.winnerId,'player');
});
test('a same-realm strike creates lasting wounds and a second strike uses the remaining health',()=>{
 const {w,n}=setup();resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'first');
 assert.ok(n.health>0&&n.health<n.maxHealth);const remaining=n.health;
 const again=JSON.parse(JSON.stringify(w));resolveCombatExchange(again,{actorId:n.id,mode:'physical'},'second');
 assert.ok(again.characters[n.id].health<remaining);assert.equal(w.history.filter(e=>e.type==='battle').length,1);
});
test('serious recorded injury can overturn a one-realm advantage; saying a secret technique does not create one',()=>{
 const {w,n}=setup();w.player.cultivation={realm:'qi_refining',level:1};n.cultivation={realm:'foundation',level:1};n.maxHealth=100;n.health=1;n.physicalCondition='critically_injured';
 resolveCombatExchange(w,{actorId:n.id,mode:'physical',techniqueName:'不存在的必杀绝技'},'injured');assert.equal(n.alive,false);
 const ordinary=setup();ordinary.n.cultivation={realm:'foundation',level:1};
 resolveCombatExchange(ordinary.w,{actorId:ordinary.n.id,mode:'physical',techniqueName:'不存在的必杀绝技'},'claim');assert.equal(ordinary.n.alive,true);assert.equal(ordinary.w.player.alive,false);
});
test('magic consumes actual spirit, invincibility prevents damage, and a stored talisman is consumed once',()=>{
 const {w,n}=setup();w.player.cultivation={realm:'qi_refining',level:1};n.cultivation={realm:'tribulation',level:1};w.player.invincible=true;w.player.spirit=20;w.player.maxSpirit=30;
 resolveCombatExchange(w,{actorId:n.id,mode:'spell'},'magic');assert.ok(w.player.spirit<20);assert.equal(w.player.health,100);
 w.player.invincible=false;const id='item:guard';w.items[id]={id,templateId:'item:talisman:serviceable',name:'旧护身符',ownerId:'player',quantity:1,destroyed:false,transferHistory:[]};w.player.inventory.push(id);
 resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'guarded');assert.equal(w.player.alive,true);assert.equal(w.items[id].destroyed,true);
 resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'unguarded');assert.equal(w.player.alive,false);
});
test('nonlethal restraint and self-destruction have different real outcomes, and a transaction cannot damage twice',()=>{
 const {w,n}=setup();w.player.cultivation={realm:'tribulation',level:1};resolveCombatExchange(w,{actorId:n.id,mode:'physical',nonlethal:true},'subdue');assert.equal(n.alive,true);assert.equal(n.health,1);
 const hp=w.player.health;resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'subdue');assert.equal(w.player.health,hp);assert.equal(n.alive,true);
 const blast=setup();blast.w.player.cultivation={realm:'qi_refining',level:1};resolveCombatExchange(blast.w,{actorId:blast.n.id,mode:'self_destruct'},'blast');assert.equal(blast.w.player.alive,false);assert.equal(blast.n.alive,false);
});
test('targeted physical and spell attacks parse while observation, speech claims and absent targets do not',()=>{
 const {w,n}=setup();for(const text of ['挥拳攻击林小满','用火球轰向林小满','杀死林小满'])assert.equal(parseCombatAction(w,text)?.actorId,n.id);
 assert.equal(parseCombatAction(w,'打量林小满'),null);assert.equal(parseCombatAction(w,'我说我想杀死林小满'),null);
 n.travel={from:w.player.locationId,to:'loc:elsewhere'};assert.throws(()=>parseCombatAction(w,'攻击林小满'),/在场/u);
});
test('mercy is a modifier, while negated attacks are not actions; pronouns resolve only a present known target',()=>{
 const {w,n}=setup();w.flags.conversation={npcId:n.id,locationId:w.player.locationId};
 assert.equal(parseCombatAction(w,'制服林小满，但不杀她').nonlethal,true);
 assert.equal(parseCombatAction(w,'不攻击林小满'),null);
 assert.equal(parseCombatAction(w,'挥拳攻击她').actorId,n.id);
 n.travel={from:w.player.locationId,to:'loc:liuhe'};assert.throws(()=>parseCombatAction(w,'攻击她'),/在场/u);
});
test('recorded multi-charge protection is depleted rather than discarding a whole item on first charge',()=>{
 const {w,n}=setup();n.cultivation={realm:'tribulation',level:1};const id='item:two-lives';
 w.items[id]={id,name:'两仪护符',ownerId:'player',quantity:1,effects:[{type:'prevent_lethal',charges:2,restoreHealth:20}],destroyed:false,transferHistory:[]};w.player.inventory.push(id);
 resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'ward-1');assert.equal(w.items[id].effects[0].charges,1);assert.equal(w.items[id].destroyed,false);assert.equal(w.player.health,20);
 resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'ward-2');assert.equal(w.items[id].destroyed,true);assert.equal(w.player.alive,true);
 resolveCombatExchange(w,{actorId:n.id,mode:'physical'},'ward-3');assert.equal(w.player.alive,false);
});
test('a known technique is parsed and spends its recorded resource cost; an empty-field self-destruct still ends its user',()=>{
 const {w,n}=setup();w.player.cultivation={realm:'qi_refining',level:1};w.player.spirit=12;w.player.maxSpirit=30;
 w.player.techniques=[{id:'skill:burst',name:'破风掌',combatMultiplier:2,spiritCost:5}];
 const action=parseCombatAction(w,'用破风掌攻击林小满');assert.equal(action.techniqueName,'skill:burst');resolveCombatExchange(w,action,'known-skill');assert.equal(w.player.spirit,7);
 const alone=setup();for(const npc of Object.values(alone.w.characters))npc.locationId=null;alone.w.player.cultivation={realm:'qi_refining',level:1};
 const blast=parseCombatAction(alone.w,'我自爆');assert.equal(blast.mode,'self_destruct');resolveCombatExchange(alone.w,blast,'alone');assert.equal(alone.w.player.alive,false);assert.equal(alone.w.terminal.ending,'player_dead');
});
