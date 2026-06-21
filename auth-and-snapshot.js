// auth-and-snapshot.js
//
// Zero setup. Just run:  node auth-and-snapshot.js
//
// On the first run it asks you for your three Bungie values and saves them to a
// local .env file for you. Then it walks you through a one-time "Authorize" and
// writes your profile to snapshot.json. No npm install, no certificates.
//
// Needs: Node 18 or newer.

import fs from 'node:fs';
import readline from 'node:readline';
import { exec } from 'node:child_process';
import { URL } from 'node:url';

const ENV_FILE = './.env';
const TOKENS_FILE = './tokens.json';
const SNAPSHOT_FILE = './snapshot.json';
const BASE = 'https://www.bungie.net/Platform';

// Broad component set for the diagnostic snapshot:
//   100 Profiles  200 Characters  201 CharacterInventories (pursuits)
//   202 CharacterProgressions  300 ItemInstances  302 ItemObjectives
//   700 PresentationNodes  900 Records (Triumphs/Seals)  1000 Transitory  1400 StringVariables
const COMPONENTS = '100,200,201,202,300,302,700,900,1000,1400';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function parseEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function ensureCreds() {
  const env = parseEnvFile();
  if (env.BUNGIE_API_KEY && env.BUNGIE_CLIENT_ID && env.BUNGIE_CLIENT_SECRET) return env;
  console.log('\nFirst-time setup. Paste the three values from your Bungie app page');
  console.log('(bungie.net/en/Application). They are saved to a local .env file and never committed.\n');
  const BUNGIE_API_KEY = await ask('API Key: ');
  const BUNGIE_CLIENT_ID = await ask('Client ID: ');
  const BUNGIE_CLIENT_SECRET = await ask('Client Secret: ');
  fs.writeFileSync(
    ENV_FILE,
    `BUNGIE_API_KEY=${BUNGIE_API_KEY}\nBUNGIE_CLIENT_ID=${BUNGIE_CLIENT_ID}\nBUNGIE_CLIENT_SECRET=${BUNGIE_CLIENT_SECRET}\n`
  );
  console.log('\nSaved .env locally.\n');
  return { BUNGIE_API_KEY, BUNGIE_CLIENT_ID, BUNGIE_CLIENT_SECRET };
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {}); // best effort; the URL is also printed
}

function tokenAuthHeader(env) {
  const basic = Buffer.from(`${env.BUNGIE_CLIENT_ID}:${env.BUNGIE_CLIENT_SECRET}`).toString('base64');
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-API-Key': env.BUNGIE_API_KEY,
    'Authorization': `Basic ${basic}`,
  };
}

async function postToken(env, params) {
  const res = await fetch(`${BASE}/App/OAuth/Token/`, {
    method: 'POST',
    headers: tokenAuthHeader(env),
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
    refresh_expires_at: Date.now() + (t.refresh_expires_in ?? 7776000) * 1000,
    membership_id: t.membership_id,
  };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
  return data;
}

async function authorize(env) {
  const state = Math.random().toString(36).slice(2);
  const authUrl =
    `https://www.bungie.net/en/OAuth/Authorize?client_id=${env.BUNGIE_CLIENT_ID}` +
    `&response_type=code&state=${state}`;
  console.log('Opening the Bungie authorization page in your browser...');
  console.log('(If it does not open, copy this URL into your browser:)');
  console.log('  ' + authUrl + '\n');
  openBrowser(authUrl);
  console.log('After you click Authorize, your browser will try to reach a 127.0.0.1 address and show');
  console.log('an error like "This site can\'t be reached". That is expected and fine.');
  console.log('Copy the ENTIRE address from the browser address bar and paste it below.\n');
  const pasted = await ask('Paste that address here: ');
  let code = null;
  try { code = new URL(pasted).searchParams.get('code'); } catch { /* handled below */ }
  if (!code) throw new Error('No code found in that address. Re-run and paste the full URL after authorizing.');
  const tok = await postToken(env, { grant_type: 'authorization_code', code });
  console.log('\nAuthorized.\n');
  return saveTokens(tok);
}

async function getValidAccessToken(env) {
  if (!fs.existsSync(TOKENS_FILE)) return (await authorize(env)).access_token;
  const t = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  if (Date.now() < t.refresh_expires_at) {
    console.log('Refreshing access token...');
    return saveTokens(await postToken(env, { grant_type: 'refresh_token', refresh_token: t.refresh_token })).access_token;
  }
  console.log('Saved login expired, re-authorizing...');
  return (await authorize(env)).access_token;
}

async function getJson(url, env, accessToken) {
  const res = await fetch(url, {
    headers: { 'X-API-Key': env.BUNGIE_API_KEY, 'Authorization': `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (json.ErrorCode && json.ErrorCode !== 1) throw new Error(`Bungie error ${json.ErrorCode}: ${json.Message}`);
  return json.Response;
}

async function getPrimaryMembership(env, accessToken) {
  const r = await getJson(`${BASE}/User/GetMembershipsForCurrentUser/`, env, accessToken);
  const memberships = r.destinyMemberships || [];
  if (!memberships.length) throw new Error('No Destiny memberships found on this account.');
  const primaryId = r.primaryMembershipId;
  return (
    memberships.find((m) => m.membershipId === primaryId) ||
    memberships.find((m) => m.crossSaveOverride === 0 || m.crossSaveOverride === m.membershipType) ||
    memberships[0]
  );
}

(async () => {
  try {
    const env = await ensureCreds();
    const accessToken = await getValidAccessToken(env);
    const m = await getPrimaryMembership(env, accessToken);
    console.log(`Destiny account: ${m.displayName} (platform ${m.membershipType}, id ${m.membershipId})`);
    const profile = await getJson(
      `${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${COMPONENTS}`,
      env,
      accessToken
    );
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(profile, null, 2));
    console.log(`Characters found: ${Object.keys(profile.characters?.data || {}).length}`);
    console.log(`\nSaved ${SNAPSHOT_FILE}. Upload that file to Claude.`);
  } catch (e) {
    console.error('\nError:', e.message);
    process.exit(1);
  }
})();
