/* banner.js — shared in-game-style nameplate + section nav, included on every page.
   Renders into <div id="gbanner"></div>: your equipped emblem art as the banner
   background, your Bungie name, power level + class, character-switch dots, and the
   right-aligned section tabs. Data from /api/account. One file skins every page. */
(function () {
  const el = document.getElementById('gbanner');
  if (!el) return;
  const BN = 'https://www.bungie.net';
  const PAGES = [
    ['/', 'Armor Vault'], ['/vault', 'Weapon Vault'], ['/weapons', 'Weapon Watch'],
    ['/fashion', 'Fashion'], ['/perks', 'Perk Finder'], ['/drops', 'New Drops'], ['/auto', 'Auto-Manager'], ['/artifacts', 'Artifacts'], ['/settings', 'Settings'],
  ];
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const active = (h) => (h === '/' ? path === '/' : path === h || path.startsWith(h + '/'));
  const nav = PAGES.map(([h, t]) => `<a href="${h}" class="gnav-a${active(h) ? ' on' : ''}">${t}</a>`).join('');

  let acc = null, ci = 0;
  function render() {
    const c = acc && acc.chars && acc.chars[ci];
    const bg = c && c.emblemBg
      ? `background-image:linear-gradient(90deg,rgba(12,14,16,.86) 0%,rgba(12,14,16,.40) 42%,rgba(12,14,16,.80) 100%),url(${BN}${c.emblemBg})`
      : '';
    const dots = (acc && acc.chars.length > 1)
      ? `<span class="gb-dots">${acc.chars.map((x, i) =>
          `<button class="gdot${i === ci ? ' on' : ''}" data-i="${i}" title="${x.cls} · ✦${x.light}"><img src="${BN}${x.emblem}" alt=""></button>`).join('')}</span>`
      : '';
    el.innerHTML =
      `<div class="gb" style="${bg}">
        <div class="gb-l">
          ${c ? `<img class="gb-emb" src="${BN}${c.emblem}" alt="">` : ''}
          <div class="gb-id">
            <div class="gb-name">${acc ? acc.name : 'Guardian'}</div>
            <div class="gb-sub">${c ? `<span class="gb-pow">✦ ${c.light}</span><span class="gb-cls">${c.cls}</span>` : ''}${dots}</div>
          </div>
        </div>
        <button class="gb-upd" id="gbupd" type="button" title="Data freshness — click to refresh now">…</button>
        <nav class="gb-nav">${nav}</nav>
      </div>`;
    paintChip();
    // let pages (e.g. Weapon Vault) react to the selected character
    if (c) {
      window.GBANNER = { cid: c.id, cls: c.cls };
      window.dispatchEvent(new CustomEvent('gbanner:char', { detail: { cid: c.id, cls: c.cls } }));
    }
  }
  // ---- data-freshness chip + gentle auto-reload (2026-07-12) ----
  // Shows when the server last pulled the inventory from Bungie, in the SAME banner spot
  // on every page. Pages that can hot-reload their data expose window.GRELOAD = their
  // loader; the banner calls it when the server has newer data and you're not mid-action.
  let status = null;                 // last /api/status payload
  let dataLoadedAt = Date.now();     // when THIS page last pulled its data
  let lastTouch = Date.now();        // last user interaction (don't yank the UI mid-use)
  let refreshing = false;
  window.GDATA_LOADED = () => { dataLoadedAt = Date.now(); };   // pages call this after load()
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
    addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));

  const ago = (ms) => ms < 5000 ? 'just now'
    : ms < 60000 ? Math.round(ms / 1000) + 's ago'
    : ms < 3600000 ? Math.round(ms / 60000) + 'm ago'
    : Math.round(ms / 3600000) + 'h ago';

  function paintChip() {
    const c = el.querySelector('#gbupd'); if (!c) return;
    if (refreshing) { c.className = 'gb-upd warn'; c.textContent = 'Refreshing…'; return; }
    if (!status) { c.className = 'gb-upd'; c.textContent = '…'; c.title = 'Waiting for the server'; return; }
    if (!status.weaponsAt) { c.className = 'gb-upd warn'; c.textContent = 'Loading…'; c.title = 'Server is pulling the first snapshot'; return; }
    const age = Date.now() - status.weaponsAt;
    const dimErr = status.dim && status.dim.err;
    c.className = 'gb-upd ' + (dimErr || age > 300000 ? 'bad' : age > 90000 ? 'warn' : 'ok');
    c.textContent = 'Updated ' + ago(age);
    c.title = (dimErr ? 'DIM sync problem: ' + dimErr + '\n' : '')
      + 'Inventory pulled from Bungie ' + ago(age) + (status.gameUp ? ' · Destiny running' : '')
      + '\nClick to refresh now';
  }

  function reloadPageData(forced) {
    dataLoadedAt = Date.now();
    if (typeof window.GRELOAD === 'function') { try { window.GRELOAD(); } catch {} }
    else if (forced) location.reload();   // page has no hot-reload hook — full reload on explicit click only
  }

  async function pollStatus() {
    try {
      status = await fetch('/api/status').then((r) => r.json());
      // Auto-reload: server has newer data than this page, tab is visible, and the user
      // hasn't touched anything for 45s (never re-render under Diego's finger).
      if (status.weaponsAt > dataLoadedAt && !document.hidden
          && Date.now() - lastTouch > 45000) reloadPageData();
    } catch { /* server restarting — chip just goes stale */ }
    paintChip();
  }
  setInterval(pollStatus, 10000);
  setInterval(paintChip, 5000);
  pollStatus();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && status && status.weaponsAt > dataLoadedAt) reloadPageData();
  });

  render(); // paint nav + name immediately; hydrate emblem/power when the account loads
  fetch('/api/account').then((r) => r.json()).then((a) => { acc = a; render(); }).catch(() => {});
  el.addEventListener('click', (e) => {
    const u = e.target.closest('#gbupd');
    if (u) {   // force a fresh Bungie pull, then hot-reload the page's data
      if (refreshing) return;
      refreshing = true; paintChip();
      fetch('/api/weapons?fresh=1').then(() => fetch('/api/status').then((r) => r.json()).then((s) => { status = s; }))
        .catch(() => {})
        .finally(() => { refreshing = false; reloadPageData(true); paintChip(); });
      return;
    }
    const d = e.target.closest('.gdot'); if (!d) return;
    ci = +d.dataset.i; render();
  });
})();
