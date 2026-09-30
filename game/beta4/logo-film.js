// A drawn logo ceremony, followed by the existing animated menu film.
export const LOGO_FILM_DURATION=8200;
export function logoFilmMarkup(){
 const dust=Array.from({length:72},(_,i)=>'<i style="--x:'+((i*137)%100)+'%;--y:'+((i*83)%100)+'%;--delay:'+(i%13*.13)+'s;--drift:'+((i%2?1:-1)*(20+i%35))+'px"></i>').join('');
 return '<div class="film-darkness" aria-hidden="true"></div><div class="film-light" aria-hidden="true"></div>'+
 '<div class="film-dust" aria-hidden="true">'+dust+'</div>'+
 '<svg class="film-sigil" viewBox="0 0 1000 700" aria-hidden="true">'+
 '<defs><linearGradient id="filmGold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#836337"/><stop offset=".48" stop-color="#fff0ba"/><stop offset="1" stop-color="#bd8b42"/></linearGradient></defs>'+
 '<g class="film-ink" fill="none" stroke="#304643" stroke-linecap="round"><path stroke-width="22" d="M260 420 Q180 170 478 105 Q792 88 812 355 Q810 590 505 604 Q295 620 230 450"/><path stroke-width="6" d="M261 418 Q226 200 480 143 Q731 125 763 340 Q791 534 558 565"/></g>'+
 '<g class="film-orbits" fill="none" stroke="url(#filmGold)"><ellipse cx="500" cy="350" rx="275" ry="100" transform="rotate(-32 500 350)"/><ellipse cx="500" cy="350" rx="275" ry="100" transform="rotate(32 500 350)"/><circle cx="500" cy="350" r="220" stroke-dasharray="2 18"/><circle cx="500" cy="350" r="178"/><path d="M500 139 L683 350 L500 561 L317 350 Z"/><path d="M500 80 V164 M500 536 V620 M230 350 H306 M694 350 H770"/></g>'+
 '<g class="film-runes" fill="#e0bc78"><path d="M500 112 l7 11 -7 11 -7 -11z"/><path d="M738 350 l11 -7 11 7 -11 7z"/><path d="M500 566 l7 11 -7 11 -7 -11z"/><path d="M240 350 l11 -7 11 7 -11 7z"/></g></svg>'+
 '<div class="film-logo"><div class="film-seal" aria-hidden="true"><span>仙</span></div><p class="film-kicker">一念落笔 · 万象成仙</p><h2 class="film-title">落仙</h2><p class="film-english">LUO XIAN · IMMORTAL JOURNEY</p><div class="film-divider"></div><p class="film-verse">若还能见你 · 此世由你续写</p></div>'+
 '<div class="film-flare" aria-hidden="true"></div><div class="film-grain" aria-hidden="true"></div><div class="film-matte" aria-hidden="true"></div>';
}
