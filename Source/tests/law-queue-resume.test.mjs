import test from 'node:test';import assert from 'node:assert/strict';import{createLawQueueResume}from '../../game/beta4/law-queue-resume.js';
test('queued law resumes its exact saved input, without new clicks or replacing another draft',async()=>{
 let state={journeyId:'a',revision:1},busy=false,pending={id:'same-job',input:{speech:'',action:'言出法随：改写一个新概念',invocation:true}},timer,called=[];
 const queue=createLawQueueResume({getState:()=>state,readPending:()=>pending,isReady:()=>!busy,submit:async input=>{called.push(input);},setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{}});
 queue.schedule();busy=true;await timer();assert.equal(called.length,0);busy=false;await timer();assert.deepEqual(called,[pending.input]);
 queue.schedule();state={journeyId:'b',revision:1};await timer();assert.equal(called.length,1);
});
test('ordinary dialogue and cleared/replaced pending laws are not silently replayed',async()=>{
 let pending={id:'old',input:{action:'言出法随：原指令',invocation:true}},timer,calls=0;
 const q=createLawQueueResume({getState:()=>({journeyId:'a',revision:1}),readPending:()=>pending,isReady:()=>true,submit:async()=>calls++,setTimer:fn=>(timer=fn,1),clearTimer:()=>{}});
 q.schedule();pending={id:'new',input:{speech:'新的普通对白'}};await timer();assert.equal(calls,0);
});
test('a readiness race that declines submission retains automatic retry',async()=>{
 let timer,calls=0;const p={id:'same',input:{invocation:true,action:'言出法随：一个新概念'}};const q=createLawQueueResume({getState:()=>({journeyId:'a',revision:1}),readPending:()=>p,isReady:()=>true,submit:async()=>++calls===1?undefined:true,setTimer:fn=>(timer=fn,1),clearTimer:()=>{}});
 q.schedule();await timer();assert.equal(calls,1);await timer();assert.equal(calls,2);
});
