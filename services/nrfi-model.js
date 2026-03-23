/**
 * NRFI/YRFI Model v77.0 — First Inning Scoring Probability
 * 
 * THE EDGE: No Run First Inning (NRFI) is a massive DK/FD market with soft lines.
 * Recreational bettors overbet YRFI because action is fun. Sharps know:
 * - Opening Day aces go DEEP and dominate 1st innings
 * - Rusty bats in Week 1 compound first-at-bat whiff rates
 * - Cold weather outdoor parks suppress 1st inning scoring even more
 * - First inning has LOWEST scoring rate of any inning (~0.48 R/half-inning avg)
 * 
 * Model: For each half-inning, calculate P(0 runs scored) using Poisson distribution
 * with pitcher-specific lambda = (expectedRuns / 9 innings) × adjustments
 * 
 * NRFI = P(away scores 0 in top 1st) × P(home scores 0 in bottom 1st)
 * YRFI = 1 - NRFI
 * 
 * Adjustments:
 * 1. Pitcher 1st inning factor — starters have lower ERA in 1st inning (0.90-0.95x)
 *    because they're freshest, throwing hardest, and batters haven't timed them yet
 * 2. Opening Day premium — aces typically dominate 1st innings on OD (+5% NRFI boost)
 * 3. Leadoff batter quality — not all #1 hitters are created equal
 * 4. Weather factor — cold = less offense, especially early when muscles are cold
 * 5. Park factor — pitcher parks suppress 1st inning action
 * 6. Platoon factor — LHP facing lefty-heavy top-of-order can flip dynamics
 * 
 * Data: The Odds API supports these markets:
 * - totals_1st_1_innings (full game 1st inning total)
 * - h2h_1st_1_innings (1st inning winner)
 * - h2h_3_way_1st_1_innings (1st inning 3-way ML including tie)
 * - totals_1st_3_innings (F3 total)
 * - totals_1st_7_innings (F7 total) — we already model F5
 */

// ==================== PITCHER 1ST INNING PROFILES ====================
// Historical 1st inning ERA tends to be ~0.90-0.95x of overall ERA for starters
// because (a) arm is freshest, (b) batter timing not established, (c) throwing hardest
// Ace-level starters are EVEN better in 1st innings (~0.85x)
const FIRST_INNING_FACTORS = {
  // Tier 1 aces dominate 1st innings
  1: { firstInningMult: 0.85, note: 'Elite ace — 15% suppression in 1st inning' },
  // Tier 2 solid starters
  2: { firstInningMult: 0.90, note: 'Quality starter — 10% suppression' },
  // Tier 3 average starters
  3: { firstInningMult: 0.93, note: 'Average starter — 7% suppression' },
  // Tier 4 back-end rotation
  4: { firstInningMult: 0.97, note: 'Back-end — minimal 1st inning advantage' },
};

// ==================== LEADOFF BATTER QUALITY ====================
// Top-of-order hitters see the starter first, and good leadoff guys have higher OBP
// This matters for 1st inning scoring: a .380 OBP leadoff guy vs .320 OBP changes NRFI calc
// Format: runMultiplier relative to average (1.0 = league average top-of-order)
const TEAM_LEADOFF_QUALITY = {
  // Elite leadoff situations (high OBP top-of-order)
  'LAD': 1.08, // Mookie Betts — elite OBP
  'NYY': 1.07, // Juan Soto — elite patience
  'BOS': 1.06, // Duran — speed + OBP
  'ATL': 1.05, // Acuna Jr — elite all-around
  'PHI': 1.05, // Schwarber — elite OBP
  'SD':  1.04, // Profar — high OBP
  'HOU': 1.04, // Altuve — veteran OBP
  'TOR': 1.03, // Springer — veteran leadoff
  'SF':  1.03, // Chapman leadoff potential
  'SEA': 1.02, // J-Rod — elite power upside
  'CLE': 1.02, // Kwan — elite contact
  // Average leadoff
  'MIN': 1.01,
  'BAL': 1.01, // Mullins — speed
  'MIL': 1.00,
  'NYM': 1.00,
  'CHC': 1.00,
  'DET': 1.00,
  'CIN': 1.00,
  'ARI': 1.00,
  'TB':  0.99,
  'KC':  0.99,
  'TEX': 0.99,
  'STL': 0.99,
  'LAA': 0.98,
  'MIA': 0.98,
  'PIT': 0.97,
  'WSH': 0.97,
  'COL': 0.97, // Despite Coors, COL lineup is weak
  'OAK': 0.95, // Worst lineup in MLB
  'CWS': 0.94, // Worst or near-worst
};

// ==================== OPENING DAY 1ST INNING ADJUSTMENTS ====================
// Historical data shows Opening Day first innings are LOWER scoring than average:
// - Aces pitch Opening Day → highest-quality arms
// - First at-bats of the season → timing off, rusty
// - First inning = both teams' worst game-plan (haven't seen pitcher's stuff live)
// - Cold weather in many markets
const OD_NRFI_BOOST = 0.06; // 6% boost to NRFI probability on Opening Day
const OPENING_WEEK_NRFI_BOOST = 0.03; // 3% boost during Opening Week (March 26-April 2)

// ==================== PARK 1ST INNING FACTORS ====================
// Some parks play differently in first innings (wind patterns, altitude settling)
const PARK_FIRST_INNING_FACTOR = {
  'NYM': 0.96, // Citi Field suppresses — big outfield
  'SD':  0.93, // Petco Park — most pitcher-friendly
  'SEA': 0.95, // T-Mobile — marine layer early
  'SF':  0.94, // Oracle — cold, big, pitcher park
  'LAD': 0.97, // Dodger Stadium — slightly pitcher-friendly
  'DET': 0.97, // Comerica — big outfield
  'MIA': 0.96, // LoanDepot — dome but pitcher-friendly
  'ATL': 0.98, // Truist — neutral
  'STL': 0.99, // Busch — neutral
  'CHC': 1.01, // Wrigley — wind can go either way
  'CIN': 1.04, // GABP — hitter-friendly, small park, can score early
  'PHI': 1.03, // CBP — hitter-friendly
  'TEX': 0.98, // Globe Life — dome, neutral
  'BAL': 1.01, // Camden Yards — slightly hitter-friendly
  'HOU': 0.98, // Minute Maid — dome, slight pitcher lean
  'MIL': 0.99, // AmFam — dome, neutral
  'TOR': 0.99, // Rogers Centre — dome, neutral
  'TB':  0.97, // Tropicana — dome, pitcher-friendly
  'MIN': 0.99, // Target Field — neutral early
  'BOS': 1.02, // Fenway — Green Monster creates runs
  'CLE': 0.98, // Progressive — pitcher-leaning
  'LAA': 0.99, // Angel Stadium — neutral
  'NYY': 1.02, // Yankee Stadium — short porch
  'KC':  0.99, // Kauffman — slightly pitcher
  'PIT': 0.97, // PNC Park — pitcher-friendly
  'WSH': 0.99, // Nationals Park — neutral
  'COL': 1.08, // COORS — even in 1st inning, the altitude matters
  'OAK': 0.96, // Coliseum — depresses scoring
  'ARI': 1.01, // Chase Field — dome, neutral-to-slight-hitter
  'CWS': 0.99, // Guaranteed Rate — neutral
};

// ==================== WEATHER FIRST INNING ADJUSTMENT ====================
// Cold weather suppresses offense MORE in 1st inning (muscles cold, bat speed down)
function getWeatherNRFIAdj(temp) {
  if (!temp) return 0;
  if (temp <= 35) return 0.06; // Extreme cold = 6% NRFI boost
  if (temp <= 45) return 0.04; // Cold = 4% boost
  if (temp <= 55) return 0.02; // Cool = 2% boost
  if (temp >= 85) return -0.02; // Hot = slight YRFI lean
  return 0;
}

// ==================== CORE MODEL ====================

/**
 * Calculate NRFI probability for a single game
 * @param {string} away - Away team abbreviation
 * @param {string} home - Home team abbreviation 
 * @param {object} opts - Options: { prediction, awayPitcherTier, homePitcherTier, weather, isOpeningDay, isOpeningWeek }
 * @returns {object} NRFI/YRFI probabilities with breakdown
 */
function calculateNRFI(away, home, opts = {}) {
  const {
    prediction,           // Full predict() result with awayExpRuns, homeExpRuns
    awayPitcherTier = 3,  // Pitcher tier 1-4
    homePitcherTier = 3,
    awayPitcherName = null,
    homePitcherName = null,
    weather = null,       // { temp, wind, windDir }
    isOpeningDay = false,
    isOpeningWeek = false,
  } = opts;
  
  // Base lambda per half-inning = expectedRuns / 9
  // We use the model's expected runs which already include park, pitcher, platoon, etc.
  const awayExpRuns = prediction?.awayExpRuns || 4.3; // away team expected runs over 9 innings
  const homeExpRuns = prediction?.homeExpRuns || 4.3;
  
  // Lambda for 1 inning = total expected runs / 9
  let awayLambda1 = awayExpRuns / 9;
  let homeLambda1 = homeExpRuns / 9;
  
  // Adjustment 1: Pitcher 1st inning factor
  // Home pitcher faces away batters → suppress awayLambda
  // Away pitcher faces home batters → suppress homeLambda
  const homePitcherFactor = FIRST_INNING_FACTORS[homePitcherTier]?.firstInningMult || 0.93;
  const awayPitcherFactor = FIRST_INNING_FACTORS[awayPitcherTier]?.firstInningMult || 0.93;
  awayLambda1 *= homePitcherFactor; // home pitcher suppresses away scoring
  homeLambda1 *= awayPitcherFactor; // away pitcher suppresses home scoring
  
  // Adjustment 2: Leadoff batter quality
  const awayLeadoff = TEAM_LEADOFF_QUALITY[away] || 1.0;
  const homeLeadoff = TEAM_LEADOFF_QUALITY[home] || 1.0;
  awayLambda1 *= awayLeadoff;
  homeLambda1 *= homeLeadoff;
  
  // Adjustment 3: Park first-inning factor
  const parkFactor = PARK_FIRST_INNING_FACTOR[home] || 1.0;
  awayLambda1 *= parkFactor;
  homeLambda1 *= parkFactor;
  
  // P(0 runs) = e^(-lambda) (Poisson with k=0)
  let awayP0 = Math.exp(-awayLambda1);
  let homeP0 = Math.exp(-homeLambda1);
  
  // Adjustment 4: Opening Day / Opening Week boost
  let odBoost = 0;
  if (isOpeningDay) {
    odBoost = OD_NRFI_BOOST;
  } else if (isOpeningWeek) {
    odBoost = OPENING_WEEK_NRFI_BOOST;
  }
  
  // Adjustment 5: Weather
  const temp = weather?.temp || null;
  const weatherBoost = getWeatherNRFIAdj(temp);
  
  // Calculate raw NRFI
  let nrfiProb = awayP0 * homeP0;
  
  // Apply boosts additively (they're small probability shifts)
  nrfiProb = Math.min(0.85, Math.max(0.15, nrfiProb + odBoost + weatherBoost));
  
  const yrfiProb = 1 - nrfiProb;
  
  // Calculate Poisson distribution for 1st inning total runs (0, 1, 2, 3+)
  const poissonPMF = (k, lambda) => Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  const factorial = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  
  // Joint probability distribution of 1st inning total runs
  const totalLambda = awayLambda1 + homeLambda1;
  const runDist = {};
  for (let runs = 0; runs <= 6; runs++) {
    let prob = 0;
    for (let a = 0; a <= runs; a++) {
      const h = runs - a;
      prob += poissonPMF(a, awayLambda1) * poissonPMF(h, homeLambda1);
    }
    runDist[runs] = +prob.toFixed(4);
  }
  
  // First inning totals lines: Over/Under 0.5, 1.5, 2.5
  const totalsLines = {};
  let cumProb = 0;
  for (const line of [0.5, 1.5, 2.5, 3.5]) {
    cumProb = 0;
    for (let r = 0; r <= 10; r++) {
      if (r < line) {
        let p = 0;
        for (let a = 0; a <= r; a++) {
          const h = r - a;
          p += poissonPMF(a, awayLambda1) * poissonPMF(h, homeLambda1);
        }
        cumProb += p;
      }
    }
    // Apply the same OD + weather boost to sub-lines too
    let adjUnder = Math.min(0.95, Math.max(0.05, cumProb + (line <= 0.5 ? odBoost + weatherBoost : (odBoost + weatherBoost) * 0.5)));
    totalsLines[line] = {
      under: +(adjUnder * 100).toFixed(1),
      over: +((1 - adjUnder) * 100).toFixed(1),
      underML: probToML(adjUnder),
      overML: probToML(1 - adjUnder),
    };
  }
  
  // First inning 3-way ML (which team scores first, or tie/0-0)
  // P(tie after 1st) = P(both 0) + P(both 1) + P(both 2) + ...
  let tieProbFirstInning = 0;
  for (let r = 0; r <= 6; r++) {
    tieProbFirstInning += poissonPMF(r, awayLambda1) * poissonPMF(r, homeLambda1);
  }
  const awayLeadsAfter1 = (1 - tieProbFirstInning) * (awayLambda1 / (awayLambda1 + homeLambda1));
  const homeLeadsAfter1 = (1 - tieProbFirstInning) * (homeLambda1 / (awayLambda1 + homeLambda1));
  
  // Signal strength for betting
  const nrfiEdge = nrfiProb > 0.5 ? nrfiProb - 0.5 : 0;
  const yrfiEdge = yrfiProb > 0.5 ? yrfiProb - 0.5 : 0;
  
  let signal, pick, modelProb, edgePct;
  if (nrfiProb >= 0.55) {
    signal = 'NRFI';
    pick = 'NRFI (No Run First Inning)';
    modelProb = nrfiProb;
    edgePct = nrfiEdge;
  } else if (yrfiProb >= 0.55) {
    signal = 'YRFI';
    pick = 'YRFI (Yes Run First Inning)';
    modelProb = yrfiProb;
    edgePct = yrfiEdge;
  } else {
    signal = 'NEUTRAL';
    pick = 'No clear edge';
    modelProb = Math.max(nrfiProb, yrfiProb);
    edgePct = 0;
  }
  
  // Confidence rating
  const confidence = edgePct >= 0.10 ? 'HIGH' : edgePct >= 0.05 ? 'MEDIUM' : 'LOW';
  
  // Rating 1-5 stars
  const stars = edgePct >= 0.12 ? 5 : edgePct >= 0.09 ? 4 : edgePct >= 0.06 ? 3 : edgePct >= 0.03 ? 2 : 1;
  
  return {
    matchup: `${away}@${home}`,
    away,
    home,
    nrfi: +(nrfiProb * 100).toFixed(1),
    yrfi: +(yrfiProb * 100).toFixed(1),
    signal,
    pick,
    confidence,
    stars,
    edge: +(edgePct * 100).toFixed(1),
    fairNrfiML: probToML(nrfiProb),
    fairYrfiML: probToML(yrfiProb),
    breakdown: {
      awayLambda1st: +awayLambda1.toFixed(4),
      homeLambda1st: +homeLambda1.toFixed(4),
      awayP0: +(awayP0 * 100).toFixed(1),
      homeP0: +(homeP0 * 100).toFixed(1),
      rawNRFI: +(awayP0 * homeP0 * 100).toFixed(1),
      homePitcherFactor,
      awayPitcherFactor,
      awayLeadoffQuality: awayLeadoff,
      homeLeadoffQuality: homeLeadoff,
      parkFactor,
      odBoost: +(odBoost * 100).toFixed(1),
      weatherBoost: +(weatherBoost * 100).toFixed(1),
      temp,
    },
    firstInning: {
      threeWayML: {
        awayWins: +(awayLeadsAfter1 * 100).toFixed(1),
        homeWins: +(homeLeadsAfter1 * 100).toFixed(1),
        tie: +(tieProbFirstInning * 100).toFixed(1),
      },
      runDistribution: runDist,
      totalsLines,
    },
    pitchers: {
      away: awayPitcherName || 'Unknown',
      home: homePitcherName || 'Unknown',
      awayTier: awayPitcherTier,
      homeTier: homePitcherTier,
    },
  };
}

/**
 * Scan all Opening Day games for NRFI/YRFI value
 */
function scanODGames(mlbModel, odGames, opts = {}) {
  const results = [];
  
  for (const game of odGames) {
    try {
      // Get prediction for the game
      const pred = mlbModel.predict(game.away, game.home, {
        awayPitcher: game.confirmedStarters?.away,
        homePitcher: game.confirmedStarters?.home,
      });
      
      // Look up pitcher tiers from K props data or default
      let awayTier = 3, homeTier = 3;
      let awayPitcherName = game.confirmedStarters?.away || 'TBD';
      let homePitcherName = game.confirmedStarters?.home || 'TBD';
      
      try {
        const kProps = require('./pitcher-k-props');
        const STEAMER = kProps.STEAMER_K9_PROJECTIONS || {};
        if (STEAMER[awayPitcherName]) awayTier = STEAMER[awayPitcherName].tier;
        if (STEAMER[homePitcherName]) homeTier = STEAMER[homePitcherName].tier;
      } catch (e) {
        // K props not available, use default tiers
      }
      
      const nrfi = calculateNRFI(game.away, game.home, {
        prediction: pred,
        awayPitcherTier: awayTier,
        homePitcherTier: homeTier,
        awayPitcherName,
        homePitcherName,
        weather: opts.weatherMap?.[game.home] || null,
        isOpeningDay: true,
        isOpeningWeek: true,
      });
      
      // Add DK line comparison if available
      if (game.dkLine) {
        nrfi.dkLine = {
          total: game.dkLine.total,
          homeML: game.dkLine.homeML,
          awayML: game.dkLine.awayML,
        };
      }
      
      nrfi.day = game.day;
      nrfi.time = game.time;
      results.push(nrfi);
    } catch (e) {
      results.push({
        matchup: `${game.away}@${game.home}`,
        error: e.message,
        day: game.day,
      });
    }
  }
  
  // Sort by edge (best NRFI or YRFI first)
  results.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  // Summary stats
  const nrfiPicks = results.filter(r => r.signal === 'NRFI');
  const yrfiPicks = results.filter(r => r.signal === 'YRFI');
  const highConf = results.filter(r => r.confidence === 'HIGH');
  
  return {
    timestamp: new Date().toISOString(),
    totalGames: results.length,
    nrfiPicks: nrfiPicks.length,
    yrfiPicks: yrfiPicks.length,
    neutralGames: results.length - nrfiPicks.length - yrfiPicks.length,
    highConfidence: highConf.length,
    avgNRFI: results.length > 0 ? +(results.reduce((s, r) => s + (r.nrfi || 50), 0) / results.length).toFixed(1) : 50,
    topNRFI: nrfiPicks.slice(0, 5).map(r => ({
      matchup: r.matchup,
      nrfi: r.nrfi,
      edge: r.edge,
      pitchers: `${r.pitchers?.away} vs ${r.pitchers?.home}`,
      stars: r.stars,
    })),
    topYRFI: yrfiPicks.slice(0, 5).map(r => ({
      matchup: r.matchup,
      yrfi: r.yrfi,
      edge: r.edge,
      pitchers: `${r.pitchers?.away} vs ${r.pitchers?.home}`,
      stars: r.stars,
    })),
    games: results,
    strategy: {
      title: '🚫 NRFI Opening Day Strategy',
      thesis: 'OD aces + rusty bats + cold weather = historically suppressed 1st innings. Focus on games with two Tier 1-2 starters in pitcher-friendly parks.',
      bestNRFI: 'Two aces in a pitcher park with cold weather → NRFI rates can hit 65-70%',
      bestYRFI: 'Hitter-friendly park (GABP, CBP, Coors) + Tier 3-4 starters → YRFI lean',
      kellySizing: 'Use quarter-Kelly on NRFI plays (variance is high on single-inning outcomes)',
      correlation: 'NRFI + game F5 UNDER is a positively correlated parlay (+0.15)',
    },
  };
}

/**
 * Compare NRFI model probabilities against live odds for value detection
 */
function compareToOdds(nrfiResult, bookNRFIml, bookYRFIml) {
  if (!bookNRFIml && !bookYRFIml) return null;
  
  const modelNRFI = nrfiResult.nrfi / 100;
  const modelYRFI = nrfiResult.yrfi / 100;
  
  const bookNRFIprob = bookNRFIml ? mlToProb(bookNRFIml) : null;
  const bookYRFIprob = bookYRFIml ? mlToProb(bookYRFIml) : null;
  
  const result = {
    matchup: nrfiResult.matchup,
    plays: [],
  };
  
  if (bookNRFIprob) {
    const nrfiEdge = modelNRFI - bookNRFIprob;
    if (nrfiEdge > 0.02) { // 2% min edge
      result.plays.push({
        pick: 'NRFI',
        modelProb: +(modelNRFI * 100).toFixed(1),
        bookProb: +(bookNRFIprob * 100).toFixed(1),
        bookML: bookNRFIml,
        edge: +(nrfiEdge * 100).toFixed(1),
        confidence: nrfiEdge >= 0.08 ? 'HIGH' : nrfiEdge >= 0.05 ? 'MEDIUM' : 'LOW',
        kellyQtr: +(Math.max(0, 0.25 * (modelNRFI * (bookNRFIml > 0 ? bookNRFIml / 100 : 100 / Math.abs(bookNRFIml)) - (1 - modelNRFI)) / (bookNRFIml > 0 ? bookNRFIml / 100 : 100 / Math.abs(bookNRFIml))) * 100).toFixed(1),
      });
    }
  }
  
  if (bookYRFIprob) {
    const yrfiEdge = modelYRFI - bookYRFIprob;
    if (yrfiEdge > 0.02) {
      result.plays.push({
        pick: 'YRFI',
        modelProb: +(modelYRFI * 100).toFixed(1),
        bookProb: +(bookYRFIprob * 100).toFixed(1),
        bookML: bookYRFIml,
        edge: +(yrfiEdge * 100).toFixed(1),
        confidence: yrfiEdge >= 0.08 ? 'HIGH' : yrfiEdge >= 0.05 ? 'MEDIUM' : 'LOW',
        kellyQtr: +(Math.max(0, 0.25 * (modelYRFI * (bookYRFIml > 0 ? bookYRFIml / 100 : 100 / Math.abs(bookYRFIml)) - (1 - modelYRFI)) / (bookYRFIml > 0 ? bookYRFIml / 100 : 100 / Math.abs(bookYRFIml))) * 100).toFixed(1),
      });
    }
  }
  
  return result;
}

// ==================== HELPERS ====================

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function mlToProb(ml) {
  if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
  return 100 / (ml + 100);
}

module.exports = {
  calculateNRFI,
  scanODGames,
  compareToOdds,
  FIRST_INNING_FACTORS,
  TEAM_LEADOFF_QUALITY,
  PARK_FIRST_INNING_FACTOR,
};
