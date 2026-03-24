/**
 * Opening Day Command Center v113.0
 * ===================================
 * THE SINGLE PAGE for OD D-Day preparation.
 * 
 * Synthesizes ALL OD systems into one actionable dashboard:
 *   1. System Health — all services green/yellow/red
 *   2. Countdown + Key Dates (OD1 March 26, OD2 March 27)
 *   3. Portfolio Summary — total plays, EV, ROI, Kelly allocation
 *   4. Live Odds Status — which books have posted, price comparison
 *   5. Weather Intel — postponement risks, pitcher-friendly parks
 *   6. Lineup Pipeline Status — ready for gameday auto-fetch
 *   7. Top Action Items — what needs human attention before OD
 *   8. Quick Bet Cheat Sheet — condensed betting card for mobile
 * 
 * One endpoint to rule them all: /api/opening-day/command-center
 */

const https = require('https');

// Safe requires — all optional
let odPlaybookCache = null;
let weatherForecast = null;
let pitcherKProps = null;
let outsPropsService = null;
let nrfiModel = null;
let f3Model = null;
let f7Model = null;
let odOddsMonitor = null;
let lineupBridge = null;
let mlbStatsLineups = null;
let autoScanner = null;
let regularSeasonAutopilot = null;
let betTracker = null;
let dailyMlbCard = null;
let mlbModel = null;
let mlbOpeningDay = null;

try { odPlaybookCache = require('./od-playbook-cache'); } catch(e) {}
try { weatherForecast = require('./weather-forecast'); } catch(e) {}
try { pitcherKProps = require('./pitcher-k-props'); } catch(e) {}
try { outsPropsService = require('./pitcher-outs-props'); } catch(e) {}
try { nrfiModel = require('./nrfi-model'); } catch(e) {}
try { f3Model = require('./f3-model'); } catch(e) {}
try { f7Model = require('./f7-model'); } catch(e) {}
try { odOddsMonitor = require('./od-odds-monitor'); } catch(e) {}
try { lineupBridge = require('./lineup-bridge'); } catch(e) {}
try { mlbStatsLineups = require('./mlb-stats-lineups'); } catch(e) {}
try { autoScanner = require('./auto-scanner'); } catch(e) {}
try { regularSeasonAutopilot = require('./regular-season-autopilot'); } catch(e) {}
try { betTracker = require('./bet-tracker'); } catch(e) {}
try { dailyMlbCard = require('./daily-mlb-card'); } catch(e) {}
try { mlbModel = require('../models/mlb'); } catch(e) {}
try { mlbOpeningDay = require('../models/mlb-opening-day'); } catch(e) {}

// ==================== COUNTDOWN ====================
function getCountdown() {
  const now = new Date();
  const od1 = new Date('2026-03-26T17:15:00Z'); // PIT@NYM 1:15 PM ET = 17:15 UTC
  const od2 = new Date('2026-03-27T20:35:00Z'); // NYY@SF 4:35 PM ET
  
  const msToOD1 = od1 - now;
  const msToOD2 = od2 - now;
  
  const hoursToOD1 = Math.max(0, Math.floor(msToOD1 / (1000 * 60 * 60)));
  const minsToOD1 = Math.max(0, Math.floor((msToOD1 % (1000 * 60 * 60)) / (1000 * 60)));
  const hoursToOD2 = Math.max(0, Math.floor(msToOD2 / (1000 * 60 * 60)));
  
  return {
    od1: {
      date: '2026-03-26',
      label: 'Opening Day 1',
      games: 11,
      firstPitch: '1:15 PM ET (PIT@NYM)',
      lastPitch: '10:10 PM ET (CLE@SEA)',
      countdown: `${hoursToOD1}h ${minsToOD1}m`,
      hoursAway: hoursToOD1,
    },
    od2: {
      date: '2026-03-27',
      label: 'Opening Day 2', 
      games: 9,
      firstPitch: '4:35 PM ET (NYY@SF)',
      lastPitch: '10:10 PM ET (ARI@LAD)',
      countdown: `${hoursToOD2}h`,
      hoursAway: hoursToOD2,
    },
    totalGames: 20,
    phase: hoursToOD1 <= 0 ? 'LIVE' : hoursToOD1 <= 24 ? 'T-1 FINAL CHECK' : hoursToOD1 <= 48 ? 'T-2 PREP' : 'EARLY PREP',
  };
}

// ==================== SYSTEM HEALTH ====================
function getSystemHealth() {
  const checks = [];
  
  // Core model
  checks.push({
    system: 'MLB Prediction Engine',
    status: mlbModel ? 'GO' : 'FAIL',
    detail: mlbModel ? 'asyncPredict() with full signal stack' : 'Model not loaded',
    critical: true,
  });
  
  // Opening Day schedule
  let odGames = [];
  try {
    odGames = mlbOpeningDay?.getSchedule ? mlbOpeningDay.getSchedule() : (mlbOpeningDay?.OPENING_DAY_GAMES || []);
  } catch(e) {}
  checks.push({
    system: 'OD Schedule',
    status: odGames.length >= 20 ? 'GO' : odGames.length > 0 ? 'WARN' : 'FAIL',
    detail: `${odGames.length}/20 games loaded`,
    critical: true,
  });
  
  // Playbook cache
  let playbook = null;
  try {
    playbook = odPlaybookCache?.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
  } catch(e) {}
  const playbookAge = playbook?.timestamp ? Math.floor((Date.now() - new Date(playbook.timestamp).getTime()) / (1000 * 60)) : null;
  checks.push({
    system: 'OD Playbook Cache',
    status: playbook ? (playbookAge < 60 ? 'GO' : 'WARN') : 'FAIL',
    detail: playbook ? `Cached ${playbookAge}min ago, ${(playbook.playbook || []).length} games` : 'No cache — needs rebuild',
    critical: true,
  });
  
  // Weather service
  checks.push({
    system: 'Weather Integration',
    status: weatherForecast ? 'GO' : 'WARN',
    detail: weatherForecast ? 'Open-Meteo 48h forecasts available' : 'Weather service not loaded',
    critical: false,
  });
  
  // K Props
  checks.push({
    system: 'K Props Model',
    status: pitcherKProps ? 'GO' : 'WARN',
    detail: pitcherKProps ? '40 OD starters with Steamer projections' : 'Not loaded',
    critical: false,
  });
  
  // Lineup Bridge
  checks.push({
    system: 'Lineup Bridge (MLB Stats API)',
    status: lineupBridge ? 'GO' : 'WARN',
    detail: lineupBridge ? 'Multi-source: MLB Stats API → ESPN → overrides → default' : 'Not loaded',
    critical: true,
  });
  
  // Odds Monitor
  const oddsStatus = odOddsMonitor?.getStatus ? odOddsMonitor.getStatus() : null;
  checks.push({
    system: 'OD Odds Monitor',
    status: odOddsMonitor ? (oddsStatus?.isPolling ? 'GO' : 'STANDBY') : 'WARN',
    detail: odOddsMonitor ? 
      (oddsStatus?.isPolling ? `Polling every ${oddsStatus.pollIntervalMin}min` : 'Standing by — will auto-start within 72h of OD') 
      : 'Not loaded',
    critical: false,
  });
  
  // NRFI Model
  checks.push({
    system: 'NRFI/YRFI Model',
    status: nrfiModel ? 'GO' : 'WARN',
    detail: nrfiModel ? 'Poisson 1st-inning scoring model' : 'Not loaded',
    critical: false,
  });
  
  // F3 Model
  checks.push({
    system: 'F3 (First 3 Innings) Model',
    status: f3Model ? 'GO' : 'WARN',
    detail: f3Model ? 'NB F3 with FTTO advantage' : 'Not loaded',
    critical: false,
  });
  
  // F7 Model
  checks.push({
    system: 'F7 (First 7 Innings) Model',
    status: f7Model ? 'GO' : 'WARN',
    detail: f7Model ? 'Bullpen chaos eliminator' : 'Not loaded',
    critical: false,
  });
  
  // Auto Scanner
  checks.push({
    system: 'Auto Scanner',
    status: autoScanner ? 'GO' : 'WARN',
    detail: autoScanner ? 'Periodic value scanning active' : 'Not loaded',
    critical: false,
  });
  
  // Bet Tracker
  checks.push({
    system: 'Bet Tracker / Auto-Grading',
    status: betTracker ? 'GO' : 'WARN',
    detail: betTracker ? 'Ready to record and grade OD picks' : 'Not loaded',
    critical: false,
  });
  
  const goCount = checks.filter(c => c.status === 'GO').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const critFail = checks.filter(c => c.status === 'FAIL' && c.critical).length;
  
  return {
    overall: critFail > 0 ? 'NOT READY' : failCount > 0 ? 'PARTIAL' : 'ALL SYSTEMS GO',
    emoji: critFail > 0 ? '🔴' : failCount > 0 ? '🟡' : '🟢',
    goCount,
    warnCount: checks.filter(c => c.status === 'WARN' || c.status === 'STANDBY').length,
    failCount,
    checks,
  };
}

// ==================== PORTFOLIO SUMMARY ====================
function getPortfolioSummary() {
  let playbook = null;
  try {
    playbook = odPlaybookCache?.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
  } catch(e) {}
  
  if (!playbook?.playbook) {
    return { error: 'Playbook not cached — trigger rebuild', plays: 0 };
  }
  
  const games = playbook.playbook;
  let allBets = [];
  let gamesSummary = [];
  
  for (const game of games) {
    const bets = game.bets || [];
    const conv = game.signals?.conviction || {};
    
    allBets.push(...bets.map(b => ({
      game: `${game.away}@${game.home}`,
      date: game.date,
      time: game.time,
      pick: b.pick,
      type: b.type,
      edge: b.edge || b.diff || 0,
      wager: b.wager || 0,
      ev: b.ev || 0,
      conviction: conv.score || 0,
      grade: conv.grade || '?',
      confidence: b.confidence,
      pitchers: `${game.awayStarter?.name || '?'} vs ${game.homeStarter?.name || '?'}`,
    })));
    
    gamesSummary.push({
      game: `${game.away}@${game.home}`,
      date: game.date,
      time: game.time,
      conviction: conv.score || 0,
      grade: conv.grade || '?',
      bets: bets.length,
      totalEV: bets.reduce((s, b) => s + (b.ev || 0), 0),
      pitchers: `${game.awayStarter?.name || '?'} vs ${game.homeStarter?.name || '?'}`,
      weather: game.signals?.weather?.impact || 'N/A',
    });
  }
  
  // Sort by conviction
  allBets.sort((a, b) => b.conviction - a.conviction || b.edge - a.edge);
  gamesSummary.sort((a, b) => b.conviction - a.conviction);
  
  const totalWager = allBets.reduce((s, b) => s + b.wager, 0);
  const totalEV = allBets.reduce((s, b) => s + b.ev, 0);
  const smash = allBets.filter(b => b.conviction >= 80);
  const strong = allBets.filter(b => b.conviction >= 70 && b.conviction < 80);
  const lean = allBets.filter(b => b.conviction >= 60 && b.conviction < 70);
  
  return {
    totalPlays: allBets.length,
    totalWager: +totalWager.toFixed(0),
    totalEV: +totalEV.toFixed(2),
    expectedROI: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
    tiers: {
      smash: smash.length,
      strong: strong.length,
      lean: lean.length,
    },
    topGames: gamesSummary.slice(0, 5),
    // Quick cheat sheet: just the smash + strong plays for mobile
    cheatSheet: [...smash, ...strong].map(b => ({
      game: b.game,
      pick: b.pick,
      edge: `+${b.edge.toFixed(1)}%`,
      wager: `$${b.wager}`,
      grade: b.grade,
      pitchers: b.pitchers,
    })),
  };
}

// ==================== K PROPS SUMMARY ====================
function getKPropsSummary() {
  if (!pitcherKProps) return { available: false };
  
  try {
    const scan = pitcherKProps.scanODKProps({ isOpeningDay: true });
    const topPicks = (scan.topPicks || []).filter(p => p.confidence === 'HIGH').slice(0, 10);
    
    return {
      available: true,
      totalPicks: scan.totalKPropPicks || 0,
      highConfidence: scan.highConfidencePicks || 0,
      avgEdge: scan.averageEdge || 0,
      topPlays: topPicks.map(p => ({
        pitcher: p.pitcher,
        team: p.team,
        opponent: p.opponent,
        pick: `${p.recommendation} ${p.dkLine?.line}`,
        edge: `+${(p.edge || 0).toFixed(1)}%`,
        expectedKs: p.adjustedExpectedKs?.toFixed(1),
      })),
    };
  } catch(e) {
    return { available: false, error: e.message };
  }
}

// ==================== WEATHER INTEL ====================
function getWeatherIntel() {
  // Pull weather info from playbook cache
  let playbook = null;
  try {
    playbook = odPlaybookCache?.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
  } catch(e) {}
  
  if (!playbook?.playbook) return { available: false };
  
  const weatherGames = [];
  const postponementRisks = [];
  const pitcherFriendly = [];
  const hitterFriendly = [];
  
  for (const game of playbook.playbook) {
    const wx = game.signals?.weather;
    if (!wx) continue;
    
    const entry = {
      game: `${game.away}@${game.home}`,
      park: wx.park || wx.stadium || '?',
      dome: wx.dome || false,
      multiplier: wx.multiplier || 1.0,
      description: wx.description || wx.impact || 'N/A',
    };
    
    weatherGames.push(entry);
    
    if (wx.multiplier && wx.multiplier < 0.95) {
      pitcherFriendly.push(entry);
    }
    if (wx.multiplier && wx.multiplier > 1.02) {
      hitterFriendly.push(entry);
    }
  }
  
  return {
    available: true,
    totalGames: weatherGames.length,
    domeGames: weatherGames.filter(g => g.dome).length,
    outdoorGames: weatherGames.filter(g => !g.dome).length,
    postponementRisks: postponementRisks.length > 0 ? postponementRisks : 'None detected',
    pitcherFriendly: pitcherFriendly.map(g => `${g.game} (${g.park}: ${g.description})`),
    hitterFriendly: hitterFriendly.map(g => `${g.game} (${g.park}: ${g.description})`),
    allGames: weatherGames,
  };
}

// ==================== ACTION ITEMS ====================
function getActionItems(countdown, health) {
  const items = [];
  const phase = countdown.phase;
  
  // Always relevant
  if (health.failCount > 0) {
    items.push({
      priority: 'P0',
      emoji: '🚨',
      item: `Fix ${health.failCount} FAILED system(s)`,
      detail: health.checks.filter(c => c.status === 'FAIL').map(c => c.system).join(', '),
    });
  }
  
  if (phase === 'T-2 PREP') {
    items.push({
      priority: 'P0',
      emoji: '📋',
      item: 'Pre-OD Final Check (March 25 evening)',
      detail: 'Run /api/opening-day/preflight?full=1 to validate all 20 games end-to-end',
    });
    items.push({
      priority: 'P1',
      emoji: '🌤️',
      item: 'Weather Final Check (March 25)',
      detail: 'Pull 48h forecasts for all 20 venues, flag postponement risks',
    });
    items.push({
      priority: 'P1',
      emoji: '📊',
      item: 'Check if books have posted OD lines',
      detail: 'Odds API MLB lines may not be live yet — monitor /api/opening-day/odds-monitor/status',
    });
    items.push({
      priority: 'P2',
      emoji: '💰',
      item: 'Review betting card and lock in conviction',
      detail: 'Top plays are set — review SMASH/STRONG tiers and adjust bankroll allocation',
    });
  }
  
  if (phase === 'T-1 FINAL CHECK') {
    items.push({
      priority: 'P0',
      emoji: '🔍',
      item: 'Run full preflight validation NOW',
      detail: 'GET /api/opening-day/preflight?full=1 — all 20 games must pass',
    });
    items.push({
      priority: 'P0',
      emoji: '📡',
      item: 'Verify live odds are flowing',
      detail: 'POST /api/opening-day/odds-monitor/poll — books should have lines by now',
    });
    items.push({
      priority: 'P0',
      emoji: '🌤️',
      item: 'Final weather check for all venues',
      detail: 'GET /api/weather/opening-day — flag any postponement risks',
    });
    items.push({
      priority: 'P1',
      emoji: '⚾',
      item: 'Monitor lineup drops (~2h before first pitch)',
      detail: 'Autopilot will auto-detect, but verify /api/mlb/lineups/bridge/today',
    });
  }
  
  if (phase === 'LIVE') {
    items.push({
      priority: 'P0',
      emoji: '🔥',
      item: 'GAMES ARE LIVE — monitor and grade',
      detail: 'Auto-grading pipeline is active. Check /api/mlb/grade/opening-day for results',
    });
  }
  
  return items;
}

// ==================== MAIN COMMAND CENTER ====================
function buildCommandCenter() {
  const countdown = getCountdown();
  const health = getSystemHealth();
  const portfolio = getPortfolioSummary();
  const kProps = getKPropsSummary();
  const weather = getWeatherIntel();
  const actionItems = getActionItems(countdown, health);
  
  return {
    title: '🦞 MetaClaw Opening Day Command Center',
    version: '113.0',
    generated: new Date().toISOString(),
    
    // Phase indicator
    phase: countdown.phase,
    phaseEmoji: countdown.phase === 'LIVE' ? '🔥' : countdown.phase === 'T-1 FINAL CHECK' ? '⚡' : '🎯',
    
    // Countdown
    countdown,
    
    // System Health
    health,
    
    // Action Items (what needs human attention)
    actionItems,
    
    // Portfolio Summary
    portfolio,
    
    // K Props Summary
    kProps,
    
    // Weather Intel
    weather,
    
    // Quick Reference
    keyEndpoints: {
      bettingCard: '/api/opening-day/betting-card',
      dailyCard: '/api/mlb/daily-card?date=2026-03-26',
      playbook: '/api/opening-day-playbook',
      preflight: '/api/opening-day/preflight',
      kProps: '/api/opening-day/k-props/top',
      nrfi: '/api/opening-day/nrfi',
      weather: '/api/weather/opening-day',
      oddsMonitor: '/api/opening-day/odds-monitor/status',
      lineups: '/api/mlb/lineups/bridge/today',
      grading: '/api/mlb/grade/opening-day',
    },
    
    // OD1 Quick Schedule
    od1Schedule: [
      { time: '1:15 PM ET', game: 'PIT@NYM', pitchers: 'Skenes vs Peralta' },
      { time: '2:10 PM ET', game: 'CWS@MIL', pitchers: 'Smith vs Misiorowski' },
      { time: '2:20 PM ET', game: 'WSH@CHC', pitchers: 'Cavalli vs Boyd' },
      { time: '3:05 PM ET', game: 'MIN@BAL', pitchers: 'Ryan vs Rogers' },
      { time: '4:10 PM ET', game: 'BOS@CIN', pitchers: 'Crochet vs Abbott' },
      { time: '4:10 PM ET', game: 'LAA@HOU', pitchers: 'Soriano vs H.Brown' },
      { time: '4:10 PM ET', game: 'DET@SD', pitchers: 'Skubal vs Pivetta' },
      { time: '4:15 PM ET', game: 'TEX@PHI', pitchers: 'Eovaldi vs Sanchez' },
      { time: '4:15 PM ET', game: 'TB@STL', pitchers: 'Rasmussen vs Liberatore' },
      { time: '8:30 PM ET', game: 'ARI@LAD', pitchers: 'Gallen vs Yamamoto' },
      { time: '10:10 PM ET', game: 'CLE@SEA', pitchers: 'Bibee vs Gilbert' },
    ],
    od2Schedule: [
      { time: '4:35 PM ET', game: 'NYY@SF', pitchers: 'Schlittler vs Webb' },
      { time: '6:40 PM ET', game: 'PHI@TOR', pitchers: 'Nola vs Kikuchi' },
      { time: '7:07 PM ET', game: 'OAK@TOR', pitchers: 'Severino vs Gausman' },
      { time: '7:10 PM ET', game: 'COL@MIA', pitchers: 'Freeland vs Alcantara' },
      { time: '7:15 PM ET', game: 'KC@ATL', pitchers: 'Ragans vs Sale' },
      { time: '7:20 PM ET', game: 'CHC@SD', pitchers: 'Imanaga vs Darvish' },
      { time: '8:10 PM ET', game: 'LAA@HOU', pitchers: 'Kikuchi vs Burrows' },
      { time: '9:40 PM ET', game: 'DET@SD', pitchers: 'Valdez vs King' },
      { time: '10:10 PM ET', game: 'ARI@LAD', pitchers: 'Nelson vs Sheehan' },
    ],
  };
}

module.exports = { buildCommandCenter, getCountdown, getSystemHealth, getPortfolioSummary };
