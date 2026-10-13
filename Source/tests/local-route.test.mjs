import test from 'node:test';
import assert from 'node:assert/strict';
import { createV31HybridClient, loadV31AiSettings } from '../../game/v4-hybrid-client.js';
import { aiHttpError } from '../../game/ai-errors.js';

const memoryStorage = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
};
const response = (data, status = 200) => ({ ok: status < 400, status,
  headers: { get: () => null }, json: async () => data });

test('local scene and repair budgets leave room for both world operations and narrative',async()=>{
 for(const requestType of ['world','repair']){
  let sent;
  const client=createV31HybridClient({storage:memoryStorage(),fetchImpl:async(path,options)=>{
   if(path==='/api/ai/status')return response({ready:true});
   if(path==='/api/ai/cloud/status')return response({configured:{}});
   sent=JSON.parse(options.body);return response({text:'{"blocks":[]}'});
  }});
  await client.narrate({mode:'local'},{requestType,messages:[]});
  assert.ok(sent.maxTokens>=768);
 }
});

test('new settings prefer Groq while an explicit Local mode never sends a cloud generation', async () => {
  const storage = memoryStorage();
  assert.equal(loadV31AiSettings(storage).mode, 'groq');
  const paths = [];
  const fetchImpl = async path => {
    paths.push(path);
    if (path === '/api/ai/status') return response({ modelInstalled: true, runtimeInstalled: true });
    if (path === '/api/ai/cloud/status') return response({ configured: { groq: true } });
    if (path === '/api/ai/generate') return response({ text: '{"blocks":[]}' });
    throw new Error(`Unexpected request: ${path}`);
  };
  const client = createV31HybridClient({ fetchImpl, storage });
  const text = await client.narrate({ mode: 'local', journeyId: 'local-test' }, { messages: [] });
  assert.equal(text, '{"blocks":[]}');
  assert.ok(paths.includes('/api/ai/generate'));
  assert.ok(!paths.includes('/api/ai/cloud/generate'));
  assert.equal(client.loadSticky('local-test').provider, 'local');
});

test('Cloud Only does not generate on local and records the chosen provider', async () => {
  const storage = memoryStorage();
  const paths = [];
  const fetchImpl = async path => {
    paths.push(path);
    if (path === '/api/ai/status') return response({ modelInstalled: true, runtimeInstalled: true });
    if (path === '/api/ai/cloud/status') return response({ configured: { groq: true } });
    if (path === '/api/ai/cloud/generate') return response({ text: '{"blocks":[]}' });
    throw new Error(`Unexpected request: ${path}`);
  };
  const client = createV31HybridClient({ fetchImpl, storage });
  await client.narrate({ mode: 'groq', journeyId: 'cloud-test' }, { messages: [] });
  assert.ok(paths.includes('/api/ai/cloud/generate'));
  assert.ok(!paths.includes('/api/ai/generate'));
  assert.equal(client.loadSticky('cloud-test').provider, 'groq');
});
test('native proxy string errors retain the real cloud cooldown without leaking upstream details',()=>{
  const error=aiHttpError(response({},429),{code:'AI_CLOUD_FAILED',error:'provider HTTP 429: {"error":{"message":"Rate limit on input tokens per minute (ITPM): Limit 7000, Used 6000, Requested 3000. Please try again in 23.657142857s."}}'},true);
  assert.equal(error.retryAfterMs,23658);
  assert.equal(error.quota.scope,'TPM');assert.equal(error.quota.limit,7000);
  assert.ok(!error.message.includes('provider HTTP'));
});
test('long provider quota waits do not trigger a premature second request or local fallback',async()=>{
  const storage=memoryStorage();let requests=0;
  const fetchImpl=async path=>{
    if(path==='/api/ai/status')return response({ready:true});
    if(path==='/api/ai/cloud/status')return response({configured:{groq:true}});
    requests++;return response({code:'AI_CLOUD_FAILED',error:'provider HTTP 429: Please try again in 21m0s.'},429);
  };
  const client=createV31HybridClient({fetchImpl,storage});
  await assert.rejects(()=>client.narrate({mode:'groq'},{messages:[]}),e=>e.code==='AI_RATE_LIMITED'&&e.retryAfterMs===1260000);
  assert.equal(requests,1);
});

test('terminal durable job failure is not submitted six times',async()=>{
 let submissions=0;
 const client=createV31HybridClient({storage:memoryStorage(),fetchImpl:async path=>{
  if(path==='/api/ai/status')return response({});
  if(path==='/api/ai/cloud/status')return response({configured:{groq:true}});
  if(path==='/api/ai/cloud/generate'){submissions++;return response({jobId:'safe-job',state:'queued'},202);}
  return response({code:'AI_TIMEOUT',error:'timeout',terminalJob:true},504);
 }});
 await assert.rejects(()=>client.narrate({mode:'groq'},{transactionId:'stable-turn',messages:[]}),e=>e.terminalJob===true);
 assert.equal(submissions,1);
});

test('transient queue polling failure keeps the old job instead of generating twice',async()=>{
 let submissions=0,polls=0;
 const client=createV31HybridClient({storage:memoryStorage(),fetchImpl:async path=>{
  if(path==='/api/ai/status')return response({});
  if(path==='/api/ai/cloud/status')return response({configured:{groq:true}});
  if(path==='/api/ai/cloud/generate'){submissions++;return response({jobId:'safe-job',state:'queued'},202);}
  polls++;return polls===1?response({code:'AI_UPSTREAM_FAILED'},503):response({text:'原任务已经完成。'});
 }});
 assert.equal(await client.narrate({mode:'groq'},{transactionId:'same-turn',messages:[]}),'原任务已经完成。');
 assert.equal(submissions,1);assert.equal(polls,2);
});

test('connection probes each have a fresh transaction after changing keys',async()=>{
 const transactions=[];const client=createV31HybridClient({storage:memoryStorage(),fetchImpl:async(path,options)=>{
  if(path.endsWith('/test'))transactions.push(JSON.parse(options.body).transactionId);
  return response({text:'ok'});
 }});
 await client.testProvider('groq','qwen/qwen3.8-27b');
 await client.saveCredential('groq','gsk_example');
 await client.testProvider('groq','qwen/qwen3.8-27b');
 assert.ok(transactions.every(Boolean));assert.notEqual(...transactions);
});
