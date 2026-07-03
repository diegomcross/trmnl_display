# NEXT_PHASE — where to pick up

> Maintained per CLAUDE.md. When a feature ships, move it to HANDOFF.md
> "What works now" and delete it here.

## Where we are (2026-07-03)

Just shipped: Vault Verdict set-bonus data fix (`setItems` reverse map), the
**exotic favorite-stat tuning panel**, and **build synergy for legendaries**
(Diego chose "drive verdicts": keepers pair-annotated with matching tuned
exotics, same-slot excluded, off-build keepers demoted to Review, `oSyn`
toggle in Rules, classes with no tuned exotics untouched).

**Known limitation to revisit:** with 28 Warlock exotics tuned covering all six
stats, "no exotic favors this" never fires for Warlock — demotion only bites on
selectively-tuned classes. If Diego wants sharper pruning, the refinement is a
per-exotic build-view filter (pick an exotic → see its best 4 legendary
partners) or priority tiers on exotics.

Task order, per Diego:
1. Weapon perk tracking / god-roll finder (spec below — answers recorded)
2. Fashion loadouts (only after weapons feature is complete)

## 2. Weapon perk tracking / god-roll finder

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
