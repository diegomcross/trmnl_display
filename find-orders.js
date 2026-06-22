// find-orders.js — locates Orders by resolving every objective in the snapshot
// to its real text label (via the public manifest, API key only). Skips Triumph
// records to cut noise. Reads snapshot.json, writes orders-debug.json.
//
// Run:  node find-orders.js     then upload orders-debug.json to Claude.

import fs from 'node:fs';

const BASE = 'https://www.bungie.net/Platform';
const CACHE = './debug-cache.json';

const API_KEY = (() => {
  const o = {};
  if (fs.existsSync('./.env')) for (const l of fs.readFileSync('./.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2]; }
  return o.BUNGIE_API_KEY;
})();
if (!API_KEY) { console.error('Missing BUNGIE_API_KEY in .env'); process.exit(1); }
if (!fs.existsSync('./snapshot.json')) { console.error('snapshot.json not found.'); process.exit(1); }
const D = JSON.parse(fs.readFileSync('./snapshot.json', 'utf8'));

let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
async function def(type, hash) {
  if (hash == null) return null;
  const key = `${type}/${hash}`;
  if (cache[key] !== undefined) return cache[key];
  let out = null;
  try {
    const r = await fetch(`${BASE}/Destiny2/Manifest/${type}/${hash}/`, { headers: { 'X-API-Key': API_KEY } });
    const j = await r.json();
    const d = j.ErrorCode === 1 ? j.Response : null;
    if (d) out = { name: d.displayProperties?.name || '', desc: d.progressDescription ?? d.displayProperties?.description ?? '' };
  } catch {}
  cache[key] = out;
  return out;
}

// Collect every objective in the snapshot with its location path, skipping records/triumphs.
const objs = [];
function walk(o, path) {
  if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
  if (o && typeof o === 'object') {
    if (typeof o.objectiveHash !== 'undefined' && ('progress' in o || 'complete' in o)) {
      const lp = path.toLowerCase();
      if (!lp.includes('record') && !lp.includes('presentationnode')) {
        objs.push({ path, objectiveHash: o.objectiveHash, progress: o.progress || 0, completionValue: o.completionValue || 0, complete: !!o.complete });
      }
    }
    for (const k of Object.keys(o)) walk(o[k], `${path}/${k}`);
  }
}
walk(D, '');

(async () => {
  // resolve labels (dedup by hash)
  const labels = {};
  for (const e of objs) if (!(e.objectiveHash in labels)) labels[e.objectiveHash] = (await def('DestinyObjectiveDefinition', e.objectiveHash))?.desc || '';
  fs.writeFileSync(CACHE, JSON.stringify(cache));

  // group by area = first two path segments
  const byArea = {};
  for (const e of objs) {
    const area = e.path.split('/').filter(Boolean).slice(0, 2).join('/') || '(root)';
    (byArea[area] ||= []).push({ label: labels[e.objectiveHash], progress: e.progress, completionValue: e.completionValue, complete: e.complete, path: e.path });
  }
  fs.writeFileSync('./orders-debug.json', JSON.stringify({ totalObjectives: objs.length, byArea }, null, 2));

  console.log(`Found ${objs.length} non-record objectives across ${Object.keys(byArea).length} areas:`);
  for (const [area, list] of Object.entries(byArea)) console.log(`  ${area}: ${list.length}`);
  console.log('\nLabels that look like Orders (precision / final blows / rapidly / etc.):');
  for (const e of objs) {
    const L = labels[e.objectiveHash] || '';
    if (/precision|final blow|rapidly|weak spot|grenade|melee|defeat/i.test(L))
      console.log(`  "${L}" ${e.progress}/${e.completionValue}  @ ${e.path}`);
  }
  console.log('\nWrote orders-debug.json — upload it to Claude.');
})();
