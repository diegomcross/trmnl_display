// probe-vendor.js — diagnostic. Queries EACH vendor individually (the per-vendor
// GetVendor endpoint returns richer data than the bulk call) and reports which
// vendors return sale-item OBJECTIVES — that's where Vanguard Orders should be.
// Uses your saved login (tokens.json) + .env. Reads snapshot.json for ids.
//
// Run:  node probe-vendor.js     then upload probe-result.json to Claude.

import fs from 'node:fs';

const BASE = 'https://www.bungie.net/Platform';
const CACHE = './debug-cache.json';

function loadEnv() {
  const o = {};
  for (const l of fs.readFileSync('./.env', 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2];
  }
  return o;
}
const env = loadEnv();
const D = JSON.parse(fs.readFileSync('./snapshot.json', 'utf8'));

async function token() {
  const t = JSON.parse(fs.readFileSync('./tokens.json', 'utf8'));
  if (Date.now() < t.expires_at - 60000) return t.access_token;
  const basic = Buffer.from(`${env.BUNGIE_CLIENT_ID}:${env.BUNGIE_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${BASE}/App/OAuth/Token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-API-Key': env.BUNGIE_API_KEY, Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  const j = await r.json();
  t.access_token = j.access_token; t.refresh_token = j.refresh_token;
  t.expires_at = Date.now() + j.expires_in * 1000;
  fs.writeFileSync('./tokens.json', JSON.stringify(t, null, 2));
  return t.access_token;
}

let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
async function vendorName(at, hash) {
  const key = `DestinyVendorDefinition/${hash}`;
  if (cache[key] !== undefined) return cache[key]?.name || '';
  try {
    const r = await fetch(`${BASE}/Destiny2/Manifest/DestinyVendorDefinition/${hash}/`, { headers: { 'X-API-Key': env.BUNGIE_API_KEY } });
    const j = await r.json();
    cache[key] = j.ErrorCode === 1 ? { name: j.Response.displayProperties?.name || '' } : null;
  } catch { cache[key] = null; }
  return cache[key]?.name || '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const at = await token();
  const mtype = D.profile.data.userInfo.membershipType;
  const mid = D.profile.data.userInfo.membershipId;
  const char = D.vendorCharacterId || Object.keys(D.characters.data)[0];
  const vendorHashes = Object.keys(D.vendors?.sales?.data || D.vendors?.vendors?.data || {});
  console.log(`Probing ${vendorHashes.length} vendors for sale-item objectives...`);

  const found = [];
  let i = 0;
  for (const vh of vendorHashes) {
    i++;
    try {
      const r = await fetch(
        `${BASE}/Destiny2/${mtype}/Profile/${mid}/Character/${char}/Vendors/${vh}/?components=402,302,300`,
        { headers: { 'X-API-Key': env.BUNGIE_API_KEY, Authorization: `Bearer ${at}` } }
      );
      const j = await r.json();
      const objData = j.Response?.itemComponents?.objectives?.data || {};
      const n = Object.keys(objData).length;
      if (n > 0) {
        const name = await vendorName(at, vh);
        const sales = j.Response?.sales?.data || {};
        // attach objective progress to each sale index that has it
        const items = [];
        for (const [idx, oc] of Object.entries(objData)) {
          const si = sales[idx];
          items.push({ saleIndex: idx, itemHash: si?.itemHash, objectives: (oc.objectives || []).map((o) => ({ objectiveHash: o.objectiveHash, progress: o.progress, completionValue: o.completionValue, complete: o.complete })) });
        }
        found.push({ vendorHash: vh, name, count: n, items });
        console.log(`  >>> vendor ${vh} (${name}) has ${n} items with objectives`);
      }
    } catch (e) { /* skip */ }
    if (i % 25 === 0) console.log(`  ...${i}/${vendorHashes.length}`);
    await sleep(60);
  }

  fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync('./probe-result.json', JSON.stringify({ found }, null, 2));
  console.log(`\nDone. Vendors with objectives: ${found.length}. Wrote probe-result.json — upload it to Claude.`);
})();
