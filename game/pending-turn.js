// The uncommitted turn lives outside the world checkpoint. Retrying the same
// input at the same revision reuses its queue job, including after page reload.
export function createPendingTurns(storage=globalThis.localStorage,idFactory=()=>crypto.randomUUID()){
 const key='luoxian_pending_cloud_turn_v1';
 function raw(){try{return JSON.parse(storage?.getItem(key)||'null');}catch{return null;}}
 function clear(){const previous=raw();if(previous?.id)for(let attempt=0;attempt<3;attempt++)
  storage?.removeItem?.('luoxian_cloud_request:'+previous.id+':narrative:'+attempt);
  storage?.removeItem?.(key);
 }
 return {
  read(state){const previous=raw();return previous?.journeyId===state?.journeyId&&previous.revision===state?.revision?previous:null;},
  prepare(state,input,settings){
   const route=JSON.stringify({mode:settings.mode,preferred:settings.preferred,models:settings.models});
   const previous=this.read(state);
   if(previous&&JSON.stringify(previous.input)===JSON.stringify(input)&&previous.route===route)return previous;
   clear();const record={id:idFactory(),journeyId:state.journeyId,revision:state.revision,input,route,createdAt:new Date().toISOString()};
   storage?.setItem(key,JSON.stringify(record));return record;
  },clear
 };
}
