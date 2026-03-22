// Quick train script for ML v3.0
const hg = require('./services/historical-games');
const { spawn } = require('child_process');

async function train() {
  console.log('Loading training data...');
  const data = await hg.getTrainingData({ maxGames: 3000 });
  console.log(`Loaded ${data.length} games for training`);
  
  const input = JSON.stringify({ mode: 'train', sport: 'mlb', data });
  console.log(`Input JSON size: ${(input.length / 1024).toFixed(0)}KB`);
  
  console.log('Starting Python ML training (XGBoost + LightGBM + Elo)...');
  const proc = spawn('/usr/bin/python3', ['services/ml-engine.py'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000,
  });
  
  let stdout = '';
  let stderr = '';
  
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { 
    stderr += d.toString(); 
    process.stderr.write(d);
  });
  
  proc.on('close', (code) => {
    if (code !== 0) {
      console.error('Training FAILED with code', code);
      console.error(stderr);
      process.exit(1);
    }
    
    try {
      const result = JSON.parse(stdout);
      console.log('\n========== ML v3.0 TRAINING RESULTS ==========');
      console.log(`Games: ${result.games}`);
      console.log(`Home Win Rate: ${(result.homeWinRate * 100).toFixed(1)}%`);
      console.log(`Models: ${result.modelsUsed?.join(', ')}`);
      console.log(`XGBoost: ${result.hasXGBoost}, LightGBM: ${result.hasLightGBM}`);
      console.log('\nModel Accuracies:');
      for (const [name, m] of Object.entries(result.models || {})) {
        console.log(`  ${name}: ${(m.cv_accuracy * 100).toFixed(1)}% ± ${(m.cv_std * 100).toFixed(1)}% (weight: ${(m.weight * 100).toFixed(1)}%)`);
      }
      console.log(`\nEnsemble: ${(result.ensemble.accuracy * 100).toFixed(1)}% acc, Brier: ${result.ensemble.brier_score}, LogLoss: ${result.ensemble.log_loss}`);
      console.log('\nTop Features:');
      for (const f of (result.top_features || []).slice(0, 10)) {
        console.log(`  ${f.feature}: ${f.importance.toFixed(4)}`);
      }
      if (result.elo) {
        console.log(`\nElo Ratings (${result.elo.teams_rated} teams):`);
        console.log('  Top:', result.elo.top_teams.map(t => `${t.team} ${t.elo}`).join(', '));
        console.log('  Bottom:', result.elo.bottom_teams.map(t => `${t.team} ${t.elo}`).join(', '));
      }
      if (result.totals) {
        console.log(`\nTotals Model: MAE ${result.totals.mae}, RMSE ${result.totals.rmse}, ${result.totals.games} games`);
      }
      console.log('\nCalibration:');
      for (const c of result.calibration || []) {
        console.log(`  ${c.bucket}: predicted ${(c.predicted * 100).toFixed(1)}%, actual ${(c.actual * 100).toFixed(1)}% (n=${c.count})`);
      }
      console.log('\n✅ Model saved to:', result.model_path);
    } catch (e) {
      console.error('Failed to parse output:', e.message);
      console.log('Raw output:', stdout.slice(0, 500));
    }
  });
  
  proc.stdin.write(input);
  proc.stdin.end();
}

train().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
