/**
 * NBA Rest/Tank Backtest Grader — SportsSim v101.0
 * =================================================
 * Grade March 23 rest/tank model predictions with actual game results.
 * Pull real scores from ESPN and measure model accuracy.
 * 
 * KEY VALIDATION: Does the rest/tank adjustment improve ATS accuracy?
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, 'rest-tank-graded-results.json');

// ==================== ESPN DATA ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchNBAScores(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
  const data = await fetchJSON(url);
  const games = [];
  
  for (const event of (data.events || [])) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    
    const teams = comp.competitors || [];
    const away = teams.find(t => t.homeAway === 'away');
    const home = teams.find(t => t.homeAway === 'home');
    if (!away || !home) continue;
    
    const status = event.status?.type?.name;
    if (status !== 'STATUS_FINAL') continue; // Only grade final games
    
    games.push({
      away: away.team?.abbreviation?.toUpperCase(),
      home: home.team?.abbreviation?.toUpperCase(),
      awayScore: parseInt(away.score) || 0,
      homeScore: parseInt(home.score) || 0,
      margin: (parseInt(home.score) || 0) - (parseInt(away.score) || 0), // positive = home won
    });
  }
  
  return games;
}

// ==================== MARCH 23 MODEL PREDICTIONS ====================

// These are the model predictions from the rest/tank scan
// Captured from task 093 notes and previous session context
const MARCH_23_PREDICTIONS = [
  {
    away: 'LAL', home: 'DET', date: '2026-03-23',
    awayMotivation: 'COASTING', homeMotivation: 'RESTING',
    baselineSpread: -5.4, // DET favored by 5.4 (negative = home fav)
    restTankAdj: { away: -0.5, home: -1.5 }, // COASTING: -0.5, RESTING: -1.5 (DET depth)
    adjustedSpread: -4.4, // Net: DET fav reduced because they're resting
    b2b: { away: false, home: false },
  },
  {
    away: 'IND', home: 'ORL', date: '2026-03-23',
    awayMotivation: 'TANKING', homeMotivation: 'DESPERATE',
    baselineSpread: -18.2, // ORL favored
    restTankAdj: { away: -2.5, home: 1.0 }, // TANKING: -2.5, DESPERATE: +1.0
    adjustedSpread: -21.7, // ORL even more favored with motivation
    b2b: { away: true, home: false },
  },
  {
    away: 'OKC', home: 'PHI', date: '2026-03-23',
    awayMotivation: 'RESTING', homeMotivation: 'DESPERATE',
    baselineSpread: 15.6, // OKC favored on road (positive = away fav)
    restTankAdj: { away: -1.5, home: 1.0 }, // RESTING: -1.5, DESPERATE: +1.0
    adjustedSpread: 13.1, // OKC still favored but less so
    b2b: { away: false, home: true },
  },
  {
    away: 'SA', home: 'MIA', date: '2026-03-23',
    awayMotivation: 'RESTING', homeMotivation: 'DESPERATE',
    baselineSpread: 2.6, // SAS favored on road
    restTankAdj: { away: -1.5, home: 1.0 }, // RESTING: -1.5, DESPERATE: +1.0  
    adjustedSpread: 0.1, // Should be close to pick'em with adjustments
    b2b: { away: true, home: true },
  },
  {
    away: 'MEM', home: 'ATL', date: '2026-03-23',
    awayMotivation: 'REBUILDING', homeMotivation: 'COMPETING',
    baselineSpread: -15.1, // ATL favored
    restTankAdj: { away: -1.5, home: 0.5 },
    adjustedSpread: -17.1,
    b2b: { away: false, home: false },
  },
  {
    away: 'HOU', home: 'CHI', date: '2026-03-23',
    awayMotivation: 'COASTING', homeMotivation: 'COMPETING',
    baselineSpread: 6.6, // HOU favored
    restTankAdj: { away: -0.5, home: 0.5 },
    adjustedSpread: 5.6,
    b2b: { away: false, home: false },
  },
];

// ==================== GRADING ====================

async function gradeResults() {
  console.log('[RestTank Grader] Fetching March 23 NBA scores...');
  const scores = await fetchNBAScores('20260323');
  
  if (scores.length === 0) {
    return { error: 'No final scores found for March 23' };
  }
  
  const graded = [];
  
  for (const pred of MARCH_23_PREDICTIONS) {
    const score = scores.find(s => s.away === pred.away && s.home === pred.home);
    if (!score) {
      graded.push({ ...pred, status: 'NO_SCORE', note: 'Game not found in ESPN data' });
      continue;
    }
    
    const actualMargin = score.margin; // positive = home won
    const awayWon = score.awayScore > score.homeScore;
    
    // Spread is positive when away team is favored
    // actualMargin is positive when home won
    // If baseline spread is -18 (home fav by 18), and actual margin is -2 (away won by 2), 
    // then away covered by 16 points
    
    const baselineError = Math.abs(pred.baselineSpread - actualMargin);
    const adjustedError = Math.abs(pred.adjustedSpread - actualMargin);
    const adjustmentHelped = adjustedError < baselineError;
    const improvement = baselineError - adjustedError;
    
    graded.push({
      matchup: `${pred.away}@${pred.home}`,
      awayMotivation: pred.awayMotivation,
      homeMotivation: pred.homeMotivation,
      b2b: pred.b2b,
      score: `${score.awayScore}-${score.homeScore}`,
      winner: awayWon ? pred.away : pred.home,
      actualMargin: actualMargin,
      baselineSpread: pred.baselineSpread,
      adjustedSpread: pred.adjustedSpread,
      baselineError: +baselineError.toFixed(1),
      adjustedError: +adjustedError.toFixed(1),
      improvement: +improvement.toFixed(1),
      adjustmentHelped,
      status: 'GRADED',
    });
  }
  
  // Summary statistics
  const gradedGames = graded.filter(g => g.status === 'GRADED');
  const helped = gradedGames.filter(g => g.adjustmentHelped);
  const avgBaselineError = gradedGames.reduce((s, g) => s + g.baselineError, 0) / gradedGames.length;
  const avgAdjustedError = gradedGames.reduce((s, g) => s + g.adjustedError, 0) / gradedGames.length;
  const avgImprovement = gradedGames.reduce((s, g) => s + g.improvement, 0) / gradedGames.length;
  
  // By motivation type
  const byMotivation = {};
  for (const g of gradedGames) {
    for (const side of ['away', 'home']) {
      const mot = side === 'away' ? g.awayMotivation : g.homeMotivation;
      if (!byMotivation[mot]) byMotivation[mot] = { games: 0, totalImprovement: 0, helped: 0 };
      byMotivation[mot].games++;
    }
  }
  
  const summary = {
    date: '2026-03-23',
    gamesGraded: gradedGames.length,
    adjustmentHelped: helped.length,
    adjustmentHurt: gradedGames.length - helped.length,
    helpRate: +(helped.length / gradedGames.length * 100).toFixed(1),
    avgBaselineError: +avgBaselineError.toFixed(1),
    avgAdjustedError: +avgAdjustedError.toFixed(1),
    avgImprovement: +avgImprovement.toFixed(1),
    verdict: avgImprovement > 0 ? 'ADJUSTMENT HELPS' : 'ADJUSTMENT HURTS',
  };
  
  const result = {
    generatedAt: new Date().toISOString(),
    summary,
    games: graded,
    byMotivation,
    insights: generateInsights(graded),
  };
  
  // Save results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(result, null, 2));
  
  return result;
}

function generateInsights(graded) {
  const insights = [];
  const gradedGames = graded.filter(g => g.status === 'GRADED');
  
  // Check RESTING teams
  const restingGames = gradedGames.filter(g => g.awayMotivation === 'RESTING' || g.homeMotivation === 'RESTING');
  if (restingGames.length > 0) {
    const restingPerf = restingGames.map(g => {
      const isAway = g.awayMotivation === 'RESTING';
      const restingTeam = isAway ? g.matchup.split('@')[0] : g.matchup.split('@')[1];
      const margin = g.actualMargin;
      const restingWon = (isAway && margin < 0) || (!isAway && margin > 0);
      return { team: restingTeam, won: restingWon, margin: isAway ? -margin : margin, game: g };
    });
    
    const restingWins = restingPerf.filter(r => r.won).length;
    insights.push({
      type: 'RESTING',
      finding: `RESTING teams went ${restingWins}/${restingGames.length} (${(restingWins/restingGames.length*100).toFixed(0)}% win rate)`,
      detail: restingPerf.map(r => `${r.team}: ${r.won ? 'WON' : 'LOST'} by ${Math.abs(r.margin)}`).join(', '),
      implication: restingWins > restingGames.length / 2 
        ? 'Elite teams too deep — RESTING adj should be SMALLER (reduce penalty)'
        : 'RESTING adj correctly penalizes these teams',
    });
  }
  
  // Check TANKING teams
  const tankingGames = gradedGames.filter(g => g.awayMotivation === 'TANKING' || g.homeMotivation === 'TANKING');
  if (tankingGames.length > 0) {
    const tankPerf = tankingGames.map(g => {
      const isAway = g.awayMotivation === 'TANKING';
      const tankingTeam = isAway ? g.matchup.split('@')[0] : g.matchup.split('@')[1];
      const margin = g.actualMargin;
      const tankingWon = (isAway && margin < 0) || (!isAway && margin > 0);
      return { team: tankingTeam, won: tankingWon, margin: isAway ? -margin : margin };
    });
    
    insights.push({
      type: 'TANKING',
      finding: `TANKING teams: ${tankPerf.map(t => `${t.team} ${t.won ? 'WON' : 'LOST'} by ${Math.abs(t.margin)}`).join(', ')}`,
      implication: 'Tanking teams occasionally win — model correctly applies modest penalty',
    });
  }
  
  // Check DESPERATE teams
  const desperateGames = gradedGames.filter(g => g.awayMotivation === 'DESPERATE' || g.homeMotivation === 'DESPERATE');
  if (desperateGames.length > 0) {
    const despPerf = desperateGames.map(g => {
      const isAway = g.awayMotivation === 'DESPERATE';
      const despTeam = isAway ? g.matchup.split('@')[0] : g.matchup.split('@')[1];
      const margin = g.actualMargin;
      const despWon = (isAway && margin < 0) || (!isAway && margin > 0);
      return { team: despTeam, won: despWon, margin: isAway ? -margin : margin };
    });
    
    const despWins = despPerf.filter(d => d.won).length;
    insights.push({
      type: 'DESPERATE',
      finding: `DESPERATE teams went ${despWins}/${desperateGames.length}`,
      detail: despPerf.map(d => `${d.team}: ${d.won ? 'WON' : 'LOST'} by ${Math.abs(d.margin)}`).join(', '),
      implication: despWins > desperateGames.length / 2 
        ? 'DESPERATE adj validated — these teams play harder'
        : 'DESPERATE adj may be too generous — effort alone doesn\'t win games',
    });
  }
  
  return insights;
}

// ==================== API HANDLER ====================

async function handleRequest(req, res) {
  try {
    const result = await gradeResults();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function getLatestResults() {
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    }
  } catch (e) { /* fresh */ }
  return null;
}

module.exports = {
  gradeResults,
  handleRequest,
  getLatestResults,
};
