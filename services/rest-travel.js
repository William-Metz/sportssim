/**
 * MLB Rest & Travel Model — SportsSim v14.0
 * 
 * Tracks team schedules to calculate rest/travel fatigue adjustments.
 * Key edges in MLB:
 *   - Day game after night game = 2-3% performance drop
 *   - Long road trips (6+ games) = fatigue compounds
 *   - Cross-country travel = time zone adjustment penalty
 *   - Off-day rest = slight boost (especially for bullpen)
 *   - First game after travel day = 1-2% penalty
 *   - West-to-East travel worse than East-to-West
 *   
 * Historical MLB data shows:
 *   - Home teams win 54% overall
 *   - Teams on day-after-night: 51.2% (vs 54.8% when rested)
 *   - Teams on 7+ game road trips: 46.3% win rate
 *   - Teams after cross-country travel: 48.8% first game
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'schedule-cache.json');
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// ==================== TEAM LOCATIONS ====================
// Used for travel distance calculations
const TEAM_LOCATIONS = {
  // {timezone_offset from ET, lat, lon, city}
  ARI: { tz: -2, lat: 33.45, lon: -112.07, city: 'Phoenix' },
  ATL: { tz: 0,  lat: 33.89, lon: -84.47,  city: 'Atlanta' },
  BAL: { tz: 0,  lat: 39.28, lon: -76.62,  city: 'Baltimore' },
  BOS: { tz: 0,  lat: 42.35, lon: -71.10,  city: 'Boston' },
  CHC: { tz: -1, lat: 41.95, lon: -87.66,  city: 'Chicago' },
  CWS: { tz: -1, lat: 41.83, lon: -87.63,  city: 'Chicago' },
  CIN: { tz: 0,  lat: 39.10, lon: -84.51,  city: 'Cincinnati' },
  CLE: { tz: 0,  lat: 41.50, lon: -81.69,  city: 'Cleveland' },
  COL: { tz: -2, lat: 39.76, lon: -104.99, city: 'Denver' },
  DET: { tz: 0,  lat: 42.34, lon: -83.05,  city: 'Detroit' },
  HOU: { tz: -1, lat: 29.76, lon: -95.36,  city: 'Houston' },
  KC:  { tz: -1, lat: 39.05, lon: -94.48,  city: 'Kansas City' },
  LAA: { tz: -3, lat: 33.80, lon: -117.88, city: 'Anaheim' },
  LAD: { tz: -3, lat: 34.07, lon: -118.24, city: 'Los Angeles' },
  MIA: { tz: 0,  lat: 25.78, lon: -80.22,  city: 'Miami' },
  MIL: { tz: -1, lat: 43.03, lon: -87.97,  city: 'Milwaukee' },
  MIN: { tz: -1, lat: 44.98, lon: -93.28,  city: 'Minneapolis' },
  NYM: { tz: 0,  lat: 40.76, lon: -73.85,  city: 'New York' },
  NYY: { tz: 0,  lat: 40.83, lon: -73.93,  city: 'New York' },
  OAK: { tz: -3, lat: 37.75, lon: -122.20, city: 'Oakland' },
  PHI: { tz: 0,  lat: 39.91, lon: -75.17,  city: 'Philadelphia' },
  PIT: { tz: 0,  lat: 40.45, lon: -80.01,  city: 'Pittsburgh' },
  SD:  { tz: -3, lat: 32.71, lon: -117.16, city: 'San Diego' },
  SF:  { tz: -3, lat: 37.78, lon: -122.39, city: 'San Francisco' },
  SEA: { tz: -3, lat: 47.59, lon: -122.33, city: 'Seattle' },
  STL: { tz: -1, lat: 38.62, lon: -90.19,  city: 'St. Louis' },
  TB:  { tz: 0,  lat: 27.77, lon: -82.65,  city: 'St. Petersburg' },
  TEX: { tz: -1, lat: 32.75, lon: -97.08,  city: 'Arlington' },
  TOR: { tz: 0,  lat: 43.64, lon: -79.39,  city: 'Toronto' },
  WSH: { tz: 0,  lat: 38.87, lon: -77.01,  city: 'Washington' },
};

// ==================== TRAVEL DISTANCE ====================

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getDistance(team1, team2) {
  const loc1 = TEAM_LOCATIONS[team1];
  const loc2 = TEAM_LOCATIONS[team2];
  if (!loc1 || !loc2) return 0;
  return Math.round(haversineDistance(loc1.lat, loc1.lon, loc2.lat, loc2.lon));
}

function getTimezoneShift(fromTeam, toTeam) {
  const from = TEAM_LOCATIONS[fromTeam];
  const to = TEAM_LOCATIONS[toTeam];
  if (!from || !to) return 0;
  return to.tz - from.tz; // negative = traveling west, positive = traveling east
}

// ==================== SCHEDULE FETCHING ====================

let scheduleCache = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (data.timestamp && Date.now() - data.timestamp < CACHE_TTL) {
        scheduleCache = data.schedules || {};
        return;
      }
    }
  } catch (e) { /* start fresh */ }
  scheduleCache = {};
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      timestamp: Date.now(),
      schedules: scheduleCache
    }, null, 2));
  } catch (e) { /* cache write failed */ }
}

/**
 * Fetch recent schedule for a team from ESPN
 * Returns last 10 games with dates, opponents, home/away, day/night
 */
async function fetchTeamSchedule(teamAbbr) {
  const cacheKey = `schedule_${teamAbbr}`;
  if (scheduleCache[cacheKey] && Date.now() - scheduleCache[cacheKey].fetchedAt < CACHE_TTL) {
    return scheduleCache[cacheKey].games;
  }

  try {
    const fetch = require('node-fetch');
    // ESPN team ID mapping
    const espnIds = {
      ARI: 29, ATL: 15, BAL: 1, BOS: 2, CHC: 16, CWS: 4, CIN: 17, CLE: 5,
      COL: 27, DET: 6, HOU: 18, KC: 7, LAA: 3, LAD: 19, MIA: 28, MIL: 8,
      MIN: 9, NYM: 21, NYY: 10, OAK: 11, PHI: 22, PIT: 23, SD: 25, SF: 26,
      SEA: 12, STL: 24, TB: 30, TEX: 13, TOR: 14, WSH: 20
    };
    
    const espnId = espnIds[teamAbbr];
    if (!espnId) return [];
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${espnId}/schedule`;
    const resp = await fetch(url, { timeout: 8000 });
    const data = await resp.json();
    
    const games = [];
    const events = data.events || [];
    
    for (const event of events.slice(-15)) { // last 15 games
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      const gameDate = new Date(event.date);
      const competitors = competition.competitors || [];
      const isHome = competitors.find(c => c.id === String(espnId))?.homeAway === 'home';
      const opponent = competitors.find(c => c.id !== String(espnId));
      
      // Determine if day or night game (before 5pm ET = day game)
      const hourET = gameDate.getUTCHours() - 4; // rough ET
      const isDayGame = hourET < 17 && hourET >= 10;
      
      games.push({
        date: gameDate.toISOString().split('T')[0],
        time: gameDate.toISOString(),
        isHome,
        isDayGame,
        opponent: opponent?.team?.abbreviation || 'UNK',
        status: competition.status?.type?.name || 'unknown'
      });
    }
    
    scheduleCache[cacheKey] = { games, fetchedAt: Date.now() };
    saveCache();
    return games;
    
  } catch (e) {
    return [];
  }
}

// ==================== REST/TRAVEL ANALYSIS ====================

/**
 * Calculate rest and travel adjustment for a team
 * Returns adjustment factor in runs (can be positive or negative)
 */
async function getRestTravelAdjustment(teamAbbr, gameDate) {
  const schedule = await fetchTeamSchedule(teamAbbr);
  if (!schedule || schedule.length === 0) {
    return { adjFactor: 0, details: 'No schedule data', confidence: 'LOW' };
  }
  
  const targetDate = gameDate || new Date().toISOString().split('T')[0];
  
  // Find recent games before this date
  const pastGames = schedule
    .filter(g => g.date < targetDate && g.status !== 'STATUS_SCHEDULED')
    .sort((a, b) => b.date.localeCompare(a.date));
  
  if (pastGames.length === 0) {
    // Opening Day / first game — no fatigue data
    return { 
      adjFactor: 0, 
      details: 'Season opener — no prior games',
      isOpener: true,
      confidence: 'LOW'
    };
  }
  
  let totalAdj = 0;
  const factors = [];
  
  // 1. Days since last game
  const lastGame = pastGames[0];
  const daysSinceLast = Math.round(
    (new Date(targetDate) - new Date(lastGame.date)) / (1000 * 60 * 60 * 24)
  );
  
  if (daysSinceLast === 0) {
    // Doubleheader
    totalAdj -= 0.35;
    factors.push({ factor: 'doubleheader', impact: -0.35, note: 'Second game of doubleheader' });
  } else if (daysSinceLast === 1) {
    // Normal — no adjustment
    // But check day-after-night
    if (lastGame.isDayGame === false) {
      // Night game yesterday
      // Check if today's game is a day game (would need schedule data for today)
      const todayGames = schedule.filter(g => g.date === targetDate);
      if (todayGames.length > 0 && todayGames[0].isDayGame) {
        totalAdj -= 0.25;
        factors.push({ factor: 'day_after_night', impact: -0.25, note: 'Day game after night game' });
      }
    }
  } else if (daysSinceLast >= 2) {
    // Off day(s) — slight rest benefit
    const restBonus = Math.min(0.15, daysSinceLast * 0.05);
    totalAdj += restBonus;
    factors.push({ factor: 'rest', impact: +restBonus, note: `${daysSinceLast} days rest` });
  }
  
  // 2. Road trip length
  let consecutiveRoad = 0;
  for (const g of pastGames) {
    if (!g.isHome) consecutiveRoad++;
    else break;
  }
  
  if (consecutiveRoad >= 7) {
    totalAdj -= 0.30;
    factors.push({ factor: 'long_road_trip', impact: -0.30, note: `${consecutiveRoad}-game road trip` });
  } else if (consecutiveRoad >= 4) {
    totalAdj -= 0.15;
    factors.push({ factor: 'road_trip', impact: -0.15, note: `${consecutiveRoad}-game road trip` });
  }
  
  // 3. Travel distance (if last game was in different city)
  const lastOpponent = lastGame.opponent;
  const lastCity = lastGame.isHome ? teamAbbr : lastOpponent;
  
  // Determine where today's game is
  const todayGame = schedule.find(g => g.date === targetDate);
  const todayCity = todayGame ? (todayGame.isHome ? teamAbbr : todayGame.opponent) : teamAbbr;
  
  if (lastCity !== todayCity) {
    const distance = getDistance(lastCity, todayCity);
    const tzShift = Math.abs(getTimezoneShift(lastCity, todayCity));
    
    if (distance > 2000) {
      totalAdj -= 0.25;
      factors.push({ factor: 'cross_country', impact: -0.25, note: `${distance}mi travel, ${tzShift}hr tz shift` });
    } else if (distance > 1000) {
      totalAdj -= 0.12;
      factors.push({ factor: 'long_travel', impact: -0.12, note: `${distance}mi travel` });
    } else if (distance > 500) {
      totalAdj -= 0.05;
      factors.push({ factor: 'travel', impact: -0.05, note: `${distance}mi travel` });
    }
    
    // Extra penalty for east-bound travel (jet lag is worse going east)
    if (tzShift >= 2) {
      const direction = getTimezoneShift(lastCity, todayCity);
      if (direction > 0) { // traveling east
        totalAdj -= 0.08;
        factors.push({ factor: 'eastbound_jetlag', impact: -0.08, note: 'East-bound travel (worse jet lag)' });
      }
    }
  }
  
  // 4. Games in last 3 days (workload)
  const threeDaysAgo = new Date(targetDate);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const recentGames = pastGames.filter(g => new Date(g.date) >= threeDaysAgo);
  
  if (recentGames.length >= 3) {
    totalAdj -= 0.10;
    factors.push({ factor: 'heavy_workload', impact: -0.10, note: `${recentGames.length} games in 3 days` });
  }
  
  // 5. Home stand bonus (comfort)
  let consecutiveHome = 0;
  for (const g of pastGames) {
    if (g.isHome) consecutiveHome++;
    else break;
  }
  
  if (todayGame && todayGame.isHome && consecutiveHome >= 3) {
    totalAdj += 0.08;
    factors.push({ factor: 'home_stand', impact: +0.08, note: `${consecutiveHome + 1}-game home stand` });
  }

  // Clamp total adjustment
  totalAdj = Math.max(-0.8, Math.min(0.4, totalAdj));
  
  return {
    adjFactor: +totalAdj.toFixed(3),
    factors,
    daysSinceLast,
    consecutiveRoad,
    consecutiveHome,
    lastGameDate: lastGame.date,
    lastGameCity: lastCity,
    confidence: pastGames.length >= 3 ? 'HIGH' : 'MEDIUM'
  };
}

// ==================== BULLPEN FATIGUE ====================

/**
 * Estimate bullpen fatigue based on recent games
 * Heavy bullpen usage (starter pulled early) in recent games = tired arms
 * 
 * Returns a multiplier for bullpen ERA (> 1.0 = fatigued, < 1.0 = fresh)
 */
async function getBullpenFatigue(teamAbbr) {
  // For now, estimate based on schedule density
  // In the future, we can track actual bullpen innings from box scores
  const schedule = await fetchTeamSchedule(teamAbbr);
  if (!schedule || schedule.length < 3) {
    return { multiplier: 1.0, status: 'FRESH', note: 'Insufficient data' };
  }
  
  const today = new Date().toISOString().split('T')[0];
  const recentGames = schedule
    .filter(g => g.date < today && g.status !== 'STATUS_SCHEDULED')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7); // Last 7 games
  
  if (recentGames.length < 3) {
    return { multiplier: 1.0, status: 'FRESH', note: 'Early in schedule' };
  }
  
  // Count games in last 4 days (high density = more bullpen usage)
  const fourDaysAgo = new Date();
  fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
  const recentDensity = recentGames.filter(g => new Date(g.date) >= fourDaysAgo).length;
  
  // Check for doubleheaders or back-to-back-to-back
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const last3Days = recentGames.filter(g => new Date(g.date) >= threeDaysAgo).length;
  
  let multiplier = 1.0;
  let status = 'FRESH';
  const factors = [];
  
  if (recentDensity >= 4) {
    multiplier += 0.12; // 12% bullpen ERA inflation
    status = 'GASSED';
    factors.push(`${recentDensity} games in 4 days`);
  } else if (recentDensity >= 3) {
    multiplier += 0.06;
    status = 'TIRED';
    factors.push(`${recentDensity} games in 4 days`);
  }
  
  if (last3Days >= 3) {
    multiplier += 0.05;
    if (status === 'FRESH') status = 'SLIGHTLY_TIRED';
    factors.push('No off days in 3 days');
  }
  
  // Check for off days (rest = fresh arms)
  const lastGameDate = new Date(recentGames[0].date);
  const daysSinceLast = Math.round((new Date() - lastGameDate) / (1000 * 60 * 60 * 24));
  
  if (daysSinceLast >= 2) {
    multiplier -= 0.05;
    status = 'RESTED';
    factors.push(`${daysSinceLast} days off`);
  }
  
  multiplier = Math.max(0.90, Math.min(1.25, multiplier));
  
  return {
    multiplier: +multiplier.toFixed(3),
    status,
    factors,
    recentDensity,
    last7Games: recentGames.length
  };
}

// ==================== COMBINED ADJUSTMENT ====================

/**
 * Get complete rest/travel/fatigue package for a matchup
 */
async function getMatchupAdjustments(awayAbbr, homeAbbr, gameDate) {
  const [awayRest, homeRest, awayBullpen, homeBullpen] = await Promise.all([
    getRestTravelAdjustment(awayAbbr, gameDate),
    getRestTravelAdjustment(homeAbbr, gameDate),
    getBullpenFatigue(awayAbbr),
    getBullpenFatigue(homeAbbr)
  ]);
  
  return {
    away: {
      rest: awayRest,
      bullpenFatigue: awayBullpen
    },
    home: {
      rest: homeRest,
      bullpenFatigue: homeBullpen
    },
    summary: {
      awayRestAdj: awayRest.adjFactor,
      homeRestAdj: homeRest.adjFactor,
      awayBullpenMult: awayBullpen.multiplier,
      homeBullpenMult: homeBullpen.multiplier,
      netAdvantage: (homeRest.adjFactor - awayRest.adjFactor).toFixed(3),
      homeBullpenEdge: (awayBullpen.multiplier - homeBullpen.multiplier).toFixed(3)
    }
  };
}

function getStatus() {
  const cachedTeams = Object.keys(scheduleCache).filter(k => k.startsWith('schedule_')).length;
  return {
    service: 'rest-travel',
    version: '1.0',
    cachedTeams,
    totalTeams: 30,
    cacheTTL: '6h'
  };
}

// Load cache on start
loadCache();

module.exports = {
  getRestTravelAdjustment,
  getBullpenFatigue,
  getMatchupAdjustments,
  getDistance,
  getTimezoneShift,
  getStatus,
  TEAM_LOCATIONS
};
