# ARMOR_DECLUTTER_SPEC.md — build-driven armor keep/junk engine

> **For the agent picking this up:** read `docs/ARMOR_ENGINE_VISION.md` and
> `docs/DIEGO_RULES.md` §4 first. This spec implements the FINAL MODEL already
> recorded in `docs/NEXT_PHASE.md` (2026-07-25), **plus five new rulings Diego gave
> on 2026-08-15** that change the model. Where this file and NEXT_PHASE disagree,
> this file wins — but append the new quotes to ARMOR_ENGINE_VISION.md before you
> start, per that file's own rule.

---

## 0. New Diego rulings (2026-08-15) — append these to ARMOR_ENGINE_VISION.md

1. **Stat floor.** *"150 is a good start, but add an option to adjust that."*
   Builds stop at "good enough," not "maximum." A duplicate piece must move a build
   toward its floor to earn a vault slot.
2. **Not a global optimization.** *"the app should look in the vault and make
   decisions based on what exists in the vault and user choices, not a global
   decision."* Per-exotic, incremental, driven by his selections.
3. **Exotics are triage targets too.** *"if we don't have an exotic piece with the
   best stats, I'll keep farming for a better one. App should guide for that."*
4. **Suggestions, never auto-apply.** When a newly-solved exotic reveals a better
   arrangement for an already-solved one, surface it as a dismissible suggestion.
5. **Floor storage.** Global default in Settings + per-exotic override on the
   exotic's card.

Also standing from 2026-07-25/26 and unchanged: sets never compete; every set
selected on a build is solved independently; `watch:true` builds only; a 4pc bonus
must be filled by 4 real same-set pieces; the niche engine is **replaced**, not
layered.

---

## 1. What is actually wrong today

Two engines exist and they don't talk.

| | file | what it does | problem |
|---|---|---|---|
| **A** | `compute()` — `vault-verdict.html:224` | assigns keep/junk | groups by niche key `L\|cls\|slot\|arch\|ter\|sb`. Every archetype×tertiary combo is its own group; a group of one is always a keep, so nothing inside a set is ever compared. Proven: Warlock Techsec = 13 kept / 0 junked, incl. a T3 boot next to a strictly better T5 boot. |
| **B** | `championSet()` — `vault-verdict.js:1533` | solves a build: exotic anchor + best legendary per open slot, honouring `want:2` / `want:4` | correct, working, and its output only ever feeds the suggestions feed. It never produces a verdict. |

**The whole job is: make verdicts come from B, and delete the niche key from A.**

---

## 2. Data model changes

### 2.1 Move exotic tuning server-side (prerequisite)

`exoFavs` currently lives in `vv-exofavs` via `loadStore/saveStore`
(`vault-verdict.html:180-190`) — browser-only, same trap that made `vv-ratings`
useless server-side (DIEGO_RULES §4). The engine now runs beside `championSet()` on
the server, so it needs the data.

Create `exotics.json` + `GET/POST /api/exotics`:

```js
{ v:1, exotics: { "Getaway Artist": { favs:["g","w"], floor:null } } }
// favs: ordered stat keys, max 3 (unchanged 3/2/1 semantics)
// floor: null = inherit global default; number = per-exotic override (ruling 5)
```

Migrate once on first load: if `exotics.json` is absent and `vv-exofavs` has data,
POST it up from the client, then read server-side from then on. Keep the existing
exotics panel UI; only its persistence target changes.

### 2.2 Global floor default

Add to `AUTO_DEFAULTS.thr` (`vault-verdict.js:1696`): `statFloor: 150`. Surfaces in
`settings.html` next to the existing threshold controls, saved through the existing
`POST /api/auto`. Per-exotic override is a small number box on the exotic card,
placeholder = the global value.

### 2.3 Keep-set persistence

`armor-keeps.json` — the sticky decision record, so the engine is incremental
(ruling 2) rather than recomputing everything from scratch each pass:

```js
{ v:1, at:0, keeps: { "<instanceId>": { for:[{exotic,set,slot}], pinned:false } },
  dismissed: ["<suggestionKey>"] }
```

---

## 3. The algorithm

Run per class, per exotic. **Never a single global solve.**

**Step 1 — exotic scope.** Every owned exotic that has `favs` set. If several copies
of the same exotic exist, the best copy by the existing `favScoreOf` 3/2/1 weighting
is the working copy; the others are junk candidates (unchanged behaviour).

**Step 2 — stat target for that exotic.**
- Has a `watch:true` build → use the build's real `prio` / `min` / `max`.
- No watched build → fall back to the exotic's `favs`, and synthesise
  `min[fav1] = min[fav2] = floor` where `floor` = per-exotic override ?? global
  default. This is what makes the floor meaningful for the ~36 exotics with no
  watched build.

**Step 3 — candidate sets.** The sets selected on that exotic's watched build(s)
(`setBonus`, already an array of `{name, want:2|4}`). No watched build → the sets
Diego rated 4pc/2pc. Each set is solved **independently and in parallel** — sets
never compete, all qualifying sets' picks survive.

**Step 4 — solve.** Call the existing `championSet(build, items, sb)` unchanged. It
already anchors the exotic, fills open slots, and enforces the 2pc/4pc rule.

**Step 5 — reuse bias (NEW — this is the only genuinely new logic).**
Carry a `kept` Set of instance IDs across exotics within the pass. Inside
`championSet`'s `bestIn()` (line ~1539), sort by `pieceScoreB` as now, but when the
build's `minDeficit` is already **0** with either candidate, prefer the one already
in `kept`. Reuse is a tiebreak, never a reason to fall short of the floor.

Solve order: exotics whose priority stats have the fewest qualifying pieces first
(hardest first), then already-solved exotics keep their picks.

**Step 6 — verdicts.** Union of every set's picks across every exotic = **keep**.
Everything else in a rated/selected set = **junk candidate**, subject to the existing
safety nets: manual favorite → review, in a DIM loadout → review, never last copy.
Legendaries in Ignore/Undecided sets keep today's fallback rules.

**Step 7 — floor stop rule.** Once a build reaches `minDeficit === 0`, stop adding
pieces for it. A piece that only raises an already-satisfied stat does not earn a
vault slot.

---

## 4. Farming report (ruling 3)

Two sources already exist and are currently thrown away.

- `championSet()` returns `setGaps` and `exoticMissing` — nothing consumes them.
  These are literally "you can't complete this build with what you own."
- Per-exotic: compare the working copy's archetype/tertiary against the exotic's
  `favs`. Report the shortfall in plain terms — *"Getaway Artist: Grenadier primary
  ✓, tertiary is Class, you want Weapons — keep farming."*

Output a per-exotic list: reached floor ✓ / best achievable = N (short by X) / which
slot is the weak link. This doubles as his farming list, and it must **never** cause
extra pieces to be kept chasing an unreachable floor.

---

## 5. Suggestions (ruling 4) — reuse the existing feed, build nothing new

`buildAlertEntry()` (`vault-verdict.js:1608`), `builds-alerts.json`,
`builds-seen.json` (dedupe) and `POST /api/builds/alerts/ack` are already a complete
read/dismiss suggestion feed. Add one alert kind: `rearrange`.

Fires when solving exotic N produces a strictly better arrangement for
already-solved exotic M. The entry must state: pieces freed, pieces newly required,
and each affected build's stats before → after. Accepting rewrites `armor-keeps.json`;
dismissing writes the suggestion key to `dismissed` so it never fires again.

---

## 6. UI

Read-only preview panel in `vault-verdict.html` (that's where verdicts already
live). Three sections:

1. **Keeps** — grouped by exotic → set → slot, each with its one-line reason.
2. **Junk candidates** — with the piece that beat them and by how much.
3. **Farming gaps** — §4 output.

Every row shows the math, matching the existing `favMath` style.

---

## 7. Hard rules — do not violate

- **Armor is NEVER auto-tagged.** Verdicts + junk staging only. This ships as a
  read-only preview and does not touch DIM tags until Diego explicitly says so.
- **Never enable the Auto-Manager.** It stays `enabled:false` (2026-07-12 mass-retag
  incident).
- **SUPERSEDED 2026-08-29 (DIEGO_RULES §4g rule 22):** this said to ask Diego to double-click
  `REBOOT.cmd`. He now wants the agent to edit his local copy and run the reboots itself, with no
  intervention from him. Server-JS: reboot and verify the ports yourself. HTML/CSS: no restart.
- **Never remove an existing feature** without explicit authorization.
- Test against the live API and a real browser before pushing.
- Update `DIEGO_RULES.md`, `NEXT_PHASE.md`, `HANDOFF.md`, and
  `ARMOR_ENGINE_VISION.md` in the same session.

---

## 8. Known data problem (not a code fix)

`builds.json` holds 92 builds; only 2 have `watch:true`, and both are duplicate
Winter's Guile entries. So 36 of 37 tuned exotics will run on the §3 Step-2 fallback.
The fallback is now genuinely usable because the floor gives it a real target — but
Diego gets the full "Full Build Crafter stat priorities" behaviour only for exotics
he marks watched in `/builds`. Surface this as a count in the preview header
("1 of 37 exotics using a watched build") rather than a blocking warning.

---

## 9. Build order

1. `exotics.json` + `/api/exotics` + client migration (§2.1) — nothing works without it.
2. Global floor in `thr` + per-exotic override box (§2.2).
3. Solver pass reusing `championSet` unchanged, no reuse bias yet (§3 steps 1-4, 6, 7).
4. Preview panel (§6) — **stop here and show Diego** before going further.
5. Reuse bias + `armor-keeps.json` stickiness (§3 step 5, §2.3).
6. Farming report (§4).
7. `rearrange` alert kind (§5).
8. Delete the niche key from `compute()` — last, once the replacement is proven.
