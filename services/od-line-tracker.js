/**
 * Opening Day Line Movement Tracker — SportsSim v69.0
 * ====================================================
 * Tracks line movement on all 20 OD games from first post to game time.
 * 
 * WHY THIS MATTERS FOR $$$:
 *   - Early lines have the most value (books haven't been sharpened yet)
 *   - Line movement direction reveals sharp vs public money
 *   - Closing Line Value (CLV) = best predictor of long-term profitability
 *   - If our model had the line BEFORE the market moved there, we're winning
 *   - Reverse Line Movement (RLM) = sharp money going opposite of public = GOLD
 * 
 * Features:
 *   - Snapshot all 20 OD games with ML, totals, spreads from multiple books
 *   - Track movement over time (opener → current → close)
 *   - Compare model predictions to opening lines
 *   - Detect steam moves, RLM, and stale lines
 *   - Grade our model's early call accuracy
 */

const fs = require('fs');
const path = require('path');

const TRACKER_FILE = path.join(__dirname, 'od-line-tracker-data.json');

// Load existing tracker data
function loadTracker() {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
    }
  } catch (e) { /* fresh start */ }
  return { 
    snapshots: [],
    games: {},
    created: new Date().toISOString(),
    version: '1.0',
  };
}

// Save tracker data
function saveTracker(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2));
}

/**
 * Take a snapshot of current lines for all OD games.
 * Called periodically (every scan cycle) or on-demand.
 */
function recordSnapshot(liveOdds, modelPredictions) {
  const tracker = loadTracker();
  const now = new Date().toISOString();
  
  const snapshot = {
    timestamp: now,
    games: {},
  };
  
  // Record live odds for each game
  for (const game of (liveOdds || [])) {
    const key = `${game.away}@${game.home}`;
    const books = {};
    let bestHomeML = null, bestAwayML = null, bestTotal = null;
    
    for (const bk of (game.bookmakers || game.books || [])) {
      const bookName = bk.title || bk.name;
      const line = {};
      
      for (const mkt of (bk.markets || [])) {
        if (mkt.key === 'h2h') {
          for (const o of (mkt.outcomes || [])) {
            if (o.name === game.home_team || o.name === game.home) line.homeML = o.price;
            else line.awayML = o.price;
          }
        }
        if (mkt.key === 'totals') {
          for (const o of (mkt.outcomes || [])) {
            if (o.name === 'Over') { line.overTotal = o.point; line.overOdds = o.price; }
            if (o.name === 'Under') { line.underTotal = o.point; line.underOdds = o.price; }
          }
        }
        if (mkt.key === 'spreads') {
          for (const o of (mkt.outcomes || [])) {
            if (o.name === game.home_team || o.name === game.home) { 
              line.homeSpread = o.point; line.homeSpreadOdds = o.price; 
            } else {
              line.awaySpread = o.point; line.awaySpreadOdds = o.price;
            }
          }
        }
      }
      
      books[bookName] = line;
      
      if (line.homeML && (bestHomeML === null || line.homeML > bestHomeML)) bestHomeML = line.homeML;
      if (line.awayML && (bestAwayML === null || line.awayML > bestAwayML)) bestAwayML = line.awayML;
      if (line.overTotal && (bestTotal === null)) bestTotal = line.overTotal;
    }
    
    snapshot.games[key] = {
      bestHomeML, bestAwayML, bestTotal,
      bookCount: Object.keys(books).length,
      books,
    };
    
    // Initialize game tracking if first time
    if (!tracker.games[key]) {
      tracker.games[key] = {
        away: game.away || key.split('@')[0],
        home: game.home || key.split('@')[1],
        opener: { homeML: bestHomeML, awayML: bestAwayML, total: bestTotal, timestamp: now },
        current: null,
        modelFirst: null,
        movements: [],
      };
    }
    
    // Update current
    const prev = tracker.games[key].current;
    tracker.games[key].current = { 
      homeML: bestHomeML, awayML: bestAwayML, total: bestTotal, timestamp: now 
    };
    
    // Detect movement
    if (prev && prev.homeML !== null && bestHomeML !== null) {
      const mlMove = bestHomeML - prev.homeML;
      const totalMove = (bestTotal || 0) - (prev.total || 0);
      
      if (Math.abs(mlMove) >= 3 || Math.abs(totalMove) >= 0.5) {
        tracker.games[key].movements.push({
          timestamp: now,
          from: { homeML: prev.homeML, awayML: prev.awayML, total: prev.total },
          to: { homeML: bestHomeML, awayML: bestAwayML, total: bestTotal },
          mlShift: mlMove,
          totalShift: totalMove,
          type: Math.abs(mlMove) >= 10 ? 'STEAM' : Math.abs(mlMove) >= 5 ? 'SHARP' : 'DRIFT',
        });
      }
    }
  }
  
  // Record model predictions alongside
  if (modelPredictions) {
    for (const pred of modelPredictions) {
      const key = `${pred.away}@${pred.home}`;
      if (tracker.games[key] && !tracker.games[key].modelFirst) {
        tracker.games[key].modelFirst = {
          homeML: pred.prediction?.homeML,
          awayML: pred.prediction?.awayML,
          total: pred.prediction?.totalRuns,
          homeWinProb: pred.prediction?.homeWinProb,
          timestamp: now,
        };
      }
    }
  }
  
  tracker.snapshots.push({ timestamp: now, gameCount: Object.keys(snapshot.games).length });
  
  // Keep only last 100 snapshots
  if (tracker.snapshots.length > 100) {
    tracker.snapshots = tracker.snapshots.slice(-100);
  }
  
  saveTracker(tracker);
  return snapshot;
}

/**
 * Record model predictions when no live odds available yet.
 * Captures our "first call" for CLV analysis later.
 */
function recordModelPredictions(games) {
  const tracker = loadTracker();
  const now = new Date().toISOString();
  
  for (const game of games) {
    const key = `${game.away}@${game.home}`;
    
    if (!tracker.games[key]) {
      tracker.games[key] = {
        away: game.away,
        home: game.home,
        opener: null,
        current: null,
        modelFirst: null,
        movements: [],
      };
    }
    
    // Record our first model prediction for this game
    if (!tracker.games[key].modelFirst) {
      tracker.games[key].modelFirst = {
        homeML: game.prediction?.homeML || game.homeML,
        awayML: game.prediction?.awayML || game.awayML,
        total: game.prediction?.totalRuns || game.totalRuns,
        homeWinProb: game.prediction?.homeWinProb || game.homeWinProb,
        timestamp: now,
        signals: game.signals ? Object.keys(game.signals).length : 0,
      };
    }
    
    // If we have DK lines, record them as "opener"
    if (game.dkLine && !tracker.games[key].opener) {
      tracker.games[key].opener = {
        homeML: game.dkLine.homeML,
        awayML: game.dkLine.awayML,
        total: game.dkLine.total,
        source: 'DraftKings (pre-OD)',
        timestamp: now,
      };
    }
  }
  
  saveTracker(tracker);
  return tracker;
}

/**
 * Get line movement analysis for all OD games.
 */
function getLineMovementReport() {
  const tracker = loadTracker();
  const report = {
    timestamp: new Date().toISOString(),
    totalGames: Object.keys(tracker.games).length,
    gamesWithMovement: 0,
    gamesWithSteam: 0,
    totalSnapshots: tracker.snapshots.length,
    games: [],
    clvAnalysis: null,
  };
  
  for (const [key, game] of Object.entries(tracker.games)) {
    const entry = {
      matchup: key,
      away: game.away,
      home: game.home,
      opener: game.opener,
      current: game.current,
      modelFirst: game.modelFirst,
      movements: game.movements,
      analysis: {},
    };
    
    // Calculate total movement
    if (game.opener && game.current && game.opener.homeML !== null && game.current.homeML !== null) {
      entry.analysis.totalMLMove = game.current.homeML - game.opener.homeML;
      entry.analysis.totalTotalMove = (game.current.total || 0) - (game.opener.total || 0);
      
      if (entry.analysis.totalMLMove !== 0) report.gamesWithMovement++;
      if (game.movements.some(m => m.type === 'STEAM')) report.gamesWithSteam++;
      
      // Direction classification
      if (entry.analysis.totalMLMove > 5) entry.analysis.direction = 'SHARP_HOME';
      else if (entry.analysis.totalMLMove < -5) entry.analysis.direction = 'SHARP_AWAY';
      else entry.analysis.direction = 'STABLE';
    }
    
    // Model vs opener CLV
    if (game.modelFirst && game.opener) {
      const modelHome = game.modelFirst.homeML;
      const openerHome = game.opener.homeML;
      
      if (modelHome !== null && openerHome !== null) {
        // Did our model correctly predict the direction of movement?
        const modelFavsHome = modelHome < 0 || (modelHome > 0 && modelHome < openerHome);
        
        // Model edge at open = difference between model prob and opener implied prob
        const modelProb = game.modelFirst.homeWinProb || 0.5;
        const openerImplied = openerHome < 0 
          ? Math.abs(openerHome) / (Math.abs(openerHome) + 100)
          : 100 / (openerHome + 100);
        
        entry.analysis.modelEdgeAtOpen = +((modelProb - openerImplied) * 100).toFixed(1);
        entry.analysis.modelSide = modelProb > openerImplied ? 'HOME' : 'AWAY';
        
        // If we have current lines, check if market moved toward our model
        if (game.current && game.current.homeML !== null) {
          const currentImplied = game.current.homeML < 0
            ? Math.abs(game.current.homeML) / (Math.abs(game.current.homeML) + 100)
            : 100 / (game.current.homeML + 100);
          
          const marketMovedToward = (modelProb > openerImplied && currentImplied > openerImplied) ||
                                     (modelProb < openerImplied && currentImplied < openerImplied);
          
          entry.analysis.marketMovedTowardModel = marketMovedToward;
          entry.analysis.clv = +((currentImplied - openerImplied) * 100).toFixed(1);
          
          if (marketMovedToward) {
            entry.analysis.clvGrade = '✅ Market moving our way';
          } else {
            entry.analysis.clvGrade = '⚠️ Market moving against us';
          }
        }
      }
    }
    
    report.games.push(entry);
  }
  
  // Overall CLV summary
  const gamesWithCLV = report.games.filter(g => g.analysis.modelEdgeAtOpen !== undefined);
  if (gamesWithCLV.length > 0) {
    const avgEdge = gamesWithCLV.reduce((s, g) => s + Math.abs(g.analysis.modelEdgeAtOpen), 0) / gamesWithCLV.length;
    const towardCount = gamesWithCLV.filter(g => g.analysis.marketMovedTowardModel).length;
    report.clvAnalysis = {
      gamesTracked: gamesWithCLV.length,
      avgModelEdge: +avgEdge.toFixed(1),
      marketMovedTowardModel: towardCount,
      clvHitRate: gamesWithCLV.length > 0 ? +(towardCount / gamesWithCLV.length * 100).toFixed(1) : 0,
    };
  }
  
  return report;
}

/**
 * Initialize tracker with current OD playbook data.
 * Called at startup to seed model predictions.
 */
async function initializeFromPlaybook(odPlaybook) {
  if (!odPlaybook || !odPlaybook.playbook) return;
  
  const games = odPlaybook.playbook.map(g => ({
    away: g.away,
    home: g.home,
    prediction: g.signals?.analytical,
    dkLine: g.signals?.liveOdds?.books?.['DraftKings (pre-OD)'] ? {
      homeML: g.signals.liveOdds.books['DraftKings (pre-OD)'].homeML,
      awayML: g.signals.liveOdds.books['DraftKings (pre-OD)'].awayML,
      total: g.signals.liveOdds.bestTotal,
    } : g.dkLine,
    signals: g.signals,
  }));
  
  return recordModelPredictions(games);
}

module.exports = {
  recordSnapshot,
  recordModelPredictions,
  getLineMovementReport,
  initializeFromPlaybook,
  loadTracker,
};
