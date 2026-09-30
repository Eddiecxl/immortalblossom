// Views of existing Engine records, never new gameplay facts.
const occupations={leader:'掌事',physician:'医者',herbalist:'采药人',apothecary:'药师','apothecary apprentice':'药铺学徒',scholar:'读书人',escort:'镖师',guard:'守卫',merchant:'商人',courier:'信使',envoy:'使者',innkeeper:'客栈掌柜',clerk:'书吏',archivist:'藏书人',auctioneer:'拍卖师',farmer:'农人',fisher:'渔人',boatman:'船夫',hunter:'猎户',miner:'矿工',artisan:'匠人',alchemist:'丹师',formationist:'阵师',diviner:'卜者',beastkeeper:'驭兽人',disciple:'弟子',outlaw:'江湖客',thief:'窃贼','sect applicant':'求道者','examination candidate':'应试者','caravan member':'商队中人','childhood neighbor':'邻家姑娘','peaceful neighbor':'邻人','wealthy daughter':'世家姑娘','market stranger':'赶集的陌生人','rival claimant':'争取家族权益的人'};
const goals={'qualify as a healer':'学成医术','maintain her own livelihood':'维持自己的生计','earn admission on her own terms':'凭自己的本事入宗','pass the county examination':'通过县试','keep her family together':'让家人平安相聚','keep boat safe':'保住船只','find a safe refuge':'找一处安全落脚地','protect a herb patch':'照看药圃','choose her own future':'自己决定往后的路','open a small shop':'开一间自己的小店','recover an object owed to her family':'找回属于家人的物件','build reliable routes':'寻找可靠商路','open safe caravan routes':'开辟安全商路','escort merchant convoys':'护送商队','protect independent cultivators':'照应散修','pass examinations':'通过试选','complete a safe journey':'平安完成行程','protect assigned ward':'守住负责的地方','protect harvest':'保住收成','find rare medicine':'寻找稀有药材','recover a lost volume':'找回遗失的书卷','settle an old debt':'了结一笔旧债','clear a dangerous debt':'还清危及自身的债','earn a permanent trade place':'取得长期经营的位置','repair a failing seal':'修复失效的封印'};
const zh=value=>/\p{Script=Han}/u.test(String(value||''));
Object.assign(goals,{
 'guard buyer trust':'守住买家的信任','gain a senior post':'争取更高的职位','learn the trade':'学会谋生的本领','keep the inn solvent':'维持客栈的经营','protect family income':'保住家里的收入','keep autonomy':'保有自主权','keep a trusted route':'维护一条可靠路线','prevent a faction clash':'避免势力冲突','hold the river provinces':'守住沿河州郡','secure the northern passes':'稳住北方关隘','control marsh trade':'掌控沼泽商路','guard the sword tomb':'守护剑冢','control medicinal pill supply':'掌控丹药供给','breed spirit beasts':'培育灵兽','map celestial omens':'研究天象征兆','seal dangerous relics':'封存危险遗物','guard mountain passes':'守住山间关口','recruit hidden converts':'秘密招纳信众','recover forbidden remains':'寻回禁忌遗存','undermine orthodox control':'削弱正道的控制','secure clan inheritance':'保全家族传承','restore lost standing':'恢复失落的声望','defend hunting grounds':'守住猎场','tax river crossings':'收取渡口税','patrol border roads':'巡守边境道路','maintain upper-realm order':'维持上界秩序','guard the cycle of souls':'守护魂灵轮回','recover ancestral territory':'夺回祖地','track world fractures':'追查世界裂隙','confirm a troubling vision':'查明令人不安的预兆','protect sea tariffs':'维护海贸税收','train sword disciples':'培养剑修弟子','preserve orthodox rites':'维护正道仪轨','protect family estates':'保护家族产业','preserve healing trade':'守住医药行当','control auction houses':'掌控拍卖场','perfect a formula':'完善丹方','master a difficult craft':'掌握艰深技艺','bond with a difficult beast':'与难驯灵兽建立联系','earn sect advancement':'争取宗门晋升','stabilize herb prices':'稳定药材价格','earn a clinic licence':'争取开设医馆的资格','expand blood rites':'扩张血祭仪式','build a quiet household':'建立安稳的家庭','maintain the crossing':'维持渡口运作','keep family supplied':'维持家人的生活所需','survive the next shift':'平安熬过下一班劳作'
});
export const npcRoleLabel=npc=>occupations[npc?.occupation]||occupations[npc?.role]||(zh(npc?.occupation)?npc.occupation:'此地的一位居民');
export function npcGoalLabel(world,npc){
 const goal=npc?.currentGoals?.[0]||npc?.goals?.[0];
 if(zh(goal))return String(goal).slice(0,120);
 if(goals[goal])return goals[goal];
 // An untranslated new goal remains in raw Engine data for the narrator.
 // Do not substitute a guessed motive based on faction membership.
 return '';
}
export function sceneAffordances(world,targetId=null){
 if(world.player?.travel){const trip=world.player.travel,from=world.locations[trip.from]?.name||'出发地',to=world.locations[trip.to]?.name||'目的地',remaining=Math.max(1,Math.ceil(trip.arriveAt-world.minute));return {locationName:`${from} → ${to} · 途中`,npcId:null,npcName:null,role:'',goal:'',quests:[],roads:[],nextStep:`等待${remaining}分钟继续赶路，抵达${to}后再打听消息`};}
 const location=world.locations?.[world.player?.locationId];
 const people=Object.values(world.characters||{}).filter(n=>n.alive&&!n.travel&&n.locationId===world.player.locationId);
 const npc=people.find(n=>n.id===targetId)||(!targetId?people[0]:null);
 const quests=Object.values(world.quests||{}).filter(q=>['available','active','mutated'].includes(q.state)&&(q.giverId===npc?.id||q.state!=='available'&&q.targetLocationId===location?.id));
 const roads=(world.edges||[]).filter(e=>e.from===location?.id&&!e.closed&&!world.locations[e.to]?.destroyed).map(e=>({locationId:e.to,name:world.locations[e.to]?.name,risk:e.risk}));
 const goal=npc?npcGoalLabel(world,npc):'';
 const giver=people.find(n=>n.id===quests[0]?.giverId);
 const nextStep=quests[0]?(giver?`向${giver.name}询问「${quests[0].title}」的具体要求`:`查看「${quests[0].title}」的当前状态与完成条件，寻找仍有效的线索`):npc?`向${npc.name}打听${goal||'此地的情况'}，再决定是否相助`:roads[0]?`查看四周，再决定是否沿路前往${roads[0].name}`:'查看四周，确认自己所处的环境';
 return {locationName:location?.name||'此地',npcId:npc?.id||null,npcName:npc?.name||null,role:npc?npcRoleLabel(npc):'',goal,quests:quests.slice(0,3).map(q=>({id:q.id,title:q.title,state:q.state})),roads:roads.slice(0,3),nextStep};
}
export const isOrientationSpeech=speech=>/^[\s?？!！啊哦嗯唔]+$/u.test(String(speech||''))||/啥情况|什么情况|怎么回事|这里.*哪|这.*什么地方|接下来|先做什么|下一步|我该.*做|发生.*什么/u.test(String(speech||''));
