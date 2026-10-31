// Run explicitly with LX_PLAYWRIGHT_MODULE. It exercises the real DOM and RAF
// renderer without AI, player saves, boot cinematics or provider quota.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const playwright=process.env.LX_PLAYWRIGHT_MODULE;if(!playwright)throw Error('LX_PLAYWRIGHT_MODULE required');
const {chromium}=await import(pathToFileURL(playwright).href);
const output=path.resolve(process.env.LX_BROWSER_OUT||path.join(root,'../Verification/v424-chronicle-browser'));await fs.mkdir(output,{recursive:true});
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/game/beta4/chronicle.css"><style>body{background:#081c29;color:#eee;font:18px sans-serif;padding:24px;--ui-scale:1}#storyScroll{width:720px;height:230px;border:1px solid #cbb273;overflow:auto}.reading-toolbar{width:770px;justify-content:flex-start;padding:16px}button{color:#efd79e;background:#183849;border:1px solid #cbb273}article p{white-space:pre-wrap}article b small{font-size:12px;margin-left:16px}</style><h2>行记 · 阅读验证</h2><div class="reading-toolbar"><span id="status"></span><button id="latest" hidden></button><button id="pause" hidden></button><button id="skip" hidden>展开全文</button></div><div class="story-scroll" id="storyScroll" tabindex="0"></div><script type="module">import{createChroniclePlayer}from'/game/beta4/chronicle-player.js';window.speed=52;window.reduced=false;const el=id=>document.getElementById(id);window.chronicle=createChroniclePlayer({target:el('storyScroll'),status:el('status'),skipButton:el('skip'),pauseButton:el('pause'),latestButton:el('latest'),getSpeed:()=>window.speed,getReduced:()=>window.reduced,getPlayerName:()=> '江行舟'});</script>`;
const server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!target.startsWith(root+path.sep))throw Error('path');res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':'text/css');res.end(await fs.readFile(target));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
const long='她把问题留给了我，等着我回应。现在并没有人替我决定下一步。'.repeat(7);
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.chronicle);
 await page.evaluate(()=>chronicle.render(Array.from({length:5},(_,i)=>({type:'narr',text:'已发生的第'+i+'段往事。'.repeat(18)})),{animate:false}));await page.waitForTimeout(400);
 await page.evaluate(()=>{chronicle.pendingSpeech('我就在这里，先说你的事。');window.pending=document.getElementById('pendingSpeech');});
 await page.evaluate(text=>{window.done=false;window.play=chronicle.render([{type:'dlg',player:true,text:'我就在这里，先说你的事。'},{type:'dlg',name:'林小满',text}]).then(()=>window.done=true);},long);
 await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.pending===document.querySelector('.is-player')),true,'player bubble must retain its DOM identity');
 assert.equal(await page.locator('.is-player p').innerText(),'我就在这里，先说你的事。');assert.equal(await page.locator('#pendingSpeech').count(),0);assert.equal(await page.locator('.is-player').count(),1);assert.match(await page.locator('.is-player b').innerText(),/江行舟/);
 const beforePause=await page.locator('.is-revealing p').innerText();assert.ok(beforePause.length>0&&beforePause.length<long.length,'new NPC words should still be revealing');
 await page.locator('#pause').click();const paused=await page.locator('.is-revealing p').innerText();await page.waitForTimeout(350);assert.equal(await page.locator('.is-revealing p').innerText(),paused,'pause should hold unread text');
 await page.locator('#pause').click();await page.waitForTimeout(180);
 await page.locator('#storyScroll').hover();await page.mouse.wheel(0,-350);await page.waitForTimeout(150);
 const held=await page.locator('.is-revealing p').innerText(),scroll=await page.locator('#storyScroll').evaluate(n=>n.scrollTop);await page.waitForTimeout(350);
 assert.equal(await page.locator('.is-revealing p').innerText(),held,'reading history must pause new text');assert.ok(await page.locator('#storyScroll').evaluate(n=>n.scrollTop)<=scroll+2,'history must not be pulled down');assert.equal(await page.locator('#latest').isVisible(),true);
 await page.screenshot({path:path.join(output,'history-paused.png')});
 await page.locator('#latest').click();await page.waitForTimeout(400);assert.ok((await page.locator('.is-revealing p').innerText()).length>held.length,'latest resumes from the same letter');
 await page.locator('#skip').click();await page.waitForFunction(()=>window.done);assert.equal(await page.locator('.dialogue-line:not(.is-player) p').innerText(),long);
 await page.evaluate(()=>{window.reduced=true;window.done=false;window.play=chronicle.render([{type:'narr',text:'减少动态并不代表跳过全部文字，玩家仍然可以按自己的节奏阅读。'}]).then(()=>window.done=true);});await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.done),false,'reduced motion retains paced reading');
 await page.locator('#skip').click();await page.waitForFunction(()=>window.done);await page.waitForTimeout(250);
 await page.screenshot({path:path.join(output,'finished.png')});assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,playerNodePreserved:true,pauseAndHistoryHold:true,smoothFollowResumed:true,reducedMotionPaced:true,errors},null,2));console.log(JSON.stringify({passed:true,output}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
