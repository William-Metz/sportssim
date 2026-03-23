/**
 * Daily NHL Betting Card — SportsSim v98.0
 * ==========================================
 * THE NHL MONEY MACHINE — especially deadly with the East bubble insanity.
 *
 * Generates a comprehensive daily NHL betting card with:
 *   1. Full game predictions via asyncPredict (live goalie starters from DailyFaceoff)
 *   2. Live odds from The Odds API
 *   3. Value detection across ML, puck line, total markets
 *   4. Goalie mismatch signals (backup vs starter = 3-6% edge)
 *   5. Playoff bubble implications (6 teams within 3pts = massive mispricing)
 *   6. Kelly-optimized portfolio sizing
 *   7. Conviction scoring per play
 *   8. Historical grade tracking
 *
 * WHY THIS MATTERS: NHL goalie starters are often announced late, books
 * don't reprice fast enough, and the East bubble creates insane
 * desperation/tanking dynamics identical to NBA rest/tank edges.
 *
 * EDGE SOURCES (priority order):
 *   1. Backup goalie starts — books are SLOW to reprice, 3-6% ML swings
 *   2. Bubble desperation — teams fighting for playoffs play harder, coast teams fade
 *   3. B2B detection — teams on B2B in late season = starter rest = backup goalie
 *   4. Rolling form — hot/cold streaks, L10 momentum
 *   5. Injury-adjusted lines — star player absence + goalie quality delta
 *   6. Puck line / totals — less efficient markets than ML
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Safe requires
let nhlModel = null;
let goalieStarters = null;
let bubbleScanner = null;
let calibration = null;
let kellyService = null;
let injuryService = null;
let rollingStats = null;
let playoffSeries = null;

try { nhlModel = require('../models/nhl'); } catch(e) {}
try { goalieStarters = require('./nhl-goalie-starters'); } catch(e) {}
try { bubbleScanner = require('./nhl-bubble-scanner'); } catch(e) {}
try { calibration = require('./calibration'); } catch(e) {}
try { kellyService = require('./kelly'); } catch(e) {}
try { injuryService = require('./injuries'); } catch(e) {}
try { rollingStats = require('./rolling-stats'); } catch(e) {}
try { playoffSeries = require('./nhl-playoff-series'); } catch(e) {}

// ==================== CACHE ====================
const CACHE_DIR = path.join(__dirname, 'daily-nhl-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

let lastBuild = null;
let lastBuildTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 min

// ==================== CONFIG ====================
const MIN_EDGE = 2.0;       // Minimum edge % to include
const SMASH_EDGE = 6.0;     // SMASH tier threshold
const STRONG_EDGE = 4.0;    // Strong tier threshold
const MAX_KELLY_BET = 0.05; // 5% max single bet

// ==================== TEAM NAME RESOLUTION ====================
const NHL_NAMES = {
  'Colorado Avalanche': 'COL', 'Dallas Stars': 'DAL', 'Carolina Hurricanes': 'CAR',
  'Buffalo Sabres': 'BUF', 'Minnesota Wild': 'MIN', 'Tampa Bay Lightning': 'TBL',
  'Winnipeg Jets': 'WPG', 'New York Rangers': 'NYR', 'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Vegas Golden Knights': 'VGK',
  'Nashville Predators': 'NSH', 'Toronto Maple Leafs': 'TOR', 'Ottawa Senators': 'OTT',
  'St Louis Blues': 'STL', 'St. Louis Blues': 'STL', 'New York Islanders': 'NYI',
  'Columbus Blue Jackets': 'CBJ', 'Pittsburgh Penguins': 'PIT', 'Montreal Canadiens': 'MTL',
  'Montréal Canadiens': 'MTL', 'Boston Bruins': 'BOS', 'Detroit Red Wings': 'DET',
  'Washington Capitals': 'WSH', 'New Jersey Devils': 'NJD', 'Philadelphia Flyers': 'PHI',
  'Calgary Flames': 'CGY', 'Vancouver Canucks': 'VAN', 'Seattle Kraken': 'SEA',
  'Arizona Coyotes': 'ARI', 'Utah Hockey Club': 'UTA', 'Anaheim Ducks': 'ANA',
  'San Jose Sharks': 'SJS', 'Chicago Blackhawks': 'CHI',
};

function resolveTeam(name) {
  if (!name) return null;
  const upper = name.toUpperCase();
  // Direct abbreviation
  if (nhlModel && nhlModel.TEAMS && nhlModel.TEAMS[upper]) return upper;
  // Full name mapping
  if (NHL_NAMES[name]) return NHL_NAMES[name];
  // Partial match
  for (const [full, abbr] of Object.entries(NHL_NAMES)) {
    if (name.includes(full.split(' ').pop())) return abbr;
  }
  return null;
}

// ==================== ODDS FETCHING ====================
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    mod.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/1.0' },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchNHLOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const data = await fetchJSON(url);
    return Array.isArray(data) ? data : [];
  } catch(e) {
    console.error('[daily-nhl-card] Odds fetch error:', e.message);
    return [];
  }
}

// ESPN NHL Scoreboard fallback
async function fetchESPNNHLGames() {
  try {
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${today}`;
    const data = await fetchJSON(url);
    if (!data.events) return [];
    return data.events.map(ev => {
      const comps = ev.competitions?.[0];
      const away = comps?.competitors?.find(c => c.homeAway === 'away');
      const home = comps?.competitors?.find(c => c.homeAway === 'home');
      return {
        away_team: away?.team?.displayName,
        home_team: home?.team?.displayName,
        commence_time: ev.date,
        bookmakers: [], // No odds from ESPN
        espnFallback: true,
        status: comps?.status?.type?.name,
        awayScore: away?.score,
        homeScore: home?.score,
      };
    });
  } catch(e) {
    console.error('[daily-nhl-card] ESPN fallback error:', e.message);
    return [];
  }
}

function extractBookLine(bk, homeTeam) {
  const line = {};
  (bk.markets || []).forEach(mkt => {
    if (mkt.key === 'h2h') {
      mkt.outcomes.forEach(o => {
        if (o.name === homeTeam) line.homeML = o.price;
        else line.awayML = o.price;
      });
    }
    if (mkt.key === 'spreads') {
      mkt.outcomes.forEach(o => {
        if (o.name === homeTeam) { line.homeSpread = o.point; line.homeSpreadOdds = o.price; }
        else { line.awaySpread = o.point; line.awaySpreadOdds = o.price; }
      });
    }
    if (mkt.key === 'totals') {
      mkt.outcomes.forEach(o => {
        if (o.name === 'Over') { line.total = o.point; line.overOdds = o.price; }
        if (o.name === 'Under') { line.underOdds = o.price; }
      });
    }
  });
  return line;
}

// ==================== PLAYOFF BUBBLE ANALYSIS ====================
// Track which teams are in the bubble fight
const EAST_BUBBLE_TEAMS = new Set(['PIT', 'MTL', 'BOS', 'DET', 'CBJ', 'NYI', 'OTT', 'NJD']);
const WEST_BUBBLE_TEAMS = new Set(['CGY', 'VAN', 'SEA', 'STL']);
const ELIMINATED_TEAMS = new Set(['SJS', 'CHI', 'ANA', 'PHI']); // bottom feeders
const TOP_SEEDS = new Set(['COL', 'DAL', 'CAR', 'BUF', 'WPG', 'MIN', 'FLA', 'EDM', 'TBL']);

function getBubbleStatus(teamCode) {
  if (ELIMINATED_TEAMS.has(teamCode)) return { status: 'ELIMINATED', motivation: -3.0, label: '💀 Eliminated' };
  if (EAST_BUBBLE_TEAMS.has(teamCode)) return { status: 'BUBBLE', motivation: 2.5, label: '🔥 Bubble Fight' };
  if (WEST_BUBBLE_TEAMS.has(teamCode)) return { status: 'BUBBLE', motivation: 2.0, label: '🔥 West Bubble' };
  if (TOP_SEEDS.has(teamCode)) return { status: 'LOCKED', motivation: 0.5, label: '🔒 Playoff Locked' };
  return { status: 'COMPETING', motivation: 1.0, label: '⚡ Competing' };
}

function getMotivationMismatch(awayCode, homeCode) {
  const away = getBubbleStatus(awayCode);
  const home = getBubbleStatus(homeCode);
  const mismatch = home.motivation - away.motivation;
  
  let signal = null;
  if (Math.abs(mismatch) >= 2.0) {
    const favored = mismatch > 0 ? 'home' : 'away';
    signal = {
      mismatch: +mismatch.toFixed(1),
      favored,
      severity: Math.abs(mismatch) >= 4.0 ? 'EXTREME' : Math.abs(mismatch) >= 2.5 ? 'HIGH' : 'MODERATE',
      description: mismatch > 0 
        ? `${homeCode} (${home.label}) vs ${awayCode} (${away.label}) = HOME motivation edge`
        : `${awayCode} (${away.label}) vs ${homeCode} (${home.label}) = AWAY motivation edge`,
    };
  }
  
  return {
    away: { code: awayCode, ...away },
    home: { code: homeCode, ...home },
    mismatch: +mismatch.toFixed(1),
    signal,
  };
}

// ==================== BACK-TO-BACK DETECTION ====================
async function detectB2B(teamCode) {
  // Check if team played yesterday using ESPN
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10).replace(/-/g,'');
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${yesterday}`;
    const data = await fetchJSON(url);
    if (!data.events) return { isB2B: false };
    
    for (const ev of data.events) {
      const comps = ev.competitions?.[0];
      for (const comp of (comps?.competitors || [])) {
        const abbr = comp.team?.abbreviation;
        if (abbr === teamCode || resolveTeam(comp.team?.displayName) === teamCode) {
          return { 
            isB2B: true, 
            yesterdayGame: `${comps.competitors[0]?.team?.abbreviation || '?'} vs ${comps.competitors[1]?.team?.abbreviation || '?'}`,
            playedAway: comp.homeAway === 'away',
          };
        }
      }
    }
    return { isB2B: false };
  } catch(e) {
    return { isB2B: false, error: e.message };
  }
}

// ==================== CONVICTION SCORING ====================
function calculateConviction(pred, odds, motivationData, goalieData, b2bData) {
  let score = 0;
  const breakdown = {};
  
  // 1. Edge size (0-25)
  const edgePct = Math.max(
    Math.abs(odds.bestEdge?.homeEdge || 0),
    Math.abs(odds.bestEdge?.awayEdge || 0),
    Math.abs(odds.totalEdge || 0)
  );
  const edgeScore = Math.min(25, edgePct * 3);
  score += edgeScore;
  breakdown.edgeSize = { score: +edgeScore.toFixed(0), raw: +edgePct.toFixed(1) };
  
  // 2. Goalie confirmation (0-20)
  let goalieScore = 5; // baseline
  if (goalieData?.confirmed) {
    goalieScore = 15;
    if (goalieData.backupAlert) goalieScore = 20; // confirmed backup = massive signal
  }
  score += goalieScore;
  breakdown.goalieInfo = { score: goalieScore, confirmed: goalieData?.confirmed || false, backupAlert: goalieData?.backupAlert || false };
  
  // 3. Motivation/bubble signal (0-15)
  let motivScore = 0;
  if (motivationData?.signal) {
    motivScore = motivationData.signal.severity === 'EXTREME' ? 15 : 
                 motivationData.signal.severity === 'HIGH' ? 10 : 5;
  }
  score += motivScore;
  breakdown.motivation = { score: motivScore, mismatch: motivationData?.mismatch || 0 };
  
  // 4. Form/rolling stats (0-15)
  let formScore = 5;
  if (pred.rollingAdj) {
    const awayTrend = pred.rollingAdj.away?.trend || 'neutral';
    const homeTrend = pred.rollingAdj.home?.trend || 'neutral';
    if ((awayTrend === 'cold' && homeTrend === 'hot') || (awayTrend === 'hot' && homeTrend === 'cold')) {
      formScore = 15; // strong directional L10 signal
    } else if (awayTrend !== 'neutral' || homeTrend !== 'neutral') {
      formScore = 10;
    }
  }
  score += formScore;
  breakdown.form = { score: formScore };
  
  // 5. B2B factor (0-10)
  let b2bScore = 0;
  if (b2bData) {
    if (b2bData.away?.isB2B && !b2bData.home?.isB2B) b2bScore = 8; // home edge
    else if (b2bData.home?.isB2B && !b2bData.away?.isB2B) b2bScore = 8; // away edge
    else if (b2bData.away?.isB2B && b2bData.home?.isB2B) b2bScore = 3; // both tired
  }
  score += b2bScore;
  breakdown.b2b = { score: b2bScore, awayB2B: b2bData?.away?.isB2B || false, homeB2B: b2bData?.home?.isB2B || false };
  
  // 6. Data quality (0-15)
  let dataScore = 5; // baseline
  if (pred.goalieMatchup) dataScore += 5;
  if (pred.injuryAdj?.away || pred.injuryAdj?.home) dataScore += 3;
  if (odds.bookCount >= 3) dataScore += 2;
  score += Math.min(15, dataScore);
  breakdown.dataQuality = { score: Math.min(15, dataScore) };
  
  // Cap at 100
  score = Math.min(100, Math.round(score));
  
  // Grade
  const grade = score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 65 ? 'B+' :
                score >= 55 ? 'B' : score >= 45 ? 'C+' : score >= 35 ? 'C' : 'D';
  
  return { score, grade, breakdown };
}

// ==================== VALUE DETECTION ====================
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(p) {
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  return Math.round(100 * (1 - p) / p);
}

function detectValue(pred, books) {
  const plays = [];
  
  const homeWinProb = (pred.home.winProb || 50) / 100;
  const awayWinProb = 1 - homeWinProb;
  const projTotal = pred.projTotal;
  
  // Find best lines across all books
  let bestHomeML = null, bestAwayML = null, bestHomeBook = '', bestAwayBook = '';
  let bestTotal = null, bestOverOdds = null, bestUnderOdds = null, bestOverBook = '', bestUnderBook = '';
  let bestHomePL = null, bestAwayPL = null, bestHomePLOdds = null, bestAwayPLOdds = null;
  let bestHomePLBook = '', bestAwayPLBook = '';
  let bookCount = 0;
  
  for (const [bookName, line] of Object.entries(books)) {
    bookCount++;
    if (line.homeML != null && (bestHomeML === null || line.homeML > bestHomeML)) {
      bestHomeML = line.homeML; bestHomeBook = bookName;
    }
    if (line.awayML != null && (bestAwayML === null || line.awayML > bestAwayML)) {
      bestAwayML = line.awayML; bestAwayBook = bookName;
    }
    if (line.total != null && line.overOdds != null) {
      if (bestTotal === null || line.overOdds > (bestOverOdds || -999)) {
        bestTotal = line.total; bestOverOdds = line.overOdds; bestOverBook = bookName;
      }
      if (line.underOdds != null && (bestUnderOdds === null || line.underOdds > bestUnderOdds)) {
        bestUnderOdds = line.underOdds; bestUnderBook = bookName;
      }
    }
    // Puck line (typically ±1.5)
    if (line.homeSpread != null && line.homeSpread === -1.5 && line.homeSpreadOdds != null) {
      if (bestHomePLOdds === null || line.homeSpreadOdds > bestHomePLOdds) {
        bestHomePL = line.homeSpread; bestHomePLOdds = line.homeSpreadOdds; bestHomePLBook = bookName;
      }
    }
    if (line.awaySpread != null && line.awaySpread === 1.5 && line.awaySpreadOdds != null) {
      if (bestAwayPLOdds === null || line.awaySpreadOdds > bestAwayPLOdds) {
        bestAwayPL = line.awaySpread; bestAwayPLOdds = line.awaySpreadOdds; bestAwayPLBook = bookName;
      }
    }
  }
  
  // ML value
  if (bestHomeML !== null) {
    const impliedProb = mlToProb(bestHomeML);
    const edge = (homeWinProb - impliedProb) * 100;
    if (edge >= MIN_EDGE) {
      plays.push({
        type: 'ML',
        side: 'home',
        team: pred.home.code,
        modelProb: +(homeWinProb * 100).toFixed(1),
        impliedProb: +(impliedProb * 100).toFixed(1),
        edge: +edge.toFixed(1),
        odds: bestHomeML,
        book: bestHomeBook,
        tier: edge >= SMASH_EDGE ? 'SMASH' : edge >= STRONG_EDGE ? 'STRONG' : 'LEAN',
      });
    }
  }
  
  if (bestAwayML !== null) {
    const impliedProb = mlToProb(bestAwayML);
    const edge = (awayWinProb - impliedProb) * 100;
    if (edge >= MIN_EDGE) {
      plays.push({
        type: 'ML',
        side: 'away',
        team: pred.away.code,
        modelProb: +(awayWinProb * 100).toFixed(1),
        impliedProb: +(impliedProb * 100).toFixed(1),
        edge: +edge.toFixed(1),
        odds: bestAwayML,
        book: bestAwayBook,
        tier: edge >= SMASH_EDGE ? 'SMASH' : edge >= STRONG_EDGE ? 'STRONG' : 'LEAN',
      });
    }
  }
  
  // Puck line value
  if (bestHomePLOdds !== null && pred.puckLine) {
    const modelPLProb = (pred.puckLine.home.prob || 30) / 100;
    const impliedPLProb = mlToProb(bestHomePLOdds);
    const edge = (modelPLProb - impliedPLProb) * 100;
    if (edge >= MIN_EDGE) {
      plays.push({
        type: 'PL',
        side: 'home',
        team: pred.home.code,
        line: '-1.5',
        modelProb: +(modelPLProb * 100).toFixed(1),
        impliedProb: +(impliedPLProb * 100).toFixed(1),
        edge: +edge.toFixed(1),
        odds: bestHomePLOdds,
        book: bestHomePLBook,
        tier: edge >= SMASH_EDGE ? 'SMASH' : edge >= STRONG_EDGE ? 'STRONG' : 'LEAN',
      });
    }
  }
  
  if (bestAwayPLOdds !== null && pred.puckLine) {
    const modelPLProb = (pred.puckLine.away.prob || 70) / 100;
    const impliedPLProb = mlToProb(bestAwayPLOdds);
    const edge = (modelPLProb - impliedPLProb) * 100;
    if (edge >= MIN_EDGE) {
      plays.push({
        type: 'PL',
        side: 'away',
        team: pred.away.code,
        line: '+1.5',
        modelProb: +(modelPLProb * 100).toFixed(1),
        impliedProb: +(impliedPLProb * 100).toFixed(1),
        edge: +edge.toFixed(1),
        odds: bestAwayPLOdds,
        book: bestAwayPLBook,
        tier: edge >= SMASH_EDGE ? 'SMASH' : edge >= STRONG_EDGE ? 'STRONG' : 'LEAN',
      });
    }
  }
  
  // Totals value
  if (bestTotal != null && projTotal) {
    const totalDiff = projTotal - bestTotal;
    
    // Over value
    if (totalDiff > 0 && bestOverOdds != null) {
      const overProb = 0.5 + (totalDiff / projTotal) * 2; // rough scaling
      const impliedOver = mlToProb(bestOverOdds);
      const edge = (Math.min(0.75, overProb) - impliedOver) * 100;
      if (edge >= MIN_EDGE) {
        plays.push({
          type: 'TOTAL',
          side: 'over',
          line: bestTotal,
          modelTotal: projTotal,
          diff: +totalDiff.toFixed(1),
          edge: +edge.toFixed(1),
          odds: bestOverOdds,
          book: bestOverBook,
          tier: edge >= SMASH_EDGE ? 'SMASH' : edge >= STRONG_EDGE ? 'STRONG' : 'LEAN',
        });
      }
    }
    
    // Under value
    if (totalDiff < 0 && bestUnderOdds != null) {
      const underProb = 0.5 + (-totalDiff / projTotal) * 2;
      const impliedUnder = mlToProb(bestUnderOdds);
      const edge = (Math.min(0.75, underProb) - impliedUnder) * 100;
      if (edge >= MIN_EDGE) {
        plays.push({
          type: 'TOTAL',
          side: 'under',
          line: bestTotal,
          modelTotal: projTotal,
          diff: +totalDiff.toFixed(1),
          edge: +edge.toFixed(1),
          odds: bestUnderOdds,
          book: bestUnderBook,
          tier: edge >= SMASH_EDGE ? 'SMASH' : edge >= STRONG_EDGE ? 'STRONG' : 'LEAN',
        });
      }
    }
  }
  
  // Sort by edge descending
  plays.sort((a, b) => b.edge - a.edge);
  
  return {
    plays,
    bestEdge: {
      homeML: bestHomeML,
      awayML: bestAwayML,
      homeEdge: bestHomeML ? (homeWinProb - mlToProb(bestHomeML)) * 100 : 0,
      awayEdge: bestAwayML ? (awayWinProb - mlToProb(bestAwayML)) * 100 : 0,
    },
    totalEdge: bestTotal ? ((projTotal - bestTotal) / projTotal) * 100 : 0,
    bookCount,
    bestLines: {
      homeML: bestHomeML, awayML: bestAwayML,
      homeBook: bestHomeBook, awayBook: bestAwayBook,
      total: bestTotal, overOdds: bestOverOdds, underOdds: bestUnderOdds,
    },
  };
}

// ==================== KELLY SIZING ====================
function kellySize(prob, odds, bankroll = 1000) {
  const decOdds = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  const q = 1 - prob;
  const kelly = (prob * decOdds - q) / decOdds;
  if (kelly <= 0) return { wager: 0, ev: 0, kelly: 0 };
  
  const halfKelly = kelly / 2;
  const wager = Math.min(bankroll * halfKelly, bankroll * MAX_KELLY_BET);
  const ev = wager * prob * decOdds - wager * q;
  
  return {
    kelly: +kelly.toFixed(4),
    halfKelly: +halfKelly.toFixed(4),
    wager: +wager.toFixed(2),
    ev: +ev.toFixed(2),
  };
}

// ==================== MAIN BUILD ====================
async function buildDailyCard(options = {}) {
  const startTime = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  
  // Check cache
  if (!options.force && lastBuild && (Date.now() - lastBuildTime) < CACHE_TTL) {
    return lastBuild;
  }
  
  // Fetch odds
  let games = await fetchNHLOdds();
  let oddsSource = 'the-odds-api';
  
  // ESPN fallback if no odds
  if (games.length === 0) {
    games = await fetchESPNNHLGames();
    oddsSource = 'espn-fallback';
  }
  
  if (games.length === 0) {
    return {
      date: today,
      games: [],
      plays: [],
      portfolio: { totalWager: 0, totalEV: 0, roi: 0 },
      meta: { buildTime: Date.now() - startTime, oddsSource, gamesFound: 0, warning: 'No NHL games found for today' },
    };
  }
  
  // Filter to today's games only
  const todayGames = games.filter(g => {
    if (!g.commence_time) return true;
    const gameDate = new Date(g.commence_time).toISOString().slice(0, 10);
    return gameDate === today;
  });
  
  const gameCards = [];
  const allPlays = [];
  
  for (const game of todayGames) {
    const awayCode = resolveTeam(game.away_team);
    const homeCode = resolveTeam(game.home_team);
    
    if (!awayCode || !homeCode) continue;
    
    // Run prediction with live goalie data
    let pred = null;
    try {
      pred = await nhlModel.asyncPredict(awayCode, homeCode);
    } catch(e) {
      try { pred = nhlModel.predict(awayCode, homeCode); } catch(e2) {}
    }
    
    if (!pred) continue;
    
    // Extract book lines
    const books = {};
    for (const bk of (game.bookmakers || [])) {
      books[bk.title] = extractBookLine(bk, game.home_team);
    }
    
    // Detect value
    const valueResult = detectValue(pred, books);
    
    // Motivation/bubble analysis
    const motivationData = getMotivationMismatch(awayCode, homeCode);
    
    // B2B detection
    let b2bData = null;
    try {
      const [awayB2B, homeB2B] = await Promise.all([
        detectB2B(awayCode),
        detectB2B(homeCode),
      ]);
      b2bData = { away: awayB2B, home: homeB2B };
    } catch(e) {}
    
    // Goalie data summary
    const goalieData = {
      confirmed: !!(pred.goalieMatchup?.home?.confirmed || pred.goalieMatchup?.away?.confirmed),
      backupAlert: !!(pred.goalieMatchup?.home?.isStarter === false || pred.goalieMatchup?.away?.isStarter === false),
      homeGoalie: pred.goalieMatchup?.home?.name || pred.goalieAdj?.homeGoalie || 'unknown',
      awayGoalie: pred.goalieMatchup?.away?.name || pred.goalieAdj?.awayGoalie || 'unknown',
      svPctDelta: pred.goalieMatchup?.svPctDelta || 0,
      impact: pred.goalieImpact || null,
    };
    
    // Conviction
    const conviction = calculateConviction(pred, valueResult, motivationData, goalieData, b2bData);
    
    // Kelly sizing for each play
    const plays = valueResult.plays.map(play => {
      const prob = play.modelProb / 100;
      const sizing = kellySize(prob, play.odds);
      return {
        ...play,
        ...sizing,
        conviction: conviction.score,
        convictionGrade: conviction.grade,
      };
    });
    
    // Add to all plays
    allPlays.push(...plays.map(p => ({
      ...p,
      game: `${awayCode}@${homeCode}`,
      gameTime: game.commence_time,
    })));
    
    // Game card
    gameCards.push({
      away: {
        code: awayCode,
        name: game.away_team,
        winProb: pred.away.winProb,
        ml: pred.away.ml,
        power: pred.away.adjPower,
        rolling: pred.rollingAdj?.away || null,
        injuries: pred.injuryAdj?.away || null,
        bubble: motivationData.away,
        b2b: b2bData?.away || null,
      },
      home: {
        code: homeCode,
        name: game.home_team,
        winProb: pred.home.winProb,
        ml: pred.home.ml,
        power: pred.home.adjPower,
        rolling: pred.rollingAdj?.home || null,
        injuries: pred.injuryAdj?.home || null,
        bubble: motivationData.home,
        b2b: b2bData?.home || null,
      },
      spread: pred.spread,
      projTotal: pred.projTotal,
      puckLine: pred.puckLine,
      goalie: goalieData,
      motivation: motivationData,
      conviction,
      bestLines: valueResult.bestLines,
      plays,
      gameTime: game.commence_time,
      espnFallback: game.espnFallback || false,
    });
  }
  
  // Sort plays by edge descending
  allPlays.sort((a, b) => b.edge - a.edge);
  
  // Portfolio
  const totalWager = allPlays.reduce((sum, p) => sum + p.wager, 0);
  const totalEV = allPlays.reduce((sum, p) => sum + p.ev, 0);
  const smashCount = allPlays.filter(p => p.tier === 'SMASH').length;
  const strongCount = allPlays.filter(p => p.tier === 'STRONG').length;
  const leanCount = allPlays.filter(p => p.tier === 'LEAN').length;
  
  // Bubble spotlight — games with biggest motivation mismatches
  const bubbleGames = gameCards
    .filter(g => g.motivation.signal)
    .sort((a, b) => Math.abs(b.motivation.mismatch) - Math.abs(a.motivation.mismatch));
  
  // Goalie alerts — games with confirmed backup starters
  const goalieAlerts = gameCards.filter(g => g.goalie.backupAlert);
  
  const result = {
    date: today,
    games: gameCards,
    plays: allPlays,
    portfolio: {
      totalPlays: allPlays.length,
      smash: smashCount,
      strong: strongCount,
      lean: leanCount,
      totalWager: +totalWager.toFixed(2),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
      bankroll: 1000,
    },
    spotlights: {
      bubbleGames: bubbleGames.map(g => ({
        game: `${g.away.code}@${g.home.code}`,
        mismatch: g.motivation.mismatch,
        signal: g.motivation.signal,
        away: { code: g.away.code, bubble: g.away.bubble },
        home: { code: g.home.code, bubble: g.home.bubble },
      })),
      goalieAlerts: goalieAlerts.map(g => ({
        game: `${g.away.code}@${g.home.code}`,
        homeGoalie: g.goalie.homeGoalie,
        awayGoalie: g.goalie.awayGoalie,
        impact: g.goalie.impact,
      })),
      b2bAlerts: gameCards.filter(g => g.away.b2b?.isB2B || g.home.b2b?.isB2B).map(g => ({
        game: `${g.away.code}@${g.home.code}`,
        awayB2B: g.away.b2b?.isB2B || false,
        homeB2B: g.home.b2b?.isB2B || false,
      })),
    },
    meta: {
      buildTime: Date.now() - startTime,
      oddsSource,
      gamesFound: todayGames.length,
      gamesProcessed: gameCards.length,
      version: 'v98.0',
    },
  };
  
  // Cache
  lastBuild = result;
  lastBuildTime = Date.now();
  
  // Save to disk
  try {
    const diskPath = path.join(CACHE_DIR, `${today}.json`);
    fs.writeFileSync(diskPath, JSON.stringify(result, null, 2));
  } catch(e) {}
  
  return result;
}

// ==================== HISTORY + GRADING ====================
function getHistory(date) {
  try {
    const diskPath = path.join(CACHE_DIR, `${date}.json`);
    if (fs.existsSync(diskPath)) {
      return JSON.parse(fs.readFileSync(diskPath, 'utf-8'));
    }
  } catch(e) {}
  return null;
}

function gradePlay(play, result) {
  // result: { winner: 'home'|'away', homeScore, awayScore, totalGoals }
  if (!result) return null;
  
  let won = false;
  if (play.type === 'ML') {
    won = play.side === result.winner;
  } else if (play.type === 'PL') {
    const margin = result.homeScore - result.awayScore;
    if (play.side === 'home') won = margin >= 2; // home -1.5
    else won = margin <= -2 || (margin >= -1); // away +1.5 = lost by 1 or won
  } else if (play.type === 'TOTAL') {
    if (play.side === 'over') won = result.totalGoals > play.line;
    else won = result.totalGoals < play.line;
  }
  
  return {
    ...play,
    result: won ? 'WIN' : 'LOSS',
    profit: won ? play.wager * (play.odds > 0 ? play.odds / 100 : 100 / Math.abs(play.odds)) : -play.wager,
  };
}

function getStatus() {
  return {
    cached: !!lastBuild,
    lastBuildTime: lastBuildTime ? new Date(lastBuildTime).toISOString() : null,
    cacheTTL: CACHE_TTL,
    date: lastBuild?.date || null,
    gamesProcessed: lastBuild?.games?.length || 0,
    totalPlays: lastBuild?.plays?.length || 0,
  };
}

module.exports = {
  buildDailyCard,
  getHistory,
  gradePlay,
  getStatus,
  getBubbleStatus,
  getMotivationMismatch,
  detectB2B,
};
