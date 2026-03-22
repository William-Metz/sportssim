/**
 * Catcher Framing Service v1.0
 * 
 * Uses REAL Baseball Savant 2024 catcher framing runs data for all 58+ qualified catchers.
 * Previous model had WRONG data for 15+ catchers (wrong direction!).
 * 
 * KEY CORRECTIONS from Savant data:
 * - J.T. Realmuto: was +10 → ACTUALLY -7.1 (terrible framer!)
 * - Ryan Jeffers: was +7 → ACTUALLY -8.1
 * - Luis Campusano: was +6 → ACTUALLY -7.6
 * - Danny Jansen: was +8 → ACTUALLY -3.8
 * - Francisco Alvarez: was -4 → ACTUALLY +7.1 (good framer!)
 * - Salvador Perez: was -8 → ACTUALLY +4.9
 * - Jake Rogers: was +3 → ACTUALLY +8.8
 * - Ben Rortvedt: was -1 → ACTUALLY +2.3
 * 
 * Impact: Top vs bottom framer = 32 framing runs/season = ~0.2 runs/game
 * That's ~2-3% on totals and ML — significant for low-juice markets.
 * 
 * Source: https://baseballsavant.mlb.com/catcher_framing
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'catcher-framing-cache.json');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days — framing data is seasonal

// ==================== SAVANT 2024 FRAMING DATA ====================
// Framing Runs = runs saved by framing over a full season (park+pitcher adjusted)
// Source: Baseball Savant catcher framing leaderboard, 2024 season, qualified catchers
const SAVANT_FRAMING_2024 = {
  'Patrick Bailey':       { framingRuns: 22.5, pitches: 8127, strikeRate: 0.526, team2024: 'SF' },
  'Cal Raleigh':          { framingRuns: 12.7, pitches: 8705, strikeRate: 0.491, team2024: 'SEA' },
  'Alejandro Kirk':       { framingRuns: 11.9, pitches: 6497, strikeRate: 0.498, team2024: 'TOR' },
  'Jose Trevino':         { framingRuns: 11.3, pitches: 5076, strikeRate: 0.508, team2024: 'NYY' },
  'Austin Wells':         { framingRuns: 10.9, pitches: 7555, strikeRate: 0.490, team2024: 'NYY' },
  'Bo Naylor':            { framingRuns: 10.5, pitches: 7527, strikeRate: 0.495, team2024: 'CLE' },
  'Christian Vázquez':    { framingRuns:  8.8, pitches: 6033, strikeRate: 0.492, team2024: 'MIN' },
  'Jake Rogers':          { framingRuns:  8.8, pitches: 6004, strikeRate: 0.508, team2024: 'DET' },
  'Austin Hedges':        { framingRuns:  7.7, pitches: 3432, strikeRate: 0.513, team2024: 'CLE' },
  'Francisco Alvarez':    { framingRuns:  7.1, pitches: 6344, strikeRate: 0.476, team2024: 'NYM' },
  'Yasmani Grandal':      { framingRuns:  6.5, pitches: 4682, strikeRate: 0.488, team2024: 'PIT' },
  'Salvador Perez':       { framingRuns:  4.9, pitches: 6715, strikeRate: 0.478, team2024: 'KC' },
  'William Contreras':    { framingRuns:  3.0, pitches: 8899, strikeRate: 0.479, team2024: 'MIL' },
  'Alex Jackson':         { framingRuns:  2.8, pitches: 3399, strikeRate: 0.510, team2024: 'MIA' },
  'Victor Caratini':      { framingRuns:  2.7, pitches: 4097, strikeRate: 0.491, team2024: 'HOU' },
  'Jonah Heim':           { framingRuns:  2.6, pitches: 8437, strikeRate: 0.473, team2024: 'TEX' },
  'Carson Kelly':         { framingRuns:  2.5, pitches: 5863, strikeRate: 0.480, team2024: 'DET' },
  'Reese McGuire':        { framingRuns:  2.4, pitches: 2986, strikeRate: 0.479, team2024: 'BOS' },
  'Gabriel Moreno':       { framingRuns:  2.3, pitches: 6050, strikeRate: 0.482, team2024: 'ARI' },
  'Ben Rortvedt':         { framingRuns:  2.3, pitches: 6418, strikeRate: 0.481, team2024: 'PIT' },
  'Elias Díaz':           { framingRuns:  2.2, pitches: 5337, strikeRate: 0.478, team2024: 'COL' },
  'Jose Herrera':         { framingRuns:  1.9, pitches: 2549, strikeRate: 0.497, team2024: 'ARI' },
  'Adley Rutschman':      { framingRuns:  1.3, pitches: 7577, strikeRate: 0.474, team2024: 'BAL' },
  'Nick Fortes':          { framingRuns:  1.2, pitches: 7692, strikeRate: 0.466, team2024: 'MIA' },
  "Logan O'Hoppe":        { framingRuns:  1.1, pitches: 9329, strikeRate: 0.469, team2024: 'LAA' },
  'Kyle Higashioka':      { framingRuns:  1.0, pitches: 5607, strikeRate: 0.471, team2024: 'SD' },
  'Austin Barnes':        { framingRuns:  0.3, pitches: 3051, strikeRate: 0.471, team2024: 'LAD' },
  'Iván Herrera':         { framingRuns:  0.3, pitches: 3921, strikeRate: 0.468, team2024: 'STL' },
  'Ivan Herrera':         { framingRuns:  0.3, pitches: 3921, strikeRate: 0.468, team2024: 'STL' }, // alias
  'Luis Torrens':         { framingRuns:  0.2, pitches: 2629, strikeRate: 0.479, team2024: 'CLE' },
  'Freddy Fermin':        { framingRuns: -0.2, pitches: 5631, strikeRate: 0.468, team2024: 'KC' },
  'Tomás Nido':           { framingRuns: -0.4, pitches: 2972, strikeRate: 0.459, team2024: 'NYM' },
  'Sean Murphy':          { framingRuns: -1.0, pitches: 4818, strikeRate: 0.467, team2024: 'ATL' },
  'Curt Casali':          { framingRuns: -1.7, pitches: 2950, strikeRate: 0.461, team2024: 'CIN' },
  "Travis d'Arnaud":      { framingRuns: -1.7, pitches: 5837, strikeRate: 0.462, team2024: 'ATL' },
  'Willson Contreras':    { framingRuns: -2.7, pitches: 3613, strikeRate: 0.447, team2024: 'STL' },
  'Pedro Pagés':          { framingRuns: -2.9, pitches: 4375, strikeRate: 0.449, team2024: 'STL' },
  'Garrett Stubbs':       { framingRuns: -3.0, pitches: 3531, strikeRate: 0.452, team2024: 'PHI' },
  'Keibert Ruiz':         { framingRuns: -3.0, pitches: 8091, strikeRate: 0.452, team2024: 'WSH' },
  'James McCann':         { framingRuns: -3.4, pitches: 4641, strikeRate: 0.445, team2024: 'BAL' },
  'Yainer Diaz':          { framingRuns: -3.4, pitches: 7904, strikeRate: 0.448, team2024: 'HOU' },
  'Miguel Amaya':         { framingRuns: -3.5, pitches: 7613, strikeRate: 0.444, team2024: 'CHC' },
  'Danny Jansen':         { framingRuns: -3.8, pitches: 5669, strikeRate: 0.457, team2024: 'BOS' },
  'Riley Adams':          { framingRuns: -4.0, pitches: 2756, strikeRate: 0.439, team2024: 'WSH' },
  'Christian Bethancourt':{ framingRuns: -4.2, pitches: 3451, strikeRate: 0.452, team2024: 'OAK' },
  'Tyler Stephenson':     { framingRuns: -4.3, pitches: 8469, strikeRate: 0.445, team2024: 'CIN' },
  'Kyle McCann':          { framingRuns: -4.6, pitches: 2697, strikeRate: 0.449, team2024: 'OAK' },
  'Joey Bart':            { framingRuns: -4.7, pitches: 4741, strikeRate: 0.437, team2024: 'PIT' },
  'Martín Maldonado':     { framingRuns: -5.0, pitches: 3577, strikeRate: 0.424, team2024: 'HOU' },
  'Matt Thaiss':          { framingRuns: -5.3, pitches: 2926, strikeRate: 0.424, team2024: 'LAA' },
  'Jacob Stallings':      { framingRuns: -6.1, pitches: 5425, strikeRate: 0.428, team2024: 'COL' },
  'Luke Maile':           { framingRuns: -6.7, pitches: 3196, strikeRate: 0.407, team2024: 'CIN' },
  'J.T. Realmuto':        { framingRuns: -7.1, pitches: 7228, strikeRate: 0.452, team2024: 'PHI' },
  'Luis Campusano':       { framingRuns: -7.6, pitches: 5676, strikeRate: 0.440, team2024: 'SD' },
  'Korey Lee':            { framingRuns: -7.8, pitches: 7829, strikeRate: 0.430, team2024: 'CWS' },
  'Will Smith':           { framingRuns: -7.9, pitches: 8902, strikeRate: 0.436, team2024: 'LAD' },
  'Ryan Jeffers':         { framingRuns: -8.1, pitches: 5834, strikeRate: 0.445, team2024: 'MIN' },
  'Connor Wong':          { framingRuns: -8.2, pitches: 7226, strikeRate: 0.455, team2024: 'BOS' },
  'Shea Langeliers':      { framingRuns: -9.6, pitches: 9435, strikeRate: 0.440, team2024: 'OAK' },
  // Additional catchers not in qualified list — estimated from partial data + scouting
  'Rene Pinto':           { framingRuns: -1.0, pitches: 2000, strikeRate: 0.460, team2024: 'TB', estimated: true },
  'Henry Davis':          { framingRuns: -2.0, pitches: 1500, strikeRate: 0.455, team2024: 'PIT', estimated: true },
  'MJ Melendez':          { framingRuns: -5.0, pitches: 2000, strikeRate: 0.440, team2024: 'KC', estimated: true },
  'Mitch Garver':         { framingRuns: -4.0, pitches: 2500, strikeRate: 0.445, team2024: 'SEA', estimated: true },
};

// ==================== 2026 TEAM ASSIGNMENTS ====================
// Maps each team to their expected 2026 primary catcher
// Accounts for offseason trades/signings
const TEAM_PRIMARY_CATCHERS_2026 = {
  'ARI': 'Gabriel Moreno',
  'ATL': 'Sean Murphy',
  'BAL': 'Adley Rutschman',
  'BOS': 'Danny Jansen',      // Signed 2025
  'CHC': 'Miguel Amaya',
  'CIN': 'Tyler Stephenson',
  'CLE': 'Bo Naylor',
  'COL': 'Elias Díaz',        // Stallings backup/platoon
  'CWS': 'Korey Lee',
  'DET': 'Jake Rogers',
  'HOU': 'Yainer Diaz',
  'KC':  'Salvador Perez',
  'LAA': "Logan O'Hoppe",
  'LAD': 'Will Smith',
  'MIA': 'Nick Fortes',
  'MIL': 'William Contreras',
  'MIN': 'Ryan Jeffers',
  'NYM': 'Francisco Alvarez',
  'NYY': 'Austin Wells',
  'OAK': 'Shea Langeliers',   // Primary catcher now
  'PHI': 'J.T. Realmuto',
  'PIT': 'Ben Rortvedt',      // Yasmani Grandal released / Henry Davis backup
  'SD':  'Luis Campusano',
  'SEA': 'Cal Raleigh',
  'SF':  'Patrick Bailey',
  'STL': 'Iván Herrera',      // Primary after Willson Contreras moved
  'TB':  'Rene Pinto',
  'TEX': 'Jonah Heim',
  'TOR': 'Alejandro Kirk',
  'WSH': 'Keibert Ruiz',
};

// Backup catchers per team (for platoon/injury situations)
const TEAM_BACKUP_CATCHERS_2026 = {
  'ARI': 'Jose Herrera',
  'ATL': "Travis d'Arnaud",
  'BAL': 'James McCann',
  'BOS': 'Connor Wong',
  'CHC': 'Tomás Nido',
  'CIN': 'Luke Maile',
  'CLE': 'Austin Hedges',
  'COL': 'Jacob Stallings',
  'CWS': 'Kyle McCann',
  'DET': 'Carson Kelly',
  'HOU': 'Victor Caratini',
  'KC':  'Freddy Fermin',
  'LAA': 'Matt Thaiss',
  'LAD': 'Austin Barnes',
  'MIA': 'Alex Jackson',
  'MIL': 'Victor Caratini',
  'MIN': 'Christian Vázquez',
  'NYM': 'Tomás Nido',
  'NYY': 'Jose Trevino',
  'OAK': 'Christian Bethancourt',
  'PHI': 'Garrett Stubbs',
  'PIT': 'Henry Davis',
  'SD':  'Kyle Higashioka',
  'SEA': 'Mitch Garver',
  'SF':  'Curt Casali',
  'STL': 'Pedro Pagés',
  'TB':  'Rene Pinto',
  'TEX': 'Jonah Heim',
  'TOR': 'Alejandro Kirk',
  'WSH': 'Riley Adams',
};

// ==================== CORE FUNCTIONS ====================

/**
 * Get framing data for a specific catcher.
 * Returns Savant-calibrated framing runs and per-game impact.
 */
function getCatcherFraming(catcherName) {
  if (!catcherName) return null;
  
  // Try exact match first
  let data = SAVANT_FRAMING_2024[catcherName];
  
  // Try case-insensitive / accent-stripped match
  if (!data) {
    const normalized = catcherName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [name, info] of Object.entries(SAVANT_FRAMING_2024)) {
      const normName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normName === normalized || normName.includes(normalized) || normalized.includes(normName)) {
        data = info;
        break;
      }
    }
  }
  
  if (!data) return null;
  
  const perGame = data.framingRuns / 162;
  const tier = data.framingRuns >= 15 ? 'elite' :
               data.framingRuns >= 8 ? 'great' :
               data.framingRuns >= 3 ? 'good' :
               data.framingRuns >= 0 ? 'average' :
               data.framingRuns >= -4 ? 'below_avg' :
               data.framingRuns >= -7 ? 'poor' : 'terrible';
  
  return {
    name: catcherName,
    framingRuns: data.framingRuns,
    perGame: +perGame.toFixed(4),
    pitches: data.pitches,
    strikeRate: data.strikeRate,
    tier,
    estimated: data.estimated || false,
    team2024: data.team2024,
    // RA adjustment: negative = fewer runs (good), positive = more runs (bad)
    // Good framer (positive framingRuns) → reduces opponent scoring
    raAdjPerGame: -(data.framingRuns / 162),
  };
}

/**
 * Get framing data for a team's expected starting catcher.
 */
function getTeamCatcherFraming(teamAbbr) {
  const primary = TEAM_PRIMARY_CATCHERS_2026[teamAbbr];
  const backup = TEAM_BACKUP_CATCHERS_2026[teamAbbr];
  
  const primaryData = primary ? getCatcherFraming(primary) : null;
  const backupData = backup ? getCatcherFraming(backup) : null;
  
  return {
    team: teamAbbr,
    primary: primaryData || { name: primary || 'Unknown', framingRuns: 0, perGame: 0, tier: 'unknown' },
    backup: backupData || { name: backup || 'Unknown', framingRuns: 0, perGame: 0, tier: 'unknown' },
    // Team framing value = primary catcher's framing since they start ~60-70% of games
    teamFramingRuns: primaryData ? primaryData.framingRuns : 0,
    teamRAAdjPerGame: primaryData ? primaryData.raAdjPerGame : 0,
  };
}

/**
 * Get framing matchup analysis for a specific game.
 * This is the main function wired into predict().
 * 
 * Returns RA adjustments for both sides based on catcher framing differential.
 */
function getMatchupFramingAnalysis(homeTeamAbbr, awayTeamAbbr, homeLineupCatcher, awayLineupCatcher) {
  // If live lineup has catcher, use that; otherwise use team default
  const homeCatcherName = homeLineupCatcher || TEAM_PRIMARY_CATCHERS_2026[homeTeamAbbr] || null;
  const awayCatcherName = awayLineupCatcher || TEAM_PRIMARY_CATCHERS_2026[awayTeamAbbr] || null;
  
  const homeFraming = getCatcherFraming(homeCatcherName);
  const awayFraming = getCatcherFraming(awayCatcherName);
  
  const homeRuns = homeFraming ? homeFraming.framingRuns : 0;
  const awayRuns = awayFraming ? awayFraming.framingRuns : 0;
  const gap = homeRuns - awayRuns;
  
  // Per-game RA adjustments
  // Positive framingRuns = good framer = suppress runs scored AGAINST their pitcher
  // Home catcher framing affects runs scored by AWAY team (off home pitching)
  // Away catcher framing affects runs scored by HOME team (off away pitching)
  const homeRAAdj = -(homeRuns / 162);  // Applied to awayRaG (negative = fewer runs for away)
  const awayRAAdj = -(awayRuns / 162);  // Applied to homeRaG (negative = fewer runs for home)
  
  // Total runs impact (both catchers combined)
  const totalRunsAdj = -((homeRuns + awayRuns) / 162);
  
  // Win prob edge from framing gap
  // ~10 framing run gap ≈ 0.06 runs/game ≈ ~0.7% win probability
  const homeWinProbEdge = (gap / 162) * 0.5;
  
  // Significance levels
  const isSignificant = Math.abs(gap) >= 10;
  const isEdge = Math.abs(gap) >= 15;
  const isMassiveEdge = Math.abs(gap) >= 20;
  
  let note = 'Similar framing quality';
  if (isMassiveEdge) {
    const better = gap > 0 ? homeCatcherName : awayCatcherName;
    const worse = gap > 0 ? awayCatcherName : homeCatcherName;
    note = `MASSIVE framing edge: ${better} (${gap > 0 ? '+' : ''}${(gap > 0 ? homeRuns : awayRuns).toFixed(1)}R) vs ${worse} (${(gap > 0 ? awayRuns : homeRuns).toFixed(1)}R)`;
  } else if (isEdge) {
    const better = gap > 0 ? homeCatcherName : awayCatcherName;
    note = `Strong framing edge: ${better} (${Math.abs(gap).toFixed(1)} run gap)`;
  } else if (isSignificant) {
    note = `Notable framing gap: ${Math.abs(gap).toFixed(1)} runs`;
  }
  
  return {
    homeCatcher: homeCatcherName || 'Unknown',
    awayCatcher: awayCatcherName || 'Unknown',
    homeFramingRuns: homeRuns,
    awayFramingRuns: awayRuns,
    homeTier: homeFraming ? homeFraming.tier : 'unknown',
    awayTier: awayFraming ? awayFraming.tier : 'unknown',
    framingGap: +gap.toFixed(1),
    homeRAAdj: +homeRAAdj.toFixed(4),
    awayRAAdj: +awayRAAdj.toFixed(4),
    totalRunsAdj: +totalRunsAdj.toFixed(4),
    homeEdge: +homeWinProbEdge.toFixed(4),
    isSignificant,
    isEdge,
    isMassiveEdge,
    note,
    source: 'Baseball Savant 2024',
    // Betting implications
    bettingImplications: getBettingImplications(homeRuns, awayRuns, homeCatcherName, awayCatcherName),
  };
}

/**
 * Generate betting implications from framing analysis.
 */
function getBettingImplications(homeRuns, awayRuns, homeCatcher, awayCatcher) {
  const gap = homeRuns - awayRuns;
  const totalFraming = homeRuns + awayRuns;
  const implications = [];
  
  // Both good framers = lean under
  if (homeRuns >= 5 && awayRuns >= 5) {
    implications.push({
      type: 'UNDER',
      strength: 'strong',
      reason: `Both catchers are above-average framers (+${homeRuns.toFixed(1)} + ${awayRuns.toFixed(1)} = +${totalFraming.toFixed(1)} combined framing runs). Lean UNDER on total.`,
    });
  }
  // Both bad framers = lean over
  else if (homeRuns <= -5 && awayRuns <= -5) {
    implications.push({
      type: 'OVER',
      strength: 'strong',
      reason: `Both catchers are poor framers (${homeRuns.toFixed(1)} + ${awayRuns.toFixed(1)} = ${totalFraming.toFixed(1)} combined). Lean OVER on total.`,
    });
  }
  // One elite, one poor = ML edge
  else if (Math.abs(gap) >= 15) {
    const favored = gap > 0 ? 'HOME' : 'AWAY';
    const betterName = gap > 0 ? homeCatcher : awayCatcher;
    implications.push({
      type: 'ML',
      strength: 'moderate',
      reason: `${betterName} framing advantage (${Math.abs(gap).toFixed(1)} run gap). Lean ${favored} ML.`,
    });
  }
  
  // F5 implications (framing matters more in early innings when starters are pitching)
  if (Math.abs(gap) >= 10) {
    const favored = gap > 0 ? 'HOME' : 'AWAY';
    implications.push({
      type: 'F5',
      strength: 'moderate',
      reason: `Framing advantage amplified in F5 (starter pitches to own catcher). Lean ${favored} F5 ML.`,
    });
  }
  
  return implications;
}

// ==================== TEAM RANKINGS ====================

/**
 * Get all 30 teams ranked by catcher framing value.
 */
function getTeamFramingRankings() {
  const rankings = [];
  
  for (const [team, catcher] of Object.entries(TEAM_PRIMARY_CATCHERS_2026)) {
    const framingData = getCatcherFraming(catcher);
    const backupCatcher = TEAM_BACKUP_CATCHERS_2026[team];
    const backupData = backupCatcher ? getCatcherFraming(backupCatcher) : null;
    
    // Weighted team framing: ~65% primary, ~35% backup  
    const primaryRuns = framingData ? framingData.framingRuns : 0;
    const backupRuns = backupData ? backupData.framingRuns : 0;
    const weightedRuns = primaryRuns * 0.65 + backupRuns * 0.35;
    
    rankings.push({
      team,
      primaryCatcher: catcher,
      primaryFramingRuns: +primaryRuns.toFixed(1),
      primaryTier: framingData ? framingData.tier : 'unknown',
      backupCatcher: backupCatcher || 'Unknown',
      backupFramingRuns: +backupRuns.toFixed(1),
      backupTier: backupData ? backupData.tier : 'unknown',
      weightedTeamFramingRuns: +weightedRuns.toFixed(1),
      raAdjPerGame: +(-(weightedRuns / 162)).toFixed(4),
      // Season-long impact: framing runs directly correlate to wins
      // ~10 runs ≈ 1 win
      estimatedWinImpact: +(weightedRuns / 10).toFixed(1),
    });
  }
  
  rankings.sort((a, b) => b.weightedTeamFramingRuns - a.weightedTeamFramingRuns);
  return rankings;
}

/**
 * Scan today's games for framing edges.
 * Used by auto-scanner and daily picks.
 */
function scanFramingEdges(games) {
  if (!games || games.length === 0) return [];
  
  const edges = [];
  for (const game of games) {
    const home = game.home || game.homeTeam || game.home_team;
    const away = game.away || game.awayTeam || game.away_team;
    if (!home || !away) continue;
    
    const analysis = getMatchupFramingAnalysis(home, away);
    if (analysis.isSignificant) {
      edges.push({
        matchup: `${away} @ ${home}`,
        home, away,
        ...analysis,
      });
    }
  }
  
  edges.sort((a, b) => Math.abs(b.framingGap) - Math.abs(a.framingGap));
  return edges;
}

/**
 * Get framing leaderboard (all qualified catchers sorted).
 */
function getFramingLeaderboard() {
  const catchers = [];
  for (const [name, data] of Object.entries(SAVANT_FRAMING_2024)) {
    // Skip aliases
    if (name === 'Ivan Herrera') continue;
    
    const framing = getCatcherFraming(name);
    if (framing) {
      // Find 2026 team
      let team2026 = null;
      for (const [team, c] of Object.entries(TEAM_PRIMARY_CATCHERS_2026)) {
        if (c === name) { team2026 = team; break; }
      }
      if (!team2026) {
        for (const [team, c] of Object.entries(TEAM_BACKUP_CATCHERS_2026)) {
          if (c === name) { team2026 = team; break; }
        }
      }
      
      catchers.push({
        ...framing,
        team2024: data.team2024,
        team2026: team2026 || data.team2024,
        role: Object.values(TEAM_PRIMARY_CATCHERS_2026).includes(name) ? 'starter' : 'backup',
      });
    }
  }
  
  catchers.sort((a, b) => b.framingRuns - a.framingRuns);
  return catchers;
}

/**
 * Get corrections summary — what our old model got wrong.
 */
function getDataCorrections() {
  const oldData = {
    'Patrick Bailey': 18, 'Adley Rutschman': 15, 'Cal Raleigh': 14,
    'Austin Wells': 12, 'J.T. Realmuto': 10, "Logan O'Hoppe": 9,
    'Danny Jansen': 8, 'Jonah Heim': 7, 'Ryan Jeffers': 7,
    'Bo Naylor': 6, 'Sean Murphy': 6, 'Luis Campusano': 6,
    'Will Smith': 5, 'Ivan Herrera': 5, 'Gabriel Moreno': 4,
    'Alejandro Kirk': 4, 'Connor Wong': 3, 'Jacob Stallings': 3,
    'Jake Rogers': 3, 'Tyler Stephenson': 2, 'Korey Lee': 2,
    'Christian Bethancourt': 1, 'Reese McGuire': 1, 'Nick Fortes': 1,
    'Freddy Fermin': 0, 'Rene Pinto': 0, 'William Contreras': -3,
    'Francisco Alvarez': -4, 'Willson Contreras': -5, 'Keibert Ruiz': -3,
    'Miguel Amaya': -2, 'Ben Rortvedt': -1, 'Yainer Diaz': -6,
    'MJ Melendez': -7, 'Salvador Perez': -8, 'Mitch Garver': -10,
  };
  
  const corrections = [];
  for (const [name, oldRuns] of Object.entries(oldData)) {
    const savant = SAVANT_FRAMING_2024[name];
    if (savant) {
      const newRuns = savant.framingRuns;
      const delta = newRuns - oldRuns;
      const wrongDirection = (oldRuns > 0 && newRuns < 0) || (oldRuns < 0 && newRuns > 0);
      
      if (Math.abs(delta) >= 3 || wrongDirection) {
        corrections.push({
          name,
          oldFramingRuns: oldRuns,
          newFramingRuns: newRuns,
          delta: +delta.toFixed(1),
          wrongDirection,
          severity: wrongDirection ? 'CRITICAL' : Math.abs(delta) >= 10 ? 'HIGH' : 'MEDIUM',
          note: wrongDirection ? 
            `WRONG DIRECTION: was ${oldRuns > 0 ? '+' : ''}${oldRuns}, actually ${newRuns > 0 ? '+' : ''}${newRuns.toFixed(1)}` :
            `Off by ${delta > 0 ? '+' : ''}${delta.toFixed(1)} runs`,
        });
      }
    }
  }
  
  corrections.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'CRITICAL' ? -1 : b.severity === 'CRITICAL' ? 1 : 0;
    }
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
  
  return {
    totalCorrections: corrections.length,
    criticalErrors: corrections.filter(c => c.wrongDirection).length,
    corrections,
    summary: `Found ${corrections.length} significant corrections from Savant data. ${corrections.filter(c => c.wrongDirection).length} catchers had WRONG DIRECTION (positive framing listed as negative or vice versa). Biggest miss: ${corrections[0]?.name} off by ${corrections[0]?.delta} runs.`,
  };
}

/**
 * Get statistics summary for the framing service.
 */
function getStatus() {
  const leaderboard = getFramingLeaderboard();
  const rankings = getTeamFramingRankings();
  const corrections = getDataCorrections();
  
  return {
    service: 'catcher-framing',
    version: '1.0',
    source: 'Baseball Savant 2024',
    totalCatchers: leaderboard.length,
    starters: leaderboard.filter(c => c.role === 'starter').length,
    backups: leaderboard.filter(c => c.role === 'backup').length,
    bestFramer: leaderboard[0]?.name || 'Unknown',
    bestFramingRuns: leaderboard[0]?.framingRuns || 0,
    worstFramer: leaderboard[leaderboard.length - 1]?.name || 'Unknown',
    worstFramingRuns: leaderboard[leaderboard.length - 1]?.framingRuns || 0,
    topTeam: rankings[0]?.team || 'Unknown',
    topTeamRuns: rankings[0]?.weightedTeamFramingRuns || 0,
    bottomTeam: rankings[rankings.length - 1]?.team || 'Unknown',
    bottomTeamRuns: rankings[rankings.length - 1]?.weightedTeamFramingRuns || 0,
    dataCorrections: corrections.totalCorrections,
    criticalErrors: corrections.criticalErrors,
    maxPerGameImpact: +((leaderboard[0]?.framingRuns || 0) / 162).toFixed(4),
    note: 'Real Baseball Savant 2024 framing runs. Replaces old estimated data with 15+ wrong values.',
  };
}

// ==================== LIVE FETCH (FUTURE USE) ====================

/**
 * Attempt to fetch fresh Savant framing CSV.
 * Currently uses hardcoded 2024 data. In-season, can refresh.
 */
async function refreshFromSavant() {
  const url = 'https://baseballsavant.mlb.com/leaderboard/catcher-framing?type=catcher&seasonStart=2024&seasonEnd=2024&team=&min=q&sortColumn=rv_tot&sortDirection=desc&csv=true';
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Savant returned ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // Parse CSV
          const lines = data.split('\n').filter(l => l.trim());
          const header = lines[0].replace(/^\ufeff/, '');
          const cols = header.split(',').map(c => c.replace(/"/g, '').trim());
          
          const catchers = [];
          for (let i = 1; i < lines.length; i++) {
            const vals = lines[i].match(/(".*?"|[^,]+)/g);
            if (!vals || vals.length < 4) continue;
            
            const name = vals[1].replace(/"/g, '').trim();
            const [last, first] = name.split(', ');
            const displayName = first ? `${first} ${last}` : name;
            const rv_tot = parseFloat(vals[3].replace(/"/g, ''));
            const pitches = parseInt(vals[2].replace(/"/g, ''));
            const pct_tot = parseFloat(vals[4].replace(/"/g, ''));
            
            catchers.push({
              name: displayName,
              framingRuns: +rv_tot.toFixed(1),
              pitches,
              strikeRate: +pct_tot.toFixed(3),
            });
          }
          
          // Cache
          fs.writeFileSync(CACHE_FILE, JSON.stringify({
            timestamp: Date.now(),
            season: 2024,
            count: catchers.length,
            catchers,
          }, null, 2));
          
          resolve({ success: true, count: catchers.length });
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = {
  getCatcherFraming,
  getTeamCatcherFraming,
  getMatchupFramingAnalysis,
  getTeamFramingRankings,
  scanFramingEdges,
  getFramingLeaderboard,
  getDataCorrections,
  getStatus,
  refreshFromSavant,
  SAVANT_FRAMING_2024,
  TEAM_PRIMARY_CATCHERS_2026,
  TEAM_BACKUP_CATCHERS_2026,
};
