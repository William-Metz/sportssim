/**
 * Monte Carlo Game Simulator — SportsSim v14.0
 * 
 * Instead of single-point Poisson estimates, simulate 10,000 games
 * to get more accurate probability distributions, especially for:
 *   - Run line (-1.5) probabilities
 *   - Total over/under at various lines
 *   - First 5 innings (F5) betting
 *   - Exact score probabilities
 *   - Grand salami (combined totals across multiple games)
 *   - Alternate run lines (-2.5, +2.5, etc.)
 *   
 * Uses negative binomial distribution (better than Poisson for baseball
 * because it accounts for overdispersion — innings cluster runs)
 */

const NUM_SIMS = 10000;

// ==================== RANDOM NUMBER GENERATORS ====================

// Box-Muller for normal distribution
function normalRandom(mean = 0, std = 1) {
  let u1 = Math.random();
  let u2 = Math.random();
  while (u1 === 0) u1 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * std;
}

// Poisson random variable
function poissonRandom(lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // For large lambda, use normal approximation
    return Math.max(0, Math.round(normalRandom(lambda, Math.sqrt(lambda))));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// Negative binomial — better for baseball (accounts for run clustering)
// Mean = lambda, overdispersion parameter r controls variance
// variance = lambda + lambda^2/r (larger r = closer to Poisson)
function negBinomialRandom(lambda, r = 8) {
  if (lambda <= 0) return 0;
  // Use gamma-Poisson mixture representation
  const p = r / (r + lambda);
  // Generate gamma(r, (1-p)/p)
  let gamma = 0;
  for (let i = 0; i < r; i++) {
    gamma -= Math.log(1 - Math.random());
  }
  gamma *= (1 - p) / p;
  // Now generate Poisson(gamma)
  return poissonRandom(gamma);
}

// ==================== INNING-BY-INNING SIMULATION ====================

/**
 * Simulate a single game inning by inning
 * Returns { awayRuns, homeRuns, awayF5, homeF5, innings[] }
 */
function simulateGame(awayLambda, homeLambda, opts = {}) {
  const {
    awayBullpenMult = 1.0,    // bullpen fatigue multiplier
    homeBullpenMult = 1.0,
    starterInnings = 5.5,      // avg innings from starter
    starterQuality = 1.0,      // < 1.0 = better starter, > 1.0 = worse
    overdispersion = 8,        // negative binomial r parameter
  } = opts;
  
  // Split per-inning run rates for starter vs bullpen
  const awayPerInning = awayLambda / 9;
  const homePerInning = homeLambda / 9;
  
  let awayTotal = 0, homeTotal = 0;
  let awayF5 = 0, homeF5 = 0;
  const innings = [];
  
  for (let inn = 1; inn <= 9; inn++) {
    // Starter pitches first ~5.5 innings, bullpen after
    // Use probabilistic transition (40% chance starter pulled after 5, 70% after 6)
    const isStarter = inn <= 5 || (inn === 6 && Math.random() > 0.4) || (inn === 7 && Math.random() > 0.85);
    
    // Away team batting (vs home pitcher)
    let awayMult = isStarter ? starterQuality : homeBullpenMult;
    // Late innings: slightly higher scoring (fatigue, leverage)
    if (inn >= 7) awayMult *= 1.05;
    if (inn === 9) awayMult *= 1.03;
    
    const awayRuns = negBinomialRandom(awayPerInning * awayMult, overdispersion);
    awayTotal += awayRuns;
    if (inn <= 5) awayF5 += awayRuns;
    
    // Home team batting (vs away pitcher)
    let homeMult = isStarter ? starterQuality : awayBullpenMult;
    if (inn >= 7) homeMult *= 1.05;
    
    // Bottom of 9th: home team might not bat (if winning)
    let homeRuns = 0;
    if (inn < 9 || awayTotal > homeTotal) {
      homeRuns = negBinomialRandom(homePerInning * homeMult, overdispersion);
    } else if (inn === 9 && awayTotal === homeTotal) {
      // Tie going into bottom 9 — must play
      homeRuns = negBinomialRandom(homePerInning * homeMult, overdispersion);
    }
    // Walk-off: if home team takes lead in bottom 9, game over
    
    homeTotal += homeRuns;
    if (inn <= 5) homeF5 += homeRuns;
    
    innings.push({ away: awayRuns, home: homeRuns });
    
    // Walk-off check
    if (inn === 9 && homeTotal > awayTotal) break;
  }
  
  // Extra innings if tied
  let extraInnings = 0;
  while (awayTotal === homeTotal && extraInnings < 6) {
    extraInnings++;
    // Extra innings use Manfred runner rule (2022+): runner on 2nd
    // This increases run expectancy from ~0.5 to ~1.1 per inning
    const extraMult = 1.8; // Manfred runner effect
    
    const awayExtra = negBinomialRandom(awayPerInning * awayBullpenMult * extraMult, overdispersion);
    awayTotal += awayExtra;
    
    // Home team always bats in extras (unless they already trail after top half)
    const homeExtra = negBinomialRandom(homePerInning * homeBullpenMult * extraMult, overdispersion);
    homeTotal += homeExtra;
    
    innings.push({ away: awayExtra, home: homeExtra, extra: true });
  }
  
  return {
    awayRuns: awayTotal,
    homeRuns: homeTotal,
    awayF5,
    homeF5,
    totalRuns: awayTotal + homeTotal,
    winner: homeTotal > awayTotal ? 'home' : 'away',
    wentExtra: extraInnings > 0,
    totalInnings: 9 + extraInnings,
    innings
  };
}

// ==================== MONTE CARLO ENGINE ====================

/**
 * Run Monte Carlo simulation for a matchup
 * Returns comprehensive probability distributions
 */
function simulate(awayLambda, homeLambda, opts = {}) {
  const numSims = opts.numSims || NUM_SIMS;
  const simOpts = {
    awayBullpenMult: opts.awayBullpenMult || 1.0,
    homeBullpenMult: opts.homeBullpenMult || 1.0,
    starterQuality: opts.starterQuality || 1.0,
    overdispersion: opts.overdispersion || 8,
  };
  
  // Run simulations
  let homeWins = 0, awayWins = 0, ties = 0;
  let extraInningsGames = 0;
  const totalRunsHist = {};
  const awayRunsHist = {};
  const homeRunsHist = {};
  const f5TotalHist = {};
  const scoreHist = {};
  const marginHist = {};
  
  // Run line trackers
  const runLineResults = {};
  const altLines = [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5];
  altLines.forEach(line => { runLineResults[line] = { home: 0, away: 0 }; });
  
  // Total line trackers
  const totalLineResults = {};
  const totalLines = [5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12];
  totalLines.forEach(line => { totalLineResults[line] = { over: 0, under: 0, push: 0 }; });
  
  // F5 trackers
  const f5LineResults = {};
  const f5Lines = [3, 3.5, 4, 4.5, 5, 5.5, 6];
  f5Lines.forEach(line => { f5LineResults[line] = { over: 0, under: 0, push: 0 }; });
  
  for (let i = 0; i < numSims; i++) {
    const result = simulateGame(awayLambda, homeLambda, simOpts);
    
    // Win tracking
    if (result.winner === 'home') homeWins++;
    else awayWins++;
    if (result.wentExtra) extraInningsGames++;
    
    // Histogram tracking
    totalRunsHist[result.totalRuns] = (totalRunsHist[result.totalRuns] || 0) + 1;
    awayRunsHist[result.awayRuns] = (awayRunsHist[result.awayRuns] || 0) + 1;
    homeRunsHist[result.homeRuns] = (homeRunsHist[result.homeRuns] || 0) + 1;
    
    const f5Total = result.awayF5 + result.homeF5;
    f5TotalHist[f5Total] = (f5TotalHist[f5Total] || 0) + 1;
    
    const scoreKey = `${result.awayRuns}-${result.homeRuns}`;
    scoreHist[scoreKey] = (scoreHist[scoreKey] || 0) + 1;
    
    const margin = result.homeRuns - result.awayRuns;
    marginHist[margin] = (marginHist[margin] || 0) + 1;
    
    // Run lines
    for (const line of altLines) {
      if (margin > line) runLineResults[line].home++;
      else if (margin < line) runLineResults[line].away++;
    }
    
    // Total lines
    for (const line of totalLines) {
      if (result.totalRuns > line) totalLineResults[line].over++;
      else if (result.totalRuns < line) totalLineResults[line].under++;
      else totalLineResults[line].push++;
    }
    
    // F5 lines
    for (const line of f5Lines) {
      if (f5Total > line) f5LineResults[line].over++;
      else if (f5Total < line) f5LineResults[line].under++;
      else f5LineResults[line].push++;
    }
  }
  
  // Convert to probabilities
  const n = numSims;
  
  // Top scores
  const topScores = Object.entries(scoreHist)
    .map(([score, count]) => ({ score, prob: +(count / n * 100).toFixed(1), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  
  // Run line probs
  const runLines = {};
  for (const line of altLines) {
    runLines[line] = {
      homeCovers: +(runLineResults[line].home / n).toFixed(4),
      awayCovers: +(runLineResults[line].away / n).toFixed(4),
      homeML: probToML(runLineResults[line].home / n),
      awayML: probToML(runLineResults[line].away / n),
    };
  }
  
  // Total probs
  const totals = {};
  for (const line of totalLines) {
    const overProb = totalLineResults[line].over / n;
    const underProb = totalLineResults[line].under / n;
    totals[line] = {
      over: +overProb.toFixed(4),
      under: +underProb.toFixed(4),
      overML: probToML(overProb),
      underML: probToML(underProb),
    };
  }
  
  // F5 probs
  const f5 = {};
  for (const line of f5Lines) {
    const overProb = f5LineResults[line].over / n;
    const underProb = f5LineResults[line].under / n;
    f5[line] = {
      over: +overProb.toFixed(4),
      under: +underProb.toFixed(4),
      overML: probToML(overProb),
      underML: probToML(underProb),
    };
  }
  
  // Mean/median/mode for total runs
  const totalRunsArray = [];
  for (const [runs, count] of Object.entries(totalRunsHist)) {
    for (let i = 0; i < count; i++) totalRunsArray.push(parseInt(runs));
  }
  totalRunsArray.sort((a, b) => a - b);
  
  const meanTotal = +(totalRunsArray.reduce((s, v) => s + v, 0) / n).toFixed(2);
  const medianTotal = totalRunsArray[Math.floor(n / 2)];
  const modeTotal = parseInt(Object.entries(totalRunsHist).sort((a, b) => b[1] - a[1])[0][0]);
  
  // Percentiles
  const p10 = totalRunsArray[Math.floor(n * 0.10)];
  const p25 = totalRunsArray[Math.floor(n * 0.25)];
  const p75 = totalRunsArray[Math.floor(n * 0.75)];
  const p90 = totalRunsArray[Math.floor(n * 0.90)];
  
  return {
    simulations: n,
    homeWinProb: +(homeWins / n).toFixed(4),
    awayWinProb: +(awayWins / n).toFixed(4),
    homeML: probToML(homeWins / n),
    awayML: probToML(awayWins / n),
    extraInningsPct: +(extraInningsGames / n * 100).toFixed(1),
    
    totalRuns: {
      mean: meanTotal,
      median: medianTotal,
      mode: modeTotal,
      p10, p25, p75, p90,
      std: +(Math.sqrt(totalRunsArray.reduce((s, v) => s + (v - meanTotal) ** 2, 0) / n)).toFixed(2),
    },
    
    awayExpRuns: +(Object.entries(awayRunsHist).reduce((s, [r, c]) => s + parseInt(r) * c, 0) / n).toFixed(2),
    homeExpRuns: +(Object.entries(homeRunsHist).reduce((s, [r, c]) => s + parseInt(r) * c, 0) / n).toFixed(2),
    
    runLines,
    totals,
    f5,
    
    topScores,
    
    // Margin distribution
    marginDist: {
      homeBy1: +((marginHist[1] || 0) / n * 100).toFixed(1),
      homeBy2: +((marginHist[2] || 0) / n * 100).toFixed(1),
      homeBy3plus: +(Object.entries(marginHist).filter(([m]) => parseInt(m) >= 3).reduce((s, [_, c]) => s + c, 0) / n * 100).toFixed(1),
      awayBy1: +((marginHist[-1] || 0) / n * 100).toFixed(1),
      awayBy2: +((marginHist[-2] || 0) / n * 100).toFixed(1),
      awayBy3plus: +(Object.entries(marginHist).filter(([m]) => parseInt(m) <= -3).reduce((s, [_, c]) => s + c, 0) / n * 100).toFixed(1),
    }
  };
}

// ==================== ENHANCED VALUE DETECTION ====================

/**
 * Compare simulation results against book lines to find +EV bets
 */
function findSimValue(simResult, bookLine) {
  const edges = [];
  const minEdge = 0.025; // 2.5% minimum edge
  
  // 1. Moneyline
  if (bookLine.homeML) {
    const bookHomeProb = mlToProb(bookLine.homeML);
    const homeEdge = simResult.homeWinProb - bookHomeProb;
    if (homeEdge > minEdge) {
      edges.push({
        market: 'moneyline',
        pick: 'HOME ML',
        modelProb: simResult.homeWinProb,
        bookProb: +bookHomeProb.toFixed(4),
        edge: +homeEdge.toFixed(4),
        bookML: bookLine.homeML,
        fairML: simResult.homeML,
        ev: +evPer100(simResult.homeWinProb, bookLine.homeML).toFixed(1),
        confidence: homeEdge > 0.05 ? 'HIGH' : 'MEDIUM',
        source: 'monte_carlo'
      });
    }
  }
  
  if (bookLine.awayML) {
    const bookAwayProb = mlToProb(bookLine.awayML);
    const awayEdge = simResult.awayWinProb - bookAwayProb;
    if (awayEdge > minEdge) {
      edges.push({
        market: 'moneyline',
        pick: 'AWAY ML',
        modelProb: simResult.awayWinProb,
        bookProb: +bookAwayProb.toFixed(4),
        edge: +awayEdge.toFixed(4),
        bookML: bookLine.awayML,
        fairML: simResult.awayML,
        ev: +evPer100(simResult.awayWinProb, bookLine.awayML).toFixed(1),
        confidence: awayEdge > 0.05 ? 'HIGH' : 'MEDIUM',
        source: 'monte_carlo'
      });
    }
  }
  
  // 2. Run line (-1.5)
  if (bookLine.spread !== undefined) {
    const spreadLine = bookLine.spread;
    const rl = simResult.runLines[spreadLine];
    if (rl) {
      // Home covers
      const homeRLProb = rl.homeCovers;
      const bookHomeCoverProb = bookLine.homeSpreadML ? mlToProb(bookLine.homeSpreadML) : 0.5;
      const homeRLEdge = homeRLProb - bookHomeCoverProb;
      if (homeRLEdge > minEdge) {
        edges.push({
          market: 'run_line',
          pick: `HOME ${spreadLine}`,
          modelProb: homeRLProb,
          bookProb: +bookHomeCoverProb.toFixed(4),
          edge: +homeRLEdge.toFixed(4),
          fairML: rl.homeML,
          ev: +evPer100(homeRLProb, bookLine.homeSpreadML || -110).toFixed(1),
          confidence: homeRLEdge > 0.04 ? 'HIGH' : 'MEDIUM',
          source: 'monte_carlo'
        });
      }
      
      // Away covers
      const awayRLProb = rl.awayCovers;
      const bookAwayCoverProb = bookLine.awaySpreadML ? mlToProb(bookLine.awaySpreadML) : 0.5;
      const awayRLEdge = awayRLProb - bookAwayCoverProb;
      if (awayRLEdge > minEdge) {
        edges.push({
          market: 'run_line',
          pick: `AWAY +${Math.abs(spreadLine)}`,
          modelProb: awayRLProb,
          bookProb: +bookAwayCoverProb.toFixed(4),
          edge: +awayRLEdge.toFixed(4),
          fairML: rl.awayML,
          ev: +evPer100(awayRLProb, bookLine.awaySpreadML || -110).toFixed(1),
          confidence: awayRLEdge > 0.04 ? 'HIGH' : 'MEDIUM',
          source: 'monte_carlo'
        });
      }
    }
  }
  
  // 3. Total (O/U)
  if (bookLine.total) {
    const totalLine = bookLine.total;
    const totalData = simResult.totals[totalLine];
    if (totalData) {
      const overProb = totalData.over;
      const bookOverProb = bookLine.overML ? mlToProb(bookLine.overML) : 0.5;
      const overEdge = overProb - bookOverProb;
      if (overEdge > minEdge) {
        edges.push({
          market: 'total',
          pick: `OVER ${totalLine}`,
          modelProb: overProb,
          bookProb: +bookOverProb.toFixed(4),
          edge: +overEdge.toFixed(4),
          modelTotal: simResult.totalRuns.mean,
          fairML: totalData.overML,
          ev: +evPer100(overProb, bookLine.overML || -110).toFixed(1),
          confidence: overEdge > 0.04 ? 'HIGH' : 'MEDIUM',
          source: 'monte_carlo'
        });
      }
      
      const underProb = totalData.under;
      const bookUnderProb = bookLine.underML ? mlToProb(bookLine.underML) : 0.5;
      const underEdge = underProb - bookUnderProb;
      if (underEdge > minEdge) {
        edges.push({
          market: 'total',
          pick: `UNDER ${totalLine}`,
          modelProb: underProb,
          bookProb: +bookUnderProb.toFixed(4),
          edge: +underEdge.toFixed(4),
          modelTotal: simResult.totalRuns.mean,
          fairML: totalData.underML,
          ev: +evPer100(underProb, bookLine.underML || -110).toFixed(1),
          confidence: underEdge > 0.04 ? 'HIGH' : 'MEDIUM',
          source: 'monte_carlo'
        });
      }
    }
  }
  
  // Sort by EV
  edges.sort((a, b) => b.ev - a.ev);
  return edges;
}

// ==================== MATH HELPERS ====================

function probToML(prob) {
  if (prob <= 0.001) return 99999;
  if (prob >= 0.999) return -99999;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function evPer100(modelProb, ml) {
  const payout = ml > 0 ? ml : 100 / (-ml / 100);
  return modelProb * payout - (1 - modelProb) * 100;
}

module.exports = {
  simulate,
  simulateGame,
  findSimValue,
  NUM_SIMS,
};
