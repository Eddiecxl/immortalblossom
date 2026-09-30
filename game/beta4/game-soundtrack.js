// User-supplied recordings. The launcher intentionally uses soundtrack.js.
export const GAME_SOUNDTRACK=Object.freeze([
 {id:'luoxian-wish',title:'落仙 · 若还能见你',file:'luoxian/wish.mp3',scenes:['intro','title']},
 {id:'luoxian-battle',title:'落仙 · 打斗版',file:'luoxian/battle.mp3',scenes:['intro','title','game','danger']},
 {id:'luoxian-music',title:'落仙 · 音乐版',file:'luoxian/music.mp3',scenes:['intro','title','game','danger']},
 {id:'luoxian-loop',title:'落仙 · loop版',file:'luoxian/loop.mp3',scenes:['game','danger']},
]);
const opening=Object.freeze(['luoxian-wish','luoxian-battle','luoxian-music']);
const journey=Object.freeze(['luoxian-loop','luoxian-music','luoxian-battle']);
export const GAME_PLAYLISTS=Object.freeze({intro:opening,title:opening,game:journey,danger:journey});
