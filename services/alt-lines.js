/**
 * Alternate Lines Value Scanner — SportsSim v20.0
 * 
 * THE EDGE: Alt lines (alt totals, alt spreads, alt run lines) are 
 * less efficiently priced by sportsbooks. Standard lines get hammered
 * by sharps, but alt markets have wider margins = more +EV opportunities.
 * 
 * Uses our Poisson model + Monte Carlo to calculate exact probabilities
 * for ANY line, then scans The Odds API alt markets for value.
 * 
 * Markets scanned:
 *   - Alt totals (e.g., Over 5.5 at +200, Under 10.5 at +120)
 *   - Alt run lines (e.g., LAD -2.5 at +180, NYY +2.5 at -200)
 *   - First 5 innings (F5) lines — pitcher-dominated = more predictable
 *   - Team totals (Over/Under team-specific run totals)
 * 
 * MLB Opening Day = March 27. This is how we print.
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'alt-lines-cache.json');
const CACHE_TTL = 15 * 60 * 1000; // 15 min cache (alt lines move slower)

// ==================== POISSON MATH ====================

function poissonPMF(lambda, k) {
  if (k < 0) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Build full score probability matrix using Poisson distributions
 * Returns P(away=a, home=h) for all a,h in [0, maxRuns)
 */
function buildScoreMatrix(awayLambda, homeLambda, maxRuns = 20) {
  const matrix = [];
  for (let a = 0; a < maxRuns; a++) {
    matrix[a] = [];
    for (let h = 0; h < maxRuns; h++) {
      matrix[a][h] = poissonPMF(awayLambda, a) * poissonPMF(homeLambda, h);
    }
  }
  return matrix;
}

/**
 * Calculate probability of total being over/under a given line
 */
function totalProb(matrix, line, maxRuns = 20) {
  let overProb = 0, underProb = 0, pushProb = 0;
  for (let a = 0; a < maxRuns; a++) {
    for (let h = 0; h < maxRuns; h++) {
      const total = a + h;
      const prob = matrix[a][h];
      if (total > line) overProb += prob;
      else if (total < line) underProb += prob;
      else pushProb += prob;
    }
  }
  return { over: overProb, under: underProb, push: pushProb };
}

/**
 * Calculate probability of home team covering a given spread
 * Spread is from home perspective: home -1.5 means home wins by 2+
 */
function spreadProb(matrix, spread, maxRuns = 20) {
  let coverProb = 0, noCoverProb = 0, pushProb = 0;
  for (let a = 0; a < maxRuns; a++) {
    for (let h = 0; h < maxRuns; h++) {
      const margin = h - a; // positive = home wins
      const prob = matrix[a][h];
      if (margin > -spread) coverProb += prob; // home covers (e.g., -1.5: needs margin > 1.5)
      else if (margin < -spread) noCoverProb += prob;
      else pushProb += prob;
    }
  }
  return { cover: coverProb, noCover: noCoverProb, push: pushProb };
}

/**
 * Calculate team total probability (one team's runs over/under a line)
 */
function teamTotalProb(lambda, line) {
  let overProb = 0, underProb = 0, pushProb = 0;
  const maxRuns = 20;
  for (let r = 0; r < maxRuns; r++) {
    const prob = poissonPMF(lambda, r);
    if (r > line) overProb += prob;
    else if (r < line) underProb += prob;
    else pushProb += prob;
  }
  return { over: overProb, under: underProb, push: pushProb };
}

/**
 * F5 (First 5 innings) score matrix
 * Starters dominate F5, so the lambda is scaled by the starter's IP fraction
 * Typical starter covers 5/9 of the game in F5, but more of their innings 
 * come in the first 5 (they're freshest)
 */
function buildF5ScoreMatrix(awayLambda, homeLambda, opts = {}) {
  // F5 runs are approximately 55-58% of full game runs
  // With strong starters, it's lower (they suppress more early)
  const f5Factor = opts.f5Factor || 0.565;
  const awayF5Lambda = awayLambda * f5Factor;
  const homeF5Lambda = homeLambda * f5Factor;
  return {
    matrix: buildScoreMatrix(awayF5Lambda, homeF5Lambda, 15),
    awayLambda: awayF5Lambda,
    homeLambda: homeF5Lambda,
    maxRuns: 15
  };
}

// ==================== ODDS MATH ====================

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(prob) {
  if (prob <= 0) return 999;
  if (prob >= 1) return -9999;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function evPer100(modelProb, ml) {
  const payout = ml > 0 ? ml : 100 / (-ml / 100);
  return modelProb * payout - (1 - modelProb) * 100;
}

function kellyFraction(modelProb, ml) {
  const b = ml > 0 ? ml / 100 : 100 / (-ml);
  const q = 1 - modelProb;
  return Math.max(0, (b * modelProb - q) / b);
}

// ==================== ALT LINE GENERATION ====================

/**
 * Generate all alt lines we want to scan for a given matchup
 * Returns arrays of alt totals, alt spreads, and team totals
 */
function generateAltLines(prediction) {
  const projTotal = prediction.totalRuns || (prediction.awayExpRuns + prediction.homeExpRuns);
  const projDiff = (prediction.homeExpRuns || 0) - (prediction.awayExpRuns || 0);
  
  // Alt totals: scan a wide range centered on projected total
  const altTotals = [];
  for (let line = 4.5; line <= 14.5; line += 0.5) {
    altTotals.push(line);
  }
  
  // Alt run lines / spreads: from -4.5 to +4.5
  const altSpreads = [];
  for (let spread = -4.5; spread <= 4.5; spread += 0.5) {
    altSpreads.push(spread); // negative = home favored
  }
  
  // Team totals: 0.5 to 8.5 
  const teamTotals = [];
  for (let tt = 0.5; tt <= 8.5; tt += 0.5) {
    teamTotals.push(tt);
  }
  
  return { altTotals, altSpreads, teamTotals };
}

/**
 * Calculate model probabilities for ALL alt lines in a matchup
 */
function calculateAllAltProbs(prediction) {
  const awayLambda = Math.max(0.5, prediction.awayExpRuns || 4.4);
  const homeLambda = Math.max(0.5, prediction.homeExpRuns || 4.4);
  
  const fullMatrix = buildScoreMatrix(awayLambda, homeLambda);
  const f5 = buildF5ScoreMatrix(awayLambda, homeLambda);
  
  const lines = generateAltLines(prediction);
  
  // Full game alt totals
  const altTotalProbs = {};
  for (const line of lines.altTotals) {
    const probs = totalProb(fullMatrix, line);
    altTotalProbs[line] = {
      line,
      over: +probs.over.toFixed(4),
      under: +probs.under.toFixed(4),
      push: +probs.push.toFixed(4),
      overML: probToML(probs.over),
      underML: probToML(probs.under),
    };
  }
  
  // F5 alt totals
  const f5TotalProbs = {};
  for (let line = 2.5; line <= 8.5; line += 0.5) {
    const probs = totalProb(f5.matrix, line, f5.maxRuns);
    f5TotalProbs[line] = {
      line,
      over: +probs.over.toFixed(4),
      under: +probs.under.toFixed(4),
      overML: probToML(probs.over),
      underML: probToML(probs.under),
    };
  }
  
  // Alt run lines (from home perspective)
  const altSpreadProbs = {};
  for (const spread of lines.altSpreads) {
    const probs = spreadProb(fullMatrix, spread);
    altSpreadProbs[spread] = {
      spread,
      homeCover: +probs.cover.toFixed(4),
      awayCover: +probs.noCover.toFixed(4),
      push: +probs.push.toFixed(4),
      homeCoverML: probToML(probs.cover),
      awayCoverML: probToML(probs.noCover),
    };
  }
  
  // Team totals
  const awayTeamTotals = {};
  const homeTeamTotals = {};
  for (const line of lines.teamTotals) {
    const awayProbs = teamTotalProb(awayLambda, line);
    awayTeamTotals[line] = {
      line,
      over: +awayProbs.over.toFixed(4),
      under: +awayProbs.under.toFixed(4),
      overML: probToML(awayProbs.over),
      underML: probToML(awayProbs.under),
    };
    const homeProbs = teamTotalProb(homeLambda, line);
    homeTeamTotals[line] = {
      line,
      over: +homeProbs.over.toFixed(4),
      under: +homeProbs.under.toFixed(4),
      overML: probToML(homeProbs.over),
      underML: probToML(homeProbs.under),
    };
  }
  
  // F5 spread (who's winning after 5)
  const f5SpreadProbs = {};
  for (let spread = -2.5; spread <= 2.5; spread += 0.5) {
    const probs = spreadProb(f5.matrix, spread, f5.maxRuns);
    f5SpreadProbs[spread] = {
      spread,
      homeCover: +probs.cover.toFixed(4),
      awayCover: +probs.noCover.toFixed(4),
      homeCoverML: probToML(probs.cover),
      awayCoverML: probToML(probs.noCover),
    };
  }
  
  return {
    away: prediction.away,
    home: prediction.home,
    awayName: prediction.awayName,
    homeName: prediction.homeName,
    awayLambda: +awayLambda.toFixed(2),
    homeLambda: +homeLambda.toFixed(2),
    projTotal: +(awayLambda + homeLambda).toFixed(1),
    projDiff: +(homeLambda - awayLambda).toFixed(2),
    fullGame: {
      totals: altTotalProbs,
      spreads: altSpreadProbs,
      awayTeamTotals,
      homeTeamTotals,
    },
    f5: {
      totals: f5TotalProbs,
      spreads: f5SpreadProbs,
      awayLambda: +f5.awayLambda.toFixed(2),
      homeLambda: +f5.homeLambda.toFixed(2),
      projTotal: +(f5.awayLambda + f5.homeLambda).toFixed(1),
    },
    generatedAt: new Date().toISOString()
  };
}

// ==================== VALUE SCANNING ====================

/**
 * Scan alt lines from sportsbooks against our model probabilities
 * This is where the money lives — alt markets are less efficient
 * 
 * @param {Object} altProbs - From calculateAllAltProbs()
 * @param {Array} bookOdds - Alt line odds from The Odds API
 * @param {Object} opts - { minEdge, minEV, sport }
 * @returns {Array} Value bets sorted by EV
 */
function scanForValue(altProbs, bookOdds, opts = {}) {
  const minEdge = opts.minEdge || 0.03; // 3% minimum edge
  const minEV = opts.minEV || 3; // $3 per $100 minimum EV
  const valueBets = [];
  
  if (!bookOdds || !Array.isArray(bookOdds)) return valueBets;
  
  for (const bookLine of bookOdds) {
    const market = bookLine.market;
    const outcomes = bookLine.outcomes || [];
    
    for (const outcome of outcomes) {
      const bookML = outcome.price;
      if (!bookML || bookML === 0) continue;
      
      const bookProb = mlToProb(bookML);
      let modelProb = null;
      let pick = outcome.name;
      let marketType = market;
      let lineValue = outcome.point;
      
      // Match book line to our model probability
      if (market === 'alternate_totals' || market === 'totals') {
        const line = outcome.point;
        if (!line) continue;
        
        const isOver = outcome.name === 'Over';
        const modelData = altProbs.fullGame.totals[line];
        if (modelData) {
          modelProb = isOver ? modelData.over : modelData.under;
          pick = `${isOver ? 'Over' : 'Under'} ${line}`;
          marketType = 'alt_total';
        }
      }
      
      else if (market === 'alternate_spreads' || market === 'spreads') {
        const spread = outcome.point;
        if (spread === undefined || spread === null) continue;
        
        // Determine if this is home or away
        const isHome = outcome.name === altProbs.homeName || 
                       outcome.name.toLowerCase().includes(altProbs.home.toLowerCase());
        
        if (isHome) {
          // Home team with this spread
          const modelData = altProbs.fullGame.spreads[spread];
          if (modelData) {
            modelProb = modelData.homeCover;
            pick = `${altProbs.home} ${spread > 0 ? '+' : ''}${spread}`;
            marketType = 'alt_spread';
          }
        } else {
          // Away team — flip the spread
          const homeSpread = -spread;
          const modelData = altProbs.fullGame.spreads[homeSpread];
          if (modelData) {
            modelProb = modelData.awayCover;
            pick = `${altProbs.away} ${spread > 0 ? '+' : ''}${spread}`;
            marketType = 'alt_spread';
          }
        }
      }
      
      else if (market === 'team_totals') {
        const line = outcome.point;
        if (!line) continue;
        const isOver = outcome.name.includes('Over');
        const isHome = outcome.description?.includes(altProbs.homeName) || 
                       outcome.team === altProbs.home;
        
        const teamTotals = isHome ? altProbs.fullGame.homeTeamTotals : altProbs.fullGame.awayTeamTotals;
        const modelData = teamTotals[line];
        if (modelData) {
          modelProb = isOver ? modelData.over : modelData.under;
          pick = `${isHome ? altProbs.home : altProbs.away} ${isOver ? 'Over' : 'Under'} ${line}`;
          marketType = 'team_total';
        }
      }
      
      // Calculate edge and EV
      if (modelProb !== null && modelProb > 0) {
        const edge = modelProb - bookProb;
        const ev = evPer100(modelProb, bookML);
        
        if (edge >= minEdge && ev >= minEV) {
          const kelly = kellyFraction(modelProb, bookML);
          
          // Confidence tier
          let confidence = 'LOW';
          if (edge >= 0.08 && ev >= 15) confidence = 'HIGH';
          else if (edge >= 0.05 && ev >= 8) confidence = 'MEDIUM';
          
          valueBets.push({
            pick,
            market: marketType,
            line: lineValue,
            bookML,
            bookProb: +bookProb.toFixed(4),
            modelProb: +modelProb.toFixed(4),
            modelML: probToML(modelProb),
            edge: +edge.toFixed(4),
            ev: +ev.toFixed(1),
            kelly: { full: +kelly.toFixed(4), half: +(kelly / 2).toFixed(4), quarter: +(kelly / 4).toFixed(4) },
            confidence,
            book: bookLine.bookmaker || 'unknown',
            game: `${altProbs.away} @ ${altProbs.home}`,
          });
        }
      }
    }
  }
  
  // Sort by EV descending
  valueBets.sort((a, b) => b.ev - a.ev);
  return valueBets;
}

/**
 * Scan alt lines directly from The Odds API for a specific sport
 * Returns all alt-market value bets across all games
 */
async function scanAltLines(sport, predictions, opts = {}) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) {
    return { error: 'No ODDS_API_KEY configured', valueBets: [] };
  }
  
  // Check cache
  const cache = loadCache();
  const cacheKey = `${sport}_${new Date().toISOString().split('T')[0]}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }
  
  const sportKeys = {
    mlb: 'baseball_mlb',
    nba: 'basketball_nba',
    nhl: 'icehockey_nhl'
  };
  
  const sportKey = sportKeys[sport];
  if (!sportKey) return { error: `Unknown sport: ${sport}`, valueBets: [] };
  
  // Fetch alt lines from The Odds API
  // Markets: alternate_spreads, alternate_totals, team_totals
  const markets = ['alternate_spreads', 'alternate_totals', 'team_totals', 'h2h', 'spreads', 'totals'];
  
  let allOdds = [];
  try {
    const fetch = require('node-fetch');
    
    // Fetch main + alt markets (separate calls to avoid hitting char limits)
    for (const marketGroup of [['h2h', 'spreads', 'totals'], ['alternate_spreads', 'alternate_totals'], ['team_totals']]) {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=${marketGroup.join(',')}&oddsFormat=american`;
      
      try {
        const resp = await fetch(url, { timeout: 15000 });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) {
            // Merge with existing — combine bookmaker data per game
            for (const game of data) {
              const existing = allOdds.find(g => g.id === game.id);
              if (existing) {
                // Merge bookmakers
                for (const bm of (game.bookmakers || [])) {
                  const existBm = existing.bookmakers.find(b => b.key === bm.key);
                  if (existBm) {
                    existBm.markets = [...(existBm.markets || []), ...(bm.markets || [])];
                  } else {
                    existing.bookmakers.push(bm);
                  }
                }
              } else {
                allOdds.push(game);
              }
            }
          }
        }
      } catch (e) {
        console.error(`[alt-lines] Error fetching ${marketGroup.join(',')}:`, e.message);
      }
    }
  } catch (e) {
    return { error: `API fetch failed: ${e.message}`, valueBets: [] };
  }
  
  if (allOdds.length === 0) {
    return { error: 'No odds data available', valueBets: [], gamesChecked: 0 };
  }
  
  // Match games to our predictions and scan for value
  const allValueBets = [];
  const gameResults = [];
  
  for (const game of allOdds) {
    // Find matching prediction
    let prediction = null;
    if (predictions && Array.isArray(predictions)) {
      prediction = predictions.find(p => {
        const homeMatch = game.home_team.toLowerCase().includes(p.homeName?.toLowerCase()?.split(' ').pop() || '___');
        const awayMatch = game.away_team.toLowerCase().includes(p.awayName?.toLowerCase()?.split(' ').pop() || '___');
        return homeMatch || awayMatch;
      });
    }
    
    if (!prediction) continue;
    
    // Calculate all alt line probabilities for this matchup
    const altProbs = calculateAllAltProbs(prediction);
    
    // Flatten book odds into scannable format
    const flatBookOdds = [];
    for (const bm of (game.bookmakers || [])) {
      for (const mkt of (bm.markets || [])) {
        for (const outcome of (mkt.outcomes || [])) {
          flatBookOdds.push({
            market: mkt.key,
            bookmaker: bm.title,
            outcomes: [{
              name: outcome.name,
              price: outcome.price,
              point: outcome.point,
              description: outcome.description,
              team: outcome.name
            }]
          });
        }
      }
    }
    
    // Scan for value
    const gameValue = scanForValue(altProbs, flatBookOdds, opts);
    
    gameResults.push({
      game: `${prediction.away} @ ${prediction.home}`,
      home_team: game.home_team,
      away_team: game.away_team,
      projTotal: altProbs.projTotal,
      projDiff: altProbs.projDiff,
      valueBetsFound: gameValue.length,
      topBets: gameValue.slice(0, 5),
    });
    
    allValueBets.push(...gameValue);
  }
  
  // Sort all value bets by EV
  allValueBets.sort((a, b) => b.ev - a.ev);
  
  const result = {
    sport,
    gamesChecked: gameResults.length,
    totalGamesWithOdds: allOdds.length,
    totalValueBets: allValueBets.length,
    highConfidence: allValueBets.filter(b => b.confidence === 'HIGH').length,
    mediumConfidence: allValueBets.filter(b => b.confidence === 'MEDIUM').length,
    lowConfidence: allValueBets.filter(b => b.confidence === 'LOW').length,
    avgEdge: allValueBets.length > 0 ? +(allValueBets.reduce((s, b) => s + b.edge, 0) / allValueBets.length).toFixed(4) : 0,
    avgEV: allValueBets.length > 0 ? +(allValueBets.reduce((s, b) => s + b.ev, 0) / allValueBets.length).toFixed(1) : 0,
    topBets: allValueBets.slice(0, 20),
    allValueBets,
    byMarket: {
      alt_total: allValueBets.filter(b => b.market === 'alt_total'),
      alt_spread: allValueBets.filter(b => b.market === 'alt_spread'),
      team_total: allValueBets.filter(b => b.market === 'team_total'),
      moneyline: allValueBets.filter(b => b.market === 'moneyline'),
      spread: allValueBets.filter(b => b.market === 'spread'),
      total: allValueBets.filter(b => b.market === 'total'),
    },
    gameBreakdown: gameResults,
    scannedAt: new Date().toISOString(),
  };
  
  // Cache results
  cache[cacheKey] = { data: result, timestamp: Date.now() };
  saveCache(cache);
  
  return result;
}

/**
 * Quick alt-lines analysis for a single matchup (no API call needed)
 * Uses existing prediction to generate all model-fair alt lines
 */
function analyzeMatchupAltLines(prediction) {
  if (!prediction || prediction.error) return { error: 'Invalid prediction' };
  
  const altProbs = calculateAllAltProbs(prediction);
  
  // Find the best value spots (model thinks are most mispriced by typical market)
  // Compare to "typical" juice: -110 both sides = ~52.4% breakeven
  const breakeven = 0.524;
  
  const sweetSpots = [];
  
  // Totals sweet spots
  for (const [line, data] of Object.entries(altProbs.fullGame.totals)) {
    // Lines far from projected total are where books are weakest
    const dist = Math.abs(parseFloat(line) - altProbs.projTotal);
    if (dist >= 1.5) {
      if (data.over > 0.6) {
        sweetSpots.push({
          pick: `Over ${line}`,
          market: 'alt_total',
          modelProb: data.over,
          modelML: data.overML,
          distance: dist,
          note: `${(dist).toFixed(1)} runs below projected total — strong over`
        });
      }
      if (data.under > 0.6) {
        sweetSpots.push({
          pick: `Under ${line}`,
          market: 'alt_total',
          modelProb: data.under,
          modelML: data.underML,
          distance: dist,
          note: `${(dist).toFixed(1)} runs above projected total — strong under`
        });
      }
    }
  }
  
  // Spread sweet spots
  for (const [spread, data] of Object.entries(altProbs.fullGame.spreads)) {
    const s = parseFloat(spread);
    if (data.homeCover > 0.6 && s < -0.5) {
      sweetSpots.push({
        pick: `${altProbs.home} ${s}`,
        market: 'alt_spread',
        modelProb: data.homeCover,
        modelML: data.homeCoverML,
        note: `Home -${Math.abs(s)} has ${(data.homeCover * 100).toFixed(0)}% model probability`
      });
    }
    if (data.awayCover > 0.6 && s > 0.5) {
      sweetSpots.push({
        pick: `${altProbs.away} +${s}`,
        market: 'alt_spread',
        modelProb: data.awayCover,
        modelML: data.awayCoverML,
        note: `Away +${s} has ${(data.awayCover * 100).toFixed(0)}% model probability`
      });
    }
  }
  
  // Team total sweet spots — only show actionable lines (2.5+)
  for (const [line, data] of Object.entries(altProbs.fullGame.awayTeamTotals)) {
    const l = parseFloat(line);
    if (l < 2.5) continue; // skip trivial lines
    if (data.over > 0.65 || data.under > 0.65) {
      const side = data.over > data.under ? 'Over' : 'Under';
      const prob = Math.max(data.over, data.under);
      sweetSpots.push({
        pick: `${altProbs.away} TT ${side} ${line}`,
        market: 'team_total',
        modelProb: prob,
        modelML: probToML(prob),
        note: `${altProbs.away} projected ${altProbs.awayLambda} runs`
      });
    }
  }
  for (const [line, data] of Object.entries(altProbs.fullGame.homeTeamTotals)) {
    const l = parseFloat(line);
    if (l < 2.5) continue; // skip trivial lines
    if (data.over > 0.65 || data.under > 0.65) {
      const side = data.over > data.under ? 'Over' : 'Under';
      const prob = Math.max(data.over, data.under);
      sweetSpots.push({
        pick: `${altProbs.home} TT ${side} ${line}`,
        market: 'team_total',
        modelProb: prob,
        modelML: probToML(prob),
        note: `${altProbs.home} projected ${altProbs.homeLambda} runs`
      });
    }
  }
  
  // F5 sweet spots
  for (const [line, data] of Object.entries(altProbs.f5.totals)) {
    const dist = Math.abs(parseFloat(line) - altProbs.f5.projTotal);
    if (dist >= 1.0 && (data.over > 0.6 || data.under > 0.6)) {
      const side = data.over > data.under ? 'Over' : 'Under';
      const prob = Math.max(data.over, data.under);
      sweetSpots.push({
        pick: `F5 ${side} ${line}`,
        market: 'f5_total',
        modelProb: prob,
        modelML: probToML(prob),
        note: `F5 projected ${altProbs.f5.projTotal} runs`
      });
    }
  }
  
  // Sort by probability (strongest model conviction first)
  sweetSpots.sort((a, b) => b.modelProb - a.modelProb);
  
  return {
    ...altProbs,
    sweetSpots: sweetSpots.slice(0, 20),
    summary: {
      projTotal: altProbs.projTotal,
      f5ProjTotal: altProbs.f5.projTotal,
      projDiff: altProbs.projDiff,
      strongOverLine: findThresholdLine(altProbs.fullGame.totals, 'over', 0.6),
      strongUnderLine: findThresholdLine(altProbs.fullGame.totals, 'under', 0.6),
      sweetSpotCount: sweetSpots.length,
    }
  };
}

/**
 * Find the line where probability crosses a threshold
 */
function findThresholdLine(totals, side, threshold) {
  const lines = Object.entries(totals)
    .map(([line, data]) => ({ line: parseFloat(line), prob: data[side] }))
    .sort((a, b) => a.line - b.line);
  
  if (side === 'over') {
    // Find lowest line where over prob > threshold
    for (const l of lines) {
      if (l.prob >= threshold) return { line: l.line, prob: +(l.prob.toFixed(3)) };
    }
  } else {
    // Find highest line where under prob > threshold
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].prob >= threshold) return { line: lines[i].line, prob: +(lines[i].prob.toFixed(3)) };
    }
  }
  return null;
}

// ==================== CACHE ====================

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { /* no cache */ }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) { console.error('[alt-lines] Cache save error:', e.message); }
}

module.exports = {
  calculateAllAltProbs,
  scanForValue,
  scanAltLines,
  analyzeMatchupAltLines,
  buildScoreMatrix,
  buildF5ScoreMatrix,
  totalProb,
  spreadProb,
  teamTotalProb,
};
