/**
 * NHL Playoff Series Pricing Model 🏒
 * 
 * NHL series pricing is LESS efficient than NBA because:
 * - Goalie matchups swing series 10-15% (books don't always adjust properly)
 * - Home ice advantage is SMALLER in hockey (52-53%) but compounds over 7 games
 * - Lower-seeded teams win NHL series ~35% of the time (way more parity than NBA)
 * - The East bubble (PIT/MTL/BOS/DET all at 84pts) creates volatile matchup projections
 *   that books can't efficiently price until seedings lock
 * 
 * NHL Playoff Format:
 * - 16 teams (8 per conference: Eastern/Western)
 * - Top 3 from each division qualify + 2 wild cards per conference
 * - Division leaders seeded 1-2 (by points), wild cards fill in
 * - Bracket: D1(1) vs WC2, D1(2) vs D1(3), D2(1) vs WC1, D2(2) vs D2(3)
 *   (or similar depending on wild card placement)
 * - Best-of-7: 2-2-1-1-1 format (home-home-away-away-home-away-home)
 * 
 * Key NHL Playoff Adjustments:
 * - Goalie performance is THE dominant factor (starters play ~90%+ of playoff games)
 * - Special teams (PP/PK) matter MORE in playoffs (refs call fewer penalties, but each matters more)
 * - Physicality increases — bigger, slower teams do better in playoffs
 * - Regular season parity means more upsets — model should respect this
 */

const PLAYOFF_HIA_BOOST = 0.003; // Playoff home ice is marginally higher
const PLAYOFF_GOALIE_AMPLIFIER = 1.5; // Goalie impact amplified in playoffs (starters play every game)
const FATIGUE_PER_GAME = 0.004; // Hockey is more physically draining
const SPECIAL_TEAMS_PLAYOFF_BOOST = 1.25; // PP/PK matter more in playoffs
const MC_SIMULATIONS = 50000;
const UPSET_ALERT_THRESHOLD = 0.35;
const PARITY_REGRESSION = 0.08; // NHL has more parity — regress toward 50%

// Best-of-7 home ice pattern: H,H,A,A,H,A,H (same as NBA)
const SERIES_PATTERN_7 = [true, true, false, false, true, false, true];

// NHL Division assignments
const ATLANTIC = ['BOS', 'FLA', 'TOR', 'TBL', 'OTT', 'MTL', 'BUF', 'DET'];
const METROPOLITAN = ['CAR', 'NJD', 'NYR', 'WSH', 'NYI', 'PIT', 'PHI', 'CBJ'];
const CENTRAL = ['WPG', 'DAL', 'COL', 'MIN', 'STL', 'NSH', 'CHI', 'ARI'];
const PACIFIC = ['VGK', 'EDM', 'LAK', 'VAN', 'CGY', 'SEA', 'ANA', 'SJS'];

// Conference assignments
const EASTERN = [...ATLANTIC, ...METROPOLITAN];
const WESTERN = [...CENTRAL, ...PACIFIC];

/**
 * Calculate single-game win probability for playoff context
 * NHL-specific: goalie impact is amplified, more parity regression
 */
function playoffGameProb(higherSeedWinProbRegSeason, isHome, gameNumber, seriesState, goalieEdge = 0) {
  let prob = higherSeedWinProbRegSeason / 100;
  
  // 1. NHL parity regression — pull toward 50% more than NBA
  prob = prob + (0.5 - prob) * PARITY_REGRESSION;
  
  // 2. Home ice adjustment (playoff premium)
  if (isHome) {
    prob += PLAYOFF_HIA_BOOST;
  } else {
    prob -= PLAYOFF_HIA_BOOST;
  }
  
  // 3. Goalie edge — amplified in playoffs (starter plays every game)
  // goalieEdge is pre-computed differential
  prob += goalieEdge * PLAYOFF_GOALIE_AMPLIFIER;
  
  // 4. Fatigue — later games favor the more desperate/conditioned team
  const fatigueNoise = (gameNumber - 1) * FATIGUE_PER_GAME;
  prob = prob + (0.5 - prob) * fatigueNoise;
  
  // 5. Elimination game adjustments
  if (seriesState) {
    const { higherWins, lowerWins } = seriesState;
    // Team facing elimination plays harder — bigger effect in hockey
    if (higherWins < lowerWins && lowerWins === 3) {
      prob += 0.025; // Higher seed facing elimination — desperation
    }
    if (lowerWins < higherWins && higherWins === 3) {
      prob -= 0.015; // Lower seed facing elimination
    }
    // 3-1 lead is dangerous in NHL — team down 3-1 gets a slight boost
    if (lowerWins === 3 && higherWins === 1) {
      prob += 0.01;
    }
    if (higherWins === 3 && lowerWins === 1) {
      prob -= 0.01;
    }
  }
  
  // Clamp — NHL games rarely have >72% true win probability
  return Math.max(0.25, Math.min(0.75, prob));
}

/**
 * Exact binomial series probability via dynamic programming
 */
function binomialSeriesProb(gameProbs) {
  const memo = {};
  
  function dp(hw, lw) {
    if (hw === 4) return 1.0;
    if (lw === 4) return 0.0;
    
    const key = `${hw}-${lw}`;
    if (memo[key] !== undefined) return memo[key];
    
    const gameNum = hw + lw;
    const p = gameProbs[gameNum];
    
    const result = p * dp(hw + 1, lw) + (1 - p) * dp(hw, lw + 1);
    memo[key] = result;
    return result;
  }
  
  return dp(0, 0);
}

/**
 * Monte Carlo series simulation with NHL-specific dynamics
 */
function monteCarloSeries(baseHomeProb, baseAwayProb, goalieEdge = 0, sims = MC_SIMULATIONS) {
  const results = {
    higherSeedWins: 0,
    lowerSeedWins: 0,
    seriesLength: { 4: 0, 5: 0, 6: 0, 7: 0 },
    higherSeedIn: { 4: 0, 5: 0, 6: 0, 7: 0 },
    lowerSeedIn: { 4: 0, 5: 0, 6: 0, 7: 0 },
    gameWinPcts: [0, 0, 0, 0, 0, 0, 0]
  };
  
  const gameCounts = [0, 0, 0, 0, 0, 0, 0];
  
  for (let i = 0; i < sims; i++) {
    let hw = 0, lw = 0;
    let gamesPlayed = 0;
    
    while (hw < 4 && lw < 4) {
      const gameIdx = hw + lw;
      const isHome = SERIES_PATTERN_7[gameIdx];
      const baseP = isHome ? baseHomeProb : baseAwayProb;
      
      const p = playoffGameProb(
        baseP * 100,
        isHome,
        gameIdx + 1,
        { higherWins: hw, lowerWins: lw },
        goalieEdge
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
 * Exact series length distribution via enumeration
 */
function exactLengthDistribution(gameProbs) {
  const dist = { 4: { higher: 0, lower: 0 }, 5: { higher: 0, lower: 0 }, 6: { higher: 0, lower: 0 }, 7: { higher: 0, lower: 0 } };
  
  function enumerate(hw, lw, prob) {
    if (hw === 4) { dist[hw + lw] = dist[hw + lw] || { higher: 0, lower: 0 }; dist[hw + lw].higher += prob; return; }
    if (lw === 4) { dist[hw + lw] = dist[hw + lw] || { higher: 0, lower: 0 }; dist[hw + lw].lower += prob; return; }
    const gameIdx = hw + lw;
    const p = gameProbs[gameIdx];
    enumerate(hw + 1, lw, prob * p);
    enumerate(hw, lw + 1, prob * (1 - p));
  }
  
  enumerate(0, 0, 1.0);
  
  return {
    4: { total: +((dist[4].higher + dist[4].lower) * 100).toFixed(1), higher: +(dist[4].higher * 100).toFixed(1), lower: +(dist[4].lower * 100).toFixed(1) },
    5: { total: +((dist[5].higher + dist[5].lower) * 100).toFixed(1), higher: +(dist[5].higher * 100).toFixed(1), lower: +(dist[5].lower * 100).toFixed(1) },
    6: { total: +((dist[6].higher + dist[6].lower) * 100).toFixed(1), higher: +(dist[6].higher * 100).toFixed(1), lower: +(dist[6].lower * 100).toFixed(1) },
    7: { total: +((dist[7].higher + dist[7].lower) * 100).toFixed(1), higher: +(dist[7].higher * 100).toFixed(1), lower: +(dist[7].lower * 100).toFixed(1) }
  };
}

/**
 * Full series analysis between two NHL teams
 */
function analyzePlayoffSeries(nhlModel, higherSeed, lowerSeed, opts = {}) {
  const homeGamePred = nhlModel.predict(lowerSeed, higherSeed, opts);
  const awayGamePred = nhlModel.predict(higherSeed, lowerSeed, opts);
  
  if (!homeGamePred || !awayGamePred) {
    return { error: `Unknown team: ${higherSeed} or ${lowerSeed}` };
  }
  
  // Higher seed's win probability at home and away
  const pHome = homeGamePred.home.winProb / 100;
  const pAway = awayGamePred.away.winProb / 100;
  
  // Calculate goalie edge differential
  const teams = nhlModel.getTeams();
  const higherTeam = teams[higherSeed];
  const lowerTeam = teams[lowerSeed];
  
  const leagueAvgSv = 0.905;
  const higherGoalieSv = higherTeam?.starterSv || leagueAvgSv;
  const lowerGoalieSv = lowerTeam?.starterSv || leagueAvgSv;
  const goalieEdge = (higherGoalieSv - lowerGoalieSv) * 5; // Scale to ~0.01-0.05 range
  
  // Build game-by-game probability array
  const gameProbs = SERIES_PATTERN_7.map(isHigherSeedHome =>
    isHigherSeedHome ? pHome : pAway
  );
  
  // Exact binomial calculation
  const exactSeriesProb = binomialSeriesProb(gameProbs);
  
  // Monte Carlo with playoff dynamics
  const mcResults = monteCarloSeries(pHome, pAway, goalieEdge);
  
  // Blend: 50% binomial, 50% MC (MC captures more NHL-specific dynamics)
  const blendedProb = exactSeriesProb * 0.5 + (mcResults.higherSeedWinPct / 100) * 0.5;
  
  // Convert to moneyline
  const higherML = probToML(blendedProb);
  const lowerML = probToML(1 - blendedProb);
  
  const ratings = nhlModel.calculateRatings();
  const higherRating = ratings[higherSeed];
  const lowerRating = ratings[lowerSeed];
  
  // Special teams differential — matters more in playoffs
  const stDiff = (higherRating?.specialTeams || 0) - (lowerRating?.specialTeams || 0);
  
  return {
    higherSeed: {
      abbr: higherSeed,
      name: higherTeam?.name || higherSeed,
      record: higherTeam ? `${higherTeam.w}-${higherTeam.l}-${higherTeam.otl}` : 'N/A',
      power: higherRating?.power || 0,
      goalDiff: higherRating?.goalDiff || 0,
      starter: higherTeam?.starter || 'Unknown',
      starterSv: higherGoalieSv,
      pp: higherRating?.pp || 0,
      pk: higherRating?.pk || 0,
      specialTeams: higherRating?.specialTeams || 0
    },
    lowerSeed: {
      abbr: lowerSeed,
      name: lowerTeam?.name || lowerSeed,
      record: lowerTeam ? `${lowerTeam.w}-${lowerTeam.l}-${lowerTeam.otl}` : 'N/A',
      power: lowerRating?.power || 0,
      goalDiff: lowerRating?.goalDiff || 0,
      starter: lowerTeam?.starter || 'Unknown',
      starterSv: lowerGoalieSv,
      pp: lowerRating?.pp || 0,
      pk: lowerRating?.pk || 0,
      specialTeams: lowerRating?.specialTeams || 0
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
    keyFactors: {
      goalieEdge: {
        advantage: goalieEdge > 0 ? higherSeed : goalieEdge < 0 ? lowerSeed : 'EVEN',
        differential: +Math.abs(goalieEdge * 100).toFixed(1),
        higherStarter: `${higherTeam?.starter || '?'} (${(higherGoalieSv * 100).toFixed(1)}%)`,
        lowerStarter: `${lowerTeam?.starter || '?'} (${(lowerGoalieSv * 100).toFixed(1)}%)`,
        impact: Math.abs(goalieEdge) > 0.01 ? 'SIGNIFICANT' : Math.abs(goalieEdge) > 0.005 ? 'MODERATE' : 'MINIMAL'
      },
      specialTeams: {
        advantage: stDiff > 0 ? higherSeed : stDiff < 0 ? lowerSeed : 'EVEN',
        differential: +Math.abs(stDiff).toFixed(1),
        impact: Math.abs(stDiff) > 5 ? 'SIGNIFICANT' : Math.abs(stDiff) > 2 ? 'MODERATE' : 'MINIMAL'
      },
      homeIce: {
        higherAtHome: +(pHome * 100).toFixed(1),
        higherOnRoad: +(pAway * 100).toFixed(1),
        homeIceSwing: +((pHome - pAway) * 100).toFixed(1)
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
    exactLengthDist: exactLengthDistribution(gameProbs),
    expectedLength: mcResults.expectedLength,
    lengthDistribution: mcResults.lengthDistribution,
    upsetAlert: (1 - blendedProb) >= UPSET_ALERT_THRESHOLD,
    competitiveness: blendedProb < 0.55 ? 'COIN FLIP' :
                     blendedProb < 0.62 ? 'COMPETITIVE' :
                     blendedProb < 0.70 ? 'FAVORED' :
                     blendedProb < 0.80 ? 'HEAVY FAVORITE' : 'DOMINANT'
  };
}

/**
 * Project NHL playoff bracket from current standings
 * NHL uses: top 3 from each division + 2 wild cards per conference
 */
function projectBracket(nhlModel) {
  const teams = nhlModel.getTeams();
  const ratings = nhlModel.calculateRatings();
  
  function getTeamInfo(abbr) {
    const t = teams[abbr];
    const r = ratings[abbr];
    if (!t) return null;
    const gp = t.w + t.l + (t.otl || 0);
    const pts = t.w * 2 + (t.otl || 0);
    return {
      abbr,
      name: t.name,
      w: t.w,
      l: t.l,
      otl: t.otl || 0,
      gp,
      points: pts,
      pointPctg: +(pts / (gp * 2) * 100).toFixed(1),
      gf: t.gf,
      ga: t.ga,
      goalDiff: +(t.gf - t.ga).toFixed(2),
      power: r?.power || 0,
      starter: t.starter || 'Unknown',
      starterSv: t.starterSv || 0.905,
      pp: t.pp || 20,
      pk: t.pk || 80,
      l10w: t.l10w || 0,
      l10l: t.l10l || 0
    };
  }
  
  function sortByPoints(teamAbbrs) {
    return teamAbbrs
      .map(getTeamInfo)
      .filter(t => t !== null)
      .sort((a, b) => b.points - a.points || b.w - a.w || b.goalDiff - a.goalDiff);
  }
  
  // Sort each division
  const atlanticStandings = sortByPoints(ATLANTIC);
  const metroStandings = sortByPoints(METROPOLITAN);
  const centralStandings = sortByPoints(CENTRAL);
  const pacificStandings = sortByPoints(PACIFIC);
  
  // Eastern Conference bracket
  const eastDivLeaders = [];
  const eastDivTeams = {};
  
  // Atlantic top 3
  const atlTop3 = atlanticStandings.slice(0, 3);
  const atlRest = atlanticStandings.slice(3);
  
  // Metro top 3
  const metTop3 = metroStandings.slice(0, 3);
  const metRest = metroStandings.slice(3);
  
  // Wild cards: remaining Eastern teams sorted by points
  const eastWildCardPool = [...atlRest, ...metRest].sort((a, b) => b.points - a.points || b.w - a.w || b.goalDiff - a.goalDiff);
  const eastWC = eastWildCardPool.slice(0, 2);
  
  // Division leaders (highest points from each division)
  const atlLeader = atlTop3[0];
  const metLeader = metTop3[0];
  
  // Determine 1st and 2nd conference seeds
  let east1, east2;
  if (atlLeader.points >= metLeader.points) {
    east1 = { ...atlLeader, seed: 1, division: 'Atlantic' };
    east2 = { ...metLeader, seed: 2, division: 'Metropolitan' };
  } else {
    east1 = { ...metLeader, seed: 1, division: 'Metropolitan' };
    east2 = { ...atlLeader, seed: 2, division: 'Atlantic' };
  }
  
  // Build Eastern matchups
  // Format: 1 vs WC2, 2 vs WC1, D1(2) vs D1(3), D2(2) vs D2(3)
  // Actually NHL format: Division leaders play the wild cards
  // The top division leader plays the lower wild card
  // The other division leader plays the higher wild card
  // 2nd vs 3rd in each division play each other
  
  const eastMatchups = [];
  
  // Division leader vs wild card matchups
  // Highest-point division leader vs lowest wild card
  // Other division leader vs highest wild card
  eastMatchups.push({
    round: 1,
    matchup: `${east1.division} (1) vs WC2`,
    higher: east1,
    lower: { ...eastWC[1], seed: 'WC2', division: 'Wild Card' },
    type: 'division_leader_vs_wc'
  });
  eastMatchups.push({
    round: 1,
    matchup: `${east2.division} (1) vs WC1`,
    higher: east2,
    lower: { ...eastWC[0], seed: 'WC1', division: 'Wild Card' },
    type: 'division_leader_vs_wc'
  });
  
  // 2nd vs 3rd in Atlantic
  eastMatchups.push({
    round: 1,
    matchup: 'Atlantic (2) vs Atlantic (3)',
    higher: { ...atlTop3[1], seed: 'A2', division: 'Atlantic' },
    lower: { ...atlTop3[2], seed: 'A3', division: 'Atlantic' },
    type: 'division_2v3'
  });
  
  // 2nd vs 3rd in Metropolitan
  eastMatchups.push({
    round: 1,
    matchup: 'Metropolitan (2) vs Metropolitan (3)',
    higher: { ...metTop3[1], seed: 'M2', division: 'Metropolitan' },
    lower: { ...metTop3[2], seed: 'M3', division: 'Metropolitan' },
    type: 'division_2v3'
  });
  
  // Western Conference bracket
  const cenTop3 = centralStandings.slice(0, 3);
  const cenRest = centralStandings.slice(3);
  const pacTop3 = pacificStandings.slice(0, 3);
  const pacRest = pacificStandings.slice(3);
  
  const westWildCardPool = [...cenRest, ...pacRest].sort((a, b) => b.points - a.points || b.w - a.w || b.goalDiff - a.goalDiff);
  const westWC = westWildCardPool.slice(0, 2);
  
  const cenLeader = cenTop3[0];
  const pacLeader = pacTop3[0];
  
  let west1, west2;
  if (cenLeader.points >= pacLeader.points) {
    west1 = { ...cenLeader, seed: 1, division: 'Central' };
    west2 = { ...pacLeader, seed: 2, division: 'Pacific' };
  } else {
    west1 = { ...pacLeader, seed: 1, division: 'Pacific' };
    west2 = { ...cenLeader, seed: 2, division: 'Central' };
  }
  
  const westMatchups = [];
  westMatchups.push({
    round: 1,
    matchup: `${west1.division} (1) vs WC2`,
    higher: west1,
    lower: { ...westWC[1], seed: 'WC2', division: 'Wild Card' },
    type: 'division_leader_vs_wc'
  });
  westMatchups.push({
    round: 1,
    matchup: `${west2.division} (1) vs WC1`,
    higher: west2,
    lower: { ...westWC[0], seed: 'WC1', division: 'Wild Card' },
    type: 'division_leader_vs_wc'
  });
  westMatchups.push({
    round: 1,
    matchup: 'Central (2) vs Central (3)',
    higher: { ...cenTop3[1], seed: 'C2', division: 'Central' },
    lower: { ...cenTop3[2], seed: 'C3', division: 'Central' },
    type: 'division_2v3'
  });
  westMatchups.push({
    round: 1,
    matchup: 'Pacific (2) vs Pacific (3)',
    higher: { ...pacTop3[1], seed: 'P2', division: 'Pacific' },
    lower: { ...pacTop3[2], seed: 'P3', division: 'Pacific' },
    type: 'division_2v3'
  });
  
  // Analyze each matchup
  function analyzeMatchups(matchups) {
    return matchups.map(m => {
      const series = analyzePlayoffSeries(nhlModel, m.higher.abbr, m.lower.abbr);
      return {
        ...m,
        series: series.error ? { error: series.error } : {
          higherSeedWinPct: series.seriesPrice.higherSeedWinPct,
          lowerSeedWinPct: series.seriesPrice.lowerSeedWinPct,
          higherSeedML: series.seriesPrice.fairOdds.higher,
          lowerSeedML: series.seriesPrice.fairOdds.lower,
          expectedLength: series.expectedLength,
          competitiveness: series.competitiveness,
          upsetAlert: series.upsetAlert,
          lengthDistribution: series.lengthDistribution,
          goalieEdge: series.keyFactors?.goalieEdge,
          specialTeams: series.keyFactors?.specialTeams
        }
      };
    });
  }
  
  // Bubble race info — teams fighting for last playoff spots
  function getBubbleTeams(standings, top3, wildCards) {
    const qualifiedAbbrs = new Set([...top3.map(t => t.abbr), ...wildCards.map(t => t.abbr)]);
    const bubble = standings
      .filter(t => !qualifiedAbbrs.has(t.abbr))
      .slice(0, 4) // Top 4 teams just outside
      .map(t => {
        const lastWC = wildCards[wildCards.length - 1];
        return {
          ...t,
          gamesBack: +((lastWC.points - t.points) / 2).toFixed(1),
          status: t.points >= lastWC.points - 4 ? 'IN THE HUNT' : 'FADING'
        };
      });
    return bubble;
  }
  
  const eastAllSorted = [...atlanticStandings, ...metroStandings].sort((a, b) => b.points - a.points);
  const westAllSorted = [...centralStandings, ...pacificStandings].sort((a, b) => b.points - a.points);
  
  return {
    eastern: {
      divisions: {
        atlantic: atlanticStandings.map((t, i) => ({ ...t, divRank: i + 1, qualified: i < 3 })),
        metropolitan: metroStandings.map((t, i) => ({ ...t, divRank: i + 1, qualified: i < 3 }))
      },
      wildCards: eastWC.map((t, i) => ({ ...t, wcRank: i + 1 })),
      matchups: analyzeMatchups(eastMatchups),
      bubble: getBubbleTeams(eastAllSorted, [...atlTop3, ...metTop3], eastWC),
      conferenceStandings: eastAllSorted
    },
    western: {
      divisions: {
        central: centralStandings.map((t, i) => ({ ...t, divRank: i + 1, qualified: i < 3 })),
        pacific: pacificStandings.map((t, i) => ({ ...t, divRank: i + 1, qualified: i < 3 }))
      },
      wildCards: westWC.map((t, i) => ({ ...t, wcRank: i + 1 })),
      matchups: analyzeMatchups(westMatchups),
      bubble: getBubbleTeams(westAllSorted, [...cenTop3, ...pacTop3], westWC),
      conferenceStandings: westAllSorted
    },
    playoffsStart: '2026-04-19',
    daysUntilPlayoffs: Math.max(0, Math.floor((new Date('2026-04-19') - new Date()) / 86400000))
  };
}

/**
 * Simulate full NHL playoff bracket — Stanley Cup probabilities
 * 
 * NHL bracket reseeding: Winners of Rd1 matchups face each other within the conference
 * (1/WC2 winner vs 2/3 winner in that division's side, etc.)
 */
function simulateFullPlayoffs(nhlModel, sims = 10000) {
  const bracket = projectBracket(nhlModel);
  const champCount = {};
  const finalsCount = {};
  const confFinalsCount = {};
  const secondRoundCount = {};
  
  // Gather all playoff teams
  const allTeams = [];
  const confMatchups = { eastern: bracket.eastern.matchups, western: bracket.western.matchups };
  
  for (const conf of ['eastern', 'western']) {
    for (const m of confMatchups[conf]) {
      if (!allTeams.find(t => t.abbr === m.higher.abbr)) allTeams.push(m.higher);
      if (!allTeams.find(t => t.abbr === m.lower.abbr)) allTeams.push(m.lower);
    }
  }
  
  allTeams.forEach(t => {
    champCount[t.abbr] = 0;
    finalsCount[t.abbr] = 0;
    confFinalsCount[t.abbr] = 0;
    secondRoundCount[t.abbr] = 0;
  });
  
  // Pre-compute pairwise probabilities
  const ratings = nhlModel.calculateRatings();
  const teams = nhlModel.getTeams();
  const probCache = {};
  const teamAbbrs = allTeams.map(t => t.abbr);
  
  for (let i = 0; i < teamAbbrs.length; i++) {
    for (let j = i + 1; j < teamAbbrs.length; j++) {
      const a = teamAbbrs[i], b = teamAbbrs[j];
      const aPower = ratings[a]?.power || 0;
      const bPower = ratings[b]?.power || 0;
      const higher = aPower >= bPower ? a : b;
      const lower = aPower >= bPower ? b : a;
      
      const homeGamePred = nhlModel.predict(lower, higher);
      const awayGamePred = nhlModel.predict(higher, lower);
      
      const pHome = (homeGamePred ? homeGamePred.home.winProb / 100 : 0.55);
      const pAway = (awayGamePred ? awayGamePred.away.winProb / 100 : 0.45);
      
      // Goalie edge
      const leagueAvgSv = 0.905;
      const higherSv = teams[higher]?.starterSv || leagueAvgSv;
      const lowerSv = teams[lower]?.starterSv || leagueAvgSv;
      const goalieEdge = (higherSv - lowerSv) * 5;
      
      probCache[`${higher}-${lower}`] = { pHome, pAway, goalieEdge, higher, lower };
    }
  }
  
  // Fast series simulator
  function fastSimSeries(teamA, teamB) {
    const aPower = ratings[teamA]?.power || 0;
    const bPower = ratings[teamB]?.power || 0;
    const higher = aPower >= bPower ? teamA : teamB;
    const lower = aPower >= bPower ? teamB : teamA;
    
    const key = `${higher}-${lower}`;
    const probs = probCache[key];
    if (!probs) return higher;
    
    let hw = 0, lw = 0;
    while (hw < 4 && lw < 4) {
      const gameIdx = hw + lw;
      const isHome = SERIES_PATTERN_7[gameIdx];
      const baseP = isHome ? probs.pHome : probs.pAway;
      const p = playoffGameProb(baseP * 100, isHome, gameIdx + 1, { higherWins: hw, lowerWins: lw }, probs.goalieEdge);
      
      if (Math.random() < p) { hw++; } else { lw++; }
    }
    return hw === 4 ? higher : lower;
  }
  
  for (let sim = 0; sim < sims; sim++) {
    // Round 1
    const eastR1 = confMatchups.eastern.map(m => fastSimSeries(m.higher.abbr, m.lower.abbr));
    const westR1 = confMatchups.western.map(m => fastSimSeries(m.higher.abbr, m.lower.abbr));
    
    eastR1.forEach(t => secondRoundCount[t]++);
    westR1.forEach(t => secondRoundCount[t]++);
    
    // Round 2 — NHL bracket: R1 matchup 1 winner vs R1 matchup 3 winner, R1 matchup 2 winner vs R1 matchup 4 winner
    // (Division leader side vs division 2v3 side)
    const eastR2 = [fastSimSeries(eastR1[0], eastR1[2]), fastSimSeries(eastR1[1], eastR1[3])];
    const westR2 = [fastSimSeries(westR1[0], westR1[2]), fastSimSeries(westR1[1], westR1[3])];
    
    // Conference Finals
    const eastChamp = fastSimSeries(eastR2[0], eastR2[1]);
    const westChamp = fastSimSeries(westR2[0], westR2[1]);
    
    confFinalsCount[eastChamp]++;
    confFinalsCount[westChamp]++;
    finalsCount[eastChamp]++;
    finalsCount[westChamp]++;
    
    // Stanley Cup Finals
    const champion = fastSimSeries(eastChamp, westChamp);
    champCount[champion]++;
  }
  
  // Compile results
  const results = allTeams.map(t => ({
    abbr: t.abbr,
    name: t.name,
    record: `${t.w}-${t.l}-${t.otl || 0}`,
    points: t.points || 0,
    power: t.power || 0,
    starter: t.starter || 'Unknown',
    starterSv: t.starterSv || 0.905,
    champPct: +(champCount[t.abbr] / sims * 100).toFixed(1),
    finalsPct: +(finalsCount[t.abbr] / sims * 100).toFixed(1),
    confFinalsPct: +(confFinalsCount[t.abbr] / sims * 100).toFixed(1),
    secondRoundPct: +(secondRoundCount[t.abbr] / sims * 100).toFixed(1),
    champML: probToML(Math.max(champCount[t.abbr] / sims, 0.001))
  })).sort((a, b) => b.champPct - a.champPct);
  
  return {
    stanleyCupOdds: results,
    simulations: sims,
    topContenders: results.slice(0, 6),
    darkHorses: results.filter(t => t.champPct >= 2 && t.champPct < 10),
    deepRuns: results.filter(t => t.confFinalsPct >= 15)
  };
}

/**
 * Find value in NHL series pricing
 */
function findSeriesValue(nhlModel, seriesMatchups) {
  const values = [];
  
  for (const matchup of seriesMatchups) {
    const series = analyzePlayoffSeries(nhlModel, matchup.higher, matchup.lower);
    if (series.error) continue;
    
    const modelHigherProb = series.seriesPrice.higherSeedWinPct / 100;
    const modelLowerProb = series.seriesPrice.lowerSeedWinPct / 100;
    
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
          expectedLength: series.expectedLength,
          goalieEdge: series.keyFactors?.goalieEdge
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
          expectedLength: series.expectedLength,
          goalieEdge: series.keyFactors?.goalieEdge
        });
      }
    }
  }
  
  return values.sort((a, b) => b.edge - a.edge);
}

/**
 * Convert probability to American moneyline
 */
function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Convert American moneyline to probability
 */
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function calcEV(trueProb, ml) {
  const payout = ml > 0 ? ml : (100 / (-ml)) * 100;
  return +((trueProb * payout) - ((1 - trueProb) * 100)).toFixed(2);
}

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
  UPSET_ALERT_THRESHOLD,
  // Division/conference constants for external use
  ATLANTIC, METROPOLITAN, CENTRAL, PACIFIC, EASTERN, WESTERN
};
