// services/pitcher-k-props.js — Pitcher Strikeout Props Model v70.0
// Uses Steamer/ZiPS K/9 projections + team batting K% + park/weather adjustments
// Opening Day starters go deeper (5.8 IP vs 5.5) + rusty batters K more in Week 1
// Historical edge: Ace K prop OVERS are profitable on Opening Day
//
// Model: Expected Ks = (K/9 × projected IP / 9) × oppTeamKAdj × parkKFactor × weatherKMult × openerPremium
// Compare to DraftKings/FanDuel K prop lines for +EV detection

// ==================== STEAMER 2026 K/9 PROJECTIONS ====================
// Source: FanGraphs Steamer + ZiPS blend for 2026 season
// These are projected K/9 rates — more predictive than raw 2025 stats
// Format: { k9, xK9 (Savant expected), ip (projected), hand, team }
const STEAMER_K9_PROJECTIONS = {
  // === OD Day 1 Starters (March 26) ===
  'Paul Skenes':       { k9: 10.99, xK9: 11.20, ip: 185, hand: 'R', team: 'PIT', tier: 1, note: 'Elite stuff, 2nd year breakout candidate' },
  'Freddy Peralta':    { k9: 9.42, xK9: 9.60, ip: 170, hand: 'R', team: 'NYM', tier: 2, note: 'Acquired by NYM, high K rate but walks' },
  'Shane Smith':       { k9: 8.90, xK9: 8.50, ip: 150, hand: 'R', team: 'CWS', tier: 3, note: '2025 breakout rookie, CWS OD starter' },
  'Jacob Misiorowski': { k9: 9.50, xK9: 9.80, ip: 140, hand: 'R', team: 'MIL', tier: 2, note: 'Electric stuff, high K upside' },
  'Cade Cavalli':      { k9: 8.20, xK9: 8.40, ip: 130, hand: 'R', team: 'WSH', tier: 3, note: 'High ceiling, inconsistent' },
  'Matthew Boyd':      { k9: 8.50, xK9: 8.30, ip: 145, hand: 'L', team: 'CHC', tier: 3, note: 'Veteran, steady not spectacular' },
  'Joe Ryan':          { k9: 10.00, xK9: 10.20, ip: 175, hand: 'R', team: 'MIN', tier: 2, note: 'Elite K rate, pitch design master' },
  'Trevor Rogers':     { k9: 8.50, xK9: 8.70, ip: 140, hand: 'L', team: 'BAL', tier: 2, note: '2025 breakout 1.81 ERA, now BAL OD starter' },
  'Garrett Crochet':   { k9: 11.14, xK9: 11.40, ip: 170, hand: 'L', team: 'BOS', tier: 1, note: 'Highest K/9 in MLB, elite LHP' },
  'Andrew Abbott':     { k9: 8.80, xK9: 8.60, ip: 160, hand: 'L', team: 'CIN', tier: 2, note: 'CIN OD starter, solid K rate' },
  'Jose Soriano':      { k9: 8.20, xK9: 8.00, ip: 140, hand: 'R', team: 'LAA', tier: 3, note: 'LAA #1, developing arm' },
  'Hunter Brown':      { k9: 9.50, xK9: 9.30, ip: 175, hand: 'R', team: 'HOU', tier: 2, note: 'HOU OD starter, high velo' },
  'Tarik Skubal':      { k9: 10.94, xK9: 11.10, ip: 200, hand: 'L', team: 'DET', tier: 1, note: 'Cy Young level, elite everything' },
  'Dylan Cease':       { k9: 9.80, xK9: 10.00, ip: 175, hand: 'R', team: 'SD', tier: 2, note: 'High K, high walk — volatile' },
  'Drew Rasmussen':    { k9: 7.60, xK9: 7.40, ip: 155, hand: 'R', team: 'TB', tier: 3, note: 'Ground ball pitcher, low K rate' },
  'Matthew Liberatore':{ k9: 7.20, xK9: 7.00, ip: 130, hand: 'L', team: 'STL', tier: 4, note: 'STL OD starter by default, thin rotation' },
  'Nathan Eovaldi':    { k9: 8.50, xK9: 8.30, ip: 180, hand: 'R', team: 'TEX', tier: 2, note: 'Veteran workhorse, good K rate' },
  'Cristopher Sanchez': { k9: 7.80, xK9: 7.60, ip: 170, hand: 'L', team: 'PHI', tier: 3, note: 'Ground ball pitcher, lower Ks' },
  'Zac Gallen':        { k9: 9.20, xK9: 9.40, ip: 185, hand: 'R', team: 'ARI', tier: 2, note: 'ARI ace, solid all-around' },
  'Yoshinobu Yamamoto':{ k9: 9.50, xK9: 9.70, ip: 175, hand: 'R', team: 'LAD', tier: 1, note: 'LAD OD starter, NPB import elite' },
  'Tanner Bibee':      { k9: 9.80, xK9: 10.00, ip: 185, hand: 'R', team: 'CLE', tier: 2, note: 'CLE ace, rising star' },
  'Logan Gilbert':     { k9: 9.50, xK9: 9.30, ip: 195, hand: 'R', team: 'SEA', tier: 1, note: 'SEA ace, elite command' },

  // === OD Day 2 Starters (March 27) ===
  'Gerrit Cole':       { k9: 10.60, xK9: 10.80, ip: 200, hand: 'R', team: 'NYY', tier: 1, note: 'NYY ace, perennial Cy Young' },
  'Logan Webb':        { k9: 7.20, xK9: 7.00, ip: 195, hand: 'R', team: 'SF', tier: 2, note: 'Ground ball pitcher, low Ks' },
  'Luis Severino':     { k9: 6.90, xK9: 6.70, ip: 165, hand: 'R', team: 'OAK', tier: 3, note: 'OAK veteran, declining K rate' },
  'Kevin Gausman':     { k9: 9.80, xK9: 10.00, ip: 185, hand: 'R', team: 'TOR', tier: 2, note: 'TOR ace, splitter specialist' },
  'Kyle Freeland':     { k9: 6.80, xK9: 6.60, ip: 150, hand: 'L', team: 'COL', tier: 4, note: 'Coors Field refugee, ground balls' },
  'Sandy Alcantara':   { k9: 8.50, xK9: 8.70, ip: 175, hand: 'R', team: 'MIA', tier: 2, note: 'Former Cy Young, returning from TJ' },
  'Cole Ragans':       { k9: 11.02, xK9: 11.20, ip: 180, hand: 'L', team: 'KC', tier: 1, note: 'Breakout ace, elite K rate' },
  'Chris Sale':        { k9: 10.98, xK9: 11.10, ip: 180, hand: 'L', team: 'ATL', tier: 1, note: 'ATL ace, NL Cy Young 2024' },
  'Sonny Gray':        { k9: 9.50, xK9: 9.30, ip: 185, hand: 'R', team: 'BOS', tier: 2, note: 'BOS #2, acquired from STL' },
  'Nick Lodolo':       { k9: 8.80, xK9: 8.60, ip: 160, hand: 'L', team: 'CIN', tier: 2, note: 'CIN Game 2 starter' },
  'Yusei Kikuchi':     { k9: 9.50, xK9: 9.30, ip: 170, hand: 'L', team: 'LAA', tier: 2, note: 'LAA #1, new team' },
  'Ronel Blanco':      { k9: 9.00, xK9: 8.80, ip: 165, hand: 'R', team: 'HOU', tier: 2, note: 'HOU Game 2 starter, sneaky good' },
  'Framber Valdez':    { k9: 8.80, xK9: 8.60, ip: 200, hand: 'L', team: 'DET', tier: 1, note: 'DET acquisition, elite durability' },
  'Yu Darvish':        { k9: 9.20, xK9: 9.00, ip: 160, hand: 'R', team: 'SD', tier: 2, note: 'SD Game 2, veteran arm' },
  'Ryne Nelson':       { k9: 7.80, xK9: 7.60, ip: 155, hand: 'R', team: 'ARI', tier: 3, note: 'ARI Game 2, developing' },
  'Tyler Glasnow':     { k9: 10.50, xK9: 10.70, ip: 170, hand: 'R', team: 'LAD', tier: 1, note: 'LAD Game 2 ace, electric stuff' },
  'Gavin Williams':    { k9: 10.20, xK9: 10.40, ip: 160, hand: 'R', team: 'CLE', tier: 2, note: 'CLE Game 2, high K upside' },
  'Bryce Miller':      { k9: 8.80, xK9: 8.60, ip: 175, hand: 'R', team: 'SEA', tier: 2, note: 'SEA Game 2, solid' },
};

// ==================== TEAM BATTING K% ====================
// 2025 team strikeout rates (K% of plate appearances)
// Higher K% = more vulnerable to high-K pitchers = K prop OVER lean
// League average: ~22.5%
const TEAM_BATTING_K_PCT = {
  'ARI': 0.228, 'ATL': 0.215, 'BAL': 0.232, 'BOS': 0.218,
  'CHC': 0.225, 'CIN': 0.235, 'CLE': 0.208, 'COL': 0.242,
  'CWS': 0.258, 'DET': 0.222, 'HOU': 0.210, 'KC':  0.220,
  'LAA': 0.238, 'LAD': 0.205, 'MIA': 0.245, 'MIL': 0.230,
  'MIN': 0.225, 'NYM': 0.218, 'NYY': 0.228, 'OAK': 0.252,
  'PHI': 0.215, 'PIT': 0.235, 'SD':  0.222, 'SF':  0.218,
  'SEA': 0.232, 'STL': 0.228, 'TB':  0.238, 'TEX': 0.225,
  'TOR': 0.220, 'WSH': 0.240,
};

const LG_AVG_K_PCT = 0.225;

// ==================== PARK K FACTORS ====================
// Some parks boost Ks (high altitude, big outfields encourage swing-and-miss)
// Others suppress Ks (small parks encourage contact approach)
const PARK_K_FACTORS = {
  'Coors Field': 1.08,           // Thin air = more swings = more Ks surprisingly
  'Chase Field': 1.02,           // Dry air, some K boost
  'Globe Life Field': 1.01,      // Roof, neutral
  'Minute Maid Park': 1.00,      // Dome, neutral
  'Tropicana Field': 1.00,       // Dome, neutral
  'Rogers Centre': 1.00,         // Dome, neutral
  'LoanDepot Park': 0.99,        // Neutral
  'American Family Field': 1.01, // Slight K boost
  'Guaranteed Rate Field': 1.00, // Neutral
  'Target Field': 1.01,          // Cold early = more Ks
  'Great American Ball Park': 1.03, // Hitter park but high Ks too
  'Fenway Park': 0.97,           // Contact-oriented, Green Monster
  'Yankee Stadium': 0.98,        // Short porch = contact approach
  'Citizens Bank Park': 0.99,    // Hitter-friendly but neutral Ks
  'Wrigley Field': 1.02,         // Wind and cold = more Ks early season
  'Camden Yards': 1.00,          // Neutral
  'Kauffman Stadium': 1.01,      // Slightly K-friendly
  'Busch Stadium': 1.00,         // Neutral
  'PNC Park': 0.99,              // Neutral
  'Truist Park': 1.00,           // Neutral
  'Comerica Park': 1.02,         // Big park, more Ks
  'Progressive Field': 1.01,     // Slight K boost
  'Dodger Stadium': 1.03,        // Pitcher-friendly, high Ks
  'Citi Field': 1.02,            // Pitcher-friendly
  'T-Mobile Park': 1.04,         // Very pitcher-friendly, high Ks
  'Petco Park': 1.05,            // Most pitcher-friendly, highest K factor
  'Oracle Park': 1.04,           // Pitcher-friendly, cold, marine layer
  'Angel Stadium': 1.00,         // Neutral
  'Nationals Park': 1.00,        // Neutral
  'Coliseum': 1.01,              // Big foul territory
};

// ==================== WEATHER K ADJUSTMENTS ====================
// Cold weather = rusty bats = more strikeouts
// Wind = less effect on Ks (mainly affects ball flight)
function getWeatherKMultiplier(tempF, isDome) {
  if (isDome) return 1.00; // No weather effect in domes
  if (!tempF) return 1.00;

  // Cold weather K boost: below 60°F, each degree adds ~0.15% K boost
  // Based on research: K rate increases ~3% in sub-50°F games
  if (tempF < 45) return 1.06;       // Extreme cold = 6% K boost
  if (tempF < 50) return 1.04;       // Very cold = 4% K boost
  if (tempF < 55) return 1.03;       // Cold = 3% K boost
  if (tempF < 60) return 1.02;       // Cool = 2% K boost
  if (tempF < 65) return 1.01;       // Slightly cool = 1% K boost
  if (tempF > 90) return 0.98;       // Extreme heat = slight K decrease (tired pitchers)
  return 1.00;
}

// ==================== OPENING DAY K PREMIUM ====================
// Opening Day starters historically:
// - Go deeper (5.8 IP avg vs 5.5 regular season) = more Ks
// - Face lineups seeing them for first time in 2026 = more whiffs
// - Rusty batters in first week = 5-8% more Ks
// - Expanded rosters = more bench players subbing in = weaker contact
const OD_K_MULTIPLIER = 1.06;        // 6% K premium for Opening Day
const OPENING_WEEK_K_MULTIPLIER = 1.04; // 4% K premium for first week
const OD_IP_BOOST = 0.3;             // OD starters avg 0.3 more IP (5.8 vs 5.5)

// ==================== DK K PROP LINES ====================
// DraftKings pitcher K prop lines for Opening Day (as of March 22)
// Format: { line, overOdds, underOdds }
const DK_K_PROP_LINES = {
  // Day 1
  'Paul Skenes':       { line: 6.5, overOdds: -130, underOdds: 110 },
  'Freddy Peralta':    { line: 5.5, overOdds: -120, underOdds: 100 },
  'Shane Smith':       { line: 4.5, overOdds: -115, underOdds: -105 },
  'Jacob Misiorowski': { line: 5.5, overOdds: -115, underOdds: -105 },
  'Cade Cavalli':      { line: 4.5, overOdds: -105, underOdds: -115 },
  'Matthew Boyd':      { line: 4.5, overOdds: -110, underOdds: -110 },
  'Joe Ryan':          { line: 6.5, overOdds: -105, underOdds: -115 },
  'Trevor Rogers':     { line: 5.5, overOdds: -105, underOdds: -115 },
  'Garrett Crochet':   { line: 7.5, overOdds: -115, underOdds: -105 },
  'Andrew Abbott':     { line: 5.5, overOdds: -110, underOdds: -110 },
  'Jose Soriano':      { line: 4.5, overOdds: -110, underOdds: -110 },
  'Hunter Brown':      { line: 5.5, overOdds: -120, underOdds: 100 },
  'Tarik Skubal':      { line: 7.5, overOdds: -110, underOdds: -110 },
  'Dylan Cease':       { line: 6.5, overOdds: -110, underOdds: -110 },
  'Drew Rasmussen':    { line: 4.5, overOdds: -105, underOdds: -115 },
  'Matthew Liberatore':{ line: 4.5, overOdds: 100, underOdds: -120 },
  'Nathan Eovaldi':    { line: 5.5, overOdds: -110, underOdds: -110 },
  'Cristopher Sanchez': { line: 4.5, overOdds: -110, underOdds: -110 },
  'Zac Gallen':        { line: 6.5, overOdds: 100, underOdds: -120 },
  'Yoshinobu Yamamoto':{ line: 6.5, overOdds: -110, underOdds: -110 },
  'Tanner Bibee':      { line: 6.5, overOdds: -110, underOdds: -110 },
  'Logan Gilbert':     { line: 6.5, overOdds: -115, underOdds: -105 },
  // Day 2
  'Gerrit Cole':       { line: 7.5, overOdds: -110, underOdds: -110 },
  'Logan Webb':        { line: 4.5, overOdds: -105, underOdds: -115 },
  'Luis Severino':     { line: 3.5, overOdds: -125, underOdds: 105 },
  'Kevin Gausman':     { line: 6.5, overOdds: -110, underOdds: -110 },
  'Kyle Freeland':     { line: 3.5, overOdds: -105, underOdds: -115 },
  'Sandy Alcantara':   { line: 5.5, overOdds: -105, underOdds: -115 },
  'Cole Ragans':       { line: 7.5, overOdds: -105, underOdds: -115 },
  'Chris Sale':        { line: 7.5, overOdds: -110, underOdds: -110 },
  'Sonny Gray':        { line: 6.5, overOdds: -105, underOdds: -115 },
  'Nick Lodolo':       { line: 5.5, overOdds: -110, underOdds: -110 },
  'Yusei Kikuchi':     { line: 5.5, overOdds: -120, underOdds: 100 },
  'Ronel Blanco':      { line: 5.5, overOdds: -105, underOdds: -115 },
  'Framber Valdez':    { line: 5.5, overOdds: -120, underOdds: 100 },
  'Yu Darvish':        { line: 5.5, overOdds: -115, underOdds: -105 },
  'Ryne Nelson':       { line: 4.5, overOdds: -110, underOdds: -110 },
  'Tyler Glasnow':     { line: 7.5, overOdds: -105, underOdds: -115 },
  'Gavin Williams':    { line: 6.5, overOdds: -105, underOdds: -115 },
  'Bryce Miller':      { line: 5.5, overOdds: -110, underOdds: -110 },
};

// ==================== DOME PARKS ====================
const DOME_PARKS = new Set([
  'Minute Maid Park', 'Tropicana Field', 'Rogers Centre', 'LoanDepot Park',
  'Globe Life Field', 'Chase Field', 'American Family Field',
]);

// ==================== CORE K PREDICTION MODEL ====================

/**
 * Predict expected strikeouts for a pitcher in a given matchup
 * @param {string} pitcherName - Pitcher name
 * @param {string} oppTeam - Opposing team abbreviation
 * @param {string} parkName - Park name
 * @param {object} options - { isOpeningDay, isOpeningWeek, tempF, isDome, projectedIP }
 * @returns {object} K prediction with confidence interval and value detection
 */
function predictKs(pitcherName, oppTeam, parkName, options = {}) {
  const pitcher = STEAMER_K9_PROJECTIONS[pitcherName];
  if (!pitcher) return null;

  const {
    isOpeningDay = true,
    isOpeningWeek = true,
    tempF = null,
    isDome = DOME_PARKS.has(parkName),
    projectedIP = null,
  } = options;

  // Base K/9 — use blend of Steamer and xK9 (expected)
  const baseK9 = (pitcher.k9 * 0.6 + (pitcher.xK9 || pitcher.k9) * 0.4);

  // Projected innings: OD starters go deeper
  const baseIP = projectedIP || getProjectedIP(pitcher);
  const ipBoost = isOpeningDay ? OD_IP_BOOST : 0;
  const expectedIP = baseIP + ipBoost;

  // Base expected Ks (no adjustments)
  const rawExpectedKs = (baseK9 / 9) * expectedIP;

  // === ADJUSTMENTS ===

  // 1. Opposing team K% adjustment
  const oppKPct = TEAM_BATTING_K_PCT[oppTeam] || LG_AVG_K_PCT;
  const teamKAdj = oppKPct / LG_AVG_K_PCT;

  // 2. Park K factor
  const parkKFactor = PARK_K_FACTORS[parkName] || 1.00;

  // 3. Weather K multiplier
  const weatherKMult = getWeatherKMultiplier(tempF, isDome);

  // 4. Opening Day / Opening Week K premium
  let openerMult = 1.00;
  if (isOpeningDay) openerMult = OD_K_MULTIPLIER;
  else if (isOpeningWeek) openerMult = OPENING_WEEK_K_MULTIPLIER;

  // 5. Pitcher hand adjustment (LHP vs R-heavy lineups slightly boost K rate)
  // Left-handed pitchers have a natural K rate advantage due to platoon splits
  const handAdj = pitcher.hand === 'L' ? 1.015 : 1.00;

  // Compute adjusted expected Ks
  const adjustedKs = rawExpectedKs * teamKAdj * parkKFactor * weatherKMult * openerMult * handAdj;

  // === CONFIDENCE INTERVAL ===
  // K distributions follow roughly Poisson — SD ≈ sqrt(lambda)
  // But real variance is higher (overdispersion from early hooks, blowouts)
  const overdispersion = 1.15; // 15% more variance than Poisson
  const sd = Math.sqrt(adjustedKs) * overdispersion;
  const low = Math.max(0, adjustedKs - 1.28 * sd); // 10th percentile
  const high = adjustedKs + 1.28 * sd;               // 90th percentile

  // === OVER/UNDER PROBABILITY ===
  // Use Poisson CDF for exact line probability
  const dkLine = DK_K_PROP_LINES[pitcherName];
  let overProb = null, underProb = null, edge = null, recommendation = null;
  let overEV = null, underEV = null;

  if (dkLine) {
    overProb = 1 - poissonCDF(dkLine.line, adjustedKs);
    underProb = poissonCDF(dkLine.line, adjustedKs);

    // Calculate implied probabilities from odds
    const impliedOver = americanToImplied(dkLine.overOdds);
    const impliedUnder = americanToImplied(dkLine.underOdds);

    const overEdge = overProb - impliedOver;
    const underEdge = underProb - impliedUnder;

    // EV calculation
    const overDecimal = americanToDecimal(dkLine.overOdds);
    const underDecimal = americanToDecimal(dkLine.underOdds);
    overEV = (overProb * (overDecimal - 1)) - (1 - overProb);
    underEV = (underProb * (underDecimal - 1)) - (1 - underProb);

    if (overEdge > underEdge && overEdge > 0.02) {
      edge = overEdge;
      recommendation = 'OVER';
    } else if (underEdge > overEdge && underEdge > 0.02) {
      edge = underEdge;
      recommendation = 'UNDER';
    } else {
      edge = Math.max(overEdge, underEdge);
      recommendation = edge > 0 ? (overEdge > underEdge ? 'OVER' : 'UNDER') : 'PASS';
    }
  }

  // === CONFIDENCE GRADE ===
  let confidence = 'MEDIUM';
  let grade = 'B';
  if (edge !== null) {
    if (edge > 0.08) { confidence = 'HIGH'; grade = 'A'; }
    else if (edge > 0.05) { confidence = 'HIGH'; grade = 'A-'; }
    else if (edge > 0.03) { confidence = 'MEDIUM'; grade = 'B+'; }
    else if (edge > 0.01) { confidence = 'MEDIUM'; grade = 'B'; }
    else { confidence = 'LOW'; grade = 'C'; }
  }

  // Build factor breakdown
  const factors = [];
  if (teamKAdj > 1.03) factors.push(`🎯 High-K opponent (${oppTeam} ${(oppKPct*100).toFixed(1)}% K rate)`);
  if (teamKAdj < 0.97) factors.push(`⚠️ Low-K opponent (${oppTeam} ${(oppKPct*100).toFixed(1)}% K rate)`);
  if (parkKFactor > 1.02) factors.push(`🏟️ K-friendly park (${parkName} ${parkKFactor}x)`);
  if (parkKFactor < 0.98) factors.push(`🏟️ K-suppressing park (${parkName} ${parkKFactor}x)`);
  if (weatherKMult > 1.02) factors.push(`🌡️ Cold weather K boost (+${((weatherKMult-1)*100).toFixed(0)}%)`);
  if (isOpeningDay) factors.push(`🎉 Opening Day K premium (+${((OD_K_MULTIPLIER-1)*100).toFixed(0)}%)`);
  if (pitcher.hand === 'L') factors.push('🫲 LHP advantage');
  if (pitcher.tier === 1) factors.push('⭐ Elite K pitcher (Tier 1)');

  return {
    pitcher: pitcherName,
    team: pitcher.team,
    hand: pitcher.hand,
    tier: pitcher.tier,
    opponent: oppTeam,
    park: parkName,
    // K/9 data
    steamerK9: pitcher.k9,
    xK9: pitcher.xK9,
    blendedK9: +baseK9.toFixed(2),
    // Projection
    projectedIP: +expectedIP.toFixed(1),
    rawExpectedKs: +rawExpectedKs.toFixed(2),
    adjustedExpectedKs: +adjustedKs.toFixed(2),
    // Confidence interval
    low: +low.toFixed(1),
    high: +high.toFixed(1),
    sd: +sd.toFixed(2),
    // Adjustments
    adjustments: {
      teamKAdj: +teamKAdj.toFixed(3),
      parkKFactor,
      weatherKMult,
      openerMult,
      handAdj,
    },
    // Value detection
    dkLine: dkLine || null,
    overProb: overProb !== null ? +(overProb * 100).toFixed(1) : null,
    underProb: underProb !== null ? +(underProb * 100).toFixed(1) : null,
    overEV: overEV !== null ? +(overEV * 100).toFixed(1) : null,
    underEV: underEV !== null ? +(underEV * 100).toFixed(1) : null,
    edge: edge !== null ? +(edge * 100).toFixed(1) : null,
    recommendation,
    confidence,
    grade,
    factors,
    note: pitcher.note,
  };
}

/**
 * Get projected IP for a pitcher based on tier and role
 */
function getProjectedIP(pitcher) {
  // Opening Day starters typically go deeper than regular season avg
  switch (pitcher.tier) {
    case 1: return 6.0;  // Ace: 6.0 IP avg on OD
    case 2: return 5.5;  // #2: 5.5 IP
    case 3: return 5.0;  // #3/4: 5.0 IP
    case 4: return 4.5;  // Back-end: 4.5 IP
    default: return 5.0;
  }
}

// ==================== MATH HELPERS ====================

function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonCDF(k, lambda) {
  // P(X <= k) — probability of k or fewer
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

// ==================== SCAN ALL OD K PROPS ====================

/**
 * Scan all Opening Day games for K prop value
 * @param {object} options - { isOpeningDay, weatherData }
 * @returns {object} Full scan results with rankings and top picks
 */
function scanODKProps(options = {}) {
  const { weatherData = {}, isOpeningDay = true } = options;

  // Import OD schedule
  let odGames;
  try {
    const od = require('../models/mlb-opening-day');
    odGames = od.OPENING_DAY_GAMES;
  } catch (e) {
    odGames = [];
  }

  const results = [];

  for (const game of odGames) {
    const awayStarter = game.confirmedStarters?.away;
    const homeStarter = game.confirmedStarters?.home;

    // Look up park name from the home team
    let parkName = getTeamPark(game.home);
    const isDome = DOME_PARKS.has(parkName);
    const tempF = weatherData[`${game.away}@${game.home}`]?.temp || null;

    // Predict K props for both starters
    const awayPred = awayStarter ? predictKs(awayStarter, game.home, parkName, {
      isOpeningDay,
      tempF,
      isDome,
    }) : null;

    const homePred = homeStarter ? predictKs(homeStarter, game.away, parkName, {
      isOpeningDay,
      tempF,
      isDome,
    }) : null;

    // Combined game K total
    const combinedKs = (awayPred?.adjustedExpectedKs || 0) + (homePred?.adjustedExpectedKs || 0);

    results.push({
      game: `${game.away}@${game.home}`,
      date: game.date,
      time: game.time,
      park: parkName,
      isDome,
      tempF,
      awayStarter: awayPred,
      homeStarter: homePred,
      combinedExpectedKs: +combinedKs.toFixed(1),
    });
  }

  // Sort by edge (best value first)
  const allPicks = [];
  for (const r of results) {
    if (r.awayStarter && r.awayStarter.edge > 0 && r.awayStarter.recommendation !== 'PASS') {
      allPicks.push({ ...r.awayStarter, game: r.game, date: r.date });
    }
    if (r.homeStarter && r.homeStarter.edge > 0 && r.homeStarter.recommendation !== 'PASS') {
      allPicks.push({ ...r.homeStarter, game: r.game, date: r.date });
    }
  }
  allPicks.sort((a, b) => b.edge - a.edge);

  // Top picks (best +EV K props)
  const topPicks = allPicks.filter(p => p.edge >= 2.0);

  // Stats
  const totalPicks = allPicks.length;
  const highConf = allPicks.filter(p => p.confidence === 'HIGH').length;
  const avgEdge = allPicks.length > 0
    ? allPicks.reduce((s, p) => s + p.edge, 0) / allPicks.length
    : 0;

  return {
    timestamp: new Date().toISOString(),
    isOpeningDay,
    gamesScanned: results.length,
    totalKPropPicks: totalPicks,
    highConfidencePicks: highConf,
    averageEdge: +avgEdge.toFixed(1),
    topPicks,
    allPicks,
    gameDetails: results,
    summary: buildSummary(topPicks),
  };
}

function buildSummary(topPicks) {
  if (topPicks.length === 0) return 'No strong K prop edges found.';

  const smash = topPicks.filter(p => p.grade === 'A' || p.grade === 'A-');
  const strong = topPicks.filter(p => p.grade === 'B+');

  let summary = `🔥 K PROP REPORT: ${topPicks.length} value bets found.\n`;
  if (smash.length > 0) {
    summary += `\n⭐ SMASH PLAYS (${smash.length}):\n`;
    for (const p of smash) {
      summary += `  ${p.pitcher} ${p.recommendation} ${p.dkLine?.line} Ks (${p.edge}% edge, model ${p.adjustedExpectedKs} Ks)\n`;
    }
  }
  if (strong.length > 0) {
    summary += `\n✅ STRONG PLAYS (${strong.length}):\n`;
    for (const p of strong) {
      summary += `  ${p.pitcher} ${p.recommendation} ${p.dkLine?.line} Ks (${p.edge}% edge, model ${p.adjustedExpectedKs} Ks)\n`;
    }
  }
  return summary;
}

// ==================== MATCHUP ANALYZER ====================

/**
 * Analyze a specific pitcher K prop matchup
 * @param {string} pitcher - Pitcher name
 * @param {string} oppTeam - Opposing team
 * @param {string} parkName - Park name (optional, will lookup from team)
 * @returns {object} Detailed analysis
 */
function analyzeMatchup(pitcherName, oppTeam, parkName) {
  if (!parkName) parkName = getTeamPark(oppTeam);
  return predictKs(pitcherName, oppTeam, parkName, { isOpeningDay: true });
}

// ==================== K PROP LEADERBOARD ====================

/**
 * Get all OD starters ranked by expected Ks
 */
function getKLeaderboard() {
  const entries = [];
  for (const [name, pitcher] of Object.entries(STEAMER_K9_PROJECTIONS)) {
    entries.push({
      pitcher: name,
      team: pitcher.team,
      k9: pitcher.k9,
      xK9: pitcher.xK9,
      tier: pitcher.tier,
      hand: pitcher.hand,
      projectedIP: getProjectedIP(pitcher),
      baseExpectedKs: +((pitcher.k9 / 9) * getProjectedIP(pitcher)).toFixed(1),
      note: pitcher.note,
    });
  }
  entries.sort((a, b) => b.k9 - a.k9);
  return entries;
}

// ==================== TEAM K VULNERABILITY RANKINGS ====================

/**
 * Rank teams by K vulnerability (highest K% = most exploitable)
 */
function getTeamKVulnerability() {
  const teams = Object.entries(TEAM_BATTING_K_PCT)
    .map(([team, kPct]) => ({
      team,
      kPct: +(kPct * 100).toFixed(1),
      vsLgAvg: +((kPct / LG_AVG_K_PCT - 1) * 100).toFixed(1),
      rating: kPct > 0.245 ? 'VERY HIGH' : kPct > 0.235 ? 'HIGH' : kPct > 0.225 ? 'AVERAGE' : kPct > 0.215 ? 'LOW' : 'VERY LOW',
    }))
    .sort((a, b) => b.kPct - a.kPct);
  return teams;
}

// ==================== HELPER ====================
function getTeamPark(teamAbbr) {
  const TEAM_PARKS = {
    'ARI': 'Chase Field', 'ATL': 'Truist Park', 'BAL': 'Camden Yards',
    'BOS': 'Fenway Park', 'CHC': 'Wrigley Field', 'CIN': 'Great American Ball Park',
    'CLE': 'Progressive Field', 'COL': 'Coors Field', 'CWS': 'Guaranteed Rate Field',
    'DET': 'Comerica Park', 'HOU': 'Minute Maid Park', 'KC': 'Kauffman Stadium',
    'LAA': 'Angel Stadium', 'LAD': 'Dodger Stadium', 'MIA': 'LoanDepot Park',
    'MIL': 'American Family Field', 'MIN': 'Target Field', 'NYM': 'Citi Field',
    'NYY': 'Yankee Stadium', 'OAK': 'Coliseum', 'PHI': 'Citizens Bank Park',
    'PIT': 'PNC Park', 'SD': 'Petco Park', 'SF': 'Oracle Park',
    'SEA': 'T-Mobile Park', 'STL': 'Busch Stadium', 'TB': 'Tropicana Field',
    'TEX': 'Globe Life Field', 'TOR': 'Rogers Centre', 'WSH': 'Nationals Park',
  };
  return TEAM_PARKS[teamAbbr] || 'Unknown';
}

function getStatus() {
  return {
    totalPitchers: Object.keys(STEAMER_K9_PROJECTIONS).length,
    teamsWithKData: Object.keys(TEAM_BATTING_K_PCT).length,
    parksWithKFactors: Object.keys(PARK_K_FACTORS).length,
    dkLinesLoaded: Object.keys(DK_K_PROP_LINES).length,
  };
}

// ==================== LIVE ODDS API K PROPS (v71.0) ====================
// Fetches real-time pitcher_strikeouts market from The Odds API
// Updates DK_K_PROP_LINES with actual live lines from books

let liveKPropsCache = null;
let liveKPropsCacheTime = 0;
const LIVE_K_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch live K prop lines from The Odds API
 * Market: pitcher_strikeouts (Over/Under on individual pitcher Ks)
 * @param {string} apiKey - The Odds API key
 * @returns {Object} { pitchers: { [name]: { line, overOdds, underOdds, books } }, fetched, gameCount }
 */
async function fetchLiveKProps(apiKey) {
  if (!apiKey) return { error: 'No API key', pitchers: {} };
  
  // Check cache
  if (liveKPropsCache && (Date.now() - liveKPropsCacheTime) < LIVE_K_CACHE_TTL) {
    return { ...liveKPropsCache, cached: true };
  }
  
  try {
    const fetch = require('node-fetch');
    // The Odds API v4: event player props
    // First get MLB events
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}`;
    const eventsResp = await fetch(eventsUrl);
    const events = await eventsResp.json();
    
    if (!Array.isArray(events) || events.length === 0) {
      return { error: 'No MLB events found (season may not have started)', pitchers: {}, gameCount: 0 };
    }
    
    const pitchers = {};
    let gamesScanned = 0;
    
    // Fetch pitcher_strikeouts prop for each event
    // The Odds API uses: /v4/sports/{sport}/events/{eventId}/odds?markets=pitcher_strikeouts
    for (const event of events.slice(0, 25)) { // Cap at 25 games to save API quota
      try {
        const propsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=pitcher_strikeouts&oddsFormat=american`;
        const propsResp = await fetch(propsUrl);
        const propsData = await propsResp.json();
        gamesScanned++;
        
        // Parse bookmaker data
        const bookmakers = propsData.bookmakers || [];
        for (const book of bookmakers) {
          for (const market of (book.markets || [])) {
            if (market.key !== 'pitcher_strikeouts') continue;
            
            // Group outcomes by player (description field has the pitcher name)
            const playerLines = {};
            for (const outcome of (market.outcomes || [])) {
              const name = outcome.description || outcome.name;
              if (!name) continue;
              
              if (!playerLines[name]) playerLines[name] = {};
              if (outcome.name === 'Over') {
                playerLines[name].overOdds = outcome.price;
                playerLines[name].line = outcome.point;
              } else if (outcome.name === 'Under') {
                playerLines[name].underOdds = outcome.price;
                playerLines[name].line = outcome.point;
              }
            }
            
            // Merge into pitchers object — prefer DraftKings, then FanDuel, then any book
            for (const [pName, pLine] of Object.entries(playerLines)) {
              if (!pLine.line) continue;
              
              const existing = pitchers[pName];
              const bookPriority = book.key === 'draftkings' ? 3 : book.key === 'fanduel' ? 2 : 1;
              const existingPriority = existing?._bookPriority || 0;
              
              if (!existing || bookPriority > existingPriority) {
                pitchers[pName] = {
                  line: pLine.line,
                  overOdds: pLine.overOdds || -110,
                  underOdds: pLine.underOdds || -110,
                  book: book.title || book.key,
                  _bookPriority: bookPriority,
                  game: `${event.away_team} @ ${event.home_team}`,
                  gameTime: event.commence_time,
                };
              }
            }
          }
        }
        
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        // Skip individual game errors
        continue;
      }
    }
    
    // Clean up internal fields
    for (const p of Object.values(pitchers)) {
      delete p._bookPriority;
    }
    
    const result = {
      pitchers,
      fetched: new Date().toISOString(),
      gameCount: gamesScanned,
      pitcherCount: Object.keys(pitchers).length,
      source: 'the-odds-api',
    };
    
    liveKPropsCache = result;
    liveKPropsCacheTime = Date.now();
    
    return result;
  } catch (e) {
    return { error: e.message, pitchers: {} };
  }
}

/**
 * Update the static DK_K_PROP_LINES with live data
 * Returns count of updated pitchers
 */
async function updateLiveKLines(apiKey) {
  const live = await fetchLiveKProps(apiKey);
  if (live.error || !live.pitchers) return { updated: 0, error: live.error };
  
  let updated = 0;
  let added = 0;
  const changes = [];
  
  for (const [pitcherName, liveData] of Object.entries(live.pitchers)) {
    const existing = DK_K_PROP_LINES[pitcherName];
    
    if (existing) {
      // Check if line changed
      if (existing.line !== liveData.line || existing.overOdds !== liveData.overOdds || existing.underOdds !== liveData.underOdds) {
        changes.push({
          pitcher: pitcherName,
          old: { line: existing.line, overOdds: existing.overOdds, underOdds: existing.underOdds },
          new: { line: liveData.line, overOdds: liveData.overOdds, underOdds: liveData.underOdds },
          book: liveData.book,
        });
      }
      updated++;
    } else {
      added++;
    }
    
    DK_K_PROP_LINES[pitcherName] = {
      line: liveData.line,
      overOdds: liveData.overOdds,
      underOdds: liveData.underOdds,
      source: 'live',
      book: liveData.book,
      lastUpdate: liveData.game ? new Date().toISOString() : undefined,
    };
  }
  
  return {
    updated,
    added,
    total: Object.keys(DK_K_PROP_LINES).length,
    changes,
    fetched: live.fetched,
    gameCount: live.gameCount,
  };
}

module.exports = {
  predictKs,
  scanODKProps,
  analyzeMatchup,
  getKLeaderboard,
  getTeamKVulnerability,
  getWeatherKMultiplier,
  getStatus,
  fetchLiveKProps,
  updateLiveKLines,
  STEAMER_K9_PROJECTIONS,
  TEAM_BATTING_K_PCT,
  PARK_K_FACTORS,
  DK_K_PROP_LINES,
};
