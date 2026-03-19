/**
 * SportsSim E2E Test Suite
 * 
 * Starts the server, hits every endpoint, validates responses.
 * Blocks deploy if ANY endpoint is broken.
 * 
 * Usage: node tests/e2e.test.js
 * Exit code 0 = all pass, 1 = failures
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 19876; // random high port to avoid conflicts
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 15000; // 15s max to wait for server startup

let serverProcess = null;
let passed = 0;
let failed = 0;
const failures = [];

// ─── Helpers ───

function fetch(urlPath, timeoutMs = 5000) {
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

async function test(name, urlPath, validate) {
  try {
    const res = await fetch(urlPath);
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
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertArray(val, msg) {
  assert(Array.isArray(val), msg || 'Expected an array');
}

function assertNumber(val, msg) {
  assert(typeof val === 'number' && !isNaN(val), msg || `Expected a number, got ${typeof val}`);
}

function assertBetween(val, min, max, msg) {
  assertNumber(val);
  assert(val >= min && val <= max, msg || `Expected ${val} between ${min} and ${max}`);
}

// ─── Test Definitions ───

async function runAllTests() {
  console.log('\n🏀⚾🏒 SportsSim E2E Tests\n');
  console.log('--- Health & System ---');

  await test('GET /api/health', '/api/health', (json) => {
    assert(json.status === 'ok' || json.status === 'healthy' || json.ok === true,
      `Unexpected health status: ${JSON.stringify(json)}`);
  });

  await test('GET /api/summary', '/api/summary', (json) => {
    // Should return an object (not crash with 500)
    assert(typeof json === 'object', 'Summary should be an object');
  });

  await test('GET /api/today', '/api/today', (json) => {
    assert('games' in json, 'Missing "games" field');
    assertArray(json.games, '"games" should be an array');
    assertNumber(json.count, '"count" should be a number');
  });

  // --- NBA ---
  console.log('\n--- NBA ---');

  await test('GET /api/model/nba/ratings', '/api/model/nba/ratings', (json) => {
    assertArray(json, 'Ratings should be an array');
    assert(json.length > 0, 'Ratings array should not be empty');
    const team = json[0];
    assert(team.team || team.name || team.abbrev, 'Team object missing identifier');
  });

  await test('GET /api/nba/ratings (alias)', '/api/nba/ratings', (json) => {
    assertArray(json, 'Ratings should be an array');
    assert(json.length > 0, 'Ratings alias should return data');
  });

  await test('GET /api/model/nba/predict?away=LAL&home=BOS', '/api/model/nba/predict?away=LAL&home=BOS', (json) => {
    assert(typeof json === 'object', 'Predict should return an object');
    // Check for win probability fields
    const hasProb = json.awayWinProb !== undefined || json.homeWinProb !== undefined ||
                    json.away_win_prob !== undefined || json.home_win_prob !== undefined ||
                    json.prediction !== undefined;
    assert(hasProb, 'Predict missing win probability fields');
  });

  await test('GET /api/nba/predict (alias)', '/api/nba/predict?away=LAL&home=BOS', (json) => {
    assert(typeof json === 'object', 'Predict alias should return an object');
  });

  await test('GET /api/backtest/nba', '/api/backtest/nba', (json) => {
    assert(typeof json === 'object', 'Backtest should return an object');
  });

  await test('GET /api/nba/backtest (alias)', '/api/nba/backtest', (json) => {
    assert(typeof json === 'object', 'Backtest alias should return an object');
  });

  await test('GET /api/odds/nba', '/api/odds/nba', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Odds should return object or array');
  });

  await test('GET /api/value/nba', '/api/value/nba', (json) => {
    assert('valueBets' in json || 'value_bets' in json || Array.isArray(json),
      'Value should have valueBets field or be array');
  });

  // --- MLB ---
  console.log('\n--- MLB ---');

  await test('GET /api/model/mlb/ratings', '/api/model/mlb/ratings', (json) => {
    assertArray(json, 'Ratings should be an array');
    assert(json.length > 0, 'Ratings array should not be empty');
  });

  await test('GET /api/mlb/ratings (alias)', '/api/mlb/ratings', (json) => {
    assertArray(json, 'Ratings should be an array');
  });

  await test('GET /api/model/mlb/predict?away=NYY&home=LAD', '/api/model/mlb/predict?away=NYY&home=LAD', (json) => {
    assert(typeof json === 'object', 'Predict should return an object');
  });

  await test('GET /api/mlb/predict (alias)', '/api/mlb/predict?away=NYY&home=LAD', (json) => {
    assert(typeof json === 'object', 'Predict alias should return an object');
  });

  await test('GET /api/backtest/mlb', '/api/backtest/mlb', (json) => {
    assert(typeof json === 'object', 'Backtest should return an object');
  });

  await test('GET /api/mlb/backtest (alias)', '/api/mlb/backtest', (json) => {
    assert(typeof json === 'object', 'Backtest alias should return an object');
  });

  await test('GET /api/model/mlb/pitchers', '/api/model/mlb/pitchers', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Pitchers should return data');
  });

  await test('GET /api/mlb/pitchers (alias)', '/api/mlb/pitchers', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Pitchers alias should return data');
  });

  await test('GET /api/model/mlb/pitchers/top', '/api/model/mlb/pitchers/top', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Top pitchers should return data');
  });

  await test('GET /api/model/mlb/matchup', '/api/model/mlb/matchup?away=NYY&home=LAD&awayPitcher=Cole&homePitcher=Yamamoto', (json) => {
    assert(typeof json === 'object', 'Matchup should return an object');
  });

  await test('GET /api/model/mlb/totals', '/api/model/mlb/totals?away=NYY&home=LAD', (json) => {
    assert(typeof json === 'object', 'Totals should return an object');
  });

  await test('GET /api/model/mlb/opening-day', '/api/model/mlb/opening-day', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Opening day should return data');
  });

  await test('GET /api/mlb/opening-day (alias)', '/api/mlb/opening-day', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Opening day alias should return data');
  });

  await test('GET /api/odds/mlb', '/api/odds/mlb', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Odds should return data');
  });

  await test('GET /api/value/mlb', '/api/value/mlb', (json) => {
    assert('valueBets' in json || 'value_bets' in json || Array.isArray(json),
      'Value should have valueBets field or be array');
  });

  // --- NHL ---
  console.log('\n--- NHL ---');

  await test('GET /api/model/nhl/ratings', '/api/model/nhl/ratings', (json) => {
    assertArray(json, 'Ratings should be an array');
    assert(json.length > 0, 'Ratings array should not be empty');
  });

  await test('GET /api/nhl/ratings (alias)', '/api/nhl/ratings', (json) => {
    assertArray(json, 'Ratings should be an array');
  });

  await test('GET /api/model/nhl/predict?away=TOR&home=BOS', '/api/model/nhl/predict?away=TOR&home=BOS', (json) => {
    assert(typeof json === 'object', 'Predict should return an object');
  });

  await test('GET /api/nhl/predict (alias)', '/api/nhl/predict?away=TOR&home=BOS', (json) => {
    assert(typeof json === 'object', 'Predict alias should return an object');
  });

  await test('GET /api/backtest/nhl', '/api/backtest/nhl', (json) => {
    assert(typeof json === 'object', 'Backtest should return an object');
  });

  await test('GET /api/nhl/backtest (alias)', '/api/nhl/backtest', (json) => {
    assert(typeof json === 'object', 'Backtest alias should return an object');
  });

  await test('GET /api/odds/nhl', '/api/odds/nhl', (json) => {
    assert(typeof json === 'object' || Array.isArray(json), 'Odds should return data');
  });

  await test('GET /api/value/nhl', '/api/value/nhl', (json) => {
    assert('valueBets' in json || 'value_bets' in json || Array.isArray(json),
      'Value should have valueBets field or be array');
  });

  // --- Cross-Sport ---
  console.log('\n--- Cross-Sport ---');

  await test('GET /api/value/all', '/api/value/all', (json) => {
    assert('valueBets' in json || 'value_bets' in json || Array.isArray(json),
      'All value should have valueBets field or be array');
  });

  await test('GET /api/kelly', '/api/kelly', (json) => {
    assert(typeof json === 'object', 'Kelly should return an object');
  });

  await test('GET /api/data/status', '/api/data/status', (json) => {
    assert(typeof json === 'object', 'Data status should return an object');
  });
}

// ─── Runner ───

async function main() {
  console.log('Starting server on port', PORT, '...');

  serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture server output for debugging
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

  // --- Results ---
  console.log('\n═══════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════');

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
  }

  cleanup();
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
