// services/od-sgp-builder.js — Opening Day SGP (Same Game Parlay) Builder v69.2
// Builds optimal correlated parlays for each OD game using K props + ML + totals
// KEY INSIGHT: SGPs are the highest-margin bet type because books misprice correlations

const pitcherKProps = require('./pitcher-k-props');

// ==================== CORRELATION MATRIX ====================
// How correlated are different bet legs within the same game?
// Positive correlation = legs tend to hit together
// Negative correlation = one hitting makes the other less likely
// These are empirical from 2023-2025 MLB data

const CORRELATIONS = {
  // K OVER + UNDER total: POSITIVE (+0.15 to +0.25)
  // More Ks = pitcher dominance = fewer runs = under. But the K OVER just means
  // the starter is good, which also means fewer runs. So they correlate.
  'k_over__total_under': 0.20,
  
  // K OVER + favorite ML: POSITIVE (+0.10 to +0.20)
  // High K pitcher usually on better team. His dominance = team wins.
  'k_over__fav_ml': 0.15,
  
  // K OVER + F5 UNDER: STRONG POSITIVE (+0.20 to +0.30)
  // High Ks in first 5 = starter dealing = suppressed F5 scoring
  'k_over__f5_under': 0.25,
  
  // K UNDER + OVER total: POSITIVE (+0.10 to +0.15)
  // Pitcher struggling = more runs
  'k_under__total_over': 0.12,
  
  // Favorite ML + UNDER: POSITIVE (+0.05 to +0.15)
  // Favorites win more often AND their pitching dominates = lower scoring
  'fav_ml__total_under': 0.10,
  
  // Underdog ML + OVER: POSITIVE (+0.10 to +0.15)
  // Upsets tend to be higher-scoring (both teams exchange blows)
  'dog_ml__total_over': 0.12,
  
  // K OVER (both pitchers) + UNDER: STRONG POSITIVE
  // Both aces dealing = few runs
  'dual_k_over__under': 0.30,
};

// ==================== SGP LEG DEFINITIONS ====================

/**
 * Build all possible SGP legs for a single OD game
 */
function buildGameLegs(game, kPropData) {
  const legs = [];
  
  // Leg: Away K prop
  if (kPropData.away) {
    const k = kPropData.away;
    legs.push({
      type: 'k_prop',
      side: 'away',
      pitcher: k.pitcher,
      team: k.team,
      pick: k.recommendation,
      line: k.dkLine?.line,
      odds: k.recommendation === 'OVER' ? (k.dkLine?.overOdds || -110) : (k.dkLine?.underOdds || -110),
      modelProb: k.recommendation === 'OVER' ? k.overProb / 100 : k.underProb / 100,
      edge: k.edge,
      confidence: k.confidence,
      grade: k.grade,
      label: `${k.pitcher} ${k.recommendation} ${k.dkLine?.line} Ks`,
    });
  }
  
  // Leg: Home K prop
  if (kPropData.home) {
    const k = kPropData.home;
    legs.push({
      type: 'k_prop',
      side: 'home',
      pitcher: k.pitcher,
      team: k.team,
      pick: k.recommendation,
      line: k.dkLine?.line,
      odds: k.recommendation === 'OVER' ? (k.dkLine?.overOdds || -110) : (k.dkLine?.underOdds || -110),
      modelProb: k.recommendation === 'OVER' ? k.overProb / 100 : k.underProb / 100,
      edge: k.edge,
      confidence: k.confidence,
      grade: k.grade,
      label: `${k.pitcher} ${k.recommendation} ${k.dkLine?.line} Ks`,
    });
  }
  
  // Leg: Moneyline
  if (game.dkLine) {
    const homeML = game.dkLine.homeML;
    const awayML = game.dkLine.awayML;
    const homeFav = homeML < 0;
    
    // Convert ML to implied prob
    const homeImplied = homeML < 0 ? (-homeML) / (-homeML + 100) : 100 / (homeML + 100);
    const awayImplied = awayML < 0 ? (-awayML) / (-awayML + 100) : 100 / (awayML + 100);
    
    legs.push({
      type: 'ml',
      side: 'home',
      team: game.home,
      pick: 'ML',
      odds: homeML,
      modelProb: homeImplied, // Will be overridden if we have model prob
      bookImplied: homeImplied,
      isFavorite: homeFav,
      label: `${game.home} ML (${homeML > 0 ? '+' : ''}${homeML})`,
    });
    
    legs.push({
      type: 'ml',
      side: 'away',
      team: game.away,
      pick: 'ML',
      odds: awayML,
      modelProb: awayImplied,
      bookImplied: awayImplied,
      isFavorite: !homeFav,
      label: `${game.away} ML (${awayML > 0 ? '+' : ''}${awayML})`,
    });
  }
  
  // Leg: Total O/U
  if (game.dkLine?.total) {
    const total = game.dkLine.total;
    legs.push({
      type: 'total',
      pick: 'UNDER',
      line: total,
      odds: -110,
      modelProb: 0.50, // Default, will be enhanced with model
      label: `UNDER ${total}`,
    });
    
    legs.push({
      type: 'total',
      pick: 'OVER',
      line: total,
      odds: -110,
      modelProb: 0.50,
      label: `OVER ${total}`,
    });
  }
  
  return legs;
}

/**
 * Calculate correlated probability of a multi-leg parlay
 * Instead of multiplying independent probs, adjust for correlation
 */
function correlatedParlayProb(legs) {
  if (legs.length === 0) return 0;
  if (legs.length === 1) return legs[0].modelProb;
  
  // Start with independent probability
  let independentProb = legs.reduce((p, leg) => p * leg.modelProb, 1);
  
  // Calculate correlation boost/penalty for each pair
  let correlationMultiplier = 1;
  
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const corr = getPairCorrelation(legs[i], legs[j]);
      // Correlation adjusts joint probability
      // P(A AND B) = P(A) * P(B) + corr * sqrt(P(A)(1-P(A)) * P(B)(1-P(B)))
      if (corr !== 0) {
        const pA = legs[i].modelProb;
        const pB = legs[j].modelProb;
        const adjustment = corr * Math.sqrt(pA * (1 - pA) * pB * (1 - pB));
        correlationMultiplier += adjustment / independentProb;
      }
    }
  }
  
  return Math.min(0.95, Math.max(0.01, independentProb * correlationMultiplier));
}

/**
 * Get correlation between two parlay legs
 */
function getPairCorrelation(legA, legB) {
  // K OVER + Total UNDER
  if (legA.type === 'k_prop' && legA.pick === 'OVER' && legB.type === 'total' && legB.pick === 'UNDER') {
    return CORRELATIONS['k_over__total_under'];
  }
  if (legB.type === 'k_prop' && legB.pick === 'OVER' && legA.type === 'total' && legA.pick === 'UNDER') {
    return CORRELATIONS['k_over__total_under'];
  }
  
  // K OVER + F5 UNDER
  if (legA.type === 'k_prop' && legA.pick === 'OVER' && legB.type === 'f5_total' && legB.pick === 'UNDER') {
    return CORRELATIONS['k_over__f5_under'];
  }
  
  // K OVER + Favorite ML
  if (legA.type === 'k_prop' && legA.pick === 'OVER' && legB.type === 'ml' && legB.isFavorite) {
    return CORRELATIONS['k_over__fav_ml'];
  }
  if (legB.type === 'k_prop' && legB.pick === 'OVER' && legA.type === 'ml' && legA.isFavorite) {
    return CORRELATIONS['k_over__fav_ml'];
  }
  
  // Favorite ML + UNDER
  if (legA.type === 'ml' && legA.isFavorite && legB.type === 'total' && legB.pick === 'UNDER') {
    return CORRELATIONS['fav_ml__total_under'];
  }
  if (legB.type === 'ml' && legB.isFavorite && legA.type === 'total' && legA.pick === 'UNDER') {
    return CORRELATIONS['fav_ml__total_under'];
  }
  
  // Dual K OVER + UNDER
  if (legA.type === 'k_prop' && legA.pick === 'OVER' && legB.type === 'k_prop' && legB.pick === 'OVER') {
    // Both pitchers dealing
    return CORRELATIONS['dual_k_over__under'] * 0.5; // Partial correlation
  }
  
  // K UNDER + OVER
  if (legA.type === 'k_prop' && legA.pick === 'UNDER' && legB.type === 'total' && legB.pick === 'OVER') {
    return CORRELATIONS['k_under__total_over'];
  }
  if (legB.type === 'k_prop' && legB.pick === 'UNDER' && legA.type === 'total' && legA.pick === 'OVER') {
    return CORRELATIONS['k_under__total_over'];
  }
  
  return 0; // No known correlation
}

/**
 * Convert American odds to decimal
 */
function americanToDecimal(odds) {
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

/**
 * Calculate parlay payout from legs
 */
function parlayPayout(legs) {
  let totalDecimalOdds = 1;
  for (const leg of legs) {
    totalDecimalOdds *= americanToDecimal(leg.odds);
  }
  return totalDecimalOdds;
}

/**
 * Convert decimal odds back to American
 */
function decimalToAmerican(decimal) {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

// ==================== SGP BUILDER ====================

/**
 * Build optimal SGPs for a single Opening Day game
 */
function buildGameSGPs(game, options = {}) {
  const maxLegs = options.maxLegs || 3;
  const minEdge = options.minEdge || 0.02;
  
  // Get K prop predictions for both starters
  const kPropData = {};
  
  if (game.confirmedStarters?.away) {
    const awayK = pitcherKProps.predictKs(
      game.confirmedStarters.away,
      game.home, // opposing team
      null, // will auto-detect park
      { isOpeningDay: true }
    );
    if (awayK) kPropData.away = awayK;
  }
  
  if (game.confirmedStarters?.home) {
    const homeK = pitcherKProps.predictKs(
      game.confirmedStarters.home,
      game.away, // opposing team
      null,
      { isOpeningDay: true }
    );
    if (homeK) kPropData.home = homeK;
  }
  
  // Build all legs
  const legs = buildGameLegs(game, kPropData);
  
  // Generate all valid 2-leg and 3-leg combinations
  const parlays = [];
  
  // 2-leg parlays
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      // Skip contradictory legs (home ML + away ML, OVER + UNDER same game)
      if (isContradictory(legs[i], legs[j])) continue;
      
      const combo = [legs[i], legs[j]];
      const parlay = evaluateParlay(combo, game);
      if (parlay && parlay.edge >= minEdge * 100) {
        parlays.push(parlay);
      }
    }
  }
  
  // 3-leg parlays
  if (maxLegs >= 3) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        if (isContradictory(legs[i], legs[j])) continue;
        for (let k = j + 1; k < legs.length; k++) {
          if (isContradictory(legs[i], legs[k]) || isContradictory(legs[j], legs[k])) continue;
          
          const combo = [legs[i], legs[j], legs[k]];
          const parlay = evaluateParlay(combo, game);
          if (parlay && parlay.edge >= minEdge * 100) {
            parlays.push(parlay);
          }
        }
      }
    }
  }
  
  // Sort by EV (edge * payout)
  parlays.sort((a, b) => b.ev - a.ev);
  
  return {
    game: `${game.away}@${game.home}`,
    date: game.date,
    time: game.time,
    starters: {
      away: game.confirmedStarters?.away,
      home: game.confirmedStarters?.home,
    },
    kProps: {
      away: kPropData.away ? {
        pitcher: kPropData.away.pitcher,
        modelKs: kPropData.away.adjustedExpectedKs,
        line: kPropData.away.dkLine?.line,
        pick: kPropData.away.recommendation,
        edge: kPropData.away.edge,
      } : null,
      home: kPropData.home ? {
        pitcher: kPropData.home.pitcher,
        modelKs: kPropData.home.adjustedExpectedKs,
        line: kPropData.home.dkLine?.line,
        pick: kPropData.home.recommendation,
        edge: kPropData.home.edge,
      } : null,
    },
    sgpCount: parlays.length,
    topSGPs: parlays.slice(0, 5),
    allSGPs: parlays,
  };
}

/**
 * Check if two legs contradict each other
 */
function isContradictory(legA, legB) {
  // Same type, same game, opposite picks
  if (legA.type === 'ml' && legB.type === 'ml') return true; // Can't pick both sides
  if (legA.type === 'total' && legB.type === 'total' && legA.pick !== legB.pick) return true; // OVER + UNDER
  if (legA.type === 'k_prop' && legB.type === 'k_prop' && legA.side === legB.side) return true; // Same pitcher OVER + UNDER
  return false;
}

/**
 * Evaluate a parlay combination
 */
function evaluateParlay(legs, game) {
  // Calculate correlated win probability
  const winProb = correlatedParlayProb(legs);
  
  // Calculate book payout (what DK would pay)
  const payout = parlayPayout(legs);
  
  // Calculate book implied probability
  const bookImplied = 1 / payout;
  
  // Edge = model prob - book implied
  const edge = (winProb - bookImplied) * 100;
  
  // EV = (payout * winProb) - 1
  const ev = (payout * winProb - 1) * 100;
  
  // Kelly criterion for sizing
  const kellyFraction = Math.max(0, (payout * winProb - 1) / (payout - 1));
  
  // Grade
  let grade, confidence;
  if (edge >= 15) { grade = 'A+'; confidence = 'SMASH'; }
  else if (edge >= 10) { grade = 'A'; confidence = 'HIGH'; }
  else if (edge >= 6) { grade = 'B+'; confidence = 'GOOD'; }
  else if (edge >= 3) { grade = 'B'; confidence = 'MODERATE'; }
  else { grade = 'C'; confidence = 'LEAN'; }
  
  return {
    legs: legs.map(l => ({
      label: l.label,
      type: l.type,
      odds: l.odds,
      modelProb: +(l.modelProb * 100).toFixed(1),
      edge: l.edge || +((l.modelProb - (l.bookImplied || 0.5)) * 100).toFixed(1),
    })),
    legCount: legs.length,
    parlayOdds: decimalToAmerican(payout),
    parlayDecimal: +payout.toFixed(2),
    modelWinProb: +(winProb * 100).toFixed(1),
    bookImpliedProb: +(bookImplied * 100).toFixed(1),
    edge: +edge.toFixed(1),
    ev: +ev.toFixed(1),
    kelly: +(kellyFraction * 100).toFixed(1),
    grade,
    confidence,
    correlationBoost: +(((winProb / legs.reduce((p, l) => p * l.modelProb, 1)) - 1) * 100).toFixed(1),
  };
}

// ==================== FULL OD SGP SCAN ====================

/**
 * Scan all Opening Day games for SGP opportunities
 */
function scanODSGPs(options = {}) {
  const OD_GAMES = require('../models/mlb-opening-day').OPENING_DAY_GAMES;
  const results = [];
  let totalSGPs = 0;
  let highConfidence = 0;
  
  for (const game of OD_GAMES) {
    const gameSGPs = buildGameSGPs(game, options);
    results.push(gameSGPs);
    totalSGPs += gameSGPs.sgpCount;
    highConfidence += gameSGPs.topSGPs.filter(s => s.grade === 'A+' || s.grade === 'A').length;
  }
  
  // Collect all top SGPs across all games
  const allTopSGPs = results
    .flatMap(r => r.topSGPs.map(s => ({ ...s, game: r.game, starters: r.starters })))
    .sort((a, b) => b.ev - a.ev);
  
  // Summary
  const summary = [];
  summary.push(`🎰 OD SGP REPORT: ${totalSGPs} parlays found across ${results.length} games`);
  summary.push('');
  
  const smashSGPs = allTopSGPs.filter(s => s.grade === 'A+' || s.grade === 'A');
  if (smashSGPs.length > 0) {
    summary.push(`⭐ SMASH PARLAYS (${smashSGPs.length}):`);
    for (const sgp of smashSGPs.slice(0, 10)) {
      const legsStr = sgp.legs.map(l => l.label).join(' + ');
      summary.push(`  ${sgp.game}: ${legsStr}`);
      summary.push(`    → ${sgp.parlayOdds > 0 ? '+' : ''}${sgp.parlayOdds} | Win: ${sgp.modelWinProb}% | Edge: ${sgp.edge}% | EV: ${sgp.ev}%`);
    }
  }
  
  const strongSGPs = allTopSGPs.filter(s => s.grade === 'B+');
  if (strongSGPs.length > 0) {
    summary.push('');
    summary.push(`✅ STRONG PARLAYS (${strongSGPs.length}):`);
    for (const sgp of strongSGPs.slice(0, 5)) {
      const legsStr = sgp.legs.map(l => l.label).join(' + ');
      summary.push(`  ${sgp.game}: ${legsStr}`);
      summary.push(`    → ${sgp.parlayOdds > 0 ? '+' : ''}${sgp.parlayOdds} | Win: ${sgp.modelWinProb}% | Edge: ${sgp.edge}% | EV: ${sgp.ev}%`);
    }
  }
  
  return {
    timestamp: new Date().toISOString(),
    gamesScanned: results.length,
    totalSGPs,
    highConfidence,
    averageEV: allTopSGPs.length > 0 ? +(allTopSGPs.reduce((s, p) => s + p.ev, 0) / allTopSGPs.length).toFixed(1) : 0,
    topSGPs: allTopSGPs.slice(0, 20),
    gameDetails: results,
    summary: summary.join('\n'),
  };
}

module.exports = {
  buildGameSGPs,
  scanODSGPs,
  correlatedParlayProb,
  CORRELATIONS,
};
