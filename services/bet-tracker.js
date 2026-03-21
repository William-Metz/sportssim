/**
 * Bet Tracker + Auto-Grading + CLV Tracking — SportsSim v13.0
 * 
 * Full bet lifecycle management:
 *   1. Log bets (team, market, odds, stake, model edge at entry)
 *   2. Auto-grade from live scores via ESPN API
 *   3. Track CLV (Closing Line Value) — the holy grail metric
 *   4. P&L dashboard with ROI by sport, market, edge tier, time period
 *   5. Streak tracking, bankroll curve, unit sizing analysis
 * 
 * Storage: JSON file (lightweight, no SQLite dependency)
 * CLV = comparing your entry odds to closing odds = proof of real edge
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'bet-tracker-data.json');
const CACHE_FILE = path.join(__dirname, 'scores-cache.json');

// ==================== DATA STORAGE ====================

let betData = {
  bets: [],           // All bet records
  bankroll: 1000,     // Starting bankroll
  nextId: 1,
  created: new Date().toISOString(),
  version: '1.0'
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      betData = { ...betData, ...raw };
      return true;
    }
  } catch (e) { console.error('[bet-tracker] Load error:', e.message); }
  return false;
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(betData, null, 2));
  } catch (e) { console.error('[bet-tracker] Save error:', e.message); }
}

// ==================== BET MANAGEMENT ====================

/**
 * Log a new bet
 * @param {Object} bet - Bet details
 * @param {string} bet.sport - 'nba', 'mlb', 'nhl'
 * @param {string} bet.pick - e.g. 'LAD ML', 'NYY -1.5', 'Over 8.5'
 * @param {string} bet.market - 'moneyline', 'spread', 'total', 'runline', 'prop', 'futures'
 * @param {number} bet.odds - American odds at entry (e.g. -150, +130)
 * @param {number} bet.stake - Dollar amount wagered
 * @param {number} [bet.units] - Unit size (defaults to stake/bankroll*100)
 * @param {number} [bet.modelProb] - Model's win probability at time of bet
 * @param {number} [bet.modelEdge] - Model's edge at time of bet
 * @param {string} [bet.game] - Game description (e.g. "NYY @ BOS")
 * @param {string} [bet.gameDate] - Game date ISO string
 * @param {string} [bet.book] - Sportsbook name
 * @param {string} [bet.notes] - Free-form notes
 * @param {string} [bet.source] - 'manual', 'model-auto', 'kalshi', 'polymarket'
 * @param {Object} [bet.closingOdds] - Closing line odds (for CLV calc)
 */
function addBet(bet) {
  const id = betData.nextId++;
  
  const record = {
    id,
    sport: (bet.sport || 'unknown').toLowerCase(),
    pick: bet.pick || 'Unknown',
    market: (bet.market || 'moneyline').toLowerCase(),
    odds: Number(bet.odds) || 0,
    stake: Number(bet.stake) || 0,
    units: bet.units || +(((Number(bet.stake) || 0) / betData.bankroll) * 100).toFixed(2),
    modelProb: bet.modelProb ? +Number(bet.modelProb).toFixed(3) : null,
    modelEdge: bet.modelEdge ? +Number(bet.modelEdge).toFixed(3) : null,
    game: bet.game || null,
    gameDate: bet.gameDate || new Date().toISOString().split('T')[0],
    book: bet.book || null,
    notes: bet.notes || null,
    source: bet.source || 'manual',
    
    // Grading
    result: null,       // 'win', 'loss', 'push', 'void'
    payout: null,       // Dollar payout (0 for loss, stake for push, stake+profit for win)
    profit: null,       // Net profit/loss in dollars
    gradedAt: null,
    
    // CLV tracking
    closingOdds: bet.closingOdds || null,
    clv: null,          // Closing Line Value in cents
    clvPercent: null,   // CLV as percentage
    
    // Meta
    createdAt: new Date().toISOString(),
    confidence: bet.confidence || null,  // 'HIGH', 'MEDIUM', 'LOW'
    tags: bet.tags || [],
  };
  
  betData.bets.push(record);
  saveData();
  
  return record;
}

/**
 * Grade a bet manually
 */
function gradeBet(betId, result, opts = {}) {
  const bet = betData.bets.find(b => b.id === betId);
  if (!bet) return { error: `Bet #${betId} not found` };
  
  bet.result = result; // 'win', 'loss', 'push', 'void'
  
  if (result === 'win') {
    const payout = bet.odds > 0 
      ? bet.stake * (bet.odds / 100)
      : bet.stake * (100 / Math.abs(bet.odds));
    bet.payout = +(bet.stake + payout).toFixed(2);
    bet.profit = +payout.toFixed(2);
  } else if (result === 'loss') {
    bet.payout = 0;
    bet.profit = -bet.stake;
  } else if (result === 'push') {
    bet.payout = bet.stake;
    bet.profit = 0;
  } else if (result === 'void') {
    bet.payout = bet.stake;
    bet.profit = 0;
  }
  
  bet.gradedAt = new Date().toISOString();
  
  // CLV calculation if closing odds provided
  if (opts.closingOdds) {
    bet.closingOdds = opts.closingOdds;
  }
  if (bet.closingOdds) {
    bet.clv = calculateCLV(bet.odds, bet.closingOdds);
    bet.clvPercent = bet.clv ? +(bet.clv.cents / 100).toFixed(3) : null;
  }
  
  if (opts.score) bet.score = opts.score;
  if (opts.notes) bet.notes = (bet.notes ? bet.notes + ' | ' : '') + opts.notes;
  
  saveData();
  return bet;
}

/**
 * Update closing odds for a bet (for CLV tracking)
 */
function updateClosingOdds(betId, closingOdds) {
  const bet = betData.bets.find(b => b.id === betId);
  if (!bet) return { error: `Bet #${betId} not found` };
  
  bet.closingOdds = closingOdds;
  bet.clv = calculateCLV(bet.odds, closingOdds);
  bet.clvPercent = bet.clv ? +(bet.clv.cents / 100).toFixed(3) : null;
  
  saveData();
  return bet;
}

/**
 * Delete a bet
 */
function deleteBet(betId) {
  const idx = betData.bets.findIndex(b => b.id === betId);
  if (idx === -1) return { error: `Bet #${betId} not found` };
  
  const removed = betData.bets.splice(idx, 1)[0];
  saveData();
  return { deleted: removed.id, pick: removed.pick };
}

/**
 * Update bankroll
 */
function setBankroll(amount) {
  betData.bankroll = Number(amount);
  saveData();
  return { bankroll: betData.bankroll };
}

// ==================== CLV CALCULATION ====================
// CLV = the difference between your entry odds and closing odds
// Positive CLV = you beat the market = long-term profit signal

function oddsToImpliedProb(odds) {
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

function calculateCLV(entryOdds, closingOdds) {
  if (!entryOdds || !closingOdds) return null;
  
  const entryProb = oddsToImpliedProb(entryOdds);
  const closingProb = oddsToImpliedProb(closingOdds);
  
  // CLV in cents: how many cents of value per dollar bet
  // Positive = you got a better price than closing
  // For favorites (negative odds), lower absolute number = better
  // For dogs (positive odds), higher number = better
  const clvCents = +((closingProb - entryProb) * 100).toFixed(1);
  
  return {
    entryProb: +entryProb.toFixed(3),
    closingProb: +closingProb.toFixed(3),
    cents: clvCents,
    direction: clvCents > 0 ? 'positive' : clvCents < 0 ? 'negative' : 'neutral',
    interpretation: clvCents > 3 ? 'Strong +CLV — sharp bettor signal' :
                    clvCents > 1 ? 'Solid +CLV — beating the market' :
                    clvCents > 0 ? 'Slight +CLV' :
                    clvCents > -1 ? 'Slight -CLV' :
                    clvCents > -3 ? '-CLV — market moved against you' :
                    'Heavy -CLV — reconsider approach'
  };
}

// ==================== AUTO-GRADING ====================

/**
 * Fetch final scores from ESPN for a given date
 */
async function fetchScores(sport, date) {
  try {
    const fetch = require('node-fetch');
    const sportPath = sport === 'nba' ? 'basketball/nba' :
                      sport === 'mlb' ? 'baseball/mlb' :
                      sport === 'nhl' ? 'hockey/nhl' : null;
    if (!sportPath) return [];
    
    const dateStr = date.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateStr}`;
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) return [];
    
    const data = await resp.json();
    const games = [];
    
    for (const event of (data.events || [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      
      const status = comp.status?.type?.name; // 'STATUS_FINAL', etc.
      const isFinal = status === 'STATUS_FINAL' || comp.status?.type?.completed;
      
      const teams = {};
      for (const team of (comp.competitors || [])) {
        const abbr = team.team?.abbreviation;
        const side = team.homeAway; // 'home' or 'away'
        const score = parseInt(team.score) || 0;
        const winner = team.winner;
        
        teams[side] = { abbr, score, winner };
        // Also map by team abbr for easy lookup
        if (abbr) teams[abbr] = { side, score, winner };
      }
      
      games.push({
        id: event.id,
        name: event.name || `${teams.away?.abbr} @ ${teams.home?.abbr}`,
        date: event.date,
        status,
        isFinal,
        home: teams.home,
        away: teams.away,
        teams,
        total: (teams.home?.score || 0) + (teams.away?.score || 0),
        spread: (teams.home?.score || 0) - (teams.away?.score || 0), // home perspective
      });
    }
    
    return games;
  } catch (e) {
    console.error(`[bet-tracker] Score fetch error (${sport}):`, e.message);
    return [];
  }
}

/**
 * Auto-grade all pending bets for a given date
 * Matches bets to game results and grades them
 */
async function autoGrade(date) {
  const pendingBets = betData.bets.filter(b => 
    !b.result && b.gameDate === date
  );
  
  if (pendingBets.length === 0) return { graded: 0, pending: 0, message: 'No pending bets for this date' };
  
  // Fetch scores for each sport that has pending bets
  const sports = [...new Set(pendingBets.map(b => b.sport))];
  const allGames = {};
  for (const sport of sports) {
    allGames[sport] = await fetchScores(sport, date);
  }
  
  let graded = 0;
  let skipped = 0;
  const results = [];
  
  for (const bet of pendingBets) {
    const games = allGames[bet.sport] || [];
    const matched = matchBetToGame(bet, games);
    
    if (!matched) {
      skipped++;
      results.push({ id: bet.id, pick: bet.pick, status: 'no-match', reason: 'Could not match to a final game' });
      continue;
    }
    
    if (!matched.isFinal) {
      skipped++;
      results.push({ id: bet.id, pick: bet.pick, status: 'in-progress', reason: 'Game not final yet' });
      continue;
    }
    
    const grade = gradeFromResult(bet, matched);
    if (grade) {
      gradeBet(bet.id, grade.result, { 
        score: `${matched.away.abbr} ${matched.away.score} - ${matched.home.abbr} ${matched.home.score}`,
        notes: grade.notes
      });
      graded++;
      results.push({ id: bet.id, pick: bet.pick, status: 'graded', result: grade.result, profit: bet.profit });
    } else {
      skipped++;
      results.push({ id: bet.id, pick: bet.pick, status: 'grade-error', reason: 'Could not determine result' });
    }
  }
  
  return { graded, skipped, total: pendingBets.length, results };
}

/**
 * Match a bet to a game result
 */
function matchBetToGame(bet, games) {
  // Extract team abbreviation from pick
  const pick = bet.pick.toUpperCase();
  const game = bet.game || '';
  
  // Try to find the game
  for (const g of games) {
    const homeAbbr = g.home?.abbr?.toUpperCase() || '';
    const awayAbbr = g.away?.abbr?.toUpperCase() || '';
    
    // Match by team abbr in pick or game description
    if (pick.includes(homeAbbr) || pick.includes(awayAbbr) || 
        game.toUpperCase().includes(homeAbbr) || game.toUpperCase().includes(awayAbbr)) {
      return g;
    }
    
    // Also try team name in game description
    if (g.name && (game.toLowerCase().includes(g.name.toLowerCase().split(' vs ')[0]) ||
        game.toLowerCase().includes(g.name.toLowerCase().split(' at ')[0]))) {
      return g;
    }
  }
  
  return null;
}

/**
 * Determine bet result from game data
 */
function gradeFromResult(bet, game) {
  const pick = bet.pick.toUpperCase();
  const market = bet.market;
  
  if (market === 'moneyline') {
    // Find which team was picked
    const homeAbbr = game.home?.abbr?.toUpperCase() || '';
    const awayAbbr = game.away?.abbr?.toUpperCase() || '';
    
    if (pick.includes(homeAbbr) && pick.includes('ML')) {
      return { 
        result: game.home.winner ? 'win' : 'loss',
        notes: `Final: ${awayAbbr} ${game.away.score} - ${homeAbbr} ${game.home.score}`
      };
    }
    if (pick.includes(awayAbbr) && pick.includes('ML')) {
      return {
        result: game.away.winner ? 'win' : 'loss',
        notes: `Final: ${awayAbbr} ${game.away.score} - ${homeAbbr} ${game.home.score}`
      };
    }
    // Fallback: if just team abbr (no ML suffix)
    if (pick.includes(homeAbbr)) {
      return { result: game.home.winner ? 'win' : 'loss' };
    }
    if (pick.includes(awayAbbr)) {
      return { result: game.away.winner ? 'win' : 'loss' };
    }
  }
  
  if (market === 'spread' || market === 'runline') {
    // Parse spread from pick: "NYY -1.5" or "BOS +3.5"
    const spreadMatch = pick.match(/([A-Z]{2,3})\s*([+-]?\d+\.?\d*)/);
    if (spreadMatch) {
      const team = spreadMatch[1];
      const spread = parseFloat(spreadMatch[2]);
      const homeAbbr = game.home?.abbr?.toUpperCase() || '';
      const awayAbbr = game.away?.abbr?.toUpperCase() || '';
      
      let actualMargin;
      if (team === homeAbbr) {
        actualMargin = game.home.score - game.away.score;
      } else if (team === awayAbbr) {
        actualMargin = game.away.score - game.home.score;
      } else {
        return null;
      }
      
      const adjustedMargin = actualMargin + spread;
      if (adjustedMargin > 0) return { result: 'win', notes: `Margin: ${actualMargin}, spread: ${spread}` };
      if (adjustedMargin < 0) return { result: 'loss', notes: `Margin: ${actualMargin}, spread: ${spread}` };
      return { result: 'push', notes: `Push: margin ${actualMargin} + spread ${spread} = 0` };
    }
  }
  
  if (market === 'total') {
    // Parse total: "Over 8.5" or "Under 215.5"
    const totalMatch = pick.match(/(OVER|UNDER)\s*(\d+\.?\d*)/i);
    if (totalMatch) {
      const side = totalMatch[1].toUpperCase();
      const line = parseFloat(totalMatch[2]);
      const actualTotal = game.total;
      
      if (side === 'OVER') {
        if (actualTotal > line) return { result: 'win', notes: `Total: ${actualTotal} > ${line}` };
        if (actualTotal < line) return { result: 'loss', notes: `Total: ${actualTotal} < ${line}` };
        return { result: 'push', notes: `Push: total ${actualTotal} = ${line}` };
      } else {
        if (actualTotal < line) return { result: 'win', notes: `Total: ${actualTotal} < ${line}` };
        if (actualTotal > line) return { result: 'loss', notes: `Total: ${actualTotal} > ${line}` };
        return { result: 'push', notes: `Push: total ${actualTotal} = ${line}` };
      }
    }
  }
  
  return null;
}

// ==================== ANALYTICS ====================

/**
 * Get comprehensive P&L analytics
 */
function getAnalytics(filters = {}) {
  let bets = [...betData.bets];
  
  // Apply filters
  if (filters.sport) bets = bets.filter(b => b.sport === filters.sport.toLowerCase());
  if (filters.market) bets = bets.filter(b => b.market === filters.market.toLowerCase());
  if (filters.source) bets = bets.filter(b => b.source === filters.source);
  if (filters.since) bets = bets.filter(b => b.gameDate >= filters.since);
  if (filters.until) bets = bets.filter(b => b.gameDate <= filters.until);
  if (filters.confidence) bets = bets.filter(b => b.confidence === filters.confidence);
  if (filters.result) bets = bets.filter(b => b.result === filters.result);
  if (filters.minEdge) bets = bets.filter(b => b.modelEdge && b.modelEdge >= filters.minEdge);
  
  const graded = bets.filter(b => b.result && b.result !== 'void');
  const wins = graded.filter(b => b.result === 'win');
  const losses = graded.filter(b => b.result === 'loss');
  const pushes = graded.filter(b => b.result === 'push');
  const pending = bets.filter(b => !b.result);
  
  const totalStaked = graded.reduce((s, b) => s + b.stake, 0);
  const totalProfit = graded.reduce((s, b) => s + (b.profit || 0), 0);
  const totalPending = pending.reduce((s, b) => s + b.stake, 0);
  
  // ROI
  const roi = totalStaked > 0 ? +((totalProfit / totalStaked) * 100).toFixed(2) : 0;
  
  // Win rate
  const winRate = graded.length > 0 ? +((wins.length / graded.length) * 100).toFixed(1) : 0;
  
  // Average odds
  const avgOdds = graded.length > 0 ? +(graded.reduce((s, b) => s + b.odds, 0) / graded.length).toFixed(0) : 0;
  
  // CLV analysis
  const withCLV = graded.filter(b => b.clv && b.clv.cents !== undefined);
  const avgCLV = withCLV.length > 0 
    ? +(withCLV.reduce((s, b) => s + b.clv.cents, 0) / withCLV.length).toFixed(1) 
    : null;
  const positiveCLV = withCLV.filter(b => b.clv.cents > 0).length;
  
  // Streak tracking
  const streak = calculateStreak(graded);
  
  // By sport breakdown
  const bySport = {};
  for (const sport of ['nba', 'mlb', 'nhl']) {
    const sportBets = graded.filter(b => b.sport === sport);
    if (sportBets.length === 0) continue;
    const sportWins = sportBets.filter(b => b.result === 'win');
    const sportStaked = sportBets.reduce((s, b) => s + b.stake, 0);
    const sportProfit = sportBets.reduce((s, b) => s + (b.profit || 0), 0);
    bySport[sport] = {
      bets: sportBets.length,
      wins: sportWins.length,
      losses: sportBets.filter(b => b.result === 'loss').length,
      winRate: +((sportWins.length / sportBets.length) * 100).toFixed(1),
      staked: +sportStaked.toFixed(2),
      profit: +sportProfit.toFixed(2),
      roi: sportStaked > 0 ? +((sportProfit / sportStaked) * 100).toFixed(2) : 0
    };
  }
  
  // By market breakdown
  const byMarket = {};
  for (const market of ['moneyline', 'spread', 'total', 'runline', 'prop', 'futures']) {
    const marketBets = graded.filter(b => b.market === market);
    if (marketBets.length === 0) continue;
    const marketWins = marketBets.filter(b => b.result === 'win');
    const marketStaked = marketBets.reduce((s, b) => s + b.stake, 0);
    const marketProfit = marketBets.reduce((s, b) => s + (b.profit || 0), 0);
    byMarket[market] = {
      bets: marketBets.length,
      wins: marketWins.length,
      losses: marketBets.filter(b => b.result === 'loss').length,
      winRate: +((marketWins.length / marketBets.length) * 100).toFixed(1),
      staked: +marketStaked.toFixed(2),
      profit: +marketProfit.toFixed(2),
      roi: marketStaked > 0 ? +((marketProfit / marketStaked) * 100).toFixed(2) : 0
    };
  }
  
  // By edge tier (model edge buckets)
  const byEdge = {};
  const edgeTiers = [
    { label: 'Strong (>8%)', min: 0.08, max: 1.0 },
    { label: 'Good (5-8%)', min: 0.05, max: 0.08 },
    { label: 'Moderate (3-5%)', min: 0.03, max: 0.05 },
    { label: 'Slim (1-3%)', min: 0.01, max: 0.03 },
  ];
  for (const tier of edgeTiers) {
    const tierBets = graded.filter(b => b.modelEdge && b.modelEdge >= tier.min && b.modelEdge < tier.max);
    if (tierBets.length === 0) continue;
    const tierWins = tierBets.filter(b => b.result === 'win');
    const tierStaked = tierBets.reduce((s, b) => s + b.stake, 0);
    const tierProfit = tierBets.reduce((s, b) => s + (b.profit || 0), 0);
    byEdge[tier.label] = {
      bets: tierBets.length,
      winRate: +((tierWins.length / tierBets.length) * 100).toFixed(1),
      profit: +tierProfit.toFixed(2),
      roi: tierStaked > 0 ? +((tierProfit / tierStaked) * 100).toFixed(2) : 0
    };
  }
  
  // Daily P&L
  const dailyPL = {};
  for (const bet of graded) {
    const d = bet.gameDate;
    if (!dailyPL[d]) dailyPL[d] = { date: d, bets: 0, wins: 0, staked: 0, profit: 0 };
    dailyPL[d].bets++;
    if (bet.result === 'win') dailyPL[d].wins++;
    dailyPL[d].staked += bet.stake;
    dailyPL[d].profit += (bet.profit || 0);
  }
  const dailySorted = Object.values(dailyPL)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      staked: +d.staked.toFixed(2),
      profit: +d.profit.toFixed(2),
      roi: d.staked > 0 ? +((d.profit / d.staked) * 100).toFixed(1) : 0
    }));
  
  // Bankroll curve (running total)
  let running = betData.bankroll;
  const bankrollCurve = dailySorted.map(d => {
    running += d.profit;
    return { date: d.date, bankroll: +running.toFixed(2), dayProfit: d.profit };
  });
  
  return {
    summary: {
      totalBets: bets.length,
      graded: graded.length,
      pending: pending.length,
      record: `${wins.length}-${losses.length}${pushes.length > 0 ? '-' + pushes.length : ''}`,
      winRate,
      totalStaked: +totalStaked.toFixed(2),
      totalProfit: +totalProfit.toFixed(2),
      totalPending: +totalPending.toFixed(2),
      roi,
      avgOdds,
      bankroll: betData.bankroll,
      currentBankroll: +(betData.bankroll + totalProfit).toFixed(2),
      streak,
      clv: avgCLV !== null ? {
        avgCents: avgCLV,
        positivePct: withCLV.length > 0 ? +((positiveCLV / withCLV.length) * 100).toFixed(1) : 0,
        tracked: withCLV.length,
        interpretation: avgCLV > 2 ? '🔥 Strong +CLV — sharp bettor territory' :
                        avgCLV > 0 ? '✅ Positive CLV — beating the market' :
                        avgCLV > -2 ? '⚠️ Neutral CLV' : '❌ Negative CLV — market is beating you'
      } : null
    },
    bySport,
    byMarket,
    byEdge,
    daily: dailySorted,
    bankrollCurve,
    recentBets: bets.slice(-20).reverse()
  };
}

function calculateStreak(gradedBets) {
  if (gradedBets.length === 0) return { type: 'none', count: 0 };
  
  const sorted = [...gradedBets].sort((a, b) => 
    (b.gradedAt || b.createdAt).localeCompare(a.gradedAt || a.createdAt)
  );
  
  const firstResult = sorted[0].result;
  if (firstResult !== 'win' && firstResult !== 'loss') return { type: 'none', count: 0 };
  
  let count = 0;
  for (const b of sorted) {
    if (b.result === firstResult) count++;
    else break;
  }
  
  return {
    type: firstResult === 'win' ? '🔥 Win streak' : '🧊 Losing streak',
    count,
    emoji: firstResult === 'win' ? '🔥'.repeat(Math.min(count, 5)) : '🧊'.repeat(Math.min(count, 5))
  };
}

// ==================== QUICK BET FROM MODEL ====================

/**
 * Create a bet directly from model prediction + odds data
 * This is the auto-bet flow: model finds edge → logs the bet
 */
function logModelBet(prediction, oddsData, opts = {}) {
  const sport = opts.sport || 'unknown';
  const stake = opts.stake || 10;
  
  // Determine the bet based on edges found
  const bets = [];
  
  if (prediction.homeEdge > 0.02 && oddsData.homeML) {
    bets.push(addBet({
      sport,
      pick: `${prediction.home} ML`,
      market: 'moneyline',
      odds: oddsData.homeML,
      stake,
      modelProb: prediction.homeWinProb,
      modelEdge: prediction.homeEdge || (prediction.homeWinProb - oddsToImpliedProb(oddsData.homeML)),
      game: `${prediction.away} @ ${prediction.home}`,
      gameDate: opts.gameDate || new Date().toISOString().split('T')[0],
      source: 'model-auto',
      confidence: prediction.homeEdge > 0.08 ? 'HIGH' : prediction.homeEdge > 0.04 ? 'MEDIUM' : 'LOW',
      notes: `Model: ${(prediction.homeWinProb * 100).toFixed(1)}% | Edge: ${(prediction.homeEdge * 100).toFixed(1)}%`
    }));
  }
  
  if (prediction.awayEdge > 0.02 && oddsData.awayML) {
    bets.push(addBet({
      sport,
      pick: `${prediction.away} ML`,
      market: 'moneyline',
      odds: oddsData.awayML,
      stake,
      modelProb: prediction.awayWinProb,
      modelEdge: prediction.awayEdge || (prediction.awayWinProb - oddsToImpliedProb(oddsData.awayML)),
      game: `${prediction.away} @ ${prediction.home}`,
      gameDate: opts.gameDate || new Date().toISOString().split('T')[0],
      source: 'model-auto',
      confidence: prediction.awayEdge > 0.08 ? 'HIGH' : prediction.awayEdge > 0.04 ? 'MEDIUM' : 'LOW',
      notes: `Model: ${(prediction.awayWinProb * 100).toFixed(1)}% | Edge: ${(prediction.awayEdge * 100).toFixed(1)}%`
    }));
  }
  
  return bets;
}

// ==================== LIST / QUERY ====================

function getBets(filters = {}) {
  let bets = [...betData.bets];
  
  if (filters.sport) bets = bets.filter(b => b.sport === filters.sport.toLowerCase());
  if (filters.market) bets = bets.filter(b => b.market === filters.market.toLowerCase());
  if (filters.result) bets = bets.filter(b => b.result === filters.result);
  if (filters.date) bets = bets.filter(b => b.gameDate === filters.date);
  if (filters.pending) bets = bets.filter(b => !b.result);
  if (filters.source) bets = bets.filter(b => b.source === filters.source);
  
  // Sort by date desc, then id desc
  bets.sort((a, b) => {
    const dateComp = (b.gameDate || '').localeCompare(a.gameDate || '');
    return dateComp !== 0 ? dateComp : b.id - a.id;
  });
  
  if (filters.limit) bets = bets.slice(0, filters.limit);
  
  return bets;
}

function getBet(betId) {
  return betData.bets.find(b => b.id === betId) || null;
}

function getStatus() {
  const graded = betData.bets.filter(b => b.result && b.result !== 'void');
  const wins = graded.filter(b => b.result === 'win');
  const totalProfit = graded.reduce((s, b) => s + (b.profit || 0), 0);
  
  return {
    service: 'bet-tracker',
    version: '1.0',
    totalBets: betData.bets.length,
    pending: betData.bets.filter(b => !b.result).length,
    graded: graded.length,
    record: `${wins.length}-${graded.length - wins.length}`,
    profit: +totalProfit.toFixed(2),
    bankroll: betData.bankroll,
    currentBankroll: +(betData.bankroll + totalProfit).toFixed(2)
  };
}

// Init on load
loadData();

module.exports = {
  addBet,
  gradeBet,
  deleteBet,
  updateClosingOdds,
  setBankroll,
  autoGrade,
  getAnalytics,
  getBets,
  getBet,
  getStatus,
  logModelBet,
  fetchScores,
  calculateCLV,
};
