// services/regular-season-autopilot.js — Regular Season Autopilot v86.0
// ======================================================================
// THE DAILY MONEY PRINTER: Automated game-day orchestration for the full 162-game season.
//
// Generalizes the Opening Day autopilot for EVERY game day:
//   1. Auto-detects today's MLB slate from ESPN schedule
//   2. Monitors lineup drops every 5 min (pre-game window)
//   3. Refreshes live odds every 3 min (pre-game → first pitch)
//   4. Re-runs predictions when new data lands (lineups, odds, weather)
//   5. Compares fresh predictions to live odds → generates value alerts
//   6. Tracks edge decay (pick moved from +5% → +2% = value dying)
//   7. Alerts on CRITICAL changes: lineup swap, weather change, pitcher scratch
//   8. Rebuilds betting card in real-time with best available data
//   9. Grades bets as games complete (W/L/P + CLV tracking)
//  10. Season-phase-aware adjustments (opening week, summer, September, postseason)
//
// REPLACES the OD-specific gameday-autopilot.js for regular season play.

const fs = require('fs');
const path = require('path');
const https = require('https');

// ==================== DEPENDENCIES ====================
let mlbModel = null;
let mlbSchedule = null;
let lineupFetcher = null;
let weatherService = null;
let umpireService = null;
let dailyMlbCard = null;
let pitcherResolver = null;
let betTracker = null;
let lineShoppingService = null;
let lineupBridge = null;
let mlbStatsLineups = null;
let autoGrader = null;

try { mlbModel = require('../models/mlb'); } catch(e) {}
try { mlbSchedule = require('./mlb-schedule'); } catch(e) {}
try { lineupFetcher = require('./lineup-fetcher'); } catch(e) {}
try { lineupBridge = require('./lineup-bridge'); } catch(e) {}
try { mlbStatsLineups = require('./mlb-stats-lineups'); } catch(e) {}
try { weatherService = require('./weather'); } catch(e) {}
try { umpireService = require('./umpire-tendencies'); } catch(e) {}
try { dailyMlbCard = require('./daily-mlb-card'); } catch(e) {}
try { pitcherResolver = require('./pitcher-resolver'); } catch(e) {}
try { betTracker = require('./bet-tracker'); } catch(e) {}
try { lineShoppingService = require('./line-shopping'); } catch(e) {}
try { autoGrader = require('./auto-grade-pipeline'); } catch(e) {}

// ==================== STATE ====================
const STATE_DIR = path.join(__dirname, 'autopilot-state');
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

let state = {
  isRunning: false,
  mode: 'idle', // idle | pre-game | active | post-game | off-day
  gameDate: null,
  startedAt: null,
  lastScheduleFetch: null,
  lastLineupScan: null,
  lastOddsScan: null,
  lastWeatherScan: null,
  lastCardRebuild: null,
  scanCounts: { schedule: 0, lineups: 0, odds: 0, weather: 0, rebuilds: 0, grades: 0 },
  games: {},       // gameKey → game state
  alerts: [],      // chronological alert feed (max 200)
  bettingCard: null,
  edgeHistory: {}, // gameKey → [{timestamp, edges}] for edge decay tracking
  intervals: {},
  dailyStats: {    // reset each new game day
    gamesDetected: 0,
    lineupsConfirmed: 0,
    pitcherScratches: 0,
    oddsUpdates: 0,
    cardRebuilds: 0,
    betsRecorded: 0,
    betsGraded: 0,
    alertsGenerated: 0,
  },
};

// ==================== CONFIGURATION ====================
const CONFIG = {
  // Scan intervals (milliseconds)
  SCHEDULE_CHECK_INTERVAL: 30 * 60 * 1000,    // 30 min — check for schedule changes
  LINEUP_SCAN_INTERVAL: 5 * 60 * 1000,         // 5 min — check for lineup drops
  ODDS_SCAN_INTERVAL: 3 * 60 * 1000,           // 3 min — refresh live odds
  WEATHER_SCAN_INTERVAL: 15 * 60 * 1000,       // 15 min — weather updates
  CARD_REBUILD_INTERVAL: 10 * 60 * 1000,       // 10 min — full card rebuild
  GRADING_INTERVAL: 30 * 60 * 1000,            // 30 min — grade completed games
  
  // Pre-game window (hours before first pitch to start monitoring)
  PRE_GAME_HOURS: 6,
  
  // Post-game monitoring (hours after last game start)
  POST_GAME_HOURS: 5,
  
  // Alert thresholds
  VALUE_ALERT_EDGE: 3.0,          // Min edge % to include
  EDGE_DECAY_ALERT: 2.0,          // Alert when edge drops by this %
  NEW_VALUE_ALERT: 4.0,           // Alert on newly discovered edge > this %
  PITCHER_SCRATCH_ALERT: true,
  LINEUP_CHANGE_ALERT: true,
  WEATHER_CHANGE_ALERT: 0.03,     // Alert when weather multiplier shifts > 3%
  
  // Active hours (UTC) — MLB games span ~17:00-05:00 UTC
  ACTIVE_HOURS_START: 14,   // 10am ET — early scans
  ACTIVE_HOURS_END: 6,      // 2am ET — late games ending
  
  // Limits
  MAX_ALERTS: 200,
  MAX_EDGE_HISTORY: 50,     // per game
  
  // Auto-start on boot — disabled pre-season, enable on March 26
  AUTO_START: false,
};

// ==================== HELPERS ====================
function fetchJSON(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

function mlToProb(ml) {
  if (!ml || ml === 0) return 0.5;
  return ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
}

function isActiveHours() {
  const hour = new Date().getUTCHours();
  if (CONFIG.ACTIVE_HOURS_START < CONFIG.ACTIVE_HOURS_END) {
    return hour >= CONFIG.ACTIVE_HOURS_START && hour < CONFIG.ACTIVE_HOURS_END;
  }
  // Wraps midnight (e.g., 14-6 = 2pm to 6am)
  return hour >= CONFIG.ACTIVE_HOURS_START || hour < CONFIG.ACTIVE_HOURS_END;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function addAlert(type, gameKey, message, severity = 'info') {
  const alert = {
    timestamp: new Date().toISOString(),
    type,
    game: gameKey || null,
    message,
    severity, // info | warning | critical
  };
  state.alerts.unshift(alert);
  if (state.alerts.length > CONFIG.MAX_ALERTS) {
    state.alerts = state.alerts.slice(0, CONFIG.MAX_ALERTS);
  }
  state.dailyStats.alertsGenerated++;
  
  if (severity === 'critical') {
    console.log(`[AutoPilot] 🚨 ${message}`);
  } else if (severity === 'warning') {
    console.log(`[AutoPilot] ⚠️ ${message}`);
  }
  
  return alert;
}

// ==================== CORE: INITIALIZE GAMES FROM SCHEDULE ====================
async function initializeGamesFromSchedule(date) {
  if (!mlbSchedule && !mlbStatsLineups) {
    console.log('[AutoPilot] ⚠️ No schedule service available');
    return 0;
  }
  
  try {
    let schedule = null;
    
    // Try ESPN schedule first
    if (mlbSchedule) {
      schedule = await mlbSchedule.getSchedule(date).catch(() => null);
    }
    
    // If ESPN returns no games, try MLB Stats API as fallback
    if ((!schedule || !schedule.games || schedule.games.length === 0) && mlbStatsLineups) {
      try {
        const mlbApiResult = await mlbStatsLineups.fetchSchedule(date);
        const mlbApiGames = mlbApiResult?.games || [];
        // Filter to regular season games only (gameType 'R'), exclude spring training ('S')
        const regularGames = mlbApiGames.filter(g => !g.gameType || g.gameType === 'R');
        if (regularGames.length > 0) {
          // Convert MLB Stats API format to our format
          schedule = {
            games: regularGames.map(g => ({
              awayTeam: { abbr: g.awayAbbr, name: g.awayTeamName || g.awayAbbr },
              homeTeam: { abbr: g.homeAbbr, name: g.homeTeamName || g.homeAbbr },
              date: g.gameDate,
              status: g.status || 'Scheduled',
              venue: { name: g.venue || '' },
              gamePk: g.gamePk,
            })),
          };
          console.log(`[AutoPilot] 📡 MLB Stats API found ${regularGames.length} regular season games for ${date} (ESPN had 0)`);
        }
      } catch (e) {
        console.log(`[AutoPilot] ⚠️ MLB Stats API fallback failed: ${e.message}`);
      }
    }
    
    if (!schedule || !schedule.games || schedule.games.length === 0) {
      state.mode = 'off-day';
      console.log(`[AutoPilot] 📅 No MLB games on ${date} — off-day mode`);
      return 0;
    }
    
    let newGames = 0;
    
    for (const game of schedule.games) {
      const away = game.awayTeam?.abbr;
      const home = game.homeTeam?.abbr;
      if (!away || !home) continue;
      
      const gameKey = `${away}@${home}`;
      
      // Skip if already initialized (preserve existing state)
      if (state.games[gameKey] && state.games[gameKey].initialized) continue;
      
      const gameTime = game.date ? new Date(game.date) : null;
      const status = game.status || 'STATUS_SCHEDULED';
      
      state.games[gameKey] = {
        initialized: true,
        away,
        home,
        awayName: game.awayTeam?.name || away,
        homeName: game.homeTeam?.name || home,
        gameTime: gameTime ? gameTime.toISOString() : null,
        gameTimeET: gameTime ? gameTime.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : 'TBD',
        venue: game.venue?.name || '',
        indoor: game.venue?.indoor || false,
        espnStatus: status,
        starters: {
          away: game.awayTeam?.probablePitcher?.name || null,
          home: game.homeTeam?.probablePitcher?.name || null,
          awayConfirmed: game.awayTeam?.confirmedPitcher || false,
          homeConfirmed: game.homeTeam?.confirmedPitcher || false,
        },
        espnOdds: game.odds || null,
        lineups: {
          away: null,
          home: null,
          confirmed: false,
          lastUpdate: null,
        },
        liveOdds: {
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
        status: mapESPNStatus(status),
      };
      
      newGames++;
    }
    
    state.dailyStats.gamesDetected = Object.keys(state.games).length;
    state.lastScheduleFetch = new Date().toISOString();
    state.scanCounts.schedule++;
    
    if (newGames > 0) {
      console.log(`[AutoPilot] 📅 Loaded ${newGames} new games for ${date} (total: ${Object.keys(state.games).length})`);
      addAlert('schedule_loaded', null, `Loaded ${newGames} games for ${date}`, 'info');
    }
    
    return Object.keys(state.games).length;
  } catch (e) {
    console.error('[AutoPilot] Schedule fetch error:', e.message);
    return 0;
  }
}

function mapESPNStatus(espnStatus) {
  if (!espnStatus) return 'scheduled';
  const s = espnStatus.toUpperCase();
  if (s.includes('SCHEDULED') || s.includes('PRE')) return 'scheduled';
  if (s.includes('PROGRESS') || s.includes('IN_PROGRESS') || s.includes('LIVE')) return 'in-progress';
  if (s.includes('FINAL') || s.includes('POST') || s.includes('COMPLETE')) return 'final';
  if (s.includes('POSTPONED') || s.includes('SUSPENDED')) return 'postponed';
  if (s.includes('DELAYED')) return 'delayed';
  return 'scheduled';
}

// ==================== SCAN ENGINES ====================

/**
 * Scan for lineup changes across all pre-game games
 */
async function scanLineups() {
  if (!lineupFetcher && !lineupBridge) return { scanned: 0, changes: 0 };
  state.scanCounts.lineups++;
  state.lastLineupScan = new Date().toISOString();
  
  let changes = 0;
  let scanned = 0;
  
  for (const [gameKey, game] of Object.entries(state.games)) {
    if (game.status !== 'scheduled') continue;
    scanned++;
    
    try {
      // Use lineup-bridge (multi-source: MLB Stats API → ESPN → defaults) if available
      let lineupData = null;
      let source = 'unknown';
      
      if (lineupBridge) {
        try {
          lineupData = await lineupBridge.getLineupAdjustments(game.away, game.home, state.gameDate);
          source = lineupData?._source || 'lineup-bridge';
        } catch (e) {
          // Fall back to plain lineup-fetcher
        }
      }
      
      if (!lineupData && lineupFetcher) {
        lineupData = await lineupFetcher.getLineupAdjustments(game.away, game.home, state.gameDate);
        source = 'espn-lineup-fetcher';
      }
      
      if (lineupData && lineupData.hasData) {
        const wasConfirmed = game.lineups.confirmed;
        const prevAwayJSON = JSON.stringify(game.lineups.away);
        const prevHomeJSON = JSON.stringify(game.lineups.home);
        
        game.lineups.away = lineupData.awayLineup || null;
        game.lineups.home = lineupData.homeLineup || null;
        game.lineups.confirmed = true;
        game.lineups.lastUpdate = new Date().toISOString();
        game.lineups.source = source;
        
        if (!wasConfirmed && game.lineups.confirmed) {
          changes++;
          state.dailyStats.lineupsConfirmed++;
          addAlert('lineup_confirmed', gameKey, `✅ Lineups confirmed for ${gameKey}`, 'info');
          
          // Check for pitcher scratches
          if (lineupData.awayPitcher && game.starters.away && 
              lineupData.awayPitcher !== game.starters.away) {
            state.dailyStats.pitcherScratches++;
            addAlert('pitcher_scratch', gameKey, 
              `🚨 PITCHER SCRATCH: ${game.away} → ${game.starters.away} OUT, ${lineupData.awayPitcher} IN`,
              'critical');
            game.starters.away = lineupData.awayPitcher;
          }
          if (lineupData.homePitcher && game.starters.home && 
              lineupData.homePitcher !== game.starters.home) {
            state.dailyStats.pitcherScratches++;
            addAlert('pitcher_scratch', gameKey,
              `🚨 PITCHER SCRATCH: ${game.home} → ${game.starters.home} OUT, ${lineupData.homePitcher} IN`,
              'critical');
            game.starters.home = lineupData.homePitcher;
          }
          
          // Re-predict with lineup data
          await updateGamePrediction(gameKey, game);
        } else if (wasConfirmed && 
                   (JSON.stringify(game.lineups.away) !== prevAwayJSON || 
                    JSON.stringify(game.lineups.home) !== prevHomeJSON)) {
          changes++;
          addAlert('lineup_update', gameKey, `📋 Lineup updated: ${gameKey}`, 'warning');
          await updateGamePrediction(gameKey, game);
        }
      }
    } catch (e) {
      // Silent per-game failure
    }
  }
  
  return { scanned, changes };
}

/**
 * Scan live odds from The Odds API
 */
async function scanOdds() {
  const oddsApiKey = process.env.ODDS_API_KEY;
  if (!oddsApiKey) return { scanned: 0, changes: 0 };
  
  state.scanCounts.odds++;
  state.lastOddsScan = new Date().toISOString();
  
  let changes = 0;
  
  try {
    const markets = 'h2h,spreads,totals';
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${oddsApiKey}&regions=us&oddsFormat=american&markets=${markets}`;
    const oddsData = await fetchJSON(url, 15000);
    
    if (!Array.isArray(oddsData)) return { scanned: 0, changes: 0 };
    
    for (const oddsGame of oddsData) {
      const away = resolveTeamAbbr(oddsGame.away_team);
      const home = resolveTeamAbbr(oddsGame.home_team);
      if (!away || !home) continue;
      
      const gameKey = `${away}@${home}`;
      const game = state.games[gameKey];
      if (!game || game.status !== 'scheduled') continue;
      
      // Parse best odds across books
      const parsed = parseBestOdds(oddsGame);
      if (!parsed) continue;
      
      // Detect significant line movement
      const prevML = game.liveOdds.ml.home;
      const prevTotal = game.liveOdds.total.line;
      
      game.liveOdds.ml = parsed.ml;
      game.liveOdds.total = parsed.total;
      game.liveOdds.spread = parsed.spread;
      game.liveOdds.lastUpdate = new Date().toISOString();
      
      // Track history
      game.liveOdds.history.push({
        timestamp: new Date().toISOString(),
        ml: { ...parsed.ml },
        total: { ...parsed.total },
      });
      if (game.liveOdds.history.length > 50) {
        game.liveOdds.history = game.liveOdds.history.slice(-50);
      }
      
      // Detect ML movement
      if (prevML !== null && parsed.ml.home !== null) {
        const mlMove = Math.abs(mlToProb(parsed.ml.home) - mlToProb(prevML));
        if (mlMove > 0.03) {
          changes++;
          state.dailyStats.oddsUpdates++;
          const direction = parsed.ml.home < prevML ? '→ MORE favored' : '→ LESS favored';
          addAlert('odds_movement', gameKey,
            `📈 ML moved: ${gameKey} home ${prevML}→${parsed.ml.home} ${direction}`,
            mlMove > 0.06 ? 'warning' : 'info');
        }
      }
      
      // Detect total movement
      if (prevTotal !== null && parsed.total.line !== null && prevTotal !== parsed.total.line) {
        changes++;
        state.dailyStats.oddsUpdates++;
        addAlert('total_movement', gameKey,
          `📊 Total moved: ${gameKey} ${prevTotal}→${parsed.total.line}`,
          Math.abs(parsed.total.line - prevTotal) >= 0.5 ? 'warning' : 'info');
      }
    }
    
    return { scanned: oddsData.length, changes };
  } catch (e) {
    console.error('[AutoPilot] Odds scan error:', e.message);
    return { scanned: 0, changes: 0, error: e.message };
  }
}

/**
 * Scan weather for outdoor parks
 */
async function scanWeather() {
  if (!weatherService) return { scanned: 0, changes: 0 };
  state.scanCounts.weather++;
  state.lastWeatherScan = new Date().toISOString();
  
  let changes = 0;
  let scanned = 0;
  
  for (const [gameKey, game] of Object.entries(state.games)) {
    if (game.status !== 'scheduled' || game.indoor) continue;
    scanned++;
    
    try {
      let weatherData = null;
      if (weatherService.getWeatherForGame) {
        weatherData = await weatherService.getWeatherForGame(game.home, state.gameDate);
      } else if (weatherService.getWeather) {
        weatherData = await weatherService.getWeather(game.home);
      }
      
      if (weatherData) {
        const prevMultiplier = game.weather.multiplier;
        game.weather.multiplier = weatherData.multiplier || weatherData.runMultiplier || null;
        game.weather.temp = weatherData.temp || weatherData.temperature || null;
        game.weather.wind = weatherData.windSpeed || weatherData.wind || null;
        game.weather.description = weatherData.description || weatherData.summary || null;
        game.weather.lastUpdate = new Date().toISOString();
        
        if (prevMultiplier !== null && game.weather.multiplier !== null) {
          const shift = Math.abs(game.weather.multiplier - prevMultiplier);
          if (shift > CONFIG.WEATHER_CHANGE_ALERT) {
            changes++;
            addAlert('weather_change', gameKey,
              `🌤️ Weather shift: ${gameKey} multiplier ${prevMultiplier.toFixed(3)}→${game.weather.multiplier.toFixed(3)} (${game.weather.temp}°F)`,
              shift > 0.05 ? 'warning' : 'info');
          }
        }
      }
    } catch (e) {
      // Silent per-game failure
    }
  }
  
  return { scanned, changes };
}

/**
 * Update prediction for a specific game
 */
async function updateGamePrediction(gameKey, game) {
  if (!mlbModel) return null;
  
  try {
    let pred;
    if (mlbModel.asyncPredict) {
      pred = await mlbModel.asyncPredict(game.away, game.home, { gameDate: state.gameDate });
    } else {
      pred = mlbModel.predict(game.away, game.home);
    }
    
    if (pred && !pred.error) {
      game.previousPrediction = game.prediction;
      game.prediction = {
        homeWinProb: pred.homeWinProb,
        awayWinProb: pred.awayWinProb || (1 - pred.homeWinProb),
        totalRuns: pred.totalRuns,
        homeExpRuns: pred.homeExpRuns,
        awayExpRuns: pred.awayExpRuns,
        spread: pred.spread,
        f5Total: pred.f5Total,
        signals: pred._asyncSignals || {},
        timestamp: new Date().toISOString(),
      };
      
      // Track edge history if we have odds
      if (game.liveOdds.ml.home !== null) {
        const impliedHome = mlToProb(game.liveOdds.ml.home);
        const modelHome = pred.homeWinProb > 1 ? pred.homeWinProb / 100 : pred.homeWinProb;
        const edge = +((modelHome - impliedHome) * 100).toFixed(1);
        
        if (!state.edgeHistory[gameKey]) state.edgeHistory[gameKey] = [];
        state.edgeHistory[gameKey].push({
          timestamp: new Date().toISOString(),
          mlEdge: edge,
          totalEdge: game.liveOdds.total.line && pred.totalRuns ? 
            +(pred.totalRuns - game.liveOdds.total.line).toFixed(1) : null,
        });
        
        // Cap history
        if (state.edgeHistory[gameKey].length > CONFIG.MAX_EDGE_HISTORY) {
          state.edgeHistory[gameKey] = state.edgeHistory[gameKey].slice(-CONFIG.MAX_EDGE_HISTORY);
        }
        
        // Edge decay detection
        const history = state.edgeHistory[gameKey];
        if (history.length >= 3) {
          const prevEdge = history[history.length - 3].mlEdge;
          const currEdge = history[history.length - 1].mlEdge;
          if (prevEdge > CONFIG.VALUE_ALERT_EDGE && currEdge < prevEdge - CONFIG.EDGE_DECAY_ALERT) {
            addAlert('edge_decay', gameKey,
              `📉 Edge decaying: ${gameKey} ML edge ${prevEdge}%→${currEdge}% — ACT NOW or fold`,
              'warning');
          }
        }
        
        // New value alert
        if (Math.abs(edge) > CONFIG.NEW_VALUE_ALERT && history.length <= 2) {
          const side = edge > 0 ? `${game.home} HOME` : `${game.away} AWAY`;
          addAlert('new_value', gameKey,
            `💰 NEW VALUE: ${gameKey} — ${side} ${Math.abs(edge).toFixed(1)}% edge`,
            'warning');
        }
      }
      
      return game.prediction;
    }
  } catch (e) {
    // Silent
  }
  return null;
}

/**
 * Rebuild the daily betting card with latest data
 */
async function rebuildBettingCard() {
  if (!dailyMlbCard) return null;
  
  state.scanCounts.rebuilds++;
  state.lastCardRebuild = new Date().toISOString();
  state.dailyStats.cardRebuilds++;
  
  try {
    const card = await dailyMlbCard.buildDailyCard({
      date: state.gameDate,
      forceRefresh: true,
      oddsApiKey: process.env.ODDS_API_KEY || '',
      bankroll: 1000,
      kellyFraction: 0.5,
    });
    
    state.bettingCard = {
      timestamp: new Date().toISOString(),
      games: card.headline?.gamesOnSlate || 0,
      totalBets: card.headline?.totalBets || 0,
      smashPlays: card.headline?.smashPlays || 0,
      strongPlays: card.headline?.strongPlays || 0,
      totalEV: card.headline?.totalEV || 0,
      roi: card.headline?.roi || 0,
      topPlay: card.headline?.bestPlay ? {
        game: card.headline.bestPlay.game,
        type: card.headline.bestPlay.type,
        side: card.headline.bestPlay.side,
        edge: card.headline.bestPlay.edge,
      } : null,
      betTypes: card.headline?.betTypes || {},
      signalCoverage: card.signals || {},
    };
    
    state.dailyStats.betsRecorded = card.recordedPicks || 0;
    
    console.log(`[AutoPilot] 🔄 Card rebuilt: ${card.headline?.totalBets || 0} bets, $${card.headline?.totalEV?.toFixed(2) || 0} EV`);
    
    return card;
  } catch (e) {
    console.error('[AutoPilot] Card rebuild error:', e.message);
    return null;
  }
}

/**
 * Grade completed games
 */
async function gradeCompletedGames() {
  if (!dailyMlbCard) return null;
  state.scanCounts.grades++;
  
  try {
    const result = await dailyMlbCard.gradeCompletedGames(state.gameDate);
    if (result && result.graded) {
      state.dailyStats.betsGraded += result.graded;
      addAlert('grading', null, `📊 Graded ${result.graded} bets — ${result.wins || 0}W ${result.losses || 0}L`, 'info');
    }
    return result;
  } catch (e) {
    return null;
  }
}

/**
 * Update game statuses from ESPN (detect in-progress / final)
 */
async function updateGameStatuses() {
  if (!mlbSchedule) return;
  
  try {
    const schedule = await mlbSchedule.getSchedule(state.gameDate);
    if (!schedule || !schedule.games) return;
    
    for (const espnGame of schedule.games) {
      const away = espnGame.awayTeam?.abbr;
      const home = espnGame.homeTeam?.abbr;
      if (!away || !home) continue;
      
      const gameKey = `${away}@${home}`;
      const game = state.games[gameKey];
      if (!game) continue;
      
      const newStatus = mapESPNStatus(espnGame.status);
      
      if (game.status !== newStatus) {
        const prevStatus = game.status;
        game.status = newStatus;
        game.espnStatus = espnGame.status;
        
        if (newStatus === 'in-progress' && prevStatus === 'scheduled') {
          addAlert('game_started', gameKey, `⚾ ${gameKey} — FIRST PITCH`, 'info');
        }
        if (newStatus === 'final') {
          // Get final score
          const awayScore = espnGame.awayTeam?.score;
          const homeScore = espnGame.homeTeam?.score;
          addAlert('game_final', gameKey, 
            `✅ ${gameKey} FINAL: ${away} ${awayScore ?? '?'} - ${home} ${homeScore ?? '?'}`,
            'info');
        }
        if (newStatus === 'postponed') {
          addAlert('game_postponed', gameKey, `🌧️ ${gameKey} POSTPONED`, 'critical');
        }
      }
      
      // Update starters if they changed
      if (espnGame.awayTeam?.probablePitcher?.name && !game.starters.awayConfirmed) {
        const newPitcher = espnGame.awayTeam.probablePitcher.name;
        if (game.starters.away && game.starters.away !== newPitcher) {
          addAlert('pitcher_update', gameKey, 
            `📋 ${game.away} starter: ${game.starters.away} → ${newPitcher}`,
            'warning');
        }
        game.starters.away = newPitcher;
        game.starters.awayConfirmed = true;
      }
      if (espnGame.homeTeam?.probablePitcher?.name && !game.starters.homeConfirmed) {
        const newPitcher = espnGame.homeTeam.probablePitcher.name;
        if (game.starters.home && game.starters.home !== newPitcher) {
          addAlert('pitcher_update', gameKey,
            `📋 ${game.home} starter: ${game.starters.home} → ${newPitcher}`,
            'warning');
        }
        game.starters.home = newPitcher;
        game.starters.homeConfirmed = true;
      }
    }
  } catch (e) {
    // Silent
  }
}

// ==================== ORCHESTRATION ====================

/**
 * Run a full scan cycle — all engines
 */
async function runFullScan() {
  const start = Date.now();
  
  // 1. Update schedule & game statuses
  await initializeGamesFromSchedule(state.gameDate);
  await updateGameStatuses();
  
  // 2. Scan lineups (pre-game only)
  const preGameGames = Object.values(state.games).filter(g => g.status === 'scheduled');
  if (preGameGames.length > 0) {
    await scanLineups();
    await scanOdds();
    await scanWeather();
  }
  
  // 3. Rebuild betting card
  await rebuildBettingCard();
  
  // 4. Grade completed games
  const finalGames = Object.values(state.games).filter(g => g.status === 'final');
  if (finalGames.length > 0) {
    await gradeCompletedGames();
  }
  
  // 5. Update mode
  const scheduled = Object.values(state.games).filter(g => g.status === 'scheduled').length;
  const inProgress = Object.values(state.games).filter(g => g.status === 'in-progress').length;
  const final = Object.values(state.games).filter(g => g.status === 'final').length;
  const total = Object.keys(state.games).length;
  
  if (total === 0) {
    state.mode = 'off-day';
  } else if (inProgress > 0) {
    state.mode = 'active';
  } else if (scheduled > 0) {
    state.mode = 'pre-game';
  } else if (final === total) {
    state.mode = 'post-game';
  }
  
  const elapsed = Date.now() - start;
  console.log(`[AutoPilot] 🔄 Full scan: ${elapsed}ms — ${scheduled} scheduled, ${inProgress} live, ${final} final`);
  
  return {
    elapsed,
    mode: state.mode,
    games: { scheduled, inProgress, final, total },
  };
}

// ==================== PUBLIC API ====================

/**
 * Start the autopilot for today (or a specific date)
 */
function start(date, options = {}) {
  if (state.isRunning && state.gameDate === (date || getTodayDate())) {
    return { 
      status: 'already_running', 
      since: state.startedAt, 
      mode: state.mode,
      games: Object.keys(state.games).length,
    };
  }
  
  // If running for a different date, stop first
  if (state.isRunning) stop();
  
  const gameDate = date || getTodayDate();
  const config = { ...CONFIG, ...options };
  
  state.isRunning = true;
  state.mode = 'pre-game';
  state.gameDate = gameDate;
  state.startedAt = new Date().toISOString();
  state.scanCounts = { schedule: 0, lineups: 0, odds: 0, weather: 0, rebuilds: 0, grades: 0 };
  state.alerts = [];
  state.games = {};
  state.edgeHistory = {};
  state.bettingCard = null;
  state.dailyStats = {
    gamesDetected: 0, lineupsConfirmed: 0, pitcherScratches: 0,
    oddsUpdates: 0, cardRebuilds: 0, betsRecorded: 0, betsGraded: 0, alertsGenerated: 0,
  };
  
  console.log(`[AutoPilot] 🚀 REGULAR SEASON AUTOPILOT STARTED for ${gameDate}`);
  
  // Immediate full scan
  runFullScan().catch(e => console.error('[AutoPilot] Initial scan error:', e.message));
  
  // Set up periodic scans
  state.intervals.schedule = setInterval(() => {
    initializeGamesFromSchedule(gameDate)
      .then(() => updateGameStatuses())
      .catch(e => console.error('[AutoPilot] Schedule scan error:', e.message));
  }, config.SCHEDULE_CHECK_INTERVAL);
  
  state.intervals.lineup = setInterval(() => {
    if (isActiveHours()) {
      scanLineups().catch(e => {});
    }
  }, config.LINEUP_SCAN_INTERVAL);
  
  state.intervals.odds = setInterval(() => {
    if (isActiveHours()) {
      scanOdds().catch(e => {});
    }
  }, config.ODDS_SCAN_INTERVAL);
  
  state.intervals.weather = setInterval(() => {
    if (isActiveHours()) {
      scanWeather().catch(e => {});
    }
  }, config.WEATHER_SCAN_INTERVAL);
  
  state.intervals.rebuild = setInterval(() => {
    if (isActiveHours()) {
      rebuildBettingCard().catch(e => {});
    }
  }, config.CARD_REBUILD_INTERVAL);
  
  state.intervals.grading = setInterval(() => {
    gradeCompletedGames().catch(e => {});
  }, config.GRADING_INTERVAL);
  
  // Auto-transition to next day at 6am UTC
  state.intervals.dayRollover = setInterval(() => {
    const today = getTodayDate();
    if (state.gameDate !== today) {
      console.log(`[AutoPilot] 📅 Day rolled over: ${state.gameDate} → ${today}`);
      stop();
      // Auto-restart for new day after 5s
      setTimeout(() => start(today), 5000);
    }
  }, 10 * 60 * 1000); // Check every 10 min
  
  saveState();
  
  return {
    status: 'started',
    date: gameDate,
    mode: state.mode,
    scanIntervals: {
      schedule: `${config.SCHEDULE_CHECK_INTERVAL / 1000}s`,
      lineup: `${config.LINEUP_SCAN_INTERVAL / 1000}s`,
      odds: `${config.ODDS_SCAN_INTERVAL / 1000}s`,
      weather: `${config.WEATHER_SCAN_INTERVAL / 1000}s`,
      rebuild: `${config.CARD_REBUILD_INTERVAL / 1000}s`,
      grading: `${config.GRADING_INTERVAL / 1000}s`,
    },
  };
}

/**
 * Stop the autopilot
 */
function stop() {
  if (!state.isRunning) return { status: 'not_running' };
  
  for (const [key, interval] of Object.entries(state.intervals)) {
    clearInterval(interval);
  }
  state.intervals = {};
  state.isRunning = false;
  state.mode = 'idle';
  
  console.log('[AutoPilot] ⏹️ Regular season autopilot STOPPED');
  saveState();
  
  return { 
    status: 'stopped', 
    date: state.gameDate,
    alerts: state.alerts.length, 
    scans: state.scanCounts,
    stats: state.dailyStats,
  };
}

/**
 * Get current status
 */
function getStatus() {
  const gameCount = Object.keys(state.games).length;
  const scheduled = Object.values(state.games).filter(g => g.status === 'scheduled').length;
  const inProgress = Object.values(state.games).filter(g => g.status === 'in-progress').length;
  const final = Object.values(state.games).filter(g => g.status === 'final').length;
  const postponed = Object.values(state.games).filter(g => g.status === 'postponed').length;
  const lineupsConfirmed = Object.values(state.games).filter(g => g.lineups.confirmed).length;
  const withOdds = Object.values(state.games).filter(g => g.liveOdds.ml.home !== null).length;
  const withWeather = Object.values(state.games).filter(g => g.weather.multiplier !== null).length;
  const withPrediction = Object.values(state.games).filter(g => g.prediction !== null).length;
  
  return {
    service: 'regular-season-autopilot',
    version: '86.0.0',
    isRunning: state.isRunning,
    mode: state.mode,
    gameDate: state.gameDate,
    startedAt: state.startedAt,
    uptime: state.startedAt ? Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000) + 's' : null,
    
    games: {
      total: gameCount,
      scheduled,
      inProgress,
      final,
      postponed,
    },
    
    coverage: {
      lineupsConfirmed,
      withOdds,
      withWeather,
      withPrediction,
    },
    
    lastScans: {
      schedule: state.lastScheduleFetch,
      lineups: state.lastLineupScan,
      odds: state.lastOddsScan,
      weather: state.lastWeatherScan,
      cardRebuild: state.lastCardRebuild,
    },
    
    scanCounts: state.scanCounts,
    dailyStats: state.dailyStats,
    
    bettingCard: state.bettingCard,
    
    recentAlerts: state.alerts.slice(0, 20),
    totalAlerts: state.alerts.length,
  };
}

/**
 * Get detailed game state
 */
function getGameDetail(gameKey) {
  const game = state.games[gameKey];
  if (!game) return null;
  
  return {
    ...game,
    edgeHistory: state.edgeHistory[gameKey] || [],
    oddsHistory: game.liveOdds.history.slice(-20),
  };
}

/**
 * Get all games summary
 */
function getGamesSummary() {
  const games = [];
  for (const [key, game] of Object.entries(state.games)) {
    games.push({
      gameKey: key,
      away: game.away,
      home: game.home,
      gameTime: game.gameTimeET,
      venue: game.venue,
      status: game.status,
      starters: game.starters,
      lineupsConfirmed: game.lineups.confirmed,
      hasOdds: game.liveOdds.ml.home !== null,
      hasWeather: game.weather.multiplier !== null,
      hasPrediction: game.prediction !== null,
      prediction: game.prediction ? {
        homeWinProb: game.prediction.homeWinProb,
        totalRuns: game.prediction.totalRuns,
        spread: game.prediction.spread,
      } : null,
      liveOdds: game.liveOdds.ml.home !== null ? {
        homeML: game.liveOdds.ml.home,
        awayML: game.liveOdds.ml.away,
        total: game.liveOdds.total.line,
      } : null,
      weather: game.weather.temp ? {
        temp: game.weather.temp,
        multiplier: game.weather.multiplier,
      } : null,
      betsCount: game.plays.length,
    });
  }
  
  // Sort by game time
  games.sort((a, b) => {
    if (a.gameTime === 'TBD') return 1;
    if (b.gameTime === 'TBD') return -1;
    return String(a.gameTime).localeCompare(String(b.gameTime));
  });
  
  return games;
}

/**
 * Get all alerts
 */
function getAlerts(limit = 50) {
  return state.alerts.slice(0, limit);
}

/**
 * Force a full scan cycle now
 */
async function forceScan() {
  if (!state.isRunning) {
    return { error: 'Autopilot not running. Start it first.' };
  }
  const result = await runFullScan();
  return { status: 'scan_complete', ...result };
}

/**
 * Get edge tracking for a game
 */
function getEdgeHistory(gameKey) {
  return state.edgeHistory[gameKey] || [];
}

// ==================== TEAM NAME RESOLUTION ====================
const TEAM_ABBREVS = {
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
  'Diamondbacks': 'ARI', 'Braves': 'ATL', 'Orioles': 'BAL', 'Red Sox': 'BOS',
  'Cubs': 'CHC', 'White Sox': 'CWS', 'Reds': 'CIN', 'Guardians': 'CLE',
  'Rockies': 'COL', 'Tigers': 'DET', 'Astros': 'HOU', 'Royals': 'KC',
  'Angels': 'LAA', 'Dodgers': 'LAD', 'Marlins': 'MIA', 'Brewers': 'MIL',
  'Twins': 'MIN', 'Mets': 'NYM', 'Yankees': 'NYY', 'Athletics': 'OAK',
  'Phillies': 'PHI', 'Pirates': 'PIT', 'Padres': 'SD', 'Giants': 'SF',
  'Mariners': 'SEA', 'Cardinals': 'STL', 'Rays': 'TB', 'Rangers': 'TEX',
  'Blue Jays': 'TOR', 'Nationals': 'WSH',
};

function resolveTeamAbbr(name) {
  if (!name) return null;
  if (TEAM_ABBREVS[name]) return TEAM_ABBREVS[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(TEAM_ABBREVS)) {
    if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) return v;
  }
  return null;
}

// ==================== ODDS PARSING ====================
function parseBestOdds(oddsGame) {
  if (!oddsGame || !oddsGame.bookmakers) return null;
  
  const result = {
    ml: { away: null, home: null, awayBook: '', homeBook: '' },
    total: { line: null, over: null, under: null, book: '' },
    spread: { away: null, home: null, line: null, awayOdds: null, homeOdds: null, book: '' },
  };
  
  for (const bk of oddsGame.bookmakers) {
    for (const market of (bk.markets || [])) {
      if (market.key === 'h2h') {
        for (const o of market.outcomes || []) {
          if (o.name === oddsGame.home_team && (result.ml.home === null || o.price > result.ml.home)) {
            result.ml.home = o.price;
            result.ml.homeBook = bk.title;
          }
          if (o.name === oddsGame.away_team && (result.ml.away === null || o.price > result.ml.away)) {
            result.ml.away = o.price;
            result.ml.awayBook = bk.title;
          }
        }
      }
      if (market.key === 'totals') {
        for (const o of market.outcomes || []) {
          if (o.name === 'Over' && result.total.line === null) {
            result.total.line = o.point;
            result.total.over = o.price;
            result.total.book = bk.title;
          }
          if (o.name === 'Under') {
            result.total.under = o.price;
          }
        }
      }
      if (market.key === 'spreads') {
        for (const o of market.outcomes || []) {
          if (o.name === oddsGame.home_team && result.spread.line === null) {
            result.spread.line = o.point;
            result.spread.home = o.point;
            result.spread.homeOdds = o.price;
            result.spread.book = bk.title;
          }
          if (o.name === oddsGame.away_team) {
            result.spread.away = o.point;
            result.spread.awayOdds = o.price;
          }
        }
      }
    }
  }
  
  return result;
}

// ==================== PERSISTENCE ====================
function saveState() {
  try {
    const stateFile = path.join(STATE_DIR, `state-${state.gameDate || 'current'}.json`);
    const saveData = {
      ...state,
      intervals: undefined, // Don't serialize interval handles
    };
    fs.writeFileSync(stateFile, JSON.stringify(saveData, null, 2));
  } catch (e) { /* best effort */ }
}

function loadState(date) {
  try {
    const stateFile = path.join(STATE_DIR, `state-${date || 'current'}.json`);
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch (e) { /* ok */ }
  return null;
}

// ==================== AUTO-START ON MODULE LOAD ====================
// Auto-start for today if configured
if (CONFIG.AUTO_START) {
  // Delay auto-start to let server finish initializing
  setTimeout(() => {
    const today = getTodayDate();
    console.log(`[AutoPilot] 🔄 Auto-starting regular season autopilot for ${today}`);
    start(today);
  }, 30000); // 30s after module load
}

// ==================== EXPORTS ====================
// ==================== AUTO-BOOT: Start autopilot automatically on server boot ====================

/**
 * Check if MLB regular season games exist today via MLB Stats API.
 * If yes, auto-start the autopilot. If not, skip (spring training / off-day).
 * Also triggers grading of yesterday's completed games.
 * 
 * Call this ONCE during server startup (after data loads complete).
 */
async function autoBoot() {
  const today = getTodayDate();
  console.log(`[AutoPilot] 🔍 Auto-boot check for ${today}...`);
  
  try {
    // Check MLB Stats API for today's games (most reliable source)
    let hasGames = false;
    let gameCount = 0;
    
    if (mlbStatsLineups) {
      try {
        const scheduleResult = await mlbStatsLineups.fetchSchedule(today);
        const games = scheduleResult?.games || [];
        // Only count regular season games (gameType 'R'), not spring training ('S')
        const regularGames = games.filter(g => !g.gameType || g.gameType === 'R');
        if (regularGames.length > 0) {
          hasGames = true;
          gameCount = regularGames.length;
        }
      } catch (e) {
        console.log(`[AutoPilot] ⚠️ MLB Stats API check failed: ${e.message}`);
      }
    }
    
    // Fallback to ESPN
    if (!hasGames && mlbSchedule) {
      try {
        const schedule = await mlbSchedule.getSchedule(today);
        if (schedule && schedule.games && schedule.games.length > 0) {
          hasGames = true;
          gameCount = schedule.games.length;
        }
      } catch (e) {}
    }
    
    // Auto-grade yesterday's games before starting today
    await autoGradeYesterday().catch(e => 
      console.log(`[AutoPilot] ⚠️ Yesterday auto-grade failed: ${e.message}`)
    );
    
    if (hasGames) {
      console.log(`[AutoPilot] ✅ ${gameCount} MLB games found for ${today} — AUTO-STARTING autopilot`);
      start(today);
      return { started: true, date: today, games: gameCount };
    } else {
      console.log(`[AutoPilot] 📅 No MLB regular season games on ${today} — autopilot stays idle`);
      state.mode = 'off-day';
      return { started: false, date: today, reason: 'no_games' };
    }
  } catch (e) {
    console.error(`[AutoPilot] ❌ Auto-boot error: ${e.message}`);
    return { started: false, error: e.message };
  }
}

/**
 * Auto-grade yesterday's completed games.
 * Runs bet tracker grading for all bets from previous day.
 */
async function autoGradeYesterday() {
  if (!autoGrader) return { graded: 0, error: 'auto-grader not available' };
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().split('T')[0];
  
  console.log(`[AutoPilot] 📊 Auto-grading yesterday's games (${yDate})...`);
  
  try {
    if (autoGrader.runAutoGrade) {
      const result = await autoGrader.runAutoGrade(yDate);
      console.log(`[AutoPilot] ✅ Yesterday graded: ${JSON.stringify(result).substring(0, 200)}`);
      return result;
    } else if (autoGrader.gradeDate) {
      const result = await autoGrader.gradeDate(yDate);
      console.log(`[AutoPilot] ✅ Yesterday graded: ${JSON.stringify(result)}`);
      return result;
    } else {
      console.log('[AutoPilot] ⚠️ auto-grader has no gradeDate/runAutoGrade function');
      return { graded: 0, error: 'no_grade_function' };
    }
  } catch (e) {
    console.log(`[AutoPilot] ⚠️ Grade error: ${e.message}`);
    return { graded: 0, error: e.message };
  }
}

module.exports = {
  start,
  stop,
  getStatus,
  getGameDetail,
  getGamesSummary,
  getAlerts,
  forceScan,
  getEdgeHistory,
  runFullScan,
  scanLineups,
  scanOdds,
  scanWeather,
  rebuildBettingCard,
  gradeCompletedGames,
  autoBoot,
  autoGradeYesterday,
  TEAM_ABBREVS,
  CONFIG,
};
