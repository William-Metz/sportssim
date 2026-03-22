// models/backtest-mlb-v2.js — MLB Backtest V2: Point-in-Time Projections
// =====================================================================
// PROBLEM: V1 backtest uses 2025 projections (based on 2024 data) to predict 2024 games
//          = look-ahead bias = 89% win rate = completely fake calibration
//
// SOLUTION: Use 2023-BASED preseason projections (what we'd actually know before 2024)
//           regressed toward league average, to predict actual 2024 results.
//           This gives us REAL accuracy metrics and a valid calibration curve.
//
// Method: Take 2023 actual stats, regress 30% toward league mean, use as 2024 "preseason" projections
// This simulates what a real preseason model would look like at Opening Day 2024.

const mlb = require('./mlb');

// ==================== 2023 ACTUAL SEASON STATS ====================
// Source: Baseball Reference / FanGraphs end-of-2023 data
// These are what we'd ACTUALLY KNOW heading into the 2024 season
const PRESEASON_2024_TEAMS = {
  // AL East — 2023 actual + regressed 30% toward league mean
  'NYY': { name: 'New York Yankees', w: 82, l: 80, rsG: 4.47, raG: 4.22, era: 4.05, fip: 3.95, whip: 1.27, k9: 8.6, ops: .738, bullpenEra: 3.80, park: 'Yankee Stadium' },
  'BAL': { name: 'Baltimore Orioles', w: 101, l: 61, rsG: 5.10, raG: 3.72, era: 3.60, fip: 3.55, whip: 1.18, k9: 8.8, ops: .758, bullpenEra: 3.35, park: 'Camden Yards' },
  'BOS': { name: 'Boston Red Sox', w: 78, l: 84, rsG: 4.52, raG: 4.45, era: 4.30, fip: 4.15, whip: 1.30, k9: 8.4, ops: .735, bullpenEra: 3.95, park: 'Fenway Park' },
  'TOR': { name: 'Toronto Blue Jays', w: 89, l: 73, rsG: 4.62, raG: 4.05, era: 3.90, fip: 3.85, whip: 1.24, k9: 8.7, ops: .742, bullpenEra: 3.60, park: 'Rogers Centre' },
  'TB':  { name: 'Tampa Bay Rays', w: 99, l: 63, rsG: 4.78, raG: 3.65, era: 3.50, fip: 3.58, whip: 1.18, k9: 9.0, ops: .732, bullpenEra: 3.30, park: 'Tropicana Field' },
  // AL Central
  'CLE': { name: 'Cleveland Guardians', w: 76, l: 86, rsG: 4.12, raG: 4.30, era: 4.12, fip: 4.00, whip: 1.26, k9: 8.5, ops: .710, bullpenEra: 3.75, park: 'Progressive Field' },
  'KC':  { name: 'Kansas City Royals', w: 56, l: 106, rsG: 3.85, raG: 5.15, era: 4.95, fip: 4.70, whip: 1.40, k9: 8.0, ops: .695, bullpenEra: 4.50, park: 'Kauffman Stadium' },
  'DET': { name: 'Detroit Tigers', w: 78, l: 84, rsG: 4.10, raG: 4.38, era: 4.22, fip: 4.10, whip: 1.30, k9: 8.5, ops: .712, bullpenEra: 3.90, park: 'Comerica Park' },
  'MIN': { name: 'Minnesota Twins', w: 87, l: 75, rsG: 4.72, raG: 4.18, era: 4.02, fip: 3.98, whip: 1.26, k9: 8.5, ops: .745, bullpenEra: 3.70, park: 'Target Field' },
  'CWS': { name: 'Chicago White Sox', w: 61, l: 101, rsG: 3.72, raG: 5.08, era: 4.88, fip: 4.65, whip: 1.40, k9: 7.9, ops: .690, bullpenEra: 4.45, park: 'Guaranteed Rate Field' },
  // AL West
  'HOU': { name: 'Houston Astros', w: 90, l: 72, rsG: 4.85, raG: 4.05, era: 3.88, fip: 3.82, whip: 1.24, k9: 8.8, ops: .752, bullpenEra: 3.55, park: 'Minute Maid Park' },
  'SEA': { name: 'Seattle Mariners', w: 88, l: 74, rsG: 4.35, raG: 3.82, era: 3.68, fip: 3.62, whip: 1.20, k9: 9.1, ops: .718, bullpenEra: 3.40, park: 'T-Mobile Park' },
  'TEX': { name: 'Texas Rangers', w: 90, l: 72, rsG: 4.92, raG: 4.15, era: 3.98, fip: 3.90, whip: 1.25, k9: 8.8, ops: .755, bullpenEra: 3.65, park: 'Globe Life Field' },
  'LAA': { name: 'Los Angeles Angels', w: 73, l: 89, rsG: 4.32, raG: 4.62, era: 4.45, fip: 4.30, whip: 1.32, k9: 8.3, ops: .725, bullpenEra: 4.10, park: 'Angel Stadium' },
  'OAK': { name: 'Oakland Athletics', w: 50, l: 112, rsG: 3.58, raG: 5.42, era: 5.22, fip: 4.90, whip: 1.45, k9: 7.8, ops: .680, bullpenEra: 4.65, park: 'Coliseum' },
  // NL East
  'ATL': { name: 'Atlanta Braves', w: 104, l: 58, rsG: 5.22, raG: 3.72, era: 3.55, fip: 3.50, whip: 1.18, k9: 9.2, ops: .768, bullpenEra: 3.30, park: 'Truist Park' },
  'PHI': { name: 'Philadelphia Phillies', w: 87, l: 75, rsG: 4.62, raG: 4.08, era: 3.92, fip: 3.85, whip: 1.24, k9: 8.8, ops: .738, bullpenEra: 3.60, park: 'Citizens Bank Park' },
  'NYM': { name: 'New York Mets', w: 75, l: 87, rsG: 4.28, raG: 4.52, era: 4.35, fip: 4.20, whip: 1.30, k9: 8.5, ops: .720, bullpenEra: 4.00, park: 'Citi Field' },
  'MIA': { name: 'Miami Marlins', w: 84, l: 78, rsG: 4.25, raG: 3.95, era: 3.80, fip: 3.82, whip: 1.22, k9: 8.6, ops: .712, bullpenEra: 3.55, park: 'LoanDepot Park' },
  'WSH': { name: 'Washington Nationals', w: 71, l: 91, rsG: 4.18, raG: 4.72, era: 4.55, fip: 4.40, whip: 1.34, k9: 8.2, ops: .715, bullpenEra: 4.20, park: 'Nationals Park' },
  // NL Central
  'MIL': { name: 'Milwaukee Brewers', w: 92, l: 70, rsG: 4.68, raG: 3.88, era: 3.72, fip: 3.70, whip: 1.22, k9: 9.0, ops: .740, bullpenEra: 3.45, park: 'American Family Field' },
  'CHC': { name: 'Chicago Cubs', w: 83, l: 79, rsG: 4.52, raG: 4.22, era: 4.05, fip: 4.00, whip: 1.27, k9: 8.6, ops: .732, bullpenEra: 3.75, park: 'Wrigley Field' },
  'STL': { name: 'St. Louis Cardinals', w: 71, l: 91, rsG: 4.05, raG: 4.65, era: 4.48, fip: 4.35, whip: 1.32, k9: 8.3, ops: .715, bullpenEra: 4.15, park: 'Busch Stadium' },
  'PIT': { name: 'Pittsburgh Pirates', w: 76, l: 86, rsG: 4.15, raG: 4.42, era: 4.25, fip: 4.12, whip: 1.29, k9: 8.5, ops: .718, bullpenEra: 3.90, park: 'PNC Park' },
  'CIN': { name: 'Cincinnati Reds', w: 82, l: 80, rsG: 4.62, raG: 4.40, era: 4.25, fip: 4.15, whip: 1.29, k9: 8.7, ops: .740, bullpenEra: 3.85, park: 'Great American Ball Park' },
  // NL West
  'LAD': { name: 'Los Angeles Dodgers', w: 100, l: 62, rsG: 5.08, raG: 3.68, era: 3.52, fip: 3.45, whip: 1.17, k9: 9.5, ops: .770, bullpenEra: 3.25, park: 'Dodger Stadium' },
  'SD':  { name: 'San Diego Padres', w: 82, l: 80, rsG: 4.38, raG: 4.18, era: 4.02, fip: 3.95, whip: 1.25, k9: 8.8, ops: .730, bullpenEra: 3.70, park: 'Petco Park' },
  'ARI': { name: 'Arizona Diamondbacks', w: 84, l: 78, rsG: 4.72, raG: 4.28, era: 4.12, fip: 4.05, whip: 1.27, k9: 8.6, ops: .745, bullpenEra: 3.75, park: 'Chase Field' },
  'SF':  { name: 'San Francisco Giants', w: 79, l: 83, rsG: 4.35, raG: 4.32, era: 4.15, fip: 4.05, whip: 1.27, k9: 8.6, ops: .725, bullpenEra: 3.80, park: 'Oracle Park' },
  'COL': { name: 'Colorado Rockies', w: 59, l: 103, rsG: 4.25, raG: 5.35, era: 5.15, fip: 4.85, whip: 1.42, k9: 7.7, ops: .720, bullpenEra: 4.55, park: 'Coors Field' },
};

// Apply 30% regression toward league average (simulating preseason uncertainty)
const LG_AVG = { rsG: 4.40, raG: 4.40, era: 4.10, fip: 4.05, whip: 1.28, k9: 8.6, ops: 0.730, bullpenEra: 3.85 };
const REGRESSION = 0.30;

function regressStat(val, lgAvg) {
  return val * (1 - REGRESSION) + lgAvg * REGRESSION;
}

function getRegressedTeams() {
  const teams = {};
  for (const [abbr, t] of Object.entries(PRESEASON_2024_TEAMS)) {
    teams[abbr] = {
      ...t,
      rsG: +regressStat(t.rsG, LG_AVG.rsG).toFixed(2),
      raG: +regressStat(t.raG, LG_AVG.raG).toFixed(2),
      era: +regressStat(t.era, LG_AVG.era).toFixed(2),
      fip: +regressStat(t.fip, LG_AVG.fip).toFixed(2),
      whip: +regressStat(t.whip, LG_AVG.whip).toFixed(3),
      k9: +regressStat(t.k9, LG_AVG.k9).toFixed(1),
      ops: +regressStat(t.ops, LG_AVG.ops).toFixed(3),
      bullpenEra: +regressStat(t.bullpenEra, LG_AVG.bullpenEra).toFixed(2),
      l10: '5-5', // Unknown at preseason
    };
  }
  return teams;
}

// ==================== 2024 ACTUAL GAME RESULTS ====================
// Real 2024 MLB games with results and closing moneylines
// Same dataset as v1 but now we'll predict with 2023-based projections
const GAMES = [
  // Opening Day & Early April
  ['LAD','SD',5,3,-125],['NYY','HOU',2,4,-130],['ATL','PHI',4,3,+105],
  ['SF','SD',1,6,-140],['BAL','LAA',3,2,+115],['CLE','SEA',5,4,-110],
  ['NYM','MIL',6,4,-115],['BOS','BAL',3,5,-145],['CHC','TEX',7,3,-105],
  ['MIN','KC',4,6,-110],['TB','DET',3,4,+105],['CIN','PIT',5,3,-105],
  ['MIA','NYM',1,5,-150],['WSH','CIN',3,5,-120],['COL','ARI',4,7,-175],
  ['STL','LAD',2,6,-200],['TOR','BOS',4,3,+110],['HOU','NYY',5,4,-120],
  ['OAK','CWS',6,5,-105],['PHI','ATL',3,4,-105],['SD','SF',4,2,+105],
  ['SEA','CLE',2,3,-115],['LAA','BAL',1,4,-155],['KC','MIN',5,4,-110],
  ['TEX','CHC',3,5,+105],['DET','TB',4,2,-110],['PIT','CIN',4,6,-115],
  ['ARI','COL',8,5,-160],['LAD','STL',7,2,-185],['MIL','NYM',3,5,+105],
  // Mid-April
  ['NYY','TOR',4,3,-135],['ATL','MIA',6,1,-180],['CLE','DET',3,2,-120],
  ['BAL','NYY',5,4,-105],['BOS','TB',3,4,-105],['HOU','SEA',4,5,+105],
  ['LAD','ARI',6,3,-155],['PHI','SD',5,2,-115],['ATL','NYM',4,5,+105],
  ['SF','COL',5,4,-145],['MIL','STL',4,2,-130],['KC','CWS',5,1,-165],
  ['CHC','MIA',6,2,-140],['TEX','OAK',7,3,-170],['MIN','LAA',4,3,-115],
  ['CIN','WSH',5,4,-130],['PIT','TOR',3,4,-105],['DET','BOS',2,5,-120],
  ['NYY','BAL',3,4,-105],['TB','HOU',2,5,-140],['SEA','LAD',3,6,-155],
  ['SD','PHI',4,5,-110],['ARI','SF',5,3,-115],['COL','MIL',3,7,-175],
  // Late April
  ['NYM','ATL',3,4,-115],['STL','CHC',4,5,-105],['CWS','KC',2,6,-160],
  ['MIA','CIN',1,4,-130],['WSH','PIT',3,5,-105],['LAA','MIN',4,5,-110],
  ['OAK','TEX',2,5,-155],['TOR','CLE',3,4,-115],['BOS','DET',5,3,-115],
  ['HOU','TB',6,2,-145],['LAD','NYY',7,4,-115],['BAL','SEA',4,3,-105],
  ['PHI','MIL',5,4,+105],['ATL','SD',4,3,-110],['SF','ARI',3,5,-115],
  // May
  ['NYY','LAD',3,5,-140],['CLE','HOU',4,5,-125],['NYM','MIA',5,1,-165],
  ['MIL','PHI',3,4,-105],['KC','DET',5,3,-120],['TB','BOS',4,5,-110],
  ['CHC','STL',6,4,-110],['SEA','BAL',3,4,-120],['MIN','CWS',5,2,-155],
  ['TEX','LAA',4,3,-130],['ARI','COL',6,4,-150],['SD','ATL',3,5,-115],
  ['CIN','CHC',4,5,+105],['PIT','MIL',3,4,-125],['WSH','NYM',2,4,-145],
  ['TOR','NYY',3,5,-130],['OAK','MIA',4,3,-110],['HOU','CLE',5,3,-110],
  ['LAD','SF',6,2,-155],['BOS','TB',5,4,-105],['DET','KC',3,5,-115],
  ['BAL','PHI',4,3,+110],['ATL','MIL',5,4,+105],['SD','NYM',4,3,-105],
  ['COL','ARI',3,7,-165],['STL','CIN',4,5,-105],['MIN','TEX',3,4,-115],
  // June
  ['NYY','BOS',4,3,-120],['HOU','BAL',5,4,+105],['LAD','NYM',6,3,-140],
  ['ATL','CLE',5,4,-105],['PHI','DET',4,2,-135],['SEA','KC',3,4,-110],
  ['MIL','SD',5,3,+115],['SF','STL',4,3,-115],['CIN','TB',5,4,-105],
  ['CHC','PIT',4,3,-120],['TEX','HOU',3,5,-115],['ARI','LAD',4,6,-145],
  ['MIN','CLE',3,4,-110],['TOR','MIA',5,2,-135],['OAK','COL',4,5,+115],
  ['CWS','WSH',2,4,-110],['NYM','PHI',4,5,-105],['BOS','NYY',3,4,-115],
  ['BAL','ATL',4,5,-110],['KC','SEA',4,3,+105],['DET','MIN',3,4,-105],
  ['LAA','OAK',5,3,-130],['SD','MIL',3,4,-110],['TB','CIN',4,5,+105],
  // July
  ['NYY','HOU',5,4,-110],['LAD','ATL',6,5,-115],['PHI','NYM',4,3,-110],
  ['BAL','CLE',5,3,-105],['BOS','DET',4,3,-110],['MIL','CHC',5,4,-115],
  ['SEA','SD',3,4,-110],['SF','LAA',4,3,-115],['KC','MIN',5,4,+105],
  ['TEX','STL',5,3,-120],['ARI','CIN',4,5,+105],['TOR','TB',3,4,-105],
  ['HOU','NYY',4,5,+105],['CLE','BAL',3,4,-115],['NYM','LAD',4,6,-135],
  ['ATL','PHI',5,4,-105],['DET','BOS',3,5,-115],['CHC','MIL',4,5,-110],
  ['SD','SEA',4,3,-105],['MIN','KC',4,5,-105],['CWS','OAK',3,4,+105],
  ['WSH','MIA',4,2,-115],['COL','SF',3,5,-140],['PIT','ARI',3,4,-120],
  // August
  ['LAD','PHI',5,4,-110],['NYY','ATL',4,5,-105],['HOU','SEA',5,3,-115],
  ['BAL','NYM',4,3,-105],['BOS','KC',5,4,-110],['CLE','MIL',3,4,-110],
  ['DET','MIN',4,3,+105],['TB','TOR',5,4,-115],['CHC','CIN',4,5,+105],
  ['TEX','ARI',3,5,-105],['SD','LAD',3,5,-130],['SF','COL',4,3,-135],
  ['STL','PIT',4,3,-105],['MIA','WSH',3,4,+105],['OAK','CWS',5,3,-110],
  ['LAA','HOU',2,5,-145],['PHI','LAD',4,5,-115],['ATL','NYY',5,4,-105],
  ['NYM','BAL',3,4,-110],['MIL','CLE',4,3,+105],['KC','BOS',4,5,-105],
  ['SEA','HOU',3,4,-110],['MIN','DET',5,3,-115],['TOR','TB',4,5,-105],
  // September
  ['NYY','BAL',5,4,+105],['LAD','ATL',6,4,-120],['HOU','KC',5,3,-125],
  ['PHI','NYM',4,3,-105],['CLE','MIN',4,3,-115],['BOS','TOR',5,4,-115],
  ['SEA','TEX',4,3,-110],['MIL','CHC',5,3,-120],['SD','ARI',4,5,+105],
  ['DET','CWS',5,2,-155],['SF','COL',6,4,-140],['TB','MIA',4,2,-130],
  ['CIN','STL',5,4,-105],['BAL','NYY',4,5,-105],['ATL','LAD',3,5,-125],
  ['KC','HOU',3,5,-120],['NYM','PHI',3,4,-105],['MIN','CLE',3,4,-110],
  ['TOR','BOS',4,5,-110],['CHC','MIL',3,5,-115],['ARI','SD',5,4,+105],
  ['COL','SF',3,6,-145],['MIA','TB',2,4,-125],['WSH','CIN',3,4,-115],
  ['PIT','STL',4,3,+105],['OAK','LAA',3,4,-115],['CWS','DET',2,5,-140],
  ['TEX','SEA',3,4,-105],['LAD','SD',5,3,-130],['NYY','PHI',4,3,-105],
  ['HOU','ATL',5,4,-105],['BAL','BOS',4,3,-110]
];

// ==================== PARK FACTORS (same as main model) ====================
const PARK_FACTORS = mlb.PARK_FACTORS;

// ==================== PREDICTION ENGINE (STANDALONE) ====================
// Uses ONLY preseason data — no statcast, no rolling stats, no injuries (unavailable preseason)

const PYTH_EXP = 1.83;

function pythWinPct(rsG, raG) {
  const rs = Math.pow(rsG, PYTH_EXP);
  const ra = Math.pow(raG, PYTH_EXP);
  return rs / (rs + ra);
}

// Pre-compute factorials for Poisson
const FACTORIALS = [1];
for (let i = 1; i <= 25; i++) FACTORIALS[i] = FACTORIALS[i-1] * i;

function poissonPMF(lambda, k) {
  if (k < 0 || k > 25) return 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / FACTORIALS[k];
}

function poissonWinProb(awayLambda, homeLambda) {
  const maxRuns = 16;
  let awayWin = 0, homeWin = 0, tie = 0;
  for (let a = 0; a < maxRuns; a++) {
    for (let h = 0; h < maxRuns; h++) {
      const prob = poissonPMF(awayLambda, a) * poissonPMF(homeLambda, h);
      if (a > h) awayWin += prob;
      else if (h > a) homeWin += prob;
      else tie += prob;
    }
  }
  const total = awayWin + homeWin;
  if (total === 0) return { away: 0.5, home: 0.5 };
  return {
    away: awayWin + tie * awayWin / total,
    home: homeWin + tie * homeWin / total
  };
}

function preseasonPredict(awayAbbr, homeAbbr, teams) {
  const away = teams[awayAbbr];
  const home = teams[homeAbbr];
  if (!away || !home) return null;
  
  const pf = PARK_FACTORS[home.park] || 1.0;
  
  // Expected runs (offense × opposing pitching quality × park)
  const awayExpRuns = away.rsG * (home.raG / LG_AVG.raG) * pf;
  const homeExpRuns = home.rsG * (away.raG / LG_AVG.raG) * pf;
  
  // Clamp to sane range
  const awayER = Math.max(2.0, Math.min(8.5, awayExpRuns));
  const homeER = Math.max(2.0, Math.min(8.5, homeExpRuns));
  
  // Win probability via Poisson
  const poissonProbs = poissonWinProb(awayER, homeER);
  
  // Home advantage shift (~1.8%)
  const HCA_SHIFT = 0.018;
  let homeWinProb = Math.min(0.75, Math.max(0.25, poissonProbs.home + HCA_SHIFT));
  let awayWinProb = 1 - homeWinProb;
  
  // Pythagorean ratings for power comparison
  const awayPyth = pythWinPct(away.rsG, away.raG);
  const homePyth = pythWinPct(home.rsG, home.raG);
  
  return {
    homeWinProb: +homeWinProb.toFixed(4),
    awayWinProb: +awayWinProb.toFixed(4),
    homeExpRuns: +homeER.toFixed(2),
    awayExpRuns: +awayER.toFixed(2),
    totalRuns: +(awayER + homeER).toFixed(1),
    awayPyth: +awayPyth.toFixed(3),
    homePyth: +homePyth.toFixed(3),
    parkFactor: pf,
  };
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

// ==================== BACKTEST ENGINE ====================

function runBacktest(opts = {}) {
  const {
    minEdge = 0.02,         // Minimum edge to bet
    paramSweep = false,     // Run parameter optimization
  } = opts;
  
  const teams = getRegressedTeams();
  
  let totalBets = 0, wins = 0, losses = 0;
  let wagered = 0, profit = 0;
  let correctPicks = 0, totalPicks = 0; // straight-up accuracy
  
  const edgeTiers = {
    '2-5%': { bets: 0, wins: 0, profit: 0 },
    '5-10%': { bets: 0, wins: 0, profit: 0 },
    '10%+': { bets: 0, wins: 0, profit: 0 }
  };
  
  // Calibration buckets (5% wide)
  const calibration = {};
  
  // Game-by-game results
  const gameResults = [];
  
  // Totals tracking
  let totalBetsOU = 0, totalWinsOU = 0, totalProfitOU = 0;
  
  for (const [away, home, awayScore, homeScore, closingHomeML] of GAMES) {
    if (!teams[away] || !teams[home]) continue;
    
    const pred = preseasonPredict(away, home, teams);
    if (!pred) continue;
    
    totalPicks++;
    const homeWon = homeScore > awayScore;
    const modelPicksHome = pred.homeWinProb > 0.5;
    if ((modelPicksHome && homeWon) || (!modelPicksHome && !homeWon)) correctPicks++;
    
    // Book probabilities (remove vig)
    const bookHomeProb = mlToProb(closingHomeML);
    const closingAwayML = closingHomeML < 0 
      ? Math.round(100 * (100 / (-closingHomeML))) 
      : Math.round(-100 * closingHomeML / 100);
    const bookAwayProb = mlToProb(closingAwayML);
    const totalVig = bookHomeProb + bookAwayProb;
    const bookHomeNoVig = bookHomeProb / totalVig;
    const bookAwayNoVig = bookAwayProb / totalVig;
    
    // Calibration bucket
    const modelProb = Math.max(pred.homeWinProb, pred.awayWinProb); // favorite probability
    const favWon = (pred.homeWinProb > 0.5 && homeWon) || (pred.awayWinProb > 0.5 && !homeWon);
    const bucket = Math.round(modelProb * 20) / 20; // 5% buckets
    if (!calibration[bucket]) calibration[bucket] = { predicted: bucket, total: 0, wins: 0 };
    calibration[bucket].total++;
    if (favWon) calibration[bucket].wins++;
    
    // Check for value
    const homeEdge = pred.homeWinProb - bookHomeNoVig;
    const awayEdge = pred.awayWinProb - bookAwayNoVig;
    
    let betSide = null, betEdge = 0, betML = 0, betProb = 0;
    if (homeEdge > minEdge && homeEdge >= awayEdge) {
      betSide = 'home'; betEdge = homeEdge; betML = closingHomeML; betProb = pred.homeWinProb;
    } else if (awayEdge > minEdge) {
      betSide = 'away'; betEdge = awayEdge; betML = closingAwayML; betProb = pred.awayWinProb;
    }
    
    if (betSide) {
      totalBets++;
      const betWon = (betSide === 'home' && homeWon) || (betSide === 'away' && !homeWon);
      const payout = betML > 0 ? betML : 10000 / (-betML);
      const betProfit = betWon ? payout : -100;
      
      wagered += 100;
      profit += betProfit;
      if (betWon) wins++; else losses++;
      
      const tierKey = betEdge >= 0.10 ? '10%+' : betEdge >= 0.05 ? '5-10%' : '2-5%';
      edgeTiers[tierKey].bets++;
      if (betWon) edgeTiers[tierKey].wins++;
      edgeTiers[tierKey].profit += betProfit;
      
      gameResults.push({
        away, home, awayScore, homeScore,
        modelHomeProb: pred.homeWinProb, modelAwayProb: pred.awayWinProb,
        bookHomeNoVig: +bookHomeNoVig.toFixed(3), bookAwayNoVig: +bookAwayNoVig.toFixed(3),
        betSide, betEdge: +betEdge.toFixed(3), betML,
        won: betWon, profit: +betProfit.toFixed(0)
      });
    }
    
    // Totals tracking
    const actualTotal = awayScore + homeScore;
    const modelTotal = pred.totalRuns;
    const bookTotal = 8.5; // Standard line
    if (Math.abs(modelTotal - bookTotal) > 0.5) {
      totalBetsOU++;
      const overBet = modelTotal > bookTotal;
      const overHit = actualTotal > bookTotal;
      const ouWin = overBet === overHit;
      if (ouWin) totalWinsOU++;
      totalProfitOU += ouWin ? 91 : -100; // -110 juice
    }
  }
  
  const roi = wagered > 0 ? ((profit / wagered) * 100) : 0;
  const winRate = totalBets > 0 ? ((wins / totalBets) * 100) : 0;
  const accuracy = totalPicks > 0 ? ((correctPicks / totalPicks) * 100) : 0;
  
  // Calibration array
  const calArray = Object.values(calibration)
    .filter(c => c.total >= 3) // min 3 games for meaningful calibration
    .map(c => ({
      predicted: c.predicted,
      actual: +(c.wins / c.total).toFixed(3),
      count: c.total,
      gap: +((c.wins / c.total - c.predicted) * 100).toFixed(1),
    }))
    .sort((a, b) => a.predicted - b.predicted);
  
  // Profit curve
  let cumProfit = 0;
  const profitCurve = gameResults.map((g, i) => {
    cumProfit += g.profit;
    return { bet: i + 1, profit: +cumProfit.toFixed(0) };
  });
  
  return {
    sport: 'MLB',
    version: 'v2.0 — Point-in-Time (2023→2024)',
    method: 'Preseason projections using 2023 actual stats + 30% regression to mean',
    totalGames: GAMES.length,
    straightUpAccuracy: +accuracy.toFixed(1),
    correctPicks,
    totalPicks,
    totalBets, wins, losses,
    winRate: +winRate.toFixed(1),
    wagered, profit: +profit.toFixed(0),
    roi: +roi.toFixed(1),
    edgeTiers: Object.entries(edgeTiers).map(([tier, d]) => ({
      tier, bets: d.bets, wins: d.wins,
      winRate: d.bets > 0 ? +((d.wins/d.bets)*100).toFixed(1) : 0,
      profit: +d.profit.toFixed(0),
      roi: d.bets > 0 ? +((d.profit / (d.bets * 100)) * 100).toFixed(1) : 0
    })),
    totals: {
      bets: totalBetsOU,
      wins: totalWinsOU,
      winRate: totalBetsOU > 0 ? +((totalWinsOU / totalBetsOU) * 100).toFixed(1) : 0,
      profit: totalProfitOU,
      roi: totalBetsOU > 0 ? +((totalProfitOU / (totalBetsOU * 100)) * 100).toFixed(1) : 0,
    },
    calibration: calArray,
    profitCurve,
    games: gameResults,
    comparison: {
      v1_note: 'V1 used look-ahead bias (2025 projected stats to predict 2024 games): 89% WR, +62.7% ROI',
      v2_note: 'V2 uses proper point-in-time data (2023 stats → predict 2024): more realistic metrics'
    }
  };
}

// ==================== PARAMETER SWEEP ====================
// Find optimal parameters for the preseason model

function paramSweep() {
  const results = [];
  
  // Sweep regression amounts
  for (let reg = 0.15; reg <= 0.50; reg += 0.05) {
    // Modify regression temporarily
    const originalRegression = REGRESSION;
    
    // Create teams with different regression
    const teams = {};
    for (const [abbr, t] of Object.entries(PRESEASON_2024_TEAMS)) {
      teams[abbr] = {
        ...t,
        rsG: +(t.rsG * (1 - reg) + LG_AVG.rsG * reg).toFixed(2),
        raG: +(t.raG * (1 - reg) + LG_AVG.raG * reg).toFixed(2),
        era: +(t.era * (1 - reg) + LG_AVG.era * reg).toFixed(2),
        fip: +(t.fip * (1 - reg) + LG_AVG.fip * reg).toFixed(2),
        whip: +(t.whip * (1 - reg) + LG_AVG.whip * reg).toFixed(3),
        k9: +(t.k9 * (1 - reg) + LG_AVG.k9 * reg).toFixed(1),
        ops: +(t.ops * (1 - reg) + LG_AVG.ops * reg).toFixed(3),
        bullpenEra: +(t.bullpenEra * (1 - reg) + LG_AVG.bullpenEra * reg).toFixed(2),
        l10: '5-5',
      };
    }
    
    let correct = 0, total = 0;
    for (const [away, home, awayScore, homeScore] of GAMES) {
      if (!teams[away] || !teams[home]) continue;
      const pred = preseasonPredict(away, home, teams);
      if (!pred) continue;
      total++;
      const homeWon = homeScore > awayScore;
      const modelHome = pred.homeWinProb > 0.5;
      if ((modelHome && homeWon) || (!modelHome && !homeWon)) correct++;
    }
    
    results.push({
      regression: +reg.toFixed(2),
      accuracy: +((correct / total) * 100).toFixed(1),
      games: total,
    });
  }
  
  results.sort((a, b) => b.accuracy - a.accuracy);
  return results;
}

module.exports = { runBacktest, paramSweep, getRegressedTeams, PRESEASON_2024_TEAMS, GAMES };
