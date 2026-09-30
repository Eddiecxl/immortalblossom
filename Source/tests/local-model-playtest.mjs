// Manual, local-only narrative probe. Never uses saved journeys or a cloud client.
import { createGameState } from '../../game/game-state.js';
import { createAstraOpening } from '../../game/astra-opening.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';

const endpoint = 'http://127.0.0.1:27183/v1/chat/completions';
const output = [];
const structured = process.argv.includes('--structured');
const compact = process.argv.includes('--compact');
const noThink = process.argv.includes('--no-think');
const modelLabel = process.argv.find(arg => arg.startsWith('--model='))?.slice('--model='.length) || 'Qwen3-14B-Q4_K_M.gguf';
const scenarioCount = Number(process.argv.find(arg => arg.startsWith('--scenarios='))?.split('=')[1] || 2);
const turnCount = Number(process.argv.find(arg => arg.startsWith('--turns='))?.split('=')[1] || 4);
const scenarios = [];
for (let i = 0; i < 120 && scenarios.length < scenarioCount; i++) {
  const state = createGameState('顾长生', 'ai', () => `local-playtest-${i}`);
  const opened = createAstraOpening(state);
  const world = opened.state.astraWorld;
  const present = Object.values(world.characters).filter(npc => npc.alive && !npc.travel && npc.locationId === world.player.locationId);
  if (present.length && !scenarios.some(entry => entry.opportunity === world.flags.earlyOpportunity))
    scenarios.push({ state: opened.state, opening: opened.turn, npc: present[0], opportunity: world.flags.earlyOpportunity });
}
if (scenarios.length < scenarioCount) throw new Error('Could not find enough distinct seeded encounters.');

for (const scenario of scenarios) {
  let state = scenario.state;
  const turns = [scenario.opening];
  const aiClient = {
    loadSticky: () => ({ provider: 'local' }),
    narrate: async (_settings, context) => {
      const started = performance.now();
      let messages = context.messages;
      if (compact) {
        const packetText = messages.find(message => message.role === 'user')?.content || '';
        const start = packetText.indexOf('世界事实：') + '世界事实：'.length;
        const end = packetText.indexOf('\n本回合已结算事件：', start);
        const packet = JSON.parse(packetText.slice(start, end));
        const facts = { location: packet.location, playerTurn: packet.playerTurn,
          conversation: packet.conversation, presentNpcs: packet.presentNpcs,
          rumors: packet.rumors, history: packet.history, recentTurns: packet.recentTurns };
        messages = [
          { role: 'system', content: '你只叙述引擎已记录的中文修仙游戏事实。玩家本轮说的话由游戏显示，不得由你重述。只输出 JSON：{"blocks":[{"type":"dlg","name":"在场人物姓名","text":"回答"}]}。必须让被点名且在场的人直接回答；不知情就说不知情。不能新造身份、委托、信件、行程、物品或事件。最多两个块，每块不超过80个汉字；旁白如有，必须第一人称。' },
          { role: 'user', content: JSON.stringify(facts) }
        ];
      }
      if (noThink) messages = [...messages.slice(0, -1),
        { ...messages.at(-1), content: `${messages.at(-1).content}\n/no_think` }];
      const body = {
        model: 'local', messages, temperature: compact ? 0.35 : 0.72,
        ...(noThink ? { top_p: 0.8, top_k: 20, presence_penalty: 1.5 } : {}),
        max_tokens: compact ? 256 : context.requestType === 'repair' ? 420 : 512,
        ...(structured ? { response_format: { type: 'json_object' } } : {})
      };
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const json = await response.json();
      const text = json.choices?.[0]?.message?.content || '';
      output.push({ kind: 'model', seed: state.astraWorld.seed, seconds: +(performance.now() - started).toFixed(0) / 1000,
        promptTokens: json.usage?.prompt_tokens, completionTokens: json.usage?.completion_tokens,
        responseStatus: response.status, raw: text, reasoning: json.choices?.[0]?.message?.reasoning_content || '' });
      if (!response.ok) throw new Error(json.error?.message || `HTTP ${response.status}`);
      return text;
    }
  };
  const runner = createAiTurnRunner({ aiClient, transcriptStore: {
    recentTurns: async () => turns.slice(-6), allTurns: async () => turns,
    appendTurn: async (_journeyId, turn) => turns.push(turn)
  } });
  const name = scenario.npc.name;
  const inputs = [
    { speech: `${name}，你是谁？`, action: '' },
    { speech: `刚才的消息你知道多少？`, action: '' },
    { speech: '我来帮你。', action: '' },
    { speech: '具体要我先做什么？', action: '' }
  ];
  output.push({ kind: 'opening', seed: state.astraWorld.seed, opportunity: scenario.opportunity,
    location: state.astraWorld.player.locationId, npc: name, blocks: scenario.opening.blocks });
  for (const [index, input] of inputs.slice(0, turnCount).entries()) {
    const result = await runner.runWorld({ state, input, settings: { mode: 'local', localModelName: modelLabel } });
    output.push({ kind: 'turn', seed: state.astraWorld.seed, index, input: input.speech, ok: result.ok,
      error: result.error || null, provider: result.turn?.provider || null, blocks: result.blocks || result.turn?.blocks || [],
      beforeMinute: state.astraWorld.minute, afterMinute: result.state?.astraWorld?.minute,
      npcLocation: result.state?.astraWorld?.characters?.[scenario.npc.id]?.locationId || null });
    if (!result.ok) break;
    state = result.state;
  }
}
console.log(JSON.stringify({ model: modelLabel, structured, compact, noThink, output }, null, 2));
