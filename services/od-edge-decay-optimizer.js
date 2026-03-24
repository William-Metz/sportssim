/**
 * OD Edge Decay & Bet Timing Optimizer — services/od-edge-decay-optimizer.js v118.0
 * ====================================================================================
 * 
 * MISSION: Determine the OPTIMAL TIME to place each Opening Day bet by analyzing
 * how edges are decaying (or growing) as sharp money moves lines.
 * 
 * WHY THIS MATTERS:
 *   - Lines posted ~48h before game time are WIDEST (max edge)
 *   - Sharps typically bet 12-36h pre-game → lines tighten
 *   - Public money flows 2-6h pre-game → can create reverse movement
 *   - Our model edges decay at different rates per market type:
 *     • ML: Decay fastest (sharps hit these first)
 *     • Totals: Medium decay (requires game-specific info)
 *     • F5/F3/F7: Slowest decay (less liquid, fewer sharp eyes)
 *     • Props (K, Outs, NRFI): Often DON'T decay until game day
 *   
 * TIMING FRAMEWORK:
 *   T-48h to T-24h: "Opening Window" — widest edges, lowest limits
 *   T-24h to T-12h: "Sharp Window" — edges shrinking, limits increasing
 *   T-12h to T-6h:  "Transition Window" — best value/liquidity balance
 *   T-6h to T-2h:   "Public Window" — public money can create new edges
 *   T-2h to T-0:    "Lineup Window" — lineups confirmed, sharp adjustment
 *   
 * ALGORITHM:
 *   1. Track line snapshots over time (from od-odds-monitor)
 *   2. Calculate decay rate per bet: Δedge / Δtime
 *   3. Project when edge will cross 0% (edge extinction point)
 *   4. Recommend: BET NOW / WAIT / HEDGE / PASS based on decay trajectory
 *   5. Factor in market liquidity (prop markets hold edge longer)
 */

const fs = require('fs');
const path = require('path');

// ==================== DEPENDENCIES ====================
let odOddsMonitor = null;
let odLineTracker = null;
let playbookCache = null;
let odModel = null;

try { odOddsMonitor = require('./od-odds-monitor'); } catch(e) {}
try { odLineTracker = require('./od-line-change-tracker'); } catch(e) {}
try { playbookCache = require('./od-playbook-cache'); } catch(e) {}
try { odModel = require('../models/mlb-opening-day'); } catch(e) {}

// ==================== CONSTANTS ====================

// Edge decay rates by market type (% per hour, from empirical MLB data)
const DECAY_RATES = {
  moneyline:  { sharp: 0.25, public: 0.10, prop: 0.05 },  // ML edges decay ~0.25%/hr during sharp window
  totals:     { sharp: 0.20, public: 0.08, prop: 0.04 },
  f5:         { sharp: 0.12, public: 0.05, prop: 0.03 },
  f3:         { sharp: 0.10, public: 0.04, prop: 0.02 },
  f7:         { sharp: 0.10, public: 0.04, prop: 0.02 },
  runline:    { sharp: 0.15, public: 0.07, prop: 0.03 },
  kprop:      { sharp: 0.05, public: 0.03, prop: 0.02 },   // K props hold edge longest
  outsprop:   { sharp: 0.04, public: 0.03, prop: 0.01 },
  nrfi:       { sharp: 0.08, public: 0.05, prop: 0.03 },
  teamtotal:  { sharp: 0.15, public: 0.06, prop: 0.03 },
};

// Time windows (hours before game time)
const WINDOWS = {
  OPENING:    { start: 48, end: 24, name: 'Opening Window', phase: 'opening' },
  SHARP:      { start: 24, end: 12, name: 'Sharp Window', phase: 'sharp' },
  TRANSITION: { start: 12, end: 6,  name: 'Transition Window', phase: 'transition' },
  PUBLIC:     { start: 6,  end: 2,  name: 'Public Window', phase: 'public' },
  LINEUP:     { start: 2,  end: 0,  name: 'Lineup Window', phase: 'lineup' },
};

// Opening Day schedule
const OD_SCHEDULE = {
  day1: {
    date: '2026-03-26',
    firstPitch: '2026-03-26T17:10:00Z',  // 1:10 PM ET (PIT@NYM)
    lastPitch: '2026-03-27T01:10:00Z',   // 9:10 PM ET (ARI@LAD)
    games: [
      { away: 'PIT', home: 'NYM', time: '2026-03-26T17:10:00Z' },
      { away: 'CWS', home: 'MIL', time: '2026-03-26T18:10:00Z' },
      { away: 'WSH', home: 'CHC', time: '2026-03-26T18:20:00Z' },
      { away: 'MIN', home: 'BAL', time: '2026-03-26T19:05:00Z' },
      { away: 'BOS', home: 'CIN', time: '2026-03-26T20:10:00Z' },
      { away: 'LAA', home: 'HOU', time: '2026-03-26T20:10:00Z' },
      { away: 'DET', home: 'SD',  time: '2026-03-26T22:10:00Z' },
      { away: 'TB',  home: 'STL', time: '2026-03-26T22:15:00Z' },
      { away: 'TEX', home: 'PHI', time: '2026-03-26T23:05:00Z' },
      { away: 'KC',  home: 'ATL', time: '2026-03-27T00:20:00Z' },
      { away: 'ARI', home: 'LAD', time: '2026-03-27T01:10:00Z' },
    ],
  },
  day2: {
    date: '2026-03-27',
    firstPitch: '2026-03-27T18:05:00Z',  // 2:05 PM ET
    lastPitch: '2026-03-28T01:40:00Z',   // 9:40 PM ET
    games: [
      { away: 'OAK', home: 'TOR', time: '2026-03-27T18:07:00Z' },
      { away: 'MIA', home: 'NYY', time: '2026-03-27T19:05:00Z' },
      { away: 'HOU', home: 'COL', time: '2026-03-27T20:10:00Z' },
      { away: 'CHC', home: 'CIN', time: '2026-03-27T22:10:00Z' },
      { away: 'SF',  home: 'MIL', time: '2026-03-27T22:10:00Z' },
      { away: 'PHI', home: 'TOR', time: '2026-03-27T23:07:00Z' },
      { away: 'STL', home: 'ATL', time: '2026-03-27T23:20:00Z' },
      { away: 'CLE', home: 'SEA', time: '2026-03-28T01:10:00Z' },
      { away: 'SD',  home: 'LAD', time: '2026-03-28T01:10:00Z' },
    ],
  }
};

// ==================== STATE ====================
const STATE_FILE = path.join(__dirname, 'edge-decay-state.json');
let decayState = {
  snapshots: [],          // Array of { timestamp, edges: { gameKey: { ml, total, f5... } } }
  recommendations: {},     // gameKey → { betNow: [], wait: [], pass: [] }
  lastAnalysis: null,
  edgeTrajectories: {},   // gameKey → { market → { initial, current, decayRate, extinctionETA } }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      decayState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch(e) {}
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(decayState, null, 2));
  } catch(e) {}
}

// ==================== EDGE CALCULATION ====================

/**
 * Calculate implied probability from American odds
 */
function impliedProb(odds) {
  if (!odds || odds === 0) return 0.5;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

/**
 * Calculate edge: model probability - implied probability
 */
function calcEdge(modelProb, bookOdds) {
  const implied = impliedProb(bookOdds);
  return ((modelProb - implied) / implied * 100).toFixed(1);
}

/**
 * Get current time window for a game
 */
function getTimeWindow(gameTimeStr) {
  const now = new Date();
  const gameTime = new Date(gameTimeStr);
  const hoursToGame = (gameTime - now) / (1000 * 60 * 60);
  
  if (hoursToGame > 48) return { ...WINDOWS.OPENING, hoursToGame, phase: 'pre-opening' };
  if (hoursToGame > 24) return { ...WINDOWS.OPENING, hoursToGame };
  if (hoursToGame > 12) return { ...WINDOWS.SHARP, hoursToGame };
  if (hoursToGame > 6)  return { ...WINDOWS.TRANSITION, hoursToGame };
  if (hoursToGame > 2)  return { ...WINDOWS.PUBLIC, hoursToGame };
  if (hoursToGame > 0)  return { ...WINDOWS.LINEUP, hoursToGame };
  return { name: 'Game Started', phase: 'live', hoursToGame };
}

// ==================== EDGE TRAJECTORY ANALYSIS ====================

/**
 * Record current edge snapshot from playbook data
 */
function recordSnapshot(playbookData) {
  if (!playbookData || !playbookData.games) return;
  
  const snapshot = {
    timestamp: new Date().toISOString(),
    edges: {},
  };
  
  for (const game of playbookData.games) {
    const key = game.gameKey || `${game.away}@${game.home}`;
    const edges = {};
    
    // Extract edges from playbook game data
    if (game.prediction) {
      const pred = game.prediction;
      if (pred.awayWinProb) edges.awayML = pred.awayWinProb;
      if (pred.homeWinProb) edges.homeML = pred.homeWinProb;
      if (pred.expectedTotal) edges.expectedTotal = pred.expectedTotal;
    }
    
    if (game.signals) {
      for (const signal of game.signals) {
        if (signal.type === 'f5') edges.f5 = signal;
        if (signal.type === 'nrfi') edges.nrfi = signal;
      }
    }
    
    if (game.nbF5) edges.f5Data = game.nbF5;
    if (game.conviction) edges.conviction = game.conviction;
    if (game.odds) edges.odds = game.odds;
    if (game.edge) edges.edge = game.edge;
    
    snapshot.edges[key] = edges;
  }
  
  // Keep max 100 snapshots (rolling ~25 hours at 15-min intervals)
  decayState.snapshots.push(snapshot);
  if (decayState.snapshots.length > 100) {
    decayState.snapshots = decayState.snapshots.slice(-100);
  }
  
  saveState();
  return snapshot;
}

/**
 * Calculate edge decay trajectory for a specific game and market
 */
function calcDecayTrajectory(gameKey, marketType) {
  const snapshots = decayState.snapshots.filter(s => s.edges[gameKey]);
  if (snapshots.length < 2) return null;
  
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const timeDiffHours = (new Date(last.timestamp) - new Date(first.timestamp)) / (1000 * 60 * 60);
  
  if (timeDiffHours < 0.1) return null; // Need at least 6 minutes of data
  
  let initialEdge = 0, currentEdge = 0;
  
  // Extract edge values based on market type
  if (marketType === 'moneyline' || marketType === 'ml') {
    initialEdge = first.edges[gameKey]?.edge?.homeEdge || first.edges[gameKey]?.edge?.awayEdge || 0;
    currentEdge = last.edges[gameKey]?.edge?.homeEdge || last.edges[gameKey]?.edge?.awayEdge || 0;
  } else if (marketType === 'totals' || marketType === 'total') {
    initialEdge = first.edges[gameKey]?.edge?.totalEdge || 0;
    currentEdge = last.edges[gameKey]?.edge?.totalEdge || 0;
  }
  
  const decayRate = timeDiffHours > 0 ? (initialEdge - currentEdge) / timeDiffHours : 0;
  const extinctionHours = currentEdge > 0 && decayRate > 0 ? currentEdge / decayRate : Infinity;
  
  return {
    gameKey,
    marketType,
    initialEdge: parseFloat(initialEdge) || 0,
    currentEdge: parseFloat(currentEdge) || 0,
    decayRate: parseFloat(decayRate.toFixed(3)),
    observationHours: parseFloat(timeDiffHours.toFixed(1)),
    snapshottCount: snapshots.length,
    extinctionETA: extinctionHours === Infinity ? 'never' : `${extinctionHours.toFixed(1)}h`,
    direction: decayRate > 0.05 ? 'DECAYING' : decayRate < -0.05 ? 'GROWING' : 'STABLE',
  };
}

// ==================== BET TIMING RECOMMENDATIONS ====================

/**
 * Generate bet timing recommendation for a specific play
 */
function getTimingRecommendation(play, gameTime) {
  const window = getTimeWindow(gameTime);
  const hoursToGame = window.hoursToGame;
  const edgeSize = parseFloat(play.edge || play.edgePct || 0);
  const confidence = play.confidence || play.conviction || 50;
  const marketType = play.marketType || play.type || 'moneyline';
  
  // Get decay rate for this market type
  const decayProfile = DECAY_RATES[marketType] || DECAY_RATES.moneyline;
  
  // Estimate edge at game time based on current phase
  let projectedDecayPerHour;
  if (hoursToGame > 24) {
    projectedDecayPerHour = decayProfile.sharp * 0.5; // Minimal pre-sharp window
  } else if (hoursToGame > 12) {
    projectedDecayPerHour = decayProfile.sharp;
  } else if (hoursToGame > 6) {
    projectedDecayPerHour = (decayProfile.sharp + decayProfile.public) / 2;
  } else if (hoursToGame > 2) {
    projectedDecayPerHour = decayProfile.public;
  } else {
    projectedDecayPerHour = decayProfile.prop; // Minimal decay after lineups
  }
  
  const projectedEdgeAtGameTime = edgeSize - (projectedDecayPerHour * hoursToGame);
  const projectedEdgeMidway = edgeSize - (projectedDecayPerHour * (hoursToGame / 2));
  
  // Calculate expected value at different bet times
  const evNow = edgeSize;
  const evMidway = projectedEdgeMidway;
  const evGameTime = projectedEdgeAtGameTime;
  
  // Decision logic
  let action, urgency, reasoning;
  
  if (edgeSize <= 0) {
    action = 'PASS';
    urgency = 'none';
    reasoning = 'No current edge — edge has fully decayed or never existed';
  } else if (projectedEdgeAtGameTime <= 0 && edgeSize > 2) {
    // Edge will decay to 0 before game time — bet NOW
    action = 'BET_NOW';
    urgency = 'critical';
    reasoning = `Edge decaying at ~${projectedDecayPerHour.toFixed(2)}%/hr — will reach 0% in ~${(edgeSize / projectedDecayPerHour).toFixed(0)}h. Current edge ${edgeSize.toFixed(1)}% won't survive to game time.`;
  } else if (edgeSize > 10 && confidence >= 70) {
    // Large edge with high confidence — bet now to lock it in
    action = 'BET_NOW';
    urgency = 'high';
    reasoning = `${edgeSize.toFixed(1)}% edge with ${confidence} conviction — this is a SMASH play. Lock it in before sharps find it.`;
  } else if (marketType === 'kprop' || marketType === 'outsprop') {
    // Props hold edge longer — can wait for game-day info
    if (hoursToGame > 12) {
      action = 'WAIT';
      urgency = 'low';
      reasoning = `Prop markets hold edge well (~${decayProfile.sharp}%/hr decay). Wait for lineup confirmation for better accuracy.`;
    } else {
      action = 'BET_NOW';
      urgency = 'medium';
      reasoning = `Prop within 12h of game — lineups should be out soon. Lock in the edge.`;
    }
  } else if (marketType === 'nrfi') {
    // NRFI needs lineups for max accuracy
    if (hoursToGame > 3) {
      action = 'WAIT';
      urgency = 'low';
      reasoning = `NRFI accuracy improves with confirmed lineups. Wait until 2-3h pre-game.`;
    } else {
      action = 'BET_NOW';
      urgency = 'medium';
      reasoning = `Within lineup window — NRFI edge should be optimal now.`;
    }
  } else if (edgeSize > 5 && hoursToGame > 24) {
    // Good edge but far from game — partial bet now, more later
    action = 'SCALE_IN';
    urgency = 'medium';
    reasoning = `${edgeSize.toFixed(1)}% edge at T-${hoursToGame.toFixed(0)}h. Bet 40% now, 60% at T-6h for value/info balance.`;
  } else if (edgeSize > 3) {
    // Moderate edge
    if (hoursToGame > 12) {
      action = 'WAIT';
      urgency = 'low';
      reasoning = `${edgeSize.toFixed(1)}% edge — moderate. Line may improve with public money or worsen with sharps. Monitor.`;
    } else {
      action = 'BET_NOW';
      urgency = 'medium';
      reasoning = `${edgeSize.toFixed(1)}% edge within 12h — liquidity is good, lock it in.`;
    }
  } else {
    // Small edge
    action = 'LEAN';
    urgency = 'low';
    reasoning = `${edgeSize.toFixed(1)}% edge is thin. Only bet if part of larger portfolio diversification.`;
  }
  
  return {
    action,
    urgency,
    reasoning,
    currentEdge: edgeSize,
    projectedEdgeAtGame: parseFloat(projectedEdgeAtGameTime.toFixed(1)),
    decayRate: parseFloat(projectedDecayPerHour.toFixed(3)),
    hoursToGame: parseFloat(hoursToGame.toFixed(1)),
    window: window.name,
    phase: window.phase,
    marketType,
    evAnalysis: {
      evBetNow: parseFloat(evNow.toFixed(1)),
      evBetMidway: parseFloat(evMidway.toFixed(1)),
      evAtGameTime: parseFloat(evGameTime.toFixed(1)),
      optimalBetTime: evNow > evMidway ? 'NOW' : evMidway > evGameTime ? 'MIDWAY' : 'GAME_TIME',
    },
  };
}

// ==================== PORTFOLIO TIMING OPTIMIZER ====================

/**
 * Generate full portfolio timing optimization across all OD plays
 */
function optimizePortfolioBetTiming(bettingCard) {
  if (!bettingCard || !bettingCard.plays) return { error: 'No betting card data' };
  
  const now = new Date();
  const results = {
    timestamp: now.toISOString(),
    summary: {
      totalPlays: 0,
      betNow: 0,
      scaleIn: 0,
      wait: 0,
      lean: 0,
      pass: 0,
    },
    urgentBets: [],      // Must bet NOW
    scaleInBets: [],     // Bet partial now, more later
    waitBets: [],        // Better value later
    leanBets: [],        // Small edge, only if diversifying
    passBets: [],        // Edge gone or never existed
    gameTimelines: {},   // Per-game timeline of when to bet what
  };
  
  for (const play of bettingCard.plays) {
    const gameKey = play.gameKey || `${play.away}@${play.home}`;
    
    // Find game time from schedule
    let gameTime = null;
    for (const day of [OD_SCHEDULE.day1, OD_SCHEDULE.day2]) {
      const game = day.games.find(g => 
        (g.away === play.away && g.home === play.home) ||
        `${g.away}@${g.home}` === gameKey
      );
      if (game) { gameTime = game.time; break; }
    }
    
    if (!gameTime) continue;
    
    // Determine market type from play
    let marketType = 'moneyline';
    const betType = (play.type || play.betType || play.market || '').toLowerCase();
    if (betType.includes('f5') || betType.includes('first 5')) marketType = 'f5';
    else if (betType.includes('f3') || betType.includes('first 3')) marketType = 'f3';
    else if (betType.includes('f7') || betType.includes('first 7')) marketType = 'f7';
    else if (betType.includes('total') || betType.includes('over') || betType.includes('under')) marketType = 'totals';
    else if (betType.includes('run line') || betType.includes('spread')) marketType = 'runline';
    else if (betType.includes('nrfi') || betType.includes('yrfi')) marketType = 'nrfi';
    else if (betType.includes('k prop') || betType.includes('strikeout')) marketType = 'kprop';
    else if (betType.includes('outs') || betType.includes('innings')) marketType = 'outsprop';
    else if (betType.includes('team total') || betType.includes('tt')) marketType = 'teamtotal';
    
    const rec = getTimingRecommendation({ ...play, marketType }, gameTime);
    
    const enrichedPlay = {
      ...play,
      gameKey,
      gameTime,
      timing: rec,
    };
    
    results.summary.totalPlays++;
    
    switch (rec.action) {
      case 'BET_NOW':
        results.summary.betNow++;
        results.urgentBets.push(enrichedPlay);
        break;
      case 'SCALE_IN':
        results.summary.scaleIn++;
        results.scaleInBets.push(enrichedPlay);
        break;
      case 'WAIT':
        results.summary.wait++;
        results.waitBets.push(enrichedPlay);
        break;
      case 'LEAN':
        results.summary.lean++;
        results.leanBets.push(enrichedPlay);
        break;
      case 'PASS':
        results.summary.pass++;
        results.passBets.push(enrichedPlay);
        break;
    }
    
    // Build per-game timeline
    if (!results.gameTimelines[gameKey]) {
      results.gameTimelines[gameKey] = {
        gameTime,
        window: rec.window,
        hoursToGame: rec.hoursToGame,
        bets: [],
      };
    }
    results.gameTimelines[gameKey].bets.push({
      type: betType || marketType,
      edge: rec.currentEdge,
      action: rec.action,
      urgency: rec.urgency,
      reasoning: rec.reasoning,
    });
  }
  
  // Sort urgent bets by edge (highest first)
  results.urgentBets.sort((a, b) => (b.timing.currentEdge || 0) - (a.timing.currentEdge || 0));
  results.scaleInBets.sort((a, b) => (b.timing.currentEdge || 0) - (a.timing.currentEdge || 0));
  
  return results;
}

// ==================== LINE MOVEMENT ANALYSIS ====================

/**
 * Analyze line movement from line change tracker and generate insights
 */
function analyzeLineMovement() {
  if (!odLineTracker) return { error: 'Line tracker not loaded' };
  
  let changes;
  try {
    changes = odLineTracker.trackChanges ? odLineTracker.trackChanges() : 
              odLineTracker.getChanges ? odLineTracker.getChanges() : null;
  } catch(e) {
    changes = null;
  }
  
  if (!changes) return { error: 'No line change data available' };
  
  const insights = {
    timestamp: new Date().toISOString(),
    sharpMoves: [],     // Lines moving toward our model (sharp money agrees with us)
    publicMoves: [],    // Lines moving away from our model (public money = edge growing)
    staleLines: [],     // Lines that haven't moved (possible steam opportunity)
    bigMoves: [],       // Significant line movement (>10 cent ML or >0.5 total)
    recommendations: [],
  };
  
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (!change) continue;
      
      const mlMove = Math.abs(change.homeMLChange || change.mlChange || 0);
      const totalMove = Math.abs(change.totalChange || 0);
      
      if (mlMove > 10 || totalMove > 0.5) {
        insights.bigMoves.push({
          game: change.game || change.gameKey,
          mlMove: change.homeMLChange || change.mlChange || 0,
          totalMove: change.totalChange || 0,
          direction: mlMove > 10 ? 'ML shifted significantly' : 'Total moved significantly',
          implication: 'Recalculate edge — line has moved enough to change bet sizing',
        });
      }
    }
  }
  
  return insights;
}

// ==================== COMPREHENSIVE TIMING REPORT ====================

/**
 * Generate the full "When to Bet" report for Opening Day
 */
function generateTimingReport(mlb) {
  const now = new Date();
  const report = {
    timestamp: now.toISOString(),
    title: '🎯 OD Bet Timing Optimizer',
    subtitle: 'When to pull the trigger on each play',
    
    // Time analysis
    timeToOD1: null,
    timeToOD2: null,
    currentPhase: null,
    
    // Market-by-market timing
    marketTiming: {},
    
    // Urgency tiers
    tiers: {
      CRITICAL: [],   // Bet in next 2 hours or edge dies
      HIGH: [],       // Bet today — edge decaying
      MEDIUM: [],     // Can wait 12-24h but shouldn't wait longer
      LOW: [],        // Props/NRFI — wait for lineups
      MONITOR: [],    // Watch for line movement
    },
    
    // Overall strategy
    strategy: {},
    
    // Line movement summary
    lineMovement: analyzeLineMovement(),
  };
  
  // Calculate time to OD
  const od1Start = new Date(OD_SCHEDULE.day1.firstPitch);
  const od2Start = new Date(OD_SCHEDULE.day2.firstPitch);
  const hoursToOD1 = (od1Start - now) / (1000 * 60 * 60);
  const hoursToOD2 = (od2Start - now) / (1000 * 60 * 60);
  
  report.timeToOD1 = {
    hours: parseFloat(hoursToOD1.toFixed(1)),
    display: hoursToOD1 > 24 ? `${(hoursToOD1 / 24).toFixed(1)} days` : `${hoursToOD1.toFixed(1)} hours`,
    window: getTimeWindow(OD_SCHEDULE.day1.firstPitch),
  };
  report.timeToOD2 = {
    hours: parseFloat(hoursToOD2.toFixed(1)),
    display: hoursToOD2 > 24 ? `${(hoursToOD2 / 24).toFixed(1)} days` : `${hoursToOD2.toFixed(1)} hours`,
    window: getTimeWindow(OD_SCHEDULE.day2.firstPitch),
  };
  
  // Determine current phase
  if (hoursToOD1 > 48) {
    report.currentPhase = {
      name: 'Pre-Opening',
      description: 'Lines not yet posted or just posted. Best time for early-bird sharp plays.',
      strategy: 'Scout lines, identify gross mispricings, hold cash for later',
    };
  } else if (hoursToOD1 > 24) {
    report.currentPhase = {
      name: 'Opening Window',
      description: 'Lines are fresh. Sharps haven\'t fully moved them yet.',
      strategy: 'BET high-conviction plays now. ML and totals edges are at their WIDEST. Scale in on moderate edges.',
    };
  } else if (hoursToOD1 > 12) {
    report.currentPhase = {
      name: 'Sharp Window',
      description: 'Sharp money is flowing. Edges are shrinking on main markets.',
      strategy: 'BET remaining ML/totals plays NOW. Props and NRFI can still wait. Monitor for new edges from line movement.',
    };
  } else if (hoursToOD1 > 6) {
    report.currentPhase = {
      name: 'Transition Window',
      description: 'Best balance of edge + liquidity. Limits are higher, edges still exist.',
      strategy: 'BET everything except NRFI. This is the sweet spot for most markets.',
    };
  } else if (hoursToOD1 > 2) {
    report.currentPhase = {
      name: 'Public Window',
      description: 'Public money flowing. Can create reverse edges on ML.',
      strategy: 'BET NRFI and remaining props. Watch for public money creating new ML edges.',
    };
  } else {
    report.currentPhase = {
      name: 'Lineup Window',
      description: 'Lineups confirmed. Final sharp adjustments.',
      strategy: 'BET any remaining plays. Verify lineups match model assumptions. Final NRFI/prop bets.',
    };
  }
  
  // Market-by-market timing advice
  const marketTypes = ['moneyline', 'totals', 'f5', 'f3', 'f7', 'runline', 'kprop', 'outsprop', 'nrfi', 'teamtotal'];
  
  for (const mt of marketTypes) {
    const decay = DECAY_RATES[mt] || DECAY_RATES.moneyline;
    let optimalWindowStart, optimalWindowEnd, advice;
    
    switch (mt) {
      case 'moneyline':
        optimalWindowStart = 36;
        optimalWindowEnd = 12;
        advice = 'ML edges decay FASTEST. Bet high-conviction ML plays as soon as lines are posted. Don\'t wait for "better" timing — you\'re losing edge every hour.';
        break;
      case 'totals':
        optimalWindowStart = 24;
        optimalWindowEnd = 6;
        advice = 'Totals edges hold moderately well. Ideal to bet after weather confirmation but before sharp window closes.';
        break;
      case 'f5':
      case 'f3':
      case 'f7':
        optimalWindowStart = 18;
        optimalWindowEnd = 4;
        advice = `${mt.toUpperCase()} markets are LESS liquid — edges hold longer. Best to bet after pitcher confirmation but still with 4+ hours to spare.`;
        break;
      case 'runline':
        optimalWindowStart = 24;
        optimalWindowEnd = 6;
        advice = 'Run lines follow ML timing but with slower decay. Bet alongside ML plays.';
        break;
      case 'kprop':
      case 'outsprop':
        optimalWindowStart = 6;
        optimalWindowEnd = 1;
        advice = `${mt === 'kprop' ? 'K' : 'Outs'} props hold edge LONGEST. Wait for lineup confirmation for maximum accuracy. Bet 2-6h pre-game.`;
        break;
      case 'nrfi':
        optimalWindowStart = 4;
        optimalWindowEnd = 0.5;
        advice = 'NRFI is extremely lineup-dependent. WAIT for confirmed lineups and leadoff hitters. Bet 1-3h pre-game for optimal accuracy.';
        break;
      case 'teamtotal':
        optimalWindowStart = 18;
        optimalWindowEnd = 4;
        advice = 'Team totals are a SOFTER market — edges can last longer than game totals. Bet after pitcher confirmation.';
        break;
      default:
        optimalWindowStart = 24;
        optimalWindowEnd = 6;
        advice = 'Standard timing applies.';
    }
    
    report.marketTiming[mt] = {
      decayRate: decay,
      optimalBetWindow: `T-${optimalWindowStart}h to T-${optimalWindowEnd}h`,
      optimalWindowStart,
      optimalWindowEnd,
      advice,
      currentStatus: hoursToOD1 > optimalWindowStart ? 'EARLY' :
                     hoursToOD1 >= optimalWindowEnd ? 'OPTIMAL' :
                     hoursToOD1 > 0 ? 'LATE' : 'GAME_STARTED',
    };
  }
  
  // Build urgency tiers from OD betting card
  const allGames = [...OD_SCHEDULE.day1.games, ...OD_SCHEDULE.day2.games];
  
  for (const game of allGames) {
    const gameKey = `${game.away}@${game.home}`;
    const hoursToGame = (new Date(game.time) - now) / (1000 * 60 * 60);
    
    // ML timing
    if (hoursToGame < 12 && hoursToGame > 0) {
      report.tiers.CRITICAL.push({
        game: gameKey,
        market: 'ML + Totals',
        reason: `Only ${hoursToGame.toFixed(0)}h to first pitch — sharp window closing`,
        action: 'Bet NOW if edge > 3%',
      });
    } else if (hoursToGame < 24 && hoursToGame > 12) {
      report.tiers.HIGH.push({
        game: gameKey,
        market: 'ML + Totals',
        reason: `${hoursToGame.toFixed(0)}h to first pitch — in sharp window`,
        action: 'Bet high-conviction plays today',
      });
    } else if (hoursToGame < 36 && hoursToGame > 24) {
      report.tiers.MEDIUM.push({
        game: gameKey,
        market: 'ML + Totals + Run Line',
        reason: `${hoursToGame.toFixed(0)}h to first pitch — opening window`,
        action: 'Scale in: 40% now, 60% at T-6h',
      });
    }
    
    // Props timing — always wait for lineups
    if (hoursToGame > 6) {
      report.tiers.LOW.push({
        game: gameKey,
        market: 'K Props + Outs Props + NRFI',
        reason: 'Props hold edge well — wait for lineup confirmation',
        action: 'Bet 2-6h pre-game after lineups posted',
      });
    }
  }
  
  // Overall strategy
  report.strategy = {
    phase: report.currentPhase.name,
    immediate: [],
    today: [],
    tomorrow: [],
    gameDay: [],
  };
  
  if (hoursToOD1 > 24) {
    report.strategy.immediate = [
      'Review full OD betting card for any changes since last check',
      'Check if books have posted lines — odds monitor should detect automatically',
      'Place SMASH-tier ML bets if lines are live (highest decay rate = bet early)',
    ];
    report.strategy.today = [
      'Place all high-conviction ML bets (edge > 5%)',
      'Place totals bets for outdoor games (weather impact locked in)',
      'Scale into moderate ML edges (3-5%)',
    ];
    report.strategy.tomorrow = [
      'T-12h: Place remaining ML, totals, run line, F5/F7 bets',
      'T-6h: Place team total bets',
      'T-3h: Place K props and outs props (after lineups)',
      'T-2h: Place NRFI/YRFI bets (after lineup confirmation)',
      'T-1h: Final check — any new edges from late line movement?',
    ];
    report.strategy.gameDay = [
      'Verify all lineups match model assumptions',
      'Check weather updates for outdoor games',
      'Monitor for scratched starters (HUGE edge shift if ace scratched)',
      'Place final props after all lineups confirmed',
      'Activate live tracker for real-time P&L monitoring',
    ];
  } else if (hoursToOD1 > 12) {
    report.strategy.immediate = [
      '🚨 SHARP WINDOW ACTIVE — ML edges shrinking by ~0.25%/hr',
      'Place ALL remaining ML bets NOW',
      'Place totals bets for games with confirmed weather',
    ];
    report.strategy.today = [
      'Place F5/F3/F7 bets',
      'Place run line bets',
      'Place team total bets',
      'Monitor line movement for new edges',
    ];
    report.strategy.gameDay = [
      'T-6h: Props and NRFI',
      'T-2h: Final lineup-dependent bets',
      'Monitor for scratched starters',
    ];
  } else {
    report.strategy.immediate = [
      '🔥 GAME DAY APPROACHING — Place all remaining bets',
      'Props, NRFI, and team totals are the priority NOW',
      'Verify lineups',
    ];
  }
  
  return report;
}

// ==================== QUICK TIMING CHECK ====================

/**
 * Quick check: should I bet this play NOW?
 */
function shouldBetNow(play, gameTimeStr) {
  const rec = getTimingRecommendation(play, gameTimeStr);
  return {
    answer: rec.action === 'BET_NOW' || rec.action === 'SCALE_IN',
    action: rec.action,
    urgency: rec.urgency,
    reasoning: rec.reasoning,
    hoursToGame: rec.hoursToGame,
    currentEdge: rec.currentEdge,
    projectedEdge: rec.projectedEdgeAtGame,
  };
}

// Load state on module init
loadState();

module.exports = {
  recordSnapshot,
  calcDecayTrajectory,
  getTimingRecommendation,
  optimizePortfolioBetTiming,
  analyzeLineMovement,
  generateTimingReport,
  shouldBetNow,
  getTimeWindow,
  impliedProb,
  calcEdge,
  OD_SCHEDULE,
  DECAY_RATES,
  WINDOWS,
};
