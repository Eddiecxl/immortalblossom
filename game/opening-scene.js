import {initializeOpening,fateHash} from './play-contract.js';
import {NPCS} from './game-data.js';
import {commitJourneyWorld} from './journey-world.js';
export function createSeededOpening(source){
 const state=initializeOpening(source),o=state.journeyWorld.opening;const seed=state.journeyWorld.seed;
 const memories=['最后记得的是深夜路口的刹车声，此刻掌心却沾着药草与泥土。','昨夜还亮着的电脑屏幕忽然远得像上辈子，陌生衣袖下，伤口真实地发疼。','脑海里残留着雨中的公交站牌，眼前却没有电线，只有旧木梁与陌生山影。'];
 const appearances=['林小满蹲在身旁，把浸凉的布巾从顾长生额头取下。她见他睁眼，才终于松开紧攥的衣角。','一只倾斜的药篮挡住了光。林小满扶住险些滚落的药瓶，低下头，仔细确认顾长生已经清醒。','顾长生撑起身时，林小满正替他拢好衣襟。她把水囊放在伸手可及的地方，停下来等他开口。','林小满握着一截未点燃的药香守在一旁。顾长生轻轻动了动，她立刻俯身，压低了声音。'];
 const aim=o.location==='青石镇'?'先问清是谁救了自己，再商量如何避开赵府的盘查，找到暂时落脚之处。':o.location==='赵府杂役区'?'先向林小满问清身份与处境，再选择检查随身线索，或寻找通往青石镇的出口。':'先问清柴门外的情况，再选择查看线索，或与林小满商量离开赵府的办法。';
 const blocks=[{type:'narr',text:`${o.period[0]}，${o.weather}。顾长生在${o.location}的${o.scene}醒来。${memories[fateHash(seed+':memory')%memories.length]}两段人生在脑海里短促相撞：他确实穿越到了这个世界。`},{type:'narr',text:appearances[fateHash(seed+':entrance')%appearances.length]},{type:'dlg',name:'林小满',text:`你终于醒了。我是林小满，药铺的学徒。${o.cause.replace(/[。！？]$/u,'')}。先别急着逞强，有什么想问的，你就问我。`},{type:'sys',text:`系统已接续。你可以先问“这是哪里，我们现在该怎么办？”，也可以自己查看周围。眼前目标：${aim}言出法随可以改变现实，但会付出代价。`}];
 state.worldState.presentActorIds=['npc:lin-xiaoman'];state.worldState.origin=`顾长生带着前世记忆穿越，在${o.location}的${o.scene}苏醒，首次遇见林小满。`;
 const lin=NPCS['林小满'];state.memory.entities[lin.id]={id:lin.id,kind:'npc',name:'林小满',status:'alive',location:o.location,purpose:lin.role,knownFactIds:['fact:authored:lin-xiaoman:identity'],facts:['fact:authored:lin-xiaoman:identity'],traits:[],lastSeenTurn:0};
 state.memory.facts=state.memory.facts.filter(f=>f.id!=='canon:origin:transmigrator');state.memory.facts.push({id:'canon:origin:transmigrator',subjectId:'player:gu-changsheng',predicate:'origin',object:state.worldState.origin,locked:true,sourceTurnId:'opening:seed',createdAtTurn:0});
 state.codex.characters=[...new Set([...state.codex.characters,'林小满'])];state.director.sceneGoal=aim;state.story.flags.seededOpening=true;
 state.campaign.opening={location:o.location,manner:'林小满已经救下并陪伴主角，双方已经见面，直接接续玩家的问题，禁止重演苏醒或进门。',firstActorId:lin.id,origin:state.worldState.origin};
 commitJourneyWorld(state,{blocks,memory:{facts:[]}},'穿越苏醒，首次遇见林小满');
 return {state,turn:{id:'opening:seed',kind:'world',userText:'',speech:'',actionText:'',provider:'authored-opening',model:'seeded',blocks,createdAt:state.updatedAt}};
}
