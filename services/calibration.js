/**
 * Model Probability Calibration Service — SportsSim v17.0
 * 
 * PROBLEM: Our models predict well (76.5% MLB accuracy) but the RAW probabilities
 * are horribly compressed — model says 60% when actual is ~87%. This means:
 *   - Kelly sizing is WRONG (calculates tiny edges when real edges are huge)
 *   - Value detection misses real value bets
 *   - Bankroll allocation is suboptimal
 * 
 * SOLUTION: Piecewise linear calibration using backtest data.
 * We fit a mapping from raw model probability → calibrated probability
 * using historical backtest data where we know actual outcomes.
 * 
 * After calibration, probabilities are normalized per-game so they sum to 1.
 */

// ==================== CALIBRATION CURVES ====================
// Format: sorted array of { raw, cal } — piecewise linear interpolation between points
// Built from backtest analysis of 200+ games per sport

const CALIBRATION_CURVES = {
  mlb: [
    // MLB model is HIGHLY compressed: 50%→23% actual, 60%→87% actual
    // This is a very steep S-curve through the 50-60% range
    { raw: 0.15, cal: 0.03 },
    { raw: 0.20, cal: 0.05 },
    { raw: 0.25, cal: 0.08 },
    { raw: 0.30, cal: 0.11 },
    { raw: 0.35, cal: 0.15 },
    { raw: 0.40, cal: 0.19 },
    { raw: 0.45, cal: 0.21 },
    { raw: 0.50, cal: 0.23 },   // 92 games: actual 22.8%
    { raw: 0.52, cal: 0.35 },
    { raw: 0.54, cal: 0.50 },
    { raw: 0.56, cal: 0.65 },
    { raw: 0.58, cal: 0.77 },
    { raw: 0.60, cal: 0.87 },   // 70 games: actual 87.1%
    { raw: 0.65, cal: 0.93 },
    { raw: 0.70, cal: 0.96 },   // 16 games: actual 100% (regressed)
    { raw: 0.75, cal: 0.97 },
    { raw: 0.80, cal: 0.98 },
    { raw: 0.85, cal: 0.99 },
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
