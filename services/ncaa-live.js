/**
 * NCAA Tournament Live Scores & Results Service
 * 
 * Auto-fetches live scores from ESPN API and updates the NCAA model's
 * bracket state as games complete. Tracks:
 * - Live scores for in-progress games
 * - Completed game results (auto-adds to TOURNAMENT_RESULTS)
 * - Sweet 16 matchup auto-generation when Round 2 completes
 * - Tournament momentum metrics (MOV, clutch factor)
 * 
 * ESPN API: site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard
 */

const ncaa = require('../models/ncaa');

// Cache for live scores
let liveCache = { data: null, ts: 0 };
const CACHE_TTL = 60 * 1000; // 1 minute for live scores

// ESPN team name → our abbreviation mapping
const ESPN_TEAM_MAP = {
  'duke blue devils': 'DUKE', 'duke': 'DUKE',
  'michigan wolverines': 'MICH', 'michigan': 'MICH',
  'arizona wildcats': 'ARIZ', 'arizona': 'ARIZ',
  'florida gators': 'FLA', 'florida': 'FLA',
  'houston cougars': 'HOU', 'houston': 'HOU',
  'iowa state cyclones': 'IAST', 'iowa st': 'IAST', 'iowa state': 'IAST',
  'illinois fighting illini': 'ILL', 'illinois': 'ILL',
  'purdue boilermakers': 'PUR', 'purdue': 'PUR',
  'michigan state spartans': 'MSU', 'michigan st': 'MSU', 'michigan state': 'MSU',
  'gonzaga bulldogs': 'GONZ', 'gonzaga': 'GONZ',
  'uconn huskies': 'UCON', 'connecticut huskies': 'UCON', 'uconn': 'UCON', 'connecticut': 'UCON',
  'vanderbilt commodores': 'VAND', 'vanderbilt': 'VAND',
  'virginia cavaliers': 'UVA', 'virginia': 'UVA',
  'nebraska cornhuskers': 'NEB', 'nebraska': 'NEB',
  'tennessee volunteers': 'TENN', 'tennessee': 'TENN',
  "st. john's red storm": 'STJN', 'st. johns red storm': 'STJN', "st. john's": 'STJN',
  'alabama crimson tide': 'BAMA', 'alabama': 'BAMA',
  'louisville cardinals': 'LVIL', 'louisville': 'LVIL',
  'arkansas razorbacks': 'ARK', 'arkansas': 'ARK',
  'texas tech red raiders': 'TTECH', 'texas tech': 'TTECH',
  'kansas jayhawks': 'KU', 'kansas': 'KU',
  'wisconsin badgers': 'WISC', 'wisconsin': 'WISC',
  'ucla bruins': 'UCLA', 'ucla': 'UCLA',
  'iowa hawkeyes': 'IOWA', 'iowa': 'IOWA',
  'ohio state buckeyes': 'OSU', 'ohio state': 'OSU', 'ohio st': 'OSU',
  'north carolina tar heels': 'UNC', 'north carolina': 'UNC', 'unc': 'UNC',
  'utah state aggies': 'UTST', 'utah state': 'UTST', 'utah st': 'UTST',
  'byu cougars': 'BYU', 'byu': 'BYU',
  'kentucky wildcats': 'KEN', 'kentucky': 'KEN',
  'miami hurricanes': 'MIAMI', 'miami': 'MIAMI', 'miami fl': 'MIAMI',
  "saint mary's gaels": 'SMARY', "saint mary's": 'SMARY', "st. mary's": 'SMARY',
  'georgia bulldogs': 'GA', 'georgia': 'GA',
  'clemson tigers': 'CLEM', 'clemson': 'CLEM',
  'tcu horned frogs': 'TCU', 'tcu': 'TCU',
  'villanova wildcats': 'NOVA', 'villanova': 'NOVA',
  'saint louis billikens': 'STLOU', 'saint louis': 'STLOU', 'st. louis': 'STLOU',
  'santa clara broncos': 'SCLA', 'santa clara': 'SCLA',
  'texas a&m aggies': 'TAMU', 'texas a&m': 'TAMU',
  'ucf knights': 'UCF', 'ucf': 'UCF',
  'south florida bulls': 'USF', 'south florida': 'USF', 'usf': 'USF',
  'vcu rams': 'VCU', 'vcu': 'VCU',
  'texas longhorns': 'TEX', 'texas': 'TEX',
  'miami (ohio) redhawks': 'MOHI', 'miami ohio': 'MOHI', 'miami (oh)': 'MOHI',
  'high point panthers': 'HPNT', 'high point': 'HPNT',
  'akron zips': 'AKRN', 'akron': 'AKRN',
  'northern iowa panthers': 'NIOWA', 'northern iowa': 'NIOWA', 'n. iowa': 'NIOWA',
  'mcneese cowboys': 'MCNEE', 'mcneese': 'MCNEE', 'mcneese state': 'MCNEE', 'mcneese st': 'MCNEE',
  'missouri tigers': 'MIZZOU', 'missouri': 'MIZZOU',
  'hofstra pride': 'HOFS', 'hofstra': 'HOFS',
  'cal baptist lancers': 'CBAP', 'california baptist': 'CBAP', 'cal baptist': 'CBAP',
  'hawaii rainbow warriors': 'HAW', "hawai'i": 'HAW', 'hawaii': 'HAW',
  'troy trojans': 'TROY', 'troy': 'TROY',
  'wright state raiders': 'WRIST', 'wright state': 'WRIST', 'wright st': 'WRIST',
  'north dakota state bison': 'NDSU', 'north dakota state': 'NDSU', 'north dakota st': 'NDSU',
  'kennesaw state owls': 'KENN', 'kennesaw state': 'KENN', 'kennesaw st': 'KENN',
  'penn quakers': 'PENN', 'penn': 'PENN', 'pennsylvania': 'PENN',
  'furman paladins': 'FURM', 'furman': 'FURM',
  'tennessee state tigers': 'TNST', 'tennessee state': 'TNST', 'tennessee st': 'TNST',
  'idaho vandals': 'IDAHO', 'idaho': 'IDAHO',
  'queens royals': 'QNS', 'queens': 'QNS',
  'siena saints': 'SIENA', 'siena': 'SIENA',
  'liu sharks': 'LIU', 'liu': 'LIU', 'long island': 'LIU',
  'howard bison': 'HOWARD', 'howard': 'HOWARD',
  'prairie view a&m panthers': 'PVA', 'prairie view': 'PVA', 'prairie view a&m': 'PVA',
  'nc state wolfpack': 'NCST', 'nc state': 'NCST', 'north carolina state': 'NCST',
};

function resolveTeamAbbr(espnName) {
  if (!espnName) return null;
  const lower = espnName.toLowerCase().trim();
  
  // Direct lookup
  if (ESPN_TEAM_MAP[lower]) return ESPN_TEAM_MAP[lower];
  
  // Try partial match
  for (const [key, abbr] of Object.entries(ESPN_TEAM_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return abbr;
  }
  
  // Fall back to ncaa.findTeamAbbr
  return ncaa.findTeamAbbr(espnName);
}

/**
 * Fetch live NCAA tournament scores from ESPN
 */
async function fetchLiveScores() {
  const now = Date.now();
  if (liveCache.data && (now - liveCache.ts) < CACHE_TTL) {
    return liveCache.data;
  }
  
  try {
    // ESPN scoreboard for today's NCAA tournament games
    const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=50';
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`ESPN API ${resp.status}`);
    const data = await resp.json();
    
    const games = [];
    for (const event of (data.events || [])) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      // Check if this is a tournament game
      const isTournament = event.season?.slug === 'post-season' || 
                          (competition.type?.abbreviation === 'TOURN') ||
                          event.name?.toLowerCase()?.includes('ncaa') ||
                          true; // Include all games during tournament period
      
      const competitors = competition.competitors || [];
      if (competitors.length !== 2) continue;
      
      const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
      const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
      
      const homeAbbr = resolveTeamAbbr(home.team?.displayName || home.team?.name);
      const awayAbbr = resolveTeamAbbr(away.team?.displayName || away.team?.name);
      
      const status = competition.status?.type?.name || 'STATUS_SCHEDULED';
      const statusDetail = competition.status?.type?.shortDetail || '';
      const clock = competition.status?.displayClock || '';
      const period = competition.status?.period || 0;
      
      const game = {
        id: event.id,
        name: event.name || `${away.team?.displayName} @ ${home.team?.displayName}`,
        homeTeam: home.team?.displayName || 'Unknown',
        awayTeam: away.team?.displayName || 'Unknown',
        homeAbbr: homeAbbr,
        awayAbbr: awayAbbr,
        homeScore: parseInt(home.score) || 0,
        awayScore: parseInt(away.score) || 0,
        homeSeed: home.curatedRank?.current || null,
        awaySeed: away.curatedRank?.current || null,
        status,
        statusDetail,
        clock,
        period,
        isComplete: status === 'STATUS_FINAL',
        isLive: status === 'STATUS_IN_PROGRESS' || status === 'STATUS_HALFTIME',
        isScheduled: status === 'STATUS_SCHEDULED',
        startTime: event.date,
        notes: competition.notes?.[0]?.headline || '',
        isTournament,
        // For tournament tracking
        round: inferRound(competition.notes?.[0]?.headline || event.name || ''),
      };
      
      games.push(game);
    }
    
    liveCache.data = {
      games,
      fetchedAt: new Date().toISOString(),
      tournamentGames: games.filter(g => g.isTournament).length,
      liveGames: games.filter(g => g.isLive).length,
      completedGames: games.filter(g => g.isComplete).length,
    };
    liveCache.ts = now;
    
    return liveCache.data;
  } catch (err) {
    console.error('[ncaa-live] Error fetching scores:', err.message);
    return liveCache.data || { games: [], error: err.message, fetchedAt: new Date().toISOString() };
  }
}

/**
 * Infer tournament round from game notes/name
 */
function inferRound(text) {
  const lower = text.toLowerCase();
  if (lower.includes('championship') || lower.includes('title game')) return 'Championship';
  if (lower.includes('final four') || lower.includes('semifinal')) return 'Final Four';
  if (lower.includes('elite eight') || lower.includes('elite 8') || lower.includes('regional final')) return 'Elite Eight';
  if (lower.includes('sweet sixteen') || lower.includes('sweet 16') || lower.includes('regional semifinal')) return 'Sweet 16';
  if (lower.includes('second round') || lower.includes('round of 32')) return 'Round 2';
  if (lower.includes('first round') || lower.includes('round of 64')) return 'Round 1';
  if (lower.includes('first four')) return 'First Four';
  return null;
}

/**
 * Auto-update bracket with completed games
 * Checks live scores and adds any completed tournament games to the model
 */
async function updateBracketResults() {
  const live = await fetchLiveScores();
  if (!live || !live.games) return { updated: 0, errors: [] };
  
  let updated = 0;
  const errors = [];
  const newResults = [];
  
  for (const game of live.games) {
    if (!game.isComplete) continue;
    if (!game.homeAbbr || !game.awayAbbr) continue;
    
    // Determine winner
    const winner = game.homeScore > game.awayScore ? game.homeAbbr : game.awayAbbr;
    const loser = game.homeScore > game.awayScore ? game.awayAbbr : game.homeAbbr;
    const winScore = Math.max(game.homeScore, game.awayScore);
    const loseScore = Math.min(game.homeScore, game.awayScore);
    const score = `${winScore}-${loseScore}`;
    
    // Determine round
    let round = null;
    if (game.round) {
      round = game.round === 'Round 1' ? 1 : 
              game.round === 'Round 2' ? 2 :
              game.round === 'Sweet 16' ? 3 :
              game.round === 'Elite Eight' ? 4 :
              game.round === 'Final Four' ? 5 :
              game.round === 'Championship' ? 6 : null;
    }
    
    if (!round) {
      // Infer round from current tournament state + count of results
      // We know: round1 = 32 games, round2 = 16 games, sweet16 = 8, elite8 = 4, ff = 2, champ = 1
      const r1Count = (ncaa.TOURNAMENT_RESULTS.round1 || []).length;
      const r2Count = (ncaa.TOURNAMENT_RESULTS.round2 || []).length;
      const r3Count = (ncaa.TOURNAMENT_RESULTS.round3 || []).length;
      const r4Count = (ncaa.TOURNAMENT_RESULTS.round4 || []).length;
      const r5Count = (ncaa.TOURNAMENT_RESULTS.round5 || []).length;
      
      if (r1Count < 32) round = 1;
      else if (r2Count < 16) round = 2;
      else if (r3Count < 8) round = 3;
      else if (r4Count < 4) round = 4;
      else if (r5Count < 2) round = 5;
      else round = 6;
    }
    
    // Check if already tracked
    const roundKey = `round${round}`;
    const results = ncaa.TOURNAMENT_RESULTS[roundKey] || [];
    const exists = results.some(r => r.winner === winner && r.loser === loser);
    
    if (!exists) {
      // Check if both teams are in our model
      if (!ncaa.TEAMS[winner] && !ncaa.TEAMS[loser]) {
        continue; // Not a tournament game we're tracking
      }
      
      const notes = [];
      // Check for upset
      const winnerSeed = ncaa.TEAMS[winner]?.seed;
      const loserSeed = ncaa.TEAMS[loser]?.seed;
      if (winnerSeed && loserSeed && winnerSeed > loserSeed) {
        notes.push(`${winnerSeed}-seed upset over ${loserSeed}-seed!`);
      }
      // Check for OT
      if (game.statusDetail?.toLowerCase()?.includes('ot')) {
        notes.push('OT');
      }
      
      try {
        ncaa.addResult(round, winner, loser, score, notes.join(', '));
        updated++;
        newResults.push({ round, winner, loser, score, notes: notes.join(', ') });
        console.log(`[ncaa-live] Added result: R${round} ${winner} ${score} ${loser} ${notes.join(', ')}`);
      } catch (err) {
        errors.push(`Failed to add ${winner} vs ${loser}: ${err.message}`);
      }
    }
  }
  
  return { updated, newResults, errors };
}

/**
 * Get tournament momentum for a team based on performance vs expectations
 * Teams that are crushing opponents are "hot" — adjust predictions upward
 */
function getTournamentMomentum(abbr) {
  const allResults = [
    ...(ncaa.TOURNAMENT_RESULTS.round1 || []),
    ...(ncaa.TOURNAMENT_RESULTS.round2 || []),
    ...(ncaa.TOURNAMENT_RESULTS.round3 || []),
    ...(ncaa.TOURNAMENT_RESULTS.round4 || []),
    ...(ncaa.TOURNAMENT_RESULTS.round5 || []),
  ];
  
  const wins = allResults.filter(r => r.winner === abbr);
  const losses = allResults.filter(r => r.loser === abbr);
  
  if (wins.length === 0 && losses.length === 0) return null;
  
  // Calculate average margin of victory
  let totalMOV = 0;
  let gamesWithScores = 0;
  
  for (const w of wins) {
    if (w.score) {
      const [high, low] = w.score.split('-').map(Number);
      if (!isNaN(high) && !isNaN(low)) {
        totalMOV += (high - low);
        gamesWithScores++;
      }
    }
  }
  
  for (const l of losses) {
    if (l.score) {
      const [high, low] = l.score.split('-').map(Number);
      if (!isNaN(high) && !isNaN(low)) {
        totalMOV -= (high - low); // Negative for losses
        gamesWithScores++;
      }
    }
  }
  
  const avgMOV = gamesWithScores > 0 ? totalMOV / gamesWithScores : 0;
  
  // Momentum score: -1 to +1 scale
  // +20 MOV = max momentum, -20 = min
  const momentumRaw = Math.max(-1, Math.min(1, avgMOV / 20));
  
  // Classify
  let label = 'NEUTRAL';
  if (momentumRaw > 0.5) label = 'DOMINANT';
  else if (momentumRaw > 0.2) label = 'HOT';
  else if (momentumRaw > 0) label = 'WARM';
  else if (momentumRaw < -0.2) label = 'COLD';
  else if (momentumRaw < 0) label = 'COOL';
  
  return {
    wins: wins.length,
    losses: losses.length,
    alive: losses.length === 0,
    avgMOV: gamesWithScores > 0 ? +(totalMOV / gamesWithScores).toFixed(1) : 0,
    momentumScore: +momentumRaw.toFixed(3),
    label,
    // Tournament performance detail
    results: wins.map(w => ({
      vs: w.loser,
      score: w.score,
      round: w.round,
      mov: w.score ? (() => { const [h,l] = w.score.split('-').map(Number); return h-l; })() : null
    }))
  };
}

/**
 * Get full Sweet 16 bracket once Round 2 is complete
 * This generates proper matchup pairings based on the actual bracket structure
 */
function getSweet16Bracket() {
  const bracketState = ncaa.getBracketState();
  
  // Standard tournament bracket: 1v8/9 winner plays 4v5 winner, 2v7/10 winner plays 3v6/11 winner
  // In Sweet 16: upper half vs lower half of each region
  
  const matchups = {};
  const regions = ['East', 'West', 'Midwest', 'South'];
  
  for (const region of regions) {
    const regionData = bracketState.regions[region];
    if (!regionData) continue;
    
    const teams = regionData.teams || [];
    if (teams.length < 2) continue;
    
    // Sort by seed for pairing (1-seed half vs 2-seed half)
    const sorted = teams.sort((a, b) => (a.seed || 99) - (b.seed || 99));
    
    // Standard bracket pairing: highest seed vs lowest seed, etc.
    // In a typical bracket, 1 seed plays the winner of 4v5 or 12v13, etc.
    // Simplification: pair teams in seed order (1 vs highest remaining, 2 vs next highest)
    const pairings = [];
    const available = [...sorted];
    
    while (available.length >= 2) {
      const top = available.shift();
      const bottom = available.pop();
      
      if (top && bottom) {
        const pred = ncaa.predict(bottom.abbr, top.abbr, { round: 'Sweet 16' });
        const momentum = {
          away: getTournamentMomentum(bottom.abbr),
          home: getTournamentMomentum(top.abbr)
        };
        
        pairings.push({
          region,
          away: bottom,
          home: top,
          prediction: pred.error ? null : pred,
          momentum
        });
      }
    }
    
    matchups[region] = pairings;
  }
  
  return {
    matchups,
    bracketState,
    round: bracketState.currentRound,
    ready: bracketState.round2Complete,
    timestamp: new Date().toISOString()
  };
}

/**
 * Generate a complete tournament dashboard data package
 */
async function getDashboardData() {
  const [liveScores, bracketUpdate] = await Promise.all([
    fetchLiveScores(),
    updateBracketResults()
  ]);
  
  const bracketState = ncaa.getBracketState();
  const sweet16 = getSweet16Bracket();
  
  // Get momentum for all remaining teams
  const allSurvivors = [];
  for (const region of Object.values(bracketState.regions)) {
    for (const team of (region.teams || [])) {
      const momentum = getTournamentMomentum(team.abbr);
      allSurvivors.push({ ...team, momentum });
    }
  }
  
  // Sort by momentum
  allSurvivors.sort((a, b) => (b.momentum?.momentumScore || 0) - (a.momentum?.momentumScore || 0));
  
  return {
    liveScores: liveScores.games?.filter(g => g.isLive) || [],
    completedToday: liveScores.games?.filter(g => g.isComplete) || [],
    upcomingToday: liveScores.games?.filter(g => g.isScheduled) || [],
    bracketUpdates: bracketUpdate,
    bracketState,
    sweet16Bracket: sweet16,
    momentumRankings: allSurvivors,
    hottestTeams: allSurvivors.filter(t => t.momentum?.label === 'DOMINANT' || t.momentum?.label === 'HOT'),
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  fetchLiveScores,
  updateBracketResults,
  getTournamentMomentum,
  getSweet16Bracket,
  getDashboardData,
  resolveTeamAbbr,
  ESPN_TEAM_MAP
};
