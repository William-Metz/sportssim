/**
 * MLB Opening Day Weather Forecast Service — SportsSim v55.0
 * 
 * Pre-caches 5-day weather forecasts for ALL March 26-27 Opening Day venues.
 * Uses Open-Meteo hourly forecast API (free, no key required) to get:
 *   - Hourly temp, wind speed/direction, humidity, precipitation probability
 *   - Specific game-time conditions (matched to scheduled first pitch)
 *   - Rain/snow risk assessment for postponement alerts
 *   - Run impact projections using existing weather model
 * 
 * WHY THIS MATTERS FOR $$$ :
 *   - Books set totals 12-24h before first pitch, often before weather updates
 *   - Cold/wind data at game time can swing totals 0.5-1.0 runs
 *   - Rain/delay risk affects F5 unders strategy (bullpen games after delays)
 *   - Wind at Oracle Park (SF) and Wrigley (CHC) = massive run impact
 *   - Getting weather forecasts NOW (5 days out) lets us track trend shifts
 */

const fs = require('fs');
const path = require('path');
const { BALLPARK_COORDS, calculateWeatherImpact } = require('./weather');

const FORECAST_CACHE_FILE = path.join(__dirname, 'weather-forecast-cache.json');
const FORECAST_CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours — forecasts don't change minute-to-minute

// Opening Day schedule — home team = venue
const OPENING_DAY_SCHEDULE = {
  '2026-03-26': [
    { away: 'PIT', home: 'NYM', time: '13:15', timeET: '1:15 PM ET', matchup: 'Skenes vs Peralta' },
    { away: 'CWS', home: 'MIL', time: '14:10', timeET: '2:10 PM ET', matchup: 'Smith vs Misiorowski' },
    { away: 'WSH', home: 'CHC', time: '14:20', timeET: '2:20 PM ET', matchup: 'Cavalli vs Boyd' },
    { away: 'MIN', home: 'BAL', time: '15:05', timeET: '3:05 PM ET', matchup: 'Ryan vs Rogers' },
    { away: 'BOS', home: 'CIN', time: '16:10', timeET: '4:10 PM ET', matchup: 'Crochet vs Abbott' },
    { away: 'LAA', home: 'HOU', time: '16:10', timeET: '4:10 PM ET', matchup: 'Soriano vs Brown' },
    { away: 'DET', home: 'SD',  time: '16:10', timeET: '4:10 PM ET', matchup: 'Skubal vs Cease' },
    { away: 'TB',  home: 'STL', time: '16:15', timeET: '4:15 PM ET', matchup: 'Rasmussen vs Liberatore' },
    { away: 'TEX', home: 'PHI', time: '16:05', timeET: '4:05 PM ET', matchup: 'Eovaldi vs Sanchez' },
    { away: 'ARI', home: 'LAD', time: '20:30', timeET: '8:30 PM ET', matchup: 'Gallen vs Yamamoto' },
    { away: 'CLE', home: 'SEA', time: '22:10', timeET: '10:10 PM ET', matchup: 'Bibee vs Gilbert' },
  ],
  '2026-03-27': [
    { away: 'NYY', home: 'SF',  time: '16:35', timeET: '4:35 PM ET', matchup: 'Cole vs Webb' },
    { away: 'OAK', home: 'TOR', time: '19:07', timeET: '7:07 PM ET', matchup: 'Severino vs Gausman' },
    { away: 'COL', home: 'MIA', time: '19:10', timeET: '7:10 PM ET', matchup: 'Freeland vs Alcantara' },
    { away: 'KC',  home: 'ATL', time: '19:15', timeET: '7:15 PM ET', matchup: 'Ragans vs Sale' },
    // Game 2s of Day 1 series
    { away: 'BOS', home: 'CIN', time: '16:10', timeET: '4:10 PM ET', matchup: 'Gray vs Lodolo', isGame2: true },
    { away: 'LAA', home: 'HOU', time: '20:10', timeET: '8:10 PM ET', matchup: 'Kikuchi vs TBD', isGame2: true },
    { away: 'DET', home: 'SD',  time: '21:40', timeET: '9:40 PM ET', matchup: 'Valdez vs TBD', isGame2: true },
    { away: 'ARI', home: 'LAD', time: '22:10', timeET: '10:10 PM ET', matchup: 'Nelson vs TBD', isGame2: true },
    { away: 'CLE', home: 'SEA', time: '22:10', timeET: '10:10 PM ET', matchup: 'TBD vs TBD', isGame2: true },
  ]
};

// ==================== FORECAST API ====================

/**
 * Fetch hourly forecast from Open-Meteo for a specific date range
 * Returns hourly temp, wind, humidity, precipitation data
 */
async function fetchHourlyForecast(lat, lon, startDate, endDate) {
  try {
    const fetch = (await import('node-fetch')).default;
    const url = `https://api.open-meteo.com/v1/forecast?` +
      `latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,precipitation,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&timezone=America%2FNew_York`;
    
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) {
      console.error(`Forecast fetch failed for ${lat},${lon}: ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    if (!data.hourly) return null;
    
    // Parse hourly data into structured format
    const hours = [];
    for (let i = 0; i < data.hourly.time.length; i++) {
      hours.push({
        time: data.hourly.time[i],
        temp_f: data.hourly.temperature_2m[i],
        humidity: data.hourly.relative_humidity_2m[i],
        wind_mph: data.hourly.wind_speed_10m[i],
        wind_dir: data.hourly.wind_direction_10m[i],
        wind_gusts_mph: data.hourly.wind_gusts_10m[i],
        precip_prob: data.hourly.precipitation_probability[i],
        precip_mm: data.hourly.precipitation[i],
        weather_code: data.hourly.weather_code[i],
      });
    }
    
    return {
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      hours,
      fetchedAt: new Date().toISOString()
    };
  } catch (e) {
    console.error('Forecast fetch failed:', e.message);
    return null;
  }
}

/**
 * Extract game-time conditions from hourly forecast
 * gameTimeET: "16:10" format (hour in ET)
 */
function extractGameTimeConditions(hourlyData, dateStr, gameTimeET) {
  if (!hourlyData || !hourlyData.hours) return null;
  
  // Parse game time — find the matching hour in forecast data
  const [gameHour] = gameTimeET.split(':').map(Number);
  
  // Find hours around game time for that date
  const gameHours = hourlyData.hours.filter(h => {
    const hDate = h.time.split('T')[0];
    const hHour = parseInt(h.time.split('T')[1].split(':')[0]);
    return hDate === dateStr && hHour >= gameHour && hHour <= gameHour + 3;
  });
  
  if (gameHours.length === 0) return null;
  
  // First pitch conditions
  const firstPitch = gameHours[0];
  
  // Average over game duration (roughly 3 hours)
  const avgTemp = gameHours.reduce((s, h) => s + h.temp_f, 0) / gameHours.length;
  const avgWind = gameHours.reduce((s, h) => s + h.wind_mph, 0) / gameHours.length;
  const maxGusts = Math.max(...gameHours.map(h => h.wind_gusts_mph || 0));
  const maxPrecipProb = Math.max(...gameHours.map(h => h.precip_prob || 0));
  const totalPrecip = gameHours.reduce((s, h) => s + (h.precip_mm || 0), 0);
  
  return {
    firstPitch: {
      temp_f: firstPitch.temp_f,
      humidity: firstPitch.humidity,
      wind_mph: firstPitch.wind_mph,
      wind_dir: firstPitch.wind_dir,
      wind_gusts_mph: firstPitch.wind_gusts_mph,
      precip_prob: firstPitch.precip_prob,
      weather_code: firstPitch.weather_code
    },
    gameDuration: {
      avgTemp: +avgTemp.toFixed(1),
      avgWind: +avgWind.toFixed(1),
      maxGusts: +maxGusts.toFixed(1),
      maxPrecipProb,
      totalPrecipMM: +totalPrecip.toFixed(2),
      hoursAnalyzed: gameHours.length
    },
    hours: gameHours
  };
}

/**
 * Assess postponement risk based on forecast
 */
function assessPostponementRisk(conditions) {
  if (!conditions) return { risk: 'unknown', pct: 0, note: 'No forecast data' };
  
  const { firstPitch, gameDuration } = conditions;
  let risk = 0;
  const factors = [];
  
  // Heavy precipitation
  if (gameDuration.maxPrecipProb > 80) {
    risk += 40;
    factors.push(`${gameDuration.maxPrecipProb}% precip probability during game`);
  } else if (gameDuration.maxPrecipProb > 50) {
    risk += 20;
    factors.push(`${gameDuration.maxPrecipProb}% precip probability`);
  } else if (gameDuration.maxPrecipProb > 30) {
    risk += 8;
    factors.push(`${gameDuration.maxPrecipProb}% precip chance (low concern)`);
  }
  
  // Heavy rain accumulation
  if (gameDuration.totalPrecipMM > 5) {
    risk += 30;
    factors.push(`${gameDuration.totalPrecipMM}mm rain expected`);
  } else if (gameDuration.totalPrecipMM > 2) {
    risk += 15;
    factors.push(`${gameDuration.totalPrecipMM}mm rain possible`);
  }
  
  // Snow (weather codes 71-77)
  if (firstPitch.weather_code >= 71 && firstPitch.weather_code <= 77) {
    risk += 50;
    factors.push('Snow in forecast');
  }
  
  // Extreme cold (below 35°F)
  if (firstPitch.temp_f < 32) {
    risk += 20;
    factors.push(`${firstPitch.temp_f}°F — freezing`);
  } else if (firstPitch.temp_f < 38) {
    risk += 5;
    factors.push(`${firstPitch.temp_f}°F — very cold`);
  }
  
  // Extreme wind gusts
  if (gameDuration.maxGusts > 40) {
    risk += 15;
    factors.push(`${gameDuration.maxGusts}mph gusts — safety concern`);
  }
  
  risk = Math.min(risk, 95);
  
  let riskLevel = 'LOW';
  if (risk > 50) riskLevel = 'HIGH';
  else if (risk > 25) riskLevel = 'MODERATE';
  else if (risk > 10) riskLevel = 'SLIGHT';
  
  return {
    risk: riskLevel,
    pct: risk,
    factors,
    note: factors.length > 0 ? factors.join('; ') : 'Clear skies expected'
  };
}

/**
 * Get betting impact analysis for a game's weather conditions
 */
function getBettingImpact(conditions, park) {
  if (!conditions || !park) return null;
  
  const fp = conditions.firstPitch;
  const gd = conditions.gameDuration;
  
  // Use our existing weather impact model with forecast data
  const impact = calculateWeatherImpact({
    temp_f: gd.avgTemp,
    humidity: fp.humidity,
    wind_mph: gd.avgWind,
    wind_dir: fp.wind_dir,
    weather_code: fp.weather_code
  }, park);
  
  // Additional forecast-specific insights
  const insights = [];
  
  // Cold weather → under bias
  if (gd.avgTemp < 50) {
    insights.push({ signal: 'UNDER', strength: gd.avgTemp < 40 ? 'STRONG' : 'MODERATE', 
      note: `${gd.avgTemp}°F avg — dead ball, tight muscles, shorter batting practice` });
  }
  
  // Wind analysis for key parks
  if (park.name === 'Wrigley Field' && gd.avgWind > 12) {
    const dir = fp.wind_dir;
    if (dir >= 180 && dir <= 270) {
      insights.push({ signal: 'OVER', strength: 'STRONG', 
        note: `Wrigley wind blowing OUT at ${gd.avgWind}mph — famous over spot` });
    } else if (dir >= 0 && dir <= 90) {
      insights.push({ signal: 'UNDER', strength: 'STRONG', 
        note: `Wrigley wind blowing IN from lake at ${gd.avgWind}mph — suppress offense` });
    }
  }
  
  if (park.name === 'Oracle Park' && gd.avgWind > 10) {
    insights.push({ signal: 'UNDER', strength: 'MODERATE', 
      note: `Oracle Park wind ${gd.avgWind}mph — already a pitchers park, wind compounds` });
  }
  
  // Wind gust impact
  if (gd.maxGusts > 25) {
    insights.push({ signal: 'VOLATILITY', strength: 'MODERATE',
      note: `${gd.maxGusts}mph gusts — flyball chaos, error potential, F5 under value` });
  }
  
  // Rain delay potential → bullpen games
  if (gd.maxPrecipProb > 40) {
    insights.push({ signal: 'F5_UNDER', strength: gd.maxPrecipProb > 60 ? 'STRONG' : 'MODERATE',
      note: `${gd.maxPrecipProb}% rain risk → potential delay, bullpen games, F5 under` });
  }
  
  return {
    ...impact,
    forecastInsights: insights,
    gameTimeTemp: gd.avgTemp,
    gameTimeWind: gd.avgWind,
    maxGusts: gd.maxGusts,
    precipRisk: gd.maxPrecipProb
  };
}

// ==================== CACHE ====================

let forecastCache = {};

function loadCache() {
  try {
    if (fs.existsSync(FORECAST_CACHE_FILE)) {
      forecastCache = JSON.parse(fs.readFileSync(FORECAST_CACHE_FILE, 'utf8'));
    }
  } catch (e) { forecastCache = {}; }
}

function saveCache() {
  try {
    fs.writeFileSync(FORECAST_CACHE_FILE, JSON.stringify(forecastCache, null, 2));
  } catch (e) { console.error('Forecast cache save failed:', e.message); }
}

// ==================== MAIN FUNCTIONS ====================

/**
 * Pre-cache all Opening Day venue forecasts
 * This is the key function — run it daily to track forecast evolution
 */
async function preCheckOpeningDayWeather() {
  const startTime = Date.now();
  const results = {
    fetchedAt: new Date().toISOString(),
    forecastDaysOut: null,
    venues: [],
    alerts: [],
    bettingInsights: [],
    summary: {}
  };
  
  // Calculate days until Opening Day
  const odDate = new Date('2026-03-26T12:00:00-04:00');
  const now = new Date();
  results.forecastDaysOut = Math.ceil((odDate - now) / (1000 * 60 * 60 * 24));
  
  // Collect all unique home venues across both days
  const allGames = [];
  for (const [date, games] of Object.entries(OPENING_DAY_SCHEDULE)) {
    for (const game of games) {
      allGames.push({ ...game, date });
    }
  }
  
  // Fetch forecasts for all venues in parallel
  const venueForecasts = {};
  const uniqueVenues = [...new Set(allGames.map(g => g.home))];
  
  const fetchPromises = uniqueVenues.map(async (teamAbbr) => {
    const park = BALLPARK_COORDS[teamAbbr];
    if (!park) return;
    
    // Check cache
    const cacheKey = `forecast_${teamAbbr}_2026-03-26`;
    if (forecastCache[cacheKey] && (Date.now() - new Date(forecastCache[cacheKey].fetchedAt).getTime()) < FORECAST_CACHE_TTL) {
      venueForecasts[teamAbbr] = forecastCache[cacheKey];
      return;
    }
    
    // Fetch fresh forecast
    const forecast = await fetchHourlyForecast(park.lat, park.lon, '2026-03-26', '2026-03-28');
    if (forecast) {
      venueForecasts[teamAbbr] = forecast;
      forecastCache[cacheKey] = forecast;
    }
  });
  
  await Promise.all(fetchPromises);
  saveCache();
  
  // Process each game
  let coldGames = 0, windyGames = 0, rainRiskGames = 0, domeGames = 0;
  let underSignals = 0, overSignals = 0;
  
  for (const game of allGames) {
    const park = BALLPARK_COORDS[game.home];
    if (!park) continue;
    
    const venueResult = {
      date: game.date,
      away: game.away,
      home: game.home,
      time: game.timeET,
      matchup: game.matchup,
      isGame2: game.isGame2 || false,
      park: park.name,
      dome: park.dome,
      altitude: park.alt
    };
    
    if (park.dome) {
      domeGames++;
      venueResult.forecast = null;
      venueResult.conditions = 'DOME — weather irrelevant';
      venueResult.postponementRisk = { risk: 'NONE', pct: 0, note: 'Indoor/retractable roof' };
      venueResult.bettingImpact = { multiplier: 1.0, totalImpact: 0, description: 'Neutral (dome)', forecastInsights: [] };
      results.venues.push(venueResult);
      continue;
    }
    
    // Get forecast for this venue
    const forecast = venueForecasts[game.home];
    if (!forecast) {
      venueResult.forecast = null;
      venueResult.conditions = 'Forecast unavailable';
      venueResult.postponementRisk = { risk: 'unknown', pct: 0, note: 'No forecast data' };
      venueResult.bettingImpact = null;
      results.venues.push(venueResult);
      continue;
    }
    
    // Extract game-time conditions
    const conditions = extractGameTimeConditions(forecast, game.date, game.time);
    venueResult.forecast = conditions;
    
    // Assess postponement risk
    venueResult.postponementRisk = assessPostponementRisk(conditions);
    
    // Get betting impact
    venueResult.bettingImpact = getBettingImpact(conditions, park);
    
    // Track counts
    if (conditions && conditions.gameDuration) {
      if (conditions.gameDuration.avgTemp < 55) coldGames++;
      if (conditions.gameDuration.avgWind > 12) windyGames++;
      if (conditions.gameDuration.maxPrecipProb > 30) rainRiskGames++;
    }
    
    // Collect betting insights
    if (venueResult.bettingImpact && venueResult.bettingImpact.forecastInsights) {
      for (const insight of venueResult.bettingImpact.forecastInsights) {
        if (insight.signal === 'UNDER' || insight.signal === 'F5_UNDER') underSignals++;
        if (insight.signal === 'OVER') overSignals++;
        results.bettingInsights.push({
          game: `${game.away}@${game.home}`,
          date: game.date,
          ...insight
        });
      }
    }
    
    // Generate alerts
    if (venueResult.postponementRisk.pct > 25) {
      results.alerts.push({
        level: venueResult.postponementRisk.risk,
        game: `${game.away}@${game.home}`,
        date: game.date,
        message: `⚠️ ${venueResult.postponementRisk.note}`,
        park: park.name
      });
    }
    
    if (conditions && conditions.gameDuration && conditions.gameDuration.avgTemp < 45) {
      results.alerts.push({
        level: 'COLD',
        game: `${game.away}@${game.home}`,
        date: game.date,
        message: `🥶 ${conditions.gameDuration.avgTemp}°F at ${park.name} — extreme cold, strong UNDER lean`,
        park: park.name
      });
    }
    
    results.venues.push(venueResult);
  }
  
  // Summary
  results.summary = {
    totalGames: allGames.length,
    outdoorGames: allGames.length - domeGames,
    domeGames,
    coldGames,
    windyGames,
    rainRiskGames,
    underSignals,
    overSignals,
    forecastConfidence: results.forecastDaysOut <= 3 ? 'HIGH' : results.forecastDaysOut <= 5 ? 'MODERATE' : 'LOW',
    keyTakeaway: generateKeyTakeaway(results)
  };
  
  results.durationMs = Date.now() - startTime;
  
  return results;
}

function generateKeyTakeaway(results) {
  const alerts = results.alerts || [];
  const insights = results.bettingInsights || [];
  
  if (alerts.some(a => a.level === 'HIGH')) {
    return '🚨 POSTPONEMENT RISK — monitor closely. Rain/weather could alter the slate.';
  }
  if (insights.filter(i => i.signal === 'UNDER' || i.signal === 'F5_UNDER').length >= 3) {
    return '🥶 Multiple UNDER signals — Opening Day cold/wind pattern favors F5 unders heavily.';
  }
  if (insights.filter(i => i.signal === 'OVER').length >= 2) {
    return '🔥 Surprise OVER conditions at multiple venues — check wind patterns.';
  }
  return '⚖️ Mixed conditions across venues — check individual game breakdowns.';
}

/**
 * Quick weather snapshot for a specific game
 */
async function getGameForecast(homeTeam, date, gameTime) {
  const park = BALLPARK_COORDS[homeTeam.toUpperCase()];
  if (!park) return { error: `Unknown team: ${homeTeam}` };
  
  if (park.dome) {
    return { team: homeTeam, park: park.name, dome: true, conditions: 'Indoor', impact: { multiplier: 1.0 } };
  }
  
  const forecast = await fetchHourlyForecast(park.lat, park.lon, date, date);
  if (!forecast) return { error: 'Forecast unavailable' };
  
  const conditions = extractGameTimeConditions(forecast, date, gameTime);
  const postponement = assessPostponementRisk(conditions);
  const betting = getBettingImpact(conditions, park);
  
  return {
    team: homeTeam,
    park: park.name,
    dome: false,
    conditions,
    postponementRisk: postponement,
    bettingImpact: betting
  };
}

function getStatus() {
  const cacheKeys = Object.keys(forecastCache);
  return {
    service: 'weather-forecast',
    version: '1.0',
    cachedForecasts: cacheKeys.length,
    cacheTTL: `${FORECAST_CACHE_TTL / 3600000}h`,
    openingDayGames: Object.values(OPENING_DAY_SCHEDULE).flat().length,
    outdoorVenues: Object.entries(BALLPARK_COORDS).filter(([_, p]) => !p.dome).length
  };
}

// Load cache on start
loadCache();

module.exports = {
  preCheckOpeningDayWeather,
  getGameForecast,
  getStatus,
  fetchHourlyForecast,
  extractGameTimeConditions,
  assessPostponementRisk,
  getBettingImpact,
  OPENING_DAY_SCHEDULE
};
