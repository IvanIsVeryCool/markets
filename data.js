/* =====================================================================
   THE FIELD AND THE MARKETS: the only part you should need to edit
   ===================================================================== */
// The tournament.
export const EVENT = { short: 'NPDI', name: 'National Parliamentary Debate Invitational', year: 2026 };

// The teams going in. `p` is each team's starting chance to win (they're scaled to add up to 100%),
// `seed` its chance to be top seed after prelims. A sample field (made-up odds) until the real qualifiers are in.
export const TEAMS = [
  { id: 'nueva-a', school: 'Nueva', team: 'A', p: 16, seed: 15 },
  { id: 'harker-a', school: 'Harker', team: 'A', p: 13, seed: 14 },
  { id: 'menlo-a', school: 'Menlo', team: 'A', p: 9, seed: 10 },
  { id: 'bellarmine-a', school: 'Bellarmine', team: 'A', p: 8, seed: 9 },
  { id: 'nueva-b', school: 'Nueva', team: 'B', p: 7, seed: 6 },
  { id: 'gunn-a', school: 'Gunn', team: 'A', p: 7, seed: 7 },
  { id: 'leland-a', school: 'Leland', team: 'A', p: 6, seed: 6 },
  { id: 'lynbrook-a', school: 'Lynbrook', team: 'A', p: 6, seed: 5 },
  { id: 'campolindo-a', school: 'Campolindo', team: 'A', p: 5, seed: 5 },
  { id: 'msj-a', school: 'Mission San Jose', team: 'A', p: 5, seed: 5 },
  { id: 'saratoga-a', school: 'Saratoga', team: 'A', p: 4, seed: 4 },
  { id: 'montavista-a', school: 'Monta Vista', team: 'A', p: 4, seed: 4 },
  { id: 'shp-a', school: 'Sacred Heart Prep', team: 'A', p: 3, seed: 3 },
  { id: 'miramonte-a', school: 'Miramonte', team: 'A', p: 3, seed: 3 },
  { id: 'headroyce-a', school: 'Head-Royce', team: 'A', p: 2, seed: 2 },
  { id: 'lick-a', school: 'Lick-Wilmerding', team: 'A', p: 2, seed: 2 }
];

// The markets. `multi`: one contract per team, exactly one wins. `binary`: a single Yes/No question, `p` its
// starting chance in %. `b` is how deep the market is: bigger means a trade moves the price less.
export const MARKETS = [
  { id: 'champion', kind: 'multi', short: 'Champion', title: `Who will win ${EVENT.short} ${EVENT.year}?`, key: 'p', b: 800, vol: 48210,
    rules: 'Each team’s contract pays $1 if that team wins the final round, and nothing otherwise.' },
  { id: 'topseed', kind: 'multi', short: 'Top seed', title: 'Who will be top seed after prelims?', key: 'seed', b: 600, vol: 17940,
    rules: 'Pays $1 for the team ranked first when the preliminary rounds end (record, then speaker points).' },
  { id: 'seed-wins', kind: 'binary', short: 'Top seed wins', title: 'Will the top seed win the tournament?', p: 24, b: 500, vol: 21385,
    rules: 'Yes if the team seeded first going into elimination rounds wins the final.' },
  { id: 'closeout', kind: 'binary', short: 'Closeout', title: 'Will both finalists come from the same school?', p: 7, b: 400, vol: 6120,
    rules: 'Yes if the two teams in the final round are from the same school.' },
  { id: 'unseeded', kind: 'binary', short: 'Upset', title: 'Will a team seeded outside the top 4 win?', p: 41, b: 500, vol: 9870,
    rules: 'Yes if the champion was seeded 5th or lower going into elimination rounds.' },
  { id: 'final-30', kind: 'binary', short: '3–0 final', title: 'Will the final be a unanimous decision?', p: 38, b: 450, vol: 5230,
    rules: 'Yes if every judge on the final round’s panel votes for the winner.' }
];

// Play money each visitor starts with.
export const START_CASH = 1000;
/* ===================================================================== */
