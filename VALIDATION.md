# Game Beta v4.1.3 验证记录

根 version.json、game/version.json 与游戏 manifest 均为 4.1.3。实际游戏已更新，启动器读取根版本；无需再次给本安装应用补丁。

- 201 项 Node 回归通过，覆盖多个 seed 的约定、任务依赖、归属、同意、奖励资金、记忆、旅行和限流失败不提交。
- 真实 WebView2 / RuntimeHost 窗口使用用户选择的 Qwen3 14B Q4_K_M，并以 Groq 作两场对照。测试在独立保存区运行；详见 docs/ACTUAL_PLAYTEST_V413.md 与 docs/playtests/v413-native-summary.json。
- 本地实际接受归还约定完成 pending → fulfilled，物品归属和双方行囊更新，SQLite 读回同一 checkpoint。NPC 拒绝归还时没有发回物品。
- 原生 SQLite 自测完整性为 ok，验证因果/承诺投影、检索、备份、过期 revision 拒绝及中途失败回滚。
- 4.1.2 → 4.1.3 补丁通过原生 Validate / Apply、安装后 SHA-256、版本推进与存档哨兵验证。游戏清单包含 112 项，修复包与游戏文件一致。
- 完整包使用 SHA256SUMS 和游戏清单逐项验证，再清理上一完整 ZIP。包不含玩家正式存档、凭据或浏览器配置。

可提交率不代表文学质量。小模型仍会复读或误解，事实检查失败可能产生明确标记的有限回应；Groq 免费额度仍受供应商限制。当前引擎也不能表达所有想象得到的新规则。没有将这些边界宣称为已解决。
