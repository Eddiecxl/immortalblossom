// Small, explicit effect vocabulary. Unknown effects fail the whole transaction.
import { advanceRealm, realmLabel } from './astra-rules.js';
import { applyNumericMutation } from './astra-variables.js';

export function parseGeneratedItem(request) {
  const match = String(request).match(/(?:创造|变出|制造|炼成)\s*(?:一[颗枚件把])?([^：:，。；\s]{2,30})\s*[:：]\s*(.{4,120})/u);
  if (!match) throw new Error('请写明要创造的物品名称及其可结算的使用规则。');
  const name = match[1].trim();
  const description = match[2].trim();
  const effects = [];
  if (/(?:提升|突破|晋升)(?:一个|一|1)?大境界|(?:提升|突破|晋升).*大境界/u.test(description))
    effects.push({ type: 'cultivation.advance_major_realm', target: 'player', magnitude: 1,
      consumesOnUse: true, source: 'generated-item' });
  else if (/(?:恢复|治愈|治好).*(?:气血|伤势|身体)/u.test(description))
    effects.push({ type: 'heal', target: 'player', magnitude: 'full', consumesOnUse: true, source: 'generated-item' });
  if (!effects.length) throw new Error('这件新物品的效果无法解析为 Engine 规则，未创建任何物品。');
  return { name, description, category: /丹|药/u.test(name) ? 'pill' : 'artifact', effects };
}

export function resolveStructuredEffect(world, effect) {
  if (!effect || effect.target !== 'player') throw new Error('效果目标不受 Engine 支持。');
  const player = world.player;
  switch (effect.type) {
    case 'cultivation.advance_major_realm': {
      const result = advanceRealm(world, player, effect.magnitude);
      if (!result.applied) return { applied: false, summary: '当前境界已达上限，此丹未能提升境界。', reason: result.reason };
      applyNumericMutation(world, { kind: 'player', id: player.id, field: 'maxHealth', operation: 'delta', value: 20 * result.steps });
      applyNumericMutation(world, { kind: 'player', id: player.id, field: 'health', operation: 'delta', value: 20 * result.steps });
      return { applied: true, summary: `修行境界提升至${realmLabel(world, result.to)}，气血上限随之提高。` };
    }
    case 'heal': {
      const amount = effect.magnitude === 'full' ? Number(player.maxHealth || 100) : Number(effect.magnitude);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('治愈效果数值无效。');
      const outcome = applyNumericMutation(world, { kind: 'player', id: player.id,
        field: 'health', operation: 'delta', value: amount });
      return { applied: outcome.applied, summary: outcome.applied
        ? `气血恢复至${player.health}/${player.maxHealth}。` : '气血已满，治愈效果未改变状态。' };
    }
    case 'stat.delta': {
      if (!['health', 'wealth', 'safety'].includes(effect.field)) throw new Error('属性变更字段不受支持。');
      return applyNumericMutation(world, { kind: 'player', id: player.id,
        field: effect.field, operation: 'delta', value: effect.magnitude });
    }
    default: throw new Error(`未知 Engine 效果：${String(effect.type || '')}`);
  }
}

export function applyStructuredEffect(world, effect) {
  return resolveStructuredEffect(world, effect).summary;
}

export function consumeGeneratedItem(source, itemId) {
  const world = structuredClone(source);
  if (world.terminal?.ended || !world.player?.alive) throw new Error('此世已终结，不能使用物品。');
  const item = world.items?.[itemId];
  if (!item?.generated || item.destroyed || item.ownerId !== world.player.id
    || !world.player.inventory.includes(itemId)) throw new Error('未持有这件可使用的生成物品。');
  if (!Array.isArray(item.effects) || !item.effects.length) throw new Error('物品缺少可结算的 Engine 效果。');
  const outcomes = item.effects.map(effect => resolveStructuredEffect(world, effect));
  item.quantity = Math.max(0, Number(item.quantity || 1) - 1);
  if (item.quantity === 0) {
    item.destroyed = true;
    world.player.inventory = world.player.inventory.filter(id => id !== itemId);
  }
  item.transferHistory ||= [];
  item.transferHistory.push({ minute: world.minute, from: world.player.id, to: null, source: 'consumed' });
  const summary = `服用${item.name}；${outcomes.map(outcome => outcome.summary).join('；')}`;
  const event = { id: `consume:${world.minute}:${itemId}`, minute: world.minute, type: 'item_consumed',
    itemId, locationId: world.player.locationId, actors: [world.player.id], summary,
    applied: outcomes.some(outcome => outcome.applied), outcomes, playerWitnessed: true, major: true };
  world.history.push(event);
  return { world, event, summary };
}
