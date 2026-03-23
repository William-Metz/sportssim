/**
 * Daily NBA Betting Card — SportsSim v90.0
 * ==========================================
 * THE NBA REGULAR SEASON MONEY PRINTER.
 *
 * Generates a comprehensive daily NBA betting card with:
 *   1. Full game predictions via asyncPredict (rest/tank + injuries + rolling)
 *   2. Live odds from The Odds API
 *   3. Value detection across ML, spread, total markets
 *   4. Rest/tank mismatch signals (CRITICAL for final 12 games)
 *   5. Kelly-optimized portfolio sizing
 *   6. Conviction scoring per play
 *   7. Playoff seeding implications
 *   8. Historical grade tracking
 *
 * WHY THIS MATTERS: With 10-12 games per night and massive rest/tank
 * mismatches in the final 2 weeks, a structured daily card prevents
 * missing any +EV opportunity and enforces portfolio discipline.
 *
 * EDGE SOURCES (priority order):
 *   1. Rest/tank mismatches — 4-6pt swing, books are SLOW to adjust
 *   2. B2B detection — teams on B2B with TANKING motivation = fade hard
 *   3. Motivation asymmetry — DESPERATE vs COASTING = systematic mispricing
 *   4. Injury-adjusted spreads — star player rest creates line value
 *   5. Totals with pace adjustments — tank teams play random lineups = volatile
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Safe requires
let nbaModel = null;
let restTankService = null;
let calibration = null;
let kellyService = null;
let injuryService = null;
let rollingStats = null;
let seedingSim = null;
let playoffSeries = null;

try { nbaModel = require('../models/nba'); } catch(e) {}
try { restTankService = require('./nba-rest-tank'); } catch(e) {}
try { calibration = require('./calibration'); } catch(e) {}
try { kellyService = require('./kelly'); } catch(e) {}
try { injuryService = require('./injuries'); } catch(e) {}
try { rollingStats = require('./rolling-stats'); } catch(e) {}
try { seedingSim = require('./nba-seeding-sim'); } catch(e) {}
try { playoffSeries = require('./playoff-series'); } catch(e) {}

// ==================== CACHE ====================
const CACHE_DIR = path.join(__dirname, 'daily-nba-cache');
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
const NBA_NAMES = {
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

function resolveTeam(name) {
  if (!name) return null;
  const upper = name.toUpperCase();
  // Direct abbreviation
  if (nbaModel && nbaModel.TEAMS && nbaModel.TEAMS[upper]) return upper;
  // Full name mapping
  if (NBA_NAMES[name]) return NBA_NAMES[name];
  // Partial match
  for (const [full, abbr] of Object.entries(NBA_NAMES)) {
    if (name.includes(full.split(' ').pop())) return abbr;
  }
  return null;
}

// ==================== ODDS FETCHING ====================
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : require('http');
    mod.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchNBAOdds(apiKey) {
  if (!apiKey) return [];
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&oddsFormat=american&markets=h2h,spreads,totals`;
    const data = await fetchJSON(url);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[daily-nba-card] Odds fetch error:', e.message);
    return [];
  }
}

// ==================== LINE EXTRACTION ====================
function extractBookLines(bookmakers, homeTeamName) {
  const lines = {};
  const bookPriority = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'PointsBet'];
  
  for (const bookName of bookPriority) {
    const book = bookmakers.find(b => b.title === bookName);
    if (!book) continue;
    
    for (const market of (book.markets || [])) {
      if (market.key === 'h2h' && !lines.ml) {
        const homeOutcome = market.outcomes?.find(o => o.name === homeTeamName);
        const awayOutcome = market.outcomes?.find(o => o.name !== homeTeamName);
        if (homeOutcome && awayOutcome) {
          lines.ml = {
            book: bookName,
            homeOdds: homeOutcome.price,
            awayOdds: awayOutcome.price,
            homeImplied: americanToProb(homeOutcome.price),
            awayImplied: americanToProb(awayOutcome.price),
          };
        }
      }
      if (market.key === 'spreads' && !lines.spread) {
        const homeOutcome = market.outcomes?.find(o => o.name === homeTeamName);
        const awayOutcome = market.outcomes?.find(o => o.name !== homeTeamName);
        if (homeOutcome && awayOutcome) {
          lines.spread = {
            book: bookName,
            homeSpread: homeOutcome.point,
            awaySpread: awayOutcome.point,
            homeOdds: homeOutcome.price,
            awayOdds: awayOutcome.price,
          };
        }
      }
      if (market.key === 'totals' && !lines.total) {
        const over = market.outcomes?.find(o => o.name === 'Over');
        const under = market.outcomes?.find(o => o.name === 'Under');
        if (over && under) {
          lines.total = {
            book: bookName,
            line: over.point,
            overOdds: over.price,
            underOdds: under.price,
          };
        }
      }
    }
  }
  return lines;
}

function americanToProb(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function americanToDecimal(odds) {
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

// ==================== CONVICTION SCORING ====================
function calculateConviction(pred, lines, restTank, edge, betType) {
  let score = 0;
  
  // 1. Edge size (0-25)
  const absEdge = Math.abs(edge);
  score += Math.min(25, absEdge * 3);
  
  // 2. Rest/tank signal (0-25) — THIS IS THE BIG ONE FOR NBA LATE SEASON
  if (restTank) {
    const mismatch = Math.abs(restTank.netAdjustment || 0);
    if (mismatch >= 5) score += 25;      // Massive mismatch
    else if (mismatch >= 3) score += 18;  // Strong mismatch
    else if (mismatch >= 1.5) score += 10; // Moderate mismatch
    
    // Bonus for clear motivation asymmetry
    const motA = restTank.awayMotivation || '';
    const motH = restTank.homeMotivation || '';
    if ((motA === 'DESPERATE' && motH === 'TANKING') || (motH === 'DESPERATE' && motA === 'TANKING')) {
      score += 10; // Max conviction: DESPERATE vs TANKING
    } else if ((motA === 'DESPERATE' && motH === 'COASTING') || (motH === 'DESPERATE' && motA === 'COASTING')) {
      score += 6;
    }
  }
  
  // 3. Model confidence (0-15)
  const probDiff = Math.abs((pred.homeWinProb || 50) - 50);
  score += Math.min(15, probDiff * 0.3);
  
  // 4. Injury edge (0-10)
  if (pred._injuryAdj) {
    const injImpact = Math.abs(pred._injuryAdj.awayAdj || 0) + Math.abs(pred._injuryAdj.homeAdj || 0);
    if (injImpact >= 3) score += 10;
    else if (injImpact >= 1.5) score += 6;
    else if (injImpact >= 0.5) score += 3;
  }
  
  // 5. Recent form alignment (0-10)
  if (pred._rollingAdj) {
    const formDiff = Math.abs(pred._rollingAdj.homeAdj || 0) - Math.abs(pred._rollingAdj.awayAdj || 0);
    if (Math.abs(formDiff) >= 2) score += 10;
    else if (Math.abs(formDiff) >= 1) score += 5;
  }
  
  // 6. Line movement alignment (0-10)
  // Future: track line movement direction and add conviction when our edge aligns
  
  // 7. Market type bonus (0-5)
  if (betType === 'total' && restTank) {
    // Totals with rest/tank are extra valuable — unknown lineups = volatile
    score += 5;
  }
  
  return Math.min(100, Math.round(score));
}

function convictionGrade(score) {
  if (score >= 80) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B+';
  if (score >= 50) return 'B';
  if (score >= 40) return 'C+';
  if (score >= 30) return 'C';
  return 'D';
}

function convictionTier(score) {
  if (score >= 70) return 'SMASH';
  if (score >= 50) return 'STRONG';
  if (score >= 30) return 'LEAN';
  return 'SPECULATIVE';
}

// ==================== KELLY SIZING ====================
function kellySize(prob, odds, bankroll = 1000, fraction = 0.5) {
  const decimal = americanToDecimal(odds);
  const b = decimal - 1;
  const q = 1 - prob;
  const kelly = (b * prob - q) / b;
  if (kelly <= 0) return { wager: 0, kelly: 0 };
  const sized = Math.min(kelly * fraction, MAX_KELLY_BET) * bankroll;
  return {
    wager: Math.round(sized * 100) / 100,
    kelly: Math.round(kelly * 10000) / 10000,
    halfKelly: Math.round(kelly * fraction * 10000) / 10000,
    ev: Math.round(sized * (decimal * prob - 1) * 100) / 100,
  };
}

// ==================== SEEDING IMPLICATIONS ====================
function getPlayoffImplications(awayAbbr, homeAbbr) {
  // Identify games with playoff seeding significance
  const implications = [];
  
  // Known tight races (updated for current standings)
  const eastPlayInTeams = ['TOR', 'ATL', 'PHI', 'ORL', 'MIA', 'CHA'];
  const westPlayInTeams = ['PHX', 'SAC', 'SAS', 'DAL', 'MEM', 'HOU'];
  const tankTeams = ['WAS', 'UTA', 'BKN', 'IND', 'POR', 'NOP'];
  
  if (eastPlayInTeams.includes(awayAbbr) || eastPlayInTeams.includes(homeAbbr)) {
    implications.push('East play-in race — every game matters for seeding');
  }
  if (westPlayInTeams.includes(awayAbbr) || westPlayInTeams.includes(homeAbbr)) {
    implications.push('West seeding battle — playoff positioning at stake');
  }
  if (tankTeams.includes(awayAbbr) || tankTeams.includes(homeAbbr)) {
    implications.push('Tank watch — lottery positioning implications');
  }
  
  return implications;
}

// ==================== MAIN BUILD FUNCTION ====================
async function buildDailyCard(opts = {}) {
  const {
    date = new Date().toISOString().split('T')[0],
    oddsApiKey = '',
    bankroll = 1000,
    kellyFraction = 0.5,
    forceRefresh = false,
  } = opts;

  // Check cache
  if (!forceRefresh && lastBuild && (Date.now() - lastBuildTime < CACHE_TTL)) {
    return { ...lastBuild, cached: true };
  }

  const startTime = Date.now();
  const errors = [];
  const warnings = [];

  // ==================== 1. FETCH LIVE ODDS ====================
  let oddsData = [];
  try {
    oddsData = await fetchNBAOdds(oddsApiKey);
  } catch (e) {
    errors.push(`Odds fetch: ${e.message}`);
  }

  if (oddsData.length === 0) {
    warnings.push('No NBA odds available — games may not be scheduled yet or API key missing');
  }

  // ==================== 2. FETCH REST/TANK ANALYSIS ====================
  let restTankData = {};
  try {
    if (restTankService && nbaModel) {
      const standings = nbaModel.getTeams();
      const scan = await restTankService.scanTodaysGames(standings);
      if (scan && scan.games) {
        for (const game of scan.games) {
          const key = `${game.away}@${game.home}`;
          restTankData[key] = game;
        }
      }
    }
  } catch (e) {
    warnings.push(`Rest/tank scan: ${e.message}`);
  }

  // ==================== 3. PROCESS EACH GAME ====================
  const gameCards = [];
  const allBets = [];
  let signalCounts = { restTank: 0, injuries: 0, rolling: 0, calibrated: 0, seeding: 0 };

  for (const game of oddsData) {
    const awayAbbr = resolveTeam(game.away_team);
    const homeAbbr = resolveTeam(game.home_team);
    if (!awayAbbr || !homeAbbr) continue;

    const gameKey = `${awayAbbr}@${homeAbbr}`;

    // Get prediction with full signal stack
    let pred;
    try {
      pred = await nbaModel.asyncPredict(awayAbbr, homeAbbr);
      if (pred.error) {
        warnings.push(`Prediction error for ${gameKey}: ${pred.error}`);
        continue;
      }
    } catch (e) {
      warnings.push(`Prediction failed for ${gameKey}: ${e.message}`);
      continue;
    }

    // Apply calibration
    const calibrated = calibration ? calibration.calibratePrediction(pred, 'nba') : pred;
    if (calibrated) signalCounts.calibrated++;

    // Get rest/tank data for this game
    const restTank = restTankData[gameKey] || null;
    if (restTank && restTank.netAdjustment && Math.abs(restTank.netAdjustment) >= 1.0) {
      signalCounts.restTank++;
    }

    // Extract lines from books
    const lines = extractBookLines(game.bookmakers || [], game.home_team);
    
    // Get playoff implications
    const implications = getPlayoffImplications(awayAbbr, homeAbbr);
    if (implications.length > 0) signalCounts.seeding++;

    // ==================== FIND VALUE BETS ====================
    const gameBets = [];

    // ML value
    if (lines.ml) {
      // Home ML
      const homeEdge = ((calibrated.homeWinProb / 100) - lines.ml.homeImplied) * 100;
      if (homeEdge >= MIN_EDGE) {
        const sizing = kellySize(calibrated.homeWinProb / 100, lines.ml.homeOdds, bankroll, kellyFraction);
        const conviction = calculateConviction(pred, lines, restTank, homeEdge, 'ml');
        gameBets.push({
          type: 'ML',
          pick: `${homeAbbr} ML`,
          side: 'home',
          odds: lines.ml.homeOdds,
          book: lines.ml.book,
          modelProb: calibrated.homeWinProb,
          impliedProb: +(lines.ml.homeImplied * 100).toFixed(1),
          edge: +homeEdge.toFixed(1),
          conviction,
          grade: convictionGrade(conviction),
          tier: convictionTier(conviction),
          ...sizing,
        });
      }
      // Away ML
      const awayEdge = ((calibrated.awayWinProb / 100) - lines.ml.awayImplied) * 100;
      if (awayEdge >= MIN_EDGE) {
        const sizing = kellySize(calibrated.awayWinProb / 100, lines.ml.awayOdds, bankroll, kellyFraction);
        const conviction = calculateConviction(pred, lines, restTank, awayEdge, 'ml');
        gameBets.push({
          type: 'ML',
          pick: `${awayAbbr} ML`,
          side: 'away',
          odds: lines.ml.awayOdds,
          book: lines.ml.book,
          modelProb: calibrated.awayWinProb,
          impliedProb: +(lines.ml.awayImplied * 100).toFixed(1),
          edge: +awayEdge.toFixed(1),
          conviction,
          grade: convictionGrade(conviction),
          tier: convictionTier(conviction),
          ...sizing,
        });
      }
    }

    // Spread value
    if (lines.spread) {
      const bookSpread = lines.spread.homeSpread;
      const modelSpread = calibrated.spread || pred.spread;
      const spreadDiff = Math.abs(modelSpread - bookSpread);
      
      if (spreadDiff >= 2.0) { // Need 2+ points of spread value
        // Determine which side has value
        const homeHasValue = modelSpread > bookSpread; // Model says home is better than book thinks
        const sideOdds = homeHasValue ? lines.spread.homeOdds : lines.spread.awayOdds;
        const sideTeam = homeHasValue ? homeAbbr : awayAbbr;
        const sideSpread = homeHasValue ? bookSpread : lines.spread.awaySpread;
        
        // Estimate prob of covering using spread difference
        const coverProb = 0.5 + (spreadDiff / 30); // Rough linear: 2pt diff = ~57%, 5pt = ~67%
        const spreadEdge = (coverProb - 0.5) * 100 * 2; // Convert to edge %
        
        if (spreadEdge >= MIN_EDGE) {
          const sizing = kellySize(coverProb, sideOdds, bankroll, kellyFraction);
          const conviction = calculateConviction(pred, lines, restTank, spreadEdge, 'spread');
          gameBets.push({
            type: 'SPREAD',
            pick: `${sideTeam} ${sideSpread > 0 ? '+' : ''}${sideSpread}`,
            side: homeHasValue ? 'home' : 'away',
            odds: sideOdds,
            book: lines.spread.book,
            modelSpread: +modelSpread.toFixed(1),
            bookSpread: bookSpread,
            spreadDiff: +spreadDiff.toFixed(1),
            modelProb: +(coverProb * 100).toFixed(1),
            edge: +spreadEdge.toFixed(1),
            conviction,
            grade: convictionGrade(conviction),
            tier: convictionTier(conviction),
            ...sizing,
          });
        }
      }
    }

    // Total value
    if (lines.total && calibrated.expectedTotal) {
      const bookTotal = lines.total.line;
      const modelTotal = calibrated.expectedTotal;
      const totalDiff = modelTotal - bookTotal;
      
      if (Math.abs(totalDiff) >= 3.0) { // Need 3+ points of total value in NBA
        const isOver = totalDiff > 0;
        const sideOdds = isOver ? lines.total.overOdds : lines.total.underOdds;
        
        // Estimate over/under prob using total difference
        const overProb = 0.5 + (totalDiff / 40); // NBA: 3pt diff ≈ 57.5%, 6pt ≈ 65%
        const sideProb = isOver ? overProb : (1 - overProb);
        const totalEdge = (sideProb - 0.5) * 100 * 2;
        
        if (totalEdge >= MIN_EDGE) {
          const sizing = kellySize(sideProb, sideOdds, bankroll, kellyFraction);
          const conviction = calculateConviction(pred, lines, restTank, totalEdge, 'total');
          gameBets.push({
            type: 'TOTAL',
            pick: `${isOver ? 'OVER' : 'UNDER'} ${bookTotal}`,
            side: isOver ? 'over' : 'under',
            odds: sideOdds,
            book: lines.total.book,
            modelTotal: +modelTotal.toFixed(1),
            bookTotal: bookTotal,
            totalDiff: +totalDiff.toFixed(1),
            modelProb: +(sideProb * 100).toFixed(1),
            edge: +totalEdge.toFixed(1),
            conviction,
            grade: convictionGrade(conviction),
            tier: convictionTier(conviction),
            ...sizing,
          });
        }
      }
    }

    // Build game card
    const card = {
      game: gameKey,
      awayTeam: awayAbbr,
      homeTeam: homeAbbr,
      awayFull: game.away_team,
      homeFull: game.home_team,
      commenceTime: game.commence_time,
      prediction: {
        spread: calibrated.spread || pred.spread,
        homeWinProb: calibrated.homeWinProb,
        awayWinProb: calibrated.awayWinProb,
        expectedTotal: calibrated.expectedTotal || pred.expectedTotal,
      },
      restTank: restTank ? {
        awayMotivation: restTank.awayMotivation,
        homeMotivation: restTank.homeMotivation,
        awayAdjustment: restTank.awayAdjustment,
        homeAdjustment: restTank.homeAdjustment,
        netAdjustment: restTank.netAdjustment,
        isB2BAway: restTank.isB2BAway,
        isB2BHome: restTank.isB2BHome,
        mismatchLevel: restTank.mismatchLevel,
        signal: restTank.signal,
      } : null,
      lines,
      bets: gameBets,
      betCount: gameBets.length,
      maxEdge: gameBets.length > 0 ? Math.max(...gameBets.map(b => b.edge)) : 0,
      maxConviction: gameBets.length > 0 ? Math.max(...gameBets.map(b => b.conviction)) : 0,
      playoffImplications: implications,
      hasMismatch: restTank && Math.abs(restTank.netAdjustment || 0) >= 2.0,
    };

    gameCards.push(card);
    allBets.push(...gameBets);
  }

  // Sort games by best edge
  gameCards.sort((a, b) => b.maxEdge - a.maxEdge);
  
  // Sort all bets by conviction
  allBets.sort((a, b) => b.conviction - a.conviction);

  // ==================== 4. BUILD PORTFOLIO ====================
  const smashPlays = allBets.filter(b => b.tier === 'SMASH');
  const strongPlays = allBets.filter(b => b.tier === 'STRONG');
  const leanPlays = allBets.filter(b => b.tier === 'LEAN');
  const specPlays = allBets.filter(b => b.tier === 'SPECULATIVE');

  const totalWager = allBets.reduce((sum, b) => sum + (b.wager || 0), 0);
  const totalEV = allBets.reduce((sum, b) => sum + (b.ev || 0), 0);

  // ==================== 5. MISMATCH SPOTLIGHT ====================
  const mismatchGames = gameCards.filter(g => g.hasMismatch);
  const mismatchSpotlight = mismatchGames.map(g => ({
    game: g.game,
    awayMotivation: g.restTank?.awayMotivation,
    homeMotivation: g.restTank?.homeMotivation,
    netSwing: g.restTank?.netAdjustment,
    isB2BAway: g.restTank?.isB2BAway,
    isB2BHome: g.restTank?.isB2BHome,
    bestBet: g.bets.length > 0 ? g.bets.sort((a, b) => b.conviction - a.conviction)[0] : null,
  })).sort((a, b) => Math.abs(b.netSwing || 0) - Math.abs(a.netSwing || 0));

  // ==================== 6. BUILD RESULT ====================
  const elapsed = Date.now() - startTime;
  
  const result = {
    date,
    buildTime: `${(elapsed / 1000).toFixed(1)}s`,
    elapsedMs: elapsed,
    
    headline: {
      gamesOnSlate: gameCards.length,
      gamesWithEdge: gameCards.filter(g => g.betCount > 0).length,
      totalBets: allBets.length,
      smashPlays: smashPlays.length,
      strongPlays: strongPlays.length,
      leanPlays: leanPlays.length,
      totalWager: +totalWager.toFixed(2),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
      mismatchGames: mismatchGames.length,
      bestPlay: allBets.length > 0 ? {
        game: allBets[0].pick,
        edge: allBets[0].edge,
        conviction: allBets[0].conviction,
        grade: allBets[0].grade,
        tier: allBets[0].tier,
      } : null,
    },

    signals: signalCounts,
    
    mismatchSpotlight,

    tiers: {
      smash: { label: '🔥 SMASH PLAYS', count: smashPlays.length, plays: smashPlays },
      strong: { label: '💪 STRONG', count: strongPlays.length, plays: strongPlays },
      lean: { label: '📊 LEAN', count: leanPlays.length, plays: leanPlays },
      speculative: { label: '🔍 SPECULATIVE', count: specPlays.length, plays: specPlays },
    },

    games: gameCards,
    allBets,

    errors,
    warnings,
  };

  // Cache it
  lastBuild = result;
  lastBuildTime = Date.now();

  // Save to disk
  try {
    const cacheFile = path.join(CACHE_DIR, `nba-card-${date}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  } catch (e) { /* cache save optional */ }

  return result;
}

// ==================== STATUS ====================
function getStatus() {
  return {
    service: 'daily-nba-card',
    version: 'v90.0',
    lastBuild: lastBuild ? lastBuild.date : null,
    lastBuildTime: lastBuildTime ? new Date(lastBuildTime).toISOString() : null,
    cacheAge: lastBuildTime ? `${Math.round((Date.now() - lastBuildTime) / 1000)}s` : null,
    cacheTTL: `${CACHE_TTL / 1000}s`,
    hasModel: !!nbaModel,
    hasRestTank: !!restTankService,
    hasCalibration: !!calibration,
    hasKelly: !!kellyService,
  };
}

module.exports = {
  buildDailyCard,
  getStatus,
};
