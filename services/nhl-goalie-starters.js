/**
 * NHL Goalie Starter Service
 * 
 * Fetches confirmed/expected goalie starters from DailyFaceoff.
 * Goalie matchups swing NHL lines 5-15 cents — this is a MASSIVE edge.
 * 
 * Data source: DailyFaceoff __NEXT_DATA__ JSON (reliable, structured, free)
 * 
 * Key fields per game:
 *   - Goalie name, SV%, GAA, W-L-OTL, shutouts
 *   - Confirmation status (Confirmed / Expected / Likely / Unconfirmed)
 *   - Goalie rating and overall score
 *   - DraftKings moneylines embedded
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'nhl-goalie-cache.json');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const DAILYFACEOFF_URL = 'https://www.dailyfaceoff.com/starting-goalies/';

// Map DailyFaceoff team names → our model abbreviations
const TEAM_NAME_TO_ABBR = {
  'Anaheim Ducks': 'ANA',
  'Arizona Coyotes': 'ARI',
  'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY',
  'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL',
  'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET',
  'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK',
  'Minnesota Wild': 'MIN',
  'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH',
  'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI',
  'New York Rangers': 'NYR',
  'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT',
  'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL',
  'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'ARI',
  'Utah Mammoth': 'ARI',
  'Utah HC': 'ARI',
  'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
};

// Each team's expected #1 starter (used to determine if backup is in)
const TEAM_STARTERS = {
  'ANA': ['Lukas Dostal', 'John Gibson'],
  'ARI': ['Karel Vejmelka', 'Connor Ingram'],
  'BOS': ['Jeremy Swayman', 'Joonas Korpisalo'],
  'BUF': ['Ukko-Pekka Luukkonen', 'Devon Levi'],
  'CGY': ['Dustin Wolf', 'Dan Vladar'],
  'CAR': ['Frederik Andersen', 'Pyotr Kochetkov'],
  'CHI': ['Petr Mrazek', 'Arvid Soderblom', 'Spencer Knight'],
  'COL': ['Alexandar Georgiev', 'Mackenzie Blackwood', 'Scott Wedgewood'],
  'CBJ': ['Elvis Merzlikins', 'Daniil Tarasov', 'Jet Greaves'],
  'DAL': ['Jake Oettinger', 'Casey DeSmith'],
  'DET': ['Alex Lyon', 'Cam Talbot', 'Ville Husso'],
  'EDM': ['Stuart Skinner', 'Calvin Pickard'],
  'FLA': ['Sergei Bobrovsky', 'Spencer Knight'],
  'LAK': ['Darcy Kuemper', 'David Rittich'],
  'MIN': ['Filip Gustavsson', 'Marc-Andre Fleury'],
  'MTL': ['Samuel Montembeault', 'Cayden Primeau', 'Jakub Dobes'],
  'NSH': ['Juuse Saros', 'Kevin Lankinen'],
  'NJD': ['Jacob Markstrom', 'Jake Allen'],
  'NYI': ['Ilya Sorokin', 'Semyon Varlamov'],
  'NYR': ['Igor Shesterkin', 'Jonathan Quick'],
  'OTT': ['Linus Ullmark', 'Anton Forsberg'],
  'PHI': ['Ivan Fedotov', 'Samuel Ersson', 'Aleksei Kolosov'],
  'PIT': ['Alex Nedeljkovic', 'Tristan Jarry', 'Joel Blomqvist'],
  'SJS': ['Mackenzie Blackwood', 'Vitek Vanecek', 'Yaroslav Askarov'],
  'SEA': ['Joey Daccord', 'Philipp Grubauer'],
  'STL': ['Jordan Binnington', 'Joel Hofer'],
  'TBL': ['Andrei Vasilevskiy', 'Jonas Johansson'],
  'TOR': ['Anthony Stolarz', 'Joseph Woll', 'Dennis Hildeby'],
  'VAN': ['Thatcher Demko', 'Kevin Lankinen', 'Arturs Silovs'],
  'VGK': ['Adin Hill', 'Ilya Samsonov'],
  'WSH': ['Charlie Lindgren', 'Logan Thompson'],
  'WPG': ['Connor Hellebuyck', 'Eric Comrie'],
};

/**
 * Fetch goalie starters from DailyFaceoff
 */
async function fetchGoalieStarters(date = null) {
  try {
    // Check cache first
    const cached = loadCache();
    const targetDate = date || new Date().toISOString().slice(0, 10);
    
    if (cached && cached.date === targetDate && cached.timestamp && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`[nhl-goalies] Using cached data for ${targetDate} (${Math.round((Date.now() - cached.timestamp) / 60000)}min old)`);
      return cached.data;
    }

    const url = date ? `${DAILYFACEOFF_URL}${date}` : DAILYFACEOFF_URL;
    console.log(`[nhl-goalies] Fetching goalie starters from DailyFaceoff for ${targetDate}...`);
    
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    if (!resp.ok) {
      console.error(`[nhl-goalies] DailyFaceoff returned ${resp.status}`);
      return cached?.data || [];
    }

    const html = await resp.text();
    
    // Extract __NEXT_DATA__ JSON
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    if (!match) {
      console.error('[nhl-goalies] Could not find __NEXT_DATA__ in DailyFaceoff HTML');
      return cached?.data || [];
    }

    const nextData = JSON.parse(match[1]);
    const games = nextData?.props?.pageProps?.data || [];
    
    if (!games.length) {
      console.log('[nhl-goalies] No games found for today');
      return [];
    }

    // Parse into our format
    const parsed = games.map(g => parseGame(g)).filter(Boolean);
    
    // Save cache
    saveCache({ date: targetDate, timestamp: Date.now(), data: parsed });
    
    console.log(`[nhl-goalies] Fetched ${parsed.length} games with goalie starters`);
    return parsed;
    
  } catch (err) {
    console.error('[nhl-goalies] Error fetching goalie starters:', err.message);
    const cached = loadCache();
    return cached?.data || [];
  }
}

/**
 * Parse a DailyFaceoff game object into our format
 */
function parseGame(g) {
  try {
    const homeAbbr = TEAM_NAME_TO_ABBR[g.homeTeamName];
    const awayAbbr = TEAM_NAME_TO_ABBR[g.awayTeamName];
    
    if (!homeAbbr || !awayAbbr) {
      console.warn(`[nhl-goalies] Unknown team: ${g.homeTeamName} or ${g.awayTeamName}`);
      return null;
    }

    return {
      date: g.date,
      gameTime: g.dateGmt,
      homeTeam: homeAbbr,
      awayTeam: awayAbbr,
      homeTeamName: g.homeTeamName,
      awayTeamName: g.awayTeamName,
      homeGoalie: {
        name: g.homeGoalieName,
        savePct: parseFloat(g.homeGoalieSavePercentage) || null,
        gaa: parseFloat(g.homeGoalieGoalsAgainstAvg) || null,
        wins: g.homeGoalieWins || 0,
        losses: g.homeGoalieLosses || 0,
        otl: g.homeGoalieOvertimeLosses || 0,
        shutouts: g.homeGoalieShutouts || 0,
        rating: g.homeGoalieRating || null,
        overallScore: g.homeGoalieOverallScore || null,
        confirmed: getConfirmationStatus(g.homeNewsStrengthName),
        confirmationSource: g.homeNewsSourceName || null,
        confirmationDetails: g.homeNewsDetails || null,
        headshot: g.homeGoalieHeadshotUrl || null,
        isStarter: isTeamStarter(homeAbbr, g.homeGoalieName),
      },
      awayGoalie: {
        name: g.awayGoalieName,
        savePct: parseFloat(g.awayGoalieSavePercentage) || null,
        gaa: parseFloat(g.awayGoalieGoalsAgainstAvg) || null,
        wins: g.awayGoalieWins || 0,
        losses: g.awayGoalieLosses || 0,
        otl: g.awayGoalieOvertimeLosses || 0,
        shutouts: g.awayGoalieShutouts || 0,
        rating: g.awayGoalieRating || null,
        overallScore: g.awayGoalieOverallScore || null,
        confirmed: getConfirmationStatus(g.awayNewsStrengthName),
        confirmationSource: g.awayNewsSourceName || null,
        confirmationDetails: g.awayNewsDetails || null,
        headshot: g.awayGoalieHeadshotUrl || null,
        isStarter: isTeamStarter(awayAbbr, g.awayGoalieName),
      },
      bookLines: {
        homeML: g.homeTeamMoneylinePointSpread || null,
        awayML: g.awayTeamMoneylinePointSpread || null,
        spread: g.pointSpread || null,
      },
    };
  } catch (err) {
    console.error('[nhl-goalies] Error parsing game:', err.message);
    return null;
  }
}

/**
 * Determine if a goalie is the team's #1 starter
 */
function isTeamStarter(teamAbbr, goalieName) {
  const starters = TEAM_STARTERS[teamAbbr];
  if (!starters || !goalieName) return null;
  const idx = starters.findIndex(s => goalieName.toLowerCase().includes(s.split(' ').pop().toLowerCase()));
  return idx === 0; // true if it's the first-listed (primary starter)
}

/**
 * Map confirmation strength to a cleaner status
 */
function getConfirmationStatus(strengthName) {
  if (!strengthName) return 'expected'; // DailyFaceoff default prediction
  const s = strengthName.toLowerCase();
  if (s === 'confirmed' || s === 'official') return 'confirmed';
  if (s === 'likely') return 'likely';
  if (s === 'expected') return 'expected';
  if (s === 'unconfirmed') return 'unconfirmed';
  return s;
}

/**
 * Get goalie matchup for a specific game
 * Returns { homeGoalie, awayGoalie } with full stats, or null
 */
async function getGoalieMatchup(homeTeam, awayTeam) {
  const games = await fetchGoalieStarters();
  const game = games.find(g => g.homeTeam === homeTeam && g.awayTeam === awayTeam);
  if (!game) return null;
  return {
    homeGoalie: game.homeGoalie,
    awayGoalie: game.awayGoalie,
    gameTime: game.gameTime,
  };
}

/**
 * Calculate the goalie-based prediction adjustment
 * 
 * This is the KEY edge: when a backup goalie starts, the team gets weaker.
 * A starter-vs-backup SV% gap of 0.025 (e.g., .920 vs .895) ≈ ~0.75 goals/game.
 * 
 * Returns: { homeAdj, awayAdj, homeSvPct, awaySvPct, isBackup: {home, away}, confidence }
 */
function calculateGoalieImpact(matchup, teamData) {
  if (!matchup) return null;

  const leagueAvgSv = 0.905;
  
  // Calculate adjustment for each goalie based on their actual SV%
  // Scale: 0.001 SV% ≈ ~0.03 goals/game → 0.001 SV% * 30 = 0.03 goal impact  
  // We use a scale of 15 (same as the NHL model) for goals-to-power conversion
  const GOALIE_SCALE = 15;
  
  const homeSv = matchup.homeGoalie?.savePct || leagueAvgSv;
  const awaySv = matchup.awayGoalie?.savePct || leagueAvgSv;
  
  const homeAdj = (homeSv - leagueAvgSv) * GOALIE_SCALE;
  const awayAdj = (awaySv - leagueAvgSv) * GOALIE_SCALE;
  
  // Determine if it's a backup
  const homeIsBackup = matchup.homeGoalie?.isStarter === false;
  const awayIsBackup = matchup.awayGoalie?.isStarter === false;
  
  // Confidence: confirmed > likely > expected > unconfirmed
  const confMap = { confirmed: 1.0, likely: 0.9, expected: 0.75, unconfirmed: 0.5 };
  const homeConf = confMap[matchup.homeGoalie?.confirmed] || 0.5;
  const awayConf = confMap[matchup.awayGoalie?.confirmed] || 0.5;
  
  // When backup starts, the delta from the team's usual starter SV% matters most
  // This captures the "backup downgrade" that the market often doesn't price fully
  let homeBackupPenalty = 0;
  let awayBackupPenalty = 0;
  
  if (homeIsBackup && teamData?.home) {
    const starterSv = teamData.home.starterSv || leagueAvgSv;
    homeBackupPenalty = (homeSv - starterSv) * GOALIE_SCALE; // negative when backup is worse
  }
  if (awayIsBackup && teamData?.away) {
    const starterSv = teamData.away.starterSv || leagueAvgSv;
    awayBackupPenalty = (awaySv - starterSv) * GOALIE_SCALE;
  }

  return {
    homeAdj: +homeAdj.toFixed(3),
    awayAdj: +awayAdj.toFixed(3),
    homeSvPct: homeSv,
    awaySvPct: awaySv,
    homeGAA: matchup.homeGoalie?.gaa || null,
    awayGAA: matchup.awayGoalie?.gaa || null,
    homeGoalieName: matchup.homeGoalie?.name || 'Unknown',
    awayGoalieName: matchup.awayGoalie?.name || 'Unknown',
    isBackup: { home: homeIsBackup, away: awayIsBackup },
    backupPenalty: { home: +homeBackupPenalty.toFixed(3), away: +awayBackupPenalty.toFixed(3) },
    confirmed: { home: matchup.homeGoalie?.confirmed, away: matchup.awayGoalie?.confirmed },
    confidence: { home: homeConf, away: awayConf },
    // Net impact on the spread: positive = favors home
    netSpreadImpact: +(homeAdj - awayAdj).toFixed(3),
    // Implied line movement from goalie matchup
    impliedMLMove: +(((homeAdj - awayAdj) / 4.5) * 100).toFixed(1), // approximate ML cents
  };
}

/**
 * Get today's full goalie scan — all games with impact analysis
 */
async function scanTodayGoalies(nhlModel) {
  const games = await fetchGoalieStarters();
  if (!games.length) return { games: [], summary: 'No NHL games today' };
  
  const results = [];
  
  for (const game of games) {
    const matchup = { homeGoalie: game.homeGoalie, awayGoalie: game.awayGoalie };
    const teamData = {
      home: nhlModel?.TEAMS?.[game.homeTeam],
      away: nhlModel?.TEAMS?.[game.awayTeam],
    };
    
    const impact = calculateGoalieImpact(matchup, teamData);
    
    // Get model prediction with these goalies
    let prediction = null;
    if (nhlModel) {
      // Pass the actual goalie save percentages to predict
      prediction = nhlModel.predict(game.awayTeam, game.homeTeam, {
        homeGoalieSv: game.homeGoalie?.savePct,
        awayGoalieSv: game.awayGoalie?.savePct,
      });
    }
    
    results.push({
      ...game,
      goalieImpact: impact,
      prediction,
      edge: prediction ? {
        // Compare model with confirmed goalies vs default
        defaultPred: nhlModel ? nhlModel.predict(game.awayTeam, game.homeTeam) : null,
        goaliePred: prediction,
        probShift: prediction && nhlModel ? 
          (prediction.home.winProb - (nhlModel.predict(game.awayTeam, game.homeTeam)?.home?.winProb || 50)) : 0,
      } : null,
    });
  }
  
  // Summarize
  const backupGames = results.filter(r => r.goalieImpact?.isBackup?.home || r.goalieImpact?.isBackup?.away);
  const confirmedCount = results.filter(r => 
    r.homeGoalie?.confirmed === 'confirmed' || r.awayGoalie?.confirmed === 'confirmed'
  ).length;
  
  return {
    games: results,
    summary: {
      totalGames: results.length,
      confirmedGoalies: confirmedCount,
      backupStarters: backupGames.length,
      backupGames: backupGames.map(g => ({
        game: `${g.awayTeam} @ ${g.homeTeam}`,
        backup: g.goalieImpact?.isBackup?.home ? `${g.homeGoalie?.name} (HOME)` : `${g.awayGoalie?.name} (AWAY)`,
        svPctDrop: g.goalieImpact?.isBackup?.home ? g.goalieImpact?.backupPenalty?.home : g.goalieImpact?.backupPenalty?.away,
      })),
      biggestGoalieMismatch: results.reduce((max, r) => {
        const mismatch = Math.abs(r.goalieImpact?.netSpreadImpact || 0);
        return mismatch > (max?.mismatch || 0) ? { 
          game: `${r.awayTeam} @ ${r.homeTeam}`, 
          mismatch,
          detail: `${r.homeGoalie?.name} (${r.homeGoalie?.savePct}) vs ${r.awayGoalie?.name} (${r.awayGoalie?.savePct})`,
        } : max;
      }, null),
    },
    fetchedAt: new Date().toISOString(),
  };
}

// Cache helpers
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[nhl-goalies] Failed to save cache:', e.message);
  }
}

module.exports = {
  fetchGoalieStarters,
  getGoalieMatchup,
  calculateGoalieImpact,
  scanTodayGoalies,
  TEAM_NAME_TO_ABBR,
  TEAM_STARTERS,
};
