// services/od-t2-verification.js — OD T-2 Comprehensive Verification v114.0
// =============================================================================
// T-2 DAYS TO OPENING DAY - CRITICAL PRE-GAME VALIDATION
//
// This is the last major verification pass before the March 25 final check.
// Validates ALL systems that need to work on March 26 game day.
//
// Runs:
//   1. ESPN pitcher sync — verify all 20 OD starters against live ESPN data
//   2. Weather 48h forecast pull — fresh forecasts for all OD venues
//   3. Model prediction validation — run predict() for every OD game
//   4. Betting card integrity — verify all 35 plays have valid edges
//   5. Signal stack completeness — check which signals are live vs pending
//   6. DK line freshness — detect any stale/missing lines
//   7. System readiness score — overall GO/NO-GO assessment

const fs = require('fs');
const path = require('path');

// Safe requires
let mlbOpeningDay = null;
let weatherForecast = null;
let odPitcherSync = null;
let mlbModel = null;
let odPlaybookCache = null;
let weatherService = null;
let pitcherDb = null;
let catcherFraming = null;
let platoonSplits = null;
let bullpenQuality = null;
let stolenBaseModel = null;
let negBinomial = null;

try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}
try { weatherForecast = require('./weather-forecast'); } catch(e) {}
try { odPitcherSync = require('./od-pitcher-sync'); } catch(e) {}
try { mlbModel = require('../models/mlb'); } catch(e) {}
try { odPlaybookCache = require('./od-playbook-cache'); } catch(e) {}
try { weatherService = require('./weather'); } catch(e) {}
try { pitcherDb = require('../models/mlb-pitchers'); } catch(e) {}
try { catcherFraming = require('./catcher-framing'); } catch(e) {}
try { platoonSplits = require('./platoon-splits'); } catch(e) {}
try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}
try { stolenBaseModel = require('./stolen-base-model'); } catch(e) {}
try { negBinomial = require('./neg-binomial'); } catch(e) {}

// ===== CONSTANTS =====
const OD_DAY1_DATE = '2026-03-26';
const OD_DAY2_DATE = '2026-03-27';

const DOME_PARKS = ['MIL', 'HOU', 'MIA', 'TOR', 'ARI', 'SEA', 'SD', 'LAD'];

// ===== 1. PITCHER VERIFICATION =====
async function verifyPitchers() {
  const results = { status: 'PASS', checks: [], changes: [], warnings: [] };
  
  try {
    const games = mlbOpeningDay ? (mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : mlbOpeningDay.OPENING_DAY_GAMES) : [];
    
    if (!games || games.length === 0) {
      results.status = 'FAIL';
      results.warnings.push('No OD games found in model');
      return results;
    }

    // Check each game has confirmed starters
    let gamesWithBothStarters = 0;
    let gamesWithTBD = 0;
    
    for (const game of games) {
      const cs = game.confirmedStarters || {};
      const awayPitcher = cs.away || 'TBD';
      const homePitcher = cs.home || 'TBD';
      
      const check = {
        game: `${game.away}@${game.home}`,
        day: game.day,
        awayPitcher,
        homePitcher,
        awayInDB: false,
        homeInDB: false,
        status: 'OK'
      };
      
      // Verify pitchers exist in our database
      if (pitcherDb) {
        const allPitchers = pitcherDb.ALL_PITCHERS || pitcherDb.PITCHERS || {};
        const pitcherNames = Object.values(allPitchers).flat().map(p => 
          typeof p === 'string' ? p : (p.name || p.pitcher || '')
        );
        
        // Try to find pitcher in DB (fuzzy match)
        check.awayInDB = awayPitcher !== 'TBD' && pitcherNames.some(name => 
          name.toLowerCase().includes(awayPitcher.split(' ').pop().toLowerCase())
        );
        check.homeInDB = homePitcher !== 'TBD' && pitcherNames.some(name => 
          name.toLowerCase().includes(homePitcher.split(' ').pop().toLowerCase())
        );
      }
      
      if (awayPitcher === 'TBD' || homePitcher === 'TBD') {
        check.status = 'TBD';
        gamesWithTBD++;
        results.warnings.push(`${check.game} D${game.day}: ${awayPitcher === 'TBD' ? game.away + ' starter TBD' : ''} ${homePitcher === 'TBD' ? game.home + ' starter TBD' : ''}`);
      } else {
        gamesWithBothStarters++;
      }
      
      if (awayPitcher !== 'TBD' && !check.awayInDB) {
        results.warnings.push(`${check.game}: ${awayPitcher} NOT FOUND in pitcher DB — using defaults`);
      }
      if (homePitcher !== 'TBD' && !check.homeInDB) {
        results.warnings.push(`${check.game}: ${homePitcher} NOT FOUND in pitcher DB — using defaults`);
      }
      
      results.checks.push(check);
    }
    
    results.summary = {
      totalGames: games.length,
      gamesWithBothStarters,
      gamesWithTBD,
      starterCoverage: `${gamesWithBothStarters}/${games.length}`
    };
    
    if (gamesWithTBD > 5) results.status = 'WARN';
    
    // Try ESPN pitcher sync if available
    if (odPitcherSync && odPitcherSync.syncPitchers) {
      try {
        const syncResult = await odPitcherSync.syncPitchers();
        results.espnSync = syncResult;
        if (syncResult && syncResult.changes && syncResult.changes.length > 0) {
          results.changes = syncResult.changes;
          results.status = 'WARN';
          results.warnings.push(`ESPN shows ${syncResult.changes.length} pitcher changes from our model`);
        }
      } catch (e) {
        results.espnSync = { error: e.message };
      }
    }
    
  } catch (e) {
    results.status = 'FAIL';
    results.warnings.push(`Pitcher verification error: ${e.message}`);
  }
  
  return results;
}

// ===== 2. WEATHER VERIFICATION =====
async function verifyWeather() {
  const results = { status: 'PASS', forecasts: [], warnings: [], postponementRisks: [] };
  
  try {
    const games = mlbOpeningDay ? (mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : mlbOpeningDay.OPENING_DAY_GAMES) : [];
    
    let outdoorGames = 0;
    let weatherAvailable = 0;
    let coldGames = [];
    let rainRisks = [];
    let windGames = [];
    
    for (const game of games) {
      const isDome = DOME_PARKS.includes(game.home);
      
      const forecast = {
        game: `${game.away}@${game.home}`,
        day: game.day,
        isDome,
        temp: null,
        wind: null,
        precip: null,
        humidity: null,
        impact: null,
        status: isDome ? 'DOME' : 'PENDING'
      };
      
      if (isDome) {
        forecast.temp = 72;
        forecast.wind = 0;
        forecast.precip = 0;
        forecast.status = 'DOME_OK';
      } else {
        outdoorGames++;
        
        // Try to get weather from forecast service
        if (weatherForecast && weatherForecast.getGameForecast) {
          try {
            const wx = await weatherForecast.getGameForecast(game.home, game.date || (game.day === 1 ? OD_DAY1_DATE : OD_DAY2_DATE));
            if (wx) {
              forecast.temp = wx.temp || wx.temperature;
              forecast.wind = wx.windSpeed || wx.wind;
              forecast.precip = wx.precipProbability || wx.precipProb || 0;
              forecast.humidity = wx.humidity;
              forecast.status = 'LIVE';
              weatherAvailable++;
              
              // Check thresholds
              if (forecast.temp && forecast.temp < 40) {
                coldGames.push({ game: forecast.game, temp: forecast.temp });
                results.warnings.push(`🥶 ${forecast.game}: EXTREME COLD ${forecast.temp}°F — affects totals`);
              }
              if (forecast.precip > 40) {
                rainRisks.push({ game: forecast.game, prob: forecast.precip });
                results.postponementRisks.push({ game: forecast.game, type: 'RAIN', probability: forecast.precip });
                results.warnings.push(`🌧️ ${forecast.game}: ${forecast.precip}% rain probability — postponement risk`);
              }
              if (forecast.wind && forecast.wind > 15) {
                windGames.push({ game: forecast.game, wind: forecast.wind });
                results.warnings.push(`💨 ${forecast.game}: ${forecast.wind}mph wind — totals impact`);
              }
            }
          } catch (e) {
            forecast.status = 'ERROR';
            forecast.error = e.message;
          }
        }
        
        // Fallback: try the main weather service
        if (forecast.status === 'PENDING' && weatherService) {
          try {
            const coords = weatherService.BALLPARK_COORDS ? weatherService.BALLPARK_COORDS[game.home] : null;
            if (coords) {
              forecast.status = 'COORDS_AVAILABLE';
              forecast.lat = coords.lat;
              forecast.lon = coords.lon;
            }
          } catch(e) {}
        }
      }
      
      results.forecasts.push(forecast);
    }
    
    results.summary = {
      totalGames: games.length,
      domeGames: games.length - outdoorGames,
      outdoorGames,
      weatherAvailable,
      coldGames: coldGames.length,
      rainRisks: rainRisks.length,
      windGames: windGames.length
    };
    
    if (rainRisks.length > 0) results.status = 'WARN';
    if (outdoorGames > 0 && weatherAvailable === 0) results.status = 'WARN';
    
  } catch (e) {
    results.status = 'FAIL';
    results.warnings.push(`Weather verification error: ${e.message}`);
  }
  
  return results;
}

// ===== 3. MODEL PREDICTION VALIDATION =====
async function verifyPredictions() {
  const results = { status: 'PASS', predictions: [], warnings: [], errors: [] };
  
  try {
    const games = mlbOpeningDay ? (mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : mlbOpeningDay.OPENING_DAY_GAMES) : [];
    const mlb = mlbModel || require('../models/mlb');
    
    let successCount = 0;
    let failCount = 0;
    let totalImpliedRuns = 0;
    
    for (const game of games) {
      try {
        const pred = mlb.predict(game.away, game.home);
        if (pred) {
          const prediction = {
            game: `${game.away}@${game.home}`,
            day: game.day,
            homeWinProb: pred.homeWinProb || pred.homeProb,
            awayWinProb: pred.awayWinProb || pred.awayProb,
            expectedTotal: pred.expectedTotal || pred.total,
            homeRuns: pred.homeExpectedRuns || pred.homeRuns,
            awayRuns: pred.awayExpectedRuns || pred.awayRuns,
            spread: pred.spread,
            pitchers: {
              away: game.confirmedStarters?.away || 'TBD',
              home: game.confirmedStarters?.home || 'TBD'
            },
            nbF5: pred.f5 ? 'YES' : 'NO',
            f7: pred.f7 ? 'YES' : 'NO',
            status: 'OK'
          };
          
          // Sanity checks
          const total = prediction.expectedTotal;
          if (total < 4 || total > 14) {
            prediction.status = 'SUSPECT';
            results.warnings.push(`${prediction.game}: total ${total?.toFixed(1)} outside normal range (4-14)`);
          }
          
          const prob = prediction.homeWinProb;
          if (prob && (prob < 0.2 || prob > 0.85)) {
            results.warnings.push(`${prediction.game}: home win prob ${(prob*100).toFixed(1)}% extreme`);
          }
          
          totalImpliedRuns += total || 0;
          successCount++;
          results.predictions.push(prediction);
        } else {
          failCount++;
          results.errors.push(`${game.away}@${game.home}: predict() returned null`);
        }
      } catch (e) {
        failCount++;
        results.errors.push(`${game.away}@${game.home}: ${e.message}`);
      }
    }
    
    results.summary = {
      totalGames: games.length,
      successCount,
      failCount,
      avgTotal: totalImpliedRuns / successCount,
      allPassed: failCount === 0
    };
    
    if (failCount > 0) results.status = 'FAIL';
    
  } catch (e) {
    results.status = 'FAIL';
    results.warnings.push(`Prediction validation error: ${e.message}`);
  }
  
  return results;
}

// ===== 4. BETTING CARD INTEGRITY =====
function verifyBettingCard() {
  const results = { status: 'PASS', warnings: [], cardStats: {} };
  
  try {
    if (!odPlaybookCache) {
      results.status = 'WARN';
      results.warnings.push('OD playbook cache not loaded');
      return results;
    }
    
    const cached = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
    
    if (!cached) {
      results.status = 'WARN';
      results.warnings.push('No cached playbook data — card will rebuild on next request');
      return results;
    }
    
    const plays = cached.allPlays || cached.plays || [];
    const smash = plays.filter(p => p.tier === 'SMASH' || p.conviction?.grade === 'A+' || p.conviction?.grade === 'A');
    const strong = plays.filter(p => p.tier === 'STRONG' || p.conviction?.grade === 'B+');
    const lean = plays.filter(p => p.tier === 'LEAN' || p.conviction?.grade === 'B');
    
    // Calculate total EV
    const totalEV = plays.reduce((sum, p) => sum + (p.ev || 0), 0);
    const totalWager = plays.reduce((sum, p) => sum + (p.wager || 0), 0);
    
    results.cardStats = {
      totalPlays: plays.length,
      smash: smash.length,
      strong: strong.length,
      lean: lean.length,
      totalEV: totalEV.toFixed(2),
      totalWager: totalWager.toFixed(2),
      roi: totalWager > 0 ? ((totalEV / totalWager) * 100).toFixed(1) + '%' : '0%',
      generatedAt: cached.generated || cached.timestamp || 'unknown'
    };
    
    // Check for issues
    if (plays.length === 0) {
      results.status = 'FAIL';
      results.warnings.push('Betting card has 0 plays!');
    }
    if (totalEV < 0) {
      results.status = 'FAIL';
      results.warnings.push('Negative total EV — model issue!');
    }
    
    // Check each play has required fields
    let missingFields = 0;
    for (const play of plays) {
      if (!play.game || !play.pick || !play.edge) {
        missingFields++;
      }
    }
    if (missingFields > 0) {
      results.warnings.push(`${missingFields} plays missing required fields`);
    }
    
    // Check for games with no plays (model says no edge = valid, but worth flagging)
    const gamesWithPlays = new Set(plays.map(p => p.game));
    const allGames = mlbOpeningDay ? (mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : mlbOpeningDay.OPENING_DAY_GAMES) : [];
    const gamesWithNoPlays = allGames.filter(g => !gamesWithPlays.has(`${g.away}@${g.home}`));
    if (gamesWithNoPlays.length > 0) {
      results.cardStats.gamesWithNoPlays = gamesWithNoPlays.map(g => `${g.away}@${g.home}`);
    }
    
  } catch (e) {
    results.status = 'FAIL';
    results.warnings.push(`Betting card verification error: ${e.message}`);
  }
  
  return results;
}

// ===== 5. SIGNAL STACK CHECK =====
function verifySignalStack() {
  const results = { status: 'PASS', signals: {}, warnings: [] };
  
  const signals = {
    pitcherDB: { loaded: false, count: 0 },
    catcherFraming: { loaded: false },
    platoonSplits: { loaded: false },
    bullpenQuality: { loaded: false },
    stolenBase: { loaded: false },
    negBinomial: { loaded: false },
    weatherService: { loaded: false },
    weatherForecast: { loaded: false },
    lineupBridge: { loaded: false },
    odPlaybookCache: { loaded: false },
    odPitcherSync: { loaded: false }
  };
  
  // Check each signal
  if (pitcherDb) {
    signals.pitcherDB.loaded = true;
    const allP = pitcherDb.ALL_PITCHERS || pitcherDb.PITCHERS || {};
    signals.pitcherDB.count = Object.values(allP).flat().length;
  }
  signals.catcherFraming.loaded = !!catcherFraming;
  signals.platoonSplits.loaded = !!platoonSplits;
  signals.bullpenQuality.loaded = !!bullpenQuality;
  signals.stolenBase.loaded = !!stolenBaseModel;
  signals.negBinomial.loaded = !!negBinomial;
  signals.weatherService.loaded = !!weatherService;
  signals.weatherForecast.loaded = !!weatherForecast;
  signals.odPlaybookCache.loaded = !!odPlaybookCache;
  signals.odPitcherSync.loaded = !!odPitcherSync;
  
  // Check lineup bridge
  try {
    const lb = require('./lineup-bridge');
    signals.lineupBridge.loaded = true;
  } catch(e) {
    signals.lineupBridge.loaded = false;
    results.warnings.push('Lineup bridge not loaded — game-day lineups will fail');
  }
  
  // Count loaded vs total
  const total = Object.keys(signals).length;
  const loaded = Object.values(signals).filter(s => s.loaded).length;
  
  results.signals = signals;
  results.summary = { loaded, total, pct: ((loaded/total)*100).toFixed(0) + '%' };
  
  if (loaded < total * 0.7) results.status = 'WARN';
  if (loaded < total * 0.5) results.status = 'FAIL';
  
  return results;
}

// ===== 6. DK LINES FRESHNESS =====
function verifyDKLines() {
  const results = { status: 'PASS', lines: [], warnings: [] };
  
  try {
    const games = mlbOpeningDay ? (mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : mlbOpeningDay.OPENING_DAY_GAMES) : [];
    
    let gamesWithLines = 0;
    let gamesWithoutLines = 0;
    
    for (const game of games) {
      const dk = game.dkLine || {};
      const line = {
        game: `${game.away}@${game.home}`,
        day: game.day,
        homeML: dk.homeML,
        awayML: dk.awayML,
        total: dk.total,
        hasML: !!(dk.homeML && dk.awayML),
        hasTotal: !!dk.total,
        status: 'OK'
      };
      
      if (!line.hasML && !line.hasTotal) {
        line.status = 'MISSING';
        gamesWithoutLines++;
        results.warnings.push(`${line.game} D${game.day}: NO DK LINES`);
      } else if (!line.hasTotal) {
        line.status = 'PARTIAL';
        results.warnings.push(`${line.game} D${game.day}: missing total`);
        gamesWithLines++;
      } else {
        gamesWithLines++;
      }
      
      // Sanity check line values
      if (line.total && (line.total < 5 || line.total > 13)) {
        results.warnings.push(`${line.game}: total ${line.total} looks unusual`);
      }
      
      results.lines.push(line);
    }
    
    results.summary = { 
      gamesWithLines, 
      gamesWithoutLines, 
      coverage: `${gamesWithLines}/${games.length}` 
    };
    
    if (gamesWithoutLines > 3) results.status = 'FAIL';
    else if (gamesWithoutLines > 0) results.status = 'WARN';
    
  } catch (e) {
    results.status = 'FAIL';
    results.warnings.push(`DK lines verification error: ${e.message}`);
  }
  
  return results;
}

// ===== 7. OVERALL READINESS SCORE =====
function calculateReadiness(pitchers, weather, predictions, bettingCard, signalStack, dkLines) {
  let score = 0;
  let maxScore = 0;
  const factors = [];
  
  // Pitcher verification (20 points)
  maxScore += 20;
  if (pitchers.status === 'PASS') { score += 20; factors.push('✅ Pitchers verified'); }
  else if (pitchers.status === 'WARN') { score += 12; factors.push('⚠️ Pitcher warnings'); }
  else { score += 0; factors.push('❌ Pitcher verification failed'); }
  
  // Weather (15 points)
  maxScore += 15;
  if (weather.status === 'PASS') { score += 15; factors.push('✅ Weather forecasts loaded'); }
  else if (weather.status === 'WARN') { score += 8; factors.push('⚠️ Weather warnings (rain/cold)'); }
  else { score += 0; factors.push('❌ Weather data missing'); }
  
  // Predictions (25 points — most critical)
  maxScore += 25;
  if (predictions.status === 'PASS') { score += 25; factors.push('✅ All predictions validated'); }
  else if (predictions.summary?.failCount <= 2) { score += 15; factors.push('⚠️ Some predictions failed'); }
  else { score += 0; factors.push('❌ Prediction engine broken'); }
  
  // Betting card (20 points)
  maxScore += 20;
  if (bettingCard.status === 'PASS') { score += 20; factors.push('✅ Betting card healthy'); }
  else if (bettingCard.status === 'WARN') { score += 12; factors.push('⚠️ Betting card warnings'); }
  else { score += 0; factors.push('❌ Betting card failed'); }
  
  // Signal stack (10 points)
  maxScore += 10;
  if (signalStack.status === 'PASS') { score += 10; factors.push('✅ All signals loaded'); }
  else if (signalStack.status === 'WARN') { score += 6; factors.push('⚠️ Some signals missing'); }
  else { score += 0; factors.push('❌ Signal stack critically incomplete'); }
  
  // DK lines (10 points)
  maxScore += 10;
  if (dkLines.status === 'PASS') { score += 10; factors.push('✅ DK lines complete'); }
  else if (dkLines.status === 'WARN') { score += 6; factors.push('⚠️ Some DK lines missing'); }
  else { score += 0; factors.push('❌ DK lines critically incomplete'); }
  
  const pct = Math.round((score / maxScore) * 100);
  let grade, verdict;
  
  if (pct >= 90) { grade = 'A'; verdict = '🟢 GO — Ready for Opening Day'; }
  else if (pct >= 75) { grade = 'B'; verdict = '🟡 CONDITIONAL GO — Minor issues to address'; }
  else if (pct >= 60) { grade = 'C'; verdict = '🟠 CAUTION — Significant gaps to fix'; }
  else { grade = 'F'; verdict = '🔴 NO-GO — Critical systems failing'; }
  
  return { score, maxScore, pct, grade, verdict, factors };
}

// ===== MAIN VERIFICATION RUNNER =====
async function runVerification() {
  console.log('🔍 [OD T-2] Starting comprehensive verification...');
  const startTime = Date.now();
  
  const [pitchers, weather, predictions] = await Promise.all([
    verifyPitchers(),
    verifyWeather(),
    verifyPredictions()
  ]);
  
  const bettingCard = verifyBettingCard();
  const signalStack = verifySignalStack();
  const dkLines = verifyDKLines();
  
  const readiness = calculateReadiness(pitchers, weather, predictions, bettingCard, signalStack, dkLines);
  
  const elapsed = Date.now() - startTime;
  
  const report = {
    title: '🦞 OD T-2 VERIFICATION REPORT',
    timestamp: new Date().toISOString(),
    countdown: { 
      daysToOD1: 2,
      daysToOD2: 3,
      od1Date: OD_DAY1_DATE,
      od2Date: OD_DAY2_DATE
    },
    readiness,
    sections: {
      pitchers,
      weather,
      predictions,
      bettingCard,
      signalStack,
      dkLines
    },
    allWarnings: [
      ...pitchers.warnings,
      ...weather.warnings,
      ...predictions.warnings,
      ...bettingCard.warnings,
      ...signalStack.warnings,
      ...dkLines.warnings
    ],
    elapsedMs: elapsed,
    actionItems: generateActionItems(pitchers, weather, predictions, bettingCard, signalStack, dkLines)
  };
  
  console.log(`✅ [OD T-2] Verification complete in ${elapsed}ms — Grade: ${readiness.grade} (${readiness.pct}%)`);
  
  return report;
}

function generateActionItems(pitchers, weather, predictions, bettingCard, signalStack, dkLines) {
  const items = [];
  
  // Critical items
  if (predictions.status === 'FAIL') {
    items.push({ priority: 'P0', action: 'Fix prediction engine — games failing predict()' });
  }
  if (bettingCard.status === 'FAIL') {
    items.push({ priority: 'P0', action: 'Fix betting card — 0 plays or negative EV' });
  }
  
  // Important items
  if (pitchers.changes && pitchers.changes.length > 0) {
    items.push({ priority: 'P0', action: `Review ${pitchers.changes.length} pitcher changes from ESPN` });
  }
  if (weather.postponementRisks && weather.postponementRisks.length > 0) {
    items.push({ priority: 'P1', action: `Monitor ${weather.postponementRisks.length} games with rain risk` });
  }
  if (dkLines.summary && dkLines.summary.gamesWithoutLines > 0) {
    items.push({ priority: 'P1', action: `Add DK lines for ${dkLines.summary.gamesWithoutLines} games` });
  }
  
  // Pre-game day items (always include these)
  items.push({ priority: 'P1', action: 'March 25 PM: Pull 24h weather forecasts for all outdoor venues' });
  items.push({ priority: 'P1', action: 'March 26 AM: Verify lineups posted on ESPN/MLB Stats API' });
  items.push({ priority: 'P1', action: 'March 26 AM: Confirm umpire crew assignments' });
  items.push({ priority: 'P2', action: 'March 26 AM: Pull live odds from The Odds API and update edges' });
  items.push({ priority: 'P2', action: 'March 26: Monitor for last-minute pitcher changes' });
  
  return items;
}

// ===== EXPORTS =====
module.exports = {
  runVerification,
  verifyPitchers,
  verifyWeather,
  verifyPredictions,
  verifyBettingCard,
  verifySignalStack,
  verifyDKLines,
  calculateReadiness
};
