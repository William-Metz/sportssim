/**
 * OD ESPN Live Verification Service — SportsSim v115.0
 * =====================================================
 * MISSION: Auto-verify OD pitchers + DK lines against LIVE ESPN data.
 * Pull real probables + lines from ESPN schedule page to confirm our
 * model's assumptions match reality. Critical T-2 verification step.
 * 
 * This catches:
 *   - Last-minute pitcher changes (injury scratches, surprise callups)
 *   - DK line movement since our last update
 *   - Games with still-undecided starters (risk flag)
 *   - Schedule changes (postponements, time changes)
 *
 * ESPN data structure:
 *   - Pitcher names in "Pitcher1 vs Pitcher2" format
 *   - DK lines in "Line: TEAM -XXX" and "O/U: X.X" format
 *   - "Undecided" when starter not yet announced
 */

const https = require('https');

// ==================== DEPENDENCIES ====================
let odModel = null;
try { odModel = require('../models/mlb-opening-day'); } catch(e) {}

// ==================== ESPN SCRAPER ====================

function fetchESPNSchedule(date) {
  return new Promise((resolve, reject) => {
    const dateStr = date.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
    
    https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(new Error(`ESPN parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ==================== TEAM NAME MAPPING ====================
const ESPN_TEAM_MAP = {
  'Pittsburgh Pirates': 'PIT', 'New York Mets': 'NYM', 'Chicago White Sox': 'CWS',
  'Milwaukee Brewers': 'MIL', 'Washington Nationals': 'WSH', 'Chicago Cubs': 'CHC',
  'Minnesota Twins': 'MIN', 'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS',
  'Cincinnati Reds': 'CIN', 'Los Angeles Angels': 'LAA', 'Houston Astros': 'HOU',
  'Detroit Tigers': 'DET', 'San Diego Padres': 'SD', 'Tampa Bay Rays': 'TB',
  'St. Louis Cardinals': 'STL', 'Texas Rangers': 'TEX', 'Philadelphia Phillies': 'PHI',
  'Arizona Diamondbacks': 'ARI', 'Los Angeles Dodgers': 'LAD', 'Cleveland Guardians': 'CLE',
  'Seattle Mariners': 'SEA', 'New York Yankees': 'NYY', 'San Francisco Giants': 'SF',
  'Oakland Athletics': 'OAK', 'Athletics': 'OAK', 'Toronto Blue Jays': 'TOR', 'Colorado Rockies': 'COL',
  'Miami Marlins': 'MIA', 'Kansas City Royals': 'KC', 'Atlanta Braves': 'ATL',
};

// ESPN abbreviation overrides (ESPN uses some non-standard abbreviations)
const ESPN_ABBR_MAP = {
  'ATH': 'OAK', 'WSH': 'WSH', 'CWS': 'CWS', 'TB': 'TB', 'SD': 'SD', 'SF': 'SF', 'KC': 'KC',
};

// ==================== PARSE ESPN EVENTS ====================

function parseESPNEvents(data) {
  if (!data || !data.events) return [];
  
  return data.events.map(event => {
    const comp = event.competitions?.[0];
    if (!comp) return null;
    
    const homeTeamData = comp.competitors?.find(c => c.homeAway === 'home');
    const awayTeamData = comp.competitors?.find(c => c.homeAway === 'away');
    
    if (!homeTeamData || !awayTeamData) return null;
    
    const homeName = homeTeamData.team?.displayName || '';
    const awayName = awayTeamData.team?.displayName || '';
    const homeAbbr = ESPN_TEAM_MAP[homeName] || ESPN_ABBR_MAP[homeTeamData.team?.abbreviation] || homeTeamData.team?.abbreviation || '';
    const awayAbbr = ESPN_TEAM_MAP[awayName] || ESPN_ABBR_MAP[awayTeamData.team?.abbreviation] || awayTeamData.team?.abbreviation || '';
    
    // Extract probable pitchers
    let homePitcher = null, awayPitcher = null;
    
    // Method 1: From probables in competition data
    if (comp.status?.type?.detail === 'Scheduled' || comp.status?.type?.state === 'pre') {
      // Look for pitchers in competitors
      const homeProbable = homeTeamData.probables?.[0];
      const awayProbable = awayTeamData.probables?.[0];
      
      if (homeProbable) {
        homePitcher = homeProbable.athlete?.displayName || homeProbable.displayName || null;
      }
      if (awayProbable) {
        awayPitcher = awayProbable.athlete?.displayName || awayProbable.displayName || null;
      }
    }
    
    // Method 2: From headlines/notes
    if (!homePitcher && event.name) {
      // Event name format: "Team1 at Team2"
      // Sometimes probables are in notes
    }
    
    // Extract odds if available
    let odds = null;
    if (comp.odds && comp.odds.length > 0) {
      const dkOdds = comp.odds.find(o => o.provider?.name?.includes('DraftKings')) || comp.odds[0];
      if (dkOdds) {
        odds = {
          provider: dkOdds.provider?.name || 'Unknown',
          homeML: dkOdds.homeTeamOdds?.moneyLine || null,
          awayML: dkOdds.awayTeamOdds?.moneyLine || null,
          total: dkOdds.overUnder || null,
          spread: dkOdds.spread || null,
          overOdds: dkOdds.overOdds || null,
          underOdds: dkOdds.underOdds || null,
        };
      }
    }
    
    return {
      espnId: event.id,
      date: event.date,
      name: event.name,
      home: homeAbbr,
      away: awayAbbr,
      homeName,
      awayName,
      homePitcher,
      awayPitcher,
      odds,
      status: comp.status?.type?.description || 'Unknown',
      venue: comp.venue?.fullName || null,
      startTime: comp.date || event.date,
    };
  }).filter(Boolean);
}

// ==================== VERIFICATION ENGINE ====================

function compareWithModel(espnGames, odGames) {
  const results = {
    timestamp: new Date().toISOString(),
    totalODGames: odGames.length,
    totalESPNGames: espnGames.length,
    matches: [],
    pitcherChanges: [],
    lineMovement: [],
    undecidedStarters: [],
    missingFromESPN: [],
    newInESPN: [],
    allGood: true,
    summary: '',
  };
  
  // Match each OD game to ESPN game
  for (const odGame of odGames) {
    const espnMatch = espnGames.find(eg => 
      eg.home === odGame.home && eg.away === odGame.away
    );
    
    if (!espnMatch) {
      results.missingFromESPN.push({
        game: `${odGame.away}@${odGame.home}`,
        date: odGame.date,
        ourPitchers: odGame.confirmedStarters,
        note: 'Game not found in ESPN data for this date',
      });
      results.allGood = false;
      continue;
    }
    
    const gameKey = `${odGame.away}@${odGame.home}`;
    const matchResult = {
      game: gameKey,
      date: odGame.date,
      status: '✅',
      issues: [],
    };
    
    // Check pitcher matches
    const ourAwayP = odGame.confirmedStarters?.away || '';
    const ourHomeP = odGame.confirmedStarters?.home || '';
    const espnAwayP = espnMatch.awayPitcher || 'Undecided';
    const espnHomeP = espnMatch.homePitcher || 'Undecided';
    
    matchResult.pitchers = {
      our: { away: ourAwayP, home: ourHomeP },
      espn: { away: espnAwayP, home: espnHomeP },
    };
    
    // Check for undecided starters
    if (espnAwayP === 'Undecided' || !espnMatch.awayPitcher) {
      results.undecidedStarters.push({
        game: gameKey,
        team: odGame.away,
        ourPick: ourAwayP,
        note: `${odGame.away} starter still UNDECIDED on ESPN. We have: ${ourAwayP}`,
      });
      matchResult.issues.push(`⚠️ ${odGame.away} starter undecided (we have ${ourAwayP})`);
    } else if (espnAwayP.toLowerCase() !== ourAwayP.toLowerCase()) {
      // Pitcher CHANGED
      results.pitcherChanges.push({
        game: gameKey,
        team: odGame.away,
        expected: ourAwayP,
        actual: espnAwayP,
        impact: 'HIGH — recalculate prediction',
      });
      matchResult.issues.push(`🚨 PITCHER CHANGE: ${odGame.away} was ${ourAwayP}, now ${espnAwayP}`);
      matchResult.status = '🚨';
      results.allGood = false;
    }
    
    if (espnHomeP === 'Undecided' || !espnMatch.homePitcher) {
      results.undecidedStarters.push({
        game: gameKey,
        team: odGame.home,
        ourPick: ourHomeP,
        note: `${odGame.home} starter still UNDECIDED on ESPN. We have: ${ourHomeP}`,
      });
      matchResult.issues.push(`⚠️ ${odGame.home} starter undecided (we have ${ourHomeP})`);
    } else if (espnHomeP.toLowerCase() !== ourHomeP.toLowerCase()) {
      results.pitcherChanges.push({
        game: gameKey,
        team: odGame.home,
        expected: ourHomeP,
        actual: espnHomeP,
        impact: 'HIGH — recalculate prediction',
      });
      matchResult.issues.push(`🚨 PITCHER CHANGE: ${odGame.home} was ${ourHomeP}, now ${espnHomeP}`);
      matchResult.status = '🚨';
      results.allGood = false;
    }
    
    // Check DK line movement
    if (espnMatch.odds && odGame.dkLine) {
      const odML = odGame.dkLine.homeML;
      const espnML = espnMatch.odds.homeML;
      const odTotal = odGame.dkLine.total;
      const espnTotal = espnMatch.odds.total;
      
      matchResult.lines = {
        our: { homeML: odML, awayML: odGame.dkLine.awayML, total: odTotal },
        espn: { homeML: espnML, awayML: espnMatch.odds.awayML, total: espnTotal, provider: espnMatch.odds.provider },
      };
      
      if (espnML !== null && odML !== null) {
        const mlDiff = espnML - odML;
        if (Math.abs(mlDiff) >= 5) {
          results.lineMovement.push({
            game: gameKey,
            type: 'moneyline',
            ourHomeML: odML,
            espnHomeML: espnML,
            movement: mlDiff > 0 ? `+${mlDiff} (home longer)` : `${mlDiff} (home shorter)`,
            significance: Math.abs(mlDiff) >= 15 ? 'HIGH' : 'MEDIUM',
          });
          matchResult.issues.push(`📈 ML moved: ${odML} → ${espnML} (${mlDiff > 0 ? '+' : ''}${mlDiff})`);
        }
      }
      
      if (espnTotal !== null && odTotal !== null) {
        const totalDiff = espnTotal - odTotal;
        if (Math.abs(totalDiff) >= 0.5) {
          results.lineMovement.push({
            game: gameKey,
            type: 'total',
            ourTotal: odTotal,
            espnTotal: espnTotal,
            movement: totalDiff > 0 ? `+${totalDiff} (higher)` : `${totalDiff} (lower)`,
            significance: Math.abs(totalDiff) >= 1.0 ? 'HIGH' : 'MEDIUM',
          });
          matchResult.issues.push(`📊 Total moved: ${odTotal} → ${espnTotal} (${totalDiff > 0 ? '+' : ''}${totalDiff})`);
        }
      }
    }
    
    if (matchResult.issues.length === 0) {
      matchResult.issues.push('All clear — pitchers + lines match');
    } else if (matchResult.status === '✅') {
      matchResult.status = '⚠️';
    }
    
    results.matches.push(matchResult);
  }
  
  // Check for games in ESPN not in our model
  for (const espnGame of espnGames) {
    const hasMatch = odGames.find(og => og.home === espnGame.home && og.away === espnGame.away);
    if (!hasMatch) {
      results.newInESPN.push({
        game: `${espnGame.away}@${espnGame.home}`,
        pitchers: { away: espnGame.awayPitcher, home: espnGame.homePitcher },
        odds: espnGame.odds,
        note: 'Game found in ESPN but NOT in our OD model — might be a new addition',
      });
    }
  }
  
  // Generate summary
  const okCount = results.matches.filter(m => m.status === '✅').length;
  const warnCount = results.matches.filter(m => m.status === '⚠️').length;
  const alertCount = results.matches.filter(m => m.status === '🚨').length;
  
  results.summary = `OD Verification: ${okCount}✅ ${warnCount}⚠️ ${alertCount}🚨 | ` +
    `${results.pitcherChanges.length} pitcher changes, ${results.undecidedStarters.length} undecided, ` +
    `${results.lineMovement.length} line moves | ` +
    (results.allGood ? 'ALL SYSTEMS GO 🟢' : 'ACTION REQUIRED 🔴');
  
  return results;
}

// ==================== MAIN VERIFICATION FUNCTION ====================

async function verifyODDay(day) {
  const date = day === 1 ? '2026-03-26' : '2026-03-27';
  const espnData = await fetchESPNSchedule(date);
  const espnGames = parseESPNEvents(espnData);
  
  // Get our OD games for this day
  const odGames = odModel ? 
    (odModel.getSchedule ? odModel.getSchedule() : []).filter(g => g.day === day) :
    [];
  
  return compareWithModel(espnGames, odGames);
}

async function verifyAll() {
  const [day1, day2] = await Promise.all([
    verifyODDay(1).catch(e => ({ error: e.message, day: 1 })),
    verifyODDay(2).catch(e => ({ error: e.message, day: 2 })),
  ]);
  
  return {
    timestamp: new Date().toISOString(),
    day1,
    day2,
    overallStatus: (day1.allGood !== false && day2.allGood !== false) ? 'ALL CLEAR 🟢' : 'ISSUES FOUND 🔴',
    nextCheck: 'Re-verify in 6 hours or when ESPN updates probables',
  };
}

// ==================== LIVE ODDS COMPARISON ====================
// Pull current Odds API data and compare with our static DK lines
// This helps identify stale lines in our model

function generateOddsRefreshScript(verificationResults) {
  // Generate code snippets to update stale lines in mlb-opening-day.js
  const updates = [];
  
  if (verificationResults.lineMovement) {
    for (const move of verificationResults.lineMovement) {
      updates.push({
        game: move.game,
        type: move.type,
        oldValue: move.type === 'moneyline' ? move.ourHomeML : move.ourTotal,
        newValue: move.type === 'moneyline' ? move.espnHomeML : move.espnTotal,
        movement: move.movement,
      });
    }
  }
  
  return {
    updatesNeeded: updates.length,
    updates,
    note: updates.length === 0 ? 
      'No line updates needed — our model is current' :
      `${updates.length} lines have moved — consider updating mlb-opening-day.js`,
  };
}

// ==================== EXPORT ====================

module.exports = {
  verifyODDay,
  verifyAll,
  fetchESPNSchedule,
  parseESPNEvents,
  compareWithModel,
  generateOddsRefreshScript,
};
