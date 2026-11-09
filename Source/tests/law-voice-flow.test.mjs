import test from 'node:test';import assert from 'node:assert/strict';
import {createMainStoryState} from '../../game/astra-main-story.js';
import {compileAstraContext} from '../../game/astra-context.js';import {dialogueFrame} from '../../game/astra-dialogue.js';
import {applyWorldPlan} from '../../game/astra-operations.js';
import * as realityPrompt from '../../game/astra-reality-prompt.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';import {createTranscriptStore} from '../../game/transcript-store.js';
import {createAstraOpening} from '../../game/astra-opening.js';
const setup=()=>createMainStoryState('顾长生',()=> 'voice-flow');
test('quick author remembers the actual recent NPC and system blocks instead of an absent dialogue alias',()=>{
 const state=setup(),recent=[{userText:'你怎么帮我？',blocks:[{type:'dlg',name:'林小满',text:'我也想离开这里，顺路搭个伴。'},{type:'sys',text:'她在说自己的打算，先听完。'}]}];
 const packet=compileAstraContext(state,'能解释一下吗',recent);packet.playerTurn={speech:'能解释一下吗',action:''};packet.conversation={targetId:'npc:lin-xiaoman'};
 const frame=dialogueFrame(packet);assert.ok(frame);assert.ok(JSON.stringify(frame.recentTurns).includes('顺路搭个伴'));assert.ok(JSON.stringify(frame.recentTurns).includes('先听完'));
});
test('addressing a present character by name stays in the compact lane and retains their real numeric facts',()=>{
 const s=setup(),npc=s.astraWorld.characters['npc:lin-xiaoman'],p=compileAstraContext(s,'林小满，你现在怎么看我？',[]);p.playerTurn={speech:'林小满，你现在怎么看我？',action:''};p.conversation={targetId:npc.id};assert.ok(p.numericFacts.length);const frame=dialogueFrame(p);assert.ok(frame);assert.equal(frame.presentNpcs.find(n=>n.id===npc.id).wealth,npc.wealth);
 const outside=structuredClone(p);outside.numericFacts.push({id:'remote:unknown',wealth:500});assert.equal(dialogueFrame(outside),null);
});
test('short dialogue retains the last committed change so new loyalty cannot be mistaken for an invented shared past',()=>{
 const s=setup(),p=compileAstraContext(s,'你现在怎么想？',[{userText:'言出法随：让林小满忠诚于我',blocks:[{type:'narr',text:'敕令生效，林小满对我的效忠已经改变。'}]},{userText:'你好',blocks:[{type:'narr',text:'我说：“你好”',engineOwnedPlayerSpeech:true},{type:'dlg',name:'林小满',text:'我在。'}]}]);p.playerTurn={speech:'你现在怎么想？',action:''};p.conversation={targetId:'npc:lin-xiaoman'};const frame=dialogueFrame(p);assert.ok(frame);assert.match(JSON.stringify(frame.recentTurns),/敕令生效/);assert.ok(!JSON.stringify(frame.recentTurns).includes('我说'));
});
test('the first player reply continues the actual opening encounter rather than marking the same NPC as a stranger again',async()=>{
 const opening=createAstraOpening(setup()),store=createTranscriptStore({memory:new Map()}),requests=[];await store.appendTurn(opening.state.journeyId,opening.turn);
 const runner=createAiTurnRunner({transcriptStore:store,aiClient:{narrate:async(_,req)=>{requests.push(req);return JSON.stringify({blocks:[{type:'dlg',name:'林小满',text:'药包还在你衣襟里，先摸摸看。'}],worldPlan:{operations:[]}});}}});
 const r=await runner.runWorld({state:opening.state,input:{speech:'林小满，你说的药包在哪？'},settings:{mode:'groq',fastDialogue:true,narrativePolicy:'playable',renderSettledScenes:false}});assert.equal(r.ok,true,r.error);const facts=JSON.parse(requests[0].messages[1].content.split('\n')[0].slice('世界事实：'.length));assert.equal(facts.conversation.firstContact,false);
});
test('one oversized semantic law is retried with its entire command then committed exactly once',async()=>{
 const state=setup(),calls=[],input={action:'言出法随：让林小满的性格变得温和并忠诚于我',speech:''};
 const runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async(_,req)=>{calls.push(structuredClone(req));if(calls.length===1)throw Object.assign(Error('over budget'),{code:'AI_INPUT_BUDGET',status:413});return JSON.stringify({blocks:[{type:'narr',text:'她的态度改变了。'}],worldPlan:{operations:[{type:'entity.update',targetId:'npc:lin-xiaoman',changes:{personality:'温和，忠诚于顾长生'}},{type:'relation.upsert',fromId:'npc:lin-xiaoman',toId:'player',kind:'trust',weight:1}]}});}}});
 const result=await runner.runWorld({state,input,settings:{mode:'groq',fastDialogue:true,renderSettledScenes:false,narrativePolicy:'playable'}});assert.equal(result.ok,true,result.error);assert.equal(calls.length,2);assert.ok(calls.every(r=>JSON.parse(r.messages[1].content).command.action===input.action));assert.ok(calls[1].messages[0].content.length<calls[0].messages[0].content.length);assert.equal(result.state.astraWorld.characters['npc:lin-xiaoman'].relationships.player,100);assert.equal(state.astraWorld.characters['npc:lin-xiaoman'].personality,'mischievous');
});
test('known laws remain immediately playable while cloud requests have no quota',async()=>{
 let calls=0;const state=setup(),runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),aiClient:{narrate:async()=>{calls++;throw Object.assign(Error('quota'),{status:429,retryAfterMs:1000000});}}});
 const result=await runner.runWorld({state,input:{action:'言出法随：让我无敌'},settings:{mode:'groq',renderSettledScenes:false,narrativePolicy:'playable'}});assert.equal(result.ok,true,result.error);assert.equal(result.state.astraWorld.player.invincible,true);assert.equal(calls,0);
});
test('rewritten loyalty invalidates an old social avoidance plan but keeps unrelated obligations',()=>{
 const w=setup().astraWorld,npc=w.characters['npc:lin-xiaoman'];npc.currentPlan={type:'avoid',targetId:'player',causeEventId:'old-hostility'};
 const op={type:'relation.upsert',fromId:npc.id,toId:'player',kind:'trust',weight:1},context={turnId:'loyal-now',mode:'reality',input:{action:'言出法随：让林小满忠诚于我'}};
 const changed=applyWorldPlan(w,{operations:[op]},context).world;assert.equal(changed.characters[npc.id].currentPlan,null);
 npc.currentPlan={type:'deliver',targetId:'player',causeEventId:'medicine'};assert.equal(applyWorldPlan(w,{operations:[op]},{...context,turnId:'keep-obligation'}).world.characters[npc.id].currentPlan.type,'deliver');
});
test('reality author carries the exact composite command and real remote targets without replaying unrelated histories',()=>{
 const state=setup(),w=state.astraWorld,npc=w.characters['npc:cast-4'];npc.memories=Array.from({length:80},()=>({summary:'无关的长故事'.repeat(50)}));
 const input={speech:'',action:'言出法随：让'+npc.name+'变得温和并忠诚于我，同时让我拥有一百枚铜钱'};
 const packet=compileAstraContext(state,input.action,[]),messages=realityPrompt.realityAuthorMessages(w,packet,input);
 const body=JSON.parse(messages[1].content);assert.deepEqual(body.command,input);assert.ok(body.targets.some(t=>t.id===npc.id&&t.name===npc.name));assert.ok(body.player.id==='player');assert.ok(messages[0].content.includes('personality'));
 assert.ok(JSON.stringify(messages).length<6500);assert.ok(!messages[1].content.includes('无关的长故事'));assert.deepEqual(input.action,'言出法随：让'+npc.name+'变得温和并忠诚于我，同时让我拥有一百枚铜钱');
});
test('explicit personality and trust rewrites persist without changing the NPC stable identity or unrelated people',()=>{
 const state=setup(),w=state.astraWorld,npc=w.characters['npc:lin-xiaoman'],before=structuredClone(w);
 const changed=applyWorldPlan(w,{operations:[{type:'entity.update',targetId:npc.id,changes:{personality:'温和直率，忠诚于顾长生，愿意解释自己的想法'}},{type:'relation.upsert',fromId:npc.id,toId:'player',kind:'trust',weight:1}]},{turnId:'rewrite-voice',mode:'reality',enforceScope:true,input:{action:'言出法随：让林小满变得温和直率并忠诚于我'}}).world;
 assert.equal(changed.characters[npc.id].relationships.player,100);assert.match(changed.characters[npc.id].personality,/温和直率/);assert.equal(changed.characters[npc.id].id,npc.id);
 assert.equal(w.characters[npc.id].personality,before.characters[npc.id].personality);assert.deepEqual(changed.characters['npc:cast-0'],before.characters['npc:cast-0']);
 const packet=compileAstraContext({...state,astraWorld:changed},'你现在怎么想？',[]);assert.match(packet.presentNpcs.find(n=>n.id===npc.id).personality,/温和直率/);assert.equal(packet.presentNpcs.find(n=>n.id===npc.id).relationships.player,100);
 assert.ok(Object.values(changed.simulation.events).some(e=>e.targetIds?.includes(npc.id)&&e.impacts?.some(i=>i.dimension==='personality')));
 assert.throws(()=>applyWorldPlan(w,{operations:[{type:'entity.update',targetId:npc.id,changes:{personality:'温和'}}]},{turnId:'ordinary-voice',mode:'ordinary',input:{speech:'你温柔点嘛'}}));
});
