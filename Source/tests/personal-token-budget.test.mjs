import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveTokens,settleTokens,TOKEN_LIMITS} from '../../game/token-budget.js';

test('personal predictive overestimate reserves a full window rather than permanently rejecting player input',()=>{
 const admitted=reserveTokens({},11000,'law',100000);
 assert.equal(admitted.ok,true);
 assert.equal(admitted.ledger.records[0].tokens,TOKEN_LIMITS.minute);
 const settled=settleTokens(admitted.ledger,'law',3100);
 assert.equal(settled.records[0].tokens,3100);
});

test('estimated large requests still wait for shared reservations and explicit provider cooldown',()=>{
 const prior={records:[{id:'other',at:100000,tokens:3100}],pauseUntil:190000};
 const queued=reserveTokens(prior,11000,'law',100100);
 assert.equal(queued.ok,false);assert.equal(queued.code,'AI_TOKEN_COOLDOWN');assert.ok(queued.retryAfterMs>=89900);
 assert.equal(queued.ledger.records.length,1);
 assert.equal(reserveTokens(queued.ledger,11000,'law',190001).ok,true);
 for(const invalid of [0,-1,NaN,Infinity])assert.equal(reserveTokens({},invalid,'bad',100000).ok,false);
});
