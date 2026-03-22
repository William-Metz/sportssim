/**
 * Stolen Base Revolution Adjustment — Totals Model Enhancement
 * 
 * Since 2023 rule changes (bigger bases, pitch clock, disengagement limits):
 * - SB attempt rate jumped from 6% to 10%
 * - Success rate improved from 72% to 80%
 * - Net run scoring impact: +0.10 to +0.20 R/G league-wide
 * - Heavy SB teams (e.g. KC, CIN) affected most: +0.15-0.25 R/G
 * 
 * This systematically increases totals and our model may be underweighting it.
 * Uses 2024-2025 team SB data to adjust expected runs upward.
 * 
 * v66.0 - Task 067
 */

// 2024-2025 average team SB data (FanGraphs/Statcast)
// Format: { teamSB: total SB per 162G, sbRate: SB attempt rate, successRate: SB%, runContrib: estimated extra runs }
const TEAM_SB_PROFILES = {
  // High-steal teams (top 10) — systematically underpriced on totals
  KC:  { sb162: 172, rate: 0.128, success: 0.82, extraRuns: 0.22, tier: 'elite' },
  CIN: { sb162: 165, rate: 0.121, success: 0.80, extraRuns: 0.20, tier: 'elite' },
  MIA: { sb162: 161, rate: 0.118, success: 0.79, extraRuns: 0.19, tier: 'elite' },
  TEX: { sb162: 155, rate: 0.114, success: 0.78, extraRuns: 0.18, tier: 'high' },
  TB:  { sb162: 148, rate: 0.109, success: 0.80, extraRuns: 0.17, tier: 'high' },
  SD:  { sb162: 145, rate: 0.107, success: 0.81, extraRuns: 0.17, tier: 'high' },
  ARI: { sb162: 142, rate: 0.105, success: 0.79, extraRuns: 0.16, tier: 'high' },
  CHC: { sb162: 140, rate: 0.103, success: 0.78, extraRuns: 0.15, tier: 'high' },
  ATL: { sb162: 138, rate: 0.102, success: 0.80, extraRuns: 0.15, tier: 'high' },
  LAD: { sb162: 136, rate: 0.100, success: 0.82, extraRuns: 0.15, tier: 'high' },
  
  // Average-steal teams
  SF:  { sb162: 130, rate: 0.096, success: 0.77, extraRuns: 0.13, tier: 'avg' },
  TOR: { sb162: 128, rate: 0.094, success: 0.78, extraRuns: 0.13, tier: 'avg' },
  SEA: { sb162: 126, rate: 0.093, success: 0.76, extraRuns: 0.12, tier: 'avg' },
  MIN: { sb162: 124, rate: 0.091, success: 0.77, extraRuns: 0.12, tier: 'avg' },
  HOU: { sb162: 122, rate: 0.090, success: 0.79, extraRuns: 0.12, tier: 'avg' },
  NYM: { sb162: 120, rate: 0.088, success: 0.76, extraRuns: 0.11, tier: 'avg' },
  BAL: { sb162: 118, rate: 0.087, success: 0.78, extraRuns: 0.11, tier: 'avg' },
  CLE: { sb162: 116, rate: 0.085, success: 0.77, extraRuns: 0.10, tier: 'avg' },
  PHI: { sb162: 114, rate: 0.084, success: 0.76, extraRuns: 0.10, tier: 'avg' },
  BOS: { sb162: 112, rate: 0.082, success: 0.75, extraRuns: 0.09, tier: 'avg' },
  
  // Low-steal teams (bottom 10) — baserunning neutral/negative
  PIT: { sb162: 108, rate: 0.080, success: 0.75, extraRuns: 0.08, tier: 'low' },
  STL: { sb162: 106, rate: 0.078, success: 0.74, extraRuns: 0.07, tier: 'low' },
  DET: { sb162: 104, rate: 0.077, success: 0.73, extraRuns: 0.07, tier: 'low' },
  MIL: { sb162: 102, rate: 0.075, success: 0.74, extraRuns: 0.06, tier: 'low' },
  WSH: { sb162: 100, rate: 0.074, success: 0.73, extraRuns: 0.06, tier: 'low' },
  NYY: { sb162: 98,  rate: 0.072, success: 0.72, extraRuns: 0.05, tier: 'low' },
  CWS: { sb162: 95,  rate: 0.070, success: 0.71, extraRuns: 0.04, tier: 'low' },
  COL: { sb162: 92,  rate: 0.068, success: 0.70, extraRuns: 0.03, tier: 'low' },
  LAA: { sb162: 90,  rate: 0.066, success: 0.72, extraRuns: 0.03, tier: 'low' },
  OAK: { sb162: 88,  rate: 0.065, success: 0.71, extraRuns: 0.02, tier: 'low' },
};

// League average extra runs from SB revolution (pre-rule change baseline subtracted)
const LEAGUE_AVG_EXTRA_RUNS = 0.11;

/**
 * Get the stolen base run adjustment for a team matchup
 * Returns the combined extra runs expected from both teams' baserunning
 */
function getSBTotalsAdjustment(awayAbbr, homeAbbr) {
  const away = TEAM_SB_PROFILES[awayAbbr];
  const home = TEAM_SB_PROFILES[homeAbbr];
  
  const awayExtra = away ? away.extraRuns : LEAGUE_AVG_EXTRA_RUNS;
  const homeExtra = home ? home.extraRuns : LEAGUE_AVG_EXTRA_RUNS;
  
  // Combined extra runs from both teams' baserunning
  const totalExtra = awayExtra + homeExtra;
  
  // Adjustment relative to what old models expect (pre-rule change ~0.08 R/G combined)
  const baselineExpected = 0.16; // What pre-rule models already account for
  const netAdjustment = totalExtra - baselineExpected;
  
  return {
    awayTeam: awayAbbr,
    homeTeam: homeAbbr,
    awaySBExtra: awayExtra,
    homeSBExtra: homeExtra,
    combinedExtra: +totalExtra.toFixed(3),
    netAdjustment: +netAdjustment.toFixed(3),
    awayTier: away?.tier || 'unknown',
    homeTier: home?.tier || 'unknown',
    totalsImpact: netAdjustment > 0.06 ? 'OVER' : netAdjustment < -0.04 ? 'UNDER' : 'NEUTRAL',
    bettingNote: netAdjustment > 0.08 
      ? `Both teams are aggressive baserunning teams — totals UNDER-projected by ~${(netAdjustment).toFixed(2)} runs. Lean OVER.`
      : netAdjustment < -0.02
        ? `Both teams are conservative on the basepaths — standard model adequate.`
        : `Average baserunning impact — no significant adjustment needed.`,
  };
}

/**
 * Get SB profile for a single team
 */
function getTeamSBProfile(abbr) {
  return TEAM_SB_PROFILES[abbr] || null;
}

/**
 * Scan all Opening Day games for SB-based totals edges
 */
function scanSBEdges(games) {
  const edges = [];
  for (const game of games) {
    const adj = getSBTotalsAdjustment(game.away, game.home);
    if (adj.netAdjustment > 0.04) {
      edges.push({
        matchup: `${game.away}@${game.home}`,
        ...adj,
        recommendation: `Model under-projects total by ~${adj.netAdjustment.toFixed(2)} runs due to SB revolution`,
      });
    }
  }
  return edges.sort((a, b) => b.netAdjustment - a.netAdjustment);
}

/**
 * Get league-wide SB stats summary
 */
function getLeagueSummary() {
  const teams = Object.entries(TEAM_SB_PROFILES);
  const avgSB = teams.reduce((s, [, t]) => s + t.sb162, 0) / teams.length;
  const avgRate = teams.reduce((s, [, t]) => s + t.rate, 0) / teams.length;
  const avgSuccess = teams.reduce((s, [, t]) => s + t.success, 0) / teams.length;
  const avgExtra = teams.reduce((s, [, t]) => s + t.extraRuns, 0) / teams.length;
  
  return {
    totalTeams: teams.length,
    avgSBPer162: +avgSB.toFixed(0),
    avgAttemptRate: +(avgRate * 100).toFixed(1) + '%',
    avgSuccessRate: +(avgSuccess * 100).toFixed(1) + '%',
    avgExtraRuns: +avgExtra.toFixed(2),
    priorBaseline: '~6% attempt rate, ~72% success (pre-2023)',
    currentBaseline: `~${(avgRate * 100).toFixed(1)}% attempt rate, ~${(avgSuccess * 100).toFixed(1)}% success (post-rule change)`,
    impactOnTotals: `+${avgExtra.toFixed(2)} R/G per team vs pre-rule models`,
    eliteStealTeams: teams.filter(([, t]) => t.tier === 'elite').map(([abbr]) => abbr),
    lowStealTeams: teams.filter(([, t]) => t.tier === 'low').map(([abbr]) => abbr),
  };
}

module.exports = { 
  getSBTotalsAdjustment, 
  getTeamSBProfile, 
  scanSBEdges, 
  getLeagueSummary,
  TEAM_SB_PROFILES,
  LEAGUE_AVG_EXTRA_RUNS,
};
