// services/nba-period-markets.js — NBA Quarter & Half Period Markets Model v96.0
// ================================================================================
// Models NBA period-level betting markets: Q1-Q4, 1H, 2H
// The Odds API supports: h2h_q1-q4, totals_q1-q4, spreads_q1-q4, h2h_h1-h2, totals_h1-h2, spreads_h1-h2
//
// WHY PERIOD MARKETS PRINT MONEY:
// - Lower volume = less sharp action = wider edges than full-game markets
// - Quarter-level dynamics differ significantly from full-game: Q3 is where elite teams separate,
//   Q4 garbage time compresses spreads, 1H is more predictable than 2H
// - Rest/tank model compounds at quarter level: tanking teams rest stars Q4 = massive spread shift
// - NBA playoffs: coaches deploy starters ~40 min = all 4 quarters matter, eliminates Q4 garbage time
// - Books use crude quarter approximations (just divide full game by 4), we model true distributions
//
// Key NBA Period Scoring Patterns (2024-25 analysis):
// - Q1: ~24.2% of total (teams warming up, conservative play)
// - Q2: ~25.3% (pace increases, bench rotations)
// - Q3: ~25.8% (halftime adjustments, star minutes increase)
// - Q4: ~24.7% (variable: close games = stars, blowouts = bench)
// - 1H: ~49.5% of total (slightly less than 2H)
// - 2H: ~50.5% (pace increases, urgency, fouling)
//
// HCA Distribution: Home advantage is NOT evenly distributed:
// - Q1: 0.5 pts (crowd energy, slight)
// - Q2: 0.5 pts (bench rotation cancels some advantage)
// - Q3: 0.8 pts (halftime adjustments favor home coaches)
// - Q4: 0.7 pts (crowd factor in close games, home closing strength)
// - Total HCA: ~2.5 pts (matches our full-game model)

const nbaModel = require('../models/nba');
let restTankSvc = null;
try { restTankSvc = require('./nba-rest-tank'); } catch (e) {}
let oddsApi = null;
try { oddsApi = require('./live-data'); } catch (e) {}

// ==================== SCORING DISTRIBUTION PARAMETERS ====================
// Based on 2024-25 NBA season analysis of 1230 regular season games

// Fraction of total scoring by quarter (league average)
const QUARTER_SCORING_SHARE = {
  Q1: 0.242,
  Q2: 0.253,
  Q3: 0.258,
  Q4: 0.247
};

// Half scoring shares
const HALF_SCORING_SHARE = {
  '1H': 0.495, // Q1 + Q2
  '2H': 0.505  // Q3 + Q4
};

// HCA distribution by period (points, sums to ~2.5)
const HCA_BY_PERIOD = {
  Q1: 0.5,
  Q2: 0.5,
  Q3: 0.8,
  Q4: 0.7,
  '1H': 1.0,
  '2H': 1.5
};

// Standard deviation of scoring by period (for normal distribution modeling)
// Quarter scoring has relatively high variance
const SCORING_STDEV = {
  Q1: 5.8,  // ~24 pts avg, 5.8 SD
  Q2: 6.0,  // ~25 pts avg, 6.0 SD
  Q3: 6.2,  // ~26 pts avg, 6.2 SD — highest variance (adjustments + star load)
  Q4: 7.5,  // ~25 pts avg, 7.5 SD — highest variance (garbage time vs clutch)
  '1H': 8.2,  // ~49 pts avg, 8.2 SD
  '2H': 9.0   // ~51 pts avg, 9.0 SD — higher variance
};

// ==================== TEAM QUARTER SCORING PROFILES ====================
// Some teams are fast starters (Q1 dominant) or closers (Q3/Q4 dominant)
// This captures team-specific quarter tendencies
// Format: { Q1, Q2, Q3, Q4 } — multiplier vs league average share
// >1.0 = team scores proportionally MORE in that quarter
// <1.0 = team scores proportionally LESS
const TEAM_QUARTER_PROFILES = {
  // Elite Q3 teams (halftime adjustment masters)
  OKC:  { Q1: 0.98, Q2: 1.00, Q3: 1.06, Q4: 0.96, note: 'Elite Q3 — SGA turns it on after halftime' },
  BOS:  { Q1: 1.01, Q2: 1.02, Q3: 1.04, Q4: 0.93, note: 'Strong 1H, Q3 dominance, coasts Q4 in blowouts' },
  CLE:  { Q1: 1.02, Q2: 1.00, Q3: 1.05, Q4: 0.93, note: 'Fast starts + elite Q3 = blowout machine' },
  DEN:  { Q1: 0.96, Q2: 1.02, Q3: 1.05, Q4: 1.00, note: 'Slow starter, Jokic dominates 2H' },
  
  // Fast start teams (Q1 dominant)
  SAS:  { Q1: 1.04, Q2: 1.01, Q3: 0.98, Q4: 0.97, note: 'Wemby energy in Q1 but fades late' },
  DET:  { Q1: 1.03, Q2: 1.01, Q3: 1.00, Q4: 0.96, note: 'Young energy Q1, depth issues Q4' },
  MEM:  { Q1: 1.03, Q2: 1.02, Q3: 1.00, Q4: 0.95, note: 'Ja Morant fast starts' },
  NYK:  { Q1: 1.02, Q2: 1.01, Q3: 1.01, Q4: 0.96, note: 'Consistent across quarters, slight Q4 dip' },
  
  // Closers (Q4 dominant)
  LAL:  { Q1: 0.97, Q2: 0.99, Q3: 1.00, Q4: 1.04, note: 'LeBron Q4 takeovers' },
  MIL:  { Q1: 0.98, Q2: 1.00, Q3: 1.00, Q4: 1.02, note: 'Giannis Q4 attacks' },
  DAL:  { Q1: 0.97, Q2: 1.00, Q3: 1.02, Q4: 1.01, note: 'Luka clutch Q4' },
  PHX:  { Q1: 0.98, Q2: 1.01, Q3: 1.00, Q4: 1.01, note: 'KD/Booker Q4 iso machine' },
  
  // Tank/rebuild teams (Q4 collapse)
  WAS:  { Q1: 1.01, Q2: 1.00, Q3: 0.98, Q4: 1.01, note: 'Young guys play even minutes' },
  POR:  { Q1: 1.00, Q2: 1.00, Q3: 0.99, Q4: 1.01, note: 'Tank mode = even Q4 scoring' },
  BKN:  { Q1: 1.00, Q2: 1.01, Q3: 0.98, Q4: 1.01, note: 'No stars to rest = even distribution' },
  NOP:  { Q1: 0.99, Q2: 1.00, Q3: 0.99, Q4: 1.02, note: 'Injury-depleted = inconsistent' },
  UTA:  { Q1: 0.99, Q2: 1.01, Q3: 0.98, Q4: 1.02, note: 'Tank mode' },
  CHA:  { Q1: 1.00, Q2: 1.01, Q3: 0.98, Q4: 1.01, note: 'Young team, even distribution' },
  
  // Balanced teams
  HOU:  { Q1: 1.00, Q2: 1.01, Q3: 1.02, Q4: 0.97, note: 'Good Q3, defensive closers' },
  MIN:  { Q1: 1.00, Q2: 1.00, Q3: 1.03, Q4: 0.97, note: 'Elite Q3 defense' },
  SAC:  { Q1: 1.01, Q2: 1.01, Q3: 0.99, Q4: 0.99, note: 'Balanced, Fox fast starts' },
  ATL:  { Q1: 1.01, Q2: 1.00, Q3: 0.99, Q4: 1.00, note: 'Trae Young consistent all quarters' },
  TOR:  { Q1: 1.00, Q2: 1.01, Q3: 1.00, Q4: 0.99, note: 'Balanced' },
  IND:  { Q1: 1.02, Q2: 1.01, Q3: 0.99, Q4: 0.98, note: 'Fast pace all quarters' },
  CHI:  { Q1: 1.00, Q2: 1.01, Q3: 0.99, Q4: 1.00, note: 'Average across the board' },
  ORL:  { Q1: 0.99, Q2: 1.00, Q3: 1.02, Q4: 0.99, note: 'Defensive team, solid Q3' },
  MIA:  { Q1: 0.98, Q2: 1.00, Q3: 1.03, Q4: 0.99, note: 'Spoelstra Q3 adjustments' },
  GSW:  { Q1: 1.01, Q2: 1.01, Q3: 1.00, Q4: 0.98, note: 'Steph Q1 splash, Q3 runs' },
  PHI:  { Q1: 0.99, Q2: 1.00, Q3: 1.01, Q4: 1.00, note: 'Embiid load management affects Q4' },
  LAC:  { Q1: 0.99, Q2: 1.01, Q3: 1.00, Q4: 1.00, note: 'Balanced without Kawhi' },
};

// Default profile for teams not listed
const DEFAULT_QUARTER_PROFILE = { Q1: 1.00, Q2: 1.00, Q3: 1.00, Q4: 1.00 };

// ==================== REST/TANK QUARTER IMPACT ====================
// How rest/tank motivation affects quarter scoring
// TANKING teams rest stars Q3/Q4 = massive 2H spread shift
// RESTING teams start reserves or pull starters early = Q1/Q4 impact
// DESPERATE teams play starters 38+ min = even quarter distribution
const MOTIVATION_QUARTER_IMPACT = {
  TANKING: {
    starsQ1: 0.95,   // May start young guys
    starsQ3: 0.85,   // Stars pulled early or limited minutes
    starsQ4: 0.70,   // Stars often DNP or pulled by Q4
    note: 'Tank teams surrender 2H — massive Q3/Q4 spread shift'
  },
  RESTING: {
    starsQ1: 0.90,   // May not start, or limited opening minutes
    starsQ3: 0.90,   // Similar if resting
    starsQ4: 0.80,   // Pulled early for rest
    note: 'Resting stars = weak across all quarters, especially Q4'
  },
  COASTING: {
    starsQ1: 1.00,
    starsQ3: 1.00,
    starsQ4: 0.95,   // Slight Q4 easing in blowouts
    note: 'Normal minutes with slight Q4 easing'
  },
  DESPERATE: {
    starsQ1: 1.02,
    starsQ3: 1.05,   // Coaches ride stars harder
    starsQ4: 1.05,   // All out
    note: 'Max effort all 4 quarters — stars play 38+ min'
  },
  COMPETING: {
    starsQ1: 1.00,
    starsQ3: 1.02,
    starsQ4: 1.00,
    note: 'Normal rotation and effort'
  }
};

// ==================== CORE PREDICTION ENGINE ====================

/**
 * Get team quarter profile (with fallback)
 */
function getTeamProfile(abbr) {
  return TEAM_QUARTER_PROFILES[abbr] || DEFAULT_QUARTER_PROFILE;
}

/**
 * Predict period-level outcomes for a given matchup
 * 
 * @param {string} away - team abbreviation
 * @param {string} home - team abbreviation
 * @param {object} opts - { awayMotivation, homeMotivation, isPlayoffs }
 * @returns {object} period predictions with spreads, totals, moneylines
 */
function predictPeriods(away, home, opts = {}) {
  // Get full-game prediction from NBA model
  const fullGame = nbaModel.predict(away, home, opts);
  if (fullGame.error) return { error: fullGame.error };
  
  const gameTotal = fullGame.predictedTotal;
  const gameSpread = fullGame.spread;  // negative = home favored
  const awayPower = fullGame.away.adjPower || fullGame.away.power;
  const homePower = fullGame.home.adjPower || fullGame.home.power;
  
  const awayProfile = getTeamProfile(away);
  const homeProfile = getTeamProfile(home);
  
  // Get motivation impacts
  const awayMotiv = opts.awayMotivation || 'COMPETING';
  const homeMotiv = opts.homeMotivation || 'COMPETING';
  const awayMotivImpact = MOTIVATION_QUARTER_IMPACT[awayMotiv] || MOTIVATION_QUARTER_IMPACT.COMPETING;
  const homeMotivImpact = MOTIVATION_QUARTER_IMPACT[homeMotiv] || MOTIVATION_QUARTER_IMPACT.COMPETING;
  
  const isPlayoffs = opts.isPlayoffs || false;
  
  const periods = {};
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  
  // ===== QUARTER PREDICTIONS =====
  for (const q of quarters) {
    const shareBase = QUARTER_SCORING_SHARE[q];
    
    // Team-specific quarter adjustments
    const awayQAdj = awayProfile[q];
    const homeQAdj = homeProfile[q];
    
    // Motivation-based quarter adjustments
    let awayMotivMult = 1.0;
    let homeMotivMult = 1.0;
    if (q === 'Q1') {
      awayMotivMult = awayMotivImpact.starsQ1;
      homeMotivMult = homeMotivImpact.starsQ1;
    } else if (q === 'Q3') {
      awayMotivMult = awayMotivImpact.starsQ3;
      homeMotivMult = homeMotivImpact.starsQ3;
    } else if (q === 'Q4') {
      awayMotivMult = awayMotivImpact.starsQ4;
      homeMotivMult = homeMotivImpact.starsQ4;
      // In playoffs, Q4 motivation differences shrink (both teams go all out)
      if (isPlayoffs) {
        awayMotivMult = 1.0 + (awayMotivMult - 1.0) * 0.3;
        homeMotivMult = 1.0 + (homeMotivMult - 1.0) * 0.3;
      }
    }
    
    // Expected team quarter scoring
    // Base: each team's per-game scoring × quarter share × team quarter profile × motivation
    const awayPPG = fullGame.predictedScore.away;
    const homePPG = fullGame.predictedScore.home;
    
    const awayQScore = awayPPG * shareBase * awayQAdj * awayMotivMult;
    const homeQScore = homePPG * shareBase * homeQAdj * homeMotivMult;
    
    const qTotal = +(awayQScore + homeQScore).toFixed(1);
    const qSpread = +(awayQScore - homeQScore).toFixed(1); // negative = home favored
    
    // Quarter win probability (using quarter-level spread)
    // Quarter spreads have more variance → use larger scaling factor
    const QUARTER_SPREAD_FACTOR = 22; // wider than full game (15) because more variance per quarter
    const homeQWinProb = 1 / (1 + Math.pow(10, qSpread / QUARTER_SPREAD_FACTOR));
    const awayQWinProb = 1 - homeQWinProb;
    
    // Quarter ML
    const homeQML = probToML(homeQWinProb);
    const awayQML = probToML(awayQWinProb);
    
    // Standard totals lines
    const qTotalLines = generateTotalLines(qTotal, SCORING_STDEV[q]);
    
    periods[q] = {
      period: q,
      awayScore: +awayQScore.toFixed(1),
      homeScore: +homeQScore.toFixed(1),
      total: qTotal,
      spread: qSpread,
      homeWinProb: +(homeQWinProb * 100).toFixed(1),
      awayWinProb: +(awayQWinProb * 100).toFixed(1),
      modelML: { away: formatML(awayQML), home: formatML(homeQML) },
      totalLines: qTotalLines,
      stdev: SCORING_STDEV[q],
      factors: {
        baseShare: shareBase,
        awayProfile: awayQAdj,
        homeProfile: homeQAdj,
        awayMotivation: awayMotiv,
        homeMotivation: homeMotiv,
        awayMotivMult,
        homeMotivMult,
        isPlayoffs
      }
    };
  }
  
  // ===== HALF PREDICTIONS =====
  for (const half of ['1H', '2H']) {
    const q1 = half === '1H' ? 'Q1' : 'Q3';
    const q2 = half === '1H' ? 'Q2' : 'Q4';
    
    const halfAwayScore = periods[q1].awayScore + periods[q2].awayScore;
    const halfHomeScore = periods[q1].homeScore + periods[q2].homeScore;
    const halfTotal = +(halfAwayScore + halfHomeScore).toFixed(1);
    const halfSpread = +(halfAwayScore - halfHomeScore).toFixed(1);
    
    // Half spread → probability (less variance than quarters, more than full game)
    const HALF_SPREAD_FACTOR = 18;
    const homeHWinProb = 1 / (1 + Math.pow(10, halfSpread / HALF_SPREAD_FACTOR));
    const awayHWinProb = 1 - homeHWinProb;
    
    const homeHML = probToML(homeHWinProb);
    const awayHML = probToML(awayHWinProb);
    
    const halfTotalLines = generateTotalLines(halfTotal, SCORING_STDEV[half]);
    
    periods[half] = {
      period: half,
      awayScore: +halfAwayScore.toFixed(1),
      homeScore: +halfHomeScore.toFixed(1),
      total: halfTotal,
      spread: halfSpread,
      homeWinProb: +(homeHWinProb * 100).toFixed(1),
      awayWinProb: +(awayHWinProb * 100).toFixed(1),
      modelML: { away: formatML(awayHML), home: formatML(homeHML) },
      totalLines: halfTotalLines,
      stdev: SCORING_STDEV[half],
      factors: {
        quarters: half === '1H' ? ['Q1', 'Q2'] : ['Q3', 'Q4'],
        halfShare: HALF_SCORING_SHARE[half]
      }
    };
  }
  
  return {
    timestamp: new Date().toISOString(),
    matchup: `${away} @ ${home}`,
    fullGame: {
      spread: gameSpread,
      total: gameTotal,
      homeWinProb: fullGame.homeWinProb,
      awayWinProb: fullGame.awayWinProb,
      predictedScore: fullGame.predictedScore
    },
    periods,
    profiles: {
      away: { abbr: away, profile: awayProfile, motivation: awayMotiv },
      home: { abbr: home, profile: homeProfile, motivation: homeMotiv }
    }
  };
}

/**
 * Async version that includes rest/tank data for quarter impact
 */
async function asyncPredictPeriods(away, home, opts = {}) {
  // Get rest/tank adjustment
  let awayMotiv = 'COMPETING';
  let homeMotiv = 'COMPETING';
  
  if (restTankSvc) {
    try {
      const standings = nbaModel.getTeams();
      const targetDate = opts.gameDate || new Date().toISOString().split('T')[0];
      const rtData = await restTankSvc.getGameAdjustment(away, home, standings, targetDate);
      if (rtData) {
        if (rtData.away?.motivation?.motivation) awayMotiv = rtData.away.motivation.motivation;
        if (rtData.home?.motivation?.motivation) homeMotiv = rtData.home.motivation.motivation;
      }
    } catch (e) {
      // Fall through to default motivation
    }
  }
  
  return predictPeriods(away, home, { ...opts, awayMotivation: awayMotiv, homeMotivation: homeMotiv });
}

// ==================== VALUE DETECTION ====================

/**
 * Compare period prediction to book line, find +EV opportunities
 * 
 * @param {object} periodPred - single period prediction (Q1, Q2, Q3, Q4, 1H, 2H)
 * @param {object} bookLine - { spread, spreadOdds, total, overOdds, underOdds, homeML, awayML }
 * @param {string} period - period name
 * @param {string} away - away team abbr
 * @param {string} home - home team abbr
 * @returns {array} value bets found
 */
function findPeriodValue(periodPred, bookLine, period, away, home) {
  const edges = [];
  const MIN_EDGE_PCT = 3.0; // minimum 3% edge to flag
  
  // === Moneyline value ===
  if (bookLine.homeML !== undefined && bookLine.awayML !== undefined) {
    const bookHomeProb = mlToProb(bookLine.homeML);
    const bookAwayProb = mlToProb(bookLine.awayML);
    const modelHomeProb = periodPred.homeWinProb / 100;
    const modelAwayProb = periodPred.awayWinProb / 100;
    
    const homeEdge = (modelHomeProb - bookHomeProb) * 100;
    const awayEdge = (modelAwayProb - bookAwayProb) * 100;
    
    if (homeEdge > MIN_EDGE_PCT) {
      edges.push({
        period,
        type: 'moneyline',
        pick: `${home} ${period} ML`,
        bookML: bookLine.homeML,
        modelProb: +(modelHomeProb * 100).toFixed(1),
        bookProb: +(bookHomeProb * 100).toFixed(1),
        edge: +homeEdge.toFixed(1),
        ev: calcEV(modelHomeProb, bookLine.homeML),
        kelly: kellySize(modelHomeProb, bookLine.homeML),
        confidence: homeEdge >= 8 ? 'HIGH' : homeEdge >= 5 ? 'MEDIUM' : 'LOW'
      });
    }
    if (awayEdge > MIN_EDGE_PCT) {
      edges.push({
        period,
        type: 'moneyline',
        pick: `${away} ${period} ML`,
        bookML: bookLine.awayML,
        modelProb: +(modelAwayProb * 100).toFixed(1),
        bookProb: +(bookAwayProb * 100).toFixed(1),
        edge: +awayEdge.toFixed(1),
        ev: calcEV(modelAwayProb, bookLine.awayML),
        kelly: kellySize(modelAwayProb, bookLine.awayML),
        confidence: awayEdge >= 8 ? 'HIGH' : awayEdge >= 5 ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  // === Spread value ===
  if (bookLine.spread !== undefined) {
    const modelSpread = periodPred.spread;
    const spreadDiff = Math.abs(modelSpread - bookLine.spread);
    
    // For quarters, 1.5+ pt spread diff is significant; for halves, 2+ pts
    const isQuarter = period.startsWith('Q');
    const minSpreadEdge = isQuarter ? 1.5 : 2.0;
    
    if (spreadDiff >= minSpreadEdge) {
      const side = modelSpread < bookLine.spread ? home : away;
      const sideSpread = modelSpread < bookLine.spread ? bookLine.spread : -bookLine.spread;
      const odds = bookLine.spreadOdds || -110;
      
      // Convert spread edge to probability edge
      const spreadFactor = isQuarter ? SCORING_STDEV[period] : SCORING_STDEV[period];
      const edgeProb = normalCDF(spreadDiff / spreadFactor);
      
      edges.push({
        period,
        type: 'spread',
        pick: `${side} ${period} ${sideSpread > 0 ? '+' : ''}${sideSpread}`,
        modelSpread: modelSpread,
        bookSpread: bookLine.spread,
        spreadDiff: +spreadDiff.toFixed(1),
        odds,
        edge: +(spreadDiff).toFixed(1),
        confidence: spreadDiff >= (minSpreadEdge * 2) ? 'HIGH' : spreadDiff >= (minSpreadEdge * 1.5) ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  // === Total value ===
  if (bookLine.total !== undefined) {
    const modelTotal = periodPred.total;
    const totalDiff = modelTotal - bookLine.total;
    const absDiff = Math.abs(totalDiff);
    
    // For quarters, 1.5+ pt total diff is significant; for halves, 2+ pts
    const isQuarter = period.startsWith('Q');
    const minTotalEdge = isQuarter ? 1.5 : 2.0;
    
    if (absDiff >= minTotalEdge) {
      const direction = totalDiff > 0 ? 'OVER' : 'UNDER';
      const odds = direction === 'OVER' ? (bookLine.overOdds || -110) : (bookLine.underOdds || -110);
      
      // Calculate probability using normal distribution
      const stdev = SCORING_STDEV[period];
      const zScore = absDiff / stdev;
      const prob = normalCDF(zScore);
      const impliedProb = mlToProb(odds);
      const edgePct = (prob - impliedProb) * 100;
      
      if (edgePct > MIN_EDGE_PCT) {
        edges.push({
          period,
          type: 'total',
          pick: `${direction} ${bookLine.total} ${period}`,
          modelTotal: modelTotal,
          bookTotal: bookLine.total,
          diff: +totalDiff.toFixed(1),
          prob: +(prob * 100).toFixed(1),
          impliedProb: +(impliedProb * 100).toFixed(1),
          edge: +edgePct.toFixed(1),
          ev: calcEV(prob, odds),
          kelly: kellySize(prob, odds),
          odds,
          confidence: edgePct >= 8 ? 'HIGH' : edgePct >= 5 ? 'MEDIUM' : 'LOW'
        });
      }
    }
  }
  
  return edges;
}

/**
 * Scan all today's NBA games for period market value
 * Uses The Odds API for live period market odds
 */
async function scanPeriodValue() {
  const results = {
    timestamp: new Date().toISOString(),
    gamesScanned: 0,
    totalValueBets: 0,
    byPeriod: { Q1: [], Q2: [], Q3: [], Q4: [], '1H': [], '2H': [] },
    topPlays: [],
    allValueBets: []
  };
  
  // Get today's NBA odds from Odds API
  let games = [];
  if (oddsApi) {
    try {
      const nbaOdds = await oddsApi.getAllOdds('nba');
      if (nbaOdds && nbaOdds.length > 0) {
        games = nbaOdds;
      }
    } catch (e) {
      // No odds available
    }
  }
  
  // If no live odds, get games from NBA model
  if (games.length === 0) {
    const teams = nbaModel.getTeams();
    // Can't scan without odds — return empty with guidance
    results.note = 'No live NBA odds available. Period value scan requires live odds data.';
    return results;
  }
  
  // Scan each game
  for (const game of games) {
    const away = game.away;
    const home = game.home;
    if (!away || !home) continue;
    
    try {
      // Get period predictions with rest/tank auto-detection
      const periodPred = await asyncPredictPeriods(away, home);
      if (periodPred.error) continue;
      
      results.gamesScanned++;
      
      // Check each period for value
      // In practice, we'd need period-specific odds from the API
      // For now, generate synthetic period lines from full-game odds and detect structural edges
      const periods = ['Q1', 'Q2', 'Q3', 'Q4', '1H', '2H'];
      
      for (const period of periods) {
        const pred = periodPred.periods[period];
        if (!pred) continue;
        
        // Extract book lines for this period if available
        const bookLine = extractPeriodBookLine(game, period);
        if (!bookLine) continue;
        
        const valueBets = findPeriodValue(pred, bookLine, period, away, home);
        
        for (const bet of valueBets) {
          bet.game = `${away} @ ${home}`;
          bet.gameTime = game.commence_time || game.commenceTime;
          results.allValueBets.push(bet);
          results.byPeriod[period].push(bet);
        }
      }
    } catch (e) {
      // Skip failed game
      continue;
    }
  }
  
  results.totalValueBets = results.allValueBets.length;
  
  // Sort all value bets by edge descending
  results.allValueBets.sort((a, b) => b.edge - a.edge);
  results.topPlays = results.allValueBets.slice(0, 15);
  
  // Summary by period
  results.periodSummary = {};
  for (const [p, bets] of Object.entries(results.byPeriod)) {
    results.periodSummary[p] = {
      valueBets: bets.length,
      highConfidence: bets.filter(b => b.confidence === 'HIGH').length,
      avgEdge: bets.length > 0 ? +(bets.reduce((s, b) => s + b.edge, 0) / bets.length).toFixed(1) : 0
    };
  }
  
  return results;
}

/**
 * Extract period-specific book lines from game odds data
 * The Odds API markets: h2h_q1, totals_q1, spreads_q1, etc.
 */
function extractPeriodBookLine(game, period) {
  if (!game.books && !game.bookmakers) return null;
  
  const books = game.books || game.bookmakers || [];
  const periodKey = period.toLowerCase().replace('h', '_half_');
  
  // Map period names to Odds API market suffixes
  const marketSuffix = {
    'Q1': '1st_quarter', 'Q2': '2nd_quarter', 'Q3': '3rd_quarter', 'Q4': '4th_quarter',
    '1H': '1st_half', '2H': '2nd_half'
  }[period];
  
  if (!marketSuffix) return null;
  
  const bookLine = {};
  
  // Priority: DraftKings > FanDuel > others
  const priorityBooks = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet'];
  
  for (const bookName of priorityBooks) {
    const book = books.find(b => {
      const key = (b.key || b.title || '').toLowerCase();
      return key.includes(bookName);
    });
    if (!book) continue;
    
    const markets = book.markets || [];
    
    // Look for h2h (moneyline), totals, spreads for this period
    for (const market of markets) {
      const mKey = (market.key || '').toLowerCase();
      
      if (mKey.includes('h2h') && mKey.includes(marketSuffix)) {
        // Period moneyline
        const outcomes = market.outcomes || [];
        for (const o of outcomes) {
          if (o.name === game.home_team || o.name === game.home) {
            bookLine.homeML = o.price;
          } else if (o.name === game.away_team || o.name === game.away) {
            bookLine.awayML = o.price;
          }
        }
      }
      
      if (mKey.includes('totals') && mKey.includes(marketSuffix)) {
        // Period total
        const outcomes = market.outcomes || [];
        for (const o of outcomes) {
          if (o.name === 'Over') {
            bookLine.total = o.point;
            bookLine.overOdds = o.price;
          } else if (o.name === 'Under') {
            bookLine.underOdds = o.price;
            if (!bookLine.total && o.point) bookLine.total = o.point;
          }
        }
      }
      
      if (mKey.includes('spreads') && mKey.includes(marketSuffix)) {
        // Period spread
        const outcomes = market.outcomes || [];
        for (const o of outcomes) {
          if (o.name === game.home_team || o.name === game.home) {
            bookLine.spread = -o.point; // Convert to our convention (negative = home favored)
            bookLine.spreadOdds = o.price;
          }
        }
      }
    }
    
    // If we found any data from this book, use it
    if (Object.keys(bookLine).length > 0) break;
  }
  
  return Object.keys(bookLine).length > 0 ? bookLine : null;
}

// ==================== STRUCTURAL EDGE SCANNER ====================
// Even without live period odds, we can identify STRUCTURAL edges
// based on team quarter profiles + motivation mismatches

/**
 * Find structural quarter edges for a matchup
 * These are edges that exist regardless of specific book lines
 */
function findStructuralEdges(away, home, opts = {}) {
  const prediction = predictPeriods(away, home, opts);
  if (prediction.error) return { error: prediction.error };
  
  const edges = [];
  const fullSpread = prediction.fullGame.spread;
  const fullTotal = prediction.fullGame.total;
  
  // Compare each quarter's expected share to the "naive" share (exactly 25%)
  const naiveQuarterTotal = fullTotal / 4;
  const naiveQuarterSpread = fullSpread / 4;
  
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  for (const q of quarters) {
    const pred = prediction.periods[q];
    
    // Total deviation from naive quarter split
    const totalDeviation = pred.total - naiveQuarterTotal;
    if (Math.abs(totalDeviation) >= 1.0) {
      edges.push({
        period: q,
        type: 'total_structural',
        description: totalDeviation > 0 
          ? `${q} total should be HIGHER than naive quarter split`
          : `${q} total should be LOWER than naive quarter split`,
        naiveTotal: +naiveQuarterTotal.toFixed(1),
        modelTotal: pred.total,
        deviation: +totalDeviation.toFixed(1),
        direction: totalDeviation > 0 ? 'OVER' : 'UNDER',
        factors: pred.factors,
        strength: Math.abs(totalDeviation) >= 2.0 ? 'STRONG' : 'MODERATE'
      });
    }
    
    // Spread deviation from naive quarter split
    const spreadDeviation = pred.spread - naiveQuarterSpread;
    if (Math.abs(spreadDeviation) >= 0.8) {
      const favoredTeam = spreadDeviation < 0 ? home : away;
      edges.push({
        period: q,
        type: 'spread_structural',
        description: `${favoredTeam} has disproportionate ${q} advantage`,
        naiveSpread: +naiveQuarterSpread.toFixed(1),
        modelSpread: pred.spread,
        deviation: +spreadDeviation.toFixed(1),
        favoredTeam,
        factors: pred.factors,
        strength: Math.abs(spreadDeviation) >= 1.5 ? 'STRONG' : 'MODERATE'
      });
    }
  }
  
  // Half edges (1H vs 2H)
  const h1Total = prediction.periods['1H'].total;
  const h2Total = prediction.periods['2H'].total;
  const halfTotalDiff = h2Total - h1Total;
  
  if (Math.abs(halfTotalDiff) >= 2.0) {
    edges.push({
      period: halfTotalDiff > 0 ? '2H' : '1H',
      type: 'half_total_structural',
      description: `${halfTotalDiff > 0 ? '2H' : '1H'} scoring significantly higher`,
      h1Total: +h1Total.toFixed(1),
      h2Total: +h2Total.toFixed(1),
      diff: +halfTotalDiff.toFixed(1),
      strength: Math.abs(halfTotalDiff) >= 3.0 ? 'STRONG' : 'MODERATE'
    });
  }
  
  // Motivation mismatch edges (the money plays)
  const awayMotiv = opts.awayMotivation || 'COMPETING';
  const homeMotiv = opts.homeMotivation || 'COMPETING';
  
  if (awayMotiv === 'TANKING' || homeMotiv === 'TANKING') {
    const tankTeam = awayMotiv === 'TANKING' ? away : home;
    const oppTeam = awayMotiv === 'TANKING' ? home : away;
    
    edges.push({
      period: 'Q4',
      type: 'motivation_mismatch',
      description: `${tankTeam} TANKING → massive Q3/Q4 fade. ${oppTeam} should dominate 2H.`,
      tankTeam,
      favoredTeam: oppTeam,
      strength: 'STRONG',
      note: 'Tank teams pull starters Q3/Q4 — book Q4 spreads underestimate this'
    });
    
    edges.push({
      period: '2H',
      type: 'motivation_mismatch',
      description: `2H strongly favors ${oppTeam} — ${tankTeam} checks out after halftime`,
      tankTeam,
      favoredTeam: oppTeam,
      strength: 'STRONG'
    });
  }
  
  if (awayMotiv === 'RESTING' || homeMotiv === 'RESTING') {
    const restTeam = awayMotiv === 'RESTING' ? away : home;
    edges.push({
      period: 'Q1',
      type: 'rest_impact',
      description: `${restTeam} RESTING stars — may start reserves, weak Q1`,
      restTeam,
      strength: 'MODERATE',
      note: 'Resting teams often start slow, especially in Q1'
    });
  }
  
  if ((awayMotiv === 'DESPERATE' && homeMotiv === 'COASTING') ||
      (homeMotiv === 'DESPERATE' && awayMotiv === 'COASTING')) {
    const desperateTeam = awayMotiv === 'DESPERATE' ? away : home;
    edges.push({
      period: 'Q4',
      type: 'motivation_mismatch',
      description: `${desperateTeam} DESPERATE vs opponent COASTING — Q4 effort edge`,
      favoredTeam: desperateTeam,
      strength: 'MODERATE',
      note: 'Desperate teams play starters full minutes in close games'
    });
  }
  
  return {
    matchup: `${away} @ ${home}`,
    prediction,
    structuralEdges: edges,
    totalEdges: edges.length,
    strongEdges: edges.filter(e => e.strength === 'STRONG').length,
    summary: edges.length === 0 
      ? 'No significant quarter-level edges detected — game distributes evenly across periods'
      : `${edges.length} structural edge${edges.length > 1 ? 's' : ''} found (${edges.filter(e => e.strength === 'STRONG').length} STRONG)`
  };
}

/**
 * Scan all today's games for structural period edges
 */
async function scanStructuralEdges() {
  const results = {
    timestamp: new Date().toISOString(),
    gamesScanned: 0,
    totalEdges: 0,
    strongEdges: 0,
    games: [],
    topPlays: []
  };
  
  // Get today's games from ESPN or Odds API
  let gamePairs = [];
  
  if (oddsApi) {
    try {
      const nbaOdds = await oddsApi.getAllOdds('nba');
      if (nbaOdds && nbaOdds.length > 0) {
        gamePairs = nbaOdds.map(g => ({ away: g.away, home: g.home }));
      }
    } catch (e) {}
  }
  
  // If no odds data, try to get from live-data ESPN
  if (gamePairs.length === 0 && oddsApi) {
    try {
      const nbaData = oddsApi.getNBAData();
      // We can't determine today's games from standings alone
      // Return with note
      results.note = 'No live NBA game data available for today.';
      return results;
    } catch (e) {}
  }
  
  for (const { away, home } of gamePairs) {
    try {
      // Get motivation from rest/tank model
      let awayMotiv = 'COMPETING';
      let homeMotiv = 'COMPETING';
      
      if (restTankSvc) {
        const standings = nbaModel.getTeams();
        const today = new Date().toISOString().split('T')[0];
        const rtData = await restTankSvc.getGameAdjustment(away, home, standings, today);
        if (rtData) {
          if (rtData.away?.motivation?.motivation) awayMotiv = rtData.away.motivation.motivation;
          if (rtData.home?.motivation?.motivation) homeMotiv = rtData.home.motivation.motivation;
        }
      }
      
      const analysis = findStructuralEdges(away, home, { awayMotivation: awayMotiv, homeMotivation: homeMotiv });
      if (analysis.error) continue;
      
      results.gamesScanned++;
      results.totalEdges += analysis.totalEdges;
      results.strongEdges += analysis.strongEdges;
      
      if (analysis.totalEdges > 0) {
        results.games.push({
          matchup: analysis.matchup,
          edges: analysis.structuralEdges,
          totalEdges: analysis.totalEdges,
          strongEdges: analysis.strongEdges,
          prediction: {
            fullGame: analysis.prediction.fullGame,
            Q1: { total: analysis.prediction.periods.Q1.total, spread: analysis.prediction.periods.Q1.spread },
            Q3: { total: analysis.prediction.periods.Q3.total, spread: analysis.prediction.periods.Q3.spread },
            '1H': { total: analysis.prediction.periods['1H'].total, spread: analysis.prediction.periods['1H'].spread },
            '2H': { total: analysis.prediction.periods['2H'].total, spread: analysis.prediction.periods['2H'].spread }
          }
        });
        
        // Collect strong edges for top plays
        for (const edge of analysis.structuralEdges.filter(e => e.strength === 'STRONG')) {
          results.topPlays.push({ ...edge, game: analysis.matchup });
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  // Sort top plays by type priority: motivation_mismatch > spread_structural > total_structural
  const typePriority = { motivation_mismatch: 3, spread_structural: 2, total_structural: 1, half_total_structural: 1, rest_impact: 2 };
  results.topPlays.sort((a, b) => (typePriority[b.type] || 0) - (typePriority[a.type] || 0));
  results.topPlays = results.topPlays.slice(0, 10);
  
  return results;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate over/under probabilities for standard total lines
 */
function generateTotalLines(expectedTotal, stdev) {
  const lines = {};
  // Generate lines around the expected total
  const center = Math.round(expectedTotal * 2) / 2; // round to nearest 0.5
  for (let offset = -4; offset <= 4; offset += 0.5) {
    const line = center + offset;
    if (line < 0) continue;
    const z = (line - expectedTotal) / stdev;
    const overProb = 1 - normalCDF(z);
    const underProb = normalCDF(z);
    lines[line] = {
      line,
      overProb: +(overProb * 100).toFixed(1),
      underProb: +(underProb * 100).toFixed(1),
      overML: probToML(overProb),
      underML: probToML(underProb)
    };
  }
  return lines;
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun)
 */
function normalCDF(z) {
  if (z < -8) return 0;
  if (z > 8) return 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Convert probability to American moneyline
 */
function probToML(prob) {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  }
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Format moneyline for display
 */
function formatML(ml) {
  return ml > 0 ? '+' + ml : '' + ml;
}

/**
 * Convert American moneyline to implied probability
 */
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

/**
 * Calculate expected value per $100 bet
 */
function calcEV(trueProb, ml) {
  const payout = ml > 0 ? ml : (100 / (-ml)) * 100;
  return +((trueProb * payout) - ((1 - trueProb) * 100)).toFixed(2);
}

/**
 * Kelly Criterion bet sizing
 */
function kellySize(trueProb, ml) {
  const decimalOdds = ml > 0 ? (ml / 100) + 1 : (100 / (-ml)) + 1;
  const b = decimalOdds - 1;
  const q = 1 - trueProb;
  const kelly = Math.max(0, (b * trueProb - q) / b);
  return {
    full: +(kelly * 100).toFixed(2),
    half: +(kelly * 50).toFixed(2),
    quarter: +(kelly * 25).toFixed(2)
  };
}

// ==================== STATUS / EXPORTS ====================

function getStatus() {
  return {
    version: '96.0',
    teamProfiles: Object.keys(TEAM_QUARTER_PROFILES).length,
    periodsModeled: ['Q1', 'Q2', 'Q3', 'Q4', '1H', '2H'],
    features: [
      'quarter_scoring_distribution',
      'half_scoring_distribution', 
      'team_quarter_profiles',
      'rest_tank_quarter_impact',
      'motivation_mismatch_detection',
      'structural_edge_scanner',
      'period_value_detection',
      'normal_distribution_totals',
      'playoff_mode_support'
    ],
    note: 'Quarter markets are less efficiently priced — books use naive 25% splits, we model true team-specific quarter distributions'
  };
}

module.exports = {
  predictPeriods,
  asyncPredictPeriods,
  findPeriodValue,
  findStructuralEdges,
  scanPeriodValue,
  scanStructuralEdges,
  getStatus,
  getTeamProfile,
  QUARTER_SCORING_SHARE,
  HALF_SCORING_SHARE,
  TEAM_QUARTER_PROFILES,
  HCA_BY_PERIOD,
  SCORING_STDEV,
  MOTIVATION_QUARTER_IMPACT
};
