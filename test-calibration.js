const mlb = require('./models/mlb');

const games = [
  ['KC', 'ATL', 'Cole Ragans', 'Chris Sale', -152],
  ['PIT', 'NYM', 'Paul Skenes', 'Freddy Peralta', -122],
  ['CWS', 'MIL', null, null, -197],
  ['BOS', 'CIN', 'Garrett Crochet', 'Andrew Abbott', 134],
  ['DET', 'SD', 'Tarik Skubal', null, 118],
  ['MIN', 'BAL', 'Joe Ryan', 'Trevor Rogers', -162],
  ['LAA', 'HOU', 'Jose Soriano', 'Hunter Brown', -190],
  ['TEX', 'PHI', 'Nathan Eovaldi', 'Cristopher Sanchez', -154],
  ['TB', 'STL', 'Drew Rasmussen', 'Matthew Liberatore', 104],
];

function mlToProb(ml) {
  if (ml < 0) return -ml / (-ml + 100);
  return 100 / (ml + 100);
}

console.log('=== MLB MODEL CALIBRATION v4 ===');
let totalAbsDiff = 0, count = 0;
for (const [away, home, ap, hp, dkHomeML] of games) {
  const result = mlb.predict(away, home, {awayPitcher: ap || undefined, homePitcher: hp || undefined});
  const dkImplied = mlToProb(dkHomeML);
  const diff = (result.homeWinProb - dkImplied) * 100;
  totalAbsDiff += Math.abs(diff); count++;
  const sign = diff > 0 ? '+' : '';
  console.log(away + ' @ ' + home + ': Model ' + (result.homeWinProb*100).toFixed(1) + '% | DK ' + (dkImplied*100).toFixed(1) + '% | Diff: ' + sign + diff.toFixed(1) + '% | ML: ' + result.homeML + '/' + result.awayML + ' | Total: ' + result.totalRuns);
}
console.log('\nAvg |diff| from DK: ' + (totalAbsDiff/count).toFixed(1) + '%');

// Also test one-pitcher scenario
console.log('\n=== ONE PITCHER TEST ===');
const r1 = mlb.predict('DET', 'SD');
const r2 = mlb.predict('DET', 'SD', {awayPitcher: 'Tarik Skubal'});
const r3 = mlb.predict('DET', 'SD', {awayPitcher: 'Tarik Skubal', homePitcher: 'Dylan Cease'});
console.log('DET @ SD (no pitchers): SD ' + (r1.homeWinProb*100).toFixed(1) + '% | Runs: ' + r1.awayExpRuns + '-' + r1.homeExpRuns);
console.log('DET @ SD (Skubal only): SD ' + (r2.homeWinProb*100).toFixed(1) + '% | Runs: ' + r2.awayExpRuns + '-' + r2.homeExpRuns);
console.log('DET @ SD (Skubal vs Cease): SD ' + (r3.homeWinProb*100).toFixed(1) + '% | Runs: ' + r3.awayExpRuns + '-' + r3.homeExpRuns);
