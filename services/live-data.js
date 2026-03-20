/**
 * SportsSim Live Data Service
 * 
 * Fetches real-time stats from:
 *   - ESPN API for NBA standings + stats
 *   - NHL Official API for standings + goals
 *   - MLB Stats API + ESPN for MLB (when season starts)
 * 
 * Cache: stores in data-cache.json, refreshes every 30 min
 * Fallback: if any API fails, static model data is preserved
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'data-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ==================== ESPN ABBREVIATION MAPPINGS ====================
// ESPN uses non-standard abbreviations for some teams

const ESPN_NBA_ABBR_MAP = {
  // ESPN → Our model
  'NY': 'NYK',
  'GS': 'GSW',
  'SA': 'SAS',
  'NO': 'NOP',
  'UTAH': 'UTA',
  'WSH': 'WAS',
  // These match already:
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BKN', 'CHA': 'CHA', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'HOU': 'HOU',
  'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM', 'MIA': 'MIA',
  'MIL': 'MIL', 'MIN': 'MIN', 'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI',
  'PHX': 'PHX', 'POR': 'POR', 'SAC': 'SAC', 'TOR': 'TOR'
};

const NHL_API_ABBR_MAP = {
  // NHL API → Our model
  'UTA': 'ARI', // Utah Hockey Club — our model uses ARI
  // The rest match:
  'ANA': 'ANA', 'BOS': 'BOS', 'BUF': 'BUF', 'CGY': 'CGY', 'CAR': 'CAR',
  'CHI': 'CHI', 'COL': 'COL', 'CBJ': 'CBJ', 'DAL': 'DAL', 'DET': 'DET',
  'EDM': 'EDM', 'FLA': 'FLA', 'LAK': 'LAK', 'MIN': 'MIN', 'MTL': 'MTL',
  'NSH': 'NSH', 'NJD': 'NJD', 'NYI': 'NYI', 'NYR': 'NYR', 'OTT': 'OTT',
  'PHI': 'PHI', 'PIT': 'PIT', 'SJS': 'SJS', 'SEA': 'SEA', 'STL': 'STL',
  'TBL': 'TBL', 'TOR': 'TOR', 'VAN': 'VAN', 'VGK': 'VGK', 'WSH': 'WSH',
  'WPG': 'WPG'
};

const ESPN_MLB_ABBR_MAP = {
  // ESPN uses some different abbreviations
  'WSH': 'WSH', 'CWS': 'CWS',
  'ATL': 'ATL', 'ARI': 'ARI', 'BAL': 'BAL', 'BOS': 'BOS', 'CHC': 'CHC',
  'CIN': 'CIN', 'CLE': 'CLE', 'COL': 'COL', 'DET': 'DET', 'HOU': 'HOU',
  'KC': 'KC', 'LAA': 'LAA', 'LAD': 'LAD', 'MIA': 'MIA', 'MIL': 'MIL',
  'MIN': 'MIN', 'NYM': 'NYM', 'NYY': 'NYY', 'OAK': 'OAK', 'PHI': 'PHI',
  'PIT': 'PIT', 'SD': 'SD', 'SF': 'SF', 'SEA': 'SEA', 'STL': 'STL',
  'TB': 'TB', 'TEX': 'TEX', 'TOR': 'TOR'
};

// ==================== CACHE MANAGEMENT ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[live-data] Cache read error:', e.message);
  }
  return { nba: null, nhl: null, mlb: null, timestamps: {} };
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[live-data] Cache write error:', e.message);
  }
}

function isCacheFresh(sport, cache) {
  const ts = cache?.timestamps?.[sport];
  if (!ts) return false;
  return (Date.now() - ts) < CACHE_TTL;
}

// ==================== NBA DATA FETCH ====================

async function fetchNBA() {
  const fetch = require('node-fetch');
  const url = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
  
  console.log('[live-data] Fetching NBA standings from ESPN...');
  const resp = await fetch(url, { timeout: 10000 });
  if (!resp.ok) throw new Error(`ESPN NBA API returned ${resp.status}`);
  
  const data = await resp.json();
  const teams = {};
  
  for (const conf of data.children || []) {
    for (const entry of conf.standings?.entries || []) {
      const espnAbbr = entry.team.abbreviation;
      const ourAbbr = ESPN_NBA_ABBR_MAP[espnAbbr] || espnAbbr;
      
      // Build stats map
      const stats = {};
      for (const s of entry.stats || []) {
        stats[s.name] = s;
      }
      
      const w = stats.wins?.value || 0;
      const l = stats.losses?.value || 0;
      const ppg = stats.avgPointsFor?.value || 0;
      const oppg = stats.avgPointsAgainst?.value || 0;
      const diff = stats.differential?.value || 0;
      const l10Display = stats['Last Ten Games']?.displayValue || '5-5';
      
      teams[ourAbbr] = {
        name: entry.team.displayName,
        w: Math.round(w),
        l: Math.round(l),
        ppg: +ppg.toFixed(1),
        oppg: +oppg.toFixed(1),
        diff: +diff.toFixed(1),
        l10: l10Display,
        source: 'espn-live'
      };
    }
  }
  
  console.log(`[live-data] NBA: fetched ${Object.keys(teams).length} teams`);
  return teams;
}

// ==================== NHL DATA FETCH ====================

async function fetchNHL() {
  const fetch = require('node-fetch');
  const today = new Date().toISOString().split('T')[0];
  const url = `https://api-web.nhle.com/v1/standings/${today}`;
  
  console.log('[live-data] Fetching NHL standings from NHL API...');
  const resp = await fetch(url, { timeout: 10000 });
  if (!resp.ok) throw new Error(`NHL API returned ${resp.status}`);
  
  const data = await resp.json();
  const teams = {};
  
  for (const t of data.standings || []) {
    const apiAbbr = t.teamAbbrev?.default;
    if (!apiAbbr) continue;
    const ourAbbr = NHL_API_ABBR_MAP[apiAbbr] || apiAbbr;
    
    const gp = t.gamesPlayed || 1;
    const gfPerGame = +(t.goalFor / gp).toFixed(2);
    const gaPerGame = +(t.goalAgainst / gp).toFixed(2);
    
    teams[ourAbbr] = {
      name: t.teamName?.default || apiAbbr,
      w: t.wins || 0,
      l: t.losses || 0,
      otl: t.otLosses || 0,
      gf: gfPerGame,
      ga: gaPerGame,
      gfTotal: t.goalFor || 0,
      gaTotal: t.goalAgainst || 0,
      gp: gp,
      l10w: t.l10Wins || 0,
      l10l: t.l10Losses || 0,
      l10otl: t.l10OtLosses || 0,
      points: t.points || 0,
      pointPctg: t.pointPctg || 0,
      streak: (t.streakCode || '') + (t.streakCount || ''),
      regulationWins: t.regulationWins || 0,
      source: 'nhl-api-live'
    };
  }
  
  console.log(`[live-data] NHL: fetched ${Object.keys(teams).length} teams`);
  return teams;
}

// ==================== MLB DATA FETCH ====================

async function fetchMLB() {
  const fetch = require('node-fetch');
  
  // Try MLB official API first for regular season standings
  console.log('[live-data] Fetching MLB standings...');
  
  let teams = {};
  let source = 'static';
  
  // Try ESPN for spring training / regular season data
  try {
    const espnUrl = 'https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings';
    const resp = await fetch(espnUrl, { timeout: 10000 });
    if (resp.ok) {
      const data = await resp.json();
      for (const div of data.children || []) {
        for (const entry of div.standings?.entries || []) {
          const espnAbbr = entry.team.abbreviation;
          const ourAbbr = ESPN_MLB_ABBR_MAP[espnAbbr] || espnAbbr;
          
          const stats = {};
          for (const s of entry.stats || []) {
            stats[s.name] = s;
          }
          
          const gp = stats.gamesPlayed?.value || 0;
          
          // Only use if actual games have been played (spring training or regular season)
          if (gp > 0) {
            const w = stats.wins?.value || 0;
            const l = stats.losses?.value || 0;
            const rsG = stats.avgPointsFor?.value || 0;
            const raG = stats.avgPointsAgainst?.value || 0;
            
            teams[ourAbbr] = {
              name: entry.team.displayName,
              w: Math.round(w),
              l: Math.round(l),
              gp: Math.round(gp),
              rsG: +rsG.toFixed(2),
              raG: +raG.toFixed(2),
              diff: +(rsG - raG).toFixed(2),
              isSpringTraining: gp < 50, // Flag if spring training data
              source: 'espn-live'
            };
          }
        }
      }
      if (Object.keys(teams).length > 0) {
        source = 'espn-live';
      }
    }
  } catch (e) {
    console.error('[live-data] ESPN MLB fetch error:', e.message);
  }
  
  // Also try MLB official API
  try {
    const mlbUrl = 'https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026';
    const resp = await fetch(mlbUrl, { timeout: 10000 });
    if (resp.ok) {
      const data = await resp.json();
      for (const record of data.records || []) {
        for (const team of record.teamRecords || []) {
          const gp = team.gamesPlayed || 0;
          if (gp > 0) {
            const mlbId = team.team?.id;
            const name = team.team?.name;
            const abbr = MLB_ID_TO_ABBR[mlbId] || name;
            
            if (abbr && teams[abbr]) {
              // Supplement existing ESPN data with MLB official data
              const lastTen = team.records?.splitRecords?.find(r => r.type === 'lastTen');
              if (lastTen) {
                teams[abbr].l10 = `${lastTen.wins}-${lastTen.losses}`;
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[live-data] MLB API fetch error:', e.message);
  }
  
  console.log(`[live-data] MLB: fetched ${Object.keys(teams).length} teams (source: ${source})`);
  return { teams, source };
}

// MLB team ID → abbreviation mapping
const MLB_ID_TO_ABBR = {
  109: 'ARI', 144: 'ATL', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  145: 'CWS', 113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET',
  117: 'HOU', 118: 'KC', 108: 'LAA', 119: 'LAD', 146: 'MIA',
  158: 'MIL', 142: 'MIN', 121: 'NYM', 147: 'NYY', 133: 'OAK',
  143: 'PHI', 134: 'PIT', 135: 'SD', 137: 'SF', 136: 'SEA',
  138: 'STL', 139: 'TB', 140: 'TEX', 141: 'TOR', 120: 'WSH'
};

// ==================== MAIN REFRESH ====================

async function refreshAll(forceRefresh = false) {
  const cache = loadCache();
  const results = {
    nba: { status: 'skipped', source: 'cache' },
    nhl: { status: 'skipped', source: 'cache' },
    mlb: { status: 'skipped', source: 'cache' }
  };
  
  // NBA
  if (forceRefresh || !isCacheFresh('nba', cache)) {
    try {
      cache.nba = await fetchNBA();
      cache.timestamps.nba = Date.now();
      results.nba = { status: 'refreshed', teams: Object.keys(cache.nba).length, source: 'espn-live' };
    } catch (e) {
      console.error('[live-data] NBA refresh failed:', e.message);
      results.nba = { status: 'error', error: e.message, source: cache.nba ? 'stale-cache' : 'static' };
    }
  } else {
    results.nba = { status: 'cached', teams: Object.keys(cache.nba || {}).length, ageMin: Math.round((Date.now() - cache.timestamps.nba) / 60000) };
  }
  
  // NHL
  if (forceRefresh || !isCacheFresh('nhl', cache)) {
    try {
      cache.nhl = await fetchNHL();
      cache.timestamps.nhl = Date.now();
      results.nhl = { status: 'refreshed', teams: Object.keys(cache.nhl).length, source: 'nhl-api-live' };
    } catch (e) {
      console.error('[live-data] NHL refresh failed:', e.message);
      results.nhl = { status: 'error', error: e.message, source: cache.nhl ? 'stale-cache' : 'static' };
    }
  } else {
    results.nhl = { status: 'cached', teams: Object.keys(cache.nhl || {}).length, ageMin: Math.round((Date.now() - cache.timestamps.nhl) / 60000) };
  }
  
  // MLB
  if (forceRefresh || !isCacheFresh('mlb', cache)) {
    try {
      const mlbResult = await fetchMLB();
      if (Object.keys(mlbResult.teams).length > 0) {
        cache.mlb = mlbResult.teams;
        cache.timestamps.mlb = Date.now();
        results.mlb = { 
          status: 'refreshed', 
          teams: Object.keys(mlbResult.teams).length, 
          source: mlbResult.source,
          isSpringTraining: Object.values(mlbResult.teams).some(t => t.isSpringTraining)
        };
      } else {
        results.mlb = { status: 'no-data', source: 'static', note: 'Season not started yet' };
      }
    } catch (e) {
      console.error('[live-data] MLB refresh failed:', e.message);
      results.mlb = { status: 'error', error: e.message, source: cache.mlb ? 'stale-cache' : 'static' };
    }
  } else {
    results.mlb = { status: 'cached', teams: Object.keys(cache.mlb || {}).length, ageMin: Math.round((Date.now() - cache.timestamps.mlb) / 60000) };
  }
  
  saveCache(cache);
  return results;
}

// ==================== DATA GETTERS ====================

function getNBAData() {
  const cache = loadCache();
  return cache.nba || null;
}

function getNHLData() {
  const cache = loadCache();
  return cache.nhl || null;
}

function getMLBData() {
  const cache = loadCache();
  return cache.mlb || null;
}

function getDataStatus() {
  const cache = loadCache();
  const now = Date.now();
  
  return {
    nba: {
      hasLiveData: !!cache.nba && Object.keys(cache.nba).length > 0,
      teams: Object.keys(cache.nba || {}).length,
      lastRefresh: cache.timestamps?.nba ? new Date(cache.timestamps.nba).toISOString() : null,
      ageMinutes: cache.timestamps?.nba ? Math.round((now - cache.timestamps.nba) / 60000) : null,
      isFresh: isCacheFresh('nba', cache),
      source: cache.nba ? 'espn-live' : 'static'
    },
    nhl: {
      hasLiveData: !!cache.nhl && Object.keys(cache.nhl).length > 0,
      teams: Object.keys(cache.nhl || {}).length,
      lastRefresh: cache.timestamps?.nhl ? new Date(cache.timestamps.nhl).toISOString() : null,
      ageMinutes: cache.timestamps?.nhl ? Math.round((now - cache.timestamps.nhl) / 60000) : null,
      isFresh: isCacheFresh('nhl', cache),
      source: cache.nhl ? 'nhl-api-live' : 'static'
    },
    mlb: {
      hasLiveData: !!cache.mlb && Object.keys(cache.mlb).length > 0,
      teams: Object.keys(cache.mlb || {}).length,
      lastRefresh: cache.timestamps?.mlb ? new Date(cache.timestamps.mlb).toISOString() : null,
      ageMinutes: cache.timestamps?.mlb ? Math.round((now - cache.timestamps.mlb) / 60000) : null,
      isFresh: isCacheFresh('mlb', cache),
      source: cache.mlb ? 'espn-live' : 'static',
      isSpringTraining: cache.mlb ? Object.values(cache.mlb).some(t => t.isSpringTraining) : null
    }
  };
}

module.exports = {
  refreshAll,
  getNBAData,
  getNHLData,
  getMLBData,
  getDataStatus,
  CACHE_TTL
};
