// services/od-pitcher-sync.js — OD Pitcher Sync v89.0
// ====================================================
// CRITICAL: Auto-reconciles ESPN live probable pitchers with our static OD model.
//
// WHY THIS EXISTS:
//   - Our static model has "Gerrit Cole" for NYY@SF Day 2
//   - ESPN now shows "Cam Schlittler" (rookie!) as the confirmed starter
//   - If we bet based on Cole starting but Schlittler starts, our edge is GONE
//   - Multiple Day 2 home starters are still TBD on ESPN
//   - Teams can change starters up until game day
//
// WHAT IT DOES:
//   1. Pulls REAL probable pitchers from ESPN schedule API
//   2. Compares every game to our static mlb-opening-day.js data
//   3. Detects CHANGES, UPGRADES, DOWNGRADES, and TBDs
//   4. Auto-creates pitcher profiles for unknown pitchers (with safe defaults)
//   5. Generates impact analysis: how does this change affect our bets?
//   6. Provides a merged schedule with the BEST AVAILABLE pitcher data
//
// AUTO-RUN: Should run every 2 hours starting March 24 through March 27.

const https = require('https');
const fs = require('fs');
const path = require('path');

// Dependencies (safe requires)
let mlbOpeningDay = null;
let mlbSchedule = null;
let pitcherDb = null;
let mlbModel = null;
let pitcherResolver = null;
let statcastService = null;

try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}
try { mlbSchedule = require('./mlb-schedule'); } catch(e) {}
try { pitcherDb = require('../models/mlb-pitchers'); } catch(e) {}
try { mlbModel = require('../models/mlb'); } catch(e) {}
try { pitcherResolver = require('./pitcher-resolver'); } catch(e) {}
try { statcastService = require('./statcast'); } catch(e) {}

// ==================== CACHE ====================
let syncCache = null;
let syncCacheTime = 0;
const SYNC_CACHE_TTL = 10 * 60 * 1000; // 10 min

// History of changes for alerting
const changeHistory = [];

// ==================== PITCHER TIER SYSTEM ====================
// When we encounter a pitcher not in our DB, estimate their quality
// based on available signals (Statcast, spring training, team depth chart position)

const PITCHER_TIERS = {
  ACE: { era: 2.90, kPer9: 10.5, ipPerStart: 6.5, tier: 1 },
  TIER2: { era: 3.40, kPer9: 9.0, ipPerStart: 6.0, tier: 2 },
  TIER3: { era: 4.00, kPer9: 8.0, ipPerStart: 5.5, tier: 3 },
  TIER4: { era: 4.50, kPer9: 7.0, ipPerStart: 5.2, tier: 4 },
  TIER5_REPLACEMENT: { era: 5.00, kPer9: 6.5, ipPerStart: 4.8, tier: 5 },
  ROOKIE_UNKNOWN: { era: 4.80, kPer9: 7.5, ipPerStart: 5.0, tier: 4 },
};

// Known team ace identifiers for context
const TEAM_ACES = {
  NYY: 'Max Fried', BOS: 'Garrett Crochet', TOR: 'Kevin Gausman', // NYY OD starter is Fried per MLB Stats API (Cole is #2)
  BAL: 'Corbin Burnes', TB: 'Drew Rasmussen', CLE: 'Tanner Bibee',
  DET: 'Tarik Skubal', MIN: 'Joe Ryan', CWS: 'Garrett Crochet',
  HOU: 'Framber Valdez', SEA: 'Logan Gilbert', LAA: 'Tyler Anderson',
  TEX: 'Nathan Eovaldi', OAK: 'Luis Severino', KC: 'Cole Ragans',
  ATL: 'Chris Sale', NYM: 'Kodai Senga', PHI: 'Zack Wheeler',
  MIA: 'Sandy Alcantara', WSH: 'MacKenzie Gore', MIL: 'Freddy Peralta',
  CHC: 'Justin Steele', STL: 'Sonny Gray', CIN: 'Hunter Greene',
  PIT: 'Paul Skenes', LAD: 'Tyler Glasnow', SD: 'Dylan Cease',
  SF: 'Logan Webb', ARI: 'Zac Gallen', COL: 'Kyle Freeland',
};

// ==================== CORE SYNC ENGINE ====================

/**
 * Fetch live ESPN starters for OD dates and compare to static model.
 * Returns comprehensive change report.
 */
async function runSync(opts = {}) {
  // Check cache
  if (!opts.forceRefresh && syncCache && (Date.now() - syncCacheTime < SYNC_CACHE_TTL)) {
    return syncCache;
  }

  const startTime = Date.now();
  const result = {
    timestamp: new Date().toISOString(),
    version: '89.0.0',
    daysUntilOD: Math.ceil((new Date('2026-03-26T00:00:00Z') - new Date()) / 86400000),
    espnData: { day1: null, day2: null },
    changes: [],
    alerts: [],
    mergedSchedule: [],
    impactAnalysis: [],
    newPitchers: [],
    summary: {},
  };

  // ==================== FETCH ESPN DATA ====================
  let espnDay1 = null, espnDay2 = null;
  
  if (mlbSchedule) {
    try {
      [espnDay1, espnDay2] = await Promise.all([
        mlbSchedule.getSchedule('2026-03-26'),
        mlbSchedule.getSchedule('2026-03-27'),
      ]);
    } catch (e) {
      result.alerts.push({ 
        level: 'ERROR', 
        msg: `ESPN fetch failed: ${e.message}`,
        action: 'MANUAL CHECK REQUIRED — go to espn.com/mlb/schedule' 
      });
    }
  }

  result.espnData = {
    day1: espnDay1 ? { date: espnDay1.date, games: espnDay1.games?.length || 0 } : null,
    day2: espnDay2 ? { date: espnDay2.date, games: espnDay2.games?.length || 0 } : null,
  };

  // ==================== GET STATIC OD SCHEDULE ====================
  const staticGames = mlbOpeningDay?.getSchedule?.() || mlbOpeningDay?.OPENING_DAY_GAMES || [];
  
  // Build ESPN lookup
  const espnLookup = {};
  for (const schedule of [espnDay1, espnDay2]) {
    if (!schedule?.games) continue;
    for (const g of schedule.games) {
      const key = `${g.awayTeam?.abbr}@${g.homeTeam?.abbr}`;
      espnLookup[key] = {
        date: schedule.date,
        gameTime: g.date,
        awayPitcher: g.awayTeam?.probablePitcher?.name || null,
        homePitcher: g.homeTeam?.probablePitcher?.name || null,
        awayConfirmed: !!g.awayTeam?.confirmedPitcher,
        homeConfirmed: !!g.homeTeam?.confirmedPitcher,
        espnOdds: g.odds || null,
      };
    }
  }

  // ==================== COMPARE & MERGE ====================
  for (const staticGame of staticGames) {
    const key = `${staticGame.away}@${staticGame.home}`;
    const espn = espnLookup[key];
    
    const merged = {
      away: staticGame.away,
      home: staticGame.home,
      day: staticGame.day,
      date: staticGame.date,
      gameTime: espn?.gameTime || null,
      starters: {
        away: { static: staticGame.confirmedStarters?.away, espn: espn?.awayPitcher, espnConfirmed: espn?.awayConfirmed || false },
        home: { static: staticGame.confirmedStarters?.home, espn: espn?.homePitcher, espnConfirmed: espn?.homeConfirmed || false },
      },
      final: { away: null, home: null },
      changes: [],
    };

    // Resolve final starters — prefer ESPN confirmed > ESPN listed > static
    for (const role of ['away', 'home']) {
      const s = merged.starters[role];
      
      if (s.espnConfirmed && s.espn) {
        merged.final[role] = s.espn;
        if (s.static && s.espn !== s.static) {
          const change = {
            game: key,
            day: staticGame.day,
            role,
            team: role === 'away' ? staticGame.away : staticGame.home,
            from: s.static,
            to: s.espn,
            source: 'ESPN_CONFIRMED',
            impact: null, // filled below
          };
          merged.changes.push(change);
          result.changes.push(change);
        }
      } else if (s.espn) {
        merged.final[role] = s.espn;
        if (s.static && s.espn !== s.static) {
          const change = {
            game: key,
            day: staticGame.day,
            role,
            team: role === 'away' ? staticGame.away : staticGame.home,
            from: s.static,
            to: s.espn,
            source: 'ESPN_LISTED',
            impact: null,
          };
          merged.changes.push(change);
          result.changes.push(change);
        }
      } else {
        merged.final[role] = s.static; // ESPN TBD, use our prediction
      }
    }

    result.mergedSchedule.push(merged);
  }

  // ==================== ANALYZE PITCHER CHANGES ====================
  for (const change of result.changes) {
    // Look up both old and new pitchers
    const oldPitcher = pitcherDb?.getPitcherByName?.(change.from);
    const newPitcher = pitcherDb?.getPitcherByName?.(change.to);
    
    // If new pitcher not in DB, create profile
    if (!newPitcher && change.to) {
      const profile = await createUnknownPitcherProfile(change.to, change.team);
      result.newPitchers.push(profile);
      change.newPitcherProfile = profile;
    }

    // Calculate impact
    const oldEra = oldPitcher?.era || 4.5;
    const newEra = newPitcher?.era || (change.newPitcherProfile?.era || 4.8);
    const eraDiff = newEra - oldEra;
    
    // ERA difference translates to roughly that many runs per 9 innings = ~0.6× per game  
    const runsImpact = eraDiff * 0.6; // approximate runs/game difference
    
    let severity = 'LOW';
    if (Math.abs(eraDiff) >= 1.5) severity = 'CRITICAL';
    else if (Math.abs(eraDiff) >= 0.8) severity = 'HIGH';
    else if (Math.abs(eraDiff) >= 0.4) severity = 'MEDIUM';
    
    const isDowngrade = eraDiff > 0.3;
    const isUpgrade = eraDiff < -0.3;
    
    change.impact = {
      oldEra,
      newEra,
      eraDiff: +eraDiff.toFixed(2),
      runsImpact: +runsImpact.toFixed(2),
      severity,
      direction: isDowngrade ? 'DOWNGRADE' : (isUpgrade ? 'UPGRADE' : 'LATERAL'),
      bettingImplication: getBettingImplication(change, eraDiff, runsImpact),
    };

    // Generate alerts for significant changes
    if (severity === 'CRITICAL' || severity === 'HIGH') {
      const teamAce = TEAM_ACES[change.team];
      const isAceLoss = change.from === teamAce;
      
      result.alerts.push({
        level: severity === 'CRITICAL' ? '🚨 CRITICAL' : '⚠️ HIGH',
        game: change.game,
        msg: `${change.team} ${change.role} starter changed: ${change.from} → ${change.to} (ERA ${oldEra.toFixed(2)} → ${newEra.toFixed(2)}, ${change.impact.direction})`,
        action: isDowngrade 
          ? `REVIEW ${change.game} bets — ${change.impact.direction} of ${Math.abs(eraDiff).toFixed(1)} ERA. ${isAceLoss ? 'ACE LOSS! ' : ''}Consider: ${change.role === 'home' ? 'OVER lean, fade home ML' : 'OVER lean, fade away ML'}`
          : `GOOD NEWS: ${change.impact.direction}. Edge may increase on ${change.role === 'home' ? 'home ML, UNDER' : 'away ML, UNDER'}`,
        isAceLoss,
      });
    }

    // Track change history
    changeHistory.push({
      ...change,
      detectedAt: new Date().toISOString(),
    });
  }

  // ==================== IMPACT ANALYSIS ON BETTING CARD ====================
  for (const change of result.changes.filter(c => c.impact.severity !== 'LOW')) {
    const game = change.game;
    const [away, home] = game.split('@');
    
    // Try to run prediction with old vs new pitcher to quantify impact
    let impactDetail = null;
    if (mlbModel && mlbModel.predict) {
      try {
        // Run with correct starters
        const merged = result.mergedSchedule.find(m => `${m.away}@${m.home}` === game);
        if (merged) {
          const pred = mlbModel.predict(away, home, {
            awayStarter: merged.final.away,
            homeStarter: merged.final.home,
          });
          
          impactDetail = {
            updatedPrediction: {
              homeWinProb: +(pred.homeWinProb * 100).toFixed(1),
              totalRuns: +pred.totalRuns?.toFixed(1),
              spread: pred.spread,
            },
            change: change.impact,
          };
        }
      } catch (e) {
        impactDetail = { error: e.message };
      }
    }

    result.impactAnalysis.push({
      game,
      change: {
        from: change.from,
        to: change.to,
        team: change.team,
        role: change.role,
      },
      impact: change.impact,
      prediction: impactDetail,
    });
  }

  // ==================== SUMMARY ====================
  const totalChanges = result.changes.length;
  const criticalChanges = result.changes.filter(c => c.impact?.severity === 'CRITICAL').length;
  const highChanges = result.changes.filter(c => c.impact?.severity === 'HIGH').length;
  const tbdCount = result.mergedSchedule.reduce((sum, g) => {
    return sum + (g.final.away ? 0 : 1) + (g.final.home ? 0 : 1);
  }, 0);
  const newPitcherCount = result.newPitchers.length;

  result.summary = {
    totalGames: result.mergedSchedule.length,
    totalChanges,
    criticalChanges,
    highChanges,
    tbdSlots: tbdCount,
    newPitchers: newPitcherCount,
    status: criticalChanges > 0 ? '🚨 CRITICAL CHANGES — REVIEW BETS' :
            highChanges > 0 ? '⚠️ SIGNIFICANT CHANGES' :
            totalChanges > 0 ? 'ℹ️ MINOR CHANGES' :
            '✅ ALL STARTERS MATCH',
    lastSync: result.timestamp,
    buildTimeMs: Date.now() - startTime,
  };

  // Cache
  syncCache = result;
  syncCacheTime = Date.now();
  
  return result;
}

/**
 * Get the merged schedule with best-available pitcher data.
 * This is what the OD playbook and betting card should use.
 */
async function getMergedSchedule(opts = {}) {
  const sync = await runSync(opts);
  return sync.mergedSchedule.map(g => ({
    away: g.away,
    home: g.home,
    day: g.day,
    date: g.date,
    gameTime: g.gameTime,
    awayStarter: g.final.away,
    homeStarter: g.final.home,
    changes: g.changes,
    hasChanges: g.changes.length > 0,
  }));
}

/**
 * Create a pitcher profile for an unknown pitcher.
 * Uses Statcast data if available, team context, and safe defaults.
 */
async function createUnknownPitcherProfile(name, team) {
  const profile = {
    name,
    team,
    source: 'AUTO_GENERATED',
    createdAt: new Date().toISOString(),
    era: PITCHER_TIERS.ROOKIE_UNKNOWN.era,
    kPer9: PITCHER_TIERS.ROOKIE_UNKNOWN.kPer9,
    ipPerStart: PITCHER_TIERS.ROOKIE_UNKNOWN.ipPerStart,
    tier: PITCHER_TIERS.ROOKIE_UNKNOWN.tier,
    confidence: 'LOW',
    notes: [],
  };

  // Try Statcast for real data
  if (statcastService) {
    try {
      const status = statcastService.getStatus?.();
      if (status?.pitchers > 0) {
        // Search by name in Statcast data
        const pitchers = statcastService.getPitcherData?.();
        if (pitchers) {
          const match = Object.values(pitchers).find(p => 
            p.name?.toLowerCase() === name.toLowerCase() ||
            p.player_name?.toLowerCase() === name.toLowerCase()
          );
          if (match) {
            if (match.xERA || match.xera) {
              profile.era = +(match.xERA || match.xera);
              profile.notes.push(`Statcast xERA: ${profile.era}`);
              profile.confidence = 'MEDIUM';
            }
            if (match.kPer9 || match.k_percent) {
              profile.kPer9 = match.kPer9 || (match.k_percent * 27 / 100); // rough conversion
              profile.notes.push(`Statcast K data available`);
            }
          }
        }
      }
    } catch (e) { /* Statcast optional */ }
  }

  // Try pitcher resolver for Steamer projections
  if (pitcherResolver) {
    try {
      const resolved = pitcherResolver.resolvePitcher?.(name, team);
      if (resolved) {
        if (resolved.kPer9) profile.kPer9 = resolved.kPer9;
        if (resolved.ipPerStart) profile.ipPerStart = resolved.ipPerStart;
        if (resolved.era) profile.era = resolved.era;
        profile.confidence = 'MEDIUM';
        profile.notes.push('Pitcher resolver data available');
      }
    } catch (e) { /* resolver optional */ }
  }

  // Context-based adjustments
  const teamAce = TEAM_ACES[team];
  if (teamAce === name) {
    // This IS the ace — should be in DB but just in case
    profile.tier = 1;
    profile.era = PITCHER_TIERS.ACE.era;
    profile.notes.push('Identified as team ace');
  } else {
    // Not the ace — likely a #4/5 starter or emergency call-up
    profile.notes.push(`Not team ace (ace: ${teamAce || 'unknown'}). Likely backend starter or call-up.`);
    // Adjust era slightly worse for non-aces not in our DB
    if (profile.confidence === 'LOW') {
      profile.era = 5.00;
      profile.tier = 5;
      profile.notes.push('Unknown quality — using replacement-level defaults');
    }
  }

  return profile;
}

/**
 * Get betting implication text for a pitcher change.
 */
function getBettingImplication(change, eraDiff, runsImpact) {
  const implications = [];
  const team = change.team;
  const isHome = change.role === 'home';
  
  if (Math.abs(eraDiff) < 0.3) {
    return 'Minimal impact — lateral move, no bet adjustment needed.';
  }
  
  if (eraDiff > 0) {
    // Downgrade — worse pitcher
    implications.push(`${team} pitching DOWNGRADE (+${eraDiff.toFixed(1)} ERA)`);
    implications.push(`Expected total shifts UP by ~${Math.abs(runsImpact).toFixed(1)} runs`);
    
    if (isHome) {
      implications.push('OVER lean strengthens on total');
      implications.push('Away ML edge may increase');
      implications.push('F5 OVER if new pitcher is wild early');
    } else {
      implications.push('OVER lean strengthens on total');
      implications.push('Home ML edge may increase');
      implications.push('Home F5 value improves');
    }
    
    implications.push('K UNDER on new pitcher if he has lower K/9');
    implications.push('YRFI probability increases');
    
  } else {
    // Upgrade — better pitcher
    implications.push(`${team} pitching UPGRADE (${eraDiff.toFixed(1)} ERA)`);
    implications.push(`Expected total shifts DOWN by ~${Math.abs(runsImpact).toFixed(1)} runs`);
    
    if (isHome) {
      implications.push('UNDER lean on total');
      implications.push('Home ML value may increase');
      implications.push('F5 UNDER with strong arm at home');
    } else {
      implications.push('UNDER lean on total');
      implications.push('Away ML value improves');
    }
    
    implications.push('K OVER if new pitcher has higher K/9');
    implications.push('NRFI probability increases');
  }
  
  return implications.join('. ') + '.';
}

/**
 * Get change history for tracking trends.
 */
function getChangeHistory() {
  return {
    changes: changeHistory,
    count: changeHistory.length,
    firstSeen: changeHistory[0]?.detectedAt || null,
    lastSeen: changeHistory[changeHistory.length - 1]?.detectedAt || null,
  };
}

/**
 * Quick check: are there any critical changes since last sync?
 */
async function quickCheck() {
  const sync = await runSync();
  return {
    status: sync.summary.status,
    criticalChanges: sync.summary.criticalChanges,
    highChanges: sync.summary.highChanges,
    totalChanges: sync.summary.totalChanges,
    tbdSlots: sync.summary.tbdSlots,
    newPitchers: sync.summary.newPitchers,
    alerts: sync.alerts,
    lastSync: sync.summary.lastSync,
  };
}

/**
 * Get a formatted report suitable for display.
 */
async function getReport(opts = {}) {
  const sync = await runSync(opts);
  
  const lines = [];
  lines.push(`⚾ OD Pitcher Sync Report — ${sync.timestamp}`);
  lines.push(`Days until Opening Day: ${sync.daysUntilOD}`);
  lines.push(`Status: ${sync.summary.status}`);
  lines.push('');
  
  if (sync.alerts.length > 0) {
    lines.push('=== ALERTS ===');
    for (const alert of sync.alerts) {
      lines.push(`${alert.level}: ${alert.msg}`);
      lines.push(`  Action: ${alert.action}`);
    }
    lines.push('');
  }
  
  lines.push('=== SCHEDULE (Best Available) ===');
  for (const g of sync.mergedSchedule) {
    const awStatus = g.final.away ? (g.starters.away.espnConfirmed ? '✅' : '📋') : '❌TBD';
    const hmStatus = g.final.home ? (g.starters.home.espnConfirmed ? '✅' : '📋') : '❌TBD';
    const changed = g.changes.length > 0 ? ' 🔄' : '';
    lines.push(`  Day ${g.day}: ${g.away} @ ${g.home} — ${g.final.away || 'TBD'} ${awStatus} vs ${g.final.home || 'TBD'} ${hmStatus}${changed}`);
  }
  
  if (sync.changes.length > 0) {
    lines.push('');
    lines.push('=== CHANGES FROM STATIC MODEL ===');
    for (const c of sync.changes) {
      lines.push(`  ${c.game} ${c.role}: ${c.from} → ${c.to} (${c.impact?.direction || '?'}, ERA ${c.impact?.oldEra?.toFixed(1)} → ${c.impact?.newEra?.toFixed(1)})`);
    }
  }
  
  if (sync.newPitchers.length > 0) {
    lines.push('');
    lines.push('=== NEW PITCHER PROFILES (Auto-Generated) ===');
    for (const p of sync.newPitchers) {
      lines.push(`  ${p.name} (${p.team}): ERA ${p.era.toFixed(2)}, K/9 ${p.kPer9.toFixed(1)}, Tier ${p.tier}, Confidence: ${p.confidence}`);
      p.notes.forEach(n => lines.push(`    - ${n}`));
    }
  }
  
  return lines.join('\n');
}

function getStatus() {
  return {
    service: 'od-pitcher-sync',
    version: '89.0.0',
    cached: !!syncCache,
    cacheAge: syncCache ? Date.now() - syncCacheTime : null,
    changeHistoryCount: changeHistory.length,
  };
}

module.exports = {
  runSync,
  getMergedSchedule,
  quickCheck,
  getReport,
  getChangeHistory,
  getStatus,
  createUnknownPitcherProfile,
};
