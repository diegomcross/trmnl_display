// render.js — builds the Destiny 2 e-ink screen from your local snapshot.json.
//
// Orders   = instanced items in inventory bucket 635141261, objectives from component 301 (ItemObjectives).
// Quests   = items in the pursuits bucket 1345459588 (quest steps + bounties).
// Plus Conquests (Conqueror seal), Seals & Titles, and your tracked Triumph.
//
// Resolves names via the public manifest (API key only). Writes screen.png and
// prints a report so running it doubles as the test.
//
// Run:  node render.js

import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const BASE = 'https://www.bungie.net/Platform';
const CACHE = './manifest-cache.json';
const ORDERS_BUCKET = 635141261;
const PURSUITS_BUCKET = 1345459588;
const FONT = 'Arial, Helvetica, sans-serif';

const env = (() => { const o = {}; if (fs.existsSync('./.env')) for (const l of fs.readFileSync('./.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2]; } return o; })();
const API_KEY = env.BUNGIE_API_KEY;
if (!API_KEY) { console.error('Missing BUNGIE_API_KEY in .env'); process.exit(1); }
if (!fs.existsSync('./snapshot.json')) { console.error('snapshot.json not found — run auth-and-snapshot.js first.'); process.exit(1); }
const D = JSON.parse(fs.readFileSync('./snapshot.json', 'utf8'));

let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
let dirty = false;
async function getDef(type, hash) {
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
      children: d.children ? (d.children.presentationNodes || []).map((c) => c.presentationNodeHash) : undefined,
    };
  } catch {}
  cache[key] = out; dirty = true;
  return out;
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };
const clamp01 = (x) => Math.max(0, Math.min(1, x || 0));
// objective icon tokens like "[Headshot]" -> readable words
const cleanLabel = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
function progressOf(objs) {
  objs = (objs || []).filter((o) => o && o.visible !== false);
  if (!objs.length) return null;
  const prog = objs.reduce((s, o) => s + Math.min(o.progress || 0, o.completionValue || 0), 0);
  const total = objs.reduce((s, o) => s + (o.completionValue || 0), 0);
  return { prog, total, frac: total ? prog / total : 0, complete: objs.every((o) => o.complete) };
}
function bar(x, y, w, frac, h = 10) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000"/><rect x="${x}" y="${y}" width="${Math.round(w * clamp01(frac))}" height="${h}" fill="#000"/>`;
}
function txt(x, y, size, s, { anchor = 'start', fill = '#000', weight = 400 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}

(async () => {
  const chars = D.characters.data;
  const wid = Object.keys(chars).filter((c) => chars[c].classType === 2)
    .sort((a, b) => new Date(chars[b].dateLastPlayed) - new Date(chars[a].dateLastPlayed))[0] || Object.keys(chars)[0];
  const light = chars[wid].light;

  const inv = D.characterInventories?.data?.[wid]?.items || [];
  const uio = D.characterProgressions?.data?.[wid]?.uninstancedItemObjectives || {};
  const objInst = D.itemComponents?.objectives?.data || {}; // component 301

  const objectivesFor = (it) =>
    (it.itemInstanceId && objInst[it.itemInstanceId]?.objectives) || uio[it.itemHash] || [];

  // ---- ORDERS (bucket 635141261) ----
  const orders = [];
  for (const it of inv.filter((i) => i.bucketHash === ORDERS_BUCKET)) {
    const idef = await getDef('DestinyInventoryItemDefinition', it.itemHash);
    const objs = objectivesFor(it);
    const p = progressOf(objs);
    let label = '';
    if (objs[0]) label = cleanLabel((await getDef('DestinyObjectiveDefinition', objs[0].objectiveHash))?.desc);
    orders.push({ name: idef?.name || `Order ${it.itemHash}`, type: idef?.type || '', label, p, tracked: !!((it.state || 0) & 2) });
  }

  // ---- QUESTS & BOUNTIES (pursuits bucket) ----
  const quests = [];
  for (const it of inv.filter((i) => i.bucketHash === PURSUITS_BUCKET)) {
    const idef = await getDef('DestinyInventoryItemDefinition', it.itemHash);
    const objs = objectivesFor(it);
    const p = progressOf(objs);
    if (p && p.complete) continue; // hide finished
    quests.push({ name: idef?.name || `Item ${it.itemHash}`, type: idef?.type || '', p, tracked: !!((it.state || 0) & 2) });
  }

  const sortRows = (a, b) => (b.tracked - a.tracked) || ((b.p?.frac || 0) - (a.p?.frac || 0));
  orders.sort(sortRows);
  quests.sort(sortRows);
  const ordersTop = orders.slice(0, 5);
  const questsTop = quests.slice(0, 3);

  // ---- SEALS / CONQUESTS / TRIUMPH ----
  const pnodes = D.profilePresentationNodes?.data?.nodes || {};
  const sealsRoot = D.profileRecords?.data?.recordSealsRootNodeHash;
  let seals = [];
  if (sealsRoot) {
    const rootDef = await getDef('DestinyPresentationNodeDefinition', sealsRoot);
    for (const ch of rootDef?.children || []) {
      const nd = pnodes[ch];
      if (!nd || !nd.completionValue) continue;
      const def = await getDef('DestinyPresentationNodeDefinition', ch);
      seals.push({ name: def?.name || `Seal ${ch}`, frac: clamp01((nd.progressValue || 0) / nd.completionValue) });
    }
  }
  seals.sort((a, b) => b.frac - a.frac);
  const conqueror = seals.find((s) => /conqueror/i.test(s.name));
  const otherSeals = seals.filter((s) => s !== conqueror && s.frac < 1).slice(0, 3);

  const trk = D.profileRecords?.data?.trackedRecordHash;
  let triumph = null;
  if (trk) { const def = await getDef('DestinyRecordDefinition', trk); triumph = { name: def?.name || 'Tracked', p: progressOf(D.profileRecords.data.records?.[trk]?.objectives) }; }

  if (dirty) fs.writeFileSync(CACHE, JSON.stringify(cache));

  // ---- report (this is the test) ----
  const pct = (p) => (p ? Math.round(p.frac * 100) + '%' : '\u2014');
  console.log(`\nORDERS (${orders.length}):`);
  for (const o of orders) console.log(`   - ${o.name} [${o.type}] :: ${o.label} \u2014 ${o.p ? o.p.prog + '/' + o.p.total + ' (' + pct(o.p) + ')' : ''}`);
  console.log(`QUESTS & BOUNTIES in progress (${quests.length}); showing top ${questsTop.length}`);
  console.log(`SEALS in progress: ${seals.filter((s) => s.frac < 1).length}; Conqueror: ${conqueror ? pct({ frac: conqueror.frac }) : 'n/a'}; tracked triumph: ${triumph ? triumph.name : 'none'}`);

  // ---- SVG ----
  const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let s = `<rect x="0" y="0" width="800" height="480" fill="#fff"/>`;
  s += txt(20, 36, 22, 'Warlock', { weight: 500 }) + txt(140, 36, 15, `Power ${light}`, { fill: '#444' });
  s += txt(780, 32, 13, `Updated ${now}`, { anchor: 'end', fill: '#444' });
  s += `<line x1="20" y1="50" x2="780" y2="50" stroke="#000"/>`;

  // Left column: Orders
  s += txt(20, 80, 18, 'Orders', { weight: 500 });
  let y = 106;
  if (!ordersTop.length) s += txt(20, y, 15, 'No active orders', { fill: '#888' });
  for (const o of ordersTop) {
    const head = (o.tracked ? '\u2605 ' : '') + o.name + (o.label ? ' \u2014 ' + o.label : '');
    s += txt(20, y, 15, trunc(head, 44));
    if (o.p) s += txt(505, y, 14, pct(o.p), { anchor: 'end', fill: '#555' });
    s += bar(20, y + 7, 485, o.p?.frac || 0);
    y += 42;
  }

  // Left column: Quests & Bounties
  let qy = Math.max(y + 8, 340);
  s += txt(20, qy, 18, 'Quests & bounties', { weight: 500 }); qy += 26;
  if (!questsTop.length) s += txt(20, qy, 15, 'Nothing in progress', { fill: '#888' });
  for (const q of questsTop) {
    s += txt(20, qy, 14, trunc(q.name, 40));
    if (q.p) s += txt(505, qy, 13, `${q.p.prog}/${q.p.total}`, { anchor: 'end', fill: '#555' });
    qy += 26;
  }

  // Divider + right column
  s += `<line x1="520" y1="62" x2="520" y2="446" stroke="#000"/>`;
  const RX = 536;
  s += txt(RX, 80, 18, 'Conquests', { weight: 500 });
  if (conqueror) s += txt(RX, 106, 15, 'Conqueror seal') + txt(780, 106, 14, `${Math.round(conqueror.frac * 100)}%`, { anchor: 'end', fill: '#555' }) + bar(RX, 112, 244, conqueror.frac, 10);
  else s += txt(RX, 106, 15, 'Conqueror not started', { fill: '#888' });
  s += `<line x1="${RX}" y1="136" x2="780" y2="136" stroke="#bbb"/>`;

  s += txt(RX, 162, 18, 'Seals & titles', { weight: 500 });
  let ry = 188;
  if (!otherSeals.length) s += txt(RX, ry, 15, 'No seals in progress', { fill: '#888' });
  for (const sl of otherSeals) { s += txt(RX, ry, 15, trunc(sl.name, 22)) + txt(780, ry, 14, `${Math.round(sl.frac * 100)}%`, { anchor: 'end', fill: '#555' }) + bar(RX, ry + 6, 244, sl.frac, 10); ry += 36; }

  let ty = Math.max(ry + 8, 320);
  s += `<line x1="${RX}" y1="${ty - 16}" x2="780" y2="${ty - 16}" stroke="#bbb"/>`;
  s += txt(RX, ty + 6, 18, 'Tracked triumph', { weight: 500 });
  if (triumph) { s += txt(RX, ty + 32, 15, trunc(triumph.name, 24)); if (triumph.p) s += txt(780, ty + 32, 14, `${triumph.p.prog}/${triumph.p.total}`, { anchor: 'end', fill: '#555' }) + bar(RX, ty + 38, 244, triumph.p.frac, 10); }
  else s += txt(RX, ty + 32, 15, 'None tracked', { fill: '#888' });

  s += `<line x1="20" y1="452" x2="780" y2="452" stroke="#000"/>`;
  s += txt(20, 472, 13, 'Sch\u014dla B\u0113llica', { fill: '#555' }) + txt(780, 472, 13, 'trmnl \u00b7 refreshes every 60s', { anchor: 'end', fill: '#555' });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">${s}</svg>`;
  fs.writeFileSync('./screen.png', new Resvg(svg, { fitTo: { mode: 'original' }, background: '#ffffff' }).render().asPng());
  console.log('\nWrote screen.png — open it to see the display.');
})();
