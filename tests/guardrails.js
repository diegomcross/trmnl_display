// tests/guardrails.js — automatic regression checker for every locked Diego rule.
//
// WHY THIS EXISTS (Diego, 2026-07-19): "I see that sometimes you make/fix something and
// mess something else that we had discussed previously." Docs describe the rules; this
// file ENFORCES them. Every rule in docs/DIEGO_RULES.md that a machine can verify has a
// check here. Agents: run `node tests/guardrails.js` and get ALL GREEN before every push.
// When Diego states a new rule, add a check here IN THE SAME COMMIT as the doc line.
//
// Run:  node tests/guardrails.js          (or double-click CHECK.cmd)
//       node tests/guardrails.js --static (skip live-server checks)
//
// Static checks read the source files. Live checks hit the running servers (8787 vault,
// 3000 display) with GET-only requests — NEVER a write, NEVER a restart (hard rule).
// A server that is down marks its live checks SKIP, not FAIL. Exit code 1 on any FAIL.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_ONLY = process.argv.includes('--static');

let pass = 0, fail = 0, skip = 0;
const failures = [];
let section = '';

function sect(name) { section = name; console.log('\n== ' + name + ' =='); }
function ok(name)   { pass++; console.log('  [OK]   ' + name); }
function bad(name, detail) {
  fail++; failures.push(section + ': ' + name + (detail ? ' — ' + detail : ''));
  console.log('  [FAIL] ' + name + (detail ? ' — ' + detail : ''));
}
function skp(name)  { skip++; console.log('  [SKIP] ' + name); }
function info(name) { console.log('  [info] ' + name); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

const FILES = {};
function read(f) {
  if (!(f in FILES)) {
    try { FILES[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); }
    catch { FILES[f] = null; }
  }
  return FILES[f];
}
// has(file, needle[, rule]) — needle may be a string (indexOf) or RegExp.
function has(file, needle, rule) {
  const s = read(file);
  if (s === null) { bad((rule || needle) + '', file + ' MISSING'); return; }
  const found = needle instanceof RegExp ? needle.test(s) : s.includes(needle);
  check(rule || (file + ' contains ' + JSON.stringify(String(needle).slice(0, 60))), found,
    found ? '' : 'not found in ' + file);
}
function hasNot(file, needle, rule) {
  const s = read(file);
  if (s === null) { bad(rule, file + ' MISSING'); return; }
  const found = needle instanceof RegExp ? needle.test(s) : s.includes(needle);
  check(rule, !found, 'FORBIDDEN pattern present in ' + file);
}
function count(file, needle) {
  const s = read(file); if (s === null) return -1;
  return s.split(needle).length - 1;
}

async function fetchOk(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 10000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'manual' });
    return r;
  } finally { clearTimeout(t); }
}

(async function main() {
  console.log('Guardrails — Diego rule regression check  (' + new Date().toISOString() + ')');

  // ---------------------------------------------------------------- scoring (RULES sect 2)
  sect('Scoring — ONE SCORE, the actual roll');
  has('vault-verdict.js', /GOD_MIN_PCT *= *75/, 'god-roll bar: 75% (server)');
  has('vault-verdict.js', /GOD_MIN_MATCHES *= *3/, 'god-roll bar: >=3 matched (server)');
  has('vault-verdict.js', /GOD_MIN_SELECTED *= *4/, 'god-roll bar: >=4 selected (server)');
  has('weapon-watch.html', /GOD_MIN_PCT *= *75/, 'god-roll bar 75 mirrored in Weapon Watch');
  has('weapon-drops.html', /GOD_MIN_PCT *= *75/, 'god-roll bar 75 mirrored in New Drops');
  has('vault-verdict.js', /FAV_WEIGHT *= *\{ *1: *1, *2: *1\.5, *3: *2 *\}/, 'star weights 1/1.5/2 (server FAV_WEIGHT)');
  has('vault-verdict.js', /FAVW *= *\{ *1: *1, *2: *1\.5, *3: *2 *\}/, 'star weights 1/1.5/2 (server FAVW)');
  has('weapon-vault.html', /FAVW *= *\{ *1: *1, *2: *1\.5, *3: *2 *\}/, 'star weights 1/1.5/2 (Weapon Vault client)');
  has('vault-verdict.js', 'if (!(favEff[n] >= 2)) favEff[n] = 2;',
    'tracked-perk union: tracked perks count as >=2-star (capped at 2) for unwatched scoring');
  has('vault-verdict.js', 'w.rollScore = Math.max(wp, fp)', 'best-of-both for watched copies (2026-07-16)');
  has('vault-verdict.js', "w.rollVia = fp > wp ? 'stars' : 'perks'", 'rollVia records which side won');
  has('vault-verdict.js', /\(w\.watchScore \?\? score\) >= thr\.fav/, 'auto-favorite requires RAW tracked match >= fav bar (star-rescue guardrail)');
  has('vault-verdict.js', /AUTO_FAV_MIN_CRIT *= *3/, 'auto-favorite needs >=3 tracked criteria');
  has('vault-verdict.js', 'w.comboFloored', 'combo floor flag exists');
  // statFloor: 150 joined this object on 2026-08-15 (spec 2.2 / DIEGO_RULES 4b rule 1), so the
  // pattern no longer demands the closing brace. All five weapon thresholds stay pinned.
  has('vault-verdict.js', /thr: *\{ *unwatchedJunk: *60, *keep: *80, *fav: *90, *watchedJunk: *75, *comboFloor: *80\b/,
    'code-default thresholds 60/80/90/75/floor 80 (Diego\'s numbers)');
  has('vault-verdict.js', 'w.rollBasis', 'rollBasis (watched|favorites) computed server-side');
  has('vault-verdict.js', /autoDecide\(w, def, thr\)|const favEligible/, 'Auto-Manager consumes the same score (autoDecide)');

  // ------------------------------------------------------------ auto-manager (RULES sect 3)
  // ------------------------------------------------------------ armor declutter (RULES sect 4c)
  sect('Armor declutter — what may be called junk');
  has('vault-verdict.js', 'modernExotic',
    'a 2.0 exotic is junked only when a 3.0 copy of it is owned (Diego 2026-08-25)');
  has('vault-verdict.js', /if \(!it\.x\) \{ say\(it\.id, 'junk', 'Armor 2\.0 legacy/,
    "the 2026-07-12 'Armor 2.0 legacy - junk always' rule still fires on legendaries");
  has('vault-verdict.js', 'you have it equipped',
    'gear you are wearing is never presented as junk');
  has('vault-verdict.js', "if (it.loc === 'equipped') { run.counts.skip++",
    'Apply never touches an equipped piece');
  has('vault-verdict.js', "if (it.tag === 'favorite') { run.counts.skip++",
    'Apply never touches a piece you tagged favorite');
  has('vault-verdict.js', /const dryRun = opts\.dryRun !== false;/,
    'armor Apply is preview-by-default — live writes need an explicit dryRun:false');

  sect('Auto-Manager — tagging & staging rules');
  has('vault-verdict.js', /def\.tt !== 5\) return skip\('not a legendary'\)/, 'legendaries only — exotics/rares never touched');
  has('vault-verdict.js', "d.w.tag !== 'junk'", 'manual junk never re-tagged');
  has('vault-verdict.js', /hasKeep \? null/, 'never adds a keep when one exists (never replaces your keep)');
  has('vault-verdict.js', 'protectedLast', 'last-copy guarantee present');
  has('vault-verdict.js', "'best copy'", 'last-copy keep writes DIM note "best copy"');
  has('vault-verdict.js', /junkStage: *5/, 'junk staging default: 5 per slot (2026-07-12: 5, not 3)');
  has('vault-verdict.js', /maxJunkPerRun: *25/, 'safety cap: <=25 junk tags per run');
  has('vault-verdict.js', /maxMovesPerRun: *20/, 'safety cap: <=20 moves per run');
  has('vault-verdict.js', /orbitSeconds: *60/, 'cadence: 60s safe/orbit');
  has('vault-verdict.js', /activitySeconds: *15/, 'cadence: 15s in-activity');
  has('vault-verdict.js', /idleSeconds: *120/, 'cadence: 120s game closed');
  has('vault-verdict.js', /ORBIT_ACTIVITY_HASH *= *82913930/, 'orbit is activity hash 82913930, not 0 (hard-won fact)');
  has('vault-verdict.js', '/api/tag-history', 'tag-history endpoint (every change, by source)');
  has('vault-verdict.js', '/api/auto/revert', 'one-click revert endpoint');
  has('vault-verdict.js', 'AUTO_DRYRUN', 'AUTO_DRYRUN env guard for agent testing');
  has('vault-verdict.js', 'w.autoFav', 'app favorites (green) tracked separately from Diego\'s manual (pink)');

  // ------------------------------------------------------------------- armor (RULES sect 4)
  sect('Armor');
  has('vault-verdict.js', /staging only, NEVER tag armor|NEVER auto-tagged/, 'armor is staged but NEVER auto-tagged');
  has('vault-verdict.html', 'exofavs', 'exotic favorite-stat tuning persists (vv-exofavs)');
  has('vault-verdict.js', 'CURATED_SRC', 'set drop-location curated map still present (do not remove)');

  // -------------------------------------------------------------- perk lists (RULES sect 5)
  sect('Perk lists & Perk Finder');
  has('vault-verdict.js', /tt === 6\) continue; \/\/ skip exotics/, 'perk library skips exotic weapons');
  check('perk library keeps only pc===\'frames\' trait plugs (>=2 uses)', count('vault-verdict.js', "pc === 'frames'") + count('vault-verdict.js', "pc==='frames'") >= 2);
  check('foldPerkName used across the pipeline (>=4 uses)', count('vault-verdict.js', 'foldPerkName') >= 4);
  has('vault-verdict.js', 'Golden Tricorn', 'Golden Tricorn Enhanced manifest quirk handled');
  has('perk-finder.html', 'const lib=new Set(LIB.map(p=>p.n));', 'Rate-ungraded restricted to curated trait library (2026-07-17 fix)');
  has('perk-finder.html', 'if(def.tt!==5) continue;', 'Rate-ungraded restricted to LEGENDARY weapons (2026-07-17 fix)');
  has('vault-verdict.js', 'wilsonLB', 'popularity = Wilson score (old-perk inflation fix)');
  has('perk-finder.html', 'perkGaps', 'Rate-ungraded review feature present');

  // --------------------------------------------------------------------- UI (RULES sect 6)
  sect('UI — BrayTech look & locked behaviors');
  const ALL_PAGES = ['vault-verdict.html', 'weapon-watch.html', 'weapon-vault.html', 'weapon-drops.html',
    'perk-finder.html', 'fashion.html', 'auto-manager.html', 'settings.html', 'artifacts.html', 'builds.html'];
  for (const f of ALL_PAGES) {
    check(f + ' has shared banner + theme', count(f, 'banner.js') >= 1 && count(f, 'theme.css') >= 1);
  }
  for (const f of ['weapon-watch.html', 'weapon-vault.html', 'weapon-drops.html', 'perk-finder.html', 'builds.html']) {
    check(f + ' has perk hover popup (perktip.js)', count(f, 'perktip.js') >= 1);
  }
  for (const f of ['vault-verdict.html', 'weapon-watch.html', 'weapon-vault.html', 'weapon-drops.html', 'perk-finder.html', 'fashion.html']) {
    check(f + ' has gentle auto-reload hook (GRELOAD)', count(f, 'GRELOAD') >= 1);
  }
  has('perktip.js', /HOVER_DELAY *= *400/, 'perk popup waits 400ms (cards must not move mid-tap)');
  has('theme.css', '--fav-auto', 'app-favorite green token');
  has('theme.css', '--fav-man', 'manual-favorite pink token (Diego\'s favorites are sacred)');
  has('theme.css', 'Arimo', 'self-hosted Arimo type');
  has('weapon-vault.html', 'eqbig', 'equipped tile 1.7x (Diego-confirmed proportion)');
  has('weapon-vault.html', 'invcap', 'character inventory capped to 3x3');
  for (const f of ['weapon-watch.html', 'weapon-vault.html', 'vault-verdict.html']) {
    check(f + ' search is punctuation-insensitive (normQ)', count(f, 'normQ') >= 1);
  }
  has('weapon-watch.html', "reload:'Reload Speed'", 'MW stat map: reload -> Reload Speed (manifest-checked, do not guess)');
  has('weapon-watch.html', 'renderKeepingAnchor', 'scroll anchoring — page never jumps mid-tap');
  has('weapon-watch.html', 'MW_STAT_NAME', 'MW badge rides with its actual stat');
  has('banner.js', 'gb-upd', '"Updated Xs ago" freshness chip on every page');

  // ------------------------------------------------------------------ sharing (RULES sect 7)
  sect('Setup wizard & sharing');
  hasNot('setup.html', /type=["']password["']/, 'passwords are NEVER typed into the app (bungie.net OAuth only)');
  has('vault-verdict.js', "['/setup', '/api/setup', '/api/status', '/theme.css', '/banner.js', '/fonts/']",
    'setup-mode gate whitelist intact');
  check('INSTALL.cmd + FRIEND_SETUP.md exist', read('INSTALL.cmd') !== null && read('docs/FRIEND_SETUP.md') !== null);

  // ----------------------------------------------------------------- display server (TRMNL)
  sect('TRMNL display server');
  has('server.js', /serverStartedAt < 90000/, 'startup grace: 90s of fast polling (no reset-button needed)');
  has('server.js', 'activeAlert', 'god-roll drop alert interrupts the rotation');
  has('render.js', "a.title || 'GOD ROLL DROP'", 'drop-alert title override (Build Crafter armor upgrades)');
  has('render.js', 'renderDropAlert', 'renderDropAlert page exists');
  has('server.js', '/display', 'phone /display page served');

  // --------------------------------------------------------------------- data safety & git
  sect('Data safety & git hygiene');
  check('saveJsonSafe (.bak before overwrite) used widely', count('vault-verdict.js', 'saveJsonSafe') >= 10);
  let tracked = '';
  try { tracked = execSync('git ls-files', { cwd: ROOT }).toString(); } catch { }
  if (!tracked) skp('git ls-files unavailable');
  else {
    const secret = ['tokens.json', '.env\n', 'weapon-tags.json', 'weapon-watch.json', 'auto-manage.json',
      'config.json', 'builds.json', 'fashion.json', 'perk-combos.json', 'perk-favorites.json',
      'tag-history.json', 'auto-history.json', 'auto-applied.json', 'weapon-seen.json',
      '.dim-token.json', '.dim-app.json', 'snapshot.json'];
    const leaked = secret.filter((f) => tracked.split('\n').includes(f.replace('\n', '')));
    check('no personal/secret files tracked by git', leaked.length === 0, 'TRACKED: ' + leaked.join(', '));
  }

  // ------------------------------------------------------------------------- live servers
  if (STATIC_ONLY) {
    sect('Live checks'); skp('skipped (--static)');
  } else {
    sect('Live — Vault Verdict (8787), GET-only');
    let st = null;
    try { st = await (await fetchOk('http://127.0.0.1:8787/api/status', 6000)).json(); } catch { }
    if (!st) { skp('8787 not reachable — start it (REBOOT.cmd) for full coverage'); }
    else {
      ok('/api/status answers');
      info('game ' + (st.gameUp ? 'RUNNING' : 'closed') + ' · auto-manager ' + (st.auto && st.auto.enabled ? 'ENABLED' : 'off')
        + ' · activity: ' + ((st.activity && st.activity.name) || '?'));
      if (st.dim && st.dim.err) bad('DIM sync healthy', st.dim.err); else ok('DIM sync healthy (no last error)');
      try {
        const p = await (await fetchOk('http://127.0.0.1:8787/api/perks', 30000)).json();
        const perks = p.perks || [];
        check('perk library size sane (150-400, got ' + perks.length + ')', perks.length >= 150 && perks.length <= 400,
          'inflation/deflation — frames or exotic perks may have crept in, or the library broke');
        const frames = perks.filter((x) => / Frame$| Glaive$/.test(x.n || ''));
        check('no weapon frames in the perk library', frames.length === 0, frames.slice(0, 5).map((x) => x.n).join(', '));
        check('perks carry popularity + insight fields', perks.length > 0 && 'pop' in perks[0] && ('dsc' in perks[0] || 'insight' in perks[0]));
      } catch (e) { bad('/api/perks reachable', String(e).slice(0, 80)); }
      try {
        const w = await (await fetchOk('http://127.0.0.1:8787/api/weapons', 45000)).json();
        const ws = w.weapons || [];
        check('/api/weapons returns weapons (' + ws.length + ')', ws.length > 50);
        const noScore = ws.filter((x) => typeof x.rollScore !== 'number' || !x.rollBasis);
        check('every copy has rollScore + rollBasis (ONE SCORE rule)', noScore.length === 0, noScore.length + ' copies missing');
        const watched = ws.filter((x) => x.rollBasis === 'watched');
        check('watched copies carry watchScore + rollVia', watched.length === 0 || watched.every((x) => typeof x.watchScore === 'number' && x.rollVia));
        check('armor list present for junk staging', Array.isArray(w.armor) && w.armor.length > 0);
        check('perk icons + descriptions ride along', !!w.perkIcons && !!w.perkDescs);
        check('autoFav flag present (green vs pink favorites)', ws.some((x) => 'autoFav' in x));
      } catch (e) { bad('/api/weapons reachable', String(e).slice(0, 80)); }
      try {
        const a = await (await fetchOk('http://127.0.0.1:8787/api/auto', 10000)).json();
        const thr = (a.cfg && a.cfg.thr) || {};
        check('/api/auto config has all 5 thresholds', ['unwatchedJunk', 'watchedJunk', 'keep', 'fav', 'comboFloor'].every((k) => k in thr));
        info('live thresholds: junk<' + thr.unwatchedJunk + '/' + thr.watchedJunk + ' keep>=' + thr.keep + ' fav>=' + thr.fav + ' floor ' + thr.comboFloor
          + (a.cfg.enabled ? '  [auto-manager ENABLED — only Diego may switch this]' : '  [auto-manager off]'));
      } catch (e) { bad('/api/auto reachable', String(e).slice(0, 80)); }
      try {
        const acct = await (await fetchOk('http://127.0.0.1:8787/api/account', 15000)).json();
        check('/api/account has name + emblem chars', !!acct.name && Array.isArray(acct.chars) && acct.chars.length > 0 && !!acct.chars[0].emblemBg);
      } catch (e) { bad('/api/account reachable', String(e).slice(0, 80)); }
      for (const [route, marker] of [['/', 'banner.js'], ['/weapons', 'banner.js'], ['/vault', 'banner.js'],
      ['/drops', 'banner.js'], ['/perks', 'banner.js'], ['/fashion', 'banner.js'], ['/auto', 'banner.js'],
      ['/settings', 'banner.js'], ['/artifacts', 'banner.js'], ['/builds', 'banner.js']]) {
        try {
          const r = await fetchOk('http://127.0.0.1:8787' + route, 8000);
          const body = await r.text();
          check('page ' + route + ' serves with banner', r.status === 200 && body.includes(marker), 'status ' + r.status);
        } catch (e) { bad('page ' + route, String(e).slice(0, 60)); }
      }
    }

    sect('Live — TRMNL display (3000), GET-only');
    let up3000 = false;
    try { up3000 = (await fetchOk('http://127.0.0.1:3000/', 6000)).status === 200; } catch { }
    if (!up3000) { skp('3000 not reachable — start it (REBOOT.cmd) for full coverage'); }
    else {
      ok('status page answers');
      try {
        const r = await fetchOk('http://127.0.0.1:3000/screen.png', 15000);
        const buf = Buffer.from(await r.arrayBuffer());
        check('/screen.png is a real PNG', r.status === 200 && buf[0] === 0x89 && buf[1] === 0x50);
      } catch (e) { bad('/screen.png', String(e).slice(0, 60)); }
      try {
        const r = await fetchOk('http://127.0.0.1:3000/api/display', 10000);
        const t = await r.text();
        check('/api/display BYOS endpoint answers with refresh_rate', r.status === 200 && t.includes('refresh_rate'));
      } catch (e) { bad('/api/display', String(e).slice(0, 60)); }
      try {
        const r = await fetchOk('http://127.0.0.1:3000/display', 8000);
        check('phone /display page serves', r.status === 200);
      } catch (e) { bad('/display', String(e).slice(0, 60)); }
      try {
        const r = await fetchOk('http://127.0.0.1:3000/settings', 8000);
        check('/settings page serves', r.status === 200);
      } catch (e) { bad('/settings', String(e).slice(0, 60)); }
    }
  }

  // ---------------------------------------------------------------------------- summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
  if (fail) {
    console.log('\nFAILED RULES:');
    for (const f of failures) console.log('  - ' + f);
    console.log('\nA failed check means a Diego rule regressed (or this checker is stale');
    console.log('after an agreed change — update the check ONLY with the matching doc edit).');
    process.exitCode = 1;
  } else {
    console.log('All locked rules verified.');
  }
})();
