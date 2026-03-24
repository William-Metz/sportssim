/**
 * Live Lineup Fetcher — SportsSim v35.0
 * ======================================
 * Fetches confirmed batting lineups from ESPN for real-time prediction adjustment.
 * 
 * WHY THIS MATTERS FOR $$$:
 *   - Lineup order affects run expectation by ±0.3-0.5 runs
 *   - Star hitters batting cleanup vs rest days = massive edge
 *   - Catcher assignment affects pitch framing (~10 runs/season)
 *   - Platoon matchups change with confirmed lineups
 *   - Lines move 10-30 cents when lineups drop — we want to be first
 * 
 * Data sources:
 *   - ESPN Game API (confirmed lineups, batting order, positions)
 *   - Our pitcher database (for cross-referencing)
 *   - Our Statcast data (for player-level xwOBA)
 * 
 * Cache: 5-minute TTL (lineups change rapidly close to game time)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'lineup-cache.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes — lineups change close to game time

// ESPN APIs
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const ESPN_GAME_DETAIL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary';

// Star player impact ratings — WAR per 162 games, normalized
// Top 50 position players by projected 2025 WAR
const STAR_PLAYERS = {
  // Elite tier (8+ WAR pace)
  'Shohei Ohtani': { war: 9.2, position: 'DH', bats: 'L', team: 'LAD', impact: 0.15 },
  'Mookie Betts': { war: 8.5, position: 'SS', bats: 'R', team: 'LAD', impact: 0.14 },
  'Aaron Judge': { war: 8.8, position: 'RF', bats: 'R', team: 'NYY', impact: 0.14 },
  'Juan Soto': { war: 7.8, position: 'LF', bats: 'L', team: 'NYM', impact: 0.13 },
  'Bobby Witt Jr.': { war: 8.0, position: 'SS', bats: 'R', team: 'KC', impact: 0.13 },
  
  // Star tier (6-8 WAR pace)
  'Freddie Freeman': { war: 7.2, position: '1B', bats: 'L', team: 'LAD', impact: 0.12 },
  'Corey Seager': { war: 6.8, position: 'SS', bats: 'L', team: 'TEX', impact: 0.11 },
  'Marcus Semien': { war: 6.5, position: '2B', bats: 'R', team: 'TEX', impact: 0.10 },
  'Ronald Acuna Jr.': { war: 7.5, position: 'RF', bats: 'R', team: 'ATL', impact: 0.12 },
  'Trea Turner': { war: 6.3, position: 'SS', bats: 'R', team: 'PHI', impact: 0.10 },
  'Bryce Harper': { war: 6.5, position: '1B', bats: 'L', team: 'PHI', impact: 0.11 },
  'Rafael Devers': { war: 6.5, position: '3B', bats: 'L', team: 'BOS', impact: 0.11 },
  'Gunnar Henderson': { war: 7.0, position: 'SS', bats: 'L', team: 'BAL', impact: 0.12 },
  'Julio Rodriguez': { war: 6.0, position: 'CF', bats: 'R', team: 'SEA', impact: 0.10 },
  'Elly De La Cruz': { war: 6.5, position: 'SS', bats: 'S', team: 'CIN', impact: 0.11 },
  'Willy Adames': { war: 5.8, position: 'SS', bats: 'R', team: 'SF', impact: 0.10 },
  'Francisco Lindor': { war: 6.0, position: 'SS', bats: 'S', team: 'NYM', impact: 0.10 },
  'Yordan Alvarez': { war: 5.5, position: 'DH', bats: 'L', team: 'HOU', impact: 0.09 },
  'Kyle Tucker': { war: 6.0, position: 'RF', bats: 'L', team: 'CHC', impact: 0.10 },
  'Matt Olson': { war: 5.8, position: '1B', bats: 'L', team: 'ATL', impact: 0.10 },
  'Marcell Ozuna': { war: 4.5, position: 'DH', bats: 'R', team: 'PIT', impact: 0.08 },
  'Vladimir Guerrero Jr.': { war: 5.5, position: '1B', bats: 'R', team: 'TOR', impact: 0.09 },
  'Pete Alonso': { war: 4.8, position: '1B', bats: 'R', team: 'BAL', impact: 0.08 },
  'Adley Rutschman': { war: 5.0, position: 'C', bats: 'S', team: 'BAL', impact: 0.09 },
  'J.T. Realmuto': { war: 4.5, position: 'C', bats: 'R', team: 'PHI', impact: 0.08 },
  'Salvador Perez': { war: 4.0, position: 'C', bats: 'R', team: 'KC', impact: 0.07 },
  'William Contreras': { war: 4.5, position: 'C', bats: 'R', team: 'MIL', impact: 0.08 },
  'Will Smith': { war: 4.5, position: 'C', bats: 'R', team: 'LAD', impact: 0.08 },
};

// ==================== CATCHER FRAMING (via catcher-framing.js service) ====================
// Uses REAL Baseball Savant 2024 data (58 qualified catchers)
// Old hardcoded data had 15+ catchers WRONG (including wrong direction!)
let catcherFramingService = null;
try { catcherFramingService = require('./catcher-framing'); } catch (e) { /* optional */ }

// Legacy CATCHER_FRAMING object — now backed by Savant data from catcher-framing service
const CATCHER_FRAMING = catcherFramingService ? catcherFramingService.SAVANT_FRAMING_2024 : {};

// Map team → expected Opening Day catcher (from catcher-framing service or fallback)
const TEAM_OD_CATCHERS = catcherFramingService ? catcherFramingService.TEAM_PRIMARY_CATCHERS_2026 : {
  'ARI': 'Gabriel Moreno', 'ATL': 'Sean Murphy', 'BAL': 'Adley Rutschman',
  'BOS': 'Danny Jansen', 'CHC': 'Miguel Amaya', 'CIN': 'Tyler Stephenson',
  'CLE': 'Bo Naylor', 'COL': 'Jacob Stallings', 'CWS': 'Korey Lee',
  'DET': 'Jake Rogers', 'HOU': 'Yainer Diaz', 'KC': 'Freddy Fermin',
  'LAA': 'Logan O\'Hoppe', 'LAD': 'Will Smith', 'MIA': 'Nick Fortes',
  'MIL': 'William Contreras', 'MIN': 'Ryan Jeffers', 'NYM': 'Francisco Alvarez',
  'NYY': 'Austin Wells', 'OAK': 'Christian Bethancourt', 'PHI': 'J.T. Realmuto',
  'PIT': 'Ben Rortvedt', 'SD': 'Luis Campusano', 'SEA': 'Cal Raleigh',
  'SF': 'Patrick Bailey', 'STL': 'Ivan Herrera', 'TB': 'Rene Pinto',
  'TEX': 'Jonah Heim', 'TOR': 'Alejandro Kirk', 'WSH': 'Keibert Ruiz'
};

/**
 * Get catcher framing adjustment for a matchup.
 * Now delegates to the catcher-framing.js service which uses REAL Savant data.
 * Returns runs adjustment based on the framing gap between catchers.
 * Positive = home catcher advantage (fewer runs expected for home pitcher).
 */
function getCatcherFramingAdjustment(homeTeam, awayTeam) {
  // Use the dedicated Savant-backed service if available
  if (catcherFramingService) {
    return catcherFramingService.getMatchupFramingAnalysis(homeTeam, awayTeam);
  }
  
  // Fallback to basic lookup
  const homeCatcher = TEAM_OD_CATCHERS[homeTeam];
  const awayCatcher = TEAM_OD_CATCHERS[awayTeam];
  
  const homeFraming = homeCatcher && CATCHER_FRAMING[homeCatcher] ? CATCHER_FRAMING[homeCatcher].framingRuns : 0;
  const awayFraming = awayCatcher && CATCHER_FRAMING[awayCatcher] ? CATCHER_FRAMING[awayCatcher].framingRuns : 0;
  
  const perGameFactor = 1 / 162;
  
  return {
    homeCatcher: homeCatcher || 'Unknown',
    awayCatcher: awayCatcher || 'Unknown',
    homeFramingRuns: homeFraming,
    awayFramingRuns: awayFraming,
    framingGap: homeFraming - awayFraming,
    homeRAAdj: -(homeFraming * perGameFactor),
    awayRAAdj: -(awayFraming * perGameFactor),
    totalRunsAdj: -((homeFraming + awayFraming) * perGameFactor),
    homeEdge: ((homeFraming - awayFraming) * perGameFactor * 0.5),
    note: homeFraming > awayFraming + 5 ? `${homeCatcher} elite framer (${homeFraming} runs) vs ${awayCatcher} (${awayFraming})` :
          awayFraming > homeFraming + 5 ? `${awayCatcher} elite framer (${awayFraming} runs) vs ${homeCatcher} (${homeFraming})` :
          'Similar framing quality'
  };
}

// ==================== ESPN DATA FETCHING ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Fetch today's (or specified date's) lineups from ESPN.
 * Returns games with confirmed batting orders and lineup adjustments.
 */
async function fetchLineups(dateStr = null) {
  if (!dateStr) {
    dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  } else {
    dateStr = dateStr.replace(/-/g, '');
  }
  
  // Check cache
  const cache = loadCache();
  if (cache && cache.date === dateStr && (Date.now() - cache.timestamp) < CACHE_TTL) {
    return cache.data;
  }
  
  try {
    const url = `${ESPN_SCOREBOARD}?dates=${dateStr}`;
    const data = await fetchJSON(url);
    
    if (!data.events) return { date: dateStr, games: [], error: 'No games found' };
    
    const games = [];
    
    for (const event of data.events) {
      const game = await parseGameLineup(event);
      if (game) games.push(game);
    }
    
    const result = {
      date: dateStr,
      fetchedAt: new Date().toISOString(),
      gamesFound: games.length,
      gamesWithLineups: games.filter(g => g.hasConfirmedLineup).length,
      games,
    };
    
    // Cache
    saveCache({ date: dateStr, timestamp: Date.now(), data: result });
    
    return result;
  } catch (e) {
    console.error(`[Lineups] Error fetching lineups for ${dateStr}: ${e.message}`);
    return { date: dateStr, games: [], error: e.message };
  }
}

/**
 * Parse ESPN event into lineup data.
 * ESPN's game summary endpoint has detailed roster/lineup info.
 */
async function parseGameLineup(event) {
  try {
    const competition = event.competitions?.[0];
    if (!competition) return null;
    
    const competitors = competition.competitors || [];
    if (competitors.length !== 2) return null;
    
    const away = competitors.find(c => c.homeAway === 'away');
    const home = competitors.find(c => c.homeAway === 'home');
    if (!away || !home) return null;
    
    const gameId = event.id;
    const awayAbbr = away.team?.abbreviation?.toUpperCase() || '';
    const homeAbbr = home.team?.abbreviation?.toUpperCase() || '';
    
    // Try to get detailed game summary (has lineups)
    let awayLineup = null, homeLineup = null;
    try {
      const detail = await fetchJSON(`${ESPN_GAME_DETAIL}?event=${gameId}`);
      awayLineup = extractLineup(detail, 'away', awayAbbr);
      homeLineup = extractLineup(detail, 'home', homeAbbr);
    } catch (e) {
      // Game detail not available yet — lineups not posted
    }
    
    // Get probable pitchers from competition data
    let awayPitcher = null, homePitcher = null;
    for (const c of competitors) {
      if (c.probables && c.probables.length > 0) {
        const p = c.probables[0];
        const pitcherInfo = {
          name: p.athlete?.displayName || p.athlete?.shortName || 'TBD',
          hand: p.athlete?.hand?.abbreviation || null,
          stats: null,
        };
        if (p.statistics && p.statistics.length > 0) {
          pitcherInfo.stats = {};
          for (const stat of p.statistics) {
            pitcherInfo.stats[stat.abbreviation] = stat.displayValue;
          }
        }
        if (c.homeAway === 'away') awayPitcher = pitcherInfo;
        else homePitcher = pitcherInfo;
      }
    }
    
    // Calculate lineup adjustments
    const awayAdj = calculateLineupAdjustment(awayLineup, awayAbbr, homePitcher);
    const homeAdj = calculateLineupAdjustment(homeLineup, homeAbbr, awayPitcher);
    
    // Catcher framing impact
    const awayCatcherFrame = getCatcherFramingImpact(awayLineup);
    const homeCatcherFrame = getCatcherFramingImpact(homeLineup);
    
    const status = competition.status?.type?.name || 'STATUS_SCHEDULED';
    
    return {
      gameId,
      status,
      gameTime: event.date,
      awayTeam: awayAbbr,
      homeTeam: homeAbbr,
      awayPitcher,
      homePitcher,
      hasConfirmedLineup: !!(awayLineup?.confirmed || homeLineup?.confirmed),
      awayLineup: awayLineup ? {
        confirmed: awayLineup.confirmed,
        battingOrder: awayLineup.batters?.map(b => ({
          name: b.name,
          position: b.position,
          bats: b.bats,
          order: b.order,
          isStar: !!STAR_PLAYERS[b.name],
          impact: STAR_PLAYERS[b.name]?.impact || 0,
        })) || [],
        catcher: awayLineup.catcher,
        starsInLineup: awayLineup.batters?.filter(b => STAR_PLAYERS[b.name]).length || 0,
        adjustment: awayAdj,
        catcherFraming: awayCatcherFrame,
      } : null,
      homeLineup: homeLineup ? {
        confirmed: homeLineup.confirmed,
        battingOrder: homeLineup.batters?.map(b => ({
          name: b.name,
          position: b.position,
          bats: b.bats,
          order: b.order,
          isStar: !!STAR_PLAYERS[b.name],
          impact: STAR_PLAYERS[b.name]?.impact || 0,
        })) || [],
        catcher: homeLineup.catcher,
        starsInLineup: homeLineup.batters?.filter(b => STAR_PLAYERS[b.name]).length || 0,
        adjustment: homeAdj,
        catcherFraming: homeCatcherFrame,
      } : null,
      // Combined impact for prediction adjustment
      lineupImpact: {
        awayRunAdj: (awayAdj?.runAdjustment || 0) + (awayCatcherFrame?.runsPerGame || 0),
        homeRunAdj: (homeAdj?.runAdjustment || 0) + (homeCatcherFrame?.runsPerGame || 0),
        // Framing affects opponent's runs, not own
        awayCatcherFraming: awayCatcherFrame?.runsPerGame || 0,
        homeCatcherFraming: homeCatcherFrame?.runsPerGame || 0,
        hasData: !!(awayLineup || homeLineup),
      },
    };
  } catch (e) {
    console.error(`[Lineups] Error parsing game: ${e.message}`);
    return null;
  }
}

/**
 * Extract lineup from ESPN game summary detail.
 */
function extractLineup(detail, side, teamAbbr) {
  if (!detail) return null;
  
  // ESPN boxscore has roster/lineup data
  const boxscore = detail.boxscore;
  if (!boxscore) return null;
  
  const players = boxscore.players;
  if (!players || !Array.isArray(players)) return null;
  
  // Find the team's player data
  const teamData = players.find(p => {
    const abbr = p.team?.abbreviation?.toUpperCase();
    return abbr === teamAbbr;
  });
  
  if (!teamData) return null;
  
  const batters = [];
  let catcher = null;
  let confirmed = false;
  
  // Look for batting lineup in statistics
  const battingStats = teamData.statistics?.find(s => s.name === 'batting');
  if (battingStats && battingStats.athletes && battingStats.athletes.length > 0) {
    confirmed = true;
    for (let i = 0; i < battingStats.athletes.length; i++) {
      const athlete = battingStats.athletes[i];
      const name = athlete.athlete?.displayName || 'Unknown';
      const pos = athlete.athlete?.position?.abbreviation || '';
      const bats = athlete.athlete?.batHand?.abbreviation || 'R';
      
      batters.push({
        name,
        position: pos,
        bats,
        order: i + 1,
      });
      
      if (pos === 'C' && !catcher) {
        catcher = { name, framingData: CATCHER_FRAMING[name] || null };
      }
    }
  }
  
  // Also check rosters if no lineup yet
  if (!confirmed && detail.rosters) {
    const roster = detail.rosters?.find(r => {
      return r.team?.abbreviation?.toUpperCase() === teamAbbr;
    });
    if (roster && roster.roster) {
      for (const player of roster.roster) {
        const pos = player.position?.abbreviation || '';
        const name = player.athlete?.displayName || '';
        if (pos === 'C' && !catcher) {
          catcher = { name, framingData: CATCHER_FRAMING[name] || null };
        }
      }
    }
  }
  
  return {
    confirmed,
    batters,
    catcher,
    teamAbbr,
  };
}

// ==================== LINEUP IMPACT CALCULATIONS ====================

/**
 * Calculate run adjustment from confirmed lineup.
 * Key factors:
 *   1. Star players in/out of lineup
 *   2. Batting order quality (top 3 spots matter most)
 *   3. Platoon matchups (L/R splits vs opposing pitcher)
 *   4. Rest day adjustments (regulars sitting)
 */
function calculateLineupAdjustment(lineup, teamAbbr, opposingPitcher) {
  if (!lineup || !lineup.batters || lineup.batters.length === 0) {
    return { runAdjustment: 0, confidence: 'none', notes: ['No lineup data'] };
  }
  
  let runAdj = 0;
  const notes = [];
  
  // 1. Star player presence
  let starsExpected = 0;
  let starsPresent = 0;
  
  for (const [name, info] of Object.entries(STAR_PLAYERS)) {
    if (info.team === teamAbbr) {
      starsExpected++;
      const inLineup = lineup.batters.some(b => 
        b.name === name || b.name.includes(name.split(' ').pop())
      );
      if (inLineup) {
        starsPresent++;
      } else {
        // Star sitting = negative run adjustment
        runAdj -= info.impact * 0.5; // Half of full-game WAR impact per game
        notes.push(`${name} OUT (-${(info.impact * 0.5).toFixed(2)} runs)`);
      }
    }
  }
  
  // 2. Platoon advantage vs opposing pitcher
  if (opposingPitcher && opposingPitcher.hand) {
    const pitcherHand = opposingPitcher.hand;
    let platoonBatters = 0;
    let totalBatters = lineup.batters.length;
    
    for (const batter of lineup.batters) {
      const bats = batter.bats;
      if (!bats) continue;
      
      // Opposite-hand matchup = platoon advantage
      if ((pitcherHand === 'L' && bats === 'R') || 
          (pitcherHand === 'R' && bats === 'L')) {
        platoonBatters++;
      }
      // Switch hitters always have advantage
      if (bats === 'S') platoonBatters++;
    }
    
    const platoonRate = totalBatters > 0 ? platoonBatters / totalBatters : 0.5;
    
    // Normal platoon rate is ~50%. Deviations matter.
    if (platoonRate > 0.65) {
      const bonus = (platoonRate - 0.5) * 0.6; // ~0.09 runs for 65% platoon
      runAdj += bonus;
      notes.push(`Strong platoon advantage (${(platoonRate * 100).toFixed(0)}% opposite-hand) +${bonus.toFixed(2)} runs`);
    } else if (platoonRate < 0.35) {
      const penalty = (0.5 - platoonRate) * 0.6;
      runAdj -= penalty;
      notes.push(`Platoon disadvantage (${(platoonRate * 100).toFixed(0)}% opposite-hand) -${penalty.toFixed(2)} runs`);
    }
  }
  
  // 3. Top-of-order quality (spots 1-3 get ~40% of PAs)
  const topOrder = lineup.batters.slice(0, 3);
  let topOrderStars = 0;
  for (const b of topOrder) {
    if (STAR_PLAYERS[b.name]) topOrderStars++;
  }
  if (topOrderStars >= 2) {
    runAdj += 0.05;
    notes.push(`Strong top of order (${topOrderStars} stars in 1-3)`);
  }
  
  // Cap adjustment at ±0.4 runs
  runAdj = Math.max(-0.4, Math.min(0.4, runAdj));
  
  return {
    runAdjustment: +runAdj.toFixed(3),
    starsExpected,
    starsPresent,
    confidence: lineup.confirmed ? 'high' : 'low',
    notes,
  };
}

/**
 * Calculate catcher framing impact on run expectation.
 * Good framers save ~15 runs/season = ~0.09 runs/game.
 * This REDUCES opponent's runs (good framing = more called strikes).
 */
function getCatcherFramingImpact(lineup) {
  if (!lineup || !lineup.catcher) return null;
  
  const catcherName = lineup.catcher.name;
  const framingData = CATCHER_FRAMING[catcherName] || lineup.catcher.framingData;
  
  if (!framingData) return { catcher: catcherName, framingRuns: 0, runsPerGame: 0 };
  
  // Convert season framing runs to per-game impact on opponent's runs
  // Negative runsPerGame = good framer = opponent scores LESS
  const runsPerGame = -(framingData.framingRuns / 162) * 0.5; // 50% weight — other factors matter too
  
  return {
    catcher: catcherName,
    framingRuns: framingData.framingRuns,
    runsPerGame: +runsPerGame.toFixed(4),
    tier: framingData.framingRuns >= 10 ? 'elite' : 
          framingData.framingRuns >= 5 ? 'good' :
          framingData.framingRuns >= 0 ? 'average' :
          framingData.framingRuns >= -5 ? 'below_average' : 'poor',
  };
}

// ==================== PREDICTION INTEGRATION ====================

/**
 * Get lineup-based run adjustments for a specific matchup.
 * Returns { awayRunAdj, homeRunAdj, details } to wire into predict().
 */
async function getLineupAdjustments(awayAbbr, homeAbbr, dateStr = null) {
  const lineups = await fetchLineups(dateStr);
  
  if (!lineups || !lineups.games) {
    // Even with no ESPN data, check for manual overrides
    const overrideResult = applyOverrides(null, awayAbbr, homeAbbr);
    if (overrideResult) return overrideResult;
    return { awayRunAdj: 0, homeRunAdj: 0, hasData: false };
  }
  
  // Find the specific game
  const game = lineups.games.find(g => 
    g.awayTeam === awayAbbr && g.homeTeam === homeAbbr
  );
  
  // Check for manual overrides (from od-lineup-verify.js override system)
  const overrideResult = applyOverrides(game, awayAbbr, homeAbbr);
  if (overrideResult) return overrideResult;
  
  if (!game) {
    return { awayRunAdj: 0, homeRunAdj: 0, hasData: false };
  }
  
  // Away team run adjustment:
  //   + own lineup quality (stars present, platoon advantage)
  //   - opponent catcher framing (good catcher = fewer runs for us)
  const awayRunAdj = (game.lineupImpact?.awayRunAdj || 0) + 
                      (game.lineupImpact?.homeCatcherFraming || 0); // Good home catcher hurts away offense
  
  // Home team run adjustment:
  //   + own lineup quality
  //   - opponent catcher framing
  const homeRunAdj = (game.lineupImpact?.homeRunAdj || 0) +
                      (game.lineupImpact?.awayCatcherFraming || 0);
  
  return {
    awayRunAdj: +awayRunAdj.toFixed(3),
    homeRunAdj: +homeRunAdj.toFixed(3),
    hasData: game.lineupImpact?.hasData || false,
    awayLineup: game.awayLineup,
    homeLineup: game.homeLineup,
    details: {
      awayStars: game.awayLineup?.starsInLineup || 0,
      homeStars: game.homeLineup?.starsInLineup || 0,
      awayCatcher: game.awayLineup?.catcherFraming || null,
      homeCatcher: game.homeLineup?.catcherFraming || null,
    },
  };
}

// ==================== OVERRIDE INTEGRATION ====================
// Reads lineup overrides from od-lineup-verify.js override file.
// This is the CRITICAL bridge between the manual override system
// and the prediction pipeline. Without this, game-day overrides
// would not flow into asyncPredict() → predict().

const OVERRIDE_FILE_PATH = path.join(__dirname, 'lineup-overrides.json');

function loadLineupOverrides() {
  try {
    if (fs.existsSync(OVERRIDE_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(OVERRIDE_FILE_PATH, 'utf8'));
    }
  } catch (e) { /* no overrides */ }
  return {};
}

/**
 * Apply manual lineup overrides to a game's prediction adjustments.
 * Returns a full adjustment result if overrides exist, or null to fall through.
 * 
 * Override format (from od-lineup-verify.js):
 * { "DET@SD": { "away": { confirmed: true, batters: [...], catcher: "..." }, "home": {...} } }
 */
function applyOverrides(game, awayAbbr, homeAbbr) {
  const overrides = loadLineupOverrides();
  if (!overrides || Object.keys(overrides).length === 0) return null;
  
  // Try multiple key formats
  const keys = [
    `${awayAbbr}@${homeAbbr}`,
    `${awayAbbr}@${homeAbbr}`.toUpperCase(),
  ];
  
  let override = null;
  for (const key of keys) {
    if (overrides[key]) { override = overrides[key]; break; }
  }
  
  if (!override) return null;
  
  const hasAwayOverride = !!(override.away?.confirmed);
  const hasHomeOverride = !!(override.home?.confirmed);
  
  if (!hasAwayOverride && !hasHomeOverride) return null;
  
  console.log(`[Lineups] 🔄 Applying manual overrides for ${awayAbbr}@${homeAbbr} (away: ${hasAwayOverride ? 'YES' : 'no'}, home: ${hasHomeOverride ? 'YES' : 'no'})`);
  
  // Build lineup objects from override data, calculate adjustments
  const awayLineupData = hasAwayOverride ? buildLineupFromOverride(override.away, awayAbbr) : 
                          (game?.awayLineup || null);
  const homeLineupData = hasHomeOverride ? buildLineupFromOverride(override.home, homeAbbr) :
                          (game?.homeLineup || null);
  
  // Calculate adjustments using existing functions
  const awayAdj = calculateLineupAdjustment(awayLineupData, awayAbbr, null);
  const homeAdj = calculateLineupAdjustment(homeLineupData, homeAbbr, null);
  const awayCatcherFrame = getCatcherFramingImpact(awayLineupData);
  const homeCatcherFrame = getCatcherFramingImpact(homeLineupData);
  
  const awayRunAdj = (awayAdj?.runAdjustment || 0) + (homeCatcherFrame?.runsPerGame || 0);
  const homeRunAdj = (homeAdj?.runAdjustment || 0) + (awayCatcherFrame?.runsPerGame || 0);
  
  return {
    awayRunAdj: +awayRunAdj.toFixed(3),
    homeRunAdj: +homeRunAdj.toFixed(3),
    hasData: true,
    source: 'manual_override',
    awayLineup: awayLineupData ? {
      confirmed: true,
      source: hasAwayOverride ? 'manual_override' : 'ESPN',
      battingOrder: (awayLineupData.batters || []).map(b => ({
        name: b.name, position: b.position, bats: b.bats, order: b.order,
        isStar: !!STAR_PLAYERS[b.name], impact: STAR_PLAYERS[b.name]?.impact || 0,
      })),
      catcher: awayLineupData.catcher,
      starsInLineup: (awayLineupData.batters || []).filter(b => STAR_PLAYERS[b.name]).length,
      adjustment: awayAdj,
      catcherFraming: awayCatcherFrame,
    } : null,
    homeLineup: homeLineupData ? {
      confirmed: true,
      source: hasHomeOverride ? 'manual_override' : 'ESPN',
      battingOrder: (homeLineupData.batters || []).map(b => ({
        name: b.name, position: b.position, bats: b.bats, order: b.order,
        isStar: !!STAR_PLAYERS[b.name], impact: STAR_PLAYERS[b.name]?.impact || 0,
      })),
      catcher: homeLineupData.catcher,
      starsInLineup: (homeLineupData.batters || []).filter(b => STAR_PLAYERS[b.name]).length,
      adjustment: homeAdj,
      catcherFraming: homeCatcherFrame,
    } : null,
    details: {
      awayStars: (awayLineupData?.batters || []).filter(b => STAR_PLAYERS[b.name]).length,
      homeStars: (homeLineupData?.batters || []).filter(b => STAR_PLAYERS[b.name]).length,
      awayCatcher: awayCatcherFrame || null,
      homeCatcher: homeCatcherFrame || null,
      overrideApplied: { away: hasAwayOverride, home: hasHomeOverride },
    },
  };
}

/**
 * Build a lineup data structure from an override entry.
 */
function buildLineupFromOverride(overrideData, teamAbbr) {
  if (!overrideData || !overrideData.batters) return null;
  
  return {
    confirmed: true,
    batters: overrideData.batters.map((b, i) => ({
      name: b.name,
      position: b.position || '',
      bats: b.bats || 'R',
      order: b.order || i + 1,
    })),
    catcher: overrideData.catcher ? { 
      name: overrideData.catcher, 
      framingData: CATCHER_FRAMING[overrideData.catcher] || null 
    } : null,
    teamAbbr,
  };
}

// ==================== CACHE ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { /* cache read failed */ }
  return null;
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* cache write failed */ }
}

// ==================== STATUS ====================

function getStatus() {
  const cache = loadCache();
  const overrides = loadLineupOverrides();
  return {
    service: 'lineup-fetcher',
    version: '2.0',
    cacheFile: CACHE_FILE,
    cacheFresh: cache ? (Date.now() - (cache.timestamp || 0)) < CACHE_TTL : false,
    lastFetch: cache?.data?.fetchedAt || null,
    starPlayersTracked: Object.keys(STAR_PLAYERS).length,
    catchersTracked: Object.keys(CATCHER_FRAMING).length,
    overridesActive: Object.keys(overrides).length,
    overrideGames: Object.keys(overrides),
    note: 'v2.0: Manual overrides from od-lineup-verify now flow into asyncPredict predictions',
  };
}

module.exports = {
  fetchLineups,
  getLineupAdjustments,
  calculateLineupAdjustment,
  getCatcherFramingImpact,
  getCatcherFramingAdjustment,
  applyOverrides,
  loadLineupOverrides,
  buildLineupFromOverride,
  getStatus,
  STAR_PLAYERS,
  CATCHER_FRAMING,
  TEAM_OD_CATCHERS,
};
