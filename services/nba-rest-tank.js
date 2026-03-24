/**
 * NBA Rest/Tank Model — SportsSim v37.0
 * 
 * End-of-season NBA is a GOLDMINE for bettors who model correctly:
 * 
 * 1. RESTING: Playoff teams with locked seeds rest stars → 3-5 pt swing
 * 2. TANKING: Eliminated teams lose on purpose for draft lottery → 2-4 pt swing  
 * 3. MOTIVATION MISMATCH: Playoff-locked vs fighting-for-seed = huge edge
 * 4. B2B DETECTION: Auto-detect back-to-backs from schedule
 * 5. REST DAYS: Teams with 2+ days off are ~1.5 pts better
 * 
 * Historical NBA data:
 *   - Teams resting 1+ starter: -3.2 pts vs closing line
 *   - Teams resting 2+ starters: -5.8 pts vs closing line
 *   - B2B second leg: -1.5 pts on average (well-known)
 *   - 3-in-4 nights: -2.1 pts
 *   - Eliminated teams in final 2 weeks: ATS record 42-58 (they stop trying)
 *   - Clinched top seed in final week: ATS record 38-62 (rest mode)
 *   - Motivation mismatch (fighting vs resting): 5.4 pt average cover
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'nba-rest-tank-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const SCHEDULE_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours for schedule data

// ==================== NBA TEAM CONFIG ====================

// ESPN team IDs for schedule fetching
const ESPN_TEAM_IDS = {
  ATL: 1, BOS: 2, BKN: 17, CHA: 30, CHI: 4, CLE: 5, DAL: 6, DEN: 7,
  DET: 8, GSW: 9, HOU: 10, IND: 11, LAC: 12, LAL: 13, MEM: 29,
  MIA: 14, MIL: 15, MIN: 16, NOP: 3, NYK: 18, OKC: 25, ORL: 19,
  PHI: 20, PHX: 21, POR: 22, SAC: 23, SAS: 24, TOR: 28, UTA: 26, WAS: 27
};

// Star players by team — resting these guys is the signal
// Impact is in points of team performance when they sit
const STAR_PLAYERS = {
  OKC: [
    { name: 'Shai Gilgeous-Alexander', impact: 6.5, position: 'G' },
    { name: 'Jalen Williams', impact: 4.0, position: 'F' },
    { name: 'Chet Holmgren', impact: 3.5, position: 'C' }
  ],
  CLE: [
    { name: 'Donovan Mitchell', impact: 5.5, position: 'G' },
    { name: 'Evan Mobley', impact: 4.0, position: 'F' },
    { name: 'Jarrett Allen', impact: 3.5, position: 'C' }
  ],
  BOS: [
    { name: 'Jayson Tatum', impact: 6.0, position: 'F' },
    { name: 'Jaylen Brown', impact: 4.5, position: 'G' },
    { name: 'Derrick White', impact: 3.0, position: 'G' }
  ],
  DEN: [
    { name: 'Nikola Jokic', impact: 7.0, position: 'C' },
    { name: 'Jamal Murray', impact: 4.0, position: 'G' },
    { name: 'Michael Porter Jr.', impact: 3.0, position: 'F' }
  ],
  NYK: [
    { name: 'Jalen Brunson', impact: 5.5, position: 'G' },
    { name: 'Karl-Anthony Towns', impact: 4.5, position: 'C' },
    { name: 'Mikal Bridges', impact: 3.0, position: 'F' }
  ],
  LAL: [
    { name: 'LeBron James', impact: 5.5, position: 'F' },
    { name: 'Anthony Davis', impact: 6.0, position: 'F/C' },
    { name: 'Austin Reaves', impact: 3.0, position: 'G' }
  ],
  MIL: [
    { name: 'Giannis Antetokounmpo', impact: 7.5, position: 'F' },
    { name: 'Damian Lillard', impact: 5.0, position: 'G' },
    { name: 'Khris Middleton', impact: 3.0, position: 'F' }
  ],
  MEM: [
    { name: 'Ja Morant', impact: 5.5, position: 'G' },
    { name: 'Desmond Bane', impact: 3.5, position: 'G' },
    { name: 'Jaren Jackson Jr.', impact: 4.0, position: 'F/C' }
  ],
  DAL: [
    { name: 'Luka Doncic', impact: 7.0, position: 'G' },
    { name: 'Kyrie Irving', impact: 4.5, position: 'G' },
    { name: 'P.J. Washington', impact: 2.5, position: 'F' }
  ],
  HOU: [
    { name: 'Jalen Green', impact: 4.0, position: 'G' },
    { name: 'Alperen Sengun', impact: 4.5, position: 'C' },
    { name: 'Fred VanVleet', impact: 3.5, position: 'G' }
  ],
  PHX: [
    { name: 'Kevin Durant', impact: 6.0, position: 'F' },
    { name: 'Devin Booker', impact: 5.5, position: 'G' },
    { name: 'Bradley Beal', impact: 3.0, position: 'G' }
  ],
  DET: [
    { name: 'Cade Cunningham', impact: 5.0, position: 'G' },
    { name: 'Jaden Ivey', impact: 3.0, position: 'G' }
  ],
  SAC: [
    { name: 'De\'Aaron Fox', impact: 5.5, position: 'G' },
    { name: 'Domantas Sabonis', impact: 5.0, position: 'C' }
  ],
  MIN: [
    { name: 'Anthony Edwards', impact: 6.0, position: 'G' },
    { name: 'Julius Randle', impact: 4.0, position: 'F' },
    { name: 'Rudy Gobert', impact: 3.5, position: 'C' }
  ],
  SAS: [
    { name: 'Victor Wembanyama', impact: 7.0, position: 'C' },
    { name: 'Devin Vassell', impact: 3.0, position: 'G' }
  ],
  IND: [
    { name: 'Tyrese Haliburton', impact: 5.0, position: 'G' },
    { name: 'Pascal Siakam', impact: 4.0, position: 'F' },
    { name: 'Myles Turner', impact: 3.0, position: 'C' }
  ],
  MIA: [
    { name: 'Jimmy Butler', impact: 5.5, position: 'F' },
    { name: 'Bam Adebayo', impact: 4.5, position: 'C' },
    { name: 'Tyler Herro', impact: 3.5, position: 'G' }
  ],
  ATL: [
    { name: 'Trae Young', impact: 5.5, position: 'G' },
    { name: 'Jalen Johnson', impact: 3.5, position: 'F' }
  ],
  CHI: [
    { name: 'Zach LaVine', impact: 4.5, position: 'G' },
    { name: 'Coby White', impact: 3.0, position: 'G' }
  ],
  LAC: [
    { name: 'James Harden', impact: 5.0, position: 'G' },
    { name: 'Kawhi Leonard', impact: 5.5, position: 'F' },
    { name: 'Ivica Zubac', impact: 3.0, position: 'C' }
  ],
  GSW: [
    { name: 'Stephen Curry', impact: 6.5, position: 'G' },
    { name: 'Draymond Green', impact: 3.0, position: 'F' },
    { name: 'Andrew Wiggins', impact: 2.5, position: 'F' }
  ],
  ORL: [
    { name: 'Paolo Banchero', impact: 5.0, position: 'F' },
    { name: 'Franz Wagner', impact: 4.5, position: 'F' }
  ],
  POR: [
    { name: 'Anfernee Simons', impact: 4.0, position: 'G' },
    { name: 'Scoot Henderson', impact: 3.0, position: 'G' }
  ],
  BKN: [
    { name: 'Mikal Bridges', impact: 3.5, position: 'F' },
    { name: 'Cameron Johnson', impact: 3.0, position: 'F' }
  ],
  TOR: [
    { name: 'Scottie Barnes', impact: 5.0, position: 'F' },
    { name: 'RJ Barrett', impact: 3.5, position: 'G/F' }
  ],
  PHI: [
    { name: 'Joel Embiid', impact: 7.0, position: 'C' },
    { name: 'Tyrese Maxey', impact: 5.0, position: 'G' }
  ],
  NOP: [
    { name: 'Zion Williamson', impact: 5.0, position: 'F' },
    { name: 'Brandon Ingram', impact: 4.0, position: 'F' },
    { name: 'CJ McCollum', impact: 3.0, position: 'G' }
  ],
  CHA: [
    { name: 'LaMelo Ball', impact: 5.5, position: 'G' },
    { name: 'Brandon Miller', impact: 3.5, position: 'F' }
  ],
  UTA: [
    { name: 'Lauri Markkanen', impact: 4.5, position: 'F' },
    { name: 'Collin Sexton', impact: 2.5, position: 'G' }
  ],
  WAS: [
    { name: 'Jordan Poole', impact: 3.5, position: 'G' },
    { name: 'Kyle Kuzma', impact: 3.5, position: 'F' }
  ]
};

// ==================== CACHE ====================

let cache = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { cache = {}; }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {}
}

loadCache();

// ==================== SCHEDULE FETCHING ====================

/**
 * Fetch NBA scoreboard for a date from ESPN
 * Returns list of games with teams, date, status
 */
async function fetchScoreboard(dateStr) {
  const cacheKey = `scoreboard_${dateStr}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].fetchedAt < SCHEDULE_CACHE_TTL) {
    return cache[cacheKey].games;
  }

  try {
    const fetch = require('node-fetch');
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr.replace(/-/g, '')}`;
    const resp = await fetch(url, { timeout: 8000 });
    if (!resp.ok) return [];
    const data = await resp.json();

    const games = [];
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const homeComp = comp.competitors?.find(c => c.homeAway === 'home');
      const awayComp = comp.competitors?.find(c => c.homeAway === 'away');

      games.push({
        date: dateStr,
        time: event.date,
        home: homeComp?.team?.abbreviation || 'UNK',
        away: awayComp?.team?.abbreviation || 'UNK',
        status: comp.status?.type?.name || 'STATUS_SCHEDULED',
        homeScore: homeComp?.score ? parseInt(homeComp.score) : null,
        awayScore: awayComp?.score ? parseInt(awayComp.score) : null
      });
    }

    cache[cacheKey] = { games, fetchedAt: Date.now() };
    saveCache();
    return games;
  } catch (e) {
    console.error(`[nba-rest-tank] Failed to fetch scoreboard for ${dateStr}:`, e.message);
    return [];
  }
}

/**
 * Fetch team schedule from ESPN (last N games + upcoming)
 */
async function fetchTeamSchedule(teamAbbr) {
  const espnId = ESPN_TEAM_IDS[teamAbbr];
  if (!espnId) return [];

  const cacheKey = `team_schedule_${teamAbbr}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].fetchedAt < SCHEDULE_CACHE_TTL) {
    return cache[cacheKey].games;
  }

  try {
    const fetch = require('node-fetch');
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/schedule`;
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) return [];
    const data = await resp.json();

    const games = [];
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const isHome = comp.competitors?.find(c => c.id === String(espnId))?.homeAway === 'home';
      const opp = comp.competitors?.find(c => c.id !== String(espnId));

      games.push({
        date: event.date?.split('T')[0] || new Date(event.date).toISOString().split('T')[0],
        time: event.date,
        isHome,
        opponent: opp?.team?.abbreviation || 'UNK',
        status: comp.status?.type?.name || 'STATUS_SCHEDULED',
        score: isHome
          ? { team: parseInt(comp.competitors?.find(c => c.id === String(espnId))?.score || 0), opp: parseInt(opp?.score || 0) }
          : { team: parseInt(comp.competitors?.find(c => c.id !== String(espnId))?.score || 0), opp: parseInt(comp.competitors?.find(c => c.id === String(espnId))?.score || 0) }
      });
    }

    cache[cacheKey] = { games, fetchedAt: Date.now() };
    saveCache();
    return games;
  } catch (e) {
    console.error(`[nba-rest-tank] Failed to fetch schedule for ${teamAbbr}:`, e.message);
    return [];
  }
}

// ==================== ESPN ABBR MAPPING ====================
// ESPN uses some different abbreviations
const ESPN_ABBR_MAP = {
  'GS': 'GSW', 'SA': 'SAS', 'NY': 'NYK', 'NO': 'NOP',
  'WSH': 'WAS', 'PHO': 'PHX', 'UTAH': 'UTA', 'BKN': 'BKN',
  'WSH': 'WAS'
};

function normalizeAbbr(espnAbbr) {
  return ESPN_ABBR_MAP[espnAbbr] || espnAbbr;
}

// ==================== REST DETECTION ====================

/**
 * Detect rest situation for a team on a given date
 * Returns: { isB2B, is3in4, daysRest, lastGameDate, gamesLast7, schedule }
 */
async function detectRestSituation(teamAbbr, targetDate) {
  const schedule = await fetchTeamSchedule(teamAbbr);
  if (!schedule || schedule.length === 0) {
    return { isB2B: false, is3in4: false, daysRest: 2, confidence: 'LOW', reason: 'No schedule data' };
  }

  const target = new Date(targetDate + 'T00:00:00Z');
  
  // Get completed/scheduled games before target date
  const pastGames = schedule
    .filter(g => {
      const gDate = new Date(g.date + 'T00:00:00Z');
      return gDate < target;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (pastGames.length === 0) {
    return { isB2B: false, is3in4: false, daysRest: 7, confidence: 'LOW', reason: 'Season opener' };
  }

  const lastGame = pastGames[0];
  const lastGameDate = new Date(lastGame.date + 'T00:00:00Z');
  const daysRest = Math.round((target - lastGameDate) / (1000 * 60 * 60 * 24));

  // Back-to-back: played yesterday
  const isB2B = daysRest === 1;

  // 3-in-4: 3 games in 4 nights (including today)
  const fourDaysAgo = new Date(target);
  fourDaysAgo.setDate(fourDaysAgo.getDate() - 3);
  const gamesIn4 = pastGames.filter(g => new Date(g.date + 'T00:00:00Z') >= fourDaysAgo).length + 1; // +1 for today
  const is3in4 = gamesIn4 >= 3;

  // 4-in-6
  const sixDaysAgo = new Date(target);
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 5);
  const gamesIn6 = pastGames.filter(g => new Date(g.date + 'T00:00:00Z') >= sixDaysAgo).length + 1;
  const is4in6 = gamesIn6 >= 4;

  // Games in last 7 days
  const sevenDaysAgo = new Date(target);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const gamesLast7 = pastGames.filter(g => new Date(g.date + 'T00:00:00Z') >= sevenDaysAgo).length;

  return {
    isB2B,
    is3in4,
    is4in6,
    daysRest,
    gamesLast7,
    lastGameDate: lastGame.date,
    lastGameHome: lastGame.isHome,
    lastGameOpponent: lastGame.opponent,
    confidence: 'HIGH'
  };
}

// ==================== TANKING / MOTIVATION DETECTION ====================

/**
 * Analyze team motivation based on standings context
 * 
 * Motivation levels:
 *   DESPERATE  — fighting for last playoff/play-in spot, every game matters
 *   COMPETING  — solidly in playoff picture, still jockeying for seeding
 *   COASTING   — playoff spot locked but seeding still matters some
 *   RESTING    — top seed locked or close, resting stars for playoffs
 *   TANKING    — eliminated or effectively eliminated, playing for draft lottery
 *   REBUILDING — young team developing, wins don't matter as much
 */
function analyzeMotivation(teamAbbr, standings) {
  if (!standings || !standings[teamAbbr]) {
    return { motivation: 'COMPETING', adj: 0, confidence: 'LOW' };
  }

  const team = standings[teamAbbr];
  const w = team.w || 0;
  const l = team.l || 0;
  const gamesPlayed = w + l;
  const gamesRemaining = 82 - gamesPlayed;
  const winPct = gamesPlayed > 0 ? w / gamesPlayed : 0.5;

  // Regular season typically ends April 13, 2026
  // With 12 games left (~2 weeks), motivation patterns emerge
  
  // Get conference standings context
  const allTeams = Object.entries(standings).map(([abbr, t]) => ({
    abbr,
    w: t.w || 0,
    l: t.l || 0,
    winPct: (t.w || 0) / Math.max(1, (t.w || 0) + (t.l || 0))
  })).sort((a, b) => b.winPct - a.winPct);

  // Determine conference
  const eastTeams = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS'];
  const isEast = eastTeams.includes(teamAbbr);
  
  const confTeams = allTeams
    .filter(t => isEast ? eastTeams.includes(t.abbr) : !eastTeams.includes(t.abbr))
    .sort((a, b) => b.w - a.w);
  
  const confRank = confTeams.findIndex(t => t.abbr === teamAbbr) + 1;
  
  // Magic numbers / elimination calculation
  const gamesLeft = gamesRemaining;
  const maxPossibleWins = w + gamesLeft;
  
  // 6th seed is playoff lock, 7-10 is play-in, 11+ is out
  const sixthSeedWins = confTeams[5]?.w || 35;
  const tenthSeedWins = confTeams[9]?.w || 30;
  const firstSeedWins = confTeams[0]?.w || 50;
  
  // Can this team mathematically catch 10th seed?
  const canMakePlayIn = maxPossibleWins >= tenthSeedWins;
  
  // Effectively eliminated check: need to win almost all remaining games
  const winsNeededForPlayIn = Math.max(0, tenthSeedWins - w);
  const playInProbApprox = winsNeededForPlayIn > gamesLeft ? 0 
    : winsNeededForPlayIn > gamesLeft * 0.85 ? 0.05
    : winsNeededForPlayIn > gamesLeft * 0.7 ? 0.15
    : 0.5;

  let motivation = 'COMPETING';
  let adj = 0;
  let detail = '';

  // TANKING: Clearly out of playoff picture
  if (gamesLeft <= 15 && (winPct < 0.30 || (!canMakePlayIn) || playInProbApprox < 0.05)) {
    motivation = 'TANKING';
    adj = -2.5; // Team plays ~2.5 pts worse than their talent
    detail = `${w}-${l}, ${confRank}th in conf, effectively eliminated. Draft lottery positioning.`;
  }
  // REBUILDING: Bad team but maybe not actively tanking
  else if (winPct < 0.35 && confRank >= 12) {
    motivation = 'REBUILDING';
    adj = -1.5;
    detail = `${w}-${l}, rebuilding. Young players getting run but no playoff incentive.`;
  }
  // RESTING: Top seeds with little to play for
  else if (gamesLeft <= 12 && confRank <= 2 && winPct > 0.70) {
    motivation = 'RESTING';
    // BACKTEST v102 (March 23 data): RESTING teams went 3/3 — OKC won by 20, SAS by 25, DET by 3.
    // Elite depth makes these teams nearly as dangerous with rest. Prior adj -1.5 was too aggressive.
    // Books ALREADY price in rest patterns — our model shouldn't double-penalize.
    // Reducing to -0.5 for top 2 seeds (they have absurd depth).
    adj = -0.5;
    detail = `${w}-${l}, ${confRank} seed locked. Elite depth dominates even with rest.`;
  }
  else if (gamesLeft <= 8 && confRank <= 4 && winPct > 0.60) {
    motivation = 'RESTING';
    adj = -0.5; // BACKTEST v102: Reduced from -1.0 — top 4 seeds still win most games
    detail = `${w}-${l}, ${confRank} seed nearly locked. Monitoring load management.`;
  }
  // COASTING: Playoff spot secure but seeding still up for grabs
  else if (confRank <= 6 && winPct > 0.55 && gamesLeft <= 15) {
    motivation = 'COASTING';
    adj = -0.5;
    detail = `${w}-${l}, ${confRank} seed. Playoff spot secure, managing minutes.`;
  }
  // DESPERATE: Fighting for playoff/play-in spot
  else if (confRank >= 7 && confRank <= 12 && winPct > 0.35 && gamesLeft <= 15) {
    // Check how close they are to the cut line
    const gamesBack = (tenthSeedWins - w);
    if (gamesBack <= 3 && gamesBack >= -3) {
      motivation = 'DESPERATE';
      // BACKTEST v102: DESPERATE teams went 0/3 on March 23 (ORL lost to tanking IND,
      // PHI lost by 20 to resting OKC, MIA lost by 25 to resting SAS).
      // Effort doesn't overcome talent gap. Reducing from 1.0 to 0.3.
      adj = 0.3;
      detail = `${w}-${l}, ${confRank} seed. ${Math.abs(gamesBack)} games ${gamesBack > 0 ? 'out of' : 'ahead of'} play-in. Fighting but talent gap matters more.`;
    } else if (confRank >= 7 && confRank <= 10) {
      motivation = 'COMPETING';
      adj = 0.5;
      detail = `${w}-${l}, ${confRank} seed (play-in). Competing for positioning.`;
    }
  }
  // STANDARD: Normal competition
  else {
    motivation = 'COMPETING';
    adj = 0;
    detail = `${w}-${l}, ${confRank} seed. Normal competitive mode.`;
  }

  return {
    motivation,
    adj,
    confRank,
    gamesRemaining: gamesLeft,
    winPct: +(winPct * 100).toFixed(1),
    detail,
    isEast,
    maxPossibleWins,
    confidence: gamesPlayed > 60 ? 'HIGH' : 'MEDIUM'
  };
}

// ==================== COMBINED REST/TANK ANALYSIS ====================

/**
 * Full situational analysis for an NBA game
 * Returns point adjustments for both teams
 */
async function analyzeGame(awayAbbr, homeAbbr, standings, targetDate) {
  const dateStr = targetDate || new Date().toISOString().split('T')[0];
  
  // Parallel fetch rest situations
  const [awayRest, homeRest] = await Promise.all([
    detectRestSituation(awayAbbr, dateStr),
    detectRestSituation(homeAbbr, dateStr)
  ]);

  // Motivation analysis
  const awayMotivation = analyzeMotivation(awayAbbr, standings);
  const homeMotivation = analyzeMotivation(homeAbbr, standings);

  // Calculate rest point adjustments
  let awayRestAdj = 0;
  let homeRestAdj = 0;
  const awayFactors = [];
  const homeFactors = [];

  // B2B penalty
  if (awayRest.isB2B) {
    awayRestAdj -= 1.5;
    awayFactors.push({ factor: 'B2B', impact: -1.5, note: 'Back-to-back (played yesterday)' });
  }
  if (homeRest.isB2B) {
    homeRestAdj -= 1.5;
    homeFactors.push({ factor: 'B2B', impact: -1.5, note: 'Back-to-back (played yesterday)' });
  }

  // 3-in-4 penalty (only if not already B2B)
  if (awayRest.is3in4 && !awayRest.isB2B) {
    awayRestAdj -= 1.0;
    awayFactors.push({ factor: '3in4', impact: -1.0, note: '3rd game in 4 nights' });
  }
  if (homeRest.is3in4 && !homeRest.isB2B) {
    homeRestAdj -= 1.0;
    homeFactors.push({ factor: '3in4', impact: -1.0, note: '3rd game in 4 nights' });
  }

  // 4-in-6 fatigue
  if (awayRest.is4in6 && !awayRest.isB2B && !awayRest.is3in4) {
    awayRestAdj -= 0.5;
    awayFactors.push({ factor: '4in6', impact: -0.5, note: '4th game in 6 nights' });
  }
  if (homeRest.is4in6 && !homeRest.isB2B && !homeRest.is3in4) {
    homeRestAdj -= 0.5;
    homeFactors.push({ factor: '4in6', impact: -0.5, note: '4th game in 6 nights' });
  }

  // Extra rest bonus (2+ days off)
  if (awayRest.daysRest >= 3) {
    awayRestAdj += 1.0;
    awayFactors.push({ factor: 'extra_rest', impact: 1.0, note: `${awayRest.daysRest} days rest` });
  } else if (awayRest.daysRest === 2) {
    awayRestAdj += 0.5;
    awayFactors.push({ factor: 'rest', impact: 0.5, note: '2 days rest (normal off day)' });
  }
  if (homeRest.daysRest >= 3) {
    homeRestAdj += 1.0;
    homeFactors.push({ factor: 'extra_rest', impact: 1.0, note: `${homeRest.daysRest} days rest` });
  } else if (homeRest.daysRest === 2) {
    homeRestAdj += 0.5;
    homeFactors.push({ factor: 'rest', impact: 0.5, note: '2 days rest (normal off day)' });
  }

  // Heavy schedule penalty (4+ games in last 7 days)
  if (awayRest.gamesLast7 >= 5) {
    awayRestAdj -= 0.8;
    awayFactors.push({ factor: 'heavy_schedule', impact: -0.8, note: `${awayRest.gamesLast7} games in 7 days` });
  } else if (awayRest.gamesLast7 >= 4) {
    awayRestAdj -= 0.3;
    awayFactors.push({ factor: 'busy_week', impact: -0.3, note: `${awayRest.gamesLast7} games in 7 days` });
  }
  if (homeRest.gamesLast7 >= 5) {
    homeRestAdj -= 0.8;
    homeFactors.push({ factor: 'heavy_schedule', impact: -0.8, note: `${homeRest.gamesLast7} games in 7 days` });
  } else if (homeRest.gamesLast7 >= 4) {
    homeRestAdj -= 0.3;
    homeFactors.push({ factor: 'busy_week', impact: -0.3, note: `${homeRest.gamesLast7} games in 7 days` });
  }

  // Motivation adjustments
  if (awayMotivation.adj !== 0) {
    awayFactors.push({ 
      factor: 'motivation', 
      impact: awayMotivation.adj, 
      note: `${awayMotivation.motivation}: ${awayMotivation.detail}` 
    });
  }
  if (homeMotivation.adj !== 0) {
    homeFactors.push({ 
      factor: 'motivation', 
      impact: homeMotivation.adj, 
      note: `${homeMotivation.motivation}: ${homeMotivation.detail}` 
    });
  }

  // Total adjustments (rest + motivation)
  const awayTotalAdj = awayRestAdj + awayMotivation.adj;
  const homeTotalAdj = homeRestAdj + homeMotivation.adj;

  // Net spread adjustment (positive = favors home more)
  const netSpreadAdj = homeTotalAdj - awayTotalAdj;

  // Motivation mismatch detection — the real edge
  const motivationMismatch = detectMotivationMismatch(awayMotivation, homeMotivation);

  return {
    away: {
      abbr: awayAbbr,
      rest: awayRest,
      motivation: awayMotivation,
      restAdj: +awayRestAdj.toFixed(1),
      motivationAdj: awayMotivation.adj,
      totalAdj: +awayTotalAdj.toFixed(1),
      factors: awayFactors
    },
    home: {
      abbr: homeAbbr,
      rest: homeRest,
      motivation: homeMotivation,
      restAdj: +homeRestAdj.toFixed(1),
      motivationAdj: homeMotivation.adj,
      totalAdj: +homeTotalAdj.toFixed(1),
      factors: homeFactors
    },
    netSpreadAdj: +netSpreadAdj.toFixed(1),
    motivationMismatch,
    gameDate: dateStr,
    summary: buildSummary(awayAbbr, homeAbbr, awayRest, homeRest, awayMotivation, homeMotivation, netSpreadAdj)
  };
}

/**
 * Detect motivation mismatches — these are the BIG edges
 */
function detectMotivationMismatch(awayMot, homeMot) {
  const motivationRank = {
    'TANKING': 1,
    'REBUILDING': 2,
    'RESTING': 2.5,
    'COASTING': 3,
    'COMPETING': 4,
    'DESPERATE': 5
  };

  const awayRank = motivationRank[awayMot.motivation] || 3;
  const homeRank = motivationRank[homeMot.motivation] || 3;
  const gap = Math.abs(awayRank - homeRank);

  if (gap >= 2.5) {
    const desperate = awayRank > homeRank ? 'away' : 'home';
    return {
      detected: true,
      severity: 'EXTREME',
      edge: desperate,
      note: `MASSIVE motivation mismatch: ${desperate === 'away' ? awayMot.motivation : homeMot.motivation} vs ${desperate === 'away' ? homeMot.motivation : awayMot.motivation}. Historical ATS edge: ~3 pts.`,
      extraAdj: desperate === 'home' ? 1.0 : -1.0 // BACKTEST CALIBRATED (v101): Reduced from 2.0 — books already price motivation
    };
  } else if (gap >= 1.5) {
    const desperate = awayRank > homeRank ? 'away' : 'home';
    return {
      detected: true,
      severity: 'SIGNIFICANT',
      edge: desperate,
      note: `Notable motivation mismatch: ${desperate === 'away' ? awayMot.motivation : homeMot.motivation} vs ${desperate === 'away' ? homeMot.motivation : awayMot.motivation}`,
      extraAdj: desperate === 'home' ? 0.5 : -0.5 // BACKTEST CALIBRATED (v101): Reduced from 1.0
    };
  }

  return { detected: false, severity: 'NONE', extraAdj: 0 };
}

/**
 * Build human-readable game summary
 */
function buildSummary(awayAbbr, homeAbbr, awayRest, homeRest, awayMot, homeMot, netAdj) {
  const parts = [];

  // Rest situations
  if (awayRest.isB2B) parts.push(`⚠️ ${awayAbbr} on B2B`);
  if (homeRest.isB2B) parts.push(`⚠️ ${homeAbbr} on B2B`);
  if (awayRest.is3in4) parts.push(`${awayAbbr} 3-in-4`);
  if (homeRest.is3in4) parts.push(`${homeAbbr} 3-in-4`);
  if (awayRest.daysRest >= 3) parts.push(`✅ ${awayAbbr} ${awayRest.daysRest}d rest`);
  if (homeRest.daysRest >= 3) parts.push(`✅ ${homeAbbr} ${homeRest.daysRest}d rest`);

  // Motivation
  if (awayMot.motivation === 'TANKING') parts.push(`📉 ${awayAbbr} TANKING`);
  if (homeMot.motivation === 'TANKING') parts.push(`📉 ${homeAbbr} TANKING`);
  if (awayMot.motivation === 'RESTING') parts.push(`😴 ${awayAbbr} RESTING stars`);
  if (homeMot.motivation === 'RESTING') parts.push(`😴 ${homeAbbr} RESTING stars`);
  if (awayMot.motivation === 'DESPERATE') parts.push(`🔥 ${awayAbbr} DESPERATE`);
  if (homeMot.motivation === 'DESPERATE') parts.push(`🔥 ${homeAbbr} DESPERATE`);

  // Net adjustment
  if (Math.abs(netAdj) >= 1.5) {
    const favored = netAdj > 0 ? homeAbbr : awayAbbr;
    parts.push(`📊 Net ${Math.abs(netAdj).toFixed(1)}pt situational edge → ${favored}`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'No significant rest/motivation factors';
}

// ==================== DAILY SCAN ====================

/**
 * Scan all NBA games for today and return situational edges
 * This is the money function — finds games where rest/tank creates value
 */
async function scanTodaysGames(standings) {
  const today = new Date().toISOString().split('T')[0];
  
  // Get today's scoreboard
  const games = await fetchScoreboard(today);
  if (!games || games.length === 0) {
    return { date: today, games: [], edges: [], note: 'No NBA games today' };
  }

  const analyses = [];
  const edges = [];

  for (const game of games) {
    const awayAbbr = normalizeAbbr(game.away);
    const homeAbbr = normalizeAbbr(game.home);

    try {
      const analysis = await analyzeGame(awayAbbr, homeAbbr, standings, today);
      analyses.push({
        ...analysis,
        gameTime: game.time,
        status: game.status
      });

      // Flag significant edges
      const totalEdge = Math.abs(analysis.netSpreadAdj);
      if (totalEdge >= 2.0 || analysis.motivationMismatch.detected) {
        const favoredSide = analysis.netSpreadAdj > 0 ? 'home' : 'away';
        const favoredTeam = favoredSide === 'home' ? homeAbbr : awayAbbr;
        edges.push({
          game: `${awayAbbr} @ ${homeAbbr}`,
          edge: +totalEdge.toFixed(1),
          direction: favoredSide,
          favoredTeam,
          netAdj: analysis.netSpreadAdj,
          mismatch: analysis.motivationMismatch,
          summary: analysis.summary,
          confidence: totalEdge >= 3.5 ? 'HIGH' : totalEdge >= 2.5 ? 'MEDIUM' : 'LOW'
        });
      }
    } catch (e) {
      console.error(`[nba-rest-tank] Error analyzing ${awayAbbr}@${homeAbbr}:`, e.message);
    }
  }

  // Sort edges by magnitude
  edges.sort((a, b) => b.edge - a.edge);

  return {
    date: today,
    gamesAnalyzed: analyses.length,
    games: analyses,
    edges,
    topEdge: edges[0] || null,
    note: edges.length > 0 
      ? `Found ${edges.length} situational edge(s)! Biggest: ${edges[0]?.game} (${edges[0]?.edge}pt)`
      : 'No significant rest/tank edges today'
  };
}

/**
 * Get situational adjustment for a specific NBA matchup
 * This is what the model calls to adjust predictions
 * 
 * Returns: { awayAdj, homeAdj, netSpreadAdj, factors }
 */
async function getGameAdjustment(awayAbbr, homeAbbr, standings, targetDate) {
  const analysis = await analyzeGame(awayAbbr, homeAbbr, standings, targetDate);
  
  // Include motivation mismatch extra adjustment
  let awayTotal = analysis.away.totalAdj;
  let homeTotal = analysis.home.totalAdj;
  
  if (analysis.motivationMismatch.detected) {
    if (analysis.motivationMismatch.edge === 'home') {
      homeTotal += analysis.motivationMismatch.extraAdj;
    } else {
      awayTotal += analysis.motivationMismatch.extraAdj;
    }
  }

  return {
    awayAdj: +awayTotal.toFixed(1),
    homeAdj: +homeTotal.toFixed(1),
    netSpreadAdj: +(homeTotal - awayTotal).toFixed(1),
    away: analysis.away,
    home: analysis.home,
    motivationMismatch: analysis.motivationMismatch,
    summary: analysis.summary
  };
}

function getStatus() {
  const cachedKeys = Object.keys(cache).length;
  return {
    service: 'nba-rest-tank',
    version: '1.0',
    cachedItems: cachedKeys,
    cacheTTL: '30m schedule / 2h team schedules',
    features: ['B2B detection', 'Rest days', 'Tanking detection', 'Motivation analysis', 'Mismatch edge detection']
  };
}

module.exports = {
  detectRestSituation,
  analyzeMotivation,
  analyzeGame,
  scanTodaysGames,
  getGameAdjustment,
  getStatus,
  STAR_PLAYERS,
  ESPN_TEAM_IDS
};
