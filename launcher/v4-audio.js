import {createScore} from '../game/beta4/audio.js';
// RuntimeHost also loads this page in a hidden WebView without the native bridge.
// Only the visible native launcher (or an explicit browser preview) may play.
const native=window.lxNative===true,preview=!native&&new URLSearchParams(location.search).get('audioPreview')==='1';
const audio=createScore(()=>{try{return {master:75,music:35,sfx:65,muteBackground:true,...JSON.parse(localStorage.getItem('luoxian_beta3_settings')||'{}')};}catch{return {master:75,music:35,sfx:65,muteBackground:true};}},{blocked:true});
window.lxLauncherAudio=audio;
audio.setScene('title');
const play=document.getElementById('launcherMusicToggle'),next=document.getElementById('launcherMusicNext'),title=document.getElementById('launcherTrack');
let started=false,locked=true,statusRevision=0;
function sync(){const playing=!locked&&started&&audio.isEnabled();if(play){play.disabled=locked;play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',locked?'游戏运行中，启动器音乐已停用':playing?'暂停音乐':'播放音乐');}if(next)next.disabled=locked;}
async function setGameActive(active){locked=!(native||preview)||active;audio.setBlocked(locked);sync();if(!locked&&audio.isEnabled()){await audio.unlock();started=true;sync();}}
audio.subscribe(track=>{if(track&&title)title.textContent=track.title;started=true;sync();});
if(play){play.onpointerdown=e=>e.stopPropagation();play.onclick=async()=>{if(locked)return;const playing=audio.isEnabled()&&audio.getPlaybackState().contextState==='running';audio.setEnabled(!playing);started=true;await audio.unlock();sync();};}
if(next)next.onclick=async()=>{if(locked)return;started=true;audio.setEnabled(true);await audio.unlock();await audio.nextTrack();sync();};
let hover=0;document.addEventListener('pointerover',e=>{if(e.target.closest('button')&&Date.now()-hover>120){audio.sfx('hover');hover=Date.now();}});
document.addEventListener('click',e=>{if(e.target.closest('button'))audio.sfx('click');});
window.addEventListener('lx:game-active',e=>{if(!native)return;statusRevision++;void setGameActive(e.detail?.active!==false);});
sync();
if(native){
 const revision=statusRevision;
 Promise.resolve().then(()=>window.nativeAction('game-status')).then(status=>{if(revision===statusRevision)void setGameActive(status?.active!==false);}).catch(()=>{if(revision===statusRevision)void setGameActive(true);});
}else if(preview)void setGameActive(false);
