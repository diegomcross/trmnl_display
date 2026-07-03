# NEXT_PHASE — where to pick up

> Maintained per CLAUDE.md. When a feature ships, move it to HANDOFF.md
> "What works now" and delete it here.

## Where we are (2026-07-03, latest)

Shipped since phase-1 (all in HANDOFF): 75% god-roll threshold; per-copy
**Equip/Vault** buttons; **Weapon Watch UX overhaul** (full-width copy layout,
direct tag chips, Select-multiple mode, no-jump perk selection); **manifest slim5
icons**; **New Drops dashboard** (`/drops`) with new-drop detection + visual cards.

Remaining bundle (Diego: "bundle as many as possible"):
1. **DIM two-way tag sync** — §0. Two-way DECIDED. Probe written (`dim-probe.js`);
   **BLOCKED: Diego must run `! node dim-probe.js`** (sandbox refuses to let the
   agent transmit his Bungie token to DIM; his own run is the consent). Once it
   prints a tag count + `DIM_API_KEY=…`, build the server integration.
2. **Phase-2 live alerts** — §2. Poll while in-game, detect fresh god-roll drops
   (reuse the `fresh` flag + 75% score), then TRMNL 1-min interrupt + PC sound +
   auto-lock. Touches `server.js` + `render.js`. NOT started.
3. **Fashion loadouts** — §3. Needs a re-auth for cosmetic write scope (Diego action).

## 0. DIM tag sync (NEXT once Diego answers) — BLOCKED: awaiting Diego

**Goal (Diego):** the app's keep/favorite/junk tags and DIM's should be in sync,
not two disconnected systems.

**Feasibility:** DIM exposes a **Sync API** at `https://api.destinyitemmanager.com`.
Everything can be done server-side with credentials we already hold (no browser
steps for Diego); the only prerequisite is **DIM Sync enabled in his DIM settings**
(default on — it stores tags in DIM's cloud keyed to his Bungie login).

**Integration steps (researched, verify exact shapes when building):**
- **Register a DIM API app once:** `POST /new_app` with `{ id, bungieApiKey (ours,
  in .env), origin }` → returns a `dimApiKey`. Store it in `.env`
  (`DIM_API_KEY=`). One-time; self-serve (confirm the endpoint isn't gated).
- **Auth:** `POST /auth/token` header `X-API-Key: <dimApiKey>`, body
  `{ bungieAccessToken (from tokens.json via accessToken()), membershipId (bungie.net
  id), platformMembershipId (the Destiny membershipId we already use) }` → `{ accessToken }`.
- **Read tags:** `GET /profile?platformMembershipId=<id>&destinyVersion=2&components=tags`
  Bearer the accessToken → `{ tags:[{ id:<itemInstanceId>, tag, notes }] }`.
- **Write tags:** `POST /profile` body `{ platformMembershipId, destinyVersion:2,
  updates:[{ action:'tag', payload:{ id, tag } }] }`.
- **Tag vocab mapping:** DIM = `favorite | keep | infuse | junk | archive`; ours =
  `keep | favorite | junk | none`. Map favorite/keep/junk 1:1; our `none` = remove
  the annotation; leave DIM `infuse`/`archive` untouched (don't clobber them).

**Direction — DECIDED 2026-07-03: Diego chose TWO-WAY** (read DIM tags into the app
AND push app tags back to DIM; one source of truth).

**CONSENT GATE (before any build):** DIM Sync works by sending Diego's **Bungie OAuth
access token** to `api.destinyitemmanager.com` (register app + `/auth/token` exchange).
There is no way around this — it's inherent to DIM Sync (DIM already does this in his
browser every session). The sandbox correctly flags it as sending a credential to a
third party. **Get Diego's explicit OK to transmit his Bungie token to DIM before
running the probe / building this.** Then run `scratchpad/dim-probe.js` (read-only:
register → auth → read tags) to confirm the flow, and only after that build the
server integration + swap the tag chips to per-change writes (`POST /api/tag {id,tag}`
→ writes DIM + local mirror, replacing the whole-object `saveTags` — also fixes the
shared-file clobber hazard).

**Files:** `vault-verdict.js` (DIM auth + read/write helpers, merge DIM tags into
`fetchWeapons` / `dimOverlay`, wire the tag `<select>` POST to also push to DIM),
`.env` (`DIM_API_KEY`), maybe a small `dim-token.json` cache (gitignored) for the
DIM accessToken. Frontend `weapon-watch.html`: show DIM tag as the live source.

## Where we are (2026-07-03, later)

Shipped today: set-bonus fix + exotic favorites + build synergy (see HANDOFF),
then per Diego's corrections: **set drop locations restored** (curated map +
manifest fallback), **exotic favorites reworked** (max 2 ordered stats =
primary›secondary, per-class filter tabs), and the **Weapon Watch foundation**
(`/weapons` page + `/api/weapons` + `/api/watch`) — weapons, perk pools,
per-roll perks, masterwork, stats, lock state, priority-weighted scoring of
every existing copy. All tested live against Bungie.

**Known limitation to revisit:** with 28 Warlock exotics tuned covering all six
stats, the build-synergy "no exotic favors this" demotion never fires for
Warlock — only bites on selectively-tuned classes. Refinement candidates:
per-exotic build-view filter or priority tiers on exotics.

**NEXT TASK: Weapon Watch phase 2 — new-drop detection + TRMNL alert** (below).
Then fashion loadouts.

## 2. Weapon perk tracking / god-roll finder — PHASE 2 (detection + alerts)

**Done (phase 1 + Diego's UX feedback round):** manifest slim4 (trait plug sets,
plug stat investments `wi`, barrel/mag indexes `bi`); `/api/weapons` (pools,
per-roll perks by NAME — enhanced variants share the name, not the hash;
masterwork; stats + statsMax; lock state); `/weapons` UI: collapsible cards,
priority perks (track → ★ high → off, 6 max), wanted masterwork, watched stats
with max-possible values color-ranked across dupes (gold/teal/red/white), lock
buttons (live Bungie SetLockState — write scope confirmed working), local tag
overlay (keep/favorite/junk/none, DIM tag shown alongside), batch select +
tag/lock + junk-all-unselected. Config: `weapon-watch.json`, `weapon-tags.json`.

**Note on tags:** the overlay is local-only; DIM can't see it. Shipped: a "Copy
junk DIM query" button (top bar) exports every junk-tagged id as an `id:` search.

**UX refresh (shipped 2026-07-03):** cross-page nav on both pages; perk pools are
always visible when a card is open (no more collapsed "Edit tracking"); `render()`
split into `renderWatched()`/`renderAdd()` with scroll preserved so perk/stat/tag
toggles don't collapse or jump; collapsed cards list tracked perks in the header;
ammo-type filter tabs, sort, "only hits" toggle, god-roll 🎯 badge. See the audit
at `.claude/plans/there-is-no-link-reactive-engelbart.md`.

**SHIPPED (2026-07-03):** slim5 icons + the visual New Drops dashboard `/drops` +
new-drop detection (`weapon-seen.json`, `fresh` flag, `/api/drops/ack`). See HANDOFF.
What remains here is the *live alerting* half — the poller + TRMNL interrupt + sound
+ auto-lock.

**To build (phase 2 live alerts — poller → TRMNL + sound + auto-lock):**
- **Poller:** on an interval while destiny2.exe runs, call `fetchWeapons` (or the
  `/api/weapons?fresh=1` path) and read the `fresh` copies of watched weapons that
  are already computed server-side; score them (75% god-roll bar, reuse `scoreCopy`).
  Do NOT auto-ack — let the dashboard/alert own acknowledgement.
- **Pop threshold:** DECIDED — the **75% god-roll flag** (`GOD_MIN_*`). Only 🎯 drops alert.
- **TRMNL interrupt:** on a hit, take over the panel for **1 minute** (weapon
  name, tracked perks hit, masterwork, tracked stat numbers), then resume
  rotation — needs a render page in `render.js` + an interrupt hook in
  `server.js`'s refresh loop.
- **Sound:** TRMNL has no speaker — play a sound on the PC while in-game
  (e.g. PowerShell `[console]::beep` / media file from the watcher or server
  when destiny2.exe is running).
- **Auto-lock the drop** via Bungie `SetItemLockState` (needs
  `MoveEquipDestinyItems` OAuth scope — check the app's scopes; may need a
  re-auth). No auto-tag: Diego tags manually after reviewing.

**Diego's words:** the app should pull which perks each weapon *can* roll
(columns 3 and 4 — the trait columns), let him tag **up to 6 perks to track per
weapon**, plus a wanted **masterwork** per weapon and wanted **stats** (stability,
reload, range…). When a new drop matches, it pops on the **TRMNL display**:
weapon name, tracked stat number, tracked perks, masterwork.

**Design notes (researched so far):**
- Perk columns: from the manifest, `DestinyInventoryItemDefinition.sockets` +
  socket categories; live rolls from profile components **302 (perks) / 305
  (sockets)** — the same profile call pattern as `vault-verdict.js` `fetchArmor`.
  Column 3/4 = the trait sockets (plug set hashes give the possible-perk pool
  per weapon).
- Masterwork: the masterwork socket plug (`plug.plugCategoryIdentifier`
  contains `masterworks.stat.*`).
- Stats: `itemComponents.stats` per instance.
- Detection of "new drop": diff instance ids against the previous poll snapshot
  (server keeps a seen-ids file). TRMNL side: new page type in `render.js` +
  rotation entry, likely a high-priority interrupt page when a match appears.
- UI for tagging: extend Vault Verdict (new Weapons tab/page on port 8787) —
  it already has auth, manifest slimming, and the persistence pattern
  (`vv-*` localStorage keys + export/import).

**Files:** `vault-verdict.js` (fetch weapons + perk pools + rolls),
`vault-verdict.html` or a new `weapon-watch.html` (tagging UI),
`server.js` + `render.js` (TRMNL match-alert page), new gitignored state file
for seen instance ids + watch config.

**Diego's answers (2026-07-03) — the agreed design:**
- **Watchlist:** Diego picks specific weapons to track. Per weapon: up to 6
  tracked perks (cols 3+4), a wanted masterwork, wanted stats.
- **Match rule — priority-weighted scoring.** His example: "I'm tracking 2 perks
  in col3 but one of them is a high priority, and 3 perks on col4 and two of
  them are high priority, so this also affects the score." So each tracked perk
  gets a **priority flag (normal / high)**; a drop's score is the weighted sum
  of perk hits (+ masterwork + stat matches as bonus). UI must expose the
  per-perk priority and presumably a pop threshold; confirm threshold defaults
  with Diego during build.
- **TRMNL alert:** on a match, **interrupt the rotation for 1 minute** and
  **ring a sound notification while in-game** (TRMNL has no speaker — play the
  sound from the PC, e.g. the server triggering a Windows sound while
  destiny2.exe is running). After 1 minute, resume rotation.
- **Auto-lock:** immediately **lock the matching drop via the Bungie API**
  (`SetItemLockState`, needs MoveEquipDestinyItems OAuth scope — verify the
  app's scopes, may need re-auth) so it can't be deleted. **No tag** — Diego
  tags manually when he reviews it.

## 3. Fashion loadouts (LATER — only after weapons feature is complete)

**Diego's words:** save fashion loadouts (armor **ornaments + shaders**) that can
be **applied to the currently equipped armor at the click of a button**; needs
**images from the API** to identify ornaments and shaders.

**Design notes:**
- Ornament/shader defs + icons: manifest `DestinyInventoryItemDefinition`
  (`displayProperties.icon` — prefix `https://www.bungie.net`); current
  cosmetics on equipped armor from sockets (component 305).
- Applying requires **write scope**: `InsertSocketPlugFree` (Bungie API) for
  shaders/ornaments — check the OAuth app has `AdvancedWriteActions` /
  MoveEquipDestinyItems permissions; may require re-auth with new scopes and
  the character to be **in orbit / not in an activity**.
- UI: new page in the Vault Verdict server (it has tokens already); grid of
  saved looks with icon thumbnails, one Apply button per look.
- Spec discussion with Diego still to happen — do not start before weapons
  feature ships.

**Files (expected):** `vault-verdict.js` (socket write calls + icon proxy),
new `fashion.html`, new saved-looks JSON (gitignored).
