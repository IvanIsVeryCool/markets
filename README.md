# Parli Market

Play-money prediction markets on the National Parliamentary Debate Invitational (NPDI): who wins, who's top seed,
and a few Yes/No questions. One shared market: everyone trades the same prices, and a leaderboard ranks players.
You sign in with Google to trade; each Google account gets $1,000 of play money once.

Live at https://markets.ivancui211.workers.dev (Cloudflare deploys every push to `main` in about a minute).

## Turning on Google sign-in (once)
Until this is done the site works, but the sign-in button says sign-in isn't set up yet.

1. Go to https://console.cloud.google.com, sign in, and create a project (top bar → project picker → New project),
   named for example "Parli Market".
2. Open **Google Auth Platform** (search for "OAuth consent screen") → **Get started**: app name "Parli Market", your
   email as the support email, audience **External**, your email as the contact → Create.
3. **Audience** → **Publish app** (so anyone can sign in, not only test users). The site only asks for name and
   email, so Google doesn't need to review it.
4. **Clients** → **Create client** → type **Web application**, name "Parli Market". Under **Authorized redirect URIs**
   add exactly `https://markets.ivancui211.workers.dev/auth/callback` → Create. Copy the **Client ID** and
   **Client secret**.
5. In Cloudflare: Workers & Pages → **markets** → Settings → **Variables and Secrets** → Add, type **Secret**:
   - `GOOGLE_CLIENT_ID`: the client ID
   - `GOOGLE_CLIENT_SECRET`: the client secret
   - optional, `ALLOWED_DOMAINS`: e.g. `nuevaschool.org` to let only those email addresses play (several:
     separate them with commas). This is the strongest guard against one person making many accounts.

   Save (it redeploys by itself).

## Putting in the real field
Everything you'd change is in `data.js`:
- `TEAMS`: one line per team: `school`, `team` letter, `p` (its starting chance to win) and `seed` (its chance to be
  top seed after prelims). They don't have to add up to 100; they're scaled.
- `MARKETS`: the markets along the top. `multi` markets have one Yes/No contract per team; `binary` ones are a single
  Yes/No question with `p` = its starting chance in %. `b` is how deep the market is (bigger = a trade moves it less).
- `START_CASH`: the play money each new account starts with.

The starting chances only matter when a market starts. **Changing a market's teams (or its `b`) restarts it for
everyone**: its prices go back to the starting chances, its history and trades are wiped, and what people paid for
shares in it is refunded. Do it before people start trading, or on purpose.

## How it works
- **The page** (`index.html`, `app.js`) reads the market from `/api/state` every 5 seconds and sends trades to
  `/api/trade`.
- **The server** (`worker/index.js`) handles sign-in and the API. The market itself (prices, accounts, positions,
  history, trades) lives in one Cloudflare Durable Object with its own database, so every trade is applied one at a
  time against the one set of prices.
- **Prices** come from an automated market maker (LMSR, `market.js`, shared by the page and the server): Yes and No
  always add up to $1 and every trade moves them.
- **Against bots and cheating:** trading needs a signed-in Google account (one $1,000 each); trades are checked on
  the server (enough cash, $1 minimum, 20 trades a minute per player); an order is refused if the price moved more
  than 3% since you looked; positions count on the leaderboard at what they'd sell for now, so a big buy can't pump
  your own score.

## Running it locally
`npx wrangler@4 dev --var DEV_LOGIN:1`, then open http://localhost:8787. Google sign-in won't work locally;
`/auth/dev?email=you@example.com&name=You` signs you in as anyone (only with `DEV_LOGIN=1`, and only on localhost).
