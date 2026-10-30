import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNarration} from '../../game/ai-client.js';
test('an authored player turn cue is rendered last with the complete world plan retained',()=>{
 const cue={type:'dlg',name:'林小满',text:'行，那我不拦你。你是往哪边走？'};
 const plan={operations:[]};const result=parseNarration(JSON.stringify({blocks:[{type:'narr',text:'她收回手，向旁边让开。'}],turnCue:cue,worldPlan:plan}));
 assert.deepEqual(result.blocks.at(-1),cue);assert.deepEqual(result.worldPlan,plan);
});
test('turn cues are not duplicated, dropped at a block limit, or accepted as hidden system advice',()=>{
 const cue={type:'narr',text:'伸到近前的手停住，等着我的回应。'};
 assert.equal(parseNarration(JSON.stringify({blocks:[cue],turnCue:cue})).blocks.length,1);
 const many=Array.from({length:8},(_,i)=>({type:'narr',text:'第'+i+'段'}));
 assert.throws(()=>parseNarration(JSON.stringify({blocks:many,turnCue:cue})),/过长/u);
 assert.throws(()=>parseNarration(JSON.stringify({blocks:[cue],turnCue:{type:'sys',text:'建议去做任务'}})));
});
test('deduplicating a cue retains all claims and fact references for world validation',()=>{
 const cue={type:'dlg',name:'林小满',text:'一切已按你说的改变。',claims:[{type:'state',entityId:'player',field:'health',value:1}],factIds:['b']};
 const body={...cue,claims:[{type:'state',entityId:'player',field:'wealth',value:999999}],factIds:['a']};
 const result=parseNarration(JSON.stringify({blocks:[body],turnCue:cue}));
 assert.deepEqual(result.blocks[0].claims,[...body.claims,...cue.claims]);
 assert.deepEqual(result.blocks[0].factIds,['a','b']);
 assert.throws(()=>parseNarration(JSON.stringify({blocks:[{...body,claims:'invalid'}],turnCue:cue})));
});
test('a final cue that repeats a complete question inside a longer block is merged without losing its remainder',()=>{
 const cue={type:'dlg',name:'任意目击者',text:'你倒是说说，你是从哪条道走过来的？'};
 const body={...cue,text:cue.text+'这街上风平浪静的，连个影子都没见着。',claims:[{type:'state',entityId:'player',field:'health',value:91}]};
 const result=parseNarration(JSON.stringify({blocks:[body,{type:'narr',text:'她没有再靠近。'}],turnCue:cue}));
 assert.equal(result.blocks.length,2);assert.equal(result.blocks.at(-1).text,body.text);assert.deepEqual(result.blocks.at(-1).claims,body.claims);
 const another={...body,name:'另一人'};assert.equal(parseNarration(JSON.stringify({blocks:[another],turnCue:cue})).blocks.length,2);
});
