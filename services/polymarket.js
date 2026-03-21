/**
 * Polymarket Sports Scanner — SportsSim v12.0
 * 
 * Scans Polymarket prediction markets for sports events,
 * compares market prices to our model projections,
 * and finds +EV opportunities across NBA, MLB, NHL, soccer, and more.
 * 
 * API: gamma-api.polymarket.com (free, no auth required for reads)
 * 
 * Markets include: championship futures, game winners, player props,
 * season totals, playoffs, and more.
 */

const fs = require('fs');
const path = require('path');

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CACHE_FILE = path.join(__dirname, 'polymarket-cache.json');
const CACHE_TTL = 10 * 60 * 1000; // 10 min cache

// ==================== SPORT CATEGORY MAPPING ====================

const SPORT_TAGS = {
  nba: ['NBA', 'Basketball', 'nba'],
  mlb: ['MLB', 'Baseball', 'mlb'],
  nhl: ['NHL', 'Hockey', 'nhl'],
  nfl: ['NFL', 'Football', 'nfl'],
  soccer: ['Soccer', 'Football', 'EPL', 'Premier League', 'Champions League', 'La Liga', 'Serie A', 'Bundesliga', 'MLS'],
  mma: ['UFC', 'MMA', 'Fighting'],
  esports: ['Esports', 'LoL', 'CS2', 'Dota', 'Valorant'],
  golf: ['Golf', 'PGA'],
  tennis: ['Tennis', 'ATP', 'WTA'],
};

// Keywords to identify sports markets in questions/descriptions
const SPORT_KEYWORDS = {
  nba: ['nba', 'basketball', 'celtics', 'lakers', 'warriors', 'bucks', 'nuggets', 'suns', 'thunder', 'cavaliers', 'knicks', 'heat', 'sixers', 'nets', 'bulls', 'hawks', 'raptors', 'pistons', 'pacers', 'magic', 'hornets', 'wizards', 'timberwolves', 'pelicans', 'mavericks', 'rockets', 'grizzlies', 'spurs', 'blazers', 'kings', 'clippers', 'jazz'],
  mlb: ['mlb', 'baseball', 'world series', 'yankees', 'dodgers', 'braves', 'astros', 'phillies', 'mets', 'padres', 'orioles', 'rangers', 'twins', 'mariners', 'guardians', 'brewers', 'cubs', 'red sox', 'rays', 'diamondbacks', 'royals', 'pirates', 'reds', 'cardinals', 'giants', 'rockies', 'tigers', 'white sox', 'angels', 'athletics', 'marlins', 'nationals', 'blue jays'],
  nhl: ['nhl', 'hockey', 'stanley cup', 'bruins', 'panthers', 'rangers', 'hurricanes', 'avalanche', 'stars', 'jets', 'oilers', 'maple leafs', 'lightning', 'flames', 'canucks', 'wild', 'predators', 'kraken', 'capitals', 'islanders', 'devils', 'penguins', 'red wings', 'senators', 'sabres', 'flyers', 'blue jackets', 'blackhawks', 'ducks', 'sharks', 'coyotes', 'golden knights'],
  nfl: ['nfl', 'super bowl', 'football', 'chiefs', 'eagles', 'bills', 'ravens', 'lions', 'cowboys', '49ers', 'packers', 'bengals', 'dolphins', 'steelers', 'texans', 'jaguars', 'broncos', 'chargers', 'raiders', 'seahawks', 'rams', 'cardinals', 'vikings', 'bears', 'saints', 'falcons', 'buccaneers', 'panthers', 'commanders', 'giants', 'jets', 'patriots', 'titans', 'colts', 'browns'],
  soccer: ['premier league', 'epl', 'la liga', 'serie a', 'bundesliga', 'champions league', 'europa league', 'mls', 'world cup', 'arsenal', 'manchester', 'liverpool', 'chelsea', 'tottenham', 'barcelona', 'real madrid', 'bayern', 'psg', 'juventus', 'inter milan', 'ac milan'],
};

// ==================== API FETCHING ====================

async function fetchFromGamma(endpoint, params = {}) {
  try {
    const fetch = require('node-fetch');
    const url = new URL(endpoint, GAMMA_API);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const resp = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      timeout: 10000,
    });
    if (!resp.ok) {
      console.error(`Polymarket API error: ${resp.status} ${resp.statusText}`);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.error('Polymarket fetch error:', e.message);
    return null;
  }
}

/**
 * Search for sports markets on Polymarket
 */
async function searchSportsMarkets(options = {}) {
  const {
    sport = null,       // 'nba', 'mlb', 'nhl', etc or null for all
    active = true,
    limit = 100,
    minVolume = 1000,   // min 24hr volume
    order = 'volume24hr',
  } = options;

  // Fetch active markets sorted by volume
  const markets = await fetchFromGamma('/markets', {
    active: active,
    closed: false,
    limit: limit,
    order: order,
    ascending: false,
    tag: 'Sports',
  });

  if (!markets || !Array.isArray(markets)) return [];

  // Also search for sports-related markets without the tag
  const additionalSearches = [];
  const sportSearchTerms = sport ? [sport.toUpperCase()] : ['NBA', 'MLB', 'NHL', 'NFL', 'Premier League', 'UFC'];
  
  for (const term of sportSearchTerms.slice(0, 3)) {
    additionalSearches.push(
      fetchFromGamma('/markets', {
        active: true,
        closed: false,
        limit: 50,
        order: 'volume24hr',
        ascending: false,
      })
    );
  }

  const additional = await Promise.all(additionalSearches);
  const allMarkets = [...markets];
  for (const result of additional) {
    if (result && Array.isArray(result)) {
      for (const m of result) {
        if (!allMarkets.find(e => e.id === m.id)) {
          allMarkets.push(m);
        }
      }
    }
  }

  // Filter to sports markets using keyword matching
  const sportsMarkets = allMarkets.filter(m => {
    const text = `${m.question || ''} ${m.description || ''}`.toLowerCase();
    
    // Check if it matches any sport keywords
    for (const [sportKey, keywords] of Object.entries(SPORT_KEYWORDS)) {
      if (sport && sportKey !== sport) continue;
      for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) return true;
      }
    }
    
    // Also check the tag
    if (m.events) {
      for (const ev of m.events) {
        const evText = `${ev.title || ''} ${ev.category || ''}`.toLowerCase();
        if (evText.includes('sport') || evText.includes('nba') || evText.includes('mlb') || 
            evText.includes('nfl') || evText.includes('nhl') || evText.includes('soccer') ||
            evText.includes('premier league') || evText.includes('ufc')) return true;
      }
    }
    
    return false;
  });

  // Filter by minimum volume
  return sportsMarkets.filter(m => (m.volume24hr || 0) >= minVolume || (m.volumeNum || 0) >= minVolume * 10);
}

/**
 * Classify which sport a market belongs to
 */
function classifySport(market) {
  const text = `${market.question || ''} ${market.description || ''}`.toLowerCase();
  
  for (const [sport, keywords] of Object.entries(SPORT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) return sport;
    }
  }
  return 'other';
}

/**
 * Parse market prices into useful format
 */
function parseMarketPrices(market) {
  const outcomes = JSON.parse(market.outcomes || '[]');
  const prices = JSON.parse(market.outcomePrices || '[]');
  
  const parsed = [];
  for (let i = 0; i < outcomes.length; i++) {
    const price = parseFloat(prices[i] || 0);
    parsed.push({
      outcome: outcomes[i],
      price: price,
      impliedProb: +(price * 100).toFixed(1),
      ml: priceToML(price),
    });
  }
  return parsed;
}

function priceToML(price) {
  if (!price || price <= 0 || price >= 1) return null;
  if (price >= 0.5) return Math.round(-100 * price / (1 - price));
  return Math.round(100 * (1 - price) / price);
}

function mlToPrice(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

// ==================== VALUE DETECTION ====================

/**
 * Compare Polymarket prices to our model projections
 */
function findValueBets(markets, modelPredictions = {}) {
  const valueBets = [];
  
  for (const market of markets) {
    const outcomes = parseMarketPrices(market);
    const sport = classifySport(market);
    const question = market.question || '';
    
    // Try to match with model predictions
    let modelProb = null;
    let modelSource = null;
    
    // Check if we have a model prediction for this market
    const matchKey = generateMatchKey(question, sport);
    if (modelPredictions[matchKey]) {
      modelProb = modelPredictions[matchKey];
      modelSource = 'model';
    }
    
    for (const outcome of outcomes) {
      if (!outcome.price || outcome.price <= 0.01 || outcome.price >= 0.99) continue;
      
      // Calculate juice/vig
      const totalImplied = outcomes.reduce((s, o) => s + o.price, 0);
      const juice = +((totalImplied - 1) * 100).toFixed(1);
      
      // If we have model prob, check for edge
      let edge = null;
      let signal = null;
      
      if (modelProb && outcome.outcome === 'Yes') {
        edge = +(modelProb - outcome.price).toFixed(3);
        if (edge > 0.03) signal = 'VALUE';
        else if (edge < -0.03) signal = 'FADE';
      }
      
      valueBets.push({
        id: market.id,
        question: question,
        slug: market.slug,
        sport,
        outcome: outcome.outcome,
        price: outcome.price,
        impliedProb: outcome.impliedProb,
        ml: outcome.ml,
        juice,
        volume24hr: +(market.volume24hr || 0).toFixed(0),
        totalVolume: +(market.volumeNum || 0).toFixed(0),
        liquidity: +(market.liquidityNum || 0).toFixed(0),
        modelProb: modelProb ? +(modelProb * 100).toFixed(1) : null,
        edge: edge ? +(edge * 100).toFixed(1) : null,
        signal,
        modelSource,
        url: `https://polymarket.com/event/${market.slug}`,
        endDate: market.endDate,
        lastTrade: market.lastTradePrice,
        priceChange24h: market.oneDayPriceChange,
        priceChange1w: market.oneWeekPriceChange,
      });
    }
  }
  
  return valueBets.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));
}

function generateMatchKey(question, sport) {
  // Generate a normalized key for matching markets to model predictions
  return `${sport}:${question.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 80)}`;
}

// ==================== FEATURED MARKETS ====================

/**
 * Get curated list of high-value sports markets
 */
async function getFeaturedSportsMarkets() {
  const results = {
    nba: [],
    mlb: [],
    nhl: [],
    nfl: [],
    soccer: [],
    other: [],
  };
  
  // Fetch all sports markets
  const markets = await searchSportsMarkets({ limit: 200, minVolume: 100 });
  
  for (const market of markets) {
    const sport = classifySport(market);
    const parsed = {
      id: market.id,
      question: market.question,
      slug: market.slug,
      sport,
      outcomes: parseMarketPrices(market),
      volume24hr: +(market.volume24hr || 0).toFixed(0),
      totalVolume: +(market.volumeNum || 0).toFixed(0),
      liquidity: +(market.liquidityNum || 0).toFixed(0),
      url: `https://polymarket.com/event/${market.slug}`,
      endDate: market.endDate,
      priceChange24h: market.oneDayPriceChange,
      priceChange1w: market.oneWeekPriceChange,
      lastTrade: market.lastTradePrice,
      acceptingOrders: market.acceptingOrders,
    };
    
    if (results[sport]) {
      results[sport].push(parsed);
    } else {
      results.other.push(parsed);
    }
  }
  
  // Sort each category by volume
  for (const sport of Object.keys(results)) {
    results[sport].sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));
  }
  
  return results;
}

// ==================== CHAMPIONSHIP FUTURES ====================

/**
 * Scan championship/futures markets and compare to model power ratings
 */
async function scanChampionshipFutures(sport, modelRatings = {}) {
  const markets = await searchSportsMarkets({ sport, limit: 100, minVolume: 0 });
  
  // Filter to futures-type markets (championships, playoffs, awards)
  const futuresKeywords = ['win', 'champion', 'mvp', 'playoff', 'finals', 'world series', 'super bowl', 'stanley cup', 'title'];
  const futures = markets.filter(m => {
    const q = (m.question || '').toLowerCase();
    return futuresKeywords.some(kw => q.includes(kw));
  });
  
  const analyzed = [];
  for (const market of futures) {
    const outcomes = parseMarketPrices(market);
    
    for (const outcome of outcomes) {
      // Try to match team to our model ratings
      let modelWinPct = null;
      let teamName = outcome.outcome;
      
      if (modelRatings[teamName]) {
        modelWinPct = modelRatings[teamName];
      }
      
      analyzed.push({
        id: market.id,
        question: market.question,
        team: teamName,
        marketPrice: outcome.price,
        impliedProb: outcome.impliedProb,
        ml: outcome.ml,
        modelWinPct: modelWinPct ? +(modelWinPct * 100).toFixed(1) : null,
        edge: modelWinPct ? +((modelWinPct - outcome.price) * 100).toFixed(1) : null,
        volume24hr: +(market.volume24hr || 0).toFixed(0),
        totalVolume: +(market.volumeNum || 0).toFixed(0),
        url: `https://polymarket.com/event/${market.slug}`,
        endDate: market.endDate,
      });
    }
  }
  
  return analyzed.sort((a, b) => Math.abs(b.edge || 0) - Math.abs(a.edge || 0));
}

// ==================== DAILY GAME MARKETS ====================

/**
 * Find daily game markets (who wins tonight's game, etc.)
 */
async function scanDailyGames(sport = null) {
  const allMarkets = await searchSportsMarkets({ sport, limit: 200, minVolume: 0 });
  
  // Filter for game-specific markets (vs, game, match, etc.)
  const gameKeywords = ['vs', 'game', 'match', 'win', 'beat', 'defeat', 'tonight'];
  const gameMarkets = allMarkets.filter(m => {
    const q = (m.question || '').toLowerCase();
    // Active, not futures, game-level
    return gameKeywords.some(kw => q.includes(kw)) && m.acceptingOrders;
  });
  
  return gameMarkets.map(m => ({
    id: m.id,
    question: m.question,
    slug: m.slug,
    sport: classifySport(m),
    outcomes: parseMarketPrices(m),
    volume24hr: +(m.volume24hr || 0).toFixed(0),
    totalVolume: +(m.volumeNum || 0).toFixed(0),
    liquidity: +(m.liquidityNum || 0).toFixed(0),
    url: `https://polymarket.com/event/${m.slug}`,
    endDate: m.endDate,
    lastTrade: m.lastTradePrice,
    acceptingOrders: m.acceptingOrders,
  }));
}

// ==================== MOVERS & SHAKERS ====================

/**
 * Find markets with big price movements (smart money signals)
 */
async function findMovers(sport = null) {
  const markets = await searchSportsMarkets({ sport, limit: 200, minVolume: 500 });
  
  const movers = markets
    .filter(m => m.oneDayPriceChange && Math.abs(m.oneDayPriceChange) > 0.02)
    .map(m => ({
      id: m.id,
      question: m.question,
      slug: m.slug,
      sport: classifySport(m),
      outcomes: parseMarketPrices(m),
      priceChange24h: +(m.oneDayPriceChange * 100).toFixed(1),
      priceChange1w: m.oneWeekPriceChange ? +(m.oneWeekPriceChange * 100).toFixed(1) : null,
      volume24hr: +(m.volume24hr || 0).toFixed(0),
      direction: m.oneDayPriceChange > 0 ? '📈' : '📉',
      url: `https://polymarket.com/event/${m.slug}`,
    }))
    .sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h));
  
  return movers;
}

// ==================== CACHE ====================

let polyCache = { data: null, ts: 0 };

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (raw.ts && (Date.now() - raw.ts) < CACHE_TTL) {
        polyCache = raw;
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

function saveCache(data) {
  polyCache = { data, ts: Date.now() };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(polyCache, null, 2));
  } catch (e) { /* ignore */ }
}

// ==================== FULL SCAN ====================

/**
 * Full Polymarket sports scan — the main entry point
 */
async function fullScan(options = {}) {
  const { sport = null, models = {} } = options;
  
  // Check cache
  const cacheKey = sport || 'all';
  if (polyCache.data && polyCache.data.cacheKey === cacheKey && (Date.now() - polyCache.ts) < CACHE_TTL) {
    return { ...polyCache.data, cached: true };
  }
  
  console.log(`[Polymarket] Scanning sports markets${sport ? ` for ${sport.toUpperCase()}` : ''}...`);
  
  // Run scans in parallel
  const [featured, movers, dailyGames] = await Promise.all([
    getFeaturedSportsMarkets(),
    findMovers(sport),
    scanDailyGames(sport),
  ]);
  
  // Count totals
  let totalMarkets = 0;
  let totalVolume24h = 0;
  for (const sport of Object.values(featured)) {
    totalMarkets += sport.length;
    totalVolume24h += sport.reduce((s, m) => s + (m.volume24hr || 0), 0);
  }
  
  const result = {
    cacheKey,
    timestamp: new Date().toISOString(),
    summary: {
      totalMarkets,
      totalVolume24h: Math.round(totalVolume24h),
      sportsFound: Object.entries(featured).filter(([_, v]) => v.length > 0).map(([k]) => k),
      moversCount: movers.length,
      dailyGamesCount: dailyGames.length,
    },
    featured,
    movers: movers.slice(0, 20),
    dailyGames: dailyGames.slice(0, 20),
  };
  
  saveCache(result);
  return result;
}

function getStatus() {
  return {
    service: 'polymarket-scanner',
    version: '1.0',
    api: GAMMA_API,
    cacheAge: polyCache.ts ? Math.round((Date.now() - polyCache.ts) / 1000) + 's' : null,
    cachedMarkets: polyCache.data ? polyCache.data.summary?.totalMarkets : 0,
    supportedSports: Object.keys(SPORT_KEYWORDS),
  };
}

module.exports = {
  fullScan,
  searchSportsMarkets,
  getFeaturedSportsMarkets,
  scanChampionshipFutures,
  scanDailyGames,
  findMovers,
  findValueBets,
  parseMarketPrices,
  classifySport,
  getStatus,
  SPORT_KEYWORDS,
};
