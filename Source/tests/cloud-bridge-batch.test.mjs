import test from 'node:test';
import assert from 'node:assert/strict';

const limit=4*1024*1024;

async function importThroughBridge(t,turns,worldId) {
  const names=['window','location','localStorage','indexedDB','fetch'];
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const [name,descriptor] of originals) {
    if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  }});
  const values=new Map(),imports=[];
  globalThis.window={};globalThis.location={port:'8787'};
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  // Only the external IndexedDB request/transaction boundary is simulated.
  globalThis.indexedDB={open(){
    const request={result:{close(){},transaction(){
      const transaction={objectStore:()=>({index:()=>({getAll:()=>{
        const result={result:turns.map((turn,order)=>({...turn,journeyId:worldId,order}))};
        queueMicrotask(()=>{result.onsuccess();setTimeout(()=>transaction.oncomplete?.(),0);});
        return result;
      }})})};return transaction;
    }}};
    queueMicrotask(()=>request.onsuccess());return request;
  }};
  globalThis.fetch=async(path,options={})=>{
    if(path==='/api/world/import-turns'){
      const bytes=new TextEncoder().encode(options.body).byteLength;
      const payload=JSON.parse(options.body);imports.push({bytes,payload});
      if(bytes>=limit||payload.turns.length>100)return Response.json({error:'batch exceeds cloud limit'},{status:413});
    }
    return Response.json({saved:true});
  };
  await import('../../game/cloud-bridge.js?batch-review='+encodeURIComponent(worldId));
  await window.nativeAction('world-save',{record:{state:{journeyId:worldId}},turn:null});
  return imports;
}

test('cloud transcript import batches obey UTF-8 byte limits and retain every original turn in order',async t=>{
  const worldId='batch-large-汉字';
  const turns=Array.from({length:120},(_,index)=>({id:'turn-'+index,kind:'world',
    blocks:[{type:'narr',text:'汉'.repeat(10000)},{type:'narr',text:'字'.repeat(10000)}]}));
  const imports=await importThroughBridge(t,turns,worldId);
  assert.ok(imports.length>1);
  assert.ok(imports.every(entry=>entry.bytes<limit&&entry.payload.turns.length<=100));
  assert.deepEqual(imports.flatMap(entry=>entry.payload.turns),turns);
});

test('cloud transcript import also retains its 100-turn count limit for small records',async t=>{
  const turns=Array.from({length:205},(_,index)=>({id:'turn-'+index,kind:'world',blocks:[{type:'narr',text:'小段行记'}]}));
  const imports=await importThroughBridge(t,turns,'batch-small');
  assert.deepEqual(imports.map(entry=>entry.payload.turns.length),[100,100,5]);
  assert.deepEqual(imports.flatMap(entry=>entry.payload.turns),turns);
});
