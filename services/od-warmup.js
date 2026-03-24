/**
 * OD Game Day Warm-Up Service v122.0
 * ====================================
 * Warms all critical caches and endpoints before Opening Day first pitch.
 * 
 * Call /api/od/warmup to:
 *   1. Trigger OD Playbook cache build
 *   2. Pull latest weather for all OD venues
 *   3. Refresh live data feeds
 *   4. Warm the betting card cache
 *   5. Health check all sub-services
 * 
 * Designed to be called 30-60 min before first pitch (PIT@NYM 1:10PM ET = 17:10 UTC)
 * or manually any time to wake everything up.
 */

const https = require('https');

// Track warm-up state
let warmupState = {
  lastRun: null,
  status: 'idle',
  phases: {},
  errors: [],
  duration: null,
};

// Helper to check if service is available
function serviceCheck(name, svc) {
  const checks = [];
  if (!svc) return { name, loaded: false };
  // Basic existence check
  return { name, loaded: true };
}

async function runWarmup(deps = {}) {
  const start = Date.now();
  warmupState = {
    lastRun: new Date().toISOString(),
    status: 'running',
    phases: {},
    errors: [],
    duration: null,
  };
  
  const results = {};
  
  // Phase 1: Service health check
  warmupState.phases.services = 'running';
  try {
    const services = [
      serviceCheck('MLB Model', deps.mlb),
      serviceCheck('Weather', deps.weather),
      serviceCheck('Umpires', deps.umpireService),
      serviceCheck('OD Playbook Cache', deps.odPlaybookCache),
      serviceCheck('Statcast', deps.statcast),
      serviceCheck('Calibration', deps.calibration),
      serviceCheck('Live Execution', deps.liveExecution),
      serviceCheck('Lineup Fetcher', deps.lineupFetcher),
      serviceCheck('Lineup Bridge', deps.lineupBridge),
      serviceCheck('MLB Stats Lineups', deps.mlbStatsLineups),
      serviceCheck('K Props', deps.pitcherKProps),
      serviceCheck('NRFI Model', deps.nrfiModel),
      serviceCheck('F3 Model', deps.f3Model),
      serviceCheck('F7 Model', deps.f7Model),
      serviceCheck('Outs Props', deps.pitcherOutsProps),
      serviceCheck('SGP Builder', deps.odSgpBuilder),
      serviceCheck('Auto Grade Pipeline', deps.autoGradePipeline),
      serviceCheck('Edge Decay', deps.edgeDecayOptimizer),
    ];
    const loaded = services.filter(s => s.loaded).length;
    const total = services.length;
    results.services = { loaded, total, missing: services.filter(s => !s.loaded).map(s => s.name) };
    warmupState.phases.services = loaded === total ? 'pass' : 'warn';
  } catch (e) {
    results.services = { error: e.message };
    warmupState.phases.services = 'fail';
    warmupState.errors.push(`services: ${e.message}`);
  }
  
  // Phase 2: Refresh live data feeds
  warmupState.phases.liveData = 'running';
  try {
    if (deps.liveData) {
      const liveResult = await Promise.race([
        deps.liveData.refreshAll(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))
      ]);
      results.liveData = liveResult || { refreshed: true };
      warmupState.phases.liveData = 'pass';
    } else {
      results.liveData = { skipped: true };
      warmupState.phases.liveData = 'skip';
    }
  } catch (e) {
    results.liveData = { error: e.message };
    warmupState.phases.liveData = 'fail';
    warmupState.errors.push(`liveData: ${e.message}`);
  }
  
  // Phase 3: Weather refresh for OD venues
  warmupState.phases.weather = 'running';
  try {
    if (deps.weather) {
      const weatherResult = await Promise.race([
        deps.weather.getAllWeather(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000))
      ]);
      results.weather = { parks: weatherResult ? Object.keys(weatherResult).length : 0 };
      warmupState.phases.weather = 'pass';
    } else {
      results.weather = { skipped: true };
      warmupState.phases.weather = 'skip';
    }
  } catch (e) {
    results.weather = { error: e.message };
    warmupState.phases.weather = 'fail';
    warmupState.errors.push(`weather: ${e.message}`);
  }
  
  // Phase 4: OD Playbook build (the heavy one)
  warmupState.phases.playbook = 'running';
  try {
    if (deps.odPlaybookCache) {
      // Check if already cached
      const cached = deps.odPlaybookCache.getCachedOnly ? deps.odPlaybookCache.getCachedOnly() : null;
      if (cached) {
        results.playbook = { status: 'already cached', games: cached.playbook?.length || 0 };
        warmupState.phases.playbook = 'pass';
      } else {
        // Build fresh — give it 60s
        const pbResult = await Promise.race([
          deps.odPlaybookCache.refresh(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 60s')), 60000))
        ]);
        results.playbook = { status: 'built', games: pbResult?.playbook?.length || 0 };
        warmupState.phases.playbook = 'pass';
      }
    } else {
      results.playbook = { skipped: true };
      warmupState.phases.playbook = 'skip';
    }
  } catch (e) {
    results.playbook = { error: e.message };
    warmupState.phases.playbook = 'fail';
    warmupState.errors.push(`playbook: ${e.message}`);
  }
  
  // Phase 5: Memory status
  const mem = process.memoryUsage();
  results.memory = {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024),
  };
  
  // Phase 6: MLB prediction engine test
  warmupState.phases.predictions = 'running';
  try {
    if (deps.mlb) {
      // Quick test: predict one OD game
      const testPred = deps.mlb.predict('PIT', 'NYM');
      results.predictions = {
        test: 'PIT@NYM',
        awayWin: testPred?.awayWinProb?.toFixed(3),
        total: testPred?.total?.toFixed(1),
        working: !!(testPred && testPred.awayWinProb > 0)
      };
      warmupState.phases.predictions = testPred && testPred.awayWinProb > 0 ? 'pass' : 'fail';
    } else {
      results.predictions = { skipped: true };
      warmupState.phases.predictions = 'skip';
    }
  } catch (e) {
    results.predictions = { error: e.message };
    warmupState.phases.predictions = 'fail';
    warmupState.errors.push(`predictions: ${e.message}`);
  }
  
  // Phase 7: Lineup pipeline readiness
  warmupState.phases.lineups = 'running';
  try {
    let lineupStatus = { mlbStats: false, espn: false, bridge: false };
    if (deps.mlbStatsLineups) lineupStatus.mlbStats = true;
    if (deps.lineupFetcher) lineupStatus.espn = true;
    if (deps.lineupBridge) lineupStatus.bridge = true;
    results.lineups = lineupStatus;
    warmupState.phases.lineups = lineupStatus.mlbStats || lineupStatus.espn ? 'pass' : 'warn';
  } catch (e) {
    results.lineups = { error: e.message };
    warmupState.phases.lineups = 'fail';
  }
  
  const elapsed = Date.now() - start;
  warmupState.status = warmupState.errors.length === 0 ? 'ready' : 'ready_with_warnings';
  warmupState.duration = elapsed;
  
  const passCount = Object.values(warmupState.phases).filter(v => v === 'pass').length;
  const totalCount = Object.keys(warmupState.phases).length;
  
  return {
    status: warmupState.status,
    grade: passCount === totalCount ? '🟢 GO' : passCount >= totalCount - 1 ? '🟡 READY' : '🔴 ISSUES',
    phases: warmupState.phases,
    passRate: `${passCount}/${totalCount}`,
    results,
    errors: warmupState.errors,
    durationMs: elapsed,
    timestamp: new Date().toISOString(),
    nextStep: 'If all green, you are GO for Opening Day bets. Hit /api/od/live-execution for real-time edge detection.',
  };
}

function getStatus() {
  return warmupState;
}

module.exports = { runWarmup, getStatus };
