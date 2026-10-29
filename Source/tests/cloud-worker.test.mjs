import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';

// Storage is the external Cloudflare boundary; classes and routing remain real.
const cloud = await import('../../cloud/worker.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

function memoryContext(storage = new Map()) {
  let alarmAt = null;
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const ctx = {
    storage: {
      async get(key) { return copy(storage.get(key)); },
      async put(key, value) {
        const pairs = typeof key === 'string' ? [[key, value]] : Object.entries(key);
        for (const [recordKey, record] of pairs) {
          assert.ok(new TextEncoder().encode(JSON.stringify(record)).length < 128 * 1024, 'Durable Object KV values must fit its per-value limit');
          storage.set(recordKey, copy(record));
        }
      },
      async delete(key) { return storage.delete(key); },
      async list({prefix = '', limit = Infinity} = {}) {
        return new Map([...storage].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([key, value]) => [key, copy(value)]));
      },
      async getAlarm() { return alarmAt; },
      async setAlarm(value) { alarmAt = value; },
      async deleteAlarm() { alarmAt = null; }
    },
    waitUntil(promise) { ctx.pending.push(promise); },
    pending: [],
    blockConcurrencyWhile(callback) { return callback(); }
  };
  return ctx;
}

function harness({key = 'gsk_shared_private_key', upstream = async () => completion('真实回复')} = {}) {
  assert.equal(typeof cloud.default?.fetch, 'function', 'the cloud Worker must provide a fetch handler');
  let time = 1800000000000;
  const env = {GROQ_API_KEY: key, CLOUD_VERSION: '4.1.4'};
  const makeNamespace = (Class, dependencies) => {
    const objects = new Map();
    const namespace = {
      idFromName: name => name,
      get(name) {
        if (!objects.has(name)) {
          const ctx = memoryContext();
          objects.set(name, {ctx, instance: new Class(ctx, env, dependencies), name});
        }
        return {fetch: (...args) => objects.get(name).instance.fetch(...args)};
      },
      objects,
      restart(name) {
        const previous = objects.get(name);
        previous.instance = new Class(previous.ctx, env, dependencies);
        return previous.instance;
      }
    };
    return namespace;
  };
  env.GROQ_QUEUE = makeNamespace(cloud.GroqQueue, {clock: () => time, fetchImpl: upstream});
  env.SESSION_STORE = makeNamespace(cloud.SessionStore, {clock: () => time});
  env.ASSETS = {fetch: async request => new Response(`asset:${new URL(request.url).pathname}`)};
  const visitor = () => {
    let cookie = '';
    return {
      async request(path, data, headers = {}) {
        const response = await cloud.default.fetch(new Request(`https://beta.example${path}`, {
          ...(data === undefined ? {} : {method: 'POST', body: typeof data === 'string' ? data : JSON.stringify(data)}),
          headers: {cookie, ...(data === undefined ? {} : {'Content-Type': 'application/json'}), ...headers}
        }), env, {waitUntil() {}});
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return response;
      }
    };
  };
  return {env, visitor, advance: ms => time += ms, now: () => time,
    queue: () => [...env.GROQ_QUEUE.objects.values()][0],
    async fire(record = [...env.GROQ_QUEUE.objects.values()][0]) { await record.instance.alarm(); }};
}

const completion = text => Response.json({choices: [{message: {role: 'assistant', content: text}}]});
const payload = transactionId => ({provider: 'groq', model: 'qwen/qwen3.8-27b', messages: [{role: 'user', content: '继续这段真实剧情'}], maxTokens: 256, temperature: 0.72, transactionId});
const jobPath = job => `/api/ai/cloud/jobs/${job.jobId}`;

test('structured game turns request JSON object mode while plain connection probes keep text mode', async () => {
 const sent=[];const app=harness({upstream:async(_url,options)=>{sent.push(JSON.parse(options.body));return completion('{"blocks":[{"type":"sys","text":"我在。"}]}');}});
 const player=app.visitor();
 await player.request('/api/ai/cloud/generate',{...payload('json-turn'),messages:[{role:'system',content:'只返回严格 JSON：{"blocks":[{"type":"narr","text":"..."}]}。'},{role:'user',content:'你好'}]});
 await app.fire();assert.deepEqual(sent[0].response_format,{type:'json_object'});
 await player.request('/api/ai/cloud/test',{provider:'groq'});await app.fire();
 assert.equal(sent[1].response_format,undefined);
});

test('an output-limited cloud completion is a terminal format failure and is never sent again', async () => {
  let calls=0;
  const app=harness({upstream:async()=>{
    calls++;
    return Response.json({choices:[{message:{content:'{"blocks":[{"type":"narr","text":"这一段表面完整。"}]}'},finish_reason:'length'}],usage:{prompt_tokens:15,completion_tokens:256}});
  }});
  const player=app.visitor();
  const job=await (await player.request('/api/ai/cloud/generate',payload('truncated-output'))).json();
  await app.fire();
  const response=await player.request(jobPath(job));
  const failure=await response.json();
  assert.equal(response.status,422);
  assert.equal(failure.code,'AI_OUTPUT_TRUNCATED');
  assert.equal(failure.terminalJob,true);
  assert.equal(failure.text,undefined);
  await player.request('/api/ai/cloud/generate',payload('truncated-output'));
  await app.fire();
  assert.equal(calls,1);
});

test('cloud JSON validation failures remain repairable format errors without exposing failed generations', async () => {
  let calls=0;
  const app=harness({upstream:async()=>{
    calls++;
    return Response.json({error:{code:'json_validate_failed',message:'private upstream account details',failed_generation:'private partial candidate'}},{status:400});
  }});
  const player=app.visitor();
  const job=await (await player.request('/api/ai/cloud/generate',payload('invalid-json-output'))).json();
  await app.fire();
  const response=await player.request(jobPath(job));
  const failure=await response.json();
  assert.equal(response.status,422);
  assert.equal(failure.code,'AI_INVALID_JSON');
  assert.equal(failure.terminalJob,true);
  assert.doesNotMatch(JSON.stringify(failure),/private/);
  assert.equal(calls,1);
});

test('cloud status uses the shared server secret without exposing it and disables local AI', async () => {
  const app = harness();
  const player = app.visitor();
  const status = await player.request('/api/ai/cloud/status');
  assert.equal(status.status, 200);
  assert.match(status.headers.get('set-cookie'), /HttpOnly/);
  assert.match(status.headers.get('set-cookie'), /Secure/);
  assert.match(status.headers.get('set-cookie'), /SameSite=Strict/);
  const data = await status.json();
  assert.equal(data.configured.groq, true);
  assert.equal(data.personal, false);
  assert.doesNotMatch(JSON.stringify(data), /gsk_shared_private_key/);
  assert.equal((await (await player.request('/api/ai/status')).json()).ready, false);
  const launcher = await (await player.request('/api/status')).json();
  assert.equal(launcher.healthy, true);
  assert.equal(launcher.cloud, true);
  assert.equal(launcher.version, '4.1.4');
});

test('generate returns a durable job immediately and alarm stores the actual Groq answer', async () => {
  let release;
  let sent;
  const app = harness({upstream: async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer gsk_shared_private_key');
    sent = JSON.parse(options.body);
    return new Promise(resolve => { release = resolve; });
  }});
  const player = app.visitor();
  const response = await player.request('/api/ai/cloud/generate', payload('turn-1'));
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.equal(job.state, 'queued');
  assert.ok(job.jobId.length >= 32);
  assert.ok(await app.queue().ctx.storage.getAlarm());
  const processing = app.fire();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const waiting = await player.request(jobPath(job));
  assert.equal(waiting.status, 202);
  assert.equal((await waiting.json()).state, 'running');
  assert.deepEqual(sent.messages, payload('turn-1').messages);
  assert.equal(sent.max_tokens, 256);
  release(completion('林小满抬头，回答了玩家的问题。'));
  await processing;
  const finished = await player.request(jobPath(job));
  assert.equal(finished.status, 200);
  assert.equal((await finished.json()).text, '林小满抬头，回答了玩家的问题。');
});

test('another visitor cannot read a job even with its unguessable ID', async () => {
  const app = harness();
  const first = app.visitor();
  const second = app.visitor();
  const job = await (await first.request('/api/ai/cloud/generate', payload('private-turn'))).json();
  await app.fire();
  const denied = await second.request(jobPath(job));
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).code, 'AI_JOB_NOT_FOUND');
  assert.equal((await first.request(jobPath(job))).status, 200);
});

test('repeated transactions and unchanged requests reuse a job and changed input cannot replace it', async () => {
  let calls = 0;
  const app = harness({upstream: async () => { calls++; return completion('一次生成'); }});
  const player = app.visitor();
  const first = await (await player.request('/api/ai/cloud/generate', payload('same-turn'))).json();
  const repeated = await (await player.request('/api/ai/cloud/generate', payload('same-turn'))).json();
  assert.equal(repeated.jobId, first.jobId);
  await app.fire();
  const completed = await (await player.request('/api/ai/cloud/generate', payload('same-turn'))).json();
  assert.equal(completed.jobId, first.jobId);
  const changed = await player.request('/api/ai/cloud/generate', {...payload('same-turn'), messages: [{role: 'user', content: '不同的行动'}]});
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, 'AI_TRANSACTION_CONFLICT');
  assert.equal(calls, 1);
  const noTransaction = {...payload(), transactionId: undefined};
  const hashFirst = await (await player.request('/api/ai/cloud/generate', noTransaction)).json();
  const hashRepeat = await (await player.request('/api/ai/cloud/generate', noTransaction)).json();
  assert.equal(hashRepeat.jobId, hashFirst.jobId);
});

test('shared quota serializes visitors while a Groq request is in flight', async () => {
  let release;
  let active = 0;
  let maximum = 0;
  const app = harness({upstream: async () => {
    active++;
    maximum = Math.max(maximum, active);
    const answer = await new Promise(resolve => { release = resolve; });
    active--;
    return answer;
  }});
  const first = app.visitor();
  const second = app.visitor();
  await first.request('/api/ai/cloud/generate', payload('a'));
  const running = app.fire();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const secondJob = await (await second.request('/api/ai/cloud/generate', payload('b'))).json();
  await app.fire();
  assert.equal((await (await second.request(jobPath(secondJob))).json()).state, 'queued');
  assert.equal(maximum, 1);
  release(completion('第一位玩家的回答'));
  await running;
});

test('429 keeps the same input durable through restart and does not retry before quota reset', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return calls === 1 ? Response.json({error: {message: 'private upstream body gsk_shared_private_key'}}, {
      status: 429, headers: {'retry-after': '90', 'x-ratelimit-remaining-requests': '999', 'x-ratelimit-reset-requests': '24h', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '1m30s'}
    }) : completion('额度恢复后的真实回复');
  }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', payload('rate-limited'))).json();
  await app.fire();
  const delayed = await player.request(jobPath(job));
  assert.equal(delayed.status, 202);
  const data = await delayed.json();
  assert.equal(data.state, 'queued');
  assert.ok(data.retryAt >= app.now() + 90000);
  assert.ok(data.retryAt < app.now() + 91000);
  assert.doesNotMatch(JSON.stringify(data), /private upstream|gsk_/);
  app.env.GROQ_QUEUE.restart(app.queue().name);
  app.advance(89999);
  await app.fire();
  assert.equal(calls, 1);
  assert.equal((await player.request(jobPath(job))).status, 202);
  app.advance(1001);
  await app.fire();
  assert.equal(calls, 2);
  assert.equal((await (await player.request(jobPath(job))).json()).text, '额度恢复后的真实回复');
});

test('successful exhausted token headers pace the next queued request', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return Response.json({choices: [{message: {content: '有效回复'}}]}, {headers: {'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '2m5.5s'}});
  }});
  const player = app.visitor();
  await player.request('/api/ai/cloud/generate', payload('pace-1'));
  const second = await (await player.request('/api/ai/cloud/generate', payload('pace-2'))).json();
  await app.fire();
  app.advance(125000);
  await app.fire();
  assert.equal(calls, 1);
  const queued = await (await player.request(jobPath(second))).json();
  assert.ok(queued.retryAt >= app.now() + 500);
  app.advance(1000);
  await app.fire();
  assert.equal(calls, 2);
});

test('personal Groq credentials survive session restart and clear restores the shared credential', async () => {
  const sentKeys = [];
  const app = harness({upstream: async (_url, options) => { sentKeys.push(options.headers.Authorization); return completion('真实回复'); }});
  const player = app.visitor();
  const saved = await player.request('/api/ai/cloud/credential', {provider: 'groq', key: 'gsk_personal_private_key'});
  assert.equal(saved.status, 200);
  assert.doesNotMatch(await saved.text(), /gsk_personal_private_key/);
  const sessionName = [...app.env.SESSION_STORE.objects.keys()][0];
  app.env.SESSION_STORE.restart(sessionName);
  const status = await (await player.request('/api/ai/cloud/status')).json();
  assert.equal(status.configured.groq, true);
  assert.equal(status.personal, true);
  const personal = await (await player.request('/api/ai/cloud/generate', payload('own-key'))).json();
  await app.fire();
  assert.equal((await player.request(jobPath(personal))).status, 200);
  assert.equal((await player.request('/api/ai/cloud/clear', {provider: 'groq'})).status, 200);
  assert.equal((await (await player.request('/api/ai/cloud/status')).json()).personal, false);
  await player.request('/api/ai/cloud/generate', payload('shared-key'));
  const sharedQueue = [...app.env.GROQ_QUEUE.objects.values()].find(record => record !== app.queue());
  await app.fire(sharedQueue);
  assert.deepEqual(sentKeys, ['Bearer gsk_personal_private_key', 'Bearer gsk_shared_private_key']);
});

test('unconfigured Groq and provider failures are sanitized without inventing replies', async () => {
  const unconfigured = harness({key: ''});
  const missing = await unconfigured.visitor().request('/api/ai/cloud/generate', payload('missing'));
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, 'AI_NOT_CONFIGURED');
  const app = harness({upstream: async () => Response.json({error: {message: 'gsk_shared_private_key private account details'}}, {status: 401})});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', payload('bad-key'))).json();
  await app.fire();
  const failure = await player.request(jobPath(job));
  assert.equal(failure.status, 401);
  const error = await failure.json();
  assert.equal(error.code, 'AI_AUTH_FAILED');
  assert.equal(error.text, undefined);
  assert.doesNotMatch(JSON.stringify(error), /gsk_shared|private account/);
});

test('test endpoint uses the same quota queue and constrained generation', async () => {
  let requestBody;
  const app = harness({upstream: async (_url, options) => { requestBody = JSON.parse(options.body); return completion('连接正常'); }});
  const player = app.visitor();
  const response = await player.request('/api/ai/cloud/test', {provider: 'groq'});
  assert.equal(response.status, 202);
  const job = await response.json();
  await app.fire();
  assert.ok(requestBody.max_tokens <= 32);
  assert.equal(requestBody.model, 'qwen/qwen3.8-27b');
  assert.equal((await player.request(jobPath(job))).status, 200);
});

test('cloud routes reject alternate providers, endpoint injection, cross-site writes and invalid JSON', async () => {
  const app = harness();
  const player = app.visitor();
  assert.equal((await player.request('/api/ai/cloud/generate', {...payload('other'), provider: 'openai'})).status, 400);
  assert.equal((await player.request('/api/ai/cloud/generate', {...payload('endpoint'), baseUrl: 'http://attacker.example'})).status, 400);
  assert.equal((await player.request('/api/ai/cloud/generate', payload('csrf'), {origin: 'https://attacker.example'})).status, 403);
  assert.equal((await player.request('/api/ai/cloud/credential', '{not json')).status, 400);
  assert.equal((await player.request('/api/ai/cloud/generate', {...payload('empty'), messages: []})).status, 400);
});

test('existing launcher and game directory URLs preserve static assets', async () => {
  const app = harness();
  const player = app.visitor();
  const root = await player.request('/');
  assert.equal(root.status, 302);
  assert.equal(new URL(root.headers.get('location')).pathname, '/launcher/');
  const game = await player.request('/game/v4/index.html');
  assert.equal(game.status, 302);
  assert.equal(new URL(game.headers.get('location')).pathname, '/game/v4/');
  const asset = await player.request('/game/assets/intro.mp4');
  assert.equal(await asset.text(), 'asset:/game/assets/intro.mp4');
});

test('jobs arriving during an upstream request preserve FIFO order for later arrivals', async () => {
  let release;
  const replies = [];
  const app = harness({upstream: async (_url, options) => {
    const text = JSON.parse(options.body).messages[0].content;
    replies.push(text);
    return replies.length === 1 ? new Promise(resolve => { release = resolve; }) : completion(text);
  }});
  const player = app.visitor();
  const first = {...payload('fifo-first'), messages: [{role: 'user', content: '第一'}]};
  const second = {...payload('fifo-second'), messages: [{role: 'user', content: '第二'}]};
  const third = {...payload('fifo-third'), messages: [{role: 'user', content: '第三'}]};
  await player.request('/api/ai/cloud/generate', first);
  const running = app.fire();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await player.request('/api/ai/cloud/generate', second);
  release(completion('第一'));
  await running;
  await player.request('/api/ai/cloud/generate', third);
  // Sequence is observable through FIFO order; it must not reset after fetch.
  assert.equal((await app.queue().ctx.storage.get('meta')).sequence, 3);
  await app.fire();
  await app.fire();
  assert.deepEqual(replies, ['第一', '第二', '第三']);
});

const checkpoint = (revision = 1, journeyId = 'cloud-world-1') => ({
  state: {schemaVersion: 6, journeyId, revision, transactionJournal: null,
    astraWorld: {schema: 1, seed: journeyId, minute: 360 + revision, player: {id: 'player', inventory: ['item:herb']},
      items: {'item:herb': {id: 'item:herb', ownerId: 'player'}}, characters: {}, commitments: {}}},
  endId: revision ? `turn-${revision}` : null, savedAt: '2026-10-13T00:00:00.000Z'
});
const ledgerTurn = (id, summary) => ({id, kind: 'world', summary, blocks: [{type: 'narr', text: summary}], provider: 'groq'});

test('cloud world checkpoint and turn ledger survive reload with visitor isolation', async () => {
  const app = harness();
  const player = app.visitor();
  const record = checkpoint();
  const turn = ledgerTurn('turn-1', '林小满交付药草，药草归玩家所有。');
  const saved = await player.request('/api/world/save', {record, turn});
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).saved, true);
  const sessionName = [...app.env.SESSION_STORE.objects.keys()][0];
  app.env.SESSION_STORE.restart(sessionName);
  assert.deepEqual(await (await player.request('/api/world/load')).json(), record);
  assert.deepEqual(await (await player.request('/api/world/turns?worldId=cloud-world-1')).json(), [turn]);
  const other = app.visitor();
  assert.equal(await (await other.request('/api/world/load')).json(), null);
  assert.deepEqual(await (await other.request('/api/world/turns?worldId=cloud-world-1')).json(), []);
  assert.deepEqual(await (await other.request('/api/world/memory', {worldId: 'cloud-world-1', query: '药草'})).json(), []);
});

test('world memory recalls earlier matching consequences while checkpoints do not duplicate per turn', async () => {
  const app = harness();
  const player = app.visitor();
  await player.request('/api/world/save', {record: checkpoint(1), turn: ledgerTurn('turn-1', '林小满交付药草，药草归玩家所有。')});
  for (let revision = 2; revision <= 7; revision++) {
    await player.request('/api/world/save', {record: checkpoint(revision), turn: ledgerTurn(`turn-${revision}`, `玩家在第${revision}刻观察村口。`)});
  }
  const matches = await (await player.request('/api/world/memory', {worldId: 'cloud-world-1', query: '药草归谁所有'})).json();
  assert.equal(matches[0].id, 'turn-1');
  assert.equal(matches[0].summary, '林小满交付药草，药草归玩家所有。');
  assert.equal(matches[0].world_time, 361);
  assert.ok(matches.length <= 4);
  const recent = await (await player.request('/api/world/memory', {worldId: 'cloud-world-1', query: '完全不存在的词'})).json();
  assert.equal(recent.length, 4);
  assert.equal(recent[0].id, 'turn-7');
  const session = [...app.env.SESSION_STORE.objects.values()][0];
  assert.equal((await session.ctx.storage.list({prefix: 'world:checkpoint:'})).size, 1, 'only the latest chunked checkpoint is kept');
  assert.equal((await (await player.request('/api/world/turns?worldId=cloud-world-1')).json()).length, 7);
});

test('world saves reject stale revisions, schema or journey mismatches and credential fields', async () => {
  const app = harness();
  const player = app.visitor();
  assert.equal((await player.request('/api/world/save', {record: checkpoint(2), turn: ledgerTurn('turn-2', '第二回合')})).status, 200);
  const stale = await player.request('/api/world/save', {record: checkpoint(1), turn: ledgerTurn('turn-1', '过期回合')});
  assert.equal(stale.status, 409);
  assert.equal((await (await player.request('/api/world/load')).json()).state.revision, 2);
  const old = checkpoint(3); old.state.schemaVersion = 5;
  assert.equal((await player.request('/api/world/save', {record: old})).status, 400);
  assert.equal((await player.request('/api/world/save', {worldId: 'different', record: checkpoint(3)})).status, 400);
  assert.equal((await player.request('/api/world/save', {record: checkpoint(3), turn: {...ledgerTurn('turn-3', '回合'), journeyId: 'different'}})).status, 400);
  assert.equal((await player.request('/api/world/save', {record: {...checkpoint(3), groqApiKey: 'gsk_must_not_be_in_world'}})).status, 400);
  const pending = checkpoint(3); pending.state.transactionJournal = {phase: 'pending'};
  assert.equal((await player.request('/api/world/save', {record: pending})).status, 409);
});

test('world checkpoints larger than one KV value are chunked and bodies are bounded at 4MiB', async () => {
  const app = harness();
  const player = app.visitor();
  const record = checkpoint();
  record.state.astraWorld.history = [{text: '村'.repeat(120000)}];
  const saved = await player.request('/api/world/save', {record, turn: ledgerTurn('turn-1', '保存大世界')});
  assert.equal(saved.status, 200);
  assert.deepEqual(await (await player.request('/api/world/load')).json(), record);
  const huge = checkpoint(2); huge.state.extra = 'x'.repeat(4 * 1024 * 1024);
  assert.equal((await player.request('/api/world/save', {record: huge})).status, 413);
  assert.equal((await (await player.request('/api/world/load')).json()).state.revision, 1);
});

test('daily quota stays pending for hours without a sleeping request or early retry', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return new Response(null, {status: 429, headers: {'retry-after': '18000', 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '5h'}});
  }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', payload('daily'))).json();
  await app.fire();
  const waiting = await player.request(jobPath(job));
  assert.equal(waiting.status, 202);
  const data = await waiting.json();
  assert.ok(data.retryAt >= app.now() + 18000000);
  assert.ok(data.pollAfterMs <= 30000);
  app.advance(10 * 60 * 1000);
  await app.fire();
  assert.equal(calls, 1);
  assert.equal((await player.request(jobPath(job))).status, 202);
});

test('an interrupted upstream lease is not silently sent again after object restart', async () => {
  let calls = 0;
  const app = harness({upstream: async () => { calls++; return completion('should not happen'); }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', payload('interrupted'))).json();
  const queued = await app.queue().ctx.storage.get(`job:${job.jobId}`);
  await app.queue().ctx.storage.put(`job:${job.jobId}`, {...queued, state: 'running', leaseUntil: app.now() + 120000});
  app.env.GROQ_QUEUE.restart(app.queue().name);
  await app.fire();
  assert.equal((await player.request(jobPath(job))).status, 202);
  app.advance(120001);
  await app.fire();
  const interrupted = await player.request(jobPath(job));
  assert.equal(interrupted.status, 409);
  assert.equal((await interrupted.json()).code, 'AI_REQUEST_INTERRUPTED');
  assert.equal(calls, 0);
});

test('shared key rotation does not execute old jobs in the new key quota queue', async () => {
  let calls = 0;
  const app = harness({upstream: async () => { calls++; return completion('new-key answer'); }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', payload('before-rotation'))).json();
  app.env.GROQ_API_KEY = 'gsk_rotated_private_key';
  await app.fire();
  const failed = await player.request(jobPath(job));
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, 'AI_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('completed job cleanup stops the alarm once its retention has elapsed', async () => {
  const app = harness();
  const player = app.visitor();
  await player.request('/api/ai/cloud/generate', payload('retained'));
  await app.fire();
  app.advance(7 * 24 * 60 * 60 * 1000 + 1);
  await app.fire();
  assert.equal((await app.queue().ctx.storage.list({prefix: 'job:'})).size, 0);
  assert.equal(await app.queue().ctx.storage.getAlarm(), null);
});

test('a fork imports original turn IDs in batches without changing its saved checkpoint', async () => {
  const app = harness();
  const player = app.visitor();
  const record = checkpoint(0, 'fork-world');
  record.endId = 'old-turn-3';
  const turns = [ledgerTurn('old-turn-1', '林小满交付药草，归玩家所有。'),
    ledgerTurn('old-turn-2', '玩家走到村口。'), ledgerTurn('old-turn-3', '玩家询问药草的来历。')];
  assert.equal((await player.request('/api/world/save', {record, turn: turns[2]})).status, 200);
  const first = await player.request('/api/world/import-turns', {worldId: 'fork-world', turns: turns.slice(0, 2)});
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {imported: 2, worldId: 'fork-world'});
  assert.equal((await player.request('/api/world/import-turns', {worldId: 'fork-world', turns: turns.slice(2)})).status, 200);
  // Repeating a batch after a lost HTTP response cannot duplicate or reorder turns.
  assert.equal((await player.request('/api/world/import-turns', {worldId: 'fork-world', turns: turns.slice(0, 2)})).status, 200);
  const sessionName = [...app.env.SESSION_STORE.objects.keys()][0];
  app.env.SESSION_STORE.restart(sessionName);
  assert.deepEqual(await (await player.request('/api/world/load')).json(), record);
  assert.deepEqual(await (await player.request('/api/world/turns?worldId=fork-world')).json(), turns);
  const memories = await (await player.request('/api/world/memory', {worldId: 'fork-world', query: '药草归谁所有'})).json();
  assert.equal(memories[0].id, 'old-turn-1');
  const liveRecord = checkpoint(1, 'fork-world'); liveRecord.endId = 'new-turn-1';
  const liveTurn = ledgerTurn('new-turn-1', '玩家保存新的行记。');
  assert.equal((await player.request('/api/world/save', {record: liveRecord, turn: liveTurn})).status, 200);
  assert.deepEqual(await (await player.request('/api/world/turns?worldId=fork-world')).json(), [...turns, liveTurn]);
});

test('turn import requires a checkpoint owned by the session and validates the whole batch before storing', async () => {
  const app = harness();
  const player = app.visitor();
  const turn = ledgerTurn('old-turn-1', '原有承诺和药草。');
  const absent = await player.request('/api/world/import-turns', {worldId: 'fork-world', turns: [turn]});
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).code, 'WORLD_NOT_FOUND');
  const record = checkpoint(0, 'fork-world');
  assert.equal((await player.request('/api/world/save', {record, turn: null})).status, 200);
  const other = app.visitor();
  assert.equal((await other.request('/api/world/import-turns', {worldId: 'fork-world', turns: [turn]})).status, 404);
  assert.equal((await player.request('/api/world/import-turns', {worldId: 'fork-world', turns: Array.from({length: 101}, (_, index) => ledgerTurn(`turn-${index}`, '回合'))})).status, 400);
  for (const bad of [{...turn, id: ''}, {...turn, kind: 'checkpoint'}, {...turn, blocks: []},
    {...turn, apiKey: 'gsk_do_not_store'}, {...turn, journeyId: 'different'}, {...turn, state: record.state}]) {
    assert.equal((await player.request('/api/world/import-turns', {worldId: 'fork-world', turns: [turn, bad]})).status, 400);
  }
  assert.deepEqual(await (await player.request('/api/world/turns?worldId=fork-world')).json(), []);
  assert.deepEqual(await (await player.request('/api/world/load')).json(), record);
});

test('turn import never replaces a stored turn with different content under the same ID', async () => {
  const app = harness();
  const player = app.visitor();
  const turn = ledgerTurn('turn-1', '实际交付的药草。');
  assert.equal((await player.request('/api/world/save', {record: checkpoint(), turn})).status, 200);
  const changed = ledgerTurn('turn-1', '这段文字并未发生。');
  const response = await player.request('/api/world/import-turns', {worldId: 'cloud-world-1', turns: [changed]});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'WORLD_TURN_CONFLICT');
  assert.deepEqual(await (await player.request('/api/world/turns?worldId=cloud-world-1')).json(), [turn]);
});

test('warm shared queue preserves visitors FIFO through successive exhausted token resets', async () => {
  let release;
  const sent = [];
  const app = harness({upstream: async (_url, options) => {
    const text = JSON.parse(options.body).messages[0].content;
    sent.push(text);
    const response = Response.json({choices: [{message: {content: `回复：${text}`}}]}, {
      headers: {'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '2s'}
    });
    return sent.length === 1 ? new Promise(resolve => { release = () => resolve(response); }) : response;
  }});
  const first = app.visitor(), second = app.visitor(), third = app.visitor();
  const turn = (id, text) => ({...payload(id), messages: [{role: 'user', content: text}]});
  await first.request('/api/ai/cloud/generate', turn('warm-a', '甲'));
  const running = app.fire();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const b = await (await second.request('/api/ai/cloud/generate', turn('warm-b', '乙'))).json();
  const c = await (await third.request('/api/ai/cloud/generate', turn('warm-c', '丙'))).json();
  assert.equal(app.env.GROQ_QUEUE.objects.size, 1);
  release(); await running;
  await app.fire();
  assert.deepEqual(sent, ['甲']);
  app.advance(2249); await app.fire();
  assert.deepEqual(sent, ['甲']);
  app.advance(1); await app.fire();
  assert.deepEqual(sent, ['甲', '乙']);
  assert.equal((await second.request(jobPath(b))).status, 200);
  assert.equal((await third.request(jobPath(c))).status, 202);
  app.advance(2249); await app.fire();
  assert.deepEqual(sent, ['甲', '乙']);
  app.advance(1); await app.fire();
  assert.deepEqual(sent, ['甲', '乙', '丙']);
  assert.equal((await third.request(jobPath(c))).status, 200);
});

test('Groq generation uses manual redirects supported by the deployed Workers runtime', async () => {
  const app = harness({upstream: async (_url, options) => {
    // Observed in production workerd: error mode rejects before contacting Groq.
    if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode');
    assert.equal(options.redirect, 'manual');
    return completion('实际模型回复');
  }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/test', {provider: 'groq'})).json();
  await app.fire();
  const result = await player.request(jobPath(job));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).text, '实际模型回复');
});

test('an upstream redirect is rejected without forwarding the credential to its location', async () => {
  let requests = 0;
  const app = harness({upstream: async (_url, options) => {
    requests++;
    assert.equal(options.redirect, 'manual');
    return new Response('private redirect body', {status: 302, headers: {location: 'https://other.example/collect'}});
  }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', payload('redirect'))).json();
  await app.fire();
  const result = await player.request(jobPath(job));
  assert.equal(result.status, 503);
  const error = await result.json();
  assert.equal(error.code, 'AI_UPSTREAM_FAILED');
  assert.doesNotMatch(JSON.stringify(error), /private redirect|other\.example|gsk_/);
  assert.equal(requests, 1);
});

test('observed input quota paces the next unchanged prompt until sufficient partial refill', async () => {
  let calls = 0;
  const sent = [];
  const app = harness({upstream: async (_url, options) => {
    calls++; sent.push(JSON.parse(options.body).messages);
    return calls === 1 ? Response.json({choices: [{message: {content: '有效回复'}}], usage: {prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050}}, {
      headers: {'x-ratelimit-limit-input-tokens': '5000', 'x-ratelimit-remaining-input-tokens': '100', 'x-ratelimit-reset-input-tokens': '58.8s'}
    }) : completion('保留完整上下文的真实回复');
  }});
  const player = app.visitor();
  const request = id => ({...payload(id), maxTokens: 64, messages: [{role: 'user', content: 'a'.repeat(1000)}]});
  await player.request('/api/ai/cloud/generate', request('learn-usage'));
  await app.fire();
  const second = await (await player.request('/api/ai/cloud/generate', request('paced-usage'))).json();
  await app.fire();
  assert.equal(calls, 1, 'known remaining100 input tokens cannot fit the next roughly1000-token prompt');
  const waiting = await (await player.request(jobPath(second))).json();
  const delay = waiting.retryAt - app.now();
  assert.ok(delay > 10000 && delay < 20000, `wait for enough refill, not the full58.8s: ${delay}`);
  app.env.GROQ_QUEUE.restart(app.queue().name);
  app.advance(delay - 1); await app.fire();
  assert.equal(calls, 1);
  app.advance(2); await app.fire();
  assert.equal(calls, 2);
  assert.deepEqual(sent[1], request('paced-usage').messages, 'pacing must not trim the prompt');
});

test('complete exhausted token headers allow partial refill while incomplete headers keep full reset', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return calls === 1 ? Response.json({choices: [{message: {content: '有效回复'}}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}}, {
      headers: {'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '60s'}
    }) : completion('下一条回复');
  }});
  const player = app.visitor();
  const request = id => ({...payload(id), maxTokens: 64, messages: [{role: 'user', content: 'a'.repeat(100)}]});
  await player.request('/api/ai/cloud/generate', request('empty-bucket-1')); await app.fire();
  const next = await (await player.request('/api/ai/cloud/generate', request('empty-bucket-2'))).json();
  await app.fire();
  assert.equal(calls, 1);
  const delayed = await (await player.request(jobPath(next))).json();
  assert.ok(delayed.retryAt > app.now() + 1500 && delayed.retryAt < app.now() + 4000);
  app.advance(delayed.retryAt - app.now() + 1); await app.fire();
  assert.equal(calls, 2);
});

test('changing models does not bypass the credential shared learned token budget', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return calls === 1 ? Response.json({choices: [{message: {content: '模型甲回复'}}], usage: {prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050}}, {
      headers: {'x-ratelimit-limit-input-tokens': '5000', 'x-ratelimit-remaining-input-tokens': '100', 'x-ratelimit-reset-input-tokens': '58.8s'}
    }) : completion('模型乙回复');
  }});
  const first = app.visitor(), second = app.visitor();
  const request = id => ({...payload(id), maxTokens: 64, messages: [{role: 'user', content: 'a'.repeat(1000)}]});
  await first.request('/api/ai/cloud/generate', request('model-a')); await app.fire();
  const other = await (await second.request('/api/ai/cloud/generate', {...request('model-b'), model: 'other/model'})).json();
  await app.fire();
  assert.equal(calls, 1);
  const delayed = await (await second.request(jobPath(other))).json();
  assert.ok(delayed.retryAt > app.now() + 10000 && delayed.retryAt < app.now() + 20000);
  app.advance(delayed.retryAt - app.now() + 1); await app.fire();
  assert.equal(calls, 2);
});

test('known Groq ITPM error learns its numeric budget and keeps the longest provider wait', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return calls === 1 ? Response.json({error: {message: 'Rate limit on input tokens per minute (ITPM): Limit 5000, Used 4500, Requested 1000. Please try again in 6s. private gsk_shared_private_key'}}, {
      status: 429, headers: {'retry-after': '2'}
    }) : completion('额度恢复的真实回复');
  }});
  const player = app.visitor();
  const request = id => ({...payload(id), maxTokens: 64, messages: [{role: 'user', content: 'a'.repeat(1000)}]});
  const job = await (await player.request('/api/ai/cloud/generate', request('body-quota'))).json();
  await app.fire();
  const waiting = await (await player.request(jobPath(job))).json();
  assert.ok(waiting.retryAt >= app.now() + 6000);
  assert.doesNotMatch(JSON.stringify(waiting), /private|gsk_/);
  app.advance(5999); await app.fire();
  assert.equal(calls, 1);
  app.advance(10000); await app.fire();
  assert.equal(calls, 2);
  const other = await (await player.request('/api/ai/cloud/generate', {...request('body-model-switch'), model: 'other/model'})).json();
  await app.fire();
  assert.equal(calls, 2, 'even a successful later response without headers cannot discard known shared consumption');
  assert.equal((await player.request(jobPath(other))).status, 202);
});

test('predictive pacing never shortens an explicit429 Retry-After even if the bucket refills earlier', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return calls === 1 ? Response.json({error: {message: 'input tokens per minute (ITPM): Limit 5000, Used 4500, Requested 1000. Please try again in 6s.'}}, {
      status: 429, headers: {'retry-after': '90', 'x-ratelimit-limit-input-tokens': '5000', 'x-ratelimit-remaining-input-tokens': '500', 'x-ratelimit-reset-input-tokens': '54s'}
    }) : completion('真实回复');
  }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', {...payload('hard-retry'), maxTokens: 64, messages: [{role: 'user', content: 'a'.repeat(1000)}]})).json();
  await app.fire();
  app.advance(89999); await app.fire();
  assert.equal(calls, 1);
  assert.ok((await (await player.request(jobPath(job))).json()).retryAt > app.now());
  app.advance(1001); await app.fire();
  assert.equal(calls, 2);
});

test('a conservative estimation margin does not reject a learned prompt fitting the reported limit', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return calls === 1 ? Response.json({choices: [{message: {content: '真实回复'}}], usage: {prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010}}, {
      headers: {'x-ratelimit-limit-input-tokens': '1000', 'x-ratelimit-remaining-input-tokens': '0', 'x-ratelimit-reset-input-tokens': '60s'}
    }) : completion('刚好满足上限的真实回复');
  }});
  const player = app.visitor();
  const request = id => ({...payload(id), maxTokens: 64, messages: [{role: 'user', content: 'a'.repeat(1000)}]});
  await player.request('/api/ai/cloud/generate', request('exact-cap-1')); await app.fire();
  const next = await (await player.request('/api/ai/cloud/generate', request('exact-cap-2'))).json();
  await app.fire();
  assert.equal((await player.request(jobPath(next))).status, 202);
  app.advance(60251); await app.fire();
  assert.equal(calls, 2);
  assert.equal((await player.request(jobPath(next))).status, 200);
});

test('a learned daily-token error waits for the reported reset rather than inventing a new24h wait', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return calls === 1 ? Response.json({error: {message: 'tokens per day (TPD): Limit 2000, Used 2000, Requested 1000. Please try again in 3h.'}}, {
      status: 429, headers: {'retry-after': '10800'}
    }) : completion('日额度恢复的真实回复');
  }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', {...payload('daily-learned'), maxTokens: 64})).json();
  await app.fire();
  app.advance(10800251); await app.fire();
  assert.equal(calls, 2);
  assert.equal((await player.request(jobPath(job))).status, 200);
});

test('a learned oversized input becomes a sanitized terminal error without another quota-consuming request', async () => {
  let calls = 0;
  const app = harness({upstream: async () => {
    calls++;
    return Response.json({error: {message: 'input tokens per minute (ITPM): Limit 500, Used 0, Requested 1000. Please try again in 1s.'}}, {
      status: 429, headers: {'retry-after': '1'}
    });
  }});
  const player = app.visitor();
  const job = await (await player.request('/api/ai/cloud/generate', {...payload('input-too-large'), maxTokens: 64, messages: [{role: 'user', content: 'a'.repeat(1000)}]})).json();
  await app.fire(); app.advance(1251); await app.fire();
  const failure = await player.request(jobPath(job));
  assert.equal(failure.status, 413);
  assert.equal((await failure.json()).code, 'AI_INPUT_BUDGET');
  await app.fire();
  assert.equal(calls, 1);
});

test('real workerd alarm completes the Groq queue and paces learned quota with supported redirect mode',
  {skip: !process.env.LX_MINIFLARE_MODULE}, async () => {
    const {Miniflare, convertV4MiniflareOptions} = await import(pathToFileURL(process.env.LX_MINIFLARE_MODULE).href);
    const modulePaths = ['worker.mjs', 'groq-queue.mjs'].map(name => fileURLToPath(new URL(`../../cloud/${name}`, import.meta.url)));
    const sentAt = [];
    const options = {
      modules: await Promise.all(modulePaths.map(async path => ({type: 'ESModule', path, contents: await readFile(path, 'utf8')}))),
      compatibilityDate: '2026-10-13',
      bindings: {GROQ_API_KEY: 'gsk_runtime_regression_key'},
      durableObjects: {GROQ_QUEUE: {className: 'GroqQueue', useSQLite: true}, SESSION_STORE: {className: 'SessionStore', useSQLite: true}},
      outboundService: async request => {
        assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(request.headers.get('authorization'), 'Bearer gsk_runtime_regression_key');
        sentAt.push(Date.now());
        return Response.json({choices: [{message: {content: '真实 workerd 验证回复'}}],
          usage: {prompt_tokens: 16, completion_tokens: 4, total_tokens: 20}}, {
          headers: {'x-ratelimit-limit-tokens': '6000', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '60s'}
        });
      }
    };
    const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
    try {
      const submission = await runtime.dispatchFetch('https://beta.example/api/ai/cloud/test', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({provider: 'groq'})
      });
      assert.equal(submission.status, 202);
      const cookie = submission.headers.get('set-cookie').split(';')[0];
      const job = await submission.json();
      const deadline = Date.now() + 5000;
      let result;
      do {
        result = await runtime.dispatchFetch(`https://beta.example${jobPath(job)}`, {headers: {cookie}});
        if (result.status !== 202) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      assert.equal(result.status, 200);
      assert.equal((await result.json()).text, '真实 workerd 验证回复');
      const second = await runtime.dispatchFetch('https://beta.example/api/ai/cloud/test', {
        method: 'POST', headers: {'Content-Type': 'application/json', cookie},
        body: JSON.stringify({provider: 'groq', transactionId: 'workerd-pacing-2'})
      });
      assert.equal(second.status, 202);
      const next = await second.json();
      let paced;
      const pacingDeadline = Date.now() + 5000;
      do {
        paced = await runtime.dispatchFetch(`https://beta.example${jobPath(next)}`, {headers: {cookie}});
        if (paced.status !== 202) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < pacingDeadline);
      assert.equal(paced.status, 200);
      assert.equal(sentAt.length, 2);
      assert.ok(sentAt[1] - sentAt[0] >= 500, 'real alarm must wait for enough tokens before the second upstream request');
    } finally { await runtime.dispose(); }
  });
