// Presentation only: keep the already committed turn intact while the player
// reads. No clocks, combat, AI request or save is advanced here.
export function upgradeReadingPreferences(settings={}){
 const next={...settings};
 if(next.textSpeed==null||!next.readingPaceVersion&&next.textSpeed===38)next.textSpeed=52;
 next.readingPaceVersion=2;return next;
}
export function createTextPlayback(text,{interval=52}={}){
 const chars=Array.from(String(text||''));let count=0,last=null,credit=0,remaining=0;
 const pause=c=>/[。！？!?…\n]/u.test(c)?6:/[，、；：,;:]/u.test(c)?3:1;
 return {advance(now,{paused=false,skip=false}={}){
  if(skip||interval<=0){count=chars.length;return {text:chars.join(''),done:true};}
  const elapsed=last==null?0:Math.max(0,Math.min(64,now-last));last=now;
  if(!paused){
   credit+=elapsed;
   if(!count&&chars.length){count=1;remaining=interval*pause(chars[0]);}
   let emitted=0;
   while(count<chars.length&&credit>=remaining&&emitted<2){credit-=remaining;remaining=interval*pause(chars[count++]);emitted++;}
  }
  return {text:chars.slice(0,count).join(''),done:count>=chars.length};
 }};
}

export function createChroniclePlayer({target,status,skipButton,pauseButton,latestButton,
 getSpeed=()=>52,getReduced=()=>false,getPlayerName=()=> '顾长生',onCancel=()=>{},frame=requestAnimationFrame}){
 const doc=target.ownerDocument;let writing=false,skipping=false,paused=false,following=true,followFrame=0,lastTop=target.scrollTop;
 function controls(){
  skipButton.hidden=!writing;pauseButton.hidden=!writing;
  pauseButton.textContent=paused?'继续':'暂停';pauseButton.setAttribute('aria-pressed',String(paused));
  latestButton.hidden=following;latestButton.textContent=writing?'继续阅读 ↓':'回到最新 ↓';
  status.textContent=!following?'正在回看 · 新文字已暂停':paused?'阅读已暂停':writing?'一字一息 · 正在展开':'轮到你了 · 静候落笔';
 }
 function follow(){
  if(!following||followFrame)return;
  followFrame=frame(function step(){
   followFrame=0;if(!following)return;
   const goal=Math.max(0,target.scrollHeight-target.clientHeight),distance=goal-target.scrollTop;
   if(distance>1){target.scrollTop=getReduced()?goal:target.scrollTop+Math.max(1,distance*.28);lastTop=target.scrollTop;followFrame=frame(step);}
  });
 }
 function holdHistory(){following=false;controls();}
 target.addEventListener('wheel',e=>{if(e.deltaY<0)holdHistory();},{passive:true});
 target.addEventListener('keydown',e=>{if(['PageUp','Home','ArrowUp'].includes(e.key))holdHistory();});
 let touchY=null;target.addEventListener('touchstart',e=>{touchY=e.touches[0]?.clientY;},{passive:true});
 target.addEventListener('touchmove',e=>{if(touchY!=null&&e.touches[0]?.clientY>touchY+3)holdHistory();},{passive:true});
 target.addEventListener('scroll',()=>{
  if(target.scrollTop<lastTop-3)holdHistory();
  lastTop=target.scrollTop;
  if(!writing&&target.scrollHeight-target.clientHeight-target.scrollTop<6){following=true;controls();}
 },{passive:true});
 function latest(){following=true;paused=false;controls();follow();}
 latestButton.onclick=latest;pauseButton.onclick=()=>{paused=!paused;controls();};
 skipButton.onclick=()=>{skipping=true;paused=false;controls();};
 function makeRow(row){
  const article=doc.createElement('article');article.className=row.type==='dlg'?`dialogue-line${row.player?' is-player':''}`:`story-block ${row.type||'narr'}`;
  if(row.type==='dlg'){
   const name=doc.createElement('b'),badge=doc.createElement('small');name.append(doc.createTextNode(row.player?getPlayerName():row.name||'未识之人'));
   badge.textContent=row.player?'此言由你':'山河回响';name.append(badge);article.append(name);
  }
  article.append(doc.createElement('p'));return article;
 }
 function clearPending(){target.querySelector('#pendingSpeech')?.remove();}
 function pendingSpeech(text){
  const exact=String(text||'').trim();if(!exact){clearPending();return;}
  let article=target.querySelector('#pendingSpeech');
  if(article?.dataset.speech===exact){latest();return;}
  clearPending();article=makeRow({type:'dlg',player:true,text:exact});article.id='pendingSpeech';article.dataset.speech=exact;
  article.classList.add('pending-speech');article.setAttribute('aria-busy','true');article.style.animation='none';
  article.querySelector('p').textContent=exact;article.querySelector('small').textContent='此言由你 · 等待回应';
  const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='停止等待';cancel.onclick=onCancel;article.append(cancel);
  target.append(article);latest();
 }
 async function reveal(p,text){
  const play=createTextPlayback(text,{interval:Number(getSpeed())});
  await new Promise(resolve=>{
   function tick(now){const next=play.advance(now,{paused:paused||!following||doc.hidden,skip:skipping});if(p.textContent!==next.text)p.textContent=next.text;follow();if(next.done)resolve();else frame(tick);}
   frame(tick);
  });
 }
 async function breath(ms){
  let last=null,elapsed=0;await new Promise(resolve=>{function tick(now){if(last!=null&&!paused&&following&&!doc.hidden)elapsed+=Math.min(64,now-last);last=now;if(skipping||elapsed>=ms)resolve();else frame(tick);}frame(tick);});
 }
 async function render(rows,{animate=true}={}){
  writing=animate;skipping=false;paused=false;controls();
  try{
   for(const row of rows){
    const pending=target.querySelector('#pendingSpeech');
    const promoted=row.player&&pending?.dataset.speech===row.text;
    const article=promoted?pending:makeRow(row);
    if(promoted){article.removeAttribute('id');article.removeAttribute('aria-busy');article.classList.remove('pending-speech');article.querySelector('button')?.remove();article.querySelector('small').textContent='此言由你';}
    const p=article.querySelector('p');
    if(!animate||row.player||getReduced())article.style.animation='none';
    if(!promoted)target.append(article);
    if(!animate||row.player){p.textContent=row.text;follow();continue;}
    article.classList.add('is-revealing');await reveal(p,row.text);article.classList.remove('is-revealing');
    if(!skipping&&Number(getSpeed())>0)await breath(row.type==='dlg'?320:220);
   }
  }finally{writing=false;paused=false;controls();follow();}
 }
 return {render,pendingSpeech,clearPending,followLatest:latest,isWriting:()=>writing,skip:()=>{skipping=true;paused=false;controls();}};
}
