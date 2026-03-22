/**
 * Opening Day Playbook Cache Service
 * 
 * Pre-computes the OD playbook in the background with parallelized signal fetching.
 * Solves the timeout issue by:
 * 1. Pre-fetching ALL weather data once for all parks (single batch)
 * 2. Using synchronous predict() with pre-fetched data (no redundant asyncPredict network calls)
 * 3. Processing all 20 games in parallel
 * 4. Caching results with 10-min TTL
 * 5. Pre-computing on startup
 * 
 * v67.0 - CRITICAL FIX: asyncPredict was re-fetching weather/lineup/umpire per game
 *   = 20×4 = 80 redundant network calls within 8s timeout → F5/conviction all falling back to Poisson.
 *   Fix: pre-fetch shared data once, pass to predict() directly. NB F5/conviction are synchronous.
 */

let cachedPlaybook = null;
let cacheTimestamp = null;
let isBuilding = false;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min cache

// Dependencies injected from server
let deps = {};

function init(dependencies) {
  deps = dependencies;
  console.log('[od-playbook-cache] Initialized with dependencies');
}

/**
 * Pre-fetch weather for all unique home parks in a single batch
 */
async function prefetchWeather(games) {
  const weatherMap = {};
  if (!deps.weather) return weatherMap;
  
  const uniqueParks = [...new Set(games.map(g => g.home))];
  const promises = uniqueParks.map(async (homeAbbr) => {
    try {
      const wx = await deps.weather.getWeatherForPark(homeAbbr);
      if (wx && !wx.error) {
        weatherMap[homeAbbr] = wx;
      }
    } catch (e) { /* weather optional */ }
  });
  
  await Promise.race([
    Promise.all(promises),
    new Promise(resolve => setTimeout(resolve, 6000)) // 6s max for weather batch
  ]);
  
  return weatherMap;
}

/**
 * Pre-fetch lineup data for all games in a single batch
 */
async function prefetchLineups(games) {
  const lineupMap = {};
  if (!deps.lineupFetcher) return lineupMap;
  
  const promises = games.map(async (game) => {
    const key = `${game.away}@${game.home}`;
    try {
      const lineupAdj = await deps.lineupFetcher.getLineupAdjustments(game.away, game.home);
      if (lineupAdj && lineupAdj.hasData) {
        lineupMap[key] = lineupAdj;
      }
    } catch (e) { /* lineup optional */ }
  });
  
  await Promise.race([
    Promise.all(promises),
    new Promise(resolve => setTimeout(resolve, 6000)) // 6s max for lineups
  ]);
  
  return lineupMap;
}

/**
 * Pre-fetch umpire assignments (single call covers all games)
 */
async function prefetchUmpires() {
  const umpireMap = {};
  if (!deps.umpireService || !deps.umpireService.fetchTodaysAssignments) return umpireMap;
  
  try {
    const assignments = await deps.umpireService.fetchTodaysAssignments();
    if (assignments && assignments.games) {
      for (const game of assignments.games) {
        const away = game.away?.toUpperCase();
        const home = game.home?.toUpperCase();
        if (away && home) {
          const key = `${away}@${home}`;
          const umpName = game.homePlateUmpire || game.umpireData?.name;
          if (umpName) {
            const ump = deps.umpireService.getUmpire(umpName);
            if (ump) {
              const umpAdj = deps.umpireService.calcTotalRunsMultiplier(ump);
              umpireMap[key] = { name: ump.name, zone: ump.zone, ...umpAdj };
            }
          }
        }
      }
    }
  } catch (e) { /* umpire optional */ }
  
  return umpireMap;
}

/**
 * Process a single game's signals — uses pre-fetched data, no redundant network calls
 */
function processGame(game, liveOdds, nameMap, minEdge, bankroll, kellyFraction, prefetched) {
  const entry = {
    away: game.away,
    home: game.home,
    date: game.date,
    day: game.day,
    time: game.time,
    park: game.park,
    parkFactor: game.parkFactor,
    awayStarter: game.awayStarter,
    homeStarter: game.homeStarter,
    signals: {},
    bets: [],
  };

  // ============================================
  // STEP 1: Run predict() with pre-fetched data
  // This gives us NB F5, conviction, run lines — ALL synchronous, no network calls
  // ============================================
  let fullPred = null;
  try {
    if (deps.mlb && deps.mlb.predict) {
      const matchupKey = `${game.away}@${game.home}`;
      const predictOpts = {
        awayPitcher: game.awayStarter?.name,
        homePitcher: game.homeStarter?.name,
      };
      
      // Inject pre-fetched weather
      const weatherData = prefetched.weather[game.home];
      if (weatherData && weatherData.multiplier) {
        predictOpts.weather = weatherData;
      }
      
      // Inject pre-fetched lineup
      const lineupData = prefetched.lineups[matchupKey];
      if (lineupData) {
        predictOpts.lineup = lineupData;
      }
      
      // Inject pre-fetched umpire
      const umpireData = prefetched.umpires[matchupKey];
      if (umpireData) {
        predictOpts.umpire = umpireData;
      }
      
      fullPred = deps.mlb.predict(game.away, game.home, predictOpts);
    }
  } catch (e) {
    console.error(`[od-playbook-cache] predict() error for ${game.away}@${game.home}:`, e.message);
  }

  // Use fullPred for analytical base if available (has all signal adjustments)
  if (fullPred) {
    entry.signals.analytical = {
      homeWinProb: fullPred.homeWinProb,
      awayWinProb: fullPred.awayWinProb,
      homeExpRuns: fullPred.homeExpRuns,
      awayExpRuns: fullPred.awayExpRuns,
      totalRuns: fullPred.totalRuns || fullPred.expectedTotal,
      homeML: fullPred.homeML,
      awayML: fullPred.awayML,
    };
  } else {
    // Fallback to game.prediction (from getProjections)
    entry.signals.analytical = {
      homeWinProb: game.prediction.homeWinProb,
      awayWinProb: game.prediction.awayWinProb,
      homeExpRuns: game.prediction.homeExpRuns,
      awayExpRuns: game.prediction.awayExpRuns,
      totalRuns: game.prediction.totalRuns || game.prediction.expectedTotal,
      homeML: game.prediction.homeML,
      awayML: game.prediction.awayML,
    };
  }

  // ============================================
  // STEP 2: Extract F5/NB/Conviction from predict() result (synchronous)
  // ============================================
  if (fullPred && fullPred.f5 && fullPred.f5.model === 'negative-binomial-f5') {
    const f5 = fullPred.f5;
    const f5Lines = {};
    for (const line of [4.5, 5.0, 5.5]) {
      const lineData = f5.totals?.[line];
      if (lineData) {
        f5Lines[line] = { 
          underPct: +(lineData.under * 100).toFixed(1), 
          overPct: +(lineData.over * 100).toFixed(1),
          underML: lineData.underML,
          overML: lineData.overML,
        };
      }
    }
    
    entry.signals.f5 = {
      model: 'negative-binomial',
      expectedTotal: f5.total,
      awayF5Runs: f5.awayRuns,
      homeF5Runs: f5.homeRuns,
      homeWinProb: f5.homeWinProb,
      awayWinProb: f5.awayWinProb,
      drawProb: f5.drawProb,
      threeWayML: f5.threeWay,
      twoWayML: f5.twoWay,
      lines: f5Lines,
      bestUnder: f5.total < 4.5 ? 'U4.5' : f5.total < 5.0 ? 'U5.0' : 'U5.5',
      runLines: f5.runLines || null,
      teamTotals: f5.teamTotals || null,
    };
  }
  
  // Run line analysis from predict()
  if (fullPred && fullPred.altRunLines) {
    entry.signals.runLines = {
      model: 'negative-binomial',
      home: fullPred.altRunLines.home,
      away: fullPred.altRunLines.away,
      marginDist: fullPred.altRunLines.marginDist,
    };
  }
  
  // Conviction score from predict()
  if (fullPred && fullPred.conviction) {
    entry.signals.conviction = fullPred.conviction;
  }

  // Opening week unders from predict()
  if (fullPred && fullPred.openingWeek) {
    entry.signals.openingWeek = fullPred.openingWeek;
  }

  // ============================================
  // STEP 3: All other signals (sync — no network calls)
  // ============================================

  // CALIBRATED PROBABILITIES
  try {
    if (deps.calibration) {
      const calPred = deps.calibration.calibratePrediction({
        homeWinProb: entry.signals.analytical.homeWinProb,
        awayWinProb: entry.signals.analytical.awayWinProb,
      }, 'mlb');
      entry.signals.calibrated = {
        homeWinProb: calPred.homeWinProb,
        awayWinProb: calPred.awayWinProb,
      };
    }
  } catch (e) { /* calibration optional */ }

  // WEATHER (from pre-fetched data)
  try {
    const wx = prefetched.weather[game.home];
    if (wx) {
      const wxData = wx.weather || {};
      entry.signals.weather = {
        temp: wxData.temp,
        wind: wxData.wind,
        windDir: wxData.windDir,
        humidity: wxData.humidity,
        runMultiplier: wx.multiplier || 1.0,
        condition: wx.description,
        impact: (wx.multiplier || 1.0) > 1.03 ? 'OVER' : (wx.multiplier || 1.0) < 0.97 ? 'UNDER' : 'NEUTRAL',
        factors: wx.factors,
      };
    }
  } catch (e) { /* weather optional */ }

  // UMPIRE (from pre-fetched data)
  try {
    const matchupKey = `${game.away}@${game.home}`;
    const umpData = prefetched.umpires[matchupKey];
    if (umpData) {
      entry.signals.umpire = {
        name: umpData.name,
        zone: umpData.zone,
        runsPerGame: umpData.runsPerGame,
        tendency: umpData.tendency,
        totalAdj: umpData.totalAdj || umpData.runsAdj || umpData.multiplier ? (umpData.multiplier - 1) * 9 : 0,
      };
    } else {
      entry.signals.umpire = { totalAdj: 0 };
    }
  } catch (e) { entry.signals.umpire = { totalAdj: 0 }; }

  // PRESEASON TUNING
  try {
    if (deps.preseasonTuning) {
      const awayAdj = deps.preseasonTuning.getOpeningDayAdjustments(game.away);
      const homeAdj = deps.preseasonTuning.getOpeningDayAdjustments(game.home);
      const awayBP = deps.preseasonTuning.getBullpenUncertainty(game.away);
      const homeBP = deps.preseasonTuning.getBullpenUncertainty(game.home);
      
      entry.signals.preseason = {
        away: { adjustments: awayAdj, bullpen: awayBP },
        home: { adjustments: homeAdj, bullpen: homeBP },
      };
      
      const awayNTP = deps.preseasonTuning.getNewTeamPenalty(game.awayStarter?.name);
      const homeNTP = deps.preseasonTuning.getNewTeamPenalty(game.homeStarter?.name);
      if (awayNTP) entry.signals.preseason.awayNewTeamPenalty = awayNTP;
      if (homeNTP) entry.signals.preseason.homeNewTeamPenalty = homeNTP;
    }
  } catch (e) { /* preseason optional */ }

  // STATCAST EDGE
  try {
    if (deps.statcast) {
      if (game.awayStarter?.name) {
        const sc = deps.statcast.getStatcastPitcherAdjustment(game.awayStarter.name);
        if (sc) entry.signals.awayPitcherStatcast = sc;
      }
      if (game.homeStarter?.name) {
        const sc = deps.statcast.getStatcastPitcherAdjustment(game.homeStarter.name);
        if (sc) entry.signals.homePitcherStatcast = sc;
      }
      const awayBat = deps.statcast.getTeamBattingStatcast(game.away);
      const homeBat = deps.statcast.getTeamBattingStatcast(game.home);
      if (awayBat) entry.signals.awayBattingXwoba = awayBat;
      if (homeBat) entry.signals.homeBattingXwoba = homeBat;
    }
  } catch (e) { /* statcast optional */ }

  // ROLLING STATS
  try {
    if (deps.rollingStats) {
      const awayRoll = deps.rollingStats.getRollingAdjustment('mlb', game.away);
      const homeRoll = deps.rollingStats.getRollingAdjustment('mlb', game.home);
      if (awayRoll) entry.signals.awayRolling = awayRoll;
      if (homeRoll) entry.signals.homeRolling = homeRoll;
    }
  } catch (e) { /* rolling optional */ }

  // INJURIES
  try {
    if (deps.injuries) {
      const awayInj = deps.injuries.getInjuryAdjustment('mlb', game.away);
      const homeInj = deps.injuries.getInjuryAdjustment('mlb', game.home);
      if (awayInj) entry.signals.awayInjuries = awayInj;
      if (homeInj) entry.signals.homeInjuries = homeInj;
    }
  } catch (e) { /* injuries optional */ }

  // BULLPEN QUALITY PROJECTIONS
  try {
    if (deps.bullpenQuality) {
      const teams = deps.mlb.getTeams();
      const bpAnalysis = deps.bullpenQuality.analyzeBullpenMatchup(game.away, game.home, teams);
      if (bpAnalysis) {
        entry.signals.bullpenQuality = {
          awayProjectedEra: bpAnalysis.away.projectedEra,
          homeProjectedEra: bpAnalysis.home.projectedEra,
          awayDelta: bpAnalysis.away.delta,
          homeDelta: bpAnalysis.home.delta,
          eraGap: bpAnalysis.eraGap,
          advantage: bpAnalysis.advantage,
          totalDirection: bpAnalysis.totalDirection,
          totalImpact: bpAnalysis.totalImpact,
          closerMatchup: bpAnalysis.closerMatchup,
          awayCloser: bpAnalysis.away.closer,
          homeCloser: bpAnalysis.home.closer,
          bettingImplications: bpAnalysis.bettingImplications,
          f5Signal: bpAnalysis.f5Signal,
        };
      }
    }
  } catch (e) { /* bullpen quality optional */ }

  // STOLEN BASE REVOLUTION
  try {
    if (deps.stolenBaseModel) {
      const sbAdj = deps.stolenBaseModel.getSBTotalsAdjustment(game.away, game.home);
      if (sbAdj) {
        entry.signals.stolenBases = {
          awayExtra: sbAdj.awaySBExtra,
          homeExtra: sbAdj.homeSBExtra,
          netAdjustment: sbAdj.netAdjustment,
          awayTier: sbAdj.awayTier,
          homeTier: sbAdj.homeTier,
          totalsImpact: sbAdj.totalsImpact,
        };
      }
    }
  } catch (e) { /* stolen bases optional */ }

  // LINEUP DATA (from pre-fetched)
  try {
    const matchupKey = `${game.away}@${game.home}`;
    const lineupAdj = prefetched.lineups[matchupKey];
    if (lineupAdj && lineupAdj.hasData) {
      entry.signals.lineup = {
        awayRunAdj: lineupAdj.awayRunAdj,
        homeRunAdj: lineupAdj.homeRunAdj,
        awayStars: lineupAdj.details?.awayStars || 0,
        homeStars: lineupAdj.details?.homeStars || 0,
        awayCatcher: lineupAdj.details?.awayCatcher || null,
        homeCatcher: lineupAdj.details?.homeCatcher || null,
        status: 'confirmed',
      };
    } else {
      entry.signals.lineup = { status: 'pending', note: 'Lineups not yet confirmed' };
    }
  } catch (e) { /* lineup optional */ }

  // ============================================
  // F5 FALLBACK: If NB predict didn't produce F5, use Poisson
  // ============================================
  if (!entry.signals.f5) {
    try {
      const awayExpRuns = entry.signals.analytical?.awayExpRuns || 4.3;
      const homeExpRuns = entry.signals.analytical?.homeExpRuns || 4.3;
      const f5Factor = 0.565;
      let owReduction = 1.0;
      
      if (deps.openingWeekUnders) {
        const owAdj = deps.openingWeekUnders.getOpeningWeekAdjustment(game.date, game.park || '', {
          homeStarterTier: 2,
          awayStarterTier: 2,
        });
        if (owAdj && owAdj.reduction) owReduction = 1 - owAdj.reduction;
      }
      
      const awayF5 = awayExpRuns * f5Factor * owReduction;
      const homeF5 = homeExpRuns * f5Factor * owReduction;
      const f5Total = +(awayF5 + homeF5).toFixed(2);
      
      const poissonPMF = (k, lambda) => Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
      const factorial = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
      
      const f5Lines = {};
      for (const line of [4.5, 5.0, 5.5]) {
        let underP = 0;
        for (let a = 0; a <= 12; a++) {
          for (let h = 0; h <= 12; h++) {
            if (a + h < line) {
              underP += poissonPMF(a, awayF5) * poissonPMF(h, homeF5);
            }
          }
        }
        f5Lines[line] = { underPct: +(underP * 100).toFixed(1), overPct: +((1 - underP) * 100).toFixed(1) };
      }
      
      entry.signals.f5 = {
        model: 'poisson-fallback',
        expectedTotal: f5Total,
        awayF5Runs: +awayF5.toFixed(2),
        homeF5Runs: +homeF5.toFixed(2),
        openingWeekReduction: +((1 - owReduction) * 100).toFixed(1) + '%',
        lines: f5Lines,
        bestUnder: f5Total < 4.5 ? 'U4.5' : f5Total < 5.0 ? 'U5.0' : 'U5.5',
      };
    } catch (e) { /* F5 fallback optional */ }
  }

  // F5 under bet
  if (entry.signals.f5 && entry.signals.f5.model === 'negative-binomial') {
    const f5 = entry.signals.f5;
    const bestF5Line = f5.expectedTotal < 4.75 ? 4.5 : f5.expectedTotal < 5.25 ? 5.0 : 5.5;
    const f5UnderData = f5.lines?.[bestF5Line];
    if (f5UnderData && f5UnderData.underPct > 55) {
      entry.bets.push({
        type: 'F5_TOTAL',
        pick: `F5 UNDER ${bestF5Line}`,
        modelProb: f5UnderData.underPct,
        confidence: f5UnderData.underPct >= 62 ? 'HIGH' : f5UnderData.underPct >= 57 ? 'MEDIUM' : 'LOW',
        model: 'negative-binomial-f5',
        edge: +(f5UnderData.underPct - 50).toFixed(1),
        weatherSupport: entry.signals.weather?.impact === 'UNDER' ? '✅ Weather agrees (cold/wind-in)' : '➖',
        pitcherSupport: (game.awayStarter?.rating >= 70 && game.homeStarter?.rating >= 70) ? '✅ Both aces' : 
                        (game.awayStarter?.rating >= 70 || game.homeStarter?.rating >= 70) ? '📊 One ace' : '➖',
      });
    }
  }

  // ============================================
  // LIVE ODDS MATCHING
  // ============================================
  if (liveOdds && liveOdds.length > 0) {
    for (const oddsGame of liveOdds) {
      const oddsAway = resolveTeam(nameMap, oddsGame.away_team);
      const oddsHome = resolveTeam(nameMap, oddsGame.home_team);
      if (oddsAway === game.away && oddsHome === game.home) {
        const allBooks = {};
        let bestHomeML = null, bestAwayML = null, bestOverTotal = null, bestUnderTotal = null;
        let bestHomeBook = '', bestAwayBook = '', bestOverBook = '', bestUnderBook = '';

        for (const bk of (oddsGame.bookmakers || [])) {
          const line = extractBookLineFast(bk, oddsGame.home_team);
          allBooks[bk.title] = line;

          if (line.homeML && (bestHomeML === null || line.homeML > bestHomeML)) {
            bestHomeML = line.homeML; bestHomeBook = bk.title;
          }
          if (line.awayML && (bestAwayML === null || line.awayML > bestAwayML)) {
            bestAwayML = line.awayML; bestAwayBook = bk.title;
          }
          if (line.total) {
            if (!bestOverTotal) { bestOverTotal = line.total; bestOverBook = bk.title; }
          }
        }

        entry.signals.liveOdds = {
          bookCount: Object.keys(allBooks).length,
          books: allBooks,
          bestHome: { ml: bestHomeML, book: bestHomeBook, implied: bestHomeML ? mlToProb(bestHomeML) : null },
          bestAway: { ml: bestAwayML, book: bestAwayBook, implied: bestAwayML ? mlToProb(bestAwayML) : null },
          bestTotal: bestOverTotal,
        };
        break;
      }
    }
  }

  // DK LINE FALLBACK
  if (!entry.signals.liveOdds && game.dkLine) {
    const dk = game.dkLine;
    entry.signals.liveOdds = {
      bookCount: 1,
      books: { 'DraftKings (pre-OD)': { homeML: dk.homeML, awayML: dk.awayML, total: dk.total || null } },
      bestHome: { ml: dk.homeML, book: 'DraftKings (pre-OD)', implied: dk.homeML ? mlToProb(dk.homeML) : null },
      bestAway: { ml: dk.awayML, book: 'DraftKings (pre-OD)', implied: dk.awayML ? mlToProb(dk.awayML) : null },
      bestTotal: dk.total || null,
      source: 'dk-fallback',
    };
  }

  // ============================================
  // CALCULATE BETS
  // ============================================
  const bestProb = entry.signals.calibrated || entry.signals.analytical;
  const liveOddsData = entry.signals.liveOdds;

  if (liveOddsData) {
    const homeProb = bestProb.homeWinProb;
    const awayProb = bestProb.awayWinProb;
    const homeImplied = liveOddsData.bestHome.implied || 0.5;
    const awayImplied = liveOddsData.bestAway.implied || 0.5;

    const homeEdge = homeProb - homeImplied;
    const awayEdge = awayProb - awayImplied;

    if (homeEdge > minEdge) {
      const mlOdds = liveOddsData.bestHome.ml;
      const decOdds = mlOdds > 0 ? mlOdds / 100 : 100 / Math.abs(mlOdds);
      const kellyPct = kellyFraction * ((homeProb * decOdds - (1 - homeProb)) / decOdds);
      const wager = Math.max(0, Math.min(bankroll * 0.05, bankroll * Math.max(0, kellyPct)));
      entry.bets.push({
        type: 'ML',
        pick: `${game.home} ML`,
        ml: mlOdds,
        book: liveOddsData.bestHome.book,
        modelProb: +(homeProb * 100).toFixed(1),
        bookProb: +(homeImplied * 100).toFixed(1),
        edge: +(homeEdge * 100).toFixed(1),
        kellyPct: +(Math.max(0, kellyPct) * 100).toFixed(1),
        wager: +wager.toFixed(0),
        ev: +(wager * homeEdge / homeImplied).toFixed(2),
        confidence: homeEdge >= 0.08 ? 'HIGH' : homeEdge >= 0.05 ? 'MEDIUM' : 'LOW',
        agreementSources: [],
      });
      const bet = entry.bets[entry.bets.length - 1];
      if (entry.signals.analytical.homeWinProb > homeImplied) bet.agreementSources.push('Analytical');
      if (entry.signals.calibrated?.homeWinProb > homeImplied) bet.agreementSources.push('Calibrated');
    }
    if (awayEdge > minEdge) {
      const mlOdds = liveOddsData.bestAway.ml;
      const decOdds = mlOdds > 0 ? mlOdds / 100 : 100 / Math.abs(mlOdds);
      const kellyPct = kellyFraction * ((awayProb * decOdds - (1 - awayProb)) / decOdds);
      const wager = Math.max(0, Math.min(bankroll * 0.05, bankroll * Math.max(0, kellyPct)));
      entry.bets.push({
        type: 'ML',
        pick: `${game.away} ML`,
        ml: mlOdds,
        book: liveOddsData.bestAway.book,
        modelProb: +(awayProb * 100).toFixed(1),
        bookProb: +(awayImplied * 100).toFixed(1),
        edge: +(awayEdge * 100).toFixed(1),
        kellyPct: +(Math.max(0, kellyPct) * 100).toFixed(1),
        wager: +wager.toFixed(0),
        ev: +(wager * awayEdge / awayImplied).toFixed(2),
        confidence: awayEdge >= 0.08 ? 'HIGH' : awayEdge >= 0.05 ? 'MEDIUM' : 'LOW',
        agreementSources: [],
      });
      const bet = entry.bets[entry.bets.length - 1];
      if (entry.signals.analytical.awayWinProb > awayImplied) bet.agreementSources.push('Analytical');
      if (entry.signals.calibrated?.awayWinProb > awayImplied) bet.agreementSources.push('Calibrated');
    }

    // Total bet
    if (liveOddsData.bestTotal) {
      const modelTotal = entry.signals.analytical.totalRuns || 0;
      const bookTotal = liveOddsData.bestTotal;
      const totalDiff = modelTotal - bookTotal;

      if (Math.abs(totalDiff) >= 0.5) {
        const side = totalDiff > 0 ? 'OVER' : 'UNDER';
        entry.bets.push({
          type: 'TOTAL',
          pick: `${side} ${bookTotal}`,
          modelTotal: +modelTotal.toFixed(1),
          bookTotal,
          diff: +totalDiff.toFixed(1),
          confidence: Math.abs(totalDiff) >= 1.5 ? 'HIGH' : Math.abs(totalDiff) >= 0.8 ? 'MEDIUM' : 'LOW',
          weatherSupport: entry.signals.weather?.impact === side ? '✅ Weather agrees' : entry.signals.weather?.impact === 'NEUTRAL' ? '➖ Neutral weather' : '⚠️ Weather disagrees',
          umpireSupport: entry.signals.umpire?.tendency === (side === 'OVER' ? 'over' : 'under') ? '✅ Umpire agrees' : '➖',
        });
      }
    }
  }

  // ============================================
  // OVERALL GAME RATING
  // ============================================
  const totalSignals = Object.keys(entry.signals).filter(k => !k.includes('Error')).length;
  const hasBets = entry.bets.length > 0;
  const maxEdge = hasBets ? Math.max(...entry.bets.map(b => b.edge || 0)) : 0;
  const convictionGrade = entry.signals.conviction?.grade;
  
  let grade;
  if (convictionGrade && entry.signals.conviction?.score >= 50) {
    grade = convictionGrade;
  } else {
    grade = maxEdge >= 8 ? 'A+' : maxEdge >= 6 ? 'A' : maxEdge >= 4 ? 'B' : maxEdge >= 2 ? 'C' : 'D';
  }
  
  entry.gameRating = {
    signalCount: totalSignals,
    betCount: entry.bets.length,
    maxEdge,
    grade,
    conviction: entry.signals.conviction ? {
      score: entry.signals.conviction.score,
      grade: entry.signals.conviction.grade,
      action: entry.signals.conviction.action,
    } : null,
    totalWager: entry.bets.reduce((s, b) => s + (b.wager || 0), 0),
    totalEV: +entry.bets.reduce((s, b) => s + (b.ev || 0), 0).toFixed(2),
  };

  return entry;
}

/**
 * Helper: convert ML odds to probability
 */
function mlToProb(ml) {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

/**
 * Fast book line extraction (no external dependency needed)
 */
function extractBookLineFast(bk, homeTeam) {
  const line = {};
  for (const mkt of (bk.markets || [])) {
    if (mkt.key === 'h2h') {
      for (const o of (mkt.outcomes || [])) {
        if (o.name === homeTeam) line.homeML = o.price;
        else line.awayML = o.price;
      }
    }
    if (mkt.key === 'totals') {
      for (const o of (mkt.outcomes || [])) {
        if (o.name === 'Over') {
          line.total = o.point;
          line.overOdds = o.price;
        }
        if (o.name === 'Under') {
          line.underOdds = o.price;
        }
      }
    }
    if (mkt.key === 'spreads') {
      for (const o of (mkt.outcomes || [])) {
        if (o.name === homeTeam) {
          line.homeSpread = o.point;
          line.homeSpreadOdds = o.price;
        } else {
          line.awaySpread = o.point;
          line.awaySpreadOdds = o.price;
        }
      }
    }
  }
  return line;
}

/**
 * Resolve team name from odds to abbreviation
 */
function resolveTeam(nameMap, rawName) {
  if (!rawName) return null;
  const lower = rawName.toLowerCase().trim();
  if (nameMap[lower]) return nameMap[lower];
  const words = lower.split(' ');
  const last = words[words.length - 1];
  if (nameMap[last]) return nameMap[last];
  if (nameMap[words[0]]) return nameMap[words[0]];
  return null;
}

/**
 * Build the full playbook — pre-fetches shared data, then runs all games synchronously
 */
async function buildPlaybook(bankroll = 1000, kellyFraction = 0.5, minEdge = 0.02) {
  const startTime = Date.now();
  console.log('[od-playbook-cache] Building playbook v67...');
  
  const projections = await deps.mlbOpeningDay.getProjections();
  if (!projections || !projections.games || projections.games.length === 0) {
    return { error: 'No Opening Day projections available', games: [] };
  }

  // ====================================
  // PHASE 1: Pre-fetch ALL shared data in parallel (single batch)
  // This eliminates 80+ redundant network calls from the old per-game asyncPredict
  // ====================================
  console.log(`[od-playbook-cache] Pre-fetching shared data for ${projections.games.length} games...`);
  
  const [weatherMap, lineupMap, umpireMap, liveOdds] = await Promise.all([
    prefetchWeather(projections.games),
    prefetchLineups(projections.games),
    prefetchUmpires(),
    (async () => {
      try {
        if (deps.fetchOdds) return await deps.fetchOdds('baseball_mlb');
      } catch (e) { /* no odds yet */ }
      return [];
    })(),
  ]);
  
  const prefetched = { weather: weatherMap, lineups: lineupMap, umpires: umpireMap };
  const prefetchTime = Date.now() - startTime;
  console.log(`[od-playbook-cache] Pre-fetch done in ${prefetchTime}ms — weather:${Object.keys(weatherMap).length} lineups:${Object.keys(lineupMap).length} umpires:${Object.keys(umpireMap).length}`);

  // Build name map for odds matching
  const teams = deps.mlb.TEAMS || deps.mlb.getTeams();
  const nameMap = {};
  const extraAliases = {
    'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS',
    'blue jays': 'TOR', 'padres': 'SD', 'giants': 'SF', 'rays': 'TB', 'royals': 'KC',
  };
  
  if (teams) {
    for (const [abbr, data] of Object.entries(teams)) {
      const name = (data.name || '').toLowerCase();
      nameMap[name] = abbr;
      const words = name.split(' ');
      nameMap[words[words.length - 1]] = abbr;
      nameMap[abbr.toLowerCase()] = abbr;
    }
  }
  Object.assign(nameMap, extraAliases);

  // ====================================
  // PHASE 2: Process ALL games (now synchronous per game — no network calls!)
  // ====================================
  const playbook = [];
  for (const game of projections.games) {
    try {
      const entry = processGame(game, liveOdds, nameMap, minEdge, bankroll, kellyFraction, prefetched);
      playbook.push(entry);
    } catch (err) {
      console.error(`[od-playbook-cache] Error processing ${game.away}@${game.home}:`, err.message);
      playbook.push({
        away: game.away, home: game.home, date: game.date,
        signals: { error: err.message }, bets: [],
        gameRating: { grade: 'D', signalCount: 0, betCount: 0, maxEdge: 0, totalWager: 0, totalEV: 0 },
      });
    }
  }

  // Sort by grade
  const gradeOrder = { 'A+': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
  playbook.sort((a, b) => (gradeOrder[a.gameRating?.grade] || 99) - (gradeOrder[b.gameRating?.grade] || 99));

  // Portfolio summary
  const allBets = playbook.flatMap(g => g.bets || []);
  const portfolio = {
    totalBets: allBets.length,
    totalWager: +allBets.reduce((s, b) => s + (b.wager || 0), 0).toFixed(0),
    totalEV: +allBets.reduce((s, b) => s + (b.ev || 0), 0).toFixed(2),
    avgEdge: allBets.length > 0 ? +(allBets.reduce((s, b) => s + (b.edge || 0), 0) / allBets.length).toFixed(1) : 0,
    highConfBets: allBets.filter(b => b.confidence === 'HIGH').length,
    mlBets: allBets.filter(b => b.type === 'ML').length,
    totalBets_total: allBets.filter(b => b.type === 'TOTAL').length,
    f5Bets: allBets.filter(b => b.type === 'F5_TOTAL').length,
    bankroll,
    kellyFraction,
  };

  // Count signal quality
  const nbF5Count = playbook.filter(g => g.signals.f5?.model === 'negative-binomial').length;
  const convictionCount = playbook.filter(g => g.signals.conviction).length;
  const runLineCount = playbook.filter(g => g.signals.runLines?.model === 'negative-binomial').length;

  const elapsed = Date.now() - startTime;
  console.log(`[od-playbook-cache] Built playbook in ${elapsed}ms — ${playbook.length} games, ${allBets.length} bets, NB-F5:${nbF5Count}/${playbook.length}, conviction:${convictionCount}, runLines:${runLineCount}`);

  return {
    timestamp: new Date().toISOString(),
    openingDay: '2026-03-26',
    daysUntil: Math.ceil((new Date('2026-03-26') - new Date()) / (1000 * 60 * 60 * 24)),
    totalGames: playbook.length,
    buildTimeMs: elapsed,
    signalQuality: {
      nbF5: `${nbF5Count}/${playbook.length}`,
      conviction: `${convictionCount}/${playbook.length}`,
      runLines: `${runLineCount}/${playbook.length}`,
      weather: `${Object.keys(weatherMap).length}/${projections.games.length}`,
      lineups: `${Object.keys(lineupMap).length}/${projections.games.length}`,
      umpires: `${Object.keys(umpireMap).length}`,
    },
    portfolio,
    playbook,
  };
}

/**
 * Get the cached playbook or build a new one
 */
async function getPlaybook(bankroll = 1000, kellyFraction = 0.5, minEdge = 0.02) {
  // Return cached if fresh
  if (cachedPlaybook && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return { ...cachedPlaybook, cached: true, cacheAge: Math.round((Date.now() - cacheTimestamp) / 1000) + 's' };
  }

  // Build if not already building
  if (!isBuilding) {
    isBuilding = true;
    try {
      cachedPlaybook = await buildPlaybook(bankroll, kellyFraction, minEdge);
      cacheTimestamp = Date.now();
    } finally {
      isBuilding = false;
    }
    return cachedPlaybook;
  }

  // If currently building and we have stale cache, return stale
  if (cachedPlaybook) {
    return { ...cachedPlaybook, cached: true, stale: true, cacheAge: Math.round((Date.now() - cacheTimestamp) / 1000) + 's' };
  }

  // If currently building and no cache, wait for it
  const maxWait = 30000;
  const start = Date.now();
  while (isBuilding && (Date.now() - start) < maxWait) {
    await new Promise(r => setTimeout(r, 500));
  }
  if (cachedPlaybook) return cachedPlaybook;
  return { error: 'Playbook is still building, try again in a moment' };
}

/**
 * Force rebuild the cache
 */
async function refresh() {
  isBuilding = true;
  try {
    cachedPlaybook = await buildPlaybook();
    cacheTimestamp = Date.now();
    return cachedPlaybook;
  } finally {
    isBuilding = false;
  }
}

module.exports = { init, getPlaybook, refresh, processGame };
