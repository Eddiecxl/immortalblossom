import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCloudJob } from '../../game/cloud-jobs.js';
test('queued cloud job waits for quota without submitting another generation or losing text',async()=>{
 let calls=0,now=0;const states=[];
 const result=await waitForCloudJob({job:{jobId:'a-safe-job',state:'queued',pollAfterMs:1000,retryAt:5000},clock:()=>now,
  wait:async ms=>{now+=ms;},report:s=>states.push(s),fetchStatus:async id=>{
   assert.equal(id,'a-safe-job');calls++;
   return calls===1?{state:'queued',pollAfterMs:1000,retryAt:10000}:{text:'继续发生的新剧情。'};
  }});
 assert.equal(result.text,'继续发生的新剧情。');assert.equal(calls,2);assert.ok(now>=10000);
 assert.ok(states.some(s=>s.phase==='quota-wait'));
});
test('cancelled queue does not poll or invent an answer',async()=>{
 const controller=new AbortController();controller.abort();let polled=false;
 await assert.rejects(()=>waitForCloudJob({job:{jobId:'safe'},signal:controller.signal,fetchStatus:async()=>{polled=true;}}));
 assert.equal(polled,false);
});
test('queue deadline preserves a retryable pending job instead of a fake scene',async()=>{
 let now=0;
 await assert.rejects(()=>waitForCloudJob({job:{jobId:'safe',state:'queued',retryAt:100000},clock:()=>now,maxWaitMs:5000,
  wait:async ms=>{now+=ms;},fetchStatus:async()=>({state:'queued'})}),e=>e.code==='AI_RATE_LIMITED'&&e.jobId==='safe');
});
test('polling survives transient network loss and request timeout without replacing the durable job',async()=>{
 let now=0,calls=0;
 const result=await waitForCloudJob({job:{jobId:'same-job',state:'queued'},clock:()=>now,
  wait:async ms=>{now+=ms;},fetchStatus:async id=>{
   assert.equal(id,'same-job');calls++;
   if(calls<3)throw Object.assign(Error('temporary transport failure'),{code:calls===1?'AI_NETWORK_FAILED':'AI_TIMEOUT'});
   return {text:'同一段剧情终于返回。'};
  }});
 assert.equal(result.text,'同一段剧情终于返回。');assert.equal(calls,3);
});
test('terminal job errors are surfaced once even when they use a retryable HTTP status',async()=>{
 let now=0,calls=0;
 await assert.rejects(()=>waitForCloudJob({job:{jobId:'terminal-job'},clock:()=>now,
  wait:async ms=>{now+=ms;},fetchStatus:async()=>{calls++;throw Object.assign(Error('terminal'),{status:504,terminalJob:true});}}),/terminal/);
 assert.equal(calls,1);
});
