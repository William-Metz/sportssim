/**
 * OD Line Change Tracker v114.0
 * ==============================
 * Tracks DK line movement between our model snapshots and ESPN/DK live lines.
 * Identifies edge shifts: new edges that appeared, edges that evaporated, and bets to adjust.
 * 
 * At T-2, books are moving lines as sharp money comes in. We need to know:
 * 1. Which of our plays got BETTER (line moved in our favor)
 * 2. Which plays got WORSE (edge shrinking)
 * 3. New edges that appeared from line movement
 * 4. Games where total moved significantly (>0.5 run shift = recalculate)
 */

// Safe requires
let mlbOpeningDay = null;
let mlbModel = null;
try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}
try { mlbModel = require('../models/mlb'); } catch(e) {}

// Previous snapshot of DK lines (before March 24 ESPN update)
// These are what we had BEFORE updating
const PREVIOUS_DK_LINES = {
  'PIT@NYM':  { homeML: -122, awayML: 102, total: 7.5 },
  'CWS@MIL':  { homeML: -197, awayML: 165, total: 8.5 },
  'WSH@CHC':  { homeML: -201, awayML: 170, total: 8.0 },
  'MIN@BAL':  { homeML: -154, awayML: 130, total: 8.5 },
  'BOS@CIN':  { homeML: 134, awayML: -158, total: 8.0 },
  'LAA@HOU':  { homeML: -190, awayML: 160, total: 8.0 },
  'DET@SD':   { homeML: 118, awayML: -138, total: 7.0 },
  'TB@STL':   { homeML: 104, awayML: -124, total: 9.0 },
  'TEX@PHI':  { homeML: -154, awayML: 130, total: 8.5 },
  'ARI@LAD':  { homeML: -238, awayML: 198, total: 7.5 },
  'CLE@SEA':  { homeML: -177, awayML: 150, total: 7.0 },
};

// Current DK lines from ESPN as of March 24, 2026
const CURRENT_DK_LINES = {
  'PIT@NYM':  { homeML: -126, awayML: 106, total: 6.5 },
  'CWS@MIL':  { homeML: -200, awayML: 170, total: 8.5 },
  'WSH@CHC':  { homeML: -208, awayML: 176, total: 9.0 },
  'MIN@BAL':  { homeML: -150, awayML: 128, total: 8.5 },
  'BOS@CIN':  { homeML: 133, awayML: -157, total: 8.5 },
  'LAA@HOU':  { homeML: -187, awayML: 158, total: 8.5 },
  'DET@SD':   { homeML: 117, awayML: -137, total: 7.5 },
  'TB@STL':   { homeML: 106, awayML: -126, total: 7.5 },
  'TEX@PHI':  { homeML: -150, awayML: 128, total: 8.5 },
  'ARI@LAD':  { homeML: -233, awayML: 194, total: 9.5 },
  'CLE@SEA':  { homeML: -177, awayML: 150, total: 6.5 },
};

function mlToProb(ml) {
  if (ml >= 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

function analyzeLineChanges() {
  const changes = [];
  
  for (const [game, prev] of Object.entries(PREVIOUS_DK_LINES)) {
    const curr = CURRENT_DK_LINES[game];
    if (!curr) continue;
    
    const homeMLChange = curr.homeML - prev.homeML;
    const awayMLChange = curr.awayML - prev.awayML;
    const totalChange = curr.total - prev.total;
    
    const prevHomeProb = mlToProb(prev.homeML);
    const currHomeProb = mlToProb(curr.homeML);
    const homeProbChange = (currHomeProb - prevHomeProb) * 100;
    
    const significance = Math.abs(totalChange) >= 0.5 ? 'SIGNIFICANT' : 
                         Math.abs(homeMLChange) >= 10 ? 'MODERATE' : 'MINOR';
    
    const signals = [];
    
    // Total movement analysis
    if (totalChange > 0) {
      signals.push(`Total UP ${totalChange.toFixed(1)} (${prev.total} → ${curr.total}): Market expects more offense`);
    } else if (totalChange < 0) {
      signals.push(`Total DOWN ${totalChange.toFixed(1)} (${prev.total} → ${curr.total}): Market expects less offense`);
    }
    
    // ML movement analysis  
    if (Math.abs(homeMLChange) >= 5) {
      const dir = homeMLChange < 0 ? 'MORE' : 'LESS';
      signals.push(`Home ${dir} favored: ${prev.homeML > 0 ? '+' : ''}${prev.homeML} → ${curr.homeML > 0 ? '+' : ''}${curr.homeML}`);
    }
    
    // Betting implications
    const bettingImplications = [];
    
    // Check UNDER edges (if total dropped, UNDER edge shrinks)
    if (totalChange < 0) {
      bettingImplications.push({ type: 'UNDER_EDGE_SHRUNK', detail: `Total dropped from ${prev.total} to ${curr.total} — market agrees with UNDER lean, less edge remaining` });
    }
    if (totalChange > 0) {
      bettingImplications.push({ type: 'UNDER_EDGE_GREW', detail: `Total rose from ${prev.total} to ${curr.total} — MORE edge for UNDER bets if our model is right` });
    }
    
    changes.push({
      game,
      previous: prev,
      current: curr,
      homeMLChange,
      awayMLChange,
      totalChange,
      homeProbChange: Math.round(homeProbChange * 10) / 10,
      significance,
      signals,
      bettingImplications,
    });
  }
  
  // Sort by significance
  changes.sort((a, b) => {
    const order = { SIGNIFICANT: 0, MODERATE: 1, MINOR: 2 };
    return (order[a.significance] || 2) - (order[b.significance] || 2) || 
           Math.abs(b.totalChange) - Math.abs(a.totalChange);
  });
  
  return {
    title: '📊 OD Line Change Tracker — March 24 Update',
    generated: new Date().toISOString(),
    source: 'ESPN/DraftKings as of March 24',
    totalGames: changes.length,
    significantChanges: changes.filter(c => c.significance === 'SIGNIFICANT').length,
    summary: generateSummary(changes),
    changes,
    keyTakeaways: generateKeyTakeaways(changes),
  };
}

function generateSummary(changes) {
  const totalUp = changes.filter(c => c.totalChange > 0);
  const totalDown = changes.filter(c => c.totalChange < 0);
  const totalSame = changes.filter(c => c.totalChange === 0);
  
  return {
    totalsUp: totalUp.map(c => `${c.game}: ${c.previous.total} → ${c.current.total}`),
    totalsDown: totalDown.map(c => `${c.game}: ${c.previous.total} → ${c.current.total}`),
    totalsUnchanged: totalSame.length,
    avgTotalChange: changes.reduce((sum, c) => sum + c.totalChange, 0) / changes.length,
    biggestMLMove: changes.reduce((best, c) => 
      Math.abs(c.homeMLChange) > Math.abs(best.homeMLChange) ? c : best, changes[0]),
  };
}

function generateKeyTakeaways(changes) {
  const takeaways = [];
  
  // TB@STL total dropped 1.5 runs (9.0 → 7.5)
  const tbStl = changes.find(c => c.game === 'TB@STL');
  if (tbStl && Math.abs(tbStl.totalChange) >= 1.0) {
    takeaways.push({
      priority: 'HIGH',
      game: 'TB@STL',
      note: `⚠️ MASSIVE total shift: ${tbStl.previous.total} → ${tbStl.current.total} (${tbStl.totalChange > 0 ? '+' : ''}${tbStl.totalChange}). Our UNDER plays on this game need recalculation. Market may have adjusted to Rasmussen returning from injury (lower offense expected) or Liberatore's 2025 improvement.`,
    });
  }
  
  // PIT@NYM total dropped (7.5 → 6.5) 
  const pitNym = changes.find(c => c.game === 'PIT@NYM');
  if (pitNym && pitNym.totalChange < -0.5) {
    takeaways.push({
      priority: 'HIGH',
      game: 'PIT@NYM',
      note: `Skenes vs Peralta: Total dropped from ${pitNym.previous.total} to ${pitNym.current.total}. Books pricing this as elite ace duel. If our model had UNDER lean, edge is shrinking — market agrees. Check if NRFI edge holds at lower total.`,
    });
  }
  
  // ARI@LAD total SURGED (7.5 → 9.5)
  const ariLad = changes.find(c => c.game === 'ARI@LAD');
  if (ariLad && ariLad.totalChange > 1.0) {
    takeaways.push({
      priority: 'HIGH',
      game: 'ARI@LAD',
      note: `🔥 HUGE total surge: ${ariLad.previous.total} → ${ariLad.current.total} (+${ariLad.totalChange}). Books LOVE LAD offense (Ohtani/Betts/Freeman). If our model projects lower, UNDER at 9.5 could be massive edge since Yamamoto is elite. Opposite: if model agrees, skip — books are right.`,
    });
  }
  
  // BOS@CIN total up (8.0 → 8.5)
  const bosCin = changes.find(c => c.game === 'BOS@CIN');
  if (bosCin && bosCin.totalChange > 0) {
    takeaways.push({
      priority: 'MEDIUM',
      game: 'BOS@CIN',
      note: `GABP hitter-friendly: Total up ${bosCin.previous.total} → ${bosCin.current.total}. Books adjusting for park factor despite Crochet being elite. Check if our model already accounted for GABP boost.`,
    });
  }
  
  // WSH@CHC total up (8.0 → 9.0)
  const wshChc = changes.find(c => c.game === 'WSH@CHC');
  if (wshChc && wshChc.totalChange > 0) {
    takeaways.push({
      priority: 'MEDIUM',
      game: 'WSH@CHC',
      note: `Wrigley: Total up ${wshChc.previous.total} → ${wshChc.current.total}. Boyd/Cavalli = weaker pitching matchup. Books pricing in wind/weather? Our Wrigley wind model should capture this.`,
    });
  }
  
  // CLE@SEA total dropped (7.0 → 6.5)
  const cleSea = changes.find(c => c.game === 'CLE@SEA');
  if (cleSea && cleSea.totalChange < 0) {
    takeaways.push({
      priority: 'LOW',
      game: 'CLE@SEA',
      note: `T-Mobile Park: Total down ${cleSea.previous.total} → ${cleSea.current.total}. Bibee vs Gilbert = elite K pitchers in pitcher-friendly park. UNDER was already our lean — edge compressed but still valid.`,
    });
  }
  
  return takeaways;
}

module.exports = {
  analyzeLineChanges,
  PREVIOUS_DK_LINES,
  CURRENT_DK_LINES,
};
