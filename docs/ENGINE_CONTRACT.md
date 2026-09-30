# 落仙 v4 世界引擎与维护契约

本文依据 v4 源码整理，描述**已经实现**的行为；“希望实现”的玩法不能被误写成当前事实。维护时请先定位下方对应模块，再修改，并用 `Source/tests` 中的场景验证。用户的核心要求是世界状态长久一致，人物、物品、任务、关系、时间和剧情互相影响；AI 不得替代引擎结算。

v4.1.2 更新：开局明确主角穿越，并从当局在场人物、真实目标、有效任务和道路生成下一步建议。未知英文目标不猜成势力事务；死者或异地给予者不能成为直接问话建议。旅行中 player.locationId 保留记录用出发地，player.travel 才表示当前路途；不能让原地居民听见或回应玩家，也不能把途中叙述为已抵达。AI 无效而改用世界事实有限回应时，会记录 turn.diagnostics 并明确提示玩家；未承诺所有自然语言虚构均能被校验检测。实测及边界见 ACTUAL_PLAYTEST_V412.md。

## 状态与单次回合

`game/game-state.js` 创建/迁移 UI 状态；`state.astraWorld` 是权威世界。`game/astra-world.js` 用 seed 创建地点、有向道路、人物、势力、物品、任务、锚点和事件队列。`game/astra-seed.js` 用带标签的随机流保证同 seed 可复现，而且加一处随机抽样不应连锁改掉其他流。角色开局是凡人，有背景、家庭、财富、安全、境界、健康、位置和行囊。`normalizeAstraWorld` 从保存的世界恢复，不要用新模板覆盖旧玩家选择和历史。

游戏 UI 从 `game/v4/v4.js` 调用 `game/ai-turn.js`，`runWorld` 进入 `game/astra-turn.js`。回合顺序：拆开玩家原话 `speech` 与行动 `action` → 根据发言时的世界状态确定会话对象和可知事实 → 机械解析行动/言出法随 → `game/astra-scheduler.js` 推进时间和到期事件 → `game/astra-quests.js` 等模块结算 → `game/astra-director.js` 提供已记录的下一步线索 → `game/astra-context.js` 编译有限且只读的叙事事实 → 本地或云端 AI 叙述 → `game/astra-validator.js` 与 `game/astra-interaction.js` 检查候选 → 追加原样玩家对白 → 保存世界和回合记录。失败时不提交草稿世界或半条行记。模型连续给出复读/空答时，引擎只能用已有事实给出有限答复；不能在兜底文字中创造任务、人物或效果。

`player-turn.js` 是主角对白唯一来源。模型不得改写玩家所说的话，旁白也不要出现空的“我说，”。`recordHeardSpeech` 只让同地点存活人物记住听到的话；关系变化要存进该人物的 `relationships[player]`，不能只写在对白里。`projectAstraWorld` 把气血、境界、行囊、任务等世界结果映射到 UI。不能反向以 UI 数值覆盖世界。

## 关联规则

| 数据 | 权威记录与影响 |
| --- | --- |
| 人物 | `characters[id]` 含位置、生死、目标、势力、家庭、记忆、知识、关系、行囊、旅行。`astra-npc.js` 按重要程度定时行动；旅行中 `locationId=null`，原地与目的地存入 `travel.from/to`。死亡 `killNpc` 释放物品、保留可追溯落点、取消行程并触发任务调解。只有发言时同地点且活着的 NPC 能直接讲话。 |
| 地点和时间 | `locations`、`edges`、`minute` 与排序的 `eventQueue` 决定可达性和事件发生时刻。移动必须走可通行道路；场外事件会继续结算。 |
| 任务和剧情 | `quests` 的状态包括 available、active、mutated、completed、failed、expired、abandoned、resolved-by-other、invalidated。任务有给予者、目标、截止时间、奖励和状态历史。死亡、毁址、阵营变化、超期等会影响任务；完成后的奖励、好感和后续任务在引擎结算。`anchors` 提供窗口化的长期剧情机会；无人响应也会在场外解决。 |
| 物品和效果 | `items` 实例有 template、owner、quantity、creationHistory、transferHistory、destroyed 和结构化 effects。生成物品只有可解析且允许的 `astra-effects.js` 效果能生效；消耗记录来源并更新行囊。普通任务物品交付会减数量和转移历史。 |
| 势力与世界 | `factions`、territories、relations、memberIds、pressure、rumors、secrets、history 共存。NPC 的知识边界由 ID 管理；叙述不得泄露其未知秘密。 |
| 死亡和言出法随 | `astra-reality.js` 先计划、后结算，按明确类型改写现实并记录代价。自杀/死亡和终局看 `astra-terminal.js`，终局是吸收态；不要让 AI 口述复活。仅已有规则支持的保命物品或效果才可救命。 |

`game/astra-rules.js` 与 `game/astra-variables.js` 维护存档内境界上限和注册数值的边界；`astra-effects.js` 的普通效果与 `astra-reality.js` 的言灵结算应读取同一套当前规则。明确“天下／世界”的上限言灵改世界范围，普通“我的”只改主角；境界提升在当前上限必须无效果，不能附带气血收益。数值变更应记录实际增量，并在势力归零时解除领地和人物关联。当前仍只支持 Engine 可解析的结构化字段及效果，不能宣称任意自然语言或任意新规则都已执行；设计边界见 `docs/ENGINE_MUTATION_DESIGN.md`。

`game/astra-content.js` 是模板目录，世界实例才是当局事实。不要把未接受的机会说成已完成任务，也不要把道路风险内部评分读成人物对白。开场 `astra-opening.js` 的机会是**传闻**，不保证医者或商队就在玩家面前；其记录进入 `rumors`，要交谈仍须确认 `characters` 中有人真实在场。林小满有带 seed 的角色、目标和预定的 `lin_first_encounter` 事件；当前代码没有保证她一定是玩家第一个看见或交谈的人，也没有可验证的 100 小时终局内容。未来若补这两项目标，必须设计真实状态迁移和长程测试。

## AI 与记忆

v4.1.0 新增 AI 结构化世界提案、因果信念、延迟消息、真实 NPC 反应计划、条件任务和系统主动提醒。维护时必须阅读 [ENGINE_SIMULATION_V410.md](ENGINE_SIMULATION_V410.md) 的实际行为与边界；它扩展旧版回合链。提案先执行于副本、再校验叙事；不能将“模型只是作者”的旧限制当成永久产品目标，也不能跳过 Engine 执行模型任意效果。

`game/v4-hybrid-client.js` 管理 local、hybrid-assist 或固定云提供商、模型、短时 sticky 路由与请求门控。hybrid 通常先用本地模型，失败时云辅助；校验失败也可能再请求修复，因此每次重试都消耗时间/配额。`game/token-budget.js` 的额度保护和 429 等待不能绕过服务商限额。`astra-interaction.js` 按当局在场 NPC、明确称呼/身份、会话焦点、最近说话者和已知事件/传闻/任务建立通用会话契约；AI 优先生成，验证要求被问者给出新回答。连续失败才允许有限的世界事实兜底。改进本地 Qwen 时应减少无关上下文、给明确本轮目标和在场事实、校验复读/空句，再考虑云修复；不能靠更大的模型掩盖状态错误。

`astra-context.js` 提供当前地点、道路、在场人物的身份/职业/势力、可见事件、知识、任务、最近回合和有限记忆，大小有上限。当前会保留最近事实，并按中文双字重合从本地世界中补回与问题相关的较早事件及在场人物记忆；这是查询候选，不会将未发生的事变成事实。`astra-local-prompt.js` 从这份权威事实编译较短的本地叙事请求，区分在场人物与传闻；对 Qwen3 使用 `/no_think`，以免思考内容耗尽短回复预算。该提示词不能保证小模型不编造事实，Engine 校验仍须保留。Native `Source/native/WorldDatabase.cs` 给每个 journey 建独立 SQLite `world.db`，把完整 checkpoint、修订号、角色/关系/物品/任务/锚点/事件等投影表和 `turn_summaries` 放入事务，`memory_fts` 用 FTS5 检索摘要。`game/beta4/save-session.js` 管理自动 checkpoint、三个手动槽和读取时的分叉。不要把全部历史每回合送给云：以 ID 和关联查询召回需要的事实，保留完整资料在本地；FTS 查不到时会回退最近摘要。旧版 `world_state.state_json` 数据库不能直接覆盖，必须迁移或拒写。

## 发布与验证

`game/manifest.json` 和 `repair/game.bundle.zip` 必须匹配 `game/`。以需要支持的实际较旧完整包为基线，目标版本递增；清理旧版本后，最新完整 ZIP 是后续补丁的基线。`Source/Build-AstraPatch.ps1` 会比较 SHA256，限制可改路径，并用 native probe 试装。不要把用户 save、密钥、本地模型或巨大的运行时放入源码仓库。Launcher 版本公告要同步描述更新。

最低回归：seed 重现；人物在场与缺席；直问直答和原样主角台词；NPC 死亡/物品/任务因果；AI 无效回复不提交；重复情节拒收；SQLite 读写和旧库拒写；补丁能从原始基线试装。测试通过并不等于实际动画、字体及所有模型质量已经通过人工验收，必须单独在 Windows 游戏窗口检查。
