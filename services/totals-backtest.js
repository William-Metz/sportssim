/**
 * MLB Totals Backtest — Poisson vs Negative Binomial
 * ===================================================
 * 
 * Tests both models against the 2375-game 2024 MLB dataset.
 * Measures: totals accuracy, calibration, Brier score, O/U edge detection.
 * 
 * This answers THE key question: does NB actually improve betting accuracy?
 */

const fs = require('fs');
const path = require('path');

// Load backtest data
let games = [];
try {
  const backtestV2 = require('../models/backtest-mlb-v2');
  games = backtestV2.GAMES || [];
} catch (e) {
  try {
    const backtestV1 = require('../models/backtest-mlb');
    games = backtestV1.GAMES || [];
  } catch (e2) {
    console.log('No backtest games data found');
  }
}

// Load models
const mlb = require('../models/mlb');
const negBinomial = require('./neg-binomial');

// Factorials for Poisson
const FACTORIALS = [1];
for (let i = 1; i <= 25; i++) FACTORIALS[i] = FACTORIALS[i-1] * i;
function poissonPMF(lambda, k) {
  if (k < 0 || k > 25 || lambda <= 0) return 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / FACTORIALS[k];
}

/**
 * Run full totals backtest comparing Poisson vs NB
 */
function runTotalsBacktest() {
  if (games.length === 0) return { error: 'No backtest data available' };
  
  const results = {
    gamesAnalyzed: 0,
    poisson: {
      totalsBias: 0, mae: 0, rmse: 0,
      ouCorrect: 0, ouTotal: 0, ouAccuracy: 0,
      brierScore: 0,
      overBias: 0, underBias: 0,
      byBucket: {},
    },
    negBin: {
      totalsBias: 0, mae: 0, rmse: 0,
      ouCorrect: 0, ouTotal: 0, ouAccuracy: 0,
      brierScore: 0,
      overBias: 0, underBias: 0,
      byBucket: {},
    },
    edgeDetection: {
      poissonEdgePicks: 0, poissonEdgeWins: 0, poissonEdgeROI: 0,
      nbEdgePicks: 0, nbEdgeWins: 0, nbEdgeROI: 0,
    },
  };
  
  const poissonErrors = [];
  const nbErrors = [];
  let poissonBrierSum = 0, nbBrierSum = 0;
  let poissonOverBets = 0, poissonUnderBets = 0, poissonOverWins = 0, poissonUnderWins = 0;
  let nbOverBets = 0, nbUnderBets = 0, nbOverWins = 0, nbUnderWins = 0;
  
  // Edge detection tracking (3%+ model edge bets)
  let poissonEdgePL = 0, nbEdgePL = 0;
  let poissonEdgeBets = 0, nbEdgeBets = 0;
  let poissonEdgeWins = 0, nbEdgeWins = 0;
  
  // Buckets for calibration
  const buckets = ['5.5-6.5', '6.5-7.5', '7.5-8.5', '8.5-9.5', '9.5-10.5', '10.5+'];
  for (const b of buckets) {
    results.poisson.byBucket[b] = { games: 0, predicted: 0, actual: 0, overCorrect: 0, underCorrect: 0, total: 0 };
    results.negBin.byBucket[b] = { games: 0, predicted: 0, actual: 0, overCorrect: 0, underCorrect: 0, total: 0 };
  }
  
  for (const game of games) {
    if (!game.away || !game.home || game.awayScore === undefined || game.homeScore === undefined) continue;
    
    try {
      // Get prediction with expected runs
      const pred = mlb.predict(game.away, game.home, {
        awayPitcher: game.awayPitcher,
        homePitcher: game.homePitcher,
        monteCarlo: false,
      });
      if (pred.error) continue;
      
      const awayExp = pred.awayExpRuns;
      const homeExp = pred.homeExpRuns;
      const projTotal = awayExp + homeExp;
      const actualTotal = game.awayScore + game.homeScore;
      
      // Use the book total if available, otherwise use projected
      const bookTotal = game.total || Math.round(projTotal * 2) / 2;
      
      results.gamesAnalyzed++;
      
      // ===== POISSON O/U =====
      let poissonOver = 0, poissonUnder = 0;
      for (let a = 0; a <= 20; a++) {
        for (let h = 0; h <= 20; h++) {
          const p = poissonPMF(awayExp, a) * poissonPMF(homeExp, h);
          if (a + h > bookTotal) poissonOver += p;
          else if (a + h < bookTotal) poissonUnder += p;
        }
      }
      
      // ===== NEGATIVE BINOMIAL O/U =====
      const teams = mlb.getTeams();
      const homeTeam = teams[game.home];
      const awayTeam = teams[game.away];
      const gameR = negBinomial.getGameR({
        park: homeTeam?.park,
        homeBullpenEra: homeTeam?.bullpenEra,
        awayBullpenEra: awayTeam?.bullpenEra,
        isPreseason: false, // backtest is regular season
      });
      
      let nbOver = 0, nbUnder = 0;
      for (let a = 0; a <= 20; a++) {
        for (let h = 0; h <= 20; h++) {
          const p = negBinomial.negBinPMF(a, awayExp, gameR) * negBinomial.negBinPMF(h, homeExp, gameR);
          if (a + h > bookTotal) nbOver += p;
          else if (a + h < bookTotal) nbUnder += p;
        }
      }
      
      // Track totals error
      const totalError = projTotal - actualTotal;
      poissonErrors.push(totalError);
      nbErrors.push(totalError); // same expected runs, different distribution
      
      // Track O/U accuracy
      const isOver = actualTotal > bookTotal;
      const isUnder = actualTotal < bookTotal;
      const isPush = actualTotal === bookTotal;
      
      if (!isPush) {
        // Poisson
        const poissonPicksOver = poissonOver > poissonUnder;
        if ((poissonPicksOver && isOver) || (!poissonPicksOver && isUnder)) {
          results.poisson.ouCorrect++;
        }
        results.poisson.ouTotal++;
        
        // NB
        const nbPicksOver = nbOver > nbUnder;
        if ((nbPicksOver && isOver) || (!nbPicksOver && isUnder)) {
          results.negBin.ouCorrect++;
        }
        results.negBin.ouTotal++;
        
        // Brier scores (probability calibration of the winning pick)
        const poissonProb = poissonPicksOver ? poissonOver : poissonUnder;
        const poissonOutcome = (poissonPicksOver && isOver) || (!poissonPicksOver && isUnder) ? 1 : 0;
        poissonBrierSum += Math.pow(poissonProb - poissonOutcome, 2);
        
        const nbProb = nbPicksOver ? nbOver : nbUnder;
        const nbOutcome = (nbPicksOver && isOver) || (!nbPicksOver && isUnder) ? 1 : 0;
        nbBrierSum += Math.pow(nbProb - nbOutcome, 2);
        
        // Edge detection: only bet when model has 3%+ edge
        const MIN_EDGE = 0.03;
        // Poisson edge bets
        if (poissonOver - 0.5 > MIN_EDGE) {
          poissonEdgeBets++;
          if (isOver) { poissonEdgeWins++; poissonEdgePL += 0.91; } // -110 vig
          else { poissonEdgePL -= 1; }
        } else if (poissonUnder - 0.5 > MIN_EDGE) {
          poissonEdgeBets++;
          if (isUnder) { poissonEdgeWins++; poissonEdgePL += 0.91; }
          else { poissonEdgePL -= 1; }
        }
        
        // NB edge bets
        if (nbOver - 0.5 > MIN_EDGE) {
          nbEdgeBets++;
          if (isOver) { nbEdgeWins++; nbEdgePL += 0.91; }
          else { nbEdgePL -= 1; }
        } else if (nbUnder - 0.5 > MIN_EDGE) {
          nbEdgeBets++;
          if (isUnder) { nbEdgeWins++; nbEdgePL += 0.91; }
          else { nbEdgePL -= 1; }
        }
      }
      
      // Bucket analysis
      function getBucket(total) {
        if (total <= 6.5) return '5.5-6.5';
        if (total <= 7.5) return '6.5-7.5';
        if (total <= 8.5) return '7.5-8.5';
        if (total <= 9.5) return '8.5-9.5';
        if (total <= 10.5) return '9.5-10.5';
        return '10.5+';
      }
      
      const bucket = getBucket(bookTotal);
      if (results.poisson.byBucket[bucket]) {
        results.poisson.byBucket[bucket].games++;
        results.poisson.byBucket[bucket].predicted += projTotal;
        results.poisson.byBucket[bucket].actual += actualTotal;
        results.poisson.byBucket[bucket].total++;
        if (!isPush && ((poissonOver > poissonUnder && isOver) || (poissonUnder > poissonOver && isUnder))) {
          results.poisson.byBucket[bucket].overCorrect++;
        }
        
        results.negBin.byBucket[bucket].games++;
        results.negBin.byBucket[bucket].predicted += projTotal;
        results.negBin.byBucket[bucket].actual += actualTotal;
        results.negBin.byBucket[bucket].total++;
        if (!isPush && ((nbOver > nbUnder && isOver) || (nbUnder > nbOver && isUnder))) {
          results.negBin.byBucket[bucket].overCorrect++;
        }
      }
      
    } catch (e) {
      // Skip games with errors
    }
  }
  
  // Calculate summary stats
  const n = poissonErrors.length;
  if (n > 0) {
    results.poisson.totalsBias = +(poissonErrors.reduce((s, e) => s + e, 0) / n).toFixed(3);
    results.poisson.mae = +(poissonErrors.reduce((s, e) => s + Math.abs(e), 0) / n).toFixed(3);
    results.poisson.rmse = +(Math.sqrt(poissonErrors.reduce((s, e) => s + e*e, 0) / n)).toFixed(3);
    results.poisson.ouAccuracy = +(results.poisson.ouCorrect / results.poisson.ouTotal * 100).toFixed(1);
    results.poisson.brierScore = +(poissonBrierSum / results.poisson.ouTotal).toFixed(4);
    
    results.negBin.totalsBias = +(nbErrors.reduce((s, e) => s + e, 0) / n).toFixed(3);
    results.negBin.mae = +(nbErrors.reduce((s, e) => s + Math.abs(e), 0) / n).toFixed(3);
    results.negBin.rmse = +(Math.sqrt(nbErrors.reduce((s, e) => s + e*e, 0) / n)).toFixed(3);
    results.negBin.ouAccuracy = +(results.negBin.ouCorrect / results.negBin.ouTotal * 100).toFixed(1);
    results.negBin.brierScore = +(nbBrierSum / results.negBin.ouTotal).toFixed(4);
  }
  
  // Calculate bucket averages
  for (const model of ['poisson', 'negBin']) {
    for (const [bucket, data] of Object.entries(results[model].byBucket)) {
      if (data.games > 0) {
        data.avgPredicted = +(data.predicted / data.games).toFixed(2);
        data.avgActual = +(data.actual / data.games).toFixed(2);
        data.accuracy = data.total > 0 ? +(data.overCorrect / data.total * 100).toFixed(1) : 0;
      }
    }
  }
  
  // Edge detection results
  results.edgeDetection = {
    poisson: {
      bets: poissonEdgeBets,
      wins: poissonEdgeWins,
      accuracy: poissonEdgeBets > 0 ? +(poissonEdgeWins / poissonEdgeBets * 100).toFixed(1) : 0,
      pl: +poissonEdgePL.toFixed(2),
      roi: poissonEdgeBets > 0 ? +(poissonEdgePL / poissonEdgeBets * 100).toFixed(1) : 0,
    },
    negBin: {
      bets: nbEdgeBets,
      wins: nbEdgeWins,
      accuracy: nbEdgeBets > 0 ? +(nbEdgeWins / nbEdgeBets * 100).toFixed(1) : 0,
      pl: +nbEdgePL.toFixed(2),
      roi: nbEdgeBets > 0 ? +(nbEdgePL / nbEdgeBets * 100).toFixed(1) : 0,
    },
  };
  
  // Verdict
  const nbBetter = results.negBin.ouAccuracy > results.poisson.ouAccuracy;
  const brierBetter = results.negBin.brierScore < results.poisson.brierScore;
  const edgeBetter = results.edgeDetection.negBin.roi > results.edgeDetection.poisson.roi;
  
  results.verdict = {
    ouAccuracyWinner: nbBetter ? 'NegBin' : 'Poisson',
    ouAccuracyDiff: +(results.negBin.ouAccuracy - results.poisson.ouAccuracy).toFixed(1),
    brierScoreWinner: brierBetter ? 'NegBin' : 'Poisson',
    brierScoreDiff: +(results.poisson.brierScore - results.negBin.brierScore).toFixed(4),
    edgeROIWinner: edgeBetter ? 'NegBin' : 'Poisson',
    edgeROIDiff: +(results.edgeDetection.negBin.roi - results.edgeDetection.poisson.roi).toFixed(1),
    overallWinner: (nbBetter && brierBetter) || (nbBetter && edgeBetter) || (brierBetter && edgeBetter) ? 'NegBin' : 'Poisson',
    note: nbBetter ? 
      'Negative Binomial improves totals accuracy — overdispersion modeling pays off 💰' : 
      'Poisson still competitive — NB advantage is in extreme/variance games',
  };
  
  return results;
}

module.exports = { runTotalsBacktest };
