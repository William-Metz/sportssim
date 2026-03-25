/**
 * Game Day D0 System — SportsSim v129.0
 * ========================================
 * THE WAR ROOM for opening night and beyond.
 * 
 * Combines:
 *   - Real-time MLB Stats API lineup verification (Task 090)
 *   - Live weather pull + game impact analysis (Task 088)  
 *   - System warm-up orchestration (Task 110)
 *   - Pre-game readiness checklist
 *   - Countdown-aware action items
 *   - Lineup drop monitoring + auto-rebuild triggers
 *
 * TONIGHT: NYY@SF 8:05 PM ET — Max Fried (LHP) vs Logan Webb (RHP) at Oracle Park
 * 
 * ENDPOINTS:
 *   GET /api/gameday/status           — Full system status + readiness check
 *   GET /api/gameday/weather          — Live weather for all today's games
 *   GET /api/gameday/lineups          — Real-time lineup verification
 *   GET /api/gameday/warmup           — Trigger full system warm-up
 *   GET /api/gameday/action-plan      — Time-aware action items
 *   GET /api/gameday/pre-game-brief   — Final pre-game brief with all signals
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ==================== SAFE IMPORTS ====================
let mlbModel, weatherService, lineupBridge, mlbStatsLineups;
let openerAnalysis, playBookCache, liveExecution, odOddsMonitor;
let platoonSplits, catcherFraming, bullpenQuality, nrfiModel;
let pitcherKProps, outsProps, f3Model, f5Model, f7Model;
let convictionEngine, stolenBaseModel;

try { mlbModel = require('../models/mlb'); } catch(e) {}
try { weatherService = require('./weather'); } catch(e) {}
try { lineupBridge = require('./lineup-bridge'); } catch(e) {}
try { mlbStatsLineups = require('./mlb-stats-lineups'); } catch(e) {}
try { openerAnalysis = require('./od-opener-analysis'); } catch(e) {}
try { playBookCache = require('./od-playbook-cache'); } catch(e) {}
try { liveExecution = require('./od-live-execution'); } catch(e) {}
try { odOddsMonitor = require('./od-odds-monitor'); } catch(e) {}
try { platoonSplits = require('./platoon-splits'); } catch(e) {}
try { catcherFraming = require('./catcher-framing'); } catch(e) {}
try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}
try { nrfiModel = require('./nrfi-model'); } catch(e) {}
try { pitcherKProps = require('./pitcher-k-props'); } catch(e) {}
try { outsProps = require('./pitcher-outs-props'); } catch(e) {}
try { f3Model = require('./f3-model'); } catch(e) {}
try { f7Model = require('./f7-model'); } catch(e) {}
try { stolenBaseModel = require('./stolen-base-model'); } catch(e) {}

// ==================== CONSTANTS ====================

const MLB_SCHEDULE_URL = 'https://statsapi.mlb.com/api/v1/schedule';
const GAME_FEED_URL = 'https://statsapi.mlb.com/api/v1.1/game';
const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';

// Venue coordinates for weather
const VENUE_COORDS = {
  'Oracle Park':          { lat: 37.7786, lon: -122.3893, outdoor: true, pf: 0.93 },
  'Yankee Stadium':       { lat: 40.8296, lon: -73.9262, outdoor: true, pf: 1.05 },
  'Citi Field':           { lat: 40.7571, lon: -73.8458, outdoor: true, pf: 0.95 },
  'American Family Field':{ lat: 43.0280, lon: -87.9712, outdoor: false, pf: 1.02 }, // retractable
  'Wrigley Field':        { lat: 41.9484, lon: -87.6553, outdoor: true, pf: 1.04 },
  'Oriole Park':          { lat: 39.2838, lon: -76.6216, outdoor: true, pf: 1.00 },
  'Great American Ball Park': { lat: 39.0975, lon: -84.5087, outdoor: true, pf: 1.08 },
  'Minute Maid Park':     { lat: 29.7573, lon: -95.3555, outdoor: false, pf: 1.02 },
  'Petco Park':           { lat: 32.7076, lon: -117.1570, outdoor: true, pf: 0.93 },
  'Busch Stadium':        { lat: 38.6226, lon: -90.1928, outdoor: true, pf: 0.97 },
  'Citizens Bank Park':   { lat: 39.9061, lon: -75.1665, outdoor: true, pf: 1.05 },
  'Dodger Stadium':       { lat: 34.0739, lon: -118.2400, outdoor: true, pf: 0.97 },
  'T-Mobile Park':        { lat: 47.5914, lon: -122.3326, outdoor: false, pf: 0.94 },
  'Globe Life Field':     { lat: 32.7512, lon: -97.0832, outdoor: false, pf: 1.01 },
  'Tropicana Field':      { lat: 27.7683, lon: -82.6534, outdoor: false, pf: 0.95 },
  'Comerica Park':        { lat: 42.3390, lon: -83.0485, outdoor: true, pf: 0.95 },
  'Fenway Park':          { lat: 42.3467, lon: -71.0972, outdoor: true, pf: 1.06 },
  'Truist Park':          { lat: 33.8908, lon: -84.4678, outdoor: true, pf: 1.01 },
  'Kauffman Stadium':     { lat: 39.0517, lon: -94.4803, outdoor: true, pf: 0.97 },
  'Target Field':         { lat: 44.9817, lon: -93.2778, outdoor: true, pf: 1.00 },
};

// MLB team ID → our abbreviation
const MLB_TEAM_MAP = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};

// ==================== HELPERS ====================

function fetchJSON(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/3.0' },
      timeout,
    }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function hoursUntil(isoTime) {
  return ((new Date(isoTime).getTime() - Date.now()) / 3600000).toFixed(1);
}

// ==================== MLB STATS API VERIFICATION ====================

/**
 * Verify the MLB Stats API returns today's games and check lineup status.
 * This is Task 090 — critical for game day.
 */
async function verifyLineupPipeline(dateStr = null) {
  const date = dateStr || todayStr();
  const result = {
    date,
    apiReachable: false,
    gamesFound: 0,
    games: [],
    lineupStatus: 'pending',
    pipelineReady: false,
    warnings: [],
    errors: [],
  };

  try {
    // Step 1: Fetch schedule
    const schedule = await fetchJSON(
      `${MLB_SCHEDULE_URL}?date=${date}&sportId=1&hydrate=probablePitcher,linescore`
    );
    result.apiReachable = true;
    
    const dates = schedule.dates || [];
    if (dates.length === 0) {
      result.warnings.push(`No games found for ${date}`);
      return result;
    }

    const games = dates[0].games || [];
    result.gamesFound = games.length;

    // Step 2: Check each game for lineup status
    let confirmedLineups = 0;
    let confirmedPitchers = 0;

    for (const game of games) {
      const awayId = game.teams?.away?.team?.id;
      const homeId = game.teams?.home?.team?.id;
      const awayAbbr = MLB_TEAM_MAP[awayId] || '??';
      const homeAbbr = MLB_TEAM_MAP[homeId] || '??';
      
      const gameInfo = {
        gamePk: game.gamePk,
        matchup: `${awayAbbr}@${homeAbbr}`,
        venue: game.venue?.name || '??',
        time: game.gameDate,
        status: game.status?.detailedState || '??',
        awayPitcher: 'TBD',
        homePitcher: 'TBD',
        awayLineupConfirmed: false,
        homeLineupConfirmed: false,
        awayBatters: 0,
        homeBatters: 0,
      };

      // Check probable pitchers from schedule
      // Note: probablePitchers may be in the game feed, not schedule
      
      // Check game feed for lineups + pitchers
      try {
        const feed = await fetchJSON(`${GAME_FEED_URL}/${game.gamePk}/feed/live`, 8000);
        const gd = feed.gameData || {};
        const pp = gd.probablePitchers || {};
        
        if (pp.away?.fullName) {
          gameInfo.awayPitcher = `${pp.away.fullName} (${pp.away.id})`;
          confirmedPitchers++;
        }
        if (pp.home?.fullName) {
          gameInfo.homePitcher = `${pp.home.fullName} (${pp.home.id})`;
          confirmedPitchers++;
        }

        // Check batting order
        const ld = feed.liveData || {};
        const bp = ld.boxscore?.teams || {};
        
        const awayBO = bp.away?.battingOrder || [];
        const homeBO = bp.home?.battingOrder || [];
        
        gameInfo.awayBatters = awayBO.length;
        gameInfo.homeBatters = homeBO.length;
        gameInfo.awayLineupConfirmed = awayBO.length >= 9;
        gameInfo.homeLineupConfirmed = homeBO.length >= 9;
        
        if (awayBO.length >= 9) confirmedLineups++;
        if (homeBO.length >= 9) confirmedLineups++;

        // Extract actual lineup names if confirmed
        if (awayBO.length >= 9) {
          const players = bp.away?.players || {};
          gameInfo.awayTopOrder = awayBO.slice(0, 3).map(id => {
            const p = players[`ID${id}`]?.person || {};
            return p.fullName || `ID${id}`;
          });
        }
        if (homeBO.length >= 9) {
          const players = bp.home?.players || {};
          gameInfo.homeTopOrder = homeBO.slice(0, 3).map(id => {
            const p = players[`ID${id}`]?.person || {};
            return p.fullName || `ID${id}`;
          });
        }
      } catch (feedErr) {
        gameInfo.feedError = feedErr.message;
      }

      result.games.push(gameInfo);
    }

    result.confirmedLineups = confirmedLineups;
    result.confirmedPitchers = confirmedPitchers;
    result.totalPossibleLineups = games.length * 2;
    result.totalPossiblePitchers = games.length * 2;
    
    // Lineup status assessment
    if (confirmedLineups === games.length * 2) {
      result.lineupStatus = 'ALL_CONFIRMED';
    } else if (confirmedLineups > 0) {
      result.lineupStatus = 'PARTIAL';
    } else {
      result.lineupStatus = 'NONE_YET';
    }

    // Pipeline readiness
    result.pipelineReady = result.apiReachable && result.gamesFound > 0;
    
    // Warnings
    if (confirmedLineups === 0 && hoursUntil(games[0].gameDate) < 3) {
      result.warnings.push('⚠️ Game < 3 hours away but no lineups confirmed — check lineup sources');
    }
    
    if (confirmedPitchers < games.length * 2) {
      const missing = games.length * 2 - confirmedPitchers;
      result.warnings.push(`${missing} pitcher(s) not yet confirmed by MLB Stats API`);
    }

    // Our lineup-bridge module status
    result.lineupBridgeLoaded = !!lineupBridge;
    result.mlbStatsLineupsLoaded = !!mlbStatsLineups;
    
  } catch (err) {
    result.errors.push(`MLB Stats API error: ${err.message}`);
    result.apiReachable = false;
  }

  return result;
}

// ==================== LIVE WEATHER ====================

/**
 * Pull live weather for all today's games from Open-Meteo.
 * Returns weather conditions + game impact analysis.
 */
async function pullLiveWeather(dateStr = null) {
  const date = dateStr || todayStr();
  const result = {
    date,
    gamesWithWeather: 0,
    domeGames: 0,
    weatherAlerts: [],
    games: [],
  };

  // First get today's schedule
  let games = [];
  try {
    const schedule = await fetchJSON(`${MLB_SCHEDULE_URL}?date=${date}&sportId=1`);
    games = (schedule.dates || [])[0]?.games || [];
  } catch (e) {
    result.error = `Schedule fetch failed: ${e.message}`;
    return result;
  }

  for (const game of games) {
    const venue = game.venue?.name || '??';
    const coords = VENUE_COORDS[venue];
    const awayId = game.teams?.away?.team?.id;
    const homeId = game.teams?.home?.team?.id;
    const awayAbbr = MLB_TEAM_MAP[awayId] || '??';
    const homeAbbr = MLB_TEAM_MAP[homeId] || '??';
    
    const gameWeather = {
      matchup: `${awayAbbr}@${homeAbbr}`,
      venue,
      gameTime: game.gameDate,
    };

    if (!coords) {
      gameWeather.status = 'NO_COORDS';
      result.games.push(gameWeather);
      continue;
    }

    if (!coords.outdoor) {
      gameWeather.status = 'DOME';
      gameWeather.impact = 'None (indoor/retractable)';
      gameWeather.parkFactor = coords.pf;
      result.domeGames++;
      result.games.push(gameWeather);
      continue;
    }

    try {
      // Get hourly forecast for game time window
      const wx = await fetchJSON(
        `${WEATHER_API}?latitude=${coords.lat}&longitude=${coords.lon}` +
        `&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m,cloud_cover` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=3`,
        8000
      );

      const hourly = wx.hourly || {};
      const times = hourly.time || [];
      const gameHourUTC = new Date(game.gameDate).getHours();
      
      // Find the 3-hour window around game time
      let gameHourIdx = -1;
      const gameTimePrefix = game.gameDate.substring(0, 13); // YYYY-MM-DDTHH
      for (let i = 0; i < times.length; i++) {
        if (times[i].startsWith(gameTimePrefix.replace('T', 'T'))) {
          gameHourIdx = i;
          break;
        }
      }
      
      // Fallback: find closest matching hour
      if (gameHourIdx === -1) {
        const gameDate = game.gameDate.split('T')[0];
        for (let i = 0; i < times.length; i++) {
          if (times[i].startsWith(gameDate)) {
            const hour = parseInt(times[i].split('T')[1].split(':')[0]);
            if (hour >= gameHourUTC - 1 && hour <= gameHourUTC + 3) {
              gameHourIdx = i;
              break;
            }
          }
        }
      }

      if (gameHourIdx >= 0) {
        const temp = hourly.temperature_2m[gameHourIdx];
        const precip = hourly.precipitation[gameHourIdx];
        const wind = hourly.wind_speed_10m[gameHourIdx];
        const windDir = hourly.wind_direction_10m[gameHourIdx];
        const humidity = hourly.relative_humidity_2m[gameHourIdx];
        const cloud = hourly.cloud_cover[gameHourIdx];

        gameWeather.status = 'LIVE';
        gameWeather.conditions = {
          temp: Math.round(temp),
          tempUnit: '°F',
          wind: Math.round(wind),
          windUnit: 'mph',
          windDirection: Math.round(windDir),
          precipitation: precip,
          humidity: Math.round(humidity),
          cloudCover: Math.round(cloud),
        };
        gameWeather.parkFactor = coords.pf;

        // Calculate game impact
        let runMultiplier = 1.0;
        let impacts = [];

        // Temperature impact
        if (temp < 45) {
          runMultiplier *= 0.94;
          impacts.push(`🥶 COLD (${Math.round(temp)}°F) — suppresses offense -6%`);
          result.weatherAlerts.push(`${gameWeather.matchup}: EXTREME COLD ${Math.round(temp)}°F — STRONG UNDER lean`);
        } else if (temp < 55) {
          runMultiplier *= 0.97;
          impacts.push(`Cool (${Math.round(temp)}°F) — mild offense suppression -3%`);
        } else if (temp > 85) {
          runMultiplier *= 1.03;
          impacts.push(`🔥 HOT (${Math.round(temp)}°F) — ball carries +3%`);
        }

        // Wind impact (simplified — park-specific wind analysis would be ideal)
        if (wind > 20) {
          impacts.push(`💨 Strong wind ${Math.round(wind)}mph — high variance, check direction vs park`);
          result.weatherAlerts.push(`${gameWeather.matchup}: STRONG WIND ${Math.round(wind)}mph`);
        } else if (wind > 15) {
          impacts.push(`Wind ${Math.round(wind)}mph — moderate, direction matters`);
        }

        // Precipitation
        if (precip > 0.5) {
          impacts.push(`🌧️ RAIN ${precip}mm — possible delay/postponement`);
          result.weatherAlerts.push(`${gameWeather.matchup}: RAIN RISK ${precip}mm — monitor for postponement`);
        } else if (precip > 0.1) {
          impacts.push(`Light precip ${precip}mm — drizzle possible`);
        }

        // Humidity
        if (humidity > 80) {
          runMultiplier *= 1.01;
          impacts.push(`High humidity ${Math.round(humidity)}% — ball carries slightly more`);
        }

        // Oracle Park specific
        if (venue === 'Oracle Park') {
          if (windDir >= 270 && windDir <= 330) {
            runMultiplier *= 0.97;
            impacts.push('🌊 Oracle NW wind → blows from CF toward 3B, suppresses HR to right');
          }
          impacts.push(`Oracle PF 0.93 — pitcher's paradise`);
        }

        // Wrigley Field specific
        if (venue === 'Wrigley Field') {
          if (windDir >= 180 && windDir <= 270) {
            runMultiplier *= 1.05;
            impacts.push('🌬️ Wrigley wind OUT — ball flies, OVER lean');
          } else if (windDir >= 0 && windDir <= 90) {
            runMultiplier *= 0.95;
            impacts.push('🌬️ Wrigley wind IN — pitchers delight, UNDER lean');
          }
        }

        // Fenway specific
        if (venue === 'Fenway Park') {
          impacts.push('Fenway Monster — wind direction critical for HRs');
        }

        gameWeather.runMultiplier = parseFloat(runMultiplier.toFixed(3));
        gameWeather.impacts = impacts;
        gameWeather.bettingSignal = runMultiplier < 0.97 ? 'UNDER' : runMultiplier > 1.03 ? 'OVER' : 'NEUTRAL';
        result.gamesWithWeather++;
      } else {
        gameWeather.status = 'NO_MATCH';
        gameWeather.note = 'Could not match game time to forecast window';
      }
    } catch (wxErr) {
      gameWeather.status = 'ERROR';
      gameWeather.error = wxErr.message;
    }

    result.games.push(gameWeather);
  }

  return result;
}

// ==================== SYSTEM WARM-UP ====================

/**
 * Full system warm-up — pings all critical endpoints to wake Fly.io VM
 * and pre-populate caches. Run ~30 min before first pitch.
 */
async function warmUpSystem(baseUrl = 'https://sportssim.fly.dev') {
  const endpoints = [
    { path: '/api/health', critical: true, desc: 'Health check' },
    { path: '/api/summary', critical: true, desc: 'Summary data' },
    { path: '/api/data/status', critical: true, desc: 'Data freshness' },
    { path: '/api/od/opener/quick', critical: true, desc: 'Opener quick card' },
    { path: '/api/opening-day/betting-card', critical: true, desc: 'OD betting card' },
    { path: '/api/od/live-execution', critical: true, desc: 'Live execution engine' },
    { path: '/api/mlb/predict/NYY/SF', critical: true, desc: 'NYY@SF prediction' },
    { path: '/api/opening-day/k-props', critical: false, desc: 'K props' },
    { path: '/api/opening-day/nrfi', critical: false, desc: 'NRFI analysis' },
    { path: '/api/mlb/f5/NYY/SF', critical: false, desc: 'NYY@SF F5' },
    { path: '/api/mlb/f7/NYY/SF', critical: false, desc: 'NYY@SF F7' },
    { path: '/api/mlb/platoon/NYY/SF', critical: false, desc: 'NYY@SF platoon' },
    { path: '/api/mlb/framing/NYY/SF', critical: false, desc: 'NYY@SF framing' },
    { path: '/api/mlb/nrfi/NYY/SF', critical: false, desc: 'NYY@SF NRFI' },
    { path: '/api/value/mlb', critical: false, desc: 'MLB value bets' },
    { path: '/api/nba/daily-card', critical: false, desc: 'NBA daily card' },
    { path: '/api/nhl/daily-card', critical: false, desc: 'NHL daily card' },
  ];

  const results = {
    timestamp: new Date().toISOString(),
    baseUrl,
    totalEndpoints: endpoints.length,
    passed: 0,
    failed: 0,
    criticalFailed: 0,
    details: [],
  };

  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const resp = await fetchJSON(`${baseUrl}${ep.path}`, 15000);
      const elapsed = Date.now() - start;
      results.details.push({
        path: ep.path,
        desc: ep.desc,
        status: '✅',
        ms: elapsed,
        critical: ep.critical,
      });
      results.passed++;
    } catch (err) {
      const elapsed = Date.now() - start;
      results.details.push({
        path: ep.path,
        desc: ep.desc,
        status: '❌',
        ms: elapsed,
        error: err.message,
        critical: ep.critical,
      });
      results.failed++;
      if (ep.critical) results.criticalFailed++;
    }
  }

  results.systemReady = results.criticalFailed === 0;
  results.summary = results.systemReady 
    ? `🟢 SYSTEM READY — ${results.passed}/${results.totalEndpoints} endpoints responding`
    : `🔴 SYSTEM NOT READY — ${results.criticalFailed} critical endpoints failed`;

  return results;
}

// ==================== ACTION PLAN ====================

/**
 * Generate time-aware action items based on game countdown.
 */
function getActionPlan(games = []) {
  const now = new Date();
  const items = [];

  for (const game of games) {
    const gameTime = new Date(game.gameDate || game.time);
    const hoursToGame = (gameTime - now) / 3600000;
    const matchup = game.matchup || `${MLB_TEAM_MAP[game.teams?.away?.team?.id] || '??'}@${MLB_TEAM_MAP[game.teams?.home?.team?.id] || '??'}`;

    if (hoursToGame > 12) {
      items.push({
        matchup,
        phase: 'EARLY_MORNING',
        hoursToGame: hoursToGame.toFixed(1),
        actions: [
          '✅ Verify probable pitchers confirmed on MLB Stats API',
          '✅ Pull weather forecast for venue',
          '📊 Check overnight odds movement',
          '🔄 Run system warm-up to wake VM',
        ],
      });
    } else if (hoursToGame > 6) {
      items.push({
        matchup,
        phase: 'MORNING',
        hoursToGame: hoursToGame.toFixed(1),
        actions: [
          '✅ Verify starters still confirmed (no scratches)',
          '📊 Pull live odds from all books',
          '🌤️ Update weather forecast (closer = more accurate)',
          '📋 Generate morning brief',
          '💰 Compare model edges vs market — identify target plays',
        ],
      });
    } else if (hoursToGame > 3) {
      items.push({
        matchup,
        phase: 'PRE_GAME',
        hoursToGame: hoursToGame.toFixed(1),
        actions: [
          '🚨 Monitor for lineup drops (managers submit ~2-3 hrs pre-game)',
          '📊 Track line movement for edge decay',
          '💰 Lock in early plays if edges are decaying',
          '🔄 Re-run predictions with any new lineup data',
        ],
      });
    } else if (hoursToGame > 1) {
      items.push({
        matchup,
        phase: 'LINEUP_WINDOW',
        hoursToGame: hoursToGame.toFixed(1),
        actions: [
          '🚨🚨 LINEUP MONITORING — lineups should be posted now',
          '🔄 Pull confirmed lineups from MLB Stats API',
          '📊 Re-run predictions with REAL lineup data',
          '💰 Update platoon splits, catcher framing, batter quality with actual batters',
          '📱 Final odds check — place bets NOW if edges holding',
        ],
      });
    } else if (hoursToGame > 0) {
      items.push({
        matchup,
        phase: 'EXECUTION',
        hoursToGame: hoursToGame.toFixed(1),
        actions: [
          '🎯 EXECUTE — place remaining bets',
          '✅ Verify all wagers placed',
          '📊 Record bet details in tracker',
          '📱 Set up live score monitoring',
        ],
      });
    } else {
      items.push({
        matchup,
        phase: 'LIVE',
        hoursToGame: hoursToGame.toFixed(1),
        actions: [
          '⚾ GAME IN PROGRESS — monitor live scores',
          '📊 Track in-game edges for live bets',
          '🏷️ Watch for live total adjustments',
        ],
      });
    }
  }

  return items;
}

// ==================== PRE-GAME BRIEF ====================

/**
 * Generate comprehensive pre-game brief with all signal stacks.
 */
async function preGameBrief(awayAbbr = 'NYY', homeAbbr = 'SF') {
  const brief = {
    matchup: `${awayAbbr}@${homeAbbr}`,
    timestamp: new Date().toISOString(),
    sections: {},
  };

  // 1. Model prediction
  try {
    if (mlbModel) {
      const pred = mlbModel.predict(awayAbbr, homeAbbr);
      if (pred) {
        brief.sections.prediction = {
          awayWinPct: (pred.awayWinProb * 100).toFixed(1) + '%',
          homeWinPct: (pred.homeWinProb * 100).toFixed(1) + '%',
          totalRuns: pred.expectedTotal?.toFixed(1),
          spread: pred.spread?.toFixed(1),
          awayRuns: pred.awayExpectedRuns?.toFixed(1),
          homeRuns: pred.homeExpectedRuns?.toFixed(1),
        };
        
        // F5/F7 if available
        if (pred.f5) {
          brief.sections.f5 = {
            total: pred.f5.total?.toFixed(1),
            awayRuns: pred.f5.awayRuns?.toFixed(1),
            homeRuns: pred.f5.homeRuns?.toFixed(1),
          };
        }
        if (pred.f7) {
          brief.sections.f7 = {
            total: pred.f7.total?.toFixed(1),
          };
        }
      }
    }
  } catch (e) {
    brief.sections.prediction = { error: e.message };
  }

  // 2. Weather
  try {
    const wx = await pullLiveWeather();
    const gameWx = wx.games?.find(g => g.matchup === `${awayAbbr}@${homeAbbr}`);
    if (gameWx) {
      brief.sections.weather = gameWx;
    }
  } catch (e) {
    brief.sections.weather = { error: e.message };
  }

  // 3. Lineup status
  try {
    const lineups = await verifyLineupPipeline();
    const gameLineup = lineups.games?.find(g => g.matchup === `${awayAbbr}@${homeAbbr}`);
    if (gameLineup) {
      brief.sections.lineups = gameLineup;
    }
  } catch (e) {
    brief.sections.lineups = { error: e.message };
  }

  // 4. Key signals
  brief.sections.keySignals = [];
  
  // Platoon
  try {
    if (platoonSplits?.getMatchupAnalysis) {
      const platoon = platoonSplits.getMatchupAnalysis(awayAbbr, homeAbbr);
      if (platoon) {
        brief.sections.keySignals.push({
          signal: 'Platoon Splits',
          data: platoon,
        });
      }
    }
  } catch (e) {}

  // Catcher framing
  try {
    if (catcherFraming?.getMatchupAnalysis) {
      const framing = catcherFraming.getMatchupAnalysis(awayAbbr, homeAbbr);
      if (framing) {
        brief.sections.keySignals.push({
          signal: 'Catcher Framing',
          data: framing,
        });
      }
    }
  } catch (e) {}

  // NRFI
  try {
    if (nrfiModel?.analyzeMatchup) {
      const nrfi = nrfiModel.analyzeMatchup(awayAbbr, homeAbbr);
      if (nrfi) {
        brief.sections.keySignals.push({
          signal: 'NRFI',
          data: { probability: nrfi.nrfiProbability, signal: nrfi.signal },
        });
      }
    }
  } catch (e) {}

  // 5. Action plan
  brief.sections.actionPlan = getActionPlan([{
    matchup: `${awayAbbr}@${homeAbbr}`,
    gameDate: awayAbbr === 'NYY' && homeAbbr === 'SF' ? '2026-03-26T00:05:00Z' : null,
  }]);

  return brief;
}

// ==================== FULL STATUS ====================

/**
 * Complete game-day status — the war room dashboard.
 */
async function getFullStatus() {
  const status = {
    timestamp: new Date().toISOString(),
    phase: 'GAME_DAY',
    date: todayStr(),
  };

  // 1. Lineup pipeline verification
  try {
    status.lineupPipeline = await verifyLineupPipeline();
  } catch (e) {
    status.lineupPipeline = { error: e.message };
  }

  // 2. Weather
  try {
    status.weather = await pullLiveWeather();
  } catch (e) {
    status.weather = { error: e.message };
  }

  // 3. Module status
  status.modules = {
    mlbModel: !!mlbModel,
    weatherService: !!weatherService,
    lineupBridge: !!lineupBridge,
    mlbStatsLineups: !!mlbStatsLineups,
    openerAnalysis: !!openerAnalysis,
    playBookCache: !!playBookCache,
    liveExecution: !!liveExecution,
    platoonSplits: !!platoonSplits,
    catcherFraming: !!catcherFraming,
    bullpenQuality: !!bullpenQuality,
    nrfiModel: !!nrfiModel,
    pitcherKProps: !!pitcherKProps,
    outsProps: !!outsProps,
    f3Model: !!f3Model,
    f7Model: !!f7Model,
    stolenBaseModel: !!stolenBaseModel,
  };
  status.modulesLoaded = Object.values(status.modules).filter(Boolean).length;
  status.modulesTotal = Object.keys(status.modules).length;

  // 4. Action plan
  const games = status.lineupPipeline?.games || [];
  status.actionPlan = getActionPlan(games.map(g => ({
    matchup: g.matchup,
    gameDate: g.time,
  })));

  // 5. Readiness assessment
  const lineupReady = status.lineupPipeline?.pipelineReady;
  const weatherReady = status.weather?.gamesWithWeather > 0 || status.weather?.domeGames > 0;
  const modulesReady = status.modulesLoaded >= 10;
  
  status.readiness = {
    lineupPipeline: lineupReady ? '🟢 READY' : '🔴 NOT READY',
    weather: weatherReady ? '🟢 READY' : '🟡 PARTIAL',
    modules: modulesReady ? '🟢 READY' : '🔴 NOT READY',
    overall: lineupReady && modulesReady ? '🟢 GO' : '🔴 NOT GO',
  };

  return status;
}

// ==================== EXPORTS ====================

module.exports = {
  verifyLineupPipeline,
  pullLiveWeather,
  warmUpSystem,
  getActionPlan,
  preGameBrief,
  getFullStatus,
};
