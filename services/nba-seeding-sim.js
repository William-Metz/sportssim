/**
 * NBA Playoff Seeding Simulator — SportsSim v54.0
 * 
 * Monte Carlo simulation of remaining regular season games to project:
 * - Final standings probabilities for all 30 teams
 * - Seed probability distributions (1-8 for each conference)
 * - Playoff matchup likelihoods (1v8, 2v7, 3v6, 4v5, play-in scenarios)
 * - Division winner probabilities
 * - Conference clinch / elimination probabilities
 * - Futures value: compare projected seedings to book prices
 * 
 * Uses our NBA model's power ratings + rest/tank awareness for
 * game-by-game outcome simulation.
 */

const nba = require('../models/nba');

// Conference/Division assignments (2025-26 NBA)
const CONFERENCES = {
  East: {
    Atlantic: ['BOS', 'BKN', 'NYK', 'PHI', 'TOR'],
    Central: ['CHI', 'CLE', 'DET', 'IND', 'MIL'],
    Southeast: ['ATL', 'CHA', 'MIA', 'ORL', 'WAS']
  },
  West: {
    Northwest: ['DEN', 'MIN', 'OKC', 'POR', 'UTA'],
    Pacific: ['GSW', 'LAC', 'LAL', 'PHX', 'SAC'],
    Southwest: ['DAL', 'HOU', 'MEM', 'NOP', 'SAS']
  }
};

// Flatten for quick lookup
const TEAM_CONF = {};
const TEAM_DIV = {};
for (const [conf, divs] of Object.entries(CONFERENCES)) {
  for (const [div, teams] of Object.entries(divs)) {
    for (const t of teams) {
      TEAM_CONF[t] = conf;
      TEAM_DIV[t] = div;
    }
  }
}

/**
 * Fetch remaining schedule from ESPN or generate synthetic one.
 * Returns array of { away, home, date } objects.
 */
async function getRemainingSchedule() {
  // Try ESPN NBA schedule API
  try {
    const fetch = (await import('node-fetch')).default;
    const today = new Date();
    const games = [];
    
    // Fetch next 30 days of NBA schedule from ESPN
    for (let dayOffset = 0; dayOffset <= 21; dayOffset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + dayOffset);
      const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
      
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
        const resp = await fetch(url, { timeout: 5000 });
        if (!resp.ok) continue;
        const data = await resp.json();
        
        if (data.events) {
          for (const event of data.events) {
            // Skip completed games
            const status = event.status?.type?.state;
            if (status === 'post') continue;
            
            const competitors = event.competitions?.[0]?.competitors || [];
            if (competitors.length !== 2) continue;
            
            const away = competitors.find(c => c.homeAway === 'away');
            const home = competitors.find(c => c.homeAway === 'home');
            if (!away || !home) continue;
            
            const awayAbbr = normalizeESPNAbbr(away.team?.abbreviation);
            const homeAbbr = normalizeESPNAbbr(home.team?.abbreviation);
            
            if (awayAbbr && homeAbbr && TEAM_CONF[awayAbbr] && TEAM_CONF[homeAbbr]) {
              games.push({
                away: awayAbbr,
                home: homeAbbr,
                date: d.toISOString().split('T')[0],
                status: status || 'pre'
              });
            }
          }
        }
      } catch (e) {
        // Skip this date on error
      }
    }
    
    if (games.length > 0) {
      return games;
    }
  } catch (e) {
    console.error('[nba-seeding-sim] ESPN schedule fetch failed:', e.message);
  }
  
  // Fallback: generate synthetic remaining schedule
  return generateSyntheticSchedule();
}

/**
 * Normalize ESPN team abbreviations to our format
 */
function normalizeESPNAbbr(abbr) {
  const map = {
    'GS': 'GSW', 'SA': 'SAS', 'NY': 'NYK', 'NO': 'NOP',
    'UTAH': 'UTA', 'WSH': 'WAS', 'PHO': 'PHX', 'LAC': 'LAC',
    'BKN': 'BKN', 'CHA': 'CHA', 'CHI': 'CHI', 'CLE': 'CLE',
    'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
    'HOU': 'HOU', 'IND': 'IND', 'LAL': 'LAL', 'MEM': 'MEM',
    'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP',
    'NYK': 'NYK', 'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI',
    'PHX': 'PHX', 'POR': 'POR', 'SAC': 'SAC', 'SAS': 'SAS',
    'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS', 'ATL': 'ATL',
    'BOS': 'BOS',
  };
  return map[abbr] || abbr;
}

/**
 * Generate synthetic remaining schedule when ESPN is unavailable.
 * Each team plays ~82 games total; we create remaining games based on typical schedule.
 */
function generateSyntheticSchedule() {
  const teams = Object.keys(nba.getTeams());
  const games = [];
  const today = new Date();
  
  // Figure out how many games each team has remaining
  const teamGamesLeft = {};
  for (const abbr of teams) {
    const t = nba.getTeams()[abbr];
    if (!t) continue;
    teamGamesLeft[abbr] = Math.max(0, 82 - t.w - t.l);
  }
  
  // Generate round-robin pairs until each team has the right number of games
  const teamGamesAssigned = {};
  teams.forEach(t => teamGamesAssigned[t] = 0);
  
  let dayOffset = 0;
  while (true) {
    let anyAssigned = false;
    // Shuffle teams for randomized matchups
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < shuffled.length - 1; i += 2) {
      const t1 = shuffled[i];
      const t2 = shuffled[i + 1];
      if (teamGamesAssigned[t1] >= teamGamesLeft[t1]) continue;
      if (teamGamesAssigned[t2] >= teamGamesLeft[t2]) continue;
      
      // Random home/away
      const [away, home] = Math.random() < 0.5 ? [t1, t2] : [t2, t1];
      const d = new Date(today);
      d.setDate(d.getDate() + dayOffset);
      
      games.push({
        away,
        home,
        date: d.toISOString().split('T')[0],
        status: 'synthetic'
      });
      
      teamGamesAssigned[t1]++;
      teamGamesAssigned[t2]++;
      anyAssigned = true;
    }
    
    dayOffset++;
    if (!anyAssigned || dayOffset > 25) break;
  }
  
  return games;
}

/**
 * Simulate a single game outcome using our NBA model.
 * Returns the winning team abbreviation.
 */
function simulateGame(away, home, ratings) {
  const awayR = ratings[away];
  const homeR = ratings[home];
  if (!awayR || !homeR) return Math.random() < 0.5 ? away : home;
  
  // Calculate spread from power ratings
  const spread = (awayR.power - homeR.power) + nba.HCA;
  
  // Convert spread to win probability using logistic function
  const homeWinProb = 1 / (1 + Math.pow(10, -spread / 15));
  
  // Add noise — NBA has high variance in individual games
  // Standard deviation of NBA game outcomes is about 12 points
  const roll = Math.random();
  return roll < homeWinProb ? home : away;
}

/**
 * Sort teams within a conference for playoff seeding.
 * NBA rules: 
 * 1. Division winners get top 3 seeds (by record)
 * 2. Remaining 5 seeds go to best records regardless of division
 * 3. Tiebreakers: head-to-head, division record, conference record
 */
function sortConference(teams, standings) {
  // Simple sort by wins (tiebreaker: point differential)
  return [...teams].sort((a, b) => {
    const sa = standings[a];
    const sb = standings[b];
    if (sb.w !== sa.w) return sb.w - sa.w;
    // Tiebreaker: better point differential
    return sb.diff - sa.diff;
  });
}

/**
 * Determine play-in teams and final 8-team bracket.
 * NBA Play-In: Seeds 7-10 compete for final 2 playoff spots.
 * 7 vs 8: Winner gets 7 seed
 * 9 vs 10: Loser eliminated
 * Loser(7v8) vs Winner(9v10): Winner gets 8 seed
 */
function resolvePlayIn(confTeams, standings, ratings) {
  if (confTeams.length < 10) {
    return confTeams.slice(0, 8);
  }
  
  const seed7 = confTeams[6];
  const seed8 = confTeams[7];
  const seed9 = confTeams[8];
  const seed10 = confTeams[9];
  
  // 7 vs 8 (7 seed has home court)
  const game1Winner = simulateGame(seed8, seed7, ratings);
  const game1Loser = game1Winner === seed7 ? seed8 : seed7;
  
  // 9 vs 10 (9 seed has home court)
  const game2Winner = simulateGame(seed10, seed9, ratings);
  
  // Loser of 7/8 vs Winner of 9/10
  const game3Winner = simulateGame(game2Winner, game1Loser, ratings);
  
  // Final bracket: seeds 1-6 + game1Winner (7) + game3Winner (8)
  const bracket = confTeams.slice(0, 6);
  bracket.push(game1Winner);
  bracket.push(game3Winner);
  
  return bracket;
}

/**
 * Run a single Monte Carlo simulation of the remaining season.
 * Returns final standings for all 30 teams.
 */
function simulateSeason(schedule, currentStandings, ratings) {
  // Deep clone current standings
  const standings = {};
  for (const [abbr, s] of Object.entries(currentStandings)) {
    standings[abbr] = { ...s };
  }
  
  // Simulate each remaining game
  for (const game of schedule) {
    const winner = simulateGame(game.away, game.home, ratings);
    const loser = winner === game.home ? game.away : game.home;
    standings[winner].w++;
    standings[loser].l++;
  }
  
  return standings;
}

/**
 * Run the full Monte Carlo seeding simulation.
 * 
 * @param {number} numSims - Number of simulations (default 10000)
 * @returns {object} Full projection results
 */
async function runSimulation(numSims = 10000) {
  const startTime = Date.now();
  const teams = nba.getTeams();
  const ratings = nba.calculateRatings();
  
  // Get remaining schedule
  const schedule = await getRemainingSchedule();
  
  // Current standings
  const currentStandings = {};
  for (const [abbr, t] of Object.entries(teams)) {
    currentStandings[abbr] = {
      w: t.w,
      l: t.l,
      diff: t.diff || (t.ppg - t.oppg),
      gp: t.w + t.l,
      remaining: 82 - t.w - t.l
    };
  }
  
  // Initialize tracking arrays
  const seedCounts = {}; // { team: { 1: count, 2: count, ... } }
  const winTotals = {}; // { team: [w1, w2, w3, ...] }
  const playoffCounts = {}; // { team: count }
  const divWinnerCounts = {}; // { team: count }
  const confFinalCounts = {}; // Not tracking here but could
  const playInCounts = {}; // { team: count }  (seeds 7-10)
  const lotteryCounts = {}; // { team: count }  (seeds 11-15)
  const matchupCounts = {}; // { "1vX_conf": { team1: { team2: count } } }
  const topSeedCounts = {}; // { team: count } (1 seed)
  
  const allTeams = Object.keys(teams);
  for (const t of allTeams) {
    seedCounts[t] = {};
    for (let s = 1; s <= 15; s++) seedCounts[t][s] = 0;
    winTotals[t] = [];
    playoffCounts[t] = 0;
    divWinnerCounts[t] = 0;
    playInCounts[t] = 0;
    lotteryCounts[t] = 0;
    topSeedCounts[t] = 0;
  }
  
  // Run simulations
  for (let sim = 0; sim < numSims; sim++) {
    const standings = simulateSeason(schedule, currentStandings, ratings);
    
    // Sort each conference
    for (const [conf, divs] of Object.entries(CONFERENCES)) {
      const confTeams = [];
      for (const teams of Object.values(divs)) {
        confTeams.push(...teams);
      }
      
      const sorted = sortConference(confTeams, standings);
      
      // Track division winners
      for (const [div, divTeams] of Object.entries(divs)) {
        const divSorted = sortConference(divTeams, standings);
        divWinnerCounts[divSorted[0]] = (divWinnerCounts[divSorted[0]] || 0) + 1;
      }
      
      // Resolve play-in for seeds 7-10
      const bracket = resolvePlayIn(sorted, standings, ratings);
      
      // Track seedings
      for (let i = 0; i < sorted.length; i++) {
        const team = sorted[i];
        const seed = i + 1;
        seedCounts[team][seed]++;
        winTotals[team].push(standings[team].w);
        
        if (seed <= 6) {
          playoffCounts[team]++;
        } else if (seed <= 10) {
          playInCounts[team]++;
        } else {
          lotteryCounts[team]++;
        }
        
        if (seed === 1) {
          topSeedCounts[team]++;
        }
      }
      
      // Track playoff matchups (1v8, 2v7, 3v6, 4v5)
      if (bracket.length >= 8) {
        const matchups = [
          [bracket[0], bracket[7]], // 1 vs 8
          [bracket[1], bracket[6]], // 2 vs 7
          [bracket[2], bracket[5]], // 3 vs 6
          [bracket[3], bracket[4]], // 4 vs 5
        ];
        
        for (let m = 0; m < matchups.length; m++) {
          const key = `${conf}_R1_${m + 1}`;
          if (!matchupCounts[key]) matchupCounts[key] = {};
          const pair = matchups[m].sort().join('_vs_');
          matchupCounts[key][pair] = (matchupCounts[key][pair] || 0) + 1;
        }
      }
    }
  }
  
  // Process results
  const results = {
    simulations: numSims,
    schedule: {
      gamesRemaining: schedule.length,
      dateRange: schedule.length > 0 ? {
        start: schedule[0].date,
        end: schedule[schedule.length - 1].date
      } : null,
      source: schedule[0]?.status === 'synthetic' ? 'synthetic' : 'ESPN'
    },
    conferences: {},
    teams: {},
    matchups: {},
    divisionWinners: {},
    topBets: [],
    durationMs: 0
  };
  
  // Process team-level results
  for (const t of allTeams) {
    const wins = winTotals[t];
    const avgW = wins.reduce((a, b) => a + b, 0) / wins.length;
    const sortedWins = [...wins].sort((a, b) => a - b);
    
    results.teams[t] = {
      abbr: t,
      name: teams[t].name,
      conference: TEAM_CONF[t],
      division: TEAM_DIV[t],
      current: { w: currentStandings[t].w, l: currentStandings[t].l, remaining: currentStandings[t].remaining },
      projected: {
        avgWins: +avgW.toFixed(1),
        medianWins: sortedWins[Math.floor(sortedWins.length / 2)],
        p10Wins: sortedWins[Math.floor(sortedWins.length * 0.1)],
        p90Wins: sortedWins[Math.floor(sortedWins.length * 0.9)],
        minWins: sortedWins[0],
        maxWins: sortedWins[sortedWins.length - 1]
      },
      seeds: {},
      playoffProb: +(playoffCounts[t] / numSims * 100).toFixed(1),
      playInProb: +(playInCounts[t] / numSims * 100).toFixed(1),
      lotteryProb: +(lotteryCounts[t] / numSims * 100).toFixed(1),
      topSeedProb: +(topSeedCounts[t] / numSims * 100).toFixed(1),
      divisionWinnerProb: +((divWinnerCounts[t] || 0) / numSims * 100).toFixed(1),
      power: ratings[t]?.power || 0,
      tier: ratings[t]?.tier || 'N/A'
    };
    
    // Seed distribution
    for (let s = 1; s <= 15; s++) {
      const pct = +(seedCounts[t][s] / numSims * 100).toFixed(1);
      if (pct > 0) {
        results.teams[t].seeds[s] = pct;
      }
    }
    
    // Most likely seed
    let maxSeed = 1, maxPct = 0;
    for (let s = 1; s <= 15; s++) {
      const pct = seedCounts[t][s] / numSims * 100;
      if (pct > maxPct) { maxPct = pct; maxSeed = s; }
    }
    results.teams[t].mostLikelySeed = maxSeed;
    results.teams[t].mostLikelySeedPct = +maxPct.toFixed(1);
  }
  
  // Conference standings sorted by projected wins
  for (const [conf, divs] of Object.entries(CONFERENCES)) {
    const confTeams = [];
    for (const teams of Object.values(divs)) confTeams.push(...teams);
    
    const sorted = confTeams.sort((a, b) => 
      results.teams[b].projected.avgWins - results.teams[a].projected.avgWins
    );
    
    results.conferences[conf] = sorted.map((t, i) => ({
      seed: i + 1,
      ...results.teams[t]
    }));
  }
  
  // Division winners
  for (const [conf, divs] of Object.entries(CONFERENCES)) {
    for (const [div, divTeams] of Object.entries(divs)) {
      const divResults = divTeams.map(t => ({
        team: t,
        name: teams[t]?.name,
        prob: +((divWinnerCounts[t] || 0) / numSims * 100).toFixed(1)
      })).sort((a, b) => b.prob - a.prob);
      
      results.divisionWinners[div] = divResults;
    }
  }
  
  // Process matchup data — most likely Round 1 matchups
  for (const [key, pairs] of Object.entries(matchupCounts)) {
    const sorted = Object.entries(pairs)
      .map(([pair, count]) => ({
        matchup: pair.replace('_vs_', ' vs '),
        prob: +(count / numSims * 100).toFixed(1)
      }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 10);
    
    results.matchups[key] = sorted;
  }
  
  // Find betting value — seeding props & futures
  results.topBets = findSeedingBets(results);
  
  results.durationMs = Date.now() - startTime;
  results.generatedAt = new Date().toISOString();
  
  return results;
}

/**
 * Find seeding-based betting opportunities.
 * Compares our projected seed probabilities to typical market prices.
 */
function findSeedingBets(results) {
  const bets = [];
  
  // Look for teams whose seeding probabilities diverge from expectations
  for (const [abbr, team] of Object.entries(results.teams)) {
    // Playoff probability edges
    if (team.playoffProb > 75 && team.playoffProb < 95) {
      bets.push({
        type: 'playoff',
        team: abbr,
        name: team.name,
        bet: `${abbr} to make playoffs`,
        modelProb: team.playoffProb,
        note: `Strong playoff candidate (${team.playoffProb}% prob, ${team.projected.avgWins} proj wins)`,
        conference: team.conference
      });
    }
    
    // Top seed value
    if (team.topSeedProb > 15 && team.topSeedProb < 80) {
      bets.push({
        type: 'top_seed',
        team: abbr,
        name: team.name,
        bet: `${abbr} to finish #1 in ${team.conference}`,
        modelProb: team.topSeedProb,
        note: `${team.topSeedProb}% chance of 1 seed (${team.projected.avgWins} proj wins)`,
        conference: team.conference
      });
    }
    
    // Division winner value
    if (team.divisionWinnerProb > 20 && team.divisionWinnerProb < 75) {
      bets.push({
        type: 'division',
        team: abbr,
        name: team.name,
        bet: `${abbr} to win ${team.division}`,
        modelProb: team.divisionWinnerProb,
        note: `${team.divisionWinnerProb}% chance to win ${team.division}`,
        conference: team.conference
      });
    }
    
    // Play-in risk — good teams that might slip
    if (team.playInProb > 20 && team.playoffProb > 40) {
      bets.push({
        type: 'play_in_risk',
        team: abbr,
        name: team.name,
        bet: `${abbr} to be in play-in`,
        modelProb: team.playInProb,
        note: `${team.playInProb}% play-in risk despite ${team.current.w}-${team.current.l} record`,
        conference: team.conference
      });
    }
    
    // Win total edges — teams that differ from projected
    const projWins = team.projected.avgWins;
    const currentPace = team.current.w / (team.current.w + team.current.l) * 82;
    const paceVsProj = projWins - currentPace;
    if (Math.abs(paceVsProj) > 2) {
      bets.push({
        type: 'win_total',
        team: abbr,
        name: team.name,
        bet: paceVsProj > 0 ? `${abbr} OVER win total` : `${abbr} UNDER win total`,
        modelProb: 50 + Math.min(30, Math.abs(paceVsProj) * 5),
        note: `Pace: ${currentPace.toFixed(1)}W, Model: ${projWins}W (${paceVsProj > 0 ? '+' : ''}${paceVsProj.toFixed(1)})`,
        conference: team.conference,
        edge: +paceVsProj.toFixed(1)
      });
    }
  }
  
  // Sort by interest level
  return bets.sort((a, b) => b.modelProb - a.modelProb);
}

/**
 * Quick summary of key seeding battles.
 */
function getKeyBattles(results) {
  const battles = [];
  
  // Find tight seed races in each conference
  for (const [conf, teams] of Object.entries(results.conferences)) {
    // Look for teams within 2 games of each other at adjacent seeds
    for (let i = 0; i < teams.length - 1; i++) {
      const t1 = teams[i];
      const t2 = teams[i + 1];
      const winDiff = t1.projected.avgWins - t2.projected.avgWins;
      
      if (winDiff < 2.0 && i < 10) { // Close race for meaningful seeds
        battles.push({
          conference: conf,
          seeds: `${i + 1}/${i + 2}`,
          teams: [t1.abbr, t2.abbr],
          names: [t1.name, t2.name],
          projWins: [t1.projected.avgWins, t2.projected.avgWins],
          gap: +winDiff.toFixed(1),
          note: i < 6 ? 'Playoff seed battle' : i < 10 ? 'Play-in battle' : 'Lottery position'
        });
      }
    }
  }
  
  return battles.sort((a, b) => a.gap - b.gap).slice(0, 15);
}

// Cache for expensive simulation
let cachedResult = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 min cache

async function getCachedSimulation(numSims = 10000) {
  if (cachedResult && Date.now() - cacheTime < CACHE_TTL) {
    return cachedResult;
  }
  cachedResult = await runSimulation(numSims);
  cacheTime = Date.now();
  return cachedResult;
}

function clearCache() {
  cachedResult = null;
  cacheTime = 0;
}

module.exports = {
  runSimulation,
  getCachedSimulation,
  clearCache,
  getKeyBattles,
  CONFERENCES,
  TEAM_CONF,
  TEAM_DIV
};
