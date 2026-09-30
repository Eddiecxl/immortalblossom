# Game Beta v4 continuation

Original full ZIP: `Luoxian-Beta-v4-Full.zip`, root version `4.0.0`. Working release folder is now `4.0.3`; direct 4.0.0-to-4.0.3 and 4.0.2-to-4.0.3 patches belong in `Luoxian-v4.0.3-Patches`. Player-facing Launcher reads the exact installed version from `game/version.json` and confirms a successful patch after health validation. Old v3.4 patches are not v4 inputs. Read `docs/ENGINE_CONTRACT.md` and `AGENTS.md` before future engine changes.

Implemented systems: Astra persistent world Engine, scheduler, context compiler, validator, quest anchors, per-turn story progression and SQLite checkpoints; recent echoes summaries, speech/action separation, bounded cooldown, local-first AI routing, model manager, MP4 title loop, Launcher news and native patch updater.

The legacy `%LOCALAPPDATA%/LuoXian/Saves/*/world.db` schema uses `state_json` rather than `record`. `WorldDatabase` skips it during read-only scan and rejects incompatible writes before mutation. Do not delete player saves.

Validation must include all Node tests plus the multi-seed conversation/opening contract, native updater self-tests, SQLite checks, game manifest and repair bundle checks, and trial install from the original full ZIP. Full native UI smoke has previously hit a localhost RuntimeHost timeout in this execution environment; visual/gameplay acceptance remains separate. Qwen3.8-27B is not included or validated on this machine.

Future patch baseline is the v4 full ZIP. For game file changes rebuild game/version.json, game/manifest.json and repair/game.bundle.zip before making a 4.x.y patch. Launcher news must describe every future update.
