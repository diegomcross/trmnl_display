# TRMNL Destiny — Step 1: auth + snapshot

This pulls your Destiny 2 profile so we can design the display from your real data.

## One-time setup

1. Install **Node.js 18 or newer** if you don't have it: https://nodejs.org (the "LTS" download).
2. Clone this repo to your machine.
3. In the project folder, make a copy of `.env.example` and rename the copy to `.env`.
4. Open `.env` in Notepad and paste your three values from the Bungie app page:
   - `BUNGIE_API_KEY`
   - `BUNGIE_CLIENT_ID`
   - `BUNGIE_CLIENT_SECRET`

## Run it

Open a terminal **in the project folder** (in File Explorer, type `cmd` in the address bar and press Enter), then:

```
npm install
node auth-and-snapshot.js
```

- The first run prints an **Authorize** link. Open it, click Authorize.
- Your browser will warn about the `127.0.0.1` certificate — that's our own local one.
  Click **Advanced -> Proceed to 127.0.0.1**. The page will say "Authorized."
- Back in the terminal it pulls your profile and writes **snapshot.json**.

## Then

Send Claude `snapshot.json`. That's the real data used to map Orders / Conquests /
Triumphs / Titles / quests / bounties to the layout.

Re-running later just refreshes the snapshot (it reuses your saved tokens; you won't
need to authorize again for about 90 days).

## Note

`.env`, `tokens.json`, and `snapshot.json` are gitignored on purpose — they hold your
credentials and private data and should never be committed.
