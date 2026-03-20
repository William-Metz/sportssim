/**
 * SportsSim Kelly Criterion Portfolio Optimizer
 * 
 * Multi-sport bankroll management using Kelly Criterion.
 * Takes all active value bets and calculates optimal allocation.
 * 
 * Features:
 *   - Full/Half/Quarter Kelly sizing
 *   - Same-game correlation penalty
 *   - Max single-bet cap (default 5% of bankroll)
 *   - Portfolio-level risk budget
 *   - Confidence-weighted sizing
 */

/**
 * Convert American moneyline to decimal odds
 */
function mlToDecimal(ml) {
  if (ml > 0) return (ml / 100) + 1;
  return (100 / Math.abs(ml)) + 1;
}

/**
 * Convert American moneyline to implied probability
 */
function mlToProb(ml) {
  if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
  return 100 / (ml + 100);
}

/**
 * Calculate Kelly Criterion fraction
 * 
 * f* = (bp - q) / b
 * where:
 *   b = decimal odds - 1
 *   p = true probability (from model)
 *   q = 1 - p
 * 
 * @param {number} modelProb - model's estimated win probability (0-1)
 * @param {number} ml - American moneyline
 * @returns {number} Kelly fraction (0-1)
 */
function kellyFraction(modelProb, ml) {
  const b = mlToDecimal(ml) - 1;
  const q = 1 - modelProb;
  const f = (b * modelProb - q) / b;
  return Math.max(0, f);
}

/**
 * Calculate expected value per $1 wagered
 * 
 * @param {number} modelProb - model probability (0-1)
 * @param {number} ml - American moneyline
 * @returns {number} EV per dollar
 */
function expectedValue(modelProb, ml) {
  const decOdds = mlToDecimal(ml);
  return (modelProb * decOdds) - 1;
}

/**
 * Detect same-game correlations
 * Two bets on the same game are correlated
 * 
 * @param {Array} bets - array of bet objects with { game, sport }
 * @returns {Map} game → [betIndices]
 */
function detectCorrelations(bets) {
  const gameMap = new Map();
  bets.forEach((bet, i) => {
    const key = `${bet.sport}:${bet.game}`;
    if (!gameMap.has(key)) gameMap.set(key, []);
    gameMap.get(key).push(i);
  });
  return gameMap;
}

/**
 * Optimize portfolio allocation using Kelly Criterion
 * 
 * @param {Object} options
 * @param {number} options.bankroll - total bankroll ($)
 * @param {number} options.fraction - Kelly fraction to use (0.25=quarter, 0.5=half, 1.0=full)
 * @param {number} options.maxBetPct - max single bet as % of bankroll (default 0.05 = 5%)
 * @param {number} options.maxTotalPct - max total exposure as % of bankroll (default 0.25 = 25%)
 * @param {number} options.minEdge - minimum edge to include (% points, default 2)
 * @param {Array} options.bets - array of value bet objects:
 *   { sport, game, pick, modelProb, bookML, edge, confidence }
 * @returns {Object} portfolio allocation
 */
function optimizePortfolio(options) {
  const {
    bankroll = 1000,
    fraction = 0.5,
    maxBetPct = 0.05,
    maxTotalPct = 0.25,
    minEdge = 2,
    bets = []
  } = options;

  // Filter bets with positive edge
  const validBets = bets.filter(b => {
    const edge = (b.edge || 0);
    return edge >= minEdge && b.modelProb > 0 && b.bookML;
  });

  if (validBets.length === 0) {
    return {
      bankroll,
      fraction,
      fractionLabel: fraction === 1 ? 'Full Kelly' : fraction === 0.5 ? 'Half Kelly' : fraction === 0.25 ? 'Quarter Kelly' : `${fraction * 100}% Kelly`,
      picks: [],
      totalWager: 0,
      totalExposure: 0,
      expectedProfit: 0,
      riskLevel: 'NONE',
      summary: 'No qualifying value bets found'
    };
  }

  // Detect same-game correlations
  const correlations = detectCorrelations(validBets);
  
  // Calculate raw Kelly for each bet
  const rawAllocations = validBets.map((bet, i) => {
    const modelP = typeof bet.modelProb === 'number' 
      ? (bet.modelProb > 1 ? bet.modelProb / 100 : bet.modelProb)
      : 0;
    
    const rawKelly = kellyFraction(modelP, bet.bookML);
    const adjKelly = rawKelly * fraction;
    
    // Confidence multiplier: HIGH=1.0, MEDIUM=0.8, LOW=0.6
    const confMultiplier = bet.confidence === 'HIGH' ? 1.0 : 
                          bet.confidence === 'MEDIUM' ? 0.85 : 0.7;
    
    const finalKelly = adjKelly * confMultiplier;
    
    // Cap at max single bet
    const cappedKelly = Math.min(finalKelly, maxBetPct);
    
    const ev = expectedValue(modelP, bet.bookML);
    
    return {
      ...bet,
      modelProbPct: +(modelP * 100).toFixed(1),
      impliedProb: +(mlToProb(bet.bookML) * 100).toFixed(1),
      decimalOdds: +mlToDecimal(bet.bookML).toFixed(3),
      rawKelly: +(rawKelly * 100).toFixed(2),
      adjKelly: +(adjKelly * 100).toFixed(2),
      finalKelly: +(cappedKelly * 100).toFixed(2),
      wager: 0, // will be set after normalization
      ev: +(ev * 100).toFixed(1),
      index: i
    };
  });

  // Apply correlation penalty: if multiple bets on same game, reduce each by sqrt(n)
  for (const [gameKey, indices] of correlations) {
    if (indices.length > 1) {
      const penalty = 1 / Math.sqrt(indices.length);
      indices.forEach(i => {
        const alloc = rawAllocations.find(a => a.index === i);
        if (alloc) {
          alloc.finalKelly = +(alloc.finalKelly * penalty).toFixed(2);
          alloc.correlationPenalty = +((1 - penalty) * 100).toFixed(0);
        }
      });
    }
  }

  // Sort by edge (best first)
  rawAllocations.sort((a, b) => (b.edge || 0) - (a.edge || 0));

  // Normalize: ensure total doesn't exceed maxTotalPct
  let totalKelly = rawAllocations.reduce((s, a) => s + a.finalKelly, 0);
  
  if (totalKelly > maxTotalPct * 100) {
    const scale = (maxTotalPct * 100) / totalKelly;
    rawAllocations.forEach(a => {
      a.finalKelly = +(a.finalKelly * scale).toFixed(2);
    });
    totalKelly = rawAllocations.reduce((s, a) => s + a.finalKelly, 0);
  }

  // Calculate dollar wagers
  rawAllocations.forEach(a => {
    a.wager = +(bankroll * a.finalKelly / 100).toFixed(2);
  });

  // Filter out zero wagers
  const picks = rawAllocations.filter(a => a.wager >= 1);

  const totalWager = +picks.reduce((s, p) => s + p.wager, 0).toFixed(2);
  const expectedProfit = +picks.reduce((s, p) => s + (p.wager * p.ev / 100), 0).toFixed(2);

  // Risk assessment
  const exposurePct = totalWager / bankroll;
  const riskLevel = exposurePct >= 0.20 ? 'HIGH' : 
                    exposurePct >= 0.10 ? 'MEDIUM' : 
                    exposurePct >= 0.05 ? 'LOW' : 'MINIMAL';

  return {
    bankroll,
    fraction,
    fractionLabel: fraction === 1 ? 'Full Kelly' : fraction === 0.5 ? 'Half Kelly' : fraction === 0.25 ? 'Quarter Kelly' : `${fraction * 100}% Kelly`,
    picks: picks.map(p => ({
      sport: p.sport,
      game: p.game,
      pick: p.pick,
      book: p.book || 'best available',
      edge: p.edge,
      modelProb: p.modelProbPct,
      impliedProb: p.impliedProb,
      ml: p.bookML,
      decimalOdds: p.decimalOdds,
      ev: p.ev,
      confidence: p.confidence,
      kellyFull: p.rawKelly,
      kellyAdj: p.adjKelly,
      kellyFinal: p.finalKelly,
      wager: p.wager,
      potentialProfit: +(p.wager * (p.decimalOdds - 1)).toFixed(2),
      correlationPenalty: p.correlationPenalty || 0
    })),
    totalWager,
    totalExposure: +(exposurePct * 100).toFixed(1),
    expectedProfit,
    expectedROI: totalWager > 0 ? +(expectedProfit / totalWager * 100).toFixed(1) : 0,
    riskLevel,
    correlatedGames: [...correlations.entries()].filter(([, v]) => v.length > 1).length,
    summary: `${picks.length} bets, $${totalWager} wagered (${(exposurePct * 100).toFixed(1)}% of bankroll), +$${expectedProfit} expected profit`
  };
}

module.exports = {
  kellyFraction,
  expectedValue,
  mlToDecimal,
  mlToProb,
  optimizePortfolio,
  detectCorrelations
};
