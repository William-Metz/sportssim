/**
 * CLV (Closing Line Value) Tracking Pipeline — services/clv-tracker.js
 * 
 * The ULTIMATE model quality metric. CLV measures whether our model's picks 
 * beat the closing line. If we consistently get better odds than the close,
 * we have a real, sustainable edge.
 * 
 * How it works:
 * 1. When model generates a pick, we record the current line AND model price
 * 2. Before game starts, we snapshot the closing line
 * 3. After game, we compare: did we get a better price than the close?
 * 4. Over time, positive CLV = real edge, negative CLV = noise
 * 
 * CLV formula: (modelProb - closeProb) for ML bets
 *              (modelSpread - closeSpread) for ATS bets
 */

const fs = require('fs');
const path = require('path');

const CLV_FILE = path.join(__dirname, 'clv-data.json');
const MAX_HISTORY_DAYS = 90; // keep 90 days of CLV data

// In-memory CLV tracking
let clvData = { picks: [], summary: { total: 0, positive: 0, negative: 0, avgCLV: 0 } };

// Load persisted data
try {
  if (fs.existsSync(CLV_FILE)) {
    clvData = JSON.parse(fs.readFileSync(CLV_FILE, 'utf8'));
  }
} catch (e) {
  console.log('[clv] Error loading CLV data:', e.message);
}

function save() {
  try {
    fs.writeFileSync(CLV_FILE, JSON.stringify(clvData, null, 2));
  } catch (e) {
    console.log('[clv] Error saving:', e.message);
  }
}

/**
 * Record a model pick when it's generated
 * @param {object} pick - { sport, away, home, type, side, modelLine, bookLine, modelProb, bookProb, confidence }
 */
function recordPick(pick) {
  const entry = {
    id: `${pick.sport}-${pick.away}-${pick.home}-${pick.type}-${Date.now()}`,
    sport: pick.sport,
    away: pick.away,
    home: pick.home,
    type: pick.type, // 'spread', 'moneyline', 'total'
    side: pick.side, // 'home', 'away', 'over', 'under'
    modelLine: pick.modelLine,
    bookLineAtPick: pick.bookLine,
    modelProb: pick.modelProb,
    bookProbAtPick: pick.bookProb,
    confidence: pick.confidence,
    pickedAt: new Date().toISOString(),
    closingLine: null,
    closingProb: null,
    closedAt: null,
    result: null, // 'win', 'loss', 'push'
    clv: null, // positive = we beat the close
    clvPct: null,
    status: 'open' // 'open' → 'closed' → 'graded'
  };
  
  clvData.picks.push(entry);
  save();
  return entry;
}

/**
 * Record closing line for a game
 * @param {string} sport
 * @param {string} away
 * @param {string} home
 * @param {object} closingLine - { spread, total, homeML, awayML }
 */
function recordClosingLine(sport, away, home, closingLine) {
  let updated = 0;
  for (const pick of clvData.picks) {
    if (pick.status === 'open' && pick.sport === sport && pick.away === away && pick.home === home) {
      pick.closedAt = new Date().toISOString();
      pick.status = 'closed';
      
      if (pick.type === 'spread') {
        pick.closingLine = closingLine.spread;
        // CLV for spread: positive = we got a better number
        if (pick.side === 'home') {
          pick.clv = +(closingLine.spread - pick.bookLineAtPick).toFixed(1); // bigger close spread = we got a better price
        } else {
          pick.clv = +(pick.bookLineAtPick - closingLine.spread).toFixed(1);
        }
      } else if (pick.type === 'moneyline') {
        // Convert closing ML to probability
        const closeHomeProb = mlToProb(closingLine.homeML);
        const closeAwayProb = mlToProb(closingLine.awayML);
        pick.closingProb = pick.side === 'home' ? closeHomeProb : closeAwayProb;
        pick.closingLine = pick.side === 'home' ? closingLine.homeML : closingLine.awayML;
        // CLV: model prob minus closing prob (we were getting a better price)
        pick.clv = +((pick.modelProb - pick.closingProb) * 100).toFixed(1);
        pick.clvPct = +((pick.bookProbAtPick - pick.closingProb) / pick.closingProb * 100).toFixed(1);
      } else if (pick.type === 'total') {
        pick.closingLine = closingLine.total;
        if (pick.side === 'over') {
          pick.clv = +(pick.bookLineAtPick - closingLine.total).toFixed(1); // close moved up = we got a better over price
        } else {
          pick.clv = +(closingLine.total - pick.bookLineAtPick).toFixed(1); // close moved down = we got a better under price  
        }
      }
      
      updated++;
    }
  }
  
  if (updated > 0) save();
  return { updated };
}

/**
 * Grade a pick result
 * @param {string} pickId
 * @param {string} result - 'win', 'loss', 'push'
 */
function gradePick(pickId, result) {
  const pick = clvData.picks.find(p => p.id === pickId);
  if (!pick) return { error: 'Pick not found' };
  
  pick.result = result;
  pick.status = 'graded';
  pick.gradedAt = new Date().toISOString();
  
  recalcSummary();
  save();
  return pick;
}

/**
 * Auto-grade picks from game results
 * @param {Array} results - [{ sport, away, home, awayScore, homeScore }]
 */
function autoGrade(results) {
  let graded = 0;
  for (const r of results) {
    const picks = clvData.picks.filter(p => 
      (p.status === 'open' || p.status === 'closed') && 
      p.sport === r.sport && p.away === r.away && p.home === r.home
    );
    
    for (const pick of picks) {
      const actualMargin = r.awayScore - r.homeScore;
      const actualTotal = r.awayScore + r.homeScore;
      
      if (pick.type === 'spread') {
        if (pick.side === 'home') {
          const homeCover = -actualMargin < pick.bookLineAtPick;
          const push = -actualMargin === pick.bookLineAtPick;
          pick.result = push ? 'push' : homeCover ? 'win' : 'loss';
        } else {
          const awayCover = actualMargin > -pick.bookLineAtPick;
          const push = actualMargin === -pick.bookLineAtPick;
          pick.result = push ? 'push' : awayCover ? 'win' : 'loss';
        }
      } else if (pick.type === 'moneyline') {
        const homeWon = r.homeScore > r.awayScore;
        pick.result = (pick.side === 'home' && homeWon) || (pick.side === 'away' && !homeWon) ? 'win' : 'loss';
      } else if (pick.type === 'total') {
        if (actualTotal === pick.bookLineAtPick) pick.result = 'push';
        else if (pick.side === 'over') pick.result = actualTotal > pick.bookLineAtPick ? 'win' : 'loss';
        else pick.result = actualTotal < pick.bookLineAtPick ? 'win' : 'loss';
      }
      
      pick.status = 'graded';
      pick.gradedAt = new Date().toISOString();
      graded++;
    }
  }
  
  if (graded > 0) {
    recalcSummary();
    save();
  }
  return { graded };
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function recalcSummary() {
  const graded = clvData.picks.filter(p => p.status === 'graded' && p.clv !== null);
  const positive = graded.filter(p => p.clv > 0).length;
  const negative = graded.filter(p => p.clv < 0).length;
  const neutral = graded.filter(p => p.clv === 0).length;
  const avgCLV = graded.length > 0 ? +(graded.reduce((s, p) => s + p.clv, 0) / graded.length).toFixed(2) : 0;
  
  // Win rate with positive CLV
  const posClvPicks = graded.filter(p => p.clv > 0);
  const posClvWins = posClvPicks.filter(p => p.result === 'win').length;
  
  // Win rate with negative CLV
  const negClvPicks = graded.filter(p => p.clv < 0);
  const negClvWins = negClvPicks.filter(p => p.result === 'win').length;
  
  // By sport
  const bySport = {};
  for (const pick of graded) {
    if (!bySport[pick.sport]) bySport[pick.sport] = { total: 0, positive: 0, avgCLV: 0, totalCLV: 0 };
    bySport[pick.sport].total++;
    bySport[pick.sport].totalCLV += pick.clv;
    if (pick.clv > 0) bySport[pick.sport].positive++;
  }
  for (const sport of Object.keys(bySport)) {
    bySport[sport].avgCLV = +(bySport[sport].totalCLV / bySport[sport].total).toFixed(2);
    bySport[sport].posRate = +(bySport[sport].positive / bySport[sport].total * 100).toFixed(1);
    delete bySport[sport].totalCLV;
  }
  
  // By bet type
  const byType = {};
  for (const pick of graded) {
    if (!byType[pick.type]) byType[pick.type] = { total: 0, positive: 0, avgCLV: 0, totalCLV: 0 };
    byType[pick.type].total++;
    byType[pick.type].totalCLV += pick.clv;
    if (pick.clv > 0) byType[pick.type].positive++;
  }
  for (const type of Object.keys(byType)) {
    byType[type].avgCLV = +(byType[type].totalCLV / byType[type].total).toFixed(2);
    byType[type].posRate = +(byType[type].positive / byType[type].total * 100).toFixed(1);
    delete byType[type].totalCLV;
  }
  
  clvData.summary = {
    total: graded.length,
    positive,
    negative,
    neutral,
    posRate: graded.length > 0 ? +(positive / graded.length * 100).toFixed(1) : 0,
    avgCLV,
    posClvWinRate: posClvPicks.length > 0 ? +(posClvWins / posClvPicks.length * 100).toFixed(1) : 0,
    negClvWinRate: negClvPicks.length > 0 ? +(negClvWins / negClvPicks.length * 100).toFixed(1) : 0,
    bySport,
    byType,
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Get CLV summary + recent picks
 */
function getReport(limit = 50) {
  recalcSummary();
  
  // Prune old data
  const cutoff = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  clvData.picks = clvData.picks.filter(p => new Date(p.pickedAt).getTime() > cutoff);
  
  return {
    summary: clvData.summary,
    openPicks: clvData.picks.filter(p => p.status === 'open').length,
    closedPicks: clvData.picks.filter(p => p.status === 'closed').length,
    gradedPicks: clvData.picks.filter(p => p.status === 'graded').length,
    recentPicks: clvData.picks.slice(-limit).reverse(),
    insight: generateInsight()
  };
}

function generateInsight() {
  const graded = clvData.picks.filter(p => p.status === 'graded');
  if (graded.length < 10) return 'Need at least 10 graded picks for CLV analysis.';
  
  const avgCLV = clvData.summary.avgCLV;
  const posRate = clvData.summary.posRate;
  
  if (avgCLV > 2) return `🔥 STRONG EDGE: Average CLV of +${avgCLV} with ${posRate}% beat rate. Model is consistently beating the close.`;
  if (avgCLV > 0) return `✅ POSITIVE EDGE: Average CLV of +${avgCLV}. Model is slightly ahead of the market.`;
  if (avgCLV > -1) return `⚖️ BREAKEVEN: Average CLV of ${avgCLV}. Model is roughly market-efficient.`;
  return `⚠️ NEGATIVE CLV: Average of ${avgCLV}. Model is behind the market — review signals.`;
}

/**
 * Record picks from value detection automatically
 * Called after /api/value/:sport generates picks
 */
function recordFromValueDetection(sport, valueBets) {
  let recorded = 0;
  for (const bet of valueBets) {
    // Only record HIGH and MEDIUM confidence
    if (bet.confidence === 'LOW') continue;
    
    const existing = clvData.picks.find(p => 
      p.status === 'open' && p.sport === sport && 
      p.away === bet.away && p.home === bet.home && 
      p.type === bet.type
    );
    if (existing) continue; // don't double-record
    
    recordPick({
      sport,
      away: bet.away || bet.awayTeam,
      home: bet.home || bet.homeTeam,
      type: bet.type,
      side: bet.side || (bet.pick && bet.pick.includes('ML') ? (bet.pick.includes(bet.home) ? 'home' : 'away') : null),
      modelLine: bet.modelLine || bet.modelSpread,
      bookLine: bet.bookLine || bet.bookSpread,
      modelProb: bet.modelProb,
      bookProb: bet.bookProb,
      confidence: bet.confidence
    });
    recorded++;
  }
  return { recorded };
}

function getStatus() {
  return {
    service: 'clv-tracker',
    version: '1.0',
    totalPicks: clvData.picks.length,
    openPicks: clvData.picks.filter(p => p.status === 'open').length,
    closedPicks: clvData.picks.filter(p => p.status === 'closed').length,
    gradedPicks: clvData.picks.filter(p => p.status === 'graded').length,
    avgCLV: clvData.summary.avgCLV,
    lastUpdated: clvData.summary.lastUpdated
  };
}

module.exports = {
  recordPick,
  recordClosingLine,
  gradePick,
  autoGrade,
  getReport,
  getStatus,
  recordFromValueDetection
};
