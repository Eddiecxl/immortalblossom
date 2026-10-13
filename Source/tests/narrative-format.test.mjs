import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNarration } from '../../game/ai-client.js';

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
