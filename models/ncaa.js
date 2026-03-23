/**
 * SportsSim NCAA Basketball Model
 * 
 * KenPom-style efficiency model for March Madness betting.
 * Uses adjusted offensive/defensive efficiency (per 100 possessions),
 * tempo, seed history, and tournament-specific adjustments.
 * 
 * Key concepts:
 *   - AdjEM = AdjO - AdjD (adjusted efficiency margin)
 *   - Game projection: expected score = (team_AdjO + opp_AdjD) / 2 * tempo / 100
 *   - Win probability via logistic function on projected point spread
 *   - Tournament-specific: seed upset history, experience adjustments, defensive premium
 * 
 * March Madness Edge Thesis:
 *   - Public overvalues seeds/names → mispriced underdogs
 *   - Defense travels in tournament (single-elimination pressure)
 *   - Under historically hits at higher rate in tournament vs regular season
 *   - Late-game execution matters more → experience/coaching premium
 */

const HCA = 0; // Neutral court in NCAA Tournament
const SPREAD_TO_PROB_FACTOR = 11; // NCAA basketball logistic scaling (wider variance than NBA)
const TOURNAMENT_DEF_PREMIUM = 1.03; // Defense is 3% more impactful in tournament play
const AVG_TEMPO = 67.5; // Average D1 possessions per game
const AVG_EFFICIENCY = 107.0; // Average D1 points per 100 possessions

// Historical seed upset probabilities (probability lower seed wins)
// Based on comprehensive 1985-2025 tournament data
const SEED_UPSET_RATES = {
  '1v16': 0.01, '2v15': 0.06, '3v14': 0.15, '4v13': 0.21,
  '5v12': 0.36, '6v11': 0.37, '7v10': 0.39, '8v9': 0.51,
  '1v8': 0.10, '1v9': 0.12, '2v7': 0.15, '2v10': 0.20,
  '3v6': 0.25, '3v11': 0.30, '4v5': 0.44,
  '1v4': 0.17, '1v5': 0.20, '2v3': 0.38, '2v6': 0.25,
  '1v2': 0.34, '1v3': 0.26
};

// Full KenPom-style team data for 2026 NCAA Tournament field
// AdjO = adjusted offensive efficiency (pts/100 possessions)
// AdjD = adjusted defensive efficiency (pts/100 possessions, lower = better)
// AdjEM = AdjO - AdjD (overall efficiency margin)
// Tempo = possessions per game
// Ranked by KenPom overall ranking
const TEAMS = {
  // ===== TOP TIER (KenPom 1-6) =====
  DUKE:     { name: 'Duke Blue Devils',     kenpom: 1,  seed: 1, region: 'East',    record: '34-2', adjO: 121.5, adjD: 88.2, adjEM: 33.3, tempo: 70.5 },
  MICH:     { name: 'Michigan Wolverines',   kenpom: 2,  seed: 1, region: 'Midwest', record: '33-3', adjO: 118.8, adjD: 86.1, adjEM: 32.7, tempo: 66.8 },
  ARIZ:     { name: 'Arizona Wildcats',      kenpom: 3,  seed: 1, region: 'West',    record: '34-2', adjO: 120.8, adjD: 88.8, adjEM: 32.0, tempo: 69.2 },
  FLA:      { name: 'Florida Gators',        kenpom: 4,  seed: 1, region: 'South',   record: '28-7', adjO: 118.2, adjD: 90.5, adjEM: 27.7, tempo: 68.1 },
  HOU:      { name: 'Houston Cougars',       kenpom: 5,  seed: 2, region: 'South',   record: '30-6', adjO: 113.5, adjD: 87.8, adjEM: 25.7, tempo: 64.8 },
  IAST:     { name: 'Iowa State Cyclones',   kenpom: 6,  seed: 2, region: 'Midwest', record: '29-7', adjO: 111.2, adjD: 86.5, adjEM: 24.7, tempo: 63.5 },
  
  // ===== ELITE TIER (KenPom 7-12) =====
  ILL:      { name: 'Illinois Fighting Illini', kenpom: 7,  seed: 3, region: 'South',   record: '26-8', adjO: 122.4, adjD: 95.2, adjEM: 27.2, tempo: 71.0 },
  PUR:      { name: 'Purdue Boilermakers',    kenpom: 8,  seed: 2, region: 'West',    record: '29-8', adjO: 123.1, adjD: 97.0, adjEM: 26.1, tempo: 68.5 },
  MSU:      { name: 'Michigan State Spartans',kenpom: 9,  seed: 3, region: 'East',    record: '27-7', adjO: 112.8, adjD: 91.2, adjEM: 21.6, tempo: 67.4 },
  GONZ:     { name: 'Gonzaga Bulldogs',       kenpom: 10, seed: 3, region: 'West',    record: '32-3', adjO: 110.5, adjD: 90.0, adjEM: 20.5, tempo: 72.3 },
  UCON:     { name: 'UConn Huskies',          kenpom: 11, seed: 2, region: 'East',    record: '31-5', adjO: 110.2, adjD: 91.5, adjEM: 18.7, tempo: 66.0 },
  VAND:     { name: 'Vanderbilt Commodores',  kenpom: 12, seed: 5, region: 'South',   record: '28-8', adjO: 117.8, adjD: 95.6, adjEM: 22.2, tempo: 69.0 },

  // ===== STRONG TIER (KenPom 13-20) =====
  UVA:      { name: 'Virginia Cavaliers',     kenpom: 13, seed: 3, region: 'Midwest', record: '31-5', adjO: 109.8, adjD: 92.5, adjEM: 17.3, tempo: 59.8 },
  NEB:      { name: 'Nebraska Cornhuskers',   kenpom: 14, seed: 4, region: 'South',   record: '28-6', adjO: 108.5, adjD: 91.0, adjEM: 17.5, tempo: 65.2 },
  TENN:     { name: 'Tennessee Volunteers',   kenpom: 16, seed: 6, region: 'Midwest', record: '24-11',adjO: 109.2, adjD: 92.8, adjEM: 16.4, tempo: 64.5 },
  STJN:     { name: "St. John's Red Storm",   kenpom: 17, seed: 5, region: 'East',    record: '30-6', adjO: 108.8, adjD: 92.0, adjEM: 16.8, tempo: 66.2 },
  BAMA:     { name: 'Alabama Crimson Tide',   kenpom: 18, seed: 4, region: 'Midwest', record: '25-9', adjO: 121.0, adjD: 104.5, adjEM: 16.5, tempo: 74.5 },
  LVIL:     { name: 'Louisville Cardinals',   kenpom: 19, seed: 6, region: 'East',    record: '25-10',adjO: 112.5, adjD: 96.0, adjEM: 16.5, tempo: 67.8 },
  ARK:      { name: 'Arkansas Razorbacks',    kenpom: 20, seed: 4, region: 'West',    record: '28-8', adjO: 119.2, adjD: 103.0, adjEM: 16.2, tempo: 73.8 },
  TTECH:    { name: 'Texas Tech Red Raiders', kenpom: 21, seed: 5, region: 'Midwest', record: '24-10',adjO: 115.8, adjD: 98.5, adjEM: 17.3, tempo: 66.0 },
  
  // ===== SOLID TIER (KenPom 21-30) =====
  KU:       { name: 'Kansas Jayhawks',        kenpom: 22, seed: 4, region: 'East',    record: '25-10',adjO: 113.2, adjD: 98.8, adjEM: 14.4, tempo: 68.2 },
  WISC:     { name: 'Wisconsin Badgers',      kenpom: 23, seed: 5, region: 'West',    record: '26-10',adjO: 112.0, adjD: 98.0, adjEM: 14.0, tempo: 62.5 },
  UCLA:     { name: 'UCLA Bruins',            kenpom: 24, seed: 7, region: 'East',    record: '25-11',adjO: 111.5, adjD: 98.2, adjEM: 13.3, tempo: 67.0 },
  IOWA:     { name: 'Iowa Hawkeyes',          kenpom: 25, seed: 9, region: 'South',   record: '23-12',adjO: 116.8, adjD: 103.5, adjEM: 13.3, tempo: 72.0 },
  OSU:      { name: 'Ohio State Buckeyes',    kenpom: 26, seed: 8, region: 'East',    record: '23-12',adjO: 112.2, adjD: 99.5, adjEM: 12.7, tempo: 67.5 },
  UNC:      { name: 'North Carolina Tar Heels',kenpom: 29, seed: 6, region: 'South',  record: '26-8', adjO: 114.5, adjD: 102.0, adjEM: 12.5, tempo: 71.5 },
  UTST:     { name: 'Utah State Aggies',      kenpom: 30, seed: 9, region: 'West',    record: '30-6', adjO: 110.8, adjD: 98.8, adjEM: 12.0, tempo: 65.0 },
  
  // ===== MID TIER (KenPom 31-45) =====
  BYU:      { name: 'BYU Cougars',            kenpom: 31, seed: 6, region: 'West',    record: '25-11',adjO: 114.0, adjD: 102.5, adjEM: 11.5, tempo: 68.8 },
  KEN:      { name: 'Kentucky Wildcats',       kenpom: 33, seed: 7, region: 'Midwest', record: '23-13',adjO: 113.5, adjD: 103.0, adjEM: 10.5, tempo: 70.2 },
  MIAMI:    { name: 'Miami Hurricanes',        kenpom: 34, seed: 7, region: 'West',   record: '27-8', adjO: 111.2, adjD: 101.5, adjEM: 9.7, tempo: 65.8 },
  SMARY:    { name: "Saint Mary's Gaels",      kenpom: 35, seed: 7, region: 'South',  record: '29-5', adjO: 108.5, adjD: 99.5, adjEM: 9.0, tempo: 62.2 },
  GA:       { name: 'Georgia Bulldogs',        kenpom: 36, seed: 8, region: 'Midwest', record: '24-10',adjO: 111.0, adjD: 102.5, adjEM: 8.5, tempo: 68.0 },
  CLEM:     { name: 'Clemson Tigers',          kenpom: 38, seed: 8, region: 'South',  record: '26-10',adjO: 109.0, adjD: 101.0, adjEM: 8.0, tempo: 66.5 },
  TCU:      { name: 'TCU Horned Frogs',        kenpom: 39, seed: 9, region: 'East',   record: '24-11',adjO: 112.0, adjD: 104.5, adjEM: 7.5, tempo: 69.0 },
  NOVA:     { name: 'Villanova Wildcats',      kenpom: 40, seed: 8, region: 'West',   record: '26-8', adjO: 110.5, adjD: 103.0, adjEM: 7.5, tempo: 66.0 },
  STLOU:    { name: 'Saint Louis Billikens',   kenpom: 41, seed: 9, region: 'Midwest', record: '30-5', adjO: 108.0, adjD: 101.0, adjEM: 7.0, tempo: 64.5 },
  SCLA:     { name: 'Santa Clara Broncos',     kenpom: 42, seed: 10, region: 'Midwest',record: '28-8', adjO: 110.0, adjD: 103.5, adjEM: 6.5, tempo: 67.0 },
  
  // ===== BUBBLE/CINDERELLA TIER (KenPom 43-70) =====
  TAMU:     { name: 'Texas A&M Aggies',        kenpom: 43, seed: 10, region: 'South', record: '23-11',adjO: 107.5, adjD: 102.0, adjEM: 5.5, tempo: 65.5 },
  UCF:      { name: 'UCF Knights',              kenpom: 54, seed: 10, region: 'East',  record: '23-11',adjO: 108.0, adjD: 104.5, adjEM: 3.5, tempo: 66.0 },
  USF:      { name: 'South Florida Bulls',      kenpom: 55, seed: 11, region: 'East',  record: '27-8', adjO: 107.0, adjD: 104.0, adjEM: 3.0, tempo: 65.2 },
  VCU:      { name: 'VCU Rams',                 kenpom: 56, seed: 11, region: 'South', record: '29-7', adjO: 108.5, adjD: 105.5, adjEM: 3.0, tempo: 69.5 },
  TEX:      { name: 'Texas Longhorns',          kenpom: 44, seed: 11, region: 'West',  record: '20-14',adjO: 112.5, adjD: 105.0, adjEM: 7.5, tempo: 68.5 },
  MOHI:     { name: 'Miami (Ohio) RedHawks',    kenpom: 48, seed: 11, region: 'Midwest',record:'33-2', adjO: 109.0, adjD: 103.0, adjEM: 6.0, tempo: 66.0 },
  HPNT:     { name: 'High Point Panthers',      kenpom: 92, seed: 12, region: 'West',  record: '32-4', adjO: 106.5, adjD: 102.0, adjEM: 4.5, tempo: 68.5 },
  AKRN:     { name: 'Akron Zips',               kenpom: 64, seed: 12, region: 'Midwest',record:'31-5', adjO: 107.0, adjD: 103.5, adjEM: 3.5, tempo: 66.5 },
  NIOWA:    { name: 'Northern Iowa Panthers',    kenpom: 71, seed: 12, region: 'East',  record: '25-12',adjO: 106.0, adjD: 103.0, adjEM: 3.0, tempo: 64.0 },
  MCNEE:    { name: 'McNeese Cowboys',           kenpom: 68, seed: 12, region: 'South', record: '30-5', adjO: 106.5, adjD: 103.5, adjEM: 3.0, tempo: 67.0 },
  MIZZOU:   { name: 'Missouri Tigers',           kenpom: 52, seed: 10, region: 'West',  record: '22-12',adjO: 108.5, adjD: 104.0, adjEM: 4.5, tempo: 67.5 },
  
  // ===== LOWER SEEDS =====
  HOFS:     { name: 'Hofstra Pride',            kenpom: 75, seed: 13, region: 'Midwest',record:'26-10',adjO: 105.0, adjD: 103.5, adjEM: 1.5, tempo: 66.8 },
  CBAP:     { name: 'Cal Baptist Lancers',      kenpom: 106, seed: 13, region: 'East',  record:'27-8', adjO: 104.5, adjD: 105.0, adjEM: -0.5, tempo: 67.0 },
  HAW:      { name: 'Hawaii Rainbow Warriors',  kenpom: 107, seed: 13, region: 'West',  record:'26-8', adjO: 104.0, adjD: 105.5, adjEM: -1.5, tempo: 68.0 },
  TROY:     { name: 'Troy Trojans',              kenpom: 143, seed: 13, region: 'South', record:'24-11',adjO: 102.5, adjD: 105.0, adjEM: -2.5, tempo: 67.5 },
  WRIST:    { name: 'Wright State Raiders',     kenpom: 140, seed: 14, region: 'Midwest',record:'25-11',adjO: 103.0, adjD: 106.0, adjEM: -3.0, tempo: 66.5 },
  NDSU:     { name: 'North Dakota State Bison', kenpom: 113, seed: 14, region: 'East',  record:'29-7', adjO: 104.5, adjD: 105.5, adjEM: -1.0, tempo: 64.5 },
  KENN:     { name: 'Kennesaw State Owls',      kenpom: 163, seed: 14, region: 'West',  record:'23-13',adjO: 102.0, adjD: 106.5, adjEM: -4.5, tempo: 66.0 },
  PENN:     { name: 'Penn Quakers',              kenpom: 159, seed: 14, region: 'South', record:'20-11',adjO: 103.5, adjD: 107.5, adjEM: -4.0, tempo: 64.0 },
  FURM:     { name: 'Furman Paladins',           kenpom: 190, seed: 15, region: 'East',  record:'24-12',adjO: 101.0, adjD: 106.0, adjEM: -5.0, tempo: 65.0 },
  TNST:     { name: 'Tennessee State Tigers',   kenpom: 187, seed: 15, region: 'Midwest',record:'25-9',adjO: 101.5, adjD: 107.0, adjEM: -5.5, tempo: 67.5 },
  IDAHO:    { name: 'Idaho Vandals',             kenpom: 145, seed: 15, region: 'South', record:'23-14',adjO: 103.0, adjD: 106.5, adjEM: -3.5, tempo: 66.0 },
  QNS:      { name: 'Queens Royals',             kenpom: 181, seed: 15, region: 'West',  record:'23-13',adjO: 101.5, adjD: 107.0, adjEM: -5.5, tempo: 65.5 },
  SIENA:    { name: 'Siena Saints',              kenpom: 192, seed: 16, region: 'East',  record:'25-11',adjO: 101.0, adjD: 107.5, adjEM: -6.5, tempo: 64.5 },
  LIU:      { name: 'LIU Sharks',                kenpom: 216, seed: 16, region: 'West',  record:'26-10',adjO: 100.5, adjD: 108.0, adjEM: -7.5, tempo: 65.5 },
  HOWARD:   { name: 'Howard Bison',              kenpom: 207, seed: 16, region: 'Midwest',record:'22-13',adjO: 100.0, adjD: 108.5, adjEM: -8.5, tempo: 66.0 },
  PVA:      { name: 'Prairie View A&M Panthers', kenpom: 288, seed: 16, region: 'South', record:'21-14',adjO: 98.5, adjD: 110.0, adjEM: -11.5, tempo: 67.0 },
  NCST:     { name: 'NC State Wolfpack',          kenpom: 34, seed: 11, region: 'West',  record:'21-14',adjO: 112.0, adjD: 101.0, adjEM: 11.0, tempo: 68.5 },
};

// Round 1 & 2 results for tracking tournament performance
const TOURNAMENT_RESULTS = {
  // Round 1 results (completed)
  round1: [
    // East Region
    { winner: 'DUKE', loser: 'SIENA', score: '71-65', round: 1 },
    { winner: 'TCU', loser: 'OSU', score: '66-64', round: 1 },
    { winner: 'STJN', loser: 'NIOWA', score: '79-53', round: 1 },
    { winner: 'KU', loser: 'CBAP', score: '68-60', round: 1 },
    { winner: 'LVIL', loser: 'USF', score: '83-79', round: 1 },
    { winner: 'MSU', loser: 'NDSU', score: '92-67', round: 1 },
    { winner: 'UCLA', loser: 'UCF', score: '75-71', round: 1 },
    { winner: 'UCON', loser: 'FURM', score: '82-71', round: 1 },
    // West Region
    { winner: 'ARIZ', loser: 'LIU', score: '92-58', round: 1 },
    { winner: 'UTST', loser: 'NOVA', score: '86-76', round: 1 },
    { winner: 'HPNT', loser: 'WISC', score: '83-82', round: 1 },
    { winner: 'ARK', loser: 'HAW', score: '97-78', round: 1 },
    { winner: 'TEX', loser: 'BYU', score: '79-71', round: 1 },
    { winner: 'GONZ', loser: 'KENN', score: '73-64', round: 1 },
    { winner: 'MIAMI', loser: 'MIZZOU', score: '80-66', round: 1 },
    { winner: 'PUR', loser: 'QNS', score: '104-71', round: 1 },
    // Midwest Region
    { winner: 'MICH', loser: 'HOWARD', score: '101-80', round: 1 },
    { winner: 'STLOU', loser: 'GA', score: '102-77', round: 1 },
    { winner: 'TTECH', loser: 'AKRN', score: '91-71', round: 1 },
    { winner: 'BAMA', loser: 'HOFS', score: '90-70', round: 1 },
    { winner: 'TENN', loser: 'MOHI', score: '78-56', round: 1 },
    { winner: 'UVA', loser: 'WRIST', score: '82-73', round: 1 },
    { winner: 'KEN', loser: 'SCLA', score: '89-84', round: 1 },
    { winner: 'IAST', loser: 'TNST', score: '108-74', round: 1 },
    // South Region
    { winner: 'FLA', loser: 'PVA', score: '114-55', round: 1 },
    { winner: 'IOWA', loser: 'CLEM', score: '67-61', round: 1 },
    { winner: 'VAND', loser: 'MCNEE', score: '78-68', round: 1 },
    { winner: 'NEB', loser: 'TROY', score: '76-47', round: 1 },
    { winner: 'VCU', loser: 'UNC', score: '82-78', round: 1, notes: 'OT' },
    { winner: 'ILL', loser: 'PENN', score: '105-70', round: 1 },
    { winner: 'TAMU', loser: 'SMARY', score: '63-50', round: 1 },
    { winner: 'HOU', loser: 'IDAHO', score: '78-47', round: 1 },
  ],
  // Round 2 results (completed today March 22)
  round2: [
    // Completed
    { winner: 'MICH', loser: 'STLOU', score: '95-72', round: 2 },
    { winner: 'MSU', loser: 'LVIL', score: '77-69', round: 2 },
    { winner: 'DUKE', loser: 'TCU', score: '81-58', round: 2 },
    { winner: 'HOU', loser: 'TAMU', score: '88-57', round: 2 },
    { winner: 'TEX', loser: 'GONZ', score: '74-68', round: 2, notes: '11 seed upset over 3 seed!' },
    { winner: 'ILL', loser: 'VCU', score: '76-55', round: 2 },
    { winner: 'NEB', loser: 'VAND', score: '74-72', round: 2 },
    { winner: 'ARK', loser: 'HPNT', score: '94-88', round: 2 },
    { winner: 'PUR', loser: 'MIAMI', score: '79-69', round: 2 },
    { winner: 'IAST', loser: 'KEN', score: '82-63', round: 2 },
    { winner: 'STJN', loser: 'KU', score: '67-65', round: 2, notes: '5 seed over 4 seed — Dylan Darling buzzer-beater layup!' },
    { winner: 'TENN', loser: 'UVA', score: '79-72', round: 2, notes: '6 seed over 3 seed' },
    { winner: 'IOWA', loser: 'FLA', score: '73-72', round: 2, notes: '9 seed over 1 seed! Folgueiras 3 with 4sec left. #1 overall seed GONE.' },
    // Arizona vs Utah State — TBD (late March 22 game)
    // UConn vs UCLA — TBD (late March 22 game)
    // Alabama vs Texas Tech — TBD (late March 22 game)
  ]
};

/**
 * Predict NCAA game outcome
 * @param {string} away - Away team abbreviation
 * @param {string} home - Home team abbreviation (note: tournament = neutral court)
 * @param {object} opts - Options: { round, neutralCourt, tourneyAdj }
 * @returns Prediction object with win probs, spread, total, value analysis
 */
function predict(away, home, opts = {}) {
  const awayTeam = TEAMS[away];
  const homeTeam = TEAMS[home];
  
  if (!awayTeam || !homeTeam) {
    return { error: `Team not found: ${!awayTeam ? away : home}` };
  }
  
  const round = opts.round || 'Sweet 16';
  const isNeutral = opts.neutralCourt !== false; // Default true for tourney
  
  // === CORE EFFICIENCY MODEL ===
  // Project each team's points per 100 possessions against this specific opponent
  // Team A's offense vs Team B's defense, adjusted to national average
  const awayOffEff = awayTeam.adjO;
  const awayDefEff = awayTeam.adjD;
  const homeOffEff = homeTeam.adjO;
  const homeDefEff = homeTeam.adjD;
  
  // Adjusted efficiencies for this matchup
  // Each team's offense against the opponent's defense, relative to average
  const awayProjOff = (awayOffEff + homeDefEff) / 2;
  const homeProjOff = (homeOffEff + awayDefEff) / 2;
  
  // Tournament defensive premium: defense is more impactful in single-elimination
  const defAdj = opts.tourneyAdj !== false ? TOURNAMENT_DEF_PREMIUM : 1.0;
  const awayProjOffAdj = awayProjOff - (homeDefEff < AVG_EFFICIENCY ? (AVG_EFFICIENCY - homeDefEff) * (defAdj - 1) : 0);
  const homeProjOffAdj = homeProjOff - (awayDefEff < AVG_EFFICIENCY ? (AVG_EFFICIENCY - awayDefEff) * (defAdj - 1) : 0);
  
  // Game tempo: average of both teams' tempos, regressed slightly to mean
  const gameTempo = (awayTeam.tempo + homeTeam.tempo + AVG_TEMPO) / 3;
  
  // Projected scores
  const awayProjScore = (awayProjOffAdj * gameTempo) / 100;
  const homeProjScore = (homeProjOffAdj * gameTempo) / 100;
  
  // Spread (negative = home favored)
  const spread = awayProjScore - homeProjScore;
  const projTotal = awayProjScore + homeProjScore;
  
  // === WIN PROBABILITY ===
  // Logistic model: P(away wins) = 1 / (1 + 10^(-spread / factor))
  const awayWinProb = 1 / (1 + Math.pow(10, -spread / SPREAD_TO_PROB_FACTOR));
  const homeWinProb = 1 - awayWinProb;
  
  // === SEED-BASED HISTORICAL ADJUSTMENT ===
  // Blend KenPom prediction with historical seed upset rates
  const seedKey = getSeedMatchupKey(awayTeam.seed, homeTeam.seed);
  let historicalAdj = null;
  if (seedKey) {
    const higherSeedWinRate = SEED_UPSET_RATES[seedKey];
    if (higherSeedWinRate !== undefined) {
      // Determine which team is the higher (better) seed
      const awayIsHigherSeed = awayTeam.seed < homeTeam.seed;
      const histAwayWin = awayIsHigherSeed ? (1 - higherSeedWinRate) : higherSeedWinRate;
      historicalAdj = {
        seedMatchup: seedKey,
        historicalUpsetRate: higherSeedWinRate,
        histAwayWinProb: histAwayWin,
        histHomeWinProb: 1 - histAwayWin
      };
    }
  }
  
  // Blended probability: 80% KenPom model, 20% historical seed data
  let blendedAwayWin = awayWinProb;
  let blendedHomeWin = homeWinProb;
  if (historicalAdj) {
    blendedAwayWin = 0.80 * awayWinProb + 0.20 * historicalAdj.histAwayWinProb;
    blendedHomeWin = 1 - blendedAwayWin;
  }
  
  // === TOURNAMENT MOMENTUM ADJUSTMENT ===
  // Teams blowing out opponents are "hot" — adjust predictions by up to 3%
  // Teams that barely survived get a slight penalty
  let momentumAdj = null;
  const awayMomentum = calculateTourneyMomentum(away);
  const homeMomentum = calculateTourneyMomentum(home);
  if (awayMomentum || homeMomentum) {
    const awayBoost = (awayMomentum?.momentumScore || 0) * 0.03; // max ±3%
    const homeBoost = (homeMomentum?.momentumScore || 0) * 0.03;
    const netBoost = awayBoost - homeBoost;
    
    blendedAwayWin = Math.max(0.02, Math.min(0.98, blendedAwayWin + netBoost));
    blendedHomeWin = 1 - blendedAwayWin;
    
    momentumAdj = {
      awayMomentum: awayMomentum?.label || 'NEUTRAL',
      homeMomentum: homeMomentum?.label || 'NEUTRAL',
      awayAvgMOV: awayMomentum?.avgMOV || 0,
      homeAvgMOV: homeMomentum?.avgMOV || 0,
      netProbShift: +(netBoost * 100).toFixed(1)
    };
  }
  
  // === MATCHUP ANALYSIS ===
  const matchup = analyzeMatchup(awayTeam, homeTeam);
  
  // === TOURNAMENT PERFORMANCE TRACKING ===
  const awayTourneyPerf = getTourneyPerformance(away);
  const homeTourneyPerf = getTourneyPerformance(home);
  
  return {
    away: away,
    home: home,
    awayName: awayTeam.name,
    homeName: homeTeam.name,
    awaySeed: awayTeam.seed,
    homeSeed: homeTeam.seed,
    awayRegion: awayTeam.region,
    homeRegion: homeTeam.region,
    awayKenpom: awayTeam.kenpom,
    homeKenpom: homeTeam.kenpom,
    awayRecord: awayTeam.record,
    homeRecord: homeTeam.record,
    round,
    neutralCourt: isNeutral,
    // Core predictions
    spread: +spread.toFixed(1),
    projTotal: +projTotal.toFixed(1),
    awayProjScore: +awayProjScore.toFixed(1),
    homeProjScore: +homeProjScore.toFixed(1),
    // Win probabilities
    modelAwayWinProb: +awayWinProb.toFixed(4),
    modelHomeWinProb: +homeWinProb.toFixed(4),
    blendedAwayWinProb: +blendedAwayWin.toFixed(4),
    blendedHomeWinProb: +blendedHomeWin.toFixed(4),
    // Implied moneylines
    awayML: probToML(blendedAwayWin),
    homeML: probToML(blendedHomeWin),
    // Totals
    overProb: calculateOverProb(projTotal, getDefaultTotal(projTotal)),
    underProb: 1 - calculateOverProb(projTotal, getDefaultTotal(projTotal)),
    defaultTotal: getDefaultTotal(projTotal),
    // Analysis
    matchup,
    historicalAdj,
    momentumAdj,
    awayTourneyPerf,
    homeTourneyPerf,
    // Efficiency data
    efficiency: {
      away: { adjO: awayTeam.adjO, adjD: awayTeam.adjD, adjEM: awayTeam.adjEM, tempo: awayTeam.tempo },
      home: { adjO: homeTeam.adjO, adjD: homeTeam.adjD, adjEM: homeTeam.adjEM, tempo: homeTeam.tempo }
    }
  };
}

/**
 * Analyze matchup dynamics
 */
function analyzeMatchup(away, home) {
  const offGap = away.adjO - home.adjO;
  const defGap = away.adjD - home.adjD; // Lower is better for defense
  const tempoGap = away.tempo - home.tempo;
  
  const insights = [];
  
  // Offensive advantage
  if (Math.abs(offGap) > 5) {
    const better = offGap > 0 ? away.name : home.name;
    insights.push(`🏀 ${better} has significant offensive edge (${Math.abs(offGap).toFixed(1)} pts/100 poss)`);
  }
  
  // Defensive advantage
  if (Math.abs(defGap) > 5) {
    const better = defGap < 0 ? away.name : home.name; // Lower AdjD = better defense
    insights.push(`🛡️ ${better} has significant defensive edge (${Math.abs(defGap).toFixed(1)} pts/100 poss)`);
  }
  
  // Tempo mismatch
  if (Math.abs(tempoGap) > 5) {
    const faster = tempoGap > 0 ? away.name : home.name;
    const slower = tempoGap > 0 ? home.name : away.name;
    insights.push(`⏱️ Tempo clash: ${faster} wants to run (${Math.max(away.tempo, home.tempo).toFixed(1)}) vs ${slower} wants to grind (${Math.min(away.tempo, home.tempo).toFixed(1)})`);
  }
  
  // Elite offense vs elite defense
  if ((away.adjO > 118 && home.adjD < 92) || (home.adjO > 118 && away.adjD < 92)) {
    insights.push('⚔️ ELITE OFFENSE vs ELITE DEFENSE — classic March Madness matchup');
  }
  
  // KenPom gap analysis
  const kenpomGap = Math.abs(away.kenpom - home.kenpom);
  if (kenpomGap > 15) {
    insights.push(`📊 Large KenPom gap (${kenpomGap} spots) — favorite should cover`);
  } else if (kenpomGap < 5) {
    insights.push(`📊 Tight KenPom matchup (${kenpomGap} spots apart) — coin flip territory`);
  }
  
  // Defensive team in tournament advantage
  const awayDef = away.adjD;
  const homeDef = home.adjD;
  if (awayDef < 90 || homeDef < 90) {
    const eliteDef = awayDef < homeDef ? away.name : home.name;
    insights.push(`🏆 ${eliteDef} has ELITE defense — historically crucial in March`);
  }
  
  return {
    offensiveEdge: offGap > 0 ? 'away' : 'home',
    defensiveEdge: defGap < 0 ? 'away' : 'home',
    tempoEdge: tempoGap > 0 ? 'away' : 'home',
    kenpomGap,
    insights
  };
}

/**
 * Calculate tournament momentum score for a team
 * Based on margin of victory in tournament games so far
 */
function calculateTourneyMomentum(abbr) {
  const allResults = [
    ...(TOURNAMENT_RESULTS.round1 || []),
    ...(TOURNAMENT_RESULTS.round2 || []),
    ...(TOURNAMENT_RESULTS.round3 || []),
    ...(TOURNAMENT_RESULTS.round4 || []),
    ...(TOURNAMENT_RESULTS.round5 || []),
  ];
  
  const wins = allResults.filter(r => r.winner === abbr);
  const losses = allResults.filter(r => r.loser === abbr);
  
  if (wins.length === 0 && losses.length === 0) return null;
  
  let totalMOV = 0;
  let gamesWithScores = 0;
  
  for (const w of wins) {
    if (w.score) {
      const [high, low] = w.score.split('-').map(Number);
      if (!isNaN(high) && !isNaN(low)) {
        totalMOV += (high - low);
        gamesWithScores++;
      }
    }
  }
  
  const avgMOV = gamesWithScores > 0 ? totalMOV / gamesWithScores : 0;
  
  // Momentum score: -1 to +1 scale  
  // +25 MOV = max momentum (dominant performance)
  const momentumRaw = Math.max(-1, Math.min(1, avgMOV / 25));
  
  let label = 'NEUTRAL';
  if (momentumRaw > 0.6) label = 'DOMINANT';
  else if (momentumRaw > 0.3) label = 'HOT';
  else if (momentumRaw > 0.1) label = 'WARM';
  else if (momentumRaw < 0) label = 'COOL';
  
  return {
    wins: wins.length,
    losses: losses.length,
    avgMOV: gamesWithScores > 0 ? +(totalMOV / gamesWithScores).toFixed(1) : 0,
    momentumScore: +momentumRaw.toFixed(3),
    label
  };
}

/**
 * Get tournament performance for a team (how they've done so far)
 */
function getTourneyPerformance(abbr) {
  const allResults = [...(TOURNAMENT_RESULTS.round1 || []), ...(TOURNAMENT_RESULTS.round2 || [])];
  const wins = allResults.filter(r => r.winner === abbr);
  const losses = allResults.filter(r => r.loser === abbr);
  
  if (wins.length === 0 && losses.length === 0) return null;
  
  return {
    wins: wins.length,
    losses: losses.length,
    results: [...wins.map(w => ({ result: 'W', score: w.score, round: w.round, vs: w.loser, notes: w.notes })),
              ...losses.map(l => ({ result: 'L', score: l.score, round: l.round, vs: l.winner, notes: l.notes }))]
  };
}

/**
 * Value detection: compare model probability to market odds
 */
function detectValue(away, home, marketOdds = {}) {
  const pred = predict(away, home);
  if (pred.error) return pred;
  
  const values = [];
  
  // Check moneyline value
  if (marketOdds.awayML) {
    const impliedProb = mlToProb(marketOdds.awayML);
    const edge = pred.blendedAwayWinProb - impliedProb;
    if (edge > 0.03) { // 3%+ edge
      values.push({
        bet: `${pred.awayName} ML`,
        modelProb: pred.blendedAwayWinProb,
        marketProb: impliedProb,
        edge: +(edge * 100).toFixed(1),
        marketML: marketOdds.awayML,
        fairML: pred.awayML,
        confidence: edge > 0.08 ? 'HIGH' : edge > 0.05 ? 'MEDIUM' : 'LOW',
        kellyFraction: calculateKelly(pred.blendedAwayWinProb, marketOdds.awayML)
      });
    }
  }
  
  if (marketOdds.homeML) {
    const impliedProb = mlToProb(marketOdds.homeML);
    const edge = pred.blendedHomeWinProb - impliedProb;
    if (edge > 0.03) {
      values.push({
        bet: `${pred.homeName} ML`,
        modelProb: pred.blendedHomeWinProb,
        marketProb: impliedProb,
        edge: +(edge * 100).toFixed(1),
        marketML: marketOdds.homeML,
        fairML: pred.homeML,
        confidence: edge > 0.08 ? 'HIGH' : edge > 0.05 ? 'MEDIUM' : 'LOW',
        kellyFraction: calculateKelly(pred.blendedHomeWinProb, marketOdds.homeML)
      });
    }
  }
  
  // Check spread value
  if (marketOdds.spread !== undefined) {
    const spreadEdge = pred.spread - marketOdds.spread;
    if (Math.abs(spreadEdge) > 1.5) {
      values.push({
        bet: spreadEdge > 0 ? `${pred.awayName} +${marketOdds.spread}` : `${pred.homeName} ${-marketOdds.spread}`,
        modelSpread: pred.spread,
        marketSpread: marketOdds.spread,
        edge: +Math.abs(spreadEdge).toFixed(1),
        confidence: Math.abs(spreadEdge) > 3 ? 'HIGH' : 'MEDIUM'
      });
    }
  }
  
  // Check total value
  if (marketOdds.total !== undefined) {
    const totalEdge = pred.projTotal - marketOdds.total;
    if (Math.abs(totalEdge) > 3) {
      values.push({
        bet: totalEdge > 0 ? `OVER ${marketOdds.total}` : `UNDER ${marketOdds.total}`,
        modelTotal: pred.projTotal,
        marketTotal: marketOdds.total,
        edge: +Math.abs(totalEdge).toFixed(1),
        confidence: Math.abs(totalEdge) > 5 ? 'HIGH' : 'MEDIUM'
      });
    }
  }
  
  return {
    prediction: pred,
    valueBets: values,
    hasValue: values.length > 0
  };
}

/**
 * Simulate full tournament bracket from current state
 * @param {number} sims - Number of simulations
 * @returns Championship probabilities for each remaining team
 */
function simulateBracket(sims = 10000) {
  // Get remaining teams in each region based on results so far
  const regions = {
    East: getRegionSurvivors('East'),
    West: getRegionSurvivors('West'),
    Midwest: getRegionSurvivors('Midwest'),
    South: getRegionSurvivors('South')
  };
  
  const champCounts = {};
  const finalFourCounts = {};
  const eliteEightCounts = {};
  
  for (let i = 0; i < sims; i++) {
    // Simulate each region
    const regionWinners = {};
    for (const [region, teams] of Object.entries(regions)) {
      const regionResult = simulateRegion(teams);
      regionWinners[region] = regionResult.winner;
      // Track Elite Eight
      for (const team of regionResult.eliteEight || []) {
        eliteEightCounts[team] = (eliteEightCounts[team] || 0) + 1;
      }
    }
    
    // Final Four
    for (const winner of Object.values(regionWinners)) {
      finalFourCounts[winner] = (finalFourCounts[winner] || 0) + 1;
    }
    
    // Semifinals
    const semi1Winner = simulateGame(regionWinners.East, regionWinners.West);
    const semi2Winner = simulateGame(regionWinners.South, regionWinners.Midwest);
    
    // Championship
    const champ = simulateGame(semi1Winner, semi2Winner);
    champCounts[champ] = (champCounts[champ] || 0) + 1;
  }
  
  // Convert to probabilities
  const results = [];
  const allTeams = new Set([...Object.keys(champCounts), ...Object.keys(finalFourCounts)]);
  
  for (const team of allTeams) {
    const t = TEAMS[team];
    if (!t) continue;
    results.push({
      team,
      name: t.name,
      seed: t.seed,
      region: t.region,
      kenpom: t.kenpom,
      champProb: +((champCounts[team] || 0) / sims * 100).toFixed(1),
      finalFourProb: +((finalFourCounts[team] || 0) / sims * 100).toFixed(1),
      eliteEightProb: +((eliteEightCounts[team] || 0) / sims * 100).toFixed(1)
    });
  }
  
  results.sort((a, b) => b.champProb - a.champProb);
  return { sims, results };
}

/**
 * Simulate a single game between two teams
 * Returns the winner's abbreviation
 */
function simulateGame(away, home) {
  const awayTeam = TEAMS[away];
  const homeTeam = TEAMS[home];
  if (!awayTeam || !homeTeam) return away; // fallback
  
  const pred = predict(away, home);
  const r = Math.random();
  return r < pred.blendedAwayWinProb ? away : home;
}

/**
 * Simulate a region bracket from Sweet 16 onward
 */
function simulateRegion(teams) {
  if (!teams || teams.length === 0) return { winner: null };
  if (teams.length === 1) return { winner: teams[0] };
  
  // Sweet 16 → Elite Eight → Region Final
  const eliteEight = [];
  for (let i = 0; i < teams.length; i += 2) {
    if (i + 1 < teams.length) {
      const winner = simulateGame(teams[i], teams[i + 1]);
      eliteEight.push(winner);
    } else {
      eliteEight.push(teams[i]);
    }
  }
  
  const regionFinal = [];
  for (let i = 0; i < eliteEight.length; i += 2) {
    if (i + 1 < eliteEight.length) {
      regionFinal.push(simulateGame(eliteEight[i], eliteEight[i + 1]));
    } else {
      regionFinal.push(eliteEight[i]);
    }
  }
  
  return {
    winner: regionFinal[0],
    eliteEight
  };
}

/**
 * Get surviving teams in a region after Round 1 & 2
 */
function getRegionSurvivors(region) {
  // Teams that won both Round 1 and Round 2 are in Sweet 16
  const round2Winners = new Set(TOURNAMENT_RESULTS.round2.map(r => r.winner));
  
  // Filter teams in this region that are in Sweet 16 (won round 2)
  const survivors = Object.entries(TEAMS)
    .filter(([abbr, t]) => t.region === region && round2Winners.has(abbr))
    .map(([abbr]) => abbr);
  
  // Also include teams whose round 2 game hasn't been played yet
  // (they won round 1 but round 2 isn't complete)
  const round1Winners = new Set(TOURNAMENT_RESULTS.round1.map(r => r.winner));
  const round2Teams = new Set([
    ...TOURNAMENT_RESULTS.round2.map(r => r.winner),
    ...TOURNAMENT_RESULTS.round2.map(r => r.loser)
  ]);
  
  const pendingRound2 = Object.entries(TEAMS)
    .filter(([abbr, t]) => t.region === region && round1Winners.has(abbr) && !round2Teams.has(abbr))
    .map(([abbr]) => abbr);
  
  return [...survivors, ...pendingRound2];
}

/**
 * Get all upcoming Sweet 16 matchups
 */
function getSweet16Matchups() {
  // Based on bracket structure
  // East: 1 Duke vs [4 Kansas/5 St. John's], 3 Michigan State vs [2 UConn/7 UCLA]
  // West: 1 Arizona vs [4 Arkansas/12 High Point → now ARK], 11 Texas vs 2 Purdue
  // Midwest: 1 Michigan vs [5 Texas Tech/4 Alabama], [3 Virginia/6 Tennessee] vs 2 Iowa State vs [7 Kentucky]
  // South: 1 Florida vs [9 Iowa], 4 Nebraska vs [3 Illinois/2 Houston]
  
  // Known Sweet 16 matchups from completed Round 2:
  const known = [
    // East (partially set)
    { away: 'MSU', home: 'DUKE', region: 'East', notes: '3 Michigan St vs 1 Duke' },
    // West
    { away: 'ARK', home: 'ARIZ', region: 'West', notes: '4 Arkansas vs 1 Arizona' },
    { away: 'TEX', home: 'PUR', region: 'West', notes: '11 Texas vs 2 Purdue' },
    // South
    { away: 'NEB', home: 'HOU', region: 'South', notes: '4 Nebraska vs 2 Houston' },
    { away: 'ILL', home: 'FLA', region: 'South', notes: '3 Illinois vs 1 Florida (pending FLA Round 2)' },
  ];
  
  // Pending Round 2 games will determine remaining Sweet 16
  const pending = [
    { game: 'Iowa State vs Kentucky', seeds: '2 vs 7', region: 'Midwest' },
    { game: 'Kansas vs St. John\'s', seeds: '4 vs 5', region: 'East' },
    { game: 'Virginia vs Tennessee', seeds: '3 vs 6', region: 'Midwest' },
    { game: 'Florida vs Iowa', seeds: '1 vs 9', region: 'South' },
    { game: 'Arizona vs Utah State', seeds: '1 vs 9', region: 'West' },
    { game: 'UConn vs UCLA', seeds: '2 vs 7', region: 'East' },
    { game: 'Alabama vs Texas Tech', seeds: '4 vs 5', region: 'Midwest' },
  ];
  
  return { known, pending };
}

/**
 * Generate March Madness value report
 */
function generateReport() {
  const sweet16 = getSweet16Matchups();
  const bracketSim = simulateBracket(10000);
  
  // Predict all known Sweet 16 matchups
  const predictions = sweet16.known.map(m => ({
    ...m,
    prediction: predict(m.away, m.home, { round: 'Sweet 16' })
  }));
  
  // Predict pending Round 2 games
  const pendingPredictions = sweet16.pending.map(p => {
    // Parse teams from game string
    const [away, home] = p.game.split(' vs ').map(t => t.trim());
    // Try to find team abbreviations
    const awayAbbr = findTeamAbbr(away);
    const homeAbbr = findTeamAbbr(home);
    if (awayAbbr && homeAbbr) {
      return { ...p, prediction: predict(awayAbbr, homeAbbr, { round: 'Round 2' }) };
    }
    return { ...p, prediction: null };
  });
  
  return {
    title: '🏀 NCAA March Madness Model Report',
    generatedAt: new Date().toISOString(),
    tournament: {
      round: 'Round 2 in progress / Sweet 16 upcoming',
      completedGames: TOURNAMENT_RESULTS.round1.length + TOURNAMENT_RESULTS.round2.length,
    },
    sweet16Predictions: predictions,
    pendingRound2: pendingPredictions,
    championshipOdds: bracketSim.results.slice(0, 16),
    topValuePlays: identifyTopValuePlays()
  };
}

/**
 * Identify top value plays based on common market mispricing patterns
 */
function identifyTopValuePlays() {
  const plays = [];
  
  // Underseeded teams (KenPom much better than seed suggests)
  const underseeded = Object.entries(TEAMS)
    .filter(([_, t]) => {
      const expectedSeed = Math.ceil(t.kenpom / 4.5); // Rough expected seed from KenPom
      return t.seed > expectedSeed + 1;
    })
    .map(([abbr, t]) => ({ abbr, ...t, seedDiscount: t.seed - Math.ceil(t.kenpom / 4.5) }))
    .sort((a, b) => b.seedDiscount - a.seedDiscount);
  
  for (const team of underseeded.slice(0, 5)) {
    plays.push({
      type: 'UNDERSEEDED',
      team: team.name,
      seed: team.seed,
      kenpom: team.kenpom,
      insight: `Seeded ${team.seed} but KenPom ranks them #${team.kenpom} — public undervalues this team`
    });
  }
  
  // Tournament unders edge
  plays.push({
    type: 'SYSTEMATIC',
    insight: 'NCAA Tournament unders hit at ~53% historically — pressure + defense + unfamiliar opponents',
    strategy: 'Lean under on totals, especially in later rounds and mismatched tempos'
  });
  
  // Defense wins championships
  const eliteDefTeams = Object.entries(TEAMS)
    .filter(([_, t]) => t.adjD < 92)
    .map(([abbr, t]) => ({ abbr, ...t }))
    .sort((a, b) => a.adjD - b.adjD);
  
  if (eliteDefTeams.length > 0) {
    plays.push({
      type: 'DEFENSE_PREMIUM',
      teams: eliteDefTeams.map(t => `${t.name} (AdjD: ${t.adjD})`),
      insight: 'Elite defensive teams historically overperform in March — defense travels, offense doesn\'t'
    });
  }
  
  return plays;
}

// ==================== HELPER FUNCTIONS ====================

function getSeedMatchupKey(seed1, seed2) {
  const high = Math.min(seed1, seed2);
  const low = Math.max(seed1, seed2);
  const key = `${high}v${low}`;
  return SEED_UPSET_RATES[key] !== undefined ? key : null;
}

function probToML(prob) {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  } else {
    return Math.round(100 * (1 - prob) / prob);
  }
}

function mlToProb(ml) {
  if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
  return 100 / (ml + 100);
}

function calculateKelly(prob, ml) {
  const payoff = ml > 0 ? ml / 100 : 100 / Math.abs(ml);
  const kelly = (prob * payoff - (1 - prob)) / payoff;
  return Math.max(0, +(kelly * 100).toFixed(1)); // As percentage
}

function calculateOverProb(projTotal, line) {
  // Simple normal approximation for over/under
  const stdDev = 10; // NCAA games have ~10 point standard deviation on totals
  const z = (line - projTotal) / stdDev;
  // Standard normal CDF approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422802 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}

function getDefaultTotal(projTotal) {
  return Math.round(projTotal * 2) / 2; // Round to nearest 0.5
}

function findTeamAbbr(name) {
  const lower = name.toLowerCase().trim();
  for (const [abbr, t] of Object.entries(TEAMS)) {
    if (t.name.toLowerCase().includes(lower)) return abbr;
    // Check common names
    const parts = t.name.split(' ');
    if (parts.some(p => p.toLowerCase() === lower)) return abbr;
  }
  // Hardcoded aliases
  const aliases = {
    'iowa state': 'IAST', 'iowa st': 'IAST', 'cyclones': 'IAST',
    'michigan state': 'MSU', 'mich st': 'MSU', 'spartans': 'MSU',
    'michigan': 'MICH', 'wolverines': 'MICH',
    'duke': 'DUKE', 'blue devils': 'DUKE',
    'arizona': 'ARIZ', 'wildcats': 'ARIZ',
    'florida': 'FLA', 'gators': 'FLA',
    'houston': 'HOU', 'cougars': 'HOU',
    'illinois': 'ILL', 'fighting illini': 'ILL', 'illini': 'ILL',
    'purdue': 'PUR', 'boilermakers': 'PUR',
    'gonzaga': 'GONZ', 'zags': 'GONZ', 'bulldogs': 'GONZ',
    'uconn': 'UCON', 'connecticut': 'UCON', 'huskies': 'UCON',
    'virginia': 'UVA', 'cavaliers': 'UVA',
    'nebraska': 'NEB', 'cornhuskers': 'NEB',
    'tennessee': 'TENN', 'volunteers': 'TENN', 'vols': 'TENN',
    'kentucky': 'KEN', 'wildcats uk': 'KEN',
    'kansas': 'KU', 'jayhawks': 'KU',
    "st. john's": 'STJN', 'st johns': 'STJN', 'red storm': 'STJN',
    'alabama': 'BAMA', 'crimson tide': 'BAMA',
    'texas tech': 'TTECH', 'red raiders': 'TTECH',
    'arkansas': 'ARK', 'razorbacks': 'ARK',
    'vanderbilt': 'VAND', 'commodores': 'VAND', 'vandy': 'VAND',
    'texas': 'TEX', 'longhorns': 'TEX',
    'ucla': 'UCLA', 'bruins': 'UCLA',
    'iowa': 'IOWA', 'hawkeyes': 'IOWA',
    'ohio state': 'OSU', 'buckeyes': 'OSU',
    'utah state': 'UTST', 'aggies utst': 'UTST',
    'louisville': 'LVIL', 'cardinals': 'LVIL',
    'north carolina': 'UNC', 'tar heels': 'UNC', 'unc': 'UNC',
    'byu': 'BYU',
    'miami': 'MIAMI',
    'high point': 'HPNT', 'panthers hp': 'HPNT',
  };
  return aliases[lower] || null;
}

/**
 * Add a result dynamically (from API)
 * @param {number} round - Round number (1 or 2)
 * @param {string} winner - Winner abbreviation
 * @param {string} loser - Loser abbreviation
 * @param {string} score - Score string (e.g. '85-72')
 * @param {string} notes - Optional notes
 */
function addResult(round, winner, loser, score, notes) {
  const roundKey = round === 1 ? 'round1' : round === 2 ? 'round2' : `round${round}`;
  if (!TOURNAMENT_RESULTS[roundKey]) TOURNAMENT_RESULTS[roundKey] = [];
  
  // Check if result already exists
  const exists = TOURNAMENT_RESULTS[roundKey].some(r => 
    r.winner === winner && r.loser === loser
  );
  if (exists) return { status: 'already_exists' };
  
  TOURNAMENT_RESULTS[roundKey].push({ winner, loser, score, round, notes });
  return { status: 'added', round, winner, loser, score };
}

/**
 * Get the current state of remaining teams per region
 */
function getBracketState() {
  const regions = {};
  const regionNames = ['East', 'West', 'Midwest', 'South'];
  
  for (const region of regionNames) {
    const survivors = getRegionSurvivors(region);
    regions[region] = {
      teamsRemaining: survivors.length,
      teams: survivors.map(abbr => ({
        abbr,
        name: TEAMS[abbr]?.name || abbr,
        seed: TEAMS[abbr]?.seed,
        kenpom: TEAMS[abbr]?.kenpom,
        record: TEAMS[abbr]?.record
      }))
    };
  }
  
  return {
    regions,
    totalTeamsRemaining: Object.values(regions).reduce((s, r) => s + r.teamsRemaining, 0),
    round1Complete: TOURNAMENT_RESULTS.round1.length === 32,
    round2Complete: TOURNAMENT_RESULTS.round2.length === 16,
    currentRound: TOURNAMENT_RESULTS.round2.length === 16 ? 'Sweet 16' : 
                  TOURNAMENT_RESULTS.round2.length > 0 ? 'Round 2 (in progress)' : 
                  'Round 1'
  };
}

module.exports = {
  TEAMS,
  TOURNAMENT_RESULTS,
  predict,
  detectValue,
  simulateBracket,
  getSweet16Matchups,
  generateReport,
  findTeamAbbr,
  getTourneyPerformance,
  calculateTourneyMomentum,
  identifyTopValuePlays,
  addResult,
  getBracketState
};
