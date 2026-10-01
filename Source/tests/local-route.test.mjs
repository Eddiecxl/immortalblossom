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

test('new settings prefer local and Local mode never sends a cloud generation', async () => {
  const storage = memoryStorage();
  assert.equal(loadV31AiSettings(storage).mode, 'local');
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
    requests++;return response({code:'AI_CLOUD_FAILED',error:'provider HTTP 429: Please try again in 5m0s.'},429);
  };
  const client=createV31HybridClient({fetchImpl,storage});
  await assert.rejects(()=>client.narrate({mode:'groq'},{messages:[]}),e=>e.code==='AI_RATE_LIMITED'&&e.retryAfterMs===300000);
  assert.equal(requests,1);
});
