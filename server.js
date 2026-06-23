// server.js — always-on TRMNL BYOS server for the Destiny 2 dashboard.
//
// Runs on Diego's Windows PC. Every REFRESH_SECONDS it pulls a fresh Bungie
// profile, builds the screen (reusing render.js), converts it to a 1-bit 800x480
// BMP, and serves it to the TRMNL device over the BYOS protocol.
//
//   Start:        node server.js
//   Sample data:  set DEMO=1 && node server.js     (Windows: $env:DEMO=1; node server.js)
//   Invert B/W:   set INVERT=1 && node server.js   (only if the panel shows inverted)
//   Custom port:  set PORT=3000 && node server.js
//
// Point your TRMNL firmware (Advanced -> Custom Server) at the http://<PC-IP>:<port>
// URL printed on startup. Needs tokens.json (run auth-and-snapshot.js once first).

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { buildModel, renderSVG } from './render.js';

const PORT = Number(process.env.PORT || 3000);
const REFRESH_SECONDS = Number(process.env.REFRESH_SECONDS || 60);
const DEMO = process.env.DEMO === '1';
const INVERT = process.env.INVERT === '1';
const BASE = 'https://www.bungie.net/Platform';
const ENV_FILE = './.env';
const TOKENS_FILE = './tokens.json';
const COMPONENTS = '100,102,103,104,200,201,202,204,205,206,300,301,302,303,304,305,307,308,309,310,700,800,900,1000,1100,1200,1400';
const W = 800, H = 480;

// ---------------- Bungie auth + fetch (non-interactive; mirrors auth-and-snapshot.js) ----------------
function parseEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function tokenAuthHeader(env) {
  const basic = Buffer.from(`${env.BUNGIE_CLIENT_ID}:${env.BUNGIE_CLIENT_SECRET}`).toString('base64');
  return { 'Content-Type': 'application/x-www-form-urlencoded', 'X-API-Key': env.BUNGIE_API_KEY, Authorization: `Basic ${basic}` };
}
async function postToken(env, params) {
  const res = await fetch(`${BASE}/App/OAuth/Token/`, { method: 'POST', headers: tokenAuthHeader(env), body: new URLSearchParams(params) });
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
async function getValidAccessToken(env) {
  if (!fs.existsSync(TOKENS_FILE)) throw new Error('No tokens.json yet — run once:  node auth-and-snapshot.js');
  const t = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  if (Date.now() < t.refresh_expires_at) return saveTokens(await postToken(env, { grant_type: 'refresh_token', refresh_token: t.refresh_token })).access_token;
  throw new Error('Saved login expired — run:  node auth-and-snapshot.js reauth');
}
async function getJson(url, env, token) {
  const res = await fetch(url, { headers: { 'X-API-Key': env.BUNGIE_API_KEY, Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (json.ErrorCode && json.ErrorCode !== 1) throw new Error(`Bungie error ${json.ErrorCode}: ${json.Message}`);
  return json.Response;
}
async function getPrimaryMembership(env, token) {
  const r = await getJson(`${BASE}/User/GetMembershipsForCurrentUser/`, env, token);
  const ms = r.destinyMemberships || [];
  if (!ms.length) throw new Error('No Destiny memberships found.');
  return ms.find((m) => m.membershipId === r.primaryMembershipId)
    || ms.find((m) => m.crossSaveOverride === 0 || m.crossSaveOverride === m.membershipType)
    || ms[0];
}
async function fetchProfile() {
  const env = parseEnvFile();
  if (!env.BUNGIE_API_KEY) throw new Error('Missing BUNGIE_API_KEY in .env');
  const token = await getValidAccessToken(env);
  const m = await getPrimaryMembership(env, token);
  return getJson(`${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${COMPONENTS}`, env, token);
}

// ---------------- 1-bit BMP encoder (standard BMP3, bottom-up, palette black/white) ----------------
export function svgToBmp1bit(svg, invert = false) {
  const img = new Resvg(svg, { fitTo: { mode: 'original' }, background: '#ffffff' }).render();
  const { width, height, pixels } = img;
  const rowBytes = Math.ceil(width / 8);
  const stride = rowBytes + ((4 - (rowBytes % 4)) % 4); // rows padded to 4 bytes
  const pixelArraySize = stride * height;
  const offset = 14 + 40 + 8; // file header + info header + 2-color palette
  const fileSize = offset + pixelArraySize;
  const buf = Buffer.alloc(fileSize);
  let o = 0;
  // BITMAPFILEHEADER
  buf.write('BM', o); o += 2;
  buf.writeUInt32LE(fileSize, o); o += 4;
  buf.writeUInt32LE(0, o); o += 4;
  buf.writeUInt32LE(offset, o); o += 4;
  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, o); o += 4;
  buf.writeInt32LE(width, o); o += 4;
  buf.writeInt32LE(height, o); o += 4;     // positive = bottom-up
  buf.writeUInt16LE(1, o); o += 2;          // planes
  buf.writeUInt16LE(1, o); o += 2;          // bits per pixel
  buf.writeUInt32LE(0, o); o += 4;          // BI_RGB (uncompressed)
  buf.writeUInt32LE(pixelArraySize, o); o += 4;
  buf.writeInt32LE(2835, o); o += 4;        // ~72 DPI
  buf.writeInt32LE(2835, o); o += 4;
  buf.writeUInt32LE(2, o); o += 4;          // colors used
  buf.writeUInt32LE(0, o); o += 4;
  // palette: index0 = black, index1 = white (BGRA)
  buf[o++] = 0; buf[o++] = 0; buf[o++] = 0; buf[o++] = 0;
  buf[o++] = 255; buf[o++] = 255; buf[o++] = 255; buf[o++] = 0;
  // pixels: bit=1 -> white (index 1), bit=0 -> black (index 0); bottom-up rows
  for (let y = 0; y < height; y++) {
    const dstRow = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      let white = lum >= 128;
      if (invert) white = !white;
      if (white) buf[dstRow + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }
  return buf;
}

// ---------------- screen state + render loop ----------------
let state = { bmp: null, filename: 'starting.bmp', hash: '', updated: null, error: null };

function demoModel() {
  return {
    character: { name: 'Warlock', light: 2010 },
    orders: [
      { name: "Micah-10's Training", type: '', desc: 'Create orbs and apply buffs to your fireteam (Cure, Restoration, Woven Mail, Invisibility, Overshield).', label: 'Progress', tier: { name: 'Exotic', kind: 'exotic' }, p: { prog: 2760000, total: 5000000, frac: 0.552, complete: false }, tracked: false },
      { name: 'Full Auto', type: 'Gunsmith Order', desc: 'Defeat combatants or Guardians with Auto Rifles, SMGs, Trace Rifles, or Machine Guns.', label: 'final blows', tier: { name: 'Common', kind: 'common' }, p: { prog: 493000, total: 500000, frac: 0.986, complete: false }, tracked: true },
      { name: 'Weak Spot', type: 'Foundry Order', desc: 'Defeat combatants or Guardians with precision damage.', label: 'Precision', tier: { name: 'Common', kind: 'common' }, p: { prog: 49500, total: 250000, frac: 0.198, complete: false }, tracked: false },
      { name: 'Special Cases', type: 'Gunsmith Order', desc: 'Defeat combatants or Guardians with special-ammo weapons.', label: 'Special ammo weapon', tier: { name: 'Legendary', kind: 'legendary' }, p: { prog: 71000, total: 350000, frac: 0.203, complete: false }, tracked: false },
      { name: 'Close Comfort', type: 'Gunsmith Order', desc: 'Defeat combatants or Guardians at close range.', label: '', tier: { name: 'Common', kind: 'common' }, p: { prog: 12000, total: 90000, frac: 0.133, complete: false }, tracked: false },
    ],
    summary: { questCount: 18, conqFrac: 0.47, sealsInProgress: 4, triumph: null },
    now: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

function placeholderSvg(msg) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#fff"/>`
    + `<text x="40" y="220" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="600" fill="#000">Destiny 2 dashboard</text>`
    + `<text x="40" y="262" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#333">Waiting for data: ${esc(msg)}</text>`
    + `<text x="40" y="292" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#333">Run  node auth-and-snapshot.js  once, then restart the server.</text>`
    + `</svg>`;
}

async function refresh() {
  try {
    const model = DEMO ? demoModel() : await buildModel(await fetchProfile());
    const bmp = svgToBmp1bit(renderSVG(model), INVERT);
    const hash = crypto.createHash('md5').update(bmp).digest('hex').slice(0, 10);
    if (hash !== state.hash) { state.bmp = bmp; state.hash = hash; state.filename = `d2-${Date.now()}.bmp`; }
    state.updated = new Date(); state.error = null;
    console.log(`[${state.updated.toLocaleTimeString()}] rendered ${state.filename} (${bmp.length} bytes, ${model.orders.length} orders)`);
  } catch (e) {
    state.error = e.message;
    console.error('refresh error:', e.message);
    if (!state.bmp) { state.bmp = svgToBmp1bit(placeholderSvg(e.message), INVERT); state.filename = `setup-${Date.now()}.bmp`; }
  }
}

// ---------------- HTTP (TRMNL BYOS protocol) ----------------
function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  return out;
}
function imageUrl(req, name = 'screen.bmp') {
  const host = req.headers.host || `${lanIps()[0] || 'localhost'}:${PORT}`;
  return `http://${host}/${name}`;
}
function statusPage() {
  const upd = state.updated ? state.updated.toLocaleString() : 'never';
  return `<!doctype html><meta charset="utf-8"><title>Destiny 2 TRMNL</title>`
    + `<body style="font-family:Arial,Helvetica,sans-serif;margin:24px">`
    + `<h2>Destiny 2 TRMNL dashboard</h2>`
    + `<p>Last render: <b>${upd}</b> &middot; file: <code>${state.filename}</code>`
    + `${state.error ? ` &middot; <span style=\"color:#b00\">error: ${state.error}</span>` : ''}</p>`
    + `<p>Refresh rate: ${REFRESH_SECONDS}s${DEMO ? ' &middot; <b>DEMO mode</b>' : ''}</p>`
    + `<img src="/screen.bmp?t=${Date.now()}" width="800" height="480" style="border:1px solid #ccc">`
    + `</body>`;
}

const server = http.createServer((req, res) => {
  const path = (new URL(req.url, 'http://x').pathname).replace(/\/+$/, '') || '/';
  if (path === '/screen.bmp' || path === '/setup.bmp') {
    if (!state.bmp) { res.writeHead(503); return res.end('not ready'); }
    res.writeHead(200, { 'Content-Type': 'image/bmp', 'Content-Length': state.bmp.length, 'Cache-Control': 'no-cache' });
    return res.end(state.bmp);
  }
  if (path === '/api/display') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 0, image_url: imageUrl(req), filename: state.filename, refresh_rate: String(REFRESH_SECONDS), update_firmware: false, firmware_url: null, reset_firmware: false }));
  }
  if (path === '/api/setup') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 200, api_key: 'destiny-trmnl', friendly_id: 'DSTNY', image_url: imageUrl(req, 'setup.bmp'), message: 'Welcome to the Destiny 2 dashboard' }));
  }
  if (path === '/api/log') { res.writeHead(204); return res.end(); }
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(statusPage()); }
  res.writeHead(404); res.end('not found');
});

async function start() {
  await refresh();
  setInterval(refresh, REFRESH_SECONDS * 1000);
  server.listen(PORT, () => {
    console.log('\nDestiny 2 TRMNL BYOS server running.');
    const ips = lanIps();
    if (ips.length) for (const ip of ips) console.log(`  TRMNL "Custom Server" URL:  http://${ip}:${PORT}`);
    else console.log(`  (no LAN IP detected) local URL:  http://localhost:${PORT}`);
    console.log(`  Browser preview:            http://localhost:${PORT}/`);
    if (DEMO) console.log('  DEMO mode: serving sample data (no Bungie call).');
    console.log('');
  });
}

// Start only when run directly, so svgToBmp1bit can be imported without side effects.
if (process.argv[1] && /server\.js$/.test(process.argv[1].replace(/\\/g, '/'))) {
  start();
}
