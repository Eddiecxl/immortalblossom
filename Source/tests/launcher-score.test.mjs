import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function launcherSettings(raw) {
 const source=fs.readFileSync(new URL('../../launcher/v4-audio.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 let getSettings;
 vm.runInNewContext(source,{
  createScore:get=>{getSettings=get;return {setScene(){},isEnabled:()=>true,subscribe(){}};},
  localStorage:{getItem:()=>raw},window:{addEventListener(){}},location:{search:''},URLSearchParams,
  document:{getElementById:()=>null,addEventListener(){}},
 });
 return JSON.parse(JSON.stringify(getSettings()));
}

test('game music muted by default does not silence the separate launcher score',()=>{
 const raw=JSON.stringify({master:75,music:0,sfx:65,muteBackground:true});
 assert.equal(launcherSettings(raw).music,35);
 assert.equal(JSON.parse(raw).music,0);
});
test('launcher score still respects shared master mute and background preference',()=>{
 const settings=launcherSettings(JSON.stringify({master:0,music:90,sfx:20,muteBackground:false}));
 assert.equal(settings.master,0);assert.equal(settings.sfx,20);assert.equal(settings.muteBackground,false);assert.equal(settings.music,35);
});
test('launcher score defaults remain usable with missing or invalid game preferences',()=>{
 for(const raw of [null,'invalid'])assert.equal(launcherSettings(raw).music,35);
});
