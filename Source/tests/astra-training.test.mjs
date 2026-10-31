import test from 'node:test';import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {parseTrainingAction,settleTraining} from '../../game/astra-training.js';
const setup=()=>createGameState('顾长生','ai',()=> 'ordinary-training').astraWorld;
test('ordinary training accumulates real minutes across sessions and reaches the first realm without a law',()=>{
 const w=setup();const a=parseTrainingAction(w,'静坐修炼一小时');assert.equal(a.minutes,60);w.minute+=a.minutes;const first=settleTraining(w,a,'train-1');assert.equal(w.player.cultivation.realm,'none');assert.equal(w.player.cultivation.trainingMinutes,60);assert.equal(first.applied,false);
 const saved=JSON.parse(JSON.stringify(w));saved.minute+=60;const next=settleTraining(saved,a,'train-2');assert.equal(saved.player.cultivation.realm,'qi_refining');assert.equal(next.applied,true);assert.ok(saved.history.some(e=>e.type==='breakthrough'));
 const snapshot=JSON.stringify(saved);settleTraining(saved,a,'train-2');assert.equal(JSON.stringify(saved),snapshot);
});
test('training respects cap, explicit time and injury, and cannot run while travelling or after death',()=>{
 const w=setup();w.player.cultivation.realm='tribulation';w.player.health=60;const cap=settleTraining(w,{minutes:600},'cap');assert.equal(cap.applied,false);assert.equal(w.player.health,60);assert.equal(w.player.cultivation.realm,'tribulation');
 assert.equal(parseTrainingAction(w,'修炼30分钟').minutes,30);assert.equal(parseTrainingAction(w,'不想修炼'),null);assert.equal(parseTrainingAction(w,'练习挥剑攻击林小满'),null);
 w.player.travel={to:'loc:liuhe'};assert.throws(()=>settleTraining(w,{minutes:60},'road'),/旅途/u);w.player.travel=null;w.player.health=0;assert.throws(()=>settleTraining(w,{minutes:60},'dead'),/生命|终结/u);
});
test('a critically injured beginner does not gain the same progress as a healthy one; changed realm caps govern subsequent study',()=>{
 const w=setup();w.player.health=10;w.player.physicalCondition='critically_injured';settleTraining(w,{minutes:120},'hurt');assert.equal(w.player.cultivation.realm,'none');assert.ok(w.player.cultivation.trainingMinutes<120);
 w.player.cultivation.realm='qi_refining';w.player.cultivation.maxRealmId='qi_refining';const before=w.player.health;const r=settleTraining(w,{minutes:10000},'personal-cap');assert.equal(r.applied,false);assert.equal(w.player.health,before);assert.equal(w.player.cultivation.realm,'qi_refining');
});
