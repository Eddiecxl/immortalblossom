import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';
test('ordinary author omits reality-only blueprints and repair receives the failed candidate with the original facts',async()=>{
 const messages=[];const state=createGameState('旅人','ai',()=> 'cloud-author-a');
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}},aiClient:{narrate:async(_,context)=>{
  messages.push(context.messages);return messages.length===1?'broken':JSON.stringify({blocks:[{type:'narr',text:'我看见晨风吹过眼前的街巷。'}]});
 }}});
 await runner.runWorld({state,input:'问一问附近的消息',settings:{mode:'groq'}});
 assert.equal(messages.length,2);
 assert.ok(!messages[0][0].content.includes('reality 模式：entity.update:'));
 assert.ok(messages[0][0].content.includes('commitment.offer'));
 assert.match(messages[0].at(-1).content,/旁白.*我/u);
 assert.equal(messages[1].find(m=>m.role==='assistant').content,'broken');
 assert.deepEqual(messages[1].slice(0,2),messages[0]);
});
test('invalid cloud prose never advances the world using a canned NPC fallback',async()=>{
 const state=createGameState('旅人','ai',()=> 'cloud-invalid-a');
 const npc=state.astraWorld.characters['npc:lin-xiaoman'];npc.locationId=state.astraWorld.player.locationId;npc.travel=null;
 const before=structuredClone(state);let written=0;
 const runner=createAiTurnRunner({transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{written++;}},
  aiClient:{narrate:async()=> 'invalid-json'}});
 const result=await runner.runWorld({state,input:{speech:npc.name+'，我是一条鱼。',action:''},settings:{mode:'groq'}});
 assert.equal(result.ok,false);assert.equal(result.code,'AI_NARRATIVE_INVALID');assert.equal(written,0);
 assert.deepEqual(state,before);
});
