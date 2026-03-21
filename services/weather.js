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
  
  // Wind effect
  // Wind >10mph has a noticeable effect. Direction matters:
  // 0°=N, 90°=E, 180°=S, 270°=W
  // "Blowing out" to CF is generally good for hitters
  if (weather.wind_mph > 8) {
    const windFactor = (weather.wind_mph - 8) * 0.005; // 0.5% per mph above 8
    // Simplification: positive = wind helps hitters, negative = hurts
    // Direction: 135-225° (S-ish) blowing toward plate typically helps pitchers
    // Direction: 315-360, 0-45° (N-ish) blowing out helps hitters
    let windDirection = 'neutral';
    const dir = weather.wind_dir;
    if ((dir >= 315 || dir <= 45)) {
      // Blowing out (north) — varies by park orientation but generally helps hitters
      multiplier += windFactor;
      windDirection = 'out';
    } else if (dir >= 135 && dir <= 225) {
      // Blowing in (south)
      multiplier -= windFactor * 0.7;
      windDirection = 'in';
    } else {
      // Cross-wind — reduced effect
      multiplier += windFactor * 0.2;
      windDirection = 'cross';
    }
    
    factors.push({
      factor: 'wind',
      impact: +(windFactor * 100 * (windDirection === 'in' ? -0.7 : windDirection === 'cross' ? 0.2 : 1)).toFixed(1),
      note: `${weather.wind_mph.toFixed(0)} mph, blowing ${windDirection} (${weather.wind_dir}°)`,
    });
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
  const impact = calculateWeatherImpact(weather, park);
  
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
      const impact = calculateWeatherImpact(weather, park);
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
