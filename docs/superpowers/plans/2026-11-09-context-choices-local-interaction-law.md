# Context choices and local interaction law implementation plan

Goal: replace fixed UI action bar with choices grounded in this accepted scene; execute fully understood nonnumeric interaction laws without cloud availability, and resume still-semantic queued laws automatically with their original transaction.

Architecture: a standalone astra-choices view validates same-response suggestions against the current world and stores a bounded scene/location-bound snapshot. No extra model request and no automatic player consent. The fallback uses actual last dialogue, pending offers, usable inventory, travel and accessible routes. Speech choices fill speech; actions fill actions. Local law compiler recognizes whole interaction clauses using live world names/pronouns and strict supported interaction grammar, preserves exact full command/duration and uses existing experience/causality transactions. Compound mechanical or ambiguous commands remain one atomic semantic proposal; never pretend an unparsed clause happened. Cloud quota is not infinite; persistent pending input auto-resumes without repeatedly reopening the law modal or replacing the author.

- [ ] Red tests: changing scenes/ownership/life invalidates stale choices; conversation choices vary, no fixed train/wait; speech/action form routing.
- [ ] Red tests: contact/posture/gesture multi-clause laws execute locally, exact duration+memory+scope persist, no cloud calls; unsupported mixed effects remain atomic.
- [ ] Implement choices in parse/turn/aftermath and UI; local compiler in existing reality transaction; pending queue retry with original request and cancellation.
- [ ] Full tests, skill-required independent review, actual Groq+production browser tests, version/local/package/GitHub/Cloudflare verification and continuation evidence.

No schema reset, seed replacement, music/art changes, model/save deletion or provider quota bypass.
