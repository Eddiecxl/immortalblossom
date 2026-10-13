# 落仙 · Game Beta v4

单人修仙文字 RPG。Astra 世界引擎负责人物、地点、时间、物品、任务、关系和言出法随的真实结算；AI 可以提出结构化变化，经引擎校验后落账，并叙述结果。每个旅程用独立 SQLite 数据库保存完整状态和检索摘要。

当前版本 `4.2.0`。[直接打开云端 Beta](https://immortalblossombeta.eddiechanxule.workers.dev)。网页含启动器、原动漫封面、电影 Logo、落仙配乐与完整 Astra 游戏。默认 Groq 云端 AI；Key 在 Worker 私密配置中，玩家可在 AI 设置使用自己的 Groq Key。云端限流会排队续接同一输入，不以重复剧情冒充新回合。桌面版继续保留本机 SQLite、模型与原启动器功能。

世界、所有权、任务依赖与人物知识由 Engine 结算，完整世界与行记保存在命簿；每轮只召回有关事实。明确言出法随不受主角境界限制，不能被模型擅自否定。尚不能保证任意新概念都已有执行语义；免费 Groq 配额也不能无限使用。实现边界见 [ENGINE_CONTRACT.md](docs/ENGINE_CONTRACT.md)、[OPEN_INTERACTION_V413.md](docs/OPEN_INTERACTION_V413.md) 与 [云端发布说明](docs/CLOUD_BETA_V420.md)。

GitHub main 推送会运行回归并构建网页。按用户2026-10-13选择，当前保留手动Cloudflare部署：`cloud`安装依赖后运行`npm run deploy`。以后配置有效仓库Secret `CLOUDFLARE_API_TOKEN`后，可将仓库Variable `CLOUDFLARE_AUTO_DEPLOY`设为`true`启用自动部署，也可手动运行workflow并勾选deploy。Worker Secret `GROQ_API_KEY`继续保存在服务器；凭据不得写入源码或公共包。构建：`node cloud/build-web.mjs`。完整桌面包包含公开Worker源码、闭源RuntimeHost、模型和修复包；源码仓库不包含运行器和模型二进制。

维护世界逻辑先看 [引擎与存档契约](docs/ENGINE_CONTRACT.md)、[AI 世界模拟长期需求](docs/AI_WORLD_SIMULATION_VISION.md) 和 [AGENTS.md](AGENTS.md)。长期目标包括 AI 理解与后果提案、动态剧情、人物社会认知和系统主动反馈；该目标文档不代表当前版本已经实现。源代码在 `game/`、`launcher/`、`Source/native/`；回归测试在 `Source/tests/`。运行 `node --test Source/tests/*.test.mjs`。改动游戏文件后用 `Source/Rebuild-GameBaseline.ps1` 更新清单和修复包，再用 `Source/Build-AstraPatch.ps1` 从原始完整 ZIP 生成补丁。不要提交用户存档、API Key 或下载的模型。
