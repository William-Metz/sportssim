/**
 * OD Season Opener Analysis — NYY@SF March 25, 2026 8:05 PM ET
 * =================================================================
 * 
 * THE FIRST GAME OF THE 2026 MLB SEASON. Max Fried vs Logan Webb at Oracle Park.
 * 🚨 CRITICAL UPDATE v126: MLB Stats API confirms Max Fried (LHP) is NYY OD starter, NOT Gerrit Cole.
 * Fried was signed from ATL in the offseason. This changes platoon splits (LHP vs SF's RHH-heavy lineup).
 * 
 * This service generates a comprehensive betting analysis for the opener:
 * - Full game model prediction (asyncPredict with all signals)
 * - ML, Total, F5, F3, F7, NRFI analysis
 * - Fried K props + Webb K props  
 * - Outs props for both pitchers
 * - Catcher framing impact (Bailey #1 framer helps Webb massively)
 * - Oracle Park weather (March = cold, wind off bay)
 * - Live odds comparison (The Odds API)
 * - Full betting card with conviction scores
 * 
 * ENDPOINTS:
 *   GET /api/od/opener               — Full opener analysis
 *   GET /api/od/opener/quick          — Quick cached summary
 *   GET /api/od/opener/k-props        — K prop analysis for Fried + Webb
 *   GET /api/od/opener/betting-card   — Actionable betting card
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Safe imports
let mlbModel, weatherService, f3Model, f7Model, nrfiModel, catcherFraming;
let pitcherKProps, outsProps, bullpenQuality, platoonSplits, convictionEngine;
let stolenBaseModel, negBinomial;

try { mlbModel = require('../models/mlb'); } catch(e) { console.error('[opener] MLB model not loaded:', e.message); }
try { weatherService = require('./weather'); } catch(e) {}
try { f3Model = require('./f3-model'); } catch(e) {}
try { f7Model = require('./f7-model'); } catch(e) {}
try { nrfiModel = require('./nrfi-model'); } catch(e) {}
try { catcherFraming = require('./catcher-framing'); } catch(e) {}
try { platoonSplits = require('./platoon-splits'); } catch(e) {}
try { bullpenQuality = require('./bullpen-quality'); } catch(e) {}
try { stolenBaseModel = require('./stolen-base-model'); } catch(e) {}
try { negBinomial = require('../models/neg-binomial'); } catch(e) {}

// ==================== GAME INFO ====================
const OPENER = {
  away: 'NYY',
  home: 'SF',
  date: '2026-03-25',
  time: '2026-03-25T00:05:00Z', // 8:05 PM ET = 00:05 UTC March 26 (next day)
  timeET: '8:05 PM ET',
  venue: 'Oracle Park',
  outdoor: true,
  broadcast: 'ESPN',
  starters: {
    away: { name: 'Max Fried', hand: 'L', era: 3.18, fip: 3.05, k9: 8.8, bb9: 2.0, whip: 1.08, ip: 185, tier: 1 },
    home: { name: 'Logan Webb', hand: 'R', era: 3.25, fip: 3.12, k9: 8.5, bb9: 1.8, whip: 1.08, ip: 200, tier: 1 },
  },
  dkLine: { homeML: 100, awayML: -120, total: 7.0 },
  notes: [
    'First game of 2026 MLB season',
    'Oracle Park: pitcher-friendly (0.93 park factor), cold March weather, wind off SF Bay',
    'Max Fried (LHP) is the NYY OD starter per MLB Stats API — NOT Gerrit Cole',
    'Fried signed from ATL in offseason — new team penalty applies (4% performance adj)',
    'Webb is SF workhorse — 200 IP last year, elite command, ground ball machine',
    'Fried (LHP) vs SF: SF lineup has Adames, Chapman, Winn, Lee — mostly RHH = slight platoon edge for hitters',
    'OD opener premium: starters go 5.8 IP vs 5.5 regular season',
    'Rusty bats + cold Oracle Park = UNDER lean, but Fried new-team jitters could push OVER',
  ]
};

// ==================== FRIED + WEBB K/OUTS PROJECTIONS ====================
const OPENER_K_PROJECTIONS = {
  'Max Fried': {
    k9: 8.8, xK9: 8.95, projectedIP: 6.0, hand: 'L', team: 'NYY', tier: 1,
    note: 'NYY OD starter (signed from ATL). LHP, 2025: 185 IP, 3.18 ERA, 8.8 K/9. Elite ground ball pitcher. New-team opener jitters possible.',
    openerPremium: 1.04, // +4% for OD opener (slightly less than Cole — new team adjustment)
    projectedKs: null,
  },
  'Logan Webb': {
    k9: 8.5, xK9: 8.70, projectedIP: 6.4, hand: 'R', team: 'SF', tier: 1,
    note: 'SF workhorse, 200 IP, elite ground ball rate. Lower K/9 but goes DEEP. Opener = extra innings.',
    openerPremium: 1.06,
    projectedKs: null,
  },
};

// Team batting K% for NYY and SF
const TEAM_K_PCT = {
  NYY: 0.232, // 23.2% — mid-range K rate
  SF:  0.228, // 22.8% — slightly below average K rate
};

// Oracle Park K factor: below average (ground ball park, marine layer)
const ORACLE_K_FACTOR = 0.96; // pitcher-friendly but Ks slightly suppressed by ground balls

// ==================== OUTS PROJECTIONS ====================
const OPENER_OUTS_PROJECTIONS = {
  'Max Fried': {
    projectedIP: 6.0, projectedOuts: 18.0, tier: 1,
    openerPremium: 1.06, // Tier 1 ace + opener = 6% deeper (slightly less than normal due to new team)
    note: 'Fried averages 5.8 IP/start, opener energy pushes to 6.0. New team could cap innings slightly.',
  },
  'Logan Webb': {
    projectedIP: 6.4, projectedOuts: 19.2, tier: 1,
    openerPremium: 1.08,
    note: 'Webb is an innings eater — led NL in IP. Opener = 6.4+ IP easy.',
  },
};

// ==================== ANALYSIS FUNCTIONS ====================

/**
 * Calculate K prop projections for Fried and Webb
 */
function analyzeKProps() {
  const results = {};
  
  for (const [pitcher, proj] of Object.entries(OPENER_K_PROJECTIONS)) {
    const opponent = pitcher === 'Max Fried' ? 'SF' : 'NYY';
    const oppKPct = TEAM_K_PCT[opponent];
    const lgAvgK = 0.225; // league average K%
    const oppKAdj = oppKPct / lgAvgK; // how much more/less this team Ks vs average
    
    // Expected Ks = (K/9 × projected IP / 9) × oppTeamKAdj × parkKFactor × openerPremium
    const rawKs = (proj.k9 * proj.projectedIP / 9);
    const adjKs = rawKs * oppKAdj * ORACLE_K_FACTOR * proj.openerPremium;
    
    proj.projectedKs = adjKs;
    
    // Poisson probability distribution for Ks
    const kProbs = {};
    for (let k = 0; k <= 15; k++) {
      kProbs[k] = poissonPMF(k, adjKs);
    }
    
    // Calculate over/under probabilities for common lines
    const lines = pitcher === 'Max Fried' 
      ? [4.5, 5.5, 6.5]  // Fried K/9 = 8.8, lower than Cole — 5.5 range
      : [4.5, 5.5, 6.5];       // Webb lower K rate, 5.5 range
    
    const lineAnalysis = lines.map(line => {
      let overProb = 0;
      for (let k = Math.ceil(line); k <= 15; k++) {
        overProb += kProbs[k] || 0;
      }
      return {
        line,
        overProb: Math.round(overProb * 1000) / 10,
        underProb: Math.round((1 - overProb) * 1000) / 10,
        fairOverOdds: probToAmerican(overProb),
        fairUnderOdds: probToAmerican(1 - overProb),
      };
    });
    
    results[pitcher] = {
      ...proj,
      oppTeam: opponent,
      oppKPct: oppKPct,
      oppKAdj: Math.round(oppKAdj * 1000) / 1000,
      parkKFactor: ORACLE_K_FACTOR,
      expectedKs: Math.round(adjKs * 100) / 100,
      distribution: kProbs,
      lineAnalysis,
      topPlay: null, // determined after live odds comparison
    };
  }
  
  // DK K prop lines (estimated for opener — will be updated with live odds)
  const DK_K_LINES = {
    'Max Fried': { line: 5.5, overOdds: -115, underOdds: -105 },
    'Logan Webb':  { line: 5.5, overOdds: -110, underOdds: -110 },
  };
  
  // Compare to DK lines and find edges
  for (const [pitcher, analysis] of Object.entries(results)) {
    const dk = DK_K_LINES[pitcher];
    if (dk) {
      const matchingLine = analysis.lineAnalysis.find(l => l.line === dk.line);
      if (matchingLine) {
        const dkOverImplied = americanToProb(dk.overOdds);
        const dkUnderImplied = americanToProb(dk.underOdds);
        const modelOverProb = matchingLine.overProb / 100;
        const overEdge = ((modelOverProb - dkOverImplied) / dkOverImplied) * 100;
        const underEdge = ((matchingLine.underProb / 100 - dkUnderImplied) / dkUnderImplied) * 100;
        
        analysis.dkLine = dk;
        analysis.dkComparison = {
          line: dk.line,
          dkOverImplied: Math.round(dkOverImplied * 1000) / 10,
          dkUnderImplied: Math.round(dkUnderImplied * 1000) / 10,
          modelOverProb: matchingLine.overProb,
          modelUnderProb: matchingLine.underProb,
          overEdge: Math.round(overEdge * 10) / 10,
          underEdge: Math.round(underEdge * 10) / 10,
          recommendation: overEdge > 3 ? 'OVER' : underEdge > 3 ? 'UNDER' : 'NO EDGE',
          confidence: Math.abs(overEdge) > 10 ? 'HIGH' : Math.abs(overEdge) > 5 ? 'MEDIUM' : 'LOW',
        };
        
        analysis.topPlay = analysis.dkComparison.recommendation !== 'NO EDGE' 
          ? `${pitcher} K ${analysis.dkComparison.recommendation} ${dk.line} (${Math.max(Math.abs(overEdge), Math.abs(underEdge)).toFixed(1)}% edge)`
          : null;
      }
    }
  }
  
  return results;
}

/**
 * Analyze NRFI/YRFI for NYY@SF
 */
function analyzeNRFI() {
  // Fried: LHP, elite ground ball pitcher — suppresses 1st inning runs but lower K rate
  // Webb: RHP, ground ball machine, elite command
  // Oracle Park: pitcher-friendly, cold March weather
  // KEY: Fried is LHP vs SF's RHH-heavy lineup — slight platoon disadvantage in 1st inning
  
  const friedK9 = 8.8;
  const webbK9 = 8.5;
  
  // Base expected runs per half-inning (league avg ~0.5)
  const lgAvg1stInningRuns = 0.50;
  
  // Pitcher tier suppression
  const friedSuppression = 0.85; // Tier 1 but LHP vs RHH lineup — slightly less suppression than RHP would get
  const webbSuppression = 0.85; // Tier 1 workhorse = 15% suppression  
  
  // Park factor for 1st inning
  const parkFactor = 0.93; // Oracle Park is very pitcher-friendly
  
  // OD premium (rusty bats + ace going extra hard in first)
  const odPremium = 0.94; // +6% NRFI boost
  
  // Cold weather March
  const weatherAdj = 0.96; // March in SF = cold + marine layer
  
  // P(0 runs in top 1st) — NYY batting vs Webb
  const expRunsTop1 = lgAvg1stInningRuns * webbSuppression * parkFactor * odPremium * weatherAdj;
  const pScorelessTop1 = poissonCDF(0, expRunsTop1);
  
  // P(0 runs in bot 1st) — SF batting vs Fried (LHP)
  const expRunsBot1 = lgAvg1stInningRuns * friedSuppression * parkFactor * odPremium * weatherAdj;
  const pScorelessBot1 = poissonCDF(0, expRunsBot1);
  
  // NRFI = both scoreless
  const nrfiProb = pScorelessTop1 * pScorelessBot1;
  const yrfiProb = 1 - nrfiProb;
  
  return {
    nrfiProb: Math.round(nrfiProb * 1000) / 10,
    yrfiProb: Math.round(yrfiProb * 1000) / 10,
    fairNrfiOdds: probToAmerican(nrfiProb),
    fairYrfiOdds: probToAmerican(yrfiProb),
    topInning: {
      expRunsTop1: Math.round(expRunsTop1 * 1000) / 1000,
      pScorelessTop1: Math.round(pScorelessTop1 * 1000) / 10,
      expRunsBot1: Math.round(expRunsBot1 * 1000) / 1000,
      pScorelessBot1: Math.round(pScorelessBot1 * 1000) / 10,
    },
    signals: [
      'Fried (LHP) elite ground ball pitcher + Webb ground-ball machine = both suppress 1st inning runs',
      'Fried vs SF RHH-heavy lineup — slight platoon concern but ground-ball approach neutralizes',
      'Oracle Park: 0.93 park factor, most pitcher-friendly in NL',
      'March weather: cold + marine layer off SF Bay = NRFI boost',
      'Opening Day: rusty bats, aces going 100%, zero bullpen risk in 1st',
    ],
    recommendation: nrfiProb > 55 ? 'NRFI' : yrfiProb > 55 ? 'YRFI' : 'LEAN NRFI',
    confidence: nrfiProb > 60 ? 'HIGH' : nrfiProb > 55 ? 'MEDIUM' : 'LOW',
  };
}

/**
 * Full game analysis with model prediction
 */
async function fullAnalysis() {
  const analysis = {
    game: OPENER,
    timestamp: new Date().toISOString(),
    modelVersion: '125.0',
    sections: {},
  };
  
  // 1. Core model prediction
  try {
    if (mlbModel && mlbModel.asyncPredict) {
      const prediction = await mlbModel.asyncPredict('NYY', 'SF', {
        awayPitcher: 'Max Fried',
        homePitcher: 'Logan Webb',
        isOpeningDay: true,
      });
      analysis.sections.prediction = prediction;
    } else if (mlbModel && mlbModel.predict) {
      const prediction = mlbModel.predict('NYY', 'SF', {
        awayPitcher: 'Max Fried',
        homePitcher: 'Logan Webb',
        isOpeningDay: true,
      });
      analysis.sections.prediction = prediction;
    }
  } catch(e) {
    analysis.sections.prediction = { error: e.message };
  }
  
  // 2. K Props analysis
  try {
    analysis.sections.kProps = analyzeKProps();
  } catch(e) {
    analysis.sections.kProps = { error: e.message };
  }
  
  // 3. NRFI analysis
  try {
    analysis.sections.nrfi = analyzeNRFI();
  } catch(e) {
    analysis.sections.nrfi = { error: e.message };
  }
  
  // 4. Outs props
  try {
    analysis.sections.outsProps = analyzeOutsProps();
  } catch(e) {
    analysis.sections.outsProps = { error: e.message };
  }
  
  // 5. F5 analysis (first 5 innings)
  try {
    if (negBinomial && negBinomial.negBinF5) {
      const pred = analysis.sections.prediction;
      if (pred && pred.awayExpRuns && pred.homeExpRuns) {
        analysis.sections.f5 = {
          note: 'Both aces — F5 UNDER should be strong with Fried/Webb at Oracle',
        };
      }
    }
    // Manual F5 calculation
    const f5Factor = 0.545; // OD games
    const awayRuns = analysis.sections.prediction?.awayExpRuns || 3.2;
    const homeRuns = analysis.sections.prediction?.homeExpRuns || 3.0;
    const f5AwayRuns = awayRuns * f5Factor;
    const f5HomeRuns = homeRuns * f5Factor;
    const f5Total = f5AwayRuns + f5HomeRuns;
    
    analysis.sections.f5 = {
      f5AwayRuns: Math.round(f5AwayRuns * 100) / 100,
      f5HomeRuns: Math.round(f5HomeRuns * 100) / 100,
      f5Total: Math.round(f5Total * 100) / 100,
      f5Factor,
      signal: f5Total < 3.5 ? 'STRONG F5 UNDER' : f5Total < 4.0 ? 'F5 UNDER LEAN' : 'NEUTRAL',
      notes: [
        'Fried + Webb = two Tier 1 aces dominating F5',
        'Oracle Park 0.93 factor amplifies pitcher dominance',
        'OD starter premium: deeper outings, less bullpen = F5 almost all ace innings',
      ],
    };
  } catch(e) {
    analysis.sections.f5 = { error: e.message };
  }
  
  // 6. F7 analysis (first 7 innings)
  try {
    const f7Factor = 0.755; // OD games
    const awayRuns = analysis.sections.prediction?.awayExpRuns || 3.2;
    const homeRuns = analysis.sections.prediction?.homeExpRuns || 3.0;
    const f7AwayRuns = awayRuns * f7Factor;
    const f7HomeRuns = homeRuns * f7Factor;
    const f7Total = f7AwayRuns + f7HomeRuns;
    
    analysis.sections.f7 = {
      f7AwayRuns: Math.round(f7AwayRuns * 100) / 100,
      f7HomeRuns: Math.round(f7HomeRuns * 100) / 100,
      f7Total: Math.round(f7Total * 100) / 100,
      f7Factor,
      signal: f7Total < 5.0 ? 'F7 UNDER LEAN' : 'NEUTRAL',
      notes: [
        'Both aces project 6+ IP — F7 is mostly ace-on-ace',
        'NYY bullpen solid (Holmes, Weaver), SF bullpen decent (Hicks, Chapman)',
        'F7 eliminates late-game chaos where bullpens blow up',
      ],
    };
  } catch(e) {
    analysis.sections.f7 = { error: e.message };
  }
  
  // 7. Weather forecast
  try {
    if (weatherService && weatherService.getWeatherImpact) {
      const weather = await weatherService.getWeatherImpact('SF', new Date('2026-03-26T00:05:00Z'));
      analysis.sections.weather = weather;
    } else {
      // Fallback estimate for March Oracle Park
      analysis.sections.weather = {
        estimated: true,
        temp: 52, // degrees F
        wind: 12, // mph
        windDirection: 'WNW', // off the bay
        humidity: 72,
        conditions: 'Partly cloudy, cool',
        runMultiplier: 0.94, // cold + wind in = suppresses runs
        notes: [
          'Oracle Park in March: 50-55°F typical, marine layer common',
          'Wind off SF Bay blows toward CF/RF — suppresses HR to right field (McCovey Cove)',
          'Cold + humidity + marine layer = ball doesn\'t carry',
          'Strong UNDER signal from weather',
        ],
      };
    }
  } catch(e) {
    analysis.sections.weather = { error: e.message, estimated: true, runMultiplier: 0.94 };
  }
  
  // 8. Catcher framing
  try {
    analysis.sections.catcherFraming = {
      away: { team: 'NYY', likely: 'Jose Trevino', framingRuns: 3.2, note: 'Solid framer, above average' },
      home: { team: 'SF', likely: 'Patrick Bailey', framingRuns: 22.5, note: 'ELITE framer — #1 in MLB. Huge edge for Webb.' },
      impact: 'SF has massive framing edge with Bailey. Webb + Bailey at Oracle = pitcher paradise.',
      bettingSignal: 'UNDER lean strengthened by Bailey framing edge',
    };
  } catch(e) {
    analysis.sections.catcherFraming = { error: e.message };
  }
  
  // 9. Generate comprehensive betting card
  analysis.bettingCard = generateBettingCard(analysis);
  
  // 10. Live odds (attempt to fetch from Odds API)
  try {
    const liveOdds = await fetchLiveOdds();
    if (liveOdds) {
      analysis.sections.liveOdds = liveOdds;
      // Recalculate edges with live odds
      analysis.bettingCard = generateBettingCard(analysis);
    }
  } catch(e) {
    analysis.sections.liveOdds = { error: e.message, note: 'Using DK estimated lines' };
  }
  
  return analysis;
}

/**
 * Generate betting card with all plays
 */
function generateBettingCard(analysis) {
  const pred = analysis.sections.prediction || {};
  const kProps = analysis.sections.kProps || {};
  const nrfi = analysis.sections.nrfi || {};
  const outsProps = analysis.sections.outsProps || {};
  const weather = analysis.sections.weather || {};
  const framing = analysis.sections.catcherFraming || {};
  const f5 = analysis.sections.f5 || {};
  const liveOdds = analysis.sections.liveOdds || {};
  
  const plays = [];
  const dk = liveOdds.ml ? liveOdds : OPENER.dkLine;
  
  // ===== MONEYLINE =====
  const homeWinProb = pred.homeWinProb || 0.48;
  const awayWinProb = pred.awayWinProb || 0.52;
  const dkHomeImplied = americanToProb(dk.homeML || 100);
  const dkAwayImplied = americanToProb(dk.awayML || -120);
  
  const homeEdge = ((homeWinProb - dkHomeImplied) / dkHomeImplied) * 100;
  const awayEdge = ((awayWinProb - dkAwayImplied) / dkAwayImplied) * 100;
  
  if (Math.abs(homeEdge) > 2 || Math.abs(awayEdge) > 2) {
    const bestEdge = awayEdge > homeEdge ? 
      { side: 'NYY ML', prob: awayWinProb, odds: dk.awayML, edge: awayEdge } :
      { side: 'SF ML', prob: homeWinProb, odds: dk.homeML, edge: homeEdge };
    
    plays.push({
      market: 'Moneyline',
      play: bestEdge.side,
      modelProb: `${Math.round(bestEdge.prob * 1000) / 10}%`,
      bookOdds: bestEdge.odds > 0 ? `+${bestEdge.odds}` : `${bestEdge.odds}`,
      edge: `${bestEdge.edge > 0 ? '+' : ''}${Math.round(bestEdge.edge * 10) / 10}%`,
      conviction: bestEdge.edge > 5 ? 'STRONG' : bestEdge.edge > 3 ? 'LEAN' : 'SMALL',
      grade: bestEdge.edge > 8 ? 'A' : bestEdge.edge > 5 ? 'B+' : bestEdge.edge > 3 ? 'B' : 'C',
      notes: 'Fried slight favorite — elite ground-ball LHP, but Webb at Oracle Park evens it up. New-team jitters could be factor.',
    });
  }
  
  // ===== TOTAL =====
  const modelTotal = pred.expectedTotal || pred.projectedTotal || 6.2;
  const dkTotal = dk.total || 7.0;
  const totalEdge = ((dkTotal - modelTotal) / dkTotal) * 100;
  
  plays.push({
    market: 'Game Total',
    play: modelTotal < dkTotal ? `UNDER ${dkTotal}` : `OVER ${dkTotal}`,
    modelTotal: modelTotal.toFixed(1),
    bookTotal: dkTotal.toFixed(1),
    edge: `${Math.round(totalEdge * 10) / 10}%`,
    conviction: Math.abs(totalEdge) > 10 ? 'SMASH' : Math.abs(totalEdge) > 6 ? 'STRONG' : Math.abs(totalEdge) > 3 ? 'LEAN' : 'SMALL',
    grade: Math.abs(totalEdge) > 10 ? 'A+' : Math.abs(totalEdge) > 6 ? 'A' : Math.abs(totalEdge) > 3 ? 'B+' : 'B',
    notes: `Two aces at Oracle Park (0.93 PF), cold March weather (${weather.runMultiplier || 0.94}x). Bailey framing = UNDER paradise.`,
    signals: [
      weather.runMultiplier ? `Weather: ${weather.runMultiplier}x run multiplier` : null,
      'Oracle Park: 0.93 park factor (4th lowest in MLB)',
      framing.impact || 'Bailey elite framing at home',
      'OD premium: aces go deeper, rusty bats',
    ].filter(Boolean),
  });
  
  // ===== F5 UNDER =====
  if (f5.f5Total) {
    plays.push({
      market: 'F5 Total',
      play: f5.f5Total < 3.5 ? 'F5 UNDER 3.5' : 'F5 UNDER 4.0',
      modelF5Total: f5.f5Total.toFixed(1),
      conviction: f5.f5Total < 3.2 ? 'STRONG' : 'LEAN',
      grade: f5.f5Total < 3.0 ? 'A' : 'B+',
      notes: 'Fried + Webb dominate first 5 innings. Both ground-ball aces. Oracle suppresses.',
    });
  }
  
  // ===== NRFI =====
  if (nrfi.nrfiProb) {
    plays.push({
      market: 'NRFI',
      play: nrfi.recommendation,
      modelProb: `${nrfi.nrfiProb}%`,
      fairOdds: nrfi.fairNrfiOdds,
      conviction: nrfi.confidence,
      grade: nrfi.nrfiProb > 60 ? 'A' : nrfi.nrfiProb > 55 ? 'B+' : 'B',
      notes: 'Two aces at Oracle in March = first inning suppression. Classic NRFI spot.',
    });
  }
  
  // ===== K PROPS =====
  for (const [pitcher, kAnalysis] of Object.entries(kProps)) {
    if (kAnalysis.dkComparison && kAnalysis.dkComparison.recommendation !== 'NO EDGE') {
      plays.push({
        market: 'K Props',
        play: `${pitcher} K ${kAnalysis.dkComparison.recommendation} ${kAnalysis.dkComparison.line}`,
        modelKs: kAnalysis.expectedKs.toFixed(1),
        modelProb: kAnalysis.dkComparison.recommendation === 'OVER' 
          ? `${kAnalysis.dkComparison.modelOverProb}%` 
          : `${kAnalysis.dkComparison.modelUnderProb}%`,
        edge: `${Math.max(Math.abs(kAnalysis.dkComparison.overEdge), Math.abs(kAnalysis.dkComparison.underEdge)).toFixed(1)}%`,
        conviction: kAnalysis.dkComparison.confidence,
        grade: kAnalysis.dkComparison.confidence === 'HIGH' ? 'A' : 'B+',
        notes: `${pitcher}: ${kAnalysis.expectedKs.toFixed(1)} expected Ks. ${kAnalysis.note || ''}`,
      });
    }
  }
  
  // ===== OUTS PROPS =====
  if (outsProps['Max Fried']) {
    plays.push({
      market: 'Outs Props',
      play: `Fried OVER ${outsProps['Max Fried'].projectedLine || 17.5} outs`,
      modelOuts: outsProps['Max Fried'].projectedOuts.toFixed(1),
      conviction: 'LEAN',
      grade: 'B',
      notes: 'OD aces go deeper — Fried projected 6.0 IP (18.0 outs). Ground-ball LHP = efficient innings.',
    });
  }
  if (outsProps['Logan Webb']) {
    plays.push({
      market: 'Outs Props',
      play: `Webb OVER ${outsProps['Logan Webb'].projectedLine || 18.5} outs`,
      modelOuts: outsProps['Logan Webb'].projectedOuts.toFixed(1),
      conviction: 'LEAN',
      grade: 'B+',
      notes: 'Webb is THE workhorse — 200 IP, home park, cool weather = deep start. 6.4 IP projected.',
    });
  }
  
  // Sort by grade/conviction
  const gradeOrder = { 'A+': 0, 'A': 1, 'B+': 2, 'B': 3, 'C': 4 };
  plays.sort((a, b) => (gradeOrder[a.grade] || 5) - (gradeOrder[b.grade] || 5));
  
  // Calculate portfolio
  const bankroll = 1000;
  const kellySizing = plays.map(p => {
    const edge = parseFloat(p.edge) || 5;
    const kellyFraction = Math.max(0, Math.min(0.05, edge / 200)); // quarter Kelly, capped
    return {
      ...p,
      kellyPct: Math.round(kellyFraction * 10000) / 100,
      wager: Math.round(bankroll * kellyFraction * 100) / 100,
    };
  });
  
  const totalWager = kellySizing.reduce((sum, p) => sum + (p.wager || 0), 0);
  const avgEdge = plays.reduce((sum, p) => sum + (parseFloat(p.edge) || 0), 0) / Math.max(plays.length, 1);
  const expectedEV = Math.round(totalWager * avgEdge / 100 * 100) / 100;
  
  return {
    game: 'NYY @ SF — 2026 MLB Season Opener',
    date: 'March 25, 2026 — 8:05 PM ET',
    venue: 'Oracle Park, San Francisco',
    starters: 'Max Fried (NYY) vs Logan Webb (SF)',
    playCount: plays.length,
    plays: kellySizing,
    portfolio: {
      bankroll,
      totalWager: Math.round(totalWager * 100) / 100,
      expectedEV: expectedEV,
      avgEdge: Math.round(avgEdge * 10) / 10,
    },
    topThesis: [
      '🔑 UNDER is the primary thesis — two aces, Oracle Park (0.93 PF), cold March weather, Patrick Bailey elite framing',
      '🔑 NRFI lean — Fried + Webb both ground-ball aces, rusty OD bats, cold Oracle',
      '🔑 Fried K OVER if line is 5.5 — 8.8 K/9 with opener energy, but lower K rate than Cole',
      '🔑 Webb outs OVER — 200 IP workhorse at home, cool weather = deep start',
      '⚠️ ML is tighter now — Fried is elite but new team + LHP vs RHH = less edge than Cole would have',
    ],
  };
}

/**
 * Analyze outs props
 */
function analyzeOutsProps() {
  const results = {};
  
  for (const [pitcher, proj] of Object.entries(OPENER_OUTS_PROJECTIONS)) {
    const adjustedIP = proj.projectedIP * proj.openerPremium;
    const adjustedOuts = adjustedIP * 3;
    
    // Common lines
    const lines = pitcher === 'Max Fried' ? [16.5, 17.5, 18.5] : [17.5, 18.5, 19.5];
    
    const lineAnalysis = lines.map(line => {
      // Use Poisson for outs distribution (roughly)
      let overProb = 0;
      for (let o = Math.ceil(line); o <= 27; o++) {
        overProb += poissonPMF(o, adjustedOuts);
      }
      return {
        line,
        overProb: Math.round(overProb * 1000) / 10,
        underProb: Math.round((1 - overProb) * 1000) / 10,
      };
    });
    
    results[pitcher] = {
      projectedIP: Math.round(adjustedIP * 10) / 10,
      projectedOuts: Math.round(adjustedOuts * 10) / 10,
      openerPremium: proj.openerPremium,
      tier: proj.tier,
      lineAnalysis,
      projectedLine: pitcher === 'Max Fried' ? 17.5 : 18.5,
      note: proj.note,
    };
  }
  
  return results;
}

/**
 * Fetch live odds from The Odds API
 */
async function fetchLiveOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;
  
  return new Promise((resolve) => {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,totals,spreads&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm`;
    
    https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const games = JSON.parse(data);
          // Find NYY@SF
          const opener = games.find(g => 
            (g.away_team?.includes('Yankees') || g.away_team?.includes('NYY')) && 
            (g.home_team?.includes('Giants') || g.home_team?.includes('SF'))
          );
          
          if (!opener) {
            resolve({ note: 'NYY@SF not found in Odds API — lines may not be posted yet', games: games.length });
            return;
          }
          
          // Extract best lines
          const result = { found: true, bookmakers: [] };
          
          for (const book of (opener.bookmakers || [])) {
            const bookData = { name: book.key };
            
            for (const market of (book.markets || [])) {
              if (market.key === 'h2h') {
                for (const outcome of (market.outcomes || [])) {
                  if (outcome.name?.includes('Yankees') || outcome.name === 'NYY') {
                    bookData.awayML = outcome.price;
                  } else {
                    bookData.homeML = outcome.price;
                  }
                }
              }
              if (market.key === 'totals') {
                for (const outcome of (market.outcomes || [])) {
                  if (outcome.name === 'Over') {
                    bookData.total = outcome.point;
                    bookData.overOdds = outcome.price;
                  } else {
                    bookData.underOdds = outcome.price;
                  }
                }
              }
            }
            
            result.bookmakers.push(bookData);
          }
          
          // Best price across books
          const bestAway = result.bookmakers.reduce((best, b) => (!best || (b.awayML && b.awayML > best)) ? b.awayML : best, null);
          const bestHome = result.bookmakers.reduce((best, b) => (!best || (b.homeML && b.homeML > best)) ? b.homeML : best, null);
          const bestOver = result.bookmakers.reduce((best, b) => (!best || (b.overOdds && b.overOdds > best)) ? b.overOdds : best, null);
          const bestUnder = result.bookmakers.reduce((best, b) => (!best || (b.underOdds && b.underOdds > best)) ? b.underOdds : best, null);
          
          result.bestPrice = {
            awayML: bestAway,
            homeML: bestHome,
            total: result.bookmakers[0]?.total,
            overOdds: bestOver,
            underOdds: bestUnder,
          };
          
          resolve(result);
        } catch(e) {
          resolve({ error: e.message });
        }
      });
    }).on('error', (e) => resolve({ error: e.message }))
      .on('timeout', () => resolve({ error: 'timeout' }));
  });
}

// ==================== UTILITY FUNCTIONS ====================

function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logProb = k * Math.log(lambda) - lambda;
  for (let i = 2; i <= k; i++) logProb -= Math.log(i);
  return Math.exp(logProb);
}

function poissonCDF(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPMF(i, lambda);
  return sum;
}

function americanToProb(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function probToAmerican(prob) {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== CACHE ====================
let cachedAnalysis = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min cache

async function getAnalysis(forceRefresh = false) {
  if (!forceRefresh && cachedAnalysis && (Date.now() - cacheTime < CACHE_TTL)) {
    return cachedAnalysis;
  }
  cachedAnalysis = await fullAnalysis();
  cacheTime = Date.now();
  return cachedAnalysis;
}

function getQuickSummary() {
  if (cachedAnalysis) {
    return {
      cached: true,
      cacheAge: Math.round((Date.now() - cacheTime) / 1000) + 's',
      game: cachedAnalysis.game.away + ' @ ' + cachedAnalysis.game.home,
      date: cachedAnalysis.game.timeET,
      starters: cachedAnalysis.game.starters.away.name + ' vs ' + cachedAnalysis.game.starters.home.name,
      playCount: cachedAnalysis.bettingCard?.playCount || 0,
      topThesis: cachedAnalysis.bettingCard?.topThesis || [],
      portfolio: cachedAnalysis.bettingCard?.portfolio || {},
    };
  }
  
  return {
    cached: false,
    game: 'NYY @ SF',
    date: 'March 25, 2026 — 8:05 PM ET',
    starters: 'Max Fried vs Logan Webb',
    note: 'Analysis not cached yet — call /api/od/opener to generate',
  };
}

module.exports = {
  getAnalysis,
  getQuickSummary,
  analyzeKProps,
  analyzeNRFI,
  analyzeOutsProps,
  fullAnalysis,
  generateBettingCard,
  OPENER,
};
