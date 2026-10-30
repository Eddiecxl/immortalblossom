import {seedHash} from './astra-seed.js';

const clean=value=>String(value||'').trim().slice(0,420);
const present=(w,n)=>n?.alive&&!n.travel&&!w.player.travel&&n.locationId===w.player.locationId;
const playable=w=>w.player?.alive!==false&&w.player.health>0&&!w.terminal?.ended;

// These are seeded situations, not completed quests or grants. The request is
// real and recorded; the player's answer and all consequences remain open.
const encounters=[
 {kind:'awakening',pressure:'陌生人正在确认主角是否清醒',
  scene:'一只手停在我的额前，像是正要试探鼻息。见我睁眼，面前的姑娘猛地缩回手，随即松了口气。她没有立刻扶我，也没离开，只半蹲着，与我保持着能说话的距离。',
  before:'她伸出两根手指在我面前晃了晃，原本准备说的话又咽了回去，换成一句更慢的询问。',
  line:'能听见吗？我叫林小满。先别急着起来——是哪里不舒服，还是记不清自己怎么到这儿了？'},
 {kind:'interrupted_departure',pressure:'正准备离开的人临时邀主角搭伴，是否同行尚未决定',
  scene:'一名姑娘从近旁走过，听见动静又回了头。她本来已经转过身，却在看见我后停下，像是临时改了主意。鞋尖换了个方向，人也折回来，直接停在了能与我说话的地方。',
  before:'她看了看前方，又把目光转回来，主动报了名字。没有替我拿东西，更没有拉着我走，只把一个临时起意的邀约递了过来。',
  line:'我叫林小满，正准备走。一个人路上也没个人说话——你要往哪儿去？若顺路，搭个伴？'},
 {kind:'mistaken_identity',pressure:'对方认错人，正在等主角澄清身份',
  scene:'“可算找到你了！”一名姑娘径直来到近前，几句话差点一齐冲出口。等她看清我的脸，声音却忽然断了，迈出的脚也停在原处。那份理直气壮褪得极快，只剩下一个认错人的人和她来不及收回的目光。',
  before:'那点熟络从她脸上褪去，留下的却不全是戒备，还有几分认错人的尴尬。她轻轻咳了一声，先报了自己的名字。',
  line:'我是林小满……认错人了，抱歉。你跟我要找的人真有几分像。你是这里的人，还是刚来的？'},
 {kind:'testing_awareness',pressure:'主角挡住了对方去路，对方等主角让开或说明来意',
  scene:'一双鞋停在近前。鞋的主人往左挪了挪，没过去，又往右试了一步，终于站定。一名姑娘抱起手臂看着我，脸上没有故作高深的神情，只有被挡了路的无奈。她抬手指向我身旁，指尖轻轻一偏。',
  before:'见我有了反应，她总算放下手，略微侧过身体，留出一条能错身而过的空隙。方才那点不耐烦还在，话却说得明明白白。',
  line:'借过一下？我叫林小满，不是什么值得你堵着路看的大人物。还是说，你找我有事？'},
 {kind:'offered_company',pressure:'对方主动提出暂时作伴，等待同意或拒绝',
  scene:'身旁有人轻轻拍了拍地面，先给我留出一块空处。那姑娘见我醒来，没有一口气追问，只把身子侧开，让出视线。她像是在等我弄清周围，又像是有话要说，几次开口都收住了。',
  before:'终于，她歪过头来，语气放轻了些；邀约已经递到面前，是否接住却还由我。',
  line:'叫我林小满就好。一个人忽然倒在这里，总不是小事。要不要先跟我说两句？还是你想一个人静静？'},
 {kind:'looking_for_help',pressure:'对方询问主角是否需要帮助，必须听完缘由再行动',
  scene:'“醒着就好。”近旁的姑娘把迈出去的那只脚收了回来，像是差一点就要跑去找人。她重新走到我面前，低头看了看，又在一步外停住。没有谁替我宣布平安，她显然还在等我自己开口。',
  before:'她伸手指了指自己，先报名字，再把语速放慢。刚才那份急切还压在声音里，却不再催促。',
  line:'林小满。方才差点去喊人了。你能说话吧？是需要我找人帮忙，还是先别惊动旁人？'},
 {kind:'awkward_first_meeting',pressure:'对方在等主角解释异常举止，关系尚未确定',
  scene:'近处的脚步迟疑了一下。一个姑娘弯下腰，本想叫醒我，正好与睁眼的我撞上视线。两个人之间静了片刻，她先往后挪开一点，把那份突如其来的局促藏进一个不太自然的笑里。',
  before:'她没有把这点尴尬变成责问，反倒抬手示意自己没有恶意。陌生人的第一句话就在此刻落到我身上。',
  line:'别这么看着我呀，我脸上又没写字。我叫林小满。你呢？还是说，你把我认成别的人了？'},
 {kind:'patient_witness',pressure:'目击者主动说明眼前经过，等主角接话',
  scene:'我睁眼时，旁边的人正盯着我的呼吸。她似乎数过不止一次，见到我终于有了反应，紧绷的肩头才慢慢松下来。她坐得不算近，也没有伸手碰我，只有目光一直没有挪开。',
  before:'她把想问的话理了理，最后先说了自己亲眼见到的那一段。声音不高，足够让我听清。',
  line:'我叫林小满。我来时你已经在这里，怎么喊都不应。之前发生什么，我没看见。现在呢，有哪里难受吗？'}
];

export function prepareOpeningScene(world,{fresh=false}={}){
 if(!fresh||!playable(world))return null;
 const npc=world.characters['npc:lin-xiaoman'];if(!npc?.alive)return null;
 // Initial placement, only before the first playable exchange. Never a save migration.
 npc.locationId=world.player.locationId;npc.travel=null;
 for(const id of npc.inventory||[])if(world.items[id]?.ownerId===npc.id)world.items[id].locationId=npc.locationId;
 world.eventQueue=world.eventQueue.filter(e=>e.type!=='lin_first_encounter'
   &&!(e.type==='npc_arrival'&&(e.payload?.actorId===npc.id||e.payload?.characterId===npc.id)));
 world.flags.encounterLinResolved=true;
 const variant=encounters[seedHash(world.seed,'playable-opening')%encounters.length];
 const scene={...variant,id:'opening:contact',actorId:npc.id,locationId:npc.locationId,
   observedScene:variant.scene,priorEvents:'相遇之前的具体经过未知；未记录救治、交付、承诺或持续时长',
   phase:'awaiting',state:'active',startedAt:world.minute,exchange:0,lastBeat:variant.line,
   previousInput:'',lastTurnId:null,options:['回应她眼前的问题','询问刚才发生的事','拒绝帮助或自行离开','用言出法随改变局面']};
 world.flags.playerScene=scene;return scene;
}

export function reconcilePlayerScene(world){
 const scene=world.flags?.playerScene;if(!scene||scene.state!=='active')return null;
 const actor=world.characters[scene.actorId];
 if(!playable(world)||world.player.travel||world.player.locationId!==scene.locationId
   ||world.locations[scene.locationId]?.destroyed||!present(world,actor)){
  scene.state='closed';scene.phase='interrupted';scene.closedAt=world.minute;
  scene.reason=!actor?.alive?'participant-dead':world.player.locationId!==scene.locationId||world.player.travel?'player-left':'participant-left';
  return null;
 }
 return scene;
}

export function beginPlayerSceneTurn(world,input,{turnId}={}){
 const scene=reconcilePlayerScene(world);if(!scene||scene.lastTurnId===turnId)return scene;
 scene.previousInput=clean([input?.speech,input?.action].filter(Boolean).join('\n'));
 scene.phase='responding';scene.exchange++;scene.lastTurnId=turnId;return scene;
}

export function rememberPlayerScene(world,blocks,{turnId,input}={}){
 if(!playable(world))return reconcilePlayerScene(world);
 let scene=reconcilePlayerScene(world);
 const lastDialogue=[...blocks].reverse().find(b=>b.type==='dlg'&&Object.values(world.characters).some(n=>present(world,n)&&n.name===b.name));
 const actor=lastDialogue&&Object.values(world.characters).find(n=>present(world,n)&&n.name===lastDialogue.name);
 if(actor&&(!scene||scene.actorId!==actor.id)){
  scene={id:`scene:${turnId}`,kind:'conversation',state:'active',phase:'awaiting',actorId:actor.id,
   locationId:world.player.locationId,startedAt:world.minute,exchange:1,options:[]};
  world.flags.playerScene=scene;
 }
 if(!scene)return null;
 // The accepted last beat replaces the opening question. Refusal/off-topic speech
 // stays as evidence for the next writer; no keyword accepts a quest or gift.
 const tail=blocks.filter(b=>['dlg','narr'].includes(b.type)&&!b.engineOwnedPlayerSpeech).slice(-2);
 if(tail.length){
  scene.lastBeat=clean(tail.map(b=>b.name?`${b.name}：${b.text}`:b.text).join('\n'));
  // Opening pressure explains a past encounter, not an objective that every
  // subsequent answer must drag the player back to completing.
  scene.pressure='接住玩家的新回应与刚发生的最后一拍；原先的提议不是必须完成的流程';
  scene.options=[];
 }
 scene.previousInput=clean([input?.speech,input?.action].filter(Boolean).join('\n'));
 scene.phase='awaiting';scene.lastTurnId=turnId;
 if(actor){
  const id=`scene-response:${turnId}:${actor.id}`;
  actor.memories||=[];
  if(!actor.memories.some(m=>m.id===id))actor.memories.push({id,eventId:turnId,minute:world.minute,
   locationId:world.player.locationId,summary:`${actor.name}对我说：“${clean(lastDialogue.text)}”`,source:'scene-response'});
  actor.memories=actor.memories.slice(-40);
  world.flags.conversation={npcId:actor.id,locationId:world.player.locationId,minute:world.minute};
 }
 return scene;
}

export function playerSceneHandoff(world){
 const scene=world.flags?.playerScene,actor=world.characters?.[scene?.actorId];
 if(!scene||scene.state!=='active'||!playable(world)||scene.locationId!==world.player.locationId
   ||world.locations[scene.locationId]?.destroyed||!present(world,actor))return null;
 return {kind:'encounter',subjectId:scene.id,targetId:actor.id,targetName:actor.name,locationId:scene.locationId,
  phase:scene.phase,pressure:scene.pressure||'承接刚才的交谈与行动',focus:scene.lastBeat,
  nextAction:'回应眼前刚发生的话或动作，也可以拒绝、改换话题或离开',
  previousInput:scene.previousInput||'',exchange:scene.exchange,options:scene.options||[],text:scene.lastBeat,
  ...(scene.observedScene?{encounterFacts:{startedAt:scene.startedAt,now:world.minute,
    observed:scene.observedScene,priorEvents:scene.priorEvents}}:{})};
}

// Population is broader than the named cast. Materialize one encountered resident
// per settled place, then keep that same person in the ledger forever. This is an
// encounter with an existing population, not a birth, resurrection or teleport.
export function ensureSceneResident(world,{arrival=false,turnId}={}){
 if(!playable(world)||world.player.travel)return null;
 const place=world.locations[world.player.locationId];
 if(!place||place.destroyed||place.closed||!(Number(place.population)>0))return null;
 let npc=Object.values(world.characters).find(n=>present(world,n));
 world.flags.sceneResidents||={};
 if(!npc){
  const existingId=world.flags.sceneResidents[place.id];
  if(existingId)return present(world,world.characters[existingId])?world.characters[existingId]:null;
  const value=seedHash(world.seed,'resident:'+place.id),id='npc:resident:'+place.id.replace(/^loc:/u,'');
  if(world.characters[id])return null;
  const surname=['许','周','郑','沈','陶','柳','石','何'][value%8];
  const given=['安','青禾','远','阿平','仲山','秋','怀生','小川'][Math.floor(value/8)%8];
  let name=surname+given;
  if(Object.values(world.characters).some(n=>n.name===name))name=surname+'老'+given;
  npc={id,name,origin:'population-encounter',alive:true,age:22+value%37,gender:value%2?'female':'male',species:'human',
   locationId:place.id,homeId:place.id,factionId:null,role:'local resident',occupation:['当地匠人','行脚商贩','当地居民'][value%3],
   cultivation:{realm:'none',level:0},physicalCondition:'healthy',personality:['patient','bold','cautious','generous'][value%4],
   goals:['maintain a livelihood'],currentGoals:['maintain a livelihood'],fears:[],attachments:[],family:{},
   relationships:{},inventory:[],wealth:5+value%31,secrets:[],knowledge:[],memories:[],
   travel:null,currentPlan:{type:'work'},injuries:[],questLinks:[],storyFlags:{},simulationImportance:'local',
   lastPlanBucket:Math.floor(world.minute/20)};
  world.characters[id]=npc;world.flags.sceneResidents[place.id]=id;
 }
 if(!arrival&&playerSceneHandoff(world))return npc;
 const id='scene:'+turnId;
 if(world.flags.playerScene?.id===id)return npc;
 const summary=arrival?`我抵达${place.name}时，${npc.name}就在近旁，正在处理自己的事情。`:`我在${place.name}注意到了近旁的${npc.name}。`;
 world.flags.playerScene={id,kind:arrival?'arrival':'encounter',state:'active',phase:'responding',actorId:npc.id,
  locationId:place.id,startedAt:world.minute,exchange:0,lastTurnId:turnId,lastBeat:summary,
  pressure:arrival?'突然抵达或现身打断了眼前人物的日常；写其实际反应，并留一个主角可回应的动作或问题':'人物已经注意到主角，接住招呼或当下动作',
  observedScene:summary,priorEvents:'主角还不知道此人的私事；没有发生过的交付、要求与共同过去不得补写',previousInput:'',options:[]};
 if(!world.history.some(e=>e.id===id))world.history.push({id,type:'scene_encounter',minute:world.minute,locationId:place.id,
  actors:['player',npc.id],summary,playerWitnessed:true});
 return npc;
}
