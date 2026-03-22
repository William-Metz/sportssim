/**
 * Opening Day Live Tracker — SportsSim v66.0
 * =============================================
 * Real-time monitoring for Opening Day (and any game day).
 * Auto-captures pre-game picks, tracks live scores, grades bets, calculates P&L.
 * 
 * THE MONEY SERVICE: This turns predictions into tracked, graded, profitable bets.
 * 
 * Flow:
 *   1. Pre-game: Auto-generate picks from asyncPredict + value detection
 *   2. Lock-in: Capture closing odds at game time
 *   3. Live: Monitor scores via ESPN
 *   4. F5 Check: Grade F5 bets at 5th inning mark
 *   5. Final: Grade all bets, calculate CLV, compute session P&L
 * 
 * Features:
 *   - Multi-game simultaneous tracking
 *   - Moneyline, totals, F5, and run line bet tracking
 *   - Conviction-weighted Kelly bet sizing
 *   - Live ESPN score integration
 *   - F5 (First 5 Innings) separate grading
 *   - Closing Line Value (CLV) calculation
 *   - Session P&L with unit-based tracking
 *   - Historical session storage for backtesting our live picks
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Data files
const SESSION_FILE = path.join(__dirname, 'od-live-sessions.json');
const ACTIVE_SESSION_FILE = path.join(__dirname, 'od-live-active.json');

// ESPN Live Scores
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';

// ==================== ESPN LIVE SCORES ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SportsSim/2.0' }, timeout: 10000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Fetch live MLB scores from ESPN
 * @param {string} dateStr - YYYYMMDD format
 */
async function fetchLiveScores(dateStr = null) {
  if (!dateStr) {
    const now = new Date();
    dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  }
  
  try {
    const url = `${ESPN_SCOREBOARD}?dates=${dateStr}`;
    const data = await fetchJSON(url);
    if (!data.events) return [];
    
    return data.events.map(event => {
      const comp = event.competitions?.[0];
      if (!comp) return null;
      
      const status = comp.status || {};
      const statusType = status.type?.name || 'STATUS_SCHEDULED';
      const inning = status.period || 0;
      const inningHalf = status.type?.detail || '';
      
      const competitors = comp.competitors || [];
      const away = competitors.find(c => c.homeAway === 'away');
      const home = competitors.find(c => c.homeAway === 'home');
      
      if (!away || !home) return null;
      
      // Extract linescore for F5 tracking
      const awayLinescores = away.linescores || [];
      const homeLinescores = home.linescores || [];
      
      // F5 score = sum of first 5 innings
      let awayF5 = 0, homeF5 = 0;
      for (let i = 0; i < Math.min(5, awayLinescores.length); i++) {
        awayF5 += (awayLinescores[i]?.value || 0);
      }
      for (let i = 0; i < Math.min(5, homeLinescores.length); i++) {
        homeF5 += (homeLinescores[i]?.value || 0);
      }
      
      const awayAbbr = away.team?.abbreviation || '???';
      const homeAbbr = home.team?.abbreviation || '???';
      
      return {
        id: event.id,
        away: awayAbbr,
        home: homeAbbr,
        awayName: away.team?.displayName || awayAbbr,
        homeName: home.team?.displayName || homeAbbr,
        awayScore: parseInt(away.score) || 0,
        homeScore: parseInt(home.score) || 0,
        awayF5: awayF5,
        homeF5: homeF5,
        totalF5: awayF5 + homeF5,
        totalFull: (parseInt(away.score) || 0) + (parseInt(home.score) || 0),
        inning: inning,
        inningDetail: inningHalf,
        status: statusType,
        isLive: statusType === 'STATUS_IN_PROGRESS',
        isFinal: statusType === 'STATUS_FINAL',
        isScheduled: statusType === 'STATUS_SCHEDULED',
        isPastF5: inning >= 5 || statusType === 'STATUS_FINAL',
        startTime: event.date,
        linescores: {
          away: awayLinescores.map(l => l?.value || 0),
          home: homeLinescores.map(l => l?.value || 0),
        },
      };
    }).filter(Boolean);
  } catch (e) {
    console.error('[OD-Live] ESPN fetch error:', e.message);
    return [];
  }
}

// ==================== BET TYPES ====================

const BET_TYPES = {
  ML: 'moneyline',
  TOTAL_OVER: 'total_over',
  TOTAL_UNDER: 'total_under',
  F5_ML: 'f5_moneyline',
  F5_OVER: 'f5_over',
  F5_UNDER: 'f5_under',
  RL: 'run_line',
  TEAM_TOTAL_OVER: 'team_total_over',
  TEAM_TOTAL_UNDER: 'team_total_under',
};

// ==================== SESSION MANAGEMENT ====================

function loadActiveSession() {
  try {
    if (fs.existsSync(ACTIVE_SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVE_SESSION_FILE, 'utf8'));
    }
  } catch (e) { /* corrupt */ }
  return null;
}

function saveActiveSession(session) {
  try {
    fs.writeFileSync(ACTIVE_SESSION_FILE, JSON.stringify(session, null, 2));
  } catch (e) { console.error('[OD-Live] Save error:', e.message); }
}

function loadSessionHistory() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch (e) { /* corrupt */ }
  return [];
}

function saveSessionHistory(sessions) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
  } catch (e) { console.error('[OD-Live] History save error:', e.message); }
}

/**
 * Create a new tracking session for a game day.
 * @param {string} date - YYYY-MM-DD
 * @param {string} name - Session name (e.g., "Opening Day 2026")
 * @param {number} bankroll - Starting bankroll in units
 */
function createSession(date, name = null, bankroll = 1000) {
  const session = {
    id: `session_${date}_${Date.now()}`,
    date: date,
    name: name || `Game Day ${date}`,
    bankroll: bankroll,
    unitSize: bankroll * 0.01, // 1% of bankroll per unit
    createdAt: new Date().toISOString(),
    status: 'active', // active | paused | completed
    picks: [],
    liveScores: {},
    grading: {
      totalPicks: 0,
      graded: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      pending: 0,
      unitsWagered: 0,
      unitsWon: 0,
      unitsPnL: 0,
      roi: 0,
    },
    f5Grading: {
      totalF5Picks: 0,
      graded: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      unitsPnL: 0,
    },
    lastScoreUpdate: null,
    lastGradeUpdate: null,
  };
  
  saveActiveSession(session);
  return session;
}

// ==================== PICK GENERATION ====================

/**
 * Generate picks for all games on a date using our full model stack.
 * This is the pre-game bet capture that happens ~2 hours before first pitch.
 * 
 * @param {object} session - Active session
 * @param {Array} games - Array of game matchups [{away, home, awayPitcher, homePitcher, bookML, bookTotal}]
 * @param {object} mlbModel - MLB model module
 * @param {object} opts - Additional options
 */
async function generatePicks(session, games, mlbModel, opts = {}) {
  const minEdge = opts.minEdge || 0.02; // 2% minimum edge
  const maxBetsPerGame = opts.maxBetsPerGame || 3;
  
  const picks = [];
  
  for (const game of games) {
    const gamePicks = [];
    const away = game.away;
    const home = game.home;
    const matchupKey = `${away}@${home}`;
    
    try {
      // Get full async prediction with all signals
      let prediction;
      if (mlbModel && mlbModel.asyncPredict) {
        prediction = await mlbModel.asyncPredict(away, home, {
          awayPitcher: game.awayPitcher,
          homePitcher: game.homePitcher,
          ...opts,
        });
      } else if (mlbModel && mlbModel.predict) {
        prediction = mlbModel.predict(away, home, {
          awayPitcher: game.awayPitcher,
          homePitcher: game.homePitcher,
        });
      }
      
      if (!prediction || prediction.error) continue;
      
      const homeProb = prediction.homeWinProb || 0.5;
      const awayProb = 1 - homeProb;
      const totalRuns = prediction.expectedTotal || prediction.total || 8.5;
      
      // === MONEYLINE PICKS ===
      if (game.homeML && game.awayML) {
        const bookHomeProb = mlToProb(game.homeML);
        const bookAwayProb = mlToProb(game.awayML);
        
        const homeEdge = homeProb - bookHomeProb;
        const awayEdge = awayProb - bookAwayProb;
        
        if (homeEdge > minEdge) {
          const units = kellyUnits(homeProb, game.homeML, session.bankroll);
          gamePicks.push({
            type: BET_TYPES.ML,
            matchup: matchupKey,
            away, home,
            pick: home,
            side: 'home',
            modelProb: +homeProb.toFixed(4),
            bookProb: +bookHomeProb.toFixed(4),
            edge: +(homeEdge * 100).toFixed(1),
            odds: game.homeML,
            units: units,
            wager: +(units * session.unitSize).toFixed(2),
            conviction: prediction.conviction?.score || null,
            convictionGrade: prediction.conviction?.grade || null,
            signals: extractSignals(prediction),
          });
        }
        
        if (awayEdge > minEdge) {
          const units = kellyUnits(awayProb, game.awayML, session.bankroll);
          gamePicks.push({
            type: BET_TYPES.ML,
            matchup: matchupKey,
            away, home,
            pick: away,
            side: 'away',
            modelProb: +awayProb.toFixed(4),
            bookProb: +bookAwayProb.toFixed(4),
            edge: +(awayEdge * 100).toFixed(1),
            odds: game.awayML,
            units: units,
            wager: +(units * session.unitSize).toFixed(2),
            conviction: prediction.conviction?.score || null,
            convictionGrade: prediction.conviction?.grade || null,
            signals: extractSignals(prediction),
          });
        }
      }
      
      // === TOTALS PICKS ===
      if (game.bookTotal) {
        const bookLine = parseFloat(game.bookTotal);
        // Use Poisson/NB to calculate over/under probabilities
        const overProb = prediction.overProb || calculateOverProb(totalRuns, bookLine);
        const underProb = 1 - overProb;
        
        // Standard -110 juice on totals
        const bookOverProb = mlToProb(game.overOdds || -110);
        const bookUnderProb = mlToProb(game.underOdds || -110);
        
        const overEdge = overProb - bookOverProb;
        const underEdge = underProb - bookUnderProb;
        
        if (overEdge > minEdge) {
          gamePicks.push({
            type: BET_TYPES.TOTAL_OVER,
            matchup: matchupKey,
            away, home,
            pick: `OVER ${bookLine}`,
            line: bookLine,
            modelTotal: +totalRuns.toFixed(1),
            modelProb: +overProb.toFixed(4),
            bookProb: +bookOverProb.toFixed(4),
            edge: +(overEdge * 100).toFixed(1),
            odds: game.overOdds || -110,
            units: kellyUnits(overProb, game.overOdds || -110, session.bankroll),
            wager: 0, // calculated after
            signals: extractSignals(prediction),
          });
          gamePicks[gamePicks.length - 1].wager = +(gamePicks[gamePicks.length - 1].units * session.unitSize).toFixed(2);
        }
        
        if (underEdge > minEdge) {
          gamePicks.push({
            type: BET_TYPES.TOTAL_UNDER,
            matchup: matchupKey,
            away, home,
            pick: `UNDER ${bookLine}`,
            line: bookLine,
            modelTotal: +totalRuns.toFixed(1),
            modelProb: +underProb.toFixed(4),
            bookProb: +bookUnderProb.toFixed(4),
            edge: +(underEdge * 100).toFixed(1),
            odds: game.underOdds || -110,
            units: kellyUnits(underProb, game.underOdds || -110, session.bankroll),
            wager: 0,
            signals: extractSignals(prediction),
          });
          gamePicks[gamePicks.length - 1].wager = +(gamePicks[gamePicks.length - 1].units * session.unitSize).toFixed(2);
        }
      }
      
      // === F5 PICKS === (First 5 Innings)
      if (game.f5Total || prediction.f5) {
        const f5Data = prediction.f5 || {};
        const f5Total = f5Data.total || (totalRuns * 0.545);
        const f5Line = game.f5Total || Math.round(f5Total * 2) / 2;
        
        const f5OverProb = calculateOverProb(f5Total, f5Line);
        const f5UnderProb = 1 - f5OverProb;
        
        if (f5UnderProb > 0.55) { // F5 unders have historical edge early season
          gamePicks.push({
            type: BET_TYPES.F5_UNDER,
            matchup: matchupKey,
            away, home,
            pick: `F5 UNDER ${f5Line}`,
            line: f5Line,
            modelTotal: +f5Total.toFixed(1),
            modelProb: +f5UnderProb.toFixed(4),
            edge: +((f5UnderProb - 0.5) * 100).toFixed(1),
            odds: game.f5UnderOdds || -110,
            units: kellyUnits(f5UnderProb, game.f5UnderOdds || -110, session.bankroll),
            wager: 0,
            signals: ['opening_week_unders', 'ace_starter_deep'],
          });
          gamePicks[gamePicks.length - 1].wager = +(gamePicks[gamePicks.length - 1].units * session.unitSize).toFixed(2);
        }
      }
      
    } catch (e) {
      console.error(`[OD-Live] Error generating picks for ${matchupKey}:`, e.message);
    }
    
    // Limit picks per game and add to session
    const sortedPicks = gamePicks.sort((a, b) => b.edge - a.edge).slice(0, maxBetsPerGame);
    for (const pick of sortedPicks) {
      pick.id = `pick_${session.picks.length + 1}_${Date.now()}`;
      pick.status = 'pending'; // pending | won | lost | push | void
      pick.capturedAt = new Date().toISOString();
      pick.closingOdds = null;
      pick.clv = null;
      pick.result = null;
      pick.pnl = null;
      session.picks.push(pick);
    }
  }
  
  // Update session stats
  session.grading.totalPicks = session.picks.length;
  session.grading.pending = session.picks.filter(p => p.status === 'pending').length;
  session.grading.unitsWagered = session.picks.reduce((s, p) => s + p.units, 0);
  session.grading.f5TotalPicks = session.picks.filter(p => p.type.startsWith('f5_')).length;
  
  saveActiveSession(session);
  return session;
}

// ==================== LIVE SCORE UPDATES ====================

/**
 * Update live scores for the active session and auto-grade completed bets.
 */
async function updateScores(session = null) {
  if (!session) session = loadActiveSession();
  if (!session) return { error: 'No active session' };
  
  const dateStr = session.date.replace(/-/g, '');
  const scores = await fetchLiveScores(dateStr);
  
  if (!scores.length) {
    return { session, scores: [], message: 'No games found for date' };
  }
  
  // Map scores by matchup
  const scoreMap = {};
  for (const score of scores) {
    const key = `${score.away}@${score.home}`;
    scoreMap[key] = score;
    session.liveScores[key] = {
      ...score,
      updatedAt: new Date().toISOString(),
    };
  }
  
  // Auto-grade completed bets
  let newlyGraded = 0;
  for (const pick of session.picks) {
    if (pick.status !== 'pending') continue;
    
    const score = scoreMap[pick.matchup];
    if (!score) continue;
    
    // Grade F5 bets when past 5th inning
    if (pick.type.startsWith('f5_') && score.isPastF5) {
      const gradeResult = gradeF5Pick(pick, score);
      if (gradeResult) {
        Object.assign(pick, gradeResult);
        newlyGraded++;
      }
    }
    
    // Grade full-game bets when final
    if (!pick.type.startsWith('f5_') && score.isFinal) {
      const gradeResult = gradeFullGamePick(pick, score);
      if (gradeResult) {
        Object.assign(pick, gradeResult);
        newlyGraded++;
      }
    }
  }
  
  // Recalculate session stats
  recalculateStats(session);
  
  session.lastScoreUpdate = new Date().toISOString();
  saveActiveSession(session);
  
  return {
    session,
    scores,
    newlyGraded,
    summary: getSessionSummary(session),
  };
}

// ==================== GRADING ====================

function gradeFullGamePick(pick, score) {
  const result = {};
  
  switch (pick.type) {
    case BET_TYPES.ML: {
      const homeWon = score.homeScore > score.awayScore;
      const awayWon = score.awayScore > score.homeScore;
      
      if (pick.side === 'home') {
        result.status = homeWon ? 'won' : (awayWon ? 'lost' : 'push');
      } else {
        result.status = awayWon ? 'won' : (homeWon ? 'lost' : 'push');
      }
      break;
    }
    
    case BET_TYPES.TOTAL_OVER: {
      const total = score.totalFull;
      if (total > pick.line) result.status = 'won';
      else if (total < pick.line) result.status = 'lost';
      else result.status = 'push';
      break;
    }
    
    case BET_TYPES.TOTAL_UNDER: {
      const total = score.totalFull;
      if (total < pick.line) result.status = 'won';
      else if (total > pick.line) result.status = 'lost';
      else result.status = 'push';
      break;
    }
    
    case BET_TYPES.RL: {
      // Run line — pick.line is the spread (e.g., -1.5 for favorite)
      const margin = pick.side === 'home' 
        ? score.homeScore - score.awayScore 
        : score.awayScore - score.homeScore;
      if (margin + pick.line > 0) result.status = 'won';
      else if (margin + pick.line < 0) result.status = 'lost';
      else result.status = 'push';
      break;
    }
    
    default:
      return null;
  }
  
  // Calculate P&L
  result.pnl = calculatePnL(pick.units, pick.odds, result.status);
  result.result = {
    awayScore: score.awayScore,
    homeScore: score.homeScore,
    totalRuns: score.totalFull,
  };
  result.gradedAt = new Date().toISOString();
  
  return result;
}

function gradeF5Pick(pick, score) {
  const result = {};
  
  switch (pick.type) {
    case BET_TYPES.F5_ML: {
      if (score.awayF5 > score.homeF5) {
        result.status = pick.side === 'away' ? 'won' : 'lost';
      } else if (score.homeF5 > score.awayF5) {
        result.status = pick.side === 'home' ? 'won' : 'lost';
      } else {
        result.status = 'push'; // F5 can tie = push on 2-way ML
      }
      break;
    }
    
    case BET_TYPES.F5_OVER: {
      if (score.totalF5 > pick.line) result.status = 'won';
      else if (score.totalF5 < pick.line) result.status = 'lost';
      else result.status = 'push';
      break;
    }
    
    case BET_TYPES.F5_UNDER: {
      if (score.totalF5 < pick.line) result.status = 'won';
      else if (score.totalF5 > pick.line) result.status = 'lost';
      else result.status = 'push';
      break;
    }
    
    default:
      return null;
  }
  
  result.pnl = calculatePnL(pick.units, pick.odds, result.status);
  result.result = {
    awayF5: score.awayF5,
    homeF5: score.homeF5,
    totalF5: score.totalF5,
  };
  result.gradedAt = new Date().toISOString();
  
  return result;
}

// ==================== P&L CALCULATION ====================

function calculatePnL(units, odds, status) {
  if (status === 'push' || status === 'void') return 0;
  if (status === 'lost') return -units;
  if (status === 'won') {
    // Convert American odds to decimal payout
    if (odds > 0) return units * (odds / 100);
    else return units * (100 / (-odds));
  }
  return 0;
}

function kellyUnits(prob, odds, bankroll = 1000) {
  // Quarter Kelly sizing for safety
  const decimalOdds = odds > 0 ? (odds / 100 + 1) : (100 / (-odds) + 1);
  const q = 1 - prob;
  const kelly = (prob * decimalOdds - 1) / (decimalOdds - 1);
  const quarterKelly = Math.max(0, kelly * 0.25);
  
  // Cap at 3 units max per bet
  return Math.min(3, +quarterKelly.toFixed(2));
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function calculateOverProb(expected, line) {
  // Poisson CDF approximation
  let cumulativeUnder = 0;
  for (let k = 0; k <= Math.floor(line); k++) {
    cumulativeUnder += poissonPMF(expected, k);
  }
  // Handle half lines (no push possible)
  if (line % 1 !== 0) {
    return 1 - cumulativeUnder;
  }
  // Exact line: calculate push probability
  const pushProb = poissonPMF(expected, line);
  return 1 - cumulativeUnder + pushProb * 0.5;
}

function poissonPMF(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

function logFactorial(n) {
  let result = 0;
  for (let i = 2; i <= n; i++) result += Math.log(i);
  return result;
}

// ==================== STATS / SUMMARY ====================

function recalculateStats(session) {
  const picks = session.picks;
  
  // Full game stats
  const fullPicks = picks.filter(p => !p.type.startsWith('f5_'));
  const f5Picks = picks.filter(p => p.type.startsWith('f5_'));
  
  session.grading = {
    totalPicks: picks.length,
    graded: picks.filter(p => ['won', 'lost', 'push'].includes(p.status)).length,
    wins: picks.filter(p => p.status === 'won').length,
    losses: picks.filter(p => p.status === 'lost').length,
    pushes: picks.filter(p => p.status === 'push').length,
    pending: picks.filter(p => p.status === 'pending').length,
    unitsWagered: +picks.reduce((s, p) => s + p.units, 0).toFixed(2),
    unitsWon: +picks.filter(p => p.pnl).reduce((s, p) => s + (p.pnl || 0), 0).toFixed(2),
    unitsPnL: +picks.reduce((s, p) => s + (p.pnl || 0), 0).toFixed(2),
    roi: 0,
  };
  
  const wagered = session.grading.unitsWagered;
  if (wagered > 0) {
    session.grading.roi = +((session.grading.unitsPnL / wagered) * 100).toFixed(1);
  }
  
  // F5 stats
  session.f5Grading = {
    totalF5Picks: f5Picks.length,
    graded: f5Picks.filter(p => ['won', 'lost', 'push'].includes(p.status)).length,
    wins: f5Picks.filter(p => p.status === 'won').length,
    losses: f5Picks.filter(p => p.status === 'lost').length,
    pushes: f5Picks.filter(p => p.status === 'push').length,
    unitsPnL: +f5Picks.reduce((s, p) => s + (p.pnl || 0), 0).toFixed(2),
  };
}

function getSessionSummary(session) {
  const g = session.grading;
  const dollarPnL = +(g.unitsPnL * session.unitSize).toFixed(2);
  
  return {
    name: session.name,
    date: session.date,
    status: session.status,
    totalPicks: g.totalPicks,
    record: `${g.wins}-${g.losses}${g.pushes ? `-${g.pushes}P` : ''}`,
    pending: g.pending,
    unitsWagered: g.unitsWagered,
    unitsPnL: g.unitsPnL,
    dollarPnL: dollarPnL,
    roi: g.roi,
    winRate: g.graded > 0 ? +((g.wins / (g.wins + g.losses)) * 100).toFixed(1) : null,
    f5Record: `${session.f5Grading.wins}-${session.f5Grading.losses}${session.f5Grading.pushes ? `-${session.f5Grading.pushes}P` : ''}`,
    f5PnL: session.f5Grading.unitsPnL,
    lastUpdate: session.lastScoreUpdate,
    // Live game status
    gamesLive: Object.values(session.liveScores).filter(s => s.isLive).length,
    gamesFinal: Object.values(session.liveScores).filter(s => s.isFinal).length,
    gamesScheduled: Object.values(session.liveScores).filter(s => s.isScheduled).length,
  };
}

function extractSignals(prediction) {
  const signals = [];
  if (prediction.factors) {
    if (prediction.factors.weather) signals.push('weather');
    if (prediction.factors.umpire) signals.push('umpire');
    if (prediction.factors.rest) signals.push('rest_travel');
    if (prediction.factors.lineup) signals.push('real_lineup');
    if (prediction.factors.platoon) signals.push('platoon_splits');
    if (prediction.factors.framing) signals.push('catcher_framing');
    if (prediction.factors.bullpen) signals.push('bullpen_quality');
    if (prediction.factors.statcast) signals.push('statcast');
    if (prediction.factors.openingWeek) signals.push('opening_week');
    if (prediction.factors.preseason) signals.push('preseason_tuning');
  }
  if (prediction._asyncSignals) {
    for (const sig of prediction._asyncSignals) {
      if (!signals.includes(sig)) signals.push(sig);
    }
  }
  return signals;
}

// ==================== CLOSING LINE VALUE (CLV) ====================

/**
 * Capture closing odds and calculate CLV for all picks.
 * Should be called right before game start (ideally < 5 min before first pitch).
 */
function captureClosingOdds(session, closingLines) {
  // closingLines format: { "ATL@CHW": { homeML: -150, awayML: 130, total: 8.5, overOdds: -110, underOdds: -110 }, ... }
  
  for (const pick of session.picks) {
    const closing = closingLines[pick.matchup];
    if (!closing) continue;
    
    let closingProb;
    if (pick.type === BET_TYPES.ML) {
      const ml = pick.side === 'home' ? closing.homeML : closing.awayML;
      closingProb = mlToProb(ml);
      pick.closingOdds = ml;
    } else if (pick.type === BET_TYPES.TOTAL_OVER) {
      closingProb = mlToProb(closing.overOdds || -110);
      pick.closingOdds = closing.overOdds || -110;
    } else if (pick.type === BET_TYPES.TOTAL_UNDER) {
      closingProb = mlToProb(closing.underOdds || -110);
      pick.closingOdds = closing.underOdds || -110;
    }
    
    if (closingProb && pick.bookProb) {
      // CLV = closing probability - opening probability we bet at
      // Positive CLV = we got a better price than the market settled at = SHARP
      pick.clv = +((closingProb - pick.bookProb) * 100).toFixed(1);
    }
  }
  
  saveActiveSession(session);
  return session;
}

// ==================== AUTO-MONITORING ====================

let monitorInterval = null;

/**
 * Start auto-monitoring — polls ESPN every 2 minutes during games.
 */
function startMonitoring(session = null) {
  if (!session) session = loadActiveSession();
  if (!session) return { error: 'No active session' };
  
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }
  
  // Poll every 2 minutes
  monitorInterval = setInterval(async () => {
    try {
      const result = await updateScores(session);
      const summary = result.summary;
      
      // Log status
      if (summary) {
        const live = summary.gamesLive;
        const final = summary.gamesFinal;
        console.log(`[OD-Live] ${summary.name} | ${summary.record} | PnL: ${summary.unitsPnL > 0 ? '+' : ''}${summary.unitsPnL}u ($${summary.dollarPnL}) | Live: ${live} | Final: ${final} | Pending: ${summary.pending}`);
      }
      
      // Auto-complete session when all games are final and all picks graded
      if (summary && summary.pending === 0 && summary.gamesLive === 0 && summary.gamesScheduled === 0 && summary.gamesFinal > 0) {
        session.status = 'completed';
        saveActiveSession(session);
        
        // Archive to history
        const history = loadSessionHistory();
        history.push(session);
        saveSessionHistory(history);
        
        console.log(`[OD-Live] Session COMPLETED: ${summary.name} | Final: ${summary.record} | PnL: ${summary.unitsPnL > 0 ? '+' : ''}${summary.unitsPnL}u ($${summary.dollarPnL}) | ROI: ${summary.roi}%`);
        
        stopMonitoring();
      }
    } catch (e) {
      console.error('[OD-Live] Monitor error:', e.message);
    }
  }, 120000); // 2 minutes
  
  console.log('[OD-Live] Monitoring started — polling every 2 min');
  return { status: 'monitoring', session: getSessionSummary(session) };
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[OD-Live] Monitoring stopped');
  }
  return { status: 'stopped' };
}

// ==================== GAME DAY AUTO-SETUP ====================

/**
 * Auto-setup for Opening Day or any game day.
 * Creates session, fetches schedule, generates picks from our models.
 * Call this ~2 hours before first pitch.
 * 
 * @param {string} date - YYYY-MM-DD
 * @param {object} mlbModel - MLB model module
 * @param {Function} getOdds - Function to get current odds
 */
async function autoSetup(date, mlbModel, getOdds = null) {
  // Create session
  const session = createSession(date, `Game Day ${date}`, 1000);
  
  // Get today's schedule from ESPN
  const dateStr = date.replace(/-/g, '');
  const scores = await fetchLiveScores(dateStr);
  
  if (!scores.length) {
    return { error: 'No games found for date', session };
  }
  
  // Build game objects with odds
  const games = [];
  for (const score of scores) {
    const game = {
      away: score.away,
      home: score.home,
      awayPitcher: null, // Will be filled by asyncPredict
      homePitcher: null,
      homeML: null,
      awayML: null,
      bookTotal: null,
      overOdds: -110,
      underOdds: -110,
    };
    
    // Try to get odds from our odds service
    if (getOdds) {
      try {
        const odds = await getOdds(score.away, score.home, 'mlb');
        if (odds) {
          game.homeML = odds.homeML;
          game.awayML = odds.awayML;
          game.bookTotal = odds.total;
          game.overOdds = odds.overOdds || -110;
          game.underOdds = odds.underOdds || -110;
        }
      } catch (e) { /* no odds available yet */ }
    }
    
    games.push(game);
  }
  
  // Generate picks
  await generatePicks(session, games, mlbModel);
  
  return {
    session: getSessionSummary(session),
    gamesFound: scores.length,
    picksGenerated: session.picks.length,
    picks: session.picks.map(p => ({
      id: p.id,
      type: p.type,
      matchup: p.matchup,
      pick: p.pick,
      edge: p.edge,
      odds: p.odds,
      units: p.units,
      conviction: p.convictionGrade,
      signals: p.signals?.length || 0,
    })),
  };
}

// ==================== EXPORTS ====================

module.exports = {
  // Session management
  createSession,
  loadActiveSession,
  saveActiveSession,
  loadSessionHistory,
  
  // Core operations
  generatePicks,
  updateScores,
  fetchLiveScores,
  captureClosingOdds,
  autoSetup,
  
  // Monitoring
  startMonitoring,
  stopMonitoring,
  
  // Helpers
  getSessionSummary,
  recalculateStats,
  
  // Constants
  BET_TYPES,
};
