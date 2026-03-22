/**
 * Auto Scanner — SportsSim Automated Daily Scan Engine
 * 
 * Runs periodic scans of ALL value-detection systems:
 * - Daily picks generation (full pipeline with all signals)
 * - Value detection across NBA/MLB/NHL
 * - Polymarket value bridge + arbitrage + futures
 * - SGP correlation engine
 * - Alt lines scanner
 * - Player props scanner
 * - Kalshi prediction markets
 * - CLV tracking + grading
 * 
 * Configurable schedules, smart throttling, health monitoring.
 * Results cached to disk for instant dashboard loading.
 */

const fs = require('fs');
const path = require('path');

// ==================== CONFIGURATION ====================

const SCAN_CACHE_DIR = path.join(__dirname, 'scan-cache');
const SCAN_LOG_FILE = path.join(__dirname, 'scan-log.json');
const SCAN_STATUS_FILE = path.join(__dirname, 'scan-status.json');

// Ensure cache directory exists
if (!fs.existsSync(SCAN_CACHE_DIR)) {
  fs.mkdirSync(SCAN_CACHE_DIR, { recursive: true });
}

// Scan intervals (in milliseconds)
const INTERVALS = {
  // Core money-making scans — run frequently
  dailyPicks:     30 * 60 * 1000,   // Every 30 min — fresh picks as odds move
  valueScan:      20 * 60 * 1000,   // Every 20 min — catch value before it disappears
  polymarket:     45 * 60 * 1000,   // Every 45 min — prediction markets move slower
  
  // Supporting scans — run less frequently
  sgpScan:        60 * 60 * 1000,   // Every 60 min — SGP combos
  altLines:       60 * 60 * 1000,   // Every 60 min — alt markets
  propsScan:      60 * 60 * 1000,   // Every 60 min — player props
  kalshiScan:     90 * 60 * 1000,   // Every 90 min — Kalshi contracts
  arbitrageScan:  30 * 60 * 1000,   // Every 30 min — arb opportunities vanish fast
  
  // Maintenance scans
  clvGrading:     4 * 60 * 60 * 1000,  // Every 4 hours — grade past picks
  dataRefresh:    30 * 60 * 1000,       // Every 30 min — refresh live data feeds
};

// Active hours configuration (UTC) — don't waste API calls at 4am
const ACTIVE_HOURS = {
  // NBA: Games typically 7pm-midnight ET = 00:00-05:00 UTC (next day)
  // MLB: Games typically 1pm-midnight ET = 18:00-05:00 UTC  
  // Pregame scans should start ~4 hours before first pitch
  start: 14,  // 2pm UTC = 10am ET — start scanning for afternoon MLB
  end: 6,     // 6am UTC = 2am ET — last games ending
  // Special: always scan at least once per day even outside active hours
};

// ==================== STATE ====================

let scanTimers = {};
let scanStatus = loadScanStatus();
let isRunning = false;
let dependencies = {}; // Injected models and services

// ==================== SCAN FUNCTIONS ====================

/**
 * Run daily picks generation with full signal pipeline
 */
async function scanDailyPicks() {
  const { dailyPicks, nba, mlb, nhl, getAllOdds, lineMovement, injuries, 
          rollingStats, weather, playerProps, umpireService, calibration, mlBridge } = dependencies;
  
  if (!dailyPicks || !getAllOdds) return { error: 'Dependencies not initialized' };
  
  const oddsData = await getAllOdds();
  const result = await dailyPicks.generateDailyPicks({
    nbaModel: nba,
    mlbModel: mlb,
    nhlModel: nhl,
    oddsData,
    lineMovementSvc: lineMovement,
    injurySvc: injuries,
    rollingSvc: rollingStats,
    weatherSvc: weather,
    propsSvc: playerProps,
    umpireSvc: umpireService,
    calibrationSvc: calibration,
    mlBridgeSvc: mlBridge,
    bankroll: 1000,
    kellyFraction: 0.5,
    minEdge: 0.02,
    maxPicks: 25
  });
  
  return {
    picksCount: result.picks ? result.picks.length : 0,
    topPicks: (result.picks || []).slice(0, 5).map(p => ({
      game: `${p.away} @ ${p.home}`,
      pick: p.pick || p.side,
      edge: p.edge,
      confidence: p.confidence,
      kelly: p.kelly
    })),
    bankrollAdvice: result.bankrollAdvice,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Run value detection across all sports
 */
async function scanAllValue() {
  const { nba, mlb, nhl, getAllOdds, polymarketValue, lineMovement, 
          injuries, rollingStats, weather, umpireService, calibration } = dependencies;
  
  if (!getAllOdds) return { error: 'Dependencies not initialized' };
  
  const oddsData = await getAllOdds();
  const results = { nba: [], mlb: [], nhl: [], polymarket: [], total: 0 };
  
  // Scan each sport for value
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const model = sport === 'nba' ? nba : sport === 'mlb' ? mlb : nhl;
      if (!model) continue;
      
      const sportOdds = oddsData.filter(g => {
        const s = (g.sport || g.sport_key || '').toLowerCase();
        return s.includes(sport);
      });
      
      const teams = model.getTeams ? model.getTeams() : {};
      const valueBets = [];
      
      for (const game of sportOdds) {
        const homeTeam = game.home_team;
        const awayTeam = game.away_team;
        
        // Find team abbreviations
        let homeAbbr = null, awayAbbr = null;
        for (const [abbr, t] of Object.entries(teams)) {
          if (!t || !t.name) continue;
          const name = t.name.toLowerCase();
          if (homeTeam && name.includes(homeTeam.toLowerCase().split(' ').pop())) homeAbbr = abbr;
          if (awayTeam && name.includes(awayTeam.toLowerCase().split(' ').pop())) awayAbbr = abbr;
        }
        
        if (!homeAbbr || !awayAbbr) continue;
        
        try {
          const pred = model.predict(homeAbbr, awayAbbr);
          if (!pred) continue;
          
          // Check moneyline value
          const bookmakers = game.bookmakers || [];
          for (const book of bookmakers) {
            const markets = book.markets || [];
            for (const market of markets) {
              if (market.key === 'h2h') {
                for (const outcome of market.outcomes || []) {
                  const odds = outcome.price;
                  const impliedProb = odds > 0 ? 100 / (odds + 100) : (-odds) / (-odds + 100);
                  const isHome = outcome.name === homeTeam;
                  const modelProb = isHome ? pred.homeWinProb : (1 - pred.homeWinProb);
                  const edge = modelProb - impliedProb;
                  
                  if (edge >= 0.02) {
                    valueBets.push({
                      sport: sport.toUpperCase(),
                      game: `${awayTeam} @ ${homeTeam}`,
                      book: book.title,
                      pick: `${outcome.name} ML (${odds > 0 ? '+' : ''}${odds})`,
                      edge: parseFloat(edge.toFixed(4)),
                      modelProb: parseFloat(modelProb.toFixed(4)),
                      impliedProb: parseFloat(impliedProb.toFixed(4)),
                      confidence: edge >= 0.07 ? 'HIGH' : edge >= 0.04 ? 'MEDIUM' : 'LOW'
                    });
                  }
                }
              }
            }
          }
        } catch (e) { /* skip game */ }
      }
      
      results[sport] = valueBets.sort((a, b) => b.edge - a.edge);
    } catch (e) {
      results[sport] = [{ error: e.message }];
    }
  }
  
  // Polymarket value scan
  if (polymarketValue) {
    try {
      const pmResult = await polymarketValue.scanForValue({ minEdge: 0.03 });
      results.polymarket = (pmResult.valueBets || [])
        .filter(v => v.rawEdge > 0)
        .slice(0, 20)
        .map(v => ({
          sport: (v.sport || 'POLY').toUpperCase(),
          question: v.question,
          edge: v.edge,
          modelProb: v.modelProb,
          confidence: v.confidence
        }));
    } catch (e) {
      results.polymarket = [{ error: e.message }];
    }
  }
  
  results.total = results.nba.length + results.mlb.length + results.nhl.length + results.polymarket.length;
  return results;
}

/**
 * Run SGP scan across all sports
 */
async function scanSGPs() {
  const { sgpEngine, nba, mlb, nhl, getAllOdds } = dependencies;
  if (!sgpEngine) return { error: 'SGP engine not available' };
  
  const results = { sports: {}, totalCombos: 0, topCombos: [] };
  
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const scanResult = await sgpEngine.scanSGPs(sport, { mlb, nba, nhl }, getAllOdds);
      results.sports[sport.toUpperCase()] = {
        combos: scanResult.combos ? scanResult.combos.length : 0,
        summary: scanResult.summary
      };
      results.totalCombos += (scanResult.combos || []).length;
      
      // Keep top 5 from each sport
      const top = (scanResult.combos || []).slice(0, 5);
      results.topCombos.push(...top);
    } catch (e) {
      results.sports[sport.toUpperCase()] = { error: e.message };
    }
  }
  
  results.topCombos.sort((a, b) => (b.expectedValue || 0) - (a.expectedValue || 0));
  results.topCombos = results.topCombos.slice(0, 10);
  
  return results;
}

/**
 * Run Polymarket arbitrage and futures scans
 */
async function scanPolymarketDeep() {
  const { polymarketValue } = dependencies;
  if (!polymarketValue) return { error: 'Polymarket value bridge not available' };
  
  const results = {};
  
  // Cross-market arbitrage
  try {
    const arbResult = await polymarketValue.scanArbitrage();
    results.arbitrage = {
      opportunities: (arbResult.opportunities || []).length,
      topArbs: (arbResult.opportunities || []).slice(0, 5)
    };
  } catch (e) {
    results.arbitrage = { error: e.message };
  }
  
  // Futures value
  try {
    const futuresResult = await polymarketValue.scanFuturesValue();
    results.futures = {
      valueBets: (futuresResult.valueBets || []).length,
      topFutures: (futuresResult.valueBets || []).slice(0, 5)
    };
  } catch (e) {
    results.futures = { error: e.message };
  }
  
  // Standard value scan
  try {
    const valueResult = await polymarketValue.scanForValue({ minEdge: 0.03 });
    results.value = {
      totalBets: (valueResult.valueBets || []).length,
      topBets: (valueResult.valueBets || []).filter(v => v.rawEdge > 0).slice(0, 10)
    };
  } catch (e) {
    results.value = { error: e.message };
  }
  
  return results;
}

/**
 * Run alt lines scan for all sports
 */
async function scanAltLines() {
  const { altLines, nba, mlb, nhl, getAllOdds } = dependencies;
  if (!altLines) return { error: 'Alt lines scanner not available' };
  
  const results = { sports: {}, totalValue: 0 };
  
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const model = sport === 'nba' ? nba : sport === 'mlb' ? mlb : nhl;
      const scanResult = await altLines.scanAltLines(sport, model, getAllOdds);
      results.sports[sport.toUpperCase()] = {
        opportunities: (scanResult.opportunities || scanResult.valueBets || []).length,
        topOpps: (scanResult.opportunities || scanResult.valueBets || []).slice(0, 5)
      };
      results.totalValue += (scanResult.opportunities || scanResult.valueBets || []).length;
    } catch (e) {
      results.sports[sport.toUpperCase()] = { error: e.message };
    }
  }
  
  return results;
}

/**
 * Run player props scan
 */
async function scanProps() {
  const { playerProps, nba, mlb, nhl } = dependencies;
  if (!playerProps) return { error: 'Player props not available' };
  
  const results = { sports: {}, totalProps: 0 };
  
  for (const sport of ['nba', 'mlb', 'nhl']) {
    try {
      const scanResult = await playerProps.scanProps(sport, { nba, mlb, nhl });
      const valueBets = (scanResult.valueBets || scanResult.props || []);
      results.sports[sport.toUpperCase()] = {
        total: valueBets.length,
        topProps: valueBets.slice(0, 5)
      };
      results.totalProps += valueBets.length;
    } catch (e) {
      results.sports[sport.toUpperCase()] = { error: e.message };
    }
  }
  
  return results;
}

/**
 * Run arbitrage scan across books
 */
async function scanArbitrage() {
  const { arbitrage, getAllOdds } = dependencies;
  if (!arbitrage) return { error: 'Arbitrage scanner not available' };
  
  try {
    const oddsData = await getAllOdds();
    const result = arbitrage.scanAll(oddsData);
    return {
      totalOpportunities: (result.opportunities || []).length,
      topArbs: (result.opportunities || []).slice(0, 10),
      middles: result.middles || [],
      staleLines: result.staleLines || [],
      lowHold: result.lowHold || []
    };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Grade past CLV picks
 */
async function gradePicksCLV() {
  const { clvTracker } = dependencies;
  if (!clvTracker) return { error: 'CLV tracker not available' };
  
  try {
    const result = clvTracker.gradeAll ? await clvTracker.gradeAll() : 
                   clvTracker.getStatus ? clvTracker.getStatus() : {};
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Refresh all live data feeds
 */
async function refreshAllData() {
  const { liveData, rollingStats, injuries, weather, playerStatsService, statcast } = dependencies;
  
  const results = {};
  
  if (liveData) {
    try { results.liveData = await liveData.refreshAll(); } 
    catch (e) { results.liveData = { error: e.message }; }
  }
  if (rollingStats) {
    try { results.rolling = await rollingStats.refreshAll(); }
    catch (e) { results.rolling = { error: e.message }; }
  }
  if (injuries) {
    try { results.injuries = await injuries.refreshAll(); }
    catch (e) { results.injuries = { error: e.message }; }
  }
  if (weather) {
    try { results.weather = await weather.getAllWeather(); }
    catch (e) { results.weather = { error: e.message }; }
  }
  if (playerStatsService) {
    try { results.playerStats = await playerStatsService.refreshAll(); }
    catch (e) { results.playerStats = { error: e.message }; }
  }
  if (statcast) {
    try { results.statcast = await statcast.refreshStatcast(); }
    catch (e) { results.statcast = { error: e.message }; }
  }
  
  return results;
}

// ==================== SCAN ORCHESTRATOR ====================

const SCAN_REGISTRY = {
  dailyPicks: { fn: scanDailyPicks, name: 'Daily Picks', interval: INTERVALS.dailyPicks, priority: 1 },
  valueScan: { fn: scanAllValue, name: 'Value Detection', interval: INTERVALS.valueScan, priority: 1 },
  polymarket: { fn: scanPolymarketDeep, name: 'Polymarket Deep Scan', interval: INTERVALS.polymarket, priority: 2 },
  sgpScan: { fn: scanSGPs, name: 'SGP Combos', interval: INTERVALS.sgpScan, priority: 2 },
  altLines: { fn: scanAltLines, name: 'Alt Lines', interval: INTERVALS.altLines, priority: 2 },
  propsScan: { fn: scanProps, name: 'Player Props', interval: INTERVALS.propsScan, priority: 2 },
  arbitrageScan: { fn: scanArbitrage, name: 'Arbitrage', interval: INTERVALS.arbitrageScan, priority: 1 },
  clvGrading: { fn: gradePicksCLV, name: 'CLV Grading', interval: INTERVALS.clvGrading, priority: 3 },
  dataRefresh: { fn: refreshAllData, name: 'Data Refresh', interval: INTERVALS.dataRefresh, priority: 1 },
};

/**
 * Check if we're in active scanning hours
 */
function isActiveHours() {
  const hour = new Date().getUTCHours();
  if (ACTIVE_HOURS.start < ACTIVE_HOURS.end) {
    return hour >= ACTIVE_HOURS.start && hour < ACTIVE_HOURS.end;
  }
  // Wraps around midnight (e.g., 14-6 means 14:00 to 06:00 next day)
  return hour >= ACTIVE_HOURS.start || hour < ACTIVE_HOURS.end;
}

/**
 * Execute a single scan with error handling, timing, and caching
 */
async function executeScan(scanKey) {
  const scan = SCAN_REGISTRY[scanKey];
  if (!scan) return { error: `Unknown scan: ${scanKey}` };
  
  const startTime = Date.now();
  const scanEntry = {
    key: scanKey,
    name: scan.name,
    startedAt: new Date().toISOString(),
    status: 'running'
  };
  
  // Update status
  scanStatus[scanKey] = { ...scanEntry };
  saveScanStatus();
  
  try {
    console.log(`🔍 Auto-scan: ${scan.name} starting...`);
    const result = await scan.fn();
    const durationMs = Date.now() - startTime;
    
    scanEntry.status = 'completed';
    scanEntry.durationMs = durationMs;
    scanEntry.completedAt = new Date().toISOString();
    scanEntry.resultSummary = summarizeResult(scanKey, result);
    
    // Cache result to disk
    const cacheFile = path.join(SCAN_CACHE_DIR, `${scanKey}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify({
      scanKey,
      scanName: scan.name,
      generatedAt: new Date().toISOString(),
      durationMs,
      data: result
    }, null, 2));
    
    // Update status
    scanStatus[scanKey] = { ...scanEntry };
    saveScanStatus();
    
    // Log
    appendScanLog(scanEntry);
    
    console.log(`✅ Auto-scan: ${scan.name} completed in ${(durationMs / 1000).toFixed(1)}s — ${scanEntry.resultSummary}`);
    
    return { success: true, ...scanEntry, data: result };
  } catch (e) {
    const durationMs = Date.now() - startTime;
    scanEntry.status = 'error';
    scanEntry.error = e.message;
    scanEntry.durationMs = durationMs;
    scanEntry.completedAt = new Date().toISOString();
    
    scanStatus[scanKey] = { ...scanEntry };
    saveScanStatus();
    appendScanLog(scanEntry);
    
    console.error(`❌ Auto-scan: ${scan.name} failed after ${(durationMs / 1000).toFixed(1)}s — ${e.message}`);
    return { success: false, ...scanEntry };
  }
}

/**
 * Summarize scan result for logging
 */
function summarizeResult(key, result) {
  if (!result) return 'No data';
  if (result.error) return `Error: ${result.error}`;
  
  switch (key) {
    case 'dailyPicks':
      return `${result.picksCount} picks generated`;
    case 'valueScan':
      return `${result.total} value bets found (NBA:${result.nba?.length || 0} MLB:${result.mlb?.length || 0} NHL:${result.nhl?.length || 0} PM:${result.polymarket?.length || 0})`;
    case 'polymarket':
      return `Arb:${result.arbitrage?.opportunities || 0} Futures:${result.futures?.valueBets || 0} Value:${result.value?.totalBets || 0}`;
    case 'sgpScan':
      return `${result.totalCombos} SGP combos`;
    case 'altLines':
      return `${result.totalValue} alt line opportunities`;
    case 'propsScan':
      return `${result.totalProps} prop value bets`;
    case 'arbitrageScan':
      return `${result.totalOpportunities} arb opportunities`;
    case 'clvGrading':
      return `CLV grading complete`;
    case 'dataRefresh':
      return `Data feeds refreshed`;
    default:
      return JSON.stringify(result).slice(0, 100);
  }
}

// ==================== TIMER MANAGEMENT ====================

/**
 * Start all automated scan timers
 */
function startAllTimers() {
  if (isRunning) {
    console.log('⚠️ Auto-scanner already running');
    return;
  }
  isRunning = true;
  
  console.log('🚀 Auto-scanner starting...');
  console.log(`   Active hours: ${ACTIVE_HOURS.start}:00 - ${ACTIVE_HOURS.end}:00 UTC`);
  console.log(`   Currently ${isActiveHours() ? 'ACTIVE' : 'INACTIVE'} (${new Date().getUTCHours()}:00 UTC)`);
  
  for (const [key, scan] of Object.entries(SCAN_REGISTRY)) {
    const interval = scan.interval;
    
    // Stagger initial scans to avoid thundering herd
    // Priority 1 scans start within first 2 min, priority 2 within 5 min, etc.
    const staggerDelay = (scan.priority || 1) * 30000 + Math.random() * 30000;
    
    // Initial scan after stagger delay
    const initialTimer = setTimeout(() => {
      runIfActive(key);
      
      // Then set up recurring interval
      scanTimers[key] = setInterval(() => {
        runIfActive(key);
      }, interval);
    }, staggerDelay);
    
    scanTimers[`${key}_initial`] = initialTimer;
    
    console.log(`   📋 ${scan.name}: every ${formatInterval(interval)} (starts in ${Math.round(staggerDelay / 1000)}s)`);
  }
  
  console.log('🔄 Auto-scanner initialized — all scans scheduled');
}

/**
 * Run a scan if we're in active hours (or force it if it hasn't run today)
 */
function runIfActive(key) {
  if (isActiveHours()) {
    executeScan(key);
  } else {
    // Even outside active hours, run at least once every 4 hours
    const lastRun = scanStatus[key]?.completedAt;
    if (!lastRun || (Date.now() - new Date(lastRun).getTime() > 4 * 60 * 60 * 1000)) {
      console.log(`🌙 Off-hours scan: ${SCAN_REGISTRY[key].name} (hasn't run in 4+ hours)`);
      executeScan(key);
    }
  }
}

/**
 * Stop all scan timers
 */
function stopAllTimers() {
  for (const [key, timer] of Object.entries(scanTimers)) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  scanTimers = {};
  isRunning = false;
  console.log('🛑 Auto-scanner stopped');
}

/**
 * Force run a specific scan immediately
 */
async function forceScan(scanKey) {
  if (scanKey === 'all') {
    const results = {};
    for (const key of Object.keys(SCAN_REGISTRY)) {
      results[key] = await executeScan(key);
    }
    return results;
  }
  return executeScan(scanKey);
}

// ==================== CACHED RESULTS ====================

/**
 * Get latest cached scan result
 */
function getCachedScan(scanKey) {
  const cacheFile = path.join(SCAN_CACHE_DIR, `${scanKey}.json`);
  try {
    if (fs.existsSync(cacheFile)) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch (e) {}
  return null;
}

/**
 * Get all cached scan results
 */
function getAllCachedScans() {
  const results = {};
  for (const key of Object.keys(SCAN_REGISTRY)) {
    const cached = getCachedScan(key);
    if (cached) {
      results[key] = {
        name: SCAN_REGISTRY[key].name,
        generatedAt: cached.generatedAt,
        age: formatAge(cached.generatedAt),
        summary: scanStatus[key]?.resultSummary || 'N/A',
        hasData: !!cached.data
      };
    } else {
      results[key] = {
        name: SCAN_REGISTRY[key].name,
        generatedAt: null,
        age: 'Never',
        summary: 'Not yet scanned',
        hasData: false
      };
    }
  }
  return results;
}

// ==================== STATUS & HEALTH ====================

/**
 * Get comprehensive scanner health status
 */
function getHealth() {
  const now = Date.now();
  const health = {
    isRunning,
    isActiveHours: isActiveHours(),
    currentHourUTC: new Date().getUTCHours(),
    activeWindow: `${ACTIVE_HOURS.start}:00 - ${ACTIVE_HOURS.end}:00 UTC`,
    scans: {},
    alerts: []
  };
  
  for (const [key, scan] of Object.entries(SCAN_REGISTRY)) {
    const status = scanStatus[key] || {};
    const lastRun = status.completedAt ? new Date(status.completedAt).getTime() : 0;
    const timeSinceRun = lastRun ? now - lastRun : Infinity;
    const isStale = timeSinceRun > scan.interval * 3; // 3x interval = stale
    const isOverdue = timeSinceRun > scan.interval * 2;
    
    health.scans[key] = {
      name: scan.name,
      interval: formatInterval(scan.interval),
      lastRun: status.completedAt || 'Never',
      lastRunAge: lastRun ? formatAge(status.completedAt) : 'Never',
      lastStatus: status.status || 'never-run',
      lastDuration: status.durationMs ? `${(status.durationMs / 1000).toFixed(1)}s` : 'N/A',
      lastResult: status.resultSummary || 'N/A',
      isStale,
      isOverdue,
      lastError: status.error || null
    };
    
    if (isStale && isActiveHours()) {
      health.alerts.push(`⚠️ ${scan.name} is stale (last run: ${formatAge(status.completedAt)})`);
    }
    if (status.status === 'error') {
      health.alerts.push(`❌ ${scan.name} last run failed: ${status.error}`);
    }
  }
  
  health.totalAlerts = health.alerts.length;
  health.overallHealth = health.alerts.length === 0 ? 'HEALTHY' : 
                         health.alerts.length <= 2 ? 'DEGRADED' : 'UNHEALTHY';
  
  return health;
}

/**
 * Get scan log history
 */
function getScanLog(limit = 50) {
  try {
    if (fs.existsSync(SCAN_LOG_FILE)) {
      const log = JSON.parse(fs.readFileSync(SCAN_LOG_FILE, 'utf8'));
      return log.slice(-limit);
    }
  } catch (e) {}
  return [];
}

// ==================== DAILY DIGEST ====================

/**
 * Generate a daily digest of all scan results
 * Useful for alerts and summaries
 */
function generateDailyDigest() {
  const digest = {
    date: new Date().toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),
    sections: {}
  };
  
  // Daily picks
  const picksCache = getCachedScan('dailyPicks');
  if (picksCache?.data) {
    const picks = picksCache.data;
    digest.sections.picks = {
      count: picks.picksCount || 0,
      topPicks: picks.topPicks || [],
      lastUpdated: picksCache.generatedAt
    };
  }
  
  // Value bets
  const valueCache = getCachedScan('valueScan');
  if (valueCache?.data) {
    const v = valueCache.data;
    digest.sections.value = {
      total: v.total || 0,
      byLeague: {
        NBA: v.nba?.length || 0,
        MLB: v.mlb?.length || 0,
        NHL: v.nhl?.length || 0,
        Polymarket: v.polymarket?.length || 0
      },
      lastUpdated: valueCache.generatedAt
    };
  }
  
  // Arbitrage
  const arbCache = getCachedScan('arbitrageScan');
  if (arbCache?.data) {
    digest.sections.arbitrage = {
      opportunities: arbCache.data.totalOpportunities || 0,
      lastUpdated: arbCache.generatedAt
    };
  }
  
  // SGP
  const sgpCache = getCachedScan('sgpScan');
  if (sgpCache?.data) {
    digest.sections.sgp = {
      combos: sgpCache.data.totalCombos || 0,
      lastUpdated: sgpCache.generatedAt
    };
  }
  
  // Props
  const propsCache = getCachedScan('propsScan');
  if (propsCache?.data) {
    digest.sections.props = {
      total: propsCache.data.totalProps || 0,
      lastUpdated: propsCache.generatedAt
    };
  }
  
  // Scanner health
  digest.scannerHealth = getHealth().overallHealth;
  
  // Cache the digest
  const digestFile = path.join(SCAN_CACHE_DIR, 'daily-digest.json');
  fs.writeFileSync(digestFile, JSON.stringify(digest, null, 2));
  
  return digest;
}

// ==================== UTILITY FUNCTIONS ====================

function formatInterval(ms) {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(0)}m`;
  return `${(ms / 1000).toFixed(0)}s`;
}

function formatAge(isoString) {
  if (!isoString) return 'Never';
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms < 60000) return 'Just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

function loadScanStatus() {
  try {
    if (fs.existsSync(SCAN_STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(SCAN_STATUS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveScanStatus() {
  try {
    fs.writeFileSync(SCAN_STATUS_FILE, JSON.stringify(scanStatus, null, 2));
  } catch (e) {
    console.error('Failed to save scan status:', e.message);
  }
}

function appendScanLog(entry) {
  try {
    let log = [];
    if (fs.existsSync(SCAN_LOG_FILE)) {
      log = JSON.parse(fs.readFileSync(SCAN_LOG_FILE, 'utf8'));
    }
    log.push(entry);
    // Keep last 500 entries
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(SCAN_LOG_FILE, JSON.stringify(log, null, 2));
  } catch (e) {
    console.error('Failed to write scan log:', e.message);
  }
}

// ==================== DEPENDENCY INJECTION ====================

/**
 * Initialize the auto-scanner with all service dependencies
 */
function init(deps) {
  dependencies = deps;
  console.log('🔧 Auto-scanner dependencies injected');
  return module.exports;
}

// ==================== EXPORTS ====================

module.exports = {
  init,
  startAllTimers,
  stopAllTimers,
  forceScan,
  executeScan,
  getCachedScan,
  getAllCachedScans,
  getHealth,
  getScanLog,
  generateDailyDigest,
  isActiveHours,
  INTERVALS,
  SCAN_REGISTRY
};
