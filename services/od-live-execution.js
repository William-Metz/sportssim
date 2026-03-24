/**
 * OD Live Bet Execution Engine v119.0
 * =====================================
 * 
 * THE MONEY MAKER. This is what runs on Opening Day morning.
 * 
 * Unlike the static playbook, this engine:
 * 1. Pulls LIVE odds from The Odds API (production only)
 * 2. Runs asyncPredict() for every OD game with fresh data
 * 3. Compares model probabilities to current market lines
 * 4. Calculates real-time edge for every market
 * 5. Applies Kelly criterion for bet sizing
 * 6. Tracks edge movement over time
 * 7. Gives EXECUTE / WAIT / FADE signals
 * 
 * Key insight: edges decay as game time approaches (sharp money moves lines).
 * The earlier you bet +EV, the more you capture. But you need CONFIRMED lineups
 * first — betting blind on lineups is -EV.
 * 
 * ENDPOINTS:
 *   GET /api/od/live-execution          — Full live execution dashboard
 *   GET /api/od/live-execution/quick     — Quick status (cached, fast)
 *   GET /api/od/live-execution/game/:away/:home — Single game deep dive
 *   POST /api/od/live-execution/refresh  — Force refresh all data
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Safe imports
let mlbModel = null;
let weatherService = null;
let edgeDecay = null;
let lineupBridge = null;
let umpireService = null;
let f3Model = null;
let f7Model = null;
let nrfiModel = null;
let pitcherKProps = null;
let outsProps = null;
let bullpenQuality = null;

try { mlbModel = require('../models/mlb'); } catch(e) { console.error('[live-execution] MLB model not loaded:', e.message); }
try { weatherService = require('./weather'); } catch(e) {}
try { edgeDecay = require('./od-edge-decay-optimizer'); } catch(e) {}
try { lineupBridge = require('./lineup-bridge'); } catch(e) {}
try { umpireService = require('./umpire-tendencies'); } catch(e) {}
try { f3Model = require('./f3-model'); } catch(e) {}
try { f7Model = require('./f7-model'); } catch(e) {}
try { nrfiModel = require('./nrfi-model'); } catch(e) {}
try { pitcherKProps = require('./pitcher-k-props'); } catch(e) {}
try { outsProps = require('./pitcher-outs-props'); } catch(e) {}
try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}

// ==================== OD SCHEDULE ====================
// DAY 0 = Season Opener (March 25), DAY 1 = Full slate (March 26), DAY 2 = Day 2 games (March 27)
const OD_DAY0 = [
  { away: 'NYY', home: 'SF', time: '2026-03-26T00:05:00Z', venue: 'Oracle Park', outdoor: true, opener: true },
];

const OD_DAY1 = [
  { away: 'PIT', home: 'NYM', time: '2026-03-26T17:10:00Z', venue: 'Citi Field', outdoor: true },
  { away: 'CWS', home: 'MIL', time: '2026-03-26T18:10:00Z', venue: 'American Family Field', outdoor: false },
  { away: 'WSH', home: 'CHC', time: '2026-03-26T18:20:00Z', venue: 'Wrigley Field', outdoor: true },
  { away: 'MIN', home: 'BAL', time: '2026-03-26T19:05:00Z', venue: 'Camden Yards', outdoor: true },
  { away: 'BOS', home: 'CIN', time: '2026-03-26T20:10:00Z', venue: 'Great American Ball Park', outdoor: true },
  { away: 'ARI', home: 'LAD', time: '2026-03-26T20:10:00Z', venue: 'Dodger Stadium', outdoor: true },
  { away: 'KC',  home: 'ATL', time: '2026-03-26T20:20:00Z', venue: 'Truist Park', outdoor: true },
  { away: 'OAK', home: 'TOR', time: '2026-03-26T21:07:00Z', venue: 'Rogers Centre', outdoor: false },
  { away: 'PHI', home: 'TB',  time: '2026-03-27T22:50:00Z', venue: 'Tropicana Field', outdoor: false },
  { away: 'SF',  home: 'HOU', time: '2026-03-27T00:10:00Z', venue: 'Minute Maid Park', outdoor: false },
  { away: 'CLE', home: 'SEA', time: '2026-03-27T02:10:00Z', venue: 'T-Mobile Park', outdoor: false },
];

const OD_DAY2 = [
  { away: 'NYY', home: 'MIL', time: '2026-03-27T18:10:00Z', venue: 'American Family Field', outdoor: false },
  { away: 'DET', home: 'SD',  time: '2026-03-27T20:10:00Z', venue: 'Petco Park', outdoor: true },
  { away: 'TB',  home: 'STL', time: '2026-03-27T20:15:00Z', venue: 'Busch Stadium', outdoor: true },
  { away: 'TEX', home: 'CHC', time: '2026-03-27T22:40:00Z', venue: 'Wrigley Field', outdoor: true },
  { away: 'CIN', home: 'LAA', time: '2026-03-27T23:07:00Z', venue: 'Angel Stadium', outdoor: true },
  { away: 'COL', home: 'MIA', time: '2026-03-27T23:10:00Z', venue: 'loanDepot park', outdoor: false },
  { away: 'LAD', home: 'ATL', time: '2026-03-27T23:20:00Z', venue: 'Truist Park', outdoor: true },
  { away: 'NYM', home: 'HOU', time: '2026-03-28T00:10:00Z', venue: 'Minute Maid Park', outdoor: false },
  { away: 'BAL', home: 'SEA', time: '2026-03-28T01:40:00Z', venue: 'T-Mobile Park', outdoor: false },
];

// ==================== CACHE ====================
const CACHE_FILE = path.join(__dirname, 'od-live-execution-cache.json');
let executionCache = {
  lastRefresh: null,
  lastOdds: null,
  games: {},
  edgeHistory: [],
  portfolio: null,
};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      executionCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch(e) {}
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(executionCache, null, 2));
  } catch(e) {}
}

loadCache();

// ==================== ODDS FETCHING ====================
function fetchOdds(sportKey = 'baseball_mlb') {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return resolve({ games: [], mock: true, error: 'No API key' });
    
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,caesars,bovada`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const remaining = res.headers['x-requests-remaining'];
          const used = res.headers['x-requests-used'];
          resolve({ 
            games: Array.isArray(parsed) ? parsed : [], 
            apiQuota: { remaining, used },
            fetchedAt: new Date().toISOString()
          });
        } catch(e) {
          resolve({ games: [], error: 'Parse error: ' + e.message });
        }
      });
    }).on('error', (e) => {
      resolve({ games: [], error: e.message });
    });
  });
}

// ==================== AMERICAN ODDS CONVERSION ====================
function americanToProb(odds) {
  if (!odds || odds === 0) return 0.5;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function probToAmerican(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== KELLY CRITERION ====================
function kellyFraction(edge, odds) {
  // Kelly = (bp - q) / b where b = decimal odds - 1, p = model prob, q = 1-p
  const impliedProb = americanToProb(odds);
  const modelProb = impliedProb + edge / 100;
  const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
  const b = decimalOdds - 1;
  const p = Math.max(0, Math.min(1, modelProb));
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  // Use fractional Kelly (25%) for safety
  const fractionalKelly = Math.max(0, kelly * 0.25);
  return {
    fullKelly: Math.round(kelly * 10000) / 100,
    fractionalKelly: Math.round(fractionalKelly * 10000) / 100,
    suggestedBankrollPct: Math.min(5, Math.round(fractionalKelly * 100) / 100),
    modelProb: Math.round(p * 1000) / 10,
    impliedProb: Math.round(impliedProb * 1000) / 10,
  };
}

// ==================== EXTRACT BEST ODDS FROM BOOKMAKERS ====================
function extractBestOdds(oddsGame) {
  if (!oddsGame || !oddsGame.bookmakers) return null;
  
  const result = {
    homeTeam: oddsGame.home_team,
    awayTeam: oddsGame.away_team,
    commenceTime: oddsGame.commence_time,
    moneyline: { home: null, away: null, bestBook: {} },
    spread: { home: null, away: null, points: null, bestBook: {} },
    total: { over: null, under: null, points: null, bestBook: {} },
  };
  
  for (const bk of oddsGame.bookmakers) {
    for (const market of bk.markets) {
      if (market.key === 'h2h') {
        for (const outcome of market.outcomes) {
          if (outcome.name === oddsGame.home_team) {
            if (!result.moneyline.home || outcome.price > result.moneyline.home) {
              result.moneyline.home = outcome.price;
              result.moneyline.bestBook.home = bk.title;
            }
          } else {
            if (!result.moneyline.away || outcome.price > result.moneyline.away) {
              result.moneyline.away = outcome.price;
              result.moneyline.bestBook.away = bk.title;
            }
          }
        }
      } else if (market.key === 'spreads') {
        for (const outcome of market.outcomes) {
          if (outcome.name === oddsGame.home_team) {
            if (!result.spread.home || outcome.price > result.spread.home) {
              result.spread.home = outcome.price;
              result.spread.points = outcome.point;
              result.spread.bestBook.home = bk.title;
            }
          } else {
            if (!result.spread.away || outcome.price > result.spread.away) {
              result.spread.away = outcome.price;
              result.spread.bestBook.away = bk.title;
            }
          }
        }
      } else if (market.key === 'totals') {
        for (const outcome of market.outcomes) {
          if (outcome.name === 'Over') {
            if (!result.total.over || outcome.price > result.total.over) {
              result.total.over = outcome.price;
              result.total.points = outcome.point;
              result.total.bestBook.over = bk.title;
            }
          } else {
            if (!result.total.under || outcome.price > result.total.under) {
              result.total.under = outcome.price;
              result.total.bestBook.under = bk.title;
            }
          }
        }
      }
    }
  }
  
  return result;
}

// ==================== TEAM NAME MAPPING ====================
const TEAM_ABBR_MAP = {
  'Pittsburgh Pirates': 'PIT', 'New York Mets': 'NYM', 'Chicago White Sox': 'CWS',
  'Milwaukee Brewers': 'MIL', 'Washington Nationals': 'WSH', 'Chicago Cubs': 'CHC',
  'Minnesota Twins': 'MIN', 'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS',
  'Cincinnati Reds': 'CIN', 'Arizona Diamondbacks': 'ARI', 'Los Angeles Dodgers': 'LAD',
  'Kansas City Royals': 'KC', 'Atlanta Braves': 'ATL', 'Oakland Athletics': 'OAK',
  'Toronto Blue Jays': 'TOR', 'Philadelphia Phillies': 'PHI', 'Tampa Bay Rays': 'TB',
  'San Francisco Giants': 'SF', 'Houston Astros': 'HOU', 'Cleveland Guardians': 'CLE',
  'Seattle Mariners': 'SEA', 'New York Yankees': 'NYY', 'San Diego Padres': 'SD',
  'Detroit Tigers': 'DET', 'St. Louis Cardinals': 'STL', 'Texas Rangers': 'TEX',
  'Los Angeles Angels': 'LAA', 'Colorado Rockies': 'COL', 'Miami Marlins': 'MIA',
};

function teamNameToAbbr(name) {
  return TEAM_ABBR_MAP[name] || name.split(' ').pop().substring(0, 3).toUpperCase();
}

// ==================== MATCH ODDS TO OD GAMES ====================
function matchOddsToSchedule(oddsGames, schedule) {
  const matched = {};
  
  for (const game of schedule) {
    const gameKey = `${game.away}@${game.home}`;
    matched[gameKey] = { schedule: game, odds: null, bestOdds: null };
    
    // Try to match by team names
    for (const og of oddsGames) {
      const homeAbbr = teamNameToAbbr(og.home_team);
      const awayAbbr = teamNameToAbbr(og.away_team);
      
      if (homeAbbr === game.home && awayAbbr === game.away) {
        matched[gameKey].odds = og;
        matched[gameKey].bestOdds = extractBestOdds(og);
        break;
      }
    }
  }
  
  return matched;
}

// ==================== RUN PREDICTIONS ====================
async function runPredictions(schedule, gameDate) {
  if (!mlbModel) return {};
  
  const results = {};
  
  for (const game of schedule) {
    const gameKey = `${game.away}@${game.home}`;
    try {
      // Use asyncPredict for full signal integration (weather, lineups, etc)
      const prediction = await mlbModel.asyncPredict(game.away, game.home, { 
        gameDate,
        venue: game.venue,
      });
      results[gameKey] = prediction;
    } catch(e) {
      // Fallback to sync predict
      try {
        const prediction = mlbModel.predict(game.away, game.home);
        results[gameKey] = prediction;
      } catch(e2) {
        results[gameKey] = { error: e2.message };
      }
    }
  }
  
  return results;
}

// ==================== GENERATE EXECUTION PLAN ====================
async function generateExecutionPlan(day = 1) {
  const schedule = day === 1 ? OD_DAY1 : OD_DAY2;
  const gameDate = day === 1 ? '2026-03-26' : '2026-03-27';
  const now = new Date();
  
  // Step 1: Fetch live odds
  const oddsResult = await fetchOdds();
  const oddsGames = oddsResult.games || [];
  
  // Step 2: Match odds to schedule
  const matchedGames = matchOddsToSchedule(oddsGames, schedule);
  
  // Step 3: Run model predictions
  const predictions = await runPredictions(schedule, gameDate);
  
  // Step 4: Build execution plan for each game
  const plays = [];
  const gameAnalyses = [];
  
  for (const [gameKey, data] of Object.entries(matchedGames)) {
    const pred = predictions[gameKey];
    const odds = data.bestOdds;
    const game = data.schedule;
    const gameTime = new Date(game.time);
    const hoursToGame = (gameTime - now) / (1000 * 60 * 60);
    
    const analysis = {
      gameKey,
      venue: game.venue,
      outdoor: game.outdoor,
      gameTime: game.time,
      hoursToGame: Math.round(hoursToGame * 10) / 10,
      prediction: pred ? {
        awayWinPct: pred.awayWinPct || pred.awayWin || pred.awayWinProb,
        homeWinPct: pred.homeWinPct || pred.homeWin || pred.homeWinProb,
        projTotal: pred.projectedTotal || pred.total || pred.projTotal || pred.totalRuns,
        awayRuns: pred.awayRuns,
        homeRuns: pred.homeRuns,
        confidence: pred.confidence,
        awayPitcher: pred.awayPitcher,
        homePitcher: pred.homePitcher,
        weatherImpact: pred.weatherMultiplier || pred.weather?.multiplier,
      } : null,
      odds: odds ? {
        mlHome: odds.moneyline.home,
        mlAway: odds.moneyline.away,
        mlBestBookHome: odds.moneyline.bestBook.home,
        mlBestBookAway: odds.moneyline.bestBook.away,
        spreadHome: odds.spread.home,
        spreadAway: odds.spread.away,
        spreadPts: odds.spread.points,
        totalOver: odds.total.over,
        totalUnder: odds.total.under,
        totalPts: odds.total.points,
      } : null,
      plays: [],
      signals: [],
    };
    
    // Generate plays from model vs odds comparison
    if (pred && odds) {
      const modelHome = pred.homeWinPct || pred.homeWin || pred.homeWinProb || 0.5;
      const modelAway = pred.awayWinPct || pred.awayWin || pred.awayWinProb || 0.5;
      const modelTotal = pred.projectedTotal || pred.total || pred.projTotal || pred.totalRuns || 8.5;
      
      // Moneyline edge
      if (odds.moneyline.home) {
        const impliedHome = americanToProb(odds.moneyline.home);
        const homeEdge = (modelHome - impliedHome) * 100;
        
        if (Math.abs(homeEdge) >= 3) {
          const side = homeEdge > 0 ? 'home' : 'away';
          const sideOdds = homeEdge > 0 ? odds.moneyline.home : odds.moneyline.away;
          const sideProb = homeEdge > 0 ? modelHome : modelAway;
          const edge = Math.abs(homeEdge);
          const kelly = kellyFraction(edge, sideOdds);
          const bestBook = homeEdge > 0 ? odds.moneyline.bestBook.home : odds.moneyline.bestBook.away;
          
          // Timing recommendation
          let timing = 'BET NOW';
          let urgency = 'HIGH';
          if (hoursToGame > 12) { timing = 'EARLY VALUE — bet now for max edge capture'; urgency = 'MEDIUM'; }
          else if (hoursToGame > 4) { timing = 'PRIME WINDOW — bet now'; urgency = 'HIGH'; }
          else if (hoursToGame > 1) { timing = 'CLOSING LINE — bet ASAP'; urgency = 'CRITICAL'; }
          else { timing = 'GAME TIME — last chance'; urgency = 'CRITICAL'; }
          
          // Conviction tier
          let conviction = 'LEAN';
          if (edge >= 10) conviction = 'SMASH';
          else if (edge >= 7) conviction = 'STRONG';
          else if (edge >= 5) conviction = 'PLAY';
          
          const play = {
            market: 'ML',
            gameKey,
            side: side === 'home' ? game.home : game.away,
            odds: sideOdds,
            bestBook,
            modelProb: Math.round(sideProb * 1000) / 10,
            impliedProb: Math.round(americanToProb(sideOdds) * 1000) / 10,
            edge: Math.round(edge * 10) / 10,
            kelly,
            conviction,
            timing,
            urgency,
            hoursToGame: Math.round(hoursToGame * 10) / 10,
          };
          
          analysis.plays.push(play);
          plays.push(play);
        }
      }
      
      // Totals edge
      if (odds.total.points && modelTotal) {
        const totalDiff = modelTotal - odds.total.points;
        
        if (Math.abs(totalDiff) >= 0.5) {
          const side = totalDiff > 0 ? 'OVER' : 'UNDER';
          const sideOdds = totalDiff > 0 ? odds.total.over : odds.total.under;
          const bestBook = totalDiff > 0 ? odds.total.bestBook.over : odds.total.bestBook.under;
          
          // Simple edge calc for totals
          const edge = Math.abs(totalDiff) * 3; // Roughly 3% per 0.5 runs off
          const kelly = kellyFraction(edge, sideOdds);
          
          let conviction = 'LEAN';
          if (Math.abs(totalDiff) >= 1.5) conviction = 'SMASH';
          else if (Math.abs(totalDiff) >= 1.0) conviction = 'STRONG';
          else if (Math.abs(totalDiff) >= 0.7) conviction = 'PLAY';
          
          const play = {
            market: 'TOTAL',
            gameKey,
            side: `${side} ${odds.total.points}`,
            odds: sideOdds,
            bestBook,
            modelTotal: Math.round(modelTotal * 10) / 10,
            lineTotal: odds.total.points,
            totalDiff: Math.round(totalDiff * 10) / 10,
            edge: Math.round(edge * 10) / 10,
            kelly,
            conviction,
            hoursToGame: Math.round(hoursToGame * 10) / 10,
          };
          
          analysis.plays.push(play);
          plays.push(play);
        }
      }
    }
    
    // Add signals
    if (pred) {
      if (pred.weatherMultiplier || pred.weather?.multiplier) {
        const mult = pred.weatherMultiplier || pred.weather?.multiplier;
        if (mult > 1.05) analysis.signals.push(`🌡️ Weather BOOST: ${Math.round((mult - 1) * 100)}% uplift`);
        if (mult < 0.95) analysis.signals.push(`❄️ Weather SUPPRESS: ${Math.round((1 - mult) * 100)}% reduction`);
      }
      if (pred.confidence && pred.confidence > 70) {
        analysis.signals.push(`✅ High confidence: ${pred.confidence}%`);
      }
    }
    if (!odds) {
      analysis.signals.push('⚠️ NO LIVE ODDS — market not yet posted');
    }
    if (game.outdoor) {
      analysis.signals.push('🏟️ Outdoor venue — weather matters');
    }
    
    gameAnalyses.push(analysis);
  }
  
  // Sort plays by edge (best first)
  plays.sort((a, b) => b.edge - a.edge);
  
  // Build portfolio summary
  const smashPlays = plays.filter(p => p.conviction === 'SMASH');
  const strongPlays = plays.filter(p => p.conviction === 'STRONG');
  const playPlays = plays.filter(p => p.conviction === 'PLAY');
  const leanPlays = plays.filter(p => p.conviction === 'LEAN');
  
  // Total suggested allocation
  const totalAllocation = plays.reduce((sum, p) => sum + (p.kelly?.suggestedBankrollPct || 0), 0);
  
  const result = {
    title: `🦞 OD Day ${day} Live Execution Plan`,
    generatedAt: now.toISOString(),
    gameDate,
    day,
    oddsStatus: oddsResult.error ? `⚠️ ${oddsResult.error}` : `✅ ${oddsGames.length} games with live odds`,
    apiQuota: oddsResult.apiQuota,
    
    summary: {
      totalGames: schedule.length,
      gamesWithOdds: Object.values(matchedGames).filter(g => g.odds).length,
      gamesWithPredictions: Object.values(predictions).filter(p => !p.error).length,
      totalPlays: plays.length,
      smashPlays: smashPlays.length,
      strongPlays: strongPlays.length,
      playPlays: playPlays.length,
      leanPlays: leanPlays.length,
      totalBankrollAllocation: Math.round(totalAllocation * 100) / 100 + '%',
    },
    
    // The actual bets to place, sorted by edge
    actionBoard: {
      smash: smashPlays,
      strong: strongPlays,
      play: playPlays,
      lean: leanPlays,
    },
    
    // Per-game breakdown
    games: gameAnalyses,
    
    // Edge history tracking
    edgeSnapshot: {
      timestamp: now.toISOString(),
      topEdges: plays.slice(0, 5).map(p => ({
        gameKey: p.gameKey,
        market: p.market,
        side: p.side,
        edge: p.edge,
        odds: p.odds,
      })),
    },
  };
  
  // Cache results
  executionCache.lastRefresh = now.toISOString();
  executionCache.lastOdds = oddsResult;
  executionCache.portfolio = result;
  executionCache.edgeHistory.push(result.edgeSnapshot);
  // Keep last 48 snapshots (24h at 30min intervals)
  if (executionCache.edgeHistory.length > 48) {
    executionCache.edgeHistory = executionCache.edgeHistory.slice(-48);
  }
  saveCache();
  
  return result;
}

// ==================== QUICK STATUS (CACHED) ====================
function getQuickStatus() {
  if (!executionCache.portfolio) {
    return { status: 'NO_DATA', message: 'Run /api/od/live-execution first to generate plan' };
  }
  
  const portfolio = executionCache.portfolio;
  const age = Date.now() - new Date(executionCache.lastRefresh).getTime();
  const ageMinutes = Math.round(age / 60000);
  
  return {
    status: ageMinutes > 30 ? 'STALE' : 'FRESH',
    ageMinutes,
    lastRefresh: executionCache.lastRefresh,
    summary: portfolio.summary,
    topPlays: (portfolio.actionBoard.smash || []).concat(portfolio.actionBoard.strong || []).slice(0, 5).map(p => ({
      gameKey: p.gameKey,
      market: p.market,
      side: p.side,
      edge: p.edge,
      odds: p.odds,
      conviction: p.conviction,
      bestBook: p.bestBook,
    })),
    edgeTrend: executionCache.edgeHistory.length > 1 ? {
      snapshots: executionCache.edgeHistory.length,
      firstSnapshot: executionCache.edgeHistory[0]?.timestamp,
      latestSnapshot: executionCache.edgeHistory[executionCache.edgeHistory.length - 1]?.timestamp,
    } : null,
  };
}

// ==================== SINGLE GAME DEEP DIVE ====================
async function gameDeepDive(away, home, day = 1) {
  const schedule = day === 1 ? OD_DAY1 : OD_DAY2;
  const gameDate = day === 1 ? '2026-03-26' : '2026-03-27';
  const game = schedule.find(g => g.away === away.toUpperCase() && g.home === home.toUpperCase());
  
  if (!game) return { error: `Game ${away}@${home} not found in Day ${day} schedule` };
  
  const gameKey = `${game.away}@${game.home}`;
  
  // Full prediction with all signals
  let prediction = null;
  if (mlbModel) {
    try {
      prediction = await mlbModel.asyncPredict(game.away, game.home, { gameDate, venue: game.venue });
    } catch(e) {
      try { prediction = mlbModel.predict(game.away, game.home); } catch(e2) {}
    }
  }
  
  // F3 (First 3 innings)
  let f3 = null;
  if (f3Model && f3Model.analyzeF3) {
    try { f3 = f3Model.analyzeF3(game.away, game.home); } catch(e) {}
  }
  
  // F7 (First 7 innings — bullpen chaos eliminator)
  let f7 = null;
  if (f7Model && f7Model.analyzeF7) {
    try { f7 = f7Model.analyzeF7(game.away, game.home); } catch(e) {}
  }
  
  // NRFI
  let nrfi = null;
  if (nrfiModel && nrfiModel.analyzeNRFI) {
    try { nrfi = nrfiModel.analyzeNRFI(game.away, game.home); } catch(e) {}
  }
  
  // Pitcher props
  let kProps = null;
  if (pitcherKProps && pitcherKProps.analyzePitcherKs) {
    try { kProps = pitcherKProps.analyzePitcherKs(game.home, game.away); } catch(e) {}
  }
  
  // Live odds
  const oddsResult = await fetchOdds();
  let gameOdds = null;
  for (const og of (oddsResult.games || [])) {
    const ha = teamNameToAbbr(og.home_team);
    const aa = teamNameToAbbr(og.away_team);
    if (ha === game.home && aa === game.away) {
      gameOdds = extractBestOdds(og);
      break;
    }
  }
  
  return {
    gameKey,
    schedule: game,
    prediction,
    subModels: { f3, f7, nrfi, kProps },
    liveOdds: gameOdds,
    edgeAnalysis: prediction && gameOdds ? buildEdgeAnalysis(prediction, gameOdds, game) : null,
  };
}

function buildEdgeAnalysis(pred, odds, game) {
  const edges = [];
  const modelHome = pred.homeWinPct || pred.homeWin || pred.homeWinProb || 0.5;
  const modelAway = pred.awayWinPct || pred.awayWin || pred.awayWinProb || 0.5;
  const modelTotal = pred.projectedTotal || pred.total || pred.projTotal || pred.totalRuns;
  
  // ML edges
  if (odds.moneyline.home) {
    const impliedHome = americanToProb(odds.moneyline.home);
    const impliedAway = americanToProb(odds.moneyline.away);
    edges.push({
      market: 'ML Home',
      team: game.home,
      modelProb: Math.round(modelHome * 1000) / 10,
      impliedProb: Math.round(impliedHome * 1000) / 10,
      edge: Math.round((modelHome - impliedHome) * 1000) / 10,
      odds: odds.moneyline.home,
      bestBook: odds.moneyline.bestBook.home,
    });
    edges.push({
      market: 'ML Away',
      team: game.away,
      modelProb: Math.round(modelAway * 1000) / 10,
      impliedProb: Math.round(impliedAway * 1000) / 10,
      edge: Math.round((modelAway - impliedAway) * 1000) / 10,
      odds: odds.moneyline.away,
      bestBook: odds.moneyline.bestBook.away,
    });
  }
  
  // Total edges
  if (odds.total.points && modelTotal) {
    edges.push({
      market: 'Total',
      modelTotal: Math.round(modelTotal * 10) / 10,
      lineTotal: odds.total.points,
      diff: Math.round((modelTotal - odds.total.points) * 10) / 10,
      overOdds: odds.total.over,
      underOdds: odds.total.under,
      lean: modelTotal > odds.total.points ? 'OVER' : 'UNDER',
    });
  }
  
  return { edges };
}

// ==================== EDGE MOVEMENT TRACKER ====================
function getEdgeMovement() {
  if (executionCache.edgeHistory.length < 2) {
    return { message: 'Need at least 2 snapshots to track movement', snapshots: executionCache.edgeHistory.length };
  }
  
  const latest = executionCache.edgeHistory[executionCache.edgeHistory.length - 1];
  const previous = executionCache.edgeHistory[executionCache.edgeHistory.length - 2];
  
  const movements = [];
  for (const edge of latest.topEdges) {
    const prev = previous.topEdges.find(e => e.gameKey === edge.gameKey && e.market === edge.market);
    if (prev) {
      const change = edge.edge - prev.edge;
      if (Math.abs(change) >= 0.5) {
        movements.push({
          gameKey: edge.gameKey,
          market: edge.market,
          side: edge.side,
          currentEdge: edge.edge,
          previousEdge: prev.edge,
          change: Math.round(change * 10) / 10,
          direction: change > 0 ? '📈 GROWING' : '📉 SHRINKING',
          alert: Math.abs(change) >= 2 ? '🚨 SIGNIFICANT MOVE' : '📊 Normal drift',
        });
      }
    }
  }
  
  return {
    timestamp: new Date().toISOString(),
    snapshots: executionCache.edgeHistory.length,
    timespan: {
      from: executionCache.edgeHistory[0].timestamp,
      to: latest.timestamp,
    },
    movements: movements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
  };
}

module.exports = {
  generateExecutionPlan,
  getQuickStatus,
  gameDeepDive,
  getEdgeMovement,
  fetchOdds,
  matchOddsToSchedule,
  extractBestOdds,
  kellyFraction,
  americanToProb,
  probToAmerican,
  teamNameToAbbr,
  OD_DAY1,
  OD_DAY2,
};
