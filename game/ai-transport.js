import { aiHttpError } from './ai-errors.js';
import { cancellationError } from './beta4/request-gate.js';

// Exactly one HTTP attempt. A retry can consume a second generation even when
// the first response was lost. The player explicitly retries after feedback.
export async function requestJsonOnce(fetchImpl, url, options = {}, {timeoutMs = 28000, recover} = {}) {
  const controller = new AbortController();
  const parent = options.signal;
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) throw cancellationError(parent);
  parent?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeoutMs);
  const check = () => { if (controller.signal.aborted) throw cancellationError(controller.signal); };
  try {
    const response = await fetchImpl(url, {...options, signal: controller.signal});
    check();
    let data;
    try { data = await response.json(); } catch {
      check();
      if (response.ok) throw Object.assign(new Error('AI 返回了无法读取的响应；输入和世界保持原样。'), {code: 'AI_INVALID_RESPONSE'});
      data = {};
    }
    check();
    if (!response.ok) {
      const recovered = recover?.(response, data);
      if (recovered) return recovered;
      throw aiHttpError(response, data, url.startsWith('/'));
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw Object.assign(new Error('AI 返回的响应格式无效；输入和世界保持原样。'), {code: 'AI_INVALID_RESPONSE'});
    }
    return data;
  } catch (error) {
    check();
    if (error?.code) throw error;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw cancellationError({reason: error});
    throw Object.assign(new Error('无法连接 AI 服务，请检查网络后再试；输入和世界保持原样。'), {code: 'AI_NETWORK_ERROR'});
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}
