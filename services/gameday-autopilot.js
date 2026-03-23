// services/gameday-autopilot.js — Game Day Autopilot v81.0
// ========================================================
// THE MONEY PRINTER: Automated game-day orchestration that ties everything together.
//
// On March 26 (OD Day 1), this service:
//   1. Monitors lineup drops every 5 min (2-5 hrs pre-game)
//   2. Refreshes live odds every 3 min (1 hr pre-game → first pitch)
//   3. Re-runs ALL predictions when new data lands (lineups, odds, weather)
//   4. Compares fresh predictions to live odds → generates NEW value alerts
//   5. Tracks edge decay (our pick moved from +5% → +2% = value dying)
//   6. Alerts on CRITICAL changes: lineup swap, weather change, pitcher scratch
//   7. Rebuilds betting card in real-time with best available data
//   8. Grades bets as games complete (W/L/P + CLV tracking)
//
// WHY THIS MATTERS:
// Static betting cards from yesterday become STALE by first pitch.
// Lines move 10-30 cents when lineups drop. Weather changes shift totals.
// Late scratches flip games entirely. The first bettor to adjust prints.
//
// THIS service ensures we're ALWAYS betting on the most current model output.

const fs = require('fs');
const path = require('path');

// ==================== DEPENDENCIES ====================
let mlbModel = null;
let lineupFetcher = null;
let weatherService = null;
let umpireService = null;
let pitcherKProps = null;
let pitcherOutsProps = null;
let nrfiModel = null;
let batterProps = null;
let odSgpBuilder = null;
let odLiveLines = null;
let lineShoppingService = null;
let odPlaybookCache = null;
let mlbOpeningDay = null;

try { mlbModel = require('../models/mlb'); } catch(e) { /* ok */ }
try { lineupFetcher = require('./lineup-fetcher'); } catch(e) { /* ok */ }
try { weatherService = require('./weather'); } catch(e) { /* ok */ }
try { umpireService = require('./umpire-tendencies'); } catch(e) { /* ok */ }
try { pitcherKProps = require('./pitcher-k-props'); } catch(e) { /* ok */ }
try { pitcherOutsProps = require('./pitcher-outs-props'); } catch(e) { /* ok */ }
try { nrfiModel = require('./nrfi-model'); } catch(e) { /* ok */ }
try { batterProps = require('./batter-props'); } catch(e) { /* ok */ }
try { odSgpBuilder = require('./od-sgp-builder'); } catch(e) { /* ok */ }
try { odLiveLines = require('./od-live-lines'); } catch(e) { /* ok */ }
try { lineShoppingService = require('./line-shopping'); } catch(e) { /* ok */ }
try { odPlaybookCache = require('./od-playbook-cache'); } catch(e) { /* ok */ }
try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) { /* ok */ }

// ==================== STATE ====================
const STATE_PATH = path.join(__dirname, 'gameday-autopilot-state.json');

let state = {
  isRunning: false,
  mode: 'idle', // idle | pre-game | active | post-game
  startedAt: null,
  lastLineupScan: null,
  lastOddsScan: null,
  lastWeatherScan: null,
  lastFullRebuild: null,
  scanCounts: { lineups: 0, odds: 0, weather: 0, rebuilds: 0 },
  games: {}, // gameKey → game state (predictions, lineups, alerts)
  alerts: [], // chronological alert feed
  bettingCard: null, // current betting card snapshot
  pnl: { bets: [], totalWagered: 0, totalReturned: 0, roi: 0 },
  intervals: {},
};

// ==================== CONFIGURATION ====================
const CONFIG = {
  // Timing (all in milliseconds)
  LINEUP_SCAN_INTERVAL: 5 * 60 * 1000,      // 5 min — check for lineup drops
  ODDS_SCAN_INTERVAL: 3 * 60 * 1000,         // 3 min — refresh live odds
  WEATHER_SCAN_INTERVAL: 15 * 60 * 1000,     // 15 min — weather updates
  CARD_REBUILD_INTERVAL: 10 * 60 * 1000,     // 10 min — full card rebuild
  
  // Thresholds
  VALUE_ALERT_EDGE: 3.0,          // Min edge % to include on card
  EDGE_DECAY_ALERT: 2.0,          // Alert when edge drops by this much %
  NEW_VALUE_ALERT: 4.0,           // Alert on newly discovered edge > this %
  PITCHER_SCRATCH_ALERT: true,    // Alert on any pitcher scratch
  LINEUP_CHANGE_ALERT: true,      // Alert on significant lineup changes
  WEATHER_CHANGE_ALERT: 0.03,     // Alert when weather multiplier shifts > 3%
  
  // Game day schedule (UTC offsets for MLB games)
  // OD Day 1 (March 26): Games start ~17:10 UTC (1:10 PM ET) through ~23:10 UTC (7:10 PM ET)
  PRE_GAME_HOURS_BEFORE: 6,      // Start monitoring 6 hours before first game
  POST_GAME_HOURS_AFTER: 5,      // Keep monitoring 5 hours after last game start
};

// ==================== CORE ENGINE ====================

/**
 * Start the autopilot for a game day
 * @param {string} date - YYYY-MM-DD format
 * @param {Object} options - Override config options
 */
function start(date, options = {}) {
  if (state.isRunning) {
    return { status: 'already_running', since: state.startedAt, mode: state.mode };
  }
  
  const gameDate = date || new Date().toISOString().split('T')[0];
  const config = { ...CONFIG, ...options };
  
  state.isRunning = true;
  state.mode = 'pre-game';
  state.startedAt = new Date().toISOString();
  state.gameDate = gameDate;
  state.scanCounts = { lineups: 0, odds: 0, weather: 0, rebuilds: 0 };
  state.alerts = [];
  state.games = {};
  
  console.log(`[Autopilot] 🚀 GAME DAY AUTOPILOT STARTED for ${gameDate}`);
  console.log(`[Autopilot] Lineup scan: every ${config.LINEUP_SCAN_INTERVAL/1000}s`);
  console.log(`[Autopilot] Odds scan: every ${config.ODDS_SCAN_INTERVAL/1000}s`);
  console.log(`[Autopilot] Weather scan: every ${config.WEATHER_SCAN_INTERVAL/1000}s`);
  console.log(`[Autopilot] Card rebuild: every ${config.CARD_REBUILD_INTERVAL/1000}s`);
  
  // Initialize game states for all OD games
  initializeGames(gameDate);
  
  // Do an immediate full scan
  runFullScan().catch(e => console.error('[Autopilot] Initial scan error:', e.message));
  
  // Set up scanning intervals
  state.intervals.lineup = setInterval(() => {
    scanLineups().catch(e => console.error('[Autopilot] Lineup scan error:', e.message));
  }, config.LINEUP_SCAN_INTERVAL);
  
  state.intervals.odds = setInterval(() => {
    scanLiveOdds().catch(e => console.error('[Autopilot] Odds scan error:', e.message));
  }, config.ODDS_SCAN_INTERVAL);
  
  state.intervals.weather = setInterval(() => {
    scanWeather().catch(e => console.error('[Autopilot] Weather scan error:', e.message));
  }, config.WEATHER_SCAN_INTERVAL);
  
  state.intervals.rebuild = setInterval(() => {
    rebuildBettingCard().catch(e => console.error('[Autopilot] Rebuild error:', e.message));
  }, config.CARD_REBUILD_INTERVAL);
  
  saveState();
  
  return {
    status: 'started',
    date: gameDate,
    mode: state.mode,
    config: {
      lineupInterval: `${config.LINEUP_SCAN_INTERVAL/1000}s`,
      oddsInterval: `${config.ODDS_SCAN_INTERVAL/1000}s`,
      weatherInterval: `${config.WEATHER_SCAN_INTERVAL/1000}s`,
      rebuildInterval: `${config.CARD_REBUILD_INTERVAL/1000}s`,
    },
    gamesLoaded: Object.keys(state.games).length,
  };
}

/**
 * Stop the autopilot
 */
function stop() {
  if (!state.isRunning) return { status: 'not_running' };
  
  // Clear all intervals
  for (const [key, interval] of Object.entries(state.intervals)) {
    clearInterval(interval);
  }
  state.intervals = {};
  state.isRunning = false;
  state.mode = 'idle';
  
  console.log('[Autopilot] ⏹️ STOPPED');
  saveState();
  
  return { status: 'stopped', alerts: state.alerts.length, scans: state.scanCounts };
}

/**
 * Initialize game states from OD schedule
 */
function initializeGames(gameDate) {
  if (!mlbOpeningDay || !mlbOpeningDay.OPENING_DAY_GAMES) return;
  
  for (const game of mlbOpeningDay.OPENING_DAY_GAMES) {
    const gameKey = `${game.away}@${game.home}`;
    state.games[gameKey] = {
      away: game.away,
      home: game.home,
      day: game.day || 1,
      time: game.time || null,
      starters: {
        away: game.awayStarter || null,
        home: game.homeStarter || null,
      },
      lineups: {
        away: null,
        home: null,
        confirmed: false,
        lastUpdate: null,
      },
      odds: {
        ml: { away: null, home: null },
        total: { line: null, over: null, under: null },
        spread: { away: null, home: null, line: null },
        lastUpdate: null,
        history: [],
      },
      weather: {
        multiplier: null,
        temp: null,
        wind: null,
        description: null,
        lastUpdate: null,
      },
      prediction: null,
      previousPrediction: null,
      plays: [],
      status: 'pre-game', // pre-game | in-progress | final
    };
  }
  
  console.log(`[Autopilot] Initialized ${Object.keys(state.games).length} games`);
}

// ==================== SCANNING ENGINES ====================

/**
 * Scan for lineup changes across all games
 */
async function scanLineups() {
  if (!lineupFetcher) return;
  state.scanCounts.lineups++;
  state.lastLineupScan = new Date().toISOString();
  
  let changes = 0;
  
  for (const [gameKey, game] of Object.entries(state.games)) {
    if (game.status !== 'pre-game') continue;
    
    try {
      const lineupData = await lineupFetcher.getLineupAdjustments(game.away, game.home, state.gameDate);
      
      if (lineupData && lineupData.hasData) {
        const prevConfirmed = game.lineups.confirmed;
        const prevAway = JSON.stringify(game.lineups.away);
        const prevHome = JSON.stringify(game.lineups.home);
        
        game.lineups.away = lineupData.awayLineup || null;
        game.lineups.home = lineupData.homeLineup || null;
        game.lineups.confirmed = true;
        game.lineups.lastUpdate = new Date().toISOString();
        
        // Detect changes
        if (!prevConfirmed && game.lineups.confirmed) {
          changes++;
          addAlert('lineup_confirmed', gameKey, `✅ Lineups confirmed for ${gameKey}`, 'info');
          
          // Check for pitcher scratch (starter changed)
          if (lineupData.awayPitcher && game.starters.away && 
              lineupData.awayPitcher !== game.starters.away) {
            addAlert('pitcher_scratch', gameKey, 
              `🚨 PITCHER SCRATCH: ${game.away} starter changed from ${game.starters.away} → ${lineupData.awayPitcher}`,
              'critical');
            game.starters.away = lineupData.awayPitcher;
          }
          if (lineupData.homePitcher && game.starters.home && 
              lineupData.homePitcher !== game.starters.home) {
            addAlert('pitcher_scratch', gameKey,
              `🚨 PITCHER SCRATCH: ${game.home} starter changed from ${game.starters.home} → ${lineupData.homePitcher}`,
              'critical');
            game.starters.home = lineupData.homePitcher;
          }
          
          // Trigger re-prediction for this game
          await updateGamePrediction(gameKey, game);
        } else if (prevConfirmed && 
                   (JSON.stringify(game.lineups.away) !== prevAway || 
                    JSON.stringify(game.lineups.home) !== prevHome)) {
          changes++;
          addAlert('lineup_change', gameKey, `📋 Lineup updated for ${gameKey}`, 'warning');
          await updateGamePrediction(gameKey, game);
        }
      }
    } catch (e) {
      // Silent fail per-game
    }
  }
  
  if (changes > 0) {
    console.log(`[Autopilot] 📋 Lineup scan: ${changes} changes detected`);
  }
  
  return { scanned: Object.keys(state.games).length, changes };
}

/**
 * Scan live odds from The Odds API
 */
async function scanLiveOdds() {
  if (!odLiveLines) return;
  state.scanCounts.odds++;
  state.lastOddsScan = new Date().toISOString();
  
  let changes = 0;
  
  try {
    const liveData = await odLiveLines.fetchLiveMLBOdds();
    if (!liveData || !Array.isArray(liveData)) return { scanned: 0, changes: 0 };
    
    for (const odds of liveData) {
      // Map to our game key format
      const awayAbbr = odLiveLines.TEAM_ABBREVS[odds.away_team];
      const homeAbbr = odLiveLines.TEAM_ABBREVS[odds.home_team];
      if (!awayAbbr || !homeAbbr) continue;
      
      const gameKey = `${awayAbbr}@${homeAbbr}`;
      const game = state.games[gameKey];
      if (!game) continue;
      
      // Parse odds from bookmakers
      const parsed = odLiveLines.parseGameOdds(odds);
      if (!parsed) continue;
      
      // Detect significant line movement
      const prevML = game.odds.ml.home;
      const prevTotal = game.odds.total.line;
      
      // Update odds
      if (parsed.ml) {
        game.odds.ml = parsed.ml;
      }
      if (parsed.total) {
        game.odds.total = parsed.total;
      }
      if (parsed.spread) {
        game.odds.spread = parsed.spread;
      }
      
      // Track line movement
      game.odds.history.push({
        timestamp: new Date().toISOString(),
        ml: { ...game.odds.ml },
        total: { ...game.odds.total },
      });
      
      // Keep history manageable
      if (game.odds.history.length > 100) {
        game.odds.history = game.odds.history.slice(-50);
      }
      
      game.odds.lastUpdate = new Date().toISOString();
      
      // Alert on significant movement
      if (prevML !== null && game.odds.ml.home !== null) {
        const mlShift = Math.abs(game.odds.ml.home - prevML);
        if (mlShift >= 15) { // 15+ cent ML move
          changes++;
          addAlert('line_move', gameKey, 
            `📈 ML MOVE: ${gameKey} home ML ${prevML > 0 ? '+' : ''}${prevML} → ${game.odds.ml.home > 0 ? '+' : ''}${game.odds.ml.home} (${mlShift}c shift)`,
            mlShift >= 30 ? 'critical' : 'warning');
        }
      }
      
      if (prevTotal !== null && game.odds.total.line !== null) {
        const totalShift = Math.abs(game.odds.total.line - prevTotal);
        if (totalShift >= 0.5) { // Half-run total move
          changes++;
          addAlert('total_move', gameKey,
            `📊 TOTAL MOVE: ${gameKey} total ${prevTotal} → ${game.odds.total.line}`,
            'warning');
        }
      }
    }
  } catch (e) {
    console.error('[Autopilot] Odds scan error:', e.message);
  }
  
  if (changes > 0) {
    console.log(`[Autopilot] 📊 Odds scan: ${changes} significant moves`);
  }
  
  return { changes };
}

/**
 * Scan weather updates for all outdoor games
 */
async function scanWeather() {
  if (!weatherService || !weatherService.getWeatherForPark) return;
  state.scanCounts.weather++;
  state.lastWeatherScan = new Date().toISOString();
  
  let changes = 0;
  
  for (const [gameKey, game] of Object.entries(state.games)) {
    try {
      const weather = await weatherService.getWeatherForPark(game.home);
      if (!weather || weather.error || weather.dome) continue;
      
      const prevMultiplier = game.weather.multiplier;
      
      game.weather = {
        multiplier: weather.multiplier || 1.0,
        temp: weather.temp || weather.temperature,
        wind: weather.windSpeed || weather.wind,
        windDir: weather.windDir || weather.windDirection,
        description: weather.description || '',
        factors: weather.factors || [],
        lastUpdate: new Date().toISOString(),
      };
      
      // Alert on significant weather change
      if (prevMultiplier !== null && game.weather.multiplier !== null) {
        const shift = Math.abs(game.weather.multiplier - prevMultiplier);
        if (shift >= CONFIG.WEATHER_CHANGE_ALERT) {
          changes++;
          const direction = game.weather.multiplier > prevMultiplier ? '↑ OVER' : '↓ UNDER';
          addAlert('weather_change', gameKey,
            `🌤️ WEATHER SHIFT: ${gameKey} multiplier ${prevMultiplier.toFixed(3)} → ${game.weather.multiplier.toFixed(3)} (${direction} lean)`,
            'warning');
        }
      }
    } catch (e) {
      // Silent fail per-game
    }
  }
  
  if (changes > 0) {
    console.log(`[Autopilot] 🌤️ Weather scan: ${changes} significant changes`);
  }
  
  return { changes };
}

/**
 * Run a full scan of all data sources
 */
async function runFullScan() {
  console.log('[Autopilot] 🔄 Running full scan...');
  
  const results = await Promise.allSettled([
    scanLineups(),
    scanLiveOdds(),
    scanWeather(),
  ]);
  
  // Rebuild card after full scan
  await rebuildBettingCard();
  
  return {
    lineup: results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message },
    odds: results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message },
    weather: results[2].status === 'fulfilled' ? results[2].value : { error: results[2].reason?.message },
    cardRebuilt: true,
  };
}

// ==================== PREDICTION ENGINE ====================

/**
 * Re-run prediction for a single game with all available live data
 */
async function updateGamePrediction(gameKey, game) {
  if (!mlbModel || !mlbModel.asyncPredict) return;
  
  try {
    // Build opts with all live data
    const opts = {
      gameDate: state.gameDate,
      isOpeningDay: true,
    };
    
    // Inject live lineup data if available
    if (game.lineups.confirmed && game.lineups.away) {
      opts.lineup = {
        hasData: true,
        awayLineup: game.lineups.away,
        homeLineup: game.lineups.home,
      };
    }
    
    // Inject live weather if available
    if (game.weather.multiplier) {
      opts.weather = {
        multiplier: game.weather.multiplier,
        description: game.weather.description,
        factors: game.weather.factors || [],
      };
    }
    
    // Store previous prediction for comparison
    game.previousPrediction = game.prediction ? { ...game.prediction } : null;
    
    // Run prediction
    const result = await mlbModel.asyncPredict(game.away, game.home, opts);
    
    if (result) {
      game.prediction = {
        homeWinProb: result.homeWinProb,
        awayWinProb: result.awayWinProb,
        expectedTotal: result.expectedTotal,
        homeRuns: result.homeRuns,
        awayRuns: result.awayRuns,
        signals: result._asyncSignals,
        timestamp: new Date().toISOString(),
      };
      
      // Check for significant prediction changes
      if (game.previousPrediction) {
        const probShift = Math.abs(
          (game.prediction.homeWinProb || 0) - (game.previousPrediction.homeWinProb || 0)
        );
        const totalShift = Math.abs(
          (game.prediction.expectedTotal || 0) - (game.previousPrediction.expectedTotal || 0)
        );
        
        if (probShift > 0.03) { // >3% win prob change
          addAlert('prediction_shift', gameKey,
            `🎯 PREDICTION SHIFT: ${gameKey} home win ${(game.previousPrediction.homeWinProb*100).toFixed(1)}% → ${(game.prediction.homeWinProb*100).toFixed(1)}% (${(probShift*100).toFixed(1)}% shift)`,
            probShift > 0.05 ? 'critical' : 'info');
        }
        if (totalShift > 0.3) { // >0.3 runs total change
          addAlert('total_shift', gameKey,
            `📊 TOTAL SHIFT: ${gameKey} expected ${game.previousPrediction.expectedTotal.toFixed(2)} → ${game.prediction.expectedTotal.toFixed(2)} runs`,
            'info');
        }
      }
      
      // Detect edge changes vs live odds
      detectEdgeChanges(gameKey, game);
    }
  } catch (e) {
    console.error(`[Autopilot] Prediction error for ${gameKey}:`, e.message);
  }
}

/**
 * Compare predictions to live odds and detect edge changes
 */
function detectEdgeChanges(gameKey, game) {
  if (!game.prediction || !game.odds.ml.home) return;
  
  const plays = [];
  
  // ML edge
  const homeML = game.odds.ml.home;
  const awayML = game.odds.ml.away;
  
  if (homeML && game.prediction.homeWinProb) {
    const bookProb = homeML > 0 ? 100 / (homeML + 100) : Math.abs(homeML) / (Math.abs(homeML) + 100);
    const edge = (game.prediction.homeWinProb - bookProb) * 100;
    
    if (edge > CONFIG.VALUE_ALERT_EDGE) {
      plays.push({
        type: 'ML',
        pick: `${game.home} ML`,
        line: homeML,
        edge: +edge.toFixed(1),
        modelProb: +(game.prediction.homeWinProb * 100).toFixed(1),
        bookProb: +(bookProb * 100).toFixed(1),
        confidence: edge > 8 ? 'HIGH' : edge > 5 ? 'MEDIUM' : 'LOW',
      });
    }
  }
  
  if (awayML && game.prediction.awayWinProb) {
    const bookProb = awayML > 0 ? 100 / (awayML + 100) : Math.abs(awayML) / (Math.abs(awayML) + 100);
    const edge = (game.prediction.awayWinProb - bookProb) * 100;
    
    if (edge > CONFIG.VALUE_ALERT_EDGE) {
      plays.push({
        type: 'ML',
        pick: `${game.away} ML`,
        line: awayML,
        edge: +edge.toFixed(1),
        modelProb: +(game.prediction.awayWinProb * 100).toFixed(1),
        bookProb: +(bookProb * 100).toFixed(1),
        confidence: edge > 8 ? 'HIGH' : edge > 5 ? 'MEDIUM' : 'LOW',
      });
    }
  }
  
  // Total edge
  if (game.odds.total.line && game.prediction.expectedTotal) {
    const totalLine = game.odds.total.line;
    const expectedTotal = game.prediction.expectedTotal;
    
    if (expectedTotal > totalLine + 0.3) {
      const edge = ((expectedTotal - totalLine) / totalLine * 100);
      plays.push({
        type: 'TOTAL',
        pick: `OVER ${totalLine}`,
        line: game.odds.total.over || -110,
        edge: +edge.toFixed(1),
        modelTotal: +expectedTotal.toFixed(2),
        bookTotal: totalLine,
        confidence: edge > 5 ? 'HIGH' : edge > 3 ? 'MEDIUM' : 'LOW',
      });
    } else if (expectedTotal < totalLine - 0.3) {
      const edge = ((totalLine - expectedTotal) / totalLine * 100);
      plays.push({
        type: 'TOTAL',
        pick: `UNDER ${totalLine}`,
        line: game.odds.total.under || -110,
        edge: +edge.toFixed(1),
        modelTotal: +expectedTotal.toFixed(2),
        bookTotal: totalLine,
        confidence: edge > 5 ? 'HIGH' : edge > 3 ? 'MEDIUM' : 'LOW',
      });
    }
  }
  
  // Detect NEW edges that weren't on previous card
  const prevPlays = game.plays || [];
  for (const play of plays) {
    const wasOnCard = prevPlays.some(p => p.type === play.type && p.pick === play.pick);
    if (!wasOnCard && play.edge >= CONFIG.NEW_VALUE_ALERT) {
      addAlert('new_edge', gameKey,
        `🆕 NEW EDGE: ${play.pick} @ ${play.line > 0 ? '+' : ''}${play.line} — ${play.edge}% edge (model ${play.modelProb || play.modelTotal}%)`,
        'critical');
    }
  }
  
  // Detect DEAD edges (were on card, now gone)
  for (const prevPlay of prevPlays) {
    const stillAlive = plays.some(p => p.type === prevPlay.type && p.pick === prevPlay.pick);
    if (!stillAlive && prevPlay.edge >= CONFIG.NEW_VALUE_ALERT) {
      addAlert('dead_edge', gameKey,
        `💀 EDGE DEAD: ${prevPlay.pick} was ${prevPlay.edge}% edge — no longer profitable`,
        'warning');
    }
  }
  
  // Detect DECAYING edges
  for (const play of plays) {
    const prevPlay = prevPlays.find(p => p.type === play.type && p.pick === play.pick);
    if (prevPlay && prevPlay.edge - play.edge >= CONFIG.EDGE_DECAY_ALERT) {
      addAlert('edge_decay', gameKey,
        `📉 EDGE DECAY: ${play.pick} edge ${prevPlay.edge}% → ${play.edge}% (${(prevPlay.edge - play.edge).toFixed(1)}% lost)`,
        'warning');
    }
  }
  
  game.plays = plays;
}

// ==================== BETTING CARD BUILDER ====================

/**
 * Rebuild the full betting card from current live data
 */
async function rebuildBettingCard() {
  state.scanCounts.rebuilds++;
  state.lastFullRebuild = new Date().toISOString();
  
  const card = {
    timestamp: new Date().toISOString(),
    gameDate: state.gameDate,
    totalGames: Object.keys(state.games).length,
    plays: [],
    summary: {
      totalPlays: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      totalEdge: 0,
      byType: {},
      byGame: {},
    },
    propPlays: [],
    nrfiPlays: [],
    sgpPlays: [],
  };
  
  // Re-run predictions for all pre-game games
  for (const [gameKey, game] of Object.entries(state.games)) {
    if (game.status !== 'pre-game') continue;
    await updateGamePrediction(gameKey, game);
    
    // Add game-level plays to card
    for (const play of (game.plays || [])) {
      card.plays.push({
        ...play,
        game: gameKey,
        starters: game.starters,
        weather: game.weather.description || 'N/A',
      });
    }
  }
  
  // Add K Props
  if (pitcherKProps) {
    try {
      const kScan = pitcherKProps.scanODKProps ? pitcherKProps.scanODKProps({ isOpeningDay: true }) : null;
      if (kScan && kScan.picks) {
        for (const pick of kScan.picks) {
          if (pick.edge > 3) {
            card.propPlays.push({
              type: 'K_PROP',
              ...pick,
              category: 'pitcher_prop',
            });
          }
        }
      }
    } catch (e) { /* ok */ }
  }
  
  // Add Outs Props  
  if (pitcherOutsProps) {
    try {
      const outsScan = pitcherOutsProps.scanODOutsProps ? pitcherOutsProps.scanODOutsProps({ isOpeningDay: true }) : null;
      if (outsScan && outsScan.picks) {
        for (const pick of outsScan.picks) {
          if (pick.edge > 3) {
            card.propPlays.push({
              type: 'OUTS_PROP',
              ...pick,
              category: 'pitcher_prop',
            });
          }
        }
      }
    } catch (e) { /* ok */ }
  }
  
  // Add NRFI/YRFI
  if (nrfiModel) {
    try {
      const nrfiScan = nrfiModel.scanODGames ? nrfiModel.scanODGames({ isOpeningDay: true }) : null;
      if (nrfiScan && nrfiScan.picks) {
        card.nrfiPlays = nrfiScan.picks.filter(p => p.edge > 2);
      }
    } catch (e) { /* ok */ }
  }
  
  // Add SGPs
  if (odSgpBuilder) {
    try {
      const sgpScan = odSgpBuilder.scanODSGPs ? odSgpBuilder.scanODSGPs() : null;
      if (sgpScan && sgpScan.parlays) {
        card.sgpPlays = sgpScan.parlays
          .filter(p => p.confidence === 'HIGH')
          .slice(0, 20);
      }
    } catch (e) { /* ok */ }
  }
  
  // Build summary
  card.summary.totalPlays = card.plays.length + card.propPlays.length + card.nrfiPlays.length;
  for (const play of card.plays) {
    if (play.confidence === 'HIGH') card.summary.highConfidence++;
    else if (play.confidence === 'MEDIUM') card.summary.mediumConfidence++;
    else card.summary.lowConfidence++;
    
    card.summary.totalEdge += play.edge || 0;
    card.summary.byType[play.type] = (card.summary.byType[play.type] || 0) + 1;
    card.summary.byGame[play.game] = (card.summary.byGame[play.game] || 0) + 1;
  }
  
  state.bettingCard = card;
  saveState();
  
  console.log(`[Autopilot] 🃏 Card rebuilt: ${card.summary.totalPlays} total plays (${card.summary.highConfidence} HIGH, ${card.summary.mediumConfidence} MED, ${card.summary.lowConfidence} LOW)`);
  
  return card;
}

// ==================== ALERT SYSTEM ====================

function addAlert(type, gameKey, message, severity = 'info') {
  const alert = {
    id: state.alerts.length + 1,
    type,
    game: gameKey,
    message,
    severity, // info | warning | critical
    timestamp: new Date().toISOString(),
    read: false,
  };
  
  state.alerts.push(alert);
  
  // Keep alerts manageable
  if (state.alerts.length > 500) {
    state.alerts = state.alerts.slice(-250);
  }
  
  // Log critical alerts
  if (severity === 'critical') {
    console.log(`[Autopilot] 🚨 CRITICAL: ${message}`);
  }
  
  return alert;
}

// ==================== STATUS & QUERY ====================

/**
 * Get current autopilot status
 */
function getStatus() {
  return {
    isRunning: state.isRunning,
    mode: state.mode,
    startedAt: state.startedAt,
    gameDate: state.gameDate || null,
    scans: {
      lineups: {
        count: state.scanCounts.lineups,
        lastScan: state.lastLineupScan,
      },
      odds: {
        count: state.scanCounts.odds,
        lastScan: state.lastOddsScan,
      },
      weather: {
        count: state.scanCounts.weather,
        lastScan: state.lastWeatherScan,
      },
      rebuilds: {
        count: state.scanCounts.rebuilds,
        lastRebuild: state.lastFullRebuild,
      },
    },
    games: Object.keys(state.games).length,
    gamesWithLineups: Object.values(state.games).filter(g => g.lineups.confirmed).length,
    gamesWithOdds: Object.values(state.games).filter(g => g.odds.ml.home !== null).length,
    gamesWithWeather: Object.values(state.games).filter(g => g.weather.multiplier !== null).length,
    gamesWithPredictions: Object.values(state.games).filter(g => g.prediction !== null).length,
    alerts: {
      total: state.alerts.length,
      critical: state.alerts.filter(a => a.severity === 'critical').length,
      unread: state.alerts.filter(a => !a.read).length,
      recent: state.alerts.slice(-10),
    },
    bettingCard: state.bettingCard ? {
      timestamp: state.bettingCard.timestamp,
      totalPlays: state.bettingCard.summary.totalPlays,
      highConfidence: state.bettingCard.summary.highConfidence,
      propPlays: state.bettingCard.propPlays.length,
      nrfiPlays: state.bettingCard.nrfiPlays.length,
      sgpPlays: state.bettingCard.sgpPlays.length,
    } : null,
  };
}

/**
 * Get the current live betting card
 */
function getBettingCard() {
  return state.bettingCard || { plays: [], propPlays: [], nrfiPlays: [], sgpPlays: [], summary: {} };
}

/**
 * Get all alerts (optionally filtered)
 */
function getAlerts(filters = {}) {
  let alerts = [...state.alerts];
  
  if (filters.severity) {
    alerts = alerts.filter(a => a.severity === filters.severity);
  }
  if (filters.type) {
    alerts = alerts.filter(a => a.type === filters.type);
  }
  if (filters.game) {
    alerts = alerts.filter(a => a.game === filters.game);
  }
  if (filters.unread) {
    alerts = alerts.filter(a => !a.read);
  }
  if (filters.limit) {
    alerts = alerts.slice(-filters.limit);
  }
  
  return alerts;
}

/**
 * Mark alerts as read
 */
function markAlertsRead(ids) {
  if (!ids) {
    state.alerts.forEach(a => a.read = true);
    return { marked: state.alerts.length };
  }
  
  let marked = 0;
  for (const id of ids) {
    const alert = state.alerts.find(a => a.id === id);
    if (alert) { alert.read = true; marked++; }
  }
  return { marked };
}

/**
 * Get detailed game state
 */
function getGameState(gameKey) {
  return state.games[gameKey] || null;
}

/**
 * Get all game states
 */
function getAllGameStates() {
  return state.games;
}

/**
 * Get games sorted by edge value
 */
function getTopEdges(limit = 10) {
  const allPlays = [];
  
  for (const [gameKey, game] of Object.entries(state.games)) {
    for (const play of (game.plays || [])) {
      allPlays.push({ ...play, game: gameKey });
    }
  }
  
  return allPlays
    .sort((a, b) => (b.edge || 0) - (a.edge || 0))
    .slice(0, limit);
}

/**
 * Run an on-demand full scan (called from API)
 */
async function forceScan() {
  return runFullScan();
}

// ==================== PERSISTENCE ====================

function saveState() {
  try {
    const toSave = {
      ...state,
      intervals: undefined, // Don't serialize intervals
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(toSave, null, 2));
  } catch (e) {
    // Silent fail
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      // Don't restore running state (intervals are dead)
      state = { ...saved, isRunning: false, intervals: {} };
    }
  } catch (e) {
    // Start fresh
  }
}

// Load saved state on startup
loadState();

// ==================== EXPORTS ====================
module.exports = {
  start,
  stop,
  getStatus,
  getBettingCard,
  getAlerts,
  markAlertsRead,
  getGameState,
  getAllGameStates,
  getTopEdges,
  forceScan,
  scanLineups,
  scanLiveOdds,
  scanWeather,
  rebuildBettingCard,
};
