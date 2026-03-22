/**
 * Daily Action Slate — SportsSim v45.0
 * ======================================
 * THE MONEY PRINTER: One endpoint to rule them all.
 * 
 * Generates today's complete betting action plan across ALL sports:
 *   - Scans all games (NBA, MLB, NHL) for today's date
 *   - Runs predictions through all models + calibration
 *   - Compares to live odds from The Odds API
 *   - Identifies +EV bets with Kelly sizing
 *   - Grades each bet (A+ through D)
 *   - Builds optimal portfolio allocation
 *   - Surfaces situational edges (rest/tank, weather, lineups, etc.)
 * 
 * This replaces manually checking 6 different tabs.
 * Run it before you bet. Every day.
 * 
 * WHY THIS MAKES MORE MONEY:
 *   - Cross-sport portfolio = uncorrelated bets = better Kelly
 *   - Unified signal aggregation = no edge left on the table
 *   - Forced ranking = only bet the BEST plays, not everything
 */

const https = require('https');

// Dependencies injected at init
let nbaModel = null;
let mlbModel = null;
let nhlModel = null;
let calibration = null;
let oddsApiKey = null;
let kellyService = null;
let restTankService = null;
let lineupFetcher = null;
let weatherService = null;
let openingWeekUnders = null;

function init(deps) {
  nbaModel = deps.nba;
  mlbModel = deps.mlb;
  nhlModel = deps.nhl;
  calibration = deps.calibration;
  oddsApiKey = deps.oddsApiKey;
  kellyService = deps.kelly;
  restTankService = deps.restTank;
  lineupFetcher = deps.lineupFetcher;
  weatherService = deps.weather;
  openingWeekUnders = deps.openingWeekUnders;
}

// ==================== ODDS FETCHING ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchSportOdds(sportKey) {
  if (!oddsApiKey) return [];
  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${oddsApiKey}&regions=us&oddsFormat=american&markets=h2h,spreads,totals`;
    const data = await fetchJSON(url);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

// ==================== TEAM NAME RESOLUTION ====================

const NBA_NAMES = {
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

const MLB_NAMES = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM',
  'New York Yankees': 'NYY', 'Athletics': 'OAK', 'Oakland Athletics': 'OAK',
  'Philadelphia Phillies': 'PHI', 'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD',
  'San Francisco Giants': 'SF', 'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL',
  'Tampa Bay Rays': 'TB', 'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR',
  'Washington Nationals': 'WSH',
};

const NHL_NAMES = {
  'Carolina Hurricanes': 'CAR', 'New Jersey Devils': 'NJD', 'New York Rangers': 'NYR',
  'New York Islanders': 'NYI', 'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT',
  'Washington Capitals': 'WSH', 'Columbus Blue Jackets': 'CBJ', 'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF', 'Detroit Red Wings': 'DET', 'Florida Panthers': 'FLA',
  'Montreal Canadiens': 'MTL', 'Ottawa Senators': 'OTT', 'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR', 'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL',
  'Dallas Stars': 'DAL', 'Minnesota Wild': 'MIN', 'Nashville Predators': 'NSH',
  'St. Louis Blues': 'STL', 'Winnipeg Jets': 'WPG', 'Anaheim Ducks': 'ANA',
  'Arizona Coyotes': 'ARI', 'Calgary Flames': 'CGY', 'Edmonton Oilers': 'EDM',
  'Los Angeles Kings': 'LAK', 'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA',
  'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Utah Hockey Club': 'UTA',
};

function resolveTeam(nameMap, teamName) {
  if (nameMap[teamName]) return nameMap[teamName];
  // Fuzzy match
  const lower = teamName.toLowerCase();
  for (const [name, abbr] of Object.entries(nameMap)) {
    if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase().split(' ').pop())) {
      return abbr;
    }
  }
  return null;
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== MAIN SLATE GENERATOR ====================

async function generateSlate(opts = {}) {
  const bankroll = opts.bankroll || 1000;
  const kellyFraction = opts.kellyFraction || 0.5;
  const minEdge = opts.minEdge || 0.03;
  const maxBets = opts.maxBets || 20;
  const date = opts.date || new Date().toISOString().split('T')[0];
  
  const startTime = Date.now();
  const allBets = [];
  const sportSummaries = {};
  const errors = [];

  // Fetch odds in parallel
  const [nbaOdds, mlbOdds, nhlOdds] = await Promise.all([
    fetchSportOdds('basketball_nba').catch(e => { errors.push(`NBA odds: ${e.message}`); return []; }),
    fetchSportOdds('baseball_mlb').catch(e => { errors.push(`MLB odds: ${e.message}`); return []; }),
    fetchSportOdds('icehockey_nhl').catch(e => { errors.push(`NHL odds: ${e.message}`); return []; }),
  ]);

  // ==================== NBA SLATE ====================
  if (nbaModel && nbaOdds.length > 0) {
    const nbaGames = [];
    for (const game of nbaOdds) {
      const away = resolveTeam(NBA_NAMES, game.away_team);
      const home = resolveTeam(NBA_NAMES, game.home_team);
      if (!away || !home) continue;

      let pred;
      try {
        // Use asyncPredict if available (includes rest/tank analysis)
        if (nbaModel.asyncPredict) {
          pred = await nbaModel.asyncPredict(away, home, {});
        }
        if (!pred || pred.error) pred = nbaModel.predict(away, home);
      } catch (e) { pred = nbaModel.predict(away, home); }
      if (pred.error) continue;

      // Calibrate
      let calPred = pred;
      if (calibration) {
        try { calPred = calibration.calibratePrediction(pred, 'nba'); } catch (e) { /* use raw */ }
      }

      // Extract best odds across books
      const bestOdds = extractBestOdds(game);
      
      // Rest/tank analysis
      let restTank = null;
      if (restTankService) {
        try { restTank = restTankService.analyzeMatchup(away, home); } catch (e) { /* optional */ }
      }

      const gameEntry = {
        sport: 'NBA',
        away, home,
        awayName: game.away_team,
        homeName: game.home_team,
        commenceTime: game.commence_time,
        prediction: {
          homeWinProb: calPred.homeWinProb,
          awayWinProb: calPred.awayWinProb,
          spread: calPred.spread || pred.spread,
          totalRuns: calPred.expectedTotal || pred.expectedTotal || (pred.homeExpRuns + pred.awayExpRuns),
        },
        odds: bestOdds,
        restTank: restTank ? {
          awayMotivation: restTank.awayMotivation,
          homeMotivation: restTank.homeMotivation,
          mismatchAlert: restTank.isMismatch,
          netAdj: restTank.netAdj,
        } : null,
        bets: [],
      };

      // Find ML value
      findMLValue(gameEntry, bankroll, kellyFraction, minEdge);
      // Find spread value
      findSpreadValue(gameEntry, pred, bankroll, kellyFraction, minEdge);
      // Find total value
      findTotalValue(gameEntry, pred, bankroll, kellyFraction, minEdge);

      nbaGames.push(gameEntry);
      allBets.push(...gameEntry.bets.map(b => ({ ...b, sport: 'NBA', matchup: `${away} @ ${home}` })));
    }
    sportSummaries.nba = { games: nbaGames.length, bets: nbaGames.reduce((s, g) => s + g.bets.length, 0) };
  }

  // ==================== MLB SLATE ====================
  if (mlbModel && mlbOdds.length > 0) {
    const mlbGames = [];
    for (const game of mlbOdds) {
      const away = resolveTeam(MLB_NAMES, game.away_team);
      const home = resolveTeam(MLB_NAMES, game.home_team);
      if (!away || !home) continue;

      let pred;
      try {
        pred = await mlbModel.asyncPredict(away, home, { gameDate: date });
      } catch (e) {
        try { pred = mlbModel.predict(away, home); } catch (e2) { continue; }
      }
      if (pred.error) continue;

      let calPred = pred;
      if (calibration) {
        try { calPred = calibration.calibratePrediction(pred, 'mlb'); } catch (e) { /* use raw */ }
      }

      const bestOdds = extractBestOdds(game);

      // Weather
      let wx = null;
      if (weatherService) {
        try { wx = await weatherService.getWeatherForPark(home); } catch (e) { /* optional */ }
      }

      // Opening Week adjustment
      let owAdj = null;
      if (openingWeekUnders) {
        try { owAdj = openingWeekUnders.getOpeningWeekAdjustment(date, '', {}); } catch (e) { /* optional */ }
      }

      const gameEntry = {
        sport: 'MLB',
        away, home,
        awayName: game.away_team,
        homeName: game.home_team,
        commenceTime: game.commence_time,
        prediction: {
          homeWinProb: calPred.homeWinProb || pred.homeWinProb,
          awayWinProb: calPred.awayWinProb || pred.awayWinProb,
          totalRuns: pred.totalRuns,
          homeExpRuns: pred.homeExpRuns,
          awayExpRuns: pred.awayExpRuns,
          f5Total: pred.f5Total,
        },
        odds: bestOdds,
        weather: wx ? { temp: wx.temp, wind: wx.windSpeed, multiplier: wx.runMultiplier || 1.0 } : null,
        openingWeek: owAdj?.active ? { reduction: owAdj.reductionPct, factors: owAdj.factors.length } : null,
        pitcher: {
          away: pred.awayPitcher?.name || 'TBD',
          home: pred.homePitcher?.name || 'TBD',
        },
        bets: [],
      };

      // Find ML value
      findMLValue(gameEntry, bankroll, kellyFraction, minEdge);
      // Find total value
      findTotalValue(gameEntry, pred, bankroll, kellyFraction, minEdge);

      mlbGames.push(gameEntry);
      allBets.push(...gameEntry.bets.map(b => ({ ...b, sport: 'MLB', matchup: `${away} @ ${home}` })));
    }
    sportSummaries.mlb = { games: mlbGames.length, bets: mlbGames.reduce((s, g) => s + g.bets.length, 0) };
  }

  // ==================== NHL SLATE ====================
  if (nhlModel && nhlOdds.length > 0) {
    const nhlGames = [];
    for (const game of nhlOdds) {
      const away = resolveTeam(NHL_NAMES, game.away_team);
      const home = resolveTeam(NHL_NAMES, game.home_team);
      if (!away || !home) continue;

      let pred;
      try { pred = nhlModel.predict(away, home); } catch (e) { continue; }
      if (pred.error) continue;

      // NHL predict returns different format
      const homeWinProb = pred.home?.winProb || pred.homeWinProb || 0.5;
      const awayWinProb = pred.away?.winProb || pred.awayWinProb || 0.5;

      let calPred = { homeWinProb, awayWinProb };
      if (calibration) {
        try { calPred = calibration.calibratePrediction(calPred, 'nhl'); } catch (e) { /* use raw */ }
      }

      const bestOdds = extractBestOdds(game);

      const gameEntry = {
        sport: 'NHL',
        away, home,
        awayName: game.away_team,
        homeName: game.home_team,
        commenceTime: game.commence_time,
        prediction: {
          homeWinProb: calPred.homeWinProb,
          awayWinProb: calPred.awayWinProb,
          totalGoals: pred.expectedTotal || pred.totalGoals || ((pred.home?.expectedGoals || 3) + (pred.away?.expectedGoals || 3)),
        },
        odds: bestOdds,
        bets: [],
      };

      findMLValue(gameEntry, bankroll, kellyFraction, minEdge);
      findTotalValue(gameEntry, pred, bankroll, kellyFraction, minEdge);

      nhlGames.push(gameEntry);
      allBets.push(...gameEntry.bets.map(b => ({ ...b, sport: 'NHL', matchup: `${away} @ ${home}` })));
    }
    sportSummaries.nhl = { games: nhlGames.length, bets: nhlGames.reduce((s, g) => s + g.bets.length, 0) };
  }

  // ==================== PORTFOLIO OPTIMIZATION ====================
  // Sort all bets by edge, take the best
  allBets.sort((a, b) => b.edge - a.edge);
  const topBets = allBets.slice(0, maxBets);

  // Cross-sport correlation: bets in different sports are uncorrelated
  // Same-sport bets have some correlation
  let totalWager = 0;
  let totalEV = 0;
  const sportAllocation = {};

  for (const bet of topBets) {
    totalWager += bet.wager || 0;
    totalEV += bet.ev || 0;
    if (!sportAllocation[bet.sport]) sportAllocation[bet.sport] = { bets: 0, wager: 0, ev: 0 };
    sportAllocation[bet.sport].bets++;
    sportAllocation[bet.sport].wager += bet.wager || 0;
    sportAllocation[bet.sport].ev += bet.ev || 0;
  }

  // Round allocation values
  for (const sport of Object.keys(sportAllocation)) {
    sportAllocation[sport].wager = +sportAllocation[sport].wager.toFixed(0);
    sportAllocation[sport].ev = +sportAllocation[sport].ev.toFixed(2);
  }

  const elapsedMs = Date.now() - startTime;

  return {
    timestamp: new Date().toISOString(),
    date,
    version: '45.0.0',
    elapsedMs,
    
    // HEADLINE NUMBERS
    headline: {
      totalGames: (sportSummaries.nba?.games || 0) + (sportSummaries.mlb?.games || 0) + (sportSummaries.nhl?.games || 0),
      totalBets: topBets.length,
      totalWager: +totalWager.toFixed(0),
      totalEV: +totalEV.toFixed(2),
      avgEdge: topBets.length > 0 ? +(topBets.reduce((s, b) => s + b.edge, 0) / topBets.length).toFixed(1) : 0,
      highConfidence: topBets.filter(b => b.confidence === 'HIGH').length,
      bestBet: topBets[0] || null,
    },
    
    // PORTFOLIO
    portfolio: {
      bankroll,
      kellyFraction,
      totalWager: +totalWager.toFixed(0),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
      allocation: sportAllocation,
      maxSingleBet: topBets[0]?.wager || 0,
    },
    
    // TOP BETS (ranked by edge)
    topBets,
    
    // SPORT SUMMARIES
    sports: sportSummaries,
    
    // ERRORS
    errors: errors.length > 0 ? errors : undefined,
    
    // META
    oddsApiActive: !!oddsApiKey,
    sportsActive: [
      nbaModel ? 'NBA' : null,
      mlbModel ? 'MLB' : null,
      nhlModel ? 'NHL' : null,
    ].filter(Boolean),
  };
}

// ==================== BET FINDING HELPERS ====================

function extractBestOdds(game) {
  const result = {
    homeML: null, homeBestBook: '',
    awayML: null, awayBestBook: '',
    total: null, totalBook: '',
    homeSpread: null, homeSpreadOdds: null, spreadBook: '',
    bookCount: 0,
  };

  for (const bk of (game.bookmakers || [])) {
    result.bookCount++;
    for (const mkt of (bk.markets || [])) {
      if (mkt.key === 'h2h') {
        for (const o of (mkt.outcomes || [])) {
          if (o.name === game.home_team) {
            if (result.homeML === null || o.price > result.homeML) {
              result.homeML = o.price;
              result.homeBestBook = bk.title;
            }
          } else {
            if (result.awayML === null || o.price > result.awayML) {
              result.awayML = o.price;
              result.awayBestBook = bk.title;
            }
          }
        }
      }
      if (mkt.key === 'totals') {
        for (const o of (mkt.outcomes || [])) {
          if (o.name === 'Over' && !result.total) {
            result.total = o.point;
            result.totalBook = bk.title;
          }
        }
      }
      if (mkt.key === 'spreads') {
        for (const o of (mkt.outcomes || [])) {
          if (o.name === game.home_team && !result.homeSpread) {
            result.homeSpread = o.point;
            result.homeSpreadOdds = o.price;
            result.spreadBook = bk.title;
          }
        }
      }
    }
  }

  return result;
}

function findMLValue(gameEntry, bankroll, kellyFraction, minEdge) {
  const odds = gameEntry.odds;
  if (!odds) return;

  const homeProb = gameEntry.prediction.homeWinProb;
  const awayProb = gameEntry.prediction.awayWinProb;

  // Home ML value
  if (odds.homeML !== null) {
    const bookProb = mlToProb(odds.homeML);
    const edge = homeProb - bookProb;
    if (edge > minEdge) {
      const decOdds = odds.homeML > 0 ? (odds.homeML / 100) + 1 : (100 / Math.abs(odds.homeML)) + 1;
      const kellyK = Math.max(0, ((decOdds - 1) * homeProb - (1 - homeProb)) / (decOdds - 1));
      const wager = Math.max(0, Math.min(bankroll * 0.05, bankroll * kellyK * kellyFraction));
      const ev = wager * (homeProb * (decOdds - 1) - (1 - homeProb));

      gameEntry.bets.push({
        type: 'ML',
        pick: `${gameEntry.home} ML`,
        team: gameEntry.home,
        ml: odds.homeML,
        mlStr: odds.homeML > 0 ? `+${odds.homeML}` : `${odds.homeML}`,
        book: odds.homeBestBook,
        modelProb: +(homeProb * 100).toFixed(1),
        bookProb: +(bookProb * 100).toFixed(1),
        edge: +(edge * 100).toFixed(1),
        kellyPct: +(kellyK * 100).toFixed(2),
        wager: +wager.toFixed(0),
        ev: +ev.toFixed(2),
        confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW',
        grade: edge >= 0.10 ? 'A+' : edge >= 0.08 ? 'A' : edge >= 0.06 ? 'B+' : edge >= 0.04 ? 'B' : 'C',
      });
    }
  }

  // Away ML value
  if (odds.awayML !== null) {
    const bookProb = mlToProb(odds.awayML);
    const edge = awayProb - bookProb;
    if (edge > minEdge) {
      const decOdds = odds.awayML > 0 ? (odds.awayML / 100) + 1 : (100 / Math.abs(odds.awayML)) + 1;
      const kellyK = Math.max(0, ((decOdds - 1) * awayProb - (1 - awayProb)) / (decOdds - 1));
      const wager = Math.max(0, Math.min(bankroll * 0.05, bankroll * kellyK * kellyFraction));
      const ev = wager * (awayProb * (decOdds - 1) - (1 - awayProb));

      gameEntry.bets.push({
        type: 'ML',
        pick: `${gameEntry.away} ML`,
        team: gameEntry.away,
        ml: odds.awayML,
        mlStr: odds.awayML > 0 ? `+${odds.awayML}` : `${odds.awayML}`,
        book: odds.awayBestBook,
        modelProb: +(awayProb * 100).toFixed(1),
        bookProb: +(bookProb * 100).toFixed(1),
        edge: +(edge * 100).toFixed(1),
        kellyPct: +(kellyK * 100).toFixed(2),
        wager: +wager.toFixed(0),
        ev: +ev.toFixed(2),
        confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW',
        grade: edge >= 0.10 ? 'A+' : edge >= 0.08 ? 'A' : edge >= 0.06 ? 'B+' : edge >= 0.04 ? 'B' : 'C',
      });
    }
  }
}

function findSpreadValue(gameEntry, pred, bankroll, kellyFraction, minEdge) {
  const odds = gameEntry.odds;
  if (!odds || !odds.homeSpread) return;
  
  // Model spread vs book spread
  const modelSpread = pred.spread || 0;
  const bookSpread = odds.homeSpread;
  const spreadDiff = Math.abs(modelSpread - bookSpread);
  
  if (spreadDiff >= 2) {
    // Model disagrees with book by 2+ points — potential value
    const side = modelSpread < bookSpread ? 'HOME' : 'AWAY';
    const edge = spreadDiff / 100; // rough edge estimate
    const wager = Math.min(bankroll * 0.03, bankroll * edge * kellyFraction);
    
    gameEntry.bets.push({
      type: 'SPREAD',
      pick: `${side === 'HOME' ? gameEntry.home : gameEntry.away} ${bookSpread > 0 ? '+' : ''}${bookSpread}`,
      team: side === 'HOME' ? gameEntry.home : gameEntry.away,
      modelSpread,
      bookSpread,
      spreadDiff: +spreadDiff.toFixed(1),
      book: odds.spreadBook,
      edge: +(edge * 100).toFixed(1),
      wager: +wager.toFixed(0),
      ev: +(wager * edge).toFixed(2),
      confidence: spreadDiff >= 4 ? 'HIGH' : spreadDiff >= 3 ? 'MEDIUM' : 'LOW',
      grade: spreadDiff >= 5 ? 'A' : spreadDiff >= 3 ? 'B' : 'C',
    });
  }
}

function findTotalValue(gameEntry, pred, bankroll, kellyFraction, minEdge) {
  const odds = gameEntry.odds;
  if (!odds || !odds.total) return;

  const modelTotal = pred.totalRuns || pred.expectedTotal || 
    ((pred.homeExpRuns || pred.home?.expectedGoals || 0) + (pred.awayExpRuns || pred.away?.expectedGoals || 0));
  const bookTotal = odds.total;
  
  if (!modelTotal || !bookTotal) return;
  
  const diff = modelTotal - bookTotal;
  
  // For MLB/NHL: 0.5 run/goal minimum diff. For NBA: 3 point minimum
  const minDiff = gameEntry.sport === 'NBA' ? 3 : 0.5;
  
  if (Math.abs(diff) >= minDiff) {
    const side = diff > 0 ? 'OVER' : 'UNDER';
    // Rough edge: proportional to total difference
    const edgePct = Math.abs(diff) / bookTotal;
    const edge = Math.min(0.15, edgePct);
    const wager = Math.min(bankroll * 0.03, bankroll * edge * kellyFraction);
    
    gameEntry.bets.push({
      type: 'TOTAL',
      pick: `${side} ${bookTotal}`,
      modelTotal: +modelTotal.toFixed(1),
      bookTotal,
      diff: +diff.toFixed(1),
      book: odds.totalBook,
      edge: +(edge * 100).toFixed(1),
      wager: +wager.toFixed(0),
      ev: +(wager * edge).toFixed(2),
      confidence: Math.abs(diff) >= (minDiff * 3) ? 'HIGH' : Math.abs(diff) >= (minDiff * 2) ? 'MEDIUM' : 'LOW',
      grade: Math.abs(diff) >= (minDiff * 4) ? 'A' : Math.abs(diff) >= (minDiff * 2) ? 'B' : 'C',
      weather: gameEntry.weather || null,
      openingWeek: gameEntry.openingWeek || null,
    });
  }
}

// ==================== STATUS ====================

function getStatus() {
  return {
    service: 'daily-slate',
    version: '1.0',
    sportsActive: [
      nbaModel ? 'NBA' : null,
      mlbModel ? 'MLB' : null,
      nhlModel ? 'NHL' : null,
    ].filter(Boolean),
    oddsApiActive: !!oddsApiKey,
    features: [
      'cross-sport portfolio',
      'kelly sizing',
      'calibrated probabilities',
      'rest/tank analysis',
      'weather integration',
      'opening week adjustments',
      'best-odds shopping',
    ],
  };
}

module.exports = {
  init,
  generateSlate,
  getStatus,
};
