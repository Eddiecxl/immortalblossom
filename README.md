# 落仙 · Game Beta v4

单人修仙文字 RPG。Astra 世界引擎负责人物、地点、时间、物品、任务、关系和言出法随的真实结算；AI 可以提出结构化变化，经引擎校验后落账，并叙述结果。每个旅程用独立 SQLite 数据库保存完整状态和检索摘要。

当前源码及完整包版本为 `4.1.3`，更新补丁基线为 `4.1.2`。后续以最新完整 ZIP 作为新基线。新增真实物品交付约定、任务依赖、开放语义关系判断和事实校验；实现范围见 [OPEN_INTERACTION_V413.md](docs/OPEN_INTERACTION_V413.md)。完整包包含闭源 RuntimeHost、模型、音画资源和修复包；源码仓库不是可直接启动的游戏。真实试玩及模型限制见 [ACTUAL_PLAYTEST_V413.md](docs/ACTUAL_PLAYTEST_V413.md)，长期规则见 [ENGINE_CONTRACT.md](docs/ENGINE_CONTRACT.md)。

维护世界逻辑先看 [引擎与存档契约](docs/ENGINE_CONTRACT.md)、[AI 世界模拟长期需求](docs/AI_WORLD_SIMULATION_VISION.md) 和 [AGENTS.md](AGENTS.md)。长期目标包括 AI 理解与后果提案、动态剧情、人物社会认知和系统主动反馈；该目标文档不代表当前版本已经实现。源代码在 `game/`、`launcher/`、`Source/native/`；回归测试在 `Source/tests/`。运行 `node --test Source/tests/*.test.mjs`。改动游戏文件后用 `Source/Rebuild-GameBaseline.ps1` 更新清单和修复包，再用 `Source/Build-AstraPatch.ps1` 从原始完整 ZIP 生成补丁。不要提交用户存档、API Key 或下载的模型。
