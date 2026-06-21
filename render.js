// render.js — builds the e-ink screen image from your Destiny data.
//
// For this first version it reads your existing snapshot.json (the real data we
// already pulled) and resolves the numeric hashes to names using Bungie's PUBLIC
// manifest — that needs only your API key, no login. It writes screen.png, which
// you open to preview the layout. Once it looks right, we wrap it in the live
// server and point the TRMNL at it.
//
// Run:  npm install   (once)    then:   node render.js
// Needs: .env with BUNGIE_API_KEY, and snapshot.json in this folder.

import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const BASE = 'https://www.bungie.net/Platform';
const CACHE_FILE = './manifest-cache.json';
const PURSUITS_BUCKET = 1345459588;
const FONT = 'Arial, Helvetica, sans-serif';

function loadEnv() {
  const out = {};
  if (fs.existsSync('./.env'))
    for (const line of fs.readFileSync('./.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  return out;
}
const env = loadEnv();
const API_KEY = env.BUNGIE_API_KEY;
if (!API_KEY) { console.error('Missing BUNGIE_API_KEY in .env'); process.exit(1); }
if (!fs.existsSync('./snapshot.json')) { console.error('snapshot.json not found — run auth-and-snapshot.js first.'); process.exit(1); }
const D = JSON.parse(fs.readFileSync('./snapshot.json', 'utf8'));

let cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
let dirty = false;
async function getDef(type, hash) {
  if (hash == null) return null;
  const key = `${type}/${hash}`;
  if (cache[key] !== undefined) return cache[key];
  let slim = null;
  try {
    const res = await fetch(`${BASE}/Destiny2/Manifest/${type}/${hash}/`, { headers: { 'X-API-Key': API_KEY } });
    const j = await res.json();
    const def = j.ErrorCode === 1 ? j.Response : null;
    if (def) slim = {
      name: def.displayProperties?.name || '',
      type: def.itemTypeDisplayName || '',
      itemType: def.itemType,
      children: def.children ? (def.children.presentationNodes || []).map((c) => c.presentationNodeHash) : undefined,
    };
  } catch { slim = null; }
  cache[key] = slim; dirty = true;
  return slim;
}
function saveCache() { if (dirty) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };
const clamp01 = (x) => Math.max(0, Math.min(1, x || 0));
function progressOf(objs) {
  objs = (objs || []).filter((o) => o && o.visible !== false);
  if (!objs.length) return null;
  const prog = objs.reduce((s, o) => s + Math.min(o.progress || 0, o.completionValue || 0), 0);
  const total = objs.reduce((s, o) => s + (o.completionValue || 0), 0);
  return { prog, total, frac: total ? prog / total : 0, complete: objs.every((o) => o.complete) };
}
function bar(x, y, w, frac, h = 11) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000"/>` +
         `<rect x="${x}" y="${y}" width="${Math.round(w * clamp01(frac))}" height="${h}" fill="#000"/>`;
}
function txt(x, y, size, s, { anchor = 'start', fill = '#000', weight = 400 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}

(async () => {
  const chars = D.characters.data;
  const warlocks = Object.keys(chars).filter((c) => chars[c].classType === 2);
  const wid = (warlocks.length ? warlocks : Object.keys(chars))
    .sort((a, b) => new Date(chars[b].dateLastPlayed) - new Date(chars[a].dateLastPlayed))[0];
  const light = chars[wid].light;

  const inv = D.characterInventories.data?.[wid]?.items || [];
  const uio = D.characterProgressions.data?.[wid]?.uninstancedItemObjectives || {};
  const objInst = D.itemComponents?.objectives?.data || {};
  const pursuitItems = inv.filter((it) => it.bucketHash === PURSUITS_BUCKET);

  const orders = [], quests = [];
  for (const it of pursuitItems) {
    const def = await getDef('DestinyInventoryItemDefinition', it.itemHash);
    const objs = uio[it.itemHash] || (it.itemInstanceId && objInst[it.itemInstanceId]?.objectives) || [];
    const p = progressOf(objs);
    const tracked = !!((it.state || 0) & 2);
    const name = def?.name || `Item ${it.itemHash}`;
    const isQuest = def && (def.itemType === 12 || /quest/i.test(def.type || ''));
    if (isQuest) quests.push({ name, p, tracked });
    else if (p) orders.push({ name, p, tracked });
  }
  orders.sort((a, b) => (b.tracked - a.tracked) || ((b.p?.frac || 0) - (a.p?.frac || 0)));
  const ordersTop = orders.slice(0, 6);
  const questsTop = quests.slice(0, 3);

  const pnodes = D.profilePresentationNodes.data?.nodes || {};
  const sealsRoot = D.profileRecords.data?.recordSealsRootNodeHash;
  let seals = [];
  if (sealsRoot) {
    const rootDef = await getDef('DestinyPresentationNodeDefinition', sealsRoot);
    for (const childHash of rootDef?.children || []) {
      const nd = pnodes[childHash];
      if (!nd || !nd.completionValue) continue;
      const def = await getDef('DestinyPresentationNodeDefinition', childHash);
      seals.push({ name: def?.name || `Seal ${childHash}`, frac: clamp01((nd.progressValue || 0) / nd.completionValue) });
    }
  }
  seals.sort((a, b) => b.frac - a.frac);
  const conqueror = seals.find((s) => /conqueror/i.test(s.name));
  const otherSeals = seals.filter((s) => s !== conqueror && s.frac < 1).slice(0, 3);

  const trk = D.profileRecords.data?.trackedRecordHash;
  let triumph = null;
  if (trk) {
    const def = await getDef('DestinyRecordDefinition', trk);
    const rec = D.profileRecords.data.records?.[trk];
    triumph = { name: def?.name || 'Tracked triumph', p: progressOf(rec?.objectives) };
  }
  saveCache();

  console.log(`Warlock pursuits: ${pursuitItems.length} | orders: ${orders.length} | quests: ${quests.length} | seals in progress: ${seals.filter(s=>s.frac<1).length}`);

  const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let s = '';
  s += `<rect x="0" y="0" width="800" height="480" fill="#fff"/>`;

  s += txt(20, 36, 22, 'Warlock', { weight: 500 });
  s += txt(132, 36, 15, `Power ${light}`, { fill: '#444' });
  s += txt(780, 32, 13, `Updated ${now}`, { anchor: 'end', fill: '#444' });
  s += `<line x1="20" y1="50" x2="780" y2="50" stroke="#000" stroke-width="1"/>`;

  s += txt(20, 80, 18, 'Orders', { weight: 500 });
  let y = 108;
  if (!ordersTop.length) s += txt(20, y, 15, 'No active orders', { fill: '#888' });
  for (const o of ordersTop) {
    s += txt(20, y, 15, trunc((o.tracked ? '\u2605 ' : '') + o.name, 36));
    s += txt(505, y, 14, `${o.p.prog} / ${o.p.total}`, { anchor: 'end', fill: '#555' });
    s += bar(20, y + 6, 485, o.p.frac);
    y += 44;
  }

  let qy = Math.max(y + 6, 356);
  s += txt(20, qy, 18, 'Quests', { weight: 500 });
  qy += 26;
  if (!questsTop.length) s += txt(20, qy, 15, 'No tracked quests', { fill: '#888' });
  for (const q of questsTop) {
    s += txt(20, qy, 15, trunc(q.name, 36));
    if (q.p) s += txt(505, qy, 14, `${q.p.prog} / ${q.p.total}`, { anchor: 'end', fill: '#555' });
    qy += 28;
  }

  s += `<line x1="520" y1="62" x2="520" y2="446" stroke="#000" stroke-width="1"/>`;
  const RX = 536;
  s += txt(RX, 80, 18, 'Conquests', { weight: 500 });
  if (conqueror) {
    s += txt(RX, 106, 15, 'Conqueror seal');
    s += txt(780, 106, 14, `${Math.round(conqueror.frac * 100)}%`, { anchor: 'end', fill: '#555' });
    s += bar(RX, 112, 244, conqueror.frac, 10);
  } else {
    s += txt(RX, 106, 15, 'Conqueror seal not started', { fill: '#888' });
  }
  s += `<line x1="${RX}" y1="136" x2="780" y2="136" stroke="#bbb" stroke-width="1"/>`;

  s += txt(RX, 162, 18, 'Seals & titles', { weight: 500 });
  let ry = 188;
  if (!otherSeals.length) s += txt(RX, ry, 15, 'No seals in progress', { fill: '#888' });
  for (const sl of otherSeals) {
    s += txt(RX, ry, 15, trunc(sl.name, 22));
    s += txt(780, ry, 14, `${Math.round(sl.frac * 100)}%`, { anchor: 'end', fill: '#555' });
    s += bar(RX, ry + 6, 244, sl.frac, 10);
    ry += 36;
  }

  let ty = Math.max(ry + 8, 300);
  s += `<line x1="${RX}" y1="${ty - 16}" x2="780" y2="${ty - 16}" stroke="#bbb" stroke-width="1"/>`;
  s += txt(RX, ty + 6, 18, 'Tracked triumph', { weight: 500 });
  if (triumph) {
    s += txt(RX, ty + 32, 15, trunc(triumph.name, 24));
    if (triumph.p) {
      s += txt(780, ty + 32, 14, `${triumph.p.prog} / ${triumph.p.total}`, { anchor: 'end', fill: '#555' });
      s += bar(RX, ty + 38, 244, triumph.p.frac, 10);
    }
  } else {
    s += txt(RX, ty + 32, 15, 'None tracked', { fill: '#888' });
    s += txt(RX, ty + 52, 12, 'Pin one in-game to show it here', { fill: '#999' });
  }

  s += `<line x1="20" y1="452" x2="780" y2="452" stroke="#000" stroke-width="1"/>`;
  s += txt(20, 472, 13, 'Sch\u014dla B\u0113llica', { fill: '#555' });
  s += txt(780, 472, 13, 'trmnl \u00b7 refreshes every 60s', { anchor: 'end', fill: '#555' });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">${s}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'original' }, background: '#ffffff' }).render().asPng();
  fs.writeFileSync('./screen.png', png);
  fs.writeFileSync('./screen.svg', svg);
  console.log('Wrote screen.png — open it to preview the layout.');
})();
