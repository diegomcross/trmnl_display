// vault-verdict.js — live Armor 3.0 vault triage server for the trmnl_display repo.
//
//   Run:    node vault-verdict.js          then open  http://127.0.0.1:8787
//   Probe:  node vault-verdict.js probe "helmet name"   (dumps raw data for debugging)
//
// Reuses the same .env (BUNGIE_API_KEY / BUNGIE_CLIENT_ID / BUNGIE_CLIENT_SECRET)
// and tokens.json created by auth-and-snapshot.js. If tokens.json is missing or
// the refresh token expired, run:  node auth-and-snapshot.js
//
// Optional: drop a DIM export named dim-data.json in this folder to merge your
// DIM tags (keep/junk/favorite) and loadout membership into the verdicts.
//
// Needs: Node 18+. No npm install.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const DIM_FILE = path.join(__dirname, 'dim-data.json');
const CACHE_DIR = path.join(__dirname, 'vault-manifest-cache');
const HTML_FILE = path.join(__dirname, 'vault-verdict.html');
const BASE = 'https://www.bungie.net/Platform';
const PORT = 8787;

// Stat hashes kept their pre-rename identities (Mobility->Weapons etc.)
const STAT = { 2996146975: 'w', 392767087: 'h', 1943323491: 'c', 1735777505: 'g', 144602215: 's', 4244567218: 'm' };
const BUCKET = { 3448274439: 'Helmet', 3551918588: 'Gauntlets', 14239492: 'Chest', 20886954: 'Leg', 1585787867: 'Class Item' };
const CLASS = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };
const ARCH_BY_PAIR = { 'sm': 'Paragon', 'gs': 'Grenadier', 'cw': 'Specialist', 'mh': 'Brawler', 'hc': 'Bulwark', 'wg': 'Gunner',
  'ws': 'Powerhouse', 'sh': 'Colossus', 'gc': 'Demolitionist', 'cm': 'Reaver', 'hg': 'Siegebreaker', 'mw': 'Skirmisher' };
const ARCH_NAMES = new Set(Object.values(ARCH_BY_PAIR));

// ---------- env + tokens (same conventions as auth-and-snapshot.js) ----------
function env() {
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  if (!out.BUNGIE_API_KEY) throw new Error('.env missing BUNGIE_API_KEY — run auth-and-snapshot.js first.');
  return out;
}

async function accessToken(e) {
  if (!fs.existsSync(TOKENS_FILE)) throw new Error('tokens.json missing — run: node auth-and-snapshot.js');
  const t = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  if (Date.now() < t.expires_at - 60000) return t;
  if (Date.now() >= t.refresh_expires_at) throw new Error('Refresh token expired — run: node auth-and-snapshot.js reauth');
  const basic = Buffer.from(`${e.BUNGIE_CLIENT_ID}:${e.BUNGIE_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/App/OAuth/Token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-API-Key': e.BUNGIE_API_KEY, Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: HTTP ${res.status}`);
  const nt = await res.json();
  const saved = {
    access_token: nt.access_token, refresh_token: nt.refresh_token,
    expires_at: Date.now() + nt.expires_in * 1000,
    refresh_expires_at: Date.now() + (nt.refresh_expires_in ?? 7776000) * 1000,
    membership_id: nt.membership_id ?? t.membership_id,
  };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(saved, null, 2));
  return saved;
}

async function bungie(url, e, tok) {
  const res = await fetch(url, { headers: { 'X-API-Key': e.BUNGIE_API_KEY, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
  const j = await res.json();
  if (j.ErrorStatus && j.ErrorStatus !== 'Success') throw new Error(`Bungie: ${j.ErrorStatus} — ${j.Message}`);
  return j.Response;
}

// ---------- manifest (slimmed + cached to disk) ----------
let MANIFEST = null; // { version, items:{hash:{n,b,c,tt,it,set,pc,inv}}, sets:{hash:{n,perks:[{count,n,d}]}} }

async function loadManifest(e) {
  const meta = await bungie(`${BASE}/Destiny2/Manifest/`, e);
  const version = meta.version;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // slim2: set membership comes from DestinyEquipableItemSetDefinition.setItems
  // (set -> item hashes); item defs carry no set hash of their own.
  const cacheFile = path.join(CACHE_DIR, `slim2-${version}.json`);
  if (MANIFEST?.version === version) return MANIFEST;
  if (fs.existsSync(cacheFile)) {
    MANIFEST = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`Manifest ${version} loaded from cache.`);
    return MANIFEST;
  }
  const paths = meta.jsonWorldComponentContentPaths.en;
  const setsRaw = paths.DestinyEquipableItemSetDefinition
    ? await (await fetch(`https://www.bungie.net${paths.DestinyEquipableItemSetDefinition}`)).json() : {};
  const setOfItem = {};
  for (const [hash, d] of Object.entries(setsRaw))
    for (const ih of d.setItems || []) setOfItem[ih] = Number(hash);

  // Cheap path: a slim(1) cache for this version only lacks item->set links; patch
  // it with the reverse map instead of re-downloading the full item table.
  const oldCache = path.join(CACHE_DIR, `slim-${version}.json`);
  if (fs.existsSync(oldCache)) {
    MANIFEST = JSON.parse(fs.readFileSync(oldCache, 'utf8'));
    for (const [hash, it] of Object.entries(MANIFEST.items)) it.set = setOfItem[hash] || 0;
    fs.writeFileSync(cacheFile, JSON.stringify(MANIFEST));
    for (const f of fs.readdirSync(CACHE_DIR)) if (f !== path.basename(cacheFile)) fs.unlinkSync(path.join(CACHE_DIR, f));
    console.log(`Manifest ${version}: patched set links into cache (${Object.keys(setOfItem).length} set items).`);
    return MANIFEST;
  }

  console.log(`Downloading manifest ${version} (one-time, this is the big one — a few hundred MB)...`);
  const items = await (await fetch(`https://www.bungie.net${paths.DestinyInventoryItemDefinition}`)).json();
  const perksRaw = await (await fetch(`https://www.bungie.net${paths.DestinySandboxPerkDefinition}`)).json();

  const slimItems = {};
  for (const [hash, d] of Object.entries(items)) {
    const isArmor = d.itemType === 2;
    const isPlug = !!d.plug;
    if (!isArmor && !isPlug) continue;
    const inv = {};
    for (const st of d.investmentStats || []) {
      const k = STAT[st.statTypeHash];
      if (k && !st.isConditionallyActive) inv[k] = (inv[k] || 0) + st.value;
    }
    slimItems[hash] = {
      n: d.displayProperties?.name || '',
      b: d.inventory?.bucketTypeHash || 0,
      c: d.classType ?? 3,
      tt: d.inventory?.tierType || 0,          // 6 = Exotic, 5 = Legendary
      it: d.itemType,
      set: setOfItem[hash] || 0,
      pc: d.plug?.plugCategoryIdentifier || '',
      inv: Object.keys(inv).length ? inv : undefined,
    };
  }
  const slimSets = {};
  for (const [hash, d] of Object.entries(setsRaw)) {
    slimSets[hash] = {
      n: d.displayProperties?.name || `Set ${hash}`,
      perks: (d.setPerks || []).map((p) => ({
        count: p.requiredSetCount,
        n: perksRaw[p.sandboxPerkHash]?.displayProperties?.name || '',
        d: perksRaw[p.sandboxPerkHash]?.displayProperties?.description || '',
      })),
    };
  }
  MANIFEST = { version, items: slimItems, sets: slimSets };
  fs.writeFileSync(cacheFile, JSON.stringify(MANIFEST));
  for (const f of fs.readdirSync(CACHE_DIR)) if (f !== path.basename(cacheFile)) fs.unlinkSync(path.join(CACHE_DIR, f));
  console.log(`Manifest slimmed + cached (${Object.keys(slimItems).length} defs).`);
  return MANIFEST;
}

// ---------- DIM tag/loadout merge (optional) ----------
function dimOverlay() {
  const tags = {}, loadoutCount = {};
  if (!fs.existsSync(DIM_FILE)) return { tags, loadoutCount };
  try {
    const d = JSON.parse(fs.readFileSync(DIM_FILE, 'utf8'));
    for (const t of d.tags || []) {
      const a = t.annotation || {};
      if (a.id) tags[a.id] = { tag: a.tag || '', note: (a.notes || '').slice(0, 80) };
    }
    for (const l of d.loadouts || []) {
      const lo = l.loadout || {};
      for (const it of [...(lo.equipped || []), ...(lo.unequipped || [])]) {
        if (it.id) loadoutCount[it.id] = (loadoutCount[it.id] || 0) + 1;
      }
    }
    console.log(`dim-data.json merged: ${Object.keys(tags).length} tags, loadout refs for ${Object.keys(loadoutCount).length} items.`);
  } catch (err) { console.warn('dim-data.json unreadable, skipping:', err.message); }
  return { tags, loadoutCount };
}

// ---------- profile -> items ----------
async function fetchArmor(e) {
  const tok = await accessToken(e);
  const ms = await bungie(`${BASE}/User/GetMembershipsById/${tok.membership_id}/254/`, e, tok.access_token);
  const primary = ms.primaryMembershipId;
  const m = (ms.destinyMemberships || []).find((x) => x.membershipId === primary)
    || (ms.destinyMemberships || []).find((x) => x.crossSaveOverride === 0 || x.crossSaveOverride === x.membershipType)
    || ms.destinyMemberships[0];
  const prof = await bungie(
    `${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=102,200,201,205,300,304,305`,
    e, tok.access_token
  );
  const man = await loadManifest(e);
  const { tags, loadoutCount } = dimOverlay();

  const charName = {};
  for (const [cid, c] of Object.entries(prof.characters?.data || {})) charName[cid] = CLASS[c.classType] || 'Unknown';

  const instances = prof.itemComponents?.instances?.data || {};
  const liveStats = prof.itemComponents?.stats?.data || {};
  const sockets = prof.itemComponents?.sockets?.data || {};

  const raw = [];
  for (const it of prof.profileInventory?.data?.items || []) raw.push({ it, own: 'Vault' });
  for (const [cid, inv] of Object.entries(prof.characterInventories?.data || {}))
    for (const it of inv.items || []) raw.push({ it, own: charName[cid] });
  for (const [cid, eq] of Object.entries(prof.characterEquipment?.data || {}))
    for (const it of eq.items || []) raw.push({ it, own: charName[cid] });

  const out = [];
  for (const { it, own } of raw) {
    const def = man.items[it.itemHash];
    if (!def || def.it !== 2 || !it.itemInstanceId) continue;
    const slot = BUCKET[def.b];
    if (!slot) continue;
    const id = it.itemInstanceId;
    const inst = instances[id] || {};

    // live stats
    const live = { w: 0, h: 0, c: 0, g: 0, s: 0, m: 0 };
    for (const [sh, sv] of Object.entries(liveStats[id]?.stats || {})) {
      const k = STAT[sh]; if (k) live[k] = sv.value;
    }
    // base = live minus removable mod plugs (anything in an 'enhancements' plug category)
    const base = { ...live };
    let archetype = '';
    for (const s of sockets[id]?.sockets || []) {
      if (!s.plugHash || s.isEnabled === false) continue;
      const p = man.items[s.plugHash];
      if (!p) continue;
      if (ARCH_NAMES.has(p.n)) archetype = p.n;
      if (p.inv && /enhancements|tuning/i.test(p.pc)) {
        for (const [k, v] of Object.entries(p.inv)) base[k] = Math.max(0, base[k] - v);
      }
    }
    // archetype fallback: infer from top-2 base stats
    let ter = '';
    const order = Object.entries(base).sort((a, b) => b[1] - a[1]);
    if (!archetype) archetype = ARCH_BY_PAIR[order[0][0] + order[1][0]] || '—';
    const pair = Object.entries(ARCH_BY_PAIR).find(([, v]) => v === archetype)?.[0] || '';
    const terK = order.map(([k]) => k).find((k) => !pair.includes(k) && base[k] > 0);
    const TERN = { w: 'Weapons', h: 'Health', c: 'Class', g: 'Grenade', s: 'Super', m: 'Melee' };
    ter = TERN[terK] || '—';

    const setDef = def.set ? man.sets[def.set] : null;
    const dim = tags[id] || {};
    out.push({
      n: def.n, id, hash: it.itemHash,
      tag: dim.tag || '', note: dim.note || '',
      x: def.tt === 6, t: inst.gearTier ?? 0,
      slot, cls: CLASS[def.c] || '—', src: '',
      a: archetype, ter, mw: 0,
      pwr: inst.primaryStat?.value || 0, own,
      lo: loadoutCount[id] || 0,
      s: base, tot: Object.values(base).reduce((a, b) => a + b, 0),
      set: setDef?.n || def.n, sb: setDef?.n || '',
    });
  }

  // sets payload from live manifest (only sets present in the vault)
  const setsOut = {};
  for (const i of out) {
    if (!i.sb || setsOut[i.sb]) continue;
    const sd = Object.values(man.sets).find((s) => s.n === i.sb);
    if (!sd) continue;
    const p2 = sd.perks.find((p) => p.count === 2), p4 = sd.perks.find((p) => p.count === 4);
    setsOut[i.sb] = { src: '', p2: [p2?.n || '2-piece', p2?.d || ''], p4: [p4?.n || '4-piece', p4?.d || ''] };
  }
  return { items: out, sets: setsOut, fetchedAt: new Date().toISOString(), account: `${m.membershipType}/${m.membershipId}` };
}

// ---------- probe mode for debugging ----------
async function probe(nameLike) {
  const e = env();
  const data = await fetchArmor(e);
  const hit = data.items.find((i) => i.n.toLowerCase().includes(nameLike.toLowerCase()));
  console.log(hit ? JSON.stringify(hit, null, 2) : `No armor matching "${nameLike}".`);
  if (hit) console.log('\nIf tier/archetype/base stats look wrong, paste this output back to Claude.');
}

// ---------- server ----------
async function main() {
  if (process.argv[2] === 'probe') return probe(process.argv[3] || '');
  const e = env();
  let cache = null;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/armor')) {
        const fresh = req.url.includes('fresh=1');
        if (!cache || fresh) cache = await fetchArmor(e);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(cache));
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(HTML_FILE));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  server.listen(PORT, '0.0.0.0', () =>
    console.log(`\nVault Verdict live at  http://127.0.0.1:${PORT}\n(from your phone on the same Wi-Fi: http://<this-PC's-LAN-IP>:${PORT})\n`));
}

main().catch((err) => { console.error(err.message); process.exit(1); });
