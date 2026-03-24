/**
 * OD D-0 Morning Protocol v124.0
 * =================================
 * 
 * The GAME DAY morning automation. Run this at 8-9 AM ET on March 26.
 * 
 * Does everything in ONE call:
 *   1. Pull fresh weather for all outdoor OD venues (Open-Meteo, free)
 *   2. Check lineup status (MLB Stats API)
 *   3. Pull latest live odds
 *   4. Run model predictions
 *   5. Generate actionable betting card
 *   6. Check system health
 *   7. Produce executive summary with GO/WARN/FAIL
 * 
 * ENDPOINT:
 *   GET /api/od/morning-protocol  — Full morning checklist + card
 */

const https = require('https');

// Safe imports
let mlbModel = null;
let weatherService = null;
let quickCard = null;
let lineupBridge = null;

try { mlbModel = require('../models/mlb'); } catch(e) {}
try { weatherService = require('./weather'); } catch(e) {}
try { quickCard = require('./od-quick-card'); } catch(e) {}
try { lineupBridge = require('./lineup-bridge'); } catch(e) {}

// ==================== WEATHER CHECK ====================
async function checkWeather(schedule) {
  const results = [];
  
  for (const game of schedule) {
    if (!game.outdoor) {
      results.push({
        gameKey: `${game.away}@${game.home}`,
        venue: game.venue,
        indoor: true,
        status: '🟢 DOME',
      });
      continue;
    }
    
    // Try to get weather from our weather service
    let weather = null;
    try {
      if (weatherService && weatherService.getWeatherForVenue) {
        weather = await weatherService.getWeatherForVenue(game.venue);
      } else if (weatherService && weatherService.getWeather) {
        weather = await weatherService.getWeather(game.home);
      }
    } catch(e) {}
    
    // Also try Open-Meteo direct for the most critical data
    if (!weather) {
      weather = await fetchOpenMeteoQuick(game.venue);
    }
    
    const result = {
      gameKey: `${game.away}@${game.home}`,
      venue: game.venue,
      indoor: false,
    };
    
    if (weather) {
      result.tempF = weather.tempF || weather.temperature;
      result.windMph = weather.windMph || weather.windSpeed;
      result.precipProb = weather.precipProb || weather.precipitation;
      result.humidity = weather.humidity;
      result.conditions = weather.conditions || weather.description;
      
      // Risk assessment
      const flags = [];
      if (result.tempF && result.tempF < 40) flags.push(`🥶 EXTREME COLD ${result.tempF}°F`);
      else if (result.tempF && result.tempF < 50) flags.push(`❄️ Cold ${result.tempF}°F`);
      if (result.windMph && result.windMph > 20) flags.push(`💨 HIGH WIND ${result.windMph}mph`);
      else if (result.windMph && result.windMph > 12) flags.push(`🌬️ Wind ${result.windMph}mph`);
      if (result.precipProb && result.precipProb > 50) flags.push(`🌧️ RAIN RISK ${result.precipProb}%`);
      else if (result.precipProb && result.precipProb > 25) flags.push(`☁️ Rain chance ${result.precipProb}%`);
      
      if (result.precipProb && result.precipProb > 70) {
        result.status = '🔴 POSTPONEMENT RISK';
      } else if (flags.length >= 2 || (result.tempF && result.tempF < 40)) {
        result.status = '🟡 WARN';
      } else {
        result.status = '🟢 CLEAR';
      }
      
      result.flags = flags;
      result.bettingImpact = getBettingWeatherImpact(result);
    } else {
      result.status = '⚪ NO DATA';
      result.note = 'Weather service unavailable — check manually';
    }
    
    results.push(result);
  }
  
  return results;
}

function getBettingWeatherImpact(wx) {
  const impacts = [];
  if (wx.tempF && wx.tempF < 45) impacts.push('UNDER lean — cold suppresses offense');
  if (wx.windMph && wx.windMph > 15) impacts.push('Wind affects totals — check direction');
  if (wx.precipProb && wx.precipProb > 30) impacts.push('Rain risk — F5 bets safer than full game');
  if (wx.tempF && wx.tempF > 80) impacts.push('OVER lean — warm weather boosts offense');
  return impacts.length > 0 ? impacts : ['No significant weather impact'];
}

// Park coordinates for Open-Meteo
const PARK_COORDS = {
  'Citi Field': { lat: 40.757, lon: -73.846 },
  'Wrigley Field': { lat: 41.948, lon: -87.656 },
  'Camden Yards': { lat: 39.284, lon: -76.622 },
  'Great American Ball Park': { lat: 39.097, lon: -84.507 },
  'Dodger Stadium': { lat: 34.074, lon: -118.240 },
  'Truist Park': { lat: 33.891, lon: -84.468 },
  'Petco Park': { lat: 32.707, lon: -117.157 },
  'Busch Stadium': { lat: 38.623, lon: -90.193 },
  'Angel Stadium': { lat: 33.800, lon: -117.883 },
  'T-Mobile Park': { lat: 47.591, lon: -122.333 },
};

async function fetchOpenMeteoQuick(venue) {
  const coords = PARK_COORDS[venue];
  if (!coords) return null;
  
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,windspeed_10m,precipitation_probability,relative_humidity_2m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America/New_York&forecast_days=2`;
    
    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 8000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    
    if (data.hourly) {
      // Find the game-time hour (roughly 14:00-16:00 local)
      const gameHourIndex = data.hourly.time.findIndex(t => {
        const h = new Date(t).getHours();
        return h >= 13 && h <= 17;
      });
      const idx = gameHourIndex >= 0 ? gameHourIndex : 14; // Default to 2pm
      
      return {
        tempF: data.hourly.temperature_2m[idx],
        windMph: data.hourly.windspeed_10m[idx],
        precipProb: data.hourly.precipitation_probability[idx],
        humidity: data.hourly.relative_humidity_2m ? data.hourly.relative_humidity_2m[idx] : null,
      };
    }
    return null;
  } catch(e) {
    return null;
  }
}

// ==================== LINEUP CHECK ====================
async function checkLineups(schedule) {
  const results = [];
  
  for (const game of schedule) {
    const gameKey = `${game.away}@${game.home}`;
    let status = 'PENDING';
    let awayLineup = null;
    let homeLineup = null;
    
    try {
      if (lineupBridge && lineupBridge.getLineup) {
        awayLineup = await lineupBridge.getLineup(game.away);
        homeLineup = await lineupBridge.getLineup(game.home);
      }
    } catch(e) {}
    
    if (awayLineup && homeLineup) {
      status = '🟢 CONFIRMED';
    } else if (awayLineup || homeLineup) {
      status = '🟡 PARTIAL';
    } else {
      status = '⚪ PENDING';
    }
    
    results.push({
      gameKey,
      status,
      awayLineup: awayLineup ? `${awayLineup.length || '?'} batters` : 'Not posted',
      homeLineup: homeLineup ? `${homeLineup.length || '?'} batters` : 'Not posted',
      note: status === '⚪ PENDING' ? 'Lineups typically posted ~2hr before first pitch' : null,
    });
  }
  
  return results;
}

// ==================== SYSTEM HEALTH ====================
function checkSystemHealth() {
  const checks = [];
  
  // Model check
  try {
    if (mlbModel) {
      const test = mlbModel.predict('NYY', 'BOS');
      checks.push({ name: 'MLB Model', status: test ? '🟢 OK' : '🔴 FAIL', detail: test ? `Test: NYY ${Math.round((test.awayWinProb || test.awayWin || 0.5) * 100)}%` : 'No prediction returned' });
    } else {
      checks.push({ name: 'MLB Model', status: '🔴 NOT LOADED' });
    }
  } catch(e) {
    checks.push({ name: 'MLB Model', status: '🔴 ERROR', detail: e.message });
  }
  
  // Quick Card check
  checks.push({ name: 'Quick Card', status: quickCard ? '🟢 LOADED' : '🔴 NOT LOADED' });
  checks.push({ name: 'Weather Service', status: weatherService ? '🟢 LOADED' : '🟡 FALLBACK (Open-Meteo direct)' });
  checks.push({ name: 'Lineup Bridge', status: lineupBridge ? '🟢 LOADED' : '🟡 NOT LOADED' });
  
  // Memory check
  const mem = process.memoryUsage();
  const rss = Math.round(mem.rss / 1024 / 1024);
  const heap = Math.round(mem.heapUsed / 1024 / 1024);
  checks.push({ 
    name: 'Memory', 
    status: rss > 1500 ? '🔴 HIGH' : rss > 1000 ? '🟡 ELEVATED' : '🟢 OK',
    detail: `RSS: ${rss}MB, Heap: ${heap}MB`,
  });
  
  return checks;
}

// ==================== MAIN PROTOCOL ====================
async function runMorningProtocol() {
  const startTime = Date.now();
  const now = new Date();
  
  const allGames = [...(quickCard?.OD_DAY1 || []), ...(quickCard?.OD_DAY2 || [])];
  const d1Games = quickCard?.OD_DAY1 || [];
  const firstPitch = new Date('2026-03-26T17:10:00Z');
  const hoursToFirstPitch = (firstPitch - now) / (1000 * 60 * 60);
  
  // Run all checks in parallel
  const [weatherResults, lineupResults, card] = await Promise.all([
    checkWeather(d1Games).catch(e => [{ error: e.message }]),
    checkLineups(d1Games).catch(e => [{ error: e.message }]),
    quickCard ? quickCard.generateQuickCard({ day: 1 }).catch(e => ({ error: e.message })) : { error: 'Quick card not loaded' },
  ]);
  
  const systemHealth = checkSystemHealth();
  
  // Overall assessment
  const weatherRisk = weatherResults.filter(w => w.status === '🔴 POSTPONEMENT RISK');
  const weatherWarn = weatherResults.filter(w => w.status === '🟡 WARN');
  const systemFails = systemHealth.filter(c => c.status.includes('🔴'));
  
  let overallStatus = '🟢 GO';
  if (systemFails.length > 0) overallStatus = '🔴 SYSTEM ISSUES';
  else if (weatherRisk.length > 0) overallStatus = '🟡 WEATHER RISK';
  else if (weatherWarn.length >= 3) overallStatus = '🟡 MULTIPLE WEATHER WARNINGS';
  
  const buildMs = Date.now() - startTime;
  
  return {
    protocol: 'OD D-0 Morning Protocol v124.0',
    generated: now.toISOString(),
    buildMs,
    overallStatus,
    countdown: {
      firstPitch: 'PIT@NYM — March 26 1:10 PM ET',
      hoursToFirstPitch: Math.round(hoursToFirstPitch * 10) / 10,
      status: hoursToFirstPitch < 0 ? '🔴 GAMES IN PROGRESS' : hoursToFirstPitch < 4 ? '🟡 FINAL PREP' : '🟢 TIME TO PREPARE',
    },
    systemHealth,
    weather: {
      summary: `${weatherResults.filter(w => w.status === '🟢 CLEAR' || w.status === '🟢 DOME').length}/${weatherResults.length} clear, ${weatherWarn.length} warnings, ${weatherRisk.length} postponement risk`,
      venues: weatherResults,
    },
    lineups: {
      summary: `${lineupResults.filter(l => l.status === '🟢 CONFIRMED').length}/${lineupResults.length} confirmed`,
      note: 'Lineups are typically posted 2-3 hours before game time',
      games: lineupResults,
    },
    bettingCard: card.error ? { error: card.error } : {
      totalPlays: card.portfolio?.totalPlays || 0,
      smashCount: card.portfolio?.smashCount || 0,
      strongCount: card.portfolio?.strongCount || 0,
      totalWager: card.portfolio?.totalWager || 0,
      totalEV: card.portfolio?.totalEV || 0,
      roi: card.portfolio?.roi || 'N/A',
      oddsSource: card.oddsSource,
      topPlays: (card.tiers?.smash || []).concat(card.tiers?.strong || []).slice(0, 10).map(p => ({
        gameKey: p.gameKey,
        pick: p.pick,
        edge: p.edge + '%',
        grade: p.grade,
        wager: '$' + (p.wager || 0),
        bestBook: p.bestBook,
      })),
    },
    actionItems: generateActionItems(hoursToFirstPitch, weatherResults, lineupResults, card),
  };
}

function generateActionItems(hoursToFP, weather, lineups, card) {
  const items = [];
  
  if (hoursToFP > 6) {
    items.push({ priority: 'P1', action: 'Wait for lineups to be posted (~2hr before first pitch)', deadline: '~11:00 AM ET' });
    items.push({ priority: 'P2', action: 'Monitor weather forecasts — update may change', deadline: 'Throughout morning' });
  }
  
  if (hoursToFP > 2 && hoursToFP <= 6) {
    items.push({ priority: 'P0', action: 'Place SMASH tier bets NOW — edges decay as game approaches', deadline: 'ASAP' });
    items.push({ priority: 'P1', action: 'Wait for lineups before STRONG tier bets', deadline: '~11:00 AM ET' });
  }
  
  if (hoursToFP <= 2) {
    items.push({ priority: 'P0', action: 'EXECUTE ALL remaining bets — lineups should be confirmed', deadline: 'Before first pitch' });
    items.push({ priority: 'P0', action: 'Check /api/od/quick-card for latest edge calculations', deadline: 'NOW' });
  }
  
  const weatherRisks = weather.filter(w => w.status === '🔴 POSTPONEMENT RISK');
  for (const wr of weatherRisks) {
    items.push({ priority: 'P0', action: `⚠️ ${wr.gameKey} has postponement risk — AVOID full game bets, F5 only if playing`, deadline: 'Monitor closely' });
  }
  
  const pendingLineups = lineups.filter(l => l.status === '⚪ PENDING');
  if (pendingLineups.length > 0) {
    items.push({ priority: 'P1', action: `${pendingLineups.length} games still missing lineups — hold STRONG/LEAN bets until confirmed`, deadline: '~2hr before game time' });
  }
  
  if (card.portfolio && card.portfolio.smashCount > 0) {
    items.push({ priority: 'P0', action: `Place ${card.portfolio.smashCount} SMASH plays FIRST — highest conviction, most edge`, deadline: 'Early morning' });
  }
  
  items.push({ priority: 'P2', action: 'Refresh /api/od/quick-card periodically — odds change', deadline: 'Ongoing' });
  
  return items.sort((a, b) => a.priority.localeCompare(b.priority));
}

module.exports = {
  runMorningProtocol,
  checkWeather,
  checkLineups,
  checkSystemHealth,
};
