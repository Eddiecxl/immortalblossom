import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {createAstraOpening} from '../../game/astra-opening.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';
test('a major known law gets one grounded aftermath scene, without an extra private-goal or cost notice',async()=>{
 const start=createAstraOpening(createGameState('顾长生','ai',()=> 'impact-turn'));let calls=0;const saved=[];
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[start.turn],appendTurn:async(_,t)=>saved.push(t)},
 aiClient:{narrate:async(_,request)=>{calls++;assert.match(JSON.stringify(request.messages),/realm-change/u);return JSON.stringify({worldPlan:{operations:[]},blocks:[
  {type:'narr',text:'气息猛然撑开了原来的束缚，又在体内缓缓收拢。'},
  {type:'dlg',name:'林小满',text:'刚才那一下……是你弄出来的？'}]});}}});
 const result=await runner.runWorld({state:start.state,input:{action:'言出法随：让我达到最高境界'},settings:{mode:'groq'}});
 assert.equal(result.ok,true,result.error);assert.equal(calls,1);assert.equal(saved.length,1);
 assert.notEqual(result.state.astraWorld.player.cultivation.realm,'none');
 const visible=saved[0].blocks.map(b=>b.text).join('\n');
 assert.doesNotMatch(visible,/关于.*这件事|成了。这次改写|你已踏入|你受了伤|世界状态已由/u);
 assert.equal(saved[0].blocks.at(-1).type,'dlg');assert.match(result.state.astraWorld.flags.playerScene.lastBeat,/刚才那一下/u);
 assert.equal(start.state.astraWorld.player.cultivation.realm,'none');
});
test('a quota wait during the settled scene preserves the uncommitted law and current encounter',async()=>{
 const start=createAstraOpening(createGameState('顾长生','ai',()=> 'impact-quota'));let writes=0;
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[start.turn],appendTurn:async()=>writes++},
 aiClient:{narrate:async()=>{throw Object.assign(new Error('wait'),{code:'AI_RATE_LIMIT',status:429,retryAfterMs:1000});}}});
 const result=await runner.runWorld({state:start.state,input:{action:'言出法随：让我达到最高境界'},settings:{mode:'groq'}});
 assert.equal(result.ok,false);assert.equal(result.code,'AI_RATE_LIMIT');assert.equal(writes,0);
 assert.equal(JSON.stringify(result.state.astraWorld),JSON.stringify(start.state.astraWorld));
});

test('semantic arrival validates its persistent resident and gives repair the candidate cast without replaying the plan',async()=>{
 const start=createAstraOpening(createGameState('顾长生','ai',()=> 'review-arrival'));
 const w=start.state.astraWorld,to=Object.values(w.locations).find(l=>l.id!==w.player.locationId&&l.population>0&&!l.destroyed);
 for(const npc of Object.values(w.characters))if(npc.locationId===to.id){npc.locationId=w.player.locationId;npc.travel=null;}
 const before=JSON.stringify(start.state),residentId='npc:resident:'+to.id.replace(/^loc:/u,'');
 const operations=[{type:'entity.update',targetId:'player',changes:{locationId:to.id,wealth:100}}];
 for(const mode of ['groq','local']){
  let calls=0,saves=0;
  const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[start.turn],appendTurn:async()=>saves++},
   aiClient:{narrate:async(_,request)=>{
    calls++;
    if(calls===1)return JSON.stringify({worldPlan:{operations},blocks:[{type:'narr',text:`眼前景物一换，我已站在${to.name}。周围空无一人。`}]});
    assert.match(JSON.stringify(request.messages),/候选抵达事实/u);
    assert.ok(JSON.stringify(request.messages).includes(residentId),'repair must know the resident stable ID');
    return JSON.stringify({worldPlan:{operations},blocks:[{type:'narr',text:`眼前景物一换，我已站在${to.name}。近旁的人忽然停下脚步，向我看过来。`}]});
   }}});
  const result=await runner.runWorld({state:start.state,input:{action:`言出法随：把我传送到${to.name}，并把我的财富改为100`},settings:{mode},transactionId:'semantic-arrival'});
  assert.equal(result.ok,true,result.error);assert.equal(calls,2);assert.equal(saves,1);
  const final=result.state.astraWorld;
  assert.equal(final.characters[residentId].locationId,to.id);assert.equal(final.player.wealth,100);
  assert.equal(final.history.filter(e=>e.id==='scene:semantic-arrival').length,1);
  assert.equal(final.simulation.transactions['semantic-arrival'].operations,1);
  assert.equal(JSON.stringify(start.state),before,'no failed candidate may mutate the source');
 }
});

test('a failed semantic-arrival repair keeps both movement and resident creation uncommitted',async()=>{
 const start=createAstraOpening(createGameState('顾长生','ai',()=> 'review-arrival'));
 const w=start.state.astraWorld,to=Object.values(w.locations).find(l=>l.id!==w.player.locationId&&l.population>0&&!l.destroyed);
 for(const npc of Object.values(w.characters))if(npc.locationId===to.id){npc.locationId=w.player.locationId;npc.travel=null;}
 let calls=0,saves=0;const before=JSON.stringify(start.state);
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[start.turn],appendTurn:async()=>saves++},
  aiClient:{narrate:async()=>{
   calls++;if(calls>1)throw Object.assign(Error('quota'),{code:'AI_RATE_LIMIT',status:429});
   return JSON.stringify({worldPlan:{operations:[{type:'entity.update',targetId:'player',changes:{locationId:to.id,wealth:100}}]},
    blocks:[{type:'narr',text:`我落在${to.name}。周围空无一人。`}]});
  }}});
 const result=await runner.runWorld({state:start.state,input:{action:`言出法随：把我传送到${to.name}，并把我的财富改为100`},settings:{mode:'groq'},transactionId:'semantic-arrival-failed'});
 assert.equal(result.ok,false);assert.equal(result.code,'AI_RATE_LIMIT');assert.equal(saves,0);assert.equal(calls,2);
 assert.equal(JSON.stringify(start.state),before);assert.equal(JSON.stringify(result.state.astraWorld),JSON.stringify(w));
});
