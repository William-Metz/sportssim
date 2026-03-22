/**
 * MLB Season Simulator — SportsSim v35.0
 * =======================================
 * Monte Carlo simulation of full 162-game MLB season.
 * Uses our team power ratings + pitcher model to generate:
 *   - Win total distributions for all 30 teams
 *   - Division winner probabilities
 *   - Playoff probabilities (top 3 + 3 WC per league)
 *   - World Series champion probabilities
 * 
 * KEY BETTING APPLICATION:
 *   - Compare simulated win totals vs DraftKings/FanDuel O/U lines
 *   - Find +EV season win total bets (best futures market)
 *   - Division winner futures mispriced by public perception
 *   - Pennant + WS futures for deep value
 * 
 * MLB futures markets are SOFT early in the season because:
 *   1. Public overreacts to spring training / offseason hype
 *   2. Regression to mean is underpriced (bad teams win 65+, good teams lose 65+)
 *   3. Injury/depth factors aren't fully priced in
 *   4. Our Statcast + preseason tuning data gives us an edge
 */

const path = require('path');

// Import models
let mlb, mlbPitchers, statcastService, preseasonTuning;
try { mlb = require('../models/mlb'); } catch (e) {}
try { mlbPitchers = require('../models/mlb-pitchers'); } catch (e) {}
try { statcastService = require('./statcast'); } catch (e) {}
try { preseasonTuning = require('./preseason-tuning'); } catch (e) {}

// ==================== MLB STRUCTURE ====================

const DIVISIONS = {
  'AL East': ['NYY', 'BAL', 'BOS', 'TOR', 'TB'],
  'AL Central': ['CLE', 'KC', 'DET', 'MIN', 'CWS'],
  'AL West': ['HOU', 'SEA', 'TEX', 'LAA', 'OAK'],
  'NL East': ['ATL', 'PHI', 'NYM', 'WSH', 'MIA'],
  'NL Central': ['MIL', 'CHC', 'STL', 'PIT', 'CIN'],
  'NL West': ['LAD', 'SD', 'ARI', 'SF', 'COL'],
};

const LEAGUES = {
  'AL': ['AL East', 'AL Central', 'AL West'],
  'NL': ['NL East', 'NL Central', 'NL West'],
};

// Team schedules — simplified: each team plays 162 games
// Breakdown: 52 vs division (13 each), 64 vs same-league non-div (6-7 each), 46 interleague
// For simulation we approximate matchup distributions
function buildSchedule() {
  const schedule = [];
  const teams = Object.values(DIVISIONS).flat();
  
  // For each team, build their 162-game schedule
  // Division rivals: 13 games each (52 total)
  // Same league non-div: ~6.4 games each (64 total)
  // Interleague: ~3.1 games each (46 total)
  
  for (const [divName, divTeams] of Object.entries(DIVISIONS)) {
    // Intra-division: each pair plays 13 games (split ~7H/6A or 6H/7A)
    for (let i = 0; i < divTeams.length; i++) {
      for (let j = i + 1; j < divTeams.length; j++) {
        // 13 games: 7 at one park, 6 at the other (alternate years)
        for (let g = 0; g < 7; g++) {
          schedule.push({ home: divTeams[i], away: divTeams[j], type: 'division' });
        }
        for (let g = 0; g < 6; g++) {
          schedule.push({ home: divTeams[j], away: divTeams[i], type: 'division' });
        }
      }
    }
  }
  
  // Same league, different division: ~6-7 games each pair
  for (const [league, divisions] of Object.entries(LEAGUES)) {
    for (let d1 = 0; d1 < divisions.length; d1++) {
      for (let d2 = d1 + 1; d2 < divisions.length; d2++) {
        const div1Teams = DIVISIONS[divisions[d1]];
        const div2Teams = DIVISIONS[divisions[d2]];
        for (const t1 of div1Teams) {
          for (const t2 of div2Teams) {
            // ~6.4 games: alternate 3H/3A or 4H/3A
            for (let g = 0; g < 3; g++) {
              schedule.push({ home: t1, away: t2, type: 'league' });
            }
            for (let g = 0; g < 3; g++) {
              schedule.push({ home: t2, away: t1, type: 'league' });
            }
          }
        }
      }
    }
  }
  
  // Interleague: ~3 games vs each team in the other league
  const alTeams = LEAGUES['AL'].flatMap(d => DIVISIONS[d]);
  const nlTeams = LEAGUES['NL'].flatMap(d => DIVISIONS[d]);
  for (const al of alTeams) {
    for (const nl of nlTeams) {
      // ~3 games, split home/away
      schedule.push({ home: al, away: nl, type: 'interleague' });
      schedule.push({ home: nl, away: al, type: 'interleague' });
    }
  }
  
  return schedule;
}

// ==================== TEAM STRENGTH ====================

/**
 * Get team true talent win probability vs league average.
 * Uses Pythagorean expectation from our power ratings.
 * Returns { abbr: trueWinPct } for all 30 teams.
 */
function getTeamStrengths() {
  const teams = mlb ? mlb.getTeams() : {};
  const strengths = {};
  const PYTH_EXP = 1.83;
  
  for (const [abbr, team] of Object.entries(teams)) {
    const rsG = team.rsG || 4.5;
    const raG = team.raG || 4.5;
    
    // Pythagorean win expectation
    let pyth = Math.pow(rsG, PYTH_EXP) / (Math.pow(rsG, PYTH_EXP) + Math.pow(raG, PYTH_EXP));
    
    // Preseason regression (first 2-3 weeks, projections revert ~35% to .500)
    // As games are played this gets less aggressive
    const preseasonRegression = 0.20; // lighter now that we trust our model
    pyth = pyth * (1 - preseasonRegression) + 0.5 * preseasonRegression;
    
    // Apply preseason tuning if available (spring training signals, roster changes)
    if (preseasonTuning) {
      try {
        const tuning = preseasonTuning.getTeamAdjustment(abbr);
        if (tuning && tuning.offAdj) {
          // Convert run adjustments to win pct adjustment
          // Rough: 10 runs ≈ 1 win over 162 games ≈ 0.006 win pct
          const runAdj = (tuning.offAdj - tuning.defAdj) * 162;
          const winAdj = runAdj * 0.006;
          pyth = Math.max(0.25, Math.min(0.75, pyth + winAdj));
        }
      } catch (e) {}
    }
    
    // Statcast-based adjustment: teams with Statcast xRuns >> actual runs will regress UP
    if (statcastService) {
      try {
        const teamStatcast = statcastService.getTeamStatcast(abbr);
        if (teamStatcast && teamStatcast.xRunDiff) {
          // xRunDiff = expected runs - actual runs. Positive = underperforming (likely to improve)
          const statcastAdj = teamStatcast.xRunDiff * 0.003; // conservative
          pyth = Math.max(0.25, Math.min(0.75, pyth + statcastAdj));
        }
      } catch (e) {}
    }
    
    strengths[abbr] = {
      winPct: +pyth.toFixed(4),
      rsG: rsG,
      raG: raG,
      projectedWins: Math.round(pyth * 162),
      projectedLosses: 162 - Math.round(pyth * 162),
      name: team.name || abbr,
    };
  }
  
  return strengths;
}

// ==================== GAME SIMULATION ====================

/**
 * Simulate a single game between two teams.
 * Uses log5 method to combine team true talent levels.
 * 
 * @param {number} homeWinPct - Home team's true talent win%
 * @param {number} awayWinPct - Away team's true talent win%
 * @param {number} hca - Home court advantage in win% (default 0.04 = ~54% home)
 * @returns {boolean} true if home team wins
 */
function simulateGame(homeWinPct, awayWinPct, hca = 0.04) {
  // Log5 formula: P(A beats B) = (pA * (1 - pB)) / (pA * (1 - pB) + pB * (1 - pA))
  // Adjusted for home advantage
  const adjHome = Math.min(0.85, homeWinPct + hca / 2);
  const adjAway = Math.max(0.15, awayWinPct - hca / 2);
  
  const homeProb = (adjHome * (1 - adjAway)) / (adjHome * (1 - adjAway) + adjAway * (1 - adjHome));
  
  return Math.random() < homeProb;
}

// ==================== SEASON SIMULATION ====================

/**
 * Simulate one full MLB season.
 * Returns win totals for all 30 teams.
 */
function simulateSeason(strengths, schedule) {
  const records = {};
  for (const abbr of Object.keys(strengths)) {
    records[abbr] = { wins: 0, losses: 0 };
  }
  
  for (const game of schedule) {
    if (!strengths[game.home] || !strengths[game.away]) continue;
    
    const homeStrength = strengths[game.home].winPct;
    const awayStrength = strengths[game.away].winPct;
    
    // Division games have slightly more variance (familiarity, intensity)
    const hca = game.type === 'division' ? 0.035 : 0.04;
    
    const homeWins = simulateGame(homeStrength, awayStrength, hca);
    
    if (homeWins) {
      records[game.home].wins++;
      records[game.away].losses++;
    } else {
      records[game.away].wins++;
      records[game.home].losses++;
    }
  }
  
  // Normalize to 162 games (schedule may not be exactly 162 per team due to simplification)
  for (const [abbr, rec] of Object.entries(records)) {
    const totalGames = rec.wins + rec.losses;
    if (totalGames !== 162 && totalGames > 0) {
      const factor = 162 / totalGames;
      rec.wins = Math.round(rec.wins * factor);
      rec.losses = 162 - rec.wins;
    }
  }
  
  return records;
}

/**
 * Determine playoff teams from season results.
 * MLB 2024+ format: 3 division winners + 3 wild cards per league = 6 per league
 */
function determinePlayoffs(records) {
  const result = { AL: { divWinners: [], wildcards: [], allPlayoff: [] }, NL: { divWinners: [], wildcards: [], allPlayoff: [] } };
  
  for (const [league, divisions] of Object.entries(LEAGUES)) {
    const divWinners = [];
    const nonWinners = [];
    
    for (const divName of divisions) {
      const divTeams = DIVISIONS[divName].map(abbr => ({
        abbr,
        wins: records[abbr]?.wins || 0,
        losses: records[abbr]?.losses || 0,
      }));
      
      divTeams.sort((a, b) => b.wins - a.wins);
      divWinners.push({ ...divTeams[0], division: divName });
      nonWinners.push(...divTeams.slice(1));
    }
    
    // Sort division winners by record for seeding
    divWinners.sort((a, b) => b.wins - a.wins);
    result[league].divWinners = divWinners;
    
    // Wild cards: top 3 non-division-winners by record
    nonWinners.sort((a, b) => b.wins - a.wins);
    result[league].wildcards = nonWinners.slice(0, 3);
    
    result[league].allPlayoff = [...divWinners, ...nonWinners.slice(0, 3)];
  }
  
  return result;
}

/**
 * Simulate playoff bracket to determine champion.
 * WC Round (best of 3): 3v6, 4v5
 * DS (best of 5): 1v(4/5), 2v(3/6)
 * CS (best of 7): DS winners
 * WS (best of 7): AL champ vs NL champ
 */
function simulatePlayoffs(playoffTeams, strengths) {
  function simSeries(team1, team2, bestOf) {
    const winsNeeded = Math.ceil(bestOf / 2);
    let t1Wins = 0, t2Wins = 0;
    const s1 = strengths[team1]?.winPct || 0.5;
    const s2 = strengths[team2]?.winPct || 0.5;
    
    // Playoff HCA is smaller (~52-53%)
    const playoffHCA = 0.025;
    
    while (t1Wins < winsNeeded && t2Wins < winsNeeded) {
      // team1 is higher seed = home advantage
      const homeWins = simulateGame(s1, s2, playoffHCA);
      if (homeWins) t1Wins++;
      else t2Wins++;
    }
    
    return t1Wins > t2Wins ? team1 : team2;
  }
  
  const results = { alChamp: null, nlChamp: null, wsChamp: null };
  
  for (const league of ['AL', 'NL']) {
    const teams = playoffTeams[league];
    if (teams.allPlayoff.length < 6) continue;
    
    const seed1 = teams.divWinners[0]?.abbr;
    const seed2 = teams.divWinners[1]?.abbr;
    const seed3 = teams.divWinners[2]?.abbr;
    const seed4 = teams.wildcards[0]?.abbr;
    const seed5 = teams.wildcards[1]?.abbr;
    const seed6 = teams.wildcards[2]?.abbr;
    
    if (!seed1 || !seed6) continue;
    
    // Wild Card Round (best of 3)
    const wc1Winner = simSeries(seed3, seed6, 3); // 3 vs 6
    const wc2Winner = simSeries(seed4, seed5, 3); // 4 vs 5
    
    // Division Series (best of 5)
    const ds1Winner = simSeries(seed1, wc2Winner, 5); // 1 vs 4/5
    const ds2Winner = simSeries(seed2, wc1Winner, 5); // 2 vs 3/6
    
    // Championship Series (best of 7)
    const csWinner = simSeries(ds1Winner, ds2Winner, 7);
    
    if (league === 'AL') results.alChamp = csWinner;
    else results.nlChamp = csWinner;
  }
  
  // World Series (best of 7)
  if (results.alChamp && results.nlChamp) {
    results.wsChamp = simulateGame(
      strengths[results.alChamp]?.winPct || 0.5,
      strengths[results.nlChamp]?.winPct || 0.5,
      0.01 // minimal HCA in WS (alternating)
    ) ? results.alChamp : results.nlChamp;
    
    // Actually do a proper 7-game sim
    let alWins = 0, nlWins = 0;
    const s1 = strengths[results.alChamp]?.winPct || 0.5;
    const s2 = strengths[results.nlChamp]?.winPct || 0.5;
    while (alWins < 4 && nlWins < 4) {
      const hca = 0.015; // Tiny HCA alternates but we simplify
      if (simulateGame(s1, s2, hca)) alWins++;
      else nlWins++;
    }
    results.wsChamp = alWins >= 4 ? results.alChamp : results.nlChamp;
  }
  
  return results;
}

// ==================== MONTE CARLO SEASON SIMULATION ====================

/**
 * Run N season simulations and aggregate results.
 * Returns probability distributions for wins, playoffs, division, pennant, WS.
 */
function runSimulation(numSims = 10000) {
  const strengths = getTeamStrengths();
  const schedule = buildSchedule();
  
  if (Object.keys(strengths).length < 25) {
    return { error: 'Not enough team data loaded', teams: Object.keys(strengths).length };
  }
  
  // Accumulators
  const winTotals = {};     // { abbr: [win counts per sim] }
  const divWins = {};       // { abbr: count }
  const playoffAppearances = {}; // { abbr: count }
  const pennants = {};      // { abbr: count }
  const wsWins = {};        // { abbr: count }
  
  for (const abbr of Object.keys(strengths)) {
    winTotals[abbr] = [];
    divWins[abbr] = 0;
    playoffAppearances[abbr] = 0;
    pennants[abbr] = 0;
    wsWins[abbr] = 0;
  }
  
  for (let sim = 0; sim < numSims; sim++) {
    // Simulate full season
    const records = simulateSeason(strengths, schedule);
    
    // Record win totals
    for (const [abbr, rec] of Object.entries(records)) {
      if (winTotals[abbr]) winTotals[abbr].push(rec.wins);
    }
    
    // Determine playoffs
    const playoffs = determinePlayoffs(records);
    
    // Record division winners
    for (const league of ['AL', 'NL']) {
      for (const dw of playoffs[league].divWinners) {
        if (divWins[dw.abbr] !== undefined) divWins[dw.abbr]++;
      }
      for (const pt of playoffs[league].allPlayoff) {
        if (playoffAppearances[pt.abbr] !== undefined) playoffAppearances[pt.abbr]++;
      }
    }
    
    // Simulate playoffs
    const playoffResult = simulatePlayoffs(playoffs, strengths);
    
    if (playoffResult.alChamp && pennants[playoffResult.alChamp] !== undefined) {
      pennants[playoffResult.alChamp]++;
    }
    if (playoffResult.nlChamp && pennants[playoffResult.nlChamp] !== undefined) {
      pennants[playoffResult.nlChamp]++;
    }
    if (playoffResult.wsChamp && wsWins[playoffResult.wsChamp] !== undefined) {
      wsWins[playoffResult.wsChamp]++;
    }
  }
  
  // Build results
  const teamResults = {};
  for (const [abbr, wins] of Object.entries(winTotals)) {
    if (wins.length === 0) continue;
    
    const sorted = [...wins].sort((a, b) => a - b);
    const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
    const variance = wins.reduce((sum, w) => sum + Math.pow(w - mean, 2), 0) / wins.length;
    const stdDev = Math.sqrt(variance);
    
    // Win distribution histogram
    const histogram = {};
    for (const w of wins) {
      histogram[w] = (histogram[w] || 0) + 1;
    }
    
    // O/U probabilities for common lines
    const ouProbs = {};
    for (let line = 60; line <= 105; line += 0.5) {
      const over = wins.filter(w => w > line).length / wins.length;
      const under = wins.filter(w => w < line).length / wins.length;
      const push = wins.filter(w => w === line).length / wins.length;
      if (line % 1 === 0.5 || (line >= mean - 10 && line <= mean + 10)) {
        ouProbs[line] = {
          over: +over.toFixed(4),
          under: +under.toFixed(4),
          push: +push.toFixed(4),
        };
      }
    }
    
    teamResults[abbr] = {
      name: strengths[abbr]?.name || abbr,
      trueWinPct: strengths[abbr]?.winPct || 0.5,
      meanWins: +mean.toFixed(1),
      stdDev: +stdDev.toFixed(1),
      median: sorted[Math.floor(sorted.length / 2)],
      p10: sorted[Math.floor(sorted.length * 0.10)],
      p25: sorted[Math.floor(sorted.length * 0.25)],
      p75: sorted[Math.floor(sorted.length * 0.75)],
      p90: sorted[Math.floor(sorted.length * 0.90)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      playoffPct: +(playoffAppearances[abbr] / numSims * 100).toFixed(1),
      divisionPct: +(divWins[abbr] / numSims * 100).toFixed(1),
      pennantPct: +(pennants[abbr] / numSims * 100).toFixed(1),
      wsPct: +(wsWins[abbr] / numSims * 100).toFixed(1),
      ouProbs,
    };
  }
  
  return {
    simulations: numSims,
    timestamp: new Date().toISOString(),
    teams: teamResults,
    strengths,
  };
}

// ==================== FUTURES VALUE SCANNER ====================

// DraftKings 2026 MLB Win Totals (pre-Opening Day lines — updated March 22)
// These are O/U lines with -110 juice on both sides unless noted
const DK_WIN_TOTALS = {
  'LAD': { line: 97.5, overML: -115, underML: -105 },
  'ATL': { line: 91.5, overML: -110, underML: -110 },
  'NYY': { line: 90.5, overML: -105, underML: -115 },
  'PHI': { line: 89.5, overML: -110, underML: -110 },
  'BAL': { line: 88.5, overML: -110, underML: -110 },
  'HOU': { line: 87.5, overML: -110, underML: -110 },
  'SD':  { line: 86.5, overML: -110, underML: -110 },
  'BOS': { line: 85.5, overML: -110, underML: -110 },
  'SEA': { line: 84.5, overML: -115, underML: -105 },
  'NYM': { line: 84.5, overML: -105, underML: -115 },
  'MIL': { line: 84.5, overML: -110, underML: -110 },
  'DET': { line: 83.5, overML: -110, underML: -110 },
  'CLE': { line: 82.5, overML: -110, underML: -110 },
  'TEX': { line: 82.5, overML: -110, underML: -110 },
  'MIN': { line: 81.5, overML: -110, underML: -110 },
  'CHC': { line: 81.5, overML: -110, underML: -110 },
  'ARI': { line: 80.5, overML: -110, underML: -110 },
  'TOR': { line: 79.5, overML: -110, underML: -110 },
  'SF':  { line: 78.5, overML: -110, underML: -110 },
  'KC':  { line: 78.5, overML: -110, underML: -110 },
  'STL': { line: 77.5, overML: -110, underML: -110 },
  'CIN': { line: 76.5, overML: -110, underML: -110 },
  'TB':  { line: 76.5, overML: -105, underML: -115 },
  'PIT': { line: 74.5, overML: -110, underML: -110 },
  'LAA': { line: 72.5, overML: -110, underML: -110 },
  'WSH': { line: 70.5, overML: -110, underML: -110 },
  'MIA': { line: 66.5, overML: -110, underML: -110 },
  'OAK': { line: 63.5, overML: -105, underML: -115 },
  'COL': { line: 62.5, overML: -110, underML: -110 },
  'CWS': { line: 58.5, overML: -110, underML: -110 },
};

// DraftKings Division Winner odds (American odds)
const DK_DIVISION_ODDS = {
  'AL East': { 'BAL': -110, 'NYY': 250, 'BOS': 350, 'TOR': 1200, 'TB': 2500 },
  'AL Central': { 'CLE': 140, 'DET': 200, 'MIN': 350, 'KC': 600, 'CWS': 10000 },
  'AL West': { 'HOU': -130, 'SEA': 250, 'TEX': 350, 'LAA': 2000, 'OAK': 5000 },
  'NL East': { 'ATL': -110, 'PHI': 170, 'NYM': 400, 'WSH': 3000, 'MIA': 8000 },
  'NL Central': { 'MIL': 120, 'CHC': 200, 'STL': 500, 'PIT': 1200, 'CIN': 1500 },
  'NL West': { 'LAD': -250, 'SD': 350, 'ARI': 600, 'SF': 1200, 'COL': 10000 },
};

// DraftKings World Series odds
const DK_WS_ODDS = {
  'LAD': 400, 'ATL': 800, 'NYY': 900, 'PHI': 1000, 'BAL': 1100,
  'HOU': 1200, 'SD': 1400, 'BOS': 1800, 'NYM': 2000, 'SEA': 2000,
  'MIL': 2200, 'DET': 2500, 'CLE': 2500, 'TEX': 3000, 'MIN': 3500,
  'CHC': 3500, 'ARI': 4000, 'TOR': 5000, 'SF': 6000, 'KC': 6000,
  'CIN': 8000, 'STL': 8000, 'TB': 8000, 'PIT': 10000, 'LAA': 15000,
  'WSH': 20000, 'MIA': 25000, 'OAK': 30000, 'COL': 30000, 'CWS': 50000,
};

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Find value in win total futures.
 * Compares our simulated O/U probabilities against DK lines.
 */
function findWinTotalValue(simResults) {
  const valueBets = [];
  
  for (const [abbr, dk] of Object.entries(DK_WIN_TOTALS)) {
    const team = simResults.teams[abbr];
    if (!team) continue;
    
    const line = dk.line;
    
    // Find the closest O/U line in our sim
    const ouProbs = team.ouProbs[line] || team.ouProbs[Math.floor(line)] || null;
    
    // Calculate from raw data if not in ouProbs
    let overProb, underProb;
    if (ouProbs) {
      overProb = ouProbs.over;
      underProb = ouProbs.under;
    } else {
      // Interpolate from mean and stdDev using normal approximation
      const z = (line - team.meanWins) / (team.stdDev || 8);
      overProb = 1 - normalCDF(z);
      underProb = normalCDF(z);
    }
    
    // Book implied probabilities (remove vig)
    const bookOverProb = mlToProb(dk.overML);
    const bookUnderProb = mlToProb(dk.underML);
    const totalVig = bookOverProb + bookUnderProb;
    const bookOverNoVig = bookOverProb / totalVig;
    const bookUnderNoVig = bookUnderProb / totalVig;
    
    // Edge calculation
    const overEdge = overProb - bookOverNoVig;
    const underEdge = underProb - bookUnderNoVig;
    
    // Kelly sizing
    function kellyFraction(prob, ml) {
      const payout = ml > 0 ? ml / 100 : 100 / (-ml);
      const f = (prob * payout - (1 - prob)) / payout;
      return Math.max(0, f);
    }
    
    const overKelly = kellyFraction(overProb, dk.overML);
    const underKelly = kellyFraction(underProb, dk.underML);
    
    if (overEdge > 0.02) {
      valueBets.push({
        team: abbr,
        name: team.name,
        bet: `OVER ${line}`,
        line,
        odds: dk.overML,
        modelProb: +overProb.toFixed(4),
        bookProb: +bookOverNoVig.toFixed(4),
        edge: +(overEdge * 100).toFixed(1),
        kelly: +(overKelly * 100).toFixed(1),
        halfKelly: +(overKelly * 50).toFixed(1),
        meanWins: team.meanWins,
        winDiff: +(team.meanWins - line).toFixed(1),
        confidence: overEdge > 0.08 ? 'HIGH' : overEdge > 0.04 ? 'MEDIUM' : 'LOW',
        reasoning: `Model projects ${team.meanWins} wins (${team.meanWins > line ? '+' : ''}${(team.meanWins - line).toFixed(1)} from line). ${(overProb * 100).toFixed(0)}% sim probability of over.`,
      });
    }
    
    if (underEdge > 0.02) {
      valueBets.push({
        team: abbr,
        name: team.name,
        bet: `UNDER ${line}`,
        line,
        odds: dk.underML,
        modelProb: +underProb.toFixed(4),
        bookProb: +bookUnderNoVig.toFixed(4),
        edge: +(underEdge * 100).toFixed(1),
        kelly: +(underKelly * 100).toFixed(1),
        halfKelly: +(underKelly * 50).toFixed(1),
        meanWins: team.meanWins,
        winDiff: +(team.meanWins - line).toFixed(1),
        confidence: underEdge > 0.08 ? 'HIGH' : underEdge > 0.04 ? 'MEDIUM' : 'LOW',
        reasoning: `Model projects ${team.meanWins} wins (${(line - team.meanWins).toFixed(1)} below line). ${(underProb * 100).toFixed(0)}% sim probability of under.`,
      });
    }
  }
  
  valueBets.sort((a, b) => b.edge - a.edge);
  return valueBets;
}

/**
 * Find value in division winner futures.
 */
function findDivisionValue(simResults) {
  const valueBets = [];
  
  for (const [divName, odds] of Object.entries(DK_DIVISION_ODDS)) {
    for (const [abbr, ml] of Object.entries(odds)) {
      const team = simResults.teams[abbr];
      if (!team) continue;
      
      const modelProb = team.divisionPct / 100;
      const bookProb = mlToProb(ml);
      const edge = modelProb - bookProb;
      
      if (edge > 0.02) {
        const payout = ml > 0 ? ml / 100 : 100 / (-ml);
        const kelly = Math.max(0, (modelProb * payout - (1 - modelProb)) / payout);
        
        valueBets.push({
          team: abbr,
          name: team.name,
          division: divName,
          bet: `${abbr} to win ${divName}`,
          odds: ml,
          modelProb: +modelProb.toFixed(4),
          bookProb: +bookProb.toFixed(4),
          edge: +(edge * 100).toFixed(1),
          kelly: +(kelly * 100).toFixed(1),
          halfKelly: +(kelly * 50).toFixed(1),
          divisionPct: team.divisionPct,
          confidence: edge > 0.08 ? 'HIGH' : edge > 0.04 ? 'MEDIUM' : 'LOW',
        });
      }
    }
  }
  
  valueBets.sort((a, b) => b.edge - a.edge);
  return valueBets;
}

/**
 * Find value in World Series futures.
 */
function findWSValue(simResults) {
  const valueBets = [];
  
  for (const [abbr, ml] of Object.entries(DK_WS_ODDS)) {
    const team = simResults.teams[abbr];
    if (!team) continue;
    
    const modelProb = team.wsPct / 100;
    const bookProb = mlToProb(ml);
    const edge = modelProb - bookProb;
    
    if (edge > 0.005) {
      const payout = ml / 100;
      const kelly = Math.max(0, (modelProb * payout - (1 - modelProb)) / payout);
      
      valueBets.push({
        team: abbr,
        name: team.name,
        bet: `${abbr} to win World Series`,
        odds: ml > 0 ? `+${ml}` : `${ml}`,
        oddsNum: ml,
        modelProb: +modelProb.toFixed(4),
        bookProb: +bookProb.toFixed(4),
        edge: +(edge * 100).toFixed(1),
        kelly: +(kelly * 100).toFixed(2),
        halfKelly: +(kelly * 50).toFixed(2),
        wsPct: team.wsPct,
        playoffPct: team.playoffPct,
        confidence: edge > 0.03 ? 'HIGH' : edge > 0.01 ? 'MEDIUM' : 'LOW',
      });
    }
  }
  
  valueBets.sort((a, b) => b.edge - a.edge);
  return valueBets;
}

// Normal CDF approximation
function normalCDF(z) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

// ==================== COMPREHENSIVE REPORT ====================

/**
 * Run full simulation and produce comprehensive futures value report.
 */
function generateReport(numSims = 10000) {
  const simResults = runSimulation(numSims);
  
  if (simResults.error) return simResults;
  
  const winTotalValue = findWinTotalValue(simResults);
  const divisionValue = findDivisionValue(simResults);
  const wsValue = findWSValue(simResults);
  
  // Build power rankings from sim results
  const powerRankings = Object.entries(simResults.teams)
    .map(([abbr, team]) => ({
      rank: 0,
      team: abbr,
      name: team.name,
      projWins: team.meanWins,
      projLosses: +(162 - team.meanWins).toFixed(1),
      stdDev: team.stdDev,
      range: `${team.p10}-${team.p90}`,
      playoffPct: team.playoffPct,
      divisionPct: team.divisionPct,
      pennantPct: team.pennantPct,
      wsPct: team.wsPct,
    }))
    .sort((a, b) => b.projWins - a.projWins);
  
  powerRankings.forEach((t, i) => { t.rank = i + 1; });
  
  // Division projections
  const divProjections = {};
  for (const [divName, teams] of Object.entries(DIVISIONS)) {
    divProjections[divName] = teams.map(abbr => {
      const team = simResults.teams[abbr];
      return {
        team: abbr,
        name: team?.name || abbr,
        projWins: team?.meanWins || 0,
        divisionPct: team?.divisionPct || 0,
        playoffPct: team?.playoffPct || 0,
      };
    }).sort((a, b) => b.projWins - a.projWins);
  }
  
  return {
    title: 'MLB 2026 Season Simulation — Futures Value Report 🦞💰',
    simulations: numSims,
    timestamp: new Date().toISOString(),
    daysToOpeningDay: Math.ceil((new Date('2026-03-26') - new Date()) / (1000 * 60 * 60 * 24)),
    
    // Top value bets across all markets
    topValueBets: [
      ...winTotalValue.filter(b => b.edge >= 3).map(b => ({ ...b, market: 'Win Total' })),
      ...divisionValue.filter(b => b.edge >= 3).map(b => ({ ...b, market: 'Division Winner' })),
      ...wsValue.filter(b => b.edge >= 1).map(b => ({ ...b, market: 'World Series' })),
    ].sort((a, b) => b.edge - a.edge).slice(0, 20),
    
    winTotalValue: {
      count: winTotalValue.length,
      highConfidence: winTotalValue.filter(b => b.confidence === 'HIGH').length,
      bets: winTotalValue,
    },
    
    divisionValue: {
      count: divisionValue.length,
      bets: divisionValue,
    },
    
    wsValue: {
      count: wsValue.length,
      bets: wsValue,
    },
    
    powerRankings: powerRankings.slice(0, 30),
    divProjections,
    
    methodology: {
      sims: numSims,
      model: 'Pythagorean + Statcast + Preseason Tuning + Log5 matchups',
      schedule: 'Approximate 162-game schedule with proper division/league/interleague splits',
      playoffs: 'Full bracket simulation (WC round BO3, DS BO5, CS BO7, WS BO7)',
      hca: '~54% home win rate (historical MLB average)',
      regression: '20% regression to .500 for preseason uncertainty',
      oddsSource: 'DraftKings (pre-Opening Day)',
    },
  };
}

// ==================== API EXPORTS ====================

module.exports = {
  runSimulation,
  generateReport,
  findWinTotalValue,
  findDivisionValue,
  findWSValue,
  getTeamStrengths,
  DK_WIN_TOTALS,
  DK_DIVISION_ODDS,
  DK_WS_ODDS,
  DIVISIONS,
  LEAGUES,
};
