# NEXT_PHASE — where to pick up

> Maintained per CLAUDE.md. When a feature ships, move it to HANDOFF.md
> "What works now" and delete it here.

## Where we are (2026-07-03)

Just shipped (commit `8a9c218`): Vault Verdict set-bonus data fix (set membership
comes from `DestinyEquipableItemSetDefinition.setItems`, not the item def) and the
**exotic favorite-stat tuning panel** (per-exotic stat picks, seeded with Diego's
synergy list, drives which exotic copies are kept). Next task order, per Diego:

1. Exotic favorites → legendary keep logic (design pending, questions asked)
2. Weapon perk tracking / god-roll finder (spec below, questions asked)
3. Fashion loadouts (after weapons feature is complete)

---

## 1. Exotic favorites should shape LEGENDARY verdicts

**Diego's words:** "the exotic favorite stats is important so the app knows how to
keep the other armor pieces. Build crafting always revolves around an exotic armor."

Meaning: a build = 1 exotic + 4 legendaries that spike the stats the exotic wants.
The favorite stats set in the exotics panel define, per class, which stat
combinations the legendary pool actually needs to cover. Legendaries whose
archetype (primary/secondary) + tertiary stats match a tuned exotic's favorite
stats are build-relevant; niches no exotic wants are candidates for demotion.

**Files:** `vault-verdict.html` only (verdict engine `compute()`, card rendering,
possibly a per-exotic filter control).

**Open questions (asked 2026-07-03, record answers here):**
- How aggressive: demote non-matching legendary keepers vs only flag/annotate
  matches vs an exotic-picker filter view?
- Does the exotic's slot exclude that slot from matching (an exotic chest means
  legendary chest pieces can't be in that build)?

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

**Open questions (asked 2026-07-03, record answers here):**
- Watchlist scope: only weapons Diego picks, or auto-track every weapon name
  seen in vault?
- Match rule: does a drop "pop" when ANY tracked perk hits, or require e.g. a
  col-3 AND col-4 hit? Is masterwork a hard requirement or a bonus?
- 6 tracked perks: per weapon, correct? (vs a global perk list)
- TRMNL behavior: interrupt the rotation with the alert page until dismissed,
  or just add it as a rotating page showing recent matches?

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
