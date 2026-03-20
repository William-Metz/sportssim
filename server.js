require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nba = require('./models/nba');
const backtest = require('./models/backtest');
const mlb = require('./models/mlb');
const mlbPitchers = require('./models/mlb-pitchers');
const mlbBacktest = require('./models/backtest-mlb');
const mlbOpeningDay = require('./models/mlb-opening-day');
const nhl = require('./models/nhl');
const nhlBacktest = require('./models/backtest-nhl');
const liveData = require('./services/live-data');

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
  res.json({ status: 'ok', version: '6.0.0', timestamp: new Date().toISOString(), sports: ['nba','mlb','nhl'], features: ['live-data','pitcher-model','poisson-totals','matchup-analysis','opening-day'] });
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
  const { away, home, awayPitcher, homePitcher, awayPitcherEra, awayPitcherFip, homePitcherEra, homePitcherFip } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    // New: pitcher name lookup
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    // Legacy: raw ERA/FIP
    if (awayPitcherEra) opts.awayPitcherEra = parseFloat(awayPitcherEra);
    if (awayPitcherFip) opts.awayPitcherFip = parseFloat(awayPitcherFip);
    if (homePitcherEra) opts.homePitcherEra = parseFloat(homePitcherEra);
    if (homePitcherFip) opts.homePitcherFip = parseFloat(homePitcherFip);
    const pred = mlb.predict(away.toUpperCase(), home.toUpperCase(), opts);
    if (!pred || pred.error) return res.status(400).json({ error: pred?.error || 'Invalid team code' });
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MLB Pitcher Endpoints
app.get('/api/model/mlb/pitchers', (req, res) => {
  try {
    const team = req.query.team;
    if (team) {
      const rotation = mlbPitchers.getTeamRotation(team.toUpperCase());
      if (!rotation) return res.status(404).json({ error: `No rotation found for ${team}` });
      return res.json({ team: team.toUpperCase(), rotation, count: rotation.length });
    }
    const all = mlbPitchers.getAllPitchers();
    res.json({ pitchers: all, count: all.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/pitchers/top', (req, res) => {
  try {
    const n = parseInt(req.query.n) || 30;
    const top = mlbPitchers.getTopPitchers(n);
    res.json({ pitchers: top, count: top.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/pitchers/:team', (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const rotation = mlbPitchers.getTeamRotation(team);
    if (!rotation) return res.status(404).json({ error: `No rotation found for ${team}` });
    res.json({ team, rotation, count: rotation.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/matchup', (req, res) => {
  const { away, home, awayPitcher, homePitcher } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    const matchup = mlb.analyzeMatchup(away.toUpperCase(), home.toUpperCase(), opts);
    if (!matchup || matchup.error) return res.status(400).json({ error: matchup?.error || 'Invalid team code' });
    res.json(matchup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/totals', (req, res) => {
  const { away, home, awayPitcher, homePitcher } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    const totals = mlb.predictTotal(away.toUpperCase(), home.toUpperCase(), opts);
    if (!totals || totals.error) return res.status(400).json({ error: totals?.error || 'Invalid team code' });
    res.json(totals);
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

// ==================== MLB OPENING DAY ====================

app.get('/api/model/mlb/opening-day', async (req, res) => {
  try {
    const projections = mlbOpeningDay.getProjections();
    
    // Try to fetch live MLB odds for edge comparison
    let liveOdds = [];
    try {
      liveOdds = await fetchOdds('baseball_mlb');
    } catch (e) { /* no odds available yet */ }
    
    // Match live odds to Opening Day games
    if (liveOdds.length > 0) {
      const nameMap = buildNameMap(mlb.TEAMS, {
        'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR'
      });
      
      for (const game of projections.games) {
        // Find matching odds game
        for (const oddsGame of liveOdds) {
          const oddsAway = resolveTeam(nameMap, oddsGame.away_team);
          const oddsHome = resolveTeam(nameMap, oddsGame.home_team);
          if (oddsAway === game.away && oddsHome === game.home) {
            // Extract best lines
            const books = {};
            let bestHomeML = null, bestAwayML = null, bestTotal = null;
            let bestHomeBook = '', bestAwayBook = '', bestTotalBook = '';
            
            for (const bk of (oddsGame.bookmakers || [])) {
              const line = extractBookLine(bk, oddsGame.home_team);
              books[bk.title] = line;
              
              if (line.homeML && (bestHomeML === null || line.homeML > bestHomeML)) {
                bestHomeML = line.homeML; bestHomeBook = bk.title;
              }
              if (line.awayML && (bestAwayML === null || line.awayML > bestAwayML)) {
                bestAwayML = line.awayML; bestAwayBook = bk.title;
              }
              if (line.total && !bestTotal) {
                bestTotal = line.total; bestTotalBook = bk.title;
              }
            }
            
            // Calculate edges
            game.liveOdds = {
              books,
              bestHome: { ml: bestHomeML, book: bestHomeBook },
              bestAway: { ml: bestAwayML, book: bestAwayBook },
              bestTotal: { total: bestTotal, book: bestTotalBook }
            };
            
            if (bestHomeML) {
              const impliedHome = bestHomeML < 0 ? (-bestHomeML) / (-bestHomeML + 100) : 100 / (bestHomeML + 100);
              game.liveOdds.homeEdge = +(game.prediction.homeWinProb - impliedHome).toFixed(3);
            }
            if (bestAwayML) {
              const impliedAway = bestAwayML < 0 ? (-bestAwayML) / (-bestAwayML + 100) : 100 / (bestAwayML + 100);
              game.liveOdds.awayEdge = +(game.prediction.awayWinProb - impliedAway).toFixed(3);
            }
            
            break;
          }
        }
      }
    }
    
    res.json(projections);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// ==================== TODAY'S GAMES ENDPOINT ====================

const oddsCache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getAllOdds() {
  if (oddsCache.data && (Date.now() - oddsCache.ts) < CACHE_TTL) return oddsCache.data;
  const sports = [
    { key: 'basketball_nba', sport: 'NBA', model: nba, extra: { 'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI' } },
    { key: 'baseball_mlb', sport: 'MLB', model: mlb, extra: { 'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR' } },
    { key: 'icehockey_nhl', sport: 'NHL', model: nhl, extra: { 'utah hockey club': 'UTA', 'golden knights': 'VGK', 'blue jackets': 'CBJ', 'maple leafs': 'TOR', 'red wings': 'DET', 'blackhawks': 'CHI' } }
  ];
  const allGames = [];
  for (const s of sports) {
    try {
      const odds = await fetchOdds(s.key);
      const nameMap = buildNameMap(s.model.TEAMS, s.extra);
      for (const game of odds) {
        const awayAbbr = resolveTeam(nameMap, game.away_team);
        const homeAbbr = resolveTeam(nameMap, game.home_team);
        // Get model prediction
        let pred = null;
        try {
          if (s.sport === 'NBA') pred = nba.predict(awayAbbr || 'UNK', homeAbbr || 'UNK');
          else if (s.sport === 'MLB') pred = mlb.predict(awayAbbr || 'UNK', homeAbbr || 'UNK');
          else if (s.sport === 'NHL') pred = nhl.predict(awayAbbr || 'UNK', homeAbbr || 'UNK');
        } catch (e) { /* skip */ }
        if (pred && pred.error) pred = null;
        // Extract all bookmaker lines
        const books = {};
        let bestHomeML = null, bestAwayML = null, bestHomeBook = '', bestAwayBook = '';
        for (const bk of (game.bookmakers || [])) {
          const line = extractBookLine(bk, game.home_team);
          // Also extract away ML name
          (bk.markets || []).forEach(mkt => {
            if (mkt.key === 'h2h') {
              mkt.outcomes.forEach(o => {
                if (o.name !== game.home_team) line.awayML = o.price;
              });
            }
          });
          books[bk.title] = line;
          // Track best lines
          if (line.homeML && (bestHomeML === null || line.homeML > bestHomeML)) {
            bestHomeML = line.homeML; bestHomeBook = bk.title;
          }
          if (line.awayML && (bestAwayML === null || line.awayML > bestAwayML)) {
            bestAwayML = line.awayML; bestAwayBook = bk.title;
          }
        }
        // Calculate edges
        let homeEdge = null, awayEdge = null;
        if (pred) {
          const modelHomeProb = s.sport === 'NHL' ? (pred.home?.winProb || 50) / 100 : (pred.homeWinProb || pred.home?.winProb || 50) / 100;
          const modelAwayProb = 1 - modelHomeProb;
          if (bestHomeML !== null) {
            const impliedHome = bestHomeML < 0 ? (-bestHomeML) / (-bestHomeML + 100) : 100 / (bestHomeML + 100);
            homeEdge = +((modelHomeProb - impliedHome) * 100).toFixed(1);
          }
          if (bestAwayML !== null) {
            const impliedAway = bestAwayML < 0 ? (-bestAwayML) / (-bestAwayML + 100) : 100 / (bestAwayML + 100);
            awayEdge = +((modelAwayProb - impliedAway) * 100).toFixed(1);
          }
        }
        allGames.push({
          sport: s.sport,
          away: awayAbbr || game.away_team,
          home: homeAbbr || game.home_team,
          awayFull: game.away_team,
          homeFull: game.home_team,
          commence: game.commence_time,
          prediction: pred ? {
            homeWinProb: +(pred.homeWinProb || pred.home?.winProb || 50).toFixed(1),
            awayWinProb: +(pred.awayWinProb || pred.away?.winProb || 50).toFixed(1),
            spread: pred.spread || pred.home?.spread || null,
            total: pred.total || null
          } : null,
          books,
          bestLine: {
            home: { ml: bestHomeML, book: bestHomeBook },
            away: { ml: bestAwayML, book: bestAwayBook }
          },
          edge: {
            home: homeEdge,
            away: awayEdge,
            best: Math.max(homeEdge || 0, awayEdge || 0),
            pick: (homeEdge || 0) > (awayEdge || 0) ? (homeAbbr || game.home_team) : (awayAbbr || game.away_team),
            pickSide: (homeEdge || 0) > (awayEdge || 0) ? 'home' : 'away'
          }
        });
      }
    } catch (e) { console.error(`Error fetching ${s.sport}:`, e.message); }
  }
  allGames.sort((a, b) => (b.edge.best || 0) - (a.edge.best || 0));
  oddsCache.data = allGames;
  oddsCache.ts = Date.now();
  return allGames;
}

app.get('/api/today', async (req, res) => {
  try {
    const games = await getAllOdds();
    const sport = req.query.sport;
    const filtered = sport && sport !== 'all' ? games.filter(g => g.sport.toLowerCase() === sport.toLowerCase()) : games;
    res.json({
      games: filtered,
      count: filtered.length,
      updated: new Date().toISOString(),
      cacheAge: Date.now() - oddsCache.ts
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SUMMARY ENDPOINT ====================

app.get('/api/summary', async (req, res) => {
  try {
    let games = [];
    try { games = await getAllOdds(); } catch (_) {}
    let nbaBT = { roi: 0, totalGames: 0 };
    let mlbBT = { roi: 0, totalGames: 0 };
    let nhlBT = { roi: 0, totalGames: 0 };
    try { nbaBT = backtest.runBacktest(); } catch (_) {}
    try { mlbBT = mlbBacktest.runBacktest(); } catch (_) {}
    try { nhlBT = nhlBacktest.runBacktest(); } catch (_) {}
    res.json({
      gamesTracked: games.length,
      valueBets: games.filter(g => g.edge && g.edge.best > 3).length,
      sports: {
        nba: { games: games.filter(g => g.sport === 'NBA').length, backtestROI: nbaBT.roi, backtestGames: nbaBT.totalGames },
        mlb: { games: games.filter(g => g.sport === 'MLB').length, backtestROI: mlbBT.roi, backtestGames: mlbBT.totalGames },
        nhl: { games: games.filter(g => g.sport === 'NHL').length, backtestROI: nhlBT.roi, backtestGames: nhlBT.totalGames }
      },
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Alias routes (frontend uses short paths) ───

// NBA aliases
app.get('/api/nba/ratings', (req, res) => {
  try {
    const ratings = nba.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nba/predict', (req, res) => {
  const { away, home, awayB2B, homeB2B } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const pred = nba.predict(away.toUpperCase(), home.toUpperCase(), { awayB2B: awayB2B === 'true', homeB2B: homeB2B === 'true' });
    if (pred.error) return res.status(400).json(pred);
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nba/backtest', (req, res) => {
  try {
    const result = backtest.runBacktest();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MLB aliases
app.get('/api/mlb/ratings', (req, res) => {
  try {
    const ratings = mlb.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.composite - a.composite);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/predict', (req, res) => {
  const { away, home } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const pred = mlb.predict(away.toUpperCase(), home.toUpperCase());
    if (pred.error) return res.status(400).json(pred);
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/backtest', (req, res) => {
  try {
    const result = mlbBacktest.runBacktest();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/pitchers', (req, res) => {
  try {
    const pitchers = mlbPitchers.getAllPitchers();
    res.json({ pitchers, count: pitchers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/opening-day', async (req, res) => {
  try {
    const projections = mlbOpeningDay.OPENING_DAY_GAMES.map(game => {
      const pred = mlb.predict(game.away, game.home);
      return { ...game, prediction: pred };
    });
    res.json({ games: projections, date: '2026-03-27', updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NHL aliases
app.get('/api/nhl/ratings', (req, res) => {
  try {
    const ratings = nhl.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nhl/predict', (req, res) => {
  const { away, home } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const pred = nhl.predict(away.toUpperCase(), home.toUpperCase());
    if (pred.error) return res.status(400).json(pred);
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nhl/backtest', (req, res) => {
  try {
    const result = nhlBacktest.runBacktest();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Missing endpoints ───

// Kelly Criterion calculator
app.get('/api/kelly', async (req, res) => {
  try {
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const fraction = parseFloat(req.query.fraction) || 0.5; // half-Kelly default

    // Get all value bets across sports
    const games = await getAllOdds();
    const valueBets = games.filter(g => g.edge && g.edge.best > 2);

    const picks = valueBets.map(g => {
      const edge = g.edge.best / 100;
      const odds = g.bestOdds || 2.0;
      const kellyPct = Math.max(0, (edge * (odds - 1) - (1 - edge)) / (odds - 1));
      const adjKelly = kellyPct * fraction;
      const wager = Math.min(bankroll * adjKelly, bankroll * 0.05); // max 5% of bankroll

      return {
        game: g.game || g.matchup || 'Unknown',
        sport: g.sport,
        edge: g.edge.best,
        kellyFull: +(kellyPct * 100).toFixed(2),
        kellyAdj: +(adjKelly * 100).toFixed(2),
        wager: +wager.toFixed(2),
        book: g.bestBook || 'Unknown'
      };
    });

    res.json({
      bankroll,
      fraction,
      picks: picks.sort((a, b) => b.edge - a.edge),
      totalWager: +picks.reduce((s, p) => s + p.wager, 0).toFixed(2),
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Data status — now shows live data info
app.get('/api/data/status', (req, res) => {
  const status = liveData.getDataStatus();
  const nbaTeams = nba.getTeams();
  const nhlTeams = nhl.getTeams();
  const mlbTeams = mlb.getTeams();
  
  res.json({
    nba: {
      teams: Object.keys(nbaTeams).length,
      ...status.nba,
      sampleTeam: nbaTeams['OKC'] ? { name: nbaTeams['OKC'].name, w: nbaTeams['OKC'].w, l: nbaTeams['OKC'].l } : null
    },
    mlb: {
      teams: Object.keys(mlbTeams).length,
      pitchers: mlbPitchers.getAllPitchers().length,
      ...status.mlb,
    },
    nhl: {
      teams: Object.keys(nhlTeams).length,
      ...status.nhl,
      sampleTeam: nhlTeams['COL'] ? { name: nhlTeams['COL'].name, w: nhlTeams['COL'].w, l: nhlTeams['COL'].l } : null
    },
    odds: { configured: !!ODDS_API_KEY, source: 'the-odds-api', cacheMinutes: 5 },
    updated: new Date().toISOString()
  });
});

// Data refresh — actually triggers live data pull now
app.post('/api/data/refresh', async (req, res) => {
  try {
    const results = await liveData.refreshAll(true);
    res.json({ 
      status: 'ok', 
      message: 'Live data refresh completed',
      results,
      updated: new Date().toISOString() 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/data/refresh', async (req, res) => {
  try {
    const results = await liveData.refreshAll(true);
    res.json({ 
      status: 'ok', 
      message: 'Live data refresh completed',
      results,
      updated: new Date().toISOString() 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 SportsSim v6.0 running on port ${PORT}`);
  console.log(`   Odds API: ${ODDS_API_KEY ? 'configured' : 'NOT SET (set ODDS_API_KEY env var)'}`);
  console.log(`   NBA teams: ${Object.keys(nba.getTeams()).length}`);
  console.log(`   MLB teams: ${Object.keys(mlb.getTeams()).length}`);
  console.log(`   MLB pitchers: ${mlbPitchers.getAllPitchers().length}`);
  console.log(`   MLB Opening Day games: ${mlbOpeningDay.OPENING_DAY_GAMES.length}`);
  console.log(`   NHL teams: ${Object.keys(nhl.getTeams()).length}`);
  console.log(`   Features: LIVE DATA, pitcher model, Poisson totals, matchup analysis, Opening Day`);
  
  // Auto-refresh live data on startup
  console.log('   📡 Fetching live data...');
  liveData.refreshAll().then(results => {
    console.log('   ✅ Live data refresh:', JSON.stringify(results));
    console.log(`   NBA teams (live): ${Object.keys(nba.getTeams()).length}`);
    console.log(`   NHL teams (live): ${Object.keys(nhl.getTeams()).length}`);
  }).catch(e => {
    console.error('   ⚠️ Live data refresh failed:', e.message);
    console.log('   Using static fallback data');
  });
});
