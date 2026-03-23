/**
 * MLB Weather Integration — SportsSim v10.0
 * 
 * Fetches weather data for MLB game locations and adjusts
 * run projections based on wind, temperature, and humidity.
 * 
 * Key factors:
 *   - Wind blowing out increases runs (5-15% at Wrigley, etc.)
 *   - High temperature = more carry = more HRs
 *   - High altitude (Coors) already in park factors, but temp compounds
 *   - Low temperature = dead ball = fewer runs
 *   - Dome/retractable roof stadiums: weather irrelevant when closed
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'weather-cache.json');
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ==================== BALLPARK LOCATIONS ====================

const BALLPARK_COORDS = {
  // Team abbr → { lat, lon, name, dome, altitude_ft }
  ARI: { lat: 33.4455, lon: -112.0667, name: 'Chase Field', dome: true, alt: 1082 },
  ATL: { lat: 33.8907, lon: -84.4677, name: 'Truist Park', dome: false, alt: 1050 },
  BAL: { lat: 39.2838, lon: -76.6218, name: 'Camden Yards', dome: false, alt: 30 },
  BOS: { lat: 42.3467, lon: -71.0972, name: 'Fenway Park', dome: false, alt: 20 },
  CHC: { lat: 41.9484, lon: -87.6553, name: 'Wrigley Field', dome: false, alt: 594 },
  CWS: { lat: 41.8299, lon: -87.6338, name: 'Guaranteed Rate Field', dome: false, alt: 594 },
  CIN: { lat: 39.0974, lon: -84.5065, name: 'Great American Ball Park', dome: false, alt: 490 },
  CLE: { lat: 41.4962, lon: -81.6852, name: 'Progressive Field', dome: false, alt: 653 },
  COL: { lat: 39.7559, lon: -104.9942, name: 'Coors Field', dome: false, alt: 5280 },
  DET: { lat: 42.3390, lon: -83.0485, name: 'Comerica Park', dome: false, alt: 583 },
  HOU: { lat: 29.7573, lon: -95.3555, name: 'Minute Maid Park', dome: true, alt: 50 },
  KC: { lat: 39.0517, lon: -94.4803, name: 'Kauffman Stadium', dome: false, alt: 750 },
  LAA: { lat: 33.8003, lon: -117.8827, name: 'Angel Stadium', dome: false, alt: 160 },
  LAD: { lat: 34.0739, lon: -118.2400, name: 'Dodger Stadium', dome: false, alt: 515 },
  MIA: { lat: 25.7781, lon: -80.2196, name: 'loanDepot park', dome: true, alt: 6 },
  MIL: { lat: 43.0280, lon: -87.9712, name: 'American Family Field', dome: true, alt: 635 },
  MIN: { lat: 44.9817, lon: -93.2776, name: 'Target Field', dome: false, alt: 815 },
  NYM: { lat: 40.7571, lon: -73.8458, name: 'Citi Field', dome: false, alt: 20 },
  NYY: { lat: 40.8296, lon: -73.9262, name: 'Yankee Stadium', dome: false, alt: 20 },
  OAK: { lat: 37.7516, lon: -122.2005, name: 'Oakland Coliseum', dome: false, alt: 6 },
  PHI: { lat: 39.9061, lon: -75.1665, name: 'Citizens Bank Park', dome: false, alt: 20 },
  PIT: { lat: 40.4468, lon: -80.0057, name: 'PNC Park', dome: false, alt: 730 },
  SD: { lat: 32.7076, lon: -117.1570, name: 'Petco Park', dome: false, alt: 22 },
  SF: { lat: 37.7786, lon: -122.3893, name: 'Oracle Park', dome: false, alt: 5 },
  SEA: { lat: 47.5914, lon: -122.3316, name: 'T-Mobile Park', dome: true, alt: 20 },
  STL: { lat: 38.6226, lon: -90.1928, name: 'Busch Stadium', dome: false, alt: 465 },
  TB: { lat: 27.7682, lon: -82.6534, name: 'Tropicana Field', dome: true, alt: 45 },
  TEX: { lat: 32.7473, lon: -97.0845, name: 'Globe Life Field', dome: true, alt: 590 },
  TOR: { lat: 43.6414, lon: -79.3894, name: 'Rogers Centre', dome: true, alt: 250 },
  WSH: { lat: 38.8730, lon: -77.0074, name: 'Nationals Park', dome: false, alt: 25 },
};

// ==================== WEATHER API ====================

/**
 * Fetch weather from Open-Meteo (free, no API key required)
 */
async function fetchWeather(lat, lon) {
  try {
    const fetch = require('node-fetch');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.current) return null;
    return {
      temp_f: data.current.temperature_2m,
      humidity: data.current.relative_humidity_2m,
      wind_mph: data.current.wind_speed_10m,
      wind_dir: data.current.wind_direction_10m,
      weather_code: data.current.weather_code,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    console.error('Weather fetch failed:', e.message);
    return null;
  }
}

// ==================== WEATHER IMPACT MODEL ====================

/**
 * Calculate weather-based run adjustment multiplier
 * Returns a multiplier: 1.0 = no effect, >1 = more runs, <1 = fewer runs
 */
function calculateWeatherImpact(weather, ballpark) {
  if (!weather) return { multiplier: 1.0, factors: [], description: 'No weather data' };
  
  // Dome stadiums — weather doesn't matter
  if (ballpark && ballpark.dome) {
    return { multiplier: 1.0, factors: [{ factor: 'dome', impact: 0, note: 'Indoor/retractable roof' }], description: 'Dome stadium — weather irrelevant' };
  }
  
  let multiplier = 1.0;
  const factors = [];
  
  // Temperature effect
  // Baseline: 72°F. For every degree above/below, ~0.15% change in run scoring
  const tempBaseline = 72;
  const tempDiff = weather.temp_f - tempBaseline;
  const tempEffect = tempDiff * 0.0015;
  multiplier += tempEffect;
  if (Math.abs(tempEffect) > 0.01) {
    factors.push({
      factor: 'temperature',
      impact: +(tempEffect * 100).toFixed(1),
      note: `${weather.temp_f}°F (${tempDiff > 0 ? '+' : ''}${tempDiff.toFixed(0)}° from baseline)`,
    });
  }
  
  // ==================== PARK-SPECIFIC WIND MODEL v73.0 ====================
  // Every MLB park has a known center field compass bearing (degrees from home plate to CF).
  // Wind blowing FROM home plate TOWARD center field = "blowing out" (more runs).
  // Wind blowing FROM center field TOWARD home plate = "blowing in" (fewer runs).
  // The old model assumed north = out for ALL parks — WRONG for 20+ outdoor parks.
  // Wrigley faces NE (23°), Fenway faces NE (but RF is very different), Oracle faces E (70°).
  // A north wind at Wrigley blows out; at Coors it blows to right field (cross-wind).
  //
  // CF_BEARING = compass bearing from home plate to center field (degrees)
  // Sources: Google Maps satellite + MLB.com park info + baseball-reference dimensions
  const CF_BEARINGS = {
    ATL: 185,   // Truist Park — CF faces roughly south
    BAL: 22,    // Camden Yards — CF faces NNE
    BOS: 65,    // Fenway Park — CF faces ENE
    CHC: 23,    // Wrigley Field — CF faces NNE (iconic wind games)
    CWS: 170,   // Guaranteed Rate — CF faces roughly south
    CIN: 0,     // Great American — CF faces north (Ohio River behind CF)
    CLE: 170,   // Progressive Field — CF faces roughly south
    COL: 73,    // Coors Field — CF faces ENE
    DET: 125,   // Comerica Park — CF faces SE
    KC: 0,      // Kauffman Stadium — CF faces north
    LAA: 355,   // Angel Stadium — CF faces roughly north
    LAD: 0,     // Dodger Stadium — CF faces north (Chavez Ravine)
    MIN: 180,   // Target Field — CF faces south
    NYM: 62,    // Citi Field — CF faces ENE
    NYY: 65,    // Yankee Stadium — CF faces ENE
    OAK: 170,   // Oakland Coliseum — CF faces roughly south
    PHI: 62,    // Citizens Bank Park — CF faces ENE
    PIT: 40,    // PNC Park — CF faces NE (Allegheny River beyond RF)
    SD: 200,    // Petco Park — CF faces SSW (downtown beyond LF)
    SF: 70,     // Oracle Park — CF faces ENE (McCovey Cove beyond RF)
    STL: 180,   // Busch Stadium — CF faces south
    WSH: 340,   // Nationals Park — CF faces NNW
  };

  if (weather.wind_mph > 8) {
    const windSpeed = weather.wind_mph;
    const windDir = weather.wind_dir; // Direction wind is COMING FROM (meteorological convention)
    
    // The wind direction in meteorology is where the wind is COMING FROM.
    // Wind FROM the south (180°) blowing TOWARD the north (0°).
    // To get where the wind is GOING: windGoingTo = (windDir + 180) % 360
    const windGoingTo = (windDir + 180) % 360;
    
    // Get the park's CF bearing, or default to 0 (north) for unknown parks
    const parkAbbr = ballpark?.abbr || (ballpark?.name && Object.entries(BALLPARK_COORDS).find(([k, v]) => v.name === ballpark.name)?.[0]) || '';
    const cfBearing = CF_BEARINGS[parkAbbr] !== undefined ? CF_BEARINGS[parkAbbr] : null;
    
    let windDirection = 'neutral';
    let windImpact = 0;
    const baseFactor = (windSpeed - 8) * 0.005; // 0.5% per mph above 8
    
    if (cfBearing !== null) {
      // Calculate angle between wind direction and CF bearing
      // Positive alignment = wind blowing TOWARD CF (out) = more runs
      // Negative alignment = wind blowing FROM CF toward plate (in) = fewer runs
      let angleDiff = windGoingTo - cfBearing;
      // Normalize to -180 to +180
      while (angleDiff > 180) angleDiff -= 360;
      while (angleDiff < -180) angleDiff += 360;
      
      const absAngle = Math.abs(angleDiff);
      
      if (absAngle <= 30) {
        // Wind blowing OUT to CF ± 30° — full positive effect
        windDirection = 'out';
        windImpact = baseFactor * (1.0 - absAngle / 90); // Scale by alignment quality
        windImpact = Math.max(windImpact, baseFactor * 0.67);
      } else if (absAngle >= 150) {
        // Wind blowing IN from CF ± 30° — negative effect
        windDirection = 'in';
        const inAlignment = 1.0 - (180 - absAngle) / 90;
        windImpact = -baseFactor * 0.7 * Math.max(inAlignment, 0.67);
      } else if (absAngle <= 60) {
        // Mostly blowing out, partial cross-wind
        windDirection = 'out-cross';
        windImpact = baseFactor * 0.5;
      } else if (absAngle >= 120) {
        // Mostly blowing in, partial cross-wind
        windDirection = 'in-cross';
        windImpact = -baseFactor * 0.35;
      } else {
        // True cross-wind (60°-120° off CF axis)
        windDirection = 'cross';
        // Cross-wind slightly helps (LF/RF foul-pole homers)
        windImpact = baseFactor * 0.15;
      }
      
      // Wrigley Field special: wind effects are amplified due to open bleachers and Lake Michigan
      if (parkAbbr === 'CHC') windImpact *= 1.3;
      // Oracle Park special: wind from SF Bay suppresses HR to right field significantly
      if (parkAbbr === 'SF' && (windDirection === 'in' || windDirection === 'in-cross')) windImpact *= 1.2;
      // Coors special: thin air already in park factor, but wind at altitude carries more
      if (parkAbbr === 'COL' && (windDirection === 'out' || windDirection === 'out-cross')) windImpact *= 1.15;
      
      multiplier += windImpact;
      
      factors.push({
        factor: 'wind',
        impact: +(windImpact * 100).toFixed(1),
        note: `${windSpeed.toFixed(0)} mph, blowing ${windDirection} (from ${windDir}°, CF at ${cfBearing}°, offset ${absAngle.toFixed(0)}°)`,
        parkSpecific: true,
        cfBearing,
      });
    } else {
      // Fallback for unknown parks or dome parks — use old generic model
      const dir = windDir;
      if ((dir >= 315 || dir <= 45)) {
        windImpact = baseFactor;
        windDirection = 'out';
      } else if (dir >= 135 && dir <= 225) {
        windImpact = -baseFactor * 0.7;
        windDirection = 'in';
      } else {
        windImpact = baseFactor * 0.2;
        windDirection = 'cross';
      }
      multiplier += windImpact;
      factors.push({
        factor: 'wind',
        impact: +(windImpact * 100).toFixed(1),
        note: `${windSpeed.toFixed(0)} mph, blowing ${windDirection} (${dir}°) — generic model`,
        parkSpecific: false,
      });
    }
  }
  
  // Humidity effect (minor — humid air is actually less dense, ball carries better)
  if (weather.humidity > 70) {
    const humidEffect = (weather.humidity - 70) * 0.0003; // Very slight positive
    multiplier += humidEffect;
    factors.push({
      factor: 'humidity',
      impact: +(humidEffect * 100).toFixed(1),
      note: `${weather.humidity}% — humid air helps ball carry slightly`,
    });
  }
  
  // Rain/precipitation concern
  const weatherCode = weather.weather_code;
  let precipNote = null;
  if (weatherCode >= 61 && weatherCode <= 67) {
    precipNote = '🌧️ Rain — possible delay/postponement';
    factors.push({ factor: 'precipitation', impact: 0, note: precipNote });
  } else if (weatherCode >= 71 && weatherCode <= 77) {
    precipNote = '🌨️ Snow — possible delay/postponement';
    factors.push({ factor: 'precipitation', impact: 0, note: precipNote });
  } else if (weatherCode >= 80 && weatherCode <= 82) {
    precipNote = '🌧️ Rain showers — potential delay';
    factors.push({ factor: 'precipitation', impact: 0, note: precipNote });
  }
  
  // Clamp multiplier to reasonable range
  multiplier = Math.max(0.85, Math.min(1.20, multiplier));
  
  const totalImpact = +((multiplier - 1) * 100).toFixed(1);
  let description = '';
  if (totalImpact > 3) description = '🔥 Hitter-friendly conditions';
  else if (totalImpact > 1) description = '☀️ Slightly favors hitters';
  else if (totalImpact < -3) description = '🥶 Pitcher-friendly conditions';
  else if (totalImpact < -1) description = '🌤️ Slightly favors pitchers';
  else description = '⚖️ Neutral conditions';
  
  return {
    multiplier: +multiplier.toFixed(4),
    totalImpact,
    factors,
    description,
    weather: {
      temp: weather.temp_f,
      humidity: weather.humidity,
      wind: weather.wind_mph,
      windDir: weather.wind_dir,
    },
  };
}

// ==================== CACHE ====================

let weatherCache = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      weatherCache = raw;
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(weatherCache, null, 2));
  } catch (e) { /* ignore */ }
}

// ==================== PUBLIC API ====================

/**
 * Get weather impact for a specific ballpark
 */
async function getWeatherForPark(teamAbbr) {
  const park = BALLPARK_COORDS[teamAbbr];
  if (!park) return { error: `Unknown team: ${teamAbbr}` };
  
  // Check cache
  const cacheKey = teamAbbr;
  if (weatherCache[cacheKey] && (Date.now() - weatherCache[cacheKey].fetchedAt) < CACHE_TTL) {
    return weatherCache[cacheKey].data;
  }
  
  const weather = await fetchWeather(park.lat, park.lon);
  const impact = calculateWeatherImpact(weather, { ...park, abbr: teamAbbr });
  
  const result = {
    team: teamAbbr,
    park: park.name,
    dome: park.dome,
    altitude: park.alt,
    ...impact,
  };
  
  // Cache it
  weatherCache[cacheKey] = { data: result, fetchedAt: Date.now() };
  saveCache();
  
  return result;
}

/**
 * Get weather for all outdoor MLB parks (batch)
 */
async function getAllWeather() {
  const results = {};
  const outdoorParks = Object.entries(BALLPARK_COORDS).filter(([_, p]) => !p.dome);
  
  // Fetch in parallel (Open-Meteo allows it)
  const promises = outdoorParks.map(async ([abbr, park]) => {
    try {
      const weather = await fetchWeather(park.lat, park.lon);
      const impact = calculateWeatherImpact(weather, { ...park, abbr });
      results[abbr] = {
        team: abbr,
        park: park.name,
        dome: false,
        altitude: park.alt,
        ...impact,
      };
    } catch (e) {
      results[abbr] = { team: abbr, park: park.name, error: e.message };
    }
  });
  
  await Promise.all(promises);
  
  // Add dome parks
  for (const [abbr, park] of Object.entries(BALLPARK_COORDS)) {
    if (park.dome) {
      results[abbr] = {
        team: abbr,
        park: park.name,
        dome: true,
        altitude: park.alt,
        multiplier: 1.0,
        totalImpact: 0,
        factors: [{ factor: 'dome', impact: 0, note: 'Indoor/retractable roof' }],
        description: 'Dome stadium — weather irrelevant',
      };
    }
  }
  
  return results;
}

/**
 * Get weather-adjusted run projection for a game
 */
async function adjustGameTotal(homeTeam, awayTeam, baseTotal) {
  const weather = await getWeatherForPark(homeTeam);
  if (weather.error) return { total: baseTotal, adjustment: 0, weather: null };
  
  const adjustedTotal = +(baseTotal * weather.multiplier).toFixed(1);
  return {
    total: adjustedTotal,
    baseTotal,
    adjustment: +(adjustedTotal - baseTotal).toFixed(1),
    weather,
  };
}

function getStatus() {
  const cached = Object.keys(weatherCache).length;
  return {
    service: 'mlb-weather',
    version: '1.0',
    cachedParks: cached,
    totalParks: Object.keys(BALLPARK_COORDS).length,
    domeParks: Object.entries(BALLPARK_COORDS).filter(([_, p]) => p.dome).length,
    outdoorParks: Object.entries(BALLPARK_COORDS).filter(([_, p]) => !p.dome).length,
  };
}

// Load cache on start
loadCache();

module.exports = {
  getWeatherForPark,
  getAllWeather,
  adjustGameTotal,
  calculateWeatherImpact,
  getStatus,
  BALLPARK_COORDS,
};
