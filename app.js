// Parli Market: play-money prediction markets on NPDI, shared by everyone. The market lives on the server (worker/):
// this page reads it from /api/state every few seconds and sends trades to /api/trade; you sign in with Google to
// trade. The maths (market.js) is the same on both sides, so the ticket can preview a trade before it's sent.
import { EVENT, START_CASH } from './data.js';
import { M, byId, prices as P, priceOf as PO, moved as MV, costOf as CO, sharesFor as SF, worth as W, softmax } from './market.js';

const $ = id => document.getElementById(id);
const DAY = 864e5, POLL = 5000;
const RANGE = { '1d': DAY, '1w': 7 * DAY, '1m': 30 * DAY };
const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const BADGE = ['#132047', '#2a6f97', '#8a5a00', '#5b3f9e', '#1f7a54', '#9c3d63', '#40566b', '#a2471e', '#2d6a6a', '#6b4f2a'];
const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const G = $('signin').querySelector('svg').outerHTML;
const mobile = () => matchMedia('(max-width:920px)').matches;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = x => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = x => '$' + Math.round(x).toLocaleString('en-US');
const cents = p => { const c = p * 100; return c < 1 ? '<1¢' : c > 99 ? '>99¢' : Math.round(c) + '¢'; };
const pct = p => { const c = p * 100; return c < 1 ? '<1%' : c > 99 ? '>99%' : Math.round(c) + '%'; };
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const signed = (x, f = money) => (x >= 0 ? '+' : '') + f(x);
const tone = x => x > .005 ? 'up' : x < -.005 ? 'down' : '';
const ARROW = { up: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 9.5 8h-9z" fill="currentColor"/></svg>', down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9 .5 2h9z" fill="currentColor"/></svg>' };
const loginUrl = () => '/auth/login?next=' + encodeURIComponent('/#' + V.m.id);

/* ---------- the shared market, as last read from the server ---------- */
const S = { v: null, mk: {}, feed: [], board: null, me: null, lastT: 0, ready: false };
const prices = m => P(S.mk[m.id].q, m.b);
const priceOf = (m, o, side) => PO(S.mk[m.id].q, m.b, o, side);
const moved = (m, o, side, n) => MV(S.mk[m.id].q, o, side, n);
const costOf = (m, o, side, n) => CO(S.mk[m.id].q, m.b, o, side, n);
const sharesFor = (m, o, side, usd) => SF(S.mk[m.id].q, m.b, o, side, usd);
const worth = p => W(S.mk[p.m].q, byId[p.m].b, p.o, p.side, p.n);
const cash = () => S.me ? S.me.cash : 0;
const posOf = (m, o, side) => S.me?.pos.find(p => p.m === m.id && p.o === o && p.side === side);
const held = (m, o, side) => posOf(m, o, side)?.n || 0;

function take(st) {
  if ('me' in st) S.me = st.me;
  if (st.same) return false;
  for (const m of M) {
    const k = S.mk[m.id] || (S.mk[m.id] = { t: [], p: [] }), src = st.markets[m.id];
    k.q = src.q; k.vol = src.vol;
    for (const [t, p] of st.hist[m.id] || []) {
      if (k.t.length && t <= k.t[k.t.length - 1]) continue;
      k.t.push(t); k.p.push(p); S.lastT = Math.max(S.lastT, t);
    }
  }
  S.feed = st.feed; S.board = st.board; S.v = st.v;
  return true;
}
let pollT = 0, fails = 0, busy = false;
async function poll() {
  clearTimeout(pollT);
  if (busy) { pollT = setTimeout(poll, POLL); return; }
  try {
    const r = await fetch(`/api/state?since=${S.lastT}&v=${S.v ?? ''}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const st = await r.json();
    const meBefore = JSON.stringify(S.me), changed = take(st);
    fails = 0;
    if (!S.ready) { S.ready = true; start(); }
    else if (changed) refresh();
    else if (JSON.stringify(S.me) !== meBefore) { renderAccount(); renderPositions(); updateTicket(); }
  } catch (e) {
    fails++;
    if (!S.ready) $('contracts').innerHTML = `<p class="empty">Couldn’t reach the market. Trying again…</p>`;
  }
  pollT = setTimeout(poll, document.hidden ? POLL * 6 : Math.min(POLL * 2 ** Math.max(0, fails - 1), 60e3));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ready) poll(); });

/* ---------- view state ---------- */
const V = {
  m: byId[location.hash.slice(1)] || M[0],
  range: 'all', sort: 'chance', all: false,
  sel: {},          // per market: the selected outcome
  set: {},          // per market: the teams charted (fixed for the visit, so colours stay put)
  shown: {},        // last prices shown, for the flashes
  hover: null
};
const T = { side: 'yes', mode: 'buy' };
const cur = () => V.m;
const outIdx = m => V.sel[m.id] ?? (m.kind === 'multi' ? prices(m).indexOf(Math.max(...prices(m))) : 0);
function chartSet(m) {
  if (m.kind === 'binary') return [{ o: 0, slot: 0 }];
  if (!V.set[m.id]) V.set[m.id] = prices(m).map((p, o) => ({ p, o })).sort((a, b) => b.p - a.p).slice(0, 3).map((x, i) => ({ o: x.o, slot: i }));
  const set = V.set[m.id].slice(), s = outIdx(m);
  if (!set.some(x => x.o === s)) set.push({ o: s, slot: 3 });
  return set;
}
function priceAt(m, t) {
  const h = S.mk[m.id]; let lo = 0, hi = h.t.length - 1;
  if (!h.t.length) return prices(m);
  if (t <= h.t[0]) return h.p[0];
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (h.t[mid] <= t) lo = mid; else hi = mid - 1; }
  return h.p[lo];
}
const change = (m, o) => prices(m)[o] - priceAt(m, Date.now() - DAY)[o];
function chg(d) {
  const pts = Math.round(d * 100);
  if (!pts) return '<span class="chg flat">—</span>';
  return `<span class="chg ${pts > 0 ? 'up' : 'down'}" title="${pts > 0 ? 'Up' : 'Down'} ${Math.abs(pts)} points in 24 hours">${ARROW[pts > 0 ? 'up' : 'down']}${Math.abs(pts)}</span>`;
}
function badge(m, o) {
  if (m.kind === 'binary') return { bg: 'var(--ink)', txt: '?' };
  const x = m.outs[o];
  const ini = x.school.split(/[\s-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() + x.team;
  return { bg: BADGE[hash(x.school) % BADGE.length], txt: ini };
}
const label = (m, o) => m.kind === 'multi' ? m.outs[o].name : m.short;

/* ---------- your account ---------- */
function renderAccount() {
  const me = S.me;
  $('bal').hidden = !me; $('signin').hidden = !!me;
  $('signin').href = loginUrl();
  if (!me) { $('menu').hidden = true; return; }
  $('avatar').textContent = (me.name || '?')[0].toUpperCase();
  $('avatar').setAttribute('aria-label', `Account: ${me.name}`);
  $('menu-name').textContent = me.name;
  $('menu-email').textContent = me.email;
  $('port-val').textContent = money(positionsValue());
  $('cash').textContent = money(me.cash);
}
$('avatar').onclick = e => { e.stopPropagation(); const open = $('menu').hidden; $('menu').hidden = !open; $('avatar').setAttribute('aria-expanded', open); };
addEventListener('click', e => { if (!$('menu').hidden && !e.target.closest('#menu')) { $('menu').hidden = true; $('avatar').setAttribute('aria-expanded', 'false'); } });
$('sign-out').onclick = async () => {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  S.me = null; $('menu').hidden = true; renderAccount(); renderPositions(); renderTicket(); renderBoard(); renderFeed();
  toast('Signed out');
};

/* ---------- the market chips ---------- */
function renderChips() {
  $('mkts').innerHTML = M.map(m => `<button type="button" class="mkt" data-m="${m.id}" aria-pressed="${m === V.m}">${esc(m.short)} <em></em></button>`).join('');
  updateChips();
}
function updateChips() {
  for (const b of $('mkts').children) {
    const m = byId[b.dataset.m], p = prices(m);
    const i = p.indexOf(Math.max(...p));
    b.querySelector('em').textContent = m.kind === 'multi' ? `${m.outs[i].name} ${pct(p[i])}` : pct(p[0]);
  }
}
$('mkts').addEventListener('click', e => { const b = e.target.closest('.mkt'); if (b && S.ready) go(byId[b.dataset.m]); });

function go(m) {
  V.m = m; V.all = false;
  history.replaceState(null, '', '#' + m.id);
  T.mode = 'buy'; T.side = 'yes';
  renderMarket(); renderAccount();
  for (const b of $('mkts').children) b.setAttribute('aria-pressed', b.dataset.m === m.id);
}

/* ---------- the market ---------- */
function renderMarket() {
  const m = cur();
  $('m-kick').textContent = `${EVENT.short} ${EVENT.year} · ${m.short}`;
  $('m-title').textContent = m.title;
  $('hero').hidden = m.kind !== 'binary';
  $('m-ic').innerHTML = m.kind === 'binary' ? '?' : m.id === 'topseed' ? '#1' : TROPHY;
  renderContracts();
  renderRules();
  drawChart();
  renderTicket();
  updateMarket();
}
function renderContracts() {
  const m = cur(), box = $('contracts');
  V.shown = {};
  if (m.kind === 'binary') {
    box.innerHTML = `<div class="big-yn"><button type="button" class="yn y" data-side="yes" data-o="0">Buy Yes <span data-yes></span></button><button type="button" class="yn n" data-side="no" data-o="0">Buy No <span data-no></span></button></div>`;
    return;
  }
  const p = prices(m);
  const order = m.outs.map((_, o) => o);
  if (V.sort === 'chance') order.sort((a, b) => p[b] - p[a]);
  else order.sort((a, b) => Math.abs(change(m, b)) - Math.abs(change(m, a)));
  const show = V.all ? order : order.slice(0, 8);
  box.innerHTML = `<div class="list"><div class="lhead"><span class="sort" role="group" aria-label="Sort by"><button type="button" data-sort="chance" aria-pressed="${V.sort === 'chance'}">Chance</button><button type="button" data-sort="movers" aria-pressed="${V.sort === 'movers'}">Movers</button></span><span style="text-align:right">Chance</span><span class="c3" style="text-align:center">Buy</span></div>`
    + show.map(o => {
      const x = m.outs[o], bd = badge(m, o);
      return `<div class="row" data-o="${o}"><button type="button" class="who" data-pick="${o}"><span class="badge" style="background:${bd.bg}">${bd.txt}<i class="sw"></i></span><span class="nm"><b>${esc(x.name)}</b><small>${esc(x.school)}</small></span></button>`
        + `<div class="pct"><b data-pct></b><span data-chg></span></div>`
        + `<div class="btns"><button type="button" class="yn y" data-side="yes" data-o="${o}" aria-label="Buy Yes on ${esc(x.name)}">Yes <span data-yes></span></button><button type="button" class="yn n" data-side="no" data-o="${o}" aria-label="Buy No on ${esc(x.name)}">No <span data-no></span></button></div></div>`;
    }).join('')
    + (m.outs.length > 8 ? `<button type="button" class="more" data-more>${V.all ? 'Show fewer' : `Show all ${m.outs.length} teams`}</button>` : '') + '</div>';
}
function updateMarket() {
  const m = cur(), p = prices(m), sel = outIdx(m), set = chartSet(m);
  if (m.kind === 'binary') {
    $('hero').innerHTML = `<b>${pct(p[0])}</b><span>chance</span>${chg(change(m, 0))}`;
    const box = $('contracts');
    box.querySelector('[data-yes]').textContent = cents(p[0]);
    box.querySelector('[data-no]').textContent = cents(1 - p[0]);
    box.querySelector('.y').classList.toggle('on', T.side === 'yes');
    box.querySelector('.n').classList.toggle('on', T.side === 'no');
  } else {
    for (const row of $('contracts').querySelectorAll('.row')) {
      const o = +row.dataset.o, was = V.shown[o];
      row.querySelector('[data-pct]').textContent = pct(p[o]);
      row.querySelector('[data-chg]').innerHTML = chg(change(m, o));
      row.querySelector('[data-yes]').textContent = cents(p[o]);
      row.querySelector('[data-no]').textContent = cents(1 - p[o]);
      row.classList.toggle('sel', o === sel);
      row.querySelector('.y').classList.toggle('on', o === sel && T.side === 'yes');
      row.querySelector('.n').classList.toggle('on', o === sel && T.side === 'no');
      const s = set.find(x => x.o === o), sw = row.querySelector('.sw');
      sw.style.display = s ? '' : 'none';
      if (s) sw.style.background = SLOTS[s.slot];
      if (was != null && Math.abs(p[o] - was) >= .005) {
        row.classList.remove('flash-up', 'flash-down'); void row.offsetWidth;
        row.classList.add(p[o] > was ? 'flash-up' : 'flash-down');
      }
      V.shown[o] = p[o];
    }
  }
  $('vol').textContent = `${whole(S.mk[m.id].vol)} vol`;
  if (!V.hover) legend();
}
$('contracts').addEventListener('click', e => {
  if (!S.ready) return;
  const m = cur(), t = e.target;
  const s = t.closest('[data-sort]'); if (s) { V.sort = s.dataset.sort; renderContracts(); updateMarket(); return; }
  if (t.closest('[data-more]')) { V.all = !V.all; renderContracts(); updateMarket(); return; }
  const yn = t.closest('.yn');
  if (yn) { pick(m, +yn.dataset.o, yn.dataset.side, true); return; }
  const row = t.closest('.row');
  if (row) pick(m, +row.dataset.o, T.side, false);
});
function pick(m, o, side, open) {
  V.sel[m.id] = o; T.side = side;
  if (T.mode === 'sell' && !held(m, o, side)) T.mode = 'buy';
  drawChart(); updateMarket(); renderTicket();
  if (open && mobile()) openTicket();
}

/* ---------- the chart ---------- */
let CH = null;
function drawChart() {
  const m = cur(), box = $('chart'), W = box.clientWidth, H = box.clientHeight;
  if (!W || !S.ready) return;
  const padR = 42, padT = 8, padB = 22, pw = W - padR, ph = H - padT - padB;
  const h = S.mk[m.id], now = Date.now();
  let start = V.range === 'all' ? h.t[0] : Math.max(h.t[0], now - RANGE[V.range]);
  if (!(now - start > 60e3)) start = now - 60e3;
  let i0 = 0; while (i0 < h.t.length - 1 && h.t[i0 + 1] <= start) i0++;
  const ts = h.t.slice(i0), ps = h.p.slice(i0);
  ts.push(now); ps.push(prices(m));
  const set = chartSet(m);
  let ymax = m.kind === 'binary' ? 1 : 0;
  if (m.kind === 'multi') for (const p of ps) for (const s of set) ymax = Math.max(ymax, p[s.o]);
  const step = ymax > .6 ? .2 : ymax > .3 ? .1 : .05;
  ymax = m.kind === 'binary' ? 1 : Math.min(1, Math.ceil((ymax + .01) / step) * step);
  const X = t => Math.max(0, (t - start) / (now - start)) * pw;
  const Y = v => padT + ph - v / ymax * ph;
  let g = '';
  for (let v = 0; v <= ymax + 1e-9; v += step) g += `<line class="gl" x1="0" x2="${pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="yl" x="${pw + 8}" y="${(Y(v) + 4).toFixed(1)}">${Math.round(v * 100)}%</text>`;
  const span = now - start;
  const fmtX = t => span <= 2 * DAY ? new Date(t).toLocaleTimeString('en-US', span < 6 * 36e5 ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' }) : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const nx = Math.max(2, Math.min(5, Math.floor(pw / 110)));
  for (let i = 0; i <= nx; i++) {
    const t = start + span * i / nx, x = X(t);
    g += `<text class="xl" x="${x.toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${fmtX(t)}</text>`;
  }
  const sel = outIdx(m);
  const lines = set.slice().sort((a, b) => (a.o === sel) - (b.o === sel)).map(s => {
    // steps: a price holds until the next trade moves it
    let d = '';
    for (let i = 0; i < ts.length; i++) {
      const x = X(ts[i]).toFixed(1), y = Y(ps[i][s.o]).toFixed(1);
      d += i ? `H${x}V${y}` : `M${x} ${y}`;
    }
    const last = ps[ps.length - 1][s.o];
    return `<path class="ln" d="${d}" stroke="${SLOTS[s.slot]}"/><circle class="dot" r="4" cx="${pw.toFixed(1)}" cy="${Y(last).toFixed(1)}" fill="${SLOTS[s.slot]}"/>`;
  }).join('');
  $('svg').setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('svg').setAttribute('aria-label', `Price history of ${set.map(s => label(m, s.o)).join(', ')}`);
  $('svg').innerHTML = g + lines + '<g id="hov"></g>';
  CH = { m, ts, ps, X, Y, set, pw, ph, padT, start, now };
  for (const b of $('ranges').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.r === V.range);
  if (V.hover) hoverAt(V.hover); else legend();
}
function legend(i) {
  if (!S.ready) return;
  const m = cur(), set = chartSet(m);
  const p = i == null ? prices(m) : CH.ps[i];
  const when = i == null ? '' : new Date(CH.ts[i]).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  $('legend').innerHTML = set.map(s => `<span class="k"><i style="background:${SLOTS[s.slot]}"></i>${esc(m.kind === 'binary' ? 'Yes' : label(m, s.o))} <b>${pct(p[s.o])}</b></span>`).join('') + `<span class="when">${when}</span>`;
}
function hoverAt(clientX) {
  if (!CH) return;
  const r = $('chart').getBoundingClientRect(), x = clientX - r.left;
  if (x < 0 || x > CH.pw + 2) { unhover(); return; }
  const t = CH.start + x / CH.pw * (CH.now - CH.start);
  // the price at that moment: the last point at or before it
  let i = 0; while (i < CH.ts.length - 1 && CH.ts[i + 1] <= t) i++;
  const hx = Math.max(0, Math.min(CH.pw, x));
  $('hov').innerHTML = `<line class="hair" x1="${hx}" x2="${hx}" y1="${CH.padT}" y2="${CH.padT + CH.ph}"/>`
    + CH.set.map(s => `<circle class="dot" r="4.5" cx="${hx}" cy="${CH.Y(CH.ps[i][s.o])}" fill="${SLOTS[s.slot]}"/>`).join('');
  const m = CH.m, tip = $('tip');
  tip.innerHTML = `<div class="t">${new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>`
    + CH.set.slice().sort((a, b) => CH.ps[i][b.o] - CH.ps[i][a.o]).map(s => `<div class="r"><i style="background:${SLOTS[s.slot]}"></i>${esc(m.kind === 'binary' ? 'Yes' : label(m, s.o))}<b>${pct(CH.ps[i][s.o])}</b></div>`).join('');
  const tw = tip.offsetWidth;
  tip.style.transform = `translate(${hx + 14 + tw > CH.pw ? hx - 14 - tw : hx + 14}px, 6px)`;
  tip.classList.add('on');
  V.hover = clientX;
  legend(i);
}
function unhover() { V.hover = null; const h = $('hov'); if (h) h.innerHTML = ''; $('tip').classList.remove('on'); legend(); }
$('chart').addEventListener('pointermove', e => hoverAt(e.clientX));
$('chart').addEventListener('pointerdown', e => hoverAt(e.clientX));
$('chart').addEventListener('pointerleave', unhover);
$('ranges').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { V.range = b.dataset.r; drawChart(); } });
new ResizeObserver(() => drawChart()).observe($('chart'));

/* ---------- the ticket ---------- */
function renderTicket() {
  if (!S.ready) return;
  const m = cur(), o = outIdx(m), bd = badge(m, o), buy = T.mode === 'buy';
  $('tk-badge').style.background = bd.bg;
  $('tk-badge').textContent = bd.txt;
  $('tk-mkt').textContent = m.kind === 'multi' ? m.title : `${EVENT.short} ${EVENT.year}`;
  $('tk-name').textContent = m.kind === 'multi' ? m.outs[o].name : m.title;
  $('tk-buy').setAttribute('aria-selected', buy);
  $('tk-sell').setAttribute('aria-selected', !buy);
  $('tk-lbl').textContent = buy ? 'Amount' : 'Shares';
  $('tk-unit').textContent = buy ? '$' : '#';
  $('tk-amt').step = buy ? '1' : 'any';
  $('tk-amt').disabled = !S.me;
  $('tk-amt').closest('.field').hidden = !S.me;
  $('tk-quick').innerHTML = S.me ? (buy ? ['+$1', '+$10', '+$50', 'Max'] : ['25%', '50%', '75%', 'All']).map(q => `<button type="button" data-q="${q}">${q}</button>`).join('') : '';
  $('tk-fine').textContent = S.me ? 'Play money. Nothing here is real.' : `Everyone starts with ${whole(START_CASH)} of play money.`;
  updateTicket();
}
function updateTicket() {
  if (!S.ready) return;
  const m = cur(), o = outIdx(m), side = T.side, buy = T.mode === 'buy';
  const p = priceOf(m, o, side), amt = parseFloat($('tk-amt').value) || 0, have = held(m, o, side);
  $('tk-yp').textContent = cents(priceOf(m, o, 'yes'));
  $('tk-np').textContent = cents(priceOf(m, o, 'no'));
  $('tk-y').classList.toggle('on', side === 'yes');
  $('tk-n').classList.toggle('on', side === 'no');
  $('tk-have').textContent = !S.me ? '' : buy ? `Cash ${money(cash())}` : `You have ${have.toFixed(2)}`;
  const S_ = side === 'yes' ? 'Yes' : 'No', go = $('tk-go');
  go.classList.toggle('n', side === 'no');
  go.classList.toggle('in', !S.me);
  if (!S.me) {
    $('tk-est').innerHTML = `<div><dt>Price</dt><span>${cents(p)}</span></div><div><dt>Pays if right</dt><span>$1.00 a share</span></div>`;
    $('tk-warn').textContent = '';
    go.innerHTML = `${G}Sign in with Google to trade`;
    go.disabled = false;
    return;
  }
  let warn = '', est = '', ok = false;
  if (buy) {
    if (amt > cash() + 1e-9) warn = 'Not enough cash.';
    else if (amt > 0 && amt < 1) warn = 'The smallest trade is $1.';
    const usd = Math.min(amt, cash());
    const n = usd > 0 ? sharesFor(m, o, side, usd) : 0;
    const after = n ? softmax(moved(m, o, side, n).map(x => x / m.b))[o] : null;
    const pa = after == null ? p : side === 'yes' ? after : 1 - after;
    est = `<div><dt>Avg price</dt><span>${n ? (usd / n * 100).toFixed(1) + '¢' : cents(p)}</span></div>`
      + `<div><dt>Shares</dt><span>${n.toFixed(2)}</span></div>`
      + `<div><dt>Price moves</dt><span>${cents(p)} → ${cents(pa)}</span></div>`
      + `<div class="win ${side === 'no' ? 'n' : ''}"><dt>Payout if ${S_}</dt><span style="text-align:right"><b>${money(n)}</b>${n ? `<small>+${money(n - usd)} (${Math.round((n / usd - 1) * 100)}%)</small>` : ''}</span></div>`;
    ok = amt >= 1 && !warn;
    go.textContent = amt > 0 ? `Buy ${S_} · ${money(Math.min(amt, cash()))}` : `Buy ${S_}`;
  } else {
    const pos = posOf(m, o, side);
    if (!have) warn = `You don’t hold any ${S_} shares here.`;
    else if (amt > have + 1e-3) warn = `You only have ${have.toFixed(2)}.`;
    const n = amt >= have - 1e-3 ? have : amt;
    const get = n > 0 ? -costOf(m, o, side, -n) : 0;
    const basis = pos && n ? pos.cost * n / pos.n : 0;
    est = `<div><dt>Avg price</dt><span>${n ? (get / n * 100).toFixed(1) + '¢' : cents(p)}</span></div>`
      + (pos ? `<div><dt>You paid</dt><span>${(pos.cost / pos.n * 100).toFixed(1)}¢ avg</span></div>` : '')
      + `<div class="win ${side === 'no' ? 'n' : ''}"><dt>You receive</dt><span style="text-align:right"><b>${money(get)}</b>${n ? `<small>${get - basis >= 0 ? '+' : '−'}${money(Math.abs(get - basis))} vs what you paid</small>` : ''}</span></div>`;
    ok = n > 0 && !warn;
    go.textContent = n > 0 ? `Sell ${S_} · ${money(get)}` : `Sell ${S_}`;
  }
  $('tk-est').innerHTML = est;
  $('tk-warn').textContent = warn;
  go.disabled = !ok || busy;
  if (busy) go.textContent = 'Placing order…';
}
$('tk-y').onclick = () => { T.side = 'yes'; updateTicket(); updateMarket(); };
$('tk-n').onclick = () => { T.side = 'no'; updateTicket(); updateMarket(); };
$('tk-buy').onclick = () => { T.mode = 'buy'; $('tk-amt').value = ''; renderTicket(); };
$('tk-sell').onclick = () => { T.mode = 'sell'; $('tk-amt').value = ''; renderTicket(); };
$('tk-amt').addEventListener('input', updateTicket);
$('tk-amt').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('tk-go').disabled) trade(); });
$('tk-quick').addEventListener('click', e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  const q = b.dataset.q, m = cur(), have = held(m, outIdx(m), T.side), v = parseFloat($('tk-amt').value) || 0, c = Math.floor(cash() * 100) / 100;
  if (T.mode === 'buy') $('tk-amt').value = q === 'Max' ? c : Math.min(c, v + parseFloat(q.slice(2)));
  else $('tk-amt').value = q === 'All' ? +have.toFixed(4) : +(have * parseFloat(q) / 100).toFixed(2);
  updateTicket();
});
$('tk-go').onclick = () => { if (!S.me) location.href = loginUrl(); else trade(); };

async function trade() {
  if (busy) return;
  const m = cur(), o = outIdx(m), side = T.side, buy = T.mode === 'buy', amt = parseFloat($('tk-amt').value) || 0;
  const S_ = side === 'yes' ? 'Yes' : 'No', name = label(m, o);
  const body = { m: m.id, o, side, mode: T.mode, amount: amt, since: S.lastT };
  // what the ticket promised, less 3%: if other trades moved the price further than that, the order is refused
  if (buy) body.minShares = sharesFor(m, o, side, Math.min(amt, cash())) * .97;
  else { const have = held(m, o, side), n = amt >= have - 1e-3 ? have : amt; body.minReturn = -costOf(m, o, side, -n) * .97; }
  busy = true; updateTicket();
  try {
    const r = await fetch('/api/trade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({ error: 'Something went wrong. Try again.' }));
    busy = false;
    if (!r.ok) {
      if (r.status === 401) S.me = null;
      toast(res.error || 'That didn’t go through. Try again.');
      poll(); renderAccount(); renderTicket();
      return;
    }
    take(res.state);
    $('tk-amt').value = '';
    if (!buy && !held(m, o, side)) T.mode = 'buy';
    toast(buy ? `Bought ${res.n.toFixed(1)} ${S_} · ${name} at ${(res.usd / res.n * 100).toFixed(1)}¢` : `Sold ${res.n.toFixed(1)} ${S_} · ${name} for ${money(res.usd)}`);
    refresh(); renderTicket();
    if (mobile()) setTimeout(closeTicket, 500);
  } catch (e) {
    busy = false; updateTicket();
    toast('Couldn’t reach the market. Check your connection.');
  }
}

/* the ticket as a sheet on phones */
function openTicket() { $('ticket').classList.add('open'); $('scrim').classList.add('on'); if (S.me) setTimeout(() => $('tk-amt').focus({ preventScroll: true }), 350); }
function closeTicket() { $('ticket').classList.remove('open'); $('scrim').classList.remove('on'); }
$('tk-close').onclick = closeTicket;
$('scrim').onclick = closeTicket;
addEventListener('keydown', e => { if (e.key === 'Escape') { closeTicket(); $('menu').hidden = true; } });

/* ---------- positions, leaderboard, activity, rules ---------- */
function positionsValue() { let v = 0; for (const p of S.me?.pos || []) v += worth(p); return v; }
const signInBlock = msg => `<div class="cta"><p>${msg}</p><a class="signin" href="${loginUrl()}">${G}<span>Sign in with Google</span></a></div>`;
function renderPositions() {
  const list = S.me?.pos || [];
  $('pos-n').textContent = list.length;
  if (!S.me) { $('p-pos').innerHTML = signInBlock(`Sign in to trade. Everyone starts with ${whole(START_CASH)} of play money.`); return; }
  const val = positionsValue(), total = S.me.cash + val, pl = total - START_CASH;
  let h = `<div class="sum"><div><small>Total</small><b>${money(total)}</b></div><div><small>Cash</small><b>${money(S.me.cash)}</b></div><div><small>In positions</small><b>${money(val)}</b></div><div><small>Profit</small><b class="pl ${tone(pl)}">${signed(pl)}</b></div></div>`;
  if (!list.length) h += `<p class="empty">No positions yet. Pick a team and buy Yes or No.</p>`;
  else {
    h += `<table><thead><tr><th>Contract</th><th>Shares</th><th class="hide-s">Avg → Now</th><th title="What selling now would pay">Value</th><th class="hide-s">P&amp;L</th><th><span class="sr-only">Sell</span></th></tr></thead><tbody>`
      + list.map((p, i) => {
        const m = byId[p.m], now = priceOf(m, p.o, p.side), v = worth(p), d = v - p.cost;
        return `<tr><td><span class="c">${esc(label(m, p.o))}</span> <span class="${p.side === 'yes' ? 'side-y' : 'side-n'}">${p.side === 'yes' ? 'Yes' : 'No'}</span><span class="s">${esc(m.kind === 'multi' ? m.short : m.title)}</span></td>`
          + `<td>${p.n.toFixed(1)}</td><td class="hide-s">${(p.cost / p.n * 100).toFixed(1)}¢ → ${cents(now)}</td><td>${money(v)}</td>`
          + `<td class="hide-s pl ${tone(d)}">${signed(d)}</td><td><button type="button" class="mini" data-sell="${i}">Sell</button></td></tr>`;
      }).join('') + '</tbody></table>';
  }
  $('p-pos').innerHTML = h;
}
$('p-pos').addEventListener('click', e => {
  const s = e.target.closest('[data-sell]'); if (!s) return;
  const p = S.me?.pos[+s.dataset.sell]; if (!p) return;
  const m = byId[p.m];
  if (m !== V.m) go(m);
  V.sel[m.id] = p.o; T.side = p.side; T.mode = 'sell';
  drawChart(); updateMarket(); renderTicket();
  $('tk-amt').value = +p.n.toFixed(4); updateTicket();
  if (mobile()) openTicket(); else scrollTo({ top: 0, behavior: 'smooth' });
});
function renderBoard() {
  const b = S.board; if (!b) return;
  if (!b.top.length) { $('p-board').innerHTML = `<p class="empty">No players yet.</p>`; return; }
  const row = r => `<tr class="${r.me ? 'board-me' : ''}"><td class="rank">${r.rank}</td><td style="text-align:left">${esc(r.name)}${r.me ? ' <span class="side-y">You</span>' : ''}</td><td>${money(r.total)}</td><td class="pl ${tone(r.total - START_CASH)}">${signed(r.total - START_CASH)}</td></tr>`;
  const mine = b.me && !b.top.some(r => r.me) ? row({ rank: b.me.rank, name: S.me?.name || 'You', total: b.me.total, me: true }) : '';
  $('p-board').innerHTML = `<table><thead><tr><th class="rank">#</th><th style="text-align:left">Player</th><th>Total</th><th>Profit</th></tr></thead><tbody>${b.top.map(row).join('')}${mine}</tbody></table>`
    + `<p class="fine" style="margin-top:12px">${b.players} player${b.players === 1 ? '' : 's'} · cash plus what positions would sell for now</p>`;
}
function renderFeed() {
  if (!S.feed.length) { $('feed').innerHTML = `<li class="empty" style="display:block">No trades yet. Be the first.</li>`; return; }
  $('feed').innerHTML = S.feed.map(f => {
    const m = byId[f.m]; if (!m || f.o >= m.outs.length) return '';
    const sd = f.side === 'yes' ? 'Yes' : 'No';
    return `<li class="${f.mine ? 'mine' : ''}"><span class="what">${f.mine ? '' : `<b>${esc(f.who)}</b> `}${f.sell ? 'sold' : 'bought'} <span class="${f.side === 'yes' ? 'side-y' : 'side-n'}">${sd}</span> · ${esc(m.kind === 'multi' ? label(m, f.o) : m.short)}</span><span class="usd">${money(f.usd)}</span><span class="meta">${m.kind === 'multi' ? esc(m.short) + ' · ' : ''}${ago(f.t)}</span><span class="px">at ${cents(f.px)}</span></li>`;
  }).join('');
}
function renderRules() {
  const m = cur();
  $('p-rules').innerHTML = `<p>${esc(m.rules)}</p><dl><dt>Event</dt><dd>${esc(EVENT.name)} ${EVENT.year}</dd><dt>Contracts</dt><dd>${m.kind === 'multi' ? `${m.outs.length} teams, one Yes/No each` : 'One Yes/No question'}</dd><dt>Pays</dt><dd>$1 a share if right, nothing if wrong</dd><dt>Prices</dt><dd>Set by everyone’s trades; Yes and No always add up to $1</dd><dt>Money</dt><dd>Play money: ${whole(START_CASH)} for each Google account</dd></dl>`;
}
$('t-pos').parentElement.addEventListener('click', e => {
  const b = e.target.closest('[role="tab"]'); if (!b) return;
  for (const t of b.parentElement.children) { const on = t === b; t.setAttribute('aria-selected', on); $(t.getAttribute('aria-controls')).hidden = !on; }
});
$('bal-port').onclick = $('bal-cash').onclick = () => { $('t-pos').click(); $('p-pos').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3000); }

function refresh() {
  updateChips(); updateMarket(); drawChart(); updateTicket();
  renderAccount(); renderPositions(); renderBoard(); renderFeed();
}
// keep the times fresh while nobody trades: the feed's "2m ago" and the chart's right edge (now)
setInterval(() => { if (!document.hidden && S.ready) { renderFeed(); drawChart(); } }, 30e3);

/* ---------- start ---------- */
$('ev-name').textContent = `${EVENT.short} ${EVENT.year}`;
$('m-title').textContent = V.m.title;
$('foot').textContent = `${EVENT.name} ${EVENT.year}. A sample field with play money: prices start from our guesses and move with everyone’s trades.`;
$('contracts').innerHTML = `<p class="empty">Loading the market…</p>`;
function start() {
  renderChips(); renderMarket(); renderAccount(); renderPositions(); renderBoard(); renderFeed();
}
addEventListener('hashchange', () => { const m = byId[location.hash.slice(1)]; if (m && m !== V.m && S.ready) go(m); });
// the page used to keep a private market in this browser: clear it
try { localStorage.removeItem('resolved-v1'); } catch (e) { /* storage blocked */ }
poll();
