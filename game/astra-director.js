// The director exposes the current playable exchange. Background simulation owns
// actual world events; quiet dialogue must not manufacture repeated road alerts.
import {selectAstraHandoff} from './astra-handoff.js';
import {reconcilePlayerScene} from './astra-player-scene.js';
export function directAstraScene(world,events=[],options={}){
 reconcilePlayerScene(world);
 const handoff=selectAstraHandoff(world,{...options,events});
 return {hook:handoff?.text||'',event:null,handoff};
}
