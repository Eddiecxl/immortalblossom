import test from 'node:test';
import assert from 'node:assert/strict';
test('already decoded native video is shown even when loadeddata preceded module startup',async()=>{
  const {bindMenuVideo}=await import('../../game/beta4/menu-video.js');
  const video=new EventTarget();video.readyState=4;video.error=null;
  const classes=new Set();const title={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
  bindMenuVideo(video,title);
  assert.ok(classes.has('video-ready'));
  video.error={code:3};video.dispatchEvent(new Event('error'));
  assert.ok(classes.has('video-failed'));assert.equal(classes.has('video-ready'),false);
  video.error=null;video.dispatchEvent(new Event('loadeddata'));
  assert.ok(classes.has('video-ready'));assert.equal(classes.has('video-failed'),false);
});
