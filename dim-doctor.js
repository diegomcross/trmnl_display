// dim-doctor.js — "why isn't DIM syncing?" in one command.
//
//   Run:  node dim-doctor.js          (or double-click DIM-DOCTOR.cmd)
//
// Diego 2026-08-29: "check the sync with DIM, open DIM, check the API, figure out why it's
// not working." This is that check, made repeatable. It answers ONE question — which of the
// DIM Sync API's failure modes are we actually hitting — and tells you the fix for that one.
//
// It is READ-ONLY. It never writes a tag, never changes a setting, and never deletes a token.
// It prints no secrets: keys and tokens are shown only as a length + last-4 fingerprint, so
// the whole output is safe to paste into a chat.
//
// HOW IT WORKS. Half the failure modes can be proven offline, because the DIM auth token is a
// plain JWT: its middle segment is base64url JSON we can read without any secret. It carries
//   sub         = your Bungie.net membership id
//   iss         = the dimApiKey the token was ISSUED for
//   exp         = expiry
//   profileIds  = the Destiny profiles this token is allowed to touch
// Cross-checking those three against our own files catches ApiKeyMismatch and UnknownProfileId
// before we make a single network call. Verified against DIM's own server source
// (github.com/DestinyItemManager/dim-api — api/server.ts, api/routes/auth-token.ts,
// api/routes/profile.ts, api/utils.ts) on 2026-08-29.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DIM_API_BASE lets the test harness point this at a stand-in server; unset in real use.
const DIM_API = process.env.DIM_API_BASE || 'https://api.destinyitemmanager.com';
const DIM_ORIGIN = 'https://localhost';
const ENV_FILE = path.join(__dirname, '.env');
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const APP_FILE = path.join(__dirname, '.dim-app.json');
const TOKEN_FILE = path.join(__dirname, '.dim-token.json');
const TAGS_FILE = path.join(__dirname, 'weapon-tags.json');
const BASE = 'https://www.bungie.net/Platform';

// ---------- output helpers (ASCII only — this runs in cmd.exe) ----------
let problems = [];
const line = (s = '') => console.log(s);
const head = (s) => { line(); line('=== ' + s + ' ==='); };
const ok = (s) => line('  [ OK ] ' + s);
const bad = (s, fix) => { line('  [FAIL] ' + s); if (fix) line('         FIX: ' + fix); problems.push({ s, fix }); };
const info = (s) => line('  [ .. ] ' + s);
const fp = (v) => (v ? `${String(v).length} chars, ends ...${String(v).slice(-4)}` : '(missing)');
const ago = (ms) => {
  if (!ms) return 'never';
  const d = Math.abs(Date.now() - ms), day = 86400000;
  if (d > day) return Math.round(d / day) + ' days ' + (ms > Date.now() ? 'from now' : 'ago');
  if (d > 3600000) return Math.round(d / 3600000) + 'h ' + (ms > Date.now() ? 'from now' : 'ago');
  return Math.round(d / 60000) + 'm ' + (ms > Date.now() ? 'from now' : 'ago');
};
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Decode a JWT's payload without verifying it — we have no secret and don't need one. */
function jwtPayload(token) {
  try {
    const seg = String(token).split('.')[1];
    return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
}

function loadEnv() {
  const out = {};
  try {
    for (const l of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { return null; }
  return out.BUNGIE_API_KEY ? out : null;
}

// ---------- 1. the files ----------
head('1. Files on this PC');
const env = loadEnv();
env ? ok('.env has a Bungie API key (' + fp(env.BUNGIE_API_KEY) + ')')
    : bad('.env missing or has no BUNGIE_API_KEY', 'open http://127.0.0.1:8787/setup and do step 1');

const bTok = readJson(TOKENS_FILE);
if (!bTok) bad('tokens.json missing — you are not logged in to Bungie', 'open http://127.0.0.1:8787/setup and do step 2');
else {
  const refreshLeft = (bTok.refresh_expires_at || 0) - Date.now();
  info('Bungie access token expires ' + ago(bTok.expires_at));
  if (refreshLeft > 0) ok('Bungie REFRESH token still valid (' + ago(bTok.refresh_expires_at) + ')');
  else bad('Bungie REFRESH token EXPIRED ' + ago(bTok.refresh_expires_at) + ' — nothing can talk to Bungie or DIM',
           'open http://127.0.0.1:8787/setup and do step 2 (log in with Bungie again)');
}

const app = readJson(APP_FILE);
if (!app || !app.dimApiKey) bad('.dim-app.json missing — this PC has never registered a DIM app',
  'open http://127.0.0.1:8787/setup and do step 3 (DIM sync)');
else { ok('.dim-app.json present — app id "' + app.appId + '", key ' + fp(app.dimApiKey)); }

const tok = readJson(TOKEN_FILE);
if (!tok || !tok.token) info('.dim-token.json missing — the server will mint a fresh one on its next DIM call (normal after a re-login)');
else ok('.dim-token.json present — token ' + fp(tok.token));

// ---------- 2. what the token itself says (offline, no secret needed) ----------
head('2. Inside the DIM token (decoded locally, nothing sent anywhere)');
let jwt = null, pidInToken = null;
if (!tok || !tok.token) info('no token to inspect yet');
else {
  jwt = jwtPayload(tok.token);
  if (!jwt) bad('.dim-token.json does not contain a readable JWT — the file is corrupt',
    'delete .dim-token.json and restart the server (REBOOT.cmd); it will mint a new one');
  else {
    const expMs = (jwt.exp || 0) * 1000;
    info('issued for Bungie membership  : ' + jwt.sub);
    info('issued for DIM app key        : ' + fp(jwt.iss));
    info('profiles this token may touch : ' + JSON.stringify(jwt.profileIds || []));
    info('token expires                 : ' + new Date(expMs).toLocaleString() + '  (' + ago(expMs) + ')');

    // -- expiry. DIM issues 30-day tokens; ours also stores its own `exp`.
    if (expMs && expMs < Date.now())
      bad('the DIM token EXPIRED ' + ago(expMs) + '. The server re-mints automatically, so if sync is '
        + 'still broken the re-mint is what is failing — see the Bungie refresh token above.',
        'if the Bungie refresh token is fine, delete .dim-token.json and REBOOT.cmd');
    else if (expMs) ok('token has not expired');

    // -- ApiKeyMismatch: DIM 401s if X-API-Key is not the key the token was issued for.
    if (app && app.dimApiKey && jwt.iss && jwt.iss !== app.dimApiKey)
      bad('MISMATCH: the token was issued for a DIFFERENT DIM app key than the one in .dim-app.json.\n'
        + '         DIM answers every request with 401 ApiKeyMismatch. This happens when .dim-app.json\n'
        + '         is replaced (e.g. a copy shared from another PC) but .dim-token.json is not.',
        'delete .dim-token.json and restart the server (REBOOT.cmd)');
    else if (app && jwt.iss) ok('token key matches .dim-app.json (no ApiKeyMismatch)');

    // -- Bungie identity: the token is bound to one Bungie account.
    if (bTok && jwt.sub && String(jwt.sub) !== String(bTok.membership_id))
      bad('the DIM token belongs to Bungie account ' + jwt.sub + ' but you are logged in as '
        + bTok.membership_id + ' — a different account.',
        'delete .dim-token.json and restart the server (REBOOT.cmd)');
    else if (bTok && jwt.sub) ok('token belongs to the Bungie account you are logged in as');

    pidInToken = (jwt.profileIds || [])[0] || null;
  }
}

// ---------- 3. which Destiny profile the server asks DIM about ----------
// This is the subtle one. dimAuth() picks the profile with primaryMembershipId, else the FIRST
// membership Bungie returns. DIM only accepts a platformMembershipId that is in the token's
// profileIds list; anything else is 401 UnknownProfileId. With cross-save, or a leftover
// membership from an old platform, "first in the list" and "the one DIM knows" can differ.
head('3. Which Destiny profile do we ask DIM about?');
if (tok && tok.pid) {
  info('the server last used platformMembershipId ' + tok.pid);
  if (jwt && Array.isArray(jwt.profileIds) && jwt.profileIds.length) {
    if (jwt.profileIds.includes(String(tok.pid)))
      ok('that profile IS in the token\'s allowed list (no UnknownProfileId)');
    else
      bad('that profile is NOT in the token\'s allowed list ' + JSON.stringify(jwt.profileIds) + '.\n'
        + '         DIM answers 401 UnknownProfileId and the server has no way to recover on its own.',
        'delete .dim-token.json and restart the server (REBOOT.cmd)');
  } else info('no profile list in the token to compare against');
} else info('no cached profile id yet (normal before the first DIM call)');

// ---------- 4. the live API ----------
head('4. Talking to the DIM API for real (read-only)');
async function live() {
  if (!app || !app.dimApiKey) { info('skipped — no DIM app key on this PC'); return; }
  if (!tok || !tok.token) { info('skipped — no DIM token yet; start the server once, then re-run this'); return; }

  const hdr = { 'X-API-Key': app.dimApiKey, Authorization: `Bearer ${tok.token}`, Origin: DIM_ORIGIN };
  let res, body;
  try {
    res = await fetch(`${DIM_API}/profile?platformMembershipId=${tok.pid}&destinyVersion=2&components=tags`, { headers: hdr });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    bad('could not reach ' + DIM_API + ' at all: ' + err.message,
      'check this PC is online and that a firewall/VPN is not blocking api.destinyitemmanager.com');
    return;
  }

  info('GET /profile -> HTTP ' + res.status + (body && body.error ? '  ' + body.error : ''));

  // DIM's documented failure modes, each with the thing that actually fixes it.
  const FIXES = {
    OriginMismatch: ['the API key was registered for a different Origin than the server sends (https://localhost).',
                     'delete .dim-app.json AND .dim-token.json, then redo step 3 in /setup to register a fresh app'],
    ApiKeyMismatch: ['the token was issued for a different app than .dim-app.json holds.',
                     'delete .dim-token.json and restart the server (REBOOT.cmd)'],
    UnknownProfileId: ['DIM does not recognise the Destiny profile the server asked about.',
                       'delete .dim-token.json and restart the server (REBOOT.cmd)'],
    WebAuthRequired: ['your Bungie login is no longer valid.',
                      'open http://127.0.0.1:8787/setup and do step 2'],
    WrongMembership: ['the token and the Bungie account disagree.',
                      'delete .dim-token.json and restart the server (REBOOT.cmd)'],
    NoAppFound: ['DIM has no app registered for this key yet. A brand-new app takes a minute to activate.',
                 'wait a minute and re-run this; if it persists, redo step 3 in /setup'],
  };

  if (res.status === 200 && Array.isArray(body.tags)) {
    ok('DIM sync WORKS — read ' + body.tags.length + ' tagged items');
    const mirror = readJson(TAGS_FILE);
    const mirrorN = mirror ? Object.keys(mirror).length : 0;
    info('local mirror weapon-tags.json holds ' + mirrorN + ' tags');
    if (body.tags.length === 0 && mirrorN > 0)
      bad('DIM returned ZERO tags but this PC has ' + mirrorN + ' cached. That is what a wrong-profile\n'
        + '         read looks like, and the server would overwrite its local copy with the empty result.',
        'check the profile id in section 3 above before trusting this');
    return;
  }

  // A reply from DIM itself always names the reason in a JSON `error` field. A 401/403 with no
  // such field did not come from DIM — it came from something in between (corporate proxy, VPN,
  // filtering DNS), and deleting tokens would not help.
  if ((res.status === 401 || res.status === 403) && !(body && body.error)) {
    bad('HTTP ' + res.status + ' with no DIM error in the body — this reply did not come from DIM.\n'
      + '         Something between this PC and the internet is blocking api.destinyitemmanager.com.',
      'check VPN / firewall / work network, then re-run. Your DIM setup itself looks fine.');
    return;
  }

  if (res.status === 401 || res.status === 403) {
    const [why, fix] = FIXES[body.error] || ['DIM rejected the request (' + body.error + ').',
      'delete .dim-token.json and restart the server (REBOOT.cmd)'];
    bad('DIM says ' + body.error + ' — ' + why, fix);
    line();
    line('         Note: the server now clears the cached token and re-auths ONCE by itself when DIM');
    line('         answers 401, so this should self-heal on the next refresh. If it keeps coming back,');
    line('         the fix above is the one that sticks.');
    return;
  }

  bad('unexpected reply: HTTP ' + res.status + ' ' + JSON.stringify(body).slice(0, 200),
    'if this persists, paste this whole output into the chat');
}

await live();

// ---------- verdict ----------
head('Verdict');
if (!problems.length) {
  line('  Nothing wrong found. DIM sync should be working.');
  line('  If tags still look stale in the app, hit the "Updated" chip (bottom-right of any page)');
  line('  to force a refresh, and check vault.log for lines starting "DIM read failed".');
} else {
  line('  ' + problems.length + ' problem(s) found. Do the FIX lines above, top to bottom.');
  line();
  line('  Most DIM problems are fixed by the same two steps:');
  line('    1. delete .dim-token.json   (it is just a cached login; it costs nothing to re-mint)');
  line('    2. double-click REBOOT.cmd');
}
line();
