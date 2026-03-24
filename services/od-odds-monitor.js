/**
 * Opening Day Odds Monitor — services/od-odds-monitor.js v112.0
 * ===============================================================
 * MISSION: Detect EXACTLY when books post MLB Opening Day lines on The Odds API
 * and immediately recalculate all betting edges with real market prices.
 * 
 * WHY THIS IS CRITICAL:
 *   - Our OD betting card uses static DK line estimates from days ago
 *   - Real lines could differ by 10-30 cents — HUGE impact on edge calculations
 *   - Books typically post lines 24-48h before game time (March 24-25 for OD March 26)
 *   - First hour after lines are posted = WIDEST edges (before sharps move them)
 *   - We need to detect this moment and recalculate INSTANTLY
 * 
 * This service:
 *   1. Polls The Odds API every 15 min for baseball_mlb odds
 *   2. Detects when OD game odds first appear (transition from 0 → N games)
 *   3. Matches Odds API games to our OD schedule (team name → abbrev mapping)
 *   4. Calculates line movement from our static DK estimates vs real market
 *   5. Triggers automatic playbook cache rebuild with fresh odds
 *   6. Generates alerts for significant line movement (>5 cents ML, >0.5 total)
 *   7. Records snapshots for edge decay tracking
 *   8. Cross-book best price detection (DK vs FD vs BetMGM etc.)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ==================== DEPENDENCIES ====================
let odModel = null;
let playbookCache = null;
let odLiveOdds = null;

try { odModel = require('../models/mlb-opening-day'); } catch(e) {}
try { playbookCache = require('./od-playbook-cache'); } catch(e) {}
try { odLiveOdds = require('./od-live-odds'); } catch(e) {}

// ==================== STATE ====================
const STATE_FILE = path.join(__dirname, 'od-odds-monitor-state.json');
const SNAPSHOTS_FILE = path.join(__dirname, 'od-odds-monitor-snapshots.json');
const POLL_INTERVAL = 15 * 60 * 1000; // 15 min
const ALERT_INTERVAL = 60 * 60 * 1000; // Max 1 alert per game per hour

let state = {
  isRunning: false,
  pollCount: 0,
  lastPoll: null,
  firstOddsDetected: null,     // Timestamp when we first saw MLB OD odds
  gamesWithOdds: 0,            // Current count of OD games with live odds
  totalODGames: 0,             // Expected total OD games
  lineMovement: {},            // gameKey → line movement tracking
  alerts: [],                  // Alert history (max 100)
  playbookRebuilds: 0,         // How many times we triggered a rebuild
  lastRebuilds: null,
  intervalHandle: null,
};

// Team name mapping (Odds API → our abbreviations)
const TEAM_MAP = {
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

// ==================== CORE FUNCTIONS ====================

/**
 * Fetch MLB odds from The Odds API
 */
async function fetchMLBOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return { error: 'No ODDS_API_KEY', games: [] };

  return new Promise((resolve) => {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const games = JSON.parse(data);
          if (Array.isArray(games)) {
            resolve({ games, remaining: res.headers['x-requests-remaining'] });
          } else {
            resolve({ error: data, games: [] });
          }
        } catch(e) {
          resolve({ error: e.message, games: [] });
        }
      });
    }).on('error', (e) => {
      resolve({ error: e.message, games: [] });
    });
  });
}

/**
 * Match Odds API games to our OD schedule
 */
function matchODGames(apiGames) {
  if (!odModel) return [];
  
  const schedule = odModel.getSchedule ? odModel.getSchedule() : (odModel.OPENING_DAY_GAMES || []);
  const matched = [];
  
  // OD dates: March 26-27, 2026
  const odDates = ['2026-03-26', '2026-03-27', '2026-03-28']; // Include 28 for late March 27 games in UTC
  
  for (const apiGame of apiGames) {
    const gameDate = apiGame.commence_time ? apiGame.commence_time.substring(0, 10) : '';
    
    // Check if this game is within OD window
    if (!odDates.some(d => gameDate === d || apiGame.commence_time?.includes(d))) continue;
    
    const awayFull = apiGame.away_team || '';
    const homeFull = apiGame.home_team || '';
    const awayAbbr = TEAM_MAP[awayFull] || awayFull;
    const homeAbbr = TEAM_MAP[homeFull] || homeFull;
    
    // Find matching OD game
    const odGame = schedule.find(g => g.away === awayAbbr && g.home === homeAbbr);
    
    if (odGame) {
      // Extract best odds from bookmakers
      const bestOdds = extractBestOdds(apiGame.bookmakers || []);
      
      matched.push({
        gameKey: `${awayAbbr}@${homeAbbr}`,
        day: odGame.day,
        time: odGame.time,
        api: {
          id: apiGame.id,
          commence: apiGame.commence_time,
          bookmakers: (apiGame.bookmakers || []).length,
        },
        staticLine: odGame.dkLine,
        liveOdds: bestOdds,
        movement: calculateMovement(odGame.dkLine, bestOdds),
        starters: odGame.confirmedStarters,
      });
    }
  }
  
  return matched;
}

/**
 * Extract best odds across all bookmakers
 */
function extractBestOdds(bookmakers) {
  const result = {
    homeML: null, awayML: null, total: null, overOdds: null, underOdds: null,
    homeSpread: null, awaySpread: null,
    bestHomeBook: null, bestAwayBook: null, bestOverBook: null, bestUnderBook: null,
    allBooks: [],
  };
  
  for (const book of bookmakers) {
    const bookName = book.title || book.key;
    const bookEntry = { name: bookName };
    
    for (const market of (book.markets || [])) {
      if (market.key === 'h2h') {
        for (const outcome of (market.outcomes || [])) {
          const price = outcome.price;
          if (outcome.name === bookmakers[0]?.markets?.[0]?.outcomes?.[0]?.name) {
            // Home team
            bookEntry.homeML = price;
            if (result.homeML === null || price > result.homeML) {
              result.homeML = price;
              result.bestHomeBook = bookName;
            }
          } else {
            bookEntry.awayML = price;
            if (result.awayML === null || price > result.awayML) {
              result.awayML = price;
              result.bestAwayBook = bookName;
            }
          }
        }
      } else if (market.key === 'totals') {
        for (const outcome of (market.outcomes || [])) {
          if (!bookEntry.total) bookEntry.total = outcome.point;
          if (outcome.name === 'Over') {
            bookEntry.overOdds = outcome.price;
            if (!result.total) result.total = outcome.point;
            if (result.overOdds === null || outcome.price > result.overOdds) {
              result.overOdds = outcome.price;
              result.bestOverBook = bookName;
            }
          } else {
            bookEntry.underOdds = outcome.price;
            if (result.underOdds === null || outcome.price > result.underOdds) {
              result.underOdds = outcome.price;
              result.bestUnderBook = bookName;
            }
          }
        }
      } else if (market.key === 'spreads') {
        for (const outcome of (market.outcomes || [])) {
          if (outcome.point < 0) {
            bookEntry.favSpread = outcome.point;
            bookEntry.favSpreadOdds = outcome.price;
          } else {
            bookEntry.dogSpread = outcome.point;
            bookEntry.dogSpreadOdds = outcome.price;
          }
        }
      }
    }
    
    result.allBooks.push(bookEntry);
  }
  
  return result;
}

/**
 * Calculate line movement from static → live
 */
function calculateMovement(staticLine, liveOdds) {
  if (!staticLine || !liveOdds || !liveOdds.homeML) return null;
  
  const movement = {
    homeMLMove: liveOdds.homeML - staticLine.homeML,
    awayMLMove: liveOdds.awayML - staticLine.awayML,
    totalMove: liveOdds.total ? (liveOdds.total - staticLine.total) : null,
    direction: 'STABLE',
    magnitude: 'MINOR',
    alert: false,
  };
  
  // Determine direction and magnitude
  const mlMove = Math.abs(movement.homeMLMove);
  const totalMove = Math.abs(movement.totalMove || 0);
  
  if (mlMove >= 20) {
    movement.magnitude = 'MAJOR';
    movement.alert = true;
  } else if (mlMove >= 10) {
    movement.magnitude = 'MODERATE';
    movement.alert = true;
  }
  
  if (movement.homeMLMove < -5) {
    movement.direction = 'HOME_STEAMING'; // Home getting more expensive = sharps on home
  } else if (movement.homeMLMove > 5) {
    movement.direction = 'AWAY_STEAMING'; // Home getting cheaper = sharps on away
  }
  
  if (totalMove >= 0.5) {
    movement.totalDirection = movement.totalMove > 0 ? 'OVER_STEAM' : 'UNDER_STEAM';
    movement.alert = true;
  }
  
  return movement;
}

/**
 * Main poll function — called every 15 min
 */
async function poll() {
  const startTime = Date.now();
  state.pollCount++;
  state.lastPoll = new Date().toISOString();
  
  console.log(`[od-odds-monitor] Poll #${state.pollCount} starting...`);
  
  const result = await fetchMLBOdds();
  
  if (result.error) {
    console.log(`[od-odds-monitor] Error: ${result.error}`);
    return { error: result.error };
  }
  
  const totalMLBGames = result.games.length;
  const matched = matchODGames(result.games);
  const prevGamesWithOdds = state.gamesWithOdds;
  state.gamesWithOdds = matched.length;
  
  console.log(`[od-odds-monitor] Found ${totalMLBGames} total MLB games, ${matched.length} matched to OD schedule`);
  
  // DETECT FIRST ODDS APPEARANCE
  if (matched.length > 0 && !state.firstOddsDetected) {
    state.firstOddsDetected = new Date().toISOString();
    console.log(`🚨🚨🚨 [od-odds-monitor] FIRST MLB OD ODDS DETECTED! ${matched.length} games with live lines!`);
    
    // Trigger immediate playbook rebuild
    await triggerPlaybookRebuild('First OD odds detected');
    
    // Generate alert
    addAlert('FIRST_ODDS', `🎯 MLB Opening Day odds are LIVE! ${matched.length} games with real lines.`, matched);
  }
  
  // DETECT NEW GAMES APPEARING
  if (matched.length > prevGamesWithOdds && prevGamesWithOdds > 0) {
    const newGames = matched.length - prevGamesWithOdds;
    console.log(`[od-odds-monitor] ${newGames} NEW OD games with odds (was ${prevGamesWithOdds}, now ${matched.length})`);
    addAlert('NEW_GAMES', `${newGames} new OD games with live odds (total: ${matched.length})`, matched);
  }
  
  // TRACK LINE MOVEMENT for each matched game
  const significantMoves = [];
  for (const game of matched) {
    const prev = state.lineMovement[game.gameKey];
    state.lineMovement[game.gameKey] = {
      ...game,
      lastUpdate: new Date().toISOString(),
      pollNumber: state.pollCount,
    };
    
    if (game.movement && game.movement.alert) {
      significantMoves.push(game);
    }
  }
  
  // Alert on significant moves
  if (significantMoves.length > 0) {
    const moveDescriptions = significantMoves.map(g => 
      `${g.gameKey}: ML ${g.movement.homeMLMove > 0 ? '+' : ''}${g.movement.homeMLMove}, Total ${g.movement.totalMove ? (g.movement.totalMove > 0 ? '+' : '') + g.movement.totalMove : 'N/A'} (${g.movement.magnitude})`
    );
    console.log(`[od-odds-monitor] Significant moves: ${moveDescriptions.join(', ')}`);
    addAlert('LINE_MOVEMENT', `${significantMoves.length} games with significant line movement`, significantMoves);
    
    // Trigger playbook rebuild on significant movement
    await triggerPlaybookRebuild(`Significant line movement in ${significantMoves.length} games`);
  }
  
  // Save snapshot
  saveSnapshot(matched);
  saveState();
  
  const elapsed = Date.now() - startTime;
  console.log(`[od-odds-monitor] Poll #${state.pollCount} complete in ${elapsed}ms — ${matched.length} OD games with odds, API remaining: ${result.remaining}`);
  
  return {
    totalMLBGames,
    odGamesWithOdds: matched.length,
    significantMoves: significantMoves.length,
    firstOddsDetected: state.firstOddsDetected,
    elapsed,
    apiRemaining: result.remaining,
    matched,
  };
}

/**
 * Trigger playbook cache rebuild with fresh odds
 */
async function triggerPlaybookRebuild(reason) {
  if (!playbookCache) {
    console.log(`[od-odds-monitor] Cannot rebuild playbook — module not loaded`);
    return;
  }
  
  try {
    console.log(`[od-odds-monitor] Triggering playbook rebuild: ${reason}`);
    if (typeof playbookCache.ensureFresh === 'function') {
      // Force rebuild by clearing cache first
      playbookCache.ensureFresh({ force: true }).catch(e => {
        console.error(`[od-odds-monitor] Playbook rebuild error: ${e.message}`);
      });
    }
    state.playbookRebuilds++;
    state.lastRebuilds = new Date().toISOString();
  } catch(e) {
    console.error(`[od-odds-monitor] Error triggering rebuild: ${e.message}`);
  }
}

/**
 * Add alert to history
 */
function addAlert(type, message, data) {
  state.alerts.unshift({
    type,
    message,
    timestamp: new Date().toISOString(),
    gameCount: data ? data.length : 0,
    games: data ? data.map(g => g.gameKey) : [],
  });
  
  // Keep max 100 alerts
  if (state.alerts.length > 100) state.alerts = state.alerts.slice(0, 100);
}

/**
 * Save snapshot for historical tracking
 */
function saveSnapshot(matched) {
  try {
    let snapshots = [];
    if (fs.existsSync(SNAPSHOTS_FILE)) {
      snapshots = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8'));
    }
    
    snapshots.push({
      timestamp: new Date().toISOString(),
      pollNumber: state.pollCount,
      gamesWithOdds: matched.length,
      games: matched.map(g => ({
        gameKey: g.gameKey,
        homeML: g.liveOdds?.homeML,
        awayML: g.liveOdds?.awayML,
        total: g.liveOdds?.total,
        books: g.liveOdds?.allBooks?.length || 0,
      })),
    });
    
    // Keep max 500 snapshots
    if (snapshots.length > 500) snapshots = snapshots.slice(-500);
    
    fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(snapshots, null, 2));
  } catch(e) {
    console.error(`[od-odds-monitor] Snapshot save error: ${e.message}`);
  }
}

/**
 * Save state to disk
 */
function saveState() {
  try {
    const toSave = { ...state };
    delete toSave.intervalHandle;
    fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch(e) {}
}

/**
 * Load state from disk
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      Object.assign(state, saved);
      state.intervalHandle = null;
    }
  } catch(e) {}
}

/**
 * Start the monitor (call on server boot)
 */
function start() {
  if (state.isRunning) {
    console.log('[od-odds-monitor] Already running');
    return;
  }
  
  loadState();
  state.isRunning = true;
  
  // Immediate first poll
  poll().catch(e => console.error(`[od-odds-monitor] Initial poll error: ${e.message}`));
  
  // Schedule recurring polls
  state.intervalHandle = setInterval(() => {
    poll().catch(e => console.error(`[od-odds-monitor] Poll error: ${e.message}`));
  }, POLL_INTERVAL);
  
  console.log(`[od-odds-monitor] Started — polling every ${POLL_INTERVAL / 60000} min for MLB OD odds`);
}

/**
 * Stop the monitor
 */
function stop() {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.isRunning = false;
  saveState();
  console.log('[od-odds-monitor] Stopped');
}

/**
 * Get status + summary for API
 */
function getStatus() {
  const schedule = odModel?.getSchedule ? odModel.getSchedule() : (odModel?.OPENING_DAY_GAMES || []);
  
  return {
    service: 'od-odds-monitor',
    version: '112.0',
    isRunning: state.isRunning,
    pollCount: state.pollCount,
    lastPoll: state.lastPoll,
    firstOddsDetected: state.firstOddsDetected,
    gamesWithOdds: state.gamesWithOdds,
    totalODGames: schedule.length,
    playbookRebuilds: state.playbookRebuilds,
    lastRebuilds: state.lastRebuilds,
    recentAlerts: state.alerts.slice(0, 5),
    lineMovement: Object.keys(state.lineMovement).length > 0 ? 
      Object.entries(state.lineMovement).map(([key, val]) => ({
        game: key,
        homeML: val.liveOdds?.homeML,
        awayML: val.liveOdds?.awayML,
        total: val.liveOdds?.total,
        movement: val.movement,
        bestHome: val.liveOdds?.bestHomeBook,
        bestAway: val.liveOdds?.bestAwayBook,
      })) : 'No live odds yet',
  };
}

/**
 * Get detailed line movement for a specific game
 */
function getGameDetails(gameKey) {
  return state.lineMovement[gameKey] || null;
}

/**
 * Get all tracked game movements
 */
function getAllMovements() {
  return state.lineMovement;
}

/**
 * Get alert history
 */
function getAlerts() {
  return state.alerts;
}

/**
 * Get odds comparison — our model vs market for all OD games
 */
function getOddsComparison() {
  if (!odModel) return { error: 'OD model not loaded' };
  
  const schedule = odModel.getSchedule ? odModel.getSchedule() : (odModel.OPENING_DAY_GAMES || []);
  const mlb = (() => { try { return require('../models/mlb'); } catch(e) { return null; } })();
  
  if (!mlb) return { error: 'MLB model not loaded' };
  
  const comparisons = [];
  
  for (const game of schedule) {
    const pred = mlb.predict(game.away, game.home, {
      awayPitcher: game.confirmedStarters?.away,
      homePitcher: game.confirmedStarters?.home,
    });
    
    const gameKey = `${game.away}@${game.home}`;
    const liveData = state.lineMovement[gameKey];
    const liveOdds = liveData?.liveOdds;
    const staticLine = game.dkLine;
    
    // Use live odds if available, else static
    const marketLine = liveOdds?.homeML ? liveOdds : {
      homeML: staticLine?.homeML, awayML: staticLine?.awayML, total: staticLine?.total,
      source: 'static-dk'
    };
    
    const homeImplied = marketLine.homeML ? 
      (marketLine.homeML < 0 ? (-marketLine.homeML) / (-marketLine.homeML + 100) : 100 / (marketLine.homeML + 100)) : 0.5;
    
    const modelHomeProb = pred.homeWinProb || 0.5;
    const mlEdge = modelHomeProb - homeImplied;
    
    comparisons.push({
      game: gameKey,
      day: game.day,
      time: game.time,
      starters: game.confirmedStarters,
      model: {
        homeWin: (modelHomeProb * 100).toFixed(1) + '%',
        total: pred.totalRuns?.toFixed(1),
        blended: pred.blendedHomeWinProb ? (pred.blendedHomeWinProb * 100).toFixed(1) + '%' : null,
      },
      market: {
        homeML: marketLine.homeML,
        awayML: marketLine.awayML,
        total: marketLine.total,
        homeImplied: (homeImplied * 100).toFixed(1) + '%',
        source: liveOdds?.homeML ? 'live-odds-api' : 'static-dk',
      },
      edge: {
        homeMLEdge: (mlEdge * 100).toFixed(1) + '%',
        totalEdge: marketLine.total ? ((pred.totalRuns || 0) - marketLine.total).toFixed(1) : 'N/A',
        signal: mlEdge > 0.03 ? 'HOME_VALUE' : mlEdge < -0.03 ? 'AWAY_VALUE' : 'NO_EDGE',
      },
      hasLiveOdds: !!liveOdds?.homeML,
      movement: liveData?.movement,
    });
  }
  
  // Sort by absolute edge (biggest edge first)
  comparisons.sort((a, b) => {
    const aEdge = Math.abs(parseFloat(a.edge.homeMLEdge));
    const bEdge = Math.abs(parseFloat(b.edge.homeMLEdge));
    return bEdge - aEdge;
  });
  
  return {
    generated: new Date().toISOString(),
    gamesWithLiveOdds: comparisons.filter(c => c.hasLiveOdds).length,
    totalGames: comparisons.length,
    comparisons,
    topEdges: comparisons.filter(c => Math.abs(parseFloat(c.edge.homeMLEdge)) > 3).slice(0, 5),
  };
}

// Load state on module load
loadState();

module.exports = {
  start,
  stop,
  poll,
  getStatus,
  getGameDetails,
  getAllMovements,
  getAlerts,
  getOddsComparison,
  matchODGames,
  TEAM_MAP,
};
