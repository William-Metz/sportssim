/**
 * Gameday Lineup Pipeline — SportsSim v110.0
 * =============================================
 * THE CRITICAL OD/REGULAR SEASON LINEUP PIPELINE.
 * 
 * Replaces the old lineup-monitor.js (ESPN-only) with a multi-source
 * pipeline that uses MLB Stats API (primary) + ESPN (backup) + manual overrides.
 * 
 * This service:
 *   1. Auto-detects MLB game days and starts monitoring
 *   2. Scans ALL lineup sources every 3 minutes (game day) or 15 min (non-game day)
 *   3. Detects when lineups are confirmed → triggers prediction rebuilds
 *   4. Tracks lineup changes → flags prediction-impacting moves
 *   5. Provides real-time gameday readiness dashboard
 *   6. Works for Opening Day AND regular season
 *
 * THE MONEY ANGLE:
 *   - Lines move 10-30 cents when lineups drop
 *   - We want to re-price predictions BEFORE the market moves
 *   - Multi-source ensures we catch lineups from fastest source
 *   - Auto-rebuild predictions = sharper edge when we bet
 */

const fs = require('fs');
const path = require('path');

// ==================== DEPENDENCIES ====================

let mlbStatsLineups = null;
let lineupBridge = null;
let lineupFetcher = null;
let mlbModel = null;
let odPlaybookCache = null;

function loadDeps() {
  if (!mlbStatsLineups) {
    try { mlbStatsLineups = require('./mlb-stats-lineups'); } catch (e) {}
  }
  if (!lineupBridge) {
    try { lineupBridge = require('./lineup-bridge'); } catch (e) {}
  }
  if (!lineupFetcher) {
    try { lineupFetcher = require('./lineup-fetcher'); } catch (e) {}
  }
  if (!mlbModel) {
    try { mlbModel = require('../models/mlb'); } catch (e) {}
  }
  if (!odPlaybookCache) {
    try { odPlaybookCache = require('./od-playbook-cache'); } catch (e) {}
  }
}

// ==================== STATE ====================

const STATE_FILE = path.join(__dirname, 'gameday-lineup-state.json');
const SCAN_INTERVAL_GAMEDAY = 3 * 60 * 1000;    // 3 min on game day (lineups change fast)
const SCAN_INTERVAL_OFFDAY = 15 * 60 * 1000;     // 15 min on off day
const PRE_GAME_ALERT_HOURS = 2;                    // Alert if lineup missing <2h before game

let isRunning = false;
let scanInterval = null;
let lastScanResult = null;
let scanHistory = [];
let lineupSnapshots = {};  // gameKey → last known lineup state
let predictionRebuilds = [];  // Track when predictions were rebuilt
let gameDay = false;

// ==================== CORE SCANNING ====================

/**
 * Initialize with dependencies (called from server.js)
 */
function init(deps = {}) {
  if (deps.mlbModel) mlbModel = deps.mlbModel;
  if (deps.lineupFetcher) lineupFetcher = deps.lineupFetcher;
  if (deps.lineupBridge) lineupBridge = deps.lineupBridge;
  if (deps.mlbStatsLineups) mlbStatsLineups = deps.mlbStatsLineups;
  if (deps.odPlaybookCache) odPlaybookCache = deps.odPlaybookCache;
  loadDeps();
}

/**
 * Start the monitoring loop.
 * Auto-detects game day and adjusts scan interval.
 */
function start(opts = {}) {
  if (isRunning) return { status: 'already_running', interval: scanInterval ? 'active' : 'none' };
  isRunning = true;
  
  const forceGameDay = opts.gameDay || false;
  
  console.log('[Lineup Pipeline] 🚀 Starting gameday lineup monitoring...');
  
  // Do immediate scan
  scan().then(result => {
    gameDay = result.isGameDay || forceGameDay;
    const interval = gameDay ? SCAN_INTERVAL_GAMEDAY : SCAN_INTERVAL_OFFDAY;
    
    console.log(`[Lineup Pipeline] ${gameDay ? '⚾ GAME DAY' : '📅 Off day'} — scanning every ${interval / 60000} min`);
    
    // Set up recurring scan
    scanInterval = setInterval(() => {
      scan().catch(e => console.error('[Lineup Pipeline] Scan error:', e.message));
    }, interval);
  }).catch(e => {
    console.error('[Lineup Pipeline] Initial scan failed:', e.message);
    // Start with off-day interval as fallback
    scanInterval = setInterval(() => {
      scan().catch(e => console.error('[Lineup Pipeline] Scan error:', e.message));
    }, SCAN_INTERVAL_OFFDAY);
  });
  
  return { status: 'started', scanIntervals: { gameDay: '3 min', offDay: '15 min' } };
}

/**
 * Stop the monitoring loop.
 */
function stop() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  isRunning = false;
  console.log('[Lineup Pipeline] Stopped');
  return { status: 'stopped' };
}

/**
 * Run a single scan — the core of the pipeline.
 * 1. Check all MLB games today via MLB Stats API
 * 2. Detect confirmed lineups
 * 3. Compare to previous state → detect changes
 * 4. Trigger prediction rebuilds when lineups confirm
 * 5. Flag alerts for missing lineups close to game time
 */
async function scan(opts = {}) {
  loadDeps();
  
  const scanTime = new Date();
  const dateStr = opts.date || scanTime.toISOString().split('T')[0];
  
  const result = {
    scanTime: scanTime.toISOString(),
    date: dateStr,
    isGameDay: false,
    gamesFound: 0,
    lineupsConfirmed: 0,
    lineupsPending: 0,
    changes: [],
    alerts: [],
    games: [],
    sources: { mlbStats: false, espn: false },
    rebuildTriggered: false,
  };
  
  // === Source 1: MLB Stats API (primary — authoritative, fastest) ===
  let mlbStatsGames = [];
  if (mlbStatsLineups) {
    try {
      const data = await mlbStatsLineups.fetchAllLineups(dateStr);
      mlbStatsGames = data.games || [];
      result.sources.mlbStats = true;
      result.sources.mlbStatsCount = mlbStatsGames.length;
    } catch (e) {
      result.sources.mlbStatsError = e.message;
    }
  }
  
  // === Source 2: ESPN (backup) ===
  let espnGames = [];
  if (lineupFetcher && mlbStatsGames.length === 0) {
    try {
      const data = await lineupFetcher.fetchLineups(dateStr.replace(/-/g, ''));
      espnGames = data.games || [];
      result.sources.espn = true;
      result.sources.espnCount = espnGames.length;
    } catch (e) {
      result.sources.espnError = e.message;
    }
  }
  
  // Merge: prefer MLB Stats API data, fill gaps from ESPN
  const games = mlbStatsGames.length > 0 ? mlbStatsGames : espnGames;
  
  if (games.length === 0) {
    result.isGameDay = false;
    lastScanResult = result;
    return result;
  }
  
  result.isGameDay = true;
  result.gamesFound = games.length;
  
  // Process each game
  for (const game of games) {
    const awayAbbr = game.awayTeam || game.awayTeam;
    const homeAbbr = game.homeTeam || game.homeTeam;
    const gameKey = `${awayAbbr}@${homeAbbr}`;
    const gameTime = game.gameDate || game.gameTime;
    
    // Determine lineup status
    const awayConfirmed = game.awayLineup?.confirmed || false;
    const homeConfirmed = game.homeLineup?.confirmed || false;
    const bothConfirmed = awayConfirmed && homeConfirmed;
    
    // Track changes from previous snapshot
    const prevSnapshot = lineupSnapshots[gameKey];
    const changes = [];
    
    if (prevSnapshot) {
      if (!prevSnapshot.awayConfirmed && awayConfirmed) {
        changes.push(`🔔 ${awayAbbr} lineup CONFIRMED`);
      }
      if (!prevSnapshot.homeConfirmed && homeConfirmed) {
        changes.push(`🔔 ${homeAbbr} lineup CONFIRMED`);
      }
    } else if (bothConfirmed) {
      changes.push(`✅ Both lineups confirmed`);
    }
    
    // Update snapshot
    lineupSnapshots[gameKey] = {
      awayConfirmed,
      homeConfirmed,
      bothConfirmed,
      lastChecked: scanTime.toISOString(),
      awayBatterCount: game.awayLineup?.battingOrder?.length || 0,
      homeBatterCount: game.homeLineup?.battingOrder?.length || 0,
      awayCatcher: game.awayLineup?.catcher?.name || game.awayLineup?.catcher || null,
      homeCatcher: game.homeLineup?.catcher?.name || game.homeLineup?.catcher || null,
    };
    
    // Time-based alerts
    if (gameTime) {
      const gameDate = new Date(gameTime);
      const hoursUntilGame = (gameDate - scanTime) / (1000 * 60 * 60);
      
      if (hoursUntilGame > 0 && hoursUntilGame < PRE_GAME_ALERT_HOURS && !bothConfirmed) {
        const missing = [];
        if (!awayConfirmed) missing.push(awayAbbr);
        if (!homeConfirmed) missing.push(homeAbbr);
        result.alerts.push({
          level: hoursUntilGame < 1 ? 'CRITICAL' : 'WARNING',
          game: gameKey,
          message: `⚠️ ${gameKey}: ${missing.join(' + ')} lineup NOT CONFIRMED — game in ${hoursUntilGame.toFixed(1)}h`,
          hoursUntilGame: +hoursUntilGame.toFixed(1),
          missingTeams: missing,
        });
      }
    }
    
    if (bothConfirmed) result.lineupsConfirmed++;
    else result.lineupsPending++;
    
    result.changes.push(...changes.map(c => ({ game: gameKey, change: c })));
    
    result.games.push({
      gameKey,
      gameTime,
      status: game.status || 'Scheduled',
      venue: game.venue,
      awayConfirmed,
      homeConfirmed,
      bothConfirmed,
      awayBatters: game.awayLineup?.battingOrder?.length || 0,
      homeBatters: game.homeLineup?.battingOrder?.length || 0,
      awayCatcher: lineupSnapshots[gameKey].awayCatcher,
      homeCatcher: lineupSnapshots[gameKey].homeCatcher,
      awayPitcher: game.probablePitchers?.away || game.awayPitcher?.name || 'TBD',
      homePitcher: game.probablePitchers?.home || game.homePitcher?.name || 'TBD',
      changes,
    });
  }
  
  // Trigger prediction rebuild if NEW lineups were confirmed this scan
  if (result.changes.length > 0) {
    const confirmedChanges = result.changes.filter(c => c.change.includes('CONFIRMED'));
    if (confirmedChanges.length > 0) {
      result.rebuildTriggered = true;
      predictionRebuilds.push({
        time: scanTime.toISOString(),
        reason: `${confirmedChanges.length} new lineup(s) confirmed`,
        games: confirmedChanges.map(c => c.game),
      });
      
      // Trigger OD playbook cache rebuild if applicable
      if (odPlaybookCache && odPlaybookCache.ensureFresh) {
        try {
          odPlaybookCache.ensureFresh().catch(() => {});
          console.log(`[Lineup Pipeline] 🔄 Triggered playbook cache rebuild after ${confirmedChanges.length} lineup change(s)`);
        } catch (e) { /* non-blocking */ }
      }
      
      console.log(`[Lineup Pipeline] 🔔 ${confirmedChanges.length} new lineup(s) confirmed: ${confirmedChanges.map(c => c.game).join(', ')}`);
    }
  }
  
  // Save state
  lastScanResult = result;
  scanHistory.push({
    time: scanTime.toISOString(),
    games: result.gamesFound,
    confirmed: result.lineupsConfirmed,
    pending: result.lineupsPending,
    changes: result.changes.length,
    alerts: result.alerts.length,
  });
  
  // Keep last 100 scans
  if (scanHistory.length > 100) scanHistory = scanHistory.slice(-100);
  
  // Persist state
  saveState();
  
  return result;
}

// ==================== GAMEDAY READINESS ====================

/**
 * Get comprehensive gameday readiness report.
 * This is the KEY endpoint for pre-game validation.
 */
async function getGamedayReadiness(dateStr = null) {
  loadDeps();
  
  if (!dateStr) dateStr = new Date().toISOString().split('T')[0];
  
  // Force a fresh scan
  const scanResult = await scan({ date: dateStr });
  
  const readiness = {
    date: dateStr,
    scanTime: new Date().toISOString(),
    isGameDay: scanResult.isGameDay,
    overallStatus: 'UNKNOWN',
    
    // Lineup summary
    lineup: {
      total: scanResult.gamesFound,
      confirmed: scanResult.lineupsConfirmed,
      pending: scanResult.lineupsPending,
      pct: scanResult.gamesFound > 0 ? Math.round((scanResult.lineupsConfirmed / scanResult.gamesFound) * 100) : 0,
    },
    
    // Source health
    sources: {
      mlbStatsAPI: { active: !!mlbStatsLineups, lastUsed: scanResult.sources.mlbStats },
      espn: { active: !!lineupFetcher },
      overrides: { active: true, count: 0 },
      lineupBridge: { active: !!lineupBridge },
    },
    
    // Per-game readiness
    games: scanResult.games.map(g => ({
      ...g,
      readiness: g.bothConfirmed ? '✅ READY' :
                 g.awayConfirmed || g.homeConfirmed ? '⚠️ PARTIAL' : '❌ PENDING',
      predictionReady: g.bothConfirmed,
    })),
    
    // Alerts
    alerts: scanResult.alerts,
    
    // Pipeline health
    pipeline: {
      monitorRunning: isRunning,
      scanInterval: gameDay ? '3 min' : '15 min',
      lastScan: lastScanResult?.scanTime || null,
      totalScans: scanHistory.length,
      predictionRebuilds: predictionRebuilds.slice(-10),
    },
  };
  
  // Overall status
  if (!scanResult.isGameDay) {
    readiness.overallStatus = 'NO_GAMES';
  } else if (scanResult.lineupsConfirmed === scanResult.gamesFound) {
    readiness.overallStatus = 'ALL_CONFIRMED';
  } else if (scanResult.lineupsConfirmed > 0) {
    readiness.overallStatus = 'PARTIAL';
  } else if (scanResult.alerts.some(a => a.level === 'CRITICAL')) {
    readiness.overallStatus = 'CRITICAL';
  } else {
    readiness.overallStatus = 'WAITING';
  }
  
  return readiness;
}

/**
 * Quick lineup status check (lightweight, no full scan)
 */
function getQuickStatus() {
  return {
    running: isRunning,
    gameDay,
    lastScan: lastScanResult ? {
      time: lastScanResult.scanTime,
      games: lastScanResult.gamesFound,
      confirmed: lastScanResult.lineupsConfirmed,
      pending: lastScanResult.lineupsPending,
      alerts: lastScanResult.alerts?.length || 0,
    } : null,
    scanCount: scanHistory.length,
    rebuilds: predictionRebuilds.length,
    snapshots: Object.keys(lineupSnapshots).length,
  };
}

/**
 * Get detailed scan history
 */
function getHistory(limit = 20) {
  return {
    history: scanHistory.slice(-limit),
    rebuilds: predictionRebuilds.slice(-limit),
  };
}

// ==================== PERSISTENCE ====================

function saveState() {
  try {
    const state = {
      lastScan: lastScanResult?.scanTime,
      snapshots: lineupSnapshots,
      scanCount: scanHistory.length,
      rebuilds: predictionRebuilds.slice(-20),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { /* non-critical */ }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (state.snapshots) lineupSnapshots = state.snapshots;
      if (state.rebuilds) predictionRebuilds = state.rebuilds;
      return state;
    }
  } catch (e) { /* start fresh */ }
  return null;
}

// Load persisted state on module init
loadState();

module.exports = {
  init,
  start,
  stop,
  scan,
  getGamedayReadiness,
  getQuickStatus,
  getHistory,
  loadState,
  saveState,
};
