const clean = (value, max = 1800) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  .trim()
  .slice(0, max);

export function normalizePlayerTurnInput(input) {
  if (typeof input === 'string') {
    return { speech: '', action: clean(input, 1800) };
  }
  const speech = clean(input?.speech, 1200);
  const action = clean(input?.action, 1800);
  return { speech, action };
}

export function playerTurnIsEmpty(input) {
  const turn = normalizePlayerTurnInput(input);
  return !turn.speech && !turn.action;
}

export function serializePlayerTurn(input) {
  const turn = normalizePlayerTurnInput(input);
  // Persistence/search text only. Semantic ownership lives in the structured
  // speech/action fields; never leak UI labels into model or story text.
  return [turn.speech, turn.action].filter(Boolean).join('\n');
}

export function actionInputForTurn(input) {
  const turn = normalizePlayerTurnInput(input);
  // Speech is a separate, engine-owned channel. Never synthesize a visible
  // "说话：" prefix and feed it back into the action parser/narrator.
  return turn.action || '';
}

export function makeExactSpeechBlock(speech) {
  const exact = normalizePlayerTurnInput({ speech }).speech;
  if (!exact) return null;
  return {
    type: 'narr',
    text: `我说：“${exact}”`,
    engineOwnedPlayerSpeech: true,
    exactPlayerSpeech: exact
  };
}

export function injectExactPlayerSpeech(narration, speech) {
  const block = makeExactSpeechBlock(speech);
  if (!block) return narration;
  const blocks = Array.isArray(narration?.blocks) ? narration.blocks : [];
  return { ...narration, blocks: [block, ...blocks] };
}

export function stripExactPlayerSpeechEcho(blocks, speech) {
  const exact = normalizePlayerTurnInput({ speech }).speech;
  if (!exact) return blocks;
  return (Array.isArray(blocks) ? blocks : []).map(block => {
    if (block?.type !== 'narr' || block.engineOwnedPlayerSpeech) return block;
    let value = String(block.text || '');
    for (const [left, right] of [['“', '”'], ['「', '」'], ['"', '"']]) {
      const quoted = left + exact + right;
      value = value.split('：' + quoted).join('，').split(':' + quoted).join('，').split(quoted).join('');
    }
    return { ...block, text: value.replace(/([，。！？])\1+/gu, '$1').trim() };
  }).filter(block => block?.type !== 'narr' || block.text);
}

export function playerTurnDisplay(input) {
  const turn = normalizePlayerTurnInput(input);
  const rows = [];
  if (turn.speech) rows.push({ kind: 'speech', label: '说话', text: turn.speech });
  if (turn.action) rows.push({ kind: 'action', label: '行动', text: turn.action });
  return rows;
}

export function hasInventedPlayerDialogue(blocks, speech = '') {
  const exact = normalizePlayerTurnInput({ speech }).speech;
  const text = (Array.isArray(blocks) ? blocks : [])
    .filter(block => !block?.engineOwnedPlayerSpeech)
    .map(block => String(block?.text || ''))
    .join('\n');
  // Player speech belongs to the engine. The narrator may describe facial
  // expression or movement, but must not invent first-person quoted dialogue.
  const quoted = /我(?:低声|轻声|沉声|冷声|高声|大声|开口|直接)?(?:说|道|问|答|喊|喝道|笑道)[^。！？\n]{0,24}[“"][^”"\n]+[”"]/u.test(text);
  if (!quoted) return false;
  // Even when speech exists, the model must not repeat/rewrite it; the engine
  // inserts the exact line exactly once.
  return true;
}
