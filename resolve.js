// resolve.js — fast, targeted. Resolves your character progression NAMES (the
// likely home of Orders) plus the order-reward hashes. ~160 manifest lookups,
// small output. Reads snapshot.json, writes resolve.json.
//
// Run:  node resolve.js     then upload resolve.json to Claude.

import fs from 'node:fs';
const BASE = 'https://www.bungie.net/Platform';
const CACHE = './debug-cache.json';
const API_KEY = (() => { const o = {}; if (fs.existsSync('./.env')) for (const l of fs.readFileSync('./.env','utf8').split(/\r?\n/)) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if(m)o[m[1]]=m[2]; } return o.BUNGIE_API_KEY; })();
if (!API_KEY) { console.error('Missing BUNGIE_API_KEY in .env'); process.exit(1); }
const D = JSON.parse(fs.readFileSync('./snapshot.json','utf8'));
let cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE,'utf8')) : {};

async function def(type, hash) {
  const key=`${type}/${hash}`;
  if (cache[key]!==undefined) return cache[key];
  let out=null;
  try { const r=await fetch(`${BASE}/Destiny2/Manifest/${type}/${hash}/`,{headers:{'X-API-Key':API_KEY}}); const j=await r.json(); const d=j.ErrorCode===1?j.Response:null; if(d) out={name:d.displayProperties?.name||'',desc:d.displayProperties?.description||''}; } catch {}
  cache[key]=out; return out;
}

(async () => {
  const chars=D.characters.data;
  const wid=Object.keys(chars).filter(c=>chars[c].classType===2).sort((a,b)=>new Date(chars[b].dateLastPlayed)-new Date(chars[a].dateLastPlayed))[0];
  const progs=D.characterProgressions.data[wid].progressions;
  const out=[];
  for (const [h,p] of Object.entries(progs)) {
    const d=await def('DestinyProgressionDefinition',h);
    const cur=p.progressToNextLevel||0, nxt=p.nextLevelAt||0;
    out.push({ hash:h, name:d?.name||'', level:p.level, step:`${cur}/${nxt}`, pct: nxt?Math.round(100*cur/nxt):0 });
  }
  const orderRewards={};
  for (const h of Object.keys(D.characterProgressions.data[wid].unclaimedOrderRewards||{})) orderRewards[h]=(await def('DestinyInventoryItemDefinition',h))?.name||'';
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync('./resolve.json', JSON.stringify({ progressions: out.filter(p=>p.name), orderRewards }, null, 2));

  console.log('Named progressions (low-level / partial = likely Orders):');
  for (const p of out.filter(x=>x.name && x.level<=2 && x.pct>0 && x.pct<100).slice(0,30)) console.log(`  ${p.name}  L${p.level} ${p.step} (${p.pct}%)`);
  console.log('\nWrote resolve.json — upload it.');
})();
