/**
 * MLB Results Grader — SportsSim v103.0
 * ======================================
 * THE FEEDBACK LOOP. Without this, all our models are academic.
 * 
 * Fetches DETAILED ESPN box score data for MLB games and grades ALL bet types:
 *   - Moneyline (who won?)
 *   - Totals O/U (how many total runs?)
 *   - Run lines (margin of victory?)
 *   - F5 First 5 Innings ML + totals (first 5 innings score?)
 *   - F3 First 3 Innings totals
 *   - F7 First 7 Innings totals
 *   - NRFI/YRFI (was there a run in the 1st inning?)
 *   - K props (pitcher strikeouts vs line)
 *   - Outs props (pitcher outs recorded vs line)
 *   - Pitcher hits/walks/earned runs props
 *
 * Data sources:
 *   - ESPN Scoreboard API: game status, final scores
 *   - ESPN Event Summary API: linescore (inning-by-inning), pitcher stats, box score
 *
 * Designed to work for Opening Day AND the full 162-game regular season.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ==================== CACHE ====================
const CACHE_DIR = path.join(__dirname, 'grader-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const RESULTS_FILE = path.join(__dirname, 'mlb-graded-results.json');
let gradedResults = { games: {}, lastUpdate: null };

// Load persisted results
try {
  if (fs.existsSync(RESULTS_FILE)) {
    gradedResults = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  }
} catch (e) { /* fresh start */ }

function saveResults() {
  try {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(gradedResults, null, 2));
  } catch (e) { console.error('[mlb-grader] Save error:', e.message); }
}

// ==================== TEAM RESOLUTION ====================
const TEAM_ABBRS = {
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
  // ESPN abbreviation quirks
  'WSN': 'WSH', 'CHW': 'CWS', 'KCR': 'KC', 'SDP': 'SD', 'SFG': 'SF', 'TBR': 'TB',
};

function normalizeAbbr(abbr) {
  if (!abbr) return '';
  const upper = abbr.toUpperCase();
  return TEAM_ABBRS[upper] || upper;
}

// ==================== HTTP HELPER ====================
function fetchJSON(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': 'SportsSim/2.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ==================== ESPN DATA FETCHERS ====================

/**
 * Fetch all MLB games for a given date from ESPN scoreboard.
 * Returns array of event objects with basic score info.
 */
async function fetchScoreboard(date) {
  const dateStr = date.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
  
  try {
    const data = await fetchJSON(url);
    return (data.events || []).map(event => ({
      espnId: event.id,
      name: event.name,
      date: event.date,
      status: event.competitions?.[0]?.status?.type?.name,
      isFinal: event.competitions?.[0]?.status?.type?.completed || false,
      home: {
        abbr: normalizeAbbr(event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation),
        name: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.displayName,
        score: parseInt(event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.score) || 0,
        winner: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.winner,
      },
      away: {
        abbr: normalizeAbbr(event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation),
        name: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.displayName,
        score: parseInt(event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.score) || 0,
        winner: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.winner,
      },
    }));
  } catch (e) {
    console.error('[mlb-grader] Scoreboard fetch error:', e.message);
    return [];
  }
}

/**
 * Fetch detailed box score for a specific ESPN event ID.
 * Returns linescore (inning-by-inning), pitcher stats, batting stats.
 */
async function fetchBoxScore(espnId) {
  const cacheFile = path.join(CACHE_DIR, `box_${espnId}.json`);
  
  // Check disk cache (final games don't change)
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached.isFinal) return cached;
    }
  } catch (e) { /* cache miss */ }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${espnId}`;
    const data = await fetchJSON(url);
    
    const comp = data.header?.competitions?.[0];
    const boxscore = data.boxscore;
    const isFinal = comp?.status?.type?.completed || false;
    
    // Parse linescore (inning-by-inning runs)
    const linescores = {};
    for (const competitor of (comp?.competitors || [])) {
      const side = competitor.homeAway; // 'home' or 'away'
      const abbr = normalizeAbbr(competitor.team?.abbreviation);
      const innings = (competitor.linescores || []).map(ls => ({
        inning: ls.period,
        runs: parseInt(ls.displayValue) || 0,
      }));
      linescores[side] = { abbr, innings };
    }
    
    // Parse pitcher stats from box score
    const pitcherStats = [];
    if (boxscore?.players) {
      for (const teamData of boxscore.players) {
        const teamAbbr = normalizeAbbr(teamData.team?.abbreviation);
        const pitchingCategory = (teamData.statistics || []).find(s => 
          s.name === 'pitching' || s.type === 'pitching'
        );
        
        if (pitchingCategory) {
          // Find the index of each stat column
          const labels = (pitchingCategory.labels || []).map(l => l.toLowerCase());
          const ipIdx = labels.indexOf('ip');
          const kIdx = labels.indexOf('k') !== -1 ? labels.indexOf('k') : labels.indexOf('so');
          const hIdx = labels.indexOf('h');
          const bbIdx = labels.indexOf('bb');
          const erIdx = labels.indexOf('er');
          const rIdx = labels.indexOf('r');
          const hrIdx = labels.indexOf('hr');
          
          for (const athlete of (pitchingCategory.athletes || [])) {
            const name = athlete.athlete?.displayName || athlete.athlete?.shortName || '';
            const stats = athlete.stats || [];
            
            const pitcher = {
              name,
              team: teamAbbr,
              athleteId: athlete.athlete?.id,
              isStarter: false, // will determine below
              ip: ipIdx >= 0 ? parseFloat(stats[ipIdx]) || 0 : 0,
              strikeouts: kIdx >= 0 ? parseInt(stats[kIdx]) || 0 : 0,
              hitsAllowed: hIdx >= 0 ? parseInt(stats[hIdx]) || 0 : 0,
              walks: bbIdx >= 0 ? parseInt(stats[bbIdx]) || 0 : 0,
              earnedRuns: erIdx >= 0 ? parseInt(stats[erIdx]) || 0 : 0,
              runsAllowed: rIdx >= 0 ? parseInt(stats[rIdx]) || 0 : 0,
              homeRunsAllowed: hrIdx >= 0 ? parseInt(stats[hrIdx]) || 0 : 0,
            };
            
            // Convert IP to outs: 6.1 → 19 outs (6*3+1)
            const ipStr = (stats[ipIdx] || '0').toString();
            const ipParts = ipStr.split('.');
            const fullInnings = parseInt(ipParts[0]) || 0;
            const partialOuts = parseInt(ipParts[1]) || 0;
            pitcher.outsRecorded = fullInnings * 3 + partialOuts;
            
            pitcherStats.push(pitcher);
          }
          
          // First pitcher listed is typically the starter
          if (pitchingCategory.athletes?.length > 0) {
            const firstPitcher = pitcherStats.find(p => p.team === teamAbbr);
            if (firstPitcher) firstPitcher.isStarter = true;
          }
        }
      }
    }
    
    // Calculate derived scores
    const awayInnings = linescores.away?.innings || [];
    const homeInnings = linescores.home?.innings || [];
    
    const awayFinalScore = awayInnings.reduce((s, i) => s + i.runs, 0);
    const homeFinalScore = homeInnings.reduce((s, i) => s + i.runs, 0);
    
    // F1 (first inning)
    const awayF1 = awayInnings[0]?.runs || 0;
    const homeF1 = homeInnings[0]?.runs || 0;
    const f1Total = awayF1 + homeF1;
    const nrfi = f1Total === 0;
    
    // F3 (first 3 innings)
    const awayF3 = awayInnings.slice(0, 3).reduce((s, i) => s + i.runs, 0);
    const homeF3 = homeInnings.slice(0, 3).reduce((s, i) => s + i.runs, 0);
    const f3Total = awayF3 + homeF3;
    
    // F5 (first 5 innings)
    const awayF5 = awayInnings.slice(0, 5).reduce((s, i) => s + i.runs, 0);
    const homeF5 = homeInnings.slice(0, 5).reduce((s, i) => s + i.runs, 0);
    const f5Total = awayF5 + homeF5;
    
    // F7 (first 7 innings)
    const awayF7 = awayInnings.slice(0, 7).reduce((s, i) => s + i.runs, 0);
    const homeF7 = homeInnings.slice(0, 7).reduce((s, i) => s + i.runs, 0);
    const f7Total = awayF7 + homeF7;
    
    const result = {
      espnId,
      isFinal,
      home: { abbr: linescores.home?.abbr, score: homeFinalScore },
      away: { abbr: linescores.away?.abbr, score: awayFinalScore },
      totalRuns: awayFinalScore + homeFinalScore,
      margin: homeFinalScore - awayFinalScore,
      linescore: {
        away: awayInnings,
        home: homeInnings,
      },
      periods: {
        f1: { away: awayF1, home: homeF1, total: f1Total, nrfi },
        f3: { away: awayF3, home: homeF3, total: f3Total },
        f5: { away: awayF5, home: homeF5, total: f5Total, f5Winner: awayF5 > homeF5 ? 'away' : homeF5 > awayF5 ? 'home' : 'tie' },
        f7: { away: awayF7, home: homeF7, total: f7Total },
      },
      pitchers: pitcherStats,
      starters: pitcherStats.filter(p => p.isStarter),
      fetchedAt: new Date().toISOString(),
    };
    
    // Cache final games to disk
    if (isFinal) {
      try { fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2)); } catch (e) { /* ok */ }
    }
    
    return result;
  } catch (e) {
    console.error(`[mlb-grader] Box score fetch error (${espnId}):`, e.message);
    return null;
  }
}

// ==================== BET GRADING ENGINE ====================

/**
 * Grade a single bet against box score data.
 * @param {Object} bet - Bet object with pick, market, line, etc.
 * @param {Object} box - Box score data from fetchBoxScore()
 * @returns {Object|null} Grade result { result: 'win'|'loss'|'push'|'void', profit, notes }
 */
function gradeBet(bet, box) {
  if (!box || !box.isFinal) return null;
  
  const market = (bet.market || '').toLowerCase();
  const pick = (bet.pick || '').toUpperCase();
  
  // ==================== MONEYLINE ====================
  if (market === 'moneyline' || market === 'ml') {
    return gradeMoneyline(bet, box);
  }
  
  // ==================== TOTALS (FULL GAME) ====================
  if (market === 'total' || market === 'totals' || market === 'ou') {
    return gradeTotals(bet, box, box.totalRuns);
  }
  
  // ==================== RUN LINE / SPREAD ====================
  if (market === 'runline' || market === 'run_line' || market === 'spread') {
    return gradeRunLine(bet, box);
  }
  
  // ==================== F5 (FIRST 5 INNINGS) ====================
  if (market === 'f5_total' || market === 'f5_totals' || market === 'f5total') {
    return gradeTotals(bet, box, box.periods.f5.total);
  }
  if (market === 'f5_ml' || market === 'f5_moneyline' || market === 'f5ml') {
    return gradeF5ML(bet, box);
  }
  
  // ==================== F3 (FIRST 3 INNINGS) ====================
  if (market === 'f3_total' || market === 'f3_totals' || market === 'f3total') {
    return gradeTotals(bet, box, box.periods.f3.total);
  }
  
  // ==================== F7 (FIRST 7 INNINGS) ====================
  if (market === 'f7_total' || market === 'f7_totals' || market === 'f7total') {
    return gradeTotals(bet, box, box.periods.f7.total);
  }
  
  // ==================== NRFI / YRFI ====================
  if (market === 'nrfi' || market === 'yrfi' || market === 'first_inning') {
    return gradeNRFI(bet, box);
  }
  
  // ==================== PITCHER K PROPS ====================
  if (market === 'k_prop' || market === 'pitcher_strikeouts' || market === 'strikeouts') {
    return gradeKProp(bet, box);
  }
  
  // ==================== PITCHER OUTS PROPS ====================
  if (market === 'outs_prop' || market === 'pitcher_outs' || market === 'outs_recorded') {
    return gradeOutsProp(bet, box);
  }
  
  // ==================== PITCHER HITS/WALKS/ER PROPS ====================
  if (market === 'hits_allowed' || market === 'pitcher_hits') {
    return gradePitcherStatProp(bet, box, 'hitsAllowed');
  }
  if (market === 'walks' || market === 'pitcher_walks') {
    return gradePitcherStatProp(bet, box, 'walks');
  }
  if (market === 'earned_runs' || market === 'pitcher_earned_runs') {
    return gradePitcherStatProp(bet, box, 'earnedRuns');
  }
  
  console.warn(`[mlb-grader] Unknown market type: ${market}`);
  return null;
}

// ==================== INDIVIDUAL GRADERS ====================

function gradeMoneyline(bet, box) {
  const pick = (bet.pick || '').toUpperCase();
  const homeAbbr = box.home.abbr.toUpperCase();
  const awayAbbr = box.away.abbr.toUpperCase();
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  
  let pickedHome = null;
  if (pick.includes(homeAbbr)) pickedHome = true;
  else if (pick.includes(awayAbbr)) pickedHome = false;
  else return null;
  
  const won = pickedHome ? box.home.score > box.away.score : box.away.score > box.home.score;
  const profit = won ? calculatePayout(odds, stake) : -stake;
  
  return {
    result: won ? 'win' : 'loss',
    profit: +profit.toFixed(2),
    notes: `Final: ${awayAbbr} ${box.away.score} - ${homeAbbr} ${box.home.score}`,
    actual: { homeScore: box.home.score, awayScore: box.away.score },
  };
}

function gradeTotals(bet, box, actualTotal) {
  const pick = (bet.pick || '').toUpperCase();
  const line = bet.line || parseLineFromPick(pick);
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  
  if (line === null) return null;
  
  const isOver = pick.includes('OVER') || pick.includes('OV');
  const isUnder = pick.includes('UNDER') || pick.includes('UN');
  
  if (!isOver && !isUnder) return null;
  
  let result;
  if (isOver) {
    result = actualTotal > line ? 'win' : actualTotal < line ? 'loss' : 'push';
  } else {
    result = actualTotal < line ? 'win' : actualTotal > line ? 'loss' : 'push';
  }
  
  const profit = result === 'win' ? calculatePayout(odds, stake) :
                 result === 'loss' ? -stake : 0;
  
  return {
    result,
    profit: +profit.toFixed(2),
    notes: `Actual total: ${actualTotal}, Line: ${isOver ? 'Over' : 'Under'} ${line}`,
    actual: { total: actualTotal, line },
  };
}

function gradeRunLine(bet, box) {
  const pick = (bet.pick || '').toUpperCase();
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  
  // Parse "NYY -1.5" or "BOS +1.5"
  const match = pick.match(/([A-Z]{2,3})\s*([+-]?\d+\.?\d*)/);
  if (!match) return null;
  
  const teamAbbr = match[1];
  const spread = parseFloat(match[2]);
  const homeAbbr = box.home.abbr.toUpperCase();
  const awayAbbr = box.away.abbr.toUpperCase();
  
  let margin;
  if (teamAbbr === homeAbbr) margin = box.home.score - box.away.score;
  else if (teamAbbr === awayAbbr) margin = box.away.score - box.home.score;
  else return null;
  
  const adjusted = margin + spread;
  const result = adjusted > 0 ? 'win' : adjusted < 0 ? 'loss' : 'push';
  const profit = result === 'win' ? calculatePayout(odds, stake) :
                 result === 'loss' ? -stake : 0;
  
  return {
    result,
    profit: +profit.toFixed(2),
    notes: `Margin: ${margin}, Spread: ${spread}, Adjusted: ${adjusted}`,
    actual: { margin, spread, adjusted },
  };
}

function gradeF5ML(bet, box) {
  const pick = (bet.pick || '').toUpperCase();
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  const homeAbbr = box.home.abbr.toUpperCase();
  const awayAbbr = box.away.abbr.toUpperCase();
  
  const f5 = box.periods.f5;
  
  let pickedHome = null;
  if (pick.includes(homeAbbr)) pickedHome = true;
  else if (pick.includes(awayAbbr)) pickedHome = false;
  else return null;
  
  // F5 can be a 3-way market (tie = push or loss depending on bet type)
  if (f5.away === f5.home) {
    // Tie after 5 innings — push for standard F5 ML
    return {
      result: 'push',
      profit: 0,
      notes: `F5: ${awayAbbr} ${f5.away} - ${homeAbbr} ${f5.home} (tied)`,
      actual: { awayF5: f5.away, homeF5: f5.home },
    };
  }
  
  const won = pickedHome ? f5.home > f5.away : f5.away > f5.home;
  const profit = won ? calculatePayout(odds, stake) : -stake;
  
  return {
    result: won ? 'win' : 'loss',
    profit: +profit.toFixed(2),
    notes: `F5: ${awayAbbr} ${f5.away} - ${homeAbbr} ${f5.home}`,
    actual: { awayF5: f5.away, homeF5: f5.home },
  };
}

function gradeNRFI(bet, box) {
  const pick = (bet.pick || '').toUpperCase();
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  
  const f1 = box.periods.f1;
  const isNRFI = pick.includes('NRFI') || pick.includes('NO RUN');
  const isYRFI = pick.includes('YRFI') || pick.includes('YES RUN');
  
  if (!isNRFI && !isYRFI) return null;
  
  let result;
  if (isNRFI) {
    result = f1.nrfi ? 'win' : 'loss';
  } else {
    result = !f1.nrfi ? 'win' : 'loss';
  }
  
  const profit = result === 'win' ? calculatePayout(odds, stake) : -stake;
  
  return {
    result,
    profit: +profit.toFixed(2),
    notes: `1st inning: Away ${f1.away}, Home ${f1.home} (total: ${f1.total})${f1.nrfi ? ' NRFI ✅' : ' YRFI'}`,
    actual: { awayF1: f1.away, homeF1: f1.home, nrfi: f1.nrfi },
  };
}

function gradeKProp(bet, box) {
  const pitcherName = bet.pitcher || extractPitcherFromPick(bet.pick);
  if (!pitcherName) return null;
  
  const pitcher = findPitcher(pitcherName, box.pitchers);
  if (!pitcher) return { result: null, notes: `Pitcher ${pitcherName} not found in box score` };
  
  const pick = (bet.pick || '').toUpperCase();
  const line = bet.line || parseLineFromPick(pick);
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  
  if (line === null) return null;
  
  const isOver = pick.includes('OVER') || pick.includes('OV');
  const actual = pitcher.strikeouts;
  
  let result;
  if (isOver) {
    result = actual > line ? 'win' : actual < line ? 'loss' : 'push';
  } else {
    result = actual < line ? 'win' : actual > line ? 'loss' : 'push';
  }
  
  const profit = result === 'win' ? calculatePayout(odds, stake) :
                 result === 'loss' ? -stake : 0;
  
  return {
    result,
    profit: +profit.toFixed(2),
    notes: `${pitcher.name}: ${actual} K (line: ${isOver ? 'Over' : 'Under'} ${line}), ${pitcher.ip} IP`,
    actual: { strikeouts: actual, ip: pitcher.ip, outsRecorded: pitcher.outsRecorded },
  };
}

function gradeOutsProp(bet, box) {
  const pitcherName = bet.pitcher || extractPitcherFromPick(bet.pick);
  if (!pitcherName) return null;
  
  const pitcher = findPitcher(pitcherName, box.pitchers);
  if (!pitcher) return { result: null, notes: `Pitcher ${pitcherName} not found in box score` };
  
  const pick = (bet.pick || '').toUpperCase();
  const line = bet.line || parseLineFromPick(pick);
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  
  if (line === null) return null;
  
  const isOver = pick.includes('OVER') || pick.includes('OV');
  const actual = pitcher.outsRecorded;
  
  let result;
  if (isOver) {
    result = actual > line ? 'win' : actual < line ? 'loss' : 'push';
  } else {
    result = actual < line ? 'win' : actual > line ? 'loss' : 'push';
  }
  
  const profit = result === 'win' ? calculatePayout(odds, stake) :
                 result === 'loss' ? -stake : 0;
  
  return {
    result,
    profit: +profit.toFixed(2),
    notes: `${pitcher.name}: ${actual} outs (${pitcher.ip} IP), line: ${isOver ? 'Over' : 'Under'} ${line}`,
    actual: { outsRecorded: actual, ip: pitcher.ip },
  };
}

function gradePitcherStatProp(bet, box, statKey) {
  const pitcherName = bet.pitcher || extractPitcherFromPick(bet.pick);
  if (!pitcherName) return null;
  
  const pitcher = findPitcher(pitcherName, box.pitchers);
  if (!pitcher) return { result: null, notes: `Pitcher ${pitcherName} not found in box score` };
  
  const pick = (bet.pick || '').toUpperCase();
  const line = bet.line || parseLineFromPick(pick);
  const odds = bet.odds || 0;
  const stake = bet.stake || 0;
  
  if (line === null) return null;
  
  const isOver = pick.includes('OVER') || pick.includes('OV');
  const actual = pitcher[statKey] || 0;
  
  let result;
  if (isOver) {
    result = actual > line ? 'win' : actual < line ? 'loss' : 'push';
  } else {
    result = actual < line ? 'win' : actual > line ? 'loss' : 'push';
  }
  
  const profit = result === 'win' ? calculatePayout(odds, stake) :
                 result === 'loss' ? -stake : 0;
  
  return {
    result,
    profit: +profit.toFixed(2),
    notes: `${pitcher.name}: ${statKey}=${actual} (line: ${isOver ? 'Over' : 'Under'} ${line})`,
    actual: { [statKey]: actual, ip: pitcher.ip },
  };
}

// ==================== HELPERS ====================

function calculatePayout(odds, stake) {
  if (!odds || !stake) return 0;
  if (odds > 0) return stake * (odds / 100);
  return stake * (100 / Math.abs(odds));
}

function parseLineFromPick(pick) {
  const match = pick.match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function extractPitcherFromPick(pick) {
  if (!pick) return null;
  // Patterns: "Skubal K OVER 7.5", "Cole OVER 6.5 K", "Gerrit Cole K OVER 6.5"
  // Try to extract name before K/OVER/UNDER
  const cleaned = pick.replace(/\s*(OVER|UNDER|K|OUTS|HITS|WALKS|EARNED RUNS|ER)\s*/gi, ' ').trim();
  const parts = cleaned.split(/\s+/);
  // Remove numbers
  const nameParts = parts.filter(p => !/^\d+\.?\d*$/.test(p) && p.length > 1);
  return nameParts.length > 0 ? nameParts.join(' ') : null;
}

function findPitcher(name, pitchers) {
  if (!name || !pitchers) return null;
  const nameLower = name.toLowerCase();
  
  // Exact match
  let found = pitchers.find(p => p.name.toLowerCase() === nameLower);
  if (found) return found;
  
  // Last name match
  const lastName = nameLower.split(' ').pop();
  found = pitchers.find(p => p.name.toLowerCase().split(' ').pop() === lastName);
  if (found) return found;
  
  // Partial match
  found = pitchers.find(p => p.name.toLowerCase().includes(nameLower) || nameLower.includes(p.name.toLowerCase()));
  return found || null;
}

// ==================== MAIN GRADING PIPELINE ====================

/**
 * Grade all bets for a given date.
 * @param {Array} bets - Array of bet objects to grade
 * @param {string} date - Date string YYYY-MM-DD
 * @returns {Object} Grading results with P&L summary
 */
async function gradeDate(bets, date) {
  console.log(`[mlb-grader] Grading ${bets.length} bets for ${date}...`);
  
  // 1. Fetch scoreboard
  const scoreboard = await fetchScoreboard(date);
  const finalGames = scoreboard.filter(g => g.isFinal);
  
  if (finalGames.length === 0) {
    return {
      date,
      status: 'no_final_games',
      gamesOnSlate: scoreboard.length,
      gamesFinal: 0,
      message: `No final games for ${date}. ${scoreboard.length} games on slate.`,
      graded: [],
    };
  }
  
  // 2. Fetch detailed box scores for all final games (parallel, max 5 concurrent)
  const boxScores = {};
  const chunks = [];
  for (let i = 0; i < finalGames.length; i += 5) {
    chunks.push(finalGames.slice(i, i + 5));
  }
  
  for (const chunk of chunks) {
    const results = await Promise.all(chunk.map(g => fetchBoxScore(g.espnId)));
    for (let i = 0; i < chunk.length; i++) {
      if (results[i]) {
        const key = `${results[i].away.abbr}@${results[i].home.abbr}`;
        boxScores[key] = results[i];
        // Also store with ESPN ID for lookup
        boxScores[chunk[i].espnId] = results[i];
      }
    }
  }
  
  // 3. Grade each bet
  const graded = [];
  let totalStake = 0, totalProfit = 0;
  let wins = 0, losses = 0, pushes = 0, ungraded = 0;
  
  for (const bet of bets) {
    // Match bet to game
    const gameKey = bet.game || '';
    const box = boxScores[gameKey] || findBoxForBet(bet, boxScores);
    
    if (!box) {
      graded.push({ ...bet, gradeResult: null, notes: 'Game not found or not final' });
      ungraded++;
      continue;
    }
    
    const result = gradeBet(bet, box);
    if (!result || result.result === null) {
      graded.push({ ...bet, gradeResult: null, notes: result?.notes || 'Could not grade' });
      ungraded++;
      continue;
    }
    
    totalStake += bet.stake || 0;
    if (result.result === 'win') { wins++; totalProfit += result.profit; }
    else if (result.result === 'loss') { losses++; totalProfit += result.profit; }
    else if (result.result === 'push') { pushes++; }
    
    graded.push({ ...bet, gradeResult: result });
  }
  
  // 4. Build summary
  const summary = {
    date,
    status: 'graded',
    gamesOnSlate: scoreboard.length,
    gamesFinal: finalGames.length,
    boxScoresFetched: Object.keys(boxScores).length / 2, // each game has 2 keys
    totalBets: bets.length,
    graded: wins + losses + pushes,
    ungraded,
    record: { wins, losses, pushes },
    winRate: (wins + losses) > 0 ? +((wins / (wins + losses)) * 100).toFixed(1) : 0,
    totalStake: +totalStake.toFixed(2),
    totalProfit: +totalProfit.toFixed(2),
    roi: totalStake > 0 ? +((totalProfit / totalStake) * 100).toFixed(1) : 0,
    plays: graded,
  };
  
  // 5. Persist
  gradedResults.games[date] = summary;
  gradedResults.lastUpdate = new Date().toISOString();
  saveResults();
  
  console.log(`[mlb-grader] ${date}: ${wins}W-${losses}L-${pushes}P, $${totalProfit.toFixed(2)} P&L (${summary.roi}% ROI)`);
  
  return summary;
}

/**
 * Grade the Opening Day playbook bets.
 * Pulls bets from the OD playbook cache and grades them.
 */
async function gradeOpeningDay(dayNum = 1) {
  let odPlaybookCache;
  try { odPlaybookCache = require('./od-playbook-cache'); } catch (e) { return { error: 'OD playbook not loaded' }; }
  
  const playbook = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
  if (!playbook || !playbook.playbook) {
    return { error: 'No OD playbook cached. Build playbook first.' };
  }
  
  // Convert playbook bets to grader format
  const bets = [];
  for (const game of playbook.playbook) {
    if (dayNum === 1 && game.date !== '2026-03-26') continue;
    if (dayNum === 2 && game.date !== '2026-03-27') continue;
    
    const gameKey = `${game.away}@${game.home}`;
    
    for (const bet of (game.bets || [])) {
      bets.push({
        game: gameKey,
        pick: bet.pick,
        market: inferMarket(bet),
        line: bet.line,
        odds: bet.ml || bet.odds || -110,
        stake: bet.wager || 10,
        modelProb: bet.modelProb,
        modelEdge: bet.edge || bet.diff,
        conviction: game.signals?.conviction?.score || 0,
        pitcher: bet.pitcher,
        source: 'od-playbook',
      });
    }
  }
  
  const date = dayNum === 1 ? '2026-03-26' : '2026-03-27';
  return gradeDate(bets, date);
}

/**
 * Grade daily MLB card bets for a given date.
 */
async function gradeDailyCard(date) {
  let dailyMlbCard;
  try { dailyMlbCard = require('./daily-mlb-card'); } catch (e) { return { error: 'Daily MLB card not loaded' }; }
  
  // Build or get cached daily card
  const card = await dailyMlbCard.buildDailyCard({
    date,
    oddsApiKey: process.env.ODDS_API_KEY || '',
    forceRefresh: false,
    recordPicks: false, // don't double-record
  });
  
  if (!card || !card.games) {
    return { error: `No daily card for ${date}` };
  }
  
  // Convert card bets to grader format
  const bets = [];
  for (const game of card.games) {
    const gameKey = game.game || `${game.away}@${game.home}`;
    
    for (const bet of (game.bets || [])) {
      bets.push({
        game: gameKey,
        pick: bet.pick,
        market: bet.market || inferMarket(bet),
        line: bet.line,
        odds: bet.odds || -110,
        stake: bet.wager || 10,
        modelProb: bet.modelProb,
        modelEdge: bet.edge,
        pitcher: bet.pitcher,
        source: 'daily-card',
      });
    }
    
    // K props
    if (game.props?.kProps) {
      for (const kp of (Array.isArray(game.props.kProps) ? game.props.kProps : [game.props.kProps])) {
        if (kp.pick) {
          bets.push({
            game: gameKey,
            pick: kp.pick,
            market: 'k_prop',
            line: kp.line,
            odds: kp.odds || -110,
            stake: kp.wager || 5,
            pitcher: kp.pitcher,
            source: 'daily-card-k',
          });
        }
      }
    }
    
    // NRFI
    if (game.props?.nrfi) {
      const n = game.props.nrfi;
      if (n.pick) {
        bets.push({
          game: gameKey,
          pick: n.pick,
          market: 'nrfi',
          odds: n.odds || -110,
          stake: n.wager || 5,
          source: 'daily-card-nrfi',
        });
      }
    }
  }
  
  return gradeDate(bets, date);
}

/**
 * Grade K props for all Opening Day starters.
 */
async function gradeKProps(date) {
  let kPropsService;
  try { kPropsService = require('./pitcher-k-props'); } catch (e) { return { error: 'K props service not loaded' }; }
  
  const allPicks = kPropsService.scanODKProps ? kPropsService.scanODKProps() : null;
  if (!allPicks || !allPicks.picks) return { error: 'No K prop picks available' };
  
  const bets = allPicks.picks.map(p => ({
    game: `${p.away || ''}@${p.home || ''}`,
    pick: `${p.pitcher} K ${p.direction} ${p.line}`,
    market: 'k_prop',
    line: p.line,
    odds: p.odds || -110,
    stake: 5,
    pitcher: p.pitcher,
    modelProb: p.modelProb,
    modelEdge: p.edge,
    source: 'k-props-scan',
  }));
  
  return gradeDate(bets, date);
}

// ==================== UTILITY ====================

function inferMarket(bet) {
  const pick = (bet.pick || '').toUpperCase();
  const type = (bet.type || '').toUpperCase();
  
  if (type.includes('NRFI') || type.includes('YRFI') || pick.includes('NRFI') || pick.includes('YRFI')) return 'nrfi';
  if (type.includes('K_PROP') || type.includes('STRIKEOUT') || pick.includes(' K ')) return 'k_prop';
  if (type.includes('OUTS') || pick.includes('OUTS')) return 'outs_prop';
  if (type.includes('F5') || pick.includes('F5')) {
    if (pick.includes('OVER') || pick.includes('UNDER')) return 'f5_total';
    return 'f5_ml';
  }
  if (type.includes('F3') || pick.includes('F3')) return 'f3_total';
  if (type.includes('F7') || pick.includes('F7')) return 'f7_total';
  if (type.includes('RUN_LINE') || type.includes('SPREAD') || pick.match(/[+-]\d+\.\d/)) return 'runline';
  if (type.includes('TOTAL') || pick.includes('OVER') || pick.includes('UNDER')) return 'total';
  if (type.includes('ML') || type.includes('MONEYLINE')) return 'moneyline';
  
  return 'moneyline';
}

function findBoxForBet(bet, boxScores) {
  const pick = (bet.pick || '').toUpperCase();
  const game = (bet.game || '').toUpperCase();
  
  for (const [key, box] of Object.entries(boxScores)) {
    if (!box || !box.home || !box.away) continue;
    const ha = box.home.abbr.toUpperCase();
    const aa = box.away.abbr.toUpperCase();
    
    if (game.includes(ha) && game.includes(aa)) return box;
    if (pick.includes(ha) || pick.includes(aa)) {
      const k = `${aa}@${ha}`;
      if (k === key) return box;
    }
  }
  return null;
}

// ==================== SEASON P&L TRACKER ====================

/**
 * Get cumulative season P&L across all graded dates.
 */
function getSeasonPnL() {
  const dates = Object.keys(gradedResults.games).sort();
  let cumProfit = 0, cumStake = 0;
  let totalWins = 0, totalLosses = 0, totalPushes = 0;
  
  const daily = dates.map(d => {
    const g = gradedResults.games[d];
    cumProfit += g.totalProfit || 0;
    cumStake += g.totalStake || 0;
    totalWins += g.record?.wins || 0;
    totalLosses += g.record?.losses || 0;
    totalPushes += g.record?.pushes || 0;
    
    return {
      date: d,
      bets: g.totalBets,
      record: `${g.record?.wins || 0}-${g.record?.losses || 0}-${g.record?.pushes || 0}`,
      profit: g.totalProfit,
      roi: g.roi,
      cumProfit: +cumProfit.toFixed(2),
      cumROI: cumStake > 0 ? +((cumProfit / cumStake) * 100).toFixed(1) : 0,
    };
  });
  
  return {
    lastUpdate: gradedResults.lastUpdate,
    totalDates: dates.length,
    totalRecord: { wins: totalWins, losses: totalLosses, pushes: totalPushes },
    winRate: (totalWins + totalLosses) > 0 ? +((totalWins / (totalWins + totalLosses)) * 100).toFixed(1) : 0,
    totalStake: +cumStake.toFixed(2),
    totalProfit: +cumProfit.toFixed(2),
    seasonROI: cumStake > 0 ? +((cumProfit / cumStake) * 100).toFixed(1) : 0,
    daily,
    bestDay: daily.reduce((b, d) => d.profit > (b?.profit || -Infinity) ? d : b, null),
    worstDay: daily.reduce((w, d) => d.profit < (w?.profit || Infinity) ? d : w, null),
  };
}

/**
 * Get breakdown by bet type (market).
 */
function getMarketBreakdown() {
  const breakdown = {};
  
  for (const [date, summary] of Object.entries(gradedResults.games)) {
    for (const play of (summary.plays || [])) {
      const market = play.market || 'unknown';
      if (!breakdown[market]) {
        breakdown[market] = { market, wins: 0, losses: 0, pushes: 0, totalStake: 0, totalProfit: 0, bets: 0 };
      }
      
      const r = play.gradeResult;
      if (!r) continue;
      
      breakdown[market].bets++;
      breakdown[market].totalStake += play.stake || 0;
      if (r.result === 'win') { breakdown[market].wins++; breakdown[market].totalProfit += r.profit || 0; }
      else if (r.result === 'loss') { breakdown[market].losses++; breakdown[market].totalProfit += r.profit || 0; }
      else if (r.result === 'push') { breakdown[market].pushes++; }
    }
  }
  
  // Calculate derived stats
  for (const m of Object.values(breakdown)) {
    m.winRate = (m.wins + m.losses) > 0 ? +((m.wins / (m.wins + m.losses)) * 100).toFixed(1) : 0;
    m.roi = m.totalStake > 0 ? +((m.totalProfit / m.totalStake) * 100).toFixed(1) : 0;
    m.totalStake = +m.totalStake.toFixed(2);
    m.totalProfit = +m.totalProfit.toFixed(2);
  }
  
  return Object.values(breakdown).sort((a, b) => b.roi - a.roi);
}

// ==================== EXPORTS ====================

module.exports = {
  fetchScoreboard,
  fetchBoxScore,
  gradeBet,
  gradeDate,
  gradeOpeningDay,
  gradeDailyCard,
  gradeKProps,
  getSeasonPnL,
  getMarketBreakdown,
  getGradedResults: () => gradedResults,
};
