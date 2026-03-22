/**
 * Model Probability Calibration Service — SportsSim v27.0
 * 
 * PROBLEM: Our models predict decently but the RAW probabilities are compressed —
 * the model says 55% when actual win rate is 61%, says 60% when actual is 76%.
 * This means: Kelly sizing is WRONG, value detection underestimates real edges,
 * and bankroll allocation is suboptimal.
 * 
 * SOLUTION: Piecewise linear calibration using REAL point-in-time backtest data.
 * 
 * V27 CRITICAL FIX: MLB calibration was built from look-ahead biased V1 backtest
 * (2025 projected stats → 2024 games = 89% WR, completely fake).
 * Now rebuilt from V2 point-in-time backtest (2023 stats → 2024 games = 69% accuracy).
 * The model is UNDERCONFIDENT: it says 60% but wins 76% of the time.
 * 
 * After calibration, probabilities are normalized per-game so they sum to 1.
 */

// ==================== CALIBRATION CURVES ====================
// Format: sorted array of { raw, cal } — piecewise linear interpolation between points
// Built from backtest analysis of 200+ games per sport

const CALIBRATION_CURVES = {
  mlb: [
    // MLB V3 Calibration — 2375 REAL 2024 games (full season audit)
    // ========================================================================
    // CRITICAL FIX: V2 curve was built from 200-game biased backtest — said
    // model was underconfident (60% pred → 74% actual). WRONG.
    // Full 2375-game audit shows model is OVERCONFIDENT at high probabilities:
    //   50-55% pred → 52.9% actual ✅ (well-calibrated, N=569)
    //   55-60% pred → 55.2% actual (slight overconfidence, N=576)
    //   60-65% pred → 59.1% actual (overconfident by ~3%, N=464)
    //   65-70% pred → 62.5% actual (overconfident by ~5%, N=320)
    //   70-75% pred → 58.0% actual (MASSIVELY overconfident! -14.7%, N=245)
    //   75-80% pred → 72.1% actual (overconfident by ~3%, N=201)
    //
    // The 70-75% bucket is the worst — likely driven by CWS/COL extreme games
    // where model assigns 75%+ but upsets happen ~40% of the time.
    //
    // Strategy: compress high-confidence predictions toward 50%.
    // MLB is fundamentally ~60:40 max for any game — even CWS has ~30% upset rate.
    { raw: 0.15, cal: 0.12 },
    { raw: 0.20, cal: 0.17 },
    { raw: 0.25, cal: 0.22 },
    { raw: 0.30, cal: 0.27 },
    { raw: 0.35, cal: 0.32 },
    { raw: 0.40, cal: 0.38 },
    { raw: 0.45, cal: 0.44 },
    { raw: 0.50, cal: 0.50 },   // perfect at 50% (by definition)
    { raw: 0.525, cal: 0.525 }, // 569 games: actual 52.9% at avg 52.75% pred → nearly perfect
    { raw: 0.55, cal: 0.54 },   // 576 games: actual 55.2% at avg 57.7% pred → slight overcalibration
    { raw: 0.575, cal: 0.555 },
    { raw: 0.60, cal: 0.57 },   // 464 games: actual 59.1% at avg 62.5% pred
    { raw: 0.625, cal: 0.585 },
    { raw: 0.65, cal: 0.60 },   // 320 games: actual 62.5% at avg 67.7% pred
    { raw: 0.675, cal: 0.605 },
    { raw: 0.70, cal: 0.61 },   // 245 games: actual 58.0% at avg 72.7% pred — HUGE overcal
    { raw: 0.725, cal: 0.63 },  // smoothed — 70-75% range is chaotic, regress heavily
    { raw: 0.75, cal: 0.66 },   // 201 games: actual 72.1% at avg 75.5% pred — recovers a bit
    { raw: 0.78, cal: 0.72 },   // extrapolated
    { raw: 0.80, cal: 0.75 },   // MLB cap — no game truly > 75% favorite
    { raw: 0.85, cal: 0.78 },
    { raw: 0.90, cal: 0.80 },
  ],
  
  nba: [
    // NBA calibration curve — fitted from 176-game 2024-25 backtest (v2.0)
    // Model is over-confident in mid-range (60% pred → 50% actual)
    // Well-calibrated at extremes (80-90% range)
    { raw: 0.05, cal: 0.01 },
    { raw: 0.10, cal: 0.02 },
    { raw: 0.15, cal: 0.03 },
    { raw: 0.20, cal: 0.04 },   // backtest: 20% pred → ~0% actual (small n)
    { raw: 0.25, cal: 0.06 },
    { raw: 0.30, cal: 0.10 },   // backtest: 30% pred → 9.5% actual (21 games)
    { raw: 0.35, cal: 0.20 },
    { raw: 0.40, cal: 0.29 },   // backtest: 40% pred → 29% actual (31 games)
    { raw: 0.45, cal: 0.36 },
    { raw: 0.50, cal: 0.43 },   // backtest: 50% pred → 42.9% actual (28 games)
    { raw: 0.55, cal: 0.47 },
    { raw: 0.60, cal: 0.50 },   // backtest: 60% pred → 50% actual (28 games)
    { raw: 0.65, cal: 0.55 },
    { raw: 0.70, cal: 0.60 },   // backtest: 70% pred → 60% actual (20 games)
    { raw: 0.75, cal: 0.74 },
    { raw: 0.80, cal: 0.87 },   // backtest: 80% pred → 87% actual (23 games)
    { raw: 0.85, cal: 0.90 },
    { raw: 0.90, cal: 0.93 },   // backtest: 90% pred → 92.9% actual (14 games)
    { raw: 0.95, cal: 0.97 },
  ],
  
  nhl: [
    // NHL model — similar to NBA but slightly more compressed
    { raw: 0.15, cal: 0.05 },
    { raw: 0.20, cal: 0.08 },
    { raw: 0.25, cal: 0.12 },
    { raw: 0.30, cal: 0.18 },
    { raw: 0.35, cal: 0.25 },
    { raw: 0.40, cal: 0.32 },
    { raw: 0.45, cal: 0.40 },
    { raw: 0.50, cal: 0.48 },
    { raw: 0.55, cal: 0.57 },
    { raw: 0.60, cal: 0.68 },
    { raw: 0.65, cal: 0.78 },
    { raw: 0.70, cal: 0.86 },
    { raw: 0.75, cal: 0.92 },
    { raw: 0.80, cal: 0.95 },
    { raw: 0.85, cal: 0.97 },
  ],
};

// ==================== CORE CALIBRATION ====================

/**
 * Piecewise linear interpolation on the calibration curve
 */
function interpolate(rawProb, curve) {
  if (rawProb <= curve[0].raw) return curve[0].cal;
  if (rawProb >= curve[curve.length - 1].raw) return curve[curve.length - 1].cal;
  
  for (let i = 0; i < curve.length - 1; i++) {
    if (rawProb >= curve[i].raw && rawProb <= curve[i + 1].raw) {
      const range = curve[i + 1].raw - curve[i].raw;
      const frac = range > 0 ? (rawProb - curve[i].raw) / range : 0;
      return curve[i].cal + frac * (curve[i + 1].cal - curve[i].cal);
    }
  }
  
  return rawProb; // fallback
}

/**
 * Calibrate a raw model probability
 * 
 * @param {number} rawProb - Raw probability from the model (0.0 to 1.0)
 * @param {string} sport - 'mlb', 'nba', 'nhl'
 * @returns {object} { calibrated, raw, adjustment, sport }
 */
function calibrate(rawProb, sport = 'mlb') {
  sport = sport.toLowerCase();
  const curve = CALIBRATION_CURVES[sport] || CALIBRATION_CURVES.mlb;
  
  // Clamp input
  rawProb = Math.max(0.05, Math.min(0.95, rawProb));
  
  const calibrated = Math.max(0.02, Math.min(0.98, interpolate(rawProb, curve)));
  
  return {
    calibrated: +calibrated.toFixed(4),
    raw: rawProb,
    adjustment: +((calibrated - rawProb) * 100).toFixed(1),
    sport,
  };
}

/**
 * Calibrate a full prediction result object
 * Adds calibrated probabilities alongside raw ones, normalized to sum to 1
 */
function calibratePrediction(prediction, sport = 'mlb') {
  if (!prediction || prediction.error) return prediction;
  
  const homeRaw = prediction.homeWinProb;
  const awayRaw = prediction.awayWinProb || (1 - homeRaw);
  
  const homeCal = calibrate(homeRaw, sport);
  const awayCal = calibrate(awayRaw, sport);
  
  // Normalize so they sum to 1
  const total = homeCal.calibrated + awayCal.calibrated;
  const homeCalNorm = total > 0 ? homeCal.calibrated / total : 0.5;
  const awayCalNorm = total > 0 ? awayCal.calibrated / total : 0.5;
  
  return {
    ...prediction,
    // Store raw probs
    rawHomeWinProb: homeRaw,
    rawAwayWinProb: awayRaw,
    // Replace with calibrated
    homeWinProb: +homeCalNorm.toFixed(4),
    awayWinProb: +awayCalNorm.toFixed(4),
    homeML: probToML(homeCalNorm),
    awayML: probToML(awayCalNorm),
    calibration: {
      method: 'piecewise-linear',
      sport,
      homeRaw,
      homeCal: +homeCalNorm.toFixed(4),
      homeShift: +((homeCalNorm - homeRaw) * 100).toFixed(1),
      awayRaw,
      awayCal: +awayCalNorm.toFixed(4),
      awayShift: +((awayCalNorm - awayRaw) * 100).toFixed(1),
    },
  };
}

/**
 * Calculate calibrated edge against book odds
 */
function calibratedEdge(rawModelProb, bookProb, sport = 'mlb') {
  const cal = calibrate(rawModelProb, sport);
  return {
    rawEdge: +(rawModelProb - bookProb).toFixed(4),
    calibratedEdge: +(cal.calibrated - bookProb).toFixed(4),
    rawProb: rawModelProb,
    calibratedProb: cal.calibrated,
    bookProb,
    edgeMultiplier: cal.calibrated > rawModelProb 
      ? +((cal.calibrated - bookProb) / Math.max(0.001, rawModelProb - bookProb)).toFixed(2) 
      : 1.0,
  };
}

// ==================== HELPERS ====================

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Get calibration diagnostics for a sport
 */
function getDiagnostics(sport = 'mlb') {
  const curve = CALIBRATION_CURVES[sport.toLowerCase()] || CALIBRATION_CURVES.mlb;
  
  const testPoints = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75];
  const results = testPoints.map(raw => {
    const cal = calibrate(raw, sport);
    return {
      raw,
      calibrated: cal.calibrated,
      shift: cal.adjustment,
    };
  });
  
  // Test symmetry (when calibrating both sides and normalizing)
  const symmetry = testPoints.filter(p => p < 0.5).map(raw => {
    const home = calibrate(raw, sport);
    const away = calibrate(1 - raw, sport);
    const total = home.calibrated + away.calibrated;
    return { 
      rawHome: raw, rawAway: +(1 - raw).toFixed(2),
      calHome: +(home.calibrated / total).toFixed(4), 
      calAway: +(away.calibrated / total).toFixed(4),
    };
  });
  
  return {
    sport,
    curvePoints: curve.length,
    calibrationMap: results,
    symmetry,
    summary: {
      avgShift: +(results.reduce((s, r) => s + Math.abs(r.shift), 0) / results.length).toFixed(1),
      maxShift: +(Math.max(...results.map(r => Math.abs(r.shift)))).toFixed(1),
      note: 'Positive shift = model under-confident, negative = model over-confident',
    },
  };
}

function getStatus() {
  return {
    service: 'calibration',
    version: '1.0',
    sports: Object.keys(CALIBRATION_CURVES),
    note: 'Piecewise linear calibration from backtest data',
    curves: Object.fromEntries(
      Object.entries(CALIBRATION_CURVES).map(([s, c]) => [s, c.length + ' points'])
    ),
  };
}

module.exports = {
  calibrate,
  calibratePrediction,
  calibratedEdge,
  getDiagnostics,
  getStatus,
  probToML,
  interpolate,
  CALIBRATION_CURVES,
};
