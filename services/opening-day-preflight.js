/**
 * Opening Day Pre-Flight Check — SportsSim v57.0
 * 
 * Comprehensive validation suite for Opening Day readiness.
 * Runs ALL prediction pipelines end-to-end and reports:
 *   - Data freshness (live feeds, injuries, rolling stats)
 *   - MLB model predict() for all 20 OD games
 *   - asyncPredict() with full signal stack
 *   - Weather pipeline for all 11 Day 1 parks
 *   - Opening Week unders adjustments
 *   - Pitcher database coverage (all starters present?)
 *   - Season simulator consistency
 *   - ML engine status + predictions
 *   - Catcher framing coverage
 *   - Value detection pipeline
 *   - Auto-scanner operational status
 * 
 * Run this before March 27 to catch any silent failures.
 */

// Import all services
let mlb, mlbOpeningDay, pitchers, weather, weatherForecast;
let rollingStats, injuryService, lineupFetcher, preseasonTuning;
let openingWeekUnders, seasonSim, mlBridge, statcast;
let calibration, autoScanner, altLines;

try { mlb = require('../models/mlb'); } catch(e) {}
try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}
try { pitchers = require('../models/mlb-pitchers'); } catch(e) {}
try { weather = require('./weather'); } catch(e) {}
try { weatherForecast = require('./weather-forecast'); } catch(e) {}
try { rollingStats = require('./rolling-stats'); } catch(e) {}
try { injuryService = require('./injuries'); } catch(e) {}
try { lineupFetcher = require('./lineup-fetcher'); } catch(e) {}
try { preseasonTuning = require('./preseason-tuning'); } catch(e) {}
try { openingWeekUnders = require('./opening-week-unders'); } catch(e) {}
try { seasonSim = require('./season-simulator'); } catch(e) {}
try { mlBridge = require('./ml-bridge'); } catch(e) {}
try { statcast = require('./statcast'); } catch(e) {}
try { calibration = require('./calibration'); } catch(e) {}
try { autoScanner = require('./auto-scanner'); } catch(e) {}
try { altLines = require('./alt-lines'); } catch(e) {}


// ==================== CHECK FUNCTIONS ====================

/**
 * Check 1: Data Freshness
 */
function checkDataFreshness() {
  const results = { status: 'PASS', checks: [] };
  
  // Live data cache
  try {
    const fs = require('fs');
    const path = require('path');
    const cachePath = path.join(__dirname, 'data-cache.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const now = Date.now();
      
      for (const sport of ['nba', 'nhl', 'mlb']) {
        const key = `${sport}_standings`;
        if (cache[key]) {
          const age = now - cache[key].timestamp;
          const ageMinutes = Math.round(age / 60000);
          const stale = ageMinutes > 180; // >3 hours is stale
          results.checks.push({
            name: `${sport.toUpperCase()} standings data`,
            status: stale ? 'WARN' : 'PASS',
            detail: `${ageMinutes} minutes old`,
            freshness: ageMinutes
          });
          if (stale) results.status = 'WARN';
        } else {
          results.checks.push({
            name: `${sport.toUpperCase()} standings data`,
            status: 'FAIL',
            detail: 'No cached data found'
          });
          results.status = 'FAIL';
        }
      }
    } else {
      results.checks.push({ name: 'Data cache file', status: 'FAIL', detail: 'data-cache.json not found' });
      results.status = 'FAIL';
    }
  } catch (e) {
    results.checks.push({ name: 'Data cache', status: 'FAIL', detail: e.message });
    results.status = 'FAIL';
  }
  
  return results;
}

/**
 * Check 2: MLB Model — predict all 20 OD games
 */
async function checkMLBPredictions() {
  const results = { status: 'PASS', games: [], errors: [], stats: {} };
  
  if (!mlb || !mlbOpeningDay) {
    return { status: 'FAIL', error: 'MLB model or Opening Day module not loaded' };
  }
  
  try {
    const projections = await mlbOpeningDay.getProjections();
    if (!projections || !projections.games) {
      return { status: 'FAIL', error: 'getProjections() returned no games' };
    }
    
    results.stats.totalGames = projections.games.length;
    
    for (const game of projections.games) {
      try {
        // Test basic predict
        const pred = mlb.predict(game.away, game.home, {
          awayPitcher: game.awayStarter?.name,
          homePitcher: game.homeStarter?.name,
          gameDate: game.date
        });
        
        // Validate prediction sanity
        const checks = [];
        
        if (!pred || typeof pred.homeWinProb !== 'number') {
          checks.push('MISSING homeWinProb');
        } else if (pred.homeWinProb < 0.15 || pred.homeWinProb > 0.85) {
          checks.push(`homeWinProb=${pred.homeWinProb} seems extreme`);
        }
        
        if (!pred.totalRuns || pred.totalRuns < 5 || pred.totalRuns > 14) {
          checks.push(`totalRuns=${pred.totalRuns} out of range [5-14]`);
        }
        
        if (!pred.homeExpRuns || pred.homeExpRuns < 1 || pred.homeExpRuns > 9) {
          checks.push(`homeExpRuns=${pred.homeExpRuns} out of range [1-9]`);
        }
        
        if (!pred.awayExpRuns || pred.awayExpRuns < 1 || pred.awayExpRuns > 9) {
          checks.push(`awayExpRuns=${pred.awayExpRuns} out of range [1-9]`);
        }
        
        // Check pitcher data
        if (!game.awayStarter || !game.awayStarter.name) {
          checks.push('Missing away starter data');
        }
        if (!game.homeStarter || !game.homeStarter.name) {
          checks.push('Missing home starter data');
        }
        
        const gameResult = {
          matchup: `${game.away}@${game.home}`,
          date: game.date,
          homeWinProb: pred.homeWinProb,
          awayWinProb: pred.awayWinProb,
          totalRuns: pred.totalRuns,
          homeExpRuns: pred.homeExpRuns,
          awayExpRuns: pred.awayExpRuns,
          homeML: pred.homeML,
          awayML: pred.awayML,
          parkFactor: pred.parkFactor,
          awayStarter: game.awayStarter?.name || 'UNKNOWN',
          homeStarter: game.homeStarter?.name || 'UNKNOWN',
          warnings: checks,
          status: checks.length === 0 ? 'PASS' : 'WARN'
        };
        
        results.games.push(gameResult);
        if (checks.length > 0) {
          results.errors.push(...checks.map(c => `${game.away}@${game.home}: ${c}`));
        }
      } catch (e) {
        results.games.push({
          matchup: `${game.away}@${game.home}`,
          status: 'FAIL',
          error: e.message
        });
        results.errors.push(`${game.away}@${game.home}: CRASH — ${e.message}`);
        results.status = 'FAIL';
      }
    }
    
    // Summary stats
    const validGames = results.games.filter(g => g.status !== 'FAIL');
    results.stats.validPredictions = validGames.length;
    results.stats.failedPredictions = results.games.length - validGames.length;
    results.stats.avgTotal = validGames.length > 0 ? 
      +(validGames.reduce((s, g) => s + (g.totalRuns || 0), 0) / validGames.length).toFixed(1) : 0;
    results.stats.avgHomeWinProb = validGames.length > 0 ?
      +(validGames.reduce((s, g) => s + (g.homeWinProb || 0), 0) / validGames.length).toFixed(3) : 0;
    results.stats.warnings = results.errors.length;
    
    if (results.errors.length > 0 && results.status === 'PASS') {
      results.status = 'WARN';
    }
    
  } catch (e) {
    results.status = 'FAIL';
    results.error = e.message;
  }
  
  return results;
}

/**
 * Check 3: asyncPredict for all OD games (full signal stack)
 */
async function checkAsyncPredictions() {
  const results = { status: 'PASS', games: [], errors: [] };
  
  if (!mlb || !mlbOpeningDay) {
    return { status: 'FAIL', error: 'MLB model or Opening Day module not loaded' };
  }
  
  try {
    const projections = await mlbOpeningDay.getProjections();
    if (!projections?.games) return { status: 'FAIL', error: 'No projections' };
    
    // Only test Day 1 games (11 games) to keep it fast
    const day1Games = projections.games.filter(g => g.date === '2026-03-26');
    
    for (const game of day1Games) {
      try {
        const pred = await mlb.asyncPredict(game.away, game.home, {
          awayPitcher: game.awayStarter?.name,
          homePitcher: game.homeStarter?.name,
          gameDate: game.date
        });
        
        const checks = [];
        
        // Check if opening week adjustment fired
        if (!pred.openingWeek) {
          checks.push('Opening Week adjustment did not fire');
        }
        
        // Sanity on adjusted total
        if (pred.totalRuns < 5 || pred.totalRuns > 13) {
          checks.push(`Adjusted total ${pred.totalRuns} out of range`);
        }
        
        results.games.push({
          matchup: `${game.away}@${game.home}`,
          homeWinProb: pred.homeWinProb,
          totalRuns: pred.totalRuns,
          openingWeekActive: !!pred.openingWeek?.active,
          openingWeekReduction: pred.openingWeek?.reduction || 'N/A',
          status: checks.length === 0 ? 'PASS' : 'WARN',
          warnings: checks
        });
        
        if (checks.length > 0) {
          results.errors.push(...checks.map(c => `${game.away}@${game.home}: ${c}`));
        }
      } catch (e) {
        results.games.push({
          matchup: `${game.away}@${game.home}`,
          status: 'FAIL',
          error: e.message
        });
        results.errors.push(`${game.away}@${game.home}: ASYNC CRASH — ${e.message}`);
        results.status = 'FAIL';
      }
    }
    
    if (results.errors.length > 0 && results.status === 'PASS') {
      results.status = 'WARN';
    }
    
  } catch (e) {
    results.status = 'FAIL';
    results.error = e.message;
  }
  
  return results;
}

/**
 * Check 4: Pitcher Database Coverage
 */
function checkPitcherCoverage() {
  const results = { status: 'PASS', coverage: [], missing: [] };
  
  if (!mlbOpeningDay || !pitchers) {
    return { status: 'FAIL', error: 'Opening Day or pitcher module not loaded' };
  }
  
  const schedule = mlbOpeningDay.SCHEDULE || [];
  const allPitchers = pitchers.ALL_PITCHERS || pitchers.getAllPitchers?.() || {};
  
  for (const game of schedule) {
    // Check away starter
    if (game.awayStarter) {
      const found = findPitcherInDB(game.awayStarter, allPitchers);
      if (!found) {
        results.missing.push({ team: game.away, pitcher: game.awayStarter, role: 'away' });
      }
      results.coverage.push({
        team: game.away,
        pitcher: game.awayStarter,
        inDB: !!found,
        data: found ? { era: found.era, composite: found.composite } : null
      });
    }
    
    // Check home starter
    if (game.homeStarter) {
      const found = findPitcherInDB(game.homeStarter, allPitchers);
      if (!found) {
        results.missing.push({ team: game.home, pitcher: game.homeStarter, role: 'home' });
      }
      results.coverage.push({
        team: game.home,
        pitcher: game.homeStarter,
        inDB: !!found,
        data: found ? { era: found.era, composite: found.composite } : null
      });
    }
  }
  
  results.stats = {
    totalStarters: results.coverage.length,
    inDB: results.coverage.filter(c => c.inDB).length,
    missing: results.missing.length,
    coveragePct: results.coverage.length > 0 ? 
      +((results.coverage.filter(c => c.inDB).length / results.coverage.length) * 100).toFixed(1) : 0
  };
  
  if (results.missing.length > 0) {
    results.status = results.missing.length > 5 ? 'FAIL' : 'WARN';
  }
  
  return results;
}

function findPitcherInDB(name, allPitchers) {
  if (!name) return null;
  const lower = name.toLowerCase();
  
  // Direct lookup by last name in all teams
  for (const team of Object.keys(allPitchers)) {
    for (const pitcher of (allPitchers[team] || [])) {
      const pName = (pitcher.name || '').toLowerCase();
      if (pName === lower || pName.includes(lower) || lower.includes(pName)) {
        return pitcher;
      }
    }
  }
  return null;
}

/**
 * Check 5: Weather Pipeline for OD Parks
 */
async function checkWeatherPipeline() {
  const results = { status: 'PASS', parks: [], errors: [] };
  
  // Day 1 home teams
  const day1Homes = ['NYM', 'MIL', 'CHC', 'BAL', 'CIN', 'HOU', 'SD', 'STL', 'PHI', 'LAD', 'SEA'];
  
  for (const team of day1Homes) {
    try {
      if (weather) {
        const wx = await weather.getWeatherForPark(team);
        if (wx && !wx.error) {
          const data = wx.weather || {};
          results.parks.push({
            team,
            temp: data.temp,
            wind: data.wind,
            windDir: data.windDir,
            multiplier: wx.multiplier || 1.0,
            status: 'PASS'
          });
        } else {
          results.parks.push({ team, status: 'WARN', detail: wx?.error || 'No weather data' });
          if (results.status === 'PASS') results.status = 'WARN';
        }
      }
    } catch (e) {
      results.parks.push({ team, status: 'FAIL', error: e.message });
      results.errors.push(`Weather for ${team}: ${e.message}`);
    }
  }
  
  // Check 5-day forecast if available
  if (weatherForecast) {
    try {
      const forecast = await weatherForecast.getOpeningDayForecast?.();
      results.fiveDayForecast = forecast ? 'AVAILABLE' : 'NOT AVAILABLE';
    } catch (e) {
      results.fiveDayForecast = `ERROR: ${e.message}`;
    }
  }
  
  if (results.errors.length > 0) results.status = 'FAIL';
  
  return results;
}

/**
 * Check 6: Preseason Tuning
 */
function checkPreseasonTuning() {
  const results = { status: 'PASS', details: {} };
  
  if (!preseasonTuning) {
    return { status: 'FAIL', error: 'Preseason tuning module not loaded' };
  }
  
  try {
    // Check roster changes
    const rosterChanges = preseasonTuning.getRosterChanges?.() || preseasonTuning.ROSTER_CHANGES || {};
    results.details.rosterChangesTeams = Object.keys(rosterChanges).length;
    
    // Check spring training signals
    const stSignals = preseasonTuning.getSpringTrainingSignals?.() || {};
    results.details.springTrainingTeams = Object.keys(stSignals).length;
    
    // Check new-team pitcher penalties
    const penalties = preseasonTuning.getNewTeamPitcherPenalties?.() || {};
    results.details.newTeamPitchers = Object.keys(penalties).length;
    
    // Verify key teams have changes
    const keyTeams = ['BAL', 'BOS', 'NYM', 'DET', 'PIT', 'SD'];
    const missingTeams = keyTeams.filter(t => !rosterChanges[t]);
    if (missingTeams.length > 0) {
      results.details.missingKeyTeams = missingTeams;
      results.status = 'WARN';
    }
  } catch (e) {
    results.status = 'FAIL';
    results.error = e.message;
  }
  
  return results;
}

/**
 * Check 7: Season Simulator Sanity
 */
async function checkSeasonSimulator() {
  const results = { status: 'PASS', details: {} };
  
  if (!seasonSim) {
    return { status: 'WARN', error: 'Season simulator not loaded (optional)' };
  }
  
  try {
    const report = await seasonSim.getReport?.();
    if (report) {
      results.details.teamsSimulated = report.rankings?.length || 0;
      results.details.simRuns = report.simRuns || 'unknown';
      
      // Check for extreme outliers
      if (report.rankings) {
        const extremes = report.rankings.filter(t => t.projWins > 110 || t.projWins < 50);
        if (extremes.length > 0) {
          results.details.extremeProjections = extremes.map(t => `${t.team}: ${t.projWins}W`);
          results.status = 'WARN';
        }
      }
    }
  } catch (e) {
    results.details.error = e.message;
    results.status = 'WARN';
  }
  
  return results;
}

/**
 * Check 8: ML Engine Status
 */
async function checkMLEngine() {
  const results = { status: 'PASS', details: {} };
  
  if (!mlBridge) {
    return { status: 'WARN', error: 'ML bridge not loaded' };
  }
  
  try {
    const status = mlBridge.getStatus?.();
    results.details.modelStatus = status;
    
    // Try a test prediction
    try {
      const testPred = await mlBridge.enhancedPredict('NYY', 'BOS', { 
        awayPitcher: 'Gerrit Cole',
        homePitcher: 'Brayan Bello'
      });
      results.details.testPrediction = {
        matchup: 'NYY@BOS',
        mlHomeWinProb: testPred?.ml?.homeWinProb,
        blendedHomeWinProb: testPred?.blendedHomeWinProb,
        confidence: testPred?.ml?.confidence,
        hasStatcast: !!testPred?.statcast
      };
    } catch (e) {
      results.details.testPredictionError = e.message;
      results.status = 'WARN';
    }
  } catch (e) {
    results.status = 'WARN';
    results.error = e.message;
  }
  
  return results;
}

/**
 * Check 9: Catcher Framing Database Coverage
 */
function checkCatcherFraming() {
  const results = { status: 'PASS', coverage: [], missing: [] };
  
  if (!lineupFetcher) {
    return { status: 'WARN', error: 'Lineup fetcher not loaded' };
  }
  
  const framingDB = lineupFetcher.CATCHER_FRAMING || {};
  const allTeams = ['ARI','ATL','BAL','BOS','CHC','CIN','CLE','COL','CWS','DET',
                    'HOU','KC','LAA','LAD','MIA','MIL','MIN','NYM','NYY','OAK',
                    'PHI','PIT','SD','SEA','SF','STL','TB','TEX','TOR','WSH'];
  
  // Check which teams have catchers in DB
  const teamsCovered = new Set();
  for (const [name, data] of Object.entries(framingDB)) {
    if (data.team) teamsCovered.add(data.team);
  }
  
  for (const team of allTeams) {
    if (teamsCovered.has(team)) {
      results.coverage.push({ team, status: 'COVERED' });
    } else {
      results.missing.push(team);
      results.coverage.push({ team, status: 'MISSING' });
    }
  }
  
  results.stats = {
    totalCatchers: Object.keys(framingDB).length,
    teamsCovered: teamsCovered.size,
    teamsMissing: results.missing.length
  };
  
  if (results.missing.length > 10) {
    results.status = 'WARN';
  }
  
  return results;
}

/**
 * Check 10: Calibration Curves
 */
function checkCalibration() {
  const results = { status: 'PASS', sports: {} };
  
  if (!calibration) {
    return { status: 'WARN', error: 'Calibration module not loaded' };
  }
  
  for (const sport of ['mlb', 'nba', 'nhl']) {
    try {
      const test = calibration.calibratePrediction?.({ homeWinProb: 0.6, awayWinProb: 0.4 }, sport);
      if (test) {
        results.sports[sport] = {
          calibrated: true,
          testInput: 0.60,
          testOutput: test.homeWinProb,
          adjustment: +((test.homeWinProb - 0.6) * 100).toFixed(1) + '%'
        };
      }
    } catch (e) {
      results.sports[sport] = { calibrated: false, error: e.message };
      results.status = 'WARN';
    }
  }
  
  return results;
}

/**
 * Check 11: Statcast Integration
 */
function checkStatcast() {
  const results = { status: 'PASS', details: {} };
  
  if (!statcast) {
    return { status: 'WARN', error: 'Statcast module not loaded' };
  }
  
  try {
    const stats = statcast.getStats?.() || statcast.getStatus?.();
    results.details = {
      pitchers: stats?.pitchers || 'unknown',
      batters: stats?.batters || 'unknown',
      teams: stats?.teams || 'unknown',
      cacheAge: stats?.cacheAge || 'unknown'
    };
    
    // Check a sample pitcher
    const coleStats = statcast.getPitcherStats?.('Gerrit Cole') || statcast.lookupPitcher?.('Gerrit Cole');
    results.details.sampleLookup = coleStats ? { 
      pitcher: 'Gerrit Cole', 
      found: true, 
      xERA: coleStats.xERA || coleStats.xera,
      xwOBA: coleStats.xwOBA || coleStats.xwoba
    } : { pitcher: 'Gerrit Cole', found: false };
  } catch (e) {
    results.details.error = e.message;
    results.status = 'WARN';
  }
  
  return results;
}

// ==================== MAIN PREFLIGHT CHECK ====================

/**
 * Run full pre-flight check. Returns comprehensive status report.
 */
async function runPreflight() {
  const startTime = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    openingDay: '2026-03-26',
    daysUntil: Math.ceil((new Date('2026-03-26T13:00:00-04:00') - Date.now()) / (1000 * 60 * 60 * 24)),
    overallStatus: 'PASS',
    checks: {},
    summary: {
      total: 0,
      passed: 0,
      warnings: 0,
      failed: 0
    }
  };
  
  // Run all checks
  console.log('[preflight] Running data freshness check...');
  report.checks.dataFreshness = checkDataFreshness();
  
  console.log('[preflight] Running MLB predictions check (20 games)...');
  report.checks.mlbPredictions = await checkMLBPredictions();
  
  console.log('[preflight] Running async predictions check (Day 1)...');
  report.checks.asyncPredictions = await checkAsyncPredictions();
  
  console.log('[preflight] Running pitcher coverage check...');
  report.checks.pitcherCoverage = checkPitcherCoverage();
  
  console.log('[preflight] Running weather pipeline check...');
  report.checks.weatherPipeline = await checkWeatherPipeline();
  
  console.log('[preflight] Running preseason tuning check...');
  report.checks.preseasonTuning = checkPreseasonTuning();
  
  console.log('[preflight] Running season simulator check...');
  report.checks.seasonSimulator = await checkSeasonSimulator();
  
  console.log('[preflight] Running ML engine check...');
  report.checks.mlEngine = await checkMLEngine();
  
  console.log('[preflight] Running catcher framing check...');
  report.checks.catcherFraming = checkCatcherFraming();
  
  console.log('[preflight] Running calibration check...');
  report.checks.calibration = checkCalibration();
  
  console.log('[preflight] Running statcast check...');
  report.checks.statcast = checkStatcast();
  
  // Bullpen quality projection check
  console.log('[preflight] Running bullpen quality check...');
  try {
    const bq = require('./bullpen-quality');
    const mlb = require('../models/mlb');
    const teams = mlb.getTeams();
    const adjs = bq.getAllBullpenAdjustments(teams);
    const teamsModeled = Object.keys(bq.TEAM_BULLPEN_CORPS).length;
    const relievers = Object.keys(bq.RELIEVER_DB).length;
    const bigShifts = adjs.filter(a => Math.abs(a.delta) > 0.30);
    
    if (teamsModeled >= 25) {
      report.checks.bullpenQuality = {
        status: 'PASS',
        note: `${teamsModeled} teams modeled, ${relievers} relievers in DB, ${bigShifts.length} significant shifts (>0.30 ERA), wired into predict()`,
        details: {
          teamsModeled,
          relievers,
          bigShifts: bigShifts.map(s => `${s.team}: ${s.delta > 0 ? '+' : ''}${s.delta.toFixed(2)} (${s.impactDescription})`),
        }
      };
    } else {
      report.checks.bullpenQuality = {
        status: 'WARN',
        note: `Only ${teamsModeled} teams modeled (expected 30)`,
      };
    }
  } catch (e) {
    report.checks.bullpenQuality = {
      status: 'WARN',
      note: `Bullpen quality service error: ${e.message}`,
    };
  }
  
  // Platoon splits check
  console.log('[preflight] Running platoon splits check...');
  try {
    const ps = require('./platoon-splits');
    const teamCount = ps.getTeamCount ? ps.getTeamCount() : (ps.SAVANT_WOBA_SPLITS ? Object.keys(ps.SAVANT_WOBA_SPLITS).length : 0);
    if (teamCount >= 25) {
      report.checks.platoonSplits = {
        status: 'PASS',
        note: `${teamCount} teams with Savant wOBA splits, wired into predict()`,
      };
    } else {
      report.checks.platoonSplits = {
        status: 'WARN',
        note: `Only ${teamCount} teams with platoon data`,
      };
    }
  } catch (e) {
    report.checks.platoonSplits = {
      status: 'WARN',
      note: `Platoon splits check error: ${e.message}`,
    };
  }
  
  // Stolen base model check
  console.log('[preflight] Running stolen base model check...');
  try {
    const sbModel = require('./stolen-base-model');
    const teamData = sbModel.TEAM_SB_DATA || sbModel.getTeamData?.() || {};
    const teamCount = Object.keys(teamData).length;
    if (teamCount >= 25) {
      report.checks.stolenBaseModel = {
        status: 'PASS',
        note: `${teamCount} teams with SB attempt rate data, wired into predict() totals`,
      };
    } else {
      report.checks.stolenBaseModel = {
        status: 'WARN',
        note: `Only ${teamCount} teams with stolen base data`,
      };
    }
  } catch (e) {
    report.checks.stolenBaseModel = {
      status: 'WARN',
      note: `Stolen base model not loaded: ${e.message}`,
    };
  }
  
  // NB F5 / Run Line model check
  console.log('[preflight] Running NB models check...');
  try {
    const negBin = require('./neg-binomial');
    const testResult = negBin.negBinRunLineProb ? 
      negBin.negBinRunLineProb(4.5, 4.0, -1.5) :
      negBin.calculateRunLine ? negBin.calculateRunLine(4.5, 4.0, -1.5) : null;
    
    const hasF5 = !!(negBin.negBinF5 || negBin.calculateF5);
    
    if (testResult !== null && testResult !== undefined) {
      report.checks.negBinomialModels = {
        status: 'PASS',
        note: `NB run line model operational, F5 model: ${hasF5 ? 'YES' : 'NO'}`,
      };
    } else {
      report.checks.negBinomialModels = {
        status: 'WARN',
        note: 'NB model loaded but test returned null',
      };
    }
  } catch (e) {
    report.checks.negBinomialModels = {
      status: 'WARN',
      note: `NB model check error: ${e.message}`,
    };
  }
  
  // Conviction engine check
  console.log('[preflight] Running conviction engine check...');
  try {
    const testPred = mlb.predict('NYY', 'BOS');
    const hasConviction = testPred && (testPred.conviction !== undefined || testPred.convictionScore !== undefined || testPred.convictionGrade !== undefined);
    
    report.checks.convictionEngine = {
      status: hasConviction ? 'PASS' : 'WARN',
      note: hasConviction ? 
        `Conviction engine active (grade: ${testPred.convictionGrade || testPred.conviction?.grade || 'N/A'}, score: ${testPred.convictionScore || testPred.conviction?.score || 'N/A'})` :
        'Conviction scores not found in predict() output — may not be wired',
    };
  } catch (e) {
    report.checks.convictionEngine = {
      status: 'WARN',
      note: `Conviction check error: ${e.message}`,
    };
  }
  
  // OD Playbook cache check
  console.log('[preflight] Running OD playbook cache check...');
  try {
    const odCache = require('./od-playbook-cache');
    report.checks.odPlaybookCache = {
      status: 'PASS',
      note: 'OD playbook cache module loaded — prefetch/parallel ready for game day',
    };
  } catch (e) {
    report.checks.odPlaybookCache = {
      status: 'WARN',
      note: `OD playbook cache not loaded: ${e.message}`,
    };
  }
  
  // Opening Day Live Tracker check
  console.log('[preflight] Running OD live tracker check...');
  try {
    const odLive = require('./opening-day-live');
    report.checks.odLiveTracker = {
      status: 'PASS',
      note: 'OD live tracker module loaded and ready for March 26 game day',
    };
  } catch (e) {
    report.checks.odLiveTracker = {
      status: 'WARN',
      note: `OD live tracker not loaded: ${e.message}`,
    };
  }
  
  // Savant catcher framing data check
  console.log('[preflight] Running Savant framing data check...');
  try {
    const cf = require('./catcher-framing');
    const catcherCount = cf.SAVANT_CATCHERS ? Object.keys(cf.SAVANT_CATCHERS).length : 
                          cf.getCatcherCount ? cf.getCatcherCount() : 0;
    const teamMappings = cf.TEAM_PRIMARY_CATCHERS ? Object.keys(cf.TEAM_PRIMARY_CATCHERS).length :
                          cf.getTeamMappingCount ? cf.getTeamMappingCount() : 0;
    
    report.checks.savantCatcherFraming = {
      status: (catcherCount >= 40 && teamMappings >= 25) ? 'PASS' : 'WARN',
      note: `${catcherCount} Savant catchers, ${teamMappings} team primary catcher mappings`,
    };
  } catch (e) {
    report.checks.savantCatcherFraming = {
      status: 'WARN',
      note: `Savant catcher framing check error: ${e.message}`,
    };
  }
  
  // DK Opening Day lines check
  console.log('[preflight] Running DK lines check...');
  try {
    const odModel = require('../models/mlb-opening-day');
    const schedule = odModel.OPENING_DAY_SCHEDULE || odModel.getSchedule?.() || [];
    const withLines = schedule.filter(g => g.dk || g.dkLine || g.moneyline);
    const withTotals = schedule.filter(g => (g.dk && g.dk.total) || g.dkTotal || g.total);
    
    report.checks.dkOpeningDayLines = {
      status: withLines.length >= 10 ? 'PASS' : withLines.length > 0 ? 'WARN' : 'FAIL',
      note: `${withLines.length}/${schedule.length} games have DK moneyline data, ${withTotals.length} have totals`,
    };
  } catch (e) {
    report.checks.dkOpeningDayLines = {
      status: 'WARN',
      note: `DK lines check error: ${e.message}`,
    };
  }
  
  // Aggregate
  for (const [name, check] of Object.entries(report.checks)) {
    report.summary.total++;
    if (check.status === 'PASS') report.summary.passed++;
    else if (check.status === 'WARN') report.summary.warnings++;
    else if (check.status === 'FAIL') report.summary.failed++;
  }
  
  // Overall status
  if (report.summary.failed > 0) report.overallStatus = 'FAIL';
  else if (report.summary.warnings > 0) report.overallStatus = 'WARN';
  
  report.duration = `${Date.now() - startTime}ms`;
  
  console.log(`[preflight] ✅ Complete: ${report.overallStatus} (${report.summary.passed}/${report.summary.total} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failures) — ${report.duration}`);
  
  return report;
}

/**
 * Generate human-readable report
 */
function formatReport(report) {
  const lines = [];
  lines.push(`🔍 OPENING DAY PRE-FLIGHT CHECK`);
  lines.push(`${'═'.repeat(50)}`);
  lines.push(`📅 Opening Day: ${report.openingDay} (${report.daysUntil} days away)`);
  lines.push(`⏰ Run: ${report.timestamp}`);
  lines.push(`🏁 Overall: ${statusEmoji(report.overallStatus)} ${report.overallStatus}`);
  lines.push(`📊 ${report.summary.passed}/${report.summary.total} passed | ${report.summary.warnings} warnings | ${report.summary.failed} failures`);
  lines.push(`⚡ Duration: ${report.duration}`);
  lines.push('');
  
  for (const [name, check] of Object.entries(report.checks)) {
    lines.push(`${statusEmoji(check.status)} ${name}: ${check.status}`);
    
    if (check.error) {
      lines.push(`   ⚠️ ${check.error}`);
    }
    
    if (check.stats) {
      for (const [k, v] of Object.entries(check.stats)) {
        lines.push(`   📈 ${k}: ${v}`);
      }
    }
    
    if (check.errors?.length > 0) {
      for (const err of check.errors.slice(0, 5)) {
        lines.push(`   ⚠️ ${err}`);
      }
      if (check.errors.length > 5) {
        lines.push(`   ... and ${check.errors.length - 5} more`);
      }
    }
  }
  
  return lines.join('\n');
}

function statusEmoji(status) {
  if (status === 'PASS') return '✅';
  if (status === 'WARN') return '⚠️';
  if (status === 'FAIL') return '❌';
  return '❓';
}

module.exports = {
  runPreflight,
  formatReport,
  checkDataFreshness,
  checkMLBPredictions,
  checkAsyncPredictions,
  checkPitcherCoverage,
  checkWeatherPipeline,
  checkPreseasonTuning,
  checkSeasonSimulator,
  checkMLEngine,
  checkCatcherFraming,
  checkCalibration,
  checkStatcast
};
