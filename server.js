require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nba = require('./models/nba');
const backtest = require('./models/backtest');
const mlb = require('./models/mlb');
const mlbBacktest = require('./models/backtest-mlb');
const nhl = require('./models/nhl');
const nhlBacktest = require('./models/backtest-nhl');

const app = express();
const PORT = process.env.PORT || 8080;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== HELPERS ====================

function buildNameMap(TEAMS, extraMappings) {
  const nameMap = {};
  for (const [abbr, t] of Object.entries(TEAMS)) {
    nameMap[t.name.toLowerCase()] = abbr;
    const parts = t.name.split(' ');
    nameMap[parts[parts.length - 1].toLowerCase()] = abbr;
  }
  if (extraMappings) Object.assign(nameMap, extraMappings);
  return nameMap;
}

function resolveTeam(nameMap, name) {
  const lower = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(nameMap)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

async function fetchOdds(sportKey) {
  if (!ODDS_API_KEY) return [];
  try {
    const fetch = require('node-fetch');
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const resp = await fetch(url);
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function extractBookLine(bk, homeTeam) {
  const bookLine = {};
  (bk.markets || []).forEach(mkt => {
    if (mkt.key === 'spreads') {
      mkt.outcomes.forEach(o => { if (o.name === homeTeam) bookLine.spread = o.point; });
    }
    if (mkt.key === 'h2h') {
      mkt.outcomes.forEach(o => {
        if (o.name === homeTeam) bookLine.homeML = o.price;
        else bookLine.awayML = o.price;
      });
    }
    if (mkt.key === 'totals') {
      mkt.outcomes.forEach(o => { if (o.name === 'Over') bookLine.total = o.point; });
    }
  });
  return bookLine;
}

// ==================== HEALTH ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', timestamp: new Date().toISOString(), sports: ['nba','mlb','nhl'] });
});

// ==================== NBA ENDPOINTS ====================

app.get('/api/model/nba/ratings', (req, res) => {
  try {
    const ratings = nba.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/nba/predict', (req, res) => {
  const { away, home, awayB2B, homeB2B } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const pred = nba.predict(away.toUpperCase(), home.toUpperCase(), { awayB2B: awayB2B === 'true', homeB2B: homeB2B === 'true' });
    if (pred.error) return res.status(400).json(pred);
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/odds/nba', async (req, res) => {
  if (!ODDS_API_KEY) return res.json({ error: 'No API key set', odds: [], mock: true });
  try {
    const data = await fetchOdds('basketball_nba');
    const odds = data.map(game => {
      const bookmakers = {};
      (game.bookmakers || []).forEach(bk => {
        const book = { name: bk.title };
        (bk.markets || []).forEach(mkt => {
          if (mkt.key === 'h2h') { book.homeML = null; book.awayML = null; mkt.outcomes.forEach(o => { if (o.name === game.home_team) book.homeML = o.price; else book.awayML = o.price; }); }
          if (mkt.key === 'spreads') { mkt.outcomes.forEach(o => { if (o.name === game.home_team) book.spread = o.point; }); }
          if (mkt.key === 'totals') { mkt.outcomes.forEach(o => { if (o.name === 'Over') book.total = o.point; }); }
        });
        bookmakers[bk.key] = book;
      });
      return { id: game.id, away: game.away_team, home: game.home_team, commence: game.commence_time, bookmakers };
    });
    res.json({ odds, count: odds.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/value/nba', async (req, res) => {
  try {
    const nameMap = buildNameMap(nba.TEAMS, {
      'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI'
    });
    const liveOdds = await fetchOdds('basketball_nba');
    const valueBets = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const pred = nba.predict(awayAbbr, homeAbbr);
      if (pred.error) continue;
      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        const edges = nba.findValue(pred, bookLine);
        edges.forEach(e => {
          valueBets.push({
            sport: 'NBA', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
            commence: game.commence_time, ...e,
            prediction: { spread: pred.spread, homeWinProb: pred.homeWinProb, awayWinProb: pred.awayWinProb }
          });
        });
      }
    }
    valueBets.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/nba', (req, res) => {
  try { res.json(backtest.runBacktest()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MLB ENDPOINTS ====================

app.get('/api/model/mlb/ratings', (req, res) => {
  try {
    const ratings = mlb.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/predict', (req, res) => {
  const { away, home, awayPitcherEra, awayPitcherFip, homePitcherEra, homePitcherFip } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcherEra) opts.awayPitcherEra = parseFloat(awayPitcherEra);
    if (awayPitcherFip) opts.awayPitcherFip = parseFloat(awayPitcherFip);
    if (homePitcherEra) opts.homePitcherEra = parseFloat(homePitcherEra);
    if (homePitcherFip) opts.homePitcherFip = parseFloat(homePitcherFip);
    const pred = mlb.predict(away.toUpperCase(), home.toUpperCase(), opts);
    if (!pred || pred.error) return res.status(400).json({ error: pred?.error || 'Invalid team code' });
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/odds/mlb', async (req, res) => {
  if (!ODDS_API_KEY) return res.json({ error: 'No API key set', odds: [], mock: true });
  try {
    const data = await fetchOdds('baseball_mlb');
    res.json({ odds: data, count: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/value/mlb', async (req, res) => {
  try {
    const nameMap = buildNameMap(mlb.TEAMS, {
      'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR'
    });
    const liveOdds = await fetchOdds('baseball_mlb');
    const valueBets = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const pred = mlb.predict(awayAbbr, homeAbbr);
      if (!pred || pred.error) continue;

      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        const edges = mlb.findValue(pred, bookLine);
        edges.forEach(e => {
          valueBets.push({
            sport: 'MLB', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
            commence: game.commence_time, ...e,
            prediction: { homeWinProb: pred.homeWinProb, awayWinProb: pred.awayWinProb, total: pred.totalRuns }
          });
        });
      }
    }
    valueBets.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/mlb', (req, res) => {
  try { res.json(mlbBacktest.runBacktest()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NHL ENDPOINTS ====================

app.get('/api/model/nhl/ratings', (req, res) => {
  try {
    const ratings = nhl.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/nhl/predict', (req, res) => {
  const { away, home, awayGoalie, homeGoalie } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const pred = nhl.predict(away.toUpperCase(), home.toUpperCase(), {
      awayGoalie: awayGoalie || 'starter', homeGoalie: homeGoalie || 'starter'
    });
    if (!pred) return res.status(400).json({ error: 'Invalid team code' });
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/odds/nhl', async (req, res) => {
  if (!ODDS_API_KEY) return res.json({ error: 'No API key set', odds: [], mock: true });
  try {
    const data = await fetchOdds('icehockey_nhl');
    res.json({ odds: data, count: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/value/nhl', async (req, res) => {
  try {
    const nameMap = buildNameMap(nhl.TEAMS, {
      'utah hockey club': 'ARI', 'golden knights': 'VGK', 'blue jackets': 'CBJ',
      'maple leafs': 'TOR', 'red wings': 'DET', 'blackhawks': 'CHI'
    });
    const liveOdds = await fetchOdds('icehockey_nhl');
    const valueBets = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const pred = nhl.predict(awayAbbr, homeAbbr);
      if (!pred) continue;

      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        // NHL value detection: compare model ML probabilities to book
        const bookHomeProb = bookLine.homeML ? (bookLine.homeML < 0 ? (-bookLine.homeML) / (-bookLine.homeML + 100) : 100 / (bookLine.homeML + 100)) : null;
        const bookAwayProb = bookLine.awayML ? (bookLine.awayML < 0 ? (-bookLine.awayML) / (-bookLine.awayML + 100) : 100 / (bookLine.awayML + 100)) : null;
        const modelHomeProb = pred.home.winProb / 100;
        const modelAwayProb = pred.away.winProb / 100;

        if (bookHomeProb !== null) {
          const homeEdge = modelHomeProb - bookHomeProb;
          if (homeEdge > 0.02) {
            valueBets.push({
              sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
              commence: game.commence_time,
              pick: `${homeAbbr} ML (${bookLine.homeML > 0 ? '+' : ''}${bookLine.homeML})`,
              market: 'moneyline', side: 'home',
              modelProb: +(modelHomeProb * 100).toFixed(1), bookProb: +(bookHomeProb * 100).toFixed(1),
              edge: +(homeEdge * 100).toFixed(1), ml: bookLine.homeML,
              confidence: homeEdge >= 0.08 ? 'HIGH' : homeEdge >= 0.05 ? 'MEDIUM' : 'LOW'
            });
          }
        }
        if (bookAwayProb !== null) {
          const awayEdge = modelAwayProb - bookAwayProb;
          if (awayEdge > 0.02) {
            valueBets.push({
              sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
              commence: game.commence_time,
              pick: `${awayAbbr} ML (${bookLine.awayML > 0 ? '+' : ''}${bookLine.awayML})`,
              market: 'moneyline', side: 'away',
              modelProb: +(modelAwayProb * 100).toFixed(1), bookProb: +(bookAwayProb * 100).toFixed(1),
              edge: +(awayEdge * 100).toFixed(1), ml: bookLine.awayML,
              confidence: awayEdge >= 0.08 ? 'HIGH' : awayEdge >= 0.05 ? 'MEDIUM' : 'LOW'
            });
          }
        }
        // Total edge
        if (bookLine.total && pred.projTotal) {
          const totalDiff = Math.abs(pred.projTotal - bookLine.total);
          if (totalDiff >= 0.5) {
            const side = pred.projTotal > bookLine.total ? 'Over' : 'Under';
            valueBets.push({
              sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
              commence: game.commence_time,
              pick: `${side} ${bookLine.total}`, market: 'total', side: side.toLowerCase(),
              edge: +(totalDiff.toFixed(1)),
              confidence: totalDiff >= 1.0 ? 'HIGH' : totalDiff >= 0.7 ? 'MEDIUM' : 'LOW'
            });
          }
        }
      }
    }
    valueBets.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/nhl', (req, res) => {
  try { res.json(nhlBacktest.runBacktest()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== COMBINED ====================

app.get('/api/value/all', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      fetch_value_bets('nba'), fetch_value_bets('mlb'), fetch_value_bets('nhl')
    ]);
    const all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });
    all.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets: all, count: all.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Internal helpers for combined endpoint
async function fetch_value_bets(sport) {
  const bets = [];
  if (sport === 'nba') {
    const nameMap = buildNameMap(nba.TEAMS, { 'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI' });
    const liveOdds = await fetchOdds('basketball_nba');
    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const pred = nba.predict(awayAbbr, homeAbbr);
      if (pred.error) continue;
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        nba.findValue(pred, bookLine).forEach(e => {
          bets.push({ sport: 'NBA', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time, ...e });
        });
      }
    }
  } else if (sport === 'mlb') {
    const nameMap = buildNameMap(mlb.TEAMS, { 'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR' });
    const liveOdds = await fetchOdds('baseball_mlb');
    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const pred = mlb.predict(awayAbbr, homeAbbr);
      if (!pred || pred.error) continue;
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        mlb.findValue(pred, bookLine).forEach(e => {
          bets.push({ sport: 'MLB', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time, ...e });
        });
      }
    }
  } else if (sport === 'nhl') {
    const nameMap = buildNameMap(nhl.TEAMS, { 'utah hockey club': 'ARI', 'golden knights': 'VGK', 'blue jackets': 'CBJ', 'maple leafs': 'TOR', 'red wings': 'DET', 'blackhawks': 'CHI' });
    const liveOdds = await fetchOdds('icehockey_nhl');
    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const pred = nhl.predict(awayAbbr, homeAbbr);
      if (!pred) continue;
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        const bookHomeProb = bookLine.homeML ? (bookLine.homeML < 0 ? (-bookLine.homeML) / (-bookLine.homeML + 100) : 100 / (bookLine.homeML + 100)) : null;
        const bookAwayProb = bookLine.awayML ? (bookLine.awayML < 0 ? (-bookLine.awayML) / (-bookLine.awayML + 100) : 100 / (bookLine.awayML + 100)) : null;
        if (bookHomeProb !== null && (pred.home.winProb / 100 - bookHomeProb) > 0.02) {
          const edge = pred.home.winProb / 100 - bookHomeProb;
          bets.push({ sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time,
            pick: `${homeAbbr} ML`, market: 'moneyline', edge: +(edge * 100).toFixed(1), confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW'
          });
        }
        if (bookAwayProb !== null && (pred.away.winProb / 100 - bookAwayProb) > 0.02) {
          const edge = pred.away.winProb / 100 - bookAwayProb;
          bets.push({ sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time,
            pick: `${awayAbbr} ML`, market: 'moneyline', edge: +(edge * 100).toFixed(1), confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW'
          });
        }
      }
    }
  }
  return bets;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 SportsSim v3.0 running on port ${PORT}`);
  console.log(`   Odds API: ${ODDS_API_KEY ? 'configured' : 'NOT SET (set ODDS_API_KEY env var)'}`);
  console.log(`   NBA teams: ${Object.keys(nba.TEAMS).length}`);
  console.log(`   MLB teams: ${Object.keys(mlb.TEAMS).length}`);
  console.log(`   NHL teams: ${Object.keys(nhl.TEAMS).length}`);
});
