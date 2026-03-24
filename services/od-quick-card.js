/**
 * OD Quick Reference Card v124.0
 * ================================
 * 
 * LIGHTWEIGHT, FAST endpoint for OD bet decisions.
 * 
 * Unlike od-live-execution.js which runs full asyncPredict() (15-30s),
 * this uses sync predict() + cached odds → returns in <3 seconds.
 * 
 * Perfect for:
 *   - Mobile check on game day
 *   - Quick status when endpoints are cold
 *   - Rapid bet reference without waiting for full pipeline
 *   - Comparing model vs current market in real-time
 * 
 * ENDPOINTS:
 *   GET /api/od/quick-card           — Full Day 1 + Day 2 quick card
 *   GET /api/od/quick-card/day/:day  — Day-specific card
 *   GET /api/od/quick-card/smash     — Only SMASH plays (top tier)
 *   GET /api/od/quick-card/game/:away/:home — Single game quick view
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Safe imports
let mlbModel = null;
let weatherService = null;
let pitcherDB = null;
let convictionEngine = null;
let f5Model = null;
let nrfiModel = null;
let pitcherKProps = null;
let bullpenQuality = null;
let platoonSplits = null;

try { mlbModel = require('../models/mlb'); } catch(e) {}
try { weatherService = require('./weather'); } catch(e) {}
try { pitcherDB = require('./pitcher-database') || require('./pitcher-db'); } catch(e) {}
try { convictionEngine = require('./conviction-engine'); } catch(e) {}
try { f5Model = require('./f5-model'); } catch(e) {}
try { nrfiModel = require('./nrfi-model'); } catch(e) {}
try { pitcherKProps = require('./pitcher-k-props'); } catch(e) {}
try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}
try { platoonSplits = require('./platoon-splits'); } catch(e) {}

// ==================== OD SCHEDULE ====================
const OD_DAY1 = [
  { away: 'PIT', home: 'NYM', time: '2026-03-26T17:10:00Z', venue: 'Citi Field', outdoor: true },
  { away: 'CWS', home: 'MIL', time: '2026-03-26T18:10:00Z', venue: 'American Family Field', outdoor: false },
  { away: 'WSH', home: 'CHC', time: '2026-03-26T18:20:00Z', venue: 'Wrigley Field', outdoor: true },
  { away: 'MIN', home: 'BAL', time: '2026-03-26T19:05:00Z', venue: 'Camden Yards', outdoor: true },
  { away: 'BOS', home: 'CIN', time: '2026-03-26T20:10:00Z', venue: 'Great American Ball Park', outdoor: true },
  { away: 'ARI', home: 'LAD', time: '2026-03-26T20:10:00Z', venue: 'Dodger Stadium', outdoor: true },
  { away: 'KC',  home: 'ATL', time: '2026-03-26T20:20:00Z', venue: 'Truist Park', outdoor: true },
  { away: 'OAK', home: 'TOR', time: '2026-03-26T21:07:00Z', venue: 'Rogers Centre', outdoor: false },
  { away: 'PHI', home: 'TB',  time: '2026-03-27T22:50:00Z', venue: 'Tropicana Field', outdoor: false },
  { away: 'SF',  home: 'HOU', time: '2026-03-27T00:10:00Z', venue: 'Minute Maid Park', outdoor: false },
  { away: 'CLE', home: 'SEA', time: '2026-03-27T02:10:00Z', venue: 'T-Mobile Park', outdoor: false },
];

const OD_DAY2 = [
  { away: 'NYY', home: 'MIL', time: '2026-03-27T18:10:00Z', venue: 'American Family Field', outdoor: false },
  { away: 'DET', home: 'SD',  time: '2026-03-27T20:10:00Z', venue: 'Petco Park', outdoor: true },
  { away: 'TB',  home: 'STL', time: '2026-03-27T20:15:00Z', venue: 'Busch Stadium', outdoor: true },
  { away: 'TEX', home: 'CHC', time: '2026-03-27T22:40:00Z', venue: 'Wrigley Field', outdoor: true },
  { away: 'CIN', home: 'LAA', time: '2026-03-27T23:07:00Z', venue: 'Angel Stadium', outdoor: true },
  { away: 'COL', home: 'MIA', time: '2026-03-27T23:10:00Z', venue: 'loanDepot park', outdoor: false },
  { away: 'LAD', home: 'ATL', time: '2026-03-27T23:20:00Z', venue: 'Truist Park', outdoor: true },
  { away: 'NYM', home: 'HOU', time: '2026-03-28T00:10:00Z', venue: 'Minute Maid Park', outdoor: false },
  { away: 'BAL', home: 'SEA', time: '2026-03-28T01:40:00Z', venue: 'T-Mobile Park', outdoor: false },
];

// ==================== DK OPENING LINES (baseline reference) ====================
const DK_LINES = {
  // Day 1
  'PIT@NYM': { homeML: -155, awayML: 130, total: 7.5, homeSpread: -1.5 },
  'CWS@MIL': { homeML: -200, awayML: 168, total: 8.5, homeSpread: -1.5 },
  'WSH@CHC': { homeML: -125, awayML: 105, total: 9.0, homeSpread: -1.5 },
  'MIN@BAL': { homeML: -130, awayML: 110, total: 8.5, homeSpread: -1.5 },
  'BOS@CIN': { homeML: 125, awayML: -145, total: 8.5, homeSpread: 1.5 },
  'ARI@LAD': { homeML: -190, awayML: 162, total: 8.0, homeSpread: -1.5 },
  'KC@ATL':  { homeML: -170, awayML: 145, total: 8.5, homeSpread: -1.5 },
  'OAK@TOR': { homeML: -158, awayML: 135, total: 8.0, homeSpread: -1.5 },
  'PHI@TB':  { homeML: 110, awayML: -130, total: 7.5, homeSpread: 1.5 },
  'SF@HOU':  { homeML: -150, awayML: 128, total: 8.0, homeSpread: -1.5 },
  'CLE@SEA': { homeML: -125, awayML: 105, total: 7.0, homeSpread: -1.5 },
  // Day 2
  'NYY@MIL': { homeML: 135, awayML: -155, total: 8.5, homeSpread: 1.5 },
  'DET@SD':  { homeML: -110, awayML: -110, total: 7.0, homeSpread: -1.5 },
  'TB@STL':  { homeML: -155, awayML: 130, total: 8.0, homeSpread: -1.5 },
  'TEX@CHC': { homeML: -120, awayML: 100, total: 8.5, homeSpread: -1.5 },
  'CIN@LAA': { homeML: -120, awayML: 100, total: 8.5, homeSpread: -1.5 },
  'COL@MIA': { homeML: -145, awayML: 122, total: 8.0, homeSpread: -1.5 },
  'LAD@ATL': { homeML: 110, awayML: -130, total: 8.5, homeSpread: 1.5 },
  'NYM@HOU': { homeML: -140, awayML: 118, total: 8.0, homeSpread: -1.5 },
  'BAL@SEA': { homeML: -105, awayML: -115, total: 7.0, homeSpread: -1.5 },
};

// ==================== HELPERS ====================
function americanToProb(odds) {
  if (!odds || odds === 0) return 0.5;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function probToAmerican(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function kellyFraction(edge, odds) {
  const p = edge / 100 + americanToProb(odds);
  const b = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  const f = (p * b - (1 - p)) / b;
  return Math.max(0, Math.min(0.05, f / 4)); // Quarter Kelly, max 5%
}

function gradePlay(edge, conviction) {
  if (edge >= 15 && conviction >= 75) return 'A+';
  if (edge >= 10 && conviction >= 70) return 'A';
  if (edge >= 7 && conviction >= 60) return 'B+';
  if (edge >= 5 && conviction >= 50) return 'B';
  if (edge >= 3 && conviction >= 40) return 'C+';
  if (edge >= 2) return 'C';
  return 'D';
}

function tierFromGrade(grade) {
  if (grade === 'A+' || grade === 'A') return 'SMASH';
  if (grade === 'B+' || grade === 'B') return 'STRONG';
  if (grade === 'C+' || grade === 'C') return 'LEAN';
  return 'SKIP';
}

// ==================== LIVE ODDS CACHE ====================
let liveOddsCache = { data: null, timestamp: null };
const ODDS_CACHE_TTL = 5 * 60 * 1000; // 5 minute cache

async function fetchLiveOdds() {
  // Return cached if fresh
  if (liveOddsCache.data && liveOddsCache.timestamp && (Date.now() - liveOddsCache.timestamp < ODDS_CACHE_TTL)) {
    return { source: 'cache', ...liveOddsCache.data };
  }
  
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return { source: 'static', games: [], error: 'No ODDS_API_KEY — using DK baseline lines' };
  }
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,pointsbet,bovada`;
    
    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    
    if (Array.isArray(data)) {
      const parsed = parseOddsAPIGames(data);
      liveOddsCache = { data: parsed, timestamp: Date.now() };
      return { source: 'live', ...parsed };
    }
    
    return { source: 'static', games: [], error: 'Unexpected API response format' };
  } catch(e) {
    return { source: 'static', games: [], error: e.message };
  }
}

// Team name mapping for Odds API → our abbreviations
const TEAM_ABBR_MAP = {
  'Pittsburgh Pirates': 'PIT', 'New York Mets': 'NYM', 'Chicago White Sox': 'CWS',
  'Milwaukee Brewers': 'MIL', 'Washington Nationals': 'WSH', 'Chicago Cubs': 'CHC',
  'Minnesota Twins': 'MIN', 'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS',
  'Cincinnati Reds': 'CIN', 'Arizona Diamondbacks': 'ARI', 'Los Angeles Dodgers': 'LAD',
  'Kansas City Royals': 'KC', 'Atlanta Braves': 'ATL', 'Oakland Athletics': 'OAK',
  'Toronto Blue Jays': 'TOR', 'Philadelphia Phillies': 'PHI', 'Tampa Bay Rays': 'TB',
  'San Francisco Giants': 'SF', 'Houston Astros': 'HOU', 'Cleveland Guardians': 'CLE',
  'Seattle Mariners': 'SEA', 'New York Yankees': 'NYY', 'Detroit Tigers': 'DET',
  'San Diego Padres': 'SD', 'Texas Rangers': 'TEX', 'Los Angeles Angels': 'LAA',
  'Colorado Rockies': 'COL', 'Miami Marlins': 'MIA', 'St. Louis Cardinals': 'STL',
};

function parseOddsAPIGames(data) {
  const games = {};
  
  for (const event of data) {
    const away = TEAM_ABBR_MAP[event.away_team] || event.away_team;
    const home = TEAM_ABBR_MAP[event.home_team] || event.home_team;
    const gameKey = `${away}@${home}`;
    
    const gameOdds = { ml: {}, spread: {}, total: {}, books: {} };
    
    for (const book of (event.bookmakers || [])) {
      const bookKey = book.key;
      const bookOdds = {};
      
      for (const market of (book.markets || [])) {
        if (market.key === 'h2h') {
          for (const o of market.outcomes) {
            const abbr = TEAM_ABBR_MAP[o.name] || o.name;
            if (abbr === home) { bookOdds.homeML = o.price; gameOdds.ml.home = gameOdds.ml.home || []; gameOdds.ml.home.push({ book: bookKey, odds: o.price }); }
            if (abbr === away) { bookOdds.awayML = o.price; gameOdds.ml.away = gameOdds.ml.away || []; gameOdds.ml.away.push({ book: bookKey, odds: o.price }); }
          }
        }
        if (market.key === 'spreads') {
          for (const o of market.outcomes) {
            const abbr = TEAM_ABBR_MAP[o.name] || o.name;
            if (abbr === home) { bookOdds.homeSpread = o.point; bookOdds.homeSpreadOdds = o.price; }
          }
        }
        if (market.key === 'totals') {
          for (const o of market.outcomes) {
            if (o.name === 'Over') { bookOdds.totalPts = o.point; bookOdds.overOdds = o.price; gameOdds.total.over = gameOdds.total.over || []; gameOdds.total.over.push({ book: bookKey, odds: o.price, pts: o.point }); }
            if (o.name === 'Under') { bookOdds.underOdds = o.price; gameOdds.total.under = gameOdds.total.under || []; gameOdds.total.under.push({ book: bookKey, odds: o.price, pts: o.point }); }
          }
        }
      }
      
      gameOdds.books[bookKey] = bookOdds;
    }
    
    // Find best odds across books
    const bestHomeML = (gameOdds.ml.home || []).reduce((best, b) => b.odds > (best?.odds ?? -9999) ? b : best, null);
    const bestAwayML = (gameOdds.ml.away || []).reduce((best, b) => b.odds > (best?.odds ?? -9999) ? b : best, null);
    const bestOver = (gameOdds.total.over || []).reduce((best, b) => b.odds > (best?.odds ?? -9999) ? b : best, null);
    const bestUnder = (gameOdds.total.under || []).reduce((best, b) => b.odds > (best?.odds ?? -9999) ? b : best, null);
    
    // Use DK as primary, or first available
    const dk = gameOdds.books['draftkings'] || Object.values(gameOdds.books)[0] || {};
    
    games[gameKey] = {
      homeML: dk.homeML || bestHomeML?.odds,
      awayML: dk.awayML || bestAwayML?.odds,
      total: dk.totalPts || bestOver?.pts,
      overOdds: dk.overOdds || bestOver?.odds,
      underOdds: dk.underOdds || bestUnder?.odds,
      homeSpread: dk.homeSpread,
      homeSpreadOdds: dk.homeSpreadOdds,
      bestHomeML: bestHomeML,
      bestAwayML: bestAwayML,
      bestOver: bestOver,
      bestUnder: bestUnder,
      bookCount: Object.keys(gameOdds.books).length,
      commenceTime: event.commence_time,
    };
  }
  
  return { games, count: Object.keys(games).length };
}

// ==================== CORE: GENERATE QUICK CARD ====================
async function generateQuickCard(options = {}) {
  const { day = 'all', bankroll = 1000, minEdge = 2.0 } = options;
  const startTime = Date.now();
  
  // Step 1: Get schedule
  const schedules = [];
  if (day === 'all' || day === 1 || day === '1') schedules.push({ day: 1, games: OD_DAY1 });
  if (day === 'all' || day === 2 || day === '2') schedules.push({ day: 2, games: OD_DAY2 });
  
  // Step 2: Fetch live odds (fast, cached)
  const oddsResult = await fetchLiveOdds();
  const liveGames = oddsResult.games || {};
  const oddsSource = oddsResult.source;
  
  // Step 3: Run SYNC predictions for all games (fast!)
  const allPlays = [];
  const gameCards = [];
  
  for (const { day: dayNum, games } of schedules) {
    for (const game of games) {
      const gameKey = `${game.away}@${game.home}`;
      const gameTime = new Date(game.time);
      const hoursToGame = (gameTime - new Date()) / (1000 * 60 * 60);
      
      // Use sync predict (fast!) — no asyncPredict overhead
      let pred = null;
      try {
        if (mlbModel) pred = mlbModel.predict(game.away, game.home);
      } catch(e) {}
      
      // Get odds: live > DK baseline
      const liveOdds = liveGames[gameKey];
      const dkBaseline = DK_LINES[gameKey];
      const odds = liveOdds || dkBaseline;
      
      if (!pred || !odds) {
        gameCards.push({
          gameKey, day: dayNum, venue: game.venue, 
          status: !pred ? 'NO_PREDICTION' : 'NO_ODDS',
          hoursToGame: Math.round(hoursToGame * 10) / 10,
        });
        continue;
      }
      
      // Extract model probabilities
      const modelHome = pred.homeWinProb || pred.homeWinPct || pred.homeWin || 0.5;
      const modelAway = pred.awayWinProb || pred.awayWinPct || pred.awayWin || 0.5;
      const modelTotal = pred.projectedTotal || pred.total || pred.projTotal || pred.totalRuns || 8.5;
      const awayRuns = pred.awayRuns || (modelTotal * modelAway);
      const homeRuns = pred.homeRuns || (modelTotal * modelHome);
      
      // Get pitchers
      const awayPitcher = pred.awayPitcher || pred.pitchers?.away || '?';
      const homePitcher = pred.homePitcher || pred.pitchers?.home || '?';
      
      const gamePlays = [];
      
      // --- MONEYLINE ANALYSIS ---
      if (odds.homeML) {
        const impliedHome = americanToProb(odds.homeML);
        const homeEdge = (modelHome - impliedHome) * 100;
        
        if (homeEdge >= minEdge) {
          const kelly = kellyFraction(homeEdge, odds.homeML);
          const wager = Math.round(bankroll * kelly * 100) / 100;
          const conv = Math.round(50 + homeEdge * 2 + (pred.confidence || 0) * 10);
          const grade = gradePlay(homeEdge, conv);
          gamePlays.push({
            market: 'ML', side: game.home, pick: `${game.home} ML ${odds.homeML > 0 ? '+' : ''}${odds.homeML}`,
            modelProb: Math.round(modelHome * 1000) / 10,
            impliedProb: Math.round(impliedHome * 1000) / 10,
            edge: Math.round(homeEdge * 10) / 10,
            odds: odds.homeML, kelly, wager, grade, tier: tierFromGrade(grade), conviction: conv,
            bestBook: liveOdds?.bestHomeML?.book || 'draftkings',
            bestOdds: liveOdds?.bestHomeML?.odds || odds.homeML,
          });
        }
        
        if (-homeEdge >= minEdge) {
          const awayEdge = -homeEdge;
          const kelly = kellyFraction(awayEdge, odds.awayML);
          const wager = Math.round(bankroll * kelly * 100) / 100;
          const conv = Math.round(50 + awayEdge * 2 + (pred.confidence || 0) * 10);
          const grade = gradePlay(awayEdge, conv);
          gamePlays.push({
            market: 'ML', side: game.away, pick: `${game.away} ML ${odds.awayML > 0 ? '+' : ''}${odds.awayML}`,
            modelProb: Math.round(modelAway * 1000) / 10,
            impliedProb: Math.round((1 - impliedHome) * 1000) / 10,
            edge: Math.round(awayEdge * 10) / 10,
            odds: odds.awayML, kelly, wager, grade, tier: tierFromGrade(grade), conviction: conv,
            bestBook: liveOdds?.bestAwayML?.book || 'draftkings',
            bestOdds: liveOdds?.bestAwayML?.odds || odds.awayML,
          });
        }
      }
      
      // --- TOTALS ANALYSIS ---
      if (odds.total) {
        const line = odds.total;
        // Use Poisson/NB scoring if available from predict
        const overProb = pred.overProb || pred.poisson?.overProb || pred.negBin?.overProb;
        const underProb = pred.underProb || pred.poisson?.underProb || pred.negBin?.underProb;
        
        if (overProb) {
          const impliedOver = odds.overOdds ? americanToProb(odds.overOdds) : 0.5;
          const overEdge = (overProb - impliedOver) * 100;
          
          if (overEdge >= minEdge) {
            const overOdds = odds.overOdds || -110;
            const kelly = kellyFraction(overEdge, overOdds);
            const wager = Math.round(bankroll * kelly * 100) / 100;
            const conv = Math.round(50 + overEdge * 2);
            const grade = gradePlay(overEdge, conv);
            gamePlays.push({
              market: 'TOTAL', side: 'OVER', pick: `OVER ${line} (${overOdds > 0 ? '+' : ''}${overOdds})`,
              modelProb: Math.round(overProb * 1000) / 10,
              modelTotal: Math.round(modelTotal * 10) / 10,
              edge: Math.round(overEdge * 10) / 10,
              odds: overOdds, kelly, wager, grade, tier: tierFromGrade(grade), conviction: conv,
              bestBook: liveOdds?.bestOver?.book || 'draftkings',
              bestOdds: liveOdds?.bestOver?.odds || overOdds,
            });
          }
          
          if (underProb) {
            const impliedUnder = odds.underOdds ? americanToProb(odds.underOdds) : 0.5;
            const underEdge = (underProb - impliedUnder) * 100;
            
            if (underEdge >= minEdge) {
              const underOdds = odds.underOdds || -110;
              const kelly = kellyFraction(underEdge, underOdds);
              const wager = Math.round(bankroll * kelly * 100) / 100;
              const conv = Math.round(50 + underEdge * 2);
              const grade = gradePlay(underEdge, conv);
              gamePlays.push({
                market: 'TOTAL', side: 'UNDER', pick: `UNDER ${line} (${underOdds > 0 ? '+' : ''}${underOdds})`,
                modelProb: Math.round(underProb * 1000) / 10,
                modelTotal: Math.round(modelTotal * 10) / 10,
                edge: Math.round(underEdge * 10) / 10,
                odds: underOdds, kelly, wager, grade, tier: tierFromGrade(grade), conviction: conv,
                bestBook: liveOdds?.bestUnder?.book || 'draftkings',
                bestOdds: liveOdds?.bestUnder?.odds || underOdds,
              });
            }
          }
        } else {
          // Fallback: compare model total vs line
          const diff = modelTotal - line;
          if (Math.abs(diff) >= 0.5) {
            const side = diff > 0 ? 'OVER' : 'UNDER';
            const sideOdds = diff > 0 ? (odds.overOdds || -110) : (odds.underOdds || -110);
            // Rough edge estimate: each 0.5 run ≈ 4% edge for totals
            const roughEdge = Math.abs(diff) * 8;
            const kelly = kellyFraction(roughEdge, sideOdds);
            const wager = Math.round(bankroll * kelly * 100) / 100;
            const conv = Math.round(50 + roughEdge * 1.5);
            const grade = gradePlay(roughEdge, conv);
            gamePlays.push({
              market: 'TOTAL', side, pick: `${side} ${line} (${sideOdds > 0 ? '+' : ''}${sideOdds})`,
              modelTotal: Math.round(modelTotal * 10) / 10,
              lineDiff: Math.round(diff * 10) / 10,
              edge: Math.round(roughEdge * 10) / 10,
              odds: sideOdds, kelly, wager, grade, tier: tierFromGrade(grade), conviction: conv,
              note: 'Edge estimated from total diff (no Poisson prob available)',
            });
          }
        }
      }
      
      // --- F5 ANALYSIS (if available) ---
      if (pred.f5) {
        const f5Total = pred.f5.projTotal || pred.f5.total;
        const f5OverProb = pred.f5.overProb;
        const f5UnderProb = pred.f5.underProb;
        const f5Line = (odds.total ? Math.round(odds.total * 0.545 * 2) / 2 : null) || 4.5;
        
        if (f5UnderProb && f5UnderProb > 0.55) {
          const impliedF5Under = 0.5; // F5 lines typically -110/-110
          const f5Edge = (f5UnderProb - impliedF5Under) * 100;
          if (f5Edge >= minEdge) {
            const conv = Math.round(50 + f5Edge * 2);
            const grade = gradePlay(f5Edge, conv);
            gamePlays.push({
              market: 'F5 TOTAL', side: 'UNDER', pick: `F5 UNDER ${f5Line} (-110)`,
              modelF5Total: f5Total ? Math.round(f5Total * 10) / 10 : null,
              modelProb: Math.round(f5UnderProb * 1000) / 10,
              edge: Math.round(f5Edge * 10) / 10,
              odds: -110, grade, tier: tierFromGrade(grade), conviction: conv,
              note: 'OD ace premium — starters go deeper in openers',
            });
          }
        }
      }
      
      // Sort plays by edge descending
      gamePlays.sort((a, b) => b.edge - a.edge);
      
      allPlays.push(...gamePlays.map(p => ({ ...p, gameKey, day: dayNum })));
      
      gameCards.push({
        gameKey,
        day: dayNum,
        venue: game.venue,
        outdoor: game.outdoor,
        hoursToGame: Math.round(hoursToGame * 10) / 10,
        awayPitcher,
        homePitcher,
        modelHome: Math.round(modelHome * 1000) / 10,
        modelAway: Math.round(modelAway * 1000) / 10,
        modelTotal: Math.round(modelTotal * 10) / 10,
        awayRuns: Math.round(awayRuns * 10) / 10,
        homeRuns: Math.round(homeRuns * 10) / 10,
        oddsSource: liveOdds ? 'LIVE' : 'DK_BASELINE',
        liveML: liveOdds ? `${game.away} ${liveOdds.awayML} / ${game.home} ${liveOdds.homeML}` : null,
        liveTotal: liveOdds?.total || null,
        plays: gamePlays,
        topPlay: gamePlays[0] || null,
        playCount: gamePlays.length,
      });
    }
  }
  
  // Sort all plays by edge
  allPlays.sort((a, b) => b.edge - a.edge);
  
  // Tier breakdown
  const smash = allPlays.filter(p => p.tier === 'SMASH');
  const strong = allPlays.filter(p => p.tier === 'STRONG');
  const lean = allPlays.filter(p => p.tier === 'LEAN');
  
  // Portfolio summary
  const totalWager = allPlays.reduce((sum, p) => sum + (p.wager || 0), 0);
  const totalEV = allPlays.reduce((sum, p) => sum + ((p.wager || 0) * (p.edge || 0) / 100), 0);
  
  const buildMs = Date.now() - startTime;
  
  return {
    generated: new Date().toISOString(),
    buildMs,
    oddsSource,
    oddsAge: liveOddsCache.timestamp ? Math.round((Date.now() - liveOddsCache.timestamp) / 60000) + 'min' : 'N/A',
    countdown: {
      day1FirstPitch: 'March 26 1:10 PM ET (PIT@NYM)',
      hoursToD1: Math.round((new Date('2026-03-26T17:10:00Z') - new Date()) / (1000 * 60 * 60) * 10) / 10,
      hoursToD2: Math.round((new Date('2026-03-27T18:10:00Z') - new Date()) / (1000 * 60 * 60) * 10) / 10,
    },
    portfolio: {
      totalPlays: allPlays.length,
      smashCount: smash.length,
      strongCount: strong.length,
      leanCount: lean.length,
      totalWager: Math.round(totalWager * 100) / 100,
      totalEV: Math.round(totalEV * 100) / 100,
      roi: totalWager > 0 ? Math.round(totalEV / totalWager * 10000) / 100 + '%' : 'N/A',
      bankroll,
    },
    tiers: {
      smash: smash.map(p => ({ ...p })),
      strong: strong.slice(0, 10).map(p => ({ ...p })),
      lean: lean.slice(0, 10).map(p => ({ ...p })),
    },
    games: gameCards,
    allPlays,
  };
}

// ==================== GAME QUICK VIEW ====================
function gameQuickView(away, home) {
  const a = away.toUpperCase();
  const h = home.toUpperCase();
  const gameKey = `${a}@${h}`;
  
  // Find in schedule
  let game = OD_DAY1.find(g => g.away === a && g.home === h);
  let dayNum = 1;
  if (!game) {
    game = OD_DAY2.find(g => g.away === a && g.home === h);
    dayNum = 2;
  }
  if (!game) return { error: `Game ${gameKey} not found in OD schedule` };
  
  // Sync prediction (fast)
  let pred = null;
  try { if (mlbModel) pred = mlbModel.predict(a, h); } catch(e) {}
  
  const odds = DK_LINES[gameKey];
  const gameTime = new Date(game.time);
  const hoursToGame = (gameTime - new Date()) / (1000 * 60 * 60);
  
  return {
    gameKey,
    day: dayNum,
    venue: game.venue,
    outdoor: game.outdoor,
    gameTime: game.time,
    hoursToGame: Math.round(hoursToGame * 10) / 10,
    prediction: pred ? {
      homeWinProb: Math.round((pred.homeWinProb || pred.homeWin || 0.5) * 1000) / 10,
      awayWinProb: Math.round((pred.awayWinProb || pred.awayWin || 0.5) * 1000) / 10,
      projTotal: Math.round((pred.projectedTotal || pred.total || 8.5) * 10) / 10,
      awayRuns: pred.awayRuns ? Math.round(pred.awayRuns * 10) / 10 : null,
      homeRuns: pred.homeRuns ? Math.round(pred.homeRuns * 10) / 10 : null,
      awayPitcher: pred.awayPitcher || '?',
      homePitcher: pred.homePitcher || '?',
      confidence: pred.confidence,
      f5: pred.f5 || null,
      f7: pred.f7 || null,
      weather: pred.weather || null,
    } : null,
    dkLines: odds,
  };
}

module.exports = {
  generateQuickCard,
  gameQuickView,
  fetchLiveOdds,
  OD_DAY1,
  OD_DAY2,
  DK_LINES,
};
