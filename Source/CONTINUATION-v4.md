# Game Beta v4 continuation

Original full ZIP: `Luoxian-Beta-v4-Full.zip`, root version `4.0.0`. Working release folder is now `4.0.1`; the 4.0.0-to-4.0.1 patch is in `Patches`. Player-facing display remains `Game Beta v4`. Old v3.4 patches are not v4 inputs. Read `docs/ENGINE_CONTRACT.md` and `AGENTS.md` before future engine changes.

Implemented systems: Astra persistent world Engine, scheduler, context compiler, validator, quest anchors, per-turn story progression and SQLite checkpoints; recent echoes summaries, speech/action separation, bounded cooldown, local-first AI routing, model manager, MP4 title loop, Launcher news and native patch updater.

The legacy `%LOCALAPPDATA%/LuoXian/Saves/*/world.db` schema uses `state_json` rather than `record`. `WorldDatabase` skips it during read-only scan and rejects incompatible writes before mutation. Do not delete player saves.

Validation: 79 Node tests including deterministic 1000-turn soak and static asset references, native build and updater self-tests, SQLite regression self-test, v4 patch builder tests, game manifest and repair bundle checks. Full native UI smoke still hits a localhost RuntimeHost timeout in this execution environment, so visual/gameplay acceptance remains unverified here. Qwen3.8-27B is not included or validated on this machine.

Future patch baseline is the v4 full ZIP. For game file changes rebuild game/version.json, game/manifest.json and repair/game.bundle.zip before making a 4.x.y patch. Launcher news must describe every future update.
