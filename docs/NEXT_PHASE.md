# NEXT_PHASE — where to pick up

> Maintained per CLAUDE.md. When a feature ships, move it to HANDOFF.md
> "What works now" and delete it here.

## Where we are (2026-07-06 — Weapon Watch redesign mockups + two data bugs fixed)

**Weapon Watch full redesign — 3 mockups presented, BLOCKED: awaiting Diego's pick.** Diego: "weapon
watch / weapon copies -- we need to redesign this... not organized... not following the organization
seen in other sections... I need 3 mockups." Built 3 self-contained, interactive Artifact mockups
(sample data, not live) sharing one common skeleton (banner, controls, card header, the perk-tracker
— unchanged, Diego hadn't complained about that piece) but differing in how COPY ROWS render:
- **A — Smart cards**: each copy is its own roomy card (perks side-by-side, full stat row, action row).
- **B — Organized table**: explicit column-headered grid (Score | Col3 | Col4 | Stats | Location | Actions).
- **C — Tile grid + drill-in**: compact tiles (mirrors Weapon Vault's `.wt` tiles), tap opens the exact
  `.ispcard` smart-card modal already used in Weapon Vault — closest match to "the organization seen
  in other sections."
All 3 are genuinely interactive (perk tap-cycle, tag toggle, expand/collapse) with cross-links between
them. Scratch files (not committed): `scratchpad/weapon-watch-mockup-{a,b,c}-*.html` — see the plan at
`.claude/plans/weapon-watch-weapon-distributed-sundae.md`. **Next step once Diego picks a direction:**
port it into the real `weapon-watch.html`, replacing the `.copy`/`renderWatched` copy-row block.

**Two data bugs fixed & verified live (2026-07-06), from Diego's report ("archon's thunder not present,
question what else is missing" + "golden tricorn / golden tricorn enhanced duplicated"):**
1. **Golden Tricorn duplicate — real manifest quirk, now folded.** Every perk list in this app dedupes
   enhanced/base perk variants by exact manifest display-name match (they normally share the SAME
   name) — but Bungie's manifest literally names the enhanced version "Golden Tricorn Enhanced" for
   this one perk (checked: it's the *only* trait perk with a literal trailing "Enhanced" in the current
   manifest). Added `foldPerkName()` (strips a trailing " Enhanced") and applied it at all 6 places
   perks are keyed by name in `vault-verdict.js` (`buildPerkLibrary`, `fetchWeapons`'s roll + pool
   building, `buildWeaponPools`'s `nameCol`, `parseWishlist`, `loadClarity`). Verified: Perk Finder now
   shows one "Golden Tricorn" entry (pop 83, wcount 93/103) instead of two.
2. **Archon's Thunder "not present" — NOT missing data, a punctuation-sensitive search bug.**
   Investigated: the weapon IS in `/api/weapons` (owned), `/api/weapon-pools` (all-weapons), sits at
   position 18/321 alphabetically among unwatched weapons — well inside the Add list's default
   30-row cap. Root cause: `matchesQuery`-style search did a plain `.includes()`, so typing "archons
   thunder" (no apostrophe, how most people type) against "Archon's Thunder" never matched — the
   weapon was always there, just unfindable by search. Fixed with a `normQ()` helper (strips
   `'`/`'`) in `weapon-watch.html`, `weapon-vault.html`, and `vault-verdict.html` (the three weapon/
   armor name search boxes). Verified live: searching "archons thunder" now returns "Archon's Thunder".
   **Reassurance for Diego:** this was never a case of missing weapons — the full weapon list (343
   owned / 1272+ in the game) was always complete; only the search box was punctuation-sensitive.

**NEW FEATURE REQUEST (Diego, 2026-07-06) — Director/featured-activity weapon tracking, BLOCKED:
awaiting research + Diego's confirmation.** Diego wants to pick specific weapons and get notified +
see a dedicated page when they're the FEATURED loot in rotating activities (Arena, Solo Ops, Sparrow
Racing League, etc.) — cites light.gg's "The Director" section as the reference. Not started —
needs research into whether Bungie's API actually exposes per-activity featured-loot rotation data
(likely candidates: `DestinyMilestoneDefinition` for weekly featured activities/Nightfalls,
`DestinyVendorDefinition`/vendor sale-item "featured" flags for rotating vendor foundries — needs
verification per activity Diego cares about) before committing to a design. Also flag to Diego:
Sparrow Racing League has not been a regular live playlist in years (only brief anniversary-event
returns) — worth confirming it's still relevant to him, or whether he means whatever the CURRENT
rotating-activity roster is. Scope: a new poller (mirrors the existing `pollDrops` god-roll alert
pattern) + a new page (mirrors `weapon-drops.html`) — same shape as work already in this app, so
feasible, but a real new feature, not a quick add.

## Where we are (2026-07-05, night — watch-perk picker rebuild + community popularity fix)

Diego's three asks, all shipped & verified live on 8787:

1. **Weapon Vault smart card watch-perk picker was messy — rebuilt to match Weapon Watch exactly.**
   It used to be a flat wrapped row of binary on/off perk chips. Now it's the same **side-by-side
   Column 3 | Column 4 grid, perks listed vertically, tap-to-cycle track → ★ high priority → off**
   (`.cols2`/`.pool.vert`/`.pk.t1`/`.pk.t2` — the exact shared classes Weapon Watch already used),
   6-perk cap with the same "6 max!" feedback. `weapon-vault.html`'s `pickSet` (a plain Set) became
   `pickPerks` (`{name: 1|2}`, matching Weapon Watch's `cfg.perks` shape) so priority actually saves.
   **Bug hit + fixed during this:** the click handler first called `inspect(curW.id)` to re-render
   with the new 3-state styling — but `inspect()` re-derives `pickPerks` from the *saved* WATCH
   config every time it runs, so re-opening the card silently wiped the edit before it was ever
   saved. Fixed by mutating the clicked button + the `#wpcount` counter directly instead (the same
   targeted-DOM-update pattern the old binary version used) — never call `inspect()` again from
   inside its own click handler.
2. **Perk Finder — both smart cards reorganized the same way.** Inventory card (`inspectInv`)'s roll
   viewer went from stacked `.wccol` blocks to the same side-by-side `.cols2` grid (read-only, shows
   the actual roll). Farmable card (`renderFarmCard`)'s picker got the same track/★-high/off cycle
   as Weapon Watch (was binary pick/no-pick). Both reuse the shared theme.css classes — no new CSS
   needed beyond one `.pk.on{border-color:var(--keep)...}` rule for the "currently rolled" cyan state.
3. **Community popularity was biased toward old perks — fixed with a real statistical measure.**
   Diego: "the older perks are very inflated compared to the newer ones... I need your help." Root
   cause: `pop` was a raw count of DIM wishlist roll-*lines* mentioning a perk, and the voltron list
   accumulates many curator-submitted roll variants for the same long-lived weapons over years —
   an ancient perk racks up dozens of near-duplicate entries for a handful of legacy weapons while a
   perk added last season has had only months to accumulate any, regardless of how good either
   actually is. **Fix (`vault-verdict.js`):** `parseWishlist` now tracks, per perk, the **distinct
   weapons** (by name, reissues folded) recommended for it — not raw line count — using the
   wishlist's `item=<hash>` field (previously ignored). `buildPerkLibrary` computes, per perk,
   `poolN` = how many CURRENT weapons can roll it (from the existing pool-building loop) and
   `wcount` = how many of the weapons recommending it can still roll it today (intersected with the
   current pool, so `wcount <= poolN`). **`pop` is now the Wilson score lower bound** of
   `wcount/poolN` (`wilsonLB`, z=1.96 — the same statistic Reddit uses for comment ranking): it ranks
   by a genuine adoption *rate*, not raw magnitude, while pulling down perks with a tiny sample (e.g.
   1/1 weapons) rather than letting them jump straight to "100%" over well-supported perks. Verified
   live: Kill Clip/Rampage/Outlaw (ancient, huge legacy pools) dropped to ranks #55/#87/#81, while
   Firing Line/Chill Clip/Frenzy (current, genuinely sought-after) now rank #1/#3/#4 — matches Diego's
   actual read of what's popular right now. The on-disk cache (`.dim-wishlist.json`) changed shape
   (`{weapons:[],pve:[],pvp:[]}` instead of `{total,pve,pvp}` numbers); `loadWishlist` detects the old
   shape and forces a fresh download rather than silently degrading to 0 pop for a week.
4. **"Most popular perk first" now applies everywhere perks are listed**, per Diego's ask, via a
   single source of truth: `perkPopMap(e)` (perk name → `pop`) is computed once (reusing
   `buildPerkLibrary`'s cache) and used to `.sort()` perk arrays at the three places they're built —
   `fetchWeapons`'s `cols` (the actual roll, shown in Weapon Watch copies / Weapon Vault inspect /
   New Drops / Perk Finder inventory card) and `pool` (the full per-weapon pool, shown in Weapon
   Watch's tracker + Weapon Vault's watch-picker), and `buildWeaponPools`'s pool (Perk Finder
   Farmable card). The Perk Finder library list itself was already server-sorted by `pop`; the combo
   search dropdown (`LIB.filter(...)`) inherits that order for free. Verified live: a sample weapon's
   Column 3/4 pool order matches strictly-descending `pop` from `/api/perks`.

Next work will come from new Diego feedback.

**Stability (fixed 2026-07-05, context for the new agent):** the app kept going offline
(`ERR_CONNECTION_REFUSED`). Causes were (a) a "retry the port forever" EADDRINUSE handler that spawned
immortal zombie node procs, (b) every restart = a 5s launcher gap (the launcher `start-vault.ps1`
waits 5s), and **most restarts were the agent's own** kill-and-relaunch to deploy code. Fixed: global
`uncaughtException`/`unhandledRejection` handlers, bounded EADDRINUSE retry (exits after ~20s, no
zombies), dual-stack `listen(PORT, '::')`. **Lesson for the new agent: UI/HTML changes are served from
disk — DO NOT restart the server for them. Only restart (once, cleanly) for server-code changes, and
expect a ~5s offline blip when you do.**

## Where we are (2026-07-05, late — vault manager batch + equip make-space + stability)

Shipped & verified on 8788: (1) **equip make-space fix** — `smartEquipWeapon` vaults an unlocked
weapon from a FULL character slot (1 equipped + 9 stored) before pulling from the vault; this was
why equip "didn't work" (Diego diagnosed it). Card shows `· vaulted X to make room`. (2) **Vault
inspect card**: trait Columns 3 & 4 now **side by side, perks stacked vertically** (`.ispcols2`).
(3) **"Clean inventory → vault"** rail control (Weapons / Armor / Both) → `cleanInventory` +
`POST /api/clean-inventory {characterId,kind}` vaults every unequipped weapon/armor for the
selected guardian. (4) **Official element icons** on tiles (`loadDamageIcons` → `DamageTypeDefinition`
icon per damage type, `def.dmgIcon`; `.wt .elic`) instead of the colour diamond. (5) **Weapon-type
filter dropdown** + **sort-by-stat dropdown** (`fType`, `statSort` over `statsMax`) added to the
existing rail. All `.env`/write actions use the same scope as lock/equip.

**Server stability:** the app was flickering offline from an **EADDRINUSE crash-loop** on restart —
now the server retries `listen()` after 3s instead of exiting (committed 153172d). Don't do the
kill-node + racing-relaunch pattern; let the launcher restart it.

## Where we are (2026-07-05, evening — batch of UX fixes + god-roll dedupe)

Shipped & verified live (8787): (1) **perk hover popup now has a 400ms delay** (`perktip.js`
`HOVER_DELAY`) so it doesn't flash while skimming; (2) **Weapon Watch copies sort by tag**
(favorite → keep → none → junk, then score) + a **"Junk untagged"** button that mass-junks every
untagged weapon copy (writes to DIM, confirm dialog); (3) **god-roll alert fires ONCE per drop** —
`ALERTED` Set in `pollDrops` (was re-firing every 25s poll because the drop stays `fresh`);
(4) **Vault inspect card has a watch-perk picker** (all pool perks → Save to Weapon Watch, merges);
(5) **Vault filters now dim non-matches and sort matches to the top** instead of hiding them
(`filtersActive` + `bySort` in `render()`; `.wt.dim` opacity .34).

(6) **Fashion now includes Ghost shell + Vehicle (sparrow) + their shaders.** `fetchFashion`
manages `COSMETIC_BUCKETS` = armor + **Ghost `4023194814`** + **Vehicle `2025709351`** (verified
live — my first ghost hash `4023510869` was wrong; found the real one by dumping equipment buckets).
Ghost/vehicle item defs aren't in the slim manifest, so slot = `it.bucketHash` and name/icon come
from an on-demand `itemDefLite` (cached). Ghost ornament = its **hologram/projection** socket
(pc `hologram`); vehicles have shader only. `fashion.html` is generic over `FASH.order`, so both
sections render + save/apply automatically. Verified live: Ghost "Soloist Shell" (No Projection +
Capering Harlequin), Vehicle "Old Rancor" (Capering Harlequin).

**All six of Diego's 2026-07-05 batch requests are shipped.**

## Where we are (2026-07-05, later — Perk Finder cards + weighted favorites + vault % shipped)

Shipped & verified on 8788 (details → HANDOFF). Five features:
1. **Perk Finder inventory smart card** — click a Best-Match weapon → card with perks/MW/kills +
   Equip / To Vault / Lock / Keep / Fav / Junk (ported from `weapon-vault.html` `inspect()`).
2. **Perk Finder farmable card** — click a farmable weapon → all rollable perks as checkboxes →
   **Save to Weapon Watch** (merges into `weapon-watch.json`; verified it preserves existing entries).
3. **Perk tag filter** — chips (Damage/Reload/Stability/Handling/Range/Ability/Ammo/Healing +
   element verbs Jolt/Scorch/Slow/Sever/Volatile), tags derived server-side (`tagsFor` in
   vault-verdict.js), `/api/perks` returns `tags`.
4. **3-star weighted favorites** — `/api/favorites` is now `{perkName: grade 1-3}` (back-compat:
   old array → grade 1); rating widget in Perk Finder. Weights 1★=1 · 2★=1.5 · 3★=2.
5. **Weapon Vault score = relative %** (100% = best favorite roll this weapon could roll), tile
   shows color-coded % (≥85 gold/≥60 teal/≥35 white/else red / — none), **Min-score slider** hides
   low tiles. Also **character inventory is now a 3-column grid** (Diego's in-game/BrayTech picture;
   the big equipped tile was already correct — only the inventory below it changed from 5→3 cols).

**Note:** Diego already has **87 favorites** (starred on his live server), all grade 1 — regrade in
Perk Finder to get intermediate %s (uniform grade 1 only yields 0/50/100%). Open follow-up unchanged:
farmable→watch for UNOWNED weapons drives drop alerts but the Weapon Watch UI only renders owned.

## Where we are (2026-07-05 — perk popup REDESIGN shipped)

Redesigned perk hover popup (locked design + Diego's decisions). Details in HANDOFF. Key points:
- `perktip.js` shared popup; server serves cleaned insight **bullets** (`insightBullets`) from
  `.clarity-clean.json` (curated, committed) + a **lossless** rule-based fallback.
- **Diego's rule: NEVER drop info.** Decision: **keep hand-rewrites but make them COMPLETE**
  (every per-stack %, PvP split, enhanced bonus kept). English curation is en-only; other locales
  fall back to localised Clarity (see l10n spec).
- **Audit tooling** (`scratchpad/gen-report.js` → perk-review.html artifact): compares in-game +
  raw Clarity vs displayed for all 278 perks and flags any dropped number/keyword. Caught two real
  bugs: the fallback `.slice(0,5)` cap (dropped Chaos Reshaped's damage+heal) and the editorial
  filter nuking whole data-bearing bullets (Headseeker). Both fixed → **0 real number-drops**.
  Regenerate: refresh 8788, `curl /api/weapons -o scratchpad/w.json`, `node scratchpad/gen-report.js`.
- **Remaining work:** curated clean bullets cover ~34 top perks; the rest use the lossless fallback
  (complete but denser). Expand curation over time (re-audit each with gen-report). Add the hover to
  Perk Finder match rows + Weapon Vault tiles if wanted (currently: perk lists/rolls + vault inspect).

## SPEC: localisation — pt-BR now, more languages later (2026-07-05, Diego)

Translate the whole tool to **Portuguese (pt-BR)** and keep it open to more languages.
**Per Diego's spec: everything API-derived must be pulled from the API in the selected locale**
— do NOT translate API text ourselves.
- **Bungie manifest:** `loadManifest` currently hard-codes `jsonWorldComponentContentPaths.en`.
  Switch to the chosen locale's paths (Bungie ships en, pt-br, de, es, es-mx, fr, it, ja, ko, pl,
  ru, zh-chs, zh-cht) → localised weapon/perk names, descriptions, sourceStrings, stat names.
- **Clarity insights:** `loadClarity` uses `descriptions.en`; use `descriptions[locale]` (Clarity
  ships several langs). This makes the community insight localise for free — and is another reason
  to prefer lossless Clarity over English hand-rewrites (`.clarity-clean.json` is English-only and
  would NOT translate; a localised build must fall back to Clarity's localised text).
- **UI chrome** (button labels, section titles, our own copy) = a separate strings table (i18n),
  not API — the only text we translate ourselves.
- Cache per locale (`slimN-<ver>-<locale>.json`, `.clarity-<locale>.json`). A locale selector
  (banner or settings) drives it. Source strings for filters (crucible/raid/etc.) also localise —
  the Weapon Watch source search would then match localised source text.

## Where we are (2026-07-04, night — perk insights + favorites + search)

Just shipped & verified live on 8787 (details in HANDOFF "What works now"):
1. **Perk hover popup** with in-game description + **DIM community insight (Clarity)** — on Weapon
   Watch and Perk Finder. Server: `loadClarity` + `.clarity.json`, slim manifest bumped **slim5→slim6**
   (perk `dsc`), `/api/weapons` → `perkDescs`/`perkInsights`, `/api/perks` → `dsc`/`insight`.
2. **Favorite perks (★)** in Perk Finder → saved to `perk-favorites.json` (`/api/favorites`), used to
   **score every weapon in the Vault**; the vault tile shows the **★ perk score in place of power**
   (toggle + `Perk · Favs` sort).
3. **Weapon Watch search bar moved to the top**, narrows watched + add lists, **searches by source**
   (crucible/iron banner/raid/trials/…).
4. **Weapon Vault equipped tile ~1.7×** the inventory tile (Diego's chosen proportion).

All tested on an isolated 8788 instance (new `PORT`/`VV_CACHE_DIR` env vars) then the always-on
8787 server was restarted onto the new build (its supervisor auto-restarts on kill; slim6 cache was
pre-placed so no re-download). Diego confirmed the 1.7× equipped size live.

**Possible follow-ups (surface, no commitment):** favorite-perk score could weight ★ vs normal, or
count only currently-equipped perks; add the hover tooltip to the Weapon Vault inspect + Perk Finder
match rows; a "source alias" map if Diego wants `raid`/`nightfall` synonyms broadened.

## Where we are (2026-07-04, evening — LOOK / BrayTech pass)

Diego wants the app to look like his BrayTech character page
(bray.tech/3/4611686018530139303/2305843010375154553/character): **top banner with his
in-game emblem + name**, game-like everywhere, and **section tabs on the right** to reach
Armor Vault / Weapon Vault / Fashion.

**SHIPPED:** the nameplate banner (`banner.js` + `/api/account` + theme.css `.gb*`) on every
page — emblem-art background, name (Aquarius), ✦power + class, character-switch dots, and the
section nav right-aligned in the banner. See HANDOFF. This delivers "top banner + name" and the
"section tabs on the right."

**Diego's clarified vision (2026-07-04):** build a BrayTech-style **unified vault** — the armor &
weapon **inventory/vault as a visual grid** in the left/center, and on the **right side** put the
**tools we already built** (perk filters for weapons, junk/keep verdict for armor) where BrayTech
shows engrams/power/currencies. Grid views are ADDITIVE — do NOT remove Weapon Watch / Vault
Verdict tools.

- ✅ **Weapon Vault — SHIPPED 2026-07-04** (`weapon-vault.html`, `/vault`; see HANDOFF): weapon
  grid + right-rail filters (element/ammo/rarity/tag) + perk-combo filter + tile inspect. Nav now
  has both "Weapon Vault" (grid) and "Weapon Watch" (tracker).
- **NEXT: Armor Vault grid** — same treatment for armor (`vault-verdict.js` `fetchArmor` already
  scores keep/junk/review). New `armor-vault.html` at (probably) `/` or `/armor`: armor tiles
  grouped by slot/class, right rail = the keep/junk **verdict + its filters** (class, slot, bonus
  set, keep/review/junk) instead of BrayTech's power/currency rail. Reuse Vault Verdict's engine;
  present as a grid. Confirm with Diego whether the new grid becomes the primary "Armor Vault" (/)
  or sits alongside the existing detailed Vault Verdict page.
- ✅ **Weapon Vault = inventory manager — SHIPPED 2026-07-04:** tile inspect has Equip / To Vault /
  Lock / Keep / Fav / Junk (existing endpoints). Diego asked for DIM-like management from the grid.
- ✅ **Smart exotic swap — SHIPPED 2026-07-04** (`smartEquipWeapon`, dry-run verified; see HANDOFF):
  equipping an exotic while another exotic is equipped frees the old slot with a matching-ammo
  legendary first. Diego's "fix what DIM can't do right."
- **Diego still to test IN-GAME:** the real equip/vault/tag/lock writes (I only dry-ran the swap and
  rendered the buttons — did NOT fire live writes on his account during testing). He confirms the
  actual smart swap next time he plays.
- **Later polish:** a right power/currency rail if Diego wants the BrayTech info panel too; show an
  "equipped" marker on tiles (needs fetchWeapons to carry equipped state).

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
