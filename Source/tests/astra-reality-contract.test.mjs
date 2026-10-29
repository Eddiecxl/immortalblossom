import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameState} from '../../game/game-state.js';
import {createAiTurnRunner} from '../../game/ai-turn.js';
import {createTranscriptStore} from '../../game/transcript-store.js';
import {validateAstraNarration} from '../../game/astra-validator.js';

const seeds = ['law-mortal-a', 'law-mortal-b', 'law-mortal-c'];
const neutral = [{type:'narr', text:'我站在路旁，听见风吹动衣袖。'}];

function harness(state, responses = [{blocks:neutral}]) {
  const calls = [];
  const transcriptStore = createTranscriptStore({memory:new Map()});
  const runner = createAiTurnRunner({transcriptStore, aiClient:{narrate:async (_, request) => {
    calls.push(request);
    return JSON.stringify(responses[Math.min(calls.length-1,responses.length-1)]);
  }}});
  return {calls, transcriptStore, run:input => runner.runWorld({state,input,
    transactionId:'law-contract:turn',settings:{mode:'groq',provider:'groq'}})};
}

test('explicit natural-language reality invocations succeed from the mortal realm in speech and action', async () => {
  for (const seed of seeds) for (const channel of ['speech','action']) {
    for (const phrase of ['我用言出法随让我无敌','我使用言出法随：让我无敌',
      '发动言出法随，让我无敌','言出法随让我无敌']) {
      const state = createGameState('试行者','ai',()=>seed);
      assert.equal(state.astraWorld.player.cultivation.realm,'none');
      const h = harness(state,[{blocks:[{type:'sys',text:'凡人无法使用言出法随。'}]}]);
      const result = await h.run({speech:'',action:'',[channel]:phrase});
      assert.equal(result.ok,true,`${seed}/${channel}/${phrase}: ${result.error}`);
      assert.equal(result.state.astraWorld.player.invincible,true);
      assert.equal(result.state.astraWorld.player.cultivation.realm,'none');
      assert.equal(h.calls.length,0,'supported rewrites must settle without an AI permission check');
      assert.ok(result.state.astraWorld.history.some(row=>row.type==='reality_mutation'&&row.applied));
      assert.equal((await h.transcriptStore.allTurns(state.journeyId)).length,1);
      assert.equal(state.astraWorld.player.invincible,false);
    }
  }
});

test('quotes, speculation, negation and mere mention never execute a reality invocation', async () => {
  for (const channel of ['speech','action']) for (const phrase of [
    '如果我用言出法随让我无敌，会怎样？',
    '我用言出法随：如果让我无敌会怎样？',
    '“我用言出法随让我无敌”是书上的一句话',
    "'言出法随：让我无敌'只是引用",
    '我不使用言出法随让我无敌',
    '言出法随：我不想让我无敌',
    '言出法随是百分之百成功的能力',
    '我听说言出法随能让我无敌'
  ]) {
    const state = createGameState('试行者','ai',()=> 'law-non-invocation');
    const result = await harness(state).run({speech:'',action:'',[channel]:phrase});
    assert.equal(result.ok,true,`${channel}/${phrase}: ${result.error}`);
    assert.equal(result.state.astraWorld.player.invincible,false,phrase);
    assert.equal(result.state.astraWorld.history.some(row=>row.type==='reality_mutation'),false,phrase);
  }
});

test('ordinary spoken threats remain speech and never gain reality powers', async () => {
  const state=createGameState('试行者','ai',()=> 'law-ordinary-threat');
  const npc=Object.values(state.astraWorld.characters).find(row=>row.alive);
  const result=await harness(state).run({speech:`我要杀死${npc.name}`,action:''});
  assert.equal(result.state.astraWorld.characters[npc.id].alive,true);
  assert.equal(result.state.astraWorld.history.some(row=>row.type==='reality_mutation'),false);
});

test('explicit reality death bypasses an opposing higher realm and changes only the named actor', async () => {
  for (const seed of seeds) for (const channel of ['speech','action']) {
    const state=createGameState('试行者','ai',()=>seed);
    const [target,other]=Object.values(state.astraWorld.characters).filter(row=>row.alive).slice(0,2);
    target.cultivation.realm='tribulation';
    const result=await harness(state).run({speech:'',action:'',[channel]:`我使用言出法随让${target.name}死去`});
    assert.equal(result.ok,true,result.error);
    assert.equal(result.state.astraWorld.characters[target.id].alive,false);
    assert.equal(result.state.astraWorld.characters[other.id].alive,true);
    assert.equal(result.state.astraWorld.player.cultivation.realm,'none');
  }
});

test('reality proposals repair a realm-gated denial and commit only the valid scoped candidate', async () => {
  for (const seed of seeds) {
    const state=createGameState('试行者','ai',()=>seed);
    const npc=Object.values(state.astraWorld.characters).find(row=>row.alive);
    npc.gender='男';
    const plan={operations:[{type:'entity.update',targetId:npc.id,changes:{gender:'女'}}]};
    const h=harness(state,[
      {worldPlan:plan,blocks:[{type:'sys',text:'宿主还是凡人，无法施展言出法随，必须提升境界才能使用。'}]},
      {worldPlan:plan,blocks:[{type:'narr',text:'我看见言灵落定，指定之人的形貌已改变，其余记忆仍在。'}]}
    ]);
    const result=await h.run({speech:`我用言出法随将${npc.name}变成女性`,action:''});
    assert.equal(result.ok,true,result.error);
    assert.equal(result.state.astraWorld.characters[npc.id].gender,'女');
    assert.equal(result.state.astraWorld.player.cultivation.realm,'none');
    assert.equal(h.calls.length,2,'realm denial must be rejected before commit');
    assert.equal(result.blocks.some(block=>/凡人.*无法/u.test(block.text)),false);
  }
});

test('the validator rejects denying a settled reality rewrite while accepting the absence of a realm gate', () => {
  const state=createGameState('试行者','ai',()=> 'law-validator');
  state.astraWorld.history.push({id:'reality:settled',type:'reality_mutation',applied:true,minute:state.astraWorld.minute});
  const packet={planMode:'reality',settledAction:'reality'};
  for (const text of ['言出法随失败了，世界没有发生改变。','凡人不能发动言出法随。']) {
    assert.equal(validateAstraNarration(state,[{type:'sys',text}],packet).ok,false,text);
  }
  assert.equal(validateAstraNarration(state,[{type:'sys',text:'言出法随不受凡人境界限制，改写已经落账。'}],packet).ok,true);
});

test('an unexecutable reality concept retains the whole input without a fabricated successful turn', async () => {
  const state=createGameState('试行者','ai',()=> 'law-deferred');
  const h=harness(state,[{worldPlan:{operations:[{type:'concept.defer',description:'让时间长出蓝色翅膀',reason:'缺少可验证的时间形貌规则'}]},
    blocks:[{type:'narr',text:'我将这条尚无可验证规则的改写留在命簿中，眼前世界仍保持原样。'}]}]);
  const result=await h.run({speech:'我用言出法随让时间长出蓝色翅膀',action:''});
  assert.equal(result.ok,false);
  assert.deepEqual(result.state.astraWorld,state.astraWorld);
  assert.equal(result.state.astraWorld.player.cultivation.realm,'none');
  assert.equal(result.retry.input,'我用言出法随让时间长出蓝色翅膀');
  const requestFacts=JSON.parse(h.calls[0].messages[1].content.split('\n')[0].slice('世界事实：'.length));
  assert.equal(requestFacts.planMode,'reality');
});

test('a failed cloud job retains its terminal status for the browser retry policy', async () => {
  const state=createGameState('试行者','ai',()=> 'law-terminal-job');
  const runner=createAiTurnRunner({transcriptStore:createTranscriptStore({memory:new Map()}),
    aiClient:{narrate:async()=>{throw Object.assign(Error('upstream failed'),{code:'AI_UPSTREAM_FAILED',status:503,terminalJob:true});}}});
  const result=await runner.runWorld({state,input:{speech:'我看看附近',action:''},settings:{mode:'groq'}});
  assert.equal(result.ok,false);
  assert.equal(result.terminalJob,true);
  assert.equal(result.status,503);
});
