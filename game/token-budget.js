export const TOKEN_LIMITS = { minute: 6500, day: 160000 };
export function estimateRequestTokens(messages, completion = 600) {
  const content = messages.map(m => String(m.content || '')).join('\n');
  const han = (content.match(/[\p{Script=Han}]/gu) || []).length;
  return Math.ceil(han * 1.7 + (content.length - han) / 2.5 + completion + 100);
}
export function reserveTokens(raw, amount, id, now = Date.now()) {
  const records = (Array.isArray(raw?.records) ? raw.records : []).filter(e => e.at > now - 86400000 && Number.isFinite(e.tokens) && e.tokens >= 0).sort((a, b) => a.at - b.at);
  const minute = records.filter(e => e.at > now - 60000);
  const sum = rows => rows.reduce((n, e) => n + e.tokens, 0);
  let wait = Math.max(0, (raw?.pauseUntil || 0) - now);
  if (!Number.isFinite(amount) || amount <= 0 || amount > TOKEN_LIMITS.minute) return { ok: false, code: 'AI_INPUT_BUDGET', retryAfterMs: 0, ledger: { records, pauseUntil: raw?.pauseUntil || 0 } };
  if (sum(minute) + amount > TOKEN_LIMITS.minute) {
    let freed = 0;
    for (const row of minute) { freed += row.tokens; if (sum(minute) + amount - freed <= TOKEN_LIMITS.minute) { wait = Math.max(wait, row.at + 60100 - now); break; } }
  }
  if (sum(records) + amount > TOKEN_LIMITS.day) {
    let freed = 0;
    for (const row of records) { freed += row.tokens; if (sum(records) + amount - freed <= TOKEN_LIMITS.day) { wait = Math.max(wait, row.at + 86400100 - now); break; } }
  }
  if (wait > 0) return { ok: false, code: 'AI_TOKEN_COOLDOWN', retryAfterMs: wait, ledger: { records, pauseUntil: raw?.pauseUntil || 0 } };
  records.push({ id, at: now, tokens: Math.max(1, Math.ceil(amount)) });
  return { ok: true, ledger: { records, pauseUntil: 0 }, remainingMinute: TOKEN_LIMITS.minute - sum(minute) - amount };
}
export function settleTokens(ledger, id, actual) {
  if (!Number.isFinite(actual) || actual < 0) return ledger;
  return { ...ledger, records: (ledger.records || []).map(row => row.id === id ? { ...row, tokens: Math.ceil(actual) } : row) };
}
export function budgetError(result) {
  return Object.assign(new Error(result.code === 'AI_INPUT_BUDGET' ? '这次上下文超过单轮安全预算，请缩短行动或稍后继续。'
    : `AI 额度保护中，约 ${Math.ceil(result.retryAfterMs / 1000)} 秒后可继续；输入和世界保持原样。`),
  { code: result.code, status: 429, retryAfterMs: result.retryAfterMs });
}

const volatileLedgers = new Map();
export async function withPersonalBudget(storage, key, tokens, send) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const id = 'luoying_token_budget_' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  const run = async () => {
    let ledger = volatileLedgers.get(id) || { records: [] };
    try { ledger = JSON.parse(storage?.getItem(id) || 'null') || ledger; } catch {}
    const persist = () => { volatileLedgers.set(id, ledger); try { storage?.setItem(id, JSON.stringify(ledger)); } catch {} };
    const requestId = crypto.randomUUID();
    const admission = reserveTokens(ledger, tokens, requestId);
    ledger = admission.ledger; persist();
    if (!admission.ok) throw budgetError(admission);
    try {
      return await send(actual => { ledger = settleTokens(ledger, requestId, actual); persist(); });
    } catch (error) {
      if (error.status === 429) {
        ledger = settleTokens(ledger, requestId, 0);
        ledger.pauseUntil = Date.now() + (error.retryAfterMs || 60000); persist();
      }
      throw error;
    }
  };
  return globalThis.navigator?.locks ? navigator.locks.request(id, run) : run();
}
