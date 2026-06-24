// server.js — always-on TRMNL BYOS server for the Destiny 2 dashboard.
//
// Runs on Diego's Windows PC. Every refresh it pulls a fresh Bungie profile,
// builds the screen (reusing render.js), converts it to a 1-bit 800x480 BMP,
// and serves it to the TRMNL device over the BYOS protocol.
//
//   Start:        node server.js
//   Sample data:  set DEMO=1 && node server.js     (Windows: $env:DEMO=1; node server.js)
//   Invert B/W:   via /settings, or set INVERT=1 as the initial default
//   Custom port:  set PORT=3000 && node server.js
//
// Point your TRMNL firmware (Advanced -> Custom Server) at the http://<PC-IP>:<port>
// URL printed on startup. Needs tokens.json (run auth-and-snapshot.js once first).
// Display options live at  http://<PC-IP>:<port>/settings  (saved to config.json).

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
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
const CONFIG_FILE = './config.json';

// ---------------- settings (config.json), edited via the /settings page ----------------
const DEFAULT_CONFIG = { count: 5, descSize: 25, showNumbers: true, invert: INVERT, refreshSeconds: REFRESH_SECONDS };
function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }
function sanitizeConfig(input) {
  const c = loadConfig();
  if (input.count != null) c.count = Math.max(1, Math.min(5, parseInt(input.count, 10) || c.count));
  if (input.descSize != null) c.descSize = Math.max(16, Math.min(36, parseInt(input.descSize, 10) || c.descSize));
  if (input.refreshSeconds != null) c.refreshSeconds = Math.max(15, Math.min(900, parseInt(input.refreshSeconds, 10) || c.refreshSeconds));
  if (input.showNumbers != null) c.showNumbers = input.showNumbers === true || input.showNumbers === 'true' || input.showNumbers === 'on';
  if (input.invert != null) c.invert = input.invert === true || input.invert === 'true' || input.invert === 'on';
  return c;
}
function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => res(b)); }); }

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
// Renders the SVG at SS x resolution, box-averages down to 800x480, then thresholds.
// Supersampling + a slightly high threshold keeps thin text strokes solid instead of
// breaking apart, which is the usual failure mode of hard 1-bit conversion.
const SS = 3;            // supersample factor (3x = render 2400x1440)
const THRESHOLD = 150;   // 0..255; grayscale below this becomes black. Higher = heavier/bolder text.
export function svgToBmp1bit(svg, invert = false) {
  const img = new Resvg(svg, { fitTo: { mode: 'zoom', value: SS }, background: '#ffffff' }).render();
  const sw = img.width, sh = img.height, src = img.pixels;
  const width = Math.round(sw / SS), height = Math.round(sh / SS);
  // downscale to grayscale via box average
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < SS; dy++) {
        const sy = y * SS + dy;
        for (let dx = 0; dx < SS; dx++) {
          const i = (sy * sw + (x * SS + dx)) * 4;
          sum += 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
        }
      }
      gray[y * width + x] = sum / (SS * SS);
    }
  }
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
      let white = gray[y * width + x] >= THRESHOLD;
      if (invert) white = !white;
      if (white) buf[dstRow + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }
  return buf;
}

// ---------------- screen state + render loop ----------------
let state = { bmp: null, filename: 'starting.bmp', svg: '', updated: null, error: null };

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
    const cfg = loadConfig();
    const model = DEMO ? demoModel() : await buildModel(await fetchProfile());
    // The SVG is a deterministic function of what's shown (no clock), so if it's
    // unchanged the screen is unchanged — skip the work and let the panel sleep.
    const svg = renderSVG(model, { count: cfg.count, descSize: cfg.descSize, showNumbers: cfg.showNumbers });
    const ts = new Date().toLocaleTimeString();
    if (svg !== state.svg || !state.bmp) {
      state.bmp = svgToBmp1bit(svg, cfg.invert);
      state.svg = svg;
      state.filename = `d2-${Date.now()}.bmp`;
      console.log(`[${ts}] orders changed -> ${state.filename} (${Math.min(cfg.count, model.orders.length)} of ${model.orders.length} orders); panel will redraw`);
    } else {
      console.log(`[${ts}] no change; panel stays asleep`);
    }
    state.updated = new Date(); state.error = null;
  } catch (e) {
    state.error = e.message;
    console.error('refresh error:', e.message);
    if (!state.bmp) { state.bmp = svgToBmp1bit(placeholderSvg(e.message), loadConfig().invert); state.filename = `setup-${Date.now()}.bmp`; }
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
  const cfg = loadConfig();
  return `<!doctype html><meta charset="utf-8"><title>Destiny 2 TRMNL</title>`
    + `<body style="font-family:Arial,Helvetica,sans-serif;margin:24px">`
    + `<h2>Destiny 2 TRMNL dashboard</h2>`
    + `<p>Last render: <b>${upd}</b> &middot; file: <code>${state.filename}</code>`
    + `${state.error ? ` &middot; <span style="color:#b00">error: ${state.error}</span>` : ''}</p>`
    + `<p>Showing ${cfg.count} orders &middot; refresh ${cfg.refreshSeconds}s${DEMO ? ' &middot; <b>DEMO mode</b>' : ''} &middot; <a href="/settings">Settings</a></p>`
    + `<img src="/screen.bmp?t=${Date.now()}" width="800" height="480" style="border:1px solid #ccc">`
    + `</body>`;
}

function settingsPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Destiny 2 TRMNL — Settings</title><style>`
    + `body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f4f5;color:#111}`
    + `.wrap{max-width:560px;margin:0 auto;padding:24px}`
    + `h1{font-size:20px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin:0 0 20px}`
    + `.card{background:#fff;border:1px solid #e2e2e5;border-radius:10px;padding:18px 20px;margin-bottom:16px}`
    + `label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}label:first-child{margin-top:0}`
    + `select,input[type=number]{width:100%;padding:9px;font-size:15px;border:1px solid #ccc;border-radius:7px;box-sizing:border-box}`
    + `.row{display:flex;align-items:center;gap:10px;margin:14px 0}.row input{width:auto}.row label{margin:0;font-weight:600}`
    + `button{width:100%;padding:12px;font-size:16px;font-weight:700;color:#fff;background:#111;border:0;border-radius:8px;cursor:pointer;margin-top:8px}`
    + `button:disabled{opacity:.5}.msg{text-align:center;font-size:14px;color:#137333;height:18px;margin-top:10px}`
    + `a{color:#111}.preview img{width:100%;border:1px solid #ddd;border-radius:8px;margin-top:8px}`
    + `</style></head><body><div class="wrap">`
    + `<h1>Destiny 2 TRMNL — Settings</h1><p class="sub">Changes apply on the next refresh. <a href="/">Back to status</a></p>`
    + `<div class="card">`
    + `<label for="count">Number of orders on screen</label>`
    + `<select id="count"><option value="3">3</option><option value="4">4</option><option value="5">5</option></select>`
    + `<label for="descSize">Description text size</label>`
    + `<select id="descSize"><option value="22">Small</option><option value="25">Medium</option><option value="28">Large</option><option value="32">Extra large</option></select>`
    + `<label for="refreshSeconds">Refresh interval (seconds)</label>`
    + `<select id="refreshSeconds"><option value="30">30</option><option value="60">60</option><option value="120">120</option><option value="300">300</option><option value="600">600</option></select>`
    + `<div class="row"><input type="checkbox" id="showNumbers"><label for="showNumbers">Show raw progress numbers (e.g. 493k/500k)</label></div>`
    + `<div class="row"><input type="checkbox" id="invert"><label for="invert">Invert colors (only if the panel shows white-on-black)</label></div>`
    + `<button id="save">Save settings</button><div class="msg" id="msg"></div>`
    + `</div>`
    + `<div class="card preview"><label>Live preview</label><img id="pv" src="/screen.bmp?t=0"></div>`
    + `</div><script>`
    + `var $=function(id){return document.getElementById(id)};`
    + `function load(){fetch('/api/config').then(function(r){return r.json()}).then(function(c){`
    + `$('count').value=c.count;$('descSize').value=c.descSize;$('refreshSeconds').value=c.refreshSeconds;`
    + `$('showNumbers').checked=!!c.showNumbers;$('invert').checked=!!c.invert;})}`
    + `function bump(){$('pv').src='/screen.bmp?t='+Date.now()}`
    + `$('save').onclick=function(){var btn=$('save');btn.disabled=true;$('msg').textContent='Saving…';`
    + `var body={count:$('count').value,descSize:$('descSize').value,refreshSeconds:$('refreshSeconds').value,showNumbers:$('showNumbers').checked,invert:$('invert').checked};`
    + `fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})`
    + `.then(function(r){return r.json()}).then(function(){$('msg').textContent='Saved \u2713';btn.disabled=false;setTimeout(bump,400)})`
    + `.catch(function(){$('msg').textContent='Save failed';btn.disabled=false})};`
    + `load();setInterval(bump,15000);`
    + `</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const path = (new URL(req.url, 'http://x').pathname).replace(/\/+$/, '') || '/';
  if (path === '/screen.bmp' || path === '/setup.bmp') {
    if (!state.bmp) { res.writeHead(503); return res.end('not ready'); }
    res.writeHead(200, { 'Content-Type': 'image/bmp', 'Content-Length': state.bmp.length, 'Cache-Control': 'no-cache' });
    return res.end(state.bmp);
  }
  if (path === '/api/display') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 0, image_url: imageUrl(req), filename: state.filename, refresh_rate: String(loadConfig().refreshSeconds), update_firmware: false, firmware_url: null, reset_firmware: false }));
  }
  if (path === '/api/setup') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 200, api_key: 'destiny-trmnl', friendly_id: 'DSTNY', image_url: imageUrl(req, 'setup.bmp'), message: 'Welcome to the Destiny 2 dashboard' }));
  }
  if (path === '/api/log') { res.writeHead(204); return res.end(); }
  if (path === '/api/config') {
    if (req.method === 'POST') {
      let input = {};
      try { input = JSON.parse(await readBody(req) || '{}'); } catch { input = {}; }
      const cfg = sanitizeConfig(input);
      saveConfig(cfg);
      await refresh(); // apply immediately so the panel/preview update now
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, config: cfg }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(loadConfig()));
  }
  if (path === '/settings') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(settingsPage()); }
  if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(statusPage()); }
  res.writeHead(404); res.end('not found');
});

async function start() {
  await refresh();
  // self-scheduling loop so a changed refresh interval (from settings) takes effect
  const tick = async () => { await refresh(); setTimeout(tick, (loadConfig().refreshSeconds || 60) * 1000); };
  setTimeout(tick, (loadConfig().refreshSeconds || 60) * 1000);
  server.listen(PORT, () => {
    console.log('\nDestiny 2 TRMNL BYOS server running.');
    const ips = lanIps();
    if (ips.length) for (const ip of ips) console.log(`  TRMNL "Custom Server" URL:  http://${ip}:${PORT}`);
    else console.log(`  (no LAN IP detected) local URL:  http://localhost:${PORT}`);
    console.log(`  Browser preview + settings: http://localhost:${PORT}/  and  /settings`);
    if (DEMO) console.log('  DEMO mode: serving sample data (no Bungie call).');
    console.log('');
  });
}

// Start only when run directly, so svgToBmp1bit can be imported without side effects.
if (process.argv[1] && /server\.js$/.test(process.argv[1].replace(/\\/g, '/'))) {
  start();
}
