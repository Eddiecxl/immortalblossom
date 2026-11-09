// Resume the same saved transaction. No model resubmission or world mutation is
// performed here; a changed branch/input or explicit cancellation ends this work.
export function createLawQueueResume({getState,readPending,isReady,submit,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,ticket=null;
 const stop=()=>{if(timer!==null)clearTimer(timer);timer=null;ticket=null;};
 function schedule(){
  const s=getState(),p=readPending(s);if(!p?.input?.invocation)return;
  stop();ticket={id:p.id,journeyId:s.journeyId,revision:s.revision};const current=ticket;
  async function resume(){
   timer=null;const state=getState(),pending=readPending(state);
   if(ticket!==current||state?.journeyId!==current.journeyId||state?.revision!==current.revision||pending?.id!==current.id||!pending.input.invocation)return;
   if(!isReady()){timer=setTimer(resume,2500);return;}
   ticket=null;const result=await submit(structuredClone(pending.input));
   if(result===undefined&&ticket===null&&readPending(getState())?.id===current.id){ticket=current;timer=setTimer(resume,2500);}
  }
  timer=setTimer(resume,2500);
 }
 return {schedule,stop};
}
