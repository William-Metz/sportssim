/**
 * SportsSim E2E Test Suite
 * 
 * Starts the server, hits key endpoints, validates responses.
 * Blocks deploy if core endpoints are broken.
 * 
 * Heavy/external-dependent endpoints (summary, today, odds, value)
 * use longer timeouts and are non-fatal in CI.
 * 
 * Usage: node tests/e2e.test.js
 * Exit code 0 = all pass, 1 = critical failures
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 19876;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 20000;
const IS_CI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

let serverProcess = null;
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

// ─── Helpers ───

function fetch(urlPath, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${urlPath}`;
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await fetch('/api/health', 2000);
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server did not start within ${TIMEOUT_MS}ms`);
}

function parseJSON(body) {
  try { return JSON.parse(body); } catch { return null; }
}

/**
 * Run a test. If critical=false, failures are logged but don't block deploy.
 */
async function test(name, urlPath, validate, { critical = true, timeoutMs = 8000 } = {}) {
  try {
    const res = await fetch(urlPath, timeoutMs);
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} (expected 200)`);
    }
    const json = parseJSON(res.body);
    if (json === null) {
      throw new Error('Response is not valid JSON');
    }
    if (validate) {
      validate(json);
    }
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    if (critical) {
      failed++;
      failures.push({ name, error: err.message });
      console.log(`  ❌ ${name} — ${err.message}`);
    } else {
      skipped++;
      console.log(`  ⚠️  ${name} — ${err.message} (non-critical, skipped)`);
    }
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ─── Test Definitions ───

async function runAllTests() {
  console.log('\n🏀⚾🏒 SportsSim E2E Tests\n');
  
  // === CRITICAL: Core model endpoints (no external deps) ===
  console.log('--- Health ---');
  await test('GET /api/health', '/api/health', (json) => {
    assert(json.status === 'ok' || json.status === 'healthy' || json.ok === true,
      `Unexpected health: ${JSON.stringify(json)}`);
  });

  await test('GET /api/data/status', '/api/data/status', (json) => {
    assert(typeof json === 'object', 'Data status should be an object');
    assert('nba' in json, 'Missing nba');
    assert('mlb' in json, 'Missing mlb');
    assert('nhl' in json, 'Missing nhl');
  });

  // --- NBA Core ---
  console.log('\n--- NBA Core ---');
  await test('NBA ratings', '/api/model/nba/ratings', (json) => {
    const ratings = json.ratings || json;
    assert(Array.isArray(ratings), 'Ratings should be an array');
    assert(ratings.length >= 25, `Expected >=25 teams, got ${ratings.length}`);
  });

  await test('NBA predict', '/api/model/nba/predict?away=LAL&home=BOS', (json) => {
    assert(json.predictedTotal !== undefined || json.predicted_total !== undefined, 'Missing predictedTotal');
    const total = json.predictedTotal || json.predicted_total;
    assert(total > 180 && total < 280, `NBA total ${total} out of range [180, 280] — likely still broken!`);
    assert(json.homeWinProb !== undefined, 'Missing homeWinProb');
    assert(json.spread !== undefined, 'Missing spread');
  });

  await test('NBA predict (alias)', '/api/nba/predict?away=OKC&home=DEN', (json) => {
    const total = json.predictedTotal || json.predicted_total;
    assert(total > 180 && total < 280, `NBA total ${total} out of range`);
  });

  await test('NBA ratings (alias)', '/api/nba/ratings', (json) => {
    assert(json.ratings || Array.isArray(json), 'Missing ratings');
  });

  // --- MLB Core ---
  console.log('\n--- MLB Core ---');
  await test('MLB ratings', '/api/model/mlb/ratings', (json) => {
    const ratings = json.ratings || json;
    assert(Array.isArray(ratings), 'Ratings should be an array');
    assert(ratings.length >= 25, `Expected >=25 teams, got ${ratings.length}`);
  });

  await test('MLB predict', '/api/model/mlb/predict?away=NYY&home=LAD', (json) => {
    assert(typeof json === 'object', 'Predict should return an object');
  });

  await test('MLB pitchers', '/api/model/mlb/pitchers', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Pitchers should return data');
  });

  await test('MLB opening day', '/api/model/mlb/opening-day', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Opening day should return data');
  }, { critical: false, timeoutMs: 15000 });

  // --- NHL Core ---
  console.log('\n--- NHL Core ---');
  await test('NHL ratings', '/api/model/nhl/ratings', (json) => {
    const ratings = json.ratings || json;
    assert(Array.isArray(ratings), 'Ratings should be an array');
    assert(ratings.length >= 25, `Expected >=25 teams, got ${ratings.length}`);
  });

  await test('NHL predict', '/api/model/nhl/predict?away=TOR&home=BOS', (json) => {
    assert(typeof json === 'object', 'Predict should return an object');
  });

  // --- Cross-sport (critical but fast) ---
  console.log('\n--- Cross-Sport ---');
  await test('Kelly optimizer', '/api/kelly', (json) => {
    assert('bankroll' in json, 'Missing bankroll');
    assert('picks' in json, 'Missing picks');
  });

  // --- Line movement (fast, no external) ---
  await test('Lines status', '/api/lines/status', (json) => {
    assert('gamesTracked' in json, 'Missing gamesTracked');
  });

  await test('Sharp signals', '/api/lines/sharp', (json) => {
    assert('signals' in json, 'Missing signals');
  });

  // === NON-CRITICAL: External-dependent endpoints ===
  // These call The Odds API, run backtests, etc. — may timeout in CI.
  console.log('\n--- External-Dependent (non-critical) ---');

  await test('Summary', '/api/summary', (json) => {
    assert('sports' in json, 'Missing sports');
  }, { critical: false, timeoutMs: 15000 });

  await test('Today games', '/api/today', (json) => {
    assert('games' in json, 'Missing games');
  }, { critical: false, timeoutMs: 15000 });

  await test('NBA backtest', '/api/backtest/nba', (json) => {
    assert(typeof json === 'object', 'Backtest should be an object');
  }, { critical: false, timeoutMs: 15000 });

  await test('NBA odds', '/api/odds/nba', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Should return data');
  }, { critical: false, timeoutMs: 10000 });

  await test('NBA value', '/api/value/nba', (json) => {
    assert('valueBets' in json || Array.isArray(json), 'Should have valueBets');
  }, { critical: false, timeoutMs: 10000 });

  await test('Data refresh', '/api/data/refresh', (json) => {
    assert(json.status === 'ok', 'Refresh should return ok');
  }, { critical: false, timeoutMs: 15000 });
}

// ─── Runner ───

async function main() {
  console.log('Starting server on port', PORT, '...');

  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  serverProcess.stdout.on('data', d => { serverOutput += d.toString(); });
  serverProcess.stderr.on('data', d => { serverOutput += d.toString(); });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0 && failed === 0 && passed === 0) {
      console.error(`Server exited with code ${code} before tests ran`);
      console.error('Server output:', serverOutput.slice(-500));
      process.exit(1);
    }
  });

  try {
    await waitForServer();
    console.log('Server is ready!\n');
  } catch (err) {
    console.error('❌ Server failed to start:', err.message);
    console.error('Server output:', serverOutput.slice(-1000));
    cleanup();
    process.exit(1);
  }

  await runAllTests();

  console.log('\n═══════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} non-critical skipped`);
  console.log('═══════════════════════════════════');

  if (failures.length > 0) {
    console.log('\nCritical failures:');
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
  }

  cleanup();
  // Only fail on critical failures
  process.exit(failed > 0 ? 1 : 0);
}

function cleanup() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }, 2000);
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  cleanup();
  process.exit(1);
});

main();
