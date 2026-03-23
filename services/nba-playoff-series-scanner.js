/**
 * NBA Playoff Series Futures Scanner — SportsSim v84.0
 * ====================================================
 * THE 20-DAY EDGE WINDOW.
 *
 * Connects seeding simulation uncertainty to live playoff series futures
 * to find massively mispriced Round 1 matchups.
 *
 * WHY THIS PRINTS MONEY:
 *   - Seeding is volatile in final 12 games (rest/tank/desperation)
 *   - Books price series based on CURRENT projected matchups
 *   - But if TOR/ATL/PHI are all 39-30/32, the ACTUAL R1 opponent is uncertain
 *   - A team's series win prob changes 15-25% depending on matchup opponent
 *   - We model ALL possible seeding outcomes weighted by probability
 *   - This weighted average is the TRUE series win price
 *   - If books post based on "most likely" matchup, they're wrong when seeding shifts
 *
 * EXAMPLE:
 *   ATL currently #7 → plays BOS (ATL 22% to win series)
 *   But ATL has 35% chance of being #8 → plays CLE (ATL 35% to win)
 *   And 10% chance of being #6 → plays DET (ATL 55% to win)
 *   True weighted series win: 0.55×10% + 0.22×55% + 0.35×35% = 29.6%
 *   If books price ATL at 22% (assuming #7 vs BOS), that's +7.6% edge → SMASH
 *
 * FLOW:
 *   1. Run seeding sim → seed distributions for all teams
 *   2. Enumerate all possible R1 matchups weighted by seeding probability
 *   3. For each team, compute weighted series win prob across all possible opponents
 *   4. Fetch live playoff series/outright futures from Odds API
 *   5. Compare → find edges from matchup uncertainty
 *   6. Identify "volatility plays" — teams whose value DEPENDS on seeding outcomes
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const playoffSeries = require('./playoff-series');

// Safe requires
let nbaSeedingSim = null;
let nbaModel = null;
let restTankService = null;
try { nbaSeedingSim = require('./nba-seeding-sim'); } catch(e) {}
try { nbaModel = require('../models/nba'); } catch(e) {}
try { restTankService = require('./nba-rest-tank'); } catch(e) {}

// ==================== CACHE ====================
let scanCache = null;
let scanCacheTime = 0;
const SCAN_CACHE_TTL = 20 * 60 * 1000; // 20 min — seeding battles shift daily
let isBuilding = false;

// Disk cache for persistence across deploys/restarts
const DISK_CACHE_PATH = path.join(__dirname, 'nba-series-disk-cache.json');

function saveToDisk(data) {
  try {
    fs.writeFileSync(DISK_CACHE_PATH, JSON.stringify({ data, savedAt: Date.now() }));
  } catch (e) { /* disk save optional */ }
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(DISK_CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf8'));
    // Disk cache valid for 2 hours (longer than memory TTL)
    if (raw.data && raw.savedAt && (Date.now() - raw.savedAt) < 2 * 60 * 60 * 1000) {
      return raw.data;
    }
    return null;
  } catch (e) { return null; }
}

// Load disk cache on startup
try {
  const diskData = loadFromDisk();
  if (diskData) {
    scanCache = diskData;
    scanCacheTime = Date.now() - SCAN_CACHE_TTL + (5 * 60 * 1000); // Mark as 15min old (so fresh enough)
    console.log('[nba-series-scanner] Loaded disk cache on startup');
  }
} catch (e) { /* startup load optional */ }

/**
 * Get cached scan result without blocking. Returns null if no cache.
 */
function getCachedScan() {
  if (scanCache) return { ...scanCache, cached: true, cacheAge: Math.round((Date.now() - scanCacheTime) / 1000) };
  return null;
}

/**
 * Warm the cache in background. Call on startup or periodically.
 */
async function warmCache(opts = {}) {
  if (isBuilding) return;
  try {
    console.log('[nba-series-scanner] Warming cache...');
    await runFullScan({ ...opts, forceRefresh: true });
    console.log('[nba-series-scanner] Cache warmed successfully');
  } catch (e) {
    console.error('[nba-series-scanner] Cache warm error:', e.message);
  }
}

// ==================== CONFIG ====================
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports';
const NBA_SPORT = 'basketball_nba';

// Playoff bracket structure (1v8, 2v7, 3v6, 4v5 in each conference)
const R1_MATCHUPS = [
  { higher: 1, lower: 8 },
  { higher: 2, lower: 7 },
  { higher: 3, lower: 6 },
  { higher: 4, lower: 5 },
];

// Team name → abbreviation (Odds API uses full names)
const NAME_TO_ABBR = {
  'Oklahoma City Thunder': 'OKC', 'Boston Celtics': 'BOS', 'Cleveland Cavaliers': 'CLE',
  'Houston Rockets': 'HOU', 'Denver Nuggets': 'DEN', 'Golden State Warriors': 'GSW',
  'Memphis Grizzlies': 'MEM', 'Dallas Mavericks': 'DAL', 'Minnesota Timberwolves': 'MIN',
  'Milwaukee Bucks': 'MIL', 'New York Knicks': 'NYK', 'Detroit Pistons': 'DET',
  'Los Angeles Lakers': 'LAL', 'San Antonio Spurs': 'SAS', 'Philadelphia 76ers': 'PHI',
  'Indiana Pacers': 'IND', 'Miami Heat': 'MIA', 'Sacramento Kings': 'SAC',
  'Phoenix Suns': 'PHX', 'Chicago Bulls': 'CHI', 'Los Angeles Clippers': 'LAC',
  'New Orleans Pelicans': 'NOP', 'Atlanta Hawks': 'ATL', 'Orlando Magic': 'ORL',
  'Brooklyn Nets': 'BKN', 'Portland Trail Blazers': 'POR', 'Toronto Raptors': 'TOR',
  'Charlotte Hornets': 'CHA', 'Washington Wizards': 'WAS', 'Utah Jazz': 'UTA',
};

const ABBR_TO_NAME = {};
for (const [name, abbr] of Object.entries(NAME_TO_ABBR)) {
  ABBR_TO_NAME[abbr] = name;
}

// Conference assignments
const EAST_TEAMS = ['BOS', 'CLE', 'NYK', 'MIL', 'ORL', 'DET', 'ATL', 'PHI', 'MIA', 'TOR', 'IND', 'CHI', 'CHA', 'BKN', 'WAS'];
const WEST_TEAMS = ['OKC', 'SAS', 'HOU', 'DEN', 'MIN', 'MEM', 'DAL', 'LAL', 'PHX', 'GSW', 'SAC', 'LAC', 'NOP', 'POR', 'UTA'];

// ==================== ODDS API ====================

function fetchJSON(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Fetch NBA championship futures (outrights) from Odds API
 */
async function fetchNBAFutures(apiKey) {
  if (!apiKey) return { championship: [], conference: [] };
  
  const results = { championship: [], conference: [] };
  
  // Championship winner
  try {
    const url = `${ODDS_API_BASE}/${NBA_SPORT}/odds/?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
    const data = await fetchJSON(url);
    if (Array.isArray(data)) {
      for (const event of data) {
        for (const bookmaker of (event.bookmakers || [])) {
          for (const market of (bookmaker.markets || [])) {
            if (market.key === 'outrights') {
              for (const outcome of (market.outcomes || [])) {
                const abbr = NAME_TO_ABBR[outcome.name];
                if (abbr) {
                  const existing = results.championship.find(c => c.team === abbr && c.book === bookmaker.key);
                  if (!existing) {
                    results.championship.push({
                      team: abbr,
                      name: outcome.name,
                      book: bookmaker.key,
                      odds: outcome.price,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (e) { /* championship fetch optional */ }
  
  // Try to fetch conference winner futures
  try {
    const confUrl = `${ODDS_API_BASE}/basketball_nba_conference_winner/odds/?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
    const confData = await fetchJSON(confUrl);
    if (Array.isArray(confData)) {
      for (const event of confData) {
        for (const bookmaker of (event.bookmakers || [])) {
          for (const market of (bookmaker.markets || [])) {
            for (const outcome of (market.outcomes || [])) {
              const abbr = NAME_TO_ABBR[outcome.name];
              if (abbr) {
                results.conference.push({
                  team: abbr,
                  name: outcome.name,
                  book: bookmaker.key,
                  odds: outcome.price,
                  conference: EAST_TEAMS.includes(abbr) ? 'East' : 'West',
                });
              }
            }
          }
        }
      }
    }
  } catch (e) { /* conference fetch optional */ }
  
  return results;
}

// ==================== SEEDING SIMULATION ====================

/**
 * Get current seeding probabilities from the seeding sim.
 * Returns { teams: { [abbr]: { seeds: { [1-15]: prob }, playoffProb, ... } } }
 */
async function getSeedingDistribution() {
  if (!nbaSeedingSim || !nbaSeedingSim.runSimulation) return null;
  
  try {
    const sim = await nbaSeedingSim.runSimulation(2000);
    return sim;
  } catch (e) {
    console.error('[nba-series-scanner] Seeding sim error:', e.message);
    return null;
  }
}

// ==================== CORE: WEIGHTED SERIES PROBABILITY ====================

/**
 * For a given team, compute its weighted R1 series win probability across
 * all possible seeding outcomes.
 * 
 * For each seed this team could have, figure out who they'd play (the opposing seed),
 * and who could fill that opposing seed slot. Weight by joint probability.
 *
 * Returns:
 *   {
 *     team: 'ATL',
 *     conference: 'East',
 *     weightedR1WinProb: 0.296,      // TRUE series win prob
 *     currentSeedProj: 7,
 *     currentMatchup: { opponent: 'BOS', seriesWinProb: 0.22 },
 *     seedScenarios: [
 *       { seed: 6, prob: 0.10, opponent: 'DET', seriesWinProb: 0.55 },
 *       { seed: 7, prob: 0.55, opponent: 'BOS', seriesWinProb: 0.22 },
 *       { seed: 8, prob: 0.35, opponent: 'CLE', seriesWinProb: 0.35 },
 *     ],
 *     volatility: 0.33,   // max - min seriesWinProb across scenarios
 *     playoffProb: 0.98,
 *   }
 */
function computeWeightedSeriesProb(teamAbbr, seedingData) {
  if (!seedingData || !seedingData.teams || !seedingData.teams[teamAbbr]) return null;
  if (!nbaModel) return null;
  
  const teamData = seedingData.teams[teamAbbr];
  const conf = EAST_TEAMS.includes(teamAbbr) ? 'East' : 'West';
  const confTeams = conf === 'East' ? EAST_TEAMS : WEST_TEAMS;
  
  // Get seed probabilities for this team (seeds 1-8 only — playoff seeds)
  const seedProbs = {};
  let playoffProb = 0;
  for (let s = 1; s <= 8; s++) {
    const p = teamData.seeds?.[s] || 0;
    seedProbs[s] = p / 100; // convert from percentage to decimal
    playoffProb += p;
  }
  playoffProb = playoffProb / 100;
  
  if (playoffProb < 0.01) {
    return { team: teamAbbr, conference: conf, playoffProb: +(playoffProb * 100).toFixed(1), 
             weightedR1WinProb: 0, scenarios: [], note: 'Not a playoff team' };
  }
  
  // For each seed this team could hold, find the opposing seed's candidates
  const scenarios = [];
  let weightedWinProb = 0;
  
  for (let mySeed = 1; mySeed <= 8; mySeed++) {
    const mySeedProb = seedProbs[mySeed];
    if (mySeedProb < 0.001) continue; // skip negligible
    
    // Find the opposing seed in R1
    let oppSeed;
    for (const matchup of R1_MATCHUPS) {
      if (matchup.higher === mySeed) { oppSeed = matchup.lower; break; }
      if (matchup.lower === mySeed) { oppSeed = matchup.higher; break; }
    }
    if (!oppSeed) continue;
    
    const isHigherSeed = mySeed < oppSeed;
    
    // Find which teams could fill the opposing seed
    // Weight by their probability of being at that seed
    let scenarioWinProb = 0;
    let totalOppProb = 0;
    const oppBreakdown = [];
    
    for (const oppTeam of confTeams) {
      if (oppTeam === teamAbbr) continue;
      const oppTeamData = seedingData.teams[oppTeam];
      if (!oppTeamData) continue;
      
      const oppAtSeedProb = (oppTeamData.seeds?.[oppSeed] || 0) / 100;
      if (oppAtSeedProb < 0.001) continue;
      
      // Compute series probability for this specific matchup
      let seriesProb;
      try {
        const higher = isHigherSeed ? teamAbbr : oppTeam;
        const lower = isHigherSeed ? oppTeam : teamAbbr;
        const analysis = playoffSeries.analyzePlayoffSeries(nbaModel, higher, lower);
        
        if (analysis && !analysis.error) {
          seriesProb = isHigherSeed 
            ? analysis.seriesPrice.higherSeedWinPct / 100
            : analysis.seriesPrice.lowerSeedWinPct / 100;
        } else {
          // Fallback: use basic win probability
          const pred = nbaModel.predict(teamAbbr, oppTeam);
          seriesProb = pred.homeWinProb > 1 ? pred.homeWinProb / 100 : pred.homeWinProb;
          // Rough series approximation: P(series) ≈ P(game)^1.5 for favorites
          seriesProb = Math.pow(seriesProb, 1.3);
        }
      } catch (e) {
        seriesProb = 0.5; // total fallback
      }
      
      oppBreakdown.push({
        opponent: oppTeam,
        oppSeedProb: +(oppAtSeedProb * 100).toFixed(1),
        seriesWinProb: +(seriesProb * 100).toFixed(1),
      });
      
      scenarioWinProb += oppAtSeedProb * seriesProb;
      totalOppProb += oppAtSeedProb;
    }
    
    // Normalize within this seed scenario
    if (totalOppProb > 0) {
      scenarioWinProb /= totalOppProb;
    }
    
    // Weight by probability of being at this seed
    weightedWinProb += mySeedProb * scenarioWinProb;
    
    // Most likely opponent at this seed
    oppBreakdown.sort((a, b) => b.oppSeedProb - a.oppSeedProb);
    
    scenarios.push({
      seed: mySeed,
      seedProb: +(mySeedProb * 100).toFixed(1),
      oppSeed,
      isHigherSeed,
      seriesWinProb: +(scenarioWinProb * 100).toFixed(1),
      likelyOpponents: oppBreakdown.slice(0, 3), // top 3 most likely opponents
    });
  }
  
  // Normalize by playoff probability
  if (playoffProb > 0) {
    weightedWinProb /= playoffProb;
  }
  
  // Calculate volatility (range of series win probs across seeds)
  const seriesProbs = scenarios.map(s => s.seriesWinProb);
  const volatility = seriesProbs.length > 1 
    ? Math.max(...seriesProbs) - Math.min(...seriesProbs)
    : 0;
  
  // Find most likely current seed
  scenarios.sort((a, b) => b.seedProb - a.seedProb);
  const currentSeed = scenarios[0];
  
  return {
    team: teamAbbr,
    teamName: ABBR_TO_NAME[teamAbbr] || teamAbbr,
    conference: conf,
    playoffProb: +(playoffProb * 100).toFixed(1),
    weightedR1WinProb: +(weightedWinProb * 100).toFixed(1),
    currentSeedProj: currentSeed?.seed || 0,
    currentMatchupWinProb: currentSeed?.seriesWinProb || 0,
    volatility: +volatility.toFixed(1),
    scenarios: scenarios.filter(s => s.seedProb >= 1), // only show >1% scenarios
  };
}

// ==================== EDGE DETECTION ====================

/**
 * Find mispriced series futures by comparing weighted model probability
 * to book championship/conference futures
 *
 * Key insight: Championship futures implicitly price R1 win probability.
 * If a book says ATL is +5000 to win title, they're implying ATL wins ~2% of the time.
 * If our model says ATL's weighted R1 win is 30% and they can beat their R2 opponent 40% of the time...
 * model championship prob = R1×R2×CF×Finals ≈ 30% × 40% × ... = maybe 5% → +1900 fair odds.
 * +5000 vs +1900 = massive edge.
 */
function detectEdges(teamProfiles, futuresOdds) {
  const edges = [];
  
  for (const profile of teamProfiles) {
    if (profile.playoffProb < 50 || !profile.weightedR1WinProb) continue;
    
    // Find best championship odds for this team
    const champOdds = futuresOdds.championship
      .filter(o => o.team === profile.team)
      .sort((a, b) => b.odds - a.odds); // highest odds = best for bettor
    
    const bestChampOdds = champOdds[0];
    
    // Find conference odds
    const confOdds = futuresOdds.conference
      .filter(o => o.team === profile.team)
      .sort((a, b) => b.odds - a.odds);
    
    const bestConfOdds = confOdds[0];
    
    if (bestChampOdds) {
      const bookImplied = mlToProb(bestChampOdds.odds);
      
      // Rough championship probability estimate:
      // P(champ) ≈ P(R1) × P(R2) × P(CF) × P(Finals)
      // Use diminishing returns: each subsequent round is harder
      // Approximate: P(champ) ≈ P(R1)^2.5 for contenders, P(R1)^3 for underdogs
      const r1Prob = profile.weightedR1WinProb / 100;
      let champProb;
      
      if (r1Prob >= 0.6) {
        // Strong contender — easier path
        champProb = Math.pow(r1Prob, 2.2) * 0.85; // slight discount
      } else if (r1Prob >= 0.4) {
        // Competitive — standard path
        champProb = Math.pow(r1Prob, 2.8) * 0.7;
      } else {
        // Underdog — harder path
        champProb = Math.pow(r1Prob, 3.2) * 0.5;
      }
      champProb = Math.min(0.35, champProb); // cap at 35%
      
      const edge = champProb - bookImplied;
      
      if (Math.abs(edge) >= 0.01) {
        edges.push({
          team: profile.team,
          teamName: profile.teamName,
          conference: profile.conference,
          type: 'CHAMPIONSHIP',
          bookOdds: bestChampOdds.odds,
          book: bestChampOdds.book,
          bookImplied: +(bookImplied * 100).toFixed(1),
          modelProb: +(champProb * 100).toFixed(1),
          edge: +(edge * 100).toFixed(1),
          direction: edge > 0 ? 'BET' : 'FADE',
          confidence: Math.abs(edge) >= 0.05 ? 'HIGH' : Math.abs(edge) >= 0.03 ? 'MEDIUM' : 'LOW',
          kelly: kellySize(champProb, bestChampOdds.odds),
          seedVolatility: profile.volatility,
          weightedR1Win: profile.weightedR1WinProb,
          currentSeed: profile.currentSeedProj,
          note: profile.volatility > 15 
            ? `⚠️ HIGH SEED VOLATILITY (${profile.volatility.toFixed(0)}%) — matchup uncertainty creates edge`
            : profile.volatility > 8 
              ? `Moderate seed volatility (${profile.volatility.toFixed(0)}%)`
              : `Stable seeding — edge is from model difference`,
        });
      }
    }
    
    if (bestConfOdds) {
      const bookImplied = mlToProb(bestConfOdds.odds);
      
      // Conference probability: P(conf) ≈ P(R1) × P(R2) × P(CF)
      const r1Prob = profile.weightedR1WinProb / 100;
      let confProb;
      
      if (r1Prob >= 0.6) {
        confProb = Math.pow(r1Prob, 1.8) * 0.7;
      } else if (r1Prob >= 0.4) {
        confProb = Math.pow(r1Prob, 2.2) * 0.55;
      } else {
        confProb = Math.pow(r1Prob, 2.8) * 0.4;
      }
      confProb = Math.min(0.5, confProb);
      
      const edge = confProb - bookImplied;
      
      if (Math.abs(edge) >= 0.01) {
        edges.push({
          team: profile.team,
          teamName: profile.teamName,
          conference: profile.conference,
          type: 'CONFERENCE',
          bookOdds: bestConfOdds.odds,
          book: bestConfOdds.book,
          bookImplied: +(bookImplied * 100).toFixed(1),
          modelProb: +(confProb * 100).toFixed(1),
          edge: +(edge * 100).toFixed(1),
          direction: edge > 0 ? 'BET' : 'FADE',
          confidence: Math.abs(edge) >= 0.05 ? 'HIGH' : Math.abs(edge) >= 0.03 ? 'MEDIUM' : 'LOW',
          kelly: kellySize(confProb, bestConfOdds.odds),
          seedVolatility: profile.volatility,
          weightedR1Win: profile.weightedR1WinProb,
          currentSeed: profile.currentSeedProj,
        });
      }
    }
  }
  
  return edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
}

// ==================== VOLATILITY ANALYSIS ====================

/**
 * Find the most volatile seeding battles — these create the biggest edges
 */
function findVolatilityPlays(teamProfiles) {
  const volatilePlays = [];
  
  for (const profile of teamProfiles) {
    if (profile.playoffProb < 50 || !profile.scenarios || profile.scenarios.length < 2) continue;
    
    // Calculate the range of possible series win probs
    const bestScenario = profile.scenarios.reduce((a, b) => a.seriesWinProb > b.seriesWinProb ? a : b);
    const worstScenario = profile.scenarios.reduce((a, b) => a.seriesWinProb < b.seriesWinProb ? a : b);
    
    if (bestScenario.seriesWinProb - worstScenario.seriesWinProb >= 10) {
      volatilePlays.push({
        team: profile.team,
        teamName: profile.teamName,
        conference: profile.conference,
        currentSeed: profile.currentSeedProj,
        weightedR1Win: profile.weightedR1WinProb,
        volatility: profile.volatility,
        bestCase: {
          seed: bestScenario.seed,
          seedProb: bestScenario.seedProb,
          seriesWin: bestScenario.seriesWinProb,
          likelyOpp: bestScenario.likelyOpponents[0]?.opponent || 'TBD',
        },
        worstCase: {
          seed: worstScenario.seed,
          seedProb: worstScenario.seedProb,
          seriesWin: worstScenario.seriesWinProb,
          likelyOpp: worstScenario.likelyOpponents[0]?.opponent || 'TBD',
        },
        insight: generateVolatilityInsight(profile, bestScenario, worstScenario),
      });
    }
  }
  
  return volatilePlays.sort((a, b) => b.volatility - a.volatility);
}

function generateVolatilityInsight(profile, best, worst) {
  const swing = (best.seriesWinProb - worst.seriesWinProb).toFixed(0);
  const team = profile.team;
  
  if (profile.volatility > 20) {
    return `🔥 MASSIVE SWING: ${team} has ${swing}% R1 win prob range depending on seed. ` +
           `At #${best.seed} vs ${best.likelyOpponents[0]?.opponent}: ${best.seriesWinProb}% win. ` +
           `At #${worst.seed} vs ${worst.likelyOpponents[0]?.opponent}: ${worst.seriesWinProb}% win. ` +
           `Books can't price this uncertainty correctly — exploit it.`;
  } else if (profile.volatility > 12) {
    return `⚡ SIGNIFICANT SWING: ${team} R1 win varies ${swing}% across seed scenarios. ` +
           `Best: #${best.seed} (${best.seriesWinProb}%). Worst: #${worst.seed} (${worst.seriesWinProb}%).`;
  } else {
    return `Moderate volatility: ${team} R1 win varies ${swing}% across seed scenarios.`;
  }
}

// ==================== SEEDING BATTLE TRACKER ====================

/**
 * Track the key seeding battles that create mispricing
 * Returns teams locked in tight races for specific seeds
 */
function trackSeedingBattles(seedingData) {
  if (!seedingData || !seedingData.teams) return [];
  
  const battles = [];
  
  // Check each conference
  for (const conf of ['East', 'West']) {
    const confTeams = conf === 'East' ? EAST_TEAMS : WEST_TEAMS;
    
    // For each seed pair that matters (6/7, 7/8 are highest volatility)
    for (const targetSeed of [4, 5, 6, 7, 8]) {
      const contenders = [];
      
      for (const team of confTeams) {
        const teamData = seedingData.teams[team];
        if (!teamData || !teamData.seeds) continue;
        
        const seedProb = (teamData.seeds[targetSeed] || 0);
        if (seedProb >= 10) { // at least 10% chance of this seed
          contenders.push({
            team,
            seedProb: +seedProb.toFixed(1),
          });
        }
      }
      
      if (contenders.length >= 2) {
        contenders.sort((a, b) => b.seedProb - a.seedProb);
        battles.push({
          conference: conf,
          seed: targetSeed,
          contenders: contenders.slice(0, 4),
          competitiveness: contenders.length >= 3 ? 'HIGH' : 'MEDIUM',
          bettingImplication: `${contenders.length} teams fighting for #${targetSeed} ${conf} seed — creates R1 matchup uncertainty`,
        });
      }
    }
  }
  
  return battles;
}

// ==================== R1 MATCHUP PROBABILITY MATRIX ====================

/**
 * Generate the full R1 matchup probability matrix
 * Shows P(team A plays team B in R1) for all possible matchups
 * This is what books DON'T price correctly
 */
function buildMatchupMatrix(seedingData) {
  if (!seedingData || !seedingData.teams) return null;
  
  const matrix = {};
  
  for (const conf of ['East', 'West']) {
    const confTeams = conf === 'East' ? EAST_TEAMS : WEST_TEAMS;
    matrix[conf] = [];
    
    // For each R1 matchup slot (1v8, 2v7, 3v6, 4v5)
    for (const { higher, lower } of R1_MATCHUPS) {
      const higherCandidates = [];
      const lowerCandidates = [];
      
      for (const team of confTeams) {
        const teamData = seedingData.teams[team];
        if (!teamData || !teamData.seeds) continue;
        
        const hProb = (teamData.seeds[higher] || 0) / 100;
        const lProb = (teamData.seeds[lower] || 0) / 100;
        
        if (hProb >= 0.01) higherCandidates.push({ team, prob: hProb });
        if (lProb >= 0.01) lowerCandidates.push({ team, prob: lProb });
      }
      
      // Build pairwise probabilities
      const pairs = [];
      for (const h of higherCandidates) {
        for (const l of lowerCandidates) {
          if (h.team === l.team) continue;
          // P(this matchup) = P(team A at seed H) × P(team B at seed L)
          // This is approximate — ideally we'd use conditional probabilities
          // but for a scanner, this is close enough
          const pairProb = h.prob * l.prob;
          if (pairProb >= 0.005) { // at least 0.5%
            // Get series analysis
            let seriesResult = null;
            try {
              seriesResult = playoffSeries.analyzePlayoffSeries(nbaModel, h.team, l.team);
            } catch (e) {}
            
            pairs.push({
              higher: h.team,
              lower: l.team,
              matchupProb: +(pairProb * 100).toFixed(1),
              higherSeedProb: +(h.prob * 100).toFixed(1),
              lowerSeedProb: +(l.prob * 100).toFixed(1),
              higherWinSeries: seriesResult && !seriesResult.error
                ? +(seriesResult.seriesPrice.higherSeedWinPct).toFixed(1) 
                : null,
              lowerWinSeries: seriesResult && !seriesResult.error
                ? +(seriesResult.seriesPrice.lowerSeedWinPct).toFixed(1)
                : null,
              competitiveness: seriesResult?.competitiveness || 'unknown',
            });
          }
        }
      }
      
      pairs.sort((a, b) => b.matchupProb - a.matchupProb);
      
      matrix[conf].push({
        slot: `#${higher} vs #${lower}`,
        higherSeed: higher,
        lowerSeed: lower,
        matchups: pairs.slice(0, 8), // top 8 most likely matchups
        mostLikely: pairs[0] || null,
        uncertainty: pairs.length > 1 ? 'YES' : 'NO',
      });
    }
  }
  
  return matrix;
}

// ==================== MAIN SCAN ====================

/**
 * Full scan: seeding sim → weighted series probs → live odds → edges
 */
async function runFullScan(opts = {}) {
  const apiKey = opts.apiKey || process.env.ODDS_API_KEY || '';
  const forceRefresh = opts.forceRefresh || false;
  
  // Check cache
  if (!forceRefresh && scanCache && (Date.now() - scanCacheTime) < SCAN_CACHE_TTL) {
    return { ...scanCache, cached: true };
  }
  
  // Prevent concurrent builds
  if (isBuilding) {
    if (scanCache) return { ...scanCache, cached: true, buildInProgress: true };
    return { building: true, message: 'Scan is building, try again in 30s' };
  }
  
  isBuilding = true;
  
  const startTime = Date.now();
  const errors = [];
  
  // 1. Run seeding simulation
  let seedingData = null;
  try {
    seedingData = await getSeedingDistribution();
  } catch (e) {
    errors.push(`Seeding sim: ${e.message}`);
  }
  
  if (!seedingData) {
    isBuilding = false;
    return {
      error: 'Seeding simulation not available',
      timestamp: new Date().toISOString(),
      errors,
    };
  }
  
  // 2. Compute weighted series probabilities for all playoff-contending teams
  const allTeams = [...EAST_TEAMS, ...WEST_TEAMS];
  const teamProfiles = [];
  
  for (const team of allTeams) {
    const profile = computeWeightedSeriesProb(team, seedingData);
    if (profile && profile.playoffProb > 30) {
      teamProfiles.push(profile);
    }
  }
  
  // 3. Fetch live futures odds
  let futuresOdds = { championship: [], conference: [] };
  try {
    futuresOdds = await fetchNBAFutures(apiKey);
  } catch (e) {
    errors.push(`Futures fetch: ${e.message}`);
  }
  
  // 4. Detect edges
  const edges = detectEdges(teamProfiles, futuresOdds);
  
  // 5. Volatility plays
  const volatilityPlays = findVolatilityPlays(teamProfiles);
  
  // 6. Seeding battles
  const seedingBattles = trackSeedingBattles(seedingData);
  
  // 7. Matchup matrix
  const matchupMatrix = buildMatchupMatrix(seedingData);
  
  // 8. Summary
  const betEdges = edges.filter(e => e.direction === 'BET' && e.edge >= 2);
  const fadeEdges = edges.filter(e => e.direction === 'FADE');
  const highConfBets = betEdges.filter(e => e.confidence === 'HIGH');
  const volatileTeams = volatilityPlays.filter(v => v.volatility > 15);
  
  const elapsedMs = Date.now() - startTime;
  
  const result = {
    timestamp: new Date().toISOString(),
    version: '99.0.0',
    elapsedMs,
    
    // HEADLINE
    headline: {
      totalTeamsAnalyzed: teamProfiles.length,
      totalEdges: betEdges.length,
      highConfEdges: highConfBets.length,
      fadeAlerts: fadeEdges.length,
      volatileTeams: volatileTeams.length,
      seedingBattles: seedingBattles.length,
      futuresAvailable: futuresOdds.championship.length > 0,
    },
    
    // TOP EDGES (sorted by edge size)
    topEdges: betEdges.slice(0, 15),
    
    // FADE ALERTS (teams to avoid)
    fadeAlerts: fadeEdges.slice(0, 10),
    
    // VOLATILITY PLAYS (biggest swings from seeding uncertainty)
    volatilityPlays: volatilityPlays.slice(0, 10),
    
    // SEEDING BATTLES
    seedingBattles,
    
    // R1 MATCHUP MATRIX
    matchupMatrix,
    
    // FULL TEAM PROFILES (ranked by weighted R1 win prob)
    teamProfiles: teamProfiles.sort((a, b) => b.weightedR1WinProb - a.weightedR1WinProb),
    
    // RAW FUTURES DATA
    futuresData: {
      championship: aggregateFuturesByTeam(futuresOdds.championship),
      conference: aggregateFuturesByTeam(futuresOdds.conference),
    },
    
    errors: errors.length > 0 ? errors : undefined,
  };
  
  // Cache
  scanCache = result;
  scanCacheTime = Date.now();
  isBuilding = false;
  
  // Persist to disk
  saveToDisk(result);
  
  return result;
}

// ==================== HELPERS ====================

function aggregateFuturesByTeam(odds) {
  const byTeam = {};
  for (const o of odds) {
    if (!byTeam[o.team]) {
      byTeam[o.team] = { team: o.team, name: o.name, bestOdds: o.odds, book: o.book, allBooks: [] };
    }
    byTeam[o.team].allBooks.push({ book: o.book, odds: o.odds });
    if (o.odds > byTeam[o.team].bestOdds) {
      byTeam[o.team].bestOdds = o.odds;
      byTeam[o.team].book = o.book;
    }
  }
  return Object.values(byTeam).sort((a, b) => a.bestOdds - b.bestOdds); // favorites first (most negative)
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function kellySize(prob, ml) {
  const decimalOdds = ml > 0 ? (ml / 100) + 1 : (100 / (-ml)) + 1;
  const b = decimalOdds - 1;
  const q = 1 - prob;
  const kelly = (b * prob - q) / b;
  const k = Math.max(0, kelly);
  return {
    full: +(k * 100).toFixed(2),
    half: +(k * 50).toFixed(2),
    quarter: +(k * 25).toFixed(2),
  };
}

// ==================== SINGLE TEAM ANALYSIS ====================

/**
 * Deep dive on one team's playoff series outlook
 */
async function analyzeTeam(teamAbbr, opts = {}) {
  const apiKey = opts.apiKey || process.env.ODDS_API_KEY || '';
  
  const seedingData = await getSeedingDistribution();
  if (!seedingData) return { error: 'Seeding simulation not available' };
  
  const profile = computeWeightedSeriesProb(teamAbbr, seedingData);
  if (!profile) return { error: `Team ${teamAbbr} not found` };
  
  // Fetch futures for comparison
  let futuresOdds = { championship: [], conference: [] };
  try {
    futuresOdds = await fetchNBAFutures(apiKey);
  } catch (e) {}
  
  // Find this team's odds
  const champOdds = futuresOdds.championship
    .filter(o => o.team === teamAbbr)
    .sort((a, b) => b.odds - a.odds);
  
  const confOdds = futuresOdds.conference
    .filter(o => o.team === teamAbbr)
    .sort((a, b) => b.odds - a.odds);
  
  return {
    ...profile,
    futures: {
      championship: champOdds,
      conference: confOdds,
    },
    analysis: generateTeamAnalysis(profile),
  };
}

function generateTeamAnalysis(profile) {
  const parts = [];
  
  if (profile.volatility > 20) {
    parts.push(`🔥 MASSIVE SEED VOLATILITY (${profile.volatility.toFixed(0)}%) — ${profile.team}'s R1 matchup is highly uncertain. This creates asymmetric futures value.`);
  } else if (profile.volatility > 10) {
    parts.push(`⚡ Notable seed volatility (${profile.volatility.toFixed(0)}%) — some matchup uncertainty creates potential edge.`);
  } else {
    parts.push(`Stable seeding — ${profile.team} is likely locked into #${profile.currentSeedProj}.`);
  }
  
  if (profile.weightedR1WinProb > 65) {
    parts.push(`Strong R1 favorite (${profile.weightedR1WinProb}% weighted win prob). Should advance.`);
  } else if (profile.weightedR1WinProb > 45) {
    parts.push(`Competitive R1 outlook (${profile.weightedR1WinProb}% weighted win prob). Toss-up series.`);
  } else {
    parts.push(`R1 underdog (${profile.weightedR1WinProb}% weighted win prob). Upset potential depends on matchup.`);
  }
  
  if (profile.scenarios && profile.scenarios.length > 1) {
    const best = profile.scenarios.reduce((a, b) => a.seriesWinProb > b.seriesWinProb ? a : b);
    const worst = profile.scenarios.reduce((a, b) => a.seriesWinProb < b.seriesWinProb ? a : b);
    parts.push(`Best scenario: #${best.seed} seed (${best.seriesWinProb}% series win). Worst: #${worst.seed} seed (${worst.seriesWinProb}%).`);
  }
  
  return parts.join(' ');
}

// ==================== STATUS ====================

function getStatus() {
  return {
    service: 'nba-playoff-series-scanner',
    version: '99.0.0',
    cacheAge: scanCacheTime ? Math.round((Date.now() - scanCacheTime) / 1000) + 's' : 'never',
    hasDiskCache: fs.existsSync(DISK_CACHE_PATH),
    isBuilding,
    dependencies: {
      seedingSim: !!nbaSeedingSim,
      nbaModel: !!nbaModel,
      playoffSeries: !!playoffSeries,
      restTank: !!restTankService,
    },
    daysToPlayoffs: Math.ceil((new Date('2026-04-12') - new Date()) / (1000 * 60 * 60 * 24)),
  };
}

// ==================== EXPORTS ====================
module.exports = {
  runFullScan,
  analyzeTeam,
  computeWeightedSeriesProb,
  findVolatilityPlays,
  trackSeedingBattles,
  buildMatchupMatrix,
  detectEdges,
  getCachedScan,
  warmCache,
  getStatus,
};
