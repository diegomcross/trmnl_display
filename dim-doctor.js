// dim-doctor.js — the DIM self-check, on the command line.
//
//   node dim-doctor.js
//
// You should not normally need this: since 2026-08-29 the SERVER runs exactly this check by
// itself (20s after it starts, then every 15 minutes, and immediately whenever a DIM call
// fails), fixes what it can without asking, and shows the result on the Settings page. This
// command is for when the server will not start, or when you want the answer right now.
//
// It shares its logic with the server through dim-diagnose.js, so the two can never disagree.
// READ-ONLY: it changes nothing and prints no secrets, so the output is safe to paste anywhere.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, fixText, FIX, DIM_API_DEFAULT } from './dim-diagnose.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
const env = (() => {
  const out = {};
  try {
    for (const l of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2];
    }
  } catch { return null; }
  return out.BUNGIE_API_KEY ? out : null;
})();

const v = await diagnose({
  env, tokens: rd('tokens.json'), app: rd('.dim-app.json'), token: rd('.dim-token.json'),
  mirrorCount: Object.keys(rd('weapon-tags.json') || {}).length,
  live: true, dimApi: process.env.DIM_API_BASE || DIM_API_DEFAULT,
});

const ICON = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[ .. ]' };
console.log();
console.log('=== DIM sync self-check ===');
for (const c of v.checks) console.log('  ' + (ICON[c.level] || '[ .. ]') + ' ' + c.msg);
console.log();
console.log('  VERDICT: ' + v.summary);
if (!v.ok) {
  console.log('  WHAT HAPPENS NEXT: ' + fixText(v.fix));
  if (v.fix === FIX.DROP_TOKEN || v.fix === FIX.REREGISTER_APP)
    console.log('  The running server repairs this by itself within 15 minutes. To hurry it up,');
  else if (v.fix === FIX.RELOGIN_BUNGIE || v.fix === FIX.SETUP_DIM)
    console.log('  This is the one kind the server cannot fix on its own — it needs you.');
  console.log('  double-click REBOOT.cmd and it re-checks 20 seconds after starting.');
}
console.log();
process.exitCode = v.ok ? 0 : 1;
