// render.js — builds the Destiny 2 e-ink screen from your local snapshot.json.
//
// Orders   = instanced items in inventory bucket 635141261, objectives from component 301 (ItemObjectives).
//            Each order shows: rarity glyph + name + "what to do" description + progress.
//
// Resolves names via the public manifest (API key only). Writes screen.png and
// prints a report so running it doubles as the test.
//
// Layout: the progress fill sweeps across the big description text; tiny caption
// (rarity glyph + name + progress) sits above it. 5 orders, no header/footer.
// Rarity is shown with SVG shapes, NOT emoji — resvg has no emoji font.
//   Exotic = filled star, Legendary = filled diamond, Rare = open diamond, Common = open circle.
//
// Run:  node render.js

import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const BASE = 'https://www.bungie.net/Platform';
const CACHE = './manifest-cache.json';
const ORDERS_BUCKET = 635141261;
const PURSUITS_BUCKET = 1345459588;
const FONT = 'Arial, Helvetica, sans-serif';
const W = 800, H = 480;

// ---------- env + snapshot ----------
const env = (() => { const o = {}; if (fs.existsSync('./.env')) for (const l of fs.readFileSync('./.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2]; } return o; })();
const API_KEY = env.BUNGIE_API_KEY;

// ---------- manifest cache ----------
// Bump CACHE_SCHEMA whenever the shape stored by getDef changes, so old caches
// (e.g. ones written before tierType was captured) are discarded and re-fetched.
const CACHE_SCHEMA = 2;
let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
if (cache.__schema !== CACHE_SCHEMA) cache = { __schema: CACHE_SCHEMA };
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
      tier: d.inventory?.tierTypeName ?? '',         // "Exotic" | "Legendary" | "Common" ...
      tierType: d.inventory?.tierType,               // 6 Exotic, 5 Legendary, 4 Rare, 3 Uncommon, 2 Common, 1 Basic
      children: d.children ? (d.children.presentationNodes || []).map((c) => c.presentationNodeHash) : undefined,
    };
  } catch {}
  cache[key] = out; dirty = true;
  return out;
}

// ---------- small helpers ----------
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };
const clamp01 = (x) => Math.max(0, Math.min(1, x || 0));
const cleanLabel = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

// 493000 -> "493k", 5000000 -> "5M", 2760000 -> "2.76M", small numbers stay exact
const fmtNum = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
};

function progressOf(objs) {
  objs = (objs || []).filter((o) => o && o.visible !== false);
  if (!objs.length) return null;
  const prog = objs.reduce((s, o) => s + Math.min(o.progress || 0, o.completionValue || 0), 0);
  const total = objs.reduce((s, o) => s + (o.completionValue || 0), 0);
  return { prog, total, frac: total ? prog / total : 0, complete: objs.every((o) => o.complete) };
}

// rarity -> {name, kind} where kind drives the glyph
function tierInfo(tierType, tierName) {
  const byNum = { 6: 'Exotic', 5: 'Legendary', 4: 'Rare', 3: 'Uncommon', 2: 'Common', 1: 'Basic' };
  const name = tierName || byNum[tierType] || '';
  let kind = 'common';
  if (tierType === 6 || /exotic/i.test(name)) kind = 'exotic';
  else if (tierType === 5 || /legendary/i.test(name)) kind = 'legendary';
  else if (tierType === 4 || /rare/i.test(name)) kind = 'rare';
  return { name, kind };
}

// ---------- SVG drawing primitives ----------
function txt(x, y, size, s, { anchor = 'start', fill = '#000', weight = 400 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}
function bar(x, y, w, frac, h = 8) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000"/><rect x="${x}" y="${y}" width="${Math.round(w * clamp01(frac))}" height="${h}" fill="#000"/>`;
}
function starPath(cx, cy, rOut, rIn, pts = 5) {
  let d = '';
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = -Math.PI / 2 + (i * Math.PI) / pts;
    d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
}
// rarity glyph centered at (cx, cy); color + scale let it sit on light or dark areas
function glyph(cx, cy, kind, color = '#000', sc = 1) {
  if (kind === 'exotic') return `<path d="${starPath(cx, cy, 8 * sc, 3.3 * sc)}" fill="${color}"/>`;
  if (kind === 'legendary') return `<path d="M${cx},${cy - 7 * sc} L${cx + 7 * sc},${cy} L${cx},${cy + 7 * sc} L${cx - 7 * sc},${cy} Z" fill="${color}"/>`;
  if (kind === 'rare') return `<path d="M${cx},${cy - 7 * sc} L${cx + 7 * sc},${cy} L${cx},${cy + 7 * sc} L${cx - 7 * sc},${cy} Z" fill="none" stroke="${color}" stroke-width="${1.8 * sc}"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="${4.5 * sc}" fill="none" stroke="${color}" stroke-width="${1.8 * sc}"/>`; // common = open circle
}

// greedy word-wrap with char-width estimate; caps lines + adds ellipsis if clipped
function wrapLines(s, fontSize, maxWidth, maxLines) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const maxChars = Math.max(8, Math.floor(maxWidth / (fontSize * 0.52)));
  const words = s.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const tryl = cur ? cur + ' ' + w : w;
    if (tryl.length <= maxChars) { cur = tryl; }
    else { if (cur) lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  const kept = lines.join(' ');
  if (kept.length < s.length && lines.length) {
    let last = lines[lines.length - 1].replace(/[\s.,;:]+$/, '');
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1);
    lines[lines.length - 1] = last + '\u2026';
  }
  return lines;
}

// =====================================================================
// buildModel: reads snapshot + manifest, returns a plain data model.
// renderSVG: turns that model into an 800x480 SVG string.
// Split so server.js can import + reuse both. (See docs/HANDOFF.md §7.)
// =====================================================================
export async function buildModel(D) {
  const chars = D.characters.data;
  const wid = Object.keys(chars).filter((c) => chars[c].classType === 2)
    .sort((a, b) => new Date(chars[b].dateLastPlayed) - new Date(chars[a].dateLastPlayed))[0] || Object.keys(chars)[0];
  const light = chars[wid].light;

  const inv = D.characterInventories?.data?.[wid]?.items || [];
  const uio = D.characterProgressions?.data?.[wid]?.uninstancedItemObjectives || {};
  const objInst = D.itemComponents?.objectives?.data || {}; // component 301
  const objectivesFor = (it) => (it.itemInstanceId && objInst[it.itemInstanceId]?.objectives) || uio[it.itemHash] || [];

  // ---- ORDERS (bucket 635141261) ----
  const orders = [];
  for (const it of inv.filter((i) => i.bucketHash === ORDERS_BUCKET)) {
    const idef = await getDef('DestinyInventoryItemDefinition', it.itemHash);
    const objs = objectivesFor(it);
    const p = progressOf(objs);
    let label = '';
    if (objs[0]) label = cleanLabel((await getDef('DestinyObjectiveDefinition', objs[0].objectiveHash))?.desc);
    orders.push({
      name: idef?.name || `Order ${it.itemHash}`,
      type: idef?.type || '',
      desc: idef?.desc || '',                       // "what to do" sentence
      label,                                         // short objective label e.g. "Precision"
      tier: tierInfo(idef?.tierType, idef?.tier),    // {name, kind}
      p,
      tracked: !!((it.state || 0) & 2),
    });
  }
  const sortRows = (a, b) => (b.tracked - a.tracked) || ((b.p?.frac || 0) - (a.p?.frac || 0));
  orders.sort(sortRows);

  // ---- QUESTS & BOUNTIES (count only, for the summary line) ----
  let questCount = 0;
  for (const it of inv.filter((i) => i.bucketHash === PURSUITS_BUCKET)) {
    const objs = objectivesFor(it);
    const p = progressOf(objs);
    if (p && p.complete) continue;
    questCount++;
  }

  // ---- Conqueror % + seals-in-progress count (kept for the future config UI) ----
  const pnodes = D.profilePresentationNodes?.data?.nodes || {};
  const sealsRoot = D.profileRecords?.data?.recordSealsRootNodeHash;
  let conqFrac = null, sealsInProgress = 0;
  if (sealsRoot) {
    const rootDef = await getDef('DestinyPresentationNodeDefinition', sealsRoot);
    for (const ch of rootDef?.children || []) {
      const nd = pnodes[ch];
      if (!nd || !nd.completionValue) continue;
      const frac = clamp01((nd.progressValue || 0) / nd.completionValue);
      if (frac < 1) sealsInProgress++;
      const def = await getDef('DestinyPresentationNodeDefinition', ch);
      if (/conqueror/i.test(def?.name || '')) conqFrac = frac;
    }
  }

  // ---- tracked triumph (usually none) ----
  const trk = D.profileRecords?.data?.trackedRecordHash;
  let triumph = null;
  if (trk) { const def = await getDef('DestinyRecordDefinition', trk); triumph = def?.name || 'Tracked'; }

  if (dirty) { fs.writeFileSync(CACHE, JSON.stringify(cache)); dirty = false; }

  return {
    character: { name: 'Warlock', light },
    orders,
    summary: { questCount, conqFrac, sealsInProgress, triumph },
    now: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

// Sample-2 layout: each order is a tiny caption (rarity + name + progress) over a
// big description, with the progress fill sweeping across the description text
// (text flips white over the filled part). 5 orders, no header/footer.
export function renderSVG(model) {
  const orders = (model.orders || []).slice(0, 5);
  const X = 12, BW = 776, STEP = 96;
  const pctOf = (p) => (p ? Math.round(p.frac * 100) + '%' : '\u2014');

  let defs = '';
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
  if (!orders.length) {
    s += txt(X + 4, 60, 24, 'No active orders right now.', { weight: 600 });
  }
  let y = 4;
  orders.forEach((o, i) => {
    const y0 = y + 2;
    const frac = clamp01(o.p?.frac || 0);
    const fillW = Math.round(BW * frac);
    // caption (above the fill, always black on white)
    s += glyph(X + 8, y0 + 11, o.tier.kind, '#000', 0.6);
    s += txt(X + 20, y0 + 15, 13, trunc(o.name, 48), { weight: 700 });
    const capR = o.p ? `${fmtNum(o.p.prog)}/${fmtNum(o.p.total)} \u00b7 ${pctOf(o.p)}` : '\u2014';
    s += txt(X + BW - 4, y0 + 15, 13, capR, { anchor: 'end', weight: 600 });
    // description block (the hero) with the progress fill behind it
    const dTop = y0 + 22, dH = 60;
    defs += `<clipPath id="df${i}"><rect x="${X}" y="${dTop}" width="${fillW}" height="${dH}"/></clipPath>`;
    defs += `<clipPath id="de${i}"><rect x="${X + fillW}" y="${dTop}" width="${BW - fillW}" height="${dH}"/></clipPath>`;
    s += `<rect x="${X}" y="${dTop}" width="${fillW}" height="${dH}" fill="#000"/>`;
    const dl = wrapLines(o.desc || o.label || '', 25, BW - 10, 2);
    const dtext = (fill) => txt(X + 6, dTop + 26, 25, dl[0] || '', { weight: 700, fill })
      + (dl[1] ? txt(X + 6, dTop + 52, 25, dl[1], { weight: 700, fill }) : '');
    s += `<g clip-path="url(#df${i})">${dtext('#fff')}</g><g clip-path="url(#de${i})">${dtext('#000')}</g>`;
    y += STEP;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${s}</svg>`;
}

// ---------- CLI entry ----------
async function main() {
  if (!API_KEY) { console.error('Missing BUNGIE_API_KEY in .env'); process.exit(1); }
  if (!fs.existsSync('./snapshot.json')) { console.error('snapshot.json not found — run auth-and-snapshot.js first.'); process.exit(1); }
  const D = JSON.parse(fs.readFileSync('./snapshot.json', 'utf8'));
  const model = await buildModel(D);

  // report = the test
  const pct = (p) => (p ? Math.round(p.frac * 100) + '%' : '\u2014');
  const mark = { exotic: 'EXOTIC', legendary: 'LEGEND', rare: 'RARE', common: 'common' };
  console.log(`\nACTIVE ORDERS (${model.orders.length}):`);
  for (const o of model.orders) {
    console.log(`   [${mark[o.tier.kind]}] ${o.name} (${o.type || o.tier.name})`);
    console.log(`        do: ${o.desc || o.label || '\u2014'}`);
    console.log(`        progress: ${o.p ? o.p.prog + '/' + o.p.total + ' (' + pct(o.p) + ')' : '\u2014'}`);
  }
  const sm = model.summary;
  console.log(`SUMMARY: ${sm.questCount} quests & bounties; Conqueror ${sm.conqFrac != null ? Math.round(sm.conqFrac * 100) + '%' : 'n/a'}; seals in progress ${sm.sealsInProgress}; tracked triumph: ${sm.triumph || 'none'}`);

  const svg = renderSVG(model);
  fs.writeFileSync('./screen.png', new Resvg(svg, { fitTo: { mode: 'original' }, background: '#ffffff' }).render().asPng());
  console.log('\nWrote screen.png — open it to see the display.');
}

// Run main() only when executed directly (so server.js can import buildModel/renderSVG safely).
if (process.argv[1] && /render\.js$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
