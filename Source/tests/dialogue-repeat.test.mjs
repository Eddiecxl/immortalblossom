import test from 'node:test';import assert from 'node:assert/strict';
import {validateAstraConversation} from '../../game/astra-interaction.js';
const old='你衣襟里的药包还在，若要离开这里就先把身上的伤口处理好。';
const past=[{blocks:[{type:'dlg',name:'甲',text:old}]}],plan={targetId:'npc:a',targetName:'甲'};
test('a fresh first block cannot hide a repeated second reply or another NPC repetition',()=>{
 assert.equal(validateAstraConversation([{type:'dlg',name:'甲',text:'方才的话我听清了，你想先听哪一段？'},{type:'dlg',name:'甲',text:old}],plan,past).ok,false);
 assert.equal(validateAstraConversation([{type:'dlg',name:'甲',text:old}],null,past).ok,false);
});
test('brief natural acknowledgments and different speakers are not treated as long copied speeches',()=>{
 assert.equal(validateAstraConversation([{type:'dlg',name:'乙',text:old}],{targetId:'npc:b',targetName:'乙'},past).ok,true);
 assert.equal(validateAstraConversation([{type:'dlg',name:'甲',text:'好。'},{type:'dlg',name:'甲',text:'我来扶住这扇门，你看着脚下。'}],plan,[{blocks:[{type:'dlg',name:'甲',text:'好。'}]}]).ok,true);
});
