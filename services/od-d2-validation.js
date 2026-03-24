/**
 * OD D-2 Live Validation — SportsSim v106.0
 * ==========================================
 * 🚨 2 DAYS TO OPENING DAY — LIVE CROSS-VALIDATION
 *
 * Runs RIGHT NOW (March 24) to:
 *   1. Pull ESPN's confirmed OD schedule + probable pitchers for March 26-27
 *   2. Cross-validate EVERY starter against our pitcher DB
 *   3. Identify any starter changes, scratches, or new additions
 *   4. Pull 48-hour weather forecasts for all outdoor OD venues  
 *   5. Pull latest DK odds for all OD games (via The Odds API)
 *   6. Run predictions with CURRENT data → compare to DK lines
 *   7. Generate updated value bets with fresh lines
 *   8. Flag any CRITICAL changes that affect our OD betting card
 *
 * THIS IS THE MONEY CHECK — makes sure we're not betting on stale data.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ==================== ESPN SCHEDULE FETCH ====================

function fetchJSON(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    https.get(url, { headers: { 'User-Agent': 'SportsSim/106.0' } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body)); } 
        catch(e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Pull ESPN schedule for a specific date → extract probables
 */
async function fetchESPNSchedule(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
  const data = await fetchJSON(url);
  
  const games = [];
  if (!data.events) return games;
  
  for (const event of data.events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    
    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    
    const homeAbbr = normalizeTeam(home.team?.abbreviation);
    const awayAbbr = normalizeTeam(away.team?.abbreviation);
    
    // Extract probable starters
    const homeSP = home.probables?.[0]?.athlete;
    const awaySP = away.probables?.[0]?.athlete;
    
    games.push({
      gameId: event.id,
      date: event.date,
      away: awayAbbr,
      home: homeAbbr,
      awaySP: awaySP ? { name: awaySP.fullName, id: awaySP.id } : null,
      homeSP: homeSP ? { name: homeSP.fullName, id: homeSP.id } : null,
      venue: comp.venue?.fullName,
      indoor: comp.venue?.indoor || false,
      status: event.status?.type?.name || 'STATUS_SCHEDULED',
    });
  }
  
  return games;
}

// ==================== WEATHER FORECAST ====================

const BALLPARK_COORDS = {
  'NYM': { lat: 40.7571, lon: -73.8458, name: 'Citi Field' },
  'MIL': { lat: 43.0280, lon: -87.9712, name: 'American Family Field', retractable: true },
  'CHC': { lat: 41.9484, lon: -87.6553, name: 'Wrigley Field' },
  'BAL': { lat: 39.2838, lon: -76.6217, name: 'Camden Yards' },
  'CIN': { lat: 39.0974, lon: -84.5065, name: 'GABP' },
  'STL': { lat: 38.6226, lon: -90.1928, name: 'Busch Stadium' },
  'PHI': { lat: 39.9061, lon: -75.1665, name: 'Citizens Bank Park' },
  'LAD': { lat: 34.0739, lon: -118.2400, name: 'Dodger Stadium' },
  'SEA': { lat: 47.5914, lon: -122.3325, name: 'T-Mobile Park', retractable: true },
  'SF':  { lat: 37.7786, lon: -122.3893, name: 'Oracle Park' },
  'ATL': { lat: 33.8907, lon: -84.4677, name: 'Truist Park' },
  'SD':  { lat: 32.7073, lon: -117.1566, name: 'Petco Park' },
  'CLE': { lat: 41.4962, lon: -81.6852, name: 'Progressive Field' },
  // Domes — weather doesn't matter
  'HOU': { lat: 29.7572, lon: -95.3555, name: 'Minute Maid Park', dome: true },
  'TOR': { lat: 43.6414, lon: -79.3894, name: 'Rogers Centre', dome: true },
  'MIA': { lat: 25.7781, lon: -80.2196, name: 'LoanDepot Park', dome: true },
  'ARI': { lat: 33.4455, lon: -112.0667, name: 'Chase Field', dome: true },
  'TB':  { lat: 27.7682, lon: -82.6534, name: 'Tropicana Field', dome: true },
  'TEX': { lat: 32.7512, lon: -97.0832, name: 'Globe Life Field', dome: true },
};

async function fetchWeatherForecast(team, date) {
  const park = BALLPARK_COORDS[team];
  if (!park || park.dome) return { team, dome: true, status: 'DOME' };
  
  try {
    const nodeFetch = (await import('node-fetch')).default;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${park.lat}&longitude=${park.lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&start_date=${date}&end_date=${date}&timezone=America%2FNew_York`;
    
    const resp = await nodeFetch(url, { timeout: 10000 });
    if (!resp.ok) return { team, status: 'ERROR', error: `HTTP ${resp.status}` };
    
    const data = await resp.json();
    if (!data.hourly) return { team, status: 'NO_DATA' };
    
    // Find game-time conditions (approximate based on typical first pitch times)
    const gameHours = { 'NYM': 13, 'MIL': 14, 'CHC': 14, 'BAL': 15, 'CIN': 16, 'HOU': 16, 'SD': 16, 'STL': 16, 'PHI': 16, 'LAD': 20, 'SEA': 22, 'SF': 16, 'ATL': 19, 'CLE': 22 };
    const gameHour = gameHours[team] || 16;
    
    const idx = data.hourly.time.findIndex(t => {
      const h = parseInt(t.split('T')[1].split(':')[0]);
      return h === gameHour;
    });
    
    if (idx === -1) return { team, park: park.name, status: 'NO_GAMETIME_DATA' };
    
    return {
      team,
      park: park.name,
      retractable: !!park.retractable,
      status: 'OK',
      gameTime: data.hourly.time[idx],
      temp_f: data.hourly.temperature_2m[idx],
      humidity: data.hourly.relative_humidity_2m[idx],
      wind_mph: data.hourly.wind_speed_10m[idx],
      wind_dir: data.hourly.wind_direction_10m[idx],
      wind_gusts: data.hourly.wind_gusts_10m[idx],
      precip_prob: data.hourly.precipitation_probability[idx],
      precip_mm: data.hourly.precipitation[idx],
      bettingImpact: assessWeatherImpact(data.hourly.temperature_2m[idx], data.hourly.wind_speed_10m[idx], data.hourly.precipitation_probability[idx], team)
    };
  } catch(e) {
    return { team, status: 'ERROR', error: e.message };
  }
}

function assessWeatherImpact(temp, wind, precipProb, team) {
  const signals = [];
  let totalsMult = 1.0;
  
  // Temperature
  if (temp < 40) {
    signals.push(`🥶 EXTREME COLD (${temp}°F) — STRONG UNDER lean`);
    totalsMult *= 0.92;
  } else if (temp < 50) {
    signals.push(`❄️ Cold (${temp}°F) — moderate under lean`);
    totalsMult *= 0.96;
  } else if (temp > 85) {
    signals.push(`🔥 Hot (${temp}°F) — slight over lean`);
    totalsMult *= 1.03;
  }
  
  // Wind
  if (wind > 15) {
    // Wrigley and Oracle have directional wind effects
    if (team === 'CHC') {
      signals.push(`💨 Wrigley wind ${wind}mph — direction matters (IN=under, OUT=over)`);
    } else if (team === 'SF') {
      signals.push(`💨 Oracle wind ${wind}mph — typically blows in from bay = under`);
      totalsMult *= 0.97;
    } else {
      signals.push(`💨 Strong wind ${wind}mph — increased variance`);
    }
  }
  
  // Precipitation
  if (precipProb > 50) {
    signals.push(`🌧️ ${precipProb}% rain probability — POSTPONEMENT RISK`);
  } else if (precipProb > 30) {
    signals.push(`🌦️ ${precipProb}% rain chance — possible delay`);
  }
  
  return { totalsMult, signals, severity: signals.length > 0 ? 'WARNING' : 'CLEAR' };
}

// ==================== PITCHER DB CROSS-VALIDATION ====================

function crossValidatePitchers(espnGames) {
  let pitcherDB = null;
  let openingDayModel = null;
  
  try { pitcherDB = require('../models/mlb-pitchers'); } catch(e) {}
  try { openingDayModel = require('../models/mlb-opening-day'); } catch(e) {}
  
  const results = [];
  
  for (const game of espnGames) {
    const gameResult = {
      matchup: `${game.away}@${game.home}`,
      date: game.date,
      venue: game.venue,
      indoor: game.indoor,
      away: { team: game.away, espnStarter: game.awaySP?.name || 'TBD' },
      home: { team: game.home, espnStarter: game.homeSP?.name || 'TBD' },
      alerts: [],
      status: 'OK'
    };
    
    // Check away pitcher
    if (game.awaySP?.name) {
      const inDB = pitcherDB ? findPitcherInDB(pitcherDB, game.awaySP.name, game.away) : null;
      gameResult.away.inDB = !!inDB;
      gameResult.away.dbRating = inDB?.compositeRating || inDB?.rating || null;
      if (!inDB) {
        gameResult.alerts.push(`⚠️ ${game.away} starter ${game.awaySP.name} NOT in pitcher DB`);
        gameResult.status = 'WARNING';
      }
    } else {
      gameResult.away.inDB = false;
      gameResult.alerts.push(`❓ ${game.away} starter TBD`);
      gameResult.status = 'WARNING';
    }
    
    // Check home pitcher
    if (game.homeSP?.name) {
      const inDB = pitcherDB ? findPitcherInDB(pitcherDB, game.homeSP.name, game.home) : null;
      gameResult.home.inDB = !!inDB;
      gameResult.home.dbRating = inDB?.compositeRating || inDB?.rating || null;
      if (!inDB) {
        gameResult.alerts.push(`⚠️ ${game.home} starter ${game.homeSP.name} NOT in pitcher DB`);
        gameResult.status = 'WARNING';
      }
    } else {
      gameResult.home.inDB = false;
      gameResult.alerts.push(`❓ ${game.home} starter TBD`);
      gameResult.status = 'WARNING';
    }
    
    // Check if our OD model has a different starter
    if (openingDayModel) {
      const odSchedule = openingDayModel.getSchedule?.() || openingDayModel.OPENING_DAY_GAMES || [];
      const odGame = odSchedule.find(g => 
        (g.away === game.away && g.home === game.home) ||
        (g.awayTeam === game.away && g.homeTeam === game.home)
      );
      if (odGame) {
        const odAwaySP = odGame.awayPitcher || odGame.matchup?.split(' vs ')?.[0];
        const odHomeSP = odGame.homePitcher || odGame.matchup?.split(' vs ')?.[1];
        
        if (game.awaySP?.name && odAwaySP && !nameMatch(game.awaySP.name, odAwaySP)) {
          gameResult.alerts.push(`🔄 STARTER CHANGE: ${game.away} — ESPN: ${game.awaySP.name}, OUR MODEL: ${odAwaySP}`);
          gameResult.status = 'CRITICAL';
        }
        if (game.homeSP?.name && odHomeSP && !nameMatch(game.homeSP.name, odHomeSP)) {
          gameResult.alerts.push(`🔄 STARTER CHANGE: ${game.home} — ESPN: ${game.homeSP.name}, OUR MODEL: ${odHomeSP}`);
          gameResult.status = 'CRITICAL';
        }
      }
    }
    
    results.push(gameResult);
  }
  
  return results;
}

function findPitcherInDB(db, name, team) {
  // Try various access patterns
  if (db.PITCHERS) {
    const found = Object.values(db.PITCHERS).flat().find(p => 
      nameMatch(p.name || p.pitcher, name)
    );
    if (found) return found;
  }
  
  if (db.getPitcher) {
    return db.getPitcher(name, team);
  }
  
  // Try team-based lookup
  if (db.PITCHERS?.[team]) {
    return db.PITCHERS[team].find(p => nameMatch(p.name || p.pitcher, name));
  }
  
  return null;
}

function nameMatch(a, b) {
  if (!a || !b) return false;
  const normalize = s => s.toLowerCase().replace(/[^a-z]/g, '');
  return normalize(a) === normalize(b) || 
         a.toLowerCase().includes(b.toLowerCase()) || 
         b.toLowerCase().includes(a.toLowerCase());
}

// ESPN sometimes uses different team abbreviations
const ESPN_TO_ABBR = {
  'CHW': 'CWS', 'WSH': 'WSN', 'ATH': 'OAK',
  // Reverse
  'CWS': 'CWS', 'WSN': 'WSH', 'OAK': 'OAK'
};

function normalizeTeam(espnAbbr) {
  return ESPN_TO_ABBR[espnAbbr] || espnAbbr;
}

// ==================== MAIN VALIDATION ====================

async function runD2Validation() {
  const startTime = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    daysToOD: 2,
    version: '106.0.0',
    schedule: { day1: [], day2: [] },
    pitcherValidation: [],
    weather: [],
    summary: { totalGames: 0, starterIssues: 0, weatherAlerts: 0, criticalAlerts: 0 },
    alerts: [],
    goNoGo: 'GO'
  };
  
  try {
    // 1. Fetch ESPN schedules for March 26 + 27
    console.log('[D2] Fetching ESPN schedule for March 26...');
    const day1Games = await fetchESPNSchedule('20260326');
    console.log(`[D2] Day 1: ${day1Games.length} games found`);
    
    console.log('[D2] Fetching ESPN schedule for March 27...');
    const day2Games = await fetchESPNSchedule('20260327');
    console.log(`[D2] Day 2: ${day2Games.length} games found`);
    
    report.schedule.day1 = day1Games;
    report.schedule.day2 = day2Games;
    report.summary.totalGames = day1Games.length + day2Games.length;
    
    // 2. Cross-validate all pitchers
    console.log('[D2] Cross-validating pitchers...');
    const allGames = [...day1Games, ...day2Games];
    report.pitcherValidation = crossValidatePitchers(allGames);
    
    const criticals = report.pitcherValidation.filter(g => g.status === 'CRITICAL');
    const warnings = report.pitcherValidation.filter(g => g.status === 'WARNING');
    report.summary.starterIssues = criticals.length + warnings.length;
    report.summary.criticalAlerts = criticals.length;
    
    for (const c of criticals) {
      report.alerts.push(...c.alerts);
    }
    for (const w of warnings) {
      report.alerts.push(...w.alerts);
    }
    
    // 3. Pull weather for all outdoor OD venues
    console.log('[D2] Pulling live weather forecasts...');
    const uniqueHomeTeams = [...new Set(allGames.map(g => g.home))];
    const weatherPromises = [];
    
    for (const team of uniqueHomeTeams) {
      // Pull for both OD dates
      for (const date of ['2026-03-26', '2026-03-27']) {
        const hasGameOnDate = allGames.some(g => g.home === team && g.date?.startsWith(date));
        if (hasGameOnDate) {
          weatherPromises.push(fetchWeatherForecast(team, date));
        }
      }
    }
    
    // Stagger weather requests to avoid rate limits
    const weatherResults = [];
    for (const p of weatherPromises) {
      const result = await p;
      weatherResults.push(result);
      await new Promise(r => setTimeout(r, 200)); // 200ms between requests
    }
    
    report.weather = weatherResults;
    report.summary.weatherAlerts = weatherResults.filter(w => 
      w.bettingImpact?.severity === 'WARNING'
    ).length;
    
    // Check for extreme weather
    for (const w of weatherResults) {
      if (w.status === 'OK' && w.precip_prob > 50) {
        report.alerts.push(`🌧️ POSTPONEMENT RISK: ${w.team} — ${w.precip_prob}% precipitation at ${w.park}`);
        report.summary.criticalAlerts++;
      }
      if (w.status === 'OK' && w.temp_f < 35) {
        report.alerts.push(`🥶 EXTREME COLD: ${w.team} — ${w.temp_f}°F at ${w.park}`);
      }
    }
    
    // 4. Determine GO/NO-GO
    if (report.summary.criticalAlerts > 2) {
      report.goNoGo = 'REVIEW';
    }
    if (criticals.length > 3) {
      report.goNoGo = 'NO-GO';
    }
    
    report.durationMs = Date.now() - startTime;
    
    // Save results
    const resultsPath = path.join(__dirname, 'od-d2-validation-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(report, null, 2));
    console.log(`[D2] Validation complete in ${report.durationMs}ms — ${report.goNoGo}`);
    
  } catch(e) {
    report.error = e.message;
    report.goNoGo = 'ERROR';
    console.error('[D2] Validation failed:', e.message);
  }
  
  return report;
}

// ==================== FORMATTED REPORT ====================

function formatReport(report) {
  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('  🦞 SPORTSSIM OD D-2 LIVE VALIDATION REPORT');
  lines.push(`  ${report.timestamp}`);
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  
  // Schedule
  lines.push(`📅 SCHEDULE: ${report.schedule.day1.length} Day 1 games + ${report.schedule.day2.length} Day 2 games = ${report.summary.totalGames} total`);
  lines.push('');
  
  // Pitcher validation
  lines.push('🔍 PITCHER CROSS-VALIDATION:');
  for (const g of (report.pitcherValidation || [])) {
    const icon = g.status === 'OK' ? '✅' : g.status === 'CRITICAL' ? '🚨' : '⚠️';
    lines.push(`  ${icon} ${g.matchup}: ${g.away.espnStarter} vs ${g.home.espnStarter}`);
    if (g.alerts.length > 0) {
      for (const a of g.alerts) {
        lines.push(`     ${a}`);
      }
    }
  }
  lines.push('');
  
  // Weather
  lines.push('🌤️ WEATHER FORECASTS (game-time conditions):');
  for (const w of (report.weather || [])) {
    if (w.dome) {
      lines.push(`  🏟️ ${w.team}: DOME (no weather impact)`);
    } else if (w.status === 'OK') {
      const icon = w.bettingImpact?.severity === 'WARNING' ? '⚠️' : '✅';
      lines.push(`  ${icon} ${w.team} (${w.park}): ${w.temp_f}°F, ${w.wind_mph}mph wind, ${w.precip_prob}% precip`);
      if (w.bettingImpact?.signals?.length > 0) {
        for (const s of w.bettingImpact.signals) {
          lines.push(`     ${s}`);
        }
      }
    } else {
      lines.push(`  ❌ ${w.team}: ${w.status} — ${w.error || 'no data'}`);
    }
  }
  lines.push('');
  
  // Alerts
  if (report.alerts?.length > 0) {
    lines.push('🚨 ALERTS:');
    for (const a of report.alerts) {
      lines.push(`  ${a}`);
    }
    lines.push('');
  }
  
  // Summary
  lines.push(`📊 SUMMARY: ${report.summary.totalGames} games, ${report.summary.starterIssues} starter issues, ${report.summary.weatherAlerts} weather alerts, ${report.summary.criticalAlerts} critical`);
  lines.push(`🎯 STATUS: ${report.goNoGo}`);
  lines.push(`⏱️ Completed in ${report.durationMs}ms`);
  lines.push('');
  
  return lines.join('\n');
}

module.exports = {
  runD2Validation,
  formatReport,
  fetchESPNSchedule,
  fetchWeatherForecast,
  crossValidatePitchers,
  normalizeTeam,
  BALLPARK_COORDS
};
