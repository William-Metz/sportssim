/**
 * OD War Room Auto-Sync — SportsSim v107.0
 * ==========================================
 * 🚨 THE MONEY ENGINE: Continuous data refresh for OD
 * 
 * Runs every 30 min from D-2 through game day:
 *   1. Checks The Odds API for live MLB h2h/totals/spreads
 *   2. Pulls ESPN confirmed starters — catches last-minute scratches
 *   3. Pulls 48h weather forecasts for all outdoor venues
 *   4. Detects changes from previous sync
 *   5. Rebuilds playbook cache when significant changes found
 *   6. Logs everything with timestamps for audit trail
 *   7. Returns delta report showing what changed
 *
 * WHY THIS PRINTS MONEY:
 *   - Lines move 2-5% in final 48h as sharps hit opening numbers
 *   - Starter scratches happen 0-6h before first pitch
 *   - Weather forecasts sharpen dramatically in final 24h
 *   - Being first to react to changes = capturing maximum edge
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ==================== DEPENDENCIES ====================
let mlbOpeningDay, odPlaybookCache, weatherService, pitcherKProps;
try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}
try { odPlaybookCache = require('./od-playbook-cache'); } catch(e) {}
try { weatherService = require('./weather-forecast'); } catch(e) {}
try { pitcherKProps = require('./pitcher-k-props'); } catch(e) {}

// ==================== STATE ====================
const SYNC_LOG_FILE = path.join(__dirname, 'od-war-room-log.json');
const SYNC_STATE_FILE = path.join(__dirname, 'od-war-room-state.json');

let syncState = {
  lastSync: null,
  syncCount: 0,
  lastOddsData: null,
  lastPitchers: null,
  lastWeather: null,
  changes: [],
  alerts: [],
};

// Load persisted state
try {
  const saved = JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8'));
  syncState = { ...syncState, ...saved };
} catch(e) { /* fresh state */ }

// ==================== TEAM MAPPINGS ====================
const TEAM_NAME_MAP = {
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

const ABBREV_MAP = {
  'CHW': 'CWS', 'ATH': 'OAK', 'AZ': 'ARI', 'WAS': 'WSH', 
  'TBR': 'TB', 'KCR': 'KC', 'SDP': 'SD', 'SFG': 'SF',
};

function normalizeTeam(t) {
  if (!t) return t;
  if (TEAM_NAME_MAP[t]) return TEAM_NAME_MAP[t];
  const up = t.toUpperCase();
  return ABBREV_MAP[up] || up;
}

// ==================== HTTP HELPER ====================
function fetchJSON(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'SportsSim/107.0' } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('JSON parse: ' + body.slice(0, 100))); }
      });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ==================== 1. LIVE ODDS SYNC ====================
async function syncLiveOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return { error: 'No ODDS_API_KEY', games: [] };
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const data = await fetchJSON(url, 15000);
    
    if (!Array.isArray(data)) return { error: 'Unexpected response', games: [] };
    
    // Filter to OD dates (March 26-27, 2026)
    const odGames = data.filter(g => {
      const d = g.commence_time?.slice(0, 10);
      return d === '2026-03-26' || d === '2026-03-27';
    });
    
    // Parse into our format
    const parsed = odGames.map(g => {
      const away = normalizeTeam(g.away_team);
      const home = normalizeTeam(g.home_team);
      const books = {};
      
      for (const bk of (g.bookmakers || [])) {
        const line = {};
        for (const mkt of (bk.markets || [])) {
          if (mkt.key === 'h2h') {
            const homeOutcome = mkt.outcomes.find(o => o.name === g.home_team);
            const awayOutcome = mkt.outcomes.find(o => o.name === g.away_team);
            if (homeOutcome) line.homeML = homeOutcome.price;
            if (awayOutcome) line.awayML = awayOutcome.price;
          }
          if (mkt.key === 'totals') {
            const over = mkt.outcomes.find(o => o.name === 'Over');
            const under = mkt.outcomes.find(o => o.name === 'Under');
            if (over) { line.total = over.point; line.overOdds = over.price; }
            if (under) line.underOdds = under.price;
          }
          if (mkt.key === 'spreads') {
            const homeSpread = mkt.outcomes.find(o => o.name === g.home_team);
            const awaySpread = mkt.outcomes.find(o => o.name === g.away_team);
            if (homeSpread) { line.homeSpread = homeSpread.point; line.homeSpreadOdds = homeSpread.price; }
            if (awaySpread) { line.awaySpread = awaySpread.point; line.awaySpreadOdds = awaySpread.price; }
          }
        }
        books[bk.title] = line;
      }
      
      return {
        away, home,
        gameKey: `${away}@${home}`,
        date: g.commence_time?.slice(0, 10),
        commenceTime: g.commence_time,
        bookCount: Object.keys(books).length,
        books,
      };
    });
    
    return { games: parsed, total: parsed.length, allMLBGames: data.length };
  } catch (err) {
    return { error: err.message, games: [] };
  }
}

// ==================== 2. ESPN PITCHER SYNC ====================
async function syncPitchers() {
  const results = { day1: [], day2: [], changes: [] };
  
  for (const [dateStr, label] of [['20260326', 'day1'], ['20260327', 'day2']]) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
      const data = await fetchJSON(url);
      
      for (const event of (data.events || [])) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        
        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away) continue;
        
        const homeAbbr = normalizeTeam(home.team?.abbreviation);
        const awayAbbr = normalizeTeam(away.team?.abbreviation);
        const homeSP = home.probables?.[0]?.athlete;
        const awaySP = away.probables?.[0]?.athlete;
        
        const game = {
          away: awayAbbr,
          home: homeAbbr,
          gameKey: `${awayAbbr}@${homeAbbr}`,
          awaySP: awaySP ? awaySP.fullName : 'TBD',
          homeSP: homeSP ? homeSP.fullName : 'TBD',
          venue: comp.venue?.fullName,
          indoor: comp.venue?.indoor || false,
        };
        
        results[label].push(game);
        
        // Check for changes vs our model
        if (mlbOpeningDay) {
          const odGame = mlbOpeningDay.OPENING_DAY_GAMES?.find(
            g => g.away === awayAbbr && g.home === homeAbbr
          );
          if (odGame) {
            if (awaySP && odGame.awaySP !== awaySP.fullName) {
              results.changes.push({
                type: 'STARTER_CHANGE',
                severity: 'HIGH',
                game: game.gameKey,
                side: 'away',
                was: odGame.awaySP,
                now: awaySP.fullName,
                timestamp: new Date().toISOString(),
              });
            }
            if (homeSP && odGame.homeSP !== homeSP.fullName) {
              results.changes.push({
                type: 'STARTER_CHANGE',
                severity: 'HIGH', 
                game: game.gameKey,
                side: 'home',
                was: odGame.homeSP,
                now: homeSP.fullName,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch (err) {
      results[label] = [{ error: err.message }];
    }
  }
  
  return results;
}

// ==================== 3. WEATHER SYNC ====================
async function syncWeather() {
  // Use Open-Meteo for all outdoor OD venues
  const VENUES = {
    'PIT@NYM': { lat: 40.7571, lng: -73.8458, name: 'Citi Field', indoor: false },
    'CWS@MIL': { lat: 43.0282, lng: -87.9712, name: 'American Family Field', indoor: true },
    'WSH@CHC': { lat: 41.9484, lng: -87.6553, name: 'Wrigley Field', indoor: false },
    'MIN@BAL': { lat: 39.2838, lng: -76.6216, name: 'Camden Yards', indoor: false },
    'BOS@CIN': { lat: 39.0975, lng: -84.5064, name: 'Great American Ball Park', indoor: false },
    'LAA@HOU': { lat: 29.7572, lng: -95.3554, name: 'Minute Maid Park', indoor: true },
    'DET@SD': { lat: 32.7076, lng: -117.157, name: 'Petco Park', indoor: false },
    'TEX@PHI': { lat: 39.9061, lng: -75.1665, name: 'Citizens Bank Park', indoor: false },
    'TB@STL': { lat: 38.6226, lng: -90.1928, name: 'Busch Stadium', indoor: false },
    'ARI@LAD': { lat: 34.0739, lng: -118.24, name: 'Dodger Stadium', indoor: false },
    'CLE@SEA': { lat: 47.5914, lng: -122.3325, name: 'T-Mobile Park', indoor: true },
    // Day 2
    'NYY@SF': { lat: 37.7786, lng: -122.3893, name: 'Oracle Park', indoor: false },
    'OAK@TOR': { lat: 43.6414, lng: -79.3894, name: 'Rogers Centre', indoor: true },
    'COL@MIA': { lat: 25.778, lng: -80.2197, name: 'loanDepot park', indoor: true },
    'KC@ATL': { lat: 33.8909, lng: -84.4676, name: 'Truist Park', indoor: false },
  };
  
  const results = [];
  const outdoorVenues = Object.entries(VENUES).filter(([_, v]) => !v.indoor);
  
  for (const [gameKey, venue] of outdoorVenues) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${venue.lat}&longitude=${venue.lng}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,precipitation&forecast_days=5&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York`;
      const data = await fetchJSON(url);
      
      // Find the game-time slot (estimate ~7pm ET for evening, ~1pm for day)
      const gameDate = gameKey.includes('NYY@SF') || gameKey.includes('KC@ATL') || gameKey.includes('COL@MIA') ? '2026-03-27' : '2026-03-26';
      const gameHour = ['PIT@NYM', 'CWS@MIL', 'WSH@CHC'].includes(gameKey) ? 13 : 
                       ['ARI@LAD'].includes(gameKey) ? 20 : 16; // approximate ET hour
      
      const targetTime = `${gameDate}T${String(gameHour).padStart(2, '0')}:00`;
      const hourIdx = data.hourly?.time?.findIndex(t => t === targetTime) || -1;
      
      if (hourIdx >= 0) {
        const temp = data.hourly.temperature_2m[hourIdx];
        const wind = data.hourly.wind_speed_10m[hourIdx];
        const windDir = data.hourly.wind_direction_10m[hourIdx];
        const precipProb = data.hourly.precipitation_probability[hourIdx];
        const precip = data.hourly.precipitation[hourIdx];
        
        results.push({
          gameKey,
          venue: venue.name,
          temp: Math.round(temp),
          wind: Math.round(wind),
          windDir: Math.round(windDir),
          precipProb,
          precip: Math.round(precip * 100) / 100,
          alerts: [
            ...(temp < 40 ? [`🥶 EXTREME COLD: ${Math.round(temp)}°F — heavy UNDER signal`] : []),
            ...(temp < 50 ? [`❄️ Cold: ${Math.round(temp)}°F — mild UNDER lean`] : []),
            ...(wind > 20 ? [`💨 HIGH WIND: ${Math.round(wind)}mph — impacts totals`] : []),
            ...(precipProb > 40 ? [`🌧️ RAIN RISK: ${precipProb}% — potential delay/PPD`] : []),
            ...(precipProb > 70 ? [`🚨 HIGH RAIN RISK: ${precipProb}% — postponement likely`] : []),
          ].filter(Boolean),
          totalsImpact: temp < 45 ? 'STRONG_UNDER' : temp < 55 ? 'LEAN_UNDER' : temp > 85 ? 'LEAN_OVER' : 'NEUTRAL',
        });
      } else {
        results.push({ gameKey, venue: venue.name, error: 'Game-time slot not found in forecast' });
      }
    } catch (err) {
      results.push({ gameKey, venue: venue.name, error: err.message });
    }
  }
  
  return results;
}

// ==================== 4. DETECT CHANGES ====================
function detectChanges(newOdds, prevOdds) {
  const changes = [];
  if (!prevOdds || !newOdds) return changes;
  
  for (const game of newOdds) {
    const prev = prevOdds.find(g => g.gameKey === game.gameKey);
    if (!prev) {
      changes.push({ type: 'NEW_ODDS', game: game.gameKey, bookCount: game.bookCount });
      continue;
    }
    
    // Check DraftKings for line moves (primary book)
    const dkNow = game.books?.['DraftKings'] || game.books?.['FanDuel'];
    const dkPrev = prev.books?.['DraftKings'] || prev.books?.['FanDuel'];
    
    if (dkNow && dkPrev) {
      if (dkNow.homeML && dkPrev.homeML && Math.abs(dkNow.homeML - dkPrev.homeML) >= 10) {
        changes.push({
          type: 'ML_MOVE',
          game: game.gameKey,
          side: 'home',
          was: dkPrev.homeML,
          now: dkNow.homeML,
          move: dkNow.homeML - dkPrev.homeML,
        });
      }
      if (dkNow.total && dkPrev.total && dkNow.total !== dkPrev.total) {
        changes.push({
          type: 'TOTAL_MOVE',
          game: game.gameKey,
          was: dkPrev.total,
          now: dkNow.total,
          move: dkNow.total - dkPrev.total,
        });
      }
    }
  }
  
  return changes;
}

// ==================== 5. MAIN SYNC ====================
async function runSync() {
  const syncStart = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`[War Room Sync] Starting sync #${syncState.syncCount + 1} at ${timestamp}`);
  
  // Run all syncs in parallel
  const [odds, pitchers, weather] = await Promise.all([
    syncLiveOdds().catch(e => ({ error: e.message, games: [] })),
    syncPitchers().catch(e => ({ error: e.message, day1: [], day2: [], changes: [] })),
    syncWeather().catch(e => [{ error: e.message }]),
  ]);
  
  // Detect changes
  const oddsChanges = detectChanges(odds.games, syncState.lastOddsData?.games);
  const pitcherChanges = pitchers.changes || [];
  const allChanges = [...oddsChanges, ...pitcherChanges];
  
  // Weather alerts
  const weatherAlerts = weather
    .filter(w => w.alerts && w.alerts.length > 0)
    .map(w => ({ game: w.gameKey, venue: w.venue, alerts: w.alerts }));
  
  // Determine if playbook cache needs rebuild
  const needsRebuild = (
    (odds.games.length > 0 && (!syncState.lastOddsData || syncState.lastOddsData.games.length === 0)) || // First time getting real odds
    oddsChanges.some(c => c.type === 'ML_MOVE' && Math.abs(c.move) >= 15) || // Significant ML move
    oddsChanges.some(c => c.type === 'TOTAL_MOVE') || // Any total move
    pitcherChanges.length > 0 // Starter change
  );
  
  let cacheRebuilt = false;
  if (needsRebuild && odPlaybookCache && odds.games.length > 0) {
    try {
      // Force rebuild with live odds
      await odPlaybookCache.ensureFresh(true); // force refresh
      cacheRebuilt = true;
      console.log('[War Room Sync] Playbook cache rebuilt with live odds');
    } catch (e) {
      console.error('[War Room Sync] Cache rebuild failed:', e.message);
    }
  }
  
  // Update state
  syncState.lastSync = timestamp;
  syncState.syncCount++;
  if (odds.games.length > 0) syncState.lastOddsData = odds;
  syncState.lastPitchers = { day1: pitchers.day1, day2: pitchers.day2, timestamp };
  syncState.lastWeather = weather;
  syncState.changes = [...(syncState.changes || []).slice(-50), ...allChanges.map(c => ({ ...c, timestamp }))];
  syncState.alerts = weatherAlerts;
  
  // Persist state
  try {
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(syncState, null, 2));
  } catch (e) { /* non-critical */ }
  
  // Log sync
  const logEntry = {
    syncNumber: syncState.syncCount,
    timestamp,
    durationMs: Date.now() - syncStart,
    odds: { gamesFound: odds.games.length, allMLB: odds.total || 0, error: odds.error },
    pitchers: { day1Games: pitchers.day1?.length || 0, day2Games: pitchers.day2?.length || 0, changes: pitcherChanges.length },
    weather: { venuesChecked: weather.length, alerts: weatherAlerts.length },
    changes: allChanges.length,
    cacheRebuilt,
  };
  
  appendLog(logEntry);
  
  console.log(`[War Room Sync] Complete — odds:${odds.games.length}, pitchers:${(pitchers.day1?.length||0)+(pitchers.day2?.length||0)}, weather:${weather.length}, changes:${allChanges.length}, rebuilt:${cacheRebuilt}`);
  
  return {
    sync: logEntry,
    odds,
    pitchers,
    weather,
    changes: allChanges,
    weatherAlerts,
    cacheRebuilt,
    nextSync: '30 minutes',
  };
}

function appendLog(entry) {
  try {
    let log = [];
    try { log = JSON.parse(fs.readFileSync(SYNC_LOG_FILE, 'utf8')); } catch(e) {}
    log.push(entry);
    // Keep last 100 entries
    if (log.length > 100) log = log.slice(-100);
    fs.writeFileSync(SYNC_LOG_FILE, JSON.stringify(log, null, 2));
  } catch(e) { /* non-critical */ }
}

// ==================== 6. COMPREHENSIVE REPORT ====================
function getReport() {
  const now = new Date();
  const od1 = new Date('2026-03-26T17:00:00Z'); // ~1pm ET first game
  const hoursUntilOD = Math.max(0, (od1 - now) / 3600000);
  
  return {
    status: 'WAR ROOM ACTIVE 🦞',
    hoursUntilOD: Math.round(hoursUntilOD * 10) / 10,
    syncState: {
      totalSyncs: syncState.syncCount,
      lastSync: syncState.lastSync,
      nextSync: syncState.lastSync ? new Date(new Date(syncState.lastSync).getTime() + 30 * 60000).toISOString() : 'now',
    },
    liveOdds: {
      available: (syncState.lastOddsData?.games?.length || 0) > 0,
      gamesWithOdds: syncState.lastOddsData?.games?.length || 0,
      lastPull: syncState.lastOddsData?.games?.length > 0 ? syncState.lastSync : null,
    },
    pitchers: {
      day1Confirmed: syncState.lastPitchers?.day1?.filter(g => g.awaySP !== 'TBD' && g.homeSP !== 'TBD').length || 0,
      day1Total: syncState.lastPitchers?.day1?.length || 0,
      day2Confirmed: syncState.lastPitchers?.day2?.filter(g => g.awaySP !== 'TBD' && g.homeSP !== 'TBD').length || 0,
      day2Total: syncState.lastPitchers?.day2?.length || 0,
      tbdGames: [
        ...(syncState.lastPitchers?.day1?.filter(g => g.awaySP === 'TBD' || g.homeSP === 'TBD') || []),
        ...(syncState.lastPitchers?.day2?.filter(g => g.awaySP === 'TBD' || g.homeSP === 'TBD') || []),
      ].map(g => `${g.gameKey}: ${g.awaySP} vs ${g.homeSP}`),
    },
    weather: {
      venues: syncState.lastWeather?.length || 0,
      alerts: syncState.alerts || [],
      postponementRisk: (syncState.lastWeather || []).filter(w => 
        w.alerts?.some(a => a.includes('RAIN RISK') || a.includes('postponement'))
      ).map(w => w.gameKey),
    },
    recentChanges: (syncState.changes || []).slice(-10),
    recommendations: generateRecommendations(),
  };
}

function generateRecommendations() {
  const recs = [];
  const now = new Date();
  const od1 = new Date('2026-03-26T17:00:00Z');
  const hoursUntilOD = (od1 - now) / 3600000;
  
  if (hoursUntilOD < 24 && (!syncState.lastOddsData || syncState.lastOddsData.games.length === 0)) {
    recs.push('🚨 CRITICAL: No live MLB odds found with <24h to OD. Check if The Odds API has posted lines.');
  }
  
  const tbdPitchers = [
    ...(syncState.lastPitchers?.day1?.filter(g => g.awaySP === 'TBD' || g.homeSP === 'TBD') || []),
    ...(syncState.lastPitchers?.day2?.filter(g => g.awaySP === 'TBD' || g.homeSP === 'TBD') || []),
  ];
  if (tbdPitchers.length > 0) {
    recs.push(`⚠️ ${tbdPitchers.length} games still have TBD starters. Monitor ESPN for updates.`);
  }
  
  const weatherRisks = (syncState.lastWeather || []).filter(w => 
    w.alerts?.some(a => a.includes('RAIN RISK'))
  );
  if (weatherRisks.length > 0) {
    recs.push(`🌧️ ${weatherRisks.length} games have rain risk: ${weatherRisks.map(w => w.gameKey).join(', ')}`);
  }
  
  const coldGames = (syncState.lastWeather || []).filter(w => w.temp && w.temp < 50);
  if (coldGames.length > 0) {
    recs.push(`❄️ ${coldGames.length} games under 50°F — strong UNDER signals: ${coldGames.map(w => `${w.gameKey}(${w.temp}°F)`).join(', ')}`);
  }
  
  if (hoursUntilOD > 24 && hoursUntilOD < 48) {
    recs.push('📊 D-2: Lines should start appearing. Key time for early sharp action.');
  }
  
  if (hoursUntilOD < 6) {
    recs.push('🔥 GAME DAY: Lineups posted 2h pre-game. Hit /api/opening-day/live-lines/update after lineups drop.');
  }
  
  return recs;
}

// ==================== 7. AUTO-SYNC TIMER ====================
let syncTimer = null;

function startAutoSync(intervalMs = 30 * 60 * 1000) {
  if (syncTimer) clearInterval(syncTimer);
  
  // Run immediately
  runSync().catch(e => console.error('[War Room Sync] Error:', e.message));
  
  // Then every interval
  syncTimer = setInterval(() => {
    runSync().catch(e => console.error('[War Room Sync] Error:', e.message));
  }, intervalMs);
  
  console.log(`[War Room Sync] Auto-sync started: every ${intervalMs/60000} minutes`);
  return { started: true, interval: `${intervalMs/60000}min` };
}

function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  return { stopped: true };
}

function getAutoSyncStatus() {
  return {
    running: !!syncTimer,
    syncCount: syncState.syncCount,
    lastSync: syncState.lastSync,
  };
}

// ==================== 8. OD ODDS SUMMARY ====================
function getOddsSummary() {
  if (!syncState.lastOddsData || !syncState.lastOddsData.games.length) {
    return { available: false, message: 'No live MLB odds available yet. Lines typically appear 24-48h before game time.' };
  }
  
  const games = syncState.lastOddsData.games;
  const summary = games.map(g => {
    const dk = g.books['DraftKings'] || g.books['FanDuel'] || Object.values(g.books)[0];
    if (!dk) return { game: g.gameKey, noLines: true };
    
    return {
      game: g.gameKey,
      date: g.date,
      homeML: dk.homeML,
      awayML: dk.awayML,
      total: dk.total,
      bookCount: g.bookCount,
      bestHomeML: Math.max(...Object.values(g.books).map(b => b.homeML || -9999).filter(x => x !== -9999)),
      bestAwayML: Math.max(...Object.values(g.books).map(b => b.awayML || -9999).filter(x => x !== -9999)),
    };
  });
  
  return { available: true, games: summary, count: games.length, lastPull: syncState.lastSync };
}

// ==================== EXPORTS ====================
module.exports = {
  runSync,
  syncLiveOdds,
  syncPitchers,
  syncWeather,
  getReport,
  getOddsSummary,
  startAutoSync,
  stopAutoSync,
  getAutoSyncStatus,
  getState: () => syncState,
};
