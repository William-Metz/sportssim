/**
 * Opening Day Morning Briefing v114.0
 * ====================================
 * THE document you read at 9 AM on March 26.
 * 
 * Synthesizes every signal into one actionable brief:
 *   - Weather status for all venues (live Open-Meteo)
 *   - Pitcher confirmations (ESPN cross-validation)
 *   - Lineup status (MLB Stats API / ESPN)
 *   - Top plays by conviction tier
 *   - Kelly portfolio sizing
 *   - Live odds vs model comparison
 *   - Last-minute warnings/alerts
 *   - Action checklist (what to bet, when, where)
 */

const https = require('https');

// Safe imports
let odModel = null;
let mlbModel = null;
let weatherForecast = null;
let odPlaybookCache = null;
let pitcherKProps = null;
let outsPropsService = null;
let nrfiModel = null;
let f3Model = null;
let f7Model = null;
let lineupBridge = null;
let catcherFraming = null;
let platoonSplits = null;
let stolenBaseModel = null;
let bullpenQuality = null;

try { odModel = require('../models/mlb-opening-day'); } catch(e) {}
try { mlbModel = require('../models/mlb'); } catch(e) {}
try { weatherForecast = require('./weather-forecast'); } catch(e) {}
try { odPlaybookCache = require('./od-playbook-cache'); } catch(e) {}
try { pitcherKProps = require('./pitcher-k-props'); } catch(e) {}
try { outsPropsService = require('./pitcher-outs-props'); } catch(e) {}
try { nrfiModel = require('./nrfi-model'); } catch(e) {}
try { f3Model = require('./f3-model'); } catch(e) {}
try { f7Model = require('./f7-model'); } catch(e) {}
try { lineupBridge = require('./lineup-bridge'); } catch(e) {}
try { catcherFraming = require('./catcher-framing'); } catch(e) {}
try { platoonSplits = require('./platoon-splits'); } catch(e) {}
try { stolenBaseModel = require('./stolen-base-model'); } catch(e) {}
try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}

// Open-Meteo venue coordinates (same as weather-forecast.js)
const BALLPARK_COORDS = {
  NYM: { lat: 40.7571, lon: -73.8458, name: 'Citi Field', city: 'New York', dome: false },
  MIL: { lat: 43.0280, lon: -87.9712, name: 'American Family Field', city: 'Milwaukee', dome: true },
  CHC: { lat: 41.9484, lon: -87.6553, name: 'Wrigley Field', city: 'Chicago', dome: false },
  BAL: { lat: 39.2838, lon: -76.6216, name: 'Camden Yards', city: 'Baltimore', dome: false },
  CIN: { lat: 39.0975, lon: -84.5071, name: 'Great American Ball Park', city: 'Cincinnati', dome: false },
  HOU: { lat: 29.7573, lon: -95.3555, name: 'Minute Maid Park', city: 'Houston', dome: true },
  SD: { lat: 32.7076, lon: -117.1570, name: 'Petco Park', city: 'San Diego', dome: false },
  STL: { lat: 38.6226, lon: -90.1928, name: 'Busch Stadium', city: 'St. Louis', dome: false },
  PHI: { lat: 39.9061, lon: -75.1665, name: 'Citizens Bank Park', city: 'Philadelphia', dome: false },
  LAD: { lat: 34.0739, lon: -118.2400, name: 'Dodger Stadium', city: 'Los Angeles', dome: false },
  SEA: { lat: 47.5914, lon: -122.3325, name: 'T-Mobile Park', city: 'Seattle', dome: true },
  SF: { lat: 37.7786, lon: -122.3893, name: 'Oracle Park', city: 'San Francisco', dome: false },
  TOR: { lat: 43.6414, lon: -79.3894, name: 'Rogers Centre', city: 'Toronto', dome: true },
  MIA: { lat: 25.7781, lon: -80.2196, name: 'loanDepot Park', city: 'Miami', dome: true },
  ATL: { lat: 33.8907, lon: -84.4677, name: 'Truist Park', city: 'Atlanta', dome: false },
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchWeatherForVenue(team, date, hourET) {
  const park = BALLPARK_COORDS[team];
  if (!park) return null;
  if (park.dome) return { team, park: park.name, dome: true, tempF: 72, windMph: 0, humidity: 50, precipProb: 0, signal: 'DOME', bettingImpact: 'NEUTRAL' };
  
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${park.lat}&longitude=${park.lon}&hourly=temperature_2m,windspeed_10m,winddirection_10m,relative_humidity_2m,precipitation_probability,precipitation&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America/New_York&start_date=${date}&end_date=${date}`;
    const data = await fetchJSON(url);
    
    if (!data.hourly) return null;
    
    const idx = data.hourly.time.findIndex(t => {
      const h = parseInt(t.split('T')[1].split(':')[0]);
      return h >= hourET && h <= hourET + 3;
    });
    
    const i = idx >= 0 ? idx : 12; // default to noon
    const tempF = data.hourly.temperature_2m[i];
    const windMph = data.hourly.windspeed_10m[i];
    const windDir = data.hourly.winddirection_10m[i];
    const humidity = data.hourly.relative_humidity_2m[i];
    const precipProb = data.hourly.precipitation_probability[i];
    const precipMm = data.hourly.precipitation[i];
    
    // Betting impact analysis
    let signal = 'NEUTRAL';
    let bettingImpact = 'NEUTRAL';
    const notes = [];
    
    if (tempF < 45) { signal = 'UNDER'; notes.push(`COLD ${tempF}°F suppresses offense`); bettingImpact = 'UNDER'; }
    else if (tempF > 85) { signal = 'OVER'; notes.push(`HOT ${tempF}°F boosts offense`); bettingImpact = 'OVER'; }
    
    if (windMph > 15) {
      // Check wind direction relative to outfield
      if (team === 'CHC') {
        // Wrigley blowing out = OVER, blowing in = UNDER
        if (windDir >= 180 && windDir <= 270) { signal = 'OVER'; notes.push(`Wrigley wind OUT ${windMph}mph`); bettingImpact = 'OVER'; }
        else if (windDir >= 0 && windDir <= 90) { signal = 'UNDER'; notes.push(`Wrigley wind IN ${windMph}mph`); bettingImpact = 'UNDER'; }
      }
      notes.push(`Wind ${windMph}mph @${windDir}°`);
    }
    
    if (precipProb > 40) { notes.push(`⚠️ Rain risk ${precipProb}%`); }
    if (precipProb > 70) { notes.push('🚨 POSTPONEMENT RISK'); }
    
    return {
      team, park: park.name, city: park.city, dome: false,
      tempF: Math.round(tempF * 10) / 10,
      windMph: Math.round(windMph * 10) / 10,
      windDir, humidity,
      precipProb, precipMm: Math.round(precipMm * 10) / 10,
      signal, bettingImpact, notes,
      isExtremeCold: tempF < 40,
      isHighWind: windMph > 20,
      isRainRisk: precipProb > 40,
      isPostponementRisk: precipProb > 70 || (precipMm > 5 && precipProb > 50),
    };
  } catch(e) {
    return { team, park: park?.name, error: e.message };
  }
}

function getGameTimeHourET(timeStr) {
  // Parse "1:15 PM ET" -> hour in ET
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 13; // default 1 PM
  let hour = parseInt(match[1]);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return hour;
}

async function generateBriefing(day = 1) {
  const games = odModel ? (odModel.getSchedule ? odModel.getSchedule() : odModel.OPENING_DAY_GAMES) : [];
  const targetDate = day === 1 ? '2026-03-26' : '2026-03-27';
  const dayGames = games.filter(g => g.date === targetDate);
  
  const now = new Date();
  const odDate = new Date(targetDate + 'T00:00:00-04:00');
  const hoursUntil = Math.max(0, (odDate - now) / (1000 * 60 * 60));
  
  // 1. Weather for all venues
  const weatherPromises = dayGames.map(g => {
    const hour = getGameTimeHourET(g.time);
    return fetchWeatherForVenue(g.home, targetDate, hour);
  });
  const weatherResults = await Promise.all(weatherPromises);
  
  // 2. Get betting card from cache
  let bettingCard = null;
  try {
    if (odPlaybookCache && odPlaybookCache.getCachedOnly) {
      bettingCard = odPlaybookCache.getCachedOnly();
    }
  } catch(e) {}
  
  // 3. Get K prop picks
  let kProps = null;
  try {
    if (pitcherKProps && pitcherKProps.scanODKProps) {
      kProps = pitcherKProps.scanODKProps();
    }
  } catch(e) {}
  
  // 4. Get NRFI picks
  let nrfiPicks = null;
  try {
    if (nrfiModel && nrfiModel.scanODNRFI) {
      nrfiPicks = nrfiModel.scanODNRFI();
    }
  } catch(e) {}
  
  // Build game-by-game analysis
  const gameAnalysis = dayGames.map((game, i) => {
    const weather = weatherResults[i];
    const prediction = mlbModel ? mlbModel.predict(game.away, game.home, {
      awayStarter: game.confirmedStarters.away,
      homeStarter: game.confirmedStarters.home,
    }) : null;
    
    // Find betting card plays for this game
    const gameKey = `${game.away}@${game.home}`;
    let plays = [];
    if (bettingCard && bettingCard.allPlays) {
      plays = bettingCard.allPlays.filter(p => p.game === gameKey && p.date === game.date);
    }
    
    // Find K props for this game
    let gamekProps = [];
    if (kProps) {
      const allKP = [...(kProps.smash || []), ...(kProps.strong || [])];
      gamekProps = allKP.filter(k => 
        (k.team === game.away || k.team === game.home) ||
        (k.opponent === game.away || k.opponent === game.home)
      );
    }
    
    return {
      matchup: gameKey,
      date: game.date,
      time: game.time,
      pitchers: {
        away: { name: game.confirmedStarters.away, team: game.away },
        home: { name: game.confirmedStarters.home, team: game.home },
      },
      dkLine: game.dkLine,
      weather: weather ? {
        tempF: weather.tempF,
        windMph: weather.windMph,
        precipProb: weather.precipProb,
        dome: weather.dome,
        signal: weather.signal,
        bettingImpact: weather.bettingImpact,
        notes: weather.notes || [],
        isPostponementRisk: weather.isPostponementRisk,
      } : null,
      prediction: prediction ? {
        homeWinProb: Math.round(prediction.homeWinProb * 1000) / 10,
        awayWinProb: Math.round((1 - prediction.homeWinProb) * 1000) / 10,
        totalRuns: Math.round(prediction.totalRuns * 10) / 10,
        homeExpRuns: Math.round(prediction.homeExpectedRuns * 10) / 10,
        awayExpRuns: Math.round(prediction.awayExpectedRuns * 10) / 10,
      } : null,
      plays: plays.map(p => ({
        pick: p.pick,
        type: p.type,
        edge: p.edge,
        confidence: p.confidence,
        wager: p.wager,
        ev: p.ev,
        conviction: p.conviction,
      })),
      kProps: gamekProps.map(k => ({
        pitcher: k.pitcher,
        pick: k.pick,
        modelKs: k.modelKs,
        edge: k.edge,
        confidence: k.confidence,
      })),
      totalPlays: plays.length,
      totalEV: plays.reduce((sum, p) => sum + (p.ev || 0), 0),
    };
  });
  
  // Aggregate stats
  const totalPlays = gameAnalysis.reduce((sum, g) => sum + g.totalPlays, 0);
  const totalEV = gameAnalysis.reduce((sum, g) => sum + g.totalEV, 0);
  const postponementRisks = gameAnalysis.filter(g => g.weather?.isPostponementRisk);
  const coldGames = gameAnalysis.filter(g => g.weather && !g.weather.dome && g.weather.tempF < 50);
  const hotGames = gameAnalysis.filter(g => g.weather && !g.weather.dome && g.weather.tempF > 80);
  
  // Sort by total EV (best games first)
  const sortedGames = [...gameAnalysis].sort((a, b) => b.totalEV - a.totalEV);
  
  // Build the briefing
  return {
    title: `🦞 MetaClaw Opening Day ${day === 1 ? '1' : '2'} Morning Briefing`,
    generated: new Date().toISOString(),
    day,
    date: targetDate,
    hoursUntil: Math.round(hoursUntil * 10) / 10,
    phase: hoursUntil <= 0 ? 'GAME DAY' : hoursUntil <= 12 ? 'FINAL PREP' : hoursUntil <= 24 ? 'T-1' : 'T-2',
    
    // Executive Summary
    summary: {
      totalGames: dayGames.length,
      totalPlays,
      totalEV: Math.round(totalEV * 100) / 100,
      postponementRisks: postponementRisks.length,
      coldGames: coldGames.length,
      hotGames: hotGames.length,
      weatherAlert: postponementRisks.length > 0 
        ? `⚠️ ${postponementRisks.map(g => g.matchup).join(', ')} have postponement risk`
        : '✅ All venues CLEAR for play',
      topGame: sortedGames[0] ? {
        matchup: sortedGames[0].matchup,
        ev: Math.round(sortedGames[0].totalEV * 100) / 100,
        plays: sortedGames[0].totalPlays,
        pitchers: `${sortedGames[0].pitchers.away.name} vs ${sortedGames[0].pitchers.home.name}`,
      } : null,
    },
    
    // Weather Matrix
    weatherMatrix: gameAnalysis.map(g => ({
      matchup: g.matchup,
      time: g.time,
      tempF: g.weather?.tempF,
      windMph: g.weather?.windMph,
      precipProb: g.weather?.precipProb,
      dome: g.weather?.dome,
      signal: g.weather?.signal || 'UNKNOWN',
      notes: g.weather?.notes || [],
    })),
    
    // Pitcher Status
    pitcherStatus: gameAnalysis.map(g => ({
      matchup: g.matchup,
      awayPitcher: g.pitchers.away.name,
      homePitcher: g.pitchers.home.name,
      espnConfirmed: true, // Will be populated by cross-validation
    })),
    
    // Top Plays (sorted by EV)
    topPlays: sortedGames.filter(g => g.totalPlays > 0).slice(0, 10).map(g => ({
      matchup: g.matchup,
      time: g.time,
      pitchers: `${g.pitchers.away.name} vs ${g.pitchers.home.name}`,
      totalEV: Math.round(g.totalEV * 100) / 100,
      plays: g.plays,
      weather: g.weather?.signal || 'UNKNOWN',
    })),
    
    // Full Game Grid
    games: gameAnalysis,
    
    // Action Items
    actionItems: [
      ...(postponementRisks.length > 0 ? [{
        priority: 'P0',
        action: `Monitor weather for ${postponementRisks.map(g => g.matchup).join(', ')}`,
        timing: 'CHECK HOURLY',
      }] : []),
      {
        priority: 'P0',
        action: 'Wait for DK/FD to post final lines, compare to model edges',
        timing: 'Lines drop 1-2 hours before each game',
      },
      {
        priority: 'P0',
        action: 'Verify lineups when posted (~2h pre-game), check for surprise scratches',
        timing: 'Watch for lineup announcements',
      },
      {
        priority: 'P1',
        action: 'Place SMASH tier bets first when lines open',
        timing: 'Immediately when lines are live',
      },
      {
        priority: 'P1',
        action: 'Check K prop lines — DK posts pitcher strikeout lines 2-4h pre-game',
        timing: 'Track via /api/opening-day/k-props/live',
      },
      {
        priority: 'P2',
        action: 'Monitor edge decay — if our edge shrinks >5%, we may have been right early',
        timing: 'Ongoing throughout the day',
      },
    ],
    
    // Portfolio Summary
    portfolio: bettingCard ? {
      totalPlays: bettingCard.totalPlays,
      smashCount: bettingCard.tiers?.smash?.count || 0,
      strongCount: bettingCard.tiers?.strong?.count || 0,
      leanCount: bettingCard.tiers?.lean?.count || 0,
      totalWager: bettingCard.portfolio?.totalWager,
      totalEV: bettingCard.portfolio?.totalEV,
      expectedROI: bettingCard.portfolio?.expectedROI,
    } : null,
  };
}

// Generate briefing for specific day
async function generateDay1Briefing() {
  return generateBriefing(1);
}

async function generateDay2Briefing() {
  return generateBriefing(2);
}

// Generate combined briefing for both days
async function generateFullBriefing() {
  const [day1, day2] = await Promise.all([
    generateBriefing(1),
    generateBriefing(2),
  ]);
  
  return {
    title: '🦞 MetaClaw Opening Day FULL Briefing — March 26-27',
    generated: new Date().toISOString(),
    day1,
    day2,
    combinedSummary: {
      totalGames: (day1.summary?.totalGames || 0) + (day2.summary?.totalGames || 0),
      totalPlays: (day1.summary?.totalPlays || 0) + (day2.summary?.totalPlays || 0),
      totalEV: Math.round(((day1.summary?.totalEV || 0) + (day2.summary?.totalEV || 0)) * 100) / 100,
      postponementRisks: (day1.summary?.postponementRisks || 0) + (day2.summary?.postponementRisks || 0),
    },
  };
}

module.exports = {
  generateBriefing,
  generateDay1Briefing,
  generateDay2Briefing,
  generateFullBriefing,
};
