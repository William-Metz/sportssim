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
let mlb, pitchers, rollingStats, injuryService, statcastService, historicalGames;
try { mlb = require('../models/mlb'); } catch (e) {}
try { pitchers = require('../models/mlb-pitchers'); } catch (e) {}
try { rollingStats = require('../services/rolling-stats'); } catch (e) {}
try { injuryService = require('../services/injuries'); } catch (e) {}
try { statcastService = require('../services/statcast'); } catch (e) {}
try { historicalGames = require('../services/historical-games'); } catch (e) {}

// Backtest data — use V2 point-in-time data for training features
let backtestGames;
try { backtestGames = require('../models/backtest-mlb-v2').GAMES; } catch (e) { 
  try { backtestGames = require('../models/backtest-mlb').GAMES; } catch (e2) { backtestGames = []; }
}

// ==================== PYTHON COMMUNICATION ====================

/**
 * Call Python ML engine with JSON input, get JSON output.
 * Uses child_process.spawn for reliability.
 */
function callPython(inputData, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    // Find libgomp.so.1 for LightGBM — search known locations
    const libgompPaths = [
      '/usr/lib/x86_64-linux-gnu',
      '/tmp',
      path.join(__dirname, '..', 'ml-env', 'lib', 'python3.12', 'site-packages', 'scikit_learn.libs'),
      path.join(__dirname, '..', '.venv', 'lib', 'python3.12', 'site-packages', 'scikit_learn.libs'),
    ];
    const ldPath = libgompPaths.filter(p => {
      try { return fs.existsSync(p); } catch { return false; }
    }).join(':');

    const proc = spawn(PYTHON_BIN, [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      env: { ...process.env, LD_LIBRARY_PATH: ldPath + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') },
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

// ==================== SEASON CONTEXT ====================

/**
 * Calculate day of MLB season from current date.
 * Opening Day 2025/2026 is ~March 27.
 */
function getDayOfSeason(date = new Date()) {
  const year = date.getFullYear();
  const openingDay = new Date(year, 2, 27); // March 27
  const diff = Math.floor((date - openingDay) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(186, diff + 1));
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
    // Season context (v38.0 — critical for Opening Day)
    dayOfSeason: opts.dayOfSeason || getDayOfSeason(),
    isOpeningWeek: opts.isOpeningWeek || (getDayOfSeason() <= 7 ? 1 : 0),
    isFirstMonth: opts.isFirstMonth || (getDayOfSeason() <= 30 ? 1 : 0),
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
  
  // Statcast — the REAL edge
  if (statcastService) {
    // Pitcher xERA/xwOBA data
    if (opts.awayPitcher) {
      const pitcherName = typeof opts.awayPitcher === 'string' ? opts.awayPitcher : opts.awayPitcher?.name;
      if (pitcherName) {
        const sc = statcastService.getStatcastPitcherAdjustment(pitcherName);
        if (sc) {
          features.awayPitcherXera = sc.xera;
          features.awayPitcherXwoba = sc.xwoba;
        }
      }
    }
    if (opts.homePitcher) {
      const pitcherName = typeof opts.homePitcher === 'string' ? opts.homePitcher : opts.homePitcher?.name;
      if (pitcherName) {
        const sc = statcastService.getStatcastPitcherAdjustment(pitcherName);
        if (sc) {
          features.homePitcherXera = sc.xera;
          features.homePitcherXwoba = sc.xwoba;
        }
      }
    }
    
    // Team batting xwOBA
    const awayBatting = statcastService.getTeamBattingStatcast(awayAbbr);
    const homeBatting = statcastService.getTeamBattingStatcast(homeAbbr);
    if (awayBatting) features.awayTeamXwoba = awayBatting.xwoba;
    if (homeBatting) features.homeTeamXwoba = homeBatting.xwoba;
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
      // Season context (backtest data from mid-season, approximate)
      dayOfSeason: 90,
      isOpeningWeek: 0,
      isFirstMonth: 0,
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
 * Train ML model from our backtest data + historical ESPN data.
 * Uses expanded dataset for better generalization.
 * Returns training metrics and model info.
 * 
 * v38.0: Multi-season training with proper season-specific stats.
 * Uses 2023 + 2024 data (~4300 games) for much better model.
 */
async function train(sport = 'mlb', forceRefresh = false) {
  // Start with backtest data
  let data = backtestToTrainingData(backtestGames);
  
  // Add historical ESPN data if available
  if (historicalGames) {
    try {
      // Always try multi-season first (2023 + 2024)
      if (historicalGames.getMultiSeasonTrainingData) {
        // Use cached multi-season data (fetched separately, no ESPN delay)
        const fs = require('fs');
        const path = require('path');
        const multiCachePath = path.join(__dirname, 'historical-multi-season-cache.json');
        
        let multiSeasonGames = [];
        
        // Load 2023 data from multi-season cache
        try {
          if (fs.existsSync(multiCachePath)) {
            const multiCache = JSON.parse(fs.readFileSync(multiCachePath, 'utf8'));
            for (const [key, games] of Object.entries(multiCache)) {
              if (Array.isArray(games) && games.length > 0) {
                const enriched = historicalGames.enrichGamesForTraining(games);
                multiSeasonGames.push(...enriched);
                console.log(`[ml-bridge] Loaded ${enriched.length} games from ${key}`);
              }
            }
          }
        } catch (e) {
          console.error('[ml-bridge] Multi-season cache load error:', e.message);
        }
        
        // Load 2024 data from single-season cache
        const cached2024 = historicalGames.getCachedGames();
        if (cached2024.length > 0) {
          const enriched2024 = historicalGames.enrichGamesForTraining(cached2024);
          console.log(`[ml-bridge] Adding ${enriched2024.length} games from 2024 season cache`);
          multiSeasonGames.push(...enriched2024);
        }
        
        // Deduplicate
        if (multiSeasonGames.length > 0) {
          const existingKeys = new Set(data.map(g => `${g.away}_${g.home}_${g.awayScore}_${g.homeScore}`));
          let added = 0;
          for (const hg of multiSeasonGames) {
            const key = `${hg.away}_${hg.home}_${hg.awayScore}_${hg.homeScore}`;
            if (!existingKeys.has(key)) {
              data.push(hg);
              existingKeys.add(key);
              added++;
            }
          }
          console.log(`[ml-bridge] Added ${added} unique multi-season games to training data`);
        }
      } else {
        // Fallback: use single-season cached games
        const cached = historicalGames.getCachedGames();
        if (cached.length > 0) {
          const enriched = historicalGames.enrichGamesForTraining(cached);
          console.log(`[ml-bridge] Adding ${enriched.length} cached historical games to training data`);
          const existingKeys = new Set(data.map(g => `${g.away}_${g.home}_${g.awayScore}_${g.homeScore}`));
          for (const hg of enriched) {
            const key = `${hg.away}_${hg.home}_${hg.awayScore}_${hg.homeScore}`;
            if (!existingKeys.has(key)) {
              data.push(hg);
              existingKeys.add(key);
            }
          }
        }
      }
      console.log(`[ml-bridge] Total training data: ${data.length} games`);
    } catch (e) {
      console.error('[ml-bridge] Historical data load failed:', e.message);
    }
  }
  
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
 * Uses asyncPredict when available for full signal integration (rest/travel/MC/weather).
 */
async function enhancedPredict(awayAbbr, homeAbbr, opts = {}) {
  // Get analytical prediction — prefer async path for MLB (includes rest/travel + MC)
  let analytical = null;
  try {
    if (mlb && mlb.asyncPredict) {
      analytical = await mlb.asyncPredict(awayAbbr, homeAbbr, opts);
    } else if (mlb) {
      analytical = mlb.predict(awayAbbr, homeAbbr, opts);
    }
    if (analytical && analytical.error) analytical = null;
  } catch (e) { /* analytical failed */ }
  
  // Get ML prediction
  const features = extractGameFeatures(awayAbbr, homeAbbr, opts);
  if (!features) {
    return analytical || { error: 'No data for prediction' };
  }
  
  try {
    const mlResult = await callPython({ mode: 'predict', sport: 'mlb', games: [features] }, 15000);
    
    if (mlResult.predictions && mlResult.predictions.length > 0) {
      const mlPred = mlResult.predictions[0];
      
      // Smart blend: weight analytical higher when we have pitcher-specific data
      // ML model doesn't have game-specific pitcher data in training set, 
      // so analytical is much better when starters are known
      const analyticalHomeProb = analytical ? analytical.homeWinProb : 0.5;
      const mlHomeProb = mlPred.homeWinProb;
      
      // If analytical model has pitcher adjustments, trust it more (65/35)
      // Otherwise, lean on ML (55/45)
      const hasPitcherData = analytical && (analytical.homePitcher || analytical.awayPitcher);
      const hasStatcast = analytical && analytical.factors?.statcast;
      const hasWeather = analytical && analytical.factors?.weather;
      
      let analyticalWeight = 0.45;
      if (hasPitcherData) analyticalWeight += 0.15; // pitcher matchup = big edge
      if (hasStatcast) analyticalWeight += 0.05;     // xERA/xwOBA data
      if (hasWeather) analyticalWeight += 0.03;      // weather adjustments
      analyticalWeight = Math.min(0.70, analyticalWeight); // cap at 70% analytical
      const mlWeight = 1 - analyticalWeight;
      
      const blendedHomeProb = mlHomeProb * mlWeight + analyticalHomeProb * analyticalWeight;
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
        blendWeights: { ml: +mlWeight.toFixed(2), analytical: +analyticalWeight.toFixed(2) },
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
  
  // Check if a trained model already exists on disk (from a prior session)
  try {
    const modelPath = path.join(__dirname, 'ml-models', 'mlb_ensemble_v3.pkl');
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      
      // If model is less than 24 hours old, skip retraining and mark as trained
      if (ageHours < 24) {
        trained = true;
        lastTrainResult = { status: 'cached', message: `Using existing model (${ageHours.toFixed(1)}h old)`, cached: true };
        console.log(`[ml-bridge] ✅ Using cached ML model (${ageHours.toFixed(1)}h old, skipping retrain)`);
        
        // Verify it works with a quick status check
        try {
          const statusResult = await callPython({ mode: 'status', sport: 'mlb' }, 10000);
          if (statusResult.status === 'ready') {
            lastTrainResult.modelInfo = statusResult;
            console.log(`[ml-bridge] ✅ Model verified: ${statusResult.modelsInEnsemble?.length || '?'} models, ${statusResult.eloTeams || '?'} Elo teams`);
          }
        } catch (e) { /* status check failed, model may still work */ }
        
        return lastTrainResult;
      }
    }
  } catch (e) { /* no existing model */ }
  
  // Train fresh
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
