# 本地叙事质量持续工作记录

> 当前接续为文末「2026-10-29 v4.2.2」，前面的版本与实验状态按日期保留，不是重新执行指令。

更新时间：2026-10-01。用户本轮明确要求把本地 AI 的互动体验提升到接近网上 AI，不能只满足数据库正确、无崩溃或回复可提交。玩家期待人物有态度、判断、行动、互动和剧情发展；荒诞、粗俗、偏离路线的输入也要被理解。参考网上回复的模式，不能复制某个 seed 的对白。

## 当前可恢复基线

- 已交付/已安装版本：4.1.3；GitHub main：7adaa585bfbae18ab1efd732952f560e3b4fc519。
- 源码：C:/Users/User/Downloads/Luoxian/Luoxian-Beta-v4-Full/Maintenance/Repository。
- 实际游戏：C:/Users/User/Downloads/Luoxian/Luoxian-Beta-v4-Full/Luoxian Beta v4。
- 完整 ZIP：C:/Users/User/Downloads/Luoxian/Luoxian-Beta-v4.1.3-Full.zip（保留为更新基线）。
- 已选本地模型：Qwen3 14B Q4_K_M，实际运行器 llama.cpp，当前 lite 配置8192 context/4 threads/512 maxOutputTokens。不可静默换模型、改用户存档或凭据。
- 现有回归201项通过。过去15场试玩是调试证据，不是叙事质量已达标证明。既有证据在 Maintenance/Verification/v413-*。

## 本轮执行计划

使用现有叙事链路，不另建剧情引擎：

1. [进行中] 同一个 seed、同组正常/荒诞/调情/辱骂/和解/记忆输入，真实窗口分别玩 Groq 与 local。保留输入、原始候选、修复/降级、实际展示、时间、世界变化。429按服务商间隔等待并重试同一输入；日额度长等待要记录恢复点，不丢回合。
2. [待做] 分开判断模型能力、提示词压制、输出预算、旧回复范文、上下文遗漏、验证误拒绝。比较回应是否接住当前意图、角色态度是否具体、是否有新发展、连贯性与复读；长度仅辅助，不按字数假装质量提高。
3. [待做] 先用失败回归验证原因，再修改本地提示/预算/必要的事实包；一个因素一次实验。保留同次worldPlan落账、真实所有权/同意/任务依赖/消息知识边界，不能通过取消校验或模板对白刷分。
4. [待做] 用原测试及未参与调参的另一个 seed 复玩，保存改进前后样例与尚未解决的结果。适当运行回归；模型仍差时不能宣称已等同云端。
5. [待做] 确认改善后更新安装、精确版本公告、源代码/维护契约、补丁与完整包；校验后清理旧版并同步main。尚未验证前不能把4.1.3包叫作4.1.4。

## 已发现的代码证据（尚待实测隔离）

- game/astra-local-prompt.js 对有会话对象的本地回复要求1–3块、每块不超过120字，并以“不能新增…”和具体短答为主。这可能压制小说式互动，不足以仅归咎模型。
- game/v4-hybrid-client.js 默认普通local512输出token、cloud1050；修复local420、cloud1200。结构化操作也占输出预算。
- runtime模型profile的maxOutputTokens是否强制裁切请求，需要用原生服务实测，不能只改JS数值便宣称有效。
- buildAstraLocalMessages把含“刚才”等输入当成回忆问题，回填近6轮NPC旧对白；问后果也容易把旧答案再次作为范文。本地实测曾因复读连续修复后降级。

### Groq实测的新根因

同seed第三轮“刚才是开玩笑的。你自己的想法是什么？”：Groq原始候选有具体渔人态度和船只安全的观点，却因为首块复述完整玩家原话，stripExactPlayerSpeechEcho移除引号后留下“我说，”，被unfinished-player-line校验拒收。第二候选仍同样包含该首块，最终把本来有内容的回答替换成“不清楚”。修复方向是删除仅含原样玩家回声的模型块，保留后续真实叙述/对白，不放宽事实或玩家台词校验。

另：transcript-store.sanitizeTurn丢弃diagnostics，实验读回看不到降级原因。需要保存有界、安全的degraded/code/reasons，以便中断后诊断，不能打印密钥或原始上游错误。

## 中断后的下一步

先读本文件、AGENTS.md、docs/ENGINE_CONTRACT.md与docs/CODEX_CONTINUATION.md；查看git status，不回滚已有改动。查看Maintenance/Verification/v414-*的native.log、report.json与progress.json：有活跃Probe则接着等其结果，不重复发请求；有429等待记录则遵守恢复时间。不要重新打包4.1.3或重做上一轮已完成的任务。

### 已启动实验

- harness已增加：429不提交时等待同一输入续试、保留rateWaits；原生每次进度变化写progress.json。长于10分钟的单次等待记下retryAt后结束实验，继续时不能提前重试。产品游戏代码尚未改变。
- Groq基线已完成：Maintenance/Verification/v414-groq-baseline-unusual/report.json，seed local-final-0，scenario unusual（7轮）。原生日志DONE及owned runtime shut down。多次429在产品同提供商重试内等待后成功，没有跳过输入。
- 同seed本地基线已启动：Maintenance/Verification/v414-local-baseline-unusual，下一步检查progress.json/native.log和report.json，不同时运行两个RuntimeHost。
- Source已修复echo-only块和diagnostics保存；对应新增2项失败回归已观察RED→GREEN，局部6/6通过。尚未复制到实际游戏，所以两场基线仍为原4.1.3。下一步先比较基线，再在独立实验安装中逐项试验本地提示/输出预算，避免误改已交付包。

### 基线完成与当前实验（必须从这里接续）

- local基线7轮已经完成，窗口正常关闭。前3轮：香蕉只有一句询问缘由；清晨陪数星星却提及顾府夜空；问自己的想法时反问玩家真实想法。复读/没接住输入不是仅字数问题。
- Groq基线7次尝试6次提交。最后回忆问题被413拒绝：总prompt16548字，服务商测得7172 input tokens超过单次7000 ITPM限额；等待不能解决超大单次请求。前面原始候选最长约200–300中文字，态度/观点/动作连续；一次echo处理误拒绝导致引擎有限回应。不能把最后失败的旧turn字段算成新回复。
- Source新实验：astra-narrative-budget.js（整个作者事实包7000字符，保留输入、焦点人物、当前绑定；不改数据库/校验事实），明确回忆才带短旧对白，普通自己想法/后果不当复述。astra-local-prompt增加小说互动/人物判断的正向写作指引，去除每块120字硬限；尚保持模型及512输出预算，用实测先隔离提示效果。云端同样使用紧凑作者包以免单次413。当前新增4项预算/回忆/整请求回归已RED→GREEN。
- 独立实验安装：Maintenance/NarrativeLab。模型和运行器文件硬链接仅供读取，profile JSON单独复制且尚未提高预算；原安装仍4.1.3。第一次v414-local-writer-trial因实验安装资源缺失而启动超时，无模型结论。补齐Licenses/repair/Source并重建清单后，v414-local-writer-trial2已启动（local-final-0/unusual/local）。
- 下一步：查看trial2 native.log/progress/report；如果启动仍失败，先排查实验安装，不动原游戏、不提前宣称写作改善。成功后对照7轮实际回复，再决定预算实验或更改提示；最后要用另seed正常场次验证。此时产品代码仍未发布、main仍7adaa58，完整ZIP仍4.1.3基线。

### 最新恢复点

- trial2已成功进入真实游戏：native.log有boot/cover/generating-0；PID26132，继续读progress.json直到report.json/DONE。
- 当前Source全套207/207通过（记录Maintenance/Verification/v414-current-node-tests.txt）。实验不等于质量验收，原安装4.1.3尚未替换。
- 实验文件：game/player-turn.js、transcript-store.js、astra-narrative-budget.js（新增）、astra-local-prompt.js、astra-turn.js；harness有progress与429原输入续试；新测试narrative-budget.test.mjs、turn-presentation-summary.test.mjs。
- 下一步先查看本地trial2是否有切题的角色观点和新场面，记录长度/降级/延迟，但不按字数冒称文学质量。若明显改善，再测未参与调参的另一个seed正常场次和Groq修复后的7轮；若仍差，再单独实验maxTokens/profile，暂不要再套固定对白或给所有话加数值。

### trial2结果与下一次实验

- trial2已完成7轮，仍只有单句对白（约44–74字）；清晨仍同意“仰望星空”，自己的想法仍反问玩家。此轮不合格，不能发布后冒称接近云端。原profile与请求仍512，没有通过切换云或模板掩盖问题。
- 确认请求中真实目标有keep boat safe/settle an old debt、personality proud，affordances已有中文渔人/保住船只。下一假设：单dlg JSON范例和指代/角色焦点不清，盖过了作者指引。
- 新实验移除普通会话的单dlg范例，给真实受问人物、中文身份/目标、主客人称和当前时段的最后焦点提示，要求按新反应/对白形成小说场面；仍用同模型/512。只改实验安装。已启动Maintenance/Verification/v414-local-focus-trial（seed local-final-0/unusual/local），等待其progress/report。若仍失败，下一步单独尝试输出预算/模型，不再盲加提示。

### 2026-10-03 接续记录（当前有效）

- 上一轮 focus-trial 已 DONE，7轮全部提交，但3轮降级；原因包括 content/text 字段不兼容、narr误写对白。不是质量达标。原始候选第三轮已经说出人物自己的目标，却被格式错误丢弃。
- 已新增 narrative-format 回归，观察失败后修复字符串 content 别名；保留 worldPlan/claims 和后续验证。harness失败回合不再把旧turn误记作新回答。
- 正在进行 v414-groq-retest，原生 PID38124，same seed/unusual；等待 native.log/DONE和report.json。此场用早期7000预算版本，不含下述保留策略新修正。
- 当前源码提高 local 普通/修复请求为768 token（重要场面1024），本地超时180秒；还未实测 native profile 是否再次限制。没有修改用户profile。
- 审查复现了预算删掉行动对象/命名数值/召回记忆的问题。已修正：合并 speech+action 查引用；绑定人物/物品/条件ID；先删无关人群，再删可选背景；保留最后交换，明确回忆保留召回证据。超出关键事实预算会保留输入，不能偷偷删约定。
- 12项局部回归通过；仍须全套和新版本真实本地复测。原安装、ZIP仍4.1.3，尚无4.1.4发布或提交。下一步完成Groq，复制最新实验模块到NarrativeLab，跑 local unusual 和另seed normal，比较实际展示、降级、时间。

### 2026-10-13 云端 beta 接续（当前任务）

- 用户将当前发布目标改为云端默认 Groq + 全新 Cloudflare Worker `immortalblossombeta`，提供共享测试 Key；允许自己的 Key。最新指令是保留全部旧文件，不清理旧版。现有本地4.1.3和main7adaa58未改，源码待发布4.2.0。
- 新 Worker 有按凭证共享的 SQLite Durable Object 队列、429按服务商时间重试、事务编号幂等、会话隔离的世界检查点/行记/关联召回。浏览器桥保留原有电影/封面/四首游戏配乐；网页启动器没有补丁检查。本机Qwen优化保留，但不宣称云端同等质量。
- 已实现作者事实预算（关键绑定保留，完整验证事实不删）、确定性等待/旅行无AI结算、已有传闻不重复生成、云端队列倒计时及取消保留输入。新单测已通过局部验证，发布前仍须全套、真实网页和原生验证。
- 本地预览8787正常显示启动器/动画/开局；Groq workerd 请求90秒超时，直接Node请求Groq模型列表200。真实网页试玩未通过，不可当作已成功。第一场浏览器脚本有检查时序误差已修正，第二场是真上游超时。
- 准备先部署受用户授权的Worker测试版来隔离本机模拟器网络问题，然后真实在线多seed玩法/记忆/存读档测试，修复后提交main并从GitHub部署最终版。原生安装、manifest/repair、完整ZIP尚未更新。
- Git在默认沙盒diff报worktree错误，升级只读检查成功，非仓库损坏。Wrangler已登录现有账户。私密Key不在仓库/公共包里；`.dev.vars`被忽略。发布前fresh reviewer审查云端集成。

### 2026-10-13 最终验证接续

- 实际workerd失败根因为Worker fetch不支持redirect:error，改manual且拒绝3xx转发凭证后真实200。随后云端叙事出现复读候选，改善正向小说提示/修复提示；云端最多三次同模型修复，仍失败就保留世界，不再机械兜底。
- 第五轮回忆触发作者7000字符预算，复现并合并同持有者/事件链内的NPC记忆和belief重复文本，保留态度、来源、信心和ID，不改数据库和完整验证事实。新的真实云端五轮通过，记起鱼的玩笑，无降级；明确等待后刷新保留446分钟。证据v420-browser-verified。
- 实测暴露临时状态查询网络失败提前结束，新增失败回归并修复为续查原job。真实取消→刷新→恢复原话/事务→再发送仅一个generate POST，世界446→451。证据v420-cancel-resume；测试仅延后客户端首轮查询以显示取消按钮，上游是真Groq。
- 系统聊天同revision未续检查点、长行记100条可能超4MiB均由失败回归验证后修复。新时间戳恢复限同旅程，不覆盖手动槽；导入按UTF-8字节+数量分批。
- 279/279回归（真实workerd SQLite含在内）、原生更新器测试、116条清单哈希及实际4.2.0安装smoke/SQLite完整性通过。源与安装已4.2.0，原版备份/模型/正式保存区全部保留。4.1.3→4.2.0补丁真实原生应用和保存哨兵通过。
- Full ZIP已构建；最后逐项哈希和GitHub main/Actions发布状态写Maintenance/Verification/v420-release-state.json。不要重开所有旧试玩或重做已通过的测试。未宣称本地模型与云端等价、任意规则全可执行、免费配额无限或100小时内容已完成。


### 2026-10-13 v4.2.1 当前续作

真实8轮云端 unusual 完成，死亡/复活人物栏、关系与记忆、刷新、普通掉血不弹窗、静音无播放源全部验证。发现普通询问被过度敌意化及未记录的昨日交往；增强日常反应的相称性与既往事实边界，另seed normal及same-seed tone继续实测。测试290/290，详见 NARRATIVE_PRESENTATION_V421.md 与 Maintenance/Verification/v421-*。所有原文件保留。


2026-10-14 当前最终状态：4.2.1已安装并发布main；Cloudflare经GitHub Actions run38426906543成功部署，291/291。实际8轮unusual和另一seed2轮normal已提交；扩展normal第三轮及tone比较尚未完成，Groq完整请求已实测429 TPD，短JSON模式请求200。UI/关系/死亡复活/刷新/静音已验证，不宣称所有文风已完美。恢复：Verification中运行node v421-playtest.mjs v421-natural-18 normal resume，使用保留的同一事务与job，不重新发生成；成功后LX_PLAY_OUT=v421-tone-retested运行same-seed tone。先遵守v421-direct-tone/quota.json记录的等待再试。源码/安装/补丁已一致；包装和发布最终状态查看v421-release-state.json。保留全部原文件、模型与存档。

### 2026-10-29 v4.2.2：自然对白、完整言灵与回合交接

当前源码仍在 Repository，目标 4.2.2；本条写入时版本/安装/ZIP/线上仍是 4.2.1，尚未宣称发布完成。根因与实际修复：

1. 旧版真实 Groq 在「你谁呀」后自称旧邻居、编造昨日送腊肉，下一轮继续复述这段假关系。增加首次见面事实与保守共享过去校验；作者改为接住当轮输入的短场面，使用真实人物动机及可回应局面。没有针对某个 seed 写死对白。
2. 引号名称曾被当作假设，明确言灵混用普通数值上限，复合快路径可能仅执行第一部分。独立分类与执行；完整语义计划原子结算；精确数值、人物位置/复活/境界/姓名投影及实际变化代价都有回归。无规则或格式失败不能假装成功，也没有宣称任意新法则已经实现。
3. 截断 JSON 曾容许提取完整对白块却丢掉后面的世界计划。现在要求完整文档，区分截断/格式错误并有界修复；修复保持同一提供商、输入和事实。系统聊天也不再把格式错误降成机械占位台词。
4. 中文社会语义标签曾被英文字母校验拒绝，连带重写本来合理的角色回答。改为支持有界 Unicode 标签，保留在场者、原话证据、主客体和强度验证。小说引号中的插入动作拆成独立叙事块，保留顺序与世界计划。
5. 新只读交接选择器从当局约定、任务、事件、人物、道路和物品构造玩家可接续的机会。64 seed 开局及空场、旅行、终局测试覆盖该结构；仍不能宣称所有模型文本都必定像真人或每个结尾都已语义证明。

真实证据位于 `Maintenance/Verification`，未请求新一轮本地 Qwen 对比，不宣称达到本地/云端同等质量：

| 实验 | 已完成结果与用途 |
| --- | --- |
| `v422-baseline-v421-natural-12` | 旧源码 2 轮真实 Groq，保留虚构昨日交往及重复的基线。 |
| `v422-dialogue-compact` | 同 seed 4 轮已提交；8 次请求含修复前误拒的尝试。后两轮用了中文语义修正与引号拆块；「会说话的咸鱼」得到角色玩笑回应及具体追问。不是 4 轮均为最终同一代码快照。 |
| `v422-holdout` | 未参与前述调参的 seed `v421-natural-18`，2 轮、2 次真实请求完成。苏清雪回应身份及自己的事情，给出同行选择；仍有「像是怕我脑子有病」等生硬过度判断。 |
| `v422-law-cloud` | 3 轮、1 次真实云请求：凡人无敌、带引号改名加改性别、气血设为 500。实际世界与面板投影保存江行舟/female/500，不被旧上限截掉。发生于最终代价调整前；不能把旧 debt 数值当最终代价验收。 |

评价：已有切题、态度变化和下一步互动；仍观察到过度防备、未经完整验证的装饰人物/路线细节，以及个别结尾只停在动作上。没有通过固定答句替换、取消事实校验或伪造无限配额来掩盖它们，不能向用户承诺「文风完美」或「所有编造已消失」。后续应保留这些 holdout 原文作继续比较。

最终审查后的完整回归 `v422-tests-reviewed.txt` 为 328/328、0 skipped（含实际 workerd SQLite）。相对较早的 324/324，新增并修复了「同事务创造后再更新实体」空源实体代价计算、询问/假设误执行、NPC 传送目标误用、和/与/及复合指令漏后半句、复活加移动受 JSON 字段顺序影响；已存活者复生不重置位置与计划。实体名称内的连接字不作为复合分隔，JSON 属性顺序不改变结算顺序。

发布验证（2026-10-29）：引擎 main 提交 0239ae19e9606877b87722da5cf5ecaff8755704；GitHub run 40827261300 测试、构建、Cloudflare 部署成功。实际线上隔离浏览器 `v422-browser-deployed` 三个言灵按钮操作全部提交：凡人无敌、带引号改名+性别、气血 500；复合指令为一个真实生成请求，0 模块覆盖、0 JS 错误，刷新后世界与 HUD 一致，在场者和默认静音通过。此测试仍见模型装饰性的「熟悉邻人」表述，不能说所有未经证实的共同过去已被语义校验覆盖。

实际安装与 119 条 manifest 一致，4.2.1→4.2.2 补丁已通过构建器真实原生 Validate/Apply、哈希、版本推进与存档哨兵。完整包最终哈希/文件数以 Verification/v422-full-verified.json 和 v422-release-state.json 为准。保留所有旧包、存档、模型及原封面配乐；恢复时直接读各实验 report/progress，不重发已经完成的请求。
# 2026-10-30 v4.2.3 当前接续

从 docs/PLAYABLE_SCENES_V423.md 与 Verification/v423-release-state.json 接续；不要再重跑 v4.2.2 已发布流程。本轮完成持久遭遇、256 seed 初遇覆盖、真实变化余波、人口居民、复合抵达先登记后校验、turnCue 保留事实声明，完整 362/362 含 workerd。实际 5 轮重大变化场次完成，另一 seed 3 轮也完成（一次服务商 400 后恢复原输入）；正文仍会职业化、补装饰，不宣称已达到真人/小说完美质量。

最后进一步将部分开局从醒后问诊改为认错人、挡路与临行邀约；网页实际检查使用 v423-browser-0，进度存 v423-browser-deployed。发布完成以 release-state.complete 为准，未写完成前不能声称线上/安装/包均已成功。保留全部原版文件与玩家数据。
