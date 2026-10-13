import {REALMS,QUESTS} from '../game-data.js';
import {realmRank,realmLabel} from '../astra-rules.js';
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
  const dead=after.astraWorld?after.astraWorld.player.alive===false:after.story?.flags?.playerDead;
  const wasDead=before.astraWorld?before.astraWorld.player.alive===false:before.story?.flags?.playerDead;
  if(!wasDead&&dead)return [{kind:'death',title:'此世 · 归寂',text:'命途在此落幕。此世的足迹已留在命簿之中。'}];
  if(after.astraWorld?.terminal?.ended&&!before.astraWorld?.terminal?.ended)return [{kind:'ending',title:'此生 · 落笔',text:'这一段命途已有结局，你走过的路仍留在命簿里。'}];
  const events=[];
  if(after.campaign?.status==='complete'&&before.campaign?.status!=='complete')events.push({kind:'ending',title:'此生 · 落笔',text:after.campaign.events?.at(-1)||'此生命途已有结局，足迹已保存在命簿。'});
  if(after.astraWorld?realmRank(after.astraWorld,after.astraWorld.player.cultivation.realm)>realmRank(before.astraWorld,before.astraWorld.player.cultivation.realm):before.player.realm<after.player.realm)
    events.push({kind:'realm',title:'破境 · 登临',text:after.astraWorld?`你已踏入${realmLabel(after.astraWorld,after.astraWorld.player.cultivation.realm)}。新的天地在眼前展开。`:`${REALMS[before.player.realm]?.name||before.player.realm} → ${REALMS[after.player.realm]?.name||after.player.realm} · 新的天地方才展开。`});
  if(after.astraWorld){
    for(const [status,kind,title] of [['completed','quest','因果 · 已了'],['failed','failedquest','因果 · 未竟'],['expired','failedquest','因果 · 未竟'],['invalidated','failedquest','因果 · 未竟']]){
      const changed=Object.values(after.astraWorld.quests||{}).filter(q=>q.state===status&&before.astraWorld?.quests?.[q.id]?.state!==status);
      if(changed.length)events.push({kind,title,text:changed.map(q=>q.title||'旧约').join('、')+(kind==='quest'?'已经完成。':'已无法继续。')});
    }
    return events;
  }
  const completed = after.quests?.completed || [];
  const prior = new Set((before.quests?.completed || []).map(q=>typeof q==='string'?q:q.id));
  if (completed.some(q=>!prior.has(typeof q==='string'?q:q.id))) events.push({kind:'quest',title:'因果 · 已了',text:'一段命途已有回响。任务奖励与结果已记入命簿。'});
  const id=q=>typeof q==='string'?q:q.id;
  for(const [key,kind,title] of [['failed','failedquest','因果 · 未竟']]){
    const old=new Set((before.quests?.[key]||[]).map(id));const added=(after.quests?.[key]||[]).filter(q=>!old.has(id(q)));
    if(added.length)events.push({kind,title,text:added.map(q=>QUESTS[id(q)]?.title||q.title||id(q)).join('、')+' · 已记录于任务命簿。'});
  }
  return events;
}
