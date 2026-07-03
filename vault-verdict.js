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
  const cacheFile = path.join(CACHE_DIR, `slim5-${version}.json`);
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

// ---------- profile fetch (shared by armor + weapons) ----------
async function fetchProfile(e) {
  const tok = await accessToken(e);
  const ms = await bungie(`${BASE}/User/GetMembershipsById/${tok.membership_id}/254/`, e, tok.access_token);
  const primary = ms.primaryMembershipId;
  const m = (ms.destinyMemberships || []).find((x) => x.membershipId === primary)
    || (ms.destinyMemberships || []).find((x) => x.crossSaveOverride === 0 || x.crossSaveOverride === x.membershipType)
    || ms.destinyMemberships[0];
  const prof = await bungie(
    `${BASE}/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=102,200,201,205,300,304,305,310`,
    e, tok.access_token
  );
  const man = await loadManifest(e);
  const charName = {};
  for (const [cid, c] of Object.entries(prof.characters?.data || {})) charName[cid] = CLASS[c.classType] || 'Unknown';
  const raw = [];
  for (const it of prof.profileInventory?.data?.items || []) raw.push({ it, own: 'Vault' });
  for (const [cid, inv] of Object.entries(prof.characterInventories?.data || {}))
    for (const it of inv.items || []) raw.push({ it, own: charName[cid] });
  for (const [cid, eq] of Object.entries(prof.characterEquipment?.data || {}))
    for (const it of eq.items || []) raw.push({ it, own: charName[cid] });
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
      slot, cls: CLASS[def.c] || '—', src: def.src || '',
      a: archetype, ter, mw: 0,
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

async function fetchWeapons(e) {
  const { prof, man, m, raw } = await fetchProfile(e);
  const { tags } = dimOverlay();

  const instances = prof.itemComponents?.instances?.data || {};
  const liveStats = prof.itemComponents?.stats?.data || {};
  const sockets = prof.itemComponents?.sockets?.data || {};
  const reusable = prof.itemComponents?.reusablePlugs?.data || {};

  const weapons = [], defsOut = {}, perkIcons = {}; // perkIcons: perk name -> bungie.net icon path
  const px = (n, h) => { const ic = man.items[h]?.icon; if (ic && !perkIcons[n]) perkIcons[n] = ic; };
  for (const { it, own } of raw) {
    const def = man.items[it.itemHash];
    if (!def || def.it !== 3 || !it.itemInstanceId || !WBUCKET[def.b]) continue;
    const id = it.itemInstanceId;
    const inst = instances[id] || {};
    const socks = sockets[id]?.sockets || [];
    const reuse = reusable[id]?.plugs || {};

    // trait columns: every perk available on THIS roll (multi-perk drops included).
    // Perks are identified by NAME: enhanced and normal variants of the same perk
    // have different hashes, and the watch config must match either.
    const cols = [[], []];
    (def.ti || []).forEach((si, ci) => {
      if (si < 0) return;
      const opts = reuse[si]?.map((p) => p.plugItemHash) || (socks[si]?.plugHash ? [socks[si].plugHash] : []);
      const byName = new Map();
      for (const h of opts) {
        const n = man.items[h]?.n || `#${h}`;
        if (!byName.has(n)) byName.set(n, { n, on: false });
        if (socks[si]?.plugHash === h) byName.get(n).on = true;
        px(n, h);
      }
      cols[ci] = [...byName.values()];
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
        ammo: AMMO[def.ammo] || '', dmg: DMG[def.dmg] || '', src: def.src || '',
        icon: def.icon || '', shot: def.shot || '',
        pool: (def.tr || []).map((ps) => {
          const names = new Set();
          for (const h of (man.plugSets[ps] || [])) { const n = man.items[h]?.n || `#${h}`; names.add(n); px(n, h); }
          return [...names];
        }),
      };
    }
    weapons.push({
      id, hash: it.itemHash, rhash: it.itemHash, own, locked: !!(it.state & 1),
      tag: tags[id]?.tag || '', pwr: inst.primaryStat?.value || 0,
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

  // new-drop detection: flag copies whose instance id we haven't seen before.
  const seen = loadSeen();
  if (!seen.seeded) { for (const w of weapons) seen.ids.add(w.id); seen.seeded = true; saveSeen(seen); }
  for (const w of weapons) w.fresh = !seen.ids.has(w.id);

  return { weapons, defs: mergedDefs, perkIcons, fetchedAt: new Date().toISOString(), account: `${m.membershipType}/${m.membershipId}` };
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

// ---------- probe mode for debugging ----------
async function probe(nameLike) {
  const e = env();
  const data = await fetchArmor(e);
  const hit = data.items.find((i) => i.n.toLowerCase().includes(nameLike.toLowerCase()));
  console.log(hit ? JSON.stringify(hit, null, 2) : `No armor matching "${nameLike}".`);
  if (hit) console.log('\nIf tier/archetype/base stats look wrong, paste this output back to Claude.');
}

// ---------- server ----------
const readBody = (req) => new Promise((ok) => {
  let b = ''; req.on('data', (c) => b += c); req.on('end', () => ok(b));
});

async function main() {
  if (process.argv[2] === 'probe') return probe(process.argv[3] || '');
  const e = env();
  let cache = null, wcache = null;
  const server = http.createServer(async (req, res) => {
    try {
      const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/api/armor')) {
        const fresh = req.url.includes('fresh=1');
        if (!cache || fresh) cache = await fetchArmor(e);
        return json(cache);
      }
      if (req.url.startsWith('/api/weapons')) {
        const fresh = req.url.includes('fresh=1');
        if (!wcache || fresh) wcache = await fetchWeapons(e);
        return json(wcache);
      }
      if (req.url.startsWith('/api/watch')) {
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req) || '{}');
          saveWatch(body);
          return json({ ok: true });
        }
        return json(loadWatch());
      }
      if (req.url.startsWith('/api/tags')) {
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req) || '{}');
          saveTags(body);
          return json({ ok: true });
        }
        return json(loadTags());
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
        const { id, hash, own } = JSON.parse(await readBody(req) || '{}');
        if (!id || !hash) return json({ error: 'missing id/hash' });
        const r = await equipWeapon(e, id, hash, own);
        if (wcache) { const w = wcache.weapons.find((x) => x.id === id); if (w) w.own = r.own; }
        return json({ ok: true, own: r.own });
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.url.startsWith('/weapons')) return res.end(fs.readFileSync(path.join(__dirname, 'weapon-watch.html')));
      if (req.url.startsWith('/drops')) return res.end(fs.readFileSync(path.join(__dirname, 'weapon-drops.html')));
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
