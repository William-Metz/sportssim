/**
 * Daily Picks Engine — SportsSim v14.0
 * 
 * The MONEY PRINTER. Aggregates value from all models and sources:
 * - Moneyline value (all 3 sports)
 * - Totals value (Poisson model)
 * - Run line / puck line / spread value
 * - Player props value
 * - Line movement signals (steam moves, RLM)
 * - Weather impact (outdoor MLB/NFL)
 * - Injury impact
 * - Rolling form / momentum
 * 
 * Outputs ranked daily picks with confidence scores, Kelly sizing,
 * and detailed reasoning for each pick.
 */

const fs = require('fs');
const path = require('path');

const PICKS_FILE = path.join(__dirname, 'daily-picks-cache.json');
const PICKS_HISTORY = path.join(__dirname, 'picks-history.json');

// ==================== CONFIDENCE SCORING ====================

/**
 * Calculate composite confidence score (0-100) for a pick
 * Factors:
 *   - Edge size (0-40 pts) — bigger edge = more confident
 *   - Model agreement (0-20 pts) — multiple signals agreeing
 *   - Line movement (0-15 pts) — sharp money confirming
 *   - Sample quality (0-15 pts) — regular season data quality
 *   - Situational (0-10 pts) — weather, rest, injuries supporting
 */
function calculateConfidence(pick) {
  let score = 0;
  const reasons = [];

  // 1. Edge size (0-40)
  const edge = pick.edge || 0;
  if (edge >= 0.10) { score += 40; reasons.push('Massive edge (10%+)'); }
  else if (edge >= 0.07) { score += 32; reasons.push('Large edge (7%+)'); }
  else if (edge >= 0.05) { score += 25; reasons.push('Strong edge (5%+)'); }
  else if (edge >= 0.03) { score += 18; reasons.push('Moderate edge (3%+)'); }
  else if (edge >= 0.02) { score += 10; reasons.push('Small edge (2%+)'); }

  // 2. Model agreement (0-20)
  let agreementScore = 0;
  if (pick.modelProb && pick.modelProb > 0.55) { agreementScore += 5; }
  if (pick.modelProb && pick.modelProb > 0.60) { agreementScore += 5; }
  if (pick.pythagoreanSupport) { agreementScore += 5; reasons.push('Pythagorean supports'); }
  if (pick.powerRatingSupport) { agreementScore += 5; reasons.push('Power rating gap confirms'); }
  score += Math.min(20, agreementScore);

  // 3. Line movement (0-15)
  if (pick.lineMovement) {
    if (pick.lineMovement.steam && pick.lineMovement.direction === pick.side) {
      score += 15; reasons.push('Steam move confirms pick');
    } else if (pick.lineMovement.rlm && pick.lineMovement.direction === pick.side) {
      score += 12; reasons.push('Reverse line movement confirms');
    } else if (pick.lineMovement.sharp && pick.lineMovement.direction === pick.side) {
      score += 8; reasons.push('Sharp money on this side');
    } else if (pick.lineMovement.direction && pick.lineMovement.direction !== pick.side) {
      score -= 5; reasons.push('⚠️ Line moving against pick');
    }
  }

  // 4. Sample quality / data freshness (0-15)
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  // MLB: March (early) = less data, lower confidence. Mid-season = more data
  if (pick.sport === 'MLB') {
    if (month <= 2) { score += 8; reasons.push('Preseason projections (limited data)'); }
    else if (month === 3) { score += 10; reasons.push('Early season data'); }
    else { score += 15; reasons.push('Full season sample'); }
  } else if (pick.sport === 'NBA' || pick.sport === 'NHL') {
    // Late season = best data
    if (month >= 2 && month <= 4) { score += 15; reasons.push('Full season data available'); }
    else { score += 10; }
  }

  // 5. Situational factors (0-15) — expanded to include umpire + MC confirmation
  let situationalScore = 0;
  if (pick.weather && pick.weather.favorable) {
    situationalScore += 3; reasons.push(`Weather supports (${pick.weather.note})`);
  }
  if (pick.injuries && pick.injuries.advantage) {
    situationalScore += 4; reasons.push(`Injury edge: ${pick.injuries.note}`);
  }
  if (pick.rolling && pick.rolling.trend === 'hot') {
    situationalScore += 3; reasons.push('Team on hot streak');
  }
  if (pick.pitcher && pick.pitcher.tier === 'ACE') {
    situationalScore += 3; reasons.push(`Ace on the mound: ${pick.pitcher.name}`);
  }
  // Umpire zone supporting the pick direction (over/under)
  if (pick.umpire && pick.umpire.favorable) {
    situationalScore += 4; reasons.push(`Umpire supports: ${pick.umpire.note}`);
  }
  score += Math.min(15, situationalScore);

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // Tier assignment
  let tier;
  if (score >= 80) tier = '🔥 LOCK';
  else if (score >= 65) tier = '💪 STRONG';
  else if (score >= 50) tier = '✅ SOLID';
  else if (score >= 35) tier = '🤔 LEAN';
  else tier = '⚠️ SPECULATIVE';

  return { score, tier, reasons };
}

// ==================== PICK BUILDER ====================

/**
 * Build a standardized pick object from various value sources
 */
function buildPick(opts) {
  const {
    sport, market, pick, side, edge, modelProb, bookProb, ml,
    game, prediction, bookLine, lineMovement, weather, injuries,
    rolling, pitcher, umpire, ev, kelly, diff, modelTotal, bookTotal, mcTotal
  } = opts;

  const confidence = calculateConfidence({
    sport, edge, modelProb, side,
    pythagoreanSupport: prediction && prediction.factors && (
      side === 'home' ? prediction.homeWinProb > 0.55 : prediction.awayWinProb > 0.55
    ),
    powerRatingSupport: prediction && (
      side === 'home' ? prediction.homePower > prediction.awayPower + 5 :
      prediction.awayPower > prediction.homePower + 5
    ),
    lineMovement, weather, injuries, rolling, pitcher, umpire
  });

  return {
    // Core
    id: `${sport}-${game || 'unknown'}-${market}-${side}-${Date.now()}`,
    sport,
    market, // 'moneyline', 'total', 'spread', 'prop'
    pick,   // "LAD ML", "Over 8.5", etc.
    side,   // 'home', 'away', 'over', 'under'
    
    // Value
    edge: +(edge || 0).toFixed(3),
    modelProb: modelProb ? +modelProb.toFixed(3) : null,
    bookProb: bookProb ? +bookProb.toFixed(3) : null,
    ml: ml || null,
    ev: ev ? +ev.toFixed(1) : null,
    
    // Totals specific
    modelTotal: modelTotal || null,
    bookTotal: bookTotal || null,
    diff: diff || null,
    mcTotal: mcTotal || null,
    
    // Sizing
    kelly: kelly || null,
    
    // Confidence
    confidence: confidence.score,
    tier: confidence.tier,
    reasons: confidence.reasons,
    
    // Context
    game: game || null,
    prediction: prediction ? {
      homeWinProb: prediction.blendedHomeWinProb || prediction.homeWinProb,
      awayWinProb: prediction.blendedAwayWinProb || prediction.awayWinProb,
      totalRuns: prediction.totalRuns || prediction.totalGoals || prediction.totalPoints,
      homePower: prediction.homePower,
      awayPower: prediction.awayPower,
      monteCarlo: prediction.monteCarlo ? {
        totalRuns: prediction.monteCarlo.totalRuns?.mean,
        homeWinProb: prediction.monteCarlo.homeWinProb
      } : null
    } : null,
    
    // Factors
    lineMovement: lineMovement || null,
    weather: weather || null,
    injuries: injuries || null,
    rolling: rolling || null,
    pitcher: pitcher ? { name: pitcher.name, tier: pitcher.tier, rating: pitcher.rating } : null,
    umpire: umpire || null,
    
    // Metadata
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().split('T')[0]
  };
}

// ==================== AGGREGATION ENGINE ====================

/**
 * Generate today's picks from all available sources
 * @param {Object} opts - { nbaModel, mlbModel, nhlModel, oddsData, lineMovementService, injuryService, rollingStatsService, weatherService, propsService }
 * @returns {Object} { picks, summary, bankrollAdvice }
 */
async function generateDailyPicks(opts = {}) {
  const {
    nbaModel, mlbModel, nhlModel,
    oddsData = [], // Array of games with odds from getAllOdds()
    lineMovementSvc,
    injurySvc,
    rollingSvc,
    weatherSvc,
    propsSvc,
    umpireSvc,        // NEW: umpire tendencies service
    calibrationSvc,   // NEW: probability calibration service
    mlBridgeSvc,      // ML ensemble engine for blended predictions
    bankroll = 1000,
    kellyFraction = 0.5, // half-Kelly default
    minEdge = 0.02,
    maxPicks = 20
  } = opts;

  const allPicks = [];
  const errors = [];

  // ==================== PROCESS EACH GAME ====================
  
  for (const game of oddsData) {
    try {
      const sport = (game.sport || game.sport_key || '').toUpperCase();
      let sportKey = sport;
      if (sport.includes('NBA') || sport.includes('BASKETBALL')) sportKey = 'NBA';
      else if (sport.includes('MLB') || sport.includes('BASEBALL')) sportKey = 'MLB';
      else if (sport.includes('NHL') || sport.includes('HOCKEY')) sportKey = 'NHL';
      else continue; // Skip unsupported sports

      const model = sportKey === 'NBA' ? nbaModel : sportKey === 'MLB' ? mlbModel : nhlModel;
      if (!model) continue;

      // Resolve team abbreviations
      const homeTeam = game.home_team || game.homeTeam;
      const awayTeam = game.away_team || game.awayTeam;
      if (!homeTeam || !awayTeam) continue;

      // Try to get prediction
      let prediction = null;
      let homeAbbr = null, awayAbbr = null;

      // Resolve abbreviations using model's team data
      const teams = model.getTeams ? model.getTeams() : {};
      for (const [abbr, t] of Object.entries(teams)) {
        if (!t || !t.name) continue;
        const name = t.name.toLowerCase();
        const h = homeTeam.toLowerCase();
        const a = awayTeam.toLowerCase();
        if (name === h || h.includes(name.split(' ').pop()) || name.includes(h.split(' ').pop())) homeAbbr = abbr;
        if (name === a || a.includes(name.split(' ').pop()) || name.includes(a.split(' ').pop())) awayAbbr = abbr;
      }

      if (!homeAbbr || !awayAbbr) continue;

      try {
        // Use async predict for MLB (includes rest/travel + Monte Carlo)
        if (sportKey === 'MLB' && mlbModel && mlbModel.asyncPredict) {
          const predOpts = {};
          
          // Wire weather into async predict
          if (weatherSvc) {
            try {
              const weatherData = await weatherSvc.getWeatherForPark(homeAbbr);
              if (weatherData && !weatherData.error) predOpts.weather = weatherData;
            } catch (e) { /* weather optional */ }
          }
          
          // Wire umpire into async predict
          if (umpireSvc) {
            try {
              const umpAdj = await umpireSvc.getGameUmpireAdjustment(awayAbbr, homeAbbr);
              if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) predOpts.umpire = umpAdj.totalRunsAdj;
            } catch (e) { /* umpire optional */ }
          }
          
          let rawPred = await mlbModel.asyncPredict(awayAbbr, homeAbbr, predOpts);
          if (rawPred && !rawPred.error) {
            // Apply probability calibration for more accurate edge detection
            if (calibrationSvc && calibrationSvc.calibratePrediction) {
              prediction = calibrationSvc.calibratePrediction(rawPred, 'mlb');
            } else {
              prediction = rawPred;
            }
          }
        }
        // Use async predict for NBA (includes rest/tank situational analysis)
        else if (sportKey === 'NBA' && nbaModel && nbaModel.asyncPredict) {
          let rawPred = await nbaModel.asyncPredict(awayAbbr, homeAbbr, {});
          if (rawPred && !rawPred.error) {
            if (calibrationSvc && calibrationSvc.calibratePrediction) {
              prediction = calibrationSvc.calibratePrediction(rawPred, 'nba');
            } else {
              prediction = rawPred;
            }
          }
        }
        // Use async predict for NHL (includes goalie starter data from DailyFaceoff)
        else if (sportKey === 'NHL' && nhlModel && nhlModel.asyncPredict) {
          let rawPred = await nhlModel.asyncPredict(awayAbbr, homeAbbr, {});
          if (rawPred && !rawPred.error) {
            if (calibrationSvc && calibrationSvc.calibratePrediction) {
              prediction = calibrationSvc.calibratePrediction(rawPred, 'nhl');
            } else {
              prediction = rawPred;
            }
          }
        }
        else {
          prediction = model.predict(awayAbbr, homeAbbr);
        }
        if (prediction && prediction.error) prediction = null;
      } catch (e) { /* prediction failed */ }

      if (!prediction) continue;

      // Extract best book lines
      const bestBook = extractBestBookLines(game);
      if (!bestBook) continue;

      // Get contextual data
      let gameLineMovement = null;
      let gameWeather = null;
      let gameInjuriesHome = null, gameInjuriesAway = null;
      let gameRollingHome = null, gameRollingAway = null;

      if (lineMovementSvc) {
        try {
          const signals = lineMovementSvc.getSharpSignals();
          gameLineMovement = signals.find(s => 
            s.gameId && (s.gameId.includes(homeAbbr) || s.gameId.includes(awayAbbr))
          );
        } catch (e) {}
      }

      if (weatherSvc && sportKey === 'MLB') {
        try {
          // Use weather from prediction if available, otherwise try cache
          if (prediction.weather && prediction.weather.multiplier) {
            gameWeather = {
              favorable: prediction.weather.multiplier > 1.03,
              unfavorable: prediction.weather.multiplier < 0.97,
              multiplier: prediction.weather.multiplier,
              note: prediction.weather.description || `${prediction.weather.multiplier}x run factor`
            };
          } else {
            // Fallback: Check if outdoor park and try cache
            const coords = weatherSvc.BALLPARK_COORDS;
            if (coords && coords[homeAbbr] && !coords[homeAbbr].dome) {
              const w = weatherSvc.getWeatherCache ? weatherSvc.getWeatherCache(homeAbbr) : null;
              if (w) {
                gameWeather = {
                  favorable: w.multiplier > 1.03,
                  unfavorable: w.multiplier < 0.97,
                  multiplier: w.multiplier,
                  note: w.description || `${w.multiplier}x run factor`
                };
              }
            }
          }
        } catch (e) {}
      }

      if (injurySvc) {
        try {
          gameInjuriesHome = injurySvc.getInjuryAdjustment(sportKey.toLowerCase(), homeAbbr);
          gameInjuriesAway = injurySvc.getInjuryAdjustment(sportKey.toLowerCase(), awayAbbr);
        } catch (e) {}
      }

      if (rollingSvc) {
        try {
          gameRollingHome = rollingSvc.getRollingAdjustment(sportKey.toLowerCase(), homeAbbr);
          gameRollingAway = rollingSvc.getRollingAdjustment(sportKey.toLowerCase(), awayAbbr);
        } catch (e) {}
      }

      // Get umpire data for MLB (already wired into prediction above, but extract for confidence scoring)
      let gameUmpire = null;
      if (umpireSvc && sportKey === 'MLB') {
        try {
          if (prediction.umpire) {
            gameUmpire = prediction.umpire;
          } else {
            const umpAdj = await umpireSvc.getGameUmpireAdjustment(awayAbbr, homeAbbr);
            if (umpAdj && umpAdj.totalRunsAdj) {
              gameUmpire = umpAdj.totalRunsAdj;
            }
          }
        } catch (e) {}
      }

      const gameId = `${awayAbbr}@${homeAbbr}`;

      // ==================== ML ENSEMBLE BLENDING ====================
      // Blend ML engine probabilities into prediction for sharper edges
      if (mlBridgeSvc && sportKey === 'MLB') {
        try {
          const mlResult = await mlBridgeSvc.enhancedPredict(awayAbbr, homeAbbr);
          if (mlResult && mlResult.ml && mlResult.blendedHomeWinProb) {
            prediction.mlHomeWinProb = mlResult.ml.homeWinProb;
            prediction.mlAwayWinProb = mlResult.ml.awayWinProb;
            prediction.blendedHomeWinProb = mlResult.blendedHomeWinProb;
            prediction.blendedAwayWinProb = mlResult.blendedAwayWinProb;
            prediction.mlModelAgreement = mlResult.ml.modelAgreement;
            prediction.mlConfidence = mlResult.ml.confidence;
            prediction.predictionSource = 'ml+analytical';
            if (mlResult.ml.predictedTotal && prediction.totalRuns) {
              prediction.mlTotalRuns = mlResult.ml.predictedTotal;
            }
          }
        } catch (mlErr) { /* ML is optional — analytical still solid */ }
      }

      // ==================== MONEYLINE VALUE ====================
      // Use blended probs (analytical + MC + calibration) when available
      const homeWP = prediction.blendedHomeWinProb || prediction.homeWinProb;
      const awayWP = prediction.blendedAwayWinProb || prediction.awayWinProb;
      
      if (bestBook.homeML) {
        const bookHomeProb = mlToProb(bestBook.homeML);
        const homeEdge = homeWP - bookHomeProb;
        
        if (homeEdge >= minEdge) {
          const k = kellySize(homeWP, bestBook.homeML);
          const ev = evPer100(homeWP, bestBook.homeML);
          
          allPicks.push(buildPick({
            sport: sportKey, market: 'moneyline',
            pick: `${homeAbbr} ML (${bestBook.homeML > 0 ? '+' : ''}${bestBook.homeML})`,
            side: 'home', edge: homeEdge,
            modelProb: homeWP, bookProb: bookHomeProb,
            ml: bestBook.homeML, ev, kelly: { full: +k.toFixed(3), half: +(k/2).toFixed(3), quarter: +(k/4).toFixed(3) },
            game: gameId, prediction,
            lineMovement: gameLineMovement ? { steam: gameLineMovement.steam, rlm: gameLineMovement.rlm, direction: 'home' } : null,
            weather: gameWeather,
            injuries: gameInjuriesHome && gameInjuriesAway ? {
              advantage: (gameInjuriesAway.adjFactor || 0) < (gameInjuriesHome.adjFactor || 0),
              note: `${homeAbbr} ${gameInjuriesHome.starPlayersOut.length} out, ${awayAbbr} ${gameInjuriesAway.starPlayersOut.length} out`
            } : null,
            rolling: gameRollingHome ? { trend: gameRollingHome.trend === '🔥🔥' ? 'hot' : gameRollingHome.trend === '🧊🧊' ? 'cold' : 'neutral' } : null,
            pitcher: prediction.homePitcher || null
          }));
        }
      }

      if (bestBook.awayML) {
        const bookAwayProb = mlToProb(bestBook.awayML);
        const awayEdge = awayWP - bookAwayProb;
        
        if (awayEdge >= minEdge) {
          const k = kellySize(awayWP, bestBook.awayML);
          const ev = evPer100(awayWP, bestBook.awayML);
          
          allPicks.push(buildPick({
            sport: sportKey, market: 'moneyline',
            pick: `${awayAbbr} ML (${bestBook.awayML > 0 ? '+' : ''}${bestBook.awayML})`,
            side: 'away', edge: awayEdge,
            modelProb: awayWP, bookProb: bookAwayProb,
            ml: bestBook.awayML, ev, kelly: { full: +k.toFixed(3), half: +(k/2).toFixed(3), quarter: +(k/4).toFixed(3) },
            game: gameId, prediction,
            lineMovement: gameLineMovement ? { steam: gameLineMovement.steam, rlm: gameLineMovement.rlm, direction: 'away' } : null,
            weather: gameWeather,
            injuries: gameInjuriesHome && gameInjuriesAway ? {
              advantage: (gameInjuriesHome.adjFactor || 0) < (gameInjuriesAway.adjFactor || 0),
              note: `${awayAbbr} ${gameInjuriesAway.starPlayersOut.length} out, ${homeAbbr} ${gameInjuriesHome.starPlayersOut.length} out`
            } : null,
            rolling: gameRollingAway ? { trend: gameRollingAway.trend === '🔥🔥' ? 'hot' : gameRollingAway.trend === '🧊🧊' ? 'cold' : 'neutral' } : null,
            pitcher: prediction.awayPitcher || null
          }));
        }
      }

      // ==================== TOTALS VALUE ====================
      if (bestBook.total && prediction.totals && prediction.totals.lines) {
        const line = bestBook.total;
        const poissonData = prediction.totals.lines[line];
        
        // Monte Carlo enhanced totals (if available from MLB asyncPredict)
        const mcTotal = prediction.monteCarlo?.totalRuns?.mean || null;
        const mcOverProb = prediction.monteCarlo?.totalRuns?.overProb?.[line] || null;
        const mcUnderProb = prediction.monteCarlo?.totalRuns?.underProb?.[line] || null;
        
        if (poissonData) {
          // Use blended probability if Monte Carlo is available
          const overProb = mcOverProb ? (poissonData.over * 0.6 + mcOverProb * 0.4) : poissonData.over;
          const underProb = mcUnderProb ? (poissonData.under * 0.6 + mcUnderProb * 0.4) : poissonData.under;
          
          // Build umpire context for totals (umpire zone matters A LOT for O/U)
          const umpireContext = gameUmpire ? {
            favorable: gameUmpire.multiplier > 1.02,
            note: gameUmpire.name ? `HP Umpire: ${gameUmpire.name} (${gameUmpire.zone || 'unknown'} zone, ${((gameUmpire.multiplier - 1) * 100).toFixed(1)}% runs adj)` :
              `Umpire adj: ${((gameUmpire.multiplier - 1) * 100).toFixed(1)}% runs`
          } : null;
          
          // Over value
          const overEdge = overProb - 0.522; // account for -110 juice
          if (overEdge >= minEdge) {
            allPicks.push(buildPick({
              sport: sportKey, market: 'total',
              pick: `Over ${line} (${gameId})`,
              side: 'over', edge: overEdge,
              modelProb: overProb, bookProb: 0.522,
              ml: poissonData.overML, modelTotal: prediction.totals.projTotal, bookTotal: line,
              diff: +(prediction.totals.projTotal - line).toFixed(1),
              game: gameId, prediction,
              weather: gameWeather ? {
                favorable: gameWeather.multiplier > 1.03,
                note: gameWeather.multiplier > 1.03 ? 'Weather boosts scoring' : gameWeather.note
              } : null,
              umpire: umpireContext && umpireContext.favorable ? umpireContext : null,
              mcTotal
            }));
          }

          // Under value
          const underEdge = underProb - 0.522;
          if (underEdge >= minEdge) {
            allPicks.push(buildPick({
              sport: sportKey, market: 'total',
              pick: `Under ${line} (${gameId})`,
              side: 'under', edge: underEdge,
              modelProb: underProb, bookProb: 0.522,
              ml: poissonData.underML, modelTotal: prediction.totals.projTotal, bookTotal: line,
              diff: +(line - prediction.totals.projTotal).toFixed(1),
              game: gameId, prediction,
              weather: gameWeather ? {
                favorable: gameWeather.multiplier < 0.97,
                note: gameWeather.multiplier < 0.97 ? 'Weather suppresses scoring' : gameWeather.note
              } : null,
              umpire: umpireContext && !umpireContext.favorable ? umpireContext : null,
              mcTotal
            }));
          }
        }
      }

    } catch (e) {
      errors.push({ game: game.id || 'unknown', error: e.message });
    }
  }

  // ==================== RANK & FILTER ====================
  
  // Sort by confidence * edge (best bets first)
  allPicks.sort((a, b) => {
    const aScore = a.confidence * (a.edge || 0) * 10;
    const bScore = b.confidence * (b.edge || 0) * 10;
    return bScore - aScore;
  });

  // Limit to maxPicks
  const topPicks = allPicks.slice(0, maxPicks);

  // ==================== BANKROLL ADVICE ====================
  
  const bankrollAdvice = calculateBankrollAdvice(topPicks, bankroll, kellyFraction);

  // ==================== SUMMARY ====================
  
  const summary = {
    totalGamesScanned: oddsData.length,
    totalPicksFound: allPicks.length,
    topPicks: topPicks.length,
    bySport: {},
    byMarket: {},
    byTier: {},
    averageEdge: allPicks.length > 0 ? +(allPicks.reduce((s, p) => s + p.edge, 0) / allPicks.length).toFixed(3) : 0,
    averageConfidence: topPicks.length > 0 ? +(topPicks.reduce((s, p) => s + p.confidence, 0) / topPicks.length).toFixed(1) : 0,
    totalExpectedValue: bankrollAdvice.totalExpectedProfit,
    generated: new Date().toISOString()
  };

  // Count by sport
  for (const p of allPicks) {
    summary.bySport[p.sport] = (summary.bySport[p.sport] || 0) + 1;
    summary.byMarket[p.market] = (summary.byMarket[p.market] || 0) + 1;
    summary.byTier[p.tier] = (summary.byTier[p.tier] || 0) + 1;
  }

  const result = {
    date: new Date().toISOString().split('T')[0],
    picks: topPicks,
    allPicks: allPicks.length, // total found
    summary,
    bankrollAdvice,
    errors: errors.length > 0 ? errors : undefined
  };

  // Cache results
  try {
    fs.writeFileSync(PICKS_FILE, JSON.stringify(result, null, 2));
  } catch (e) { /* cache write failed */ }

  // Append to history
  try {
    let history = [];
    if (fs.existsSync(PICKS_HISTORY)) {
      history = JSON.parse(fs.readFileSync(PICKS_HISTORY, 'utf8'));
    }
    history.push({
      date: result.date,
      picksCount: topPicks.length,
      totalFound: allPicks.length,
      avgEdge: summary.averageEdge,
      avgConfidence: summary.averageConfidence,
      expectedProfit: bankrollAdvice.totalExpectedProfit,
      topPick: topPicks[0] ? topPicks[0].pick : null,
      topPickConfidence: topPicks[0] ? topPicks[0].confidence : null
    });
    // Keep last 90 days
    if (history.length > 90) history = history.slice(-90);
    fs.writeFileSync(PICKS_HISTORY, JSON.stringify(history, null, 2));
  } catch (e) { /* history write failed */ }

  return result;
}

// ==================== BANKROLL MANAGEMENT ====================

function calculateBankrollAdvice(picks, bankroll, kellyFraction) {
  let totalWager = 0;
  let totalExpectedProfit = 0;
  const allocations = [];

  for (const pick of picks) {
    let wagerSize = 0;
    
    if (pick.kelly && pick.kelly.half) {
      // Use Kelly fraction
      wagerSize = bankroll * pick.kelly[kellyFraction === 1 ? 'full' : kellyFraction === 0.25 ? 'quarter' : 'half'];
    } else if (pick.edge > 0) {
      // Flat bet fallback: 1-3% of bankroll based on confidence
      const pctOfBankroll = pick.confidence >= 70 ? 0.03 : pick.confidence >= 50 ? 0.02 : 0.01;
      wagerSize = bankroll * pctOfBankroll;
    }

    // Cap individual bet at 5% of bankroll
    wagerSize = Math.min(wagerSize, bankroll * 0.05);
    wagerSize = Math.max(0, +wagerSize.toFixed(2));

    if (wagerSize > 0) {
      const expectedProfit = wagerSize * (pick.edge || 0);
      totalWager += wagerSize;
      totalExpectedProfit += expectedProfit;

      allocations.push({
        pick: pick.pick,
        wager: wagerSize,
        expectedProfit: +expectedProfit.toFixed(2),
        riskReward: pick.ml ? (pick.ml > 0 ? `Win $${+(wagerSize * pick.ml / 100).toFixed(2)}` : `Win $${+(wagerSize * 100 / -pick.ml).toFixed(2)}`) : null
      });
    }
  }

  // Cap total exposure at 25% of bankroll
  if (totalWager > bankroll * 0.25) {
    const scale = (bankroll * 0.25) / totalWager;
    for (const a of allocations) {
      a.wager = +(a.wager * scale).toFixed(2);
      a.expectedProfit = +(a.expectedProfit * scale).toFixed(2);
    }
    totalWager = +(totalWager * scale).toFixed(2);
    totalExpectedProfit = +(totalExpectedProfit * scale).toFixed(2);
  }

  return {
    bankroll,
    kellyFraction,
    totalWager: +totalWager.toFixed(2),
    totalExpectedProfit: +totalExpectedProfit.toFixed(2),
    expectedROI: totalWager > 0 ? +((totalExpectedProfit / totalWager) * 100).toFixed(1) : 0,
    riskPercent: +((totalWager / bankroll) * 100).toFixed(1),
    allocations
  };
}

// ==================== BEST LINE EXTRACTION ====================

function extractBestBookLines(game) {
  const bookmakers = game.bookmakers || [];
  if (bookmakers.length === 0) return null;

  let bestHomeML = null, bestAwayML = null, bestTotal = null;
  let bestHomeName = '', bestAwayName = '', bestTotalName = '';

  for (const bk of bookmakers) {
    for (const mkt of (bk.markets || [])) {
      if (mkt.key === 'h2h') {
        for (const o of mkt.outcomes) {
          if (o.name === game.home_team || o.name === game.homeTeam) {
            if (bestHomeML === null || o.price > bestHomeML) {
              bestHomeML = o.price;
              bestHomeName = bk.title || bk.key;
            }
          } else {
            if (bestAwayML === null || o.price > bestAwayML) {
              bestAwayML = o.price;
              bestAwayName = bk.title || bk.key;
            }
          }
        }
      }
      if (mkt.key === 'totals') {
        for (const o of mkt.outcomes) {
          if (o.name === 'Over' && o.point) {
            if (bestTotal === null) bestTotal = o.point;
          }
        }
      }
    }
  }

  if (!bestHomeML && !bestAwayML) return null;

  return {
    homeML: bestHomeML,
    awayML: bestAwayML,
    total: bestTotal,
    bestHomeBook: bestHomeName,
    bestAwayBook: bestAwayName
  };
}

// ==================== MATH HELPERS ====================

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function evPer100(modelProb, ml) {
  const payout = ml > 0 ? ml : 100 / (-ml / 100);
  return modelProb * payout - (1 - modelProb) * 100;
}

function kellySize(modelProb, ml) {
  const b = ml > 0 ? ml / 100 : 100 / (-ml);
  const q = 1 - modelProb;
  const kelly = (b * modelProb - q) / b;
  return Math.max(0, kelly);
}

// ==================== CACHED PICKS ====================

function getCachedPicks() {
  try {
    if (fs.existsSync(PICKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
      // Check if cache is from today and less than 30 min old
      const cacheTime = new Date(data.summary?.generated || 0);
      const age = Date.now() - cacheTime.getTime();
      if (data.date === new Date().toISOString().split('T')[0] && age < 30 * 60 * 1000) {
        return data;
      }
    }
  } catch (e) {}
  return null;
}

function getPicksHistory() {
  try {
    if (fs.existsSync(PICKS_HISTORY)) {
      return JSON.parse(fs.readFileSync(PICKS_HISTORY, 'utf8'));
    }
  } catch (e) {}
  return [];
}

module.exports = {
  generateDailyPicks,
  getCachedPicks,
  getPicksHistory,
  calculateConfidence,
  buildPick,
  calculateBankrollAdvice
};
