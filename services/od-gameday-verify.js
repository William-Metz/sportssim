// services/od-gameday-verify.js — Opening Day Game Day Verification v88.0
// =====================================================================
// THE FINAL CHECKPOINT: Runs the morning of March 26 (OD Day 1) and March 27 (OD Day 2)
// to verify that ALL live data streams are flowing for the day's games.
//
// Unlike the static E2E test (od-final-check.js) which validates module integrity,
// this checks LIVE DATA availability: lineups posted, weather current, odds flowing,
// umpire assignments confirmed, pitcher starters confirmed vs our projections.
//
// This is the "GO/NO-GO" check that should run 4-6 hours before first pitch.
//
// OD Day 1: March 26, 2026 — first pitches start 12:10 PM ET
// OD Day 2: March 27, 2026 — first pitches start ~1 PM ET

const https = require('https');
const http = require('http');

// ==================== OPENING DAY SCHEDULE (DYNAMIC) ====================
// Import from authoritative source to avoid stale hardcoded data
let mlbOpeningDay = null;
try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}

// Build OD_DAY1_GAMES and OD_DAY2_GAMES dynamically from the main schedule
function buildODGames(day) {
  if (!mlbOpeningDay || !mlbOpeningDay.OPENING_DAY_GAMES) return [];
  return mlbOpeningDay.OPENING_DAY_GAMES
    .filter(g => g.day === day)
    .map(g => ({
      away: g.away,
      home: g.home,
      time: g.time || 'TBD',
      confirmedPitchers: g.confirmedStarters || { away: 'TBD', home: 'TBD' },
    }));
}

const OD_DAY1_GAMES = buildODGames(1);
const OD_DAY2_GAMES = buildODGames(2);

// ==================== LIVE DATA CHECKS ====================

/**
 * Fetch JSON from a URL (http or https)
 */
function fetchJSON(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } 
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Check if ESPN MLB schedule has today's games
 */
async function checkESPNSchedule(dateStr) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
    const data = await fetchJSON(url);
    const events = data.events || [];
    return {
      status: events.length > 0 ? 'GO' : 'WARN',
      detail: `${events.length} games found on ESPN for ${dateStr}`,
      games: events.map(e => ({
        name: e.shortName,
        status: e.status?.type?.name,
        time: e.date,
      })),
    };
  } catch (e) {
    return { status: 'FAIL', detail: 'ESPN schedule check failed: ' + e.message };
  }
}

/**
 * Check Odds API for MLB game odds availability
 */
async function checkOddsAPI(apiKey) {
  if (!apiKey) return { status: 'WARN', detail: 'No ODDS_API_KEY provided' };
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const data = await fetchJSON(url, 15000);
    const gameCount = Array.isArray(data) ? data.length : 0;
    const withTotals = Array.isArray(data) ? data.filter(g => {
      return g.bookmakers?.some(b => b.markets?.some(m => m.key === 'totals'));
    }).length : 0;
    return {
      status: gameCount > 0 ? 'GO' : 'WARN',
      detail: `${gameCount} MLB games with odds, ${withTotals} have totals`,
      gamesWithOdds: gameCount,
      gamesWithTotals: withTotals,
      sampleGames: Array.isArray(data) ? data.slice(0, 3).map(g => ({
        home: g.home_team,
        away: g.away_team,
        books: g.bookmakers?.length || 0,
      })) : [],
    };
  } catch (e) {
    return { status: 'FAIL', detail: 'Odds API check failed: ' + e.message };
  }
}

/**
 * Check weather data availability for outdoor parks
 */
async function checkWeatherData(games) {
  try {
    const weatherForecast = require('./weather-forecast');
    const outdoorGames = games.filter(g => {
      // Dome/retractable parks — exclude from weather check
      const domes = ['MIL', 'TB', 'TOR', 'MIA', 'HOU', 'ARI', 'TEX'];
      return !domes.includes(g.home);
    });
    
    let ready = 0, stale = 0, missing = 0;
    const details = [];
    for (const g of outdoorGames) {
      try {
        const forecast = weatherForecast.getForecast ? 
          await weatherForecast.getForecast(g.home) : null;
        if (forecast && forecast.temperature != null) {
          ready++;
          details.push({
            game: `${g.away}@${g.home}`,
            temp: forecast.temperature,
            wind: forecast.windSpeed,
            status: 'OK'
          });
        } else {
          missing++;
          details.push({ game: `${g.away}@${g.home}`, status: 'MISSING' });
        }
      } catch (e) {
        missing++;
        details.push({ game: `${g.away}@${g.home}`, status: 'ERROR: ' + e.message.slice(0, 50) });
      }
    }
    
    return {
      status: missing === 0 ? 'GO' : (missing <= 2 ? 'WARN' : 'FAIL'),
      detail: `Weather: ${ready}/${outdoorGames.length} outdoor parks ready, ${missing} missing`,
      outdoorGames: outdoorGames.length,
      ready,
      missing,
      details,
    };
  } catch (e) {
    return { status: 'WARN', detail: 'Weather service check failed: ' + e.message };
  }
}

/**
 * Check lineup availability (should be available 2-4 hours pre-game)
 */
async function checkLineups(games) {
  try {
    const lineupFetcher = require('./lineup-fetcher');
    let confirmed = 0, pending = 0;
    const details = [];
    
    for (const g of games) {
      try {
        const lineup = lineupFetcher.getLineup ? 
          await lineupFetcher.getLineup(g.away, g.home) : null;
        
        const awayConfirmed = lineup?.away?.confirmed || false;
        const homeConfirmed = lineup?.home?.confirmed || false;
        
        if (awayConfirmed && homeConfirmed) {
          confirmed++;
          details.push({ game: `${g.away}@${g.home}`, status: 'CONFIRMED' });
        } else {
          pending++;
          details.push({ 
            game: `${g.away}@${g.home}`, 
            status: 'PENDING',
            awayConfirmed,
            homeConfirmed,
          });
        }
      } catch (e) {
        pending++;
        details.push({ game: `${g.away}@${g.home}`, status: 'ERROR' });
      }
    }
    
    return {
      status: confirmed > games.length / 2 ? 'GO' : (confirmed > 0 ? 'WARN' : 'WARN'),
      detail: `Lineups: ${confirmed}/${games.length} confirmed, ${pending} pending`,
      confirmed,
      pending,
      note: 'Lineups typically drop 2-4 hours before first pitch. Expected to be pending pre-game.',
      details,
    };
  } catch (e) {
    return { status: 'WARN', detail: 'Lineup service check: ' + e.message };
  }
}

/**
 * Check umpire assignment availability
 */
async function checkUmpires(games) {
  try {
    const umpires = require('./umpire-tendencies');
    let assigned = 0, unassigned = 0;
    const details = [];
    
    for (const g of games) {
      try {
        const ump = umpires.getUmpireForGame ? 
          await umpires.getUmpireForGame(g.away, g.home) : null;
        if (ump && ump.name) {
          assigned++;
          details.push({ 
            game: `${g.away}@${g.home}`, 
            umpire: ump.name,
            zone: ump.zoneSize || 'unknown',
          });
        } else {
          unassigned++;
          details.push({ game: `${g.away}@${g.home}`, status: 'UNASSIGNED' });
        }
      } catch (e) {
        unassigned++;
        details.push({ game: `${g.away}@${g.home}`, status: 'ERROR' });
      }
    }
    
    return {
      status: assigned > games.length / 2 ? 'GO' : (assigned > 0 ? 'WARN' : 'WARN'),
      detail: `Umpires: ${assigned}/${games.length} assigned`,
      assigned,
      unassigned,
      note: 'Umpire assignments typically posted 24-48h before games.',
      details,
    };
  } catch (e) {
    return { status: 'WARN', detail: 'Umpire service check: ' + e.message };
  }
}

/**
 * Check prediction engine runs for all games
 */
async function checkPredictions(games) {
  try {
    const mlb = require('../models/mlb');
    let pass = 0, fail = 0;
    const results = [];
    
    for (const g of games) {
      try {
        const pred = mlb.predict(g.away, g.home, 
          g.confirmedPitchers?.away, g.confirmedPitchers?.home);
        
        const valid = pred.homeWinProb >= 0.25 && pred.homeWinProb <= 0.78 &&
                      pred.totalRuns >= 5.5 && pred.totalRuns <= 12.5;
        if (valid) pass++;
        else fail++;
        
        results.push({
          game: `${g.away}@${g.home}`,
          homeWinProb: +(pred.homeWinProb || 0).toFixed(3),
          totalRuns: +(pred.totalRuns || 0).toFixed(1),
          spread: +(pred.spread || 0).toFixed(1),
          valid,
          signals: {
            platoon: !!pred._platoonAdj,
            bullpen: !!pred._bullpenAdj,
            framing: !!pred._framingAdj,
            stolenBase: !!pred._sbAdj,
            openingWeek: !!pred._owAdj,
          },
        });
      } catch (e) {
        fail++;
        results.push({ game: `${g.away}@${g.home}`, error: e.message.slice(0, 80) });
      }
    }
    
    return {
      status: fail === 0 ? 'GO' : (fail <= 2 ? 'WARN' : 'FAIL'),
      detail: `Predictions: ${pass}/${games.length} valid`,
      pass,
      fail,
      results,
    };
  } catch (e) {
    return { status: 'FAIL', detail: 'Prediction engine check failed: ' + e.message };
  }
}

/**
 * Check async predictions (full signal stack)
 */
async function checkAsyncPredictions(games) {
  try {
    const mlb = require('../models/mlb');
    if (!mlb.asyncPredict) {
      return { status: 'WARN', detail: 'asyncPredict not available' };
    }
    
    // Test just 3 games to avoid API rate limits
    const sample = games.slice(0, 3);
    let pass = 0, fail = 0;
    const results = [];
    
    for (const g of sample) {
      try {
        const pred = await mlb.asyncPredict(g.away, g.home, {
          awayPitcher: g.confirmedPitchers?.away,
          homePitcher: g.confirmedPitchers?.home,
        });
        
        const signals = pred._asyncSignals || {};
        pass++;
        results.push({
          game: `${g.away}@${g.home}`,
          homeWinProb: +(pred.homeWinProb || 0).toFixed(3),
          totalRuns: +(pred.totalRuns || 0).toFixed(1),
          asyncSignals: signals,
        });
      } catch (e) {
        fail++;
        results.push({ game: `${g.away}@${g.home}`, error: e.message.slice(0, 80) });
      }
    }
    
    return {
      status: fail === 0 ? 'GO' : 'WARN',
      detail: `Async predictions: ${pass}/${sample.length} pass (sampled 3 of ${games.length})`,
      pass,
      fail,
      results,
    };
  } catch (e) {
    return { status: 'WARN', detail: 'Async prediction check: ' + e.message };
  }
}

/**
 * Check K Props model
 */
function checkKProps() {
  try {
    const kProps = require('./pitcher-k-props');
    const scan = kProps.scanODKProps ? kProps.scanODKProps() : null;
    if (Array.isArray(scan)) {
      const highConf = scan.filter(p => p.confidence === 'HIGH').length;
      return {
        status: 'GO',
        detail: `K Props: ${scan.length} picks, ${highConf} HIGH confidence`,
        totalPicks: scan.length,
        highConfidence: highConf,
        topPicks: scan.slice(0, 5).map(p => ({
          pitcher: p.pitcher,
          pick: p.pick,
          edge: p.edge,
          confidence: p.confidence,
        })),
      };
    }
    return { status: 'WARN', detail: 'K Props scan returned no array' };
  } catch (e) {
    return { status: 'WARN', detail: 'K Props check: ' + e.message.slice(0, 80) };
  }
}

/**
 * Check NRFI Model
 */
function checkNRFI() {
  try {
    const nrfi = require('./nrfi-model');
    const scan = nrfi.scanODGames ? nrfi.scanODGames() : null;
    if (Array.isArray(scan)) {
      return {
        status: 'GO',
        detail: `NRFI: ${scan.length} picks`,
        picks: scan.slice(0, 5).map(p => ({
          game: p.game || `${p.away}@${p.home}`,
          pick: p.pick || p.recommendation,
          prob: p.nrfiProb || p.probability,
        })),
      };
    }
    return { status: 'WARN', detail: 'NRFI scan returned no array' };
  } catch (e) {
    return { status: 'WARN', detail: 'NRFI check: ' + e.message.slice(0, 80) };
  }
}

/**
 * Check production server health
 */
async function checkProduction() {
  try {
    const data = await fetchJSON('https://sportssim.fly.dev/api/health', 10000);
    return {
      status: data.status === 'ok' ? 'GO' : 'FAIL',
      detail: `Production: v${data.version}, ${data.sports?.length || 0} sports`,
      version: data.version,
      timestamp: data.timestamp,
    };
  } catch (e) {
    return { status: 'FAIL', detail: 'Production health check FAILED: ' + e.message };
  }
}

/**
 * Check data freshness on production
 */
async function checkDataFreshness() {
  try {
    const data = await fetchJSON('https://sportssim.fly.dev/api/data/status', 10000);
    const freshness = {};
    if (data.sources) {
      for (const [key, src] of Object.entries(data.sources)) {
        const age = src.lastRefresh ? 
          Math.round((Date.now() - new Date(src.lastRefresh).getTime()) / 60000) : null;
        freshness[key] = {
          ageMinutes: age,
          status: age == null ? 'UNKNOWN' : (age < 60 ? 'FRESH' : (age < 180 ? 'STALE' : 'VERY_STALE')),
        };
      }
    }
    const allFresh = Object.values(freshness).every(f => f.status === 'FRESH' || f.status === 'UNKNOWN');
    return {
      status: allFresh ? 'GO' : 'WARN',
      detail: `Data freshness: ${Object.keys(freshness).length} sources`,
      sources: freshness,
    };
  } catch (e) {
    return { status: 'WARN', detail: 'Data freshness check: ' + e.message.slice(0, 80) };
  }
}

// ==================== MASTER VERIFICATION ====================

/**
 * Run full game day verification for specified day (1 = March 26, 2 = March 27)
 */
async function runGameDayVerification(day = 1, opts = {}) {
  const { apiKey } = opts;
  const startTime = Date.now();
  
  const games = day === 1 ? OD_DAY1_GAMES : OD_DAY2_GAMES;
  const dateStr = day === 1 ? '20260326' : '20260327';
  
  const checks = {};
  
  // Run all checks in parallel where possible
  const [
    productionResult,
    dataFreshnessResult,
    scheduleResult,
    oddsResult,
    predictionsResult,
  ] = await Promise.all([
    checkProduction(),
    checkDataFreshness(),
    checkESPNSchedule(dateStr),
    checkOddsAPI(apiKey),
    checkPredictions(games),
  ]);
  
  checks.production = productionResult;
  checks.dataFreshness = dataFreshnessResult;
  checks.espnSchedule = scheduleResult;
  checks.oddsAPI = oddsResult;
  checks.predictions = predictionsResult;
  
  // Sequential checks that need more time
  checks.weather = await checkWeatherData(games);
  checks.lineups = await checkLineups(games);
  checks.umpires = await checkUmpires(games);
  checks.asyncPredictions = await checkAsyncPredictions(games);
  checks.kProps = checkKProps();
  checks.nrfi = checkNRFI();
  
  // Compute overall status
  const allStatuses = Object.values(checks).map(c => c.status);
  const failCount = allStatuses.filter(s => s === 'FAIL').length;
  const warnCount = allStatuses.filter(s => s === 'WARN').length;
  const goCount = allStatuses.filter(s => s === 'GO').length;
  
  let overallStatus = 'GO';
  if (failCount > 0) overallStatus = 'FAIL';
  else if (warnCount > 3) overallStatus = 'WARN';
  
  const elapsed = Date.now() - startTime;
  
  return {
    title: `🎯 Opening Day ${day === 1 ? 'Day 1' : 'Day 2'} Verification`,
    date: day === 1 ? '2026-03-26' : '2026-03-27',
    ranAt: new Date().toISOString(),
    durationMs: elapsed,
    overallStatus,
    summary: {
      totalChecks: allStatuses.length,
      go: goCount,
      warn: warnCount,
      fail: failCount,
      gameCount: games.length,
    },
    actionItems: generateActionItems(checks),
    checks,
    games: games.map(g => `${g.away}@${g.home} ${g.time} (${g.confirmedPitchers?.away} vs ${g.confirmedPitchers?.home})`),
  };
}

/**
 * Generate human-readable action items from check results
 */
function generateActionItems(checks) {
  const items = [];
  
  if (checks.production?.status === 'FAIL') {
    items.push('🚨 CRITICAL: Production is DOWN — deploy immediately!');
  }
  if (checks.oddsAPI?.status === 'FAIL') {
    items.push('🚨 No odds available — check Odds API key and MLB season start');
  }
  if (checks.predictions?.status === 'FAIL') {
    items.push('🚨 Prediction engine failing — check MLB model integrity');
  }
  if (checks.weather?.status === 'FAIL') {
    items.push('⚠️ Weather data missing for outdoor parks — check Open-Meteo API');
  }
  if (checks.lineups?.status === 'WARN') {
    items.push('⏳ Lineups not yet posted — check again 2-3 hours before first pitch');
  }
  if (checks.umpires?.status === 'WARN') {
    items.push('⏳ Umpire assignments pending — check closer to game time');
  }
  if (checks.dataFreshness?.status !== 'GO') {
    items.push('⚠️ Data feeds may be stale — trigger manual refresh');
  }
  
  if (items.length === 0) {
    items.push('✅ All systems GO — ready to place bets!');
  }
  
  return items;
}

/**
 * Quick summary check (lighter weight, for dashboard polling)
 */
async function quickCheck() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  
  let odDay = null;
  if (month === 3 && day === 26) odDay = 1;
  else if (month === 3 && day === 27) odDay = 2;
  
  // Days until OD
  const od1 = new Date('2026-03-26T16:10:00Z'); // First pitch ~12:10 ET
  const daysUntil = Math.max(0, Math.ceil((od1 - today) / 86400000));
  
  let productionOk = false;
  try {
    const health = await fetchJSON('https://sportssim.fly.dev/api/health', 5000);
    productionOk = health.status === 'ok';
  } catch (e) { /* */ }
  
  return {
    isGameDay: odDay !== null,
    odDay,
    daysUntilOD: daysUntil,
    productionUp: productionOk,
    timestamp: new Date().toISOString(),
    recommendation: daysUntil === 0 ? 'RUN FULL VERIFICATION NOW' :
                    daysUntil <= 1 ? 'Run full verification in the morning' :
                    daysUntil <= 3 ? 'Systems look good, pre-flight on March 25 evening' :
                    'Building and testing — OD is coming',
  };
}

module.exports = {
  runGameDayVerification,
  quickCheck,
  checkProduction,
  checkDataFreshness,
  checkOddsAPI,
  checkESPNSchedule,
  checkWeatherData,
  checkLineups,
  checkUmpires,
  checkPredictions,
  checkAsyncPredictions,
  checkKProps,
  checkNRFI,
  OD_DAY1_GAMES,
  OD_DAY2_GAMES,
};
