// A conservative guard for model prose. Rejected blocks never become Engine mutations.
const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const idOf = value => typeof value === 'string' ? value : value?.id ?? '';
const placeOf = value => value?.locationId ?? value?.location ?? value?.at ?? '';
const stateOf = value => String(value?.status ?? value?.lifeState ?? value?.state ?? '').toLowerCase();
const dead = value => value?.alive === false || ['dead', 'deceased', 'erased'].includes(stateOf(value));
const destroyed = value => value?.destroyed === true || ['destroyed', 'erased'].includes(stateOf(value));
const provenance = value => Boolean(value?.provenance || value?.origin || value?.source || list(value?.creationHistory).length);
const normalized = value => String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const names = value => [value?.name, value?.title, value?.id].filter(Boolean).map(String);
const mentions = (text, value) => names(value).some(name => name.length > 1 && text.includes(name));
const hasClaim = (block, type) => list(block?.claims).filter(claim => claim?.type === type);

function speakerOf(block, characters) {
  const key = block?.actorId ?? block?.speakerId ?? block?.name ?? block?.speaker;
  return characters.find(actor => key && (idOf(actor) === key || actor.name === key));
}

function terminalExtinction(terminal) {
  if (!terminal) return false;
  const kind = String(terminal?.ending ?? terminal?.type ?? terminal?.kind ?? terminal?.state ?? terminal).toLowerCase();
  return terminal?.active !== false && terminal?.ended !== false
    && /all.life|extinct|erased.world|world.destroy|灭世|万物消亡|众生俱灭/u.test(kind);
}

/**
 * Validate proposed blocks against Engine state. Returns {ok, errors, blocks}.
 * Each error is {index, code, message}; blocks contains only original accepted
 * blocks. Callers should repair/retry when ok is false, not commit partial prose.
 */
export function validateAstraNarration(world, blocks, packet = {}) {
  const source = world?.astraWorld ?? world ?? {};
  const candidates = Array.isArray(blocks) ? blocks : [];
  const characters = list(source.characters ?? source.npcs);
  const locations = list(source.locations);
  const quests = list(source.quests);
  const items = list(source.items);
  const secrets = list(source.secrets);
  const currentPlace = placeOf(source.player) || packet?.location?.id || source.currentLocationId;
  const currentLocation = locations.find(loc => idOf(loc) === currentPlace || loc?.name === currentPlace);
  const currentId = idOf(currentLocation) || currentPlace;
  const minute = Number(source.minute ?? packet?.minute ?? 0);
  const dueEvents = list(source.eventQueue).filter(event => Number(event?.dueAt ?? event?.minute) <= minute);
  const recentText = list(packet?.recentTurns).flatMap(turn => list(turn?.blocks).map(block => normalized(block?.text))).filter(x => x.length >= 12);
  const errors = [];
  const accepted = [];

  for (const [index, block] of candidates.entries()) {
    const start = errors.length;
    if (!block || typeof block !== 'object' || typeof block.text !== 'string') {
      errors.push({ index, code: 'invalid-block', message: 'Narration block is malformed.' });
      continue;
    }
    const prose = block.text;
    const speaker = block.type === 'dlg' ? speakerOf(block, characters) : null;
    const reject = (code, message) => errors.push({ index, code, message });
    if (block.type === 'narr' && /(?:我说|我问|我开口问道)[，,]\s*(?:$|[。！？])/u.test(prose))
      reject('unfinished-player-line', 'Narration leaves an empty player speech line.');
    if (block.type === 'narr' && list(packet?.presentNpcs).length
      && /(?:身边空无一人|近旁空无一人|此刻我身边空无一人|眼前确实空荡荡的)/u.test(prose))
      reject('present-npc-denied', 'Narration denies people who are present in Engine state.');

    if (block.type === 'dlg') {
      if (terminalExtinction(source.terminal))
        reject('terminal-ordinary-life', 'Ordinary character dialogue contradicts terminal extinction.');
      if (!speaker) reject('unknown-speaker', 'Speaker is not an Engine character.');
      else if (dead(speaker))
        reject('dead-speaker', 'Dead character cannot speak normally.');
      else if ((placeOf(speaker) !== currentId && placeOf(speaker) !== currentLocation?.name || speaker.travel)
        && !(packet?.conversation?.targetId === speaker.id && packet.conversation.presentAtStart
          && speaker.travel?.from === currentId))
        reject('absent-speaker', 'Speaker is not present at the player location.');
      if (speaker) {
        const knownFacts = [...list(speaker.knownFactIds), ...list(speaker.knowledge)].map(idOf);
        for (const factId of list(block.factIds).map(idOf)) {
          if (!knownFacts.includes(factId)) reject('unknown-fact', 'Speaker cites a fact absent from their Engine knowledge.');
        }
      }
    }
    for (const actor of characters) {
      if (dead(actor) && mentions(prose, actor)
        && /(?:说|说道|问道|答道|开口|交谈|喊道|speaks?|says?)/iu.test(prose)) {
        reject('dead-speaker', 'Prose gives ordinary speech to a dead character.');
        break;
      }
      if (dead(actor) && mentions(prose, actor)
        && /又活|仍活|还活|活着|复活|重生|死而复生|alive again|resurrect/iu.test(prose)
        && !/假如|如果|传闻|梦里|梦中|尚未/u.test(prose)) {
        reject('unrecorded-resurrection', 'A dead character cannot return through prose without an Engine resurrection.');
        break;
      }
    }
    const claimedPlace = block.locationId ?? block.location;
    if (claimedPlace && claimedPlace !== currentId && claimedPlace !== currentLocation?.name)
      reject('impossible-location', 'Narration moved to a location without an Engine transition.');
    if (Number.isFinite(Number(block.minute)) && Number(block.minute) < minute)
      reject('time-reversal', 'Narration time precedes Engine time.');
    for (const loc of locations) {
      if (destroyed(loc) && mentions(prose, loc)
        && /完好|无损|依旧|如初| intact|standing|untouched|繁华/u.test(prose)) {
        reject('destroyed-location', 'Destroyed location is described as intact.');
        break;
      }
    }
    for (const claim of hasClaim(block, 'item')) {
      const item = items.find(x => idOf(x) === claim.id || x?.name === claim.id);
      if (!item || !provenance(item)
        || (item.ownerId && !['player', source.player?.id].includes(item.ownerId)))
        reject('unsupported-item', 'Item claim lacks an Engine instance and provenance.');
    }
    for (const claim of hasClaim(block, 'skill')) {
      const skills = list(source.player?.skills).map(x => idOf(x) || String(x));
      if (!skills.includes(claim.id)) reject('unsupported-skill', 'Skill claim is absent from Engine player state.');
    }
    if (/凭空|突然变出/u.test(prose) && /物|剑|丹|玉|宝|灵石/u.test(prose))
      reject('unsupported-item', 'Prose creates an item without an Engine event.');
    const acquired = prose.match(/(?:我|玩家|主角)?(?:得到|获得|拾得|捡到|领到|拿到)(?:了|一件|一把|一枚|一颗|一块)?([^，。！？；\s]{2,20})/u)?.[1];
    if (acquired && /剑|丹|玉|石|宝|符|药|珠|甲|刀|戒|玺/u.test(acquired)) {
      const item = items.find(x => (x?.name && acquired.includes(x.name)) || idOf(x) === acquired);
      if (!item || !provenance(item))
        reject('unsupported-item', 'Prose awards an item without an Engine instance and provenance.');
    }
    const learned = prose.match(/(?:我|玩家|主角)?(?:学会|掌握|领悟)(?:了)?([^，。！？；\s]{2,20})/u)?.[1];
    if (learned && /术|功|诀|法|剑意|技能/u.test(learned)) {
      const skills = list(source.player?.skills);
      if (!skills.some(skill => (typeof skill === 'string' && learned.includes(skill)) || (skill?.name && learned.includes(skill.name)) || idOf(skill) === learned))
        reject('unsupported-skill', 'Prose awards a skill absent from Engine player state.');
    }
    for (const secret of secrets) {
      const secretText = String(secret?.text ?? secret?.summary ?? '');
      if (secretText.length < 4 || !prose.includes(secretText)) continue;
      const allowed = list(secret.knownBy ?? secret.knownByIds ?? secret.knownByActorIds).map(idOf);
      if (!speaker || !allowed.includes(idOf(speaker)) && !allowed.includes(speaker.name))
        reject('forbidden-secret', 'Speaker does not know this secret.');
    }
    for (const quest of quests) {
      if (['completed', 'failed', 'expired', 'resolved', 'abandoned'].includes(stateOf(quest))
        && mentions(prose, quest) && /重新开始|重启|再次接取|从头|restart|begins? again/iu.test(prose)) {
        reject('finished-quest', 'A finished quest cannot restart through narration.');
        break;
      }
    }
    if (terminalExtinction(source.terminal) && /人声鼎沸|商贩|百姓|村民|照常|日常生活|热闹|crowd|marketplace|ordinary life/iu.test(prose))
      reject('terminal-ordinary-life', 'Ordinary life contradicts terminal extinction.');
    if (dueEvents.length && /仍在赶来|还在路上|尚未抵达|还有[一二三四五六七八九十\d]+分钟|still approaching|minutes away/iu.test(prose)) {
      const arrival = dueEvents.find(event => /arriv|抵达|到达/iu.test(String(event.type ?? '')));
      const actor = characters.find(x => idOf(x) === (arrival?.payload?.actorId ?? arrival?.actorId));
      if (arrival && (!actor || mentions(prose, actor))) reject('stale-eta', 'Due arrival is still described as pending.');
    }
    const line = normalized(prose);
    if (line.length >= 12 && recentText.some(previous => previous === line || previous.includes(line) || line.includes(previous) && previous.length >= 12))
      reject('repetition', 'Narration repeats a substantial recent passage.');
    if (errors.length === start) accepted.push(block);
  }
  return { ok: errors.length === 0, errors, blocks: accepted };
}
