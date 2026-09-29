import { REALMS } from './game-data.js';

// Feedback follows the saved transaction, never a speculative AI sentence.
export function feedbackForTurn(before, after) {
  if (!before || !after || before.journeyId !== after.journeyId
    || after.memory.turnCount <= before.memory.turnCount) return null;
  if (after.player.realm > before.player.realm) return {
    kind: 'breakthrough', title: '破境', detail: REALMS[after.player.realm]?.name || '境界精进'
  };
  const oldLaws = new Set((before.journeyWorld?.laws || []).map(l => l.id));
  const wish = (after.journeyWorld?.laws || []).find(l => l.status === 'fulfilled' && !oldLaws.has(l.id));
  return wish ? { kind: 'wish', title: '言出法随', detail: '一言既出 · 此世有应' } : null;
}

export function createCultivationFeedback({ overlay, title, detail, stage, notify, reduced }) {
  let timer;
  const clear = () => {
    clearTimeout(timer);
    overlay.hidden = true;
    delete stage.dataset.effect;
  };
  return {
    clear,
    play(effect) {
      if (!effect) return;
      clear();
      notify(`${effect.title} · ${effect.detail}`);
      if (reduced() || document.hidden) return;
      title.textContent = effect.title;
      detail.textContent = effect.detail;
      overlay.dataset.kind = effect.kind;
      stage.dataset.effect = effect.kind;
      // Separate frames restart CSS feedback even after consecutive wishes.
      overlay.hidden = false;
      for (const animation of overlay.getAnimations({ subtree: true })) { animation.cancel(); animation.play(); }
      timer = setTimeout(clear, effect.kind === 'breakthrough' ? 2600 : 1800);
    }
  };
}
