// Small, explicit effect vocabulary. Unknown effects fail the whole transaction.
const MAJOR_REALMS = ['none', 'qi_refining', 'foundation', 'golden_core', 'nascent_soul',
  'spirit_transformation', 'void_refining', 'integration', 'tribulation'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

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

export function applyStructuredEffect(world, effect) {
  if (!effect || effect.target !== 'player') throw new Error('效果目标不受 Engine 支持。');
  const player = world.player;
  switch (effect.type) {
    case 'cultivation.advance_major_realm': {
      const step = Math.max(1, Math.min(3, Math.floor(Number(effect.magnitude) || 0)));
      const current = MAJOR_REALMS.indexOf(player.cultivation?.realm);
      if (current < 0 || current + step >= MAJOR_REALMS.length) throw new Error('当前境界无法按此规则继续突破。');
      player.cultivation = { ...player.cultivation, realm: MAJOR_REALMS[current + step], level: 1 };
      player.maxHealth = Number(player.maxHealth || 100) + 20 * step;
      player.health = clamp(Number(player.health || 0) + 20 * step, 0, player.maxHealth);
      return `修行境界提升至${player.cultivation.realm}，气血上限随之提高。`;
    }
    case 'heal': {
      const amount = effect.magnitude === 'full' ? Number(player.maxHealth || 100) : Number(effect.magnitude);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('治愈效果数值无效。');
      player.health = clamp(Number(player.health || 0) + amount, 0, Number(player.maxHealth || 100));
      return `气血恢复至${player.health}/${player.maxHealth}。`;
    }
    case 'stat.delta': {
      if (!['health', 'wealth', 'safety'].includes(effect.field)) throw new Error('属性变更字段不受支持。');
      const delta = Number(effect.magnitude);
      if (!Number.isFinite(delta)) throw new Error('属性变更数值无效。');
      player[effect.field] = effect.field === 'health'
        ? clamp(Number(player.health || 0) + delta, 0, Number(player.maxHealth || 100))
        : Math.max(0, Number(player[effect.field] || 0) + delta);
      return `${effect.field}变更${delta >= 0 ? '+' : ''}${delta}。`;
    }
    default: throw new Error(`未知 Engine 效果：${String(effect.type || '')}`);
  }
}

export function consumeGeneratedItem(source, itemId) {
  const world = structuredClone(source);
  if (world.terminal?.ended || !world.player?.alive) throw new Error('此世已终结，不能使用物品。');
  const item = world.items?.[itemId];
  if (!item?.generated || item.destroyed || item.ownerId !== world.player.id
    || !world.player.inventory.includes(itemId)) throw new Error('未持有这件可使用的生成物品。');
  if (!Array.isArray(item.effects) || !item.effects.length) throw new Error('物品缺少可结算的 Engine 效果。');
  const effects = item.effects.map(effect => applyStructuredEffect(world, effect));
  item.quantity = Math.max(0, Number(item.quantity || 1) - 1);
  if (item.quantity === 0) {
    item.destroyed = true;
    world.player.inventory = world.player.inventory.filter(id => id !== itemId);
  }
  item.transferHistory ||= [];
  item.transferHistory.push({ minute: world.minute, from: world.player.id, to: null, source: 'consumed' });
  const summary = `服用${item.name}；${effects.join('；')}`;
  const event = { id: `consume:${world.minute}:${itemId}`, minute: world.minute, type: 'item_consumed',
    itemId, locationId: world.player.locationId, actors: [world.player.id], summary,
    playerWitnessed: true, major: true };
  world.history.push(event);
  return { world, event, summary };
}
