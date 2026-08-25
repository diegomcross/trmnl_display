# DIEGO_RULES.md — every rule & request Diego has given, in one place

> **Purpose (Diego, 2026-07-17):** "I think you don't have a file where everything I
> requested in the past was kept for your reference." This is that file. Every agent
> MUST read it before changing scoring, tagging, or UI behavior, and MUST add new
> Diego rulings here the moment he states them (with date + verbatim quote when
> available). Recovered 2026-07-17 from: code comments, docs/HANDOFF.md,
> docs/NEXT_PHASE.md, git history, and agent memory. Anything Diego said that was
> never written into one of those places is lost — if a rule seems missing, ASK HIM
> and record the answer here.

## 1. How to work with Diego (process)

- Diego is a **non-programmer**. Claude writes/tests/pushes all code; Diego runs
  commands locally and handles browser/game/device. Plain steps, working code.
- **Never remove or regress an existing feature without explicit authorization.**
  If a feature went missing, restoring it is the top priority. (CLAUDE.md)
- **Test before push** — real server, real endpoints, real browser, live Bungie API.
- **Never restart Diego's servers from the agent shell** — relaunched windows come
  out visible and he closes them, killing the app (2026-07-12 incident). Ask him to
  double-click `REBOOT.cmd`; HTML/CSS needs no restart, server-JS does.
- **Never (re-)enable the Auto-Manager without Diego's explicit go** (2026-07-12:
  agent re-enabled it mid-game → mass-retag incident, ~94 junk tags + 57 stages).
  It stays `enabled:false` until he says otherwise.
- Keep `docs/HANDOFF.md` + `docs/NEXT_PHASE.md` current every session; and keep
  THIS file current whenever Diego states a rule.

## 2. Scoring (weapons)

- **ONE SCORE — the actual roll** (2026-07-09, verbatim): *"I never care about the
  weapon's potential, the only score that's important is the actual roll."* The
  pool-based potential % is dead; every page and the Auto-Manager must show the
  same per-copy number (`w.rollScore`, computed once in `fetchWeapons`).
- **Unwatched weapons** score by ★-favorite coverage, **grade-normalized**
  (2026-07-09 "mass fake favorites" fix): each trait column contributes its best
  favorited perk's weight (1★=1 · 2★=1.5 · 3★=2), ÷ 4. 100% needs 3★ in BOTH columns.
- **Tracked-perk union** (2026-07-16, verbatim): *"app is not considering the
  tracked perks to score unwatched weapons"* → every perk tracked on ANY watched
  weapon counts as ≥2★ when scoring unwatched weapons (capped at 2★ so tracking
  alone can never mass-keep/favorite).
- **Best-of-both for watched weapons** (2026-07-16, Diego picked it): a watched
  copy scores max(tracked-perk match %, ★-favorite score). Guardrail: auto-favorite
  still requires the RAW tracked match ≥ fav bar.
- **God-roll bar** (Diego's chosen numbers): 75% match, ≥3 criteria matched, ≥4
  selected (`GOD_MIN_PCT/MATCHES/SELECTED`).
- **Auto-favorite gate** (2026-07-12 OK'd): watched weapons need ≥3 tracked
  criteria before the app may auto-favorite.
- **Combo floor:** a roll completing a saved Perk Finder combo never scores below
  `thr.comboFloor` (default 80 — kept, never auto-favorited on the combo alone).
- **PVE/PVP:** (2026-07-09, verbatim) *"what's not PVP is considered PVE."*
- Thresholds (defaults Diego runs): unwatchedJunk 60 · watchedJunk 75 · keep 80 ·
  fav 90 · comboFloor 80.

## 3. Auto-Manager (tagging & staging)

- **Legendaries only** — exotics never touched (2026-07-06).
- **Per weapon: keep ALL favorites + exactly ONE keep** (highest ≥80, only if no
  keep exists); junk the other duplicates. Never replace an existing keep; never
  re-tag Diego's manual junk; never junk a keep/favorite; never touch
  locked/equipped/postmaster copies (2026-07-06).
- **Last-copy guarantee:** the app never removes a weapon's last copy; forced
  last-copy keeps get a DIM note **"best copy"** (2026-07-12, Diego's audit answer
  #1 verbatim: "keep as KEEP and add note as best copy").
- **Manual favorites are sacred (pink); app favorites are green** and re-earn their
  tag every pass.
- **Junk staging:** stage 5 junk weapons per slot (Kinetic/Energy/Power) on a
  character for manual dismantling (2026-07-12: 5, not 3). **Armor is staged too
  but NEVER auto-tagged** (2026-07-12: staging only).
- Safety caps: ≤25 junk tags/run, ≤20 moves/run. A history of every tag change
  (manual/auto/dim/revert) must exist — (2026-07-12 verbatim): *"create a history
  system of manual and auto tags that I can go back and check."*
  `POST /api/auto/revert {at}` undoes a run.
- **Cadence** (2026-07-12 "save API calls"): 60s safe/orbit · 15s in-activity
  (to catch it ending) · 120s game closed. Diego wants to SEE detection working —
  activity name in the banner chip.

## 4. Armor (2026-07-12 rules — commit a6320bd)

> **`docs/ARMOR_ENGINE_VISION.md` is the loyal, verbatim-only record of everything Diego
> has stated the armor-vault/build-crafting engine to be** — his words, in order, with
> zero interpretation mixed in (created 2026-07-26 at his ask, after he felt the
> interpretive summaries below were drifting from what he actually said). Read that file
> first for the raw vision; the bullets below are this file's usual interpreted-summary
> style layered on top of it.

- **3 ordered exotic favorite stats** per exotic, weighted 3/2/1 sum, math shown on
  the card.
- **Armor 2.0 legacy = junk always.**
- **Sub-T5 keepers stay keep** — info note only, never downgraded.
- **Armor is never AUTO-tagged** — no timer, no Auto-Manager pass, nothing background ever writes
  an armor tag or lock. (2026-08-15 Diego added a **manual** Apply button to the declutter preview
  that does write tags + lock state on his explicit press — see §4b rule 8. "Never automatic"
  survives; "never written at all" does not.)
- Armor auto-tagging is the next wanted feature but **must be specced with Diego
  first** (NEXT_PHASE).

- **CORE PURPOSE RE-STATED (2026-07-25, verbatim — the current niche-based engine
  does NOT match this and needs redesign):** *"there's nothing taking into
  consideration maximizing stats for build crafting and in my specs originally,
  this was a great influence, the main purpose of the tool. It consider the
  exotic armors, then tries to maximize stats with the set bonuses while trying
  to keep a minimum of pieces in the vault. So for TechSec armor set, it would
  try to keep the minimum number of pieces that gives max stats for the exotic
  armor pieces. It would try to do the same with other set bonuses."* Reading:
  builds are **anchored on exotics** (one per class, one slot each); for every
  slot an exotic doesn't fill, the tool should pick the **legendary in a given
  set that maximizes the exotic's favorite stat(s)** (reusing the existing
  favorite-stat weighting), while also completing that set's bonus — and the
  vault should keep the **minimum piece count** that covers every viable
  exotic/set pairing, not one piece per every distinct archetype×tertiary
  **niche** regardless of whether that niche is useful for any real build. This
  is the gap: today's engine's tertiary-stat split makes almost every piece its
  own unique niche, so **nothing meaningfully gets junked within a set** — see
  NEXT_PHASE for the real TechSec/Warlock proof (13 pieces kept across 4 slots,
  zero junked, including a Tier-3 piece nothing ever compared it against).
  Model **not yet confirmed built** — spec in progress, see NEXT_PHASE.
- **Sets don't compete (2026-07-25, verbatim, correcting my first attempt):** *"We're not
  decided who's the winner based on set bonus higher stats. Each set bonus is different in
  build crafting. If I say maximize stats, it means that for every exotic, you have to
  keep the best armor pieces in all sets chosen that maximize stats."* For a given exotic,
  every set Diego has RATED (4pc or 2pc — his answer to "which sets": *"those that I have
  rated"*) is evaluated **independently** and keeps its own single best piece per open
  slot; sets are never ranked against each other to pick one "winner." Full final model
  in NEXT_PHASE.md — this is the corrected, current spec, supersedes any earlier draft.
- **Set selection lives on the BUILD, not a separate rating panel (2026-07-26, verbatim):**
  *"Once the builds are created and set bonuses are selected, the app curates the best
  armor pieces to keep in the vault taking into consideration max stats for builds that
  use the same set bonus while trying to maintain unecessary armor in the vault. It's an
  optimization tool to keep the good builds while maintaining the vault decluttered."*
  This refines rule 4's "sets Diego has rated" data source: the input is now the set(s)
  picked directly on each exotic's build(s) in `/builds` (multi-select, shipped
  2026-07-26 — see HANDOFF), not the separate `vv-ratings` panel in Vault Verdict (that
  panel is client-side/per-browser only anyway, never reached the server). The vault
  declutter/keep-junk engine itself (compute() in vault-verdict.js) is **not yet wired to
  this** — still a read-only preview to build next, per the hard rule below.
- **Multi-set UI behavior (2026-07-26, AskUserQuestion, Diego picked):** "Show all as
  separate options, no auto-pick" — when a build has several sets selected, compute and
  display a champion set + suggestions for EACH one side by side; never auto-pick a
  "winner" set for the build. Matches rule 4's "sets don't compete."
- **Never wire a big armor-vault behavior change live without a preview** (CLAUDE.md hard
  rule, reaffirmed here because armor junk/keep changes are high-blast-radius): the
  build-driven declutter engine must be shown to Diego and confirmed before any real
  junk-tagging goes live.

### 4b. Armor declutter engine — the five 2026-08-15 rulings (`docs/ARMOR_DECLUTTER_SPEC.md`)

Diego wrote `docs/ARMOR_DECLUTTER_SPEC.md` himself on 2026-08-15. **That spec supersedes
NEXT_PHASE's FINAL MODEL wherever they disagree.** The five rulings it adds:

1. **Stat floor — builds stop at "good enough", not "maximum"** (verbatim): *"150 is a good
   start, but add an option to adjust that."* A duplicate piece must move a build toward its
   floor to earn a vault slot; once a build's `minDeficit` hits 0, stop adding pieces for it.
2. **Not a global optimization** (verbatim): *"the app should look in the vault and make
   decisions based on what exists in the vault and user choices, not a global decision."*
   The solve runs **per class, per exotic**, incrementally — never one global solve.
3. **Exotics are triage targets too** (verbatim): *"if we don't have an exotic piece with the
   best stats, I'll keep farming for a better one. App should guide for that."* The engine
   owes him a farming report, and chasing an unreachable floor must never keep extra pieces.
4. **Suggestions, never auto-applied.** When solving a new exotic reveals a better arrangement
   for an already-solved one, it surfaces as a dismissible `rearrange` alert in the existing
   builds-alerts feed — the app never rewrites his keeps by itself.
5. **Floor storage** (verbatim): *"Global default in Settings + per-exotic override on the
   exotic's card."* → `thr.statFloor` (default 150) in `auto-manage.json`, plus a per-exotic
   `floor` in `exotics.json` (null = inherit the global).

Also standing and unchanged from 2026-07-25/26: sets never compete · every set selected on a
build is solved independently · `watch:true` builds only · a 4pc bonus must be filled by 4 real
same-set pieces · the niche engine is **replaced**, not layered.

Two more the same day, while the preview was being built:

6. **Favorite exotics, max 7** (verbatim): *"there should actually be an option to tag certain
   exotics as favorites, so they are prioritized. Up to 7 exotics."* Stored as `fav:true` in
   `exotics.json`, hard-capped at 7 on both client and server.
   **What "prioritized" means — asked directly, answered verbatim:** *"favorites are set at the
   floor, the other exotics just help decision with uneeded dupes."* So: only ★ favorites run the
   floor-aimed solve and decide which **legendaries** are kept. A non-favorite tuned exotic still
   keeps its own best copy and junks its weaker duplicates — that's its whole job — but protects
   no legendaries. **Safety default:** with nothing starred, every tuned exotic drives keeps, so a
   fresh install can never junk the vault. A class with no ★ favorite is out of scope entirely.
7. **Don't print the per-exotic armor combinations** (verbatim): *"also no need to show per exotic
   armor combinations, this is long in the page an unnecessary"* — the preview's Keeps section is a
   flat list of the pieces to keep, NOT an exotic → set → slot tree. The tree was thousands of rows.
8. **⚠ REVERSES A HARD RULE — the engine should ACT on its verdicts** (2026-08-15, verbatim):
   *"keep should be locked in-game, junk should get item unlocked for dismantelling in-game"* and
   *"it should also sync with DIM"*. This directly contradicts §4's standing **"Armor is NEVER
   auto-tagged — verdicts and junk-staging only"** and his OWN spec's §7 ("This ships as a
   read-only preview and does not touch DIM tags until Diego explicitly says so"). Read: he is now
   explicitly saying so. **BUT** — this must never become automatic. The 2026-07-12 mass-retag
   incident is why armor writes were banned in the first place, and *unlocking* armor is the one
   action that makes accidental in-game dismantling possible. **Asked directly, Diego chose
   "Full apply: lock keeps + unlock junk" behind one confirm, and "Full undo, like the weapons
   Auto-Manager."** Shipped that way (see HANDOFF). Standing constraints that did NOT change:
   it is **never automatic** (only the Apply button, after a dry-run diff and a confirm), the
   **Auto-Manager stays `enabled:false`**, and equipped pieces / his own `favorite` tags /
   `review` / out-of-scope pieces are never touched.


### 4c. The Armor 2.0 rule does NOT junk irreplaceable exotics (2026-08-25)

9. **"Armor 2.0 legacy — junk always" (2026-07-12) applies to LEGENDARIES.** Diego reported the
   declutter junking armor he needed. Cause: that rule ran as a blanket pre-pass on every item.
   He owns **zero** Armor 2.0 legendaries, so it fired on nothing but exotics — 54 of them,
   including 5 of his 7 ★ favourites and 13 pieces that were his ONLY copy of that exotic
   (Speaker’s Sight, Cenotaph Mask, Eye of Another World, Karnstein Armlets, Aeon Swift,
   Gwisin Vest, Mask of Bakris, Oathkeeper, Radiant Dance Machines, The Dragon’s Shadow).
   That is the exact opposite of ruling 3 (exotics are farming targets).

   **Asked how the rule should apply to exotics, Diego chose:** *"Junk a 2.0 exotic only if you
   own a 3.0 copy — the rule keeps working, but a 2.0 exotic survives until a 3.0 version of
   that same exotic exists in your vault."*

   Implemented in `armorDeclutter()`’s pre-pass (`vault-verdict.js` ~1750): a legendary with
   `t === 0` is still junked verbatim by the 2026-07-12 rule; an **exotic** with `t === 0` is
   junked only when `modernExotic` holds a `cls|name` match with `t > 0`. With no 3.0 copy it
   stays in scope and the normal exotic pass judges it — so a second 2.0 copy can still be
   junked as a duplicate, which is fine: he keeps one.
## 5. Perk lists & Perk Finder

- **No exotic perks / frames / non-trait plugs in perk lists** (2026-07-04 commit
  "drop exotic perks"; library keeps only manifest `pc==='frames'` trait plugs;
  **re-affirmed 2026-07-17** when the Rate-ungraded list wrongly included them —
  verbatim: "erroneously you included exotic perks and weapon frames and other
  unnecessary perks to the list, heavily inflating it").
- **Never drop info** in perk descriptions (2026-07-05): every per-stack %, PvP
  split, enhanced bonus kept; numbers verbatim.
- **Most popular perk first, everywhere perks are listed** (2026-07-05), with the
  recency-bias fix (2026-07-05, verbatim: "the older perks are very inflated
  compared to the newer ones").
- **Combo model = TWO SLOTS, column-aware** (2026-07-04 correction): a combo hits
  when a Slot-1 and Slot-2 perk land in DIFFERENT trait columns.
- 3-star favorite grading lives in Perk Finder and feeds the vault score.

## 6. UI / look & feel

- **BrayTech look everywhere** (2026-07-04 vision): shared `theme.css`, in-game
  nameplate banner on every page, self-hosted Arimo font.
- Weapon Vault: single-guardian BrayTech layout; equipped tile **1.7×** (Diego's
  confirmed proportion); character inventory 3×3 grid.
- Weapon Watch copies = **organized table** (2026-07-06, Diego picked Mockup B —
  "it's small, not organized" complaint).
- Cards must not move mid-tap (2026-07-05: hover-delay fix after "the card moved").
- Tag colors: Diego's manual favorites pink, app favorites green.
- Build Crafter: "take your time making this look good" (2026-07-13).

## 7. Sharing the app (2026-07-17)

- Diego's friend gets his OWN copy on his OWN PC — no hosted multi-user version.
  (Diego's clarified ask: "the app is hosted on his pc, just like mine".)
- The friend must never need the terminal or hand-edit `.env`: the `/setup`
  wizard collects everything. Diego shares `.env` + `.dim-app.json` privately
  (app identity only); each person logs in with their own Bungie account.
- **Passwords are NEVER typed into the app** — login happens on bungie.net
  itself (OAuth). This is both the design and a hard line.

## 8. Wanted / open (see NEXT_PHASE.md for detail)

- **Armor auto-tagging** — top wanted feature, BLOCKED: spec with Diego first.
- **Director/featured-activity weapon tracking** (2026-07-06) — BLOCKED: research +
  Diego's confirmation.
- **Localisation pt-BR** (2026-07-05 spec): everything API-derived pulled per-locale.
- **Hosting the app off-PC** (2026-07-09) — assessment delivered, awaiting decisions.
- Scoring options Diego did NOT pick on 2026-07-16 (re-offer if junking worries
  return): replaceability guard (never auto-junk raid/Trials/adept copies);
  gentler dupe rule (60–79% dupes left untagged).
- 2026-07-16 picker: Diego ticked "Something else" with no text — still unanswered.
