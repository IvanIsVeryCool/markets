# Resolved: project notes

Play-money prediction markets on NPDI (the National Parliamentary Debate Invitational), Kalshi-style.
Owner: Ivan Cui (GitHub `IvanIsVeryCool`). An independent project: no ties to the owner's other sites, so no
Nueva or Spirit Cabinet branding.

## Hosting
Cloudflare Workers, static assets only (`wrangler.jsonc`, Worker `markets`, connected to this repo's `main`):
https://markets.ivancui211.workers.dev. No build step, no npm dependencies; push to `main` and it deploys.
`.assetsignore` keeps the repo-only files off the site; `404.html` is the not-found page.
**Workflow:** push changes live: commit to `main` and push once a change is done and checked.

## Files
| File | What it does |
|---|---|
| `index.html` | The page and all its CSS (light and dark): top bar (the mark and "Resolved", Portfolio and Cash), market chips, the market card (icon, head, headline number for Yes/No markets, legend, chart, ranges, contracts), the Positions / Activity / Rules tabs, the order ticket (a bottom sheet under 920 px). |
| `app.js` | Everything else: the market maker (LMSR: price = softmax(q / b); "Yes" on o adds shares of o, "No" adds shares of every other outcome; `sharesFor()` bisects the shares a dollar amount buys), saved state (`localStorage['resolved-v1']`: cash, positions, each market's q, volume and price history, the feed), the made-up past (`pastPrices()`: a seeded random walk in log-odds run backwards from today's prices, dense near now), the chart (SVG; the top three teams at page load keep their colours for the visit and the selected team takes the fourth; crosshair and tooltip), the contracts list, the ticket, positions, the activity feed and the simulated traders (every 2.2–4.8 s while the tab is visible, toward a fair value that drifts). The URL hash picks the market (`#champion`). |
| `data.js` | The editable part: `EVENT`, `TEAMS`, `MARKETS`, `START_CASH`. The field is a **sample** (real Bay Area schools, made-up odds, no student names) until the owner sends the real qualifiers. |
| `icon.svg`, `favicon-64.png`, `apple-touch-icon.png` | The mark (three rising bars, the last one green, on a dark rounded square) and its PNG renders. |
| `share.jpg` | The link preview (1200 × 630, a render of the page). `og:image` must stay an absolute URL. |

## Design
Inter (text) and Inter Tight (display); ink `#111318` for the brand; Yes green, No violet; up green, down red.
Corners 6 px (4 px for chips). Chart colours are a validated four-slot categorical palette (blue, orange, aqua,
yellow) with their dark-mode steps. No pills, glows or bouncing; only the necessary text.

## Testing
Serve the folder (`python3 -m http.server 8780`) and drive it with Playwright: load at 1280×800 and 390×844, buy and
sell, check for console errors and sideways scrolling, and look at the screenshots. In the Claude sandbox, launch
Chromium with `proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }` and
`ignoreHTTPSErrors` so Google Fonts load.
