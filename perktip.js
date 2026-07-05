/* perktip.js — shared perk hover popup for Weapon Watch / Perk Finder / Weapon Vault.
 * Served like banner.js. Include once per page: <script src="/perktip.js"></script>,
 * then call PerkTip.init({perkDescs, perkInsights}) after your data loads.
 *
 * perkDescs[name]   = manifest in-game description (string)
 * perkInsights[name]= cleaned community bullets: [{type,text}], type ∈ trigger|ramp|penalty|buff|note
 *                     (a bare string is also accepted and shown as one note bullet)
 *
 * Design (locked with Diego): sectioned card — element accent bar, name, IN-GAME inset box
 * (same text size), COMMUNITY INSIGHT bullets. Two-colour numbers (gold buff / red penalty),
 * teal time, element-coloured keyword verbs (Jolt/Scorch/Sever…), symbols ▸ ▲ ▼ × (no emoji).
 */
(function () {
  var C = {
    gold: '#cdae32', arc: '#6de8f1', teal: '#4fc7d0', solar: '#f1631d',
    voidc: '#a777c5', stasis: '#4d88ff', strand: '#35e366', red: '#e0523a',
    ink: '#e9ebf2', mut: '#8b93a7', dim: 'rgba(255,255,255,.34)', line: '#2a2f3d', panel: '#12151c'
  };
  // Destiny keyword verbs -> element colour (matched whole-word, case-insensitive).
  var KW = [
    [C.arc, ['jolt', 'jolted', 'jolts', 'blind', 'blinded', 'amplified', 'ionic', 'arc']],
    [C.solar, ['scorch', 'scorched', 'ignite', 'ignited', 'ignition', 'radiant', 'restoration', 'cure', 'solar']],
    [C.voidc, ['volatile', 'suppress', 'suppressed', 'weaken', 'weakened', 'devour', 'invisible', 'invisibility', 'overshield', 'void']],
    [C.stasis, ['slow', 'slowed', 'freeze', 'frozen', 'shatter', 'shattered', 'stasis', 'frost armor']],
    [C.strand, ['sever', 'severed', 'suspend', 'suspended', 'unravel', 'unraveled', 'unraveling', 'tangle', 'woven mail', 'strand']]
  ];
  var KWRE = KW.map(function (p) {
    return [new RegExp('\\b(' + p[1].join('|').replace(/ /g, '\\s') + ')\\b', 'gi'), p[0]];
  });
  var SYM = { trigger: ['▸', C.teal], ramp: ['▲', C.gold], penalty: ['▼', C.red], buff: ['', ''], note: ['', ''] };

  var DESCS = {}, INS = {}, tip = null;
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  // Colour one bullet's text: seconds teal, multipliers/stacks gold, % gold(+)/red(−), keywords by element.
  function fmt(text, type) {
    var h = esc(text);
    h = h.replace(/(\d+(?:\.\d+)?)(\s?)(seconds?|secs?|s)\b/gi, function (m, n, sp, u) { return '<b style="color:' + C.teal + '">' + n + sp + u + '</b>'; });
    h = h.replace(/\b(\d+(?:\.\d+)?)x\b/gi, '<b style="color:' + C.gold + '">$1x</b>');
    h = h.replace(/([×x])(\d+)\b/g, '<b style="color:' + C.gold + '">×$2</b>');
    h = h.replace(/([+\-−]?)(\d+(?:\.\d+)?%)/g, function (m, sign, num) {
      var neg = sign === '-' || sign === '−' || type === 'penalty';
      var pre = (sign && sign !== '-' && sign !== '−') ? sign : (neg ? '−' : '+');
      return '<b style="color:' + (neg ? C.red : C.gold) + '">' + pre + num + '</b>';
    });
    KWRE.forEach(function (p) { h = h.replace(p[0], function (m) { return '<b style="color:' + p[1] + '">' + m + '</b>'; }); });
    return h;
  }

  // Normalise perkInsights entry to a bullets array.
  function bulletsOf(name) {
    var v = INS[name];
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return [{ type: 'note', text: String(v) }];
  }

  // Accent colour = dominant element keyword across the bullets, else gold.
  function accentFor(bullets) {
    var tally = {}, all = bullets.map(function (b) { return b.text; }).join(' ');
    KWRE.forEach(function (p, i) { var m = all.match(p[0]); if (m) tally[i] = m.length; });
    var best = -1, bc = 0;
    Object.keys(tally).forEach(function (k) { if (tally[k] > bc) { bc = tally[k]; best = +k; } });
    return best >= 0 ? KW[best][0] : C.gold;
  }

  function ensureTip() {
    if (tip) return tip;
    var st = document.createElement('style');
    st.textContent = [
      '#ptip{position:fixed;z-index:99999;width:330px;max-width:92vw;background:' + C.panel + ';border:1px solid ' + C.line + ';overflow:hidden;display:none;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.6);font:12.5px/1.55 "Segoe UI",Roboto,system-ui,sans-serif;color:' + C.ink + '}',
      '#ptip .ptbar{height:3px}',
      '#ptip .ptin{padding:13px 14px}',
      '#ptip .ptnm{font-weight:700;font-size:13.5px;margin-bottom:9px}',
      '#ptip .ptlab{font:600 9px "Bahnschrift","Roboto Condensed",sans-serif;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px}',
      '#ptip .ptlab.ig{color:' + C.dim + '}',
      '#ptip .ptlab.ci{color:' + C.teal + ';margin-top:11px}',
      '#ptip .ptbox{background:rgba(255,255,255,.04);border-radius:4px;padding:8px 10px;font-size:12.5px;color:' + C.ink + '}',
      '#ptip .ptb{display:flex;gap:7px;margin-top:6px}',
      '#ptip .ptb:first-child{margin-top:0}',
      '#ptip .ptsym{flex:0 0 12px;font-weight:700;text-align:center}',
      '#ptip .ptnote{color:' + C.mut + ';font-size:11.5px}'
    ].join('');
    document.head.appendChild(st);
    tip = document.createElement('div');
    tip.id = 'ptip';
    document.body.appendChild(tip);
    return tip;
  }

  function render(name) {
    var desc = DESCS[name], bullets = bulletsOf(name);
    if (!desc && !bullets.length) return false;
    var accent = accentFor(bullets);
    var html = '<div class="ptbar" style="background:linear-gradient(90deg,' + accent + ',transparent)"></div><div class="ptin">';
    html += '<div class="ptnm">' + esc(name) + '</div>';
    if (desc) html += '<div class="ptlab ig">In-game</div><div class="ptbox">' + esc(desc) + '</div>';
    if (bullets.length) {
      html += '<div class="ptlab ci">Community insight</div>';
      html += bullets.map(function (b) {
        var s = SYM[b.type] || SYM.buff;
        var sym = s[0] ? '<span class="ptsym" style="color:' + s[1] + '">' + s[0] + '</span>' : '<span class="ptsym"></span>';
        return '<div class="ptb">' + sym + '<span>' + fmt(b.text, b.type) + '</span></div>';
      }).join('');
    }
    html += '</div>';
    ensureTip().innerHTML = html;
    return true;
  }

  function place(el) {
    var r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    var left = Math.min(r.left, window.innerWidth - 8 - t.width); if (left < 8) left = 8;
    var top = r.bottom + 8; if (top + t.height > window.innerHeight - 8) top = r.top - 8 - t.height; if (top < 8) top = 8;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function show(el) {
    var name = el.getAttribute('data-p') || el.getAttribute('data-pn');
    if (!name) return;
    if (!render(name)) { hide(); return; }
    tip.style.display = 'block';
    place(el);
  }
  function hide() { clearTimeout(hoverTimer); if (tip) tip.style.display = 'none'; }

  var hoverTimer = null, HOVER_DELAY = 400;   // ms before the popup appears — avoids flashing while skimming
  function wire() {
    document.body.addEventListener('mouseover', function (e) {
      var el = e.target.closest('[data-p],[data-pn]'); if (!el) return;
      clearTimeout(hoverTimer); hoverTimer = setTimeout(function () { show(el); }, HOVER_DELAY);
    });
    document.body.addEventListener('mouseout', function (e) { var el = e.target.closest('[data-p],[data-pn]'); if (el && !el.contains(e.relatedTarget)) hide(); });
    window.addEventListener('scroll', hide, { passive: true, capture: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.PerkTip = {
    init: function (data) {
      data = data || {};
      if (data.perkDescs) DESCS = data.perkDescs;
      if (data.perkInsights) INS = data.perkInsights;
    },
    hide: hide
  };
})();
