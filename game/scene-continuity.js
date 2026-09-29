const text=v=>String(v||'').replace(/[\s\p{P}\p{S}]/gu,'');
const narr=turn=>(turn?.blocks||[]).filter(b=>b.type==='narr');
export function repeatedParagraph(a,b){const x=text(a),y=text(b);if(Math.min(x.length,y.length)<32)return false;if(x===y)return true;if(Math.min(x.length,y.length)/Math.max(x.length,y.length)>.8&&(x.includes(y)||y.includes(x)))return true;const grams=v=>new Set(Array.from({length:v.length-2},(_,i)=>v.slice(i,i+3)));const A=grams(x),B=grams(y),common=[...A].filter(v=>B.has(v)).length;return common/Math.max(A.size,B.size)>.9;}
// Remove replayed exposition only when the same reply also contains a genuinely
// new response. Never invent a replacement scene or spend another AI request.
export function removeReplayedExposition(candidate,recentTurns){
 const old=recentTurns.filter(t=>t.kind!=='system').slice(-6).flatMap(t=>narr(t).flatMap(b=>String(b.text).split(/\n\s*\n/)));
 let removed=0;const blocks=[];
 for(const block of candidate.blocks||[]){if(block.type!=='narr'){blocks.push(block);continue;}const kept=String(block.text).split(/\n\s*\n/).filter(p=>{const duplicate=old.some(q=>repeatedParagraph(p,q));if(duplicate)removed++;return !duplicate;});if(kept.length)blocks.push({...block,text:kept.join('\n\n')});}
 if(removed&&!blocks.some(b=>(b.type==='narr'||b.type==='dlg'&&!b.engineOwnedPlayerSpeech)&&text(b.text).length>8))throw Object.assign(new Error('AI 重演了已经发生的剧情，本回合未写入；输入已保留。'),{code:'AI_NARRATIVE_REPEAT'});
 return {...candidate,blocks};
}
const room=/((?:两人|我们|我和[^，。]{1,12}|顾长生[^，。]{0,8})[^。！？]{0,24}(?:进入|走进|踏进|进了|踏入|跨进)(?:了)?(?:那间|这间|一间|那座|这座)?([^，。！？]{0,14}(?:房间|屋子|屋内|药房|客房|密室|柴房)))/gu;
const roomKey=s=>String(s).replace(/^(?:了|那间|这间|一间|那座|这座)/u,'').replace(/房间|屋子|屋内/gu,'屋内');
const retrospective=/先前|刚才|回忆|想起|曾经|如果|假如|尚未|没有|并未|还没/u;
export function sceneEvidence(narration){const result=[];for(const block of narr(narration)){for(const sentence of String(block.text).split(/[。！？]/u)){if(retrospective.test(sentence))continue;for(const m of sentence.matchAll(room))result.push({kind:'entered',target:roomKey(m[2]),evidence:m[1].slice(0,100)});}}return result;}
export function continuityErrors(state,candidate,input=''){
 if(candidate.effects?.location&&candidate.effects.location!==state.story.location)return [];
 const visible=narr(candidate).map(b=>b.text).join('。');const previous=state.journeyWorld?.sceneEvents||[];const errors=[];
 const intentional=/返回|回到|重新进入|再进|再次进入|先出去|先离开/u.test(input)||/离开[^。]{0,20}(?:再|又|重新)/u.test(visible);
 if(!intentional)for(const event of sceneEvidence(candidate)){if(previous.some(old=>old.kind==='entered'&&old.target===event.target&&old.location===state.story.location&&!old.departed))errors.push('场景倒退：已经进入'+event.target+'，不能把进入过程再演一遍。');}
 return errors;
}
export function commitSceneEvidence(state,candidate){
 const world=state.journeyWorld;let events=(world.sceneEvents||[]).map(e=>e.location!==state.story.location?{...e,departed:true}:e);const visible=narr(candidate).map(b=>b.text).join('。');
 if(/(?:走出|离开|出了|退出)[^。]{0,16}(?:房间|屋子|屋内|药房|客房|密室|柴房)/u.test(visible))events=events.map(e=>({...e,departed:true}));
 for(const event of sceneEvidence(candidate)){events=events.filter(e=>!(e.kind===event.kind&&e.target===event.target));events.push({...event,location:state.story.location,turn:state.memory.turnCount,departed:false});}
 world.sceneEvents=events.slice(-24);return state;
}
export function continuityContext(state){return {在场:state.worldState.presentActorIds,已经发生:(state.journeyWorld.sceneEvents||[]).filter(e=>!e.departed&&e.location===state.story.location).slice(-3).map(e=>e.evidence),规则:'已经发生的行动只写后果，不重新入场或重置处境；改变房间写effects.sceneLabel，移动大地点写effects.location。'};}
