/**
 * Opening Day Live Odds Sync — services/od-live-odds.js v103.0
 * 
 * MISSION: Pull CURRENT live odds for ALL Opening Day games from The Odds API
 * and compare against our model predictions + static DK lines.
 * 
 * WHY THIS PRINTS MONEY:
 *   - Our static DK lines were pulled days ago — lines have MOVED
 *   - Opening Day lines move 2-5% in the final 48 hours as:
 *     (a) sharp money hits opening numbers
 *     (b) confirmed starters become official
 *     (c) weather forecasts clarify
 *     (d) lineup cards drop
 *   - We need CURRENT market prices to calculate true edge
 *   - Cross-book comparison finds the BEST price for each play
 *   - Edge decay detection: was our +5.8% edge still +5.8% or did it shrink?
 * 
 * This service:
 *   1. Fetches live MLB odds from The Odds API
 *   2. Matches games to our OD schedule
 *   3. Updates DK lines with real market prices
 *   4. Calculates edge changes (original edge vs current edge)
 *   5. Finds best-price book for each play
 *   6. Detects steam moves and sharp action on OD games
 *   7. Generates alerts for significant line moves
 */

const fs = require('fs');
const path = require('path');

// ==================== DEPENDENCIES ====================
let odModel = null;
let lineShoppingService = null;

try { odModel = require('../models/mlb-opening-day'); } catch(e) {}
try { lineShoppingService = require('./line-shopping'); } catch(e) {}

// ==================== CONSTANTS ====================
const CACHE_FILE = path.join(__dirname, 'od-live-odds-cache.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 min cache for live odds
const SNAPSHOT_FILE = path.join(__dirname, 'od-odds-snapshots.json');

// Team name mapping: The Odds API uses full names, we use abbreviations
const TEAM_ABBREV_MAP = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM',
  'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH',
};

// Reverse map
const ABBREV_TO_FULL = {};
for (const [full, abbr] of Object.entries(TEAM_ABBREV_MAP)) {
  ABBREV_TO_FULL[abbr] = full;
}

// ==================== CORE FUNCTIONS ====================

/**
 * Fetch live MLB odds from The Odds API
 * Requires ODDS_API_KEY env var (set on Fly.io)
 */
async function fetchLiveMLBOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return { error: 'No ODDS_API_KEY set', games: [] };
  }

  try {
    const fetch = (await import('node-fetch')).default;
    // Fetch h2h, spreads, totals for all MLB games
    const markets = 'h2h,spreads,totals';
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`;
    
    const resp = await fetch(url, { timeout: 15000 });
    if (!resp.ok) {
      console.error(`[OD Live Odds] API error: ${resp.status}`);
      return { error: `API error: ${resp.status}`, games: [] };
    }

    // Track API usage from headers
    const remaining = resp.headers.get('x-requests-remaining');
    const used = resp.headers.get('x-requests-used');
    
    const data = await resp.json();
    
    return {
      games: Array.isArray(data) ? data : [],
      apiUsage: { remaining: remaining ? parseInt(remaining) : null, used: used ? parseInt(used) : null },
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error(`[OD Live Odds] Fetch error:`, err.message);
    return { error: err.message, games: [] };
  }
}

/**
 * Parse odds from a single bookmaker's markets
 */
function parseBookOdds(bookmaker) {
  const result = { book: bookmaker.key, title: bookmaker.title };
  
  for (const market of (bookmaker.markets || [])) {
    if (market.key === 'h2h') {
      for (const outcome of (market.outcomes || [])) {
        const abbr = TEAM_ABBREV_MAP[outcome.name];
        if (abbr) {
          result[`${abbr}_ml`] = outcome.price;
        }
      }
    }
    if (market.key === 'spreads') {
      for (const outcome of (market.outcomes || [])) {
        const abbr = TEAM_ABBREV_MAP[outcome.name];
        if (abbr) {
          result[`${abbr}_spread`] = outcome.point;
          result[`${abbr}_spread_odds`] = outcome.price;
        }
      }
    }
    if (market.key === 'totals') {
      for (const outcome of (market.outcomes || [])) {
        if (outcome.name === 'Over') {
          result.total = outcome.point;
          result.overOdds = outcome.price;
        }
        if (outcome.name === 'Under') {
          result.underOdds = outcome.price;
        }
      }
    }
  }
  
  return result;
}

/**
 * Match Odds API game to our OD schedule game
 */
function matchToODGame(apiGame, odGames) {
  const homeAbbr = TEAM_ABBREV_MAP[apiGame.home_team];
  const awayAbbr = TEAM_ABBREV_MAP[apiGame.away_team];
  
  if (!homeAbbr || !awayAbbr) return null;
  
  // Match by teams
  const match = odGames.find(g => g.home === homeAbbr && g.away === awayAbbr);
  return match || null;
}

/**
 * Calculate consensus (average) odds across all books
 */
function calcConsensus(bookOdds, homeAbbr, awayAbbr) {
  const homeMls = [], awayMls = [], totals = [], overOdds = [], underOdds = [];
  
  for (const book of bookOdds) {
    if (book[`${homeAbbr}_ml`]) homeMls.push(book[`${homeAbbr}_ml`]);
    if (book[`${awayAbbr}_ml`]) awayMls.push(book[`${awayAbbr}_ml`]);
    if (book.total) totals.push(book.total);
    if (book.overOdds) overOdds.push(book.overOdds);
    if (book.underOdds) underOdds.push(book.underOdds);
  }
  
  const avg = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null;
  const mode = arr => {
    if (!arr.length) return null;
    const freq = {};
    arr.forEach(v => freq[v] = (freq[v] || 0) + 1);
    return Object.entries(freq).sort((a,b) => b[1] - a[1])[0][0] * 1;
  };
  
  return {
    homeML: Math.round(avg(homeMls)),
    awayML: Math.round(avg(awayMls)),
    total: mode(totals), // Mode is more meaningful for totals (most books agree on line)
    overOdds: Math.round(avg(overOdds)),
    underOdds: Math.round(avg(underOdds)),
    bookCount: bookOdds.length
  };
}

/**
 * American odds to implied probability
 */
function mlToImplied(ml) {
  if (!ml || ml === 0) return 0.5;
  if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
  return 100 / (ml + 100);
}

/**
 * Find the best available price for a given bet across all books
 */
function findBestPrice(bookOdds, betType, homeAbbr, awayAbbr) {
  let bestOdds = null;
  let bestBook = null;
  let allPrices = [];
  
  for (const book of bookOdds) {
    let odds = null;
    
    switch (betType) {
      case 'home_ml':
        odds = book[`${homeAbbr}_ml`];
        break;
      case 'away_ml':
        odds = book[`${awayAbbr}_ml`];
        break;
      case 'over':
        odds = book.overOdds;
        break;
      case 'under':
        odds = book.underOdds;
        break;
    }
    
    if (odds != null) {
      allPrices.push({ book: book.title, odds });
      // Better odds = higher payout = more positive (or less negative)
      if (bestOdds === null || odds > bestOdds) {
        bestOdds = odds;
        bestBook = book.title;
      }
    }
  }
  
  // Sort by best price
  allPrices.sort((a, b) => b.odds - a.odds);
  
  // Calculate price spread (best vs worst)
  const worstOdds = allPrices.length > 0 ? allPrices[allPrices.length - 1].odds : null;
  
  return {
    bestBook,
    bestOdds,
    worstOdds,
    priceSpread: bestOdds && worstOdds ? bestOdds - worstOdds : 0,
    allPrices: allPrices.slice(0, 6), // Top 6 books
    bookCount: allPrices.length
  };
}

/**
 * Detect significant line moves between our static DK lines and current market
 */
function detectLineMoves(staticLine, currentConsensus) {
  const moves = [];
  
  if (staticLine.homeML && currentConsensus.homeML) {
    const mlDiff = currentConsensus.homeML - staticLine.homeML;
    if (Math.abs(mlDiff) >= 10) {
      const direction = mlDiff > 0 ? 'AWAY_SHARP' : 'HOME_SHARP';
      moves.push({
        type: 'moneyline',
        side: direction,
        originalHome: staticLine.homeML,
        currentHome: currentConsensus.homeML,
        move: mlDiff,
        significance: Math.abs(mlDiff) >= 25 ? 'MAJOR' : Math.abs(mlDiff) >= 15 ? 'MODERATE' : 'MINOR',
        note: `ML moved ${mlDiff > 0 ? '+' : ''}${mlDiff} → ${direction === 'HOME_SHARP' ? 'sharps on HOME' : 'sharps on AWAY'}`
      });
    }
  }
  
  if (staticLine.total && currentConsensus.total) {
    const totalDiff = currentConsensus.total - staticLine.total;
    if (Math.abs(totalDiff) >= 0.5) {
      moves.push({
        type: 'total',
        original: staticLine.total,
        current: currentConsensus.total,
        move: totalDiff,
        direction: totalDiff > 0 ? 'UP' : 'DOWN',
        significance: Math.abs(totalDiff) >= 1.0 ? 'MAJOR' : 'MODERATE',
        note: `Total moved ${staticLine.total} → ${currentConsensus.total} (${totalDiff > 0 ? 'OVER' : 'UNDER'} money)`
      });
    }
  }
  
  return moves;
}

/**
 * Calculate edge change between original and current lines
 */
function calcEdgeChange(modelProb, originalML, currentML) {
  if (!modelProb || !originalML || !currentML) return null;
  
  const origImplied = mlToImplied(originalML);
  const currImplied = mlToImplied(currentML);
  const origEdge = modelProb - origImplied;
  const currEdge = modelProb - currImplied;
  
  return {
    originalEdge: +(origEdge * 100).toFixed(1),
    currentEdge: +(currEdge * 100).toFixed(1),
    edgeChange: +((currEdge - origEdge) * 100).toFixed(1),
    status: currEdge >= origEdge ? 'GROWING' : currEdge > 0.02 ? 'SHRINKING' : currEdge > 0 ? 'MARGINAL' : 'DEAD',
    stillPositiveEV: currEdge > 0
  };
}

// ==================== MAIN SCAN ====================

/**
 * Full OD live odds scan: fetch current lines, match to our games, analyze
 */
async function scanODLiveOdds() {
  const startTime = Date.now();
  
  // Check cache
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cached.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL) {
        return { ...cached, fromCache: true };
      }
    }
  } catch (e) {}
  
  // Get our OD schedule
  const odGames = odModel ? odModel.OPENING_DAY_GAMES : [];
  if (!odGames.length) {
    return { error: 'No OD games in model', games: [] };
  }
  
  // Fetch live odds
  const { games: apiGames, apiUsage, error } = await fetchLiveMLBOdds();
  if (error && !apiGames.length) {
    // Try to return cached data even if stale
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const stale = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        return { ...stale, fromCache: true, stale: true, fetchError: error };
      }
    } catch (e) {}
    return { error, games: [] };
  }
  
  const results = {
    fetchedAt: new Date().toISOString(),
    apiUsage,
    totalApiGames: apiGames.length,
    matchedGames: 0,
    unmatchedODGames: [],
    games: [],
    alerts: [],
    lineMoveSummary: { major: 0, moderate: 0, minor: 0, total: 0 },
    edgeSummary: { growing: 0, shrinking: 0, dead: 0, total: 0 },
    bestPrices: [],
    durationMs: 0
  };
  
  // Process each OD game
  for (const odGame of odGames) {
    const gameKey = `${odGame.away}@${odGame.home}`;
    
    // Try to find matching API game
    const apiMatch = apiGames.find(g => {
      const homeAbbr = TEAM_ABBREV_MAP[g.home_team];
      const awayAbbr = TEAM_ABBREV_MAP[g.away_team];
      return homeAbbr === odGame.home && awayAbbr === odGame.away;
    });
    
    const gameResult = {
      away: odGame.away,
      home: odGame.home,
      date: odGame.date,
      time: odGame.time,
      starters: odGame.confirmedStarters,
      isGame2: odGame.isGame2 || false,
      hasLiveOdds: !!apiMatch,
      staticDKLine: odGame.dkLine,
      liveConsensus: null,
      lineMoves: [],
      bestPrices: {},
      books: [],
      edgeAnalysis: null
    };
    
    if (apiMatch) {
      results.matchedGames++;
      
      // Parse all bookmaker odds
      const bookOdds = (apiMatch.bookmakers || []).map(parseBookOdds);
      gameResult.books = bookOdds.map(b => b.title);
      gameResult.bookCount = bookOdds.length;
      
      // Calculate consensus
      const consensus = calcConsensus(bookOdds, odGame.home, odGame.away);
      gameResult.liveConsensus = consensus;
      
      // Detect line moves vs our static DK lines
      const staticLine = {
        homeML: odGame.dkLine.homeML,
        awayML: odGame.dkLine.awayML,
        total: odGame.dkLine.total
      };
      gameResult.lineMoves = detectLineMoves(staticLine, consensus);
      
      // Aggregate line move stats
      for (const move of gameResult.lineMoves) {
        results.lineMoveSummary[move.significance.toLowerCase()]++;
        results.lineMoveSummary.total++;
      }
      
      // Find best price for each bet type
      gameResult.bestPrices = {
        homeML: findBestPrice(bookOdds, 'home_ml', odGame.home, odGame.away),
        awayML: findBestPrice(bookOdds, 'away_ml', odGame.home, odGame.away),
        over: findBestPrice(bookOdds, 'over', odGame.home, odGame.away),
        under: findBestPrice(bookOdds, 'under', odGame.home, odGame.away)
      };
      
      // Generate alerts for big moves
      for (const move of gameResult.lineMoves) {
        if (move.significance === 'MAJOR') {
          results.alerts.push({
            level: 'CRITICAL',
            game: gameKey,
            type: move.type,
            message: `🚨 ${gameKey}: ${move.note}`,
            move
          });
        } else if (move.significance === 'MODERATE') {
          results.alerts.push({
            level: 'WARNING',
            game: gameKey,
            type: move.type,
            message: `⚠️ ${gameKey}: ${move.note}`,
            move
          });
        }
      }
    } else {
      results.unmatchedODGames.push(gameKey);
    }
    
    results.games.push(gameResult);
  }
  
  // Take a snapshot for tracking
  takeOddsSnapshot(results);
  
  // Summary
  results.summary = {
    matchRate: `${results.matchedGames}/${odGames.length}`,
    liveOddsAvailable: results.matchedGames > 0,
    daysUntilOD: getDaysUntilOD(),
    biggestMoves: results.alerts.filter(a => a.level === 'CRITICAL').map(a => a.message),
    recommendation: generateRecommendation(results)
  };
  
  results.durationMs = Date.now() - startTime;
  
  // Cache results
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(results, null, 2));
  } catch (e) {}
  
  return results;
}

/**
 * Take a timestamped snapshot for line movement tracking
 */
function takeOddsSnapshot(results) {
  try {
    let snapshots = [];
    if (fs.existsSync(SNAPSHOT_FILE)) {
      snapshots = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    }
    
    const snapshot = {
      timestamp: new Date().toISOString(),
      games: results.games.map(g => ({
        key: `${g.away}@${g.home}`,
        consensus: g.liveConsensus,
        staticLine: g.staticDKLine
      }))
    };
    
    snapshots.push(snapshot);
    
    // Keep last 200 snapshots (about 16 hours at 5-min intervals)
    if (snapshots.length > 200) snapshots = snapshots.slice(-200);
    
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2));
  } catch (e) {
    console.error('[OD Live Odds] Snapshot save error:', e.message);
  }
}

/**
 * Get line movement history for a specific game
 */
function getGameLineHistory(awayAbbr, homeAbbr) {
  const gameKey = `${awayAbbr}@${homeAbbr}`;
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return { gameKey, snapshots: [] };
    const snapshots = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    
    const history = snapshots.map(s => {
      const game = (s.games || []).find(g => g.key === gameKey);
      return game ? { timestamp: s.timestamp, ...game.consensus } : null;
    }).filter(Boolean);
    
    return { gameKey, snapshots: history, count: history.length };
  } catch (e) {
    return { gameKey, snapshots: [], error: e.message };
  }
}

function getDaysUntilOD() {
  const now = new Date();
  const od = new Date('2026-03-26T17:15:00Z'); // First game ~1:15 PM ET
  return Math.max(0, Math.ceil((od - now) / (24 * 60 * 60 * 1000)));
}

function generateRecommendation(results) {
  const daysOut = getDaysUntilOD();
  const { major, moderate } = results.lineMoveSummary;
  
  if (daysOut > 3) return 'Lines still soft — early mover advantage, lock in best prices now.';
  if (daysOut <= 1) return '🔥 GAME DAY — lines are sharp. Focus on lineup-driven edges and weather.';
  if (major > 0) return `🚨 ${major} major line moves detected — re-evaluate affected plays IMMEDIATELY.`;
  if (moderate > 2) return `⚠️ Multiple moderate moves — sharps are pricing in new info. Check if our edge still holds.`;
  return '✅ Lines stable — our edges holding. Monitor for lineup/weather catalysts.';
}

/**
 * Update OD model DK lines with live consensus
 * Returns which games were updated and by how much
 */
function updateODLines(scanResults) {
  if (!odModel || !odModel.OPENING_DAY_GAMES) return { updated: 0, changes: [] };
  
  const changes = [];
  let updated = 0;
  
  for (const game of scanResults.games) {
    if (!game.liveConsensus) continue;
    
    const odGame = odModel.OPENING_DAY_GAMES.find(g => g.home === game.home && g.away === game.away);
    if (!odGame || !odGame.dkLine) continue;
    
    const old = { ...odGame.dkLine };
    const consensus = game.liveConsensus;
    
    let changed = false;
    if (consensus.homeML && Math.abs(consensus.homeML - old.homeML) >= 5) {
      odGame.dkLine.homeML = consensus.homeML;
      changed = true;
    }
    if (consensus.awayML && Math.abs(consensus.awayML - old.awayML) >= 5) {
      odGame.dkLine.awayML = consensus.awayML;
      changed = true;
    }
    if (consensus.total && consensus.total !== old.total) {
      odGame.dkLine.total = consensus.total;
      changed = true;
    }
    
    if (changed) {
      updated++;
      changes.push({
        game: `${game.away}@${game.home}`,
        before: old,
        after: { ...odGame.dkLine },
        consensus
      });
    }
  }
  
  return { updated, changes, timestamp: new Date().toISOString() };
}

/**
 * Get comprehensive OD odds analysis for dashboard
 */
async function getODOddsAnalysis() {
  const scan = await scanODLiveOdds();
  
  // Build per-game analysis cards
  const cards = (scan.games || []).map(game => {
    const bestHomeML = game.bestPrices?.homeML;
    const bestAwayML = game.bestPrices?.awayML;
    const bestOver = game.bestPrices?.over;
    const bestUnder = game.bestPrices?.under;
    
    // Calculate savings from line shopping
    const dkHomeML = game.staticDKLine?.homeML;
    const dkAwayML = game.staticDKLine?.awayML;
    
    let savings = 0;
    if (bestHomeML?.bestOdds && dkHomeML && bestHomeML.bestOdds > dkHomeML) {
      // Better odds available
      savings += (bestHomeML.bestOdds - dkHomeML); // cents of improvement
    }
    if (bestAwayML?.bestOdds && dkAwayML && bestAwayML.bestOdds > dkAwayML) {
      savings += (bestAwayML.bestOdds - dkAwayML);
    }
    
    return {
      game: `${game.away}@${game.home}`,
      date: game.date,
      time: game.time,
      starters: game.starters,
      hasLiveOdds: game.hasLiveOdds,
      staticLine: game.staticDKLine,
      liveConsensus: game.liveConsensus,
      lineMoves: game.lineMoves,
      bestPrices: {
        homeML: bestHomeML ? { book: bestHomeML.bestBook, odds: bestHomeML.bestOdds, spread: bestHomeML.priceSpread } : null,
        awayML: bestAwayML ? { book: bestAwayML.bestBook, odds: bestAwayML.bestOdds, spread: bestAwayML.priceSpread } : null,
        over: bestOver ? { book: bestOver.bestBook, odds: bestOver.bestOdds } : null,
        under: bestUnder ? { book: bestUnder.bestBook, odds: bestUnder.bestOdds } : null,
      },
      lineShoppingSavings: savings,
      bookCount: game.bookCount || 0
    };
  });
  
  // Total line shopping savings
  const totalSavings = cards.reduce((sum, c) => sum + (c.lineShoppingSavings || 0), 0);
  
  return {
    ...scan,
    cards,
    totalLineShoppingSavings: totalSavings,
    avgBooksPerGame: cards.filter(c => c.hasLiveOdds).reduce((s,c) => s + c.bookCount, 0) / Math.max(1, cards.filter(c => c.hasLiveOdds).length),
    gamesWithBetterPrice: cards.filter(c => c.lineShoppingSavings > 0).length,
  };
}

function getStatus() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return {
        service: 'od-live-odds',
        version: '103.0',
        lastScan: cached.fetchedAt || null,
        matchedGames: cached.matchedGames || 0,
        totalGames: (cached.games || []).length,
        alerts: (cached.alerts || []).length,
        lineMoves: cached.lineMoveSummary || {},
        cacheFresh: cached.fetchedAt ? (Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL) : false
      };
    }
    return { service: 'od-live-odds', version: '103.0', lastScan: null, note: 'No scan data yet' };
  } catch (e) {
    return { service: 'od-live-odds', version: '103.0', error: e.message };
  }
}

module.exports = {
  scanODLiveOdds,
  fetchLiveMLBOdds,
  getODOddsAnalysis,
  getGameLineHistory,
  updateODLines,
  getStatus,
  TEAM_ABBREV_MAP,
  ABBREV_TO_FULL
};
