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
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const DIM_FILE = path.join(__dirname, 'dim-data.json');
const CACHE_DIR = process.env.VV_CACHE_DIR || path.join(__dirname, 'vault-manifest-cache');
const HTML_FILE = path.join(__dirname, 'vault-verdict.html');
const BASE = 'https://www.bungie.net/Platform';
const PORT = process.env.PORT || 8787;

// Stay up no matter what: a stray error in a request, the drop poller, or a Bungie call must
// never take the whole server down. Log it and keep serving (each request already has its own
// try/catch; this is the last-resort net for async errors outside it).
process.on('uncaughtException', (err) => console.error('[uncaughtException]', (err && err.stack) || err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', (err && err.stack) || err));

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

async function bungiePost(url, body, e, tok) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': e.BUNGIE_API_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.ErrorStatus && j.ErrorStatus !== 'Success') throw new Error(`Bungie: ${j.ErrorStatus} — ${j.Message}`);
  return j.Response;
}

// ---------- manifest (slimmed + cached to disk) ----------
// slim3 shape:
//   items:    hash -> {n,b,c,tt,it,set,pc,inv,src, ty,ammo,dmg,tr,ti,bi, wi}  (armor it=2, weapons it=3, plugs)
//             weapons: ty=type name, ammo 1/2/3, dmg damage type, tr=[col3,col4 plugSet hashes],
//             ti=[col3,col4 socketEntry indexes] (cols 3+4 = 3rd/4th index of the WEAPON_PERKS category),
//             bi=[col1,col2 socketEntry indexes] (barrel + magazine — they carry stat bonuses)
//             plugs: wi = raw investmentStats {statHash: value} so barrel/mag stat deltas can be computed
//   sets:     hash -> {n,perks:[{count,n,d}]}         (set membership is setItems, reverse-mapped onto items)
//   plugSets: hash -> [plugItemHash,...]              (only sets referenced by weapon trait columns)
//   statNames: statHash -> display name
let MANIFEST = null;
const WEAPON_PERKS_CAT = 4241085061;

// Set drop location: majority vote of collectible sourceStrings across ALL pieces
// of the set (some pieces carry junk like "Random Perks: … cannot be reacquired").
function setSrcMap(setsRaw, srcOfItem) {
  const out = {};
  for (const [hash, d] of Object.entries(setsRaw)) {
    const votes = {};
    for (const ih of d.setItems || []) {
      const s = srcOfItem[ih];
      if (!s || /cannot be reacquired|random perks/i.test(s)) continue;
      votes[s] = (votes[s] || 0) + 1;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (best) out[hash] = best[0];
  }
  return out;
}

async function loadManifest(e) {
  const meta = await bungie(`${BASE}/Destiny2/Manifest/`, e);
  const version = meta.version;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `slim6-${version}.json`);
  if (MANIFEST?.version === version) return MANIFEST;
  if (fs.existsSync(cacheFile)) {
    MANIFEST = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`Manifest ${version} loaded from cache.`);
    if (!Object.values(MANIFEST.sets).some((s) => s.src)) { // patch older slim3 caches in place (small fetches only)
      const paths = meta.jsonWorldComponentContentPaths.en;
      const [setsRaw, colRaw] = await Promise.all([
        fetch(`https://www.bungie.net${paths.DestinyEquipableItemSetDefinition}`).then((r) => r.json()),
        fetch(`https://www.bungie.net${paths.DestinyCollectibleDefinition}`).then((r) => r.json()),
      ]);
      const srcOfItem = {};
      for (const c of Object.values(colRaw)) if (c.itemHash && c.sourceString) srcOfItem[c.itemHash] = c.sourceString.replace(/^Source:\s*/i, '');
      const srcs = setSrcMap(setsRaw, srcOfItem);
      for (const [h, s] of Object.entries(srcs)) if (MANIFEST.sets[h]) MANIFEST.sets[h].src = s;
      fs.writeFileSync(cacheFile, JSON.stringify(MANIFEST));
      console.log(`Patched drop sources onto ${Object.keys(srcs).length} sets.`);
    }
    return MANIFEST;
  }
  console.log(`Downloading manifest ${version} (one-time, the item table is a few hundred MB)...`);
  const paths = meta.jsonWorldComponentContentPaths.en;
  const grab = (name) => paths[name] ? fetch(`https://www.bungie.net${paths[name]}`).then((r) => r.json()) : {};
  const [items, setsRaw, perksRaw, colRaw, plugSetsRaw, statsRaw] = await Promise.all([
    grab('DestinyInventoryItemDefinition'), grab('DestinyEquipableItemSetDefinition'),
    grab('DestinySandboxPerkDefinition'), grab('DestinyCollectibleDefinition'),
    grab('DestinyPlugSetDefinition'), grab('DestinyStatDefinition'),
  ]);

  const setOfItem = {};
  for (const [hash, d] of Object.entries(setsRaw))
    for (const ih of d.setItems || []) setOfItem[ih] = Number(hash);
  const srcOfItem = {}; // drop location, e.g. 'Vault of Glass raid'
  for (const c of Object.values(colRaw))
    if (c.itemHash && c.sourceString) srcOfItem[c.itemHash] = c.sourceString.replace(/^Source:\s*/i, '');

  const slimItems = {};
  const traitSets = new Set();
  for (const [hash, d] of Object.entries(items)) {
    const isArmor = d.itemType === 2, isWeapon = d.itemType === 3, isPlug = !!d.plug;
    if (!isArmor && !isWeapon && !isPlug) continue;
    const inv = {}, wi = {};
    for (const st of d.investmentStats || []) {
      if (st.isConditionallyActive) continue;
      const k = STAT[st.statTypeHash];
      if (k) inv[k] = (inv[k] || 0) + st.value;
      if (isPlug && st.value) wi[st.statTypeHash] = (wi[st.statTypeHash] || 0) + st.value;
    }
    const slim = {
      n: d.displayProperties?.name || '',
      b: d.inventory?.bucketTypeHash || 0,
      c: d.classType ?? 3,
      tt: d.inventory?.tierType || 0,          // 6 = Exotic, 5 = Legendary
      it: d.itemType,
      set: setOfItem[hash] || 0,
      pc: d.plug?.plugCategoryIdentifier || '',
      icon: d.displayProperties?.icon || undefined,   // bungie.net path; weapons + perk/MW plugs
      inv: Object.keys(inv).length ? inv : undefined,
      wi: Object.keys(wi).length ? wi : undefined,
      src: srcOfItem[hash] || undefined,
      // perk/plug description (in-game text) — powers the hover popup on perks
      dsc: (isPlug && d.displayProperties?.description) ? d.displayProperties.description : undefined,
    };
    if (isWeapon) {
      slim.ty = d.itemTypeDisplayName || '';
      slim.ammo = d.equippingBlock?.ammoType || 0;
      slim.dmg = d.defaultDamageType || 0;
      slim.shot = d.screenshot || undefined;          // full weapon art for the drops dashboard
      const cat = d.sockets?.socketCategories?.find((c) => c.socketCategoryHash === WEAPON_PERKS_CAT);
      const idx = cat?.socketIndexes || [];
      const tr = [], ti = [];
      for (const i of [idx[2], idx[3]]) { // 3rd + 4th perk sockets = trait columns 3 and 4
        const s = i !== undefined ? d.sockets.socketEntries[i] : null;
        const ps = s ? (s.randomizedPlugSetHash || s.reusablePlugSetHash || 0) : 0;
        tr.push(ps); ti.push(i ?? -1);
        if (ps) traitSets.add(ps);
      }
      if (tr[0] || tr[1]) { slim.tr = tr; slim.ti = ti; }
      slim.bi = [idx[0] ?? -1, idx[1] ?? -1]; // barrel + magazine sockets (stat bonuses)
    }
    slimItems[hash] = slim;
  }

  const setSrcs = setSrcMap(setsRaw, srcOfItem);
  const slimSets = {};
  for (const [hash, d] of Object.entries(setsRaw)) {
    slimSets[hash] = {
      n: d.displayProperties?.name || `Set ${hash}`,
      src: setSrcs[hash] || '',
      perks: (d.setPerks || []).map((p) => ({
        count: p.requiredSetCount,
        n: perksRaw[p.sandboxPerkHash]?.displayProperties?.name || '',
        d: perksRaw[p.sandboxPerkHash]?.displayProperties?.description || '',
      })),
    };
  }

  const slimPlugSets = {};
  for (const h of traitSets) {
    const d = plugSetsRaw[h];
    if (!d) continue;
    slimPlugSets[h] = [...new Set((d.reusablePlugItems || [])
      .filter((p) => p.currentlyCanRoll !== false)
      .map((p) => p.plugItemHash))];
  }

  const statNames = {};
  for (const [h, d] of Object.entries(statsRaw))
    if (d.displayProperties?.name) statNames[h] = d.displayProperties.name;

  MANIFEST = { version, items: slimItems, sets: slimSets, plugSets: slimPlugSets, statNames };
  fs.writeFileSync(cacheFile, JSON.stringify(MANIFEST));
  for (const f of fs.readdirSync(CACHE_DIR)) if (f !== path.basename(cacheFile)) fs.unlinkSync(path.join(CACHE_DIR, f));
  console.log(`Manifest slimmed + cached (${Object.keys(slimItems).length} defs, ${Object.keys(slimPlugSets).length} trait plug sets).`);
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

// Hand-curated set drop locations (short names Diego prefers; recovered from the
// original static build). Keyed by set name, trailing " Set" ignored when matching.
// Used before the manifest sourceString, which is verbose and missing for ~half
// the sets (their collectibles only say "cannot be reacquired").
const CURATED_SRC = { 'AION Adapter': 'Kepler', "Apostate's Blade": 'Pit of Heresy', "Atheon's Memory": 'Vault of Glass',
  Bushido: 'Vanguard Ops', Circuit: 'Sparrow Racing League', 'Collective Psyche': 'The Desert Perpetual',
  "Crota's Memory": "Crota's End", 'Cruel Electrum': 'Trials', Crystocrene: 'Europa', 'Cyberserpent Null': 'Gambit',
  'Deep Explorer': 'Duality', 'Disaster Corps': 'Rewards Pass', Dreambane: 'The Moon', Eutechnology: 'Vanguard Ops',
  'Exodus Down': 'Nessus', Ferropotent: 'Vanguard Ops', 'First Ascent': 'The Pale Heart', Flain: 'Sundered Doctrine',
  'Iron Panoply': 'Iron Banner', 'Last Discipline': 'Rewards Pass (PvP)', "Legacy's Oath": 'Deep Stone Crypt',
  Luminopotent: 'Vanguard Ops', Lustrous: 'Solstice', 'New Demotic': 'Trials', "Nezarec's Nightmare": 'Root of Nightmares',
  'Pantheos Resplendent': 'Pantheon', Promised: "Salvation's Edge", 'Reverie Dawn': 'Dreaming City',
  'Sage Protector': 'Equilibrium', 'Seventh Seraph': 'Cosmodrome', 'Shrewd Survivor': 'Renegades',
  'Smoke Jumper': 'Vanguard Ops', Swordmaster: 'Vanguard Ops', "Techeun's Regalia": 'Shattered Throne',
  Techsec: 'Vanguard Ops', 'Thriving Survivor': 'Renegades', Thunderhead: 'Neomuna', 'TM Custom': 'Spire of the Watcher',
  'Triumphal Anthem': 'Monument of Triumph', 'Twofold Crown': 'Trials', Veritas: 'Throne World',
  'Wild Anthem': 'Rewards Pass', Wildwood: 'EDZ', 'Resonant Fury': 'Vow of the Disciple' };
const curatedSrc = (name) => CURATED_SRC[name] || CURATED_SRC[name.replace(/\s+Set$/i, '')] || '';

// ---------- DIM Sync API (two-way tag sync) ----------
// DIM stores your keep/favorite/junk tags in its own cloud keyed to your Bungie
// login. We register an app once (.dim-app.json), exchange the Bungie token for a
// DIM token (.dim-token.json, ~30-day), then read/write tag annotations.
const DIM_API = 'https://api.destinyitemmanager.com';
const DIM_ORIGIN = 'https://localhost';
const DIM_APP_FILE = path.join(__dirname, '.dim-app.json');
const DIM_TOKEN_FILE = path.join(__dirname, '.dim-token.json');
let DIM_TAGS = {};        // instanceId -> tag (DIM is the source of truth; cached)
let DIM_TAGS_AT = 0;
let DIM_OFF = false;      // set true if DIM has no app key so we stop trying
let DIM_LAST_ERR = '';    // last DIM read failure (surfaced by /api/status — console output is easy to miss)
const dimKey = () => { try { return JSON.parse(fs.readFileSync(DIM_APP_FILE, 'utf8')).dimApiKey; } catch { return null; } };

async function dimAuth(e) {
  const key = dimKey();
  if (!key) { DIM_OFF = true; throw new Error('DIM not set up (.dim-app.json missing) — run dim-probe.js'); }
  try { const t = JSON.parse(fs.readFileSync(DIM_TOKEN_FILE, 'utf8')); if (t.token && Date.now() < t.exp - 60000) return { key, token: t.token, pid: t.pid }; } catch {}
  const tok = await accessToken(e);
  const ms = await bungie(`${BASE}/User/GetMembershipsById/${tok.membership_id}/254/`, e, tok.access_token);
  const m = (ms.destinyMemberships || []).find((x) => x.membershipId === ms.primaryMembershipId) || ms.destinyMemberships[0];
  const pid = m.membershipId;
  const res = await fetch(`${DIM_API}/auth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key, Origin: DIM_ORIGIN },
    body: JSON.stringify({ bungieAccessToken: tok.access_token, membershipId: tok.membership_id, platformMembershipId: pid }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`DIM auth: ${j.error || res.status} ${j.message || ''}`);
  const exp = Date.now() + (j.expiresInSeconds ? j.expiresInSeconds * 1000 : 29 * 864e5);
  fs.writeFileSync(DIM_TOKEN_FILE, JSON.stringify({ token: j.accessToken, exp, pid }));
  return { key, token: j.accessToken, pid };
}

let DIM_NOTES = {};       // instanceId -> DIM note text (read-only cache; preserved on tag writes)
async function dimReadTags(e) {
  const { key, token, pid } = await dimAuth(e);
  const res = await fetch(`${DIM_API}/profile?platformMembershipId=${pid}&destinyVersion=2&components=tags`, {
    headers: { 'X-API-Key': key, Authorization: `Bearer ${token}`, Origin: DIM_ORIGIN },
  });
  const j = await res.json().catch(() => ({}));
  if (!Array.isArray(j.tags)) throw new Error(`DIM read: ${j.error || res.status}`);
  const out = {}, notes = {};
  for (const t of j.tags) { if (t.tag) out[t.id] = t.tag; if (t.notes) notes[t.id] = t.notes; }
  // Unified tag history (Diego 2026-07-12): changes made INSIDE the DIM app show up here as a
  // diff against our last-known state (in-memory map, or the disk mirror right after a restart).
  // Our own writes (manual chips / auto passes) update DIM_TAGS immediately, so they never
  // re-log as "dim" — only genuinely external edits do.
  const prev = Object.keys(DIM_TAGS).length ? DIM_TAGS : loadTags();
  if (prev && Object.keys(prev).length) {
    const changes = [];
    for (const [id, tag] of Object.entries(out)) if ((prev[id] || 'none') !== tag) changes.push({ id, from: prev[id] || 'none', to: tag, src: 'dim' });
    for (const id of Object.keys(prev)) if (!out[id]) changes.push({ id, from: prev[id], to: 'none', src: 'dim' });
    logTagHistory(changes);
  }
  DIM_TAGS = out; DIM_NOTES = notes; DIM_TAGS_AT = Date.now(); DIM_LAST_ERR = '';
  saveJsonSafe(TAGS_FILE, out); // mirror to disk as an offline fallback
  return out;
}

// Refresh the DIM tag cache if stale; fall back to the last disk mirror on failure.
async function dimTagsFresh(e, maxAgeMs = 30000) {
  if (DIM_OFF) return DIM_TAGS;
  if (Date.now() - DIM_TAGS_AT > maxAgeMs) {
    try { await dimReadTags(e); } catch (err) { DIM_LAST_ERR = err.message; console.warn('DIM read failed, using cached tags:', err.message); if (!Object.keys(DIM_TAGS).length) DIM_TAGS = loadTags(); }
  }
  return DIM_TAGS;
}

async function dimWriteTag(e, id, tag, notes) {
  const { key, token, pid } = await dimAuth(e);
  const payload = { id, tag: (tag && tag !== 'none') ? tag : null };
  if (notes !== undefined) payload.notes = notes;   // only sent when we mean to set it — omitted = DIM keeps the existing note
  const res = await fetch(`${DIM_API}/profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key, Authorization: `Bearer ${token}`, Origin: DIM_ORIGIN },
    body: JSON.stringify({ platformMembershipId: pid, destinyVersion: 2, updates: [{ action: 'tag', payload }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`DIM write ${res.status}: ${JSON.stringify(j).slice(0, 140)}`);
  if (payload.tag) DIM_TAGS[id] = payload.tag; else delete DIM_TAGS[id];
  if (notes !== undefined) { if (notes) DIM_NOTES[id] = notes; else delete DIM_NOTES[id]; }
  saveJsonSafe(TAGS_FILE, DIM_TAGS);
  return payload.tag || 'none';
}

// DIM cloud LOADOUTS (Build Crafter import). Separate from dimReadTags so the tag flows
// stay untouched. The Sync API returns a flat loadouts[] array; the dim-data.json export
// wraps each as {loadout:{...}} — parse both defensively.
async function dimReadLoadouts(e) {
  const { key, token, pid } = await dimAuth(e);
  const res = await fetch(`${DIM_API}/profile?platformMembershipId=${pid}&destinyVersion=2&components=loadouts`, {
    headers: { 'X-API-Key': key, Authorization: `Bearer ${token}`, Origin: DIM_ORIGIN },
  });
  const j = await res.json().catch(() => ({}));
  if (!Array.isArray(j.loadouts)) throw new Error(`DIM loadouts: ${j.error || res.status}`);
  return j.loadouts.map((l) => (l && l.loadout) ? l.loadout : l);
}

// Map DIM loadouts → DRAFT builds (Diego 2026-07-12: import as drafts; watch stays OFF
// until he opens each draft, refines the goals, and saves). Subclass plugs are classified
// BY THEIR pc (never socket index); stasis totems/trinkets fold to aspects/fragments.
async function importDimLoadouts(e) {
  const man = await loadManifest(e);
  const louts = await dimReadLoadouts(e);
  const builds = loadBuilds();
  const CLSBY = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };
  const imported = [], skipped = [];
  for (const lo of louts) {
    if (!lo || !lo.id) continue;
    if (builds.some((b) => b.dimId === lo.id)) { skipped.push({ name: lo.name || '?', reason: 'already imported' }); continue; }
    const cls = CLSBY[lo.classType];
    if (!cls) { skipped.push({ name: lo.name || '?', reason: 'any-class loadout (no class)' }); continue; }
    const plugs = { super: 0, grenade: 0, melee: 0, classAbility: 0, movement: 0, aspects: [], fragments: [] };
    let elem = '';
    for (const eq of (lo.equipped || [])) {
      const so = eq.socketOverrides; if (!so) continue;
      for (const ph of Object.values(so)) {
        const p = man.items[ph]; const pc = (p && p.pc) || '';
        const m = pc.match(/^(?:titan|hunter|warlock|shared)\.(arc|solar|void|strand|stasis|prism)\.(\w+)$/);
        if (!m) continue;
        elem = elem || m[1];
        const kind = m[2];
        if (kind === 'supers') plugs.super = ph;
        else if (kind === 'grenades' || kind === 'prism_grenade') plugs.grenade = plugs.grenade || ph;
        else if (kind === 'melee') plugs.melee = ph;
        else if (kind === 'class_abilities') plugs.classAbility = ph;
        else if (kind === 'movement') plugs.movement = ph;
        else if (kind === 'aspects' || kind === 'totems') { if (plugs.aspects.length < 2) plugs.aspects.push(ph); }
        else if (kind === 'fragments' || kind === 'trinkets') plugs.fragments.push(ph);
      }
    }
    let exotic = { hash: 0, slot: '', n: '' };
    for (const eq of (lo.equipped || [])) {
      const d = man.items[eq.hash];
      if (d && d.it === 2 && d.tt === 6 && BUCKET[d.b]) { exotic = { hash: eq.hash, slot: BUCKET[d.b], n: d.n }; break; }
    }
    // DIM statConstraints: array order = priority; Armor 3.0 DIM uses minStat/maxStat,
    // legacy loadouts carry minTier/maxTier (×10). Unlisted stats append in default order.
    const prio = [], min = {}, max = {};
    for (const sc of (lo.parameters?.statConstraints || [])) {
      const k = STAT[sc.statHash]; if (!k || prio.includes(k)) continue;
      prio.push(k);
      if (sc.minStat != null) min[k] = sc.minStat; else if (sc.minTier != null) min[k] = sc.minTier * 10;
      if (sc.maxStat != null) max[k] = sc.maxStat; else if (sc.maxTier != null && sc.maxTier < 20) max[k] = sc.maxTier * 10;
    }
    for (const k of STATKEYS) if (!prio.includes(k)) prio.push(k);
    const b = upsertBuild({
      name: lo.name || 'DIM loadout', cls, classType: lo.classType, elem: elem || 'solar',
      plugs, exotic, prio, min, max, watch: false, draft: true, src: 'dim', dimId: lo.id, notes: lo.notes || '',
    });
    imported.push({ id: b.id, name: b.name });
  }
  return { imported, skipped };
}

// ---------- profile fetch (shared by armor + weapons) ----------
async function fetchProfile(e) {
  const tok = await accessToken(e);
  const ms = await bungie(`${BASE}/User/GetMembershipsById/${tok.membership_id}/254/`, e, tok.access_token);
  const primary = ms.primaryMembershipId;
  const m = (ms.destinyMemberships || []).find((x) => x.membershipId === primary)
    || (ms.destinyMemberships || []).find((x) => x.crossSaveOverride === 0 || x.crossSaveOverride === x.membershipType)
    || ms.destinyMemberships[0];
  const prof = await bungie(
    // 309 = ItemPlugObjectives (kill-tracker progress)
    `${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=102,200,201,205,300,304,305,309,310`,
    e, tok.access_token
  );
  const man = await loadManifest(e);
  const charName = {};
  for (const [cid, c] of Object.entries(prof.characters?.data || {})) charName[cid] = CLASS[c.classType] || 'Unknown';
  // loc = where the item lives: vault | char (on a character, unequipped) | equipped.
  const raw = [];
  for (const it of prof.profileInventory?.data?.items || []) raw.push({ it, own: 'Vault', loc: 'vault', cid: null });
  for (const [cid, inv] of Object.entries(prof.characterInventories?.data || {}))
    for (const it of inv.items || []) raw.push({ it, own: charName[cid], loc: 'char', cid });
  for (const [cid, eq] of Object.entries(prof.characterEquipment?.data || {}))
    for (const it of eq.items || []) raw.push({ it, own: charName[cid], loc: 'equipped', cid });
  // remember character context for item actions (lock/transfer/equip). Keep a
  // default character (lock/vault-pull need one) plus class<->id maps so we can
  // resolve which character holds a copy and name the target after an equip.
  const cids = Object.keys(prof.characters?.data || {});
  if (cids.length) LOCK_CTX = {
    characterId: cids[0], membershipType: m.membershipType,
    byClass: Object.fromEntries(Object.entries(charName).map(([cid, cls]) => [cls, cid])),
    clsById: charName,
  };
  return { prof, man, m, raw };
}
let LOCK_CTX = null;

// ---------- account nameplate: emblem banner + Bungie name + per-character power ----------
// Light call (component 200 = characters) for the game-style header. Cached in memory;
// ?fresh=1 re-pulls (power/emblem change as you play).
let ACCOUNT = null;
async function fetchAccount(e) {
  const tok = await accessToken(e);
  const ms = await bungie(`${BASE}/User/GetMembershipsById/${tok.membership_id}/254/`, e, tok.access_token);
  const primary = ms.primaryMembershipId;
  const m = (ms.destinyMemberships || []).find((x) => x.membershipId === primary)
    || (ms.destinyMemberships || []).find((x) => x.crossSaveOverride === 0 || x.crossSaveOverride === x.membershipType)
    || ms.destinyMemberships[0];
  const prof = await bungie(`${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=200`, e, tok.access_token);
  const chars = Object.entries(prof.characters?.data || {}).map(([id, c]) => ({
    id, cls: CLASS[c.classType] || 'Guardian', light: c.light || 0,
    emblemBg: c.emblemBackgroundPath || '', emblem: c.emblemPath || '', lastPlayed: c.dateLastPlayed || '',
  })).sort((a, b) => (a.lastPlayed < b.lastPlayed ? 1 : -1)); // most recently played first
  ACCOUNT = { name: m.bungieGlobalDisplayName || m.displayName || 'Guardian', code: m.bungieGlobalDisplayNameCode || null, chars };
  return ACCOUNT;
}

// Lock/unlock an item via the Bungie API. Needs the MoveEquipDestinyItems OAuth
// scope on the app — if missing, Bungie returns an auth error we pass through.
async function setLock(e, itemId, locked) {
  const tok = await accessToken(e);
  if (!LOCK_CTX) await fetchProfile(e);
  await bungiePost(`${BASE}/Destiny2/Actions/Items/SetLockState/`, {
    state: !!locked, itemId, characterId: LOCK_CTX.characterId, membershipType: LOCK_CTX.membershipType,
  }, e, tok.access_token);
}

// Move an item between a character and the vault. `characterId` is the character
// the item moves FROM (toVault) or TO (from vault). Needs the same write scope as lock.
async function transferItem(e, itemId, hash, characterId, toVault) {
  const tok = await accessToken(e);
  await bungiePost(`${BASE}/Destiny2/Actions/Items/TransferItem/`, {
    itemReferenceHash: Number(hash), stackSize: 1, transferToVault: !!toVault,
    itemId, characterId, membershipType: LOCK_CTX.membershipType,
  }, e, tok.access_token);
}

async function equipItem(e, itemId, characterId) {
  const tok = await accessToken(e);
  await bungiePost(`${BASE}/Destiny2/Actions/Items/EquipItem/`, {
    itemId, characterId, membershipType: LOCK_CTX.membershipType,
  }, e, tok.access_token);
}

// Send a weapon copy to the vault. `ownClass` is where it currently lives
// (a class name, or 'Vault' if already stored). Returns its new location.
async function vaultWeapon(e, itemId, hash, ownClass) {
  if (!LOCK_CTX) await fetchProfile(e);
  if (ownClass === 'Vault') return { own: 'Vault' };
  const src = LOCK_CTX.byClass[ownClass] || LOCK_CTX.characterId;
  await transferItem(e, itemId, hash, src, true);
  return { own: 'Vault' };
}

// Equip a weapon copy. If it's on a character, equip it there; if it's in the
// vault, pull it to the default character first, then equip. A weapon can be
// equipped by any class. Returns the character it ended up equipped on.
async function equipWeapon(e, itemId, hash, ownClass) {
  if (!LOCK_CTX) await fetchProfile(e);
  let target;
  if (ownClass && ownClass !== 'Vault') {
    target = LOCK_CTX.byClass[ownClass] || LOCK_CTX.characterId;
  } else {
    target = LOCK_CTX.characterId;
    await transferItem(e, itemId, hash, target, false);
  }
  await equipItem(e, itemId, target);
  return { own: LOCK_CTX.clsById[target] || ownClass };
}

// Vault every UNEQUIPPED weapon and/or armor piece sitting in a character's inventory,
// freeing all 9 stored slots per bucket. kind = 'weapons' | 'armor' | 'both'.
async function cleanInventory(e, characterId, kind) {
  const { prof, man } = await fetchProfile(e);
  const inv = prof.characterInventories?.data?.[characterId]?.items || [];
  const wantW = kind === 'weapons' || kind === 'both';
  const wantA = kind === 'armor' || kind === 'both';
  let moved = 0, failed = 0;
  for (const it of inv) {
    if (!it.itemInstanceId) continue;
    const d = man.items[it.itemHash]; if (!d) continue;
    const isW = d.it === 3 && WBUCKET[d.b], isA = d.it === 2 && BUCKET[d.b];
    if (!((isW && wantW) || (isA && wantA))) continue;    // only weapons/armor, skip mods/postmaster
    try { await transferItem(e, it.itemInstanceId, it.itemHash, characterId, true); moved++; }
    catch { failed++; }
  }
  return { moved, failed };
}

// Pick a legendary weapon in a given slot (bucket) from a set of items, preferring the
// same ammo type as the exotic being freed. Returns {id,hash,name,ammo} or null.
function pickSlotLegendary(items, man, bucket, ammo, exclude) {
  const out = [];
  for (const it of items || []) {
    if (!it.itemInstanceId || exclude.includes(it.itemInstanceId)) continue;
    const d = man.items[it.itemHash];
    if (!d || d.it !== 3 || d.b !== bucket || d.tt !== 5) continue; // legendary weapon, same slot
    out.push({ id: it.itemInstanceId, hash: it.itemHash, name: d.n, ammo: d.ammo });
  }
  out.sort((a, b) => (b.ammo === ammo) - (a.ammo === ammo)); // same-ammo first
  return out[0] || null;
}

// Equip a weapon, handling the exotic swap DIM does messily. Bungie AUTO-unequips an
// existing exotic when you equip a second one, but leaves that slot however it likes.
// To control it we first equip a matching-ammo legendary into the old exotic's slot —
// but ONLY one already on the character, never a vault pull (Bungie forbids vault
// transfers inside activities: DestinyCannotPerformActionAtThisLocation — which is
// exactly why the old vault-fallback failed where DIM's plain equip works). If there's
// no spare on the character, we skip the clean swap and just equip (like DIM). dryRun
// returns the plan without moving anything.
async function smartEquipWeapon(e, itemId, hash, ownClass, dryRun) {
  const { prof, man } = await fetchProfile(e);
  const target = (ownClass && ownClass !== 'Vault') ? (LOCK_CTX.byClass[ownClass] || LOCK_CTX.characterId) : LOCK_CTX.characterId;
  const bDef = man.items[hash] || {};
  let swap = null;
  if (bDef.tt === 6 && bDef.it === 3) { // equipping an exotic weapon
    const equipped = prof.characterEquipment?.data?.[target]?.items || [];
    const a = equipped
      .map((it) => ({ it, d: man.items[it.itemHash] }))
      .find((x) => x.d && x.d.it === 3 && x.d.tt === 6 && x.d.b !== bDef.b && x.it.itemInstanceId !== itemId);
    if (a) { // a conflicting exotic is equipped in another slot
      const excl = [itemId, a.it.itemInstanceId];
      const onChar = pickSlotLegendary(prof.characterInventories?.data?.[target]?.items, man, a.d.b, a.d.ammo, excl);
      const vaultRepl = onChar ? null : pickSlotLegendary(prof.profileInventory?.data?.items, man, a.d.b, a.d.ammo, excl);
      if (onChar) {
        swap = { removed: a.d.n, added: onChar.name };
        if (!dryRun) await equipItem(e, onChar.id, target); // no transfer — works in activities
      } else if (vaultRepl) {
        // best option is in the vault; the transfer only works outside activities.
        swap = { removed: a.d.n, added: vaultRepl.name, fromVault: true };
        if (!dryRun) {
          try { await transferItem(e, vaultRepl.id, vaultRepl.hash, target, false); await equipItem(e, vaultRepl.id, target); }
          catch (err) { swap = { removed: a.d.n, added: null, note: `couldn't pull ${vaultRepl.name} from the vault here — equipped directly, game moved ${a.d.n}` }; }
        }
      } else {
        swap = { removed: a.d.n, added: null, note: `no spare ${a.d.ty || 'weapon'} on your character — equipped directly, game moved ${a.d.n}` };
      }
    }
  }
  // pulling from the vault: a character slot holds 1 equipped + up to 9 stored, and Bungie
  // refuses to pull a 10th (DestinyNoRoomInDestination) — THIS is why equip "didn't work" on a
  // full slot. So if the slot is full, vault one (preferably unlocked) weapon first to make room.
  let spill = null;
  if (!ownClass || ownClass === 'Vault') {
    const inv = prof.characterInventories?.data?.[target]?.items || [];
    const slotItems = inv.filter((it) => it.itemInstanceId && it.itemInstanceId !== itemId && man.items[it.itemHash]?.b === bDef.b);
    if (slotItems.length >= 9) {
      const pick = slotItems.find((it) => !(it.state & 1)) || slotItems[0]; // prefer an unlocked one
      const sd = pick && man.items[pick.itemHash];
      if (pick) spill = { id: pick.itemInstanceId, hash: pick.itemHash, name: (sd && sd.n) || 'a weapon' };
    }
  }
  if (dryRun) return { own: LOCK_CTX.clsById[target] || ownClass, swap, spill: spill && spill.name, dryRun: true, target: LOCK_CTX.clsById[target] };
  if (!ownClass || ownClass === 'Vault') {
    if (spill) { try { await transferItem(e, spill.id, spill.hash, target, true); } catch (err) {} } // make space
    await transferItem(e, itemId, hash, target, false);
  }
  await equipItem(e, itemId, target);
  return { own: LOCK_CTX.clsById[target] || ownClass, swap, spill: spill && spill.name };
}

// ---------- fashion (armor ornaments + shaders) ----------
// Cosmetic sockets on equipped armor: the shader plug has plugCategory 'shader';
// the ornament plug's category starts with 'armor_skins_' (e.g. armor_skins_warlock_head).
const ARMOR_BUCKETS = { 3448274439: 'Helmet', 3551918588: 'Gauntlets', 14239492: 'Chest', 20886954: 'Legs', 1585787867: 'Class' };
// cosmetic slots we manage: armor + ghost shell + vehicle (sparrow). Their equipped item's
// shader socket (plug pc 'shader') and ornament socket are captured for save/apply.
const COSMETIC_BUCKETS = { ...ARMOR_BUCKETS, 4023194814: 'Ghost', 2025709351: 'Vehicle' };
const SLOT_ORDER = ['Helmet', 'Gauntlets', 'Chest', 'Legs', 'Class', 'Ghost', 'Vehicle'];
// ornament plug category by slot (verified live): armor = armor_skins_*, ghost = its
// hologram/projection socket. Vehicles/sparrows have only a shader (no visual ornament).
const isOrnPc = (pc, slot) => !!pc && (pc.startsWith('armor_skins_') || (slot === 'Ghost' && pc === 'hologram'));
// ghost/vehicle item defs aren't in the slim manifest — fetch name/icon on demand (cached).
const ITEMDEF_CACHE = {};
async function itemDefLite(hash, e) {
  if (ITEMDEF_CACHE[hash]) return ITEMDEF_CACHE[hash];
  try { const r = await bungie(`${BASE}/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`, e); ITEMDEF_CACHE[hash] = { n: r?.displayProperties?.name || '', icon: r?.displayProperties?.icon || '' }; }
  catch { ITEMDEF_CACHE[hash] = { n: '', icon: '' }; }
  return ITEMDEF_CACHE[hash];
}

async function fetchFashion(e) {
  const { prof, man, m } = await fetchProfile(e);
  const sockets = prof.itemComponents?.sockets?.data || {};
  const chars = {};
  for (const [cid, c] of Object.entries(prof.characters?.data || {})) {
    const slots = {};
    for (const it of prof.characterEquipment?.data?.[cid]?.items || []) {
      const def = man.items[it.itemHash];   // ghost/vehicle item defs aren't in the slim manifest
      const slot = COSMETIC_BUCKETS[it.bucketHash] || COSMETIC_BUCKETS[def?.b];
      if (!slot || !it.itemInstanceId) continue;
      let name = def?.n || '', icon = def?.icon || '';
      if (!def) { const idf = await itemDefLite(it.itemHash, e); name = idf.n || slot; icon = idf.icon; }
      let orn = null, shd = null;
      (sockets[it.itemInstanceId]?.sockets || []).forEach((s, idx) => {
        if (!s.plugHash) return;
        const p = man.items[s.plugHash]; if (!p) return;
        if (p.pc === 'shader') shd = { hash: s.plugHash, name: p.n, icon: p.icon || '', idx };
        else if (isOrnPc(p.pc, slot)) orn = { hash: s.plugHash, name: p.n, icon: p.icon || '', idx };
      });
      slots[slot] = { itemId: it.itemInstanceId, hash: it.itemHash, name, icon, orn, shd };
    }
    chars[cid] = { cls: CLASS[c.classType] || 'Unknown', slots };
  }
  return { characters: chars, order: SLOT_ORDER, account: `${m.membershipType}/${m.membershipId}` };
}

// Apply a saved look to a character's currently-equipped armor. Inserts the saved
// ornament + shader plug into each piece's cosmetic sockets (skips ones already set).
// Requires the character to be in orbit (Bungie returns DestinyCharacterNotInTower otherwise).
async function applyLook(e, characterId, look) {
  const tok = await accessToken(e);
  if (!LOCK_CTX) await fetchProfile(e);
  const fashion = await fetchFashion(e);
  const ch = fashion.characters[characterId];
  if (!ch) throw new Error('character not found');
  const results = [];
  for (const slot of SLOT_ORDER) {
    const want = (look.slots || {})[slot]; if (!want) continue;
    const cur = ch.slots[slot];
    if (!cur) { results.push({ slot, ok: false, msg: 'nothing equipped' }); continue; }
    for (const kind of ['orn', 'shd']) {
      const wantHash = want[kind]; if (!wantHash) continue;
      const sock = cur[kind];
      if (!sock) { results.push({ slot, kind, ok: false, msg: `no ${kind === 'orn' ? 'ornament' : 'shader'} socket` }); continue; }
      if (sock.hash === wantHash) { results.push({ slot, kind, ok: true, msg: 'already set' }); continue; }
      try {
        await bungiePost(`${BASE}/Destiny2/Actions/Items/InsertSocketPlugFree/`, {
          plug: { socketIndex: sock.idx, socketArrayType: 0, plugItemHash: Number(wantHash) },
          itemId: cur.itemId, characterId, membershipType: LOCK_CTX.membershipType,
        }, e, tok.access_token);
        results.push({ slot, kind, ok: true });
      } catch (err) { results.push({ slot, kind, ok: false, msg: err.message }); }
    }
  }
  return results;
}

// ---------- profile -> armor items ----------
async function fetchArmor(e) {
  const { prof, man, m, raw } = await fetchProfile(e);
  const { tags, loadoutCount } = dimOverlay();

  const instances = prof.itemComponents?.instances?.data || {};
  const liveStats = prof.itemComponents?.stats?.data || {};
  const sockets = prof.itemComponents?.sockets?.data || {};

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
    let archetype = '', tune = '', tuneKind = 'none';
    for (const s of sockets[id]?.sockets || []) {
      if (!s.plugHash || s.isEnabled === false) continue;
      const p = man.items[s.plugHash];
      if (!p) continue;
      if (ARCH_NAMES.has(p.n)) archetype = p.n;
      // Armor 3.0 tuning socket (Build Crafter, 2026-07-12): expose the socketed tuning
      // plug. "Balanced Tuning" carries NO inv (its +1×3-lowest stats are conditionally
      // active, which the slimmer drops) — detect by name; "+X / -Y" stat tunings carry inv.
      if (p.pc && p.pc.includes('tuning.mods') && !p.n.startsWith('Empty')) {
        tune = p.n;
        tuneKind = p.n === 'Balanced Tuning' ? 'balanced' : p.n.startsWith('+') ? 'stat' : 'none';
      }
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
      n: def.n, id, hash: it.itemHash, icon: def.icon || '',
      tag: dim.tag || '', note: dim.note || '',
      x: def.tt === 6, t: inst.gearTier ?? 0,
      slot, cls: CLASS[def.c] || '—', src: def.src || '',
      a: archetype, ter, mw: 0, tune, tuneKind,
      pwr: inst.primaryStat?.value || 0, own,
      lo: loadoutCount[id] || 0,
      s: base, tot: Object.values(base).reduce((a, b) => a + b, 0),
      set: setDef?.n || def.n, sb: setDef?.n || '',
    });
  }

  // sets payload from live manifest (only sets present in the vault);
  // src = drop location from the collectible sourceString of any piece in the set
  const setsOut = {};
  for (const i of out) {
    if (!i.sb || setsOut[i.sb]) continue;
    const sd = Object.values(man.sets).find((s) => s.n === i.sb);
    if (!sd) continue;
    const p2 = sd.perks.find((p) => p.count === 2), p4 = sd.perks.find((p) => p.count === 4);
    setsOut[i.sb] = { src: curatedSrc(i.sb) || sd.src || '', p2: [p2?.n || '2-piece', p2?.d || ''], p4: [p4?.n || '4-piece', p4?.d || ''] };
  }
  return { items: out, sets: setsOut, fetchedAt: new Date().toISOString(), account: `${m.membershipType}/${m.membershipId}` };
}

// ---------- profile -> weapons (god-roll tracker) ----------
const WBUCKET = { 1498876634: 'Kinetic', 2465295065: 'Energy', 953998645: 'Power' };
const AMMO = { 1: 'Primary', 2: 'Special', 3: 'Heavy' };
const DMG = { 1: 'Kinetic', 2: 'Arc', 3: 'Solar', 4: 'Void', 6: 'Stasis', 7: 'Strand' };
// official element/subclass icons (bungie.net paths) keyed by damage-type enum, fetched once
let DMG_ICONS = null;
async function loadDamageIcons(e) {
  if (DMG_ICONS) return DMG_ICONS;
  DMG_ICONS = {};
  try {
    const meta = await bungie(`${BASE}/Destiny2/Manifest/`, e);
    const p = meta.jsonWorldComponentContentPaths.en.DestinyDamageTypeDefinition;
    const raw = await fetch(`https://www.bungie.net${p}`).then((r) => r.json());
    for (const d of Object.values(raw)) if (d.enumValue != null && d.displayProperties?.icon) DMG_ICONS[d.enumValue] = d.displayProperties.icon;
  } catch (err) { console.warn('damage icons load failed:', err.message); }
  return DMG_ICONS;
}

async function fetchWeapons(e) {
  const { prof, man, m, raw } = await fetchProfile(e);
  const tags = await dimTagsFresh(e);   // live DIM tags (id -> tag), source of truth
  const clarity = await loadClarity(man);   // community insights for the perk hover popup
  const dmgIcons = await loadDamageIcons(e); // official element icons for the tiles
  const POP = await perkPopMap(e);   // perk name -> community popularity, for most-popular-first ordering

  const instances = prof.itemComponents?.instances?.data || {};
  const liveStats = prof.itemComponents?.stats?.data || {};
  const sockets = prof.itemComponents?.sockets?.data || {};
  const reusable = prof.itemComponents?.reusablePlugs?.data || {};
  const plugObj = prof.itemComponents?.plugObjectives?.data || {};

  const weapons = [], defsOut = {}, perkIcons = {}, perkDescs = {}; // perk name -> icon path / in-game description
  const px = (n, h) => { const it = man.items[h]; if (!it) return; if (it.icon && !perkIcons[n]) perkIcons[n] = it.icon; if (it.dsc && !perkDescs[n]) perkDescs[n] = it.dsc; };
  for (const { it, own, loc: rawLoc, cid } of raw) {
    const def = man.items[it.itemHash];
    if (!def || def.it !== 3 || !it.itemInstanceId || !WBUCKET[def.b]) continue;
    // Postmaster items live in characterInventories (so raw marks them 'char'), but the
    // def bucket still reads as the weapon slot. Tag them 'postmaster' so a character's
    // real inventory stays <=9 (the "14 tiles" bug) and the UI can show them separately.
    const loc = it.bucketHash === 215593132 ? 'postmaster' : rawLoc;
    const id = it.itemInstanceId;
    const inst = instances[id] || {};
    const socks = sockets[id]?.sockets || [];
    const reuse = reusable[id]?.plugs || {};

    // kill tracker: the tracker plug (pc contains 'masterworks.trackers') carries an
    // objective whose progress = the weapon's kill count (whatever tracker is selected).
    let kills = 0;
    const trackSock = socks.find((s) => s.plugHash && /masterworks\.trackers/.test(man.items[s.plugHash]?.pc || ''));
    if (trackSock) {
      const objs = plugObj[id]?.objectivesPerPlug?.[trackSock.plugHash] || [];
      for (const o of objs) if ((o.progress || 0) > kills) kills = o.progress;
    }

    // trait columns: every perk available on THIS roll (multi-perk drops included).
    // Perks are identified by NAME: enhanced and normal variants of the same perk
    // have different hashes, and the watch config must match either.
    const cols = [[], []];
    (def.ti || []).forEach((si, ci) => {
      if (si < 0) return;
      const opts = reuse[si]?.map((p) => p.plugItemHash) || (socks[si]?.plugHash ? [socks[si].plugHash] : []);
      const byName = new Map();
      for (const h of opts) {
        const n = foldPerkName(man.items[h]?.n) || `#${h}`;
        if (!byName.has(n)) byName.set(n, { n, on: false });
        if (socks[si]?.plugHash === h) byName.get(n).on = true;
        px(n, h);
      }
      cols[ci] = [...byName.values()].sort(byPop(POP));   // most-popular perk first
    });

    // masterwork: plug category 'masterworks.stat.<stat>'
    let mw = '', mwIcon = '';
    for (const s of socks) {
      const mm = s.plugHash && man.items[s.plugHash]?.pc.match(/masterworks\.stat\.(\w+)/);
      if (mm) { mw = mm[1]; mwIcon = man.items[s.plugHash]?.icon || ''; break; }
    }

    const stats = {};
    for (const [sh, sv] of Object.entries(liveStats[id]?.stats || {})) {
      const nm = man.statNames[sh];
      if (nm) stats[nm] = sv.value;
    }

    // highest possible value of each stat on THIS roll: live value + the best
    // swap among this roll's barrel/magazine options (they carry stat bonuses)
    const statsMax = { ...stats };
    for (const si of def.bi || []) {
      if (si < 0) continue;
      const curWi = man.items[socks[si]?.plugHash]?.wi || {};
      const opts = reuse[si]?.map((p) => p.plugItemHash) || (socks[si]?.plugHash ? [socks[si].plugHash] : []);
      const bestDelta = {};
      for (const h of opts) {
        const wi = man.items[h]?.wi || {};
        for (const sh of new Set([...Object.keys(wi), ...Object.keys(curWi)])) {
          const d2 = (wi[sh] || 0) - (curWi[sh] || 0);
          if (d2 > (bestDelta[sh] || 0)) bestDelta[sh] = d2;
        }
      }
      for (const [sh, d2] of Object.entries(bestDelta)) {
        const nm = man.statNames[sh];
        if (nm && statsMax[nm] !== undefined) statsMax[nm] = statsMax[nm] + d2;
      }
    }

    if (!defsOut[it.itemHash]) {
      defsOut[it.itemHash] = {
        n: def.n, ty: def.ty, tt: def.tt, slot: WBUCKET[def.b],
        ammo: AMMO[def.ammo] || '', dmg: DMG[def.dmg] || '', dmgIcon: dmgIcons[def.dmg] || '', src: def.src || '',
        icon: def.icon || '', shot: def.shot || '',
        pool: (def.tr || []).map((ps) => {
          const names = new Set();
          for (const h of (man.plugSets[ps] || [])) { const n = foldPerkName(man.items[h]?.n) || `#${h}`; names.add(n); px(n, h); }
          return [...names].sort(byPop(POP));   // most-popular perk first
        }),
      };
    }
    weapons.push({
      id, hash: it.itemHash, rhash: it.itemHash, own, loc, ownCid: cid, locked: !!(it.state & 1),
      tag: tags[id] || '', pwr: inst.primaryStat?.value || 0, kills,
      cols, mw, mwIcon, stats, statsMax,
    });
  }

  // Merge reissued weapons: the same weapon reissued across seasons keeps its name
  // (and type/ammo/damage) but gets a new item hash, so it showed up as duplicate
  // entries. Collapse each such group to one canonical entry — union the perk pools
  // (a reissue can add/drop a few perks) and repoint every owned copy to the canonical
  // hash. Grouped by name+type+ammo+damage so a genuine name-collision across weapon
  // types would stay separate.
  const groups = {};
  for (const [h, def] of Object.entries(defsOut)) {
    const gk = `${def.n}|${def.ty}|${def.ammo}|${def.dmg}`;
    (groups[gk] = groups[gk] || []).push(h);
  }
  const canonical = {}, mergedDefs = {};
  for (const hashes of Object.values(groups)) {
    const canon = hashes.slice().sort((a, b) => Number(a) - Number(b))[0];
    const base = { ...defsOut[canon] };
    const cols = [[], []];
    for (const h of hashes) (defsOut[h].pool || []).forEach((col, ci) => {
      for (const p of col) if (!cols[ci].includes(p)) cols[ci].push(p);
    });
    base.pool = cols;
    base.versions = hashes.length;
    if (!base.src) base.src = hashes.map((h) => defsOut[h].src).find(Boolean) || '';
    mergedDefs[canon] = base;
    for (const h of hashes) canonical[h] = canon;
  }
  for (const w of weapons) w.hash = canonical[w.hash] || w.hash;

  // Farm-watch reconciliation (2026-07-12): a weapon watched while UNOWNED is keyed by the
  // weapon-pools manifest hash. When a copy finally drops, its owned def lives under the
  // reissue-merged CANONICAL hash — remap the watch entry by NAME so the watch lights up
  // (rollScore, /drops, god-roll alerts) without Diego redoing his perk tracking.
  {
    const watch = loadWatch() || {}; let remapped = false;
    const byName = {}; for (const [h, d] of Object.entries(mergedDefs)) byName[d.n] = h;
    for (const [h, cfg] of Object.entries(watch)) {
      if (mergedDefs[h] || !cfg?.name) continue;
      const canon = byName[cfg.name];
      if (!canon) continue;   // genuinely unowned — stays a farm watch under the pool hash
      if (!watch[canon]) watch[canon] = cfg;
      else {   // BOTH exist (old Perk Finder farm-save + a later owned watch) → merge, owned entry wins conflicts
        const t = watch[canon];
        t.perks = { ...(cfg.perks || {}), ...(t.perks || {}) };
        if (!t.mw && cfg.mw) t.mw = cfg.mw;
        if ((!t.stats || !t.stats.length) && (cfg.stats || []).length) t.stats = cfg.stats;
      }
      delete watch[h]; remapped = true;
    }
    if (remapped) saveWatch(watch);
  }

  // new-drop detection: flag copies whose instance id we haven't seen before.
  const seen = loadSeen();
  if (!seen.seeded) { for (const w of weapons) seen.ids.add(w.id); seen.seeded = true; saveSeen(seen); }
  for (const w of weapons) w.fresh = !seen.ids.has(w.id);

  const perkInsights = {};   // name -> cleaned community-insight BULLETS ([{type,text}]), for perks we show
  for (const n of new Set([...Object.keys(perkIcons), ...Object.keys(perkDescs)])) {
    const b = insightBullets(n); if (b && b.length) perkInsights[n] = b;
  }
  // mark app-applied favorites so the UI can paint them green vs Diego's own (pink).
  const autoFav = loadAutoFavSet();
  for (const w of weapons) w.autoFav = w.tag === 'favorite' && autoFav.has(w.id);
  // match each roll against Diego's saved Perk Finder combos → combo names (extra weight in
  // auto-manage scoring) + a PVE/PVP roll tag: PVP only when a pvp-role combo matches this
  // roll; every other roll reads PVE (Diego: "what's not PVP is considered PVE").
  const combos = loadCombos();
  for (const w of weapons) {
    const hits = comboMatches(w, combos);
    w.combos = hits.map((c) => c.name).filter(Boolean);
    w.rollTag = hits.some((c) => String(c.role || '').toLowerCase() === 'pvp') ? 'pvp' : 'pve';
  }
  // THE score (Diego 2026-07-09: "the only score that's important is the actual roll") —
  // computed ONCE here so every page and the Auto-Manager show the same number per copy:
  // watched weapon → tracked-perk match % (scoreWeaponCopy); anything else → grade-normalized
  // ★-favorite score of the roll (favRollScore), floored at comboFloor on a saved-combo match.
  // w.rollScore (-1 = no signal), w.rollBasis 'watched'|'favorites', w.comboFloored.
  {
    const watch = loadWatch(), fav = loadFav(), floor = loadAuto().thr?.comboFloor ?? 80;
    // Tracked-perk union (Diego 2026-07-16: "app is not considering the tracked perks to
    // score unwatched weapons — afraid it will junk actual good rolls"). Every perk tracked
    // on ANY watched weapon counts as at least a 2★ favorite when scoring UNWATCHED weapons
    // (22 tracked perks had no ★ at all, so rolls carrying them read 0% → junk). 2★, not 3★,
    // on purpose: two tracked perks = 75% — above the junk bar (60) but below keep (80) and
    // favorite (90), so tracking alone can never mass-keep/favorite; explicit 3★ stars win.
    const favEff = { ...fav };
    for (const cfg of Object.values(watch))
      for (const n of Object.keys(cfg.perks || {}))
        if (!(favEff[n] >= 2)) favEff[n] = 2;
    const byH = {};
    for (const w of weapons) (byH[w.hash] = byH[w.hash] || []).push(w);
    for (const [h, copies] of Object.entries(byH)) {
      const cfg = watch[h];
      // "watched" = ANY tracked criteria (perks OR masterwork OR stats). Perks-only was the old
      // test — a weapon tracking just a MW/stat scored by favorites here while every page showed
      // the perk-match number (found in the 2026-07-12 one-global-score audit).
      if (cfg && (Object.keys(cfg.perks || {}).length || cfg.mw || (cfg.stats || []).length)) {
        const r = {};
        for (const s of (cfg.stats || [])) { const vals = [...new Set(copies.map((x) => x.statsMax[s] ?? -1))].sort((a, b) => b - a); r[s] = (v) => { const i = vals.indexOf(v); return i === 0 ? 's1' : i === 1 ? 's2' : i === 2 ? 's3' : ''; }; }
        const crit = Object.keys(cfg.perks || {}).length + (cfg.mw ? 1 : 0) + (cfg.stats || []).length;
        for (const w of copies) { w.rollScore = scoreWeaponCopy(w, cfg, r).pct; w.rollBasis = 'watched'; w.rollCrit = crit; w.comboFloored = false; }
      } else {
        for (const w of copies) {
          let sc = favRollScore(w, favEff);
          w.comboFloored = !!(w.combos || []).length && sc < floor;
          if (w.comboFloored) sc = floor;
          w.rollScore = sc; w.rollBasis = 'favorites';
        }
      }
    }
  }
  // Compact ARMOR list for junk-staging (Diego 2026-07-12: staging only, NEVER tag armor).
  // tag = the live DIM tag (same source as weapons — NOT the optional dim-data.json overlay
  // that the armor page merges). Only what staging needs; the armor page keeps fetchArmor.
  const armor = [];
  for (const { it, own, loc: rawLoc, cid } of raw) {
    const def = man.items[it.itemHash];
    if (!def || def.it !== 2 || !it.itemInstanceId || !BUCKET[def.b]) continue;
    const loc = it.bucketHash === 215593132 ? 'postmaster' : rawLoc;
    const inst = instances[it.itemInstanceId] || {};
    armor.push({
      id: it.itemInstanceId, hash: it.itemHash, rhash: it.itemHash, n: def.n,
      slot: BUCKET[def.b], tt: def.tt, own, loc, ownCid: cid,
      locked: !!(it.state & 1), pwr: inst.primaryStat?.value || 0,
      tag: tags[it.itemInstanceId] || '',
    });
  }

  return { weapons, armor, defs: mergedDefs, perkIcons, perkDescs, perkInsights, fetchedAt: new Date().toISOString(), account: `${m.membershipType}/${m.membershipId}` };
}

// ---------- god-roll watch config + local tag overlay ----------
const WATCH_FILE = path.join(__dirname, 'weapon-watch.json');
const TAGS_FILE = path.join(__dirname, 'weapon-tags.json'); // instanceId -> keep|favorite|junk|none (overrides DIM tag in the UI)
const loadJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
// Write with a one-step backup: the previous file contents are copied to <file>.bak
// before every overwrite, so an accidental wipe (empty POST, bad edit) is always
// one restore away. Also refuse to blank a non-empty file to {} without the caller
// meaning it — an empty body is almost always a mistake, so we keep the .bak either way.
function saveJsonSafe(file, obj) {
  try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch {}
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
const loadWatch = () => loadJson(WATCH_FILE);
const saveWatch = (w) => saveJsonSafe(WATCH_FILE, w);
const loadTags = () => loadJson(TAGS_FILE);
const saveTags = (t) => saveJsonSafe(TAGS_FILE, t);

// Seen-instances store for new-drop detection. First fetch seeds every current id
// (so nothing is falsely "new"); after that any unseen instance id is a fresh drop.
// Ack (from the Drops dashboard, or later the alert poller) moves ids into seen.
const SEEN_FILE = path.join(__dirname, 'weapon-seen.json');
const loadSeen = () => { const s = loadJson(SEEN_FILE); return { seeded: !!s.seeded, ids: new Set(s.ids || []) }; };
const saveSeen = (s) => saveJsonSafe(SEEN_FILE, { seeded: s.seeded, ids: [...s.ids] });

const FASHION_FILE = path.join(__dirname, 'fashion.json'); // saved looks: [{name, cls, slots:{Helmet:{orn,shd},...}}]
const loadLooks = () => { const l = loadJson(FASHION_FILE); return Array.isArray(l) ? l : []; };
const saveLooks = (l) => saveJsonSafe(FASHION_FILE, l);

// ---------- Perk Finder: DIM community wishlist ("popularity") + full perk library ----------
// light.gg has no public API, so "popularity" here = how often each perk appears across
// the community's aggregated god-rolls (the DIM "voltron" list, 40+ curators). Each roll's
// notes tell us if it's a PvE or PvP roll, so we can show a perk's PvE vs PvP lean too.
const WISHLIST_URL = 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt';
const WISHLIST_FILE = path.join(__dirname, '.dim-wishlist.json');
const WISHLIST_MAX_AGE = 7 * 864e5; // re-download weekly
let WISHLIST = null, PERKLIB = null;

// Enhanced and base perks normally share the EXACT SAME manifest display name (that's how
// every perk list in this file folds them together into one entry) — but at least one perk
// (Golden Tricorn) breaks that convention and literally has "Enhanced" baked into its name,
// so it was showing up as a separate, near-empty duplicate everywhere perks are listed.
// Strip a trailing " Enhanced" so this perk folds like every other enhanced/base pair.
const foldPerkName = (n) => (n || '').replace(/\s+Enhanced$/, '');

// Track which DISTINCT WEAPONS (by name, reissues folded together) each perk is recommended
// for, rather than a raw count of curated roll-lines. Raw roll-line counts badly inflate old
// perks: the voltron list accumulates roll variants for the same long-lived weapons over many
// years, so an ancient perk racks up dozens of near-duplicate roll entries for a handful of
// legacy weapons while a perk added last season has only had a few months to accumulate any.
// Counting "how many different weapons recommend this perk" instead is immune to that kind of
// repeat-curation pile-up; buildPerkLibrary turns it into a rate (see wilsonLB below).
function parseWishlist(text, man) {
  const weapons = {}, pve = {}, pvp = {}; // perk hash -> Set(weapon name)
  let ctx = ''; // pve/pvp context from the most recent notes/title block
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { ctx = ''; continue; }
    if (line.startsWith('dimwishlist:')) {
      const mi = line.match(/item=(\d+)/); const mp = line.match(/perks=([\d,]+)/);
      if (!mi || !mp) continue;
      const wname = man.items[mi[1]]?.n; if (!wname) continue;
      const hi = line.indexOf('#');
      const t = (hi >= 0 ? line.slice(hi + 1) : ctx).toLowerCase();
      const isPvp = /pvp/.test(t), isPve = /pve/.test(t);
      for (const h of mp[1].split(',')) {
        if (!h) continue;
        (weapons[h] || (weapons[h] = new Set())).add(wname);
        if (isPve) (pve[h] || (pve[h] = new Set())).add(wname);
        if (isPvp) (pvp[h] || (pvp[h] = new Set())).add(wname);
      }
    } else if (line.startsWith('//') || line.startsWith('title:') || line.startsWith('description:')) {
      ctx = line.toLowerCase();
    }
  }
  const byName = {};
  for (const [h, set] of Object.entries(weapons)) {
    const n = foldPerkName(man.items[h]?.n); if (!n) continue;
    const b = byName[n] || (byName[n] = { weapons: new Set(), pve: new Set(), pvp: new Set() });
    for (const wn of set) b.weapons.add(wn);
    for (const wn of (pve[h] || [])) b.pve.add(wn);
    for (const wn of (pvp[h] || [])) b.pvp.add(wn);
  }
  // serialize Sets to arrays for the on-disk JSON cache
  const out = {};
  for (const [n, b] of Object.entries(byName)) out[n] = { weapons: [...b.weapons], pve: [...b.pve], pvp: [...b.pvp] };
  return out;
}

// Wilson score lower bound: ranks a "rate" (successes/n) so that small-sample items don't
// unfairly outrank large-sample ones just by getting lucky (e.g. a perk on only 2 current
// weapons, both curator-picked, would be a naive "100%" — Wilson pulls that down below a
// perk recommended on 80 of 100 possible weapons, which is a much better-supported signal).
// Same statistic Reddit uses for comment ranking; z=1.96 is the standard 95%-confidence value.
function wilsonLB(successes, n, z = 1.96) {
  if (!n) return 0;
  const p = successes / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

async function loadWishlist(man, fresh = false) {
  if (WISHLIST && !fresh) return WISHLIST;
  if (!fresh) {
    try {
      const st = fs.statSync(WISHLIST_FILE);
      const cached = JSON.parse(fs.readFileSync(WISHLIST_FILE, 'utf8'));
      // guard against a stale cache written before the weapons-per-perk rewrite (old shape was
      // {total,pve,pvp} numbers) — force a re-download rather than silently degrading to 0 pop
      const sample = Object.values(cached.perks || {})[0];
      const shapeOk = !sample || Array.isArray(sample.weapons);
      if (shapeOk && Date.now() - st.mtimeMs < WISHLIST_MAX_AGE) return (WISHLIST = cached);
    } catch {}
  }
  try {
    console.log('Downloading DIM community wishlist (one-time / weekly, ~25MB)...');
    const text = await fetch(WISHLIST_URL).then((r) => r.text());
    WISHLIST = { generatedAt: new Date().toISOString(), perks: parseWishlist(text, man) };
    fs.writeFileSync(WISHLIST_FILE, JSON.stringify(WISHLIST));
    console.log(`Wishlist parsed: ${Object.keys(WISHLIST.perks).length} perks ranked by community god-rolls.`);
  } catch (err) {
    console.warn('wishlist download failed:', err.message);
    try { WISHLIST = JSON.parse(fs.readFileSync(WISHLIST_FILE, 'utf8')); }
    catch { WISHLIST = { generatedAt: null, perks: {} }; }
  }
  return WISHLIST;
}

// ---------- Clarity community insights (the same data DIM shows on perks) ----------
// Clarity (github.com/Database-Clarity) publishes crowd-sourced, numbers-accurate perk
// descriptions as open JSON. DIM surfaces these as "Community Insights". We download the
// DIM-formatted file, flatten each perk's text, and fold hash -> our manifest perk NAME
// so the tooltip can look it up the same way it looks up icons.
const CLARITY_URL = 'https://database-clarity.github.io/Live-Clarity-Database/descriptions/dim.json';
const CLARITY_FILE = path.join(__dirname, '.clarity.json');
const CLARITY_MAX_AGE = 7 * 864e5; // re-download weekly
let CLARITY = null;

function flattenClarity(entry) {
  const en = entry?.descriptions?.en;
  if (!Array.isArray(en)) return '';
  return en.map((b) => (b.linesContent || []).map((l) => l.text || '').join('\n').trim())
    .filter(Boolean).join('\n\n').trim();
}

async function loadClarity(man, fresh = false) {
  if (CLARITY && !fresh) return CLARITY;
  if (!fresh) {
    try {
      const st = fs.statSync(CLARITY_FILE);
      if (Date.now() - st.mtimeMs < CLARITY_MAX_AGE) {
        const c = JSON.parse(fs.readFileSync(CLARITY_FILE, 'utf8'));
        if (c.byItem) return (CLARITY = c);   // old cache without byItem → fall through and re-download
      }
    } catch {}
  }
  try {
    console.log('Downloading Clarity community insights (one-time / weekly)...');
    const raw = await fetch(CLARITY_URL).then((r) => r.json());
    const byName = {}, byItem = {};
    for (const [h, entry] of Object.entries(raw)) {
      const nm = foldPerkName(man.items[h]?.n) || entry?.name;
      const txt = flattenClarity(entry);
      if (!txt) continue;
      if (nm && !byName[nm]) byName[nm] = txt;   // first (usually base) wins; enhanced shares the name
      // Clarity also names the ITEM the perk belongs to — this is how exotic ARMOR gets its
      // insight keyed by the armor's own name (e.g. "Winter's Guile", not "Warlord's Sigil").
      if (entry?.itemName && !byItem[entry.itemName]) byItem[entry.itemName] = txt;
    }
    CLARITY = { generatedAt: new Date().toISOString(), byName, byItem };
    fs.writeFileSync(CLARITY_FILE, JSON.stringify(CLARITY));
    console.log(`Clarity insights: ${Object.keys(byName).length} perks, ${Object.keys(byItem).length} items.`);
  } catch (err) {
    console.warn('clarity download failed:', err.message);
    try { CLARITY = JSON.parse(fs.readFileSync(CLARITY_FILE, 'utf8')); }
    catch { CLARITY = { generatedAt: null, byName: {} }; }
  }
  return CLARITY;
}

// ---------- cleaned, readable perk bullets ----------
// The hover popup shows tight bullets, not Clarity's clunky prose. Curated clean bullets
// live in .clarity-clean.json ({ perkName: [{type,text}] }, numbers kept verbatim). Perks
// without a curated entry fall back to a rule-based cleanup of the raw Clarity text.
const CLEAN_FILE = path.join(__dirname, '.clarity-clean.json');
let CLEAN = null;
function loadCleanClarity(fresh = false) {
  if (CLEAN && !fresh) return CLEAN;
  try { CLEAN = JSON.parse(fs.readFileSync(CLEAN_FILE, 'utf8')); }
  catch { CLEAN = {}; }
  return CLEAN;
}
const EDITORIAL = /learn more|explainer|blog post|editor'?s note|clarity website|this note is temporary|will be removed|patch note|in the future/i;
// bullet TYPE drives the leading symbol on the frontend (trigger ▸ / ramp ▲ / penalty ▼ / buff · / note)
function guessBulletType(s) {
  if (/reduc|penalt|drawback|slower|weaken|-\s?\d|decreas|less\b/i.test(s)) return 'penalty';
  if (/ramp|each (stack|kill|hit)|per (kill|stack|hit)|\bbuilds\b|\bstacks?\b/i.test(s)) return 'ramp';
  if (/^(on |after |when |while |reload|kill|final blow|precision|defeat|hit|dealing|landing|rapidly)/i.test(s.trim())
      || /on (kill|hit|reload|precision|final blow)/i.test(s)) return 'trigger';
  return 'buff';
}
// fallback: raw Clarity text -> bullets. LOSSLESS by design — keep every substantive line
// (intro sentences + each "•" sub-bullet); only strip true editorial meta lines. NEVER cap:
// an earlier 5-sentence cap silently dropped real effects (e.g. Chaos Reshaped's heal).
function cleanClarityBullets(raw) {
  if (!raw) return [];
  const flat = raw.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const units = [];
  flat.split(/\s*•\s*/).forEach((p, i) => {
    p = p.trim(); if (!p) return;
    if (i === 0) p.split(/(?<=[.!?])\s+/).forEach((s) => { s = s.trim(); if (s) units.push(s); });
    else units.push(p);   // each "•" sub-bullet kept whole
  });
  // strip only the editorial SENTENCE(S) inside a unit — never a whole data-bearing bullet
  return units
    .map((u) => u.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s && !EDITORIAL.test(s)).join(' '))
    .filter(Boolean)
    .map((text) => ({ type: guessBulletType(text), text }));
}
// curated clean bullets if we have them, else the rule-based fallback from raw Clarity
function insightBullets(name) {
  const clean = loadCleanClarity()[name];
  if (Array.isArray(clean) && clean.length) return clean;
  return cleanClarityBullets((CLARITY && (CLARITY.byName[name] || (CLARITY.byItem && CLARITY.byItem[name]))) || '');
}

// Perk category tags for the Perk Finder tag filter, derived from the perk's name + in-game
// description + cleaned insight text. Stat tags first, then Destiny element verbs.
const TAGRULES = [
  ['Damage', /damage|\bdmg\b/i],
  ['Reload', /reload/i],
  ['Stability', /stability|recoil|weapon shake|reticle/i],
  ['Handling', /handling|swap speed|ready speed/i],
  ['Range', /\brange\b|falloff|\bzoom\b/i],
  ['Ability energy', /grenade|melee|super|class ability|ability energy/i],
  ['Ammo / mag', /magazine|\bmag\b|reserves|\bammo\b|overfill|\brefill/i],
  ['Healing', /\bheal|\bcure\b|restoration|recovery|overshield|\bhp\b|health/i],
  ['Aim assist', /aim assist|target acqui|airborne/i],
  ['Jolt', /\bjolt/i], ['Scorch', /\bscorch|\bignit|\bradiant\b/i], ['Slow', /\bslow\b|\bfreeze|frozen|shatter|stasis crystal/i],
  ['Sever', /\bsever|suspend|unravel|tangle|threadling|woven mail/i], ['Volatile', /\bvolatile|suppress|weaken|devour|invisib/i],
];
const tagsFor = (text) => TAGRULES.filter(([, re]) => re.test(text)).map(([t]) => t);

// Every trait perk (columns 3 & 4) that can roll on ANY weapon in the game, deduped by
// name, tagged with which column(s) it appears in and its community popularity.
async function buildPerkLibrary(e, fresh = false) {
  if (PERKLIB && !fresh) return PERKLIB;
  const man = await loadManifest(e);
  const wl = await loadWishlist(man, fresh);
  const byName = new Map();
  for (const d of Object.values(man.items)) {
    if (d.it !== 3 || !d.tr || d.tt === 6) continue; // skip exotics — fixed perks, not random rolls
    [0, 1].forEach((ci) => {
      const ps = d.tr[ci]; if (!ps) return;
      for (const h of (man.plugSets[ps] || [])) {
        const it = man.items[h];
        // pc==='frames' is the trait perks (Kill Clip, Incandescent…); everything else in
        // these columns is barrel/mag/stock/grip filler or empty sockets — not roll-defining.
        if (!it || !it.n || it.pc !== 'frames') continue;
        const pn = foldPerkName(it.n);
        let o = byName.get(pn);
        if (!o) { o = { n: pn, icon: it.icon || '', cols: [false, false], weapons: new Set() }; byName.set(pn, o); }
        o.cols[ci] = true;
        o.weapons.add(d.n);   // which CURRENT weapons can roll this perk — the Wilson denominator
        if (!o.icon && it.icon) o.icon = it.icon;
        if (!o.dsc && it.dsc) o.dsc = it.dsc;
      }
    });
  }
  const clarity = await loadClarity(man, fresh);
  const perks = [...byName.values()].map((p) => {
    const w = wl.perks[p.n] || { weapons: [], pve: [], pvp: [] };
    const poolN = p.weapons.size;
    // only count wishlist recommendations for weapons that can STILL roll this perk today —
    // keeps successes <= n so the rate (and Wilson bound) stays a meaningful proportion
    const recWeapons = (w.weapons || []).filter((n) => p.weapons.has(n));
    const pop = poolN ? Math.round(100 * wilsonLB(recWeapons.length, poolN)) : 0;
    const insight = insightBullets(p.n);
    const tags = tagsFor(`${p.n} ${p.dsc || ''} ${insight.map((b) => b.text).join(' ')}`);
    return {
      n: p.n, icon: p.icon, cols: p.cols, pop, wcount: recWeapons.length, poolN,
      pve: (w.pve || []).length, pvp: (w.pvp || []).length, dsc: p.dsc || '', insight, tags,
    };
  });
  perks.sort((a, b) => b.pop - a.pop || b.wcount - a.wcount || a.n.localeCompare(b.n));
  PERKLIB = { perks, count: perks.length, wishlistAt: wl.generatedAt };
  return PERKLIB;
}
// Perk name -> popularity (0-100, Wilson-ranked) for sorting perk lists everywhere else
// (weapon roll columns, watch-perk pickers) so the most-recommended perk shows first.
async function perkPopMap(e) {
  const lib = await buildPerkLibrary(e);
  const m = {};
  for (const p of lib.perks) m[p.n] = p.pop;
  return m;
}
const byPop = (pop) => (a, b) => (pop[typeof b === 'string' ? b : b.n] || 0) - (pop[typeof a === 'string' ? a : a.n] || 0)
  || (typeof a === 'string' ? a : a.n).localeCompare(typeof b === 'string' ? b : b.n);

// Every weapon in the game with its full trait-perk POOL (what it CAN roll), for the
// Perk Finder "Farmable" mode. Reissues (same name, new hash) are merged and their pools
// unioned, mirroring fetchWeapons. Trait perks only (pc==='frames').
let WPOOLS = null;
async function buildWeaponPools(e) {
  if (WPOOLS) return WPOOLS;
  const man = await loadManifest(e);
  const POP = await perkPopMap(e);   // most-popular perk first, same ordering as fetchWeapons
  const nameCol = (ps) => {
    const s = new Set();
    for (const h of (man.plugSets[ps] || [])) { const it = man.items[h]; if (it && it.n && it.pc === 'frames') s.add(foldPerkName(it.n)); }
    return [...s].sort(byPop(POP));
  };
  const groups = {};
  for (const [h, d] of Object.entries(man.items)) {
    if (d.it !== 3 || !d.tr) continue;
    const p0 = d.tr[0] ? nameCol(d.tr[0]) : [], p1 = d.tr[1] ? nameCol(d.tr[1]) : [];
    if (!p0.length && !p1.length) continue;
    const gk = `${d.n}|${d.ty}|${d.b}`;
    const g = groups[gk] || (groups[gk] = { hash: Number(h), n: d.n, ty: d.ty || '', tt: d.tt, slot: WBUCKET[d.b] || '', icon: d.icon || '', src: d.src || '', pool: [new Set(), new Set()] });
    p0.forEach((n) => g.pool[0].add(n)); p1.forEach((n) => g.pool[1].add(n));
    if (!g.icon && d.icon) g.icon = d.icon;
    if (!g.src && d.src) g.src = d.src;
  }
  const weapons = Object.values(groups).map((g) => ({ ...g, pool: [[...g.pool[0]], [...g.pool[1]]] }));
  WPOOLS = { weapons, count: weapons.length };
  return WPOOLS;
}

// Saved perk combos the user builds and role-tags (ad-clear / pve / pvp / dps).
const COMBOS_FILE = path.join(__dirname, 'perk-combos.json'); // [{id,name,role,slots:[[name,...],[name,...]]}]
const loadCombos = () => { const c = loadJson(COMBOS_FILE); return Array.isArray(c) ? c : []; };
const saveCombos = (c) => saveJsonSafe(COMBOS_FILE, c);

// Diego's persistent FAVORITE perks — a curated list (starred in Perk Finder) used to
// score every weapon in the vault, independent of the watch list.
const FAV_FILE = path.join(__dirname, 'perk-favorites.json'); // { perkName: grade 1-3 }
const loadFav = () => {
  const f = loadJson(FAV_FILE);
  if (Array.isArray(f)) { const o = {}; for (const n of f) o[n] = 1; return o; } // back-compat: old flat list = grade 1
  return (f && typeof f === 'object') ? f : {};
};
const saveFav = (f) => {
  const o = {};
  if (Array.isArray(f)) { for (const n of f) o[n] = 1; }
  else if (f && typeof f === 'object') { for (const [n, g] of Object.entries(f)) { const v = Math.max(1, Math.min(3, Math.round(+g) || 1)); if (n) o[n] = v; } }
  saveJsonSafe(FAV_FILE, o);
};
const FAV_WEIGHT = { 1: 1, 2: 1.5, 3: 2 };   // star grade -> vault-score weight

// ---------- probe mode for debugging ----------
async function probe(nameLike) {
  const e = env();
  const data = await fetchArmor(e);
  const hit = data.items.find((i) => i.n.toLowerCase().includes(nameLike.toLowerCase()));
  console.log(hit ? JSON.stringify(hit, null, 2) : `No armor matching "${nameLike}".`);
  if (hit) console.log('\nIf tier/archetype/base stats look wrong, paste this output back to Claude.');
}

// ---------- Build Crafter (2026-07-12, Diego: DIM-like loadout maker, but better) ----------
// Subclass ability/aspect/fragment catalog grouped from the slim manifest's plug items.
// pcs (verified live in slim6): <cls>.<elem>.supers|melee|class_abilities|movement|aspects;
// STASIS aspects are <cls>.stasis.totems and stasis fragments shared.stasis.trinkets;
// grenades = shared.<elem>.grenades + per-class <cls>.prism.grenades (the transcendence
// <cls>.prism.prism_grenade is excluded); fragments = shared.<elem>.fragments +
// shared.prism.fragments. An aspect's FRAGMENT-SLOT COUNT rides on its investmentStats
// hash 2223994109 (kept in wi) — so no subclass-item (itemType 16) fetch is needed.
let CATALOG = null;
const FRAG_SLOT_STAT = '2223994109';
function buildSubclassCatalog(man) {
  if (CATALOG) return CATALOG;
  const CLSN = { titan: 'Titan', hunter: 'Hunter', warlock: 'Warlock' };
  const cat = {};
  const bucketFor = (cls, elem) => {
    cat[cls] = cat[cls] || {};
    return (cat[cls][elem] = cat[cls][elem] || { supers: [], grenades: [], melee: [], classAbilities: [], movement: [], aspects: [], fragments: [] });
  };
  for (const [hash, d] of Object.entries(man.items)) {
    const pc = d.pc || '';
    if (!pc || !d.icon || !d.n || d.n.startsWith('Empty')) continue;
    const entry = { h: Number(hash), n: d.n, icon: d.icon, dsc: d.dsc || '' };
    let m;
    if ((m = pc.match(/^(titan|hunter|warlock)\.(arc|solar|void|strand|prism|stasis)\.(supers|melee|class_abilities|movement|grenades)$/))) {
      const key = { supers: 'supers', melee: 'melee', class_abilities: 'classAbilities', movement: 'movement', grenades: 'grenades' }[m[3]];
      bucketFor(CLSN[m[1]], m[2])[key].push(entry);
    } else if ((m = pc.match(/^(titan|hunter|warlock)\.(arc|solar|void|strand|prism)\.aspects$/))) {
      bucketFor(CLSN[m[1]], m[2]).aspects.push({ ...entry, frag: (d.wi && d.wi[FRAG_SLOT_STAT]) || 0 });
    } else if ((m = pc.match(/^(titan|hunter|warlock)\.stasis\.totems$/))) {
      bucketFor(CLSN[m[1]], 'stasis').aspects.push({ ...entry, frag: (d.wi && d.wi[FRAG_SLOT_STAT]) || 0 });
    } else if ((m = pc.match(/^shared\.(arc|solar|void|strand|stasis|prism)\.(grenades|fragments)$/))) {
      for (const cls of Object.values(CLSN)) bucketFor(cls, m[1])[m[2]].push(m[2] === 'fragments' ? { ...entry, inv: d.inv || null } : entry);
    } else if (pc === 'shared.stasis.trinkets') {
      for (const cls of Object.values(CLSN)) bucketFor(cls, 'stasis').fragments.push({ ...entry, inv: d.inv || null });
    }
  }
  // dedupe by name within each list (the manifest holds multiple hashes for some plugs)
  for (const cls of Object.values(cat)) for (const el of Object.values(cls)) for (const [k, list] of Object.entries(el)) {
    const seen = new Set();
    el[k] = list.filter((x) => (seen.has(x.n) ? false : (seen.add(x.n), true))).sort((a, b) => a.n.localeCompare(b.n));
  }
  return (CATALOG = cat);
}

// builds store: builds.json {v:1, builds:[...]}. Each build carries a `rev` bumped on any
// scoring-relevant edit (prio/min/max/exotic/cls) so the upgrade-checker's seen-keys
// (buildId:rev:instanceId) orphan themselves and the whole vault re-evaluates (feed-only).
const BUILDS_FILE = path.join(__dirname, 'builds.json');
const loadBuilds = () => { const b = loadJson(BUILDS_FILE); return (b && Array.isArray(b.builds)) ? b.builds : []; };
const saveBuilds = (builds) => saveJsonSafe(BUILDS_FILE, { v: 1, builds });
const STATKEYS = ['w', 'h', 'c', 'g', 's', 'm'];
function upsertBuild(input) {
  const builds = loadBuilds();
  const now = new Date().toISOString();
  let b = input.id ? builds.find((x) => x.id === input.id) : null;
  if (!b) {
    b = { id: input.id || ('b' + Date.now()), rev: 1, createdAt: now, src: input.src || 'manual', dimId: input.dimId || '' };
    builds.push(b);
  } else {
    // bump rev when anything that changes scoring changed
    const scoringChanged = ['cls', 'exotic', 'prio', 'min', 'max', 'setBonus'].some((k) => k in input && JSON.stringify(input[k]) !== JSON.stringify(b[k]));
    if (scoringChanged) b.rev = (b.rev || 1) + 1;
  }
  for (const k of ['name', 'cls', 'classType', 'elem', 'plugs', 'exotic', 'prio', 'min', 'max', 'setBonus', 'watch', 'draft', 'notes']) if (k in input) b[k] = input[k];
  b.plugs = b.plugs || { super: 0, grenade: 0, melee: 0, classAbility: 0, movement: 0, aspects: [], fragments: [] };
  b.setBonus = b.setBonus || { name: '', want: 0 };   // want: 0=off, 2=2-piece, 4=4-piece
  b.prio = Array.isArray(b.prio) && b.prio.length === 6 ? b.prio : STATKEYS.slice();
  b.min = b.min || {}; b.max = b.max || {};
  for (const k of STATKEYS) { b.min[k] = Math.max(0, Math.min(200, +b.min[k] || 0)); b.max[k] = Math.max(0, Math.min(200, +(b.max[k] ?? 200))); }
  b.updatedAt = now;
  saveBuilds(builds);
  return b;
}

// Build upgrade engine (v1: greedy per-slot swaps — every suggestion explainable in one
// sentence). The champion set = your exotic anchor + the best non-exotic per other slot by
// the build's weighted priorities (weights are separable per slot, so greedy = optimal for
// the uncapped score). A candidate is an upgrade when it (tier 1) reduces the distance to a
// MIN stat target, or (tier 2) raises the MAX-capped weighted sum. Cross-slot tradeoffs
// (full DIM-Loadout-Optimizer search), mods, and Balanced Tuning's +1s are out of scope v1.
const PRIO_W = [10, 6, 3, 2, 1, 0.5];
const ARMOR_SLOTS = ['Helmet', 'Gauntlets', 'Chest', 'Leg', 'Class Item'];
const STATN_B = { w: 'Weapons', h: 'Health', c: 'Class', g: 'Grenade', s: 'Super', m: 'Melee' };
const KEY_BY_STATN = { weapons: 'w', health: 'h', class: 'c', grenade: 'g', super: 's', melee: 'm' };
const weightOf = (build) => { const W = {}; STATKEYS.forEach((k) => { const ix = build.prio.indexOf(k); W[k] = PRIO_W[ix >= 0 ? ix : 5]; }); return W; };
const pieceScoreB = (p, W) => STATKEYS.reduce((sum, k) => sum + W[k] * (p.s[k] || 0), 0);
const setTotals = (pieces) => { const T = {}; STATKEYS.forEach((k) => { T[k] = pieces.reduce((sum, p) => sum + (p ? (p.s[k] || 0) : 0), 0); }); return T; };
const cappedScore = (T, build, W) => STATKEYS.reduce((sum, k) => sum + W[k] * Math.min(T[k] || 0, build.max[k] ?? 200), 0);
const minDeficit = (T, build) => STATKEYS.reduce((sum, k) => sum + Math.max(0, (build.min[k] || 0) - (T[k] || 0)), 0);

function championSet(build, items) {
  const W = weightOf(build);
  const pool = items.filter((i) => i.cls === build.cls && ARMOR_SLOTS.includes(i.slot));
  const slots = {}; let exoticMissing = false;
  const exSlot = build.exotic?.slot || '';
  const sb = (build.setBonus && build.setBonus.name && build.setBonus.want) ? build.setBonus : null;
  const bestIn = (cands) => cands.slice().sort((a, b) => pieceScoreB(b, W) - pieceScoreB(a, W))[0] || null;
  const setGaps = [], lockedSetSlots = new Set();
  for (const slot of ARMOR_SLOTS) {
    if (slot === exSlot) {
      // exotics match by hash OR NAME — the same exotic exists under multiple hashes across reissues
      const c = pool.filter((i) => i.slot === slot && i.x && (i.hash === build.exotic.hash || (build.exotic.n && i.n === build.exotic.n)));
      if (!c.length) exoticMissing = true;
      slots[slot] = bestIn(c);
      continue;
    }
    const glob = bestIn(pool.filter((i) => i.slot === slot && !i.x));
    if (sb && sb.want === 4) {   // 4-piece: every non-exotic slot must come from the set
      const setBest = bestIn(pool.filter((i) => i.slot === slot && !i.x && i.sb === sb.name));
      if (setBest) { slots[slot] = setBest; lockedSetSlots.add(slot); }
      else { slots[slot] = glob; setGaps.push(slot); }
    } else slots[slot] = glob;
  }
  if (sb && sb.want === 2) {   // 2-piece: convert the two slots where a set piece costs the least
    const opts = [];
    for (const slot of ARMOR_SLOTS) {
      if (slot === exSlot) continue;
      if (slots[slot] && slots[slot].sb === sb.name) { opts.push({ slot, loss: -1 }); continue; }   // already set — free
      const setBest = bestIn(pool.filter((i) => i.slot === slot && !i.x && i.sb === sb.name));
      if (setBest) opts.push({ slot, loss: pieceScoreB(slots[slot] || { s: {} }, W) - pieceScoreB(setBest, W), piece: setBest });
    }
    opts.sort((a, b) => a.loss - b.loss);
    let have = 0;
    for (const o of opts) { if (have >= 2) break; if (o.piece) slots[o.slot] = o.piece; lockedSetSlots.add(o.slot); have++; }
    if (have < 2) setGaps.push(`only ${have} ${sb.name} piece${have === 1 ? '' : 's'} owned`);
  }
  const T = setTotals(Object.values(slots));
  return { slots, T, W, score: cappedScore(T, build, W), deficit: minDeficit(T, build), exoticMissing, setGaps, lockedSetSlots, sb };
}

function isUpgrade(build, champ, cand) {
  const slot = cand.slot;
  if (!ARMOR_SLOTS.includes(slot) || cand.cls !== build.cls) return null;
  const cur = champ.slots[slot];
  if (cur && cur.id === cand.id) return null;                    // already the champion piece
  if (slot === (build.exotic?.slot || '')) { if (!(cand.hash === build.exotic?.hash || (build.exotic?.n && cand.n === build.exotic.n))) return null; }
  else if (cand.x) return null;                                  // never suggest a second exotic
  // set-bonus constraint: a slot locked to the chosen set only accepts pieces of that set
  if (champ.lockedSetSlots && champ.lockedSetSlots.has(slot) && champ.sb && cand.sb !== champ.sb.name) return null;
  const T2 = {}; STATKEYS.forEach((k) => { T2[k] = (champ.T[k] || 0) - (cur ? (cur.s[k] || 0) : 0) + (cand.s[k] || 0); });
  const dNew = minDeficit(T2, build), dOld = champ.deficit;
  if (dNew > dOld) return null;                                  // never move away from a min target
  const s2 = cappedScore(T2, build, champ.W);
  if (dNew < dOld) return { T2, why: `closes the stat-goal gap by ${dOld - dNew}`, s2 };
  if (s2 > champ.score + 1) return { T2, why: 'raises the prioritized stats', s2 };
  return null;
}

function tuneNoteFor(build, cand) {
  if (cand.tuneKind === 'balanced') return 'Balanced Tuning: +1 to its three lowest stats — mild bonus, not counted in the comparison.';
  if (cand.tuneKind === 'stat') {
    const m = (cand.tune || '').match(/^\+(\w+) \/ -(\w+)$/);
    if (m) {
      const up = KEY_BY_STATN[m[1].toLowerCase()], dn = KEY_BY_STATN[m[2].toLowerCase()];
      if (up && dn) {
        const pi = build.prio.indexOf(up), di = build.prio.indexOf(dn);
        return pi < di
          ? `Tuning ${cand.tune} favors this build (${STATN_B[up]} is priority #${pi + 1}).`
          : `Tuning ${cand.tune} works AGAINST this build (${STATN_B[dn]} matters more to it).`;
      }
    }
    return `Tuning: ${cand.tune}.`;
  }
  if (!cand.tune && cand.t >= 3) return `Tuning socket still open — could be tuned toward ${STATN_B[build.prio[0]]}.`;
  return '';
}

function buildAlertEntry(build, champ, cand, r) {
  const cur = champ.slots[cand.slot];
  const deltas = {}, lines = [];
  for (const k of build.prio) {
    const a = champ.T[k] || 0, b = r.T2[k] || 0;
    if (a !== b) deltas[k] = [a, b];
  }
  for (const [k, [a, b]] of Object.entries(deltas)) {
    const goal = (build.min[k] || 0) > 0 ? ` (goal ${build.min[k]}+)` : '';
    lines.push(`${STATN_B[k]} ${a}→${b}${goal}`);
  }
  return {
    at: Date.now(), buildId: build.id, buildName: build.name, id: cand.id, name: cand.n, slot: cand.slot,
    swapOut: cur ? cur.n : '', swapOutId: cur ? cur.id : '', deltas,
    text: `Swap '${cur ? cur.n : '(empty slot)'}' for '${cand.n}' in ${cand.slot}: ${lines.join(' · ') || 'stat mix improves'} — ${r.why}.`,
    tuneNote: tuneNoteFor(build, cand), read: false, fresh: false,
  };
}

// build alerts feed + seen-set (persistent — born from the 07-12 lost-log lesson)
const BUILDS_SEEN_FILE = path.join(__dirname, 'builds-seen.json');
const BUILDS_ALERTS_FILE = path.join(__dirname, 'builds-alerts.json');
let BUILD_ALERTS_CACHE = null;   // in-memory mirror so /api/status never reads disk
const loadBuildAlerts = () => { if (!BUILD_ALERTS_CACHE) { const a = loadJson(BUILDS_ALERTS_FILE); BUILD_ALERTS_CACHE = Array.isArray(a) ? a : []; } return BUILD_ALERTS_CACHE; };
const saveBuildAlerts = () => saveJsonSafe(BUILDS_ALERTS_FILE, (BUILD_ALERTS_CACHE || []).slice(-200));

// ---------- phase-2: live god-roll drop alerts ----------
// A poller watches for fresh watched-weapon drops that clear the god-roll bar while
// Destiny is running. On a hit it auto-locks the drop, beeps the PC, and writes
// drop-alert.json — which the TRMNL server.js reads to interrupt the panel for a minute.
const DROP_ALERT_FILE = path.join(__dirname, 'drop-alert.json');
const GAME_PROCESS = process.env.GAME_PROCESS || 'destiny2.exe';
const ALERTED = new Set();   // instance ids already alerted — a fresh drop only fires ONCE
let gameUp = false;
let onGameStart = null;   // set by main() → kick an auto-manage pass the moment the game launches
function checkGame() {
  exec(`tasklist /FI "IMAGENAME eq ${GAME_PROCESS}" /NH`, { windowsHide: true }, (err, stdout) => {
    const up = !err && new RegExp(GAME_PROCESS.replace(/\./g, '\\.'), 'i').test(stdout || '');
    if (up && !gameUp && onGameStart) onGameStart();   // just launched → run soon
    gameUp = up;
  });
}
function beep() { exec('powershell -NoProfile -c "1..3 | %{ [console]::beep(880,220); Start-Sleep -m 120 }"', { windowsHide: true }, () => {}); }

// Server-side mirror of weapon-watch.html scoreCopy (same 75/3/4 god-roll gate).
const GOD_MIN_PCT = 75, GOD_MIN_MATCHES = 3, GOD_MIN_SELECTED = 4;
const AUTO_FAV_MIN_CRIT = 3;   // watched weapons: min tracked criteria before the app may auto-favorite (Diego 2026-07-12)
function scoreWeaponCopy(w, cfg, rankOf) {
  const perks = cfg.perks || {}, roll = new Set([...(w.cols[0] || []), ...(w.cols[1] || [])].map((p) => p.n));
  let selW = 0, matchW = 0, matched = 0, selN = 0; const hit = [];
  for (const [n, pr] of Object.entries(perks)) { selW += pr; selN++; if (roll.has(n)) { matchW += pr; matched++; hit.push(n); } }
  if (cfg.mw) { selW += 1; selN++; if (w.mw === cfg.mw) { matchW += 1; matched++; } }
  for (const s of (cfg.stats || [])) { selW += 1; selN++; if (rankOf?.[s] && rankOf[s](w.statsMax[s] ?? -1) === 's1') { matchW += 1; matched++; } }
  const pct = selW ? Math.round(100 * matchW / selW) : 0;
  const god = selN >= GOD_MIN_SELECTED && matched >= GOD_MIN_MATCHES && pct >= GOD_MIN_PCT;
  return { pct, god, hit };
}

// ---------- phase-3: auto inventory manager ----------
// Runs while Destiny is up AND you're safely OUT of an activity (orbit / social space).
// It auto-tags weapon copies keep/favorite/junk by score, stages a few junk-tagged
// weapons on a character so you can dismantle them in-game, and beeps on high-score
// finds. Diego's rules (2026-07-06):
//   - LEGENDARIES ONLY — exotics are never touched.
//   - Watched weapons (you picked tracked perks): score = perk-match %; junk < god bar (75%).
//   - Unwatched weapons: score = ★-favorite coverage of the copy's ACTUAL rolled perks
//     (perks tracked on ANY watched weapon count as at least 2★ — 2026-07-16);
//     favorite (+lock+beep) >= 90.
//   - Per weapon: keep ALL favorites + ONE keep (highest copy >= 80%, only if no keep exists yet);
//     junk the other duplicates. Never replaces an existing keep, never re-tags your manual junk.
//   - A brand-new watched drop that beats your best kept copy → keep + a DIFFERENT sound.
//   - Never touch locked / equipped / postmaster copies; never junk a keep/favorite; never
//     overwrite a copy you tagged junk.
// There is no Bungie dismantle API — "stage for dismantling" just moves junk onto a
// character so YOU dismantle it. Every decision is recorded in AUTO_LOG for the /auto UI.
const AUTO_FILE = path.join(__dirname, 'auto-manage.json');
const AUTO_DRYRUN = process.env.AUTO_DRYRUN === '1';   // force decide-only (no writes) for testing
const FAVW = { 1: 1, 2: 1.5, 3: 2 };                   // ★ grade -> weight (mirrors weapon-vault.html)
const STAGE_SLOT_CAP = 9;                              // unequipped weapons per slot on a character
const AUTO_DEFAULTS = {
  enabled: true,           // Diego chose "go fully live"
  junkStage: 5,            // junk-tagged weapons to stage IN EACH SLOT (Kinetic/Energy/Power) → 15 total (Diego 2026-07-12: 5, not 3)
  armorStage: true,        // ALSO stage junk-tagged ARMOR per slot (Diego 2026-07-12). Staging only — armor is NEVER auto-tagged.
  stageCid: null,          // character to stage junk on (null = default / Warlock main)
  maxJunkPerRun: 25,       // safety cap: never junk-tag more than this in one pass
  maxMovesPerRun: 20,      // safety cap on item transfers per pass (up to 15 stages + spills)
  orbitSeconds: 60,        // check cadence while SAFE (orbit/social) — Diego 2026-07-12: save API calls
  activitySeconds: 15,     // check cadence while IN an activity (cheap check; catch the activity ENDING fast)
  idleSeconds: 120,        // cadence of the cheap no-op check while the game is CLOSED
  thr: { unwatchedJunk: 60, keep: 80, fav: 90, watchedJunk: 75, comboFloor: 80 },
};
function loadAuto() {
  const f = loadJson(AUTO_FILE); const o = (f && typeof f === 'object' && !Array.isArray(f)) ? f : {};
  return { ...AUTO_DEFAULTS, ...o, thr: { ...AUTO_DEFAULTS.thr, ...(o.thr || {}) } };
}
function saveAuto(patch) {
  const cur = loadAuto();
  saveJsonSafe(AUTO_FILE, { ...cur, ...patch, thr: { ...cur.thr, ...(patch.thr || {}) } });
}
// Instance ids the APP itself tagged favorite — so the UI can paint auto-favorites light green
// and Diego's own (manual) favorites pink. An item leaves this set when the app retags it
// keep/junk; a pre-existing favorite the app never re-tags stays OUT (→ manual/pink).
const AUTOFAV_FILE = path.join(__dirname, 'auto-applied.json');
const loadAutoFavSet = () => { const a = loadJson(AUTOFAV_FILE); return new Set(Array.isArray(a) ? a : []); };
const saveAutoFavSet = (set) => saveJsonSafe(AUTOFAV_FILE, [...set]);
// Persistent history of every LIVE pass's tag changes (auto-history.json, last 40 runs).
// Born from the 2026-07-12 incident: AUTO_LOG was in-memory only, the server restarted, and
// the exact list of retagged weapons was gone (DIM's API has no audit endpoint — verified).
// With {id, from, to} recorded per action, POST /api/auto/revert {at} can undo a whole run.
const AUTOHIST_FILE = path.join(__dirname, 'auto-history.json');
const loadAutoHist = () => { const a = loadJson(AUTOHIST_FILE); return Array.isArray(a) ? a : []; };
function recordAutoRun(log) {
  const tagActs = (log.actions || []).filter((a) => a.to && a.id && !a.error);
  if (!tagActs.length) return;
  const hist = loadAutoHist();
  hist.push({ at: log.at, counts: log.counts, actions: tagActs.map(({ id, name, from, to }) => ({ id, name, from, to })) });
  saveJsonSafe(AUTOHIST_FILE, hist.slice(-40));
  logTagHistory(tagActs.map(({ id, name, from, to }) => ({ id, name, from, to, src: 'auto' })));
}
// Unified tag history (Diego 2026-07-12: "create a history system of manual and auto tags that I
// can go back and check"). EVERY tag change lands here with its source: 'manual' (a chip in this
// app), 'auto' (an Auto-Manager pass), 'dim' (edited inside the DIM app — caught by diffing each
// 30s cloud read), 'revert' (an /api/auto/revert). tag-history.json, capped at the last 4000.
const TAGHIST_FILE = path.join(__dirname, 'tag-history.json');
let TAGHIST_CACHE = null;
function logTagHistory(entries) {
  if (!entries || !entries.length) return;
  if (!TAGHIST_CACHE) { const a = loadJson(TAGHIST_FILE); TAGHIST_CACHE = Array.isArray(a) ? a : []; }
  const at = new Date().toISOString();
  for (const en of entries) TAGHIST_CACHE.push({ at, ...en });
  if (TAGHIST_CACHE.length > 4000) TAGHIST_CACHE = TAGHIST_CACHE.slice(-4000);
  saveJsonSafe(TAGHIST_FILE, TAGHIST_CACHE);
}
let AUTO_LOG = { at: null, safe: null, activity: null, dryRun: AUTO_DRYRUN, actions: [], counts: {}, note: 'not run yet' };

const rolledNames = (w) => [...(w.cols[0] || []), ...(w.cols[1] || [])].map((p) => p.n);
// Unwatched roll quality — GRADE-NORMALIZED (2026-07-09 fix). Each trait column contributes
// its BEST favorited perk's ★-grade weight (1★=1 · 2★=1.5 · 3★=2); score = that sum vs the
// max possible (a 3★ favorite in BOTH columns = 100%). So: 3★+3★=100 · 3★+2★=88 · 2★+2★=75 ·
// 1★+1★=50 · one column favorited only ≤50. Callers pass the EFFECTIVE favorites map
// (★ stars ∪ tracked-perk union from fetchWeapons), not raw perk-favorites.json.
// WHY: the old formula was "what fraction of this roll's perks are favorited" — a standard
// 1-perk-per-column drop that happened to land two of Diego's 87 grade-1 favorites read
// 100% ≥ the 90% favorite bar, so the app mass-favorited mediocre weapons (the bug Diego
// reported). Under the new scale a favorite requires 3★ perks in both columns; two 1★
// favorites = 50%, i.e. a decent dupe-survivor, never an auto-favorite.
function favRollScore(w, fav) {
  if (!fav || !Object.keys(fav).length) return -1;
  const cols = [w.cols[0] || [], w.cols[1] || []];
  if (!cols[0].length && !cols[1].length) return -1;
  let sum = 0;
  for (const col of cols) {
    let best = 0;
    for (const p of col) { const g = fav[p.n]; if (g && (FAVW[g] || 1) > best) best = FAVW[g] || 1; }
    sum += best;
  }
  return Math.round(100 * sum / (2 * FAVW[3]));
}
// Diego's saved Perk Finder combos matched against a copy's ACTUAL roll: a combo hits when
// one Slot-1 perk and one Slot-2 perk sit in DIFFERENT trait columns at once (the same rule
// Perk Finder uses). Used to (a) give defined combos extra weight in auto-manage scoring
// (comboFloor) and (b) auto-tag the roll PVP/PVE ("what's not PVP is considered PVE").
function comboMatches(w, combos) {
  const c0 = new Set((w.cols[0] || []).map((p) => p.n)), c1 = new Set((w.cols[1] || []).map((p) => p.n));
  if (!c0.size || !c1.size) return [];
  const out = [];
  for (const c of (combos || [])) {
    const s1 = c.slots?.[0] || [], s2 = c.slots?.[1] || [];
    if (!s1.length || !s2.length) continue;
    const inCol = (slot, col) => slot.some((n) => col.has(n));
    if ((inCol(s1, c0) && inCol(s2, c1)) || (inCol(s2, c0) && inCol(s1, c1))) out.push(c);
  }
  return out;
}
// Decide ONE copy's action. ALWAYS returns {tag,score,isWatched,eligible,reason?,notify?}:
// tag is the change (or null = leave it), and `eligible` marks a legendary copy the app is
// allowed to junk (used by the last-copy guarantee to pick a survivor). score = -1 when the
// copy is untouchable (exotic/locked/equipped/postmaster) or has no perk signal.
// Scores come from w.rollScore — computed ONCE in fetchWeapons — so the Auto-Manager and
// every page always show the same number per copy (Diego: only the actual roll matters).
function autoDecide(w, def, thr) {
  const skip = (reason) => ({ tag: null, score: -1, isWatched: false, eligible: false, reason });
  if (!def || def.tt !== 5) return skip('not a legendary');   // legendaries only (skip exotics/rares)
  if (w.loc === 'equipped' || w.loc === 'postmaster') return skip(w.loc);
  // HEAL (2026-07-09): favorites the APP applied under the old saturating score (w.autoFav —
  // Diego's own favorites are never in auto-applied.json) are re-decided from scratch, lock
  // included (the app locked them itself), so the bogus green favorites demote to keep/junk
  // under the fixed grade-aware scale instead of surviving forever behind their auto-lock.
  const healFav = w.tag === 'favorite' && w.autoFav;
  if (w.locked && !healFav) return skip('locked');            // respect locks (god-rolls auto-lock)
  const cur = healFav ? '' : (w.tag || '');
  if (cur === 'infuse' || cur === 'archive') return skip('dim ' + cur);  // leave DIM's other tags alone
  const isWatched = w.rollBasis === 'watched';
  const score = w.rollScore ?? -1;
  // "give defined combos extra weight" (Diego): comboFloored = the roll matched a saved Perk
  // Finder combo and was floored at comboFloor (default = the keep band) in fetchWeapons.
  const via = (w.comboFloored && (w.combos || []).length) ? ` · combo: ${w.combos[0]}` : '';
  // AUTO-FAVORITE GATE (Diego OK'd 2026-07-12): a WATCHED weapon may only be auto-favorited
  // when you track at least AUTO_FAV_MIN_CRIT criteria — one lone tracked perk that matches is
  // 100% but proves nothing (the source of the surprising mass favorites). Below the gate a
  // high score can still earn the (single) keep. Favorites-basis is already strict (needs 3★
  // favorites in both columns), so it isn't gated.
  const favEligible = !isWatched || (w.rollCrit ?? 0) >= AUTO_FAV_MIN_CRIT;
  const base = { tag: null, score, isWatched, eligible: true, favEligible };
  if (score < 0) return { ...base, eligible: false, reason: 'no perk signal' };
  if (score >= thr.fav && favEligible) return cur === 'favorite' ? base : { ...base, tag: 'favorite', notify: 'high', reason: `${score}% >= ${thr.fav}${via}` };
  if (score >= thr.keep) return (cur === 'keep' || cur === 'favorite') ? base : { ...base, tag: 'keep', reason: `${score}% >= ${thr.keep}${via}${favEligible ? '' : ` · fav needs ≥${AUTO_FAV_MIN_CRIT} tracked criteria (you track ${w.rollCrit ?? 0})`}` };
  const junkBar = isWatched ? thr.watchedJunk : thr.unwatchedJunk;
  if (score < junkBar && cur !== 'keep' && cur !== 'favorite') return cur === 'junk' ? base : { ...base, tag: 'junk', reason: `${score}% < ${junkBar}` };
  return base;                                                // in the "leave untouched" band
}
// A distinct rising chime (vs the god-roll beep()) for a new watched drop that beats your best.
function beepUpgrade() { exec('powershell -NoProfile -c "[console]::beep(660,150); [console]::beep(990,150); [console]::beep(1320,260)"', { windowsHide: true }, () => {}); }

// Are we safely OUT of an activity? Component 204 (characterActivities) on the most recently
// played character. Safe = orbit or a social space (mode 40 — Tower / landing zones).
// CRITICAL (found 2026-07-12, the "junk staging never runs" bug): orbit is NOT hash 0 —
// orbit is its own ACTIVITY, hash 82913930, whose def has an empty name and
// placeHash 2961497387 ("Orbit"). hash 0 basically only appears when logged out, so the
// old `hash === 0` check meant a live pass only ever ran in the Tower. We now treat the
// known orbit hash as safe AND resolve any unknown hash's placeHash against the Orbit
// place (cached on-demand), so a future orbit-hash change still resolves correctly.
const ORBIT_ACTIVITY_HASH = 82913930;
const ORBIT_PLACE_HASH = 2961497387;
const ACTDEF_CACHE = {};   // activityHash -> { name, place } (tiny, on-demand)
async function activityDefLite(hash, e) {
  if (ACTDEF_CACHE[hash]) return ACTDEF_CACHE[hash];
  try { const r = await bungie(`${BASE}/Destiny2/Manifest/DestinyActivityDefinition/${hash}/`, e); ACTDEF_CACHE[hash] = { name: r?.displayProperties?.name || '', place: r?.placeHash || 0 }; }
  catch { return { name: '', place: 0 }; }   // don't cache a failed lookup
  return ACTDEF_CACHE[hash];
}
let ACT_MEMBER = null;   // membership resolution is stable — cache it (was an extra API call every 30s pass)
let LAST_ACT = null;     // last fetchActivity result + timestamp — shown in the banner chip (/api/status)
async function fetchActivity(e) {
  const tok = await accessToken(e);
  let m = ACT_MEMBER;
  if (!m) {
    const msr = await bungie(`${BASE}/User/GetMembershipsById/${tok.membership_id}/254/`, e, tok.access_token);
    const primary = msr.primaryMembershipId;
    m = (msr.destinyMemberships || []).find((x) => x.membershipId === primary)
      || (msr.destinyMemberships || []).find((x) => x.crossSaveOverride === 0 || x.crossSaveOverride === x.membershipType)
      || msr.destinyMemberships[0];
    ACT_MEMBER = m;
  }
  const prof = await bungie(`${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=200,204`, e, tok.access_token);
  const chars = prof.characters?.data || {};
  let cid = null, newest = '';
  for (const [id, c] of Object.entries(chars)) if ((c.dateLastPlayed || '') > newest) { newest = c.dateLastPlayed; cid = id; }
  const act = prof.characterActivities?.data?.[cid] || {};
  const hash = act.currentActivityHash || 0;
  const mode = (act.currentActivityModeType ?? -1);
  const modes = act.currentActivityModeTypes || [];
  let safe = hash === 0 || hash === ORBIT_ACTIVITY_HASH || mode === 40 || modes.includes(40);
  let name = hash === 0 ? '(none)' : '';
  if (hash && hash !== ORBIT_ACTIVITY_HASH) {
    const d = await activityDefLite(hash, e);
    if (d.place === ORBIT_PLACE_HASH) safe = true;
    name = d.name || (d.place === ORBIT_PLACE_HASH ? 'Orbit' : '');
  } else if (hash === ORBIT_ACTIVITY_HASH) name = 'Orbit';
  LAST_ACT = { safe, hash, mode, name, at: Date.now() };
  return { safe, hash, mode, name, activeCid: cid };
}

// ---------- server ----------
const readBody = (req) => new Promise((ok) => {
  let b = ''; req.on('data', (c) => b += c); req.on('end', () => ok(b));
});

async function main() {
  if (process.argv[2] === 'probe') return probe(process.argv[3] || '');
  const e = env();
  let cache = null, wcache = null, aFetchedAt = 0;
  // Shared weapons fetch: pollDrops (25s) and the auto-manage pass (30s) both need fresh
  // profile data — dedupe so overlapping callers share one Bungie pull, and a snapshot
  // younger than maxAgeMs is reused instead of re-fetched.
  let wFetching = null, wFetchedAt = 0;
  const SNAPSHOT_TTL = 30000;   // a plain page load never sees data older than this
  const freshWeapons = (maxAgeMs = 15000) => {
    if (wcache && Date.now() - wFetchedAt < maxAgeMs) return Promise.resolve(wcache);
    if (!wFetching) wFetching = fetchWeapons(e)
      .then((d) => { wcache = d; wFetchedAt = Date.now(); return d; })
      .finally(() => { wFetching = null; });
    return wFetching;
  };
  const server = http.createServer(async (req, res) => {
    try {
      const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/api/status')) {
        // Lightweight heartbeat for the banner's "Updated" chip — NO Bungie/DIM calls.
        return json({
          weaponsAt: wcache ? wFetchedAt : 0, fetching: !!wFetching, gameUp,
          dim: { off: DIM_OFF, at: DIM_TAGS_AT, err: DIM_LAST_ERR },
          auto: { at: AUTO_LOG.at, state: AUTO_LOG.state || '', enabled: !!loadAuto().enabled },
          activity: LAST_ACT,   // {safe,hash,mode,name,at} — the banner chip shows this
          builds: { unread: loadBuildAlerts().filter((a) => !a.read).length },   // Builds-tab badge
        });
      }
      if (req.url.startsWith('/api/armor')) {
        const fresh = req.url.includes('fresh=1');
        if (!cache || fresh || Date.now() - aFetchedAt > SNAPSHOT_TTL) { cache = await fetchArmor(e); aFetchedAt = Date.now(); }
        return json(cache);
      }
      if (req.url.startsWith('/api/weapons')) {
        const fresh = req.url.includes('fresh=1');
        if (fresh) await freshWeapons(0);            // explicit refresh always re-pulls (deduped)
        else await freshWeapons(SNAPSHOT_TTL);       // was cached FOREVER — the "not syncing" bug (2026-07-12)
        return json(wcache);
      }
      if (req.url.startsWith('/api/subclass-catalog')) {
        const man = await loadManifest(e);
        const cat = buildSubclassCatalog(man);
        // Community insights (Clarity — the same data DIM shows) for aspects/fragments/
        // abilities, keyed by name, for the hover popup (Diego 2026-07-13).
        await loadClarity(man).catch(() => {});
        const insights = {};
        for (const cls of Object.values(cat)) for (const el of Object.values(cls)) for (const list of Object.values(el))
          for (const x of list) if (!insights[x.n]) { const b = insightBullets(x.n); if (b && b.length) insights[x.n] = b; }
        // exotic ARMOR insights too (Clarity covers exotic armor) — for the anchor-picker hover
        for (const d of Object.values(man.items)) if (d.it === 2 && d.tt === 6 && d.n && !insights[d.n]) {
          const b = insightBullets(d.n); if (b && b.length) insights[d.n] = b;
        }
        return json({ catalog: cat, insights });
      }
      if (req.url.startsWith('/api/builds/delete') && req.method === 'POST') {
        const { id, drafts } = JSON.parse(await readBody(req) || '{}');
        const before = loadBuilds();
        const keep = drafts ? before.filter((b) => !(b.draft && b.src === 'dim')) : before.filter((b) => b.id !== id);
        saveBuilds(keep);
        const kept = new Set(keep.map((b) => b.id));
        BUILD_ALERTS_CACHE = loadBuildAlerts().filter((a) => kept.has(a.buildId)); saveBuildAlerts();
        return json({ ok: true, deleted: before.length - keep.length });
      }
      if (req.url.startsWith('/api/builds/import-dim') && req.method === 'POST') {
        try { return json({ ok: true, ...(await importDimLoadouts(e)) }); }
        catch (err) { return json({ error: err.message }); }
      }
      if (req.url.startsWith('/api/builds/suggestions')) {
        // pure PREVIEW: runs the checker math on demand, writes no alerts and no seen-keys
        const bid = new URL(req.url, 'http://x').searchParams.get('id');
        if (!cache || Date.now() - aFetchedAt > SNAPSHOT_TTL) { cache = await fetchArmor(e); aFetchedAt = Date.now(); }
        const armor = cache.items, outB = {};
        for (const build of loadBuilds()) {
          if ((bid && build.id !== bid) || !build.exotic?.hash) continue;
          const champ = championSet(build, armor);
          const suggestions = [];
          for (const cand of armor) {
            if (cand.cls !== build.cls || !ARMOR_SLOTS.includes(cand.slot)) continue;
            const r = isUpgrade(build, champ, cand);
            if (r) suggestions.push(buildAlertEntry(build, champ, cand, r));
          }
          outB[build.id] = {
            champion: {
              slots: Object.fromEntries(Object.entries(champ.slots).map(([s, p]) => [s, p ? { id: p.id, n: p.n, s: p.s, t: p.t, tune: p.tune, tuneKind: p.tuneKind, x: p.x } : null])),
              totals: champ.T, deficit: champ.deficit, exoticMissing: champ.exoticMissing, setGaps: champ.setGaps || [],
            },
            suggestions,
          };
        }
        return json({ builds: outB });
      }
      if (req.url.startsWith('/api/builds/alerts/ack') && req.method === 'POST') {
        const { buildId } = JSON.parse(await readBody(req) || '{}');
        const alerts = loadBuildAlerts();
        let n = 0; for (const a of alerts) if (!a.read && (!buildId || a.buildId === buildId)) { a.read = true; n++; }
        if (n) saveBuildAlerts();
        return json({ ok: true, acked: n });
      }
      if (req.url.startsWith('/api/builds/alerts')) {
        return json(loadBuildAlerts().slice().reverse());   // newest first
      }
      if (req.url.startsWith('/api/builds')) {
        if (req.method === 'POST') return json({ ok: true, build: upsertBuild(JSON.parse(await readBody(req) || '{}')) });
        return json({ builds: loadBuilds() });
      }
      if (req.url.startsWith('/api/auto/run') && req.method === 'POST') {
        const { dryRun } = JSON.parse(await readBody(req) || '{}');
        const log = await autoManage({ force: true, dryRun: dryRun !== false });   // preview (dry) by default
        return json({ ok: true, last: log });
      }
      if (req.url.startsWith('/api/auto/history')) {
        return json(loadAutoHist().slice().reverse());   // newest first
      }
      // Undo one recorded live run: restore every tag it changed back to `from`.
      // (Staging transfers are position moves, not data — they're left where they are.)
      if (req.url.startsWith('/api/auto/revert') && req.method === 'POST') {
        const { at } = JSON.parse(await readBody(req) || '{}');
        const run = loadAutoHist().find((r) => r.at === at);
        if (!run) return json({ error: 'run not found' });
        const autoFavSet = loadAutoFavSet();
        let reverted = 0, errors = 0;
        const histLines = [];
        for (const a of run.actions) {
          try {
            await dimWriteTag(e, a.id, a.from === 'none' ? 'none' : a.from);
            if (a.to === 'favorite') {   // the app auto-locked it — undo our own lock + green flag
              autoFavSet.delete(a.id);
              try { await setLock(e, a.id, false); } catch {}
            }
            histLines.push({ id: a.id, name: a.name || '', from: a.to, to: a.from, src: 'revert' });
            reverted++;
          } catch (err) { errors++; }
        }
        logTagHistory(histLines);
        saveAutoFavSet(autoFavSet);
        wcache = null;   // tags changed under the cache
        return json({ ok: true, reverted, errors, total: run.actions.length });
      }
      if (req.url.startsWith('/api/auto')) {
        // thresholds (comboFloor) feed the per-copy rollScore baked into the weapons cache
        if (req.method === 'POST') { saveAuto(JSON.parse(await readBody(req) || '{}')); wcache = null; return json({ ok: true, cfg: loadAuto() }); }
        return json({ cfg: loadAuto(), last: AUTO_LOG, gameUp });
      }
      if (req.url.startsWith('/api/watch')) {
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req) || '{}');
          saveWatch(body);
          wcache = null;   // watch config feeds rollScore/rollBasis on every copy
          return json({ ok: true });
        }
        return json(loadWatch());
      }
      if (req.url.startsWith('/api/tag-history')) {
        if (!TAGHIST_CACHE) { const a = loadJson(TAGHIST_FILE); TAGHIST_CACHE = Array.isArray(a) ? a : []; }
        return json(TAGHIST_CACHE.slice(-1000).reverse());   // newest first
      }
      if (req.url.startsWith('/api/tags')) {
        // GET returns DIM's tags (source of truth). Legacy POST kept as a local mirror
        // write but the UI now uses the per-tag /api/tag endpoint below.
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req) || '{}');
          saveTags(body);
          return json({ ok: true });
        }
        return json(await dimTagsFresh(e).catch(() => loadTags()));
      }
      if (req.url.startsWith('/api/tag') && req.method === 'POST') {
        const { id, tag } = JSON.parse(await readBody(req) || '{}');
        if (!id) return json({ error: 'missing id' });
        try {
          const from = DIM_TAGS[id] || 'none';
          const applied = await dimWriteTag(e, id, tag);
          const item = wcache && ((wcache.weapons || []).find((x) => x.id === id) || (wcache.armor || []).find((x) => x.id === id));
          if (item) item.tag = applied === 'none' ? '' : applied;
          if (from !== applied) logTagHistory([{ id, name: item?.n || (item && wcache.defs[item.hash]?.n) || '', from, to: applied, src: 'manual' }]);
          return json({ ok: true, tag: applied });
        } catch (err) { return json({ error: err.message }); }
      }
      if (req.url.startsWith('/api/lock') && req.method === 'POST') {
        const { id, locked } = JSON.parse(await readBody(req) || '{}');
        if (!id) return json({ error: 'missing id' });
        await setLock(e, id, locked);
        if (wcache) { const w = wcache.weapons.find((x) => x.id === id); if (w) w.locked = !!locked; }
        return json({ ok: true, locked: !!locked });
      }
      if (req.url.startsWith('/api/vault') && req.method === 'POST') {
        const { id, hash, own } = JSON.parse(await readBody(req) || '{}');
        if (!id || !hash) return json({ error: 'missing id/hash' });
        const r = await vaultWeapon(e, id, hash, own);
        if (wcache) { const w = wcache.weapons.find((x) => x.id === id); if (w) w.own = r.own; }
        return json({ ok: true, own: r.own });
      }
      if (req.url.startsWith('/api/equip') && req.method === 'POST') {
        const { id, hash, own, dryRun } = JSON.parse(await readBody(req) || '{}');
        if (!id || !hash) return json({ error: 'missing id/hash' });
        try {
          const r = await smartEquipWeapon(e, id, hash, own, !!dryRun);
          if (!dryRun && wcache) { const w = wcache.weapons.find((x) => x.id === id); if (w) w.own = r.own; }
          return json({ ok: true, own: r.own, swap: r.swap, spill: r.spill, dryRun: r.dryRun });
        } catch (err) { return json({ error: err.message }); }
      }
      if (req.url.startsWith('/api/clean-inventory') && req.method === 'POST') {
        const { characterId, kind } = JSON.parse(await readBody(req) || '{}');
        if (!characterId) return json({ error: 'missing characterId' });
        try { const r = await cleanInventory(e, characterId, kind || 'both'); wcache = null; return json({ ok: true, ...r }); }
        catch (err) { return json({ error: err.message }); }
      }
      if (req.url.startsWith('/api/drops/ack') && req.method === 'POST') {
        const { ids } = JSON.parse(await readBody(req) || '{}');
        const seen = loadSeen();
        const toAck = (ids && ids.length) ? ids : (wcache?.weapons || []).map((w) => w.id);
        for (const id of toAck) seen.ids.add(id);
        seen.seeded = true; saveSeen(seen);
        if (wcache) for (const w of wcache.weapons) if (seen.ids.has(w.id)) w.fresh = false;
        return json({ ok: true, acked: toAck.length });
      }
      if (req.url.startsWith('/api/fashion/apply') && req.method === 'POST') {
        const { characterId, look } = JSON.parse(await readBody(req) || '{}');
        if (!characterId || !look) return json({ error: 'missing characterId/look' });
        try { return json({ ok: true, results: await applyLook(e, characterId, look) }); }
        catch (err) { return json({ error: err.message }); }
      }
      if (req.url.startsWith('/api/perks')) {
        const lib = await buildPerkLibrary(e, req.url.includes('fresh=1'));
        // overlay "mine" = how often each perk is a TRACKED perk across your watched
        // weapons (priority-weighted: ★high counts 2), so the list can rank by your own taste.
        const watch = loadWatch(), mine = {};
        for (const cfg of Object.values(watch))
          for (const [n, pr] of Object.entries(cfg.perks || {})) mine[n] = (mine[n] || 0) + (pr || 1);
        const perks = lib.perks.map((p) => ({ ...p, mine: mine[p.n] || 0 }));
        return json({ ...lib, perks, watchedWeapons: Object.keys(watch).length });
      }
      if (req.url.startsWith('/api/weapon-pools')) {
        return json(await buildWeaponPools(e));
      }
      if (req.url.startsWith('/api/account')) {
        if (!ACCOUNT || req.url.includes('fresh=1')) await fetchAccount(e);
        return json(ACCOUNT);
      }
      if (req.url.startsWith('/api/combos')) {
        // combos drive each copy's PVE/PVP rollTag + combo score floor (computed in
        // fetchWeapons) — drop the weapons cache so the next /api/weapons reflects the edit.
        if (req.method === 'POST') { saveCombos(JSON.parse(await readBody(req) || '[]')); wcache = null; return json({ ok: true }); }
        return json(loadCombos());
      }
      if (req.url.startsWith('/api/favorites')) {
        // favorites feed the per-copy rollScore baked into the weapons cache
        if (req.method === 'POST') { saveFav(JSON.parse(await readBody(req) || '{}')); wcache = null; return json({ ok: true }); }
        return json(loadFav());
      }
      if (req.url.startsWith('/api/fashion')) return json(await fetchFashion(e));
      if (req.url.startsWith('/api/looks')) {
        if (req.method === 'POST') { saveLooks(JSON.parse(await readBody(req) || '[]')); return json({ ok: true }); }
        return json(loadLooks());
      }
      if (req.url.startsWith('/theme.css')) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(__dirname, 'theme.css')));
      }
      if (req.url.startsWith('/banner.js')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(__dirname, 'banner.js')));
      }
      if (req.url.startsWith('/perktip.js')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(__dirname, 'perktip.js')));
      }
      if (req.url.startsWith('/fonts/')) {
        const f = path.basename(req.url.split('?')[0]);              // no path traversal
        if (/^arimo-\d+\.woff2$/.test(f) && fs.existsSync(path.join(__dirname, 'fonts', f))) {
          res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=604800' });
          return res.end(fs.readFileSync(path.join(__dirname, 'fonts', f)));
        }
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.url.startsWith('/weapons')) return res.end(fs.readFileSync(path.join(__dirname, 'weapon-watch.html')));
      if (req.url.startsWith('/vault')) return res.end(fs.readFileSync(path.join(__dirname, 'weapon-vault.html')));
      if (req.url.startsWith('/perks')) return res.end(fs.readFileSync(path.join(__dirname, 'perk-finder.html')));
      if (req.url.startsWith('/drops')) return res.end(fs.readFileSync(path.join(__dirname, 'weapon-drops.html')));
      if (req.url.startsWith('/builds')) return res.end(fs.readFileSync(path.join(__dirname, 'builds.html')));
      if (req.url.startsWith('/auto')) return res.end(fs.readFileSync(path.join(__dirname, 'auto-manager.html')));
      if (req.url.startsWith('/settings')) return res.end(fs.readFileSync(path.join(__dirname, 'settings.html')));
      if (req.url.startsWith('/fashion')) return res.end(fs.readFileSync(path.join(__dirname, 'fashion.html')));
      if (req.url.startsWith('/artifacts')) return res.end(fs.readFileSync(path.join(__dirname, 'artifacts.html')));
      return res.end(fs.readFileSync(HTML_FILE));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  // A restart can briefly overlap the previous process still holding the port (TIME_WAIT).
  // Retry for a bounded window, then EXIT — never loop forever (that spawned immortal zombie
  // node processes that kept fighting for the port). If we're a duplicate, exiting is correct;
  // if we're the launcher's instance, the launcher relaunches us once the port is free.
  let bindTries = 0;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (++bindTries > 20) { console.error(`Port ${PORT} held by another process after ${bindTries} tries — exiting.`); process.exit(1); }
      console.warn(`Port ${PORT} busy (try ${bindTries}/20) — retrying in 1s...`);
      setTimeout(() => { try { server.close(); } catch {} server.listen(PORT, '::'); }, 1000);
    } else { console.error('server error:', err); }
  });
  server.listen(PORT, '::', () =>
    console.log(`\nVault Verdict live at  http://127.0.0.1:${PORT}\n(from your phone on the same Wi-Fi: http://<this-PC's-LAN-IP>:${PORT})\n`));

  // Live god-roll drop watcher: only works while Destiny is running (saves API calls
  // and only alerts when you could actually be getting drops). Auto-locks + alerts.
  async function pollDrops() {
    if (!gameUp) return;
    const watch = loadWatch();
    if (!Object.keys(watch).length) return;
    try {
      await freshWeapons();
      const copiesOf = {}; wcache.weapons.forEach((w) => { (copiesOf[w.hash] = copiesOf[w.hash] || []).push(w); });
      for (const w of wcache.weapons) {
        if (!w.fresh || w.locked) continue;             // only brand-new, still-unlocked drops
        if (ALERTED.has(w.id)) continue;                // and only alert each drop once
        const cfg = watch[w.hash]; if (!cfg) continue;  // of a watched weapon
        const raw = copiesOf[w.hash] || [];
        const rankOf = {};
        for (const s of (cfg.stats || [])) { const vals = [...new Set(raw.map((x) => x.statsMax[s] ?? -1))].sort((a, b) => b - a); rankOf[s] = (v) => { const i = vals.indexOf(v); return i === 0 ? 's1' : i === 1 ? 's2' : i === 2 ? 's3' : ''; }; }
        const sc = scoreWeaponCopy(w, cfg, rankOf);
        if (!sc.god) continue;
        ALERTED.add(w.id);                              // mark so it won't re-fire next poll
        const d = wcache.defs[w.hash] || {};
        try { await setLock(e, w.id, true); w.locked = true; } catch (err) { console.warn('auto-lock failed:', err.message); }
        const stats = (cfg.stats || []).map((s) => ({ n: s, v: w.statsMax[s] ?? '—' }));
        fs.writeFileSync(DROP_ALERT_FILE, JSON.stringify({ until: Date.now() + 60000, weapon: d.n, ty: d.ty, power: w.pwr, pct: sc.pct, perks: sc.hit, mw: w.mw, stats, locked: true }));
        beep();
        console.log(`[drop] GOD ROLL ${d.n} ${sc.pct}% — auto-locked + panel alerted`);
      }
    } catch (err) { console.warn('drop poll error:', err.message); }
  }

  // Auto inventory manager pass. Gated by: game running (unless forced), enabled, and safely
  // out of an activity. force=true (the /auto "run now" button) skips the game/enabled gate;
  // dryRun forces decide-only. Populates AUTO_LOG for the UI either way.
  let managing = false;
  async function autoManage({ force = false, dryRun = AUTO_DRYRUN } = {}) {
    if (managing) return AUTO_LOG;
    const cfg = loadAuto();
    if (!force && (!gameUp || !cfg.enabled)) return AUTO_LOG;
    managing = true;
    const log = { at: new Date().toISOString(), safe: null, activity: null, dryRun, actions: [], counts: { favorite: 0, keep: 0, junk: 0, staged: 0, spilled: 0 }, note: '' };
    try {
      const act = await fetchActivity(e).catch((err) => ({ safe: false, hash: -1, mode: -1, err: err.message }));
      log.safe = act.safe; log.activity = { hash: act.hash, mode: act.mode, name: act.name || '' };
      // A live pass ONLY runs when safely out of an activity. A dry-run preview still shows
      // what it WOULD do (it writes nothing), so Diego can see the plan even mid-activity.
      if (!act.safe && !dryRun) { log.note = 'skipped — in an activity'; return log; }

      await freshWeapons();
      const defs = wcache.defs, thr = cfg.thr;
      // best currently-kept score per WATCHED weapon (for the "new drop beats your best" chime).
      // Scores ride on each copy (w.rollScore, computed in fetchWeapons) — one scoring system.
      const bestKept = {};
      for (const w of wcache.weapons) {
        if (w.rollBasis !== 'watched' || !(w.tag === 'keep' || w.tag === 'favorite')) continue;
        bestKept[w.hash] = Math.max(bestKept[w.hash] ?? -1, w.rollScore ?? -1);
      }

      // 1) decide every copy first (no writes) so the last-copy guarantee can see the whole weapon.
      const decByWeapon = {};
      for (const w of wcache.weapons) {
        const dec = autoDecide(w, defs[w.hash], thr);
        (decByWeapon[w.hash] = decByWeapon[w.hash] || []).push({ w, dec });
      }
      // 2) PER-WEAPON DEDUP (Diego's rules, 2026-07-06). For a weapon with multiple copies:
      //   - Keep ALL favorites (score>=fav% or a favorite tag).
      //   - Keep exactly ONE keep: the single highest-scored copy >= keep%, and ONLY if the weapon
      //     has no keep yet. If a keep already exists (yours or a prior run) the app adds none and
      //     leaves it be — it never replaces your keep with a "better" copy.
      //   - Never overwrite a copy YOU tagged junk (left as junk even with a great roll).
      //   - Junk every other duplicate copy.
      // Locked / equipped / exotic copies are untouchable and survive on their own. Baked-in
      // LAST-COPY GUARANTEE: if a weapon would otherwise keep nothing, its best copy is kept —
      // the app never removes your last copy, only duplicates.
      for (const list of Object.values(decByWeapon)) {
        const scoreOf = (d) => (d.dec.score ?? -1);
        const elig = list.filter((d) => d.dec.eligible);            // legendary, unlocked, not equipped/postmaster
        if (!elig.length) continue;                                 // nothing the app may touch
        const active = elig.filter((d) => d.w.tag !== 'junk');      // respect manual junk — never re-tag it
        // a MANUAL favorite is sacred; an app-applied one (autoFav) only stays if it re-earns it.
        // Score-based favorites also need the min-tracked-criteria gate (same rule as autoDecide).
        const isFav = (d) => (scoreOf(d) >= thr.fav && d.dec.favEligible !== false) || (d.w.tag === 'favorite' && !d.w.autoFav);
        const favs = new Set(active.filter(isFav));                 // keep ALL favorites
        const hasKeep = list.some((d) => d.w.tag === 'keep');       // an existing keep (yours or prior run)
        let survKeep = hasKeep ? null                               // don't add a keep if one already exists
          : (active.filter((d) => !favs.has(d) && scoreOf(d) >= thr.keep).sort((a, b) => scoreOf(b) - scoreOf(a))[0] || null);
        // last-copy guarantee: a locked/equipped non-junk copy already survives; else if nothing would
        // survive, keep the best active copy (even below keep%) so the weapon isn't lost.
        const protectedSurvivor = list.some((d) => !d.dec.eligible && (d.w.tag || 'none') !== 'junk');
        let lastCopyForced = false;
        if (!protectedSurvivor && !favs.size && !hasKeep && !survKeep && active.length) {
          survKeep = [...active].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
          lastCopyForced = true;
        }
        for (const d of elig) {
          if (d.w.tag === 'junk') { d.dec = { ...d.dec, tag: null }; continue; }   // leave your junk alone
          if (favs.has(d)) {
            d.dec = { ...d.dec, tag: d.w.tag === 'favorite' ? null : 'favorite', notify: 'high', reason: `favorite (${scoreOf(d)}%)` };
          } else if (d.w.tag === 'keep') {
            d.dec = { ...d.dec, tag: null };                        // existing keep stays — never replaced or junked
          } else if (d === survKeep) {
            d.dec = { ...d.dec, tag: 'keep', protectedLast: lastCopyForced, reason: lastCopyForced ? 'kept - last copy of this weapon' : `best-rated keep (${scoreOf(d)}%)` };
          } else {
            d.dec = { ...d.dec, tag: 'junk', reason: 'duplicate of a better copy' };
          }
        }
      }

      // 3) apply.
      const autoFavSet = loadAutoFavSet();   // ids the app has favorited (green vs pink in the UI)
      let junked = 0, moves = 0;
      for (const list of Object.values(decByWeapon)) for (const { w, dec } of list) {
        if (!dec.tag) continue;
        if (dec.tag === 'junk' && junked >= cfg.maxJunkPerRun) continue;
        const name = defs[w.hash]?.n || String(w.hash);
        const upgrade = dec.isWatched && w.fresh && (dec.tag === 'keep' || dec.tag === 'favorite') && dec.score > (bestKept[w.hash] ?? -1);
        const line = { id: w.id, name, from: w.tag || 'none', to: dec.tag, score: dec.score, watched: dec.isWatched, upgrade, lastCopy: !!dec.protectedLast, reason: dec.reason };
        if (dec.tag === 'junk') junked++;
        log.counts[dec.tag]++;
        w.tag = dec.tag;   // reflect in memory (ephemeral wcache) so staging below sees it — even in dry-run
        // track app-applied favorites: this is an AUTO favorite (the app set it) → green; any tag
        // change off favorite drops it from the set. Diego's own favorites are never in here → pink.
        const wasAutoFav = w.autoFav;
        if (dec.tag === 'favorite') { autoFavSet.add(w.id); w.autoFav = true; }
        else { autoFavSet.delete(w.id); w.autoFav = false; }
        if (!dryRun) {
          try {
            // Last-copy keeps get a DIM note "best copy" (Diego 2026-07-12) — appended after any
            // existing note so nothing he wrote is ever lost.
            let note;
            if (dec.protectedLast) {
              const cur = DIM_NOTES[w.id] || '';
              note = cur ? (cur.includes('best copy') ? undefined : cur + ' · best copy') : 'best copy';
            }
            await dimWriteTag(e, w.id, dec.tag, note);
            if (dec.tag === 'favorite') { try { await setLock(e, w.id, true); w.locked = true; } catch {} }
            // demoting an app-applied favorite also undoes the app's OWN auto-lock (never a lock you set)
            else if (wasAutoFav && w.locked) { try { await setLock(e, w.id, false); w.locked = false; } catch {} }
            // Only chime for genuinely NEW drops — never for the bulk re-tagging of your existing vault.
            if (w.fresh) { if (upgrade) beepUpgrade(); else if (dec.notify === 'high') beep(); }
          } catch (err) { line.error = err.message; }
        }
        log.actions.push(line);
      }
      if (!dryRun) saveAutoFavSet(autoFavSet);

      // Stage junk-tagged items on a character so Diego can dismantle them in-game: junkStage
      // per slot for WEAPONS (Kinetic/Energy/Power) and — Diego 2026-07-12 — for ARMOR
      // (Helmet/Gauntlets/Chest/Leg/Class Item). Armor is staging-ONLY: the app never writes
      // an armor tag; it only moves pieces Diego himself already tagged junk (in DIM or here).
      // CAP FIX (the "staged 57" bug, 2026-07-12): a transfer ATTEMPT now counts toward
      // maxMovesPerRun (dry-run too, so the preview is honest), and a failed transfer stops
      // that slot instead of marching through the whole pool logging phantom "add"s — the old
      // loop only counted successes, so when Bungie refused transfers (e.g. back in an
      // activity mid-pass) nothing ever tripped the cap.
      const stageCid = cfg.stageCid || LOCK_CTX?.characterId;
      const stageJunkSet = async (kind, items, SLOTS, info) => {   // info(x) -> {slot,tt,n}
        // current per-slot occupancy on the stage character, and junk already staged per slot
        const slotCount = {}, junkStaged = {};
        for (const x of items) if (x.ownCid === stageCid && (x.loc === 'char' || x.loc === 'equipped')) {
          const s = info(x).slot; if (!s) continue;
          slotCount[s] = (slotCount[s] || 0) + 1;
          if (x.tag === 'junk' && !x.locked && x.loc === 'char' && info(x).tt === 5) junkStaged[s] = (junkStaged[s] || 0) + 1;
        }
        // vault junk waiting to be staged, bucketed by slot, lowest-power first
        const poolBySlot = {};
        for (const x of items) {
          if (x.tag !== 'junk' || x.locked || x.loc !== 'vault' || info(x).tt !== 5) continue;
          const s = info(x).slot; if (!s) continue;
          (poolBySlot[s] = poolBySlot[s] || []).push(x);
        }
        for (const s of SLOTS) (poolBySlot[s] || []).sort((a, b) => (a.pwr || 0) - (b.pwr || 0));
        for (const slot of SLOTS) {
          let need = cfg.junkStage - (junkStaged[slot] || 0);
          for (const x of (poolBySlot[slot] || [])) {
            if (need <= 0 || moves >= cfg.maxMovesPerRun) break;
            if ((slotCount[slot] || 0) >= STAGE_SLOT_CAP + 1) {   // slot full (1 equipped + 9) → make space
              const spill = items.find((y) => y.ownCid === stageCid && y.loc === 'char' && info(y).slot === slot && !y.locked && y.tag !== 'junk' && y.tag !== 'keep' && y.tag !== 'favorite');
              if (!spill) { log.actions.push({ stage: 'skip', kind, name: info(x).n, reason: `${slot} full, nothing safe to vault` }); break; }
              log.actions.push({ stage: 'spill', kind, name: info(spill).n, slot }); log.counts.spilled++;
              moves++;   // an attempt counts toward the cap
              if (!dryRun) { try { await transferItem(e, spill.id, spill.rhash, stageCid, true); spill.loc = 'vault'; spill.own = 'Vault'; spill.ownCid = null; } catch (err) { log.actions.push({ stage: 'error', kind, name: info(spill).n, error: err.message }); log.counts.spilled--; break; } }
              slotCount[slot]--;
            }
            log.actions.push({ stage: 'add', kind, name: info(x).n, slot }); log.counts.staged++;
            moves++;   // an attempt counts toward the cap
            if (!dryRun) { try { await transferItem(e, x.id, x.rhash, stageCid, false); x.loc = 'char'; x.ownCid = stageCid; x.own = LOCK_CTX?.clsById?.[stageCid] || x.own; } catch (err) { log.actions.push({ stage: 'error', kind, name: info(x).n, error: err.message }); log.counts.staged--; break; } }
            slotCount[slot] = (slotCount[slot] || 0) + 1; need--;
          }
        }
      };
      if (stageCid) {
        await stageJunkSet('weapon', wcache.weapons, ['Kinetic', 'Energy', 'Power'],
          (w) => ({ slot: defs[w.hash]?.slot, tt: defs[w.hash]?.tt, n: defs[w.hash]?.n || String(w.hash) }));
        if (cfg.armorStage !== false)
          await stageJunkSet('armor', wcache.armor || [], ['Helmet', 'Gauntlets', 'Chest', 'Leg', 'Class Item'],
            (a) => ({ slot: a.slot, tt: a.tt, n: a.n }));
      }

      const c = log.counts;
      log.note = `fav ${c.favorite} · keep ${c.keep} · junk ${c.junk} · staged ${c.staged}`;
      if (!dryRun) recordAutoRun(log);   // persist live tag changes so any run can be reverted
      console.log(`[auto] ${dryRun ? 'DRY ' : ''}safe=${act.safe} ${log.note}`);
    } catch (err) { log.note = 'error: ' + err.message; console.warn('auto-manage error:', err.message); }
    finally {
      // a dry-run mutates the in-memory snapshot with PRETEND tags (so its staging preview
      // works) — drop the cache so no later reader (UI, pollDrops, a live pass reusing a
      // young snapshot) ever acts on tags that were never actually written.
      if (dryRun) { wcache = null; }
      AUTO_LOG = log; managing = false;
    }
    return log;
  }

  checkGame(); setInterval(checkGame, 30000);
  setInterval(pollDrops, 25000);
  // Keep the inventory snapshot warm even when Destiny is CLOSED (pollDrops only refreshes
  // while playing), so pages + the banner "Updated" chip always see data ≤ ~1 min old.
  setInterval(() => { freshWeapons(55000).catch((err) => console.warn('background refresh failed:', err.message)); }, 60000);

  // ---------- Build Crafter: background upgrade watcher (60s) ----------
  // Evaluates every armor piece ONCE per build+rev (builds-seen.json). First pass / a
  // goal edit re-evaluates the whole vault into the FEED only; the TRMNL panel is only
  // interrupted for a piece that appeared between two snapshots while the game runs.
  // Armor is never acted on — notify only.
  let buildsBusy = false, prevArmorIds = null;
  async function checkBuilds() {
    if (buildsBusy) return;
    const builds = loadBuilds().filter((b) => b.watch && !b.draft && b.exotic?.hash);
    if (!builds.length) { prevArmorIds = null; return; }
    buildsBusy = true;
    try {
      if (!cache || Date.now() - aFetchedAt > 60000) { cache = await fetchArmor(e); aFetchedAt = Date.now(); }
      const armor = cache.items;
      const seen = loadJson(BUILDS_SEEN_FILE) || {};
      const alerts = loadBuildAlerts();
      const isFresh = (id) => !!prevArmorIds && !prevArmorIds.has(id);
      let dirtySeen = false, dirtyAlerts = false;
      for (const build of builds) {
        const champ = championSet(build, armor);
        for (const cand of armor) {
          if (cand.cls !== build.cls || !ARMOR_SLOTS.includes(cand.slot)) continue;
          const key = `${build.id}:${build.rev || 1}:${cand.id}`;
          if (seen[key]) continue;
          seen[key] = Date.now(); dirtySeen = true;   // evaluated once per piece+build+rev, hit or miss
          const r = isUpgrade(build, champ, cand);
          if (!r) continue;
          const entry = buildAlertEntry(build, champ, cand, r);
          entry.fresh = isFresh(cand.id);
          alerts.push(entry); dirtyAlerts = true;
          console.log(`[build] ${entry.fresh ? 'FRESH ' : ''}${build.name}: ${entry.text}`);
          if (entry.fresh && gameUp) {   // brand-new drop while playing → panel alert + chime
            try {
              fs.writeFileSync(DROP_ALERT_FILE, JSON.stringify({
                until: Date.now() + 60000, title: 'ARMOR UPGRADE',
                weapon: cand.n, ty: `${build.name} · ${cand.slot}`, power: cand.pwr, pct: 0,
                perks: [entry.text.slice(0, 140)], mw: '',
                stats: build.prio.slice(0, 3).map((k) => ({ n: STATN_B[k], v: `${champ.T[k] || 0}→${r.T2[k] || 0}` })),
              }));
              beepUpgrade();
            } catch {}
          }
        }
      }
      // prune seen-keys of deleted builds / old revs (checked against ALL builds, not just watched)
      const live = new Set(loadBuilds().map((b) => `${b.id}:${b.rev || 1}`));
      for (const k of Object.keys(seen)) { if (!live.has(k.split(':').slice(0, 2).join(':'))) { delete seen[k]; dirtySeen = true; } }
      if (dirtySeen) saveJsonSafe(BUILDS_SEEN_FILE, seen);
      if (dirtyAlerts) { BUILD_ALERTS_CACHE = alerts.slice(-200); saveBuildAlerts(); }
      prevArmorIds = new Set(armor.map((i) => i.id));
    } catch (err) { console.warn('build check error:', err.message); }
    finally { buildsBusy = false; }
  }
  setInterval(() => { checkBuilds().catch(() => {}); }, 60000);

  // Auto-manage cadence (Diego 2026-07-12, "save API calls"): while Destiny is RUNNING,
  // pace by where you are — IN an activity the tick is just the cheap 1-call activity
  // check every `activitySeconds` (15s, so staging fires within seconds of the activity
  // ENDING); SAFE in orbit/social it's every `orbitSeconds` (60s — junk top-up cadence).
  // idleSeconds (120s) paces the no-op tick while the game is CLOSED. Even with the
  // Auto-Manager DISABLED the tick still checks the activity while the game runs, so the
  // banner chip can show what activity is detected (Diego wants to SEE detection working).
  let autoTimer = null;
  const scheduleAuto = (sec) => { clearTimeout(autoTimer); autoTimer = setTimeout(autoTick, Math.max(10, sec) * 1000); };
  async function autoTick() {
    const cfg = loadAuto();
    let sec = cfg.idleSeconds || 120, state = 'paused';
    try {
      if (gameUp) {
        let safe = null;
        if (cfg.enabled) {
          const log = await autoManage();   // calls fetchActivity internally (updates LAST_ACT)
          safe = log.safe;
          state = (safe === false) ? 'waiting for orbit' : 'active';
        } else {
          const act = await fetchActivity(e).catch(() => null);   // chip-only activity probe
          safe = act ? act.safe : null;
          state = 'disabled';
        }
        sec = (safe === false) ? (cfg.activitySeconds || 15) : (cfg.orbitSeconds || 60);
      }
      AUTO_LOG.state = state; AUTO_LOG.nextSec = sec;
    } catch (err) { console.warn('autoTick error:', err.message); }
    scheduleAuto(sec);
  }
  onGameStart = () => scheduleAuto(3);            // game just launched → run almost immediately
  scheduleAuto(gameUp ? 5 : 15);                  // first pass shortly after start
}

main().catch((err) => { console.error(err.message); process.exit(1); });
