/**
 * Dynamic Player Stats — SportsSim v12.0
 * 
 * Fetches live player season averages from ESPN APIs for NBA, MLB, NHL.
 * Provides real-time data for the player props engine instead of static baselines.
 * 
 * ESPN Endpoints:
 *   NBA: site.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete
 *   MLB: site.api.espn.com/apis/common/v3/sports/baseball/mlb/statistics/byathlete  
 *   NHL: site.api.espn.com/apis/common/v3/sports/hockey/nhl/statistics/byathlete
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'player-stats-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 min

let playerCache = { nba: null, mlb: null, nhl: null, ts: 0 };

// ==================== ESPN PLAYER FETCHING ====================

/**
 * Fetch NBA player leaders from ESPN
 */
async function fetchNBAPlayerStats() {
  try {
    const fetch = require('node-fetch');
    
    // Fetch scoring leaders (gives us top players)
    const categories = ['scoringPerGame', 'reboundsPerGame', 'assistsPerGame', 'threePointFieldGoalsMade'];
    const players = {};
    
    for (const cat of categories) {
      try {
        const url = `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?category=${cat}&limit=50`;
        const resp = await fetch(url, { timeout: 8000 });
        if (!resp.ok) continue;
        const data = await resp.json();
        
        if (data.athletes) {
          for (const athlete of data.athletes) {
            const name = athlete.athlete?.displayName;
            const team = athlete.athlete?.team?.abbreviation;
            if (!name || !team) continue;
            
            if (!players[name]) {
              players[name] = { name, team, source: 'espn-live' };
            }
            
            // Parse stats from categories
            if (athlete.categories) {
              for (const statCat of athlete.categories) {
                const statName = statCat.name;
                const value = parseFloat(statCat.displayValue);
                if (!isNaN(value)) {
                  // Map ESPN stat names to our format
                  const mapping = {
                    'avgPoints': 'points', 'pointsPerGame': 'points', 'scoringPerGame': 'points',
                    'avgRebounds': 'rebounds', 'reboundsPerGame': 'rebounds',
                    'avgAssists': 'assists', 'assistsPerGame': 'assists',
                    'avgSteals': 'steals', 'stealsPerGame': 'steals',
                    'avgBlocks': 'blocks', 'blocksPerGame': 'blocks',
                    'avgTurnovers': 'turnovers', 'turnoversPerGame': 'turnovers',
                    'threePointFieldGoalsMadePerGame': 'threes', 'threePointFieldGoalsMade': 'threes',
                  };
                  const key = mapping[statName] || statName;
                  players[name][key] = value;
                }
              }
            }

            // Also try stats directly on athlete object
            if (athlete.stats) {
              for (const stat of athlete.stats) {
                if (stat.name && stat.displayValue) {
                  const val = parseFloat(stat.displayValue);
                  if (!isNaN(val)) {
                    players[name][stat.name] = val;
                  }
                }
              }
            }
          }
        }
      } catch (e) { /* skip category */ }
    }
    
    // Also try the simpler leaders endpoint
    try {
      const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/leaders?limit=50';
      const resp = await fetch(url, { timeout: 8000 });
      if (resp.ok) {
        const data = await resp.json();
        if (data.leaders) {
          for (const category of data.leaders) {
            const catName = category.name; // e.g. 'avgPoints'
            for (const leader of (category.leaders || [])) {
              const name = leader.athlete?.displayName;
              const team = leader.athlete?.team?.abbreviation;
              if (!name) continue;
              
              if (!players[name]) {
                players[name] = { name, team, source: 'espn-live' };
              }
              if (team) players[name].team = team;
              
              const val = parseFloat(leader.displayValue);
              if (!isNaN(val)) {
                // Map to our format
                if (catName.includes('Point') || catName.includes('scoring')) players[name].points = val;
                else if (catName.includes('Rebound')) players[name].rebounds = val;
                else if (catName.includes('Assist')) players[name].assists = val;
                else if (catName.includes('Steal')) players[name].steals = val;
                else if (catName.includes('Block')) players[name].blocks = val;
                else if (catName.includes('Three') || catName.includes('3P')) players[name].threes = val;
                else if (catName.includes('Turnover')) players[name].turnovers = val;
              }
            }
          }
        }
      }
    } catch (e) { /* fallback */ }
    
    return players;
  } catch (e) {
    console.error('Failed to fetch NBA player stats:', e.message);
    return {};
  }
}

/**
 * Fetch MLB pitcher/batter stats from ESPN
 */
async function fetchMLBPlayerStats() {
  try {
    const fetch = require('node-fetch');
    const players = {};
    
    // Pitching leaders
    try {
      const url = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/leaders?limit=40';
      const resp = await fetch(url, { timeout: 8000 });
      if (resp.ok) {
        const data = await resp.json();
        if (data.leaders) {
          for (const category of data.leaders) {
            const catName = category.name;
            for (const leader of (category.leaders || [])) {
              const name = leader.athlete?.displayName;
              const team = leader.athlete?.team?.abbreviation;
              const pos = leader.athlete?.position?.abbreviation;
              if (!name) continue;
              
              if (!players[name]) {
                players[name] = { name, team, position: pos, source: 'espn-live' };
              }
              if (team) players[name].team = team;
              
              const val = parseFloat(leader.displayValue);
              if (!isNaN(val)) {
                if (catName.includes('strikeout') || catName.includes('Strikeout')) players[name].strikeouts = val;
                else if (catName.includes('ERA') || catName.includes('era')) players[name].era = val;
                else if (catName.includes('wins') || catName.includes('Wins')) players[name].wins = val;
                else if (catName.includes('homeRun')) players[name].home_runs = val;
                else if (catName.includes('RBI') || catName.includes('rbi')) players[name].rbis = val;
                else if (catName.includes('battingAverage') || catName.includes('AVG')) players[name].avg = val;
                else if (catName.includes('OPS') || catName.includes('ops')) players[name].ops = val;
                else if (catName.includes('hits') || catName.includes('Hits')) players[name].hits = val;
                else if (catName.includes('stolenBases')) players[name].stolen_bases = val;
                else if (catName.includes('runs') || catName.includes('Runs')) players[name].runs = val;
              }
            }
          }
        }
      }
    } catch (e) { /* skip */ }
    
    return players;
  } catch (e) {
    console.error('Failed to fetch MLB player stats:', e.message);
    return {};
  }
}

/**
 * Fetch NHL player stats from ESPN
 */
async function fetchNHLPlayerStats() {
  try {
    const fetch = require('node-fetch');
    const players = {};
    
    try {
      const url = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/leaders?limit=50';
      const resp = await fetch(url, { timeout: 8000 });
      if (resp.ok) {
        const data = await resp.json();
        if (data.leaders) {
          for (const category of data.leaders) {
            const catName = category.name;
            for (const leader of (category.leaders || [])) {
              const name = leader.athlete?.displayName;
              const team = leader.athlete?.team?.abbreviation;
              if (!name) continue;
              
              if (!players[name]) {
                players[name] = { name, team, source: 'espn-live' };
              }
              if (team) players[name].team = team;
              
              const val = parseFloat(leader.displayValue);
              if (!isNaN(val)) {
                if (catName.includes('point') || catName.includes('Point')) players[name].points = val;
                else if (catName.includes('goal') || catName.includes('Goal')) players[name].goals = val;
                else if (catName.includes('assist') || catName.includes('Assist')) players[name].assists = val;
                else if (catName.includes('save')) players[name].saves = val;
                else if (catName.includes('win')) players[name].wins = val;
              }
            }
          }
        }
      }
    } catch (e) { /* skip */ }
    
    return players;
  } catch (e) {
    console.error('Failed to fetch NHL player stats:', e.message);
    return {};
  }
}

// ==================== CACHE ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (raw.ts && (Date.now() - raw.ts) < CACHE_TTL) {
        playerCache = raw;
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(playerCache, null, 2));
  } catch (e) { /* ignore */ }
}

// ==================== PUBLIC API ====================

async function getPlayerStats(sport) {
  // Check cache
  if (playerCache[sport] && (Date.now() - playerCache.ts) < CACHE_TTL) {
    return { ...playerCache[sport], cached: true };
  }
  
  let stats = {};
  if (sport === 'nba') stats = await fetchNBAPlayerStats();
  else if (sport === 'mlb') stats = await fetchMLBPlayerStats();
  else if (sport === 'nhl') stats = await fetchNHLPlayerStats();
  
  playerCache[sport] = stats;
  playerCache.ts = Date.now();
  saveCache();
  
  return stats;
}

async function refreshAll() {
  const results = {};
  const [nba, mlb, nhl] = await Promise.all([
    fetchNBAPlayerStats(),
    fetchMLBPlayerStats(),
    fetchNHLPlayerStats(),
  ]);
  
  playerCache.nba = nba;
  playerCache.mlb = mlb;
  playerCache.nhl = nhl;
  playerCache.ts = Date.now();
  saveCache();
  
  return {
    nba: Object.keys(nba).length,
    mlb: Object.keys(mlb).length,
    nhl: Object.keys(nhl).length,
  };
}

function getStatus() {
  return {
    service: 'player-stats',
    version: '1.0',
    cacheAge: playerCache.ts ? Math.round((Date.now() - playerCache.ts) / 1000) + 's' : null,
    nbaPlayers: playerCache.nba ? Object.keys(playerCache.nba).length : 0,
    mlbPlayers: playerCache.mlb ? Object.keys(playerCache.mlb).length : 0,
    nhlPlayers: playerCache.nhl ? Object.keys(playerCache.nhl).length : 0,
  };
}

// Load cache on start
loadCache();

module.exports = {
  getPlayerStats,
  refreshAll,
  fetchNBAPlayerStats,
  fetchMLBPlayerStats,
  fetchNHLPlayerStats,
  getStatus,
};
