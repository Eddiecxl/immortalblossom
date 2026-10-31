import test from 'node:test';import assert from 'node:assert/strict';
import {createMainStoryState,reconcileMainStory,MAIN_STORY_SEED} from '../../game/astra-main-story.js';
import {createAstraOpening} from '../../game/astra-opening.js';
test('new main journeys share one world seed but independent save IDs and an actionable opening',()=>{
 const a=createAstraOpening(createMainStoryState('顾长生',()=> 'one')),b=createAstraOpening(createMainStoryState('顾长生',()=> 'two'));
 assert.notEqual(a.state.journeyId,b.state.journeyId);assert.equal(a.state.astraWorld.seed,MAIN_STORY_SEED);
 assert.equal(a.state.astraWorld.player.locationId,b.state.astraWorld.player.locationId);assert.equal(a.state.story.location,'赵府柴房');
 assert.equal(a.turn.blocks.at(-1).type,'dlg');assert.match(a.turn.blocks.at(-1).text,/药|离开/u);
 assert.ok(a.state.astraWorld.items['item:main-herb']);assert.equal(a.state.astraWorld.quests['main:escape'].state,'active');
});
test('main objectives follow real arrival, reading and cultivation and do not grant fake rewards or pull back the player',()=>{
 const w=createMainStoryState().astraWorld,before=w.player.wealth;
 w.player.travel={to:'loc:linxi'};reconcileMainStory(w);assert.equal(w.flags.mainStory.stage,'escape');
 w.player.travel=null;w.player.locationId='loc:linxi';reconcileMainStory(w);assert.equal(w.quests['main:escape'].state,'completed');assert.equal(w.flags.mainStory.stage,'foothold');
 w.player.health=w.player.maxHealth;w.player.knowledge.push('item:main-letter');reconcileMainStory(w);assert.equal(w.flags.mainStory.stage,'cultivation');
 w.player.cultivation.realm='tribulation';reconcileMainStory(w);assert.equal(w.flags.mainStory.stage,'sect');assert.equal(w.player.wealth,before);assert.equal(w.player.locationId,'loc:linxi');
 const n=w.history.length;reconcileMainStory(w);assert.equal(w.history.length,n);
});
