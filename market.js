// The markets and their maths, shared by the page (to preview a trade) and the Worker (which makes it).
// Each market is priced by an automated market maker (LMSR): an outcome's price is its share of exp(q / b) over all
// outcomes, so prices always add up to $1 and every trade moves them. "Yes" on outcome o adds n shares of o; "No"
// adds n shares of every other outcome (it pays $1 unless o wins). A binary market is two outcomes, Yes and No,
// always traded through outcome 0.
import { TEAMS, MARKETS } from './data.js';

export const M = MARKETS.map(d => {
  const outs = d.kind === 'multi'
    ? TEAMS.map(t => ({ id: t.id, name: `${t.school} ${t.team}`, school: t.school, team: t.team }))
    : [{ id: 'yes', name: 'Yes' }, { id: 'no', name: 'No' }];
  const raw = d.kind === 'multi' ? TEAMS.map(t => Math.max(.2, +t[d.key] || 1)) : [d.p, 100 - d.p];
  const sum = raw.reduce((a, b) => a + b, 0);
  const p0 = raw.map(x => x / sum);
  // the signature: when a market's outcomes or depth change, it starts over
  return { ...d, outs, p0, sig: outs.map(o => o.id).join(',') + '|' + d.b };
});
export const byId = Object.fromEntries(M.map(m => [m.id, m]));

export const startQ = m => m.p0.map(p => m.b * Math.log(p));
export const softmax = z => { const mx = Math.max(...z), e = z.map(x => Math.exp(x - mx)), s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); };
const lse = (q, b) => { const mx = Math.max(...q) / b; let s = 0; for (const x of q) s += Math.exp(x / b - mx); return b * (mx + Math.log(s)); };
export const prices = (q, b) => softmax(q.map(x => x / b));
export const priceOf = (q, b, o, side) => { const p = prices(q, b)[o]; return side === 'yes' ? p : 1 - p; };
export const moved = (q, o, side, n) => q.map((x, j) => x + ((side === 'yes') === (j === o) ? n : 0));
// what n shares cost (negative n: what selling them pays, as a negative number)
export const costOf = (q, b, o, side, n) => lse(moved(q, o, side, n), b) - lse(q, b);
// how many shares a dollar amount buys
export function sharesFor(q, b, o, side, usd) {
  let lo = 0, hi = usd / Math.max(priceOf(q, b, o, side), 1e-4) + 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (costOf(q, b, o, side, mid) > usd) hi = mid; else lo = mid; }
  return lo;
}
// what a position is worth: what selling it right now would pay. (Valued at the last price instead, a big buy would
// count as an instant profit, since it pushes up the very price it's valued at.)
export const worth = (q, b, o, side, n) => n > 0 ? -costOf(q, b, o, side, -n) : 0;
