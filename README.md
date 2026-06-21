# TRMNL Destiny — Step 1: auth + snapshot

This pulls your Destiny 2 profile so the display can be designed from your real data.
It is one command — no file editing, no `npm install`, no certificates.

## What you need

- **Node.js 18 or newer.** Check by opening Command Prompt and typing `node -v`.
  If it prints something like `v20.x`, you're set. If it says it's not recognized,
  install the **LTS** build from https://nodejs.org and reopen Command Prompt.
- This project folder on your machine. Easiest way: on the repo page click the green
  **Code** button -> **Download ZIP**, then extract it (e.g. into Documents).

## Run it

Open a terminal **inside the project folder** (in File Explorer, click the address bar,
type `cmd`, press Enter), then run:

```
node auth-and-snapshot.js
```

The script will:

1. Ask for your **API Key**, **Client ID**, and **Client Secret** (from your Bungie app
   page). Paste each and press Enter — it saves them to a local `.env` for you.
2. Open the Bungie **Authorize** page in your browser. Click Authorize.
3. Your browser will then try to reach a `127.0.0.1` address and show an error like
   "This site can't be reached." **That's expected.** Copy the entire address from the
   address bar and paste it back into the terminal.
4. Write **snapshot.json** into the folder.

## Then

Upload `snapshot.json` to Claude. That's the real data used to map Orders / Conquests /
Triumphs / Titles / quests / bounties into the layout.

The Bungie app's **Redirect URL** must read exactly `https://127.0.0.1:8443/callback`.

`.env`, `tokens.json`, and `snapshot.json` are gitignored — they hold your credentials
and private data and are never committed.
