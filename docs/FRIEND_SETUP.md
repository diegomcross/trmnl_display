# Giving Vault Verdict to a friend — plain steps

The app runs on the friend's own PC with the friend's own Bungie account.
Nothing is shared between the two installs: his tags, watches, stars, and
builds live on his PC only.

## What Diego sends the friend

1. The app itself: on GitHub → **Code → Download ZIP**
   (github.com/diegomcross/trmnl_display). The GitHub copy is clean — none of
   Diego's personal data is in it (it's all gitignored).
2. **Two small files from Diego's app folder, sent privately** (WhatsApp/Discord
   DM, not posted anywhere public — one of them contains the app's secret key):
   - `.env`  (the app's Bungie identity — API key / client id / client secret)
   - `.dim-app.json`  (the app's DIM Sync identity)

   Sharing these does NOT share Diego's account or data — they only identify
   *the app*. Each person still logs in with their own Bungie account.
   (If the friend prefers his own keys, skip these two files — the setup page's
   step 1 walks him through creating them.)

## What the friend does (once)

1. Install **Node.js LTS** from nodejs.org (all default options).
2. Unzip the app anywhere (e.g. `Documents\vault-verdict`).
3. Copy the two files from Diego into that folder.
4. Double-click **`INSTALL.cmd`** — the app starts and the browser opens the
   **setup page** (`http://127.0.0.1:8787/setup`).
5. On the setup page: click **Log in with Bungie** → sign in on Bungie's site →
   Authorize → copy the whole address of the error page you land on → paste it
   back → **Connect**. (His password is only ever typed on bungie.net itself.)
6. Click **Connect DIM sync**. When everything shows DONE, the app is ready.

## Afterwards

- Start the app any time with `INSTALL.cmd` (it just launches and opens the app),
  or set it to start with Windows via `start-vault.ps1 -Install`.
- The TRMNL display server (`server.js`) is Diego's e-ink panel — the friend
  doesn't need it.
- If the Bungie login ever expires, open `/setup` again and redo step 2 — this
  replaces the old `node auth-and-snapshot.js` terminal flow for re-auth.
