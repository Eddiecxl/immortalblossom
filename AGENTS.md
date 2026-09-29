# 落仙 v4 维护约定

先读 `docs/ENGINE_CONTRACT.md`，再修改游戏、启动器、存档或补丁。该文档记录当前代码**实际实现**的世界规则与尚未实现的目标。不得把模型叙事当成世界事实，不得仅修改画面文字而不更新世界状态。修改任何世界字段、存档格式或 AI 路由时，补相应的回归测试并运行 `node --test Source/tests/*.test.mjs`。

保护用户存档和模型：不要删除、覆盖 `%LOCALAPPDATA%/LuoXian/Saves` 或 `runtime`。新存档 schema 必须有迁移或拒写旧档的路径。补丁仅用 `Source/Build-AstraPatch.ps1` 的许可路径，以原始 v4 完整 ZIP 为基线；修改 `game/` 后重建 `game/manifest.json` 与 `repair/game.bundle.zip`。版本、补丁和源码要一致。

游戏目标是可持续的单人 AI 文字 RPG；人物、物品、任务、地点、关系、死亡和言出法随的影响要由 Engine 记录并跨回合保存。AI 只负责表达，不应凭文字制造、撤销或重复 Engine 效果。云端额度不可能无限，优先利用本地事实、SQLite 回忆及必要时的云端润色，不得宣称绕过供应商限制。
