import {createRequestGate,cancellationError,waitForRequestSlot} from './beta4/request-gate.js';
import {aiHttpError} from './ai-errors.js';
const ROUTE_KEY_PREFIX = 'luoxian_v31_ai_route:';
const SETTINGS_KEY = 'luoxian_v31_ai_settings_v2';
const STICKY_MS = 30 * 60 * 1000;

export const V31_PROVIDER_DEFAULTS = {
  local: { label: '本地 AI · Qwen', model: 'local' },
  groq: { label: 'Groq', model: 'qwen/qwen3.8-27b' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash' },
  tokenharbor: { label: 'Token Harbor', model: 'qwen3.8-max' },
  openai: { label: 'OpenAI', model: 'gpt-4.1-mini' },
  openrouter: { label: 'OpenRouter', model: '' },
  mistral: { label: 'Mistral', model: 'mistral-small-latest' },
  siliconflow: { label: 'SiliconFlow', model: 'Qwen/Qwen2.5-7B-Instruct' },
  custom: { label: '自定义 OpenAI-Compatible', model: '' }
};

const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const now = () => Date.now();

function defaultSettings() {
  return {
    mode: 'local',
    preferred: 'groq',
    models: Object.fromEntries(Object.entries(V31_PROVIDER_DEFAULTS).map(([id, p]) => [id, p.model])),
    customBaseUrl: ''
  };
}

export function loadV31AiSettings(storage = globalThis.localStorage) {
  const base = defaultSettings();
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}');
    if (saved && typeof saved === 'object') {
      if (V31_PROVIDER_DEFAULTS[saved.preferred]) base.preferred = saved.preferred;
      if (['auto-stable','hybrid-assist','local',...Object.keys(V31_PROVIDER_DEFAULTS).filter(id => id !== 'local')].includes(saved.mode)) {
        // Beta v1 Living World migrates the old auto route into a single fixed provider.
        // Narrative voice must stay consistent across turns; failures retry the same provider.
        base.mode = saved.mode === 'auto-stable' ? (base.preferred || 'groq') : saved.mode;
      }
      if (saved.models && typeof saved.models === 'object') {
        for (const id of Object.keys(base.models)) {
          if (typeof saved.models[id] === 'string') base.models[id] = clean(saved.models[id], 180);
        }
      }
      if (typeof saved.customBaseUrl === 'string') base.customBaseUrl = clean(saved.customBaseUrl, 400);
    }
  } catch {}
  return base;
}

export function saveV31AiSettings(settings, storage = globalThis.localStorage) {
  const current = loadV31AiSettings(storage);
  const next = {
    ...current,
    ...settings,
    models: { ...current.models, ...(settings?.models || {}) }
  };
  storage?.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function jsonFetch(fetchImpl, path, options = {}) {
  const timeout=AbortSignal.timeout(path.endsWith('/generate')?90000:15000);
  const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
  if(signal.aborted)throw cancellationError(signal);
  let response;
  try {
  response = await fetchImpl(path, {
    cache: 'no-store',
    ...options,
    signal,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  }catch(error){if(signal.aborted)throw cancellationError(signal);throw Object.assign(new Error('无法连接 AI 服务，请检查网络；输入和世界保持原样。'),{code:'AI_NETWORK_FAILED'});}
  const data = await response.json().catch(() => ({}));
  if(signal.aborted)throw cancellationError(signal);
  if (!response.ok) {
    throw aiHttpError(response,data,true);
  }
  return data;
}

export function createV31HybridClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  clock = now
} = {}) {
  if (!fetchImpl) throw new Error('当前环境没有网络接口。');

  let statusCache = { at: 0, value: null };
  const gate = createRequestGate({clock, interval:()=>{
    try{return JSON.parse(storage?.getItem('luoxian_beta3_settings')||'{}').requestInterval * 1000 || 8000;}catch{return 8000;}
  },report:ms=>globalThis.dispatchEvent?.(new CustomEvent('lx:cooldown',{detail:{ms}}))});

  async function status(force = false) {
    if (!force && statusCache.value && clock() - statusCache.at < 5000) return statusCache.value;
    const [cloud, local] = await Promise.all([
      jsonFetch(fetchImpl, '/api/ai/cloud/status').catch(() => ({ configured: {}, providers: [] })),
      jsonFetch(fetchImpl, '/api/ai/status').catch(() => ({ ready: false, runtimeInstalled: false, modelInstalled: false, state: 'unavailable' }))
    ]);
    statusCache = { at: clock(), value: { cloud, local } };
    return statusCache.value;
  }

  function stickyKey(journeyId) {
    return ROUTE_KEY_PREFIX + clean(journeyId || 'default', 100);
  }

  function loadSticky(journeyId) {
    try {
      const value = JSON.parse(storage?.getItem(stickyKey(journeyId)) || 'null');
      if (!value?.provider || !V31_PROVIDER_DEFAULTS[value.provider]) return null;
      return value;
    } catch { return null; }
  }

  function pin(journeyId, provider, reason = 'selected') {
    const value = { provider, reason, selectedAt: clock(), until: clock() + STICKY_MS };
    try { storage?.setItem(stickyKey(journeyId), JSON.stringify(value)); } catch {}
    return value;
  }

  function candidateOrder(settings, availability, journeyId) {
    const mode = settings.mode || 'local';
    if (mode === 'local') return ['local'];
    if (mode === 'hybrid-assist') {
      const cloud = settings.preferred && settings.preferred !== 'local' ? settings.preferred : 'groq';
      if (settings.forceCloudAssist) return [cloud];
      const sticky = loadSticky(journeyId);
      if (sticky?.provider === cloud && sticky.until > clock()) return [cloud];
      return [ 'local', cloud ];
    }
    if (mode !== 'auto-stable') return [mode];

    // Legacy Auto Stable no longer rotates through providers. Preserve the old
    // preference as ONE fixed cloud route so voice, pacing and character style
    // cannot jump between Groq/Gemini/Local in the middle of a scene.
    const preferred = V31_PROVIDER_DEFAULTS[settings.preferred] && settings.preferred !== 'local'
      ? settings.preferred : 'groq';
    return [preferred];
  }

  async function narrateOnce(settingsInput = {}, context = {}) {
    const persisted = loadV31AiSettings(storage);
    const settings = {
      ...persisted,
      ...settingsInput,
      models: { ...persisted.models, ...(settingsInput.models || {}) }
    };
    const availability = await status();
    const journeyId = context.journeyId || settings.journeyId || 'default';
    const candidates = candidateOrder(settings, availability, journeyId);
    if (!candidates.length) throw new Error('没有可用的叙事 AI；世界引擎会保留本回合。');
    const messages = Array.isArray(context.messages) ? context.messages.map(m => ({ role: m.role, content: String(m.content || '') })) : [];
    const explicitMaxTokens = Number(context.maxTokens);
    const temperature = Number.isFinite(Number(context.temperature)) ? Number(context.temperature) : 0.72;
    let lastError;

    for (let index = 0; index < candidates.length; index++) {
      const provider = candidates[index];
      const providerDefaultTokens = provider === 'local'
        ? (context.requestType === 'system' ? 192 : context.requestType === 'repair' ? 420 : context.importance === 'important' ? 640 : 512)
        : context.requestType === 'system' ? 440
          : context.requestType === 'repair' ? 1200
            : context.importance === 'important' ? 1300 : 1050;
      const maxTokens = Math.min(1500, Math.max(64,
        Number.isFinite(explicitMaxTokens) && explicitMaxTokens > 0 ? explicitMaxTokens : providerDefaultTokens));
      const model = clean(settings.models?.[provider] ?? V31_PROVIDER_DEFAULTS[provider]?.model, 180);
      if(provider!=='local'&&!model)throw Object.assign(new Error('请在 AI 设置中填写当前服务商的模型名称。'),{code:'AI_MODEL_UNAVAILABLE'});
      if(provider!=='local'&&availability.cloud?.configured?.[provider]===false)throw Object.assign(new Error('请先为当前服务商保存 API Key。'),{code:'AI_NOT_CONFIGURED'});
      // Fixed modes retry the SAME provider once. This prevents voice/style jumping
      // between Groq/Local/other clouds during an ordinary play session.
      const sameProviderAttempts = 2;
      for (let attempt = 0; attempt < sameProviderAttempts; attempt += 1) {
        try {
          let data;
          if (provider === 'local') {
            const requestedTask = String(context.requestType || 'narrate');
            const localTask = requestedTask === 'system' ? 'system'
              : requestedTask === 'intent' ? 'intent'
              : requestedTask === 'npc' ? 'npc'
              : 'narrate';
            data = await jsonFetch(fetchImpl, '/api/ai/generate', {
              method: 'POST', signal: context.signal,
              body: JSON.stringify({ task: localTask, messages, maxTokens, temperature })
            });
          } else {
            data = await jsonFetch(fetchImpl, '/api/ai/cloud/generate', {
              method: 'POST', signal: context.signal,
              body: JSON.stringify({
                provider, model, ...(provider === 'custom' ? { baseUrl: settings.customBaseUrl } : {}),
                messages, maxTokens, temperature
              })
            });
          }
          if (!data?.text?.trim()) {
            const empty = new Error('AI 返回为空。');
            empty.status = 503;
            throw empty;
          }
          pin(journeyId, provider, settings.forceCloudAssist ? 'cloud-assist' : attempt ? 'same-provider-retry' : (index ? 'hybrid-assist' : 'primary'));
          return data.text;
        } catch (error) {
          lastError = error;
          if (error?.name === 'AbortError') throw error;
          const retryable = provider === 'local' || isRetryableStatus(Number(error?.status || 0));
          if (!retryable) throw error;
          // A daily/long token cooldown is not an invitation to retry early.
          // Preserve the provider gate and let the UI keep the user's input.
          if (Number(error?.retryAfterMs) > 60000) throw error;
          if (attempt < sameProviderAttempts - 1) {
            const delay = Math.max(1200, Number(error?.retryAfterMs) || 1500);
            await waitForRequestSlot(delay, context.signal);
            continue;
          }
          if (index === candidates.length - 1) throw error;
        }
      }
    }
    throw lastError || new Error('没有可用的 AI。');
  }

  async function saveCredential(provider, key) {
    const data = await jsonFetch(fetchImpl, '/api/ai/cloud/credential', {
      method: 'POST',
      body: JSON.stringify({ provider, key })
    });
    statusCache.at = 0;
    return data;
  }

  async function clearCredential(provider) {
    const data = await jsonFetch(fetchImpl, '/api/ai/cloud/clear', {
      method: 'POST',
      body: JSON.stringify({ provider })
    });
    statusCache.at = 0;
    return data;
  }

  async function testProvider(provider, model, baseUrl = '') {
    return jsonFetch(fetchImpl, '/api/ai/cloud/test', {
      method: 'POST',
      body: JSON.stringify({ provider, model, ...(provider === 'custom' ? { baseUrl } : {}) })
    });
  }

  return {
    narrate: (settings, context = {}) => gate.run(() => narrateOnce(settings, {...context,
      signal: context.signal ? AbortSignal.any([context.signal,AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000)
    }), context.signal,settings?.forceCloudAssist ? settings.preferred || 'groq'
      : settings?.mode==='auto-stable'?settings.preferred||'groq'
      : settings?.mode==='hybrid-assist'?'local':settings?.mode||loadV31AiSettings(storage).mode),
    status,
    pin,
    loadSticky,
    saveCredential,
    clearCredential,
    testProvider: (...args) => gate.run(()=>testProvider(...args),undefined,args[0]),
    loadSettings: () => loadV31AiSettings(storage),
    saveSettings: (value) => saveV31AiSettings(value, storage)
  };
}
