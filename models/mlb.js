// models/mlb.js — MLB Baseball Model v2.0
// Pythagorean win expectation, pitcher matchups, park factors, Poisson totals, value detection
// Enhanced with starting pitcher database integration

const pitchers = require('./mlb-pitchers');

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
    
    const parkFactor = PARK_FACTORS[t.park] || 1.0;
    const neutralRsG = t.rsG / parkFactor;
    const neutralRaG = t.raG / (2 - parkFactor);
    const neutralRunDiff = neutralRsG - neutralRaG;
    
    const pitchScore = (LG_AVG.era - t.era) * 0.4 + (LG_AVG.fip - t.fip) * 0.35 + 
                       (LG_AVG.whip - t.whip) * 5 * 0.15 + (t.k9 - LG_AVG.k9) * 0.1;
    const offScore = (t.rsG - LG_AVG.rsG) * 0.5 + (t.ops - 0.730) * 10 * 0.5;
    const bullpenScore = (LG_AVG.era - t.bullpenEra) * 0.5;
    
    const power = neutralRunDiff * 10 + pitchScore * 3 + offScore * 2 + bullpenScore * 2 - luck * 8;
    
    const l10parts = t.l10.split('-');
    const l10wpct = parseInt(l10parts[0]) / 10;
    const momentum = l10wpct - 0.5;

    // Get rotation info
    const rotation = pitchers.getTeamRotation(abbr);
    const rotationRating = rotation ? +(rotation.reduce((s, p) => s + p.rating, 0) / rotation.length).toFixed(1) : null;
    const ace = rotation ? rotation[0] : null;
    
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
      l10: t.l10,
      rotationRating,
      aceName: ace ? ace.name : null,
      aceRating: ace ? ace.rating : null
    };
  }
  return ratings;
}

// ==================== PITCHER-ENHANCED PREDICTION ====================

// Resolve pitcher — accepts name string or raw {era, fip, whip} object
function resolvePitcher(pitcherInput, teamAbbr) {
  if (!pitcherInput) return null;
  
  // If it's a string name, look up in DB
  if (typeof pitcherInput === 'string') {
    // Try exact lookup first
    let p = pitchers.getPitcherByName(pitcherInput);
    if (p) return p;
    
    // Try team-specific search
    const rotation = pitchers.getTeamRotation(teamAbbr);
    if (rotation) {
      const lower = pitcherInput.toLowerCase().trim();
      for (const rp of rotation) {
        const rpLower = rp.name.toLowerCase();
        if (rpLower.includes(lower) || lower.includes(rpLower.split(' ').pop())) return { ...rp };
      }
    }
    return null;
  }
  
  // If it's an object with raw stats
  if (typeof pitcherInput === 'object') return pitcherInput;
  return null;
}

// Calculate pitcher's expected RA/9 based on their stats and opposing offense
function pitcherExpectedRA(pitcher, opposingTeam, parkFactor) {
  if (!pitcher) return null;
  
  const pFip = pitcher.fip || pitcher.era || LG_AVG.fip;
  const pEra = pitcher.era || pitcher.fip || LG_AVG.era;
  const pXfip = pitcher.xfip || pFip;
  
  // Predictive RA: weight FIP/xFIP more than ERA (more predictive)
  const pitcherRA = pFip * 0.35 + pXfip * 0.35 + pEra * 0.30;
  
  // Opposing offense modifier: how much better/worse than average is the opposing offense
  const offMod = opposingTeam ? (opposingTeam.rsG / LG_AVG.rsG) : 1.0;
  
  // Park-adjusted expected RA per 9 innings from this pitcher
  const adjustedRA = pitcherRA * offMod * (parkFactor || 1.0);
  
  return adjustedRA;
}

// Pitcher adjustment: blend starter contribution with bullpen
function pitcherAdjustment(teamRaG, teamBullpenEra, pitcher, opposingTeam, parkFactor) {
  if (!pitcher) return teamRaG;
  
  const pitcherRA = pitcherExpectedRA(pitcher, opposingTeam, parkFactor) || teamRaG;
  
  // Starter covers ~5.5 innings, bullpen covers ~3.5
  const starterFraction = 5.5 / 9;
  const bullpenFraction = 3.5 / 9;
  
  const starterContrib = (pitcherRA / 9) * 5.5;
  const bullpenContrib = ((teamBullpenEra || teamRaG) / 9) * 3.5;
  
  return starterContrib + bullpenContrib;
}

function predict(awayAbbr, homeAbbr, opts = {}) {
  const away = TEAMS[awayAbbr];
  const home = TEAMS[homeAbbr];
  if (!away) return { error: `Unknown team: ${awayAbbr}` };
  if (!home) return { error: `Unknown team: ${homeAbbr}` };
  
  const ratings = calculateRatings();
  const awayR = ratings[awayAbbr];
  const homeR = ratings[homeAbbr];
  
  const pf = PARK_FACTORS[home.park] || 1.0;
  
  // Resolve pitchers
  const awayPitcher = resolvePitcher(opts.awayPitcher, awayAbbr) || 
    (opts.awayPitcherEra || opts.awayPitcherFip ? { era: opts.awayPitcherEra, fip: opts.awayPitcherFip, xfip: opts.awayPitcherFip, whip: opts.awayPitcherWhip } : null);
  const homePitcher = resolvePitcher(opts.homePitcher, homeAbbr) ||
    (opts.homePitcherEra || opts.homePitcherFip ? { era: opts.homePitcherEra, fip: opts.homePitcherFip, xfip: opts.homePitcherFip, whip: opts.homePitcherWhip } : null);
  
  // Calculate expected runs
  let awayRaG, homeRaG;
  
  if (homePitcher) {
    // Home pitcher faces away offense — this determines away team expected runs... wait
    // Actually: away team's expected runs = away offense vs home pitcher
    // Adjusted RA from home pitcher = runs the away team scores
    const homePitcherRA = pitcherExpectedRA(homePitcher, away, pf);
    // Away team runs = blend of (away offense) * (home pitcher quality relative to avg)
    const pitcherMod = homePitcherRA / LG_AVG.era;
    awayRaG = away.rsG * pitcherMod * pf / (pf); // park already in pitcherRA
    // Simpler: away team expected runs = away.rsG * (homePitcherRA / LG_AVG.era)
    // But we need to separate starter and bullpen
    const starterRuns = (homePitcherRA / 9) * 5.5;
    const bullpenRuns = (home.bullpenEra / 9) * 3.5;
    const adjustedHomeRaG = starterRuns + bullpenRuns;
    // away expected runs = away offense quality * adjusted pitching
    awayRaG = (away.rsG / LG_AVG.rsG) * adjustedHomeRaG * pf;
  } else {
    awayRaG = away.rsG * (home.raG / LG_AVG.raG) * pf;
  }
  
  if (awayPitcher) {
    const awayPitcherRA = pitcherExpectedRA(awayPitcher, home, pf);
    const starterRuns = (awayPitcherRA / 9) * 5.5;
    const bullpenRuns = (away.bullpenEra / 9) * 3.5;
    const adjustedAwayRaG = starterRuns + bullpenRuns;
    homeRaG = (home.rsG / LG_AVG.rsG) * adjustedAwayRaG * pf;
  } else {
    homeRaG = home.rsG * (away.raG / LG_AVG.raG) * pf;
  }

  // Ensure sane bounds
  awayRaG = Math.max(1.5, Math.min(10, awayRaG));
  homeRaG = Math.max(1.5, Math.min(10, homeRaG));

  const awayExpRuns = awayRaG;
  const homeExpRuns = homeRaG;
  
  // F5 (first 5 innings) — pitcher dominates this portion
  let f5Factor = 0.565;
  // If we have specific pitcher data, F5 is more pitcher-dependent
  if (homePitcher && awayPitcher) {
    // Better pitchers suppress runs more in F5 since they're still in the game
    const avgPitcherFip = (homePitcher.fip + awayPitcher.fip) / 2;
    const fipAdj = (LG_AVG.fip - avgPitcherFip) / LG_AVG.fip;
    f5Factor = 0.565 - fipAdj * 0.03; // ace matchups = lower F5 total
  }
  const awayExpF5 = awayExpRuns * f5Factor;
  const homeExpF5 = homeExpRuns * f5Factor;
  
  // Win probability using log5 method
  let awayTruePct, homeTruePct;
  if (awayPitcher && homePitcher) {
    // Pitcher-adjusted Pythagorean
    awayTruePct = pythWinPct(awayExpRuns, homeExpRuns);
    homeTruePct = 1 - awayTruePct;
  } else {
    awayTruePct = pythWinPct(away.rsG, away.raG);
    homeTruePct = pythWinPct(home.rsG, home.raG);
  }
  
  // Log5
  let awayWinProb = (awayTruePct - awayTruePct * homeTruePct) / (awayTruePct + homeTruePct - 2 * awayTruePct * homeTruePct);
  
  // Home advantage adjustment
  awayWinProb = awayWinProb * (1 - HOME_ADV) / (awayWinProb * (1 - HOME_ADV) + (1 - awayWinProb) * HOME_ADV);
  let homeWinProb = 1 - awayWinProb;
  
  // Pitcher quality differential bonus
  if (awayPitcher && homePitcher) {
    const awayPRating = awayPitcher.rating || 50;
    const homePRating = homePitcher.rating || 50;
    const ratingDiff = (homePRating - awayPRating) / 100;
    // Each 10 rating points ≈ 1.5% win prob shift
    homeWinProb = Math.min(0.85, Math.max(0.15, homeWinProb + ratingDiff * 0.15));
    awayWinProb = 1 - homeWinProb;
  }
  
  // Momentum nudge (small)
  const momAdj = (homeR.momentum - awayR.momentum) * 0.02;
  homeWinProb = Math.min(0.90, Math.max(0.10, homeWinProb + momAdj));
  awayWinProb = 1 - homeWinProb;
  
  // Total runs
  const totalRuns = awayExpRuns + homeExpRuns;
  
  // Run line probability
  const runDiffMean = homeExpRuns - awayExpRuns;
  const runDiffStd = 3.8;
  const homeRL = normalCDF(runDiffMean - 1.5, runDiffStd);
  const awayRL = 1 - normalCDF(runDiffMean + 1.5, runDiffStd);
  
  const homeML = probToML(homeWinProb);
  const awayML = probToML(awayWinProb);

  // Poisson totals
  const poissonTotals = calculatePoissonTotals(awayExpRuns, homeExpRuns);
  
  const result = {
    away: awayAbbr, home: homeAbbr,
    awayName: away.name, homeName: home.name,
    homeWinProb: +(homeWinProb.toFixed(3)),
    awayWinProb: +(awayWinProb.toFixed(3)),
    homeML, awayML,
    homeExpRuns: +(homeExpRuns.toFixed(2)),
    awayExpRuns: +(awayExpRuns.toFixed(2)),
    totalRuns: +(totalRuns.toFixed(1)),
    f5Total: +((awayExpF5 + homeExpF5).toFixed(1)),
    runDiff: +(runDiffMean.toFixed(1)),
    homeRunLine: { spread: -1.5, prob: +(homeRL.toFixed(3)) },
    awayRunLine: { spread: 1.5, prob: +(awayRL.toFixed(3)) },
    parkFactor: pf,
    awayPower: awayR.power,
    homePower: homeR.power,
    totals: poissonTotals,
    factors: {
      awayPythWpct: awayR.pythWpct,
      homePythWpct: homeR.pythWpct,
      awayLuck: awayR.luck,
      homeLuck: homeR.luck,
      parkEffect: pf,
      homeAdv: HOME_ADV
    }
  };

  // Add pitcher info if available
  if (awayPitcher) {
    result.awayPitcher = {
      name: awayPitcher.name || 'Custom',
      hand: awayPitcher.hand || '?',
      era: awayPitcher.era,
      fip: awayPitcher.fip,
      xfip: awayPitcher.xfip,
      whip: awayPitcher.whip,
      k9: awayPitcher.k9,
      rating: awayPitcher.rating || null,
      tier: awayPitcher.rating ? pitchers.getPitcherTier(awayPitcher.rating) : null
    };
  }
  if (homePitcher) {
    result.homePitcher = {
      name: homePitcher.name || 'Custom',
      hand: homePitcher.hand || '?',
      era: homePitcher.era,
      fip: homePitcher.fip,
      xfip: homePitcher.xfip,
      whip: homePitcher.whip,
      k9: homePitcher.k9,
      rating: homePitcher.rating || null,
      tier: homePitcher.rating ? pitchers.getPitcherTier(homePitcher.rating) : null
    };
  }
  
  return result;
}

// ==================== POISSON TOTALS MODEL ====================

// Pre-compute factorials for Poisson
const FACTORIALS = [1];
for (let i = 1; i <= 25; i++) FACTORIALS[i] = FACTORIALS[i-1] * i;

function poissonPMF(lambda, k) {
  if (k < 0 || k > 25) return 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / FACTORIALS[k];
}

// Calculate full score distribution and over/under probabilities
function calculatePoissonTotals(awayExpRuns, homeExpRuns) {
  const lambdaAway = Math.max(0.5, awayExpRuns);
  const lambdaHome = Math.max(0.5, homeExpRuns);
  const projTotal = lambdaAway + lambdaHome;
  
  // Build score probability matrix (0-15 runs each)
  const maxRuns = 16;
  const scoreMatrix = [];
  for (let a = 0; a < maxRuns; a++) {
    scoreMatrix[a] = [];
    for (let h = 0; h < maxRuns; h++) {
      scoreMatrix[a][h] = poissonPMF(lambdaAway, a) * poissonPMF(lambdaHome, h);
    }
  }
  
  // Calculate probabilities for common total lines
  const lines = [6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11];
  const totalProbs = {};
  
  for (const line of lines) {
    let overProb = 0;
    let underProb = 0;
    
    for (let a = 0; a < maxRuns; a++) {
      for (let h = 0; h < maxRuns; h++) {
        const total = a + h;
        const prob = scoreMatrix[a][h];
        if (total > line) overProb += prob;
        else if (total < line) underProb += prob;
        // Exact pushes (whole number lines) go to neither
      }
    }
    
    totalProbs[line] = {
      over: +(overProb.toFixed(3)),
      under: +(underProb.toFixed(3)),
      overML: probToML(overProb),
      underML: probToML(underProb)
    };
  }
  
  // Most likely final scores
  const likelyScores = [];
  for (let a = 0; a < 12; a++) {
    for (let h = 0; h < 12; h++) {
      likelyScores.push({ away: a, home: h, prob: scoreMatrix[a][h] });
    }
  }
  likelyScores.sort((a, b) => b.prob - a.prob);
  
  return {
    projTotal: +(projTotal.toFixed(1)),
    awayLambda: +(lambdaAway.toFixed(2)),
    homeLambda: +(lambdaHome.toFixed(2)),
    lines: totalProbs,
    likelyScores: likelyScores.slice(0, 10).map(s => ({
      score: `${s.away}-${s.home}`,
      prob: +(s.prob * 100).toFixed(1)
    }))
  };
}

// Standalone totals prediction
function predictTotal(awayAbbr, homeAbbr, opts = {}) {
  const pred = predict(awayAbbr, homeAbbr, opts);
  if (pred.error) return pred;
  
  return {
    away: awayAbbr, home: homeAbbr,
    awayName: pred.awayName, homeName: pred.homeName,
    awayExpRuns: pred.awayExpRuns,
    homeExpRuns: pred.homeExpRuns,
    ...pred.totals,
    parkFactor: pred.parkFactor,
    awayPitcher: pred.awayPitcher || null,
    homePitcher: pred.homePitcher || null
  };
}

// ==================== MATCHUP ANALYSIS ====================

function analyzeMatchup(awayAbbr, homeAbbr, opts = {}) {
  const pred = predict(awayAbbr, homeAbbr, opts);
  if (pred.error) return pred;
  
  const away = TEAMS[awayAbbr];
  const home = TEAMS[homeAbbr];
  const ratings = calculateRatings();
  
  // Get rotations
  const awayRotation = pitchers.getTeamRotation(awayAbbr) || [];
  const homeRotation = pitchers.getTeamRotation(homeAbbr) || [];
  
  // Analyze specific pitcher matchup
  let pitcherAdvantage = 'EVEN';
  let pitcherSwing = 0;
  if (pred.awayPitcher && pred.homePitcher) {
    const diff = (pred.homePitcher.rating || 50) - (pred.awayPitcher.rating || 50);
    pitcherSwing = diff;
    if (diff > 10) pitcherAdvantage = `${homeAbbr} +${diff}`;
    else if (diff < -10) pitcherAdvantage = `${awayAbbr} +${Math.abs(diff)}`;
  }
  
  // Offense vs pitching matchup
  const offensiveEdge = {
    away: +(away.rsG - LG_AVG.rsG).toFixed(2),
    home: +(home.rsG - LG_AVG.rsG).toFixed(2),
    advantage: away.rsG > home.rsG ? awayAbbr : homeAbbr
  };
  
  const bullpenEdge = {
    away: +(LG_AVG.era - away.bullpenEra).toFixed(2),
    home: +(LG_AVG.era - home.bullpenEra).toFixed(2),
    advantage: away.bullpenEra < home.bullpenEra ? awayAbbr : homeAbbr
  };
  
  // Key factors summary
  const keyFactors = [];
  if (pred.parkFactor > 1.03) keyFactors.push(`🏟️ Hitter-friendly park (${pred.parkFactor}x)`);
  if (pred.parkFactor < 0.96) keyFactors.push(`🏟️ Pitcher-friendly park (${pred.parkFactor}x)`);
  if (pred.awayPitcher && pred.awayPitcher.tier === 'ACE') keyFactors.push(`🔥 ${pred.awayPitcher.name} is an ACE (${pred.awayPitcher.rating})`);
  if (pred.homePitcher && pred.homePitcher.tier === 'ACE') keyFactors.push(`🔥 ${pred.homePitcher.name} is an ACE (${pred.homePitcher.rating})`);
  if (Math.abs(pred.awayPower - pred.homePower) > 15) keyFactors.push(`⚡ Big power rating gap: ${pred.awayPower} vs ${pred.homePower}`);
  if (pred.totalRuns > 9.5) keyFactors.push(`💥 High-scoring projection: ${pred.totalRuns} runs`);
  if (pred.totalRuns < 7) keyFactors.push(`🧊 Low-scoring projection: ${pred.totalRuns} runs`);
  
  return {
    ...pred,
    matchup: {
      pitcherAdvantage,
      pitcherSwing,
      offensiveEdge,
      bullpenEdge,
      keyFactors,
      awayRotation: awayRotation.map(p => ({ name: p.name, rating: p.rating, tier: pitchers.getPitcherTier(p.rating), era: p.era, fip: p.fip })),
      homeRotation: homeRotation.map(p => ({ name: p.name, rating: p.rating, tier: pitchers.getPitcherTier(p.rating), era: p.era, fip: p.fip }))
    }
  };
}

// ==================== VALUE DETECTION ====================

function findValue(prediction, bookLine) {
  const edges = [];
  const minEdge = 0.02;
  
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
        kelly: { full: +(kelly.toFixed(3)), half: +((kelly/2).toFixed(3)) },
        pitcher: prediction.homePitcher ? prediction.homePitcher.name : null
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
        kelly: { full: +(kelly.toFixed(3)), half: +((kelly/2).toFixed(3)) },
        pitcher: prediction.awayPitcher ? prediction.awayPitcher.name : null
      });
    }
  }
  
  // Total value (enhanced with Poisson)
  if (bookLine.total && prediction.totals && prediction.totals.lines) {
    const line = bookLine.total;
    const poissonData = prediction.totals.lines[line];
    
    if (poissonData) {
      // Over value
      const overEdge = poissonData.over - 0.5; // vs -110 juice
      if (overEdge > 0.03) {
        edges.push({
          pick: `Over ${line}`, side: 'over', market: 'total',
          modelProb: poissonData.over, bookTotal: line,
          modelTotal: prediction.totals.projTotal,
          edge: +(overEdge.toFixed(3)),
          diff: +(prediction.totals.projTotal - line).toFixed(1),
          ml: poissonData.overML
        });
      }
      // Under value
      const underEdge = poissonData.under - 0.5;
      if (underEdge > 0.03) {
        edges.push({
          pick: `Under ${line}`, side: 'under', market: 'total',
          modelProb: poissonData.under, bookTotal: line,
          modelTotal: prediction.totals.projTotal,
          edge: +(underEdge.toFixed(3)),
          diff: +(line - prediction.totals.projTotal).toFixed(1),
          ml: poissonData.underML
        });
      }
    } else {
      // Fallback for non-standard lines
      const diff = prediction.totalRuns - line;
      if (Math.abs(diff) > 0.5) {
        const side = diff > 0 ? 'Over' : 'Under';
        edges.push({
          pick: `${side} ${line}`, side: side.toLowerCase(), market: 'total',
          modelTotal: prediction.totalRuns, bookTotal: line,
          edge: +(Math.abs(diff / 10).toFixed(3)), diff: +(diff.toFixed(1))
        });
      }
    }
  }
  
  return edges;
}

// ==================== MATH HELPERS ====================

function normalCDF(x, std) {
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

module.exports = { 
  TEAMS, PARK_FACTORS, 
  calculateRatings, predict, predictTotal, analyzeMatchup, findValue, 
  pythWinPct, calculatePoissonTotals,
  resolvePitcher
};
