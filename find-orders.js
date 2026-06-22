// find-orders.js — diagnostic. Resolves your data's hashes to real NAMES so we
// can locate exactly where Vanguard Orders live. Uses the public manifest
// (API key only, no login). Reads snapshot.json, writes orders-debug.json.
//
// Run:  node find-orders.js     then upload orders-debug.json to Claude.

import fs from 'node:fs';

const BASE = 'https://www.bungie.net/Platform';
const CACHE = './debug-cache.json';
const PURSUITS = 1345459588;

function loadEnv() {
  const out = {};
  if (fs.existsSync('./.env'))
    for (const l of fs.readFileSync('./.env', 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2];
    }
  return out;
}
const API_KEY = loadEnv().BUNGIE_API_KEY;
if (!API_KEY) { console.error('Missing BUNGIE_API_KEY in .env'); process.exit(1); }
if (!fs.existsSync('./snapshot.json')) { console.error('snapshot.json not found.'); process.exit(1); }
const D = JSON.parse(fs.readFileSync('./snapshot.json', 'utf8'));

let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
let dirty = false;
async function def(type, hash) {
  if (hash == null) return null;
  const key = `${type}/${hash}`;
  if (cache[key] !== undefined) return cache[key];
  let out = null;
  try {
    const r = await fetch(`${BASE}/Destiny2/Manifest/${type}/${hash}/`, { headers: { 'X-API-Key': API_KEY } });
    const j = await r.json();
    const d = j.ErrorCode === 1 ? j.Response : null;
    if (d) out = {
      name: d.displayProperties?.name || '',
      type: d.itemTypeDisplayName || '',
      desc: d.progressDescription ?? d.displayProperties?.description ?? '',
      traits: d.traitIds || undefined,
    };
  } catch {}
  cache[key] = out; dirty = true;
  return out;
}

function objList(objs) { return (objs || []).filter((o) => o && o.visible !== false); }

(async () => {
  const chars = D.characters.data;
  const wid = Object.keys(chars).filter((c) => chars[c].classType === 2)
    .sort((a, b) => new Date(chars[b].dateLastPlayed) - new Date(chars[a].dateLastPlayed))[0]
    || Object.keys(chars)[0];

  const inv = D.characterInventories?.data?.[wid]?.items || [];
  const uio = D.characterProgressions?.data?.[wid]?.uninstancedItemObjectives || {};
  const objInst = D.itemComponents?.objectives?.data || {};

  // 1) Resolve every pursuit-bucket item with its objective labels.
  const pursuits = [];
  for (const it of inv.filter((i) => i.bucketHash === PURSUITS)) {
    const idef = await def('DestinyInventoryItemDefinition', it.itemHash);
    const objs = uio[it.itemHash] || (it.itemInstanceId && objInst[it.itemInstanceId]?.objectives) || [];
    const objOut = [];
    for (const o of objList(objs)) {
      const odef = await def('DestinyObjectiveDefinition', o.objectiveHash);
      objOut.push({ label: odef?.desc || '', progress: o.progress || 0, completionValue: o.completionValue || 0, complete: !!o.complete });
    }
    pursuits.push({
      itemHash: it.itemHash,
      name: idef?.name || '',
      type: idef?.type || '',
      traits: idef?.traits,
      tracked: !!((it.state || 0) & 2),
      objectives: objOut,
    });
  }

  // 2) Resolve vendor names; for any that look Orders-related, list their items.
  const vendors = D.vendors?.sales?.data || {};
  const orderVendors = [];
  const allVendorNames = [];
  for (const vh of Object.keys(vendors)) {
    const vdef = await def('DestinyVendorDefinition', vh);
    const nm = vdef?.name || '';
    allVendorNames.push({ vendorHash: vh, name: nm });
    if (/order|vanguard|portal|seasonal|zavala|tower command/i.test(nm)) {
      const items = [];
      for (const si of Object.values(vendors[vh].saleItems || {}).slice(0, 40)) {
        const sidef = await def('DestinyInventoryItemDefinition', si.itemHash);
        items.push({ itemHash: si.itemHash, name: sidef?.name || '', type: sidef?.type || '' });
      }
      orderVendors.push({ vendorHash: vh, name: nm, items });
    }
  }

  if (dirty) fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync('./orders-debug.json', JSON.stringify({ pursuits, orderVendors, allVendorNames }, null, 2));

  console.log(`Resolved ${pursuits.length} pursuits. Order-like vendors found: ${orderVendors.length}.`);
  console.log('Pursuit names:');
  for (const p of pursuits) console.log(`  - ${p.name} [${p.type}]${p.tracked ? ' (tracked)' : ''}` +
    (p.objectives.length ? `  -> ${p.objectives.map(o => `${o.label} ${o.progress}/${o.completionValue}`).join('; ')}` : ''));
  console.log('\nWrote orders-debug.json — upload that to Claude.');
})();
