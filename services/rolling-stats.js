/**
 * SportsSim Rolling Stats Service
 * 
 * Fetches recent game results and calculates L5/L10 rolling stats:
 *   - Win/loss records over sliding windows
 *   - Rolling offensive/defensive ratings  
 *   - Point/run/goal differentials
 *   - Momentum & trend indicators (🔥 hot, 🧊 cold, ➡️ steady)
 * 
 * Data sources:
 *   - ESPN Scoreboard API (NBA, MLB)
 *   - NHL Official API (schedule + scores)
 * 
 * Cache: 30-min refresh, stored alongside live-data cache
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'rolling-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ==================== ABBREVIATION MAPS ====================

const ESPN_NBA_ABBR_MAP = {
  'NY': 'NYK', 'GS': 'GSW', 'SA': 'SAS', 'NO': 'NOP', 'UTAH': 'UTA', 'WSH': 'WAS',
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BKN', 'CHA': 'CHA', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'HOU': 'HOU',
  'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM', 'MIA': 'MIA',
  'MIL': 'MIL', 'MIN': 'MIN', 'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI',
  'PHX': 'PHX', 'POR': 'POR', 'SAC': 'SAC', 'TOR': 'TOR'
};

const ESPN_MLB_ABBR_MAP = {
  'WSH': 'WSH', 'CWS': 'CWS',
  'ATL': 'ATL', 'ARI': 'ARI', 'BAL': 'BAL', 'BOS': 'BOS', 'CHC': 'CHC',
  'CIN': 'CIN', 'CLE': 'CLE', 'COL': 'COL', 'DET': 'DET', 'HOU': 'HOU',
  'KC': 'KC', 'LAA': 'LAA', 'LAD': 'LAD', 'MIA': 'MIA', 'MIL': 'MIL',
  'MIN': 'MIN', 'NYM': 'NYM', 'NYY': 'NYY', 'OAK': 'OAK', 'PHI': 'PHI',
  'PIT': 'PIT', 'SD': 'SD', 'SF': 'SF', 'SEA': 'SEA', 'STL': 'STL',
  'TB': 'TB', 'TEX': 'TEX', 'TOR': 'TOR'
};

const NHL_API_ABBR_MAP = {
  'UTA': 'ARI',
  'ANA': 'ANA', 'BOS': 'BOS', 'BUF': 'BUF', 'CGY': 'CGY', 'CAR': 'CAR',
  'CHI': 'CHI', 'COL': 'COL', 'CBJ': 'CBJ', 'DAL': 'DAL', 'DET': 'DET',
  'EDM': 'EDM', 'FLA': 'FLA', 'LAK': 'LAK', 'MIN': 'MIN', 'MTL': 'MTL',
  'NSH': 'NSH', 'NJD': 'NJD', 'NYI': 'NYI', 'NYR': 'NYR', 'OTT': 'OTT',
  'PHI': 'PHI', 'PIT': 'PIT', 'SJS': 'SJS', 'SEA': 'SEA', 'STL': 'STL',
  'TBL': 'TBL', 'TOR': 'TOR', 'VAN': 'VAN', 'VGK': 'VGK', 'WSH': 'WSH',
  'WPG': 'WPG'
};

// ==================== CACHE ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[rolling-stats] Cache read error:', e.message);
  }
  return { nba: null, nhl: null, mlb: null, timestamps: {} };
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[rolling-stats] Cache write error:', e.message);
  }
}

function isCacheFresh(sport, cache) {
  const ts = cache?.timestamps?.[sport];
  if (!ts) return false;
  return (Date.now() - ts) < CACHE_TTL;
}

// ==================== DATE HELPERS ====================

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function getDateRange(daysBack) {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(formatDate(d));
  }
  return dates;
}

// ==================== ESPN GAME FETCHER ====================

async function fetchESPNScoreboard(sport, league, dateStr) {
  const fetch = require('node-fetch');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${dateStr}`;
  try {
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.events || [];
  } catch (e) {
    console.error(`[rolling-stats] ESPN ${league} scoreboard fetch failed for ${dateStr}:`, e.message);
    return [];
  }
}

// ==================== NBA ROLLING STATS ====================

async function fetchNBARolling() {
  console.log('[rolling-stats] Fetching NBA recent games...');
  
  // Fetch last 21 days of games (covers 10+ games per team usually)
  const dates = getDateRange(21);
  const allGames = [];
  
  // Batch fetch — do 3 days at a time to be gentle on the API
  for (let i = 0; i < dates.length; i += 3) {
    const batch = dates.slice(i, i + 3);
    const promises = batch.map(d => fetchESPNScoreboard('basketball', 'nba', d));
    const results = await Promise.all(promises);
    for (const events of results) {
      for (const event of events) {
        const competition = event.competitions?.[0];
        if (!competition) continue;
        
        const statusType = competition.status?.type?.name;
        if (statusType !== 'STATUS_FINAL') continue;
        
        const competitors = competition.competitors || [];
        if (competitors.length !== 2) continue;
        
        const home = competitors.find(c => c.homeAway === 'home');
        const away = competitors.find(c => c.homeAway === 'away');
        if (!home || !away) continue;
        
        const homeAbbr = ESPN_NBA_ABBR_MAP[home.team.abbreviation] || home.team.abbreviation;
        const awayAbbr = ESPN_NBA_ABBR_MAP[away.team.abbreviation] || away.team.abbreviation;
        const homeScore = parseInt(home.score) || 0;
        const awayScore = parseInt(away.score) || 0;
        
        allGames.push({
          date: event.date,
          home: homeAbbr,
          away: awayAbbr,
          homeScore,
          awayScore,
          winner: homeScore > awayScore ? homeAbbr : awayAbbr
        });
      }
    }
  }
  
  // Sort by date descending (most recent first)
  allGames.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  // Calculate rolling stats per team
  const teamStats = {};
  const teamGames = {}; // track games per team
  
  // Initialize
  const allTeams = new Set();
  allGames.forEach(g => { allTeams.add(g.home); allTeams.add(g.away); });
  
  for (const team of allTeams) {
    teamGames[team] = [];
    allGames.forEach(g => {
      if (g.home === team || g.away === team) {
        const isHome = g.home === team;
        const scored = isHome ? g.homeScore : g.awayScore;
        const allowed = isHome ? g.awayScore : g.homeScore;
        const won = g.winner === team;
        teamGames[team].push({ date: g.date, scored, allowed, won, opponent: isHome ? g.away : g.home, isHome });
      }
    });
  }
  
  for (const [team, games] of Object.entries(teamGames)) {
    const l5 = games.slice(0, 5);
    const l10 = games.slice(0, 10);
    const l15 = games.slice(0, 15);
    
    const calcWindow = (window) => {
      if (window.length === 0) return null;
      const wins = window.filter(g => g.won).length;
      const losses = window.length - wins;
      const avgScored = +(window.reduce((s, g) => s + g.scored, 0) / window.length).toFixed(1);
      const avgAllowed = +(window.reduce((s, g) => s + g.allowed, 0) / window.length).toFixed(1);
      const diff = +(avgScored - avgAllowed).toFixed(1);
      const winPct = +(wins / window.length).toFixed(3);
      return { wins, losses, record: `${wins}-${losses}`, avgScored, avgAllowed, diff, winPct, games: window.length };
    };
    
    const l5Stats = calcWindow(l5);
    const l10Stats = calcWindow(l10);
    const l15Stats = calcWindow(l15);
    
    // Momentum: compare recent form (L5) vs longer form (L15)
    let momentum = 0;
    let trend = '➡️';
    if (l5Stats && l15Stats) {
      momentum = +(l5Stats.winPct - l15Stats.winPct).toFixed(3);
      if (l5Stats.winPct >= 0.8) trend = '🔥🔥';
      else if (l5Stats.winPct >= 0.6 && momentum > 0.05) trend = '🔥';
      else if (l5Stats.winPct <= 0.2) trend = '🧊🧊';
      else if (l5Stats.winPct <= 0.4 && momentum < -0.05) trend = '🧊';
      else trend = '➡️';
    }
    
    // Streak
    let streak = 0;
    let streakType = '';
    if (games.length > 0) {
      streakType = games[0].won ? 'W' : 'L';
      for (const g of games) {
        if ((g.won && streakType === 'W') || (!g.won && streakType === 'L')) {
          streak++;
        } else break;
      }
    }
    
    // Rolling offensive/defensive ratings (vs season average)
    // Positive = better than average recently
    const rollingOffRating = l10Stats ? +(l10Stats.avgScored - 112).toFixed(1) : 0; // 112 is ~league avg
    const rollingDefRating = l10Stats ? +(112 - l10Stats.avgAllowed).toFixed(1) : 0;
    
    teamStats[team] = {
      l5: l5Stats,
      l10: l10Stats,
      l15: l15Stats,
      momentum,
      trend,
      streak: `${streakType}${streak}`,
      rollingOffRating,
      rollingDefRating,
      rollingNetRating: +(rollingOffRating + rollingDefRating).toFixed(1),
      recentGames: games.slice(0, 5).map(g => ({
        opponent: g.opponent,
        scored: g.scored,
        allowed: g.allowed,
        won: g.won,
        isHome: g.isHome,
        date: g.date?.split('T')[0]
      }))
    };
  }
  
  console.log(`[rolling-stats] NBA: calculated rolling stats for ${Object.keys(teamStats).length} teams from ${allGames.length} games`);
  return teamStats;
}

// ==================== NHL ROLLING STATS ====================

async function fetchNHLRolling() {
  console.log('[rolling-stats] Fetching NHL recent games...');
  
  const fetch = require('node-fetch');
  const allGames = [];
  
  // NHL schedule API — fetch recent completed games
  // Use the scores endpoint for recent game results
  const dates = getDateRange(21);
  
  for (let i = 0; i < dates.length; i += 3) {
    const batch = dates.slice(i, i + 3);
    const promises = batch.map(async (dateStr) => {
      const isoDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      const url = `https://api-web.nhle.com/v1/score/${isoDate}`;
      try {
        const resp = await fetch(url, { timeout: 10000 });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.games || [];
      } catch (e) {
        return [];
      }
    });
    
    const results = await Promise.all(promises);
    for (const games of results) {
      for (const game of games) {
        if (game.gameState !== 'OFF' && game.gameState !== 'FINAL') continue;
        
        const homeAbbr = NHL_API_ABBR_MAP[game.homeTeam?.abbrev] || game.homeTeam?.abbrev;
        const awayAbbr = NHL_API_ABBR_MAP[game.awayTeam?.abbrev] || game.awayTeam?.abbrev;
        const homeScore = game.homeTeam?.score || 0;
        const awayScore = game.awayTeam?.score || 0;
        
        if (!homeAbbr || !awayAbbr) continue;
        
        allGames.push({
          date: game.startTimeUTC || game.gameDate,
          home: homeAbbr,
          away: awayAbbr,
          homeScore,
          awayScore,
          winner: homeScore > awayScore ? homeAbbr : awayAbbr,
          overtime: game.periodDescriptor?.periodType === 'OT' || game.periodDescriptor?.periodType === 'SO'
        });
      }
    }
  }
  
  allGames.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  const teamStats = {};
  const teamGames = {};
  const allTeams = new Set();
  allGames.forEach(g => { allTeams.add(g.home); allTeams.add(g.away); });
  
  for (const team of allTeams) {
    teamGames[team] = [];
    allGames.forEach(g => {
      if (g.home === team || g.away === team) {
        const isHome = g.home === team;
        const scored = isHome ? g.homeScore : g.awayScore;
        const allowed = isHome ? g.awayScore : g.homeScore;
        const won = g.winner === team;
        teamGames[team].push({ date: g.date, scored, allowed, won, opponent: isHome ? g.away : g.home, isHome, overtime: g.overtime });
      }
    });
  }
  
  for (const [team, games] of Object.entries(teamGames)) {
    const l5 = games.slice(0, 5);
    const l10 = games.slice(0, 10);
    
    const calcWindow = (window) => {
      if (window.length === 0) return null;
      const wins = window.filter(g => g.won).length;
      const losses = window.length - wins;
      const otLosses = window.filter(g => !g.won && g.overtime).length;
      const avgScored = +(window.reduce((s, g) => s + g.scored, 0) / window.length).toFixed(2);
      const avgAllowed = +(window.reduce((s, g) => s + g.allowed, 0) / window.length).toFixed(2);
      const diff = +(avgScored - avgAllowed).toFixed(2);
      const winPct = +(wins / window.length).toFixed(3);
      return { wins, losses, otLosses, record: `${wins}-${losses}-${otLosses}`, avgScored, avgAllowed, diff, winPct, games: window.length };
    };
    
    const l5Stats = calcWindow(l5);
    const l10Stats = calcWindow(l10);
    
    let momentum = 0;
    let trend = '➡️';
    if (l5Stats && l10Stats) {
      momentum = +(l5Stats.winPct - l10Stats.winPct).toFixed(3);
      if (l5Stats.winPct >= 0.8) trend = '🔥🔥';
      else if (l5Stats.winPct >= 0.6 && momentum > 0.05) trend = '🔥';
      else if (l5Stats.winPct <= 0.2) trend = '🧊🧊';
      else if (l5Stats.winPct <= 0.4 && momentum < -0.05) trend = '🧊';
      else trend = '➡️';
    }
    
    let streak = 0;
    let streakType = '';
    if (games.length > 0) {
      streakType = games[0].won ? 'W' : 'L';
      for (const g of games) {
        if ((g.won && streakType === 'W') || (!g.won && streakType === 'L')) streak++;
        else break;
      }
    }
    
    const rollingOffRating = l10Stats ? +(l10Stats.avgScored - 3.0).toFixed(2) : 0; // ~3.0 league avg
    const rollingDefRating = l10Stats ? +(3.0 - l10Stats.avgAllowed).toFixed(2) : 0;
    
    teamStats[team] = {
      l5: l5Stats,
      l10: l10Stats,
      momentum,
      trend,
      streak: `${streakType}${streak}`,
      rollingOffRating,
      rollingDefRating,
      rollingNetRating: +(rollingOffRating + rollingDefRating).toFixed(2),
      recentGames: games.slice(0, 5).map(g => ({
        opponent: g.opponent,
        scored: g.scored,
        allowed: g.allowed,
        won: g.won,
        isHome: g.isHome,
        date: g.date?.split('T')[0]
      }))
    };
  }
  
  console.log(`[rolling-stats] NHL: calculated rolling stats for ${Object.keys(teamStats).length} teams from ${allGames.length} games`);
  return teamStats;
}

// ==================== MLB ROLLING STATS ====================

async function fetchMLBRolling() {
  console.log('[rolling-stats] Fetching MLB recent games...');
  
  // MLB season might not be started yet — check
  const dates = getDateRange(21);
  const allGames = [];
  
  for (let i = 0; i < dates.length; i += 3) {
    const batch = dates.slice(i, i + 3);
    const promises = batch.map(d => fetchESPNScoreboard('baseball', 'mlb', d));
    const results = await Promise.all(promises);
    for (const events of results) {
      for (const event of events) {
        const competition = event.competitions?.[0];
        if (!competition) continue;
        
        const statusType = competition.status?.type?.name;
        if (statusType !== 'STATUS_FINAL') continue;
        
        const competitors = competition.competitors || [];
        if (competitors.length !== 2) continue;
        
        const home = competitors.find(c => c.homeAway === 'home');
        const away = competitors.find(c => c.homeAway === 'away');
        if (!home || !away) continue;
        
        const homeAbbr = ESPN_MLB_ABBR_MAP[home.team.abbreviation] || home.team.abbreviation;
        const awayAbbr = ESPN_MLB_ABBR_MAP[away.team.abbreviation] || away.team.abbreviation;
        const homeScore = parseInt(home.score) || 0;
        const awayScore = parseInt(away.score) || 0;
        
        allGames.push({
          date: event.date,
          home: homeAbbr,
          away: awayAbbr,
          homeScore,
          awayScore,
          winner: homeScore > awayScore ? homeAbbr : awayAbbr
        });
      }
    }
  }
  
  if (allGames.length === 0) {
    console.log('[rolling-stats] MLB: no recent games found (season may not have started)');
    return { _note: 'No MLB games available — season not started or spring training' };
  }
  
  allGames.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  const teamStats = {};
  const teamGames = {};
  const allTeams = new Set();
  allGames.forEach(g => { allTeams.add(g.home); allTeams.add(g.away); });
  
  for (const team of allTeams) {
    teamGames[team] = [];
    allGames.forEach(g => {
      if (g.home === team || g.away === team) {
        const isHome = g.home === team;
        const scored = isHome ? g.homeScore : g.awayScore;
        const allowed = isHome ? g.awayScore : g.homeScore;
        const won = g.winner === team;
        teamGames[team].push({ date: g.date, scored, allowed, won, opponent: isHome ? g.away : g.home, isHome });
      }
    });
  }
  
  for (const [team, games] of Object.entries(teamGames)) {
    const l5 = games.slice(0, 5);
    const l10 = games.slice(0, 10);
    
    const calcWindow = (window) => {
      if (window.length === 0) return null;
      const wins = window.filter(g => g.won).length;
      const losses = window.length - wins;
      const avgScored = +(window.reduce((s, g) => s + g.scored, 0) / window.length).toFixed(2);
      const avgAllowed = +(window.reduce((s, g) => s + g.allowed, 0) / window.length).toFixed(2);
      const diff = +(avgScored - avgAllowed).toFixed(2);
      const winPct = +(wins / window.length).toFixed(3);
      return { wins, losses, record: `${wins}-${losses}`, avgScored, avgAllowed, diff, winPct, games: window.length };
    };
    
    const l5Stats = calcWindow(l5);
    const l10Stats = calcWindow(l10);
    
    let momentum = 0;
    let trend = '➡️';
    if (l5Stats && l10Stats) {
      momentum = +(l5Stats.winPct - l10Stats.winPct).toFixed(3);
      if (l5Stats.winPct >= 0.8) trend = '🔥🔥';
      else if (l5Stats.winPct >= 0.6 && momentum > 0.05) trend = '🔥';
      else if (l5Stats.winPct <= 0.2) trend = '🧊🧊';
      else if (l5Stats.winPct <= 0.4 && momentum < -0.05) trend = '🧊';
      else trend = '➡️';
    }
    
    let streak = 0;
    let streakType = '';
    if (games.length > 0) {
      streakType = games[0].won ? 'W' : 'L';
      for (const g of games) {
        if ((g.won && streakType === 'W') || (!g.won && streakType === 'L')) streak++;
        else break;
      }
    }
    
    const rollingOffRating = l10Stats ? +(l10Stats.avgScored - 4.5).toFixed(2) : 0; // ~4.5 league avg
    const rollingDefRating = l10Stats ? +(4.5 - l10Stats.avgAllowed).toFixed(2) : 0;
    
    teamStats[team] = {
      l5: l5Stats,
      l10: l10Stats,
      momentum,
      trend,
      streak: `${streakType}${streak}`,
      rollingOffRating,
      rollingDefRating,
      rollingNetRating: +(rollingOffRating + rollingDefRating).toFixed(2),
      recentGames: games.slice(0, 5).map(g => ({
        opponent: g.opponent,
        scored: g.scored,
        allowed: g.allowed,
        won: g.won,
        isHome: g.isHome,
        date: g.date?.split('T')[0]
      }))
    };
  }
  
  console.log(`[rolling-stats] MLB: calculated rolling stats for ${Object.keys(teamStats).length} teams from ${allGames.length} games`);
  return teamStats;
}

// ==================== MAIN REFRESH ====================

async function refreshAll(forceRefresh = false) {
  const cache = loadCache();
  const results = {
    nba: { status: 'skipped' },
    nhl: { status: 'skipped' },
    mlb: { status: 'skipped' }
  };
  
  // NBA
  if (forceRefresh || !isCacheFresh('nba', cache)) {
    try {
      cache.nba = await fetchNBARolling();
      cache.timestamps.nba = Date.now();
      results.nba = { status: 'refreshed', teams: Object.keys(cache.nba).length };
    } catch (e) {
      console.error('[rolling-stats] NBA refresh failed:', e.message);
      results.nba = { status: 'error', error: e.message };
    }
  } else {
    results.nba = { status: 'cached', teams: Object.keys(cache.nba || {}).length };
  }
  
  // NHL
  if (forceRefresh || !isCacheFresh('nhl', cache)) {
    try {
      cache.nhl = await fetchNHLRolling();
      cache.timestamps.nhl = Date.now();
      results.nhl = { status: 'refreshed', teams: Object.keys(cache.nhl).length };
    } catch (e) {
      console.error('[rolling-stats] NHL refresh failed:', e.message);
      results.nhl = { status: 'error', error: e.message };
    }
  } else {
    results.nhl = { status: 'cached', teams: Object.keys(cache.nhl || {}).length };
  }
  
  // MLB
  if (forceRefresh || !isCacheFresh('mlb', cache)) {
    try {
      cache.mlb = await fetchMLBRolling();
      cache.timestamps.mlb = Date.now();
      const teams = cache.mlb._note ? 0 : Object.keys(cache.mlb).length;
      results.mlb = { status: teams > 0 ? 'refreshed' : 'no-data', teams, note: cache.mlb._note };
    } catch (e) {
      console.error('[rolling-stats] MLB refresh failed:', e.message);
      results.mlb = { status: 'error', error: e.message };
    }
  } else {
    const teams = cache.mlb?._note ? 0 : Object.keys(cache.mlb || {}).length;
    results.mlb = { status: 'cached', teams };
  }
  
  saveCache(cache);
  return results;
}

// ==================== DATA GETTERS ====================

function getNBARolling() {
  const cache = loadCache();
  return cache.nba || null;
}

function getNHLRolling() {
  const cache = loadCache();
  return cache.nhl || null;
}

function getMLBRolling() {
  const cache = loadCache();
  if (cache.mlb?._note) return null;
  return cache.mlb || null;
}

function getTeamRolling(sport, team) {
  const cache = loadCache();
  const sportData = cache[sport.toLowerCase()];
  if (!sportData || sportData._note) return null;
  return sportData[team.toUpperCase()] || null;
}

/**
 * Get rolling adjustment factor for a team.
 * Returns a multiplier to blend with season-long power rating.
 * 
 * @param {string} sport - 'nba', 'nhl', 'mlb'
 * @param {string} team - team abbreviation
 * @returns {object} { adjFactor, confidence, trend }
 *   adjFactor: points/goals to add to power rating based on recent form
 *   confidence: how many games the rolling window is based on
 *   trend: emoji indicator
 */
function getRollingAdjustment(sport, team) {
  const rolling = getTeamRolling(sport, team);
  if (!rolling || !rolling.l10) {
    return { adjFactor: 0, confidence: 0, trend: '➡️' };
  }
  
  const l10 = rolling.l10;
  const ROLLING_WEIGHT = 0.35; // how much recent form affects the model
  
  let adjFactor;
  if (sport === 'nba') {
    // NBA: adjust in points. L10 diff vs league avg (0) weighted
    adjFactor = +(rolling.rollingNetRating * ROLLING_WEIGHT).toFixed(2);
  } else if (sport === 'nhl') {
    // NHL: adjust in goals
    adjFactor = +(rolling.rollingNetRating * ROLLING_WEIGHT * 2).toFixed(2); // scale up since goals are fewer
  } else if (sport === 'mlb') {
    // MLB: adjust in runs
    adjFactor = +(rolling.rollingNetRating * ROLLING_WEIGHT * 1.5).toFixed(2);
  } else {
    adjFactor = 0;
  }
  
  // Cap the adjustment so rolling stats don't overwhelm the model
  const maxAdj = sport === 'nba' ? 3.0 : sport === 'nhl' ? 0.5 : 0.8;
  adjFactor = Math.max(-maxAdj, Math.min(maxAdj, adjFactor));
  
  return {
    adjFactor,
    confidence: l10.games,
    trend: rolling.trend,
    streak: rolling.streak,
    momentum: rolling.momentum,
    l5Record: rolling.l5?.record,
    l10Record: rolling.l10?.record
  };
}

function getStatus() {
  const cache = loadCache();
  const now = Date.now();
  const sportStatus = (sport) => ({
    hasData: !!cache[sport] && !cache[sport]?._note && Object.keys(cache[sport] || {}).length > 0,
    teams: cache[sport]?._note ? 0 : Object.keys(cache[sport] || {}).length,
    lastRefresh: cache.timestamps?.[sport] ? new Date(cache.timestamps[sport]).toISOString() : null,
    ageMinutes: cache.timestamps?.[sport] ? Math.round((now - cache.timestamps[sport]) / 60000) : null,
    isFresh: isCacheFresh(sport, cache)
  });
  
  return {
    nba: sportStatus('nba'),
    nhl: sportStatus('nhl'),
    mlb: sportStatus('mlb')
  };
}

module.exports = {
  refreshAll,
  getNBARolling,
  getNHLRolling,
  getMLBRolling,
  getTeamRolling,
  getRollingAdjustment,
  getStatus,
  CACHE_TTL
};
