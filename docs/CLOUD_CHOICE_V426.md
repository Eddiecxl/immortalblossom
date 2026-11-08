# v4.2.6 云端选择与长档等待

2026-11-08 用户要求缩短持续增长的落笔等待、保留实际限额保护，并在启程时选择 Groq 或 Google Gemini 3.8 Flash；此旅程不能切换供应商，换供应商只能另开旅程。用户已提供 beta Google Key，另存 Maintenance/Private，并通过加密 GitHub Secret 配置到 Worker；源码、ZIP、存档不含 Key。

journey-ai.js 将 provider/model 锁入 schema-6 的 aiRoute。migrateGameState 校验并保留；世界和系统请求均由 journeyAiSettings 覆盖全局设置。手动读档的分叉沿用原选择。旧档进入时根据既有 sticky/设置绑定其原供应商；没有记录的旧默认云端路线仍为 Groq。新旅程界面只提供 Groq / Gemini；凭据可以更新，供应商不能在旅程里改。

Worker 与 GroqQueue 沿用原 Durable Object 类名，以 provider+凭据散列隔离队列/个人凭据/配额。Google 使用官方 OpenAI 兼容端点、gemini-3.8-flash、reasoning_effort:low，省略已弃用 temperature。Google RetryInfo 与 Retry-After 均控制同一持久任务的真实等待，不以切换供应商规避额度。各玩家/共享 Key 仍受其项目实际额度约束。

桌面云请求经 CloudRelay 原生桥转发到固定 beta Worker；会话 Cookie 由当前 Windows 用户 DPAPI 保护，保存于 LocalAppData/LuoXian/CloudSession.bin。桥只允许固定 Worker 的 /api/ai/cloud/ 路由。世界存档仍由原 SQLite/事务引擎保存，不把服务端 AI Cookie 当作游戏存档。

实际复现：一份测试长档在第9回合已因作者视图中的重复 memory/event UUID 超预算，HTTP请求根本没有发出。压缩只移除作者不需要的重复存储编号，保留事实、来源、知情者及需要引用的证据关联；完整世界与校验包不变。普通操作提示改成较短英文结构说明，正文仍中文。相同测试存档候选复玩约3293毫秒完成、一请求；这是实测样本，不是任意免费额度下的速度承诺。新增 long-save-author 夹具防回归。

Google Key 直连官方 3.8 Flash 连接实测成功，约5.6秒。当前本地419项中418通过，真实workerd一项待CI验证；完整发布状态见 Maintenance/Verification/v426-release-state.json，未 complete 前不可宣称全部发布。
