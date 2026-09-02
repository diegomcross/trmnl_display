# CLAUDE.md — working rules for this repo

## READ THIS FIRST — where are you running? (Diego 2026-08-29)

**The app runs on Diego's Windows PC. It does not run in the cloud, ever.** The copy at
`C:\Users\diego\Desktop\cola_ai_v3\trmnl_display` IS the app: it holds his `.env`, his Bungie
tokens, his DIM login, his config and his logs, and it is what serves ports 8787 and 3000.
**GitHub is a backup of that copy, not the other way round.**

So before anything else, work out which kind of session you are:

```
node tests/guardrails.js --where
```

**LOCAL session** (Windows, his folder, `.env` present) — this is the one that can actually do
the job:
- Edit the files in `C:\Users\diego\Desktop\cola_ai_v3\trmnl_display` **directly**. Never a copy,
  never a worktree, never a scratch clone.
- Test against the real running servers.
- After a **server-JS** change, reboot it yourself and confirm the ports answer (rule 22).
- **Then** `git push` to GitHub — as a backup of what is already live on his PC.
- Order is always: **edit local → test local → reboot local → push to GitHub.** Never the reverse.

**CLOUD session** (Linux, a fresh GitHub clone, no `.env`) — this one cannot reach his PC at all:
- **Say so in your first reply.** Do not let him assume the work is landing on his machine.
- You cannot reboot his servers, cannot read his tokens, cannot see his logs, and nothing you
  change reaches him until it is merged AND his local copy is updated.
- **Never** end a message with "double-click REBOOT.cmd" or "run this command" as if the file
  were on his PC — on 2026-08-29 exactly that wasted his time twice: he went looking for
  `DIM-DOCTOR.cmd`, which only existed in an unmerged branch in the cloud.
- Best move is usually to tell him to reopen the work in a local session rather than to build
  a pile of PRs he then has to reconcile.

**How Diego avoids cloud sessions:** open Claude Code from his PC — the desktop app or a
terminal in that folder — rather than from the web (claude.ai/code). A web session always runs
in a throwaway Linux container with a fresh clone, no matter which folder he started it from.

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
3. **Work in Diego's local repo and reboot his servers yourself** (2026-08-29):
   *"YOU SHOULD ALWAYS USE THE LOCAL COPY IN MY COMPUTER TO MAKE CHANGES SO EVERYTHING IS
   ALWAYS UPTODATE AND YOU CONTROL REBOOTS AS WELL, NO INTERVENTION FROM ME NEEDED."*
   Edit `C:\Users\diego\Desktop\cola_ai_v3\trmnl_display` directly. After a server-JS change run
   `cmd /c "C:\Users\diego\Desktop\cola_ai_v3\trmnl_display\REBOOT.cmd"`, wait ~30s and confirm ports
   8787 + 3000 answer before reporting. HTML/CSS need no reboot. Never ask him to do it.
   Reverses the old "never restart from the agent shell" rule. Does NOT change: the
   Auto-Manager stays off without his go, and armor Apply stays his button to press.
4. **A cloud session cannot do rule 3.** If `--where` says CLOUD, say so plainly and do not
   promise a reboot or point him at a file he does not have.

5. **Push to `origin main` as a BACKUP once the work is live on his PC.** Small,
   described commits. Pushing is not shipping — his local copy is what runs. A change
   that is only on GitHub has not reached him.

## Mandatory documentation upkeep (do this every session)

**`docs/DIEGO_RULES.md` is the canonical list of every rule and request Diego has
ever given (created 2026-07-17 at his ask, recovered from code/docs/git history).
Read it BEFORE changing scoring, tagging, or UI behavior; append every new Diego
ruling to it the moment he states one — date + verbatim quote.**

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
