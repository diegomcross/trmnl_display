// auth-and-snapshot.js
//
// What it does:
//   1) First run: opens a one-time Bungie "Authorize" step in your browser,
//      captures the result on a local HTTPS callback, and saves your tokens
//      to tokens.json.
//   2) Every run (including the first): pulls your full Destiny 2 profile and
//      writes it to snapshot.json so we can see how Orders / Conquests /
//      Triumphs / Titles actually appear in the data.
//
// Run:  node auth-and-snapshot.js
// Needs: Node 18+ , and a .env file (copy .env.example to .env and fill it in).

import 'dotenv/config';
import fs from 'node:fs';
import https from 'node:https';
import { URL } from 'node:url';
import selfsigned from 'selfsigned';

const API_KEY = process.env.BUNGIE_API_KEY;
const CLIENT_ID = process.env.BUNGIE_CLIENT_ID;
const CLIENT_SECRET = process.env.BUNGIE_CLIENT_SECRET;

const REDIRECT_URI = 'https://127.0.0.1:8443/callback'; // must match the app's Redirect URL exactly
const PORT = 8443;
const BASE = 'https://www.bungie.net/Platform';
const TOKENS_FILE = './tokens.json';

// Broad set of components for the diagnostic snapshot:
//   100 Profiles            200 Characters         201 CharacterInventories (pursuits live here)
//   202 CharacterProgress.  300 ItemInstances      302 ItemObjectives (objective progress)
//   700 PresentationNodes   900 Records (Triumphs/Seals)  1000 Transitory ("now playing")
//   1400 StringVariables (resolves {var:###} placeholders in some descriptions)
const COMPONENTS = '100,200,201,202,300,302,700,900,1000,1400';

if (!API_KEY || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing values in .env. Need BUNGIE_API_KEY, BUNGIE_CLIENT_ID, BUNGIE_CLIENT_SECRET.');
  process.exit(1);
}

function apiHeaders(accessToken) {
  const h = { 'X-API-Key': API_KEY };
  if (accessToken) h['Authorization'] = `Bearer ${accessToken}`;
  return h;
}

// Confidential clients authenticate to the token endpoint with HTTP Basic auth.
function tokenAuthHeader() {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-API-Key': API_KEY,
    'Authorization': `Basic ${basic}`,
  };
}

async function postToken(params) {
  const res = await fetch(`${BASE}/App/OAuth/Token/`, {
    method: 'POST',
    headers: tokenAuthHeader(),
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

function saveTokens(t) {
  const data = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
    refresh_expires_at: Date.now() + (t.refresh_expires_in ?? 7776000) * 1000, // ~90d default
    membership_id: t.membership_id,
  };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
  return data;
}

// One-time authorize: stand up a local HTTPS server with our own cert, send you
// to Bungie, and catch the redirect back with the ?code=.
function authorize() {
  return new Promise((resolve, reject) => {
    const state = Math.random().toString(36).slice(2);
    const pems = selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }], {
      days: 365,
      keySize: 2048,
      altNames: [{ type: 7, ip: '127.0.0.1' }],
    });

    const server = https.createServer({ key: pems.private, cert: pems.cert }, async (req, res) => {
      try {
        const u = new URL(req.url, REDIRECT_URI);
        if (!u.pathname.startsWith('/callback')) { res.writeHead(404); res.end(); return; }
        const code = u.searchParams.get('code');
        if (!code || u.searchParams.get('state') !== state) {
          res.writeHead(400); res.end('Missing code or state mismatch.'); return;
        }
        const tok = await postToken({ grant_type: 'authorization_code', code });
        const saved = saveTokens(tok);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authorized. Close this tab and go back to the terminal.</h2>');
        server.close();
        resolve(saved);
      } catch (e) {
        res.writeHead(500); res.end(String(e)); server.close(); reject(e);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      const authUrl =
        `https://www.bungie.net/en/OAuth/Authorize?client_id=${CLIENT_ID}` +
        `&response_type=code&state=${state}`;
      console.log('\n-- One-time authorize --');
      console.log('1) Open this URL in your browser and click Authorize:\n');
      console.log('   ' + authUrl + '\n');
      console.log('2) The browser will warn about the 127.0.0.1 certificate (it is our own local one,');
      console.log('   that is expected). Click Advanced -> Proceed to 127.0.0.1.');
      console.log('   The page should then say "Authorized." and you can return here.\n');
    });
  });
}

async function getValidAccessToken() {
  if (!fs.existsSync(TOKENS_FILE)) return (await authorize()).access_token;

  const t = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  if (Date.now() < t.expires_at - 60000) return t.access_token;

  if (Date.now() < t.refresh_expires_at) {
    console.log('Access token expired, refreshing...');
    const nt = await postToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    return saveTokens(nt).access_token;
  }
  console.log('Refresh token expired, re-authorizing...');
  return (await authorize()).access_token;
}

async function getJson(url, accessToken) {
  const res = await fetch(url, { headers: apiHeaders(accessToken) });
  const json = await res.json();
  if (json.ErrorCode && json.ErrorCode !== 1) {
    throw new Error(`Bungie error ${json.ErrorCode}: ${json.Message}`);
  }
  return json.Response;
}

async function getPrimaryMembership(accessToken) {
  const r = await getJson(`${BASE}/User/GetMembershipsForCurrentUser/`, accessToken);
  const memberships = r.destinyMemberships || [];
  if (memberships.length === 0) throw new Error('No Destiny memberships found on this account.');
  const primaryId = r.primaryMembershipId;
  return (
    memberships.find((m) => m.membershipId === primaryId) ||
    memberships.find((m) => m.crossSaveOverride === 0 || m.crossSaveOverride === m.membershipType) ||
    memberships[0]
  );
}

(async () => {
  try {
    const accessToken = await getValidAccessToken();
    const m = await getPrimaryMembership(accessToken);
    console.log(`\nDestiny account: ${m.displayName} (platform ${m.membershipType}, id ${m.membershipId})`);

    const profile = await getJson(
      `${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${COMPONENTS}`,
      accessToken
    );

    fs.writeFileSync('./snapshot.json', JSON.stringify(profile, null, 2));
    const charCount = Object.keys(profile.characters?.data || {}).length;
    console.log(`Characters found: ${charCount}`);
    console.log('Saved full profile to snapshot.json\n');
    console.log('Done. Send me snapshot.json and I will map the layout from your real data.');
  } catch (e) {
    console.error('\nError:', e.message);
    process.exit(1);
  }
})();
