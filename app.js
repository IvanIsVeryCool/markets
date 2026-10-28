// Resolved: play-money prediction markets on NPDI. Each market is priced by an automated market maker (LMSR: a team's
// price is its share of exp(q / b) over all teams, so prices always add up to $1 and every trade moves them),
// with a few simulated traders nudging prices toward a slowly drifting fair value. Everything is kept in this
// browser (localStorage); the field and the markets are in data.js.
import { EVENT, TEAMS, MARKETS, START_CASH } from './data.js';

const $ = id => document.getElementById(id);
const KEY = 'resolved-v1';
const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
const RANGE = { '1d': DAY, '1w': 7 * DAY, '1m': 30 * DAY };
const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const BADGE = ['#132047', '#2a6f97', '#8a5a00', '#5b3f9e', '#1f7a54', '#9c3d63', '#40566b', '#a2471e', '#2d6a6a', '#6b4f2a'];
const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const mobile = () => matchMedia('(max-width:920px)').matches;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = x => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = x => '$' + Math.round(x).toLocaleString('en-US');
const cents = p => { const c = p * 100; return c < 1 ? '<1¢' : c > 99 ? '>99¢' : Math.round(c) + '¢'; };
const pct = p => { const c = p * 100; return c < 1 ? '<1%' : c > 99 ? '>99%' : Math.round(c) + '%'; };
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
const ARROW = { up: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 9.5 8h-9z" fill="currentColor"/></svg>', down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9 .5 2h9z" fill="currentColor"/></svg>' };

// seeded randomness, so the made-up price history is the same for everyone
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const softmax = z => { const mx = Math.max(...z), e = z.map(x => Math.exp(x - mx)), s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); };

/* ---------- the markets ---------- */
const M = MARKETS.map(d => {
  const outs = d.kind === 'multi'
    ? TEAMS.map(t => ({ id: t.id, name: `${t.school} ${t.team}`, school: t.school, team: t.team }))
    : [{ id: 'yes', name: 'Yes' }, { id: 'no', name: 'No' }];
  const raw = d.kind === 'multi' ? TEAMS.map(t => Math.max(.2, +t[d.key] || 1)) : [d.p, 100 - d.p];
  const sum = raw.reduce((a, b) => a + b, 0);
  const p0 = raw.map(x => x / sum);
  return { ...d, outs, p0, sig: outs.map(o => o.id).join(','), fair: p0.map(Math.log) };
});
const byId = Object.fromEntries(M.map(m => [m.id, m]));

const lse = (q, b) => { const mx = Math.max(...q) / b; let s = 0; for (const x of q) s += Math.exp(x / b - mx); return b * (mx + Math.log(s)); };
const prices = m => softmax(S.mk[m.id].q.map(x => x / m.b));
const priceOf = (m, o, side) => { const p = prices(m)[o]; return side === 'yes' ? p : 1 - p; };
// "Yes" on outcome o adds n shares of o; "No" adds n shares of every other outcome (pays $1 unless o wins)
const moved = (m, o, side, n) => S.mk[m.id].q.map((x, j) => x + ((side === 'yes') === (j === o) ? n : 0));
const costOf = (m, o, side, n) => lse(moved(m, o, side, n), m.b) - lse(S.mk[m.id].q, m.b);
function sharesFor(m, o, side, usd) {
  let lo = 0, hi = usd / Math.max(priceOf(m, o, side), 1e-4) + 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (costOf(m, o, side, mid) > usd) hi = mid; else lo = mid; }
  return lo;
}
function apply(m, o, side, n) { S.mk[m.id].q = moved(m, o, side, n); record(m); }

/* ---------- saved state ---------- */
let S = null;
try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) S = s; } catch (e) { /* private mode: start fresh */ }
let saveT = 0;
function save(now) {
  clearTimeout(saveT);
  const go = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } };
  if (now) go(); else saveT = setTimeout(go, 800);
}
function fresh() {
  S = { v: 1, cash: START_CASH, pos: {}, feed: [], mk: {} };
}
if (!S) fresh();
for (const m of M) {
  const k = S.mk[m.id];
  if (k && k.sig === m.sig) continue;
  // new market, or its teams changed: start it over (and refund anything held in it)
  for (const [key, p] of Object.entries(S.pos)) if (p.m === m.id) { S.cash += p.cost; delete S.pos[key]; }
  S.mk[m.id] = { sig: m.sig, q: m.p0.map(p => m.b * Math.log(p)), vol: m.vol, ...pastPrices(m) };
}
if (!S.feed.length) seedFeed();

// a made-up past: random walks in log-odds, run backwards from today's prices, with a few jumps (earlier
// tournaments). Dense near now, sparse further back.
function pastPrices(m) {
  const r = rng(hash(m.id + m.sig)), now = Date.now(), ts = [];
  for (let t = now; t > now - DAY; t -= 10 * MIN) ts.push(t);
  for (let t = now - DAY; t > now - 7 * DAY; t -= HOUR) ts.push(t);
  for (let t = now - 7 * DAY; t > now - 30 * DAY; t -= 6 * HOUR) ts.push(t);
  for (let t = now - 30 * DAY; t >= now - 90 * DAY; t -= DAY) ts.push(t);
  const jumps = [0, 1, 2].map(() => now - (8 + r() * 75) * DAY);
  let z = m.p0.map(Math.log);
  const ps = [];
  for (let i = 0; i < ts.length; i++) {
    ps.push(softmax(z).map(x => +x.toFixed(4)));
    if (i + 1 === ts.length) break;
    const dt = (ts[i] - ts[i + 1]) / DAY;
    const jump = jumps.some(j => j <= ts[i] && j > ts[i + 1]);
    z = z.map((x, j) => x + gauss(r) * .075 * Math.sqrt(dt) * (m.kind === 'binary' && j ? 0 : 1) + (jump ? gauss(r) * .28 : 0));
  }
  return { t: ts.reverse(), p: ps.reverse() };
}
function record(m) {
  const h = S.mk[m.id], now = Date.now(), p = prices(m).map(x => +x.toFixed(4));
  if (now - h.t[h.t.length - 1] < 30e3 && h.t.length > 1) { h.t[h.t.length - 1] = now; h.p[h.p.length - 1] = p; } else { h.t.push(now); h.p.push(p); }
  if (h.t.length > 1600) { // thin out the older half
    const cut = h.t.length >> 1, t = [], ps = [];
    for (let i = 0; i < h.t.length; i++) if (i >= cut || i % 2 === 0) { t.push(h.t[i]); ps.push(h.p[i]); }
    h.t = t; h.p = ps;
  }
}
function seedFeed() {
  const r = rng(hash('feed')), now = Date.now();
  for (let i = 0; i < 14; i++) {
    const m = pickMarket(r), o = m.kind === 'multi' ? pickOutcome(m, r) : 0;
    const side = r() < .6 ? 'yes' : 'no', usd = Math.round(Math.exp(Math.log(18) + gauss(r) * .8));
    S.feed.push({ t: now - (i + r()) * 2.3 * MIN, m: m.id, o, side, usd: Math.max(2, usd), px: priceOf(m, o, side) });
  }
}

/* ---------- view state ---------- */
const V = {
  m: byId[location.hash.slice(1)] || M[0],
  range: 'all', sort: 'chance', all: false, tab: 'pos',
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
$('mkts').addEventListener('click', e => { const b = e.target.closest('.mkt'); if (b) go(byId[b.dataset.m]); });

function go(m) {
  V.m = m; V.all = false;
  history.replaceState(null, '', '#' + m.id);
  T.mode = 'buy'; T.side = 'yes';
  renderMarket();
  for (const b of $('mkts').children) b.setAttribute('aria-pressed', b.dataset.m === m.id);
}

/* ---------- the market ---------- */
function renderMarket() {
  const m = cur();
  $('m-kick').textContent = `${EVENT.short} ${EVENT.year} · ${m.short}`;
  $('m-title').textContent = m.title;
  $('ev-name').textContent = `${EVENT.short} ${EVENT.year}`;
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
  if (!W) return;
  const padR = 42, padT = 8, padB = 22, pw = W - padR, ph = H - padT - padB;
  const h = S.mk[m.id], now = Date.now();
  const start = V.range === 'all' ? h.t[0] : Math.max(h.t[0], now - RANGE[V.range]);
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
  const fmtX = t => V.range === '1d' ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric' }) : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const nx = Math.max(2, Math.min(5, Math.floor(pw / 110)));
  for (let i = 0; i <= nx; i++) {
    const t = start + (now - start) * i / nx, x = X(t);
    g += `<text class="xl" x="${x.toFixed(1)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${fmtX(t)}</text>`;
  }
  const sel = outIdx(m);
  const lines = set.slice().sort((a, b) => (a.o === sel) - (b.o === sel)).map(s => {
    let d = '';
    for (let i = 0; i < ts.length; i++) d += (i ? 'L' : 'M') + X(ts[i]).toFixed(1) + ' ' + Y(ps[i][s.o]).toFixed(1);
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
  let lo = 0, hi = CH.ts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (CH.ts[mid] < t) lo = mid; else hi = mid; }
  const i = Math.abs(CH.ts[lo] - t) < Math.abs(CH.ts[hi] - t) ? lo : hi;
  const hx = CH.X(CH.ts[i]);
  $('hov').innerHTML = `<line class="hair" x1="${hx}" x2="${hx}" y1="${CH.padT}" y2="${CH.padT + CH.ph}"/>`
    + CH.set.map(s => `<circle class="dot" r="4.5" cx="${hx}" cy="${CH.Y(CH.ps[i][s.o])}" fill="${SLOTS[s.slot]}"/>`).join('');
  const m = CH.m, tip = $('tip');
  tip.innerHTML = `<div class="t">${new Date(CH.ts[i]).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>`
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
const posKey = (m, o, side) => `${m.id}|${o}|${side}`;
const held = (m, o, side) => S.pos[posKey(m, o, side)]?.n || 0;
function renderTicket() {
  const m = cur(), o = outIdx(m), bd = badge(m, o);
  $('tk-badge').style.background = bd.bg;
  $('tk-badge').textContent = bd.txt;
  $('tk-mkt').textContent = m.kind === 'multi' ? m.title : `${EVENT.short} ${EVENT.year}`;
  $('tk-name').textContent = m.kind === 'multi' ? m.outs[o].name : m.title;
  $('tk-buy').setAttribute('aria-selected', T.mode === 'buy');
  $('tk-sell').setAttribute('aria-selected', T.mode === 'sell');
  const buy = T.mode === 'buy';
  $('tk-lbl').textContent = buy ? 'Amount' : 'Shares';
  $('tk-unit').textContent = buy ? '$' : '#';
  $('tk-amt').step = buy ? '1' : 'any';
  $('tk-quick').innerHTML = (buy ? ['+$1', '+$10', '+$50', 'Max'] : ['25%', '50%', '75%', 'All']).map(q => `<button type="button" data-q="${q}">${q}</button>`).join('');
  updateTicket();
}
function updateTicket() {
  const m = cur(), o = outIdx(m), side = T.side, buy = T.mode === 'buy';
  const p = priceOf(m, o, side), amt = parseFloat($('tk-amt').value) || 0, have = held(m, o, side);
  $('tk-yp').textContent = cents(priceOf(m, o, 'yes'));
  $('tk-np').textContent = cents(priceOf(m, o, 'no'));
  $('tk-y').classList.toggle('on', side === 'yes');
  $('tk-n').classList.toggle('on', side === 'no');
  $('tk-have').textContent = buy ? `Cash ${money(S.cash)}` : `You have ${have.toFixed(2)}`;
  const S_ = side === 'yes' ? 'Yes' : 'No', go = $('tk-go');
  go.classList.toggle('n', side === 'no');
  let warn = '', est = '', ok = false;
  if (buy) {
    if (amt > S.cash + 1e-9) warn = 'Not enough cash.';
    const usd = Math.min(amt, S.cash);
    const n = usd > 0 ? sharesFor(m, o, side, usd) : 0;
    const after = n ? softmax(moved(m, o, side, n).map(x => x / m.b))[o] : null;
    const pa = after == null ? p : side === 'yes' ? after : 1 - after;
    est = `<div><dt>Avg price</dt><span>${n ? (usd / n * 100).toFixed(1) + '¢' : cents(p)}</span></div>`
      + `<div><dt>Shares</dt><span>${n.toFixed(2)}</span></div>`
      + `<div><dt>Price moves</dt><span>${cents(p)} → ${cents(pa)}</span></div>`
      + `<div class="win ${side === 'no' ? 'n' : ''}"><dt>Payout if ${S_}</dt><span style="text-align:right"><b>${money(n)}</b>${n ? `<small>+${money(n - usd)} (${Math.round((n / usd - 1) * 100)}%)</small>` : ''}</span></div>`;
    ok = amt > 0 && !warn;
    go.textContent = amt > 0 ? `Buy ${S_} · ${money(Math.min(amt, S.cash))}` : `Buy ${S_}`;
  } else {
    const pos = S.pos[posKey(m, o, side)];
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
  go.disabled = !ok;
}
$('tk-y').onclick = () => { T.side = 'yes'; updateTicket(); updateMarket(); };
$('tk-n').onclick = () => { T.side = 'no'; updateTicket(); updateMarket(); };
$('tk-buy').onclick = () => { T.mode = 'buy'; $('tk-amt').value = ''; renderTicket(); };
$('tk-sell').onclick = () => { T.mode = 'sell'; $('tk-amt').value = ''; renderTicket(); };
$('tk-amt').addEventListener('input', updateTicket);
$('tk-amt').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('tk-go').disabled) trade(); });
$('tk-quick').addEventListener('click', e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  const q = b.dataset.q, m = cur(), have = held(m, outIdx(m), T.side), v = parseFloat($('tk-amt').value) || 0;
  if (T.mode === 'buy') $('tk-amt').value = q === 'Max' ? Math.floor(S.cash * 100) / 100 : Math.min(Math.floor(S.cash * 100) / 100, v + parseFloat(q.slice(2)));
  else $('tk-amt').value = q === 'All' ? +have.toFixed(4) : +(have * parseFloat(q) / 100).toFixed(2);
  updateTicket();
});
$('tk-go').onclick = trade;

function trade() {
  const m = cur(), o = outIdx(m), side = T.side, amt = parseFloat($('tk-amt').value) || 0;
  const key = posKey(m, o, side), S_ = side === 'yes' ? 'Yes' : 'No', name = label(m, o);
  if (T.mode === 'buy') {
    const usd = Math.min(amt, S.cash); if (usd <= 0) return;
    const n = sharesFor(m, o, side, usd), cost = costOf(m, o, side, n);
    apply(m, o, side, n);
    S.cash = Math.max(0, S.cash - cost);
    const p = S.pos[key] || (S.pos[key] = { m: m.id, o, side, n: 0, cost: 0 });
    p.n += n; p.cost += cost;
    log({ m: m.id, o, side, usd: cost, px: cost / n, mine: true });
    S.mk[m.id].vol += cost;
    toast(`Bought ${n.toFixed(1)} ${S_} · ${name} at ${(cost / n * 100).toFixed(1)}¢`);
  } else {
    const p = S.pos[key]; if (!p) return;
    const n = amt >= p.n - 1e-3 ? p.n : amt; if (n <= 0) return;
    const get = -costOf(m, o, side, -n);
    apply(m, o, side, -n);
    S.cash += get;
    p.cost -= p.cost * n / p.n; p.n -= n;
    if (p.n < 1e-6) { delete S.pos[key]; T.mode = 'buy'; }
    log({ m: m.id, o, side, usd: get, px: get / n, mine: true, sell: true });
    S.mk[m.id].vol += get;
    toast(`Sold ${n.toFixed(1)} ${S_} · ${name} for ${money(get)}`);
  }
  $('tk-amt').value = '';
  save(true);
  refresh();
  renderTicket();
  if (mobile()) setTimeout(closeTicket, 500);
}

/* the ticket as a sheet on phones */
function openTicket() { $('ticket').classList.add('open'); $('scrim').classList.add('on'); setTimeout(() => $('tk-amt').focus({ preventScroll: true }), 350); }
function closeTicket() { $('ticket').classList.remove('open'); $('scrim').classList.remove('on'); }
$('tk-close').onclick = closeTicket;
$('scrim').onclick = closeTicket;
addEventListener('keydown', e => { if (e.key === 'Escape') closeTicket(); });

/* ---------- positions, activity, rules ---------- */
function positionsValue() { let v = 0; for (const p of Object.values(S.pos)) v += p.n * priceOf(byId[p.m], p.o, p.side); return v; }
function renderPositions() {
  const list = Object.entries(S.pos);
  $('pos-n').textContent = list.length;
  const val = positionsValue(), total = S.cash + val, pl = total - START_CASH;
  let h = `<div class="sum"><div><small>Total</small><b>${money(total)}</b></div><div><small>Cash</small><b>${money(S.cash)}</b></div><div><small>In positions</small><b>${money(val)}</b></div><div><small>Profit</small><b class="pl ${pl > .005 ? 'up' : pl < -.005 ? 'down' : ''}">${pl >= 0 ? '+' : ''}${money(pl)}</b></div></div>`;
  if (!list.length) h += `<p class="empty">No positions yet. Pick a team and buy Yes or No.</p>`;
  else {
    h += `<table><thead><tr><th>Contract</th><th>Shares</th><th class="hide-s">Avg → Now</th><th>Value</th><th class="hide-s">P&amp;L</th><th><span class="sr-only">Sell</span></th></tr></thead><tbody>`
      + list.map(([key, p]) => {
        const m = byId[p.m], now = priceOf(m, p.o, p.side), v = p.n * now, d = v - p.cost;
        return `<tr><td><span class="c">${esc(label(m, p.o))}</span> <span class="${p.side === 'yes' ? 'side-y' : 'side-n'}">${p.side === 'yes' ? 'Yes' : 'No'}</span><span class="s">${esc(m.kind === 'multi' ? m.short : m.title)}</span></td>`
          + `<td>${p.n.toFixed(1)}</td><td class="hide-s">${(p.cost / p.n * 100).toFixed(1)}¢ → ${cents(now)}</td><td>${money(v)}</td>`
          + `<td class="hide-s pl ${d > .005 ? 'up' : d < -.005 ? 'down' : ''}">${d >= 0 ? '+' : ''}${money(d)}</td><td><button type="button" class="mini" data-sell="${esc(key)}">Sell</button></td></tr>`;
      }).join('') + '</tbody></table>';
  }
  h += `<button type="button" class="reset" id="reset">Start over with ${whole(START_CASH)}</button>`;
  $('p-pos').innerHTML = h;
  $('port-val').textContent = money(val);
  $('cash').textContent = money(S.cash);
}
$('p-pos').addEventListener('click', e => {
  const s = e.target.closest('[data-sell]');
  if (s) {
    const p = S.pos[s.dataset.sell]; if (!p) return;
    const m = byId[p.m];
    if (m !== V.m) go(m);
    V.sel[m.id] = p.o; T.side = p.side; T.mode = 'sell';
    drawChart(); updateMarket(); renderTicket();
    $('tk-amt').value = +p.n.toFixed(4); updateTicket();
    if (mobile()) openTicket(); else scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (e.target.closest('#reset') && confirm(`Reset your play money to ${whole(START_CASH)} and clear your positions?`)) {
    const keep = S.mk; fresh(); S.mk = keep; seedFeed(); save(true); refresh(); renderTicket();
  }
});
function log(f) {
  S.feed.unshift({ t: Date.now(), ...f });
  if (S.feed.length > 60) S.feed.length = 60;
  renderFeed(true);
}
function renderFeed(isNew) {
  $('feed').innerHTML = S.feed.slice(0, 30).map((f, i) => {
    const m = byId[f.m]; if (!m || f.o >= m.outs.length) return '';
    const sd = f.side === 'yes' ? 'Yes' : 'No';
    return `<li class="${f.mine ? 'mine' : ''} ${isNew && i === 0 ? 'new' : ''}"><span class="what">${f.sell ? 'Sold' : 'Bought'} <span class="${f.side === 'yes' ? 'side-y' : 'side-n'}">${sd}</span> · ${esc(m.kind === 'multi' ? label(m, f.o) : m.short)}</span><span class="usd">${money(f.usd)}</span><span class="meta">${esc(m.short)} · ${ago(f.t)}</span><span class="px">at ${cents(f.px)}</span></li>`;
  }).join('');
}
function renderRules() {
  const m = cur();
  $('p-rules').innerHTML = `<p>${esc(m.rules)}</p><dl><dt>Event</dt><dd>${esc(EVENT.name)} ${EVENT.year}</dd><dt>Contracts</dt><dd>${m.kind === 'multi' ? `${m.outs.length} teams, one Yes/No each` : 'One Yes/No question'}</dd><dt>Pays</dt><dd>$1 a share if right, nothing if wrong</dd><dt>Prices</dt><dd>Set by every trade; Yes and No always add up to $1</dd><dt>Money</dt><dd>Play money, kept in this browser</dd></dl>`;
}
$('t-pos').parentElement.addEventListener('click', e => {
  const b = e.target.closest('[role="tab"]'); if (!b) return;
  for (const t of b.parentElement.children) { const on = t === b; t.setAttribute('aria-selected', on); $(t.getAttribute('aria-controls')).hidden = !on; }
});
$('bal-port').onclick = $('bal-cash').onclick = () => { $('t-pos').click(); $('p-pos').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

/* ---------- other traders (simulated) ---------- */
function pickMarket(r) { const w = M.map(m => m.id === 'champion' ? 4 : m.kind === 'multi' ? 2 : 1), s = w.reduce((a, b) => a + b, 0); let x = r() * s; for (let i = 0; i < M.length; i++) if ((x -= w[i]) < 0) return M[i]; return M[0]; }
function pickOutcome(m, r) { const w = m.p0.map(Math.sqrt), s = w.reduce((a, b) => a + b, 0); let x = r() * s; for (let i = 0; i < w.length; i++) if ((x -= w[i]) < 0) return i; return 0; }
const R = Math.random;
function simTrade() {
  for (const m of M) m.fair = m.fair.map((x, j) => x + gauss(R) * .012 * (m.kind === 'binary' && j ? 0 : 1));
  const m = pickMarket(R), o = m.kind === 'multi' ? pickOutcome(m, R) : 0;
  const f = softmax(m.fair)[o], p = prices(m)[o];
  const side = Math.log(f / p) + gauss(R) * .22 > 0 ? 'yes' : 'no';
  const usd = Math.min(200, Math.max(2, Math.round(Math.exp(Math.log(16) + gauss(R) * .75))));
  const n = sharesFor(m, o, side, usd);
  if (!n) return;
  apply(m, o, side, n);
  S.mk[m.id].vol += usd;
  log({ m: m.id, o, side, usd, px: usd / n });
  save();
  refresh(m);
}
function refresh(changed) {
  updateChips();
  if (!changed || changed === cur()) { updateMarket(); drawChart(); updateTicket(); }
  renderPositions();
}
let simT = 0;
function loop() { simT = setTimeout(() => { if (!document.hidden) simTrade(); loop(); }, 2200 + Math.random() * 2600); }
setInterval(() => { if (!document.hidden) renderFeed(); }, 30e3);

/* ---------- start ---------- */
$('foot').textContent = `${EVENT.name} ${EVENT.year}. A sample field with play money: prices start from our guesses and move with every trade, yours and simulated traders’.`;
renderChips();
renderMarket();
renderPositions();
renderFeed();
loop();
addEventListener('hashchange', () => { const m = byId[location.hash.slice(1)]; if (m && m !== V.m) go(m); });
