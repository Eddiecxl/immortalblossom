import { retryAfterMs } from '../ai-errors.js';

export function retryDelay(response, data = {}, now = Date.now()) {
  return Math.max(1000, retryAfterMs(response, data, 30000, now));
}

export function cancellationError(signal) {
  return Object.assign(new Error(signal?.reason?.name === 'TimeoutError'
    ? 'AI 请求超时；输入和世界保持原样，请稍后重试。'
    : '已停止等待，输入和世界保持原样。'),
  {code: signal?.reason?.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_CANCELLED'});
}

export function reportRequestState(detail) {
  if (typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent?.(new CustomEvent('lx:request-state', {detail}));
  if (detail.ms > 0) globalThis.dispatchEvent?.(new CustomEvent('lx:cooldown', {detail: {ms: detail.ms}}));
}

export function waitForRequestSlot(ms, signal) {
  if (signal?.aborted) return Promise.reject(cancellationError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancelled); resolve(); }, ms);
    function cancelled() { clearTimeout(timer); reject(cancellationError(signal)); }
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

// One in-flight request across world/system/test. Cooldowns are provider/account
// scoped (never model scoped); rejected actions are not queued for later replay.
export function createRequestGate({clock = Date.now, interval = () => 8000, wait = waitForRequestSlot,
  report = () => {}, onState = reportRequestState} = {}) {
  let busy = false;
  const cooldowns = new Map();
  const remaining = key => Math.max(0, (cooldowns.get(key)?.until || 0) - clock());
  const notify = detail => { try { onState(detail); if (detail.ms > 0) report(detail.ms); } catch {} };
  return {
    remaining: (key = 'default') => remaining(key),
    reset: (key = 'default') => cooldowns.delete(key),
    async run(task, signal, key = 'default') {
      if (signal?.aborted) throw cancellationError(signal);
      if (busy) {
        notify({busy: true, phase: 'busy', code: 'AI_BUSY', ms: 0});
        throw Object.assign(new Error('上一段推演尚未完成；本次输入已保留，请稍候。'), {code: 'AI_BUSY'});
      }
      busy = true;
      try {
        const ms = remaining(key);
        if (ms > 0) {
          notify({busy: true, phase: 'cooldown', code: cooldowns.get(key)?.code, ms});
          await wait(ms, signal);
        }
        if (signal?.aborted) throw cancellationError(signal);
        notify({busy: true, phase: 'requesting', ms: 0});
        const spacing = Math.max(0, Number(interval()) || 0);
        cooldowns.set(key, {until: clock() + spacing, code: 'AI_REQUEST_COOLDOWN', status: 429});
        const result = await task();
        if (signal?.aborted) throw cancellationError(signal);
        return result;
      } catch (error) {
        const wait = Number(error?.retryAfterMs) || (error?.status === 429 && error?.code !== 'AI_INPUT_BUDGET' ? 30000 : 0);
        if (Number.isFinite(wait) && wait > 0) cooldowns.set(key, {
          until: Math.max(clock() + wait, cooldowns.get(key)?.until || 0),
          code: error.code || 'AI_RATE_LIMITED', status: error.status || 429
        });
        throw error;
      } finally {
        busy = false;
        const ms = remaining(key);
        notify({busy: false, phase: ms > 0 ? 'cooldown' : 'idle', ms, code: cooldowns.get(key)?.code});
      }
    }
  };
}
