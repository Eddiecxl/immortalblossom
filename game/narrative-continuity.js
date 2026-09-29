// Extract committed evidence locally; no generated summaries or extra AI calls.
const clean = value => String(value ?? '').replace(/[<>\u0000-\u001f]/g, ' ').trim();
const visibleBlocks = narration => (narration?.blocks || []).filter(b => ['narr', 'dlg'].includes(b?.type) && clean(b?.text));

export function endingExcerpt(value, limit = 140) {
  const text = clean(value);
  if (text.length <= limit) return text;
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/gu) || [text];
  let ending = '';
  for (const sentence of sentences.reverse()) {
    if ((sentence + ending).length > limit) break;
    ending = sentence + ending;
  }
  return ending.trim() || text.slice(-limit);
}

function blockEnding(block, limit) {
  const speaker = block?.type === 'dlg' && block.name ? `${clean(block.name).slice(0, 24)}：` : '';
  return speaker + endingExcerpt(block?.text, limit - speaker.length);
}

export function actionOutcome(narration) {
  const blocks = visibleBlocks(narration);
  const supplied = clean(narration?.reaction?.result).slice(0, 140);
  if (supplied && blocks.some(b => clean(b.text).includes(supplied))) return supplied;
  return blocks.length ? blockEnding(blocks.at(-1), 140) : '';
}

export function sceneOutcome(narration) {
  const blocks = visibleBlocks(narration).slice(-2);
  return blocks.map(b => blockEnding(b, blocks.length === 1 ? 180 : 89)).join(' ');
}

// An advisory next-turn nudge only. A match never rejects, rewrites or retries a reply.
export function repeatsOutcome(left, right) {
  const tokens = value => {
    const text = clean(value).replace(/[\s\p{P}]/gu, '');
    return new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
  };
  const a = tokens(left), b = tokens(right);
  if (Math.min(a.size, b.size) < 8) return false;
  const common = [...a].filter(v => b.has(v)).length;
  return common / (a.size + b.size - common) >= 0.58;
}
