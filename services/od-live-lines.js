// services/od-live-lines.js — Opening Day Live Lines v80.0
// =========================================================
// Fetches LIVE odds from The Odds API on game day to replace stale hardcoded DK lines.
// Books move lines 5-30 cents from open to close. If we're using yesterday's lines,
// we're comparing our edge to phantom prices. This service ensures real-time accuracy.
//
// On game day, lines move for:
//   - Lineup announcements (2-4 hrs before first pitch) — biggest moves
//   - Weather changes (rain delays, wind shifts)
//   - Late injury news (bullpen arms scratched)
//   - Sharp action (wiseguys hammer one side)
//
// CRITICAL: Without this, every "value bet" on our OD card could be dead wrong
// because the lines moved 10+ cents since we captured them.

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, 'od-live-lines-cache.json');
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes (odds move fast near game time)

// Team name → abbreviation mapping for The Odds API
const TEAM_ABBREVS = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM',
  'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH',
};

let lineCache = null;
let lineCacheTime = 0;

/**
 * Fetch live MLB odds from The Odds API
 * Returns: array of game objects with odds from multiple books
 */
async function fetchLiveMLBOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn('[od-live-lines] No ODDS_API_KEY set');
    return null;
  }
  
  // Check cache first
  const now = Date.now();
  if (lineCache && (now - lineCacheTime) < CACHE_TTL) {
    return lineCache;
  }
  
  // Try loading from file cache
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      if (cached.timestamp && (now - cached.timestamp) < CACHE_TTL) {
        lineCache = cached.data;
        lineCacheTime = cached.timestamp;
        return lineCache;
      }
    }
  } catch (e) { /* ignore cache errors */ }
  
  // Fetch fresh data
  const markets = 'h2h,totals,spreads';
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,caesars,pointsbet,bet365`;
  
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const games = JSON.parse(data);
          if (!Array.isArray(games)) {
            console.warn('[od-live-lines] Unexpected API response:', typeof games);
            resolve(lineCache || null); // fallback to stale cache
            return;
          }
          
          // Cache the result
          lineCache = games;
          lineCacheTime = now;
          
          // Write to file cache
          try {
            fs.writeFileSync(CACHE_PATH, JSON.stringify({ data: games, timestamp: now }, null, 2));
          } catch (e) { /* ignore write errors */ }
          
          // Log remaining API calls
          const remaining = res.headers['x-requests-remaining'];
          const used = res.headers['x-requests-used'];
          if (remaining) {
            console.log(`[od-live-lines] API: ${used || '?'} used, ${remaining} remaining`);
          }
          
          resolve(games);
        } catch (e) {
          console.error('[od-live-lines] Parse error:', e.message);
          resolve(lineCache || null);
        }
      });
    });
    req.on('error', (e) => {
      console.error('[od-live-lines] Fetch error:', e.message);
      resolve(lineCache || null);
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(lineCache || null);
    });
  });
}

/**
 * Parse a single game's odds into our format
 * Returns: { homeML, awayML, total, homeSpread, awaySpread, books: {...} }
 */
function parseGameOdds(game) {
  const homeTeam = game.home_team;
  const awayTeam = game.away_team;
  const homeAbbr = TEAM_ABBREVS[homeTeam] || homeTeam;
  const awayAbbr = TEAM_ABBREVS[awayTeam] || awayTeam;
  
  const result = {
    homeTeam: homeAbbr,
    awayTeam: awayAbbr,
    homeTeamFull: homeTeam,
    awayTeamFull: awayTeam,
    commenceTime: game.commence_time,
    gameId: game.id,
    // Best available line (DK preferred, then FD, then any)
    homeML: null,
    awayML: null,
    total: null,
    overOdds: null,
    underOdds: null,
    homeSpread: null,
    homeSpreadOdds: null,
    awaySpread: null,
    awaySpreadOdds: null,
    // Per-book breakdown for line shopping
    books: {},
    lastUpdate: game.bookmakers?.reduce((latest, b) => {
      const t = new Date(b.last_update).getTime();
      return t > latest ? t : latest;
    }, 0),
  };
  
  // Book priority for "best line": DK > FD > BetMGM > Caesars > PointsBet > Bet365
  const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'pointsbetus', 'bet365'];
  
  // Parse all bookmakers
  for (const book of (game.bookmakers || [])) {
    const bookKey = book.key;
    const bookData = { name: book.title, key: bookKey };
    
    for (const market of (book.markets || [])) {
      if (market.key === 'h2h') {
        for (const outcome of market.outcomes) {
          if (outcome.name === homeTeam) {
            bookData.homeML = outcome.price;
          } else if (outcome.name === awayTeam) {
            bookData.awayML = outcome.price;
          }
        }
      } else if (market.key === 'totals') {
        for (const outcome of market.outcomes) {
          if (outcome.name === 'Over') {
            bookData.total = outcome.point;
            bookData.overOdds = outcome.price;
          } else if (outcome.name === 'Under') {
            bookData.underOdds = outcome.price;
          }
        }
      } else if (market.key === 'spreads') {
        for (const outcome of market.outcomes) {
          if (outcome.name === homeTeam) {
            bookData.homeSpread = outcome.point;
            bookData.homeSpreadOdds = outcome.price;
          } else if (outcome.name === awayTeam) {
            bookData.awaySpread = outcome.point;
            bookData.awaySpreadOdds = outcome.price;
          }
        }
      }
    }
    
    result.books[bookKey] = bookData;
  }
  
  // Set "best line" from priority ordering
  for (const bookKey of BOOK_PRIORITY) {
    const book = result.books[bookKey];
    if (!book) continue;
    if (result.homeML === null && book.homeML != null) {
      result.homeML = book.homeML;
      result.awayML = book.awayML;
    }
    if (result.total === null && book.total != null) {
      result.total = book.total;
      result.overOdds = book.overOdds;
      result.underOdds = book.underOdds;
    }
    if (result.homeSpread === null && book.homeSpread != null) {
      result.homeSpread = book.homeSpread;
      result.homeSpreadOdds = book.homeSpreadOdds;
      result.awaySpread = book.awaySpread;
      result.awaySpreadOdds = book.awaySpreadOdds;
    }
  }
  
  // Fallback: use any book if preferred books don't have lines
  if (result.homeML === null) {
    for (const [, book] of Object.entries(result.books)) {
      if (book.homeML != null) {
        result.homeML = book.homeML;
        result.awayML = book.awayML;
        break;
      }
    }
  }
  if (result.total === null) {
    for (const [, book] of Object.entries(result.books)) {
      if (book.total != null) {
        result.total = book.total;
        result.overOdds = book.overOdds;
        result.underOdds = book.underOdds;
        break;
      }
    }
  }
  
  return result;
}

/**
 * Get live lines for all MLB games, mapped by matchup key (e.g., "BOS@CIN")
 * Returns: { games: { "BOS@CIN": {...}, ... }, timestamp, gamesFound }
 */
async function getLiveLines() {
  const rawGames = await fetchLiveMLBOdds();
  if (!rawGames || !Array.isArray(rawGames)) {
    return { games: {}, timestamp: Date.now(), gamesFound: 0, error: 'No odds data' };
  }
  
  const games = {};
  for (const game of rawGames) {
    const parsed = parseGameOdds(game);
    const matchupKey = `${parsed.awayTeam}@${parsed.homeTeam}`;
    games[matchupKey] = parsed;
  }
  
  return {
    games,
    timestamp: Date.now(),
    gamesFound: Object.keys(games).length,
    source: 'the-odds-api',
    cacheAge: lineCache ? Math.round((Date.now() - lineCacheTime) / 1000) : null,
  };
}

/**
 * Update OD game schedule with live lines
 * Compares live lines to hardcoded DK lines and flags movements
 * @param {Array} odGames - OPENING_DAY_GAMES array from mlb-opening-day.js
 * @returns Updated games with live line data + movement flags
 */
async function updateODLinesFromLive(odGames) {
  const live = await getLiveLines();
  if (!live.games || live.gamesFound === 0) {
    return { games: odGames, liveUpdated: 0, error: 'No live lines available' };
  }
  
  let updated = 0;
  const movements = [];
  
  for (const game of odGames) {
    const matchupKey = `${game.away}@${game.home}`;
    const liveGame = live.games[matchupKey];
    
    if (!liveGame) continue;
    
    // Store original DK lines for comparison
    const origDK = game.dkLine ? { ...game.dkLine } : null;
    
    // Update lines with live data
    if (liveGame.homeML != null && liveGame.awayML != null) {
      game.liveLines = {
        homeML: liveGame.homeML,
        awayML: liveGame.awayML,
        total: liveGame.total,
        overOdds: liveGame.overOdds,
        underOdds: liveGame.underOdds,
        homeSpread: liveGame.homeSpread,
        awaySpread: liveGame.awaySpread,
        books: liveGame.books,
        lastUpdate: liveGame.lastUpdate ? new Date(liveGame.lastUpdate).toISOString() : null,
        source: 'the-odds-api',
      };
      
      // Track movements from hardcoded DK lines
      if (origDK) {
        const homeMLMove = liveGame.homeML - origDK.homeML;
        const totalMove = liveGame.total != null && origDK.total != null ? liveGame.total - origDK.total : 0;
        
        if (Math.abs(homeMLMove) >= 5 || Math.abs(totalMove) >= 0.5) {
          movements.push({
            game: matchupKey,
            homeMLOrig: origDK.homeML,
            homeMLLive: liveGame.homeML,
            homeMLMove,
            totalOrig: origDK.total,
            totalLive: liveGame.total,
            totalMove,
            significance: Math.abs(homeMLMove) >= 15 || Math.abs(totalMove) >= 1 ? 'MAJOR' : 'MINOR',
          });
        }
        
        // Update the dkLine with live values for downstream consumers
        game.dkLine = {
          homeML: liveGame.homeML,
          awayML: liveGame.awayML,
          total: liveGame.total || origDK.total,
        };
        game._dkLineSource = 'live';
        game._dkLineOriginal = origDK;
      }
      
      updated++;
    }
  }
  
  return {
    games: odGames,
    liveUpdated: updated,
    totalGames: odGames.length,
    movements,
    majorMovements: movements.filter(m => m.significance === 'MAJOR'),
    timestamp: live.timestamp,
    cacheAge: live.cacheAge,
  };
}

/**
 * Get line shopping opportunities — best price across all books for each game
 */
async function getLineShoppingOpportunities() {
  const live = await getLiveLines();
  if (!live.games || live.gamesFound === 0) {
    return { opportunities: [], error: 'No live lines' };
  }
  
  const opportunities = [];
  
  for (const [matchup, game] of Object.entries(live.games)) {
    const opp = { matchup, bestHome: null, bestAway: null, bestOver: null, bestUnder: null };
    
    let bestHomeML = -9999, bestAwayML = -9999;
    let bestOverOdds = -9999, bestUnderOdds = -9999;
    
    for (const [bookKey, book] of Object.entries(game.books)) {
      if (book.homeML != null && book.homeML > bestHomeML) {
        bestHomeML = book.homeML;
        opp.bestHome = { ml: book.homeML, book: book.name || bookKey };
      }
      if (book.awayML != null && book.awayML > bestAwayML) {
        bestAwayML = book.awayML;
        opp.bestAway = { ml: book.awayML, book: book.name || bookKey };
      }
      if (book.overOdds != null && book.overOdds > bestOverOdds) {
        bestOverOdds = book.overOdds;
        opp.bestOver = { odds: book.overOdds, total: book.total, book: book.name || bookKey };
      }
      if (book.underOdds != null && book.underOdds > bestUnderOdds) {
        bestUnderOdds = book.underOdds;
        opp.bestUnder = { odds: book.underOdds, total: book.total, book: book.name || bookKey };
      }
    }
    
    // Calculate how much value line shopping adds
    // Compare best line to DK line
    const dk = game.books['draftkings'];
    if (dk && opp.bestHome) {
      opp.homeMLGain = opp.bestHome.ml - (dk.homeML || 0);
      opp.awayMLGain = opp.bestAway ? (opp.bestAway.ml - (dk.awayML || 0)) : 0;
    }
    
    if (opp.bestHome || opp.bestAway) {
      opportunities.push(opp);
    }
  }
  
  return {
    opportunities,
    totalGames: live.gamesFound,
    timestamp: live.timestamp,
  };
}

/**
 * Get a compact status summary
 */
function getStatus() {
  return {
    hasCachedData: !!lineCache,
    cacheAge: lineCache ? Math.round((Date.now() - lineCacheTime) / 1000) : null,
    gamesInCache: lineCache ? lineCache.length : 0,
    cacheTTL: CACHE_TTL / 1000,
    source: 'the-odds-api',
  };
}

module.exports = {
  fetchLiveMLBOdds,
  getLiveLines,
  updateODLinesFromLive,
  getLineShoppingOpportunities,
  parseGameOdds,
  getStatus,
  TEAM_ABBREVS,
};
