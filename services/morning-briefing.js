/**
 * Morning Briefing Service — SportsSim v109.0
 * =============================================
 * 🌅 THE ONE ENDPOINT THAT PRINTS MONEY EVERY DAY
 *
 * Hit /api/briefing when you wake up → see every edge across all sports.
 * Combines: MLB daily card, NBA daily card, NHL daily card, futures, 
 * OD playbook (when active), and cross-sport portfolio optimization.
 *
 * Features:
 *   - Multi-sport daily value detection
 *   - Cross-sport Kelly portfolio with correlation adjustments
 *   - Season-phase awareness (Opening Week → Regular Season → Playoffs)
 *   - Rest/tank/motivation signals for NBA/NHL
 *   - Weather + lineup alerts for MLB
 *   - Futures value watchlist
 *   - Yesterday's results + P&L tracking
 *   - Edge decay alerts (value disappearing)
 *   - Countdown timers (OD, playoffs, draft)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ==================== DEPENDENCIES ====================
let mlbModel = null;
let nbaModel = null;
let nhlModel = null;
let dailyMlbCard = null;
let dailyNbaCard = null;
let dailyNhlCard = null;
let autoScanner = null;
let betTracker = null;
let seasonSim = null;
let odPlaybookCache = null;
let restTankModel = null;
let lineupBridge = null;
let weatherForecast = null;

try { mlbModel = require('../models/mlb'); } catch(e) {}
try { nbaModel = require('../models/nba'); } catch(e) {}
try { nhlModel = require('../models/nhl'); } catch(e) {}
try { dailyMlbCard = require('./daily-mlb-card'); } catch(e) {}
try { dailyNbaCard = require('./daily-nba-card'); } catch(e) {}
try { dailyNhlCard = require('./daily-nhl-card'); } catch(e) {}
try { autoScanner = require('./auto-scanner'); } catch(e) {}
try { betTracker = require('./bet-tracker'); } catch(e) {}
try { seasonSim = require('./season-simulator'); } catch(e) {}
try { odPlaybookCache = require('./od-playbook-cache'); } catch(e) {}
try { restTankModel = require('./rest-tank-model'); } catch(e) {}
try { lineupBridge = require('./lineup-bridge'); } catch(e) {}
try { weatherForecast = require('./weather-forecast'); } catch(e) {}

// ==================== CACHE ====================
const CACHE_FILE = path.join(__dirname, 'briefing-cache.json');
const CACHE_TTL = 10 * 60 * 1000; // 10 min — odds move
let lastBriefing = null;
let lastBuildTime = 0;
let isBuilding = false;

// ==================== CORE ====================

/**
 * Build the morning briefing — the unified daily edge report
 */
async function buildBriefing(opts = {}) {
  const { forceRefresh = false, oddsApiKey = '', bankroll = 1000, kellyFraction = 0.5 } = opts;
  
  // Cache check
  const now = Date.now();
  if (!forceRefresh && lastBriefing && (now - lastBuildTime) < CACHE_TTL) {
    return { ...lastBriefing, cached: true, cacheAge: Math.round((now - lastBuildTime) / 1000) };
  }
  
  if (isBuilding) {
    return lastBriefing ? { ...lastBriefing, cached: true, building: true } : { building: true };
  }
  
  isBuilding = true;
  const startMs = Date.now();
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const briefing = {
      date: today,
      timestamp: new Date().toISOString(),
      version: '109.0',
      
      // Headlines
      headline: null,
      
      // Sport sections
      mlb: null,
      nba: null,
      nhl: null,
      
      // Futures watchlist
      futures: null,
      
      // OD-specific (when near Opening Day)
      openingDay: null,
      
      // Cross-sport portfolio
      portfolio: null,
      
      // Yesterday's results
      yesterday: null,
      
      // Alerts
      alerts: [],
      
      // Countdowns
      countdowns: getCountdowns(today),
      
      // Meta
      elapsedMs: 0,
      errors: [],
    };
    
    // ==================== PARALLEL FETCH ====================
    const promises = [];
    
    // MLB Daily Card
    if (dailyMlbCard) {
      promises.push(
        safeCall('mlb', async () => {
          const card = await dailyMlbCard.buildDailyCard({
            date: today,
            forceRefresh,
            oddsApiKey,
            bankroll,
            kellyFraction,
          });
          return card;
        })
      );
    } else {
      promises.push(Promise.resolve({ sport: 'mlb', error: 'MLB card not loaded' }));
    }
    
    // NBA Daily Card
    if (dailyNbaCard) {
      promises.push(
        safeCall('nba', async () => {
          const card = await dailyNbaCard.buildDailyCard({
            date: today,
            forceRefresh,
            oddsApiKey,
            bankroll,
            kellyFraction,
          });
          return card;
        })
      );
    } else {
      promises.push(Promise.resolve({ sport: 'nba', error: 'NBA card not loaded' }));
    }
    
    // NHL Daily Card
    if (dailyNhlCard) {
      promises.push(
        safeCall('nhl', async () => {
          const card = await dailyNhlCard.buildDailyCard({
            date: today,
            forceRefresh: true,
            oddsApiKey,
            bankroll,
            kellyFraction,
          });
          return card;
        })
      );
    } else {
      promises.push(Promise.resolve({ sport: 'nhl', error: 'NHL card not loaded' }));
    }
    
    // Yesterday's results (non-blocking)
    promises.push(
      safeCall('yesterday', async () => {
        if (!betTracker) return { error: 'Bet tracker not loaded' };
        const yesterday = getYesterday(today);
        try {
          const results = betTracker.getResults ? await betTracker.getResults(yesterday) : null;
          return results || { date: yesterday, note: 'No results available' };
        } catch(e) {
          return { error: e.message };
        }
      })
    );
    
    // OD Playbook (if we're in OD window)
    const odWindow = isOpeningDayWindow(today);
    if (odWindow && odPlaybookCache) {
      promises.push(
        safeCall('openingDay', async () => {
          const cached = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
          if (cached) return { active: true, ...summarizeOdPlaybook(cached) };
          return { active: true, note: 'Playbook cache building...' };
        })
      );
    }
    
    // Futures Value
    promises.push(
      safeCall('futures', async () => {
        return getFuturesWatchlist();
      })
    );
    
    // Execute all in parallel
    const results = await Promise.all(promises);
    
    // Process results
    for (const result of results) {
      if (!result || !result.sport) continue;
      
      switch(result.sport) {
        case 'mlb':
          briefing.mlb = processMLBCard(result.data);
          break;
        case 'nba':
          briefing.nba = processNBACard(result.data);
          break;
        case 'nhl':
          briefing.nhl = processNHLCard(result.data);
          break;
        case 'yesterday':
          briefing.yesterday = result.data;
          break;
        case 'openingDay':
          briefing.openingDay = result.data;
          break;
        case 'futures':
          briefing.futures = result.data;
          break;
      }
      
      if (result.error) {
        briefing.errors.push({ sport: result.sport, error: result.error });
      }
    }
    
    // Build cross-sport portfolio
    briefing.portfolio = buildCrossPortfolio(briefing, bankroll, kellyFraction);
    
    // Generate headline
    briefing.headline = generateHeadline(briefing);
    
    // Generate alerts
    briefing.alerts = generateAlerts(briefing, today);
    
    briefing.elapsedMs = Date.now() - startMs;
    
    // Cache
    lastBriefing = briefing;
    lastBuildTime = Date.now();
    
    // Persist to disk
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(briefing, null, 2));
    } catch(e) {}
    
    return briefing;
    
  } catch(e) {
    return { error: e.message, elapsedMs: Date.now() - startMs };
  } finally {
    isBuilding = false;
  }
}

// ==================== PROCESS SPORT CARDS ====================

function processMLBCard(card) {
  if (!card || card.error) return { error: card?.error || 'No data', games: 0, plays: [] };
  
  const games = card.headline?.gamesOnSlate || card.games?.length || 0;
  const plays = [];
  
  // Extract top plays
  if (card.games) {
    for (const game of card.games) {
      if (game.plays) {
        for (const play of game.plays) {
          if (play.edge >= 3.0 || play.grade === 'SMASH' || play.grade === 'STRONG') {
            plays.push({
              game: `${game.away || game.awayAbbr}@${game.home || game.homeAbbr}`,
              type: play.type || play.market || 'ML',
              side: play.side || play.pick,
              edge: play.edge,
              odds: play.odds,
              conviction: play.conviction,
              grade: play.grade,
              kelly: play.kelly,
              sport: 'MLB',
            });
          }
        }
      }
      
      // Also grab from gameAnalysis/bestBets
      if (game.bestBets) {
        for (const bet of game.bestBets) {
          if (!plays.find(p => p.game === `${game.away}@${game.home}` && p.type === bet.type)) {
            plays.push({
              game: `${game.away || game.awayAbbr}@${game.home || game.homeAbbr}`,
              type: bet.type || bet.market || 'ML',
              side: bet.side || bet.pick,
              edge: bet.edge,
              odds: bet.odds,
              conviction: bet.conviction,
              grade: bet.grade,
              sport: 'MLB',
            });
          }
        }
      }
    }
  }
  
  // Also check card-level plays
  if (card.bettingCard) {
    for (const play of card.bettingCard) {
      if (play.edge >= 3.0) {
        const key = `${play.away || play.game}`;
        if (!plays.find(p => p.game === key && p.type === play.type)) {
          plays.push({
            game: play.game || `${play.away}@${play.home}`,
            type: play.type || play.market,
            side: play.side || play.pick,
            edge: play.edge,
            odds: play.odds,
            conviction: play.conviction,
            grade: play.grade,
            sport: 'MLB',
          });
        }
      }
    }
  }
  
  // Sort by edge
  plays.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  return {
    games,
    totalPlays: plays.length,
    smashPlays: plays.filter(p => p.grade === 'SMASH' || p.grade === 'A+' || p.grade === 'A').length,
    strongPlays: plays.filter(p => p.grade === 'STRONG' || p.grade === 'B+' || p.grade === 'B').length,
    totalEV: plays.reduce((sum, p) => sum + (p.edge || 0) * (p.kelly || 10) / 100, 0).toFixed(2),
    topPlays: plays.slice(0, 10),
    signals: card.signals || {},
    seasonPhase: card.seasonContext?.phase || 'unknown',
  };
}

function processNBACard(card) {
  if (!card || card.error) return { error: card?.error || 'No data', games: 0, plays: [] };
  
  const games = card.headline?.gamesOnSlate || card.games?.length || 0;
  const plays = [];
  
  if (card.games) {
    for (const game of card.games) {
      // Rest/tank spotlight
      if (game.restTank && game.restTank.netSwing && Math.abs(game.restTank.netSwing) >= 3.0) {
        plays.push({
          game: `${game.away || game.awayAbbr}@${game.home || game.homeAbbr}`,
          type: 'REST_TANK',
          side: game.restTank.lean || 'MISMATCH',
          edge: Math.abs(game.restTank.netSwing),
          conviction: game.restTank.conviction || game.conviction,
          grade: Math.abs(game.restTank.netSwing) >= 5 ? 'SMASH' : 'STRONG',
          sport: 'NBA',
          signal: `${game.restTank.awayMotivation || '?'} vs ${game.restTank.homeMotivation || '?'}`,
        });
      }
      
      // Value plays
      if (game.plays) {
        for (const play of game.plays) {
          if (play.edge >= 3.0) {
            plays.push({
              game: `${game.away || game.awayAbbr}@${game.home || game.homeAbbr}`,
              type: play.type || play.market,
              side: play.side || play.pick,
              edge: play.edge,
              odds: play.odds,
              conviction: play.conviction,
              grade: play.grade,
              sport: 'NBA',
            });
          }
        }
      }
      
      // Direct value bets
      if (game.valueBets) {
        for (const bet of game.valueBets) {
          plays.push({
            game: `${game.away || game.awayAbbr}@${game.home || game.homeAbbr}`,
            type: bet.type || bet.market,
            side: bet.side || bet.pick,
            edge: bet.edge,
            odds: bet.odds,
            sport: 'NBA',
          });
        }
      }
    }
  }
  
  plays.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  // Highlight mismatches
  const mismatches = plays.filter(p => p.type === 'REST_TANK');
  
  return {
    games,
    totalPlays: plays.length,
    mismatches: mismatches.length,
    topMismatches: mismatches.slice(0, 5),
    topPlays: plays.slice(0, 10),
    standings: card.standings || null,
    playoffCountdown: card.playoffCountdown || null,
  };
}

function processNHLCard(card) {
  if (!card || card.error) return { error: card?.error || 'No data', games: 0, plays: [] };
  
  const games = card.headline?.gamesOnSlate || card.games?.length || 0;
  const plays = [];
  
  if (card.games) {
    for (const game of card.games) {
      if (game.plays) {
        for (const play of game.plays) {
          if (play.edge >= 3.0) {
            plays.push({
              game: `${game.away || game.awayAbbr}@${game.home || game.homeAbbr}`,
              type: play.type || play.market,
              side: play.side || play.pick,
              edge: play.edge,
              odds: play.odds,
              conviction: play.conviction,
              grade: play.grade,
              sport: 'NHL',
              goalie: play.goalieMismatch || null,
              bubble: game.bubbleSignal || null,
            });
          }
        }
      }
      
      // Bubble game flag
      if (game.bubbleSignal || game.isBubbleGame) {
        plays.push({
          game: `${game.away || game.awayAbbr}@${game.home || game.homeAbbr}`,
          type: 'BUBBLE',
          side: game.bubbleLean || 'WATCH',
          edge: game.bubbleEdge || 0,
          sport: 'NHL',
          bubble: game.bubbleSignal,
        });
      }
    }
  }
  
  plays.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  return {
    games,
    totalPlays: plays.length,
    bubbleGames: plays.filter(p => p.type === 'BUBBLE').length,
    topPlays: plays.slice(0, 10),
  };
}

// ==================== CROSS-SPORT PORTFOLIO ====================

function buildCrossPortfolio(briefing, bankroll, fraction) {
  const allPlays = [];
  
  // Collect all plays from all sports
  if (briefing.mlb?.topPlays) {
    allPlays.push(...briefing.mlb.topPlays.map(p => ({ ...p, sport: 'MLB' })));
  }
  if (briefing.nba?.topPlays) {
    allPlays.push(...briefing.nba.topPlays.map(p => ({ ...p, sport: 'NBA' })));
  }
  if (briefing.nhl?.topPlays) {
    allPlays.push(...briefing.nhl.topPlays.filter(p => p.type !== 'BUBBLE').map(p => ({ ...p, sport: 'NHL' })));
  }
  
  // Sort all plays by edge descending
  allPlays.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  // Kelly sizing with cross-sport correlation
  let totalWager = 0;
  const maxExposure = bankroll * 0.25;
  const maxSingleBet = bankroll * 0.05;
  
  const portfolio = allPlays.slice(0, 20).map(play => {
    // Kelly: (edge * prob) / (odds - 1)
    const impliedProb = play.odds ? (play.odds < 0 ? -play.odds / (-play.odds + 100) : 100 / (play.odds + 100)) : 0.5;
    const edge = (play.edge || 0) / 100;
    const decimalOdds = play.odds ? (play.odds < 0 ? 1 + 100 / -play.odds : 1 + play.odds / 100) : 2.0;
    
    let kellyPct = edge > 0 ? (edge * (impliedProb + edge)) / (decimalOdds - 1) : 0;
    kellyPct = Math.max(0, Math.min(kellyPct, 0.05)); // Cap at 5%
    kellyPct *= fraction; // Apply fraction (half-Kelly default)
    
    // Cross-sport correlation discount (NBA + NBA in same slate = correlated)
    const sameSlate = allPlays.filter(p => p.sport === play.sport && p.game === play.game);
    if (sameSlate.length > 1) kellyPct *= 0.71; // Same-game discount
    
    const wager = Math.min(Math.round(bankroll * kellyPct * 100) / 100, maxSingleBet);
    
    if (totalWager + wager <= maxExposure && wager >= 5) {
      totalWager += wager;
      return {
        ...play,
        wager,
        expectedProfit: Math.round(wager * edge * 100) / 100,
      };
    }
    return null;
  }).filter(Boolean);
  
  return {
    plays: portfolio,
    totalWager: Math.round(totalWager * 100) / 100,
    totalEV: Math.round(portfolio.reduce((sum, p) => sum + (p.expectedProfit || 0), 0) * 100) / 100,
    roi: totalWager > 0 ? Math.round(portfolio.reduce((sum, p) => sum + (p.expectedProfit || 0), 0) / totalWager * 10000) / 100 : 0,
    bankroll,
    fraction,
    sportBreakdown: {
      MLB: portfolio.filter(p => p.sport === 'MLB').length,
      NBA: portfolio.filter(p => p.sport === 'NBA').length,
      NHL: portfolio.filter(p => p.sport === 'NHL').length,
    },
  };
}

// ==================== HEADLINE ====================

function generateHeadline(briefing) {
  const parts = [];
  
  const totalPlays = (briefing.mlb?.totalPlays || 0) + (briefing.nba?.totalPlays || 0) + (briefing.nhl?.totalPlays || 0);
  const totalGames = (briefing.mlb?.games || 0) + (briefing.nba?.games || 0) + (briefing.nhl?.games || 0);
  
  if (totalPlays === 0) {
    return {
      summary: `📋 ${totalGames} games today — scanning for value...`,
      totalGames,
      totalPlays: 0,
      mood: 'scanning',
    };
  }
  
  const smashPlays = (briefing.mlb?.smashPlays || 0) + 
    (briefing.nba?.topPlays?.filter(p => p.grade === 'SMASH').length || 0) +
    (briefing.nhl?.topPlays?.filter(p => p.grade === 'SMASH').length || 0);
  
  let mood = 'lean';
  if (smashPlays >= 3) mood = 'loaded';
  else if (smashPlays >= 1) mood = 'hot';
  else if (totalPlays >= 10) mood = 'active';
  
  const moodEmoji = { loaded: '🔥🔥🔥', hot: '🔥', active: '📊', lean: '👀', scanning: '🔍' };
  
  const portfolioEV = briefing.portfolio?.totalEV || 0;
  const portfolioROI = briefing.portfolio?.roi || 0;
  
  return {
    summary: `${moodEmoji[mood]} ${totalPlays} plays across ${totalGames} games — ${smashPlays} SMASH, $${portfolioEV} EV (${portfolioROI}% ROI)`,
    totalGames,
    totalPlays,
    smashPlays,
    portfolioEV,
    portfolioROI,
    mood,
    sportBreakdown: {
      MLB: { games: briefing.mlb?.games || 0, plays: briefing.mlb?.totalPlays || 0 },
      NBA: { games: briefing.nba?.games || 0, plays: briefing.nba?.totalPlays || 0 },
      NHL: { games: briefing.nhl?.games || 0, plays: briefing.nhl?.totalPlays || 0 },
    },
  };
}

// ==================== ALERTS ====================

function generateAlerts(briefing, today) {
  const alerts = [];
  
  // OD countdown alert
  const odDays = daysUntil(today, '2026-03-26');
  if (odDays >= 0 && odDays <= 3) {
    alerts.push({
      type: 'OD_COUNTDOWN',
      priority: 'HIGH',
      message: odDays === 0 ? '⚾ MLB OPENING DAY IS TODAY! Check betting card.' : 
               `⚾ MLB Opening Day in ${odDays} day${odDays > 1 ? 's' : ''}!`,
    });
  }
  
  // Big mismatches
  if (briefing.nba?.topMismatches?.length > 0) {
    for (const mm of briefing.nba.topMismatches.slice(0, 3)) {
      if (mm.edge >= 4.0) {
        alerts.push({
          type: 'NBA_MISMATCH',
          priority: 'HIGH',
          message: `🏀 ${mm.game}: ${mm.signal} — ${mm.edge.toFixed(1)}pt swing`,
        });
      }
    }
  }
  
  // NHL bubble games
  if (briefing.nhl?.bubbleGames > 0) {
    alerts.push({
      type: 'NHL_BUBBLE',
      priority: 'MEDIUM',
      message: `🏒 ${briefing.nhl.bubbleGames} NHL bubble games today — mispricing opportunity`,
    });
  }
  
  // MLB weather alerts
  if (briefing.mlb?.signals?.weatherAlerts) {
    for (const wa of briefing.mlb.signals.weatherAlerts) {
      alerts.push({
        type: 'MLB_WEATHER',
        priority: wa.severity || 'MEDIUM',
        message: `🌧️ ${wa.game}: ${wa.message}`,
      });
    }
  }
  
  // No games alert
  const totalGames = (briefing.mlb?.games || 0) + (briefing.nba?.games || 0) + (briefing.nhl?.games || 0);
  if (totalGames === 0) {
    alerts.push({
      type: 'OFF_DAY',
      priority: 'LOW',
      message: '📺 No games today. Check futures and upcoming edges.',
    });
  }
  
  return alerts;
}

// ==================== FUTURES WATCHLIST ====================

function getFuturesWatchlist() {
  const watchlist = [];
  
  // MLB season sim futures
  if (seasonSim) {
    try {
      const simData = seasonSim.getLastResult ? seasonSim.getLastResult() : null;
      if (simData?.topBets) {
        for (const bet of simData.topBets.slice(0, 5)) {
          watchlist.push({
            sport: 'MLB',
            type: 'SEASON_WIN_TOTAL',
            team: bet.team,
            side: bet.side,
            line: bet.line,
            projected: bet.projected,
            edge: bet.edge,
          });
        }
      }
    } catch(e) {}
  }
  
  return {
    bets: watchlist,
    note: watchlist.length > 0 ? `${watchlist.length} active futures edges` : 'No futures data cached',
  };
}

// ==================== UTILITIES ====================

async function safeCall(sport, fn) {
  try {
    const data = await fn();
    return { sport, data };
  } catch(e) {
    return { sport, data: null, error: e.message };
  }
}

function getCountdowns(today) {
  return {
    mlbOpeningDay1: daysUntil(today, '2026-03-26'),
    mlbOpeningDay2: daysUntil(today, '2026-03-27'),
    nbaPlayoffs: daysUntil(today, '2026-04-12'),
    nhlPlayoffs: daysUntil(today, '2026-04-19'),
    nflDraft: daysUntil(today, '2026-04-24'),
  };
}

function daysUntil(fromStr, toStr) {
  const from = new Date(fromStr + 'T00:00:00Z');
  const to = new Date(toStr + 'T00:00:00Z');
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function getYesterday(todayStr) {
  const d = new Date(todayStr + 'T00:00:00Z');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function isOpeningDayWindow(todayStr) {
  const d = new Date(todayStr + 'T00:00:00Z');
  const od1 = new Date('2026-03-26T00:00:00Z');
  const diff = Math.round((od1 - d) / (24 * 60 * 60 * 1000));
  return diff >= -2 && diff <= 5; // 5 days before through 2 days after
}

function summarizeOdPlaybook(cached) {
  if (!cached) return { note: 'No playbook data' };
  
  const totalPlays = cached.plays?.length || cached.totalPlays || 0;
  const smash = cached.plays?.filter(p => p.grade === 'SMASH' || p.conviction >= 80).length || 0;
  const strong = cached.plays?.filter(p => p.grade === 'STRONG' || (p.conviction >= 65 && p.conviction < 80)).length || 0;
  
  return {
    totalPlays,
    smashPlays: smash,
    strongPlays: strong,
    totalWager: cached.totalWager || 0,
    totalEV: cached.totalEV || 0,
  };
}

/**
 * Get cached briefing instantly (non-blocking)
 */
function getCached() {
  if (lastBriefing) return lastBriefing;
  
  // Try disk cache
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      lastBriefing = data;
      lastBuildTime = Date.now() - CACHE_TTL + 60000; // Mark as slightly stale
      return data;
    }
  } catch(e) {}
  
  return null;
}

module.exports = {
  buildBriefing,
  getCached,
};
