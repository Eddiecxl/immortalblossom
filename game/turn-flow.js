// UI submission lock. The Engine still owns the durable transaction boundary.
export function createTurnFlow({ clock = Date.now, cooldownMs = 1500 } = {}) {
  let phase = 'idle';
  let until = 0;
  const remainingMs = () => Math.max(0, until - clock());
  const refresh = () => {
    if (phase === 'cooldown' && remainingMs() === 0) phase = 'idle';
    return phase;
  };
  return {
    state: refresh,
    remainingMs,
    begin() {
      refresh();
      if (phase !== 'idle') return { ok: false, state: phase, remainingMs: remainingMs() };
      phase = 'submitting';
      return { ok: true, state: phase, remainingMs: 0 };
    },
    phase(next) {
      if (!['ai_running', 'engine_commit'].includes(next) || !['submitting', 'ai_running', 'engine_commit'].includes(phase))
        throw new Error('无效的回合流程转换。');
      phase = next;
    },
    commit() {
      if (!['submitting', 'ai_running', 'engine_commit'].includes(phase)) throw new Error('没有待提交的回合。');
      until = clock() + Math.max(0, Number(cooldownMs) || 0);
      phase = until > clock() ? 'cooldown' : 'idle';
    },
    fail() {
      if (phase !== 'cooldown') { phase = 'idle'; until = 0; }
    }
  };
}
