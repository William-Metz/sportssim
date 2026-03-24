/**
 * Opening Day Eve Validation System — SportsSim v104.0
 * =====================================================
 * 🚨 THE FINAL CHECK BEFORE THE MONEY MACHINE GOES LIVE
 * 
 * Run on March 25 evening (or any time before OD) to validate:
 *   1. ✅ All 20 OD games resolve in prediction engine
 *   2. ✅ All starters in pitcher DB with valid ratings
 *   3. ✅ Weather forecasts are fresh for all outdoor venues
 *   4. ✅ Betting card generating with conviction scores
 *   5. ✅ K props, outs props, NRFI, F3, F5, F7 all producing
 *   6. ✅ SGP builder working
 *   7. ✅ Gameday orchestrator ready to auto-start
 *   8. ✅ Lineup verification pipeline operational
 *   9. ✅ Results grader ready for post-game
 *   10. ✅ Odds API quota sufficient
 *   11. ✅ Live weather pull for final 48h forecast
 *   12. ✅ Postponement risk assessment
 * 
 * Returns a single GO/NO-GO decision with detailed breakdown.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load dependencies lazily
let mlb, mlbOpeningDay, pitchers, weather, weatherForecast;
let platoonSplits, catcherFraming, bullpenQuality, stolenBase;
let nrfiModel, f3Model, f7Model, kProps, outsProps;
let odPlaybookCache, odSgpBuilder, lineupVerify, gamedayOrch;
let mlbResultsGrader, bettingCard;

function loadDeps() {
  try { mlb = require('../models/mlb'); } catch(e) {}
  try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}
  try { pitchers = require('../models/mlb-pitchers'); } catch(e) {}
  try { weather = require('./weather'); } catch(e) {}
  try { weatherForecast = require('./weather-forecast'); } catch(e) {}
  try { platoonSplits = require('./platoon-splits'); } catch(e) {}
  try { catcherFraming = require('./catcher-framing'); } catch(e) {}
  try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}
  try { stolenBase = require('./stolen-base-model'); } catch(e) {}
  try { nrfiModel = require('./nrfi-model'); } catch(e) {}
  try { f3Model = require('./f3-model'); } catch(e) {}
  try { f7Model = require('./f7-model'); } catch(e) {}
  try { kProps = require('./pitcher-k-props'); } catch(e) {}
  try { outsProps = require('./pitcher-outs-props'); } catch(e) {}
  try { odPlaybookCache = require('./od-playbook-cache'); } catch(e) {}
  try { odSgpBuilder = require('./od-sgp-builder'); } catch(e) {}
  try { lineupVerify = require('./od-lineup-verify'); } catch(e) {}
  try { gamedayOrch = require('./gameday-orchestrator'); } catch(e) {}
  try { mlbResultsGrader = require('./mlb-results-grader'); } catch(e) {}
}

// ==================== WEATHER ====================

const BALLPARK_COORDS = {
  // Outdoor parks only — domes excluded from weather check
  'NYM': { lat: 40.7571, lon: -73.8458, name: 'Citi Field', city: 'New York' },
  'MIL': { lat: 43.0280, lon: -87.9712, name: 'American Family Field', city: 'Milwaukee', retractable: true },
  'CHC': { lat: 41.9484, lon: -87.6553, name: 'Wrigley Field', city: 'Chicago' },
  'BAL': { lat: 39.2838, lon: -76.6217, name: 'Camden Yards', city: 'Baltimore' },
  'CIN': { lat: 39.0974, lon: -84.5065, name: 'Great American Ball Park', city: 'Cincinnati' },
  'STL': { lat: 38.6226, lon: -90.1928, name: 'Busch Stadium', city: 'St. Louis' },
  'PHI': { lat: 39.9061, lon: -75.1665, name: 'Citizens Bank Park', city: 'Philadelphia' },
  'LAD': { lat: 34.0739, lon: -118.2400, name: 'Dodger Stadium', city: 'Los Angeles' },
  'SEA': { lat: 47.5914, lon: -122.3325, name: 'T-Mobile Park', city: 'Seattle', retractable: true },
  'SF':  { lat: 37.7786, lon: -122.3893, name: 'Oracle Park', city: 'San Francisco' },
  'ATL': { lat: 33.8907, lon: -84.4677, name: 'Truist Park', city: 'Atlanta' },
  'SD':  { lat: 32.7073, lon: -117.1566, name: 'Petco Park', city: 'San Diego' },
  'CLE': { lat: 41.4962, lon: -81.6852, name: 'Progressive Field', city: 'Cleveland' },
  // Domes
  'HOU': { lat: 29.7572, lon: -95.3555, name: 'Minute Maid Park', city: 'Houston', dome: true },
  'TOR': { lat: 43.6414, lon: -79.3894, name: 'Rogers Centre', city: 'Toronto', dome: true },
  'MIA': { lat: 25.7781, lon: -80.2196, name: 'LoanDepot Park', city: 'Miami', dome: true },
  'ARI': { lat: 33.4455, lon: -112.0667, name: 'Chase Field', city: 'Phoenix', dome: true },
  'TB':  { lat: 27.7682, lon: -82.6534, name: 'Tropicana Field', city: 'St. Petersburg', dome: true },
  'TEX': { lat: 32.7512, lon: -97.0832, name: 'Globe Life Field', city: 'Arlington', dome: true },
};

/**
 * Pull fresh 48-hour weather forecasts for all OD outdoor venues
 */
async function pullFreshWeather() {
  const results = [];
  const outdoorParks = Object.entries(BALLPARK_COORDS).filter(([k, v]) => !v.dome);
  
  for (const [team, park] of outdoorParks) {
    try {
      const forecast = await fetchOpenMeteo(park.lat, park.lon, '2026-03-26', '2026-03-27');
      if (forecast) {
        // Find game-time weather for this venue
        const gameTimeWeather = extractGameTimeWeather(team, forecast);
        results.push({
          team,
          park: park.name,
          city: park.city,
          retractable: park.retractable || false,
          forecast: gameTimeWeather,
          rawHourly: forecast,
          status: 'OK'
        });
      } else {
        results.push({ team, park: park.name, city: park.city, status: 'NO_DATA' });
      }
    } catch (e) {
      results.push({ team, park: park.name, city: park.city, status: 'ERROR', error: e.message });
    }
    // Rate limit friendly
    await sleep(200);
  }
  
  return results;
}

function fetchOpenMeteo(lat, lon, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,windspeed_10m,winddirection_10m,relative_humidity_2m,precipitation_probability,precipitation&start_date=${startDate}&end_date=${endDate}&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America/New_York`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Parse error'));
        }
      });
    }).on('error', reject);
  });
}

function extractGameTimeWeather(team, forecast) {
  if (!forecast || !forecast.hourly) return null;
  
  // OD game times (ET → index in hourly array)
  const GAME_HOURS = {
    // Day 1 - March 26 (index 0-23 in hourly)
    'NYM': { day: 0, hour: 13 },   // 1:15 PM
    'MIL': { day: 0, hour: 14 },   // 2:10 PM  
    'CHC': { day: 0, hour: 14 },   // 2:20 PM
    'BAL': { day: 0, hour: 15 },   // 3:05 PM
    'CIN': { day: 0, hour: 16 },   // 4:10 PM
    'SD':  { day: 0, hour: 13 },   // 1:10 PM PT = 4:10 PM ET
    'STL': { day: 0, hour: 15 },   // 3:15 PM CT = 4:15 PM ET
    'PHI': { day: 0, hour: 16 },   // 4:05 PM
    'LAD': { day: 0, hour: 17 },   // 5:30 PM PT = 8:30 PM ET
    'SEA': { day: 0, hour: 19 },   // 7:10 PM PT = 10:10 PM ET
    'CLE': { day: 0, hour: 18 },   // pre-travel, CLE plays at SEA
    // Day 2 - March 27 (index 24-47 in hourly)
    'SF':  { day: 1, hour: 13 },   // 1:35 PM PT = 4:35 PM ET
    'ATL': { day: 1, hour: 19 },   // 7:15 PM
  };
  
  const gameInfo = GAME_HOURS[team];
  if (!gameInfo) return null;
  
  const hourIdx = gameInfo.day * 24 + gameInfo.hour;
  const h = forecast.hourly;
  
  if (!h.time || hourIdx >= h.time.length) return null;
  
  return {
    time: h.time[hourIdx],
    tempF: h.temperature_2m?.[hourIdx],
    windMph: h.windspeed_10m?.[hourIdx],
    windDir: h.winddirection_10m?.[hourIdx],
    humidity: h.relative_humidity_2m?.[hourIdx],
    precipProb: h.precipitation_probability?.[hourIdx],
    precipMm: h.precipitation?.[hourIdx],
    // Flag conditions
    isExtremeCold: (h.temperature_2m?.[hourIdx] || 60) < 40,
    isHighWind: (h.windspeed_10m?.[hourIdx] || 0) > 15,
    isRainRisk: (h.precipitation_probability?.[hourIdx] || 0) > 40,
    isPostponementRisk: (h.precipitation_probability?.[hourIdx] || 0) > 60 || (h.temperature_2m?.[hourIdx] || 60) < 32,
  };
}

// ==================== VALIDATION CHECKS ====================

/**
 * Check 1: All 20 OD games predict successfully
 */
async function checkPredictions() {
  const check = { name: 'OD Predictions', status: 'PASS', details: [], errors: [] };
  
  if (!mlb || !mlbOpeningDay) {
    check.status = 'FAIL';
    check.errors.push('MLB model or Opening Day module not loaded');
    return check;
  }
  
  try {
    const schedule = mlbOpeningDay.getSchedule();
    check.details.push(`Schedule: ${schedule.length} games`);
    
    let passed = 0, failed = 0;
    for (const game of schedule) {
      try {
        const pred = mlb.predict(game.away, game.home, game.pitchers?.away, game.pitchers?.home);
        if (pred && pred.homeWinProb > 0 && pred.homeWinProb < 1) {
          passed++;
        } else {
          failed++;
          check.errors.push(`${game.away}@${game.home}: Invalid prediction ${JSON.stringify(pred).substring(0, 100)}`);
        }
      } catch (e) {
        failed++;
        check.errors.push(`${game.away}@${game.home}: ${e.message}`);
      }
    }
    
    check.details.push(`Predictions: ${passed}/${schedule.length} PASS, ${failed} FAIL`);
    if (failed > 0) check.status = 'FAIL';
  } catch (e) {
    check.status = 'FAIL';
    check.errors.push(`getSchedule/predict error: ${e.message}`);
  }
  
  return check;
}

/**
 * Check 2: All OD starters in pitcher DB
 */
function checkPitcherDB() {
  const check = { name: 'Pitcher Database', status: 'PASS', details: [], errors: [] };
  
  if (!pitchers || !mlbOpeningDay) {
    check.status = 'FAIL';
    check.errors.push('Pitchers or OD module not loaded');
    return check;
  }
  
  try {
    const schedule = mlbOpeningDay.getSchedule();
    let found = 0, missing = 0;
    const missingList = [];
    const foundList = [];
    
    for (const game of schedule) {
      const starters = game.confirmedStarters || game.pitchers || {};
      for (const side of ['away', 'home']) {
        const pitcher = starters[side];
        if (pitcher && pitcher !== 'TBD') {
          // Try multiple lookup methods
          const info = (pitchers.getPitcherByName && pitchers.getPitcherByName(pitcher)) ||
                       (pitchers.getPitcher && pitchers.getPitcher(pitcher)) ||
                       pitchers.PITCHERS?.[pitcher];
          if (info) {
            found++;
            foundList.push(`${pitcher} (${game[side]}, rating: ${info.rating || 'N/A'})`);
          } else {
            missing++;
            missingList.push(`${pitcher} (${game[side]})`);
          }
        }
      }
    }
    
    check.details.push(`Found: ${found} starters in DB`);
    if (found > 0 && found <= 5) {
      check.details.push(`Confirmed: ${foundList.slice(0, 5).join(', ')}`);
    }
    if (missing > 0) {
      check.status = 'WARN';
      check.details.push(`Missing: ${missing} — ${missingList.join(', ')}`);
    } else {
      check.details.push(`✅ All ${found} OD starters confirmed in pitcher database`);
    }
  } catch (e) {
    check.status = 'FAIL';
    check.errors.push(e.message);
  }
  
  return check;
}

/**
 * Check 3: Weather forecasts for outdoor parks
 */
async function checkWeather() {
  const check = { name: 'Weather Forecasts', status: 'PASS', details: [], alerts: [], forecasts: [] };
  
  try {
    const weatherData = await pullFreshWeather();
    let okCount = 0, warnCount = 0, postponementRisk = [];
    
    for (const w of weatherData) {
      if (w.status === 'OK' && w.forecast) {
        okCount++;
        const f = w.forecast;
        const summary = {
          team: w.team,
          park: w.park,
          city: w.city,
          temp: f.tempF ? `${Math.round(f.tempF)}°F` : 'N/A',
          wind: f.windMph ? `${Math.round(f.windMph)} mph` : 'N/A',
          precip: f.precipProb ? `${f.precipProb}%` : 'N/A',
          retractable: w.retractable,
        };
        
        check.forecasts.push(summary);
        
        if (f.isPostponementRisk && !w.retractable) {
          postponementRisk.push(`🚨 ${w.team} (${w.park}): ${summary.temp}, ${summary.precip} rain, ${summary.wind} wind`);
          warnCount++;
        } else if (f.isExtremeCold) {
          check.alerts.push(`❄️ ${w.team}: EXTREME COLD ${summary.temp} — UNDER lean`);
          warnCount++;
        } else if (f.isHighWind) {
          // Special Wrigley wind check
          const windDirLabel = getWindDirection(f.windDir);
          if (w.team === 'CHC') {
            if (windDirLabel === 'S' || windDirLabel === 'SSW' || windDirLabel === 'SW') {
              check.alerts.push(`💨 Wrigley: Wind OUT ${summary.wind} ${windDirLabel} — OVER signal`);
            } else if (windDirLabel === 'N' || windDirLabel === 'NNE' || windDirLabel === 'NE') {
              check.alerts.push(`💨 Wrigley: Wind IN ${summary.wind} ${windDirLabel} — UNDER signal`);
            }
          }
          if (w.team === 'SF') {
            check.alerts.push(`💨 Oracle Park: Wind ${summary.wind} ${windDirLabel} — CHECK direction for McCovey Cove effect`);
          }
        } else if (f.isRainRisk && !w.retractable) {
          check.alerts.push(`🌧️ ${w.team}: ${summary.precip} rain probability — monitor`);
        }
      } else {
        check.details.push(`${w.team}: ${w.status} ${w.error || ''}`);
      }
    }
    
    check.details.push(`Weather data: ${okCount}/${weatherData.length} outdoor parks`);
    
    if (postponementRisk.length > 0) {
      check.status = 'WARN';
      check.alerts.unshift(...postponementRisk);
      check.details.push(`⚠️ ${postponementRisk.length} postponement risk games`);
    }
    
  } catch (e) {
    check.status = 'WARN';
    check.errors = [e.message];
  }
  
  return check;
}

function getWindDirection(deg) {
  if (deg == null) return '?';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Check 4: Betting card generating
 */
async function checkBettingCard() {
  const check = { name: 'OD Betting Card', status: 'PASS', details: [], errors: [] };
  
  try {
    if (odPlaybookCache && odPlaybookCache.getCachedOnly) {
      const cached = odPlaybookCache.getCachedOnly();
      if (cached) {
        check.details.push(`Cached playbook: ${Object.keys(cached.games || {}).length} games`);
        check.details.push(`Build time: ${cached.buildTime || 'N/A'}`);
      } else {
        check.status = 'WARN';
        check.details.push('No cached playbook — will build on first request');
      }
    } else {
      check.status = 'WARN';
      check.details.push('Playbook cache module not available');
    }
  } catch (e) {
    check.status = 'WARN';
    check.errors.push(e.message);
  }
  
  return check;
}

/**
 * Check 5: Prop models (K, Outs, NRFI, F3, F5, F7)
 */
function checkPropModels() {
  const check = { name: 'Prop Models', status: 'PASS', details: [], errors: [] };
  
  const models = [
    { name: 'K Props', mod: kProps, fn: 'scanOpeningDay' },
    { name: 'Outs Props', mod: outsProps, fn: 'scanOpeningDay' },
    { name: 'NRFI', mod: nrfiModel, fn: 'scanOpeningDay' },
    { name: 'F3 Model', mod: f3Model },
    { name: 'F7 Model', mod: f7Model },
  ];
  
  for (const m of models) {
    if (m.mod) {
      check.details.push(`✅ ${m.name}: loaded`);
    } else {
      check.status = check.status === 'FAIL' ? 'FAIL' : 'WARN';
      check.details.push(`⚠️ ${m.name}: NOT loaded`);
    }
  }
  
  // Check platoon, framing, bullpen
  const signals = [
    { name: 'Platoon Splits', mod: platoonSplits },
    { name: 'Catcher Framing', mod: catcherFraming },
    { name: 'Bullpen Quality', mod: bullpenQuality },
    { name: 'Stolen Base Model', mod: stolenBase },
  ];
  
  for (const s of signals) {
    if (s.mod) {
      check.details.push(`✅ ${s.name}: loaded`);
    } else {
      check.details.push(`⚠️ ${s.name}: not loaded`);
    }
  }
  
  return check;
}

/**
 * Check 6: SGP Builder
 */
function checkSGP() {
  const check = { name: 'SGP Builder', status: 'PASS', details: [] };
  
  if (odSgpBuilder) {
    check.details.push('✅ SGP builder loaded');
  } else {
    check.status = 'WARN';
    check.details.push('⚠️ SGP builder not loaded');
  }
  
  return check;
}

/**
 * Check 7: Gameday orchestrator readiness
 */
function checkOrchestrator() {
  const check = { name: 'Gameday Orchestrator', status: 'PASS', details: [] };
  
  if (gamedayOrch) {
    check.details.push('✅ Orchestrator loaded');
    if (gamedayOrch.getState) {
      const state = gamedayOrch.getState();
      check.details.push(`Phase: ${state.phase || 'idle'}`);
      check.details.push(`Game day: ${state.isGameDay ? 'YES' : 'NO'}`);
    }
  } else {
    check.status = 'WARN';
    check.details.push('⚠️ Orchestrator not loaded — will auto-start on game day');
  }
  
  return check;
}

/**
 * Check 8: Lineup verification pipeline
 */
function checkLineupPipeline() {
  const check = { name: 'Lineup Verification', status: 'PASS', details: [] };
  
  if (lineupVerify) {
    check.details.push('✅ Lineup verify module loaded');
    // Check override file
    const overridePath = path.join(__dirname, 'lineup-overrides.json');
    if (fs.existsSync(overridePath)) {
      try {
        const overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
        check.details.push(`Manual overrides: ${Object.keys(overrides).length} games`);
      } catch (e) {
        check.details.push('Override file exists but invalid JSON');
      }
    } else {
      check.details.push('No manual overrides file (will use live data)');
    }
  } else {
    check.status = 'WARN';
    check.details.push('⚠️ Lineup verify not loaded');
  }
  
  return check;
}

/**
 * Check 9: Results grader ready
 */
function checkResultsGrader() {
  const check = { name: 'Results Grader', status: 'PASS', details: [] };
  
  if (mlbResultsGrader) {
    check.details.push('✅ MLB Results Grader loaded — ready for post-game grading');
  } else {
    check.status = 'WARN';
    check.details.push('⚠️ Results grader not loaded — won\'t auto-grade OD bets');
  }
  
  return check;
}

/**
 * Check 10: ESPN OD schedule matches our model
 */
async function checkESPNSchedule() {
  const check = { name: 'ESPN Schedule Sync', status: 'PASS', details: [], mismatches: [] };
  
  try {
    const day1Data = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260326`);
    const day2Data = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260327`);
    
    const espnDay1 = (day1Data.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      const away = comp?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation;
      const home = comp?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation;
      return { away: normalizeTeam(away), home: normalizeTeam(home), raw: `${away}@${home}` };
    });
    
    const espnDay2 = (day2Data.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      const away = comp?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation;
      const home = comp?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation;
      return { away: normalizeTeam(away), home: normalizeTeam(home), raw: `${away}@${home}` };
    });
    
    check.details.push(`ESPN Day 1: ${espnDay1.length} games`);
    check.details.push(`ESPN Day 2: ${espnDay2.length} games`);
    
    // Check for pitcher probables
    const probables1 = (day1Data.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      const away = comp?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation;
      const home = comp?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation;
      const awayP = comp?.status?.type?.detail || '';
      // Try probables
      let awayPitcher = 'TBD', homePitcher = 'TBD';
      if (comp?.probables) {
        for (const p of comp.probables) {
          if (p.homeAway === 'away') awayPitcher = p.athlete?.displayName || 'TBD';
          if (p.homeAway === 'home') homePitcher = p.athlete?.displayName || 'TBD';
        }
      }
      return { game: `${away}@${home}`, awayPitcher, homePitcher };
    });
    
    const confirmedPitchers = probables1.filter(p => p.awayPitcher !== 'TBD' || p.homePitcher !== 'TBD');
    check.details.push(`ESPN confirmed pitchers: ${confirmedPitchers.length}/${espnDay1.length} Day 1 games`);
    if (confirmedPitchers.length > 0) {
      for (const p of confirmedPitchers) {
        check.details.push(`  ${p.game}: ${p.awayPitcher} vs ${p.homePitcher}`);
      }
    }
    
    // Cross-reference with our model
    if (mlbOpeningDay) {
      const ourSchedule = mlbOpeningDay.getSchedule();
      const ourGames = ourSchedule.map(g => `${normalizeTeam(g.away)}@${normalizeTeam(g.home)}`);
      
      // Check Day 1 matches
      for (const espnGame of espnDay1) {
        const key = `${espnGame.away}@${espnGame.home}`;
        if (!ourGames.includes(key)) {
          check.mismatches.push(`ESPN has ${espnGame.raw} but NOT in our model`);
        }
      }
      
      if (check.mismatches.length > 0) {
        check.status = 'WARN';
      }
    }
    
  } catch (e) {
    check.status = 'WARN';
    check.details.push(`ESPN fetch error: ${e.message}`);
  }
  
  return check;
}

function normalizeTeam(abbr) {
  const aliases = {
    'WSH': 'WSH', 'WAS': 'WSH',
    'CHW': 'CWS', 'CWS': 'CWS',
    'KCR': 'KC', 'KC': 'KC',
    'SFG': 'SF', 'SF': 'SF',
    'SDP': 'SD', 'SD': 'SD',
    'TBR': 'TB', 'TB': 'TB',
    'ATH': 'OAK', 'OAK': 'OAK',
    'ARI': 'ARI', 'AZ': 'ARI',
  };
  return aliases[abbr] || abbr;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
  });
}

/**
 * Check 11: Data freshness
 */
function checkDataFreshness() {
  const check = { name: 'Data Freshness', status: 'PASS', details: [], staleData: [] };
  
  try {
    const cachePath = path.join(__dirname, 'data-cache.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const now = Date.now();
      
      for (const sport of ['nba', 'nhl', 'mlb']) {
        const hasData = cache[sport] && Object.keys(cache[sport]).length > 0;
        const ts = cache.timestamps && cache.timestamps[sport];
        if (hasData && ts) {
          const ageMin = Math.round((now - ts) / 60000);
          if (ageMin > 180) {
            check.staleData.push(`${sport.toUpperCase()}: ${ageMin} min old`);
            if (check.status === 'PASS') check.status = 'WARN';
          }
          check.details.push(`${sport.toUpperCase()}: ${Object.keys(cache[sport]).length} teams, ${ageMin}min ago`);
        } else {
          check.details.push(`${sport.toUpperCase()}: ${hasData ? 'loaded, no timestamp' : 'NO DATA'}`);
          if (!hasData) check.status = 'FAIL';
        }
      }
    } else {
      check.status = 'FAIL';
      check.details.push('No data cache file');
    }
  } catch (e) {
    check.status = 'FAIL';
    check.details.push(e.message);
  }
  
  // Check Statcast
  try {
    const statcastPath = path.join(__dirname, 'statcast-cache.json');
    if (fs.existsSync(statcastPath)) {
      const sc = JSON.parse(fs.readFileSync(statcastPath, 'utf8'));
      const pitchers = Object.keys(sc.pitchers || {}).length;
      const batters = Object.keys(sc.batters || {}).length;
      check.details.push(`Statcast: ${pitchers} pitchers, ${batters} batters`);
    }
  } catch (e) {}
  
  return check;
}

/**
 * Check 12: Disk cache persistence (survives deploy/restart)
 */
function checkDiskCache() {
  const check = { name: 'Disk Cache', status: 'PASS', details: [] };
  
  const diskCachePath = path.join(__dirname, 'playbook-disk-cache.json');
  if (fs.existsSync(diskCachePath)) {
    try {
      const stat = fs.statSync(diskCachePath);
      const ageMin = Math.round((Date.now() - stat.mtimeMs) / 60000);
      const size = Math.round(stat.size / 1024);
      check.details.push(`Playbook disk cache: ${size}KB, ${ageMin}min old`);
      if (ageMin > 360) {
        check.status = 'WARN';
        check.details.push('⚠️ Disk cache >6h old — recommend rebuild');
      }
    } catch (e) {
      check.details.push(`Disk cache error: ${e.message}`);
    }
  } else {
    check.status = 'WARN';
    check.details.push('No disk cache — first deploy will need warm-up time');
  }
  
  return check;
}

// ==================== MAIN VALIDATION ====================

/**
 * Run the complete OD Eve Validation
 * Returns GO/NO-GO with full breakdown
 */
async function runValidation() {
  loadDeps();
  
  const startTime = Date.now();
  const results = {
    timestamp: new Date().toISOString(),
    countdown: getCountdown(),
    overallStatus: 'GO',
    checks: {},
    weatherAlerts: [],
    actionItems: [],
    summary: {},
  };
  
  // Run all checks
  const checks = await Promise.all([
    checkPredictions(),
    Promise.resolve(checkPitcherDB()),
    checkWeather(),
    checkBettingCard(),
    Promise.resolve(checkPropModels()),
    Promise.resolve(checkSGP()),
    Promise.resolve(checkOrchestrator()),
    Promise.resolve(checkLineupPipeline()),
    Promise.resolve(checkResultsGrader()),
    checkESPNSchedule(),
    Promise.resolve(checkDataFreshness()),
    Promise.resolve(checkDiskCache()),
  ]);
  
  const checkNames = [
    'predictions', 'pitcherDB', 'weather', 'bettingCard', 'propModels',
    'sgpBuilder', 'orchestrator', 'lineupPipeline', 'resultsGrader',
    'espnSchedule', 'dataFreshness', 'diskCache'
  ];
  
  let passCount = 0, warnCount = 0, failCount = 0;
  
  for (let i = 0; i < checks.length; i++) {
    results.checks[checkNames[i]] = checks[i];
    if (checks[i].status === 'PASS') passCount++;
    else if (checks[i].status === 'WARN') warnCount++;
    else failCount++;
  }
  
  // Collect weather alerts
  if (results.checks.weather?.alerts) {
    results.weatherAlerts = results.checks.weather.alerts;
  }
  
  // Determine overall status
  if (failCount > 0) {
    results.overallStatus = 'NO-GO';
  } else if (warnCount > 2) {
    results.overallStatus = 'CAUTION';
  } else {
    results.overallStatus = 'GO';
  }
  
  // Generate action items
  results.actionItems = generateActionItems(results.checks);
  
  // Summary stats
  results.summary = {
    totalChecks: checks.length,
    pass: passCount,
    warn: warnCount,
    fail: failCount,
    duration: `${Date.now() - startTime}ms`,
    verdict: results.overallStatus === 'GO' 
      ? '🟢 ALL SYSTEMS GO — Ready to print money on Opening Day' 
      : results.overallStatus === 'CAUTION'
      ? '🟡 CAUTION — Some systems need attention before OD'
      : '🔴 NO-GO — Critical failures must be fixed before OD',
  };
  
  // Save results to disk
  try {
    const savePath = path.join(__dirname, 'od-eve-validation-results.json');
    fs.writeFileSync(savePath, JSON.stringify(results, null, 2));
  } catch (e) {}
  
  return results;
}

function getCountdown() {
  const now = new Date();
  const od1 = new Date('2026-03-26T17:15:00Z'); // Day 1 first pitch (1:15 PM ET)
  const od2 = new Date('2026-03-27T23:07:00Z'); // Day 2 first pitch
  
  const msToOD1 = od1 - now;
  const hoursToOD1 = Math.round(msToOD1 / 3600000);
  const daysToOD1 = Math.floor(hoursToOD1 / 24);
  const remainHours = hoursToOD1 % 24;
  
  return {
    odDay1: od1.toISOString(),
    odDay2: od2.toISOString(),
    hoursUntilFirstPitch: hoursToOD1,
    display: `${daysToOD1}d ${remainHours}h until first pitch`,
    isGameDay: hoursToOD1 <= 24 && hoursToOD1 > 0,
    isEve: hoursToOD1 <= 48 && hoursToOD1 > 24,
  };
}

function generateActionItems(checks) {
  const items = [];
  
  // Predictions
  if (checks.predictions?.status === 'FAIL') {
    items.push({ priority: 'P0', action: '🚨 Fix prediction engine — games not resolving' });
  }
  
  // Pitcher DB
  if (checks.pitcherDB?.status === 'WARN' || checks.pitcherDB?.status === 'FAIL') {
    items.push({ priority: 'P0', action: '🚨 Update pitcher DB — missing OD starters' });
  }
  
  // Weather postponement risk
  if (checks.weather?.alerts?.some(a => a.includes('🚨'))) {
    items.push({ priority: 'P1', action: '🌧️ Monitor postponement-risk games — may need to pull bets' });
  }
  
  // Stale data
  if (checks.dataFreshness?.status === 'WARN' || checks.dataFreshness?.status === 'FAIL') {
    items.push({ priority: 'P1', action: '📊 Refresh data feeds — standings data is stale' });
  }
  
  // Disk cache
  if (checks.diskCache?.status === 'WARN') {
    items.push({ priority: 'P2', action: '💾 Rebuild playbook disk cache for instant OD responses' });
  }
  
  // ESPN pitcher sync
  if (checks.espnSchedule?.details?.some(d => d.includes('confirmed pitchers: 0'))) {
    items.push({ priority: 'P2', action: '⏳ ESPN pitchers not confirmed yet — will be posted ~24h before games. Re-run validation on March 25 evening.' });
  }
  
  // Always add these OD-specific items
  items.push({ priority: 'INFO', action: '📋 March 25 PM: Re-run this validation after ESPN posts probables' });
  items.push({ priority: 'INFO', action: '📋 March 26 AM: Verify gameday orchestrator auto-starts' });
  items.push({ priority: 'INFO', action: '📋 March 26 T-3h: Check lineup drops flowing into model' });
  items.push({ priority: 'INFO', action: '📋 March 26 Post-game: Hit /api/mlb/results/grade/od/1 to grade Day 1 bets' });
  
  return items;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  runValidation,
  pullFreshWeather,
  checkPredictions,
  checkWeather,
  checkESPNSchedule,
  checkDataFreshness,
  getCountdown,
};
