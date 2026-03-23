#!/usr/bin/env node
/**
 * Opening Day Pre-Flight v68.0 — Comprehensive Validation
 * 
 * Tests ALL prediction pathways and signal services for March 26-27 Opening Day.
 * Run this to catch silent failures before Opening Day.
 * 
 * Usage: node test-od-preflight-v68.js
 */

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[36m', W = '\x1b[0m';
const PASS = `${G}✅ PASS${W}`, FAIL = `${R}❌ FAIL${W}`, WARN = `${Y}⚠️  WARN${W}`;

let totalPassed = 0, totalFailed = 0, totalWarned = 0;

function check(name, condition, detail = '') {
  if (condition === true) {
    console.log(`  ${PASS} ${name}${detail ? ' — ' + detail : ''}`);
    totalPassed++;
  } else if (condition === 'warn') {
    console.log(`  ${WARN} ${name}${detail ? ' — ' + detail : ''}`);
    totalWarned++;
  } else {
    console.log(`  ${FAIL} ${name}${detail ? ' — ' + detail : ''}`);
    totalFailed++;
  }
}

async function main() {
  console.log(`\n${B}═══════════════════════════════════════════════════════${W}`);
  console.log(`${B}  🦞 OPENING DAY PRE-FLIGHT v68.0${W}`);
  console.log(`${B}  Comprehensive Pipeline Validation for March 26-27${W}`);
  console.log(`${B}═══════════════════════════════════════════════════════${W}\n`);

  // ===== CHECK 1: Core Imports =====
  console.log(`${B}── CHECK 1: Core Module Imports ──${W}`);
  let mlb, mlbOD, pitchers;
  try { mlb = require('./models/mlb'); check('models/mlb', true); } catch(e) { check('models/mlb', false, e.message); }
  try { mlbOD = require('./models/mlb-opening-day'); check('models/mlb-opening-day', true); } catch(e) { check('models/mlb-opening-day', false, e.message); }
  try { pitchers = require('./models/mlb-pitchers'); check('models/mlb-pitchers', true); } catch(e) { check('models/mlb-pitchers', false, e.message); }

  // ===== CHECK 2: Service Imports =====
  console.log(`\n${B}── CHECK 2: Service Availability ──${W}`);
  const services = {};
  const serviceNames = [
    'weather', 'weather-forecast', 'rolling-stats', 'injuries', 'lineup-fetcher',
    'preseason-tuning', 'opening-week-unders', 'statcast', 'bullpen-quality',
    'platoon-splits', 'catcher-framing', 'stolen-base-model', 'auto-scanner',
    'od-playbook-cache', 'opening-day-live', 'calibration', 'alt-lines',
    'umpire-tendencies', 'rest-travel', 'daily-picks'
  ];
  for (const name of serviceNames) {
    try { 
      services[name] = require(`./services/${name}`);
      check(name, true);
    } catch(e) { 
      check(name, false, e.message.split('\n')[0]);
    }
  }

  // ===== CHECK 3: Pitcher Database Coverage =====
  console.log(`\n${B}── CHECK 3: Pitcher Database — All 40 OD Starters ──${W}`);
  if (mlbOD && pitchers) {
    const games = mlbOD.OPENING_DAY_GAMES;
    let found = 0, missing = [];
    for (const g of games) {
      for (const side of ['away', 'home']) {
        const name = g.confirmedStarters[side];
        if (!name) { missing.push(`NULL ${side} for ${g.away}@${g.home}`); continue; }
        const p = pitchers.getPitcherByName(name);
        if (p) found++;
        else missing.push(`${name} (${g[side]})`);
      }
    }
    check(`${found}/40 starters in DB`, found === 40, missing.length ? `Missing: ${missing.join(', ')}` : 'All confirmed');
  }

  // ===== CHECK 4: Statcast Data Consistency =====
  console.log(`\n${B}── CHECK 4: Statcast-Pitcher ERA Consistency ──${W}`);
  if (mlbOD && pitchers && services.statcast) {
    const games = mlbOD.OPENING_DAY_GAMES;
    let matches = 0, mismatches = 0, noData = 0;
    const mismatchList = [];
    for (const g of games) {
      for (const side of ['away', 'home']) {
        const name = g.confirmedStarters[side];
        if (!name) continue;
        const p = pitchers.getPitcherByName(name);
        const sc = services.statcast.getStatcastPitcherAdjustment(name);
        if (p && sc) {
          const gap = Math.abs(p.era - sc.era);
          if (gap > 0.75) {
            mismatches++;
            mismatchList.push(`${name}: DB=${p.era} SC=${sc.era} gap=${gap.toFixed(2)}`);
          } else matches++;
        } else noData++;
      }
    }
    check(`ERA consistency (${matches} match, ${mismatches} mismatch, ${noData} no data)`, 
      mismatches <= 12 ? (mismatches === 0 ? true : 'warn') : false,
      mismatchList.length ? `Mismatches (mitigated in predict v68): ${mismatchList.join('; ')}` : '');
  }

  // ===== CHECK 5: Sync predict() for all 20 games =====
  console.log(`\n${B}── CHECK 5: Sync predict() — All 20 OD Games ──${W}`);
  if (mlb && mlbOD) {
    const games = mlbOD.OPENING_DAY_GAMES;
    let passed = 0, errors = [];
    for (const g of games) {
      try {
        const r = mlb.predict(g.away, g.home, {
          awayPitcher: g.confirmedStarters.away,
          homePitcher: g.confirmedStarters.home,
          gameDate: g.date
        });
        if (r.homeWinProb >= 0.33 && r.homeWinProb <= 0.67 && r.totalRuns >= 5 && r.totalRuns <= 14) {
          passed++;
        } else {
          errors.push(`${g.away}@${g.home}: WP=${r.homeWinProb} Total=${r.totalRuns} (out of bounds)`);
        }
      } catch(e) {
        errors.push(`${g.away}@${g.home}: ${e.message}`);
      }
    }
    check(`${passed}/20 games passed`, passed === 20, errors.length ? errors.join('; ') : '');
  }

  // ===== CHECK 6: asyncPredict() with full signal stack =====
  console.log(`\n${B}── CHECK 6: asyncPredict() — Full Signal Stack ──${W}`);
  if (mlb && mlbOD) {
    const games = mlbOD.OPENING_DAY_GAMES;
    // Test 3 representative games
    const testGames = [games[0], games[4], games[10]]; // PIT@NYM, BOS@CIN, CLE@SEA
    for (const g of testGames) {
      try {
        const r = await mlb.asyncPredict(g.away, g.home, {
          awayPitcher: g.confirmedStarters.away,
          homePitcher: g.confirmedStarters.home,
          gameDate: g.date
        });
        const signals = r._asyncSignals || {};
        check(`${g.away}@${g.home} asyncPredict`, true, 
          `WP=${(r.homeWinProb*100).toFixed(1)}% Total=${r.totalRuns?.toFixed(1)} REST=${signals.restTravel} WX=${signals.weather} UMP=${signals.umpire}`);
      } catch(e) {
        check(`${g.away}@${g.home} asyncPredict`, false, e.message);
      }
    }
  }

  // ===== CHECK 7: Bullpen Quality Projections =====
  console.log(`\n${B}── CHECK 7: Bullpen Quality Projections ──${W}`);
  if (services['bullpen-quality']) {
    const bp = services['bullpen-quality'];
    const allTeams = ['ARI','ATL','BAL','BOS','CHC','CIN','CLE','COL','CWS','DET',
                      'HOU','KC','LAA','LAD','MIA','MIL','MIN','NYM','NYY','OAK',
                      'PHI','PIT','SD','SEA','SF','STL','TB','TEX','TOR','WSH'];
    let covered = 0;
    for (const t of allTeams) {
      const proj = bp.getProjectedBullpenEra(t);
      if (proj && proj.era > 0) covered++;
    }
    check(`Bullpen projections: ${covered}/30 teams`, covered === 30);
  }

  // ===== CHECK 8: Platoon Splits Service =====
  console.log(`\n${B}── CHECK 8: Platoon Splits (Savant wOBA) ──${W}`);
  if (services['platoon-splits']) {
    const ps = services['platoon-splits'];
    if (ps.calculatePlatoonMultiplier) {
      const test = ps.calculatePlatoonMultiplier('LAD', 'L', null);
      check('LAD vs LHP platoon', test && test.multiplier < 1.0, 
        `multiplier=${test?.multiplier?.toFixed(3)} (${test?.note})`);
    }
  }

  // ===== CHECK 9: Catcher Framing =====
  console.log(`\n${B}── CHECK 9: Catcher Framing (Savant) ──${W}`);
  if (services['lineup-fetcher'] && services['lineup-fetcher'].getCatcherFramingAdjustment) {
    const cf = services['lineup-fetcher'].getCatcherFramingAdjustment('LAD', 'ARI');
    check('Catcher framing LAD@ARI', !!cf, cf ? `homeRA=${cf.homeRAAdj?.toFixed(3)} awayRA=${cf.awayRAAdj?.toFixed(3)}` : 'No data');
  }

  // ===== CHECK 10: Weather Forecast =====
  console.log(`\n${B}── CHECK 10: Weather Forecast Service ──${W}`);
  if (services['weather-forecast'] && services['weather-forecast'].getODForecast) {
    try {
      const wx = await services['weather-forecast'].getODForecast();
      const outdoorGames = wx ? Object.keys(wx).length : 0;
      check(`Weather forecasts: ${outdoorGames} parks`, outdoorGames >= 10, 
        outdoorGames >= 10 ? 'Good coverage for outdoor parks' : 'Missing forecasts');
    } catch(e) {
      check('Weather forecast', 'warn', e.message);
    }
  }

  // ===== CHECK 11: Opening Week Unders =====
  console.log(`\n${B}── CHECK 11: Opening Week Unders Adjustment ──${W}`);
  if (services['opening-week-unders']) {
    const owu = services['opening-week-unders'];
    const test = owu.getOpeningWeekAdjustment('2026-03-26', 'Wrigley Field', { homeStarterTier: 1, awayStarterTier: 2 });
    check('OW Unders for Wrigley 3/26', test && test.active, 
      test ? `reduction=${(test.reduction*100).toFixed(1)}% factors=${test.factors?.join(',')}` : 'Inactive');
  }

  // ===== CHECK 12: Stolen Base Model =====
  console.log(`\n${B}── CHECK 12: Stolen Base Model ──${W}`);
  if (services['stolen-base-model']) {
    const sb = services['stolen-base-model'];
    if (sb.getSBTotalsAdjustment) {
      const test = sb.getSBTotalsAdjustment('KC', 'ATL');
      check('SB model KC@ATL', !!test, test ? `netAdj=${test.netAdjustment?.toFixed(3)} awayTier=${test.awayTier} homeTier=${test.homeTier}` : 'No data');
    }
  }

  // ===== CHECK 13: NB F5 Model =====
  console.log(`\n${B}── CHECK 13: Negative Binomial F5 Model ──${W}`);
  if (mlb && mlbOD) {
    const g = mlbOD.OPENING_DAY_GAMES[0]; // PIT@NYM
    const r = mlb.predict(g.away, g.home, {
      awayPitcher: g.confirmedStarters.away,
      homePitcher: g.confirmedStarters.home,
      gameDate: g.date
    });
    check('F5 total exists', r.f5 && r.f5.total > 0, `F5 total=${r.f5?.total?.toFixed(1)}`);
    check('F5 three-way ML', r.f5 && r.f5.homeWinProb !== undefined, 
      `Home=${(r.f5?.homeWinProb*100)?.toFixed(1)}% Draw=${(r.f5?.drawProb*100)?.toFixed(1)}%`);
  }

  // ===== CHECK 14: Conviction Engine =====
  console.log(`\n${B}── CHECK 14: Conviction Engine ──${W}`);
  if (mlb && mlbOD) {
    const g = mlbOD.OPENING_DAY_GAMES[0];
    const r = mlb.predict(g.away, g.home, {
      awayPitcher: g.confirmedStarters.away,
      homePitcher: g.confirmedStarters.home,
      gameDate: g.date
    });
    check('Conviction score', r.conviction && r.conviction.score >= 0, 
      `Score=${r.conviction?.score} Grade=${r.conviction?.grade}`);
  }

  // ===== CHECK 15: Model vs Market Sanity =====
  console.log(`\n${B}── CHECK 15: Model vs Market Sanity (DK Lines) ──${W}`);
  if (mlb && mlbOD) {
    const games = mlbOD.OPENING_DAY_GAMES.filter(g => g.dkLine);
    let reasonable = 0, suspicious = [];
    for (const g of games) {
      const r = mlb.predict(g.away, g.home, {
        awayPitcher: g.confirmedStarters.away,
        homePitcher: g.confirmedStarters.home,
        gameDate: g.date
      });
      const dkImplied = g.dkLine.homeML < 0 
        ? -g.dkLine.homeML / (-g.dkLine.homeML + 100) 
        : 100 / (g.dkLine.homeML + 100);
      const edge = Math.abs(r.homeWinProb - dkImplied) * 100;
      if (edge < 15) {
        reasonable++;
      } else {
        suspicious.push(`${g.away}@${g.home}: model=${(r.homeWinProb*100).toFixed(0)}% DK=${(dkImplied*100).toFixed(0)}% gap=${edge.toFixed(0)}%`);
      }
    }
    check(`${reasonable}/${games.length} games within 15% of DK`, 
      reasonable >= games.length * 0.7 ? (reasonable === games.length ? true : 'warn') : false,
      suspicious.length ? `Suspicious: ${suspicious.join('; ')}` : '');
  }

  // ===== CHECK 16: Data Freshness =====
  console.log(`\n${B}── CHECK 16: Data Freshness ──${W}`);
  try {
    const fs = require('fs');
    const path = require('path');
    const cachePath = path.join(__dirname, 'services', 'data-cache.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const now = Date.now();
      for (const sport of ['nba', 'nhl', 'mlb']) {
        const key = `${sport}_standings`;
        if (cache[key]) {
          const age = Math.round((now - cache[key].timestamp) / 60000);
          check(`${sport.toUpperCase()} data`, age < 180 ? true : 'warn', `${age} minutes old`);
        }
      }
    }
  } catch(e) {
    check('Data cache', false, e.message);
  }

  // ===== CHECK 17: Server Syntax Check =====
  console.log(`\n${B}── CHECK 17: Server Module Syntax ──${W}`);
  try {
    require('./server');
    check('server.js loads', true);
  } catch(e) {
    check('server.js loads', false, e.message.split('\n')[0]);
  }

  // ===== SUMMARY =====
  console.log(`\n${B}═══════════════════════════════════════════════════════${W}`);
  console.log(`${B}  RESULTS: ${G}${totalPassed} PASS${W} | ${Y}${totalWarned} WARN${W} | ${R}${totalFailed} FAIL${W}`);
  const overall = totalFailed === 0 ? (totalWarned === 0 ? `${G}ALL CLEAR 🟢${W}` : `${Y}MOSTLY CLEAR 🟡${W}`) : `${R}ISSUES FOUND 🔴${W}`;
  console.log(`${B}  STATUS: ${overall}`);
  console.log(`${B}═══════════════════════════════════════════════════════${W}\n`);
  
  if (totalFailed > 0) process.exit(1);
}

main().catch(e => {
  console.error(`${R}FATAL:${W}`, e);
  process.exit(1);
});
