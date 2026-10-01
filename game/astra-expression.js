// Restricted data expressions, never model-supplied JavaScript or SQL.
const banned = new Set(['__proto__', 'prototype', 'constructor']);
export function assertSafeData(value, depth = 0) {
  if (depth > 12) throw new Error('规则嵌套过深。');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('规则含无效数值。');
  if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
      if (banned.has(key)) throw new Error('规则字段无效。');
      assertSafeData(child, depth + 1);
    }
}
export function worldEntity(world, id) {
  if (id === 'player') return world.player;
  for (const field of ['characters', 'factions', 'locations', 'items', 'quests'])
    if (Object.hasOwn(world[field] || {}, id)) return world[field][id];
  if (Object.hasOwn(world.simulation?.commitments || {}, id)) return world.simulation.commitments[id];
  return null;
}
const OPS = new Set(['all', 'any', 'not', 'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'exists']);
export function validateCondition(condition, depth = 0) {
  assertSafeData(condition);
  if (!condition || depth > 8 || !OPS.has(condition.op)) throw new Error('条件不属于可计算的规则表达式。');
  if (['all', 'any'].includes(condition.op)) {
    if (!Array.isArray(condition.conditions) || !condition.conditions.length || condition.conditions.length > 12) throw new Error('条件组合无效。');
    for (const child of condition.conditions) validateCondition(child, depth + 1);
  } else if (condition.op === 'not') validateCondition(condition.condition, depth + 1);
  else {
    for (const value of [condition.left, condition.right]) if (value && typeof value === 'object') {
      if (typeof value.entityId !== 'string' || typeof value.field !== 'string'
        || !/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){0,3}$/u.test(value.field)
        || value.field.split('.').some(part => banned.has(part))) throw new Error('条件引用无效。');
    }
  }
}
export function validateConditionReferences(world, condition, allowedBindings = []) {
  validateCondition(condition);
  const readPath = (entity, field) => {
    let value = entity;
    for (const part of field.split('.')) {
      if (!value || !Object.hasOwn(value, part)) return false;
      value = value[part];
    }
    return true;
  };
  const visit = node => {
    for (const spec of [node.left, node.right]) if (spec && typeof spec === 'object') {
      if (spec.entityId.startsWith('$')) {
        if (!allowedBindings.includes(spec.entityId.slice(1))
          || ![world.player, ...Object.values(world.characters), ...Object.values(world.factions)].some(entity => readPath(entity, spec.field)))
          throw new Error('条件的运行时绑定或字段未注册。');
      } else {
        const entity = worldEntity(world, spec.entityId);
        if (!entity || !readPath(entity, spec.field)) throw new Error('条件引用了不存在的实体或字段。');
      }
    }
    if (node.conditions) node.conditions.forEach(visit);
    if (node.condition) visit(node.condition);
  };
  visit(condition);
}
export function evaluateCondition(world, condition, bindings = {}) {
  validateCondition(condition);
  const read = spec => {
    if (!spec || typeof spec !== 'object') return spec;
    const id = spec.entityId.startsWith('$') ? bindings[spec.entityId.slice(1)] : spec.entityId;
    let value = worldEntity(world, id);
    for (const part of spec.field.split('.')) {
      if (!value || !Object.hasOwn(value, part)) return undefined;
      value = value[part];
    }
    return value;
  };
  if (condition.op === 'all') return condition.conditions.every(entry => evaluateCondition(world, entry, bindings));
  if (condition.op === 'any') return condition.conditions.some(entry => evaluateCondition(world, entry, bindings));
  if (condition.op === 'not') return !evaluateCondition(world, condition.condition, bindings);
  const left = read(condition.left), right = read(condition.right);
  if (condition.op === 'exists') return left !== undefined && left !== null;
  if (left === undefined || right === undefined) return false;
  if (condition.op === 'eq') return left === right;
  if (condition.op === 'ne') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  return condition.op === 'lt' ? left < right : condition.op === 'lte' ? left <= right
    : condition.op === 'gt' ? left > right : left >= right;
}

// Mutable values may change later. Only sealed state records can prove a
// prerequisite impossible; a currently false wealth/health test cannot.
export function conditionCanStillBecomeTrue(world, condition) {
  validateCondition(condition);
  const sealedStates=new Set(['completed','failed','expired','abandoned','resolved-by-other','invalidated','declined','withdrawn','fulfilled']);
  const fixed=spec=>!spec||typeof spec!=='object'||spec.field==='state'
    && (Object.hasOwn(world.quests||{},spec.entityId)||Object.hasOwn(world.simulation?.commitments||{},spec.entityId))
    && sealedStates.has(worldEntity(world,spec.entityId)?.state);
  const possibilities=node=>{
    if(node.op==='all'||node.op==='any'){
      const children=node.conditions.map(possibilities);
      return node.op==='all'?{yes:children.every(c=>c.yes),no:children.some(c=>c.no)}
        :{yes:children.some(c=>c.yes),no:children.every(c=>c.no)};
    }
    if(node.op==='not'){const inner=possibilities(node.condition);return {yes:inner.no,no:inner.yes};}
    if(!fixed(node.left)||node.op!=='exists'&&!fixed(node.right))return {yes:true,no:true};
    const result=evaluateCondition(world,node);return {yes:result,no:!result};
  };
  return possibilities(condition).yes;
}
