/**
 * Statcast Service — Baseball Savant Integration — SportsSim v24.0
 * ================================================================
 * Fetches REAL Statcast data from Baseball Savant CSV APIs:
 *   - Pitcher expected stats: xERA, xBA, xSLG, xwOBA
 *   - Batter expected stats: xBA, xSLG, xwOBA
 *   - Team-level aggregated Statcast batting metrics
 * 
 * WHY THIS MATTERS FOR BETTING:
 * - ERA lies (BABIP luck, sequencing). xERA is more predictive for future performance.
 * - xwOBA is the single best metric for true offensive quality.
 * - Pitchers with ERA << xERA are due for regression = fade them.
 * - Pitchers with ERA >> xERA are better than they look = bet on them.
 * - This is the #1 edge for Opening Day: preseason projections + Statcast truth.
 * 
 * Data sources:
 *   baseballsavant.mlb.com/leaderboard/expected_statistics (pitcher & batter)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'statcast-cache.json');
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours (Savant updates once daily)

// ==================== SAVANT CSV API ENDPOINTS ====================
const SAVANT_BASE = 'https://baseballsavant.mlb.com/leaderboard/expected_statistics';

// Pitcher leaderboard — min 50 PA for starters
const PITCHER_URL = `${SAVANT_BASE}?type=pitcher&year=2024&position=&team=&min=50&csv=true`;
// Batter leaderboard — min 200 PA for regulars
const BATTER_URL = `${SAVANT_BASE}?type=batter&year=2024&position=&team=&min=200&csv=true`;

// Team abbreviation mapping (Savant uses numeric IDs, ESPN uses standard abbrevs)
// We'll match by player name to team since CSV doesn't include team directly
// Instead we'll use FanGraphs-style team mapping for the pitcher DB match

// ==================== CACHE ====================
let cache = { pitchers: null, batters: null, teamBatting: null, lastFetch: 0 };

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Date.now() - raw.lastFetch < CACHE_TTL) {
        cache = raw;
        return true;
      }
      // Even if expired, load stale data so predictions aren't empty
      // Better to use 2024 Statcast data that's slightly old than NO data
      if (raw.pitchers && Object.keys(raw.pitchers).length > 0) {
        cache = raw;
        cache._isStale = true;
        return true; // Return true but flag as stale — refreshStatcast() will update
      }
    }
  } catch (e) { /* corrupt cache, refetch */ }
  return false;
}

// AUTO-LOAD: Load cache immediately on require() so statcast adjustments
// are available in predict() without waiting for server startup refreshStatcast() call.
// This fixes the bug where statcast was null in all sync predict() calls.
loadCache();

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) { /* non-critical */ }
}

// ==================== CSV PARSING ====================
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  // Parse header — handle quoted headers with commas inside
  const header = parseCSVLine(lines[0]);
  
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < header.length) continue;
    
    const row = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j].trim().replace(/^"|"$/g, '').trim();
      let val = values[j].trim().replace(/^"|"$/g, '').trim();
      
      // Try to parse as number
      const num = parseFloat(val);
      if (!isNaN(num) && val !== '') {
        row[key] = num;
      } else {
        row[key] = val;
      }
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ==================== HTTP FETCH ====================
function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'SportsSim/1.0 (MLB Betting Model)',
        'Accept': 'text/csv, text/plain, */*'
      },
      timeout: 15000
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchURL(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ==================== PITCHER STATCAST DATA ====================

/**
 * Fetch pitcher expected stats from Baseball Savant.
 * Returns: { "Gerrit Cole": { xera, xba, xslg, xwoba, era, era_minus_xera, pa, ... }, ... }
 */
async function fetchPitcherStatcast() {
  try {
    const csv = await fetchURL(PITCHER_URL);
    const rows = parseCSV(csv);
    
    const pitchers = {};
    for (const row of rows) {
      // CSV header: "last_name, first_name" is one field
      const nameField = row['last_name, first_name'] || row['last_name'] || '';
      if (!nameField) continue;
      
      // Parse "Last, First" → "First Last"
      const parts = nameField.split(',').map(s => s.trim());
      const fullName = parts.length >= 2 ? `${parts[1]} ${parts[0]}` : nameField;
      
      pitchers[fullName] = {
        name: fullName,
        playerId: row['player_id'],
        year: row['year'] || 2024,
        pa: row['pa'] || 0,
        bip: row['bip'] || 0,
        // Actual stats
        ba: row['ba'] || 0,
        slg: row['slg'] || 0,
        woba: row['woba'] || 0,
        era: parseFloat(row['era']) || 0,
        // EXPECTED stats (Statcast gold)
        xba: row['est_ba'] || 0,
        xslg: row['est_slg'] || 0,
        xwoba: row['est_woba'] || 0,
        xera: parseFloat(row['xera'] || row['era_minus_xera_diff'] ? (parseFloat(row['era']) - parseFloat(row['era_minus_xera_diff'] || 0)) : 0) || 0,
        // Luck indicators
        baLuck: row['est_ba_minus_ba_diff'] || 0,
        slgLuck: row['est_slg_minus_slg_diff'] || 0,
        wobaLuck: row['est_woba_minus_woba_diff'] || 0,
        eraLuck: parseFloat(row['era_minus_xera_diff']) || 0,
      };
      
      // Compute xERA from the CSV if not directly available
      // The CSV has "era" and "xera" columns, or "era_minus_xera_diff"
      if (row['xera']) {
        pitchers[fullName].xera = parseFloat(row['xera']);
      } else if (row['era_minus_xera_diff']) {
        pitchers[fullName].xera = parseFloat(row['era']) - parseFloat(row['era_minus_xera_diff']);
      }
    }
    
    return pitchers;
  } catch (e) {
    console.error('[Statcast] Failed to fetch pitcher data:', e.message);
    return null;
  }
}

// ==================== BATTER STATCAST DATA ====================

/**
 * Fetch batter expected stats from Baseball Savant.
 * Used to build team-level offensive quality metrics.
 */
async function fetchBatterStatcast() {
  try {
    const csv = await fetchURL(BATTER_URL);
    const rows = parseCSV(csv);
    
    const batters = {};
    for (const row of rows) {
      const nameField = row['last_name, first_name'] || row['last_name'] || '';
      if (!nameField) continue;
      
      const parts = nameField.split(',').map(s => s.trim());
      const fullName = parts.length >= 2 ? `${parts[1]} ${parts[0]}` : nameField;
      
      batters[fullName] = {
        name: fullName,
        playerId: row['player_id'],
        pa: row['pa'] || 0,
        bip: row['bip'] || 0,
        ba: row['ba'] || 0,
        xba: row['est_ba'] || 0,
        slg: row['slg'] || 0,
        xslg: row['est_slg'] || 0,
        woba: row['woba'] || 0,
        xwoba: row['est_woba'] || 0,
        // Luck indicators
        baLuck: row['est_ba_minus_ba_diff'] || 0,
        slgLuck: row['est_slg_minus_slg_diff'] || 0,
        wobaLuck: row['est_woba_minus_woba_diff'] || 0,
      };
    }
    
    return batters;
  } catch (e) {
    console.error('[Statcast] Failed to fetch batter data:', e.message);
    return null;
  }
}

// ==================== TEAM ROSTER MAPPING ====================
// Map batters to teams using our pitcher DB team affiliations
// For batters, we need a different approach — use known 2025 roster data

const TEAM_ROSTERS_2025 = {
  'NYY': ['Aaron Judge', 'Juan Soto', 'Jazz Chisholm Jr.', 'Anthony Volpe', 'Giancarlo Stanton', 'Austin Wells', 'Cody Bellinger', 'Jasson Dominguez'],
  'BAL': ['Gunnar Henderson', 'Adley Rutschman', 'Anthony Santander', 'Colton Cowser', 'Ryan Mountcastle', 'Jordan Westburg', 'Cedric Mullins'],
  'BOS': ['Rafael Devers', 'Jarren Duran', 'Triston Casas', 'Tyler O\'Neill', 'Masataka Yoshida', 'Ceddanne Rafaela', 'Trevor Story'],
  'TOR': ['Vladimir Guerrero Jr.', 'Bo Bichette', 'George Springer', 'Daulton Varsho', 'Alejandro Kirk', 'Ernie Clement', 'Spencer Horwitz'],
  'TB':  ['Yandy Diaz', 'Josh Lowe', 'Brandon Lowe', 'Isaac Paredes', 'Randy Arozarena', 'Taylor Walls', 'Jose Siri'],
  'CLE': ['Jose Ramirez', 'Josh Naylor', 'Steven Kwan', 'Lane Thomas', 'Andres Gimenez', 'Kyle Manzardo', 'Bo Naylor'],
  'KC':  ['Bobby Witt Jr.', 'Vinnie Pasquantino', 'Salvador Perez', 'MJ Melendez', 'Maikel Garcia', 'Michael Massey', 'Kyle Isbel'],
  'DET': ['Riley Greene', 'Spencer Torkelson', 'Kerry Carpenter', 'Colt Keith', 'Matt Vierling', 'Jake Rogers', 'Parker Meadows'],
  'MIN': ['Carlos Correa', 'Byron Buxton', 'Ryan Jeffers', 'Max Kepler', 'Royce Lewis', 'Edouard Julien', 'Austin Martin'],
  'CWS': ['Luis Robert Jr.', 'Andrew Vaughn', 'Eloy Jimenez', 'Andrew Benintendi', 'Corey Julks', 'Lenyn Sosa', 'Bryan Ramos'],
  'HOU': ['Yordan Alvarez', 'Kyle Tucker', 'Alex Bregman', 'Jose Altuve', 'Jeremy Pena', 'Yainer Diaz', 'Jake Meyers'],
  'SEA': ['Julio Rodriguez', 'Cal Raleigh', 'J.P. Crawford', 'Mitch Haniger', 'Luke Raley', 'Jorge Polanco', 'Dylan Moore'],
  'TEX': ['Corey Seager', 'Marcus Semien', 'Adolis Garcia', 'Leody Taveras', 'Jonah Heim', 'Nathaniel Lowe', 'Josh Smith'],
  'LAA': ['Mike Trout', 'Nolan Schanuel', 'Jo Adell', 'Taylor Ward', 'Logan O\'Hoppe', 'Zach Neto', 'Brandon Drury'],
  'OAK': ['Brent Rooker', 'JJ Bleday', 'Zack Gelof', 'Shea Langeliers', 'Lawrence Butler', 'Daz Cameron', 'Miguel Andujar'],
  'ATL': ['Ronald Acuna Jr.', 'Matt Olson', 'Marcell Ozuna', 'Austin Riley', 'Ozzie Albies', 'Sean Murphy', 'Michael Harris II'],
  'PHI': ['Bryce Harper', 'Trea Turner', 'Kyle Schwarber', 'Alec Bohm', 'Nick Castellanos', 'J.T. Realmuto', 'Brandon Marsh'],
  'NYM': ['Francisco Lindor', 'Pete Alonso', 'Brandon Nimmo', 'Mark Vientos', 'Starling Marte', 'Jeff McNeil', 'Francisco Alvarez'],
  'MIA': ['Jazz Chisholm Jr.', 'Luis Arraez', 'Bryan De La Cruz', 'Xavier Edwards', 'Nick Fortes', 'Jesus Sanchez', 'Jake Burger'],
  'WSH': ['CJ Abrams', 'James Wood', 'Dylan Crews', 'Lane Thomas', 'Joey Gallo', 'Keibert Ruiz', 'Luis Garcia Jr.'],
  'MIL': ['Willy Adames', 'William Contreras', 'Jackson Chourio', 'Christian Yelich', 'Rhys Hoskins', 'Sal Frelick', 'Brice Turang'],
  'CHC': ['Ian Happ', 'Dansby Swanson', 'Nico Hoerner', 'Seiya Suzuki', 'Christopher Morel', 'Michael Busch', 'Cody Bellinger'],
  'STL': ['Nolan Arenado', 'Willson Contreras', 'Masyn Winn', 'Lars Nootbaar', 'Alec Burleson', 'Brendan Donovan', 'Jordan Walker'],
  'PIT': ['Bryan Reynolds', 'Ke\'Bryan Hayes', 'Oneil Cruz', 'Andrew McCutchen', 'Jack Suwinski', 'Connor Joe', 'Henry Davis'],
  'CIN': ['Elly De La Cruz', 'Spencer Steer', 'TJ Friedl', 'Jonathan India', 'Tyler Stephenson', 'Stuart Fairchild', 'Noelvi Marte'],
  'LAD': ['Shohei Ohtani', 'Freddie Freeman', 'Mookie Betts', 'Will Smith', 'Teoscar Hernandez', 'Max Muncy', 'Gavin Lux'],
  'SD':  ['Manny Machado', 'Fernando Tatis Jr.', 'Xander Bogaerts', 'Jake Cronenworth', 'Ha-Seong Kim', 'Jurickson Profar', 'Kyle Higashioka'],
  'ARI': ['Ketel Marte', 'Corbin Carroll', 'Christian Walker', 'Lourdes Gurriel Jr.', 'Eugenio Suarez', 'Gabriel Moreno', 'Joc Pederson'],
  'SF':  ['Matt Chapman', 'Jung Hoo Lee', 'Heliot Ramos', 'Patrick Bailey', 'Tyler Fitzgerald', 'Michael Conforto', 'Wilmer Flores'],
  'COL': ['Ezequiel Tovar', 'Ryan McMahon', 'Brenton Doyle', 'Charlie Blackmon', 'Elias Diaz', 'Nolan Jones', 'Michael Toglia'],
};

/**
 * Build team-level Statcast batting metrics by aggregating individual player data.
 * Returns: { "NYY": { teamXwoba, teamXslg, teamXba, statcastEdge, ... }, ... }
 */
function buildTeamBattingStatcast(batters) {
  if (!batters) return null;
  
  const teamStats = {};
  
  for (const [abbr, roster] of Object.entries(TEAM_ROSTERS_2025)) {
    let totalXwoba = 0, totalWoba = 0;
    let totalXslg = 0, totalSlg = 0;
    let totalXba = 0, totalBa = 0;
    let totalPA = 0;
    let matchCount = 0;
    
    for (const playerName of roster) {
      // Try exact match first, then fuzzy
      let batter = batters[playerName];
      if (!batter) {
        // Try last name match
        const lastName = playerName.split(' ').pop();
        for (const [name, data] of Object.entries(batters)) {
          if (name.includes(lastName) && name.split(' ')[0][0] === playerName[0]) {
            batter = data;
            break;
          }
        }
      }
      
      if (batter && batter.pa >= 100) {
        const weight = batter.pa; // PA-weighted
        totalXwoba += batter.xwoba * weight;
        totalWoba += batter.woba * weight;
        totalXslg += batter.xslg * weight;
        totalSlg += batter.slg * weight;
        totalXba += batter.xba * weight;
        totalBa += batter.ba * weight;
        totalPA += weight;
        matchCount++;
      }
    }
    
    if (totalPA > 0 && matchCount >= 3) {
      const avgXwoba = totalXwoba / totalPA;
      const avgWoba = totalWoba / totalPA;
      const avgXslg = totalXslg / totalPA;
      const avgSlg = totalSlg / totalPA;
      const avgXba = totalXba / totalPA;
      const avgBa = totalBa / totalPA;
      
      // Statcast Edge: positive = team is BETTER than surface stats suggest
      // This is pure gold for betting — teams with positive edge are undervalued
      const xwobaEdge = avgXwoba - avgWoba;
      
      teamStats[abbr] = {
        teamXwoba: +avgXwoba.toFixed(3),
        teamWoba: +avgWoba.toFixed(3),
        teamXslg: +avgXslg.toFixed(3),
        teamSlg: +avgSlg.toFixed(3),
        teamXba: +avgXba.toFixed(3),
        teamBa: +avgBa.toFixed(3),
        xwobaEdge: +xwobaEdge.toFixed(3),
        // Offensive quality multiplier relative to league avg
        // League avg xwOBA ≈ .310
        offenseMultiplier: +(avgXwoba / 0.310).toFixed(3),
        matchedPlayers: matchCount,
        totalPA: totalPA,
      };
    } else {
      // Not enough data — use neutral
      teamStats[abbr] = {
        teamXwoba: 0.310,
        teamWoba: 0.310,
        teamXslg: 0.400,
        teamSlg: 0.400,
        teamXba: 0.250,
        teamBa: 0.250,
        xwobaEdge: 0,
        offenseMultiplier: 1.000,
        matchedPlayers: matchCount,
        totalPA: totalPA,
      };
    }
  }
  
  return teamStats;
}

// ==================== PITCHER ENHANCEMENT ====================

/**
 * Get Statcast-enhanced pitcher evaluation.
 * Blends our static pitcher DB ratings with real Statcast data.
 * 
 * Key insight: xERA is MORE PREDICTIVE than ERA for future performance.
 * A pitcher with 3.00 ERA but 4.20 xERA is OVERPERFORMING and will regress.
 * A pitcher with 4.50 ERA but 3.50 xERA is UNDERPERFORMING and will improve.
 */
function getStatcastPitcherAdjustment(pitcherName) {
  if (!cache.pitchers) return null;
  
  // Try exact match
  let statcast = cache.pitchers[pitcherName];
  if (!statcast) {
    // Fuzzy match — last name
    const lastName = pitcherName.split(' ').pop().toLowerCase();
    for (const [name, data] of Object.entries(cache.pitchers)) {
      if (name.toLowerCase().includes(lastName)) {
        statcast = data;
        break;
      }
    }
  }
  
  if (!statcast || !statcast.xera) return null;
  
  // ERA vs xERA gap tells us about luck/regression
  const eraGap = statcast.era - statcast.xera; // positive = lucky (ERA < xERA)
  
  // xwOBA against tells us about true quality of contact allowed
  const lgAvgWoba = 0.310;
  const xwobaQuality = (lgAvgWoba - statcast.xwoba) / lgAvgWoba; // positive = better than avg
  
  // Regression adjustment for the prediction engine
  // If a pitcher had 3.00 ERA but 4.20 xERA, we should expect closer to 3.60 going forward
  // Weight: 65% toward xERA, 35% toward actual (for early season predictions)
  const regressionWeight = 0.65;
  const trueERA = statcast.era * (1 - regressionWeight) + statcast.xera * regressionWeight;
  
  // Convert xERA difference to run scoring adjustment
  // 1.00 ERA difference ≈ 1.00 runs per 9 innings ≈ 0.61 runs per game (starter covers 5.5 IP)
  const runAdjustment = (statcast.era - trueERA) * (5.5 / 9);
  
  return {
    name: pitcherName,
    era: statcast.era,
    xera: statcast.xera,
    eraGap: +eraGap.toFixed(2),
    xba: statcast.xba,
    xslg: statcast.xslg,
    xwoba: statcast.xwoba,
    xwobaQuality: +xwobaQuality.toFixed(3),
    trueERA: +trueERA.toFixed(2),
    // Positive runAdjustment = pitcher is WORSE than ERA suggests (xERA > ERA)
    // Negative = pitcher is BETTER than ERA suggests (xERA < ERA)
    runAdjustment: +runAdjustment.toFixed(3),
    regressionDirection: eraGap > 0.3 ? 'LUCKY_DUE_FOR_REGRESSION' : 
                          eraGap < -0.3 ? 'UNLUCKY_DUE_FOR_IMPROVEMENT' : 'FAIR',
    confidence: statcast.pa >= 400 ? 'HIGH' : statcast.pa >= 200 ? 'MEDIUM' : 'LOW',
    sampleSize: statcast.pa,
  };
}

/**
 * Get team batting Statcast edge.
 * Returns the xwOBA-based offensive multiplier that adjusts expected runs.
 */
function getTeamBattingStatcast(teamAbbr) {
  if (!cache.teamBatting) return null;
  return cache.teamBatting[teamAbbr] || null;
}

// ==================== MAIN REFRESH ====================

/**
 * Refresh all Statcast data from Baseball Savant.
 * Call this on server startup and periodically (every 12h).
 */
async function refreshStatcast(force = false) {
  if (!force && loadCache()) {
    const pitcherCount = cache.pitchers ? Object.keys(cache.pitchers).length : 0;
    const batterCount = cache.batters ? Object.keys(cache.batters).length : 0;
    console.log(`[Statcast] Loaded from cache: ${pitcherCount} pitchers, ${batterCount} batters`);
    return { pitchers: pitcherCount, batters: batterCount, fromCache: true };
  }
  
  console.log('[Statcast] Fetching fresh data from Baseball Savant...');
  
  const [pitcherData, batterData] = await Promise.all([
    fetchPitcherStatcast(),
    fetchBatterStatcast(),
  ]);
  
  if (pitcherData) {
    cache.pitchers = pitcherData;
  }
  if (batterData) {
    cache.batters = batterData;
    cache.teamBatting = buildTeamBattingStatcast(batterData);
  }
  
  cache.lastFetch = Date.now();
  saveCache();
  
  const pitcherCount = cache.pitchers ? Object.keys(cache.pitchers).length : 0;
  const batterCount = cache.batters ? Object.keys(cache.batters).length : 0;
  const teamCount = cache.teamBatting ? Object.keys(cache.teamBatting).length : 0;
  
  console.log(`[Statcast] Fetched: ${pitcherCount} pitchers, ${batterCount} batters, ${teamCount} teams`);
  
  return { pitchers: pitcherCount, batters: batterCount, teams: teamCount, fromCache: false };
}

// ==================== ANALYSIS FUNCTIONS ====================

/**
 * Get pitchers who are most likely to regress (over/underperforming xERA).
 * These are the #1 edge for betting: fade lucky pitchers, back unlucky ones.
 */
function getRegressionCandidates(minPA = 200) {
  if (!cache.pitchers) return { lucky: [], unlucky: [] };
  
  const lucky = [];  // ERA way below xERA — due for regression UP (fade them)
  const unlucky = []; // ERA way above xERA — due for regression DOWN (back them)
  
  for (const [name, p] of Object.entries(cache.pitchers)) {
    if (p.pa < minPA) continue;
    
    const gap = p.era - p.xera;
    if (gap < -0.50) {
      lucky.push({ name, era: p.era, xera: p.xera, gap: +gap.toFixed(2), xwoba: p.xwoba, pa: p.pa });
    } else if (gap > 0.50) {
      unlucky.push({ name, era: p.era, xera: p.xera, gap: +gap.toFixed(2), xwoba: p.xwoba, pa: p.pa });
    }
  }
  
  lucky.sort((a, b) => a.gap - b.gap); // Most lucky first (biggest negative gap)
  unlucky.sort((a, b) => b.gap - a.gap); // Most unlucky first (biggest positive gap)
  
  return { lucky: lucky.slice(0, 20), unlucky: unlucky.slice(0, 20) };
}

/**
 * Get team xwOBA leaderboard — offensive quality ranking.
 */
function getTeamXwobaLeaderboard() {
  if (!cache.teamBatting) return [];
  
  return Object.entries(cache.teamBatting)
    .map(([abbr, data]) => ({ team: abbr, ...data }))
    .sort((a, b) => b.teamXwoba - a.teamXwoba);
}

/**
 * Get full Statcast report for a specific matchup.
 * Shows how Statcast adjusts the baseline prediction.
 */
function getMatchupStatcast(awayAbbr, homeAbbr, awayPitcherName, homePitcherName) {
  const report = {
    awayBatting: getTeamBattingStatcast(awayAbbr),
    homeBatting: getTeamBattingStatcast(homeAbbr),
    awayPitcher: awayPitcherName ? getStatcastPitcherAdjustment(awayPitcherName) : null,
    homePitcher: homePitcherName ? getStatcastPitcherAdjustment(homePitcherName) : null,
    adjustments: {},
  };
  
  // Calculate net Statcast adjustment for each team's expected runs
  let awayRunAdj = 0, homeRunAdj = 0;
  
  // Away team batting Statcast edge
  if (report.awayBatting && report.awayBatting.xwobaEdge !== 0) {
    // xwOBA edge translates to roughly ±0.5 runs per game per 0.010 xwOBA
    awayRunAdj += report.awayBatting.xwobaEdge * 50;
  }
  
  // Home team batting Statcast edge
  if (report.homeBatting && report.homeBatting.xwobaEdge !== 0) {
    homeRunAdj += report.homeBatting.xwobaEdge * 50;
  }
  
  // Home pitcher Statcast regression (affects AWAY team run scoring)
  if (report.homePitcher && report.homePitcher.runAdjustment !== 0) {
    // Positive runAdjustment = pitcher is worse than ERA, away team scores MORE
    awayRunAdj += report.homePitcher.runAdjustment;
  }
  
  // Away pitcher Statcast regression (affects HOME team run scoring)
  if (report.awayPitcher && report.awayPitcher.runAdjustment !== 0) {
    homeRunAdj += report.awayPitcher.runAdjustment;
  }
  
  report.adjustments = {
    awayRunAdj: +awayRunAdj.toFixed(3),
    homeRunAdj: +homeRunAdj.toFixed(3),
    totalRunAdj: +(awayRunAdj + homeRunAdj).toFixed(3),
    note: 'Positive = more runs expected than baseline model'
  };
  
  return report;
}

// ==================== EXPORTS ====================
module.exports = {
  refreshStatcast,
  getStatcastPitcherAdjustment,
  getTeamBattingStatcast,
  getRegressionCandidates,
  getTeamXwobaLeaderboard,
  getMatchupStatcast,
  getStatus() {
    return {
      pitchers: cache.pitchers ? cache.pitchers.size || Object.keys(cache.pitchers).length : 0,
      batters: cache.batters ? cache.batters.size || Object.keys(cache.batters).length : 0,
      teamBatting: cache.teamBatting ? Object.keys(cache.teamBatting).length : 0,
      lastFetch: cache.lastFetch || null,
    };
  },
  // Direct access for advanced use
  get cachedPitchers() { return cache.pitchers; },
  get cachedBatters() { return cache.batters; },
  get cachedTeamBatting() { return cache.teamBatting; },
  get lastFetch() { return cache.lastFetch; },
};
