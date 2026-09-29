// Catalog data is kept outside saves. Every generated template carries a
// usable cause, action or consequence; generation combines compatible variants.
const rows = (source) => source.trim().split(/\n/u).map(line => line.trim().split('|'));
const freeze = (items) => Object.freeze(items.map(item => Object.freeze(item)));

const locationGroups = [
  ['mortal', `linxi|临溪镇|town
liuhe|柳河村|village
qinghe|青河县|county
heyang|河阳城|city
daqian|大乾皇城|capital
gumanor|顾府|estate
linhome|林家小院|home
huichun|回春堂|clinic
changle|长乐客栈|inn
southmarket|南城集市|market
feihong|飞鸿镖局|escort
bailu|白鹿书院|school
chenghuang|城隍庙|shrine
gravehill|乱葬岗|wilderness
blackwind|黑风山|mountain
mountainshrine|山神庙|shrine
yundu|云渡码头|port
riceplain|稻香原|farmland
eastpass|东岭关|fort
saltroad|盐商古道|road`],
  ['cultivation', `qingxuan|青玄宗|sect
tianjian|天剑门|sect
wandan|万丹谷|sect
yushou|御兽山|sect
taiqing|太清宫|sect
xuehe|血河宗|sect
xingluo|星罗商会|guild
wanbao|万宝城|city
qingyun|青云坊|market
youshi|幽市|blackmarket
beastvalley|灵兽谷|valley
jiuyoumine|九幽矿场|mine
herbvalley|百草秘谷|valley
swordtomb|剑冢|ruin
cloudstair|登云梯|trial
redfurnace|赤炉峰|forge
moonarchive|月藏阁|archive`],
  ['world', `skyruin|天墟|ruin
returnlesssea|无归海|sea
bloodwaste|赤血荒原|wasteland
snowrealm|苍岚雪域|snowfield
dreammarsh|云梦泽|marsh
dragonfall|龙陨山|mountain
ancientcity|古帝城|ruin
demonabyss|封魔渊|abyss
guixu|归墟|abyss
outerbattle|天外战场|battlefield
starplain|星落平原|plain
ninerift|九幽裂谷|rift
glassdesert|琉璃沙海|desert`],
  ['upper', `taixu|太虚仙域|domain
nineheavens|九重天|heaven
reincarnationsea|轮回海|sea
divinecourt|苍玄神庭|court
myriadcity|万界城|city
endlessvoid|无尽虚空|void
timeriver|岁月长河|river
godwar|古神战域|battlefield
worldheart|万界心核|core`]
];
export const LOCATION_TEMPLATES = freeze(locationGroups.flatMap(([layer, data]) => rows(data).map(([id, name, kind]) => ({ id: `loc:${id}`, name, layer, kind, tags: [layer, kind] }))));

const factionGroups = [
  ['dynasty', `daqian|大乾王朝|hold the river provinces
beiliang|北凉王庭|secure the northern passes
yunmeng|云梦水府|control marsh trade
easterncourt|东海行台|protect sea tariffs`],
  ['sect', `qingxuan|青玄宗|train sword disciples
tianjian|天剑门|guard the sword tomb
wandan|万丹谷|control medicinal pill supply
yushou|御兽山|breed spirit beasts
taiqing|太清宫|preserve orthodox rites
xingchen|星辰观|map celestial omens
mingjing|明镜寺|seal dangerous relics
fenglei|风雷宗|guard mountain passes`],
  ['demonic', `xuehe|血河宗|expand blood rites
blacklotus|黑莲教|recruit hidden converts
nightbone|夜骨殿|recover forbidden remains
ashes|灰烬盟|undermine orthodox control`],
  ['clan', `gu|顾氏宗族|protect family estates
lin|林氏药家|preserve healing trade
su|苏氏剑家|secure clan inheritance
chen|陈氏旧族|restore lost standing`],
  ['guild', `xingluo|星罗商会|open safe caravan routes
feihong|飞鸿镖局|escort merchant convoys
hundredherbs|百草会|stabilize herb prices
wanbao|万宝行|control auction houses`],
  ['other', `whitewolf|白狼群|defend hunting grounds
riverbandits|黑水帮|tax river crossings
loosecultivators|散修盟|protect independent cultivators
cloudguard|云州卫|patrol border roads
voidcourt|太虚仙庭|maintain upper-realm order
reincarnation|轮回司|guard the cycle of souls
dragonremnant|龙裔残部|recover ancestral territory
starwatch|观星台|track world fractures`]
];
export const FACTION_TEMPLATES = freeze(factionGroups.flatMap(([type, data]) => rows(data).map(([id, name, goal]) => ({ id: `faction:${id}`, name, type, goals: [goal], scope: type === 'other' ? 'variable' : type === 'dynasty' ? 'regional' : 'local' }))));

const occupations = rows(`farmer|tend crops|protect harvest|fieldwork
fisher|work river nets|keep boat safe|fishing
merchant|trade goods|build reliable routes|trading
physician|treat patients|find rare medicine|healing
apothecary|prepare remedies|earn a clinic licence|compounding
scholar|study records|pass examinations|studying
clerk|maintain registers|gain a senior post|recordkeeping
guard|patrol streets|protect assigned ward|patrolling
escort|guard caravans|complete a safe journey|escorting
innkeeper|host travelers|keep the inn solvent|hosting
artisan|make tools|master a difficult craft|crafting
courier|carry messages|keep a trusted route|delivering
hunter|track game|keep family supplied|tracking
boatman|ferry passengers|maintain the crossing|ferrying
herbalist|gather plants|protect a herb patch|gathering
disciple|train techniques|earn sect advancement|training
alchemist|refine pills|perfect a formula|refining
beastkeeper|care for spirit beasts|bond with a difficult beast|feeding
formationist|maintain arrays|repair a failing seal|inspecting
diviner|read omens|confirm a troubling vision|divining
miner|extract ore|survive the next shift|mining
auctioneer|mediate sales|guard buyer trust|auctioning
archivist|preserve records|recover a lost volume|cataloguing
outlaw|evade patrols|find a safe refuge|hiding
envoy|negotiate treaties|prevent a faction clash|negotiating`);
const socialPositions = [
  { id: 'apprentice', title: 'apprentice', constraint: 'needs a teacher', priority: 'learn the trade' },
  { id: 'independent', title: 'independent', constraint: 'answers to clients', priority: 'keep autonomy' },
  { id: 'household', title: 'household servant', constraint: 'supports relatives', priority: 'protect family income' },
  { id: 'veteran', title: 'veteran', constraint: 'carries old obligations', priority: 'settle an old debt' }
];
export const NPC_ARCHETYPES = freeze(occupations.flatMap(([occupation, dailyAction, goal, work]) => socialPositions.map(position => ({
  id: `npc-archetype:${occupation}:${position.id}`, occupation, title: `${position.title} ${occupation}`,
  dailyAction: work, goals: [goal, position.priority], constraint: position.constraint,
  startingLayer: ['disciple', 'alchemist', 'beastkeeper', 'formationist', 'diviner'].includes(occupation) ? 'cultivation' : 'mortal'
}))));

const incidents = rows(`harvest|crop blight|farmer,merchant|food supply changes
flood|river flood|boatman,official|homes and roads become unsafe
fire|market fire|merchant,guard|shops close or rebuild
inspection|official inspection|clerk,guard|local ruler gains leverage
wedding|family wedding|relative,merchant|households form an alliance
theft|valuable theft|owner,outlaw|ownership becomes disputed
missing|missing traveler|relative,escort|searches spread across roads
illness|fever outbreak|physician,patient|health and labor decline
caravan|caravan arrival|escort,merchant|trade goods and news arrive
bandits|road ambush|escort,outlaw|route safety changes
duel|public duel|challenger,guard|status and injuries change
trial|criminal trial|clerk,accused|lawful standing changes
auction|public auction|auctioneer,bidder|rare item changes hands
recruitment|sect recruitment|disciple,candidate|new members are selected
root-test|spirit root test|examiner,candidate|cultivation potential is revealed
relic|relic discovery|explorer,scholar|artifact claims arise
monster|beast incursion|hunter,guard|population or beast control changes
pilgrimage|shrine pilgrimage|pilgrim,keeper|shrine influence changes
succession|leader succession|heir,elder|faction leadership changes
betrayal|elder betrayal|elder,disciple|trust and faction stability change
breakthrough|cultivation breakthrough|cultivator,mentor|power balance shifts
failure|failed breakthrough|cultivator,physician|injury or death becomes possible
treasury|treasury loss|keeper,thief|faction wealth changes
vein|spiritual vein discovery|miner,sect elder|resource claims arise
seal|seal fracture|formationist,guard|contained danger may escape
plague|regional plague|physician,official|settlements lose population
migration|refugee movement|refugee,guard|population and food demand change
siege|city siege|general,civilian|control and buildings are at risk
treaty|peace negotiation|envoy,ruler|war pressure changes
marriage-alliance|political marriage|heir,envoy|faction ties change
rebellion|internal rebellion|rebel,leader|faction may split
ruin-opening|ancient ruin opens|explorer,sect elder|new routes and relics appear
storm|spirit storm|diviner,traveler|travel and cultivation become dangerous
starfall|meteor fall|diviner,miner|rare resources and hazards appear
dragon|dragon awakening|beastkeeper,ruler|regional power shifts
sky-gate|sky gate opens|envoy,diviner|upper realm access changes
ascension|ascension attempt|cultivator,witness|a major actor leaves or dies
resurrection|resurrection rite|physician,relative|a recorded life may return
retirement|leader retires|leader,heir|succession begins
inheritance|estate inheritance|heir,clerk|assets and loyalties transfer`);
const pressures = [
  { id: 'calm', trigger: 'scheduled civic or personal activity', modifier: 'orderly', effect: 'the parties negotiate an ordinary settlement' },
  { id: 'scarcity', trigger: 'shortage or debt', modifier: 'resource-strained', effect: 'supplies, wealth or access are lost' },
  { id: 'rivalry', trigger: 'competing faction claims', modifier: 'contested', effect: 'a rival gains leverage and an enemy is recorded' },
  { id: 'danger', trigger: 'violence, disaster or monster pressure', modifier: 'dangerous', effect: 'injury, flight or destruction becomes possible' },
  { id: 'recovery', trigger: 'rebuilding after a prior loss', modifier: 'restorative', effect: 'a route, relationship or service is restored' }
];
export const EVENT_TEMPLATES = freeze(incidents.flatMap(([id, name, participants, consequence]) => pressures.map(pressure => ({
  id: `event:${id}:${pressure.id}`, family: id, name: `${pressure.modifier} ${name}`,
  trigger: pressure.trigger, participants: participants.split(','),
  effects: [consequence, pressure.effect], pressure: pressure.id
}))));

const questSeeds = rows(`deliver-medicine|deliver medicine|physician|patient receives treatment|patient worsens
find-traveler|find a missing traveler|relative|traveler is located|trail goes cold
escort-caravan|escort a caravan|merchant|convoy arrives|cargo is lost
repair-bridge|repair the river bridge|official|route reopens|travel remains blocked
collect-debt|settle a disputed debt|creditor|accounts are settled|rival gains claim
investigate-fire|investigate a market fire|guard|cause is proven|suspect escapes
gather-herbs|gather a rare herb|apothecary|remedy is prepared|herb season ends
protect-farm|protect the harvest|farmer|crops survive|food supply falls
trace-bandits|trace road bandits|escort|camp is found|bandits relocate
recover-heirloom|recover a family heirloom|heir|ownership is restored|heirloom changes hands
mediate-wedding|mediate a marriage dispute|relative|families agree|alliance fails
pass-exam|prepare for the examination|scholar|candidate is admitted|exam closes
map-ruin|map an open ruin|explorer|safe route is recorded|entrance collapses
guard-seal|maintain a weakening seal|formationist|breach is delayed|contained danger escapes
find-miner|rescue a trapped miner|foreman|miner returns|mine is abandoned
test-roots|attend spirit root test|candidate|result is recorded|admission window closes
sect-entry|seek sect admission|recruiter|candidate joins|candidate is rejected
protect-disciple|protect a disciple|elder|disciple survives|disciple flees or dies
recover-treasury|recover stolen treasury goods|keeper|goods return|goods are sold
negotiate-truce|negotiate a faction truce|envoy|hostilities pause|war resumes
evacuate-city|evacuate civilians|official|families reach shelter|casualties rise
treat-plague|treat a plague ward|physician|patients recover|disease spreads
expose-traitor|expose a sect traitor|elder|evidence is accepted|traitor seizes advantage
track-beast|track a spirit beast|beastkeeper|beast is contained|beast migrates
carry-warning|carry a war warning|scout|defenders prepare|warning arrives too late`);
const questForms = [
  { id: 'urgent', days: 2, condition: 'before immediate harm', reward: 'trust from the requester' },
  { id: 'standard', days: 10, condition: 'before the normal deadline', reward: 'fair payment' },
  { id: 'covert', days: 14, condition: 'without exposing the source', reward: 'a private favor' },
  { id: 'contested', days: 21, condition: 'before a rival completes it', reward: 'public standing' }
];
export const QUEST_TEMPLATES = freeze(questSeeds.flatMap(([id, objective, giver, success, failure]) => questForms.map(form => ({
  id: `quest:${id}:${form.id}`, originFamily: id, title: `${form.id} ${objective}`,
  giverRole: giver, objectives: [objective, form.condition], deadlineDays: form.days,
  successEffect: success, failureEffect: failure, reward: form.reward,
  alternatives: ['resolved-by-other', 'mutated', 'invalidated']
}))));

const anchorSeeds = rows(`hometown|mortal|harvest,flood,fire,wedding,caravan,bandits|settlement life
first-contact|mortal|recruitment,root-test,relic,monster,auction|first cultivation exposure
sect-crisis|regional|succession,betrayal,treasury,vein,rebellion|sect political change
regional-conflict|regional|siege,treaty,migration,plague,marriage-alliance|regional power
continental-crisis|continental|dragon,starfall,sky-gate,storm,siege|continental survival
personal-life|mortal|wedding,illness,retirement,inheritance,breakthrough|personal bonds
trade-cycle|mortal|caravan,auction,theft,fire,inspection|trade networks
ruin-awakening|regional|relic,ruin-opening,seal,starfall,treasury|ancient inheritance
beast-migration|regional|monster,migration,dragon,storm,bandits|wildlife pressure
upper-realm|upper|sky-gate,ascension,dragon,seal,starfall|cosmic access`);
const anchorStages = [
  { id: 'opening', offset: 0, span: 14 }, { id: 'gathering', offset: 20, span: 20 },
  { id: 'pressure', offset: 55, span: 24 }, { id: 'turning', offset: 100, span: 28 },
  { id: 'aftermath', offset: 150, span: 35 }, { id: 'legacy', offset: 240, span: 60 }
];
export const ANCHOR_FAMILIES = freeze(anchorSeeds.flatMap(([id, era, eventFamilies, theme]) => anchorStages.map(stage => ({
  id: `anchor:${id}:${stage.id}`, family: id, era, theme, stage: stage.id,
  windowDays: [stage.offset, stage.offset + stage.span],
  eventIds: eventFamilies.split(',').map(family => `event:${family}:${({ opening: 'calm', gathering: 'scarcity', pressure: 'rivalry', turning: 'danger', aftermath: 'recovery', legacy: 'calm' })[stage.id]}`),
  trigger: `${theme}: ${stage.id} window, local conditions and faction pressure`,
  offscreenOutcome: `If the player does not attend, independent actors resolve the ${stage.id} stage and its consequences persist.`,
  escalation: stage.id === 'aftermath' || stage.id === 'legacy' ? 'resolve consequences and descendants' : 'raise local stakes if ignored'
}))));

const itemGroups = [
  ['money', `copper|铜钱|pay for a small purchase
silver|银两|pay wages or taxes
spiritstone|灵石|power a cultivation trade
trade-token|商会筹码|settle a guild account
tax-seal|税契印|prove a tax payment`],
  ['document', `family-letter|家书|carry family news
travel-pass|路引|cross a guarded border
map|山河图|navigate a route
medical-book|医书|study treatment
manual|修行功法|learn a cultivation technique
contract|灵兽契约|record a beast bond
ledger|商会账册|verify a trade debt
inheritance-writ|继承文书|claim an estate
void-chart|虚空坐标|navigate the void
dao-fragment|大道残卷|study a Dao principle
birth-record|户籍簿|prove family kinship`],
  ['weapon', `short-knife|短刀|defend at close range
escort-saber|镖刀|protect a convoy
hunting-bow|猎弓|hunt at distance
flying-sword|飞剑|strike with spiritual force
spear|玄铁枪|hold a defensive line
soul-bell|镇魂铃|ward a hostile spirit
life-artifact|本命法宝|channel its owner's cultivation
ancient-relic|古仙遗物|release a stored ancient power
seal-blade|封魔刃|cut a demonic seal
world-shard|世界碎片|alter a bounded world law
training-staff|练武木棍|spar without a blade`],
  ['medicine', `herb|草药|treat a common injury
fever-root|退热根|reduce fever
antidote|解毒散|counter poison
healing-pill|回春丹|heal a severe wound
qi-pill|聚气丹|restore spiritual energy
bone-paste|续骨膏|set a broken bone
spirit-grass|灵草|refine a cultivation medicine
heart-elixir|护心丹|protect the heart during breakthrough
memory-tea|醒神茶|clear confusion
revival-seed|还生种|support a recorded resurrection rite
sleep-leaf|安眠叶|induce needed rest`],
  ['tool', `rope|麻绳|cross or secure a gap
lantern|风灯|light a dark road
horse|马匹|speed overland travel
medicine-kit|药箱|carry treatments
storage-bag|储物袋|store carried items
talisman|护身符箓|block one hostile effect
array-disc|阵盘|deploy a prepared formation
alchemical-furnace|炼丹炉|refine medicine
beast-whistle|唤兽哨|signal a bonded beast
time-fragment|时空残片|stabilize a local time anomaly
water-flask|水囊|carry drinking water`],
  ['material', `rice|粮米|feed a household
salt|官盐|preserve food
iron-ore|铁矿|forge mundane tools
spirit-ore|灵矿|forge spiritual tools
beast-hide|兽皮|make armor
silk|云丝|weave fine cloth
dragon-scale|龙鳞|forge rare armor
meteor-iron|星陨铁|forge a rare artifact
void-crystal|虚空晶|anchor void travel
world-essence|世界本源|stabilize a world core
hardwood|硬木|build a durable frame`]
];
const itemGrades = {
  money: [['small','small lot',1],['market','market lot',5],['guild','guild lot',20],['treasury','treasury lot',100],['sealed','sealed reserve',500]],
  document: [['copy','working copy',1],['witnessed','witnessed copy',3],['certified','certified original',8],['archival','archival original',20],['sealed','sealed authoritative record',50]],
  weapon: [['worn','worn',1],['serviceable','serviceable',3],['balanced','balanced',8],['masterwork','masterwork',25],['attuned','attuned',60]],
  medicine: [['dilute','dilute dose',1],['standard','standard dose',3],['fresh','fresh dose',6],['concentrated','concentrated dose',12],['carefully-refined','carefully refined dose',25]],
  tool: [['worn','worn',1],['repaired','repaired',2],['serviceable','serviceable',4],['reliable','reliable',8],['masterwork','masterwork',18]],
  material: [['scrap','scrap lot',1],['raw','raw lot',2],['sorted','sorted lot',4],['refined','refined lot',9],['pure','pure lot',20]]
};
export const ITEM_TEMPLATES = freeze(itemGroups.flatMap(([category, data]) => rows(data).flatMap(([id, name, use]) => itemGrades[category].map(([grade, description, value]) => ({
  id: `item:${id}:${grade}`, baseId: id, name: `${name}·${description}`,
  category, grade, use, value, tier: ['spiritstone','manual','contract','void-chart','dao-fragment','flying-sword','life-artifact','ancient-relic','seal-blade','world-shard','qi-pill','spirit-grass','heart-elixir','revival-seed','storage-bag','talisman','array-disc','alchemical-furnace','time-fragment','spirit-ore','dragon-scale','meteor-iron','void-crystal','world-essence'].includes(id) ? 'cultivation' : 'mortal'
})))));
