/**
 * Game Day Auto-Orchestrator — SportsSim v101.0
 * ===============================================
 * 🚨 THIS IS THE MONEY MACHINE ON GAME DAY
 * 
 * Automatically orchestrates all game-day services for MLB Opening Day
 * and regular season game days. Detects when games are happening today
 * and spins up the full pipeline:
 * 
 *   1. Lineup Monitor — polls for confirmed lineups every 5 min
 *   2. Weather Refresh — pulls fresh forecasts for today's venues
 *   3. Playbook Cache Rebuild — re-generates predictions when lineups drop
 *   4. Odds Refresh — tracks line movements close to game time
 *   5. Alert System — flags games where lineup changes create new +EV
 * 
 * OD Flow:
 *   Boot → detect games today → start all services → monitor until last pitch
 *   
 * Regular Season Flow:
 *   Boot → check ESPN for today's MLB schedule → start if games found
 * 
 * Auto-starts on server init. Zero manual intervention needed.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ==================== CONFIG ====================

const OD_DAY1_DATE = '2026-03-26';
const OD_DAY2_DATE = '2026-03-27';

const STATE_FILE = path.join(__dirname, 'gameday-orchestrator-state.json');
const CHECK_INTERVAL = 15 * 60 * 1000; // Check every 15 min
const LINEUP_POLL_INTERVAL = 5 * 60 * 1000; // Poll lineups every 5 min
const WEATHER_REFRESH_INTERVAL = 60 * 60 * 1000; // Refresh weather hourly
const PLAYBOOK_REBUILD_COOLDOWN = 10 * 60 * 1000; // Don't rebuild more than every 10 min
const PRE_GAME_HOURS = 6; // Start monitoring 6 hours before first pitch

// ==================== STATE ====================

let state = {
  isRunning: false,
  isGameDay: false,
  todayDate: null,
  gamesFound: 0,
  lineupsConfirmed: 0,
  lastLineupScan: null,
  lastWeatherRefresh: null,
  lastPlaybookRebuild: null,
  lineupDrops: [], // Track when each game's lineup was confirmed
  errors: [],
  startedAt: null,
  phase: 'idle', // idle, monitoring, pre-game, live, post-game
};

let lineupPollTimer = null;
let weatherRefreshTimer = null;
let mainCheckTimer = null;

// Dependencies (injected on init)
let deps = {
  lineupFetcher: null,
  lineupMonitor: null,
  weatherForecast: null,
  odPlaybookCache: null,
  odModel: null,
  autoScanner: null,
};

// ==================== CORE ====================

function init(injectedDeps) {
  if (injectedDeps) {
    Object.assign(deps, injectedDeps);
  }
  
  // Try to load dependencies if not injected
  if (!deps.lineupFetcher) {
    try { deps.lineupFetcher = require('./lineup-fetcher'); } catch (e) {}
  }
  if (!deps.lineupMonitor) {
    try { deps.lineupMonitor = require('./lineup-monitor'); } catch (e) {}
  }
  if (!deps.weatherForecast) {
    try { deps.weatherForecast = require('./weather-forecast'); } catch (e) {}
  }
  if (!deps.odPlaybookCache) {
    try { deps.odPlaybookCache = require('./od-playbook-cache'); } catch (e) {}
  }
  if (!deps.odModel) {
    try { deps.odModel = require('../models/mlb-opening-day'); } catch (e) {}
  }
  
  console.log('[GameDay] Orchestrator initialized');
  loadState();
  
  // Auto-check on startup
  checkGameDay().catch(e => console.error('[GameDay] Startup check error:', e.message));
  
  // Set up periodic check
  mainCheckTimer = setInterval(() => {
    checkGameDay().catch(e => console.error('[GameDay] Check error:', e.message));
  }, CHECK_INTERVAL);
  
  return getStatus();
}

/**
 * Main game day detection and orchestration
 */
async function checkGameDay() {
  const today = new Date().toISOString().split('T')[0];
  const nowHour = new Date().getUTCHours();
  
  // Is it Opening Day?
  const isOD1 = today === OD_DAY1_DATE;
  const isOD2 = today === OD_DAY2_DATE;
  const isOD = isOD1 || isOD2;
  
  // Check for regular season games if not OD
  let hasGamesToday = isOD;
  let gamesCount = 0;
  let firstGameUTC = null;
  
  if (isOD) {
    gamesCount = isOD1 ? 11 : 9;
    firstGameUTC = isOD1 ? 17 : 17; // OD games typically start ~1pm ET = 17:00 UTC
  } else {
    // Check ESPN for today's MLB games
    try {
      const espnData = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${today.replace(/-/g, '')}`);
      if (espnData && espnData.events && espnData.events.length > 0) {
        // Filter to actual regular season / postseason games (not spring training after March 25)
        const regularGames = espnData.events.filter(e => {
          const seasonType = e.season?.type;
          return seasonType === 2 || seasonType === 3 || new Date(today) >= new Date('2026-03-26');
        });
        gamesCount = regularGames.length;
        hasGamesToday = gamesCount > 0;
        
        if (hasGamesToday && regularGames.length > 0) {
          const gameTimes = regularGames.map(e => new Date(e.date).getUTCHours());
          firstGameUTC = Math.min(...gameTimes);
        }
      }
    } catch (e) {
      // If ESPN fails, don't crash — just skip regular season check
      console.error('[GameDay] ESPN check failed:', e.message);
    }
  }
  
  state.todayDate = today;
  state.gamesFound = gamesCount;
  state.isGameDay = hasGamesToday;
  
  if (!hasGamesToday) {
    state.phase = 'idle';
    if (state.isRunning) {
      stopAll();
    }
    saveState();
    return;
  }
  
  // Determine phase based on time
  const hoursToFirstPitch = firstGameUTC ? (firstGameUTC - nowHour) : 12;
  
  if (hoursToFirstPitch > PRE_GAME_HOURS) {
    state.phase = 'monitoring';
    // Just check periodically, don't start heavy polling yet
    if (!state.isRunning) {
      console.log(`[GameDay] 🎯 GAME DAY detected! ${gamesCount} games today (${isOD ? 'OPENING DAY' : 'regular season'}). First pitch in ~${hoursToFirstPitch}h. Phase: monitoring`);
      state.isRunning = true;
      state.startedAt = new Date().toISOString();
    }
  } else if (hoursToFirstPitch > 0) {
    state.phase = 'pre-game';
    if (!lineupPollTimer) {
      startPreGamePolling();
    }
  } else {
    state.phase = 'live';
    if (!lineupPollTimer) {
      startPreGamePolling();
    }
  }
  
  saveState();
}

/**
 * Start pre-game polling: lineup checks, weather refresh, playbook rebuilds
 */
function startPreGamePolling() {
  console.log('[GameDay] 🔥 Starting pre-game polling — lineups every 5min, weather hourly');
  
  // Lineup polling
  if (!lineupPollTimer) {
    pollLineups().catch(e => console.error('[GameDay] Lineup poll error:', e.message));
    lineupPollTimer = setInterval(() => {
      pollLineups().catch(e => console.error('[GameDay] Lineup poll error:', e.message));
    }, LINEUP_POLL_INTERVAL);
  }
  
  // Weather refresh
  if (!weatherRefreshTimer) {
    refreshWeather().catch(e => console.error('[GameDay] Weather refresh error:', e.message));
    weatherRefreshTimer = setInterval(() => {
      refreshWeather().catch(e => console.error('[GameDay] Weather refresh error:', e.message));
    }, WEATHER_REFRESH_INTERVAL);
  }
}

/**
 * Poll for lineups and detect changes
 */
async function pollLineups() {
  if (!deps.lineupFetcher) return;
  
  const now = new Date();
  state.lastLineupScan = now.toISOString();
  
  try {
    const lineups = await deps.lineupFetcher.fetchLineups();
    if (!lineups || !lineups.games) return;
    
    const prevConfirmed = state.lineupsConfirmed;
    const confirmedGames = lineups.games.filter(g => g.hasConfirmedLineup);
    state.lineupsConfirmed = confirmedGames.length;
    
    // Detect new lineup drops
    if (confirmedGames.length > prevConfirmed) {
      const newDrops = confirmedGames.length - prevConfirmed;
      console.log(`[GameDay] 📋 ${newDrops} NEW LINEUP(S) DROPPED! Total: ${confirmedGames.length}/${lineups.games.length}`);
      
      // Record which games got lineups
      for (const game of confirmedGames) {
        const key = `${game.awayTeam}@${game.homeTeam}`;
        if (!state.lineupDrops.find(d => d.game === key)) {
          state.lineupDrops.push({
            game: key,
            droppedAt: now.toISOString(),
            awayStars: game.awayLineup?.starsInLineup || 0,
            homeStars: game.homeLineup?.starsInLineup || 0,
          });
        }
      }
      
      // Trigger playbook rebuild when new lineups appear
      await triggerPlaybookRebuild('lineup_drop');
    }
    
    // Log status
    const missing = lineups.games.filter(g => !g.hasConfirmedLineup);
    if (missing.length > 0 && state.phase === 'pre-game') {
      const missingGames = missing.map(g => `${g.awayTeam}@${g.homeTeam}`).join(', ');
      console.log(`[GameDay] ⏳ Waiting for ${missing.length} lineup(s): ${missingGames}`);
    }
    
    if (confirmedGames.length === lineups.games.length && lineups.games.length > 0) {
      console.log(`[GameDay] ✅ ALL ${lineups.games.length} LINEUPS CONFIRMED! Full signal stack active.`);
    }
    
  } catch (e) {
    state.errors.push({ time: now.toISOString(), error: `Lineup poll: ${e.message}` });
    if (state.errors.length > 50) state.errors = state.errors.slice(-25);
  }
  
  saveState();
}

/**
 * Refresh weather data for today's games
 */
async function refreshWeather() {
  if (!deps.weatherForecast) return;
  
  state.lastWeatherRefresh = new Date().toISOString();
  
  try {
    if (typeof deps.weatherForecast.refreshAll === 'function') {
      await deps.weatherForecast.refreshAll();
      console.log('[GameDay] 🌤️ Weather data refreshed');
    }
  } catch (e) {
    state.errors.push({ time: new Date().toISOString(), error: `Weather: ${e.message}` });
  }
}

/**
 * Trigger playbook cache rebuild (rate-limited)
 */
async function triggerPlaybookRebuild(reason) {
  if (!deps.odPlaybookCache) return;
  
  const now = Date.now();
  const lastRebuild = state.lastPlaybookRebuild ? new Date(state.lastPlaybookRebuild).getTime() : 0;
  
  if (now - lastRebuild < PLAYBOOK_REBUILD_COOLDOWN) {
    console.log(`[GameDay] Playbook rebuild skipped (cooldown). Last: ${Math.round((now - lastRebuild) / 1000)}s ago`);
    return;
  }
  
  state.lastPlaybookRebuild = new Date().toISOString();
  
  try {
    console.log(`[GameDay] 📊 Rebuilding OD Playbook (reason: ${reason})...`);
    if (typeof deps.odPlaybookCache.ensureFresh === 'function') {
      await deps.odPlaybookCache.ensureFresh();
      console.log('[GameDay] ✅ Playbook cache rebuilt with fresh data');
    }
  } catch (e) {
    console.error(`[GameDay] Playbook rebuild error: ${e.message}`);
    state.errors.push({ time: new Date().toISOString(), error: `Playbook: ${e.message}` });
  }
}

// ==================== STOP ====================

function stopAll() {
  if (lineupPollTimer) {
    clearInterval(lineupPollTimer);
    lineupPollTimer = null;
  }
  if (weatherRefreshTimer) {
    clearInterval(weatherRefreshTimer);
    weatherRefreshTimer = null;
  }
  state.isRunning = false;
  state.phase = 'idle';
  console.log('[GameDay] All services stopped');
  saveState();
}

function shutdown() {
  if (mainCheckTimer) {
    clearInterval(mainCheckTimer);
    mainCheckTimer = null;
  }
  stopAll();
}

// ==================== STATE ====================

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // Only restore state from today
      if (saved.todayDate === new Date().toISOString().split('T')[0]) {
        Object.assign(state, saved);
      }
    }
  } catch (e) { /* fresh state */ }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { /* non-critical */ }
}

// ==================== STATUS ====================

function getStatus() {
  const today = new Date().toISOString().split('T')[0];
  const isOD = today === OD_DAY1_DATE || today === OD_DAY2_DATE;
  const daysToOD = Math.max(0, Math.ceil((new Date(OD_DAY1_DATE) - new Date()) / (1000 * 60 * 60 * 24)));
  
  return {
    orchestrator: 'active',
    phase: state.phase,
    isGameDay: state.isGameDay,
    isOpeningDay: isOD,
    daysToOpeningDay: daysToOD,
    today: today,
    games: state.gamesFound,
    lineupsConfirmed: state.lineupsConfirmed,
    lineupDrops: state.lineupDrops.length,
    lastLineupScan: state.lastLineupScan,
    lastWeatherRefresh: state.lastWeatherRefresh,
    lastPlaybookRebuild: state.lastPlaybookRebuild,
    isRunning: state.isRunning,
    startedAt: state.startedAt,
    recentErrors: state.errors.slice(-5),
    services: {
      lineupFetcher: !!deps.lineupFetcher,
      lineupMonitor: !!deps.lineupMonitor,
      weatherForecast: !!deps.weatherForecast,
      odPlaybookCache: !!deps.odPlaybookCache,
      odModel: !!deps.odModel,
    },
  };
}

/**
 * Get detailed game-day war room data
 */
async function getWarRoom() {
  const status = getStatus();
  
  // Get current lineups
  let lineupStatus = { games: [], confirmed: 0, total: 0 };
  if (deps.lineupFetcher) {
    try {
      const lineups = await deps.lineupFetcher.fetchLineups();
      if (lineups && lineups.games) {
        lineupStatus = {
          confirmed: lineups.games.filter(g => g.hasConfirmedLineup).length,
          total: lineups.games.length,
          games: lineups.games.map(g => ({
            matchup: `${g.awayTeam}@${g.homeTeam}`,
            hasLineup: g.hasConfirmedLineup,
            awayPitcher: g.awayPitcher?.name || 'TBD',
            homePitcher: g.homePitcher?.name || 'TBD',
            awayStars: g.awayLineup?.starsInLineup || 0,
            homeStars: g.homeLineup?.starsInLineup || 0,
            gameTime: g.gameTime,
          })),
        };
      }
    } catch (e) { /* skip */ }
  }
  
  // Get weather summary
  let weatherStatus = { available: false };
  if (deps.weatherForecast) {
    try {
      if (typeof deps.weatherForecast.getStatus === 'function') {
        weatherStatus = deps.weatherForecast.getStatus();
        weatherStatus.available = true;
      }
    } catch (e) { /* skip */ }
  }
  
  return {
    ...status,
    lineups: lineupStatus,
    weather: weatherStatus,
    timeline: buildTimeline(),
    actionItems: getActionItems(),
  };
}

/**
 * Build a timeline of events for the war room
 */
function buildTimeline() {
  const events = [];
  
  if (state.startedAt) {
    events.push({ time: state.startedAt, event: 'Orchestrator started' });
  }
  
  for (const drop of state.lineupDrops) {
    events.push({ time: drop.droppedAt, event: `Lineup confirmed: ${drop.game}` });
  }
  
  if (state.lastPlaybookRebuild) {
    events.push({ time: state.lastPlaybookRebuild, event: 'Playbook cache rebuilt' });
  }
  
  return events.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 20);
}

/**
 * Get current action items for the war room
 */
function getActionItems() {
  const items = [];
  const today = new Date().toISOString().split('T')[0];
  const daysToOD = Math.ceil((new Date(OD_DAY1_DATE) - new Date()) / (1000 * 60 * 60 * 24));
  
  if (daysToOD > 0 && daysToOD <= 3) {
    items.push({
      priority: 'HIGH',
      action: `Opening Day in ${daysToOD} day(s) — verify all systems operational`,
      status: 'pending',
    });
  }
  
  if (state.isGameDay && state.lineupsConfirmed < state.gamesFound) {
    items.push({
      priority: 'HIGH',
      action: `${state.gamesFound - state.lineupsConfirmed} game(s) still missing lineups — monitoring...`,
      status: 'in_progress',
    });
  }
  
  if (state.isGameDay && state.lineupsConfirmed === state.gamesFound && state.gamesFound > 0) {
    items.push({
      priority: 'LOW',
      action: 'All lineups confirmed ✅ — predictions using full signal stack',
      status: 'complete',
    });
  }
  
  if (!state.lastWeatherRefresh && state.isGameDay) {
    items.push({
      priority: 'MEDIUM',
      action: 'Weather data not yet refreshed for today\'s games',
      status: 'pending',
    });
  }
  
  return items;
}

// ==================== HELPERS ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ==================== EXPORTS ====================

module.exports = {
  init,
  checkGameDay,
  startPreGamePolling,
  stopAll,
  shutdown,
  getStatus,
  getWarRoom,
  pollLineups,
  refreshWeather,
  triggerPlaybookRebuild,
};
