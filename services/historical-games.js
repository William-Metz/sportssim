/**
 * Historical Games Fetcher — SportsSim v28.0
 * ============================================
 * Fetches real MLB game results from ESPN API for ML training data.
 * Builds rich feature vectors from actual game data.
 * 
 * Data sources:
 *   - ESPN Scoreboard API (game results, scores, pitchers)
 *   - Our Statcast cache (xERA/xwOBA for pitchers/teams)
 *   - MLB model (team ratings, park factors)
 * 
 * This is the DATA MOAT — more games = better ML model = more money.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'historical-games-cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ESPN Scoreboard API
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';

// ==================== ESPN FETCHER ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SportsSim/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Fetch MLB games for a specific date from ESPN.
 * Returns array of game objects with scores, teams, pitchers.
 */
async function fetchGamesForDate(dateStr) {
  // dateStr format: 'YYYYMMDD'
  const url = `${ESPN_BASE}?dates=${dateStr}`;
  
  try {
    const data = await fetchJSON(url);
    if (!data.events) return [];
    
    const games = [];
    for (const event of data.events) {
      const game = parseESPNGame(event);
      if (game) games.push(game);
    }
    return games;
  } catch (e) {
    console.error(`[Historical] Error fetching ${dateStr}: ${e.message}`);
    return [];
  }
}

/**
 * Parse an ESPN event into a structured game object.
 */
function parseESPNGame(event) {
  try {
    const competition = event.competitions?.[0];
    if (!competition) return null;
    
    // Only count completed games
    const status = competition.status?.type?.name;
    if (status !== 'STATUS_FINAL') return null;
    
    const competitors = competition.competitors || [];
    if (competitors.length !== 2) return null;
    
    let away = null, home = null;
    for (const comp of competitors) {
      const teamData = {
        abbr: comp.team?.abbreviation || '',
        name: comp.team?.displayName || '',
        score: parseInt(comp.score || '0'),
        hits: parseInt(comp.statistics?.find(s => s.name === 'hits')?.displayValue || '0'),
        errors: parseInt(comp.statistics?.find(s => s.name === 'errors')?.displayValue || '0'),
        // Records
        record: comp.records?.[0]?.summary || '',
      };
      
      if (comp.homeAway === 'away') away = teamData;
      else home = teamData;
    }
    
    if (!away || !home) return null;
    
    // Extract starting pitchers from leaders/notes
    let awayStarter = null, homeStarter = null;
    
    // Try to get from headlines/notes
    const notes = competition.notes || [];
    const headlines = competition.headlines || [];
    
    // Try to get from the "leaders" section or probables
    // ESPN doesn't always include this in historical data
    
    // Parse W/L from record string (e.g., "45-30")
    function parseRecord(recordStr) {
      const parts = recordStr.split('-').map(Number);
      return { w: parts[0] || 0, l: parts[1] || 0 };
    }
    
    const awayRecord = parseRecord(away.record);
    const homeRecord = parseRecord(home.record);
    
    const gameDate = event.date ? new Date(event.date) : null;
    
    return {
      id: event.id,
      date: gameDate ? gameDate.toISOString().split('T')[0] : null,
      away: away.abbr,
      home: home.abbr,
      awayName: away.name,
      homeName: home.name,
      awayScore: away.score,
      homeScore: home.score,
      homeWon: home.score > away.score,
      actualTotal: away.score + home.score,
      awayW: awayRecord.w,
      awayL: awayRecord.l,
      homeW: homeRecord.w,
      homeL: homeRecord.l,
      // Derived features
      runDiff: home.score - away.score,
      isBlowout: Math.abs(home.score - away.score) >= 6,
      isOneRun: Math.abs(home.score - away.score) === 1,
      totalRuns: away.score + home.score,
    };
  } catch (e) {
    return null;
  }
}

// ==================== BATCH FETCHER ====================

/**
 * Fetch games for a date range.
 * Spreads requests to avoid rate limiting.
 * 
 * @param {string} startDate - YYYY-MM-DD format
 * @param {string} endDate - YYYY-MM-DD format
 * @param {number} delayMs - delay between requests
 */
async function fetchDateRange(startDate, endDate, delayMs = 500) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const allGames = [];
  let fetchCount = 0;
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
    const games = await fetchGamesForDate(dateStr);
    allGames.push(...games);
    fetchCount++;
    
    if (fetchCount % 10 === 0) {
      console.log(`[Historical] Fetched ${fetchCount} days, ${allGames.length} games so far...`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, delayMs));
  }
  
  console.log(`[Historical] Done: ${fetchCount} days, ${allGames.length} games total`);
  return allGames;
}

// ==================== ENRICHMENT ====================

// Team abbreviation mapping (ESPN → our standard)
const ESPN_ABBR_MAP = {
  'WSH': 'WSH', 'WAS': 'WSH',
  'CHC': 'CHC', 'CWS': 'CWS',
  'SD': 'SD', 'SF': 'SF',
  'TB': 'TB', 'KC': 'KC',
  'STL': 'STL', 'LAD': 'LAD',
  'LAA': 'LAA', 'NYY': 'NYY',
  'NYM': 'NYM',
};

function normalizeAbbr(abbr) {
  return ESPN_ABBR_MAP[abbr] || abbr;
}

/**
 * Enrich game data with team stats for ML training.
 * Uses 2024 season stats as the baseline (what we'd know for 2024 games).
 */
function enrichGamesForTraining(games, teamStats = null) {
  let mlb;
  try { mlb = require('../models/mlb'); } catch (e) { return games; }
  
  const teams = teamStats || mlb.getTeams();
  const enriched = [];
  
  for (const game of games) {
    const awayAbbr = normalizeAbbr(game.away);
    const homeAbbr = normalizeAbbr(game.home);
    const awayTeam = teams[awayAbbr];
    const homeTeam = teams[homeAbbr];
    
    if (!awayTeam || !homeTeam) continue;
    
    enriched.push({
      ...game,
      away: awayAbbr,
      home: homeAbbr,
      // Team offensive stats
      awayRsG: awayTeam.rsG,
      homeRsG: homeTeam.rsG,
      awayRaG: awayTeam.raG,
      homeRaG: homeTeam.raG,
      // Pitching stats
      awayEra: awayTeam.era,
      homeEra: homeTeam.era,
      awayFip: awayTeam.fip || awayTeam.era,
      homeFip: homeTeam.fip || homeTeam.era,
      awayWhip: awayTeam.whip,
      homeWhip: homeTeam.whip,
      awayK9: awayTeam.k9,
      homeK9: homeTeam.k9,
      // Offense stats
      awayOps: awayTeam.ops,
      homeOps: homeTeam.ops,
      // Bullpen
      awayBullpenEra: awayTeam.bullpenEra,
      homeBullpenEra: homeTeam.bullpenEra,
      // Park factor
      parkFactor: mlb.PARK_FACTORS?.[homeTeam.park] || 1.0,
      // Default pitcher vals (we don't have specific starters for historical)
      awayPitcherRating: 50,
      homePitcherRating: 50,
      awayPitcherEra: awayTeam.era,
      homePitcherEra: homeTeam.era,
      awayPitcherFip: awayTeam.fip || awayTeam.era,
      homePitcherFip: homeTeam.fip || homeTeam.era,
      awayPitcherHand: 'R',
      homePitcherHand: 'R',
      // Approximate closing ML from win pct (not perfect but useful)
      closingHomeML: estimateClosingML(awayTeam, homeTeam),
      bookTotal: 8.5, // League average
    });
  }
  
  return enriched;
}

/**
 * Estimate closing ML from team quality differential.
 * Not perfect but gives us approximate book lines for backtest.
 */
function estimateClosingML(awayTeam, homeTeam) {
  const awayWpct = awayTeam.w / Math.max(1, awayTeam.w + awayTeam.l);
  const homeWpct = homeTeam.w / Math.max(1, homeTeam.w + homeTeam.l);
  
  // Log5 + 4% HFA
  const log5 = (homeWpct - homeWpct * awayWpct) / (homeWpct + awayWpct - 2 * homeWpct * awayWpct);
  const prob = Math.max(0.20, Math.min(0.80, log5 + 0.04));
  
  // Convert to American ML
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== CACHE MANAGEMENT ====================

let gameCache = { games: [], lastFetch: 0, dateRange: null };

function loadGameCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (raw.games && raw.games.length > 0) {
        gameCache = raw;
        return true;
      }
    }
  } catch (e) { /* corrupt cache */ }
  return false;
}

function saveGameCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(gameCache, null, 2));
  } catch (e) { console.error('[Historical] Cache write error:', e.message); }
}

// ==================== MAIN API ====================

/**
 * Get training data — fetches and caches historical MLB games.
 * Default: 2024 regular season (April-September)
 */
async function getTrainingData(options = {}) {
  const {
    startDate = '2024-04-01',
    endDate = '2024-09-29',
    forceRefresh = false,
    maxGames = null,
    teamStats = null,
  } = options;
  
  // Check cache first
  const cacheKey = `${startDate}_${endDate}`;
  if (!forceRefresh && gameCache.games.length > 0 && gameCache.dateRange === cacheKey) {
    console.log(`[Historical] Using cached data: ${gameCache.games.length} games`);
    const enriched = enrichGamesForTraining(gameCache.games, teamStats);
    return maxGames ? enriched.slice(0, maxGames) : enriched;
  }
  
  if (!forceRefresh && loadGameCache() && gameCache.dateRange === cacheKey) {
    console.log(`[Historical] Loaded from disk cache: ${gameCache.games.length} games`);
    const enriched = enrichGamesForTraining(gameCache.games, teamStats);
    return maxGames ? enriched.slice(0, maxGames) : enriched;
  }
  
  // Fetch from ESPN
  console.log(`[Historical] Fetching MLB games ${startDate} to ${endDate}...`);
  const games = await fetchDateRange(startDate, endDate, 300);
  
  // Save to cache
  gameCache = { games, lastFetch: Date.now(), dateRange: cacheKey };
  saveGameCache();
  
  // Enrich with team stats
  const enriched = enrichGamesForTraining(games, teamStats);
  console.log(`[Historical] ${games.length} raw games → ${enriched.length} enriched for ML`);
  
  return maxGames ? enriched.slice(0, maxGames) : enriched;
}

/**
 * Quick method: get cached games only (no fetch).
 * For use when you don't want to wait for ESPN calls.
 */
function getCachedGames() {
  if (gameCache.games.length > 0) return gameCache.games;
  loadGameCache();
  return gameCache.games;
}

/**
 * Get training data stats
 */
function getStats() {
  const games = getCachedGames();
  if (!games.length) return { games: 0, cached: false };
  
  const homeWins = games.filter(g => g.homeWon).length;
  const avgTotal = games.reduce((s, g) => s + g.totalRuns, 0) / games.length;
  const oneRunGames = games.filter(g => g.isOneRun).length;
  
  return {
    games: games.length,
    dateRange: gameCache.dateRange,
    homeWinPct: +(homeWins / games.length * 100).toFixed(1),
    avgTotal: +avgTotal.toFixed(1),
    oneRunPct: +(oneRunGames / games.length * 100).toFixed(1),
    cached: true,
    lastFetch: gameCache.lastFetch ? new Date(gameCache.lastFetch).toISOString() : null,
  };
}

module.exports = {
  fetchGamesForDate,
  fetchDateRange,
  getTrainingData,
  getCachedGames,
  enrichGamesForTraining,
  getStats,
};
