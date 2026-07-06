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
    ['/fashion', 'Fashion'], ['/perks', 'Perk Finder'], ['/drops', 'New Drops'], ['/auto', 'Auto-Manager'], ['/artifacts', 'Artifacts'],
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
        <nav class="gb-nav">${nav}</nav>
      </div>`;
    // let pages (e.g. Weapon Vault) react to the selected character
    if (c) {
      window.GBANNER = { cid: c.id, cls: c.cls };
      window.dispatchEvent(new CustomEvent('gbanner:char', { detail: { cid: c.id, cls: c.cls } }));
    }
  }
  render(); // paint nav + name immediately; hydrate emblem/power when the account loads
  fetch('/api/account').then((r) => r.json()).then((a) => { acc = a; render(); }).catch(() => {});
  el.addEventListener('click', (e) => {
    const d = e.target.closest('.gdot'); if (!d) return;
    ci = +d.dataset.i; render();
  });
})();
