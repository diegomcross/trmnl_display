# ARMOR_ENGINE_VISION.md — Diego's own words, verbatim, nothing else

> Purpose: a loyal record of everything Diego has stated this system (the armor
> vault / build-crafting declutter engine) to be — **his words only, in order,
> with no interpretation, paraphrase, or "reading" mixed in.** If it's not a
> direct quote from Diego, it isn't in this file. When he adds to or corrects
> the vision, append the new quote below the last one — never edit or summarize
> a past quote away. Interpretation, design notes, and implementation status
> belong in `docs/DIEGO_RULES.md` / `docs/NEXT_PHASE.md`, not here.

---

**2026-07-25**

> "there's nothing taking into consideration maximizing stats for build crafting
> and in my specs originally, this was a great influence, the main purpose of
> the tool. It consider the exotic armors, then tries to maximize stats with
> the set bonuses while trying to keep a minimum of pieces in the vault. So for
> TechSec armor set, it would try to keep the minimum number of pieces that
> gives max stats for the exotic armor pieces. It would try to do the same with
> other set bonuses."

---

**2026-07-25** — answering "which exotics count, and what happens with 4-piece sets":

> "if an exotic matches the tracked stats for that exotic, than use that
> exotic. Consider the exotics currently in the vault until a better one drops.
> For bonuses that 4-pieces were selected, you have to consider builds with 4
> pieces for that set bonus"

---

**2026-07-25** — answering "should this replace the old engine, or layer on top of it":

> "Replace entirely."

---

**2026-07-25** — answering "what should 'maximize stats' be measured against":

> "Full Build Crafter stat priorities."

---

**2026-07-25** — correcting a first attempt that had sets competing against each other:

> "We're not decided who's the winner based on set bonus higher stats. Each set
> bonus is different in build crafting... for every exotic, you have to keep
> the best armor pieces in all sets chosen that maximize stats."

---

**2026-07-25** — answering "which sets count as 'chosen'":

> "those that I have rated"

---

**2026-07-25** — answering "which of an exotic's multiple saved builds should count":

> "only builds with `watch:true` count"

---

**2026-07-26**

> "it's not clear how to use /builds - it doesn't accept me to select 2 or 4
> pieces armor sets. It should let me select as many armor set as I wanted,
> this is important. What does 'watch drop' mean? There's no tooltip to
> explain. The sliders should have min max in the same slider and have the
> in-game stat symbols. Many symbols inside /builds are misaligned and look
> sloppy."

---

**2026-07-26**

> "I think you still haven't understood me. Once the builds are created and
> set bonuses are selected, the app curates the best armor pieces to keep in
> the vault taking into consideration max stats for builds that use the same
> set bonus while trying to maintain unecessary armor in the vault. It's an
> optimization tool to keep the good builds while maintaining the vault
> decluttered."

---

**2026-07-26** — asked directly, via a multiple-choice question, how the app should behave
when a build has several sets selected (his pick, not a free-text quote):

> "Show all as separate options, no auto-pick"

---

**2026-08-15** — on how high a build should aim (the stat floor):

> "150 is a good start, but add an option to adjust that."

---

**2026-08-15** — on what the engine is deciding over:

> "the app should look in the vault and make decisions based on what exists in
> the vault and user choices, not a global decision."

---

**2026-08-15** — on exotics themselves being part of the triage:

> "if we don't have an exotic piece with the best stats, I'll keep farming for a
> better one. App should guide for that."

---

**2026-08-15** — on what happens when a newly-solved exotic reveals a better
arrangement for an already-solved one (recorded from the spec he wrote; stated as
a ruling, surfaced as a dismissible suggestion, never auto-applied):

> "Suggestions, never auto-apply."

---

**2026-08-15** — on where the stat floor is stored:

> "Global default in Settings + per-exotic override on the exotic's card."

---

**2026-08-15** — on favorite exotics:

> "there should actually be an option to tag certain exotics as favorites, so they
> are prioritized. Up to 7 exotics."

---

**2026-08-15** — on the declutter preview's layout:

> "also no need to show per exotic armor combinations, this is long in the page an
> unnecessary"

---

**2026-08-15** — asked what "prioritized" should mean for favorite exotics: solve order only,
only the 7 favorites driving keeps, or a middle option:

> "favorites are set at the floor, the other exotics just help decision with uneeded
> dupes"

---

**2026-08-15** — on the engine acting on its verdicts:

> "keep should be locked in-game, junk should get item unlocked for dismantelling
> in-game"

---

**2026-08-15**, immediately after:

> "it should also sync with DIM"

---

**2026-08-25** — reported that the declutter was junking armor he needed. Investigation showed
the 2026-07-12 "Armor 2.0 legacy — junk always" rule now fires on nothing but exotics (he owns
zero Armor 2.0 legendaries), condemning 54 exotics including 5 of his 7 ★ favourites and 13
pieces that were his only copy of that exotic. Asked how the rule should apply to exotics, he
chose:

> "Junk a 2.0 exotic only if you own a 3.0 copy"

> "The rule keeps working, but a 2.0 exotic survives until a 3.0 version of that same exotic
> exists in your vault. Would junk 41 of the 54 and protect the 13 you'd otherwise stop owning,
> Speaker's Sight included."

---

**2026-08-27** — describing the whole model, after being asked whether the engine matched it:

> "all armor set bonuses that I picked have to exist as a whole set along with the exotic (not
> only the 7 starred ones, but mainly them)"

> "the app will simulate the highest stats (according to what I selected) and make a build if Dawn
> Chorus (helmet) using 4 pieces of the Bushido set (gaunlets, chest, boots, class item), it then
> selected 4 pieces."

> "it will try to use the pieces that are already used in other builds, but higher stats overrides
> that."

> "for the exotics that have not been starred, it’ll try to maximize using the armor pieces that
> are already kept based on the starred ones, and if there’s another legendary piece that can make
> a better build it may select, but that’s not priority, only if it’s much better benefit."

> "this way we will be able to declutter the vault without sacrificing build varieties."

**2026-08-27**, asked how much better a new piece must be for a non-starred exotic:

> "for non starred exotics the floor is between 100-120 for the desired stats"
---

**2026-08-29** — on the declutter UI and the shared banner:

> "There’s no apply button. Did you check the website? The banners are still all different sizes."

---

**2026-08-29** — on DIM:

> "sync with dim not working appearantly, double check and fix"

---

**2026-08-29** — on how the agent should work:

> "YOU SHOULD ALWAYS USE THE LOCAL COPY IN MY COMPUTER TO MAKE CHANGES SO EVERYTHING IS ALWAYS
> UPTODATE AND YOU CONTROL REBOOTS AS WELL, NO INTERVENTION FROM ME NEEDED"
