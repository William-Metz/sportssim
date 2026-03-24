/**
 * MLB Team Totals Prop Scanner — SportsSim v115.0
 * =================================================
 * 
 * WHY THIS IS +EV:
 * Books set team totals by splitting the game total based on ML pricing.
 * Example: If total is 8.5 and home is -150 (60%), book sets home TT ~5.0, away TT ~3.5.
 * BUT this is WRONG when pitching matchup creates asymmetric run suppression.
 * 
 * Our model projects runs PER TEAM directly using:
 * - Pitcher quality (ERA, K/9, Statcast xERA)
 * - Platoon splits (L/R matchup adjustments)
 * - Catcher framing (+/- runs saved)
 * - Park factors (per-team, not just game-level)
 * - Weather (wind direction affects hitters asymmetrically)
 * - Opening Day premium (aces go deeper, bullpen uncertainty)
 * - Bullpen quality (projected 2026 ERA shifts)
 * 
 * When our per-team projection diverges from the book's ML-implied split,
 * the team total is mispriced even if the game total looks fair.
 * 
 * Example edge:
 * MIN@BAL: Game total 8.5, BAL -150 (60%)
 * Book implies: BAL TT ~5.1, MIN TT ~3.4
 * Our model: BAL TT 4.2, MIN TT 3.1 (elite pitching both sides)
 * → BAL UNDER 4.5 has edge (model says 4.2 vs implied 5.1)
 * → Game total UNDER also has edge, but team total captures it BETTER
 * 
 * This is a SOFTER market than game totals. Books put less effort into it.
 */

const negBinomial = require('./neg-binomial');

// ==================== ODDS API TEAM TOTALS FETCHER ====================

/**
 * Fetch team_totals from The Odds API for MLB
 * Returns structured data per game with team-specific O/U lines and odds
 */
async function fetchLiveTeamTotals(apiKey, opts = {}) {
  if (!apiKey) return { games: [], error: 'No API key' };
  
  const sport = opts.sport || 'baseball_mlb';
  const regions = opts.regions || 'us';
  const bookmakers = opts.bookmakers || 'draftkings,fanduel,betmgm,pointsbet,williamhill_us';
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=${regions}&markets=team_totals&oddsFormat=american&bookmakers=${bookmakers}`;
    const resp = await fetch(url, { timeout: 15000 });
    
    if (!resp.ok) {
      return { games: [], error: `API ${resp.status}: ${resp.statusText}` };
    }
    
    const data = await resp.json();
    const games = [];
    
    for (const event of data) {
      const game = {
        id: event.id,
        away: event.away_team,
        home: event.home_team,
        commence: event.commence_time,
        books: {},
        bestAway: null,
        bestHome: null,
      };
      
      for (const book of (event.bookmakers || [])) {
        const bookKey = book.key;
        const teamTotalMarket = book.markets?.find(m => m.key === 'team_totals');
        if (!teamTotalMarket) continue;
        
        const outcomes = teamTotalMarket.outcomes || [];
        const bookData = { away: {}, home: {} };
        
        for (const outcome of outcomes) {
          const teamSide = outcome.description === event.away_team ? 'away' : 
                           outcome.description === event.home_team ? 'home' : null;
          if (!teamSide) continue;
          
          const point = outcome.point;
          const price = outcome.price;
          const name = outcome.name; // Over or Under
          
          if (!bookData[teamSide][point]) {
            bookData[teamSide][point] = {};
          }
          
          if (name === 'Over') {
            bookData[teamSide][point].over = price;
          } else if (name === 'Under') {
            bookData[teamSide][point].under = price;
          }
        }
        
        game.books[bookKey] = bookData;
      }
      
      // Find best lines across books
      game.bestAway = findBestTeamTotalLines(game.books, 'away');
      game.bestHome = findBestTeamTotalLines(game.books, 'home');
      
      games.push(game);
    }
    
    return { games, count: games.length, fetched: new Date().toISOString() };
  } catch (err) {
    return { games: [], error: err.message };
  }
}

/**
 * Find best available lines across all books for a team side
 */
function findBestTeamTotalLines(books, side) {
  const allLines = {};
  
  for (const [bookKey, bookData] of Object.entries(books)) {
    const teamData = bookData[side] || {};
    for (const [point, odds] of Object.entries(teamData)) {
      if (!allLines[point]) {
        allLines[point] = { overBest: -Infinity, overBook: null, underBest: -Infinity, underBook: null };
      }
      if (odds.over != null && odds.over > allLines[point].overBest) {
        allLines[point].overBest = odds.over;
        allLines[point].overBook = bookKey;
      }
      if (odds.under != null && odds.under > allLines[point].underBest) {
        allLines[point].underBest = odds.under;
        allLines[point].underBook = bookKey;
      }
    }
  }
  
  return allLines;
}

// ==================== TEAM NAME MATCHING ====================

const TEAM_NAME_MAP = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM',
  'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH',
};

function teamNameToAbbr(name) {
  return TEAM_NAME_MAP[name] || name;
}

// ==================== TEAM TOTALS VALUE SCANNER ====================

/**
 * Scan Opening Day games for team total value
 * Compares our NB model per-team projections vs book team total lines
 */
function scanODTeamTotals(mlb, liveTeamTotals = null) {
  const odModel = require('../models/mlb-opening-day');
  const games = odModel.OPENING_DAY_GAMES;
  
  const results = [];
  
  for (const game of games) {
    try {
      // Get prediction with full signal stack
      const pred = mlb.predict(game.away, game.home, { 
        awayStarter: game.confirmedStarters?.away,
        homeStarter: game.confirmedStarters?.home,
      });
      
      if (!pred || !pred.awayExpRuns || !pred.homeExpRuns) continue;
      
      const awayExp = pred.awayExpRuns;
      const homeExp = pred.homeExpRuns;
      const gameTotal = pred.totalRuns;
      
      // Get NB team total probabilities
      const gameR = negBinomial.getGameR(game.away, game.home);
      
      // Calculate NB probabilities for each possible team total line
      const ttLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
      
      const awayTotals = {};
      const homeTotals = {};
      
      for (const line of ttLines) {
        // Away team
        let awayOver = 0, awayUnder = 0;
        for (let k = 0; k <= 20; k++) {
          const p = negBinomial.negBinPMF(k, awayExp, gameR);
          if (k > line) awayOver += p;
          else if (k < line) awayUnder += p;
        }
        awayTotals[line] = {
          over: +awayOver.toFixed(4),
          under: +awayUnder.toFixed(4),
          overML: negBinomial.probToML(awayOver),
          underML: negBinomial.probToML(awayUnder),
        };
        
        // Home team
        let homeOver = 0, homeUnder = 0;
        for (let k = 0; k <= 20; k++) {
          const p = negBinomial.negBinPMF(k, homeExp, gameR);
          if (k > line) homeOver += p;
          else if (k < line) homeUnder += p;
        }
        homeTotals[line] = {
          over: +homeOver.toFixed(4),
          under: +homeUnder.toFixed(4),
          overML: negBinomial.probToML(homeOver),
          underML: negBinomial.probToML(homeUnder),
        };
      }
      
      // Book-implied team totals from game total + ML split
      const dkLine = game.dkLine || {};
      const bookTotal = dkLine.total || gameTotal;
      const homeWinProb = pred.homeWinProb;
      
      // Books split: team total ≈ game total × (team win prob × tilt factor)
      // More precisely: home TT = total × homeShare, away TT = total × awayShare
      // homeShare ≈ 0.5 + (homeML implied edge × 0.15)
      const homeShare = 0.5 + (homeWinProb - 0.5) * 0.3;
      const awayShare = 1 - homeShare;
      const bookImpliedHomeTT = bookTotal * homeShare;
      const bookImpliedAwayTT = bookTotal * awayShare;
      
      // Value detection: compare our projections vs book implied
      const awayDiff = awayExp - bookImpliedAwayTT;
      const homeDiff = homeExp - bookImpliedHomeTT;
      
      // Find value plays
      const plays = [];
      
      // Check each TT line for value — focus on realistic book lines (3.5-5.5)
      // Books don't post O/U 2.5 or O/U 6.5 team totals — those are too obvious
      for (const line of [3.5, 4.5, 5.5]) {
        // Away OVER
        if (awayTotals[line] && awayTotals[line].over > 0.52) {
          const edge = awayTotals[line].over - 0.524; // vs -110 juice
          if (edge > 0.03) {
            plays.push({
              team: game.away,
              side: 'away',
              pick: `${game.away} OVER ${line}`,
              line,
              direction: 'OVER',
              modelProb: +(awayTotals[line].over * 100).toFixed(1),
              modelML: awayTotals[line].overML,
              teamExpRuns: awayExp,
              edge: +(edge * 100).toFixed(1),
              confidence: edge > 0.10 ? 'HIGH' : edge > 0.06 ? 'MEDIUM' : 'LOW',
            });
          }
        }
        // Away UNDER
        if (awayTotals[line] && awayTotals[line].under > 0.52) {
          const edge = awayTotals[line].under - 0.524;
          if (edge > 0.03) {
            plays.push({
              team: game.away,
              side: 'away',
              pick: `${game.away} UNDER ${line}`,
              line,
              direction: 'UNDER',
              modelProb: +(awayTotals[line].under * 100).toFixed(1),
              modelML: awayTotals[line].underML,
              teamExpRuns: awayExp,
              edge: +(edge * 100).toFixed(1),
              confidence: edge > 0.10 ? 'HIGH' : edge > 0.06 ? 'MEDIUM' : 'LOW',
            });
          }
        }
        // Home OVER
        if (homeTotals[line] && homeTotals[line].over > 0.52) {
          const edge = homeTotals[line].over - 0.524;
          if (edge > 0.03) {
            plays.push({
              team: game.home,
              side: 'home',
              pick: `${game.home} OVER ${line}`,
              line,
              direction: 'OVER',
              modelProb: +(homeTotals[line].over * 100).toFixed(1),
              modelML: homeTotals[line].overML,
              teamExpRuns: homeExp,
              edge: +(edge * 100).toFixed(1),
              confidence: edge > 0.10 ? 'HIGH' : edge > 0.06 ? 'MEDIUM' : 'LOW',
            });
          }
        }
        // Home UNDER
        if (homeTotals[line] && homeTotals[line].under > 0.52) {
          const edge = homeTotals[line].under - 0.524;
          if (edge > 0.03) {
            plays.push({
              team: game.home,
              side: 'home',
              pick: `${game.home} UNDER ${line}`,
              line,
              direction: 'UNDER',
              modelProb: +(homeTotals[line].under * 100).toFixed(1),
              modelML: homeTotals[line].underML,
              teamExpRuns: homeExp,
              edge: +(edge * 100).toFixed(1),
              confidence: edge > 0.10 ? 'HIGH' : edge > 0.06 ? 'MEDIUM' : 'LOW',
            });
          }
        }
      }
      
      // Merge with live odds if available
      if (liveTeamTotals) {
        const liveGame = liveTeamTotals.find(g => {
          const awayAbbr = teamNameToAbbr(g.away);
          const homeAbbr = teamNameToAbbr(g.home);
          return awayAbbr === game.away && homeAbbr === game.home;
        });
        
        if (liveGame) {
          for (const play of plays) {
            const side = play.side;
            const bestLines = side === 'away' ? liveGame.bestAway : liveGame.bestHome;
            if (bestLines && bestLines[play.line]) {
              const bookLine = bestLines[play.line];
              if (play.direction === 'OVER' && bookLine.overBest > -Infinity) {
                play.bookOdds = bookLine.overBest;
                play.bookProb = negBinomial.mlToProb(bookLine.overBest);
                play.bookEdge = +((play.modelProb / 100 - play.bookProb) * 100).toFixed(1);
                play.bestBook = bookLine.overBook;
              } else if (play.direction === 'UNDER' && bookLine.underBest > -Infinity) {
                play.bookOdds = bookLine.underBest;
                play.bookProb = negBinomial.mlToProb(bookLine.underBest);
                play.bookEdge = +((play.modelProb / 100 - play.bookProb) * 100).toFixed(1);
                play.bestBook = bookLine.underBook;
              }
            }
          }
        }
      }
      
      // Sort plays by edge descending
      plays.sort((a, b) => b.edge - a.edge);
      
      results.push({
        game: `${game.away}@${game.home}`,
        date: game.date,
        time: game.time,
        pitchers: `${game.confirmedStarters?.away || 'TBD'} vs ${game.confirmedStarters?.home || 'TBD'}`,
        awayExpRuns: awayExp,
        homeExpRuns: homeExp,
        gameTotal: +(gameTotal).toFixed(1),
        bookTotal: bookTotal,
        bookImplied: {
          away: +bookImpliedAwayTT.toFixed(2),
          home: +bookImpliedHomeTT.toFixed(2),
        },
        modelVsImplied: {
          awayDiff: +awayDiff.toFixed(2),
          homeDiff: +homeDiff.toFixed(2),
        },
        awayTotals,
        homeTotals,
        plays,
        playCount: plays.length,
        topPlay: plays[0] || null,
      });
    } catch (err) {
      results.push({
        game: `${game.away}@${game.home}`,
        error: err.message,
      });
    }
  }
  
  // Aggregate all plays
  const allPlays = results.flatMap(r => r.plays || []);
  allPlays.sort((a, b) => b.edge - a.edge);
  
  const highConf = allPlays.filter(p => p.confidence === 'HIGH');
  const underPlays = allPlays.filter(p => p.direction === 'UNDER');
  const overPlays = allPlays.filter(p => p.direction === 'OVER');
  
  return {
    title: '🎯 MLB Team Totals Value Scanner',
    generated: new Date().toISOString(),
    totalGames: results.length,
    totalPlays: allPlays.length,
    highConfidence: highConf.length,
    underPlays: underPlays.length,
    overPlays: overPlays.length,
    avgEdge: allPlays.length > 0 ? +(allPlays.reduce((s, p) => s + p.edge, 0) / allPlays.length).toFixed(1) : 0,
    topPicks: allPlays.slice(0, 15),
    games: results,
    strategy: {
      title: 'Team Totals Edge Strategy',
      notes: [
        'Team totals are SOFTER than game totals — books spend less effort pricing them',
        'Our model projects runs per team directly using pitcher matchup + park + weather',
        'Books derive team totals from game total split by ML — this misses pitching asymmetry',
        'Best edge: when one pitcher is elite and the other is average, team totals capture the run suppression on one side',
        'Opening Day bonus: ace starters go 5.8 IP (deeper than usual) = more predictable team scoring = more edge',
        'UNDER team totals are generally higher edge on OD (rusty bats + ace starters + cold weather)',
      ],
    },
  };
}

/**
 * Scan a specific matchup for team total value
 */
function scanMatchup(mlb, away, home, opts = {}) {
  const pred = mlb.predict(away, home, opts);
  if (!pred) return { error: 'Prediction failed' };
  
  const awayExp = pred.awayExpRuns;
  const homeExp = pred.homeExpRuns;
  const gameR = negBinomial.getGameR(away, home);
  
  const ttLines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
  
  const awayTotals = {};
  const homeTotals = {};
  
  for (const line of ttLines) {
    let awayOver = 0, awayUnder = 0;
    for (let k = 0; k <= 20; k++) {
      const p = negBinomial.negBinPMF(k, awayExp, gameR);
      if (k > line) awayOver += p;
      else if (k < line) awayUnder += p;
    }
    awayTotals[line] = {
      over: +awayOver.toFixed(4),
      under: +awayUnder.toFixed(4),
      overML: negBinomial.probToML(awayOver),
      underML: negBinomial.probToML(awayUnder),
    };
    
    let homeOver = 0, homeUnder = 0;
    for (let k = 0; k <= 20; k++) {
      const p = negBinomial.negBinPMF(k, homeExp, gameR);
      if (k > line) homeOver += p;
      else if (k < line) homeUnder += p;
    }
    homeTotals[line] = {
      over: +homeOver.toFixed(4),
      under: +homeUnder.toFixed(4),
      overML: negBinomial.probToML(homeOver),
      underML: negBinomial.probToML(homeUnder),
    };
  }
  
  return {
    game: `${away}@${home}`,
    awayExpRuns: awayExp,
    homeExpRuns: homeExp,
    gameTotal: +(awayExp + homeExp).toFixed(1),
    awayTeam: {
      abbr: away,
      projectedRuns: awayExp,
      lines: awayTotals,
    },
    homeTeam: {
      abbr: home,
      projectedRuns: homeExp,
      lines: homeTotals,
    },
  };
}

module.exports = {
  fetchLiveTeamTotals,
  scanODTeamTotals,
  scanMatchup,
  teamNameToAbbr,
  TEAM_NAME_MAP,
};
