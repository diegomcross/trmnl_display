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
| `start-vault.ps1` | **Always-on launcher for Vault Verdict** (port 8787) — mirrors start-display.ps1. Keeps `node vault-verdict.js` alive so the **god-roll drop poller + two-way DIM sync** run whenever the PC is on. `-Install`/`-Uninstall` (Startup-folder item, "TRMNL Vault Verdict.lnk"). Logs to `vault.log` — **since 2026-07-12 the server's own console output (DIM warnings, drop alerts, auto-manager notes) is captured there too** (timestamped, rotated at ~2MB to `vault.log.old`); before that only launcher lines + crashes landed, which made sync issues invisible. Independent of the display launcher. |
| `watch-destiny.ps1` | Optional game-coupled alternative: watches for `destiny2.exe` and starts/stops the server with the game. `-Setup` tried to register a Task Scheduler task but that is **denied** on this PC. Logs to `watcher.log`. |
| `config.json` | Settings written by the settings page (gitignored; per-machine). |
| `manifest-cache.json` | Cached Bungie manifest defs (gitignored). `CACHE_SCHEMA` const invalidates it when the stored shape changes. |
| `vault-verdict.js` | **Vault Verdict** server (port **8787**): live Armor 3.0 vault triage + weapons API. Reuses `.env` + `tokens.json`. Slims the manifest to `vault-manifest-cache/slim3-<version>.json` (armor + weapons + trait plug sets + drop sources). `node vault-verdict.js probe "name"` dumps one item for debugging. |
| `vault-verdict.html` | Vault Verdict frontend (served at `/`): verdict engine, set-bonus 4pc/2pc rating panel with drop locations, exotic favorite-stat tuning panel (per-class filter, primary›secondary), DIM query export. |
| `weapon-watch.html` | **Weapon Watch** god-roll tracker UI (served at `/weapons`): pick weapons, tag up to 6 perks (normal/★high priority), wanted masterwork + watched stats; scores every copy in the vault. Copies render as an **organized table** (score, columns 3/4, full stat names + MW badge, kills, location, actions — redesigned 2026-07-06, see "What works now"), direct tag chips, Select-multiple batch mode, smart Vault/Equip, no-jump perk selection. Config → `weapon-watch.json`, tags → `weapon-tags.json` (gitignored). |
| `weapon-drops.html` | **New Drops dashboard** (served at `/drops`): visual cards for *fresh* drops of watched weapons — weapon art, rolled perk icons, masterwork icon, stats, score/🎯. Per-card actions: **Fav / Keep / Junk** tag chips (`/api/tag`, DIM vocab, active chip clears on re-tap) + Lock + smart Equip/→Vault + Seen. Perk hover popup (`perktip.js`, added 2026-07-09 — was the one page missing it) + PVE/PVP roll chip. Backed by `weapon-seen.json` (gitignored) + `/api/drops/ack`. |
| `dim-probe.js` | One-off DIM Sync API check (gitignored). Diego runs `node dim-probe.js` to confirm two-way DIM sync works before it's built. |
| `fashion.html` | **Fashion loadouts** (served at `/fashion`): each character's equipped armor ornaments + shaders with icons; save named looks (`fashion.json`, gitignored) and re-apply them in one click. Apply requires the character to be in orbit. |
| `theme.css` | **Shared visual theme** for all four Vault Verdict pages (served at `/theme.css`, linked after each page's inline `<style>`). BrayTech/in-game look: ground `#101312`, hairline white borders, square tiles, Destiny rarity/energy colors, self-hosted **Arimo** (Helvetica/Neue-Haas twin) type, tabular numbers. Pages share CSS-var names so this one file re-skins everything — **edit design tokens here, once.** Also styles the **item tiles** (`.wtile` weapon art, `.pkico` perk-icon tiles) that Weapon Watch renders from `/api/weapons` art — a token repaint alone did NOT read as BrayTech; the real look needed the actual weapon/perk artwork as rarity-framed square tiles. The e-ink display (`server.js`, 1-bit) is separate and unaffected. |
| `fonts/arimo-*.woff2` | Self-hosted Arimo 400/500/700 (latin subset, Apache-2.0), served at `/fonts/`. Bundled so type is identical on every device incl. Android. |
| `weapon-vault.html` | **Weapon Vault** (served at `/vault`): your whole arsenal as a BrayTech-style tile grid (rarity-framed squares, power, element pip, lock, tag border), grouped by slot (Kinetic/Energy/Power), tiles lazy-load via IntersectionObserver. **Tile look (BrayTech-tuned 2026-07-04):** roomy 74px tiles, weapon art, a **clipped top-left corner** as the tag flag (keep=cyan / fav=gold / junk=red — replaced the distracting full-width bar), a small element diamond + power on a bottom gradient strip, lock top-right. **BrayTech-style layout (redesigned 2026-07-04):** grouped **by slot** (Kinetic/Energy/Power); within each slot the **selected guardian's** weapons sit on the LEFT — **Equipped** (marked cyan) as its own group, then that character's **Inventory** below it — a divider, then the shared **Vault** on the right, **capped to 3 rows** with a "Show all N" button (`capVaultRows` counts the grid's resolved columns × 3). **Only one guardian** shows, driven by the banner's emblem-dot selector: `banner.js` dispatches `gbanner:char {cid,cls}` (+ sets `window.GBANNER`) on load and on switch; the vault filters `w.ownCid===selCid` (vault is account-wide). (Earlier all-characters "location sections" version was scrapped — Diego: "looks nothing like DIM/BrayTech, only show one character.") **Sort control:** Power / Recent (by instanceId ≈ acquisition order) / Kills (from the kill-tracker, profile component 309) / Perk·Mine / Perk·Blend (best tracked/blended perk per column, summed). Right rail: quick filters (element/ammo/rarity/locked/new/tag + name search) that hide non-matches, and a **perk combo filter** (two column-aware slots, same rule as Perk Finder) that lights up matching weapons; click a tile to inspect its perks/MW **and manage it like DIM — Equip / To Vault / Lock / Keep / Fav / Junk** (calls `/api/equip`,`/api/vault`,`/api/lock`,`/api/tag`). Equip uses the **smart exotic swap** (below). Reads `/api/weapons` + `/api/perks`. First slice of the "vault-as-grid" vision (armor vault next). |
| `banner.js` | **Shared in-game nameplate + section nav** (served at `/banner.js`, included by every page via `<script src="/banner.js">` into a `<div id="gbanner">`). Renders your equipped **emblem art as the banner background**, Bungie name, power (✦light) + class, character-switch dots, and the right-aligned section tabs (Armor Vault · Weapon Vault · Fashion · Perk Finder · New Drops · Artifacts). Data from `/api/account`. Also renders the **"Updated Xs ago" data-freshness chip** (polls `/api/status`; click = force refresh; auto-reloads pages that set `window.GRELOAD` when idle — see "Data freshness overhaul"). Replaces the old per-page `<nav class="nav">` — edit nav/banner in this one file. |
| `perk-finder.html` | **Perk Finder** (served at `/perks`): pickable list of *all* trait perks in the game, ranked by community popularity (PvE/PvP split bar), with search + column/owned/ranked filters. Two builder modes: **Pick perks** (default, flat — click any perks, column/order irrelevant; weapons ranked by how many they can roll) and **Combo** (Slot 1 + Slot 2; a **full match only when a weapon can roll one perk from each slot in *different columns***). Both feed the Inventory/Farmable match panel; saved as `{perks:[]}` (flat) or `{slots:[[],[]]}` (combo), auto-detected on load. Perk list ranks by **Mine** (how often you track a perk across your watched weapons, priority-weighted — default), **Community** (DIM wishlist), or **Blend** (Mine full weight + Community ×0.35 → surfaces sleeper rolls). Save role-tagged combos (ad-clear/pve/pvp/dps) to `perk-combos.json` (gitignored). Backed by `/api/perks` (which overlays `mine` from `weapon-watch.json`) + `/api/combos`. |
| `.dim-wishlist.json` | Gitignored cache: the parsed DIM community wishlist folded to `{perkName:{weapons:[names],pve:[names],pvp:[names]}}` (distinct recommended weapons, not a raw roll-line count — see the popularity-algorithm note in "What works now") — the input to Perk Finder's "popularity" (`pop`). Re-downloaded weekly from the voltron list. |
| `.clarity.json` | Gitignored cache: **Clarity community insights** (the same data DIM shows on perks) folded to `{perkName:insightText}`. Downloaded weekly from `database-clarity.github.io/Live-Clarity-Database/descriptions/dim.json`, flattened (`descriptions.en[].linesContent[].text`). Raw source for the perk **hover popup** (cleaned by `insightBullets`). |
| `perktip.js` | **Shared perk hover popup** (served at `/perktip.js`, included by weapon-watch/perk-finder/weapon-vault). Sectioned card: element accent bar, name, **in-game description in an inset box** (same size), then **community-insight bullets**. Colouring engine: numbers **gold** (buff, shown `+11%`) / **red** (penalty `−`), **teal** seconds/time, **element-coloured keyword verbs** (Jolt=Arc, Scorch=Solar, Sever=Strand…), symbols `▸`(trigger) `▲`(ramp) `▼`(penalty) `×`(stacks) — **no emoji**. `PerkTip.init({perkDescs,perkInsights})`; auto `mouseover` on `[data-p]`/`[data-pn]`. Design + colours locked with Diego over live mockups. |
| `.clarity-clean.json` | **Committed** curated perk bullets `{perkName:[{type,text}]}` (type ∈ trigger/ramp/penalty/buff/note → leading symbol). Hand-rewritten by Claude for the top ~34 perks, tight AND **complete** (every per-stack %, PvP split, enhanced bonus kept — Diego's rule: never drop info; numbers verbatim). English-only; other locales fall back to localised Clarity. Perks without an entry use the lossless `cleanClarityBullets` fallback. |
| `perk-favorites.json` | Gitignored: Diego's **favorite trait perks as a graded map** `{perkName: grade 1-3}` (3-star rating in Perk Finder; back-compat: an old flat array loads as grade 1). Grade → vault-score weight **1★=1 · 2★=1.5 · 3★=2**. Scores EVERY weapon in the Weapon Vault. `.bak` alongside. GET/POST `/api/favorites`. |
| `REBOOT.cmd` | **One-click server restart** (double-clickable). Stops any running node servers + their keep-alive launcher loops, waits, then relaunches `start-display.ps1` (port 3000) and `start-vault.ps1` (port 8787) hidden. Use it to load new code after an update or to bring things back if stuck. ASCII-only. |
| `auto-manager.html` | **Auto-Manager** control page (served at `/auto`): On/Off toggle (live account writes), rules/thresholds editor (junk-below unwatched/watched %, keep %, favorite %, junk-stage count, per-run safety caps), a **Preview next run (no writes)** button and a **Run now (live)** button, plus a decision-log table of the last run (from→to tag, score, watched/favorites basis, ▲ new-best flag, staging moves). Reads/writes `GET/POST /api/auto`, `POST /api/auto/run`. |
| `settings.html` | **App-wide Settings page** (served at `/settings` on 8787, in the banner nav): Auto-Manager on/off + every threshold (fav/keep/watched-junk/unwatched-junk/comboFloor) + junk-staging character picker (`stageCid`, from `/api/account`) + safety caps + check cadence, each with plain-language help; PVE/PVP combo summary (`/api/combos`); favorites-by-grade summary (`/api/favorites`); god-roll alert rules (read-only); community-data refresh buttons (`/api/perks?fresh=1`, `/api/weapons?fresh=1`). All writes go through `GET/POST /api/auto` — same config as `/auto`, which keeps its own compact editor and links here. |
| `artifacts.html` | **Artifact Mods** reference (served at `/artifacts`): all 7 Monument of Triumph artifacts × 3 columns × 7 mods, with a filter by subclass verb (Solar/Arc/Void/Stasis/Strand/Prismatic keywords) + keywords (Champions, grenade, Super, weapon types) + free text search. **Data is STATIC** (hand-transcribed from the neonlightsmedia Monument of Triumph guide) — if Bungie changes artifacts/mods, edit the `ARTIFACTS` array in this file. No API. |
| `builds.html` | **Build Crafter** (served at `/builds`, in the banner nav): DIM-like loadout maker with stat goals + upgrade watching. Build list (super/exotic icons, prio summary, champion totals vs mins, upgrade chips), full editor (class tabs → element chips → ability/aspect/fragment icon grids with official Bungie art + perktip hover → owned-exotic anchor picker → drag-to-order stat priorities with min/max 0-200), per-build suggestions panel (champion 5-piece strip + explained swap suggestions + tuning notes), DIM-loadout import button. Data: `/api/builds*`, `/api/subclass-catalog`, `/api/armor`. |
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
    score/🎯 badge, and **Fav/Keep/Junk tag chips** (`/api/tag`) + Lock / smart Vault-or-Equip / Seen
    actions + "Mark all seen" + "god rolls only" filter. New-drop detection: `weapon-seen.json` (gitignored) seeds
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
  - **Fashion loadouts (`/fashion`, shipped; +Ghost/Vehicle 2026-07-05):** `fetchFashion` reads each
    character's equipped **armor + Ghost shell + Vehicle** (`COSMETIC_BUCKETS`: armor + Ghost
    `4023194814` + Vehicle `2025709351`) and pulls the cosmetic plugs — **shader** = plug
    `plugCategory` `shader`; **ornament** = `armor_skins_*` for armor, the **`hologram` (projection)**
    socket for Ghost (vehicles have shader only). Ghost/Vehicle item defs aren't in the slim manifest,
    so slot = the equipment item's `bucketHash` and name/icon come from a cached on-demand
    `itemDefLite(hash)`. `fashion.html` renders generically over `FASH.order`, so the Ghost/Vehicle
    rows + save/apply come for free. Save a named look (ornament + shader plug hashes per slot) to
    `fashion.json`; **apply** = `InsertSocketPlugFree`
    each saved plug into the equipped piece's cosmetic socket (skips already-set). No
    re-auth was needed — the token already has `AdvancedWriteActions` (confirmed: a no-op
    re-insert returned `1634 DestinyCharacterNotInTower`, a location error, not a scope
    error). **Apply only works in orbit** — Bungie returns `DestinyCharacterNotInTower`
    otherwise; the UI surfaces that as a banner. Endpoints: `GET /api/fashion`,
    `GET/POST /api/looks`, `POST /api/fashion/apply {characterId, look}`.
  - **Perk Finder (`/perks`, perk-finder.html — shipped 2026-07-04):** a pickable library
    of **every *legendary* trait perk in the game** (~229 after filters; `pc === 'frames'` only, so
    barrels/mags/stocks/grips are excluded; **exotic weapons skipped** (`d.tt===6`) since their
    perks are fixed intrinsics, not random rolls — Diego's call). Each perk shows a **popularity** bar split PvE (green) / PvP (red)
    and a raw count. **"Popularity" = the DIM community wishlist**, not light.gg (which has no
    public API). `buildPerkLibrary` (vault-verdict.js) merges the manifest perk list with
    `loadWishlist`, which downloads the aggregated **voltron** list
    (`48klocs/dim-wish-list-sources`, ~25MB), folds hash→name (enhanced + base variants share a
    name), and caches the compact result to `.dim-wishlist.json` (re-downloaded weekly).
    **Popularity algorithm (rewritten 2026-07-05 — old-perk inflation fix):** raw wishlist
    roll-line counts badly favored old perks — the voltron list accumulates many curator-submitted
    roll variants for the same long-lived weapons over years, so an ancient perk racks up dozens of
    near-duplicate entries while a perk added last season has had only months to accumulate any,
    independent of how good either currently is (this is what Diego flagged: "the older perks are
    very inflated"). Fix: `parseWishlist` now reads the wishlist's `item=<hash>` field (previously
    ignored) to track, per perk, the **distinct weapons** (by name, reissues folded) recommended for
    it, not a raw line count. `buildPerkLibrary` then computes, per perk, `poolN` (how many CURRENT
    weapons can roll it, from the existing pool-building loop) and `wcount` (how many of the
    recommending weapons still can, intersected with the current pool so `wcount<=poolN`), and sets
    **`pop` = the Wilson score lower bound** of `wcount/poolN` (`wilsonLB(successes,n,z=1.96)` — the
    same statistic Reddit uses to rank comments by rate-of-upvotes without letting tiny-sample items
    cheat to the top). This ranks by adoption *rate*, not raw magnitude, while still discounting
    perks with a thin sample (e.g. 1/1 weapons recommended ≠ automatically "100%"). Verified live:
    Kill Clip/Rampage/Outlaw (ancient, huge legacy pools) dropped to ranks #55/#87/#81 while Firing
    Line/Chill Clip/Frenzy (current, genuinely in-demand) now rank #1/#3/#4. The on-disk cache shape
    changed (`{weapons:[],pve:[],pvp:[]}` name-arrays instead of `{total,pve,pvp}` numbers);
    `loadWishlist` detects the old shape and force-refreshes rather than silently degrading to 0.
    **`pop` now drives sort order everywhere perks are listed** (Diego's ask): a shared
    `perkPopMap(e)` (reuses `buildPerkLibrary`'s cache) sorts `fetchWeapons`'s `cols` (the actual
    roll — shown in Weapon Watch copies, Weapon Vault inspect, New Drops, Perk Finder inventory
    card) and `pool` (full per-weapon pool — Weapon Watch tracker, Weapon Vault watch-picker), and
    `buildWeaponPools`'s pool (Perk Finder Farmable card), all most-popular-first.
    **Enhanced/base perk folding — `foldPerkName()` (2026-07-06):** every perk list dedupes by exact
    manifest name (enhanced + base normally share one) — Bungie's manifest breaks that for **Golden
    Tricorn** specifically (the enhanced version's name is literally "Golden Tricorn Enhanced", the
    only trait perk with a trailing "Enhanced" in the name). `foldPerkName()` strips that suffix;
    applied everywhere a perk is keyed by name (`buildPerkLibrary`, `fetchWeapons`'s roll/pool
    building, `buildWeaponPools`, `parseWishlist`, `loadClarity`). If a future season introduces
    another perk with this same manifest quirk, it folds automatically — no per-perk list to maintain.
    Endpoints:
    `GET /api/perks` (`?fresh=1` rebuilds) → `{perks,count,
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
  - **Perk hover popup — redesigned (2026-07-05, `perktip.js`):** hovering any perk (Weapon Watch
    pools/rolls, Perk Finder rows, Weapon Vault inspect) pops the sectioned card described in the
    files table — **in-game description** (manifest `dsc`) up top in an inset box, then the **community
    insight** as cleaned, coloured bullets. Insight source = **Clarity** (`loadClarity` downloads
    `.../descriptions/dim.json` weekly → `.clarity.json`); `insightBullets` serves curated
    `.clarity-clean.json` bullets else the **lossless** `cleanClarityBullets` fallback. The slim
    manifest stores each plug's `dsc` (**bumped slim5→slim6**, one-time re-download; ~1169 Clarity
    perks, 307 descriptions). `/api/weapons` → `perkDescs` + `perkInsights` (bullets `[{type,text}]`);
    `/api/perks` adds `dsc` + `insight` bullets per perk. **Never-drop-info rule** (Diego): audit via
    `scratchpad/gen-report.js` — it flagged and we fixed two silent-drop bugs (the fallback 5-sentence
    cap; the editorial filter eating whole data bullets). Now 0 real number-drops across 278 perks.
    Colours/symbols/layout were locked with Diego over ~8 live in-browser mockups. **TODO: localisation**
    — everything API-derived (manifest text, Clarity insight) must be pulled per-locale for pt-BR +
    future langs; see NEXT_PHASE l10n spec. Curated English bullets are en-only.
  - **Weapon Vault tile score = THE ACTUAL ROLL (2026-07-09, Diego: "I never care about the weapon's
    potential, the only score that's important is the actual roll"):** the old pool-based `favScore`
    (favorited perks ÷ the weapon's whole trait pool) is GONE from the UI. `fetchWeapons` now computes
    **`w.rollScore` per copy, server-side, once** — watched weapon → tracked-perk match %
    (`scoreWeaponCopy`); anything else → grade-normalized ★-favorite score of the roll (`favRollScore`,
    100% = 3★ favorites in both columns), floored at `thr.comboFloor` when the roll completes a saved
    Perk Finder combo (`w.comboFloored`). Also `w.rollBasis` ('watched'|'favorites'). **The Auto-Manager
    consumes the same `w.rollScore`** (`autoDecide(w, def, thr)` no longer recomputes) so the number on a
    vault tile and the number in the /auto log can never disagree. Weapon Vault: tile % (score mode is
    always available now, no favorites required), Min-score slider, and the `Roll score` sort all use it;
    tile tooltip shows the basis. Cache rule: POSTs to `/api/watch`, `/api/favorites`, `/api/auto`
    (comboFloor), `/api/combos` all null `wcache` because rollScore is baked into the weapons payload.
    Perk Finder's 3-star grading (`perk-favorites.json`, weights 1★=1 · 2★=1.5 · 3★=2) is unchanged and
    is what feeds the favorites-basis score.
  - **Perk Finder weapon cards + tag filter (2026-07-05, perk layout redone 2026-07-05 night):** click a
    **Best-Match** weapon (Inventory) → a smart card — perks cols 3/4 **side by side, listed vertically**
    (`.cols2`/`.pool.vert`, same layout as Weapon Watch's tracker; was stacked `.wccol` blocks), rolled perk
    lit cyan, MW, kills, power/element/lock — + **Equip / To Vault / Lock / Keep / Fav / Junk** (ported from
    `weapon-vault.html` `inspect()`; same `/api/equip|vault|lock|tag`). Click a **Farmable** weapon → a card
    of all rollable perks in the same side-by-side layout, **tap to cycle track → ★ high priority → off**
    (6 max — was a binary checkbox) → **Save to Weapon Watch** (merges into `weapon-watch.json`, keyed by
    the pool's weapon hash, priorities preserved; verified it preserves existing entries). A **perk
    tag filter** (chips: Damage/Reload/Stability/Handling/Range/Ability/Ammo/Healing + element verbs
    Jolt/Scorch/Slow/Sever/Volatile) narrows the library; tags come from `/api/perks` (`tagsFor` classifier
    over perk name + dsc + insight). Perks in the cards keep the `perktip.js` hover (`data-pn`).
  - **Weapon Watch top search + source filter (2026-07-04):** one search box at the **top** narrows
    **both** the watched list and the add list, matching name/type/**source** — so `crucible`, `iron banner`,
    `raid`, `trials`, `nightfall`, `dungeon`, `gambit` all work (matches the manifest `src` string;
    raid weapons read e.g. `"Vault of Glass" Raid`). Shared `matchesQuery(d)` helper over n/ty/src/slot/ammo/dmg.
    **Punctuation-insensitive (2026-07-06):** search is normalized through `normQ()` (strips `'`/`'`)
    on both the query and the target string, so typing `archons thunder` (no apostrophe — how most
    people type) still finds `Archon's Thunder`. Diego reported the weapon as "not present"; it was
    always in the data (owned + all-weapons lists both had it) — only the search was punctuation-
    sensitive. Same `normQ()` pattern applied to `weapon-vault.html`'s tile-grid search and
    `vault-verdict.html`'s Armor Vault search (both had the identical latent bug).
  - **Weapon Vault character layout (2026-07-04/05):** the equipped weapon renders **~1.7× the tile**
    (`.wgrid.eqbig`) — Diego confirmed this is correct. The character's **inventory** below it is a
    **3-column grid** (`.charside .wgrid` = `repeat(3,90px)`) to match his in-game/BrayTech character screen
    (he sent a picture; the earlier 5-column inventory was the thing he meant by "3×3", not the equipped tile).
    The shared **vault** stays on the right, capped to 3 rows. The character inventory is now also
    capped to a true 3×3 (`.invcap`, fixed 2026-07-05 — see the postmaster note above).
  - **Weapon Vault manager batch (2026-07-05, watch-picker redone 2026-07-05 night):** inspect card shows
    perks/MW/kills/element + Equip / To Vault / Lock / Keep / Fav / Junk (`/api/equip|vault|lock|tag`) AND
    a **watch-perk picker** — **Column 3 | Column 4 side by side, perks listed vertically, tap to cycle
    track → ★ high priority → off** (`.cols2`/`.pool.vert`/`.pk.t1`/`.pk.t2`, matching Weapon Watch's
    tracker exactly — was a flat wrapped row of binary chips) → Save to Weapon Watch, 6-perk cap with the
    same "6 max!" feedback. `pickSet` (a plain Set) became `pickPerks` (`{name:1|2}`) so priority actually
    saves. **Gotcha:** the click handler must NOT call `inspect()` again to re-render — `inspect()`
    re-derives `pickPerks` from the *saved* WATCH config every time, so re-opening the card would wipe an
    unsaved edit; the handler instead mutates the clicked button + the `#wpcount` counter directly.
    **Trait Columns 3 & 4 side by side** (`.ispcols2`, the read-only roll viewer, unchanged), perks
    vertical. **Equip make-space:** `smartEquipWeapon` vaults an unlocked weapon from a FULL slot
    (1 equipped + 9 stored) before pulling from the vault — the real reason equip failed; card reports
    "vaulted X to make room". **Clean inventory** rail control (Weapons/Armor/Both) → `cleanInventory`
    + `POST /api/clean-inventory {characterId,kind}` vaults every unequipped weapon/armor for the
    selected guardian. **Official element icons** on tiles (`loadDamageIcons` → `DamageTypeDefinition`
    icon, `def.dmgIcon`, `.wt .elic`). **Weapon-type filter + sort-by-stat dropdowns** (`fType`,
    `statSort` over `statsMax`). **Filter fix (2026-07-05 late):** `chipRow` uses `el.onclick=` (not
    `addEventListener`) so re-running it on every `load()` no longer stacks duplicate handlers (that
    double-bind was why chips did nothing / didn't highlight). **Quick filters now HIDE non-matches**
    (name/type/element/ammo/rarity/tag → `passQuick` fail = `continue` in `render()`, real narrowing);
    the **combo + min-score** overlay still dims/floats matches (`softActive`), with `only matches`
    to hard-hide those. `capVaultRows`→ generalized `capRows(sel)`, applied to both the vault and the
    character inventory (`.invcap`, capped to a 3×3). **Postmaster split out:** `fetchWeapons` tags
    `loc:'postmaster'` when live `it.bucketHash===215593132` (postmaster lives in
    `characterInventories`, so it used to inflate the char inventory to >9 — the "14 tiles" bug); the
    UI shows a separate **"Postmaster · N"** subcol so the real inventory is a true ≤9 (3×3).
  - **Weapon Watch + popup polish (2026-07-05):** copies within a weapon sort by **tag**
    (favorite→keep→none→junk, then score); a **"Junk untagged"** top-bar button mass-junks every
    untagged copy (DIM write + confirm). The perk hover popup (`perktip.js`) now waits **400ms**
    (`HOVER_DELAY`) before showing. God-roll drop alert fires **once per drop** (`ALERTED` Set in
    `pollDrops` — it was re-firing every 25s because a fresh drop stays flagged until acked).
  - **Weapon Watch copy table redesign (2026-07-06, Diego's ask — "it's small, not organized, not
    following the organization seen in other sections"):** the old copy row was a cramped 3-column
    grid at 10-12px font packing 10+ fields together. Presented 3 mockup directions as Artifacts
    (sample data); Diego picked **the organized table** (explicit column headers: Score | Column 3 |
    Column 4 | Stats | Location/Kills | Actions), then asked for corrections, all shipped:
    - **Full stat names, never abbreviated** (Range/Stability/Handling, not RNG/STB/HND).
    - **MW badge rides inline with its actual stat**, not a disconnected line. Gotcha: the copy's
      real masterwork (`w.mw`) is a lowercase plug identifier (`"charge_time"`, `"reload"`) while
      watched-stat names are Title Case (`"Charge Time"`, `"Reload Speed"`) — they don't match as
      plain strings, and a couple don't even follow a simple case-conversion rule. Checked directly
      against the manifest (every `weapons.masterworks.stat.*` plug's display name) rather than
      guessed: `MW_STAT_NAME` maps `reload→"Reload Speed"`, `projectile_speed→"Velocity"`,
      `damage→"Impact"`, `accuracy→"Accuracy"` (the plug's own tier text says "Target Acquisition",
      but the actual stat key used by `w.stats`/`w.statsMax` is "Accuracy" — don't trust tier-text
      flavor strings for this mapping). If the copy's real MW stat isn't in the watched-stats list,
      it falls back to its own "MW <name>" line so it's never silently dropped. Computed **per copy**
      (each copy can have a different real masterwork), not per weapon.
    - **Current → best-possible per stat** (`46 → 52`) when a barrel/mag swap could push it higher;
      just the number when already at the ceiling. Verified: ranking (gold/teal/red) and the god-roll
      criteria check both key off `statsMax` (the best-achievable value across every barrel/mag
      option in both sockets, summed — confirmed equivalent to trying every combination since barrel
      and magazine stat contributions are independent), never the live/current value alone.
    - **Kill tracker** added per copy (was missing entirely before).
    - Tag-priority sort (already shipped 2026-07-05, confirmed unchanged: favorite→keep→none→junk).
    Body widened to 1080px to give the table room. Verified against live data via direct DOM
    inspection (not just visually): MW badge landed on the correct per-copy stat, fallback line fired
    correctly when the real MW wasn't a watched stat, sort order held for a 4-tag-variety weapon.
  - **Server stability (2026-07-05):** global `uncaughtException`/`unhandledRejection` handlers keep
    the server alive on any stray error; EADDRINUSE retries are **bounded** (exit after ~20s, no zombie
    procs); server binds **dual-stack** `listen(PORT,'::')`. The launcher (`start-vault.ps1`) restarts
    node 5s after any exit. **Restarting the server = a ~5s offline blip; UI/HTML changes need NO
    restart (served from disk). Don't kill-and-relaunch to deploy HTML.**
  - **`node vault-verdict.js` now honors `PORT` + `VV_CACHE_DIR` env vars** (default 8787 /
    `vault-manifest-cache/`) so a throwaway test instance can run on another port with an isolated cache
    without touching the always-on server.
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

  - **BUILD CRAFTER (`/builds`, shipped 2026-07-12 evening — Diego's plan-mode session):** a
    DIM-Loadout-Optimizer-like system, "similar but better". Everything verified on an isolated
    8799 instance + real browser (0 console errors); server-side lives in one
    `// Build Crafter` section of vault-verdict.js.
    - **Subclass catalog (`GET /api/subclass-catalog`, `buildSubclassCatalog`):** supers /
      grenades / melees / class abilities / movement / ASPECTS / FRAGMENTS per class+element,
      with official Bungie icons+names+descriptions — ALL already in the slim manifest (every
      plug item is kept). **Manifest quirks (hard-won):** stasis aspects are pc
      `<cls>.stasis.totems`, stasis fragments `shared.stasis.trinkets`; per-class prismatic
      grenades `<cls>.prism.grenades` (exclude `prism_grenade` transcendence); an aspect's
      FRAGMENT-SLOT COUNT is its investmentStat hash **2223994109** (in `wi`) — so no
      itemType-16 subclass fetch is needed. Lists deduped by name.
    - **builds.json** (gitignored, saveJsonSafe): `{v:1, builds:[{id,rev,name,cls,classType,
      elem,plugs{super,grenade,melee,classAbility,movement,aspects[≤2],fragments[≤cap]},
      exotic{hash,slot},prio[6 ordered stat keys],min{},max{} (0-200),watch,draft,src,dimId,
      notes}]}`. `rev` bumps on any scoring-relevant edit (cls/exotic/prio/min/max via
      `upsertBuild`) which orphans that build's seen-keys → full re-check, feed-only.
    - **Upgrade engine (v1, greedy per-slot — deliberately explainable):** `championSet` =
      exotic anchor fixed in its slot + best non-exotic per other slot by the build's weighted
      priorities (PRIO_W [10,6,3,2,1,.5]; separable → greedy is optimal for the uncapped
      score). `isUpgrade`: tier 1 = reduces min-target deficit (wins outright), tier 2 =
      raises the max-capped weighted sum by >1; never a second exotic; never moves away from a
      min. Known tier-1 tradeoff: a min-gap closer can drop other (min-less) stats — the text
      says so honestly; protect a stat by giving it a min. Verified vs a hand-check.
    - **Background watcher (60s in main(), separate from autoTick):** evaluates each piece
      ONCE per build+rev (`builds-seen.json`), appends explained entries to
      `builds-alerts.json` (cap 200, in-memory mirror for /api/status), and for a FRESH drop
      while gameUp writes `drop-alert.json {title:'ARMOR UPGRADE',...}` (+`beepUpgrade`) —
      render.js title override `a.title || 'GOD ROLL DROP'`, server.js untouched. Armor is
      NEVER acted on — notify only. `/api/status` gains `builds:{unread}`; banner.js paints
      the Builds nav tab as `Builds (N)` in gold.
    - **Tuning notes (`tuneNoteFor`):** fetchArmor now emits per piece `tune` (plug name) +
      `tuneKind` — stat tunings are named `+X / -Y` (carry inv), **Balanced Tuning (3122197216)
      carries NO inv** (conditionally-active stats are dropped by the slimmer) so it's detected
      by NAME and noted as "+1 to three lowest, not counted"; an empty tuning socket on T3+
      gear notes "could be tuned toward <prio #1>". Verified live: 220 tuned pieces (120 stat
      / 100 balanced).
    - **Endpoints:** `GET/POST /api/builds` (POST=upsert), `POST /api/builds/delete`,
      `GET /api/builds/suggestions[?id=]` (pure preview — no seen/alert writes),
      `POST /api/builds/alerts/ack {buildId?}`, `GET /api/builds/alerts`,
      `POST /api/builds/import-dim`.
    - **DIM import (`dimReadLoadouts` — components=loadouts, separate from dimReadTags;
      `importDimLoadouts`):** maps DIM loadouts → **drafts** (watch OFF until Diego finishes
      + saves): subclass plugs classified BY pc (totems/trinkets fold to aspects/fragments),
      exotic = first equipped tt6 armor, `parameters.statConstraints` order → prio with
      minStat/maxStat (legacy minTier×10 fallback), dedupe by dimId. **Verified live: 90 of
      Diego's DIM loadouts imported correctly** (real subclass configs, exotics, stat mins).
  - **Data freshness overhaul (2026-07-12 — the "DIM not syncing / taking too long" fix):**
    Diego reported DIM sync broken; the DIM cloud connection was actually healthy (direct probe:
    200 OK, 965 tags, ~290ms; token valid to 2026-08-02). **The real bug: `GET /api/weapons`
    served `wcache` FOREVER** — it only refetched when a config POST nulled the cache or while
    Destiny was running (pollDrops). With the game closed, every page showed a frozen snapshot,
    tags Diego set in DIM never appeared, and vice-versa looked "not synced". Fixes, all in
    `vault-verdict.js` `main()`:
    - Plain `GET /api/weapons` now refreshes when the snapshot is older than **`SNAPSHOT_TTL`
      (30s)**; `?fresh=1` still always re-pulls. `GET /api/armor` got the same 30s TTL
      (it had the identical forever-cache bug).
    - A **60s background keep-warm interval** re-pulls even when Destiny is closed, so data is
      never more than ~1 min old (while playing, pollDrops' 25s cycle already keeps it fresher).
    - **`GET /api/status`** (cheap, zero Bungie/DIM calls) → `{weaponsAt, fetching, gameUp,
      dim:{off,at,err}, auto:{at,state,enabled}}`. `DIM_LAST_ERR` records the last DIM read
      failure so sync problems are finally VISIBLE (they only went to the lost console before).
    - **"Updated Xs ago" chip (banner.js, EVERY page):** rendered by banner.js but **pinned
      `position:fixed` to the bottom-right of the viewport** (`.gb-upd` in theme.css) — the first
      in-banner placement wrapped badly against the 9-tab nav and scrolled away (Diego rejected it
      same day). Polls `/api/status` every 10s, repaints every 5s; dot = green <90s, gold <5min,
      red older or a DIM error (error text in the tooltip). Also shows the **detected current
      activity** (`status.activity.name` — e.g. "Updated 12s ago · Orbit") so Diego can SEE
      activity detection working; tooltip adds safe/unsafe + when it was checked. **Click = force
      `/api/weapons?fresh=1`** then reload the page's data. **Gentle auto-reload:** pages expose `window.GRELOAD = () => load(...)`
      (wired in vault-verdict/weapon-vault/weapon-watch/weapon-drops/perk-finder/fashion); the
      banner calls it when the server has newer data AND the tab is visible AND Diego hasn't
      touched the page for 45s (never re-render under his finger), plus immediately when the tab
      regains visibility. Pages without the hook (auto/settings/artifacts) only full-reload on an
      explicit chip click. Chip style `.gb-upd` in theme.css.

  - **Auto inventory manager (`/auto`, phase-3 — shipped 2026-07-06):** a server-side pass
    (`autoManage` inside `main()` in `vault-verdict.js`, on a 120s interval + a 45s first pass)
    that auto-tags weapon copies and stages junk for dismantling **while Destiny is running AND
    you're safely out of an activity.** Diego's agreed rules (answered 2026-07-06):
    - **Activity gate (`fetchActivity`, component 204) — FIXED 2026-07-12 (the "junk staging
      never runs" bug):** reads the most-recently-played character's `currentActivityHash` /
      `currentActivityModeType`. **CRITICAL FACT: orbit is NOT hash 0 — orbit is its own
      ACTIVITY, hash `82913930`, whose def has an EMPTY name and `placeHash 2961497387`
      ("Orbit").** Hash 0 basically only appears when logged out. The original gate
      (`safe = hash===0 || mode 40`) therefore treated orbit as "in an activity" and a live
      pass only ever ran in the Tower — the 2026-07-06 "verified" note (which read hash
      82913930 as an activity) was a misdiagnosis. Now **safe = hash 0 OR hash 82913930 OR
      social (mode/modes 40) OR the activity def's `placeHash` resolves to the Orbit place**
      (`activityDefLite`, on-demand cached `DestinyActivityDefinition` lookup — future-proof if
      the orbit hash ever changes). `fetchActivity` also returns the resolved activity **name**,
      recorded in `AUTO_LOG.activity.name` (verified live: mid-Trials showed
      `{hash:1229253616, mode:84, name:"The Burnout"}, safe:false`). A **live** pass only runs
      when safe; a **dry-run preview** runs anytime (writes nothing). While unsafe the tick polls
      every **15s** (mid-activity a pass is just the cheap activity check) so staging fires within
      seconds of an activity ENDING — Diego's 2026-07-12 ask.
    - **Legendaries only** — `def.tt===5`. **Exotics (`tt===6`) and rares are never touched**
      (Diego's rule). Locked, equipped, and postmaster copies are also skipped, and a human
      keep/favorite tag is never downgraded to junk.
    - **Scoring (REWRITTEN 2026-07-09 — the "mass fake favorites" fix):** a **watched** weapon (has
      tracked perks in `weapon-watch.json`) scores by the server `scoreWeaponCopy` perk-match %; an
      **unwatched** weapon scores by `favRollScore`, now **grade-normalized**: each trait column
      contributes its BEST favorited perk's ★ weight (1★=1 · 2★=1.5 · 3★=2), score = sum ÷ (2×2★★★),
      so **100% needs a 3★ favorite in BOTH columns; two 1★ favorites = 50%**. The old formula
      ("fraction of rolled perks favorited") hit 100% whenever a standard 1+1-perk roll landed two of
      Diego's ~94 grade-1 favorites → the app mass-favorited mediocre weapons (Diego's 2026-07-09 bug
      report; he suspected two scoring systems — the vault tile % IS a different, pool-based number,
      but the bug was the saturation). **Combo floor:** a roll completing one of Diego's saved Perk
      Finder combos (one slot-1 + one slot-2 perk in DIFFERENT columns — `comboMatches`, same rule as
      Perk Finder) never scores below `thr.comboFloor` (default 80 = kept, never auto-favorited on
      the combo alone). **HEALING:** app-applied favorites (`w.autoFav`, ids in `auto-applied.json`)
      are re-decided from scratch each pass — the locked-skip is bypassed for them (the app locked
      them itself) and on demotion the app's own auto-lock is removed (`wasAutoFav && w.locked` →
      unlock). Diego's manual (pink) favorites remain sacred (`isFav` in the dedup requires
      `!d.w.autoFav` for tag-based favorite survival). Verified by dry-run: fav 0, 16 bogus favorites
      demoted (36-88% scores), 3 re-earned favorite legitimately.
    - **PVE/PVP roll tags (2026-07-09):** `fetchWeapons` sets per copy `w.combos` (names of matching
      saved combos) and `w.rollTag` = `'pvp'` if any matching combo's role is pvp, else `'pve'`
      (Diego: "what's not PVP is considered PVE"). Shown as red PVP / teal PVE chips (`.rolltag` in
      theme.css) on Weapon Watch copy rows, New Drops cards, Weapon Vault inspect; NEW badge
      (`.newflag` / `.wt .nwt`) on fresh copies in Weapon Watch + Weapon Vault tiles. POST
      `/api/combos` nulls the weapons cache so tags update on the next load.
    - **Decision bands (`autoDecide`):** `>=fav%` → favorite (+ auto-lock); `>=keep%` → keep;
      `< junk bar` → junk (watched bar defaults 75% = the god-roll bar Diego chose; unwatched bar
      60%); the middle band is left untouched. A **fresh watched drop that beats your best kept
      copy** is auto-kept and chimes with a **different sound** (`beepUpgrade`, a rising 660/990/1320
      triad vs the god-roll `beep`). **Chimes fire only for `w.fresh` drops** — never during the bulk
      re-tag of your existing vault (which would beep dozens of times).
    - **Per-weapon dedup + last-copy guarantee (Diego, 2026-07-06):** decisions are computed for every
      copy first, then a **per-weapon pass** (`decByWeapon`) enforces Diego's dedup rule: for a weapon
      with multiple copies (refined 2026-07-06): **keep ALL favorites + exactly ONE keep, junk the other
      duplicates.** Precisely: (1) **favorites** = every copy with score≥fav% OR a favorite tag are kept;
      (2) **one keep** = the single highest-scored copy at ≥keep%, and **only if the weapon has no keep
      yet** — if a keep already exists (yours or a prior run) the app adds none and **never replaces it**
      with a "better" copy; (3) **manual junk is never overwritten** — a copy YOU tagged junk stays junk
      even with a god roll; (4) everything else junks. Locked / equipped / exotic / postmaster copies are
      **untouchable and survive on their own** (a locked keeper is why a weapon can have all its
      *unlocked* copies junked). Baked-in **last-copy guarantee:** if a weapon would otherwise keep
      nothing, its best copy is kept (`protectedLast`, "last copy" badge) — the app **never removes your
      last copy, only duplicates.** Verified live via dry-run with **0 rule violations**: 0 manual-junk
      copies re-tagged keep/favorite, 0 weapons given >1 keep, 0 existing keeps junked.
      **Side effect of "keep all favorites":** a weapon whose rolls are ALL favorited (100% coverage on
      every copy) keeps every copy — dedup can't trim it. Expected; loosen by un-favoriting some perks.
    - **Auto vs manual favorites — green/pink (Diego, 2026-07-06):** the app records every favorite IT
      applies in `auto-applied.json` (gitignored, instance-id set; an id is dropped when the app retags
      it keep/junk, and a favorite the app never touches stays OUT → manual). `fetchWeapons` sets
      `w.autoFav` (true = app-applied). The UI paints **app favorites light green (`--fav-auto`)** and
      **your own favorites pink (`--fav-man`)** — new shared theme.css vars — on the Weapon Vault tile
      corner flag (`.wt.tg-favorite.af`), Weapon Watch copy chips, and New Drops chips; the `/auto` page
      has a colour legend. Verified: field present on all weapons, 0 green until the first live run
      (Diego's 37 existing favorites correctly read as manual/pink).
    - **Junk staging (per slot; count raised 2026-07-12):** keeps `junkStage` (default **5** — Diego
      2026-07-12: "instead of transferring 3, transfer 5"; was 3) junk-tagged
      legendaries staged **in EACH weapon slot — Kinetic / Energy / Power — so 15 total** — on a character
      (default `stageCid = LOCK_CTX.characterId` = first char = the Warlock main `2305843010375154553`)
      so Diego dismantles them in-game (**there is no Bungie dismantle API**). Per slot it computes
      `need = junkStage − junk already staged in that slot` and pulls the **lowest-power** vault junk of that slot
      until met (so it never stages more than junkStage/slot, and re-tops-up as Diego dismantles). If a slot
      bucket is full (1 equipped + 9) it first vaults one **unlocked, non-junk, non-keep/fav** weapon
      from that slot to make room (`spill`). `maxMovesPerRun` raised to **20** (up to 15 stages + spills).
      The live `auto-manage.json` was updated to match (junkStage 5, maxMovesPerRun 20, re-enabled —
      it had been sitting at `enabled:false`, another reason nothing was transferring).
      Verified live via dry-run: main had Kinetic 9 / Energy 9 / Power 0 junk staged → the app added
      **Power 0→3** and left the already-stocked slots (need ≤ 0).
    - **Safety caps:** `maxJunkPerRun` (25) and `maxMovesPerRun` (20) bound how much one pass can do,
      so a logic bug can't sweep the whole vault in one tick (verified junk capped at exactly 25).
      Config lives in `auto-manage.json` (gitignored, `saveJsonSafe` + `.bak`); `enabled` defaults
      **true** (Diego chose "go fully live"). **`AUTO_DRYRUN=1` env forces decide-only** — used for
      all agent testing so no real writes hit the account.
    - **Endpoints:** `GET /api/auto` → `{cfg,last,gameUp}`; `POST /api/auto` saves a config patch;
      `POST /api/auto/run {dryRun}` runs a pass immediately (dry by default) and returns the log.
    - **Cadence (SPLIT 2026-07-12, Diego: "save API calls"):** `activeSeconds` is GONE, replaced by
      **`orbitSeconds` (60)** — pass cadence while SAFE in orbit/social (junk top-up speed) — and
      **`activitySeconds` (15)** — the cheap 1-call "did the activity end?" check while INSIDE an
      activity, so staging fires within seconds of finishing; `idleSeconds` (120s) paces the no-op
      tick while the game is closed. Inputs updated in both `/auto` and `/settings`. While the game
      runs the tick polls `fetchActivity` **even when the Auto-Manager is disabled** so the banner
      chip can display the detected activity (`/api/status` → `activity:{safe,hash,mode,name,at}`,
      from the `LAST_ACT` module var). API-load context: steady state is ~2-6 Bungie calls/min
      (pollDrops each 25s + this tick) — far under Bungie's throttle (~20+ req/s bursts), so
      throttling risk is negligible; the split is still the right economy. `onGameStart` kicks a
      pass ~3s after destiny2.exe appears.
      **⚠ STATUS 2026-07-12: Auto-Manager is DISABLED** — after the orbit fix it ran live at
      07:33-07:36 and mass-retagged (~94 junk). Tag snapshot: `audit-backup-20260712-074440/`.
      Diego then CONFIRMED the spec and a full audit ran the same day. **Only Diego re-enables it**
      (hard rule). See NEXT_PHASE for the two open behavior questions.
    - **2026-07-12 AUDIT RESULTS (spec confirmed by Diego, then code vs spec):**
      - **One-global-score (Diego's requirement):** all consumers verified on the same number —
        Weapon Vault tiles/slider/sort read `w.rollScore`; Weapon Watch + New Drops client
        `scoreCopy` is formula-identical to server `scoreWeaponCopy` (incl. rankOf built the same
        way over the same copy set); the Auto-Manager consumes `w.rollScore`. ONE divergence found
        + fixed: `fetchWeapons` treated a weapon as "watched" only if it had tracked PERKS — a
        watch config with only a masterwork/stat scored by favorites server-side while pages showed
        the perk-match number. Watched now = any tracked criteria (perks OR mw OR stats).
      - **"staged 57" root cause (FIXED):** the staging loop only counted SUCCESSFUL transfers
        toward `maxMovesPerRun` and `continue`d past failures — when Bungie refused transfers
        (Diego re-entered an activity mid-pass) it marched the whole junk pool logging phantom
        "add"s. Real transfers never exceeded the cap; the counter/log lied. Now an ATTEMPT counts
        toward the cap (dry-run too, so previews are honest), a failed transfer `break`s the slot,
        and the staged/spilled counters decrement on error.
      - **Spec compliance verified by reading `autoDecide`+`decByWeapon`:** manual junk is never
        overwritten (dedup nulls any decision on a `tag==='junk'` copy); manual keep/favorite never
        downgraded; exotics/rares/locked/equipped/postmaster untouched; one-keep rule + last-copy
        guarantee as spec'd. Two behavior questions flagged to Diego (last-copy tags `keep`;
        auto-favorite with 1 tracked perk) — see NEXT_PHASE.
      - **DIM has NO audit-log API** (`GET /audit` 404 — probed) → the pre-incident tags are not
        recoverable. Consequence ↓
    - **Diego's 2026-07-12 follow-up rules (all shipped):**
      - **Last-copy guarantee keeps tagging `keep` AND writes a DIM note "best copy"** (his call:
        "keep as KEEP and add note as best copy"). Implementation: `dimReadTags` now also caches
        notes (`DIM_NOTES`); `dimWriteTag(e,id,tag,notes)` takes an optional notes arg (omitted =
        DIM keeps the existing note); the apply loop appends " · best copy" after any existing
        note so nothing Diego wrote is lost.
      - **Auto-favorite gate `AUTO_FAV_MIN_CRIT = 3`:** a WATCHED weapon may only be auto-favorited
        when ≥3 criteria are tracked (`w.rollCrit`, baked in fetchWeapons = tracked perks + mw +
        stats). One matching tracked perk reads 100% but proves nothing — that's what mass-favorited
        Shayura's Wrath (2 criteria). Below the gate a high score still earns the (single) keep; the
        dedup `isFav` respects the same gate via `dec.favEligible`. Favorites-basis is not gated
        (needs 3★+3★ anyway). One-keep rule (only if no keep exists) confirmed unchanged.
      - **Unified TAG HISTORY (`tag-history.json`, gitignored, last 4000):** every tag change with
        source — `manual` (chip in this app, logged in /api/tag), `auto` (Auto-Manager pass),
        `dim` (edited inside the DIM app — caught by diffing each 30s `dimReadTags` against the
        last-known map, or the disk mirror right after a restart; our own writes update `DIM_TAGS`
        first so they never double-log), `revert` (undo). `GET /api/tag-history` (newest first,
        last 1000). `/auto` has a "Tag history — every change, by source" card with source-filter
        chips; names for `dim` entries resolve client-side from the weapons payload (id→name,
        weapons + armor).
    - **Per-run history + one-click UNDO (2026-07-12):** every LIVE pass appends its tag changes
      (`{id,name,from,to}` per action) to `auto-history.json` (gitignored, saveJsonSafe, last 40
      runs; dry-runs never recorded). `GET /api/auto/history` (newest first);
      `POST /api/auto/revert {at}` writes every `from` tag back to DIM (and for app-applied
      favorites also removes the app's own lock + green flag), then nulls `wcache`. `/auto` shows
      a "Recent live runs — one-click undo" card with a Revert button per run. Staging moves are
      not reverted (location, not data). Runs before 2026-07-12 were never recorded.
    - **ARMOR junk-staging (2026-07-12, Diego: "junk staging also works for armor… start with
      staging before auto tagging, I don't want you messing up what I have already tagged"):**
      `fetchWeapons` now also returns a compact `armor` list ({id,hash,rhash,n,slot,tt,own,loc
      (postmaster-aware),ownCid,locked,pwr,tag}) — tag from the LIVE DIM tags (same source as
      weapons; NOT the optional dim-data.json the armor page merges). The staging pass is a shared
      `stageJunkSet(kind,items,SLOTS,info)` run for weapons (Kinetic/Energy/Power) and — when
      `armorStage` (default true, checkbox in /auto + /settings) — armor (Helmet/Gauntlets/Chest/
      Leg/Class Item), same junkStage-per-slot, lowest-power-first, spill + caps, actions logged
      with `kind:'armor'` so /auto shows "(armor)" rows. **Armor is staging-ONLY: the app never
      writes an armor tag.** Legendaries only (a junk-tagged EXOTIC armor piece is ignored, same
      as weapons — Diego's vault had exactly one, verified excluded). Armor auto-tagging is a
      future feature (NEXT_PHASE, design with Diego first). **Fetch dedup:** `freshWeapons(maxAgeMs=15000)` in `main()` — pollDrops
      (25s) + auto passes share one deduped Bungie pull; an explicit `/api/weapons?fresh=1` always
      re-pulls. **Dry-run cache poisoning guard:** a dry-run mutates the in-memory snapshot with
      pretend tags (so its staging preview works) — `wcache` is nulled in the pass's `finally` so no
      later reader acts on tags that were never written. `fetchActivity` caches the membership
      resolution (`ACT_MEMBER`) — was an extra API call every pass.
    - **First-run note:** with Diego's 87 favorite perks + the per-weapon dedup, an uncapped preview
      showed **favorite 23 / keep 69 / junk 112** across ~101 weapons (best fav + best keep per weapon,
      rest junked). The live default caps junk at **25/pass** (every 2 min), so a big cleanup trickles
      through over several passes rather than all at once — safe and gradual. That's expected from the rules; if
      it's too aggressive, raise the keep/fav thresholds on `/auto` before enabling. **Not yet fired
      live** — the always-on 8787 server must be restarted to load this code (agent did NOT restart it,
      so Diego is present for the first live sweep). Reversible: tags are DIM tags, staging is a move.

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
