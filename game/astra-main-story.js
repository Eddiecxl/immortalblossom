import {createGameState} from './game-state.js';
import {createAstraWorld} from './astra-world.js';
export const MAIN_STORY_SEED='luoxian-main-story-zhao-v1';
const stages=[['escape','柴门之外','先处理伤势，再决定怎样离开赵府。可交谈、查看行囊、走后院小路，也可正面交涉或改写局面。'],['foothold','异乡立足','在府外站稳脚跟：处理现有伤势，读一读贴身旧信，查清这具身体留下的来历。'],['cultivation','引气入身','先踏入炼气，再考虑远行。修炼或使用确有提升效果的物品均可；言出法随也能改写境界。'],['sect','山门之前','前往青玄宗，亲自面对入门的选择。也可以暂缓此事，在世间继续自己的路。']];
function quest(world,key){const row=stages.find(s=>s[0]===key);const id='main:'+key;if(world.quests[id])return world.quests[id];return world.quests[id]={id,title:row[1],summary:row[2],state:'active',mainStory:true,giverId:null,participants:['player'],targetLocationId:key==='sect'?'loc:qingxuan':world.player.locationId,primaryGoals:[row[2]],rewards:[],earnedRewards:[],lostRewards:[],followUpArcs:[],stateHistory:[],createdAt:world.minute,updatedAt:world.minute};}
export function createMainStoryState(name='顾长生',idFactory){
 const state=createGameState(name,'ai',idFactory),world=createAstraWorld(MAIN_STORY_SEED,name),p=world.player;
 const start=world.locations['loc:gumanor'];start.name='赵府柴房';start.population=35;start.risk=8;
 p.locationId=start.id;p.homeId=start.id;p.background='servant';p.age=20;p.health=72;p.maxHealth=100;p.physicalCondition='injured';p.wealth=18;p.inventory=[];p.spirit=30;p.maxSpirit=30;
 for(const item of Object.values(world.items))if(item.ownerId==='player'){delete world.items[item.id];}
 const supplies=[['herb','止血草','item:herb:standard',2,'贴身药包里剩下的止血草，可处理现有伤势。'],['staff','练武木棍','item:training-staff:serviceable',1,'柴堆边的旧木棍，可装备后用于近身交锋。'],['letter','贴身旧信','item:family-letter:copy',1,'旧信写着：若在赵府待不下去，先到临溪镇落脚。你姓顾，家里的事不必向府中人交底；活下来，再自己决定往后的路。']];
 for(const[key,itemName,templateId,quantity,description]of supplies){const id='item:main-'+key;world.items[id]={id,name:itemName,templateId,quantity,description,ownerId:'player',locationId:start.id,durability:100,destroyed:false,creationHistory:[{minute:world.minute,source:'主世界线的真实起始行囊'}],transferHistory:[]};p.inventory.push(id);}
 const lin=world.characters['npc:lin-xiaoman'];Object.assign(lin,{age:20,sex:'female',locationId:start.id,homeId:'loc:linhome',travel:null,occupation:'府中杂役',role:'servant',personality:'mischievous',physicalCondition:'healthy',currentGoals:['先离开赵府，找回自己的生活'],goals:['先离开赵府，找回自己的生活'],currentPlan:{type:'attend_scene',until:480},lastPlanBucket:18});
 const zhao=world.characters['npc:cast-0'];if(zhao){
  if(world.factions[zhao.factionId])world.factions[zhao.factionId].memberIds=world.factions[zhao.factionId].memberIds.filter(id=>id!==zhao.id);
  Object.assign(zhao,{name:'赵天霸',age:42,sex:'male',alive:true,locationId:start.id,homeId:start.id,factionId:null,travel:null,occupation:'府中管事',role:'guard',personality:'proud',goals:['看管赵府，查清柴房里的动静'],currentGoals:['让顾长生说明先前发生的冲突'],schedule:[{at:'day',activity:'看管府中事务'}],cultivation:{realm:'qi_refining',level:2},health:100,maxHealth:100,physicalCondition:'healthy',currentPlan:{type:'attend_scene',until:480},lastPlanBucket:1});}
 for(const npc of Object.values(world.characters))if(![lin.id,zhao?.id].includes(npc.id)&&npc.locationId===start.id)npc.locationId='loc:qinghe';
 world.edges=world.edges.filter(e=>e.from!==start.id&&e.to!==start.id);
 for(const[to,minutes]of [['loc:linxi',20],['loc:linhome',10]])for(const[from,destination]of [[start.id,to],[to,start.id]])world.edges.push({id:'main-road:'+from+':'+destination,from,to:destination,minutes,risk:4,closed:false,distance:2});
 // Keep geography and actual edge indexes in agreement after the authored start.
 for(const loc of Object.values(world.locations))loc.edges=world.edges.filter(e=>e.from===loc.id).map(e=>e.id);
 world.eventQueue=world.eventQueue.filter(e=>e.id!=='event:opening-local');
 world.flags.mainStory={id:MAIN_STORY_SEED,stage:'escape',startId:start.id,startedAt:world.minute};quest(world,'escape');
 state.astraWorld=world;state.story.location=start.name;state.player.hp=p.health;state.player.maxHp=p.maxHealth;state.player.gold=p.wealth;state.inventory.items=Object.fromEntries(supplies.map(([,n,,q])=>[n,q]));state.worldState.sceneLabel=start.name;state.director.sceneGoal=stages[0][2];return state;
}
export function mainStoryOpening(world){
 if(!world.flags.mainStory)return null;
 const scene=world.flags.playerScene;if(scene){scene.pressure='林小满在问先处理伤势还是离开，玩家尚未作决定；赵天霸在门外，不能忽略他的存在';scene.lastBeat='你衣襟里有药。要先用药，还是趁后院的小路还空着离开？';scene.observedScene='主角在赵府柴房醒来，身上带伤，旧信与药草还在自己衣襟里；林小满进门，管事赵天霸在门外催促。';scene.priorEvents='开场仅确定这些亲眼事实；未发生交付、接受委托或出门。';}
 return [{type:'narr',text:'冷雨沿瓦缝落在手背上。我在柴草间睁开眼，先想起了另一世的街灯，再听见木门外有人踢了一脚。陌生身体上的伤痛拉回知觉：我叫顾长生，在赵府做事，今天却被丢进了柴房。究竟为何挨打，残碎的记忆还没拼全。'},
 {type:'narr',text:'门被推开一线，林小满侧身挤进来，反手扶住将要碰响的门板。她看见我睁眼，松了口气，没有立刻伸手拉人。衣襟里的药包和旧信还硌着胸口，柴堆边一根旧木棍就在伸手可及之处。'},
 {type:'dlg',name:'赵天霸',text:'里头醒了没有？醒了就出来，把话说清楚。'},
 {type:'sys',text:'听得见吧？先别出声，我在你脑子里。你确实换了个世界。言出法随是你的本事，明确发动便会成真，牵动的因果另算；但不必事事靠它。眼下药还在身上，命只有这一条。'},
 {type:'narr',text:'林小满往门外瞥了一眼，又回过头来，把声音压低。她没有替我拆药包，也没替我答应出去。'},
 {type:'dlg',name:'林小满',text:'我叫林小满。你衣襟里还有药，先用一点？后院有条去临溪镇的小路。你想先听我说，还是现在就想办法离开？'}];
}
export function reconcileMainStory(world){
 const story=world.flags?.mainStory;if(!story||world.terminal?.ended||!world.player.alive||world.player.travel)return;
 const p=world.player,ready={escape:p.locationId!==story.startId,foothold:p.locationId!==story.startId&&p.health>=p.maxHealth*.8&&p.knowledge?.includes('item:main-letter'),cultivation:p.cultivation?.realm!=='none',sect:p.locationId==='loc:qingxuan'};
 for(let pass=0;pass<4;pass++){
  const key=story.stage,q=world.quests['main:'+key];if(!q||!ready[key]||!['active','mutated'].includes(q.state))break;
  q.state='completed';q.updatedAt=world.minute;q.stateHistory.push({from:'active',to:'completed',minute:world.minute,cause:'实际世界状态达到目标'});
  world.history.push({id:q.id+':completed',type:'quest_state',minute:world.minute,locationId:p.locationId,actors:['player'],summary:q.title+'已达成。',playerWitnessed:true,major:true});
  const next=stages[stages.findIndex(s=>s[0]===key)+1];story.stage=next?.[0]||'open-world';if(next)quest(world,next[0]);else break;
 }
}
