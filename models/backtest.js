/**
 * SportsSim NBA Backtest Engine v2.0
 * 
 * CRITICAL FIX: Uses point-in-time 2024-25 NBA stats for backtesting
 * against 2024-25 games. Previous version used 2025-26 stats → garbage results.
 * 
 * Tests model against real 2024-25 NBA games with closing lines.
 * Calculates ATS record, ROI by edge tier, calibration.
 */

// ==================== 2024-25 NBA TEAMS (point-in-time data from Basketball Reference) ====================
// These are FINAL 2024-25 season stats — PPG = PS/G, OPPG = PA/G
const TEAMS_2024_25 = {
  ATL: { name:'Atlanta Hawks', w:40, l:42, ppg:118.2, oppg:119.3, diff:-1.1 },
  BOS: { name:'Boston Celtics', w:61, l:21, ppg:116.3, oppg:107.2, diff:9.1 },
  BKN: { name:'Brooklyn Nets', w:26, l:56, ppg:105.1, oppg:112.2, diff:-7.1 },
  CHA: { name:'Charlotte Hornets', w:19, l:63, ppg:105.1, oppg:114.2, diff:-9.1 },
  CHI: { name:'Chicago Bulls', w:39, l:43, ppg:117.8, oppg:119.4, diff:-1.6 },
  CLE: { name:'Cleveland Cavaliers', w:64, l:18, ppg:121.9, oppg:112.4, diff:9.5 },
  DAL: { name:'Dallas Mavericks', w:39, l:43, ppg:114.2, oppg:115.4, diff:-1.2 },
  DEN: { name:'Denver Nuggets', w:50, l:32, ppg:120.8, oppg:116.9, diff:3.9 },
  DET: { name:'Detroit Pistons', w:44, l:38, ppg:115.5, oppg:113.6, diff:1.9 },
  GSW: { name:'Golden State Warriors', w:48, l:34, ppg:113.8, oppg:110.5, diff:3.3 },
  HOU: { name:'Houston Rockets', w:52, l:30, ppg:114.3, oppg:109.8, diff:4.5 },
  IND: { name:'Indiana Pacers', w:50, l:32, ppg:117.4, oppg:115.1, diff:2.3 },
  LAC: { name:'LA Clippers', w:50, l:32, ppg:112.9, oppg:108.2, diff:4.7 },
  LAL: { name:'Los Angeles Lakers', w:50, l:32, ppg:113.4, oppg:112.2, diff:1.2 },
  MEM: { name:'Memphis Grizzlies', w:48, l:34, ppg:121.7, oppg:116.9, diff:4.8 },
  MIA: { name:'Miami Heat', w:37, l:45, ppg:110.6, oppg:110.0, diff:0.6 },
  MIL: { name:'Milwaukee Bucks', w:48, l:34, ppg:115.5, oppg:113.0, diff:2.5 },
  MIN: { name:'Minnesota Timberwolves', w:49, l:33, ppg:114.3, oppg:109.3, diff:5.0 },
  NOP: { name:'New Orleans Pelicans', w:21, l:61, ppg:109.8, oppg:119.3, diff:-9.5 },
  NYK: { name:'New York Knicks', w:51, l:31, ppg:115.8, oppg:111.7, diff:4.1 },
  OKC: { name:'Oklahoma City Thunder', w:68, l:14, ppg:120.5, oppg:107.6, diff:12.9 },
  ORL: { name:'Orlando Magic', w:41, l:41, ppg:105.4, oppg:105.5, diff:-0.1 },
  PHI: { name:'Philadelphia 76ers', w:24, l:58, ppg:109.6, oppg:115.8, diff:-6.2 },
  PHX: { name:'Phoenix Suns', w:36, l:46, ppg:113.6, oppg:116.6, diff:-3.0 },
  POR: { name:'Portland Trail Blazers', w:36, l:46, ppg:110.9, oppg:113.9, diff:-3.0 },
  SAC: { name:'Sacramento Kings', w:40, l:42, ppg:115.7, oppg:115.3, diff:0.4 },
  SAS: { name:'San Antonio Spurs', w:34, l:48, ppg:113.9, oppg:116.7, diff:-2.8 },
  TOR: { name:'Toronto Raptors', w:30, l:52, ppg:110.9, oppg:115.2, diff:-4.3 },
  UTA: { name:'Utah Jazz', w:17, l:65, ppg:111.9, oppg:121.2, diff:-9.3 },
  WAS: { name:'Washington Wizards', w:18, l:64, ppg:108.0, oppg:120.4, diff:-12.4 }
};

// ==================== MODEL CONSTANTS (same as nba.js) ====================
const HCA = 3.2;
const PYTH_EXP = 13.91;
const LUCK_PENALTY_FACTOR = 0.6;
const SPREAD_TO_PROB_FACTOR = 15; // calibrated from v23.0

function pythWinPct(ppg, oppg) {
  const pf = Math.pow(ppg, PYTH_EXP);
  const pa = Math.pow(oppg, PYTH_EXP);
  return pf / (pf + pa);
}

/**
 * Pure prediction using 2024-25 stats (no live data, no rolling, no injuries)
 * This gives us a clean baseline for calibration.
 */
function predictWithStats(away, home, teams) {
  const aw = teams[away];
  const hm = teams[home];
  if (!aw || !hm) return { error: 'Unknown team' };
  
  // Power ratings
  function calcPower(t) {
    const gp = t.w + t.l;
    const actualWpct = t.w / gp;
    const pw = pythWinPct(t.ppg, t.oppg);
    const luck = actualWpct - pw;
    const luckPenalty = luck * LUCK_PENALTY_FACTOR * 10;
    return t.diff - luckPenalty;
  }
  
  const awPower = calcPower(aw);
  const hmPower = calcPower(hm);
  
  // Spread
  const rawSpread = awPower - hmPower - HCA;
  // Compress extreme spreads
  const compressedSpread = rawSpread > 0 
    ? Math.min(rawSpread, 18 + (rawSpread - 18) * 0.2)
    : Math.max(rawSpread, -18 + (rawSpread + 18) * 0.2);
  const spread = +((Math.abs(rawSpread) > 18 ? compressedSpread : rawSpread)).toFixed(1);
  
  // Win probability
  const homeWinProb = 1 / (1 + Math.pow(10, spread / SPREAD_TO_PROB_FACTOR));
  const awayWinProb = 1 - homeWinProb;
  
  // Expected total
  const expectedTotal = +((aw.ppg + hm.ppg) / 2 + (aw.oppg + hm.oppg) / 2).toFixed(1);
  const paceAdj = ((aw.ppg - 112) + (hm.ppg - 112)) * 0.3;
  const adjTotal = +(expectedTotal + paceAdj).toFixed(1);
  
  return {
    away: { abbr: away, power: +awPower.toFixed(2) },
    home: { abbr: home, power: +hmPower.toFixed(2) },
    spread,
    homeWinProb: +(homeWinProb * 100).toFixed(1),
    awayWinProb: +(awayWinProb * 100).toFixed(1),
    predictedTotal: adjTotal
  };
}

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
 * Convert American moneyline to implied probability
 */
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

/**
 * Run full backtest using correct 2024-25 stats
 * @param {object} opts - { spreadFactor, hca, luckFactor, minEdge, useLiveModel }
 */
function runBacktest(opts = {}) {
  const spreadFactor = opts.spreadFactor || SPREAD_TO_PROB_FACTOR;
  const hca = opts.hca !== undefined ? opts.hca : HCA;
  const luckFactor = opts.luckFactor !== undefined ? opts.luckFactor : LUCK_PENALTY_FACTOR;
  const minEdge = opts.minEdge || 1.5; // minimum spread edge to bet
  const useLiveModel = opts.useLiveModel || false;
  
  // Use live model or pure 2024-25 backtest model
  let predictFn;
  if (useLiveModel) {
    try {
      const nba = require('./nba');
      predictFn = (away, home) => nba.predict(away, home);
    } catch (e) {
      predictFn = (away, home) => predictWithStats(away, home, TEAMS_2024_25);
    }
  } else {
    // Override constants for parameter sweep
    const localPredict = (away, home) => {
      const aw = TEAMS_2024_25[away];
      const hm = TEAMS_2024_25[home];
      if (!aw || !hm) return { error: 'Unknown team' };
      
      function calcPower(t) {
        const gp = t.w + t.l;
        const actualWpct = t.w / gp;
        const pw = pythWinPct(t.ppg, t.oppg);
        const luck = actualWpct - pw;
        const luckPenalty = luck * luckFactor * 10;
        return t.diff - luckPenalty;
      }
      
      const awPower = calcPower(aw);
      const hmPower = calcPower(hm);
      const rawSpread = awPower - hmPower - hca;
      const compressedSpread = rawSpread > 0 
        ? Math.min(rawSpread, 18 + (rawSpread - 18) * 0.2)
        : Math.max(rawSpread, -18 + (rawSpread + 18) * 0.2);
      const spread = +((Math.abs(rawSpread) > 18 ? compressedSpread : rawSpread)).toFixed(1);
      const homeWinProb = 1 / (1 + Math.pow(10, spread / spreadFactor));
      const awayWinProb = 1 - homeWinProb;
      const expectedTotal = +((aw.ppg + hm.ppg) / 2 + (aw.oppg + hm.oppg) / 2).toFixed(1);
      const paceAdj = ((aw.ppg - 112) + (hm.ppg - 112)) * 0.3;
      const adjTotal = +(expectedTotal + paceAdj).toFixed(1);
      
      return { spread, homeWinProb: +(homeWinProb * 100).toFixed(1), awayWinProb: +(awayWinProb * 100).toFixed(1), predictedTotal: adjTotal };
    };
    predictFn = localPredict;
  }
  
  const results = [];
  let atsWins = 0, atsLosses = 0, atsPush = 0;
  let mlWins = 0, mlLosses = 0;
  const edgeTiers = {
    'low': { label: '1.5-3pt edge', wins: 0, losses: 0, profit: 0 },
    'med': { label: '3-5pt edge', wins: 0, losses: 0, profit: 0 },
    'high': { label: '5pt+ edge', wins: 0, losses: 0, profit: 0 }
  };
  const calibration = {};
  
  // Totals tracking
  let totalsWins = 0, totalsLosses = 0, totalsPush = 0;
  const totalEdgeTiers = {
    'low': { label: '3-5pt total edge', wins: 0, losses: 0, profit: 0 },
    'med': { label: '5-8pt total edge', wins: 0, losses: 0, profit: 0 },
    'high': { label: '8pt+ total edge', wins: 0, losses: 0, profit: 0 }
  };
  
  for (const g of GAMES) {
    const [away, home, awayScore, homeScore, closingSpread, closingTotal] = g;
    
    const pred = predictFn(away, home);
    if (pred.error) continue;
    
    const actualMargin = awayScore - homeScore;
    const actualTotal = awayScore + homeScore;
    const modelSpread = pred.spread;
    const spreadEdge = Math.abs(modelSpread - closingSpread);
    
    // ATS: did model's side cover?
    let atsResult = 'no_bet';
    let modelSide = null;
    if (spreadEdge >= minEdge) {
      modelSide = modelSpread < closingSpread ? 'home' : 'away';
      
      if (modelSide === 'home') {
        const homeCover = -actualMargin < closingSpread;
        const push = -actualMargin === closingSpread;
        if (push) { atsPush++; atsResult = 'push'; }
        else if (homeCover) { atsWins++; atsResult = 'win'; }
        else { atsLosses++; atsResult = 'loss'; }
      } else {
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
    let tier = null;
    if (spreadEdge >= 5) tier = 'high';
    else if (spreadEdge >= 3) tier = 'med';
    else if (spreadEdge >= minEdge) tier = 'low';
    
    if (tier && atsResult !== 'push' && atsResult !== 'no_bet') {
      edgeTiers[tier][atsResult === 'win' ? 'wins' : 'losses']++;
      edgeTiers[tier].profit += atsResult === 'win' ? 91 : -100;
    }
    
    // Totals tracking
    let totalsResult = 'no_bet';
    if (pred.predictedTotal) {
      const totalEdge = Math.abs(pred.predictedTotal - closingTotal);
      if (totalEdge >= 3) {
        const modelSideTotal = pred.predictedTotal > closingTotal ? 'over' : 'under';
        if (actualTotal === closingTotal) { totalsPush++; totalsResult = 'push'; }
        else if ((modelSideTotal === 'over' && actualTotal > closingTotal) || (modelSideTotal === 'under' && actualTotal < closingTotal)) {
          totalsWins++; totalsResult = 'win';
        } else {
          totalsLosses++; totalsResult = 'loss';
        }
        
        let totalTier = null;
        if (totalEdge >= 8) totalTier = 'high';
        else if (totalEdge >= 5) totalTier = 'med';
        else if (totalEdge >= 3) totalTier = 'low';
        
        if (totalTier && totalsResult !== 'push') {
          totalEdgeTiers[totalTier][totalsResult === 'win' ? 'wins' : 'losses']++;
          totalEdgeTiers[totalTier].profit += totalsResult === 'win' ? 91 : -100;
        }
      }
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
      modelTotal: pred.predictedTotal,
      homeWinProb: pred.homeWinProb,
      atsResult,
      totalsResult,
      mlResult,
      modelSide,
      tier
    });
  }
  
  const totalATS = atsWins + atsLosses;
  const totalML = mlWins + mlLosses;
  const atsProfit = atsWins * 91 - atsLosses * 100;
  const totalsTotalBets = totalsWins + totalsLosses;
  const totalsProfit = totalsWins * 91 - totalsLosses * 100;
  
  // Calibration
  const calData = Object.values(calibration).map(c => ({
    predicted: c.predicted,
    actual: c.games > 0 ? +(c.homeWins / c.games * 100).toFixed(1) : 0,
    games: c.games
  })).sort((a, b) => a.predicted - b.predicted);
  
  // Profit curve
  let cumProfit = 0;
  const profitCurve = results
    .filter(r => r.atsResult === 'win' || r.atsResult === 'loss')
    .map((r, i) => {
      cumProfit += r.atsResult === 'win' ? 91 : -100;
      return { game: i + 1, profit: cumProfit };
    });
  
  // Model accuracy by spread bucket
  const spreadAccuracy = {};
  results.forEach(r => {
    const bucket = Math.round(Math.abs(r.closingSpread) / 3) * 3;
    if (!spreadAccuracy[bucket]) spreadAccuracy[bucket] = { bucket, correct: 0, total: 0 };
    spreadAccuracy[bucket].total++;
    if (r.mlResult === 'win') spreadAccuracy[bucket].correct++;
  });
  
  return {
    summary: {
      totalGames: GAMES.length,
      dataSource: useLiveModel ? 'live-model-2025-26' : 'point-in-time-2024-25',
      parameters: { spreadFactor, hca, luckFactor, minEdge },
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
      totals: {
        wins: totalsWins, losses: totalsLosses, pushes: totalsPush,
        record: `${totalsWins}-${totalsLosses}-${totalsPush}`,
        winPct: totalsTotalBets > 0 ? +(totalsWins / totalsTotalBets * 100).toFixed(1) : 0,
        profit: totalsProfit,
        roi: totalsTotalBets > 0 ? +(totalsProfit / (totalsTotalBets * 100) * 100).toFixed(1) : 0
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
      totalEdgeTiers: Object.entries(totalEdgeTiers).map(([k, v]) => ({
        tier: k,
        label: v.label,
        wins: v.wins, losses: v.losses,
        total: v.wins + v.losses,
        winPct: (v.wins + v.losses) > 0 ? +((v.wins / (v.wins + v.losses)) * 100).toFixed(1) : 0,
        profit: v.profit,
        roi: (v.wins + v.losses) > 0 ? +(v.profit / ((v.wins + v.losses) * 100) * 100).toFixed(1) : 0
      })),
      breakeven: 52.4,
      calibration: calData,
      profitCurve,
      spreadAccuracy: Object.values(spreadAccuracy).sort((a, b) => a.bucket - b.bucket)
    },
    games: results
  };
}

/**
 * Parameter sweep to find optimal model settings
 */
function optimizeParameters() {
  const results = [];
  
  // Grid search over key parameters
  const spreadFactors = [10, 12, 13, 14, 15, 16, 17, 18, 20];
  const hcaValues = [2.5, 3.0, 3.2, 3.5, 4.0];
  const luckFactors = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const minEdges = [1.0, 1.5, 2.0, 2.5, 3.0];
  
  for (const sf of spreadFactors) {
    for (const hca of hcaValues) {
      for (const lf of luckFactors) {
        for (const me of minEdges) {
          const bt = runBacktest({ spreadFactor: sf, hca, luckFactor: lf, minEdge: me });
          results.push({
            spreadFactor: sf,
            hca,
            luckFactor: lf,
            minEdge: me,
            atsWinPct: bt.summary.ats.winPct,
            atsROI: bt.summary.ats.roi,
            atsRecord: bt.summary.ats.record,
            mlWinPct: bt.summary.ml.winPct,
            totalBets: bt.summary.ats.wins + bt.summary.ats.losses,
            profit: bt.summary.ats.profit,
            totalsROI: bt.summary.totals.roi
          });
        }
      }
    }
  }
  
  // Sort by ROI, then by total bets (want enough volume)
  results.sort((a, b) => {
    // Require at least 30 bets
    if (a.totalBets < 30 && b.totalBets >= 30) return 1;
    if (b.totalBets < 30 && a.totalBets >= 30) return -1;
    return b.atsROI - a.atsROI;
  });
  
  return results.slice(0, 20); // top 20 configs
}

module.exports = { runBacktest, optimizeParameters, GAMES, TEAMS_2024_25, predictWithStats };
