# CLAUDE.md — working rules for this repo

## Who you're working with

Diego is a **non-programmer**. Claude writes, tests, and pushes all code; Diego runs
commands locally and handles the browser/game/device. Keep replies in plain steps,
ship working code, and verify pushes actually landed on GitHub.

## Hard rules

1. **Never remove or regress an existing feature without Diego's explicit
   authorization.** If a rewrite or refactor would drop UI, behavior, or data
   (even temporarily), say so first and get a yes. If you discover a feature
   went missing, restoring it is the top priority.
2. **Test before you push.** Run the affected server (`node server.js`,
   `node vault-verdict.js`), hit the real endpoints, and load the page in a
   browser when UI changed. Bungie-facing code must be verified against the
   live API, not assumed from docs.
3. **Commit and push to `origin main`** when a piece of work is done. Small,
   described commits.

## Mandatory documentation upkeep (do this every session)

Before you finish any work session, update **both** docs so a brand-new agent
with zero conversation context can pick up exactly where you left off:

### `docs/HANDOFF.md` — what exists (current state)
- **Files table**: every file in the repo that matters, one line on its role.
  Add new files the moment they're created.
- **"What works now"**: every shipped feature, with the non-obvious technical
  facts baked in (bucket hashes, component numbers, manifest quirks, encoding
  details) so nobody has to rediscover them.
- **How Diego runs it**: exact commands / URLs, kept current.
- Diego's vision & priorities section: update it when he states a new priority.

### `docs/NEXT_PHASE.md` — what's next (the pickup point)
- **Where we are**: one paragraph, dated, saying what was just finished and
  what the next task is.
- **Per planned feature**: goal in Diego's words, the design as agreed so far,
  **which files it will touch**, API/data notes already researched, and an
  **open questions** list with Diego's answers recorded verbatim once given.
- Order features by Diego's stated priority. Mark anything blocked on an
  answer from Diego as **BLOCKED: awaiting Diego**.

When a feature ships: move its content from NEXT_PHASE.md into HANDOFF.md's
"What works now" and delete it from NEXT_PHASE.md. Never let the two drift —
these two files ARE the handoff; the chat history is disposable.

## Repo map (details in docs/HANDOFF.md)

- **TRMNL display**: `server.js` + `render.js` + `start-display.ps1` — always-on
  e-ink/phone dashboard for Destiny 2 orders/quests/triumphs/seals.
- **Vault Verdict**: `vault-verdict.js` (server, port 8787) + `vault-verdict.html`
  (frontend) — Armor 3.0 vault triage with set-bonus ratings and exotic
  favorite-stat tuning.
- Auth/tokens shared via `.env` + `tokens.json` (`node auth-and-snapshot.js` to
  re-auth). Manifest caches are gitignored and rebuilt on demand.
