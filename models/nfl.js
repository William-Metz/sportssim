/**
 * NFL Power Rating Model — SportsSim v56.0
 * ==========================================
 * Pythagorean-based power ratings for NFL with:
 *   - Base ratings from 2025 season final standings
 *   - Pythagorean win expectation (N=2.37 for NFL)
 *   - Regression to mean (key NFL principle — ~35% regression year-over-year)
 *   - Free agency / coaching changes adjustments
 *   - Draft capital projections (pre-draft: higher picks = more impact)
 *   - Home field advantage (NFL HFA ~2.5 pts / ~57% win rate)
 *   - Division-aware scheduling (play div rivals 2x each = 6 games)
 * 
 * KEY NFL BETTING EDGE:
 *   Win totals are posted MONTHS before the season.
 *   The public overreacts to last year's results.
 *   Regression to the mean is the #1 most underpriced factor.
 *   Teams that went 14-3 rarely repeat; teams that went 3-14 rarely repeat.
 *   Our Pythagorean + regression model captures this.
 */

// ==================== 2025 NFL SEASON DATA ====================
// Source: ESPN API (2025 regular season final standings)
// SEA: Super Bowl champions (beat NE 29-13)
const TEAMS = {
  // === AFC EAST ===
  'BUF': { name: 'Buffalo Bills', conf: 'AFC', div: 'AFC East', w: 12, l: 5, pf: 481, pa: 365 },
  'MIA': { name: 'Miami Dolphins', conf: 'AFC', div: 'AFC East', w: 7, l: 10, pf: 347, pa: 424 },
  'NE':  { name: 'New England Patriots', conf: 'AFC', div: 'AFC East', w: 14, l: 3, pf: 490, pa: 320 },
  'NYJ': { name: 'New York Jets', conf: 'AFC', div: 'AFC East', w: 3, l: 14, pf: 300, pa: 503 },
  
  // === AFC NORTH ===
  'BAL': { name: 'Baltimore Ravens', conf: 'AFC', div: 'AFC North', w: 8, l: 9, pf: 424, pa: 398 },
  'CIN': { name: 'Cincinnati Bengals', conf: 'AFC', div: 'AFC North', w: 6, l: 11, pf: 414, pa: 492 },
  'CLE': { name: 'Cleveland Browns', conf: 'AFC', div: 'AFC North', w: 5, l: 12, pf: 279, pa: 379 },
  'PIT': { name: 'Pittsburgh Steelers', conf: 'AFC', div: 'AFC North', w: 10, l: 7, pf: 397, pa: 387 },
  
  // === AFC SOUTH ===
  'HOU': { name: 'Houston Texans', conf: 'AFC', div: 'AFC South', w: 12, l: 5, pf: 404, pa: 295 },
  'IND': { name: 'Indianapolis Colts', conf: 'AFC', div: 'AFC South', w: 8, l: 9, pf: 466, pa: 412 },
  'JAX': { name: 'Jacksonville Jaguars', conf: 'AFC', div: 'AFC South', w: 13, l: 4, pf: 474, pa: 336 },
  'TEN': { name: 'Tennessee Titans', conf: 'AFC', div: 'AFC South', w: 3, l: 14, pf: 284, pa: 478 },
  
  // === AFC WEST ===
  'DEN': { name: 'Denver Broncos', conf: 'AFC', div: 'AFC West', w: 14, l: 3, pf: 401, pa: 311 },
  'KC':  { name: 'Kansas City Chiefs', conf: 'AFC', div: 'AFC West', w: 6, l: 11, pf: 362, pa: 328 },
  'LV':  { name: 'Las Vegas Raiders', conf: 'AFC', div: 'AFC West', w: 3, l: 14, pf: 241, pa: 432 },
  'LAC': { name: 'Los Angeles Chargers', conf: 'AFC', div: 'AFC West', w: 11, l: 6, pf: 368, pa: 340 },
  
  // === NFC EAST ===
  'DAL': { name: 'Dallas Cowboys', conf: 'NFC', div: 'NFC East', w: 7, l: 9, pf: 471, pa: 511 },  // 1 tie handled as loss
  'NYG': { name: 'New York Giants', conf: 'NFC', div: 'NFC East', w: 4, l: 13, pf: 381, pa: 439 },
  'PHI': { name: 'Philadelphia Eagles', conf: 'NFC', div: 'NFC East', w: 11, l: 6, pf: 379, pa: 325 },
  'WSH': { name: 'Washington Commanders', conf: 'NFC', div: 'NFC East', w: 5, l: 12, pf: 356, pa: 451 },
  
  // === NFC NORTH ===
  'CHI': { name: 'Chicago Bears', conf: 'NFC', div: 'NFC North', w: 11, l: 6, pf: 441, pa: 415 },
  'DET': { name: 'Detroit Lions', conf: 'NFC', div: 'NFC North', w: 9, l: 8, pf: 481, pa: 413 },
  'GB':  { name: 'Green Bay Packers', conf: 'NFC', div: 'NFC North', w: 9, l: 7, pf: 391, pa: 360 },  // 1 tie
  'MIN': { name: 'Minnesota Vikings', conf: 'NFC', div: 'NFC North', w: 9, l: 8, pf: 344, pa: 333 },
  
  // === NFC SOUTH ===
  'ATL': { name: 'Atlanta Falcons', conf: 'NFC', div: 'NFC South', w: 8, l: 9, pf: 353, pa: 401 },
  'CAR': { name: 'Carolina Panthers', conf: 'NFC', div: 'NFC South', w: 8, l: 9, pf: 311, pa: 380 },
  'NO':  { name: 'New Orleans Saints', conf: 'NFC', div: 'NFC South', w: 6, l: 11, pf: 306, pa: 383 },
  'TB':  { name: 'Tampa Bay Buccaneers', conf: 'NFC', div: 'NFC South', w: 8, l: 9, pf: 380, pa: 411 },
  
  // === NFC WEST ===
  'ARI': { name: 'Arizona Cardinals', conf: 'NFC', div: 'NFC West', w: 3, l: 14, pf: 355, pa: 488 },
  'LAR': { name: 'Los Angeles Rams', conf: 'NFC', div: 'NFC West', w: 12, l: 5, pf: 518, pa: 346 },
  'SF':  { name: 'San Francisco 49ers', conf: 'NFC', div: 'NFC West', w: 12, l: 5, pf: 437, pa: 371 },
  'SEA': { name: 'Seattle Seahawks', conf: 'NFC', div: 'NFC West', w: 14, l: 3, pf: 483, pa: 292 },
};

// ==================== DIVISIONS ====================
const DIVISIONS = {
  'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
  'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
  'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
  'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
  'NFC East': ['DAL', 'NYG', 'PHI', 'WSH'],
  'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
  'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
  'NFC West': ['ARI', 'LAR', 'SF', 'SEA'],
};

const CONFERENCES = {
  'AFC': ['AFC East', 'AFC North', 'AFC South', 'AFC West'],
  'NFC': ['NFC East', 'NFC North', 'NFC South', 'NFC West'],
};

// ==================== CONSTANTS ====================
const PYTH_EXPONENT = 2.37;       // NFL Pythagorean exponent (empirically 2.37)
const HFA_POINTS = 2.5;           // Home field advantage in points
const HFA_WIN_PROB = 0.57;        // Home team base win probability  
const REGRESSION_FACTOR = 0.35;   // 35% regression to mean (NFL year-over-year)
const MEAN_WINS = 8.5;            // Mean wins in 17-game season
const SPREAD_TO_PROB_K = 13;      // Spread to probability conversion factor (NFL)

// ==================== OFFSEASON CHANGES ====================
// Major coaching/FA moves that shift team power ratings
// Positive = team improved, negative = team worse
// Updated for 2026 offseason through March 22
const OFFSEASON_ADJUSTMENTS = {
  // Big winners this offseason
  'SEA': +0.5,    // Super Bowl champs, core returns, some FA losses but strong draft position
  'NE':  -1.0,    // Lost key pieces after Super Bowl run, regression likely from 14-3
  'DEN': -0.5,    // 14-3 regression, some FA departures
  'JAX': +0.0,    // Strong core returns, Trevor Lawrence Year 5
  'BUF': -0.5,    // Allen aging, cap pressure, some key losses
  
  // Bounce-back candidates
  'KC':  +2.0,    // Mahomes regression was anomalous, expect 10+ wins
  'BAL': +1.0,    // Lamar + improved roster, 8-9 was underperformance
  'CIN': +1.5,    // Burrow healthy, defense retooled
  'DET': +0.5,    // Healthy roster return after injury-plagued 2025
  
  // Rebuilding/declining
  'NYJ': -0.5,    // Still rebuilding, new regime
  'TEN': +1.0,    // Draft capital + can't get worse than 3-14
  'LV':  +0.5,    // Draft capital + bottomed out
  'ARI': +0.5,    // Young talent developing
  'CLE': +0.5,    // Draft capital
  'NYG': +0.5,    // Rebuild year 2
  'NO':  -0.5,    // Cap hell, aging core, Carr retired
  
  // Movers
  'DAL': +0.5,    // Healthy Prescott bounce
  'PHI': +0.0,    // Defending NFC, strong core
  'SF':  -0.5,    // Aging, some key FA losses
  'LAR': +0.0,    // Strong offense returns
  'CHI': +0.5,    // Caleb Williams Year 3
  'GB':  +0.5,    // Love developing, young team
  'MIN': +0.0,    // Stable
  'ATL': +0.0,    // Stable
  'CAR': +0.5,    // Young QB developing
  'TB':  -0.5,    // Baker getting older, lost some pieces
  'HOU': +0.0,    // Strong core returns, Stroud Year 3
  'IND': +0.5,    // AR year 3 bounce
  'MIA': +0.5,    // Tua healthy, improved roster
  'WSH': +1.0,    // Daniels Year 2 leap
  'PIT': +0.0,    // Stable but aging
  'LAC': +0.0,    // Herbert, stable
};

// ==================== MARKET LINES ====================
// DraftKings 2025-26 win totals (from VegasInsider, May 2025 posting)
// These are for the NEXT season (2026-27). Using most common across books.
const MARKET_LINES = {
  'BUF': { line: 10.5, overJuice: -130 },
  'MIA': { line: 4.5, overJuice: -125 },
  'NE':  { line: 9.5, overJuice: -120 },
  'NYJ': { line: 5.5, overJuice: -115 },
  'BAL': { line: 11.5, overJuice: +120 },
  'CIN': { line: 9.5, overJuice: -110 },
  'CLE': { line: 6.5, overJuice: +115 },
  'PIT': { line: 8.5, overJuice: -105 },
  'HOU': { line: 9.5, overJuice: -125 },
  'IND': { line: 8.5, overJuice: +110 },
  'JAX': { line: 9.5, overJuice: -105 },
  'TEN': { line: 6.5, overJuice: -140 },
  'DEN': { line: 9.5, overJuice: -115 },
  'KC':  { line: 10.5, overJuice: +110 },
  'LV':  { line: 5.5, overJuice: -125 },
  'LAC': { line: 10.5, overJuice: +120 },
  'DAL': { line: 8.5, overJuice: -145 },
  'NYG': { line: 7.5, overJuice: +100 },
  'PHI': { line: 10.5, overJuice: +105 },
  'WSH': { line: 7.5, overJuice: -120 },
  'CHI': { line: 9.5, overJuice: +100 },
  'DET': { line: 10.5, overJuice: -105 },
  'GB':  { line: 10.5, overJuice: -105 },
  'MIN': { line: 8.5, overJuice: -105 },
  'ATL': { line: 7.5, overJuice: -110 },
  'CAR': { line: 6.5, overJuice: -130 },
  'NO':  { line: 7.5, overJuice: -130 },
  'TB':  { line: 8.5, overJuice: -105 },
  'ARI': { line: 4.5, overJuice: -105 },
  'LAR': { line: 10.5, overJuice: -145 },
  'SF':  { line: 10.5, overJuice: +115 },
  'SEA': { line: 10.5, overJuice: -125 },
};

// ==================== POWER RATING CALCULATIONS ====================

/**
 * Calculate Pythagorean win expectation
 * Formula: PF^N / (PF^N + PA^N)
 */
function pythagoreanWinPct(pf, pa, n = PYTH_EXPONENT) {
  if (pf <= 0 || pa <= 0) return 0.5;
  const pfN = Math.pow(pf, n);
  const paN = Math.pow(pa, n);
  return pfN / (pfN + paN);
}

/**
 * Calculate regressed win total for next season
 * Key insight: NFL teams regress ~35% to mean year-over-year
 */
function regressedWins(actualWins, pythagoreanWins, offseasonAdj = 0) {
  // Blend actual and Pythagorean (Pythag is better predictor of future)
  const blendedWins = 0.4 * actualWins + 0.6 * pythagoreanWins;
  
  // Regress toward mean
  const regressedToMean = blendedWins * (1 - REGRESSION_FACTOR) + MEAN_WINS * REGRESSION_FACTOR;
  
  // Apply offseason adjustments (wins scale)
  return regressedToMean + offseasonAdj;
}

/**
 * Generate power ratings for all 32 teams
 */
function generatePowerRatings() {
  const ratings = {};
  
  for (const [abbr, team] of Object.entries(TEAMS)) {
    const games = team.w + team.l;
    const pfG = team.pf / games;
    const paG = team.pa / games;
    
    // Pythagorean win expectation
    const pythWinPct = pythagoreanWinPct(team.pf, team.pa);
    const pythWins = pythWinPct * 17; // 17-game season
    
    // Luck factor: actual wins vs Pythagorean
    const luck = team.w - pythWins;
    
    // Offseason adjustment
    const offAdj = OFFSEASON_ADJUSTMENTS[abbr] || 0;
    
    // Regressed projected wins for next season
    const projWins = regressedWins(team.w, pythWins, offAdj);
    
    // Power rating on 0-100 scale (based on projected wins)
    // 17-0 team = 100, 0-17 team = 0
    const powerRating = Math.max(0, Math.min(100, (projWins / 17) * 100));
    
    // Points per game metrics (regressed)
    const avgPfG = pfG * 0.7 + 22.0 * 0.3; // Regress to league avg (~22 ppg)
    const avgPaG = paG * 0.7 + 22.0 * 0.3; // Regress to league avg
    
    ratings[abbr] = {
      ...team,
      pfG: +pfG.toFixed(1),
      paG: +paG.toFixed(1),
      pythWinPct: +pythWinPct.toFixed(4),
      pythWins: +pythWins.toFixed(1),
      luck: +luck.toFixed(1),
      offseasonAdj: offAdj,
      projWins: +projWins.toFixed(1),
      powerRating: +powerRating.toFixed(1),
      adjPfG: +avgPfG.toFixed(1),
      adjPaG: +avgPaG.toFixed(1),
    };
  }
  
  return ratings;
}

// ==================== GAME PREDICTION ====================

/**
 * Predict a single NFL game
 * Returns spread, win probabilities, total
 */
function predict(away, home, opts = {}) {
  const ratings = generatePowerRatings();
  const awayR = ratings[away];
  const homeR = ratings[home];
  
  if (!awayR || !homeR) {
    return { error: `Unknown team: ${!awayR ? away : home}` };
  }
  
  // Expected points per game (regressed from last season)
  const awayOffense = awayR.adjPfG;
  const awayDefense = awayR.adjPaG;
  const homeOffense = homeR.adjPfG;
  const homeDefense = homeR.adjPaG;
  
  // Expected points: team's offense vs opponent's defense, averaged
  // Then apply HFA
  const leagueAvg = 22.0;
  
  let homeExpPts = ((homeOffense + awayDefense) / 2) + (HFA_POINTS / 2);
  let awayExpPts = ((awayOffense + homeDefense) / 2) - (HFA_POINTS / 2);
  
  // Neutral site adjustment
  if (opts.neutral) {
    homeExpPts -= HFA_POINTS / 2;
    awayExpPts += HFA_POINTS / 2;
  }
  
  // Spread = home expected points - away expected points
  const spread = +(awayExpPts - homeExpPts).toFixed(1);
  
  // Win probability from spread (NFL: ~13pt spread = ~97% win prob)
  const homeWinProb = 1 / (1 + Math.pow(10, spread / SPREAD_TO_PROB_K));
  const awayWinProb = 1 - homeWinProb;
  
  // Total
  const total = +(homeExpPts + awayExpPts).toFixed(1);
  
  return {
    away,
    home,
    spread: +spread.toFixed(1),
    homeWinProb: +homeWinProb.toFixed(4),
    awayWinProb: +awayWinProb.toFixed(4),
    total,
    homeExpPts: +homeExpPts.toFixed(1),
    awayExpPts: +awayExpPts.toFixed(1),
    homeRating: homeR.powerRating,
    awayRating: awayR.powerRating,
    homeProjWins: homeR.projWins,
    awayProjWins: awayR.projWins,
  };
}

// ==================== SEASON SIMULATOR ====================

/**
 * Monte Carlo simulation of 17-game NFL season
 * Models realistic schedule with division, conference, and interleague games
 */
function buildSchedule() {
  const schedule = [];
  const allTeams = Object.keys(TEAMS);
  
  // Division games: 6 per team (2 vs each of 3 division rivals)
  for (const [divName, divTeams] of Object.entries(DIVISIONS)) {
    for (let i = 0; i < divTeams.length; i++) {
      for (let j = i + 1; j < divTeams.length; j++) {
        // Each pair plays twice: once at each venue
        schedule.push({ home: divTeams[i], away: divTeams[j], type: 'division' });
        schedule.push({ home: divTeams[j], away: divTeams[i], type: 'division' });
      }
    }
  }
  
  // Intra-conference (non-division): 4 games vs 1 other division, 1 game vs remaining 2 divisions
  // Simplified: for each team, 4 conference non-division games
  for (const [confName, confDivs] of Object.entries(CONFERENCES)) {
    for (let d1 = 0; d1 < confDivs.length; d1++) {
      for (let d2 = d1 + 1; d2 < confDivs.length; d2++) {
        const div1 = DIVISIONS[confDivs[d1]];
        const div2 = DIVISIONS[confDivs[d2]];
        // Each team in div1 plays ~2 teams from div2 (simplified)
        for (let i = 0; i < div1.length; i++) {
          const opp = div2[i % div2.length];
          schedule.push({ home: div1[i], away: opp, type: 'conference' });
        }
      }
    }
  }
  
  // Interleague: simplified — each team plays ~5 interleague games
  const afcTeams = Object.keys(TEAMS).filter(t => TEAMS[t].conf === 'AFC');
  const nfcTeams = Object.keys(TEAMS).filter(t => TEAMS[t].conf === 'NFC');
  for (let i = 0; i < Math.min(afcTeams.length, nfcTeams.length); i++) {
    schedule.push({ home: afcTeams[i], away: nfcTeams[i], type: 'interleague' });
    schedule.push({ home: nfcTeams[i], away: afcTeams[(i + 4) % afcTeams.length], type: 'interleague' });
  }
  
  return schedule;
}

/**
 * Simulate a single game using binomial model
 */
function simGame(awayR, homeR) {
  // Home win probability based on power ratings
  const awayStr = awayR.projWins / 17;
  const homeStr = homeR.projWins / 17;
  
  // Log5 formula with HFA
  const raw = (homeStr * (1 - awayStr)) / (homeStr * (1 - awayStr) + awayStr * (1 - homeStr));
  const withHFA = raw * HFA_WIN_PROB / (raw * HFA_WIN_PROB + (1 - raw) * (1 - HFA_WIN_PROB));
  
  // Add randomness
  const homeWinProb = Math.max(0.1, Math.min(0.9, withHFA));
  return Math.random() < homeWinProb ? 'home' : 'away';
}

/**
 * Run Monte Carlo season simulation
 */
function simulateSeason(numSims = 10000) {
  const ratings = generatePowerRatings();
  const schedule = buildSchedule();
  
  // Track results
  const teamWins = {};
  const divWinners = {};
  const confChamps = {};
  const sbChamps = {};
  const playoffApps = {};
  const winDistributions = {};
  
  for (const abbr of Object.keys(TEAMS)) {
    teamWins[abbr] = [];
    divWinners[abbr] = 0;
    confChamps[abbr] = 0;
    sbChamps[abbr] = 0;
    playoffApps[abbr] = 0;
    winDistributions[abbr] = new Array(18).fill(0); // 0-17 wins
  }
  
  for (let sim = 0; sim < numSims; sim++) {
    const wins = {};
    for (const abbr of Object.keys(TEAMS)) wins[abbr] = 0;
    
    // Simulate all games
    for (const game of schedule) {
      const result = simGame(ratings[game.away], ratings[game.home]);
      if (result === 'home') wins[game.home]++;
      else wins[game.away]++;
    }
    
    // Normalize wins to 17 games (our schedule approximation may not be exact)
    const teamGames = {};
    for (const game of schedule) {
      teamGames[game.home] = (teamGames[game.home] || 0) + 1;
      teamGames[game.away] = (teamGames[game.away] || 0) + 1;
    }
    for (const abbr of Object.keys(TEAMS)) {
      if (teamGames[abbr] && teamGames[abbr] !== 17) {
        wins[abbr] = Math.round((wins[abbr] / teamGames[abbr]) * 17);
      }
      wins[abbr] = Math.max(0, Math.min(17, wins[abbr]));
    }
    
    // Record wins
    for (const abbr of Object.keys(TEAMS)) {
      teamWins[abbr].push(wins[abbr]);
      winDistributions[abbr][wins[abbr]]++;
    }
    
    // Determine division winners
    for (const [divName, divTeams] of Object.entries(DIVISIONS)) {
      const sorted = [...divTeams].sort((a, b) => wins[b] - wins[a] || Math.random() - 0.5);
      divWinners[sorted[0]]++;
    }
    
    // Determine playoff teams (7 per conference: 4 div winners + 3 WC)
    let simAFCChamp = null, simNFCChamp = null;
    for (const [confName, confDivs] of Object.entries(CONFERENCES)) {
      const confTeams = confDivs.flatMap(d => DIVISIONS[d]);
      
      // Division winners
      const divWins = [];
      for (const divName of confDivs) {
        const divTeams = DIVISIONS[divName];
        const sorted = [...divTeams].sort((a, b) => wins[b] - wins[a] || Math.random() - 0.5);
        divWins.push(sorted[0]);
      }
      
      // Wild card: top 3 non-division-winners by wins
      const remaining = confTeams.filter(t => !divWins.includes(t));
      const wcTeams = remaining.sort((a, b) => wins[b] - wins[a] || Math.random() - 0.5).slice(0, 3);
      
      const playoffTeams = [...divWins, ...wcTeams];
      for (const t of playoffTeams) playoffApps[t]++;
    }
    
    // Determine conference champions and Super Bowl winner per sim
    for (const [confName, confDivs] of Object.entries(CONFERENCES)) {
      const confTeams = confDivs.flatMap(d => DIVISIONS[d]);
      
      // Get all playoff teams for this conference
      const divWins = [];
      for (const divName of confDivs) {
        const divTeamsList = DIVISIONS[divName];
        const sorted = [...divTeamsList].sort((a, b) => wins[b] - wins[a] || Math.random() - 0.5);
        divWins.push(sorted[0]);
      }
      const remaining = confTeams.filter(t => !divWins.includes(t));
      const wcTeams = remaining.sort((a, b) => wins[b] - wins[a] || Math.random() - 0.5).slice(0, 3);
      const playoffTeams = [...divWins, ...wcTeams];
      
      // Simulate single-elimination playoff bracket (simplified: best record wins with randomness)
      let confChamp = playoffTeams[0];
      for (let round = 0; round < 3; round++) {
        // Each round, the champ faces the next-best remaining team
        const opponent = playoffTeams[round + 1] || playoffTeams[0];
        if (opponent && opponent !== confChamp) {
          const champStr = ratings[confChamp]?.projWins || 8.5;
          const oppStr = ratings[opponent]?.projWins || 8.5;
          // Home advantage for higher seed
          const champProb = (champStr * 1.1) / (champStr * 1.1 + oppStr);
          if (Math.random() > champProb) confChamp = opponent;
        }
      }
      
      confChamps[confChamp]++;
      
      // Store for SB matchup
      if (confName === 'AFC') simAFCChamp = confChamp;
      else simNFCChamp = confChamp;
    }
    
    // Super Bowl matchup
    if (simAFCChamp && simNFCChamp) {
      const afcStr = ratings[simAFCChamp]?.projWins || 8.5;
      const nfcStr = ratings[simNFCChamp]?.projWins || 8.5;
      // Neutral site — no HFA
      const prob = afcStr / (afcStr + nfcStr);
      const winner = Math.random() < prob ? simAFCChamp : simNFCChamp;
      sbChamps[winner]++;
    }
  }
  
  // Calculate results
  const results = {};
  for (const [abbr, team] of Object.entries(TEAMS)) {
    const ws = teamWins[abbr];
    const avgWins = ws.reduce((a, b) => a + b, 0) / ws.length;
    const sorted = [...ws].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(numSims * 0.1)];
    const p25 = sorted[Math.floor(numSims * 0.25)];
    const median = sorted[Math.floor(numSims * 0.5)];
    const p75 = sorted[Math.floor(numSims * 0.75)];
    const p90 = sorted[Math.floor(numSims * 0.9)];
    
    // Standard deviation
    const variance = ws.reduce((sum, w) => sum + Math.pow(w - avgWins, 2), 0) / ws.length;
    const stdDev = Math.sqrt(variance);
    
    results[abbr] = {
      ...team,
      projWins: ratings[abbr].projWins,
      simAvgWins: +avgWins.toFixed(1),
      simMedianWins: median,
      simStdDev: +stdDev.toFixed(1),
      p10, p25, median, p75, p90,
      divWinPct: +(divWinners[abbr] / numSims * 100).toFixed(1),
      playoffPct: +(playoffApps[abbr] / numSims * 100).toFixed(1),
      confChampPct: +(confChamps[abbr] / numSims * 100).toFixed(1),
      sbChampPct: +(sbChamps[abbr] / numSims * 100).toFixed(1),
      winDistribution: winDistributions[abbr].map(c => +(c / numSims * 100).toFixed(1)),
    };
  }
  
  return results;
}

// ==================== VALUE DETECTION ====================

/**
 * Calculate Over/Under probability for a given win total line
 */
function calcOverUnderProb(winDistribution, line) {
  // winDistribution[i] = probability of exactly i wins (as percentage)
  let overProb = 0;
  let underProb = 0;
  let pushProb = 0;
  
  const lineFloor = Math.floor(line);
  const isHalf = line % 1 !== 0;
  
  for (let i = 0; i <= 17; i++) {
    const prob = winDistribution[i] / 100;
    if (isHalf) {
      if (i > line) overProb += prob;
      else underProb += prob;
    } else {
      if (i > line) overProb += prob;
      else if (i < line) underProb += prob;
      else pushProb += prob;
    }
  }
  
  return { overProb, underProb, pushProb };
}

/**
 * Convert American odds to implied probability
 */
function oddsToProb(americanOdds) {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

/**
 * Convert probability to American odds
 */
function probToOdds(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Find value bets in win totals market
 */
function findWinTotalValue(simResults) {
  const valueBets = [];
  
  for (const [abbr, result] of Object.entries(simResults)) {
    const market = MARKET_LINES[abbr];
    if (!market) continue;
    
    const { overProb, underProb } = calcOverUnderProb(result.winDistribution, market.line);
    
    // Implied prob from juice (assume -110 on the other side if not specified)
    const overImplied = oddsToProb(market.overJuice);
    const underImplied = 1 - overImplied + 0.04; // ~4% vig total
    
    const overEdge = overProb - overImplied;
    const underEdge = underProb - underImplied;
    
    // Determine best bet
    const bestSide = overEdge > underEdge ? 'OVER' : 'UNDER';
    const bestEdge = Math.max(overEdge, underEdge);
    const bestProb = bestSide === 'OVER' ? overProb : underProb;
    
    if (bestEdge > 0.02) { // 2%+ edge threshold
      const fairOdds = probToOdds(bestProb);
      
      valueBets.push({
        team: abbr,
        name: result.name,
        line: market.line,
        side: bestSide,
        modelProb: +(bestProb * 100).toFixed(1),
        impliedProb: +(bestSide === 'OVER' ? overImplied : underImplied) * 100,
        edge: +(bestEdge * 100).toFixed(1),
        fairOdds,
        simAvgWins: result.simAvgWins,
        projWins: result.projWins,
        confidence: bestEdge > 0.1 ? 'HIGH' : bestEdge > 0.05 ? 'MEDIUM' : 'LOW',
        overProb: +(overProb * 100).toFixed(1),
        underProb: +(underProb * 100).toFixed(1),
      });
    }
  }
  
  // Sort by edge
  valueBets.sort((a, b) => b.edge - a.edge);
  return valueBets;
}

// ==================== EXPORTS ====================

module.exports = {
  TEAMS,
  DIVISIONS,
  CONFERENCES,
  MARKET_LINES,
  OFFSEASON_ADJUSTMENTS,
  pythagoreanWinPct,
  regressedWins,
  generatePowerRatings,
  predict,
  buildSchedule,
  simulateSeason,
  calcOverUnderProb,
  findWinTotalValue,
  oddsToProb,
  probToOdds,
};
