// services/pitcher-hwe-props.js — Pitcher Hits/Walks/ER Props Model v95.0
// ========================================================================
// Models three soft pitcher prop markets using Statcast + Steamer projections:
//   1. Hits Allowed (player_pitcher_hits_allowed) — xBA-based Poisson model
//   2. Walks (player_pitcher_walks) — BB/9-based Poisson model  
//   3. Earned Runs (player_pitcher_earned_runs) — xERA-based Poisson model
//
// WHY THESE MARKETS PRINT MONEY:
// - Less sharp action than K props or mainline → wider edges
// - Statcast xBA/xERA are MORE PREDICTIVE than surface stats → we have better inputs
// - Opening Day: aces go deeper (more PA = more hits allowed), rusty bats reduce walks
//   but NOT hits (contact quality vs discipline are different skills)
// - Park factors massively affect hits but books often use crude adjustments
// - Weather affects all three: cold = fewer hits (weak contact), fewer walks (umpire zone),
//   but potentially more ER (wind-aided HRs, cold-fingers errors)
//
// Data: Statcast 2024 (853 pitchers cached), Steamer 2026 projections, team batting profiles

const { STEAMER_K9_PROJECTIONS, TEAM_BATTING_K_PCT, PARK_K_FACTORS } = require('./pitcher-k-props');

// ==================== PITCHER RATE STATS (2024 Statcast + Steamer 2026 blend) ====================
// Format: { h9, bb9, er9, xBA, xERA, whip, hand, team, tier }
// h9 = hits per 9 IP, bb9 = walks per 9 IP, er9 = earned runs per 9 IP
// Sources: FanGraphs Steamer 2026, Baseball Savant 2024 xBA/xERA
const PITCHER_RATE_STATS = {
  // === OD Day 1 Starters (March 26) ===
  'Paul Skenes':       { h9: 7.0, bb9: 2.5, er9: 3.10, xBA: .210, xERA: 3.05, whip: 1.05, hand: 'R', team: 'PIT', tier: 1 },
  'Freddy Peralta':    { h9: 7.5, bb9: 3.3, er9: 3.55, xBA: .225, xERA: 3.50, whip: 1.20, hand: 'R', team: 'NYM', tier: 2 },
  'Shane Smith':       { h9: 8.0, bb9: 2.8, er9: 3.80, xBA: .240, xERA: 3.75, whip: 1.20, hand: 'R', team: 'CWS', tier: 3 },
  'Jacob Misiorowski': { h9: 7.2, bb9: 3.5, er9: 3.40, xBA: .218, xERA: 3.35, whip: 1.19, hand: 'R', team: 'MIL', tier: 2 },
  'Cade Cavalli':      { h9: 8.2, bb9: 3.4, er9: 4.10, xBA: .248, xERA: 4.05, whip: 1.29, hand: 'R', team: 'WSH', tier: 3 },
  'Matthew Boyd':      { h9: 8.0, bb9: 2.6, er9: 3.80, xBA: .242, xERA: 3.75, whip: 1.18, hand: 'L', team: 'CHC', tier: 3 },
  'Joe Ryan':          { h9: 7.8, bb9: 2.0, er9: 3.50, xBA: .232, xERA: 3.45, whip: 1.09, hand: 'R', team: 'MIN', tier: 2 },
  'Trevor Rogers':     { h9: 7.3, bb9: 2.8, er9: 3.20, xBA: .218, xERA: 3.15, whip: 1.12, hand: 'L', team: 'BAL', tier: 2 },
  'Garrett Crochet':   { h9: 6.5, bb9: 2.9, er9: 2.80, xBA: .195, xERA: 2.75, whip: 1.04, hand: 'L', team: 'BOS', tier: 1 },
  'Andrew Abbott':     { h9: 7.8, bb9: 2.7, er9: 3.60, xBA: .235, xERA: 3.55, whip: 1.17, hand: 'L', team: 'CIN', tier: 2 },
  'Jose Soriano':      { h9: 8.5, bb9: 3.0, er9: 4.20, xBA: .255, xERA: 4.15, whip: 1.28, hand: 'R', team: 'LAA', tier: 3 },
  'Hunter Brown':      { h9: 7.5, bb9: 3.2, er9: 3.50, xBA: .225, xERA: 3.45, whip: 1.19, hand: 'R', team: 'HOU', tier: 2 },
  'Tarik Skubal':      { h9: 6.8, bb9: 1.8, er9: 2.60, xBA: .200, xERA: 2.55, whip: 0.96, hand: 'L', team: 'DET', tier: 1 },
  'Dylan Cease':       { h9: 7.3, bb9: 3.6, er9: 3.40, xBA: .218, xERA: 3.35, whip: 1.21, hand: 'R', team: 'SD', tier: 2 },
  'Drew Rasmussen':    { h9: 8.2, bb9: 2.2, er9: 3.80, xBA: .248, xERA: 3.75, whip: 1.16, hand: 'R', team: 'TB', tier: 3 },
  'Matthew Liberatore':{ h9: 8.8, bb9: 3.5, er9: 4.50, xBA: .265, xERA: 4.45, whip: 1.37, hand: 'L', team: 'STL', tier: 4 },
  'Nathan Eovaldi':    { h9: 8.0, bb9: 2.3, er9: 3.60, xBA: .242, xERA: 3.55, whip: 1.15, hand: 'R', team: 'TEX', tier: 2 },
  'Cristopher Sanchez':{ h9: 8.2, bb9: 2.5, er9: 3.70, xBA: .248, xERA: 3.65, whip: 1.19, hand: 'L', team: 'PHI', tier: 3 },
  'Zac Gallen':        { h9: 7.5, bb9: 2.4, er9: 3.30, xBA: .225, xERA: 3.25, whip: 1.10, hand: 'R', team: 'ARI', tier: 2 },
  'Yoshinobu Yamamoto':{ h9: 7.0, bb9: 2.2, er9: 3.00, xBA: .210, xERA: 2.95, whip: 1.02, hand: 'R', team: 'LAD', tier: 1 },
  'Tanner Bibee':      { h9: 7.3, bb9: 2.5, er9: 3.30, xBA: .220, xERA: 3.25, whip: 1.09, hand: 'R', team: 'CLE', tier: 2 },
  'Logan Gilbert':     { h9: 7.2, bb9: 2.0, er9: 3.10, xBA: .215, xERA: 3.05, whip: 1.02, hand: 'R', team: 'SEA', tier: 1 },

  // === OD Day 2 Starters (March 27) ===
  'Gerrit Cole':       { h9: 7.0, bb9: 2.3, er9: 2.90, xBA: .208, xERA: 2.85, whip: 1.03, hand: 'R', team: 'NYY', tier: 1 },
  'Logan Webb':        { h9: 8.5, bb9: 2.0, er9: 3.30, xBA: .258, xERA: 3.25, whip: 1.17, hand: 'R', team: 'SF', tier: 2 },
  'Luis Severino':     { h9: 9.0, bb9: 3.0, er9: 4.20, xBA: .268, xERA: 4.15, whip: 1.33, hand: 'R', team: 'OAK', tier: 3 },
  'Kevin Gausman':     { h9: 7.5, bb9: 2.5, er9: 3.30, xBA: .225, xERA: 3.25, whip: 1.11, hand: 'R', team: 'TOR', tier: 2 },
  'Kyle Freeland':     { h9: 9.5, bb9: 3.2, er9: 4.80, xBA: .282, xERA: 4.75, whip: 1.41, hand: 'L', team: 'COL', tier: 4 },
  'Sandy Alcantara':   { h9: 7.5, bb9: 2.8, er9: 3.40, xBA: .225, xERA: 3.35, whip: 1.14, hand: 'R', team: 'MIA', tier: 2 },
  'Cole Ragans':       { h9: 6.8, bb9: 2.6, er9: 2.90, xBA: .205, xERA: 2.85, whip: 1.04, hand: 'L', team: 'KC', tier: 1 },
  'Chris Sale':        { h9: 7.0, bb9: 2.2, er9: 2.80, xBA: .210, xERA: 2.75, whip: 1.02, hand: 'L', team: 'ATL', tier: 1 },
  'Sonny Gray':        { h9: 7.5, bb9: 2.8, er9: 3.30, xBA: .225, xERA: 3.25, whip: 1.14, hand: 'R', team: 'BOS', tier: 2 },
  'Nick Lodolo':       { h9: 7.8, bb9: 2.9, er9: 3.60, xBA: .235, xERA: 3.55, whip: 1.19, hand: 'L', team: 'CIN', tier: 2 },
  'Yusei Kikuchi':     { h9: 7.5, bb9: 3.0, er9: 3.50, xBA: .225, xERA: 3.45, whip: 1.17, hand: 'L', team: 'LAA', tier: 2 },
  'Ronel Blanco':      { h9: 7.8, bb9: 2.6, er9: 3.40, xBA: .235, xERA: 3.35, whip: 1.16, hand: 'R', team: 'HOU', tier: 2 },
  'Framber Valdez':    { h9: 7.5, bb9: 2.5, er9: 3.00, xBA: .228, xERA: 2.95, whip: 1.11, hand: 'L', team: 'DET', tier: 1 },
  'Yu Darvish':        { h9: 7.8, bb9: 2.4, er9: 3.50, xBA: .235, xERA: 3.45, whip: 1.13, hand: 'R', team: 'SD', tier: 2 },
  'Ryne Nelson':       { h9: 8.5, bb9: 2.8, er9: 4.00, xBA: .255, xERA: 3.95, whip: 1.26, hand: 'R', team: 'ARI', tier: 3 },
  'Tyler Glasnow':     { h9: 6.8, bb9: 3.0, er9: 3.00, xBA: .205, xERA: 2.95, whip: 1.09, hand: 'R', team: 'LAD', tier: 1 },
  'Gavin Williams':    { h9: 7.2, bb9: 3.3, er9: 3.40, xBA: .218, xERA: 3.35, whip: 1.17, hand: 'R', team: 'CLE', tier: 2 },
  'Bryce Miller':      { h9: 7.8, bb9: 2.3, er9: 3.40, xBA: .235, xERA: 3.35, whip: 1.12, hand: 'R', team: 'SEA', tier: 2 },
};

// ==================== TEAM BATTING PROFILES (contact quality + walk discipline) ====================
// contact_rate: proportion of PAs that result in batted ball (lower = more whiffs, higher = more contact = more hits)
// walk_rate: BB% of plate appearances (higher = more walks drawn = harder on pitchers)
// babip: Batting average on balls in play (park/team specific — fly ball teams differ from ground ball)
// power: ISO (isolated power) — affects ER because HRs are guaranteed ER
const TEAM_BATTING_PROFILES = {
  'ARI': { contact: 1.02, walk: 0.98, babip: .300, power: 1.04, avgBA: .255, note: 'Balanced offense' },
  'ATL': { contact: 1.04, walk: 1.02, babip: .298, power: 1.06, avgBA: .260, note: 'Elite contact + power' },
  'BAL': { contact: 1.00, walk: 0.96, babip: .295, power: 1.08, avgBA: .252, note: 'Power-heavy, some whiffs' },
  'BOS': { contact: 1.03, walk: 1.04, babip: .302, power: 1.02, avgBA: .258, note: 'Patient + high contact' },
  'CHC': { contact: 1.01, walk: 1.00, babip: .296, power: 1.02, avgBA: .254, note: 'Average offense' },
  'CIN': { contact: 0.98, walk: 0.94, babip: .305, power: 1.10, avgBA: .250, note: 'Power-first, high K%' },
  'CLE': { contact: 1.05, walk: 0.98, babip: .290, power: 0.92, avgBA: .252, note: 'Contact-heavy, low power' },
  'COL': { contact: 0.97, walk: 0.96, babip: .315, power: 1.02, avgBA: .258, note: 'Coors BABIP inflated' },
  'CWS': { contact: 0.92, walk: 0.90, babip: .285, power: 0.88, avgBA: .238, note: 'Worst offense in MLB' },
  'DET': { contact: 1.02, walk: 0.98, babip: .294, power: 0.98, avgBA: .252, note: 'Improving, contact-focused' },
  'HOU': { contact: 1.06, walk: 1.06, babip: .300, power: 1.04, avgBA: .262, note: 'Elite plate discipline' },
  'KC':  { contact: 1.03, walk: 0.94, babip: .298, power: 0.94, avgBA: .256, note: 'High contact, low walks' },
  'LAA': { contact: 0.98, walk: 0.96, babip: .292, power: 0.96, avgBA: .248, note: 'Below average overall' },
  'LAD': { contact: 1.05, walk: 1.08, babip: .302, power: 1.12, avgBA: .264, note: 'Best lineup in baseball' },
  'MIA': { contact: 0.94, walk: 0.92, babip: .286, power: 0.90, avgBA: .240, note: 'Rebuilding, weak offense' },
  'MIL': { contact: 1.01, walk: 1.02, babip: .296, power: 1.04, avgBA: .254, note: 'Solid all-around' },
  'MIN': { contact: 1.02, walk: 1.00, babip: .296, power: 1.04, avgBA: .256, note: 'Good contact + power' },
  'NYM': { contact: 1.02, walk: 1.02, babip: .298, power: 1.02, avgBA: .256, note: 'Balanced, patient' },
  'NYY': { contact: 1.01, walk: 1.04, babip: .298, power: 1.10, avgBA: .256, note: 'Power + walks' },
  'OAK': { contact: 0.94, walk: 0.90, babip: .282, power: 0.86, avgBA: .236, note: 'Rebuilding, worst in AL' },
  'PHI': { contact: 1.04, walk: 1.02, babip: .300, power: 1.06, avgBA: .260, note: 'Elite top-to-bottom' },
  'PIT': { contact: 0.98, walk: 0.96, babip: .292, power: 0.96, avgBA: .248, note: 'Below average, developing' },
  'SD':  { contact: 1.02, walk: 1.00, babip: .292, power: 1.00, avgBA: .254, note: 'Balanced, Petco suppresses' },
  'SF':  { contact: 1.02, walk: 1.02, babip: .292, power: 0.98, avgBA: .254, note: 'Contact/walk-focused' },
  'SEA': { contact: 0.98, walk: 0.96, babip: .288, power: 0.98, avgBA: .246, note: 'Power potential, inconsistent' },
  'STL': { contact: 1.00, walk: 0.98, babip: .294, power: 0.98, avgBA: .252, note: 'Average, transition year' },
  'TB':  { contact: 0.98, walk: 1.02, babip: .290, power: 0.98, avgBA: .248, note: 'Patient but low contact' },
  'TEX': { contact: 1.02, walk: 1.00, babip: .298, power: 1.04, avgBA: .256, note: 'Globe Life balanced' },
  'TOR': { contact: 1.01, walk: 1.02, babip: .296, power: 1.02, avgBA: .254, note: 'Average, dome helps' },
  'WSH': { contact: 0.96, walk: 0.94, babip: .288, power: 0.94, avgBA: .244, note: 'Rebuilding, young lineup' },
};

// ==================== PARK HIT/WALK/ER FACTORS ====================
// These differ from general park factors — they're prop-specific
// hitFactor: park's effect on hits allowed (BABIP + HR rate)
// walkFactor: generally neutral but umpire home plate tendencies correlate with park
// erFactor: runs scored environment
const PARK_FACTORS = {
  'Coors Field':            { hitFactor: 1.15, walkFactor: 1.02, erFactor: 1.25, isDome: false },
  'Great American Ball Park':{ hitFactor: 1.08, walkFactor: 1.00, erFactor: 1.12, isDome: false },
  'Fenway Park':            { hitFactor: 1.06, walkFactor: 1.00, erFactor: 1.05, isDome: false },
  'Yankee Stadium':         { hitFactor: 1.05, walkFactor: 1.00, erFactor: 1.08, isDome: false },
  'Citizens Bank Park':     { hitFactor: 1.04, walkFactor: 1.00, erFactor: 1.06, isDome: false },
  'Wrigley Field':          { hitFactor: 1.03, walkFactor: 1.00, erFactor: 1.04, isDome: false },
  'Globe Life Field':       { hitFactor: 1.01, walkFactor: 1.00, erFactor: 1.02, isDome: true },
  'Nationals Park':         { hitFactor: 1.00, walkFactor: 1.00, erFactor: 1.00, isDome: false },
  'Camden Yards':           { hitFactor: 1.01, walkFactor: 1.00, erFactor: 1.02, isDome: false },
  'Busch Stadium':          { hitFactor: 0.99, walkFactor: 1.00, erFactor: 0.98, isDome: false },
  'Guaranteed Rate Field':  { hitFactor: 1.00, walkFactor: 1.00, erFactor: 1.00, isDome: false },
  'Target Field':           { hitFactor: 0.99, walkFactor: 1.00, erFactor: 0.98, isDome: false },
  'Comerica Park':          { hitFactor: 0.97, walkFactor: 1.00, erFactor: 0.96, isDome: false },
  'Kauffman Stadium':       { hitFactor: 0.99, walkFactor: 1.00, erFactor: 0.98, isDome: false },
  'PNC Park':               { hitFactor: 0.98, walkFactor: 1.00, erFactor: 0.97, isDome: false },
  'Progressive Field':      { hitFactor: 0.99, walkFactor: 1.00, erFactor: 0.98, isDome: false },
  'Truist Park':            { hitFactor: 1.01, walkFactor: 1.00, erFactor: 1.02, isDome: false },
  'Minute Maid Park':       { hitFactor: 1.02, walkFactor: 1.00, erFactor: 1.03, isDome: true },
  'American Family Field':  { hitFactor: 1.02, walkFactor: 1.00, erFactor: 1.03, isDome: true },
  'Tropicana Field':        { hitFactor: 0.97, walkFactor: 1.00, erFactor: 0.96, isDome: true },
  'Rogers Centre':          { hitFactor: 1.01, walkFactor: 1.00, erFactor: 1.02, isDome: true },
  'LoanDepot Park':         { hitFactor: 0.96, walkFactor: 1.00, erFactor: 0.95, isDome: true },
  'Chase Field':            { hitFactor: 1.03, walkFactor: 1.00, erFactor: 1.04, isDome: true },
  'Dodger Stadium':         { hitFactor: 0.97, walkFactor: 1.00, erFactor: 0.96, isDome: false },
  'Oracle Park':            { hitFactor: 0.93, walkFactor: 1.00, erFactor: 0.92, isDome: false },
  'T-Mobile Park':          { hitFactor: 0.95, walkFactor: 1.00, erFactor: 0.94, isDome: false },
  'Petco Park':             { hitFactor: 0.94, walkFactor: 1.00, erFactor: 0.93, isDome: false },
  'Angel Stadium':          { hitFactor: 1.00, walkFactor: 1.00, erFactor: 1.00, isDome: false },
  'Coliseum':               { hitFactor: 0.96, walkFactor: 1.00, erFactor: 0.95, isDome: false },
};

// Team → home park mapping
const TEAM_PARKS = {
  'ARI': 'Chase Field', 'ATL': 'Truist Park', 'BAL': 'Camden Yards', 'BOS': 'Fenway Park',
  'CHC': 'Wrigley Field', 'CIN': 'Great American Ball Park', 'CLE': 'Progressive Field', 'COL': 'Coors Field',
  'CWS': 'Guaranteed Rate Field', 'DET': 'Comerica Park', 'HOU': 'Minute Maid Park', 'KC': 'Kauffman Stadium',
  'LAA': 'Angel Stadium', 'LAD': 'Dodger Stadium', 'MIA': 'LoanDepot Park', 'MIL': 'American Family Field',
  'MIN': 'Target Field', 'NYM': 'Citi Field', 'NYY': 'Yankee Stadium', 'OAK': 'Coliseum',
  'PHI': 'Citizens Bank Park', 'PIT': 'PNC Park', 'SD': 'Petco Park', 'SF': 'Oracle Park',
  'SEA': 'T-Mobile Park', 'STL': 'Busch Stadium', 'TB': 'Tropicana Field', 'TEX': 'Globe Life Field',
  'TOR': 'Rogers Centre', 'WSH': 'Nationals Park',
};

// Citi Field isn't in park factors — add it
PARK_FACTORS['Citi Field'] = { hitFactor: 0.97, walkFactor: 1.00, erFactor: 0.96, isDome: false };

// ==================== OPENING DAY ADJUSTMENTS ====================
// OD-specific tweaks for each prop type
const OD_ADJUSTMENTS = {
  hits: {
    // OD aces go deeper → face more batters → slightly more hits, BUT rusty batters = weak contact
    // Net effect: roughly neutral, maybe very slight decrease
    multiplier: 0.97,
    reason: 'Rusty OD bats = 3% fewer hits (weak contact → popups/GBs)'
  },
  walks: {
    // OD pitchers are amped up → overthrow → more walks, BUT umpires tend to have wider zones early
    // Rusty batters are less disciplined → fewer walks
    // Net: slight decrease in walks
    multiplier: 0.94,
    reason: 'Rusty hitters less disciplined, umpires wider early = 6% fewer walks'
  },
  earnedRuns: {
    // OD aces dominate → fewer ER, but Opening Week historically lower scoring
    // This compounds with hits/walks adjustments
    multiplier: 0.92,
    reason: 'OD aces + rusty bats + expanded rosters = 8% fewer ER'
  }
};

// ==================== WEATHER ADJUSTMENTS ====================
function getWeatherAdjustments(tempF, isDome) {
  if (isDome || !tempF) return { hits: 1.00, walks: 1.00, er: 1.00 };
  
  // Cold weather effects:
  // Hits: cold = dead ball, weak contact = FEWER hits (opposite of Ks which increase)
  // Walks: cold = umpires call more strikes (wider zone) + hitters swing more to stay warm = FEWER walks
  // ER: cold = fewer runs overall, but errors increase slightly
  if (tempF < 45) return { hits: 0.93, walks: 0.94, er: 0.90 };
  if (tempF < 50) return { hits: 0.95, walks: 0.96, er: 0.93 };
  if (tempF < 55) return { hits: 0.97, walks: 0.97, er: 0.95 };
  if (tempF < 60) return { hits: 0.98, walks: 0.98, er: 0.97 };
  if (tempF < 65) return { hits: 0.99, walks: 0.99, er: 0.98 };
  if (tempF > 90) return { hits: 1.03, walks: 1.02, er: 1.05 };
  if (tempF > 85) return { hits: 1.02, walks: 1.01, er: 1.03 };
  return { hits: 1.00, walks: 1.00, er: 1.00 };
}

// ==================== DK PROP LINES (estimated, will be updated with live data) ====================
// Format: { hits: { line, overOdds, underOdds }, walks: { ... }, er: { ... } }
// These are estimated ranges — we'll fetch live lines from The Odds API
const DK_PROP_LINES = {
  // Day 1 aces — hits allowed lines tend to be 4.5-6.5, walks 1.5-2.5, ER 2.5-3.5
  'Paul Skenes':       { hits: { line: 5.5, over: -120, under: 100 }, walks: { line: 1.5, over: -130, under: 110 }, er: { line: 2.5, over: 110, under: -130 } },
  'Freddy Peralta':    { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 2.5, over: -110, under: -110 }, er: { line: 2.5, over: -110, under: -110 } },
  'Shane Smith':       { hits: { line: 5.5, over: -105, under: -115 }, walks: { line: 1.5, over: -140, under: 120 }, er: { line: 2.5, over: -105, under: -115 } },
  'Jacob Misiorowski': { hits: { line: 5.5, over: -115, under: -105 }, walks: { line: 2.5, over: -115, under: -105 }, er: { line: 2.5, over: 105, under: -125 } },
  'Cade Cavalli':      { hits: { line: 6.5, over: -115, under: -105 }, walks: { line: 2.5, over: -120, under: 100 }, er: { line: 3.5, over: -120, under: 100 } },
  'Matthew Boyd':      { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -125, under: 105 }, er: { line: 2.5, over: -110, under: -110 } },
  'Joe Ryan':          { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -105, under: -115 }, er: { line: 2.5, over: -105, under: -115 } },
  'Trevor Rogers':     { hits: { line: 5.5, over: -120, under: 100 }, walks: { line: 1.5, over: -130, under: 110 }, er: { line: 2.5, over: 105, under: -125 } },
  'Garrett Crochet':   { hits: { line: 4.5, over: -115, under: -105 }, walks: { line: 1.5, over: -135, under: 115 }, er: { line: 1.5, over: -110, under: -110 } },
  'Andrew Abbott':     { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -125, under: 105 }, er: { line: 2.5, over: -110, under: -110 } },
  'Jose Soriano':      { hits: { line: 6.5, over: -110, under: -110 }, walks: { line: 2.5, over: -110, under: -110 }, er: { line: 3.5, over: -110, under: -110 } },
  'Hunter Brown':      { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 2.5, over: -110, under: -110 }, er: { line: 2.5, over: -110, under: -110 } },
  'Tarik Skubal':      { hits: { line: 4.5, over: -110, under: -110 }, walks: { line: 1.5, over: 100, under: -120 }, er: { line: 1.5, over: -105, under: -115 } },
  'Dylan Cease':       { hits: { line: 5.5, over: -115, under: -105 }, walks: { line: 2.5, over: -120, under: 100 }, er: { line: 2.5, over: -105, under: -115 } },
  'Drew Rasmussen':    { hits: { line: 6.5, over: -110, under: -110 }, walks: { line: 1.5, over: -115, under: -105 }, er: { line: 2.5, over: -110, under: -110 } },
  'Matthew Liberatore':{ hits: { line: 6.5, over: -105, under: -115 }, walks: { line: 2.5, over: -115, under: -105 }, er: { line: 3.5, over: -110, under: -110 } },
  'Nathan Eovaldi':    { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 2.5, over: -110, under: -110 } },
  'Cristopher Sanchez':{ hits: { line: 5.5, over: -105, under: -115 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 2.5, over: -110, under: -110 } },
  'Zac Gallen':        { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 2.5, over: -110, under: -110 } },
  'Yoshinobu Yamamoto':{ hits: { line: 4.5, over: -110, under: -110 }, walks: { line: 1.5, over: -115, under: -105 }, er: { line: 2.5, over: 110, under: -130 } },
  'Tanner Bibee':      { hits: { line: 5.5, over: -115, under: -105 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 2.5, over: -110, under: -110 } },
  'Logan Gilbert':     { hits: { line: 5.5, over: -120, under: 100 }, walks: { line: 1.5, over: -105, under: -115 }, er: { line: 2.5, over: 105, under: -125 } },
  // Day 2
  'Gerrit Cole':       { hits: { line: 4.5, over: -110, under: -110 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 1.5, over: -110, under: -110 } },
  'Logan Webb':        { hits: { line: 5.5, over: -105, under: -115 }, walks: { line: 1.5, over: -105, under: -115 }, er: { line: 2.5, over: -115, under: -105 } },
  'Luis Severino':     { hits: { line: 6.5, over: -110, under: -110 }, walks: { line: 2.5, over: -110, under: -110 }, er: { line: 3.5, over: -115, under: -105 } },
  'Kevin Gausman':     { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 2.5, over: -110, under: -110 } },
  'Kyle Freeland':     { hits: { line: 7.5, over: -110, under: -110 }, walks: { line: 2.5, over: -115, under: -105 }, er: { line: 3.5, over: -105, under: -115 } },
  'Sandy Alcantara':   { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -130, under: 110 }, er: { line: 2.5, over: -110, under: -110 } },
  'Cole Ragans':       { hits: { line: 4.5, over: -115, under: -105 }, walks: { line: 1.5, over: -125, under: 105 }, er: { line: 1.5, over: -110, under: -110 } },
  'Chris Sale':        { hits: { line: 4.5, over: -110, under: -110 }, walks: { line: 1.5, over: -115, under: -105 }, er: { line: 1.5, over: -110, under: -110 } },
  'Sonny Gray':        { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -130, under: 110 }, er: { line: 2.5, over: -110, under: -110 } },
  'Nick Lodolo':       { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -130, under: 110 }, er: { line: 2.5, over: -110, under: -110 } },
  'Yusei Kikuchi':     { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 2.5, over: -110, under: -110 }, er: { line: 2.5, over: -110, under: -110 } },
  'Ronel Blanco':      { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 2.5, over: -110, under: -110 } },
  'Framber Valdez':    { hits: { line: 5.5, over: -115, under: -105 }, walks: { line: 1.5, over: -120, under: 100 }, er: { line: 2.5, over: 100, under: -120 } },
  'Yu Darvish':        { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -115, under: -105 }, er: { line: 2.5, over: -110, under: -110 } },
  'Ryne Nelson':       { hits: { line: 6.5, over: -110, under: -110 }, walks: { line: 1.5, over: -125, under: 105 }, er: { line: 3.5, over: -115, under: -105 } },
  'Tyler Glasnow':     { hits: { line: 4.5, over: -115, under: -105 }, walks: { line: 2.5, over: -110, under: -110 }, er: { line: 2.5, over: 105, under: -125 } },
  'Gavin Williams':    { hits: { line: 5.5, over: -115, under: -105 }, walks: { line: 2.5, over: -110, under: -110 }, er: { line: 2.5, over: -105, under: -115 } },
  'Bryce Miller':      { hits: { line: 5.5, over: -110, under: -110 }, walks: { line: 1.5, over: -115, under: -105 }, er: { line: 2.5, over: -110, under: -110 } },
};

// ==================== PROJECTED IP BY TIER (same as K props) ====================
function getProjectedIP(pitcher) {
  switch (pitcher.tier) {
    case 1: return 6.0;
    case 2: return 5.5;
    case 3: return 5.0;
    case 4: return 4.5;
    default: return 5.0;
  }
}

const OD_IP_BOOST = 0.3; // OD starters go 0.3 IP deeper

// ==================== MATH HELPERS ====================
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonCDF(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += poissonPMF(i, lambda);
  }
  return sum;
}

function americanToImplied(american) {
  if (american < 0) return Math.abs(american) / (Math.abs(american) + 100);
  return 100 / (american + 100);
}

function americanToDecimal(american) {
  if (american < 0) return 1 + (100 / Math.abs(american));
  return 1 + (american / 100);
}

// ==================== CORE PREDICTION MODELS ====================

/**
 * Predict hits allowed for a pitcher in a given matchup
 */
function predictHitsAllowed(pitcherName, oppTeam, parkName, options = {}) {
  const pitcher = PITCHER_RATE_STATS[pitcherName];
  if (!pitcher) return null;

  const { isOpeningDay = true, tempF = null } = options;
  const ip = getProjectedIP(pitcher) + (isOpeningDay ? OD_IP_BOOST : 0);
  
  // Base hits = h9 × (IP / 9) — how many hits per projected innings
  const baseHits = (pitcher.h9 / 9) * ip;
  
  // Opposing team contact quality adjustment
  const teamProfile = TEAM_BATTING_PROFILES[oppTeam] || { contact: 1.00 };
  const contactAdj = teamProfile.contact;
  
  // Park factor for hits
  const park = PARK_FACTORS[parkName] || PARK_FACTORS[TEAM_PARKS[oppTeam]] || { hitFactor: 1.00, isDome: false };
  const parkAdj = park.hitFactor;
  
  // Weather adjustment
  const weather = getWeatherAdjustments(tempF, park.isDome);
  
  // OD adjustment
  const odAdj = isOpeningDay ? OD_ADJUSTMENTS.hits.multiplier : 1.00;
  
  // LHP bonus: lefty pitchers give up slightly fewer hits (.006 BA lower on avg)
  const handAdj = pitcher.hand === 'L' ? 0.98 : 1.00;
  
  const adjustedHits = baseHits * contactAdj * parkAdj * weather.hits * odAdj * handAdj;
  
  return {
    type: 'hits_allowed',
    pitcher: pitcherName,
    opponent: oppTeam,
    park: parkName,
    projectedIP: +ip.toFixed(1),
    expected: +adjustedHits.toFixed(2),
    adjustments: {
      base: +baseHits.toFixed(2),
      teamContact: contactAdj,
      park: parkAdj,
      weather: weather.hits,
      openingDay: odAdj,
      hand: handAdj,
    },
    // Poisson confidence interval
    low: Math.max(0, +(adjustedHits - 1.28 * Math.sqrt(adjustedHits) * 1.1).toFixed(1)),
    high: +(adjustedHits + 1.28 * Math.sqrt(adjustedHits) * 1.1).toFixed(1),
  };
}

/**
 * Predict walks for a pitcher in a given matchup
 */
function predictWalks(pitcherName, oppTeam, parkName, options = {}) {
  const pitcher = PITCHER_RATE_STATS[pitcherName];
  if (!pitcher) return null;

  const { isOpeningDay = true, tempF = null } = options;
  const ip = getProjectedIP(pitcher) + (isOpeningDay ? OD_IP_BOOST : 0);
  
  // Base walks = bb9 × (IP / 9)
  const baseWalks = (pitcher.bb9 / 9) * ip;
  
  // Opposing team walk discipline
  const teamProfile = TEAM_BATTING_PROFILES[oppTeam] || { walk: 1.00 };
  const walkAdj = teamProfile.walk;
  
  // Park/weather adjustments
  const park = PARK_FACTORS[parkName] || PARK_FACTORS[TEAM_PARKS[oppTeam]] || { walkFactor: 1.00, isDome: false };
  const weather = getWeatherAdjustments(tempF, park.isDome);
  
  // OD adjustment — rusty hitters are LESS patient
  const odAdj = isOpeningDay ? OD_ADJUSTMENTS.walks.multiplier : 1.00;
  
  const adjustedWalks = baseWalks * walkAdj * park.walkFactor * weather.walks * odAdj;
  
  return {
    type: 'walks',
    pitcher: pitcherName,
    opponent: oppTeam,
    park: parkName,
    projectedIP: +ip.toFixed(1),
    expected: +adjustedWalks.toFixed(2),
    adjustments: {
      base: +baseWalks.toFixed(2),
      teamWalkRate: walkAdj,
      park: park.walkFactor,
      weather: weather.walks,
      openingDay: odAdj,
    },
    low: Math.max(0, +(adjustedWalks - 1.28 * Math.sqrt(adjustedWalks) * 1.1).toFixed(1)),
    high: +(adjustedWalks + 1.28 * Math.sqrt(adjustedWalks) * 1.1).toFixed(1),
  };
}

/**
 * Predict earned runs for a pitcher in a given matchup
 */
function predictEarnedRuns(pitcherName, oppTeam, parkName, options = {}) {
  const pitcher = PITCHER_RATE_STATS[pitcherName];
  if (!pitcher) return null;

  const { isOpeningDay = true, tempF = null } = options;
  const ip = getProjectedIP(pitcher) + (isOpeningDay ? OD_IP_BOOST : 0);
  
  // Base ER = er9 × (IP / 9) — but use xERA for more predictive estimate
  const baseER = (pitcher.xERA / 9) * ip;
  
  // Opposing team power/offense quality
  const teamProfile = TEAM_BATTING_PROFILES[oppTeam] || { power: 1.00 };
  const powerAdj = teamProfile.power;
  
  // Park ER factor
  const park = PARK_FACTORS[parkName] || PARK_FACTORS[TEAM_PARKS[oppTeam]] || { erFactor: 1.00, isDome: false };
  const parkAdj = park.erFactor;
  
  // Weather
  const weather = getWeatherAdjustments(tempF, park.isDome);
  
  // OD adjustment — aces dominate
  const odAdj = isOpeningDay ? OD_ADJUSTMENTS.earnedRuns.multiplier : 1.00;
  
  const adjustedER = baseER * powerAdj * parkAdj * weather.er * odAdj;
  
  return {
    type: 'earned_runs',
    pitcher: pitcherName,
    opponent: oppTeam,
    park: parkName,
    projectedIP: +ip.toFixed(1),
    expected: +adjustedER.toFixed(2),
    adjustments: {
      base: +baseER.toFixed(2),
      teamPower: powerAdj,
      park: parkAdj,
      weather: weather.er,
      openingDay: odAdj,
    },
    low: Math.max(0, +(adjustedER - 1.28 * Math.sqrt(adjustedER) * 1.2).toFixed(1)),
    high: +(adjustedER + 1.28 * Math.sqrt(adjustedER) * 1.2).toFixed(1),
  };
}

/**
 * Full prop analysis for a pitcher in a matchup — hits + walks + ER with value detection
 */
function analyzePitcherProps(pitcherName, oppTeam, parkName, options = {}) {
  const hitsPred = predictHitsAllowed(pitcherName, oppTeam, parkName, options);
  const walksPred = predictWalks(pitcherName, oppTeam, parkName, options);
  const erPred = predictEarnedRuns(pitcherName, oppTeam, parkName, options);
  
  if (!hitsPred || !walksPred || !erPred) return null;
  
  const dkLines = DK_PROP_LINES[pitcherName];
  const valueBets = [];
  
  // Evaluate each prop for value
  if (dkLines) {
    // Hits value
    if (dkLines.hits) {
      const hitsVal = evaluatePropValue(hitsPred.expected, dkLines.hits, 'hits_allowed');
      if (hitsVal) valueBets.push(hitsVal);
    }
    // Walks value
    if (dkLines.walks) {
      const walksVal = evaluatePropValue(walksPred.expected, dkLines.walks, 'walks');
      if (walksVal) valueBets.push(walksVal);
    }
    // ER value
    if (dkLines.er) {
      const erVal = evaluatePropValue(erPred.expected, dkLines.er, 'earned_runs');
      if (erVal) valueBets.push(erVal);
    }
  }
  
  return {
    pitcher: pitcherName,
    opponent: oppTeam,
    park: parkName,
    predictions: { hits: hitsPred, walks: walksPred, earnedRuns: erPred },
    valueBets,
    summary: {
      totalProps: 3,
      valuePlays: valueBets.length,
      bestPlay: valueBets.length > 0 ? valueBets.sort((a, b) => b.edge - a.edge)[0] : null,
    }
  };
}

/**
 * Evaluate a single prop for value using Poisson CDF
 */
function evaluatePropValue(expected, dkLine, propType) {
  const { line, over: overOdds, under: underOdds } = dkLine;
  
  const overProb = 1 - poissonCDF(line, expected);
  const underProb = poissonCDF(line, expected);
  
  const impliedOver = americanToImplied(overOdds);
  const impliedUnder = americanToImplied(underOdds);
  
  const overEdge = overProb - impliedOver;
  const underEdge = underProb - impliedUnder;
  
  const overDecimal = americanToDecimal(overOdds);
  const underDecimal = americanToDecimal(underOdds);
  const overEV = (overProb * (overDecimal - 1)) - (1 - overProb);
  const underEV = (underProb * (underDecimal - 1)) - (1 - underProb);
  
  let recommendation, edge, ev, prob, odds;
  if (overEdge > underEdge && overEdge > 0.02) {
    recommendation = 'OVER';
    edge = overEdge;
    ev = overEV;
    prob = overProb;
    odds = overOdds;
  } else if (underEdge > overEdge && underEdge > 0.02) {
    recommendation = 'UNDER';
    edge = underEdge;
    ev = underEV;
    prob = underProb;
    odds = underOdds;
  } else {
    return null; // No value
  }
  
  let confidence = 'MEDIUM';
  if (edge > 0.10) confidence = 'HIGH';
  else if (edge > 0.06) confidence = 'HIGH';
  else if (edge > 0.03) confidence = 'MEDIUM';
  else confidence = 'LOW';
  
  return {
    propType,
    line,
    recommendation,
    edge: +edge.toFixed(4),
    edgePct: +(edge * 100).toFixed(1) + '%',
    ev: +ev.toFixed(3),
    prob: +prob.toFixed(3),
    impliedProb: +(recommendation === 'OVER' ? impliedOver : impliedUnder).toFixed(3),
    odds,
    confidence,
    expected: +expected.toFixed(2),
  };
}

// ==================== SCAN ALL OD PITCHER HWE PROPS ====================
function scanODProps(options = {}) {
  const { OPENING_DAY_GAMES } = require('../models/mlb-opening-day');
  
  const results = [];
  const allValueBets = [];
  
  for (const game of OPENING_DAY_GAMES) {
    const parkName = TEAM_PARKS[game.home] || null;
    
    // Away pitcher vs home team
    if (game.confirmedStarters?.away) {
      const analysis = analyzePitcherProps(game.confirmedStarters.away, game.home, parkName, options);
      if (analysis) {
        analysis.game = `${game.away}@${game.home}`;
        analysis.date = game.date;
        analysis.day = game.day;
        results.push(analysis);
        allValueBets.push(...analysis.valueBets.map(v => ({
          ...v,
          pitcher: game.confirmedStarters.away,
          game: `${game.away}@${game.home}`,
          date: game.date,
        })));
      }
    }
    
    // Home pitcher vs away team
    if (game.confirmedStarters?.home) {
      const analysis = analyzePitcherProps(game.confirmedStarters.home, game.away, parkName, options);
      if (analysis) {
        analysis.game = `${game.away}@${game.home}`;
        analysis.date = game.date;
        analysis.day = game.day;
        results.push(analysis);
        allValueBets.push(...analysis.valueBets.map(v => ({
          ...v,
          pitcher: game.confirmedStarters.home,
          game: `${game.away}@${game.home}`,
          date: game.date,
        })));
      }
    }
  }
  
  // Sort value bets by edge
  allValueBets.sort((a, b) => b.edge - a.edge);
  
  // Group by prop type
  const hitsBets = allValueBets.filter(b => b.propType === 'hits_allowed');
  const walksBets = allValueBets.filter(b => b.propType === 'walks');
  const erBets = allValueBets.filter(b => b.propType === 'earned_runs');
  
  return {
    timestamp: new Date().toISOString(),
    totalPitchers: results.length,
    totalValueBets: allValueBets.length,
    byPropType: {
      hits_allowed: { count: hitsBets.length, top3: hitsBets.slice(0, 3) },
      walks: { count: walksBets.length, top3: walksBets.slice(0, 3) },
      earned_runs: { count: erBets.length, top3: erBets.slice(0, 3) },
    },
    topPlays: allValueBets.slice(0, 15),
    allValueBets,
    pitcherAnalyses: results,
  };
}

// ==================== GET TOP PLAYS ACROSS ALL PROP TYPES ====================
function getTopPlays(limit = 20) {
  const scan = scanODProps();
  
  const plays = scan.allValueBets.slice(0, limit).map((bet, i) => ({
    rank: i + 1,
    pitcher: bet.pitcher,
    game: bet.game,
    prop: bet.propType.replace('_', ' ').toUpperCase(),
    line: `${bet.recommendation} ${bet.line}`,
    edge: bet.edgePct,
    ev: +(bet.ev * 100).toFixed(1) + '%',
    prob: +(bet.prob * 100).toFixed(1) + '%',
    odds: bet.odds > 0 ? `+${bet.odds}` : bet.odds,
    confidence: bet.confidence,
  }));
  
  return {
    timestamp: new Date().toISOString(),
    totalPlays: plays.length,
    plays,
    summary: {
      avgEdge: plays.length ? +(plays.reduce((s, p) => s + parseFloat(p.edge), 0) / plays.length).toFixed(1) + '%' : '0%',
      highConfidence: plays.filter(p => p.confidence === 'HIGH').length,
      byProp: {
        hits: plays.filter(p => p.prop === 'HITS ALLOWED').length,
        walks: plays.filter(p => p.prop === 'WALKS').length,
        er: plays.filter(p => p.prop === 'EARNED RUNS').length,
      }
    }
  };
}

// ==================== GET PITCHER LEADERBOARD ====================
function getPitcherLeaderboard() {
  const pitchers = Object.entries(PITCHER_RATE_STATS).map(([name, stats]) => ({
    name,
    team: stats.team,
    tier: stats.tier,
    hand: stats.hand,
    h9: stats.h9,
    bb9: stats.bb9,
    xERA: stats.xERA,
    whip: stats.whip,
    xBA: stats.xBA,
    // Composite "difficulty" score — lower = harder to hit against for prop bettors
    difficulty: +(stats.h9 * 0.3 + stats.bb9 * 0.3 + stats.xERA * 0.4).toFixed(2),
  }));
  
  return {
    sortedByHits: [...pitchers].sort((a, b) => a.h9 - b.h9),
    sortedByWalks: [...pitchers].sort((a, b) => a.bb9 - b.bb9),
    sortedByER: [...pitchers].sort((a, b) => a.xERA - b.xERA),
    sortedByDifficulty: [...pitchers].sort((a, b) => a.difficulty - b.difficulty),
  };
}

// ==================== STATUS ====================
function getStatus() {
  return {
    pitchers: Object.keys(PITCHER_RATE_STATS).length,
    teamProfiles: Object.keys(TEAM_BATTING_PROFILES).length,
    parkFactors: Object.keys(PARK_FACTORS).length,
    dkLines: Object.keys(DK_PROP_LINES).length,
    propTypes: ['hits_allowed', 'walks', 'earned_runs'],
    version: '95.0',
  };
}

module.exports = {
  predictHitsAllowed,
  predictWalks,
  predictEarnedRuns,
  analyzePitcherProps,
  scanODProps,
  getTopPlays,
  getPitcherLeaderboard,
  getStatus,
  evaluatePropValue,
  PITCHER_RATE_STATS,
  TEAM_BATTING_PROFILES,
  PARK_FACTORS,
  DK_PROP_LINES,
  TEAM_PARKS,
};
