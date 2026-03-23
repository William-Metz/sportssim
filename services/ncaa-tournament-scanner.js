/**
 * NCAA Tournament Value Scanner — SportsSim v69.0
 * 
 * Comprehensive tournament betting edge detection:
 *   - Sweet 16 / Elite 8 / Final Four game-level value scanning
 *   - Tournament futures value (championship, Final Four, region winner)
 *   - Upset probability vs market pricing analysis
 *   - Tournament-specific under bias detection (defense travels)
 *   - Historical seed matchup edge analysis
 *   - Cross-book line shopping for best prices
 *   - Kelly-sized bet recommendations with tournament-specific adjustments
 * 
 * KEY EDGE THESIS:
 *   - Public overvalues seeds/brand names → underdog ML mispricing
 *   - Tournament totals historically go UNDER more than regular season
 *   - Lower-seed defensive teams get massively undervalued in Sweet 16
 *   - KenPom AdjD is the single best predictor of tournament success
 *   - Late-round experience/coaching matters more → adjustment needed
 */

const fetch = require('node-fetch');

let ncaa, ncaaLive;
try { ncaa = require('../models/ncaa'); } catch(e) {}
try { ncaaLive = require('./ncaa-live'); } catch(e) {}

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

// Tournament-specific adjustments for value detection
const TOURNEY_ADJUSTMENTS = {
  // Defense premium increases as tournament progresses
  defensePremiumByRound: {
    'Round 1': 1.02,
    'Round 2': 1.03,
    'Sweet 16': 1.05,
    'Elite Eight': 1.07,
    'Final Four': 1.08,
    'Championship': 1.10,
  },
  // Under bias by round (% above regular season under rate)
  underBiasByRound: {
    'Round 1': 0.02,
    'Round 2': 0.03,
    'Sweet 16': 0.04,     // Sweet 16 unders hit ~56% historically
    'Elite Eight': 0.05,
    'Final Four': 0.06,
    'Championship': 0.07,
  },
  // Cinderella fatigue — lower seeds tire as tournament progresses
  cinderellaFatigueByRound: {
    'Sweet 16': 0.02,     // 2% efficiency dropoff for seeds 9+
    'Elite Eight': 0.04,
    'Final Four': 0.06,
  },
  // Experience premium — teams with recent tournament success
  experiencePremium: 0.015,  // 1.5% win prob boost for teams with FF in last 3 years
};

// Teams with recent Final Four experience (affects performance under pressure)
const RECENT_FF_TEAMS = ['UCON', 'PUR', 'BAMA', 'HOU', 'FLA'];

// ==================== ODDS FETCHING ====================

/**
 * Fetch NCAA tournament odds from The Odds API
 * Returns game odds for moneyline, spread, and totals
 */
async function fetchNCAAOdds() {
  if (!ODDS_API_KEY) return { games: [], error: 'No ODDS_API_KEY' };
  
  try {
    // Fetch game odds
    const url = `https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,caesars,pointsbet,bet365`;
    const resp = await fetch(url, { timeout: 15000 });
    
    if (!resp.ok) {
      return { games: [], error: `Odds API returned ${resp.status}` };
    }
    
    const data = await resp.json();
    const remaining = resp.headers.get('x-requests-remaining');
    
    return {
      games: data || [],
      remaining: remaining ? parseInt(remaining) : null,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return { games: [], error: e.message };
  }
}

/**
 * Fetch NCAA tournament futures (championship, Final Four)
 */
async function fetchNCAAFutures() {
  if (!ODDS_API_KEY) return { markets: [], error: 'No ODDS_API_KEY' };
  
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_ncaab_championship_winner/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=outrights&oddsFormat=american`;
    const resp = await fetch(url, { timeout: 15000 });
    
    if (!resp.ok) return { markets: [], error: `Futures API returned ${resp.status}` };
    
    const data = await resp.json();
    return {
      markets: data || [],
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return { markets: [], error: e.message };
  }
}

// ==================== VALUE DETECTION ====================

/**
 * Extract best lines across all bookmakers for a game
 */
function extractBestLines(game) {
  const lines = {
    awayML: { best: null, book: null },
    homeML: { best: null, book: null },
    awaySpread: { best: null, line: null, book: null },
    homeSpread: { best: null, line: null, book: null },
    over: { best: null, line: null, book: null },
    under: { best: null, line: null, book: null },
  };
  
  for (const bk of (game.bookmakers || [])) {
    const bookName = bk.title || bk.key;
    
    for (const mkt of (bk.markets || [])) {
      if (mkt.key === 'h2h') {
        for (const o of mkt.outcomes) {
          if (o.name === game.away_team) {
            if (!lines.awayML.best || o.price > lines.awayML.best) {
              lines.awayML = { best: o.price, book: bookName };
            }
          }
          if (o.name === game.home_team) {
            if (!lines.homeML.best || o.price > lines.homeML.best) {
              lines.homeML = { best: o.price, book: bookName };
            }
          }
        }
      }
      
      if (mkt.key === 'spreads') {
        for (const o of mkt.outcomes) {
          if (o.name === game.away_team && o.point !== undefined) {
            if (!lines.awaySpread.best || o.price > lines.awaySpread.best) {
              lines.awaySpread = { best: o.price, line: o.point, book: bookName };
            }
          }
          if (o.name === game.home_team && o.point !== undefined) {
            if (!lines.homeSpread.best || o.price > lines.homeSpread.best) {
              lines.homeSpread = { best: o.price, line: o.point, book: bookName };
            }
          }
        }
      }
      
      if (mkt.key === 'totals') {
        for (const o of mkt.outcomes) {
          if (o.name === 'Over' && o.point !== undefined) {
            if (!lines.over.best || o.price > lines.over.best) {
              lines.over = { best: o.price, line: o.point, book: bookName };
            }
          }
          if (o.name === 'Under' && o.point !== undefined) {
            if (!lines.under.best || o.price > lines.under.best) {
              lines.under = { best: o.price, line: o.point, book: bookName };
            }
          }
        }
      }
    }
  }
  
  return lines;
}

/**
 * Convert American odds to implied probability
 */
function mlToProb(ml) {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

/**
 * Convert probability to American odds
 */
function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Calculate Kelly fraction
 */
function kellyFraction(modelProb, americanOdds) {
  const decimalOdds = americanOdds > 0 ? (americanOdds / 100) + 1 : (100 / Math.abs(americanOdds)) + 1;
  const b = decimalOdds - 1;
  const kelly = (modelProb * b - (1 - modelProb)) / b;
  return Math.max(0, kelly);
}

/**
 * Calculate EV per $100 wagered
 */
function evPer100(modelProb, americanOdds) {
  const decimalOdds = americanOdds > 0 ? (americanOdds / 100) + 1 : (100 / Math.abs(americanOdds)) + 1;
  return (modelProb * decimalOdds - 1) * 100;
}

/**
 * Enhanced NCAA game value detection with tournament-specific adjustments
 */
function analyzeGameValue(awayAbbr, homeAbbr, lines, round = 'Sweet 16') {
  if (!ncaa) return { error: 'NCAA model not loaded' };
  
  const pred = ncaa.predict(awayAbbr, homeAbbr, { round });
  if (pred.error) return pred;
  
  const awayTeam = ncaa.TEAMS[awayAbbr];
  const homeTeam = ncaa.TEAMS[homeAbbr];
  if (!awayTeam || !homeTeam) return { error: 'Teams not found' };
  
  const valueBets = [];
  const insights = [];
  
  // === TOURNAMENT-SPECIFIC ADJUSTMENTS ===
  
  // 1. Defense premium adjustment
  const defPremium = TOURNEY_ADJUSTMENTS.defensePremiumByRound[round] || 1.0;
  const awayDefAdv = awayTeam.adjD < 92; // Elite defense
  const homeDefAdv = homeTeam.adjD < 92;
  
  if (awayDefAdv && !homeDefAdv) {
    insights.push(`🛡️ ${awayTeam.name} has elite defense (AdjD: ${awayTeam.adjD}) — defense travels in tournament`);
  }
  if (homeDefAdv && !awayDefAdv) {
    insights.push(`🛡️ ${homeTeam.name} has elite defense (AdjD: ${homeTeam.adjD}) — defense travels in tournament`);
  }
  if (awayDefAdv && homeDefAdv) {
    insights.push(`🛡️ Both teams have elite defense — lean UNDER, expect rock fight`);
  }
  
  // KenPom rating gap insight
  const adjEMGap = Math.abs(awayTeam.adjEM - homeTeam.adjEM);
  const favorite = awayTeam.adjEM > homeTeam.adjEM ? awayTeam : homeTeam;
  const dog = awayTeam.adjEM > homeTeam.adjEM ? homeTeam : awayTeam;
  if (adjEMGap > 10) {
    insights.push(`📊 Large KenPom gap: ${favorite.name} (${favorite.adjEM}) vs ${dog.name} (${dog.adjEM}) — ${adjEMGap.toFixed(1)} AdjEM difference`);
  } else if (adjEMGap < 3) {
    insights.push(`⚖️ Near-even matchup: only ${adjEMGap.toFixed(1)} AdjEM difference — volatile game, look for best odds`);
  }
  
  // Offensive firepower insight
  if (awayTeam.adjO > 118 || homeTeam.adjO > 118) {
    const firepower = awayTeam.adjO > homeTeam.adjO ? awayTeam : homeTeam;
    insights.push(`🔥 ${firepower.name} has elite offense (AdjO: ${firepower.adjO}) — can score on anyone`);
  }
  
  // 2. Experience premium
  const awayExp = RECENT_FF_TEAMS.includes(awayAbbr);
  const homeExp = RECENT_FF_TEAMS.includes(homeAbbr);
  
  if (awayExp) insights.push(`🏆 ${awayTeam.name} has recent Final Four experience — clutch premium`);
  if (homeExp) insights.push(`🏆 ${homeTeam.name} has recent Final Four experience — clutch premium`);
  
  // 3. Cinderella fatigue
  const awaySeed = awayTeam.seed || 16;
  const homeSeed = homeTeam.seed || 16;
  
  if (awaySeed >= 9 && round !== 'Round 1' && round !== 'Round 2') {
    const fatigue = TOURNEY_ADJUSTMENTS.cinderellaFatigueByRound[round] || 0;
    if (fatigue > 0) {
      insights.push(`⚡ ${awayTeam.name} (#${awaySeed} seed) may face Cinderella fatigue — ${(fatigue * 100).toFixed(0)}% efficiency dropoff expected`);
    }
  }
  if (homeSeed >= 9 && round !== 'Round 1' && round !== 'Round 2') {
    const fatigue = TOURNEY_ADJUSTMENTS.cinderellaFatigueByRound[round] || 0;
    if (fatigue > 0) {
      insights.push(`⚡ ${homeTeam.name} (#${homeSeed} seed) may face Cinderella fatigue — ${(fatigue * 100).toFixed(0)}% efficiency dropoff expected`);
    }
  }
  
  // 4. Seed upset rate context
  const seedMatchup = `${Math.min(awaySeed, homeSeed)}v${Math.max(awaySeed, homeSeed)}`;
  const historicalUpset = ncaa.SEED_UPSET_RATES?.[seedMatchup];
  if (historicalUpset) {
    const underdog = awaySeed > homeSeed ? awayTeam.name : homeTeam.name;
    insights.push(`📊 Historical ${seedMatchup} upset rate: ${(historicalUpset * 100).toFixed(0)}% — ${underdog} as underdog`);
  }
  
  // 5. Tempo mismatch (half-court teams beat up-tempo in tournament)
  const tempoGap = Math.abs(awayTeam.tempo - homeTeam.tempo);
  if (tempoGap > 5) {
    const slowTeam = awayTeam.tempo < homeTeam.tempo ? awayTeam : homeTeam;
    const fastTeam = awayTeam.tempo >= homeTeam.tempo ? awayTeam : homeTeam;
    insights.push(`🐢 Tempo mismatch: ${slowTeam.name} (${slowTeam.tempo}) vs ${fastTeam.name} (${fastTeam.tempo}) — slow teams control pace in tournament`);
  }
  
  // === VALUE BET DETECTION ===
  
  // Moneyline value
  if (lines.awayML.best) {
    const impliedProb = mlToProb(lines.awayML.best);
    const edge = pred.blendedAwayWinProb - impliedProb;
    if (edge > 0.025) { // 2.5% edge threshold for tournament
      const ev = evPer100(pred.blendedAwayWinProb, lines.awayML.best);
      const kelly = kellyFraction(pred.blendedAwayWinProb, lines.awayML.best);
      valueBets.push({
        type: 'ML',
        bet: `${awayTeam.name} ML`,
        team: awayAbbr,
        seed: awaySeed,
        modelProb: +(pred.blendedAwayWinProb * 100).toFixed(1),
        marketProb: +(impliedProb * 100).toFixed(1),
        edge: +(edge * 100).toFixed(1),
        evPer100: +ev.toFixed(1),
        marketOdds: lines.awayML.best,
        fairOdds: probToML(pred.blendedAwayWinProb),
        bestBook: lines.awayML.book,
        kellyFull: +(kelly * 100).toFixed(2),
        kellyHalf: +(kelly * 50).toFixed(2),
        confidence: edge > 0.08 ? 'HIGH' : edge > 0.05 ? 'MEDIUM' : 'LOW',
      });
    }
  }
  
  if (lines.homeML.best) {
    const impliedProb = mlToProb(lines.homeML.best);
    const edge = pred.blendedHomeWinProb - impliedProb;
    if (edge > 0.025) {
      const ev = evPer100(pred.blendedHomeWinProb, lines.homeML.best);
      const kelly = kellyFraction(pred.blendedHomeWinProb, lines.homeML.best);
      valueBets.push({
        type: 'ML',
        bet: `${homeTeam.name} ML`,
        team: homeAbbr,
        seed: homeSeed,
        modelProb: +(pred.blendedHomeWinProb * 100).toFixed(1),
        marketProb: +(impliedProb * 100).toFixed(1),
        edge: +(edge * 100).toFixed(1),
        evPer100: +ev.toFixed(1),
        marketOdds: lines.homeML.best,
        fairOdds: probToML(pred.blendedHomeWinProb),
        bestBook: lines.homeML.book,
        kellyFull: +(kelly * 100).toFixed(2),
        kellyHalf: +(kelly * 50).toFixed(2),
        confidence: edge > 0.08 ? 'HIGH' : edge > 0.05 ? 'MEDIUM' : 'LOW',
      });
    }
  }
  
  // Spread value
  if (lines.awaySpread.line !== null) {
    const modelSpread = pred.spread;
    const marketSpread = lines.awaySpread.line;
    const spreadEdge = modelSpread - marketSpread;
    
    if (Math.abs(spreadEdge) > 1.5) {
      const side = spreadEdge > 0 ? 'away' : 'home';
      valueBets.push({
        type: 'SPREAD',
        bet: side === 'away' ? 
          `${awayTeam.name} ${marketSpread > 0 ? '+' : ''}${marketSpread}` : 
          `${homeTeam.name} ${(-marketSpread) > 0 ? '+' : ''}${-marketSpread}`,
        team: side === 'away' ? awayAbbr : homeAbbr,
        seed: side === 'away' ? awaySeed : homeSeed,
        modelSpread: +modelSpread.toFixed(1),
        marketSpread: marketSpread,
        edge: +Math.abs(spreadEdge).toFixed(1),
        bestBook: lines.awaySpread.book,
        confidence: Math.abs(spreadEdge) > 3 ? 'HIGH' : 'MEDIUM',
      });
    }
  }
  
  // Total value (with tournament under bias)
  if (lines.over.line !== null) {
    const modelTotal = pred.projTotal;
    const marketTotal = lines.over.line;
    const totalEdge = modelTotal - marketTotal;
    const underBias = TOURNEY_ADJUSTMENTS.underBiasByRound[round] || 0;
    
    // Apply tournament under bias — model total is slightly inflated for tourney games
    const adjustedEdge = totalEdge - (underBias * marketTotal);
    
    if (adjustedEdge > 2.5) {
      valueBets.push({
        type: 'TOTAL',
        bet: `OVER ${marketTotal}`,
        modelTotal: +modelTotal.toFixed(1),
        marketTotal,
        edge: +adjustedEdge.toFixed(1),
        bestBook: lines.over.book,
        note: 'Caution: tournament unders historically profitable',
        confidence: adjustedEdge > 5 ? 'HIGH' : 'MEDIUM',
      });
    } else if (adjustedEdge < -2.5) {
      valueBets.push({
        type: 'TOTAL',
        bet: `UNDER ${marketTotal}`,
        modelTotal: +modelTotal.toFixed(1),
        marketTotal,
        edge: +Math.abs(adjustedEdge).toFixed(1),
        bestBook: lines.under.book,
        note: '✅ Tournament under bias supports this play',
        confidence: Math.abs(adjustedEdge) > 5 ? 'HIGH' : 'MEDIUM',
      });
    }
  }
  
  return {
    game: `${awayTeam.name} vs ${homeTeam.name}`,
    round,
    away: { abbr: awayAbbr, name: awayTeam.name, seed: awaySeed, kenpom: awayTeam.kenpom, adjEM: awayTeam.adjEM, adjO: awayTeam.adjO, adjD: awayTeam.adjD },
    home: { abbr: homeAbbr, name: homeTeam.name, seed: homeSeed, kenpom: homeTeam.kenpom, adjEM: homeTeam.adjEM, adjO: homeTeam.adjO, adjD: homeTeam.adjD },
    prediction: {
      awayWinProb: +(pred.blendedAwayWinProb * 100).toFixed(1),
      homeWinProb: +(pred.blendedHomeWinProb * 100).toFixed(1),
      spread: +pred.spread.toFixed(1),
      total: +pred.projTotal.toFixed(1),
      awayML: pred.awayML,
      homeML: pred.homeML,
    },
    valueBets,
    valueBetCount: valueBets.length,
    insights,
    hasValue: valueBets.length > 0,
  };
}

// ==================== TOURNAMENT FUTURES VALUE ====================

/**
 * Scan tournament futures markets for value vs our bracket simulation
 */
async function scanTournamentFutures() {
  if (!ncaa) return { error: 'NCAA model not loaded' };
  
  // Run our bracket simulation
  const simResults = ncaa.simulateBracket(10000);
  if (!simResults || !simResults.results) return { error: 'Bracket simulation failed' };
  
  // Fetch futures odds
  const futuresData = await fetchNCAAFutures();
  
  const futuresValue = [];
  
  if (futuresData.markets && futuresData.markets.length > 0) {
    // Extract best championship odds for each team
    const bestChampOdds = {};
    
    for (const event of futuresData.markets) {
      for (const bk of (event.bookmakers || [])) {
        for (const mkt of (bk.markets || [])) {
          for (const o of (mkt.outcomes || [])) {
            const teamName = o.name;
            const abbr = ncaa.findTeamAbbr(teamName);
            if (!abbr) continue;
            
            if (!bestChampOdds[abbr] || o.price > bestChampOdds[abbr].odds) {
              bestChampOdds[abbr] = {
                odds: o.price,
                book: bk.title || bk.key,
                teamName,
              };
            }
          }
        }
      }
    }
    
    // Compare our sim probs to market
    for (const [abbr, champData] of Object.entries(bestChampOdds)) {
      const simTeam = simResults.results.find(r => r.team === abbr);
      if (!simTeam) continue;
      
      const modelProb = simTeam.champProb || simTeam.probability || 0;
      const marketProb = mlToProb(champData.odds);
      const edge = modelProb - marketProb;
      
      if (edge > 0.01) { // 1%+ edge on futures
        futuresValue.push({
          team: abbr,
          name: champData.teamName,
          seed: ncaa.TEAMS[abbr]?.seed || '?',
          kenpom: ncaa.TEAMS[abbr]?.kenpom || '?',
          modelChampProb: +(modelProb * 100).toFixed(1),
          marketChampProb: +(marketProb * 100).toFixed(1),
          edge: +(edge * 100).toFixed(1),
          marketOdds: champData.odds,
          fairOdds: probToML(modelProb),
          bestBook: champData.book,
          evPer100: +evPer100(modelProb, champData.odds).toFixed(1),
          kellyHalf: +(kellyFraction(modelProb, champData.odds) * 50).toFixed(2),
        });
      }
    }
    
    // Sort by edge
    futuresValue.sort((a, b) => b.edge - a.edge);
  }
  
  return {
    simulations: 10000,
    topSimTeams: simResults.results?.slice(0, 16).map(r => ({
      team: r.team,
      name: ncaa.TEAMS[r.team]?.name || r.team,
      seed: ncaa.TEAMS[r.team]?.seed || '?',
      champProb: +((r.champProb || r.probability || 0) * 100).toFixed(1),
    })),
    futuresValue,
    futuresValueCount: futuresValue.length,
    oddsSource: futuresData.markets?.length > 0 ? 'live' : 'no-data',
    timestamp: new Date().toISOString()
  };
}

// ==================== MAIN SCANNER ====================

/**
 * Run full tournament value scan
 * Fetches live odds, runs model on all available games, finds edges
 */
async function scanTournamentValue() {
  if (!ncaa) return { error: 'NCAA model not loaded' };
  
  const oddsData = await fetchNCAAOdds();
  
  const results = {
    gamesScanned: 0,
    valueBets: [],
    gameAnalysis: [],
    tournamentInsights: [],
    oddsRemaining: oddsData.remaining,
    timestamp: new Date().toISOString()
  };
  
  // Determine current round based on tournament state
  const tournState = ncaa.getTournamentStatus ? ncaa.getTournamentStatus() : null;
  const currentRound = tournState?.currentRound || 'Sweet 16';
  results.currentRound = currentRound;
  
  // Scan each game with odds
  for (const game of oddsData.games) {
    const awayName = game.away_team;
    const homeName = game.home_team;
    const awayAbbr = ncaa.findTeamAbbr(awayName);
    const homeAbbr = ncaa.findTeamAbbr(homeName);
    
    if (!awayAbbr || !homeAbbr) continue;
    
    const lines = extractBestLines(game);
    const analysis = analyzeGameValue(awayAbbr, homeAbbr, lines, currentRound);
    
    if (analysis.error) continue;
    
    results.gamesScanned++;
    results.gameAnalysis.push({
      ...analysis,
      commenceTime: game.commence_time,
    });
    
    if (analysis.hasValue) {
      for (const bet of analysis.valueBets) {
        results.valueBets.push({
          ...bet,
          game: analysis.game,
          round: analysis.round,
        });
      }
    }
  }
  
  // Sort value bets by edge
  results.valueBets.sort((a, b) => b.edge - a.edge);
  results.valueBetCount = results.valueBets.length;
  
  // Generate tournament-level insights
  if (results.gamesScanned > 0) {
    // Count underdog values
    const dogValues = results.valueBets.filter(b => b.type === 'ML' && b.marketOdds > 0);
    if (dogValues.length > 0) {
      results.tournamentInsights.push(`🐕 ${dogValues.length} underdog ML value bet(s) found — public seed bias creates mispricing`);
    }
    
    // Count under values
    const underValues = results.valueBets.filter(b => b.type === 'TOTAL' && b.bet.includes('UNDER'));
    if (underValues.length > 0) {
      results.tournamentInsights.push(`📉 ${underValues.length} UNDER value bet(s) — tournament defense premium in play`);
    }
    
    // Big edge detection
    const bigEdges = results.valueBets.filter(b => b.edge > 5);
    if (bigEdges.length > 0) {
      results.tournamentInsights.push(`🔥 ${bigEdges.length} bet(s) with 5%+ edge — these are SMASH plays`);
    }
  }
  
  // Also add Sweet 16 matchup preview if available
  try {
    const sweet16 = ncaa.getSweet16Matchups();
    if (sweet16) {
      results.sweet16Preview = {
        known: sweet16.known?.map(m => {
          const pred = ncaa.predict(m.away, m.home, { round: 'Sweet 16' });
          return {
            away: { abbr: m.away, name: ncaa.TEAMS[m.away]?.name, seed: ncaa.TEAMS[m.away]?.seed },
            home: { abbr: m.home, name: ncaa.TEAMS[m.home]?.name, seed: ncaa.TEAMS[m.home]?.seed },
            awayWinProb: +(pred.blendedAwayWinProb * 100).toFixed(1),
            homeWinProb: +(pred.blendedHomeWinProb * 100).toFixed(1),
            spread: +pred.spread.toFixed(1),
            total: +pred.projTotal.toFixed(1),
          };
        }) || [],
        pending: sweet16.pending?.length || 0,
      };
    }
  } catch (e) {
    // Sweet 16 matchups not available yet
  }
  
  return results;
}

/**
 * Get tournament dashboard data — single endpoint for all tournament info
 */
async function getTournamentDashboard() {
  if (!ncaa) return { error: 'NCAA model not loaded' };
  
  const [valueScan, futuresScan] = await Promise.all([
    scanTournamentValue(),
    scanTournamentFutures()
  ]);
  
  // Get bracket state
  const tournState = ncaa.getTournamentStatus ? ncaa.getTournamentStatus() : null;
  const bracketSim = ncaa.simulateBracket(5000);
  
  return {
    tournament: {
      status: tournState,
      currentRound: valueScan.currentRound || 'Sweet 16',
      gamesRemaining: tournState?.gamesRemaining || 'unknown',
    },
    valueScan,
    futures: futuresScan,
    bracketSimulation: {
      topContenders: bracketSim?.results?.slice(0, 8).map(r => ({
        team: r.team,
        name: ncaa.TEAMS[r.team]?.name || r.team,
        seed: ncaa.TEAMS[r.team]?.seed || '?',
        champProb: +((r.champProb || r.probability || 0) * 100).toFixed(1),
      })) || [],
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  scanTournamentValue,
  scanTournamentFutures,
  getTournamentDashboard,
  analyzeGameValue,
  fetchNCAAOdds,
  fetchNCAAFutures,
  extractBestLines,
  TOURNEY_ADJUSTMENTS,
};
