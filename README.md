# Resolved

Play-money prediction markets on the National Parliamentary Debate Invitational (NPDI): who wins, who's top seed,
and a few Yes/No questions. Live at https://markets.ivancui211.workers.dev (Cloudflare deploys every push to `main`
in about a minute).

## Putting in the real field
Everything you'd change is in `data.js`:
- `TEAMS`: one line per team: `school`, `team` letter, `p` (its starting chance to win) and `seed` (its chance to be
  top seed after prelims). They don't have to add up to 100; they're scaled.
- `MARKETS`: the markets along the top. `multi` markets have one Yes/No contract per team; `binary` ones are a single
  Yes/No question with `p` = its starting chance in %. `b` is how deep the market is (bigger = a trade moves it less).
- `START_CASH`: the play money each visitor starts with.

Changing a market's teams restarts that market (shares in it are refunded).

## How it works
Each visitor's cash, positions and prices are kept in their own browser, so nobody moves anyone else's prices.
Prices come from an automated market maker (LMSR): Yes and No always add up to $1 and every trade moves them. A few
simulated traders keep prices moving and pull them back toward a slowly drifting fair value. Nothing is real money.

## Running it locally
Serve the folder with any static server, for example `python3 -m http.server 8780`, and open http://localhost:8780.
