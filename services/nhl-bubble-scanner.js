/**
 * NHL Bubble Playoff Futures Scanner — SportsSim v87.0
 * ======================================================
 * THE BUBBLE EDGE EXPLOITER.
 *
 * NHL East bubble is CHAOS: PIT/MTL/BOS(86pts), CBJ(85), DET(84), NYI(83)
 * Six teams within 3 points fighting for 4 wild card spots.
 *
 * WHY THIS PRINTS MONEY:
 *   1. Books price playoff futures based on "most likely" seeding
 *   2. But with 6 teams in 3 points, the probability distribution across
 *      seedings is FAT — no single seeding has >30% probability
 *   3. A team's R1 opponent changes their series win% by 15-25%
 *   4. We model ALL possible seeding outcomes weighted by probability
 *   5. The weighted-average series win% is the TRUE price
 *   6. Books that price based on "current seeding" are systematically wrong
 *
 * ALSO COVERS:
 *   - West bubble races (if any teams within 3pts)
 *   - Stanley Cup futures value from bubble uncertainty
 *   - "Clinch scenario" analysis — what results lock in matchups
 *   - Timing edge — prices move when bubble resolves, buy NOW
 *
 * FLOW:
 *   1. Fetch current NHL standings (live data)
 *   2. Run MC sim of remaining regular season → point distributions
 *   3. For each simulation, determine playoff seedings
 *   4. Calculate R1 matchup probabilities for each team
 *   5. Weight series win% across all possible matchups
 *   6. Fetch live futures from Odds API
 *   7. Compare → find edges from seeding uncertainty
 */

const https = require('https');

// Safe requires
let nhlModel = null;
let nhlPlayoffSeries = null;
let liveData = null;
try { nhlModel = require('../models/nhl'); } catch(e) {}
try { nhlPlayoffSeries = require('./nhl-playoff-series'); } catch(e) {}
try { liveData = require('./live-data'); } catch(e) {}

// ==================== CACHE ====================
let scanCache = null;
let scanCacheTime = 0;
const SCAN_CACHE_TTL = 30 * 60 * 1000; // 30 min — standings shift after games

// ==================== CONFIG ====================
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports';
const NHL_SPORT = 'icehockey_nhl';
const MC_SIMS = 10000;
const GAMES_REMAINING_APPROX = 10; // ~10 games left per team as of March 23
const BUBBLE_THRESHOLD_PTS = 5; // teams within 5 pts of last playoff spot

// NHL Division Structure
const ATLANTIC = ['BOS', 'FLA', 'TOR', 'TBL', 'OTT', 'MTL', 'BUF', 'DET'];
const METROPOLITAN = ['CAR', 'NJD', 'NYR', 'WSH', 'NYI', 'PIT', 'PHI', 'CBJ'];
const CENTRAL = ['WPG', 'DAL', 'COL', 'MIN', 'STL', 'NSH', 'CHI', 'ARI'];
const PACIFIC = ['VGK', 'EDM', 'LAK', 'VAN', 'CGY', 'SEA', 'ANA', 'SJS'];
const EASTERN = [...ATLANTIC, ...METROPOLITAN];
const WESTERN = [...CENTRAL, ...PACIFIC];

// Team full names for Odds API matching
const ABBR_TO_NAME = {
  'BOS': 'Boston Bruins', 'FLA': 'Florida Panthers', 'TOR': 'Toronto Maple Leafs',
  'TBL': 'Tampa Bay Lightning', 'OTT': 'Ottawa Senators', 'MTL': 'Montreal Canadiens',
  'BUF': 'Buffalo Sabres', 'DET': 'Detroit Red Wings', 'CAR': 'Carolina Hurricanes',
  'NJD': 'New Jersey Devils', 'NYR': 'New York Rangers', 'WSH': 'Washington Capitals',
  'NYI': 'New York Islanders', 'PIT': 'Pittsburgh Penguins', 'PHI': 'Philadelphia Flyers',
  'CBJ': 'Columbus Blue Jackets', 'WPG': 'Winnipeg Jets', 'DAL': 'Dallas Stars',
  'COL': 'Colorado Avalanche', 'MIN': 'Minnesota Wild', 'STL': 'St. Louis Blues',
  'NSH': 'Nashville Predators', 'CHI': 'Chicago Blackhawks', 'ARI': 'Arizona Coyotes',
  'VGK': 'Vegas Golden Knights', 'EDM': 'Edmonton Oilers', 'LAK': 'Los Angeles Kings',
  'VAN': 'Vancouver Canucks', 'CGY': 'Calgary Flames', 'SEA': 'Seattle Kraken',
  'ANA': 'Anaheim Ducks', 'SJS': 'San Jose Sharks',
};
const NAME_TO_ABBR = {};
for (const [abbr, name] of Object.entries(ABBR_TO_NAME)) NAME_TO_ABBR[name] = abbr;

// ==================== CORE FUNCTIONS ====================

/**
 * Get current NHL standings from live data
 */
function getCurrentStandings() {
  const teams = nhlModel ? nhlModel.getTeams() : {};
  const standings = {};
  
  for (const [abbr, team] of Object.entries(teams)) {
    const gp = (team.w || 0) + (team.l || 0) + (team.otl || 0);
    const pts = (team.w || 0) * 2 + (team.otl || 0);
    const ppg = gp > 0 ? pts / gp : 0;
    
    standings[abbr] = {
      abbr,
      name: team.name || ABBR_TO_NAME[abbr] || abbr,
      w: team.w || 0,
      l: team.l || 0,
      otl: team.otl || 0,
      gp,
      pts,
      ppg,
      gfG: team.gfG || team.rsG || 3.0,
      gaG: team.gaG || team.raG || 3.0,
      l10: team.l10 || '5-5',
      conference: EASTERN.includes(abbr) ? 'East' : 'West',
      division: ATLANTIC.includes(abbr) ? 'Atlantic' : 
                METROPOLITAN.includes(abbr) ? 'Metropolitan' :
                CENTRAL.includes(abbr) ? 'Central' : 'Pacific',
    };
  }
  
  return standings;
}

/**
 * Estimate remaining games and simulate final standings
 * Uses Pythagorean win expectation + noise for realistic spread
 */
function simulateRemainingGames(standings, numSims = MC_SIMS) {
  const results = {}; // team → array of final point totals
  
  for (const abbr of Object.keys(standings)) {
    results[abbr] = [];
  }
  
  for (let sim = 0; sim < numSims; sim++) {
    // For each team, simulate remaining games
    for (const [abbr, team] of Object.entries(standings)) {
      const maxGP = 82;
      const remaining = Math.max(0, maxGP - team.gp);
      
      if (remaining === 0) {
        results[abbr].push(team.pts);
        continue;
      }
      
      // Pythagorean win expectation
      const pyth = Math.pow(team.gfG, 2.05) / (Math.pow(team.gfG, 2.05) + Math.pow(team.gaG, 2.05));
      
      // Add noise to reflect uncertainty (±5% per game)
      const noise = (Math.random() - 0.5) * 0.10;
      const adjustedPyth = Math.max(0.2, Math.min(0.8, pyth + noise));
      
      // Simulate each remaining game
      let simPts = team.pts;
      for (let g = 0; g < remaining; g++) {
        const rand = Math.random();
        if (rand < adjustedPyth) {
          simPts += 2; // regulation win
        } else if (rand < adjustedPyth + 0.12) {
          // OT/SO game (~12% of NHL games)
          if (Math.random() < 0.5) {
            simPts += 2; // OT win
          } else {
            simPts += 1; // OT loss
          }
        }
        // else: regulation loss = 0 pts
      }
      
      results[abbr].push(simPts);
    }
  }
  
  return results;
}

/**
 * Determine playoff seedings from a single simulation's point totals
 * NHL Playoff Format:
 *   - Top 3 from each division qualify
 *   - 2 wild cards per conference (next best by points)
 *   - D1 leader vs lower WC, D2 leader vs higher WC
 *   - D1(2) vs D1(3), D2(2) vs D2(3)
 */
function determineSeedings(simPoints) {
  function rankDivision(divTeams) {
    return divTeams
      .map(abbr => ({ abbr, pts: simPoints[abbr] || 0 }))
      .sort((a, b) => b.pts - a.pts);
  }
  
  // East
  const atlRank = rankDivision(ATLANTIC);
  const metRank = rankDivision(METROPOLITAN);
  
  const eastDiv1Top3 = atlRank.slice(0, 3);
  const eastDiv2Top3 = metRank.slice(0, 3);
  const eastWCPool = [...atlRank.slice(3), ...metRank.slice(3)]
    .sort((a, b) => b.pts - a.pts);
  const eastWC = eastWCPool.slice(0, 2);
  const eastOut = eastWCPool.slice(2);
  
  // Determine which division has the better leader for R1 matchups
  const atlLeaderPts = atlRank[0]?.pts || 0;
  const metLeaderPts = metRank[0]?.pts || 0;
  
  let eastMatchups;
  if (atlLeaderPts >= metLeaderPts) {
    // Atlantic leader is #1 seed → plays lower wild card
    // Metropolitan leader is #2 seed → plays higher wild card
    eastMatchups = [
      { higher: atlRank[0]?.abbr, lower: eastWC[1]?.abbr, label: 'E-M1' }, // ATL leader vs WC2
      { higher: atlRank[1]?.abbr, lower: atlRank[2]?.abbr, label: 'E-M2' }, // ATL 2 vs ATL 3
      { higher: metRank[0]?.abbr, lower: eastWC[0]?.abbr, label: 'E-M3' }, // MET leader vs WC1
      { higher: metRank[1]?.abbr, lower: metRank[2]?.abbr, label: 'E-M4' }, // MET 2 vs MET 3
    ];
  } else {
    eastMatchups = [
      { higher: metRank[0]?.abbr, lower: eastWC[1]?.abbr, label: 'E-M1' },
      { higher: metRank[1]?.abbr, lower: metRank[2]?.abbr, label: 'E-M2' },
      { higher: atlRank[0]?.abbr, lower: eastWC[0]?.abbr, label: 'E-M3' },
      { higher: atlRank[1]?.abbr, lower: atlRank[2]?.abbr, label: 'E-M4' },
    ];
  }
  
  // West
  const cenRank = rankDivision(CENTRAL);
  const pacRank = rankDivision(PACIFIC);
  
  const westDiv1Top3 = cenRank.slice(0, 3);
  const westDiv2Top3 = pacRank.slice(0, 3);
  const westWCPool = [...cenRank.slice(3), ...pacRank.slice(3)]
    .sort((a, b) => b.pts - a.pts);
  const westWC = westWCPool.slice(0, 2);
  
  const cenLeaderPts = cenRank[0]?.pts || 0;
  const pacLeaderPts = pacRank[0]?.pts || 0;
  
  let westMatchups;
  if (cenLeaderPts >= pacLeaderPts) {
    westMatchups = [
      { higher: cenRank[0]?.abbr, lower: westWC[1]?.abbr, label: 'W-M1' },
      { higher: cenRank[1]?.abbr, lower: cenRank[2]?.abbr, label: 'W-M2' },
      { higher: pacRank[0]?.abbr, lower: westWC[0]?.abbr, label: 'W-M3' },
      { higher: pacRank[1]?.abbr, lower: pacRank[2]?.abbr, label: 'W-M4' },
    ];
  } else {
    westMatchups = [
      { higher: pacRank[0]?.abbr, lower: westWC[1]?.abbr, label: 'W-M1' },
      { higher: pacRank[1]?.abbr, lower: pacRank[2]?.abbr, label: 'W-M2' },
      { higher: cenRank[0]?.abbr, lower: westWC[0]?.abbr, label: 'W-M3' },
      { higher: cenRank[1]?.abbr, lower: cenRank[2]?.abbr, label: 'W-M4' },
    ];
  }
  
  return {
    east: {
      matchups: eastMatchups,
      qualified: [...eastDiv1Top3.map(t=>t.abbr), ...eastDiv2Top3.map(t=>t.abbr), ...eastWC.map(t=>t.abbr)],
      eliminated: eastOut.map(t => t.abbr),
      wildCards: eastWC.map(t => t.abbr),
      atlTop3: atlRank.slice(0,3).map(t=>t.abbr),
      metTop3: metRank.slice(0,3).map(t=>t.abbr),
    },
    west: {
      matchups: westMatchups,
      qualified: [...westDiv1Top3.map(t=>t.abbr), ...westDiv2Top3.map(t=>t.abbr), ...westWC.map(t=>t.abbr)],
      eliminated: westWCPool.slice(2).map(t => t.abbr),
      wildCards: westWC.map(t => t.abbr),
      cenTop3: cenRank.slice(0,3).map(t=>t.abbr),
      pacTop3: pacRank.slice(0,3).map(t=>t.abbr),
    }
  };
}

/**
 * Calculate series win probability between two teams
 * Uses NHL model's predict() + nhl-playoff-series adjustments
 */
function getSeriesWinProb(teamA, teamB) {
  if (!nhlModel || !teamA || !teamB) return 0.5;
  
  try {
    // Get regular season prediction (teamA as home)
    const pred = nhlModel.predict(teamB, teamA); // teamA is home (higher seed)
    const homeWinProb = pred.homeWinProb || 50;
    
    // Simulate 7-game series with MC
    if (nhlPlayoffSeries && nhlPlayoffSeries.monteCarloSeries) {
      const result = nhlPlayoffSeries.monteCarloSeries(homeWinProb, 100 - homeWinProb, 0, 5000);
      return (result.higherSeedWins || 0.5);
    }
    
    // Fallback: simple series calculation
    // Series win prob ≈ sum of winning in 4,5,6,7 games
    const p = homeWinProb / 100;
    const q = 1 - p;
    
    // Binomial series calculation
    const win4 = Math.pow(p, 4);
    const win5 = 4 * Math.pow(p, 4) * q;
    const win6 = 10 * Math.pow(p, 4) * Math.pow(q, 2);
    const win7 = 20 * Math.pow(p, 4) * Math.pow(q, 3);
    
    return win4 + win5 + win6 + win7;
  } catch (e) {
    return 0.5;
  }
}

/**
 * Run the full bubble scanner
 */
async function runBubbleScan(opts = {}) {
  const apiKey = opts.apiKey || process.env.ODDS_API_KEY || '';
  const forceRefresh = opts.forceRefresh || false;
  
  // Cache check
  if (!forceRefresh && scanCache && (Date.now() - scanCacheTime) < SCAN_CACHE_TTL) {
    return { ...scanCache, cached: true };
  }
  
  const startTime = Date.now();
  const standings = getCurrentStandings();
  
  if (Object.keys(standings).length < 20) {
    return { error: 'Insufficient NHL standings data', teamsFound: Object.keys(standings).length };
  }
  
  // ==================== 1. IDENTIFY BUBBLE TEAMS ====================
  const eastTeams = Object.values(standings).filter(t => t.conference === 'East')
    .sort((a, b) => b.pts - a.pts);
  const westTeams = Object.values(standings).filter(t => t.conference === 'West')
    .sort((a, b) => b.pts - a.pts);
  
  // Find the playoff cutline (8th team in each conference)
  const eastCutline = eastTeams[7]?.pts || 80;
  const westCutline = westTeams[7]?.pts || 80;
  
  // Bubble = teams within BUBBLE_THRESHOLD_PTS of cutline (above or below)
  const eastBubble = eastTeams.filter(t => 
    Math.abs(t.pts - eastCutline) <= BUBBLE_THRESHOLD_PTS
  );
  const westBubble = westTeams.filter(t => 
    Math.abs(t.pts - westCutline) <= BUBBLE_THRESHOLD_PTS
  );
  
  // ==================== 2. SIMULATE REMAINING SEASON ====================
  const simResults = simulateRemainingGames(standings, MC_SIMS);
  
  // ==================== 3. ANALYZE PLAYOFF PROBABILITY ====================
  const playoffProbs = {}; // team → { makes: count, missedBy: avg pts, seedDist: {} }
  const matchupProbs = {}; // team → { opponent → count }
  const seriesWinsByMatchup = {}; // team → { opponent → seriesWinProb }
  
  for (const abbr of Object.keys(standings)) {
    playoffProbs[abbr] = { makes: 0, misses: 0, seeds: {}, opponents: {} };
    matchupProbs[abbr] = {};
  }
  
  // Pre-compute series win probabilities for all possible matchups
  const allTeams = Object.keys(standings);
  const seriesCache = {};
  for (const a of allTeams) {
    for (const b of allTeams) {
      if (a === b) continue;
      const key = `${a}_${b}`;
      if (!seriesCache[key]) {
        seriesCache[key] = getSeriesWinProb(a, b);
        seriesCache[`${b}_${a}`] = 1 - seriesCache[key];
      }
    }
  }
  
  // Run through each simulation
  for (let sim = 0; sim < MC_SIMS; sim++) {
    const simPts = {};
    for (const abbr of Object.keys(standings)) {
      simPts[abbr] = simResults[abbr][sim];
    }
    
    const seedings = determineSeedings(simPts);
    
    // Track playoffs and matchups for East
    for (const abbr of EASTERN) {
      if (seedings.east.qualified.includes(abbr)) {
        playoffProbs[abbr].makes++;
        
        // Find this team's R1 matchup
        for (const m of seedings.east.matchups) {
          if (m.higher === abbr || m.lower === abbr) {
            const opponent = m.higher === abbr ? m.lower : m.higher;
            const isHigherSeed = m.higher === abbr;
            
            if (opponent) {
              matchupProbs[abbr][opponent] = (matchupProbs[abbr][opponent] || 0) + 1;
              
              // Track seed position
              const seedLabel = isHigherSeed ? 'higher' : 'lower';
              playoffProbs[abbr].seeds[seedLabel] = (playoffProbs[abbr].seeds[seedLabel] || 0) + 1;
            }
            break;
          }
        }
      } else {
        playoffProbs[abbr].misses++;
      }
    }
    
    // Same for West
    for (const abbr of WESTERN) {
      if (seedings.west.qualified.includes(abbr)) {
        playoffProbs[abbr].makes++;
        
        for (const m of seedings.west.matchups) {
          if (m.higher === abbr || m.lower === abbr) {
            const opponent = m.higher === abbr ? m.lower : m.higher;
            const isHigherSeed = m.higher === abbr;
            
            if (opponent) {
              matchupProbs[abbr][opponent] = (matchupProbs[abbr][opponent] || 0) + 1;
              playoffProbs[abbr].seeds[seedLabel = isHigherSeed ? 'higher' : 'lower'] = 
                (playoffProbs[abbr].seeds[isHigherSeed ? 'higher' : 'lower'] || 0) + 1;
            }
            break;
          }
        }
      } else {
        playoffProbs[abbr].misses++;
      }
    }
  }
  
  // ==================== 4. CALCULATE WEIGHTED SERIES WIN PROBS ====================
  const teamAnalysis = {};
  
  for (const [abbr, team] of Object.entries(standings)) {
    const pMakes = playoffProbs[abbr].makes / MC_SIMS;
    const opponents = matchupProbs[abbr];
    const totalMatchups = Object.values(opponents).reduce((s, c) => s + c, 0);
    
    if (pMakes < 0.01) continue; // Skip eliminated teams
    
    // Weighted R1 series win probability
    let weightedR1Win = 0;
    const matchupDetails = [];
    
    for (const [opp, count] of Object.entries(opponents)) {
      const prob = count / MC_SIMS; // P(this matchup)
      const seriesWin = seriesCache[`${abbr}_${opp}`] || 0.5;
      weightedR1Win += prob * seriesWin;
      
      matchupDetails.push({
        opponent: opp,
        opponentName: ABBR_TO_NAME[opp] || opp,
        probability: +(prob * 100).toFixed(1),
        seriesWinProb: +(seriesWin * 100).toFixed(1),
        contribution: +(prob * seriesWin * 100).toFixed(2),
      });
    }
    
    matchupDetails.sort((a, b) => b.probability - a.probability);
    
    // Volatility: how much does the series win% vary across possible matchups?
    const seriesWins = matchupDetails.map(m => m.seriesWinProb);
    const maxSeriesWin = Math.max(...seriesWins, 0);
    const minSeriesWin = Math.min(...seriesWins, 100);
    const volatility = maxSeriesWin - minSeriesWin;
    
    // Point distribution stats
    const ptsDist = simResults[abbr] || [];
    const avgPts = ptsDist.reduce((s, p) => s + p, 0) / ptsDist.length;
    const sortedPts = [...ptsDist].sort((a, b) => a - b);
    const p10 = sortedPts[Math.floor(ptsDist.length * 0.1)];
    const p50 = sortedPts[Math.floor(ptsDist.length * 0.5)];
    const p90 = sortedPts[Math.floor(ptsDist.length * 0.9)];
    
    teamAnalysis[abbr] = {
      abbr,
      name: team.name,
      conference: team.conference,
      division: team.division,
      currentPts: team.pts,
      currentGP: team.gp,
      ppg: +team.ppg.toFixed(3),
      projectedPts: {
        avg: +avgPts.toFixed(1),
        p10: p10,
        median: p50,
        p90: p90,
      },
      playoffProb: +(pMakes * 100).toFixed(1),
      missProb: +((1 - pMakes) * 100).toFixed(1),
      weightedR1WinProb: +(weightedR1Win * 100).toFixed(1),
      matchupVolatility: +volatility.toFixed(1),
      numPossibleOpponents: matchupDetails.length,
      matchups: matchupDetails,
      isBubble: eastBubble.some(t => t.abbr === abbr) || westBubble.some(t => t.abbr === abbr),
    };
  }
  
  // ==================== 5. FETCH LIVE FUTURES ====================
  let futuresData = [];
  let futuresEdges = [];
  
  try {
    futuresData = await fetchNHLFutures(apiKey);
    
    // Compare model to market
    for (const future of futuresData) {
      const abbr = NAME_TO_ABBR[future.team] || NAME_TO_ABBR[future.team?.replace(/ /g, '')] || null;
      if (!abbr || !teamAnalysis[abbr]) continue;
      
      const analysis = teamAnalysis[abbr];
      const bookImplied = future.impliedProb;
      
      // For Stanley Cup futures: model prob = playoffProb × weightedR1Win × deeper rounds estimate
      // For series-specific futures: model prob = specific matchup series win
      
      let modelProb;
      if (future.market === 'outrights') {
        // Stanley Cup: rough estimate = makePlayoffs × (avg R1 winProb × R2 factor × CF factor × Finals factor)
        const deeperRoundsFactor = analysis.weightedR1WinProb / 100 * 0.35; // rough discount for R2+
        modelProb = (analysis.playoffProb / 100) * deeperRoundsFactor * 100;
      } else {
        modelProb = analysis.weightedR1WinProb;
      }
      
      const edge = modelProb - bookImplied;
      
      if (Math.abs(edge) > 1) { // 1% minimum edge
        futuresEdges.push({
          team: abbr,
          teamName: ABBR_TO_NAME[abbr],
          conference: analysis.conference,
          market: future.market,
          bookOdds: future.odds,
          book: future.book,
          bookImplied: +bookImplied.toFixed(1),
          modelProb: +modelProb.toFixed(1),
          edge: +edge.toFixed(1),
          direction: edge > 0 ? 'BUY' : 'FADE',
          confidence: Math.abs(edge) > 5 ? 'HIGH' : Math.abs(edge) > 3 ? 'MEDIUM' : 'LOW',
          playoffProb: analysis.playoffProb,
          r1WinProb: analysis.weightedR1WinProb,
          volatility: analysis.matchupVolatility,
          kelly: kellySize(modelProb / 100, future.odds),
          isBubble: analysis.isBubble,
        });
      }
    }
    
    futuresEdges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  } catch (e) {
    // Futures fetch failed — still return analysis
  }
  
  // ==================== 6. BUILD BUBBLE REPORT ====================
  const eastBubbleReport = buildBubbleReport(eastBubble, teamAnalysis, 'East');
  const westBubbleReport = buildBubbleReport(westBubble, teamAnalysis, 'West');
  
  // ==================== 7. FIND CLINCH SCENARIOS ====================
  const clinchScenarios = findClinchScenarios(standings, simResults, eastBubble, westBubble);
  
  // ==================== 8. ASSEMBLE RESULT ====================
  const result = {
    timestamp: new Date().toISOString(),
    version: '87.0.0',
    elapsedMs: Date.now() - startTime,
    simulations: MC_SIMS,
    daysUntilPlayoffs: Math.ceil((new Date('2026-04-19') - new Date()) / 86400000),
    
    headline: {
      eastBubbleTeams: eastBubble.length,
      westBubbleTeams: westBubble.length,
      eastBubbleSpread: eastBubble.length > 1 ? (eastBubble[0].pts - eastBubble[eastBubble.length-1].pts) : 0,
      westBubbleSpread: westBubble.length > 1 ? (westBubble[0].pts - westBubble[westBubble.length-1].pts) : 0,
      totalEdges: futuresEdges.length,
      highConfEdges: futuresEdges.filter(e => e.confidence === 'HIGH').length,
      medConfEdges: futuresEdges.filter(e => e.confidence === 'MEDIUM').length,
      maxEdge: futuresEdges.length > 0 ? futuresEdges[0].edge : 0,
      mostVolatile: Object.values(teamAnalysis)
        .filter(t => t.isBubble)
        .sort((a, b) => b.matchupVolatility - a.matchupVolatility)[0]?.abbr || 'N/A',
    },
    
    bubbles: {
      east: eastBubbleReport,
      west: westBubbleReport,
    },
    
    futuresEdges: futuresEdges.slice(0, 20),
    
    // All teams with playoff prob > 1%
    teamAnalysis: Object.values(teamAnalysis)
      .filter(t => t.playoffProb > 1)
      .sort((a, b) => b.playoffProb - a.playoffProb),
    
    // Bubble-specific deep dive
    bubbleDeepDive: Object.values(teamAnalysis)
      .filter(t => t.isBubble)
      .sort((a, b) => b.matchupVolatility - a.matchupVolatility),
    
    clinchScenarios,
    
    standings: {
      east: eastTeams.map(t => ({ abbr: t.abbr, pts: t.pts, gp: t.gp, ppg: +t.ppg.toFixed(3), 
        playoffProb: teamAnalysis[t.abbr]?.playoffProb || 0 })),
      west: westTeams.map(t => ({ abbr: t.abbr, pts: t.pts, gp: t.gp, ppg: +t.ppg.toFixed(3),
        playoffProb: teamAnalysis[t.abbr]?.playoffProb || 0 })),
    },
  };
  
  scanCache = result;
  scanCacheTime = Date.now();
  
  return result;
}

/**
 * Build bubble report for a conference
 */
function buildBubbleReport(bubbleTeams, teamAnalysis, conference) {
  if (bubbleTeams.length === 0) return { teams: [], tightness: 'none' };
  
  const spread = bubbleTeams[0].pts - bubbleTeams[bubbleTeams.length - 1].pts;
  const tightness = spread <= 2 ? 'EXTREME' : spread <= 4 ? 'TIGHT' : 'MODERATE';
  
  const teams = bubbleTeams.map(t => {
    const analysis = teamAnalysis[t.abbr] || {};
    return {
      abbr: t.abbr,
      name: t.name,
      pts: t.pts,
      gp: t.gp,
      ppg: +t.ppg.toFixed(3),
      playoffProb: analysis.playoffProb || 0,
      r1WinProb: analysis.weightedR1WinProb || 0,
      volatility: analysis.matchupVolatility || 0,
      topMatchup: analysis.matchups?.[0] || null,
      numOpponents: analysis.numPossibleOpponents || 0,
      projectedPts: analysis.projectedPts || {},
      // Betting signal
      signal: analysis.playoffProb > 90 ? 'LOCKS IN' :
              analysis.playoffProb > 70 ? 'LIKELY IN' :
              analysis.playoffProb > 50 ? 'COIN FLIP' :
              analysis.playoffProb > 30 ? 'UNLIKELY' : 'LONG SHOT',
    };
  });
  
  return {
    conference,
    teams,
    spread,
    tightness,
    teamsContending: teams.filter(t => t.playoffProb > 10).length,
    mostVolatile: teams.sort((a, b) => b.volatility - a.volatility)[0]?.abbr || 'N/A',
    bettingNote: tightness === 'EXTREME' 
      ? `🚨 ${conference} bubble is EXTREME — ${spread}pt spread means ANY result changes matchups. Books CANNOT properly price series futures. This is the highest-edge scenario.`
      : tightness === 'TIGHT'
      ? `⚠️ ${conference} bubble is tight — ${spread}pt spread creates meaningful uncertainty in R1 matchups. Look for mispriced series futures.`
      : `${conference} bubble has some uncertainty but matchups are becoming clearer.`,
  };
}

/**
 * Find clinch scenarios for bubble teams
 */
function findClinchScenarios(standings, simResults, eastBubble, westBubble) {
  const scenarios = [];
  
  // For each bubble team, find what their final points range looks like
  for (const team of [...eastBubble, ...westBubble]) {
    const pts = simResults[team.abbr] || [];
    if (pts.length === 0) continue;
    
    const sorted = [...pts].sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    
    // What's the minimum points needed to make playoffs in the sim?
    const playoffSims = [];
    const missSims = [];
    for (let i = 0; i < MC_SIMS; i++) {
      // Check if this team made it in this sim
      const simPts = {};
      for (const abbr of Object.keys(standings)) {
        simPts[abbr] = simResults[abbr][i];
      }
      const seedings = determineSeedings(simPts);
      const conf = team.conference === 'East' ? 'east' : 'west';
      if (seedings[conf].qualified.includes(team.abbr)) {
        playoffSims.push(pts[i]);
      } else {
        missSims.push(pts[i]);
      }
    }
    
    const avgPlayoffPts = playoffSims.length > 0 ? playoffSims.reduce((s,p)=>s+p,0)/playoffSims.length : 0;
    const avgMissPts = missSims.length > 0 ? missSims.reduce((s,p)=>s+p,0)/missSims.length : 0;
    
    scenarios.push({
      team: team.abbr,
      name: team.name,
      currentPts: team.pts,
      remaining: Math.max(0, 82 - team.gp),
      projectedRange: { p25, median: p50, p75 },
      avgPlayoffPts: +avgPlayoffPts.toFixed(1),
      avgMissPts: +avgMissPts.toFixed(1),
      magicNumber: playoffSims.length > 0 ? Math.ceil(avgPlayoffPts - team.pts) : 'N/A',
      playoffProbByPts: getPlayoffProbByPoints(team, simResults, standings),
    });
  }
  
  return scenarios;
}

/**
 * Calculate P(playoffs) at each potential final point total
 */
function getPlayoffProbByPoints(team, simResults, standings) {
  const abbr = team.abbr;
  const ptsBuckets = {};
  
  for (let i = 0; i < MC_SIMS; i++) {
    const finalPts = simResults[abbr][i];
    const bucket = finalPts; // integer points
    if (!ptsBuckets[bucket]) ptsBuckets[bucket] = { total: 0, makes: 0 };
    ptsBuckets[bucket].total++;
    
    // Check if made playoffs
    const simPts = {};
    for (const a of Object.keys(standings)) {
      simPts[a] = simResults[a][i];
    }
    const seedings = determineSeedings(simPts);
    const conf = team.conference === 'East' ? 'east' : 'west';
    if (seedings[conf].qualified.includes(abbr)) {
      ptsBuckets[bucket].makes++;
    }
  }
  
  // Convert to array
  return Object.entries(ptsBuckets)
    .map(([pts, data]) => ({
      pts: +pts,
      playoffProb: +(data.makes / data.total * 100).toFixed(1),
      frequency: data.total,
    }))
    .sort((a, b) => a.pts - b.pts);
}

/**
 * Fetch NHL futures from Odds API
 */
function fetchNHLFutures(apiKey) {
  return new Promise((resolve) => {
    if (!apiKey) { resolve([]); return; }
    
    const url = `${ODDS_API_BASE}/${NHL_SPORT}_championship_winner/odds?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const futures = [];
          
          if (Array.isArray(json)) {
            for (const event of json) {
              for (const book of (event.bookmakers || [])) {
                for (const market of (book.markets || [])) {
                  for (const outcome of (market.outcomes || [])) {
                    futures.push({
                      team: outcome.name,
                      odds: outcome.price,
                      book: book.title || book.key,
                      market: market.key || 'outrights',
                      impliedProb: outcome.price > 0 
                        ? 100 / (outcome.price + 100) * 100
                        : Math.abs(outcome.price) / (Math.abs(outcome.price) + 100) * 100,
                    });
                  }
                }
              }
            }
          }
          
          // Deduplicate — keep best odds per team
          const bestByTeam = {};
          for (const f of futures) {
            const existing = bestByTeam[f.team];
            if (!existing || f.odds > existing.odds) {
              bestByTeam[f.team] = f;
            }
          }
          
          resolve(Object.values(bestByTeam));
        } catch (e) {
          resolve([]);
        }
      });
      res.on('error', () => resolve([]));
    }).on('error', () => resolve([]));
  });
}

/**
 * Kelly sizing calculation
 */
function kellySize(trueProb, americanOdds) {
  if (!trueProb || !americanOdds) return null;
  
  const decimalOdds = americanOdds > 0 
    ? (americanOdds / 100) + 1 
    : (100 / Math.abs(americanOdds)) + 1;
  
  const b = decimalOdds - 1;
  const fullKelly = (b * trueProb - (1 - trueProb)) / b;
  
  if (fullKelly <= 0) return null;
  
  return {
    full: +(fullKelly * 100).toFixed(2),
    half: +(fullKelly * 50).toFixed(2),
    quarter: +(fullKelly * 25).toFixed(2),
  };
}

/**
 * Analyze a specific team's bubble position
 */
async function analyzeTeam(abbr, opts = {}) {
  const scan = await runBubbleScan(opts);
  if (scan.error) return scan;
  
  const team = scan.teamAnalysis?.find(t => t.abbr === abbr);
  if (!team) return { error: `Team ${abbr} not found or eliminated` };
  
  const edges = (scan.futuresEdges || []).filter(e => e.team === abbr);
  const clinch = (scan.clinchScenarios || []).find(s => s.team === abbr);
  
  return {
    team,
    edges,
    clinchScenario: clinch,
    bubble: team.conference === 'East' ? scan.bubbles.east : scan.bubbles.west,
  };
}

/**
 * Get status
 */
function getStatus() {
  return {
    loaded: !!nhlModel && !!nhlPlayoffSeries,
    cached: !!scanCache,
    cacheAge: scanCache ? Math.round((Date.now() - scanCacheTime) / 1000) : null,
    simulations: MC_SIMS,
    version: '87.0.0',
  };
}

module.exports = {
  runBubbleScan,
  analyzeTeam,
  getStatus,
  getCurrentStandings,
  simulateRemainingGames,
  determineSeedings,
  getSeriesWinProb,
};
