/**
 * Championship Futures Value Scanner — SportsSim v42.0
 * =====================================================
 * 
 * Pulls LIVE championship futures odds from The Odds API (outrights market)
 * and compares to our Monte Carlo playoff simulation model to find +EV futures.
 * 
 * WHY FUTURES = $$$:
 *   - Books set futures lines weeks/months in advance, creating stale prices
 *   - Public money piles on popular teams (LAL, NYK) → value on underdogs
 *   - Our model accounts for real current power ratings, not preseason hype
 *   - 21 days until NBA playoffs = BIGGEST WINDOW for futures edges
 *   - Championship futures have 15-30% hold → need big edges but they exist
 *   - Conference winner, division winner markets often less efficient
 * 
 * Supports: NBA, NHL, MLB championship futures
 * Data: The Odds API v4 outrights endpoint
 * Model: Monte Carlo playoff simulation (50K iterations)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'futures-scanner-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 min cache (futures don't move fast)

// Team name mapping: Odds API names → our abbreviations
const NBA_NAME_MAP = {
  'Oklahoma City Thunder': 'OKC', 'Boston Celtics': 'BOS', 'Cleveland Cavaliers': 'CLE',
  'Houston Rockets': 'HOU', 'Denver Nuggets': 'DEN', 'Golden State Warriors': 'GSW',
  'Memphis Grizzlies': 'MEM', 'Dallas Mavericks': 'DAL', 'Minnesota Timberwolves': 'MIN',
  'Milwaukee Bucks': 'MIL', 'New York Knicks': 'NYK', 'Detroit Pistons': 'DET',
  'Los Angeles Lakers': 'LAL', 'San Antonio Spurs': 'SAS', 'Philadelphia 76ers': 'PHI',
  'Indiana Pacers': 'IND', 'Miami Heat': 'MIA', 'Sacramento Kings': 'SAC',
  'Phoenix Suns': 'PHX', 'Chicago Bulls': 'CHI', 'Los Angeles Clippers': 'LAC',
  'New Orleans Pelicans': 'NOP', 'Atlanta Hawks': 'ATL', 'Orlando Magic': 'ORL',
  'Brooklyn Nets': 'BKN', 'Portland Trail Blazers': 'POR', 'Toronto Raptors': 'TOR',
  'Charlotte Hornets': 'CHA', 'Washington Wizards': 'WAS', 'Utah Jazz': 'UTA',
};

const NHL_NAME_MAP = {
  'Winnipeg Jets': 'WPG', 'Washington Capitals': 'WSH', 'Vegas Golden Knights': 'VGK',
  'Florida Panthers': 'FLA', 'Dallas Stars': 'DAL', 'Tampa Bay Lightning': 'TBL',
  'Colorado Avalanche': 'COL', 'Carolina Hurricanes': 'CAR', 'Toronto Maple Leafs': 'TOR',
  'Edmonton Oilers': 'EDM', 'Minnesota Wild': 'MIN', 'New York Rangers': 'NYR',
  'Los Angeles Kings': 'LAK', 'New Jersey Devils': 'NJD', 'St Louis Blues': 'STL',
  'Boston Bruins': 'BOS', 'Ottawa Senators': 'OTT', 'Vancouver Canucks': 'VAN',
  'Columbus Blue Jackets': 'CBJ', 'Calgary Flames': 'CGY', 'Detroit Red Wings': 'DET',
  'New York Islanders': 'NYI', 'Pittsburgh Penguins': 'PIT', 'Seattle Kraken': 'SEA',
  'Montreal Canadiens': 'MTL', 'Philadelphia Flyers': 'PHI', 'Buffalo Sabres': 'BUF',
  'Anaheim Ducks': 'ANA', 'Chicago Blackhawks': 'CHI', 'San Jose Sharks': 'SJS',
  'Nashville Predators': 'NSH', 'Utah Hockey Club': 'UTA',
};

const MLB_NAME_MAP = {
  'New York Yankees': 'NYY', 'Los Angeles Dodgers': 'LAD', 'Atlanta Braves': 'ATL',
  'Houston Astros': 'HOU', 'Philadelphia Phillies': 'PHI', 'Baltimore Orioles': 'BAL',
  'Cleveland Guardians': 'CLE', 'Texas Rangers': 'TEX', 'San Diego Padres': 'SD',
  'Milwaukee Brewers': 'MIL', 'Arizona Diamondbacks': 'ARI', 'Minnesota Twins': 'MIN',
  'Chicago Cubs': 'CHC', 'Seattle Mariners': 'SEA', 'Tampa Bay Rays': 'TB',
  'San Francisco Giants': 'SF', 'Kansas City Royals': 'KC', 'New York Mets': 'NYM',
  'Detroit Tigers': 'DET', 'Boston Red Sox': 'BOS', 'Toronto Blue Jays': 'TOR',
  'Los Angeles Angels': 'LAA', 'Cincinnati Reds': 'CIN', 'St. Louis Cardinals': 'STL',
  'Pittsburgh Pirates': 'PIT', 'Oakland Athletics': 'OAK', 'Washington Nationals': 'WSH',
  'Miami Marlins': 'MIA', 'Colorado Rockies': 'COL', 'Chicago White Sox': 'CWS',
};

const SPORT_KEYS = {
  nba: { key: 'basketball_nba_championship_winner', nameMap: NBA_NAME_MAP },
  nhl: { key: 'icehockey_nhl_championship_winner', nameMap: NHL_NAME_MAP },
  mlb: { key: 'baseball_mlb_championship_winner', nameMap: MLB_NAME_MAP },
};

// ==================== ODDS FETCHING ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch championship futures odds from The Odds API
 */
async function fetchFuturesOdds(sport, apiKey) {
  if (!apiKey) return { error: 'No ODDS_API_KEY configured', odds: [] };
  
  const sportConfig = SPORT_KEYS[sport];
  if (!sportConfig) return { error: `Unknown sport: ${sport}`, odds: [] };
  
  // Check cache first
  const cached = loadCache(sport);
  if (cached) return cached;
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportConfig.key}/odds/?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
    const data = await fetchJSON(url);
    
    if (!Array.isArray(data) || data.length === 0) {
      // Try alternate endpoint format
      const url2 = `https://api.the-odds-api.com/v4/sports/${sport === 'nba' ? 'basketball_nba' : sport === 'nhl' ? 'icehockey_nhl' : 'baseball_mlb'}/odds/?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
      const data2 = await fetchJSON(url2);
      if (Array.isArray(data2) && data2.length > 0) {
        const parsed = parseFuturesOdds(data2, sportConfig.nameMap, sport);
        saveCache(sport, parsed);
        return parsed;
      }
      return { error: 'No futures data available', odds: [], sport };
    }
    
    const parsed = parseFuturesOdds(data, sportConfig.nameMap, sport);
    saveCache(sport, parsed);
    return parsed;
  } catch (e) {
    console.error(`[futures-scanner] Error fetching ${sport} futures:`, e.message);
    return { error: e.message, odds: [], sport };
  }
}

/**
 * Parse Odds API response into normalized futures odds
 */
function parseFuturesOdds(data, nameMap, sport) {
  const teamOdds = {};
  const bookCount = {};
  
  for (const event of data) {
    for (const bookmaker of (event.bookmakers || [])) {
      const book = bookmaker.key;
      for (const market of (bookmaker.markets || [])) {
        if (market.key !== 'outrights') continue;
        for (const outcome of (market.outcomes || [])) {
          const teamName = outcome.name;
          const abbr = nameMap[teamName] || teamName;
          const odds = outcome.price;
          
          if (!teamOdds[abbr]) {
            teamOdds[abbr] = { 
              name: teamName, abbr, 
              bestOdds: odds, bestBook: book,
              allOdds: {},
              impliedProb: americanToImplied(odds)
            };
          }
          
          teamOdds[abbr].allOdds[book] = odds;
          
          // Track best (highest) odds
          if (odds > teamOdds[abbr].bestOdds) {
            teamOdds[abbr].bestOdds = odds;
            teamOdds[abbr].bestBook = book;
            teamOdds[abbr].impliedProb = americanToImplied(odds);
          }
          
          bookCount[book] = (bookCount[book] || 0) + 1;
        }
      }
    }
  }
  
  // Calculate consensus implied probability (average across books, de-vigged)
  for (const abbr of Object.keys(teamOdds)) {
    const odds = Object.values(teamOdds[abbr].allOdds);
    if (odds.length > 0) {
      const impliedProbs = odds.map(americanToImplied);
      teamOdds[abbr].consensusImplied = impliedProbs.reduce((a, b) => a + b, 0) / impliedProbs.length;
      teamOdds[abbr].bookCount = odds.length;
    }
  }
  
  // De-vig: calculate total implied probability and normalize
  const totalImplied = Object.values(teamOdds).reduce((sum, t) => sum + (t.consensusImplied || 0), 0);
  if (totalImplied > 0) {
    for (const abbr of Object.keys(teamOdds)) {
      teamOdds[abbr].deViggedProb = teamOdds[abbr].consensusImplied / totalImplied;
    }
  }
  
  return {
    sport,
    teams: Object.values(teamOdds).sort((a, b) => (b.deViggedProb || 0) - (a.deViggedProb || 0)),
    books: Object.keys(bookCount),
    totalImplied,
    holdPct: ((totalImplied - 1) * 100).toFixed(1) + '%',
    fetchedAt: new Date().toISOString()
  };
}

// ==================== VALUE DETECTION ====================

/**
 * Compare model championship probabilities with book odds to find +EV futures
 * 
 * @param {string} sport - 'nba', 'nhl', 'mlb'
 * @param {Object} modelProbs - { OKC: 0.25, BOS: 0.18, ... } from playoff sim
 * @param {Object} futuresData - from fetchFuturesOdds()
 * @param {Object} opts - { minEdge, bankroll, kellyFraction }
 */
function findFuturesValue(sport, modelProbs, futuresData, opts = {}) {
  const minEdge = opts.minEdge || 0.05; // 5% minimum edge
  const bankroll = opts.bankroll || 1000;
  const kellyFraction = opts.kellyFraction || 0.25; // Quarter Kelly for futures (high variance)
  
  if (!futuresData || !futuresData.teams || futuresData.error) {
    return { error: futuresData?.error || 'No futures data', bets: [] };
  }
  
  const valueBets = [];
  
  for (const team of futuresData.teams) {
    const modelProb = modelProbs[team.abbr];
    if (!modelProb || modelProb <= 0) continue;
    
    const bestOdds = team.bestOdds;
    const impliedProb = americanToImplied(bestOdds);
    const edge = modelProb - impliedProb;
    const edgePct = (edge / impliedProb * 100);
    
    // Kelly Criterion for futures
    const decimalOdds = americanToDecimal(bestOdds);
    const kellyFull = (modelProb * decimalOdds - 1) / (decimalOdds - 1);
    const kellyBet = Math.max(0, kellyFull * kellyFraction);
    const wager = +(bankroll * kellyBet).toFixed(2);
    
    // Expected value
    const ev = +(modelProb * (decimalOdds - 1) * wager - (1 - modelProb) * wager).toFixed(2);
    
    // Confidence scoring
    let confidence = 'LOW';
    if (edge > 0.10 && team.bookCount >= 3) confidence = 'HIGH';
    else if (edge > 0.05 && team.bookCount >= 2) confidence = 'MEDIUM';
    
    // Cross-book value: if our best odds are significantly better than consensus
    const crossBookEdge = team.bestOdds > 0 
      ? (americanToImplied(Math.min(...Object.values(team.allOdds))) - impliedProb) 
      : 0;
    
    if (edge >= minEdge) {
      valueBets.push({
        team: team.abbr,
        teamName: team.name,
        sport,
        market: 'championship',
        modelProb: +(modelProb * 100).toFixed(1),
        impliedProb: +(impliedProb * 100).toFixed(1),
        deViggedProb: +((team.deViggedProb || 0) * 100).toFixed(1),
        edge: +(edge * 100).toFixed(1),
        edgePct: +edgePct.toFixed(1),
        bestOdds,
        bestBook: team.bestBook,
        bookCount: team.bookCount || 0,
        allOdds: team.allOdds,
        kellyPct: +(kellyBet * 100).toFixed(2),
        wager,
        expectedValue: ev,
        confidence,
        // For sorting
        _edge: edge,
        _ev: ev
      });
    }
  }
  
  // Sort by edge (descending)
  valueBets.sort((a, b) => b._edge - a._edge);
  
  // Clean up internal fields
  valueBets.forEach(b => { delete b._edge; delete b._ev; });
  
  // Portfolio summary
  const totalWager = valueBets.reduce((sum, b) => sum + b.wager, 0);
  const totalEV = valueBets.reduce((sum, b) => sum + b.expectedValue, 0);
  
  return {
    sport,
    valueBets,
    count: valueBets.length,
    highConfidence: valueBets.filter(b => b.confidence === 'HIGH').length,
    mediumConfidence: valueBets.filter(b => b.confidence === 'MEDIUM').length,
    portfolio: {
      totalWager: +totalWager.toFixed(2),
      bankroll,
      exposure: +((totalWager / bankroll) * 100).toFixed(1) + '%',
      expectedValue: +totalEV.toFixed(2),
      expectedROI: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) + '%' : '0%'
    },
    holdPct: futuresData.holdPct,
    books: futuresData.books,
    timestamp: new Date().toISOString()
  };
}

// ==================== MULTI-SPORT SCAN ====================

/**
 * Scan all sports for championship futures value
 */
async function scanAllFutures(models, apiKey, opts = {}) {
  const results = {};
  
  for (const sport of ['nba', 'nhl', 'mlb']) {
    try {
      // Get model championship probabilities
      let modelProbs = {};
      
      if (sport === 'nba' && models.nba) {
        const playoffSeries = require('./playoff-series');
        const sim = playoffSeries.simulateFullPlayoffs(models.nba, opts.sims || 10000);
        if (sim && sim.championshipOdds) {
          for (const team of sim.championshipOdds) {
            modelProbs[team.team] = team.probability;
          }
        }
      }
      
      if (sport === 'nhl' && models.nhl) {
        // Use NHL power ratings to estimate championship probabilities
        // Simple approximation: power rating → playoff probability → championship
        const teams = models.nhl.getTeams();
        const ratings = {};
        let totalPower = 0;
        
        for (const [abbr, team] of Object.entries(teams)) {
          const winPct = team.w / Math.max(1, team.w + team.l + (team.otl || 0));
          const power = Math.pow(winPct, 3); // Cube to emphasize top teams
          ratings[abbr] = power;
          totalPower += power;
        }
        
        // Normalize to probabilities, with playoff cutoff
        const sorted = Object.entries(ratings).sort((a, b) => b[1] - a[1]);
        const playoffTeams = sorted.slice(0, 16); // Top 16 make playoffs
        const playoffPower = playoffTeams.reduce((sum, [, p]) => sum + p, 0);
        
        for (const [abbr, power] of playoffTeams) {
          modelProbs[abbr] = power / playoffPower;
        }
      }
      
      if (sport === 'mlb' && models.mlb) {
        // Use season simulator for MLB championship probabilities
        try {
          const seasonSim = require('./season-simulator');
          const simResult = seasonSim.getReport();
          if (simResult && simResult.worldSeries) {
            for (const team of simResult.worldSeries) {
              modelProbs[team.team] = team.probability / 100;
            }
          }
        } catch (e) {
          // Fallback: use power ratings
          const teams = models.mlb.getTeams();
          const ratings = {};
          let totalPower = 0;
          
          for (const [abbr, team] of Object.entries(teams)) {
            const power = Math.pow(team.power || 0, 2);
            ratings[abbr] = power;
            totalPower += power;
          }
          
          for (const [abbr, power] of Object.entries(ratings)) {
            modelProbs[abbr] = power / totalPower;
          }
        }
      }
      
      // Fetch live odds
      const futuresData = await fetchFuturesOdds(sport, apiKey);
      
      // Find value
      results[sport] = findFuturesValue(sport, modelProbs, futuresData, opts);
      results[sport].modelProbCount = Object.keys(modelProbs).length;
      
    } catch (e) {
      results[sport] = { error: e.message, valueBets: [], count: 0 };
    }
  }
  
  // Aggregate all value bets
  const allBets = [];
  for (const sport of ['nba', 'nhl', 'mlb']) {
    if (results[sport] && results[sport].valueBets) {
      allBets.push(...results[sport].valueBets);
    }
  }
  allBets.sort((a, b) => b.edge - a.edge);
  
  return {
    sports: results,
    allValueBets: allBets,
    totalCount: allBets.length,
    highConfidence: allBets.filter(b => b.confidence === 'HIGH').length,
    timestamp: new Date().toISOString()
  };
}

// ==================== UTILS ====================

function americanToImplied(odds) {
  if (!odds || odds === 0) return 0;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function americanToDecimal(odds) {
  if (!odds || odds === 0) return 1;
  if (odds > 0) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

function impliedToAmerican(prob) {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== CACHE ====================

function loadCache(sport) {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw[sport] && Date.now() - new Date(raw[sport].fetchedAt).getTime() < CACHE_TTL) {
      return raw[sport];
    }
  } catch (e) { /* no cache */ }
  return null;
}

function saveCache(sport, data) {
  try {
    let existing = {};
    if (fs.existsSync(CACHE_FILE)) {
      existing = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
    existing[sport] = data;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(existing, null, 2));
  } catch (e) { /* cache write failed */ }
}

function getStatus() {
  const status = { service: 'futures-scanner', version: '1.0' };
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      for (const sport of ['nba', 'nhl', 'mlb']) {
        if (raw[sport]) {
          status[sport] = {
            teams: raw[sport].teams?.length || 0,
            books: raw[sport].books?.length || 0,
            hold: raw[sport].holdPct,
            fetchedAt: raw[sport].fetchedAt,
            age: Math.round((Date.now() - new Date(raw[sport].fetchedAt).getTime()) / 60000) + ' min'
          };
        }
      }
    }
  } catch (e) { status.error = e.message; }
  return status;
}

module.exports = {
  fetchFuturesOdds,
  findFuturesValue,
  scanAllFutures,
  getStatus,
  americanToImplied,
  americanToDecimal,
  impliedToAmerican,
  NBA_NAME_MAP,
  NHL_NAME_MAP,
  MLB_NAME_MAP,
};
