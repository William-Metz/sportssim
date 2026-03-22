/**
 * NBA Seeding Sim → Futures Value Bridge — SportsSim v55.0
 * 
 * Connects our Monte Carlo seeding simulation to LIVE futures odds
 * to find +EV championship, conference, and series futures bets.
 * 
 * THE EDGE:
 *   - Seeding is volatile in final 12 games (rest/tank/desperation)
 *   - Books price futures based on current standings, not simulated outcomes
 *   - Key battles (TOR/ATL East 6/7, MIN/DEN West 4/5) create asymmetric mispricing
 *   - A team's championship value depends HEAVILY on their first-round matchup
 *   - If DEN gets the 4 seed (favorable bracket) vs 5 seed (face OKC earlier), 
 *     their championship odds shift 3-5% — worth 200-500 in odds terms
 * 
 * FLOW:
 *   1. Run seeding simulation (10K sims) → seed probability distributions
 *   2. For each team, compute: P(seed) × P(champion|seed) = championship prob
 *   3. Pull live championship/conference/division futures from Odds API
 *   4. Compare model price vs book price → find +EV bets
 *   5. Identify series matchup edges from volatile seeding battles
 */

const nbaSeedingSim = require('./nba-seeding-sim');
const playoffSeries = require('./playoff-series');

// Cache for expensive computations
let bridgeCache = null;
let bridgeCacheTime = 0;
const BRIDGE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ==================== ODDS API ====================

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports';
const NBA_SPORT = 'basketball_nba';

// Futures market keys
const FUTURES_MARKETS = {
  championship: `${NBA_SPORT}_championship_winner`,
  conference_winner: `${NBA_SPORT}_conference_winner`, // not always available
};

// Team name → abbreviation mapping for Odds API
const NAME_MAP = {
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

/**
 * Fetch NBA championship futures from The Odds API
 */
async function fetchChampionshipFutures(apiKey) {
  if (!apiKey) return null;
  
  try {
    const fetch = (await import('node-fetch')).default;
    const url = `${ODDS_API_BASE}/${NBA_SPORT}/odds/?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
    const resp = await fetch(url, { timeout: 15000 });
    
    if (!resp.ok) {
      // Try outrights-specific endpoint
      const altUrl = `${ODDS_API_BASE}/${FUTURES_MARKETS.championship}/odds/?apiKey=${apiKey}&regions=us&oddsFormat=american`;
      const altResp = await fetch(altUrl, { timeout: 15000 });
      if (!altResp.ok) {
        console.error(`Futures fetch failed: ${resp.status} / ${altResp.status}`);
        return null;
      }
      return await altResp.json();
    }
    
    return await resp.json();
  } catch (e) {
    console.error('Championship futures fetch error:', e.message);
    return null;
  }
}

/**
 * Parse Odds API futures response into { team: { bestOdds, impliedProb, books } }
 */
function parseFuturesOdds(oddsData) {
  if (!oddsData || !Array.isArray(oddsData)) return {};
  
  const teamOdds = {};
  
  for (const event of oddsData) {
    const bookmakers = event.bookmakers || [];
    for (const book of bookmakers) {
      for (const market of (book.markets || [])) {
        if (market.key !== 'outrights') continue;
        for (const outcome of (market.outcomes || [])) {
          const teamName = outcome.name;
          const abbr = NAME_MAP[teamName];
          if (!abbr) continue;
          
          const odds = outcome.price;
          if (!teamOdds[abbr]) {
            teamOdds[abbr] = { bestOdds: odds, worstOdds: odds, books: [] };
          }
          
          teamOdds[abbr].books.push({ book: book.key, odds });
          
          // Track best (highest) odds = best payout
          if (odds > teamOdds[abbr].bestOdds) teamOdds[abbr].bestOdds = odds;
          if (odds < teamOdds[abbr].worstOdds) teamOdds[abbr].worstOdds = odds;
        }
      }
    }
  }
  
  // Calculate implied probabilities from best odds
  for (const [abbr, data] of Object.entries(teamOdds)) {
    data.impliedProb = americanToProb(data.bestOdds);
    data.consensusProb = americanToProb(data.worstOdds); // worst odds = consensus (tighter)
  }
  
  return teamOdds;
}

function americanToProb(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function probToAmerican(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== CHAMPIONSHIP PROBABILITY MODEL ====================

/**
 * Estimate championship probability from seeding probabilities.
 * 
 * Key insight: Championship odds vary dramatically by seed.
 * Historical NBA data:
 *   1 seed: ~25% chance of winning title
 *   2 seed: ~18%
 *   3 seed: ~12%
 *   4 seed: ~10%
 *   5 seed: ~7%
 *   6 seed: ~5%
 *   7 seed: ~3%
 *   8 seed: ~2%
 * 
 * But these are averages — a strong 1 seed (OKC) might be 35%,
 * while a weak 1 seed might only be 18%.
 * 
 * We adjust based on:
 *   1. Team power rating (better teams convert higher seeds at higher rates)
 *   2. Conference strength (easier conference = higher championship conversion)
 *   3. Matchup volatility (volatile seedings = option value for dark horses)
 */
function estimateChampionshipProbs(seedingResults) {
  const teams = seedingResults.teams || {};
  
  // Historical championship conversion rates by seed
  const SEED_CHAMP_RATE = {
    1: 0.25, 2: 0.18, 3: 0.12, 4: 0.10,
    5: 0.07, 6: 0.05, 7: 0.03, 8: 0.02,
    9: 0.01, 10: 0.005, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0
  };
  
  // Calculate raw championship probability for each team
  const champProbs = {};
  const powerRatings = {};
  
  // Get min/max power for scaling
  let minPower = Infinity, maxPower = -Infinity;
  for (const [abbr, team] of Object.entries(teams)) {
    const power = team.power || 0;
    if (power < minPower) minPower = power;
    if (power > maxPower) maxPower = power;
    powerRatings[abbr] = power;
  }
  const powerRange = maxPower - minPower || 1;
  
  for (const [abbr, team] of Object.entries(teams)) {
    let rawProb = 0;
    const seeds = team.seeds || {};
    
    for (let seed = 1; seed <= 15; seed++) {
      const seedPct = (seeds[seed] || 0) / 100;
      if (seedPct <= 0) continue;
      
      // Base conversion rate
      let convRate = SEED_CHAMP_RATE[seed] || 0;
      
      // Adjust by power rating — stronger teams convert at higher rates
      const powerPct = (powerRatings[abbr] - minPower) / powerRange; // 0 to 1
      const powerMult = 0.5 + powerPct * 1.5; // 0.5x to 2.0x
      convRate *= powerMult;
      
      rawProb += seedPct * convRate;
    }
    
    champProbs[abbr] = rawProb;
  }
  
  // Normalize so all probabilities sum to 100%
  const totalProb = Object.values(champProbs).reduce((s, p) => s + p, 0);
  for (const abbr of Object.keys(champProbs)) {
    champProbs[abbr] = totalProb > 0 ? champProbs[abbr] / totalProb : 0;
  }
  
  return champProbs;
}

/**
 * Estimate conference winner probabilities from seeding + power ratings
 */
function estimateConferenceWinnerProbs(seedingResults) {
  const teams = seedingResults.teams || {};
  const confProbs = { East: {}, West: {} };
  
  // Conference title conversion rates (higher seeds win conf more often)
  const SEED_CONF_RATE = {
    1: 0.38, 2: 0.25, 3: 0.15, 4: 0.10,
    5: 0.06, 6: 0.03, 7: 0.02, 8: 0.01,
    9: 0.003, 10: 0.001, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0
  };
  
  for (const [abbr, team] of Object.entries(teams)) {
    const conf = team.conference;
    if (!conf) continue;
    
    let rawProb = 0;
    const seeds = team.seeds || {};
    
    for (let seed = 1; seed <= 15; seed++) {
      const seedPct = (seeds[seed] || 0) / 100;
      if (seedPct <= 0) continue;
      rawProb += seedPct * (SEED_CONF_RATE[seed] || 0);
    }
    
    // Power adjustment
    const powerMult = 0.6 + Math.max(0, Math.min(1, (team.power || 5) / 15)) * 1.2;
    rawProb *= powerMult;
    
    confProbs[conf][abbr] = rawProb;
  }
  
  // Normalize per conference
  for (const conf of ['East', 'West']) {
    const total = Object.values(confProbs[conf]).reduce((s, p) => s + p, 0);
    for (const abbr of Object.keys(confProbs[conf])) {
      confProbs[conf][abbr] = total > 0 ? confProbs[conf][abbr] / total : 0;
    }
  }
  
  return confProbs;
}

// ==================== MATCHUP EDGE ANALYSIS ====================

/**
 * Identify series matchup edges from volatile seeding battles.
 * When two teams are close in seeding, the matchup changes create
 * futures value — e.g., if Team A gets the 4 seed they face a weak 5 seed,
 * but if they drop to 5 they face the dominant 4 seed.
 */
function findMatchupEdges(seedingResults) {
  const matchups = seedingResults.matchups || {};
  const teams = seedingResults.teams || {};
  const edges = [];
  
  for (const [key, options] of Object.entries(matchups)) {
    if (options.length < 2) continue;
    
    // Conference and round info from key (e.g., "East_R1_1" = East conference, Round 1, #1 seed matchup)
    const [conf, round, slot] = key.split('_');
    
    // Find matchups where multiple outcomes are likely (volatile)
    const topMatchup = options[0];
    const secondMatchup = options[1];
    
    if (topMatchup.prob < 70 && secondMatchup.prob > 15) {
      // Volatile matchup — multiple outcomes plausible
      const edge = {
        conference: conf,
        round,
        slot: parseInt(slot),
        primary: topMatchup,
        alternate: secondMatchup,
        volatility: 100 - topMatchup.prob,
        allOptions: options.slice(0, 5),
        insight: null
      };
      
      // Identify which teams benefit from matchup shifts
      const primaryTeams = topMatchup.matchup.split(' vs ');
      const altTeams = secondMatchup.matchup.split(' vs ');
      
      // Look for teams that appear in one matchup but not another
      const affected = new Set([...primaryTeams, ...altTeams]);
      for (const team of affected) {
        const trimmed = team.trim();
        const teamData = teams[trimmed];
        if (teamData) {
          edge.insight = `${conf} ${round} Slot ${slot}: ${topMatchup.matchup} (${topMatchup.prob}%) vs ${secondMatchup.matchup} (${secondMatchup.prob}%) — bracket volatility creates series futures edge`;
        }
      }
      
      edges.push(edge);
    }
  }
  
  return edges.sort((a, b) => b.volatility - a.volatility);
}

// ==================== MAIN ANALYSIS ====================

/**
 * Full seeding → futures value analysis
 */
async function analyzeSeedingFuturesValue(apiKey, opts = {}) {
  const { fresh = false } = opts;
  
  // Check cache
  if (!fresh && bridgeCache && (Date.now() - bridgeCacheTime < BRIDGE_CACHE_TTL)) {
    return bridgeCache;
  }
  
  const startTime = Date.now();
  
  // Step 1: Run seeding simulation
  if (fresh) nbaSeedingSim.clearCache();
  const seedingResults = await nbaSeedingSim.getCachedSimulation(10000);
  
  // Step 2: Estimate championship + conference probabilities
  const champProbs = estimateChampionshipProbs(seedingResults);
  const confWinnerProbs = estimateConferenceWinnerProbs(seedingResults);
  
  // Step 3: Fetch live futures odds
  const futuresData = await fetchChampionshipFutures(apiKey);
  const marketOdds = parseFuturesOdds(futuresData);
  
  // Step 4: Compare model vs market — find +EV bets
  const teamAnalysis = {};
  const valueBets = [];
  
  for (const [abbr, team] of Object.entries(seedingResults.teams || {})) {
    const modelChampProb = champProbs[abbr] || 0;
    const conf = team.conference;
    const modelConfProb = confWinnerProbs[conf]?.[abbr] || 0;
    const market = marketOdds[abbr];
    
    const analysis = {
      team: abbr,
      name: team.name,
      conference: conf,
      currentRecord: `${team.current?.w}-${team.current?.l}`,
      projectedWins: team.projected?.avgWins,
      mostLikelySeed: team.mostLikelySeed,
      seedDistribution: team.seeds,
      playoffProb: team.playoffProb,
      model: {
        championshipProb: +(modelChampProb * 100).toFixed(2),
        conferenceProb: +(modelConfProb * 100).toFixed(2),
        fairChampOdds: modelChampProb > 0.001 ? probToAmerican(modelChampProb) : null,
        fairConfOdds: modelConfProb > 0.001 ? probToAmerican(modelConfProb) : null
      },
      market: market ? {
        bestOdds: market.bestOdds,
        impliedProb: +(market.impliedProb * 100).toFixed(2),
        books: market.books.length,
        bookList: market.books.slice(0, 5)
      } : null,
      edge: null
    };
    
    // Calculate edge
    if (market && modelChampProb > 0.005) {
      const marketProb = market.impliedProb;
      const edge = modelChampProb - marketProb;
      const edgePct = +(edge * 100).toFixed(2);
      const ev = edge / marketProb;
      
      analysis.edge = {
        champEdge: edgePct,
        champEV: +(ev * 100).toFixed(1),
        direction: edgePct > 0 ? 'VALUE' : 'OVERPRICED',
        strength: Math.abs(edgePct) > 5 ? 'STRONG' : Math.abs(edgePct) > 2 ? 'MODERATE' : 'SLIGHT'
      };
      
      // Track value bets
      if (edgePct > 1.5) {
        valueBets.push({
          team: abbr,
          name: team.name,
          conference: conf,
          bet: `${abbr} Championship`,
          modelProb: +(modelChampProb * 100).toFixed(2),
          marketProb: +(marketProb * 100).toFixed(2),
          edge: edgePct,
          ev: +(ev * 100).toFixed(1),
          bestOdds: market.bestOdds,
          fairOdds: probToAmerican(modelChampProb),
          seedVolatility: team.mostLikelySeedPct < 60 ? 'HIGH' : team.mostLikelySeedPct < 80 ? 'MODERATE' : 'LOW',
          projectedSeed: team.mostLikelySeed,
          reasoning: generateReasoning(abbr, team, modelChampProb, marketProb, seedingResults)
        });
      }
      
      // Also check for OVERPRICED teams (fade opportunity)
      if (edgePct < -3) {
        valueBets.push({
          team: abbr,
          name: team.name,
          conference: conf,
          bet: `FADE ${abbr} Championship`,
          modelProb: +(modelChampProb * 100).toFixed(2),
          marketProb: +(marketProb * 100).toFixed(2),
          edge: edgePct,
          ev: +(ev * 100).toFixed(1),
          bestOdds: market.bestOdds,
          fairOdds: probToAmerican(modelChampProb),
          direction: 'FADE',
          reasoning: `Market overvalues ${abbr} — our model gives ${(modelChampProb * 100).toFixed(1)}% championship prob vs market's ${(marketProb * 100).toFixed(1)}%`
        });
      }
    }
    
    teamAnalysis[abbr] = analysis;
  }
  
  // Step 5: Find matchup edges from volatile seedings
  const matchupEdges = findMatchupEdges(seedingResults);
  
  // Step 6: Conference winner value
  const confValueBets = [];
  for (const conf of ['East', 'West']) {
    const confTeams = Object.entries(confWinnerProbs[conf] || {})
      .sort((a, b) => b[1] - a[1]);
    
    for (const [abbr, modelProb] of confTeams) {
      if (modelProb < 0.03) continue;
      
      confValueBets.push({
        team: abbr,
        name: seedingResults.teams[abbr]?.name,
        conference: conf,
        bet: `${abbr} ${conf}ern Conference Winner`,
        modelProb: +(modelProb * 100).toFixed(1),
        fairOdds: probToAmerican(modelProb),
        projectedSeed: seedingResults.teams[abbr]?.mostLikelySeed,
        playoffProb: seedingResults.teams[abbr]?.playoffProb
      });
    }
  }
  
  // Sort value bets by edge (descending)
  valueBets.sort((a, b) => (b.edge || 0) - (a.edge || 0));
  
  const result = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    seedingSource: {
      simulations: seedingResults.simulations,
      gamesRemaining: seedingResults.schedule?.gamesRemaining,
      generatedAt: seedingResults.generatedAt
    },
    futuresMarket: {
      teamsWithOdds: Object.keys(marketOdds).length,
      source: 'The Odds API',
      available: Object.keys(marketOdds).length > 0
    },
    topValueBets: valueBets.slice(0, 20),
    conferenceValueBets: confValueBets,
    matchupEdges,
    teamAnalysis,
    summary: {
      totalValueBets: valueBets.filter(b => b.edge > 0).length,
      totalFades: valueBets.filter(b => b.direction === 'FADE').length,
      bestBet: valueBets[0] || null,
      highVolatilityMatchups: matchupEdges.filter(e => e.volatility > 40).length,
      keyBattles: nbaSeedingSim.getKeyBattles(seedingResults),
      insight: generateTopInsight(valueBets, matchupEdges, seedingResults)
    }
  };
  
  // Cache result
  bridgeCache = result;
  bridgeCacheTime = Date.now();
  
  return result;
}

function generateReasoning(abbr, team, modelProb, marketProb, seedingResults) {
  const parts = [];
  
  // Seeding volatility
  if (team.mostLikelySeedPct < 50) {
    parts.push(`Seeding highly volatile — ${team.mostLikelySeed} seed only ${team.mostLikelySeedPct}% likely`);
  }
  
  // Playoff probability
  if (team.playoffProb < 100 && team.playoffProb > 50) {
    parts.push(`${team.playoffProb}% playoff probability = uncertainty creates value`);
  }
  
  // Edge direction
  if (modelProb > marketProb) {
    parts.push(`Model gives ${(modelProb * 100).toFixed(1)}% vs market's ${(marketProb * 100).toFixed(1)}% = undervalued`);
  }
  
  // Win projection vs current pace
  if (team.projected?.avgWins) {
    const currentPace = (team.current?.w / (team.current?.w + team.current?.l)) * 82;
    const diff = team.projected.avgWins - currentPace;
    if (Math.abs(diff) > 2) {
      parts.push(`Projected ${team.projected.avgWins}W vs ${currentPace.toFixed(0)}W pace = ${diff > 0 ? 'trending up' : 'trending down'}`);
    }
  }
  
  return parts.join('. ') || `Model favors ${abbr} championship odds`;
}

function generateTopInsight(valueBets, matchupEdges, seedingResults) {
  const topValue = valueBets.filter(b => b.edge > 3 && b.direction !== 'FADE');
  const topFades = valueBets.filter(b => b.direction === 'FADE');
  
  const parts = [];
  
  if (topValue.length > 0) {
    parts.push(`🎯 ${topValue.length} championship value bets: ${topValue.slice(0, 3).map(b => `${b.team} (+${b.edge}%)`).join(', ')}`);
  }
  
  if (topFades.length > 0) {
    parts.push(`⚠️ Overpriced: ${topFades.slice(0, 3).map(b => `${b.team} (${b.edge}%)`).join(', ')}`);
  }
  
  if (matchupEdges.filter(e => e.volatility > 40).length > 0) {
    parts.push(`🔄 ${matchupEdges.filter(e => e.volatility > 40).length} volatile bracket matchups creating series futures edge`);
  }
  
  return parts.join(' | ') || 'Analyzing seeding → futures value...';
}

module.exports = {
  analyzeSeedingFuturesValue,
  estimateChampionshipProbs,
  estimateConferenceWinnerProbs,
  findMatchupEdges
};
