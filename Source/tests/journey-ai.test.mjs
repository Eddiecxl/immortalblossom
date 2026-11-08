import test from 'node:test';import assert from 'node:assert/strict';import {createGameState,migrateGameState} from '../../game/game-state.js';
import {bindJourneyAi,journeyAiSettings} from '../../game/journey-ai.js';
test('provider choice survives migration and cannot be replaced by global settings or another bind',()=>{
 const state=createGameState('长生','ai',()=> 'route-lock');bindJourneyAi(state,'gemini');
 const loaded=migrateGameState(JSON.parse(JSON.stringify(state)),'ai');assert.equal(loaded.aiRoute.provider,'gemini');
 const settings=journeyAiSettings(loaded,{mode:'groq',preferred:'groq',forceCloudAssist:true,models:{gemini:'wrong-model'}});
 assert.equal(settings.mode,'gemini');assert.equal(settings.models.gemini,'gemini-3.8-flash');assert.equal(settings.forceCloudAssist,false);assert.throws(()=>bindJourneyAi(loaded,'groq'));
});
test('fresh journeys may choose independently and legacy saves are not silently bound by migration',()=>{
 const first=createGameState('长生','ai',()=> 'first'),second=createGameState('长生','ai',()=> 'second');bindJourneyAi(first,'groq');bindJourneyAi(second,'gemini');assert.notEqual(first.aiRoute.provider,second.aiRoute.provider);
 const legacy=createGameState('长生','ai',()=> 'legacy');assert.equal(migrateGameState(legacy,'ai').aiRoute,null);assert.equal(journeyAiSettings(legacy,{mode:'groq'}).mode,'groq');
});
