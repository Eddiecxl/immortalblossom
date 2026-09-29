import {REALMS,QUESTS} from '../game-data.js';
// Presentation is a projection: never mutate the engine's saved narrative contract.
export function projectTurnBlocks(blocks = [], speech = '') {
  const legacy = blocks.find(b=>b?.type==='narr' && /^我说：“[\s\S]+”$/.test(b.text||''));
  const exact = String(speech || blocks.find(b => b?.exactPlayerSpeech)?.exactPlayerSpeech || legacy?.text.slice(4,-1) || '').trim();
  const result = [];
  if (exact) result.push({type:'dlg',name:'顾长生',text:exact,player:true});
  for (const block of blocks) {
    if (!block || block.engineOwnedPlayerSpeech) continue;
    let text = String(block.text || '');
    if (exact && block.type === 'narr') {
      // The model can embed the line after arbitrary gestures or expressions.
      // Speech has one engine-owned bubble; remove its exact quoted echo from prose.
      for (const [left,right] of [['“','”'],['「','」'],['"','"']]) {
        for (const quote of [left + exact + right, left + exact.replace(/\?/gu, '？') + right]) {
          text = text.split('：' + quote).join('，').split(':' + quote).join('，').split(quote).join('');
        }
      }
      text = text.replace(/([，。！？])\1+/gu, '$1');
      if (text.trim() === exact || text.trim() === `“${exact}”`) continue;
    }
    if (block.type === 'dlg' && ['顾长生','我','主角','玩家'].includes(block.name)) continue;
    if (text.trim()) result.push({...block,text:text.trim()});
  }
  return result;
}

export function detectEvents(before, after) {
  if (!before || !after) return [];
  if (!before.story?.flags?.playerDead && after.story?.flags?.playerDead) return [{kind:'death',title:'此世 · 归寂',text:'命途在此落幕。此世的足迹已留在命簿之中。'}];
  const events=[];
  if(after.campaign?.status==='complete'&&before.campaign?.status!=='complete')events.push({kind:'ending',title:'此生 · 落笔',text:after.campaign.events?.at(-1)||'此生命途已有结局，足迹已保存在命簿。'});
  else if(after.campaign?.chapterId!==before.campaign?.chapterId)events.push({kind:'newquest',title:'命途 · 新篇',text:after.campaign.events?.at(-1)||'下一段目标已更新。'});
  const previousIds=new Set((before.rpg?.ledger||[]).map(e=>e.id));
  const revived=(after.rpg?.ledger||[]).filter(e=>e.kind==='revival'&&!previousIds.has(e.id));
  for(const event of revived)events.push({kind:'revival',title:'绝境 · 逢生',text:event.text||`${event.name} 已触发，护住了你的性命。`});
  if (before.player.realm < after.player.realm) events.push({kind:'realm',title:'破境 · 登临',text:`${REALMS[before.player.realm]?.name||before.player.realm} → ${REALMS[after.player.realm]?.name||after.player.realm} · 新的天地方才展开。`});
  const completed = after.quests?.completed || [];
  const prior = new Set((before.quests?.completed || []).map(q=>typeof q==='string'?q:q.id));
  if (completed.some(q=>!prior.has(typeof q==='string'?q:q.id))) events.push({kind:'quest',title:'因果 · 已了',text:'一段命途已有回响。任务奖励与结果已记入命簿。'});
  const id=q=>typeof q==='string'?q:q.id;
  for(const [key,kind,title] of [['active','newquest','新契 · 因缘起'],['failed','failedquest','因果 · 未竟']]){
    const old=new Set((before.quests?.[key]||[]).map(id));const added=(after.quests?.[key]||[]).filter(q=>!old.has(id(q)));
    if(added.length)events.push({kind,title,text:added.map(q=>QUESTS[id(q)]?.title||q.title||id(q)).join('、')+' · 已记录于任务命簿。'});
  }
  const changes=[];for(const bag of ['items','materials'])for(const [name,amount] of Object.entries(after.inventory?.[bag]||{})){const delta=Number(amount)-Number(before.inventory?.[bag]?.[name]||0);if(delta>0)changes.push(`${name} × ${delta}`);}
  if(changes.length)events.push({kind:'item',title:'因缘 · 所得',text:changes.join('、')+' · 已收入行囊。'});
  if (!revived.length && after.player.hp < before.player.hp) events.push({kind:'danger',title:'风起 · 变生',text:`气血减少 ${before.player.hp-after.player.hp}。留意眼前的局势。`});
  if (before.story.location !== after.story.location) events.push({kind:'travel',title:after.story.location,text:'山河移卷 · 新的足迹落于此间'});
  return events;
}
