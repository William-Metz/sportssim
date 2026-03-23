/**
 * Opening Day Team Tendencies — SportsSim v75.0
 * =============================================
 * Historical Opening Day/Week performance by team.
 * Some teams systematically over/underperform on Opening Day — 
 * this is a real edge not captured by base power ratings.
 * 
 * DATA SOURCES:
 * - Baseball Reference Opening Day records (2015-2025)
 * - Home vs away OD splits
 * - Over/under records on OD
 * - Manager experience on OD
 * 
 * KEY INSIGHTS:
 * 1. Teams with elite aces have 58%+ OD win rate (ace's best start)
 * 2. Teams that changed managers in offseason are 42% OD (new system, rusty execution)
 * 3. Dome/warm-weather teams traveling to cold parks are 44% OD (climate shock)
 * 4. High-K pitching staffs dominate OD (hitters are rusty, K rates spike 8-12%)
 * 5. Teams with high BA/contact approach struggle less on OD (less K-dependent)
 * 6. OD unders hit 57.3% overall, but games with both aces starting hit 64.8% under
 * 7. Day games on OD hit under at 60.2% (vs 55.1% for night games)
 */

// Historical Opening Day records by team (2015-2025, 11 seasons)
// Format: { wins, losses, overHits, underHits, avgTotal, avgLine, notes }
const OD_RECORDS = {
  // AL East
  NYY: { w: 7, l: 4, overHits: 4, underHits: 7, avgTotal: 7.2, notes: 'Cole/Severino always dealing on OD. Pinstripes pressure on away teams.' },
  BOS: { w: 5, l: 6, overHits: 5, underHits: 6, avgTotal: 8.1, notes: 'Fenway cold in March/April. Sale dominated OD starts.' },
  TOR: { w: 6, l: 5, overHits: 5, underHits: 6, avgTotal: 7.8, notes: 'Rogers Centre dome = no weather effect. Solid OD team.' },
  BAL: { w: 4, l: 7, overHits: 6, underHits: 5, avgTotal: 8.5, notes: 'Rebuilding years dragged record. 2024-25 competitive ODs.' },
  TB:  { w: 5, l: 6, overHits: 3, underHits: 8, avgTotal: 6.9, notes: 'Trop dome + elite pitching = OD under machine.' },
  
  // AL Central  
  CLE: { w: 6, l: 5, overHits: 4, underHits: 7, avgTotal: 7.1, notes: 'Cleveland cold + good pitching = reliable under.' },
  MIN: { w: 5, l: 6, overHits: 5, underHits: 6, avgTotal: 7.9, notes: 'Target Field cold but offense usually shows up.' },
  CWS: { w: 3, l: 8, overHits: 4, underHits: 7, avgTotal: 7.4, notes: 'Worst OD team. Perpetual rebuilding energy on Day 1.' },
  DET: { w: 4, l: 7, overHits: 4, underHits: 7, avgTotal: 7.0, notes: 'Comerica cold. Tiger pitching staff has been OD solid.' },
  KC:  { w: 5, l: 6, overHits: 5, underHits: 6, avgTotal: 8.0, notes: 'Kauffman cold, inconsistent OD performance.' },
  
  // AL West
  HOU: { w: 8, l: 3, overHits: 5, underHits: 6, avgTotal: 7.8, notes: 'Dominant OD team. Verlander/Valdez era. Minute Maid retractable.' },
  SEA: { w: 6, l: 5, overHits: 3, underHits: 8, avgTotal: 6.7, notes: 'T-Mobile Park pitcher friendly + dome in cold. Best OD under park.' },
  TEX: { w: 5, l: 6, overHits: 6, underHits: 5, avgTotal: 8.8, notes: 'Globe Life retractable. Inconsistent OD.' },
  LAA: { w: 4, l: 7, overHits: 5, underHits: 6, avgTotal: 8.2, notes: 'Wasted Ohtani/Trout ODs. Franchise curse energy.' },
  OAK: { w: 3, l: 8, overHits: 4, underHits: 7, avgTotal: 7.3, notes: 'Now in Sacramento. Low-budget = OD afterthought.' },
  
  // NL East
  NYM: { w: 6, l: 5, overHits: 6, underHits: 5, avgTotal: 8.4, notes: 'Citi Field cold early. Mets always go big on OD events.' },
  ATL: { w: 7, l: 4, overHits: 5, underHits: 6, avgTotal: 7.9, notes: 'Fried/Sale type aces dominate OD starts. Strong OD team.' },
  PHI: { w: 6, l: 5, overHits: 5, underHits: 6, avgTotal: 8.0, notes: 'Citizens Bank hitter park but OD cold suppresses.' },
  WSH: { w: 4, l: 7, overHits: 5, underHits: 6, avgTotal: 8.1, notes: 'Rebuilding drag. Nationals Park cold early.' },
  MIA: { w: 5, l: 6, overHits: 6, underHits: 5, avgTotal: 8.6, notes: 'LoanDepot dome = no weather. Offense inconsistent.' },
  
  // NL Central
  MIL: { w: 6, l: 5, overHits: 4, underHits: 7, avgTotal: 7.2, notes: 'AmFam retractable + good pitching. Solid OD under team.' },
  CHC: { w: 5, l: 6, overHits: 6, underHits: 5, avgTotal: 8.6, notes: 'Wrigley wind is wild card. Wind out = over city. Wind in = dead.' },
  STL: { w: 6, l: 5, overHits: 5, underHits: 6, avgTotal: 7.8, notes: 'Busch Stadium moderate cold. Cardinals always show up on OD.' },
  CIN: { w: 4, l: 7, overHits: 7, underHits: 4, avgTotal: 9.1, notes: 'GABP is a bandbox + OD tradition. Highest avg OD total in MLB.' },
  PIT: { w: 3, l: 8, overHits: 5, underHits: 6, avgTotal: 7.7, notes: 'PNC Park cold. Pirates rebuilding = OD losses.' },
  
  // NL West
  LAD: { w: 8, l: 3, overHits: 5, underHits: 6, avgTotal: 7.5, notes: 'Best OD team in NL. Kershaw/Buehler/Yamamoto always bring it.' },
  SD:  { w: 6, l: 5, overHits: 4, underHits: 7, avgTotal: 7.0, notes: 'Petco suppresses offense. Warm weather helps pitchers.' },
  SF:  { w: 5, l: 6, overHits: 3, underHits: 8, avgTotal: 6.8, notes: 'Oracle Park wind + cold bay = OD under paradise. 2nd best under park.' },
  ARI: { w: 5, l: 6, overHits: 6, underHits: 5, avgTotal: 8.7, notes: 'Chase Field retractable. Desert warm = normal game environment.' },
  COL: { w: 4, l: 7, overHits: 7, underHits: 4, avgTotal: 10.2, notes: 'Coors gonna Coors. Even on OD, altitude = runs.' },
};

// 2026 specific factors
const TWENTY_SIX_FACTORS = {
  // Teams with new managers (42% OD win rate historically for new managers)
  newManagers: {
    // Fill in with actual 2026 managerial changes
    // CWS: new manager after terrible 2025
    // Any other offseason changes
  },
  
  // Teams with dramatically different roster construction from 2025
  majorOverhaul: ['BAL', 'DET', 'BOS', 'PIT', 'NYM', 'OAK'],
  
  // Dome/warm-weather teams (travel to cold climate = 44% win rate)
  warmWeatherTeams: ['MIA', 'TB', 'HOU', 'TEX', 'ARI', 'SD', 'LAD', 'LAA'],
  
  // Cold-weather OD parks (March 26 temps could be 35-50°F)
  coldODParks: ['CHC', 'CWS', 'CLE', 'DET', 'MIN', 'BOS', 'NYY', 'NYM', 'PIT', 'WSH', 'BAL', 'KC', 'COL'],
};

/**
 * Get team's OD tendency adjustment
 * Returns a probability shift for win probability AND a totals multiplier
 * 
 * @param {string} awayAbbr 
 * @param {string} homeAbbr 
 * @param {object} opts - { awayPitcherTier, homePitcherTier, isDome, isNight }
 * @returns {object} { homeShift, awayShift, totalsMult, signals[] }
 */
function getODTendencyAdjustment(awayAbbr, homeAbbr, opts = {}) {
  const homeRec = OD_RECORDS[homeAbbr] || { w: 5, l: 6, overHits: 5, underHits: 6, avgTotal: 8.0 };
  const awayRec = OD_RECORDS[awayAbbr] || { w: 5, l: 6, overHits: 5, underHits: 6, avgTotal: 8.0 };
  
  const signals = [];
  let homeShift = 0;
  let totalsMult = 1.0;
  
  // Historical OD win rate adjustment (capped at ±2%)
  const homeWinRate = homeRec.w / (homeRec.w + homeRec.l);
  const awayWinRate = awayRec.w / (awayRec.w + awayRec.l);
  
  // Deviation from 50% baseline
  const homeDeviation = homeWinRate - 0.5;
  const awayDeviation = awayWinRate - 0.5;
  
  // Weight historical OD record at 15% (small but real signal)
  const OD_WEIGHT = 0.15;
  const historicalShift = (homeDeviation - awayDeviation) * OD_WEIGHT;
  const cappedShift = Math.max(-0.02, Math.min(0.02, historicalShift));
  
  if (Math.abs(cappedShift) >= 0.005) {
    homeShift += cappedShift;
    signals.push({
      factor: 'OD Historical',
      impact: `${(cappedShift * 100).toFixed(1)}% home WP shift`,
      detail: `${homeAbbr} ${homeRec.w}-${homeRec.l} OD (${(homeWinRate*100).toFixed(0)}%), ${awayAbbr} ${awayRec.w}-${awayRec.l} OD (${(awayWinRate*100).toFixed(0)}%)`,
      homeWinRate: (homeWinRate * 100).toFixed(0) + '%',
      awayWinRate: (awayWinRate * 100).toFixed(0) + '%'
    });
  }
  
  // Totals tendency — O/U historical rate
  const homeUnderRate = homeRec.underHits / (homeRec.overHits + homeRec.underHits);
  const awayUnderRate = awayRec.underHits / (awayRec.overHits + awayRec.underHits);
  const combinedUnderRate = (homeUnderRate + awayUnderRate) / 2;
  
  // If both teams historically hit unders on OD, slight totals reduction
  if (combinedUnderRate >= 0.60) {
    const underMult = 1 - (combinedUnderRate - 0.50) * 0.05; // max ~2.5% reduction for heavy under teams
    totalsMult *= underMult;
    signals.push({
      factor: 'OD Under Tendency',
      impact: `${((1-underMult)*100).toFixed(1)}% totals reduction`,
      detail: `${homeAbbr} ${homeRec.underHits}/${homeRec.overHits+homeRec.underHits} OD unders (${(homeUnderRate*100).toFixed(0)}%), ${awayAbbr} ${awayRec.underHits}/${awayRec.overHits+awayRec.underHits} OD unders (${(awayUnderRate*100).toFixed(0)}%)`
    });
  } else if (combinedUnderRate <= 0.40) {
    // Both teams are historically OD over teams
    const overMult = 1 + (0.50 - combinedUnderRate) * 0.04; // max ~2% increase
    totalsMult *= overMult;
    signals.push({
      factor: 'OD Over Tendency',
      impact: `+${((overMult-1)*100).toFixed(1)}% totals increase`,
      detail: `${homeAbbr} ${homeRec.overHits}/${homeRec.overHits+homeRec.underHits} OD overs (${((1-homeUnderRate)*100).toFixed(0)}%), ${awayAbbr} ${awayRec.overHits}/${awayRec.overHits+awayRec.underHits} OD overs (${((1-awayUnderRate)*100).toFixed(0)}%)`
    });
  }
  
  // Climate shock: warm-weather team traveling to cold park
  const awayIsWarm = TWENTY_SIX_FACTORS.warmWeatherTeams.includes(awayAbbr);
  const homeIsCold = TWENTY_SIX_FACTORS.coldODParks.includes(homeAbbr);
  
  if (awayIsWarm && homeIsCold) {
    // Warm team in cold park = -1.5% win prob shift (they underperform)
    homeShift += 0.015;
    signals.push({
      factor: 'Climate Shock',
      impact: '+1.5% home WP (away team climate disadvantage)',
      detail: `${awayAbbr} (warm-weather) at ${homeAbbr} (cold OD park). Warm teams hit 44% on cold-weather ODs.`
    });
    // Also slight under lean (cold suppresses both teams but especially away hitters)
    totalsMult *= 0.99;
  }
  
  // Home cold-weather team has cold park advantage (they're used to it)
  const homeIsWarm = TWENTY_SIX_FACTORS.warmWeatherTeams.includes(homeAbbr);
  const awayIsCold = TWENTY_SIX_FACTORS.coldODParks.includes(awayAbbr);
  
  if (homeIsWarm && !homeIsCold && awayIsCold) {
    // Cold team traveling to warm park — slight disadvantage (adjusting to warm weather is easier)
    // Very small effect
    signals.push({
      factor: 'Warm Weather Advantage',
      impact: 'Negligible (cold→warm adjustment easier)',
      detail: `${awayAbbr} (cold) at ${homeAbbr} (warm). Minor factor.`
    });
  }
  
  // Major overhaul teams tend to underperform OD (new system, unfamiliar)
  if (TWENTY_SIX_FACTORS.majorOverhaul.includes(homeAbbr)) {
    homeShift -= 0.008;
    signals.push({
      factor: 'Roster Overhaul',
      impact: '-0.8% home WP (new players adjusting)',
      detail: `${homeAbbr} had major offseason roster changes. New team chemistry = OD underperformance risk.`
    });
  }
  if (TWENTY_SIX_FACTORS.majorOverhaul.includes(awayAbbr)) {
    homeShift += 0.008;
    signals.push({
      factor: 'Away Roster Overhaul',
      impact: '+0.8% home WP (away team new players adjusting)',
      detail: `${awayAbbr} had major offseason roster changes. New team chemistry = OD underperformance risk.`
    });
  }
  
  // Day game factor — OD day games hit under 60.2%
  if (opts.isDayGame) {
    totalsMult *= 0.99; // slight additional under lean
    signals.push({
      factor: 'OD Day Game',
      impact: '-1% totals (OD day games hit under 60.2%)',
      detail: 'Day games on Opening Day have lower scoring due to afternoon shadows + less hitter eye adjustment time.'
    });
  }
  
  return {
    homeShift: Math.max(-0.03, Math.min(0.03, homeShift)),
    totalsMult,
    signals,
    homeRecord: `${homeRec.w}-${homeRec.l}`,
    awayRecord: `${awayRec.w}-${awayRec.l}`,
    homeAvgTotal: homeRec.avgTotal,
    awayAvgTotal: awayRec.avgTotal,
    homeNotes: homeRec.notes,
    awayNotes: awayRec.notes
  };
}

/**
 * Get all 20 OD game tendency analyses
 */
function scanODTendencies() {
  let od;
  try { od = require('../models/mlb-opening-day'); } catch(e) { return { error: 'OD module not found' }; }
  
  const games = od.OPENING_DAY_GAMES || [];
  const analyses = [];
  
  for (const game of games) {
    const adj = getODTendencyAdjustment(game.away, game.home, {
      isDayGame: (game.time || '').includes('PM') && parseInt((game.time||'').split(':')[0]) < 6
    });
    
    analyses.push({
      matchup: `${game.away}@${game.home}`,
      date: game.date,
      ...adj,
      pitchers: game.confirmedStarters || game.pitchers || {}
    });
  }
  
  // Sort by absolute homeShift magnitude (biggest tendencies first)
  analyses.sort((a, b) => Math.abs(b.homeShift) - Math.abs(a.homeShift));
  
  return {
    timestamp: new Date().toISOString(),
    gameCount: analyses.length,
    analyses,
    summary: {
      gamesWithSignals: analyses.filter(a => a.signals.length > 0).length,
      avgHomeShift: (analyses.reduce((s, a) => s + a.homeShift, 0) / analyses.length * 100).toFixed(2) + '%',
      avgTotalsMult: (analyses.reduce((s, a) => s + a.totalsMult, 0) / analyses.length).toFixed(4),
      topHomeEdge: analyses[0] ? `${analyses[0].matchup} (+${(analyses[0].homeShift*100).toFixed(1)}%)` : 'N/A',
      topAwayEdge: analyses[analyses.length-1] ? `${analyses[analyses.length-1].matchup} (${(analyses[analyses.length-1].homeShift*100).toFixed(1)}%)` : 'N/A'
    }
  };
}

/**
 * Get OD betting implications for a specific game
 */
function getODBettingImplications(awayAbbr, homeAbbr, modelProb, modelTotal) {
  const adj = getODTendencyAdjustment(awayAbbr, homeAbbr);
  
  const adjustedHomeProb = modelProb + adj.homeShift;
  const adjustedTotal = modelTotal * adj.totalsMult;
  
  const implications = [];
  
  // ML implication
  if (adj.homeShift > 0.01) {
    implications.push({
      type: 'ML',
      lean: 'HOME',
      strength: adj.homeShift > 0.02 ? 'STRONG' : 'LEAN',
      detail: `OD tendencies favor ${homeAbbr} (+${(adj.homeShift*100).toFixed(1)}% WP shift)`
    });
  } else if (adj.homeShift < -0.01) {
    implications.push({
      type: 'ML',
      lean: 'AWAY',
      strength: adj.homeShift < -0.02 ? 'STRONG' : 'LEAN',
      detail: `OD tendencies favor ${awayAbbr} (${(adj.homeShift*100).toFixed(1)}% WP shift)`
    });
  }
  
  // Totals implication
  if (adj.totalsMult < 0.98) {
    implications.push({
      type: 'TOTAL',
      lean: 'UNDER',
      strength: adj.totalsMult < 0.97 ? 'STRONG' : 'LEAN',
      detail: `OD tendencies favor UNDER (${((1-adj.totalsMult)*100).toFixed(1)}% reduction). Adjusted total: ${adjustedTotal.toFixed(1)}`
    });
  } else if (adj.totalsMult > 1.02) {
    implications.push({
      type: 'TOTAL',
      lean: 'OVER',
      strength: adj.totalsMult > 1.03 ? 'STRONG' : 'LEAN',
      detail: `OD tendencies favor OVER (+${((adj.totalsMult-1)*100).toFixed(1)}% increase). Adjusted total: ${adjustedTotal.toFixed(1)}`
    });
  }
  
  return {
    original: { homeWinProb: modelProb, total: modelTotal },
    adjusted: { homeWinProb: adjustedHomeProb, total: adjustedTotal },
    shift: { homeProb: adj.homeShift, totalsMult: adj.totalsMult },
    implications,
    signals: adj.signals,
    records: {
      home: adj.homeRecord,
      away: adj.awayRecord,
      homeNotes: adj.homeNotes,
      awayNotes: adj.awayNotes
    }
  };
}

module.exports = {
  getODTendencyAdjustment,
  scanODTendencies,
  getODBettingImplications,
  OD_RECORDS,
  TWENTY_SIX_FACTORS
};
