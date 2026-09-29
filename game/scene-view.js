import { QUESTS, TECHNIQUES } from './game-data.js';
export function buildLiveScene(state) {
  const world = state.journeyWorld;
  const trim = (v, n = 120) => String(v || '').slice(0, n);
  const visible = state.memory.turnCount > 0;
  return {
    visible, action: world.lastAction, goal: visible ? world.beats?.at(-1)?.result || state.director.sceneGoal : '',
    tasks: !visible ? [] : [
      ...state.quests.active.map(q => ({ title: QUESTS[q.id]?.title || q.id, detail: `${q.progress}/${q.target} · 进行中` })),
      ...world.threads.slice(-5).map(t => ({ title: `${t.kind} · ${t.title}`, detail: `${t.status === 'resolved' ? '已完成' : '未了'} · ${trim(t.evidence, 70)}` }))
    ].slice(-6),
    clues: visible ? [...new Set(state.memory.facts.filter(f => !f.id?.startsWith('fact:authored:')).map(f => f.object))].slice(-3).map(v => trim(v, 90)) : [],
    skills: visible ? state.techniques.known.slice(-5).map(name => ({ title: name,
      detail: `灵力 ${world.skills[name]?.cost ?? TECHNIQUES[name]?.cost ?? 0} · 熟练 ${state.techniques.mastery[name] || 0}${world.skills[name]?.evolution ? ' · ' + trim(world.skills[name].evolution, 35) : ''}` })) : [],
    laws: world.laws.slice(-2), debt: world.lawDebt || 0
  };
}
