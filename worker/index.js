// The Worker in front of the static site. Requests for files are served from the assets without it; it runs for
// /auth/ (sign in with Google) and /api/ (the shared market). The market lives in one Durable Object, so every
// trade is applied one at a time against the one set of prices everyone sees.
import { DurableObject } from 'cloudflare:workers';
import { M, byId, startQ, prices, costOf, sharesFor, moved, worth } from '../market.js';
import { START_CASH } from '../data.js';

const DAY = 864e5, SESSION_DAYS = 30, MIN_TRADE = 1, TRADES_PER_MIN = 20;

/* ---------- helpers ---------- */
const json = (data, status = 200, headers) => {
  const h = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const [k, v] of headers || []) h.append(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
};
const cookies = req => Object.fromEntries((req.headers.get('cookie') || '').split(/;\s*/).filter(c => c.includes('=')).map(c => {
  const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
}));
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const rand = (n = 32) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round4 = p => p.map(x => +x.toFixed(4));
// only ever send people back to the page itself, optionally with a market in the hash
const safeNext = s => /^\/(#[\w-]{0,40})?$/.test(s || '') ? s : '/';
const redirect = (to, setCookies = []) => {
  const h = new Headers({ location: to, 'cache-control': 'no-store' });
  for (const c of setCookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
};
function page(title, msg, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Resolved</title><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/icon.svg"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f3f0;color:#16181f;font:15px/1.5 Inter,system-ui,sans-serif;text-align:center;padding:16px}h1{font:800 26px/1.15 'Inter Tight',Inter,system-ui,sans-serif;margin:0 0 8px}p{color:#5b5e68;margin:0 auto 20px;max-width:44ch}a{display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:6px;background:#111318;color:#fff;text-decoration:none;font-weight:700;font-size:14px}@media (prefers-color-scheme:dark){body{background:#121317;color:#f0efec}p{color:#a5a7ae}a{background:#f0efec;color:#111318}}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(msg)}</p><a href="/">Back to the markets</a></main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
// the claims inside Google's ID token (it came straight from Google over TLS, so its signature needn't be checked)
function claimsOf(idToken) {
  const b64 = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
}
// "Ivan C." from the Google profile: what other players see on the leaderboard and in the activity feed
function shortName(c) {
  const first = (c.given_name || c.name || c.email.split('@')[0]).trim().slice(0, 24);
  const last = (c.family_name || '').trim();
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}
const market = env => env.MARKET.get(env.MARKET.idFromName('main'));

/* ---------- sign in with Google ---------- */
function login(env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return page('Sign-in isn’t set up yet', 'The site’s owner still has to connect Google sign-in. You can look around in the meantime.', 503);
  const state = rand(16), next = safeNext(url.searchParams.get('next'));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/auth/callback', response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account'
  });
  return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q, [cookie('oauth', state + '|' + next, 600)]);
}
async function callback(req, env, url) {
  const [state, next = '/'] = (cookies(req).oauth || '').split('|');
  const clear = cookie('oauth', '', 0);
  if (url.searchParams.get('error')) return redirect(safeNext(next), [clear]); // they cancelled
  if (!state || url.searchParams.get('state') !== state) return page('That sign-in expired', 'Please try signing in again.', 400);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + '/auth/callback', grant_type: 'authorization_code'
    })
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) return page('Couldn’t sign you in', 'Google didn’t confirm the sign-in. Please try again.', 502);
  const c = claimsOf(tok.id_token);
  const okIss = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
  if (!okIss || c.aud !== env.GOOGLE_CLIENT_ID || c.exp * 1000 < Date.now() || !c.email || !(c.email_verified === true || c.email_verified === 'true'))
    return page('Couldn’t sign you in', 'That Google account couldn’t be verified. Please try again.', 403);
  const email = c.email.toLowerCase(), domain = email.split('@')[1];
  const allowed = (env.ALLOWED_DOMAINS || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (allowed.length && !allowed.includes(domain))
    return page('That account can’t play', `Sign in with an account from ${allowed.map(d => '@' + d).join(' or ')}.`, 403);
  const sid = await market(env).signIn({ id: 'g:' + c.sub, email, name: shortName(c) });
  return redirect(safeNext(next), [clear, cookie('sid', sid, SESSION_DAYS * 86400)]);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname, sid = cookies(req).sid;
    try {
      if (path === '/auth/login') return login(env, url);
      if (path === '/auth/callback') return await callback(req, env, url);
      if (path === '/auth/logout' && req.method === 'POST') {
        if (sid) await market(env).signOut(sid);
        return json({ ok: true }, 200, [['set-cookie', cookie('sid', '', 0)]]);
      }
      // local testing only: sign in as anyone, with no Google (needs DEV_LOGIN=1, and only answers on localhost)
      if (path === '/auth/dev' && env.DEV_LOGIN === '1' && ['localhost', '127.0.0.1'].includes(url.hostname)) {
        const email = (url.searchParams.get('email') || 'test@example.com').toLowerCase();
        const sid2 = await market(env).signIn({ id: 'dev:' + email, email, name: url.searchParams.get('name') || 'Test P.' });
        return redirect('/', [cookie('sid', sid2, SESSION_DAYS * 86400)]);
      }
      if (path === '/api/state' && req.method === 'GET')
        return json(await market(env).state(sid, url.searchParams.get('since'), url.searchParams.get('v')));
      if (path === '/api/trade' && req.method === 'POST') {
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) return json({ error: 'Not allowed.' }, 403);
        if (!(req.headers.get('content-type') || '').startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
        const text = await req.text();
        if (text.length > 2000) return json({ error: 'Too big.' }, 413);
        let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'Send JSON.' }, 400); }
        const { status = 200, ...res } = await market(env).trade(sid, body);
        return json(res, status);
      }
      if (path.startsWith('/api/') || path.startsWith('/auth/')) return json({ error: 'Not found.' }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.warn(e);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  }
};

/* ---------- the market ---------- */
export class Market extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.recent = new Map(); // trades per player in the last minute
    ctx.blockConcurrencyWhile(async () => this.setup());
  }
  rows(q, ...args) { return this.sql.exec(q, ...args).toArray(); }
  setup() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, cash REAL, created INTEGER);
      CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, uid TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS markets (id TEXT PRIMARY KEY, sig TEXT, q TEXT, vol REAL, created INTEGER);
      CREATE TABLE IF NOT EXISTS pos (uid TEXT, m TEXT, o INTEGER, side TEXT, n REAL, cost REAL, PRIMARY KEY (uid, m, o, side));
      CREATE TABLE IF NOT EXISTS hist (m TEXT, t INTEGER, p TEXT);
      CREATE INDEX IF NOT EXISTS hist_mt ON hist (m, t);
      CREATE TABLE IF NOT EXISTS feed (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, uid TEXT, who TEXT, m TEXT, o INTEGER, side TEXT, usd REAL, px REAL, sell INTEGER);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER);`);
    const now = Date.now();
    let changed = false;
    for (const m of M) {
      const row = this.rows('SELECT sig FROM markets WHERE id = ?', m.id)[0];
      if (row && row.sig === m.sig) continue;
      // a new market, or its teams changed in data.js: start it over and refund what was held in it
      for (const p of this.rows('SELECT uid, cost FROM pos WHERE m = ?', m.id)) this.sql.exec('UPDATE users SET cash = cash + ? WHERE id = ?', p.cost, p.uid);
      for (const t of ['pos', 'hist', 'feed']) this.sql.exec(`DELETE FROM ${t} WHERE m = ?`, m.id);
      const q = startQ(m);
      this.sql.exec('INSERT OR REPLACE INTO markets (id, sig, q, vol, created) VALUES (?, ?, ?, 0, ?)', m.id, m.sig, JSON.stringify(q), now);
      this.sql.exec('INSERT INTO hist (m, t, p) VALUES (?, ?, ?)', m.id, now, JSON.stringify(round4(prices(q, m.b))));
      changed = true;
    }
    this.mk = {};
    for (const r of this.rows('SELECT id, q, vol, created FROM markets')) this.mk[r.id] = { q: JSON.parse(r.q), vol: r.vol, created: r.created };
    this.v = this.rows("SELECT v FROM meta WHERE k = 'v'")[0]?.v || 0;
    if (changed) this.bump();
    this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
  }
  bump() { this.v++; this.board_ = null; this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('v', ?)", this.v); }

  /* accounts */
  signIn({ id, email, name }) {
    const now = Date.now();
    if (this.rows('SELECT id FROM users WHERE id = ?', id).length) this.sql.exec('UPDATE users SET email = ?, name = ? WHERE id = ?', email, name, id);
    else { this.sql.exec('INSERT INTO users (id, email, name, cash, created) VALUES (?, ?, ?, ?, ?)', id, email, name, START_CASH, now); this.bump(); }
    const sid = rand(32);
    this.sql.exec('INSERT INTO sessions (sid, uid, expires) VALUES (?, ?, ?)', sid, id, now + SESSION_DAYS * DAY);
    return sid;
  }
  signOut(sid) { this.sql.exec('DELETE FROM sessions WHERE sid = ?', sid); }
  user(sid) {
    if (!sid) return null;
    return this.rows('SELECT u.id, u.email, u.name, u.cash FROM sessions s JOIN users u ON u.id = s.uid WHERE s.sid = ? AND s.expires > ?', sid, Date.now())[0] || null;
  }
  me(u) {
    if (!u) return null;
    const pos = this.rows('SELECT m, o, side, n, cost FROM pos WHERE uid = ?', u.id).filter(p => byId[p.m]);
    return { name: u.name, email: u.email, cash: u.cash, pos };
  }

  /* what the page shows: prices, new history, the feed, the leaderboard and (signed in) your account */
  state(sid, since, v) {
    const u = this.user(sid), me = this.me(u);
    if (v != null && v !== '' && +v === this.v) return { v: this.v, same: true, me };
    const t0 = +since || 0, hist = {};
    for (const m of M) {
      let h = this.rows('SELECT t, p FROM hist WHERE m = ? AND t > ? ORDER BY t', m.id, t0).map(r => [r.t, JSON.parse(r.p)]);
      if (!t0 && h.length > 600) { const k = Math.ceil(h.length / 600); h = h.filter((_, i) => i % k === 0 || i === h.length - 1); }
      hist[m.id] = h;
    }
    const feed = this.rows('SELECT id, t, uid, who, m, o, side, usd, px, sell FROM feed ORDER BY id DESC LIMIT 30')
      .filter(f => byId[f.m])
      .map(f => ({ id: f.id, t: f.t, who: f.who, m: f.m, o: f.o, side: f.side, usd: f.usd, px: f.px, sell: !!f.sell, mine: !!u && f.uid === u.id }));
    const markets = Object.fromEntries(M.map(m => [m.id, { q: this.mk[m.id].q, vol: this.mk[m.id].vol }]));
    return { v: this.v, now: Date.now(), markets, hist, feed, board: this.board(u), me };
  }
  board(u) {
    if (!this.board_) {
      const val = {};
      for (const p of this.rows('SELECT uid, m, o, side, n FROM pos')) {
        const m = byId[p.m]; if (!m) continue;
        val[p.uid] = (val[p.uid] || 0) + worth(this.mk[p.m].q, m.b, p.o, p.side, p.n);
      }
      this.board_ = this.rows('SELECT id, name, cash FROM users').map(r => ({ id: r.id, name: r.name, total: r.cash + (val[r.id] || 0) }))
        .sort((a, b) => b.total - a.total);
    }
    const all = this.board_, i = u ? all.findIndex(r => r.id === u.id) : -1;
    return {
      players: all.length,
      top: all.slice(0, 25).map((r, k) => ({ rank: k + 1, name: r.name, total: +r.total.toFixed(2), me: k === i })),
      me: i >= 0 ? { rank: i + 1, total: +all[i].total.toFixed(2) } : null
    };
  }

  /* a trade, checked and applied in one go */
  trade(sid, b) {
    const u = this.user(sid);
    if (!u) return { status: 401, error: 'Sign in to trade.' };
    const now = Date.now(), recent = (this.recent.get(u.id) || []).filter(t => t > now - 60e3);
    if (recent.length >= TRADES_PER_MIN) return { status: 429, error: 'That’s a lot of trades. Wait a minute and try again.' };
    const m = byId[b?.m], o = b?.o, side = b?.side, buy = b?.mode === 'buy', amt = Number(b?.amount);
    if (!m || !Number.isInteger(o) || o < 0 || o >= (m.kind === 'binary' ? 1 : m.outs.length) || !['yes', 'no'].includes(side) || !['buy', 'sell'].includes(b.mode) || !(amt > 0) || !Number.isFinite(amt))
      return { status: 400, error: 'That trade doesn’t make sense.' };
    const mk = this.mk[m.id], key = [u.id, m.id, o, side];
    let n, usd, q, cash;
    if (buy) {
      if (amt < MIN_TRADE) return { status: 400, error: `The smallest trade is $${MIN_TRADE}.` };
      if (amt > u.cash + 1e-6) return { status: 400, error: 'Not enough cash.' };
      const spend = Math.min(amt, u.cash);
      n = sharesFor(mk.q, m.b, o, side, spend);
      usd = costOf(mk.q, m.b, o, side, n);
      if (b.minShares && n < b.minShares) return { status: 409, error: 'The price moved. Check the new price and try again.' };
      q = moved(mk.q, o, side, n); cash = Math.max(0, u.cash - usd);
    } else {
      const p = this.rows('SELECT n, cost FROM pos WHERE uid = ? AND m = ? AND o = ? AND side = ?', ...key)[0];
      if (!p) return { status: 400, error: `You don’t hold any ${side === 'yes' ? 'Yes' : 'No'} shares here.` };
      if (amt > p.n + 1e-3) return { status: 400, error: `You only have ${p.n.toFixed(2)} shares.` };
      n = amt >= p.n - 1e-3 ? p.n : amt;
      usd = -costOf(mk.q, m.b, o, side, -n);
      if (b.minReturn && usd < b.minReturn) return { status: 409, error: 'The price moved. Check the new price and try again.' };
      q = moved(mk.q, o, side, -n); cash = u.cash + usd;
    }
    this.ctx.storage.transactionSync(() => {
      if (buy) this.sql.exec(`INSERT INTO pos (uid, m, o, side, n, cost) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (uid, m, o, side) DO UPDATE SET n = n + excluded.n, cost = cost + excluded.cost`, ...key, n, usd);
      else this.sql.exec('UPDATE pos SET cost = cost * (n - ?) / n, n = n - ? WHERE uid = ? AND m = ? AND o = ? AND side = ?', n, n, ...key);
      this.sql.exec('DELETE FROM pos WHERE n < 1e-6');
      this.sql.exec('UPDATE users SET cash = ? WHERE id = ?', cash, u.id);
      mk.q = q; mk.vol += usd;
      this.sql.exec('UPDATE markets SET q = ?, vol = ? WHERE id = ?', JSON.stringify(q), mk.vol, m.id);
      this.sql.exec('INSERT INTO feed (t, uid, who, m, o, side, usd, px, sell) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', now, u.id, u.name, m.id, o, side, usd, usd / n, buy ? 0 : 1);
      this.sql.exec('DELETE FROM feed WHERE id <= (SELECT MAX(id) FROM feed) - 500');
      // the price history: at most one point a minute per market (the newest is updated), never touching the first
      const p = JSON.stringify(round4(prices(q, m.b)));
      const last = this.rows('SELECT rowid AS r, t FROM hist WHERE m = ? ORDER BY t DESC LIMIT 1', m.id)[0];
      if (last && last.t > now - 60e3 && last.t !== mk.created) this.sql.exec('UPDATE hist SET t = ?, p = ? WHERE rowid = ?', now, p, last.r);
      else this.sql.exec('INSERT INTO hist (m, t, p) VALUES (?, ?, ?)', m.id, now, p);
      this.bump();
    });
    recent.push(now); this.recent.set(u.id, recent);
    return { ok: true, n, usd, state: this.state(sid, b.since) };
  }
}
