# AI World Simulation Implementation Plan

> Implement inline using superpowers:executing-plans and test-driven-development. User approved the written world-simulation design and requested execution.

**Goal:** Make AI-proposed world changes, causal social reactions, autonomous plans and proactive companion messages real persistent gameplay.
**Architecture:** Typed model proposals execute on a cloned world; validated atomic operations emit causal events. Local propagation updates knowledge, beliefs, relationships, plans, tasks and companion notifications, then validated prose and the world commit together.
**Tech Stack:** Browser ES modules, Node test runner, .NET Framework host, SQLite.
**Spec:** `docs/AI_WORLD_SIMULATION_VISION.md`.

## Global Constraints

- Keep stable entity IDs, schema-6 save compatibility and existing user saves/models.
- Explicit personal/global 言出法随 scope; regular speech is not execution of physical intent.
- No executable model code, SQL or arbitrary object-path assignment.
- Batch world reasoning with narration through the existing provider; keep provider routes and rate limits.
- Invalid candidate or storage failure must not partially commit; retries use the same transaction ID.

## Review Focus

- Negation/hypothetical speech cannot kill/create/teleport a player.
- Unknown references, oversized plans and prototype paths are rejected before any commit.
- Uninformed observers cannot know distant events; indirect reports keep uncertainty.
- Changes and delayed effects survive reload and branch rollback without repeating.
- A provider failure cannot silently erase a proposed action or manufacture a successful change.

## Task 1: Causal events, beliefs and proactive companion

Create `game/astra-causality.js`; test `Source/tests/astra-causality.test.mjs`.
Interface: `ensureSimulation(world)`, `recordCausalEvent(world,event)`, `propagateCausality(world)`, `assessIntent(world,input,targetId)`; all manipulate a draft only and return new events/notifications.
- [x] Write and observe failing tests for event idempotency, observer-dependent reaction, delayed gossip, risk warning and persistence.
- [x] Implement event/knowledge/belief graph, bounded propagation, NPC response plans and deduplicated notifications.
- [x] Verify cross-seed, remote observers and source-world preservation.

## Task 2: Generic atomic operations and declarative rules

Create `game/astra-operations.js`, `game/astra-expression.js`; test `Source/tests/astra-operations.test.mjs`.
Interface: `applyWorldPlan(source,plan,context) -> {world,events}`, `evaluateCondition(world,condition,bindings)`, `settleWorldRules(world,events)`.
- [x] Failing tests for entity create/update, stable identity, resource transfer, relationship changes, dynamic tasks, item conditions, scope/authority and atomic rejection.
- [x] Implement bounded typed operations with factual sources, safe fields, live bounds and Engine lifecycle functions.
- [x] Add declarative event/item conditions; validate references and prevent repeated effects.
- [x] Verify rule replacement, unknown attributes and transaction replay.

## Task 3: AI proposal and world-turn integration

Create `game/astra-plan-prompt.js`; modify `astra-turn.js`, `astra-local-prompt.js`, `astra-context.js`, `astra-director.js`, `astra-effects.js`, `astra-world.js`, `ai-client.js` if parsing drops the plan.
- [x] Failing integration tests: an AI-created NPC/quest exists after commit, unknown reality instructions use a plan, bad plans retry without drift, proactive sys blocks persist without system chat.
- [x] Send supported operations and relevant relation/belief/event facts in existing model request; apply `worldPlan` before narrative validation, never legacy arbitrary effects.
- [x] Run propagation for mechanical actions and plans; include system messages and director plans in UI/world context.
- [x] Verify no extra cloud request for ordinary deterministic calculations, exact player speech, all legacy tests.

## Task 4: SQLite projection and UI connection

Modify `Source/native/WorldDatabase.cs`, `game/v4/v4.js`; extend native SQLite self-test and add JS persistence tests.
- [x] Failing checks for causal event/relationship/belief/rule/notification projections and rollback/reload.
- [x] Add additive indexed tables within the existing checkpoint transaction; retain old-schema refusal.
- [x] Expose true dynamic tasks/proactive companion memory in existing panels.
- [x] Verify native self-tests and packaged imports.

## Task 5: Review, model playtest and release

- [x] Run full Node regressions, generated cross-seed/long-turn scenarios and native tests; inspect all failures.
- [x] Run isolated local-model plan playtest if the installed runtime is available; report model limitations honestly.
- [x] Update actual Engine contract, progress ledger, Launcher news and version; rebuild manifest and repair bundle.
- [x] Build and trial-install patches from original 4.0.0 and current 4.0.4; preserve save sentinel and validate hashes.
- [ ] Publish tested source to GitHub main under the user's prior authorization and return patch links.
