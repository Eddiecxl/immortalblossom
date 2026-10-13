# Cloud beta and narrative continuity implementation plan

> For agentic workers: execute inline; independent Worker implementation follows dispatching-parallel-agents. Preserve existing work and player data.

Goal: Default cloud-only AI, durable memory, continued seeded RPG consequences, smooth quota waits, and deploy immortalblossombeta from GitHub while updating the installed game.

Architecture: Keep Astra as the authority. Short per-turn author packets preserve current characters, actual inventory/quest/consent bindings and recent exchange; SQLite/browser ledger supplies recall. Worker static assets serve the existing animated cover, game and launcher. Groq runs behind a server secret with a shared-account serialized durable request queue; optional personal keys isolate their queues. Pending requests remain pending, never fabricate an AI answer or commit a failed proposal. Deterministic local waiting/actions can advance world time without an API call.

Tech: existing JavaScript Engine/WebView2, IndexedDB for browser saves, Cloudflare Workers static assets and SQLite Durable Objects for request coordination, Wrangler, GitHub Actions.

Constraints: Worker immortalblossombeta; Groq default model from current game subject to real availability; API key only private runtime/Worker secret, never Git; preserve original cover/movie/music and all existing folders/versions; cloud launcher hides desktop patch/local-model operations and displays deployed version. Schema6 authoritative saves untouched.

Tasks:
- [x] Worker API: status, credential/clear/test, async generate/poll, serialized per credential queue, Retry-After/reset pacing, idempotency, safe errors and session isolation. Tests before implementation.
- [x] Client: Groq default/migration, queued polling and countdown/cancel, retry deadline consistent across gate/proxy; browser native bridge for saves/recall/preferences, game/launcher close and fullscreen, Groq console link.
- [x] Engine: nonrepeating director hooks from recorded changes; explicit local wait/action path without narrative API calls, memory continuity; multi-seed regressions and actual cloud normal/unusual play.
- [x] Build web assets from release+source, test browser launcher/intro/game/save/load/settings and HTTP media; update desktop version and register supplied key via existing endpoint.
- [ ] Push tested main and GitHub deployment workflow, deploy fresh Worker+secret, verify live website/new journey/Groq response, update installed folder/manifest/repair/full ZIP preserving originals. Save precise continuation record on interruption.

Review focus: concurrent visitors share free quota; refresh/cancel cannot duplicate worlds; 429 waits must not send early; all recalled ownership/consent dependencies survive budget; static site cannot execute desktop-only bridge; no API keys in build/logs/Git; cloud save reload retains transcript boundary.
