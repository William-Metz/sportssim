/**
 * Negative Binomial Scoring Model — SportsSim v33.0
 * ==================================================
 * 
 * PROBLEM: Poisson assumes variance = mean, but MLB scoring has OVERDISPERSION.
 * Real MLB data shows variance ~1.3x the mean due to:
 *   - Blowout innings (grand slams, errors, bullpen meltdowns)
 *   - Shutouts from elite pitchers
 *   - Extra-innings games
 *   - Varying bullpen quality within a game
 * 
 * SOLUTION: Negative Binomial distribution properly models overdispersion.
 * NB(r, p) where r = "number of successes" and p = "probability of success"
 * The variance = mean * (1 + mean/r), where r controls overdispersion.
 * As r → ∞, NB → Poisson (no overdispersion).
 * 
 * For MLB: r ≈ 5-8 fits historical data well (overdispersion factor ~1.2-1.5x).
 * 
 * KEY BETTING EDGE:
 * - Poisson UNDERESTIMATES extreme outcomes (0-1 runs or 10+ runs)
 * - This means Poisson OVERESTIMATES "near the mean" outcomes
 * - Totals bets near the projected total are overvalued by Poisson
 * - Extreme totals (far from projected) are UNDERVALUED by Poisson
 * - NB gives us better edge detection on totals/team totals/alt lines
 *
 * OPENING DAY SPECIAL:
 * - Early season has MORE variance (bullpens untested, timing off)
 * - Use lower r (more overdispersion) for first 2-3 weeks
 * - This properly prices Opening Day uncertainty
 */

// ==================== MATHEMATICAL FUNCTIONS ====================

// Log-gamma function (Stirling's approximation for large values)
function logGamma(z) {
  if (z <= 0) return Infinity;
  if (z < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  const coeffs = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let x = 0.99999999999980993;
  for (let i = 0; i < coeffs.length; i++) {
    x += coeffs[i] / (z + 1 + i);
  }
  const t = z + coeffs.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Log of binomial coefficient C(n, k) using log-gamma
function logBinom(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Negative Binomial PMF
 * P(X = k) = C(k + r - 1, k) * p^r * (1-p)^k
 * 
 * Parameterization: mean = r(1-p)/p, variance = r(1-p)/p^2
 * We use the mean+r parameterization for convenience:
 *   p = r / (r + mean)
 *   
 * @param {number} k - Number of runs (0, 1, 2, ...)
 * @param {number} mean - Expected runs (lambda equivalent)
 * @param {number} r - Overdispersion parameter (higher = more Poisson-like)
 * @returns {number} Probability of exactly k runs
 */
function negBinPMF(k, mean, r) {
  if (k < 0 || mean <= 0 || r <= 0) return 0;
  if (k > 25) return 0; // negligible beyond 25 runs
  
  const p = r / (r + mean);
  // P(X = k) = C(k + r - 1, k) * p^r * (1-p)^k
  // Use log form for numerical stability
  const logProb = logBinom(k + r - 1, k) + r * Math.log(p) + k * Math.log(1 - p);
  return Math.exp(logProb);
}

/**
 * Negative Binomial CDF
 * P(X <= k) = sum of PMF from 0 to k
 */
function negBinCDF(k, mean, r) {
  let cumProb = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    cumProb += negBinPMF(i, mean, r);
  }
  return Math.min(1.0, cumProb);
}

// Standard Poisson PMF for comparison
const FACTORIALS = [1];
for (let i = 1; i <= 25; i++) FACTORIALS[i] = FACTORIALS[i-1] * i;
function poissonPMF(lambda, k) {
  if (k < 0 || k > 25 || lambda <= 0) return 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / FACTORIALS[k];
}

// ==================== OVERDISPERSION PARAMETERS ====================

/**
 * Get the overdispersion parameter 'r' for a game.
 * 
 * Lower r = more variance (overdispersion)
 * Higher r = closer to Poisson
 * 
 * Factors that increase variance (lower r):
 *   - High park factor (Coors, Chase Field) → more blowouts
 *   - Bad bullpen teams → more extreme outcomes  
 *   - Early season (Opening Day) → uncertain bullpens
 *   - Extreme weather (wind out, hot) → more variance
 *   - Umpire with wide zone → suppresses scoring, but increases variance of outcome
 * 
 * Factors that decrease variance (higher r):
 *   - Low park factor (Petco, Oracle) → pitching domination
 *   - Elite bullpen matchup → tighter game
 *   - Mid-season with established patterns
 *   - Dome/controlled environment
 * 
 * Historical MLB data suggests r ≈ 5.5-7.5 for most games.
 * Mean r ≈ 6.2 gives variance/mean ratio of ~1.35.
 */
const R_BASE = 6.2;

// Park-specific overdispersion adjustments
// Parks with more variance get lower r (more overdispersion)
const PARK_R_ADJUSTMENTS = {
  'Coors Field': -1.8,         // Altitude, massive scoring variance
  'Great American Ball Park': -0.7, // Hitter's park
  'Chase Field': -0.5,        // Hot, dry, carries well
  'Fenway Park': -0.4,        // Wall effects create variance
  'Globe Life Field': -0.3,   // Large OF, weird bounces
  'Citizens Bank Park': -0.3, // Hitter-friendly
  'Minute Maid Park': -0.2,   // Short LF
  'Yankee Stadium': -0.3,     // Short RF
  'Wrigley Field': -0.5,      // Wind-dependent, huge variance
  'Target Field': -0.2,       // Weather exposed
  'American Family Field': -0.1,
  // Pitcher parks = less variance (higher r)
  'T-Mobile Park': 0.5,       // Marine layer
  'Oracle Park': 0.6,         // Cold, wind in
  'Petco Park': 0.4,          // Pitcher's park
  'Tropicana Field': 0.3,     // Dome, controlled
  'Dodger Stadium': 0.2,      // Pitcher-neutral
  'LoanDepot Park': 0.5,      // Pitcher's park
  'Comerica Park': 0.3,       // Deep outfield
  'PNC Park': 0.2,            // Moderate
  'Busch Stadium': 0.1,       // Neutral
  'Kauffman Stadium': 0.1,    // Neutral, large OF
  'Rogers Centre': 0.0,       // Dome, neutral
  'Angel Stadium': 0.0,       // Neutral
  'Nationals Park': 0.0,      // Neutral
  'Guaranteed Rate Field': -0.2,// Hitter-friendly
  'Progressive Field': 0.1,   // Neutral
  'Coliseum': 0.2,            // Foul territory
  'Truist Park': 0.0,         // Neutral
  'Citi Field': 0.2,          // Pitcher-friendly
  'Camden Yards': -0.1,       // Neutral-hitter
};

/**
 * Calculate game-specific overdispersion parameter.
 * 
 * @param {object} opts - Game context
 * @param {string} opts.park - Park name
 * @param {number} opts.homeBullpenEra - Home team bullpen ERA
 * @param {number} opts.awayBullpenEra - Away team bullpen ERA
 * @param {boolean} opts.isPreseason - Is this early season / Opening Day?
 * @param {number} opts.weatherMultiplier - Weather scoring multiplier (>1 = more runs)
 * @param {number} opts.awayPitcherRating - Away starting pitcher rating (0-100)
 * @param {number} opts.homePitcherRating - Home starting pitcher rating (0-100)
 * @returns {number} r parameter
 */
function getGameR(opts = {}) {
  let r = R_BASE;
  
  // Park adjustment
  const parkAdj = PARK_R_ADJUSTMENTS[opts.park] || 0;
  r += parkAdj;
  
  // Bullpen quality: bad bullpens = more variance
  const lgAvgBullpenEra = 3.70;
  if (opts.homeBullpenEra) {
    const homeBlowup = (opts.homeBullpenEra - lgAvgBullpenEra) / lgAvgBullpenEra;
    r -= homeBlowup * 0.8; // bad bullpen → lower r → more variance
  }
  if (opts.awayBullpenEra) {
    const awayBlowup = (opts.awayBullpenEra - lgAvgBullpenEra) / lgAvgBullpenEra;
    r -= awayBlowup * 0.8;
  }
  
  // Early season: bullpens not established, lineups not set → MORE variance
  if (opts.isPreseason) {
    r -= 1.2; // significant increase in variance for Opening Day
  }
  
  // Weather: extreme conditions increase variance
  if (opts.weatherMultiplier && opts.weatherMultiplier !== 1.0) {
    const weatherImpact = Math.abs(opts.weatherMultiplier - 1.0);
    r -= weatherImpact * 2.0; // weather extremes = more unpredictable
  }
  
  // Elite pitcher matchups: two aces → more predictable, tighter game
  if (opts.awayPitcherRating && opts.homePitcherRating) {
    const avgRating = (opts.awayPitcherRating + opts.homePitcherRating) / 2;
    if (avgRating >= 75) {
      r += (avgRating - 75) * 0.04; // ace vs ace → more Poisson-like
    } else if (avgRating <= 40) {
      r -= (40 - avgRating) * 0.03; // bad pitchers → more chaos
    }
  }
  
  // Clamp r to sane range
  return Math.max(2.5, Math.min(12, r));
}

// ==================== CORE SCORING MODEL ====================

/**
 * Calculate win probability using Negative Binomial score distribution.
 * More accurate than Poisson for games with high variance potential.
 * 
 * @param {number} awayExpRuns - Away team expected runs
 * @param {number} homeExpRuns - Home team expected runs
 * @param {number} r - Overdispersion parameter (default: base value)
 * @returns {object} { away, home, tie } probabilities
 */
function negBinWinProb(awayExpRuns, homeExpRuns, r = R_BASE) {
  const maxRuns = 20; // higher ceiling than Poisson since more variance
  let awayWin = 0, homeWin = 0, tie = 0;
  
  for (let a = 0; a <= maxRuns; a++) {
    for (let h = 0; h <= maxRuns; h++) {
      const prob = negBinPMF(a, awayExpRuns, r) * negBinPMF(h, homeExpRuns, r);
      if (a > h) awayWin += prob;
      else if (h > a) homeWin += prob;
      else tie += prob;
    }
  }
  
  // Split ties proportionally (baseball has extra innings)
  const total = awayWin + homeWin;
  if (total === 0) return { away: 0.5, home: 0.5, tie: 0 };
  
  return {
    away: +((awayWin + tie * awayWin / total).toFixed(4)),
    home: +((homeWin + tie * homeWin / total).toFixed(4)),
    tie: +tie.toFixed(4),
  };
}

/**
 * Calculate full score distribution and O/U probabilities using Negative Binomial.
 * This is the main upgrade over the Poisson version in mlb.js.
 * 
 * @param {number} awayExpRuns - Away team expected runs
 * @param {number} homeExpRuns - Home team expected runs  
 * @param {object} opts - { r, park, isPreseason, ... }
 * @returns {object} Full scoring distribution with O/U probabilities for all lines
 */
function calculateNBTotals(awayExpRuns, homeExpRuns, opts = {}) {
  const r = opts.r || getGameR(opts);
  const lambdaAway = Math.max(0.5, awayExpRuns);
  const lambdaHome = Math.max(0.5, homeExpRuns);
  const projTotal = lambdaAway + lambdaHome;
  
  // Build score probability matrix (0-20 runs each for NB)
  const maxRuns = 20;
  const scoreMatrix = [];
  let matrixSum = 0;
  
  for (let a = 0; a <= maxRuns; a++) {
    scoreMatrix[a] = [];
    for (let h = 0; h <= maxRuns; h++) {
      const p = negBinPMF(a, lambdaAway, r) * negBinPMF(h, lambdaHome, r);
      scoreMatrix[a][h] = p;
      matrixSum += p;
    }
  }
  
  // Normalize matrix (NB doesn't sum to exactly 1 with finite max)
  if (matrixSum > 0 && matrixSum < 0.99) {
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        scoreMatrix[a][h] /= matrixSum;
      }
    }
  }
  
  // Calculate probabilities for common total lines
  const lines = [5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13];
  const totalProbs = {};
  
  for (const line of lines) {
    let overProb = 0;
    let underProb = 0;
    let pushProb = 0;
    
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        const total = a + h;
        const prob = scoreMatrix[a][h];
        if (total > line) overProb += prob;
        else if (total < line) underProb += prob;
        else pushProb += prob;
      }
    }
    
    totalProbs[line] = {
      over: +overProb.toFixed(4),
      under: +underProb.toFixed(4),
      push: +pushProb.toFixed(4),
      overML: probToML(overProb),
      underML: probToML(underProb),
    };
  }
  
  // Team totals
  const teamTotals = {};
  const teamTotalLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
  
  for (const line of teamTotalLines) {
    // Away team total
    let awayOver = 0, awayUnder = 0;
    for (let a = 0; a <= maxRuns; a++) {
      const p = negBinPMF(a, lambdaAway, r);
      if (a > line) awayOver += p;
      else if (a < line) awayUnder += p;
    }
    
    // Home team total
    let homeOver = 0, homeUnder = 0;
    for (let h = 0; h <= maxRuns; h++) {
      const p = negBinPMF(h, lambdaHome, r);
      if (h > line) homeOver += p;
      else if (h < line) homeUnder += p;
    }
    
    teamTotals[line] = {
      away: {
        over: +awayOver.toFixed(4),
        under: +awayUnder.toFixed(4),
        overML: probToML(awayOver),
        underML: probToML(awayUnder),
      },
      home: {
        over: +homeOver.toFixed(4),
        under: +homeUnder.toFixed(4),
        overML: probToML(homeOver),
        underML: probToML(homeUnder),
      },
    };
  }
  
  // Most likely scores
  const topScores = [];
  for (let a = 0; a <= maxRuns; a++) {
    for (let h = 0; h <= maxRuns; h++) {
      topScores.push({ away: a, home: h, prob: scoreMatrix[a][h] });
    }
  }
  topScores.sort((a, b) => b.prob - a.prob);
  
  // Variance metrics (key advantage over Poisson)
  let actualVarianceAway = 0, actualVarianceHome = 0;
  for (let k = 0; k <= maxRuns; k++) {
    actualVarianceAway += Math.pow(k - lambdaAway, 2) * negBinPMF(k, lambdaAway, r);
    actualVarianceHome += Math.pow(k - lambdaHome, 2) * negBinPMF(k, lambdaHome, r);
  }
  
  // Shutout probability (a key market in props)
  const awayShutout = negBinPMF(0, lambdaAway, r);
  const homeShutout = negBinPMF(0, lambdaHome, r);
  const doubleShutout = awayShutout * homeShutout; // 1-0 type game
  
  // Blowout probability (7+ run differential)
  let blowoutProb = 0;
  for (let a = 0; a <= maxRuns; a++) {
    for (let h = 0; h <= maxRuns; h++) {
      if (Math.abs(a - h) >= 7) {
        blowoutProb += scoreMatrix[a][h];
      }
    }
  }
  
  // Extra innings probability (tied after 9)
  // Approximate: what's the probability of a tie in the matrix?
  let tieProb = 0;
  for (let s = 0; s <= maxRuns; s++) {
    tieProb += scoreMatrix[s][s];
  }
  
  return {
    projectedTotal: +projTotal.toFixed(2),
    awayExpRuns: +lambdaAway.toFixed(2),
    homeExpRuns: +lambdaHome.toFixed(2),
    model: 'negative-binomial',
    r: +r.toFixed(2),
    overdispersion: +(1 + lambdaAway / r).toFixed(3),
    lines: totalProbs,
    teamTotals,
    topScores: topScores.slice(0, 10).map(s => ({
      score: `${s.away}-${s.home}`,
      prob: +(s.prob * 100).toFixed(2),
    })),
    variance: {
      awayPoisson: +lambdaAway.toFixed(2), // Poisson variance = mean
      awayNB: +actualVarianceAway.toFixed(2), // NB variance > mean
      homePoisson: +lambdaHome.toFixed(2),
      homeNB: +actualVarianceHome.toFixed(2),
      overdispersionRatio: +((actualVarianceAway / lambdaAway + actualVarianceHome / lambdaHome) / 2).toFixed(3),
      note: 'NB variance > Poisson variance → better models extreme outcomes',
    },
    specialMarkets: {
      awayShutout: { prob: +(awayShutout * 100).toFixed(2), ml: probToML(awayShutout) },
      homeShutout: { prob: +(homeShutout * 100).toFixed(2), ml: probToML(homeShutout) },
      blowout7plus: { prob: +(blowoutProb * 100).toFixed(2) },
      extraInnings: { prob: +(tieProb * 100).toFixed(2) },
    },
  };
}

/**
 * Compare Negative Binomial vs Poisson for a game.
 * Shows where NB diverges from Poisson — these are the edges.
 */
function compareModels(awayExpRuns, homeExpRuns, opts = {}) {
  const r = opts.r || getGameR(opts);
  const lines = [6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11];
  
  const comparison = {};
  for (const line of lines) {
    // Poisson O/U
    let poissonOver = 0, poissonUnder = 0;
    for (let a = 0; a <= 20; a++) {
      for (let h = 0; h <= 20; h++) {
        const p = poissonPMF(awayExpRuns, a) * poissonPMF(homeExpRuns, h);
        const total = a + h;
        if (total > line) poissonOver += p;
        else if (total < line) poissonUnder += p;
      }
    }
    
    // NB O/U
    let nbOver = 0, nbUnder = 0;
    for (let a = 0; a <= 20; a++) {
      for (let h = 0; h <= 20; h++) {
        const p = negBinPMF(a, awayExpRuns, r) * negBinPMF(h, homeExpRuns, r);
        const total = a + h;
        if (total > line) nbOver += p;
        else if (total < line) nbUnder += p;
      }
    }
    
    comparison[line] = {
      poissonOver: +poissonOver.toFixed(4),
      nbOver: +nbOver.toFixed(4),
      overDiff: +((nbOver - poissonOver) * 100).toFixed(2),
      poissonUnder: +poissonUnder.toFixed(4),
      nbUnder: +nbUnder.toFixed(4),
      underDiff: +((nbUnder - poissonUnder) * 100).toFixed(2),
      note: Math.abs(nbOver - poissonOver) > 0.015 ? '⚠️ SIGNIFICANT DIVERGENCE' : '',
    };
  }
  
  // Win probability comparison
  const poissonWP = poissonWinProb(awayExpRuns, homeExpRuns);
  const nbWP = negBinWinProb(awayExpRuns, homeExpRuns, r);
  
  return {
    r,
    projectedTotal: +(awayExpRuns + homeExpRuns).toFixed(2),
    winProb: {
      poisson: { away: poissonWP.away, home: poissonWP.home },
      negBin: { away: nbWP.away, home: nbWP.home },
      wpDiff: {
        away: +((nbWP.away - poissonWP.away) * 100).toFixed(2),
        home: +((nbWP.home - poissonWP.home) * 100).toFixed(2),
      },
    },
    totalLines: comparison,
    insight: generateInsight(comparison, awayExpRuns, homeExpRuns, r),
  };
}

function poissonWinProb(awayLambda, homeLambda) {
  const maxRuns = 20;
  let awayWin = 0, homeWin = 0, tie = 0;
  for (let a = 0; a <= maxRuns; a++) {
    for (let h = 0; h <= maxRuns; h++) {
      const prob = poissonPMF(awayLambda, a) * poissonPMF(homeLambda, h);
      if (a > h) awayWin += prob;
      else if (h > a) homeWin += prob;
      else tie += prob;
    }
  }
  const total = awayWin + homeWin;
  if (total === 0) return { away: 0.5, home: 0.5 };
  return {
    away: +((awayWin + tie * awayWin / total).toFixed(4)),
    home: +((homeWin + tie * homeWin / total).toFixed(4)),
  };
}

function generateInsight(comparison, awayExp, homeExp, r) {
  const total = awayExp + homeExp;
  const insights = [];
  
  // Find the line closest to projected total
  const closestLine = Object.keys(comparison).reduce((best, line) => {
    return Math.abs(line - total) < Math.abs(best - total) ? +line : best;
  }, 8.5);
  
  const nearData = comparison[closestLine];
  if (nearData) {
    if (Math.abs(nearData.overDiff) > 1.0) {
      insights.push(`At ${closestLine} total, NB shifts ${nearData.overDiff > 0 ? 'OVER' : 'UNDER'} by ${Math.abs(nearData.overDiff).toFixed(1)}% vs Poisson`);
    }
  }
  
  if (r < 5.0) {
    insights.push(`High variance game (r=${r.toFixed(1)}) — extreme outcomes more likely`);
  }
  if (r > 8.0) {
    insights.push(`Low variance game (r=${r.toFixed(1)}) — close to Poisson, tight game expected`);
  }
  
  // Look for lines with biggest NB vs Poisson divergence
  let maxDivergence = { line: 0, diff: 0 };
  for (const [line, data] of Object.entries(comparison)) {
    if (Math.abs(data.overDiff) > Math.abs(maxDivergence.diff)) {
      maxDivergence = { line: +line, diff: data.overDiff };
    }
  }
  if (Math.abs(maxDivergence.diff) > 2.0) {
    insights.push(`Biggest edge at ${maxDivergence.line}: NB ${maxDivergence.diff > 0 ? 'favors OVER' : 'favors UNDER'} by ${Math.abs(maxDivergence.diff).toFixed(1)}%`);
  }
  
  return insights;
}

// ==================== HELPERS ====================

function probToML(prob) {
  if (prob <= 0.001) return 99999;
  if (prob >= 0.999) return -99999;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function getStatus() {
  return {
    service: 'neg-binomial',
    version: '1.0',
    description: 'Negative Binomial scoring model for MLB totals',
    baseR: R_BASE,
    parks: Object.keys(PARK_R_ADJUSTMENTS).length,
    advantage: 'Properly models overdispersion — better at extreme outcomes (shutouts, blowouts) than Poisson',
    openingDay: 'Uses lower r (more variance) for early season uncertainty',
  };
}

module.exports = {
  negBinPMF,
  negBinCDF,
  negBinWinProb,
  calculateNBTotals,
  compareModels,
  getGameR,
  getStatus,
  R_BASE,
  PARK_R_ADJUSTMENTS,
  probToML,
  logGamma,
  logBinom,
};
