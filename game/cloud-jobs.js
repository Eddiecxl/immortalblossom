import {waitForRequestSlot,cancellationError,reportRequestState} from './beta4/request-gate.js';

// Poll one durable job; quota waiting never resubmits the player's turn.
export async function waitForCloudJob({job,fetchStatus,signal,clock=Date.now,wait=waitForRequestSlot,
 report=reportRequestState,maxWaitMs=20*60*1000}) {
 const jobId=job?.jobId;
 if(typeof jobId!=='string'||!/^[a-zA-Z0-9:_-]{1,100}$/u.test(jobId))throw Object.assign(Error('云端队列编号无效；输入已保留。'),{code:'AI_NETWORK_FAILED'});
 const started=clock();let latest=job;
 while(!latest?.text){
  if(signal?.aborted)throw cancellationError(signal);
  const left=maxWaitMs-(clock()-started);
  if(left<=0)throw Object.assign(Error('云端额度仍在等待；输入已保留，可以稍后继续。'),{code:'AI_RATE_LIMITED',jobId,retryAfterMs:Math.max(1000,Number(latest.retryAt)-clock()||10000),status:429});
  const delay=Math.min(left,Math.max(1000,Number(latest.pollAfterMs)||2000,Number(latest.retryAt)-clock()||0));
  const until=clock()+delay;
  while(clock()<until){
   report({busy:true,phase:latest.retryAt>clock()?'quota-wait':'queued',ms:until-clock(),jobId});
   await wait(Math.min(1000,until-clock()),signal);
  }
  if(signal?.aborted)throw cancellationError(signal);
  try{latest=await fetchStatus(jobId);}
  catch(error){
   if(signal?.aborted)throw cancellationError(signal);
   if(error?.terminalJob||!(['AI_NETWORK_FAILED','AI_TIMEOUT'].includes(error?.code)
     ||[408,425,429].includes(error?.status)||error?.status>=500))throw error;
   // A failed status request says nothing about the upstream job. Resume
   // polling that job; never submit another generation on this path.
   latest={...latest,pollAfterMs:Math.max(2000,Number(error.retryAfterMs)||0)};
  }
 }
 return latest;
}
