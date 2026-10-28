# Parli Market: project notes

Play-money prediction markets on NPDI (the National Parliamentary Debate Invitational), Kalshi-style, shared by
everyone who signs in with Google.
Owner: Ivan Cui (GitHub `IvanIsVeryCool`). An independent project: no ties to the owner's other sites, so no
Nueva or Spirit Cabinet branding.

## Hosting
Cloudflare Workers (`wrangler.jsonc`, Worker `markets`, connected to this repo's `main`):
https://markets.ivancui211.workers.dev. No build step, no npm dependencies; push to `main` and it deploys.
Files are served from the assets; the Worker (`worker/index.js`) runs first for `/api/*` and `/auth/*`
(`run_worker_first`). `.assetsignore` keeps the repo-only files (and `worker/`) off the site; `404.html` is the
not-found page. Secrets (dashboard → markets → Settings → Variables and Secrets, all type Secret, so deploys don't
overwrite them): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `ALLOWED_DOMAINS`. README has the Google Cloud
steps; the OAuth client's redirect URI is `https://markets.ivancui211.workers.dev/auth/callback`.
**Workflow:** push changes live: commit to `main` and push once a change is done and checked.

## How it works
- **One shared market** (the owner asked for it so it can't be botted): the `Market` Durable Object (SQLite, one
  instance, `idFromName('main')`, migration `v1`) holds `users` (id `g:<google sub>`, email, short name, cash),
  `sessions` (30 days, cookie `sid`: HttpOnly, Secure, SameSite=Lax), `markets` (q, volume, created), `pos`,
  `hist` (at most one point a minute per market: the newest is updated, the first never), `feed` (last 500) and
  `meta.v` (bumped on every change; `/api/state?v=` answers `{ same: true, me }` when nothing changed, and
  `since=` sends only newer history points). On start it compares each market's `sig` (outcome ids + `b`) with
  `data.js` and restarts changed ones, refunding positions' cost.
- **Sign-in** (`/auth/login` → Google → `/auth/callback`): the code is exchanged server-side; the ID token comes
  straight from Google over TLS, so its claims are read without checking the signature (aud, iss, exp,
  email_verified are checked). Players appear as "First L." (`shortName()`); emails are only ever sent to their owner.
  `/auth/dev` signs in as anyone for local testing, only with `DEV_LOGIN=1` and only on localhost.
- **Trades** (`POST /api/trade`, JSON only, same origin): checked in the Durable Object (signed in, valid market and
  outcome, $1 minimum, enough cash or shares, 20 a minute per player in memory, `minShares`/`minReturn` from the
  ticket less 3%, else 409 "The price moved"), applied in one `transactionSync`.
- **Valuation:** positions count at what selling them now would pay (`worth()` in `market.js`), on the leaderboard
  and in the portfolio; at the last price, a big buy in a thin market would count as instant profit.
- **The page** polls `/api/state` every 5 s (30 s in a background tab, backing off on errors), previews trades with the
  same maths, and draws the history as steps. Signed out, everything is visible and the ticket's button signs in.

## Files
| File | What it does |
|---|---|
| `index.html` | The page and all its CSS (light and dark): top bar (the mark and "Parli Market"; signed in: Portfolio, Cash and an account menu with Sign out; signed out: "Sign in with Google"), market chips, the market card (icon, head, headline number for Yes/No markets, legend, chart, ranges, contracts), the Positions / Leaderboard / Activity / Rules tabs, the order ticket (a bottom sheet under 920 px). |
| `app.js` | The page's logic: polling and merging the server's state, the chart (SVG steps; the top three teams at page load keep their colours for the visit and the selected team takes the fourth; crosshair and tooltip), the contracts list, the ticket and sending trades, positions, leaderboard, activity, the account menu. The URL hash picks the market (`#champion`). |
| `market.js` | Shared by the page and the Worker: the markets built from `data.js` (`M`, `byId`, each with `outs`, `p0`, `sig`) and the LMSR maths (`prices`, `priceOf`, `moved`, `costOf`, `sharesFor`, `worth`, `startQ`). |
| `worker/index.js` | The Worker (sign-in, `/api/state`, `/api/trade`, everything else to the assets) and the `Market` Durable Object. |
| `data.js` | The editable part: `EVENT`, `TEAMS`, `MARKETS`, `START_CASH`. The field is a **sample** (real Bay Area schools, made-up odds, no student names) until the owner sends the real qualifiers. |
| `icon.svg`, `favicon-64.png`, `apple-touch-icon.png` | The mark (three rising bars, the last one green, on a dark rounded square) and its PNG renders. |
| `share.jpg` | The link preview (1200 × 630, a render of the page). `og:image` must stay an absolute URL. |

## Design
Inter (text) and Inter Tight (display); ink `#111318` for the brand; Yes green, No violet; up green, down red.
Corners 6 px (4 px for chips). Chart colours are a validated four-slot categorical palette (blue, orange, aqua,
yellow) with their dark-mode steps. No pills, glows or bouncing; only the necessary text.

## Testing
`npx wrangler@4 dev --port 8781 --var DEV_LOGIN:1` (local Durable Object data in `.wrangler/`, git-ignored; delete
`.wrangler/state` for a fresh market), sign in with `/auth/dev?email=...&name=...`, and drive it with Playwright:
load at 1280×800 and 390×844 signed out and in, buy and sell, a second player's trade showing up within a poll,
the leaderboard, sign out; check for console errors and sideways scrolling, and look at the screenshots. Check the
API's refusals with curl too (signed out 401, not enough cash, under $1, a moved price 409, a form post 415, another
origin 403, the rate limit 429). Add `--var GOOGLE_CLIENT_ID:x --var GOOGLE_CLIENT_SECRET:y` to check
`/auth/login`'s redirect. Careful: `pkill -f` in the same command as what it should kill matches itself. In the Claude sandbox, launch
Chromium with `proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }` and
`ignoreHTTPSErrors` so Google Fonts load.
