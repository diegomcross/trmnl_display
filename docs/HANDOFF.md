# Destiny 2 -> TRMNL e-ink dashboard -- Handoff

A self-hosted dashboard that shows Diego's current Destiny 2 **Orders** (and other
content -- quests, triumphs, titles) on a 7.5" 800x480 monochrome e-ink panel, and
(new direction) on a phone/tablet screen.

> **Read this first.** Diego is a non-programmer: **Claude writes and pushes all code;
> Diego runs commands locally and handles the browser/device.** Keep responses tight and
> ship working code. Explain what to do in plain steps. Verify GitHub pushes by fetching
> the raw file and diffing/MD5 vs the tested local copy.

---

## DIEGO'S VISION (read this to understand the "why")

The whole point of this project is an **at-a-glance, always-on progress board** for what
he's currently grinding in Destiny 2 -- so he can glance at a screen on his desk and know
what to do next without alt-tabbing or opening the app.

Core priorities, in his words:

1. **Readability above all.** The text must be **big and legible from across the room.**
   This is the #1 recurring complaint. When forced to choose between "show more items" and
   "show fewer items bigger," **bigger wins.** The split-orders feature exists for exactly
   this reason (see below).
2. **Priority-first ordering.** Show the **highest-value orders first** by rarity
   (**Exotic > Legendary > Rare > Common**), then by how close to done they are. He wants
   his best/rarest orders visible even if it means the common ones roll to a second page.
3. **Set it and forget it.** The server should **start automatically when he launches
   Destiny and stop when he closes it** -- no manual `node server.js`, no battery drain when
   not playing, no pressing the panel's reset button to make it notice the server.
4. **Two display targets, same server:**
   - The **TRMNL e-ink panel** (the original target -- crisp, low-power, but **not backlit**).
   - An **old Pixel 3 plugged into the PC** (NEW -- backlit, so **much better readability**,
     which is why he wants it). The phone shows the same rendered screen.
   - **NEXT BIG TASK: port this to a proper Android app** so the Pixel 3 can run the display
     natively (kiosk-style, always-on, auto-launch). Today the phone uses a browser page
     (`/display`) as an interim solution; the app is the goal. Better readability on the
     backlit screen is the entire motivation. (When building this: it's an LLM-adjacent
     Android/Kotlin task, not an LLM task -- no Anthropic API involved.)

---

## Hardware & accounts

- **Panel:** TRMNL 7.5" OG **DIY kit -- Seeed Studio driver board** + XIAO ESP32-S3, 800x480,
  1-bit monochrome. 2.4 GHz Wi-Fi only. Device MAC `1C:DB:D4:74:E7:E0`.
  - **Re-enter Wi-Fi pairing / captive portal: hold *Key 3* ~5s.** (The "hold the back
    button" and "Reset->Boot" instructions are for *other* TRMNL units and do **not** apply.)
- **Phone target:** old **Pixel 3**, plugged into the PC (USB power), on home Wi-Fi. Interim
  display is a browser at `http://<PC-IP>:3000/display`. Future: native Android app.
- **Character:** Warlock main "Aquarius", Steam. `membershipType 3`,
  `membershipId 4611686018530139303`, Warlock `characterId 2305843010375154553`.
- **Bungie OAuth app:** `client_id 49944`, confidential client, redirect
  `https://127.0.0.1:8443/callback`. Tokens stored in `tokens.json` (gitignored), refreshed
  non-interactively.
- **Repo:** `github.com/diegomcross/trmnl_display`, branch `main`. Local clone:
  `C:\Users\diego\Desktop\cola_ai_v3\trmnl_display`.
- **Dev PC:** Windows 11, Node 18+, **Windows PowerShell 5.1** (important: no `&&` chaining;
  UTF-8/em-dash chars in `.ps1` files break the parser -- keep PowerShell scripts ASCII-only).
  Ethernet `192.168.1.130`; Wi-Fi `192.168.1.68`; VPN virtual adapter `10.14.0.2`.

---

## Files

| File | Role |
|---|---|
| `auth-and-snapshot.js` | Interactive Bungie OAuth + writes `snapshot.json` (full profile dump). Run once / to re-auth. |
| `render.js` | `buildModel(profile)` -> data model; page renderers (`renderSVG`=Orders, `renderQuestsSVG`, `renderTriumphsSVG`, `renderTitleSVG`, `renderDropAlert`=god-roll drop) + `renderPage()` dispatcher. CLI run writes `screen.png` + prints a report. |
| `server.js` | Always-on TRMNL BYOS HTTP server. Pulls a fresh profile each cycle, picks the current rotation page, renders, converts to 1-bit BMP, serves it. Interrupts the rotation for `drop-alert.json` god-roll alerts (`activeAlert`). Hosts `/settings`, `/display`, `/screen.png`. |
| `start-display.ps1` | **Always-on launcher for the display server.** Runs `node server.js` and keeps it alive (restart loop). `-Install` adds a hidden **Startup-folder login item** (Task Scheduler is blocked here) + starts it now; `-Uninstall` removes it. Logs to `server.log`. |
| `start-vault.ps1` | **Always-on launcher for Vault Verdict** (port 8787) — mirrors start-display.ps1. Keeps `node vault-verdict.js` alive so the **god-roll drop poller + two-way DIM sync** run whenever the PC is on. `-Install`/`-Uninstall` (Startup-folder item, "TRMNL Vault Verdict.lnk"). Logs to `vault.log`. Independent of the display launcher. |
| `watch-destiny.ps1` | Optional game-coupled alternative: watches for `destiny2.exe` and starts/stops the server with the game. `-Setup` tried to register a Task Scheduler task but that is **denied** on this PC. Logs to `watcher.log`. |
| `config.json` | Settings written by the settings page (gitignored; per-machine). |
| `manifest-cache.json` | Cached Bungie manifest defs (gitignored). `CACHE_SCHEMA` const invalidates it when the stored shape changes. |
| `vault-verdict.js` | **Vault Verdict** server (port **8787**): live Armor 3.0 vault triage + weapons API. Reuses `.env` + `tokens.json`. Slims the manifest to `vault-manifest-cache/slim3-<version>.json` (armor + weapons + trait plug sets + drop sources). `node vault-verdict.js probe "name"` dumps one item for debugging. |
| `vault-verdict.html` | Vault Verdict frontend (served at `/`): verdict engine, set-bonus 4pc/2pc rating panel with drop locations, exotic favorite-stat tuning panel (per-class filter, primary›secondary), DIM query export. |
| `weapon-watch.html` | **Weapon Watch** god-roll tracker UI (served at `/weapons`): pick weapons, tag up to 6 perks (normal/★high priority), wanted masterwork + watched stats; scores every copy in the vault. Full-width copy rows, direct tag chips, Select-multiple batch mode, smart Vault/Equip, no-jump perk selection. Config → `weapon-watch.json`, tags → `weapon-tags.json` (gitignored). |
| `weapon-drops.html` | **New Drops dashboard** (served at `/drops`): visual cards for *fresh* drops of watched weapons — weapon art, rolled perk icons, masterwork icon, stats, score/🎯. Backed by `weapon-seen.json` (gitignored) + `/api/drops/ack`. |
| `dim-probe.js` | One-off DIM Sync API check (gitignored). Diego runs `node dim-probe.js` to confirm two-way DIM sync works before it's built. |
| `fashion.html` | **Fashion loadouts** (served at `/fashion`): each character's equipped armor ornaments + shaders with icons; save named looks (`fashion.json`, gitignored) and re-apply them in one click. Apply requires the character to be in orbit. |
| `theme.css` | **Shared visual theme** for all four Vault Verdict pages (served at `/theme.css`, linked after each page's inline `<style>`). BrayTech/in-game look: ground `#101312`, hairline white borders, square tiles, Destiny rarity/energy colors, self-hosted **Arimo** (Helvetica/Neue-Haas twin) type, tabular numbers. Pages share CSS-var names so this one file re-skins everything — **edit design tokens here, once.** Also styles the **item tiles** (`.wtile` weapon art, `.pkico` perk-icon tiles) that Weapon Watch renders from `/api/weapons` art — a token repaint alone did NOT read as BrayTech; the real look needed the actual weapon/perk artwork as rarity-framed square tiles. The e-ink display (`server.js`, 1-bit) is separate and unaffected. |
| `fonts/arimo-*.woff2` | Self-hosted Arimo 400/500/700 (latin subset, Apache-2.0), served at `/fonts/`. Bundled so type is identical on every device incl. Android. |
| `weapon-vault.html` | **Weapon Vault** (served at `/vault`): your whole arsenal as a BrayTech-style tile grid (rarity-framed squares, power, element pip, lock, tag border), grouped by slot (Kinetic/Energy/Power), tiles lazy-load via IntersectionObserver. **Tile look (BrayTech-tuned 2026-07-04):** roomy 74px tiles, weapon art, a **clipped top-left corner** as the tag flag (keep=cyan / fav=gold / junk=red — replaced the distracting full-width bar), a small element diamond + power on a bottom gradient strip, lock top-right. Right rail: quick filters (element/ammo/rarity/locked/new/tag + name search) that hide non-matches, and a **perk combo filter** (two column-aware slots, same rule as Perk Finder) that lights up matching weapons; click a tile to inspect its perks/MW **and manage it like DIM — Equip / To Vault / Lock / Keep / Fav / Junk** (calls `/api/equip`,`/api/vault`,`/api/lock`,`/api/tag`). Equip uses the **smart exotic swap** (below). Reads `/api/weapons` + `/api/perks`. First slice of the "vault-as-grid" vision (armor vault next). |
| `banner.js` | **Shared in-game nameplate + section nav** (served at `/banner.js`, included by every page via `<script src="/banner.js">` into a `<div id="gbanner">`). Renders your equipped **emblem art as the banner background**, Bungie name, power (✦light) + class, character-switch dots, and the right-aligned section tabs (Armor Vault · Weapon Vault · Fashion · Perk Finder · New Drops · Artifacts). Data from `/api/account`. Replaces the old per-page `<nav class="nav">` — edit nav/banner in this one file. |
| `perk-finder.html` | **Perk Finder** (served at `/perks`): pickable list of *all* trait perks in the game, ranked by community popularity (PvE/PvP split bar), with search + column/owned/ranked filters. Build a **combo as two slots** (Slot 1 + Slot 2; multiple perks in a slot = interchangeable "any of these") → live-scores your owned weapon copies, counting a **full match only when a weapon can roll one perk from each slot in *different columns*** (so the perks actually combine); marks copies you already have rolled. Perk list ranks by **Mine** (how often you track a perk across your watched weapons, priority-weighted — default), **Community** (DIM wishlist), or **Blend** (Mine full weight + Community ×0.35 → surfaces sleeper rolls). Save role-tagged combos (ad-clear/pve/pvp/dps) to `perk-combos.json` (gitignored). Backed by `/api/perks` (which overlays `mine` from `weapon-watch.json`) + `/api/combos`. |
| `.dim-wishlist.json` | Gitignored cache: the parsed DIM community wishlist folded to `{perkName:{total,pve,pvp}}` — the "popularity" behind Perk Finder. Re-downloaded weekly from the voltron list. |
| `artifacts.html` | **Artifact Mods** reference (served at `/artifacts`): all 7 Monument of Triumph artifacts × 3 columns × 7 mods, with a filter by subclass verb (Solar/Arc/Void/Stasis/Strand/Prismatic keywords) + keywords (Champions, grenade, Super, weapon types) + free text search. **Data is STATIC** (hand-transcribed from the neonlightsmedia Monument of Triumph guide) — if Bungie changes artifacts/mods, edit the `ARTIFACTS` array in this file. No API. |
| `CLAUDE.md` | Working rules for agents: never drop features, test before push, and **mandatory upkeep of this file + `docs/NEXT_PHASE.md`**. |
| `docs/NEXT_PHASE.md` | The pickup point: specs + open questions for upcoming features. |

---

## What works now (current state)

- **Auth + profile fetch** end-to-end (non-interactive refresh in `server.js`).
- **Content model** (`buildModel`): gathers **orders, quests/bounties, seals (titles), and a
  triumph pool** from one profile call, so any page type can be composed from real data.
- **Orders discovery (the hard-won part):** Orders are instanced bounty-type items
  (`itemType 26`, trait `item.bounty`) in **inventory bucket `635141261`** (not the pursuits
  bucket). Objective progress from **component 301** (`itemComponents.objectives`). Rarity
  from `inventory.tierType` / `tierTypeName` (**2 Common, 5 Legendary, 6 Exotic**).
- **Orders sort (NEW):** `tracked` first, then **rarity rank (Exotic > Legendary > Rare >
  Common)**, then by **% complete**. This guarantees the best orders land on page 1.
- **Orders page layout ("Sample 2"):** small caption (rarity glyph + name + `prog/total . %`)
  above a **big description**, with the **progress fill sweeping across the description text**
  (text flips white over the filled region via SVG `clipPath`). No header/footer. Rarity
  glyphs are SVG shapes (resvg has no emoji font): star=Exotic, filled diamond=Legendary,
  open diamond=Rare, open circle=Common.
- **Readability scaling (NEW):** name/caption font and glyph size now **scale with how many
  orders are shown** -- `nameSize` 18px at count<=2, 15px at count<=3, 13px at count>=4. The
  description's **line count is dynamic** (`floor(availableHeight / lineHeight)`), so at
  count=2 each order gets ~7 lines of big text instead of a hard 2-3 line cap.
- **Split orders across 2 rotation pages (NEW):** an Orders page now takes `count` **and
  `offset`**. Setting up two orders pages (`count=2, offset=0` then `count=5, offset=2`)
  shows the **top 2 highest-rarity orders big on page 1**, and the **rest on page 2**. This
  is Diego's requested "2 highest-rank, then the others" behavior, done via the sort +
  offset. Toggled by the **"Show remaining orders on a 2nd page"** checkbox in `/settings`.
- **Other page layouts:** Quests (step pips / % + sweep desc), Triumphs (compact list with
  bars), Title/Seal (hero % + remaining requirements). All exported from `render.js`.
- **1-bit BMP pipeline:** render SVG at **3x (SS=3)**, box-average down to 800x480, then
  **threshold at 150** -> solid strokes, no broken letters. Standard 1-bit BMP3, bottom-up,
  palette index0=black/index1=white, bit=1->white. `invert` flag if a panel shows inverted.
- **Refresh only on change:** the rendered **SVG string** is the change key (no clock in it),
  so the panel only redraws when the visible screen actually differs. Server logs "panel will
  redraw" vs "panel stays asleep". `filename` only bumps on change.
- **Pages + rotation model (BUILT):** `config.json` holds a `pages[]` array; the server picks
  the current page by `floor(now/rotationSeconds) % enabledPages`. Content picker at
  `/settings` chooses which pages are enabled + per-page options; changes apply live.
- **Startup grace period (NEW -- fixes the reset-button problem):** for the first **90s after
  the server starts**, `/api/display` returns `refresh_rate=10`, so the TRMNL panel polls
  again within 10s and picks up the freshly-started server **without a manual reset**.
- **Phone display (NEW):** `GET /screen.png` serves a **full-quality PNG** (no 1-bit
  dithering); `GET /display` is a **fullscreen auto-refreshing HTML page** for the Pixel 3 /
  any browser. Interim until the native Android app exists.
- **BYOS endpoints:** `GET /api/display`, `GET /api/setup`, `GET /screen.bmp` (+`/setup.bmp`),
  `GET /screen.png`, `GET /display`, `POST /api/log` (204), `GET /` (status + preview),
  `GET /settings`, `GET|POST /api/config`, `GET /api/options`.
- **Auto-launch watcher (`watch-destiny.ps1`), now hardened (NEW):**
  - `-Setup` registers the **Task Scheduler logon task** automatically (no admin needed for a
    current-user task) and then starts watching.
  - **Finds `node.exe` explicitly** (PATH is empty under Task Scheduler) -- this was why
    auto-start silently failed before.
  - **Crash recovery:** if the game is running but the server process died, it restarts it.
  - Writes `watcher.log` for diagnostics. `-Uninstall` removes the task.

- **Vault Verdict (NEW — separate tool, same repo):** `node vault-verdict.js` →
  `http://127.0.0.1:8787` (LAN-reachable for the phone). Live vault pull
  (components 102,200,201,205,300,304,305), Armor 3.0 triage:
  - **Verdict engine** (all in the HTML): groups pieces into niches, keeps the best
    per niche, junks outclassed copies. Tunable rules (Health-primary demotion,
    protect DIM favorites/loadout pieces).
  - **Set-bonus ratings** (4-piece / 2-pc only / Ignore / Undecided per set) change
    the grouping. **Gotcha that cost a day:** armor item defs have NO set hash —
    set membership lives in `DestinyEquipableItemSetDefinition.setItems`
    (set → item hashes). The slimmer builds the reverse map (`slim2-` cache;
    an old `slim-` cache gets patched in place, no manifest re-download).
  - **Exotic favorite-stat tuning:** per-exotic favorite stats, **max 2, ordered —
    first pick is primary, second secondary**; copies ranked by primary stat then
    secondary. Panel has per-class filter tabs. Diego's list is seeded as defaults
    in `DEFAULT_FAVS` (note the game spells it "Mataiodoxía" with í). Untuned
    exotics fall back to per-archetype niches and show under the **Pending**
    filter. Ratings + favorites persist (`vv-ratings` / `vv-exofavs`, localStorage
    + `window.storage` when present) and ride along in Export/Import ratings.
  - **Set drop locations:** each set row shows where it drops. Hand-curated map
    (`CURATED_SRC` in vault-verdict.js — short names like "Vanguard Ops") first,
    manifest collectible `sourceString` (majority vote across the set's pieces,
    junk "cannot be reacquired" strings filtered) as fallback. **Do not remove.**
  - **Weapon Watch (NEW — god-roll tracker, `/weapons`):** `/api/weapons` returns
    every vault/character weapon with its possible col-3/col-4 perk pools (from
    `randomizedPlugSetHash` of the 3rd/4th sockets in socket category 4241085061),
    the actual roll's perk options (component **310** reusablePlugs — multi-perk
    drops included), masterwork (plug pc `masterworks.stat.<stat>`), live stats,
    **statsMax** (highest possible per stat on that roll — live value + best
    barrel/mag swap, from plug `investmentStats` slimmed as `wi`), and lock state.
    **Perks are matched by NAME, not hash** — enhanced variants differ by hash.
  - Weapon Watch UI: collapsible card per watched weapon (tap header). "Edit
    tracking" holds the perk pools (tap: track → ★ high → off, 6 max), wanted
    masterwork, watched stats. Copies sorted by score (perk hit = priority 1/2,
    masterwork +1). Watched stats show the roll's max value, color-ranked across
    dupes: **gold = highest, teal = 2nd, red = 3rd, white otherwise**. Per copy:
    lock/unlock button (live Bungie `SetLockState` — the app HAS the write scope,
    verified; profile lags a few seconds behind), tag select (local overlay in
    `weapon-tags.json`, wins over the DIM tag which is also shown), checkbox for
    batch: select all / tag selected / lock-unlock selected / **junk all
    unselected**. Config: `weapon-watch.json` + `weapon-tags.json` (gitignored)
    via GET/POST `/api/watch`, `/api/tags`, POST `/api/lock`.
    New-drop detection/alerting is not built yet — see NEXT_PHASE.md.
  - Weapon Watch UX (refreshed): both pages share a top nav (`.nav`: Vault Verdict ·
    Weapon Watch). Perk pools are **always visible when a card is open** — the old
    collapsed "Edit tracking" disclosure was removed because a full re-render dropped
    its open state (perks appeared to close on every click). `render()` is split into
    `renderWatched()` + `renderAdd()`; `renderWatched()` saves/restores `window.scrollY`
    so perk/stat/tag toggles never collapse or jump. Collapsed cards show tracked perk
    names in the header. Rule of thumb for this file: **don't reintroduce a wholesale
    `innerHTML` rebuild on every interaction** — target the list that changed and
    preserve scroll.
  - **Copy-row layout (redesigned):** each copy is a 3-column CSS grid
    (`.copy` = `82px | 1fr | auto`, stacks to 1 col under 520px): **left** = score +
    `matched/selected` + direct tag chips; **center** = the roll (col3/col4 perks, stats);
    **right** = location · power · MW · DIM tag, then Lock + one smart move button. This
    replaced a left-packed flex row that wasted the right half of the card (Diego's
    "everything cramped on one side"). Top bar shows a live **"showing X of Y"** count so
    Sort / "only hits" visibly react even when a short watchlist makes them no-ops.
  - **Direct tag chips:** each copy has keep/fav/junk chips (`data-ctag`) — tap to set,
    tap the active one to clear (→ `none`). No checkbox needed to tag one copy. Batch
    tagging/locking now lives behind a **"Select multiple"** toggle (`selMode`): only then
    do per-copy checkboxes + the `.tools` batch row render.
  - **Smart Equip/Vault button:** one context button per copy — `→ Vault` when it's on a
    character, `Equip` when it's in the vault (never both). Same `/api/vault`+`/api/equip`
    as before.
  - **Scroll anchoring (`renderKeepingAnchor(hash)`):** selecting a perk/stat/MW changes a
    weapon's best %, which re-sorts the list and moved the open card mid-tap (Diego: "the
    window keeps changing"). Perk/stat/MW handlers now call `renderKeepingAnchor` — it
    records the edited card's viewport top, re-renders, and `scrollBy`s the delta so the
    card (and the perk under your finger) stays put. Verified 0px drift.
  - **Manifest slim5 (icons):** the slimmer now stores `icon` on every def (weapons +
    perk/MW plugs) and `screenshot` (`shot`) on weapons. `fetchWeapons` returns a
    `perkIcons` map (perk name → icon path) and a per-copy `mwIcon`. All paths are
    `www.bungie.net`-relative; load as plain `<img src="https://www.bungie.net"+path>`
    (local server tab, no CSP). Bumping slim4→slim5 forced one manifest re-download.
  - **New Drops dashboard (`/drops`, weapon-drops.html):** visual cards for *fresh* drops
    of watched weapons — weapon art background, rolled perk icons per column (wishlist
    matches highlighted gold, `.on` roll perks emphasized), masterwork icon, live stats,
    score/🎯 badge, and Lock / smart Vault-or-Equip / Seen actions + "Mark all seen" +
    "god rolls only" filter. New-drop detection: `weapon-seen.json` (gitignored) seeds
    every current instance id on first fetch (nothing false-positive), then `fetchWeapons`
    flags any unseen copy `fresh:true`; `POST /api/drops/ack {ids?}` moves ids into seen
    (empty ids = ack all current).
  - **Live god-roll alerts (phase-2, shipped):** `pollDrops` in vault-verdict.js runs
    every 25s **while destiny2.exe is running**; for each `fresh`, unlocked copy of a
    watched weapon it runs the server-side `scoreWeaponCopy` (same 75% god bar). On a
    god-roll it: **auto-locks** the drop (SetLockState), **beeps the PC 3×**, and writes
    `drop-alert.json` `{until, weapon, perks, mw, stats, pct}`. `server.js` reads that file
    each tick (`activeAlert`): while live it renders `renderDropAlert` (render.js) instead
    of the rotation, sets `refresh_rate`/tick to 10s, and — key fix — sets `state.alerting`
    so that when the alert ends it **forces a normal redraw** (else the "no progress change"
    guard would hold the stale drop image). Verified end-to-end on the real ESP32 panel.
    **vault-verdict.js must be running while playing** for this to fire — now supported by
    `start-vault.ps1 -Install` (always-on launcher, mirrors start-display.ps1).
  - **TESTING HAZARD (learned twice):** never click real perk/tag controls in a test tab —
    they call the page's `const save()`/`saveTags()` and POST the whole shared config;
    `window.save` stubs don't bind. Test write-triggering UI with a read-only simulation
    (flip `wSort` to force the same reorder) and fix leaks by surgically deleting the one
    bad key from the current file. See the memory note.
  - **Reissued weapons merged (server):** a weapon reissued across seasons keeps its
    name/type but gets a new item hash, so it showed as duplicate entries. `fetchWeapons`
    groups defs by name+type+ammo+damage, unions the perk pools, and repoints every owned
    copy to one canonical hash (`versions` field counts how many merged). One card per
    weapon.
  - **Score is a weighted %-match** (`scoreCopy` in weapon-watch.html): matched weight /
    selected weight, where a normal tracked perk = 1, ★ high-priority = 2, wanted
    masterwork = 1, and each watched stat = 1 ("met" = this copy is the gold/highest for
    that stat among your copies). Shown as `NN% · matched/selected`. The **god-roll** flag
    (🎯) is deliberately NOT just 100% — it needs `GOD_MIN_SELECTED` (4) criteria tracked,
    `GOD_MIN_MATCHES` (3) matched, and `GOD_MIN_PCT` (75%, Diego's chosen bar). So one lone perk that matches
    reads 100% but never flags; a 6-perk+MW+stat wishlist hitting ~5/8 does. Those three
    constants (top of the script) are the tuning knobs and will drive the phase-2 TRMNL
    drop alert.
  - **Save safety:** `saveJsonSafe` copies `weapon-watch.json`/`weapon-tags.json` to
    `<file>.bak` before every overwrite. These files are SHARED live state Diego edits
    from his own browser — never blank the whole file to clean up; remove only specific
    keys and write the rest back.
  - **Build synergy (NEW):** legendary keepers get "Pairs with <exotic>" notes when
    their archetype stats match a tuned exotic's favorites (same slot excluded);
    keepers no tuned exotic favors demote to Review (`oSyn` rules toggle). Classes
    with zero tuned exotics are skipped. Caveat: while ALL stats are favored by
    some tuned exotic of a class (Warlock today), no demotion fires there.
  - **Equip / send-to-vault buttons (NEW):** each weapon copy row has **Equip** and
    **Vault** buttons next to Lock. Server endpoints `POST /api/equip` and `POST /api/vault`
    (in vault-verdict.js) take `{id, hash, own}` where `hash` is the copy's REAL item hash
    (`w.rhash`, preserved before the reissue merge overwrites `w.hash` with the canonical
    one — Bungie's TransferItem validates `itemReferenceHash` against the instance, so the
    canonical hash would fail). Vault = `TransferItem transferToVault:true` from the owning
    character (no-op if already in vault; Bungie refuses to transfer an *equipped* item, so
    it can't disturb the loadout). Equip: if the copy is on a character, `EquipItem` there;
    if in the vault, pull to the default character first, then equip. `LOCK_CTX` now also
    carries `byClass`/`clsById` maps (class↔characterId) to resolve source/target. Same
    write scope as Lock (MoveEquipDestinyItems — confirmed working).
  - **Fashion loadouts (`/fashion`, shipped):** `fetchFashion` reads each character's
    equipped armor and pulls the cosmetic plugs — **shader** = socket whose plug
    `plugCategory` is `shader`; **ornament** = plug category starts with `armor_skins_`
    (e.g. `armor_skins_warlock_head`); both carry `icon`. Save a named look (the ornament
    + shader plug hashes per slot) to `fashion.json`; **apply** = `InsertSocketPlugFree`
    each saved plug into the equipped piece's cosmetic socket (skips already-set). No
    re-auth was needed — the token already has `AdvancedWriteActions` (confirmed: a no-op
    re-insert returned `1634 DestinyCharacterNotInTower`, a location error, not a scope
    error). **Apply only works in orbit** — Bungie returns `DestinyCharacterNotInTower`
    otherwise; the UI surfaces that as a banner. Endpoints: `GET /api/fashion`,
    `GET/POST /api/looks`, `POST /api/fashion/apply {characterId, look}`.
  - **Perk Finder (`/perks`, perk-finder.html — shipped 2026-07-04):** a pickable library
    of **every trait perk in the game** (642 col-3/col-4 perks deduped by name; filtered to
    `pc === 'frames'` so barrels/mags/stocks/grips are excluded — those flood the top by
    popularity otherwise). Each perk shows a **popularity** bar split PvE (green) / PvP (red)
    and a raw count. **"Popularity" = the DIM community wishlist**, not light.gg (which has no
    public API). `buildPerkLibrary` (vault-verdict.js) merges the manifest perk list with
    `loadWishlist`, which downloads the aggregated **voltron** list
    (`48klocs/dim-wish-list-sources`, ~25MB), counts how often each perk hash is recommended
    across all god-rolls (split PvE/PvP from each roll's notes), folds hash→name (enhanced +
    base variants share a name), and caches the compact result to `.dim-wishlist.json`
    (re-downloaded weekly). Endpoints: `GET /api/perks` (`?fresh=1` rebuilds) → `{perks,count,
    wishlistAt}`; `GET/POST /api/combos` → the user's saved combos (`perk-combos.json`,
    saveJsonSafe + `.bak`; stored `{name,role,slots:[[...],[...]]}`, back-compat for old flat
    `{perks:[...]}` → Slot 1). **Combo model = TWO SLOTS** (Diego's correction 2026-07-04): a
    combo is Slot 1 + Slot 2, each holding one or more *interchangeable* perks ("any of these");
    the user never picks a game column. **Match** is client-side (`scoreCopy`): a copy is a
    **full match only if it can put one Slot-1 perk and one Slot-2 perk in *different* trait
    columns at once** (tests both assignments against the copy's per-column `cols[0]`/`cols[1]`),
    so two perks stuck in the same column are NOT a combo — they read as a `½` partial. cyan
    "rolled now" = combo currently equipped on that copy. Sort: rolled → can-roll → partial, each
    by power, top 80. Combo tagged **ad-clear / pve / pvp / dps**. Verified live: Voltshot|Rolling
    Storm + Jolting Feedback → 5 full matches (Keening = Voltshot col3 / Jolting col4; Snipehunt
    rolled-now), Horror's Least correctly demoted to partial (both perks only in col4).
  - **Perk Finder match modes — Inventory vs Farmable (2026-07-04):** a toggle on the matches
    card. **Inventory** = the above (your owned copies). **Farmable** = which weapons in the
    *whole game* can DROP the combo — matches each weapon's full trait pool (`poolMatch`, same
    different-columns rule) from `GET /api/weapon-pools` (server `buildWeaponPools`: every manifest
    weapon's col-3/col-4 `frames` perks, reissues merged by name+type+bucket, ~1272 weapons, 535KB,
    lazy-loaded on first Farmable use). Owned weapons are badged "owned" and listed first; each row
    shows the weapon's drop source (`src`). Verified: Voltshot|Rolling Storm + Jolting Feedback →
    15 farmable weapons (owned Keening/Antedate/… first, then Arc Logic→The Moon etc.).
  - **In-game nameplate banner (2026-07-04, `banner.js` on every page):** Diego wants the app
    to look like his BrayTech character page — top banner with his emblem + name. `GET /api/account`
    (server `fetchAccount`, component 200) returns `{name, code, chars:[{id,cls,light,emblemBg,
    emblem,lastPlayed}]}` sorted most-recently-played first. `banner.js` paints the emblem
    background art + name (Aquarius) + ✦power + class + emblem dots to switch character, and the
    section nav right-aligned (BrayTech style). The old per-page top nav was removed in favour of
    this shared bar. Verified: banner + character-switch (Warlock ✦532 ↔ Titan ✦550) work on all
    pages, no content regressed. **Still open per Diego's ask** (surface, don't assume): a left
    filter rail (element/ammo/rarity like BrayTech) and a right power/currency rail — see NEXT_PHASE.
  - **Smart exotic swap (2026-07-04, `smartEquipWeapon` in vault-verdict.js, used by `/api/equip`):**
    Bungie AUTO-unequips an existing exotic when you equip a 2nd one, but leaves the freed slot
    however it likes. To control it we equip a matching-ammo legendary into the old exotic's slot
    first, THEN the chosen exotic. **CRITICAL (learned from a live failure):** the replacement must be
    one **already on the character — NEVER a vault pull**. Bungie forbids vault transfers inside
    activities (`DestinyCannotPerformActionAtThisLocation`); the first version's vault-fallback hit
    exactly that error where DIM's plain equip works, because DIM never transfers. `pickSlotLegendary`
    now checks the character first; if the only option is in the vault it tries but **falls back to a
    plain equip** (letting the game move the old exotic, like DIM) so it always succeeds; if there's no
    spare at all, plain equip. `POST /api/equip {id,hash,own,dryRun}` — `dryRun:true` returns the plan
    `{swap:{removed,added,fromVault?,note?}}` without moving anything (USE THIS to test — never fire
    real equip/transfer writes on his account in testing). `hash` must be the copy's REAL hash
    (`rhash`). Verified via dry-run: Khvostov (Kinetic) equipped → equip an Energy exotic plans remove
    Khvostov → add Seventh Seraph Carbine (on-character Kinetic legendary, no vault transfer).
  - DIM overlay (armor): optional `dim-data.json` (tags + loadouts) merges into verdicts.
  - **DIM two-way tag sync (weapons, shipped):** Weapon Watch keep/favorite/junk tags are
    synced live with DIM's cloud. `vault-verdict.js` holds a small DIM Sync API client:
    `dimAuth` (exchanges the Bungie token for a ~30-day DIM token, cached in `.dim-token.json`;
    app key in `.dim-app.json`), `dimReadTags`, `dimWriteTag`. `fetchWeapons` pulls live DIM
    tags into each copy's `w.tag`; `GET /api/tags` serves them (source of truth); `POST
    /api/tag {id,tag}` writes ONE tag to DIM (`none` → `tag:null` clears it). The chips/batch
    UI call `/api/tag` per item — no whole-file overwrite (kills the old clobber hazard).
    Falls back to the `weapon-tags.json` mirror if DIM is unreachable. **Bootstrap:** Diego
    ran `node dim-probe.js` once to register the DIM app (agent's sandbox blocks sending the
    Bungie token to a third party; the server process is not gated). Verified: 992 tags read,
    reversible write. The "Copy junk DIM query" button remains as a manual export too.

---

## How Diego runs it (the plain-English setup)

1. **One-time always-on setup** (run once in PowerShell):
   `powershell -ExecutionPolicy Bypass -File "C:\Users\diego\Desktop\cola_ai_v3\trmnl_display\start-display.ps1" -Install`
   This starts the server now **and** adds a hidden login item so it comes back at every
   Windows login -- running **whether or not Destiny is open** (the board is always available).
   The data comes from Bungie (`tokens.json`), so the game does **not** need to be running.
   - **Auto-start uses the Startup folder, not Task Scheduler.** Task Scheduler is blocked on
     this PC (`Register-ScheduledTask` / `schtasks` both return "Access is denied") -- this is
     why the old `watch-destiny.ps1 -Setup` task never actually registered. The login item lives
     at `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TRMNL D2 Display.lnk`.
   - **To remove it:** `... start-display.ps1 -Uninstall`. **Manual start** (no auto-start): just
     `... start-display.ps1`. The server logs to `server.log` in the repo folder (includes every
     TRMNL device request, so panel bring-up is visible).
   - `watch-destiny.ps1` (start/stop the server **with the game**) still exists as the optional
     alternative if Diego ever wants the game-coupled behavior instead of always-on.
1b. **Always-on Vault Verdict** (weapons tools + god-roll drop alerts + DIM sync) — run once:
   `powershell -ExecutionPolicy Bypass -File "C:\Users\diego\Desktop\cola_ai_v3\trmnl_display\start-vault.ps1" -Install`
   Same Startup-folder mechanism (`TRMNL Vault Verdict.lnk`), logs to `vault.log`, port 8787.
   This is what runs the live god-roll poller + DIM tag sync, so keep it installed. `-Uninstall`
   to remove. It's separate from the display server — install/remove either without affecting the other.
2. **Point the panel at the PC:** on the TRMNL panel, set **Custom Server URL =
   `http://192.168.1.130:3000`** (plain http, no trailing slash, **not** usetrmnl.com). If it's
   stuck at "wifi connected," this is almost always because the server wasn't running (fixed by
   step 1) or the URL points at a stale IP. Best check: load `http://192.168.1.130:3000/` from a
   phone on home Wi-Fi -- if the phone sees it, the panel will too.
3. **Configure the look:** open `http://localhost:3000/settings` -> set **Orders per screen =
   2**, tick **"Show remaining orders on a 2nd page"**, pick a big **Description text size**
   (32-40), Save. Preview updates at the bottom.
4. **Phone display:** on the Pixel 3, open `http://192.168.1.130:3000/display` (fullscreen,
   auto-refreshes).

---

## Connectivity learnings (these cost real time -- don't relitigate)

- **The device talks plain `http`, not `https`.** Custom Server URL must be e.g.
  `http://192.168.1.130:3000` -- **no trailing slash, no https.** Firmware appends `/api/...`.
- **The PC's IP moves** between Ethernet (`.130`), Wi-Fi (`.68`), and the VPN adapter
  (`10.14.0.2`). The device must point at whichever interface it can actually reach (the LAN
  one, `192.168.1.x`). Best diagnostic: **load `http://<ip>:3000/` from a phone on home
  Wi-Fi** -- if the phone can't reach it, the device can't either.
- **Windows Firewall:** allow inbound TCP 3000 --
  `netsh advfirewall firewall add rule name="TRMNL D2" dir=in action=allow protocol=TCP localport=3000 profile=any`.
- **No-button pairing fallback:** if the device can't find its saved SSID it re-enters the
  captive portal on its own (rename the 2.4 GHz SSID briefly to force it).
- **PowerShell 5.1 gotcha (NEW):** non-ASCII characters (em-dash, arrows, `.` middots) in a
  `.ps1` file make the 5.1 parser throw `Unexpected token` / `missing terminator` errors far
  from the real spot. **Keep `.ps1` files ASCII-only.** (This bit us on `watch-destiny.ps1`.)

---

## Open items / next steps

1. **NATIVE ANDROID APP for the Pixel 3 (the big one).** Goal: a kiosk/always-on app that
   shows the current screen natively on the backlit Pixel 3 for max readability, auto-launches
   on boot, and stays awake. Simplest viable version: a fullscreen WebView pointed at
   `http://<PC-IP>:3000/display` with keep-screen-on + auto-relaunch; better version: fetch
   `/screen.png` (or build the layout natively) and render at full resolution/scale. Consider
   showing it larger than 800x480 since the phone screen is denser. This is an Android/Kotlin
   build task (no Anthropic API involved).
2. **Tune readability defaults** once Diego reports back on the split-orders + big-text combo
   (font sizes, how many lines look good at count=2, whether count=1 "one huge order" is
   wanted as an option).
3. **VPN coexistence:** Diego needs the VPN running. Fix is almost always the VPN app's
   **"allow local network / LAN access"** toggle (whitelists `192.168.1.0/24`). **Which VPN
   he runs is still unknown** (the `10.14.0.2` adapter is the tell) -- get the name for exact
   steps.
4. **Verify auto-start end-to-end** on Diego's machine: confirm the Task Scheduler task fires
   on login, the watcher finds node, and the server starts when `destiny2.exe` appears (check
   `watcher.log`).

---

## Technical reference

- **resvg-js:** `new Resvg(svg,{fitTo:{mode:'zoom',value:3}}).render()` -> `.pixels` (RGBA),
  `.width/.height`, `.asPng()`. No emoji font -> use SVG shapes for icons.
- **1-bit "label on a fill" trick:** draw a black fill rect for the filled region, then draw
  the text twice -- white clipped to the filled region, black clipped to the empty region --
  so text stays legible whether over black or white.
- **Orders page knobs (`renderSVG` opts):** `count` (1-5), `offset` (start index, for the
  2nd page), `descSize` (14-40), `showNumbers`, `rarities[]`. `nameSize`/`glyphSc` derive
  from `count`; `maxLines` derives from row height.
- **Config schema (current):**
  ```json
  {
    "rotationSeconds": 30,
    "refreshSeconds": 60,
    "descSize": 32,
    "count": 2,
    "showNumbers": true,
    "invert": false,
    "pages": [
      { "type": "orders",   "enabled": true,  "count": 2, "offset": 0, "rarities": ["common","legendary","exotic"] },
      { "type": "orders",   "enabled": true,  "count": 5, "offset": 2, "rarities": ["common","legendary","exotic"] },
      { "type": "quests",   "enabled": false, "count": 4 },
      { "type": "triumphs", "enabled": false, "count": 6 },
      { "type": "title",    "enabled": false, "sealHash": null }
    ]
  }
  ```
  `sanitizeConfig` allows **up to 2 orders pages**; other types are single. A missing orders
  page is re-added so there's always something to show.
- **GitHub MCP gotchas:** prefer fetching the raw URL and diffing after every push;
  over-escaping (`\"` -> `\\\"`) has corrupted pushes before. Files can truncate silently --
  verify. The connector can also drop mid-session; if its tools vanish, a new chat reloads.
- **Manifest:** `getDef(type, hash)` caches to `manifest-cache.json`; bump `CACHE_SCHEMA`
  whenever the stored field shape changes (this fixed an "all Common" rarity bug caused by a
  stale cache written before `tierType` was captured).
