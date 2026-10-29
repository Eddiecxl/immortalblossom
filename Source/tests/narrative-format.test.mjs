import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiClient, parseNarration } from '../../game/ai-client.js';
import { aiHttpError } from '../../game/ai-errors.js';

test('a local content alias preserves dialogue and its world proposal for normal validation',()=>{
  const worldPlan={operations:[{type:'social.observe',observerId:'npc:a',subjectId:'player',meaning:'joke',valence:0,evidence:'玩笑'}]};
  const parsed=parseNarration(JSON.stringify({worldPlan,blocks:[{type:'narr',content:'我看见对方收起笑意。'},{type:'dlg',name:'当局人物',content:'我有自己的打算。',claims:[{type:'state',entityId:'npc:a',field:'alive',value:true}]}]}));
  assert.equal(parsed.blocks[1].text,'我有自己的打算。');
  assert.equal(parsed.blocks[1].name,'当局人物');
  assert.deepEqual(parsed.worldPlan,worldPlan);
  assert.equal(parsed.blocks[1].claims.length,1);
});
test('format compatibility never coerces structured content into narrative or replaces explicit text',()=>{
  assert.throws(()=>parseNarration(JSON.stringify({blocks:[{type:'dlg',name:'人物',content:{text:'隐藏内容'}}]})));
  const parsed=parseNarration(JSON.stringify({blocks:[{type:'narr',text:'正式正文',content:'不应替代'}]}));
  assert.equal(parsed.blocks[0].text,'正式正文');
});

test('complete fenced JSON preserves punctuation inside text, claims and proposals while allowing trailing commas',()=>{
  const raw='```json\n{"blocks":[{"type":"narr","text":"我把纸上的 ,} 与 ,] 两种记号照原样读出。","claims":[{"type":"state","entityId":"npc:a","field":"name","value":"字,}",},],},],"worldPlan":{"operations":[],"evidence":"原样,]",},}\n```';
  const parsed=parseNarration(raw);
  assert.equal(parsed.blocks[0].text,'我把纸上的 ,} 与 ,] 两种记号照原样读出。');
  assert.equal(parsed.blocks[0].claims[0].value,'字,}');
  assert.deepEqual(parsed.worldPlan,{operations:[],evidence:'原样,]'});
});

test('an incomplete candidate never becomes a successful partial narration',()=>{
  const block='{"type":"narr","text":"我听完他的话，仔细端详手中的木牌，等着他接着解释来历。"}';
  for (const raw of [
    `{"blocks":[${block}],"worldPlan":{"operations":[`,
    `{"blocks":[${block},{"type":"dlg","text":"尚未说完`,
    `[{"blocks":[${block}]}`,
    `{"blocks":[${block}]} , "worldPlan": {`,
    `{"blocks":[${block}]} {"worldPlan":{"operations":[`
  ]) assert.throws(()=>parseNarration(raw),error=>error.code==='AI_INVALID_JSON');
});

test('plain companion replies are allowed but incomplete structured replies are not shown as prose',()=>{
  assert.deepEqual(parseNarration('这条路我也没有走过。','system'),{blocks:[{type:'sys',text:'这条路我也没有走过。'}]});
  assert.throws(()=>parseNarration('{"blocks":[{"type":"sys","text":"还没说完','system'),error=>error.code==='AI_INVALID_JSON');
});

const personalSettings={provider:'groq',credentialMode:'personal',model:'qwen/qwen3.8-27b',key:'test-key'};
const narrativeContext={requestType:'world',messages:[{role:'user',content:'继续'}]};

test('provider output limits reject even complete-looking content without another HTTP request',async()=>{
  for(const provider of ['groq','gemini']){
    let calls=0;
    const text='{"blocks":[{"type":"narr","text":"这段内容表面完整。"}]}';
    const client=createAiClient({storage:null,fetchImpl:async()=>{
      calls++;
      return Response.json(provider==='gemini'
        ? {candidates:[{content:{parts:[{text}]},finishReason:'MAX_TOKENS'}]}
        : {choices:[{message:{content:text},finish_reason:'length'}]});
    }});
    await assert.rejects(client.narrate({...personalSettings,provider},narrativeContext),error=>error.code==='AI_OUTPUT_TRUNCATED');
    assert.equal(calls,1);
  }
});

test('an upstream JSON validation failure does not promote completed blocks into a successful response',async()=>{
  let calls=0;
  const client=createAiClient({storage:null,fetchImpl:async()=>{
    calls++;
    return Response.json({error:{code:'json_validate_failed',failed_generation:'{"blocks":[{"type":"narr","text":"我听完他的话，仔细端详手中的木牌，等着他接着解释来历。"}],"worldPlan":{'}},{status:400});
  }});
  await assert.rejects(client.narrate(personalSettings,narrativeContext),error=>error.code==='AI_INVALID_JSON');
  assert.equal(calls,1);
});

test('proxy format failures preserve their classification without displaying upstream content',()=>{
  for(const code of ['AI_OUTPUT_TRUNCATED','AI_INVALID_JSON']){
    const failure=aiHttpError(new Response(null,{status:422}),{code,error:'private model output'},true);
    assert.equal(failure.code,code);
    assert.doesNotMatch(failure.message,/private model output/);
  }
});
