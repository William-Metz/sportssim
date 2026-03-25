/**
 * OD Season Opener Analysis — NYY@SF March 25, 2026 8:05 PM ET
 * =================================================================
 * 
 * THE FIRST GAME OF THE 2026 MLB SEASON. Max Fried vs Logan Webb at Oracle Park.
 * 
 * 🚨 v128 FULL REBUILD for Max Fried (LHP):
 *   - Fried 2025 real stats: 19-5, 2.86 ERA, 3.07 FIP, 8.71 K/9, 51.9% GB%, CYA-4th, Gold Glove
 *   - LHP platoon analysis: SF has Devers (L), Arraez (L), Lee (L), Brennan (L) — 4 LHH suppressed
 *   - RHH platoon advantage: Adames, Chapman, Ramos, Bader have platoon edge vs Fried
 *   - New-team penalty: Fried on NYY for first time (signed from ATL offseason)
 *   - K rate: 8.71 K/9 (elite but NOT Cole's 11+ K/9 — K prop values shift)
 *   - Ground ball machine: 51.9% GB rate → efficient innings, low HR risk
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
  time: '2026-03-26T00:05:00Z', // 8:05 PM ET = 00:05 UTC March 26 (next day)
  timeET: '8:05 PM ET',
  venue: 'Oracle Park',
  outdoor: true,
  broadcast: 'ESPN',
  starters: {
    away: {
      name: 'Max Fried', hand: 'L',
      // 2025 NYY: 19-5, 2.86 ERA, 32 GS, 195.1 IP, 189 K, 51 BB
      era: 2.86, fip: 3.07, k9: 8.71, bb9: 2.35, whip: 1.101, ip: 195.1,
      gbRate: 0.519, // 51.9% ground ball rate — elite
      hrRate: 0.6,   // 0.6 HR/9 — low HR allowed
      kPct: 0.236,   // 23.6% K rate
      bbPct: 0.064,  // 6.4% BB rate
      tier: 1,
      accolades: 'CYA-4th, Gold Glove, All-Star (2025)',
      newTeam: true,  // Signed from ATL to NYY offseason — first OD with new club
      newTeamPenalty: 0.04, // 4% performance adjustment for new team jitters
    },
    home: {
      name: 'Logan Webb', hand: 'R',
      // 2025 SF ace: ~200 IP, ~3.25 ERA, ~8.5 K/9, elite command
      era: 3.25, fip: 3.12, k9: 8.5, bb9: 1.8, whip: 1.08, ip: 200,
      gbRate: 0.505, // 50.5% ground ball rate
      hrRate: 0.7,   // low HR/9 at Oracle Park
      kPct: 0.228,   // 22.8% K rate
      bbPct: 0.048,  // 4.8% BB rate — elite command
      tier: 1,
      accolades: 'NL IP leader, ace',
      newTeam: false,
    },
  },
  dkLine: { homeML: 100, awayML: -120, total: 7.0 },
  notes: [
    'First game of 2026 MLB season — massive national attention on ESPN',
    'Oracle Park: pitcher-friendly (0.93 park factor), cold March weather, wind off SF Bay',
    'Max Fried (LHP) is the NYY OD starter per MLB Stats API — NOT Gerrit Cole',
    'Fried: 2.86 ERA, 3.07 FIP, 8.71 K/9, 51.9% GB rate, Gold Glove — elite all-around but lower K rate than Cole',
    'Fried signed from ATL in offseason — new-team penalty applies (4% performance adj, unfamiliar catcher/mound)',
    'Webb is SF workhorse — 200 IP, elite command (1.8 BB/9), ground ball machine',
    'OD opener premium: starters go 5.8 IP vs 5.5 regular season',
    'Rusty bats + cold Oracle Park + two ground-ball aces = UNDER lean',
  ],
};

// ==================== SF LINEUP PLATOON ANALYSIS ====================
// SF projected lineup vs LHP (Fried)
const SF_LINEUP_VS_LHP = [
  { name: 'Patrick Bailey', pos: 'C', bats: 'S', note: 'Switch hitter — neutral vs LHP. #1 framer in MLB (22.5 framing runs). Elite asset for Webb.' },
  { name: 'Rafael Devers', pos: '1B', bats: 'L', note: 'LHH vs LHP = same-side SUPPRESSED. Elite hitter but historically weaker vs LHP. Key for UNDER thesis.' },
  { name: 'Luis Arraez', pos: '2B', bats: 'L', note: 'LHH vs LHP = same-side SUPPRESSED. Contact-first hitter — Fried\'s GB approach may neutralize Arraez\'s bat-to-ball.' },
  { name: 'Willy Adames', pos: 'SS', bats: 'R', note: 'RHH vs LHP = platoon ADVANTAGE. 30 HR power — Fried\'s GB approach limits damage. Key threat.' },
  { name: 'Matt Chapman', pos: '3B', bats: 'R', note: 'RHH vs LHP = platoon ADVANTAGE. Power bat but streaky — cold March could suppress.' },
  { name: 'Heliot Ramos', pos: 'RF', bats: 'R', note: 'RHH vs LHP = platoon ADVANTAGE. Young power bat. Oracle suppresses RF HR (McCovey Cove wind).' },
  { name: 'Harrison Bader', pos: 'CF', bats: 'R', note: 'RHH vs LHP = platoon ADVANTAGE. Speed/defense-first, moderate bat.' },
  { name: 'Jung Hoo Lee', pos: 'LF', bats: 'L', note: 'LHH vs LHP = same-side SUPPRESSED. Contact hitter but L-on-L historically weaker.' },
  { name: 'Jerar Encarnacion', pos: 'DH', bats: 'R', note: 'RHH vs LHP = platoon ADVANTAGE. Power upside but limited MLB experience.' },
];

// Platoon summary
const SF_PLATOON_SUMMARY = {
  lhh: ['Devers', 'Arraez', 'Lee', 'Brennan'], // 4 LHH (if Brennan starts over Encarnacion)
  rhh: ['Adames', 'Chapman', 'Ramos', 'Bader', 'Encarnacion'], // 5 RHH
  switch: ['Bailey'], // 1 switch
  lhhCount: 3, // minimum 3 LHH in any lineup (Devers, Arraez, Lee)
  rhhCount: 5, // 5 RHH
  note: 'SF is actually RHH-heavy (5R/3-4L/1S) — Fried faces MORE opposite-platoon bats than a typical lineup.',
  implication: 'The LHP platoon suppression primarily hits Devers (top of order) and Arraez (elite contact). ' +
               'This suppresses SF\'s top 2 hitters but 5 RHH have platoon advantage. Net effect: roughly neutral, ' +
               'slight UNDER lean because Devers/Arraez are the highest-OBP hitters in the lineup.',
};

// NYY lineup vs RHP (Webb) — mostly RHH which is disadvantaged vs Webb (RHP)
const NYY_LINEUP_VS_RHP = {
  lhh: ['Soto', 'Judge (L-throws, R-bats — RHH actually)'],
  rhh: ['Judge', 'Stanton', 'Torres', 'Volpe', 'Verdugo'],
  switch: [],
  note: 'NYY is mostly RHH — same-side disadvantage vs Webb (RHP). Soto is the key LHH threat.',
  implication: 'Webb as RHP faces a NYY lineup with most hitters on the same side. Slight suppression. ' +
               'Juan Soto is the primary opposite-platoon threat with elite plate discipline.',
};

// ==================== FRIED + WEBB K/OUTS PROJECTIONS ====================
const OPENER_K_PROJECTIONS = {
  'Max Fried': {
    k9: 8.71, // Real 2025: 189 K / 195.1 IP * 9 = 8.71
    kPct: 0.236, // 23.6% K rate
    xK9: 8.6, // Expected K/9 based on Statcast swinging strike data
    projectedIP: 5.8, // Slightly less than normal 6.1 due to new-team adjustment
    hand: 'L', team: 'NYY', tier: 1,
    note: 'LHP. 2025 NYY: 19-5, 2.86 ERA, 8.71 K/9, 51.9% GB%, Gold Glove. Ground-ball machine who induces weak contact. ' +
          'Lower K rate than Cole (11+ K/9) — K props shift down significantly. New team = possible shorter leash from manager.',
    openerPremium: 1.04, // +4% for OD opener (less than typical — new team cautiousness)
    newTeamAdj: 0.96,    // -4% for unfamiliar catcher (Trevino), mound, signs
    projectedKs: null,
  },
  'Logan Webb': {
    k9: 8.5,
    kPct: 0.228,
    xK9: 8.70,
    projectedIP: 6.4, // Webb is THE workhorse — goes deep every start
    hand: 'R', team: 'SF', tier: 1,
    note: 'SF workhorse, 200 IP leader, elite command (1.8 BB/9). Ground ball approach. Opener energy = extra innings. ' +
          'At home in Oracle Park — massive comfort edge over Fried (new to AL Park).',
    openerPremium: 1.06, // Full opener premium — home park, ace energy
    newTeamAdj: 1.0,     // No adjustment — home team
    projectedKs: null,
  },
};

// Team batting K% for NYY and SF
const TEAM_K_PCT = {
  NYY: 0.232, // 23.2% — mid-range K rate (Stanton/Judge swing & miss, but Soto patient)
  SF:  0.218, // 21.8% — below average K rate (Arraez/Lee contact-heavy + Devers)
};

// Oracle Park K factor
const ORACLE_K_FACTOR = 0.96; // pitcher-friendly park but Ks slightly suppressed by ground balls / marine layer

// ==================== OUTS PROJECTIONS ====================
const OPENER_OUTS_PROJECTIONS = {
  'Max Fried': {
    projectedIP: 5.8, projectedOuts: 17.4, tier: 1,
    openerPremium: 1.04, // Lower than typical — new team, unfamiliar signals
    note: 'Fried averages 6.1 IP/start (195.1 IP / 32 GS) but new team + unfamiliar catcher = cap at ~5.8 IP. ' +
          'High GB rate (51.9%) = efficient innings via ground outs. Manager may pull slightly earlier in opener.',
  },
  'Logan Webb': {
    projectedIP: 6.4, projectedOuts: 19.2, tier: 1,
    openerPremium: 1.08, // Full premium — home park, ace, OD energy
    note: 'Webb is an innings eater — led NL in IP (200). At Oracle Park where he\'s dominant. Opener energy = 6.4+ IP.',
  },
};

// ==================== ANALYSIS FUNCTIONS ====================

/**
 * Calculate K prop projections for Fried and Webb with LHP platoon context
 */
function analyzeKProps() {
  const results = {};
  
  for (const [pitcher, proj] of Object.entries(OPENER_K_PROJECTIONS)) {
    const opponent = pitcher === 'Max Fried' ? 'SF' : 'NYY';
    const oppKPct = TEAM_K_PCT[opponent];
    const lgAvgK = 0.225; // league average K%
    const oppKAdj = oppKPct / lgAvgK;
    
    // Expected Ks = (K/9 × projected IP / 9) × oppKAdj × parkKFactor × openerPremium × newTeamAdj
    const rawKs = (proj.k9 * proj.projectedIP / 9);
    const adjKs = rawKs * oppKAdj * ORACLE_K_FACTOR * proj.openerPremium * (proj.newTeamAdj || 1.0);
    
    proj.projectedKs = adjKs;
    
    // Poisson probability distribution for Ks
    const kProbs = {};
    for (let k = 0; k <= 15; k++) {
      kProbs[k] = poissonPMF(k, adjKs);
    }
    
    // Calculate over/under probabilities for common lines
    // Fried K/9 = 8.71 → expect ~5.4 Ks in 5.8 IP → lines around 4.5-5.5
    // Webb K/9 = 8.5 → expect ~5.9 Ks in 6.4 IP → lines around 5.5-6.5
    const lines = pitcher === 'Max Fried' 
      ? [3.5, 4.5, 5.5, 6.5]  // Fried: lower K rate, shorter outing = lower lines
      : [4.5, 5.5, 6.5, 7.5]; // Webb: goes deeper, more K opportunities
    
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
      topPlay: null,
    };
  }
  
  // DK K prop lines (estimated — will be updated with live odds)
  // KEY CHANGE from Cole: Fried K rate much lower → DK line should be lower
  const DK_K_LINES = {
    'Max Fried': { line: 5.5, overOdds: -105, underOdds: -115 },  // Lower than Cole's 7.5-8.5 range
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
  
  // Add platoon context
  results.platoonContext = {
    friedVsSF: {
      pitcher: 'Fried (LHP)',
      lhh: SF_PLATOON_SUMMARY.lhh,
      rhhWithAdvantage: SF_PLATOON_SUMMARY.rhh,
      kImpact: 'Fried\'s K rate vs LHH (Devers, Arraez, Lee) is historically LOWER for LHP vs LHH. ' +
               'But 5 RHH have platoon advantage and may swing more freely → slightly higher K rate for them. ' +
               'Net: roughly neutral K rate adjustment. The 8.71 K/9 baseline holds.',
    },
    webbVsNYY: {
      pitcher: 'Webb (RHP)',
      kImpact: 'NYY is mostly RHH — same-side vs Webb. Judge/Stanton swing big but Webb\'s GB approach limits damage. ' +
               'Soto (LHH) is the primary K-resistant threat with elite plate discipline. Webb should hold K rate.',
    },
  };
  
  return results;
}

/**
 * Analyze NRFI/YRFI for NYY@SF with LHP platoon detail
 */
function analyzeNRFI() {
  // KEY LHP CONTEXT:
  // Fried (LHP) faces SF's top-of-order: likely Arraez/Devers leading off
  // Both are LHH → same-side disadvantage in 1st inning
  // This BOOSTS NRFI probability compared to a RHP starter
  
  const lgAvg1stInningRuns = 0.50;
  
  // Fried 1st inning suppression factors
  const friedBase = 0.85; // Tier 1 ace = 15% base suppression
  const friedLHPvsLHHBoost = 0.95; // Extra 5% suppression because SF top of order is LHH (Arraez/Devers)
  const friedNewTeamJitters = 1.03; // +3% runs from unfamiliarity (new signs, new mound)
  const friedSuppression = friedBase * friedLHPvsLHHBoost * friedNewTeamJitters; // ≈ 0.83
  
  // Webb 1st inning suppression factors
  const webbBase = 0.85; // Tier 1 ace
  const webbHomePark = 0.97; // Oracle Park comfort edge
  const webbSuppression = webbBase * webbHomePark; // ≈ 0.82
  
  // Park factor for 1st inning
  const parkFactor = 0.93; // Oracle Park is very pitcher-friendly
  
  // OD premium (rusty bats + ace going extra hard in first)
  const odPremium = 0.94; // +6% NRFI boost
  
  // Cold weather March in SF
  const weatherAdj = 0.96; // March = cold + marine layer off Bay
  
  // P(0 runs in top 1st) — NYY batting vs Webb (RHP)
  const expRunsTop1 = lgAvg1stInningRuns * webbSuppression * parkFactor * odPremium * weatherAdj;
  const pScorelessTop1 = poissonCDF(0, expRunsTop1);
  
  // P(0 runs in bot 1st) — SF batting vs Fried (LHP)
  // Note: SF top of order likely LHH (Arraez/Devers) → EXTRA suppression
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
      '🔑 Fried (LHP) vs SF top of order: Arraez + Devers are BOTH LHH → same-side 1st inning suppression',
      'Webb (RHP) at Oracle Park = dominant home 1st inning profile',
      'Both pitchers are ground-ball machines (51.9% Fried, 50.5% Webb) → weak contact, quick outs',
      'Oracle Park: 0.93 park factor, most pitcher-friendly in NL',
      'March weather: 50-55°F, marine layer off Bay = ball doesn\'t carry',
      'Opening Day: rusty bats, aces going 100%, zero bullpen risk in 1st',
      '⚠️ Fried new-team jitters slightly offset the LHP suppression edge',
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
    modelVersion: '128.0',
    rebuiltFor: 'Max Fried (LHP) — corrected from Cole (RHP)',
    sections: {},
  };
  
  // 0. Platoon analysis
  analysis.sections.platoon = {
    sfLineupVsLHP: SF_LINEUP_VS_LHP,
    platoonSummary: SF_PLATOON_SUMMARY,
    nyyLineupVsRHP: NYY_LINEUP_VS_RHP,
    keyInsight: 'Fried (LHP) suppresses SF\'s best on-base guys (Devers L, Arraez L, Lee L) but 5 RHH have platoon advantage. ' +
                'Net effect is roughly neutral-to-slight UNDER lean because the top of the order is suppressed. ' +
                'Webb (RHP) faces a mostly-RHH NYY lineup which is also slightly suppressed. ' +
                'BOTH lineups face some platoon suppression → STRONG UNDER environment.',
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
  
  // 5. F5 analysis (first 5 innings) — Fried + Webb ace-on-ace
  try {
    const f5Factor = 0.545; // OD games
    const awayRuns = analysis.sections.prediction?.awayExpRuns || 3.0;
    const homeRuns = analysis.sections.prediction?.homeExpRuns || 2.8;
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
        'Fried (LHP, 2.86 ERA) + Webb (RHP, 3.25 ERA) = ace-on-ace dominance in F5',
        'Both ground-ball aces: Fried 51.9% GB, Webb 50.5% GB → efficient innings',
        'Oracle Park 0.93 factor amplifies pitcher dominance',
        'OD starter premium: deeper outings, less bullpen = F5 is almost entirely starter innings',
        'LHP platoon suppression on Devers/Arraez adds slight UNDER lean for F5 in bottom half',
      ],
    };
  } catch(e) {
    analysis.sections.f5 = { error: e.message };
  }
  
  // 6. F7 analysis (first 7 innings) — mostly starter innings
  try {
    const f7Factor = 0.755; // OD games
    const awayRuns = analysis.sections.prediction?.awayExpRuns || 3.0;
    const homeRuns = analysis.sections.prediction?.homeExpRuns || 2.8;
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
        'Both aces project 5.8-6.4 IP — F7 is almost entirely ace-on-ace',
        'Fried may be pulled slightly earlier (5.8 IP) due to new team → 1-2 bullpen innings in 6th/7th',
        'NYY bullpen: Holmes, Weaver solid; SF bullpen: Walker, Bivens, injured relievers',
        'F7 eliminates late-game chaos where bullpens blow up',
        '⚠️ Fried new-team leash could mean more bullpen in 6th/7th vs Cole who would go 7+',
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
      analysis.sections.weather = {
        estimated: true,
        temp: 52,
        wind: 12,
        windDirection: 'WNW', // off the bay toward CF/RF
        humidity: 72,
        conditions: 'Partly cloudy, cool, marine layer possible',
        runMultiplier: 0.94, // cold + wind in = suppresses runs
        notes: [
          'Oracle Park in March: 50-55°F typical, marine layer common by game time',
          'Wind off SF Bay blows toward CF/RF — suppresses HR to right field (McCovey Cove)',
          'Cold + humidity + marine layer = ball doesn\'t carry',
          'Strong UNDER signal from weather — this is one of the coldest/most suppressive OD environments',
          'Fried\'s ground-ball approach (51.9% GB) is LESS affected by weather than fly-ball pitchers',
        ],
      };
    }
  } catch(e) {
    analysis.sections.weather = { error: e.message, estimated: true, runMultiplier: 0.94 };
  }
  
  // 8. Catcher framing — MASSIVE edge for SF
  try {
    analysis.sections.catcherFraming = {
      away: {
        team: 'NYY', likely: 'Jose Trevino', framingRuns: 3.2,
        note: 'Above-average framer. But Trevino catching Fried for first time — unfamiliar with Fried\'s repertoire/sequencing.',
        newPitcherPenalty: true,
      },
      home: {
        team: 'SF', likely: 'Patrick Bailey', framingRuns: 22.5,
        note: 'ELITE framer — #1 in MLB (22.5 framing runs). Webb-Bailey battery is the best in baseball. ' +
              'Massive strike zone edge for Webb. Bailey knows Webb\'s tendencies intimately.',
      },
      framingGap: 19.3, // Bailey 22.5 - Trevino 3.2
      impact: 'SF has massive framing advantage with Bailey (#1 framer). Webb + Bailey at Oracle = pitcher paradise. ' +
              'Fried loses some edge because Trevino is catching him for the first time — unfamiliar pitch sequences.',
      bettingSignal: 'UNDER lean STRENGTHENED by framing gap (19.3 run difference). Webb benefits most.',
    };
  } catch(e) {
    analysis.sections.catcherFraming = { error: e.message };
  }
  
  // 9. Fried new-team analysis (unique to this rebuild)
  analysis.sections.newTeamAnalysis = {
    pitcher: 'Max Fried',
    previousTeam: 'ATL (2017-2024)',
    newTeam: 'NYY (2025-present)',
    factors: [
      { factor: 'Unfamiliar catcher', impact: -2, detail: 'Trevino catching Fried for first time in regular season. Spring training reps help but OD intensity is different.' },
      { factor: 'New mound/park', impact: -1, detail: 'First time pitching at Oracle Park in a reg season NYY uniform. Visiting park, not home, so somewhat mitigated.' },
      { factor: 'AL experience', impact: 0, detail: 'Fried pitched full 2025 in AL (195.1 IP, 2.86 ERA) — already adjusted to AL lineups. NOT a factor.' },
      { factor: 'First-ever OD start?', impact: -1, detail: 'Fried made OD starts for ATL but this is his first as a Yankee. Added pressure/spotlight.' },
      { factor: 'Big-game experience', impact: +2, detail: 'World Series winner with ATL (2021). Playoff tested. Handles pressure better than most. This offsets new-team jitters.' },
    ],
    netImpact: -2, // small net negative
    adjustedERA: 3.02, // 2.86 base + slight new-team upward adj
    note: 'Fried is elite regardless — 2.86 ERA with NYY in 2025 proves he adjusted. But OD is different from a June start. ' +
          'The unfamiliar-catcher factor is the biggest concern. Trevino is a good framer but hasn\'t built the Webb-Bailey level rapport.',
  };
  
  // 10. Generate comprehensive betting card
  analysis.bettingCard = generateBettingCard(analysis);
  
  // 11. Live odds (attempt to fetch from Odds API)
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
 * Generate betting card with all plays — rebuilt for Fried
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
  const dk = liveOdds.bestPrice ? liveOdds.bestPrice : OPENER.dkLine;
  
  // ===== MONEYLINE =====
  // With Fried (LHP) instead of Cole, NYY is less of a favorite
  // Fried 2025: 2.86 ERA but new-team jitters; Webb 3.25 ERA but home park + Bailey
  const homeWinProb = pred.homeWinProb || 0.47;
  const awayWinProb = pred.awayWinProb || 0.53;
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
      notes: 'Fried vs Webb is much closer than Cole vs Webb would be. Fried elite (2.86 ERA) but new-team jitters + ' +
             'Webb at Oracle with Bailey = near coin-flip. ML edge is slim — better value in totals/props.',
    });
  }
  
  // ===== TOTAL (PRIMARY THESIS) =====
  const modelTotal = pred.expectedTotal || pred.projectedTotal || 5.8;
  const dkTotal = dk.total || 7.0;
  const totalEdge = ((dkTotal - modelTotal) / dkTotal) * 100;
  
  plays.push({
    market: 'Game Total',
    play: modelTotal < dkTotal ? `UNDER ${dkTotal}` : `OVER ${dkTotal}`,
    modelTotal: modelTotal.toFixed(1),
    bookTotal: dkTotal.toFixed(1),
    edge: `${Math.round(totalEdge * 10) / 10}%`,
    conviction: Math.abs(totalEdge) > 12 ? 'SMASH' : Math.abs(totalEdge) > 8 ? 'STRONG' : Math.abs(totalEdge) > 4 ? 'LEAN' : 'SMALL',
    grade: Math.abs(totalEdge) > 12 ? 'A+' : Math.abs(totalEdge) > 8 ? 'A' : Math.abs(totalEdge) > 4 ? 'B+' : 'B',
    notes: `PRIMARY THESIS: Two ground-ball aces (Fried 51.9% GB, Webb 50.5% GB) at Oracle Park (0.93 PF) in cold March weather. ` +
           `Bailey #1 framing gives Webb massive strike zone edge. Fried LHP suppresses Devers/Arraez (top of SF order). ` +
           `Multiple convergent signals all point UNDER.`,
    signals: [
      weather.runMultiplier ? `Weather: ${weather.runMultiplier}x run multiplier (cold + marine layer)` : 'Weather: cold March Oracle = UNDER boost',
      'Oracle Park: 0.93 park factor (4th lowest in MLB)',
      'Bailey #1 framing (22.5 runs) → massive strike zone expansion for Webb',
      'Fried LHP suppresses SF top of order (Devers L, Arraez L)',
      'Both pitchers 50%+ GB rate → ground outs, not HRs',
      'OD premium: aces go 5.8-6.4 IP, rusty bats struggle early',
      'Fried new-team factor only SLIGHTLY offsets (still 2.86 ERA pitcher)',
    ],
  });
  
  // ===== F5 UNDER =====
  if (f5.f5Total) {
    plays.push({
      market: 'F5 Total',
      play: f5.f5Total < 3.5 ? 'F5 UNDER 3.5' : 'F5 UNDER 4.0',
      modelF5Total: f5.f5Total.toFixed(1),
      conviction: f5.f5Total < 3.0 ? 'STRONG' : f5.f5Total < 3.5 ? 'LEAN' : 'SMALL',
      grade: f5.f5Total < 3.0 ? 'A' : f5.f5Total < 3.5 ? 'B+' : 'B',
      notes: 'Fried + Webb dominate F5. Both ground-ball machines at Oracle. ' +
             'F5 is almost entirely starter innings — no bullpen risk. ' +
             'Fried\'s LHP platoon suppresses SF\'s LHH top of order even MORE in F5 (first-time-through-order advantage).',
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
      notes: 'Two ground-ball aces at Oracle in March = classic NRFI spot. ' +
             'KEY: Fried (LHP) faces SF leadoff hitters who are LHH (Arraez/Devers) → same-side suppression in 1st inning. ' +
             'Slightly offset by Fried\'s new-team jitters — first reg season pitch as a Yankee.',
    });
  }
  
  // ===== K PROPS =====
  for (const [pitcher, kAnalysis] of Object.entries(kProps)) {
    if (pitcher === 'platoonContext') continue; // skip context object
    if (kAnalysis.dkComparison && kAnalysis.dkComparison.recommendation !== 'NO EDGE') {
      const isRebuildNote = pitcher === 'Max Fried' 
        ? 'CRITICAL CHANGE from Cole: Fried K/9 = 8.71 (vs Cole 11+). K prop value is in a LOWER range (4.5-5.5 vs Cole 7.5-8.5). ' +
          'DK should set Fried\'s line lower — look for mispricing if they don\'t fully adjust from Cole.'
        : 'Webb K projections unchanged from original analysis.';
      
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
        notes: isRebuildNote || kAnalysis.note,
      });
    }
  }
  
  // ===== OUTS PROPS =====
  if (outsProps['Max Fried']) {
    plays.push({
      market: 'Outs Props',
      play: `Fried OVER ${outsProps['Max Fried'].projectedLine || 16.5} outs`,
      modelOuts: outsProps['Max Fried'].projectedOuts.toFixed(1),
      conviction: 'LEAN',
      grade: 'B',
      notes: 'Fried projected 5.8 IP (17.4 outs). Ground-ball LHP = efficient innings, but new-team factor ' +
             'means manager might have shorter leash than he would with an established Yankee. ' +
             'Lower confidence than Cole outs OVER would be — Cole had longer track record at NYY.',
    });
  }
  if (outsProps['Logan Webb']) {
    plays.push({
      market: 'Outs Props',
      play: `Webb OVER ${outsProps['Logan Webb'].projectedLine || 18.5} outs`,
      modelOuts: outsProps['Logan Webb'].projectedOuts.toFixed(1),
      conviction: 'STRONG',
      grade: 'A-',
      notes: 'Webb is THE workhorse — 200 IP, home park, cool weather = deep start. 6.4 IP projected. ' +
             'Webb at Oracle Park on Opening Day is the safest outs OVER bet on the board.',
    });
  }
  
  // Sort by grade/conviction
  const gradeOrder = { 'A+': 0, 'A': 1, 'A-': 1.5, 'B+': 2, 'B': 3, 'C': 4 };
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
    starters: 'Max Fried (LHP, NYY) vs Logan Webb (RHP, SF)',
    starterChange: '🚨 REBUILT: Was Cole (RHP) → Now Fried (LHP). K rate drops from 11+ to 8.7. Win prob tighter. UNDER thesis strengthens.',
    playCount: plays.length,
    plays: kellySizing,
    portfolio: {
      bankroll,
      totalWager: Math.round(totalWager * 100) / 100,
      expectedEV: expectedEV,
      avgEdge: Math.round(avgEdge * 10) / 10,
    },
    topThesis: [
      '🔑 UNDER is the #1 play — two ground-ball aces (Fried 51.9% GB, Webb 50.5%), Oracle 0.93 PF, cold March, Bailey #1 framing',
      '🔑 Fried (LHP) SUPPRESSES SF top of order: Devers (L), Arraez (L) = same-side disadvantage on the best OBP guys',
      '🔑 F5 UNDER — almost entirely Fried vs Webb with no bullpen risk. Both aces in first-time-through-order dominance mode',
      '🔑 NRFI — Fried faces LHH leadoff (suppressed), Webb at home (dominant). Classic two-ace NRFI at pitcher park',
      '🔑 Webb Outs OVER — 200 IP workhorse, home park, cool weather = deep start is nearly automatic',
      '⚠️ ML is a COIN FLIP now — Fried elite (2.86 ERA) but new-team jitters + Webb-Bailey Oracle = near 50/50. Skip ML, bet totals/props.',
      '⚠️ Fried K props are LOWER range than Cole would be — 8.71 K/9 vs 11+ = look at 4.5-5.5 lines, not 7.5+',
      '💡 If DK still prices Fried K line at 6.5+ (holdover from Cole assumption), UNDER is a SMASH play',
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
    
    // Fried: 16.5, 17.5 range (shorter); Webb: 17.5, 18.5, 19.5 range (deeper)
    const lines = pitcher === 'Max Fried' ? [15.5, 16.5, 17.5] : [17.5, 18.5, 19.5];
    
    const lineAnalysis = lines.map(line => {
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
      projectedLine: pitcher === 'Max Fried' ? 16.5 : 18.5,
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
      starters: cachedAnalysis.game.starters.away.name + ' (LHP) vs ' + cachedAnalysis.game.starters.home.name + ' (RHP)',
      starterChange: '🚨 Fried (LHP) NOT Cole (RHP) — K rate drops from 11+ to 8.7, UNDER thesis strengthened',
      playCount: cachedAnalysis.bettingCard?.playCount || 0,
      topThesis: cachedAnalysis.bettingCard?.topThesis || [],
      portfolio: cachedAnalysis.bettingCard?.portfolio || {},
    };
  }
  
  return {
    cached: false,
    game: 'NYY @ SF',
    date: 'March 25, 2026 — 8:05 PM ET',
    starters: 'Max Fried (LHP) vs Logan Webb (RHP)',
    starterChange: '🚨 Rebuilt for Fried — was Cole. Different K rate, different platoon, different props.',
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
  SF_LINEUP_VS_LHP,
  SF_PLATOON_SUMMARY,
};
