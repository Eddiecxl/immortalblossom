const STORE_KEY = 'luoxian_beta_audio_v1';

const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));

export function createAudioEngine({ lowSpec = false } = {}) {
  let ctx = null;
  let master = null;
  let enabled = true;
  let timer = 0;
  let step = 0;
  let intensity = 0;
  const notes = [220, 247, 294, 330, 294, 247, 196, 220];
  try { enabled = localStorage.getItem(STORE_KEY) !== 'off'; } catch {}

  function ensure() {
    if (ctx) return ctx;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.055;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(freq, duration = .14, gain = .05, type = 'sine', when = 0) {
    if (!enabled) return;
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(.001, gain), t + .018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + duration + .03);
  }

  function scheduleBgm() {
    clearTimeout(timer);
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const base = notes[step % notes.length] * (intensity >= 2 && step % 4 === 3 ? 1.5 : 1);
    tone(base, 1.55, lowSpec ? .020 : .024, 'sine');
    if (!lowSpec && step % 2 === 0) tone(base / 2, 1.8, .013, 'triangle', .04);
    if (!lowSpec && intensity >= 2 && step % 4 === 0) tone(base * 2, .24, .012, 'triangle', .12);
    step += 1;
    timer = setTimeout(scheduleBgm, intensity >= 2 ? 1650 : 2200);
  }

  async function unlock() {
    const c = ensure();
    if (!c) return false;
    try { if (c.state !== 'running') await c.resume(); } catch { return false; }
    if (enabled && !timer) scheduleBgm();
    return c.state === 'running';
  }

  function setEnabled(next) {
    enabled = Boolean(next);
    try { localStorage.setItem(STORE_KEY, enabled ? 'on' : 'off'); } catch {}
    if (!enabled) { clearTimeout(timer); timer = 0; }
    else unlock().then(() => { if (!timer) scheduleBgm(); });
    return enabled;
  }

  function sfx(name) {
    if (!enabled) return;
    if (name === 'send') { tone(392,.08,.035,'triangle'); tone(523,.10,.026,'sine',.055); }
    else if (name === 'turn') { tone(262,.12,.024,'sine'); tone(330,.15,.022,'sine',.08); }
    else if (name === 'system') { tone(523,.08,.025,'sine'); tone(659,.12,.022,'sine',.06); }
    else if (name === 'law') { tone(196,.25,.04,'triangle'); tone(392,.32,.034,'sine',.08); tone(784,.42,.018,'sine',.16); }
    else if (name === 'danger') { tone(110,.20,.052,'sawtooth'); tone(98,.26,.040,'triangle',.13); }
    else if (name === 'death') { tone(196,.35,.032,'triangle'); tone(147,.5,.030,'sine',.24); tone(110,.8,.024,'sine',.52); }
    else if (name === 'click') tone(440,.055,.018,'sine');
  }

  function setIntensity(level = 0, hpRatio = 1) {
    intensity = Math.max(clamp(level,0,3), hpRatio < .35 ? 2 : hpRatio < .6 ? 1 : 0);
  }

  return { unlock, setEnabled, isEnabled: () => enabled, sfx, setIntensity };
}
