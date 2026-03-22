#!/usr/bin/env node
/**
 * MLB Model Accuracy Audit v2.0 — FAST MODE
 * ==========================================
 * Implements the core MLB prediction math inline (no service dependencies)
 * to run ~2400 predictions in seconds. 
 * Generates calibration corrections for Opening Day.
 */

const path = require('path');
const fs = require('fs');

const cache = require('../services/historical-games-cache.json');
const games = cache.games || [];

console.log(`\n🔬 MLB MODEL ACCURACY AUDIT — ${games.length} games from 2024 season\n`);
console.log('='.repeat(70));

// ==================== TEAM DATABASE (2024 season final stats) ====================
// These match our models/mlb.js STATIC_TEAMS for 2024 projections
const TEAMS = {
  NYY: {rsG:5.1,raG:3.8,ops:.763,era:3.65,whip:1.22,k9:9.2,fip:3.70,bullpenEra:3.45,w:95,l:67,park:'NYY'},
  BAL: {rsG:4.8,raG:3.9,ops:.745,era:3.78,whip:1.24,k9:8.9,fip:3.82,bullpenEra:3.55,w:91,l:71,park:'BAL'},
  BOS: {rsG:4.7,raG:4.2,ops:.740,era:4.05,whip:1.28,k9:8.5,fip:4.00,bullpenEra:3.80,w:85,l:77,park:'BOS'},
  TOR: {rsG:4.3,raG:4.3,ops:.720,era:4.15,whip:1.30,k9:8.4,fip:4.10,bullpenEra:3.90,w:79,l:83,park:'TOR'},
  TB:  {rsG:4.1,raG:4.4,ops:.710,era:4.20,whip:1.29,k9:9.0,fip:4.05,bullpenEra:3.70,w:76,l:86,park:'TB'},
  CLE: {rsG:4.5,raG:3.7,ops:.730,era:3.55,whip:1.20,k9:8.8,fip:3.60,bullpenEra:3.30,w:92,l:70,park:'CLE'},
  KC:  {rsG:4.6,raG:4.1,ops:.735,era:3.95,whip:1.27,k9:8.3,fip:3.90,bullpenEra:3.65,w:86,l:76,park:'KC'},
  DET: {rsG:4.2,raG:4.1,ops:.715,era:3.95,whip:1.26,k9:8.6,fip:3.88,bullpenEra:3.75,w:82,l:80,park:'DET'},
  MIN: {rsG:4.5,raG:4.4,ops:.732,era:4.22,whip:1.31,k9:8.4,fip:4.15,bullpenEra:3.85,w:80,l:82,park:'MIN'},
  CWS: {rsG:3.6,raG:5.2,ops:.680,era:5.00,whip:1.42,k9:7.8,fip:4.85,bullpenEra:4.50,w:58,l:104,park:'CWS'},
  HOU: {rsG:4.9,raG:3.9,ops:.755,era:3.75,whip:1.23,k9:9.1,fip:3.72,bullpenEra:3.50,w:90,l:72,park:'HOU'},
  SEA: {rsG:4.2,raG:3.8,ops:.718,era:3.68,whip:1.22,k9:9.3,fip:3.62,bullpenEra:3.40,w:85,l:77,park:'SEA'},
  TEX: {rsG:4.7,raG:4.3,ops:.742,era:4.12,whip:1.29,k9:8.7,fip:4.05,bullpenEra:3.80,w:82,l:80,park:'TEX'},
  LAA: {rsG:4.3,raG:4.7,ops:.722,era:4.45,whip:1.33,k9:8.2,fip:4.35,bullpenEra:4.10,w:73,l:89,park:'LAA'},
  OAK: {rsG:3.8,raG:5.0,ops:.695,era:4.80,whip:1.38,k9:8.0,fip:4.65,bullpenEra:4.35,w:65,l:97,park:'OAK'},
  ATL: {rsG:5.0,raG:3.8,ops:.758,era:3.62,whip:1.21,k9:9.0,fip:3.58,bullpenEra:3.40,w:93,l:69,park:'ATL'},
  PHI: {rsG:4.9,raG:3.9,ops:.752,era:3.72,whip:1.23,k9:9.1,fip:3.68,bullpenEra:3.50,w:92,l:70,park:'PHI'},
  NYM: {rsG:4.7,raG:4.0,ops:.742,era:3.85,whip:1.25,k9:8.8,fip:3.80,bullpenEra:3.55,w:88,l:74,park:'NYM'},
  MIA: {rsG:3.7,raG:4.8,ops:.688,era:4.62,whip:1.36,k9:8.1,fip:4.50,bullpenEra:4.20,w:65,l:97,park:'MIA'},
  WSH: {rsG:4.0,raG:4.7,ops:.708,era:4.48,whip:1.34,k9:8.2,fip:4.40,bullpenEra:4.15,w:71,l:91,park:'WSH'},
  MIL: {rsG:4.6,raG:3.8,ops:.738,era:3.65,whip:1.22,k9:9.0,fip:3.62,bullpenEra:3.35,w:91,l:71,park:'MIL'},
  CHC: {rsG:4.5,raG:4.2,ops:.732,era:4.02,whip:1.27,k9:8.6,fip:3.95,bullpenEra:3.70,w:83,l:79,park:'CHC'},
  STL: {rsG:4.2,raG:4.3,ops:.720,era:4.12,whip:1.28,k9:8.5,fip:4.05,bullpenEra:3.80,w:78,l:84,park:'STL'},
  PIT: {rsG:4.0,raG:4.4,ops:.710,era:4.22,whip:1.30,k9:8.3,fip:4.15,bullpenEra:3.90,w:75,l:87,park:'PIT'},
  CIN: {rsG:4.4,raG:4.5,ops:.728,era:4.30,whip:1.31,k9:8.7,fip:4.20,bullpenEra:4.00,w:77,l:85,park:'CIN'},
  LAD: {rsG:5.3,raG:3.6,ops:.775,era:3.42,whip:1.18,k9:9.5,fip:3.38,bullpenEra:3.20,w:98,l:64,park:'LAD'},
  SD:  {rsG:4.7,raG:3.9,ops:.745,era:3.75,whip:1.23,k9:9.2,fip:3.70,bullpenEra:3.45,w:88,l:74,park:'SD'},
  ARI: {rsG:4.8,raG:4.2,ops:.748,era:4.02,whip:1.27,k9:8.8,fip:3.95,bullpenEra:3.65,w:85,l:77,park:'ARI'},
  SF:  {rsG:4.2,raG:4.3,ops:.718,era:4.10,whip:1.28,k9:8.5,fip:4.02,bullpenEra:3.75,w:78,l:84,park:'SF'},
  COL: {rsG:4.5,raG:5.5,ops:.725,era:5.25,whip:1.45,k9:7.5,fip:5.10,bullpenEra:4.60,w:62,l:100,park:'COL'},
};

const PARK_FACTORS = {
  NYY:1.05,BAL:1.03,BOS:1.08,TOR:1.02,TB:0.94,
  CLE:0.97,KC:0.99,DET:0.97,MIN:1.00,CWS:1.01,
  HOU:1.02,SEA:0.95,TEX:1.06,LAA:1.00,OAK:0.96,
  ATL:0.98,PHI:1.05,NYM:0.96,MIA:0.95,WSH:0.99,
  MIL:1.01,CHC:1.04,STL:1.00,PIT:0.98,CIN:1.12,
  LAD:0.97,SD:0.94,ARI:1.04,SF:0.93,COL:1.25,
};

const LG_AVG = { rsG: 4.4, raG: 4.4, fip: 4.0 };
const HCA_SHIFT = 0.018;
const PYTH_EXP = 1.83;

// Alias map
const ALIAS = { 'CHW': 'CWS' };

// ==================== FAST POISSON WIN PROB ====================
function poissonPMF(lambda, k) {
  if (k < 0 || lambda <= 0) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonWinProb(awayLambda, homeLambda, maxRuns = 15) {
  let homeWin = 0, awayWin = 0, tie = 0;
  for (let a = 0; a <= maxRuns; a++) {
    const pa = poissonPMF(awayLambda, a);
    for (let h = 0; h <= maxRuns; h++) {
      const ph = poissonPMF(homeLambda, h);
      const prob = pa * ph;
      if (h > a) homeWin += prob;
      else if (a > h) awayWin += prob;
      else tie += prob;
    }
  }
  // Split ties (home team bats last, slight advantage)
  homeWin += tie * 0.52;
  awayWin += tie * 0.48;
  const total = homeWin + awayWin;
  return { home: homeWin / total, away: awayWin / total };
}

// ==================== FAST PREDICT ====================
function fastPredict(awayAbbr, homeAbbr) {
  const away = TEAMS[awayAbbr];
  const home = TEAMS[homeAbbr];
  if (!away || !home) return null;
  
  const pf = PARK_FACTORS[homeAbbr] || 1.0;
  
  // Expected runs: offense vs defense, adjusted for park
  let awayExpRuns = away.rsG * (home.raG / LG_AVG.raG) * pf;
  let homeExpRuns = home.rsG * (away.raG / LG_AVG.raG) * pf;
  
  // Ensure sane bounds
  awayExpRuns = Math.max(2.0, Math.min(8.0, awayExpRuns));
  homeExpRuns = Math.max(2.0, Math.min(8.0, homeExpRuns));
  
  // Win probability via Poisson
  const pp = poissonWinProb(awayExpRuns, homeExpRuns);
  
  // Apply HCA — CALIBRATION v3: cap at 0.68 initial, 0.72 final
  // Audit of 2375 games shows model overconfident at extremes
  let homeWP = Math.min(0.68, Math.max(0.32, pp.home + HCA_SHIFT));
  let awayWP = 1 - homeWP;
  
  // Power rating momentum nudge
  const awayPyth = Math.pow(away.rsG, PYTH_EXP) / (Math.pow(away.rsG, PYTH_EXP) + Math.pow(away.raG, PYTH_EXP));
  const homePyth = Math.pow(home.rsG, PYTH_EXP) / (Math.pow(home.rsG, PYTH_EXP) + Math.pow(home.raG, PYTH_EXP));
  const momAdj = (homePyth - awayPyth) * 0.02;
  homeWP = Math.min(0.72, Math.max(0.28, homeWP + momAdj));
  awayWP = 1 - homeWP;
  
  const totalRuns = awayExpRuns + homeExpRuns;
  
  return {
    homeWinProb: +homeWP.toFixed(4),
    awayWinProb: +awayWP.toFixed(4),
    totalRuns: +totalRuns.toFixed(1),
    awayExpRuns: +awayExpRuns.toFixed(2),
    homeExpRuns: +homeExpRuns.toFixed(2),
  };
}

// ==================== RUN AUDIT ====================
const results = {
  total: 0, correct: 0, homeGames: 0, homeCorrect: 0, awayCorrect: 0,
  calibration: {},
  totalRunsErrors: [],
  byMonth: {},
  byTeam: {},
  bigFavWins: { correct: 0, total: 0 },
  medFavWins: { correct: 0, total: 0 },
  closePicks: { correct: 0, total: 0 },
  worstMisses: [],
  totalRunsPredicted: 0,
  totalRunsActual: 0,
};

// Calibration buckets
for (let low = 0.20; low <= 0.80; low += 0.05) {
  const key = `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
  results.calibration[key] = { predicted: 0, actual: 0, total: 0 };
}

const startTime = Date.now();
let skipped = 0;

for (const game of games) {
  const awayAbbr = ALIAS[game.away] || game.away;
  const homeAbbr = ALIAS[game.home] || game.home;
  
  const pred = fastPredict(awayAbbr, homeAbbr);
  if (!pred) { skipped++; continue; }
  
  results.total++;
  
  const homeWP = pred.homeWinProb;
  const awayWP = pred.awayWinProb;
  const predTotal = pred.totalRuns;
  const actualTotal = game.totalRuns || game.actualTotal;
  const homeWon = game.homeWon;
  const predictedHome = homeWP >= 0.5;
  const correct = predictedHome === homeWon;
  
  if (correct) results.correct++;
  if (homeWon) {
    results.homeGames++;
    if (predictedHome) results.homeCorrect++;
  } else {
    if (!predictedHome) results.awayCorrect++;
  }
  
  // Calibration
  const favProb = Math.max(homeWP, awayWP);
  const favWon = (homeWP >= awayWP && homeWon) || (awayWP > homeWP && !homeWon);
  
  for (let low = 0.20; low <= 0.80; low += 0.05) {
    if (favProb >= low && favProb < low + 0.05) {
      const key = `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
      results.calibration[key].total++;
      results.calibration[key].predicted += favProb;
      results.calibration[key].actual += favWon ? 1 : 0;
      break;
    }
  }
  
  // Edge categories
  if (favProb >= 0.65) { results.bigFavWins.total++; if (favWon) results.bigFavWins.correct++; }
  else if (favProb >= 0.55) { results.medFavWins.total++; if (favWon) results.medFavWins.correct++; }
  else { results.closePicks.total++; if (favWon) results.closePicks.correct++; }
  
  // Total runs
  results.totalRunsPredicted += predTotal;
  results.totalRunsActual += actualTotal;
  results.totalRunsErrors.push(predTotal - actualTotal);
  
  // By month
  const month = game.date ? game.date.substring(0, 7) : 'unknown';
  if (!results.byMonth[month]) results.byMonth[month] = { correct: 0, total: 0, totalError: 0 };
  results.byMonth[month].total++;
  if (correct) results.byMonth[month].correct++;
  results.byMonth[month].totalError += Math.abs(predTotal - actualTotal);
  
  // By team
  if (!results.byTeam[homeAbbr]) results.byTeam[homeAbbr] = { correct: 0, total: 0, asHome: 0, homeWins: 0 };
  results.byTeam[homeAbbr].total++;
  results.byTeam[homeAbbr].asHome++;
  if (correct) results.byTeam[homeAbbr].correct++;
  if (homeWon) results.byTeam[homeAbbr].homeWins++;
  
  // Worst misses
  if (!correct && favProb >= 0.60) {
    results.worstMisses.push({
      game: `${awayAbbr}@${homeAbbr}`, date: game.date,
      predicted: predictedHome ? 'HOME' : 'AWAY', actual: homeWon ? 'HOME' : 'AWAY',
      confidence: favProb, score: `${game.awayScore}-${game.homeScore}`,
    });
  }
}

const elapsed = Date.now() - startTime;

// ==================== DISPLAY RESULTS ====================
const awayGames = results.total - results.homeGames;

console.log(`\n⚡ Ran ${results.total} predictions in ${elapsed}ms (${(elapsed/results.total).toFixed(1)}ms/game)`);
console.log(`   Skipped: ${skipped} games (unknown teams)`);

console.log(`\n📊 OVERALL ACCURACY`);
console.log(`   Games analyzed: ${results.total}`);
console.log(`   Correct picks: ${results.correct}/${results.total} (${(results.correct/results.total*100).toFixed(1)}%)`);
console.log(`   Home wins predicted correctly: ${results.homeCorrect}/${results.homeGames} (${(results.homeCorrect/results.homeGames*100).toFixed(1)}%)`);
console.log(`   Away wins predicted correctly: ${results.awayCorrect}/${awayGames} (${(results.awayCorrect/awayGames*100).toFixed(1)}%)`);
console.log(`   Actual home win rate: ${(results.homeGames/results.total*100).toFixed(1)}%`);

console.log(`\n🎯 EDGE DETECTION ACCURACY`);
console.log(`   Big favorites (65%+): ${results.bigFavWins.correct}/${results.bigFavWins.total} (${results.bigFavWins.total ? (results.bigFavWins.correct/results.bigFavWins.total*100).toFixed(1) : 'N/A'}%)`);
console.log(`   Medium favorites (55-65%): ${results.medFavWins.correct}/${results.medFavWins.total} (${results.medFavWins.total ? (results.medFavWins.correct/results.medFavWins.total*100).toFixed(1) : 'N/A'}%)`);
console.log(`   Close games (50-55%): ${results.closePicks.correct}/${results.closePicks.total} (${results.closePicks.total ? (results.closePicks.correct/results.closePicks.total*100).toFixed(1) : 'N/A'}%)`);

console.log(`\n📈 CALIBRATION TABLE (Model Prob vs Actual Win Rate)`);
console.log(`   ${'Range'.padEnd(14)} | ${'Games'.padEnd(6)} | ${'Pred Avg'.padEnd(9)} | ${'Act Win%'.padEnd(9)} | ${'Error'.padEnd(8)} | Grade`);
console.log(`   ${'-'.repeat(14)}-+-${'-'.repeat(6)}-+-${'-'.repeat(9)}-+-${'-'.repeat(9)}-+-${'-'.repeat(8)}-+------`);

const calibrationMap = {};
for (const [range, data] of Object.entries(results.calibration)) {
  if (data.total < 10) continue;
  const predAvg = (data.predicted / data.total * 100).toFixed(1);
  const actPct = (data.actual / data.total * 100).toFixed(1);
  const error = (data.actual / data.total - data.predicted / data.total) * 100;
  
  let grade = 'A';
  if (Math.abs(error) > 8) grade = 'D';
  else if (Math.abs(error) > 5) grade = 'C';
  else if (Math.abs(error) > 3) grade = 'B';
  
  console.log(`   ${range.padEnd(14)} | ${String(data.total).padEnd(6)} | ${predAvg.padEnd(9)} | ${actPct.padEnd(9)} | ${(error > 0 ? '+' : '') + error.toFixed(1) + '%'.padEnd(4)} | ${grade}`);
  
  calibrationMap[range] = {
    games: data.total,
    predictedAvg: +(data.predicted / data.total).toFixed(4),
    actualWinRate: +(data.actual / data.total).toFixed(4),
    correction: +((data.actual / data.total) / (data.predicted / data.total)).toFixed(4),
  };
}

console.log(`\n📅 ACCURACY BY MONTH`);
for (const [month, data] of Object.entries(results.byMonth).sort()) {
  const pct = (data.correct / data.total * 100).toFixed(1);
  const avgTotalErr = (data.totalError / data.total).toFixed(1);
  console.log(`   ${month}: ${data.correct}/${data.total} (${pct}%) — avg total error: ±${avgTotalErr} runs`);
}

console.log(`\n🏟️ TOTAL RUNS ACCURACY`);
const avgError = results.totalRunsErrors.reduce((s, e) => s + e, 0) / results.totalRunsErrors.length;
const mae = results.totalRunsErrors.map(e => Math.abs(e)).reduce((s, e) => s + e, 0) / results.totalRunsErrors.length;
const rmse = Math.sqrt(results.totalRunsErrors.map(e => e*e).reduce((s, e) => s + e, 0) / results.totalRunsErrors.length);

console.log(`   Mean Error (bias): ${avgError > 0 ? '+' : ''}${avgError.toFixed(2)} runs (${avgError > 0 ? 'OVER-predicting' : 'UNDER-predicting'})`);
console.log(`   Mean Absolute Error: ${mae.toFixed(2)} runs`);
console.log(`   RMSE: ${rmse.toFixed(2)} runs`);
console.log(`   Avg Predicted Total: ${(results.totalRunsPredicted / results.total).toFixed(2)}`);
console.log(`   Avg Actual Total: ${(results.totalRunsActual / results.total).toFixed(2)}`);

// O/U accuracy at various lines
for (const line of [7.5, 8.0, 8.5, 9.0, 9.5]) {
  let overCorrect = 0, underCorrect = 0, total = 0;
  for (let i = 0; i < games.length; i++) {
    const predTotal = results.totalRunsErrors[i] !== undefined ? 
      games[i].totalRuns + results.totalRunsErrors[i] : null; // reconstruct
    if (!predTotal) continue;
    
    const awayAbbr = ALIAS[games[i].away] || games[i].away;
    const homeAbbr = ALIAS[games[i].home] || games[i].home;
    const p = fastPredict(awayAbbr, homeAbbr);
    if (!p) continue;
    
    const actual = games[i].totalRuns;
    if (actual === line) continue; // push
    total++;
    if (p.totalRuns > line && actual > line) overCorrect++;
    else if (p.totalRuns < line && actual < line) underCorrect++;
  }
  const pct = total > 0 ? ((overCorrect + underCorrect) / total * 100).toFixed(1) : 'N/A';
  console.log(`   O/U at ${line}: ${overCorrect + underCorrect}/${total} (${pct}%)`);
}

console.log(`\n🏆 TOP 10 WORST MISSES`);
results.worstMisses.sort((a, b) => b.confidence - a.confidence);
for (const miss of results.worstMisses.slice(0, 10)) {
  console.log(`   ${miss.date} ${miss.game}: Predicted ${miss.predicted} (${(miss.confidence*100).toFixed(1)}%), Actual ${miss.actual} — ${miss.score}`);
}

// Per-team
console.log(`\n📋 PER-TEAM ACCURACY (sorted)`);
console.log(`   ${'Team'.padEnd(5)} | ${'Right'.padEnd(5)} | ${'Total'.padEnd(5)} | ${'Acc%'.padEnd(6)} | ${'HomeW%'.padEnd(6)}`);
console.log(`   ${'-'.repeat(5)}-+-${'-'.repeat(5)}-+-${'-'.repeat(5)}-+-${'-'.repeat(6)}-+-${'-'.repeat(6)}`);

const teamEntries = Object.entries(results.byTeam)
  .map(([team, d]) => ({ team, ...d, accuracy: d.correct / d.total }))
  .sort((a, b) => b.accuracy - a.accuracy);

for (const t of teamEntries) {
  console.log(`   ${t.team.padEnd(5)} | ${String(t.correct).padEnd(5)} | ${String(t.total).padEnd(5)} | ${(t.accuracy*100).toFixed(1).padEnd(6)} | ${(t.homeWins/t.asHome*100).toFixed(0).padEnd(6)}`);
}

// ==================== GENERATE CALIBRATION CORRECTION ====================
// Build piecewise linear correction function
const corrections = [];
for (const [range, data] of Object.entries(calibrationMap)) {
  corrections.push({
    midpoint: (data.predictedAvg * 100),
    actualRate: (data.actualWinRate * 100),
    correction: data.correction,
    games: data.games,
  });
}

// Also compute total runs bias correction
const totalRunsBias = avgError;
const totalRunsMAE = mae;

const outputPath = path.join(__dirname, '..', 'services', 'mlb-calibration-audit.json');
fs.writeFileSync(outputPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  gamesAnalyzed: results.total,
  overallAccuracy: +(results.correct / results.total).toFixed(4),
  homeWinRate: +(results.homeGames / results.total).toFixed(4),
  totalRuns: {
    bias: +totalRunsBias.toFixed(3),
    mae: +totalRunsMAE.toFixed(3),
    rmse: +rmse.toFixed(3),
    avgPredicted: +(results.totalRunsPredicted / results.total).toFixed(2),
    avgActual: +(results.totalRunsActual / results.total).toFixed(2),
  },
  calibration: calibrationMap,
  corrections,
  byMonth: Object.fromEntries(
    Object.entries(results.byMonth).sort().map(([m, d]) => [m, {
      accuracy: +(d.correct / d.total).toFixed(4),
      games: d.total,
    }])
  ),
}, null, 2));

console.log(`\n💾 Calibration audit saved to: ${outputPath}`);
console.log(`\n${'='.repeat(70)}`);
console.log(`🦞 MLB MODEL AUDIT COMPLETE — ${results.total} games in ${elapsed}ms`);
console.log(`   Overall accuracy: ${(results.correct/results.total*100).toFixed(1)}%`);
console.log(`   Total runs bias: ${avgError > 0 ? '+' : ''}${avgError.toFixed(2)} runs`);
console.log(`   Opening Day readiness: ${results.correct/results.total >= 0.52 ? '✅ YES' : '⚠️ NEEDS WORK'}`);
console.log(`${'='.repeat(70)}\n`);
