/**
 * SportsSim Injury Service
 * 
 * Fetches injury reports from ESPN for all sports:
 *   - NBA, MLB, NHL injury data
 *   - Star player impact ratings
 *   - Rating adjustments when key players are out
 * 
 * Cache: 60-min refresh (injuries don't change as fast as scores)
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'injury-cache.json');
const CACHE_TTL = 60 * 60 * 1000; // 60 minutes

// ==================== ESPN TEAM NAME → ABBREVIATION ====================

const NBA_NAME_TO_ABBR = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
  'LA Clippers': 'LAC', 'Los Angeles Lakers': 'LAL', 'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP', 'New York Knicks': 'NYK', 'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR', 'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR', 'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS'
};

const NHL_NAME_TO_ABBR = {
  'Anaheim Ducks': 'ANA', 'Arizona Coyotes': 'ARI', 'Utah Hockey Club': 'ARI',
  'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF', 'Calgary Flames': 'CGY',
  'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL',
  'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET',
  'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK',
  'Minnesota Wild': 'MIN', 'Montréal Canadiens': 'MTL', 'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI',
  'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR',
  'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG'
};

const MLB_NAME_TO_ABBR = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM',
  'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Athletics': 'OAK', 'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH'
};

// ==================== STAR PLAYER IMPACT ====================
// Impact ratings: how much a player's absence affects team rating (in points/goals/runs)

const NBA_STAR_IMPACT = {
  'Nikola Jokic': 5.5, 'Shai Gilgeous-Alexander': 5.0, 'Luka Doncic': 5.0,
  'Giannis Antetokounmpo': 5.0, 'Joel Embiid': 4.5, 'Jayson Tatum': 4.5,
  'Anthony Davis': 4.0, 'LeBron James': 4.0, 'Kevin Durant': 4.5,
  'Stephen Curry': 4.5, 'Donovan Mitchell': 3.5, 'Devin Booker': 3.5,
  'Anthony Edwards': 4.0, 'Victor Wembanyama': 4.0, 'Ja Morant': 4.0,
  'Tyrese Haliburton': 3.5, 'Cade Cunningham': 3.5, 'Trae Young': 3.5,
  'Jalen Brunson': 4.0, 'Damian Lillard': 3.5, "De'Aaron Fox": 3.5,
  'Jimmy Butler': 3.5, 'Kawhi Leonard': 4.0, 'Paul George': 3.5,
  'Zion Williamson': 3.0, 'Paolo Banchero': 3.5, 'Scottie Barnes': 3.5,
  'Lauri Markkanen': 3.0, 'Domantas Sabonis': 3.5, 'Bam Adebayo': 3.0,
  'Evan Mobley': 3.0, 'Jarrett Allen': 2.5, 'Karl-Anthony Towns': 3.5,
  'Tyrese Maxey': 3.0, 'Kyrie Irving': 3.5, 'James Harden': 3.0,
};

const NHL_STAR_IMPACT = {
  'Connor McDavid': 0.4, 'Nathan MacKinnon': 0.35, 'Auston Matthews': 0.35,
  'Nikita Kucherov': 0.35, 'Leon Draisaitl': 0.3, 'Kirill Kaprizov': 0.3,
  'David Pastrnak': 0.3, 'Cale Makar': 0.3, 'Aleksander Barkov': 0.25,
  'Jack Hughes': 0.25, 'Matthew Tkachuk': 0.25, 'Mitch Marner': 0.25,
  'Artemi Panarin': 0.25, 'Sebastian Aho': 0.25, 'Jason Robertson': 0.25,
  'Sidney Crosby': 0.3, 'Alex Ovechkin': 0.25, 'Jack Eichel': 0.25,
  'Igor Shesterkin': 0.35, 'Connor Hellebuyck': 0.35, 'Andrei Vasilevskiy': 0.3,
  'Sergei Bobrovsky': 0.25, 'Ilya Sorokin': 0.25, 'Jeremy Swayman': 0.25,
  'Juuse Saros': 0.25, 'Jake Oettinger': 0.25,
};

const MLB_STAR_IMPACT = {
  'Shohei Ohtani': 0.6, 'Aaron Judge': 0.5, 'Mookie Betts': 0.45,
  'Ronald Acuna Jr.': 0.5, 'Juan Soto': 0.45, 'Freddie Freeman': 0.4,
  'Corey Seager': 0.4, 'Trea Turner': 0.35, 'Julio Rodriguez': 0.35,
  'Bobby Witt Jr.': 0.4, 'Gunnar Henderson': 0.35, 'Yordan Alvarez': 0.4,
  'Fernando Tatis Jr.': 0.4, 'Mike Trout': 0.4, 'Corbin Carroll': 0.35,
  'Marcus Semien': 0.3, 'Rafael Devers': 0.35, 'Pete Alonso': 0.3,
  'Vladimir Guerrero Jr.': 0.35, 'Bryce Harper': 0.4,
  'Gerrit Cole': 0.45, 'Spencer Strider': 0.4, 'Zack Wheeler': 0.4,
  'Corbin Burnes': 0.4, 'Shane Bieber': 0.35, 'Logan Webb': 0.35,
  'Tyler Glasnow': 0.4, 'Kevin Gausman': 0.35, 'Framber Valdez': 0.35,
};

// ==================== CACHE ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[injuries] Cache read error:', e.message);
  }
  return { nba: null, nhl: null, mlb: null, timestamps: {} };
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[injuries] Cache write error:', e.message);
  }
}

function isCacheFresh(sport, cache) {
  const ts = cache?.timestamps?.[sport];
  if (!ts) return false;
  return (Date.now() - ts) < CACHE_TTL;
}

// ==================== FETCH INJURIES ====================

async function fetchInjuries(espnSport, espnLeague, nameToAbbrMap, starImpactMap) {
  const fetch = require('node-fetch');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/injuries`;
  
  console.log(`[injuries] Fetching ${espnLeague.toUpperCase()} injuries from ESPN...`);
  
  try {
    const resp = await fetch(url, { timeout: 15000 });
    if (!resp.ok) {
      console.error(`[injuries] ESPN ${espnLeague} injuries returned ${resp.status}`);
      return {};
    }
    
    const data = await resp.json();
    const teamInjuries = {};
    
    // ESPN structure: { injuries: [ { id, displayName (team), injuries: [ { athlete, status, ... } ] } ] }
    const teams = data.injuries || [];
    
    for (const teamEntry of teams) {
      const teamName = teamEntry.displayName;
      if (!teamName) continue;
      
      const ourAbbr = nameToAbbrMap[teamName];
      if (!ourAbbr) {
        console.warn(`[injuries] Unknown team: "${teamName}"`);
        continue;
      }
      
      const injuryList = [];
      let totalImpact = 0;
      
      for (const inj of (teamEntry.injuries || [])) {
        const playerName = inj.athlete?.displayName || inj.athlete?.shortName || 'Unknown';
        const status = inj.status || inj.type?.description || 'Unknown';
        const detail = inj.shortComment || inj.longComment || '';
        const returnDate = inj.date;
        const position = inj.athlete?.position?.abbreviation || '';
        
        // Look up star impact
        let impact = 0;
        for (const [starName, starImpact] of Object.entries(starImpactMap)) {
          if (playerName.toLowerCase().includes(starName.toLowerCase()) || 
              starName.toLowerCase().includes(playerName.toLowerCase())) {
            impact = starImpact;
            break;
          }
        }
        
        // Determine if player is actually OUT (not just day-to-day or probable)
        const statusLower = (status + ' ' + (inj.type?.name || '')).toLowerCase();
        const isOut = statusLower.includes('out') || 
                     statusLower.includes('injured') ||
                     statusLower.includes('il') ||
                     statusLower.includes('suspended') ||
                     statusLower.includes('injury_status_out') ||
                     statusLower.includes('injury_status_injured');
        
        const isDayToDay = statusLower.includes('day-to-day') || 
                          statusLower.includes('questionable') ||
                          statusLower.includes('doubtful') ||
                          statusLower.includes('probable');
        
        if (isOut && impact > 0) {
          totalImpact += impact;
        } else if (isDayToDay && impact > 0) {
          totalImpact += impact * 0.3; // partial impact for day-to-day
        }
        
        injuryList.push({
          player: playerName,
          position,
          status,
          detail: detail.substring(0, 200),
          returnDate,
          impact,
          isOut,
          isDayToDay
        });
      }
      
      teamInjuries[ourAbbr] = {
        team: teamName,
        injuries: injuryList,
        totalImpact: +totalImpact.toFixed(2),
        outCount: injuryList.filter(i => i.isOut).length,
        dtdCount: injuryList.filter(i => i.isDayToDay).length,
        starPlayersOut: injuryList.filter(i => (i.isOut || i.isDayToDay) && i.impact > 0).map(i => ({
          player: i.player,
          impact: i.impact,
          status: i.status,
          detail: i.detail,
          isOut: i.isOut,
          isDayToDay: i.isDayToDay
        }))
      };
    }
    
    console.log(`[injuries] ${espnLeague.toUpperCase()}: fetched injuries for ${Object.keys(teamInjuries).length} teams`);
    return teamInjuries;
  } catch (e) {
    console.error(`[injuries] ${espnLeague} fetch error:`, e.message);
    return {};
  }
}

// ==================== MAIN REFRESH ====================

async function refreshAll(forceRefresh = false) {
  const cache = loadCache();
  const results = {
    nba: { status: 'skipped' },
    nhl: { status: 'skipped' },
    mlb: { status: 'skipped' }
  };
  
  const sports = [
    { key: 'nba', espnSport: 'basketball', espnLeague: 'nba', nameMap: NBA_NAME_TO_ABBR, impactMap: NBA_STAR_IMPACT },
    { key: 'nhl', espnSport: 'hockey', espnLeague: 'nhl', nameMap: NHL_NAME_TO_ABBR, impactMap: NHL_STAR_IMPACT },
    { key: 'mlb', espnSport: 'baseball', espnLeague: 'mlb', nameMap: MLB_NAME_TO_ABBR, impactMap: MLB_STAR_IMPACT }
  ];
  
  for (const s of sports) {
    if (forceRefresh || !isCacheFresh(s.key, cache)) {
      try {
        const data = await fetchInjuries(s.espnSport, s.espnLeague, s.nameMap, s.impactMap);
        if (Object.keys(data).length > 0) {
          cache[s.key] = data;
          cache.timestamps[s.key] = Date.now();
          results[s.key] = { status: 'refreshed', teams: Object.keys(data).length };
        } else {
          results[s.key] = { status: 'no-data' };
        }
      } catch (e) {
        console.error(`[injuries] ${s.key} refresh failed:`, e.message);
        results[s.key] = { status: 'error', error: e.message };
      }
    } else {
      results[s.key] = { status: 'cached', teams: Object.keys(cache[s.key] || {}).length };
    }
  }
  
  saveCache(cache);
  return results;
}

// ==================== DATA GETTERS ====================

function getNBAInjuries() {
  const cache = loadCache();
  return cache.nba || {};
}

function getNHLInjuries() {
  const cache = loadCache();
  return cache.nhl || {};
}

function getMLBInjuries() {
  const cache = loadCache();
  return cache.mlb || {};
}

function getTeamInjuries(sport, team) {
  const cache = loadCache();
  const sportData = cache[sport.toLowerCase()];
  if (!sportData) return null;
  return sportData[team.toUpperCase()] || null;
}

/**
 * Get injury adjustment for a team
 * Returns negative value (penalty) based on how many star players are out
 */
function getInjuryAdjustment(sport, team) {
  const injuries = getTeamInjuries(sport, team);
  if (!injuries) return { adjFactor: 0, outCount: 0, starPlayersOut: [] };
  
  return {
    adjFactor: -injuries.totalImpact, // negative = penalty
    outCount: injuries.outCount,
    starPlayersOut: injuries.starPlayersOut || []
  };
}

function getStatus() {
  const cache = loadCache();
  const now = Date.now();
  const sportStatus = (sport) => {
    const data = cache[sport] || {};
    const teamCount = Object.keys(data).length;
    // Count total star injuries across all teams
    let totalStarOut = 0;
    for (const team of Object.values(data)) {
      totalStarOut += (team.starPlayersOut || []).length;
    }
    return {
      hasData: teamCount > 0,
      teams: teamCount,
      starPlayersOut: totalStarOut,
      lastRefresh: cache.timestamps?.[sport] ? new Date(cache.timestamps[sport]).toISOString() : null,
      ageMinutes: cache.timestamps?.[sport] ? Math.round((now - cache.timestamps[sport]) / 60000) : null,
      isFresh: isCacheFresh(sport, cache)
    };
  };
  
  return {
    nba: sportStatus('nba'),
    nhl: sportStatus('nhl'),
    mlb: sportStatus('mlb')
  };
}

module.exports = {
  refreshAll,
  getNBAInjuries,
  getNHLInjuries,
  getMLBInjuries,
  getTeamInjuries,
  getInjuryAdjustment,
  getStatus,
  CACHE_TTL
};
