/**
 * Opening Day Playbook Cache Service
 * 
 * Pre-computes the OD playbook in the background with parallelized signal fetching.
 * Solves the timeout issue by:
 * 1. Processing all 20 games in parallel (not sequential)
 * 2. Skipping Python ML bridge in critical path (too slow, 15s timeout × 20 games)
 * 3. Caching results with 10-min TTL
 * 4. Pre-computing on startup
 * 
 * v66.0 - Fix for OD Playbook Timeout (Task 066)
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
 * Process a single game's signals — ALL async calls run in parallel per game
 */
async function processGame(game, liveOdds, nameMap, minEdge, bankroll, kellyFraction) {
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

  // 1. ANALYTICAL MODEL (sync, always available)
  entry.signals.analytical = {
    homeWinProb: game.prediction.homeWinProb,
    awayWinProb: game.prediction.awayWinProb,
    homeExpRuns: game.prediction.homeExpRuns,
    awayExpRuns: game.prediction.awayExpRuns,
    totalRuns: game.prediction.totalRuns || game.prediction.expectedTotal,
    homeML: game.prediction.homeML,
    awayML: game.prediction.awayML,
  };

  // ==========================================
  // PARALLEL SIGNAL FETCHING — ALL at once
  // ==========================================
  const signalPromises = [];

  // 2. ML ENSEMBLE (skip Python bridge — too slow at 15s timeout per game)
  // Instead, run it as optional background enhancement
  // The analytical model + Statcast + calibration is sufficient for edge detection

  // 3. CALIBRATED PROBABILITIES (sync)
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

  // 4. WEATHER (async — parallel)
  signalPromises.push(
    (async () => {
      try {
        if (deps.weather) {
          const wx = await deps.weather.getWeatherForPark(game.home);
          if (wx && !wx.error) {
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
        }
      } catch (e) { /* weather optional */ }
    })()
  );

  // 5. UMPIRE (sync)
  try {
    if (deps.umpireService) {
      const umpData = deps.umpireService.getGameUmpireAdjustment(game.away, game.home);
      if (umpData && !umpData.error) {
        entry.signals.umpire = {
          name: umpData.umpire || umpData.name,
          runsPerGame: umpData.runsPerGame,
          tendency: umpData.tendency,
          totalAdj: umpData.totalAdj || umpData.runsAdj || 0,
        };
      }
    }
  } catch (e) { /* umpire optional */ }

  // 6. PRESEASON TUNING (sync)
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

  // 7. STATCAST EDGE (sync)
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

  // 8. ROLLING STATS (sync)
  try {
    if (deps.rollingStats) {
      const awayRoll = deps.rollingStats.getRollingAdjustment('mlb', game.away);
      const homeRoll = deps.rollingStats.getRollingAdjustment('mlb', game.home);
      if (awayRoll) entry.signals.awayRolling = awayRoll;
      if (homeRoll) entry.signals.homeRolling = homeRoll;
    }
  } catch (e) { /* rolling optional */ }

  // 9. INJURIES (sync)
  try {
    if (deps.injuries) {
      const awayInj = deps.injuries.getInjuryAdjustment('mlb', game.away);
      const homeInj = deps.injuries.getInjuryAdjustment('mlb', game.home);
      if (awayInj) entry.signals.awayInjuries = awayInj;
      if (homeInj) entry.signals.homeInjuries = homeInj;
    }
  } catch (e) { /* injuries optional */ }

  // 9a2. BULLPEN QUALITY PROJECTIONS (sync)
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

  // 9b. LINEUP DATA (async — parallel)
  signalPromises.push(
    (async () => {
      try {
        if (deps.lineupFetcher) {
          const lineupAdj = await deps.lineupFetcher.getLineupAdjustments(game.away, game.home);
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
        }
      } catch (e) { /* lineup data optional */ }
    })()
  );

  // 9c. asyncPredict for full F5/NB/Conviction (async — parallel)
  signalPromises.push(
    (async () => {
      try {
        if (deps.mlb && deps.mlb.asyncPredict) {
          const fullPred = await deps.mlb.asyncPredict(game.away, game.home, {
            awayPitcher: game.awayStarter?.name,
            homePitcher: game.homeStarter?.name,
          });
          
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
          
          // Run line analysis
          if (fullPred && fullPred.altRunLines) {
            entry.signals.runLines = {
              model: 'negative-binomial',
              home: fullPred.altRunLines.home,
              away: fullPred.altRunLines.away,
              marginDist: fullPred.altRunLines.marginDist,
            };
          }
          
          // Conviction score
          if (fullPred && fullPred.conviction) {
            entry.signals.conviction = fullPred.conviction;
          }
        }
      } catch (e) { /* asyncPredict optional */ }
    })()
  );

  // Wait for all parallel signal fetches (with overall timeout)
  await Promise.race([
    Promise.all(signalPromises),
    new Promise(resolve => setTimeout(resolve, 8000)) // 8s max per game
  ]);

  // If no F5 data came from asyncPredict, use Poisson fallback
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

  // 10. LIVE ODDS
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

  // 11. CALCULATE BETS
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

  // 12. OVERALL GAME RATING
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
  // Direct match
  if (nameMap[lower]) return nameMap[lower];
  // Try last word
  const words = lower.split(' ');
  const last = words[words.length - 1];
  if (nameMap[last]) return nameMap[last];
  // Try first word
  if (nameMap[words[0]]) return nameMap[words[0]];
  return null;
}

/**
 * Build the full playbook — runs all games in parallel
 */
async function buildPlaybook(bankroll = 1000, kellyFraction = 0.5, minEdge = 0.02) {
  const startTime = Date.now();
  console.log('[od-playbook-cache] Building playbook...');
  
  const projections = await deps.mlbOpeningDay.getProjections();
  if (!projections || !projections.games || projections.games.length === 0) {
    return { error: 'No Opening Day projections available', games: [] };
  }

  // Fetch live MLB odds (single call, shared across all games)
  let liveOdds = [];
  try {
    if (deps.fetchOdds) {
      liveOdds = await deps.fetchOdds('baseball_mlb');
    }
  } catch (e) { /* no odds yet */ }

  const teams = deps.mlb.TEAMS || deps.mlb.getTeams();
  const nameMap = {};
  const extraAliases = {
    'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS',
    'blue jays': 'TOR', 'padres': 'SD', 'giants': 'SF', 'rays': 'TB', 'royals': 'KC',
  };
  
  // Build name map
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

  // Process ALL games in parallel (the key optimization!)
  const gamePromises = projections.games.map(game => 
    processGame(game, liveOdds, nameMap, minEdge, bankroll, kellyFraction)
      .catch(err => {
        console.error(`[od-playbook-cache] Error processing ${game.away}@${game.home}:`, err.message);
        return {
          away: game.away, home: game.home, date: game.date,
          signals: { error: err.message }, bets: [],
          gameRating: { grade: 'D', signalCount: 0, betCount: 0, maxEdge: 0, totalWager: 0, totalEV: 0 },
        };
      })
  );

  const playbook = await Promise.all(gamePromises);

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
    bankroll,
    kellyFraction,
  };

  const elapsed = Date.now() - startTime;
  console.log(`[od-playbook-cache] Built playbook in ${elapsed}ms — ${playbook.length} games, ${allBets.length} bets`);

  return {
    timestamp: new Date().toISOString(),
    openingDay: '2026-03-26',
    daysUntil: Math.ceil((new Date('2026-03-26') - new Date()) / (1000 * 60 * 60 * 24)),
    totalGames: playbook.length,
    buildTimeMs: elapsed,
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
