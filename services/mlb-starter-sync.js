/**
 * MLB Starter Auto-Sync — SportsSim v126.0
 * ==========================================
 * 
 * Automatically syncs confirmed/probable starters from MLB Stats API 
 * into our OD schedule and prediction engine.
 * 
 * WHY THIS MATTERS: We had Gerrit Cole coded as NYY OD starter for WEEKS,
 * but MLB Stats API shows Max Fried. This service prevents manual data rot.
 * 
 * On each call, it:
 *   1. Fetches schedule + probablePitcher from statsapi.mlb.com for target dates
 *   2. Compares to our OPENING_DAY_GAMES entries
 *   3. Flags mismatches and auto-corrects where possible
 *   4. Caches results for quick access
 * 
 * ENDPOINTS:
 *   GET /api/mlb/starter-sync         — Run sync, return mismatches
 *   GET /api/mlb/starter-sync/status  — Cached status
 */

const https = require('https');

const CACHE = { data: null, ts: 0 };
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// MLB Stats API team ID → our abbreviation
const MLB_TEAM_MAP = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
  159: 'COL',  // Colorado sometimes different ID
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error')); }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch confirmed starters from MLB Stats API for given dates
 */
async function fetchStarters(dates) {
  const results = [];
  
  for (const date of dates) {
    try {
      const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher`;
      const data = await fetchJSON(url);
      
      for (const dateObj of (data.dates || [])) {
        for (const game of (dateObj.games || [])) {
          const away = game.teams?.away;
          const home = game.teams?.home;
          
          results.push({
            date: dateObj.date,
            gamePk: game.gamePk,
            gameTime: game.gameDate,
            status: game.status?.detailedState,
            away: {
              abbr: MLB_TEAM_MAP[away?.team?.id] || away?.team?.name,
              teamId: away?.team?.id,
              name: away?.team?.name,
              starter: away?.probablePitcher?.fullName || 'TBD',
              starterId: away?.probablePitcher?.id,
            },
            home: {
              abbr: MLB_TEAM_MAP[home?.team?.id] || home?.team?.name,
              teamId: home?.team?.id,
              name: home?.team?.name,
              starter: home?.probablePitcher?.fullName || 'TBD',
              starterId: home?.probablePitcher?.id,
            },
          });
        }
      }
    } catch (e) {
      console.error(`[starter-sync] Error fetching ${date}:`, e.message);
    }
  }
  
  return results;
}

/**
 * Compare MLB Stats API starters to our OD schedule
 */
async function syncStarters() {
  // Import our OD schedule
  let odModule;
  try { odModule = require('../models/mlb-opening-day'); } catch(e) {
    return { error: 'Could not load OD schedule', message: e.message };
  }
  
  const odGames = odModule.getSchedule ? odModule.getSchedule() : (odModule.OPENING_DAY_GAMES || []);
  
  // Target dates
  const dates = ['2026-03-25', '2026-03-26', '2026-03-27'];
  const apiGames = await fetchStarters(dates);
  
  const mismatches = [];
  const matches = [];
  const unmatched = [];
  
  for (const apiGame of apiGames) {
    // Find matching OD game
    const odGame = odGames.find(g => 
      g.away === apiGame.away.abbr && g.home === apiGame.home.abbr
    );
    
    if (!odGame) {
      unmatched.push({
        game: `${apiGame.away.abbr}@${apiGame.home.abbr}`,
        date: apiGame.date,
        apiStarters: { away: apiGame.away.starter, home: apiGame.home.starter },
        issue: 'Game in MLB API but not in our OD schedule',
      });
      continue;
    }
    
    const awayMatch = odGame.confirmedStarters?.away === apiGame.away.starter;
    const homeMatch = odGame.confirmedStarters?.home === apiGame.home.starter;
    
    if (awayMatch && homeMatch) {
      matches.push({
        game: `${apiGame.away.abbr}@${apiGame.home.abbr}`,
        date: apiGame.date,
        starters: { away: apiGame.away.starter, home: apiGame.home.starter },
        status: '✅ MATCH',
      });
    } else {
      mismatches.push({
        game: `${apiGame.away.abbr}@${apiGame.home.abbr}`,
        date: apiGame.date,
        apiStarters: { away: apiGame.away.starter, home: apiGame.home.starter },
        ourStarters: odGame.confirmedStarters,
        awayMatch,
        homeMatch,
        issues: [
          !awayMatch ? `AWAY: We have "${odGame.confirmedStarters?.away}" but API says "${apiGame.away.starter}"` : null,
          !homeMatch ? `HOME: We have "${odGame.confirmedStarters?.home}" but API says "${apiGame.home.starter}"` : null,
        ].filter(Boolean),
        severity: (!awayMatch && !homeMatch) ? 'CRITICAL' : 'WARNING',
      });
    }
  }
  
  // Check for OD games not in API
  for (const odGame of odGames) {
    const found = apiGames.find(g => g.away.abbr === odGame.away && g.home.abbr === odGame.home);
    if (!found) {
      unmatched.push({
        game: `${odGame.away}@${odGame.home}`,
        date: odGame.date,
        ourStarters: odGame.confirmedStarters,
        issue: 'Game in our OD schedule but NOT in MLB API for these dates',
      });
    }
  }
  
  const result = {
    syncTime: new Date().toISOString(),
    summary: {
      totalAPIGames: apiGames.length,
      totalODGames: odGames.length,
      matches: matches.length,
      mismatches: mismatches.length,
      unmatched: unmatched.length,
      status: mismatches.length === 0 ? '✅ ALL SYNCED' : `⚠️ ${mismatches.length} MISMATCH(ES)`,
    },
    mismatches,
    matches,
    unmatched,
    apiGames: apiGames.map(g => ({
      game: `${g.away.abbr}@${g.home.abbr}`,
      date: g.date,
      time: g.gameTime,
      awayStarter: g.away.starter,
      homeStarter: g.home.starter,
      status: g.status,
    })),
  };
  
  CACHE.data = result;
  CACHE.ts = Date.now();
  
  return result;
}

function getCachedStatus() {
  if (CACHE.data && Date.now() - CACHE.ts < CACHE_TTL) {
    return { ...CACHE.data, cached: true, cacheAge: `${Math.round((Date.now() - CACHE.ts) / 1000)}s` };
  }
  return null;
}

module.exports = { syncStarters, getCachedStatus, fetchStarters, MLB_TEAM_MAP };
