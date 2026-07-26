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
