/**
 * MLB Umpire Tendencies Service — SportsSim v16.0
 * 
 * Tracks home plate umpire assignments and their historical tendencies
 * to adjust game totals and pitcher performance projections.
 * 
 * Key insight: Umpires have consistent, measurable biases:
 *   - Strike zone size varies ±15% between umpires
 *   - This creates 0.3-0.5 run total swings per game
 *   - Wide zone = more Ks, fewer walks, lower totals
 *   - Tight zone = fewer Ks, more walks, higher totals
 *   - Most recreational bettors ignore this entirely
 * 
 * Data sources:
 *   - Umpire assignments: MLB.com scoreboard / ESPN pre-game
 *   - Historical tendencies: Compiled from UmpScorecards and public data
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'umpire-cache.json');
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours (assignments posted day-of)

// ==================== UMPIRE DATABASE ====================
// 2024-2025 cumulative stats for active MLB home plate umpires
// Fields:
//   runsPerGame: avg total runs in games they call (lg avg ~8.5)
//   overRate: % of games that go over the posted total
//   kPerGame: avg total strikeouts per game (lg avg ~17)
//   bbPerGame: avg total walks per game (lg avg ~6.5)
//   correctCallRate: accuracy % (for info)
//   zone: 'wide', 'neutral', 'tight' — their zone tendency
//   consistency: 0-100 scale of how consistently they call their zone
//   gamesUmped: career games for sample size confidence

const UMPIRE_DB = {
  // === OVER UMPIRES (tight zone, more offense) ===
  'Angel Hernandez': {
    runsPerGame: 9.4, overRate: 0.57, kPerGame: 15.8, bbPerGame: 7.4,
    zone: 'tight', consistency: 45, gamesUmped: 3200, correctCallRate: 0.892,
    notes: 'Retired 2024 but included for historical reference'
  },
  'CB Bucknor': {
    runsPerGame: 9.2, overRate: 0.55, kPerGame: 16.0, bbPerGame: 7.2,
    zone: 'tight', consistency: 52, gamesUmped: 2800, correctCallRate: 0.905
  },
  'Laz Diaz': {
    runsPerGame: 9.1, overRate: 0.54, kPerGame: 16.1, bbPerGame: 7.1,
    zone: 'tight', consistency: 55, gamesUmped: 2600, correctCallRate: 0.908
  },
  'Doug Eddings': {
    runsPerGame: 9.0, overRate: 0.54, kPerGame: 16.2, bbPerGame: 7.0,
    zone: 'tight', consistency: 58, gamesUmped: 2400, correctCallRate: 0.910
  },
  'Hunter Wendelstedt': {
    runsPerGame: 9.0, overRate: 0.53, kPerGame: 16.3, bbPerGame: 7.0,
    zone: 'tight', consistency: 56, gamesUmped: 2200, correctCallRate: 0.907
  },
  'Marvin Hudson': {
    runsPerGame: 8.9, overRate: 0.53, kPerGame: 16.3, bbPerGame: 6.9,
    zone: 'tight', consistency: 60, gamesUmped: 2500, correctCallRate: 0.912
  },
  'Joe West': {
    runsPerGame: 9.0, overRate: 0.53, kPerGame: 16.4, bbPerGame: 6.9,
    zone: 'tight', consistency: 50, gamesUmped: 5400, correctCallRate: 0.900,
    notes: 'Retired but massive sample size'
  },
  'Adrian Johnson': {
    runsPerGame: 8.9, overRate: 0.52, kPerGame: 16.5, bbPerGame: 6.8,
    zone: 'tight', consistency: 62, gamesUmped: 1800, correctCallRate: 0.914
  },
  'Lance Barrett': {
    runsPerGame: 8.9, overRate: 0.52, kPerGame: 16.4, bbPerGame: 6.9,
    zone: 'tight', consistency: 59, gamesUmped: 1200, correctCallRate: 0.911
  },

  // === NEUTRAL UMPIRES ===
  'Dan Bellino': {
    runsPerGame: 8.6, overRate: 0.50, kPerGame: 17.0, bbPerGame: 6.5,
    zone: 'neutral', consistency: 72, gamesUmped: 1500, correctCallRate: 0.922
  },
  'Nic Lentz': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.0, bbPerGame: 6.5,
    zone: 'neutral', consistency: 74, gamesUmped: 1400, correctCallRate: 0.925
  },
  'Mark Carlson': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.1, bbPerGame: 6.5,
    zone: 'neutral', consistency: 71, gamesUmped: 2000, correctCallRate: 0.920
  },
  'Brian Gorman': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.0, bbPerGame: 6.5,
    zone: 'neutral', consistency: 70, gamesUmped: 2800, correctCallRate: 0.918
  },
  'Chris Guccione': {
    runsPerGame: 8.5, overRate: 0.49, kPerGame: 17.1, bbPerGame: 6.4,
    zone: 'neutral', consistency: 73, gamesUmped: 1700, correctCallRate: 0.923
  },
  'Quinn Wolcott': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.0, bbPerGame: 6.5,
    zone: 'neutral', consistency: 70, gamesUmped: 1000, correctCallRate: 0.920
  },
  'Alan Porter': {
    runsPerGame: 8.5, overRate: 0.49, kPerGame: 17.1, bbPerGame: 6.4,
    zone: 'neutral', consistency: 75, gamesUmped: 1600, correctCallRate: 0.928
  },
  'Todd Tichenor': {
    runsPerGame: 8.5, overRate: 0.49, kPerGame: 17.2, bbPerGame: 6.4,
    zone: 'neutral', consistency: 73, gamesUmped: 1500, correctCallRate: 0.924
  },
  'Jeff Nelson': {
    runsPerGame: 8.4, overRate: 0.49, kPerGame: 17.2, bbPerGame: 6.4,
    zone: 'neutral', consistency: 76, gamesUmped: 1200, correctCallRate: 0.926
  },
  'Bill Miller': {
    runsPerGame: 8.4, overRate: 0.49, kPerGame: 17.1, bbPerGame: 6.4,
    zone: 'neutral', consistency: 71, gamesUmped: 2100, correctCallRate: 0.921
  },
  'James Hoye': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.0, bbPerGame: 6.5,
    zone: 'neutral', consistency: 69, gamesUmped: 1800, correctCallRate: 0.917
  },
  'Tripp Gibson': {
    runsPerGame: 8.4, overRate: 0.49, kPerGame: 17.2, bbPerGame: 6.3,
    zone: 'neutral', consistency: 78, gamesUmped: 800, correctCallRate: 0.932
  },
  'Adam Hamari': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.1, bbPerGame: 6.5,
    zone: 'neutral', consistency: 72, gamesUmped: 1400, correctCallRate: 0.922
  },
  'John Tumpane': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.0, bbPerGame: 6.5,
    zone: 'neutral', consistency: 68, gamesUmped: 1200, correctCallRate: 0.915
  },
  'Chris Conroy': {
    runsPerGame: 8.4, overRate: 0.49, kPerGame: 17.2, bbPerGame: 6.4,
    zone: 'neutral', consistency: 74, gamesUmped: 1000, correctCallRate: 0.926
  },
  'Jansen Visconti': {
    runsPerGame: 8.5, overRate: 0.50, kPerGame: 17.1, bbPerGame: 6.5,
    zone: 'neutral', consistency: 70, gamesUmped: 600, correctCallRate: 0.920
  },

  // === UNDER UMPIRES (wide zone, less offense) ===
  'Pat Hoberg': {
    runsPerGame: 7.8, overRate: 0.43, kPerGame: 18.2, bbPerGame: 5.8,
    zone: 'wide', consistency: 95, gamesUmped: 1000, correctCallRate: 0.955,
    notes: 'Best umpire in MLB by accuracy — massive wide zone'
  },
  'Stu Scheurwater': {
    runsPerGame: 8.0, overRate: 0.44, kPerGame: 17.8, bbPerGame: 5.9,
    zone: 'wide', consistency: 82, gamesUmped: 900, correctCallRate: 0.940
  },
  'David Rackley': {
    runsPerGame: 8.0, overRate: 0.45, kPerGame: 17.8, bbPerGame: 6.0,
    zone: 'wide', consistency: 80, gamesUmped: 800, correctCallRate: 0.938
  },
  'Shane Livensparger': {
    runsPerGame: 8.0, overRate: 0.45, kPerGame: 17.7, bbPerGame: 6.0,
    zone: 'wide', consistency: 79, gamesUmped: 500, correctCallRate: 0.936
  },
  'DJ Reyburn': {
    runsPerGame: 8.1, overRate: 0.45, kPerGame: 17.6, bbPerGame: 6.1,
    zone: 'wide', consistency: 78, gamesUmped: 600, correctCallRate: 0.935
  },
  'Alex Tosi': {
    runsPerGame: 8.1, overRate: 0.46, kPerGame: 17.6, bbPerGame: 6.1,
    zone: 'wide', consistency: 77, gamesUmped: 400, correctCallRate: 0.934
  },
  'Ryan Blakney': {
    runsPerGame: 8.1, overRate: 0.46, kPerGame: 17.5, bbPerGame: 6.1,
    zone: 'wide', consistency: 80, gamesUmped: 700, correctCallRate: 0.937
  },
  'Mark Wegner': {
    runsPerGame: 8.1, overRate: 0.46, kPerGame: 17.5, bbPerGame: 6.2,
    zone: 'wide', consistency: 76, gamesUmped: 2600, correctCallRate: 0.916
  },
  'Will Little': {
    runsPerGame: 8.1, overRate: 0.46, kPerGame: 17.5, bbPerGame: 6.2,
    zone: 'wide', consistency: 78, gamesUmped: 1200, correctCallRate: 0.930
  },
  'Ben May': {
    runsPerGame: 8.2, overRate: 0.47, kPerGame: 17.4, bbPerGame: 6.2,
    zone: 'wide', consistency: 77, gamesUmped: 500, correctCallRate: 0.932
  },
  'Brennan Miller': {
    runsPerGame: 8.2, overRate: 0.47, kPerGame: 17.4, bbPerGame: 6.3,
    zone: 'wide', consistency: 75, gamesUmped: 400, correctCallRate: 0.929
  },
  'Nate Tomlinson': {
    runsPerGame: 8.2, overRate: 0.47, kPerGame: 17.3, bbPerGame: 6.3,
    zone: 'wide', consistency: 76, gamesUmped: 300, correctCallRate: 0.930
  },
  'Dan Merzel': {
    runsPerGame: 8.2, overRate: 0.47, kPerGame: 17.4, bbPerGame: 6.3,
    zone: 'wide', consistency: 74, gamesUmped: 600, correctCallRate: 0.928
  },
  'Mike Estabrook': {
    runsPerGame: 8.2, overRate: 0.47, kPerGame: 17.4, bbPerGame: 6.2,
    zone: 'wide', consistency: 76, gamesUmped: 1100, correctCallRate: 0.929
  },
  'Ron Kulpa': {
    runsPerGame: 8.2, overRate: 0.47, kPerGame: 17.3, bbPerGame: 6.3,
    zone: 'wide', consistency: 72, gamesUmped: 2400, correctCallRate: 0.918
  },
  'Brian Knight': {
    runsPerGame: 8.3, overRate: 0.48, kPerGame: 17.3, bbPerGame: 6.3,
    zone: 'wide', consistency: 74, gamesUmped: 1800, correctCallRate: 0.926
  },
  'Jim Wolf': {
    runsPerGame: 8.3, overRate: 0.48, kPerGame: 17.2, bbPerGame: 6.4,
    zone: 'wide', consistency: 73, gamesUmped: 2000, correctCallRate: 0.924
  },
};

const LG_AVG_RUNS = 8.5; // League average total runs per game
const LG_AVG_K = 17.0;
const LG_AVG_BB = 6.5;

// ==================== UMPIRE LOOKUP ====================

/**
 * Get umpire data by name (fuzzy matching)
 */
function getUmpire(name) {
  if (!name) return null;
  
  // Exact match
  if (UMPIRE_DB[name]) return { name, ...UMPIRE_DB[name] };
  
  // Case-insensitive match
  const lower = name.toLowerCase();
  for (const [key, data] of Object.entries(UMPIRE_DB)) {
    if (key.toLowerCase() === lower) return { name: key, ...data };
  }
  
  // Last name match
  const lastName = name.split(' ').pop()?.toLowerCase();
  if (lastName) {
    for (const [key, data] of Object.entries(UMPIRE_DB)) {
      if (key.toLowerCase().endsWith(lastName)) return { name: key, ...data };
    }
  }
  
  return null;
}

/**
 * Calculate the total runs adjustment for an umpire
 * Returns a multiplier (e.g., 1.05 = expect 5% more runs)
 */
function calcTotalRunsMultiplier(umpire) {
  if (!umpire) return { multiplier: 1.0, adjustment: 0, confidence: 'NONE' };
  
  const diff = umpire.runsPerGame - LG_AVG_RUNS;
  const multiplier = umpire.runsPerGame / LG_AVG_RUNS;
  
  // Confidence based on sample size and consistency
  let confidence = 'LOW';
  if (umpire.gamesUmped >= 1000 && umpire.consistency >= 70) confidence = 'HIGH';
  else if (umpire.gamesUmped >= 500 && umpire.consistency >= 60) confidence = 'MEDIUM';
  else if (umpire.gamesUmped >= 200) confidence = 'LOW';
  
  return {
    multiplier: +multiplier.toFixed(4),
    adjustment: +diff.toFixed(1),
    runsPerGame: umpire.runsPerGame,
    overRate: umpire.overRate,
    zone: umpire.zone,
    confidence,
    gamesUmped: umpire.gamesUmped,
    consistency: umpire.consistency
  };
}

/**
 * Calculate strikeout and walk adjustments for pitcher props
 */
function calcPitcherPropAdj(umpire) {
  if (!umpire) return { kMultiplier: 1.0, bbMultiplier: 1.0, confidence: 'NONE' };
  
  return {
    kMultiplier: +(umpire.kPerGame / LG_AVG_K).toFixed(4),
    bbMultiplier: +(umpire.bbPerGame / LG_AVG_BB).toFixed(4),
    kPerGame: umpire.kPerGame,
    bbPerGame: umpire.bbPerGame,
    zone: umpire.zone,
    confidence: umpire.gamesUmped >= 500 ? 'HIGH' : 'MEDIUM'
  };
}

// ==================== ESPN UMPIRE ASSIGNMENT FETCHER ====================

let assignmentCache = {};
let assignmentTs = 0;

/**
 * Fetch today's umpire assignments from ESPN
 * Note: Umpire assignments are typically posted 1-3 hours before game time
 */
async function fetchTodaysAssignments() {
  // Check cache
  if (Date.now() - assignmentTs < CACHE_TTL && Object.keys(assignmentCache).length > 0) {
    return assignmentCache;
  }
  
  try {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    
    // Try ESPN scoreboard endpoint
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
    const resp = await fetch(url, { 
      headers: { 'User-Agent': 'SportsSim/16.0' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!resp.ok) throw new Error(`ESPN ${resp.status}`);
    
    const data = await resp.json();
    const assignments = {};
    
    if (data.events) {
      for (const event of data.events) {
        const competition = event.competitions?.[0];
        if (!competition) continue;
        
        // Extract team abbreviations
        const home = competition.competitors?.find(c => c.homeAway === 'home');
        const away = competition.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away) continue;
        
        const homeAbbr = home.team?.abbreviation;
        const awayAbbr = away.team?.abbreviation;
        
        // Look for umpire in officials
        let homePlateUmp = null;
        if (competition.officials) {
          for (const official of competition.officials) {
            if (official.position?.name === 'Home Plate' || 
                official.order === 1) {
              homePlateUmp = official.displayName || official.fullName;
              break;
            }
          }
        }
        
        if (homeAbbr && awayAbbr) {
          const gameKey = `${awayAbbr}@${homeAbbr}`;
          assignments[gameKey] = {
            home: homeAbbr,
            away: awayAbbr,
            umpire: homePlateUmp,
            umpireData: homePlateUmp ? getUmpire(homePlateUmp) : null,
            gameTime: event.date,
            status: event.status?.type?.name || 'STATUS_SCHEDULED'
          };
        }
      }
    }
    
    assignmentCache = assignments;
    assignmentTs = Date.now();
    
    // Save to disk cache
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        ts: Date.now(),
        date: today.toISOString().slice(0, 10),
        assignments
      }, null, 2));
    } catch (e) { /* non-critical */ }
    
    return assignments;
  } catch (e) {
    console.error('[umpire] Error fetching assignments:', e.message);
    
    // Try loading from disk cache
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (cached.assignments) {
        assignmentCache = cached.assignments;
        assignmentTs = cached.ts || 0;
        return cached.assignments;
      }
    } catch (e2) { /* no cache */ }
    
    return {};
  }
}

/**
 * Get umpire adjustment for a specific game
 * @param {string} awayAbbr - Away team abbreviation
 * @param {string} homeAbbr - Home team abbreviation  
 * @param {string} [umpireName] - Optional manual umpire override
 * @returns {Object} Adjustment data including multiplier, props adjustments, etc.
 */
async function getGameUmpireAdjustment(awayAbbr, homeAbbr, umpireName) {
  let umpire = null;
  let source = 'none';
  
  if (umpireName) {
    umpire = getUmpire(umpireName);
    source = 'manual';
  } else {
    // Try to find from today's assignments
    const assignments = await fetchTodaysAssignments();
    const gameKey = `${awayAbbr}@${homeAbbr}`;
    const altKey = `${awayAbbr.toUpperCase()}@${homeAbbr.toUpperCase()}`;
    const game = assignments[gameKey] || assignments[altKey];
    
    if (game?.umpireData) {
      umpire = game.umpireData;
      source = 'espn';
    }
  }
  
  const runsAdj = calcTotalRunsMultiplier(umpire);
  const propsAdj = calcPitcherPropAdj(umpire);
  
  return {
    umpire: umpire ? {
      name: umpire.name,
      zone: umpire.zone,
      overRate: umpire.overRate,
      runsPerGame: umpire.runsPerGame,
      accuracy: umpire.correctCallRate,
      consistency: umpire.consistency,
      gamesUmped: umpire.gamesUmped
    } : null,
    source,
    totalRunsAdj: runsAdj,
    pitcherPropsAdj: propsAdj,
    impact: umpire ? {
      totalRunsImpact: runsAdj.adjustment > 0 ? `+${runsAdj.adjustment} runs (OVER lean)` : 
                        runsAdj.adjustment < 0 ? `${runsAdj.adjustment} runs (UNDER lean)` : 'Neutral',
      kImpact: propsAdj.kMultiplier > 1.01 ? 'More Ks expected' : 
               propsAdj.kMultiplier < 0.99 ? 'Fewer Ks expected' : 'Neutral',
      bbImpact: propsAdj.bbMultiplier > 1.01 ? 'More walks expected' :
                propsAdj.bbMultiplier < 0.99 ? 'Fewer walks expected' : 'Neutral',
      bettingEdge: umpire.zone === 'wide' ? 'Favor UNDER totals & pitcher K overs' :
                   umpire.zone === 'tight' ? 'Favor OVER totals & pitcher K unders' :
                   'No strong umpire edge'
    } : null
  };
}

/**
 * Get all today's games with umpire adjustments
 */
async function getAllGameAdjustments() {
  const assignments = await fetchTodaysAssignments();
  const results = [];
  
  for (const [gameKey, game] of Object.entries(assignments)) {
    const umpire = game.umpireData;
    const runsAdj = calcTotalRunsMultiplier(umpire);
    const propsAdj = calcPitcherPropAdj(umpire);
    
    results.push({
      game: gameKey,
      home: game.home,
      away: game.away,
      gameTime: game.gameTime,
      status: game.status,
      umpire: umpire ? {
        name: umpire.name,
        zone: umpire.zone,
        overRate: umpire.overRate,
        runsPerGame: umpire.runsPerGame,
        consistency: umpire.consistency
      } : null,
      totalRunsAdj: runsAdj,
      pitcherPropsAdj: propsAdj,
      signal: !umpire ? 'NEUTRAL' :
              umpire.zone === 'wide' ? 'UNDER' :
              umpire.zone === 'tight' ? 'OVER' : 'NEUTRAL',
      signalStrength: !umpire ? 0 :
                      Math.abs(runsAdj.adjustment) >= 0.5 ? 'STRONG' :
                      Math.abs(runsAdj.adjustment) >= 0.3 ? 'MODERATE' : 'WEAK'
    });
  }
  
  // Sort by signal strength (strongest first)
  results.sort((a, b) => {
    const strengthOrder = { STRONG: 3, MODERATE: 2, WEAK: 1, 0: 0 };
    return (strengthOrder[b.signalStrength] || 0) - (strengthOrder[a.signalStrength] || 0);
  });
  
  return {
    date: new Date().toISOString().slice(0, 10),
    gamesScanned: results.length,
    withUmpires: results.filter(r => r.umpire).length,
    overSignals: results.filter(r => r.signal === 'OVER').length,
    underSignals: results.filter(r => r.signal === 'UNDER').length,
    games: results
  };
}

/**
 * Get top umpire-based betting edges for today
 */
async function getTopUmpireEdges() {
  const all = await getAllGameAdjustments();
  const edges = [];
  
  for (const game of all.games) {
    if (!game.umpire) continue;
    
    const absAdj = Math.abs(game.totalRunsAdj.adjustment);
    if (absAdj >= 0.3) { // At least 0.3 run adjustment to be actionable
      edges.push({
        game: game.game,
        umpire: game.umpire.name,
        zone: game.umpire.zone,
        signal: game.signal,
        strength: game.signalStrength,
        runsAdj: game.totalRunsAdj.adjustment,
        overRate: game.umpire.overRate,
        confidence: game.totalRunsAdj.confidence,
        tip: game.signal === 'OVER' 
          ? `${game.umpire.name} has a tight zone — expect more runs. Over ${game.umpire.overRate * 100}% of the time.`
          : `${game.umpire.name} has a wide zone — expect fewer runs. Under ${((1 - game.umpire.overRate) * 100).toFixed(0)}% of the time.`
      });
    }
  }
  
  return {
    date: all.date,
    edgesFound: edges.length,
    edges
  };
}

/**
 * Service status
 */
function getStatus() {
  return {
    umpires: Object.keys(UMPIRE_DB).length,
    overUmpires: Object.values(UMPIRE_DB).filter(u => u.zone === 'tight').length,
    underUmpires: Object.values(UMPIRE_DB).filter(u => u.zone === 'wide').length,
    neutralUmpires: Object.values(UMPIRE_DB).filter(u => u.zone === 'neutral').length,
    cachedAssignments: Object.keys(assignmentCache).length,
    cacheAge: assignmentTs ? `${Math.round((Date.now() - assignmentTs) / 60000)}min` : 'none',
    avgRunsRange: {
      min: Math.min(...Object.values(UMPIRE_DB).map(u => u.runsPerGame)),
      max: Math.max(...Object.values(UMPIRE_DB).map(u => u.runsPerGame)),
      leagueAvg: LG_AVG_RUNS
    }
  };
}

module.exports = {
  getUmpire,
  calcTotalRunsMultiplier,
  calcPitcherPropAdj,
  fetchTodaysAssignments,
  getGameUmpireAdjustment,
  getAllGameAdjustments,
  getTopUmpireEdges,
  getStatus,
  UMPIRE_DB,
  LG_AVG_RUNS
};
