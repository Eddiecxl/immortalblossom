import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextPlayback,upgradeReadingPreferences,createChroniclePlayer} from '../../game/beta4/chronicle-player.js';

test('reading progresses by visible frame time, with a breathing pause at punctuation',()=>{
 const play=createTextPlayback('甲，乙。丙',{interval:50});
 assert.equal(play.advance(0).text,'甲');
 assert.equal(play.advance(50).text,'甲，');
 assert.equal(play.advance(100).text,'甲，');
 assert.equal(play.advance(150).text,'甲，');
 assert.equal(play.advance(200).text,'甲，乙');
 assert.equal(play.advance(250).text,'甲，乙。');
 assert.equal(play.advance(300).text,'甲，乙。');
 assert.equal(play.advance(350).text,'甲，乙。');
});

test('system projection is called only when that block has actually finished, in NPC-system-NPC order',async()=>{
 const element=()=>({children:[],style:{},classList:{add(){},remove(){}},append(...xs){this.children.push(...xs);},setAttribute(){},addEventListener(){},querySelector(q){return q==='p'?this.children.find(c=>c.tag==='p'):null;},querySelectorAll(){return[];}});
 const doc={hidden:false,createElement(tag){return {...element(),tag};},createTextNode(text){return {text};}},target={...element(),ownerDocument:doc,scrollTop:0,scrollHeight:0,clientHeight:0};let time=0;const calls=[];
 const player=createChroniclePlayer({target,status:element(),skipButton:element(),pauseButton:element(),latestButton:element(),getSpeed:()=>0,frame:fn=>{queueMicrotask(()=>fn(time+=16));return time;}});
 const rows=[{type:'dlg',name:'甲',text:'吃过了。'},{type:'sys',text:'你倒是会挑时候。'},{type:'dlg',name:'甲',text:'先走，路上再说。'}];
 const side=element();await player.render(rows,{onSystemStart:row=>{assert.equal(target.children.length,1);const p=doc.createElement('p');side.append(p);return {element:p};},onRowComplete:row=>{assert.equal((row.type==='sys'?side:target).children.at(-1).querySelector?.('p')?.textContent||(row.type==='sys'?side.children.at(-1).textContent:''),row.text);calls.push(row.type);if(row.type==='dlg'&&calls.length===1)assert.equal(target.children.length,1);}});assert.deepEqual(calls,['dlg','sys','dlg']);assert.equal(target.children.length,2);assert.equal(side.children.length,1);
 target.children=[];const first=player.render(rows,{animate:false}),second=player.render(rows,{animate:false});
 assert.deepEqual(target.children.map(el=>el.querySelector('p').textContent),[...rows,...rows].filter(r=>r.type!=='sys').map(r=>r.text));await Promise.all([first,second]);
});
test('pausing or a long background frame cannot dump the unread paragraph on resume',()=>{
 const play=createTextPlayback('一二三四五六七八九十'.repeat(20),{interval:50});
 play.advance(0);play.advance(5000,{paused:true});
 assert.equal(play.advance(5100,{paused:true}).text,'一');
 assert.ok(play.advance(9000).text.length<=3);
 assert.equal(play.advance(9001,{skip:true}).done,true);
});
test('known old default becomes slower while explicit instant/custom preferences survive',()=>{
 assert.equal(upgradeReadingPreferences({textSpeed:38}).textSpeed,52);
 assert.equal(upgradeReadingPreferences({textSpeed:0}).textSpeed,0);
 assert.equal(upgradeReadingPreferences({textSpeed:82}).textSpeed,82);
 assert.equal(upgradeReadingPreferences({}).textSpeed,52);
 assert.equal(upgradeReadingPreferences({textSpeed:38,readingPaceVersion:2}).textSpeed,38);
});
