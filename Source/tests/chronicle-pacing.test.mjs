import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextPlayback,upgradeReadingPreferences} from '../../game/beta4/chronicle-player.js';

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
