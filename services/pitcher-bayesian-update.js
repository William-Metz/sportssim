/**
 * Pitcher Bayesian Update Pipeline — SportsSim v127.0
 * =====================================================
 * THE REGULAR SEASON MONEY PRINTER'S BRAIN.
 * 
 * As the 2026 MLB season progresses, pitcher preseason projections go stale.
 * A pitcher projected for 3.80 FIP who throws 5 starts of 2.50 ERA ball
 * shouldn't still be priced at 3.80. And conversely, a pitcher projected at 3.00
 * who's getting shelled for 5.50 ERA shouldn't keep that elite projection.
 *
 * This service:
 *   1. Pulls actual pitcher game logs from MLB Stats API (statsapi.mlb.com)
 *   2. Calculates rolling 2026 season stats (ERA, FIP, K/9, WHIP, BB/9, HR/9)
 *   3. Applies Bayesian blending: actual stats weighted against preseason projections
 *   4. Uses stat-specific stabilization rates (K/9 stabilizes in ~30 IP, ERA in ~60 IP)
 *   5. Feeds blended stats back into the prediction engine
 *   6. Tracks regression candidates (outperformers/underperformers) for prop edges
 *   7. Stores daily snapshots for performance tracking
 *
 * WHY BAYESIAN:
 *   After 2 starts (12 IP), a pitcher's ERA might be 1.50 or 7.00 — pure noise.
 *   Bayesian blending treats preseason projections as a "prior belief" and weights
 *   actual data proportionally to sample size. At 5 starts, we might trust actual
 *   data 25%. At 15 starts, maybe 55%. At 30 starts, 75%+.
 *
 * STAT STABILIZATION (from FanGraphs/Baseball Prospectus research):
 *   - K/9: ~30 IP (stabilizes fastest — true talent indicator)
 *   - BB/9: ~50 IP (moderate stabilization)
 *   - HR/9: ~80 IP (slow — HR rate is volatile)
 *   - ERA: ~60 IP (moderate — includes sequencing luck)
 *   - FIP: ~50 IP (strips out sequencing luck)
 *   - WHIP: ~50 IP
 *   - BABIP: ~2000 BF (extremely slow — mostly luck)
 *
 * Prior strength = IP at which live data gets 50% weight.
 * Formula: liveWeight = ip / (ip + priorStrengthIP)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ==================== DEPENDENCIES ====================
let pitchersDB = null;
let statcastService = null;
try { pitchersDB = require('../models/mlb-pitchers'); } catch(e) {}
try { statcastService = require('./statcast'); } catch(e) {}

// ==================== CONFIG ====================
const CACHE_DIR = path.join(__dirname, 'pitcher-update-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_TTL = 30 * 60 * 1000; // 30 min cache — game logs don't change fast
const SEASON_YEAR = 2026;

// Bayesian prior strengths (in IP) — at this many IP, live data gets 50% weight
const PRIOR_STRENGTH = {
  era:  60,   // ERA stabilizes moderately (includes BABIP/sequencing noise)
  fip:  50,   // FIP removes BABIP noise, stabilizes faster
  xfip: 50,   // xFIP normalizes HR/FB
  k9:   30,   // K/9 stabilizes fastest — true talent signal
  bb9:  50,   // BB/9 moderate
  hr9:  80,   // HR/9 very slow — park/temperature dependent
  whip: 50,   // WHIP moderate
};

// MLB Stats API
const STATS_API_BASE = 'https://statsapi.mlb.com/api/v1';

// Team ID mapping for MLB Stats API
const MLB_TEAM_ID_MAP = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};
const ABBR_TO_ID = {};
for (const [id, abbr] of Object.entries(MLB_TEAM_ID_MAP)) {
  ABBR_TO_ID[abbr] = parseInt(id);
}

// ==================== STATE ====================
let pitcherUpdates = {};  // pitcherName → { preseason, actual, blended, gameLogs, lastUpdated }
let lastFullSync = 0;
let syncInProgress = false;

// ==================== HTTP HELPER ====================
function fetchJSON(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/3.0' },
      timeout,
    }, (res) => {
      clearTimeout(timer);
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}`)));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse failed')); }
      });
    }).on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// ==================== MLB STATS API FUNCTIONS ====================

/**
 * Get all team rosters and find starting pitchers for the current season.
 * Returns array of { playerId, name, teamAbbr, teamId }
 */
async function fetchAllStarters() {
  const starters = [];
  const teamIds = Object.keys(MLB_TEAM_ID_MAP).map(Number);
  
  // Fetch rosters in batches of 10 to be nice to the API
  for (let i = 0; i < teamIds.length; i += 10) {
    const batch = teamIds.slice(i, i + 10);
    const promises = batch.map(async (teamId) => {
      try {
        const url = `${STATS_API_BASE}/teams/${teamId}/roster?rosterType=active&season=${SEASON_YEAR}`;
        const data = await fetchJSON(url);
        if (data && data.roster) {
          for (const player of data.roster) {
            if (player.position && player.position.code === '1') { // Pitcher
              starters.push({
                playerId: player.person.id,
                name: player.person.fullName,
                teamAbbr: MLB_TEAM_ID_MAP[teamId],
                teamId,
              });
            }
          }
        }
      } catch (e) {
        // Skip failed team
      }
    });
    await Promise.all(promises);
  }
  
  return starters;
}

/**
 * Fetch a pitcher's 2026 game log from MLB Stats API.
 * Returns array of { date, opponent, ip, er, h, bb, k, hr, pitches, result }
 */
async function fetchPitcherGameLog(playerId) {
  try {
    const url = `${STATS_API_BASE}/people/${playerId}/stats?stats=gameLog&group=pitching&season=${SEASON_YEAR}`;
    const data = await fetchJSON(url);
    
    if (!data || !data.stats || !data.stats[0] || !data.stats[0].splits) {
      return [];
    }
    
    return data.stats[0].splits.map(split => {
      const s = split.stat;
      return {
        date: split.date,
        opponent: split.opponent?.abbreviation || '',
        isHome: split.isHome,
        ip: parseFloat(s.inningsPitched) || 0,
        er: s.earnedRuns || 0,
        h: s.hits || 0,
        bb: s.baseOnBalls || 0,
        k: s.strikeOuts || 0,
        hr: s.homeRuns || 0,
        pitches: s.numberOfPitches || 0,
        r: s.runs || 0,
        hbp: s.hitBatsmen || 0,
        bf: s.battersFaced || 0,
        result: s.wins > 0 ? 'W' : s.losses > 0 ? 'L' : 'ND',
        gameScore: s.gameScore || null,
      };
    }).filter(g => g.ip > 0); // Only include games where they actually pitched
  } catch (e) {
    return [];
  }
}

/**
 * Fetch a pitcher's season aggregate stats from MLB Stats API.
 * Returns { ip, era, k9, bb9, hr9, whip, w, l, gs, h, bb, k, hr, er, bf }
 */
async function fetchPitcherSeasonStats(playerId) {
  try {
    const url = `${STATS_API_BASE}/people/${playerId}/stats?stats=season&group=pitching&season=${SEASON_YEAR}`;
    const data = await fetchJSON(url);
    
    if (!data || !data.stats || !data.stats[0] || !data.stats[0].splits || !data.stats[0].splits[0]) {
      return null;
    }
    
    const s = data.stats[0].splits[0].stat;
    const ip = parseFloat(s.inningsPitched) || 0;
    const era = parseFloat(s.era) || 0;
    const k = s.strikeOuts || 0;
    const bb = s.baseOnBalls || 0;
    const hr = s.homeRuns || 0;
    const h = s.hits || 0;
    
    return {
      ip,
      era,
      k9: ip > 0 ? +(k / ip * 9).toFixed(2) : 0,
      bb9: ip > 0 ? +(bb / ip * 9).toFixed(2) : 0,
      hr9: ip > 0 ? +(hr / ip * 9).toFixed(2) : 0,
      whip: ip > 0 ? +((bb + h) / ip).toFixed(3) : 0,
      w: s.wins || 0,
      l: s.losses || 0,
      gs: s.gamesStarted || 0,
      g: s.gamesPlayed || 0,
      h, bb, k, hr,
      er: s.earnedRuns || 0,
      bf: s.battersFaced || 0,
    };
  } catch (e) {
    return null;
  }
}

// ==================== BAYESIAN BLENDING ====================

/**
 * Calculate FIP from raw stats.
 * FIP = ((13*HR) + (3*(BB+HBP)) - (2*K)) / IP + FIP_CONSTANT
 * FIP_CONSTANT ≈ 3.10 (varies by season, use 3.10 as approximation)
 */
function calculateFIP(k, bb, hr, hbp, ip) {
  if (ip <= 0) return null;
  const FIP_CONSTANT = 3.10;
  return +((13 * hr + 3 * (bb + (hbp || 0)) - 2 * k) / ip + FIP_CONSTANT).toFixed(2);
}

/**
 * Calculate xFIP (normalize HR to league average HR/FB rate ~10%)
 */
function calculateXFIP(k, bb, hr, hbp, ip, fb) {
  if (ip <= 0) return null;
  const FIP_CONSTANT = 3.10;
  // Estimate flyball outs from context if not available
  const estimatedFB = fb || Math.max(1, (ip * 3 - k) * 0.35); // rough estimate
  const normalizedHR = estimatedFB * 0.10; // 10% HR/FB rate
  return +((13 * normalizedHR + 3 * (bb + (hbp || 0)) - 2 * k) / ip + FIP_CONSTANT).toFixed(2);
}

/**
 * Bayesian blend of preseason projection with actual 2026 data.
 * 
 * @param {number} preseasonValue - Preseason projected stat
 * @param {number} actualValue - Actual 2026 observed stat
 * @param {number} ip - Innings pitched so far
 * @param {string} stat - Stat name (for looking up prior strength)
 * @returns {Object} { blended, liveWeight, priorWeight, confidence }
 */
function bayesianBlend(preseasonValue, actualValue, ip, stat) {
  if (actualValue === null || actualValue === undefined || ip <= 0) {
    return {
      blended: preseasonValue,
      liveWeight: 0,
      priorWeight: 1,
      confidence: 'PRESEASON',
    };
  }
  
  const priorIP = PRIOR_STRENGTH[stat] || 50;
  const liveWeight = ip / (ip + priorIP);
  const priorWeight = 1 - liveWeight;
  
  const blended = +(actualValue * liveWeight + preseasonValue * priorWeight).toFixed(3);
  
  // Confidence tier based on how much we trust the live data
  let confidence = 'PRESEASON';
  if (liveWeight >= 0.7) confidence = 'HIGH';
  else if (liveWeight >= 0.45) confidence = 'MODERATE';
  else if (liveWeight >= 0.2) confidence = 'LOW';
  else confidence = 'PRESEASON';
  
  return { blended, liveWeight: +liveWeight.toFixed(3), priorWeight: +priorWeight.toFixed(3), confidence };
}

/**
 * Full Bayesian update for a single pitcher.
 * Returns the blended pitcher object ready for prediction engine.
 */
function updatePitcher(pitcherName, teamAbbr, actualStats, gameLogs) {
  // Get preseason projection
  let preseason = null;
  if (pitchersDB) {
    const rotation = pitchersDB.getTeamRotation(teamAbbr);
    if (rotation) {
      preseason = rotation.find(p => 
        p.name.toLowerCase() === pitcherName.toLowerCase() ||
        p.name.toLowerCase().includes(pitcherName.split(' ').pop().toLowerCase())
      );
    }
    // Try global search if team rotation lookup failed
    if (!preseason) {
      preseason = pitchersDB.getPitcherByName(pitcherName);
    }
  }
  
  if (!preseason) {
    // Unknown pitcher — use actual stats only with league-average regression
    preseason = {
      name: pitcherName,
      team: teamAbbr,
      era: 4.20, fip: 4.10, xfip: 4.15,
      whip: 1.28, k9: 8.5, bb9: 3.0, hr9: 1.1,
      ip: 100, hand: 'R', war: 1.0,
    };
  }
  
  if (!actualStats || actualStats.ip <= 0) {
    // No actual data yet — use preseason
    return {
      name: pitcherName,
      team: teamAbbr,
      preseason: { ...preseason },
      actual: null,
      blended: { ...preseason },
      gameLogs: gameLogs || [],
      ip2026: 0,
      starts2026: 0,
      confidence: 'PRESEASON',
      deviation: {},
      lastUpdated: new Date().toISOString(),
    };
  }
  
  // Calculate actual FIP from raw stats
  const actualFIP = calculateFIP(actualStats.k, actualStats.bb, actualStats.hr, 0, actualStats.ip);
  const actualXFIP = calculateXFIP(actualStats.k, actualStats.bb, actualStats.hr, 0, actualStats.ip);
  
  // Bayesian blend each stat
  const eraBlend = bayesianBlend(preseason.era, actualStats.era, actualStats.ip, 'era');
  const fipBlend = bayesianBlend(preseason.fip, actualFIP, actualStats.ip, 'fip');
  const xfipBlend = bayesianBlend(preseason.xfip || preseason.fip, actualXFIP, actualStats.ip, 'xfip');
  const k9Blend = bayesianBlend(preseason.k9, actualStats.k9, actualStats.ip, 'k9');
  const bb9Blend = bayesianBlend(preseason.bb9, actualStats.bb9, actualStats.ip, 'bb9');
  const hr9Blend = bayesianBlend(preseason.hr9, actualStats.hr9, actualStats.ip, 'hr9');
  const whipBlend = bayesianBlend(preseason.whip, actualStats.whip, actualStats.ip, 'whip');
  
  // Build blended pitcher object (same shape as mlb-pitchers.js entries)
  const blended = {
    name: pitcherName,
    team: teamAbbr,
    hand: preseason.hand || 'R',
    era: eraBlend.blended,
    fip: fipBlend.blended,
    xfip: xfipBlend.blended,
    whip: whipBlend.blended,
    k9: k9Blend.blended,
    bb9: bb9Blend.blended,
    hr9: hr9Blend.blended,
    ip: preseason.ip, // Keep projected IP for workload estimation
    war: preseason.war || 1.0,
    _isBayesianBlended: true,
    _ip2026: actualStats.ip,
    _starts2026: actualStats.gs,
  };
  
  // Calculate deviation from preseason (for regression detection)
  const deviation = {
    era: +(actualStats.era - preseason.era).toFixed(2),
    fip: actualFIP !== null ? +(actualFIP - preseason.fip).toFixed(2) : null,
    k9: +(actualStats.k9 - preseason.k9).toFixed(2),
    bb9: +(actualStats.bb9 - preseason.bb9).toFixed(2),
    hr9: +(actualStats.hr9 - preseason.hr9).toFixed(2),
    whip: +(actualStats.whip - preseason.whip).toFixed(3),
  };
  
  // Regression direction
  let regressionSignal = 'NEUTRAL';
  if (actualStats.ip >= 15) { // Need at least ~3 starts for signal
    if (deviation.era < -1.0 && deviation.fip !== null && deviation.fip < -0.5) {
      regressionSignal = 'OVERPERFORMING'; // ERA AND FIP both better → might be real
    } else if (deviation.era < -1.5 && (deviation.fip === null || deviation.fip > -0.3)) {
      regressionSignal = 'LUCKY'; // ERA way better but FIP says no → regression coming
    } else if (deviation.era > 1.0 && deviation.fip !== null && deviation.fip > 0.5) {
      regressionSignal = 'UNDERPERFORMING'; // ERA AND FIP worse → might be real decline
    } else if (deviation.era > 1.5 && (deviation.fip === null || deviation.fip < 0.3)) {
      regressionSignal = 'UNLUCKY'; // ERA bad but FIP fine → regression bounce coming
    }
  }
  
  return {
    name: pitcherName,
    team: teamAbbr,
    preseason: { era: preseason.era, fip: preseason.fip, xfip: preseason.xfip, k9: preseason.k9, bb9: preseason.bb9, hr9: preseason.hr9, whip: preseason.whip, ip: preseason.ip, hand: preseason.hand },
    actual: { era: actualStats.era, fip: actualFIP, xfip: actualXFIP, k9: actualStats.k9, bb9: actualStats.bb9, hr9: actualStats.hr9, whip: actualStats.whip, ip: actualStats.ip, gs: actualStats.gs, w: actualStats.w, l: actualStats.l },
    blended,
    gameLogs: gameLogs || [],
    ip2026: actualStats.ip,
    starts2026: actualStats.gs || 0,
    confidence: eraBlend.confidence,
    liveWeight: eraBlend.liveWeight,
    deviation,
    regressionSignal,
    bettingImplications: getBettingImplications(deviation, regressionSignal, pitcherName, actualStats),
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Generate betting implications from pitcher deviation analysis.
 */
function getBettingImplications(deviation, signal, name, actual) {
  const implications = [];
  
  if (signal === 'LUCKY') {
    implications.push({
      type: 'FADE',
      market: 'game_total',
      direction: 'OVER',
      reason: `${name} ERA ${actual?.era?.toFixed(2)} is unsustainably low — FIP suggests regression. OVER lean in upcoming starts.`,
      strength: Math.min(20, Math.abs(deviation.era) * 5),
    });
    implications.push({
      type: 'FADE',
      market: 'team_win',
      direction: 'FADE_FAVORITE',
      reason: `Market likely overvaluing ${name} based on ERA. True talent closer to FIP-based projection.`,
      strength: Math.min(15, Math.abs(deviation.era) * 3),
    });
  }
  
  if (signal === 'UNLUCKY') {
    implications.push({
      type: 'BUY',
      market: 'game_total',
      direction: 'UNDER',
      reason: `${name} ERA ${actual?.era?.toFixed(2)} is unsustainably high — FIP suggests positive regression. UNDER lean in upcoming starts.`,
      strength: Math.min(20, Math.abs(deviation.era) * 5),
    });
    implications.push({
      type: 'BUY',
      market: 'team_win',
      direction: 'BUY_UNDERDOG',
      reason: `Market likely undervaluing ${name} based on inflated ERA. True talent better than surface numbers.`,
      strength: Math.min(15, Math.abs(deviation.era) * 3),
    });
  }
  
  if (signal === 'OVERPERFORMING' && actual?.ip >= 25) {
    implications.push({
      type: 'CAUTION',
      market: 'k_props',
      direction: 'NEUTRAL',
      reason: `${name} genuinely improved (both ERA and FIP). Validate with Statcast before fading.`,
      strength: 5,
    });
  }
  
  // K rate deviation → K prop implications
  if (deviation.k9 > 1.5 && actual?.ip >= 15) {
    implications.push({
      type: 'FADE_K',
      market: 'k_props',
      direction: 'K_UNDER',
      reason: `${name} K/9 inflated by ${deviation.k9.toFixed(1)} vs projection. K rate regression likely.`,
      strength: Math.min(15, deviation.k9 * 4),
    });
  } else if (deviation.k9 < -1.5 && actual?.ip >= 15) {
    implications.push({
      type: 'BUY_K',
      market: 'k_props',
      direction: 'K_OVER',
      reason: `${name} K/9 suppressed by ${Math.abs(deviation.k9).toFixed(1)} vs projection. K bounce-back likely.`,
      strength: Math.min(15, Math.abs(deviation.k9) * 4),
    });
  }
  
  return implications;
}

// ==================== SYNC ENGINE ====================

/**
 * Full sync: fetch game logs for all known pitchers and update Bayesian blend.
 * This is the expensive operation — call every 30-60 min during game days.
 */
async function fullSync() {
  if (syncInProgress) return { status: 'already_running' };
  syncInProgress = true;
  
  const start = Date.now();
  const results = { updated: 0, errors: 0, newPitchers: 0, totalPitchers: 0 };
  
  try {
    // Get all pitchers from our database
    const knownPitchers = [];
    if (pitchersDB) {
      const allTeams = Object.keys(ABBR_TO_ID);
      for (const team of allTeams) {
        const rotation = pitchersDB.getTeamRotation(team);
        if (rotation) {
          for (const p of rotation) {
            knownPitchers.push({ name: p.name, team: p.team || team });
          }
        }
      }
    }
    
    // Fetch active rosters to find pitcher IDs
    const rosterPitchers = await fetchAllStarters();
    
    // Match roster pitchers to our DB
    const toUpdate = [];
    for (const rp of rosterPitchers) {
      const known = knownPitchers.find(k => 
        k.name.toLowerCase() === rp.name.toLowerCase() ||
        k.name.toLowerCase().split(' ').pop() === rp.name.toLowerCase().split(' ').pop()
      );
      toUpdate.push({
        ...rp,
        inDB: !!known,
        dbTeam: known?.team || rp.teamAbbr,
      });
    }
    
    results.totalPitchers = toUpdate.length;
    
    // Fetch game logs in batches (don't hammer the API)
    const BATCH_SIZE = 15;
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (pitcher) => {
          const [seasonStats, gameLogs] = await Promise.all([
            fetchPitcherSeasonStats(pitcher.playerId),
            fetchPitcherGameLog(pitcher.playerId),
          ]);
          
          if (seasonStats && seasonStats.ip > 0) {
            const update = updatePitcher(pitcher.name, pitcher.dbTeam, seasonStats, gameLogs);
            pitcherUpdates[pitcher.name] = update;
            results.updated++;
            if (!pitcher.inDB) results.newPitchers++;
          }
        })
      );
      
      for (const r of batchResults) {
        if (r.status === 'rejected') results.errors++;
      }
      
      // Small delay between batches
      if (i + BATCH_SIZE < toUpdate.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    lastFullSync = Date.now();
    
    // Save to disk for persistence across restarts
    saveToDisk();
    
  } catch (e) {
    results.error = e.message;
  } finally {
    syncInProgress = false;
  }
  
  results.durationMs = Date.now() - start;
  return results;
}

/**
 * Quick sync: only update pitchers who are starting TODAY.
 * Much faster than fullSync — use for pre-game updates.
 */
async function quickSync(todaysStarters = []) {
  const results = { updated: 0, errors: 0 };
  
  for (const starter of todaysStarters) {
    try {
      // Find player ID from roster
      const url = `${STATS_API_BASE}/people/search?names=${encodeURIComponent(starter.name)}&sportId=1`;
      const searchData = await fetchJSON(url).catch(() => null);
      
      let playerId = null;
      if (searchData && searchData.people && searchData.people.length > 0) {
        playerId = searchData.people[0].id;
      }
      
      if (!playerId) {
        // Try roster lookup
        const teamId = ABBR_TO_ID[starter.team];
        if (teamId) {
          const rosterUrl = `${STATS_API_BASE}/teams/${teamId}/roster?rosterType=active&season=${SEASON_YEAR}`;
          const roster = await fetchJSON(rosterUrl).catch(() => null);
          if (roster && roster.roster) {
            const match = roster.roster.find(p => 
              p.person.fullName.toLowerCase().includes(starter.name.split(' ').pop().toLowerCase())
            );
            if (match) playerId = match.person.id;
          }
        }
      }
      
      if (playerId) {
        const [seasonStats, gameLogs] = await Promise.all([
          fetchPitcherSeasonStats(playerId),
          fetchPitcherGameLog(playerId),
        ]);
        
        if (seasonStats) {
          pitcherUpdates[starter.name] = updatePitcher(starter.name, starter.team, seasonStats, gameLogs);
          results.updated++;
        }
      }
    } catch (e) {
      results.errors++;
    }
  }
  
  return results;
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get the Bayesian-blended pitcher stats.
 * This is what the prediction engine should use instead of raw preseason data.
 * Returns the blended pitcher object or null if no update available.
 */
function getBlendedPitcher(pitcherName) {
  const update = pitcherUpdates[pitcherName];
  if (!update || !update.blended) return null;
  return update.blended;
}

/**
 * Get full update details for a pitcher (preseason, actual, blend, gameLogs, deviation).
 */
function getPitcherUpdate(pitcherName) {
  return pitcherUpdates[pitcherName] || null;
}

/**
 * Get regression candidates — pitchers whose actual stats deviate most from projections.
 * These are the best prop bet targets.
 */
function getRegressionCandidates(direction = 'all', minIP = 15) {
  const candidates = Object.values(pitcherUpdates)
    .filter(u => u.ip2026 >= minIP && u.regressionSignal !== 'NEUTRAL')
    .sort((a, b) => Math.abs(b.deviation.era) - Math.abs(a.deviation.era));
  
  if (direction === 'lucky') return candidates.filter(c => c.regressionSignal === 'LUCKY');
  if (direction === 'unlucky') return candidates.filter(c => c.regressionSignal === 'UNLUCKY');
  if (direction === 'overperforming') return candidates.filter(c => c.regressionSignal === 'OVERPERFORMING');
  if (direction === 'underperforming') return candidates.filter(c => c.regressionSignal === 'UNDERPERFORMING');
  return candidates;
}

/**
 * Get top deviations for betting — the largest gaps between actual and projected.
 */
function getTopDeviations(limit = 20) {
  return Object.values(pitcherUpdates)
    .filter(u => u.ip2026 >= 10 && u.deviation)
    .map(u => ({
      name: u.name,
      team: u.team,
      ip: u.ip2026,
      starts: u.starts2026,
      preseasonERA: u.preseason?.era,
      actualERA: u.actual?.era,
      blendedERA: u.blended?.era,
      eraDeviation: u.deviation.era,
      preseasonFIP: u.preseason?.fip,
      actualFIP: u.actual?.fip,
      fipDeviation: u.deviation.fip,
      k9Deviation: u.deviation.k9,
      signal: u.regressionSignal,
      confidence: u.confidence,
      liveWeight: u.liveWeight,
      implications: u.bettingImplications,
    }))
    .sort((a, b) => Math.abs(b.eraDeviation) - Math.abs(a.eraDeviation))
    .slice(0, limit);
}

/**
 * Get all blended pitcher stats for a team.
 */
function getTeamPitchers(teamAbbr) {
  return Object.values(pitcherUpdates)
    .filter(u => u.team === teamAbbr)
    .sort((a, b) => (b.ip2026 || 0) - (a.ip2026 || 0));
}

/**
 * Get overall model health stats — how much live data do we have?
 */
function getModelHealth() {
  const updates = Object.values(pitcherUpdates);
  const withData = updates.filter(u => u.ip2026 > 0);
  const highConf = updates.filter(u => u.confidence === 'HIGH' || u.confidence === 'MODERATE');
  
  return {
    totalTracked: updates.length,
    withLiveData: withData.length,
    highConfidence: highConf.length,
    totalIP2026: +(withData.reduce((s, u) => s + u.ip2026, 0)).toFixed(1),
    averageWeight: withData.length > 0
      ? +(withData.reduce((s, u) => s + (u.liveWeight || 0), 0) / withData.length).toFixed(3)
      : 0,
    regressionCandidates: {
      lucky: updates.filter(u => u.regressionSignal === 'LUCKY').length,
      unlucky: updates.filter(u => u.regressionSignal === 'UNLUCKY').length,
      overperforming: updates.filter(u => u.regressionSignal === 'OVERPERFORMING').length,
      underperforming: updates.filter(u => u.regressionSignal === 'UNDERPERFORMING').length,
    },
    lastSync: lastFullSync > 0 ? new Date(lastFullSync).toISOString() : null,
    syncAge: lastFullSync > 0 ? Math.round((Date.now() - lastFullSync) / 60000) + ' min' : 'never',
  };
}

/**
 * Get blended leaderboard — top/bottom pitchers by blended stat.
 */
function getLeaderboard(stat = 'era', limit = 30, direction = 'asc') {
  const withData = Object.values(pitcherUpdates)
    .filter(u => u.ip2026 >= 10 && u.blended && u.blended[stat] !== undefined);
  
  withData.sort((a, b) => {
    const va = a.blended[stat];
    const vb = b.blended[stat];
    return direction === 'asc' ? va - vb : vb - va;
  });
  
  return withData.slice(0, limit).map(u => ({
    name: u.name,
    team: u.team,
    ip: u.ip2026,
    starts: u.starts2026,
    preseason: u.preseason?.[stat],
    actual: u.actual?.[stat === 'era' ? 'era' : stat],
    blended: u.blended[stat],
    confidence: u.confidence,
    signal: u.regressionSignal,
  }));
}

// ==================== PERSISTENCE ====================

function saveToDisk() {
  try {
    const cacheFile = path.join(CACHE_DIR, 'pitcher-updates.json');
    const snapshot = {
      timestamp: new Date().toISOString(),
      pitcherCount: Object.keys(pitcherUpdates).length,
      pitchers: pitcherUpdates,
    };
    fs.writeFileSync(cacheFile, JSON.stringify(snapshot, null, 0));
  } catch (e) {
    // Disk save optional
  }
}

function loadFromDisk() {
  try {
    const cacheFile = path.join(CACHE_DIR, 'pitcher-updates.json');
    if (fs.existsSync(cacheFile)) {
      const raw = fs.readFileSync(cacheFile, 'utf8');
      const data = JSON.parse(raw);
      if (data.pitchers) {
        pitcherUpdates = data.pitchers;
        console.log(`[pitcher-bayesian] Loaded ${Object.keys(pitcherUpdates).length} pitchers from disk cache`);
        return true;
      }
    }
  } catch (e) {
    // Disk load optional
  }
  return false;
}

// ==================== DAILY SNAPSHOT ====================

/**
 * Save a daily snapshot of all pitcher updates for historical analysis.
 * Call this once per day (e.g., after midnight ET when all games are final).
 */
function saveDailySnapshot() {
  const today = new Date().toISOString().split('T')[0];
  const snapshotFile = path.join(CACHE_DIR, `snapshot-${today}.json`);
  
  try {
    const snapshot = {
      date: today,
      timestamp: new Date().toISOString(),
      pitcherCount: Object.keys(pitcherUpdates).length,
      health: getModelHealth(),
      pitchers: Object.values(pitcherUpdates).map(u => ({
        name: u.name,
        team: u.team,
        ip: u.ip2026,
        starts: u.starts2026,
        preERA: u.preseason?.era,
        actERA: u.actual?.era,
        blendERA: u.blended?.era,
        preFIP: u.preseason?.fip,
        actFIP: u.actual?.fip,
        blendFIP: u.blended?.fip,
        preK9: u.preseason?.k9,
        actK9: u.actual?.k9,
        blendK9: u.blended?.k9,
        signal: u.regressionSignal,
        confidence: u.confidence,
        weight: u.liveWeight,
      })),
    };
    
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    return { saved: snapshotFile, pitchers: snapshot.pitcherCount };
  } catch (e) {
    return { error: e.message };
  }
}

// ==================== INIT ====================
loadFromDisk();

// ==================== MODULE EXPORTS ====================
module.exports = {
  // Sync
  fullSync,
  quickSync,
  
  // Query — for prediction engine
  getBlendedPitcher,
  getPitcherUpdate,
  getTeamPitchers,
  
  // Betting edge detection
  getRegressionCandidates,
  getTopDeviations,
  getLeaderboard,
  
  // System
  getModelHealth,
  saveDailySnapshot,
  
  // Internals (for testing)
  bayesianBlend,
  updatePitcher,
  calculateFIP,
};
