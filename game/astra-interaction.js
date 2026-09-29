// Resolve small, direct conversational intents from Engine facts before asking
// a language model to improvise. This does not create quests or world effects.
const localPeople = world => Object.values(world.characters || {})
  .filter(npc => npc.alive && npc.locationId === world.player.locationId && !npc.travel);

function interlocutor(people, speech, recentTurns) {
  const named = people.find(npc => speech.includes(npc.name));
  if (named) return named;
  const last = (recentTurns || []).flatMap(turn => turn.blocks || []).filter(block => block.type === 'dlg').at(-1);
  return people.find(npc => npc.name === last?.name) || people[0] || null;
}

export function resolveAstraInteraction(world, rawSpeech, recentTurns = []) {
  const speech = String(rawSpeech || '').trim();
  if (!speech || speech.length > 80) return null;
  const identity = /你(?:是)?谁|你叫什么|请问你是/u.test(speech);
  const greeting = /^(?:有人吗|有人在吗|有人没有)[？?！!。\s]*$/u.test(speech);
  const eventQuestion = /发生什么|怎么回事|什么情况|啥玩意/u.test(speech);
  const offer = /我来帮你|我帮你|让我帮|需要我帮|我能帮/u.test(speech);
  const healerQuestion = /(?:医者|郎中|大夫|你)找人[？?]?$/u.test(speech);
  if (!identity && !greeting && !eventQuestion && !offer && !healerQuestion) return null;
  const people = localPeople(world);
  const healer = people.find(npc => /医|郎中|大夫|healer|doctor/iu.test(`${npc.role || ''} ${npc.occupation || ''}`));
  if (healerQuestion && !healer) return {
    targetId: null,
    blocks: [{ type: 'narr', text: '我循声望去，眼前并没有那位医者。先前听到的只是附近求助的消息；若要找到人，还得向在场的人打听去向。' }]
  };
  const npc = healerQuestion ? healer : interlocutor(people, speech, recentTurns);
  if (!npc) return {
    targetId: null,
    blocks: [{ type: 'narr', text: '我出声询问，近旁没有可应答的人。若要弄清情况，还得沿着眼前的线索去找。' }]
  };
  const localQuest = Object.values(world.quests || {}).find(quest =>
    ['available', 'active', 'mutated'].includes(quest.state)
    && quest.targetLocationId === world.player.locationId
    && (!quest.giverId || quest.giverId === npc.id));
  const publicEvent = [...(world.history || [])].reverse().find(event => event.playerWitnessed
    && event.locationId === world.player.locationId
    && !['player_speech', 'opening_cue', 'scene_director'].includes(event.type)
    && event.summary);
  const text = identity ? `我是${npc.name}，在此料理手头的事。你找我有什么事？`
    : healerQuestion ? `你找的是谁？先说清楚，我才能帮你打听。`
      : offer ? (localQuest ? `多谢。眼下${localQuest.title}还没了结；先把这件事问清，再决定如何动手。`
        : '多谢。先听我把眼前的情况说清楚，我们再决定从哪里着手。')
        : eventQuestion ? (publicEvent ? `${publicEvent.summary}你若想弄清缘由，可以再问我。`
          : '我也只看见眼前这些动静；要弄清缘由，还得继续打听。')
          : '我在。你想问什么？';
  return { targetId: npc.id, blocks: [{ type: 'dlg', name: npc.name, text }] };
}
