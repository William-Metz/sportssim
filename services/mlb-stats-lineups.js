/**
 * MLB Stats API Lineup Service — SportsSim v108.0
 * =================================================
 * PRIMARY lineup source using the official MLB Stats API (statsapi.mlb.com).
 * 
 * WHY THIS MATTERS FOR $$$:
 *   - MLB Stats API is THE authoritative source for confirmed lineups
 *   - battingOrder[] only populates when lineups are CONFIRMED by managers
 *   - Provides: batting order, positions, bat side, pitcher hand — everything
 *   - ESPN sometimes misses/delays lineup data; MLB API is first
 *   - Faster lineup detection = earlier prediction updates = more edge before line moves
 * 
 * PIPELINE:
 *   1. Fetch schedule from statsapi.mlb.com for game date
 *   2. For each game, check game feed for battingOrder
 *   3. If batting order exists = lineup is CONFIRMED
 *   4. Extract: player name, position, bat side, order, catcher, pitcher hand
 *   5. Map to our team abbreviation system
 *   6. Return normalized lineup data for predict() consumption
 *
 * CACHE: 3-minute TTL (fast enough for pre-game monitoring)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'mlb-stats-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_TTL = 3 * 60 * 1000; // 3 minutes — need fast lineup detection
const FEED_TIMEOUT = 8000; // 8s per game feed

// MLB Stats API endpoints
const SCHEDULE_URL = 'https://statsapi.mlb.com/api/v1/schedule';
const GAME_FEED_URL = 'https://statsapi.mlb.com/api/v1.1/game';

// MLB team ID → our abbreviation mapping
const MLB_TEAM_ID_MAP = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};

// Reverse map: abbreviation → team ID
const ABBR_TO_ID = {};
for (const [id, abbr] of Object.entries(MLB_TEAM_ID_MAP)) {
  ABBR_TO_ID[abbr] = parseInt(id);
}

// In-memory cache
let scheduleCache = {};  // date → { timestamp, data }
let feedCache = {};       // gamePk → { timestamp, data }

// ==================== CORE API FUNCTIONS ====================

function fetchJSON(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/3.0' },
      timeout,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Get MLB schedule for a date (returns gamePk list with team info)
 */
async function fetchSchedule(dateStr) {
  // dateStr format: YYYY-MM-DD
  const normalDate = dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  
  // Check cache
  const cached = scheduleCache[normalDate];
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL * 5) { // 15 min for schedule
    return cached.data;
  }
  
  try {
    const url = `${SCHEDULE_URL}?sportId=1&date=${normalDate}&hydrate=probablePitcher`;
    const data = await fetchJSON(url);
    
    const dates = data.dates || [];
    if (dates.length === 0) return { date: normalDate, games: [] };
    
    const games = (dates[0].games || []).map(g => ({
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      officialDate: g.officialDate,
      status: g.status?.detailedState || 'Unknown',
      statusCode: g.status?.statusCode || 'S',
      awayTeamId: g.teams?.away?.team?.id,
      awayTeamName: g.teams?.away?.team?.name,
      homeTeamId: g.teams?.home?.team?.id,
      homeTeamName: g.teams?.home?.team?.name,
      awayAbbr: MLB_TEAM_ID_MAP[g.teams?.away?.team?.id] || '???',
      homeAbbr: MLB_TEAM_ID_MAP[g.teams?.home?.team?.id] || '???',
      venue: g.venue?.name || 'Unknown',
      dayNight: g.dayNight,
      awayProbable: g.teams?.away?.probablePitcher?.fullName || null,
      homeProbable: g.teams?.home?.probablePitcher?.fullName || null,
      awayProbableId: g.teams?.away?.probablePitcher?.id || null,
      homeProbableId: g.teams?.home?.probablePitcher?.id || null,
      gameType: g.gameType, // R = regular, S = spring, P = postseason
    }));
    
    const result = { date: normalDate, games, fetchedAt: new Date().toISOString() };
    scheduleCache[normalDate] = { timestamp: Date.now(), data: result };
    return result;
  } catch (e) {
    console.error(`[MLBStats] Schedule fetch error for ${normalDate}: ${e.message}`);
    return { date: normalDate, games: [], error: e.message };
  }
}

/**
 * Fetch game feed to get lineup data.
 * The battingOrder[] array only exists when lineups are CONFIRMED.
 */
async function fetchGameFeed(gamePk) {
  // Check cache
  const cached = feedCache[gamePk];
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const url = `${GAME_FEED_URL}/${gamePk}/feed/live`;
    const data = await fetchJSON(url, FEED_TIMEOUT);
    
    const result = parseGameFeed(data, gamePk);
    feedCache[gamePk] = { timestamp: Date.now(), data: result };
    return result;
  } catch (e) {
    console.error(`[MLBStats] Game feed error for ${gamePk}: ${e.message}`);
    return { gamePk, error: e.message, hasLineup: false };
  }
}

/**
 * Parse the MLB Stats API game feed into normalized lineup data
 */
function parseGameFeed(data, gamePk) {
  const gameData = data.gameData || {};
  const liveData = data.liveData || {};
  const boxscore = liveData.boxscore || {};
  const gamePlayers = gameData.players || {};
  
  const status = gameData.status?.detailedState || 'Unknown';
  const statusCode = gameData.status?.statusCode || 'S';
  
  const result = {
    gamePk,
    status,
    statusCode,
    awayTeam: null,
    homeTeam: null,
    hasLineup: false,
  };
  
  for (const side of ['away', 'home']) {
    const teamBox = boxscore.teams?.[side] || {};
    const teamInfo = teamBox.team || {};
    const teamId = teamInfo.id;
    const teamAbbr = MLB_TEAM_ID_MAP[teamId] || teamInfo.abbreviation || '???';
    const battingOrder = teamBox.battingOrder || [];
    const players = teamBox.players || {};
    
    const batters = [];
    let catcher = null;
    const confirmed = battingOrder.length >= 9; // Full lineup = 9 batters
    
    if (confirmed) result.hasLineup = true;
    
    for (let i = 0; i < battingOrder.length; i++) {
      const pid = battingOrder[i];
      const playerData = players[`ID${pid}`] || {};
      const personInfo = playerData.person || {};
      const position = playerData.position || {};
      
      // Get bat side from gameData.players (more reliable)
      const gamePlayerData = gamePlayers[`ID${pid}`] || {};
      const batSide = gamePlayerData.batSide?.code || 'R';
      
      const batter = {
        name: personInfo.fullName || 'Unknown',
        playerId: pid,
        position: position.abbreviation || '?',
        bats: batSide, // R, L, or S (switch)
        order: i + 1,
      };
      
      batters.push(batter);
      
      // Detect catcher
      if ((position.abbreviation === 'C' || position.type === 'Catcher') && !catcher) {
        catcher = {
          name: batter.name,
          playerId: pid,
          bats: batSide,
        };
      }
    }
    
    // Get starting pitcher
    let startingPitcher = null;
    const pitcherIds = teamBox.pitchers || [];
    if (pitcherIds.length > 0) {
      const spId = pitcherIds[0];
      const spData = players[`ID${spId}`] || {};
      const spPerson = spData.person || {};
      const spGameData = gamePlayers[`ID${spId}`] || {};
      
      startingPitcher = {
        name: spPerson.fullName || 'Unknown',
        playerId: spId,
        throws: spGameData.pitchHand?.code || 'R',
      };
    }
    
    const lineupData = {
      teamId,
      teamAbbr,
      teamName: teamInfo.name || '?',
      confirmed,
      batterCount: batters.length,
      batters,
      catcher,
      startingPitcher,
    };
    
    if (side === 'away') result.awayTeam = lineupData;
    else result.homeTeam = lineupData;
  }
  
  return result;
}

// ==================== HIGH-LEVEL FUNCTIONS ====================

/**
 * Get all lineups for a date.
 * Fetches schedule, then game feeds in parallel (batched to avoid hammering API).
 * Returns normalized data compatible with lineup-fetcher.js interface.
 */
async function fetchAllLineups(dateStr = null) {
  if (!dateStr) {
    dateStr = new Date().toISOString().split('T')[0];
  }
  // Normalize to YYYY-MM-DD
  dateStr = dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  
  const schedule = await fetchSchedule(dateStr);
  if (!schedule.games || schedule.games.length === 0) {
    return {
      date: dateStr,
      source: 'mlb-stats-api',
      gamesFound: 0,
      gamesWithLineups: 0,
      games: [],
      fetchedAt: new Date().toISOString(),
    };
  }
  
  // Fetch game feeds in parallel batches of 5 to avoid rate limiting
  const BATCH_SIZE = 5;
  const allFeeds = [];
  
  for (let i = 0; i < schedule.games.length; i += BATCH_SIZE) {
    const batch = schedule.games.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(g => fetchGameFeed(g.gamePk))
    );
    for (const r of batchResults) {
      allFeeds.push(r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    }
  }
  
  // Merge schedule info with feed data
  const games = [];
  for (let i = 0; i < schedule.games.length; i++) {
    const sched = schedule.games[i];
    const feed = allFeeds[i] || {};
    
    games.push({
      gamePk: sched.gamePk,
      gameDate: sched.gameDate,
      gameTime: sched.gameDate,
      status: feed.status || sched.status,
      awayTeam: sched.awayAbbr,
      homeTeam: sched.homeAbbr,
      awayTeamName: sched.awayTeamName,
      homeTeamName: sched.homeTeamName,
      venue: sched.venue,
      hasConfirmedLineup: feed.hasLineup || false,
      
      // Away lineup
      awayLineup: feed.awayTeam ? {
        confirmed: feed.awayTeam.confirmed,
        source: 'mlb-stats-api',
        battingOrder: feed.awayTeam.batters,
        catcher: feed.awayTeam.catcher,
        startingPitcher: feed.awayTeam.startingPitcher || {
          name: sched.awayProbable || 'TBD',
          throws: null,
        },
      } : null,
      
      // Home lineup
      homeLineup: feed.homeTeam ? {
        confirmed: feed.homeTeam.confirmed,
        source: 'mlb-stats-api',
        battingOrder: feed.homeTeam.batters,
        catcher: feed.homeTeam.catcher,
        startingPitcher: feed.homeTeam.startingPitcher || {
          name: sched.homeProbable || 'TBD',
          throws: null,
        },
      } : null,
      
      // Probable pitchers from schedule (available earlier than game feed)
      probablePitchers: {
        away: sched.awayProbable || 'TBD',
        home: sched.homeProbable || 'TBD',
      },
    });
  }
  
  return {
    date: dateStr,
    source: 'mlb-stats-api',
    gamesFound: games.length,
    gamesWithLineups: games.filter(g => g.hasConfirmedLineup).length,
    games,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Get lineup for a specific matchup.
 * Returns normalized lineup data for the away/home pair.
 */
async function getMatchupLineup(awayAbbr, homeAbbr, dateStr = null) {
  const lineups = await fetchAllLineups(dateStr);
  if (!lineups.games) return null;
  
  // Find the matching game
  const game = lineups.games.find(g => {
    return (g.awayTeam === awayAbbr && g.homeTeam === homeAbbr) ||
           (g.awayTeam === awayAbbr.toUpperCase() && g.homeTeam === homeAbbr.toUpperCase());
  });
  
  return game || null;
}

/**
 * Quick check: how many lineups are confirmed for a date?
 * Useful for monitoring dashboard without full feed fetches.
 */
async function getLineupStatus(dateStr = null) {
  const lineups = await fetchAllLineups(dateStr);
  
  const gamesWithLineups = lineups.games.filter(g => g.hasConfirmedLineup);
  const gamesWithoutLineups = lineups.games.filter(g => !g.hasConfirmedLineup);
  
  return {
    date: lineups.date,
    total: lineups.gamesFound,
    confirmed: gamesWithLineups.length,
    pending: gamesWithoutLineups.length,
    confirmedGames: gamesWithLineups.map(g => `${g.awayTeam}@${g.homeTeam}`),
    pendingGames: gamesWithoutLineups.map(g => `${g.awayTeam}@${g.homeTeam}`),
    source: 'mlb-stats-api',
    fetchedAt: lineups.fetchedAt,
  };
}

/**
 * Force clear cache (useful for debugging)
 */
function clearCache() {
  scheduleCache = {};
  feedCache = {};
  return { cleared: true, timestamp: new Date().toISOString() };
}

/**
 * Get status for health checks
 */
function getStatus() {
  return {
    service: 'mlb-stats-lineups',
    version: '1.0',
    source: 'statsapi.mlb.com',
    cacheTTL: CACHE_TTL,
    scheduleCacheEntries: Object.keys(scheduleCache).length,
    feedCacheEntries: Object.keys(feedCache).length,
    teamsMapped: Object.keys(MLB_TEAM_ID_MAP).length,
    note: 'Primary lineup source — battingOrder only populates when confirmed by manager',
  };
}

module.exports = {
  fetchSchedule,
  fetchGameFeed,
  fetchAllLineups,
  getMatchupLineup,
  getLineupStatus,
  clearCache,
  getStatus,
  MLB_TEAM_ID_MAP,
  ABBR_TO_ID,
};
