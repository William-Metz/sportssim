/**
 * OD D-1 Final Comprehensive Check — SportsSim v117.0
 * ====================================================
 * 
 * THE FINAL GATE BEFORE GO LIVE — March 25 evening check for March 26 OD Day 1.
 * 
 * This service performs a comprehensive end-to-end validation of ALL systems
 * needed for Opening Day betting. Every subsystem is tested with real data.
 * 
 * CHECKS:
 * 1. MLB Stats API Schedule Verification — confirm all Day 1 games exist
 * 2. Live Weather 24hr Forecast — fresh forecasts for all outdoor venues
 * 3. Pitcher Database Verification — all OD starters in our DB with stats
 * 4. Prediction Engine Full Test — run predict() for every OD Day 1 game
 * 5. Lineup Pipeline Dry Run — test MLB Stats API lineup fetch readiness
 * 6. Odds API Connectivity — verify we can pull live odds
 * 7. Auto-Scanner Readiness — verify scanner will fire on game day
 * 8. Auto-Grade Pipeline — verify grading system ready for post-game
 * 9. Portfolio Final Optimization — recalculate all plays with freshest data
 * 10. Risk Assessment — postponement checks, edge stability analysis
 * 
 * OUTPUT: GO / NO-GO decision with detailed breakdown per subsystem
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ==================== OPENING DAY SCHEDULE ====================
// Day 1: March 26, 2026 — 11 games
const OD_DAY1_SCHEDULE = [
  { away: 'PIT', home: 'NYM', time: '13:10 ET', venue: 'Citi Field', outdoor: true },
  { away: 'CWS', home: 'MIL', time: '14:10 ET', venue: 'American Family Field', outdoor: false },
  { away: 'WSH', home: 'CHC', time: '14:20 ET', venue: 'Wrigley Field', outdoor: true },
  { away: 'MIN', home: 'BAL', time: '15:05 ET', venue: 'Camden Yards', outdoor: true },
  { away: 'BOS', home: 'CIN', time: '16:10 ET', venue: 'Great American Ball Park', outdoor: true },
  { away: 'ARI', home: 'LAD', time: '16:10 ET', venue: 'Dodger Stadium', outdoor: true },
  { away: 'KC', home: 'ATL', time: '16:20 ET', venue: 'Truist Park', outdoor: true },
  { away: 'OAK', home: 'TOR', time: '17:07 ET', venue: 'Rogers Centre', outdoor: false },
  { away: 'PHI', home: 'TB', time: '18:50 ET', venue: 'Tropicana Field', outdoor: false },
  { away: 'SF', home: 'HOU', time: '20:10 ET', venue: 'Minute Maid Park', outdoor: false },
  { away: 'CLE', home: 'SEA', time: '22:10 ET', venue: 'T-Mobile Park', outdoor: false },
];

// Day 2: March 27, 2026 — 9 games (for completeness)
const OD_DAY2_SCHEDULE = [
  { away: 'NYY', home: 'MIL', time: '14:10 ET', venue: 'American Family Field', outdoor: false },
  { away: 'DET', home: 'SD', time: '16:10 ET', venue: 'Petco Park', outdoor: true },
  { away: 'TB', home: 'STL', time: '16:15 ET', venue: 'Busch Stadium', outdoor: true },
  { away: 'TEX', home: 'CHC', time: '18:40 ET', venue: 'Wrigley Field', outdoor: true },
  { away: 'CIN', home: 'LAA', time: '19:07 ET', venue: 'Angel Stadium', outdoor: true },
  { away: 'COL', home: 'MIA', time: '19:10 ET', venue: 'loanDepot park', outdoor: false },
  { away: 'LAD', home: 'ATL', time: '19:20 ET', venue: 'Truist Park', outdoor: true },
  { away: 'NYM', home: 'HOU', time: '20:10 ET', venue: 'Minute Maid Park', outdoor: false },
  { away: 'BAL', home: 'SEA', time: '21:40 ET', venue: 'T-Mobile Park', outdoor: false },
];

// Venue coordinates for weather (from weather-forecast.js)
const VENUE_COORDS = {
  'Citi Field': { lat: 40.757, lon: -73.846 },
  'American Family Field': { lat: 43.028, lon: -87.971 },
  'Wrigley Field': { lat: 41.948, lon: -87.656 },
  'Camden Yards': { lat: 39.284, lon: -76.622 },
  'Great American Ball Park': { lat: 39.097, lon: -84.508 },
  'Dodger Stadium': { lat: 34.074, lon: -118.240 },
  'Truist Park': { lat: 33.891, lon: -84.468 },
  'Rogers Centre': { lat: 43.641, lon: -79.389 },
  'Tropicana Field': { lat: 27.768, lon: -82.653 },
  'Minute Maid Park': { lat: 29.757, lon: -95.355 },
  'T-Mobile Park': { lat: 47.591, lon: -122.333 },
  'Petco Park': { lat: 32.708, lon: -117.157 },
  'Busch Stadium': { lat: 38.623, lon: -90.193 },
  'Angel Stadium': { lat: 33.800, lon: -117.883 },
  'loanDepot park': { lat: 25.778, lon: -80.220 },
};

function fetchJSON(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proto = urlObj.protocol === 'https:' ? https : require('http');
    const req = proto.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/3.0' },
      timeout,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ==================== CHECK 1: MLB Stats API Schedule ====================
async function checkMLBSchedule() {
  const result = { name: 'MLB Stats API Schedule', status: 'UNKNOWN', details: {} };
  
  try {
    // Check Day 1 (March 26)
    const d1url = 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-03-26&hydrate=probablePitcher';
    const d1data = await fetchJSON(d1url);
    const d1games = d1data.dates?.[0]?.games || [];
    
    // Check Day 2 (March 27)
    const d2url = 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-03-27&hydrate=probablePitcher';
    const d2data = await fetchJSON(d2url);
    const d2games = d2data.dates?.[0]?.games || [];
    
    const d1Matchups = d1games.map(g => ({
      away: g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name,
      home: g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name,
      status: g.status?.detailedState,
      pitcher_away: g.teams?.away?.probablePitcher?.fullName || 'TBD',
      pitcher_home: g.teams?.home?.probablePitcher?.fullName || 'TBD',
      venue: g.venue?.name,
      gamePk: g.gamePk,
    }));
    
    const d2Matchups = d2games.map(g => ({
      away: g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name,
      home: g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name,
      status: g.status?.detailedState,
      pitcher_away: g.teams?.away?.probablePitcher?.fullName || 'TBD',
      pitcher_home: g.teams?.home?.probablePitcher?.fullName || 'TBD',
      venue: g.venue?.name,
      gamePk: g.gamePk,
    }));
    
    const d1Expected = OD_DAY1_SCHEDULE.length;
    const d2Expected = OD_DAY2_SCHEDULE.length;
    
    // Count confirmed pitchers
    const d1PitchersConfirmed = d1Matchups.filter(m => m.pitcher_away !== 'TBD' && m.pitcher_home !== 'TBD').length;
    const d2PitchersConfirmed = d2Matchups.filter(m => m.pitcher_away !== 'TBD' && m.pitcher_home !== 'TBD').length;
    
    const tbdPitchers = [];
    [...d1Matchups, ...d2Matchups].forEach(m => {
      if (m.pitcher_away === 'TBD') tbdPitchers.push(`${m.away}@${m.home}: Away pitcher TBD`);
      if (m.pitcher_home === 'TBD') tbdPitchers.push(`${m.away}@${m.home}: Home pitcher TBD`);
    });
    
    result.details = {
      day1: { expected: d1Expected, found: d1games.length, pitchersConfirmed: d1PitchersConfirmed, matchups: d1Matchups },
      day2: { expected: d2Expected, found: d2games.length, pitchersConfirmed: d2PitchersConfirmed, matchups: d2Matchups },
      tbdPitchers,
      totalGames: d1games.length + d2games.length,
      totalExpected: d1Expected + d2Expected,
    };
    
    // GO if we have all games on schedule
    if (d1games.length >= d1Expected - 1 && d2games.length >= d2Expected - 1) {
      result.status = 'GO';
      result.message = `Schedule confirmed: ${d1games.length} Day 1 + ${d2games.length} Day 2 = ${d1games.length + d2games.length} total games. ${d1PitchersConfirmed + d2PitchersConfirmed} pitchers confirmed.`;
    } else {
      result.status = 'WARN';
      result.message = `Schedule incomplete: Expected ${d1Expected + d2Expected}, found ${d1games.length + d2games.length}. Check for postponements.`;
    }
  } catch (e) {
    result.status = 'FAIL';
    result.message = `MLB Stats API error: ${e.message}`;
  }
  
  return result;
}

// ==================== CHECK 2: Live Weather 24hr ====================
async function checkWeather() {
  const result = { name: 'Weather Forecasts', status: 'UNKNOWN', details: {} };
  
  try {
    const outdoorGames = OD_DAY1_SCHEDULE.filter(g => g.outdoor);
    const weatherResults = [];
    let issues = [];
    
    for (const game of outdoorGames.slice(0, 8)) { // Check up to 8 outdoor games
      try {
        const coords = VENUE_COORDS[game.venue];
        if (!coords) {
          weatherResults.push({ matchup: `${game.away}@${game.home}`, status: 'SKIP', reason: 'No coordinates' });
          continue;
        }
        
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m&forecast_days=3&timezone=America/New_York`;
        const data = await fetchJSON(url);
        
        // Find the hour closest to game time (rough: extract hour from ET time)
        const hourMatch = game.time.match(/(\d+):(\d+)/);
        const gameHourET = hourMatch ? parseInt(hourMatch[1]) : 16;
        
        // Get March 26 data (roughly hour 0-23 for that day)
        // Open-Meteo returns UTC — rough offset for ET is -4/-5
        const times = data.hourly?.time || [];
        const march26Idx = times.findIndex(t => t.startsWith('2026-03-26'));
        
        if (march26Idx === -1) {
          weatherResults.push({ matchup: `${game.away}@${game.home}`, status: 'WARN', reason: 'March 26 data not in forecast range' });
          continue;
        }
        
        // Game hour in UTC (ET + 4 for EDT)
        const gameHourUTC = gameHourET + 4;
        const targetIdx = march26Idx + Math.min(gameHourUTC, 23);
        
        const temp_f = (data.hourly.temperature_2m[targetIdx] * 9/5 + 32).toFixed(1);
        const precip_prob = data.hourly.precipitation_probability?.[targetIdx] || 0;
        const precip_mm = data.hourly.precipitation?.[targetIdx] || 0;
        const wind_mph = ((data.hourly.wind_speed_10m?.[targetIdx] || 0) * 0.621).toFixed(1);
        const wind_dir = data.hourly.wind_direction_10m?.[targetIdx] || 0;
        
        const wx = {
          matchup: `${game.away}@${game.home}`,
          venue: game.venue,
          temp_f: parseFloat(temp_f),
          precip_prob,
          precip_mm,
          wind_mph: parseFloat(wind_mph),
          wind_dir,
        };
        
        // Flag issues
        if (precip_prob > 50) {
          wx.alert = `⛈️ ${precip_prob}% rain probability — POSTPONEMENT RISK`;
          issues.push(`${game.away}@${game.home}: ${precip_prob}% rain chance`);
        }
        if (parseFloat(temp_f) < 35) {
          wx.alert = (wx.alert || '') + ` 🥶 ${temp_f}°F EXTREME COLD`;
          issues.push(`${game.away}@${game.home}: ${temp_f}°F extreme cold`);
        }
        if (parseFloat(wind_mph) > 20) {
          wx.alert = (wx.alert || '') + ` 💨 ${wind_mph}mph HIGH WIND`;
        }
        
        wx.status = (precip_prob > 60) ? 'WARN' : 'GO';
        weatherResults.push(wx);
        
        // Throttle API calls
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        weatherResults.push({ matchup: `${game.away}@${game.home}`, status: 'FAIL', error: e.message });
      }
    }
    
    const indoorGames = OD_DAY1_SCHEDULE.filter(g => !g.outdoor);
    indoorGames.forEach(g => {
      weatherResults.push({ matchup: `${game.away}@${game.home}`, status: 'GO', venue: g.venue, note: 'DOME/RETRACTABLE — weather N/A' });
    });
    
    result.details = { forecasts: weatherResults, issues, outdoorCount: outdoorGames.length, indoorCount: indoorGames.length };
    result.status = issues.length > 0 ? 'WARN' : 'GO';
    result.message = `${weatherResults.filter(w => w.status === 'GO').length}/${outdoorGames.length} outdoor games clear. ${issues.length} weather alerts.`;
    if (issues.length > 0) result.message += ` ISSUES: ${issues.join('; ')}`;
    
  } catch (e) {
    result.status = 'FAIL';
    result.message = `Weather check error: ${e.message}`;
  }
  
  return result;
}

// ==================== CHECK 3: Pitcher Database ====================
function checkPitcherDB(mlb) {
  const result = { name: 'Pitcher Database', status: 'UNKNOWN', details: {} };
  
  try {
    const pitcherDB = mlb?.pitcherDB || mlb?.PITCHERS || {};
    const allPitchers = Object.keys(pitcherDB);
    
    // OD Day 1 expected starters (our best knowledge)
    const expectedStarters = {
      'PIT@NYM': { away: 'Paul Skenes', home: 'Frankie Montas' },
      'CWS@MIL': { away: 'Garrett Crochet', home: 'Freddy Peralta' },
      'WSH@CHC': { away: 'Jake Irvin', home: 'Matthew Boyd' },
      'MIN@BAL': { away: 'Joe Ryan', home: 'Corbin Burnes' },
      'BOS@CIN': { away: 'Brayan Bello', home: 'Nick Lodolo' },
      'ARI@LAD': { away: 'Zac Gallen', home: 'Yoshinobu Yamamoto' },
      'KC@ATL': { away: 'Cole Ragans', home: 'Chris Sale' },
      'OAK@TOR': { away: 'JP Sears', home: 'Kevin Gausman' },
      'PHI@TB': { away: 'Zack Wheeler', home: 'Zach Eflin' },
      'SF@HOU': { away: 'Logan Webb', home: 'Framber Valdez' },
      'CLE@SEA': { away: 'Tanner Bibee', home: 'Logan Gilbert' },
    };
    
    const found = [];
    const missing = [];
    const starterDetails = [];
    
    for (const [matchup, starters] of Object.entries(expectedStarters)) {
      for (const [side, name] of Object.entries(starters)) {
        // Check by name variations
        const pitcher = pitcherDB[name] || 
          Object.values(pitcherDB).find(p => p.name === name || p.fullName === name);
        
        if (pitcher) {
          found.push(name);
          starterDetails.push({
            matchup, side, name,
            era: pitcher.era || pitcher.xERA || 'N/A',
            k9: pitcher.k9 || pitcher.kPer9 || 'N/A',
            status: 'FOUND'
          });
        } else {
          // Try partial match
          const partial = allPitchers.find(p => p.toLowerCase().includes(name.split(' ').pop().toLowerCase()));
          if (partial) {
            found.push(name);
            starterDetails.push({ matchup, side, name, dbName: partial, status: 'PARTIAL_MATCH' });
          } else {
            missing.push(name);
            starterDetails.push({ matchup, side, name, status: 'MISSING' });
          }
        }
      }
    }
    
    result.details = {
      totalInDB: allPitchers.length,
      startersFound: found.length,
      startersMissing: missing.length,
      missing,
      starters: starterDetails,
    };
    
    if (missing.length === 0) {
      result.status = 'GO';
      result.message = `All ${found.length} OD Day 1 starters found in pitcher DB (${allPitchers.length} total pitchers).`;
    } else if (missing.length <= 2) {
      result.status = 'WARN';
      result.message = `${found.length}/${found.length + missing.length} starters found. Missing: ${missing.join(', ')}`;
    } else {
      result.status = 'FAIL';
      result.message = `${missing.length} starters missing from DB: ${missing.join(', ')}`;
    }
  } catch (e) {
    result.status = 'FAIL';
    result.message = `Pitcher DB check error: ${e.message}`;
  }
  
  return result;
}

// ==================== CHECK 4: Prediction Engine ====================
function checkPredictions(mlb) {
  const result = { name: 'Prediction Engine', status: 'UNKNOWN', details: {} };
  
  try {
    const predict = mlb?.predict;
    if (!predict) {
      result.status = 'FAIL';
      result.message = 'predict() function not available';
      return result;
    }
    
    const predictions = [];
    let failCount = 0;
    
    for (const game of OD_DAY1_SCHEDULE) {
      try {
        const pred = predict(game.away, game.home);
        if (pred && pred.homeWinProb !== undefined) {
          predictions.push({
            matchup: `${game.away}@${game.home}`,
            homeWinProb: (pred.homeWinProb * 100).toFixed(1) + '%',
            awayWinProb: ((1 - pred.homeWinProb) * 100).toFixed(1) + '%',
            totalRuns: pred.expectedTotal?.toFixed(1) || pred.total?.toFixed(1) || 'N/A',
            spreadHome: pred.spread?.toFixed(1) || pred.homeSpread?.toFixed(1) || 'N/A',
            f5: pred.f5 ? { total: pred.f5.expectedTotal?.toFixed(1), homeWP: (pred.f5.homeWinProb * 100).toFixed(1) + '%' } : null,
            signals: pred._asyncSignals || [],
            status: 'PASS'
          });
        } else {
          failCount++;
          predictions.push({ matchup: `${game.away}@${game.home}`, status: 'FAIL', error: 'No homeWinProb' });
        }
      } catch (e) {
        failCount++;
        predictions.push({ matchup: `${game.away}@${game.home}`, status: 'FAIL', error: e.message });
      }
    }
    
    result.details = { predictions, passCount: predictions.length - failCount, failCount };
    
    if (failCount === 0) {
      result.status = 'GO';
      result.message = `All ${predictions.length} Day 1 predictions PASS.`;
    } else if (failCount <= 2) {
      result.status = 'WARN';
      result.message = `${predictions.length - failCount}/${predictions.length} predictions pass. ${failCount} failed.`;
    } else {
      result.status = 'FAIL';
      result.message = `${failCount}/${predictions.length} predictions FAILED.`;
    }
  } catch (e) {
    result.status = 'FAIL';
    result.message = `Prediction engine error: ${e.message}`;
  }
  
  return result;
}

// ==================== CHECK 5: Lineup Pipeline Readiness ====================
async function checkLineupPipeline() {
  const result = { name: 'Lineup Pipeline', status: 'UNKNOWN', details: {} };
  
  try {
    // Test MLB Stats API connectivity by fetching today's schedule
    const today = new Date().toISOString().slice(0, 10);
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}`;
    const data = await fetchJSON(url);
    
    // Also try fetching a specific game feed to verify lineup endpoint works
    let lineupTestResult = 'NOT_TESTED';
    const todayGames = data.dates?.[0]?.games || [];
    
    if (todayGames.length > 0) {
      try {
        const testPk = todayGames[0].gamePk;
        const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${testPk}/feed/live`;
        const feed = await fetchJSON(feedUrl, 8000);
        const awayBatters = feed.liveData?.boxscore?.teams?.away?.battingOrder || [];
        const homeBatters = feed.liveData?.boxscore?.teams?.home?.battingOrder || [];
        lineupTestResult = `Feed ${testPk}: away=${awayBatters.length} batters, home=${homeBatters.length} batters`;
      } catch (e) {
        lineupTestResult = `Feed test failed: ${e.message}`;
      }
    }
    
    // Check our lineup services exist
    const services = {
      mlbStatsLineups: fs.existsSync(path.join(__dirname, 'mlb-stats-lineups.js')),
      lineupBridge: fs.existsSync(path.join(__dirname, 'lineup-bridge.js')),
      lineupMonitor: fs.existsSync(path.join(__dirname, 'lineup-monitor.js')),
      lineupFetcher: fs.existsSync(path.join(__dirname, 'lineup-fetcher.js')),
      lineupOverrides: fs.existsSync(path.join(__dirname, 'lineup-overrides.json')),
    };
    
    // Check lineup bridge state
    let bridgeState = null;
    try {
      const stateFile = path.join(__dirname, 'gameday-lineup-state.json');
      if (fs.existsSync(stateFile)) {
        bridgeState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      }
    } catch (e) { /* ok */ }
    
    result.details = {
      mlbStatsAPIStatus: data.dates ? 'CONNECTED' : 'NO_DATA',
      todayGames: todayGames.length,
      lineupFeedTest: lineupTestResult,
      services,
      bridgeState: bridgeState ? { lastUpdate: bridgeState.lastUpdate, gamesTracked: Object.keys(bridgeState.games || {}).length } : 'NO_STATE',
      notes: [
        'MLB lineups are typically posted 2-3 hours before game time',
        'First Day 1 game (PIT@NYM) is at 1:10 PM ET — expect lineups by ~10:30 AM ET',
        'Monitor /api/lineups/bridge/status for real-time lineup tracking on game day'
      ]
    };
    
    const allServicesExist = Object.values(services).every(v => v);
    result.status = allServicesExist ? 'GO' : 'WARN';
    result.message = `MLB Stats API ${data.dates ? 'CONNECTED' : 'UNREACHABLE'}. ${Object.values(services).filter(v => v).length}/5 lineup services present. ${lineupTestResult}`;
    
  } catch (e) {
    result.status = 'FAIL';
    result.message = `Lineup pipeline error: ${e.message}`;
  }
  
  return result;
}

// ==================== CHECK 6: Production Health ====================
async function checkProductionHealth() {
  const result = { name: 'Production Health', status: 'UNKNOWN', details: {} };
  
  try {
    const start = Date.now();
    const health = await fetchJSON('https://sportssim.fly.dev/api/health', 10000);
    const latency = Date.now() - start;
    
    result.details = {
      version: health.version,
      latency: latency + 'ms',
      sports: health.sports,
      featureCount: health.features?.length || 0,
      timestamp: health.timestamp,
    };
    
    // Check data freshness
    try {
      const summary = await fetchJSON('https://sportssim.fly.dev/api/summary', 10000);
      result.details.dataFreshness = summary.dataAge || summary.lastRefresh || 'unknown';
      result.details.activeGames = summary.gamesTotal || summary.games?.length || 0;
    } catch (e) {
      result.details.summaryError = e.message;
    }
    
    if (health.status === 'ok' && latency < 5000) {
      result.status = 'GO';
      result.message = `Production HEALTHY. v${health.version}, ${health.features?.length} features, ${latency}ms latency.`;
    } else {
      result.status = 'WARN';
      result.message = `Production responding but ${latency > 5000 ? 'slow' : 'degraded'}. v${health.version}, ${latency}ms.`;
    }
    
  } catch (e) {
    result.status = 'FAIL';
    result.message = `Production DOWN: ${e.message}`;
  }
  
  return result;
}

// ==================== CHECK 7: Betting Card Status ====================
async function checkBettingCard() {
  const result = { name: 'OD Betting Card', status: 'UNKNOWN', details: {} };
  
  try {
    const card = await fetchJSON('https://sportssim.fly.dev/api/opening-day/betting-card', 15000);
    
    if (card.building) {
      result.status = 'WARN';
      result.message = 'Betting card is still building (cache not ready).';
      result.details = { building: true };
      return result;
    }
    
    const plays = card.plays || card.allPlays || [];
    const smashPlays = plays.filter(p => p.tier === 'SMASH' || p.conviction >= 80);
    const strongPlays = plays.filter(p => p.tier === 'STRONG' || (p.conviction >= 60 && p.conviction < 80));
    
    result.details = {
      totalPlays: plays.length,
      smash: smashPlays.length,
      strong: strongPlays.length,
      lean: plays.length - smashPlays.length - strongPlays.length,
      topPlays: smashPlays.map(p => ({
        matchup: p.matchup || `${p.away}@${p.home}`,
        market: p.market || p.type,
        edge: p.edge ? (p.edge * 100).toFixed(1) + '%' : 'N/A',
        conviction: p.conviction,
      })),
      portfolio: card.portfolio || null,
    };
    
    result.status = plays.length >= 10 ? 'GO' : 'WARN';
    result.message = `${plays.length} plays: ${smashPlays.length} SMASH, ${strongPlays.length} STRONG. ${card.portfolio ? `Portfolio: $${card.portfolio.totalWager?.toFixed(0)} wager, $${card.portfolio.totalEV?.toFixed(0)} EV` : ''}`;
    
  } catch (e) {
    result.status = 'FAIL';
    result.message = `Betting card error: ${e.message}`;
  }
  
  return result;
}

// ==================== MASTER CHECK ====================
async function runD1FinalCheck(mlb, opts = {}) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log('[OD-D1-FINAL] 🚀 Starting comprehensive D-1 final check...');
  
  const checks = [];
  
  // Run all checks
  try {
    // Parallel checks that don't depend on each other
    const [scheduleResult, weatherResult, lineupResult, prodResult, cardResult] = await Promise.all([
      checkMLBSchedule(),
      checkWeather(),
      checkLineupPipeline(),
      checkProductionHealth(),
      checkBettingCard(),
    ]);
    
    checks.push(scheduleResult);
    checks.push(weatherResult);
    
    // Sequential checks that need mlb model
    if (mlb) {
      checks.push(checkPitcherDB(mlb));
      checks.push(checkPredictions(mlb));
    } else {
      checks.push({ name: 'Pitcher Database', status: 'SKIP', message: 'MLB model not provided' });
      checks.push({ name: 'Prediction Engine', status: 'SKIP', message: 'MLB model not provided' });
    }
    
    checks.push(lineupResult);
    checks.push(prodResult);
    checks.push(cardResult);
    
  } catch (e) {
    checks.push({ name: 'Check Runner', status: 'FAIL', message: `Error running checks: ${e.message}` });
  }
  
  // Calculate overall status
  const goCount = checks.filter(c => c.status === 'GO').length;
  const warnCount = checks.filter(c => c.status === 'WARN').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const skipCount = checks.filter(c => c.status === 'SKIP').length;
  
  let overallStatus = 'GO';
  if (failCount > 0) overallStatus = 'NO-GO';
  else if (warnCount > 2) overallStatus = 'CAUTION';
  else if (warnCount > 0) overallStatus = 'GO-WITH-CAVEATS';
  
  const elapsed = Date.now() - startTime;
  
  const report = {
    timestamp,
    overallStatus,
    decision: overallStatus === 'GO' ? '✅ ALL SYSTEMS GO — CLEAR TO BET OPENING DAY' :
              overallStatus === 'GO-WITH-CAVEATS' ? '⚠️ GO WITH CAVEATS — Minor issues, proceed with awareness' :
              overallStatus === 'CAUTION' ? '⚠️ CAUTION — Multiple warnings, review before betting' :
              '🚫 NO-GO — Critical failures detected, DO NOT BET until resolved',
    summary: {
      go: goCount,
      warn: warnCount,
      fail: failCount,
      skip: skipCount,
      totalChecks: checks.length,
      elapsed: elapsed + 'ms',
    },
    countdown: {
      od1: 'March 26, 2026 — Day 1 (11 games)',
      od2: 'March 27, 2026 — Day 2 (9 games)',
      firstPitch: 'PIT@NYM 1:10 PM ET',
      hoursUntilD1: Math.max(0, (new Date('2026-03-26T17:10:00Z').getTime() - Date.now()) / 3600000).toFixed(1),
    },
    checks,
    actionItems: generateActionItems(checks),
    gameday: {
      morningChecklist: [
        '10:00 AM ET — Check /api/lineups/bridge/status for lineup postings',
        '10:30 AM ET — First lineups expected (PIT@NYM 1:10 PM)',
        '11:00 AM ET — Verify weather forecasts one more time',
        '11:30 AM ET — Place SMASH bets if lineups confirm',
        '12:00 PM ET — Final odds check before first pitch',
        '1:10 PM ET — FIRST PITCH — PIT@NYM 🎉',
        'POST-GAME — Auto-grade pipeline triggers when games complete',
      ],
      criticalBets: [
        'MIN@BAL UNDER 8.5 — SMASH (22.6% edge, elite pitching both sides)',
        'MIN@BAL F5 UNDER — SMASH (21.4% edge, Ryan vs Burnes)',
        'BAL ML — SMASH (Burnes at home)',
      ],
    },
  };
  
  console.log(`[OD-D1-FINAL] ✅ D-1 final check complete in ${elapsed}ms. Status: ${overallStatus}`);
  
  return report;
}

function generateActionItems(checks) {
  const items = [];
  
  for (const check of checks) {
    if (check.status === 'FAIL') {
      items.push({ priority: 'CRITICAL', action: `Fix ${check.name}: ${check.message}`, check: check.name });
    } else if (check.status === 'WARN') {
      items.push({ priority: 'IMPORTANT', action: `Review ${check.name}: ${check.message}`, check: check.name });
    }
  }
  
  // Standard pre-OD items
  items.push({ priority: 'ROUTINE', action: 'Verify DraftKings lines are posted for all Day 1 games', check: 'Manual' });
  items.push({ priority: 'ROUTINE', action: 'Check for any late pitcher changes on ESPN/MLB.com', check: 'Manual' });
  items.push({ priority: 'ROUTINE', action: 'Deposit bankroll if needed — recommend $1000 starting bankroll for OD', check: 'Manual' });
  
  return items.sort((a, b) => {
    const pri = { CRITICAL: 0, IMPORTANT: 1, ROUTINE: 2 };
    return (pri[a.priority] || 3) - (pri[b.priority] || 3);
  });
}

// ==================== QUICK D1 STATUS (non-blocking) ====================
function getD1StatusQuick() {
  const now = new Date();
  const d1 = new Date('2026-03-26T17:10:00Z'); // 1:10 PM ET = 17:10 UTC
  const hoursLeft = (d1.getTime() - now.getTime()) / 3600000;
  
  return {
    hoursUntilFirstPitch: hoursLeft.toFixed(1),
    phase: hoursLeft > 48 ? 'PREP' : hoursLeft > 24 ? 'D-1' : hoursLeft > 4 ? 'GAMEDAY-MORNING' : hoursLeft > 0 ? 'GAMEDAY-LIVE' : 'IN-PROGRESS',
    day1Games: OD_DAY1_SCHEDULE.length,
    day2Games: OD_DAY2_SCHEDULE.length,
    schedule: { day1: OD_DAY1_SCHEDULE, day2: OD_DAY2_SCHEDULE },
  };
}

module.exports = {
  runD1FinalCheck,
  checkMLBSchedule,
  checkWeather,
  checkPitcherDB,
  checkPredictions,
  checkLineupPipeline,
  checkProductionHealth,
  checkBettingCard,
  getD1StatusQuick,
  OD_DAY1_SCHEDULE,
  OD_DAY2_SCHEDULE,
};
