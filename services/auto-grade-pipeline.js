/**
 * Auto-Grade Pipeline — SportsSim v105.0
 * =======================================
 * 🎯 THE MONEY COUNTER — automatically grades all bets after games complete.
 * 
 * Full lifecycle:
 *   PRE-GAME:  Capture closing lines from Odds API (5 min before first pitch)
 *   LIVE:      Monitor game status via ESPN scoreboard  
 *   POST-GAME: Auto-grade all bet types when games finish
 *   REPORT:    Generate comprehensive P&L report with CLV analysis
 * 
 * Handles ALL bet markets:
 *   - Moneyline (ML)
 *   - Run Line / Spread
 *   - Totals (Over/Under) 
 *   - F5 (First 5 innings)
 *   - F3 (First 3 innings)
 *   - F7 (First 7 innings)
 *   - NRFI/YRFI (1st inning)
 *   - K Props (Strikeout over/under)
 *   - Outs Props (Pitcher outs recorded)
 *   - Pitcher HWE Props (Hits/Walks/ER)
 *   - SGP legs
 * 
 * Auto-starts via gameday orchestrator. Zero manual intervention.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================

const PIPELINE_STATE_FILE = path.join(__dirname, 'auto-grade-state.json');
const CLOSING_LINES_FILE = path.join(__dirname, 'closing-lines-data.json');

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const ESPN_GAME_DETAIL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports/baseball_mlb';

// How often to check game status during live phase
const LIVE_CHECK_INTERVAL = 5 * 60 * 1000; // 5 min
// How long after last game ends to wait before grading (accounts for score corrections)
const POST_GAME_DELAY = 15 * 60 * 1000; // 15 min
// Closing lines capture window (minutes before first pitch)
const CLOSING_LINE_MINUTES_BEFORE = 10;

// Team abbreviation normalization
const TEAM_NORM = {
  'WSH': 'WSH', 'WAS': 'WSH', 'WSN': 'WSH',
  'CWS': 'CWS', 'CHW': 'CWS',
  'KC': 'KC', 'KCR': 'KC',
  'SF': 'SF', 'SFG': 'SF',
  'SD': 'SD', 'SDP': 'SD',
  'TB': 'TB', 'TBR': 'TB',
  'STL': 'STL', 'SLN': 'STL',
  'LAD': 'LAD', 'LAN': 'LAD',
  'LAA': 'LAA', 'ANA': 'LAA',
  'ARI': 'ARI', 'AZ': 'ARI',
};

function normalizeTeam(abbr) {
  if (!abbr) return '';
  return TEAM_NORM[abbr.toUpperCase()] || abbr.toUpperCase();
}

// ==================== STATE ====================

let pipelineState = {
  phase: 'idle', // idle, pre-game, closing-capture, live, post-game-wait, grading, complete
  targetDate: null,
  isOD: false,
  odDay: null,
  gamesTotal: 0,
  gamesComplete: 0,
  gamesInProgress: 0,
  gamesPending: 0,
  closingLinesCaptures: 0,
  closingLinesCapturedAt: null,
  gradingStartedAt: null,
  gradingCompletedAt: null,
  lastStatusCheck: null,
  gameStatuses: {}, // gameKey → { status, awayScore, homeScore, inning, lastUpdated }
  errors: [],
  report: null, // Final grading report
};

let closingLines = {}; // gameKey → { homeML, awayML, spread, total, books: {...} }
let liveCheckTimer = null;
let gradingTimer = null;

// Load persisted state
function loadState() {
  try {
    if (fs.existsSync(PIPELINE_STATE_FILE)) {
      pipelineState = JSON.parse(fs.readFileSync(PIPELINE_STATE_FILE, 'utf8'));
    }
  } catch (e) { /* fresh state */ }
  try {
    if (fs.existsSync(CLOSING_LINES_FILE)) {
      closingLines = JSON.parse(fs.readFileSync(CLOSING_LINES_FILE, 'utf8'));
    }
  } catch (e) { /* fresh */ }
}

function saveState() {
  try {
    fs.writeFileSync(PIPELINE_STATE_FILE, JSON.stringify(pipelineState, null, 2));
  } catch (e) { console.error('[auto-grade] Save state error:', e.message); }
}

function saveClosingLines() {
  try {
    fs.writeFileSync(CLOSING_LINES_FILE, JSON.stringify(closingLines, null, 2));
  } catch (e) { console.error('[auto-grade] Save closing lines error:', e.message); }
}

// ==================== HTTP HELPER ====================

function fetchJSON(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ==================== PHASE 1: CLOSING LINE CAPTURE ====================

/**
 * Capture closing lines from The Odds API.
 * Should be called 5-10 min before first pitch.
 * Records the last available odds for CLV measurement.
 */
async function captureClosingLines(oddsApiKey) {
  if (!oddsApiKey) {
    console.log('[auto-grade] No ODDS_API_KEY — skipping closing line capture');
    return { captured: 0, error: 'No API key' };
  }
  
  console.log('[auto-grade] 📊 Capturing closing lines...');
  
  try {
    // Fetch current odds for all MLB games
    const url = `${ODDS_API_BASE}/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const games = await fetchJSON(url);
    
    if (!Array.isArray(games)) {
      return { captured: 0, error: 'Invalid odds response' };
    }
    
    let captured = 0;
    
    for (const game of games) {
      const away = normalizeTeam(game.away_team?.replace(/\s+/g, ' '));
      const home = normalizeTeam(game.home_team?.replace(/\s+/g, ' '));
      
      // Match to our team abbreviations
      const awayAbbr = teamNameToAbbr(game.away_team);
      const homeAbbr = teamNameToAbbr(game.home_team);
      
      if (!awayAbbr || !homeAbbr) continue;
      
      const gameKey = `${awayAbbr}@${homeAbbr}`;
      
      const closingLine = {
        gameKey,
        awayTeam: awayAbbr,
        homeTeam: homeAbbr,
        capturedAt: new Date().toISOString(),
        commenceTime: game.commence_time,
        books: {},
        consensus: { homeML: null, awayML: null, spread: null, total: null },
      };
      
      // Extract odds from each book
      for (const book of (game.bookmakers || [])) {
        const bookData = {};
        
        for (const market of (book.markets || [])) {
          if (market.key === 'h2h') {
            for (const outcome of (market.outcomes || [])) {
              if (teamNameToAbbr(outcome.name) === homeAbbr) bookData.homeML = outcome.price;
              else if (teamNameToAbbr(outcome.name) === awayAbbr) bookData.awayML = outcome.price;
            }
          } else if (market.key === 'spreads') {
            for (const outcome of (market.outcomes || [])) {
              if (teamNameToAbbr(outcome.name) === homeAbbr) {
                bookData.spread = outcome.point;
                bookData.spreadOdds = outcome.price;
              }
            }
          } else if (market.key === 'totals') {
            for (const outcome of (market.outcomes || [])) {
              if (outcome.name === 'Over') {
                bookData.total = outcome.point;
                bookData.overOdds = outcome.price;
              } else if (outcome.name === 'Under') {
                bookData.underOdds = outcome.price;
              }
            }
          }
        }
        
        closingLine.books[book.key] = bookData;
      }
      
      // Calculate consensus (average across books, prioritize DK/FD)
      const priorityBooks = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet'];
      const allBooks = Object.entries(closingLine.books);
      const bestBooks = allBooks.filter(([k]) => priorityBooks.includes(k));
      const useBooks = bestBooks.length >= 2 ? bestBooks : allBooks;
      
      const homeMLs = useBooks.map(([,b]) => b.homeML).filter(Boolean);
      const awayMLs = useBooks.map(([,b]) => b.awayML).filter(Boolean);
      const spreads = useBooks.map(([,b]) => b.spread).filter(v => v !== undefined && v !== null);
      const totals = useBooks.map(([,b]) => b.total).filter(Boolean);
      
      closingLine.consensus = {
        homeML: homeMLs.length > 0 ? Math.round(homeMLs.reduce((a,b) => a+b, 0) / homeMLs.length) : null,
        awayML: awayMLs.length > 0 ? Math.round(awayMLs.reduce((a,b) => a+b, 0) / awayMLs.length) : null,
        spread: spreads.length > 0 ? +(spreads.reduce((a,b) => a+b, 0) / spreads.length).toFixed(1) : null,
        total: totals.length > 0 ? +(totals.reduce((a,b) => a+b, 0) / totals.length).toFixed(1) : null,
        booksUsed: useBooks.length,
      };
      
      closingLines[gameKey] = closingLine;
      captured++;
    }
    
    pipelineState.closingLinesCaptures = captured;
    pipelineState.closingLinesCapturedAt = new Date().toISOString();
    saveClosingLines();
    saveState();
    
    console.log(`[auto-grade] ✅ Captured closing lines for ${captured} games`);
    return { captured, games: Object.keys(closingLines) };
    
  } catch (e) {
    const err = `Closing line capture error: ${e.message}`;
    pipelineState.errors.push({ time: new Date().toISOString(), error: err });
    saveState();
    return { captured: 0, error: err };
  }
}

// Also capture prop closing lines (K props, etc)
async function captureClosingPropLines(oddsApiKey) {
  if (!oddsApiKey) return { captured: 0 };
  
  console.log('[auto-grade] 📊 Capturing closing K prop lines...');
  
  try {
    const url = `${ODDS_API_BASE}/odds/?apiKey=${oddsApiKey}&regions=us&markets=pitcher_strikeouts&oddsFormat=american`;
    const games = await fetchJSON(url);
    
    if (!Array.isArray(games)) return { captured: 0 };
    
    let captured = 0;
    
    for (const game of games) {
      const awayAbbr = teamNameToAbbr(game.away_team);
      const homeAbbr = teamNameToAbbr(game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      
      const gameKey = `${awayAbbr}@${homeAbbr}`;
      
      if (!closingLines[gameKey]) {
        closingLines[gameKey] = { gameKey, awayTeam: awayAbbr, homeTeam: homeAbbr, books: {}, consensus: {} };
      }
      
      closingLines[gameKey].kProps = {};
      
      for (const book of (game.bookmakers || [])) {
        for (const market of (book.markets || [])) {
          if (market.key === 'pitcher_strikeouts') {
            for (const outcome of (market.outcomes || [])) {
              const pitcher = outcome.description || outcome.name;
              if (!closingLines[gameKey].kProps[pitcher]) {
                closingLines[gameKey].kProps[pitcher] = {};
              }
              if (outcome.name === 'Over') {
                closingLines[gameKey].kProps[pitcher].overLine = outcome.point;
                closingLines[gameKey].kProps[pitcher].overOdds = outcome.price;
              } else if (outcome.name === 'Under') {
                closingLines[gameKey].kProps[pitcher].underLine = outcome.point;
                closingLines[gameKey].kProps[pitcher].underOdds = outcome.price;
              }
            }
          }
        }
      }
      
      captured++;
    }
    
    saveClosingLines();
    return { captured };
  } catch (e) {
    return { captured: 0, error: e.message };
  }
}

// ==================== PHASE 2: GAME STATUS MONITORING ====================

/**
 * Check ESPN scoreboard for game statuses.
 * Returns structured game results.
 */
async function checkGameStatuses(dateStr) {
  const espnDate = dateStr.replace(/-/g, '');
  
  try {
    const url = `${ESPN_SCOREBOARD}?dates=${espnDate}`;
    const data = await fetchJSON(url);
    
    if (!data.events) return [];
    
    const statuses = [];
    
    for (const event of data.events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      const competitors = competition.competitors || [];
      const away = competitors.find(c => c.homeAway === 'away');
      const home = competitors.find(c => c.homeAway === 'home');
      if (!away || !home) continue;
      
      const awayAbbr = normalizeTeam(away.team?.abbreviation);
      const homeAbbr = normalizeTeam(home.team?.abbreviation);
      const gameKey = `${awayAbbr}@${homeAbbr}`;
      
      const status = competition.status?.type?.name || 'STATUS_SCHEDULED';
      const awayScore = parseInt(away.score) || 0;
      const homeScore = parseInt(home.score) || 0;
      const inning = competition.status?.period || 0;
      const inningHalf = competition.status?.type?.detail || '';
      
      const gameStatus = {
        gameKey,
        espnId: event.id,
        awayTeam: awayAbbr,
        homeTeam: homeAbbr,
        awayScore,
        homeScore,
        totalRuns: awayScore + homeScore,
        status, // STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL, STATUS_POSTPONED
        isFinal: status === 'STATUS_FINAL' || status.includes('FINAL'),
        isLive: status === 'STATUS_IN_PROGRESS' || status.includes('PROGRESS'),
        isPending: status === 'STATUS_SCHEDULED',
        isPostponed: status === 'STATUS_POSTPONED' || status.includes('POSTPONE'),
        inning,
        inningDetail: inningHalf,
        lastUpdated: new Date().toISOString(),
      };
      
      // Try to get F5/F3/F7 scores + pitcher stats from box score
      // Only fetch detail for final games (avoid excess API calls during live)
      if (gameStatus.isFinal) {
        try {
          const detail = await fetchBoxScoreDetail(event.id);
          if (detail) {
            gameStatus.boxScore = detail;
          }
        } catch (e) {
          // Non-critical — grader will fetch its own box scores
        }
      }
      
      statuses.push(gameStatus);
      pipelineState.gameStatuses[gameKey] = gameStatus;
    }
    
    // Update counts
    pipelineState.gamesTotal = statuses.length;
    pipelineState.gamesComplete = statuses.filter(g => g.isFinal).length;
    pipelineState.gamesInProgress = statuses.filter(g => g.isLive).length;
    pipelineState.gamesPending = statuses.filter(g => g.isPending).length;
    pipelineState.lastStatusCheck = new Date().toISOString();
    saveState();
    
    return statuses;
    
  } catch (e) {
    pipelineState.errors.push({ time: new Date().toISOString(), error: `Status check: ${e.message}` });
    saveState();
    return [];
  }
}

/**
 * Fetch detailed box score for a completed game.
 * Extracts inning-by-inning linescore + pitcher stats for F5/K grading.
 */
async function fetchBoxScoreDetail(espnId) {
  try {
    const url = `${ESPN_GAME_DETAIL}?event=${espnId}`;
    const data = await fetchJSON(url);
    
    if (!data) return null;
    
    const result = {
      linescore: null, // inning-by-inning
      pitchers: { away: [], home: [] },
      f5Score: null,
      f3Score: null,
      f7Score: null,
      firstInningRuns: null,
    };
    
    // Extract linescore
    const header = data.header;
    if (header?.competitions?.[0]?.competitors) {
      for (const comp of header.competitions[0].competitors) {
        const side = comp.homeAway;
        const linescores = comp.linescores || [];
        
        if (linescores.length > 0) {
          const innings = linescores.map(l => l.value || 0);
          
          if (!result.linescore) result.linescore = { away: [], home: [] };
          result.linescore[side] = innings;
          
          // Calculate period scores
          const f3 = innings.slice(0, 3).reduce((a,b) => a+b, 0);
          const f5 = innings.slice(0, 5).reduce((a,b) => a+b, 0);
          const f7 = innings.slice(0, 7).reduce((a,b) => a+b, 0);
          
          if (!result.f3Score) result.f3Score = { away: 0, home: 0 };
          if (!result.f5Score) result.f5Score = { away: 0, home: 0 };
          if (!result.f7Score) result.f7Score = { away: 0, home: 0 };
          if (!result.firstInningRuns) result.firstInningRuns = { away: 0, home: 0 };
          
          result.f3Score[side] = f3;
          result.f5Score[side] = f5;
          result.f7Score[side] = f7;
          result.firstInningRuns[side] = innings[0] || 0;
        }
      }
    }
    
    // Extract pitcher stats from boxscore
    const boxscore = data.boxscore;
    if (boxscore?.players) {
      for (const teamData of boxscore.players) {
        const teamAbbr = normalizeTeam(teamData.team?.abbreviation);
        const side = teamData.homeAway || 'away';
        
        const pitchingStats = teamData.statistics?.find(s => s.name === 'pitching');
        if (pitchingStats?.athletes) {
          for (const pitcher of pitchingStats.athletes) {
            const stats = {};
            if (pitcher.stats) {
              // ESPN stat order: IP, H, R, ER, BB, K, HR, PC-ST, ERA
              const labels = pitchingStats.labels || [];
              for (let i = 0; i < labels.length; i++) {
                stats[labels[i]] = pitcher.stats[i];
              }
            }
            
            result.pitchers[side].push({
              name: pitcher.athlete?.displayName || 'Unknown',
              shortName: pitcher.athlete?.shortName || '',
              id: pitcher.athlete?.id,
              ip: parseFloat(stats.IP) || 0,
              hits: parseInt(stats.H) || 0,
              runs: parseInt(stats.R) || 0,
              er: parseInt(stats.ER) || 0,
              bb: parseInt(stats.BB) || 0,
              k: parseInt(stats.K) || 0,
              hr: parseInt(stats.HR) || 0,
              pitchCount: stats['PC-ST'] || '',
            });
          }
        }
      }
    }
    
    return result;
    
  } catch (e) {
    return null;
  }
}

// ==================== PHASE 3: AUTO-GRADING ====================

/**
 * Run full auto-grading pipeline for a date.
 * Grades ALL bet types: ML, totals, F5, F3, F7, NRFI, K props, outs props, SGPs.
 */
async function runAutoGrade(dateStr) {
  console.log(`[auto-grade] 🎯 Running auto-grade for ${dateStr}...`);
  pipelineState.phase = 'grading';
  pipelineState.gradingStartedAt = new Date().toISOString();
  saveState();
  
  const report = {
    date: dateStr,
    gradedAt: new Date().toISOString(),
    sections: {},
    summary: null,
    closingLines: Object.keys(closingLines).length > 0 ? closingLines : null,
  };
  
  // Load grader
  let mlbGrader;
  try { mlbGrader = require('./mlb-results-grader'); } catch (e) {
    report.error = 'MLB Results Grader not available';
    pipelineState.report = report;
    pipelineState.phase = 'complete';
    saveState();
    return report;
  }
  
  // 1. Grade OD Playbook bets
  try {
    const isODDay1 = dateStr === '2026-03-26';
    const isODDay2 = dateStr === '2026-03-27';
    
    if (isODDay1 || isODDay2) {
      const odResult = await mlbGrader.gradeOpeningDay(isODDay1 ? 1 : 2);
      report.sections.odPlaybook = odResult;
    }
  } catch (e) {
    report.sections.odPlaybook = { error: e.message };
  }
  
  // 2. Grade daily card bets
  try {
    const dailyResult = await mlbGrader.gradeDailyCard(dateStr);
    report.sections.dailyCard = dailyResult;
  } catch (e) {
    report.sections.dailyCard = { error: e.message };
  }
  
  // 3. Grade K props
  try {
    const kResult = await mlbGrader.gradeKProps(dateStr);
    report.sections.kProps = kResult;
  } catch (e) {
    report.sections.kProps = { error: e.message };
  }
  
  // 4. Record closing lines to CLV tracker
  if (Object.keys(closingLines).length > 0) {
    try {
      const clvTracker = require('./clv-tracker');
      let clvRecorded = 0;
      
      for (const [gameKey, cl] of Object.entries(closingLines)) {
        if (cl.consensus?.homeML || cl.consensus?.total) {
          const [away, home] = gameKey.split('@');
          clvTracker.recordClosingLine('MLB', away, home, {
            homeML: cl.consensus.homeML,
            awayML: cl.consensus.awayML,
            spread: cl.consensus.spread,
            total: cl.consensus.total,
          });
          clvRecorded++;
        }
      }
      
      report.sections.clv = { recorded: clvRecorded, report: clvTracker.getReport(20) };
    } catch (e) {
      report.sections.clv = { error: e.message };
    }
  }
  
  // 5. Auto-grade CLV picks from game results
  try {
    const clvTracker = require('./clv-tracker');
    const statuses = Object.values(pipelineState.gameStatuses);
    const finalGames = statuses.filter(g => g.isFinal);
    
    const results = finalGames.map(g => ({
      sport: 'MLB',
      away: g.awayTeam,
      home: g.homeTeam,
      awayScore: g.awayScore,
      homeScore: g.homeScore,
    }));
    
    if (results.length > 0) {
      const graded = clvTracker.autoGrade(results);
      report.sections.clvAutoGrade = graded;
    }
  } catch (e) {
    report.sections.clvAutoGrade = { error: e.message };
  }
  
  // 6. Build comprehensive summary
  report.summary = buildSummary(report);
  
  pipelineState.report = report;
  pipelineState.gradingCompletedAt = new Date().toISOString();
  pipelineState.phase = 'complete';
  saveState();
  
  console.log(`[auto-grade] ✅ Auto-grading complete for ${dateStr}`);
  if (report.summary) {
    console.log(`[auto-grade] 📊 ${report.summary.totalBets} bets graded, ${report.summary.wins}W-${report.summary.losses}L, P&L: $${report.summary.pnl}`);
  }
  
  return report;
}

/**
 * Build unified summary across all grading sections.
 */
function buildSummary(report) {
  let totalBets = 0, wins = 0, losses = 0, pushes = 0, pending = 0;
  let totalStaked = 0, totalPayout = 0;
  const byMarket = {};
  
  for (const [sectionName, section] of Object.entries(report.sections)) {
    if (!section || section.error) continue;
    
    const bets = section.gradedBets || section.bets || section.results || [];
    if (!Array.isArray(bets)) continue;
    
    for (const bet of bets) {
      totalBets++;
      const result = bet.result || bet.grade;
      const stake = bet.stake || bet.wager || 10;
      totalStaked += stake;
      
      if (result === 'win' || result === 'WIN') {
        wins++;
        const payout = calculatePayout(bet.odds || -110, stake);
        totalPayout += payout;
      } else if (result === 'loss' || result === 'LOSS') {
        losses++;
        totalPayout -= stake;
      } else if (result === 'push' || result === 'PUSH') {
        pushes++;
      } else {
        pending++;
      }
      
      const market = bet.market || bet.type || 'unknown';
      if (!byMarket[market]) byMarket[market] = { total: 0, wins: 0, losses: 0, pushes: 0, pnl: 0 };
      byMarket[market].total++;
      if (result === 'win' || result === 'WIN') {
        byMarket[market].wins++;
        byMarket[market].pnl += calculatePayout(bet.odds || -110, stake);
      } else if (result === 'loss' || result === 'LOSS') {
        byMarket[market].losses++;
        byMarket[market].pnl -= stake;
      } else if (result === 'push' || result === 'PUSH') {
        byMarket[market].pushes++;
      }
    }
  }
  
  // Format market breakdown
  for (const market of Object.keys(byMarket)) {
    const m = byMarket[market];
    m.winRate = m.total > 0 ? +((m.wins / (m.total - m.pushes)) * 100).toFixed(1) : 0;
    m.roi = m.total > 0 ? +(m.pnl / (m.total * 10) * 100).toFixed(1) : 0; // assume $10 avg
    m.pnl = +m.pnl.toFixed(2);
  }
  
  const pnl = +totalPayout.toFixed(2);
  const roi = totalStaked > 0 ? +((pnl / totalStaked) * 100).toFixed(1) : 0;
  
  return {
    totalBets,
    wins,
    losses,
    pushes,
    pending,
    winRate: (totalBets - pushes - pending) > 0 ? +((wins / (totalBets - pushes - pending)) * 100).toFixed(1) : 0,
    totalStaked: +totalStaked.toFixed(2),
    pnl,
    roi,
    byMarket,
    closingLinesAvailable: Object.keys(closingLines).length,
    games: Object.values(pipelineState.gameStatuses).length,
    gamesComplete: Object.values(pipelineState.gameStatuses).filter(g => g.isFinal).length,
  };
}

function calculatePayout(odds, stake) {
  if (!odds || !stake) return 0;
  if (odds > 0) return (odds / 100) * stake;
  if (odds < 0) return (100 / Math.abs(odds)) * stake;
  return 0;
}

// ==================== ORCHESTRATION ====================

/**
 * Start the auto-grade pipeline for a date.
 * Call this from gameday orchestrator or manually.
 */
function startPipeline(dateStr, options = {}) {
  const { isOD = false, odDay = null, oddsApiKey = null } = options;
  
  pipelineState.phase = 'pre-game';
  pipelineState.targetDate = dateStr;
  pipelineState.isOD = isOD;
  pipelineState.odDay = odDay;
  pipelineState.errors = [];
  pipelineState.report = null;
  pipelineState.gameStatuses = {};
  saveState();
  
  console.log(`[auto-grade] 🚀 Pipeline started for ${dateStr}${isOD ? ` (OD Day ${odDay})` : ''}`);
  
  // Start live monitoring
  startLiveMonitor(dateStr, oddsApiKey);
  
  return { status: 'started', date: dateStr, isOD, odDay };
}

/**
 * Start monitoring game statuses and trigger grading when all complete.
 */
function startLiveMonitor(dateStr, oddsApiKey) {
  if (liveCheckTimer) clearInterval(liveCheckTimer);
  
  let closingLinesCaptured = false;
  
  liveCheckTimer = setInterval(async () => {
    try {
      const statuses = await checkGameStatuses(dateStr);
      
      if (statuses.length === 0) {
        // No games found yet — might be too early
        return;
      }
      
      // Capture closing lines once, when we detect games are about to start
      if (!closingLinesCaptured && oddsApiKey) {
        const hasLiveOrPending = statuses.some(g => g.isLive || g.isPending);
        const hasAtLeastOneLive = statuses.some(g => g.isLive);
        
        // Capture when first game goes live OR 10min before first game
        if (hasAtLeastOneLive) {
          pipelineState.phase = 'closing-capture';
          saveState();
          
          await captureClosingLines(oddsApiKey);
          await captureClosingPropLines(oddsApiKey);
          closingLinesCaptured = true;
          
          pipelineState.phase = 'live';
          saveState();
        }
      }
      
      // Update phase
      if (statuses.some(g => g.isLive)) {
        pipelineState.phase = 'live';
      }
      
      // Check if all games are final
      const allFinal = statuses.every(g => g.isFinal || g.isPostponed);
      const anyFinal = statuses.some(g => g.isFinal);
      
      if (allFinal && statuses.length > 0) {
        console.log(`[auto-grade] ✅ All ${statuses.length} games FINAL — triggering grading in ${POST_GAME_DELAY/60000} min`);
        pipelineState.phase = 'post-game-wait';
        saveState();
        
        // Stop monitoring
        clearInterval(liveCheckTimer);
        liveCheckTimer = null;
        
        // Wait a bit for score corrections, then grade
        gradingTimer = setTimeout(async () => {
          // Re-check one more time
          await checkGameStatuses(dateStr);
          await runAutoGrade(dateStr);
        }, POST_GAME_DELAY);
      }
      
    } catch (e) {
      pipelineState.errors.push({ time: new Date().toISOString(), error: e.message });
      saveState();
    }
  }, LIVE_CHECK_INTERVAL);
}

/**
 * Force immediate grading (manual trigger).
 */
async function forceGrade(dateStr) {
  if (!dateStr) dateStr = pipelineState.targetDate || new Date().toISOString().split('T')[0];
  
  // Check game statuses first
  await checkGameStatuses(dateStr);
  
  // Run grading
  return runAutoGrade(dateStr);
}

/**
 * Stop the pipeline.
 */
function stopPipeline() {
  if (liveCheckTimer) { clearInterval(liveCheckTimer); liveCheckTimer = null; }
  if (gradingTimer) { clearTimeout(gradingTimer); gradingTimer = null; }
  pipelineState.phase = 'idle';
  saveState();
  return { status: 'stopped' };
}

// ==================== TEAM NAME → ABBREVIATION MAPPING ====================

const TEAM_NAME_MAP = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM',
  'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH',
};

function teamNameToAbbr(name) {
  if (!name) return null;
  // Direct match
  if (TEAM_NAME_MAP[name]) return TEAM_NAME_MAP[name];
  // Already an abbreviation
  if (name.length <= 4) return normalizeTeam(name);
  // Fuzzy — check if name contains team city/mascot
  for (const [fullName, abbr] of Object.entries(TEAM_NAME_MAP)) {
    const parts = fullName.split(' ');
    const mascot = parts[parts.length - 1].toLowerCase();
    if (name.toLowerCase().includes(mascot)) return abbr;
  }
  return null;
}

// ==================== DASHBOARD REPORT ====================

/**
 * Get formatted dashboard-ready report.
 */
function getDashboardReport() {
  const report = pipelineState.report;
  if (!report) {
    return {
      status: pipelineState.phase,
      date: pipelineState.targetDate,
      message: pipelineState.phase === 'idle' ? 'No grading data yet' : `Pipeline in ${pipelineState.phase} phase`,
      gameStatuses: pipelineState.gameStatuses,
      closingLinesAvailable: Object.keys(closingLines).length,
    };
  }
  
  return {
    status: 'complete',
    date: report.date,
    gradedAt: report.gradedAt,
    summary: report.summary,
    sections: report.sections,
    closingLines: report.closingLines ? Object.keys(report.closingLines).length : 0,
    gameStatuses: pipelineState.gameStatuses,
  };
}

/**
 * Get closing line data for a specific game.
 */
function getClosingLine(gameKey) {
  return closingLines[gameKey] || null;
}

/**
 * Get all closing lines.
 */
function getAllClosingLines() {
  return closingLines;
}

/**
 * Get pipeline status.
 */
function getStatus() {
  return {
    service: 'auto-grade-pipeline',
    version: '1.0',
    phase: pipelineState.phase,
    targetDate: pipelineState.targetDate,
    isOD: pipelineState.isOD,
    gamesTotal: pipelineState.gamesTotal,
    gamesComplete: pipelineState.gamesComplete,
    gamesInProgress: pipelineState.gamesInProgress,
    gamesPending: pipelineState.gamesPending,
    closingLinesCaptures: pipelineState.closingLinesCaptures,
    closingLinesCapturedAt: pipelineState.closingLinesCapturedAt,
    gradingStartedAt: pipelineState.gradingStartedAt,
    gradingCompletedAt: pipelineState.gradingCompletedAt,
    lastStatusCheck: pipelineState.lastStatusCheck,
    errorsCount: pipelineState.errors.length,
    recentErrors: pipelineState.errors.slice(-5),
    hasReport: !!pipelineState.report,
  };
}

// ==================== INIT ====================

loadState();

module.exports = {
  // Pipeline control
  startPipeline,
  stopPipeline,
  forceGrade,
  
  // Closing lines
  captureClosingLines,
  captureClosingPropLines,
  getClosingLine,
  getAllClosingLines,
  
  // Game monitoring
  checkGameStatuses,
  
  // Auto-grading
  runAutoGrade,
  
  // Reporting
  getDashboardReport,
  getStatus,
  
  // Internal (for testing)
  teamNameToAbbr,
  normalizeTeam,
};
