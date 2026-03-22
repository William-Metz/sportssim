require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nba = require('./models/nba');
const backtest = require('./models/backtest');
const mlb = require('./models/mlb');
const mlbPitchers = require('./models/mlb-pitchers');
const mlbBacktest = require('./models/backtest-mlb');
const mlbBacktestV2 = require('./models/backtest-mlb-v2');
const mlbOpeningDay = require('./models/mlb-opening-day');
const nhl = require('./models/nhl');
const nhlBacktest = require('./models/backtest-nhl');
const liveData = require('./services/live-data');
const kelly = require('./services/kelly');
const rollingStats = require('./services/rolling-stats');
const injuries = require('./services/injuries');
const lineMovement = require('./services/line-movement');
const clvTracker = require('./services/clv-tracker');
const kalshi = require('./services/kalshi');
const playerProps = require('./services/player-props');
const weather = require('./services/weather');
const polymarket = require('./services/polymarket');
const restTravelService = require('./services/rest-travel');
const monteCarloService = require('./services/monte-carlo');
const playerStatsService = require('./services/player-stats');
const betTracker = require('./services/bet-tracker');
const umpireService = require('./services/umpire-tendencies');
const dailyPicks = require('./services/daily-picks');
const mlbSchedule = require('./services/mlb-schedule');
const calibration = require('./services/calibration');
const sgpEngine = require('./services/sgp-engine');
const altLines = require('./services/alt-lines');
const mlBridge = require('./services/ml-bridge');
const arbitrage = require('./services/arbitrage');
const playoffSeries = require('./services/playoff-series');
const statcast = require('./services/statcast');
const historicalGames = require('./services/historical-games');
const polymarketValue = require('./services/polymarket-value');
const preseasonTuning = require('./services/preseason-tuning');

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
  res.json({ status: 'ok', version: '31.0.0', timestamp: new Date().toISOString(), sports: ['nba','mlb','nhl'], features: ['live-data','pitcher-model','poisson-totals','matchup-analysis','opening-day','weather-integration','player-props','polymarket-scanner','polymarket-value-bridge','cross-market-arbitrage','futures-value-scanner','bet-tracker','auto-grading','clv-tracking','rest-travel','monte-carlo-sim','bullpen-fatigue','espn-confirmed-starters','mlb-schedule','spring-training-signals','opening-day-command-center','umpire-tendencies','probability-calibration','sgp-correlation-engine','unified-signal-engine','alt-lines-scanner','arbitrage-scanner','poisson-win-prob','nba-spread-calibration','mlb-backtest-v2-point-in-time','mlb-calibration-v2','playoff-series-pricing','championship-simulator','statcast-integration','ml-engine-v2-statcast','historical-data-expansion','ml-value-detection','ml-daily-picks','preseason-tuning','roster-change-impact','new-team-pitcher-penalty','opening-day-starter-premium'] });
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
    const rawPred = nba.predict(away.toUpperCase(), home.toUpperCase(), { awayB2B: awayB2B === 'true', homeB2B: homeB2B === 'true' });
    if (rawPred.error) return res.status(400).json(rawPred);
    // Apply probability calibration for accurate edge detection
    const pred = calibration.calibratePrediction(rawPred, 'nba');
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
      const rawPred = nba.predict(awayAbbr, homeAbbr);
      if (rawPred.error) continue;
      // Apply calibration for accurate edge calculation
      const pred = calibration.calibratePrediction(rawPred, 'nba');
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
    // Auto-record to CLV tracker
    try {
      const clvBets = valueBets.map(b => ({
        away: b.game.split(' @ ')[0],
        home: b.game.split(' @ ')[1],
        type: b.type,
        side: b.type === 'total' ? (b.pick.includes('OVER') ? 'over' : 'under') : (b.pick.includes(b.game.split(' @ ')[1]) ? 'home' : 'away'),
        modelLine: b.modelLine || b.modelTotal,
        bookLine: b.bookLine || b.bookTotal,
        modelProb: b.modelProb ? b.modelProb / 100 : null,
        bookProb: b.bookProb ? b.bookProb / 100 : null,
        confidence: b.confidence
      }));
      clvTracker.recordFromValueDetection('NBA', clvBets);
    } catch (e) { /* CLV recording is best-effort */ }
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/nba', (req, res) => {
  try {
    const opts = {};
    if (req.query.spreadFactor) opts.spreadFactor = parseFloat(req.query.spreadFactor);
    if (req.query.hca) opts.hca = parseFloat(req.query.hca);
    if (req.query.luckFactor) opts.luckFactor = parseFloat(req.query.luckFactor);
    if (req.query.minEdge) opts.minEdge = parseFloat(req.query.minEdge);
    if (req.query.useLiveModel) opts.useLiveModel = req.query.useLiveModel === 'true';
    res.json(backtest.runBacktest(opts));
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/nba/optimize', (req, res) => {
  try { res.json(backtest.optimizeParameters()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CLV TRACKING ====================

app.get('/api/clv', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(clvTracker.getReport(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clv/status', (req, res) => {
  try { res.json(clvTracker.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clv/record', (req, res) => {
  try {
    const pick = req.body;
    if (!pick.sport || !pick.away || !pick.home || !pick.type) {
      return res.status(400).json({ error: 'sport, away, home, type required' });
    }
    res.json(clvTracker.recordPick(pick));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clv/close', (req, res) => {
  try {
    const { sport, away, home, closingLine } = req.body;
    if (!sport || !away || !home || !closingLine) {
      return res.status(400).json({ error: 'sport, away, home, closingLine required' });
    }
    res.json(clvTracker.recordClosingLine(sport, away, home, closingLine));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clv/grade', (req, res) => {
  try {
    const { results } = req.body;
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'results array required' });
    }
    res.json(clvTracker.autoGrade(results));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MLB ENDPOINTS ====================

app.get('/api/model/mlb/ratings', (req, res) => {
  try {
    const ratings = mlb.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/predict', async (req, res) => {
  const { away, home, awayPitcher, homePitcher, awayPitcherEra, awayPitcherFip, homePitcherEra, homePitcherFip, gameDate, noMonteCarlo } = req.query;
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
    if (gameDate) opts.gameDate = gameDate;
    if (noMonteCarlo) opts.monteCarlo = false;
    // Fetch live weather for the home ballpark
    try {
      const weatherData = await weather.getWeatherForPark(home.toUpperCase());
      if (weatherData && !weatherData.error) opts.weather = weatherData;
    } catch (e) { /* weather optional */ }
    // Fetch umpire assignment for totals adjustment
    try {
      const umpAdj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), req.query.umpire);
      if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
    } catch (e) { /* umpire optional */ }
    // Use async predict (includes rest/travel + monte carlo)
    const rawPred = await mlb.asyncPredict(away.toUpperCase(), home.toUpperCase(), opts);
    if (!rawPred || rawPred.error) return res.status(400).json({ error: rawPred?.error || 'Invalid team code' });
    // Apply probability calibration
    const pred = calibration.calibratePrediction(rawPred, 'mlb');
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

app.get('/api/model/mlb/matchup', async (req, res) => {
  const { away, home, awayPitcher, homePitcher, gameDate } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    if (gameDate) opts.gameDate = gameDate;
    try {
      const weatherData = await weather.getWeatherForPark(home.toUpperCase());
      if (weatherData && !weatherData.error) opts.weather = weatherData;
    } catch (e) { /* weather optional */ }
    try {
      const umpAdj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), req.query.umpire);
      if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
    } catch (e) { /* umpire optional */ }
    const matchup = await mlb.asyncMatchup(away.toUpperCase(), home.toUpperCase(), opts);
    if (!matchup || matchup.error) return res.status(400).json({ error: matchup?.error || 'Invalid team code' });
    res.json(matchup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/totals', async (req, res) => {
  const { away, home, awayPitcher, homePitcher } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    // Fetch live weather for totals — critical for O/U betting
    try {
      const weatherData = await weather.getWeatherForPark(home.toUpperCase());
      if (weatherData && !weatherData.error) opts.weather = weatherData;
    } catch (e) { /* weather optional */ }
    // Fetch umpire data — critical for totals
    try {
      const umpAdj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), req.query.umpire);
      if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
    } catch (e) { /* umpire optional */ }
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
      // Fetch weather for home park to adjust predictions
      const opts = {};
      try {
        const weatherData = await weather.getWeatherForPark(homeAbbr);
        if (weatherData && !weatherData.error) opts.weather = weatherData;
      } catch (e) { /* weather optional */ }
      // Fetch umpire data for totals adjustment
      try {
        const umpAdj = await umpireService.getGameUmpireAdjustment(awayAbbr, homeAbbr);
        if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
      } catch (e) { /* umpire optional */ }
      // Use async predict (includes rest/travel + monte carlo)
      const rawPred = await mlb.asyncPredict(awayAbbr, homeAbbr, opts);
      if (!rawPred || rawPred.error) continue;
      // Apply probability calibration for accurate edge detection
      const calPred = calibration.calibratePrediction(rawPred, 'mlb');

      // ML-enhanced prediction: blend analytical + ML ensemble for sharper edges
      let pred = calPred;
      try {
        const mlResult = await mlBridge.enhancedPredict(awayAbbr, homeAbbr, opts);
        if (mlResult && mlResult.ml && mlResult.blendedHomeWinProb) {
          // Override with ML-blended probabilities (55% ML + 45% analytical)
          pred = {
            ...calPred,
            homeWinProb: mlResult.blendedHomeWinProb,
            awayWinProb: mlResult.blendedAwayWinProb,
            blendedHomeWinProb: mlResult.blendedHomeWinProb,
            blendedAwayWinProb: mlResult.blendedAwayWinProb,
            ml: mlResult.ml,
            predictionSource: 'ml+analytical+calibrated',
            // Preserve MC data from analytical path
            monteCarlo: calPred.monteCarlo,
            totalRuns: calPred.totalRuns,
          };
          // If ML has its own totals prediction, blend it too
          if (mlResult.ml.predictedTotal && calPred.totalRuns) {
            pred.mlTotalRuns = mlResult.ml.predictedTotal;
            pred.blendedTotalRuns = calPred.totalRuns * 0.6 + mlResult.ml.predictedTotal * 0.4;
          }
        }
      } catch (mlErr) { /* ML optional — analytical is still solid */ }

      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        const edges = mlb.findValue(pred, bookLine);
        
        // Also find MC-enhanced value if simulation ran
        if (pred.monteCarlo) {
          const mcEdges = monteCarloService.findSimValue(pred.monteCarlo, bookLine);
          mcEdges.forEach(e => {
            // Only add if not already found by analytical model
            const isDuplicate = edges.some(ae => ae.pick === e.pick && ae.market === e.market);
            if (!isDuplicate) {
              edges.push(e);
            }
          });
        }
        
        edges.forEach(e => {
          valueBets.push({
            sport: 'MLB', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
            commence: game.commence_time, ...e,
            prediction: { 
              homeWinProb: pred.blendedHomeWinProb || pred.homeWinProb, 
              awayWinProb: pred.blendedAwayWinProb || pred.awayWinProb, 
              total: pred.totalRuns,
              mlTotal: pred.mlTotalRuns || null,
              blendedTotal: pred.blendedTotalRuns || null,
              mcTotal: pred.monteCarlo?.totalRuns?.mean || null,
              source: pred.predictionSource || 'analytical'
            }
          });
        });
      }
    }
    valueBets.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString(), mlEnabled: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/mlb', (req, res) => {
  try { 
    // V2 point-in-time backtest is the new default
    if (req.query.version === 'v1') {
      res.json(mlbBacktest.runBacktest()); 
    } else {
      res.json(mlbBacktestV2.runBacktest()); 
    }
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/mlb/v2', (req, res) => {
  try { res.json(mlbBacktestV2.runBacktest()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/mlb/sweep', (req, res) => {
  try { res.json(mlbBacktestV2.paramSweep()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MLB OPENING DAY ====================

app.get('/api/model/mlb/opening-day', async (req, res) => {
  try {
    const projections = await mlbOpeningDay.getProjections();
    
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

// ==================== PRESEASON TUNING ENDPOINT ====================
app.get('/api/model/mlb/preseason-tuning', (req, res) => {
  try {
    const team = req.query.team;
    
    if (team) {
      // Single team lookup
      const abbr = team.toUpperCase();
      const adjustments = preseasonTuning.getOpeningDayAdjustments(abbr);
      const bullpenUncertainty = preseasonTuning.getBullpenUncertainty(abbr);
      const spring = preseasonTuning.SPRING_TRAINING_SIGNALS[abbr] || null;
      const roster = preseasonTuning.ROSTER_CHANGES[abbr] || null;
      
      res.json({
        team: abbr,
        adjustments,
        bullpenUncertainty,
        springSignal: spring,
        rosterChanges: roster,
      });
    } else {
      // All teams overview
      const teams = {};
      const allTeams = Object.keys(preseasonTuning.SPRING_TRAINING_SIGNALS);
      
      for (const abbr of allTeams) {
        const adj = preseasonTuning.getOpeningDayAdjustments(abbr);
        const roster = preseasonTuning.ROSTER_CHANGES[abbr];
        teams[abbr] = {
          offAdj: adj.offAdj,
          defAdj: adj.defAdj,
          chemAdj: adj.chemAdj,
          spring: adj.info.springSignal ? adj.info.springSignal.note : null,
          rosterNote: roster ? roster.note : null,
          moves: roster ? roster.moves : [],
        };
      }
      
      // Sort by total impact (absolute value of all adjustments)
      const sorted = Object.entries(teams)
        .map(([abbr, t]) => ({ abbr, ...t, totalImpact: Math.abs(t.offAdj) + Math.abs(t.defAdj) }))
        .sort((a, b) => b.totalImpact - a.totalImpact);
      
      const newTeamPitchers = Object.entries(preseasonTuning.NEW_TEAM_PITCHERS)
        .map(([name, info]) => ({ name, ...info }));
      
      res.json({
        title: 'MLB Preseason Tuning Report — Opening Day 2026',
        description: 'Spring training signals, roster changes, and Opening Day-specific adjustments',
        teamsWithBiggestChanges: sorted.slice(0, 10),
        newTeamPitchers,
        allTeams: teams,
      });
    }
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
    const rawPred = nhl.predict(away.toUpperCase(), home.toUpperCase(), {
      awayGoalie: awayGoalie || 'starter', homeGoalie: homeGoalie || 'starter'
    });
    if (!rawPred) return res.status(400).json({ error: 'Invalid team code' });
    // Apply probability calibration
    // NHL predict returns {home: {winProb}, away: {winProb}} format — need to adapt
    const calHome = calibration.calibrate(rawPred.home.winProb / 100, 'nhl');
    const calAway = calibration.calibrate(rawPred.away.winProb / 100, 'nhl');
    const totalCal = calHome.calibrated + calAway.calibrated;
    const normHome = totalCal > 0 ? calHome.calibrated / totalCal : 0.5;
    const normAway = totalCal > 0 ? calAway.calibrated / totalCal : 0.5;
    rawPred.home.rawWinProb = rawPred.home.winProb;
    rawPred.away.rawWinProb = rawPred.away.winProb;
    rawPred.home.winProb = +(normHome * 100).toFixed(1);
    rawPred.away.winProb = +(normAway * 100).toFixed(1);
    rawPred.calibration = { method: 'piecewise-linear', sport: 'nhl' };
    res.json(rawPred);
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
      const rawPred = nhl.predict(awayAbbr, homeAbbr);
      if (!rawPred) continue;

      // Apply calibration for accurate edge detection
      const calHome = calibration.calibrate(rawPred.home.winProb / 100, 'nhl');
      const calAway = calibration.calibrate(rawPred.away.winProb / 100, 'nhl');
      const totalCal = calHome.calibrated + calAway.calibrated;
      const modelHomeProb = totalCal > 0 ? calHome.calibrated / totalCal : 0.5;
      const modelAwayProb = totalCal > 0 ? calAway.calibrated / totalCal : 0.5;

      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        // NHL value detection: compare calibrated model ML probabilities to book
        const bookHomeProb = bookLine.homeML ? (bookLine.homeML < 0 ? (-bookLine.homeML) / (-bookLine.homeML + 100) : 100 / (bookLine.homeML + 100)) : null;
        const bookAwayProb = bookLine.awayML ? (bookLine.awayML < 0 ? (-bookLine.awayML) / (-bookLine.awayML + 100) : 100 / (bookLine.awayML + 100)) : null;

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
        if (bookLine.total && rawPred.projTotal) {
          const totalDiff = Math.abs(rawPred.projTotal - bookLine.total);
          if (totalDiff >= 0.5) {
            const side = rawPred.projTotal > bookLine.total ? 'Over' : 'Under';
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
  try {
    const betTypes = req.query.types ? req.query.types.split(',') : ['ml'];
    const minEdge = req.query.minEdge ? parseFloat(req.query.minEdge) : 0.02;
    const regOnly = req.query.regOnly === 'true';
    res.json(nhlBacktest.runBacktest({ betTypes, minEdge, regOnly }));
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== COMBINED ====================

app.get('/api/value/all', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      fetch_value_bets('nba'), fetch_value_bets('mlb'), fetch_value_bets('nhl'),
      polymarketValue.scanForValue({ minEdge: 0.03 }).then(r => 
        (r.valueBets || []).filter(v => v.rawEdge > 0).map(v => ({
          sport: (v.sport || 'POLY').toUpperCase(),
          game: v.question,
          book: 'Polymarket',
          pick: `${v.outcome} @ ${v.impliedProb}%`,
          market: v.marketType || 'prediction-market',
          edge: v.edge,
          confidence: v.confidence,
          modelProb: v.modelProb,
          url: v.url,
          source: 'polymarket',
        }))
      ).catch(() => [])
    ]);
    const all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });
    all.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets: all, count: all.length, updated: new Date().toISOString(), includesPolymarket: true });
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
      // Apply calibration for accurate edge calculation
      const calPred = calibration.calibratePrediction(pred, 'nba');
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        nba.findValue(calPred, bookLine).forEach(e => {
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
      // Weather-adjusted predictions
      const opts = {};
      try {
        const wd = await weather.getWeatherForPark(homeAbbr);
        if (wd && !wd.error) opts.weather = wd;
      } catch (e) { /* weather optional */ }
      // Umpire data for totals
      try {
        const umpAdj = await umpireService.getGameUmpireAdjustment(awayAbbr, homeAbbr);
        if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
      } catch (e) { /* umpire optional */ }
      const rawPred = await mlb.asyncPredict(awayAbbr, homeAbbr, opts);
      if (!rawPred || rawPred.error) continue;
      // Apply calibration for accurate edge calculation
      const pred = calibration.calibratePrediction(rawPred, 'mlb');
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        const edges = mlb.findValue(pred, bookLine);
        // Also find MC-enhanced value if simulation ran
        if (pred.monteCarlo) {
          try {
            const mcEdges = monteCarloService.findSimValue(pred.monteCarlo, bookLine);
            mcEdges.forEach(e => {
              const isDuplicate = edges.some(ae => ae.pick === e.pick && ae.market === e.market);
              if (!isDuplicate) edges.push(e);
            });
          } catch (e) { /* MC value optional */ }
        }
        edges.forEach(e => {
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
      const rawPredNhl = nhl.predict(awayAbbr, homeAbbr);
      if (!rawPredNhl) continue;
      // Apply calibration for accurate NHL edge detection
      const calH = calibration.calibrate(rawPredNhl.home.winProb / 100, 'nhl');
      const calA = calibration.calibrate(rawPredNhl.away.winProb / 100, 'nhl');
      const totCal = calH.calibrated + calA.calibrated;
      const nhlHomeProb = totCal > 0 ? calH.calibrated / totCal : 0.5;
      const nhlAwayProb = totCal > 0 ? calA.calibrated / totCal : 0.5;
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        const bookHomeProb = bookLine.homeML ? (bookLine.homeML < 0 ? (-bookLine.homeML) / (-bookLine.homeML + 100) : 100 / (bookLine.homeML + 100)) : null;
        const bookAwayProb = bookLine.awayML ? (bookLine.awayML < 0 ? (-bookLine.awayML) / (-bookLine.awayML + 100) : 100 / (bookLine.awayML + 100)) : null;
        if (bookHomeProb !== null && (nhlHomeProb - bookHomeProb) > 0.02) {
          const edge = nhlHomeProb - bookHomeProb;
          bets.push({ sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time,
            pick: `${homeAbbr} ML`, market: 'moneyline', edge: +(edge * 100).toFixed(1), confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW'
          });
        }
        if (bookAwayProb !== null && (nhlAwayProb - bookAwayProb) > 0.02) {
          const edge = nhlAwayProb - bookAwayProb;
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
        let gameWeather = null;
        try {
          if (s.sport === 'NBA') pred = nba.predict(awayAbbr || 'UNK', homeAbbr || 'UNK');
          else if (s.sport === 'MLB') {
            // Fetch weather for MLB games
            const mlbOpts = {};
            try {
              const wd = await weather.getWeatherForPark(homeAbbr || 'UNK');
              if (wd && !wd.error) { mlbOpts.weather = wd; gameWeather = wd; }
            } catch (e) { /* weather optional */ }
            pred = mlb.predict(awayAbbr || 'UNK', homeAbbr || 'UNK', mlbOpts);
            // Calibrate MLB probabilities
            if (pred && !pred.error) pred = calibration.calibratePrediction(pred, 'mlb');
          }
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
          weather: gameWeather ? {
            temp: gameWeather.weather?.temp,
            wind: gameWeather.weather?.wind,
            windDir: gameWeather.weather?.windDir,
            humidity: gameWeather.weather?.humidity,
            multiplier: gameWeather.multiplier,
            totalImpact: gameWeather.totalImpact,
            description: gameWeather.description,
            park: gameWeather.park,
            dome: gameWeather.dome
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
    try { mlbBT = mlbBacktestV2.runBacktest(); } catch (_) {}
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
    const rawPred = nba.predict(away.toUpperCase(), home.toUpperCase(), { awayB2B: awayB2B === 'true', homeB2B: homeB2B === 'true' });
    if (rawPred.error) return res.status(400).json(rawPred);
    const pred = calibration.calibratePrediction(rawPred, 'nba');
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

app.get('/api/mlb/predict', async (req, res) => {
  const { away, home } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    try {
      const wd = await weather.getWeatherForPark(home.toUpperCase());
      if (wd && !wd.error) opts.weather = wd;
    } catch (e) { /* weather optional */ }
    const rawPred = mlb.predict(away.toUpperCase(), home.toUpperCase(), opts);
    if (rawPred.error) return res.status(400).json(rawPred);
    const pred = calibration.calibratePrediction(rawPred, 'mlb');
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/backtest', (req, res) => {
  try {
    const result = req.query.version === 'v1' ? mlbBacktest.runBacktest() : mlbBacktestV2.runBacktest();
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
    // Use enhanced Opening Day model with all services integrated
    const projections = await mlbOpeningDay.getProjections();
    res.json(projections);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MLB Schedule & Confirmed Starters
app.get('/api/mlb/schedule', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const schedule = await mlbSchedule.getSchedule(date);
    res.json(schedule);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/schedule/multi', async (req, res) => {
  try {
    const start = req.query.start || new Date().toISOString().split('T')[0];
    const days = Math.min(parseInt(req.query.days) || 3, 7);
    const schedule = await mlbSchedule.getMultiDaySchedule(start, days);
    res.json(schedule);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/starter/:team', async (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const starter = await mlbSchedule.getConfirmedStarter(team, date);
    res.json(starter || { team, date, starter: null, note: 'No confirmed starter found' });
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
    const betTypes = req.query.types ? req.query.types.split(',') : ['ml'];
    const minEdge = req.query.minEdge ? parseFloat(req.query.minEdge) : 0.02;
    const regOnly = req.query.regOnly === 'true';
    const result = nhlBacktest.runBacktest({ betTypes, minEdge, regOnly });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Missing endpoints ───

// Kelly Criterion portfolio optimizer
app.get('/api/kelly', async (req, res) => {
  try {
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const fractionParam = req.query.fraction || 'half';
    const minEdge = parseFloat(req.query.minEdge) || 2;
    const maxBetPct = parseFloat(req.query.maxBetPct) || 0.05;
    
    // Map fraction param
    const fractionMap = { full: 1.0, half: 0.5, quarter: 0.25, third: 0.33 };
    const fraction = fractionMap[fractionParam] || parseFloat(fractionParam) || 0.5;

    // Get all value bets across sports
    const games = await getAllOdds();
    
    // Convert to Kelly-compatible format
    const valueBets = [];
    for (const g of games) {
      if (!g.edge || !g.prediction) continue;
      
      // Home side bet
      if (g.edge.home > minEdge && g.bestLine?.home?.ml) {
        valueBets.push({
          sport: g.sport,
          game: `${g.away} @ ${g.home}`,
          pick: `${g.home} ML (${g.bestLine.home.ml > 0 ? '+' : ''}${g.bestLine.home.ml})`,
          book: g.bestLine.home.book || 'best',
          modelProb: g.prediction.homeWinProb / 100,
          bookML: g.bestLine.home.ml,
          edge: g.edge.home,
          confidence: g.edge.home >= 8 ? 'HIGH' : g.edge.home >= 5 ? 'MEDIUM' : 'LOW'
        });
      }
      
      // Away side bet
      if (g.edge.away > minEdge && g.bestLine?.away?.ml) {
        valueBets.push({
          sport: g.sport,
          game: `${g.away} @ ${g.home}`,
          pick: `${g.away} ML (${g.bestLine.away.ml > 0 ? '+' : ''}${g.bestLine.away.ml})`,
          book: g.bestLine.away.book || 'best',
          modelProb: g.prediction.awayWinProb / 100,
          bookML: g.bestLine.away.ml,
          edge: g.edge.away,
          confidence: g.edge.away >= 8 ? 'HIGH' : g.edge.away >= 5 ? 'MEDIUM' : 'LOW'
        });
      }
    }

    const portfolio = kelly.optimizePortfolio({
      bankroll,
      fraction,
      maxBetPct,
      minEdge,
      bets: valueBets
    });

    res.json({
      ...portfolio,
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Data status — now shows live data info
// ==================== ROLLING STATS API ====================

app.get('/api/rolling/status', (req, res) => {
  res.json(rollingStats.getStatus());
});

app.get('/api/rolling/:sport', (req, res) => {
  const sport = req.params.sport.toLowerCase();
  let data;
  if (sport === 'nba') data = rollingStats.getNBARolling();
  else if (sport === 'nhl') data = rollingStats.getNHLRolling();
  else if (sport === 'mlb') data = rollingStats.getMLBRolling();
  else return res.status(400).json({ error: 'Invalid sport. Use nba, nhl, or mlb' });
  
  if (!data) return res.json({ note: `No rolling stats available for ${sport}. Try refreshing.`, data: {} });
  
  // Sort by rolling net rating
  const sorted = Object.entries(data)
    .map(([abbr, stats]) => ({ abbr, ...stats }))
    .sort((a, b) => (b.rollingNetRating || 0) - (a.rollingNetRating || 0));
  
  res.json({ sport, teams: sorted.length, data: sorted });
});

app.get('/api/rolling/:sport/:team', (req, res) => {
  const { sport, team } = req.params;
  const data = rollingStats.getTeamRolling(sport, team.toUpperCase());
  if (!data) return res.json({ note: `No rolling data for ${team} in ${sport}` });
  const adj = rollingStats.getRollingAdjustment(sport, team.toUpperCase());
  res.json({ team: team.toUpperCase(), sport, rolling: data, adjustment: adj });
});

app.post('/api/rolling/refresh', async (req, res) => {
  try {
    const results = await rollingStats.refreshAll(true);
    res.json({ status: 'ok', results, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== INJURIES API ====================

app.get('/api/injuries/status', (req, res) => {
  res.json(injuries.getStatus());
});

app.get('/api/injuries/:sport', (req, res) => {
  const sport = req.params.sport.toLowerCase();
  let data;
  if (sport === 'nba') data = injuries.getNBAInjuries();
  else if (sport === 'nhl') data = injuries.getNHLInjuries();
  else if (sport === 'mlb') data = injuries.getMLBInjuries();
  else return res.status(400).json({ error: 'Invalid sport. Use nba, nhl, or mlb' });
  
  // Sort by total impact (most affected teams first)
  const sorted = Object.entries(data)
    .map(([abbr, info]) => ({ abbr, ...info }))
    .sort((a, b) => (b.totalImpact || 0) - (a.totalImpact || 0));
  
  res.json({ sport, teams: sorted.length, data: sorted });
});

app.get('/api/injuries/:sport/:team', (req, res) => {
  const { sport, team } = req.params;
  const data = injuries.getTeamInjuries(sport.toLowerCase(), team.toUpperCase());
  if (!data) return res.json({ note: `No injury data for ${team} in ${sport}` });
  const adj = injuries.getInjuryAdjustment(sport.toLowerCase(), team.toUpperCase());
  res.json({ team: team.toUpperCase(), sport, injuries: data, adjustment: adj });
});

app.post('/api/injuries/refresh', async (req, res) => {
  try {
    const results = await injuries.refreshAll(true);
    res.json({ status: 'ok', results, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== DATA STATUS ====================

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
    rollingStats: rollingStats.getStatus(),
    injuries: injuries.getStatus(),
    kalshi: kalshi.getStatus(),
    statcast: {
      pitchers: statcast.cachedPitchers ? Object.keys(statcast.cachedPitchers).length : 0,
      batters: statcast.cachedBatters ? Object.keys(statcast.cachedBatters).length : 0,
      teams: statcast.cachedTeamBatting ? Object.keys(statcast.cachedTeamBatting).length : 0,
      lastFetch: statcast.lastFetch ? new Date(statcast.lastFetch).toISOString() : null,
    },
    updated: new Date().toISOString()
  });
});

// Data refresh — triggers live data, rolling stats, and injuries pull
app.post('/api/data/refresh', async (req, res) => {
  try {
    const [liveResults, rollingResults, injuryResults] = await Promise.all([
      liveData.refreshAll(true),
      rollingStats.refreshAll(true),
      injuries.refreshAll(true)
    ]);
    res.json({ 
      status: 'ok', 
      message: 'Full data refresh completed',
      results: { live: liveResults, rolling: rollingResults, injuries: injuryResults },
      updated: new Date().toISOString() 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/data/refresh', async (req, res) => {
  try {
    const [liveResults, rollingResults, injuryResults] = await Promise.all([
      liveData.refreshAll(true),
      rollingStats.refreshAll(true),
      injuries.refreshAll(true)
    ]);
    res.json({ 
      status: 'ok', 
      message: 'Full data refresh completed',
      results: { live: liveResults, rolling: rollingResults, injuries: injuryResults },
      updated: new Date().toISOString() 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== LINE MOVEMENT TRACKER ====================

app.get('/api/lines/sharp', (req, res) => {
  try {
    const sport = req.query.sport || 'all';
    const sharpSignals = lineMovement.getSharpSignals(sport);
    res.json({
      signals: sharpSignals,
      count: sharpSignals.length,
      breakdown: {
        steam: sharpSignals.filter(s => s.type === 'STEAM').length,
        rlm: sharpSignals.filter(s => s.type === 'RLM').length,
        stale: sharpSignals.filter(s => s.type === 'STALE').length
      },
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/snapshot', async (req, res) => {
  try {
    const games = await getAllOdds();
    const result = lineMovement.takeSnapshot(games);
    res.json({
      status: 'ok',
      message: 'Snapshot taken',
      ...result,
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/status', (req, res) => {
  try {
    const status = lineMovement.getStatus();
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/history/:gameId', (req, res) => {
  try {
    const history = lineMovement.getGameHistory(req.params.gameId);
    res.json({
      gameId: req.params.gameId,
      snapshots: history.length,
      history
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/:sport', (req, res) => {
  try {
    const sport = req.params.sport;
    const movement = lineMovement.getMovement(sport);
    res.json({
      sport,
      games: movement,
      count: movement.length,
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PROBABILITY CALIBRATION ====================

app.get('/api/calibration/status', (req, res) => {
  res.json(calibration.getStatus());
});

app.get('/api/calibration/diagnostics', (req, res) => {
  const sport = req.query.sport || 'mlb';
  res.json(calibration.getDiagnostics(sport));
});

app.get('/api/calibration/test', (req, res) => {
  const rawProb = parseFloat(req.query.prob) || 0.55;
  const sport = req.query.sport || 'mlb';
  const result = calibration.calibrate(rawProb, sport);
  res.json(result);
});

app.get('/api/calibration/edge', (req, res) => {
  const modelProb = parseFloat(req.query.model) || 0.55;
  const bookProb = parseFloat(req.query.book) || 0.50;
  const sport = req.query.sport || 'mlb';
  const result = calibration.calibratedEdge(modelProb, bookProb, sport);
  res.json(result);
});

// ==================== KALSHI SCANNER ====================

app.get('/api/kalshi/scan', async (req, res) => {
  try {
    const results = await kalshi.fullScan({ nba: nba, mlb: mlb, nhl: nhl });
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/value', async (req, res) => {
  try {
    const results = await kalshi.getScanResults({ nba: nba, mlb: mlb, nhl: nhl });
    if (!results) return res.json({ valueBets: [], note: 'No scan data. Trigger /api/kalshi/scan first.' });
    res.json({
      valueBets: results.valueBets || [],
      totalBets: results.totalValueBets || 0,
      highConfidence: results.highConfidence || 0,
      lastScan: results.timestamp
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/futures', async (req, res) => {
  try {
    const cached = kalshi.getCachedResults();
    if (cached && cached.futures) {
      return res.json(cached.futures);
    }
    // Run scan if no cache
    const results = await kalshi.fullScan({ nba: nba, mlb: mlb, nhl: nhl });
    res.json(results.futures || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/team-totals', async (req, res) => {
  try {
    const cached = kalshi.getCachedResults();
    if (cached && cached.nbaTeamTotals) {
      return res.json({ games: cached.nbaTeamTotals, count: cached.nbaTeamTotals.length });
    }
    const events = await kalshi.fetchKalshiEvents(kalshi.SERIES.NBA_TEAM_TOTAL);
    const parsed = kalshi.parseNBATeamTotals(events);
    res.json({ games: parsed, count: parsed.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/status', (req, res) => {
  res.json(kalshi.getStatus());
});

// ==================== PLAYER PROPS ====================

app.get('/api/props/status', (req, res) => {
  res.json(playerProps.getStatus());
});

app.get('/api/props/players/:sport', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  try {
    const players = await playerProps.getAvailablePlayers(sport);
    const liveCount = players.filter(p => p.source === 'live').length;
    res.json({ sport, players, count: players.length, liveCount, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/props/projection/:sport/:player', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  const playerName = decodeURIComponent(req.params.player);
  try {
    const projection = await playerProps.getPlayerProjection(playerName, sport, { nba, mlb, nhl });
    if (!projection) return res.status(404).json({ error: `Player "${playerName}" not found in ${sport.toUpperCase()}` });
    res.json(projection);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/props/scan/:sport', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  try {
    const results = await playerProps.scanProps(sport, { nba, mlb, nhl });
    if (results.error) return res.status(400).json(results);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/props/value/:sport', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  try {
    const results = await playerProps.scanProps(sport, { nba, mlb, nhl });
    if (results.error) return res.status(400).json(results);
    // Return only value bets, sorted by edge
    const minEdge = parseFloat(req.query.minEdge) || 3;
    const valueBets = (results.valueBets || []).filter(b => b.edge >= minEdge);
    res.json({
      sport: results.sport,
      valueBets,
      count: valueBets.length,
      totalScanned: results.totalProps,
      timestamp: results.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Prop calculator: user enters player + line + odds, get model edge
app.get('/api/props/calc', async (req, res) => {
  const { player, sport, stat, line, overOdds, underOdds } = req.query;
  if (!player || !sport || !stat || !line) {
    return res.status(400).json({ error: 'Required: player, sport, stat, line' });
  }
  const sportLower = sport.toLowerCase();
  const baseline = await playerProps.getPlayerProjection(decodeURIComponent(player), sportLower, { nba, mlb, nhl });
  if (!baseline || !baseline.stats[stat]) {
    return res.status(404).json({ error: `No baseline for ${player} ${stat}` });
  }
  const projection = baseline.stats[stat];
  const lineNum = parseFloat(line);
  const { over, under } = playerProps.calcOverUnderProb(projection, lineNum);
  
  const result = {
    player: decodeURIComponent(player),
    stat,
    projection,
    line: lineNum,
    modelOver: over,
    modelUnder: under,
  };
  
  if (overOdds) {
    const bookOver = overOdds < 0 ? (-overOdds) / (-overOdds + 100) * 100 : 100 / (parseFloat(overOdds) + 100) * 100;
    result.overEdge = +(over - bookOver).toFixed(1);
    result.overSignal = result.overEdge > 3 ? 'BET OVER' : result.overEdge > 0 ? 'lean over' : 'pass';
  }
  if (underOdds) {
    const bookUnder = underOdds < 0 ? (-underOdds) / (-underOdds + 100) * 100 : 100 / (parseFloat(underOdds) + 100) * 100;
    result.underEdge = +(under - bookUnder).toFixed(1);
    result.underSignal = result.underEdge > 3 ? 'BET UNDER' : result.underEdge > 0 ? 'lean under' : 'pass';
  }
  
  res.json(result);
});

// ==================== LIVE PLAYER STATS ====================

app.get('/api/players/status', (req, res) => {
  res.json(playerStatsService.getStatus());
});

app.get('/api/players/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const stats = await playerStatsService.getPlayerStats(sport);
    const players = Object.values(stats).filter(p => typeof p === 'object' && p.name);
    res.json({ sport, count: players.length, players, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/players/refresh', async (req, res) => {
  try {
    const result = await playerStatsService.refreshAll();
    res.json({ refreshed: true, ...result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== WEATHER ====================

app.get('/api/weather/status', (req, res) => {
  res.json(weather.getStatus());
});

app.get('/api/weather/:team', async (req, res) => {
  try {
    const result = await weather.getWeatherForPark(req.params.team.toUpperCase());
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/weather', async (req, res) => {
  try {
    const all = await weather.getAllWeather();
    // Sort by impact (most hitter-friendly first)
    const sorted = Object.values(all).sort((a, b) => (b.totalImpact || 0) - (a.totalImpact || 0));
    res.json({
      parks: sorted,
      count: sorted.length,
      updated: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/weather/game/:away/:home', async (req, res) => {
  try {
    const { away, home } = req.params;
    const baseTotal = parseFloat(req.query.total) || 8.5;
    const result = await weather.adjustGameTotal(home.toUpperCase(), away.toUpperCase(), baseTotal);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MLB WEATHER GAMES (enriched today's MLB with weather) ====================
app.get('/api/mlb/weather-games', async (req, res) => {
  try {
    const nameMap = buildNameMap(mlb.TEAMS, { 'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR' });
    const liveOdds = await fetchOdds('baseball_mlb');
    const games = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;

      // Get weather for this game's ballpark
      let weatherData = null;
      try {
        weatherData = await weather.getWeatherForPark(homeAbbr);
      } catch (e) { /* skip */ }

      // Get prediction with weather
      const opts = {};
      if (weatherData && !weatherData.error) opts.weather = weatherData;
      const pred = mlb.predict(awayAbbr, homeAbbr, opts);

      // Get prediction WITHOUT weather for comparison
      const predNoWeather = mlb.predict(awayAbbr, homeAbbr);

      // Extract best book odds
      let total = null;
      for (const bk of (game.bookmakers || [])) {
        const line = extractBookLine(bk, game.home_team);
        if (line.total) { total = line.total; break; }
      }

      // Weather-adjusted total
      let adjustedTotal = null;
      if (total && weatherData && weatherData.multiplier) {
        adjustedTotal = +(total * weatherData.multiplier).toFixed(1);
      }

      games.push({
        away: awayAbbr,
        home: homeAbbr,
        awayFull: game.away_team,
        homeFull: game.home_team,
        commence: game.commence_time,
        weather: weatherData || null,
        bookTotal: total,
        adjustedTotal,
        totalDiff: adjustedTotal && total ? +(adjustedTotal - total).toFixed(1) : 0,
        prediction: pred && !pred.error ? {
          homeWinProb: pred.homeWinProb,
          awayWinProb: pred.awayWinProb,
          totalRuns: pred.totalRuns,
          awayExpRuns: pred.awayExpRuns,
          homeExpRuns: pred.homeExpRuns,
        } : null,
        predNoWeather: predNoWeather && !predNoWeather.error ? {
          totalRuns: predNoWeather.totalRuns,
          homeWinProb: predNoWeather.homeWinProb,
        } : null,
        weatherEdge: pred && predNoWeather && !pred.error && !predNoWeather.error ? {
          totalShift: +(pred.totalRuns - predNoWeather.totalRuns).toFixed(2),
          probShift: +(pred.homeWinProb - predNoWeather.homeWinProb).toFixed(1),
        } : null,
      });
    }

    // Sort by weather impact (most impactful first)
    games.sort((a, b) => Math.abs(b.weather?.totalImpact || 0) - Math.abs(a.weather?.totalImpact || 0));

    res.json({
      games,
      count: games.length,
      updated: new Date().toISOString(),
      note: 'Weather data adjusts run projections. Positive totalImpact = hitter-friendly. Check totalDiff for O/U edge.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== POLYMARKET SCANNER ====================

app.get('/api/polymarket/status', (req, res) => {
  res.json(polymarket.getStatus());
});

app.get('/api/polymarket/scan', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarket.fullScan({ sport });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/featured', async (req, res) => {
  try {
    const result = await polymarket.getFeaturedSportsMarkets();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/movers', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarket.findMovers(sport);
    res.json({ movers: result, count: result.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/games', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarket.scanDailyGames(sport);
    res.json({ games: result, count: result.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/futures/:sport', async (req, res) => {
  try {
    const sport = req.params.sport;
    const result = await polymarket.scanChampionshipFutures(sport);
    res.json({ futures: result, count: result.length, sport, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== POLYMARKET VALUE BRIDGE ====================

// Model vs Market value scan — THE MONEY FINDER
app.get('/api/polymarket/value', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    const result = await polymarketValue.scanForValue({ sport, minEdge });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cross-market arbitrage: Polymarket vs sportsbooks
app.get('/api/polymarket/arbitrage', async (req, res) => {
  try {
    // Fetch sportsbook odds from The Odds API
    const oddsData = [];
    const sports = ['basketball_nba', 'baseball_mlb', 'icehockey_nhl'];
    
    for (const sportKey of sports) {
      if (!ODDS_API_KEY) break;
      try {
        const fetch = require('node-fetch');
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
        const resp = await fetch(url, { timeout: 10000 });
        if (resp.ok) {
          const data = await resp.json();
          oddsData.push(...data);
        }
      } catch (e) { /* skip this sport */ }
    }
    
    const result = await polymarketValue.crossMarketScan(oddsData);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Championship futures value scan
app.get('/api/polymarket/futures-value', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarketValue.scanFuturesValue(sport);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Polymarket value bridge status
app.get('/api/polymarket/value/status', (req, res) => {
  res.json(polymarketValue.getStatus());
});

// ==================== PLAYOFF SERIES PRICING ====================

// Full bracket projection with first-round series analysis
app.get('/api/playoffs/bracket', (req, res) => {
  try {
    const bracket = playoffSeries.projectBracket(nba);
    res.json({ 
      bracket, 
      daysUntilPlayoffs: bracket.daysUntilPlayoffs,
      timestamp: new Date().toISOString() 
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Analyze specific playoff series
app.get('/api/playoffs/series', (req, res) => {
  try {
    const { higher, lower } = req.query;
    if (!higher || !lower) return res.status(400).json({ error: 'Need ?higher=OKC&lower=POR' });
    const result = playoffSeries.analyzePlayoffSeries(nba, higher.toUpperCase(), lower.toUpperCase());
    if (result.error) return res.status(400).json(result);
    
    // Add exact length distribution
    const teams = nba.getTeams();
    const homeGamePred = nba.predict(lower.toUpperCase(), higher.toUpperCase());
    const awayGamePred = nba.predict(higher.toUpperCase(), lower.toUpperCase());
    const pHome = homeGamePred.homeWinProb / 100;
    const pAway = awayGamePred.awayWinProb / 100;
    const gameProbs = playoffSeries.SERIES_PATTERN_7.map(isHome => isHome ? pHome : pAway);
    result.exactLengthDist = playoffSeries.exactLengthDistribution(gameProbs);
    
    res.json({ series: result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full playoff simulation — championship odds for all 16 teams
app.get('/api/playoffs/championship', (req, res) => {
  try {
    const sims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    const result = playoffSeries.simulateFullPlayoffs(nba, sims);
    res.json({ ...result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Series value finder — compare model vs book odds
app.get('/api/playoffs/value', (req, res) => {
  try {
    // Accept matchups with book odds as JSON query param
    // ?matchups=[{"higher":"OKC","lower":"POR","bookHigherML":-800,"bookLowerML":550}]
    const matchupsStr = req.query.matchups;
    if (!matchupsStr) {
      return res.json({ 
        note: 'Pass ?matchups=[{"higher":"OKC","lower":"POR","bookHigherML":-800,"bookLowerML":550}]',
        example: '/api/playoffs/value?matchups=[{"higher":"OKC","lower":"POR","bookHigherML":-800,"bookLowerML":550}]'
      });
    }
    const matchups = JSON.parse(matchupsStr);
    const values = playoffSeries.findSeriesValue(nba, matchups);
    res.json({ valueBets: values, count: values.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== BET TRACKER API ====================

// Status
app.get('/api/bets/status', (req, res) => {
  res.json(betTracker.getStatus());
});

// Get analytics (MUST be before /api/bets/:id to avoid conflict)
app.get('/api/bets/analytics', (req, res) => {
  const filters = {};
  if (req.query.sport) filters.sport = req.query.sport;
  if (req.query.market) filters.market = req.query.market;
  if (req.query.since) filters.since = req.query.since;
  if (req.query.until) filters.until = req.query.until;
  if (req.query.confidence) filters.confidence = req.query.confidence;
  if (req.query.minEdge) filters.minEdge = parseFloat(req.query.minEdge);
  
  res.json(betTracker.getAnalytics(filters));
});

// Get all bets (with optional filters)
app.get('/api/bets', (req, res) => {
  const filters = {};
  if (req.query.sport) filters.sport = req.query.sport;
  if (req.query.market) filters.market = req.query.market;
  if (req.query.result) filters.result = req.query.result;
  if (req.query.date) filters.date = req.query.date;
  if (req.query.pending === 'true') filters.pending = true;
  if (req.query.source) filters.source = req.query.source;
  if (req.query.limit) filters.limit = parseInt(req.query.limit);
  
  const bets = betTracker.getBets(filters);
  res.json({ bets, count: bets.length, timestamp: new Date().toISOString() });
});

// Get single bet
app.get('/api/bets/:id', (req, res) => {
  const bet = betTracker.getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  res.json(bet);
});

// Add a bet
app.post('/api/bets', (req, res) => {
  try {
    const bet = betTracker.addBet(req.body);
    res.json({ success: true, bet });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Grade a bet
app.post('/api/bets/:id/grade', (req, res) => {
  const { result, closingOdds, score, notes } = req.body;
  const bet = betTracker.gradeBet(parseInt(req.params.id), result, { closingOdds, score, notes });
  if (bet.error) return res.status(404).json(bet);
  res.json({ success: true, bet });
});

// Update closing odds (for CLV)
app.post('/api/bets/:id/closing', (req, res) => {
  const { closingOdds } = req.body;
  const bet = betTracker.updateClosingOdds(parseInt(req.params.id), closingOdds);
  if (bet.error) return res.status(404).json(bet);
  res.json({ success: true, bet });
});

// Delete a bet
app.delete('/api/bets/:id', (req, res) => {
  const result = betTracker.deleteBet(parseInt(req.params.id));
  if (result.error) return res.status(404).json(result);
  res.json({ success: true, ...result });
});

// Auto-grade bets for a date
app.post('/api/bets/autograde', async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const result = await betTracker.autoGrade(date);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set bankroll
app.post('/api/bets/bankroll', (req, res) => {
  const { bankroll } = req.body;
  if (!bankroll || bankroll <= 0) return res.status(400).json({ error: 'Invalid bankroll amount' });
  res.json(betTracker.setBankroll(bankroll));
});

// Log a bet from model prediction
app.post('/api/bets/from-model', (req, res) => {
  try {
    const { prediction, odds, sport, stake, gameDate } = req.body;
    const bets = betTracker.logModelBet(prediction, odds, { sport, stake, gameDate });
    res.json({ success: true, bets, count: bets.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ==================== DAILY PICKS ENGINE ====================

app.get('/api/picks/today', async (req, res) => {
  try {
    // Check cache first
    const cached = dailyPicks.getCachedPicks();
    if (cached && !req.query.fresh) {
      return res.json(cached);
    }

    // Generate fresh picks
    const oddsData = await getAllOdds();
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.5;
    const minEdge = parseFloat(req.query.minEdge) || 0.02;

    const result = await dailyPicks.generateDailyPicks({
      nbaModel: nba,
      mlbModel: mlb,
      nhlModel: nhl,
      oddsData,
      lineMovementSvc: lineMovement,
      injurySvc: injuries,
      rollingSvc: rollingStats,
      weatherSvc: weather,
      propsSvc: playerProps,
      umpireSvc: umpireService,
      calibrationSvc: calibration,
      mlBridgeSvc: mlBridge,
      bankroll,
      kellyFraction,
      minEdge,
      maxPicks: parseInt(req.query.maxPicks) || 20
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/picks/history', (req, res) => {
  try {
    const history = dailyPicks.getPicksHistory();
    const limit = parseInt(req.query.limit) || 30;
    res.json({ history: history.slice(-limit), total: history.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/picks/best', async (req, res) => {
  try {
    // Quick endpoint — top 5 picks for today
    const cached = dailyPicks.getCachedPicks();
    let picks;
    
    if (cached) {
      picks = cached;
    } else {
      const oddsData = await getAllOdds();
      picks = await dailyPicks.generateDailyPicks({
        nbaModel: nba, mlbModel: mlb, nhlModel: nhl,
        oddsData,
        lineMovementSvc: lineMovement,
        injurySvc: injuries,
        rollingSvc: rollingStats,
        weatherSvc: weather,
        umpireSvc: umpireService,
        calibrationSvc: calibration,
        mlBridgeSvc: mlBridge,
        bankroll: parseFloat(req.query.bankroll) || 1000,
        kellyFraction: 0.5,
        minEdge: 0.03 // higher threshold for "best" picks
      });
    }

    // Filter to only strong+ picks
    const best = (picks.picks || []).filter(p => p.confidence >= 50).slice(0, 5);
    
    res.json({
      date: picks.date,
      bestPicks: best,
      count: best.length,
      summary: {
        totalScanned: picks.summary?.totalGamesScanned || 0,
        totalValue: picks.summary?.totalPicksFound || 0,
        avgConfidence: best.length > 0 ? +(best.reduce((s, p) => s + p.confidence, 0) / best.length).toFixed(1) : 0
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/picks/status', (req, res) => {
  const cached = dailyPicks.getCachedPicks();
  const history = dailyPicks.getPicksHistory();
  res.json({
    hasCachedPicks: !!cached,
    cachedDate: cached ? cached.date : null,
    cachedPicksCount: cached ? cached.picks.length : 0,
    historyDays: history.length,
    lastGenerated: cached ? cached.summary?.generated : null
  });
});

// Fetch scores (for manual inspection)
app.get('/api/scores/:sport', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const scores = await betTracker.fetchScores(req.params.sport, date);
    res.json({ scores, count: scores.length, date, sport: req.params.sport });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== REST/TRAVEL ENDPOINTS ====================

// ==================== UMPIRE TENDENCIES API ====================
app.get('/api/umpire/status', (req, res) => {
  res.json(umpireService.getStatus());
});

app.get('/api/umpire/lookup/:name', (req, res) => {
  const ump = umpireService.getUmpire(decodeURIComponent(req.params.name));
  if (!ump) return res.status(404).json({ error: 'Umpire not found', searched: req.params.name });
  const runsAdj = umpireService.calcTotalRunsMultiplier(ump);
  const propsAdj = umpireService.calcPitcherPropAdj(ump);
  res.json({ umpire: ump, totalRunsAdj: runsAdj, pitcherPropsAdj: propsAdj });
});

app.get('/api/umpire/today', async (req, res) => {
  try {
    const data = await umpireService.getAllGameAdjustments();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/umpire/edges', async (req, res) => {
  try {
    const edges = await umpireService.getTopUmpireEdges();
    res.json(edges);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/umpire/game/:away/:home', async (req, res) => {
  try {
    const { away, home } = req.params;
    const umpireName = req.query.umpire;
    const adj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), umpireName);
    res.json(adj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rest-travel/status', (req, res) => {
  res.json(restTravelService.getStatus());
});

app.get('/api/rest-travel/:team', async (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const gameDate = req.query.gameDate || new Date().toISOString().split('T')[0];
    const [rest, bullpen] = await Promise.all([
      restTravelService.getRestTravelAdjustment(team, gameDate),
      restTravelService.getBullpenFatigue(team)
    ]);
    res.json({ team, gameDate, rest, bullpenFatigue: bullpen });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rest-travel/matchup/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const gameDate = req.query.gameDate || new Date().toISOString().split('T')[0];
    const result = await restTravelService.getMatchupAdjustments(away, home, gameDate);
    res.json({ away, home, gameDate, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== UNIFIED SIGNAL CHECK ====================
// The pre-bet check: aggregates ALL factors for a specific game
app.get('/api/signal-check/:sport/:away/:home', async (req, res) => {
  try {
    const sport = req.params.sport.toUpperCase();
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    
    const signals = {
      sport, away, home, timestamp: new Date().toISOString(),
      prediction: null,
      weather: null,
      umpire: null,
      restTravel: null,
      injuries: { home: null, away: null },
      rolling: { home: null, away: null },
      lineMovement: null,
      monteCarlo: null,
      calibration: null,
      verdict: null
    };
    
    if (sport === 'MLB') {
      // Full async predict with all factors
      const opts = {};
      
      // Weather
      try {
        const wd = await weather.getWeatherForPark(home);
        if (wd && !wd.error) {
          opts.weather = wd;
          signals.weather = {
            park: wd.park,
            dome: wd.dome,
            multiplier: wd.multiplier,
            totalImpact: wd.totalImpact,
            description: wd.description,
            factors: wd.factors,
            conditions: wd.weather
          };
        }
      } catch (e) { signals.weather = { error: e.message }; }
      
      // Umpire
      try {
        const umpAdj = await umpireService.getGameUmpireAdjustment(away, home, req.query.umpire);
        if (umpAdj) {
          if (umpAdj.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
          signals.umpire = {
            name: umpAdj.umpire?.name || req.query.umpire || 'Unknown',
            zone: umpAdj.umpire?.zone || 'N/A',
            totalRunsAdj: umpAdj.totalRunsAdj,
            pitcherPropsAdj: umpAdj.pitcherPropsAdj,
            impact: umpAdj.totalRunsAdj ? `${((umpAdj.totalRunsAdj.multiplier - 1) * 100).toFixed(1)}% runs` : 'neutral'
          };
        }
      } catch (e) { signals.umpire = { error: e.message }; }
      
      // Prediction (async = rest/travel + MC)
      try {
        const rawPred = await mlb.asyncPredict(away, home, opts);
        if (rawPred && !rawPred.error) {
          const calPred = calibration.calibratePrediction(rawPred, 'mlb');
          signals.prediction = {
            homeWinProb: calPred.blendedHomeWinProb || calPred.homeWinProb,
            awayWinProb: calPred.blendedAwayWinProb || calPred.awayWinProb,
            homeML: calPred.blendedHomeML || calPred.homeML,
            awayML: calPred.blendedAwayML || calPred.awayML,
            totalRuns: calPred.totalRuns,
            homeExpRuns: calPred.homeExpRuns,
            awayExpRuns: calPred.awayExpRuns,
            homePower: calPred.homePower,
            awayPower: calPred.awayPower,
            parkFactor: calPred.parkFactor,
            factors: calPred.factors
          };
          if (calPred.monteCarlo) {
            signals.monteCarlo = {
              totalRuns: calPred.monteCarlo.totalRuns,
              homeWinProb: calPred.monteCarlo.homeWinProb,
              simCount: calPred.monteCarlo.simCount || 10000
            };
          }
          signals.calibration = {
            applied: true,
            sport: 'mlb',
            note: 'Probabilities calibrated for historical accuracy'
          };
        }
      } catch (e) { signals.prediction = { error: e.message }; }
      
      // Rest/Travel
      try {
        const rt = await restTravelService.getMatchupAdjustments(away, home);
        if (rt) signals.restTravel = rt;
      } catch (e) { signals.restTravel = { error: e.message }; }
      
    } else if (sport === 'NBA') {
      try {
        const rawPred = nba.predict(away, home, { awayB2B: req.query.awayB2B === 'true', homeB2B: req.query.homeB2B === 'true' });
        if (rawPred && !rawPred.error) {
          const calPred = calibration.calibratePrediction(rawPred, 'nba');
          signals.prediction = {
            homeWinProb: calPred.homeWinProb,
            awayWinProb: calPred.awayWinProb,
            spread: calPred.spread,
            totalPoints: calPred.totalPoints,
            homePower: calPred.homePower,
            awayPower: calPred.awayPower
          };
        }
      } catch (e) { signals.prediction = { error: e.message }; }
      
    } else if (sport === 'NHL') {
      try {
        const rawPred = nhl.predict(away, home);
        if (rawPred) {
          signals.prediction = {
            homeWinProb: rawPred.home?.winProb,
            awayWinProb: rawPred.away?.winProb,
            totalGoals: rawPred.totalGoals,
            homePower: rawPred.home?.power,
            awayPower: rawPred.away?.power
          };
        }
      } catch (e) { signals.prediction = { error: e.message }; }
    }
    
    // Cross-sport signals
    try {
      const homeInj = injuries.getInjuryAdjustment(sport.toLowerCase(), home);
      const awayInj = injuries.getInjuryAdjustment(sport.toLowerCase(), away);
      signals.injuries.home = homeInj;
      signals.injuries.away = awayInj;
    } catch (e) {}
    
    try {
      signals.rolling.home = rollingStats.getRollingAdjustment(sport.toLowerCase(), home);
      signals.rolling.away = rollingStats.getRollingAdjustment(sport.toLowerCase(), away);
    } catch (e) {}
    
    try {
      const sharpSignals = lineMovement.getSharpSignals();
      signals.lineMovement = sharpSignals.filter(s => 
        s.gameId && (s.gameId.includes(home) || s.gameId.includes(away))
      );
    } catch (e) {}
    
    // Generate verdict
    const pred = signals.prediction;
    if (pred && !pred.error) {
      const factors = [];
      const homeProb = pred.homeWinProb || (pred.homeWinProb && pred.homeWinProb / 100);
      
      if (homeProb > 0.58) factors.push(`${home} strong favorite (${(homeProb * 100).toFixed(1)}%)`);
      else if (homeProb < 0.42) factors.push(`${away} strong favorite (${((1 - homeProb) * 100).toFixed(1)}%)`);
      
      if (signals.weather?.multiplier > 1.03) factors.push('Weather boosts scoring');
      if (signals.weather?.multiplier < 0.97) factors.push('Weather suppresses scoring');
      if (signals.umpire?.totalRunsAdj?.multiplier > 1.02) factors.push('Umpire zone favors hitters');
      if (signals.umpire?.totalRunsAdj?.multiplier < 0.98) factors.push('Umpire zone favors pitchers');
      
      const homeInjCount = signals.injuries.home?.starPlayersOut?.length || 0;
      const awayInjCount = signals.injuries.away?.starPlayersOut?.length || 0;
      if (homeInjCount > awayInjCount) factors.push(`${home} has more key injuries (${homeInjCount} vs ${awayInjCount})`);
      if (awayInjCount > homeInjCount) factors.push(`${away} has more key injuries (${awayInjCount} vs ${homeInjCount})`);
      
      signals.verdict = {
        factors,
        signalCount: Object.values(signals).filter(v => v !== null && !v?.error).length,
        note: 'All available signals aggregated. Use with live odds for edge detection.'
      };
    }
    
    res.json(signals);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MONTE CARLO ENDPOINTS ====================

app.get('/api/simulate/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const numSims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    
    // Get expected runs from MLB model
    const pred = mlb.predict(away, home, { monteCarlo: false });
    if (!pred || pred.error) return res.status(400).json({ error: pred?.error || 'Invalid teams' });
    
    // Run simulation
    const simOpts = { numSims };
    
    // Get bullpen fatigue if available
    try {
      const matchupAdj = await restTravelService.getMatchupAdjustments(away, home);
      simOpts.awayBullpenMult = matchupAdj.away.bullpenFatigue?.multiplier || 1.0;
      simOpts.homeBullpenMult = matchupAdj.home.bullpenFatigue?.multiplier || 1.0;
    } catch (e) { /* optional */ }
    
    const sim = monteCarloService.simulate(pred.awayExpRuns, pred.homeExpRuns, simOpts);
    
    res.json({
      matchup: `${away} @ ${home}`,
      awayExpRuns: pred.awayExpRuns,
      homeExpRuns: pred.homeExpRuns,
      analyticalHomeWinProb: pred.homeWinProb,
      simulation: sim,
      awayPitcher: pred.awayPitcher || null,
      homePitcher: pred.homePitcher || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SGP CORRELATION ENGINE ====================

app.get('/api/sgp/status', (req, res) => {
  res.json(sgpEngine.getStatus());
});

// SGP analysis for a specific game
app.get('/api/sgp/game/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const sport = (req.query.sport || 'mlb').toLowerCase();
    
    // Get prediction
    let prediction;
    const opts = {};
    
    if (req.query.awayPitcher) opts.awayPitcher = req.query.awayPitcher;
    if (req.query.homePitcher) opts.homePitcher = req.query.homePitcher;
    
    // Fetch weather for MLB
    if (sport === 'mlb') {
      try {
        const wd = await weather.getWeatherForPark(home);
        if (wd && !wd.error) opts.weather = wd;
      } catch (e) { /* optional */ }
    }
    
    if (sport === 'mlb') {
      prediction = await mlb.asyncPredict(away, home, opts);
    } else if (sport === 'nba') {
      prediction = nba.predict(away, home, opts);
    } else if (sport === 'nhl') {
      prediction = nhl.predict(away, home, opts);
    } else {
      return res.status(400).json({ error: `Unknown sport: ${sport}` });
    }
    
    if (prediction.error) return res.status(400).json(prediction);
    
    // Get odds for this game
    let gameOdds = {};
    try {
      const allOdds = await getAllOdds();
      const match = allOdds.find(g => {
        const ga = (g.awayAbbr || g.away || '').toUpperCase();
        const gh = (g.homeAbbr || g.home || '').toUpperCase();
        return ga === away && gh === home;
      });
      if (match) gameOdds = match;
    } catch (e) { /* no odds */ }
    
    const normalizedOdds = {
      homeML: gameOdds.homeOdds || gameOdds.homeML || prediction.homeML,
      awayML: gameOdds.awayOdds || gameOdds.awayML || prediction.awayML,
      total: gameOdds.total || null,
      overOdds: gameOdds.overOdds || -110,
      underOdds: gameOdds.underOdds || -110,
      overProb: gameOdds.overOdds ? mlToProb(gameOdds.overOdds) : 0.5,
      underProb: gameOdds.underOdds ? mlToProb(gameOdds.underOdds) : 0.5,
      homeSpread: gameOdds.homeSpread || (sport === 'mlb' ? -1.5 : null),
      awaySpread: gameOdds.awaySpread || (sport === 'mlb' ? 1.5 : null),
      homeSpreadOdds: gameOdds.homeSpreadOdds || -110,
      awaySpreadOdds: gameOdds.awaySpreadOdds || -110,
      homeSpreadProb: gameOdds.homeSpreadOdds ? mlToProb(gameOdds.homeSpreadOdds) : 0.5,
      awaySpreadProb: gameOdds.awaySpreadOdds ? mlToProb(gameOdds.awaySpreadOdds) : 0.5,
    };
    
    const sgpCombos = sgpEngine.buildSGPCombos(prediction, normalizedOdds, {
      minLegEdge: parseFloat(req.query.minEdge) || -0.03,
      minComboEdge: parseFloat(req.query.minComboEdge) || 0.02,
    });
    
    res.json({
      game: `${away} @ ${home}`,
      sport: sport.toUpperCase(),
      prediction: {
        homeWinProb: prediction.homeWinProb,
        awayWinProb: prediction.awayWinProb,
        totalRuns: prediction.totalRuns,
        homeExpRuns: prediction.homeExpRuns,
        awayExpRuns: prediction.awayExpRuns,
        homePitcher: prediction.homePitcher?.name || null,
        awayPitcher: prediction.awayPitcher?.name || null,
      },
      odds: normalizedOdds,
      sgpCombos: sgpCombos,
      count: sgpCombos.length,
      bestEV: sgpCombos.length > 0 ? sgpCombos[0].ev : 0,
      topPick: sgpCombos.length > 0 ? sgpCombos[0].description : null,
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan all games for SGP opportunities
app.get('/api/sgp/scan', async (req, res) => {
  try {
    const sport = (req.query.sport || 'all').toLowerCase();
    const results = { timestamp: new Date().toISOString(), sports: {}, allCombos: [] };
    
    const sports = sport === 'all' ? ['mlb', 'nba', 'nhl'] : [sport];
    
    for (const s of sports) {
      try {
        const sportModel = s === 'mlb' ? mlb : s === 'nba' ? nba : nhl;
        const scanResult = await sgpEngine.scanSGPs(s, { mlb, nba, nhl }, getAllOdds);
        results.sports[s.toUpperCase()] = scanResult.summary;
        results.allCombos.push(...scanResult.combos);
      } catch (e) {
        results.sports[s.toUpperCase()] = { error: e.message };
      }
    }
    
    // Sort all combos by EV
    results.allCombos.sort((a, b) => b.ev - a.ev);
    
    // Top picks across all sports
    results.topPicks = results.allCombos.slice(0, 10).map(c => ({
      description: c.description,
      game: c.game,
      sport: c.sport,
      ev: c.ev,
      confidence: c.confidence,
      correlation: c.correlation,
      bookOdds: c.bookOdds,
      fairOdds: c.fairOdds,
      halfKelly: c.halfKelly,
      reasoning: c.reasoning,
    }));
    
    results.totalCombos = results.allCombos.length;
    results.highConfCount = results.allCombos.filter(c => c.confidence >= 60).length;
    
    // Don't return all combos in summary — too large
    delete results.allCombos;
    
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan SGP for specific sport with full combo details
app.get('/api/sgp/scan/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    if (!['mlb', 'nba', 'nhl'].includes(sport)) {
      return res.status(400).json({ error: `Invalid sport: ${sport}` });
    }
    
    const scanResult = await sgpEngine.scanSGPs(sport, { mlb, nba, nhl }, getAllOdds);
    
    // Return top 25 combos with full details
    const topCombos = scanResult.combos.slice(0, 25);
    
    res.json({
      sport: sport.toUpperCase(),
      summary: scanResult.summary,
      combos: topCombos,
      timestamp: scanResult.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Helper for SGP endpoints
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

// ==================== TRAVEL DISTANCE ====================

app.get('/api/travel/:from/:to', (req, res) => {
  const from = req.params.from.toUpperCase();
  const to = req.params.to.toUpperCase();
  const distance = restTravelService.getDistance(from, to);
  const tzShift = restTravelService.getTimezoneShift(from, to);
  res.json({ from, to, distanceMiles: distance, timezoneShift: tzShift });
});

// ==================== ALT LINES SCANNER ====================

// Alt lines analysis for a specific matchup
app.get('/api/alt-lines/:sport/:away/:home', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const awayParam = req.params.away.toUpperCase();
    const homeParam = req.params.home.toUpperCase();
    
    let prediction;
    if (sport === 'mlb') {
      prediction = await mlb.asyncPredict(awayParam, homeParam, {
        awayPitcher: req.query.awayPitcher,
        homePitcher: req.query.homePitcher
      });
    } else if (sport === 'nba') {
      prediction = nba.predict(awayParam, homeParam);
    } else if (sport === 'nhl') {
      prediction = nhl.predict(awayParam, homeParam);
    } else {
      return res.status(400).json({ error: `Unknown sport: ${sport}` });
    }
    
    if (prediction.error) return res.status(400).json(prediction);
    
    const analysis = altLines.analyzeMatchupAltLines(prediction);
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan alt lines across all games for a sport (uses live odds)
app.get('/api/alt-lines/scan/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    const minEV = parseFloat(req.query.minEV) || 3;
    
    // Generate predictions for all teams
    let predictions = [];
    let model;
    if (sport === 'mlb') model = mlb;
    else if (sport === 'nba') model = nba;
    else if (sport === 'nhl') model = nhl;
    else return res.status(400).json({ error: `Unknown sport: ${sport}` });
    
    // Fetch current odds to know which games are being played
    const sportKeys = { mlb: 'baseball_mlb', nba: 'basketball_nba', nhl: 'icehockey_nhl' };
    const sportKey = sportKeys[sport];
    
    // First fetch basic odds to get today's games
    let todayGames = [];
    if (ODDS_API_KEY) {
      try {
        const fetch = require('node-fetch');
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
        const resp = await fetch(url, { timeout: 15000 });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) todayGames = data;
        }
      } catch (e) { /* fallback below */ }
    }
    
    // Build name maps for matching
    const teams = model.getTeams();
    const nameMap = {};
    for (const [abbr, t] of Object.entries(teams)) {
      nameMap[t.name.toLowerCase()] = abbr;
      const parts = t.name.split(' ');
      nameMap[parts[parts.length - 1].toLowerCase()] = abbr;
    }
    
    // Generate predictions for games with odds
    for (const game of todayGames) {
      let awayAbbr = null, homeAbbr = null;
      for (const [name, abbr] of Object.entries(nameMap)) {
        if (game.away_team.toLowerCase().includes(name)) awayAbbr = abbr;
        if (game.home_team.toLowerCase().includes(name)) homeAbbr = abbr;
      }
      if (awayAbbr && homeAbbr) {
        try {
          let pred;
          if (sport === 'mlb') pred = await mlb.asyncPredict(awayAbbr, homeAbbr);
          else pred = model.predict(awayAbbr, homeAbbr);
          if (!pred.error) predictions.push(pred);
        } catch (e) { /* skip game */ }
      }
    }
    
    const result = await altLines.scanAltLines(sport, predictions, { minEdge, minEV });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan alt lines for ALL sports
app.get('/api/alt-lines/scan', async (req, res) => {
  try {
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    const minEV = parseFloat(req.query.minEV) || 3;
    const results = {};
    
    for (const sport of ['mlb', 'nba', 'nhl']) {
      try {
        const model = sport === 'mlb' ? mlb : sport === 'nba' ? nba : nhl;
        const sportKeys = { mlb: 'baseball_mlb', nba: 'basketball_nba', nhl: 'icehockey_nhl' };
        
        let predictions = [];
        if (ODDS_API_KEY) {
          const fetch = require('node-fetch');
          const url = `https://api.the-odds-api.com/v4/sports/${sportKeys[sport]}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
          try {
            const resp = await fetch(url, { timeout: 15000 });
            if (resp.ok) {
              const data = await resp.json();
              if (Array.isArray(data)) {
                const teams = model.getTeams();
                const nameMap = {};
                for (const [abbr, t] of Object.entries(teams)) {
                  nameMap[t.name.toLowerCase()] = abbr;
                  const parts = t.name.split(' ');
                  nameMap[parts[parts.length - 1].toLowerCase()] = abbr;
                }
                for (const game of data) {
                  let awayAbbr = null, homeAbbr = null;
                  for (const [name, abbr] of Object.entries(nameMap)) {
                    if (game.away_team.toLowerCase().includes(name)) awayAbbr = abbr;
                    if (game.home_team.toLowerCase().includes(name)) homeAbbr = abbr;
                  }
                  if (awayAbbr && homeAbbr) {
                    try {
                      let pred;
                      if (sport === 'mlb') pred = await mlb.asyncPredict(awayAbbr, homeAbbr);
                      else pred = model.predict(awayAbbr, homeAbbr);
                      if (!pred.error) predictions.push(pred);
                    } catch (e) { /* skip */ }
                  }
                }
              }
            }
          } catch (e) { /* skip sport */ }
        }
        
        results[sport] = await altLines.scanAltLines(sport, predictions, { minEdge, minEV });
      } catch (e) {
        results[sport] = { error: e.message, valueBets: [] };
      }
    }
    
    // Aggregate
    const allBets = [];
    for (const [sport, data] of Object.entries(results)) {
      if (data.allValueBets) {
        allBets.push(...data.allValueBets.map(b => ({ ...b, sport })));
      }
    }
    allBets.sort((a, b) => b.ev - a.ev);
    
    res.json({
      totalValueBets: allBets.length,
      highConfidence: allBets.filter(b => b.confidence === 'HIGH').length,
      topBets: allBets.slice(0, 30),
      bySport: results,
      scannedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start server

// ==================== ML ENGINE ENDPOINTS ====================

app.get('/api/ml/status', async (req, res) => {
  try {
    const bridgeStatus = mlBridge.getStatus();
    let engineStatus;
    try { engineStatus = await mlBridge.status(req.query.sport || 'mlb'); } catch (e) { engineStatus = { error: e.message }; }
    res.json({ bridge: bridgeStatus, engine: engineStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ml/train', async (req, res) => {
  try {
    const sport = req.query.sport || 'mlb';
    const result = await mlBridge.train(sport);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/train', async (req, res) => {
  try {
    const sport = req.query.sport || 'mlb';
    const result = await mlBridge.train(sport);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/predict', async (req, res) => {
  try {
    const { away, home, awayPitcher, homePitcher, sport } = req.query;
    if (!away || !home) return res.status(400).json({ error: 'Need away and home team abbreviations' });
    const result = await mlBridge.enhancedPredict(away.toUpperCase(), home.toUpperCase(), {
      awayPitcher, homePitcher,
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/backtest', async (req, res) => {
  try {
    const sport = req.query.sport || 'mlb';
    const result = await mlBridge.backtest(sport);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/compare/:away/:home', async (req, res) => {
  try {
    const { away, home } = req.params;
    const awayUpper = away.toUpperCase();
    const homeUpper = home.toUpperCase();
    
    // Get all prediction methods
    const analyticalSync = mlb.predict(awayUpper, homeUpper);
    let analyticalAsync, mlEnhanced;
    try { analyticalAsync = await mlb.asyncPredict(awayUpper, homeUpper); } catch (e) { analyticalAsync = { error: e.message }; }
    try { mlEnhanced = await mlBridge.enhancedPredict(awayUpper, homeUpper); } catch (e) { mlEnhanced = { error: e.message }; }
    
    res.json({
      game: `${awayUpper} @ ${homeUpper}`,
      comparison: {
        analytical_sync: {
          homeWinProb: analyticalSync.homeWinProb,
          awayWinProb: analyticalSync.awayWinProb,
          totalRuns: analyticalSync.totalRuns,
          source: 'Pythagorean + Log5 + pitcher adj',
        },
        analytical_async: {
          homeWinProb: analyticalAsync.homeWinProb || analyticalAsync.error,
          awayWinProb: analyticalAsync.awayWinProb,
          totalRuns: analyticalAsync.totalRuns,
          source: 'Analytical + rest/travel + Monte Carlo',
        },
        ml_enhanced: {
          homeWinProb: mlEnhanced.blendedHomeWinProb || mlEnhanced.homeWinProb || mlEnhanced.error,
          awayWinProb: mlEnhanced.blendedAwayWinProb || mlEnhanced.awayWinProb,
          mlRaw: mlEnhanced.ml,
          totalRuns: mlEnhanced.totalRuns,
          predictedTotal: mlEnhanced.ml?.predictedTotal,
          source: 'ML Ensemble (LR+GB+RF) blended with analytical',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== HISTORICAL DATA + ML TRAINING DATA ====================

app.get('/api/historical/status', (req, res) => {
  res.json(historicalGames.getStats());
});

app.get('/api/historical/fetch', async (req, res) => {
  try {
    const { start, end, max } = req.query;
    const data = await historicalGames.getTrainingData({
      startDate: start || '2024-04-01',
      endDate: end || '2024-09-29',
      maxGames: max ? parseInt(max) : null,
    });
    res.json({ 
      games: data.length, 
      sample: data.slice(0, 5),
      homeWinRate: +(data.filter(g => g.homeWon).length / data.length * 100).toFixed(1),
      avgTotal: +(data.reduce((s, g) => s + (g.actualTotal || 0), 0) / data.length).toFixed(1),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ML-Enhanced Opening Day predictions (combines analytical + ML + Statcast)
app.get('/api/ml/opening-day', async (req, res) => {
  try {
    const projections = await mlbOpeningDay.getProjections();
    const mlPredictions = [];
    
    for (const game of projections) {
      try {
        const mlResult = await mlBridge.enhancedPredict(game.away, game.home, {
          awayPitcher: game.awayPitcher || game.confirmedStarters?.away,
          homePitcher: game.homePitcher || game.confirmedStarters?.home,
        });
        
        mlPredictions.push({
          away: game.away,
          home: game.home,
          date: game.date,
          time: game.time,
          analytical: {
            homeWinProb: game.homeWinProb,
            awayWinProb: game.awayWinProb,
            totalRuns: game.totalRuns || game.expectedTotal,
          },
          ml: mlResult.ml || null,
          blended: {
            homeWinProb: mlResult.blendedHomeWinProb || game.homeWinProb,
            awayWinProb: mlResult.blendedAwayWinProb || game.awayWinProb,
          },
          starters: game.confirmedStarters,
          dkLine: game.dkLine,
          edge: calculateEdge(
            mlResult.blendedHomeWinProb || game.homeWinProb,
            game.dkLine
          ),
          statcast: mlResult.statcast || null,
        });
      } catch (e) {
        // ML failed for this game — use analytical only
        mlPredictions.push({
          away: game.away,
          home: game.home,
          date: game.date,
          time: game.time,
          analytical: {
            homeWinProb: game.homeWinProb,
            awayWinProb: game.awayWinProb,
            totalRuns: game.totalRuns || game.expectedTotal,
          },
          ml: null,
          blended: {
            homeWinProb: game.homeWinProb,
            awayWinProb: game.awayWinProb,
          },
          starters: game.confirmedStarters,
          dkLine: game.dkLine,
          edge: calculateEdge(game.homeWinProb, game.dkLine),
          mlError: e.message,
        });
      }
    }
    
    // Sort by absolute edge (best bets first)
    mlPredictions.sort((a, b) => {
      const aEdge = Math.max(Math.abs(a.edge?.homeEdge || 0), Math.abs(a.edge?.awayEdge || 0));
      const bEdge = Math.max(Math.abs(b.edge?.homeEdge || 0), Math.abs(b.edge?.awayEdge || 0));
      return bEdge - aEdge;
    });
    
    res.json({
      timestamp: new Date().toISOString(),
      openingDay: '2026-03-26',
      daysUntil: Math.ceil((new Date('2026-03-26') - new Date()) / (1000 * 60 * 60 * 24)),
      games: mlPredictions,
      mlStatus: mlBridge.getStatus(),
      bestBets: mlPredictions.filter(g => {
        const maxEdge = Math.max(Math.abs(g.edge?.homeEdge || 0), Math.abs(g.edge?.awayEdge || 0));
        return maxEdge >= 3;
      }).slice(0, 5),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function calculateEdge(homeWinProb, dkLine) {
  if (!dkLine || !homeWinProb) return { homeEdge: 0, awayEdge: 0 };
  
  function mlToProb(ml) {
    if (ml < 0) return (-ml) / (-ml + 100);
    return 100 / (ml + 100);
  }
  
  const bookHomeProb = mlToProb(dkLine.homeML);
  const bookAwayProb = mlToProb(dkLine.awayML);
  const awayWinProb = 1 - homeWinProb;
  
  return {
    homeEdge: +((homeWinProb - bookHomeProb) * 100).toFixed(1),
    awayEdge: +((awayWinProb - bookAwayProb) * 100).toFixed(1),
    bestSide: (homeWinProb - bookHomeProb) > (awayWinProb - bookAwayProb) ? 'home' : 'away',
  };
}

// ==================== ARBITRAGE / LOW-HOLD SCANNER ====================

app.get('/api/arb/scan', async (req, res) => {
  try {
    // Check cache first
    const cached = arbitrage.getCachedScan();
    if (cached && !req.query.force) {
      return res.json({ ...cached, source: 'cache' });
    }
    
    const results = await arbitrage.scanAll(fetchOdds);
    res.json({ ...results, source: 'live' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/arb/scan/:sport', async (req, res) => {
  try {
    const sportMap = {
      'nba': 'basketball_nba',
      'mlb': 'baseball_mlb',
      'nhl': 'icehockey_nhl'
    };
    const sportKey = sportMap[req.params.sport.toLowerCase()];
    if (!sportKey) return res.status(400).json({ error: 'Sport must be nba, mlb, or nhl' });
    
    const odds = await fetchOdds(sportKey);
    const results = await arbitrage.scanSport(sportKey, odds);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/arb/report', async (req, res) => {
  try {
    const cached = arbitrage.getCachedScan();
    let results;
    if (cached && !req.query.force) {
      results = cached;
    } else {
      results = await arbitrage.scanAll(fetchOdds);
    }
    const report = arbitrage.generateReport(results);
    res.type('text').send(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/arb/calc', (req, res) => {
  const { odds1, odds2, stake } = req.query;
  if (!odds1 || !odds2) return res.status(400).json({ error: 'odds1 and odds2 required' });
  
  const o1 = parseInt(odds1);
  const o2 = parseInt(odds2);
  const totalStake = parseFloat(stake) || 1000;
  
  const hold = arbitrage.calculateHold(o1, o2);
  const arbProfit = arbitrage.calculateArbProfit(o1, o2);
  const stakes = arbitrage.calculateArbStakes(o1, o2, totalStake);
  
  res.json({
    odds: { side1: o1, side2: o2 },
    hold,
    arb: arbProfit,
    stakes,
    isArb: hold && hold.hold < 0,
    timestamp: new Date().toISOString()
  });
});

// ==================== ML-ENHANCED EDGE SCANNER ====================

// Ultimate edge scanner: compares analytical, ML, MC, and book prices
// This is where the money is — disagreements between models are the signal
app.get('/api/edge-scanner/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const sportKey = sport === 'nba' ? 'basketball_nba' : sport === 'mlb' ? 'baseball_mlb' : sport === 'nhl' ? 'ice_hockey_nhl' : null;
    if (!sportKey) return res.status(400).json({ error: 'Sport must be nba, mlb, or nhl' });

    const model = sport === 'nba' ? nba : sport === 'mlb' ? mlb : nhl;
    const nameMap = buildNameMap(model.TEAMS || model.getTeams(), {
      'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR',
      'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI'
    });
    
    const liveOdds = await fetchOdds(sportKey);
    const edges = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;

      // Get analytical prediction
      let analyticalPred = null;
      try {
        if (sport === 'mlb' && mlb.asyncPredict) {
          analyticalPred = await mlb.asyncPredict(awayAbbr, homeAbbr);
        } else {
          analyticalPred = model.predict(awayAbbr, homeAbbr);
        }
        if (analyticalPred?.error) analyticalPred = null;
        // Calibrate
        if (analyticalPred && calibration) {
          analyticalPred = calibration.calibratePrediction(analyticalPred, sport);
        }
      } catch (e) { /* skip */ }
      if (!analyticalPred) continue;

      // Get ML prediction
      let mlPred = null;
      if (sport === 'mlb') {
        try {
          const mlResult = await mlBridge.enhancedPredict(awayAbbr, homeAbbr);
          if (mlResult?.ml) mlPred = mlResult;
        } catch (e) { /* ML optional */ }
      }

      // Extract best book lines
      const bestBook = extractBookLine(game.bookmakers?.[0], game.home_team);
      if (!bestBook) continue;

      // Multi-source probability comparison
      const sources = {
        analytical: {
          homeWinProb: analyticalPred.homeWinProb,
          awayWinProb: analyticalPred.awayWinProb,
        },
        book: {
          homeWinProb: bestBook.homeML ? mlToProb(bestBook.homeML) : null,
          awayWinProb: bestBook.awayML ? mlToProb(bestBook.awayML) : null,
        },
      };

      if (mlPred?.ml) {
        sources.ml = {
          homeWinProb: mlPred.ml.homeWinProb,
          awayWinProb: mlPred.ml.awayWinProb,
          confidence: mlPred.ml.confidence,
          modelAgreement: mlPred.ml.modelAgreement,
        };
        sources.blended = {
          homeWinProb: mlPred.blendedHomeWinProb,
          awayWinProb: mlPred.blendedAwayWinProb,
        };
      }

      if (analyticalPred.monteCarlo) {
        sources.monteCarlo = {
          homeWinProb: analyticalPred.monteCarlo.homeWinProb,
          awayWinProb: analyticalPred.monteCarlo.awayWinProb,
          totalRuns: analyticalPred.monteCarlo.totalRuns?.mean,
        };
      }

      // Calculate edges from all sources vs books
      const blended = sources.blended || sources.analytical;
      const bookHome = sources.book.homeWinProb || 0.5;
      const bookAway = sources.book.awayWinProb || 0.5;

      const homeEdge = blended.homeWinProb - bookHome;
      const awayEdge = blended.awayWinProb - bookAway;
      const maxEdge = Math.max(Math.abs(homeEdge), Math.abs(awayEdge));

      // Model agreement score: how many sources agree on the pick direction
      let agreementCount = 0;
      const pickDirection = homeEdge > awayEdge ? 'home' : 'away';
      if (pickDirection === 'home') {
        if (sources.analytical.homeWinProb > bookHome) agreementCount++;
        if (sources.ml?.homeWinProb > bookHome) agreementCount++;
        if (sources.monteCarlo?.homeWinProb > bookHome) agreementCount++;
      } else {
        if (sources.analytical.awayWinProb > bookAway) agreementCount++;
        if (sources.ml?.awayWinProb > bookAway) agreementCount++;
        if (sources.monteCarlo?.awayWinProb > bookAway) agreementCount++;
      }

      edges.push({
        game: `${awayAbbr} @ ${homeAbbr}`,
        commence: game.commence_time,
        sources,
        bestPick: {
          side: pickDirection,
          team: pickDirection === 'home' ? homeAbbr : awayAbbr,
          edge: +(pickDirection === 'home' ? homeEdge : awayEdge).toFixed(4),
          ml: pickDirection === 'home' ? bestBook.homeML : bestBook.awayML,
          modelProb: +(pickDirection === 'home' ? blended.homeWinProb : blended.awayWinProb).toFixed(4),
          bookProb: +(pickDirection === 'home' ? bookHome : bookAway).toFixed(4),
        },
        modelAgreement: `${agreementCount}/${sources.ml ? 3 : sources.monteCarlo ? 2 : 1}`,
        maxEdge: +maxEdge.toFixed(4),
        totalAnalytical: analyticalPred.totalRuns || null,
        totalMC: analyticalPred.monteCarlo?.totalRuns?.mean || null,
        totalML: mlPred?.ml?.predictedTotal || null,
      });
    }

    // Sort by max edge
    edges.sort((a, b) => b.maxEdge - a.maxEdge);

    res.json({
      sport: sport.toUpperCase(),
      timestamp: new Date().toISOString(),
      totalGames: edges.length,
      edges,
      strongEdges: edges.filter(e => e.maxEdge >= 0.05),
      mlEnabled: sport === 'mlb',
      note: 'Edge = model probability - book implied probability. Positive = value bet. Model agreement shows how many independent models agree on the pick direction.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quick helper for edge scanner (mlToProb already defined above)

// ==================== STATCAST ENDPOINTS ====================

// Pitcher Statcast lookup — individual pitcher xERA/xwOBA analysis
app.get('/api/statcast/pitcher/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const result = statcast.getStatcastPitcherAdjustment(name);
    if (!result) return res.json({ error: `No Statcast data for "${name}"`, note: 'Try /api/statcast/refresh first, or check exact name spelling' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Team batting Statcast — xwOBA-based offensive quality
app.get('/api/statcast/team/:abbr', (req, res) => {
  try {
    const abbr = req.params.abbr.toUpperCase();
    const result = statcast.getTeamBattingStatcast(abbr);
    if (!result) return res.json({ error: `No Statcast batting data for ${abbr}` });
    res.json({ team: abbr, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Regression candidates — THE EDGE: pitchers who will regress
app.get('/api/statcast/regression', (req, res) => {
  try {
    const minPA = parseInt(req.query.minPA) || 200;
    const result = statcast.getRegressionCandidates(minPA);
    res.json({
      lucky: result.lucky,
      unlucky: result.unlucky,
      note: 'Lucky = ERA << xERA (FADE them). Unlucky = ERA >> xERA (BACK them).',
      luckyCount: result.lucky.length,
      unluckyCount: result.unlucky.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Team xwOBA leaderboard — true offensive quality ranking
app.get('/api/statcast/team-xwoba', (req, res) => {
  try {
    const leaderboard = statcast.getTeamXwobaLeaderboard();
    res.json({
      teams: leaderboard,
      note: 'xwOBA is the best single metric for true offensive quality. Edge = xwOBA - wOBA (positive = undervalued).',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full matchup Statcast report
app.get('/api/statcast/matchup/:away/:home', (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const awayPitcher = req.query.awayPitcher || null;
    const homePitcher = req.query.homePitcher || null;
    const result = statcast.getMatchupStatcast(away, home, awayPitcher, homePitcher);
    res.json({ away, home, awayPitcher, homePitcher, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force refresh Statcast data from Baseball Savant
app.get('/api/statcast/refresh', async (req, res) => {
  try {
    const result = await statcast.refreshStatcast(true);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Statcast status
app.get('/api/statcast/status', (req, res) => {
  try {
    const pitcherCount = statcast.cachedPitchers ? Object.keys(statcast.cachedPitchers).length : 0;
    const batterCount = statcast.cachedBatters ? Object.keys(statcast.cachedBatters).length : 0;
    const teamCount = statcast.cachedTeamBatting ? Object.keys(statcast.cachedTeamBatting).length : 0;
    res.json({
      pitchers: pitcherCount,
      batters: batterCount,
      teams: teamCount,
      lastFetch: statcast.lastFetch ? new Date(statcast.lastFetch).toISOString() : null,
      cacheAge: statcast.lastFetch ? `${Math.round((Date.now() - statcast.lastFetch) / 60000)} min` : 'never',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 SportsSim v31.0 running on port ${PORT}`);
  console.log(`   Odds API: ${ODDS_API_KEY ? 'configured' : 'NOT SET (set ODDS_API_KEY env var)'}`);
  console.log(`   NBA teams: ${Object.keys(nba.getTeams()).length}`);
  console.log(`   MLB teams: ${Object.keys(mlb.getTeams()).length}`);
  console.log(`   MLB pitchers: ${mlbPitchers.getAllPitchers().length}`);
  console.log(`   MLB Opening Day games: ${mlbOpeningDay.OPENING_DAY_GAMES.length}`);
  console.log(`   MLB Schedule: ESPN confirmed starters service active`);
  console.log(`   NHL teams: ${Object.keys(nhl.getTeams()).length}`);
  console.log(`   Player props: ${Object.keys(playerProps.NBA_PLAYER_BASELINES).length} NBA + ${Object.keys(playerProps.MLB_PITCHER_BASELINES).length} MLB pitchers + ${Object.keys(playerProps.MLB_BATTER_BASELINES).length} MLB batters`);
  console.log(`   Polymarket: scanner active`);
  console.log(`   Polymarket Value Bridge: model vs market edge detection active`);
  console.log(`   Bet tracker: ${betTracker.getStatus().totalBets} bets tracked, ${betTracker.getStatus().pending} pending`);
  const umpStatus = umpireService.getStatus();
  console.log(`   Umpire tendencies: ${umpStatus.umpires} umpires (${umpStatus.overUmpires} over, ${umpStatus.underUmpires} under, ${umpStatus.neutralUmpires} neutral)`);
  const calStatus = calibration.getStatus();
  console.log(`   Probability calibration: ${calStatus.sports.join(', ')} — ${JSON.stringify(calStatus.curves)}`);
  const sgpStatus = sgpEngine.getStatus();
  console.log(`   SGP engine: ${sgpStatus.correlationsModeled} correlations modeled, ${sgpStatus.comboTypes.join('/')} combos`);
  console.log(`   Alt lines scanner: alt totals, alt spreads, team totals, F5 lines — Poisson-powered`);
  console.log(`   Arbitrage scanner: cross-book arbs, low-hold, middles, stale lines`);
  console.log(`   🧠 ML Engine: Python sklearn ensemble (LR + GradientBoosting + RandomForest)`);
  console.log(`   Features: LIVE DATA, rolling stats, injuries, line movement, Kalshi scanner, PLAYER PROPS, pitcher model, Poisson totals, Kelly optimizer, WEATHER, POLYMARKET, BET TRACKER, DAILY PICKS ENGINE, ESPN STARTERS, SCHEDULE, UMPIRE TENDENCIES, PROBABILITY CALIBRATION, SGP CORRELATION ENGINE, ALT LINES SCANNER, ML ENGINE v2 (STATCAST), ARBITRAGE SCANNER, STATCAST INTEGRATION, HISTORICAL DATA EXPANSION`);
  
  // Auto-refresh all data on startup
  console.log('   📡 Fetching live data + rolling stats + injuries + weather + player stats + statcast...');
  Promise.all([
    liveData.refreshAll(),
    rollingStats.refreshAll(),
    injuries.refreshAll(),
    weather.getAllWeather().catch(() => ({})),
    playerStatsService.refreshAll().catch(() => ({ nba: 0, mlb: 0, nhl: 0 })),
    statcast.refreshStatcast().catch(() => ({ pitchers: 0, batters: 0, error: true }))
  ]).then(async ([liveResults, rollingResults, injuryResults, weatherResults, playerResults, statcastResults]) => {
    console.log('   ✅ Live data:', JSON.stringify(liveResults));
    console.log('   ✅ Rolling stats:', JSON.stringify(rollingResults));
    console.log('   ✅ Injuries:', JSON.stringify(injuryResults));
    console.log(`   ✅ Weather: ${Object.keys(weatherResults).length} parks cached`);
    console.log(`   ✅ Player stats: NBA ${playerResults.nba}, MLB ${playerResults.mlb}, NHL ${playerResults.nhl}`);
    console.log(`   ✅ Statcast: ${statcastResults.pitchers} pitchers, ${statcastResults.batters} batters${statcastResults.fromCache ? ' (cache)' : ' (fresh)'}`);
    console.log(`   NBA teams (live): ${Object.keys(nba.getTeams()).length}`);
    console.log(`   NHL teams (live): ${Object.keys(nhl.getTeams()).length}`);
    
    // Take initial line movement snapshot
    try {
      const games = await getAllOdds();
      const snapResult = lineMovement.takeSnapshot(games);
      console.log('   ✅ Line movement: initial snapshot —', JSON.stringify(snapResult));
    } catch (e) {
      console.log('   ⚠️ Line movement snapshot failed:', e.message);
    }
    
    // Auto-train ML model
    mlBridge.autoTrain().catch(e => console.error('   ⚠️ ML auto-train failed:', e.message));
  }).catch(e => {
    console.error('   ⚠️ Data refresh failed:', e.message);
    console.log('   Using static fallback data');
  });

  // Periodic line movement snapshots every 30 min
  setInterval(async () => {
    try {
      const games = await getAllOdds();
      const result = lineMovement.takeSnapshot(games);
      console.log(`📈 Line snapshot: ${result.stored} games tracked, ${lineMovement.getSharpSignals().length} signals`);
    } catch (e) {
      console.error('⚠️ Line snapshot failed:', e.message);
    }
  }, lineMovement.SNAPSHOT_INTERVAL);
});
