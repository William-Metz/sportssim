require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nba = require('./models/nba');
const backtest = require('./models/backtest');

const app = express();
const PORT = process.env.PORT || 8080;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// NBA Power Ratings
app.get('/api/model/nba/ratings', (req, res) => {
  try {
    const ratings = nba.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NBA Game Prediction
app.get('/api/model/nba/predict', (req, res) => {
  const { away, home, awayB2B, homeB2B } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const pred = nba.predict(away.toUpperCase(), home.toUpperCase(), {
      awayB2B: awayB2B === 'true', homeB2B: homeB2B === 'true'
    });
    if (pred.error) return res.status(400).json(pred);
    res.json(pred);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Live NBA Odds from The Odds API
app.get('/api/odds/nba', async (req, res) => {
  if (!ODDS_API_KEY) {
    return res.json({ error: 'No API key set', odds: [], mock: true });
  }
  try {
    const fetch = require('node-fetch');
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const resp = await fetch(url);
    const data = await resp.json();
    
    // Normalize to our format
    const odds = (data || []).map(game => {
      const bookmakers = {};
      (game.bookmakers || []).forEach(bk => {
        const book = { name: bk.title };
        (bk.markets || []).forEach(mkt => {
          if (mkt.key === 'h2h') {
            book.homeML = null; book.awayML = null;
            mkt.outcomes.forEach(o => {
              if (o.name === game.home_team) book.homeML = o.price;
              else book.awayML = o.price;
            });
          }
          if (mkt.key === 'spreads') {
            mkt.outcomes.forEach(o => {
              if (o.name === game.home_team) book.spread = o.point;
            });
          }
          if (mkt.key === 'totals') {
            mkt.outcomes.forEach(o => {
              if (o.name === 'Over') book.total = o.point;
            });
          }
        });
        bookmakers[bk.key] = book;
      });
      return {
        id: game.id,
        away: game.away_team,
        home: game.home_team,
        commence: game.commence_time,
        bookmakers
      };
    });
    res.json({ odds, count: odds.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Value detection: model vs live odds
app.get('/api/value/nba', async (req, res) => {
  try {
    const ratings = nba.calculateRatings();
    
    // Team name → abbr mapping
    const nameMap = {};
    for (const [abbr, t] of Object.entries(nba.TEAMS)) {
      nameMap[t.name.toLowerCase()] = abbr;
      // Also map common short names
      const parts = t.name.split(' ');
      nameMap[parts[parts.length - 1].toLowerCase()] = abbr;
    }
    nameMap['trail blazers'] = 'POR'; nameMap['blazers'] = 'POR';
    nameMap['timberwolves'] = 'MIN'; nameMap['76ers'] = 'PHI';
    
    function resolveTeam(name) {
      const lower = name.toLowerCase().trim();
      for (const [k, v] of Object.entries(nameMap)) {
        if (lower.includes(k)) return v;
      }
      return null;
    }
    
    // Try to get live odds
    let liveOdds = [];
    if (ODDS_API_KEY) {
      try {
        const fetch = require('node-fetch');
        const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
        const resp = await fetch(url);
        liveOdds = await resp.json();
      } catch (e) { /* ignore */ }
    }
    
    const valueBets = [];
    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(game.away_team);
      const homeAbbr = resolveTeam(game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      
      const pred = nba.predict(awayAbbr, homeAbbr);
      if (pred.error) continue;
      
      // Get consensus line from first bookmaker
      const books = game.bookmakers || [];
      if (books.length === 0) continue;
      
      for (const bk of books) {
        const bookLine = {};
        (bk.markets || []).forEach(mkt => {
          if (mkt.key === 'spreads') {
            mkt.outcomes.forEach(o => {
              if (o.name === game.home_team) bookLine.spread = o.point;
            });
          }
          if (mkt.key === 'h2h') {
            mkt.outcomes.forEach(o => {
              if (o.name === game.home_team) bookLine.homeML = o.price;
              else bookLine.awayML = o.price;
            });
          }
          if (mkt.key === 'totals') {
            mkt.outcomes.forEach(o => {
              if (o.name === 'Over') bookLine.total = o.point;
            });
          }
        });
        
        const edges = nba.findValue(pred, bookLine);
        edges.forEach(e => {
          valueBets.push({
            game: `${awayAbbr} @ ${homeAbbr}`,
            book: bk.title,
            commence: game.commence_time,
            ...e,
            prediction: {
              spread: pred.spread,
              homeWinProb: pred.homeWinProb,
              awayWinProb: pred.awayWinProb
            }
          });
        });
      }
    }
    
    // Sort by edge desc, deduplicate by game+pick (keep best book)
    valueBets.sort((a, b) => b.edge - a.edge);
    
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Backtest results
app.get('/api/backtest/nba', (req, res) => {
  try {
    const results = backtest.runBacktest();
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 SportsSim running on port ${PORT}`);
  console.log(`   Odds API: ${ODDS_API_KEY ? 'configured' : 'NOT SET (set ODDS_API_KEY env var)'}`);
  console.log(`   NBA teams loaded: ${Object.keys(nba.TEAMS).length}`);
});
