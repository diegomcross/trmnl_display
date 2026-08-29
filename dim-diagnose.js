// dim-diagnose.js — the whole "why isn't DIM syncing?" check, as ONE pure function.
//
// Diego 2026-08-29: "I want you to fully automate this troubleshooting so you can do without
// my intervention." So this is not a script he runs — it is a module the SERVER runs by itself
// whenever DIM misbehaves, and which also backs the dim-doctor.js command line. One copy of the
// logic, so the thing that self-heals and the thing that explains can never disagree.
//
// diagnose() performs NO side effects: it reads state you hand it, optionally makes one live
// GET, and returns a verdict. Applying the verdict is the caller's job (see dimSelfHeal in
// vault-verdict.js), which keeps the risky part in one reviewable place.
//
// Verified against DIM's own server source (github.com/DestinyItemManager/dim-api @ 826bcc2):
//   api/routes/auth-token.ts  — /auth/token reads bungieAccessToken + membershipId, mints a
//                               30-day JWT whose `profileIds` claim lists the Destiny profiles
//                               the token may touch, sorted primary-first.
//   api/routes/profile.ts     — 401 UnknownProfileId when platformMembershipId is not in that list.
//   api/server.ts             — 401 OriginMismatch (Origin != the one registered to the API key),
//                               401 ApiKeyMismatch (token issued for a different app).
//   api/utils.ts              — checkPlatformMembershipId.

export const DIM_API_DEFAULT = 'https://api.destinyitemmanager.com';
export const DIM_ORIGIN = 'https://localhost';

// What the caller should DO about a verdict. Ordered least to most invasive.
export const FIX = {
  NONE: 'none',
  DROP_TOKEN: 'drop-token',        // delete .dim-token.json; the next call mints a fresh one
  REREGISTER_APP: 'reregister-app', // .dim-app.json is unusable; register a new DIM app
  RELOGIN_BUNGIE: 'relogin-bungie', // only Diego can do this one (/setup step 2)
  SETUP_DIM: 'setup-dim',          // DIM was never set up on this PC (/setup step 3)
  NETWORK: 'network',              // something between this PC and DIM is blocking it
  WAIT: 'wait',                    // transient; try again shortly
};

/** Decode a JWT payload. No secret needed and no verification implied — we only read claims. */
export function jwtPayload(token) {
  try {
    const seg = String(token).split('.')[1];
    return JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
}

const chk = (id, level, msg, fix = FIX.NONE) => ({ id, level, msg, fix });

/**
 * @param {object} s state to judge, all optional:
 *   env      parsed .env            ({BUNGIE_API_KEY} or null)
 *   tokens   tokens.json            ({expires_at, refresh_expires_at, membership_id} or null)
 *   app      .dim-app.json          ({appId, dimApiKey} or null)
 *   token    .dim-token.json        ({token, exp, pid} or null)
 *   mirrorCount  how many tags weapon-tags.json holds (number)
 *   live     true to make one live GET /profile
 *   fetchImpl / dimApi   injectable for tests
 * @returns {Promise<{ok, fix, summary, checks}>}
 */
export async function diagnose(s = {}) {
  const checks = [];
  const now = s.now || Date.now();
  const F = s.fetchImpl || fetch;
  const API = s.dimApi || DIM_API_DEFAULT;

  // ---- 1. the files that must exist -------------------------------------------------
  if (!s.env || !s.env.BUNGIE_API_KEY)
    checks.push(chk('env', 'fail', 'No Bungie API key in .env.', FIX.SETUP_DIM));
  else checks.push(chk('env', 'ok', 'Bungie API key present.'));

  if (!s.tokens) {
    checks.push(chk('bungie-login', 'fail', 'Not logged in to Bungie (tokens.json missing).', FIX.RELOGIN_BUNGIE));
  } else if ((s.tokens.refresh_expires_at || 0) <= now) {
    // The refresh token is the ONLY thing that can mint a new Bungie access token, and DIM
    // auth needs a fresh Bungie access token. Nothing downstream can work without it.
    checks.push(chk('bungie-login', 'fail',
      'The Bungie login has expired. Nothing can talk to Bungie or DIM until you log in again.',
      FIX.RELOGIN_BUNGIE));
  } else checks.push(chk('bungie-login', 'ok', 'Bungie login is still valid.'));

  if (!s.app || !s.app.dimApiKey)
    checks.push(chk('dim-app', 'fail', 'This PC has never registered a DIM app.', FIX.SETUP_DIM));
  else checks.push(chk('dim-app', 'ok', `DIM app "${s.app.appId}" registered.`));

  // ---- 2. what the cached token itself says (offline, decisive) ----------------------
  const claims = s.token && s.token.token ? jwtPayload(s.token.token) : null;
  if (s.token && s.token.token && !claims)
    checks.push(chk('token-shape', 'fail', '.dim-token.json is not a readable token.', FIX.DROP_TOKEN));

  if (claims) {
    const expMs = (claims.exp || 0) * 1000;
    if (expMs && expMs < now)
      checks.push(chk('token-expiry', 'warn',
        'The DIM token has expired. That alone is normal — the server mints a new one.', FIX.DROP_TOKEN));
    else checks.push(chk('token-expiry', 'ok', 'DIM token has not expired.'));

    if (s.app && s.app.dimApiKey && claims.iss && claims.iss !== s.app.dimApiKey)
      checks.push(chk('api-key-match', 'fail',
        'The token was issued for a different DIM app than .dim-app.json holds — DIM answers 401 ApiKeyMismatch.',
        FIX.DROP_TOKEN));
    else if (claims.iss) checks.push(chk('api-key-match', 'ok', 'Token matches the registered DIM app.'));

    if (s.tokens && claims.sub && String(claims.sub) !== String(s.tokens.membership_id))
      checks.push(chk('account-match', 'fail',
        `The DIM token belongs to Bungie account ${claims.sub}, but this PC is logged in as ${s.tokens.membership_id}.`,
        FIX.DROP_TOKEN));
    else if (claims.sub) checks.push(chk('account-match', 'ok', 'Token belongs to the account that is logged in.'));

    // The subtle one: DIM only answers for a profile in the token's own list.
    const allowed = Array.isArray(claims.profileIds) ? claims.profileIds.map(String) : [];
    if (s.token.pid && allowed.length && !allowed.includes(String(s.token.pid)))
      checks.push(chk('profile-match', 'fail',
        `Asking DIM about Destiny profile ${s.token.pid}, which this token may not touch (${allowed.join(', ')}) — DIM answers 401 UnknownProfileId.`,
        FIX.DROP_TOKEN));
    else if (s.token.pid && allowed.length)
      checks.push(chk('profile-match', 'ok', 'Destiny profile is one DIM accepts.'));
  } else if (!s.token || !s.token.token) {
    checks.push(chk('token-present', 'info', 'No DIM token cached yet — the next DIM call mints one.'));
  }

  // ---- 3. one live call, only if the offline checks left it worth trying -------------
  const blocking = checks.find((c) => c.level === 'fail' && c.fix !== FIX.DROP_TOKEN);
  if (s.live && !blocking && s.app && s.app.dimApiKey && s.token && s.token.token) {
    const url = `${API}/profile?platformMembershipId=${s.token.pid}&destinyVersion=2&components=tags`;
    let res, body;
    try {
      res = await F(url, { headers: { 'X-API-Key': s.app.dimApiKey, Authorization: `Bearer ${s.token.token}`, Origin: DIM_ORIGIN } });
      body = await res.json().catch(() => ({}));
    } catch (err) {
      checks.push(chk('live', 'fail', `Could not reach the DIM API at all: ${err.message}`, FIX.NETWORK));
      return verdict(checks);
    }
    if (res.status === 200 && Array.isArray(body.tags)) {
      checks.push(chk('live', 'ok', `DIM answered with ${body.tags.length} tagged items.`));
      if (body.tags.length === 0 && s.mirrorCount > 0)
        checks.push(chk('live-empty', 'warn',
          `DIM returned no tags at all while this PC has ${s.mirrorCount} cached — that is what reading the wrong profile looks like.`,
          FIX.DROP_TOKEN));
    } else if ((res.status === 401 || res.status === 403) && !(body && body.error)) {
      // A reply from DIM always names its reason. One that does not came from something in
      // between (proxy, VPN, filtering DNS) and no amount of re-authenticating will help.
      checks.push(chk('live', 'fail',
        `HTTP ${res.status} with no DIM error in it — this reply did not come from DIM. Something on the network is blocking it.`,
        FIX.NETWORK));
    } else if (res.status === 401 || res.status === 403) {
      const E = {
        UnknownProfileId: ['DIM does not recognise the Destiny profile being asked about.', FIX.DROP_TOKEN],
        ApiKeyMismatch: ['The token was issued for a different app than the API key names.', FIX.DROP_TOKEN],
        WrongMembership: ['The token and the Bungie account disagree.', FIX.DROP_TOKEN],
        WebAuthRequired: ['The Bungie login is no longer valid.', FIX.RELOGIN_BUNGIE],
        OriginMismatch: ['The API key was registered for a different Origin than we send.', FIX.REREGISTER_APP],
        NoAppFound: ['DIM has no app for this key. A newly created app takes a minute to activate.', FIX.WAIT],
      };
      const [msg, fix] = E[body.error] || [`DIM rejected the request (${body.error}).`, FIX.DROP_TOKEN];
      checks.push(chk('live', 'fail', `DIM says ${body.error} — ${msg}`, fix));
    } else {
      checks.push(chk('live', 'fail', `Unexpected reply from DIM: HTTP ${res.status}.`, FIX.WAIT));
    }
  }

  return verdict(checks);
}

function verdict(checks) {
  const fails = checks.filter((c) => c.level === 'fail');
  const warns = checks.filter((c) => c.level === 'warn');
  const first = fails[0] || warns[0];
  const fix = first ? first.fix : FIX.NONE;
  const summary = fails.length ? fails[0].msg
    : warns.length ? warns[0].msg
    : 'DIM sync looks healthy.';
  return { ok: fails.length === 0, fix, summary, checks };
}

/** Plain-English instruction for a fix code, for the UI and the log. */
export function fixText(fix) {
  return {
    [FIX.NONE]: 'Nothing to do.',
    [FIX.DROP_TOKEN]: 'The server clears its cached DIM login and gets a new one. Automatic.',
    [FIX.REREGISTER_APP]: 'The server registers a fresh DIM app and gets a new login. Automatic.',
    [FIX.RELOGIN_BUNGIE]: 'You need to log in with Bungie again: open Settings and use the setup page, step 2.',
    [FIX.SETUP_DIM]: 'DIM has not been set up on this PC yet: open the setup page, step 3.',
    [FIX.NETWORK]: 'A VPN, firewall or work network is blocking api.destinyitemmanager.com.',
    [FIX.WAIT]: 'Transient — the server tries again on its own shortly.',
  }[fix] || 'Unknown.';
}
