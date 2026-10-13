import {DEFAULT_MODEL, SessionStore, GroqQueue, SESSION_RETENTION_MS, failure, fingerprint, internalRequest, json, objectStub} from './groq-queue.mjs';
export {SessionStore, GroqQueue};

const COOKIE_NAME = '__Host-lx_cloud_session';
const MAX_AI_BODY_BYTES = 96 * 1024;
const MAX_WORLD_BODY_BYTES = 4 * 1024 * 1024;

async function readBody(request, maxBytes = MAX_AI_BODY_BYTES) {
  const length = Number(request.headers.get('content-length'));
  if (length > maxBytes) throw {code: 'AI_BODY_TOO_LARGE', status: 413};
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw {code: 'AI_BAD_REQUEST', status: 400};
  const reader = request.body?.getReader();
  if (!reader) throw {code: 'AI_BAD_REQUEST', status: 400};
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel(); throw {code: 'AI_BODY_TOO_LARGE', status: 413}; }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const result = JSON.parse(new TextDecoder().decode(body));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch { throw {code: 'AI_BAD_REQUEST', status: 400}; }
}

function normalizeGeneration(data, probe = false) {
  if (data.provider !== undefined && data.provider !== 'groq') throw {code: 'AI_BAD_REQUEST', status: 400};
  if (data.baseUrl || data.endpoint || data.key || data.apiKey) throw {code: 'AI_BAD_REQUEST', status: 400};
  const model = data.model ?? DEFAULT_MODEL;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,179}$/.test(model)) throw {code: 'AI_BAD_REQUEST', status: 400};
  const messages = probe ? [{role: 'user', content: '请只回复：连接正常'}] : data.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 64) throw {code: 'AI_BAD_REQUEST', status: 400};
  let total = 0;
  const normalized = messages.map(message => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) throw {code: 'AI_BAD_REQUEST', status: 400};
    total += message.content.length;
    if (total > 192 * 1024) throw {code: 'AI_BODY_TOO_LARGE', status: 413};
    return {role: message.role, content: message.content};
  });
  const maxTokens = probe ? 16 : data.maxTokens ?? 1050;
  const temperature = probe ? 0 : data.temperature ?? 0.72;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096
    || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw {code: 'AI_BAD_REQUEST', status: 400};
  if (data.transactionId !== undefined && (typeof data.transactionId !== 'string' || !data.transactionId.trim() || data.transactionId.length > 180)) throw {code: 'AI_BAD_REQUEST', status: 400};
  return {provider: 'groq', model, messages: normalized, maxTokens, temperature};
}

function sessionFor(request) {
  const match = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-lx_cloud_session=([a-f0-9]{64})(?:;|$)/);
  if (match) return {id: match[1], fresh: false};
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {id: [...bytes].map(value => value.toString(16).padStart(2, '0')).join(''), fresh: true};
}

function withSession(response, session) {
  const headers = new Headers(response.headers);
  if (session.fresh) headers.set('Set-Cookie', `${COOKIE_NAME}=${session.id}; Path=/; Max-Age=${SESSION_RETENTION_MS / 1000}; HttpOnly; Secure; SameSite=Strict`);
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/') return Response.redirect(new URL('/launcher/', url), 302);
      if (['/game/v4/index.html', '/launcher/index.html'].includes(url.pathname)) return Response.redirect(new URL(url.pathname.replace(/index\.html$/, ''), url), 302);
      return env.ASSETS.fetch(request);
    }
    const session = sessionFor(request);
    try {
      if (request.method === 'POST') {
        const origin = request.headers.get('origin');
        if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return withSession(failure('AI_FORBIDDEN', 403), session);
      }
      let response;
      if (url.pathname === '/api/status' && request.method === 'GET') {
        response = json({healthy: true, cloud: true, bad_files: [], version: env.CLOUD_VERSION || '4.1.4', worker: 'immortalblossombeta'});
      } else if (url.pathname === '/api/ai/status' && request.method === 'GET') {
        response = json({ready: false, cloud: true, state: 'unavailable', runtimeInstalled: false, modelInstalled: false});
      } else {
        const store = objectStub(env.SESSION_STORE, session.id);
        if (url.pathname === '/api/world/save' && request.method === 'POST') {
          response = await store.fetch(internalRequest('/world/save', await readBody(request, MAX_WORLD_BODY_BYTES)));
        } else if (url.pathname === '/api/world/import-turns' && request.method === 'POST') {
          response = await store.fetch(internalRequest('/world/import-turns', await readBody(request, MAX_WORLD_BODY_BYTES)));
        } else if (url.pathname === '/api/world/load' && request.method === 'GET') {
          response = await store.fetch(internalRequest('/world/load'));
        } else if (url.pathname === '/api/world/memory' && request.method === 'POST') {
          response = await store.fetch(internalRequest('/world/memory', await readBody(request)));
        } else if (url.pathname === '/api/world/turns' && request.method === 'GET') {
          response = await store.fetch(internalRequest(`/world/turns?worldId=${encodeURIComponent(url.searchParams.get('worldId') || '')}`));
        } else if (url.pathname === '/api/ai/cloud/status' && request.method === 'GET') {
          response = await store.fetch(internalRequest('/status'));
        } else if (url.pathname === '/api/ai/cloud/credential' && request.method === 'POST') {
          const data = await readBody(request);
          if (data.provider !== 'groq' || typeof data.key !== 'string' || !/^gsk_[a-zA-Z0-9_-]{8,256}$/.test(data.key.trim())) response = failure('AI_BAD_REQUEST', 400);
          else response = await store.fetch(internalRequest('/credential', {key: data.key.trim()}));
        } else if (url.pathname === '/api/ai/cloud/clear' && request.method === 'POST') {
          const data = await readBody(request);
          response = data.provider === 'groq' ? await store.fetch(internalRequest('/clear', {})) : failure('AI_BAD_REQUEST', 400);
        } else if (['/api/ai/cloud/generate', '/api/ai/cloud/test'].includes(url.pathname) && request.method === 'POST') {
          const data = await readBody(request);
          const payload = normalizeGeneration(data, url.pathname.endsWith('/test'));
          const requestHash = await fingerprint(JSON.stringify(payload));
          const transactionHash = data.transactionId ? await fingerprint(data.transactionId) : null;
          response = await store.fetch(internalRequest('/submit', {sessionId: session.id, payload, requestHash, transactionHash}));
        } else if (/^\/api\/ai\/cloud\/jobs\/[a-f0-9-]{36}$/.test(url.pathname) && request.method === 'GET') {
          response = await store.fetch(internalRequest(`/jobs/${url.pathname.split('/').at(-1)}`));
        } else {
          response = failure('AI_JOB_NOT_FOUND', 404);
        }
      }
      return withSession(response, session);
    } catch (error) {
      // Exceptions can contain a credential, prompt or upstream body. Never echo them.
      return withSession(failure(error?.code && ['AI_BAD_REQUEST', 'AI_BODY_TOO_LARGE'].includes(error.code) ? error.code : 'AI_UPSTREAM_FAILED',
        error?.status === 413 ? 413 : error?.status === 400 ? 400 : 503), session);
    }
  }
};
