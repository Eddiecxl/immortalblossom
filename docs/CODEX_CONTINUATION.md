# Game Beta v4 continuation

Read `../AGENTS.md` and `ENGINE_CONTRACT.md` first. They are the persistent map of actual v4 world rules, SQLite storage, AI routing, preservation constraints and known gaps. In `4.0.2`, interactions use world-backed, model-first conversation planning and validation across seeds; generic deterministic fallback is limited to existing facts. Avoid seed-specific dialogue scripts. Keep the 4.0.1 title menu layout change.

Current working release folder: `Luoxian-Beta-v4-Full/Luoxian Beta v4`, root version `4.0.2`. Original baseline ZIP `Luoxian-Beta-v4-Full.zip` remains `4.0.0`; its player can update directly to 4.0.2. Player-facing version is `Game Beta v4`; old v3.4 patches are not v4 inputs.

Implemented systems: Astra persistent world Engine, scheduler, context compiler, validator, quest anchors, per-turn story progression and SQLite checkpoints; recent echoes summaries, speech/action separation, bounded cooldown, local-first AI routing, model manager, MP4 title loop, Launcher news and native patch updater.

The legacy `%LOCALAPPDATA%/LuoXian/Saves/*/world.db` schema uses `state_json` rather than `record`. `WorldDatabase` skips it during read-only scan and rejects incompatible writes before mutation. Do not delete player saves.

Validation includes all Node tests, multi-seed opening and interaction tests, native updater and SQLite checks, manifest/repair checks, and patch trial installation from the original 4.0.0 ZIP. Full native UI smoke previously hit a localhost RuntimeHost timeout in this execution environment; visual/gameplay acceptance remains unverified here. Qwen3.8-27B is not included or validated on this machine.

Future patch baseline is the v4 full ZIP. For game file changes rebuild game/version.json, game/manifest.json and repair/game.bundle.zip before making a 4.x.y patch. Launcher news must describe every future update.
