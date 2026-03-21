/**
 * Kalshi Scanner Service — services/kalshi.js
 * 
 * Scans Kalshi prediction markets for +EV opportunities.
 * Compares Kalshi contract prices to our model probabilities.
 * 
 * Markets covered:
 *   - KXNBATEAMTOTAL: NBA team totals (e.g., PHX 110+ points)
 *   - KXNBASPREAD: NBA game spreads
 *   - KXNBA1HSPREAD: NBA first half spreads
 *   - KXNBA: NBA championship futures
 *   - KXMLB: MLB futures
 *   - KXNHL: NHL futures
 * 
 * No API key needed — Kalshi public market data is free.
 * Cache: 15-min refresh for active markets.
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'kalshi-cache.json');
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const BASE_URL = 'https://api.elections.kalshi.com/v1';

// Series tickers we scan
const SERIES = {
  NBA_TEAM_TOTAL: 'KXNBATEAMTOTAL',
  NBA_SPREAD: 'KXNBASPREAD',
  NBA_1H_SPREAD: 'KXNBA1HSPREAD',
  NBA_CHAMP: 'KXNBA',
  MLB_CHAMP: 'KXMLB',
  NHL_CHAMP: 'KXNHL'
};

// ==================== CACHE ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[kalshi] Cache read error:', e.message);
  }
  return { markets: null, timestamp: null };
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('[kalshi] Cache write error:', e.message);
  }
}

function isCacheFresh() {
  const cache = loadCache();
  if (!cache.timestamp) return false;
  return (Date.now() - cache.timestamp) < CACHE_TTL;
}

// ==================== API FETCHER ====================

async function fetchKalshiEvents(seriesTicker, limit = 100) {
  const fetch = require('node-fetch');
  const url = `${BASE_URL}/events/?series_ticker=${seriesTicker}&limit=${limit}`;
  
  try {
    const resp = await fetch(url, { timeout: 15000 });
    if (!resp.ok) {
      console.error(`[kalshi] API returned ${resp.status} for ${seriesTicker}`);
      return [];
    }
    const data = await resp.json();
    return data.events || [];
  } catch (e) {
    console.error(`[kalshi] Fetch error for ${seriesTicker}:`, e.message);
    return [];
  }
}

// ==================== NBA TEAM TOTAL PARSER ====================

/**
 * Parse NBA team total markets into structured format.
 * Ticker format: KXNBATEAMTOTAL-26MAR21MILPHX-PHX110
 *   → MIL @ PHX game, PHX 110+ points market
 */
function parseNBATeamTotals(events) {
  const games = [];
  
  for (const event of events) {
    // Parse event title: "Milwaukee at Phoenix: Team Totals"
    const titleMatch = event.title?.match(/(.+?) at (.+?): Team Totals/i);
    if (!titleMatch) continue;
    
    const awayFull = titleMatch[1].trim();
    const homeFull = titleMatch[2].trim();
    
    // Parse ticker for date: KXNBATEAMTOTAL-26MAR21MILPHX
    const tickerMatch = event.ticker?.match(/KXNBATEAMTOTAL-(\d{2})([A-Z]{3})(\d{2})/);
    let gameDate = null;
    if (tickerMatch) {
      const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
      const year = 2000 + parseInt(tickerMatch[1]);
      const month = months[tickerMatch[2]] ?? 0;
      const day = parseInt(tickerMatch[3]);
      gameDate = new Date(year, month, day).toISOString().split('T')[0];
    }
    
    const contracts = [];
    for (const market of (event.markets || [])) {
      // Parse ticker: KXNBATEAMTOTAL-26MAR21MILPHX-PHX110
      const mMatch = market.ticker_name?.match(/-([A-Z]+)(\d+)$/);
      if (!mMatch) continue;
      
      const team = mMatch[1];
      const threshold = parseInt(mMatch[2]);
      
      contracts.push({
        ticker: market.ticker_name,
        team,
        threshold,
        description: `${team} ${threshold}+ points`,
        yesBid: market.yes_bid, // cents — what you can sell YES at
        yesAsk: market.yes_ask, // cents — what you can buy YES at
        lastPrice: market.last_price,
        status: market.status,
        // Implied probability (from ask price for YES)
        impliedProbYes: market.yes_ask ? market.yes_ask / 100 : null,
        impliedProbNo: market.yes_bid ? 1 - (market.yes_bid / 100) : null,
        // Volume indicator
        volume: market.volume || 0
      });
    }
    
    games.push({
      event: event.ticker,
      title: event.title,
      away: awayFull,
      home: homeFull,
      gameDate,
      targetDatetime: event.target_datetime,
      contracts: contracts.sort((a, b) => a.threshold - b.threshold)
    });
  }
  
  return games;
}

// ==================== NBA SPREAD PARSER ====================

function parseNBASpreads(events) {
  const games = [];
  
  for (const event of events) {
    const titleMatch = event.title?.match(/(.+?) (?:at|vs\.?) (.+?):/i);
    if (!titleMatch) continue;
    
    const contracts = [];
    for (const market of (event.markets || [])) {
      contracts.push({
        ticker: market.ticker_name,
        description: market.subtitle || market.ticker_name,
        yesBid: market.yes_bid,
        yesAsk: market.yes_ask,
        lastPrice: market.last_price,
        status: market.status,
        impliedProbYes: market.yes_ask ? market.yes_ask / 100 : null
      });
    }
    
    games.push({
      event: event.ticker,
      title: event.title,
      contracts
    });
  }
  
  return games;
}

// ==================== FUTURES PARSER ====================

function parseFutures(events, sport) {
  const results = [];
  
  for (const event of events) {
    for (const market of (event.markets || [])) {
      // Extract team from ticker (e.g., KXNBA-26-BOS → BOS)
      const teamMatch = market.ticker_name?.match(/-([A-Z]+)$/);
      if (!teamMatch) continue;
      
      results.push({
        sport,
        ticker: market.ticker_name,
        team: teamMatch[1],
        title: event.title,
        yesBid: market.yes_bid,
        yesAsk: market.yes_ask,
        lastPrice: market.last_price,
        impliedProbYes: market.yes_ask ? market.yes_ask / 100 : null,
        status: market.status
      });
    }
  }
  
  return results.sort((a, b) => (b.lastPrice || 0) - (a.lastPrice || 0));
}

// ==================== VALUE SCANNER ====================

/**
 * Compare Kalshi team total contracts against our NBA model predictions.
 * @param {Array} kalshiGames - parsed team total data from parseNBATeamTotals
 * @param {Function} predictFn - NBA model predict function
 * @returns {Array} value bets sorted by edge
 */
function scanTeamTotalValue(kalshiGames, predictFn) {
  if (!predictFn) return [];
  
  // Team name → abbreviation map
  const NAME_TO_ABBR = {
    'Milwaukee': 'MIL', 'Phoenix': 'PHX', 'Philadelphia': 'PHI', 'Utah': 'UTA',
    'Los Angeles C': 'LAC', 'Dallas': 'DAL', 'Indiana': 'IND', 'Sacramento': 'SAC',
    'Golden State': 'GSW', 'Houston': 'HOU', 'Boston': 'BOS', 'Oklahoma City': 'OKC',
    'Cleveland': 'CLE', 'Denver': 'DEN', 'New York': 'NYK', 'Memphis': 'MEM',
    'Minnesota': 'MIN', 'Miami': 'MIA', 'Atlanta': 'ATL', 'Chicago': 'CHI',
    'New Orleans': 'NOP', 'Orlando': 'ORL', 'Charlotte': 'CHA', 'Washington': 'WAS',
    'Brooklyn': 'BKN', 'Toronto': 'TOR', 'Portland': 'POR', 'Detroit': 'DET',
    'San Antonio': 'SAS', 'Los Angeles L': 'LAL', 'LA Lakers': 'LAL', 'LA Clippers': 'LAC',
    'Lakers': 'LAL', 'Clippers': 'LAC'
  };
  
  const values = [];
  
  for (const game of kalshiGames) {
    const awayAbbr = NAME_TO_ABBR[game.away] || guessAbbr(game.away);
    const homeAbbr = NAME_TO_ABBR[game.home] || guessAbbr(game.home);
    
    if (!awayAbbr || !homeAbbr) continue;
    
    // Get model prediction
    let pred;
    try {
      pred = predictFn(awayAbbr, homeAbbr);
      if (pred.error) continue;
    } catch (e) { continue; }
    
    // Our model gives predicted scores — compare to Kalshi thresholds
    const awayPredScore = pred.predictedScore?.away || pred.awayExpRuns;
    const homePredScore = pred.predictedScore?.home || pred.homeExpRuns;
    const totalPred = pred.predictedTotal || pred.totalRuns || (awayPredScore + homePredScore);
    
    for (const contract of game.contracts) {
      if (contract.status !== 'active') continue;
      if (!contract.yesAsk && !contract.yesBid) continue;
      
      // Determine which team this contract is for
      let teamPredScore;
      if (contract.team === homeAbbr || game.home.includes(contract.team)) {
        teamPredScore = homePredScore;
      } else if (contract.team === awayAbbr || game.away.includes(contract.team)) {
        teamPredScore = awayPredScore;
      } else {
        continue;
      }
      
      if (!teamPredScore) continue;
      
      // Estimate probability using normal distribution
      // NBA scoring std dev is ~12 points per team per game
      const stdDev = 12;
      const zScore = (contract.threshold - teamPredScore) / stdDev;
      const modelProbOver = 1 - normalCDF(zScore);
      
      // Compare to Kalshi price
      // YES = team scores >= threshold
      const kalshiProbYes = contract.impliedProbYes || (contract.yesAsk / 100);
      const kalshiProbNo = contract.impliedProbNo || (1 - contract.yesBid / 100);
      
      // YES edge: our model thinks it's more likely than Kalshi price
      if (kalshiProbYes && modelProbOver > kalshiProbYes + 0.05) {
        const edge = modelProbOver - kalshiProbYes;
        const ev = (modelProbOver * (1 - kalshiProbYes) - (1 - modelProbOver) * kalshiProbYes) * 100;
        values.push({
          type: 'TEAM_TOTAL',
          side: 'YES',
          ticker: contract.ticker,
          game: `${awayAbbr} @ ${homeAbbr}`,
          gameDate: game.gameDate,
          pick: `${contract.team} ${contract.threshold}+ YES`,
          description: `Bet YES on ${contract.team} scoring ${contract.threshold}+ points`,
          modelProb: +(modelProbOver * 100).toFixed(1),
          kalshiPrice: contract.yesAsk,
          kalshiProb: +(kalshiProbYes * 100).toFixed(1),
          edge: +(edge * 100).toFixed(1),
          ev: +ev.toFixed(1),
          teamPredScore: +teamPredScore.toFixed(1),
          threshold: contract.threshold,
          confidence: edge >= 0.15 ? 'HIGH' : edge >= 0.08 ? 'MEDIUM' : 'LOW'
        });
      }
      
      // NO edge: our model thinks the team UNDER-scores
      const modelProbUnder = 1 - modelProbOver;
      if (kalshiProbNo && modelProbUnder > kalshiProbNo + 0.05) {
        const edge = modelProbUnder - kalshiProbNo;
        const ev = (modelProbUnder * kalshiProbNo - (1 - modelProbUnder) * (1 - kalshiProbNo)) * 100;
        values.push({
          type: 'TEAM_TOTAL',
          side: 'NO',
          ticker: contract.ticker,
          game: `${awayAbbr} @ ${homeAbbr}`,
          gameDate: game.gameDate,
          pick: `${contract.team} ${contract.threshold}+ NO`,
          description: `Bet NO on ${contract.team} scoring ${contract.threshold}+ points`,
          modelProb: +(modelProbUnder * 100).toFixed(1),
          kalshiPrice: 100 - contract.yesBid, // cost to buy NO
          kalshiProb: +(kalshiProbNo * 100).toFixed(1),
          edge: +(edge * 100).toFixed(1),
          ev: +ev.toFixed(1),
          teamPredScore: +teamPredScore.toFixed(1),
          threshold: contract.threshold,
          confidence: edge >= 0.15 ? 'HIGH' : edge >= 0.08 ? 'MEDIUM' : 'LOW'
        });
      }
    }
  }
  
  return values.sort((a, b) => b.edge - a.edge);
}

// ==================== CHAMPIONSHIP FUTURES VALUE ====================

/**
 * Compare Kalshi championship futures to our power ratings.
 */
function scanFuturesValue(kalshiFutures, powerRatings) {
  if (!powerRatings || !kalshiFutures.length) return [];
  
  const values = [];
  
  // Simple championship model: convert power rating to championship probability
  // This is rough but directionally useful
  const totalPower = Object.values(powerRatings).reduce((s, r) => s + Math.max(0, r.power || 0), 0);
  
  for (const future of kalshiFutures) {
    const rating = powerRatings[future.team];
    if (!rating) continue;
    
    // Model championship probability based on power rating share
    const teamPower = Math.max(0, rating.power || 0);
    const modelProb = totalPower > 0 ? teamPower / totalPower : 0;
    
    const kalshiProb = future.impliedProbYes || 0;
    
    if (modelProb > kalshiProb + 0.02 && kalshiProb > 0) {
      const edge = modelProb - kalshiProb;
      values.push({
        type: 'FUTURES',
        sport: future.sport,
        ticker: future.ticker,
        team: future.team,
        teamName: rating.name,
        pick: `${future.team} to win championship`,
        modelProb: +(modelProb * 100).toFixed(1),
        kalshiPrice: future.yesAsk,
        kalshiProb: +(kalshiProb * 100).toFixed(1),
        edge: +(edge * 100).toFixed(1),
        power: rating.power,
        rank: rating.rank,
        confidence: edge >= 0.05 ? 'HIGH' : edge >= 0.02 ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  return values.sort((a, b) => b.edge - a.edge);
}

// ==================== FULL SCAN ====================

/**
 * Run a full scan of all Kalshi sports markets.
 * @param {object} models - { nba, mlb, nhl } model modules
 * @returns {object} scan results with value bets
 */
async function fullScan(models = {}) {
  console.log('[kalshi] Starting full market scan...');
  
  const results = {
    timestamp: new Date().toISOString(),
    markets: {},
    valueBets: [],
    futures: {}
  };
  
  // 1. NBA Team Totals
  try {
    const teamTotalEvents = await fetchKalshiEvents(SERIES.NBA_TEAM_TOTAL);
    const parsedTotals = parseNBATeamTotals(teamTotalEvents);
    results.markets.nbaTeamTotals = {
      events: teamTotalEvents.length,
      games: parsedTotals.length,
      contracts: parsedTotals.reduce((s, g) => s + g.contracts.length, 0)
    };
    
    // Scan for value if NBA model available
    if (models.nba?.predict) {
      const totalValues = scanTeamTotalValue(parsedTotals, models.nba.predict);
      results.valueBets.push(...totalValues);
      console.log(`[kalshi] NBA Team Totals: ${totalValues.length} value bets from ${parsedTotals.length} games`);
    }
    
    results.nbaTeamTotals = parsedTotals;
  } catch (e) {
    console.error('[kalshi] NBA team totals scan failed:', e.message);
    results.markets.nbaTeamTotals = { error: e.message };
  }
  
  // 2. NBA Spreads
  try {
    const spreadEvents = await fetchKalshiEvents(SERIES.NBA_SPREAD);
    const parsedSpreads = parseNBASpreads(spreadEvents);
    results.markets.nbaSpreads = {
      events: spreadEvents.length,
      games: parsedSpreads.length
    };
    results.nbaSpreads = parsedSpreads;
  } catch (e) {
    results.markets.nbaSpreads = { error: e.message };
  }
  
  // 3. Championship Futures
  for (const [sport, ticker] of [['NBA', SERIES.NBA_CHAMP], ['MLB', SERIES.MLB_CHAMP], ['NHL', SERIES.NHL_CHAMP]]) {
    try {
      const events = await fetchKalshiEvents(ticker, 5);
      const futures = parseFutures(events, sport);
      results.futures[sport.toLowerCase()] = futures;
      
      // Value scan if model available
      const model = models[sport.toLowerCase()];
      if (model?.calculateRatings) {
        const ratings = model.calculateRatings();
        const futureValues = scanFuturesValue(futures, ratings);
        results.valueBets.push(...futureValues);
      }
      
      console.log(`[kalshi] ${sport} Futures: ${futures.length} teams`);
    } catch (e) {
      results.futures[sport.toLowerCase()] = { error: e.message };
    }
  }
  
  // Sort all value bets by edge
  results.valueBets.sort((a, b) => b.edge - a.edge);
  results.totalValueBets = results.valueBets.length;
  results.highConfidence = results.valueBets.filter(v => v.confidence === 'HIGH').length;
  
  console.log(`[kalshi] Scan complete: ${results.totalValueBets} value bets found (${results.highConfidence} HIGH confidence)`);
  
  // Save to cache
  saveCache({ markets: results, timestamp: Date.now() });
  
  return results;
}

/**
 * Get cached scan results (or run fresh scan if stale).
 */
async function getScanResults(models) {
  if (isCacheFresh()) {
    const cache = loadCache();
    return cache.markets;
  }
  return await fullScan(models);
}

function getCachedResults() {
  const cache = loadCache();
  return cache.markets || null;
}

// ==================== MATH HELPERS ====================

function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function guessAbbr(name) {
  // Attempt to extract 2-3 letter abbreviation from team name
  const words = name.trim().split(/\s+/);
  if (words.length === 1 && words[0].length <= 3) return words[0].toUpperCase();
  return null;
}

// ==================== STATUS ====================

function getStatus() {
  const cache = loadCache();
  const now = Date.now();
  return {
    hasData: !!cache.markets,
    isFresh: isCacheFresh(),
    lastScan: cache.timestamp ? new Date(cache.timestamp).toISOString() : null,
    ageMinutes: cache.timestamp ? Math.round((now - cache.timestamp) / 60000) : null,
    valueBets: cache.markets?.totalValueBets || 0,
    highConfidence: cache.markets?.highConfidence || 0
  };
}

module.exports = {
  fullScan,
  getScanResults,
  getCachedResults,
  getStatus,
  fetchKalshiEvents,
  parseNBATeamTotals,
  parseNBASpreads,
  parseFutures,
  scanTeamTotalValue,
  scanFuturesValue,
  SERIES,
  CACHE_TTL
};
