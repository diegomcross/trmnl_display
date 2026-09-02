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

// ---- WHERE AM I? (Diego 2026-08-29) -------------------------------------------------------
// "make it clear what can be done so you don't run cloud sessions moving forward. The local
// version should always be the one updated and then pushed to github as backup. The app runs
// locally not on the cloud."
// The app lives on his Windows PC; GitHub is a backup of it. A cloud session is a fresh Linux
// clone with none of his data and no route to his machine, and on 2026-08-29 an agent spent a
// whole session telling him to double-click files that only existed in the cloud. So every run
// of this checker says, in one line, which kind of session it is.
function whereAmI() {
  const win = process.platform === 'win32';
  const hasEnv = fs.existsSync(path.join(ROOT, '.env'));
  const hasTokens = fs.existsSync(path.join(ROOT, 'tokens.json'));
  const local = win && hasEnv;                       // his PC: Windows AND his real credentials
  return {
    local, platform: process.platform, root: ROOT, hasEnv, hasTokens,
    label: local ? 'LOCAL — this is Diego\'s PC, the machine that actually runs the app'
                 : 'CLOUD — a throwaway clone. It CANNOT reach his PC.',
  };
}
function printWhere() {
  const w = whereAmI();
  const bar = '='.repeat(78);
  console.log(bar);
  console.log('  ' + w.label);
  console.log(`  platform=${w.platform}  folder=${w.root}`);
  console.log(`  his .env ${w.hasEnv ? 'present' : 'NOT here'} · his tokens.json ${w.hasTokens ? 'present' : 'NOT here'}`);
  if (w.local) {
    console.log('  -> Edit these files directly, test, REBOOT.cmd yourself, THEN push to GitHub as backup.');
  } else {
    console.log('  -> You cannot reboot his servers, read his tokens, or see his logs. Nothing you');
    console.log('     change reaches him until it is merged AND his local copy is updated.');
    console.log('     Say this in your first reply. Never tell him to double-click a file he lacks.');
    console.log('     Best move: ask him to reopen the work in a session on his own PC.');
  }
  console.log(bar);
  return w;
}
if (process.argv.includes('--where')) { printWhere(); process.exit(0); }
printWhere();

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
  has('vault-verdict.js', 'statFloorUnstarred',
    'non-★ exotics have their own lower stat floor (Diego 2026-08-27: 100-120)');
  has('vault-verdict.js', 'function applyReuseBias',
    'reuse bias exists — later builds prefer pieces an earlier exotic already kept');
  has('vault-verdict.js', /minDeficit\(setTotals\(Object\.values\(trial\)\), build\) <= champ\.deficit/,
    'reuse never costs the build ground against its floor');
  has('vault-verdict.js', /const keptPool = pool\.filter\(\(p\) => p\.x \|\| keptIds\.has\(p\.id\)\)/,
    'a non-★ exotic is offered the already-kept pieces first');
  has('vault-verdict.js', /if \(wide\.deficit < champ\.deficit\)/,
    'a non-★ exotic claims a new piece only when widening closes the gap');
  has('vault-verdict.js', "if (it.tag === 'favorite') { run.counts.skip++",
    'Apply never touches a piece you tagged favorite');
  has('vault-verdict.js', /const dryRun = opts\.dryRun !== false;/,
    'armor Apply is preview-by-default — live writes need an explicit dryRun:false');
  has('vault-verdict.html', /id="dcApply" disabled/,
    'the Apply button is always VISIBLE (disabled until a preview exists), never hidden');
  has('vault-verdict.html', /<details class="panel" id="dcPanel" open>/,
    'the declutter panel is open by default so its buttons can be seen');
  // Diego 2026-08-29: "the banners are still all different sizes". A parallel session enforced
  // this with #gbanner{width:100vw} + .gb{max-width:1160px}; the page shell now solves it one
  // layer down (no page owns a width, so the banner inherits nothing inconsistent). Same rule,
  // different mechanism — so these two checks assert the RULE, not the old implementation.
  has('theme.css', /\.gb-in\{[^}]*max-width:var\(--page-max\)/,
    'the banner is centred at ONE fixed width on every page');
  has('REBOOT.cmd', 'Win32_Process',
    'REBOOT.cmd spawns launchers via WMI so they outlive the shell that started them');
  has('REBOOT.cmd', 'start-hidden.vbs',
    'REBOOT.cmd launches through the VBS host so no console window is ever created');
  has('REBOOT.cmd', 'ping -n 4 127.0.0.1',
    'REBOOT.cmd waits without `timeout`, which fails when run non-interactively');
  has('watchdog.ps1', 'Test-PortOpen',
    'the watchdog checks real ports, not just whether a node process exists');
  has('watchdog.ps1', 'has no launcher -- restarting it',
    'the watchdog restarts a server whose keep-alive launcher also died');
  has('theme.css', /#gbanner\{/,
    'the banner breaks out of each page column so it is one size everywhere');
  has('vault-verdict.js', /const tags = await dimTagsFresh\(e\);            \/\/ id -> tag string/,
    'armor reads LIVE DIM tags, not the dead dim-data.json export');
  has('vault-verdict.js', 'async function dimLoadoutCounts',
    'armor gets DIM loadout counts from the live API (the in-a-loadout rescue)');
  has('vault-verdict.js', 'last copy of this exotic you own',
    'no exotic can ever have ALL its copies junked');
  has('vault-verdict.js', 'but it is the only copy of this exotic you own',
    'a DIM junk tag drops to review rather than destroying a sole exotic');

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
  // ---- the handoff docs must stay a handoff, not a changelog ------------------------------
  // CLAUDE.md: "When a feature ships: move its content from NEXT_PHASE.md into HANDOFF.md's
  // 'What works now' and delete it from NEXT_PHASE.md." On 2026-08-29 NEXT_PHASE had drifted to
  // 1138 lines of shipped history, and one section still told the next agent that finished work
  // was sitting unmerged on a branch — which by then was false and actively misleading.
  has('docs/NEXT_PHASE.md', '## What is actually open',
    'NEXT_PHASE names what is OPEN, so it stays a pickup point and not a changelog');
  hasNot('docs/NEXT_PHASE.md', /BLOCKER FOR EVERYTHING ON THIS BRANCH/,
    'no stale "this is unmerged" claim left in the pickup point');
  for (const [what, needle] of [
    ['the live-DIM armor fix', 'Armor reads LIVE DIM tags'],
    ['the page shell', 'ONE page shell for every page'],
    ['the DIM self-repair', 'DIM troubleshooting is fully automatic'],
    ['junk staging batching', 'Junk staging pushes ONE batch'],
  ]) has('docs/HANDOFF.md', needle, `HANDOFF has a "what works now" entry for ${what}`);

  // ---- local is the source of truth; GitHub is the backup (Diego 2026-08-29) ---------------
  // "make it clear what can be done so you don't run cloud sessions moving forward. The local
  // version should always be the one updated and then pushed to github as backup. The app runs
  // locally not on the cloud."
  has('CLAUDE.md', 'READ THIS FIRST — where are you running?',
    'CLAUDE.md opens by telling the agent to work out local vs cloud');
  has('CLAUDE.md', 'GitHub is a backup of that copy, not the other way round',
    'local is the source of truth, GitHub is the backup');
  has('CLAUDE.md', 'guardrails.js --where', 'and points at the machine check');
  has('tests/guardrails.js', 'function whereAmI', 'the local/cloud check is machine-run, not a judgement call');
  has('tests/guardrails.js', "process.argv.includes('--where')", '--where answers it on its own');

  // ---- junk staging is a BATCH, not a trickle (Diego 2026-08-29) --------------------------
  // "Auto manager keeps pushing junk to my character every other minute - it should push junk
  // pieces once and wait until I deleted and then push new ones." Two faults: it topped up to
  // junkStage on EVERY pass (dismantle one, get one back 60s later), and junk that landed in the
  // POSTMASTER was not counted as staged, so passes piled more on top of it forever.
  has('vault-verdict.js', 'function planStaging', 'the staging decision is a pure, testable function');
  has('vault-verdict.js', /if \(held > 0\) \{ waiting\.push/,
    'a slot holding un-dismantled junk is left ALONE (batch, not top-up)');
  has('vault-verdict.js', /x\.loc === 'char' \|\| x\.loc === 'postmaster'/,
    'junk in the postmaster counts as already staged (no pile-on)');
  hasNot('vault-verdict.js', /need = cfg\.junkStage - \(junkStaged\[slot\] \|\| 0\)/,
    'the old top-up rule is gone');
  has('vault-verdict.js', '!spilled.has(y.id)', 'the same piece can never be spilled twice in one run');
  has('vault-verdict.js', "stage: 'wait'", 'the run log says WHY a slot got nothing');
  has('auto-manager.html', "'waiting on you'", 'and the Auto-Manager page shows it');

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

  // ---- one page shell for every page (RULES sect 6, Diego 2026-08-28) ----------------
  // "make them all consistent, banner size, positioning ... every page behaves like an
  // independent style". Page width + gutters live ONLY in theme.css; a page that sets its
  // own body max-width/padding again would drift the banner right back out of alignment.
  has('theme.css', '--page-max', 'one shared page width token');
  has('theme.css', '--page-pad', 'one shared page gutter token');
  has('theme.css', /\.page\{[^}]*max-width:var\(--page-max\)/, 'the .page column uses the shared width');
  has('banner.js', 'gb-in', 'banner centres on the same column as page content');
  has('banner.js', 'gb-nav', 'section tabs render as their own strip');
  for (const f of [...ALL_PAGES, 'setup.html']) {
    check(f + ' wraps content in <main class="page">', count(f, '<main class="page">') === 1);
    const src = read(f) || '';
    // (?<![\w.#-]) so `.wbody{padding}` / `.body{padding}` class rules don't false-positive
    check(f + ' sets no page width of its own', !/(?<![\w.#-])body\s*\{[^}]*max-width/.test(src),
      'a body{max-width} rule is back — width belongs in theme.css');
    check(f + ' sets no body padding of its own', !/(?<![\w.#-])body\s*\{[^}]*padding/.test(src),
      'a body{padding} rule is back — spacing belongs in theme.css');
  }

  // ---- design tokens live in ONE place (2026-08-28 cleanup) --------------------------------
  // Nine pages used to carry their own :root palette. theme.css loads last so its values always
  // won — the copies were dead, and editing one did nothing (which is how artifacts.html ended
  // up referencing an undefined --void). One :root, in theme.css.
  for (const f of [...ALL_PAGES, 'setup.html']) {
    hasNot(f, /:root\s*\{/, f + ' declares no :root palette of its own');
  }
  for (const t of ['--void', '--arc', '--kinetic', '--stasis', '--strand', '--exotic', '--fav',
                   '--und', '--el', '--pve', '--pvp', '--rail']) {
    has('theme.css', t + ':', 'theme.css defines ' + t);
  }
  // every var() a page uses must resolve — either from theme.css or an inline style="--x:..."
  {
    const themeVars = new Set((read('theme.css') || '').match(/--[\w-]+(?=\s*:)/g) || []);
    for (const f of [...ALL_PAGES, 'setup.html']) {
      const src = read(f) || '';
      const style = (src.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
      const inline = new Set(src.match(/--[\w-]+(?=\s*:)/g) || []);   // style="--elc:..." etc.
      const used = new Set(style.match(/var\(\s*(--[\w-]+)\s*\)/g) || []);
      const missing = [...used].map((u) => u.replace(/var\(\s*|\s*\)/g, ''))
        .filter((v) => !themeVars.has(v) && !inline.has(v));
      check(f + ' has no unresolved CSS variables', missing.length === 0, missing.join(', '));
    }
  }

  // ---- DIM sync must be able to recover, and must say so when it can't (2026-08-29) --------
  // Diego: "check the sync with DIM ... figure out why it's not working." Root cause was that
  // DIM answers 401 for five different reasons (OriginMismatch / ApiKeyMismatch /
  // UnknownProfileId / expired JWT / WebAuthRequired) and EVERY one of them leaves our cached
  // token looking valid — it has not hit its expiry — so the server re-sent the same dead token
  // every 30s forever and quietly served stale tags. Only a /setup re-login ever cleared it.
  has('vault-verdict.js', 'async function dimCall', 'every DIM call goes through the 401-recovering wrapper');
  has('vault-verdict.js', 'function dimForget', 'a rejected DIM token is thrown away, not reused');
  has('vault-verdict.js', 'DIM_RETRY_AFTER', 'a token DIM refuses twice backs off instead of hammering');
  has('vault-verdict.js', 'function dimJwt', 'the DIM token is decoded so we can agree with DIM about the profile');
  has('vault-verdict.js', /allowed\.includes\(String\(pid\)\)/,
    'platformMembershipId is reconciled against the token profileIds (no silent UnknownProfileId)');
  for (const call of ['\'read\'', '\'write\'', '\'bulk write\'', '\'loadouts\'']) {
    check('DIM ' + call.replace(/\\?'/g, '') + ' is routed through dimCall',
      (read('vault-verdict.js') || '').includes('], ' + call + ');'));
  }
  hasNot('vault-verdict.js', /const \{ key, token, pid \} = await dimAuth\(e\);\s*\n\s*const res = await fetch/,
    'no DIM call bypasses dimCall by calling dimAuth + fetch directly');
  check('dim-doctor.js ships (the error message points users at a file that exists)',
    read('dim-doctor.js') !== null && read('DIM-DOCTOR.cmd') !== null);
  has('banner.js', "'DIM sync error'", 'a DIM failure is named in the chip, not just a red dot');

  // ---- DIM troubleshooting is AUTOMATIC (Diego 2026-08-29) ---------------------------------
  // "I want you to fully automate this troubleshooting so you can do without my intervention."
  // The server must diagnose and repair itself; nothing may require Diego to run a command
  // except the one case no code can fix (his Bungie login lapsing).
  check('dim-diagnose.js is the single shared diagnosis', read('dim-diagnose.js') !== null);
  has('vault-verdict.js', "import { diagnose, fixText, FIX } from './dim-diagnose.js'",
    'the server uses the SAME diagnosis as the command line (they cannot drift)');
  has('dim-doctor.js', "from './dim-diagnose.js'", 'the command line is a thin shell over that module');
  has('vault-verdict.js', 'async function dimSelfHeal', 'the server repairs DIM by itself');
  has('vault-verdict.js', 'async function dimReregisterApp', 'it can re-register a dead DIM app unattended');
  has('vault-verdict.js', /dimSelfHeal\(e, 'startup'\)/, 'a self-check runs shortly after boot');
  has('vault-verdict.js', /dimSelfHeal\(e, 'periodic'\)/, 'and keeps running on a timer');
  has('vault-verdict.js', /setTimeout\(\(\) => \{ dimSelfHeal\(e, `401/,
    'a 401 that survives a re-auth triggers the self-check automatically');
  has('vault-verdict.js', "req.url.startsWith('/api/dim/health')", 'DIM health is readable without running anything');
  has('vault-verdict.js', 'DIM_APP_FILE + \'.bak\'', 're-registering keeps the old DIM app file as a .bak');
  has('settings.html', 'id="dimCard"', 'Settings shows DIM health so nothing has to be typed');
  has('settings.html', "fetch('/api/dim/health'", 'the card reads the live verdict');
  hasNot('vault-verdict.js', /run: node dim-doctor\.js/,
    'the server no longer tells Diego to run a command for something it fixes itself');

  // ---- static assets are cached, not re-read and re-sent on every hit ----------------------
  has('vault-verdict.js', 'const sendStatic', 'vault server caches static assets in memory');
  has('vault-verdict.js', "ETag: rec.tag", 'vault server sends an ETag so repeats get a 304');
  hasNot('vault-verdict.js', /return res\.end\(fs\.readFileSync\(path\.join\(__dirname, '[\w-]+\.html'\)\)\)/,
    'no page route re-reads its HTML off disk per request');
  has('server.js', 'function sendSkin', 'display server caches the shared skin too');

  // ---- the display server (3000) is on the same shell as the rest (Diego 2026-08-28) -------
  has('server.js', "path === '/theme.css'", 'display server serves the shared theme');
  has('server.js', 'function shell(', '/settings uses the shared page shell');
  has('server.js', 'class="gb-in"', '/settings renders the same banner strip');
  hasNot('server.js', /background:#f4f4f5/, 'the old light-grey settings page is gone');
  // Diego 2026-08-28, verbatim: "you can change the settings page, but not the terminal, it
  // works well and I didn't ask you to change that." ONLY /settings was restyled. The status
  // page at / keeps its original plain markup, and render.js (the e-ink pipeline) is untouched.
  has('server.js', 'Destiny 2 TRMNL dashboard</h2>', 'status page / keeps its original markup');
  has('server.js', "font-family:Arial,Helvetica,sans-serif;margin:24px", 'status page / is not on the shared theme');
  hasNot('server.js', /shell\('Destiny 2 TRMNL — Status'/, 'status page / was NOT moved onto the shell');

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
