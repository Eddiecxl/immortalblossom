import {createTranscriptStore} from './transcript-store.js';

// Desktop retains its real WebView bridge. A website uses isolated browser and
// session-backed ledgers; it never presents browser storage as Windows DPAPI.
if(typeof window!=='undefined'&&!window.lxNative&&location.port!=='24824') {
 window.lxCloud=true;
 const key='luoxian_v31_ai_settings_v2',migration='luoxian_cloud_beta_preset_v1';
 let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
 if(!localStorage.getItem(migration)||saved.mode!=='groq'){
  localStorage.setItem(key,JSON.stringify({...saved,mode:'groq',preferred:'groq'}));
  localStorage.setItem(migration,'1');
 }
 async function api(path,payload){
  const r=await fetch(path,{method:payload===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},
   ...(payload===undefined?{}:{body:JSON.stringify(payload)}),cache:'no-store'});
  const data=await r.json();if(!r.ok)throw Error(data.error||'云端命簿暂时无法连接；浏览器记录仍保留。');return data;
 }
 // Establish one session before concurrent status/save requests can issue cookies.
 await api('/api/status');
 const syncedWorlds=new Set();
 window.nativeAction=async(action,p={})=>{
  switch(action){
   case 'world-save':{
    const result=await api('/api/world/save',p),worldId=p.record.state.journeyId;
    if(!syncedWorlds.has(worldId)){
     const turns=await createTranscriptStore().allTurns(worldId);
     // Long Chinese transcripts can exceed the endpoint's byte ceiling well
     // before 100 rows. Retain original rows and bound both dimensions.
     const encoder=new TextEncoder(),limit=4*1024*1024;
     let batch=[],bytes=encoder.encode(JSON.stringify({worldId,turns:[]})).byteLength;
     for(const turn of turns){
      const size=encoder.encode(JSON.stringify(turn)).byteLength;
      if(batch.length&&(batch.length===100||bytes+size+1>=limit)){
       await api('/api/world/import-turns',{worldId,turns:batch});batch=[];
       bytes=encoder.encode(JSON.stringify({worldId,turns:[]})).byteLength;
      }
      if(bytes+size>=limit)throw Error('单条行记超过云端同步大小；原记录仍保留在浏览器。');
      bytes+=size+(batch.length?1:0);batch.push(turn);
     }
     if(batch.length)await api('/api/world/import-turns',{worldId,turns:batch});
     syncedWorlds.add(worldId);
    }
    return result;
   }
   case 'world-load':{
    const record=await api('/api/world/load');
    if(record?.state?.journeyId){
     const turns=await api('/api/world/turns?worldId='+encodeURIComponent(record.state.journeyId));
     if(Array.isArray(turns)&&turns.length){
      const store=createTranscriptStore(),local=await store.allTurns(record.state.journeyId);
      const merged=[...new Map([...local,...turns].map(turn=>[turn.id,turn])).values()]
        .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
      await store.importTurns(record.state.journeyId,merged);
     }
    }
    return record;
   }
   case 'world-memory-search':return api('/api/world/memory',p);
   case 'close':location.assign('/launcher/');return {closed:true};
   case 'launch-game':location.assign('/game/v4/'+(p.settings?'?settings=1':''));return {active:true};
   case 'game-status':return {active:false};
   case 'window-status':return {mode:document.fullscreenElement?'fullscreen':'windowed',width:innerWidth,height:innerHeight};
   case 'close-guard':return {enabled:true};
   default:throw Error('网页版本请在游戏内管理命簿和设置。');
  }
 };
}
