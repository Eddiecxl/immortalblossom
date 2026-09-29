# 落仙 · Game Beta v4

单人修仙文字 RPG。Astra 世界引擎负责人物、地点、时间、物品、任务、关系和言出法随的真实结算；本地或云端 AI 只描述已经发生的世界。每个旅程用独立 SQLite 数据库保存完整状态和检索摘要。

当前源码版本为 `4.0.2`。仍在使用原始 `4.0.0` 完整包的玩家可直接安装 `Luoxian-Update-4.0.0-to-4.0.2.lxpatch`，无须先安装 4.0.1；旧 v3 补丁不适用。发布包包含闭源 `RuntimeHost.exe`、运行时、音画资源和 repair bundle，这些大文件未放入此源码仓库。源码仓库不是可直接启动的完整游戏；完整包与对应补丁应一起分发。

维护世界逻辑先看 [引擎与存档契约](docs/ENGINE_CONTRACT.md) 和 [AGENTS.md](AGENTS.md)。源代码在 `game/`、`launcher/`、`Source/native/`；回归测试在 `Source/tests/`。运行 `node --test Source/tests/*.test.mjs`。改动游戏文件后用 `Source/Rebuild-GameBaseline.ps1` 更新清单和修复包，再用 `Source/Build-AstraPatch.ps1` 从原始完整 ZIP 生成补丁。不要提交用户存档、API Key 或下载的模型。
