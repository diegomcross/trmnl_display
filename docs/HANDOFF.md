# Destiny 2 → TRMNL e-ink dashboard — Handoff

A self-hosted dashboard that shows Diego's current Destiny 2 **Orders** (and, soon,
other content) on a 7.5" 800×480 monochrome e-ink panel.

> **Read this first.** Diego is a non-programmer: **Claude writes and pushes all code;
> Diego runs commands locally and handles the browser/device.** Keep responses tight and
> ship working code. Verify GitHub pushes by fetching the raw file and diffing/MD5 vs the
> tested local copy.

---

## Hardware & accounts

- **Panel:** TRMNL 7.5" OG **DIY kit — Seeed Studio driver board** + XIAO ESP32-S3, 800×480, 1-bit monochrome. 2.4 GHz Wi-Fi only. Device MAC `1C:DB:D4:74:E7:E0`.
  - **Re-enter Wi-Fi pairing / captive portal: hold *Key 3* ~5s.** (The "hold the back button" and "Reset→Boot" instructions are for *other* TRMNL units and do **not** apply.)
- **Character:** Warlock main "Aquarius", Steam. `membershipType 3`, `membershipId 4611686018530139303`, Warlock `characterId 2305843010375154553`.
- **Bungie OAuth app:** `client_id 49944`, confidential client, redirect `https://127.0.0.1:8443/callback`. Tokens stored in `tokens.json` (gitignored), refreshed non-interactively.
- **Repo:** `github.com/diegomcross/trmnl_display`, branch `main`. Local clone: `C:\Users\diego\Desktop\cola_ai_v3\trmnl_display`.
- **Dev PC:** Windows, Node 18+. Ethernet `192.168.1.130`; Wi-Fi `192.168.1.68`; VPN virtual adapter `10.14.0.2`.

---

## Files

| File | Role |
|---|---|
| `auth-and-snapshot.js` | Interactive Bungie OAuth + writes `snapshot.json` (full profile dump). Run once / to re-auth. |
| `render.js` | `buildModel(profile)` → data model; `renderSVG(model, opts)` → 800×480 SVG. CLI run writes `screen.png` + prints a report. Both exported for reuse. |
| `server.js` | Always-on TRMNL BYOS HTTP server. Pulls a fresh profile each cycle, renders, converts to 1-bit BMP, serves it. Hosts the settings page. |
| `watch-destiny.ps1` | Watches for `destiny2.exe`; auto-starts/stops the server with the game. Task Scheduler logon-task one-liner in its header. |
| `config.json` | Settings written by the settings page (gitignored; per-machine). |
| `manifest-cache.json` | Cached Bungie manifest defs (gitignored). `CACHE_SCHEMA` const invalidates it when the stored shape changes. |

---

## What works now

- **Auth + profile fetch** end-to-end (non-interactive refresh in `server.js`).
- **Orders discovery (the hard-won part):** Orders are instanced bounty-type items
  (`itemType 26`, trait `item.bounty`) in **inventory bucket `635141261`** (not the
  pursuits bucket). Objective progress from **component 301** (`itemComponents.objectives`).
  Rarity from `inventory.tierType` / `tierTypeName` (**2 Common, 5 Legendary, 6 Exotic**).
- **Orders page layout (settled — "Sample 2"):** tiny caption (rarity glyph + name +
  `prog/total · %`) above a **big description**, with the **progress fill sweeping across
  the description text** (text flips white over the filled region via SVG `clipPath`).
  5 orders, no header/footer. Rarity glyphs are SVG shapes (resvg has no emoji font):
  **★ Exotic, ◆ Legendary, ◇ Rare, ○ Common.**
- **1-bit BMP pipeline:** render SVG at **3× (SS=3)**, box-average down to 800×480, then
  **threshold at 150** → solid strokes, no broken letters. Standard 1-bit BMP3, bottom-up,
  palette index0=black/index1=white, bit=1→white. `INVERT` flag if a panel shows inverted.
- **Refresh only on change:** the rendered **SVG string** is the change key (no clock in
  it), so the panel only redraws when the visible screen actually differs. Server logs
  "panel will redraw" vs "panel stays asleep". `filename` only bumps on change.
- **BYOS endpoints:** `GET /api/display` (status/image_url/filename/refresh_rate),
  `GET /api/setup`, `GET /screen.bmp` (+`/setup.bmp`), `POST /api/log` (204),
  `GET /` (status + preview), `GET /settings` + `GET|POST /api/config`.
- **Interim settings page (to be REPLACED — see below):** order count, description size,
  refresh interval, show/hide raw numbers, invert. Persists to `config.json`, applies live.
- **Auto-launch watcher** (`watch-destiny.ps1`).

---

## Connectivity learnings (these cost real time — don't relitigate)

- **The device talks plain `http`, not `https`.** Custom Server URL must be e.g.
  `http://192.168.1.130:3000` — **no trailing slash, no https.** Firmware appends `/api/...`.
- **The PC's IP moves** between Ethernet (`.130`), Wi-Fi (`.68`), and the VPN adapter
  (`10.14.0.2`). The device must point at whichever interface it can actually reach
  (the LAN one, `192.168.1.x`). The single best diagnostic: **load `http://<ip>:3000/`
  from a phone on home Wi-Fi** — if the phone can't reach it, the device can't either.
- **Windows Firewall:** allow inbound TCP 3000 —
  `netsh advfirewall firewall add rule name="TRMNL D2" dir=in action=allow protocol=TCP localport=3000 profile=any`.
- **No-button pairing fallback:** if the device can't find its saved SSID it re-enters the
  captive portal on its own (rename the 2.4 GHz SSID briefly to force it).

---

## NEW DIRECTION — Settings = content picker + pages (NOT yet built)

The current settings page is layout-only and is the **wrong model**. Diego's actual vision:

1. **Content picker.** Settings lists the Bungie content categories and lets him choose
   which to show:
   - **Orders**, filterable by **rarity** (Common / Legendary / Exotic) — pick which tiers.
   - **Quests / bounties**
   - **Triumphs**
   - **Titles (Seals)**
   - (extensible)
2. **Pages.** The panel shows **one page at a time and rotates** through them. He assigns
   selected content to pages (e.g. Page 1 = Orders; Page 2 = chosen Quests; Page 3 = a
   title's progress). **Orders fill an entire page on their own.**
3. **Page-rotation interval (seconds)** — how long each page shows before flipping.

**Design notes for implementation:**
- Each content type needs its **own page layout**. The settled "Sample 2" design is the
  **Orders page**; Quests / Triumphs / Titles need their own layouts.
- **Power tradeoff:** every page flip is a deliberate e-ink refresh. Make rotation
  off-able and allow long intervals; single page = least refreshing. Within a page, only
  redraw when that page's data changes (as today).
- **`buildModel` must gather more than orders** now — quests/bounties, tracked triumphs,
  seals/titles with progress — so pages can be composed from real data.
- **Server page selection:** pick the "current" page from elapsed time
  (`floor(now/interval) % numPages`), render that page, bump `filename` when the page or
  its data changes. `refresh_rate` returned to the device should be ≤ the page interval so
  flips are timely.
- **Config schema (proposed):**
  ```json
  {
    "rotationSeconds": 30,
    "pages": [
      { "type": "orders", "rarities": ["common","legendary","exotic"] },
      { "type": "quests", "items": ["<hash>", "..."] },
      { "type": "title", "sealHash": "<hash>" }
    ],
    "descSize": 25, "invert": false, "refreshSeconds": 60
  }
  ```
- **Settings UI** becomes: a list of available content (with checkboxes / rarity filters),
  a page assignment per selected item, and the rotation-interval field, all persisted to
  `config.json` and applied live. Keep server-side persistence (no browser storage).

> **Confirm the vision with Diego before building** (ordering within a page, default page,
> per-page layout options were open questions at handoff time).

---

## Open items / next steps

1. **Confirm the pages/content-picker spec**, then build it (config schema, multi-content
   `buildModel`, per-type page layouts, server rotation, new settings UI).
2. **VPN coexistence:** Diego needs the VPN running. Fix is almost always the VPN app's
   **"allow local network / LAN access"** toggle (whitelists `192.168.1.0/24`). **Which VPN
   he runs is still unknown** (the `10.14.0.2` adapter is the tell) — get the name for exact steps.
3. The interim layout-only settings page (`/settings`) is committed but will be superseded
   by the content-picker/pages model above.

---

## Technical reference

- **resvg-js:** `new Resvg(svg,{fitTo:{mode:'zoom',value:3}}).render()` → `.pixels` (RGBA),
  `.width/.height`, `.asPng()`. No emoji font → use SVG shapes for icons.
- **1-bit "label on a fill" trick:** draw a black fill rect for the filled region, then draw
  the text twice — white clipped to the filled region, black clipped to the empty region —
  so text stays legible whether over black or white.
- **GitHub MCP gotchas:** prefer fetching the raw URL and diffing after every push; over-
  escaping (`\"` → `\\\"`) has corrupted pushes before. Files can truncate silently — verify.
  The connector can also drop mid-session; if its tools vanish, a new chat reloads them.
- **Manifest:** `getDef(type, hash)` caches to `manifest-cache.json`; bump `CACHE_SCHEMA`
  whenever the stored field shape changes (this fixed an "all Common" rarity bug caused by
  a stale cache written before `tierType` was captured).
