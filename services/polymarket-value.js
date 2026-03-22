/**
 * Polymarket Value Bridge — SportsSim v30.0
 * 
 * THE PREDICTION MARKET EDGE FINDER.
 * 
 * Bridges our model predictions with Polymarket prices to find +EV bets
 * that the crowd is mispricing. Also detects cross-market arbitrage
 * between traditional sportsbooks (via The Odds API) and Polymarket.
 * 
 * Key insight: Prediction markets are less efficient than sportsbooks
 * for individual games because they have lower liquidity and more
 * recreational money. Our models can exploit this.
 * 
 * Features:
 *   - Auto-matches Polymarket markets to our model predictions
 *   - Calculates true edge (model prob vs market price)
 *   - Cross-market arbitrage: Polymarket vs sportsbook lines
 *   - Futures value: championship odds vs power rating simulations
 *   - Kelly sizing for prediction market bets
 *   - Signal aggregation: combine with daily picks for conviction
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'polymarket-value-cache.json');
const CACHE_TTL = 15 * 60 * 1000; // 15 min

// Service imports (graceful degradation)
let polymarket, nbaModel, mlbModel, nhlModel, pitcherModel, playoffSeries;
try { polymarket = require('./polymarket'); } catch (e) {}
try { nbaModel = require('../models/nba'); } catch (e) {}
try { mlbModel = require('../models/mlb'); } catch (e) {}
try { nhlModel = require('../models/nhl'); } catch (e) {}
try { pitcherModel = require('../models/mlb-pitchers'); } catch (e) {}
try { playoffSeries = require('./playoff-series'); } catch (e) {}

// ==================== TEAM NAME MATCHING ====================

/**
 * Comprehensive team name → abbreviation mapping.
 * Polymarket uses full names, nicknames, city names, etc.
 * This map is THE key to bridging markets to models.
 */
const TEAM_ALIASES = {
  // NBA
  'hawks': 'ATL', 'atlanta hawks': 'ATL', 'atlanta': 'ATL',
  'celtics': 'BOS', 'boston celtics': 'BOS', 'boston': 'BOS',
  'nets': 'BKN', 'brooklyn nets': 'BKN', 'brooklyn': 'BKN',
  'hornets': 'CHA', 'charlotte hornets': 'CHA', 'charlotte': 'CHA',
  'bulls': 'CHI', 'chicago bulls': 'CHI', 'chicago': 'CHI',
  'cavaliers': 'CLE', 'cavs': 'CLE', 'cleveland cavaliers': 'CLE', 'cleveland': 'CLE',
  'mavericks': 'DAL', 'mavs': 'DAL', 'dallas mavericks': 'DAL', 'dallas': 'DAL',
  'nuggets': 'DEN', 'denver nuggets': 'DEN', 'denver': 'DEN',
  'pistons': 'DET', 'detroit pistons': 'DET', 'detroit': 'DET',
  'warriors': 'GSW', 'golden state warriors': 'GSW', 'golden state': 'GSW',
  'rockets': 'HOU', 'houston rockets': 'HOU', 'houston': 'HOU',
  'pacers': 'IND', 'indiana pacers': 'IND', 'indiana': 'IND',
  'clippers': 'LAC', 'la clippers': 'LAC', 'los angeles clippers': 'LAC',
  'lakers': 'LAL', 'la lakers': 'LAL', 'los angeles lakers': 'LAL',
  'grizzlies': 'MEM', 'memphis grizzlies': 'MEM', 'memphis': 'MEM',
  'heat': 'MIA', 'miami heat': 'MIA', 'miami': 'MIA',
  'bucks': 'MIL', 'milwaukee bucks': 'MIL', 'milwaukee': 'MIL',
  'timberwolves': 'MIN', 'wolves': 'MIN', 'minnesota timberwolves': 'MIN', 'minnesota': 'MIN',
  'pelicans': 'NOP', 'new orleans pelicans': 'NOP', 'new orleans': 'NOP',
  'knicks': 'NYK', 'new york knicks': 'NYK',
  'thunder': 'OKC', 'oklahoma city thunder': 'OKC', 'oklahoma city': 'OKC', 'okc': 'OKC',
  'magic': 'ORL', 'orlando magic': 'ORL', 'orlando': 'ORL',
  '76ers': 'PHI', 'sixers': 'PHI', 'philadelphia 76ers': 'PHI', 'philadelphia': 'PHI',
  'suns': 'PHX', 'phoenix suns': 'PHX', 'phoenix': 'PHX',
  'trail blazers': 'POR', 'blazers': 'POR', 'portland trail blazers': 'POR', 'portland': 'POR',
  'kings': 'SAC', 'sacramento kings': 'SAC', 'sacramento': 'SAC',
  'spurs': 'SAS', 'san antonio spurs': 'SAS', 'san antonio': 'SAS',
  'raptors': 'TOR', 'toronto raptors': 'TOR', 'toronto': 'TOR',
  'jazz': 'UTA', 'utah jazz': 'UTA', 'utah': 'UTA',
  'wizards': 'WAS', 'washington wizards': 'WAS', 'washington': 'WAS',
  
  // MLB
  'diamondbacks': 'ARI', 'dbacks': 'ARI', 'arizona diamondbacks': 'ARI', 'arizona': 'ARI',
  'braves': 'ATL', 'atlanta braves': 'ATL',
  'orioles': 'BAL', 'baltimore orioles': 'BAL', 'baltimore': 'BAL',
  'red sox': 'BOS', 'boston red sox': 'BOS',
  'cubs': 'CHC', 'chicago cubs': 'CHC',
  'white sox': 'CWS', 'chicago white sox': 'CWS',
  'reds': 'CIN', 'cincinnati reds': 'CIN', 'cincinnati': 'CIN',
  'guardians': 'CLE', 'cleveland guardians': 'CLE',
  'rockies': 'COL', 'colorado rockies': 'COL', 'colorado': 'COL',
  'tigers': 'DET', 'detroit tigers': 'DET',
  'astros': 'HOU', 'houston astros': 'HOU',
  'royals': 'KC', 'kansas city royals': 'KC', 'kansas city': 'KC',
  'angels': 'LAA', 'los angeles angels': 'LAA', 'la angels': 'LAA',
  'dodgers': 'LAD', 'los angeles dodgers': 'LAD', 'la dodgers': 'LAD',
  'marlins': 'MIA', 'miami marlins': 'MIA',
  'brewers': 'MIL', 'milwaukee brewers': 'MIL',
  'twins': 'MIN', 'minnesota twins': 'MIN',
  'mets': 'NYM', 'new york mets': 'NYM',
  'yankees': 'NYY', 'new york yankees': 'NYY',
  'athletics': 'OAK', 'oakland athletics': 'OAK', "a's": 'OAK', 'oakland': 'OAK',
  'phillies': 'PHI', 'philadelphia phillies': 'PHI',
  'pirates': 'PIT', 'pittsburgh pirates': 'PIT', 'pittsburgh': 'PIT',
  'padres': 'SD', 'san diego padres': 'SD', 'san diego': 'SD',
  'giants': 'SF', 'san francisco giants': 'SF', 'san francisco': 'SF',
  'mariners': 'SEA', 'seattle mariners': 'SEA', 'seattle': 'SEA',
  'cardinals': 'STL', 'st. louis cardinals': 'STL', 'st louis cardinals': 'STL', 'st louis': 'STL',
  'rays': 'TB', 'tampa bay rays': 'TB', 'tampa bay': 'TB',
  'rangers': 'TEX', 'texas rangers': 'TEX', 'texas': 'TEX',
  'blue jays': 'TOR', 'toronto blue jays': 'TOR',
  'nationals': 'WSH', 'washington nationals': 'WSH',
  
  // NHL
  'bruins': 'BOS', 'boston bruins': 'BOS',
  'sabres': 'BUF', 'buffalo sabres': 'BUF', 'buffalo': 'BUF',
  'flames': 'CGY', 'calgary flames': 'CGY', 'calgary': 'CGY',
  'hurricanes': 'CAR', 'carolina hurricanes': 'CAR', 'carolina': 'CAR',
  'blackhawks': 'CHI', 'chicago blackhawks': 'CHI',
  'avalanche': 'COL', 'colorado avalanche': 'COL',
  'blue jackets': 'CBJ', 'columbus blue jackets': 'CBJ', 'columbus': 'CBJ',
  'stars': 'DAL', 'dallas stars': 'DAL',
  'red wings': 'DET', 'detroit red wings': 'DET',
  'oilers': 'EDM', 'edmonton oilers': 'EDM', 'edmonton': 'EDM',
  'panthers': 'FLA', 'florida panthers': 'FLA', 'florida': 'FLA',
  'wild': 'MIN', 'minnesota wild': 'MIN',
  'canadiens': 'MTL', 'montreal canadiens': 'MTL', 'montreal': 'MTL',
  'predators': 'NSH', 'nashville predators': 'NSH', 'nashville': 'NSH',
  'devils': 'NJ', 'new jersey devils': 'NJ', 'new jersey': 'NJ',
  'islanders': 'NYI', 'new york islanders': 'NYI',
  'rangers': 'NYR', 'new york rangers': 'NYR',
  'senators': 'OTT', 'ottawa senators': 'OTT', 'ottawa': 'OTT',
  'flyers': 'PHI', 'philadelphia flyers': 'PHI',
  'penguins': 'PIT', 'pittsburgh penguins': 'PIT',
  'sharks': 'SJ', 'san jose sharks': 'SJ', 'san jose': 'SJ',
  'kraken': 'SEA', 'seattle kraken': 'SEA',
  'blues': 'STL', 'st. louis blues': 'STL', 'st louis blues': 'STL',
  'lightning': 'TB', 'tampa bay lightning': 'TB',
  'maple leafs': 'TOR', 'toronto maple leafs': 'TOR', 'leafs': 'TOR',
  'canucks': 'VAN', 'vancouver canucks': 'VAN', 'vancouver': 'VAN',
  'golden knights': 'VGK', 'vegas golden knights': 'VGK', 'vegas': 'VGK',
  'capitals': 'WSH', 'washington capitals': 'WSH',
  'jets': 'WPG', 'winnipeg jets': 'WPG', 'winnipeg': 'WPG',
  'ducks': 'ANA', 'anaheim ducks': 'ANA', 'anaheim': 'ANA',
};

/**
 * Resolve a team name/partial from a Polymarket question to an abbreviation.
 * Returns { abbr, sport } or null.
 */
function resolveTeam(text) {
  const lower = text.toLowerCase().trim();
  
  // Direct lookup
  if (TEAM_ALIASES[lower]) {
    return TEAM_ALIASES[lower];
  }
  
  // Partial match — find longest matching alias
  let bestMatch = null;
  let bestLen = 0;
  for (const [alias, abbr] of Object.entries(TEAM_ALIASES)) {
    if (lower.includes(alias) && alias.length > bestLen) {
      bestMatch = abbr;
      bestLen = alias.length;
    }
  }
  
  return bestMatch;
}

/**
 * Detect sport from question text
 */
function detectSport(text) {
  const lower = text.toLowerCase();
  if (lower.includes('nba') || lower.includes('basketball')) return 'nba';
  if (lower.includes('mlb') || lower.includes('baseball') || lower.includes('world series')) return 'mlb';
  if (lower.includes('nhl') || lower.includes('hockey') || lower.includes('stanley cup')) return 'nhl';
  if (lower.includes('nfl') || lower.includes('super bowl')) return 'nfl';
  
  // Check team names for sport inference
  const nbaTeams = ['celtics', 'lakers', 'warriors', 'bucks', 'nuggets', 'thunder', 'cavaliers', 'knicks', 'heat', 'sixers', 'suns', 'grizzlies', 'timberwolves', 'pelicans', 'magic', 'pacers', 'clippers', 'spurs', 'hawks', 'raptors', 'nets', 'hornets', 'pistons', 'rockets', 'trail blazers', 'jazz', 'wizards', 'kings'];
  const mlbTeams = ['dodgers', 'yankees', 'braves', 'astros', 'phillies', 'mets', 'padres', 'orioles', 'twins', 'mariners', 'guardians', 'brewers', 'cubs', 'red sox', 'rays', 'diamondbacks', 'royals', 'pirates', 'reds', 'cardinals', 'giants', 'rockies', 'tigers', 'white sox', 'angels', 'athletics', 'marlins', 'nationals', 'blue jays', 'rangers'];
  const nhlTeams = ['bruins', 'panthers', 'hurricanes', 'avalanche', 'stars', 'oilers', 'maple leafs', 'lightning', 'flames', 'canucks', 'wild', 'predators', 'kraken', 'capitals', 'islanders', 'devils', 'penguins', 'red wings', 'senators', 'sabres', 'flyers', 'blue jackets', 'blackhawks', 'ducks', 'sharks', 'golden knights', 'blues', 'canadiens', 'jets'];
  
  for (const t of nbaTeams) { if (lower.includes(t)) return 'nba'; }
  for (const t of mlbTeams) { if (lower.includes(t)) return 'mlb'; }
  for (const t of nhlTeams) { if (lower.includes(t)) return 'nhl'; }
  
  return null;
}

/**
 * Parse a "Team A vs Team B" or "Will Team X win/beat" market question.
 * Returns { away, home, type } or null.
 */
function parseGameMarket(question) {
  const lower = question.toLowerCase();
  
  // Pattern: "Will [Team] win/beat [Team]"
  let match = lower.match(/will\s+(?:the\s+)?(.+?)\s+(?:win|beat|defeat)\s+(?:the\s+)?(.+?)[\?]?$/);
  if (match) {
    const team1 = resolveTeam(match[1]);
    const team2 = resolveTeam(match[2]);
    if (team1 && team2) return { away: team1, home: team2, type: 'moneyline' };
  }
  
  // Pattern: "[Team] vs [Team]" or "[Team] v [Team]"
  match = lower.match(/(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)(?:\s*[\?]|$)/);
  if (match) {
    const team1 = resolveTeam(match[1]);
    const team2 = resolveTeam(match[2]);
    if (team1 && team2) return { away: team1, home: team2, type: 'moneyline' };
  }
  
  // Pattern: "Will [Team] win the [Championship]"
  match = lower.match(/will\s+(?:the\s+)?(.+?)\s+win\s+(?:the\s+)?(?:nba|mlb|nhl|world series|stanley cup|championship|title|finals|playoff)/);
  if (match) {
    const team = resolveTeam(match[1]);
    if (team) return { team, type: 'championship' };
  }
  
  // Pattern: "[Team] to win [Championship]"
  match = lower.match(/(.+?)\s+to\s+win\s+(?:the\s+)?(?:nba|mlb|nhl|world series|stanley cup|championship|title|finals|playoff)/);
  if (match) {
    const team = resolveTeam(match[1]);
    if (team) return { team, type: 'championship' };
  }
  
  return null;
}

// ==================== MODEL PROBABILITY MATCHING ====================

/**
 * Get model prediction for a game matchup.
 * Returns { homeWinProb, awayWinProb, totalRuns, source } or null.
 */
function getModelPrediction(away, home, sport) {
  try {
    let model = null;
    if (sport === 'nba') model = nbaModel;
    else if (sport === 'mlb') model = mlbModel;
    else if (sport === 'nhl') model = nhlModel;
    
    if (!model || !model.predict) return null;
    
    const pred = model.predict(away, home);
    if (!pred || pred.error) return null;
    
    return {
      homeWinProb: pred.homeWinProb,
      awayWinProb: pred.awayWinProb || (1 - pred.homeWinProb),
      totalRuns: pred.totalRuns || pred.totalGoals || pred.totalPoints,
      spread: pred.spread,
      homeML: pred.homeML,
      awayML: pred.awayML,
      source: `${sport.toUpperCase()} model`,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Get championship probability for a team from our power ratings.
 * Uses simplified playoff simulation based on Pythagorean win expectation.
 */
function getChampionshipProb(teamAbbr, sport) {
  try {
    let model = null;
    if (sport === 'nba') model = nbaModel;
    else if (sport === 'mlb') model = mlbModel;
    else if (sport === 'nhl') model = nhlModel;
    
    if (!model || !model.getTeams) return null;
    
    const teams = model.getTeams();
    const team = teams[teamAbbr];
    if (!team) return null;
    
    // Calculate Pythagorean win expectation
    let pyth;
    if (sport === 'mlb') {
      pyth = Math.pow(team.rsG, 1.83) / (Math.pow(team.rsG, 1.83) + Math.pow(team.raG, 1.83));
    } else if (sport === 'nba') {
      const ppg = team.ppg || team.offRtg || 110;
      const oppg = team.oppg || team.defRtg || 110;
      pyth = Math.pow(ppg, 14) / (Math.pow(ppg, 14) + Math.pow(oppg, 14));
    } else if (sport === 'nhl') {
      const gf = team.gfG || team.gf || 3;
      const ga = team.gaG || team.ga || 3;
      pyth = Math.pow(gf, 2) / (Math.pow(gf, 2) + Math.pow(ga, 2));
    }
    
    if (!pyth) return null;
    
    // Simplified championship probability:
    // For a sport with ~16 playoff teams, championship prob ≈
    // relative strength raised to a playoff rounds exponent
    // This is rough but directionally accurate
    const allTeams = Object.entries(teams);
    const nTeams = allTeams.length;
    
    // Calculate all team pyth values
    const teamPyths = {};
    let totalPyth = 0;
    for (const [abbr, t] of allTeams) {
      let tp;
      if (sport === 'mlb') {
        tp = Math.pow(t.rsG || 4, 1.83) / (Math.pow(t.rsG || 4, 1.83) + Math.pow(t.raG || 4, 1.83));
      } else if (sport === 'nba') {
        const p = t.ppg || t.offRtg || 110;
        const o = t.oppg || t.defRtg || 110;
        tp = Math.pow(p, 14) / (Math.pow(p, 14) + Math.pow(o, 14));
      } else {
        const gf = t.gfG || t.gf || 3;
        const ga = t.gaG || t.ga || 3;
        tp = Math.pow(gf, 2) / (Math.pow(gf, 2) + Math.pow(ga, 2));
      }
      teamPyths[abbr] = tp || 0.5;
      totalPyth += (tp || 0.5);
    }
    
    // Monte Carlo light: championship ≈ (team_strength / total)^playoff_boost
    // Playoff boost accounts for best-of-7 variance reduction
    const playoffBoost = sport === 'mlb' ? 1.2 : (sport === 'nba' ? 1.8 : 1.4);
    const rawProb = Math.pow(teamPyths[teamAbbr] / (totalPyth / nTeams), playoffBoost) / nTeams;
    
    // Clamp to reasonable range (no team >40%, no team <0.1%)
    const prob = Math.max(0.001, Math.min(0.40, rawProb));
    
    return {
      prob,
      pyth,
      record: team.w && team.l ? `${team.w}-${team.l}` : null,
      source: `${sport.toUpperCase()} power ratings`,
    };
  } catch (e) {
    return null;
  }
}

// ==================== VALUE SCANNING ====================

/**
 * Full Polymarket value scan — THE MONEY FINDER.
 * Fetches all sports markets and compares to model predictions.
 * Returns categorized value bets with edge calculations.
 */
async function scanForValue(options = {}) {
  const { sport = null, minEdge = 0.03, minLiquidity = 100 } = options;
  
  if (!polymarket) {
    return { error: 'Polymarket service not available' };
  }
  
  console.log('[Polymarket Value] Scanning for model vs market edge...');
  
  // Fetch markets
  let markets = [];
  try {
    markets = await polymarket.searchSportsMarkets({ sport, limit: 200, minVolume: 0 });
  } catch (e) {
    return { error: `Failed to fetch markets: ${e.message}` };
  }
  
  if (!markets || markets.length === 0) {
    return { markets: 0, valueBets: [], message: 'No sports markets found on Polymarket' };
  }
  
  const valueBets = [];
  const analyzed = [];
  let matched = 0;
  let unmatched = 0;
  
  for (const market of markets) {
    const question = market.question || '';
    const marketSport = detectSport(question) || polymarket.classifySport(market);
    if (sport && marketSport !== sport) continue;
    
    const outcomes = polymarket.parseMarketPrices(market);
    const parsed = parseGameMarket(question);
    
    let modelData = null;
    let marketType = 'unknown';
    
    if (parsed) {
      if (parsed.type === 'moneyline' && parsed.away && parsed.home) {
        modelData = getModelPrediction(parsed.away, parsed.home, marketSport);
        marketType = 'game';
        if (modelData) matched++;
        else unmatched++;
      } else if (parsed.type === 'championship' && parsed.team) {
        const champData = getChampionshipProb(parsed.team, marketSport);
        if (champData) {
          modelData = {
            homeWinProb: champData.prob, // "home" = the team winning it all
            source: champData.source,
            record: champData.record,
            pyth: champData.pyth,
          };
          marketType = 'championship';
          matched++;
        } else {
          unmatched++;
        }
      }
    } else {
      unmatched++;
    }
    
    // Process each outcome
    for (const outcome of outcomes) {
      if (!outcome.price || outcome.price <= 0.01 || outcome.price >= 0.99) continue;
      
      const totalImplied = outcomes.reduce((s, o) => s + (o.price || 0), 0);
      const juice = +((totalImplied - 1) * 100).toFixed(1);
      
      let edge = null;
      let modelProb = null;
      let signal = null;
      let confidence = 'LOW';
      
      if (modelData) {
        if (marketType === 'game') {
          // For game markets: "Yes" typically means the first team listed wins
          if (outcome.outcome === 'Yes' && parsed.away && parsed.home) {
            // "Will [away] beat [home]" → model awayWinProb
            modelProb = modelData.awayWinProb;
          } else if (outcome.outcome === 'No') {
            modelProb = modelData.homeWinProb;
          }
        } else if (marketType === 'championship') {
          if (outcome.outcome === 'Yes') {
            modelProb = modelData.homeWinProb;
          } else {
            modelProb = 1 - modelData.homeWinProb;
          }
        }
        
        if (modelProb !== null) {
          edge = +(modelProb - outcome.price).toFixed(4);
          
          if (edge > 0.10) { signal = '🔥 STRONG VALUE'; confidence = 'HIGH'; }
          else if (edge > 0.05) { signal = '✅ VALUE'; confidence = 'HIGH'; }
          else if (edge > minEdge) { signal = '📊 EDGE'; confidence = 'MEDIUM'; }
          else if (edge < -0.10) { signal = '❌ FADE'; confidence = 'HIGH'; }
          else if (edge < -0.05) { signal = '⚠️ OVERPRICED'; confidence = 'MEDIUM'; }
        }
      }
      
      const bet = {
        id: market.id,
        question,
        outcome: outcome.outcome,
        sport: marketSport,
        marketType,
        
        // Prices
        marketPrice: outcome.price,
        impliedProb: +(outcome.price * 100).toFixed(1),
        ml: outcome.ml,
        juice,
        
        // Model comparison
        modelProb: modelProb !== null ? +(modelProb * 100).toFixed(1) : null,
        edge: edge !== null ? +(edge * 100).toFixed(1) : null,
        rawEdge: edge,
        signal,
        confidence,
        modelSource: modelData?.source || null,
        
        // Kelly sizing (for +EV bets)
        kelly: edge > 0 ? calculateKelly(modelProb, outcome.price) : null,
        
        // Market info
        volume24hr: +(market.volume24hr || 0).toFixed(0),
        totalVolume: +(market.volumeNum || 0).toFixed(0),
        liquidity: +(market.liquidityNum || 0).toFixed(0),
        url: `https://polymarket.com/event/${market.slug}`,
        endDate: market.endDate,
        lastTrade: market.lastTradePrice,
        priceChange24h: market.oneDayPriceChange ? +(market.oneDayPriceChange * 100).toFixed(1) : null,
        priceChange1w: market.oneWeekPriceChange ? +(market.oneWeekPriceChange * 100).toFixed(1) : null,
        
        // Context
        teams: parsed ? (parsed.away && parsed.home ? { away: parsed.away, home: parsed.home } : { team: parsed.team }) : null,
        modelRecord: modelData?.record || null,
      };
      
      analyzed.push(bet);
      
      // Only add to value bets if we found edge
      if (edge !== null && Math.abs(edge) >= minEdge) {
        valueBets.push(bet);
      }
    }
  }
  
  // Sort by edge (biggest + first, then biggest - fade)
  valueBets.sort((a, b) => (b.rawEdge || 0) - (a.rawEdge || 0));
  
  const result = {
    timestamp: new Date().toISOString(),
    sport: sport || 'all',
    totalMarkets: markets.length,
    matched,
    unmatched,
    analyzed: analyzed.length,
    valueBetsFound: valueBets.length,
    valueBets,
    summary: {
      bySignal: {},
      bySport: {},
      totalEdge: valueBets.filter(v => v.rawEdge > 0).reduce((s, v) => s + (v.rawEdge || 0), 0).toFixed(3),
      topBet: valueBets[0] || null,
    },
  };
  
  // Count by signal
  for (const v of valueBets) {
    result.summary.bySignal[v.signal || 'none'] = (result.summary.bySignal[v.signal || 'none'] || 0) + 1;
    result.summary.bySport[v.sport || 'unknown'] = (result.summary.bySport[v.sport || 'unknown'] || 0) + 1;
  }
  
  // Cache
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2));
  } catch (e) {}
  
  return result;
}

// ==================== CROSS-MARKET ARBITRAGE ====================

/**
 * Cross-market arbitrage scanner:
 * Compares Polymarket prices to traditional sportsbook lines.
 * Finds situations where you can bet both sides across markets for guaranteed profit.
 * 
 * @param {Array} oddsData - Traditional sportsbook odds from The Odds API
 */
async function crossMarketScan(oddsData = []) {
  if (!polymarket) return { error: 'Polymarket service not available' };
  
  console.log('[Polymarket Value] Cross-market arbitrage scan...');
  
  let polyMarkets = [];
  try {
    polyMarkets = await polymarket.searchSportsMarkets({ limit: 200, minVolume: 0 });
  } catch (e) {
    return { error: `Polymarket fetch failed: ${e.message}` };
  }
  
  const opportunities = [];
  
  // Build lookup of Polymarket game prices
  const polyPrices = {};
  for (const market of polyMarkets) {
    const parsed = parseGameMarket(market.question || '');
    if (!parsed || parsed.type !== 'moneyline') continue;
    
    const outcomes = polymarket.parseMarketPrices(market);
    const yesPrice = outcomes.find(o => o.outcome === 'Yes')?.price;
    const noPrice = outcomes.find(o => o.outcome === 'No')?.price;
    
    if (yesPrice && noPrice && parsed.away && parsed.home) {
      const key = `${parsed.away}_${parsed.home}`;
      polyPrices[key] = {
        away: parsed.away,
        home: parsed.home,
        awayWinPrice: yesPrice,  // "Yes" = first team (away) wins
        homeWinPrice: noPrice,   // "No" = second team (home) wins
        awayML: polymarket.parseMarketPrices ? outcomes.find(o => o.outcome === 'Yes')?.ml : null,
        homeML: polymarket.parseMarketPrices ? outcomes.find(o => o.outcome === 'No')?.ml : null,
        question: market.question,
        url: `https://polymarket.com/event/${market.slug}`,
        liquidity: +(market.liquidityNum || 0),
        volume24hr: +(market.volume24hr || 0),
      };
    }
  }
  
  // Match against sportsbook odds
  for (const game of oddsData) {
    const homeTeam = game.home_team || game.homeTeam || '';
    const awayTeam = game.away_team || game.awayTeam || '';
    
    // Resolve to abbreviations
    const homeAbbr = resolveTeam(homeTeam);
    const awayAbbr = resolveTeam(awayTeam);
    if (!homeAbbr || !awayAbbr) continue;
    
    // Look up Polymarket price (try both orderings)
    const key1 = `${awayAbbr}_${homeAbbr}`;
    const key2 = `${homeAbbr}_${awayAbbr}`;
    const polyGame = polyPrices[key1] || polyPrices[key2];
    if (!polyGame) continue;
    
    // Get best sportsbook lines
    let bestHomeML = null, bestAwayML = null;
    let bestHomeBook = '', bestAwayBook = '';
    
    for (const bk of (game.bookmakers || [])) {
      for (const mkt of (bk.markets || [])) {
        if (mkt.key === 'h2h') {
          for (const o of mkt.outcomes) {
            const isHome = o.name === homeTeam;
            if (isHome) {
              if (bestHomeML === null || o.price > bestHomeML) {
                bestHomeML = o.price;
                bestHomeBook = bk.title || bk.key;
              }
            } else {
              if (bestAwayML === null || o.price > bestAwayML) {
                bestAwayML = o.price;
                bestAwayBook = bk.title || bk.key;
              }
            }
          }
        }
      }
    }
    
    if (!bestHomeML || !bestAwayML) continue;
    
    // Convert sportsbook ML to probabilities
    const bookHomeProb = mlToProb(bestHomeML);
    const bookAwayProb = mlToProb(bestAwayML);
    
    // Resolve which side is which in Polymarket
    const polyAwayPrice = polyGame.away === awayAbbr ? polyGame.awayWinPrice : polyGame.homeWinPrice;
    const polyHomePrice = polyGame.away === awayAbbr ? polyGame.homeWinPrice : polyGame.awayWinPrice;
    
    // Check for cross-market discrepancies
    const homeEdgePoly = bookHomeProb - polyHomePrice; // Positive = sportsbook thinks home is more likely
    const awayEdgePoly = bookAwayProb - polyAwayPrice;
    
    // Arbitrage check: can we bet opposite sides profitably?
    // Bet home on sportsbook + away on Polymarket (or vice versa)
    const arbCheck1 = (1 / bookHomeProb) + (1 / (1 - polyHomePrice));  // < 2 = arb
    const arbCheck2 = (1 / bookAwayProb) + (1 / (1 - polyAwayPrice));
    
    const discrepancy = Math.max(Math.abs(homeEdgePoly), Math.abs(awayEdgePoly));
    
    if (discrepancy > 0.03) { // At least 3% discrepancy
      const opp = {
        game: `${awayAbbr} @ ${homeAbbr}`,
        sport: detectSport(game.sport_key || '') || 'unknown',
        
        // Sportsbook side
        sportsbook: {
          homeML: bestHomeML,
          awayML: bestAwayML,
          homeProb: +(bookHomeProb * 100).toFixed(1),
          awayProb: +(bookAwayProb * 100).toFixed(1),
          bestHomeBook,
          bestAwayBook,
        },
        
        // Polymarket side
        polymarket: {
          homePrice: +(polyHomePrice * 100).toFixed(1),
          awayPrice: +(polyAwayPrice * 100).toFixed(1),
          homeML: probToML(polyHomePrice),
          awayML: probToML(polyAwayPrice),
          url: polyGame.url,
          liquidity: polyGame.liquidity,
          volume24hr: polyGame.volume24hr,
        },
        
        // Edge analysis
        discrepancy: +(discrepancy * 100).toFixed(1),
        direction: homeEdgePoly > 0 ? `HOME (${homeAbbr}) underpriced on Polymarket` : `AWAY (${awayAbbr}) underpriced on Polymarket`,
        
        // Best play
        bestPlay: Math.abs(homeEdgePoly) > Math.abs(awayEdgePoly) 
          ? { side: 'home', team: homeAbbr, edge: +(homeEdgePoly * 100).toFixed(1), where: homeEdgePoly > 0 ? 'Polymarket (buy)' : 'Sportsbook' }
          : { side: 'away', team: awayAbbr, edge: +(awayEdgePoly * 100).toFixed(1), where: awayEdgePoly > 0 ? 'Polymarket (buy)' : 'Sportsbook' },
        
        // Arbitrage potential
        isArbitrage: arbCheck1 < 2 || arbCheck2 < 2,
        arbReturn: arbCheck1 < 2 ? +((2 - arbCheck1) / arbCheck1 * 100).toFixed(2) : (arbCheck2 < 2 ? +((2 - arbCheck2) / arbCheck2 * 100).toFixed(2) : null),
      };
      
      opportunities.push(opp);
    }
  }
  
  // Sort by discrepancy (biggest first)
  opportunities.sort((a, b) => b.discrepancy - a.discrepancy);
  
  return {
    timestamp: new Date().toISOString(),
    gamesScanned: oddsData.length,
    polyMarketsScanned: polyMarkets.length,
    matchedGames: Object.keys(polyPrices).length,
    opportunities: opportunities.length,
    arbitrageFound: opportunities.filter(o => o.isArbitrage).length,
    results: opportunities,
  };
}

// ==================== FUTURES VALUE SCANNER ====================

/**
 * Scan championship futures on Polymarket vs our model simulations.
 * This is where the REAL money is — futures markets are the least efficient.
 */
async function scanFuturesValue(sport = null) {
  if (!polymarket) return { error: 'Polymarket service not available' };
  
  const sports = sport ? [sport] : ['nba', 'mlb', 'nhl'];
  const allValue = [];
  
  for (const s of sports) {
    let futures = [];
    try {
      futures = await polymarket.scanChampionshipFutures(s);
    } catch (e) { continue; }
    
    for (const future of futures) {
      const teamAbbr = resolveTeam(future.team || '');
      if (!teamAbbr) continue;
      
      const champData = getChampionshipProb(teamAbbr, s);
      if (!champData) continue;
      
      const marketProb = future.marketPrice || 0;
      const modelProb = champData.prob;
      const edge = modelProb - marketProb;
      
      allValue.push({
        sport: s.toUpperCase(),
        team: future.team,
        teamAbbr,
        question: future.question,
        
        // Market
        marketPrice: +(marketProb * 100).toFixed(1),
        marketML: probToML(marketProb),
        
        // Model
        modelProb: +(modelProb * 100).toFixed(1),
        modelML: probToML(modelProb),
        pyth: +champData.pyth.toFixed(3),
        record: champData.record,
        
        // Edge
        edge: +(edge * 100).toFixed(1),
        signal: edge > 0.05 ? '🔥 STRONG VALUE' : edge > 0.02 ? '✅ VALUE' : edge < -0.05 ? '❌ FADE' : edge < -0.02 ? '⚠️ OVERPRICED' : null,
        kelly: edge > 0 ? calculateKelly(modelProb, marketProb) : null,
        
        // Market info
        volume24hr: future.volume24hr,
        totalVolume: future.totalVolume,
        url: future.url,
        endDate: future.endDate,
      });
    }
  }
  
  // Sort by edge
  allValue.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  return {
    timestamp: new Date().toISOString(),
    sport: sport || 'all',
    futuresAnalyzed: allValue.length,
    valueFound: allValue.filter(v => v.edge > 2).length,
    results: allValue,
  };
}

// ==================== HELPERS ====================

function calculateKelly(trueProb, marketPrice) {
  // Kelly for binary prediction markets: f = (p * (1/marketPrice) - (1-p)) / ((1/marketPrice) - 1)
  // Simplified: f = (p - marketPrice) / (1 - marketPrice)
  if (!trueProb || !marketPrice || marketPrice >= 1 || marketPrice <= 0) return null;
  
  const b = (1 / marketPrice) - 1; // odds
  const p = trueProb;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  
  if (kelly <= 0) return null;
  
  return {
    full: +kelly.toFixed(4),
    half: +(kelly / 2).toFixed(4),
    quarter: +(kelly / 4).toFixed(4),
  };
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(prob) {
  if (!prob || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== CACHED RESULTS ====================

function getCachedResults() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age < CACHE_TTL) return { ...data, cached: true, cacheAge: Math.round(age / 1000) + 's' };
    }
  } catch (e) {}
  return null;
}

function getStatus() {
  const cached = getCachedResults();
  return {
    service: 'polymarket-value-bridge',
    version: '1.0',
    modelsAvailable: {
      nba: !!nbaModel,
      mlb: !!mlbModel,
      nhl: !!nhlModel,
    },
    polymarketAvailable: !!polymarket,
    cached: cached ? {
      valueBets: cached.valueBetsFound,
      age: cached.cacheAge,
      matched: cached.matched,
    } : null,
  };
}

module.exports = {
  scanForValue,
  crossMarketScan,
  scanFuturesValue,
  getModelPrediction,
  getChampionshipProb,
  resolveTeam,
  parseGameMarket,
  detectSport,
  calculateKelly,
  getCachedResults,
  getStatus,
};
