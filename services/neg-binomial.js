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

// ==================== RUN LINE PROBABILITIES ====================
/**
 * Calculate exact run line probabilities using NB score distribution matrix.
 * 
 * This replaces the normal approximation in mlb.js (normalCDF with stdDev=3.8)
 * with mathematically exact probabilities from the NB score matrix.
 * 
 * MLB run lines are typically ±1.5, but we support any spread.
 * 
 * Key insight: the normal approximation systematically misprices run lines
 * in low-scoring games (underestimates home -1.5 value when total < 7)
 * and high-scoring games (overestimates -1.5 value when total > 11).
 * The NB matrix captures the actual discrete distribution shape.
 * 
 * @param {number} awayExpRuns 
 * @param {number} homeExpRuns 
 * @param {object} opts - { r, spreads, park, ... }
 * @returns {object} Run line probabilities for each spread
 */
function negBinRunLineProb(awayExpRuns, homeExpRuns, opts = {}) {
  const r = opts.r || getGameR(opts);
  const lambdaAway = Math.max(0.5, awayExpRuns);
  const lambdaHome = Math.max(0.5, homeExpRuns);
  const maxRuns = 20;
  
  // Build score probability matrix
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
  // Normalize
  if (matrixSum > 0 && matrixSum < 0.99) {
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        scoreMatrix[a][h] /= matrixSum;
      }
    }
  }
  
  // Calculate run line probabilities for standard spreads
  const spreads = opts.spreads || [-1.5, -2.5, -3.5, 1.5, 2.5, 3.5];
  const result = {};
  
  for (const spread of spreads) {
    let coverProb = 0;
    let failProb = 0;
    let pushProb = 0;
    
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        const prob = scoreMatrix[a][h];
        // Home team spread: home margin = h - a
        // If spread is -1.5: home covers if (h - a) > 1.5 → home wins by 2+
        // If spread is +1.5: home covers if (h - a) > -1.5 → home loses by 0 or 1 or wins
        const margin = h - a;
        // "covers" means home team + spread > 0
        const adjustedMargin = margin + spread;
        
        if (adjustedMargin > 0) coverProb += prob;
        else if (adjustedMargin < 0) failProb += prob;
        else pushProb += prob;
      }
    }
    
    // Handle tie scenarios: if running total has residual pushes, split them
    // (shouldn't happen with 0.5 spreads, but can with whole numbers)
    if (pushProb > 0.001) {
      // For whole number spreads, push probability is real
      result[spread] = {
        homeCover: +coverProb.toFixed(4),
        awayCover: +failProb.toFixed(4),
        push: +pushProb.toFixed(4),
        homeCoverML: probToML(coverProb / (1 - pushProb)),
        awayCoverML: probToML(failProb / (1 - pushProb)),
      };
    } else {
      result[spread] = {
        homeCover: +coverProb.toFixed(4),
        awayCover: +failProb.toFixed(4),
        push: 0,
        homeCoverML: probToML(coverProb),
        awayCoverML: probToML(failProb),
      };
    }
  }
  
  // Also provide exact margin distribution (useful for alt run lines)
  const marginDist = {};
  for (let margin = -15; margin <= 15; margin++) {
    let prob = 0;
    for (let a = 0; a <= maxRuns; a++) {
      const h = a + margin;
      if (h >= 0 && h <= maxRuns) {
        prob += scoreMatrix[a][h];
      }
    }
    if (prob > 0.001) {
      marginDist[margin] = +prob.toFixed(4);
    }
  }
  
  return {
    spreads: result,
    marginDist,
    model: 'negative-binomial',
    r: +r.toFixed(2),
  };
}


// ==================== F5 (FIRST 5 INNINGS) MODEL ====================
/**
 * Calculate F5 (first 5 innings) win probabilities using NB score distributions.
 * 
 * F5 is a HUGE edge market on Opening Day because:
 * - Starters go deeper (5.8 IP vs 5.5) = F5 is ALL about the starter matchup
 * - Bullpen uncertainty is eliminated
 * - Market prices F5 less efficiently than full game
 * - On Opening Day, ace starters pitch even deeper (~6+ IP)
 * 
 * We scale expected runs to F5 proportion, then use NB for exact scoring distribution.
 * F5 runs are NOT just 5/9 of full game — starter IP varies by quality.
 * 
 * @param {number} awayExpRuns - Full game away expected runs
 * @param {number} homeExpRuns - Full game home expected runs
 * @param {object} opts - { f5Factor, isOpeningDay, awayPitcherRating, homePitcherRating, ... }
 * @returns {object} F5 win/draw probabilities, F5 totals, F5 run lines
 */
function negBinF5(awayExpRuns, homeExpRuns, opts = {}) {
  // Calculate F5 expected runs
  // Default F5 fraction: 56.5% of total runs happen in first 5 innings
  // With ace starters: lower (they suppress scoring more in F5)
  // Opening Day: even lower (starters go deep, bullpens don't get exposed)
  let f5Factor = opts.f5Factor || 0.565;
  
  if (opts.isOpeningDay) {
    f5Factor = 0.545; // OD starters go ~6 IP minimum, F5 is all aces
  }
  
  // Pitcher-quality adjustment: better pitchers suppress F5 scoring MORE
  // because they're guaranteed to be pitching all 5 innings
  const awayPR = opts.awayPitcherRating || 50;
  const homePR = opts.homePitcherRating || 50;
  
  // Ace pitcher (rating 80+) suppresses F5 by extra ~3%
  // Replacement pitcher (rating 30) doesn't suppress as much
  const awayPitchSuppress = Math.max(0, (awayPR - 50) / 1000); // 0 to 0.04 for ratings 50-90
  const homePitchSuppress = Math.max(0, (homePR - 50) / 1000);
  
  // Away pitcher faces HOME batters → suppresses HOME team F5 runs
  const homeF5Runs = Math.max(0.3, homeExpRuns * (f5Factor - awayPitchSuppress));
  // Home pitcher faces AWAY batters → suppresses AWAY team F5 runs
  const awayF5Runs = Math.max(0.3, awayExpRuns * (f5Factor - homePitchSuppress));
  
  // For F5, use slightly lower r (less variance in 5 innings — shorter sample)
  const baseR = opts.r || getGameR(opts);
  const f5R = baseR * 1.3; // Higher r = less variance for shorter game
  
  const maxRuns = 12; // F5 cap is lower
  
  // Build F5 score matrix
  const scoreMatrix = [];
  let matrixSum = 0;
  for (let a = 0; a <= maxRuns; a++) {
    scoreMatrix[a] = [];
    for (let h = 0; h <= maxRuns; h++) {
      const p = negBinPMF(a, awayF5Runs, f5R) * negBinPMF(h, homeF5Runs, f5R);
      scoreMatrix[a][h] = p;
      matrixSum += p;
    }
  }
  if (matrixSum > 0 && matrixSum < 0.99) {
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        scoreMatrix[a][h] /= matrixSum;
      }
    }
  }
  
  // F5 win/loss/draw probabilities
  // NOTE: F5 has a DRAW option (unlike full game). This is key for F5 moneylines.
  let awayWin = 0, homeWin = 0, draw = 0;
  for (let a = 0; a <= maxRuns; a++) {
    for (let h = 0; h <= maxRuns; h++) {
      const prob = scoreMatrix[a][h];
      if (a > h) awayWin += prob;
      else if (h > a) homeWin += prob;
      else draw += prob;
    }
  }
  
  // F5 total lines
  const f5TotalLines = [3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
  const f5Totals = {};
  for (const line of f5TotalLines) {
    let over = 0, under = 0;
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        const total = a + h;
        const prob = scoreMatrix[a][h];
        if (total > line) over += prob;
        else if (total < line) under += prob;
      }
    }
    f5Totals[line] = {
      over: +over.toFixed(4),
      under: +under.toFixed(4),
      overML: probToML(over),
      underML: probToML(under),
    };
  }
  
  // F5 run line (±0.5 is the standard F5 run line)
  const f5RunLines = {};
  for (const spread of [-0.5, 0.5, -1.5, 1.5]) {
    let homeCover = 0, awayCover = 0;
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        const prob = scoreMatrix[a][h];
        const margin = (h - a) + spread;
        if (margin > 0) homeCover += prob;
        else if (margin < 0) awayCover += prob;
      }
    }
    f5RunLines[spread] = {
      homeCover: +homeCover.toFixed(4),
      awayCover: +awayCover.toFixed(4),
      homeCoverML: probToML(homeCover),
      awayCoverML: probToML(awayCover),
    };
  }
  
  // F5 team totals
  const f5TeamTotalLines = [0.5, 1.5, 2.5, 3.5, 4.5];
  const f5TeamTotals = {};
  for (const line of f5TeamTotalLines) {
    let awayOver = 0, awayUnder = 0;
    for (let a = 0; a <= maxRuns; a++) {
      const p = negBinPMF(a, awayF5Runs, f5R);
      if (a > line) awayOver += p;
      else if (a < line) awayUnder += p;
    }
    let homeOver = 0, homeUnder = 0;
    for (let h = 0; h <= maxRuns; h++) {
      const p = negBinPMF(h, homeF5Runs, f5R);
      if (h > line) homeOver += p;
      else if (h < line) homeUnder += p;
    }
    f5TeamTotals[line] = {
      away: { over: +awayOver.toFixed(4), under: +awayUnder.toFixed(4), overML: probToML(awayOver), underML: probToML(awayUnder) },
      home: { over: +homeOver.toFixed(4), under: +homeUnder.toFixed(4), overML: probToML(homeOver), underML: probToML(homeUnder) },
    };
  }
  
  return {
    awayWin: +awayWin.toFixed(4),
    homeWin: +homeWin.toFixed(4),
    draw: +draw.toFixed(4),
    awayWinML: probToML(awayWin),
    homeWinML: probToML(homeWin),
    // 3-way ML (includes draw as separate outcome)
    threeWay: {
      away: +awayWin.toFixed(4),
      home: +homeWin.toFixed(4),
      draw: +draw.toFixed(4),
      awayML: probToML(awayWin),
      homeML: probToML(homeWin),
      drawML: probToML(draw),
    },
    // 2-way (no draw — split draws proportionally)
    twoWay: {
      awayWin: +(awayWin + draw * awayWin / (awayWin + homeWin)).toFixed(4),
      homeWin: +(homeWin + draw * homeWin / (awayWin + homeWin)).toFixed(4),
    },
    f5Total: +(awayF5Runs + homeF5Runs).toFixed(2),
    awayF5Runs: +awayF5Runs.toFixed(2),
    homeF5Runs: +homeF5Runs.toFixed(2),
    totals: f5Totals,
    runLines: f5RunLines,
    teamTotals: f5TeamTotals,
    model: 'negative-binomial-f5',
    f5Factor,
    r: +f5R.toFixed(2),
  };
}


// ==================== F3 (FIRST 3 INNINGS) MODEL ====================
/**
 * Calculate F3 (first 3 innings) win probabilities using NB score distributions.
 * 
 * F3 is an EVEN BIGGER edge than F5 because:
 * 1. FIRST-TIME-THROUGH-ORDER (FTTO) advantage — batters see the starter's full arsenal
 *    for the first time in innings 1-3. In 2024, starters had a .290 wOBA FTTO vs .320 
 *    second-time-through and .340 third-time-through. This is a 15-17% improvement for pitchers.
 * 2. Books price F3 with LESS data than F5/full game → softer lines → more edge
 * 3. Opening Day compounds FTTO — batters haven't faced regular season pitching at all
 * 4. Cold weather suppresses offense MORE in early innings (muscles not loose)
 * 5. F3 eliminates ALL bullpen variance — it's purely starter vs lineup (top of order)
 * 
 * F3 runs are NOT 3/9 of full game — because:
 * - FTTO means innings 1-3 score LESS than innings 4-6
 * - Starter is freshest (highest velo, sharpest breaking stuff)
 * - Lineup turns over only 1x in 3 innings (face 9 batters ≈ 1 trip through)
 * 
 * Historical F3 fraction: ~0.305-0.330 of full game runs
 * - Ace matchups: ~0.29 (elite FTTO suppression)
 * - Average matchups: ~0.32
 * - Bad pitchers: ~0.34 (get hit hard even FTTO)
 * 
 * Markets available via The Odds API:
 * - h2h_1st_3_innings (F3 moneyline)
 * - totals_1st_3_innings (F3 total)
 * - spreads_1st_3_innings (F3 spread)
 * 
 * @param {number} awayExpRuns - Full game expected away runs
 * @param {number} homeExpRuns - Full game expected home runs
 * @param {object} opts - Options (isOpeningDay, pitcherRatings, parkFactor, weather)
 * @returns {object} F3 win/draw/total probabilities, spreads, team totals
 */
function negBinF3(awayExpRuns, homeExpRuns, opts = {}) {
  // ==================== F3 FRACTION CALCULATION ====================
  // Base F3 fraction of full game runs
  // Historical data: first 3 innings produce ~31-32% of total runs
  // Lower than 3/9 (33.3%) because of FTTO advantage
  let f3Factor = opts.f3Factor || 0.320;
  
  if (opts.isOpeningDay) {
    // OD starters are aces throwing their hardest, batters haven't seen live pitching
    // FTTO effect is AMPLIFIED on Opening Day
    f3Factor = 0.295; // OD aces in first 3 = massive suppression
  }
  
  // ==================== PITCHER QUALITY FTTO ADJUSTMENT ====================
  // Better pitchers have an even bigger FTTO advantage
  // Because they have more pitch types, better deception, more movement
  // Elite starters: .270 wOBA FTTO (vs .320 overall) = ~16% suppression
  // Average starters: .300 wOBA FTTO (vs .320 overall) = ~6% suppression
  // Bad starters: .315 wOBA FTTO (vs .335 overall) = ~6% suppression
  const awayPR = opts.awayPitcherRating || 50;
  const homePR = opts.homePitcherRating || 50;
  
  // FTTO suppression: ace (90) gets ~0.025 extra suppression, scrub (30) gets ~0
  // This is STRONGER than F5 because F3 is ALL FTTO, F5 includes some 2nd-time-through
  const awayFTTOSuppress = Math.max(0, (awayPR - 35) / 600); // 0 to ~0.092 for 35-90 rating
  const homeFTTOSuppress = Math.max(0, (homePR - 35) / 600);
  
  // Away pitcher faces HOME batters → suppresses HOME team F3 runs
  const homeF3Runs = Math.max(0.15, homeExpRuns * (f3Factor - awayFTTOSuppress));
  // Home pitcher faces AWAY batters → suppresses AWAY team F3 runs
  const awayF3Runs = Math.max(0.15, awayExpRuns * (f3Factor - homeFTTOSuppress));
  
  // ==================== COLD WEATHER F3 ADJUSTMENT ====================
  // Cold weather has MORE impact on F3 than F5/full game because:
  // - Muscles not warmed up yet in early innings
  // - Ball doesn't carry as far when cold
  // - Pitcher grip is tighter on fresh arm
  let coldAdj = 1.0;
  if (opts.temperature && opts.temperature < 55) {
    // Sub-55°F: reduce F3 scoring by 2-6%
    coldAdj = 1.0 - Math.min(0.06, (55 - opts.temperature) * 0.002);
  }
  
  const adjHomeF3 = homeF3Runs * coldAdj;
  const adjAwayF3 = awayF3Runs * coldAdj;
  
  // ==================== NB OVERDISPERSION ====================
  // F3 has LESS variance than F5 or full game — shorter sample = less extreme outcomes
  // Higher r = closer to Poisson = less variance
  const baseR = opts.r || getGameR(opts);
  const f3R = baseR * 1.6; // Higher r than F5 (1.3) because even shorter game
  
  const maxRuns = 10; // F3 cap is lower than F5 (12) or full game (20)
  
  // ==================== BUILD SCORE MATRIX ====================
  const scoreMatrix = [];
  let matrixSum = 0;
  for (let a = 0; a <= maxRuns; a++) {
    scoreMatrix[a] = [];
    for (let h = 0; h <= maxRuns; h++) {
      const p = negBinPMF(a, adjAwayF3, f3R) * negBinPMF(h, adjHomeF3, f3R);
      scoreMatrix[a][h] = p;
      matrixSum += p;
    }
  }
  // Normalize
  if (matrixSum > 0 && matrixSum < 0.99) {
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        scoreMatrix[a][h] /= matrixSum;
      }
    }
  }
  
  // ==================== WIN/DRAW PROBABILITIES ====================
  // F3 has a DRAW option like F5 (game doesn't end after 3 innings)
  // Draw probability is HIGHER in F3 than F5 because fewer runs = more ties
  // This is KEY for F3 moneylines — books often underprice draw
  let awayWin = 0, homeWin = 0, draw = 0;
  for (let a = 0; a <= maxRuns; a++) {
    for (let h = 0; h <= maxRuns; h++) {
      const prob = scoreMatrix[a][h];
      if (a > h) awayWin += prob;
      else if (h > a) homeWin += prob;
      else draw += prob;
    }
  }
  
  // ==================== F3 TOTAL LINES ====================
  const f3TotalLines = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
  const f3Totals = {};
  for (const line of f3TotalLines) {
    let over = 0, under = 0;
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        const total = a + h;
        const prob = scoreMatrix[a][h];
        if (total > line) over += prob;
        else if (total < line) under += prob;
        // total === line is a push
      }
    }
    f3Totals[line] = {
      over: +over.toFixed(4),
      under: +under.toFixed(4),
      overML: probToML(over),
      underML: probToML(under),
    };
  }
  
  // ==================== F3 SPREAD LINES ====================
  const f3SpreadLines = [-0.5, 0.5, -1.5, 1.5, -2.5, 2.5];
  const f3Spreads = {};
  for (const spread of f3SpreadLines) {
    let homeCover = 0, awayCover = 0;
    for (let a = 0; a <= maxRuns; a++) {
      for (let h = 0; h <= maxRuns; h++) {
        const prob = scoreMatrix[a][h];
        const margin = (h - a) + spread;
        if (margin > 0) homeCover += prob;
        else if (margin < 0) awayCover += prob;
      }
    }
    f3Spreads[spread] = {
      homeCover: +homeCover.toFixed(4),
      awayCover: +awayCover.toFixed(4),
      homeCoverML: probToML(homeCover),
      awayCoverML: probToML(awayCover),
    };
  }
  
  // ==================== F3 TEAM TOTALS ====================
  const f3TeamTotalLines = [0.5, 1.5, 2.5, 3.5];
  const f3TeamTotals = {};
  for (const line of f3TeamTotalLines) {
    let awayOver = 0, awayUnder = 0;
    for (let a = 0; a <= maxRuns; a++) {
      const p = negBinPMF(a, adjAwayF3, f3R);
      if (a > line) awayOver += p;
      else if (a < line) awayUnder += p;
    }
    let homeOver = 0, homeUnder = 0;
    for (let h = 0; h <= maxRuns; h++) {
      const p = negBinPMF(h, adjHomeF3, f3R);
      if (h > line) homeOver += p;
      else if (h < line) homeUnder += p;
    }
    f3TeamTotals[line] = {
      away: { over: +awayOver.toFixed(4), under: +awayUnder.toFixed(4), overML: probToML(awayOver), underML: probToML(awayUnder) },
      home: { over: +homeOver.toFixed(4), under: +homeUnder.toFixed(4), overML: probToML(homeOver), underML: probToML(homeUnder) },
    };
  }
  
  // ==================== MOST LIKELY SCORES ====================
  const topScores = [];
  for (let a = 0; a <= maxRuns; a++) {
    for (let h = 0; h <= maxRuns; h++) {
      topScores.push({ away: a, home: h, prob: +scoreMatrix[a][h].toFixed(4) });
    }
  }
  topScores.sort((a, b) => b.prob - a.prob);
  
  return {
    awayWin: +awayWin.toFixed(4),
    homeWin: +homeWin.toFixed(4),
    draw: +draw.toFixed(4),
    awayWinML: probToML(awayWin),
    homeWinML: probToML(homeWin),
    // 3-way ML (includes draw as separate outcome — critical for F3 pricing)
    threeWay: {
      away: +awayWin.toFixed(4),
      home: +homeWin.toFixed(4),
      draw: +draw.toFixed(4),
      awayML: probToML(awayWin),
      homeML: probToML(homeWin),
      drawML: probToML(draw),
    },
    // 2-way (split draws proportionally)
    twoWay: {
      awayWin: +(awayWin + draw * awayWin / (awayWin + homeWin || 1)).toFixed(4),
      homeWin: +(homeWin + draw * homeWin / (awayWin + homeWin || 1)).toFixed(4),
    },
    f3Total: +(adjAwayF3 + adjHomeF3).toFixed(2),
    awayF3Runs: +adjAwayF3.toFixed(2),
    homeF3Runs: +adjHomeF3.toFixed(2),
    totals: f3Totals,
    spreads: f3Spreads,
    teamTotals: f3TeamTotals,
    topScores: topScores.slice(0, 10),
    model: 'negative-binomial-f3',
    f3Factor,
    r: +f3R.toFixed(2),
    fttoNote: 'First-Time-Through-Order advantage = innings 1-3 suppress scoring ~15% vs innings 4-6',
  };
}


// ==================== CONVICTION SCORE ENGINE ====================
/**
 * Calculate a 0-100 conviction score that aggregates ALL model signals.
 * 
 * This is the "should I actually bet this?" number.
 * 
 * Signals aggregated:
 * 1. Edge size (model prob vs market prob)
 * 2. Model agreement (analytical + MC + ML agree?)
 * 3. Pitcher quality confidence (known ace vs unknown)
 * 4. Weather data availability
 * 5. Lineup confirmation
 * 6. Statcast support
 * 7. Historical CLV track record for this type of bet
 * 8. Market movement direction (are sharps on our side?)
 * 
 * Score interpretation:
 * 90-100: SMASH — max Kelly, everything lines up
 * 75-89:  STRONG — full Kelly bet
 * 60-74:  SOLID — half Kelly
 * 45-59:  LEAN — quarter Kelly
 * 30-44:  MARGINAL — tiny bet or pass
 * 0-29:   FADE — model is uncertain, don't bet
 * 
 * @param {object} prediction - Output from mlb.predict() or asyncPredict()
 * @param {object} market - { homeML, awayML, total, homeSpread }
 * @param {object} opts - Additional context { lineMovement, clvHistory, ... }
 * @returns {object} Conviction score with breakdown
 */
function convictionScore(prediction, market = {}, opts = {}) {
  let score = 0;
  const breakdown = [];
  
  // 1. EDGE SIZE (0-25 points)
  // v68.0: Works WITH or WITHOUT market data
  // With market: edge = model prob - implied prob (most accurate)
  // Without market: edge derived from model confidence (how far from 50/50)
  let edgePoints = 0;
  if (market.homeML && prediction.homeWinProb) {
    // BEST: Real market data available — calculate actual edge
    const impliedProb = mlToProb(market.homeML);
    const modelProb = prediction.blendedHomeWinProb || prediction.homeWinProb;
    const edge = Math.abs(modelProb - impliedProb);
    
    if (edge > 0.10) edgePoints = 25;       // 10%+ edge = max
    else if (edge > 0.07) edgePoints = 20;   // 7-10% edge
    else if (edge > 0.05) edgePoints = 16;   // 5-7% edge
    else if (edge > 0.03) edgePoints = 12;   // 3-5% edge
    else if (edge > 0.02) edgePoints = 8;    // 2-3% edge
    else if (edge > 0.01) edgePoints = 4;    // 1-2% edge
    else edgePoints = 0;
    
    breakdown.push({ signal: 'edge', points: edgePoints, detail: `${(edge * 100).toFixed(1)}% model edge vs market`, source: 'market' });
  } else {
    // FALLBACK: No market data — use model confidence as proxy
    // How far is our prediction from 50/50? More decisive = higher conviction
    const modelProb = prediction.blendedHomeWinProb || prediction.homeWinProb;
    const awayProb = prediction.blendedAwayWinProb || prediction.awayWinProb;
    const favProb = Math.max(modelProb || 0.5, awayProb || 0.5);
    const confidenceGap = favProb - 0.50; // How far from coin flip
    
    if (confidenceGap > 0.20) edgePoints = 20;       // 70%+ favorite = very decisive
    else if (confidenceGap > 0.15) edgePoints = 16;   // 65%+ favorite
    else if (confidenceGap > 0.10) edgePoints = 12;   // 60%+ favorite
    else if (confidenceGap > 0.06) edgePoints = 8;    // 56%+ favorite
    else if (confidenceGap > 0.03) edgePoints = 4;    // 53%+ slight lean
    else edgePoints = 1;                               // Coin flip — minimal conviction
    
    breakdown.push({ signal: 'confidence', points: edgePoints, detail: `${(favProb * 100).toFixed(1)}% model confidence (${(confidenceGap * 100).toFixed(1)}% from 50/50)`, source: 'model' });
  }
  score += edgePoints;
  
  // 2. MODEL AGREEMENT (0-20 points)
  // Do analytical, Monte Carlo, and ML models all agree on the same side?
  let agreementPoints = 0;
  const sides = [];
  
  // Analytical
  if (prediction.homeWinProb > 0.52) sides.push('home');
  else if (prediction.awayWinProb > 0.52) sides.push('away');
  else sides.push('toss-up');
  
  // Monte Carlo
  if (prediction.monteCarlo) {
    if (prediction.monteCarlo.homeWinProb > 0.52) sides.push('home');
    else if (prediction.monteCarlo.awayWinProb > 0.52) sides.push('away');
    else sides.push('toss-up');
  }
  
  // ML Ensemble
  if (prediction.ml) {
    if (prediction.ml.homeWinProb > 0.52) sides.push('home');
    else if (prediction.ml.awayWinProb > 0.52) sides.push('away');
    else sides.push('toss-up');
  }
  
  // Blended
  if (prediction.blendedHomeWinProb > 0.52) sides.push('home');
  else if (prediction.blendedAwayWinProb > 0.52) sides.push('away');
  
  const uniqueSides = [...new Set(sides.filter(s => s !== 'toss-up'))];
  if (uniqueSides.length === 1 && sides.length >= 3) {
    agreementPoints = 20; // All models agree
    breakdown.push({ signal: 'agreement', points: 20, detail: `All ${sides.length} models agree: ${uniqueSides[0]}` });
  } else if (uniqueSides.length === 1 && sides.length >= 2) {
    agreementPoints = 14; // 2 models agree
    breakdown.push({ signal: 'agreement', points: 14, detail: `${sides.length} models agree: ${uniqueSides[0]}` });
  } else if (uniqueSides.length <= 1) {
    agreementPoints = 8; // At least 1 model has direction
    breakdown.push({ signal: 'agreement', points: 8, detail: 'Limited model agreement' });
  } else {
    agreementPoints = 0; // Models disagree
    breakdown.push({ signal: 'agreement', points: 0, detail: '⚠️ Models disagree on direction' });
  }
  score += agreementPoints;
  
  // 3. PITCHER CONFIDENCE (0-15 points)
  // Known ace matchup vs unknown pitcher
  let pitcherPoints = 0;
  const ap = prediction.awayPitcher;
  const hp = prediction.homePitcher;
  
  if (ap && hp) {
    const avgRating = ((ap.rating || 50) + (hp.rating || 50)) / 2;
    // Known pitchers with high ratings = more predictable
    if (avgRating >= 70) pitcherPoints = 15;
    else if (avgRating >= 60) pitcherPoints = 12;
    else if (avgRating >= 50) pitcherPoints = 9;
    else pitcherPoints = 6;
    breakdown.push({ signal: 'pitchers', points: pitcherPoints, detail: `Avg rating ${avgRating.toFixed(0)} — ${ap.name || 'TBD'} vs ${hp.name || 'TBD'}` });
  } else if (ap || hp) {
    pitcherPoints = 4;
    breakdown.push({ signal: 'pitchers', points: 4, detail: 'Only 1 pitcher confirmed' });
  } else {
    pitcherPoints = 0;
    breakdown.push({ signal: 'pitchers', points: 0, detail: '⚠️ No pitcher data' });
  }
  score += pitcherPoints;
  
  // 4. DATA QUALITY (0-15 points)
  // v68.0: Score data availability from both _asyncSignals AND result.factors
  let dataPoints = 0;
  
  const signals = prediction._asyncSignals || {};
  const factors = prediction.factors || {};
  
  // Weather data (4 pts)
  if (signals.weather || (factors.weather && factors.weather.multiplier && factors.weather.multiplier !== 1.0)) {
    dataPoints += 4;
    const desc = signals.weatherDetail?.description || factors.weather?.description || '';
    breakdown.push({ signal: 'weather', points: 4, detail: `Weather active: ${desc}` });
  }
  
  // Lineup data (4 pts)
  if (signals.lineup || (factors.lineup && factors.lineup.status === 'confirmed')) {
    dataPoints += 4;
    breakdown.push({ signal: 'lineup', points: 4, detail: 'Confirmed lineups' });
  }
  
  // Umpire data (4 pts)
  if (signals.umpire || (factors.umpire && factors.umpire.name)) {
    dataPoints += 4;
    const umpName = signals.umpireDetail?.name || factors.umpire?.name || '';
    breakdown.push({ signal: 'umpire', points: 4, detail: `HP umpire: ${umpName}` });
  }
  
  // Rest/travel data (3 pts)
  if (signals.restTravel || factors.awayRest || factors.homeRest) {
    dataPoints += 3;
    breakdown.push({ signal: 'rest', points: 3, detail: 'Rest/travel data' });
  }
  
  // Statcast bonus
  if (prediction.factors?.statcast) {
    dataPoints += 3;
    breakdown.push({ signal: 'statcast', points: 3, detail: 'Statcast xERA/xwOBA active' });
  }
  
  // Catcher framing data
  if (prediction.factors?.catcherFraming && prediction.factors.catcherFraming.framingGap) {
    dataPoints += 2;
    const gap = Math.abs(prediction.factors.catcherFraming.framingGap);
    breakdown.push({ signal: 'catcherFraming', points: 2, detail: `Catcher framing data (${gap.toFixed(1)} gap)` });
  }
  
  // Platoon split data  
  if (prediction.factors?.awayPlatoon || prediction.factors?.homePlatoon) {
    dataPoints += 2;
    breakdown.push({ signal: 'platoonData', points: 2, detail: 'Savant platoon split data' });
  }
  
  // Bullpen quality projections
  if (prediction.factors?.bullpenProjection) {
    dataPoints += 2;
    breakdown.push({ signal: 'bullpenData', points: 2, detail: 'Bullpen quality projections' });
  }
  
  dataPoints = Math.min(15, dataPoints);
  score += dataPoints;
  
  // 5. MARKET CONTEXT (0-10 points)
  // v68.0: Line movement, CLV history, market efficiency signals
  // Without market data: score based on prediction model diversity
  let marketPoints = 0;
  
  if (opts.lineMovement) {
    // If line moved in our direction = sharps agree
    if (opts.lineMovement === 'toward') {
      marketPoints += 7;
      breakdown.push({ signal: 'lineMove', points: 7, detail: 'Line moving toward our side (sharp money)' });
    } else if (opts.lineMovement === 'stable') {
      marketPoints += 4;
      breakdown.push({ signal: 'lineMove', points: 4, detail: 'Line stable' });
    } else if (opts.lineMovement === 'against') {
      marketPoints += 0;
      breakdown.push({ signal: 'lineMove', points: 0, detail: '⚠️ Line moving against us' });
    }
  } else if (market.homeML) {
    // Have market data but no movement info — give partial credit
    marketPoints += 3;
    breakdown.push({ signal: 'marketData', points: 3, detail: 'Market comparison available' });
  } else {
    // No market data at all — give points for prediction model diversity instead
    // (more model types contributing = better convergence)
    let modelCount = 0;
    if (prediction.homeWinProb) modelCount++; // Analytical
    if (prediction.monteCarlo) modelCount++; // Monte Carlo  
    if (prediction.ml) modelCount++; // ML ensemble
    if (prediction.f5?.model === 'negative-binomial-f5') modelCount++; // NB F5
    if (prediction.altRunLines?.model === 'negative-binomial') modelCount++; // NB run lines
    
    if (modelCount >= 4) {
      marketPoints += 5;
      breakdown.push({ signal: 'modelDiversity', points: 5, detail: `${modelCount} model types contributing` });
    } else if (modelCount >= 2) {
      marketPoints += 3;
      breakdown.push({ signal: 'modelDiversity', points: 3, detail: `${modelCount} model types contributing` });
    } else {
      marketPoints += 1;
      breakdown.push({ signal: 'modelDiversity', points: 1, detail: 'Limited model coverage' });
    }
  }
  
  if (opts.clvPositive) {
    marketPoints += 3;
    breakdown.push({ signal: 'clv', points: 3, detail: 'Positive CLV history for this bet type' });
  }
  
  marketPoints = Math.min(10, marketPoints);
  score += marketPoints;
  
  // 6. SITUATIONAL EDGE (0-15 points)
  // Opening Day, weather extremes, mismatch situations
  let situationalPoints = 0;
  
  if (prediction.factors?.earlySeasonCalibration) {
    situationalPoints += 3;
    breakdown.push({ signal: 'situation', points: 3, detail: 'Early season calibration applied' });
  }
  
  if (prediction.factors?.preseasonTuning) {
    situationalPoints += 3;
    breakdown.push({ signal: 'preseason', points: 3, detail: 'Preseason roster/spring training signals' });
  }
  
  // Weather extremes = strong signal for totals
  if (prediction.factors?.weather?.multiplier) {
    const mult = prediction.factors.weather.multiplier;
    if (mult < 0.92 || mult > 1.06) {
      situationalPoints += 4;
      breakdown.push({ signal: 'weatherExtreme', points: 4, detail: `Extreme weather: ${(mult * 100 - 100).toFixed(1)}% run impact` });
    }
  }
  
  // Massive pitcher mismatch
  if (ap && hp) {
    const ratingDiff = Math.abs((ap.rating || 50) - (hp.rating || 50));
    if (ratingDiff >= 30) {
      situationalPoints += 5;
      breakdown.push({ signal: 'mismatch', points: 5, detail: `Huge pitcher mismatch: ${ratingDiff} rating diff` });
    } else if (ratingDiff >= 20) {
      situationalPoints += 3;
      breakdown.push({ signal: 'mismatch', points: 3, detail: `Pitcher mismatch: ${ratingDiff} rating diff` });
    }
  }
  
  // Platoon split edge — strong signals when LHP faces LHH-heavy lineup
  if (prediction.factors?.awayPlatoon || prediction.factors?.homePlatoon) {
    const awayAdj = Math.abs(prediction.factors?.awayPlatoon?.adjustment || 0);
    const homeAdj = Math.abs(prediction.factors?.homePlatoon?.adjustment || 0);
    const maxAdj = Math.max(awayAdj, homeAdj);
    if (maxAdj >= 8) {
      situationalPoints += 4;
      breakdown.push({ signal: 'platoon', points: 4, detail: `Strong platoon signal: ${maxAdj.toFixed(1)}% run impact` });
    } else if (maxAdj >= 5) {
      situationalPoints += 2;
      breakdown.push({ signal: 'platoon', points: 2, detail: `Moderate platoon signal: ${maxAdj.toFixed(1)}% run impact` });
    }
  }
  
  // Bullpen quality projection — significant reliever movement creates edge
  if (prediction.factors?.bullpenProjection) {
    const bp = prediction.factors.bullpenProjection;
    const awayDelta = Math.abs(bp.away?.delta || 0);
    const homeDelta = Math.abs(bp.home?.delta || 0);
    const maxDelta = Math.max(awayDelta, homeDelta);
    if (maxDelta >= 0.30) {
      situationalPoints += 4;
      breakdown.push({ signal: 'bullpen', points: 4, detail: `Major bullpen projection shift: ${maxDelta.toFixed(2)} ERA delta` });
    } else if (maxDelta >= 0.15) {
      situationalPoints += 2;
      breakdown.push({ signal: 'bullpen', points: 2, detail: `Bullpen projection shift: ${maxDelta.toFixed(2)} ERA delta` });
    }
  }
  
  // Catcher framing edge — large framing gap creates real edge on totals
  if (prediction.factors?.catcherFraming) {
    const gap = Math.abs(prediction.factors.catcherFraming.framingGap || 0);
    if (gap >= 20) {
      situationalPoints += 4;
      breakdown.push({ signal: 'framingEdge', points: 4, detail: `Massive framing gap: ${gap.toFixed(1)} run differential` });
    } else if (gap >= 10) {
      situationalPoints += 2;
      breakdown.push({ signal: 'framingEdge', points: 2, detail: `Significant framing gap: ${gap.toFixed(1)} run differential` });
    }
  }
  
  // Stolen base revolution — aggressive teams create totals edge
  if (prediction.factors?.stolenBases) {
    const sbAdj = Math.abs(prediction.factors.stolenBases.netTotalAdj || 0);
    if (sbAdj >= 0.10) {
      situationalPoints += 2;
      breakdown.push({ signal: 'stolenBases', points: 2, detail: `SB run impact: ${(sbAdj).toFixed(2)} extra runs` });
    }
  }
  
  situationalPoints = Math.min(15, situationalPoints);
  score += situationalPoints;
  
  // Determine grade
  let grade, action;
  if (score >= 90) { grade = 'A+'; action = 'SMASH'; }
  else if (score >= 80) { grade = 'A'; action = 'STRONG BET'; }
  else if (score >= 70) { grade = 'B+'; action = 'SOLID BET'; }
  else if (score >= 60) { grade = 'B'; action = 'LEAN'; }
  else if (score >= 50) { grade = 'C+'; action = 'SMALL BET'; }
  else if (score >= 40) { grade = 'C'; action = 'MARGINAL'; }
  else if (score >= 30) { grade = 'D'; action = 'PASS'; }
  else { grade = 'F'; action = 'FADE'; }
  
  return {
    score: Math.min(100, Math.max(0, score)),
    grade,
    action,
    breakdown,
    kellyFraction: score >= 80 ? 1.0 : score >= 70 ? 0.75 : score >= 60 ? 0.5 : score >= 50 ? 0.25 : 0.1,
    note: `Conviction ${score}/100 (${grade}) — ${action}`,
  };
}

/**
 * Convert American moneyline to implied probability
 */
function mlToProb(ml) {
  if (ml === 0) return 0.5;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}


module.exports = {
  negBinPMF,
  negBinCDF,
  negBinWinProb,
  negBinRunLineProb,
  negBinF5,
  negBinF3,
  convictionScore,
  calculateNBTotals,
  compareModels,
  getGameR,
  getStatus,
  R_BASE,
  PARK_R_ADJUSTMENTS,
  probToML,
  mlToProb,
  logGamma,
  logBinom,
};
