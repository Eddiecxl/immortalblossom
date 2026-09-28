# LuoXian / 落仙 — GPT-5.6 Astra High Master Implementation Prompt

## Purpose

You are working inside the current LuoXian / Immortal Blossom repository.

This is NOT a request to make the game more like a chatbot.

The goal is to turn LuoXian into a long-running, deterministic, simulation-driven cultivation RPG where:

- the player begins as a mortal;
- the player is guaranteed to encounter 林小满 early in life;
- the world progresses even if the player does nothing;
- quests are evolving story arcs rather than static checklists;
- major events are driven by time windows, world state, seed, NPC goals and faction pressure;
- every world seed can become a genuinely different life;
- the player can interfere with, fail, mutate, destroy or completely bypass intended story arcs;
- the world can end;
- the player can die;
- important NPCs can die;
- the game must remain logically consistent for 100–300+ hours;
- the LLM narrates and improvises inside constraints, but the Game Engine owns truth.

Before changing anything, audit the current repository thoroughly. Understand the existing save format, world state, event systems, AI routing, Groq integration, local AI integration, launcher, update/patch system, UI, system companion, quests, memory, NPCs, items, locations, time engine, world seed, repair bundle and tests.

Do not perform a shallow prompt-only patch.

Implement this as a proper engine/content architecture upgrade.

---

# 1. Non-negotiable design philosophy

## 1.1 The player is not the center of the universe

The world must not wait for player input.

The world must have its own:

- clock;
- seasons;
- NPC travel;
- marriages;
- deaths;
- faction wars;
- sect ceremonies;
- disasters;
- economic changes;
- political changes;
- discoveries;
- secret plots;
- migrations;
- recruitment;
- betrayals;
- trials;
- auctions;
- tournaments;
- breakthroughs;
- illnesses;
- conflicts;
- quest deadlines.

If the player sleeps for three months, the world should have changed.

If the player ignores a sect crisis, it should resolve without them.

If the player arrives late, they may find:

- corpses;
- ruins;
- a finished celebration;
- a closed sect;
- a new leader;
- an expired quest;
- an NPC already gone;
- an item already sold;
- a war already lost;
- an event completed by someone else.

The simulation must create history independently of the player.

---

# 2. Two fixed story anchors

Only a small number of things should be globally guaranteed.

## 2.1 The player always starts mortal

At the beginning of a new seed:

- cultivation = none;
- no automatic immortality;
- no default legendary weapon;
- no default secret bloodline;
- no default ancient inheritance;
- no default sect membership;
- no default chosen-one status;
- no automatic protection from death.

The player's mortal background is seed-driven.

Possible backgrounds include:

- farming household;
- merchant family;
- wealthy household;
- minor official family;
- ruined clan;
- hunter;
- fisherman;
- orphan;
- medical apprentice;
- courier;
- guard trainee;
- escort-agency apprentice;
- scholar;
- inn worker;
- servant;
- village craftsman;
- traveling family;
- refugee;
- minor noble household.

Starting comfort must also vary.

Some seeds can begin peacefully.

Not every seed needs tragedy.

A player may begin with loving parents, money, food and safety.

The cultivation world should become interesting because the world moves, not because every protagonist needs a dead family.

## 2.2 The player must meet 林小满

林小满 is a persistent world anchor.

She is NOT a mandatory romance character.

She is NOT required to become a cultivator.

She is NOT required to survive.

She is NOT required to follow the player.

The game only guarantees that the player's life intersects with hers early enough for that relationship to become part of the world's history.

Different seeds may introduce 林小满 as:

- a childhood neighbor;
- a stranger in a market;
- an apothecary apprentice;
- a rich family's daughter;
- a poor traveler;
- a refugee;
- a thief;
- a wounded stranger;
- a caravan member;
- a fellow examination candidate;
- a future sect applicant;
- someone rescuing the player;
- someone the player rescues;
- someone competing for the same object;
- an initially hostile NPC;
- an ordinary happy girl with no immediate tragedy.

She must have:

- her own family state;
- her own goals;
- her own fears;
- her own relationships;
- her own schedule;
- her own memories;
- her own cultivation potential;
- her own future simulation.

She may:

- become a friend;
- become indifferent;
- become an enemy;
- marry somebody else;
- leave the region;
- remain mortal;
- become powerful;
- join a sect;
- become a merchant;
- become demonic;
- die;
- become historically important;
- disappear for decades and reappear.

Do not force romance.

---

# 3. Core narrative model: Anchored simulation, not linear plot

Do NOT implement:

A -> B -> C -> Final Boss.

Implement:

World Era
+ Seed
+ Narrative Anchor Window
+ Location Anchor
+ Event Family
+ Faction State
+ NPC Goals
+ Current World History
+ Player Intervention
= Actual Story.

The purpose of the plot is to provide background pressure.

The purpose of the engine is to decide what truly happened.

---

# 4. World eras for a 100–300+ hour game

These eras are not rigid chapters. They are content bands and simulation scales.

## Era 0 — Mortal Life

Typical playtime: 10–30 hours.

Possible content:

- family;
- school;
- work;
- village disputes;
- merchants;
- officials;
- bandits;
- escorts;
- medicine;
- local crime;
- marriage arrangements;
- local festivals;
- drought;
- flood;
- disease;
- rumors of immortals;
- first monster sighting;
- first cultivator sighting.

Purpose:

The player should feel that cultivation is a world above them, not something handed out in minute five.

Possible endings during this era:

- player dies as a mortal;
- player remains mortal permanently;
- player becomes wealthy;
- player becomes an official;
- player becomes an outlaw;
- player joins a caravan;
- player becomes involved with cultivators;
- player receives a cultivation opportunity.

## Era 1 — First Contact with Cultivation

Typical playtime: 15–40 hours.

Systems become more visible:

- spiritual roots;
- sect recruitment;
- independent cultivators;
- talismans;
- pills;
- spirit stones;
- artifacts;
- cultivation manuals;
- spirit beasts;
- minor ruins;
- cultivation markets.

Possible paths:

- sect disciple;
- rejected applicant;
- independent cultivator;
- merchant;
- body cultivator;
- demonic path;
- mortal who refuses cultivation;
- servant inside a sect;
- disciple of a wandering master;
- accidental inheritance holder.

## Era 2 — Sect and Regional World

Typical playtime: 30–80 hours.

Introduce:

- major sects;
- large cultivation cities;
- clans;
- regional kingdoms;
- sect politics;
- internal rivalries;
- faction missions;
- inheritance sites;
- secret realms;
- monster regions;
- black markets;
- tournaments;
- sect wars;
- political marriages;
- major personal arcs.

## Era 3 — Continental Conflict

Typical playtime: 40–100 hours.

Possible world pressures:

- empire war;
- sect coalition;
- demonic invasion;
- ancient race awakening;
- continent-scale plague;
- spiritual-tide change;
- monster migration;
- ancient battlefield opening;
- sky fracture;
- upper-realm interference;
- collapse of a dynasty;
- mass migration.

The player can participate or ignore it.

If ignored, it still happens.

## Era 4 — Upper Realms / Cosmic World

Typical playtime: 50–150+ hours.

Possible content:

- immortal domains;
- demonic domains;
- divine courts;
- void travel;
- reincarnation zones;
- world cores;
- ancient civilizations;
- inter-world factions;
- laws / Dao;
- cosmic disasters.

Early mortal history must remain relevant.

An old childhood friend may:

- have died centuries ago;
- have founded a clan;
- have left descendants;
- have ascended;
- have become a historical figure;
- have left an artifact;
- have vanished.

---

# 5. Narrative Anchor Windows

This is one of the most important new systems.

A Narrative Anchor does NOT define a fixed story.

It defines:

- a time window;
- a likely place;
- a thematic family;
- optional required participants;
- preconditions;
- possible event templates;
- escalation logic;
- resolution conditions.

Example conceptual data:

~~~
anchorId: qingxuan-major-anchor-01
era: regional
locationFamily: sect
windowStart: worldDay 70
windowEnd: worldDay 120
eventFamily: sect_major_event
resolved: false
~~~

When the world enters the window, the engine selects or builds an event using:

- current seed;
- sect stability;
- faction enemies;
- leader status;
- treasury;
- active secrets;
- nearby monsters;
- war pressure;
- player actions;
- NPC goals;
- previous historical events.

The same anchor can become:

- a sect massacre;
- an attempted massacre that fails;
- a genius celebration;
- a sect tournament;
- a leadership succession;
- an internal rebellion;
- a theft;
- a spiritual vein discovery;
- a sealed ruin opening;
- a demon attack;
- an upper-realm envoy visit;
- a marriage alliance;
- a peaceful breakthrough ceremony;
- a plague;
- a split into two sects.

Location may remain the same while the event changes completely.

That is the intended design.

---

# 6. Major anchor families

Create at least these families.

## 6.1 Mortal hometown anchor family

Possible events:

- festival;
- famine;
- flood;
- wealthy family conflict;
- robbery;
- missing children;
- monster incident;
- official inspection;
- caravan arrival;
- cultivator passing through;
- family wedding;
- family dispute;
- market fire;
- local gang conflict;
- peaceful economic boom.

## 6.2 First cultivation contact family

Possible events:

- sect recruitment;
- wandering cultivator;
- spirit root test;
- relic discovery;
- monster hunt;
- accidental exposure to cultivation;
- auction;
- merchant convoy;
- injured cultivator;
- criminal cultivator incident.

## 6.3 Sect major event family

Possible events:

- invasion;
- massacre attempt;
- genius discovery;
- celebration;
- sect tournament;
- elder betrayal;
- sect leader death;
- successful breakthrough;
- failed breakthrough;
- treasure theft;
- forbidden land opening;
- internal civil war;
- sect relocation;
- spiritual vein collapse;
- spiritual vein expansion;
- upper-realm selection;
- forced military mobilization.

## 6.4 Regional conflict family

Possible events:

- two sects clash;
- dynasty intervenes;
- trade route collapses;
- monster migration;
- city siege;
- plague;
- spiritual resource rush;
- clan extermination;
- political marriage;
- secret realm opening.

## 6.5 Continental crisis family

Possible events:

- dynasty war;
- demon invasion;
- ancient sect revival;
- dragon awakening;
- spiritual tide;
- continent fracture;
- sky gate opening;
- meteor disaster;
- mass ascension opportunity.

## 6.6 Personal anchor family

For important NPCs:

- marriage;
- child birth;
- family death;
- betrayal;
- breakthrough;
- poverty;
- promotion;
- exile;
- inheritance;
- revenge;
- retirement;
- illness;
- disappearance.

These must be able to occur without player observation.

---

# 7. World Seed must control real structure

Do not use the seed merely for names.

The seed should deterministically control:

- starting settlement;
- player family;
- player wealth;
- local safety;
- local rulers;
- current dynasty;
- nearby sects;
- sect strength;
- demonic activity;
- monster density;
- spiritual density;
- ancient ruin frequency;
- war pressure;
- resource abundance;
- trade prosperity;
- weather tendencies;
- faction relationships;
- who is already alive or dead;
- 林小满's role;
- 林小满's family;
- 林小满's goals;
- early opportunities;
- early dangers;
- sect anchor candidates;
- continent-scale threats;
- upper-realm conditions.

Suggested seed parameters:

~~~
worldSeed
worldAge
spiritualDensity
dangerLevel
politicalStability
demonicActivity
ancientRuinsFrequency
resourceAbundance
warPressure
tradeProsperity
monsterActivity
heavenInterference
~~~

World generation must be deterministic for the same seed.

---

# 8. World geography as a graph

Do not represent location as one string.

Use hierarchical and graph-based geography.

Example content library:

Mortal layer:
- 临溪镇
- 柳河村
- 青河县
- 河阳城
- 大乾皇城
- 顾府
- 林家小院
- 回春堂
- 长乐客栈
- 南城集市
- 飞鸿镖局
- 白鹿书院
- 城隍庙
- 乱葬岗
- 黑风山
- 山神庙
- 云渡码头

Cultivation layer:
- 青玄宗
- 天剑门
- 万丹谷
- 御兽山
- 太清宫
- 血河宗
- 星罗商会
- 万宝城
- 青云坊
- 幽市
- 灵兽谷
- 九幽矿场
- 百草秘谷
- 剑冢

World layer:
- 天墟
- 无归海
- 赤血荒原
- 苍岚雪域
- 云梦泽
- 龙陨山
- 古帝城
- 封魔渊
- 归墟
- 天外战场
- 星落平原
- 九幽裂谷

Upper realm:
- 太虚仙域
- 九重天
- 轮回海
- 苍玄神庭
- 万界城
- 无尽虚空
- 岁月长河
- 古神战域

Each seed may rename, remove, replace, destroy or reassign these templates.

Location state should include:

- id;
- templateId;
- name;
- parentId;
- coordinates;
- edges;
- travel time;
- risk;
- population;
- controller faction;
- local economy;
- resources;
- services;
- discovered state;
- destroyed state;
- closed state;
- historical names;
- tags.

Locations must be able to:

- burn;
- flood;
- be conquered;
- be abandoned;
- be rebuilt;
- change ruler;
- change population;
- change economy;
- gain or lose services;
- disappear.

---

# 9. Autonomous NPC simulation

Important NPCs are persistent agents, not dialogue cards.

Important NPC data should include:

- identity;
- age;
- sex;
- species;
- alive/dead;
- current location;
- home;
- faction;
- occupation;
- cultivation;
- physical condition;
- personality;
- motivations;
- long-term goals;
- current goals;
- fears;
- attachments;
- relationships;
- inventory;
- wealth;
- secrets;
- knowledge;
- memories;
- schedule;
- travel;
- current plan;
- injuries;
- quest links;
- story flags;
- simulation importance.

NPCs can independently:

- travel;
- work;
- train;
- marry;
- separate;
- have children;
- become sick;
- heal;
- get robbed;
- become rich;
- become poor;
- join a sect;
- leave a sect;
- defect;
- betray;
- kill;
- be killed;
- fight;
- flee;
- hide;
- found a faction;
- become leader;
- lose power;
- retire;
- disappear;
- ascend.

Do NOT run a heavyweight LLM simulation for every NPC.

Use deterministic rules + event-driven scheduling for most activity.

Reserve LLM generation for important narrative moments.

---

# 10. 林小满 simulation rules

林小满 should have high persistence priority.

Always simulate:

- life state;
- location;
- relationship history;
- family history;
- major goals;
- cultivation path;
- major memories;
- current major plan.

But do not force her to remain near the player.

Example seeds:

Seed A:
She is an apothecary apprentice. Parents alive. Goal: earn money to move to a larger city.

Seed B:
She is fleeing enemies.

Seed C:
She is a wealthy but sheltered girl.

Seed D:
She wants sect admission.

Seed E:
She dislikes cultivation and wants a peaceful mortal life.

Seed F:
She initially cheats the player.

Seed G:
She rescues the player.

Her story should branch naturally.

---

# 11. Quest architecture

A Quest is not just a checklist.

It is a Story Arc state machine.

Required states:

- available;
- active;
- mutated;
- completed;
- failed;
- expired;
- abandoned;
- resolved-by-other;
- invalidated.

A Quest should support:

- origin event;
- participants;
- primary goals;
- optional goals;
- hidden goals;
- deadlines;
- success conditions;
- failure conditions;
- mutation rules;
- possible ending states;
- world consequences;
- follow-up arcs;
- rewards;
- lost rewards;
- historical record.

A quest can mutate if:

- target dies;
- quest giver dies;
- location is destroyed;
- faction changes;
- another NPC completes the objective;
- player joins the enemy;
- target becomes an ally;
- item is destroyed;
- deadline passes;
- world conditions change.

---

# 12. Example dynamic quest: 青玄宗大变

Origin:
A major sect anchor activates.

Possible objective forms:

- defend outer gate;
- evacuate civilians;
- investigate a stolen treasure;
- expose a traitor;
- participate in celebration;
- protect a genius disciple;
- assassinate a leader;
- join the attackers;
- escape;
- recover an artifact;
- refuse involvement.

Possible endings:

- sect survives;
- sect destroyed;
- sect splits;
- leadership changes;
- player escapes;
- player becomes hero;
- player becomes traitor;
- 林小满 dies;
- 林小满 becomes hero;
- player destroys the sect;
- event peacefully ends;
- a second crisis emerges;
- player uses 言出法随 and rewrites reality.

The final outcome must be persisted in World History.

---

# 13. Main arcs and side arcs

Support multiple levels simultaneously:

- World Main Arcs
- Region Arcs
- Faction Arcs
- NPC Personal Arcs
- Dynamic Event Arcs
- Player-Created Arcs

“Main quest” should mean high historical importance, not “the game refuses to continue unless you do this.”

If the player ignores the main arc, the world resolves it.

---

# 14. World Scheduler

Implement a real event queue.

Flow:

WorldClock
→ due events
→ travel arrivals
→ NPC scheduled actions
→ faction updates
→ economy updates
→ quest deadlines
→ narrative anchors
→ conflict resolution
→ world history
→ nearby presentation.

Events may be scheduled:

- seconds later;
- minutes later;
- hours later;
- tomorrow;
- next month;
- years later.

The player must not be able to freeze the universe by chatting.

---

# 15. Action duration and game time

Every turn needs a believable duration.

Suggested ranges:

- short sentence: 5–20 seconds;
- ordinary conversation: 1–5 minutes;
- search room: 3–15 minutes;
- meal: 15–45 minutes;
- local walk: 2–20 minutes;
- town travel: 5–45 minutes;
- cultivation: hours;
- sleep: hours;
- inter-city travel: hours to days;
- regional travel: days to months.

Speech remains the primary UI input, but speech still advances time.

---

# 16. Anti-stall and pacing engine

The current game must never sit for ten turns saying:

“they are still approaching.”

Maintain a progression score.

A turn counts as progression when at least one happens:

- new verified fact;
- new decision;
- new state;
- new location;
- new information;
- new risk;
- NPC action;
- world change;
- quest state change;
- relationship change;
- event resolution.

If N consecutive turns have low progression:

Trigger World Pressure.

Examples:

- NPC arrives;
- someone leaves;
- deadline expires;
- guards enter;
- enemy attacks;
- morning arrives;
- auction ends;
- door opens;
- messenger arrives;
- storm begins;
- someone dies;
- quest target moves;
- faction order changes.

Do NOT fake progression with:

“the atmosphere becomes more tense.”

---

# 17. Real death

Player death must be real.

NPC death must be real.

Do not clamp the player to 1 HP.

HP <= 0 means death unless an existing engine fact justifies survival:

- protection talisman;
- resurrection item;
- rescue;
- special technique;
- divine effect;
- successful reality rewrite.

When an NPC dies:

- alive=false;
- location presence removed;
- schedules cancelled;
- future events re-evaluated;
- quests mutate;
- relationships update;
- inheritance or corpse/inventory logic runs;
- world history records it.

The LLM must never casually resurrect them.

---

# 18. Terminal endings

Add explicit terminal state.

Ending examples:

- player_dead;
- world_destroyed;
- universe_destroyed;
- permanent_seal;
- ascended_beyond_simulated_world;
- self_erased;
- civilization_extinct;
- custom ending.

If the player successfully says:

“让全宇宙所有生命消失。”

and the reality rewrite engine accepts it:

- all life becomes dead;
- active civilizations = 0;
- ordinary quests terminate;
- NPC simulation stops;
- no footsteps;
- no merchants;
- no normal dialogue;
- generate ending summary;
- mark game ended.

Do not continue the game just because the narrative generator expects another turn.

---

# 19. 言出法随 as reality mutation

言出法随 must be an engine operation, not decorative text.

Pipeline:

Player statement
→ detect reality rewrite
→ parse scope
→ evaluate rules/cost
→ mutate authoritative world state
→ recalculate dependent systems
→ invalidate/mutate quests
→ recalculate factions
→ update locations
→ update NPCs
→ terminal-state check
→ world-history record
→ narration.

Support extreme requests:

- become invincible;
- kill one person;
- erase a sect;
- make everyone forget player;
- remove spiritual energy;
- destroy planet;
- kill all life;
- rewrite history.

If successful, later gameplay must respect it.

Do not restore “intended plot” afterward.

---

# 20. Data model is more important than prompt length

Persist important state.

Prefer SQLite or the current repository's equivalent robust local store.

At minimum support logical tables/collections for:

- worlds;
- world_state;
- world_history;
- locations;
- location_edges;
- settlements;
- factions;
- faction_relations;
- characters;
- character_relations;
- character_memories;
- inventories;
- item_templates;
- item_instances;
- quests;
- quest_states;
- events;
- event_queue;
- narrative_anchors;
- rumors;
- secrets;
- deaths;
- battles;
- economy_state;
- player_state;
- player_history;
- story_flags;
- world_flags;
- save_metadata.

Do not store critical truth only in LLM text.

---

# 21. Items

Use item instances.

Each item instance should track:

- unique ID;
- template;
- owner;
- location;
- quantity;
- durability;
- quality;
- effects;
- creation history;
- transfer history;
- destroyed state;
- uniqueness.

Content families:

Mortal:
- 铜钱
- 银两
- 家书
- 短刀
- 草药
- 路引
- 马匹
- 玉佩
- 医书
- 地图

Cultivation:
- 灵石
- 聚气丹
- 储物袋
- 法器
- 符箓
- 灵草
- 功法
- 身法
- 阵盘
- 炉鼎
- 灵兽契约

High level:
- 本命法宝
- 古仙遗物
- 世界碎片
- 大道残卷
- 轮回印
- 虚空坐标
- 世界本源
- 时空残片

An important item can be stolen, sold, lost, destroyed or reappear decades later.

---

# 22. Faction simulation

Faction templates:

- dynasties;
- sects;
- demonic sects;
- clans;
- merchant guilds;
- beast factions;
- outlaw organizations;
- independent cultivator alliances;
- upper-realm powers.

Faction state:

- power;
- wealth;
- territories;
- leadership;
- members;
- allies;
- enemies;
- wars;
- resources;
- goals;
- internal stability;
- succession state;
- secrets.

Factions can rise and collapse independently of the player.

---

# 23. World history

Every major world event should create an authoritative history entry.

Fields:

- timestamp;
- event type;
- actors;
- location;
- summary;
- world impact;
- player witnessed or not;
- evidence/rumor links.

The player not knowing something does NOT mean it did not happen.

Later discovery can happen through:

- rumors;
- books;
- ruins;
- descendants;
- NPC dialogue;
- monuments;
- graves;
- official records.

---

# 24. Rumor and imperfect information

Do not let every NPC know engine truth.

Rumors should support:

- origin event;
- truth confidence;
- region spread;
- known-by set;
- mutation/distortion;
- source credibility.

This allows the world to feel alive and prevents omniscient NPC dialogue.

---

# 25. Context Compiler

Never feed the entire 100-hour save to the LLM.

Compile only relevant context each turn:

- system rules;
- current time;
- current location;
- nearby location graph;
- player state;
- present NPCs;
- relevant NPC goals;
- active quests;
- due events;
- relevant world-history entries;
- relevant memories;
- relevant relationships;
- secrets the speaker is allowed to know;
- recent 3–6 turns;
- player input.

Keep long-term data local and retrieve only relevant pieces.

---

# 26. Memory layers

Use distinct memory classes:

Working Memory:
recent turns.

Episodic Memory:
important experiences.

Character Memory:
what a specific NPC personally remembers.

World History:
authoritative events.

Rumor Memory:
what the NPC has heard.

Secrets:
restricted information.

An NPC must not use knowledge they do not possess.

---

# 27. AI provider continuity

Do not silently switch models every few turns.

Provide explicit modes:

- Groq Fixed;
- another cloud provider fixed;
- Local Only;
- Auto if desired.

In a fixed mode:

retry same provider
→ repair same provider
→ only then explicitly fallback.

A provider switch must not silently cause tone/personality/context discontinuity.

Local AI should be fallback/offline, not the authority over world state.

When cloud AI is active, do not unnecessarily load the local LLM.

---

# 28. Narrative validator

After LLM generation, validate against authoritative state.

Reject or repair when:

- dead NPC speaks normally;
- NPC teleports;
- time reverses;
- location contradicts world graph;
- destroyed place is described intact;
- item appears from nowhere;
- player gains unknown skill;
- finished quest restarts;
- erased world has ordinary life;
- NPC knows forbidden secret;
- same fact loops repeatedly;
- event ETA never resolves;
- result contradicts terminal state.

---

# 29. Performance architecture

Target ordinary PCs too.

Minimum practical target:
16GB RAM and weak/average GPU.

Use layered simulation.

Level 0 — Current Scene:
update each turn.

Level 1 — Current Region:
update every 5–15 game minutes or on relevant events.

Level 2 — Distant Regions:
update every few game hours.

Level 3 — World Macro:
update daily or on scheduled events.

Use event-driven travel.

Do not simulate every distant NPC every frame.

Example:

NPC traveling A -> B stores:
departureTime
arrivalTime
destination

At arrival time resolve the trip.

---

# 30. Content scale target

Do not hand-write 300 hours of prose.

Build reusable deterministic content systems.

Target at least:

- 50+ location templates;
- 30+ faction templates;
- 100+ NPC archetypes;
- 200+ event templates;
- 100+ quest templates;
- 50+ narrative anchor families;
- 300+ item templates;
- large procedural combinations.

Templates should create meaningful combinations, not random nonsense.

---

# 31. Suggested recurring named cast pool

Besides 林小满, create reusable named archetype pools that can take different roles per seed.

Examples:

赵天霸:
May be bully, guard captain, merchant son, sect outer disciple, bandit, ally, nobody important.

苏清雪:
May be cultivator, noble daughter, healer, assassin, sect genius, ordinary mortal.

陈不归:
May be wandering cultivator, drunk, retired elder, fraud, hidden expert.

顾青山:
May be player relative, local official, merchant, clan member, unrelated NPC depending on player background.

Do not lock their destiny.

Named recurring anchors create familiarity across seeds while roles and outcomes vary.

---

# 32. Example 300-hour world skeleton

This is a scaffold, NOT a forced storyline.

Hours 0–10:
Mortal routine.
Meet 林小满 through seed-selected encounter.
Introduce family, local economy, nearby danger, social relationships.

Hours 10–30:
First disruption.
Cultivation becomes visible.
Possible local quest arcs begin.

Hours 30–60:
Player may enter cultivation ecosystem.
Regional travel opens.
First serious personal consequences.

Hours 60–100:
Sect/faction membership or independent path.
First major regional anchor.

Hours 100–150:
Faction changes.
Important NPC arcs mature.
Regional war / celebration / discovery / political event.

Hours 150–220:
Continental systems.
Long-distance travel.
Older decisions return.
Early NPCs may have aged, died or risen.

Hours 220–300+:
Upper realm / cosmic possibilities for suitable saves.
Other saves may remain grounded and still continue through family, politics, sect leadership or mortal history.

Do not force ascension merely because playtime is high.

---

# 33. Example of same location, different seed

Location:
青玄宗.

Seed 1001:
A genius appears.
The whole sect celebrates.
During celebration the treasury artifact is stolen.

Seed 1002:
An enemy sect attacks.
The player arrives during evacuation.

Seed 1003:
The sect leader successfully breaks through.
Nearby factions become afraid.

Seed 1004:
The sect splits internally.
No external enemy exists.

Seed 1005:
Nothing catastrophic happens.
A minor disciple finds an old cave.
That discovery causes a war 80 game-hours later.

Seed 1006:
The player erased spiritual energy earlier.
The “sect event” mutates into a political collapse because nobody can cultivate anymore.

This is the required degree of causal adaptation.

---

# 34. Player freedom must override planned story

If player uses 言出法随 and becomes invincible at hour 5:

Do not keep treating bandits as a meaningful combat threat.

Instead the world reacts:

- witnesses spread rumors;
- factions investigate;
- rulers fear or recruit;
- cults form;
- powerful entities notice;
- quests mutate;
- ordinary conflicts become trivial;
- social and cosmic consequences become more important.

If the player kills a required NPC:

Do not revive them.
Mutate the quest.

If the player destroys 青玄宗 before its scheduled anchor:

Do not trigger a normal sect celebration later.
Mutate/cancel the anchor.

---

# 35. The game should produce history, not only quests

At the end of a save, generate a chronicle:

《此世纪年》

Possible entries:

Year 18:
The player met 林小满.

Year 19:
The first cultivator entered 临溪镇.

Year 21:
青玄宗 split after internal conflict.

Year 33:
林小满 founded a medicine guild.

Year 70:
The player caused the fall of 大乾.

Year 201:
The player ascended.

Or:

Day 4:
The player rewrote reality and erased all life.

Ending:
Universe Extinct.

The chronicle is the true “ending”.

---

# 36. UI rules

Keep the Speech-First design.

Default input every new turn:
说话.

Action input:
secondary / optional.

System companion:
- persistent left side;
- available at all times;
- can chat without modal;
- reads verified Engine state;
- reacts to major events;
- does not dominate every turn;
- does not freeze world time unless specifically designed as meta time-stop.

Main UI content must not sit too low on screen.

Keep important story text, choices and speech input visually centered/upward.

---

# 37. Data integrity rules

Every authoritative mutation should be transaction-like.

A story outcome that says:
“赵天霸 died”

must result in corresponding engine state.

A quest completion must result in:
quest state + rewards + world consequences + history.

A destroyed location must modify:
location + travel graph + local quests + NPC locations + economy + history.

Avoid narrative-only consequences.

---

# 38. Save compatibility

Audit current save schema.

If new tables/state are needed:

- increment save schema;
- write deterministic migration;
- retain older saves when possible;
- back up before migration;
- verify rollback/error handling.

Do not silently corrupt saves.

---

# 39. Required automated tests

Test A — Time keeps moving:
Player only talks for 20 turns.
World time advances.
Scheduled NPC arrival resolves.

Test B — World without player:
Player idles/sleeps.
Major world event occurs without direct participation.

Test C — Missed event:
Player ignores sect event.
Event resolves.
Quest/world state updates.

Test D — Dead quest NPC:
Player kills quest-critical NPC.
Quest mutates, reroutes or fails.

Test E — World destruction:
Player successfully destroys all life.
All ordinary quests terminate.
Terminal ending is entered.

Test F — Dead NPC consistency:
NPC dies.
500 turns later, normal narration cannot resurrect them.

Test G — Anti-loop:
Run 1000-turn simulation.
Detect severe repetitive narrative loops.

Test H — Seed diversity:
Generate multiple seeds.
The first 20 gameplay hours differ materially in:
background,
location,
early events,
林小满 entrance,
factions,
quests.

Test I — Same seed determinism:
Same seed + same actions should generate the same authoritative engine history, even if wording differs.

Test J — Long save:
Simulate 10,000 world events.
Context size must remain bounded.
Performance must not degrade catastrophically.

---

# 40. Development workflow for Astra High

Do not jump directly into coding.

Phase 1:
Repository audit.

Output internally:
- current architecture map;
- source-of-truth map;
- duplicated state;
- prompt-owned facts that should be engine-owned;
- missing data structures;
- current failure modes.

Phase 2:
Design migration.

Phase 3:
Implement authoritative world engine foundations.

Phase 4:
Implement Narrative Anchors + Scheduler.

Phase 5:
Implement Quest mutation.

Phase 6:
Implement NPC autonomous plans.

Phase 7:
Implement Context Compiler + Validator.

Phase 8:
Implement terminal endings.

Phase 9:
UI integration.

Phase 10:
Tests and soak simulations.

Phase 11:
Package patch/update correctly.

Do not leave half-migrated duplicate systems.

---

# 41. Deliverables

When implementation is complete, provide:

1. modified source code;
2. architecture summary;
3. world simulation design;
4. Narrative Anchor implementation;
5. Quest mutation engine;
6. autonomous NPC simulation;
7. World Seed expansion;
8. terminal ending system;
9. database/schema migration;
10. memory/context changes;
11. narrative validator;
12. anti-stall system;
13. save compatibility notes;
14. unit tests;
15. simulation tests;
16. long-run soak test;
17. build validation;
18. launcher/update compatibility;
19. changelog/news;
20. patch package if the existing project uses .lxpatch.

Actually run:
- tests;
- lint;
- typecheck;
- build;
- packaging validation;
- simulated patch install.

Do not merely state that they would pass.

---

# 42. Final decision rules

Whenever designing any mechanic, ask:

If the player does nothing, does the world continue?
Required answer: YES.

If the player kills a key NPC, does the original plot blindly continue?
Required answer: NO.

If the player never goes to an event, does it wait forever?
Required answer: NO.

If an arrival ETA reaches zero, can narration keep saying “they are approaching”?
Required answer: NO.

If the player destroys the universe, does ordinary gameplay continue?
Required answer: NO.

If the same seed runs for 100 hours, does history accumulate?
Required answer: YES.

If a different seed is started, does it feel like another life rather than the same script with renamed NPCs?
Required answer: YES.

If the AI says something that contradicts the engine, who wins?
Required answer: THE ENGINE.

The intended formula is:

Initial Conditions
+ World Rules
+ Narrative Anchors
+ Event Families
+ NPC Goals
+ Faction Simulation
+ Time
+ Player Choices
= Story.

That is the core identity of LuoXian.
