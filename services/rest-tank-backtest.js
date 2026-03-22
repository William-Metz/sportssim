/**
 * NBA Rest/Tank Model Backtest Tracker — SportsSim v46.0
 * ======================================================
 * Records rest/tank model predictions for today's NBA games,
 * then grades them when results come in (next day).
 * 
 * This is CRITICAL for model validation — we need to prove the
 * rest/tank adjustments actually improve prediction accuracy
 * before the playoffs start.
 * 
 * Tracks:
 *   1. Model predicted spread (with rest/tank adjustment)
 *   2. Model predicted spread (without adjustment — baseline)
 *   3. Closing book spread
 *   4. Actual game result
 *   5. Whether the adjustment improved or hurt the prediction
 * 
 * Key metrics:
 *   - ATS (against-the-spread) hit rate WITH rest/tank adj
 *   - ATS hit rate WITHOUT (baseline model)
 *   - Average error improvement from rest/tank factors
 *   - Edge by motivation type (TANKING, RESTING, DESPERATE, etc.)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_FILE = path.join(__dirname, 'rest-tank-backtest-data.json');

// ==================== DATA PERSISTENCE ====================

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) { /* fresh start */ }
  return { predictions: [], graded: [], summary: null, lastUpdated: null };
}

function saveData(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ==================== RECORD TODAY'S PREDICTIONS ====================

/**
 * Record rest/tank predictions for today's games.
 * Call this once per day, before games start.
 * 
 * @param {Array} games — output from nbaRestTank.scanTodaysGames()
 * @param {Object} nbaModel — NBA model for baseline predictions
 * @param {Object} opts — { bookSpreads: { 'WAS@NYK': -12.5, ... } }
 */
function recordPredictions(games, nbaModel, opts = {}) {
  const data = loadData();
  const today = new Date().toISOString().split('T')[0];
  
  // Don't double-record
  const alreadyRecorded = data.predictions.filter(p => p.date === today);
  if (alreadyRecorded.length > 0) {
    return { status: 'already_recorded', date: today, count: alreadyRecorded.length };
  }
  
  const bookSpreads = opts.bookSpreads || {};
  const recorded = [];
  
  for (const game of (games.games || games)) {
    const awayAbbr = game.away?.abbr || game.awayTeam;
    const homeAbbr = game.home?.abbr || game.homeTeam;
    if (!awayAbbr || !homeAbbr) continue;
    
    // Get baseline prediction (no rest/tank adjustment)
    let baselinePred = null;
    try {
      baselinePred = nbaModel.predict(awayAbbr, homeAbbr);
    } catch (e) { /* model error */ }
    
    const baselineSpread = baselinePred?.spread || 0;
    
    // Rest/tank adjusted spread
    const restTankAdj = game.netSpreadAdj || 0;
    const adjustedSpread = baselineSpread + restTankAdj;
    
    // Book spread (if available)
    const gameKey = `${awayAbbr}@${homeAbbr}`;
    const bookSpread = bookSpreads[gameKey] || null;
    
    const prediction = {
      date: today,
      gameKey,
      away: awayAbbr,
      home: homeAbbr,
      gameTime: game.gameTime || null,
      // Baseline model (no rest/tank)
      baselineSpread: +baselineSpread.toFixed(1),
      baselineHomeWinProb: baselinePred?.homeWinProb || null,
      baselineTotalPoints: baselinePred?.totalPoints || null,
      // Rest/tank adjustment
      restTankAdj: +restTankAdj.toFixed(1),
      adjustedSpread: +adjustedSpread.toFixed(1),
      // Motivation details
      awayMotivation: game.away?.motivation?.motivation || 'UNKNOWN',
      homeMotivation: game.home?.motivation?.motivation || 'UNKNOWN',
      awayMotivationAdj: game.away?.motivationAdj || 0,
      homeMotivationAdj: game.home?.motivationAdj || 0,
      awayRestAdj: game.away?.restAdj || 0,
      homeRestAdj: game.home?.restAdj || 0,
      awayB2B: game.away?.rest?.isB2B || false,
      homeB2B: game.home?.rest?.isB2B || false,
      mismatchDetected: game.motivationMismatch?.detected || false,
      mismatchType: game.motivationMismatch?.type || null,
      // Book line
      bookSpread,
      // Result (filled in later)
      result: null,
      graded: false,
    };
    
    data.predictions.push(prediction);
    recorded.push(prediction);
  }
  
  saveData(data);
  
  return {
    status: 'recorded',
    date: today,
    count: recorded.length,
    predictions: recorded.map(p => ({
      game: p.gameKey,
      baseline: p.baselineSpread,
      restTankAdj: p.restTankAdj,
      adjusted: p.adjustedSpread,
      book: p.bookSpread,
      awayMotivation: p.awayMotivation,
      homeMotivation: p.homeMotivation,
      mismatch: p.mismatchDetected,
    })),
  };
}

// ==================== FETCH RESULTS & GRADE ====================

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Fetch NBA game results from ESPN and grade predictions.
 * Call this the day AFTER games are played.
 * 
 * @param {string} dateStr — date to grade (YYYYMMDD or YYYY-MM-DD)
 */
async function gradeResults(dateStr = null) {
  const data = loadData();
  
  if (!dateStr) {
    // Grade yesterday's games by default
    const yesterday = new Date(Date.now() - 86400000);
    dateStr = yesterday.toISOString().split('T')[0];
  }
  
  const normalDate = dateStr.replace(/-/g, '');
  const dashDate = dateStr.includes('-') ? dateStr : `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
  
  // Find ungraded predictions for this date
  const toGrade = data.predictions.filter(p => p.date === dashDate && !p.graded);
  if (toGrade.length === 0) {
    return { status: 'no_predictions', date: dashDate, note: 'No ungraded predictions for this date' };
  }
  
  // Fetch results from ESPN
  let results = {};
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${normalDate}`;
    const espnData = await fetchJSON(url);
    
    if (espnData.events) {
      for (const event of espnData.events) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        
        const awayComp = comp.competitors?.find(c => c.homeAway === 'away');
        const homeComp = comp.competitors?.find(c => c.homeAway === 'home');
        if (!awayComp || !homeComp) continue;
        
        const awayAbbr = awayComp.team?.abbreviation;
        const homeAbbr = homeComp.team?.abbreviation;
        const awayScore = parseInt(awayComp.score) || 0;
        const homeScore = parseInt(homeComp.score) || 0;
        const isFinal = comp.status?.type?.completed === true;
        
        if (isFinal && awayScore > 0 && homeScore > 0) {
          const key = `${awayAbbr}@${homeAbbr}`;
          results[key] = {
            awayScore,
            homeScore,
            margin: homeScore - awayScore, // positive = home won
            total: awayScore + homeScore,
          };
        }
      }
    }
  } catch (e) {
    return { status: 'espn_error', error: e.message };
  }
  
  if (Object.keys(results).length === 0) {
    return { status: 'no_results', date: dashDate, note: 'Games not final yet or no results found' };
  }
  
  // Grade each prediction
  const graded = [];
  
  for (const pred of toGrade) {
    const result = results[pred.gameKey];
    if (!result) continue;
    
    pred.result = result;
    pred.graded = true;
    
    // Calculate errors
    const actualMargin = result.margin; // positive = home won by X
    
    // Baseline error (model without rest/tank)
    const baselineError = Math.abs(actualMargin - pred.baselineSpread);
    
    // Adjusted error (model with rest/tank)
    const adjustedError = Math.abs(actualMargin - pred.adjustedSpread);
    
    // Did the rest/tank adjustment IMPROVE the prediction?
    const improvement = baselineError - adjustedError;
    
    // ATS grading (against a hypothetical -110 line at the adjusted spread)
    const atsResult = actualMargin > pred.adjustedSpread ? 'HOME_COVER' : 
                      actualMargin < pred.adjustedSpread ? 'AWAY_COVER' : 'PUSH';
    
    const grade = {
      gameKey: pred.gameKey,
      date: pred.date,
      actualMargin,
      actualTotal: result.total,
      baselineSpread: pred.baselineSpread,
      adjustedSpread: pred.adjustedSpread,
      restTankAdj: pred.restTankAdj,
      baselineError: +baselineError.toFixed(1),
      adjustedError: +adjustedError.toFixed(1),
      improvement: +improvement.toFixed(1),
      improved: improvement > 0,
      atsResult,
      awayMotivation: pred.awayMotivation,
      homeMotivation: pred.homeMotivation,
      mismatchDetected: pred.mismatchDetected,
      mismatchType: pred.mismatchType,
      awayB2B: pred.awayB2B,
      homeB2B: pred.homeB2B,
      bookSpread: pred.bookSpread,
      score: `${result.awayScore}-${result.homeScore}`,
    };
    
    // ATS vs book if available
    if (pred.bookSpread !== null) {
      grade.bookATS = actualMargin > pred.bookSpread ? 'HOME_COVER' : 
                      actualMargin < pred.bookSpread ? 'AWAY_COVER' : 'PUSH';
      grade.modelPickedRight = (pred.adjustedSpread > pred.bookSpread && actualMargin > pred.bookSpread) ||
                               (pred.adjustedSpread < pred.bookSpread && actualMargin < pred.bookSpread);
    }
    
    data.graded.push(grade);
    graded.push(grade);
  }
  
  // Update summary
  data.summary = calculateSummary(data);
  saveData(data);
  
  return {
    status: 'graded',
    date: dashDate,
    gamesGraded: graded.length,
    results: graded,
    summary: data.summary,
  };
}

// ==================== SUMMARY STATISTICS ====================

function calculateSummary(data) {
  const allGraded = data.graded;
  if (allGraded.length === 0) return null;
  
  const total = allGraded.length;
  
  // Overall improvement
  const improved = allGraded.filter(g => g.improved).length;
  const avgImprovement = allGraded.reduce((s, g) => s + g.improvement, 0) / total;
  const avgBaselineError = allGraded.reduce((s, g) => s + g.baselineError, 0) / total;
  const avgAdjustedError = allGraded.reduce((s, g) => s + g.adjustedError, 0) / total;
  
  // Breakdown by motivation type
  const byMotivation = {};
  for (const g of allGraded) {
    const key = `${g.awayMotivation}_vs_${g.homeMotivation}`;
    if (!byMotivation[key]) byMotivation[key] = { count: 0, improved: 0, totalImprovement: 0 };
    byMotivation[key].count++;
    if (g.improved) byMotivation[key].improved++;
    byMotivation[key].totalImprovement += g.improvement;
  }
  
  // Mismatch games
  const mismatchGames = allGraded.filter(g => g.mismatchDetected);
  const mismatchImproved = mismatchGames.filter(g => g.improved).length;
  const mismatchAvgImprovement = mismatchGames.length > 0 
    ? mismatchGames.reduce((s, g) => s + g.improvement, 0) / mismatchGames.length 
    : 0;
  
  // B2B impact
  const b2bGames = allGraded.filter(g => g.awayB2B || g.homeB2B);
  const b2bImproved = b2bGames.filter(g => g.improved).length;
  
  // ATS performance vs book
  const withBook = allGraded.filter(g => g.bookSpread !== null);
  const modelRight = withBook.filter(g => g.modelPickedRight).length;
  
  return {
    totalGames: total,
    // Error improvement
    improvedCount: improved,
    improvedPct: +((improved / total) * 100).toFixed(1),
    avgImprovement: +avgImprovement.toFixed(2),
    avgBaselineError: +avgBaselineError.toFixed(1),
    avgAdjustedError: +avgAdjustedError.toFixed(1),
    errorReductionPct: +((avgImprovement / avgBaselineError) * 100).toFixed(1),
    // Motivation mismatch edge
    mismatchGames: mismatchGames.length,
    mismatchImproved: mismatchImproved,
    mismatchImprovedPct: mismatchGames.length > 0 ? +((mismatchImproved / mismatchGames.length) * 100).toFixed(1) : 0,
    mismatchAvgImprovement: +mismatchAvgImprovement.toFixed(2),
    // B2B edge
    b2bGames: b2bGames.length,
    b2bImproved: b2bImproved,
    b2bImprovedPct: b2bGames.length > 0 ? +((b2bImproved / b2bGames.length) * 100).toFixed(1) : 0,
    // ATS vs book
    booksCompared: withBook.length,
    modelATSHitRate: withBook.length > 0 ? +((modelRight / withBook.length) * 100).toFixed(1) : null,
    // By motivation type
    byMotivation: Object.entries(byMotivation).map(([key, val]) => ({
      matchup: key,
      games: val.count,
      improved: val.improved,
      avgImprovement: +(val.totalImprovement / val.count).toFixed(2),
    })).sort((a, b) => b.avgImprovement - a.avgImprovement),
    // Dates covered
    dates: [...new Set(allGraded.map(g => g.date))].sort(),
    lastGraded: allGraded[allGraded.length - 1]?.date || null,
  };
}

// ==================== GET STATUS ====================

function getStatus() {
  const data = loadData();
  return {
    service: 'rest-tank-backtest',
    version: '1.0',
    totalPredictions: data.predictions.length,
    ungradedPredictions: data.predictions.filter(p => !p.graded).length,
    gradedGames: data.graded.length,
    summary: data.summary,
    lastUpdated: data.lastUpdated,
  };
}

function getAllPredictions() {
  return loadData().predictions;
}

function getAllGraded() {
  return loadData().graded;
}

module.exports = {
  recordPredictions,
  gradeResults,
  calculateSummary,
  getStatus,
  getAllPredictions,
  getAllGraded,
};
