// Bound the author's view, never the durable world or its full validator packet.
export function compactNarrativePacket(source,{maxChars=7000}={}) {
  const packet=structuredClone(source);
  // Opaque lookup indexes are for the full validator, not prose generation.
  // The actual known evidence remains in memories/allowedSecrets/knownFacts.
  for(const npc of [...(packet.presentNpcs||[]),...(packet.departingNpcs||[])])delete npc.knowledge;
  // A witnessed appraisal is projected both as an NPC memory and as a
  // simulation belief. Carry one text with its evidence, within the same
  // holder's knowledge boundary; the full validator retains both records.
  const people=[...(packet.presentNpcs||[]),...(packet.departingNpcs||[])];
  if(Array.isArray(packet.simulationFacts?.beliefs))packet.simulationFacts.beliefs=
    packet.simulationFacts.beliefs.filter(belief=>{
      const npc=people.find(row=>row.id===belief.holderId);
      const memory=npc?.memories?.find(row=>row&&typeof row==='object'&&belief.eventId&&belief.summary
        &&(row.eventId===belief.eventId||String(row.eventId||'').startsWith(belief.eventId+':'))
        &&String(row.summary||'').includes(belief.summary));
      if(!memory)return true;
      const {holderId,eventId,summary,...evidence}=belief;
      (memory.beliefEvidence??=[]).push({...evidence,...(eventId!==memory.eventId?{eventId}:{})});return false;
    });
  const input=[packet.input,packet.playerTurn?.text,packet.playerTurn?.speech,packet.playerTurn?.action].filter(Boolean).join('\n');
  const recalling=/(?:我|你).*(?:说过|说了|说的|讲过|提过|答复)|记得|复述|此前|承诺|约定/u.test(input);
  const recent=(packet.recentTurns||[]).slice(-4);
  packet.recentTurns=recent.map((turn,index)=>({id:turn.id,userText:turn.userText,summary:turn.summary,
    narrativeOpening:String(turn.narrativeOpening||(turn.blocks||[]).find(b=>b.type==='narr'&&!b.engineOwnedPlayerSpeech)?.text||'').slice(0,80),
    ...(recalling||index===recent.length-1?{dialogue:(turn.dialogue||(turn.blocks||[]).filter(b=>b.type==='dlg')).slice(-2)
      .map(b=>({name:b.name,text:String(b.text||'').slice(0,recalling?140:240)}))}:{})}));
  const referenced=row=>[row?.id,row?.name,row?.name?.split('·')[0],row?.title]
    .some(label=>typeof label==='string'&&label.length>0&&input.includes(label));
  const pinned=new Set([packet.conversation?.targetId,packet.player?.id,packet.location?.id].filter(Boolean));
  const collections=['presentNpcs','departingNpcs','items','activeQuests','numericFacts','nearbyLocations'];
  for(const key of collections)for(const row of packet[key]||[])if(referenced(row))pinned.add(row.id);
  const pinReferences=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){
      if(['entityId','itemId','fromId','toId','giverId','targetLocationId','ownerId'].includes(key)&&typeof child==='string')pinned.add(child);
      else if(child&&typeof child==='object')pinReferences(child);
    }
  };
  // These records are retained verbatim. Keep their entity/condition bindings too.
  for(const row of packet.simulationFacts?.commitments||[])pinReferences(row);
  for(const quest of packet.activeQuests||[])if(referenced(quest)||quest.giverId===packet.conversation?.targetId){pinned.add(quest.id);pinReferences(quest);}
  const essential=row=>pinned.has(row?.id)||referenced(row);
  let previousSize;
  do {
    previousSize=pinned.size;
    for(const key of collections)for(const row of packet[key]||[])if(essential(row))pinReferences(row);
  } while(pinned.size!==previousSize);
  const removeOne=(key,predicate)=>{
    const rows=packet[key];if(!Array.isArray(rows))return false;
    const index=rows.findIndex(predicate);if(index<0)return false;
    rows.splice(index,1);return true;
  };
  while(JSON.stringify(packet).length>maxChars){
    // Discard unrelated cast before the very memories retrieved for this input.
    if(removeOne('presentNpcs',row=>!essential(row)))continue;
    if(removeOne('items',row=>!essential(row)))continue;
    if(removeOne('activeQuests',row=>!essential(row)))continue;
    if(removeOne('nearbyLocations',row=>!essential(row)))continue;
    if(removeOne('nearbyEdges',row=>!pinned.has(row.to)&&!referenced(row)))continue;
    if(removeOne('numericFacts',row=>!essential(row)))continue;
    const optional=['history','recentHistory','dueEvents','rumors',...(!recalling?['recalledSummaries','memories']:[])];
    if(optional.some(key=>removeOne(key,row=>!essential(row))))continue;
    if(!recalling&&packet.recentTurns.length>1){packet.recentTurns.shift();continue;}
    const memories=!recalling&&(packet.presentNpcs||[]).find(npc=>npc.memories?.length>2)?.memories;
    if(memories){memories.shift();continue;}
    // Never silently erase the target, a consent/ownership dependency or recalled
    // evidence to manufacture a request that fits. The caller preserves input.
    throw Object.assign(Error('本轮关键事实超过叙事预算；输入和世界保留，请缩小本轮涉及范围。'),{code:'AI_INPUT_BUDGET'});
  }
  return packet;
}
