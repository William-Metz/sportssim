// services/pitcher-outs-props.js — Pitcher Outs Recorded Props Model v76.0
// 
// KEY INSIGHT: Opening Day starters get a longer leash (5.8 IP avg vs 5.5 regular)
// Aces especially go deep — managers trust their #1 in game 1
// Outs recorded = innings × 3, so 5.8 IP = 17.4 outs average on OD
// Books set lines based on season-long averages (~5.3 IP = 15.9 outs)
// The gap between 15.9 and 17.4 outs creates ~1.5 outs of edge on OVERS
//
// Model: Expected Outs = projectedIP × 3 × odPremium × pitchEfficiency × oppContactRate × weatherAdj
// Compare to book lines for +EV detection via Poisson distribution

const mlbOpeningDay = require('../models/mlb-opening-day');

// ==================== PROJECTED IP PER START ====================
// Steamer/ZiPS projected innings per start for OD starters
// IP_PER_START = total projected IP / ~32 starts (for aces) or ~30 (mid-tier)
// These are regular season averages — OD premium applied separately
const PITCHER_IP_PROJECTIONS = {
  // === OD Day 0 — Season Opener (March 25) ===
  'Gerrit Cole':        { ipPerStart: 6.25, tier: 1, hand: 'R', team: 'NYY', pitchCount: 100, note: 'NYY ace, workhorse. 200 IP season. Opener energy = long start.' },
  'Logan Webb':         { ipPerStart: 6.40, tier: 1, hand: 'R', team: 'SF', pitchCount: 98, note: 'SF workhorse, innings eater. Led NL in IP. Home opener at Oracle.' },
  // === OD Day 1 Starters (March 26) ===
  'Paul Skenes':        { ipPerStart: 5.78, tier: 1, hand: 'R', team: 'PIT', pitchCount: 97, note: 'Elite stuff, managed carefully but goes deep' },
  'Freddy Peralta':     { ipPerStart: 5.67, tier: 2, hand: 'R', team: 'NYM', pitchCount: 93, note: 'High K rate, walks limit IP' },
  'Shane Smith':        { ipPerStart: 5.00, tier: 3, hand: 'R', team: 'CWS', pitchCount: 88, note: 'Rookie, managed carefully' },
  'Jacob Misiorowski':  { ipPerStart: 4.67, tier: 3, hand: 'R', team: 'MIL', pitchCount: 85, note: 'Young arm, pitch count limits' },
  'Cade Cavalli':       { ipPerStart: 5.00, tier: 3, hand: 'R', team: 'WSH', pitchCount: 88, note: 'TJ recovery, limited starts' },
  'Matthew Boyd':       { ipPerStart: 5.50, tier: 3, hand: 'L', team: 'CHC', pitchCount: 91, note: 'Veteran, steady workhorse' },
  'Joe Ryan':           { ipPerStart: 5.83, tier: 2, hand: 'R', team: 'MIN', pitchCount: 95, note: 'Efficient pitcher, goes deep' },
  'Trevor Rogers':      { ipPerStart: 5.38, tier: 2, hand: 'L', team: 'BAL', pitchCount: 92, note: 'Improved command' },
  'Garrett Crochet':    { ipPerStart: 5.67, tier: 1, hand: 'L', team: 'BOS', pitchCount: 96, note: 'Elite stuff, BOS will let him go' },
  'Andrew Abbott':      { ipPerStart: 5.50, tier: 2, hand: 'L', team: 'CIN', pitchCount: 92, note: 'CIN ace, solid IP' },
  'Jose Soriano':       { ipPerStart: 5.38, tier: 3, hand: 'R', team: 'LAA', pitchCount: 89, note: 'Developing, mid-rotation' },
  'Hunter Brown':       { ipPerStart: 5.83, tier: 2, hand: 'R', team: 'HOU', pitchCount: 95, note: 'HOU will extend him, dome protects' },
  'Tarik Skubal':       { ipPerStart: 6.25, tier: 1, hand: 'L', team: 'DET', pitchCount: 100, note: 'Cy Young level, goes 6+ regularly' },
  'Dylan Cease':        { ipPerStart: 5.50, tier: 2, hand: 'R', team: 'SD', pitchCount: 93, note: 'High K but walks inflate pitch count' },
  'Nick Pivetta':       { ipPerStart: 5.83, tier: 2, hand: 'R', team: 'SD', pitchCount: 95, note: 'SD OD Day 1 starter, 2025 breakout, efficient' },
  'Drew Rasmussen':     { ipPerStart: 5.50, tier: 3, hand: 'R', team: 'TB', pitchCount: 90, note: 'Efficient, ground balls = quick outs' },
  'Matthew Liberatore': { ipPerStart: 5.00, tier: 4, hand: 'L', team: 'STL', pitchCount: 85, note: 'Short leash, STL bullpen better' },
  'Nathan Eovaldi':     { ipPerStart: 6.00, tier: 2, hand: 'R', team: 'TEX', pitchCount: 96, note: 'Workhorse, goes deep regularly' },
  'Cristopher Sanchez':  { ipPerStart: 5.67, tier: 3, hand: 'L', team: 'PHI', pitchCount: 93, note: 'Ground ball pitcher, efficient' },
  'Zac Gallen':         { ipPerStart: 6.17, tier: 2, hand: 'R', team: 'ARI', pitchCount: 97, note: 'ARI ace, excellent durability' },
  'Yoshinobu Yamamoto': { ipPerStart: 5.83, tier: 1, hand: 'R', team: 'LAD', pitchCount: 95, note: 'Elite command, year 2 adaptation' },
  'Tanner Bibee':       { ipPerStart: 6.17, tier: 2, hand: 'R', team: 'CLE', pitchCount: 97, note: 'Efficient, CLE pitching culture' },
  'Logan Gilbert':      { ipPerStart: 6.50, tier: 1, hand: 'R', team: 'SEA', pitchCount: 100, note: 'Workhorse, elite command = deep' },

  // === OD Day 2 Starters (March 27) ===
  'Cam Schlittler':     { ipPerStart: 4.50, tier: 4, hand: 'R', team: 'NYY', pitchCount: 80, note: 'NYY rookie, short leash, OD Day 2 start' },
  'Logan Webb':         { ipPerStart: 6.50, tier: 2, hand: 'R', team: 'SF', pitchCount: 100, note: 'Innings eater, ground ball machine' },
  'Luis Severino':      { ipPerStart: 5.50, tier: 3, hand: 'R', team: 'OAK', pitchCount: 90, note: 'Declining, OAK may limit' },
  'Kevin Gausman':      { ipPerStart: 6.17, tier: 2, hand: 'R', team: 'TOR', pitchCount: 97, note: 'TOR ace, goes deep' },
  'Kyle Freeland':      { ipPerStart: 5.00, tier: 4, hand: 'L', team: 'COL', pitchCount: 85, note: 'Coors refugee, short outings' },
  'Sandy Alcantara':    { ipPerStart: 5.83, tier: 2, hand: 'R', team: 'MIA', pitchCount: 95, note: 'Former Cy Young, returning from TJ — managed' },
  'Cole Ragans':        { ipPerStart: 6.00, tier: 1, hand: 'L', team: 'KC', pitchCount: 97, note: 'KC ace, elite stuff and stamina' },
  'Chris Sale':         { ipPerStart: 5.67, tier: 1, hand: 'L', team: 'ATL', pitchCount: 95, note: 'Cy Young 2024, vintage Sale' },
  'Sonny Gray':         { ipPerStart: 5.83, tier: 2, hand: 'R', team: 'BOS', pitchCount: 95, note: 'BOS #2, steady deep outings' },
  'Nick Lodolo':        { ipPerStart: 5.33, tier: 2, hand: 'L', team: 'CIN', pitchCount: 90, note: 'CIN Game 2, solid' },
  'Yusei Kikuchi':      { ipPerStart: 5.67, tier: 2, hand: 'L', team: 'LAA', pitchCount: 93, note: 'New team, high K rate helps pace' },
  'Mike Burrows':       { ipPerStart: 5.00, tier: 3, hand: 'R', team: 'HOU', pitchCount: 88, note: 'HOU Game 2, young arm, short leash' },
  'Framber Valdez':     { ipPerStart: 6.67, tier: 1, hand: 'L', team: 'DET', pitchCount: 102, note: 'Innings eater, elite durability' },
  'Michael King':       { ipPerStart: 5.50, tier: 2, hand: 'R', team: 'SD', pitchCount: 95, note: 'SD Game 2, solid innings eater' },
  'Ryne Nelson':        { ipPerStart: 5.17, tier: 3, hand: 'R', team: 'ARI', pitchCount: 88, note: 'ARI Game 2, developing' },
  'Tyler Glasnow':      { ipPerStart: 6.00, tier: 1, hand: 'R', team: 'LAD', pitchCount: 97, note: 'LAD Game 2, electric stuff' },
  'Gavin Williams':     { ipPerStart: 5.33, tier: 2, hand: 'R', team: 'CLE', pitchCount: 90, note: 'CLE Game 2, pitch count watch' },
  'Emmet Sheehan':      { ipPerStart: 5.00, tier: 2, hand: 'R', team: 'LAD', pitchCount: 90, note: 'LAD Game 2, 2025 breakout, electric stuff' },
};

// ==================== TEAM CONTACT RATES ====================
// Higher contact rate = more balls in play = pitcher needs more pitches per out
// Lower contact rate = more Ks = outs come faster but fewer via balls in play
// Net effect on outs recorded: contact-heavy teams keep SP in longer
// because batters put ball in play → outs still recorded → pitch count rises slower than K-heavy ABs
const TEAM_CONTACT_RATE = {
  // Contact% = 1 - K% — higher = more balls in play
  'ARI': 0.772, 'ATL': 0.785, 'BAL': 0.768, 'BOS': 0.782,
  'CHC': 0.775, 'CIN': 0.765, 'CLE': 0.792, 'COL': 0.758,
  'CWS': 0.742, 'DET': 0.778, 'HOU': 0.790, 'KC':  0.780,
  'LAA': 0.762, 'LAD': 0.795, 'MIA': 0.755, 'MIL': 0.770,
  'MIN': 0.775, 'NYM': 0.782, 'NYY': 0.772, 'OAK': 0.748,
  'PHI': 0.785, 'PIT': 0.765, 'SD':  0.778, 'SF':  0.782,
  'SEA': 0.768, 'STL': 0.772, 'TB':  0.762, 'TEX': 0.775,
  'TOR': 0.780, 'WSH': 0.760,
};
const LG_AVG_CONTACT = 0.775;

// ==================== BOOK OUTS LINES ====================
// DraftKings pitcher_outs lines for OD starters
// Outs recorded is typically 15.5-18.5 range (5.17 - 6.17 IP)
const DK_OUTS_LINES = {
  // Day 1
  'Paul Skenes':        { line: 16.5, overOdds: -120, underOdds: -105 },
  'Freddy Peralta':     { line: 15.5, overOdds: -115, underOdds: -110 },
  'Shane Smith':        { line: 13.5, overOdds: -110, underOdds: -115 },
  'Jacob Misiorowski':  { line: 13.5, overOdds: -105, underOdds: -120 },
  'Cade Cavalli':       { line: 14.5, overOdds: -110, underOdds: -115 },
  'Matthew Boyd':       { line: 15.5, overOdds: -115, underOdds: -110 },
  'Joe Ryan':           { line: 16.5, overOdds: -115, underOdds: -110 },
  'Trevor Rogers':      { line: 15.5, overOdds: -110, underOdds: -115 },
  'Garrett Crochet':    { line: 16.5, overOdds: -110, underOdds: -115 },
  'Andrew Abbott':      { line: 15.5, overOdds: -115, underOdds: -110 },
  'Jose Soriano':       { line: 15.5, overOdds: -110, underOdds: -115 },
  'Hunter Brown':       { line: 16.5, overOdds: -115, underOdds: -110 },
  'Tarik Skubal':       { line: 18.5, overOdds: -105, underOdds: -120 },
  'Dylan Cease':        { line: 16.5, overOdds: -110, underOdds: -115 },
  'Nick Pivetta':       { line: 17.5, overOdds: -115, underOdds: -110 },
  'Drew Rasmussen':     { line: 15.5, overOdds: -115, underOdds: -110 },
  'Matthew Liberatore': { line: 13.5, overOdds: -115, underOdds: -110 },
  'Nathan Eovaldi':     { line: 17.5, overOdds: -115, underOdds: -110 },
  'Cristopher Sanchez':  { line: 16.5, overOdds: -110, underOdds: -115 },
  'Zac Gallen':         { line: 17.5, overOdds: -115, underOdds: -110 },
  'Yoshinobu Yamamoto': { line: 16.5, overOdds: -115, underOdds: -110 },
  'Tanner Bibee':       { line: 17.5, overOdds: -115, underOdds: -110 },
  'Logan Gilbert':      { line: 18.5, overOdds: -115, underOdds: -110 },
  // Day 2
  'Cam Schlittler':     { line: 12.5, overOdds: -110, underOdds: -115 },
  'Logan Webb':         { line: 18.5, overOdds: -115, underOdds: -110 },
  'Luis Severino':      { line: 15.5, overOdds: -110, underOdds: -115 },
  'Kevin Gausman':      { line: 17.5, overOdds: -115, underOdds: -110 },
  'Kyle Freeland':      { line: 13.5, overOdds: -115, underOdds: -110 },
  'Sandy Alcantara':    { line: 16.5, overOdds: -115, underOdds: -110 },
  'Cole Ragans':        { line: 17.5, overOdds: -110, underOdds: -115 },
  'Chris Sale':         { line: 16.5, overOdds: -115, underOdds: -110 },
  'Sonny Gray':         { line: 16.5, overOdds: -115, underOdds: -110 },
  'Nick Lodolo':        { line: 15.5, overOdds: -110, underOdds: -115 },
  'Yusei Kikuchi':      { line: 16.5, overOdds: -110, underOdds: -115 },
  'Mike Burrows':       { line: 13.5, overOdds: -110, underOdds: -115 },
  'Framber Valdez':     { line: 19.5, overOdds: -105, underOdds: -120 },
  'Michael King':       { line: 16.5, overOdds: -115, underOdds: -110 },
  'Ryne Nelson':        { line: 14.5, overOdds: -110, underOdds: -115 },
  'Emmet Sheehan':      { line: 15.5, overOdds: -110, underOdds: -115 },
  'Gavin Williams':     { line: 15.5, overOdds: -115, underOdds: -110 },
  'Bryce Miller':       { line: 16.5, overOdds: -115, underOdds: -110 },
};

// ==================== OD ADJUSTMENT FACTORS ====================
// Opening Day pitchers go deeper on average:
// - Managers trust OD starters more (longer leash, later hook)
// - Fresh arms after spring training (not fatigued)
// - Higher intensity = more efficient pitching (less nibbling)
// - Bullpens untested = managers let starters work through jams
const OD_IP_PREMIUM = {
  1: 1.08,  // Tier 1 aces: +8% IP on OD (5.8 → 6.26 IP)
  2: 1.06,  // Tier 2: +6% IP on OD  
  3: 1.04,  // Tier 3: +4% IP on OD
  4: 1.02,  // Tier 4: +2% (still uncertain)
};

// Weather impact on outs:
// Cold weather → suppressed offense → pitchers go deeper (less traffic, fewer pitches wasted)
// Wind out → more balls carry → more hits → shorter outings
// Rain delay risk → bullpen usage shifted
function getWeatherOutsAdj(tempF, windMph, windOut) {
  let adj = 1.0;
  if (tempF && tempF < 45) adj *= 1.02;      // Cold = less offense = longer starts
  if (tempF && tempF < 35) adj *= 1.01;       // Extreme cold = even more
  if (tempF && tempF > 85) adj *= 0.99;        // Heat = fatigue
  if (windOut && windMph > 15) adj *= 0.98;    // Wind out = more traffic = shorter outings
  return adj;
}

// ==================== POISSON MODEL FOR OUTS ====================
// Outs are discrete events (0, 1, 2, ... up to ~27 max)
// Poisson is appropriate for modeling count data
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Calculate P(outs > line), P(outs < line), P(outs = line) for half-integer lines
function outsOverUnderProb(expectedOuts, line) {
  // For .5 lines (e.g., 16.5), over = ≥17, under = ≤16
  const intLine = Math.floor(line); // 16 for 16.5
  let probUnder = 0;
  for (let k = 0; k <= intLine; k++) {
    probUnder += poissonPmf(k, expectedOuts);
  }
  const probOver = 1 - probUnder;
  return { over: probOver, under: probUnder };
}

// Calculate full distribution for display
function outsDistribution(expectedOuts) {
  const dist = [];
  for (let k = 0; k <= 27; k++) {
    const prob = poissonPmf(k, expectedOuts);
    if (prob >= 0.001) {
      dist.push({ outs: k, ip: (k / 3).toFixed(1), prob: +(prob * 100).toFixed(1) });
    }
  }
  return dist;
}

// ==================== CORE PREDICTION ====================
function predictOutsRecorded(pitcherName, oppTeam, options = {}) {
  const proj = PITCHER_IP_PROJECTIONS[pitcherName];
  if (!proj) return null;

  const baseIP = proj.ipPerStart;
  const tier = proj.tier;

  // OD premium — aces go deeper on Opening Day
  const odPremium = options.isOpeningDay !== false ? (OD_IP_PREMIUM[tier] || 1.02) : 1.0;

  // Opponent contact rate adjustment
  // High-contact teams = more balls in play = pitcher throws more pitches per inning
  // This REDUCES expected IP slightly for high-contact opponents
  const oppContact = TEAM_CONTACT_RATE[oppTeam] || LG_AVG_CONTACT;
  const contactAdj = 1 - (oppContact - LG_AVG_CONTACT) * 0.5; // Small effect

  // Weather adjustment
  const weatherAdj = options.tempF ? getWeatherOutsAdj(options.tempF, options.windMph, options.windOut) : 1.0;

  // Calculate expected IP and outs
  const expectedIP = baseIP * odPremium * contactAdj * weatherAdj;
  const expectedOuts = expectedIP * 3;

  // Get book line
  const bookLine = DK_OUTS_LINES[pitcherName];
  
  let edge = null, pick = null, confidence = null, rating = null;
  if (bookLine) {
    const probs = outsOverUnderProb(expectedOuts, bookLine.line);
    
    // Convert American odds to implied probability
    const overImplied = bookLine.overOdds < 0 
      ? Math.abs(bookLine.overOdds) / (Math.abs(bookLine.overOdds) + 100) 
      : 100 / (bookLine.overOdds + 100);
    const underImplied = bookLine.underOdds < 0 
      ? Math.abs(bookLine.underOdds) / (Math.abs(bookLine.underOdds) + 100) 
      : 100 / (bookLine.underOdds + 100);
    
    const overEdge = (probs.over - overImplied) * 100;
    const underEdge = (probs.under - underImplied) * 100;
    
    if (overEdge > underEdge && overEdge > 2) {
      edge = +overEdge.toFixed(1);
      pick = 'OVER';
      confidence = overEdge > 12 ? 'HIGH' : overEdge > 6 ? 'MEDIUM' : 'LOW';
    } else if (underEdge > 2) {
      edge = +underEdge.toFixed(1);
      pick = 'UNDER';
      confidence = underEdge > 12 ? 'HIGH' : underEdge > 6 ? 'MEDIUM' : 'LOW';
    }
    
    // Rating 1-5
    rating = edge > 15 ? 5 : edge > 10 ? 4 : edge > 6 ? 3 : edge > 3 ? 2 : 1;
  }

  return {
    pitcher: pitcherName,
    team: proj.team,
    opponent: oppTeam,
    hand: proj.hand,
    tier,
    projectedIP: +expectedIP.toFixed(2),
    expectedOuts: +expectedOuts.toFixed(1),
    line: bookLine?.line || null,
    overOdds: bookLine?.overOdds || null,
    underOdds: bookLine?.underOdds || null,
    pick,
    edge,
    confidence,
    rating,
    odPremium: +(odPremium * 100 - 100).toFixed(1) + '%',
    contactAdj: +((contactAdj - 1) * 100).toFixed(1) + '%',
    weatherAdj: options.tempF ? +((weatherAdj - 1) * 100).toFixed(1) + '%' : 'N/A',
    distribution: outsDistribution(expectedOuts),
    note: proj.note,
  };
}

// ==================== SCAN ALL OD GAMES ====================
function scanAllODGames() {
  const schedule = mlbOpeningDay.OPENING_DAY_GAMES || [];
  const picks = [];
  
  for (const game of schedule) {
    // Away pitcher
    if (game.confirmedStarters?.away) {
      const pred = predictOutsRecorded(game.confirmedStarters.away, game.home);
      if (pred && pred.pick && pred.edge > 2) {
        picks.push({
          ...pred,
          game: `${game.away}@${game.home}`,
          day: game.day,
          date: game.date,
          time: game.time,
        });
      }
    }
    
    // Home pitcher  
    if (game.confirmedStarters?.home) {
      const pred = predictOutsRecorded(game.confirmedStarters.home, game.away);
      if (pred && pred.pick && pred.edge > 2) {
        picks.push({
          ...pred,
          game: `${game.away}@${game.home}`,
          day: game.day,
          date: game.date,
          time: game.time,
        });
      }
    }
  }
  
  // Sort by edge descending
  picks.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  const highConf = picks.filter(p => p.confidence === 'HIGH');
  const medConf = picks.filter(p => p.confidence === 'MEDIUM');
  const overs = picks.filter(p => p.pick === 'OVER');
  const unders = picks.filter(p => p.pick === 'UNDER');
  
  return {
    totalPicks: picks.length,
    highConfidence: highConf.length,
    mediumConfidence: medConf.length,
    overs: overs.length,
    unders: unders.length,
    avgEdge: picks.length > 0 ? +(picks.reduce((s, p) => s + (p.edge || 0), 0) / picks.length).toFixed(1) : 0,
    topPicks: picks.slice(0, 10),
    allPicks: picks,
    summary: `${picks.length} outs prop picks across ${schedule.length} OD games. ` +
      `${overs.length} OVERS, ${unders.length} UNDERS. ` +
      `${highConf.length} HIGH confidence. ` +
      `OD premium drives OVER lean — aces go deeper game 1.`,
    generatedAt: new Date().toISOString(),
  };
}

// ==================== INDIVIDUAL PITCHER LOOKUP ====================
function getPitcherOutsProps(pitcherName) {
  // Find which game this pitcher is in
  const schedule = mlbOpeningDay.OPENING_DAY_GAMES || [];
  for (const game of schedule) {
    if (game.confirmedStarters?.away === pitcherName) {
      return predictOutsRecorded(pitcherName, game.home);
    }
    if (game.confirmedStarters?.home === pitcherName) {
      return predictOutsRecorded(pitcherName, game.away);
    }
  }
  return null;
}

// ==================== LEADERBOARD ====================
function getOutsLeaderboard() {
  const projections = Object.entries(PITCHER_IP_PROJECTIONS)
    .map(([name, proj]) => ({
      pitcher: name,
      team: proj.team,
      tier: proj.tier,
      hand: proj.hand,
      ipPerStart: proj.ipPerStart,
      expectedOuts: +(proj.ipPerStart * (OD_IP_PREMIUM[proj.tier] || 1.02) * 3).toFixed(1),
      line: DK_OUTS_LINES[name]?.line || null,
      note: proj.note,
    }))
    .sort((a, b) => b.expectedOuts - a.expectedOuts);
  
  return {
    leaderboard: projections,
    avgExpectedOuts: +(projections.reduce((s, p) => s + p.expectedOuts, 0) / projections.length).toFixed(1),
    topWorkhorses: projections.slice(0, 10).map(p => `${p.pitcher} (${p.expectedOuts} outs)`),
  };
}

module.exports = {
  predictOutsRecorded,
  scanAllODGames,
  getPitcherOutsProps,
  getOutsLeaderboard,
  PITCHER_IP_PROJECTIONS,
  DK_OUTS_LINES,
};
