// render.js — builds the Destiny 2 e-ink screen from your local snapshot.json.
//
// CONTENT MODEL (see docs/HANDOFF.md):
//   Orders   = instanced bounty-type items in inventory bucket 635141261, objectives from component 301.
//   Quests   = incomplete pursuits in bucket 1345459588 (multi-step via setData; bounties = single step).
//   Seals    = title presentation nodes under recordSealsRootNodeHash, with their child records (triumphs).
//   Triumphs = the tracked record + the in-progress records pulled from every seal (a bounded, real pool).
//
// PAGES: the panel rotates through pages; each content type has its own layout.
//   renderPage(model, page, opts) dispatches to the right layout. renderSVG = the Orders page ("Sample 2").
//
// Rarity / markers are SVG shapes, NOT emoji (resvg has no emoji font).
//   Exotic = filled star, Legendary = filled diamond, Rare = open diamond, Common = open circle.
//
// Run:  node render.js   (writes screen.png from snapshot.json and prints a report)

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
// Bump CACHE_SCHEMA whenever the shape stored by getDef changes (now captures record
// children, objectiveHashes and questline setData for the quests/triumphs/seals pages).
const CACHE_SCHEMA = 3;
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
      type: d.itemTypeDisplayName || d.displayProperties?.subtitle || '',
      desc: d.progressDescription ?? d.displayProperties?.description ?? '',
      tier: d.inventory?.tierTypeName ?? '',
      tierType: d.inventory?.tierType,
      children: d.children ? (d.children.presentationNodes || []).map((c) => c.presentationNodeHash) : undefined,
      recordChildren: d.children ? (d.children.records || []).map((c) => c.recordHash) : undefined,
      objectiveHashes: d.objectives?.objectiveHashes,
      setList: d.setData?.itemList ? d.setData.itemList.map((x) => x.itemHash) : undefined,
    };
  } catch {}
  cache[key] = out; dirty = true;
  return out;
}

// ---------- small helpers ----------
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const clamp01 = (x) => Math.max(0, Math.min(1, x || 0));
const cleanLabel = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
const fmtNum = (n) => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'; if (n >= 1e4) return Math.round(n / 1e3) + 'k'; return String(Math.round(n)); };

function progressOf(objs) {
  objs = (objs || []).filter((o) => o && o.visible !== false);
  if (!objs.length) return null;
  const prog = objs.reduce((s, o) => s + Math.min(o.progress || 0, o.completionValue || 0), 0);
  const total = objs.reduce((s, o) => s + (o.completionValue || 0), 0);
  return { prog, total, frac: total ? prog / total : 0, complete: objs.every((o) => o.complete) };
}
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
  for (let i = 0; i < pts * 2; i++) { const r = i % 2 === 0 ? rOut : rIn; const a = -Math.PI / 2 + (i * Math.PI) / pts; d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1); }
  return d + 'Z';
}
function glyph(cx, cy, kind, color = '#000', sc = 1) {
  if (kind === 'exotic') return `<path d="${starPath(cx, cy, 8 * sc, 3.3 * sc)}" fill="${color}"/>`;
  if (kind === 'legendary') return `<path d="M${cx},${cy - 7 * sc} L${cx + 7 * sc},${cy} L${cx},${cy + 7 * sc} L${cx - 7 * sc},${cy} Z" fill="${color}"/>`;
  if (kind === 'rare') return `<path d="M${cx},${cy - 7 * sc} L${cx + 7 * sc},${cy} L${cx},${cy + 7 * sc} L${cx - 7 * sc},${cy} Z" fill="none" stroke="${color}" stroke-width="${1.8 * sc}"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="${4.5 * sc}" fill="none" stroke="${color}" stroke-width="${1.8 * sc}"/>`;
}
function questGlyph(cx, cy, sc = 1, color = '#000') { return `<path d="M${cx - 6 * sc},${cy - 7 * sc} L${cx + 6 * sc},${cy} L${cx - 6 * sc},${cy + 7 * sc} Z" fill="${color}"/>`; }

function wrapLines(s, fontSize, maxWidth, maxLines) {
  s = String(s || '').replace(/\s+/g, ' ').trim(); if (!s) return [];
  // Uppercase glyphs are wider, so widen the per-char estimate by the caps ratio
  // (prevents ALL-CAPS order text from overflowing the right edge).
  const letters = s.replace(/[^A-Za-z]/g, '').length;
  const capRatio = letters ? (s.match(/[A-Z]/g) || []).length / letters : 0;
  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * (0.52 + 0.16 * capRatio))));
  const words = s.split(' '); const lines = []; let cur = '';
  for (const w of words) { const tryl = cur ? cur + ' ' + w : w; if (tryl.length <= maxChars) { cur = tryl; } else { if (cur) lines.push(cur); cur = w; if (lines.length >= maxLines) break; } }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  const kept = lines.join(' ');
  if (kept.length < s.length && lines.length) { let last = lines[lines.length - 1].replace(/[\s.,;:]+$/, ''); if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1); lines[lines.length - 1] = last + '…'; }
  return lines;
}
const frame = (inner, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>${inner}</svg>`;

// Largest font (hi..lo) at which every text fits `boxH` at `maxWidth` without truncating.
function fitFont(texts, boxH, maxWidth, lo, hi) {
  for (let f = hi; f >= lo; f--) {
    const maxLines = Math.max(1, Math.floor(boxH / (f * 1.12)));
    if (texts.every((t) => !wrapLines(t, f, maxWidth, maxLines).join(' ').includes('…'))) return f;
  }
  return lo;
}

// ---------- Order description shortener (keyword CAPS, boilerplate stripped) ----------
// "Defeat combatants or Guardians with Auto Rifle final blows." -> "AUTO RIFLE kills".
// Grade/difficulty/modifier Orders collapse to a compact tag: "GRADE A · GM+ · HUNGER".
const ORDER_OVERRIDES = {
  "Praxic Professional": 'PRAXIC BLADE kills, no deaths · EXPERT+',
  "Banshee's Arsenal": 'any WEAPON kills',
  'Seasonal Arsenal': 'SEASONAL EXOTIC weapon kills',
};
const ORDER_KEYWORDS = [
  'Linear Fusion Rifles', 'Linear Fusion Rifle', 'Auto Rifles', 'Auto Rifle', 'Hand Cannons', 'Hand Cannon',
  'Pulse Rifles', 'Pulse Rifle', 'Scout Rifles', 'Scout Rifle', 'Sniper Rifles', 'Sniper Rifle',
  'Fusion Rifles', 'Fusion Rifle', 'Rocket Launchers', 'Rocket Launcher', 'Grenade Launchers', 'Grenade Launcher',
  'Machine Guns', 'Machine Gun', 'Trace Rifles', 'Trace Rifle', 'Submachine Guns', 'Submachine Gun',
  'Sidearms', 'Sidearm', 'Shotguns', 'Shotgun', 'Swords', 'Sword', 'Glaives', 'Glaive', 'Bows', 'Bow',
  'Heavy', 'Special', 'Primary', 'Kinetic', 'Energy', 'Power',
  'Arc', 'Solar', 'Void', 'Stasis', 'Strand', 'Darkness', 'Light', 'Prismatic',
  'abilities', 'ability', 'Super', 'grenades', 'grenade', 'melee', 'finisher', 'precision', 'Transcendence', 'Orbs of Power', 'Orbs',
  'Grandmaster', 'Master', 'Expert', 'Advanced', 'Normal', 'Legend',
  'Match Game', 'Trade-Off', 'Player Stake', 'Major Negative', 'No HUD', 'Buildcraft Stake', 'Equipment Locked',
  'Event Modifier', 'Hunger', 'Famine', 'Threat', 'Boon', 'Baned', 'Bane',
  'Champions', 'Champion', 'Hunters', 'Titans', 'Warlocks', 'miniboss', 'boss', 'powerful',
  'Crucible Ops', 'Gambit Ops', 'Fireteam Ops', 'Solo Ops', 'Pinnacle Ops', 'Arena Ops',
  'Crucible', 'Gambit', 'Guardian Games', 'zones', 'Bonus Focus', 'New Gear', 'Gameplay Stake', 'Free for All', 'Cutting Edge',
].sort((a, b) => b.length - a.length);
const ORDER_REDUX = [
  [/^Rapidly defeat combatants or Guardians with /i, 'rapid '],
  [/^Defeat multiple combatants or Guardians with /i, 'multi '],
  [/^Defeat combatants or Guardians without dying while using /i, 'no-death '],
  [/^Defeat combatants or Guardians without dying/i, 'kills, no deaths'],
  [/^Defeat combatants or Guardians while using /i, 'using '],
  [/^Defeat combatants or Guardians using /i, ''],
  [/^Defeat combatants or Guardians with /i, ''],
  [/^Defeat combatants or Guardians$/i, 'get kills'],
  [/^Defeat combatants or Guardians/i, ''],
  [/^Rapidly defeat combatants or Guardians$/i, 'rapid kills'],
  [/^Deal multiple final blows against combatants or Guardians/i, 'multi kills'],
  [/^Defeat opposing /i, 'defeat '],
  [/ precision final blows/i, ' precision kills'],
  [/ final blows/i, ' kills'], [/ final blow/i, ' kill'], [/ blows/i, ' kills'],
  // Drop the Light/Darkness wrapper, keep just the subclasses: "Light (Arc, Solar, or Void)" -> "Arc, Solar, or Void".
  [/\b(?:Light|Darkness)\s*\(([^)]*)\)/gi, '$1'],
  [/^Complete any activity/i, 'any activity'], [/^Complete an activity/i, 'activity'],
  [/^Achieve performance grade /i, 'achieve grade '], [/^Achieve grade /i, 'achieve grade '],
  [/ or better/i, ''],
  [/ difficulty or higher activities?/i, ' DIFF+'], [/ difficulty or higher/i, ' DIFF+'],
  [/ difficulty activities?/i, ' DIFF'], [/ difficulty/i, ' DIFF'], [/ activities/i, ''],
  [/ modifier active/i, ' modifier'], [/ active$/i, ''],
  [/\bwith a /i, 'with '], [/\bwith the /i, 'with '], [/\bwith an /i, 'with '],
];
function orderTag(d) {
  const parts = [], DIFF = { grandmaster: 'GM', master: 'M', expert: 'E', advanced: 'ADV', normal: 'N', legend: 'LEG' };
  let m = d.match(/grade (A\+|A|S|B|C|D)/i); if (m) parts.push('GRADE ' + m[1].toUpperCase());
  m = d.match(/(grandmaster|master|expert|advanced|normal|legend) difficulty( or higher)?/i);
  if (m) parts.push(DIFF[m[1].toLowerCase()] + (m[2] ? '+' : ''));
  m = d.match(/(\d+)\s+(Solo|Fireteam|Pinnacle|Crucible|Gambit|Arena) Ops/i);
  if (m) parts.push(m[1] + ' ' + m[2].toUpperCase() + ' OPS');
  else { const o = d.match(/\b(Solo|Fireteam|Pinnacle|Crucible|Gambit|Arena) Ops\b/i); if (o) parts.push(o[1].toUpperCase() + ' OPS'); }
  const seen = new Set(); let mm; const modRe = /with (?:a |an |the )?([A-Za-z][A-Za-z \-]*?) modifier/gi;
  while ((mm = modRe.exec(d))) { const v = mm[1].trim().toUpperCase(); if (!seen.has(v)) { seen.add(v); parts.push(v); } }
  const cnt = d.match(/with (\d+|two|three) modifiers/i); if (cnt) parts.push(cnt[1].toUpperCase() + ' MODS');
  if (/Player Stake/i.test(d) && !seen.has('PLAYER STAKE')) parts.push('PLAYER STAKE');
  if (/No HUD/i.test(d)) parts.push('NO HUD');
  if (/Equipment Locked|Buildcraft Stake/i.test(d)) parts.push('EQUIP LOCKED');
  if (/\bBane\b/i.test(d) && !seen.has('BANE')) parts.push('BANE');
  if (/\bBoon\b/i.test(d) && !seen.has('BOON')) parts.push('BOON');
  return parts;
}
export function shortenOrder(name, desc) {
  if (name && ORDER_OVERRIDES[name]) return ORDER_OVERRIDES[name];
  let t = cleanLabel(desc || '').split('. ')[0].replace(/\.$/, '');
  if (!t) return '';
  if (/^(Achieve|Complete)\b/i.test(t)) { const p = orderTag(t); if (p.length >= 2) return p.join(' · '); }
  for (const [re, rep] of ORDER_REDUX) t = t.replace(re, rep);
  t = t.replace(/\s+/g, ' ').trim();
  for (const kw of ORDER_KEYWORDS) t = t.replace(new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), (x) => x.toUpperCase());
  t = t.replace(/\bgrade (a\+|a|s|b|c|d)\b/gi, (x, g) => 'GRADE ' + g.toUpperCase());
  t = t.replace(/^(Complete|Achieve|Defeat|Deal|Gather|Generate|Capture|Earn|Stun|Acquire|Create|Rapidly)\b/, (x) => x.toLowerCase());
  return t || cleanLabel(desc || '');
}
const emptyPage = (msg) => frame(txt(16, 60, 24, msg, { weight: 600 }));

// =====================================================================
// buildModel: reads snapshot + manifest, returns a plain data model with
//   orders[], quests[], seals[], triumphs[], summary. Defensive throughout:
//   a missing field skips one item rather than throwing.
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
    try {
      const idef = await getDef('DestinyInventoryItemDefinition', it.itemHash);
      const objs = objectivesFor(it);
      const p = progressOf(objs);
      let label = '';
      if (objs[0]) label = cleanLabel((await getDef('DestinyObjectiveDefinition', objs[0].objectiveHash))?.desc);
      orders.push({ name: idef?.name || `Order ${it.itemHash}`, type: idef?.type || '', desc: idef?.desc || '', short: shortenOrder(idef?.name, idef?.desc), label, tier: tierInfo(idef?.tierType, idef?.tier), p, tracked: !!((it.state || 0) & 2) });
    } catch {}
  }
  // Sort: tracked first, then by rarity (exotic > legendary > rare > common), then by % complete.
  const RARITY_RANK = { exotic: 3, legendary: 2, rare: 1, common: 0 };
  orders.sort((a, b) => (b.tracked - a.tracked) || ((RARITY_RANK[b.tier.kind] || 0) - (RARITY_RANK[a.tier.kind] || 0)) || ((b.p?.frac || 0) - (a.p?.frac || 0)));

  // ---- QUESTS & BOUNTIES (bucket 1345459588) ----
  const quests = [];
  for (const it of inv.filter((i) => i.bucketHash === PURSUITS_BUCKET)) {
    try {
      const idef = await getDef('DestinyInventoryItemDefinition', it.itemHash);
      const objs = objectivesFor(it);
      const p = progressOf(objs);
      if (p && p.complete) continue; // hide finished pursuits
      let steps = 0, step = 0;
      if (idef?.setList?.length) { steps = idef.setList.length; const ix = idef.setList.indexOf(it.itemHash); step = ix >= 0 ? ix + 1 : 0; }
      let label = '';
      if (objs[0]) label = cleanLabel((await getDef('DestinyObjectiveDefinition', objs[0].objectiveHash))?.desc);
      const objective = steps > 1 ? (idef?.desc || label) : (label || idef?.desc);
      quests.push({ name: idef?.name || `Pursuit ${it.itemHash}`, objective, label, p, step, steps, tracked: !!((it.state || 0) & 2) });
    } catch {}
  }
  quests.sort((a, b) => (b.tracked - a.tracked) || ((b.p?.frac || 0) - (a.p?.frac || 0)));

  // ---- SEALS (titles) + the triumph pool drawn from their records ----
  const pnodes = D.profilePresentationNodes?.data?.nodes || {};
  const profRec = D.profileRecords?.data?.records || {};
  const charRec = D.characterRecords?.data?.[wid]?.records || {};
  const recState = (h) => profRec[h] || charRec[h];
  const sealsRoot = D.profileRecords?.data?.recordSealsRootNodeHash;
  const seals = [], triumphPool = [];
  if (sealsRoot) {
    const rootDef = await getDef('DestinyPresentationNodeDefinition', sealsRoot);
    for (const sealNodeHash of rootDef?.children || []) {
      try {
        const sdef = await getDef('DestinyPresentationNodeDefinition', sealNodeHash);
        if (!sdef) continue;
        const nd = pnodes[sealNodeHash];
        const completion = nd && nd.completionValue ? clamp01((nd.progressValue || 0) / nd.completionValue) : null;
        const recHashes = sdef.recordChildren || [];
        let done = 0; const remaining = [];
        for (const rh of recHashes) {
          const rdef = await getDef('DestinyRecordDefinition', rh);
          const st = recState(rh);
          const complete = st ? ((st.state || 0) & 4) === 0 : false;
          if (complete) { done++; continue; }
          const rp = progressOf(st?.objectives || st?.intervalObjectives || []);
          const item = { name: rdef?.name || 'Triumph', desc: rdef?.desc || '', frac: rp ? rp.frac : 0, p: rp, seal: sdef.name };
          remaining.push(item); triumphPool.push(item);
        }
        const totalReq = recHashes.length;
        const frac = completion != null ? completion : (totalReq ? done / totalReq : 0);
        remaining.sort((a, b) => (b.frac || 0) - (a.frac || 0));
        seals.push({ hash: String(sealNodeHash), title: sdef.name || 'Seal', subtitle: sdef.type || '', frac, done, totalReq, gilded: 0, remaining });
      } catch {}
    }
  }
  seals.sort((a, b) => (b.frac || 0) - (a.frac || 0));

  // ---- TRIUMPHS page pool: tracked record first, then in-progress seal records by frac ----
  const triumphs = [];
  const trk = D.profileRecords?.data?.trackedRecordHash;
  if (trk) {
    try { const def = await getDef('DestinyRecordDefinition', trk); const st = recState(trk); const rp = progressOf(st?.objectives || []); triumphs.push({ name: def?.name || 'Tracked', desc: def?.desc || '', frac: rp ? rp.frac : 0, p: rp, tracked: true }); } catch {}
  }
  for (const t of triumphPool.sort((a, b) => (b.frac || 0) - (a.frac || 0))) { if (triumphs.length >= 24) break; triumphs.push(t); }

  if (dirty) { fs.writeFileSync(CACHE, JSON.stringify(cache)); dirty = false; }

  const conq = seals.find((s) => /conqueror/i.test(s.title));
  return {
    character: { name: 'Warlock', light },
    orders, quests, seals, triumphs,
    summary: { questCount: quests.length, conqFrac: conq ? conq.frac : null, sealsInProgress: seals.filter((s) => s.frac < 1).length, triumph: triumphs[0]?.name || null },
    now: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

// =====================================================================
// PAGE LAYOUTS
// =====================================================================

// Orders page. opts: { count, offset, descSize, showNumbers, rarities[] }.
// offset lets a second page start where the first left off (split orders across 2 rotation slots).
// nameSize and glyph scale up automatically when fewer items are shown, using the extra room.
export function renderSVG(model, opts = {}) {
  const count    = Math.max(1, Math.min(5, opts.count  || 5));
  const offset   = Math.max(0, opts.offset || 0);
  const showNumbers = opts.showNumbers !== false;
  let list = model.orders || [];
  if (opts.rarities && opts.rarities.length) { const set = new Set(opts.rarities); list = list.filter((o) => set.has(o.tier.kind)); }
  const orders = list.slice(offset, offset + count);
  if (!orders.length) return emptyPage(offset > 0 ? 'No more orders to show.' : 'No active orders right now.');
  // Scale name/glyph with how many items fit so fewer items use the extra vertical space.
  const nameSize = count <= 2 ? 18 : count <= 3 ? 15 : 13;
  const glyphSc  = count <= 2 ? 0.90 : count <= 3 ? 0.75 : 0.60;
  const X = 12, BW = 776, STEP = Math.floor(H / orders.length);
  const capH = Math.round(nameSize * 1.7), dH = STEP - capH - 8;
  // Shortened, keyword-CAPS descriptions, sized as BIG as fits the row (bigger wins).
  const texts = orders.map((o) => o.short || o.desc || o.label || '');
  const descSize = fitFont(texts, dH, BW - 12, 16, 46);
  const lineH = Math.round(descSize * 1.12);
  const pctOf = (p) => (p ? Math.round(p.frac * 100) + '%' : '—');
  let defs = '', s = '', y = 4;
  orders.forEach((o, i) => {
    const y0 = y + 2, frac = clamp01(o.p?.frac || 0), fillW = Math.round(BW * frac);
    s += glyph(X + Math.round(nameSize * 0.7), y0 + Math.round(nameSize * 0.85), o.tier.kind, '#000', glyphSc);
    s += txt(X + Math.round(nameSize * 1.5), y0 + nameSize + 2, nameSize, trunc(o.name, 48), { weight: 700 });
    const capR = o.p ? (showNumbers ? `${fmtNum(o.p.prog)}/${fmtNum(o.p.total)} · ${pctOf(o.p)}` : pctOf(o.p)) : '—';
    s += txt(X + BW - 4, y0 + nameSize + 2, nameSize, capR, { anchor: 'end', weight: 600 });
    const dTop = y0 + capH;
    const maxLines = Math.max(1, Math.floor(dH / lineH));
    defs += `<clipPath id="df${i}"><rect x="${X}" y="${dTop}" width="${fillW}" height="${dH}"/></clipPath>`;
    defs += `<clipPath id="de${i}"><rect x="${X + fillW}" y="${dTop}" width="${BW - fillW}" height="${dH}"/></clipPath>`;
    s += `<rect x="${X}" y="${dTop}" width="${fillW}" height="${dH}" fill="#000"/>`;
    const dl = wrapLines(texts[i], descSize, BW - 12, maxLines);
    const dtext = (fill) => dl.map((ln, k) => txt(X + 6, dTop + descSize + 2 + k * lineH, descSize, ln, { weight: 700, fill })).join('');
    s += `<g clip-path="url(#df${i})">${dtext('#fff')}</g><g clip-path="url(#de${i})">${dtext('#000')}</g>`;
    y += STEP;
  });
  return frame(s, defs);
}

// Quests page — sweep description + step pips (multi-step) or % (bounties).
export function renderQuestsSVG(model, page = {}, opts = {}) {
  const count = Math.max(3, Math.min(5, page.count || 4));
  const showNumbers = opts.showNumbers !== false;
  const quests = (model.quests || []).slice(0, count);
  if (!quests.length) return emptyPage('No active quests or bounties.');
  const X = 12, BW = 776, STEP = Math.floor(H / quests.length), capH = 24;
  const descSize = quests.length <= 4 ? 27 : 23, lineH = Math.round(descSize * 1.12);
  let defs = '', s = '', y = 4;
  quests.forEach((q, i) => {
    const y0 = y + 2, multi = q.steps > 1;
    const frac = clamp01(multi ? q.step / q.steps : (q.p?.frac || 0)), fillW = Math.round(BW * frac);
    s += questGlyph(X + 8, y0 + 11, 0.7);
    s += txt(X + 22, y0 + 15, 13, trunc(q.name, 46), { weight: 700 });
    if (multi) {
      const gap = 13, pr = 4, pipsW = q.steps * gap, px = X + BW - pipsW;
      for (let k = 0; k < q.steps; k++) { const cx = px + k * gap + pr, cy = y0 + 11; s += k < q.step ? `<circle cx="${cx}" cy="${cy}" r="${pr}" fill="#000"/>` : `<circle cx="${cx}" cy="${cy}" r="${pr}" fill="none" stroke="#000" stroke-width="1.4"/>`; }
      s += txt(px - 6, y0 + 15, 13, `Step ${q.step}/${q.steps}`, { anchor: 'end', weight: 600 });
    } else {
      const cap = q.p ? (showNumbers ? `${fmtNum(q.p.prog)}/${fmtNum(q.p.total)} · ${Math.round(frac * 100)}%` : Math.round(frac * 100) + '%') : '—';
      s += txt(X + BW - 4, y0 + 15, 13, cap, { anchor: 'end', weight: 600 });
    }
    const dTop = y0 + capH, dH = STEP - capH - 8, maxLines = dH >= lineH * 3 ? 3 : 2;
    defs += `<clipPath id="qf${i}"><rect x="${X}" y="${dTop}" width="${fillW}" height="${dH}"/></clipPath>`;
    defs += `<clipPath id="qe${i}"><rect x="${X + fillW}" y="${dTop}" width="${BW - fillW}" height="${dH}"/></clipPath>`;
    s += `<rect x="${X}" y="${dTop}" width="${fillW}" height="${dH}" fill="#000"/>`;
    const dl = wrapLines(q.objective || q.label || '', descSize, BW - 10, maxLines);
    const dtext = (fill) => dl.map((ln, k) => txt(X + 6, dTop + descSize + 2 + k * lineH, descSize, ln, { weight: 700, fill })).join('');
    s += `<g clip-path="url(#qf${i})">${dtext('#fff')}</g><g clip-path="url(#qe${i})">${dtext('#000')}</g>`;
    y += STEP;
  });
  return frame(s, defs);
}

// Triumphs page — compact list with bordered progress bars.
export function renderTriumphsSVG(model, page = {}, opts = {}) {
  const count = Math.max(3, Math.min(8, page.count || 6));
  const showNumbers = opts.showNumbers !== false;
  const tr = (model.triumphs || []).slice(0, count);
  if (!tr.length) return emptyPage('No tracked triumphs in progress.');
  const X = 12, BW = 776, STEP = Math.floor(H / tr.length);
  let s = '', y = 6;
  tr.forEach((t) => {
    const frac = clamp01(t.frac), midY = y + STEP / 2;
    s += `<rect x="${X}" y="${midY - 4}" width="9" height="9" fill="#000"/>`;
    s += txt(X + 18, y + Math.round(STEP * 0.42), 24, trunc(t.name, 40), { weight: 700 });
    if (t.desc) s += txt(X + 18, y + Math.round(STEP * 0.42) + 22, 15, trunc(t.desc, 70), { weight: 400 });
    const barW = 220, barX = X + BW - barW;
    s += bar(barX, midY - 6, barW, frac, 12);
    const cap = t.p && showNumbers ? `${fmtNum(t.p.prog)}/${fmtNum(t.p.total)} · ${Math.round(frac * 100)}%` : Math.round(frac * 100) + '%';
    s += txt(barX + barW, y + Math.round(STEP * 0.42), 15, cap, { anchor: 'end', weight: 600 });
    y += STEP;
  });
  return frame(s);
}

// Title / Seal page — single hero seal: big % sweep + remaining requirements.
export function renderTitleSVG(model, page = {}) {
  const seals = model.seals || [];
  let seal = page.sealHash ? seals.find((x) => x.hash === String(page.sealHash)) : null;
  if (!seal) seal = seals.find((x) => x.frac < 1) || seals[0];
  if (!seal) return emptyPage('No seals in progress.');
  const X = 16, BW = 768;
  let s = '', defs = '';
  s += glyph(X + 16, 46, 'exotic', '#000', 1.6);
  s += txt(X + 40, 60, 52, trunc(seal.title, 22), { weight: 800 });
  if (seal.gilded) s += txt(X + BW, 56, 22, `Gilded ×${seal.gilded}`, { anchor: 'end', weight: 700 });
  if (seal.subtitle) s += txt(X + BW, 88, 18, trunc(seal.subtitle, 48), { anchor: 'end', weight: 400 });
  const oy = 96, oh = 56, frac = clamp01(seal.frac), fillW = Math.round(BW * frac);
  s += `<rect x="${X}" y="${oy}" width="${BW}" height="${oh}" fill="none" stroke="#000" stroke-width="2"/>`;
  s += `<rect x="${X}" y="${oy}" width="${fillW}" height="${oh}" fill="#000"/>`;
  const pctStr = `${Math.round(frac * 100)}%`;
  defs += `<clipPath id="ovf"><rect x="${X}" y="${oy}" width="${fillW}" height="${oh}"/></clipPath>`;
  defs += `<clipPath id="ove"><rect x="${X + fillW}" y="${oy}" width="${BW - fillW}" height="${oh}"/></clipPath>`;
  s += `<g clip-path="url(#ovf)">${txt(X + 14, oy + 42, 40, pctStr, { weight: 800, fill: '#fff' })}</g>`;
  s += `<g clip-path="url(#ove)">${txt(X + 14, oy + 42, 40, pctStr, { weight: 800, fill: '#000' })}</g>`;
  s += txt(X + BW - 8, oy + 40, 20, `${seal.done}/${seal.totalReq} triumphs`, { anchor: 'end', weight: 700, fill: frac > 0.97 ? '#fff' : '#000' });
  if (seal.remaining && seal.remaining.length) {
    s += txt(X, 192, 18, 'REMAINING', { weight: 700 });
    let ry = 206; const rowH = 46;
    seal.remaining.slice(0, 6).forEach((r) => {
      const rf = clamp01(r.frac);
      s += `<circle cx="${X + 6}" cy="${ry + 16}" r="4.5" fill="none" stroke="#000" stroke-width="1.8"/>`;
      s += txt(X + 20, ry + 22, 26, trunc(r.name, 44), { weight: 600 });
      const bw = 200, bx = X + BW - bw;
      s += bar(bx, ry + 10, bw, rf, 12);
      s += txt(bx + bw, ry + 8, 14, `${Math.round(rf * 100)}%`, { anchor: 'end', weight: 600 });
      ry += rowH;
    });
  } else {
    s += txt(X, 200, 22, 'Seal complete — nothing remaining.', { weight: 600 });
  }
  return frame(s, defs);
}

// Dispatch a page config to its layout.
// Full-screen god-roll drop alert — takes over the panel for ~1 minute when a
// watched weapon drops matching the wishlist (see server.js interrupt + the
// vault-verdict poller that writes drop-alert.json).
export function renderDropAlert(a = {}) {
  const X = 16, BW = 768;
  let s = '';
  s += `<rect x="0" y="0" width="${W}" height="76" fill="#000"/>`;
  s += txt(X + 6, 52, 40, a.title || 'GOD ROLL DROP', { weight: 800, fill: '#fff' });   // Build Crafter passes 'ARMOR UPGRADE'
  if (a.pct != null && a.pct > 0) s += txt(X + BW, 50, 32, `${a.pct}%`, { anchor: 'end', weight: 800, fill: '#fff' });
  s += txt(X, 134, 46, trunc(a.weapon || 'Weapon', 26), { weight: 800 });
  s += txt(X, 166, 22, `${[a.ty, a.power && `${a.power} PWR`].filter(Boolean).join(' · ')}${a.locked ? ' · LOCKED ✓' : ''}`, { weight: 600 });
  let y = 216;
  if ((a.perks || []).length) {
    s += txt(X, y, 20, 'MATCHED PERKS', { weight: 700 }); y += 32;
    a.perks.slice(0, 6).forEach((p) => {
      s += `<circle cx="${X + 7}" cy="${y - 7}" r="5" fill="#000"/>`;
      s += txt(X + 22, y, 26, trunc(p, 40), { weight: 600 }); y += 34;
    });
  }
  if (a.mw) { s += txt(X, y, 24, `Masterwork: ${a.mw}`, { weight: 700 }); y += 36; }
  if ((a.stats || []).length) s += txt(X, y, 22, a.stats.map((st) => `${st.n} ${st.v}`).join('    '), { weight: 600 });
  return frame(s);
}

export function renderPage(model, page = {}, opts = {}) {
  switch (page.type) {
    case 'quests':   return renderQuestsSVG(model, page, opts);
    case 'triumphs': return renderTriumphsSVG(model, page, opts);
    case 'title':    return renderTitleSVG(model, page, opts);
    case 'orders':
    default: return renderSVG(model, { count: opts.count, offset: opts.offset, descSize: opts.descSize, showNumbers: opts.showNumbers, rarities: page.rarities });
  }
}

// ---------- CLI entry ----------
async function main() {
  if (!API_KEY) { console.error('Missing BUNGIE_API_KEY in .env'); process.exit(1); }
  if (!fs.existsSync('./snapshot.json')) { console.error('snapshot.json not found — run auth-and-snapshot.js first.'); process.exit(1); }
  const D = JSON.parse(fs.readFileSync('./snapshot.json', 'utf8'));
  const model = await buildModel(D);
  const pct = (p) => (p ? Math.round(p.frac * 100) + '%' : '—');
  const mark = { exotic: 'EXOTIC', legendary: 'LEGEND', rare: 'RARE', common: 'common' };
  console.log(`\nACTIVE ORDERS (${model.orders.length}):`);
  for (const o of model.orders) console.log(`   [${mark[o.tier.kind]}] ${o.name} — ${o.short || o.desc || o.label || '—'} (${pct(o.p)})`);
  console.log(`\nQUESTS/BOUNTIES (${model.quests.length}):`);
  for (const q of model.quests.slice(0, 8)) console.log(`   ${q.steps > 1 ? `[${q.step}/${q.steps}]` : '[' + pct(q.p) + ']'} ${q.name}`);
  console.log(`\nSEALS (${model.seals.length}):`);
  for (const sl of model.seals.slice(0, 8)) console.log(`   ${Math.round(sl.frac * 100)}% ${sl.title} (${sl.done}/${sl.totalReq})`);
  console.log(`\nTRIUMPH POOL (${model.triumphs.length}); tracked: ${model.summary.triumph || 'none'}`);
  const svg = renderSVG(model);
  fs.writeFileSync('./screen.png', new Resvg(svg, { fitTo: { mode: 'original' }, background: '#ffffff' }).render().asPng());
  console.log('\nWrote screen.png — open it to see the Orders page.');
}
if (process.argv[1] && /render\.js$/.test(process.argv[1].replace(/\\/g, '/'))) { main(); }
