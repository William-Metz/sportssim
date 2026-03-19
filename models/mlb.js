// models/mlb.js — MLB Baseball Model
// Pythagorean win expectation, pitcher adjustments, park factors, value detection

const PYTH_EXP = 1.83; // Baseball Pythagorean exponent

// All 30 MLB teams — 2025 projected stats
const TEAMS = {
  // AL East
  'NYY': { name: 'New York Yankees', league: 'AL', division: 'East', w: 95, l: 67, rsG: 5.1, raG: 3.8, ops: .763, era: 3.65, whip: 1.22, k9: 9.2, fip: 3.70, bullpenEra: 3.45, babip: .295, park: 'Yankee Stadium', l10: '7-3' },
  'BAL': { name: 'Baltimore Orioles', league: 'AL', division: 'East', w: 91, l: 71, rsG: 4.8, raG: 3.9, ops: .745, era: 3.78, whip: 1.24, k9: 8.9, fip: 3.82, bullpenEra: 3.55, babip: .290, park: 'Camden Yards', l10: '6-4' },
  'BOS': { name: 'Boston Red Sox', league: 'AL', division: 'East', w: 85, l: 77, rsG: 4.7, raG: 4.2, ops: .740, era: 4.05, whip: 1.28, k9: 8.5, fip: 4.00, bullpenEra: 3.80, babip: .298, park: 'Fenway Park', l10: '5-5' },
  'TOR': { name: 'Toronto Blue Jays', league: 'AL', division: 'East', w: 79, l: 83, rsG: 4.3, raG: 4.3, ops: .720, era: 4.15, whip: 1.30, k9: 8.4, fip: 4.10, bullpenEra: 3.90, babip: .292, park: 'Rogers Centre', l10: '4-6' },
  'TB':  { name: 'Tampa Bay Rays', league: 'AL', division: 'East', w: 76, l: 86, rsG: 4.1, raG: 4.4, ops: .710, era: 4.20, whip: 1.29, k9: 9.0, fip: 4.05, bullpenEra: 3.70, babip: .288, park: 'Tropicana Field', l10: '4-6' },
  // AL Central
  'CLE': { name: 'Cleveland Guardians', league: 'AL', division: 'Central', w: 92, l: 70, rsG: 4.5, raG: 3.7, ops: .730, era: 3.55, whip: 1.20, k9: 8.8, fip: 3.60, bullpenEra: 3.30, babip: .285, park: 'Progressive Field', l10: '6-4' },
  'KC':  { name: 'Kansas City Royals', league: 'AL', division: 'Central', w: 86, l: 76, rsG: 4.6, raG: 4.1, ops: .735, era: 3.95, whip: 1.27, k9: 8.3, fip: 3.90, bullpenEra: 3.65, babip: .293, park: 'Kauffman Stadium', l10: '5-5' },
  'DET': { name: 'Detroit Tigers', league: 'AL', division: 'Central', w: 82, l: 80, rsG: 4.2, raG: 4.1, ops: .715, era: 3.95, whip: 1.26, k9: 8.6, fip: 3.88, bullpenEra: 3.75, babip: .290, park: 'Comerica Park', l10: '5-5' },
  'MIN': { name: 'Minnesota Twins', league: 'AL', division: 'Central', w: 80, l: 82, rsG: 4.5, raG: 4.4, ops: .732, era: 4.22, whip: 1.31, k9: 8.4, fip: 4.15, bullpenEra: 3.85, babip: .294, park: 'Target Field', l10: '4-6' },
  'CWS': { name: 'Chicago White Sox', league: 'AL', division: 'Central', w: 58, l: 104, rsG: 3.6, raG: 5.2, ops: .680, era: 5.00, whip: 1.42, k9: 7.8, fip: 4.85, bullpenEra: 4.50, babip: .300, park: 'Guaranteed Rate Field', l10: '2-8' },

  // AL West
  'HOU': { name: 'Houston Astros', league: 'AL', division: 'West', w: 90, l: 72, rsG: 4.9, raG: 3.9, ops: .755, era: 3.75, whip: 1.23, k9: 9.1, fip: 3.72, bullpenEra: 3.50, babip: .292, park: 'Minute Maid Park', l10: '6-4' },
  'SEA': { name: 'Seattle Mariners', league: 'AL', division: 'West', w: 85, l: 77, rsG: 4.2, raG: 3.8, ops: .718, era: 3.68, whip: 1.22, k9: 9.3, fip: 3.62, bullpenEra: 3.40, babip: .286, park: 'T-Mobile Park', l10: '5-5' },
  'TEX': { name: 'Texas Rangers', league: 'AL', division: 'West', w: 82, l: 80, rsG: 4.7, raG: 4.3, ops: .742, era: 4.12, whip: 1.29, k9: 8.7, fip: 4.05, bullpenEra: 3.80, babip: .296, park: 'Globe Life Field', l10: '5-5' },
  'LAA': { name: 'Los Angeles Angels', league: 'AL', division: 'West', w: 73, l: 89, rsG: 4.3, raG: 4.7, ops: .722, era: 4.45, whip: 1.33, k9: 8.2, fip: 4.35, bullpenEra: 4.10, babip: .295, park: 'Angel Stadium', l10: '3-7' },
  'OAK': { name: 'Oakland Athletics', league: 'AL', division: 'West', w: 65, l: 97, rsG: 3.8, raG: 5.0, ops: .695, era: 4.80, whip: 1.38, k9: 8.0, fip: 4.65, bullpenEra: 4.35, babip: .298, park: 'Coliseum', l10: '3-7' },

  // NL East
  'ATL': { name: 'Atlanta Braves', league: 'NL', division: 'East', w: 93, l: 69, rsG: 5.0, raG: 3.8, ops: .758, era: 3.62, whip: 1.21, k9: 9.0, fip: 3.58, bullpenEra: 3.40, babip: .291, park: 'Truist Park', l10: '7-3' },
  'PHI': { name: 'Philadelphia Phillies', league: 'NL', division: 'East', w: 92, l: 70, rsG: 4.9, raG: 3.9, ops: .752, era: 3.72, whip: 1.23, k9: 9.1, fip: 3.68, bullpenEra: 3.50, babip: .293, park: 'Citizens Bank Park', l10: '6-4' },
  'NYM': { name: 'New York Mets', league: 'NL', division: 'East', w: 88, l: 74, rsG: 4.7, raG: 4.0, ops: .742, era: 3.85, whip: 1.25, k9: 8.8, fip: 3.80, bullpenEra: 3.55, babip: .290, park: 'Citi Field', l10: '6-4' },
  'MIA': { name: 'Miami Marlins', league: 'NL', division: 'East', w: 65, l: 97, rsG: 3.7, raG: 4.8, ops: .688, era: 4.62, whip: 1.36, k9: 8.1, fip: 4.50, bullpenEra: 4.20, babip: .296, park: 'LoanDepot Park', l10: '3-7' },
  'WSH': { name: 'Washington Nationals', league: 'NL', division: 'East', w: 71, l: 91, rsG: 4.0, raG: 4.7, ops: .708, era: 4.48, whip: 1.34, k9: 8.2, fip: 4.40, bullpenEra: 4.15, babip: .294, park: 'Nationals Park', l10: '3-7' },

  // NL Central
  'MIL': { name: 'Milwaukee Brewers', league: 'NL', division: 'Central', w: 91, l: 71, rsG: 4.6, raG: 3.8, ops: .738, era: 3.65, whip: 1.22, k9: 9.0, fip: 3.62, bullpenEra: 3.35, babip: .288, park: 'American Family Field', l10: '6-4' },
  'CHC': { name: 'Chicago Cubs', league: 'NL', division: 'Central', w: 83, l: 79, rsG: 4.5, raG: 4.2, ops: .732, era: 4.02, whip: 1.27, k9: 8.6, fip: 3.95, bullpenEra: 3.70, babip: .292, park: 'Wrigley Field', l10: '5-5' },
  'STL': { name: 'St. Louis Cardinals', league: 'NL', division: 'Central', w: 78, l: 84, rsG: 4.2, raG: 4.3, ops: .720, era: 4.12, whip: 1.28, k9: 8.5, fip: 4.05, bullpenEra: 3.80, babip: .291, park: 'Busch Stadium', l10: '4-6' },
  'PIT': { name: 'Pittsburgh Pirates', league: 'NL', division: 'Central', w: 75, l: 87, rsG: 4.0, raG: 4.4, ops: .710, era: 4.22, whip: 1.30, k9: 8.3, fip: 4.15, bullpenEra: 3.90, babip: .293, park: 'PNC Park', l10: '4-6' },
  'CIN': { name: 'Cincinnati Reds', league: 'NL', division: 'Central', w: 77, l: 85, rsG: 4.4, raG: 4.5, ops: .728, era: 4.30, whip: 1.31, k9: 8.7, fip: 4.20, bullpenEra: 4.00, babip: .297, park: 'Great American Ball Park', l10: '4-6' },

  // NL West
  'LAD': { name: 'Los Angeles Dodgers', league: 'NL', division: 'West', w: 98, l: 64, rsG: 5.3, raG: 3.6, ops: .775, era: 3.42, whip: 1.18, k9: 9.5, fip: 3.38, bullpenEra: 3.20, babip: .290, park: 'Dodger Stadium', l10: '8-2' },
  'SD':  { name: 'San Diego Padres', league: 'NL', division: 'West', w: 88, l: 74, rsG: 4.7, raG: 3.9, ops: .745, era: 3.75, whip: 1.23, k9: 9.2, fip: 3.70, bullpenEra: 3.45, babip: .289, park: 'Petco Park', l10: '6-4' },
  'ARI': { name: 'Arizona Diamondbacks', league: 'NL', division: 'West', w: 85, l: 77, rsG: 4.8, raG: 4.2, ops: .748, era: 4.02, whip: 1.27, k9: 8.8, fip: 3.95, bullpenEra: 3.65, babip: .295, park: 'Chase Field', l10: '5-5' },
  'SF':  { name: 'San Francisco Giants', league: 'NL', division: 'West', w: 78, l: 84, rsG: 4.2, raG: 4.3, ops: .718, era: 4.10, whip: 1.28, k9: 8.5, fip: 4.02, bullpenEra: 3.75, babip: .287, park: 'Oracle Park', l10: '4-6' },
  'COL': { name: 'Colorado Rockies', league: 'NL', division: 'West', w: 62, l: 100, rsG: 4.5, raG: 5.5, ops: .725, era: 5.25, whip: 1.45, k9: 7.5, fip: 5.10, bullpenEra: 4.60, babip: .310, park: 'Coors Field', l10: '2-8' }
};

// Park factors — multiplier for runs scored (1.0 = neutral)
const PARK_FACTORS = {
  'Coors Field': 1.25, 'Great American Ball Park': 1.12, 'Fenway Park': 1.08,
  'Globe Life Field': 1.06, 'Citizens Bank Park': 1.05, 'Yankee Stadium': 1.05,
  'Wrigley Field': 1.04, 'Chase Field': 1.04, 'Camden Yards': 1.03,
  'Minute Maid Park': 1.02, 'Rogers Centre': 1.02, 'American Family Field': 1.01,
  'Guaranteed Rate Field': 1.01, 'Angel Stadium': 1.00, 'Target Field': 1.00,
  'Busch Stadium': 1.00, 'Nationals Park': 0.99, 'Kauffman Stadium': 0.99,
  'PNC Park': 0.98, 'Truist Park': 0.98, 'Comerica Park': 0.97,
  'Progressive Field': 0.97, 'Dodger Stadium': 0.97, 'Citi Field': 0.96,
  'LoanDepot Park': 0.95, 'T-Mobile Park': 0.95, 'Petco Park': 0.94,
  'Tropicana Field': 0.94, 'Oracle Park': 0.93, 'Coliseum': 0.96
};

// League average baselines
const LG_AVG = { rsG: 4.4, raG: 4.4, era: 4.10, whip: 1.28, k9: 8.6, fip: 4.05 };
const HOME_ADV = 0.540; // 54% historical home win rate in MLB

// ==================== CORE MODEL ====================

function pythWinPct(rsG, raG) {
  const rs = Math.pow(rsG, PYTH_EXP);
  const ra = Math.pow(raG, PYTH_EXP);
  return rs / (rs + ra);
}

function calculateRatings() {
  const ratings = {};
  for (const [abbr, t] of Object.entries(TEAMS)) {
    const actualWpct = t.w / (t.w + t.l);
    const pythWpct = pythWinPct(t.rsG, t.raG);
    const luck = actualWpct - pythWpct;
    const runDiff = t.rsG - t.raG;
    
    // Power rating: run differential adjusted for luck and park
    const parkFactor = PARK_FACTORS[t.park] || 1.0;
    const neutralRsG = t.rsG / parkFactor;
    const neutralRaG = t.raG / (2 - parkFactor); // inverse adjustment
    const neutralRunDiff = neutralRsG - neutralRaG;
    
    // Pitching quality score (lower ERA/FIP = better)
    const pitchScore = (LG_AVG.era - t.era) * 0.4 + (LG_AVG.fip - t.fip) * 0.35 + 
                       (LG_AVG.whip - t.whip) * 5 * 0.15 + (t.k9 - LG_AVG.k9) * 0.1;
    
    // Offense quality score
    const offScore = (t.rsG - LG_AVG.rsG) * 0.5 + (t.ops - 0.730) * 10 * 0.5;
    
    // Bullpen factor
    const bullpenScore = (LG_AVG.era - t.bullpenEra) * 0.5;
    
    // Composite power rating
    const power = neutralRunDiff * 10 + pitchScore * 3 + offScore * 2 + bullpenScore * 2 - luck * 8;
    
    // L10 momentum
    const l10parts = t.l10.split('-');
    const l10wpct = parseInt(l10parts[0]) / 10;
    const momentum = l10wpct - 0.5;
    
    ratings[abbr] = {
      abbr, name: t.name, league: t.league, division: t.division,
      w: t.w, l: t.l, actualWpct: +(actualWpct.toFixed(3)),
      pythWpct: +(pythWpct.toFixed(3)), luck: +(luck.toFixed(3)),
      rsG: t.rsG, raG: t.raG, runDiff: +(runDiff.toFixed(1)),
      era: t.era, fip: t.fip, whip: t.whip, k9: t.k9,
      ops: t.ops, bullpenEra: t.bullpenEra,
      park: t.park, parkFactor: PARK_FACTORS[t.park] || 1.0,
      pitchScore: +(pitchScore.toFixed(2)), offScore: +(offScore.toFixed(2)),
      bullpenScore: +(bullpenScore.toFixed(2)),
      power: +(power.toFixed(1)), momentum: +(momentum.toFixed(2)),
      l10: t.l10
    };
  }
  return ratings;
}

// ==================== PITCHER ADJUSTMENT ====================

// Starting pitcher modifies the team's expected runs allowed
// pitcherERA replaces team ERA partially; pitcherFIP for predictive
function pitcherAdjustment(teamRaG, pitcherEra, pitcherFip, pitcherWhip) {
  if (!pitcherEra && !pitcherFip) return teamRaG;
  
  const pEra = pitcherEra || pitcherFip || LG_AVG.era;
  const pFip = pitcherFip || pitcherEra || LG_AVG.fip;
  
  // Pitcher handles ~6 innings out of 9, bullpen handles rest
  // Weight: 60% pitcher impact, 40% team baseline (bullpen + late game)
  const pitcherRaG = (pEra * 0.4 + pFip * 0.6) / 9 * 6; // pitcher's portion
  const teamPortion = teamRaG / 9 * 3; // bullpen portion
  const adjustedRaG = pitcherRaG + teamPortion;
  
  return adjustedRaG;
}

// ==================== GAME PREDICTION ====================

function predict(awayAbbr, homeAbbr, opts = {}) {
  const away = TEAMS[awayAbbr];
  const home = TEAMS[homeAbbr];
  if (!away) return { error: `Unknown team: ${awayAbbr}` };
  if (!home) return { error: `Unknown team: ${homeAbbr}` };
  
  const ratings = calculateRatings();
  const awayR = ratings[awayAbbr];
  const homeR = ratings[homeAbbr];
  
  // Park factor (home team's park)
  const pf = PARK_FACTORS[home.park] || 1.0;
  
  // Pitcher adjustments
  let awayRaG = away.raG, homeRaG = home.raG;
  if (opts.awayPitcherEra || opts.awayPitcherFip) {
    awayRaG = pitcherAdjustment(away.raG, opts.awayPitcherEra, opts.awayPitcherFip, opts.awayPitcherWhip);
  }
  if (opts.homePitcherEra || opts.homePitcherFip) {
    homeRaG = pitcherAdjustment(home.raG, opts.homePitcherEra, opts.homePitcherFip, opts.homePitcherWhip);
  }
  
  // Expected runs: team's offense vs opponent's pitching, adjusted for park
  // Away team expected runs = away.rsG * (homeRaG / LG_AVG.raG) * pf
  // Home team expected runs = home.rsG * (awayRaG / LG_AVG.raG) * pf
  const awayExpRuns = away.rsG * (homeRaG / LG_AVG.raG) * pf;
  const homeExpRuns = home.rsG * (awayRaG / LG_AVG.raG) * pf;
  
  // F5 (first 5 innings) — roughly 55-58% of total runs
  const f5Factor = 0.565;
  const awayExpF5 = awayExpRuns * f5Factor;
  const homeExpF5 = homeExpRuns * f5Factor;
  
  // Win probability using log5 method
  const awayTrue = pythWinPct(away.rsG, awayRaG);
  const homeTrue = pythWinPct(home.rsG, homeRaG);
  
  // Log5: P(A beats B) = (pA - pA*pB) / (pA + pB - 2*pA*pB)
  let awayWinProb = (awayTrue - awayTrue * homeTrue) / (awayTrue + homeTrue - 2 * awayTrue * homeTrue);
  
  // Home advantage adjustment
  awayWinProb = awayWinProb * (1 - HOME_ADV) / (awayWinProb * (1 - HOME_ADV) + (1 - awayWinProb) * HOME_ADV);
  let homeWinProb = 1 - awayWinProb;
  
  // Momentum nudge (small)
  const momAdj = (homeR.momentum - awayR.momentum) * 0.02;
  homeWinProb = Math.min(0.95, Math.max(0.05, homeWinProb + momAdj));
  awayWinProb = 1 - homeWinProb;
  
  // Total runs
  const totalRuns = awayExpRuns + homeExpRuns;
  
  // Run line probability (home -1.5 / away +1.5)
  // Use normal approximation: mean = homeExpRuns - awayExpRuns, std ~= 3.8 runs
  const runDiffMean = homeExpRuns - awayExpRuns;
  const runDiffStd = 3.8;
  const homeRL = normalCDF(runDiffMean - 1.5, runDiffStd); // P(home wins by 2+)
  const awayRL = 1 - normalCDF(runDiffMean + 1.5, runDiffStd); // P(away wins by 2+)
  
  // Moneyline conversion
  const homeML = probToML(homeWinProb);
  const awayML = probToML(awayWinProb);
  
  return {
    away: awayAbbr, home: homeAbbr,
    awayName: away.name, homeName: home.name,
    homeWinProb: +(homeWinProb.toFixed(3)),
    awayWinProb: +(awayWinProb.toFixed(3)),
    homeML, awayML,
    homeExpRuns: +(homeExpRuns.toFixed(1)),
    awayExpRuns: +(awayExpRuns.toFixed(1)),
    totalRuns: +(totalRuns.toFixed(1)),
    f5Total: +((awayExpF5 + homeExpF5).toFixed(1)),
    runDiff: +(runDiffMean.toFixed(1)),
    homeRunLine: { spread: -1.5, prob: +(homeRL.toFixed(3)) },
    awayRunLine: { spread: 1.5, prob: +(awayRL.toFixed(3)) },
    parkFactor: pf,
    awayPower: awayR.power,
    homePower: homeR.power,
    factors: {
      awayPythWpct: awayR.pythWpct,
      homePythWpct: homeR.pythWpct,
      awayLuck: awayR.luck,
      homeLuck: homeR.luck,
      parkEffect: pf,
      homeAdv: HOME_ADV
    }
  };
}

// ==================== VALUE DETECTION ====================

function findValue(prediction, bookLine) {
  const edges = [];
  const minEdge = 0.02; // 2% minimum edge
  
  // Moneyline value
  if (bookLine.homeML) {
    const bookHomeProb = mlToProb(bookLine.homeML);
    const homeEdge = prediction.homeWinProb - bookHomeProb;
    if (homeEdge > minEdge) {
      const kelly = kellySize(prediction.homeWinProb, bookLine.homeML);
      edges.push({
        pick: `${prediction.home} ML`, side: 'home', market: 'moneyline',
        modelProb: prediction.homeWinProb, bookProb: +bookHomeProb.toFixed(3),
        edge: +(homeEdge.toFixed(3)), ml: bookLine.homeML,
        ev: +(evPer100(prediction.homeWinProb, bookLine.homeML).toFixed(1)),
        kelly: { full: +(kelly.toFixed(3)), half: +(kelly/2).toFixed(3) }
      });
    }
  }
  if (bookLine.awayML) {
    const bookAwayProb = mlToProb(bookLine.awayML);
    const awayEdge = prediction.awayWinProb - bookAwayProb;
    if (awayEdge > minEdge) {
      const kelly = kellySize(prediction.awayWinProb, bookLine.awayML);
      edges.push({
        pick: `${prediction.away} ML`, side: 'away', market: 'moneyline',
        modelProb: prediction.awayWinProb, bookProb: +bookAwayProb.toFixed(3),
        edge: +(awayEdge.toFixed(3)), ml: bookLine.awayML,
        ev: +(evPer100(prediction.awayWinProb, bookLine.awayML).toFixed(1)),
        kelly: { full: +(kelly.toFixed(3)), half: +(kelly/2).toFixed(3) }
      });
    }
  }
  
  // Total value
  if (bookLine.total && prediction.totalRuns) {
    const diff = prediction.totalRuns - bookLine.total;
    if (Math.abs(diff) > 0.5) {
      const side = diff > 0 ? 'Over' : 'Under';
      edges.push({
        pick: `${side} ${bookLine.total}`, side: side.toLowerCase(), market: 'total',
        modelTotal: prediction.totalRuns, bookTotal: bookLine.total,
        edge: +(Math.abs(diff).toFixed(1)), diff: +(diff.toFixed(1))
      });
    }
  }
  
  return edges;
}

// ==================== MATH HELPERS ====================

function normalCDF(x, std) {
  // Approximate normal CDF for (x - 0) / std
  const z = x / std;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function probToML(prob) {
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

function kellySize(modelProb, ml) {
  const b = ml > 0 ? ml / 100 : 100 / (-ml);
  const q = 1 - modelProb;
  const kelly = (b * modelProb - q) / b;
  return Math.max(0, kelly);
}

module.exports = { TEAMS, PARK_FACTORS, calculateRatings, predict, findValue, pythWinPct };
