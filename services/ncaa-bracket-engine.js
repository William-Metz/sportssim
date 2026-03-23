/**
 * NCAA Tournament Dynamic Bracket Engine — SportsSim v70.0
 * =========================================================
 * 
 * Proper bracket structure following NCAA Tournament seeding format.
 * Auto-generates all matchups dynamically from results + bracket position.
 * 
 * WHY THIS MATTERS FOR $$$:
 *   - Hardcoded matchups = stale data = wrong predictions = lost money
 *   - Dynamic bracket = always-current Sweet 16/Elite 8/FF matchups
 *   - Bracket simulation uses ACTUAL remaining field for accurate futures
 *   - Conditional championship probabilities shift MASSIVELY after each round
 *   - Books are slow to adjust futures after upsets → early mover edge
 * 
 * NCAA Tournament Bracket Structure (per region):
 *   Round 1:  1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15
 *   Round 2:  (1/16)v(8/9), (5/12)v(4/13), (6/11)v(3/14), (7/10)v(2/15)
 *   Sweet 16: [(1/16/8/9)v(5/12/4/13)], [(6/11/3/14)v(7/10/2/15)]
 *   Elite 8:  [Top half v Bottom half]
 */

let ncaa;
try { ncaa = require('../models/ncaa'); } catch(e) {}

// ==================== BRACKET STRUCTURE ====================

// Official NCAA Tournament bracket positions by seed within a region
// Each "pod" is a pair of first-round games whose winners meet in Round 2
const BRACKET_PODS = {
  topLeft:    { seeds: [1, 16, 8, 9] },   // 1v16, 8v9 → R2 matchup → S16 top left
  topRight:   { seeds: [5, 12, 4, 13] },   // 5v12, 4v13 → R2 matchup → S16 top right
  bottomLeft: { seeds: [6, 11, 3, 14] },   // 6v11, 3v14 → R2 matchup → S16 bottom left
  bottomRight:{ seeds: [7, 10, 2, 15] },   // 7v10, 2v15 → R2 matchup → S16 bottom right
};

// Sweet 16: topLeft/topRight winner vs bottomLeft/bottomRight winner → Elite 8
// Elite 8: topHalf winner vs bottomHalf winner → Region Final → Final Four

// Round 1 matchup pairings by seed
const ROUND1_MATCHUPS = [
  [1, 16], [8, 9], [5, 12], [4, 13],
  [6, 11], [3, 14], [7, 10], [2, 15]
];

// Round 2 matchup flow (winners of these Round 1 games play each other)
const ROUND2_FLOW = [
  { r1a: [1, 16], r1b: [8, 9] },   // topLeft pod
  { r1a: [5, 12], r1b: [4, 13] },  // topRight pod
  { r1a: [6, 11], r1b: [3, 14] },  // bottomLeft pod
  { r1a: [7, 10], r1b: [2, 15] },  // bottomRight pod
];

// Sweet 16 flow (winners of Round 2 pods play each other)
const SWEET16_FLOW = [
  { pods: ['topLeft', 'topRight'] },       // Top half → S16 game 1
  { pods: ['bottomLeft', 'bottomRight'] }, // Bottom half → S16 game 2
];

// Final Four matchups (East vs West, South vs Midwest)
const FF_MATCHUPS = [
  { regions: ['East', 'West'] },
  { regions: ['South', 'Midwest'] }
];

// ==================== BRACKET STATE MANAGEMENT ====================

/**
 * Get all teams in a region with their seed
 */
function getRegionTeams(region) {
  if (!ncaa) return [];
  return Object.entries(ncaa.TEAMS)
    .filter(([_, t]) => t.region === region)
    .map(([abbr, t]) => ({ abbr, seed: t.seed, name: t.name, kenpom: t.kenpom, adjEM: t.adjEM }))
    .sort((a, b) => a.seed - b.seed);
}

/**
 * Find which team from a region has a specific seed
 */
function findTeamBySeed(region, seed) {
  if (!ncaa) return null;
  for (const [abbr, t] of Object.entries(ncaa.TEAMS)) {
    if (t.region === region && t.seed === seed) return abbr;
  }
  return null;
}

/**
 * Get Round 1 winner from a specific matchup in a region
 */
function getRound1Winner(region, seedA, seedB) {
  if (!ncaa) return null;
  const results = ncaa.TOURNAMENT_RESULTS.round1 || [];
  
  const teamA = findTeamBySeed(region, seedA);
  const teamB = findTeamBySeed(region, seedB);
  
  for (const r of results) {
    if ((r.winner === teamA && r.loser === teamB) || (r.winner === teamB && r.loser === teamA)) {
      return r.winner;
    }
  }
  return null; // Game not played yet
}

/**
 * Get Round 2 winner from a specific pod matchup
 */
function getRound2Winner(region, pod) {
  if (!ncaa) return null;
  const results = ncaa.TOURNAMENT_RESULTS.round2 || [];
  
  const flow = ROUND2_FLOW[['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].indexOf(pod)];
  if (!flow) return null;
  
  const winner1 = getRound1Winner(region, flow.r1a[0], flow.r1a[1]);
  const winner2 = getRound1Winner(region, flow.r1b[0], flow.r1b[1]);
  
  if (!winner1 || !winner2) return null; // Round 1 not complete for this pod
  
  for (const r of results) {
    if ((r.winner === winner1 && r.loser === winner2) || (r.winner === winner2 && r.loser === winner1)) {
      return r.winner;
    }
  }
  return null; // Round 2 not played yet
}

/**
 * Get Sweet 16 winner (from a specific half of a region)
 */
function getSweet16Winner(region, half) {
  if (!ncaa) return null;
  const results = ncaa.TOURNAMENT_RESULTS.round3 || [];
  
  const pods = half === 'top' ? ['topLeft', 'topRight'] : ['bottomLeft', 'bottomRight'];
  const team1 = getRound2Winner(region, pods[0]);
  const team2 = getRound2Winner(region, pods[1]);
  
  if (!team1 || !team2) return null;
  
  for (const r of results) {
    if ((r.winner === team1 && r.loser === team2) || (r.winner === team2 && r.loser === team1)) {
      return r.winner;
    }
  }
  return null;
}

/**
 * Get region winner (Elite 8 winner)
 */
function getRegionWinner(region) {
  if (!ncaa) return null;
  const results = ncaa.TOURNAMENT_RESULTS.round4 || [];
  
  const topWinner = getSweet16Winner(region, 'top');
  const bottomWinner = getSweet16Winner(region, 'bottom');
  
  if (!topWinner || !bottomWinner) return null;
  
  for (const r of results) {
    if ((r.winner === topWinner && r.loser === bottomWinner) || 
        (r.winner === bottomWinner && r.loser === topWinner)) {
      return r.winner;
    }
  }
  return null;
}

// ==================== DYNAMIC MATCHUP GENERATION ====================

/**
 * Generate all Sweet 16 matchups dynamically from bracket structure
 * Returns { known: [...], pending: [...] }
 */
function generateSweet16Matchups() {
  const regions = ['East', 'West', 'Midwest', 'South'];
  const known = [];
  const pending = [];
  
  for (const region of regions) {
    // Top half: topLeft pod winner vs topRight pod winner
    const topLeft = getRound2Winner(region, 'topLeft');
    const topRight = getRound2Winner(region, 'topRight');
    
    if (topLeft && topRight) {
      const t1 = ncaa.TEAMS[topLeft];
      const t2 = ncaa.TEAMS[topRight];
      known.push({
        away: topRight, // Higher seed is "away" (neutral court)
        home: topLeft,  // Lower seed is "home"
        region,
        round: 'Sweet 16',
        half: 'top',
        notes: `#${t2?.seed || '?'} ${t2?.name || topRight} vs #${t1?.seed || '?'} ${t1?.name || topLeft}`,
        awayData: t2 ? { seed: t2.seed, kenpom: t2.kenpom, adjEM: t2.adjEM, record: t2.record } : null,
        homeData: t1 ? { seed: t1.seed, kenpom: t1.kenpom, adjEM: t1.adjEM, record: t1.record } : null,
      });
    } else {
      // Track what's pending
      const topLeftPending = !topLeft;
      const topRightPending = !topRight;
      
      pending.push({
        region,
        half: 'top',
        known: {
          topLeft: topLeft || null,
          topRight: topRight || null,
        },
        pendingPods: [
          ...(topLeftPending ? [{ pod: 'topLeft', possibleTeams: getPodSurvivors(region, 'topLeft') }] : []),
          ...(topRightPending ? [{ pod: 'topRight', possibleTeams: getPodSurvivors(region, 'topRight') }] : []),
        ],
      });
    }
    
    // Bottom half: bottomLeft pod winner vs bottomRight pod winner
    const bottomLeft = getRound2Winner(region, 'bottomLeft');
    const bottomRight = getRound2Winner(region, 'bottomRight');
    
    if (bottomLeft && bottomRight) {
      const t1 = ncaa.TEAMS[bottomLeft];
      const t2 = ncaa.TEAMS[bottomRight];
      known.push({
        away: bottomRight,
        home: bottomLeft,
        region,
        round: 'Sweet 16',
        half: 'bottom',
        notes: `#${t2?.seed || '?'} ${t2?.name || bottomRight} vs #${t1?.seed || '?'} ${t1?.name || bottomLeft}`,
        awayData: t2 ? { seed: t2.seed, kenpom: t2.kenpom, adjEM: t2.adjEM, record: t2.record } : null,
        homeData: t1 ? { seed: t1.seed, kenpom: t1.kenpom, adjEM: t1.adjEM, record: t1.record } : null,
      });
    } else {
      const bottomLeftPending = !bottomLeft;
      const bottomRightPending = !bottomRight;
      
      pending.push({
        region,
        half: 'bottom',
        known: {
          bottomLeft: bottomLeft || null,
          bottomRight: bottomRight || null,
        },
        pendingPods: [
          ...(bottomLeftPending ? [{ pod: 'bottomLeft', possibleTeams: getPodSurvivors(region, 'bottomLeft') }] : []),
          ...(bottomRightPending ? [{ pod: 'bottomRight', possibleTeams: getPodSurvivors(region, 'bottomRight') }] : []),
        ],
      });
    }
  }
  
  return { known, pending, generatedAt: new Date().toISOString() };
}

/**
 * Get remaining possible teams in a pod (for pending matchups)
 */
function getPodSurvivors(region, pod) {
  const podIndex = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].indexOf(pod);
  const flow = ROUND2_FLOW[podIndex];
  if (!flow) return [];
  
  const r1WinnerA = getRound1Winner(region, flow.r1a[0], flow.r1a[1]);
  const r1WinnerB = getRound1Winner(region, flow.r1b[0], flow.r1b[1]);
  
  // If both R1 games played but R2 not yet, return both
  const survivors = [];
  if (r1WinnerA) survivors.push(r1WinnerA);
  else {
    // R1 not played — both teams still possible
    const tA = findTeamBySeed(region, flow.r1a[0]);
    const tB = findTeamBySeed(region, flow.r1a[1]);
    if (tA) survivors.push(tA);
    if (tB) survivors.push(tB);
  }
  if (r1WinnerB) survivors.push(r1WinnerB);
  else {
    const tA = findTeamBySeed(region, flow.r1b[0]);
    const tB = findTeamBySeed(region, flow.r1b[1]);
    if (tA) survivors.push(tA);
    if (tB) survivors.push(tB);
  }
  return survivors;
}

// ==================== SWEET 16 WAR ROOM ====================

/**
 * Generate the Sweet 16 War Room — comprehensive betting analysis for all matchups
 */
function getSweet16WarRoom() {
  if (!ncaa) return { error: 'NCAA model not loaded' };
  
  const matchups = generateSweet16Matchups();
  const bracketSim = ncaa.simulateBracket(10000);
  
  const games = matchups.known.map(m => {
    const pred = ncaa.predict(m.away, m.home, { round: 'Sweet 16' });
    
    // Get championship probabilities for both teams
    const awayChamp = bracketSim.results.find(r => r.team === m.away);
    const homeChamp = bracketSim.results.find(r => r.team === m.home);
    
    // Tournament momentum
    const awayMomentum = ncaa.calculateTourneyMomentum(m.away);
    const homeMomentum = ncaa.calculateTourneyMomentum(m.home);
    
    return {
      ...m,
      prediction: pred,
      futures: {
        away: {
          champProb: awayChamp?.champProb || 0,
          finalFourProb: awayChamp?.finalFourProb || 0,
          eliteEightProb: awayChamp?.eliteEightProb || 0,
        },
        home: {
          champProb: homeChamp?.champProb || 0,
          finalFourProb: homeChamp?.finalFourProb || 0,
          eliteEightProb: homeChamp?.eliteEightProb || 0,
        }
      },
      momentum: {
        away: awayMomentum,
        home: homeMomentum,
      },
      signals: generateGameSignals(m.away, m.home, pred),
    };
  });
  
  // Pending matchup analysis
  const pendingAnalysis = matchups.pending.map(p => {
    const scenarios = [];
    const possibleTeams = [];
    for (const pp of p.pendingPods) {
      possibleTeams.push(...pp.possibleTeams);
    }
    
    // If one team is known, predict against each possible opponent
    const knownTeam = p.known?.topLeft || p.known?.topRight || p.known?.bottomLeft || p.known?.bottomRight;
    if (knownTeam && possibleTeams.length > 0) {
      for (const opp of possibleTeams) {
        if (opp === knownTeam) continue;
        const pred = ncaa.predict(opp, knownTeam, { round: 'Sweet 16' });
        scenarios.push({
          matchup: `${ncaa.TEAMS[opp]?.name || opp} vs ${ncaa.TEAMS[knownTeam]?.name || knownTeam}`,
          away: opp,
          home: knownTeam,
          prediction: pred,
        });
      }
    }
    
    return { ...p, scenarios };
  });
  
  // Top value plays across all known games
  const allValuePlays = [];
  for (const game of games) {
    const pred = game.prediction;
    if (!pred || pred.error) continue;
    
    // Check for mispriced underdogs
    const awayTeam = ncaa.TEAMS[game.away];
    const homeTeam = ncaa.TEAMS[game.home];
    if (!awayTeam || !homeTeam) continue;
    
    // Defense premium detection
    if (awayTeam.adjD < 90 || homeTeam.adjD < 90) {
      const eliteDef = awayTeam.adjD < homeTeam.adjD ? game.away : game.home;
      const defTeam = ncaa.TEAMS[eliteDef];
      allValuePlays.push({
        game: `${awayTeam.name} vs ${homeTeam.name}`,
        type: 'DEFENSE_PREMIUM',
        team: eliteDef,
        signal: `${defTeam.name} has elite defense (AdjD: ${defTeam.adjD}) — Sweet 16 defense premium is 5%`,
        confidence: 'HIGH',
      });
    }
    
    // Under lean (tournament bias)
    if (pred.projTotal < 145) {
      allValuePlays.push({
        game: `${awayTeam.name} vs ${homeTeam.name}`,
        type: 'TOURNAMENT_UNDER',
        signal: `Projected total ${pred.projTotal} — both defenses travel well, Sweet 16 under rate is ~56%`,
        projTotal: pred.projTotal,
        confidence: pred.projTotal < 138 ? 'HIGH' : 'MEDIUM',
      });
    }
    
    // Upset alert (lower seed has >35% model win probability)
    const lowerSeed = awayTeam.seed > homeTeam.seed ? game.away : game.home;
    const higherSeed = awayTeam.seed > homeTeam.seed ? game.home : game.away;
    const lowerSeedWinProb = lowerSeed === game.away ? pred.blendedAwayWinProb : pred.blendedHomeWinProb;
    
    if (lowerSeedWinProb > 0.35 && (awayTeam.seed !== homeTeam.seed)) {
      allValuePlays.push({
        game: `${awayTeam.name} vs ${homeTeam.name}`,
        type: 'UPSET_ALERT',
        team: lowerSeed,
        signal: `#${ncaa.TEAMS[lowerSeed].seed} ${ncaa.TEAMS[lowerSeed].name} has ${(lowerSeedWinProb * 100).toFixed(1)}% model win prob vs #${ncaa.TEAMS[higherSeed].seed} ${ncaa.TEAMS[higherSeed].name} — market likely pricing lower`,
        confidence: lowerSeedWinProb > 0.45 ? 'HIGH' : 'MEDIUM',
      });
    }
  }
  
  return {
    title: '🏀 NCAA Sweet 16 War Room',
    generatedAt: new Date().toISOString(),
    currentRound: 'Sweet 16',
    gamesKnown: games.length,
    gamesPending: matchups.pending.length,
    games,
    pendingAnalysis,
    valuePlaysSummary: allValuePlays,
    championshipOdds: bracketSim.results.slice(0, 16),
    bracketState: ncaa.getBracketState(),
    methodology: {
      model: 'KenPom-style efficiency model (AdjO/AdjD/tempo)',
      blending: '80% KenPom + 20% historical seed data',
      tournamentAdjustments: [
        'Defense premium increases each round (+5% in Sweet 16)',
        'Tournament under bias (+4% in Sweet 16)',
        'Cinderella fatigue (2% efficiency dropoff for seeds 9+ in S16)',
        'Experience premium for recent Final Four teams',
        'Tournament momentum from margin of victory'
      ]
    }
  };
}

/**
 * Generate game-specific betting signals
 */
function generateGameSignals(awayAbbr, homeAbbr, pred) {
  if (!ncaa) return [];
  const signals = [];
  const away = ncaa.TEAMS[awayAbbr];
  const home = ncaa.TEAMS[homeAbbr];
  if (!away || !home) return signals;
  
  // Tempo signal
  const avgTempo = (away.tempo + home.tempo) / 2;
  const tempoGap = Math.abs(away.tempo - home.tempo);
  if (tempoGap > 5) {
    const slow = away.tempo < home.tempo ? away : home;
    signals.push({
      type: 'TEMPO_MISMATCH',
      signal: `${slow.name} controls pace → lean UNDER (slow team dictates in tournament)`,
      impact: 'UNDER',
      strength: tempoGap > 8 ? 'STRONG' : 'MODERATE',
    });
  }
  
  // Efficiency gap signal
  const emGap = Math.abs(away.adjEM - home.adjEM);
  if (emGap > 12) {
    const fav = away.adjEM > home.adjEM ? away : home;
    signals.push({
      type: 'BLOWOUT_RISK',
      signal: `${fav.name} is ${emGap.toFixed(1)} AdjEM better → potential blowout, consider alt spread`,
      impact: 'FAVORITE_COVER',
      strength: 'STRONG',
    });
  } else if (emGap < 4) {
    signals.push({
      type: 'COIN_FLIP',
      signal: `Only ${emGap.toFixed(1)} AdjEM gap → look for best odds on either side`,
      impact: 'VOLATILE',
      strength: 'STRONG',
    });
  }
  
  // Offense vs Defense matchup
  if (away.adjO > 118 && home.adjD < 92) {
    signals.push({
      type: 'ELITE_MATCHUP',
      signal: `${away.name} elite offense (${away.adjO}) vs ${home.name} elite defense (${home.adjD}) → classic March battle`,
      impact: 'VOLATILE',
      strength: 'STRONG',
    });
  }
  if (home.adjO > 118 && away.adjD < 92) {
    signals.push({
      type: 'ELITE_MATCHUP',
      signal: `${home.name} elite offense (${home.adjO}) vs ${away.name} elite defense (${away.adjD}) → classic March battle`,
      impact: 'VOLATILE',
      strength: 'STRONG',
    });
  }
  
  // KenPom rank vs seed discrepancy
  const awayExpectedSeed = Math.ceil(away.kenpom / 4);
  const homeExpectedSeed = Math.ceil(home.kenpom / 4);
  if (away.seed > awayExpectedSeed + 2) {
    signals.push({
      type: 'UNDERSEEDED',
      signal: `${away.name} is a #${away.seed} seed but KenPom #${away.kenpom} → market undervalues, bet ML/spread`,
      impact: 'UNDERDOG_VALUE',
      strength: 'STRONG',
    });
  }
  if (home.seed > homeExpectedSeed + 2) {
    signals.push({
      type: 'UNDERSEEDED',
      signal: `${home.name} is a #${home.seed} seed but KenPom #${home.kenpom} → market undervalues, bet ML/spread`,
      impact: 'UNDERDOG_VALUE',
      strength: 'STRONG',
    });
  }
  
  // Low projected total signal
  if (pred && pred.projTotal < 135) {
    signals.push({
      type: 'LOW_SCORING',
      signal: `Projected total only ${pred.projTotal} — both teams play slow/defensive, STRONG under lean`,
      impact: 'UNDER',
      strength: 'STRONG',
    });
  }
  
  // Historical seed matchup
  if (away.seed !== home.seed) {
    const seedKey = `${Math.min(away.seed, home.seed)}v${Math.max(away.seed, home.seed)}`;
    const upsetRate = ncaa.SEED_UPSET_RATES?.[seedKey];
    if (upsetRate && upsetRate > 0.3) {
      const dog = away.seed > home.seed ? away : home;
      signals.push({
        type: 'SEED_HISTORY',
        signal: `${seedKey} matchups historically upset ${(upsetRate * 100).toFixed(0)}% of the time — ${dog.name} live dog`,
        impact: 'UNDERDOG_VALUE',
        strength: upsetRate > 0.4 ? 'STRONG' : 'MODERATE',
      });
    }
  }
  
  return signals;
}

// ==================== ENHANCED BRACKET SIMULATOR ====================

/**
 * Enhanced bracket simulation that properly follows bracket structure
 * and tracks advancement probabilities at each round
 */
function enhancedBracketSim(sims = 10000) {
  if (!ncaa) return { error: 'NCAA model not loaded' };
  
  const counts = {}; // team → { s16: n, e8: n, ff: n, champ: n }
  const regions = ['East', 'West', 'Midwest', 'South'];
  
  for (let i = 0; i < sims; i++) {
    const regionWinners = {};
    
    for (const region of regions) {
      // Get the 4 Sweet 16 teams (or simulate from current state)
      const topLeft = getRound2Winner(region, 'topLeft') || simPodWinner(region, 'topLeft');
      const topRight = getRound2Winner(region, 'topRight') || simPodWinner(region, 'topRight');
      const bottomLeft = getRound2Winner(region, 'bottomLeft') || simPodWinner(region, 'bottomLeft');
      const bottomRight = getRound2Winner(region, 'bottomRight') || simPodWinner(region, 'bottomRight');
      
      // Sweet 16
      const s16Winners = [topLeft, topRight, bottomLeft, bottomRight];
      for (const t of s16Winners) {
        if (!counts[t]) counts[t] = { s16: 0, e8: 0, ff: 0, finals: 0, champ: 0 };
        counts[t].s16++;
      }
      
      const e8Top = simGame(topLeft, topRight);
      const e8Bottom = simGame(bottomLeft, bottomRight);
      
      // Elite 8
      if (!counts[e8Top]) counts[e8Top] = { s16: 0, e8: 0, ff: 0, finals: 0, champ: 0 };
      if (!counts[e8Bottom]) counts[e8Bottom] = { s16: 0, e8: 0, ff: 0, finals: 0, champ: 0 };
      counts[e8Top].e8++;
      counts[e8Bottom].e8++;
      
      // Region Final
      const regionWinner = simGame(e8Top, e8Bottom);
      if (!counts[regionWinner]) counts[regionWinner] = { s16: 0, e8: 0, ff: 0, finals: 0, champ: 0 };
      counts[regionWinner].ff++;
      
      regionWinners[region] = regionWinner;
    }
    
    // Final Four: East vs West, South vs Midwest
    const semi1 = simGame(regionWinners.East, regionWinners.West);
    const semi2 = simGame(regionWinners.South, regionWinners.Midwest);
    
    if (!counts[semi1]) counts[semi1] = { s16: 0, e8: 0, ff: 0, finals: 0, champ: 0 };
    if (!counts[semi2]) counts[semi2] = { s16: 0, e8: 0, ff: 0, finals: 0, champ: 0 };
    counts[semi1].finals++;
    counts[semi2].finals++;
    
    // Championship
    const champion = simGame(semi1, semi2);
    if (!counts[champion]) counts[champion] = { s16: 0, e8: 0, ff: 0, finals: 0, champ: 0 };
    counts[champion].champ++;
  }
  
  // Convert to probabilities
  const results = Object.entries(counts)
    .map(([team, c]) => {
      const t = ncaa?.TEAMS[team];
      return {
        team,
        name: t?.name || team,
        seed: t?.seed,
        region: t?.region,
        kenpom: t?.kenpom,
        adjEM: t?.adjEM,
        sweet16Prob: +((c.s16 / sims) * 100).toFixed(1),
        eliteEightProb: +((c.e8 / sims) * 100).toFixed(1),
        finalFourProb: +((c.ff / sims) * 100).toFixed(1),
        finalsProb: +((c.finals / sims) * 100).toFixed(1),
        champProb: +((c.champ / sims) * 100).toFixed(1),
      };
    })
    .sort((a, b) => b.champProb - a.champProb);
  
  return { sims, results, generatedAt: new Date().toISOString() };
}

/**
 * Simulate a pod winner (when Round 2 result not yet available)
 */
function simPodWinner(region, pod) {
  const podIndex = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].indexOf(pod);
  const flow = ROUND2_FLOW[podIndex];
  if (!flow) return null;
  
  // Get R1 winners or simulate
  let team1 = getRound1Winner(region, flow.r1a[0], flow.r1a[1]);
  if (!team1) {
    const a = findTeamBySeed(region, flow.r1a[0]);
    const b = findTeamBySeed(region, flow.r1a[1]);
    team1 = (a && b) ? simGame(a, b) : (a || b);
  }
  
  let team2 = getRound1Winner(region, flow.r1b[0], flow.r1b[1]);
  if (!team2) {
    const a = findTeamBySeed(region, flow.r1b[0]);
    const b = findTeamBySeed(region, flow.r1b[1]);
    team2 = (a && b) ? simGame(a, b) : (a || b);
  }
  
  return (team1 && team2) ? simGame(team1, team2) : (team1 || team2);
}

/**
 * Simulate a single game with random outcome based on model probability
 */
function simGame(awayAbbr, homeAbbr) {
  if (!ncaa || !awayAbbr || !homeAbbr) return awayAbbr || homeAbbr;
  const pred = ncaa.predict(awayAbbr, homeAbbr);
  if (pred.error) return awayAbbr;
  return Math.random() < pred.blendedAwayWinProb ? awayAbbr : homeAbbr;
}

// ==================== CONDITIONAL FUTURES VALUE ====================

/**
 * Calculate conditional championship probabilities
 * "If team X wins their Sweet 16 game, what's their championship probability?"
 * This is key for futures value detection — books update slowly after each round
 */
function conditionalFuturesValue(teamAbbr) {
  if (!ncaa) return { error: 'NCAA model not loaded' };
  const team = ncaa.TEAMS[teamAbbr];
  if (!team) return { error: `Team ${teamAbbr} not found` };
  
  // Run full sim
  const fullSim = enhancedBracketSim(10000);
  const teamResult = fullSim.results.find(r => r.team === teamAbbr);
  
  if (!teamResult) return { error: 'Team not in bracket' };
  
  // Conditional: given they make Elite 8 (win S16), what's their champ prob?
  const s16Prob = teamResult.sweet16Prob / 100;
  const e8Prob = teamResult.eliteEightProb / 100;
  const ffProb = teamResult.finalFourProb / 100;
  const champProb = teamResult.champProb / 100;
  
  return {
    team: teamAbbr,
    name: team.name,
    seed: team.seed,
    region: team.region,
    kenpom: team.kenpom,
    unconditional: {
      sweet16: teamResult.sweet16Prob,
      eliteEight: teamResult.eliteEightProb,
      finalFour: teamResult.finalFourProb,
      championship: teamResult.champProb,
    },
    conditional: {
      champGivenS16: s16Prob > 0 ? +((champProb / s16Prob) * 100).toFixed(1) : 0,
      champGivenE8: e8Prob > 0 ? +((champProb / e8Prob) * 100).toFixed(1) : 0,
      champGivenFF: ffProb > 0 ? +((champProb / ffProb) * 100).toFixed(1) : 0,
      e8GivenS16: s16Prob > 0 ? +((e8Prob / s16Prob) * 100).toFixed(1) : 0,
      ffGivenE8: e8Prob > 0 ? +((ffProb / e8Prob) * 100).toFixed(1) : 0,
    },
    insight: generateFuturesInsight(teamAbbr, teamResult),
  };
}

/**
 * Generate insight text for futures betting
 */
function generateFuturesInsight(abbr, simResult) {
  const team = ncaa.TEAMS[abbr];
  if (!team) return '';
  
  const insights = [];
  
  if (simResult.champProb > 15) {
    insights.push(`🔥 ${team.name} is the model's top championship pick at ${simResult.champProb}%`);
  } else if (simResult.champProb > 8) {
    insights.push(`💪 ${team.name} has a legit shot at ${simResult.champProb}% championship probability`);
  }
  
  if (simResult.finalFourProb > 40) {
    insights.push(`📈 Strong Final Four probability (${simResult.finalFourProb}%) — look for region winner futures value`);
  }
  
  // Check if seed suggests lower market odds than model
  if (team.seed >= 3 && simResult.champProb > 5) {
    insights.push(`🎯 #${team.seed} seed but model gives ${simResult.champProb}% championship probability — likely underpriced in futures market`);
  }
  
  if (team.adjD < 90) {
    insights.push(`🛡️ Elite defense (AdjD: ${team.adjD}) — defense wins championships in March`);
  }
  
  return insights.join(' | ');
}

// ==================== EXPORTS ====================

module.exports = {
  generateSweet16Matchups,
  getSweet16WarRoom,
  enhancedBracketSim,
  conditionalFuturesValue,
  getRound1Winner,
  getRound2Winner,
  getSweet16Winner,
  getRegionWinner,
  findTeamBySeed,
  getPodSurvivors,
  generateGameSignals,
  BRACKET_PODS,
  ROUND1_MATCHUPS,
  ROUND2_FLOW,
  SWEET16_FLOW,
  FF_MATCHUPS,
};
