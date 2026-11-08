# v4.2.6 开局供应商与低等待

用户授权：减轻落笔半分钟等待，维持真实限流保护；新旅程选择Groq或Google Gemini 3.8 Flash，旅程中不可切换，换供应商只能新开。Google beta共用Key另存Maintenance/Private，不进入源码/包/存档。玩家可以配置自己的Key。

设计：存档增加经过校验的aiRoute，开局确认后固定provider/model；旧档依旧有已用供应商迁移，无记录的旧云端档默认Groq。世界/系统回合、读档/分叉均取存档路由；设置只能编辑当前供应商凭据。云端复用持久队列和幂等事务，按provider+凭据隔离；Google使用官方OpenAI兼容接口、low reasoning、不发已弃用temperature，429尊重RetryInfo/Retry-After。不能轮换供应商规避限额。桌面沿用现有RuntimeHost实际支持能力，须实测。

提速先实测拆分等待、生成、修复；作者上下文减少重复投影和重复提示，完整数据库及校验视图保留。不得截断玩家输入或删去同意/物品归属/任务条件来换速度。改为单回合完整事实和近期具体对白，保留实际相关召回；无法压缩的必要事实仍可使用原完整路径。

- [ ] 建立耗时基线及回归：路由锁定/读档、Gemini接口参数/凭据隔离/重试、上下文事实保留。
- [ ] 实现双供应商队列和GoogleKey配置，锁定旅程路由与开局选择UI。
- [ ] 优化实际重复上下文、排队等待与修复，实测Groq/Gemini完整回合。
- [ ] 完整回归、实际浏览器/本地、版本与补丁、GitHub/Cloudflare部署；保留全部已有数据。

官方依据（2026-11-03核验）：https://ai.google.dev/gemini-api/docs/latest-model 、https://ai.google.dev/gemini-api/docs/openai 、https://ai.google.dev/gemini-api/docs/pricing 、https://ai.google.dev/gemini-api/docs/rate-limits 。3.8 Flash标准档有免费输入/输出；配额按项目，low思考受支持，minimal不支持，不带temperature/top_p/top_k。
