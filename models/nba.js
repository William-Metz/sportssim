/**
 * SportsSim NBA Model
 * 
 * Pythagorean-based power ratings with luck adjustment,
 * rolling momentum, and logistic win probability.
 * 
 * Math:
 *   Pyth W% = PPG^13.91 / (PPG^13.91 + OppPPG^13.91)
 *   Luck = Actual W% - Pythagorean W%
 *   Power = PointDiff * (1 - luck_penalty) + momentum_bonus
 *   Win Prob = 1 / (1 + 10^(-(spread)/~7.5))
 *   Spread = (away_power - home_power) + HCA
 */

const HCA = 3.2; // home court advantage in points
const PYTH_EXP = 13.91; // Morey exponent for NBA
const LUCK_PENALTY_FACTOR = 0.6; // how much to discount lucky teams
const MOMENTUM_WEIGHT = 0.15; // weight for L10 momentum
const SPREAD_TO_PROB_FACTOR = 7.5; // logistic scaling

// Live data integration
let liveData = null;
try { liveData = require('../services/live-data'); } catch (e) { /* fallback to static */ }

/**
 * Get current team data — live if available, static fallback
 */
function getTeams() {
  if (liveData) {
    const live = liveData.getNBAData();
    if (live && Object.keys(live).length >= 25) {
      // Merge live data into static format
      const merged = {};
      for (const [abbr, t] of Object.entries(live)) {
        if (STATIC_TEAMS[abbr]) {
          merged[abbr] = {
            ...STATIC_TEAMS[abbr], // keep any static-only fields
            name: t.name,
            w: t.w,
            l: t.l,
            ppg: t.ppg,
            oppg: t.oppg,
            diff: t.diff,
            l10: t.l10
          };
        } else {
          // New team not in static data
          merged[abbr] = { name: t.name, w: t.w, l: t.l, ppg: t.ppg, oppg: t.oppg, diff: t.diff, l10: t.l10 };
        }
      }
      return merged;
    }
  }
  return STATIC_TEAMS;
}

async function refreshData() {
  if (liveData) {
    await liveData.refreshAll(true);
  }
}

// Static fallback data (2025-26 NBA stats, snapshot)
const STATIC_TEAMS = {
  ATL: { name:'Atlanta Hawks', w:35, l:34, ppg:117.8, oppg:117.3, diff:0.5, l10:'6-4' },
  BOS: { name:'Boston Celtics', w:45, l:23, ppg:114.3, oppg:107.1, diff:7.2, l10:'7-3' },
  BKN: { name:'Brooklyn Nets', w:17, l:51, ppg:106.6, oppg:115.2, diff:-8.6, l10:'2-8' },
  CHA: { name:'Charlotte Hornets', w:22, l:44, ppg:107.8, oppg:113.5, diff:-5.7, l10:'3-7' },
  CHI: { name:'Chicago Bulls', w:28, l:40, ppg:116.0, oppg:120.0, diff:-4.0, l10:'4-6' },
  CLE: { name:'Cleveland Cavaliers', w:52, l:14, ppg:117.2, oppg:107.8, diff:9.4, l10:'8-2' },
  DAL: { name:'Dallas Mavericks', w:38, l:29, ppg:114.7, oppg:112.2, diff:2.5, l10:'5-5' },
  DEN: { name:'Denver Nuggets', w:42, l:26, ppg:115.4, oppg:111.0, diff:4.4, l10:'6-4' },
  DET: { name:'Detroit Pistons', w:39, l:28, ppg:112.8, oppg:109.0, diff:3.8, l10:'7-3' },
  GSW: { name:'Golden State Warriors', w:33, l:35, ppg:115.3, oppg:114.4, diff:0.9, l10:'3-7' },
  HOU: { name:'Houston Rockets', w:42, l:25, ppg:111.9, oppg:106.8, diff:5.1, l10:'6-4' },
  IND: { name:'Indiana Pacers', w:34, l:34, ppg:116.8, oppg:116.1, diff:0.7, l10:'4-6' },
  LAC: { name:'LA Clippers', w:30, l:37, ppg:108.2, oppg:110.8, diff:-2.6, l10:'5-5' },
  LAL: { name:'Los Angeles Lakers', w:43, l:25, ppg:116.3, oppg:114.9, diff:1.4, l10:'5-5' },
  MEM: { name:'Memphis Grizzlies', w:40, l:27, ppg:118.6, oppg:112.8, diff:5.8, l10:'7-3' },
  MIA: { name:'Miami Heat', w:30, l:36, ppg:108.5, oppg:109.5, diff:-1.0, l10:'4-6' },
  MIL: { name:'Milwaukee Bucks', w:36, l:32, ppg:113.5, oppg:111.8, diff:1.7, l10:'5-5' },
  MIN: { name:'Minnesota Timberwolves', w:36, l:32, ppg:109.3, oppg:108.4, diff:0.9, l10:'5-5' },
  NOP: { name:'New Orleans Pelicans', w:20, l:48, ppg:107.5, oppg:114.9, diff:-7.4, l10:'2-8' },
  NYK: { name:'New York Knicks', w:43, l:25, ppg:114.5, oppg:109.5, diff:5.0, l10:'6-4' },
  OKC: { name:'Oklahoma City Thunder', w:54, l:15, ppg:118.4, oppg:107.7, diff:10.7, l10:'9-1' },
  ORL: { name:'Orlando Magic', w:33, l:35, ppg:106.2, oppg:105.1, diff:1.1, l10:'5-5' },
  PHI: { name:'Philadelphia 76ers', w:26, l:40, ppg:110.6, oppg:113.9, diff:-3.3, l10:'3-7' },
  PHX: { name:'Phoenix Suns', w:36, l:32, ppg:113.2, oppg:112.8, diff:0.4, l10:'4-6' },
  POR: { name:'Portland Trail Blazers', w:22, l:45, ppg:107.6, oppg:113.6, diff:-6.0, l10:'2-8' },
  SAC: { name:'Sacramento Kings', w:37, l:31, ppg:114.0, oppg:112.6, diff:1.4, l10:'5-5' },
  SAS: { name:'San Antonio Spurs', w:32, l:36, ppg:111.5, oppg:112.5, diff:-1.0, l10:'4-6' },
  TOR: { name:'Toronto Raptors', w:26, l:42, ppg:113.6, oppg:117.7, diff:-4.1, l10:'4-6' },
  UTA: { name:'Utah Jazz', w:24, l:44, ppg:110.5, oppg:115.0, diff:-4.5, l10:'3-7' },
  WAS: { name:'Washington Wizards', w:15, l:54, ppg:107.2, oppg:118.5, diff:-11.3, l10:'1-9' }
};

// TEAMS is a dynamic getter — returns live data when available
const TEAMS = new Proxy({}, {
  get(target, prop) { return getTeams()[prop]; },
  ownKeys() { return Object.keys(getTeams()); },
  has(target, prop) { return prop in getTeams(); },
  getOwnPropertyDescriptor(target, prop) {
    const teams = getTeams();
    if (prop in teams) return { configurable: true, enumerable: true, value: teams[prop] };
    return undefined;
  }
});

/**
 * Pythagorean Win Expectation
 * Formula: PPG^exp / (PPG^exp + OppPPG^exp)
 */
function pythWinPct(ppg, oppg) {
  const pf = Math.pow(ppg, PYTH_EXP);
  const pa = Math.pow(oppg, PYTH_EXP);
  return pf / (pf + pa);
}

/**
 * Parse L10 record to win fraction
 */
function parseL10(l10str) {
  const m = l10str.match(/(\d+)-(\d+)/);
  if (!m) return 0.5;
  return parseInt(m[1]) / (parseInt(m[1]) + parseInt(m[2]));
}

/**
 * Calculate power ratings for all teams
 */
function calculateRatings() {
  const ratings = {};
  for (const [abbr, t] of Object.entries(TEAMS)) {
    const gp = t.w + t.l;
    const actualWpct = t.w / gp;
    const pythWpct = pythWinPct(t.ppg, t.oppg);
    const luck = actualWpct - pythWpct;
    const l10wpct = parseL10(t.l10);
    const momentum = (l10wpct - 0.5) * MOMENTUM_WEIGHT * 10; // scale to ~pts
    
    // Core power = point differential, discounted by luck
    const luckPenalty = luck * LUCK_PENALTY_FACTOR * 10; // scale to pts
    const power = t.diff - luckPenalty + momentum;
    
    ratings[abbr] = {
      abbr,
      name: t.name,
      w: t.w, l: t.l,
      ppg: t.ppg, oppg: t.oppg, diff: t.diff,
      l10: t.l10,
      actualWpct: +(actualWpct * 100).toFixed(1),
      pythWpct: +(pythWpct * 100).toFixed(1),
      luck: +(luck * 100).toFixed(1),
      momentum: +momentum.toFixed(2),
      power: +power.toFixed(2),
      tier: power >= 7 ? 'ELITE' : power >= 3 ? 'GOOD' : power >= 0 ? 'AVERAGE' : power >= -4 ? 'BELOW AVG' : 'POOR'
    };
  }
  
  // Sort by power desc
  const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
  sorted.forEach((r, i) => { r.rank = i + 1; ratings[r.abbr].rank = i + 1; });
  return ratings;
}

/**
 * Predict game outcome
 * 
 * @param {string} away - team abbreviation
 * @param {string} home - team abbreviation
 * @param {object} opts - { awayB2B, homeB2B, awayRest, homeRest }
 * @returns {object} prediction
 */
function predict(away, home, opts = {}) {
  const ratings = calculateRatings();
  const aw = ratings[away];
  const hm = ratings[home];
  if (!aw || !hm) return { error: 'Unknown team' };
  
  // Rest adjustments (in points)
  let restAdj = 0;
  if (opts.awayB2B) restAdj += 1.5;  // away on B2B = disadvantage
  if (opts.homeB2B) restAdj -= 1.5;  // home on B2B = disadvantage for home
  if (opts.awayRest === '3in4') restAdj += 1.0;
  if (opts.homeRest === '3in4') restAdj -= 1.0;
  
  // Predicted spread (negative = home favored)
  // spread = away_power - home_power - HCA + restAdj
  const rawSpread = aw.power - hm.power - HCA + restAdj;
  const spread = +rawSpread.toFixed(1);
  
  // Win probability via logistic function
  // P(home) = 1 / (1 + 10^(spread / SPREAD_TO_PROB_FACTOR))
  const homeWinProb = 1 / (1 + Math.pow(10, spread / SPREAD_TO_PROB_FACTOR));
  const awayWinProb = 1 - homeWinProb;
  
  // Expected total
  const expectedTotal = +((aw.ppg + hm.ppg) / 2 + (aw.oppg + hm.oppg) / 2).toFixed(1);
  // Adjust: if both teams are offensive, boost; if defensive, lower
  const paceAdj = ((aw.ppg - 112) + (hm.ppg - 112)) * 0.3;
  const adjTotal = +(expectedTotal / 2 + paceAdj).toFixed(1);
  
  // Predicted scores
  const homeScore = +((adjTotal / 2) + (-spread / 2)).toFixed(1);
  const awayScore = +((adjTotal / 2) + (spread / 2)).toFixed(1);
  
  // Model-implied moneylines
  const homeML = homeWinProb >= 0.5 
    ? Math.round(-100 * homeWinProb / (1 - homeWinProb))
    : Math.round(100 * (1 - homeWinProb) / homeWinProb);
  const awayML = awayWinProb >= 0.5
    ? Math.round(-100 * awayWinProb / (1 - awayWinProb))
    : Math.round(100 * (1 - awayWinProb) / awayWinProb);
  
  return {
    away: { abbr: away, name: aw.name, power: aw.power, rank: aw.rank },
    home: { abbr: home, name: hm.name, power: hm.power, rank: hm.rank },
    spread,
    homeWinProb: +(homeWinProb * 100).toFixed(1),
    awayWinProb: +(awayWinProb * 100).toFixed(1),
    predictedTotal: adjTotal,
    predictedScore: { away: awayScore, home: homeScore },
    modelML: { away: awayML > 0 ? '+' + awayML : '' + awayML, home: homeML > 0 ? '+' + homeML : '' + homeML },
    factors: {
      powerDiff: +(aw.power - hm.power).toFixed(2),
      hca: HCA,
      restAdj,
      awayLuck: aw.luck,
      homeLuck: hm.luck
    }
  };
}

/**
 * Compare model prediction vs book lines to find +EV
 * 
 * @param {object} prediction - from predict()
 * @param {object} bookLine - { spread, total, homeML, awayML }
 * @returns {object} value analysis
 */
function findValue(prediction, bookLine) {
  const edges = [];
  
  // Spread edge
  if (bookLine.spread !== undefined) {
    const modelSpread = prediction.spread;
    const bookSpread = bookLine.spread; // negative = home favored
    const spreadEdge = Math.abs(modelSpread - bookSpread);
    
    if (spreadEdge >= 1.5) {
      const side = modelSpread < bookSpread ? prediction.home.abbr : prediction.away.abbr;
      const sideLabel = modelSpread < bookSpread 
        ? `${prediction.home.abbr} ${bookSpread > 0 ? '+' : ''}${bookSpread}`
        : `${prediction.away.abbr} ${(-bookSpread) > 0 ? '+' : ''}${-bookSpread}`;
      edges.push({
        type: 'spread',
        pick: sideLabel,
        modelLine: modelSpread,
        bookLine: bookSpread,
        edge: +spreadEdge.toFixed(1),
        confidence: spreadEdge >= 5 ? 'HIGH' : spreadEdge >= 3 ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  // Moneyline edge
  if (bookLine.homeML !== undefined && bookLine.awayML !== undefined) {
    const bookHomeProb = mlToProb(bookLine.homeML);
    const bookAwayProb = mlToProb(bookLine.awayML);
    const modelHomeProb = prediction.homeWinProb / 100;
    const modelAwayProb = prediction.awayWinProb / 100;
    
    const homeEdge = modelHomeProb - bookHomeProb;
    const awayEdge = modelAwayProb - bookAwayProb;
    
    if (homeEdge > 0.03) {
      const ev = calcEV(modelHomeProb, bookLine.homeML);
      edges.push({
        type: 'moneyline',
        pick: `${prediction.home.abbr} ML (${bookLine.homeML > 0 ? '+' : ''}${bookLine.homeML})`,
        modelProb: +(modelHomeProb * 100).toFixed(1),
        bookProb: +(bookHomeProb * 100).toFixed(1),
        edge: +(homeEdge * 100).toFixed(1),
        ev: +ev.toFixed(2),
        kelly: kellySize(modelHomeProb, bookLine.homeML),
        confidence: homeEdge >= 0.08 ? 'HIGH' : homeEdge >= 0.05 ? 'MEDIUM' : 'LOW'
      });
    }
    if (awayEdge > 0.03) {
      const ev = calcEV(modelAwayProb, bookLine.awayML);
      edges.push({
        type: 'moneyline',
        pick: `${prediction.away.abbr} ML (${bookLine.awayML > 0 ? '+' : ''}${bookLine.awayML})`,
        modelProb: +(modelAwayProb * 100).toFixed(1),
        bookProb: +(bookAwayProb * 100).toFixed(1),
        edge: +(awayEdge * 100).toFixed(1),
        ev: +ev.toFixed(2),
        kelly: kellySize(modelAwayProb, bookLine.awayML),
        confidence: awayEdge >= 0.08 ? 'HIGH' : awayEdge >= 0.05 ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  // Total edge
  if (bookLine.total !== undefined) {
    const modelTotal = prediction.predictedTotal;
    const totalEdge = Math.abs(modelTotal - bookLine.total);
    if (totalEdge >= 3) {
      edges.push({
        type: 'total',
        pick: modelTotal > bookLine.total ? `OVER ${bookLine.total}` : `UNDER ${bookLine.total}`,
        modelTotal,
        bookTotal: bookLine.total,
        edge: +totalEdge.toFixed(1),
        confidence: totalEdge >= 7 ? 'HIGH' : totalEdge >= 5 ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  return edges.sort((a, b) => b.edge - a.edge);
}

/**
 * Convert American moneyline to implied probability
 */
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

/**
 * Calculate expected value per $100 bet
 */
function calcEV(trueProb, ml) {
  const payout = ml > 0 ? ml : (100 / (-ml)) * 100;
  return (trueProb * payout) - ((1 - trueProb) * 100);
}

/**
 * Kelly Criterion bet sizing
 * Returns { full, half, quarter } as fraction of bankroll
 */
function kellySize(trueProb, ml) {
  const decimalOdds = ml > 0 ? (ml / 100) + 1 : (100 / (-ml)) + 1;
  const b = decimalOdds - 1;
  const q = 1 - trueProb;
  const kelly = (b * trueProb - q) / b;
  const k = Math.max(0, kelly);
  return {
    full: +(k * 100).toFixed(2),
    half: +(k * 50).toFixed(2),
    quarter: +(k * 25).toFixed(2)
  };
}

module.exports = { TEAMS, getTeams, calculateRatings, predict, findValue, mlToProb, calcEV, kellySize, pythWinPct, HCA, PYTH_EXP, refreshData };
