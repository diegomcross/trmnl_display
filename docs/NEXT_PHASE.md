# NEXT_PHASE — where to pick up

> Maintained per CLAUDE.md. When a feature ships, move it to HANDOFF.md
> "What works now" and delete it here.

## Where we are (2026-08-27 — reuse bias + non-★ floor SHIPPED, spec §9 step 5 done)

Diego described the model in full and it exposed two gaps between his intent and the build:

1. **Reuse bias was never implemented** (spec §9 step 5, deliberately deferred on 2026-08-15).
2. **Non-★ exotics were built to do nothing.** The 2026-08-15 reading of *"the other exotics just
   help decision with uneeded dupes"* became "no solve, protects no legendaries". Wrong — he wants
   them building from already-kept pieces at a lower floor.

Both are now shipped, rebooted and verified live — see DIEGO_RULES §4d rules 11-14 and HANDOFF.
Effect on his vault: Warlock keeps 320 → 387, junk 242 → 175. Build variety preserved, and 0 rated
set slots were broken by the engine.

**Still NOT started — spec §9 steps 6-8:** (6) the full farming report, (7) the `rearrange` alert
kind, (8) deleting the niche key from `compute()`. Step 5 was pulled forward because Diego asked
for it directly; 6-8 still await his go-ahead.

**Still open, neither touched by the agent:**
1. `auto-manage.json` has `enabled: true` and the **weapons** Auto-Manager ticks every minute.
   His standing rule (DIEGO_RULES §3) is that it stays off. **BLOCKED: awaiting Diego.**
2. The 2026-08-23 19:49 DIM junk-tag of 105 armor pieces, cause unknown, tags already gone.

He has still not pressed Apply; no armor writes have ever been made.

---
## Where we are (2026-08-25 — declutter junk rule CORRECTED, rebooted and verified live)

Diego: *"the declutter function tag pieces of armor to be junked that I needed. What is going on?"*

**Nothing had been written to his account** — no `armor-apply-history.json`, no
`armor-declutter` rows in `tag-history.json`, and all 882 armor pieces carried no DIM tag. What he
saw was the preview list, and the preview list was wrong.

**Root cause.** `armorDeclutter()` ran his 2026-07-12 rule *"Armor 2.0 legacy — junk always"* as a
blanket pre-pass over every item, before any exotic logic. He owns **zero** Armor 2.0 legendaries,
so today that rule fired on nothing but exotics: 54 of them, including 5 of his 7 ★ favourites and
13 pieces that were his only copy of that exotic. His spec never asked for that — §3 step 6 defines
junk as *"everything else in a rated/selected set"* (legendaries) plus duplicate exotic copies.

**Fixed and shipped** (see DIEGO_RULES §4c rules 9-10 and HANDOFF):
- a 2.0 **exotic** is junked only when a 3.0 copy of that same exotic is already owned;
- a 2.0 **legendary** is still junked verbatim by the 2026-07-12 rule;
- an equipped piece is never presented as junk (downgraded to `review`).

**Servers were rebooted and the fix verified live in his browser with his own ratings.** Audit on
the real vault: 0 exotics he would stop owning, 0 equipped / DIM-loadout / favourite-tagged pieces
in the junk list, 0 slots emptied. `tests/guardrails.js` now 122 passed / 0 failed, including six
new checks that lock this behaviour in.

**Still open, both for Diego, neither touched by the agent:**
1. `auto-manage.json` has `enabled: true` and the **weapons** Auto-Manager is ticking every minute.
   His standing rule (DIEGO_RULES §3) is that it stays off until he confirms. **BLOCKED: awaiting Diego.**
2. On **2026-08-23 19:49** something junk-tagged 105 armor pieces in DIM (58 exotics). Not the
   declutter — it does not match the engine output, left no journal entry, and junked a piece tagged
   `favorite`, which Apply refuses to touch. Those tags are gone and nothing was lost; cause unknown.

**Steps 5-8 of the spec §9 build order are still NOT started**, per his *"STOP after step 4"*.
He has not pressed Apply; no armor writes have ever been made.

---
## Where we are (2026-08-15 — declutter preview SHIPPED, steps 5-8 next, BLOCKED: awaiting Diego's review)

Diego wrote **`docs/ARMOR_DECLUTTER_SPEC.md`** himself. **That spec is now the authority — it
supersedes the 2026-07-25 FINAL MODEL below wherever they disagree.** Its §9 is an 8-step build
order; he asked for **steps 1-4 only, then stop and show him**. Those four are shipped and verified
against his live vault — full technical detail in HANDOFF's "Build-driven armor declutter" entry.
Headline: exotic tuning moved server-side into `exotics.json`, a global `thr.statFloor` (150) with
per-exotic overrides, favorite exotics (max 7) that solve first, the per-class/per-exotic solver
reusing `championSet()` unchanged, and a read-only preview panel in Vault Verdict. **Nothing tags,
moves or writes armor; the old niche engine still produces the live verdicts.**

**⚠ Diego must double-click `REBOOT.cmd`** — all of this is server-side JS. Until he does, the
`/api/exotics` and `/api/armor/declutter` routes don't exist. The page degrades gracefully (it
falls back to localStorage and the preview button reports the missing endpoint), but the feature
is not live.

**Also shipped 2026-08-15, added mid-session and NOT in the spec's build order:** the **Apply**
button — keep → DIM `keep` + locked in-game, junk → DIM `junk` + unlocked for dismantling, with a
dry-run diff, a confirm, and full undo. This reverses the old "armor is never tagged" rule on
Diego's explicit instruction; details + the surviving constraints are in HANDOFF and DIEGO_RULES
§4b rule 8. **Diego has NOT pressed it yet** — the dry run says 69 locks / 132 unlocks / 464 tags.

**NEXT — spec §9 steps 5-8, in order, and NOT before Diego confirms the preview:**
5. Reuse bias inside `championSet`'s `bestIn()` + `armor-keeps.json` stickiness (§3 step 5, §2.3).
   The favorite-exotic solve order shipped in step 3 is the hook this hangs off.
6. The full farming report (§4) — `setGaps` / `exoticMissing` are already returned and the preview
   shows a partial floor-status line; §4 wants the per-exotic archetype/tertiary shortfall too.
7. The `rearrange` alert kind on the existing builds-alerts feed (§5) — suggestions, never applied.
8. **Delete the niche key from `compute()`** — LAST, once the replacement is proven.

**ANSWERED 2026-08-15 and shipped** — asked what "prioritized" should do to the keep list, Diego
said: *"favorites are set at the floor, the other exotics just help decision with uneeded dupes."*
Only ★ favorites solve and decide keeps; non-favorites just settle their own duplicate copies.
Test run (7 stars, 17 rated sets): Warlock **280 keep / 174 junk → 207 keep / 244 junk**.

**Remaining lever on the keep count, worth raising with him:** with sets never competing, the
driver is now **how many sets he rates**, not how many exotics he stars — 7 favorites × 17 rated
sets × 4 open slots is still ~200 distinct pieces. If 207 keeps still feels like too little
decluttering, the honest answer is to rate fewer sets 4pc, not to change the algorithm.

**Data caveat for whoever picks this up:** the real numbers depend on two things that still live in
Diego's BROWSER, not on disk — his set ratings (`vv-ratings`) and, until he loads the page once
after REBOOT, his exotic tuning. The test run used the app's own `DEFAULT_FAVS` seed table (29
Warlock exotics, no Hunter/Titan) and a synthetic 15×4pc + 2×2pc rating set. **Diego pressing "Run
preview" in his own browser is the only source of true numbers.** Also still true: only 1 of his 92
builds is a usable `watch:true` build, so almost every exotic runs on the stat-floor fallback.

## Where we are (2026-07-26 — Build Crafter UI fixes shipped; declutter engine still a preview to build)

Diego flagged four `/builds` usability problems (single-select set bonus, no tooltip on
"watch drops", split min/max sliders with no stat icons, misaligned checkmark badges) —
all four **shipped and verified**, full technical detail in HANDOFF's Build Crafter
section ("Multi-select set bonus + stat-icon sliders + badge-clipping fix"). Headline:
`setBonus` is now an array (a build can target several sets, not just one), each
selected set gets its own independent suggestions block, real in-game stat icons now
render next to stat names, min/max collapsed into one dual-handle slider, and the
checkmark-clipping bug (badge was a `::after` clipped by its own parent's
`overflow:hidden`) is fixed everywhere it appeared.

**Mid-session correction (2026-07-26, important — changes the destination, not the UI
just shipped):** Diego clarified the multi-select isn't just a suggestions-comparison
feature — it's the direct input to the still-unbuilt vault decluttering engine from the
2026-07-25 FINAL MODEL below: *"Once the builds are created and set bonuses are selected,
the app curates the best armor pieces to keep in the vault... It's an optimization tool
to keep the good builds while maintaining the vault decluttered."* This **supersedes**
the FINAL MODEL's data source (rule 4 in DIEGO_RULES.md said "sets Diego has rated" via
the separate `vv-ratings` panel — that panel is client-side/localStorage only and never
reached the server anyway). The real data source is now: the set(s) picked directly on
each exotic's build(s) in `/builds`.

**NEXT (not started): the vault declutter/keep-junk engine itself.** Per CLAUDE.md's hard
rule on high-blast-radius changes, this must be a **read-only preview** Diego reviews
before any real junk-tagging goes live — same caution as the FINAL MODEL below already
called for. Design carries over almost unchanged from the FINAL MODEL, with the set
source swapped: for each owned exotic with a tuned favorite stat (or its `watch:true`
Build Crafter build's real `prio`/`min`/`max`), for each set selected on that exotic's
build(s), keep the single best-scoring piece per open slot within that set — sets don't
compete, all qualifying sets' picks are kept in parallel. Where to surface the preview
(Vault Verdict page vs. a new panel) not yet decided — natural fit is vault-verdict.html
since that's where keep/junk verdicts already live.

**Reminder for whoever builds this next:** the always-on server (`vault-verdict.js`,
`server.js`) is running Diego's OLD code until he double-clicks `REBOOT.cmd` — the
`/builds` backend changes (array `setBonus`, `variants` shape on `/api/builds/suggestions`,
`statIcons` on `/api/subclass-catalog`) do NOT go live until then. `builds.html` itself is
served from disk (no restart needed for HTML/CSS), but it now calls the NEW response
shapes, so **the page will look broken against the OLD server** until Diego reboots.

## Where we are (2026-07-25 — Armor Vault redesign: build-crafting model, spec in progress, BLOCKED: awaiting Diego confirmation)

Diego reviewed two preview artifacts of a richer keep/junk explanation layer for Vault
Verdict's armor engine and said the underlying model is wrong, not just under-explained
(verbatim, 2026-07-25): *"there's nothing taking into consideration maximizing stats for
build crafting and in my specs originally, this was a great influence, the main purpose
of the tool. It consider the exotic armors, then tries to maximize stats with the set
bonuses while trying to keep a minimum of pieces in the vault. So for TechSec armor set,
it would try to keep the minimum number of pieces that gives max stats for the exotic
armor pieces. It would try to do the same with other set bonuses."* Full ruling recorded
in `docs/DIEGO_RULES.md` §4.

**The gap, proven with real data:** pulled his live `/api/armor` (824 pieces) and ran the
current `compute()` niche engine (from `vault-verdict.html`) against it. For Warlock
Techsec alone (excluding Chest, which an exotic would occupy): **13 pieces across 4 slots,
0 junked** — because every piece has a distinct archetype×tertiary combo, so every piece
is its own unique "niche" and nothing is ever compared against anything else. This includes
`Techsec Boots · Powerhouse/Grenade · T3 · tot 66` surviving as a keep purely because no
other Leg piece shares its exact niche — even though a flat-out better Grenadier/Melee
T5/tot93 Leg piece sits right next to it in the same set. The engine's own tie-break ladder
(tier → total stats) would junk that T3 piece instantly if the two were ever compared, but
the niche key keeps them apart. This is the core proof that "one keeper per niche" isn't
the same tool as "minimum pieces to cover every exotic build's max stats."

**Diego's model, restated:** builds are anchored on an exotic (one per class, occupies one
slot). For every other slot, pick the legendary — from whichever set — that maximizes the
exotic's tuned favorite stat(s) (reuse the existing `favScoreOf` weighting: 3×primary +
2×secondary + 1×tertiary), preferring pieces from the SAME set across those slots to also
land the set's 2pc/4pc bonus. The vault should keep the smallest set of legendaries that
covers this for every exotic build worth building — not a separate "best" piece for every
theoretical archetype×tertiary combination regardless of whether any real build wants it.

**Worked example (real data, Warlock Techsec, all in `docs/DIEGO_RULES.md` §4 + the chat):**
for a Starfire Protocol build (favorite stat: Grenade), the minimum-piece answer is 4
pieces — one per non-Chest slot, each the highest-Grenade Techsec piece in that slot
(Helmet: Grenadier/Melee T5 g30, Gauntlets: Grenadier/Weapons T5 g30, Leg: Grenadier/Melee
T5 g30, Class Item: Specialist/Melee T5 g6 — the weakest link, since no Grenadier-archetype
Techsec class item exists in his collection). That's 4 kept vs. today's 13, and it also
lands the Techsec 4-piece bonus for free since all 4 are the same set.

**BLOCKED — needs Diego's answers before implementation** (asked via AskUserQuestion in
chat, record verbatim once given):
1. Does "minimum pieces" mean the union across **every exotic with a tuned favorite stat**
   (so Techsec might keep more than 4 pieces if a second exotic wants a different stat),
   or only exotics that have an actual **saved Build Crafter build** (`/builds`)?
2. Should this **replace** the niche/tier/total-stat engine for legendaries entirely, or
   run as a second pass that overrides it only where an exotic/set pairing applies (with
   the old engine as fallback for legendaries no exotic build touches)?
3. "Maximize stats" — the exotic's tuned favorite stat(s) specifically (matches the
   existing exotic-favorites formula), or the full Build Crafter stat-priority/min-max
   system already built for `/builds`?

**Answers received (2026-07-25, all in chat, verbatim where quoted):**
1. Exotic scope: *"if an exotic matches the tracked stats for that exotic, than use that
   exotic. Consider the exotics currently in the vault until a better one drops. For
   bonuses that 4-pieces were selected, you have to consider builds with 4 pieces for
   that set bonus"* — every owned exotic with a tuned favorite stat counts (not only ones
   with a saved Build Crafter entry); uses whichever copy is currently owned (recomputes
   live, no special-case needed for upgrades); a 4pc set bonus must actually be filled by
   4 same-set pieces, not shortcut to fewer.
2. Replace vs. layer: **"Replace entirely."** The niche/tier/total-stat engine goes away
   for legendaries — build-driven picking takes over completely (exotics' own tie-break
   logic is unchanged, this only touches legendaries).
3. Stat target: **"Full Build Crafter stat priorities."** Use each build's real `prio`
   (ordered stat list) + `min`/`max`, not just the simpler favorite-stat 3/2/1 formula.
   **Fallback for exotics with no saved build:** none stated yet — my working assumption
   is fall back to the existing favorite-stat weighting; flag to Diego if this matters.

**CORRECTION (2026-07-25, same session) — the model was still wrong after answers 1–3.**
First pass treated the candidate sets as *competing* — picked one "winning" set per
exotic build by comparing their 4-piece totals against each other (e.g. ran Starfire
Protocol's real saved build "Perpetual Protocol" — prio `g>w>h>c>s>m`, min g/w/h=100 —
against all 18 of his sets with full open-slot coverage; Sage Protector scored highest
at 1530 vs Techsec's 1417, so v1 kept only Sage Protector's 4 pieces and would have
junked Techsec entirely). **Diego corrected this directly: "We're not decided who's the
winner based on set bonus higher stats. Each set bonus is different in build crafting...
for every exotic, you have to keep the best armor pieces in all sets chosen that
maximize stats."** Sets don't compete — each is an independently valid build. Corrected
model: for a given exotic, iterate every **rated** set (see below) *separately*; within
each one, keep only the single best-scoring piece per open slot (still collapses TechSec's
13 owned non-Chest pieces down to 1-per-slot = 4, same for Sage Protector = 4, but BOTH
sets' 4 survive — 8 kept for this one exotic, not 4). Verified numbers (Warlock, Starfire
Protocol, prio-weighted score = 6/5/4/3/2/1 × stat value for priority positions 1–6):
Techsec best-per-slot = Hood·Gunner/Super·T5 (380) / Gloves·Grenadier/Weapons·T5 (370) /
Boots·Gunner/Class·T5 (360) / Bond·Specialist/Melee·T5 (307); Sage Protector best-per-slot
= Cover·Grenadier/Weapons·T5 (370) / Gloves·Gunner/Class·T4 (395) / Boots·Bulwark/Weapons·T5
(349) / Bond·Gunner/Health·T5 (416).

**"All sets chosen" = confirmed (2026-07-25, Diego: "those that I have rated")** — the
sets already rated 4-piece or 2-piece in the existing set-ratings panel (`ratings` /
`vv-ratings`), not literally every set in the game. Ignore/Undecided sets are out of scope
for this algorithm and keep falling back to the existing simpler rules.

**FINAL MODEL (2026-07-25, ready to preview against real data):**
1. Armor 2.0 legacy / manually-tagged-junk: unchanged, instant junk (no change here).
2. For each class, for each **owned exotic** with a tuned favorite stat: find its saved
   Build Crafter build(s) for `prio`/`min`/`max` (fallback to the favorite-stat 3/2/1
   formula if none saved — unconfirmed assumption, flag if wrong). **Open sub-question:**
   several exotics have 2–5 saved builds with different priorities (often near-duplicate
   DIM-import drafts, e.g. two "Sanguine Alchemy", two "Boots of the Assembler") — using
   every one as a separate protected build could balloon the kept count against the
   "minimum pieces" goal; needs a dedupe/selection rule when this gets implemented
   (candidates: only `watch:true` builds, only the newest per exotic, or union of all with
   near-duplicates collapsed) — ask Diego if it comes up in practice.
3. For each set **Diego has rated 4pc or 2pc** that has at least one owned legendary in
   every one of that exotic's open (non-exotic) slots: **within that set only**, keep the
   single highest-scoring piece per slot (score = sum of stat × weight-by-priority-rank
   from the build's `prio`). Every other set-rated-4pc/2pc is evaluated the same way,
   independently — sets never compete against each other, all qualifying sets' picks are
   kept in parallel.
4. Every legendary in a rated set that ISN'T the best pick for any owned exotic's open
   slot is a junk candidate (same safety nets as today: manual favorite tag, DIM loadout
   use pull it back to Review, never straight to Junk).
5. Legendaries in Ignore/Undecided-rated sets, or belonging to a set with no full-slot
   coverage for any current exotic build, fall back to today's existing rules unchanged
   (Ignore = must beat everything globally for the 180 target; Undecided = protected/
   flagged).
6. Exotic-vs-exotic tie-breaking (same exotic, multiple copies) is UNCHANGED — still the
   existing favorite-stat weighted score from the exotics panel.

**Diego exported his real ratings (2026-07-25)** — pasted in chat, saved to
`scratchpad` for this session (not committed; his real `vv-ratings`/`vv-exofavs`
values). 15 sets rated 4pc, 2 rated 2pc (Techeun's Regalia, AION Adapter), rest
Ignore. 37 owned exotics have a tuned favorite stat.

**Multi-build-per-exotic resolved (2026-07-25):** ran the model for real and hit the
predicted problem immediately — `Winter's Guile` alone has 3 saved builds with 3
different priority orders, and with 15-17 rated sets qualifying per exotic, treating
every saved build as a separate protected scenario produced 305 kept / 217 junk out of
522 rated-set legendaries — a real but modest cut, not the dramatic reduction the
TechSec/Starfire single-exotic demo implied (that demo only showed ONE exotic; the real
run unions 37). **Diego's answer: only builds with `watch:true` count.**

**Practical consequence, found by actually running it: today only 1 of his 37 tuned
exotics has a real watched build.** `builds.json` has 92 saved builds but only 2 have
`watch:true` — and both are identical duplicates, both for **Winter's Guile**
(prio Melee>Weapons>Health>Class>Grenade>Super, min Melee=175). The other 36 exotics
have zero watched builds and fall back to the simpler favorite-stat formula (3×primary +
2×secondary + 1×tertiary from `exoFavs`) until Diego watches more real builds. Re-run
with this rule: **240 kept / 282 junk** of the 522 rated-set legendaries — a better cut
than the all-builds version, mostly because the fallback formula is simpler (one
scenario per exotic instead of several near-duplicate ones).

**Where this leaves it:** the model itself is now fully specified and matches Diego's
corrected intent (verified §4 of DIEGO_RULES.md). The remaining gap is DATA, not design —
most of his 90-odd imported Build Crafter drafts have never been curated (`watch:false`,
many literal duplicates of the same exotic/build). **Diego should go into `/builds` and
mark his real, currently-used builds as watched** (delete or ignore the DIM-import
duplicates) to get the full benefit of "full Build Crafter stat priorities" — otherwise
most exotics run on the simpler fallback. Next step once he's done that (or decides to
proceed with the fallback-heavy state as-is): build the real interactive preview/UI for
this model, then wire it into `vault-verdict.js`'s `compute()`, replacing the old
niche engine for legendaries in rated sets (exotics' own logic is unchanged). **Still do
not implement into the live app until Diego has seen and confirmed a preview** — CLAUDE.md
rule, and this is a large enough behavior change to warrant it.

## Where we are (2026-07-17 — friend setup wizard shipped; REBOOT.cmd still pending from 07-16)

Diego asked to let his friend use the app ("hosted on his pc, just like mine", friend knows less
programming than Diego, should never touch .env). Shipped: SETUP MODE (server boots without .env
and serves a 3-step `/setup` wizard — Bungie app keys form, Bungie OAuth login with paste-back,
one-click DIM connect), `INSTALL.cmd`, `docs/FRIEND_SETUP.md` (distribution: GitHub ZIP + Diego
privately sends `.env` + `.dim-app.json`). `/setup` is also the new re-auth path for Diego himself.
All verified on an isolated no-.env instance; details in HANDOFF. Also same day: Rate-ungraded
list fixed to trait-library perks only (106→68) and `docs/DIEGO_RULES.md` created (canonical
Diego-rulings file — keep it updated!). **Diego's REBOOT.cmd is still pending** — it will load
BOTH the 07-16 best-of-both scoring AND the setup wizard onto his live server. The friend's copy
needs nothing special — a fresh GitHub ZIP already contains everything.

## Previous status (2026-07-16 evening — scoring review round 2 shipped, needs Diego's REBOOT.cmd)

Same-day follow-up to the tracked-perk union fix (which IS live and verified): Diego said "it
isn't working still" and asked for scoring suggestions. Audited his manual tags as ground truth —
41 hand-tagged keeps scored <60. Offered 4 fixes; **Diego picked #1 best-of-both watched scoring
and #2 rate-ungraded-perks review** (both shipped, see HANDOFF "Weapon Vault tile score" and the
Perk Finder "★ Rate ungraded" entries). He also ticked "Something else" in the picker **without
saying what — ASK HIM what he meant** (BLOCKED: awaiting Diego). Not picked (offer again if junking
worries return): **#3 replaceability guard** (never auto-junk raid/Trials/adept copies — dry-run
showed 88% dupes of Tyranny of Heaven/Bane of Sorrow being junked) and **#4 gentler dupe rule**
(60–79% dupes left untagged instead of junked). **Diego must double-click REBOOT.cmd** for the
server-side best-of-both scoring; the Perk Finder review works already (HTML served from disk).
Auto-Manager remains DISABLED. Manual-keeps-scoring-<60 went 41 → 18 (rest are one-good-column
raid/adept keeps — exactly the #3 territory).

## Previous status (2026-07-12 — DIM-sync audit: staleness + orbit-detection bugs FIXED, servers already rebooted)

Diego reported "DIM not syncing / taking too long" + "activity detection unreliable" + asked for an
always-visible last-update indicator. Audit found the DIM cloud connection HEALTHY — the real bugs
were (1) `GET /api/weapons`/`/api/armor` serving a **forever-cached snapshot** whenever Destiny was
closed, and (2) the activity gate treating **orbit (its own activity, hash 82913930 — NOT hash 0)**
as "in an activity", so junk staging only ever ran in the Tower. Both fixed + shipped same day, with
`junkStage` 3→5 per slot (Diego's ask), a 15s end-of-activity poll, the banner "Updated Xs ago"
chip + idle auto-reload on every page, `GET /api/status`, and server console output now captured in
`vault.log`. All verified live (activity resolved by name mid-Trials; chip green in browser; server
lines in the log). REBOOT.cmd was already run — new code is live; `auto-manage.json` was re-enabled
(it sat at enabled:false). Everything below is the 2026-07-09 state and still-next items. Full
details in HANDOFF "Activity gate", "Junk staging", "Data freshness overhaul".

**LATER SAME DAY (2026-07-12, second batch):** ⚠ **INCIDENT + the top-priority next task.** After the
orbit fix + my re-enable of `auto-manage.json` (it sat at enabled:false), Diego finished a Trials match
and the Auto-Manager ran LIVE at 07:33–07:36: fav 22 / keep 25 / junk ~94 tags + heavy staging — one
pass logged **"staged 57" which exceeds maxMovesPerRun 20 (suspected cap bug, MUST investigate)**.
Diego had already reported "it messed up a lot of my weapons a few days ago" and asked for a FULL AUDIT,
with his tagging **specs confirmed by him FIRST** before any code changes — his words: VERY IMPORTANT.
State now: **Auto-Manager DISABLED** (`enabled:false`); complete tag/config snapshot saved in
`audit-backup-20260712-074440/`.
**AUDIT DONE (same day).** Diego's verbatim answer: "based on what you told me, it seems like the
specs are correct, we need to make sure that the app is using the same score globally, so whatever
the app uses has to be the same score that I see in the pages of the app / junk staging also works
for armor - btw we need a very similar system to auto tag armor drops - be careful and create a
system that give me as much visibility as the weapons - for the armor, let's start with stagging
before auto tagging, I don't want you messing up what I have already tagged." Findings + fixes are
in HANDOFF ("2026-07-12 audit results"). **Still BLOCKED on Diego: the decision to re-enable** —
the app will NOT flip `enabled` itself (hard rule, in agent memory). The two audit questions were
ANSWERED (Diego, 2026-07-12, verbatim): "1- keep as KEEP and add note as best copy / 2- ok but only
ONE weapon gets tagged as keep automatically, unless I already manually tagged one myself / create a
history system of manual and auto tags that I can go back and check" → all three shipped same day
(last-copy keeps write a "best copy" DIM note; AUTO_FAV_MIN_CRIT=3 gate on watched auto-favorites,
one-keep rule confirmed already implemented; unified tag-history — see HANDOFF).
**NEXT FEATURE (Diego's priority): armor AUTO-TAGGING** — a weapons-grade system (scores, bands,
preview, per-run history/undo, same /auto visibility). Staging for armor is DONE (see HANDOFF);
tagging design must reuse the armor page's verdict engine concepts (niches/set bonuses/exotic
favorite stats) and must NEVER overwrite tags Diego set himself. Design not started — spec it with
Diego first.

**2026-07-12 EVENING (plan-mode session, all SHIPPED — see HANDOFF):** Weapon Watch farm-watching
(unowned weapons watchable end-to-end; 13 hidden Perk Finder farm-saves surfaced/merged), armor
verdict rules (3 ordered exotic favorite stats w/ weighted 3/2/1 sum; Armor 2.0 junk always;
sub-T5 keepers stay keep), and the **BUILD CRAFTER** (`/builds`: subclass builds with official
art, stat priorities + min/max, champion set, explained upgrade suggestions, 60s background
watcher → feed + Builds-tab badge + TRMNL "ARMOR UPGRADE" panel alert, Balanced-Tuning notes,
DIM-loadout import — 90 drafts imported). **Diego must REBOOT (double-click REBOOT.cmd) to load
the server side** — /builds 404s and the farm-watch reconciliation + build watcher don't run
until then. Open follow-ups (small): (a) his 90 imported drafts have watch OFF — he curates
which to finish+save; a bulk-delete-drafts button may be wanted; (b) tier-1 min-gap suggestions
can trade away min-less stats (documented; protect with a min) — revisit if he finds it noisy;
(c) suggestion counts on unfinished goal sets can be large (e.g. 75) — consider capping the
preview list per build.
Also shipped in the second batch: cadence split (`orbitSeconds` 60 / `activitySeconds` 15 /
`idleSeconds` 120 — replaced `activeSeconds`; inputs updated in /auto + /settings; while the game runs
the tick now polls activity even when disabled so the chip shows it), `/api/status` gained
`activity:{safe,hash,mode,name,at}`, the freshness chip moved to a **fixed bottom-right pill** (banner
placement wrapped badly) and now shows the **detected activity name**, and Weapon Watch got the
"needs attention" default sort (most untagged dupes first) + tag-status filter chips + expand/collapse
all + amber "N untagged" header badge.
**RESTART RULE (learned the hard way):** agents must NOT restart the servers from their own shell —
the relaunched PowerShell windows come out VISIBLE in Diego's session and he closes them (which kills
the app). Ask Diego to double-click REBOOT.cmd instead. Server-JS changes from this batch are
committed but **wait for Diego's reboot to go live**; HTML/CSS changes are already live.

## Previous status (2026-07-09 — Auto-Manager scoring FIXED + PVE/PVP tags + Settings page)

Diego's 2026-07-09 batch, all shipped & verified on an isolated 8799 dry-run instance (real Bungie
data, no account writes) + pages loaded in a real browser (0 console errors). Details in HANDOFF
"What works now" (Auto inventory manager + Weapon Watch sections). Summary:

0. **ONE SCORE ONLY (Diego's follow-up, same day): "I never care about the weapon's potential, the
   only score that's important is the actual roll."** The pool-based vault-tile % is gone; every page
   and the Auto-Manager now read the same server-computed per-copy `w.rollScore` (see HANDOFF).
   **ALSO PENDING (asked 2026-07-09, assessment delivered, awaiting Diego's decisions): host this app
   on the ColaAI v3 server (Cybrancee) so it runs 24/7 online instead of on his PC** — needs the
   server-unfriendly parts replaced first (destiny2.exe detection → Bungie-API presence; PC beeps →
   Discord notifications via the ColaAI bot; access protection on the public URL; Linux process
   supervision; a web OAuth re-auth flow). See the chat summary / ask Diego for his answers.
1. **THE BUG — Auto-Manager favoriting low-score weapons — found & fixed.** Diego was right that two
   scoring systems exist (they WERE intentional: vault tile % = pool-based potential, Auto-Manager =
   per-copy roll quality — the pool one has since been removed per item 0) but the REAL error was
   `favRollScore` saturating: a standard 1+1-perk roll
   landing two of his ~94 favorites read 100% ≥ the 90% favorite bar → mass favorites. Now
   grade-normalized: each trait column counts its best favorited perk's ★ weight, 100% = 3★ in BOTH
   columns (1★+1★ = 50%). Dry-run verified: **fav 0** (was dozens), bogus 36-88% "favorites" demoted.
2. **Healing pass:** the 19 wrong app-applied favorites (green, auto-locked by the app itself) are
   re-decided from scratch — demoted to keep/junk and **their app-lock undone**. Diego's own pink
   favorites are never touched. Verified in the dry-run log (favorite→junk / favorite→keep lines).
3. **Defined combos get extra weight:** a roll completing a saved Perk Finder combo (slot1+slot2 in
   different columns) is floored at `thr.comboFloor` (default 80 = kept). Verified live.
4. **PVE/PVP roll auto-tag:** every copy gets `rollTag` — PVP when a pvp-role combo matches the roll,
   else PVE (Diego: "what's not PVP is considered PVE"). Red PVP / teal PVE chips on Weapon Watch
   copies, New Drops cards, Weapon Vault inspect. Verified: 3 PVP copies all genuinely roll his
   "Dynamic Zen" (Dynamic Sway Reduction + Zen Moment) pvp combo.
5. **NEW badge** on fresh drops: Weapon Watch copy rows + Weapon Vault tiles (New Drops already
   implied it). 6. **Perk hover popup added to /drops** (was the one page missing it) — and yes, the
   community insight IS the DIM data (Clarity), already integrated everywhere.
7. **Junk staging latency fixed:** while Destiny runs, passes now ALWAYS run at `activeSeconds`
   (default 30s) — the old adaptive "hold" dropped to 120s exactly when Diego dismantled staged junk.
   `idleSeconds` now only paces the no-op check while the game is closed. Also: `/auto`'s cadence
   inputs were dead (not filled/saved — half-finished commit `c0343ce` from the other machine); wired.
8. **`/settings` — the app-wide Settings page** (in the banner nav on every page): Auto-Manager
   on/off + all thresholds + staging character picker + caps + cadence with plain-language help,
   PVE/PVP combo summary, favorites-by-grade summary (45×1★/19×2★/30×3★ live), god-roll alert rules,
   community-data refresh buttons. `/auto` keeps its (clarified) editor and links here.
9. **Audit fixes:** dry-run passes no longer pollute the shared weapons cache with pretend tags;
   pollDrops + auto passes share one deduped Bungie pull (15s reuse) instead of double-fetching;
   membership resolution cached in fetchActivity (was an extra API call every pass); saving combos
   invalidates the weapons cache so PVE/PVP tags update immediately; removed the accidentally
   committed `give defined combos extra weight.txt` notes file.

**⚠ OPEN — Diego's next actions:**
1. **Double-click `REBOOT.cmd`** on the machine that runs the always-on servers (neither server was
   running on the machine this session worked on — the old buggy code may still be live elsewhere).
   The first live sweep after that will heal the bogus green favorites (capped 25 junk/pass).
2. Open **/settings**, check the thresholds feel right, and pick the stage character if the default
   Warlock isn't wanted.
3. Watch the first live sweep on **/auto** (Preview first if nervous).

**Improvement suggestions (audit follow-ups, NOT started — surface to Diego):**
- Search-result ranking in Weapon Watch (exact-phrase "iron banner" outranking single-word hits) if
  that's what "defined combos extra weight" also meant for search.
- Make the god-roll alert gate (75%/3/4) configurable on /settings.
- Separate PVP thresholds (a pvp-tagged roll could use pvp-lean wishlist data for scoring).
- Armor page could reuse the freshWeapons-style fetch dedup (`fetchArmor` still refetches per call).
- Running the vault server on TWO machines at once would double-manage the account — keep the
  always-on install on one machine only.
- Localisation (pt-BR) spec still queued below.

## Where we are (2026-07-06, later — Auto inventory manager SHIPPED, not yet fired live)

**New feature: automatic inventory manager (`/auto`) — ✅ built & dry-run-verified, ⚠ awaiting Diego's
first LIVE run.** Diego: "the app should behave as an inventory manager and automatically tag weapons
as keep or junk and then move them to a character in-game for dismantling… run this whenever I'm not in
an activity." Full spec + technical facts are in HANDOFF "What works now" (Auto inventory manager). His
4 design decisions (via AskUserQuestion): **go fully live** (real writes, not preview-only) · unwatched
weapons scored by **★ favorites on the actual roll** · **never touch exotics** · watched weapons **junk
below the 75% god-roll bar**. Follow-up asks (2026-07-06, after first build): **(a) per-weapon dedup** — for a
weapon with multiple copies, keep **all favorites** + **exactly one keep** (the single highest ≥80%,
and only if no keep exists yet — never replaces your keep), **never overwrites your manual junk**, junk
the other duplicates; baked-in last-copy guarantee (never removes your last copy). Verified 0 rule
violations in dry-run. **(b) `REBOOT.cmd`** — a
double-clickable one-click restart for both servers (kills node + launchers, relaunches hidden).
**(c) auto vs manual favorites** — `w.autoFav` (app records its own favorites in `auto-applied.json`);
UI paints app favorites **light green**, your own **pink** (theme.css `--fav-auto`/`--fav-man`) on
Weapon Vault / Watch / New-Drops tags; `/auto` has a legend. **(d) nav** — `/auto` "Auto-Manager" tab
added to `banner.js`, which every one of the 8 pages already includes, so all pages have the button.
**(e) junk staging is PER SLOT** — keep 3 junk staged in EACH of Kinetic/Energy/Power (9 total), topped
up per slot (`need = 3 − staged`, never more); verified dry-run filled Power 0→3.
Engine = `autoManage`/`autoDecide`/`favRollScore`/`fetchActivity` in `vault-verdict.js`; UI =
`auto-manager.html`; config = `auto-manage.json` (gitignored); restart = `REBOOT.cmd`.

**Verified live via dry-run (`AUTO_DRYRUN=1`, port 8799 — no account writes):** activity gate correctly
skipped a live pass while Diego was mid-activity while still previewing the plan; tag bands, watched-vs-
favorites scoring, the 25-junk safety cap, and junk-staging no-op (main already had 7 junk) all behaved.

**OPEN — Diego's next actions (surfaced in the wrap-up):**
1. **Double-click `REBOOT.cmd`** to load this code into the always-on servers (agent deliberately did NOT
   restart them, so Diego is present for the first live sweep).
2. Open `/auto`, press **Preview next run** to see the plan (dedup makes this junk-heavy; capped 25/pass —
   big because he has 87 grade-1 favorites). If too aggressive, raise the keep/favorite thresholds, Save,
   Preview again. It's already `enabled:true`, so it goes live on the next in-orbit pass.
3. Confirm the first real sweep in-game (tags land in DIM, 3 junk staged on the Warlock, dismantle them).

**Possible follow-ups (not committed):** expose a **stage-character picker** on `/auto` (today it defaults
to the Warlock main via `LOCK_CTX.characterId`); a per-weapon "exclude from auto" pin; count **rares** as
auto-junk-stage candidates (today legendaries only); a TRMNL panel notification for fresh high-score finds
(today it's a PC chime + the `/auto` log).

## Where we are (2026-07-06 — Weapon Watch copy-table redesign SHIPPED + two data bugs fixed)

**Weapon Watch copy display redesigned — ✅ SHIPPED & verified live.** Diego: "weapon watch / weapon
copies -- we need to redesign this... not organized... not following the organization seen in other
sections." Presented 3 mockups (Smart cards / Organized table / Tile grid+drill-in) as Artifacts;
Diego picked **Direction B (Organized Table)**, then asked for corrections before final approval:
full stat names (no abbreviating), the masterwork badge riding next to its actual stat, a kill
tracker, current→best-possible stat display, and confirmation that ranking always uses the best
achievable stat (barrel/mag swap considered). All built into the mockup, verified via a Node harness
(sort order, MW placement, stat display all checked programmatically against the rendered HTML), then
**ported into the real `weapon-watch.html`** replacing the old cramped `.copy` 3-column grid. Full
details in HANDOFF's "What works now". Mockup scratch files were never committed (scratchpad only) —
gone once the session ends, no cleanup needed.

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
