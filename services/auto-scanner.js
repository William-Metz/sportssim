/**
 * Auto Scanner — SportsSim Automated Daily Scan Engine
 * 
 * Runs periodic scans of ALL value-detection systems:
 * - Daily picks generation (full pipeline with all signals)
 * - Value detection across NBA/MLB/NHL
 * - Polymarket value bridge + arbitrage + futures
 * - SGP correlation engine
 * - Alt lines scanner
 * - Player props scanner
 * - Kalshi prediction markets
 * - CLV tracking + grading
 * 
 * Configurable schedules, smart throttling, health monitoring.
 * Results cached to disk for instant dashboard loading.
 */

const fs = require('fs');
const path = require('path');

// ==================== CONFIGURATION ====================

const SCAN_CACHE_DIR = path.join(__dirname, 'scan-cache');
const SCAN_LOG_FILE = path.join(__dirname, 'scan-log.json');
const SCAN_STATUS_FILE = path.join(__dirname, 'scan-status.json');

// Ensure cache directory exists
if (!fs.existsSync(SCAN_CACHE_DIR)) {
  fs.mkdirSync(SCAN_CACHE_DIR, { recursive: true });
}

// Scan intervals (in milliseconds)
const INTERVALS = {
  // Core money-making scans — run frequently
  dailyPicks:     30 * 60 * 1000,   // Every 30 min — fresh picks as odds move
  valueScan:      20 * 60 * 1000,   // Every 20 min — catch value before it disappears
  polymarket:     45 * 60 * 1000,   // Every 45 min — prediction markets move slower
  dailyMlbCard:   20 * 60 * 1000,   // Every 20 min — MLB daily card with full signal stack
  dailyNbaCard:   20 * 60 * 1000,   // Every 20 min — NBA daily card with rest/tank + conviction
  
  // Supporting scans — run less frequently
  sgpScan:        60 * 60 * 1000,   // Every 60 min — SGP combos
  altLines:       60 * 60 * 1000,   // Every 60 min — alt markets
  propsScan:      60 * 60 * 1000,   // Every 60 min — player props
  kalshiScan:     90 * 60 * 1000,   // Every 90 min — Kalshi contracts
  arbitrageScan:  30 * 60 * 1000,   // Every 30 min — arb opportunities vanish fast
  
  // Maintenance scans
  clvGrading:     4 * 60 * 60 * 1000,  // Every 4 hours — grade past picks
  dataRefresh:    30 * 60 * 1000,       // Every 30 min — refresh live data feeds
};

// Active hours configuration (UTC) — don't waste API calls at 4am
const ACTIVE_HOURS = {
  // NBA: Games typically 7pm-midnight ET = 00:00-05:00 UTC (next day)
  // MLB: Games typically 1pm-midnight ET = 18:00-05:00 UTC  
  // Pregame scans should start ~4 hours before first pitch
  start: 14,  // 2pm UTC = 10am ET — start scanning for afternoon MLB
  end: 6,     // 6am UTC = 2am ET — last games ending
  // Special: always scan at least once per day even outside active hours
};

// ==================== STATE ====================

let scanTimers = {};
let scanStatus = loadScanStatus();
let isRunning = false;
let dependencies = {}; // Injected models and services

// ==================== SCAN FUNCTIONS ====================

/**
 * Run Daily MLB Card — regular season daily scan
 * Uses the new daily-mlb-card.js service for full signal stack
 */
async function scanDailyMlbCard() {
  try {
    const dailyMlbCard = require('./daily-mlb-card');
    const date = new Date().toISOString().split('T')[0];
    const card = await dailyMlbCard.buildDailyCard({
      date,
      forceRefresh: true,
      oddsApiKey: process.env.ODDS_API_KEY || '',
      bankroll: 1000,
      kellyFraction: 0.5,
    });
    return {
      gamesScanned: card.headline?.gamesOnSlate || 0,
      totalBets: card.headline?.totalBets || 0,
      smashPlays: card.headline?.smashPlays || 0,
      strongPlays: card.headline?.strongPlays || 0,
      totalEV: card.headline?.totalEV || 0,
      roi: card.headline?.roi || 0,
      signals: card.signals,
      topPlay: card.headline?.bestPlay ? {
        game: card.headline.bestPlay.game,
        side: card.headline.bestPlay.side,
        edge: card.headline.bestPlay.edge,
        type: card.headline.bestPlay.type,
      } : null,
      date,
      elapsedMs: card.elapsedMs,
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Run Daily NBA Card — rest/tank conviction engine
 * Uses daily-nba-card.js for full signal stack with mismatch detection
 */
async function scanDailyNbaCard() {
  try {
    const dailyNbaCard = require('./daily-nba-card');
    const date = new Date().toISOString().split('T')[0];
    const card = await dailyNbaCard.buildDailyCard({
      date,
      forceRefresh: true,
      oddsApiKey: process.env.ODDS_API_KEY || '',
      bankroll: 1000,
      kellyFraction: 0.5,
    });
    return {
      gamesScanned: card.headline?.gamesOnSlate || 0,
      totalBets: card.headline?.totalBets || 0,
      smashPlays: card.headline?.smashPlays || 0,
      strongPlays: card.headline?.strongPlays || 0,
      totalEV: card.headline?.totalEV || 0,
      roi: card.headline?.roi || 0,
      mismatchGames: card.headline?.mismatchGames || 0,
      topPlay: card.headline?.bestPlay ? {
        game: card.headline.bestPlay.game,
        edge: card.headline.bestPlay.edge,
        conviction: card.headline.bestPlay.conviction,
        grade: card.headline.bestPlay.grade,
      } : null,
      date,
      elapsedMs: card.elapsedMs,
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Run daily picks generation with full signal pipeline
 */
async function scanDailyPicks() {
  const { dailyPicks, nba, mlb, nhl, getAllOdds, lineMovement, injuries, 
          rollingStats, weather, playerProps, umpireService, calibration, mlBridge } = dependencies;
  
  if (!dailyPicks || !getAllOdds) return { error: 'Dependencies not initialized' };
  
  const oddsData = await getAllOdds();
  const result = await dailyPicks.generateDailyPicks({
    nbaModel: nba,
    mlbModel: mlb,
    nhlModel: nhl,
    oddsData,
    lineMovementSvc: lineMovement,
    injurySvc: injuries,
    rollingSvc: rollingStats,
    weatherSvc: weather,
    propsSvc: playerProps,
    umpireSvc: umpireService,
    calibrationSvc: calibration,
    mlBridgeSvc: mlBridge,
    bankroll: 1000,
    kellyFraction: 0.5,
    minEdge: 0.02,
    maxPicks: 25
  });
  
  return {
    picksCount: result.picks ? result.picks.length : 0,
    topPicks: (result.picks || []).slice(0, 5).map(p => ({
      game: `${p.away} @ ${p.home}`,
      pick: p.pick || p.side,
      edge: p.edge,
      confidence: p.confidence,
      kelly: p.kelly
    })),
    bankrollAdvice: result.bankrollAdvice,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Run value detection across all sports
 * 
 * CRITICAL FIX (2026-03-22): getAllOdds() returns ENRICHED objects with fields:
 *   { sport, home, away, homeFull, awayFull, prediction, edge, bestLine, books }
 * NOT raw Odds API format (home_team, away_team, bookmakers).
 * Previous code accessed game.home_team / game.away_team → undefined → 0 bets found.
 */
async function scanAllValue() {
  const { nba, mlb, nhl, getAllOdds, polymarketValue, lineMovement, 
          injuries, rollingStats, weather, umpireService, calibration } = dependencies;
  
  if (!getAllOdds) return { error: 'Dependencies not initialized' };
  
  const oddsData = await getAllOdds();
  const results = { nba: [], mlb: [], nhl: [], polymarket: [], total: 0 };
  
  // Scan each sport for value using enriched data from getAllOdds()
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const model = sport === 'nba' ? nba : sport === 'mlb' ? mlb : nhl;
      if (!model) continue;
      
      const sportOdds = oddsData.filter(g => {
        const s = (g.sport || '').toLowerCase();
        return s.includes(sport);
      });
      
      const valueBets = [];
      
      for (const game of sportOdds) {
        // getAllOdds() already resolved abbreviations and predictions
        const homeAbbr = game.home;
        const awayAbbr = game.away;
        const homeFull = game.homeFull || homeAbbr;
        const awayFull = game.awayFull || awayAbbr;
        
        if (!homeAbbr || !awayAbbr) continue;
        
        try {
          // Use the prediction already computed by getAllOdds(), or recompute for MLB async
          let pred = game.prediction ? { ...game.prediction } : null;
          
          // For MLB, recompute with asyncPredict if available (gets lineup/rest data)
          // For NHL, recompute with asyncPredict for goalie-aware predictions
          if (sport === 'mlb' && model.asyncPredict) {
            try {
              pred = await model.asyncPredict(awayAbbr, homeAbbr);
              if (pred && pred.error) pred = game.prediction || null;
            } catch (e) {
              pred = game.prediction || null;
            }
          } else if (sport === 'nhl' && model.asyncPredict) {
            try {
              pred = await model.asyncPredict(awayAbbr, homeAbbr);
              if (pred && pred.error) pred = game.prediction || null;
            } catch (e) {
              pred = game.prediction || null;
            }
          } else if (!pred) {
            // Fallback: compute prediction if not available from getAllOdds
            if (sport === 'nhl') {
              pred = model.predict(awayAbbr, homeAbbr);
            } else {
              pred = model.predict(awayAbbr, homeAbbr);
            }
          }
          
          if (!pred) continue;
          
          // Normalize homeWinProb to 0-1 scale
          let homeProb01;
          if (sport === 'nhl') {
            homeProb01 = (pred.homeWinProb || pred.home?.winProb || 50);
            if (homeProb01 > 1) homeProb01 = homeProb01 / 100;
          } else {
            homeProb01 = pred.homeWinProb || 50;
            if (homeProb01 > 1) homeProb01 = homeProb01 / 100;
          }
          
          // Check moneyline value using best lines from getAllOdds enrichment
          const bestLine = game.bestLine || {};
          const books = game.books || {};
          
          // Check each bookmaker for ML value
          for (const [bookName, bookLine] of Object.entries(books)) {
            const homeML = bookLine.homeML;
            const awayML = bookLine.awayML;
            
            if (homeML !== undefined && homeML !== null) {
              const impliedProb = homeML < 0 ? (-homeML) / (-homeML + 100) : 100 / (homeML + 100);
              const modelProb = homeProb01;
              const edge = modelProb - impliedProb;
              
              if (edge >= 0.02) {
                valueBets.push({
                  sport: sport.toUpperCase(),
                  game: `${awayAbbr} @ ${homeAbbr}`,
                  gameFull: `${awayFull} @ ${homeFull}`,
                  book: bookName,
                  pick: `${homeAbbr} ML (${homeML > 0 ? '+' : ''}${homeML})`,
                  edge: parseFloat(edge.toFixed(4)),
                  modelProb: parseFloat(modelProb.toFixed(4)),
                  impliedProb: parseFloat(impliedProb.toFixed(4)),
                  confidence: edge >= 0.07 ? 'HIGH' : edge >= 0.04 ? 'MEDIUM' : 'LOW',
                  lineupData: pred.lineup ? true : false,
                  openingWeek: pred.openingWeek ? pred.openingWeek.active : false,
                });
              }
            }
            
            if (awayML !== undefined && awayML !== null) {
              const impliedProb = awayML < 0 ? (-awayML) / (-awayML + 100) : 100 / (awayML + 100);
              const modelProb = 1 - homeProb01;
              const edge = modelProb - impliedProb;
              
              if (edge >= 0.02) {
                valueBets.push({
                  sport: sport.toUpperCase(),
                  game: `${awayAbbr} @ ${homeAbbr}`,
                  gameFull: `${awayFull} @ ${homeFull}`,
                  book: bookName,
                  pick: `${awayAbbr} ML (${awayML > 0 ? '+' : ''}${awayML})`,
                  edge: parseFloat(edge.toFixed(4)),
                  modelProb: parseFloat(modelProb.toFixed(4)),
                  impliedProb: parseFloat(impliedProb.toFixed(4)),
                  confidence: edge >= 0.07 ? 'HIGH' : edge >= 0.04 ? 'MEDIUM' : 'LOW',
                  lineupData: pred.lineup ? true : false,
                  openingWeek: pred.openingWeek ? pred.openingWeek.active : false,
                });
              }
            }
          }
          
          // Check totals value
          const modelTotal = pred.totalRuns || pred.predictedTotal || pred.projTotal || pred.total || null;
          if (modelTotal) {
            for (const [bookName, bookLine] of Object.entries(books)) {
              const bookTotal = bookLine.total;
              const overOdds = bookLine.overOdds;
              const underOdds = bookLine.underOdds;
              
              if (!bookTotal) continue;
              
              const diff = modelTotal - bookTotal;
              // Sport-specific total variance scaling
              const totalScale = sport === 'nba' ? 0.5 : sport === 'nhl' ? 1.5 : 2.0;
              
              // Over probability
              if (overOdds) {
                let overModelProb = 0.5 + (diff / bookTotal) * totalScale;
                overModelProb = Math.max(0.1, Math.min(0.9, overModelProb));
                const overImplied = overOdds < 0 ? (-overOdds) / (-overOdds + 100) : 100 / (overOdds + 100);
                const overEdge = overModelProb - overImplied;
                if (overEdge >= 0.03) {
                  valueBets.push({
                    sport: sport.toUpperCase(),
                    game: `${awayAbbr} @ ${homeAbbr}`,
                    gameFull: `${awayFull} @ ${homeFull}`,
                    book: bookName,
                    pick: `OVER ${bookTotal} (${overOdds > 0 ? '+' : ''}${overOdds})`,
                    edge: parseFloat(overEdge.toFixed(4)),
                    modelProb: parseFloat(overModelProb.toFixed(4)),
                    impliedProb: parseFloat(overImplied.toFixed(4)),
                    modelTotal: modelTotal,
                    confidence: overEdge >= 0.07 ? 'HIGH' : overEdge >= 0.04 ? 'MEDIUM' : 'LOW',
                    market: 'total',
                    openingWeek: pred.openingWeek ? pred.openingWeek.active : false,
                  });
                }
              }
              
              // Under probability
              if (underOdds) {
                let underModelProb = 0.5 - (diff / bookTotal) * totalScale;
                underModelProb = Math.max(0.1, Math.min(0.9, underModelProb));
                const underImplied = underOdds < 0 ? (-underOdds) / (-underOdds + 100) : 100 / (underOdds + 100);
                const underEdge = underModelProb - underImplied;
                if (underEdge >= 0.03) {
                  valueBets.push({
                    sport: sport.toUpperCase(),
                    game: `${awayAbbr} @ ${homeAbbr}`,
                    gameFull: `${awayFull} @ ${homeFull}`,
                    book: bookName,
                    pick: `UNDER ${bookTotal} (${underOdds > 0 ? '+' : ''}${underOdds})`,
                    edge: parseFloat(underEdge.toFixed(4)),
                    modelProb: parseFloat(underModelProb.toFixed(4)),
                    impliedProb: parseFloat(underImplied.toFixed(4)),
                    modelTotal: modelTotal,
                    confidence: underEdge >= 0.07 ? 'HIGH' : underEdge >= 0.04 ? 'MEDIUM' : 'LOW',
                    market: 'total',
                    openingWeek: pred.openingWeek ? pred.openingWeek.active : false,
                  });
                }
              }
            }
          }
          // ==================== RUN LINE VALUE (v59.0) ====================
          // MLB run line is ±1.5 (from Odds API 'spreads' market)
          // Use NB exact probability instead of normal approximation
          if (sport === 'mlb' && pred.homeRunLine && pred.awayRunLine) {
            for (const [bookName, bookLine] of Object.entries(books)) {
              const bookSpread = bookLine.spread; // e.g., -1.5 for home fav
              if (bookSpread === undefined || bookSpread === null) continue;
              
              // Get spread odds from the raw enriched data
              // The home spread is the number. Typical MLB: home -1.5 or +1.5
              // bookLine also has homeSpreadOdds / awaySpreadOdds if present
              const homeSpreadOdds = bookLine.homeSpreadOdds;
              const awaySpreadOdds = bookLine.awaySpreadOdds;
              
              if (homeSpreadOdds !== undefined && homeSpreadOdds !== null) {
                // Home run line: our model has pred.homeRunLine.prob (NB-based)
                const modelProb = pred.homeRunLine.prob;
                const impliedProb = homeSpreadOdds < 0 
                  ? (-homeSpreadOdds) / (-homeSpreadOdds + 100) 
                  : 100 / (homeSpreadOdds + 100);
                const edge = modelProb - impliedProb;
                
                if (edge >= 0.03) {
                  valueBets.push({
                    sport: 'MLB',
                    game: `${awayAbbr} @ ${homeAbbr}`,
                    gameFull: `${awayFull} @ ${homeFull}`,
                    book: bookName,
                    pick: `${homeAbbr} ${bookSpread} (${homeSpreadOdds > 0 ? '+' : ''}${homeSpreadOdds})`,
                    edge: parseFloat(edge.toFixed(4)),
                    modelProb: parseFloat(modelProb.toFixed(4)),
                    impliedProb: parseFloat(impliedProb.toFixed(4)),
                    confidence: edge >= 0.07 ? 'HIGH' : edge >= 0.04 ? 'MEDIUM' : 'LOW',
                    market: 'runline',
                    model: pred.homeRunLine.model || 'negative-binomial',
                  });
                }
              }
              
              if (awaySpreadOdds !== undefined && awaySpreadOdds !== null) {
                const modelProb = pred.awayRunLine.prob;
                const impliedProb = awaySpreadOdds < 0 
                  ? (-awaySpreadOdds) / (-awaySpreadOdds + 100) 
                  : 100 / (awaySpreadOdds + 100);
                const edge = modelProb - impliedProb;
                
                if (edge >= 0.03) {
                  valueBets.push({
                    sport: 'MLB',
                    game: `${awayAbbr} @ ${homeAbbr}`,
                    gameFull: `${awayFull} @ ${homeFull}`,
                    book: bookName,
                    pick: `${awayAbbr} +${Math.abs(bookSpread)} (${awaySpreadOdds > 0 ? '+' : ''}${awaySpreadOdds})`,
                    edge: parseFloat(edge.toFixed(4)),
                    modelProb: parseFloat(modelProb.toFixed(4)),
                    impliedProb: parseFloat(impliedProb.toFixed(4)),
                    confidence: edge >= 0.07 ? 'HIGH' : edge >= 0.04 ? 'MEDIUM' : 'LOW',
                    market: 'runline',
                    model: pred.awayRunLine.model || 'negative-binomial',
                  });
                }
              }
            }
          }
          
          // ==================== F5 (FIRST 5 INNINGS) VALUE (v59.0) ====================
          // If the NB F5 model computed F5 data, compare with any F5 totals/ML available
          // F5 totals are the BIGGEST edge on Opening Day — starters guaranteed deep
          if (sport === 'mlb' && pred.f5 && pred.f5.model === 'negative-binomial-f5') {
            const f5 = pred.f5;
            
            // F5 total value: model says F5 total = X, compare to F5 total line if available
            // For now, we derive F5 value from the full game total line:
            // If book total is T, F5 should be ~54.5% of T (Opening Day) or ~52.5% regular
            // If our model's F5 total diverges significantly, that's an edge
            for (const [bookName, bookLine] of Object.entries(books)) {
              const bookTotal = bookLine.total;
              if (!bookTotal) continue;
              
              // Estimate the book's implied F5 total from the full-game total
              const isOD = pred.factors?.openingDayStarters || pred.factors?.preseasonTuning;
              const impliedF5Factor = isOD ? 0.545 : 0.525;
              const impliedF5Total = bookTotal * impliedF5Factor;
              const modelF5Total = f5.total;
              
              // If our F5 model total differs significantly, scan F5 total lines
              const f5Diff = modelF5Total - impliedF5Total;
              
              // Use the NB F5 totals probability matrix for the nearest line
              const nearestLine = Math.round(impliedF5Total * 2) / 2; // Round to nearest 0.5
              const f5LineData = f5.totals ? f5.totals[nearestLine] : null;
              
              if (f5LineData) {
                // F5 Under value (Opening Day special: starters dominate, unders hit more)
                if (f5LineData.under > 0.55) {
                  const underEdge = f5LineData.under - 0.5; // vs standard -110/-110 vig-free
                  if (underEdge >= 0.03) {
                    valueBets.push({
                      sport: 'MLB',
                      game: `${awayAbbr} @ ${homeAbbr}`,
                      gameFull: `${awayFull} @ ${homeFull}`,
                      book: bookName,
                      pick: `F5 UNDER ${nearestLine} (${f5LineData.underML > 0 ? '+' : ''}${f5LineData.underML} fair)`,
                      edge: parseFloat(underEdge.toFixed(4)),
                      modelProb: parseFloat(f5LineData.under.toFixed(4)),
                      impliedProb: 0.5,
                      modelTotal: modelF5Total,
                      confidence: underEdge >= 0.07 ? 'HIGH' : underEdge >= 0.04 ? 'MEDIUM' : 'LOW',
                      market: 'f5-total',
                      model: 'negative-binomial-f5',
                      f5Detail: { modelF5Total, impliedF5Total: impliedF5Total.toFixed(2), nearestLine },
                    });
                  }
                }
                
                // F5 Over value
                if (f5LineData.over > 0.55) {
                  const overEdge = f5LineData.over - 0.5;
                  if (overEdge >= 0.03) {
                    valueBets.push({
                      sport: 'MLB',
                      game: `${awayAbbr} @ ${homeAbbr}`,
                      gameFull: `${awayFull} @ ${homeFull}`,
                      book: bookName,
                      pick: `F5 OVER ${nearestLine} (${f5LineData.overML > 0 ? '+' : ''}${f5LineData.overML} fair)`,
                      edge: parseFloat(overEdge.toFixed(4)),
                      modelProb: parseFloat(f5LineData.over.toFixed(4)),
                      impliedProb: 0.5,
                      modelTotal: modelF5Total,
                      confidence: overEdge >= 0.07 ? 'HIGH' : overEdge >= 0.04 ? 'MEDIUM' : 'LOW',
                      market: 'f5-total',
                      model: 'negative-binomial-f5',
                      f5Detail: { modelF5Total, impliedF5Total: impliedF5Total.toFixed(2), nearestLine },
                    });
                  }
                }
              }
            }
            
            // F5 ML value: 3-way market (home/away/draw)
            // F5 draws happen ~16% of games — this is a MASSIVE edge that books often underprice
            if (f5.drawProb > 0.12) {
              // 3-way draw is typically priced at +350 to +500 (16-22% implied)
              // If our model shows draw > 16%, and typical book price implies <15%, that's value
              valueBets.push({
                sport: 'MLB',
                game: `${awayAbbr} @ ${homeAbbr}`,
                gameFull: `${awayFull} @ ${homeFull}`,
                book: 'model',
                pick: `F5 DRAW (${f5.threeWay?.drawML > 0 ? '+' : ''}${f5.threeWay?.drawML} fair)`,
                edge: parseFloat((f5.drawProb - 0.14).toFixed(4)), // vs ~14% market avg
                modelProb: parseFloat(f5.drawProb.toFixed(4)),
                impliedProb: 0.14,
                confidence: f5.drawProb >= 0.19 ? 'HIGH' : f5.drawProb >= 0.16 ? 'MEDIUM' : 'LOW',
                market: 'f5-ml',
                model: 'negative-binomial-f5',
              });
            }
          }
          
          // ==================== CONVICTION SCORE (v59.0) ====================
          // Attach conviction score to existing value bets for this game
          if (pred.conviction) {
            const gameKey = `${awayAbbr}@${homeAbbr}`;
            for (const vb of valueBets) {
              if (vb.game === `${awayAbbr} @ ${homeAbbr}` && !vb.conviction) {
                vb.conviction = pred.conviction;
              }
            }
          }
          
        } catch (e) { /* skip game */ }
      }
      
      results[sport] = valueBets.sort((a, b) => b.edge - a.edge);
    } catch (e) {
      results[sport] = [{ error: e.message }];
    }
  }
  
  // Polymarket value scan
  if (polymarketValue) {
    try {
      const pmResult = await polymarketValue.scanForValue({ minEdge: 0.03 });
      results.polymarket = (pmResult.valueBets || [])
        .filter(v => v.rawEdge > 0)
        .slice(0, 20)
        .map(v => ({
          sport: (v.sport || 'POLY').toUpperCase(),
          question: v.question,
          edge: v.edge,
          modelProb: v.modelProb,
          confidence: v.confidence
        }));
    } catch (e) {
      results.polymarket = [{ error: e.message }];
    }
  }
  
  results.total = results.nba.length + results.mlb.length + results.nhl.length + results.polymarket.length;
  
  // NCAA Tournament value scan (during March Madness)
  try {
    const ncaaTournScanner = require('./ncaa-tournament-scanner');
    const ncaaResults = await ncaaTournScanner.scanTournamentValue();
    if (ncaaResults && ncaaResults.valueBets && ncaaResults.valueBets.length > 0) {
      results.ncaab = ncaaResults.valueBets.slice(0, 10).map(v => ({
        sport: 'NCAAB',
        game: v.game,
        bet: v.bet,
        type: v.type,
        edge: v.edge,
        confidence: v.confidence,
        bestBook: v.bestBook,
        evPer100: v.evPer100,
        modelProb: v.modelProb,
        round: v.round,
      }));
      results.total += results.ncaab.length;
    } else {
      results.ncaab = [];
    }
  } catch (e) {
    results.ncaab = [];
    // NCAA scanner may not be available — that's fine
  }
  
  // ==================== AUTO-RECORD TO CLV TRACKER ====================
  // Every value bet found gets auto-recorded for CLV analysis — the holy grail metric.
  // If we consistently beat closing lines, the model is REAL.
  const { clvTracker } = dependencies;
  if (clvTracker && clvTracker.recordPick) {
    let recorded = 0;
    for (const sport of ['nba', 'mlb', 'nhl']) {
      const bets = results[sport];
      if (!Array.isArray(bets)) continue;
      for (const bet of bets) {
        if (bet.error) continue;
        // Parse game teams from "AWY @ HME" format
        const parts = (bet.game || '').split(' @ ');
        if (parts.length !== 2) continue;
        const away = parts[0].trim();
        const home = parts[1].trim();
        
        // Determine side and type from pick string
        let type = 'moneyline';
        let side = 'home';
        const pick = (bet.pick || '').toUpperCase();
        if (pick.includes('OVER') || pick.includes('UNDER')) {
          type = 'total';
          side = pick.includes('OVER') ? 'over' : 'under';
        } else {
          // ML pick — check if it's home or away team
          side = pick.startsWith(away) ? 'away' : 'home';
        }
        
        // Extract odds from pick string: "DET ML (-138)" → -138
        const oddsMatch = pick.match(/\(([+-]\d+)\)/);
        const bookLine = oddsMatch ? parseInt(oddsMatch[1]) : 0;
        
        try {
          clvTracker.recordPick({
            sport: sport,
            away: away,
            home: home,
            type: type,
            side: side,
            modelLine: bet.modelProb ? Math.round(-100 * bet.modelProb / (1 - bet.modelProb)) : 0,
            bookLine: bookLine,
            modelProb: bet.modelProb || 0,
            bookProb: bet.impliedProb || 0,
            confidence: bet.confidence || 'LOW',
            source: 'auto-scanner',
            book: bet.book || 'unknown',
            edge: bet.edge || 0,
          });
          recorded++;
        } catch (e) { /* CLV recording is best-effort */ }
      }
    }
    if (recorded > 0) {
      console.log(`📊 Auto-recorded ${recorded} value bets to CLV tracker`);
    }
    results.clvRecorded = recorded;
  }
  
  return results;
}

/**
 * Run SGP scan across all sports
 */
async function scanSGPs() {
  const { sgpEngine, nba, mlb, nhl, getAllOdds } = dependencies;
  if (!sgpEngine) return { error: 'SGP engine not available' };
  
  const results = { sports: {}, totalCombos: 0, topCombos: [] };
  
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const scanResult = await sgpEngine.scanSGPs(sport, { mlb, nba, nhl }, getAllOdds);
      results.sports[sport.toUpperCase()] = {
        combos: scanResult.combos ? scanResult.combos.length : 0,
        summary: scanResult.summary
      };
      results.totalCombos += (scanResult.combos || []).length;
      
      // Keep top 5 from each sport
      const top = (scanResult.combos || []).slice(0, 5);
      results.topCombos.push(...top);
    } catch (e) {
      results.sports[sport.toUpperCase()] = { error: e.message };
    }
  }
  
  results.topCombos.sort((a, b) => (b.expectedValue || 0) - (a.expectedValue || 0));
  results.topCombos = results.topCombos.slice(0, 10);
  
  return results;
}

/**
 * Run Polymarket arbitrage and futures scans
 */
async function scanPolymarketDeep() {
  const { polymarketValue } = dependencies;
  if (!polymarketValue) return { error: 'Polymarket value bridge not available' };
  
  const results = {};
  
  // Cross-market arbitrage
  try {
    const arbResult = await polymarketValue.scanArbitrage();
    results.arbitrage = {
      opportunities: (arbResult.opportunities || []).length,
      topArbs: (arbResult.opportunities || []).slice(0, 5)
    };
  } catch (e) {
    results.arbitrage = { error: e.message };
  }
  
  // Futures value
  try {
    const futuresResult = await polymarketValue.scanFuturesValue();
    results.futures = {
      valueBets: (futuresResult.valueBets || []).length,
      topFutures: (futuresResult.valueBets || []).slice(0, 5)
    };
  } catch (e) {
    results.futures = { error: e.message };
  }
  
  // Standard value scan
  try {
    const valueResult = await polymarketValue.scanForValue({ minEdge: 0.03 });
    results.value = {
      totalBets: (valueResult.valueBets || []).length,
      topBets: (valueResult.valueBets || []).filter(v => v.rawEdge > 0).slice(0, 10)
    };
  } catch (e) {
    results.value = { error: e.message };
  }
  
  return results;
}

/**
 * Run alt lines scan for all sports
 */
async function scanAltLines() {
  const { altLines, nba, mlb, nhl, getAllOdds } = dependencies;
  if (!altLines) return { error: 'Alt lines scanner not available' };
  
  const results = { sports: {}, totalValue: 0 };
  
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const model = sport === 'nba' ? nba : sport === 'mlb' ? mlb : nhl;
      const scanResult = await altLines.scanAltLines(sport, model, getAllOdds);
      results.sports[sport.toUpperCase()] = {
        opportunities: (scanResult.opportunities || scanResult.valueBets || []).length,
        topOpps: (scanResult.opportunities || scanResult.valueBets || []).slice(0, 5)
      };
      results.totalValue += (scanResult.opportunities || scanResult.valueBets || []).length;
    } catch (e) {
      results.sports[sport.toUpperCase()] = { error: e.message };
    }
  }
  
  return results;
}

/**
 * Run player props scan
 */
async function scanProps() {
  const { playerProps, nba, mlb, nhl } = dependencies;
  if (!playerProps) return { error: 'Player props not available' };
  
  const results = { sports: {}, totalProps: 0 };
  
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const scanResult = await playerProps.scanProps(sport, { nba, mlb, nhl });
      const valueBets = (scanResult.valueBets || scanResult.props || []);
      results.sports[sport.toUpperCase()] = {
        total: valueBets.length,
        topProps: valueBets.slice(0, 5)
      };
      results.totalProps += valueBets.length;
    } catch (e) {
      results.sports[sport.toUpperCase()] = { error: e.message };
    }
  }
  
  return results;
}

/**
 * Run arbitrage scan across books
 */
async function scanArbitrage() {
  const { arbitrage, getAllOdds } = dependencies;
  if (!arbitrage) return { error: 'Arbitrage scanner not available' };
  
  try {
    const oddsData = await getAllOdds();
    const result = arbitrage.scanAll(oddsData);
    return {
      totalOpportunities: (result.opportunities || []).length,
      topArbs: (result.opportunities || []).slice(0, 10),
      middles: result.middles || [],
      staleLines: result.staleLines || [],
      lowHold: result.lowHold || []
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Grade past CLV picks
 */
async function gradePicksCLV() {
  const { clvTracker } = dependencies;
  if (!clvTracker) return { error: 'CLV tracker not available' };
  
  try {
    const result = clvTracker.gradeAll ? await clvTracker.gradeAll() : 
                   clvTracker.getStatus ? clvTracker.getStatus() : {};
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Refresh all live data feeds
 */
async function refreshAllData() {
  const { liveData, rollingStats, injuries, weather, playerStatsService, statcast } = dependencies;
  
  const results = {};
  
  if (liveData) {
    try { results.liveData = await liveData.refreshAll(); } 
    catch (e) { results.liveData = { error: e.message }; }
  }
  if (rollingStats) {
    try { results.rolling = await rollingStats.refreshAll(); }
    catch (e) { results.rolling = { error: e.message }; }
  }
  if (injuries) {
    try { results.injuries = await injuries.refreshAll(); }
    catch (e) { results.injuries = { error: e.message }; }
  }
  if (weather) {
    try { results.weather = await weather.getAllWeather(); }
    catch (e) { results.weather = { error: e.message }; }
  }
  if (playerStatsService) {
    try { results.playerStats = await playerStatsService.refreshAll(); }
    catch (e) { results.playerStats = { error: e.message }; }
  }
  if (statcast) {
    try { results.statcast = await statcast.refreshStatcast(); }
    catch (e) { results.statcast = { error: e.message }; }
  }
  
  return results;
}

// ==================== SCAN ORCHESTRATOR ====================

const SCAN_REGISTRY = {
  dailyPicks: { fn: scanDailyPicks, name: 'Daily Picks', interval: INTERVALS.dailyPicks, priority: 1 },
  valueScan: { fn: scanAllValue, name: 'Value Detection', interval: INTERVALS.valueScan, priority: 1 },
  dailyMlbCard: { fn: scanDailyMlbCard, name: 'MLB Daily Card', interval: INTERVALS.dailyMlbCard, priority: 1 },
  dailyNbaCard: { fn: scanDailyNbaCard, name: 'NBA Daily Card', interval: INTERVALS.dailyNbaCard, priority: 1 },
  polymarket: { fn: scanPolymarketDeep, name: 'Polymarket Deep Scan', interval: INTERVALS.polymarket, priority: 2 },
  sgpScan: { fn: scanSGPs, name: 'SGP Combos', interval: INTERVALS.sgpScan, priority: 2 },
  altLines: { fn: scanAltLines, name: 'Alt Lines', interval: INTERVALS.altLines, priority: 2 },
  propsScan: { fn: scanProps, name: 'Player Props', interval: INTERVALS.propsScan, priority: 2 },
  arbitrageScan: { fn: scanArbitrage, name: 'Arbitrage', interval: INTERVALS.arbitrageScan, priority: 1 },
  clvGrading: { fn: gradePicksCLV, name: 'CLV Grading', interval: INTERVALS.clvGrading, priority: 3 },
  dataRefresh: { fn: refreshAllData, name: 'Data Refresh', interval: INTERVALS.dataRefresh, priority: 1 },
};

/**
 * Check if we're in active scanning hours
 */
function isActiveHours() {
  const hour = new Date().getUTCHours();
  if (ACTIVE_HOURS.start < ACTIVE_HOURS.end) {
    return hour >= ACTIVE_HOURS.start && hour < ACTIVE_HOURS.end;
  }
  // Wraps around midnight (e.g., 14-6 means 14:00 to 06:00 next day)
  return hour >= ACTIVE_HOURS.start || hour < ACTIVE_HOURS.end;
}

/**
 * Execute a single scan with error handling, timing, and caching
 */
async function executeScan(scanKey) {
  const scan = SCAN_REGISTRY[scanKey];
  if (!scan) return { error: `Unknown scan: ${scanKey}` };
  
  const startTime = Date.now();
  const scanEntry = {
    key: scanKey,
    name: scan.name,
    startedAt: new Date().toISOString(),
    status: 'running'
  };
  
  // Update status
  scanStatus[scanKey] = { ...scanEntry };
  saveScanStatus();
  
  try {
    console.log(`🔍 Auto-scan: ${scan.name} starting...`);
    const result = await scan.fn();
    const durationMs = Date.now() - startTime;
    
    scanEntry.status = 'completed';
    scanEntry.durationMs = durationMs;
    scanEntry.completedAt = new Date().toISOString();
    scanEntry.resultSummary = summarizeResult(scanKey, result);
    
    // Cache result to disk
    const cacheFile = path.join(SCAN_CACHE_DIR, `${scanKey}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify({
      scanKey,
      scanName: scan.name,
      generatedAt: new Date().toISOString(),
      durationMs,
      data: result
    }, null, 2));
    
    // Update status
    scanStatus[scanKey] = { ...scanEntry };
    saveScanStatus();
    
    // Log
    appendScanLog(scanEntry);
    
    console.log(`✅ Auto-scan: ${scan.name} completed in ${(durationMs / 1000).toFixed(1)}s — ${scanEntry.resultSummary}`);
    
    return { success: true, ...scanEntry, data: result };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    scanEntry.status = 'error';
    scanEntry.error = e.message;
    scanEntry.durationMs = durationMs;
    scanEntry.completedAt = new Date().toISOString();
    
    scanStatus[scanKey] = { ...scanEntry };
    saveScanStatus();
    appendScanLog(scanEntry);
    
    console.error(`❌ Auto-scan: ${scan.name} failed after ${(durationMs / 1000).toFixed(1)}s — ${e.message}`);
    return { success: false, ...scanEntry };
  }
}

/**
 * Summarize scan result for logging
 */
function summarizeResult(key, result) {
  if (!result) return 'No data';
  if (result.error) return `Error: ${result.error}`;
  
  switch (key) {
    case 'dailyPicks':
      return `${result.picksCount} picks generated`;
    case 'valueScan':
      return `${result.total} value bets found (NBA:${result.nba?.length || 0} MLB:${result.mlb?.length || 0} NHL:${result.nhl?.length || 0} PM:${result.polymarket?.length || 0})`;
    case 'polymarket':
      return `Arb:${result.arbitrage?.opportunities || 0} Futures:${result.futures?.valueBets || 0} Value:${result.value?.totalBets || 0}`;
    case 'sgpScan':
      return `${result.totalCombos} SGP combos`;
    case 'altLines':
      return `${result.totalValue} alt line opportunities`;
    case 'propsScan':
      return `${result.totalProps} prop value bets`;
    case 'arbitrageScan':
      return `${result.totalOpportunities} arb opportunities`;
    case 'clvGrading':
      return `CLV grading complete`;
    case 'dataRefresh':
      return `Data feeds refreshed`;
    default:
      return JSON.stringify(result).slice(0, 100);
  }
}

// ==================== TIMER MANAGEMENT ====================

/**
 * Start all automated scan timers
 */
function startAllTimers() {
  if (isRunning) {
    console.log('⚠️ Auto-scanner already running');
    return;
  }
  isRunning = true;
  
  console.log('🚀 Auto-scanner starting...');
  console.log(`   Active hours: ${ACTIVE_HOURS.start}:00 - ${ACTIVE_HOURS.end}:00 UTC`);
  console.log(`   Currently ${isActiveHours() ? 'ACTIVE' : 'INACTIVE'} (${new Date().getUTCHours()}:00 UTC)`);
  
  for (const [key, scan] of Object.entries(SCAN_REGISTRY)) {
    const interval = scan.interval;
    
    // Stagger initial scans to avoid thundering herd
    // Priority 1 scans start within first 2 min, priority 2 within 5 min, etc.
    const staggerDelay = (scan.priority || 1) * 30000 + Math.random() * 30000;
    
    // Initial scan after stagger delay
    const initialTimer = setTimeout(() => {
      runIfActive(key);
      
      // Then set up recurring interval
      scanTimers[key] = setInterval(() => {
        runIfActive(key);
      }, interval);
    }, staggerDelay);
    
    scanTimers[`${key}_initial`] = initialTimer;
    
    console.log(`   📋 ${scan.name}: every ${formatInterval(interval)} (starts in ${Math.round(staggerDelay / 1000)}s)`);
  }
  
  // Watchdog: every 15 minutes, check for stuck/overdue scans and force re-run
  scanTimers['__watchdog'] = setInterval(() => {
    const now = Date.now();
    for (const [key, scan] of Object.entries(SCAN_REGISTRY)) {
      const status = scanStatus[key];
      if (!status) continue;
      
      // If a scan has been "running" for more than 5 minutes, mark it as timed out
      if (status.status === 'running' && status.startedAt) {
        const runningFor = now - new Date(status.startedAt).getTime();
        if (runningFor > 5 * 60 * 1000) {
          console.warn(`⏰ Watchdog: ${scan.name} stuck for ${Math.round(runningFor / 60000)}min — marking timed out`);
          scanStatus[key] = {
            ...status,
            status: 'timeout',
            error: `Timed out after ${Math.round(runningFor / 60000)} minutes`,
            completedAt: new Date().toISOString()
          };
          saveScanStatus();
        }
      }
      
      // If scan is overdue by 3x interval and not currently running, force re-run
      if (status.status !== 'running') {
        const lastCompleted = status.completedAt ? new Date(status.completedAt).getTime() : 0;
        const timeSince = now - lastCompleted;
        if (timeSince > scan.interval * 3 && isActiveHours()) {
          console.log(`🐕 Watchdog: ${scan.name} overdue by ${formatInterval(timeSince)} — forcing re-run`);
          executeScan(key);
        }
      }
    }
  }, 15 * 60 * 1000);
  
  console.log('🔄 Auto-scanner initialized — all scans scheduled (+ watchdog every 15min)');
}

/**
 * Run a scan if we're in active hours (or force it if it hasn't run today)
 */
function runIfActive(key) {
  if (isActiveHours()) {
    executeScan(key);
  } else {
    // Even outside active hours, run at least once every 4 hours
    const lastRun = scanStatus[key]?.completedAt;
    if (!lastRun || (Date.now() - new Date(lastRun).getTime() > 4 * 60 * 60 * 1000)) {
      console.log(`🌙 Off-hours scan: ${SCAN_REGISTRY[key].name} (hasn't run in 4+ hours)`);
      executeScan(key);
    }
  }
}

/**
 * Stop all scan timers
 */
function stopAllTimers() {
  for (const [key, timer] of Object.entries(scanTimers)) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  scanTimers = {};
  isRunning = false;
  console.log('🛑 Auto-scanner stopped');
}

/**
 * Force run a specific scan immediately
 */
async function forceScan(scanKey) {
  if (scanKey === 'all') {
    const results = {};
    for (const key of Object.keys(SCAN_REGISTRY)) {
      results[key] = await executeScan(key);
    }
    return results;
  }
  return executeScan(scanKey);
}

// ==================== CACHED RESULTS ====================

/**
 * Get latest cached scan result
 */
function getCachedScan(scanKey) {
  const cacheFile = path.join(SCAN_CACHE_DIR, `${scanKey}.json`);
  try {
    if (fs.existsSync(cacheFile)) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch (e) {}
  return null;
}

/**
 * Get all cached scan results
 */
function getAllCachedScans() {
  const results = {};
  for (const key of Object.keys(SCAN_REGISTRY)) {
    const cached = getCachedScan(key);
    if (cached) {
      results[key] = {
        name: SCAN_REGISTRY[key].name,
        generatedAt: cached.generatedAt,
        age: formatAge(cached.generatedAt),
        summary: scanStatus[key]?.resultSummary || 'N/A',
        hasData: !!cached.data
      };
    } else {
      results[key] = {
        name: SCAN_REGISTRY[key].name,
        generatedAt: null,
        age: 'Never',
        summary: 'Not yet scanned',
        hasData: false
      };
    }
  }
  return results;
}

// ==================== STATUS & HEALTH ====================

/**
 * Get comprehensive scanner health status
 */
function getHealth() {
  const now = Date.now();
  const health = {
    isRunning,
    isActiveHours: isActiveHours(),
    currentHourUTC: new Date().getUTCHours(),
    activeWindow: `${ACTIVE_HOURS.start}:00 - ${ACTIVE_HOURS.end}:00 UTC`,
    scans: {},
    alerts: []
  };
  
  for (const [key, scan] of Object.entries(SCAN_REGISTRY)) {
    const status = scanStatus[key] || {};
    const lastRun = status.completedAt ? new Date(status.completedAt).getTime() : 0;
    const timeSinceRun = lastRun ? now - lastRun : Infinity;
    const isStale = timeSinceRun > scan.interval * 3; // 3x interval = stale
    const isOverdue = timeSinceRun > scan.interval * 2;
    
    health.scans[key] = {
      name: scan.name,
      interval: formatInterval(scan.interval),
      lastRun: status.completedAt || 'Never',
      lastRunAge: lastRun ? formatAge(status.completedAt) : 'Never',
      lastStatus: status.status || 'never-run',
      lastDuration: status.durationMs ? `${(status.durationMs / 1000).toFixed(1)}s` : 'N/A',
      lastResult: status.resultSummary || 'N/A',
      isStale,
      isOverdue,
      lastError: status.error || null
    };
    
    if (isStale && isActiveHours()) {
      health.alerts.push(`⚠️ ${scan.name} is stale (last run: ${formatAge(status.completedAt)})`);
    }
    if (status.status === 'error') {
      health.alerts.push(`❌ ${scan.name} last run failed: ${status.error}`);
    }
  }
  
  health.totalAlerts = health.alerts.length;
  health.overallHealth = health.alerts.length === 0 ? 'HEALTHY' : 
                         health.alerts.length <= 2 ? 'DEGRADED' : 'UNHEALTHY';
  
  return health;
}

/**
 * Get scan log history
 */
function getScanLog(limit = 50) {
  try {
    if (fs.existsSync(SCAN_LOG_FILE)) {
      const log = JSON.parse(fs.readFileSync(SCAN_LOG_FILE, 'utf8'));
      return log.slice(-limit);
    }
  } catch (e) {}
  return [];
}

// ==================== DAILY DIGEST ====================

/**
 * Generate a daily digest of all scan results
 * Useful for alerts and summaries
 */
function generateDailyDigest() {
  const digest = {
    date: new Date().toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),
    sections: {}
  };
  
  // Daily picks
  const picksCache = getCachedScan('dailyPicks');
  if (picksCache?.data) {
    const picks = picksCache.data;
    digest.sections.picks = {
      count: picks.picksCount || 0,
      topPicks: picks.topPicks || [],
      lastUpdated: picksCache.generatedAt
    };
  }
  
  // Value bets
  const valueCache = getCachedScan('valueScan');
  if (valueCache?.data) {
    const v = valueCache.data;
    digest.sections.value = {
      total: v.total || 0,
      byLeague: {
        NBA: v.nba?.length || 0,
        MLB: v.mlb?.length || 0,
        NHL: v.nhl?.length || 0,
        Polymarket: v.polymarket?.length || 0
      },
      lastUpdated: valueCache.generatedAt
    };
  }
  
  // Arbitrage
  const arbCache = getCachedScan('arbitrageScan');
  if (arbCache?.data) {
    digest.sections.arbitrage = {
      opportunities: arbCache.data.totalOpportunities || 0,
      lastUpdated: arbCache.generatedAt
    };
  }
  
  // SGP
  const sgpCache = getCachedScan('sgpScan');
  if (sgpCache?.data) {
    digest.sections.sgp = {
      combos: sgpCache.data.totalCombos || 0,
      lastUpdated: sgpCache.generatedAt
    };
  }
  
  // Props
  const propsCache = getCachedScan('propsScan');
  if (propsCache?.data) {
    digest.sections.props = {
      total: propsCache.data.totalProps || 0,
      lastUpdated: propsCache.generatedAt
    };
  }
  
  // Scanner health
  digest.scannerHealth = getHealth().overallHealth;
  
  // Cache the digest
  const digestFile = path.join(SCAN_CACHE_DIR, 'daily-digest.json');
  fs.writeFileSync(digestFile, JSON.stringify(digest, null, 2));
  
  return digest;
}

// ==================== UTILITY FUNCTIONS ====================

function formatInterval(ms) {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(0)}m`;
  return `${(ms / 1000).toFixed(0)}s`;
}

function formatAge(isoString) {
  if (!isoString) return 'Never';
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms < 60000) return 'Just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

function loadScanStatus() {
  try {
    if (fs.existsSync(SCAN_STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(SCAN_STATUS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveScanStatus() {
  try {
    fs.writeFileSync(SCAN_STATUS_FILE, JSON.stringify(scanStatus, null, 2));
  } catch (e) {
    console.error('Failed to save scan status:', e.message);
  }
}

function appendScanLog(entry) {
  try {
    let log = [];
    if (fs.existsSync(SCAN_LOG_FILE)) {
      log = JSON.parse(fs.readFileSync(SCAN_LOG_FILE, 'utf8'));
    }
    log.push(entry);
    // Keep last 500 entries
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(SCAN_LOG_FILE, JSON.stringify(log, null, 2));
  } catch (e) {
    console.error('Failed to write scan log:', e.message);
  }
}

// ==================== DEPENDENCY INJECTION ====================

/**
 * Initialize the auto-scanner with all service dependencies
 */
function init(deps) {
  dependencies = deps;
  console.log('🔧 Auto-scanner dependencies injected');
  return module.exports;
}

// ==================== EXPORTS ====================

module.exports = {
  init,
  startAllTimers,
  stopAllTimers,
  forceScan,
  executeScan,
  getCachedScan,
  getAllCachedScans,
  getHealth,
  getScanLog,
  generateDailyDigest,
  isActiveHours,
  INTERVALS,
  SCAN_REGISTRY
};
