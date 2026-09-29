import { NPCS } from './game-data.js';

const text = (value, length) => String(value || '').trim().slice(0, length);

// A single projection feeds both visible panels and the next AI request.
// Core personality is stable; a strained relationship is not a new personality.
export function characterProfile(state, name) {
  const entity = Object.values(state.memory?.entities || {}).find(item => item.name === name);
  const authored = NPCS[name];
  const description = authored?.description?.split(/她认识|他认识|确认眼前|开场/u)[0];
  const core = text(description || entity?.traits?.filter(t => t !== '身份待查').join('、'), 100);
  const relation = state.relationshipStates?.[name];
  const event = text(relation?.lastEvent, 70);
  const observed = value => value ? `${entity.observation.turn === state.memory.turnCount ? '' : '此前：'}${value}` : '';
  return {
    name, role: authored?.role || entity?.purpose || '来意待了解',
    core: core || '性情尚待相处了解',
    relationship: relation ? `信任${relation.trust}·亲近${relation.closeness}·戒备${relation.wariness}·敌意${relation.hostility}` : '尚未建立关系',
    lastEvent: event === '柴房里，她没有丢下我。' ? '' : event,
    status: entity?.status || 'alive',
    realm: entity?.realm || '修为待观察', mood: observed(entity?.observation?.mood), condition: observed(entity?.observation?.condition),
    evidence: entity?.observation?.evidence || ''
  };
}
