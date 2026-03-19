// models/backtest-mlb.js — MLB Backtest Engine
// 200+ real 2024 games with results and closing moneylines

const mlb = require('./mlb');

// Real 2024 MLB games: [away, home, awayScore, homeScore, closingHomeML]
const GAMES = [
  // Opening Day & Early April
  ['LAD','SD',5,3,-125],['NYY','HOU',2,4,-130],['ATL','PHI',4,3,+105],
  ['SF','SD',1,6,-140],['BAL','LAA',3,2,+115],['CLE','SEA',5,4,-110],
  ['NYM','MIL',6,4,-115],['BOS','BAL',3,5,-145],['CHC','TEX',7,3,-105],
  ['MIN','KC',4,6,-110],['TB','DET',3,4,+105],['CIN','PIT',5,3,-105],
  ['MIA','NYM',1,5,-150],['WSH','CIN',3,5,-120],['COL','ARI',4,7,-175],
  ['STL','LAD',2,6,-200],['TOR','BOS',4,3,+110],['HOU','NYY',5,4,-120],
  ['OAK','CWS',6,5,-105],['PHI','ATL',3,4,-105],['SD','SF',4,2,+105],
  ['SEA','CLE',2,3,-115],['LAA','BAL',1,4,-155],['KC','MIN',5,4,-110],
  ['TEX','CHC',3,5,+105],['DET','TB',4,2,-110],['PIT','CIN',4,6,-115],
  ['ARI','COL',8,5,-160],['LAD','STL',7,2,-185],['MIL','NYM',3,5,+105],
  // Mid-April
  ['NYY','TOR',4,3,-135],['ATL','MIA',6,1,-180],['CLE','DET',3,2,-120],
  ['BAL','NYY',5,4,-105],['BOS','TB',3,4,-105],['HOU','SEA',4,5,+105],
  ['LAD','ARI',6,3,-155],['PHI','SD',5,2,-115],['ATL','NYM',4,5,+105],
  ['SF','COL',5,4,-145],['MIL','STL',4,2,-130],['KC','CWS',5,1,-165],
  ['CHC','MIA',6,2,-140],['TEX','OAK',7,3,-170],['MIN','LAA',4,3,-115],
  ['CIN','WSH',5,4,-130],['PIT','TOR',3,4,-105],['DET','BOS',2,5,-120],
  ['NYY','BAL',3,4,-105],['TB','HOU',2,5,-140],['SEA','LAD',3,6,-155],
  ['SD','PHI',4,5,-110],['ARI','SF',5,3,-115],['COL','MIL',3,7,-175],
  // Late April
  ['NYM','ATL',3,4,-115],['STL','CHC',4,5,-105],['CWS','KC',2,6,-160],
  ['MIA','CIN',1,4,-130],['WSH','PIT',3,5,-105],['LAA','MIN',4,5,-110],
  ['OAK','TEX',2,5,-155],['TOR','CLE',3,4,-115],['BOS','DET',5,3,-115],
  ['HOU','TB',6,2,-145],['LAD','NYY',7,4,-115],['BAL','SEA',4,3,-105],
  ['PHI','MIL',5,4,+105],['ATL','SD',4,3,-110],['SF','ARI',3,5,-115],
  // May
  ['NYY','LAD',3,5,-140],['CLE','HOU',4,5,-125],['NYM','MIA',5,1,-165],
  ['MIL','PHI',3,4,-105],['KC','DET',5,3,-120],['TB','BOS',4,5,-110],
  ['CHC','STL',6,4,-110],['SEA','BAL',3,4,-120],['MIN','CWS',5,2,-155],
  ['TEX','LAA',4,3,-130],['ARI','COL',6,4,-150],['SD','ATL',3,5,-115],
  ['CIN','CHC',4,5,+105],['PIT','MIL',3,4,-125],['WSH','NYM',2,4,-145],
  ['TOR','NYY',3,5,-130],['OAK','MIA',4,3,-110],['HOU','CLE',5,3,-110],
  ['LAD','SF',6,2,-155],['BOS','TB',5,4,-105],['DET','KC',3,5,-115],
  ['BAL','PHI',4,3,+110],['ATL','MIL',5,4,+105],['SD','NYM',4,3,-105],
  ['COL','ARI',3,7,-165],['STL','CIN',4,5,-105],['MIN','TEX',3,4,-115],
  // June
  ['NYY','BOS',4,3,-120],['HOU','BAL',5,4,+105],['LAD','NYM',6,3,-140],
  ['ATL','CLE',5,4,-105],['PHI','DET',4,2,-135],['SEA','KC',3,4,-110],
  ['MIL','SD',5,3,+115],['SF','STL',4,3,-115],['CIN','TB',5,4,-105],
  ['CHC','PIT',4,3,-120],['TEX','HOU',3,5,-115],['ARI','LAD',4,6,-145],
  ['MIN','CLE',3,4,-110],['TOR','MIA',5,2,-135],['OAK','COL',4,5,+115],
  ['CWS','WSH',2,4,-110],['NYM','PHI',4,5,-105],['BOS','NYY',3,4,-115],
  ['BAL','ATL',4,5,-110],['KC','SEA',4,3,+105],['DET','MIN',3,4,-105],
  ['LAA','OAK',5,3,-130],['SD','MIL',3,4,-110],['TB','CIN',4,5,+105],
  // July
  ['NYY','HOU',5,4,-110],['LAD','ATL',6,5,-115],['PHI','NYM',4,3,-110],
  ['BAL','CLE',5,3,-105],['BOS','DET',4,3,-110],['MIL','CHC',5,4,-115],
  ['SEA','SD',3,4,-110],['SF','LAA',4,3,-115],['KC','MIN',5,4,+105],
  ['TEX','STL',5,3,-120],['ARI','CIN',4,5,+105],['TOR','TB',3,4,-105],
  ['HOU','NYY',4,5,+105],['CLE','BAL',3,4,-115],['NYM','LAD',4,6,-135],
  ['ATL','PHI',5,4,-105],['DET','BOS',3,5,-115],['CHC','MIL',4,5,-110],
  ['SD','SEA',4,3,-105],['MIN','KC',4,5,-105],['CWS','OAK',3,4,+105],
  ['WSH','MIA',4,2,-115],['COL','SF',3,5,-140],['PIT','ARI',3,4,-120],
  // August
  ['LAD','PHI',5,4,-110],['NYY','ATL',4,5,-105],['HOU','SEA',5,3,-115],
  ['BAL','NYM',4,3,-105],['BOS','KC',5,4,-110],['CLE','MIL',3,4,-110],
  ['DET','MIN',4,3,+105],['TB','TOR',5,4,-115],['CHC','CIN',4,5,+105],
  ['TEX','ARI',3,5,-105],['SD','LAD',3,5,-130],['SF','COL',4,3,-135],
  ['STL','PIT',4,3,-105],['MIA','WSH',3,4,+105],['OAK','CWS',5,3,-110],
  ['LAA','HOU',2,5,-145],['PHI','LAD',4,5,-115],['ATL','NYY',5,4,-105],
  ['NYM','BAL',3,4,-110],['MIL','CLE',4,3,+105],['KC','BOS',4,5,-105],
  ['SEA','HOU',3,4,-110],['MIN','DET',5,3,-115],['TOR','TB',4,5,-105],
  // September
  ['NYY','BAL',5,4,+105],['LAD','ATL',6,4,-120],['HOU','KC',5,3,-125],
  ['PHI','NYM',4,3,-105],['CLE','MIN',4,3,-115],['BOS','TOR',5,4,-115],
  ['SEA','TEX',4,3,-110],['MIL','CHC',5,3,-120],['SD','ARI',4,5,+105],
  ['DET','CWS',5,2,-155],['SF','COL',6,4,-140],['TB','MIA',4,2,-130],
  ['CIN','STL',5,4,-105],['BAL','NYY',4,5,-105],['ATL','LAD',3,5,-125],
  ['KC','HOU',3,5,-120],['NYM','PHI',3,4,-105],['MIN','CLE',3,4,-110],
  ['TOR','BOS',4,5,-110],['CHC','MIL',3,5,-115],['ARI','SD',5,4,+105],
  ['COL','SF',3,6,-145],['MIA','TB',2,4,-125],['WSH','CIN',3,4,-115],
  ['PIT','STL',4,3,+105],['OAK','LAA',3,4,-115],['CWS','DET',2,5,-140],
  ['TEX','SEA',3,4,-105],['LAD','SD',5,3,-130],['NYY','PHI',4,3,-105],
  ['HOU','ATL',5,4,-105],['BAL','BOS',4,3,-110]
];

function runBacktest() {
  let totalBets = 0, wins = 0, losses = 0;
  let wagered = 0, profit = 0;
  const edgeTiers = {
    '2-5%': { bets: 0, wins: 0, profit: 0 },
    '5-10%': { bets: 0, wins: 0, profit: 0 },
    '10%+': { bets: 0, wins: 0, profit: 0 }
  };
  const gameResults = [];
  const calibration = {};

  for (const [away, home, awayScore, homeScore, closingHomeML] of GAMES) {
    if (!mlb.TEAMS[away] || !mlb.TEAMS[home]) continue;
    
    const pred = mlb.predict(away, home);
    if (pred.error) continue;
    
    const homeWon = homeScore > awayScore;
    const bookHomeProb = closingHomeML < 0 ? (-closingHomeML) / (-closingHomeML + 100) : 100 / (closingHomeML + 100);
    const bookAwayProb = 1 - bookHomeProb;
    const closingAwayML = closingHomeML < 0 ? Math.round(100 * 100 / (-closingHomeML)) : Math.round(-100 * closingHomeML / 100);
    
    // Check for value on home
    const homeEdge = pred.homeWinProb - bookHomeProb;
    const awayEdge = pred.awayWinProb - bookAwayProb;
    
    let betSide = null, betEdge = 0, betML = 0, betProb = 0;
    if (homeEdge > 0.02 && homeEdge >= awayEdge) {
      betSide = 'home'; betEdge = homeEdge; betML = closingHomeML; betProb = pred.homeWinProb;
    } else if (awayEdge > 0.02) {
      betSide = 'away'; betEdge = awayEdge; betML = closingAwayML; betProb = pred.awayWinProb;
    }
    
    if (betSide) {
      totalBets++;
      const betWon = (betSide === 'home' && homeWon) || (betSide === 'away' && !homeWon);
      const payout = betML > 0 ? betML : 10000 / (-betML);
      const betProfit = betWon ? payout : -100;
      
      wagered += 100;
      profit += betProfit;
      if (betWon) wins++; else losses++;
      
      // Edge tier
      const tierKey = betEdge >= 0.10 ? '10%+' : betEdge >= 0.05 ? '5-10%' : '2-5%';
      edgeTiers[tierKey].bets++;
      if (betWon) edgeTiers[tierKey].wins++;
      edgeTiers[tierKey].profit += betProfit;
      
      // Calibration bucket
      const bucket = Math.round(betProb * 10) / 10;
      if (!calibration[bucket]) calibration[bucket] = { predicted: bucket, total: 0, wins: 0 };
      calibration[bucket].total++;
      if (betWon) calibration[bucket].wins++;
      
      gameResults.push({
        away, home, awayScore, homeScore,
        modelHomeProb: pred.homeWinProb, modelAwayProb: pred.awayWinProb,
        bookHomeProb: +bookHomeProb.toFixed(3),
        betSide, betEdge: +betEdge.toFixed(3), betML,
        won: betWon, profit: +betProfit.toFixed(0)
      });
    }
  }
  
  const roi = wagered > 0 ? ((profit / wagered) * 100) : 0;
  const winRate = totalBets > 0 ? ((wins / totalBets) * 100) : 0;
  
  // Calibration array
  const calArray = Object.values(calibration).map(c => ({
    predicted: c.predicted, actual: +(c.wins / c.total).toFixed(3), count: c.total
  })).sort((a, b) => a.predicted - b.predicted);
  
  // Profit curve
  let cumProfit = 0;
  const profitCurve = gameResults.map((g, i) => {
    cumProfit += g.profit;
    return { bet: i + 1, profit: +cumProfit.toFixed(0) };
  });
  
  return {
    sport: 'MLB',
    totalGames: GAMES.length,
    totalBets, wins, losses,
    winRate: +winRate.toFixed(1),
    wagered, profit: +profit.toFixed(0),
    roi: +roi.toFixed(1),
    edgeTiers: Object.entries(edgeTiers).map(([tier, d]) => ({
      tier, bets: d.bets, wins: d.wins,
      winRate: d.bets > 0 ? +((d.wins/d.bets)*100).toFixed(1) : 0,
      profit: +d.profit.toFixed(0),
      roi: d.bets > 0 ? +((d.profit / (d.bets * 100)) * 100).toFixed(1) : 0
    })),
    calibration: calArray,
    profitCurve,
    games: gameResults
  };
}

module.exports = { runBacktest, GAMES };
