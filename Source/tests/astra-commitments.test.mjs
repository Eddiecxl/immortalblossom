import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraWorld, normalizeAstraWorld } from '../../game/astra-world.js';
import { applyWorldPlan, settleWorldRules } from '../../game/astra-operations.js';
import { compileAstraContext } from '../../game/astra-context.js';
import { reconcileQuestArcs } from '../../game/astra-quests.js';
import { validateAstraNarration } from '../../game/astra-validator.js';
import { validateAstraConversation, fallbackAstraConversation } from '../../game/astra-interaction.js';
import { createGameState } from '../../game/game-state.js';
import { createAiTurnRunner } from '../../game/ai-turn.js';
import * as rpgView from '../../game/beta4/rpg-view.js';
import { parseNarration } from '../../game/ai-client.js';

function fixture(seed='offer-a') {
  const w=createAstraWorld(seed), n=Object.values(w.characters).find(n=>n.alive);
  n.locationId=w.player.locationId; n.travel=null; n.wealth=100;
  const item=w.items[w.player.inventory[0]];
  w.player.inventory=w.player.inventory.filter(id=>id!==item.id);
  item.ownerId=n.id; n.inventory.push(item.id);
  return {w,n,item};
}
function step(w, operations, turnId, speech='你好', targetId) {
  return applyWorldPlan(w,{operations},{turnId,mode:'ordinary',input:{speech,action:''},conversationTargetId:targetId}).world;
}
function propose(f, id='offer:test') {
  return step(f.w,[{type:'commitment.offer',offer:{id,fromId:f.n.id,toId:'player',itemId:f.item.id}}],'tx:offer','能给我一点东西吗',f.n.id);
}
const response=(id,response,actorId,evidence)=>({type:'commitment.respond',commitmentId:id,response,actorId,evidence});

test('an NPC offer reserves a real item but transfers nothing before the player accepts',()=>{
  const f=fixture(), w=propose(f);
  assert.equal(w.items[f.item.id].ownerId,f.n.id);
  assert.equal(w.player.inventory.includes(f.item.id),false);
  assert.equal(w.simulation.commitments['offer:test'].state,'pending');
  assert.equal(f.w.simulation?.commitments?.['offer:test'],undefined);
});
test('accepted prior offers update ownership and both inventories exactly once across seeds',()=>{
  for(let i=0;i<16;i++){
    const f=fixture('offer-seed-'+i), offered=propose(f);
    const w=step(offered,[response('offer:test','accept','player','我收下')],'tx:accept','我收下，谢谢',f.n.id);
    assert.equal(w.items[f.item.id].ownerId,'player');
    assert.equal(w.player.inventory.filter(id=>id===f.item.id).length,1);
    assert.equal(w.characters[f.n.id].inventory.includes(f.item.id),false);
    assert.equal(w.simulation.commitments['offer:test'].state,'fulfilled');
    const replay=step(w,[response('offer:test','accept','player','我收下')],'tx:accept','我收下，谢谢',f.n.id);
    assert.equal(replay.items[f.item.id].transferHistory.length,w.items[f.item.id].transferHistory.length);
    assert.throws(()=>step(w,[response('offer:test','accept','player','我收下')],'tx:again','我收下',f.n.id));
  }
});
test('declining closes only the relevant delivery and never gives the refused item',()=>{
  const f=fixture(), w=step(propose(f),[response('offer:test','decline','player','不拿')],'tx:decline','不拿，别给我',f.n.id);
  assert.equal(w.items[f.item.id].ownerId,f.n.id);
  assert.equal(w.simulation.commitments['offer:test'].state,'declined');
  assert.throws(()=>step(w,[response('offer:test','accept','player','我收下')],'tx:late','我收下',f.n.id));
});
test('a speaker can withdraw an offer following a real insult without losing ownership',()=>{
  const f=fixture(), w=step(propose(f),[
    {type:'social.observe',observerId:f.n.id,subjectId:'player',meaning:'insult',evidence:'滚蛋',valence:-0.8},
    response('offer:test','withdraw',f.n.id,'滚蛋')
  ],'tx:withdraw','滚蛋，谁要你的东西',f.n.id);
  assert.equal(w.simulation.commitments['offer:test'].state,'withdrawn');
  assert.equal(w.items[f.item.id].ownerId,f.n.id);
  assert.ok(w.characters[f.n.id].relationships.player<f.n.relationships.player || !f.n.relationships.player);
});
test('required delivery loss fails an active quest but leaves unrelated quests alone',()=>{
  const f=fixture(), w=propose(f);
  const base={giverId:f.n.id,targetLocationId:w.player.locationId,state:'active',stateHistory:[],rewards:['谢礼'],lostRewards:[],participants:[f.n.id]};
  w.quests['quest:linked']={...structuredClone(base),id:'quest:linked',title:'取回物品',requiredCommitmentIds:['offer:test']};
  w.quests['quest:other']={...structuredClone(base),id:'quest:other',title:'查看道路'};
  const after=step(w,[response('offer:test','decline','player','不拿')],'tx:no','不拿',f.n.id);
  assert.equal(after.quests['quest:linked'].state,'failed');
  assert.equal(after.quests['quest:other'].state,'active');
  assert.ok(after.quests['quest:linked'].stateHistory[0].cause.includes('offer:test'));
});
test('pending required delivery cannot pay a generated quest even when another condition is true',()=>{
  const f=fixture(), w=propose(f);
  w.quests['quest:blocked']={id:'quest:blocked',title:'取物',generated:true,state:'active',requiredCommitmentIds:['offer:test'],
    condition:{op:'eq',left:{entityId:'player',field:'alive'},right:true},giverId:f.n.id,reservedReward:2,
    rewardEffects:[{type:'stat.delta',target:'player',field:'wealth',magnitude:2}],rewards:['两枚钱'],targetLocationId:w.player.locationId};
  const wealth=w.player.wealth;
  settleWorldRules(w,[]);
  assert.equal(w.quests['quest:blocked'].state,'active');
  assert.equal(w.player.wealth,wealth);
});
test('death, destruction, changed ownership and expiry invalidate outstanding delivery dependencies',()=>{
  for(const change of ['death','destroy','owner','expiry']){
    const f=fixture(change), w=propose(f);
    w.quests['quest:linked']={id:'quest:linked',title:'领物',giverId:f.n.id,targetLocationId:w.player.locationId,
      state:'active',requiredCommitmentIds:['offer:test'],stateHistory:[],rewards:[],participants:[]};
    if(change==='death')w.characters[f.n.id].alive=false;
    if(change==='destroy')w.items[f.item.id].destroyed=true;
    if(change==='owner')w.items[f.item.id].ownerId='player';
    if(change==='expiry')w.simulation.commitments['offer:test'].expiresAt=w.minute-1;
    reconcileQuestArcs(w);
    assert.ok(['invalidated','expired'].includes(w.simulation.commitments['offer:test'].state));
    assert.equal(w.quests['quest:linked'].state,'failed');
  }
});
test('offers reject absent owners, double reservation, newly invented items and same-turn acceptance',()=>{
  const f=fixture(), op={type:'commitment.offer',offer:{id:'offer:test',fromId:f.n.id,toId:'player',itemId:f.item.id}};
  const offered=propose(f);
  assert.throws(()=>step(offered,[{...op,offer:{...op.offer,id:'offer:double'}}],'tx:double','你好',f.n.id));
  assert.throws(()=>step(f.w,[{...op,offer:{...op.offer,itemId:'item:missing'}}],'tx:missing','你好',f.n.id));
  assert.throws(()=>step(f.w,[op,response('offer:test','accept','player','我收下')],'tx:new','我收下',f.n.id));
  const absent=structuredClone(f.w); absent.player.travel={from:absent.player.locationId,to:'elsewhere'};
  assert.throws(()=>step(absent,[op],'tx:absent','你好',f.n.id));
});
test('acceptance needs present counterpart, current original evidence, and non-hypothetical consent',()=>{
  const f=fixture(), w=propose(f);
  for(const [speech,evidence] of [['不拿','不拿'],['如果我收下会怎样','我收下'],['你好','上次收下']])
    assert.throws(()=>step(w,[response('offer:test','accept','player',evidence)],'tx:bad:'+speech,speech,f.n.id));
  const absent=structuredClone(w); absent.characters[f.n.id].travel={from:absent.player.locationId,to:'elsewhere'};
  assert.throws(()=>step(absent,[response('offer:test','accept','player','我收下')],'tx:far','我收下',f.n.id));
});
test('context recalls real NPC inventory and terminal delivery state rather than dropping the agreement',()=>{
  const f=fixture(), w=step(propose(f),[response('offer:test','decline','player','不拿')],'tx:no','不拿',f.n.id);
  const p=compileAstraContext(w,'你刚才给我的东西呢');
  assert.ok(p.items.some(item=>item.id===f.item.id&&item.ownerId===f.n.id));
  assert.ok(p.simulationFacts.commitments.some(row=>row.id==='offer:test'&&row.state==='declined'));
  assert.ok(p.presentNpcs.find(n=>n.id===f.n.id).inventory.includes(f.item.id));
});
test('a mere offer cannot be narrated as an item already acquired by the protagonist',()=>{
  const f=fixture(), w=propose(f); w.items[f.item.id].name='青息丹';
  const check=validateAstraNarration(w,[{type:'narr',text:'我拿到了青息丹，将它握在手心。'}]);
  assert.equal(check.ok,false);
  assert.ok(check.errors.some(e=>e.code==='unsupported-item'));
});
test('neutral novel speech meanings are remembered without forcing a mechanical reward or insult',()=>{
  const f=fixture(), wealth=f.w.player.wealth, before=Number(f.n.relationships.player||0);
  const w=step(f.w,[{type:'social.observe',observerId:f.n.id,subjectId:'player',meaning:'joke',evidence:'香蕉皇帝',valence:0,
    reason:'把自己说成香蕉皇帝，听者觉得这是玩笑'}],'tx:joke','我是香蕉皇帝',f.n.id);
  assert.equal(w.player.wealth,wealth);
  assert.equal(Number(w.characters[f.n.id].relationships.player||0),before);
  assert.ok(Object.values(w.simulation.beliefs).some(b=>b.meaning==='joke'&&b.summary.includes('香蕉皇帝')));
});
test('quest conditions and required offer IDs survive the bounded context compiler',()=>{
  const f=fixture(), w=propose(f);
  w.quests['quest:context']={id:'quest:context',giverId:f.n.id,targetLocationId:w.player.locationId,state:'active',requiredCommitmentIds:['offer:test'],
    condition:{op:'all',conditions:[{op:'eq',left:{entityId:f.item.id,field:'ownerId'},right:'player'},
      {op:'eq',left:{entityId:'offer:test',field:'state'},right:'fulfilled'}]}};
  const q=compileAstraContext(w,'交付').activeQuests.find(q=>q.id==='quest:context');
  assert.equal(q.condition.conditions[0].left.entityId,f.item.id);
  assert.deepEqual(q.requiredCommitmentIds,['offer:test']);
});
test('spoken acceptance and refusal settle existing quests instead of remaining decorative dialogue',()=>{
  const f=fixture();
  f.w.quests['quest:spoken']={id:'quest:spoken',title:'查看路况',giverId:f.n.id,targetLocationId:f.w.player.locationId,
    state:'available',stateHistory:[],rewards:['谢礼'],participants:[f.n.id]};
  const accepted=step(f.w,[{type:'quest.respond',questId:'quest:spoken',actorId:'player',response:'accept',evidence:'我接这个委托'}],
    'tx:quest-yes','我接这个委托',f.n.id);
  assert.equal(accepted.quests['quest:spoken'].state,'active');
  const refused=step(accepted,[{type:'quest.respond',questId:'quest:spoken',actorId:'player',response:'decline',evidence:'我不做了'}],
    'tx:quest-no','我不做了',f.n.id);
  assert.equal(refused.quests['quest:spoken'].state,'abandoned');
  assert.equal(refused.quests['quest:spoken'].lostRewards[0],'谢礼');
});
test('a real giver withdrawing an accepted commission records failure without paying rewards',()=>{
  const f=fixture();
  f.w.quests['quest:spoken']={id:'quest:spoken',title:'查看路况',giverId:f.n.id,targetLocationId:f.w.player.locationId,
    state:'active',stateHistory:[],rewards:['谢礼'],participants:[f.n.id]};
  const wealth=f.w.player.wealth;
  const w=step(f.w,[{type:'quest.respond',questId:'quest:spoken',actorId:f.n.id,response:'withdraw',evidence:'滚蛋'}],
    'tx:quest-withdraw','滚蛋，谁替你做事',f.n.id);
  assert.equal(w.quests['quest:spoken'].state,'failed');
  assert.equal(w.player.wealth,wealth);
});
test('a meaningful short refusal is valid dialogue without forcing stock filler',()=>{
  const check=validateAstraConversation([{type:'dlg',name:'某位旅人',text:'不给。'}],{targetId:'npc:traveler',targetName:'某位旅人'});
  assert.equal(check.ok,true);
  assert.equal(validateAstraConversation([{type:'dlg',name:'某位旅人',text:'嗯。'}],{targetId:'npc:traveler',targetName:'某位旅人'}).ok,false);
});
test('changing the first sentence cannot conceal recycled NPC filler from the previous reply',()=>{
  const plan={targetId:'npc:one',targetName:'某位旅人',speech:'陪我数星星'};
  const earlier=[{blocks:[{type:'dlg',name:'某位旅人',text:'这事情我还在考虑。你若真想帮忙，得先告诉我具体要怎么做。'}]}];
  assert.equal(validateAstraConversation([{type:'dlg',name:'某位旅人',text:'数星星？这里天还亮。你若真想帮忙，得先告诉我具体要怎么做。'}],plan,earlier).ok,false);
});
test('world clock is supplied as an explicit period so prose does not have to infer daylight from absolute minutes',()=>{
  const f=fixture(); f.w.minute=365;
  const p=compileAstraContext(f.w,'数星星');
  assert.equal(p.clock.period,'清晨');
  assert.equal(p.clock.hour,6);
  assert.equal(p.clock.minute,5);
});
test('questions and a later refusal cannot be cherry-picked into acceptance evidence',()=>{
  const f=fixture(), offered=propose(f);
  for(const speech of ['我收下吗？','我收下？不，我不接受。'])
    assert.throws(()=>step(offered,[response('offer:test','accept','player','我收下')],'tx:ambiguous:'+speech,speech,f.n.id));
  f.w.quests['quest:question']={id:'quest:question',title:'委托',giverId:f.n.id,targetLocationId:f.w.player.locationId,
    state:'available',stateHistory:[],rewards:[],participants:[]};
  assert.throws(()=>step(f.w,[{type:'quest.respond',questId:'quest:question',actorId:'player',response:'accept',evidence:'我接这个委托'}],
    'tx:question','我接这个委托吗？',f.n.id));
});
test('hearing a courteous word inside a refusal does not silently award relationship points',async()=>{
  const state=createGameState('测试','ai',()=> 'no-keyword-appraisal');
  const npc=Object.values(state.astraWorld.characters).find(n=>n.alive);
  npc.locationId=state.astraWorld.player.locationId;npc.travel=null;
  const initial=Number(npc.relationships.player||0), speech=npc.name+'，请别帮忙了，我不接受。';
  const runner=createAiTurnRunner({aiClient:{narrate:async()=>JSON.stringify({worldPlan:{operations:[
    {type:'social.observe',observerId:npc.id,subjectId:'player',meaning:'refusal',evidence:'请别帮忙了',valence:0,reason:'礼貌拒绝并非接受帮忙'}]},
    blocks:[{type:'dlg',name:npc.name,text:'好，这件事由我自己处理，我们先不约定。'}]})},
    transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{}}});
  const result=await runner.runWorld({state,input:{speech,action:''},transactionId:'tx:polite-no',settings:{mode:'local',localModelName:'other'}});
  assert.equal(result.ok,true,result.error);
  assert.equal(Number(result.state.astraWorld.characters[npc.id].relationships.player||0),initial);
});
test('terminal prerequisites propagate through quest conditions while alternative mutable routes stay possible',()=>{
  const f=fixture(), w=propose(f);
  const base={giverId:f.n.id,targetLocationId:w.player.locationId,state:'active',stateHistory:[],rewards:[],participants:[]};
  w.quests['quest:first']={...structuredClone(base),id:'quest:first',title:'前置',requiredCommitmentIds:['offer:test']};
  const prerequisite={op:'eq',left:{entityId:'quest:first',field:'state'},right:'completed'};
  w.quests['quest:after']={...structuredClone(base),id:'quest:after',title:'后续',condition:prerequisite};
  w.quests['quest:alternative']={...structuredClone(base),id:'quest:alternative',title:'另一条路',condition:{op:'any',conditions:[prerequisite,
    {op:'gte',left:{entityId:'player',field:'wealth'},right:1000}]}};
  const after=step(w,[response('offer:test','decline','player','不拿')],'tx:lost','不拿',f.n.id);
  assert.equal(after.quests['quest:first'].state,'failed');
  assert.equal(after.quests['quest:after'].state,'failed');
  assert.equal(after.quests['quest:alternative'].state,'active');
});
test('older pending deliveries remain in context after numerous newer terminated agreements',()=>{
  const f=fixture(), w=propose(f);
  for(let i=0;i<10;i++)w.simulation.commitments['offer:old:'+i]={...w.simulation.commitments['offer:test'],id:'offer:old:'+i,state:'declined',createdAt:w.minute+i+1};
  assert.ok(compileAstraContext(w,'我收下').simulationFacts.commitments.some(o=>o.id==='offer:test'&&o.state==='pending'));
});
test('expiry events reach world rules even when reconciliation creates them inside rule settlement',()=>{
  const f=fixture(), w=propose(f);
  w.simulation.commitments['offer:test'].expiresAt=w.minute-1;
  w.simulation.rules['rule:expiry']={id:'rule:expiry',version:1,trigger:'commitment.expired',condition:{op:'eq',left:{entityId:'player',field:'alive'},right:true},
    effects:[{type:'stat.delta',target:'player',field:'wealth',magnitude:3}]};
  const wealth=w.player.wealth;
  settleWorldRules(w,[]);
  assert.equal(w.player.wealth,wealth+3);
  settleWorldRules(w,[]);
  assert.equal(w.player.wealth,wealth+3);
});
test('conditional promised money is not debited or reported paid before its real condition holds',()=>{
  const f=fixture(), w=f.w, wealth=w.player.wealth;
  w.quests['quest:conditional']={id:'quest:conditional',title:'条件奖励',generated:true,state:'active',giverId:f.n.id,
    targetLocationId:w.player.locationId,stateHistory:[],rewards:['五枚钱'],condition:{op:'eq',left:{entityId:'player',field:'alive'},right:true},
    reservedReward:5,rewardEffects:[{type:'stat.delta',target:'player',field:'wealth',magnitude:5,
      condition:{op:'gt',left:{entityId:f.n.id,field:'wealth'},right:200}}]};
  settleWorldRules(w,[]);
  assert.equal(w.characters[f.n.id].wealth,100);
  assert.equal(w.player.wealth,wealth);
  assert.equal(w.quests['quest:conditional'].state,'active');
  w.characters[f.n.id].wealth=250;
  settleWorldRules(w,[]);
  assert.equal(w.player.wealth,wealth+5);
  assert.equal(w.characters[f.n.id].wealth,245);
  assert.equal(w.quests['quest:conditional'].state,'completed');
});
test('starting items have real names and migrating older unnamed instances preserves ownership and custom names',()=>{
  const f=fixture();
  assert.equal(typeof f.item.name,'string');
  assert.ok(f.item.name.length>0);
  const legacy=structuredClone(f.w);delete legacy.items[f.item.id].name;
  const custom=legacy.items[legacy.player.inventory[0]];custom.name='玩家改名的物件';
  const migrated=normalizeAstraWorld(legacy);
  assert.equal(migrated.items[f.item.id].name,f.item.name);
  assert.equal(migrated.items[f.item.id].ownerId,f.n.id);
  assert.equal(migrated.items[custom.id].name,'玩家改名的物件');
  assert.equal(legacy.items[f.item.id].name,undefined);
});
test('player-facing delivery records display actual item ownership after acceptance or refusal',()=>{
  const f=fixture(), w=propose(f);
  assert.equal(typeof rpgView.commitmentRows,'function');
  let row=rpgView.commitmentRows({astraWorld:w})[0];
  assert.equal(row.ownerName,f.n.name);assert.equal(row.itemName,f.item.name);assert.equal(row.state,'pending');
  const accepted=step(w,[response('offer:test','accept','player','我收下')],'tx:view-accept','我收下',f.n.id);
  row=rpgView.commitmentRows({astraWorld:accepted})[0];
  assert.equal(row.ownerName,accepted.player.name);assert.equal(row.state,'fulfilled');
  const declined=step(w,[response('offer:test','decline','player','不拿')],'tx:view-decline','不拿',f.n.id);
  row=rpgView.commitmentRows({astraWorld:declined})[0];
  assert.equal(row.ownerName,f.n.name);assert.equal(row.state,'declined');
});
test('dialogue cannot claim a received item merely because the player asserts an unrecorded promise',()=>{
  const f=fixture(), alias=f.item.name.split('·')[0];
  const packet={playerTurn:{speech:'我收下你刚才答应给我的'+alias},recentTurns:[]};
  const result=validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'既然你收下了'+alias+'，我们就有个交代。'}],packet);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(e=>e.code==='unsupported-item'));
  assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:alias+'还在我这里，我尚未答应给你。'}],packet).ok,true);
  assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'你愿意收下'+alias+'吗？'}],packet).ok,true);
});
test('structured state claims are verified against arbitrary current entities, not seed prose',()=>{
  const f=fixture(), w=propose(f);
  const block={type:'dlg',name:f.n.name,text:'我们先确认东西的去向。',claims:[{type:'state',entityId:f.item.id,field:'ownerId',value:'player'}]};
  assert.equal(validateAstraNarration(w,[block]).ok,false);
  block.claims[0].value=f.n.id;assert.equal(validateAstraNarration(w,[block]).ok,true);
  block.claims=[{type:'state',entityId:'offer:test',field:'state',value:'fulfilled'}];
  assert.equal(validateAstraNarration(w,[block]).ok,false);
  block.claims[0].value='pending';assert.equal(validateAstraNarration(w,[block]).ok,true);
});
test('one conversation cannot accept another absent or unfocused giver quest',()=>{
  const f=fixture(), other=Object.values(f.w.characters).find(n=>n.id!==f.n.id&&n.alive);
  other.locationId=f.w.player.locationId;other.travel=null;
  f.w.quests['quest:other']={id:'quest:other',title:'旁人委托',giverId:other.id,targetLocationId:f.w.player.locationId,state:'available',stateHistory:[],rewards:[],participants:[]};
  assert.throws(()=>step(f.w,[{type:'quest.respond',questId:'quest:other',actorId:'player',response:'accept',evidence:'我接这个委托'}],
    'tx:wrong-giver','我接这个委托',f.n.id));
});
test('real JSON parsing preserves state claims before the Engine validates NPC prose',()=>{
  const f=fixture();
  const parsed=parseNarration(JSON.stringify({blocks:[{type:'dlg',name:f.n.name,text:'东西已经在你手里。',
    claims:[{type:'state',entityId:f.item.id,field:'ownerId',value:'player'}]}]}));
  assert.equal(validateAstraNarration(f.w,parsed.blocks).ok,false);
});
test('ownership prose keeps speaker, question and duplicate item instances distinct',()=>{
  const f=fixture(), alias=f.item.name.split('·')[0];
  assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'我已经收下了'+alias+'。'}]).ok,true);
  assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'你已经收下了'+alias+'吗？'}]).ok,true);
  f.w.items['item:another']={...structuredClone(f.item),id:'item:another',ownerId:'player'};
  f.w.player.inventory.push('item:another');
  assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'你已经收下了'+alias+'。'}]).ok,true);
  assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'这份已经归你。',claims:[{type:'state',entityId:f.item.id,field:'ownerId',value:'player'}]}]).ok,false);
});
test('bounded context recalls an explicitly referenced older pending agreement and its real item',()=>{
  const f=fixture(), w=propose(f);
  for(let i=0;i<20;i++){
    const id='item:gift:'+i;w.items[id]={...structuredClone(f.item),id,name:'赠礼编号'+i,ownerId:f.n.id};w.characters[f.n.id].inventory.push(id);
    w.simulation.commitments['offer:gift:'+i]={id:'offer:gift:'+i,kind:'item-transfer',state:'pending',fromId:f.n.id,toId:'player',itemId:id,quantity:1,createdAt:w.minute+i};
  }
  const packet=compileAstraContext(w,'我收下赠礼编号0');
  assert.ok(packet.simulationFacts.commitments.some(o=>o.id==='offer:gift:0'));
  assert.ok(packet.items.some(o=>o.id==='item:gift:0'));
  assert.ok(packet.simulationFacts.commitments.length<=8);
});
test('limited recovery answers item whereabouts from current ownership without inventing a promise',()=>{
  const f=fixture();f.item.transferHistory=[{from:'player',to:f.n.id,minute:f.w.minute,source:'tx:given'}];
  const result=fallbackAstraConversation(f.w,{targetId:f.n.id,speech:'你刚才说给我的东西，现在到底在谁那里？',facts:[]});
  assert.ok(result.blocks[0].text.includes(f.item.name));
  assert.ok(result.blocks[0].text.includes('还在我这里'));
});
test('memory recovery quotes actual heard speech across seeds, never a fabricated NPC recollection',()=>{
  for(let i=0;i<12;i++){
    const f=fixture('heard-memory-'+i), words='我是会唱歌的石头'+i;
    f.n.memories=[{source:'player-speech',summary:'玩家说过：“'+words+'”'},
      {source:'player-speech',summary:'玩家说过：“你愿意陪我看看远山吗？”'}];
    const result=fallbackAstraConversation(f.w,{targetId:f.n.id,speech:'之前我向你说过什么话？',facts:[]});
    assert.ok(result.blocks[0].text.includes(words));
    assert.ok(!result.blocks[0].text.includes('不清楚'));
  }
});
test('NPC acquisition prose requires that NPC ownership and does not masquerade as player acquisition',()=>{
  const f=fixture();f.item.name='普通麻绳';
  const block={type:'narr',text:'我将普通麻绳递给'+f.n.name+'，她接过时点了点头。'};
  assert.equal(validateAstraNarration(f.w,[block],{playerTurn:{action:'把普通麻绳交给'+f.n.name}}).ok,true);
  f.item.ownerId='player';
  assert.equal(validateAstraNarration(f.w,[block],{playerTurn:{action:'把普通麻绳交给'+f.n.name}}).ok,false);
  block.text='我将普通麻绳递到'+f.n.name+'面前，她没有收下。';
  assert.equal(validateAstraNarration(f.w,[block],{playerTurn:{action:'把普通麻绳交给'+f.n.name}}).ok,true);
});
test('NPC receipt guard does not assign unrelated items mentioned earlier in a block',()=>{
  const f=fixture();f.item.name='普通麻绳';
  const other=f.w.items[f.w.player.inventory[0]];other.name='铜钱';
  const block={type:'narr',text:'我摸了摸自己的铜钱，把普通麻绳递给'+f.n.name+'，她接过后收好。',
    claims:[{type:'state',entityId:f.item.id,field:'ownerId',value:f.n.id}]};
  assert.equal(validateAstraNarration(f.w,[block],{playerTurn:{action:'把普通麻绳交给'+f.n.name}}).ok,true);
});
test('completed receipt assertions bind across clauses to arbitrary referenced item instances',()=>{
 for(let i=0;i<12;i++){
  const f=fixture('cross-clause-'+i);f.item.name='随身物件'+i;
  const packet={playerTurn:{speech:'我收下你答应给我的'+f.item.name}};
  for(const text of ['既然你已收下，那'+f.item.name+'便是你的了。','你已经拿到了；这件东西以后你留着。'])
   assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text}],packet).ok,false,text);
  assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'请你收下'+f.item.name+'吧。'}],packet).ok,true);
 }
});
test('a concrete NPC promise of a held item needs a persistent agreement, while tentative consideration does not',()=>{
 for(let i=0;i<12;i++){
  const f=fixture('promise-binding-'+i);f.item.name='随身物件'+i;
  const packet={playerTurn:{speech:'你愿意把'+f.item.name+'还给我吗？'}};
  const block={type:'dlg',name:f.n.name,text:'若你真需要，我可以归还，但你得亲自来取。'};
  assert.equal(validateAstraNarration(f.w,[block],packet).ok,false);
  assert.equal(validateAstraNarration(propose(f),[block],packet).ok,true);
  block.text='若你真需要，我自当归还。';
  assert.equal(validateAstraNarration(f.w,[block],packet).ok,false);
  assert.equal(validateAstraNarration(propose(f),[block],packet).ok,true);
  block.text='我可以考虑归还，但眼下尚未答应。';
  assert.equal(validateAstraNarration(f.w,[block],packet).ok,true);
 }
});
test('ordinary transfer understands an unambiguous item base name but does not guess between duplicates',()=>{
 const f=fixture();f.item.ownerId='player';f.n.inventory=f.n.inventory.filter(id=>id!==f.item.id);f.w.player.inventory.push(f.item.id);
 f.item.name='随身物件·serviceable';
 const op={type:'resource.transfer',itemId:f.item.id,fromId:'player',toId:f.n.id};
 const context={turnId:'tx:alias',mode:'ordinary',input:{speech:'',action:'把随身物件交给'+f.n.name}};
 assert.equal(applyWorldPlan(f.w,{operations:[op]},context).world.items[f.item.id].ownerId,f.n.id);
 f.w.items['item:duplicate']={...structuredClone(f.item),id:'item:duplicate',name:'随身物件·masterwork'};f.w.player.inventory.push('item:duplicate');
 assert.throws(()=>applyWorldPlan(f.w,{operations:[op]},{...context,turnId:'tx:ambiguous'}));
 assert.equal(applyWorldPlan(f.w,{operations:[op]},{...context,turnId:'tx:full-name',input:{action:'把随身物件·serviceable交给'+f.n.name}}).world.items[f.item.id].ownerId,f.n.id);
});
test('transport rate limits preserve the uncommitted world instead of inventing a conversation turn',async()=>{
  const state=createGameState('测试','ai',()=> 'transport-rate-world');
  const npc=Object.values(state.astraWorld.characters).find(n=>n.alive);
  npc.locationId=state.astraWorld.player.locationId;npc.travel=null;
  const before=structuredClone(state.astraWorld);let appended=false;
  const runner=createAiTurnRunner({aiClient:{narrate:async()=>{throw Object.assign(new Error('等待额度恢复'),{status:429,code:'AI_RATE_LIMITED',retryAfterMs:120000});}},
    transcriptStore:{recentTurns:async()=>[],appendTurn:async()=>{appended=true;}}});
  const result=await runner.runWorld({state,input:{speech:npc.name+'，我想问件事',action:''},transactionId:'tx:transport',settings:{mode:'groq'}});
  assert.equal(result.ok,false);assert.equal(appended,false);
  assert.deepEqual(state.astraWorld,before);
});
test('one plan cannot expand item alias permission after transferring the explicitly named instance',()=>{
 const f=fixture();f.item.ownerId='player';f.n.inventory=f.n.inventory.filter(id=>id!==f.item.id);f.w.player.inventory.push(f.item.id);
 f.item.name='随身物件·serviceable';
 const duplicate={...structuredClone(f.item),id:'item:duplicate',name:'随身物件·masterwork'};
 f.w.items[duplicate.id]=duplicate;f.w.player.inventory.push(duplicate.id);
 const context={turnId:'tx:two-transfers',mode:'ordinary',input:{action:'把随身物件·serviceable交给'+f.n.name}};
 const first={type:'resource.transfer',itemId:f.item.id,fromId:'player',toId:f.n.id};
 const second={...first,itemId:duplicate.id};const before=structuredClone(f.w);
 assert.throws(()=>applyWorldPlan(f.w,{operations:[first,second]},context));
 assert.deepEqual(f.w,before);
 assert.equal(applyWorldPlan(f.w,{operations:[first]},context).world.items[f.item.id].ownerId,f.n.id);
});
test('explaining a held item is not a promise to give it away',()=>{
 const f=fixture();f.item.name='随身物件';
 const packet={playerTurn:{speech:'随身物件现在在哪里？'}};
 assert.equal(validateAstraNarration(f.w,[{type:'dlg',name:f.n.name,text:'我可以给你解释随身物件的去向，它还在我这里。'}],packet).ok,true);
});
test('item consumption cannot authorize a second instance by a substring of the first full name',()=>{
 const f=fixture();f.item.ownerId='player';f.n.inventory=f.n.inventory.filter(id=>id!==f.item.id);f.w.player.inventory.push(f.item.id);
 Object.assign(f.item,{name:'随身丹药·serviceable',generated:true,quantity:1,effects:[{type:'heal',target:'player',magnitude:'full'}]});
 const duplicate={...structuredClone(f.item),id:'item:second-pill',name:'随身丹药·masterwork'};
 f.w.items[duplicate.id]=duplicate;f.w.player.inventory.push(duplicate.id);
 const context={turnId:'tx:two-pills',mode:'ordinary',input:{action:'服用随身丹药·serviceable'}};
 const first={type:'effect.apply',itemId:f.item.id},second={type:'effect.apply',itemId:duplicate.id};
 assert.throws(()=>applyWorldPlan(f.w,{operations:[first,second]},context));
 const used=applyWorldPlan(f.w,{operations:[first]},context).world;
 assert.equal(used.items[f.item.id].destroyed,true);
 assert.throws(()=>applyWorldPlan(used,{operations:[second]},{...context,turnId:'tx:post-mechanical',settledAction:'use_generated_item',settledItemId:f.item.id}));
 assert.equal(f.w.items[duplicate.id].quantity,1);
});
test('limited fallback explains the latest actual delivery decision instead of resetting to an introduction',()=>{
 const f=fixture();f.item.name='随身物件';const offered=propose(f);
 for(const decision of ['accept','decline']){
  const speech=decision==='accept'?'我收下':'我不要';
  const world=step(offered,[response('offer:test',decision,'player',speech)],'tx:outcome-'+decision,speech,f.n.id);
  const reply=fallbackAstraConversation(world,{targetId:f.n.id,speech:'我们刚才作出的决定，接下来会怎样？',facts:[]});
  assert.match(reply.blocks[0].text,/随身物件/u);
  assert.match(reply.blocks[0].text,decision==='accept'?/你那里/u:/拒绝/u);
  assert.doesNotMatch(reply.blocks[0].text,/我是|这里是/u);
 }
});
test('outcome questions retain a real previous transfer even when the NPC never offered to return it',()=>{
 const f=fixture();f.item.name='随身物件';
 f.item.transferHistory=[{minute:f.w.minute,from:'player',to:f.n.id,source:'tx:given'}];
 const reply=fallbackAstraConversation(f.w,{targetId:f.n.id,speech:'我们刚才作出的决定，接下来会怎样？',facts:[]});
 assert.match(reply.blocks[0].text,/随身物件还在我这里/u);
 assert.doesNotMatch(reply.blocks[0].text,/我是|这里是/u);
});
