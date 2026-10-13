// SQLite-backed Durable Objects use the storage KV API for durable records.
// No Cloudflare imports: the same classes run against storage in Node tests.
export const DEFAULT_MODEL = 'qwen/qwen3.8-27b';
export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 90000;
const LEASE_MS = 120000;
const SAFETY_MS = 250;

export function json(value, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
}

export function failure(code, status = 400, terminalJob = false) {
  const messages = {
    AI_BAD_REQUEST: '请求参数无效；输入和世界保持原样。',
    AI_NOT_CONFIGURED: '网站尚未配置 Groq，请保存个人 Groq Key。',
    AI_AUTH_FAILED: 'Groq Key 无效或没有权限；请检查设置。',
    AI_MODEL_UNAVAILABLE: '当前 Groq 模型不可用，请检查模型名称或权限。',
    AI_QUOTA_EXHAUSTED: 'Groq 账户预算或余额已用完，请检查账户。',
    AI_UPSTREAM_FAILED: 'Groq 服务暂时不可用；输入和世界保持原样。',
    AI_TIMEOUT: 'Groq 响应超时；输入和世界保持原样。',
    AI_REQUEST_INTERRUPTED: '这次 Groq 请求中断，无法确认结果；输入和世界保持原样，请重新尝试。',
    AI_TRANSACTION_CONFLICT: '该回合已经有不同的请求；请保留原输入并等待结果。',
    AI_SITE_LIMITED: '共享队列暂满，请稍后再试；输入和世界保持原样。',
    AI_JOB_NOT_FOUND: '未找到本次请求，请保留原输入重新尝试。',
    WORLD_SAVE_CONFLICT: '云端已有更新的旅程修订；当前存档没有覆盖它。',
    WORLD_SAVE_PENDING: '回合尚未完整提交，不能保存未结算的世界。',
    WORLD_BAD_RECORD: '世界存档格式无效；当前存档保持原样。',
    WORLD_NOT_FOUND: '当前会话尚未保存这个旅程，不能导入它的行记。',
    WORLD_TURN_CONFLICT: '这条行记编号已有不同内容；原行记保持原样。',
    AI_FORBIDDEN: '请求来源无效。',
    AI_BODY_TOO_LARGE: '请求内容过长；输入和世界保持原样。',
    AI_INPUT_BUDGET: '当前请求超出服务商已报告的单次可用 token 上限；输入和世界保持原样，请调整请求后再试。'
  };
  return json({code, error: messages[code] || messages.AI_UPSTREAM_FAILED,...(terminalJob?{terminalJob:true}:{})}, status);
}

export async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function objectStub(namespace, name) {
  return namespace.get(namespace.idFromName(name));
}

export function internalRequest(path, data) {
  return new Request(`https://private.invalid${path}`, data === undefined ? undefined : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
  });
}

const validWorldId = value => typeof value === 'string' && /^[\p{L}\p{N}_.:/-]{1,100}$/u.test(value);

function hasCredentialField(root) {
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:api[_-]?key|groq(?:api)?key|groq_api_key|credentials?|cloudkeys)$/i.test(key)) return true;
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return false;
}

function validTurn(turn, journeyId) {
  return Boolean(turn && validWorldId(turn.id) && ['world', 'system'].includes(turn.kind)
    && Array.isArray(turn.blocks) && turn.blocks.length > 0 && turn.blocks.length <= 100
    && turn.blocks.every(block => block && ['narr', 'dlg', 'sys', 'player'].includes(block.type)
      && typeof block.text === 'string' && block.text.trim())
    && (turn.journeyId === undefined || turn.journeyId === journeyId)
    && !turn.state && !turn.checkpoint && !turn.nextState && !hasCredentialField(turn)
    && new TextEncoder().encode(JSON.stringify(turn)).length <= 100000);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function durationMs(value) {
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, numeric * 1000);
  let duration = 0;
  let end = 0;
  for (const match of String(value).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
    if (match.index !== end) return 0;
    duration += Number(match[1]) * {ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000}[match[2]];
    end = match.index + match[0].length;
  }
  return end === String(value).length ? duration : 0;
}

// Groq request reset refers to requests/day; token reset refers to tokens/minute.
// A nonempty reset header alone does not mean that quota is exhausted.
export function quotaDelay(response, now, learnedRetryMs = 0) {
  let delay = Math.max(0, learnedRetryMs);
  const retry = response.headers.get('retry-after');
  if (retry) {
    const numeric = Number(retry);
    delay = Math.max(delay, Math.max(0, Number.isFinite(numeric) ? numeric * 1000 : Date.parse(retry) - now) || 0);
  }
  for (const kind of ['requests', 'tokens', 'input-tokens', 'output-tokens']) {
    const remaining = response.headers.get(`x-ratelimit-remaining-${kind}`);
    if (remaining !== null && Number(remaining) <= 0) {
      // Successful complete token headers support a partial refill calculation.
      // Missing limits and every429 still preserve the provider's full reset wait.
      const limit = Number(response.headers.get(`x-ratelimit-limit-${kind}`));
      if (response.ok && kind !== 'requests' && limit > 0
        && durationMs(response.headers.get(`x-ratelimit-reset-${kind}`)) > 0) continue;
      delay = Math.max(delay, durationMs(response.headers.get(`x-ratelimit-reset-${kind}`)));
    }
  }
  return Math.ceil(delay || (response.status === 429 ? 60000 : 0));
}

function promptUnits(payload) {
  let characters = 0, bytes = 0;
  for (const message of payload.messages) {
    for (const character of message.content) characters += character.codePointAt(0) <= 127 ? 0.25 : 1;
    bytes += new TextEncoder().encode(message.content).length;
  }
  return Math.max(characters, bytes / 4) + payload.messages.length * 8;
}

function quotaSnapshot(kind, limit, remaining, resetMs, now, model) {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)
    || remaining < 0 || remaining > limit || !Number.isFinite(resetMs) || resetMs <= 0) return null;
  // The documented token headers express per-minute buckets. Infer a slower
  // refill if the observed reset contradicts that rate; daily quotas do not refill here.
  const depleted = limit - remaining;
  const rate = kind.endsWith('tokens') && kind !== 'day-tokens'
    ? Math.min(limit / 60000, depleted > 0 ? depleted / resetMs : limit / 60000) : 0;
  return {kind, model, limit, remaining, observedAt: now, refillRate: rate, windowMs: rate > 0 ? 60000 : 86400000,
    resetAt: now + Math.max(resetMs, rate > 0 ? depleted / rate : resetMs)};
}

function availableQuota(budget, now) {
  if (now >= budget.resetAt) return budget.limit;
  return Math.min(budget.limit, budget.remaining + Math.max(0, now - budget.observedAt) * budget.refillRate);
}

async function knownQuotaError(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { await reader.cancel(); return null; }
    const message = typeof data?.error?.message === 'string' ? data.error.message : '';
    const scope = message.match(/\b(ITPM|OTPM|TPM|TPD)\b/i)?.[1]?.toUpperCase();
    const numbers = message.match(/\bLimit:?\s*([\d,]+),?\s*Used:?\s*([\d,]+),?\s*Requested:?\s*([\d,]+)/i);
    const retry = message.match(/\btry again in\s+((?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+)/i);
    const retryMs = durationMs(retry?.[1]);
    if (!scope || !numbers) return retryMs ? {retryMs} : null;
    const [limit, used, requested] = numbers.slice(1).map(value => Number(value.replaceAll(',', '')));
    if (![limit, used, requested].every(Number.isSafeInteger) || limit <= 0 || used < 0 || requested <= 0) return retryMs ? {retryMs} : null;
    return {kind: {ITPM: 'input-tokens', OTPM: 'output-tokens', TPM: 'tokens', TPD: 'day-tokens'}[scope],
      limit, remaining: Math.max(0, limit - used), requested, retryMs};
  } catch { await reader.cancel().catch(() => {}); return null; }
  finally { reader.releaseLock(); }
}

function pendingResult(job, nextAt, now) {
  const retryAt = Math.max(job.retryAt || 0, nextAt || 0);
  return {
    jobId: job.id, state: job.state,
    pollAfterMs: job.state === 'completed' || job.state === 'failed' ? 0
      : Math.max(1000, Math.min(30000, retryAt > now ? retryAt - now : 1000)),
    ...(retryAt > now && job.state === 'queued' ? {retryAt, code: 'AI_RATE_LIMITED'} : {})
  };
}

export class GroqQueue {
  constructor(ctx, env, {clock = Date.now, fetchImpl = globalThis.fetch?.bind(globalThis)} = {}) {
    this.ctx = ctx;
    this.storage = ctx.storage;
    this.env = env;
    this.clock = clock;
    this.fetchImpl = fetchImpl;
    this.processing = false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/enqueue' && request.method === 'POST') {
      const input = await request.json();
      return this.ctx.blockConcurrencyWhile(() => this.enqueue(input));
    }
    if (url.pathname.startsWith('/jobs/') && request.method === 'GET') {
      const job = await this.storage.get(`job:${url.pathname.slice(6)}`);
      if (!job || job.sessionId !== url.searchParams.get('sessionId')) return failure('AI_JOB_NOT_FOUND', 404,true);
      const meta = await this.storage.get('meta');
      if (url.searchParams.get('submission') === '1') return json(pendingResult(job, meta?.nextAt, this.clock()), 202);
      if (job.state === 'completed') return json({jobId: job.id, text: job.text, provider: 'groq', model: job.payload.model});
      if (job.state === 'failed') return failure(job.error.code, job.error.status,true);
      return json(pendingResult(job, meta?.nextAt, this.clock()), 202);
    }
    return failure('AI_JOB_NOT_FOUND', 404);
  }

  async enqueue({sessionId, credential, payload, requestHash, transactionHash}) {
    const now = this.clock();
    const dedupeKey = `dedupe:${await fingerprint(`${sessionId}:${transactionHash || requestHash}`)}`;
    const previous = await this.storage.get(dedupeKey);
    if (previous && previous.expiresAt > now) {
      if (previous.requestHash !== requestHash) return failure('AI_TRANSACTION_CONFLICT', 409);
      const job = await this.storage.get(`job:${previous.jobId}`);
      if (job) {
        const meta = await this.storage.get('meta');
        return json(pendingResult(job, meta?.nextAt, now), 202);
      }
    }
    const pending = await this.storage.list({prefix: 'pending:', limit: 501});
    if (pending.size >= 500) return failure('AI_SITE_LIMITED', 429);
    const meta = await this.storage.get('meta') || {sequence: 0, nextAt: 0};
    const id = crypto.randomUUID();
    const pendingKey = `pending:${String(++meta.sequence).padStart(16, '0')}:${id}`;
    const job = {id, sessionId, credential, payload, requestHash, state: 'queued', createdAt: now, updatedAt: now, pendingKey, dedupeKey, attempts: 0};
    // Persist the recovery alarm before accepting the job. Output gates wait for storage.
    await this.storage.setAlarm(Math.max(now + 1, meta.nextAt || 0));
    await this.storage.put({
      [`job:${id}`]: job,
      [pendingKey]: id,
      [dedupeKey]: {jobId: id, requestHash, expiresAt: now + JOB_RETENTION_MS},
      meta
    });
    return json(pendingResult(job, meta.nextAt, now), 202);
  }

  async schedule() {
    const meta = await this.storage.get('meta') || {};
    const pending = await this.storage.list({prefix: 'pending:', limit: 1});
    const now = this.clock();
    if (pending.size) {
      const job = await this.storage.get(`job:${pending.values().next().value}`);
      await this.storage.setAlarm(Math.max(now + 1, meta.nextAt || 0, job?.state === 'running' ? job.leaseUntil || 0 : job?.retryAt || 0));
    } else {
      // Terminal jobs remain pollable and idempotent for seven days.
      const retained = await this.storage.list({prefix: 'job:', limit: 1});
      if (retained.size) await this.storage.setAlarm(now + JOB_RETENTION_MS);
      else await this.storage.deleteAlarm();
    }
  }

  async finish(job, error, text) {
    job.state = error ? 'failed' : 'completed';
    job.updatedAt = this.clock();
    delete job.leaseUntil;
    delete job.retryAt;
    if (error) job.error = error;
    else job.text = text;
    // Drop player prompts from retained terminal records; polling only needs the model.
    job.payload = {model: job.payload.model};
    delete job.credential;
    await this.storage.put(`job:${job.id}`, job);
    await this.storage.delete(job.pendingKey);
  }

  async credentialFor(job) {
    if (job.credential.shared) {
      const key = this.env.GROQ_API_KEY || '';
      return key && await fingerprint(`groq:${key}`) === job.credential.fingerprint ? key : '';
    }
    const stub = objectStub(this.env.SESSION_STORE, job.credential.sessionId);
    const response = await stub.fetch(internalRequest(`/key/${job.credential.fingerprint}`));
    return response.ok ? (await response.json()).key || '' : '';
  }

  async preflight(payload) {
    const profile = await this.storage.get(`usage:${await fingerprint(payload.model)}`);
    const profiles = profile ? [] : [...(await this.storage.list({prefix: 'usage:'})).values()];
    const density = profile?.density || Math.max(1, ...profiles.map(value => value.density || 0));
    const baseInput = Math.ceil(promptUnits(payload) * density - 1e-9);
    const input = Math.ceil(baseInput * 1.08);
    const costs = {requests: 1, 'input-tokens': input, 'output-tokens': payload.maxTokens,
      tokens: input + payload.maxTokens, 'day-tokens': input + payload.maxTokens};
    const baseCosts = {...costs, 'input-tokens': baseInput, tokens: baseInput + payload.maxTokens, 'day-tokens': baseInput + payload.maxTokens};
    const budgets = await this.storage.list({prefix: 'quota:'});
    const now = this.clock();
    let retryAt = 0;
    for (const budget of budgets.values()) {
      if (baseCosts[budget.kind] > budget.limit) return {error: {code: 'AI_INPUT_BUDGET', status: 413}};
      // The prediction margin may reserve all capacity; it cannot turn a known
      // fitting prompt into an artificial oversized-input failure.
      const cost = Math.min(costs[budget.kind], budget.limit);
      const remaining = availableQuota(budget, now);
      if (cost > remaining) retryAt = Math.max(retryAt,
        budget.refillRate > 0 ? now + Math.ceil((cost - remaining) / budget.refillRate) + SAFETY_MS : budget.resetAt + SAFETY_MS);
    }
    return {retryAt, budgets, costs};
  }

  async reserveQuota({budgets, costs}) {
    const now = this.clock();
    const entries = {};
    for (const [key, budget] of budgets) {
      const remaining = Math.max(0, availableQuota(budget, now) - Math.min(costs[budget.kind], budget.limit));
      entries[key] = {...budget, remaining, observedAt: now,
        resetAt: budget.refillRate > 0 ? now + (budget.limit - remaining) / budget.refillRate
          : budget.resetAt <= now ? now + budget.windowMs : budget.resetAt};
    }
    if (budgets.size) await this.storage.put(entries);
  }

  async observeQuota(payload, response, errorInfo = null, usage = null) {
    const now = this.clock();
    const modelHash = await fingerprint(payload.model);
    const entries = {};
    for (const kind of ['requests', 'tokens', 'input-tokens', 'output-tokens']) {
      const limitValue = response.headers.get(`x-ratelimit-limit-${kind}`);
      const remainingValue = response.headers.get(`x-ratelimit-remaining-${kind}`);
      if (limitValue === null || remainingValue === null) continue;
      const snapshot = quotaSnapshot(kind, Number(limitValue), Number(remainingValue),
        durationMs(response.headers.get(`x-ratelimit-reset-${kind}`)), now, payload.model);
      if (snapshot) entries[`quota:${modelHash}:${kind}`] = snapshot;
    }
    if (errorInfo?.kind) {
      const window = errorInfo.kind === 'day-tokens' ? 86400000 : 60000;
      const resetMs = errorInfo.kind === 'day-tokens'
        ? quotaDelay(response, now, errorInfo.retryMs) || window
        : Math.max(1, window * (errorInfo.limit - errorInfo.remaining) / errorInfo.limit);
      const key = `quota:${modelHash}:${errorInfo.kind}`;
      const inferred = quotaSnapshot(errorInfo.kind, errorInfo.limit, errorInfo.remaining, resetMs, now, payload.model);
      if (inferred && (!entries[key] || availableQuota(inferred, now) < availableQuota(entries[key], now))) entries[key] = inferred;
    }
    const actual = Number(usage?.prompt_tokens || (errorInfo?.kind === 'input-tokens' ? errorInfo.requested : 0));
    if (Number.isSafeInteger(actual) && actual > 0) {
      const key = `usage:${modelHash}`;
      const previous = await this.storage.get(key);
      entries[key] = {model: payload.model, density: Math.max(previous?.density || 0, actual / promptUnits(payload)),
        promptTokens: actual, completionTokens: Number(usage?.completion_tokens) || 0, observedAt: now};
    }
    if (Object.keys(entries).length) await this.storage.put(entries);
  }

  async alarm() {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = this.clock();
      const meta = await this.storage.get('meta') || {sequence: 0, nextAt: 0};
      const pending = await this.storage.list({prefix: 'pending:', limit: 1});
      if (!pending.size) { await this.cleanup(); return; }
      const [pendingKey, jobId] = pending.entries().next().value;
      const job = await this.storage.get(`job:${jobId}`);
      if (!job || !['queued', 'running'].includes(job.state)) {
        await this.storage.delete(pendingKey);
        return;
      }
      if (job.state === 'running') {
        if (job.leaseUntil > now) return;
        // A terminated process may have sent its request. Never silently send it twice.
        await this.finish(job, {code: 'AI_REQUEST_INTERRUPTED', status: 409});
        return;
      }
      if (Math.max(meta.nextAt || 0, job.retryAt || 0) > now) return;
      const pacing = await this.preflight(job.payload);
      if (pacing.error) { await this.finish(job, pacing.error); return; }
      if (pacing.retryAt > now) {
        job.retryAt = pacing.retryAt;
        await this.storage.put(`job:${job.id}`, job);
        return;
      }
      const key = await this.credentialFor(job);
      if (!key) { await this.finish(job, {code: 'AI_NOT_CONFIGURED', status: 503}); return; }
      await this.reserveQuota(pacing);
      job.state = 'running';
      job.attempts++;
      job.updatedAt = now;
      job.leaseUntil = now + LEASE_MS;
      await this.storage.setAlarm(job.leaseUntil);
      await this.storage.put(`job:${job.id}`, job);
      let response;
      try {
        response = await this.fetchImpl(GROQ_ENDPOINT, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
          body: JSON.stringify({model: job.payload.model, messages: job.payload.messages,
            max_tokens: job.payload.maxTokens, temperature: job.payload.temperature, stream: false,
            ...(job.payload.messages.some(m=>m.role==='system'&&/\bJSON\b/i.test(m.content)&&/\bblocks\b/.test(m.content))
              ?{response_format:{type:'json_object'}}:{})})
        });
      } catch (error) {
        // Bounded platform diagnostics: never log upstream bodies, prompts or keys.
        console.error('groq-fetch-failed', {kind:['TimeoutError','AbortError','TypeError'].includes(error?.name)?error.name:'Error',
          signalSupported:typeof AbortSignal.timeout==='function',fetchSupported:typeof this.fetchImpl==='function',
          redirectUnsupported:/redirect|mode/i.test(error?.message||''),contextInvalid:/context|request|I\/O/i.test(error?.message||'')});
        await this.finish(job, {code: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UPSTREAM_FAILED', status: 504});
        return;
      }
      const errorInfo = response.status === 429 ? await knownQuotaError(response) : null;
      const delay = quotaDelay(response, this.clock(), errorInfo?.retryMs);
      // Enqueue can run while fetch is in flight. Read the current sequence again.
      const currentMeta = await this.storage.get('meta') || meta;
      currentMeta.nextAt = this.clock() + delay + (delay ? SAFETY_MS : 0);
      await this.storage.put('meta', currentMeta);
      if (response.status === 429) {
        await this.observeQuota(job.payload, response, errorInfo);
        // Long quota waits are durable queue state, never a sleeping HTTP request.
        job.state = 'queued';
        job.retryAt = currentMeta.nextAt;
        job.updatedAt = this.clock();
        delete job.leaseUntil;
        await this.storage.put(`job:${job.id}`, job);
        await response.body?.cancel();
        return;
      }
      if (!response.ok) {
        const status = response.status;
        const code = status === 401 || status === 403 ? 'AI_AUTH_FAILED'
          : status === 402 ? 'AI_QUOTA_EXHAUSTED'
          : status === 404 ? 'AI_MODEL_UNAVAILABLE'
          : status === 400 || status === 422 ? 'AI_BAD_REQUEST' : 'AI_UPSTREAM_FAILED';
        await response.body?.cancel();
        await this.finish(job, {code, status: [400, 401, 402, 403, 404, 422].includes(status) ? status : 503});
        return;
      }
      const result = await response.json().catch(() => null);
      await this.observeQuota(job.payload, response, null, result?.usage);
      const text = result?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim() || text.length > 65536) {
        await this.finish(job, {code: 'AI_UPSTREAM_FAILED', status: 502});
      } else {
        await this.finish(job, null, text);
      }
    } finally {
      this.processing = false;
      await this.schedule();
    }
  }

  async cleanup() {
    const cutoff = this.clock() - JOB_RETENTION_MS;
    const jobs = await this.storage.list({prefix: 'job:'});
    for (const [key, job] of jobs) {
      if (!['queued', 'running'].includes(job.state) && job.updatedAt <= cutoff) {
        await this.storage.delete(key);
        await this.storage.delete(job.dedupeKey);
      }
    }
  }
}

// Only the owning Worker/queue can call this private DO. Personal credentials
// never live in browser storage or public response payloads.
export class SessionStore {
  constructor(ctx, env, {clock = Date.now} = {}) {
    this.ctx = ctx;
    this.storage = ctx.storage;
    this.env = env;
    this.clock = clock;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/world/save' && request.method === 'POST') {
      const input = await request.json();
      return this.ctx.blockConcurrencyWhile(() => this.saveWorld(input));
    }
    if (url.pathname === '/world/import-turns' && request.method === 'POST') {
      const input = await request.json();
      return this.ctx.blockConcurrencyWhile(() => this.importTurns(input));
    }
    if (url.pathname === '/world/load') return json(await this.loadWorld());
    if (url.pathname === '/world/turns') {
      const turns = await this.worldTurns(url.searchParams.get('worldId'));
      return json(turns.map(entry => entry.turn));
    }
    if (url.pathname === '/world/memory' && request.method === 'POST') {
      const input = await request.json();
      return json(await this.worldMemory(input));
    }
    if (url.pathname.startsWith('/key/')) {
      const saved = await this.storage.get(`credential:${url.pathname.slice(5)}`);
      return saved && saved.expiresAt > this.clock() ? json({key: saved.key}) : failure('AI_NOT_CONFIGURED', 503);
    }
    if (url.pathname === '/status') {
      const active = await this.storage.get('active');
      const personal = active ? await this.storage.get(`credential:${active}`) : null;
      return json({configured: {groq: Boolean(personal?.expiresAt > this.clock() || this.env.GROQ_API_KEY)},
        personal: Boolean(personal?.expiresAt > this.clock()), cloud: true,
        providers: [{id: 'groq', label: 'Groq', model: DEFAULT_MODEL}]});
    }
    if (url.pathname === '/credential' && request.method === 'POST') {
      const {key} = await request.json();
      const hash = await fingerprint(`groq:${key}`);
      await this.storage.put(`credential:${hash}`, {key, expiresAt: this.clock() + SESSION_RETENTION_MS});
      await this.storage.put('active', hash);
      await this.storage.setAlarm(this.clock() + SESSION_RETENTION_MS);
      return json({ok: true, provider: 'groq', personal: true});
    }
    if (url.pathname === '/clear' && request.method === 'POST') {
      await this.storage.delete('active');
      return json({ok: true, provider: 'groq', personal: false, configured: Boolean(this.env.GROQ_API_KEY)});
    }
    if (url.pathname === '/submit' && request.method === 'POST') {
      const input = await request.json();
      return this.ctx.blockConcurrencyWhile(() => this.submit(input));
    }
    if (url.pathname.startsWith('/jobs/')) {
      const jobId = url.pathname.slice(6);
      const saved = await this.storage.get(`job:${jobId}`);
      if (!saved || saved.expiresAt <= this.clock()) return failure('AI_JOB_NOT_FOUND', 404);
      const queue = objectStub(this.env.GROQ_QUEUE, saved.fingerprint);
      return queue.fetch(internalRequest(`/jobs/${jobId}?sessionId=${encodeURIComponent(saved.sessionId)}`));
    }
    return failure('AI_JOB_NOT_FOUND', 404);
  }

  async submit({sessionId, payload, requestHash, transactionHash}) {
    const now = this.clock();
    const transactionKey = `transaction:${transactionHash || requestHash}`;
    const previous = await this.storage.get(transactionKey);
    if (previous?.expiresAt > now) {
      if (previous.requestHash !== requestHash) return failure('AI_TRANSACTION_CONFLICT', 409);
      return objectStub(this.env.GROQ_QUEUE, previous.fingerprint).fetch(
        internalRequest(`/jobs/${previous.jobId}?sessionId=${encodeURIComponent(sessionId)}&submission=1`));
    }
    let active = await this.storage.get('active');
    const personal = active ? await this.storage.get(`credential:${active}`) : null;
    if (!personal || personal.expiresAt <= now) active = null;
    if (!active && !this.env.GROQ_API_KEY) return failure('AI_NOT_CONFIGURED', 503);
    const hash = active || await fingerprint(`groq:${this.env.GROQ_API_KEY}`);
    const credential = active ? {sessionId, fingerprint: hash} : {shared: true, fingerprint: hash};
    const queue = objectStub(this.env.GROQ_QUEUE, hash);
    const response = await queue.fetch(internalRequest('/enqueue', {sessionId, credential, payload, requestHash, transactionHash}));
    if (response.status !== 202) return response;
    const job = await response.json();
    const record = {sessionId, fingerprint: hash, jobId: job.jobId, requestHash, expiresAt: now + JOB_RETENTION_MS};
    await this.storage.put({[`job:${job.jobId}`]: record, [transactionKey]: record});
    await this.storage.setAlarm(now + SESSION_RETENTION_MS);
    return json(job, 202);
  }

  async saveWorld({record, turn = null, worldId}) {
    const state = record?.state;
    const journeyId = state?.journeyId;
    if (!state || state.schemaVersion !== 6 || !validWorldId(journeyId)
      || !Number.isInteger(state.revision) || state.revision < 0
      || !state.astraWorld || typeof state.astraWorld !== 'object' || Array.isArray(state.astraWorld)
      || !state.astraWorld.player || !Number.isFinite(state.astraWorld.minute)
      || (worldId !== undefined && worldId !== journeyId)
      || (record.worldId !== undefined && record.worldId !== journeyId)) return failure('WORLD_BAD_RECORD', 400);
    if (state.transactionJournal) return failure('WORLD_SAVE_PENDING', 409);
    // Client settings must never carry credentials into checkpoint/ledger storage.
    if (hasCredentialField(record) || hasCredentialField(turn)) return failure('WORLD_BAD_RECORD', 400);
    if (turn !== null && (!validTurn(turn, journeyId)
      || (record.endId !== undefined && record.endId !== turn.id))) return failure('WORLD_BAD_RECORD', 400);
    const hash = await fingerprint(journeyId);
    const metadataKey = `world:metadata:${hash}`;
    const metadata = await this.storage.get(metadataKey) || {revision: -1, sequence: 0};
    if (state.revision < metadata.revision) return failure('WORLD_SAVE_CONFLICT', 409);
    const old = await this.storage.get('world:latest');
    const raw = JSON.stringify(record);
    const generation = crypto.randomUUID();
    const entries = {};
    let count = 0;
    for (let offset = 0; offset < raw.length; offset += 40000) {
      entries[`world:checkpoint:${generation}:${count++}`] = raw.slice(offset, offset + 40000);
    }
    const manifest = {generation, count, worldId: journeyId, revision: state.revision};
    if (turn !== null) {
      const turnKey = `world:turn:${hash}:${await fingerprint(turn.id)}`;
      const previous = await this.storage.get(turnKey);
      const order = previous?.order || ++metadata.sequence;
      entries[turnKey] = {turn, order, world_time: state.astraWorld.minute,
        ...(previous?.importOrder !== undefined ? {importOrder: previous.importOrder} : {})};
    }
    entries[metadataKey] = {...metadata, revision: state.revision, worldMinute: state.astraWorld.minute};
    entries['world:latest'] = manifest;
    // One KV multi-put commits chunks, transcript and the active pointer atomically.
    // Every chunk is below the KV 128KiB per-value limit even for UTF-8 Chinese.
    await this.storage.put(entries);
    if (old) {
      for (let index = 0; index < old.count; index++) await this.storage.delete(`world:checkpoint:${old.generation}:${index}`);
    }
    return json({saved: true, worldId: journeyId, revision: state.revision});
  }

  async loadWorld() {
    const manifest = await this.storage.get('world:latest');
    if (!manifest) return null;
    const chunks = [];
    for (let index = 0; index < manifest.count; index++) {
      const chunk = await this.storage.get(`world:checkpoint:${manifest.generation}:${index}`);
      if (typeof chunk !== 'string') throw Error('Incomplete world checkpoint');
      chunks.push(chunk);
    }
    return JSON.parse(chunks.join(''));
  }

  async importTurns({worldId, turns}) {
    if (!validWorldId(worldId) || !Array.isArray(turns) || turns.length > 100
      || turns.some(turn => !validTurn(turn, worldId))) return failure('WORLD_BAD_RECORD', 400);
    const hash = await fingerprint(worldId);
    const metadataKey = `world:metadata:${hash}`;
    const metadata = await this.storage.get(metadataKey);
    if (!metadata) return failure('WORLD_NOT_FOUND', 404);
    const entries = {};
    let importSequence = metadata.importSequence || 0;
    for (const turn of turns) {
      const turnKey = `world:turn:${hash}:${await fingerprint(turn.id)}`;
      const previous = entries[turnKey] || await this.storage.get(turnKey);
      if (previous && canonicalJson(previous.turn) !== canonicalJson(turn)) return failure('WORLD_TURN_CONFLICT', 409);
      const importOrder = previous?.importOrder ?? ++importSequence;
      entries[turnKey] = {...previous, turn, importOrder, order: importOrder,
        world_time: previous?.world_time ?? (Number.isFinite(turn.world_time) ? turn.world_time : metadata.worldMinute)};
    }
    // Imports replay in original chronological batches. Existing imported IDs keep
    // their position, and the initially saved last turn joins its original position.
    entries[metadataKey] = {...metadata, importSequence, sequence: Math.max(metadata.sequence, importSequence)};
    await this.storage.put(entries);
    return json({imported: turns.length, worldId});
  }

  async worldTurns(worldId) {
    if (!validWorldId(worldId)) return [];
    const hash = await fingerprint(worldId);
    return [...(await this.storage.list({prefix: `world:turn:${hash}:`})).values()].sort((left, right) =>
      Number(left.importOrder === undefined) - Number(right.importOrder === undefined) || left.order - right.order);
  }

  async worldMemory({worldId, query = ''}) {
    if (typeof query !== 'string' || query.length > 2000) return [];
    const turns = await this.worldTurns(worldId);
    const words = String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const terms = new Set();
    for (const word of words) {
      if (/^[a-z0-9]+$/.test(word)) { if (word.length > 1) terms.add(word); }
      else for (let index = 0; index + 1 < word.length; index++) terms.add(word.slice(index, index + 2));
    }
    const rows = turns.map(entry => {
      const summary = String(entry.turn.summary || entry.turn.blocks.map(block => block.text).join(' ')).slice(0, 2000);
      const searchable = `${summary} ${entry.turn.userText || ''} ${entry.turn.speech || ''}`.toLowerCase();
      return {id: entry.turn.id, summary, world_time: entry.world_time,
        order: entry.order, score: [...terms].filter(term => searchable.includes(term)).length};
    });
    const matching = rows.filter(row => row.score > 0);
    return (matching.length ? matching.sort((a, b) => b.score - a.score || b.order - a.order)
      : rows.sort((a, b) => b.order - a.order)).slice(0, 4)
      .map(({id, summary, world_time}) => ({id, summary, world_time}));
  }

  async alarm() {
    const entries = await this.storage.list();
    let next = Infinity;
    for (const [key, value] of entries) {
      if (!value?.expiresAt) continue;
      if (value.expiresAt <= this.clock()) await this.storage.delete(key);
      else next = Math.min(next, value.expiresAt);
    }
    const active = await this.storage.get('active');
    if (active && !(await this.storage.get(`credential:${active}`))) await this.storage.delete('active');
    if (Number.isFinite(next)) await this.storage.setAlarm(next);
    else await this.storage.deleteAlarm();
  }
}
