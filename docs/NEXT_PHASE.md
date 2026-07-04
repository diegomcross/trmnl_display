# NEXT_PHASE — where to pick up

> Maintained per CLAUDE.md. When a feature ships, move it to HANDOFF.md
> "What works now" and delete it here.

## Where we are (2026-07-04, evening — LOOK / BrayTech pass)

Diego wants the app to look like his BrayTech character page
(bray.tech/3/4611686018530139303/2305843010375154553/character): **top banner with his
in-game emblem + name**, game-like everywhere, and **section tabs on the right** to reach
Armor Vault / Weapon Vault / Fashion.

**SHIPPED:** the nameplate banner (`banner.js` + `/api/account` + theme.css `.gb*`) on every
page — emblem-art background, name (Aquarius), ✦power + class, character-switch dots, and the
section nav right-aligned in the banner. See HANDOFF. This delivers "top banner + name" and the
"section tabs on the right."

**STILL OPEN — needs Diego's confirmation before building (don't assume):** he also said "add
the filters for weapons on the right side." BrayTech has TWO side rails we haven't built:
- **Left filter rail:** element (Kinetic/Solar/Arc/Void/Stasis/Strand), ammo (Primary/Special/
  Heavy), rarity, champion mods, Shaped/Marked/Locked, subclass-verb icons — a visual filter set.
- **Right rail:** ENGRAMS (postmaster), POWER (highest item per slot + actual light), CURRENCIES
  (Glimmer/Bright Dust/etc).
Open question for Diego: does he want (a) a BrayTech-style **left filter rail** on Weapon Watch /
Vault (element/ammo/rarity/locked), (b) the **right power+currency rail**, or (c) both? And is the
banner's right-aligned section nav enough for the "filter tabs on the right (armor/weapon/fashion)"
he described, or did he mean a separate vertical rail? Ask before building — this is layout-heavy.

## Where we are (2026-07-04, latest)

Just shipped: **Perk Finder** (`/perks`) — full details in HANDOFF. Diego asked for
a pickable list of *all* weapon trait perks, ordered by light.gg-style popularity,
that scores his inventory by perk match and lets him save role-tagged perk combos
(ad-clear / pve / pvp / dps). Built & tested live: 356 trait perks, popularity from
the DIM community wishlist (light.gg has no API), inventory match scoring, combo
save/load/delete. His two answered design questions: **popularity source = DIM
community wishlist** (not light.gg scrape); **perk scope = all trait perks in the
game** (not owned-only).

**Combo model corrected 2026-07-04 (Diego):** the flat "count matching perks" model
was wrong — two perks in the *same* column can't roll together, so it over-counted.
Rebuilt as **two slots** (Slot 1 + Slot 2, interchangeable perks within a slot); a
weapon is a full match only if it can roll one perk from each slot in *different*
columns. User never picks the column. See HANDOFF for the match logic. Verified live.

**Possible Perk Finder follow-ups (not started, no commitment — surface to Diego):**
- **AND toggle for the Artifacts page** filter (its chips are still OR). Separate from
  Perk Finder now that combos are slot-based.
- ✅ **Chase / Farmable mode — SHIPPED 2026-07-04** (Inventory↔Farmable toggle; see HANDOFF).
- **3rd slot / origin-trait or barrel-mag slot** if he ever wants combos beyond the
  two trait columns.
- **Farmability polish:** `/api/weapon-pools` `src` strings are raw manifest sourceStrings
  (some verbose, e.g. "Random Perks: cannot be reacquired"). Could clean/shorten or add a
  "currently obtainable only" filter if the farmable list feels noisy.
- **Role-weighted scoring:** weight a combo's match by its role's PvE/PvP lean using
  the wishlist split already stored per perk.
- **Wire combos into Weapon Watch / alerts:** a saved combo could seed a watch config.

## Where we are (2026-07-03, latest)

Shipped since phase-1 (all in HANDOFF): 75% god-roll threshold; per-copy
**Equip/Vault** buttons; **Weapon Watch UX overhaul** (full-width copy layout,
direct tag chips, Select-multiple mode, no-jump perk selection); **manifest slim5
icons**; **New Drops dashboard** (`/drops`) with new-drop detection + visual cards.

Remaining bundle (Diego: "bundle as many as possible"):
1. ✅ **DIM two-way tag sync — SHIPPED & verified** (see HANDOFF). Diego ran
   `dim-probe.js`; app registered (`.dim-app.json`), 992 tags read. Server now reads
   DIM tags as truth and writes each change back via `POST /api/tag`.
2. ✅ **Phase-2 live alerts — SHIPPED & verified** on the real panel (see HANDOFF).
3. ✅ **Always-on vault-verdict** — `start-vault.ps1` written; Diego runs `-Install` once (§0b).
4. ✅ **Fashion loadouts — SHIPPED & verified** (see HANDOFF). No re-auth needed after all —
   token already had AdvancedWriteActions; apply just needs the character in orbit.

**All planned features are shipped.** Only open items: Diego runs `start-vault.ps1 -Install`
once (always-on), and end-to-end confirmation of the two in-orbit/in-game paths (a real
god-roll drop firing the alert; applying a *different* fashion look in orbit) the next time
he plays. Nothing else queued — next work will come from new Diego requests.

## 0. DIM two-way tag sync — ✅ SHIPPED 2026-07-03 (details in HANDOFF)

Two-way sync is live and verified. Notes worth keeping:
- **App reg is NOT via `.env`** — it's a self-serve `POST /new_app` returning a
  `dimApiKey` saved to `.dim-app.json` (gitignored). A freshly created app has a
  **propagation delay** before `/auth/token` accepts its key (Diego's first
  `/auth/token` 401'd `NoAppFound`, worked minutes later). `dim-probe.js` now
  reuses the saved key + retries.
- Auth token (~30-day JWT) cached in `.dim-token.json`; re-minted from the Bungie
  token when stale. Tag vocab maps 1:1 (keep/favorite/junk); our `none` = `tag:null`
  (removes it); DIM `infuse`/`archive` left untouched.
- **Agent can't run the token exchange itself** (sandbox blocks sending the Bungie
  token to a third party) — Diego ran `node dim-probe.js` once to bootstrap the app.
  After that the *server process* does all DIM calls (not gated).

## 0b. Always-on vault-verdict — ✅ DONE (`start-vault.ps1`)

`start-vault.ps1` (mirrors start-display.ps1) keeps vault-verdict.js alive so the
poller + DIM sync run whenever the PC is on. Diego runs `start-vault.ps1 -Install`
once (agent can't install the Startup item itself — sandbox blocks persistence).

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

**SHIPPED (2026-07-03) — the whole phase-2 is done:** slim5 icons; visual New Drops
dashboard `/drops` + detection (`weapon-seen.json`, `fresh`, `/api/drops/ack`); AND
the live alert pipeline — in-game poller (`pollDrops` in vault-verdict.js) →
auto-lock (SetLockState) + 3× PC beep + `drop-alert.json` → `server.js` interrupts
the panel with `renderDropAlert` for ~1 min (fast refresh, forced redraw on exit so
it doesn't stick). Verified live on the real ESP32 panel. See HANDOFF.

**⚠ OPERATIONAL GAP (do next):** the poller only runs while **vault-verdict.js is
running**. `start-display.ps1` supervises `server.js` only. For alerts to actually
fire during play, vault-verdict must be always-on too. TODO: add a supervised
vault-verdict launch (extend start-display.ps1, or a sibling `start-vault.ps1`,
`-Install` to the Startup folder like the display server). Until then Diego must
`node vault-verdict.js` before playing.

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

## 3. Fashion loadouts — ✅ SHIPPED 2026-07-03 (details in HANDOFF)

Save equipped ornament+shader looks (`fashion.json`) and re-apply via
`InsertSocketPlugFree`. Token already had `AdvancedWriteActions` (no re-auth). Apply
requires the character in orbit. Files: `vault-verdict.js` (fetchFashion/applyLook +
`/api/fashion`, `/api/looks`, `/api/fashion/apply`), `fashion.html` (`/fashion`).
Possible future polish: a picker to swap in *any* owned ornament/shader (not just
save-current), and per-slot editing of a saved look.
