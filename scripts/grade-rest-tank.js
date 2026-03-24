#!/usr/bin/env node
/**
 * Grade NBA Rest/Tank Backtest Results
 * Fetches actual scores from ESPN and updates rest-tank-backtest-data.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_FILE = path.join(__dirname, '..', 'services', 'rest-tank-backtest-data.json');

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function fetchScores(dateStr) {
  return new Promise((resolve, reject) => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = {};
          (json.events || []).forEach(e => {
            const comp = e.competitions[0];
            const away = comp.competitors.find(c => c.homeAway === 'away');
            const home = comp.competitors.find(c => c.homeAway === 'home');
            const status = comp.status.type.name;
            if (status !== 'STATUS_FINAL') return;
            
            const awayAbbr = away.team.abbreviation;
            const homeAbbr = home.team.abbreviation;
            const awayScore = parseInt(away.score);
            const homeScore = parseInt(home.score);
            
            // Try multiple key formats
            const keys = [
              `${awayAbbr}@${homeAbbr}`,
              `${awayAbbr.replace('NY', 'NYK').replace('SA', 'SAS').replace('GS', 'GSW').replace('UTAH', 'UTA')}@${homeAbbr.replace('NY', 'NYK').replace('SA', 'SAS').replace('GS', 'GSW').replace('UTAH', 'UTA')}`
            ];
            
            keys.forEach(key => {
              results[key] = {
                awayScore,
                homeScore,
                margin: homeScore - awayScore,
                total: awayScore + homeScore
              };
            });
          });
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ESPN abbreviation mapping
const ESPN_TO_MODEL = {
  'NY': 'NYK', 'SA': 'SAS', 'GS': 'GSW', 'UTAH': 'UTA',
  'WSH': 'WAS', 'PHX': 'PHO'
};

function normalizeAbbr(abbr) {
  return ESPN_TO_MODEL[abbr] || abbr;
}

async function main() {
  const data = loadData();
  console.log(`Loaded ${data.predictions.length} predictions, ${data.graded.length} graded`);
  
  // Get unique dates
  const dates = [...new Set(data.predictions.map(p => p.date))];
  console.log(`Dates to check: ${dates.join(', ')}`);
  
  // Fetch scores for each date
  const allResults = {};
  for (const date of dates) {
    const dateStr = date.replace(/-/g, '');
    console.log(`\nFetching scores for ${date}...`);
    const scores = await fetchScores(dateStr);
    Object.assign(allResults, scores);
    console.log(`  Found ${Object.keys(scores).length} final games`);
    Object.entries(scores).forEach(([k, v]) => {
      console.log(`  ${k}: ${v.awayScore}-${v.homeScore} (margin: ${v.margin > 0 ? '+' : ''}${v.margin})`);
    });
  }
  
  // Grade predictions
  let newGrades = 0;
  let totalGraded = 0;
  
  for (const pred of data.predictions) {
    if (pred.result) {
      totalGraded++;
      continue; // Already has result
    }
    
    // Try to find matching score
    const gameKey = pred.gameKey;
    const result = allResults[gameKey];
    
    if (!result) {
      console.log(`\n⏳ No final score yet for ${gameKey} on ${pred.date}`);
      continue;
    }
    
    pred.result = result;
    newGrades++;
    totalGraded++;
    
    // Grade the prediction
    const actualMargin = result.margin; // positive = home win
    const baselineError = Math.abs(pred.baselineSpread - actualMargin);
    const adjustedError = Math.abs(pred.adjustedSpread - actualMargin);
    const improvement = baselineError - adjustedError;
    
    pred.grade = {
      actualMargin,
      baselineError: Math.round(baselineError * 10) / 10,
      adjustedError: Math.round(adjustedError * 10) / 10,
      improvement: Math.round(improvement * 10) / 10,
      restTankHelped: improvement > 0,
      homeWin: actualMargin > 0,
      modelCorrectWinner: (pred.adjustedSpread < 0 && actualMargin > 0) || (pred.adjustedSpread > 0 && actualMargin < 0),
      baselineCorrectWinner: (pred.baselineSpread < 0 && actualMargin > 0) || (pred.baselineSpread > 0 && actualMargin < 0)
    };
    
    console.log(`\n✅ Graded ${gameKey} (${pred.date}):`);
    console.log(`   Motivation: ${pred.awayMotivation} @ ${pred.homeMotivation}`);
    console.log(`   Baseline spread: ${pred.baselineSpread} → Adjusted: ${pred.adjustedSpread}`);
    console.log(`   Actual margin: ${actualMargin > 0 ? '+' : ''}${actualMargin} (${result.awayScore}-${result.homeScore})`);
    console.log(`   Baseline error: ${pred.grade.baselineError} | Adjusted error: ${pred.grade.adjustedError}`);
    console.log(`   Rest/Tank ${improvement > 0 ? '✅ HELPED' : '❌ HURT'} by ${Math.abs(improvement).toFixed(1)} pts`);
    console.log(`   Winner call: Baseline=${pred.grade.baselineCorrectWinner ? '✅' : '❌'} | Adjusted=${pred.grade.modelCorrectWinner ? '✅' : '❌'}`);
  }
  
  // Compute summary
  const gradedPreds = data.predictions.filter(p => p.result && p.grade);
  if (gradedPreds.length > 0) {
    const totalImprovement = gradedPreds.reduce((s, p) => s + p.grade.improvement, 0);
    const avgImprovement = totalImprovement / gradedPreds.length;
    const helped = gradedPreds.filter(p => p.grade.restTankHelped).length;
    const adjCorrect = gradedPreds.filter(p => p.grade.modelCorrectWinner).length;
    const baseCorrect = gradedPreds.filter(p => p.grade.baselineCorrectWinner).length;
    const avgBaseError = gradedPreds.reduce((s, p) => s + p.grade.baselineError, 0) / gradedPreds.length;
    const avgAdjError = gradedPreds.reduce((s, p) => s + p.grade.adjustedError, 0) / gradedPreds.length;
    
    // Breakdown by motivation type
    const byMotivation = {};
    gradedPreds.forEach(p => {
      const key = `${p.awayMotivation}@${p.homeMotivation}`;
      if (!byMotivation[key]) byMotivation[key] = { games: 0, improved: 0, totalImprovement: 0 };
      byMotivation[key].games++;
      if (p.grade.restTankHelped) byMotivation[key].improved++;
      byMotivation[key].totalImprovement += p.grade.improvement;
    });
    
    // Mismatch games only
    const mismatchGames = gradedPreds.filter(p => p.mismatchDetected);
    const mismatchImprovement = mismatchGames.length > 0 ? 
      mismatchGames.reduce((s, p) => s + p.grade.improvement, 0) / mismatchGames.length : 0;
    
    data.summary = {
      totalGraded: gradedPreds.length,
      avgImprovement: Math.round(avgImprovement * 100) / 100,
      helpedPct: Math.round(helped / gradedPreds.length * 100),
      adjWinnerPct: Math.round(adjCorrect / gradedPreds.length * 100),
      baseWinnerPct: Math.round(baseCorrect / gradedPreds.length * 100),
      avgBaselineError: Math.round(avgBaseError * 100) / 100,
      avgAdjustedError: Math.round(avgAdjError * 100) / 100,
      mismatchGames: mismatchGames.length,
      mismatchAvgImprovement: Math.round(mismatchImprovement * 100) / 100,
      byMotivation,
      lastGraded: new Date().toISOString()
    };
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 REST/TANK BACKTEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Games graded: ${gradedPreds.length}`);
    console.log(`Avg improvement from rest/tank adj: ${avgImprovement > 0 ? '+' : ''}${avgImprovement.toFixed(2)} pts`);
    console.log(`Adjustment helped: ${helped}/${gradedPreds.length} (${data.summary.helpedPct}%)`);
    console.log(`Winner accuracy — Adjusted: ${adjCorrect}/${gradedPreds.length} (${data.summary.adjWinnerPct}%) | Baseline: ${baseCorrect}/${gradedPreds.length} (${data.summary.baseWinnerPct}%)`);
    console.log(`Avg error — Adjusted: ${avgAdjError.toFixed(2)} | Baseline: ${avgBaseError.toFixed(2)}`);
    console.log(`Mismatch games: ${mismatchGames.length}, avg improvement: ${mismatchImprovement.toFixed(2)} pts`);
    console.log('\nBy Motivation Type:');
    Object.entries(byMotivation).forEach(([key, v]) => {
      console.log(`  ${key}: ${v.games} games, ${v.improved}/${v.games} improved, avg ${(v.totalImprovement / v.games).toFixed(2)} pts`);
    });
  }
  
  // Update graded list
  data.graded = data.predictions.filter(p => p.result && p.grade).map(p => ({
    gameKey: p.gameKey,
    date: p.date,
    result: p.result,
    grade: p.grade,
    awayMotivation: p.awayMotivation,
    homeMotivation: p.homeMotivation,
    mismatchDetected: p.mismatchDetected
  }));
  
  saveData(data);
  console.log(`\n💾 Saved. ${newGrades} new grades, ${totalGraded} total graded.`);
}

main().catch(e => { console.error(e); process.exit(1); });
