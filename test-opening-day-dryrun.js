#!/usr/bin/env node
/**
 * Opening Day Dry Run Test — SportsSim v58.0
 * 
 * Validates the FULL prediction pipeline end-to-end for all 20 Opening Day games.
 * Tests: asyncPredict (weather + rest + lineup + umpire + OW unders),
 *        pitcher resolution, value detection, and signal stack completeness.
 * 
 * Run: node test-opening-day-dryrun.js
 */

const mlb = require('./models/mlb');
const { OPENING_DAY_GAMES } = require('./models/mlb-opening-day');
const pitchers = require('./models/mlb-pitchers');

// ANSI colors
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[36m', W = '\x1b[0m';
const PASS = `${G}✅ PASS${W}`, FAIL = `${R}❌ FAIL${W}`, WARN = `${Y}⚠️  WARN${W}`;

async function runDryRun() {
  console.log(`\n${B}═══════════════════════════════════════════════════════${W}`);
  console.log(`${B}  🦞 OPENING DAY DRY RUN — SportsSim v58.0${W}`);
  console.log(`${B}  Testing ALL ${OPENING_DAY_GAMES.length} games with full signal stack${W}`);
  console.log(`${B}═══════════════════════════════════════════════════════${W}\n`);

  let totalPassed = 0, totalWarned = 0, totalFailed = 0;
  const results = [];
  const pitcherCoverage = { found: 0, missing: [] };
  const weatherCoverage = { active: 0, dome: 0, missing: 0 };
  const signalReport = { rest: 0, lineup: 0, weather: 0, umpire: 0, openingWeek: 0 };

  // Check 1: Pitcher Database Coverage
  console.log(`${B}── CHECK 1: Pitcher Database Coverage ──${W}`);
  for (const game of OPENING_DAY_GAMES) {
    for (const side of ['away', 'home']) {
      const name = game.confirmedStarters[side];
      if (!name) continue;
      const p = pitchers.getPitcherByName(name);
      if (p) {
        pitcherCoverage.found++;
      } else {
        pitcherCoverage.missing.push({ name, team: game[side], game: `${game.away}@${game.home}` });
      }
    }
  }
  
  if (pitcherCoverage.missing.length === 0) {
    console.log(`  ${PASS} All ${pitcherCoverage.found} confirmed starters found in pitcher DB`);
    totalPassed++;
  } else {
    console.log(`  ${FAIL} ${pitcherCoverage.missing.length} starters MISSING from pitcher DB:`);
    for (const m of pitcherCoverage.missing) {
      console.log(`    ${R}• ${m.name} (${m.team}) — ${m.game}${W}`);
    }
    totalFailed++;
  }

  // Check 2: Full asyncPredict for each game
  console.log(`\n${B}── CHECK 2: asyncPredict Full Signal Stack ──${W}`);
  
  for (const game of OPENING_DAY_GAMES) {
    const tag = `${game.away}@${game.home} (Day ${game.day})`;
    
    try {
      const opts = {
        gameDate: game.date,
        awayPitcher: game.confirmedStarters.away,
        homePitcher: game.confirmedStarters.home,
      };
      
      const pred = await mlb.asyncPredict(game.away, game.home, opts);
      
      if (pred.error) {
        console.log(`  ${FAIL} ${tag}: ${pred.error}`);
        totalFailed++;
        results.push({ game: tag, status: 'FAIL', error: pred.error });
        continue;
      }
      
      // Validate prediction sanity
      const issues = [];
      
      // Win prob should be 32-68% for early season
      if (pred.homeWinProb < 0.32 || pred.homeWinProb > 0.68) {
        issues.push(`homeWinProb=${pred.homeWinProb} out of 32-68% range`);
      }
      
      // Total runs should be 5-13 for MLB
      if (pred.totalRuns < 5 || pred.totalRuns > 13) {
        issues.push(`totalRuns=${pred.totalRuns} out of 5-13 range`);
      }
      
      // Expected runs per team should be 2-8
      if (pred.awayExpRuns < 2 || pred.awayExpRuns > 8) {
        issues.push(`awayExpRuns=${pred.awayExpRuns} out of 2-8 range`);
      }
      if (pred.homeExpRuns < 2 || pred.homeExpRuns > 8) {
        issues.push(`homeExpRuns=${pred.homeExpRuns} out of 2-8 range`);
      }
      
      // Check signal coverage
      const signals = pred._asyncSignals || {};
      if (signals.restTravel) signalReport.rest++;
      if (signals.lineup) signalReport.lineup++;
      if (signals.weather) signalReport.weather++;
      if (signals.umpire) signalReport.umpire++;
      if (pred.openingWeek && pred.openingWeek.active) signalReport.openingWeek++;
      
      // Weather tracking
      if (signals.weatherDetail) {
        if (signals.weatherDetail.dome) {
          weatherCoverage.dome++;
        } else if (signals.weather) {
          weatherCoverage.active++;
        } else {
          weatherCoverage.missing++;
        }
      }
      
      // Pitcher resolution check
      const awayP = pred.awayPitcher;
      const homeP = pred.homePitcher;
      const pitcherNote = [];
      if (game.confirmedStarters.away && !awayP) pitcherNote.push(`${game.away} starter not resolved`);
      if (game.confirmedStarters.home && !homeP) pitcherNote.push(`${game.home} starter not resolved`);
      
      if (issues.length > 0) {
        console.log(`  ${FAIL} ${tag}: ${issues.join('; ')}`);
        totalFailed++;
        results.push({ game: tag, status: 'FAIL', issues });
      } else if (pitcherNote.length > 0) {
        console.log(`  ${WARN} ${tag}: ` +
          `${pred.awayWinProb}/${pred.homeWinProb} total=${pred.totalRuns} ` +
          `[${pitcherNote.join(', ')}]`);
        totalWarned++;
        results.push({ game: tag, status: 'WARN', pitcherNote });
      } else {
        const weatherTag = signals.weather ? ` wx=${signals.weatherDetail?.multiplier?.toFixed(3) || '?'}` : 
                          (signals.weatherDetail?.dome ? ' 🏠dome' : '');
        const owTag = pred.openingWeek?.active ? ` OW-${pred.openingWeek.reduction}%` : '';
        console.log(`  ${PASS} ${tag}: ` +
          `${awayP?.name || '?'}(${awayP?.rating || '?'}) vs ${homeP?.name || '?'}(${homeP?.rating || '?'}) → ` +
          `${pred.awayWinProb}/${pred.homeWinProb} total=${pred.totalRuns}${weatherTag}${owTag}`);
        totalPassed++;
        results.push({
          game: tag, status: 'PASS',
          away: game.away, home: game.home,
          awayPitcher: awayP?.name, homePitcher: homeP?.name,
          awayProb: pred.awayWinProb, homeProb: pred.homeWinProb,
          total: pred.totalRuns,
          awayML: pred.awayML, homeML: pred.homeML,
          weather: signals.weatherDetail,
          openingWeek: pred.openingWeek,
        });
      }
      
      // Value detection check against DK lines
      if (game.dkLine) {
        const edges = mlb.findValue(pred, {
          homeML: game.dkLine.homeML,
          awayML: game.dkLine.awayML,
          total: game.dkLine.total || null,
        });
        if (edges.length > 0) {
          for (const edge of edges) {
            console.log(`    💰 ${edge.pick}: edge=${(edge.edge * 100).toFixed(1)}% EV=${edge.ev || '?'}`);
          }
        }
      }
      
    } catch (e) {
      console.log(`  ${FAIL} ${tag}: EXCEPTION — ${e.message}`);
      totalFailed++;
      results.push({ game: tag, status: 'FAIL', error: e.message });
    }
  }

  // Summary
  console.log(`\n${B}── SIGNAL COVERAGE SUMMARY ──${W}`);
  console.log(`  Rest/Travel: ${signalReport.rest}/${OPENING_DAY_GAMES.length} games`);
  console.log(`  Lineups:     ${signalReport.lineup}/${OPENING_DAY_GAMES.length} games (expected 0 pre-Opening Day)`);
  console.log(`  Weather:     ${signalReport.weather}/${OPENING_DAY_GAMES.length} games (${weatherCoverage.dome} dome, ${weatherCoverage.active} outdoor active)`);
  console.log(`  Umpire:      ${signalReport.umpire}/${OPENING_DAY_GAMES.length} games (expected 0 until day-of)`);
  console.log(`  OW Unders:   ${signalReport.openingWeek}/${OPENING_DAY_GAMES.length} games`);

  console.log(`\n${B}── WEATHER DETAIL ──${W}`);
  const outdoorGames = results.filter(r => r.weather && !r.weather.dome);
  const domeGames = results.filter(r => r.weather?.dome);
  if (outdoorGames.length > 0) {
    console.log(`  Outdoor parks with weather data:`);
    for (const g of outdoorGames) {
      if (g.weather) {
        const impact = ((g.weather.multiplier - 1) * 100).toFixed(1);
        console.log(`    ${g.game}: ${g.weather.park} — ${g.weather.multiplier.toFixed(3)}x (${impact > 0 ? '+' : ''}${impact}%): ${g.weather.description}`);
      }
    }
  }
  if (domeGames.length > 0) {
    console.log(`  Dome/retractable roof: ${domeGames.map(g => `${g.game}`).join(', ')}`);
  }

  // Final tally
  console.log(`\n${B}═══════════════════════════════════════════════════════${W}`);
  console.log(`  ${G}PASSED: ${totalPassed}${W}  ${Y}WARNED: ${totalWarned}${W}  ${R}FAILED: ${totalFailed}${W}`);
  console.log(`  Total games tested: ${OPENING_DAY_GAMES.length}`);
  
  // Value bets summary
  const valueBets = [];
  for (const game of OPENING_DAY_GAMES) {
    if (!game.dkLine) continue;
    try {
      const opts = {
        gameDate: game.date,
        awayPitcher: game.confirmedStarters.away,
        homePitcher: game.confirmedStarters.home,
      };
      const pred = await mlb.asyncPredict(game.away, game.home, opts);
      const edges = mlb.findValue(pred, {
        homeML: game.dkLine.homeML,
        awayML: game.dkLine.awayML,
        total: game.dkLine.total || null,
      });
      for (const edge of edges) {
        valueBets.push({ ...edge, game: `${game.away}@${game.home}`, day: game.day });
      }
    } catch (e) {}
  }
  
  if (valueBets.length > 0) {
    console.log(`\n${B}── 💰 OPENING DAY VALUE BETS (vs DK lines) ──${W}`);
    valueBets.sort((a, b) => b.edge - a.edge);
    for (const bet of valueBets.slice(0, 10)) {
      console.log(`  ${bet.game} Day${bet.day}: ${bet.pick} — edge=${(bet.edge * 100).toFixed(1)}% ML=${bet.ml} EV=${bet.ev || '?'}`);
    }
  }
  
  console.log(`${B}═══════════════════════════════════════════════════════${W}\n`);
  
  if (totalFailed > 0) {
    console.log(`${R}🚨 ${totalFailed} FAILURES — FIX BEFORE OPENING DAY${W}`);
    process.exit(1);
  } else if (totalWarned > 0) {
    console.log(`${Y}⚠️  ${totalWarned} warnings — review before Opening Day${W}`);
  } else {
    console.log(`${G}🦞 ALL SYSTEMS GO FOR OPENING DAY 🔥${W}`);
  }
}

runDryRun().catch(e => {
  console.error(`${R}FATAL ERROR:${W}`, e);
  process.exit(1);
});
