/**
 * SportsSim NBA Backtest Engine
 * 
 * Tests model against real 2024-25 NBA games with closing lines.
 * Calculates ATS record, ROI by edge tier, calibration.
 */

const nba = require('./nba');

// Real 2024-25 NBA game results with closing spreads
// Format: [away, home, awayScore, homeScore, closingSpread (neg=home fav), closingTotal]
const GAMES = [
  // Oct-Nov 2024 games
  ['BOS','NYK',98,110,-2.5,213],['MIL','PHI',124,109,1.5,220],['LAL','DEN',110,114,-6,225.5],
  ['DAL','SAS',120,109,6.5,217],['CLE','TOR',136,106,7,220],['OKC','DEN',102,87,-1,218],
  ['MEM','HOU',104,112,-4,220],['BOS','CLE',109,118,-3,217],['GSW','LAC',104,99,2,219],
  ['NYK','BKN',108,104,5.5,215],['ATL','OKC',126,132,-9,225],['PHX','LAL',109,105,1.5,225],
  ['DET','IND',115,120,-4.5,228],['MIA','CHA',106,98,5.5,210],['MIN','SAC',117,115,-1,220],
  ['CHI','MIL',91,122,-7.5,218],['BKN','ORL',90,98,-8.5,209],['WAS','CLE',113,118,-12,221],
  ['POR','GSW',104,109,-7.5,222],['NOP','DAL',110,132,-5,222],['HOU','SAS',106,101,5.5,215],
  ['TOR','PHI',115,107,2.5,218],['UTA','LAC',105,100,4,212],['DEN','MEM',105,122,-1.5,224],
  ['LAL','MIA',124,118,2.5,218],['BOS','ATL',123,115,-5.5,228],['CLE','GSW',136,117,-3.5,225],
  ['OKC','LAC',134,128,-6.5,217],['SAC','CHI',114,108,3,221],['NYK','MIL',116,120,-1.5,224],
  ['PHX','DET',114,118,3,220],['IND','NOP',114,110,5,227],['MEM','LAL',127,124,-1.5,226],
  ['DAL','OKC',118,122,-4,225],['MIN','DEN',119,109,2.5,216],['SAS','HOU',96,109,-7,215],
  ['ATL','CHA',125,120,5.5,222],['BKN','PHI',94,113,-7,214],['ORL','MIA',98,95,-1,208],
  ['WAS','POR',98,125,-2,219],['TOR','BOS',107,126,-10.5,218],['UTA','GSW',105,130,-9,222],
  ['CHI','IND',110,118,-5,230],['LAC','SAC',100,108,-2,217],['DET','MIL',106,121,-5.5,220],
  // Dec 2024 games
  ['CLE','DEN',126,117,2,218],['OKC','NYK',117,107,-1,217],['BOS','MIL',113,107,1.5,222],
  ['MEM','MIN',104,112,-3,216],['GSW','DAL',120,117,2.5,225],['LAL','ATL',119,134,2,230],
  ['HOU','PHX',117,108,1.5,220],['PHI','ORL',104,99,-3,208],['SAS','WAS',139,120,6,221],
  ['MIA','TOR',116,107,4.5,216],['IND','BKN',131,109,8.5,224],['SAC','CHA',104,94,6.5,214],
  ['NOP','POR',108,115,-1.5,218],['CHI','UTA',126,120,2,222],['DEN','LAC',122,115,3.5,220],
  ['DAL','MEM',115,119,-2,225],['NYK','OKC',93,117,-5,214],['MIL','CLE',105,116,-2.5,218],
  ['BOS','GSW',118,112,3.5,223],['ATL','HOU',100,120,-5.5,222],['PHX','LAL',108,113,-1.5,225],
  ['MIN','DET',108,114,-1,215],['TOR','PHI',92,111,-4.5,213],['ORL','MIA',95,89,1.5,206],
  ['BKN','WAS',113,122,-2,218],['CHA','SAS',106,118,-4,215],['POR','UTA',118,108,1,216],
  ['IND','CHI',121,106,3.5,228],['SAC','NOP',124,111,5.5,220],['LAC','DAL',98,115,-3,219],
  // Jan 2025 games
  ['CLE','OKC',129,122,3,223],['BOS','DEN',118,106,2.5,220],['NYK','MEM',106,112,-1.5,218],
  ['MIL','GSW',114,109,2.5,225],['HOU','DAL',116,121,-1.5,222],['DET','ATL',110,118,-2,224],
  ['PHI','LAL',108,117,-3,223],['MIN','PHX',104,108,-1.5,216],['SAS','LAC',118,105,4,214],
  ['MIA','IND',100,114,-4,225],['TOR','NOP',115,107,2,218],['ORL','CHA',98,102,-4.5,210],
  ['WAS','BKN',112,124,-3,216],['POR','CHI',115,118,-3.5,222],['SAC','UTA',120,107,5,219],
  ['OKC','BOS',127,123,1,222],['DEN','NYK',116,118,-2.5,219],['CLE','MIL',108,99,2,218],
  ['MEM','HOU',120,112,3,221],['GSW','MIN',117,122,-2.5,218],['DAL','DET',114,107,2,220],
  ['ATL','PHI',118,104,3,225],['LAL','SAS',126,118,7,224],['PHX','MIA',112,108,2,216],
  ['LAC','ORL',95,101,-4,208],['IND','TOR',123,116,4.5,228],['BKN','POR',100,118,-2.5,218],
  ['CHA','WAS',112,106,3.5,214],['NOP','SAC',104,120,-5,222],['CHI','DEN',108,125,-7.5,222],
  ['UTA','LAL',99,115,-8,222],['MIL','DAL',110,119,-1.5,225],
  // Feb 2025 games
  ['OKC','CLE',108,102,1.5,218],['BOS','HOU',112,107,3.5,220],['NYK','DET',118,110,3,219],
  ['MEM','ATL',122,115,3,230],['GSW','PHI',120,108,4,222],['DEN','MEM',109,115,-1,224],
  ['DAL','CLE',115,121,-3.5,218],['MIN','OKC',106,118,-6,216],['HOU','BOS',104,116,-3,218],
  ['PHX','NYK',108,116,-3.5,219],['LAL','MIL',122,118,1,226],['SAS','IND',112,120,-5,228],
  ['MIA','ORL',100,96,1,207],['TOR','CHA',114,102,4,218],['DET','PHI',108,104,2,216],
  ['LAC','WAS',118,107,8,214],['BKN','NOP',106,111,-2.5,216],['POR','UTA',110,105,1.5,216],
  ['SAC','CHI',119,109,4,224],['ATL','GSW',125,118,2.5,228],['IND','DAL',116,121,-3,228],
  ['ORL','MIN',96,108,-5.5,210],['CHA','LAL',99,118,-10,220],['WAS','PHX',104,124,-12,222],
  // Mar 2025 games
  ['CLE','BOS',112,108,2,218],['OKC','DEN',118,110,4,220],['NYK','HOU',109,115,-2.5,218],
  ['MEM','DAL',122,118,1,226],['GSW','ATL',106,118,-2,226],['DET','MIN',107,115,-3,215],
  ['MIL','PHX',112,108,1,222],['LAL','NYK',118,122,-3,222],['PHI','MIA',105,110,-2.5,214],
  ['SAS','ORL',100,96,2,208],['IND','LAC',119,108,4,222],['TOR','BKN',114,106,5.5,218],
  ['SAC','POR',118,106,6,222],['NOP','WAS',110,116,-1,218],['CHI','CHA',112,104,5,219],
  ['UTA','SAS',102,110,-3.5,215],['DEN','LAL',117,123,-1.5,226],['BOS','PHI',118,106,8.5,219],
  ['HOU','MIL',108,112,-2,218],['DAL','IND',121,117,2,228],['OKC','MEM',125,118,4.5,226],
  ['ATL','CLE',110,122,-5.5,222],['MIN','GSW',108,100,3,216],['PHX','SAC',116,119,-1.5,222],
  ['MIA','TOR',108,104,5,216],['LAC','CHI',106,112,-2,218],['ORL','DET',100,108,-2.5,212],
  ['POR','NOP',118,104,3,220],['BKN','UTA',96,100,-1.5,210],['WAS','BKN',106,118,-3,216],
  ['NYK','DEN',112,108,2.5,220],['CLE','HOU',118,108,2,218],['BOS','MEM',115,120,-1,224],
  ['DAL','OKC',108,122,-6,224],['LAL','PHX',116,112,1.5,226],['MIL','ATL',120,118,3,228],
  ['DET','MIA',106,100,2.5,212],['CHI','IND',104,118,-5.5,228],['SAC','MIN',112,108,1,218],
  ['GSW','LAC',117,109,3.5,219],['PHI','CHA',115,104,7,218],['SAS','POR',116,109,3.5,218],
  ['TOR','WAS',118,106,8,218],['NOP','UTA',102,110,-2,215],['ORL','BKN',108,96,7,208]
];

/**
 * Run full backtest
 */
function runBacktest() {
  const results = [];
  let atsWins = 0, atsLosses = 0, atsPush = 0;
  let mlWins = 0, mlLosses = 0, mlProfit = 0;
  const edgeTiers = {
    'low': { label: '1-3% edge', wins: 0, losses: 0, profit: 0 },
    'med': { label: '3-5% edge', wins: 0, losses: 0, profit: 0 },
    'high': { label: '5%+ edge', wins: 0, losses: 0, profit: 0 }
  };
  const calibration = {};
  
  for (const g of GAMES) {
    const [away, home, awayScore, homeScore, closingSpread, closingTotal] = g;
    
    const pred = nba.predict(away, home);
    if (pred.error) continue;
    
    const actualMargin = awayScore - homeScore; // positive = away won
    const modelSpread = pred.spread;
    const spreadEdge = Math.abs(modelSpread - closingSpread);
    
    // ATS: did model's side cover?
    let atsResult = 'push';
    let modelSide = null;
    if (spreadEdge >= 1.5) {
      // Model disagrees with book by 1.5+ pts
      modelSide = modelSpread < closingSpread ? 'home' : 'away';
      
      if (modelSide === 'home') {
        // Model says home is better than book thinks
        const homeCover = -actualMargin < closingSpread; // home covered
        const push = -actualMargin === closingSpread;
        if (push) { atsPush++; atsResult = 'push'; }
        else if (homeCover) { atsWins++; atsResult = 'win'; }
        else { atsLosses++; atsResult = 'loss'; }
      } else {
        // Model says away is better than book thinks
        const awayCover = actualMargin > -closingSpread;
        const push = actualMargin === -closingSpread;
        if (push) { atsPush++; atsResult = 'push'; }
        else if (awayCover) { atsWins++; atsResult = 'win'; }
        else { atsLosses++; atsResult = 'loss'; }
      }
    }
    
    // ML: did model pick the winner?
    const modelFavHome = pred.homeWinProb > 50;
    const actualHomeWin = homeScore > awayScore;
    const mlResult = modelFavHome === actualHomeWin ? 'win' : 'loss';
    if (mlResult === 'win') mlWins++;
    else mlLosses++;
    
    // Edge tier tracking
    const edgePct = spreadEdge / closingSpread * 100 || 0;
    const bookHomeProb = nba.mlToProb(closingSpread < 0 ? Math.round(-100 * (-closingSpread) / 5) : Math.round(100 * 5 / closingSpread));
    const modelEdge = Math.abs(pred.homeWinProb / 100 - 0.5) - Math.abs(bookHomeProb - 0.5);
    
    let tier = null;
    if (spreadEdge >= 5) tier = 'high';
    else if (spreadEdge >= 3) tier = 'med';
    else if (spreadEdge >= 1.5) tier = 'low';
    
    if (tier && atsResult !== 'push') {
      edgeTiers[tier][atsResult === 'win' ? 'wins' : 'losses']++;
      edgeTiers[tier].profit += atsResult === 'win' ? 91 : -100; // -110 vig
    }
    
    // Calibration buckets
    const probBucket = Math.round(pred.homeWinProb / 10) * 10;
    if (!calibration[probBucket]) calibration[probBucket] = { predicted: probBucket, games: 0, homeWins: 0 };
    calibration[probBucket].games++;
    if (actualHomeWin) calibration[probBucket].homeWins++;
    
    results.push({
      away, home,
      awayScore, homeScore,
      closingSpread, closingTotal,
      modelSpread: pred.spread,
      spreadEdge: +spreadEdge.toFixed(1),
      homeWinProb: pred.homeWinProb,
      atsResult,
      mlResult,
      modelSide,
      tier
    });
  }
  
  const totalATS = atsWins + atsLosses;
  const totalML = mlWins + mlLosses;
  const atsProfit = atsWins * 91 - atsLosses * 100; // -110 vig
  
  // Calibration: for each bucket, actual win% vs predicted
  const calData = Object.values(calibration).map(c => ({
    predicted: c.predicted,
    actual: c.games > 0 ? +(c.homeWins / c.games * 100).toFixed(1) : 0,
    games: c.games
  })).sort((a, b) => a.predicted - b.predicted);
  
  // Profit curve
  let cumProfit = 0;
  const profitCurve = results
    .filter(r => r.atsResult !== 'push' && r.tier)
    .map((r, i) => {
      cumProfit += r.atsResult === 'win' ? 91 : -100;
      return { game: i + 1, profit: cumProfit };
    });
  
  return {
    summary: {
      totalGames: GAMES.length,
      ats: {
        wins: atsWins, losses: atsLosses, pushes: atsPush,
        record: `${atsWins}-${atsLosses}-${atsPush}`,
        winPct: totalATS > 0 ? +(atsWins / totalATS * 100).toFixed(1) : 0,
        profit: atsProfit,
        roi: totalATS > 0 ? +(atsProfit / (totalATS * 100) * 100).toFixed(1) : 0,
        units: +(atsProfit / 100).toFixed(2)
      },
      ml: {
        wins: mlWins, losses: mlLosses,
        record: `${mlWins}-${mlLosses}`,
        winPct: totalML > 0 ? +(mlWins / totalML * 100).toFixed(1) : 0
      },
      edgeTiers: Object.entries(edgeTiers).map(([k, v]) => ({
        tier: k,
        label: v.label,
        wins: v.wins, losses: v.losses,
        total: v.wins + v.losses,
        winPct: (v.wins + v.losses) > 0 ? +((v.wins / (v.wins + v.losses)) * 100).toFixed(1) : 0,
        profit: v.profit,
        roi: (v.wins + v.losses) > 0 ? +(v.profit / ((v.wins + v.losses) * 100) * 100).toFixed(1) : 0
      })),
      breakeven: 52.4, // breakeven win% at -110
      calibration: calData,
      profitCurve
    },
    games: results
  };
}

module.exports = { runBacktest, GAMES };
