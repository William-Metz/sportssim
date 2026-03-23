/**
 * MLB First-3-Innings (F3) Model Service v93.0
 * ==============================================
 * 
 * THE EDGE: F3 markets are the LEAST efficient period markets because:
 * 1. FTTO (First-Time-Through-Order) advantage = pitchers dominate innings 1-3
 *    - 2024 data: .290 wOBA FTTO vs .320 second-time vs .340 third-time
 *    - This is a 15-17% suppression that books DON'T fully price
 * 2. Less sharp action on F3 vs F5/full game = softer lines
 * 3. Opening Day COMPOUNDS FTTO — batters haven't seen real pitching
 * 4. F3 eliminates ALL bullpen variance — pure starter vs top of order
 * 5. Cold weather more impactful in early innings (muscles not warm)
 * 
 * Markets via The Odds API:
 * - h2h_1st_3_innings (F3 moneyline)
 * - totals_1st_3_innings (F3 total)
 * - spreads_1st_3_innings (F3 spread)
 * 
 * This service:
 * - Scans all MLB games for F3 value bets
 * - Compares model F3 probabilities to live odds
 * - Integrates with Opening Day betting card
 * - Provides standalone matchup analysis
 */

const pitcherDB = require('../models/mlb-pitchers');

// ==================== FTTO PROFILES ====================
// First-Time-Through-Order run multiplier by pitcher tier
// Historical data: pitchers suppress FTTO runs significantly more than overall
// because batters haven't timed fastball velocity, breaking ball movement, etc.
const FTTO_PROFILES = {
  // Tier 1 aces: massive FTTO advantage
  1: { 
    fttoMult: 0.82, // 18% suppression FTTO
    note: 'Elite ace — batters have almost no chance FTTO',
    examples: 'Cole, Skubal, Crochet, Sale, Ragans'
  },
  // Tier 2 quality starters
  2: { 
    fttoMult: 0.88, // 12% suppression
    note: 'Quality starter — strong FTTO advantage',
    examples: 'Rogers, Peralta, Valdez, Gilbert'
  },
  // Tier 3 average starters  
  3: { 
    fttoMult: 0.93, // 7% suppression
    note: 'Average starter — moderate FTTO edge',
    examples: 'Most league-average arms'
  },
  // Tier 4 back-end
  4: { 
    fttoMult: 0.97, // 3% suppression
    note: 'Back-end — minimal FTTO advantage',
    examples: 'Spot starters, back-of-rotation'
  },
};

// ==================== TEAM TOP-OF-ORDER QUALITY ====================
// Top 1-3 batters see the most ABs in F3 (1st trip through order)
// Teams with elite top-of-order produce more F3 runs
// Based on 2024 top-3 batter wOBA
const TOP_ORDER_QUALITY = {
  'LAD': 1.10, // Betts-Ohtani-Freeman — best top 3 in baseball
  'NYY': 1.08, // Soto-Judge — elite 1-2
  'ATL': 1.06, // Acuna-Ozzie-Riley
  'BOS': 1.05, // Duran-Devers — power top
  'PHI': 1.05, // Schwarber-Turner-Harper
  'HOU': 1.04, // Altuve-Alvarez
  'SD':  1.04, // Profar-Machado-Tatis
  'SEA': 1.03, // J-Rod-France
  'SF':  1.03, // Chapman-Conforto
  'TOR': 1.03, // Springer-Vlad
  'BAL': 1.02, // Mullins-Alonso
  'CLE': 1.02, // Kwan-Ramirez
  'MIN': 1.02, // Correa-Buxton
  'TEX': 1.01, // Seager-Semien
  'CIN': 1.01, // McLain-India
  'DET': 1.01, // Greene-Vierling
  'ARI': 1.00, // Carroll-Marte
  'NYM': 1.00, // Lindor-Nimmo
  'MIL': 1.00, // Adames left... rebuilding top
  'CHC': 1.00, // Busch-Suzuki
  'KC':  0.99, // Witt-Pasquantino
  'STL': 0.99, // Contreras-Goldschmidt
  'TB':  0.98, // Arozarena-Paredes
  'LAA': 0.98, // Trout (when healthy)-Neto
  'MIA': 0.97, // Arraez-Rojas
  'PIT': 0.97, // Cruz-Hayes
  'OAK': 0.96, // Gelof-Rooker
  'WSH': 0.96, // Abrams-Wood
  'COL': 0.95, // Coors but weak lineup
  'CWS': 0.94, // Worst lineup in baseball
};

// ==================== F3 LIVE ODDS FETCHER ====================
// Use The Odds API to get F3 lines
async function fetchF3Odds() {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) return { error: 'No ODDS_API_KEY' };
  
  try {
    const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h_1st_3_innings,totals_1st_3_innings,spreads_1st_3_innings&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,caesars`;
    
    const resp = await fetch(url);
    if (!resp.ok) return { error: `Odds API ${resp.status}` };
    
    const data = await resp.json();
    const games = [];
    
    for (const game of data) {
      const gameData = {
        id: game.id,
        home: game.home_team,
        away: game.away_team,
        commence: game.commence_time,
        f3Lines: {},
      };
      
      for (const book of (game.bookmakers || [])) {
        for (const market of (book.markets || [])) {
          if (market.key === 'totals_1st_3_innings') {
            for (const outcome of (market.outcomes || [])) {
              if (outcome.name === 'Over') {
                gameData.f3Lines[book.key] = gameData.f3Lines[book.key] || {};
                gameData.f3Lines[book.key].totalLine = outcome.point;
                gameData.f3Lines[book.key].overOdds = outcome.price;
              } else if (outcome.name === 'Under') {
                gameData.f3Lines[book.key] = gameData.f3Lines[book.key] || {};
                gameData.f3Lines[book.key].underOdds = outcome.price;
              }
            }
          } else if (market.key === 'h2h_1st_3_innings') {
            for (const outcome of (market.outcomes || [])) {
              gameData.f3Lines[book.key] = gameData.f3Lines[book.key] || {};
              if (outcome.name === game.home_team) {
                gameData.f3Lines[book.key].homeML = outcome.price;
              } else if (outcome.name === game.away_team) {
                gameData.f3Lines[book.key].awayML = outcome.price;
              } else if (outcome.name === 'Draw') {
                gameData.f3Lines[book.key].drawML = outcome.price;
              }
            }
          } else if (market.key === 'spreads_1st_3_innings') {
            for (const outcome of (market.outcomes || [])) {
              gameData.f3Lines[book.key] = gameData.f3Lines[book.key] || {};
              if (outcome.name === game.home_team) {
                gameData.f3Lines[book.key].homeSpread = outcome.point;
                gameData.f3Lines[book.key].homeSpreadOdds = outcome.price;
              } else if (outcome.name === game.away_team) {
                gameData.f3Lines[book.key].awaySpread = outcome.point;
                gameData.f3Lines[book.key].awaySpreadOdds = outcome.price;
              }
            }
          }
        }
      }
      
      // Consolidate best line (prefer DK > FD > others)
      const bookPriority = ['draftkings', 'fanduel', 'betmgm', 'caesars'];
      for (const book of bookPriority) {
        if (gameData.f3Lines[book]) {
          gameData.bestBook = book;
          gameData.bestF3Line = gameData.f3Lines[book];
          break;
        }
      }
      
      games.push(gameData);
    }
    
    return { games, count: games.length, timestamp: new Date().toISOString() };
  } catch (e) {
    return { error: e.message };
  }
}

// ==================== TEAM ABBREVIATION RESOLVER ====================
const TEAM_ALIASES = {
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

function resolveTeam(name) {
  if (TEAM_ALIASES[name]) return TEAM_ALIASES[name];
  // Try partial match
  for (const [full, abbr] of Object.entries(TEAM_ALIASES)) {
    if (full.includes(name) || name.includes(abbr)) return abbr;
  }
  return name;
}

// ==================== ODDS CONVERSION ====================
function mlToProb(ml) {
  if (!ml) return null;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

function probToML(p) {
  if (!p || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  return Math.round(100 * (1 - p) / p);
}

// ==================== F3 VALUE SCANNER ====================
/**
 * Scan games for F3 value bets
 * @param {object} mlb - MLB model module
 * @param {Array} games - Array of game objects with away/home abbreviations
 * @param {object} opts - Options (oddsData for live comparison)
 */
function scanF3Value(mlb, games, opts = {}) {
  const results = [];
  const oddsData = opts.oddsData || {};
  
  for (const game of games) {
    const awayAbbr = game.away || game.awayAbbr;
    const homeAbbr = game.home || game.homeAbbr;
    if (!awayAbbr || !homeAbbr) continue;
    
    try {
      const pred = mlb.predict(awayAbbr, homeAbbr);
      if (!pred || pred.error || !pred.f3) continue;
      
      const f3 = pred.f3;
      const f3Total = f3.total;
      const drawProb = f3.drawProb;
      
      // Get pitcher info
      const awayPitcher = game.awayPitcher || pred.factors?.awayPitcher;
      const homePitcher = game.homePitcher || pred.factors?.homePitcher;
      
      // Determine pitcher tiers
      const awayTier = getPitcherTier(awayPitcher || awayAbbr);
      const homeTier = getPitcherTier(homePitcher || homeAbbr);
      
      // Get FTTO profiles
      const awayFTTO = FTTO_PROFILES[awayTier] || FTTO_PROFILES[3];
      const homeFTTO = FTTO_PROFILES[homeTier] || FTTO_PROFILES[3];
      
      // Top-of-order quality
      const awayTopOrder = TOP_ORDER_QUALITY[awayAbbr] || 1.0;
      const homeTopOrder = TOP_ORDER_QUALITY[homeAbbr] || 1.0;
      
      const gameResult = {
        away: awayAbbr,
        home: homeAbbr,
        awayPitcher: awayPitcher || 'TBD',
        homePitcher: homePitcher || 'TBD',
        modelF3Total: f3Total,
        f3AwayRuns: f3.awayRuns,
        f3HomeRuns: f3.homeRuns,
        threeWay: f3.threeWay,
        twoWay: f3.twoWay,
        drawProb: drawProb,
        topScores: f3.topScores?.slice(0, 5),
        // FTTO analysis
        ftto: {
          awayPitcherTier: awayTier,
          homePitcherTier: homeTier,
          awayFTTOSuppression: awayFTTO.fttoMult,
          homeFTTOSuppression: homeFTTO.fttoMult,
          awayTopOrderQuality: awayTopOrder,
          homeTopOrderQuality: homeTopOrder,
          // Combined FTTO edge: strong pitchers vs weak top-of-order = UNDER lean
          awayPitcherVsHomeOrder: +(awayFTTO.fttoMult * homeTopOrder).toFixed(3),
          homePitcherVsAwayOrder: +(homeFTTO.fttoMult * awayTopOrder).toFixed(3),
        },
        valueBets: [],
        signals: [],
      };
      
      // ==================== TOTALS VALUE ====================
      const totalLines = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
      for (const line of totalLines) {
        const lineData = f3.totals?.[line];
        if (!lineData) continue;
        
        // Check if model strongly favors under (F3 UNDER is the primary edge)
        if (lineData.under > 0.55) {
          gameResult.valueBets.push({
            type: 'F3 UNDER',
            line,
            modelProb: lineData.under,
            modelML: lineData.underML,
            edge: null, // Will be filled with live odds
            direction: 'UNDER',
            confidence: lineData.under > 0.65 ? 'HIGH' : lineData.under > 0.58 ? 'MEDIUM' : 'LOW',
          });
        }
        if (lineData.over > 0.55) {
          gameResult.valueBets.push({
            type: 'F3 OVER',
            line,
            modelProb: lineData.over,
            modelML: lineData.overML,
            edge: null,
            direction: 'OVER',
            confidence: lineData.over > 0.65 ? 'HIGH' : lineData.over > 0.58 ? 'MEDIUM' : 'LOW',
          });
        }
      }
      
      // ==================== ML VALUE ====================
      // F3 draw is typically ~22-28% — books often underprice this
      if (drawProb > 0.22) {
        gameResult.signals.push({
          type: 'DRAW_VALUE',
          prob: drawProb,
          ml: f3.threeWay?.drawML,
          note: `F3 draw ${(drawProb * 100).toFixed(1)}% — books often underprice F3 ties`,
        });
      }
      
      // ==================== FTTO SIGNALS ====================
      if (awayTier <= 2 && homeTier <= 2) {
        gameResult.signals.push({
          type: 'DUAL_ACE_F3',
          note: `Both aces (Tier ${awayTier} + Tier ${homeTier}) = strong F3 UNDER`,
          f3Total,
          fttoSuppression: +((awayFTTO.fttoMult + homeFTTO.fttoMult) / 2).toFixed(3),
        });
      }
      
      if (awayTier <= 1 && homeTopOrder <= 0.97) {
        gameResult.signals.push({
          type: 'ACE_VS_WEAK_ORDER',
          note: `Elite ace ${awayPitcher || 'away'} vs weak top-of-order ${homeAbbr}`,
          direction: 'UNDER_HOME_TT',
        });
      }
      
      if (homeTier <= 1 && awayTopOrder <= 0.97) {
        gameResult.signals.push({
          type: 'ACE_VS_WEAK_ORDER',
          note: `Elite ace ${homePitcher || 'home'} vs weak top-of-order ${awayAbbr}`,
          direction: 'UNDER_AWAY_TT',
        });
      }
      
      // F3 spread for lopsided pitcher matchups
      if (Math.abs(awayTier - homeTier) >= 2) {
        const betterSide = awayTier < homeTier ? 'away' : 'home';
        const spreadData = f3.spreads?.[-0.5];
        if (spreadData) {
          gameResult.signals.push({
            type: 'PITCHER_MISMATCH_F3',
            note: `Tier ${Math.min(awayTier, homeTier)} vs Tier ${Math.max(awayTier, homeTier)} = ${betterSide} F3 lean`,
            homeSpreadCover: spreadData.homeCover,
            awaySpreadCover: spreadData.awayCover,
          });
        }
      }
      
      results.push(gameResult);
    } catch (e) {
      // Skip games that error
    }
  }
  
  // Sort by number of value bets + signals
  results.sort((a, b) => (b.valueBets.length + b.signals.length) - (a.valueBets.length + a.signals.length));
  
  return {
    games: results,
    count: results.length,
    totalValueBets: results.reduce((sum, g) => sum + g.valueBets.length, 0),
    totalSignals: results.reduce((sum, g) => sum + g.signals.length, 0),
    model: 'negative-binomial-f3',
    note: 'F3 = First 3 Innings. FTTO (First-Time-Through-Order) advantage means starters dominate innings 1-3. Primary edge: F3 UNDERS in ace matchups.',
    timestamp: new Date().toISOString(),
  };
}

// ==================== OPENING DAY F3 SCAN ====================
/**
 * Scan all Opening Day games for F3 value
 */
function scanODGamesF3(mlb, odGames, opts = {}) {
  const games = odGames.map(g => ({
    away: g.away,
    home: g.home,
    awayPitcher: g.awayPitcher || g.awayStarter,
    homePitcher: g.homePitcher || g.homeStarter,
    day: g.day,
  }));
  
  const scan = scanF3Value(mlb, games, opts);
  
  // Add OD-specific analysis
  const odSummary = {
    ...scan,
    isOpeningDay: true,
    odNote: 'Opening Day F3 UNDERS are historically profitable: ace starters + FTTO + rusty bats + cold weather = suppressed F3 scoring.',
    topF3Plays: [],
  };
  
  // Find top plays
  for (const game of scan.games) {
    for (const bet of game.valueBets) {
      if (bet.confidence === 'HIGH' || (bet.confidence === 'MEDIUM' && game.signals.length >= 2)) {
        odSummary.topF3Plays.push({
          matchup: `${game.away}@${game.home}`,
          bet: `${bet.type} ${bet.line}`,
          modelProb: bet.modelProb,
          modelML: bet.modelML,
          signals: game.signals.map(s => s.type),
          pitchers: `${game.awayPitcher} vs ${game.homePitcher}`,
          fttoGrade: getFTTOGrade(game.ftto),
        });
      }
    }
    
    // Also flag high-value draws
    for (const signal of game.signals) {
      if (signal.type === 'DRAW_VALUE' && signal.prob > 0.25) {
        odSummary.topF3Plays.push({
          matchup: `${game.away}@${game.home}`,
          bet: 'F3 DRAW',
          modelProb: signal.prob,
          modelML: signal.ml,
          signals: ['DRAW_VALUE'],
          pitchers: `${game.awayPitcher} vs ${game.homePitcher}`,
          fttoGrade: getFTTOGrade(game.ftto),
        });
      }
    }
  }
  
  // Sort top plays by model prob
  odSummary.topF3Plays.sort((a, b) => b.modelProb - a.modelProb);
  
  return odSummary;
}

// ==================== MATCHUP ANALYZER ====================
/**
 * Detailed F3 matchup analysis for a specific game
 */
function analyzeF3Matchup(mlb, awayAbbr, homeAbbr) {
  const pred = mlb.predict(awayAbbr, homeAbbr);
  if (!pred || pred.error) return { error: pred?.error || 'Prediction failed' };
  if (!pred.f3) return { error: 'F3 model not available' };
  
  const f3 = pred.f3;
  
  // Get full FTTO analysis
  const awayTier = getPitcherTierFromPred(pred, 'away');
  const homeTier = getPitcherTierFromPred(pred, 'home');
  const awayFTTO = FTTO_PROFILES[awayTier] || FTTO_PROFILES[3];
  const homeFTTO = FTTO_PROFILES[homeTier] || FTTO_PROFILES[3];
  
  return {
    matchup: `${awayAbbr}@${homeAbbr}`,
    f3: {
      total: f3.total,
      awayRuns: f3.awayRuns,
      homeRuns: f3.homeRuns,
      threeWay: f3.threeWay,
      twoWay: f3.twoWay,
      draw: f3.drawProb,
      topScores: f3.topScores,
    },
    totals: f3.totals,
    spreads: f3.spreads,
    teamTotals: f3.teamTotals,
    fttoAnalysis: {
      awayPitcherTier: awayTier,
      homePitcherTier: homeTier,
      awayFTTO: awayFTTO,
      homeFTTO: homeFTTO,
      awayTopOrder: TOP_ORDER_QUALITY[awayAbbr] || 1.0,
      homeTopOrder: TOP_ORDER_QUALITY[homeAbbr] || 1.0,
      combinedFTTOGrade: getFTTOGrade({
        awayPitcherTier: awayTier,
        homePitcherTier: homeTier,
        awayTopOrderQuality: TOP_ORDER_QUALITY[awayAbbr] || 1.0,
        homeTopOrderQuality: TOP_ORDER_QUALITY[homeAbbr] || 1.0,
      }),
    },
    bettingImplications: getBettingImplications(f3, awayTier, homeTier, awayAbbr, homeAbbr),
    comparison: {
      fullGame: { total: pred.totalRuns, homeWin: pred.homeWinProb, awayWin: pred.awayWinProb },
      f5: pred.f5 ? { total: pred.f5.total, homeWin: pred.f5.homeWinProb, awayWin: pred.f5.awayWinProb, draw: pred.f5.drawProb } : null,
      f3: { total: f3.total, homeWin: f3.homeWinProb, awayWin: f3.awayWinProb, draw: f3.drawProb },
      f3vsFullRatio: +(f3.total / pred.totalRuns).toFixed(3),
      f3vsF5Ratio: pred.f5 ? +(f3.total / pred.f5.total).toFixed(3) : null,
    },
    model: 'negative-binomial-f3',
    timestamp: new Date().toISOString(),
  };
}

// ==================== HELPER FUNCTIONS ====================

function getPitcherTier(pitcher) {
  if (!pitcher) return 3;
  // Try looking up in pitcher DB
  const allPitchers = pitcherDB.ALL_PITCHERS || {};
  for (const team of Object.values(allPitchers)) {
    if (!team) continue;
    const entries = Array.isArray(team) ? team : [team];
    for (const p of entries) {
      if (!p) continue;
      const pName = p.name || p;
      if (typeof pName === 'string' && typeof pitcher === 'string' && 
          (pName.toLowerCase().includes(pitcher.toLowerCase()) || pitcher.toLowerCase().includes(pName.toLowerCase()))) {
        if (p.rating >= 80) return 1;
        if (p.rating >= 65) return 2;
        if (p.rating >= 45) return 3;
        return 4;
      }
    }
  }
  return 3; // default to average
}

function getPitcherTierFromPred(pred, side) {
  const rating = side === 'away' ? 
    (pred.factors?.awayPitcherRating || 50) :
    (pred.factors?.homePitcherRating || 50);
  if (rating >= 80) return 1;
  if (rating >= 65) return 2;
  if (rating >= 45) return 3;
  return 4;
}

function getFTTOGrade(ftto) {
  if (!ftto) return 'C';
  const avgTier = (ftto.awayPitcherTier + ftto.homePitcherTier) / 2;
  const avgTopOrder = ((ftto.awayTopOrderQuality || 1) + (ftto.homeTopOrderQuality || 1)) / 2;
  
  // Higher pitcher tier (closer to 1) + lower top-of-order = better UNDER grade
  if (avgTier <= 1.5 && avgTopOrder <= 1.02) return 'A+';
  if (avgTier <= 1.5) return 'A';
  if (avgTier <= 2 && avgTopOrder <= 1.03) return 'B+';
  if (avgTier <= 2) return 'B';
  if (avgTier <= 2.5) return 'B-';
  if (avgTier <= 3) return 'C+';
  if (avgTier <= 3.5) return 'C';
  return 'D';
}

function getBettingImplications(f3, awayTier, homeTier, awayAbbr, homeAbbr) {
  const implications = [];
  
  // F3 UNDER signal
  if (awayTier <= 2 && homeTier <= 2) {
    implications.push({
      signal: 'STRONG F3 UNDER',
      reason: `Both quality starters (Tier ${awayTier}/${homeTier}) = FTTO dominance in first 3 innings`,
      confidence: 'HIGH',
    });
  } else if (awayTier <= 1 || homeTier <= 1) {
    implications.push({
      signal: 'F3 UNDER LEAN',
      reason: `At least one ace pitcher = partial FTTO suppression`,
      confidence: 'MEDIUM',
    });
  }
  
  // Draw value
  if (f3.drawProb > 0.25) {
    implications.push({
      signal: 'F3 DRAW VALUE',
      reason: `${(f3.drawProb * 100).toFixed(1)}% F3 tie probability — books typically price draws at 20-22% implied`,
      confidence: f3.drawProb > 0.28 ? 'HIGH' : 'MEDIUM',
    });
  }
  
  // Spread signal for mismatched pitchers
  if (Math.abs(awayTier - homeTier) >= 2) {
    const betterSide = awayTier < homeTier ? awayAbbr : homeAbbr;
    implications.push({
      signal: `F3 ${betterSide} LEAN`,
      reason: `${Math.abs(awayTier - homeTier)}-tier pitcher gap = ${betterSide} dominates F3`,
      confidence: 'MEDIUM',
    });
  }
  
  // Team total signals
  const awayTopOrder = TOP_ORDER_QUALITY[awayAbbr] || 1.0;
  const homeTopOrder = TOP_ORDER_QUALITY[homeAbbr] || 1.0;
  
  if (awayTopOrder >= 1.06 && homeTier >= 3) {
    implications.push({
      signal: `F3 ${awayAbbr} TEAM TOTAL OVER`,
      reason: `Elite top-of-order (${awayTopOrder.toFixed(2)}x) vs weak pitcher (Tier ${homeTier})`,
      confidence: 'MEDIUM',
    });
  }
  if (homeTopOrder >= 1.06 && awayTier >= 3) {
    implications.push({
      signal: `F3 ${homeAbbr} TEAM TOTAL OVER`,
      reason: `Elite top-of-order (${homeTopOrder.toFixed(2)}x) vs weak pitcher (Tier ${awayTier})`,
      confidence: 'MEDIUM',
    });
  }
  
  return implications;
}

function getStatus() {
  return {
    loaded: true,
    model: 'negative-binomial-f3',
    version: '93.0',
    pitcherTiers: Object.keys(FTTO_PROFILES).length,
    teamProfiles: Object.keys(TOP_ORDER_QUALITY).length,
    fttoNote: 'First-Time-Through-Order: .290 wOBA vs .320 second-time vs .340 third-time',
    edge: 'F3 markets are less efficient than F5/FG due to smaller sample sizes and less sharp action',
  };
}

module.exports = {
  scanF3Value,
  scanODGamesF3,
  analyzeF3Matchup,
  fetchF3Odds,
  getStatus,
  FTTO_PROFILES,
  TOP_ORDER_QUALITY,
  resolveTeam,
};
