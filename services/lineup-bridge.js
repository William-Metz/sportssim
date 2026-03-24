/**
 * Multi-Source Lineup Bridge — SportsSim v108.0
 * ===============================================
 * THE CRITICAL BRIDGE: Unifies ALL lineup sources into one pipeline
 * that feeds directly into asyncPredict() for maximum accuracy.
 * 
 * Source Priority (highest to lowest):
 *   1. Manual Overrides (lineup-overrides.json) — user/admin-set lineups
 *   2. MLB Stats API (statsapi.mlb.com) — official, authoritative
 *   3. ESPN Game Summary — backup, sometimes delays
 *   4. Default assumptions — star players expected in lineup
 * 
 * THE MONEY ANGLE:
 *   - Without real lineups: platoon splits use team averages (±2-3% error)
 *   - Without real lineups: catcher framing uses expected primary (wrong 15% of games)
 *   - Without real lineups: star player rest days not detected (±0.3 runs)
 *   - WITH real lineups: all signals fire on real data = sharper predictions
 *   - Lines move 10-30 cents on lineup drops — we want to re-price FIRST
 *
 * This service replaces lineup-fetcher.js's getLineupAdjustments() with a 
 * multi-source version that tries MLB Stats API first, then falls back.
 */

const fs = require('fs');
const path = require('path');

// ==================== DEPENDENCIES ====================

let mlbStatsLineups = null;
let lineupFetcher = null;
let catcherFramingService = null;
let platoonService = null;

// Lazy-load dependencies
function loadDeps() {
  if (!mlbStatsLineups) {
    try { mlbStatsLineups = require('./mlb-stats-lineups'); } catch (e) {}
  }
  if (!lineupFetcher) {
    try { lineupFetcher = require('./lineup-fetcher'); } catch (e) {}
  }
  if (!catcherFramingService) {
    try { catcherFramingService = require('./catcher-framing'); } catch (e) {}
  }
  if (!platoonService) {
    try { platoonService = require('./platoon-splits'); } catch (e) {}
  }
}

// Star players for detecting rest days (imported from lineup-fetcher)
let STAR_PLAYERS = {};
try { STAR_PLAYERS = require('./lineup-fetcher').STAR_PLAYERS || {}; } catch (e) {}

const OVERRIDE_FILE = path.join(__dirname, 'lineup-overrides.json');
const CATCHER_FRAMING = {};
try { Object.assign(CATCHER_FRAMING, require('./catcher-framing').SAVANT_FRAMING_2024 || {}); } catch (e) {}
const TEAM_CATCHERS = {};
try { Object.assign(TEAM_CATCHERS, require('./catcher-framing').TEAM_PRIMARY_CATCHERS_2026 || {}); } catch (e) {}

// ==================== SOURCE TRACKING ====================

// Track which source provided lineup for each game
let sourceLog = {}; // gameKey → { source, timestamp, batterCount }

// ==================== CORE: MULTI-SOURCE FETCH ====================

/**
 * Get lineup adjustments for a matchup from best available source.
 * This is the DROP-IN REPLACEMENT for lineupFetcher.getLineupAdjustments()
 * 
 * Returns the SAME interface as lineup-fetcher.js:
 *   { awayRunAdj, homeRunAdj, hasData, awayLineup, homeLineup, details }
 * 
 * But backed by multi-source data with intelligent fallback.
 */
async function getLineupAdjustments(awayAbbr, homeAbbr, dateStr = null) {
  loadDeps();
  
  const gameKey = `${awayAbbr}@${homeAbbr}`;
  
  // === SOURCE 1: Manual Overrides (highest priority) ===
  const override = loadOverride(awayAbbr, homeAbbr);
  if (override) {
    const result = buildAdjustments(override.away, override.home, awayAbbr, homeAbbr, 'manual_override');
    sourceLog[gameKey] = { source: 'manual_override', timestamp: Date.now(), batterCount: (override.away?.batters?.length || 0) + (override.home?.batters?.length || 0) };
    return result;
  }
  
  // === SOURCE 2: MLB Stats API (primary) ===
  if (mlbStatsLineups) {
    try {
      const matchup = await mlbStatsLineups.getMatchupLineup(awayAbbr, homeAbbr, dateStr);
      if (matchup && matchup.hasConfirmedLineup) {
        const awayLineup = normalizeMLBStatsLineup(matchup.awayLineup, awayAbbr);
        const homeLineup = normalizeMLBStatsLineup(matchup.homeLineup, homeAbbr);
        
        if (awayLineup.confirmed || homeLineup.confirmed) {
          const result = buildAdjustments(awayLineup, homeLineup, awayAbbr, homeAbbr, 'mlb-stats-api');
          
          // Also pass through opposing pitcher hand for platoon calculation
          if (matchup.homeLineup?.startingPitcher?.throws) {
            result._opposingPitcherHand = {
              awayFaces: matchup.homeLineup.startingPitcher.throws,
              homeFaces: matchup.awayLineup?.startingPitcher?.throws || null,
            };
          }
          
          sourceLog[gameKey] = { 
            source: 'mlb-stats-api', 
            timestamp: Date.now(), 
            batterCount: (awayLineup.batters?.length || 0) + (homeLineup.batters?.length || 0),
            awayConfirmed: awayLineup.confirmed,
            homeConfirmed: homeLineup.confirmed,
          };
          return result;
        }
      }
    } catch (e) {
      // MLB Stats API failed — fall through to ESPN
      console.error(`[LineupBridge] MLB Stats API failed for ${gameKey}: ${e.message}`);
    }
  }
  
  // === SOURCE 3: ESPN (backup) ===
  if (lineupFetcher) {
    try {
      const espnResult = await lineupFetcher.getLineupAdjustments(awayAbbr, homeAbbr, dateStr);
      if (espnResult && espnResult.hasData) {
        sourceLog[gameKey] = { source: 'espn', timestamp: Date.now() };
        espnResult._source = 'espn';
        return espnResult;
      }
    } catch (e) {
      console.error(`[LineupBridge] ESPN failed for ${gameKey}: ${e.message}`);
    }
  }
  
  // === SOURCE 4: Default (no lineup data) ===
  sourceLog[gameKey] = { source: 'default', timestamp: Date.now(), batterCount: 0 };
  return {
    awayRunAdj: 0,
    homeRunAdj: 0,
    hasData: false,
    _source: 'default',
    details: {
      note: 'No lineup data available from any source',
      sourcesTried: ['manual_override', 'mlb-stats-api', 'espn'],
    },
  };
}

// ==================== NORMALIZATION ====================

/**
 * Normalize MLB Stats API lineup data to the format lineup-fetcher uses
 */
function normalizeMLBStatsLineup(lineupData, teamAbbr) {
  if (!lineupData) return { confirmed: false, batters: [], catcher: null };
  
  return {
    confirmed: lineupData.confirmed || false,
    batters: (lineupData.battingOrder || []).map((b, i) => ({
      name: b.name,
      position: b.position || '?',
      bats: b.bats || 'R',
      order: b.order || i + 1,
    })),
    catcher: lineupData.catcher || null,
    teamAbbr,
  };
}

// ==================== OVERRIDES ====================

function loadOverride(awayAbbr, homeAbbr) {
  try {
    if (!fs.existsSync(OVERRIDE_FILE)) return null;
    const overrides = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
    
    const keys = [
      `${awayAbbr}@${homeAbbr}`,
      `${awayAbbr}@${homeAbbr}`.toUpperCase(),
    ];
    
    for (const key of keys) {
      if (overrides[key]) return overrides[key];
    }
  } catch (e) { /* no overrides */ }
  return null;
}

// ==================== ADJUSTMENT CALCULATION ====================

/**
 * Build prediction adjustments from normalized lineup data.
 * Calculates: star player presence, platoon advantage, catcher framing impact.
 */
function buildAdjustments(awayLineup, homeLineup, awayAbbr, homeAbbr, source) {
  let awayRunAdj = 0;
  let homeRunAdj = 0;
  const notes = [];
  
  // --- Star player impact ---
  const awayStarImpact = calculateStarImpact(awayLineup, awayAbbr);
  const homeStarImpact = calculateStarImpact(homeLineup, homeAbbr);
  awayRunAdj += awayStarImpact.adjustment;
  homeRunAdj += homeStarImpact.adjustment;
  if (awayStarImpact.notes.length) notes.push(...awayStarImpact.notes);
  if (homeStarImpact.notes.length) notes.push(...homeStarImpact.notes);
  
  // --- Catcher framing ---
  const awayCatcherFrame = getCatcherFraming(awayLineup, awayAbbr);
  const homeCatcherFrame = getCatcherFraming(homeLineup, homeAbbr);
  
  // Good catcher framing reduces OPPONENT's runs
  // So home catcher framing affects AWAY team's run adj (reduces their runs)
  awayRunAdj += homeCatcherFrame.runsPerGame; // negative = good framer = fewer away runs
  homeRunAdj += awayCatcherFrame.runsPerGame; // negative = good framer = fewer home runs
  
  // --- Platoon calculation (if we have bat side data) ---
  // This is handled inside predict() via platoon-splits service, so we don't double-count.
  // But we calculate it here for the details/notes.
  let platoonInfo = null;
  if (awayLineup?.batters?.length >= 9 && homeLineup?.batters?.length >= 9) {
    platoonInfo = calculatePlatoonSummary(awayLineup, homeLineup);
    if (platoonInfo.note) notes.push(platoonInfo.note);
  }
  
  // Cap adjustments
  awayRunAdj = Math.max(-0.5, Math.min(0.5, awayRunAdj));
  homeRunAdj = Math.max(-0.5, Math.min(0.5, homeRunAdj));
  
  return {
    awayRunAdj: +awayRunAdj.toFixed(3),
    homeRunAdj: +homeRunAdj.toFixed(3),
    hasData: (awayLineup?.confirmed || homeLineup?.confirmed) || false,
    _source: source,
    awayLineup: formatLineupForOutput(awayLineup, awayAbbr),
    homeLineup: formatLineupForOutput(homeLineup, homeAbbr),
    details: {
      awayStars: awayStarImpact.starsPresent,
      homeStars: homeStarImpact.starsPresent,
      awayCatcher: awayCatcherFrame,
      homeCatcher: homeCatcherFrame,
      platoon: platoonInfo,
      notes,
      source,
    },
  };
}

/**
 * Calculate star player presence impact
 */
function calculateStarImpact(lineup, teamAbbr) {
  let adjustment = 0;
  const notes = [];
  let starsExpected = 0;
  let starsPresent = 0;
  
  if (!lineup || !lineup.batters || lineup.batters.length === 0) {
    return { adjustment: 0, starsExpected: 0, starsPresent: 0, notes: [] };
  }
  
  const lineupNames = lineup.batters.map(b => b.name);
  
  for (const [name, info] of Object.entries(STAR_PLAYERS)) {
    if (info.team !== teamAbbr) continue;
    starsExpected++;
    
    const inLineup = lineupNames.some(n => 
      n === name || 
      n.includes(name.split(' ').pop()) || 
      name.includes(n.split(' ').pop())
    );
    
    if (inLineup) {
      starsPresent++;
    } else if (lineup.confirmed) {
      // Star CONFIRMED out = negative adjustment
      adjustment -= info.impact * 0.5;
      notes.push(`⚠️ ${name} OUT of ${teamAbbr} lineup (-${(info.impact * 0.5).toFixed(2)} runs)`);
    }
  }
  
  return { adjustment, starsExpected, starsPresent, notes };
}

/**
 * Get catcher framing impact for a lineup
 */
function getCatcherFraming(lineup, teamAbbr) {
  // If we have a confirmed catcher from the lineup
  let catcherName = null;
  
  if (lineup?.catcher?.name) {
    catcherName = lineup.catcher.name;
  } else {
    // Fall back to expected team primary catcher
    catcherName = TEAM_CATCHERS[teamAbbr] || null;
  }
  
  if (!catcherName) {
    return { catcher: 'Unknown', framingRuns: 0, runsPerGame: 0, tier: 'unknown' };
  }
  
  const framingData = CATCHER_FRAMING[catcherName] || null;
  
  if (!framingData) {
    return { catcher: catcherName, framingRuns: 0, runsPerGame: 0, tier: 'unrated' };
  }
  
  // Convert season framing runs to per-game impact
  // Negative runsPerGame = good framer = opponent scores less
  const runsPerGame = -(framingData.framingRuns / 162) * 0.5; // 50% weight
  
  return {
    catcher: catcherName,
    framingRuns: framingData.framingRuns,
    runsPerGame: +runsPerGame.toFixed(4),
    tier: framingData.framingRuns >= 10 ? 'elite' :
          framingData.framingRuns >= 5 ? 'good' :
          framingData.framingRuns >= 0 ? 'average' :
          framingData.framingRuns >= -5 ? 'below_average' : 'poor',
    source: lineup?.catcher?.name ? 'confirmed' : 'expected_primary',
  };
}

/**
 * Calculate platoon summary for notes (actual platoon adjustment handled by platoon-splits service)
 */
function calculatePlatoonSummary(awayLineup, homeLineup) {
  const awaySP = homeLineup?.catcher ? null : null; // We'd need SP hand here
  const homeSP = awayLineup?.catcher ? null : null;
  
  // Count L/R/S batters
  const awayBats = { L: 0, R: 0, S: 0 };
  const homeBats = { L: 0, R: 0, S: 0 };
  
  for (const b of (awayLineup?.batters || [])) {
    awayBats[b.bats || 'R']++;
  }
  for (const b of (homeLineup?.batters || [])) {
    homeBats[b.bats || 'R']++;
  }
  
  const awayLefty = ((awayBats.L + awayBats.S * 0.5) / (awayBats.L + awayBats.R + awayBats.S)) * 100;
  const homeLefty = ((homeBats.L + homeBats.S * 0.5) / (homeBats.L + homeBats.R + homeBats.S)) * 100;
  
  return {
    awayBatSides: awayBats,
    homeBatSides: homeBats,
    awayLeftyPct: +awayLefty.toFixed(1),
    homeLeftyPct: +homeLefty.toFixed(1),
    note: awayLefty > 60 ? `${awayLineup?.teamAbbr || 'Away'} lineup is ${awayLefty.toFixed(0)}% lefty — vulnerable to LHP` :
          homeLefty > 60 ? `${homeLineup?.teamAbbr || 'Home'} lineup is ${homeLefty.toFixed(0)}% lefty — vulnerable to LHP` : null,
  };
}

/**
 * Format lineup data for API output
 */
function formatLineupForOutput(lineup, teamAbbr) {
  if (!lineup || !lineup.confirmed) return null;
  
  return {
    confirmed: lineup.confirmed,
    source: lineup.source || 'unknown',
    battingOrder: (lineup.batters || []).map(b => ({
      name: b.name,
      position: b.position,
      bats: b.bats,
      order: b.order,
      isStar: !!STAR_PLAYERS[b.name],
      impact: STAR_PLAYERS[b.name]?.impact || 0,
    })),
    catcher: lineup.catcher,
    starsInLineup: (lineup.batters || []).filter(b => STAR_PLAYERS[b.name]).length,
  };
}

// ==================== MULTI-SOURCE STATUS ====================

/**
 * Compare lineups across all sources for verification
 */
async function compareAllSources(awayAbbr, homeAbbr, dateStr = null) {
  loadDeps();
  
  const results = {
    game: `${awayAbbr}@${homeAbbr}`,
    date: dateStr || new Date().toISOString().split('T')[0],
    sources: {},
    agreement: null,
    recommendation: null,
  };
  
  // Override
  const override = loadOverride(awayAbbr, homeAbbr);
  results.sources.override = override ? {
    available: true,
    awayBatters: override.away?.batters?.length || 0,
    homeBatters: override.home?.batters?.length || 0,
  } : { available: false };
  
  // MLB Stats API
  if (mlbStatsLineups) {
    try {
      const matchup = await mlbStatsLineups.getMatchupLineup(awayAbbr, homeAbbr, dateStr);
      results.sources.mlbStats = matchup ? {
        available: matchup.hasConfirmedLineup,
        awayConfirmed: matchup.awayLineup?.confirmed || false,
        homeConfirmed: matchup.homeLineup?.confirmed || false,
        awayBatters: matchup.awayLineup?.battingOrder?.length || 0,
        homeBatters: matchup.homeLineup?.battingOrder?.length || 0,
        awayPitcher: matchup.awayLineup?.startingPitcher?.name || matchup.probablePitchers?.away || 'TBD',
        homePitcher: matchup.homeLineup?.startingPitcher?.name || matchup.probablePitchers?.home || 'TBD',
      } : { available: false };
    } catch (e) {
      results.sources.mlbStats = { available: false, error: e.message };
    }
  }
  
  // ESPN
  if (lineupFetcher) {
    try {
      const espn = await lineupFetcher.getLineupAdjustments(awayAbbr, homeAbbr, dateStr);
      results.sources.espn = {
        available: espn?.hasData || false,
        awayRunAdj: espn?.awayRunAdj || 0,
        homeRunAdj: espn?.homeRunAdj || 0,
      };
    } catch (e) {
      results.sources.espn = { available: false, error: e.message };
    }
  }
  
  // Determine agreement
  const sourcesWithData = Object.entries(results.sources)
    .filter(([k, v]) => v.available)
    .map(([k]) => k);
  
  results.agreement = {
    sourcesWithData: sourcesWithData.length,
    sourceNames: sourcesWithData,
  };
  
  results.recommendation = sourcesWithData.length === 0 ? 
    'No lineup data available — predictions using defaults' :
    `Using ${sourcesWithData[0]} as primary source (${sourcesWithData.length} source(s) available)`;
  
  return results;
}

/**
 * Get full pipeline status
 */
function getStatus() {
  loadDeps();
  
  return {
    service: 'lineup-bridge',
    version: '1.0',
    sources: {
      mlbStatsAPI: {
        available: !!mlbStatsLineups,
        status: mlbStatsLineups ? mlbStatsLineups.getStatus() : 'not loaded',
      },
      espn: {
        available: !!lineupFetcher,
        status: lineupFetcher ? lineupFetcher.getStatus() : 'not loaded',
      },
      overrides: {
        available: fs.existsSync(OVERRIDE_FILE),
        overrideCount: (() => {
          try {
            const o = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
            return Object.keys(o).length;
          } catch (e) { return 0; }
        })(),
      },
      catcherFraming: {
        available: !!catcherFramingService || Object.keys(CATCHER_FRAMING).length > 0,
        catcherCount: Object.keys(CATCHER_FRAMING).length,
      },
    },
    recentQueries: Object.entries(sourceLog).slice(-10).map(([k, v]) => ({
      game: k,
      source: v.source,
      timestamp: new Date(v.timestamp).toISOString(),
      batters: v.batterCount || 0,
    })),
    note: 'Priority: override → mlb-stats-api → espn → default',
  };
}

/**
 * Get source log for debugging
 */
function getSourceLog() {
  return sourceLog;
}

module.exports = {
  getLineupAdjustments,
  compareAllSources,
  getStatus,
  getSourceLog,
  clearSourceLog: () => { sourceLog = {}; },
};
