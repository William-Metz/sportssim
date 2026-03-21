/**
 * MLB Schedule & Confirmed Starters Service — SportsSim v15.0
 * 
 * Fetches actual MLB schedule with confirmed starting pitchers from ESPN.
 * Critical for accuracy — replaces projected rotation order with real announcements.
 * 
 * Sources:
 *   - ESPN MLB Scoreboard API (schedule + probable pitchers)
 *   - ESPN MLB Schedule API (multi-day view)
 * 
 * Key edge: Confirmed starters change lines dramatically. Getting the real
 * pitcher matchup hours/days before the general public adjusts = money.
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'mlb-schedule-cache.json');
const CACHE_TTL = 15 * 60 * 1000; // 15 min — starters can be announced/changed

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const ESPN_SCHEDULE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';

// Team name → abbreviation mapping for ESPN names
const ESPN_TO_ABBR = {
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
  // Short names too
  'Diamondbacks': 'ARI', 'Braves': 'ATL', 'Orioles': 'BAL', 'Red Sox': 'BOS',
  'Cubs': 'CHC', 'White Sox': 'CWS', 'Reds': 'CIN', 'Guardians': 'CLE',
  'Rockies': 'COL', 'Tigers': 'DET', 'Astros': 'HOU', 'Royals': 'KC',
  'Angels': 'LAA', 'Dodgers': 'LAD', 'Marlins': 'MIA', 'Brewers': 'MIL',
  'Twins': 'MIN', 'Mets': 'NYM', 'Yankees': 'NYY', 'Athletics': 'OAK',
  'Phillies': 'PHI', 'Pirates': 'PIT', 'Padres': 'SD', 'Giants': 'SF',
  'Mariners': 'SEA', 'Cardinals': 'STL', 'Rays': 'TB', 'Rangers': 'TEX',
  'Blue Jays': 'TOR', 'Nationals': 'WSH',
};

// Reverse mapping
const ABBR_TO_FULL = {};
for (const [full, abbr] of Object.entries(ESPN_TO_ABBR)) {
  if (full.includes(' ') && full.split(' ').length >= 2) {
    if (!ABBR_TO_FULL[abbr]) ABBR_TO_FULL[abbr] = full;
  }
}

// ==================== ESPN FETCHING ====================

async function fetchESPNSchedule(dateStr) {
  try {
    const fetch = require('node-fetch');
    // ESPN accepts dates as YYYYMMDD
    const dateParam = dateStr.replace(/-/g, '');
    const url = `${ESPN_SCOREBOARD}?dates=${dateParam}`;
    
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'SportsSim/1.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    if (!resp.ok) {
      console.error(`ESPN schedule fetch failed: ${resp.status}`);
      return null;
    }
    
    return await resp.json();
  } catch (e) {
    console.error('ESPN schedule fetch error:', e.message);
    return null;
  }
}

/**
 * Parse ESPN scoreboard data into our format
 */
function parseESPNGames(data) {
  if (!data || !data.events) return [];
  
  const games = [];
  
  for (const event of data.events) {
    try {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      // Get teams
      const competitors = competition.competitors || [];
      let homeTeam = null, awayTeam = null;
      
      for (const c of competitors) {
        const teamName = c.team?.displayName || c.team?.name || '';
        const abbr = resolveAbbr(teamName, c.team?.abbreviation);
        const teamData = {
          name: teamName,
          abbr,
          shortName: c.team?.shortDisplayName || c.team?.abbreviation || abbr,
          record: c.records?.[0]?.summary || '',
          score: c.score ? parseInt(c.score) : null,
          probablePitcher: null,
          confirmedPitcher: false,
        };
        
        // Extract probable pitcher
        if (c.probables && c.probables.length > 0) {
          const pitcher = c.probables[0];
          teamData.probablePitcher = {
            name: pitcher.athlete?.displayName || pitcher.athlete?.fullName || null,
            shortName: pitcher.athlete?.shortName || null,
            id: pitcher.athlete?.id || null,
            headshot: pitcher.athlete?.headshot?.href || null,
            stats: parsePitcherStats(pitcher.statistics || pitcher.stats),
          };
          teamData.confirmedPitcher = true; // ESPN shows probable = effectively confirmed
        }
        
        if (c.homeAway === 'home') homeTeam = teamData;
        else awayTeam = teamData;
      }
      
      if (!homeTeam || !awayTeam) continue;
      
      // Game status
      const status = event.status?.type?.name || 'STATUS_SCHEDULED';
      const statusDetail = event.status?.type?.detail || '';
      const gameTime = event.date || competition.date;
      
      // Venue
      const venue = competition.venue;
      const venueName = venue?.fullName || venue?.shortName || '';
      const venueCity = venue?.address?.city || '';
      const venueState = venue?.address?.state || '';
      
      // Odds (if available)
      let odds = null;
      if (competition.odds && competition.odds.length > 0) {
        const primaryOdds = competition.odds[0];
        odds = {
          provider: primaryOdds.provider?.name || 'Unknown',
          overUnder: primaryOdds.overUnder || null,
          spread: primaryOdds.spread || null,
          homeML: primaryOdds.homeTeamOdds?.moneyLine || null,
          awayML: primaryOdds.awayTeamOdds?.moneyLine || null,
          homeSpreadOdds: primaryOdds.homeTeamOdds?.spreadOdds || null,
          awaySpreadOdds: primaryOdds.awayTeamOdds?.spreadOdds || null,
        };
      }
      
      // Broadcasts
      const broadcasts = competition.broadcasts?.map(b => 
        b.names?.join(', ') || b.market || ''
      ).filter(Boolean) || [];
      
      games.push({
        id: event.id,
        name: event.name || `${awayTeam.abbr} @ ${homeTeam.abbr}`,
        shortName: event.shortName || `${awayTeam.shortName} @ ${homeTeam.shortName}`,
        date: gameTime,
        status,
        statusDetail,
        homeTeam,
        awayTeam,
        venue: {
          name: venueName,
          city: venueCity,
          state: venueState,
          indoor: venue?.indoor || false,
        },
        odds,
        broadcasts,
        // Add computed fields
        hasConfirmedStarters: !!(homeTeam.probablePitcher && awayTeam.probablePitcher),
        hasProbablePitchers: !!(homeTeam.probablePitcher || awayTeam.probablePitcher),
      });
      
    } catch (e) {
      console.error('Error parsing ESPN game:', e.message);
    }
  }
  
  return games;
}

function resolveAbbr(teamName, espnAbbr) {
  // Try ESPN abbreviation first (most reliable)
  const abbrMap = {
    'ARI': 'ARI', 'ATL': 'ATL', 'BAL': 'BAL', 'BOS': 'BOS',
    'CHC': 'CHC', 'CWS': 'CWS', 'CIN': 'CIN', 'CLE': 'CLE',
    'COL': 'COL', 'DET': 'DET', 'HOU': 'HOU', 'KC': 'KC',
    'LAA': 'LAA', 'LAD': 'LAD', 'MIA': 'MIA', 'MIL': 'MIL',
    'MIN': 'MIN', 'NYM': 'NYM', 'NYY': 'NYY', 'OAK': 'OAK',
    'PHI': 'PHI', 'PIT': 'PIT', 'SD': 'SD', 'SF': 'SF',
    'SEA': 'SEA', 'STL': 'STL', 'TB': 'TB', 'TEX': 'TEX',
    'TOR': 'TOR', 'WSH': 'WSH',
  };
  
  if (espnAbbr && abbrMap[espnAbbr]) return abbrMap[espnAbbr];
  
  // Try team name lookup
  if (ESPN_TO_ABBR[teamName]) return ESPN_TO_ABBR[teamName];
  
  // Fuzzy match on team name
  const lower = teamName.toLowerCase();
  for (const [name, abbr] of Object.entries(ESPN_TO_ABBR)) {
    if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) {
      return abbr;
    }
  }
  
  return espnAbbr || 'UNK';
}

function parsePitcherStats(stats) {
  if (!stats || !Array.isArray(stats)) return null;
  
  const result = {};
  for (const stat of stats) {
    if (stat.displayName || stat.name) {
      const name = (stat.abbreviation || stat.name || stat.displayName || '').toLowerCase();
      const val = stat.displayValue || stat.value;
      
      if (name === 'era' || name === 'earnedRunAverage') result.era = parseFloat(val) || null;
      if (name === 'w' || name === 'wins') result.w = parseInt(val) || 0;
      if (name === 'l' || name === 'losses') result.l = parseInt(val) || 0;
      if (name === 'ip' || name === 'inningsPitched') result.ip = parseFloat(val) || null;
      if (name === 'so' || name === 'strikeouts') result.so = parseInt(val) || 0;
      if (name === 'whip') result.whip = parseFloat(val) || null;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

// ==================== PUBLIC API ====================

/**
 * Get MLB schedule for a specific date with confirmed starters
 * @param {string} dateStr - Date in YYYY-MM-DD format (defaults to today)
 */
async function getSchedule(dateStr) {
  if (!dateStr) {
    dateStr = new Date().toISOString().split('T')[0];
  }
  
  // Check cache
  const cache = loadCache();
  if (cache && cache[dateStr] && (Date.now() - cache[dateStr].fetchedAt) < CACHE_TTL) {
    return { ...cache[dateStr].data, cached: true };
  }
  
  const data = await fetchESPNSchedule(dateStr);
  if (!data) {
    // Return cached even if stale
    if (cache && cache[dateStr]) {
      return { ...cache[dateStr].data, cached: true, stale: true };
    }
    return { date: dateStr, games: [], error: 'Failed to fetch schedule' };
  }
  
  const games = parseESPNGames(data);
  
  const result = {
    date: dateStr,
    games,
    gamesCount: games.length,
    confirmedStarters: games.filter(g => g.hasConfirmedStarters).length,
    partialStarters: games.filter(g => g.hasProbablePitchers && !g.hasConfirmedStarters).length,
    tbd: games.filter(g => !g.hasProbablePitchers).length,
    timestamp: new Date().toISOString(),
  };
  
  // Cache
  saveToCache(dateStr, result);
  
  return result;
}

/**
 * Get schedule for multiple days (e.g., Opening Day weekend)
 */
async function getMultiDaySchedule(startDate, numDays = 3) {
  const results = {};
  const start = new Date(startDate + 'T00:00:00Z');
  
  for (let i = 0; i < numDays; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    try {
      results[dateStr] = await getSchedule(dateStr);
    } catch (e) {
      results[dateStr] = { date: dateStr, games: [], error: e.message };
    }
  }
  
  // Summary
  let totalGames = 0, totalConfirmed = 0;
  for (const day of Object.values(results)) {
    totalGames += day.gamesCount || 0;
    totalConfirmed += day.confirmedStarters || 0;
  }
  
  return {
    startDate,
    numDays,
    totalGames,
    totalConfirmedStarters: totalConfirmed,
    days: results,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get confirmed starter for a specific team on a specific date
 * Returns pitcher name or null
 */
async function getConfirmedStarter(teamAbbr, dateStr) {
  const schedule = await getSchedule(dateStr);
  if (!schedule || !schedule.games) return null;
  
  for (const game of schedule.games) {
    if (game.homeTeam.abbr === teamAbbr && game.homeTeam.probablePitcher) {
      return {
        pitcher: game.homeTeam.probablePitcher.name,
        stats: game.homeTeam.probablePitcher.stats,
        homeAway: 'home',
        opponent: game.awayTeam.abbr,
        game: game.shortName,
      };
    }
    if (game.awayTeam.abbr === teamAbbr && game.awayTeam.probablePitcher) {
      return {
        pitcher: game.awayTeam.probablePitcher.name,
        stats: game.awayTeam.probablePitcher.stats,
        homeAway: 'away',
        opponent: game.homeTeam.abbr,
        game: game.shortName,
      };
    }
  }
  
  return null;
}

/**
 * Get Opening Day schedule specifically (March 26-27, 2026)
 */
async function getOpeningDaySchedule() {
  const multiDay = await getMultiDaySchedule('2026-03-26', 2);
  
  return {
    title: 'MLB 2026 Opening Day Schedule',
    ...multiDay,
    isOpeningDay: true,
  };
}

// ==================== CACHE ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveToCache(dateStr, data) {
  try {
    const cache = loadCache() || {};
    cache[dateStr] = { data, fetchedAt: Date.now() };
    
    // Prune old cache entries (keep last 14 days)
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const key of Object.keys(cache)) {
      if (cache[key].fetchedAt < cutoff) delete cache[key];
    }
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) { /* ignore */ }
}

function getStatus() {
  const cache = loadCache();
  const cachedDates = Object.keys(cache || {});
  return {
    service: 'mlb-schedule',
    version: '1.0',
    cachedDates: cachedDates.length,
    dates: cachedDates.slice(-7),
    source: 'ESPN Scoreboard API',
  };
}

module.exports = {
  getSchedule,
  getMultiDaySchedule,
  getConfirmedStarter,
  getOpeningDaySchedule,
  getStatus,
  ESPN_TO_ABBR,
  ABBR_TO_FULL,
};
