/**
 * MLB First-7-Innings (F7) Model Service v98.0
 * =============================================
 * 
 * THE EDGE: F7 markets are the BEST period market for exploiting BAD BULLPENS.
 * 
 * Why F7 is the ultimate bullpen-chaos eliminator:
 * 1. Captures starter's FULL outing (most starters go 5.5-6.5 IP)
 * 2. Only includes 1-2 innings of early relief (setup men, not closers)
 * 3. Removes 8th/9th inning drama: tired closers, blown saves, mop-up duty
 * 4. MIL lost Devin Williams — their 8th/9th is chaos, but F7 avoids it
 * 5. Teams with elite closers (BAL: Helsley, MIN: Hader) get no credit in F7
 * 6. Books price F7 as ~78% of full game total, but bad bullpen teams
 *    should be LOWER (because their 8th/9th inflates the full game total)
 * 
 * Markets via The Odds API:
 * - h2h_1st_7_innings (F7 moneyline)
 * - totals_1st_7_innings (F7 total)
 * - spreads_1st_7_innings (F7 spread)
 * - alternates for each
 * 
 * OPENING DAY SPECIFIC:
 * - OD starters go DEEP (5.8 IP avg) → F7 is almost entirely ace-on-ace
 * - Bullpens are untested in real games → 8th/9th variance even HIGHER
 * - F7 UNDER on bad-bullpen teams = the play
 */

const pitcherDB = require('../models/mlb-pitchers');

// Safe requires
let negBinomial = null;
let mlbModel = null;
let bullpenQuality = null;
let weatherService = null;
let platoonSplits = null;
let openingDay = null;

try { negBinomial = require('./neg-binomial'); } catch(e) {}
try { mlbModel = require('../models/mlb'); } catch(e) {}
try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}
try { weatherService = require('./weather-forecast'); } catch(e) {}
try { platoonSplits = require('./platoon-splits'); } catch(e) {}
try { openingDay = require('../models/mlb-opening-day'); } catch(e) {}

// ==================== BULLPEN ERA SHIFTS (2025→2026) ====================
// From bullpen-quality.js — teams with biggest bullpen quality changes
// Positive = bullpen got WORSE (more runs in 8th/9th)
// Negative = bullpen got BETTER (fewer runs in 8th/9th)
const BULLPEN_ERA_SHIFTS = {
  'MIL': 0.58,   // Lost Devin Williams → WRECKED
  'PHI': 0.42,   // Lost Kimbrel production, Orion out
  'CIN': 0.35,   // Lost Strahm/Herget depth
  'COL': 0.30,   // Already bad, got worse
  'CWS': 0.28,   // Rebuilding everything
  'WSH': 0.25,   // Young arms, volatile
  'PIT': 0.15,   // Lost Bednar, Oviedo gone
  'TB':  0.10,   // Lost Fairbanks, retooling
  'ARI': 0.05,   // Stable
  'SF':  0.00,   // Neutral
  'ATL': -0.05,  // Added quality arms
  'TEX': -0.08,  // Stable, Leclerc healthy
  'STL': -0.10,  // Helsley gone but rebuild
  'KC':  -0.12,  // Keller healthy, depth improved
  'CLE': -0.15,  // Clase anchors, added depth
  'DET': -0.20,  // Added Minter setup
  'LAD': -0.22,  // Added Treinen/Kopech depth
  'SD':  -0.25,  // Suarez + depth
  'BOS': -0.30,  // Houck/Criswell + depth
  'TOR': -0.32,  // Added Bello setup
  'HOU': -0.35,  // Pressly healthy + depth
  'SEA': -0.38,  // Munoz dominant + depth
  'NYY': -0.40,  // Holmes/Schmidt/Weaver
  'LAA': -0.42,  // Estevez healthy + Herget
  'OAK': -0.15,  // Severino added but thin
  'CHC': -0.20,  // Wicks+Cuas+Assad setup
  'NYM': -0.53,  // Williams+Holmes+Minter+Diaz = ELITE
  'MIN': -0.69,  // Hader closing = massive upgrade
  'BAL': -0.57,  // Helsley+Eflin+Baz = mega-upgrade
};

// ==================== OPENING DAY SCHEDULE ====================
// DYNAMIC: imported from authoritative models/mlb-opening-day.js to avoid stale data
function getODSchedule() {
  if (openingDay && openingDay.OPENING_DAY_GAMES) {
    return openingDay.OPENING_DAY_GAMES.map(g => ({
      away: g.away, home: g.home, day: g.day,
    }));
  }
  // Fallback if import failed — should not happen in production
  console.warn('[F7] WARNING: mlb-opening-day.js not loaded, using empty schedule');
  return [];
}

// DYNAMIC: get starter name from the authoritative OD schedule
function getODStarter(teamAbbr, homeOrAway, day) {
  if (openingDay && openingDay.OPENING_DAY_GAMES) {
    const game = openingDay.OPENING_DAY_GAMES.find(g => {
      if (g.day !== day) return false;
      return homeOrAway === 'away' ? g.away === teamAbbr : g.home === teamAbbr;
    });
    if (game && game.confirmedStarters) {
      return game.confirmedStarters[homeOrAway] || null;
    }
  }
  return null;
}

// Backward-compatible aliases (used by scanODGames and getStatus)
const OD_SCHEDULE = getODSchedule();
const OD_STARTERS = (() => {
  const starters = {};
  if (openingDay && openingDay.OPENING_DAY_GAMES) {
    openingDay.OPENING_DAY_GAMES.forEach(g => {
      if (g.confirmedStarters) {
        if (g.confirmedStarters.away) starters[`${g.away}_away_${g.day}`] = g.confirmedStarters.away;
        if (g.confirmedStarters.home) starters[`${g.home}_home_${g.day}`] = g.confirmedStarters.home;
      }
    });
  }
  return starters;
})();

/**
 * Get pitcher info from DB
 */
function getPitcherInfo(name) {
  if (!pitcherDB || !pitcherDB.PITCHERS) return null;
  // PITCHERS is { team: [pitchers] } — search all teams
  for (const team of Object.keys(pitcherDB.PITCHERS)) {
    const pitchers = pitcherDB.PITCHERS[team];
    if (!Array.isArray(pitchers)) continue;
    const found = pitchers.find(p => 
      p.name.toLowerCase() === name.toLowerCase() ||
      p.name.toLowerCase().includes(name.toLowerCase().split(' ').pop())
    );
    if (found) return found;
  }
  return null;
}

/**
 * Get pitcher tier (1-4)
 */
function getPitcherTier(name) {
  const p = getPitcherInfo(name);
  if (!p) return 3; // default average
  const rating = p.compositeRating || p.rating || 50;
  if (rating >= 75) return 1; // Ace
  if (rating >= 60) return 2; // Quality
  if (rating >= 45) return 3; // Average
  return 4; // Back-end
}

/**
 * Get pitcher rating (0-100)
 */
function getPitcherRating(name) {
  const p = getPitcherInfo(name);
  if (!p) return 50;
  return p.compositeRating || p.rating || 50;
}

/**
 * Calculate F7 prediction for a matchup
 */
function predictF7(awayTeam, homeTeam, opts = {}) {
  if (!negBinomial || !negBinomial.negBinF7) {
    return { error: 'NB F7 model not available' };
  }
  
  // Get expected runs from MLB model
  let awayExpRuns = 4.5, homeExpRuns = 4.5;
  if (mlbModel && mlbModel.predict) {
    try {
      const pred = mlbModel.predict(awayTeam, homeTeam, opts.awayPitcher, opts.homePitcher);
      if (pred && !pred.error) {
        awayExpRuns = pred.awayExpRuns || pred.expectedRuns?.away || 4.5;
        homeExpRuns = pred.homeExpRuns || pred.expectedRuns?.home || 4.5;
      }
    } catch (e) {}
  }
  
  // Get bullpen ERA shifts
  const awayBPShift = BULLPEN_ERA_SHIFTS[awayTeam] || 0;
  const homeBPShift = BULLPEN_ERA_SHIFTS[homeTeam] || 0;
  
  // Get pitcher ratings
  const awayPR = opts.awayPitcher ? getPitcherRating(opts.awayPitcher) : 50;
  const homePR = opts.homePitcher ? getPitcherRating(opts.homePitcher) : 50;
  
  // Build NB F7 options
  const nbOpts = {
    isOpeningDay: opts.isOpeningDay || false,
    awayPitcherRating: awayPR,
    homePitcherRating: homePR,
    awayBullpenShift: awayBPShift,
    homeBullpenShift: homeBPShift,
    temperature: opts.temperature,
    park: opts.park || homeTeam,
  };
  
  const f7 = negBinomial.negBinF7(awayExpRuns, homeExpRuns, nbOpts);
  
  // Determine F7 betting signals
  const signals = [];
  
  // Bad bullpen signal
  if (awayBPShift > 0.25) {
    signals.push({
      type: 'BAD_BULLPEN_AWAY',
      team: awayTeam,
      shift: awayBPShift,
      note: `${awayTeam} bullpen wrecked (+${awayBPShift.toFixed(2)} ERA shift). F7 total LOWER than full game pricing suggests.`,
    });
  }
  if (homeBPShift > 0.25) {
    signals.push({
      type: 'BAD_BULLPEN_HOME',
      team: homeTeam,
      shift: homeBPShift,
      note: `${homeTeam} bullpen wrecked (+${homeBPShift.toFixed(2)} ERA shift). F7 total LOWER than full game pricing suggests.`,
    });
  }
  
  // Good bullpen signal (F7 closer to full game)
  if (awayBPShift < -0.40 || homeBPShift < -0.40) {
    const team = awayBPShift < homeBPShift ? awayTeam : homeTeam;
    const shift = Math.min(awayBPShift, homeBPShift);
    signals.push({
      type: 'ELITE_BULLPEN',
      team,
      shift,
      note: `${team} elite bullpen (${shift.toFixed(2)} ERA shift). Full game and F7 converge — less edge vs full game lines.`,
    });
  }
  
  // Ace starter signal
  if (awayPR >= 75 || homePR >= 75) {
    const ace = awayPR >= 75 ? opts.awayPitcher || awayTeam : opts.homePitcher || homeTeam;
    signals.push({
      type: 'ACE_STARTER',
      pitcher: ace,
      note: `Ace starter ${ace} dominates F7 — likely goes 6.5+ IP. F7 = almost all ace.`,
    });
  }
  
  return {
    awayTeam,
    homeTeam,
    awayPitcher: opts.awayPitcher || 'Unknown',
    homePitcher: opts.homePitcher || 'Unknown',
    fullGame: {
      awayExpRuns,
      homeExpRuns,
      total: awayExpRuns + homeExpRuns,
    },
    f7: {
      awayF7Runs: f7.awayF7Runs,
      homeF7Runs: f7.homeF7Runs,
      totalF7: f7.totalF7,
      f7Factor: f7.f7Factor,
      ml: {
        away: parseFloat((f7.ml.away * 100).toFixed(1)),
        home: parseFloat((f7.ml.home * 100).toFixed(1)),
        draw: parseFloat((f7.ml.draw * 100).toFixed(1)),
        awayML: negBinomial.probToML ? negBinomial.probToML(f7.ml.away) : null,
        homeML: negBinomial.probToML ? negBinomial.probToML(f7.ml.home) : null,
      },
      totals: f7.totals,
      spreads: f7.spreads,
      awayTeamTotals: f7.awayTeamTotals,
      homeTeamTotals: f7.homeTeamTotals,
    },
    bullpenEdge: f7.bullpenEdge,
    signals,
    bullpenShifts: {
      away: { team: awayTeam, shift: awayBPShift },
      home: { team: homeTeam, shift: homeBPShift },
    },
    pitcherRatings: {
      away: { pitcher: opts.awayPitcher || 'Unknown', rating: awayPR, tier: getPitcherTier(opts.awayPitcher || '') },
      home: { pitcher: opts.homePitcher || 'Unknown', rating: homePR, tier: getPitcherTier(opts.homePitcher || '') },
    },
  };
}

/**
 * Scan Opening Day games for F7 value
 */
function scanODGames(opts = {}) {
  const results = [];
  
  for (const game of OD_SCHEDULE) {
    // Lookup starters
    const awayKey = `${game.away}_away_${game.day}`;
    const homeKey = `${game.home}_home_${game.day}`;
    const awayPitcher = OD_STARTERS[awayKey] || null;
    const homePitcher = OD_STARTERS[homeKey] || null;
    
    const pred = predictF7(game.away, game.home, {
      awayPitcher,
      homePitcher,
      isOpeningDay: true,
      temperature: opts.temperatures ? opts.temperatures[`${game.away}@${game.home}`] : undefined,
    });
    
    if (pred.error) continue;
    
    results.push({
      ...pred,
      day: game.day,
      date: game.day === 1 ? '2026-03-26' : '2026-03-27',
    });
  }
  
  // Sort by bullpen edge magnitude (biggest gaps = most value)
  results.sort((a, b) => {
    const aEdge = Math.abs(parseFloat(a.bullpenEdge?.gapPct) || 0);
    const bEdge = Math.abs(parseFloat(b.bullpenEdge?.gapPct) || 0);
    return bEdge - aEdge;
  });
  
  // Generate top plays
  const topPlays = [];
  for (const game of results) {
    const signal = game.bullpenEdge?.signal;
    if (signal === 'STRONG_UNDER' || signal === 'LEAN_UNDER') {
      // Find the best F7 total line
      const f7Total = game.f7.totalF7;
      // Find closest half-line
      const closestLine = Math.round(f7Total * 2) / 2 + 0.5; // line should be above model total
      const lineProbs = game.f7.totals[closestLine];
      if (lineProbs) {
        topPlays.push({
          game: `${game.awayTeam}@${game.homeTeam}`,
          play: `F7 UNDER ${closestLine}`,
          modelTotal: parseFloat(f7Total.toFixed(2)),
          underProb: parseFloat((lineProbs.under * 100).toFixed(1)),
          signal,
          reason: game.bullpenEdge.note,
          awayPitcher: game.awayPitcher,
          homePitcher: game.homePitcher,
          day: game.day,
        });
      }
    }
    if (signal === 'LEAN_OVER') {
      const f7Total = game.f7.totalF7;
      const closestLine = Math.round(f7Total * 2) / 2 - 0.5;
      const lineProbs = game.f7.totals[closestLine];
      if (lineProbs) {
        topPlays.push({
          game: `${game.awayTeam}@${game.homeTeam}`,
          play: `F7 OVER ${closestLine}`,
          modelTotal: parseFloat(f7Total.toFixed(2)),
          overProb: parseFloat((lineProbs.over * 100).toFixed(1)),
          signal,
          reason: game.bullpenEdge.note,
          awayPitcher: game.awayPitcher,
          homePitcher: game.homePitcher,
          day: game.day,
        });
      }
    }
  }
  
  return {
    games: results,
    topPlays,
    count: results.length,
    playCount: topPlays.length,
    worstBullpens: Object.entries(BULLPEN_ERA_SHIFTS)
      .filter(([, v]) => v > 0.2)
      .sort((a, b) => b[1] - a[1])
      .map(([team, shift]) => ({ team, shift, note: `+${shift.toFixed(2)} ERA shift` })),
    bestBullpens: Object.entries(BULLPEN_ERA_SHIFTS)
      .filter(([, v]) => v < -0.3)
      .sort((a, b) => a[1] - b[1])
      .map(([team, shift]) => ({ team, shift, note: `${shift.toFixed(2)} ERA shift` })),
    meta: {
      model: 'NB F7 v98.0',
      description: 'Negative Binomial First 7 Innings Model — bullpen chaos eliminator',
      edge: 'F7 removes 8th/9th bullpen variance. Bad bullpen teams are overpriced on full game totals. F7 captures this.',
    },
  };
}

/**
 * Scan any day's games for F7 value
 * Requires a games array with { away, home, awayPitcher, homePitcher }
 */
function scanGames(games, opts = {}) {
  const results = [];
  
  for (const game of games) {
    const pred = predictF7(game.away || game.awayTeam, game.home || game.homeTeam, {
      awayPitcher: game.awayPitcher,
      homePitcher: game.homePitcher,
      isOpeningDay: opts.isOpeningDay || false,
      temperature: game.temperature,
    });
    
    if (pred.error) continue;
    results.push(pred);
  }
  
  return {
    games: results,
    count: results.length,
  };
}

/**
 * Get status
 */
function getStatus() {
  return {
    service: 'F7 First-7-Innings Model',
    version: '98.0',
    nbF7Available: !!(negBinomial && negBinomial.negBinF7),
    mlbModelAvailable: !!(mlbModel && mlbModel.predict),
    bullpenQualityAvailable: !!bullpenQuality,
    odGames: OD_SCHEDULE.length,
    odStarters: Object.keys(OD_STARTERS).length,
    bullpenShifts: Object.keys(BULLPEN_ERA_SHIFTS).length,
    worstBullpen: 'MIL (+0.58 ERA shift, lost Devin Williams)',
    bestBullpen: 'MIN (-0.69 ERA shift, added Hader)',
    markets: ['h2h_1st_7_innings', 'totals_1st_7_innings', 'spreads_1st_7_innings'],
    edge: 'Removes 8th/9th bullpen chaos. Bad bullpen teams overpriced on full game totals.',
  };
}

module.exports = {
  predictF7,
  scanODGames,
  scanGames,
  getStatus,
  BULLPEN_ERA_SHIFTS,
  OD_SCHEDULE,
  OD_STARTERS,
};
