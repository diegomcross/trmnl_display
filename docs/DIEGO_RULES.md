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

- **3 ordered exotic favorite stats** per exotic, weighted 3/2/1 sum, math shown on
  the card.
- **Armor 2.0 legacy = junk always.**
- **Sub-T5 keepers stay keep** — info note only, never downgraded.
- **Armor is NEVER auto-tagged** — verdicts and junk-staging only.
- Armor auto-tagging is the next wanted feature but **must be specced with Diego
  first** (NEXT_PHASE).

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
