// Isolated, local-only semantic plans. No database, native bridge or API key.
import { createGameState } from '../../game/game-state.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
const endpoint = process.argv.find(arg => arg.startsWith('--endpoint='))?.slice(11) || 'http://127.0.0.1:27204/v1/chat/completions';
const output = [];
for (const seed of ['local-semantic-a', 'local-semantic-b']) {
  const state = createGameState('顾长生', 'ai', () => seed);
  const npc = Object.values(state.astraWorld.characters).find(entry => entry.alive);
  npc.locationId = state.astraWorld.player.locationId; npc.travel = null;
  npc.lastPlanBucket = Math.floor(state.astraWorld.minute / 20);
  npc.gender = '男';
  const turns = [], calls = [];
  const runner = createAiTurnRunner({ aiClient: { narrate: async (_, request) => {
    const started = performance.now();
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'local', messages: request.messages, temperature: 0.35, max_tokens: 768,
        response_format: { type: 'json_object' } }), signal: AbortSignal.timeout(120000) });
    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content || '';
    calls.push({ seconds: (performance.now() - started) / 1000, usage: json.usage, status: response.status, raw });
    if (!response.ok) throw new Error('Local test HTTP ' + response.status);
    return raw;
  } }, transcriptStore: { recentTurns: async () => turns, appendTurn: async (_, turn) => turns.push(turn) } });
  const result = await runner.runWorld({ state, input: { speech: '言出法随：将' + npc.name + '变成女性，其余身份和记忆保留', action: '' },
    settings: { mode: 'local', localModelName: 'Qwen3-14B-Q4_K_M.gguf' } });
  output.push({ seed, ok: result.ok, error: result.error, gender: result.state?.astraWorld.characters[npc.id].gender,
    stableId: result.state?.astraWorld.characters[npc.id].id === npc.id, calls });
}
console.log(JSON.stringify(output, null, 2));
