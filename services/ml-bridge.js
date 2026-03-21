/**
 * ML Bridge — Node.js ↔ Python ML Engine — SportsSim v21.0
 * 
 * Calls Python ML engine via child_process for:
 *   - Training ensemble models from historical data
 *   - Getting calibrated ML probabilities for games
 *   - Running proper backtests with rolling windows
 * 
 * The bridge extracts features from our existing services (teams, pitchers, 
 * rolling stats, injuries) and sends them to Python for ML processing.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_SCRIPT = path.join(__dirname, 'ml-engine.py');
const PYTHON_BIN = '/usr/bin/python3';

// Service imports (optional — graceful degradation)
let mlb, pitchers, rollingStats, injuryService;
try { mlb = require('../models/mlb'); } catch (e) {}
try { pitchers = require('../models/mlb-pitchers'); } catch (e) {}
try { rollingStats = require('../services/rolling-stats'); } catch (e) {}
try { injuryService = require('../services/injuries'); } catch (e) {}

// Backtest data
let backtestGames;
try { backtestGames = require('../models/backtest-mlb').GAMES; } catch (e) { backtestGames = []; }

// ==================== PYTHON COMMUNICATION ====================

/**
 * Call Python ML engine with JSON input, get JSON output.
 * Uses child_process.spawn for reliability.
 */
function callPython(inputData, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python ML engine exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start Python: ${err.message}`));
    });

    // Send input and close stdin
    proc.stdin.write(JSON.stringify(inputData));
    proc.stdin.end();
  });
}

// ==================== FEATURE EXTRACTION ====================

/**
 * Build feature dict for a game from our existing data sources.
 * This bridges our Node.js models with the Python ML engine.
 */
function extractGameFeatures(awayAbbr, homeAbbr, opts = {}) {
  const teams = mlb ? mlb.getTeams() : {};
  const away = teams[awayAbbr];
  const home = teams[homeAbbr];
  
  if (!away || !home) return null;
  
  const features = {
    away: awayAbbr,
    home: homeAbbr,
    // Team stats
    awayRsG: away.rsG,
    homeRsG: home.rsG,
    awayRaG: away.raG,
    homeRaG: home.raG,
    awayW: away.w,
    awayL: away.l,
    homeW: home.w,
    homeL: home.l,
    awayEra: away.era,
    homeEra: home.era,
    awayFip: away.fip || away.era,
    homeFip: home.fip || home.era,
    awayWhip: away.whip,
    homeWhip: home.whip,
    awayOps: away.ops,
    homeOps: home.ops,
    awayBullpenEra: away.bullpenEra,
    homeBullpenEra: home.bullpenEra,
    awayK9: away.k9,
    homeK9: home.k9,
    parkFactor: mlb.PARK_FACTORS[home.park] || 1.0,
  };
  
  // Starting pitchers
  if (opts.awayPitcher) {
    const p = typeof opts.awayPitcher === 'string' 
      ? (pitchers ? pitchers.getPitcherByName(opts.awayPitcher) : null)
      : opts.awayPitcher;
    if (p) {
      features.awayPitcherRating = p.rating || 50;
      features.awayPitcherEra = p.era || away.era;
      features.awayPitcherFip = p.fip || p.era || away.fip;
      features.awayPitcherHand = p.hand || 'R';
    }
  }
  if (opts.homePitcher) {
    const p = typeof opts.homePitcher === 'string'
      ? (pitchers ? pitchers.getPitcherByName(opts.homePitcher) : null)
      : opts.homePitcher;
    if (p) {
      features.homePitcherRating = p.rating || 50;
      features.homePitcherEra = p.era || home.era;
      features.homePitcherFip = p.fip || p.era || home.fip;
      features.homePitcherHand = p.hand || 'R';
    }
  }
  
  // Rolling stats
  if (rollingStats) {
    const awayRoll = rollingStats.getRollingAdjustment('mlb', awayAbbr);
    const homeRoll = rollingStats.getRollingAdjustment('mlb', homeAbbr);
    features.awayRollingAdj = awayRoll?.adjFactor || 0;
    features.homeRollingAdj = homeRoll?.adjFactor || 0;
  }
  
  // Injuries
  if (injuryService) {
    const awayInj = injuryService.getInjuryAdjustment('mlb', awayAbbr);
    const homeInj = injuryService.getInjuryAdjustment('mlb', homeAbbr);
    features.awayInjuryAdj = awayInj?.adjFactor || 0;
    features.homeInjuryAdj = homeInj?.adjFactor || 0;
  }
  
  return features;
}

/**
 * Convert backtest game array to feature dicts for training.
 * Backtest format: [away, home, awayScore, homeScore, closingHomeML]
 */
function backtestToTrainingData(games) {
  if (!games || !mlb) return [];
  
  const teams = mlb.getTeams();
  const data = [];
  
  for (const [away, home, awayScore, homeScore, closingHomeML] of games) {
    const awayTeam = teams[away];
    const homeTeam = teams[home];
    if (!awayTeam || !homeTeam) continue;
    
    data.push({
      away,
      home,
      homeWon: homeScore > awayScore,
      awayScore,
      homeScore,
      actualTotal: awayScore + homeScore,
      closingHomeML,
      bookTotal: 8.5, // approximate for backtest; real data would have this
      // Team features
      awayRsG: awayTeam.rsG,
      homeRsG: homeTeam.rsG,
      awayRaG: awayTeam.raG,
      homeRaG: homeTeam.raG,
      awayW: awayTeam.w,
      awayL: awayTeam.l,
      homeW: homeTeam.w,
      homeL: homeTeam.l,
      awayEra: awayTeam.era,
      homeEra: homeTeam.era,
      awayFip: awayTeam.fip || awayTeam.era,
      homeFip: homeTeam.fip || homeTeam.era,
      awayWhip: awayTeam.whip,
      homeWhip: homeTeam.whip,
      awayOps: awayTeam.ops,
      homeOps: homeTeam.ops,
      awayBullpenEra: awayTeam.bullpenEra,
      homeBullpenEra: homeTeam.bullpenEra,
      awayK9: awayTeam.k9,
      homeK9: homeTeam.k9,
      parkFactor: mlb.PARK_FACTORS[homeTeam.park] || 1.0,
      // Default pitcher values (backtest doesn't have specific starters)
      awayPitcherRating: 50,
      homePitcherRating: 50,
      awayPitcherEra: awayTeam.era,
      homePitcherEra: homeTeam.era,
      awayPitcherFip: awayTeam.fip || awayTeam.era,
      homePitcherFip: homeTeam.fip || homeTeam.era,
      awayPitcherHand: 'R',
      homePitcherHand: 'R',
    });
  }
  
  return data;
}

// ==================== PUBLIC API ====================

/**
 * Train ML model from our backtest data.
 * Returns training metrics and model info.
 */
async function train(sport = 'mlb') {
  const data = backtestToTrainingData(backtestGames);
  if (data.length === 0) {
    return { error: 'No training data available' };
  }
  
  return callPython({ mode: 'train', sport, data });
}

/**
 * Get ML predictions for games.
 * @param {Array} games - [{away, home, awayPitcher?, homePitcher?}]
 * @returns ML-calibrated probabilities
 */
async function predict(games, sport = 'mlb') {
  const featureGames = games.map(g => {
    if (g.awayRsG !== undefined) return g; // already has features
    return extractGameFeatures(g.away, g.home, {
      awayPitcher: g.awayPitcher,
      homePitcher: g.homePitcher,
    });
  }).filter(Boolean);
  
  if (featureGames.length === 0) {
    return { error: 'No valid games to predict' };
  }
  
  return callPython({ mode: 'predict', sport, games: featureGames });
}

/**
 * Run ML backtest with rolling window.
 * Proper out-of-sample testing — no look-ahead bias.
 */
async function backtest(sport = 'mlb') {
  const data = backtestToTrainingData(backtestGames);
  if (data.length === 0) {
    return { error: 'No backtest data available' };
  }
  
  return callPython({ mode: 'backtest', sport, data });
}

/**
 * Check ML engine status.
 */
async function status(sport = 'mlb') {
  try {
    return await callPython({ mode: 'status', sport }, 10000);
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Get ML-enhanced prediction for a single game.
 * Blends ML output with our analytical model for best-of-both-worlds.
 */
async function enhancedPredict(awayAbbr, homeAbbr, opts = {}) {
  // Get analytical prediction
  const analytical = mlb ? mlb.predict(awayAbbr, homeAbbr, opts) : null;
  
  // Get ML prediction
  const features = extractGameFeatures(awayAbbr, homeAbbr, opts);
  if (!features) {
    return analytical || { error: 'No data for prediction' };
  }
  
  try {
    const mlResult = await callPython({ mode: 'predict', sport: 'mlb', games: [features] }, 15000);
    
    if (mlResult.predictions && mlResult.predictions.length > 0) {
      const mlPred = mlResult.predictions[0];
      
      // Blend: 55% ML, 45% analytical (ML is more calibrated, analytical has more signals)
      const analyticalHomeProb = analytical ? analytical.homeWinProb : 0.5;
      const mlHomeProb = mlPred.homeWinProb;
      
      const blendedHomeProb = mlHomeProb * 0.55 + analyticalHomeProb * 0.45;
      const blendedAwayProb = 1 - blendedHomeProb;
      
      return {
        ...(analytical || {}),
        ml: {
          homeWinProb: mlPred.homeWinProb,
          awayWinProb: mlPred.awayWinProb,
          homeML: mlPred.homeML,
          awayML: mlPred.awayML,
          confidence: mlPred.confidence,
          modelAgreement: mlPred.modelAgreement,
          models: mlPred.models,
          predictedTotal: mlPred.predictedTotal,
        },
        blendedHomeWinProb: +blendedHomeProb.toFixed(4),
        blendedAwayWinProb: +blendedAwayProb.toFixed(4),
        blendedHomeML: probToML(blendedHomeProb),
        blendedAwayML: probToML(blendedAwayProb),
        predictionSource: 'ml+analytical',
      };
    }
  } catch (e) {
    // ML failed — fall back to analytical only
    if (analytical) {
      analytical.predictionSource = 'analytical_only';
      analytical.mlError = e.message;
    }
    return analytical;
  }
  
  return analytical;
}

function probToML(prob) {
  prob = Math.max(0.01, Math.min(0.99, prob));
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== AUTO-TRAIN ON STARTUP ====================

let trained = false;
let lastTrainResult = null;

async function autoTrain() {
  if (trained) return lastTrainResult;
  try {
    console.log('[ml-bridge] Auto-training ML model...');
    lastTrainResult = await train('mlb');
    trained = true;
    if (lastTrainResult.ensemble) {
      console.log(`[ml-bridge] ✅ MLB ML model trained: ${lastTrainResult.games} games, ` +
        `${(lastTrainResult.ensemble.accuracy * 100).toFixed(1)}% accuracy, ` +
        `Brier: ${lastTrainResult.ensemble.brier_score}`);
    }
    return lastTrainResult;
  } catch (e) {
    console.error('[ml-bridge] ❌ ML training failed:', e.message);
    return { error: e.message };
  }
}

function getStatus() {
  return {
    trained,
    lastResult: lastTrainResult ? {
      games: lastTrainResult.games,
      accuracy: lastTrainResult.ensemble?.accuracy,
      brierScore: lastTrainResult.ensemble?.brier_score,
      topFeatures: lastTrainResult.top_features?.slice(0, 5),
    } : null,
  };
}

module.exports = {
  train,
  predict,
  backtest,
  status,
  enhancedPredict,
  autoTrain,
  getStatus,
  extractGameFeatures,
};
