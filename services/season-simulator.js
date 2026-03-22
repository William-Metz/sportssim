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

// FanGraphs 2026 Depth Charts projected wins — independent validation source
// Updated 2026-03-22 from fangraphs.com/depthcharts.aspx?position=Standings
const FANGRAPHS_PROJ = {
  'LAD': 96, 'NYM': 88, 'ATL': 88, 'SEA': 88, 'NYY': 87, 'PHI': 87,
  'BOS': 86, 'DET': 86, 'TOR': 86, 'CHC': 85, 'BAL': 84, 'PIT': 83,
  'SF': 81, 'TB': 81, 'MIL': 81, 'ARI': 81, 'TEX': 81, 'KC': 81,
  'HOU': 81, 'OAK': 80, 'SD': 79, 'MIN': 79, 'CIN': 77, 'CLE': 76,
  'STL': 75, 'MIA': 75, 'LAA': 74, 'CWS': 69, 'WSH': 69, 'COL': 66,
};

// FanGraphs 2026 Depth Charts projected RS/G and RA/G per team
// These use ZiPS+Steamer player-level projections → independent of our model
// Source: fangraphs.com/depthcharts.aspx?position=Standings (updated 2026-03-22)
const FANGRAPHS_RS_RA = {
  'LAD': { rsG: 5.17, raG: 4.22 }, 'NYM': { rsG: 4.74, raG: 4.31 },
  'ATL': { rsG: 4.73, raG: 4.31 }, 'SEA': { rsG: 4.49, raG: 4.10 },
  'NYY': { rsG: 4.71, raG: 4.34 }, 'PHI': { rsG: 4.72, raG: 4.37 },
  'BOS': { rsG: 4.55, raG: 4.27 }, 'DET': { rsG: 4.49, raG: 4.21 },
  'TOR': { rsG: 4.64, raG: 4.36 }, 'CHC': { rsG: 4.62, raG: 4.41 },
  'BAL': { rsG: 4.82, raG: 4.61 }, 'PIT': { rsG: 4.44, raG: 4.35 },
  'SF':  { rsG: 4.43, raG: 4.40 }, 'TB':  { rsG: 4.31, raG: 4.30 },
  'MIL': { rsG: 4.41, raG: 4.40 }, 'ARI': { rsG: 4.54, raG: 4.53 },
  'TEX': { rsG: 4.44, raG: 4.43 }, 'KC':  { rsG: 4.51, raG: 4.53 },
  'HOU': { rsG: 4.56, raG: 4.57 }, 'OAK': { rsG: 4.73, raG: 4.81 },
  'SD':  { rsG: 4.45, raG: 4.55 }, 'MIN': { rsG: 4.47, raG: 4.61 },
  'CIN': { rsG: 4.43, raG: 4.69 }, 'CLE': { rsG: 4.28, raG: 4.56 },
  'STL': { rsG: 4.26, raG: 4.59 }, 'MIA': { rsG: 4.25, raG: 4.60 },
  'LAA': { rsG: 4.32, raG: 4.72 }, 'CWS': { rsG: 4.20, raG: 4.90 },
  'WSH': { rsG: 4.20, raG: 4.92 }, 'COL': { rsG: 4.55, raG: 5.51 },
};

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
  
  // DK consensus lines as Bayesian prior — if our model deviates >8W from DK, we're probably wrong
  // Market lines embed thousands of hours of analysis; we should trust them as a prior
  // and only deviate where we have specific, quantifiable edge
  const DK_CONSENSUS = {
    'LAD': 97.5, 'ATL': 91.5, 'NYY': 90.5, 'PHI': 89.5, 'BAL': 88.5, 'HOU': 87.5,
    'SD': 86.5, 'BOS': 85.5, 'SEA': 84.5, 'NYM': 84.5, 'MIL': 84.5, 'DET': 83.5,
    'CLE': 82.5, 'TEX': 82.5, 'MIN': 81.5, 'CHC': 81.5, 'ARI': 80.5, 'TOR': 79.5,
    'SF': 78.5, 'KC': 78.5, 'STL': 77.5, 'CIN': 76.5, 'TB': 76.5, 'PIT': 74.5,
    'LAA': 72.5, 'WSH': 70.5, 'MIA': 66.5, 'OAK': 63.5, 'COL': 62.5, 'CWS': 58.5,
  };

  // Per-team roster confidence: teams with massive, high-certainty overhauls get more credit
  // Default 40% — but teams with 5+ impact moves get up to 55%
  // KEY INSIGHT: BAL added Alonso/O'Neill/Bassitt/Eflin/Baz/Helsley = 6 proven MLB starters
  // That's not speculative — those are known quantities worth higher confidence
  const ROSTER_CONFIDENCE_OVERRIDE = {
    'BAL': 0.55,  // 6+ proven MLB starters added, known quantities (Alonso, Bassitt, Eflin, Helsley)
    'NYM': 0.55,  // Soto, Bichette, Semien, Robert = 4 proven All-Stars, less uncertainty
    'BOS': 0.50,  // Crochet+Gray+Suarez = elite pitching adds, proven track records
    'TOR': 0.50,  // Cease+Bieber+Scherzer+Santander+Gimenez = 5 proven MLB starters (but Bieber injury risk)
    'ATL': 0.55,  // Acuña+Strider RETURNING healthy = not new acquisitions, KNOWN elite talent. Highest certainty.
    'NYY': 0.50,  // Fried+Bellinger+Goldschmidt+McMahon+Bednar = 5 proven pieces
    'SEA': 0.50,  // Naylor+Arozarena+Donovan = 3 proven MLB bats added to elite pitching
    'PHI': 0.50,  // Luzardo+Garcia+Painter returning = known upside
    'PIT': 0.50,  // Ozuna+Lowe = 2 proven 25+ HR bats to worst NL offense
    'HOU': 0.50,  // Correa+Walker+Hader = 3 elite proven pieces
    'STL': 0.50,  // Lost Gray+Helsley+Donovan = known downgrades, high certainty they get worse
    'MIL': 0.50,  // Lost Peralta+Williams+Contreras = known downgrades from 97W team
    'CWS': 0.35,  // Murakami is VERY uncertain (NPB transition) — lost Crochet = confirmed downgrade. Net: highly uncertain, reduce confidence.
    'LAD': 0.50,  // Tucker+Sasaki = known elite (Tucker proven, Sasaki some NPB risk)
  };

  // Variable preseason regression: extreme teams regress MORE toward mean
  // Research: 60-win team is more likely to improve than 80-win team is to change
  // But also: historically terrible teams (COL, CWS) often stay bad due to organizational dysfunction
  function getRegression(basePyth) {
    const distFromMean = Math.abs(basePyth - 0.5);
    // Teams near .500: regress 30%. Extreme teams: regress up to 38%.
    // Reduced from 35/45 — old values were pulling bad teams way too far toward .500
    return 0.30 + distFromMean * 0.12;
  }

  // FanGraphs 2026 Depth Charts projected wins — our independent validation source
  // Updated 2026-03-22. Use for sanity checks against DK lines.
  // Organizational dysfunction penalty: teams that persistently underperform Pythagorean
  // This isn't bad luck — it's systemic (bad bullpen use, tanking, poor development)
  // These penalties persist year-over-year and shouldn't be regressed away
  const ORG_DYSFUNCTION = {
    'CWS': -0.03,  // 60W actual vs 71W Pyth = -11W gap, persistent since 2023
    'COL': -0.04,  // 43W actual vs ~54W Pyth = -11W gap, Coors and org dysfunction
    'WSH': -0.01,  // Minor gap, rebuilding but not tanking hard
    'MIA': -0.01,  // Some dysfunction, firesale roster
  };
  
  for (const [abbr, team] of Object.entries(teams)) {
    const rsG = team.rsG || 4.5;
    const raG = team.raG || 4.5;
    const actualW = team.w || 81;
    const actualL = team.l || 81;
    const actualWinPct = actualW / (actualW + actualL);
    
    // Pythagorean win expectation from 2025 base stats
    let pythRaw = Math.pow(rsG, PYTH_EXP) / (Math.pow(rsG, PYTH_EXP) + Math.pow(raG, PYTH_EXP));
    
    // Apply preseason roster adjustment to the RS/RA BEFORE computing Pythagorean
    // This is more correct: adjust the run environment, then compute expected wins
    let adjRS = rsG;
    let adjRA = raG;
    
    if (preseasonTuning) {
      try {
        const tuning = preseasonTuning.getTeamAdjustment(abbr);
        if (tuning) {
          // Per-team roster confidence: proven MLB starters = higher confidence
          const ROSTER_CONFIDENCE = ROSTER_CONFIDENCE_OVERRIDE[abbr] || 0.40;
          adjRS += (tuning.offAdj || 0) * ROSTER_CONFIDENCE;
          adjRA += (tuning.defAdj || 0) * ROSTER_CONFIDENCE;
        }
      } catch (e) {}
    }
    
    // Blend with FanGraphs projected RS/RA — independent player-level projections
    // ZiPS+Steamer use fundamentally different methodology than our Pythagorean+roster approach
    // Blending independent projection systems reduces prediction error (ensemble effect)
    // Weight: 60% our model (has roster-change detail), 40% FanGraphs (has player-level projections)
    const fgRsRa = FANGRAPHS_RS_RA[abbr];
    if (fgRsRa) {
      const FG_RS_RA_WEIGHT = 0.35; // Trust FanGraphs RS/RA at 35%
      adjRS = adjRS * (1 - FG_RS_RA_WEIGHT) + fgRsRa.rsG * FG_RS_RA_WEIGHT;
      adjRA = adjRA * (1 - FG_RS_RA_WEIGHT) + fgRsRa.raG * FG_RS_RA_WEIGHT;
    }
    
    // Recompute Pythagorean with adjusted runs
    let adjPythRaw = Math.pow(adjRS, PYTH_EXP) / (Math.pow(adjRS, PYTH_EXP) + Math.pow(adjRA, PYTH_EXP));
    
    // Apply organizational dysfunction penalty BEFORE blending
    // This captures persistent underperformance that isn't just luck
    if (ORG_DYSFUNCTION[abbr]) {
      adjPythRaw += ORG_DYSFUNCTION[abbr];
    }
    
    // CRITICAL: Blend Pythagorean with actual W-L for base talent
    // Teams that significantly under/over-perform Pythagorean often have real organizational
    // factors (bullpen management, roster construction, clutch performance) that persist.
    // CWS: 60W actual vs 71W Pythagorean = -11W organizational dysfunction
    // TOR: 94W actual vs ~80W Pythagorean = +14W overperformance (likely to regress HARD)
    // Blend: 60% Pythagorean (more predictive) + 40% actual (captures real factors)
    // CHANGED from 70/30 → 60/40: giving more weight to actual record reduces phantom edges
    // for teams with persistent org dysfunction (CWS, COL) while still using Pythagorean
    let pyth = adjPythRaw * 0.60 + actualWinPct * 0.40;
    
    // Variable preseason regression: extreme teams regress more toward .500
    // This is more accurate than flat 40% for everyone
    const preseasonRegression = getRegression(pyth);
    pyth = pyth * (1 - preseasonRegression) + 0.5 * preseasonRegression;
    
    // Bayesian blend with market consensus (DK lines)
    // Our model has edge but isn't infallible. Weight: 40% our model, 60% market consensus
    // This is the Bayesian optimal blend for preseason — markets are VERY efficient for futures
    const dkWinPct = DK_CONSENSUS[abbr] ? DK_CONSENSUS[abbr] / 162 : null;
    if (dkWinPct) {
      const MODEL_WEIGHT = 0.40; // How much we trust our model vs market
      pyth = pyth * MODEL_WEIGHT + dkWinPct * (1 - MODEL_WEIGHT);
    }
    
    // Statcast-based adjustment: teams with Statcast xRuns >> actual runs will regress UP
    // This is OUR unique edge — Statcast data isn't fully priced into futures
    if (statcastService) {
      try {
        const teamStatcast = statcastService.getTeamStatcast(abbr);
        if (teamStatcast && teamStatcast.xRunDiff) {
          // xRunDiff = expected runs - actual runs. Positive = underperforming (likely to improve)
          // This is where we GET OUR EDGE — Statcast disagreements with actual results
          const statcastAdj = teamStatcast.xRunDiff * 0.005; // Aggressive on our unique data
          pyth = Math.max(0.30, Math.min(0.70, pyth + statcastAdj));
        }
      } catch (e) {}
    }
    
    // Final bounds: no team projects below 48W or above 107W
    // COL went 43-119 in 2025 — teams CAN be this bad, but 48 is still generous floor
    pyth = Math.max(48 / 162, Math.min(107 / 162, pyth));
    
    strengths[abbr] = {
      winPct: +pyth.toFixed(4),
      rsG: adjRS,
      raG: adjRA,
      projectedWins: Math.round(pyth * 162),
      projectedLosses: 162 - Math.round(pyth * 162),
      name: team.name || abbr,
      dkLine: DK_CONSENSUS[abbr] || null,
      fangraphsProj: FANGRAPHS_PROJ[abbr] || null,
      modelEdge: DK_CONSENSUS[abbr] ? +(pyth * 162 - DK_CONSENSUS[abbr]).toFixed(1) : null,
      fangraphsEdge: (FANGRAPHS_PROJ[abbr] && DK_CONSENSUS[abbr]) ? +(FANGRAPHS_PROJ[abbr] - DK_CONSENSUS[abbr]).toFixed(1) : null,
    };
  }
  
  return strengths;
}

/**
 * Analyze model disagreements with DK lines.
 * Returns categorized list of potential betting edges.
 */
function getEdgeAnalysis() {
  const strengths = getTeamStrengths();
  const edges = [];
  
  // Edge explanations for our biggest disagreements
  const EDGE_NOTES = {
    'CWS': { reason: 'Murakami (56 HR NPB) + Mead + Teel = real offensive upside. Lost Crochet but 60W was an organizational disaster partly due to tanking. Murakami alone could add 2-3 WAR. OVER could have value but NPB transition risk is real.', confidence: 'MEDIUM', source: 'roster' },
    'TOR': { reason: 'Our model rates TOR higher based on Cease+Bieber+Scherzer pitching haul + Santander+Gimenez bats. Market may be underpricing this rotation. But Bieber TJ risk and Scherzer age = legitimate concern. OVER lean.', confidence: 'MEDIUM', source: 'roster+pitching' },
    'OAK': { reason: 'Lost Mason Miller (elite closer) + JP Sears (starter) to SD. Severino is aging. 76W in 2025 was already slightly above Pythagorean. Roster got WORSE. Model says 68 with heavy market blending, but real talent level might be 63-65. LEAN UNDER.', confidence: 'MEDIUM', source: 'roster-downgrade' },
    'BAL': { reason: 'Added Alonso+O\'Neill+Bassitt+Eflin+Baz+Helsley — 6 proven MLB starters. Henderson/Rutschman core is elite. Market at 88.5 might be right. Our model still slightly under-crediting. OVER has slight value.', confidence: 'MEDIUM', source: 'roster' },
    'ATL': { reason: 'Acuña Jr + Strider returning from injury = ~8 WAR returning. Sale+Strider 1-2 is elite. Kim+Heim+Iglesias fills gaps. Market at 91.5 from 76W base = massive bounceback priced in. Our model agrees directionally but is slightly conservative.', confidence: 'HIGH', source: 'injuries-returning' },
    'BOS': { reason: 'Crochet+Gray+Suarez = 3 legit top-of-rotation arms. Contreras bat helps. Market at 85.5, we say 88. Rotation depth is our edge signal — market may not fully price 3 new aces.', confidence: 'MEDIUM', source: 'pitching' },
    'MIL': { reason: 'Lost Peralta+Williams+Contreras but still have deep farm system + strong organizational culture (97W in 2025). Market at 84.5, we say 87. Slight OVER lean — Brewers always find value.', confidence: 'LOW', source: 'organizational' },
    'NYM': { reason: 'Soto+Lindor+Robert+Bichette+Semien = most expensive lineup ever. Peralta+Holmes+Williams pitching adds. Market at 84.5, we say 87. OVER lean — this lineup is historically loaded.', confidence: 'MEDIUM', source: 'roster' },
    'CHC': { reason: 'Lost Bellinger+Wesneski from 92W team. Market at 81.5, we say 84. Our model may be slow to regress them. CAUTION — rotation is thin with Boyd starting OD.', confidence: 'LOW', source: 'possible-error' },
  };
  
  for (const [abbr, t] of Object.entries(strengths)) {
    if (t.dkLine && Math.abs(t.modelEdge) >= 2) {
      const note = EDGE_NOTES[abbr] || { reason: 'Model disagrees with market.', confidence: 'LOW', source: 'model' };
      edges.push({
        team: abbr,
        name: t.name,
        projectedWins: t.projectedWins,
        dkLine: t.dkLine,
        edge: t.modelEdge,
        side: t.modelEdge > 0 ? 'OVER' : 'UNDER',
        ...note,
      });
    }
  }
  
  return edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
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
  
  // Team projection uncertainty — controls variance in the MC sim
  // Higher uncertainty = wider win distribution = smaller edge confidence
  // Teams with uncertain rosters (NPB transition, injury returns, rebuilds) need more variance
  const TEAM_UNCERTAINTY = {
    'CWS': 0.035,  // Murakami NPB transition + org dysfunction = very uncertain
    'COL': 0.035,  // Historic tank, Coors effect on pitching projections
    'OAK': 0.030,  // Lost key pieces, rebuilding in new city
    'TOR': 0.025,  // Massive roster overhaul, could boom or bust
    'ATL': 0.025,  // Acuña/Strider returning from injury — upside but risk
    'WSH': 0.025,  // Young team, high variance
    'MIA': 0.025,  // Firesale roster, uncertain
    'STL': 0.025,  // Gutted roster, tanking
  };
  const DEFAULT_UNCERTAINTY = 0.018; // ~3 wins of noise per sim for most teams
  
  for (let sim = 0; sim < numSims; sim++) {
    // Add per-sim team strength perturbation to model preseason uncertainty
    // This widens the win distribution and produces more realistic edge calculations
    const perturbedStrengths = {};
    for (const [abbr, s] of Object.entries(strengths)) {
      const unc = TEAM_UNCERTAINTY[abbr] || DEFAULT_UNCERTAINTY;
      // Normal-ish random via Box-Muller
      const u1 = Math.random(), u2 = Math.random();
      const noise = unc * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      perturbedStrengths[abbr] = {
        ...s,
        winPct: Math.max(0.25, Math.min(0.72, s.winPct + noise)),
      };
    }
    
    // Simulate full season with perturbed strengths
    const records = simulateSeason(perturbedStrengths, schedule);
    
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
    
    // Simulate playoffs with perturbed strengths
    const playoffResult = simulatePlayoffs(playoffs, perturbedStrengths);
    
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
    
    // Edge calculation — apply preseason confidence discount
    // In preseason, model edges are less reliable than in-season
    // Discount raw edges by 25% to avoid overconfident sizing
    const PRESEASON_DISCOUNT = 0.75;
    const rawOverEdge = overProb - bookOverNoVig;
    const rawUnderEdge = underProb - bookUnderNoVig;
    const overEdge = rawOverEdge * PRESEASON_DISCOUNT;
    const underEdge = rawUnderEdge * PRESEASON_DISCOUNT;
    
    // Cap max displayed edge at 20% — any higher is likely model error, not real edge
    const cappedOverEdge = Math.min(overEdge, 0.20);
    const cappedUnderEdge = Math.min(underEdge, 0.20);
    
    // Kelly sizing
    function kellyFraction(prob, ml) {
      const payout = ml > 0 ? ml / 100 : 100 / (-ml);
      const f = (prob * payout - (1 - prob)) / payout;
      return Math.max(0, f);
    }
    
    const overKelly = kellyFraction(overProb, dk.overML);
    const underKelly = kellyFraction(underProb, dk.underML);
    
    // FanGraphs validation: flag if our projection disagrees with FanGraphs by > 5 wins
    const fgProj = FANGRAPHS_PROJ[abbr];
    const fgNote = fgProj ? (Math.abs(team.meanWins - fgProj) > 5 
      ? `⚠️ FanGraphs: ${fgProj}W (${team.meanWins > fgProj ? '+' : ''}${(team.meanWins - fgProj).toFixed(0)} diff)` 
      : `FanGraphs: ${fgProj}W (aligned)`) : null;
    
    if (cappedOverEdge > 0.02) {
      valueBets.push({
        team: abbr,
        name: team.name,
        bet: `OVER ${line}`,
        line,
        odds: dk.overML,
        modelProb: +overProb.toFixed(4),
        bookProb: +bookOverNoVig.toFixed(4),
        edge: +(cappedOverEdge * 100).toFixed(1),
        rawEdge: +(rawOverEdge * 100).toFixed(1),
        kelly: +(overKelly * 100).toFixed(1),
        halfKelly: +(overKelly * 50).toFixed(1),
        meanWins: team.meanWins,
        winDiff: +(team.meanWins - line).toFixed(1),
        fangraphs: fgNote,
        confidence: cappedOverEdge > 0.08 ? 'HIGH' : cappedOverEdge > 0.04 ? 'MEDIUM' : 'LOW',
        reasoning: `Model projects ${team.meanWins} wins (${team.meanWins > line ? '+' : ''}${(team.meanWins - line).toFixed(1)} from line). ${(overProb * 100).toFixed(0)}% sim probability of over.${fgNote ? ' ' + fgNote : ''}`,
      });
    }
    
    if (cappedUnderEdge > 0.02) {
      valueBets.push({
        team: abbr,
        name: team.name,
        bet: `UNDER ${line}`,
        line,
        odds: dk.underML,
        modelProb: +underProb.toFixed(4),
        bookProb: +bookUnderNoVig.toFixed(4),
        edge: +(cappedUnderEdge * 100).toFixed(1),
        rawEdge: +(rawUnderEdge * 100).toFixed(1),
        kelly: +(underKelly * 100).toFixed(1),
        halfKelly: +(underKelly * 50).toFixed(1),
        meanWins: team.meanWins,
        winDiff: +(team.meanWins - line).toFixed(1),
        fangraphs: fgNote,
        confidence: cappedUnderEdge > 0.08 ? 'HIGH' : cappedUnderEdge > 0.04 ? 'MEDIUM' : 'LOW',
        reasoning: `Model projects ${team.meanWins} wins (${(line - team.meanWins).toFixed(1)} below line). ${(underProb * 100).toFixed(0)}% sim probability of under.${fgNote ? ' ' + fgNote : ''}`,
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
      regression: 'Variable regression (35-45%) based on team extremity + 60/40 Bayesian blend with DK market consensus',
      rosterConfidence: 'Per-team confidence (40-55%) — proven MLB acquisitions get higher weight',
      edgeSource: 'Statcast xRun disagreements + roster analytics vs market consensus',
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
  getEdgeAnalysis,
  DK_WIN_TOTALS,
  DK_DIVISION_ODDS,
  DK_WS_ODDS,
  DIVISIONS,
  LEAGUES,
};
