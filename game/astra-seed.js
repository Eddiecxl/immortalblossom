// Stable, small seeded streams. Stream labels prevent adding one random draw to
// geography from silently changing a character's family or the opening event.
export function seedHash(seed, stream = '') {
  const input = `${typeof seed}:${String(seed)}|${stream}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRng(seed, stream = '') {
  let state = seedHash(seed, stream);
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    pick(values) { return values[Math.floor(next() * values.length)]; },
    chance(probability) { return next() < probability; }
  };
}
