export function bindMenuVideo(video,title){
 if(!video||!title)return;
 const sync=()=>{
  if(video.error){title.classList.remove('video-ready');title.classList.add('video-failed');}
  else if(video.readyState>=2){title.classList.remove('video-failed');title.classList.add('video-ready');}
 };
 video.addEventListener('error',sync);video.addEventListener('loadeddata',sync);
 // Cached media can decode before deferred modules execute in native WebView.
 sync();
}
