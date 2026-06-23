# TRMNL Destiny 2 Dashboard — Handoff Spec & Continuation Guide

**For the next agent.** This document is self-contained: you can pick up the project
from here without the prior conversation. Read sections 0–6 before writing any code.

Last updated: 2026-06-23. Author: previous Claude session (handoff requested by Diego).

---

## 0. TL;DR — where we are

A self-hosted e-ink dashboard that shows Diego's **Destiny 2 "Orders"** (the Portal's
daily directives) plus secondary progress, on a TRMNL 7.5" 1-bit display.

- **Auth + data fetch: DONE and working.** `auth-and-snapshot.js` produces `snapshot.json`.
- **The big blocker is SOLVED:** we found where Orders live in the Bungie API
  (inventory bucket **635141261**, see §3). Do **not** re-investigate this.
- **`render.js`: working**, just rewritten to read Orders from the correct bucket. It
  produces `screen.png` and prints a report.
- **Not built yet:** (a) render refinements Diego asked for this session (§5),
  (b) the always-on BYOS server `server.js`, (c) pointing the device at the PC,
  (d) a PC-browser config UI (§5.4, later).

**Your immediate job:** implement §5.1–§5.3 (rarity indicator, order description,
trim the screen), confirm with Diego, then build `server.js` (§7).

---

## 1. Goal & architecture

A 7.5" TRMNL OG DIY e-ink panel (Seeed XIAO ESP32-S3, **800×480, 1-bit monochrome**)
shows Diego's current Destiny 2 Orders and refreshes roughly every 60s. It is fully
self-hosted (BYOS = "bring your own server"):

```
Bungie API ──(HTTPS)──> Node server on Diego's Windows PC ──> 800x480 1-bit image
                                                                      │
                          TRMNL device (BYOS, custom server) <────────┘  (polls every ~60s)
```

- The Node server fetches the profile, resolves hashes→names via the **public Manifest**
  (API-key only), and renders the image.
- The e-ink panel holds the last image when the PC is off (e-ink is persistent).
- Diego is a **Warlock main**; the display defaults to the Warlock character.

**Hard constraint:** the agent's sandbox/container **cannot reach `bungie.net`** (only
github/npm/pypi domains are allowlisted). **All Bungie/Manifest calls run on Diego's PC.**
You write code; Diego runs it and reports output. Plan around this — never assume you can
hit the Bungie API yourself from the container.

---

## 2. Facts: repo, paths, auth

- **Repo (all code lives here):** `diegomcross/trmnl_display`, branch `main`, **private**.
- **Local clone (Windows):** `C:\Users\diego\Desktop\cola_ai_v3\trmnl_display`
- **Bungie app:** confidential client, `client_id=49944`,
  redirect `https://127.0.0.1:8443/callback`, scope `ReadDestinyInventoryAndVault`.
  API key + secret live in Diego's local `.env` (gitignored). OAuth works; `tokens.json`
  refreshes. **Never commit `.env`, `tokens.json`, or `snapshot.json`.**
- **Account:** "Aquarius", membershipType **3** (Steam), membershipId
  `4611686018530139303`, 3 characters. **Warlock** characterId `2305843010375154553`
  (classType 2).

**GitHub MCP workflow (important):**
- Always fetch the current file SHA via `get_file_contents` **before** updating a file.
- Verify every file after multi-file pushes; files >40 KB may truncate.
- Diego's collaboration style: **you write and push all code; Diego runs commands locally
  and pastes back results.** He is a non-programmer who gives specs/decisions. He strongly
  prefers tight responses with working code over diagnostic back-and-forth.

---

## 3. THE ORDERS BREAKTHROUGH (hard-won — do not re-derive)

Orders are **NOT** in the pursuits bucket (1345459588), which is where a naive search
looks (and where the previous session wasted enormous effort). The truth:

- **Orders are instanced items in inventory bucket `635141261`** on the character.
  (`D.characterInventories.data[characterId].items` filtered to `bucketHash === 635141261`.)
- Each Order is `itemType === 26`, with `traitIds` including `"item.bounty"` and
  `"inventory_filtering.bounty"`. They display in-game as "Gunsmith Order", "Foundry
  Order", etc. (or blank type for Exotic orders).
- **Objective progress** comes from the **ItemObjectives component (301)**:
  `D.itemComponents.objectives.data[itemInstanceId].objectives` → array of
  `{ objectiveHash, progress, completionValue, complete, visible }`.
- **Name:** `DestinyInventoryItemDefinition[itemHash].displayProperties.name`
- **Description (what to do):** `DestinyInventoryItemDefinition[itemHash].displayProperties.description`
- **Short objective label:** `DestinyObjectiveDefinition[objectiveHash].progressDescription`
  (contains icon tokens like `[Headshot]`, `[Auto Rifle]` — see §5.1 caveat).
- **Rarity:** `DestinyInventoryItemDefinition[itemHash].inventory.tierType` (number) and
  `.tierTypeName` (string). Confirmed values: **2 → "Common"**, **6 → "Exotic"**.
  Legendary is **5 → "Legendary"** (standard Bungie enum). Use `tierTypeName` for display
  logic, `tierType` as backup.

**How it was found (for your confidence, not for repeating):** braytech.org makes only
`GetProfile` calls (no vendor calls). We hooked its `fetch`, read one Order's `itemHash`
out of its React state, resolved that item's definition, and its
`inventory.bucketTypeHash` was `635141261`. Verified the same 5 Orders + objectives exist
in Diego's `snapshot.json`.

**Component set already fetched** by `auth-and-snapshot.js` (includes 301):
`100,102,103,104,200,201,202,204,205,206,300,301,302,303,304,305,307,308,309,310,700,800,900,1000,1100,1200,1400`.
Note: 301 = ItemObjectives, 302 = ItemPerks (an earlier bug requested 302 thinking it was
objectives — it is not; 301 is correct and is now in the set).

### Verified sample (Diego's orders at handoff time)

| Name | tierType / name | itemTypeDisplayName | description (what to do) | objective label | progress |
|---|---|---|---|---|---|
| Full Auto | 2 / Common | Gunsmith Order | Defeat combatants/Guardians with Auto Rifles, SMGs, Trace Rifles, or Machine Guns. | `[Auto Rifle] [Machine Gun] final blows` | 493000/500000 |
| Weak Spot | 2 / Common | Foundry Order | Defeat combatants or Guardians with precision damage. | `[Headshot] Precision` | 49.5k/250k (varies) |
| Special Cases | 2 / Common | Gunsmith Order | (special-ammo weapon kills) | `Special ammo weapon` | 71k/350k |
| Close Comfort | 2 / Common | Gunsmith Order | (close-range kills) | — | — |
| Micah-10's Training | **6 / Exotic** | (blank) | Create orbs and apply buffs to your fireteam (Cure, Restoration, Woven Mail, Invisibility, Overshield). | `Progress` | 2.76M/5M |

Orders rotate/expire daily — names and progress change. The structure above is stable.

---

## 4. Current file inventory

In repo root unless noted. Node `>=18`, `"type": "module"`.

- **`auth-and-snapshot.js`** — zero-dependency OAuth + writes `snapshot.json` with the full
  component set above. Supports a `reauth` arg, friendly error-99 message, graceful exit.
  Run: `node auth-and-snapshot.js [reauth]`. **Working.**
- **`render.js`** — reads local `snapshot.json` + `.env` API key, resolves names via the
  Manifest (caching defs to `manifest-cache.json`), builds an 800×480 SVG, renders to
  `screen.png` via `@resvg/resvg-js` (prebuilt; no native build), and prints a report.
  **Just rewritten** to read Orders from bucket 635141261 (§3). This is the file you'll
  iterate on for §5.1–§5.3. Current layout: header (Warlock + Power + Updated) · left
  column = Orders then Quests & bounties · right column = Conquests / Seals & titles /
  Tracked triumph · footer.
- **`find-orders.js`, `probe-vendor.js`, `resolve.js`** — old diagnostics. Harmless; can be
  deleted in a cleanup commit.
- **`package.json`** (`@resvg/resvg-js` dependency), **`README.md`**, **`.gitignore`**
  (excludes `.env`, `tokens.json`, `snapshot.json`, `node_modules`, and you should add
  `manifest-cache.json`, `screen.png`).

`render.js` helpers you'll reuse: `getDef(type, hash)` (cached manifest lookup),
`progressOf(objs)`, `bar(x,y,w,frac,h)`, `txt(x,y,size,s,opts)`, `trunc`, `cleanLabel`
(strips `[...]` icon tokens).

---

## 5. Diego's requirements from this session (DO THESE)

Priority order is Diego's. **Active Orders are the most important element on the screen.**

### 5.1 Rarity indicator (exotic / legendary / regular)

In-game and on braytech, orders are color-coded by rarity. The panel is **1-bit monochrome**,
so color is unavailable — use a **distinct glyph/shape per tier** instead.

- Source the tier from `inventory.tierTypeName` (`"Exotic"`, `"Legendary"`, `"Common"`),
  falling back to `tierType` (6, 5, 2/3).
- **Caveat (important):** real emoji will likely **not render** in `@resvg/resvg-js`
  (no emoji font in the environment). Prefer either (a) small **SVG shapes** drawn inline
  (most reliable), or (b) plain geometric Unicode glyphs that the base font supports
  (e.g. `◆ ◇ ● ○ ■ ★`). Test whichever you choose on the actual `screen.png`.
- Suggested mapping (confirm with Diego): **Exotic = filled diamond ◆ / solid star**,
  **Legendary = open diamond ◇ or solid triangle**, **Common = small dot •**. Place the
  glyph to the left of the order name. Consider also showing the tier word as a tiny label
  if space allows.

### 5.2 Order description (what to do)

Right now only the name shows. Add `displayProperties.description` so Diego knows the task
(e.g. Weak Spot → "Defeat combatants or Guardians with precision damage."). It's a full
sentence — wrap to ~2 lines or truncate sensibly. The existing `progressDescription`
(short label like "Precision") is complementary; decide with Diego whether to show the
long description, the short label, or both. Likely: **name + long description + progress
bar + %**.

### 5.3 Trim less-important content for screen real estate

Orders should dominate. Each order now needs ~2–3 lines (glyph+name, description, bar/%),
so 5 orders ≈ 300–360 px. Free up space by cutting or shrinking the secondary sections.
Candidates to remove or minimize (confirm with Diego): Quests & bounties, Seals & titles,
Tracked triumph, Conquests. A reasonable v1: **Orders full-width with descriptions**, plus
at most one slim secondary line (e.g. tracked triumph) or nothing. The config UI (§5.4)
will eventually make this user-selectable, so don't over-engineer now.

### 5.4 PC-browser config interface (LATER — after server.js)

Diego wants a browser page on his PC to **select what to display** on the e-paper screen
(which sections, maybe which/how many orders, character, etc.). Implementation sketch:
the BYOS `server.js` (§7) also serves a `/config` HTML page that reads/writes a local
`config.json`; `render.js` reads `config.json` to decide what to draw. Keep `config.json`
gitignored or with safe defaults. Build this **after** the always-on server works.

---

## 6. Data reference (so you don't need the browser)

```js
const ORDERS_BUCKET   = 635141261;     // Orders (instanced bounty-type items)
const PURSUITS_BUCKET = 1345459588;    // quests + bounties
const wid = Object.keys(D.characters.data).find(c => D.characters.data[c].classType === 2); // Warlock

const inv     = D.characterInventories.data[wid].items;            // character items
const objInst = D.itemComponents.objectives.data;                  // component 301, keyed by itemInstanceId
const uio     = D.characterProgressions.data[wid].uninstancedItemObjectives; // for uninstanced items

const orders = inv.filter(it => it.bucketHash === ORDERS_BUCKET);
for (const it of orders) {
  const def  = /* getDef('DestinyInventoryItemDefinition', it.itemHash) */;
  const objs = (it.itemInstanceId && objInst[it.itemInstanceId]?.objectives) || [];
  // def.displayProperties.name / .description
  // def.itemTypeDisplayName, def.inventory.tierType, def.inventory.tierTypeName
  // objs[0].objectiveHash -> DestinyObjectiveDefinition.progressDescription
  // objs[].progress / .completionValue / .complete
}
```

Manifest lookups (run on Diego's PC, API key only, no token):
`GET https://www.bungie.net/Platform/Destiny2/Manifest/{DefType}/{hash}/` with header
`X-API-Key: <key>`. `render.js` already caches these to `manifest-cache.json`.

Other things known-good in `snapshot.json` (kept as optional secondary content):
- Quests & bounties: pursuits bucket 1345459588.
- Seals/Titles: `profileRecords.data.recordSealsRootNodeHash` + `profilePresentationNodes`
  node progress (`progressValue`/`completionValue`).
- Conquests: the "Conqueror" seal's % .
- Tracked triumph: `profileRecords.data.trackedRecordHash` (currently none tracked).

---

## 7. Build the BYOS server (`server.js`) — next big step after §5.1–§5.3

A long-running Node server on Diego's PC that the TRMNL device polls.

- **Endpoints (TRMNL BYOS protocol):**
  - `GET /api/setup` → JSON for first-time device handshake.
  - `GET /api/display` → JSON `{ image_url, filename, refresh_rate: 60 }` pointing at the
    current image.
  - Serve the image at the `image_url` path.
- **Image format:** the device wants a **1-bit, 800×480 BMP**. `screen.png` is 1-bit PNG;
  write a tiny BMP encoder (or convert) so the served file is a 1-bit BMP. Confirm the
  device's expected format against current TRMNL BYOS docs.
- **Loop:** regenerate the image every ~60s (reuse `render.js`'s drawing logic; refactor it
  into an importable function so both CLI render and the server share it).
- **Token refresh:** must be **non-interactive** in the server (use the stored refresh
  token). Keep the interactive `authorize` flow in `auth-and-snapshot.js`.
- **Startup:** print the PC's LAN IP + port so Diego can point the device at it.
- Then guide Diego: TRMNL firmware **Advanced → Custom Server** = `http://<PC-LAN-IP>:<port>`
  (firmware ≥1.4.6, no reflash needed), in WiFi pairing mode; add a Windows Firewall
  allowance for the port.

---

## 8. Workflow notes & gotchas

- **Container can't reach bungie.net.** You analyze `snapshot.json` with local Python/JS in
  the sandbox (cheap); Diego runs anything that hits the Bungie API on his PC.
- **Async in the Chrome `javascript_tool` REPL** returns `{}` for the awaited value — stash
  results on a `window.__x` global inside a fire-and-forget IIFE and read them back in a
  separate synchronous call. (Only relevant if you use the browser tool again; you
  shouldn't need to for §5.)
- **resvg has no emoji font** — see §5.1. Verify glyphs render by inspecting `screen.png`.
- **Don't re-hunt Orders.** Bucket 635141261 + component 301 is confirmed (§3).
- Keep `snapshot.json` out of git; it's ~26 MB. When you need fresh data, ask Diego to
  re-run `node auth-and-snapshot.js`.
- Test command for `render.js`: Diego runs `git pull` then `node render.js` and opens
  `screen.png`; the console report lists the Orders found.

---

## 9. Suggested first actions for you (the next agent)

1. `get_file_contents` on `render.js` to get its current content + SHA.
2. Implement §5.1 (rarity glyph), §5.2 (description), §5.3 (trim) in `render.js`. Refactor
   the draw logic into a reusable function while you're in there (helps §7).
3. Push; have Diego `git pull && node render.js` and share `screen.png` + console report.
4. Iterate on glyph choice / layout with Diego.
5. Then build `server.js` (§7).
6. Then the `/config` UI (§5.4).
