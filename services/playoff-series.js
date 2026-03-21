/**
 * NBA Playoff Series Pricing Model
 * 
 * Historically, series prices are among the most inefficient markets in sports betting.
 * Books often just extend single-game lines without accounting for:
 * - Home court advantage compounding (2-2-1-1-1 format)
 * - Momentum and adjustment effects in a 7-game series
 * - Injury risk accumulation
 * - Playoff-specific performance (stars elevate, role players shrink)
 * - Series length distribution (sweep vs. 7 games)
 * 
 * This model uses Monte Carlo simulation + binomial math to price series correctly.
 */

const PLAYOFF_HCA_BOOST = 0.5; // Playoff HCA is slightly higher than regular season
const PLAYOFF_STAR_BOOST = 0.02; // Stars perform ~2% better in playoffs
const FATIGUE_PER_GAME = 0.003; // Slight fatigue factor per game played
const MC_SIMULATIONS = 50000; // Monte Carlo iterations for series simulation
const UPSET_ALERT_THRESHOLD = 0.35; // Flag series where underdog has 35%+ chance

// Home court pattern for best-of-7 (higher seed perspective): H,H,A,A,H,A,H
const SERIES_PATTERN_7 = [true, true, false, false, true, false, true];
// For first round, the higher seed has home court
// For later rounds, re-seeding determines HCA

/**
 * Calculate single-game win probability for playoff context
 * Adjusts regular season predict() output for playoff-specific factors
 */
function playoffGameProb(higherSeedWinProbRegSeason, isHome, gameNumber, seriesState) {
  let prob = higherSeedWinProbRegSeason / 100; // convert from percentage
  
  // 1. Home court adjustment (apply to this specific game)
  // If higher seed is home, they get a boost; if away, penalty
  // Our base predict() already accounts for HCA, so we just add the playoff premium
  if (isHome) {
    prob += PLAYOFF_HCA_BOOST / 100; // ~0.5% extra in playoffs
  } else {
    prob -= PLAYOFF_HCA_BOOST / 100;
  }
  
  // 2. Star boost — playoff performance is more star-driven
  // Top teams (with stars) get a slight edge; this is baked into the differential
  // We model it as the favorite getting slightly better
  if (prob > 0.5) {
    prob += PLAYOFF_STAR_BOOST;
  } else {
    prob -= PLAYOFF_STAR_BOOST * 0.5; // Underdogs slightly more hurt
  }
  
  // 3. Fatigue — later games in a long series slightly favor the fresher team
  // Minimal effect but real — game 7 is slightly more random
  const fatigueNoise = (gameNumber - 1) * FATIGUE_PER_GAME;
  // Fatigue pushes toward 50/50 (regression)
  prob = prob + (0.5 - prob) * fatigueNoise;
  
  // 4. Trailing team desperation — teams facing elimination historically play ~2% better
  if (seriesState) {
    const { higherWins, lowerWins } = seriesState;
    // If higher seed is facing elimination (down 3-x), their effort spikes
    if (higherWins < lowerWins && lowerWins === 3) {
      prob += 0.02; // Desperation boost
    }
    // If lower seed is facing elimination
    if (lowerWins < higherWins && higherWins === 3) {
      prob -= 0.01; // Lower seed desperation (slightly less impact since they're already trailing)
    }
    // Momentum — team that won last game gets tiny boost
    // (we don't track this in sim, simplified)
  }
  
  // Clamp
  return Math.max(0.15, Math.min(0.85, prob));
}

/**
 * Exact binomial series probability
 * Calculate P(team wins best-of-7) using recursive/combinatorial approach
 * Accounts for variable game-by-game probabilities (HCA pattern)
 */
function binomialSeriesProb(gameProbs) {
  // gameProbs = array of 7 probabilities (higher seed win prob for each potential game)
  // We need to enumerate all paths where higher seed wins 4+ games
  
  // Dynamic programming: state = (higherWins, lowerWins)
  // Start at (0,0), end when either reaches 4
  const memo = {};
  
  function dp(hw, lw) {
    if (hw === 4) return 1.0; // higher seed wins series
    if (lw === 4) return 0.0; // lower seed wins series
    
    const key = `${hw}-${lw}`;
    if (memo[key] !== undefined) return memo[key];
    
    const gameNum = hw + lw; // 0-indexed game number
    const p = gameProbs[gameNum]; // P(higher seed wins this game)
    
    const result = p * dp(hw + 1, lw) + (1 - p) * dp(hw, lw + 1);
    memo[key] = result;
    return result;
  }
  
  return dp(0, 0);
}

/**
 * Monte Carlo series simulation
 * Returns detailed distribution of outcomes
 */
function monteCarloSeries(gameProbs, sims = MC_SIMULATIONS) {
  const results = {
    higherSeedWins: 0,
    lowerSeedWins: 0,
    seriesLength: { 4: 0, 5: 0, 6: 0, 7: 0 },
    higherSeedIn: { 4: 0, 5: 0, 6: 0, 7: 0 },
    lowerSeedIn: { 4: 0, 5: 0, 6: 0, 7: 0 },
    // Track game-by-game outcomes
    gameWinPcts: [0, 0, 0, 0, 0, 0, 0] // higher seed win % in each game
  };
  
  const gameCounts = [0, 0, 0, 0, 0, 0, 0]; // how many times each game was played
  
  for (let i = 0; i < sims; i++) {
    let hw = 0, lw = 0;
    let gamesPlayed = 0;
    
    while (hw < 4 && lw < 4) {
      const gameIdx = hw + lw;
      const p = playoffGameProb(
        gameProbs[gameIdx] * 100, // convert back to percentage for the function
        SERIES_PATTERN_7[gameIdx],
        gameIdx + 1,
        { higherWins: hw, lowerWins: lw }
      );
      
      gameCounts[gameIdx]++;
      if (Math.random() < p) {
        hw++;
        results.gameWinPcts[gameIdx]++;
      } else {
        lw++;
      }
      gamesPlayed++;
    }
    
    const len = gamesPlayed;
    results.seriesLength[len]++;
    
    if (hw === 4) {
      results.higherSeedWins++;
      results.higherSeedIn[len]++;
    } else {
      results.lowerSeedWins++;
      results.lowerSeedIn[len]++;
    }
  }
  
  // Normalize
  for (let g = 0; g < 7; g++) {
    results.gameWinPcts[g] = gameCounts[g] > 0 
      ? +(results.gameWinPcts[g] / gameCounts[g] * 100).toFixed(1) 
      : 0;
  }
  
  return {
    higherSeedWinPct: +(results.higherSeedWins / sims * 100).toFixed(1),
    lowerSeedWinPct: +(results.lowerSeedWins / sims * 100).toFixed(1),
    expectedLength: +(Object.entries(results.seriesLength)
      .reduce((sum, [len, count]) => sum + (parseInt(len) * count), 0) / sims).toFixed(2),
    lengthDistribution: {
      sweep: +((results.seriesLength[4] / sims) * 100).toFixed(1),
      in5: +((results.seriesLength[5] / sims) * 100).toFixed(1),
      in6: +((results.seriesLength[6] / sims) * 100).toFixed(1),
      in7: +((results.seriesLength[7] / sims) * 100).toFixed(1)
    },
    higherSeedInN: {
      sweep: +((results.higherSeedIn[4] / sims) * 100).toFixed(1),
      in5: +((results.higherSeedIn[5] / sims) * 100).toFixed(1),
      in6: +((results.higherSeedIn[6] / sims) * 100).toFixed(1),
      in7: +((results.higherSeedIn[7] / sims) * 100).toFixed(1)
    },
    lowerSeedInN: {
      sweep: +((results.lowerSeedIn[4] / sims) * 100).toFixed(1),
      in5: +((results.lowerSeedIn[5] / sims) * 100).toFixed(1),
      in6: +((results.lowerSeedIn[6] / sims) * 100).toFixed(1),
      in7: +((results.lowerSeedIn[7] / sims) * 100).toFixed(1)
    },
    gameByGame: results.gameWinPcts.map((p, i) => ({
      game: i + 1,
      location: SERIES_PATTERN_7[i] ? 'Higher Seed Home' : 'Lower Seed Home',
      higherSeedWinPct: p
    })),
    simulations: sims
  };
}

/**
 * Full series analysis between two teams
 * Uses the NBA model's predict() for base probabilities, then layers playoff adjustments
 */
function analyzePlayoffSeries(nbaModel, higherSeed, lowerSeed, opts = {}) {
  // Get base prediction with higher seed at home
  const homeGamePred = nbaModel.predict(lowerSeed, higherSeed, opts);
  // Get base prediction with lower seed at home  
  const awayGamePred = nbaModel.predict(higherSeed, lowerSeed, opts);
  
  if (homeGamePred.error || awayGamePred.error) {
    return { error: `Unknown team: ${homeGamePred.error || awayGamePred.error}` };
  }
  
  // Higher seed's win probability at home and away
  const pHome = homeGamePred.homeWinProb / 100; // Higher seed is home team
  const pAway = awayGamePred.awayWinProb / 100; // Higher seed is away team
  
  // Build game-by-game probability array based on 2-2-1-1-1 format
  const gameProbs = SERIES_PATTERN_7.map(isHigherSeedHome => 
    isHigherSeedHome ? pHome : pAway
  );
  
  // Exact binomial calculation
  const exactSeriesProb = binomialSeriesProb(gameProbs);
  
  // Monte Carlo simulation (with playoff adjustments like fatigue, desperation)
  const mcResults = monteCarloSeries(gameProbs);
  
  // Blend: 60% binomial (exact math), 40% MC (captures dynamics)
  const blendedProb = exactSeriesProb * 0.6 + (mcResults.higherSeedWinPct / 100) * 0.4;
  
  // Convert to moneyline
  const higherML = probToML(blendedProb);
  const lowerML = probToML(1 - blendedProb);
  
  // Get team info
  const teams = nbaModel.getTeams();
  const higherTeam = teams[higherSeed];
  const lowerTeam = teams[lowerSeed];
  
  const ratings = nbaModel.calculateRatings();
  const higherRating = ratings[higherSeed];
  const lowerRating = ratings[lowerSeed];
  
  return {
    higherSeed: {
      abbr: higherSeed,
      name: higherTeam?.name || higherSeed,
      record: higherTeam ? `${higherTeam.w}-${higherTeam.l}` : 'N/A',
      power: higherRating?.power || 0,
      rank: higherRating?.rank || 0,
      tier: higherRating?.tier || 'N/A'
    },
    lowerSeed: {
      abbr: lowerSeed,
      name: lowerTeam?.name || lowerSeed,
      record: lowerTeam ? `${lowerTeam.w}-${lowerTeam.l}` : 'N/A',
      power: lowerRating?.power || 0,
      rank: lowerRating?.rank || 0,
      tier: lowerRating?.tier || 'N/A'
    },
    seriesPrice: {
      higherSeedWinPct: +(blendedProb * 100).toFixed(1),
      lowerSeedWinPct: +((1 - blendedProb) * 100).toFixed(1),
      higherSeedML: higherML,
      lowerSeedML: lowerML,
      fairOdds: {
        higher: higherML > 0 ? `+${higherML}` : `${higherML}`,
        lower: lowerML > 0 ? `+${lowerML}` : `${lowerML}`
      }
    },
    singleGameEdge: {
      atHigherHome: {
        higherWinPct: +(pHome * 100).toFixed(1),
        spread: homeGamePred.spread
      },
      atLowerHome: {
        higherWinPct: +(pAway * 100).toFixed(1),
        spread: awayGamePred.spread
      }
    },
    exactBinomial: {
      higherSeedWinPct: +(exactSeriesProb * 100).toFixed(1),
      lowerSeedWinPct: +((1 - exactSeriesProb) * 100).toFixed(1)
    },
    monteCarlo: mcResults,
    expectedLength: mcResults.expectedLength,
    lengthDistribution: mcResults.lengthDistribution,
    upsetAlert: (1 - blendedProb) >= UPSET_ALERT_THRESHOLD,
    competitiveness: blendedProb < 0.55 ? 'COIN FLIP' : 
                     blendedProb < 0.65 ? 'COMPETITIVE' :
                     blendedProb < 0.75 ? 'FAVORED' :
                     blendedProb < 0.85 ? 'HEAVY FAVORITE' : 'DOMINANT'
  };
}

/**
 * Convert probability to American moneyline
 */
function probToML(prob) {
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  }
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Convert American moneyline to probability
 */
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

/**
 * Project playoff bracket from current standings
 * NBA uses conference-based seeding, 1v8, 2v7, 3v6, 4v5
 * Play-in: 7v8, 9v10 → losers play for 8th seed
 */
function projectBracket(nbaModel) {
  const ratings = nbaModel.calculateRatings();
  const teams = nbaModel.getTeams();
  
  // Conference assignments
  const EAST = ['ATL','BOS','BKN','CHA','CHI','CLE','DET','IND','MIA','MIL','NYK','ORL','PHI','TOR','WAS'];
  const WEST = ['DAL','DEN','GSW','HOU','LAC','LAL','MEM','MIN','NOP','OKC','PHX','POR','SAC','SAS','UTA'];
  
  function getSortedConference(confTeams) {
    return confTeams
      .filter(abbr => teams[abbr])
      .map(abbr => ({
        abbr,
        name: teams[abbr].name,
        w: teams[abbr].w,
        l: teams[abbr].l,
        wpct: teams[abbr].w / (teams[abbr].w + teams[abbr].l),
        power: ratings[abbr]?.power || 0,
        rank: ratings[abbr]?.rank || 0,
        tier: ratings[abbr]?.tier || 'N/A',
        diff: teams[abbr].diff
      }))
      .sort((a, b) => b.wpct - a.wpct || b.diff - a.diff);
  }
  
  const eastStandings = getSortedConference(EAST);
  const westStandings = getSortedConference(WEST);
  
  // Top 6 = locked playoff, 7-10 = play-in
  function buildBracket(standings) {
    const locked = standings.slice(0, 6);
    const playIn = standings.slice(6, 10);
    
    // Matchups: 1v8, 2v7, 3v6, 4v5
    // 7 and 8 come from play-in (we project 7 and 8 seeds as most likely)
    const projected7 = playIn[0]; // 7 seed most likely to survive play-in
    const projected8 = playIn[1]; // 8 seed next most likely
    
    const seeds = [...locked, projected7, projected8];
    
    return {
      standings: standings.map((t, i) => ({ ...t, seed: i + 1 })),
      playoffTeams: seeds.map((t, i) => ({ ...t, seed: i + 1 })),
      playInTeams: playIn.map((t, i) => ({ ...t, seed: i + 7 })),
      matchups: [
        { round: 1, matchup: '1v8', higher: { ...seeds[0], seed: 1 }, lower: { ...seeds[7], seed: 8 } },
        { round: 1, matchup: '2v7', higher: { ...seeds[1], seed: 2 }, lower: { ...seeds[6], seed: 7 } },
        { round: 1, matchup: '3v6', higher: { ...seeds[2], seed: 3 }, lower: { ...seeds[5], seed: 6 } },
        { round: 1, matchup: '4v5', higher: { ...seeds[3], seed: 4 }, lower: { ...seeds[4], seed: 5 } }
      ]
    };
  }
  
  const eastBracket = buildBracket(eastStandings);
  const westBracket = buildBracket(westStandings);
  
  // Analyze each first-round matchup
  function analyzeMatchups(bracket) {
    return bracket.matchups.map(m => {
      const series = analyzePlayoffSeries(nbaModel, m.higher.abbr, m.lower.abbr);
      return {
        ...m,
        series: {
          higherSeedWinPct: series.seriesPrice.higherSeedWinPct,
          lowerSeedWinPct: series.seriesPrice.lowerSeedWinPct,
          higherSeedML: series.seriesPrice.fairOdds.higher,
          lowerSeedML: series.seriesPrice.fairOdds.lower,
          expectedLength: series.expectedLength,
          competitiveness: series.competitiveness,
          upsetAlert: series.upsetAlert,
          lengthDistribution: series.lengthDistribution
        }
      };
    });
  }
  
  return {
    eastern: {
      ...eastBracket,
      matchups: analyzeMatchups(eastBracket)
    },
    western: {
      ...westBracket,
      matchups: analyzeMatchups(westBracket)
    },
    playoffsStart: '2026-04-12',
    daysUntilPlayoffs: Math.max(0, Math.floor((new Date('2026-04-12') - new Date()) / 86400000))
  };
}

/**
 * Simulate full playoff bracket (all 4 rounds) via Monte Carlo
 * Returns championship probabilities for each team
 * 
 * OPTIMIZED: Pre-computes all pairwise probabilities once, then runs fast MC
 */
function simulateFullPlayoffs(nbaModel, sims = 10000) {
  const bracket = projectBracket(nbaModel);
  const champCount = {};
  const finalsCount = {};
  const confFinalsCount = {};
  
  // Initialize
  const allTeams = [...bracket.eastern.playoffTeams, ...bracket.western.playoffTeams];
  allTeams.forEach(t => {
    champCount[t.abbr] = 0;
    finalsCount[t.abbr] = 0;
    confFinalsCount[t.abbr] = 0;
  });
  
  // PRE-COMPUTE: Build probability cache for all possible matchups
  const probCache = {};
  const ratings = nbaModel.calculateRatings();
  const teamAbbrs = allTeams.map(t => t.abbr);
  
  for (let i = 0; i < teamAbbrs.length; i++) {
    for (let j = i + 1; j < teamAbbrs.length; j++) {
      const a = teamAbbrs[i], b = teamAbbrs[j];
      // Determine higher seed by power
      const aPower = ratings[a]?.power || 0;
      const bPower = ratings[b]?.power || 0;
      const higher = aPower >= bPower ? a : b;
      const lower = aPower >= bPower ? b : a;
      
      const homeGamePred = nbaModel.predict(lower, higher);
      const awayGamePred = nbaModel.predict(higher, lower);
      
      const pHome = (homeGamePred.error ? 0.5 : homeGamePred.homeWinProb / 100);
      const pAway = (awayGamePred.error ? 0.5 : awayGamePred.awayWinProb / 100);
      
      const key = `${higher}-${lower}`;
      probCache[key] = { pHome, pAway, higher, lower };
    }
  }
  
  // Fast series simulator using pre-computed probs
  function fastSimSeries(teamA, teamB) {
    const aPower = ratings[teamA]?.power || 0;
    const bPower = ratings[teamB]?.power || 0;
    const higher = aPower >= bPower ? teamA : teamB;
    const lower = aPower >= bPower ? teamB : teamA;
    
    const key = `${higher}-${lower}`;
    const probs = probCache[key];
    if (!probs) return higher; // fallback
    
    let hw = 0, lw = 0;
    while (hw < 4 && lw < 4) {
      const gameIdx = hw + lw;
      const isHome = SERIES_PATTERN_7[gameIdx];
      const baseP = isHome ? probs.pHome : probs.pAway;
      const p = playoffGameProb(baseP * 100, isHome, gameIdx + 1, { higherWins: hw, lowerWins: lw });
      
      if (Math.random() < p) { hw++; } else { lw++; }
    }
    return hw === 4 ? higher : lower;
  }
  
  for (let sim = 0; sim < sims; sim++) {
    // Simulate each conference
    const eastR1 = bracket.eastern.matchups.map(m => fastSimSeries(m.higher.abbr, m.lower.abbr));
    const westR1 = bracket.western.matchups.map(m => fastSimSeries(m.higher.abbr, m.lower.abbr));
    
    // Second round (re-seeded)
    const eastR2 = [fastSimSeries(eastR1[0], eastR1[3]), fastSimSeries(eastR1[1], eastR1[2])];
    const westR2 = [fastSimSeries(westR1[0], westR1[3]), fastSimSeries(westR1[1], westR1[2])];
    
    // Conference Finals
    const eastWinner = fastSimSeries(eastR2[0], eastR2[1]);
    const westWinner = fastSimSeries(westR2[0], westR2[1]);
    
    confFinalsCount[eastWinner] = (confFinalsCount[eastWinner] || 0) + 1;
    confFinalsCount[westWinner] = (confFinalsCount[westWinner] || 0) + 1;
    finalsCount[eastWinner] = (finalsCount[eastWinner] || 0) + 1;
    finalsCount[westWinner] = (finalsCount[westWinner] || 0) + 1;
    
    // Finals
    const champion = fastSimSeries(eastWinner, westWinner);
    champCount[champion] = (champCount[champion] || 0) + 1;
  }
  
  // Compile results
  const results = allTeams.map(t => ({
    abbr: t.abbr,
    name: t.name,
    seed: t.seed,
    record: `${t.w}-${t.l}`,
    power: t.power,
    champPct: +(champCount[t.abbr] / sims * 100).toFixed(1),
    finalsPct: +(finalsCount[t.abbr] / sims * 100).toFixed(1),
    confFinalsPct: +(confFinalsCount[t.abbr] / sims * 100).toFixed(1),
    champML: probToML(Math.max(champCount[t.abbr] / sims, 0.001))
  })).sort((a, b) => b.champPct - a.champPct);
  
  return {
    championshipOdds: results,
    simulations: sims,
    topContenders: results.slice(0, 6),
    darkHorses: results.filter(t => t.champPct >= 2 && t.champPct < 10)
  };
}

/**
 * Simulate a single best-of-7 series, return winner abbr
 * Used for individual series analysis (not bulk sim)
 */
function simulateSingleSeries(nbaModel, higherSeed, lowerSeed) {
  // Get base prediction
  const homeGamePred = nbaModel.predict(lowerSeed, higherSeed);
  const awayGamePred = nbaModel.predict(higherSeed, lowerSeed);
  
  if (homeGamePred.error || awayGamePred.error) return higherSeed; // fallback
  
  const pHome = homeGamePred.homeWinProb / 100;
  const pAway = awayGamePred.awayWinProb / 100;
  
  let hw = 0, lw = 0;
  while (hw < 4 && lw < 4) {
    const gameIdx = hw + lw;
    const isHome = SERIES_PATTERN_7[gameIdx];
    const baseP = isHome ? pHome : pAway;
    const p = playoffGameProb(
      baseP * 100, isHome, gameIdx + 1,
      { higherWins: hw, lowerWins: lw }
    );
    
    if (Math.random() < p) {
      hw++;
    } else {
      lw++;
    }
  }
  
  return hw === 4 ? higherSeed : lowerSeed;
}

/**
 * Find value in series pricing
 * Compare our model's series probabilities against book odds
 */
function findSeriesValue(nbaModel, seriesMatchups) {
  // seriesMatchups: [{ higher, lower, bookHigherML, bookLowerML }]
  const values = [];
  
  for (const matchup of seriesMatchups) {
    const series = analyzePlayoffSeries(nbaModel, matchup.higher, matchup.lower);
    if (series.error) continue;
    
    const modelHigherProb = series.seriesPrice.higherSeedWinPct / 100;
    const modelLowerProb = series.seriesPrice.lowerSeedWinPct / 100;
    
    // Compare vs book
    if (matchup.bookHigherML) {
      const bookHigherProb = mlToProb(matchup.bookHigherML);
      const higherEdge = modelHigherProb - bookHigherProb;
      
      if (higherEdge > 0.03) {
        values.push({
          pick: `${series.higherSeed.name} to win series`,
          side: series.higherSeed.abbr,
          bookML: matchup.bookHigherML,
          bookProb: +(bookHigherProb * 100).toFixed(1),
          modelProb: +(modelHigherProb * 100).toFixed(1),
          edge: +(higherEdge * 100).toFixed(1),
          ev: calcEV(modelHigherProb, matchup.bookHigherML),
          confidence: higherEdge >= 0.08 ? 'HIGH' : higherEdge >= 0.05 ? 'MEDIUM' : 'LOW',
          kelly: kellySize(modelHigherProb, matchup.bookHigherML),
          series: `${series.higherSeed.abbr} vs ${series.lowerSeed.abbr}`,
          competitiveness: series.competitiveness,
          expectedLength: series.expectedLength
        });
      }
    }
    
    if (matchup.bookLowerML) {
      const bookLowerProb = mlToProb(matchup.bookLowerML);
      const lowerEdge = modelLowerProb - bookLowerProb;
      
      if (lowerEdge > 0.03) {
        values.push({
          pick: `${series.lowerSeed.name} to win series`,
          side: series.lowerSeed.abbr,
          bookML: matchup.bookLowerML,
          bookProb: +(bookLowerProb * 100).toFixed(1),
          modelProb: +(modelLowerProb * 100).toFixed(1),
          edge: +(lowerEdge * 100).toFixed(1),
          ev: calcEV(modelLowerProb, matchup.bookLowerML),
          confidence: lowerEdge >= 0.08 ? 'HIGH' : lowerEdge >= 0.05 ? 'MEDIUM' : 'LOW',
          kelly: kellySize(modelLowerProb, matchup.bookLowerML),
          series: `${series.higherSeed.abbr} vs ${series.lowerSeed.abbr}`,
          competitiveness: series.competitiveness,
          expectedLength: series.expectedLength
        });
      }
    }
  }
  
  return values.sort((a, b) => b.edge - a.edge);
}

/**
 * Exact series length probability distribution using binomial expansion
 * More accurate than MC for length pricing (exact 4, 5, 6, 7 probs)
 */
function exactLengthDistribution(gameProbs) {
  // Enumerate all possible series outcomes
  const dist = { 4: { higher: 0, lower: 0 }, 5: { higher: 0, lower: 0 }, 6: { higher: 0, lower: 0 }, 7: { higher: 0, lower: 0 } };
  
  function enumerate(hw, lw, prob) {
    if (hw === 4) {
      const len = hw + lw;
      dist[len].higher += prob;
      return;
    }
    if (lw === 4) {
      const len = hw + lw;
      dist[len].lower += prob;
      return;
    }
    
    const gameIdx = hw + lw;
    const p = gameProbs[gameIdx];
    enumerate(hw + 1, lw, prob * p);
    enumerate(hw, lw + 1, prob * (1 - p));
  }
  
  enumerate(0, 0, 1.0);
  
  return {
    4: { total: +(( dist[4].higher + dist[4].lower) * 100).toFixed(1), higher: +(dist[4].higher * 100).toFixed(1), lower: +(dist[4].lower * 100).toFixed(1) },
    5: { total: +((dist[5].higher + dist[5].lower) * 100).toFixed(1), higher: +(dist[5].higher * 100).toFixed(1), lower: +(dist[5].lower * 100).toFixed(1) },
    6: { total: +((dist[6].higher + dist[6].lower) * 100).toFixed(1), higher: +(dist[6].higher * 100).toFixed(1), lower: +(dist[6].lower * 100).toFixed(1) },
    7: { total: +((dist[7].higher + dist[7].lower) * 100).toFixed(1), higher: +(dist[7].higher * 100).toFixed(1), lower: +(dist[7].lower * 100).toFixed(1) }
  };
}

/**
 * EV calc
 */
function calcEV(trueProb, ml) {
  const payout = ml > 0 ? ml : (100 / (-ml)) * 100;
  return +((trueProb * payout) - ((1 - trueProb) * 100)).toFixed(2);
}

/**
 * Kelly sizing
 */
function kellySize(trueProb, ml) {
  const decimalOdds = ml > 0 ? (ml / 100) + 1 : (100 / (-ml)) + 1;
  const b = decimalOdds - 1;
  const q = 1 - trueProb;
  const kelly = (b * trueProb - q) / b;
  const k = Math.max(0, kelly);
  return {
    full: +(k * 100).toFixed(2),
    half: +(k * 50).toFixed(2),
    quarter: +(k * 25).toFixed(2)
  };
}

module.exports = {
  analyzePlayoffSeries,
  projectBracket,
  simulateFullPlayoffs,
  findSeriesValue,
  monteCarloSeries,
  binomialSeriesProb,
  exactLengthDistribution,
  playoffGameProb,
  probToML,
  mlToProb,
  MC_SIMULATIONS,
  SERIES_PATTERN_7,
  UPSET_ALERT_THRESHOLD
};
