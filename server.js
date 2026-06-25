// server.js — always-on TRMNL BYOS server for the Destiny 2 dashboard.
//
// Pulls a fresh Bungie profile, builds the model (render.js), picks the CURRENT
// page from the rotation, renders it to a 1-bit 800x480 BMP, and serves it over BYOS.
// The panel rotates through the pages you enable in /settings (the content picker).
//
//   Start:        node server.js
//   Sample data:  set DEMO=1 && node server.js     (Windows: $env:DEMO=1; node server.js)
//   Custom port:  set PORT=3000 && node server.js
//
// Point TRMNL firmware (Advanced -> Custom Server) at the http://<PC-IP>:<port> URL
// printed on startup (plain http, no trailing slash). Needs tokens.json (run
// auth-and-snapshot.js once first). Content picker: http://<PC-IP>:<port>/settings

import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import { URL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { buildModel, renderPage } from './render.js';

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

// ---------------- settings (config.json) — the content picker / pages model ----------------
const PAGE_TYPES = ['orders', 'quests', 'triumphs', 'title'];
const PAGE_LABEL = { orders: 'Orders', quests: 'Quests & Bounties', triumphs: 'Triumphs', title: 'Title / Seal' };
function defaultPages() {
  return [
    { type: 'orders', enabled: true, rarities: ['common', 'legendary', 'exotic'] },
    { type: 'quests', enabled: false, count: 4 },
    { type: 'triumphs', enabled: false, count: 6 },
    { type: 'title', enabled: false, sealHash: null },
  ];
}
const DEFAULT_CONFIG = { rotationSeconds: 30, refreshSeconds: REFRESH_SECONDS, invert: INVERT, descSize: 25, count: 5, showNumbers: true, pages: defaultPages() };

function loadConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { raw = {}; }
  const c = { ...DEFAULT_CONFIG, ...raw };
  // migrate the old layout-only config (no pages[]) to a single Orders page
  if (!Array.isArray(raw.pages)) c.pages = defaultPages();
  return c;
}
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }
const enabledPages = (c) => (c.pages || []).filter((p) => p && p.enabled !== false && PAGE_TYPES.includes(p.type));

function sanitizeConfig(input) {
  const c = loadConfig();
  const num = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
  const bool = (v) => v === true || v === 'true' || v === 'on';
  if (input.rotationSeconds != null) c.rotationSeconds = input.rotationSeconds === 0 || input.rotationSeconds === '0' ? 0 : num(input.rotationSeconds, 10, 1800, c.rotationSeconds);
  if (input.refreshSeconds != null) c.refreshSeconds = num(input.refreshSeconds, 15, 1800, c.refreshSeconds);
  if (input.descSize != null) c.descSize = num(input.descSize, 16, 36, c.descSize);
  if (input.count != null) c.count = num(input.count, 1, 5, c.count);
  if (input.showNumbers != null) c.showNumbers = bool(input.showNumbers);
  if (input.invert != null) c.invert = bool(input.invert);
  if (Array.isArray(input.pages)) {
    const byType = {};
    for (const p of input.pages) if (p && PAGE_TYPES.includes(p.type)) byType[p.type] = p;
    // rebuild in canonical order, validating each type's options
    c.pages = PAGE_TYPES.map((type) => {
      const cur = (c.pages || []).find((p) => p.type === type) || {};
      const inp = byType[type] || {};
      const page = { type, enabled: inp.enabled != null ? bool(inp.enabled) : cur.enabled !== false };
      if (type === 'orders') {
        const allowed = ['common', 'legendary', 'exotic'];
        let r = Array.isArray(inp.rarities) ? inp.rarities.filter((x) => allowed.includes(x)) : (cur.rarities || allowed);
        if (!r.length) r = allowed;
        page.rarities = r;
      } else if (type === 'quests') page.count = num(inp.count, 3, 5, cur.count || 4);
      else if (type === 'triumphs') page.count = num(inp.count, 3, 8, cur.count || 6);
      else if (type === 'title') page.sealHash = inp.sealHash ? String(inp.sealHash) : null;
      return page;
    });
  }
  return c;
}
function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => res(b)); }); }

// ---------------- Bungie auth + fetch (non-interactive; mirrors auth-and-snapshot.js) ----------------
function parseEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2]; }
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
  const data = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000, refresh_expires_at: Date.now() + (t.refresh_expires_in ?? 7776000) * 1000, membership_id: t.membership_id };
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
  return ms.find((m) => m.membershipId === r.primaryMembershipId) || ms.find((m) => m.crossSaveOverride === 0 || m.crossSaveOverride === m.membershipType) || ms[0];
}
async function fetchProfile() {
  const env = parseEnvFile();
  if (!env.BUNGIE_API_KEY) throw new Error('Missing BUNGIE_API_KEY in .env');
  const token = await getValidAccessToken(env);
  const m = await getPrimaryMembership(env, token);
  return getJson(`${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${COMPONENTS}`, env, token);
}

// ---------------- 1-bit BMP encoder (SS=3 box-average + threshold; BMP3 bottom-up) ----------------
const SS = 3, THRESHOLD = 150;
export function svgToBmp1bit(svg, invert = false) {
  const img = new Resvg(svg, { fitTo: { mode: 'zoom', value: SS }, background: '#ffffff' }).render();
  const sw = img.width, sh = img.height, src = img.pixels;
  const width = Math.round(sw / SS), height = Math.round(sh / SS);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = 0; dy < SS; dy++) { const sy = y * SS + dy; for (let dx = 0; dx < SS; dx++) { const i = (sy * sw + (x * SS + dx)) * 4; sum += 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]; } }
    gray[y * width + x] = sum / (SS * SS);
  }
  const rowBytes = Math.ceil(width / 8), stride = rowBytes + ((4 - (rowBytes % 4)) % 4);
  const pixelArraySize = stride * height, offset = 14 + 40 + 8, fileSize = offset + pixelArraySize;
  const buf = Buffer.alloc(fileSize); let o = 0;
  buf.write('BM', o); o += 2; buf.writeUInt32LE(fileSize, o); o += 4; buf.writeUInt32LE(0, o); o += 4; buf.writeUInt32LE(offset, o); o += 4;
  buf.writeUInt32LE(40, o); o += 4; buf.writeInt32LE(width, o); o += 4; buf.writeInt32LE(height, o); o += 4; buf.writeUInt16LE(1, o); o += 2; buf.writeUInt16LE(1, o); o += 2;
  buf.writeUInt32LE(0, o); o += 4; buf.writeUInt32LE(pixelArraySize, o); o += 4; buf.writeInt32LE(2835, o); o += 4; buf.writeInt32LE(2835, o); o += 4; buf.writeUInt32LE(2, o); o += 4; buf.writeUInt32LE(0, o); o += 4;
  buf[o++] = 0; buf[o++] = 0; buf[o++] = 0; buf[o++] = 0; buf[o++] = 255; buf[o++] = 255; buf[o++] = 255; buf[o++] = 0;
  for (let y = 0; y < height; y++) { const dstRow = offset + (height - 1 - y) * stride; for (let x = 0; x < width; x++) { let white = gray[y * width + x] >= THRESHOLD; if (invert) white = !white; if (white) buf[dstRow + (x >> 3)] |= (0x80 >> (x & 7)); } }
  return buf;
}

// ---------------- screen state + model cache + render loop ----------------
let state = { bmp: null, filename: 'starting.bmp', svg: '', pageIndex: -1, updated: null, error: null };
let lastModel = null, lastModelAt = 0;

function demoModel() {
  return {
    character: { name: 'Warlock', light: 2010 },
    orders: [
      { name: "Micah-10's Training", desc: 'Create orbs and apply buffs to your fireteam (Cure, Restoration, Woven Mail, Invisibility, Overshield).', tier: { name: 'Exotic', kind: 'exotic' }, p: { prog: 2760000, total: 5000000, frac: 0.552 }, tracked: false },
      { name: 'Full Auto', desc: 'Defeat combatants or Guardians with Auto Rifles, SMGs, Trace Rifles, or Machine Guns.', tier: { name: 'Common', kind: 'common' }, p: { prog: 493000, total: 500000, frac: 0.986 }, tracked: true },
      { name: 'Weak Spot', desc: 'Defeat combatants or Guardians with precision damage.', tier: { name: 'Common', kind: 'common' }, p: { prog: 49500, total: 250000, frac: 0.198 }, tracked: false },
      { name: 'Special Cases', desc: 'Defeat combatants or Guardians with special-ammo weapons.', tier: { name: 'Legendary', kind: 'legendary' }, p: { prog: 71000, total: 350000, frac: 0.203 }, tracked: false },
      { name: 'Close Comfort', desc: 'Defeat combatants or Guardians at close range.', tier: { name: 'Common', kind: 'common' }, p: { prog: 12000, total: 90000, frac: 0.133 }, tracked: false },
    ],
    quests: [
      { name: 'Exotic Quest: The Final Strand', step: 3, steps: 5, objective: 'Travel to Neomuna and recover the lost cache from the Vex network.', p: { frac: 0.6 }, tracked: true },
      { name: 'Seasonal: Echoes Act II', step: 2, steps: 4, objective: 'Speak with the Drifter, then complete the weekly story mission.', p: { frac: 0.5 }, tracked: false },
      { name: 'Gunsmith Bounty: Precision', steps: 0, objective: 'Defeat combatants with precision final blows.', p: { prog: 60, total: 100, frac: 0.6 }, tracked: false },
      { name: 'Catalyst: Outbreak Perfected', steps: 0, objective: 'Defeat 250 combatants with the weapon equipped.', p: { prog: 82, total: 250, frac: 0.328 }, tracked: false },
    ],
    triumphs: [
      { name: 'Flawless Raider', desc: 'Complete a raid without any deaths.', frac: 0, p: { prog: 0, total: 1 }, tracked: true },
      { name: 'Master of All', desc: 'Reach max level on all subclasses.', frac: 0.78, p: { prog: 7, total: 9 } },
      { name: 'Crucible Legend', desc: 'Reach Legend rank in Competitive.', frac: 0.764, p: { prog: 4200, total: 5500 } },
      { name: 'Dungeon Conqueror', desc: 'Solo-flawless any dungeon.', frac: 0.333, p: { prog: 1, total: 3 } },
      { name: 'Lost Sector Master', desc: 'Clear every Master Lost Sector.', frac: 0.785, p: { prog: 11, total: 14 } },
      { name: 'Vanguard Devotee', desc: 'Earn Vanguard reputation resets.', frac: 0.4, p: { prog: 2, total: 5 } },
    ],
    seals: [
      { hash: '111', title: 'Conqueror', subtitle: 'Master of Grandmaster Nightfalls', frac: 0.72, done: 13, totalReq: 18, gilded: 2, remaining: [
        { name: 'Grandmaster: Liminality', frac: 0.5 }, { name: 'Grandmaster: Proving Grounds', frac: 0 }, { name: 'Platinum Rewards x10', frac: 0.7 }, { name: 'Champion Slayer', frac: 0.85 }, { name: 'No Time to Explain', frac: 0.2 },
      ] },
      { hash: '222', title: 'Splintered', subtitle: 'Echoes Seal', frac: 0.45, done: 9, totalReq: 20, gilded: 0, remaining: [{ name: 'Weekly Story x6', frac: 0.5 }, { name: 'Public Events x20', frac: 0.3 }] },
    ],
    summary: { questCount: 4, conqFrac: 0.72, sealsInProgress: 2, triumph: 'Flawless Raider' },
    now: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

function placeholderSvg(msg) {
  const e = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`
    + `<text x="40" y="220" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="600" fill="#000">Destiny 2 dashboard</text>`
    + `<text x="40" y="262" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#333">Waiting for data: ${e(msg)}</text>`
    + `<text x="40" y="292" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#333">Run  node auth-and-snapshot.js  once, then restart the server.</text></svg>`;
}

async function getModel(cfg) {
  const now = Date.now();
  if (!lastModel || now - lastModelAt >= cfg.refreshSeconds * 1000 - 500) {
    lastModel = DEMO ? demoModel() : await buildModel(await fetchProfile());
    lastModelAt = now;
  }
  return lastModel;
}
function pickPageIndex(cfg) {
  const ps = enabledPages(cfg);
  if (ps.length <= 1 || !cfg.rotationSeconds) return 0;
  return Math.floor(Date.now() / 1000 / cfg.rotationSeconds) % ps.length;
}

async function refresh() {
  try {
    const cfg = loadConfig();
    const model = await getModel(cfg);
    const ps = enabledPages(cfg);
    const page = ps.length ? ps[Math.min(pickPageIndex(cfg), ps.length - 1)] : { type: 'orders', rarities: ['common', 'legendary', 'exotic'] };
    const idx = ps.length ? Math.min(pickPageIndex(cfg), ps.length - 1) : 0;
    const svg = renderPage(model, page, { count: cfg.count, descSize: cfg.descSize, showNumbers: cfg.showNumbers });
    const ts = new Date().toLocaleTimeString();
    if (svg !== state.svg || idx !== state.pageIndex || !state.bmp) {
      state.bmp = svgToBmp1bit(svg, cfg.invert);
      state.svg = svg; state.pageIndex = idx;
      state.filename = `d2-${Date.now()}.bmp`;
      console.log(`[${ts}] page ${idx + 1}/${ps.length || 1} (${page.type}) changed -> ${state.filename}; panel will redraw`);
    } else {
      console.log(`[${ts}] page ${idx + 1}/${ps.length || 1} (${page.type}) unchanged; panel stays asleep`);
    }
    state.updated = new Date(); state.error = null;
  } catch (e) {
    state.error = e.message;
    console.error('refresh error:', e.message);
    if (!state.bmp) { state.bmp = svgToBmp1bit(placeholderSvg(e.message), loadConfig().invert); state.filename = `setup-${Date.now()}.bmp`; }
  }
}

// ---------------- HTTP (TRMNL BYOS protocol) ----------------
function lanIps() { const out = []; for (const list of Object.values(os.networkInterfaces())) for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address); return out; }
function imageUrl(req, name = 'screen.bmp') { const host = req.headers.host || `${lanIps()[0] || 'localhost'}:${PORT}`; return `http://${host}/${name}`; }
function refreshRate(cfg) { const rotating = cfg.rotationSeconds > 0 && enabledPages(cfg).length > 1; return String(rotating ? Math.min(cfg.refreshSeconds, cfg.rotationSeconds) : cfg.refreshSeconds); }

// options for the settings picker (names only — no hashes for the user to touch)
function optionsPayload() {
  const m = lastModel || {};
  return {
    seals: (m.seals || []).map((s) => ({ hash: s.hash, title: s.title, pct: Math.round((s.frac || 0) * 100) })),
    counts: { orders: (m.orders || []).length, quests: (m.quests || []).length, triumphs: (m.triumphs || []).length, seals: (m.seals || []).length },
    demo: DEMO,
  };
}

function statusPage() {
  const upd = state.updated ? state.updated.toLocaleString() : 'never';
  const cfg = loadConfig();
  const ps = enabledPages(cfg);
  const rot = cfg.rotationSeconds && ps.length > 1 ? `rotating every ${cfg.rotationSeconds}s` : 'single page';
  const pagesTxt = ps.length ? ps.map((p) => PAGE_LABEL[p.type]).join(' \u2192 ') : 'none enabled';
  return `<!doctype html><meta charset="utf-8"><title>Destiny 2 TRMNL</title><body style="font-family:Arial,Helvetica,sans-serif;margin:24px">`
    + `<h2>Destiny 2 TRMNL dashboard</h2>`
    + `<p>Last render: <b>${upd}</b> &middot; file: <code>${state.filename}</code>${state.error ? ` &middot; <span style="color:#b00">error: ${state.error}</span>` : ''}</p>`
    + `<p>Pages: <b>${pagesTxt}</b> &middot; ${rot}${DEMO ? ' &middot; <b>DEMO mode</b>' : ''} &middot; <a href="/settings">Settings</a></p>`
    + `<img src="/screen.bmp?t=${Date.now()}" width="800" height="480" style="border:1px solid #ccc">`
    + `</body>`;
}

function settingsPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Destiny 2 TRMNL — Content</title><style>`
    + `body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f4f5;color:#111}`
    + `.wrap{max-width:600px;margin:0 auto;padding:24px}`
    + `h1{font-size:20px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin:0 0 20px}`
    + `.card{background:#fff;border:1px solid #e2e2e5;border-radius:10px;padding:16px 18px;margin-bottom:14px}`
    + `.pg{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px}`
    + `.pg .cnt{margin-left:auto;font-weight:400;font-size:12px;color:#888}`
    + `.opts{margin:12px 0 0;padding:12px 0 0;border-top:1px solid #eee;display:none}`
    + `.opts.show{display:block}`
    + `label{font-size:14px}.lbl{display:block;font-weight:600;font-size:13px;margin:10px 0 5px}`
    + `select,input[type=number]{width:100%;padding:9px;font-size:15px;border:1px solid #ccc;border-radius:7px;box-sizing:border-box}`
    + `.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{display:flex;align-items:center;gap:6px;border:1px solid #ccc;border-radius:20px;padding:6px 12px;font-size:14px}`
    + `.row{display:flex;align-items:center;gap:10px;margin:10px 0}.row label{font-weight:600}`
    + `button{width:100%;padding:13px;font-size:16px;font-weight:700;color:#fff;background:#111;border:0;border-radius:8px;cursor:pointer;margin-top:6px}`
    + `button:disabled{opacity:.5}.msg{text-align:center;font-size:14px;color:#137333;height:18px;margin-top:10px}`
    + `a{color:#111}.preview img{width:100%;border:1px solid #ddd;border-radius:8px;margin-top:8px}`
    + `</style></head><body><div class="wrap">`
    + `<h1>Destiny 2 TRMNL — Content</h1><p class="sub">Pick what shows and how pages rotate. Changes apply on the next refresh. <a href="/">Back</a></p>`
    + `<div class="card"><div class="lbl">Page rotation</div>`
    + `<select id="rotationSeconds"><option value="0">Off — single page</option><option value="15">Every 15s</option><option value="30">Every 30s</option><option value="60">Every 60s</option><option value="120">Every 2 min</option><option value="300">Every 5 min</option></select>`
    + `<div class="lbl">Data refresh (Bungie poll)</div>`
    + `<select id="refreshSeconds"><option value="30">30s</option><option value="60">60s</option><option value="120">2 min</option><option value="300">5 min</option><option value="600">10 min</option></select>`
    + `<div class="lbl">Description text size</div>`
    + `<select id="descSize"><option value="22">Small</option><option value="25">Medium</option><option value="28">Large</option><option value="32">Extra large</option></select>`
    + `<div class="row"><input type="checkbox" id="showNumbers"><label for="showNumbers">Show raw progress numbers</label></div>`
    + `<div class="row"><input type="checkbox" id="invert"><label for="invert">Invert colors (only if the panel shows white-on-black)</label></div></div>`
    + `<div class="card"><div class="pg"><input type="checkbox" id="en_orders" data-opts="op_orders"><label for="en_orders">Orders</label><span class="cnt" id="cnt_orders"></span></div>`
    + `<div class="opts" id="op_orders"><div class="lbl">Rarities to show</div><div class="chips">`
    + `<span class="chip"><input type="checkbox" id="r_exotic"><label for="r_exotic">Exotic</label></span>`
    + `<span class="chip"><input type="checkbox" id="r_legendary"><label for="r_legendary">Legendary</label></span>`
    + `<span class="chip"><input type="checkbox" id="r_common"><label for="r_common">Common</label></span></div>`
    + `<div class="lbl">Orders on screen</div><select id="ordersCount"><option>3</option><option>4</option><option>5</option></select></div></div>`
    + `<div class="card"><div class="pg"><input type="checkbox" id="en_quests" data-opts="op_quests"><label for="en_quests">Quests & Bounties</label><span class="cnt" id="cnt_quests"></span></div>`
    + `<div class="opts" id="op_quests"><div class="lbl">Quests on screen</div><select id="questsCount"><option>3</option><option>4</option><option>5</option></select></div></div>`
    + `<div class="card"><div class="pg"><input type="checkbox" id="en_triumphs" data-opts="op_triumphs"><label for="en_triumphs">Triumphs</label><span class="cnt" id="cnt_triumphs"></span></div>`
    + `<div class="opts" id="op_triumphs"><div class="lbl">Triumphs on screen</div><select id="triumphsCount"><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option></select></div></div>`
    + `<div class="card"><div class="pg"><input type="checkbox" id="en_title" data-opts="op_title"><label for="en_title">Title / Seal</label><span class="cnt" id="cnt_title"></span></div>`
    + `<div class="opts" id="op_title"><div class="lbl">Which seal</div><select id="sealHash"><option value="">Auto — closest to done</option></select></div></div>`
    + `<button id="save">Save</button><div class="msg" id="msg"></div>`
    + `<div class="card preview"><div class="lbl">Live preview (current page)</div><img id="pv" src="/screen.bmp?t=0"></div>`
    + `</div><script>`
    + `var $=function(id){return document.getElementById(id)};var OPTS={};`
    + `function toggleOpts(){['orders','quests','triumphs','title'].forEach(function(t){$('op_'+t).className='opts'+($('en_'+t).checked?' show':'')})}`
    + `['orders','quests','triumphs','title'].forEach(function(t){$('en_'+t).addEventListener('change',toggleOpts)});`
    + `function fillOptions(o){OPTS=o;var sel=$('sealHash');var cur=sel.value;sel.length=1;(o.seals||[]).forEach(function(s){var op=document.createElement('option');op.value=s.hash;op.textContent=s.title+' ('+s.pct+'%)';sel.appendChild(op)});sel.value=cur;`
    + `var c=o.counts||{};$('cnt_orders').textContent=(c.orders||0)+' available';$('cnt_quests').textContent=(c.quests||0)+' available';$('cnt_triumphs').textContent=(c.triumphs||0)+' available';$('cnt_title').textContent=(c.seals||0)+' seals';}`
    + `function load(){fetch('/api/options').then(function(r){return r.json()}).then(fillOptions).catch(function(){});`
    + `fetch('/api/config').then(function(r){return r.json()}).then(function(c){`
    + `$('rotationSeconds').value=String(c.rotationSeconds);$('refreshSeconds').value=String(c.refreshSeconds);$('descSize').value=String(c.descSize);`
    + `$('showNumbers').checked=!!c.showNumbers;$('invert').checked=!!c.invert;`
    + `var byT={};(c.pages||[]).forEach(function(p){byT[p.type]=p});`
    + `var o=byT.orders||{};$('en_orders').checked=o.enabled!==false;var rr=o.rarities||['common','legendary','exotic'];`
    + `$('r_exotic').checked=rr.indexOf('exotic')>=0;$('r_legendary').checked=rr.indexOf('legendary')>=0;$('r_common').checked=rr.indexOf('common')>=0;$('ordersCount').value=String(c.count||5);`
    + `$('en_quests').checked=!!(byT.quests&&byT.quests.enabled);$('questsCount').value=String((byT.quests&&byT.quests.count)||4);`
    + `$('en_triumphs').checked=!!(byT.triumphs&&byT.triumphs.enabled);$('triumphsCount').value=String((byT.triumphs&&byT.triumphs.count)||6);`
    + `$('en_title').checked=!!(byT.title&&byT.title.enabled);$('sealHash').value=(byT.title&&byT.title.sealHash)||'';`
    + `toggleOpts();})}`
    + `function bump(){$('pv').src='/screen.bmp?t='+Date.now()}`
    + `$('save').onclick=function(){var b=$('save');b.disabled=true;$('msg').textContent='Saving…';`
    + `var rar=[];if($('r_exotic').checked)rar.push('exotic');if($('r_legendary').checked)rar.push('legendary');if($('r_common').checked)rar.push('common');`
    + `var body={rotationSeconds:parseInt($('rotationSeconds').value,10),refreshSeconds:parseInt($('refreshSeconds').value,10),descSize:parseInt($('descSize').value,10),count:parseInt($('ordersCount').value,10),showNumbers:$('showNumbers').checked,invert:$('invert').checked,`
    + `pages:[{type:'orders',enabled:$('en_orders').checked,rarities:rar},{type:'quests',enabled:$('en_quests').checked,count:parseInt($('questsCount').value,10)},{type:'triumphs',enabled:$('en_triumphs').checked,count:parseInt($('triumphsCount').value,10)},{type:'title',enabled:$('en_title').checked,sealHash:$('sealHash').value||null}]};`
    + `fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(){$('msg').textContent='Saved \\u2713';b.disabled=false;setTimeout(bump,500)}).catch(function(){$('msg').textContent='Save failed';b.disabled=false})};`
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
    return res.end(JSON.stringify({ status: 0, image_url: imageUrl(req), filename: state.filename, refresh_rate: refreshRate(loadConfig()), update_firmware: false, firmware_url: null, reset_firmware: false }));
  }
  if (path === '/api/setup') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 200, api_key: 'destiny-trmnl', friendly_id: 'DSTNY', image_url: imageUrl(req, 'setup.bmp'), message: 'Welcome to the Destiny 2 dashboard' }));
  }
  if (path === '/api/log') { res.writeHead(204); return res.end(); }
  if (path === '/api/options') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(optionsPayload())); }
  if (path === '/api/config') {
    if (req.method === 'POST') {
      let input = {}; try { input = JSON.parse(await readBody(req) || '{}'); } catch { input = {}; }
      const cfg = sanitizeConfig(input); saveConfig(cfg);
      state.pageIndex = -1; // force a redraw on the next refresh so the preview/panel update
      await refresh();
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

function tickInterval(cfg) {
  const rotating = cfg.rotationSeconds > 0 && enabledPages(cfg).length > 1;
  const base = rotating ? Math.min(cfg.refreshSeconds, cfg.rotationSeconds) : cfg.refreshSeconds;
  return Math.max(10, Math.min(1800, base));
}
async function start() {
  await refresh();
  const tick = async () => { await refresh(); setTimeout(tick, tickInterval(loadConfig()) * 1000); };
  setTimeout(tick, tickInterval(loadConfig()) * 1000);
  server.listen(PORT, () => {
    console.log('\nDestiny 2 TRMNL BYOS server running.');
    const ips = lanIps();
    if (ips.length) for (const ip of ips) console.log(`  TRMNL "Custom Server" URL:  http://${ip}:${PORT}`);
    else console.log(`  (no LAN IP detected) local URL:  http://localhost:${PORT}`);
    console.log(`  Browser preview + content picker: http://localhost:${PORT}/  and  /settings`);
    if (DEMO) console.log('  DEMO mode: serving sample data (no Bungie call).');
    console.log('');
  });
}
if (process.argv[1] && /server\.js$/.test(process.argv[1].replace(/\\/g, '/'))) { start(); }
