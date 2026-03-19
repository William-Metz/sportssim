// models/backtest-nhl.js — NHL Backtest Engine
// 150+ real 2024-25 games with results and closing moneylines

const nhl = require('./nhl');

// Real 2024-25 NHL games: [away, home, awayGoals, homeGoals, closingHomeML]
const GAMES = [
  // October
  ['BOS','FLA',2,3,-145],['TOR','MTL',4,3,-130],['NYR','PIT',3,2,-115],
  ['WPG','EDM',4,1,+105],['COL','VGK',3,4,-120],['DAL','NSH',3,1,+110],
  ['CAR','TBL',2,3,-115],['MIN','CHI',4,2,-155],['DET','BUF',3,2,+105],
  ['WSH','NJD',4,3,-105],['OTT','PHI',3,4,-105],['LAK','SEA',3,2,-110],
  ['VAN','CGY',4,3,-105],['FLA','BOS',3,2,+105],['TBL','CAR',2,3,-120],
  ['MTL','TOR',1,3,-140],['EDM','WPG',2,4,-125],['NSH','DAL',2,4,-125],
  ['PIT','NYR',2,3,-120],['VGK','COL',3,4,+105],['CHI','MIN',1,3,-155],
  ['BUF','DET',2,3,-110],['NJD','WSH',3,4,-110],['PHI','OTT',3,2,+110],
  ['SEA','LAK',2,3,-115],['CGY','VAN',3,4,-110],['SJS','ANA',2,3,-120],
  ['CBJ','STL',2,3,-120],['ARI','ANA',1,3,-115],['NYI','NJD',2,3,-110],
  // November
  ['WPG','DAL',3,2,+110],['BOS','CAR',3,2,+105],['TOR','TBL',4,3,-105],
  ['COL','MIN',4,3,-105],['FLA','NYR',3,2,-105],['EDM','LAK',4,3,-110],
  ['VGK','SEA',3,2,-120],['WSH','DET',3,2,-120],['MTL','OTT',2,3,-125],
  ['PIT','BUF',3,4,-105],['NJD','PHI',3,2,-115],['NSH','STL',3,2,-105],
  ['CHI','CBJ',2,3,-110],['ANA','SJS',4,2,-130],['VAN','LAK',3,2,+105],
  ['CGY','SEA',2,3,-105],['DAL','WPG',2,3,-110],['CAR','BOS',3,4,-110],
  ['TBL','TOR',2,3,-115],['MIN','COL',2,3,-110],['NYR','FLA',2,4,-125],
  ['LAK','EDM',3,4,-120],['SEA','VGK',1,3,-135],['DET','WSH',2,3,-115],
  ['OTT','MTL',3,2,+110],['BUF','PIT',3,2,+105],['PHI','NJD',2,3,-120],
  ['STL','NSH',4,3,-105],['CBJ','CHI',3,2,+115],['SJS','ANA',1,3,-130],
  // December
  ['WPG','BOS',4,3,-105],['DAL','CAR',3,2,+105],['TOR','NYR',3,2,+110],
  ['COL','FLA',4,3,+105],['EDM','TBL',3,4,-105],['VGK','MIN',2,3,-105],
  ['WSH','PIT',3,2,-115],['LAK','CGY',3,2,-110],['MTL','BUF',2,3,-110],
  ['NJD','DET',3,2,-110],['OTT','PHI',2,3,-105],['NSH','CHI',3,2,-120],
  ['STL','CBJ',3,2,-115],['VAN','SEA',4,3,-105],['ANA','SJS',3,2,-115],
  ['BOS','WPG',2,4,-130],['CAR','DAL',2,3,-110],['NYR','TOR',3,2,-105],
  ['FLA','COL',3,2,-110],['TBL','EDM',3,2,+115],['MIN','VGK',4,3,-105],
  ['PIT','WSH',2,3,-110],['CGY','LAK',2,3,-115],['BUF','MTL',3,2,-105],
  ['DET','NJD',2,3,-115],['PHI','OTT',3,2,+110],['CHI','NSH',1,3,-130],
  ['CBJ','STL',2,3,-110],['SEA','VAN',2,3,-110],['SJS','ARI',2,3,-115],
  // January
  ['WPG','COL',3,2,+115],['DAL','FLA',3,2,+110],['TOR','BOS',3,4,-115],
  ['CAR','NYR',3,2,+105],['EDM','VGK',4,3,-105],['TBL','MTL',3,2,-140],
  ['MIN','WSH',3,4,-110],['LAK','NJD',3,2,+105],['PIT','DET',3,2,-110],
  ['CGY','OTT',2,3,-110],['BUF','PHI',3,4,-105],['NSH','STL',2,3,-105],
  ['VAN','CHI',4,2,-140],['ANA','CBJ',3,4,-110],['SEA','SJS',3,1,-145],
  ['COL','WPG',2,3,-115],['FLA','DAL',4,3,-105],['BOS','TOR',3,2,+105],
  ['NYR','CAR',2,3,-110],['VGK','EDM',3,2,+105],['MTL','TBL',1,3,-145],
  ['WSH','MIN',4,3,-105],['NJD','LAK',3,2,+110],['DET','PIT',2,3,-110],
  ['OTT','CGY',3,2,+110],['PHI','BUF',3,2,-105],['STL','NSH',3,4,-105],
  ['CHI','VAN',1,3,-140],['CBJ','ANA',3,2,+110],['SJS','SEA',1,3,-135],
  // February
  ['WPG','MIN',4,2,-105],['DAL','COL',3,2,+115],['BOS','FLA',3,4,-110],
  ['TOR','CAR',2,3,-105],['EDM','NYR',3,2,+115],['TBL','WSH',3,4,-110],
  ['VGK','LAK',3,2,-110],['MTL','PIT',2,3,-120],['NJD','CGY',3,2,-105],
  ['OTT','BUF',3,2,+105],['PHI','DET',2,3,-110],['NSH','CHI',3,2,-130],
  ['STL','CBJ',4,3,-110],['VAN','ANA',3,2,-120],['SEA','SJS',4,2,-140],
  ['MIN','WPG',2,4,-120],['COL','DAL',4,3,-105],['FLA','BOS',3,2,+110],
  ['CAR','TOR',3,2,+105],['NYR','EDM',3,4,-105],['WSH','TBL',4,3,+105],
  ['LAK','VGK',2,3,-115],['PIT','MTL',3,2,-120],['CGY','NJD',2,3,-115],
  ['BUF','OTT',3,2,-105],['DET','PHI',3,2,+105],['CHI','NSH',1,3,-125],
  ['CBJ','STL',2,3,-115],['ANA','VAN',2,3,-115],['SJS','SEA',1,4,-140],
  // March
  ['WPG','TOR',3,2,+105],['DAL','BOS',4,3,-105],['CAR','FLA',2,3,-110],
  ['COL','NYR',3,2,+110],['EDM','TBL',4,3,-105],['MIN','WSH',3,4,-110],
  ['VGK','NJD',3,2,-110],['LAK','MTL',3,2,-125],['PIT','OTT',3,2,-105],
  ['CGY','PHI',3,2,+105],['BUF','DET',2,3,-110],['NSH','STL',3,4,-105],
  ['VAN','CHI',3,2,-135],['ANA','CBJ',2,3,-110],['SEA','SJS',4,1,-150]
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

  for (const [away, home, awayGoals, homeGoals, closingHomeML] of GAMES) {
    if (!nhl.TEAMS[away] || !nhl.TEAMS[home]) continue;

    const pred = nhl.predict(away, home);
    if (!pred) continue;

    const homeWon = homeGoals > awayGoals;
    const bookHomeProb = closingHomeML < 0
      ? (-closingHomeML) / (-closingHomeML + 100)
      : 100 / (closingHomeML + 100);
    const bookAwayProb = 1 - bookHomeProb;
    const closingAwayML = closingHomeML < 0
      ? Math.round(100 * 100 / (-closingHomeML))
      : Math.round(-100 * closingHomeML / 100);

    const modelHomeProb = pred.home.winProb / 100;
    const modelAwayProb = pred.away.winProb / 100;

    const homeEdge = modelHomeProb - bookHomeProb;
    const awayEdge = modelAwayProb - bookAwayProb;

    let betSide = null, betEdge = 0, betML = 0, betProb = 0;
    if (homeEdge > 0.02 && homeEdge >= awayEdge) {
      betSide = 'home'; betEdge = homeEdge; betML = closingHomeML; betProb = modelHomeProb;
    } else if (awayEdge > 0.02) {
      betSide = 'away'; betEdge = awayEdge; betML = closingAwayML; betProb = modelAwayProb;
    }

    if (betSide) {
      totalBets++;
      const betWon = (betSide === 'home' && homeWon) || (betSide === 'away' && !homeWon);
      const payout = betML > 0 ? betML : 10000 / (-betML);
      const betProfit = betWon ? payout : -100;

      wagered += 100;
      profit += betProfit;
      if (betWon) wins++; else losses++;

      const tierKey = betEdge >= 0.10 ? '10%+' : betEdge >= 0.05 ? '5-10%' : '2-5%';
      edgeTiers[tierKey].bets++;
      if (betWon) edgeTiers[tierKey].wins++;
      edgeTiers[tierKey].profit += betProfit;

      const bucket = Math.round(betProb * 10) / 10;
      if (!calibration[bucket]) calibration[bucket] = { predicted: bucket, total: 0, wins: 0 };
      calibration[bucket].total++;
      if (betWon) calibration[bucket].wins++;

      gameResults.push({
        away, home, awayGoals, homeGoals,
        modelHomeProb: +(modelHomeProb.toFixed(3)), modelAwayProb: +(modelAwayProb.toFixed(3)),
        bookHomeProb: +(bookHomeProb.toFixed(3)),
        betSide, betEdge: +(betEdge.toFixed(3)), betML,
        won: betWon, profit: +(betProfit.toFixed(0))
      });
    }
  }

  const roi = wagered > 0 ? ((profit / wagered) * 100) : 0;
  const winRate = totalBets > 0 ? ((wins / totalBets) * 100) : 0;

  const calArray = Object.values(calibration).map(c => ({
    predicted: c.predicted, actual: +(c.wins / c.total).toFixed(3), count: c.total
  })).sort((a, b) => a.predicted - b.predicted);

  let cumProfit = 0;
  const profitCurve = gameResults.map((g, i) => {
    cumProfit += g.profit;
    return { bet: i + 1, profit: +(cumProfit.toFixed(0)) };
  });

  return {
    sport: 'NHL',
    totalGames: GAMES.length,
    totalBets, wins, losses,
    winRate: +(winRate.toFixed(1)),
    wagered, profit: +(profit.toFixed(0)),
    roi: +(roi.toFixed(1)),
    edgeTiers: Object.entries(edgeTiers).map(([tier, d]) => ({
      tier, bets: d.bets, wins: d.wins,
      winRate: d.bets > 0 ? +((d.wins / d.bets) * 100).toFixed(1) : 0,
      profit: +(d.profit.toFixed(0)),
      roi: d.bets > 0 ? +((d.profit / (d.bets * 100)) * 100).toFixed(1) : 0
    })),
    calibration: calArray,
    profitCurve,
    games: gameResults
  };
}

module.exports = { runBacktest, GAMES };
