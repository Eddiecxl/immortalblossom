当前接续：4.2.1 修复真实在场人物显示，改进连续互动/自然表达/内部评分隐藏、普通伤势不弹窗及游戏默认静音。源码仍在 Maintenance/Repository。全套290项含实际workerd SQLite通过；真实云端8轮 unusual 已通过，关系负向变化、死亡/复活/记忆/刷新及默认零音乐源已验证。普通聊天与轻短身份询问正在另一seed复测，发布结果见 Maintenance/Verification/v421-release-state.json。保留所有旧文件、存档、模型与密钥，不重复已完成的4.2.0工作。

# Game Beta v4 continuation

Original full ZIP: `Luoxian-Beta-v4-Full.zip`, root version `4.0.0`. Working release folder is now `4.0.4`; direct 4.0.0-to-4.0.4 and 4.0.3-to-4.0.4 patches belong in `Luoxian-v4.0.4-Patches`. Player-facing Launcher reads the exact installed version from `game/version.json` and confirms a successful patch after health validation. Old v3.4 patches are not v4 inputs. Read `docs/ENGINE_CONTRACT.md`, `docs/ENGINE_MUTATION_DESIGN.md` and `AGENTS.md` before future engine changes. The new variable engine covers registered fields and explicit wording, not arbitrary natural-language mechanics.

Implemented systems: Astra persistent world Engine, scheduler, context compiler, validator, quest anchors, per-turn story progression and SQLite checkpoints; recent echoes summaries, speech/action separation, bounded cooldown, local-first AI routing, model manager, MP4 title loop, Launcher news and native patch updater.

The legacy `%LOCALAPPDATA%/LuoXian/Saves/*/world.db` schema uses `state_json` rather than `record`. `WorldDatabase` skips it during read-only scan and rejects incompatible writes before mutation. Do not delete player saves.

Validation must include all Node tests plus the multi-seed conversation/opening contract, native updater self-tests, SQLite checks, game manifest and repair bundle checks, and trial install from the original full ZIP. Full native UI smoke has previously hit a localhost RuntimeHost timeout in this execution environment; visual/gameplay acceptance remains separate. Qwen3.8-27B is not included or validated on this machine.

Future patch baseline is the v4 full ZIP. For game file changes rebuild game/version.json, game/manifest.json and repair/game.bundle.zip before making a 4.x.y patch. Launcher news must describe every future update.


2026-10-14 当前最终状态：4.2.1已安装并发布main；Cloudflare经GitHub Actions run38426906543成功部署，291/291。实际8轮unusual和另一seed2轮normal已提交；扩展normal第三轮及tone比较尚未完成，Groq完整请求已实测429 TPD，短JSON模式请求200。UI/关系/死亡复活/刷新/静音已验证，不宣称所有文风已完美。恢复：Verification中运行node v421-playtest.mjs v421-natural-18 normal resume，使用保留的同一事务与job，不重新发生成；成功后LX_PLAY_OUT=v421-tone-retested运行same-seed tone。先遵守v421-direct-tone/quota.json记录的等待再试。源码/安装/补丁已一致；包装和发布最终状态查看v421-release-state.json。保留全部原文件、模型与存档。
