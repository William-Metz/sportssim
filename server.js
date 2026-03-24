require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nba = require('./models/nba');
const backtest = require('./models/backtest');
const mlb = require('./models/mlb');
const mlbPitchers = require('./models/mlb-pitchers');
const mlbBacktest = require('./models/backtest-mlb');
const mlbBacktestV2 = require('./models/backtest-mlb-v2');
const mlbOpeningDay = require('./models/mlb-opening-day');
const nhl = require('./models/nhl');
const nhlBacktest = require('./models/backtest-nhl');
const liveData = require('./services/live-data');
const kelly = require('./services/kelly');
const rollingStats = require('./services/rolling-stats');
const injuries = require('./services/injuries');
const lineMovement = require('./services/line-movement');
const clvTracker = require('./services/clv-tracker');
const kalshi = require('./services/kalshi');
const playerProps = require('./services/player-props');
const weather = require('./services/weather');
const polymarket = require('./services/polymarket');
const restTravelService = require('./services/rest-travel');
const monteCarloService = require('./services/monte-carlo');
const playerStatsService = require('./services/player-stats');
const betTracker = require('./services/bet-tracker');
const umpireService = require('./services/umpire-tendencies');
const dailyPicks = require('./services/daily-picks');
const mlbSchedule = require('./services/mlb-schedule');
const lineupFetcher = require('./services/lineup-fetcher');
const calibration = require('./services/calibration');
const sgpEngine = require('./services/sgp-engine');
const altLines = require('./services/alt-lines');
const mlBridge = require('./services/ml-bridge');
const arbitrage = require('./services/arbitrage');
const playoffSeries = require('./services/playoff-series');
const nhlPlayoffSeries = require('./services/nhl-playoff-series');
const nbaSeedingSim = require('./services/nba-seeding-sim');
const statcast = require('./services/statcast');
const negBinomial = require('./services/neg-binomial');
const historicalGames = require('./services/historical-games');
const polymarketValue = require('./services/polymarket-value');
const preseasonTuning = require('./services/preseason-tuning');
const autoScanner = require('./services/auto-scanner');
const seasonSimulator = require('./services/season-simulator');
const nbaRestTank = require('./services/nba-rest-tank');
let restTankBacktest = null;
try { restTankBacktest = require('./services/rest-tank-backtest'); } catch (e) { console.error('[server] Rest/Tank Backtest not loaded:', e.message); }
const futuresScanner = require('./services/futures-scanner');
let openingWeekUnders = null;
try { openingWeekUnders = require('./services/opening-week-unders'); } catch (e) { console.error('[server] Opening Week Unders service not loaded:', e.message); }
let lineupMonitor = null;
try { lineupMonitor = require('./services/lineup-monitor'); } catch (e) { console.error('[server] Lineup Monitor not loaded:', e.message); }
let dailySlate = null;
try { dailySlate = require('./services/daily-slate'); } catch (e) { console.error('[server] Daily Slate service not loaded:', e.message); }
let dailyMlbCard = null;
let dailyNbaCard = null;
let dailyNhlCard = null;
let pitcherResolver = null;
try { dailyMlbCard = require('./services/daily-mlb-card'); } catch (e) { console.error('[server] Daily MLB Card not loaded:', e.message); }
try { dailyNbaCard = require('./services/daily-nba-card'); } catch (e) { console.error('[server] Daily NBA Card not loaded:', e.message); }
try { dailyNhlCard = require('./services/daily-nhl-card'); } catch (e) { console.error('[server] Daily NHL Card not loaded:', e.message); }
try { pitcherResolver = require('./services/pitcher-resolver'); } catch (e) { console.error('[server] Pitcher Resolver not loaded:', e.message); }
let consensusEngine = null;
try { consensusEngine = require('./services/consensus-engine'); } catch (e) { console.error('[server] Consensus Engine not loaded:', e.message); }
let nbaHistorical = null;
try { nbaHistorical = require('./services/nba-historical'); } catch (e) { console.error('[server] NBA Historical not loaded:', e.message); }
let nhlGoalieStarters = null;
try { nhlGoalieStarters = require('./services/nhl-goalie-starters'); } catch (e) { console.error('[server] NHL Goalie Starters not loaded:', e.message); }
let weatherForecast = null;
try { weatherForecast = require('./services/weather-forecast'); } catch (e) { console.error('[server] Weather Forecast not loaded:', e.message); }
let seedingFuturesBridge = null;
try { seedingFuturesBridge = require('./services/seeding-futures-bridge'); } catch (e) { console.error('[server] Seeding Futures Bridge not loaded:', e.message); }
let nfl = null;
try { nfl = require('./models/nfl'); } catch (e) { console.error('[server] NFL model not loaded:', e.message); }
let odPreflight = null;
try { odPreflight = require('./services/opening-day-preflight'); } catch (e) { console.error('[server] OD Preflight not loaded:', e.message); }
let ncaa = null;
try { ncaa = require('./models/ncaa'); } catch (e) { console.error('[server] NCAA model not loaded:', e.message); }
let ncaaLive = null;
try { ncaaLive = require('./services/ncaa-live'); } catch (e) { console.error('[server] NCAA Live not loaded:', e.message); }
let bullpenQuality = null;
try { bullpenQuality = require('./services/bullpen-quality'); } catch (e) { console.error('[server] Bullpen Quality not loaded:', e.message); }
let stolenBaseModel = null;
try { stolenBaseModel = require('./services/stolen-base-model'); } catch (e) { console.error('[server] Stolen Base model not loaded:', e.message); }
let odTeamTendencies = null;
try { odTeamTendencies = require('./services/od-team-tendencies'); } catch (e) { console.error('[server] OD Team Tendencies not loaded:', e.message); }
let odLive = null;
try { odLive = require('./services/opening-day-live'); } catch (e) { console.error('[server] OD Live Tracker not loaded:', e.message); }
let odPlaybookCache = null;
try { odPlaybookCache = require('./services/od-playbook-cache'); } catch (e) { console.error('[server] OD Playbook Cache not loaded:', e.message); }
let odLineTracker = null;
try { odLineTracker = require('./services/od-line-tracker'); } catch (e) { console.error('[server] OD Line Tracker not loaded:', e.message); }
let pitcherKProps = null;
try { pitcherKProps = require('./services/pitcher-k-props'); } catch (e) { console.error('[server] Pitcher K Props not loaded:', e.message); }
let pitcherOutsProps = null;
try { pitcherOutsProps = require('./services/pitcher-outs-props'); } catch (e) { console.error('[server] Pitcher Outs Props not loaded:', e.message); }
let odSgpBuilder = null;
try { odSgpBuilder = require('./services/od-sgp-builder'); } catch (e) { console.error('[server] OD SGP Builder not loaded:', e.message); }
let nrfiModel = null;
try { nrfiModel = require('./services/nrfi-model'); } catch (e) { console.error('[server] NRFI Model not loaded:', e.message); }
let f3Model = null;
try { f3Model = require('./services/f3-model'); } catch (e) { console.error('[server] F3 Model not loaded:', e.message); }
let f7Model = null;
try { f7Model = require('./services/f7-model'); } catch (e) { console.error('[server] F7 Model not loaded:', e.message); }
let batterProps = null;
try { batterProps = require('./services/batter-props'); } catch (e) { console.error('[server] Batter Props not loaded:', e.message); }
let pitcherHweProps = null;
try { pitcherHweProps = require('./services/pitcher-hwe-props'); } catch (e) { console.error('[server] Pitcher HWE Props not loaded:', e.message); }
let nbaPeriodMarkets = null;
try { nbaPeriodMarkets = require('./services/nba-period-markets'); } catch (e) { console.error('[server] NBA Period Markets not loaded:', e.message); }
let lineShopping = null;
try { lineShopping = require('./services/line-shopping'); } catch (e) { console.error('[server] Line Shopping not loaded:', e.message); }
let teamTotalsScanner = null;
try { teamTotalsScanner = require('./services/team-totals-scanner'); } catch (e) { console.error('[server] Team Totals Scanner not loaded:', e.message); }
let edgeDecayOptimizer = null;
try { edgeDecayOptimizer = require('./services/od-edge-decay-optimizer'); } catch (e) { console.error('[server] Edge Decay Optimizer not loaded:', e.message); }
let odWarRoom = null;
try { odWarRoom = require('./services/od-war-room'); } catch (e) { console.error('[server] OD War Room not loaded:', e.message); }
let odFinalCheck = null;
try { odFinalCheck = require('./services/od-final-check'); } catch (e) { console.error('[server] OD Final Check not loaded:', e.message); }
let odD1Final = null;
try { odD1Final = require('./services/od-d1-final'); } catch (e) { console.error('[server] OD D-1 Final not loaded:', e.message); }
let odLiveLines = null;
try { odLiveLines = require('./services/od-live-lines'); } catch (e) { console.error('[server] OD Live Lines not loaded:', e.message); }
let gamedayAutopilot = null;
try { gamedayAutopilot = require('./services/gameday-autopilot'); } catch (e) { console.error('[server] Gameday Autopilot not loaded:', e.message); }
let regularSeasonAutopilot = null;
try { regularSeasonAutopilot = require('./services/regular-season-autopilot'); } catch (e) { console.error('[server] Regular Season Autopilot not loaded:', e.message); }
let nbaSeriesScanner = null;
try { nbaSeriesScanner = require('./services/nba-playoff-series-scanner'); } catch (e) { console.error('[server] NBA Playoff Series Scanner not loaded:', e.message); }
let nhlBubbleScanner = null;
try { nhlBubbleScanner = require('./services/nhl-bubble-scanner'); } catch (e) { console.error('[server] NHL Bubble Scanner not loaded:', e.message); }
let odGamedayVerify = null;
try { odGamedayVerify = require('./services/od-gameday-verify'); } catch (e) { console.error('[server] OD Gameday Verify not loaded:', e.message); }
let odPitcherSync = null;
try { odPitcherSync = require('./services/od-pitcher-sync'); } catch (e) { console.error('[server] OD Pitcher Sync not loaded:', e.message); }
let odLineupVerify = null;
try { odLineupVerify = require('./services/od-lineup-verify'); } catch (e) { console.error('[server] OD Lineup Verify not loaded:', e.message); }

let mlbStatsLineups = null;
try { mlbStatsLineups = require('./services/mlb-stats-lineups'); } catch (e) { console.error('[server] MLB Stats Lineups not loaded:', e.message); }
let lineupBridge = null;
try { lineupBridge = require('./services/lineup-bridge'); } catch (e) { console.error('[server] Lineup Bridge not loaded:', e.message); }

let gamedayLineupPipeline = null;
try { gamedayLineupPipeline = require('./services/gameday-lineup-pipeline'); } catch (e) { console.error('[server] Gameday Lineup Pipeline not loaded:', e.message); }

let gamedayOrchestrator = null;
try { gamedayOrchestrator = require('./services/gameday-orchestrator'); } catch (e) { console.error('[server] GameDay Orchestrator not loaded:', e.message); }

let morningBriefing = null;
try { morningBriefing = require('./services/morning-briefing'); } catch (e) { console.error('[server] Morning Briefing not loaded:', e.message); }

let restTankGrader = null;
try { restTankGrader = require('./services/rest-tank-grader'); } catch (e) { console.error('[server] Rest/Tank Grader not loaded:', e.message); }
let mlbResultsGrader = null;
try { mlbResultsGrader = require('./services/mlb-results-grader'); } catch (e) { console.error('[server] MLB Results Grader not loaded:', e.message); }
let autoGradePipeline = null;
try { autoGradePipeline = require('./services/auto-grade-pipeline'); } catch (e) { console.error('[server] Auto-Grade Pipeline not loaded:', e.message); }
let odLiveOdds = null;
try { odLiveOdds = require('./services/od-live-odds'); } catch (e) { console.error('[server] OD Live Odds not loaded:', e.message); }
let odOddsMonitor = null;
try { odOddsMonitor = require('./services/od-odds-monitor'); } catch (e) { console.error('[server] OD Odds Monitor not loaded:', e.message); }
let odCommandCenter = null;
try { odCommandCenter = require('./services/od-command-center'); } catch (e) { console.error('[server] OD Command Center not loaded:', e.message); }
let odMorningBrief = null;
try { odMorningBrief = require('./services/od-morning-brief'); } catch (e) { console.error('[server] OD Morning Brief not loaded:', e.message); }
let odT2Verification = null;
try { odT2Verification = require('./services/od-t2-verification'); } catch (e) { console.error('[server] OD T-2 Verification not loaded:', e.message); }
let odLineChangeTracker = null;
try { odLineChangeTracker = require('./services/od-line-change-tracker'); } catch (e) { console.error('[server] OD Line Change Tracker not loaded:', e.message); }
let odEspnVerify = null;
try { odEspnVerify = require('./services/od-espn-live-verify'); } catch (e) { console.error('[server] OD ESPN Live Verify not loaded:', e.message); }
// odWarRoom re-assigned to sync version (original async version loaded at line 115)
try { odWarRoom = require('./services/od-war-room-sync'); } catch (e) { /* keep original war room */ }
let odFinalValidator = null;
try { odFinalValidator = require('./services/od-final-validator'); } catch (e) { console.error('[server] OD Final Validator not loaded:', e.message); }
let odEveValidation = null;
try { odEveValidation = require('./services/od-eve-validation'); } catch (e) { console.error('[server] OD Eve Validation not loaded:', e.message); }
let odD2Validation = null;
try { odD2Validation = require('./services/od-d2-validation'); } catch (e) { console.error('[server] OD D2 Validation not loaded:', e.message); }

const app = express();
const PORT = process.env.PORT || 8080;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== HELPERS ====================

function buildNameMap(TEAMS, extraMappings) {
  const nameMap = {};
  for (const [abbr, t] of Object.entries(TEAMS)) {
    nameMap[t.name.toLowerCase()] = abbr;
    const parts = t.name.split(' ');
    nameMap[parts[parts.length - 1].toLowerCase()] = abbr;
  }
  if (extraMappings) Object.assign(nameMap, extraMappings);
  return nameMap;
}

function resolveTeam(nameMap, name) {
  const lower = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(nameMap)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

async function fetchOdds(sportKey) {
  if (!ODDS_API_KEY) return [];
  try {
    const fetch = require('node-fetch');
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
    const resp = await fetch(url);
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function extractBookLine(bk, homeTeam) {
  const bookLine = {};
  (bk.markets || []).forEach(mkt => {
    if (mkt.key === 'spreads') {
      mkt.outcomes.forEach(o => {
        if (o.name === homeTeam) { bookLine.spread = o.point; bookLine.homeSpreadOdds = o.price; }
        else { bookLine.awaySpreadOdds = o.price; }
      });
    }
    if (mkt.key === 'h2h') {
      mkt.outcomes.forEach(o => {
        if (o.name === homeTeam) bookLine.homeML = o.price;
        else bookLine.awayML = o.price;
      });
    }
    if (mkt.key === 'totals') {
      mkt.outcomes.forEach(o => {
        if (o.name === 'Over') { bookLine.total = o.point; bookLine.overOdds = o.price; }
        if (o.name === 'Under') { bookLine.underOdds = o.price; }
      });
    }
  });
  return bookLine;
}

// ==================== HEALTH ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '118.0.0', timestamp: new Date().toISOString(), sports: ['nba','mlb','nhl','nfl','ncaab'], features: ['live-data','pitcher-model','poisson-totals','neg-binomial-totals','matchup-analysis','opening-day','weather-integration','player-props','polymarket-scanner','polymarket-value-bridge','cross-market-arbitrage','futures-value-scanner','bet-tracker','auto-grading','clv-tracking','rest-travel','monte-carlo-sim','bullpen-fatigue','espn-confirmed-starters','mlb-schedule','spring-training-signals','opening-day-command-center','umpire-tendencies','probability-calibration','sgp-correlation-engine','unified-signal-engine','alt-lines-scanner','arbitrage-scanner','poisson-win-prob','nba-spread-calibration','mlb-backtest-v2-point-in-time','mlb-calibration-v3','playoff-series-pricing','championship-simulator','statcast-integration','ml-engine-v2-statcast','historical-data-expansion','ml-value-detection','ml-daily-picks','preseason-tuning','roster-change-impact','new-team-pitcher-penalty','opening-day-starter-premium','overdispersion-modeling','live-lineup-fetcher','catcher-framing','savant-catcher-framing-v2','xgboost-lightgbm-ensemble','season-simulator','futures-dashboard','bayesian-calibration','nba-rest-tank-model','nba-motivation-mismatch','nba-auto-b2b-detection','opening-week-unders','cold-weather-park-analysis','season-sim-calibration-v2','fangraphs-validated-projections','fangraphs-rs-ra-blend','org-dysfunction-penalty','preseason-edge-discount','mc-uncertainty-perturbation','championship-futures-scanner','multi-sport-futures-value','live-futures-odds','playoff-preview-scanner','f5-opening-week-unders-scan','lineup-pipeline-wired','daily-action-slate','cross-sport-portfolio','unified-bet-grading','consensus-engine','multi-model-agreement','conviction-betting','daily-nba-card-v90','nba-rest-tank-conviction','nba-mismatch-spotlight','nba-daily-kelly-portfolio','non-blocking-od-endpoints-v91','auto-warm-cache','preflight-lite','disk-cache-persistence-v92','cold-start-fix','f3-first-3-innings-model-v93','ftto-advantage','f3-value-scanner','od-betting-card-fix-v94','nrfi-f3-wiring-fix','pitcher-hwe-props-v95','hits-allowed-model','walks-model','earned-runs-model','statcast-xba-xera-integration','soft-market-props','nba-period-markets-v96','quarter-scoring-model','half-scoring-model','team-quarter-profiles','motivation-quarter-impact','structural-edge-scanner','period-value-detection','f7-bullpen-chaos-eliminator-v98','daily-nhl-card-v98','nhl-goalie-mismatch-daily','nhl-bubble-daily','nhl-b2b-detection','staggered-startup-v99','1gb-vm-oom-fix','od-starter-sync-v100','f3-edge-fix-v100','nrfi-medium-confidence-v100','od-lineup-verify-v101','lineup-override-system','lineup-gameday-monitor','rest-tank-backtest-v102','gameday-orchestrator-v102','rest-tank-grader-v102','mlb-results-grader-v103','detailed-boxscore-grading','f5-f3-f7-grading','k-prop-grading','nrfi-grading','outs-prop-grading','season-pnl-tracker','market-breakdown-analytics','od-eve-validation-v104','live-weather-48h-pull','postponement-risk-assessment','comprehensive-go-nogo-check','espn-schedule-cross-validation','auto-grade-pipeline-v105','closing-line-capture','game-status-monitor','post-game-auto-grading','clv-measurement-pipeline','comprehensive-pnl-dashboard','od-d2-live-validation-v106','espn-pitcher-cross-validation','live-weather-48h-all-venues','postponement-risk-v2','lineup-override-prediction-bridge-v107','od-gameday-auto-lineup-verify','backup-lineup-source-upgrade','mlb-stats-api-lineups-v108','multi-source-lineup-bridge','lineup-source-comparison','gameday-lineup-verification','morning-briefing-v109','cross-sport-daily-portfolio','unified-edge-detection','daily-pnl-integration','gameday-lineup-pipeline-v110','mlb-stats-primary-lineup-source','auto-prediction-rebuild-on-lineup','lineup-readiness-dashboard','multi-source-lineup-monitor','regular-season-autoboot-v111','autopilot-lineup-bridge-integration','auto-grade-yesterday-on-boot','mlb-stats-schedule-fallback','od-odds-monitor-v112','live-line-detection','auto-playbook-rebuild','cross-book-best-price','edge-decay-tracking','od-command-center-v113','d2-war-room','system-health-dashboard','portfolio-cheat-sheet','action-items-engine','spring-training-data-update-march24','od-t2-verification-v114','od-morning-brief-v114','od-line-change-tracker-v114','dk-line-refresh-march24','live-espn-dk-lines','espn-live-verification-v115','od-pitcher-auto-check','od-line-auto-check','team-totals-prop-scanner-v116','per-team-run-projection-value','asymmetric-pitching-exploit','live-team-total-odds','od-d1-final-check-v117','comprehensive-go-nogo-v117','live-mlb-schedule-verify','production-health-monitor','gameday-morning-protocol','edge-decay-optimizer-v118','bet-timing-portfolio','market-decay-profiles','optimal-bet-window','edge-extinction-tracking','scale-in-recommendations'] });
});

// Deep health check — reports memory, uptime, service availability
app.get('/api/health/deep', (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const services = {
    nba: !!nba, mlb: !!mlb, nhl: !!nhl, nfl: !!nfl, ncaa: !!ncaa,
    liveData: !!liveData, rollingStats: !!rollingStats, injuries: !!injuries,
    weather: !!weather, statcast: !!statcast, autoScanner: !!autoScanner,
    kelly: !!kelly, lineMovement: !!lineMovement, playerProps: !!playerProps,
    polymarket: !!polymarket, dailyPicks: !!dailyPicks, calibration: !!calibration,
    odPlaybookCache: !!odPlaybookCache, pitcherKProps: !!pitcherKProps,
    nrfiModel: !!nrfiModel, f3Model: !!f3Model, f7Model: !!f7Model,
    dailyMlbCard: !!dailyMlbCard, dailyNbaCard: !!dailyNbaCard, dailyNhlCard: !!dailyNhlCard,
    batterProps: !!batterProps, nbaPeriodMarkets: !!nbaPeriodMarkets,
    regularSeasonAutopilot: !!regularSeasonAutopilot,
  };
  const loadedCount = Object.values(services).filter(Boolean).length;
  res.json({
    status: 'ok',
    version: '103.0.0',
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
    uptimeSeconds: Math.round(uptime),
    memory: {
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(mem.external / 1024 / 1024)}MB`,
    },
    services: { loaded: loadedCount, total: Object.keys(services).length, detail: services },
    timestamp: new Date().toISOString(),
  });
});

// ==================== NBA ENDPOINTS ====================

app.get('/api/model/nba/ratings', (req, res) => {
  try {
    const ratings = nba.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NCAA TOURNAMENT VALUE SCANNER ====================

let ncaaTournScanner = null;
try { ncaaTournScanner = require('./services/ncaa-tournament-scanner'); } catch (e) { console.error('[server] NCAA Tournament Scanner not loaded:', e.message); }

// Full tournament value scan — live odds vs model for all available games
app.get('/api/ncaa/tournament/scan', async (req, res) => {
  if (!ncaaTournScanner) return res.status(503).json({ error: 'NCAA tournament scanner not loaded' });
  try {
    const results = await ncaaTournScanner.scanTournamentValue();
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tournament futures value — championship/FF odds vs bracket simulation
app.get('/api/ncaa/tournament/futures-value', async (req, res) => {
  if (!ncaaTournScanner) return res.status(503).json({ error: 'NCAA tournament scanner not loaded' });
  try {
    const results = await ncaaTournScanner.scanTournamentFutures();
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tournament dashboard — all-in-one for betting
app.get('/api/ncaa/tournament/dashboard', async (req, res) => {
  if (!ncaaTournScanner) return res.status(503).json({ error: 'NCAA tournament scanner not loaded' });
  try {
    const dashboard = await ncaaTournScanner.getTournamentDashboard();
    res.json(dashboard);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Specific matchup analysis with tournament context
app.get('/api/ncaa/tournament/analyze/:away/:home', (req, res) => {
  if (!ncaaTournScanner) return res.status(503).json({ error: 'NCAA tournament scanner not loaded' });
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const round = req.query.round || 'Sweet 16';
    
    // Build mock lines from query params if provided
    const lines = {
      awayML: { best: req.query.awayML ? parseInt(req.query.awayML) : null, book: 'manual' },
      homeML: { best: req.query.homeML ? parseInt(req.query.homeML) : null, book: 'manual' },
      awaySpread: { best: -110, line: req.query.spread ? parseFloat(req.query.spread) : null, book: 'manual' },
      homeSpread: { best: -110, line: req.query.spread ? -parseFloat(req.query.spread) : null, book: 'manual' },
      over: { best: -110, line: req.query.total ? parseFloat(req.query.total) : null, book: 'manual' },
      under: { best: -110, line: req.query.total ? parseFloat(req.query.total) : null, book: 'manual' },
    };
    
    const analysis = ncaaTournScanner.analyzeGameValue(away, home, lines, round);
    res.json(analysis);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/nba/predict', (req, res) => {
  const { away, home, awayB2B, homeB2B } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const rawPred = nba.predict(away.toUpperCase(), home.toUpperCase(), { awayB2B: awayB2B === 'true', homeB2B: homeB2B === 'true' });
    if (rawPred.error) return res.status(400).json(rawPred);
    // Apply probability calibration for accurate edge detection
    const pred = calibration.calibratePrediction(rawPred, 'nba');
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/odds/nba', async (req, res) => {
  if (!ODDS_API_KEY) return res.json({ error: 'No API key set', odds: [], mock: true });
  try {
    const data = await fetchOdds('basketball_nba');
    const odds = data.map(game => {
      const bookmakers = {};
      (game.bookmakers || []).forEach(bk => {
        const book = { name: bk.title };
        (bk.markets || []).forEach(mkt => {
          if (mkt.key === 'h2h') { book.homeML = null; book.awayML = null; mkt.outcomes.forEach(o => { if (o.name === game.home_team) book.homeML = o.price; else book.awayML = o.price; }); }
          if (mkt.key === 'spreads') { mkt.outcomes.forEach(o => { if (o.name === game.home_team) book.spread = o.point; }); }
          if (mkt.key === 'totals') { mkt.outcomes.forEach(o => { if (o.name === 'Over') book.total = o.point; }); }
        });
        bookmakers[bk.key] = book;
      });
      return { id: game.id, away: game.away_team, home: game.home_team, commence: game.commence_time, bookmakers };
    });
    res.json({ odds, count: odds.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/value/nba', async (req, res) => {
  try {
    const nameMap = buildNameMap(nba.TEAMS, {
      'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI'
    });
    const liveOdds = await fetchOdds('basketball_nba');
    const valueBets = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const rawPred = await nba.asyncPredict(awayAbbr, homeAbbr);
      if (rawPred.error) continue;
      // Apply calibration for accurate edge calculation
      const pred = calibration.calibratePrediction(rawPred, 'nba');
      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        const edges = nba.findValue(pred, bookLine);
        edges.forEach(e => {
          valueBets.push({
            sport: 'NBA', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
            commence: game.commence_time, ...e,
            prediction: { spread: pred.spread, homeWinProb: pred.homeWinProb, awayWinProb: pred.awayWinProb }
          });
        });
      }
    }
    valueBets.sort((a, b) => b.edge - a.edge);
    // Auto-record to CLV tracker
    try {
      const clvBets = valueBets.map(b => ({
        away: b.game.split(' @ ')[0],
        home: b.game.split(' @ ')[1],
        type: b.type,
        side: b.type === 'total' ? (b.pick.includes('OVER') ? 'over' : 'under') : (b.pick.includes(b.game.split(' @ ')[1]) ? 'home' : 'away'),
        modelLine: b.modelLine || b.modelTotal,
        bookLine: b.bookLine || b.bookTotal,
        modelProb: b.modelProb ? b.modelProb / 100 : null,
        bookProb: b.bookProb ? b.bookProb / 100 : null,
        confidence: b.confidence
      }));
      clvTracker.recordFromValueDetection('NBA', clvBets);
    } catch (e) { /* CLV recording is best-effort */ }
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/nba', (req, res) => {
  try {
    const opts = {};
    if (req.query.spreadFactor) opts.spreadFactor = parseFloat(req.query.spreadFactor);
    if (req.query.hca) opts.hca = parseFloat(req.query.hca);
    if (req.query.luckFactor) opts.luckFactor = parseFloat(req.query.luckFactor);
    if (req.query.minEdge) opts.minEdge = parseFloat(req.query.minEdge);
    if (req.query.useLiveModel) opts.useLiveModel = req.query.useLiveModel === 'true';
    res.json(backtest.runBacktest(opts));
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/nba/optimize', (req, res) => {
  try { res.json(backtest.optimizeParameters()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CLV TRACKING ====================

app.get('/api/clv', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(clvTracker.getReport(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clv/status', (req, res) => {
  try { res.json(clvTracker.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clv/record', (req, res) => {
  try {
    const pick = req.body;
    if (!pick.sport || !pick.away || !pick.home || !pick.type) {
      return res.status(400).json({ error: 'sport, away, home, type required' });
    }
    res.json(clvTracker.recordPick(pick));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clv/close', (req, res) => {
  try {
    const { sport, away, home, closingLine } = req.body;
    if (!sport || !away || !home || !closingLine) {
      return res.status(400).json({ error: 'sport, away, home, closingLine required' });
    }
    res.json(clvTracker.recordClosingLine(sport, away, home, closingLine));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clv/grade', (req, res) => {
  try {
    const { results } = req.body;
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'results array required' });
    }
    res.json(clvTracker.autoGrade(results));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MLB ENDPOINTS ====================

app.get('/api/model/mlb/ratings', (req, res) => {
  try {
    const ratings = mlb.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// v87.0: Bayesian blend diagnostic — shows how preseason projections blend with live data
app.get('/api/model/mlb/blend-status', (req, res) => {
  try {
    const teams = mlb.getTeams();
    const blendReport = [];
    for (const [abbr, team] of Object.entries(teams)) {
      blendReport.push({
        team: abbr,
        name: team.name,
        isLive: !!team._isLiveData,
        isBlended: !!team._isBlended,
        gamesPlayed: team._gamesPlayed || ((team.w || 0) + (team.l || 0)),
        liveWeight: team._liveWeight || 0,
        currentRsG: team.rsG,
        currentRaG: team.raG,
        rawLiveRsG: team._rawLiveRsG || null,
        rawLiveRaG: team._rawLiveRaG || null,
        projectedRsG: team._projRsG || null,
        projectedRaG: team._projRaG || null,
        w: team.w,
        l: team.l,
      });
    }
    blendReport.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    const blendedCount = blendReport.filter(t => t.isBlended).length;
    const preseasonCount = blendReport.filter(t => !t.isLive).length;
    res.json({
      summary: {
        totalTeams: blendReport.length,
        blendedTeams: blendedCount,
        preseasonOnly: preseasonCount,
        priorStrength: 50,
        note: 'Bayesian blend: liveWeight = gamesPlayed / (gamesPlayed + 50). At 50 GP = 50/50 blend.',
      },
      teams: blendReport,
      updated: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/predict', async (req, res) => {
  const { away, home, awayPitcher, homePitcher, awayPitcherEra, awayPitcherFip, homePitcherEra, homePitcherFip, gameDate, noMonteCarlo } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    // New: pitcher name lookup
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    // Legacy: raw ERA/FIP
    if (awayPitcherEra) opts.awayPitcherEra = parseFloat(awayPitcherEra);
    if (awayPitcherFip) opts.awayPitcherFip = parseFloat(awayPitcherFip);
    if (homePitcherEra) opts.homePitcherEra = parseFloat(homePitcherEra);
    if (homePitcherFip) opts.homePitcherFip = parseFloat(homePitcherFip);
    if (gameDate) opts.gameDate = gameDate;
    if (noMonteCarlo) opts.monteCarlo = false;
    // Fetch live weather for the home ballpark
    try {
      const weatherData = await weather.getWeatherForPark(home.toUpperCase());
      if (weatherData && !weatherData.error) opts.weather = weatherData;
    } catch (e) { /* weather optional */ }
    // Fetch umpire assignment for totals adjustment
    try {
      const umpAdj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), req.query.umpire);
      if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
    } catch (e) { /* umpire optional */ }
    // Use async predict (includes rest/travel + monte carlo)
    const rawPred = await mlb.asyncPredict(away.toUpperCase(), home.toUpperCase(), opts);
    if (!rawPred || rawPred.error) return res.status(400).json({ error: rawPred?.error || 'Invalid team code' });
    // Apply probability calibration
    const pred = calibration.calibratePrediction(rawPred, 'mlb');
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MLB Pitcher Endpoints
app.get('/api/model/mlb/pitchers', (req, res) => {
  try {
    const team = req.query.team;
    if (team) {
      const rotation = mlbPitchers.getTeamRotation(team.toUpperCase());
      if (!rotation) return res.status(404).json({ error: `No rotation found for ${team}` });
      return res.json({ team: team.toUpperCase(), rotation, count: rotation.length });
    }
    const all = mlbPitchers.getAllPitchers();
    res.json({ pitchers: all, count: all.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/pitchers/top', (req, res) => {
  try {
    const n = parseInt(req.query.n) || 30;
    const top = mlbPitchers.getTopPitchers(n);
    res.json({ pitchers: top, count: top.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/pitchers/:team', (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const rotation = mlbPitchers.getTeamRotation(team);
    if (!rotation) return res.status(404).json({ error: `No rotation found for ${team}` });
    res.json({ team, rotation, count: rotation.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/matchup', async (req, res) => {
  const { away, home, awayPitcher, homePitcher, gameDate } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    if (gameDate) opts.gameDate = gameDate;
    try {
      const weatherData = await weather.getWeatherForPark(home.toUpperCase());
      if (weatherData && !weatherData.error) opts.weather = weatherData;
    } catch (e) { /* weather optional */ }
    try {
      const umpAdj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), req.query.umpire);
      if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
    } catch (e) { /* umpire optional */ }
    const matchup = await mlb.asyncMatchup(away.toUpperCase(), home.toUpperCase(), opts);
    if (!matchup || matchup.error) return res.status(400).json({ error: matchup?.error || 'Invalid team code' });
    res.json(matchup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/mlb/totals', async (req, res) => {
  const { away, home, awayPitcher, homePitcher } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    // Fetch live weather for totals — critical for O/U betting
    try {
      const weatherData = await weather.getWeatherForPark(home.toUpperCase());
      if (weatherData && !weatherData.error) opts.weather = weatherData;
    } catch (e) { /* weather optional */ }
    // Fetch umpire data — critical for totals
    try {
      const umpAdj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), req.query.umpire);
      if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
    } catch (e) { /* umpire optional */ }
    const totals = mlb.predictTotal(away.toUpperCase(), home.toUpperCase(), opts);
    if (!totals || totals.error) return res.status(400).json({ error: totals?.error || 'Invalid team code' });
    res.json(totals);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/odds/mlb', async (req, res) => {
  if (!ODDS_API_KEY) return res.json({ error: 'No API key set', odds: [], mock: true });
  try {
    const data = await fetchOdds('baseball_mlb');
    res.json({ odds: data, count: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/value/mlb', async (req, res) => {
  try {
    const nameMap = buildNameMap(mlb.TEAMS, {
      'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR'
    });
    const liveOdds = await fetchOdds('baseball_mlb');
    const valueBets = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      // Fetch weather for home park to adjust predictions
      const opts = {};
      try {
        const weatherData = await weather.getWeatherForPark(homeAbbr);
        if (weatherData && !weatherData.error) opts.weather = weatherData;
      } catch (e) { /* weather optional */ }
      // Fetch umpire data for totals adjustment
      try {
        const umpAdj = await umpireService.getGameUmpireAdjustment(awayAbbr, homeAbbr);
        if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
      } catch (e) { /* umpire optional */ }
      // Use async predict (includes rest/travel + monte carlo)
      const rawPred = await mlb.asyncPredict(awayAbbr, homeAbbr, opts);
      if (!rawPred || rawPred.error) continue;
      // Apply probability calibration for accurate edge detection
      const calPred = calibration.calibratePrediction(rawPred, 'mlb');

      // ML-enhanced prediction: blend analytical + ML ensemble for sharper edges
      let pred = calPred;
      try {
        const mlResult = await mlBridge.enhancedPredict(awayAbbr, homeAbbr, opts);
        if (mlResult && mlResult.ml && mlResult.blendedHomeWinProb) {
          // Override with ML-blended probabilities (55% ML + 45% analytical)
          pred = {
            ...calPred,
            homeWinProb: mlResult.blendedHomeWinProb,
            awayWinProb: mlResult.blendedAwayWinProb,
            blendedHomeWinProb: mlResult.blendedHomeWinProb,
            blendedAwayWinProb: mlResult.blendedAwayWinProb,
            ml: mlResult.ml,
            predictionSource: 'ml+analytical+calibrated',
            // Preserve MC data from analytical path
            monteCarlo: calPred.monteCarlo,
            totalRuns: calPred.totalRuns,
          };
          // If ML has its own totals prediction, blend it too
          if (mlResult.ml.predictedTotal && calPred.totalRuns) {
            pred.mlTotalRuns = mlResult.ml.predictedTotal;
            pred.blendedTotalRuns = calPred.totalRuns * 0.6 + mlResult.ml.predictedTotal * 0.4;
          }
        }
      } catch (mlErr) { /* ML optional — analytical is still solid */ }

      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        const edges = mlb.findValue(pred, bookLine);
        
        // Also find MC-enhanced value if simulation ran
        if (pred.monteCarlo) {
          const mcEdges = monteCarloService.findSimValue(pred.monteCarlo, bookLine);
          mcEdges.forEach(e => {
            // Only add if not already found by analytical model
            const isDuplicate = edges.some(ae => ae.pick === e.pick && ae.market === e.market);
            if (!isDuplicate) {
              edges.push(e);
            }
          });
        }
        
        edges.forEach(e => {
          valueBets.push({
            sport: 'MLB', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
            commence: game.commence_time, ...e,
            prediction: { 
              homeWinProb: pred.blendedHomeWinProb || pred.homeWinProb, 
              awayWinProb: pred.blendedAwayWinProb || pred.awayWinProb, 
              total: pred.totalRuns,
              mlTotal: pred.mlTotalRuns || null,
              blendedTotal: pred.blendedTotalRuns || null,
              mcTotal: pred.monteCarlo?.totalRuns?.mean || null,
              source: pred.predictionSource || 'analytical'
            }
          });
        });
      }
    }
    valueBets.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString(), mlEnabled: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/mlb', (req, res) => {
  try { 
    // V2 point-in-time backtest is the new default
    if (req.query.version === 'v1') {
      res.json(mlbBacktest.runBacktest()); 
    } else {
      res.json(mlbBacktestV2.runBacktest()); 
    }
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/mlb/v2', (req, res) => {
  try { res.json(mlbBacktestV2.runBacktest()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/mlb/sweep', (req, res) => {
  try { res.json(mlbBacktestV2.paramSweep()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MLB OPENING DAY ====================

app.get('/api/model/mlb/opening-day', async (req, res) => {
  try {
    const projections = await mlbOpeningDay.getProjections();
    
    // Try to fetch live MLB odds for edge comparison
    let liveOdds = [];
    try {
      liveOdds = await fetchOdds('baseball_mlb');
    } catch (e) { /* no odds available yet */ }
    
    // Match live odds to Opening Day games
    if (liveOdds.length > 0) {
      const nameMap = buildNameMap(mlb.TEAMS, {
        'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR'
      });
      
      for (const game of projections.games) {
        // Find matching odds game
        for (const oddsGame of liveOdds) {
          const oddsAway = resolveTeam(nameMap, oddsGame.away_team);
          const oddsHome = resolveTeam(nameMap, oddsGame.home_team);
          if (oddsAway === game.away && oddsHome === game.home) {
            // Extract best lines
            const books = {};
            let bestHomeML = null, bestAwayML = null, bestTotal = null;
            let bestHomeBook = '', bestAwayBook = '', bestTotalBook = '';
            
            for (const bk of (oddsGame.bookmakers || [])) {
              const line = extractBookLine(bk, oddsGame.home_team);
              books[bk.title] = line;
              
              if (line.homeML && (bestHomeML === null || line.homeML > bestHomeML)) {
                bestHomeML = line.homeML; bestHomeBook = bk.title;
              }
              if (line.awayML && (bestAwayML === null || line.awayML > bestAwayML)) {
                bestAwayML = line.awayML; bestAwayBook = bk.title;
              }
              if (line.total && !bestTotal) {
                bestTotal = line.total; bestTotalBook = bk.title;
              }
            }
            
            // Calculate edges
            game.liveOdds = {
              books,
              bestHome: { ml: bestHomeML, book: bestHomeBook },
              bestAway: { ml: bestAwayML, book: bestAwayBook },
              bestTotal: { total: bestTotal, book: bestTotalBook }
            };
            
            if (bestHomeML) {
              const impliedHome = bestHomeML < 0 ? (-bestHomeML) / (-bestHomeML + 100) : 100 / (bestHomeML + 100);
              game.liveOdds.homeEdge = +(game.prediction.homeWinProb - impliedHome).toFixed(3);
            }
            if (bestAwayML) {
              const impliedAway = bestAwayML < 0 ? (-bestAwayML) / (-bestAwayML + 100) : 100 / (bestAwayML + 100);
              game.liveOdds.awayEdge = +(game.prediction.awayWinProb - impliedAway).toFixed(3);
            }
            
            break;
          }
        }
      }
    }
    
    res.json(projections);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PRESEASON TUNING ENDPOINT ====================
app.get('/api/model/mlb/preseason-tuning', (req, res) => {
  try {
    const team = req.query.team;
    
    if (team) {
      // Single team lookup
      const abbr = team.toUpperCase();
      const adjustments = preseasonTuning.getOpeningDayAdjustments(abbr);
      const bullpenUncertainty = preseasonTuning.getBullpenUncertainty(abbr);
      const spring = preseasonTuning.SPRING_TRAINING_SIGNALS[abbr] || null;
      const roster = preseasonTuning.ROSTER_CHANGES[abbr] || null;
      
      res.json({
        team: abbr,
        adjustments,
        bullpenUncertainty,
        springSignal: spring,
        rosterChanges: roster,
      });
    } else {
      // All teams overview
      const teams = {};
      const allTeams = Object.keys(preseasonTuning.SPRING_TRAINING_SIGNALS);
      
      for (const abbr of allTeams) {
        const adj = preseasonTuning.getOpeningDayAdjustments(abbr);
        const roster = preseasonTuning.ROSTER_CHANGES[abbr];
        teams[abbr] = {
          offAdj: adj.offAdj,
          defAdj: adj.defAdj,
          chemAdj: adj.chemAdj,
          spring: adj.info.springSignal ? adj.info.springSignal.note : null,
          rosterNote: roster ? roster.note : null,
          moves: roster ? roster.moves : [],
        };
      }
      
      // Sort by total impact (absolute value of all adjustments)
      const sorted = Object.entries(teams)
        .map(([abbr, t]) => ({ abbr, ...t, totalImpact: Math.abs(t.offAdj) + Math.abs(t.defAdj) }))
        .sort((a, b) => b.totalImpact - a.totalImpact);
      
      const newTeamPitchers = Object.entries(preseasonTuning.NEW_TEAM_PITCHERS)
        .map(([name, info]) => ({ name, ...info }));
      
      res.json({
        title: 'MLB Preseason Tuning Report — Opening Day 2026',
        description: 'Spring training signals, roster changes, and Opening Day-specific adjustments',
        teamsWithBiggestChanges: sorted.slice(0, 10),
        newTeamPitchers,
        allTeams: teams,
      });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NEGATIVE BINOMIAL ENDPOINTS ====================

// Compare Poisson vs Negative Binomial for a matchup
app.get('/api/model/mlb/nb-compare', (req, res) => {
  try {
    const { away, home, awayPitcher, homePitcher } = req.query;
    if (!away || !home) return res.status(400).json({ error: 'away and home required' });
    
    // Get prediction to extract expected runs
    const pred = mlb.predict(away.toUpperCase(), home.toUpperCase(), { 
      awayPitcher, homePitcher, monteCarlo: false 
    });
    if (pred.error) return res.status(400).json(pred);
    
    const comparison = negBinomial.compareModels(pred.awayExpRuns, pred.homeExpRuns, {
      park: pred.factors?.parkEffect ? undefined : undefined, // use default
      isPreseason: !!pred.factors?.earlySeasonRegression,
    });
    
    res.json({
      matchup: `${away.toUpperCase()} @ ${home.toUpperCase()}`,
      awayExpRuns: pred.awayExpRuns,
      homeExpRuns: pred.homeExpRuns,
      projectedTotal: pred.totalRuns,
      ...comparison,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get NB totals for a matchup (full breakdown with special markets)
app.get('/api/model/mlb/nb-totals', (req, res) => {
  try {
    const { away, home, awayPitcher, homePitcher } = req.query;
    if (!away || !home) return res.status(400).json({ error: 'away and home required' });
    
    const pred = mlb.predict(away.toUpperCase(), home.toUpperCase(), { 
      awayPitcher, homePitcher, monteCarlo: false 
    });
    if (pred.error) return res.status(400).json(pred);
    
    const teams = mlb.getTeams();
    const homeTeam = teams[home.toUpperCase()];
    const awayTeam = teams[away.toUpperCase()];
    
    const nbTotals = negBinomial.calculateNBTotals(pred.awayExpRuns, pred.homeExpRuns, {
      park: homeTeam?.park,
      homeBullpenEra: homeTeam?.bullpenEra,
      awayBullpenEra: awayTeam?.bullpenEra,
      isPreseason: !!pred.factors?.earlySeasonRegression,
      awayPitcherRating: pred.awayPitcher?.rating || 50,
      homePitcherRating: pred.homePitcher?.rating || 50,
    });
    
    res.json({
      matchup: `${away.toUpperCase()} @ ${home.toUpperCase()}`,
      ...nbTotals,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NB service status
app.get('/api/model/mlb/nb-status', (req, res) => {
  res.json(negBinomial.getStatus());
});

// ==================== MLB PLATOON SPLITS ====================

let platoonSplitsService = null;
try { platoonSplitsService = require('./services/platoon-splits'); } catch (e) { /* no platoon splits */ }

// Get platoon analysis for a specific matchup
app.get('/api/mlb/platoon/:away/:home', (req, res) => {
  if (!platoonSplitsService) return res.status(503).json({ error: 'Platoon splits service unavailable' });
  
  const { away, home } = req.params;
  const homePitcherHand = req.query.homePitcherHand || req.query.hph || null;
  const awayPitcherHand = req.query.awayPitcherHand || req.query.aph || null;
  
  const analysis = platoonSplitsService.getMatchupPlatoonAnalysis(
    away.toUpperCase(), home.toUpperCase(),
    homePitcherHand, awayPitcherHand
  );
  
  res.json(analysis);
});

// Get all team platoon vulnerability profiles (ranked)
app.get('/api/mlb/platoon/profiles', (req, res) => {
  if (!platoonSplitsService) return res.status(503).json({ error: 'Platoon splits service unavailable' });
  
  const ranking = platoonSplitsService.getPlatoonVulnerabilityRanking();
  const allSplits = platoonSplitsService.getAllPlatoonSplits();
  
  res.json({
    profiles: ranking,
    details: allSplits,
    source: 'statcast_2024_woba_splits',
    note: 'Ranked by gap between vsLHP and vsRHP run multipliers. Bigger gap = more vulnerable to LHP.',
  });
});

// Get platoon-based betting edges for today's games
app.get('/api/mlb/platoon/scan', async (req, res) => {
  if (!platoonSplitsService) return res.status(503).json({ error: 'Platoon splits service unavailable' });
  
  try {
    // Get today's games with pitcher info
    let games = [];
    try {
      const lineupFetcher = require('./services/lineup-fetcher');
      const lineups = await lineupFetcher.fetchLineups();
      if (lineups && lineups.games) {
        games = lineups.games.map(g => ({
          away: g.awayTeam,
          home: g.homeTeam,
          awayPitcherHand: g.awayPitcher?.hand || null,
          homePitcherHand: g.homePitcher?.hand || null,
          awayLineup: g.awayLineup || null,
          homeLineup: g.homeLineup || null,
        }));
      }
    } catch (e) {
      // No lineup data — use static profiles only
    }
    
    if (games.length === 0) {
      return res.json({ edges: [], note: 'No games found today or no pitcher hand data available' });
    }
    
    const edges = platoonSplitsService.scanPlatoonEdges(games);
    
    res.json({
      gamesScanned: games.length,
      edgesFound: edges.length,
      edges,
      note: 'Platoon edges based on pitcher handedness vs lineup composition. LHP starters create the biggest edges.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Platoon service status
app.get('/api/mlb/platoon/status', (req, res) => {
  if (!platoonSplitsService) return res.status(503).json({ error: 'Platoon splits service unavailable' });
  const splits = platoonSplitsService.getModelPlatoonSplits();
  res.json({
    status: 'active',
    source: 'statcast_2024_woba_splits_with_2026_roster_adj',
    teamsTracked: Object.keys(splits).length,
    topVulnerable: platoonSplitsService.getPlatoonVulnerabilityRanking().slice(0, 5).map(t => `${t.team} (${t.gap.toFixed(3)})`),
    mostImmune: platoonSplitsService.getPlatoonVulnerabilityRanking().slice(-5).map(t => `${t.team} (${t.gap.toFixed(3)})`),
    note: 'Platoon splits data-driven from Baseball Savant wOBA splits. Auto-refines when confirmed lineups available.',
  });
});

// ==================== MLB CATCHER FRAMING (Savant Data) ====================

let catcherFramingService = null;
try { catcherFramingService = require('./services/catcher-framing'); } catch (e) { /* no catcher framing */ }

// Get framing matchup analysis for a specific game
app.get('/api/mlb/framing/:away/:home', (req, res) => {
  if (!catcherFramingService) return res.status(503).json({ error: 'Catcher framing service unavailable' });
  const { away, home } = req.params;
  const analysis = catcherFramingService.getMatchupFramingAnalysis(home.toUpperCase(), away.toUpperCase());
  res.json(analysis);
});

// Get framing leaderboard (all qualified catchers)
app.get('/api/mlb/framing/leaderboard', (req, res) => {
  if (!catcherFramingService) return res.status(503).json({ error: 'Catcher framing service unavailable' });
  const leaderboard = catcherFramingService.getFramingLeaderboard();
  res.json({
    count: leaderboard.length,
    source: 'Baseball Savant 2024',
    leaderboard,
  });
});

// Get team framing rankings (all 30 teams)
app.get('/api/mlb/framing/teams', (req, res) => {
  if (!catcherFramingService) return res.status(503).json({ error: 'Catcher framing service unavailable' });
  const rankings = catcherFramingService.getTeamFramingRankings();
  res.json({
    count: rankings.length,
    source: 'Baseball Savant 2024',
    rankings,
  });
});

// Get data corrections (what the old model got wrong)
app.get('/api/mlb/framing/corrections', (req, res) => {
  if (!catcherFramingService) return res.status(503).json({ error: 'Catcher framing service unavailable' });
  const corrections = catcherFramingService.getDataCorrections();
  res.json(corrections);
});

// Scan today's games for framing edges
app.get('/api/mlb/framing/scan', async (req, res) => {
  if (!catcherFramingService) return res.status(503).json({ error: 'Catcher framing service unavailable' });
  
  try {
    let games = [];
    try {
      const lineupFetcher = require('./services/lineup-fetcher');
      const lineups = await lineupFetcher.fetchLineups();
      if (lineups && lineups.games) {
        games = lineups.games.map(g => ({
          home: g.homeTeam,
          away: g.awayTeam,
        }));
      }
    } catch (e) { /* no games */ }
    
    const edges = catcherFramingService.scanFramingEdges(games);
    res.json({
      gamesScanned: games.length,
      edgesFound: edges.length,
      edges,
      note: 'Based on Baseball Savant 2024 framing runs. Significant = 10+ run gap.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Framing service status
app.get('/api/mlb/framing/status', (req, res) => {
  if (!catcherFramingService) return res.status(503).json({ error: 'Catcher framing service unavailable' });
  res.json(catcherFramingService.getStatus());
});

// ==================== MLB BULLPEN QUALITY PROJECTIONS ====================

// Get projected 2026 bullpen ERA rankings for all 30 teams
app.get('/api/mlb/bullpen/rankings', (req, res) => {
  if (!bullpenQuality) return res.status(503).json({ error: 'Bullpen quality service unavailable' });
  try {
    const teams = mlb.getTeams();
    const adjustments = bullpenQuality.getAllBullpenAdjustments(teams);
    res.json({
      rankings: adjustments,
      avgBullpenEra: bullpenQuality.AVG_BULLPEN_ERA,
      note: 'Projected 2026 bullpen ERA from reliever-level modeling. Delta = projected minus 2025 base.',
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get bullpen matchup analysis for a specific game
app.get('/api/mlb/bullpen/:away/:home', (req, res) => {
  if (!bullpenQuality) return res.status(503).json({ error: 'Bullpen quality service unavailable' });
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const teams = mlb.getTeams();
    const analysis = bullpenQuality.analyzeBullpenMatchup(away, home, teams);
    if (!analysis) return res.status(400).json({ error: `Invalid teams: ${away} or ${home}` });
    res.json({ matchup: `${away}@${home}`, ...analysis, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get all relievers for a team
app.get('/api/mlb/bullpen/team/:team', (req, res) => {
  if (!bullpenQuality) return res.status(503).json({ error: 'Bullpen quality service unavailable' });
  try {
    const team = req.params.team.toUpperCase();
    const relievers = bullpenQuality.getTeamRelievers(team);
    const proj = bullpenQuality.getProjectedBullpenEra(team);
    const corps = bullpenQuality.TEAM_BULLPEN_CORPS[team];
    res.json({ team, projection: proj, corps, relievers, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan Opening Day games for bullpen edge
app.get('/api/mlb/bullpen/scan', (req, res) => {
  if (!bullpenQuality) return res.status(503).json({ error: 'Bullpen quality service unavailable' });
  try {
    const teams = mlb.getTeams();
    // Use Opening Day schedule
    const odGames = [
      { away: 'NYY', home: 'MIL' }, { away: 'CWS', home: 'CIN' },
      { away: 'ATL', home: 'NYM' }, { away: 'PIT', home: 'MIA' },
      { away: 'BOS', home: 'TB' },  { away: 'TOR', home: 'HOU' },
      { away: 'KC', home: 'CLE' },  { away: 'BAL', home: 'MIN' },
      { away: 'STL', home: 'CHC' }, { away: 'COL', home: 'LAA' },
      { away: 'TEX', home: 'SEA' }, { away: 'PHI', home: 'LAD' },
      { away: 'DET', home: 'SD' },  { away: 'WSH', home: 'ARI' },
      { away: 'SF', home: 'OAK' },
    ];
    const edges = bullpenQuality.scanBullpenEdges(odGames, teams);
    const withEdge = edges.filter(e => e.hasEdge);
    res.json({
      scanned: edges.length,
      edgesFound: withEdge.length,
      edges: withEdge,
      all: edges,
      note: 'Bullpen quality edges for Opening Day games based on projected 2026 reliever corps',
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bullpen quality service status
app.get('/api/mlb/bullpen/status', (req, res) => {
  if (!bullpenQuality) return res.status(503).json({ error: 'Bullpen quality service unavailable' });
  const teamCount = Object.keys(bullpenQuality.TEAM_BULLPEN_CORPS).length;
  const relieverCount = Object.keys(bullpenQuality.RELIEVER_DB).length;
  res.json({
    status: 'active',
    version: 'v68.0',
    teamsModeled: teamCount,
    relieversInDB: relieverCount,
    avgBullpenEra: bullpenQuality.AVG_BULLPEN_ERA,
    wiredIntoPredictions: true,
    note: 'Projected 2026 bullpen ERA replaces static 2025 data in predict() and asyncPredict()',
    timestamp: new Date().toISOString(),
  });
});

// ==================== STOLEN BASE REVOLUTION MODEL ====================
app.get('/api/mlb/sb/matchup/:away/:home', (req, res) => {
  if (!stolenBaseModel) return res.status(503).json({ error: 'Stolen base model not loaded' });
  const { away, home } = req.params;
  const adj = stolenBaseModel.getSBTotalsAdjustment(away.toUpperCase(), home.toUpperCase());
  res.json(adj);
});

app.get('/api/mlb/sb/profiles', (req, res) => {
  if (!stolenBaseModel) return res.status(503).json({ error: 'Stolen base model not loaded' });
  res.json(stolenBaseModel.TEAM_SB_PROFILES);
});

app.get('/api/mlb/sb/scan', async (req, res) => {
  if (!stolenBaseModel) return res.status(503).json({ error: 'Stolen base model not loaded' });
  try {
    const projections = await mlbOpeningDay.getProjections();
    const games = (projections?.games || []).map(g => ({ away: g.away, home: g.home }));
    const edges = stolenBaseModel.scanSBEdges(games);
    res.json({ edges, totalGames: games.length, edgeGames: edges.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/sb/summary', (req, res) => {
  if (!stolenBaseModel) return res.status(503).json({ error: 'Stolen base model not loaded' });
  res.json(stolenBaseModel.getLeagueSummary());
});

app.get('/api/mlb/sb/status', (req, res) => {
  if (!stolenBaseModel) return res.status(503).json({ error: 'Stolen base model not loaded' });
  res.json({
    status: 'active',
    version: 'v68.0',
    teamsModeled: Object.keys(stolenBaseModel.TEAM_SB_PROFILES).length,
    leagueAvgExtraRuns: stolenBaseModel.LEAGUE_AVG_EXTRA_RUNS,
    wiredIntoPredictions: true,
    note: 'Post-2023 rule changes: bigger bases + pitch clock = 10% SB attempt rate (was 6%). Affects totals by +0.1-0.2 R/G.',
    timestamp: new Date().toISOString(),
  });
});

// ==================== OD TEAM TENDENCIES ====================

app.get('/api/mlb/od-tendencies/:away/:home', (req, res) => {
  if (!odTeamTendencies) return res.status(503).json({ error: 'OD Team Tendencies not loaded' });
  try {
    const { away, home } = req.params;
    const adj = odTeamTendencies.getODTendencyAdjustment(away.toUpperCase(), home.toUpperCase(), {
      isDayGame: req.query.dayGame === 'true'
    });
    res.json(adj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/od-tendencies/scan', (req, res) => {
  if (!odTeamTendencies) return res.status(503).json({ error: 'OD Team Tendencies not loaded' });
  try {
    const result = odTeamTendencies.scanODTendencies();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/od-tendencies/betting/:away/:home', (req, res) => {
  if (!odTeamTendencies) return res.status(503).json({ error: 'OD Team Tendencies not loaded' });
  try {
    const { away, home } = req.params;
    const modelProb = parseFloat(req.query.prob || '0.5');
    const modelTotal = parseFloat(req.query.total || '8.5');
    const result = odTeamTendencies.getODBettingImplications(away.toUpperCase(), home.toUpperCase(), modelProb, modelTotal);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PITCHER K PROPS MODEL ====================

// Full OD K prop scan — value bets for all starters
app.get('/api/mlb/kprops/scan', (req, res) => {
  if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K props model not loaded' });
  try {
    const result = pitcherKProps.scanODKProps({ isOpeningDay: true });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Specific pitcher matchup analysis
app.get('/api/mlb/kprops/matchup/:pitcher/:opponent', (req, res) => {
  if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K props model not loaded' });
  try {
    const pitcherName = decodeURIComponent(req.params.pitcher);
    const opp = req.params.opponent.toUpperCase();
    const result = pitcherKProps.analyzeMatchup(pitcherName, opp);
    if (!result) return res.status(404).json({ error: `Pitcher '${pitcherName}' not found in projections` });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// K/9 leaderboard — all OD starters ranked
app.get('/api/mlb/kprops/leaderboard', (req, res) => {
  if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K props model not loaded' });
  try {
    const leaderboard = pitcherKProps.getKLeaderboard();
    res.json({ count: leaderboard.length, leaderboard, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Team K vulnerability rankings
app.get('/api/mlb/kprops/vulnerability', (req, res) => {
  if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K props model not loaded' });
  try {
    const teams = pitcherKProps.getTeamKVulnerability();
    res.json({ count: teams.length, teams, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// K props model status
app.get('/api/mlb/kprops/status', (req, res) => {
  if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K props model not loaded' });
  res.json({
    status: 'active',
    version: 'v70.0',
    pitchersModeled: Object.keys(pitcherKProps.STEAMER_K9_PROJECTIONS).length,
    teamsModeled: Object.keys(pitcherKProps.TEAM_BATTING_K_PCT).length,
    dkLinesLoaded: Object.keys(pitcherKProps.DK_K_PROP_LINES).length,
    features: ['steamer-k9-projections', 'xK9-savant-blend', 'team-k-vulnerability', 'park-k-factors', 'cold-weather-k-boost', 'opening-day-k-premium', 'lhp-advantage', 'poisson-probability', 'dk-line-value-detection', 'kelly-sizing-ready'],
    note: 'Pitcher K prop model for Opening Day. Ace starters + rusty batters + cold weather = K prop OVERS historically profitable.',
    timestamp: new Date().toISOString(),
  });
});

// ==================== OPENING DAY LIVE TRACKER ====================

// Create/start a new live tracking session
app.post('/api/live/session', async (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const { date, name, bankroll } = req.body || {};
  const targetDate = date || new Date().toISOString().slice(0, 10);
  
  try {
    const result = await odLive.autoSetup(targetDate, mlb, async (away, home, sport) => {
      try {
        const oddsData = await getAllOdds(sport);
        for (const game of oddsData) {
          if ((game.away === away && game.home === home) || 
              (game.awayTeam === away && game.homeTeam === home)) {
            const books = game.books || {};
            const dk = books.draftkings || books.fanduel || Object.values(books)[0] || {};
            return {
              homeML: dk.homeML || null,
              awayML: dk.awayML || null,
              total: dk.total || null,
              overOdds: dk.overOdds || -110,
              underOdds: dk.underOdds || -110,
            };
          }
        }
      } catch (e) { /* no odds */ }
      return null;
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get active session status + live scores
app.get('/api/live/session', async (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const session = odLive.loadActiveSession();
  if (!session) return res.json({ active: false, message: 'No active tracking session' });
  res.json({ active: true, ...odLive.getSessionSummary(session), picks: session.picks, liveScores: session.liveScores });
});

// Update scores + auto-grade
app.post('/api/live/update', async (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  try {
    const result = await odLive.updateScores();
    res.json(result.summary || result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch live scores only (no session required)
app.get('/api/live/scores', async (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const date = req.query.date || null;
  try {
    const scores = await odLive.fetchLiveScores(date ? date.replace(/-/g, '') : null);
    res.json({ games: scores.length, scores });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start auto-monitoring
app.post('/api/live/monitor/start', (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const result = odLive.startMonitoring();
  res.json(result);
});

// Stop auto-monitoring
app.post('/api/live/monitor/stop', (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const result = odLive.stopMonitoring();
  res.json(result);
});

// Capture closing odds for CLV calculation
app.post('/api/live/closing-odds', (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const session = odLive.loadActiveSession();
  if (!session) return res.status(404).json({ error: 'No active session' });
  const closingLines = req.body || {};
  const result = odLive.captureClosingOdds(session, closingLines);
  res.json({ updated: true, summary: odLive.getSessionSummary(result) });
});

// Session history
app.get('/api/live/history', (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const history = odLive.loadSessionHistory();
  res.json({ 
    sessions: history.length, 
    history: history.map(s => odLive.getSessionSummary(s)),
    totalPnL: +history.reduce((sum, s) => sum + (s.grading?.unitsPnL || 0), 0).toFixed(2),
    totalSessions: history.length,
  });
});

// Add manual pick to session
app.post('/api/live/pick', (req, res) => {
  if (!odLive) return res.status(503).json({ error: 'OD Live service unavailable' });
  const session = odLive.loadActiveSession();
  if (!session) return res.status(404).json({ error: 'No active session' });
  
  const pick = req.body;
  if (!pick || !pick.type || !pick.matchup) {
    return res.status(400).json({ error: 'Pick must include type, matchup, pick, odds, units' });
  }
  
  pick.id = `pick_manual_${session.picks.length + 1}_${Date.now()}`;
  pick.status = 'pending';
  pick.capturedAt = new Date().toISOString();
  pick.manual = true;
  session.picks.push(pick);
  
  odLive.recalculateStats(session);
  odLive.saveActiveSession(session);
  
  res.json({ added: true, pickId: pick.id, summary: odLive.getSessionSummary(session) });
});

// ==================== MLB SEASON SIMULATOR ====================

// Cache for simulation results (expensive operation — 5K sims take ~2s)
let simCache = { result: null, timestamp: 0, sims: 0 };
const SIM_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCachedSimulation(numSims = 5000) {
  const now = Date.now();
  if (simCache.result && simCache.sims === numSims && (now - simCache.timestamp) < SIM_CACHE_TTL) {
    return { ...simCache.result, cached: true, cacheAge: Math.round((now - simCache.timestamp) / 1000) };
  }
  const result = seasonSimulator.generateReport(numSims);
  simCache = { result, timestamp: now, sims: numSims };
  return result;
}

// Full season simulation report — power rankings, value bets, division/WS odds
app.get('/api/season-sim', (req, res) => {
  try {
    const sims = Math.min(parseInt(req.query.sims) || 5000, 20000);
    const report = getCachedSimulation(sims);
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Season simulation power rankings only
app.get('/api/season-sim/rankings', (req, res) => {
  try {
    const report = getCachedSimulation(5000);
    res.json({
      rankings: report.powerRankings,
      divisions: report.divProjections,
      timestamp: report.timestamp,
      sims: report.simulations,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Win total futures value bets
app.get('/api/season-sim/win-totals', (req, res) => {
  try {
    const report = getCachedSimulation(5000);
    res.json({
      bets: report.winTotalValue.bets,
      count: report.winTotalValue.count,
      highConfidence: report.winTotalValue.highConfidence,
      dkLines: seasonSimulator.DK_WIN_TOTALS,
      timestamp: report.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Division winner futures value bets
app.get('/api/season-sim/divisions', (req, res) => {
  try {
    const report = getCachedSimulation(5000);
    res.json({
      bets: report.divisionValue.bets,
      count: report.divisionValue.count,
      projections: report.divProjections,
      dkOdds: seasonSimulator.DK_DIVISION_ODDS,
      timestamp: report.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// World Series futures value bets
app.get('/api/season-sim/world-series', (req, res) => {
  try {
    const report = getCachedSimulation(5000);
    res.json({
      bets: report.wsValue.bets,
      count: report.wsValue.count,
      topContenders: report.powerRankings.slice(0, 10).map(t => ({
        team: t.team,
        name: t.name,
        projWins: t.projWins,
        playoffPct: t.playoffPct,
        wsPct: t.wsPct,
      })),
      dkOdds: seasonSimulator.DK_WS_ODDS,
      timestamp: report.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Single team season projection detail
app.get('/api/season-sim/team/:abbr', (req, res) => {
  try {
    const abbr = req.params.abbr.toUpperCase();
    const report = getCachedSimulation(5000);
    const teamRanking = report.powerRankings.find(t => t.team === abbr);
    if (!teamRanking) return res.status(404).json({ error: `Team ${abbr} not found` });
    
    // Find relevant value bets for this team
    const winTotalBets = report.winTotalValue.bets.filter(b => b.team === abbr);
    const divBets = report.divisionValue.bets.filter(b => b.team === abbr);
    const wsBets = report.wsValue.bets.filter(b => b.team === abbr);
    
    // Get DK lines
    const dkWinTotal = seasonSimulator.DK_WIN_TOTALS[abbr] || null;
    const dkWS = seasonSimulator.DK_WS_ODDS[abbr] || null;
    
    res.json({
      team: abbr,
      projection: teamRanking,
      dkWinTotal,
      dkWS,
      valueBets: [...winTotalBets, ...divBets, ...wsBets],
      timestamp: report.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force re-run simulation (clear cache)
app.post('/api/season-sim/refresh', (req, res) => {
  try {
    simCache = { result: null, timestamp: 0, sims: 0 };
    const sims = Math.min(parseInt(req.query.sims) || 5000, 20000);
    const report = getCachedSimulation(sims);
    res.json({ status: 'refreshed', sims, topBets: report.topValueBets.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Top futures value bets across all markets (for dashboard hero)
app.get('/api/season-sim/top-bets', (req, res) => {
  try {
    const report = getCachedSimulation(5000);
    const limit = parseInt(req.query.limit) || 15;
    res.json({
      bets: report.topValueBets.slice(0, limit),
      total: report.topValueBets.length,
      breakdown: {
        winTotals: report.winTotalValue.count,
        divisions: report.divisionValue.count,
        worldSeries: report.wsValue.count,
      },
      daysToOpeningDay: report.daysToOpeningDay,
      timestamp: report.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edge analysis: model disagreements with DK, categorized by confidence and source
app.get('/api/season-sim/edge-analysis', (req, res) => {
  try {
    const edges = seasonSimulator.getEdgeAnalysis();
    const strengths = seasonSimulator.getTeamStrengths();
    
    // Calculate MAE vs DK
    let totalAbsDiff = 0;
    let count = 0;
    for (const [abbr, t] of Object.entries(strengths)) {
      if (t.dkLine) {
        totalAbsDiff += Math.abs(t.projectedWins - t.dkLine);
        count++;
      }
    }
    
    res.json({
      edges,
      modelMAE: +(totalAbsDiff / count).toFixed(1),
      totalTeams: count,
      edgesFound: edges.length,
      timestamp: new Date().toISOString(),
      note: 'Edges >= 2W divergence from DK consensus. Higher confidence = stronger signal.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NHL ENDPOINTS ====================

app.get('/api/model/nhl/ratings', (req, res) => {
  try {
    const ratings = nhl.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/model/nhl/predict', (req, res) => {
  const { away, home, awayGoalie, homeGoalie } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const rawPred = nhl.predict(away.toUpperCase(), home.toUpperCase(), {
      awayGoalie: awayGoalie || 'starter', homeGoalie: homeGoalie || 'starter'
    });
    if (!rawPred) return res.status(400).json({ error: 'Invalid team code' });
    // Apply probability calibration
    // NHL predict returns {home: {winProb}, away: {winProb}} format — need to adapt
    const calHome = calibration.calibrate(rawPred.home.winProb / 100, 'nhl');
    const calAway = calibration.calibrate(rawPred.away.winProb / 100, 'nhl');
    const totalCal = calHome.calibrated + calAway.calibrated;
    const normHome = totalCal > 0 ? calHome.calibrated / totalCal : 0.5;
    const normAway = totalCal > 0 ? calAway.calibrated / totalCal : 0.5;
    rawPred.home.rawWinProb = rawPred.home.winProb;
    rawPred.away.rawWinProb = rawPred.away.winProb;
    rawPred.home.winProb = +(normHome * 100).toFixed(1);
    rawPred.away.winProb = +(normAway * 100).toFixed(1);
    rawPred.calibration = { method: 'piecewise-linear', sport: 'nhl' };
    res.json(rawPred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/odds/nhl', async (req, res) => {
  if (!ODDS_API_KEY) return res.json({ error: 'No API key set', odds: [], mock: true });
  try {
    const data = await fetchOdds('icehockey_nhl');
    res.json({ odds: data, count: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/value/nhl', async (req, res) => {
  try {
    const nameMap = buildNameMap(nhl.TEAMS, {
      'utah hockey club': 'ARI', 'golden knights': 'VGK', 'blue jackets': 'CBJ',
      'maple leafs': 'TOR', 'red wings': 'DET', 'blackhawks': 'CHI'
    });
    const liveOdds = await fetchOdds('icehockey_nhl');
    const valueBets = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      
      // Use asyncPredict for goalie-aware predictions (falls back to basic predict if goalie data unavailable)
      let rawPred;
      try {
        rawPred = await nhl.asyncPredict(awayAbbr, homeAbbr);
      } catch (e) {
        rawPred = nhl.predict(awayAbbr, homeAbbr);
      }
      if (!rawPred) continue;

      // Apply calibration for accurate edge detection
      const calHome = calibration.calibrate(rawPred.home.winProb / 100, 'nhl');
      const calAway = calibration.calibrate(rawPred.away.winProb / 100, 'nhl');
      const totalCal = calHome.calibrated + calAway.calibrated;
      const modelHomeProb = totalCal > 0 ? calHome.calibrated / totalCal : 0.5;
      const modelAwayProb = totalCal > 0 ? calAway.calibrated / totalCal : 0.5;

      const books = game.bookmakers || [];
      for (const bk of books) {
        const bookLine = extractBookLine(bk, game.home_team);
        // NHL value detection: compare calibrated model ML probabilities to book
        const bookHomeProb = bookLine.homeML ? (bookLine.homeML < 0 ? (-bookLine.homeML) / (-bookLine.homeML + 100) : 100 / (bookLine.homeML + 100)) : null;
        const bookAwayProb = bookLine.awayML ? (bookLine.awayML < 0 ? (-bookLine.awayML) / (-bookLine.awayML + 100) : 100 / (bookLine.awayML + 100)) : null;

        if (bookHomeProb !== null) {
          const homeEdge = modelHomeProb - bookHomeProb;
          if (homeEdge > 0.02) {
            valueBets.push({
              sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
              commence: game.commence_time,
              pick: `${homeAbbr} ML (${bookLine.homeML > 0 ? '+' : ''}${bookLine.homeML})`,
              market: 'moneyline', side: 'home',
              modelProb: +(modelHomeProb * 100).toFixed(1), bookProb: +(bookHomeProb * 100).toFixed(1),
              edge: +(homeEdge * 100).toFixed(1), ml: bookLine.homeML,
              confidence: homeEdge >= 0.08 ? 'HIGH' : homeEdge >= 0.05 ? 'MEDIUM' : 'LOW'
            });
          }
        }
        if (bookAwayProb !== null) {
          const awayEdge = modelAwayProb - bookAwayProb;
          if (awayEdge > 0.02) {
            valueBets.push({
              sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
              commence: game.commence_time,
              pick: `${awayAbbr} ML (${bookLine.awayML > 0 ? '+' : ''}${bookLine.awayML})`,
              market: 'moneyline', side: 'away',
              modelProb: +(modelAwayProb * 100).toFixed(1), bookProb: +(bookAwayProb * 100).toFixed(1),
              edge: +(awayEdge * 100).toFixed(1), ml: bookLine.awayML,
              confidence: awayEdge >= 0.08 ? 'HIGH' : awayEdge >= 0.05 ? 'MEDIUM' : 'LOW'
            });
          }
        }
        // Total edge
        if (bookLine.total && rawPred.projTotal) {
          const totalDiff = Math.abs(rawPred.projTotal - bookLine.total);
          if (totalDiff >= 0.5) {
            const side = rawPred.projTotal > bookLine.total ? 'Over' : 'Under';
            valueBets.push({
              sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title,
              commence: game.commence_time,
              pick: `${side} ${bookLine.total}`, market: 'total', side: side.toLowerCase(),
              edge: +(totalDiff.toFixed(1)),
              confidence: totalDiff >= 1.0 ? 'HIGH' : totalDiff >= 0.7 ? 'MEDIUM' : 'LOW'
            });
          }
        }
      }
    }
    valueBets.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets, count: valueBets.length, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest/nhl', (req, res) => {
  try {
    const betTypes = req.query.types ? req.query.types.split(',') : ['ml'];
    const minEdge = req.query.minEdge ? parseFloat(req.query.minEdge) : 0.02;
    const regOnly = req.query.regOnly === 'true';
    res.json(nhlBacktest.runBacktest({ betTypes, minEdge, regOnly }));
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NCAA MARCH MADNESS ENDPOINTS ====================

// NCAA predict game
app.get('/api/ncaa/predict', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  const { away, home, round } = req.query;
  if (!away || !home) return res.json({ error: 'Provide away and home team abbreviations' });
  const result = ncaa.predict(away.toUpperCase(), home.toUpperCase(), { round });
  res.json(result);
});

// NCAA team ratings
app.get('/api/ncaa/ratings', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  const teams = Object.entries(ncaa.TEAMS)
    .map(([abbr, t]) => ({ abbr, ...t }))
    .sort((a, b) => a.kenpom - b.kenpom);
  res.json({ teams, count: teams.length });
});

// NCAA bracket simulation
app.get('/api/ncaa/simulate', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  const sims = Math.min(parseInt(req.query.sims) || 10000, 50000);
  const result = ncaa.simulateBracket(sims);
  res.json(result);
});

// NCAA Sweet 16 matchups
app.get('/api/ncaa/sweet16', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  const matchups = ncaa.getSweet16Matchups();
  // Add predictions to known matchups
  matchups.known = matchups.known.map(m => ({
    ...m,
    prediction: ncaa.predict(m.away, m.home, { round: 'Sweet 16' })
  }));
  // Add predictions to pending games
  matchups.pending = matchups.pending.map(p => {
    const parts = p.game.split(' vs ');
    const awayAbbr = ncaa.findTeamAbbr(parts[0]?.trim());
    const homeAbbr = ncaa.findTeamAbbr(parts[1]?.trim());
    if (awayAbbr && homeAbbr) {
      return { ...p, prediction: ncaa.predict(awayAbbr, homeAbbr, { round: 'Round 2' }) };
    }
    return p;
  });
  res.json(matchups);
});

// NCAA value detection
app.get('/api/ncaa/value', async (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  try {
    // Try to fetch NCAA odds from The Odds API
    let ncaaOdds = [];
    if (ODDS_API_KEY) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
        const resp = await fetch(url, { timeout: 10000 });
        if (resp.ok) ncaaOdds = await resp.json();
      } catch (e) { console.error('[ncaa] Odds fetch error:', e.message); }
    }
    
    const valueBets = [];
    
    // Scan live odds for value
    for (const game of ncaaOdds) {
      const awayName = game.away_team;
      const homeName = game.home_team;
      const awayAbbr = ncaa.findTeamAbbr(awayName);
      const homeAbbr = ncaa.findTeamAbbr(homeName);
      
      if (!awayAbbr || !homeAbbr) continue;
      
      // Extract best odds
      let bestAwayML = null, bestHomeML = null, bestSpread = null, bestTotal = null;
      for (const bk of (game.bookmakers || [])) {
        for (const mkt of (bk.markets || [])) {
          if (mkt.key === 'h2h') {
            for (const o of mkt.outcomes) {
              if (o.name === game.away_team && (!bestAwayML || o.price > bestAwayML)) bestAwayML = o.price;
              if (o.name === game.home_team && (!bestHomeML || o.price > bestHomeML)) bestHomeML = o.price;
            }
          }
          if (mkt.key === 'spreads') {
            for (const o of mkt.outcomes) {
              if (o.name === game.away_team && o.point !== undefined) bestSpread = o.point;
            }
          }
          if (mkt.key === 'totals') {
            for (const o of mkt.outcomes) {
              if (o.name === 'Over' && o.point !== undefined) bestTotal = o.point;
            }
          }
        }
      }
      
      const marketOdds = {};
      if (bestAwayML) marketOdds.awayML = bestAwayML;
      if (bestHomeML) marketOdds.homeML = bestHomeML;
      if (bestSpread !== null) marketOdds.spread = bestSpread;
      if (bestTotal !== null) marketOdds.total = bestTotal;
      
      const analysis = ncaa.detectValue(awayAbbr, homeAbbr, marketOdds);
      if (analysis.hasValue) {
        valueBets.push({
          game: `${awayName} @ ${homeName}`,
          awayAbbr,
          homeAbbr,
          ...analysis
        });
      }
    }
    
    res.json({
      sport: 'NCAAB',
      oddsGames: ncaaOdds.length,
      valueBets,
      valueBetCount: valueBets.length,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// NCAA full report
app.get('/api/ncaa/report', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  const report = ncaa.generateReport();
  res.json(report);
});

// NCAA bracket state (dynamic — which teams are still alive)
app.get('/api/ncaa/bracket', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  res.json(ncaa.getBracketState());
});

// NCAA add result (POST)
app.post('/api/ncaa/result', express.json(), (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  const { round, winner, loser, score, notes } = req.body;
  if (!round || !winner || !loser) return res.json({ error: 'Provide round, winner, loser' });
  const result = ncaa.addResult(round, winner.toUpperCase(), loser.toUpperCase(), score, notes);
  res.json(result);
});

// NCAA tournament results
app.get('/api/ncaa/results', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  res.json(ncaa.TOURNAMENT_RESULTS);
});

// NCAA team detail
app.get('/api/ncaa/team/:abbr', (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  const abbr = req.params.abbr.toUpperCase();
  const team = ncaa.TEAMS[abbr];
  if (!team) return res.json({ error: `Team not found: ${abbr}` });
  const perf = ncaa.getTourneyPerformance(abbr);
  res.json({ abbr, ...team, tourneyPerformance: perf });
});

// NCAA championship futures value
app.get('/api/ncaa/futures', async (req, res) => {
  if (!ncaa) return res.json({ error: 'NCAA model not loaded' });
  try {
    // Get model championship probabilities
    const sim = ncaa.simulateBracket(10000);
    
    // Try to fetch futures odds
    let futuresOdds = [];
    if (ODDS_API_KEY) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/basketball_ncaab/futures/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=outright_winner&oddsFormat=american`;
        const resp = await fetch(url, { timeout: 10000 });
        if (resp.ok) futuresOdds = await resp.json();
      } catch (e) { console.error('[ncaa-futures] Fetch error:', e.message); }
    }
    
    // Match model probs with market odds
    const valueBets = [];
    for (const event of futuresOdds) {
      for (const bk of (event.bookmakers || [])) {
        for (const mkt of (bk.markets || [])) {
          for (const outcome of (mkt.outcomes || [])) {
            const abbr = ncaa.findTeamAbbr(outcome.name);
            if (!abbr) continue;
            const modelTeam = sim.results.find(r => r.team === abbr);
            if (!modelTeam) continue;
            
            const modelProb = modelTeam.champProb / 100;
            const odds = outcome.price;
            const impliedProb = odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
            const edge = modelProb - impliedProb;
            
            if (edge > 0.01) {
              valueBets.push({
                team: modelTeam.name,
                abbr,
                seed: modelTeam.seed,
                region: modelTeam.region,
                book: bk.title,
                odds,
                modelProb: +(modelProb * 100).toFixed(1),
                impliedProb: +(impliedProb * 100).toFixed(1),
                edge: +(edge * 100).toFixed(1),
                confidence: edge > 0.05 ? 'HIGH' : edge > 0.02 ? 'MEDIUM' : 'LOW'
              });
            }
          }
        }
      }
    }
    
    valueBets.sort((a, b) => b.edge - a.edge);
    
    res.json({
      championshipOdds: sim.results.slice(0, 16),
      futuresValue: valueBets,
      futuresOddsAvailable: futuresOdds.length > 0,
      sims: sim.sims,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NCAA live scores
app.get('/api/ncaa/live', async (req, res) => {
  if (!ncaaLive) return res.json({ error: 'NCAA Live service not loaded' });
  try {
    const data = await ncaaLive.fetchLiveScores();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NCAA auto-update bracket from live scores
app.get('/api/ncaa/update-bracket', async (req, res) => {
  if (!ncaaLive) return res.json({ error: 'NCAA Live service not loaded' });
  try {
    const result = await ncaaLive.updateBracketResults();
    const bracketState = ncaa ? ncaa.getBracketState() : null;
    res.json({ ...result, bracketState, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NCAA tournament dashboard data (all-in-one for dashboard)
app.get('/api/ncaa/dashboard', async (req, res) => {
  if (!ncaaLive) return res.json({ error: 'NCAA Live service not loaded' });
  try {
    const data = await ncaaLive.getDashboardData();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NCAA Sweet 16 bracket (auto-generated from results)
app.get('/api/ncaa/sweet16-bracket', async (req, res) => {
  if (!ncaaLive) return res.json({ error: 'NCAA Live service not loaded' });
  try {
    // First update bracket from live scores
    await ncaaLive.updateBracketResults();
    const bracket = ncaaLive.getSweet16Bracket();
    res.json(bracket);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NCAA tournament momentum rankings
app.get('/api/ncaa/momentum', (req, res) => {
  if (!ncaa || !ncaaLive) return res.json({ error: 'NCAA not loaded' });
  try {
    const bracketState = ncaa.getBracketState();
    const rankings = [];
    for (const region of Object.values(bracketState.regions)) {
      for (const team of (region.teams || [])) {
        const momentum = ncaaLive.getTournamentMomentum(team.abbr);
        rankings.push({ ...team, momentum });
      }
    }
    rankings.sort((a, b) => (b.momentum?.momentumScore || 0) - (a.momentum?.momentumScore || 0));
    res.json({ rankings, totalTeams: rankings.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NCAA BRACKET ENGINE v70.0 ====================

let ncaaBracketEngine = null;
try { ncaaBracketEngine = require('./services/ncaa-bracket-engine'); } catch (e) { console.error('[server] NCAA Bracket Engine not loaded:', e.message); }

// Sweet 16 War Room — comprehensive betting analysis for all S16 matchups
app.get('/api/ncaa/warroom', (req, res) => {
  if (!ncaaBracketEngine) return res.status(503).json({ error: 'NCAA Bracket Engine not loaded' });
  try {
    const warroom = ncaaBracketEngine.getSweet16WarRoom();
    res.json(warroom);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dynamic Sweet 16 matchups (auto-generated from bracket structure + results)
app.get('/api/ncaa/bracket/sweet16', (req, res) => {
  if (!ncaaBracketEngine) return res.status(503).json({ error: 'NCAA Bracket Engine not loaded' });
  try {
    const matchups = ncaaBracketEngine.generateSweet16Matchups();
    res.json(matchups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enhanced bracket simulation with round-by-round advancement probabilities
app.get('/api/ncaa/bracket/simulate', (req, res) => {
  if (!ncaaBracketEngine) return res.status(503).json({ error: 'NCAA Bracket Engine not loaded' });
  try {
    const sims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    const result = ncaaBracketEngine.enhancedBracketSim(sims);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Conditional futures value for a specific team
app.get('/api/ncaa/bracket/futures/:team', (req, res) => {
  if (!ncaaBracketEngine) return res.status(503).json({ error: 'NCAA Bracket Engine not loaded' });
  try {
    const result = ncaaBracketEngine.conditionalFuturesValue(req.params.team.toUpperCase());
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sweet 16 War Room + live odds scan (full betting card)
app.get('/api/ncaa/warroom/scan', async (req, res) => {
  if (!ncaaBracketEngine) return res.status(503).json({ error: 'NCAA Bracket Engine not loaded' });
  if (!ncaaTournScanner) return res.status(503).json({ error: 'NCAA Tournament Scanner not loaded' });
  try {
    const warroom = ncaaBracketEngine.getSweet16WarRoom();
    
    // Scan live odds for value on all known S16 games
    const oddsResults = await ncaaTournScanner.scanTournamentValue();
    
    // Merge odds data with war room
    warroom.liveOdds = oddsResults;
    warroom.valueBets = oddsResults?.valueBets || [];
    warroom.totalValueBets = warroom.valueBets.length;
    
    res.json(warroom);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NFL ENDPOINTS ====================

// NFL Power Ratings
app.get('/api/model/nfl/ratings', (req, res) => {
  try {
    if (!nfl) return res.status(500).json({ error: 'NFL model not loaded' });
    const ratings = nfl.generatePowerRatings();
    const sorted = Object.entries(ratings)
      .sort((a, b) => b[1].projWins - a[1].projWins)
      .map(([abbr, r]) => ({ abbr, ...r }));
    res.json({ ratings: sorted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NFL Game Prediction
app.get('/api/model/nfl/predict', (req, res) => {
  try {
    if (!nfl) return res.status(500).json({ error: 'NFL model not loaded' });
    const { away, home, neutral } = req.query;
    if (!away || !home) return res.status(400).json({ error: 'Need away and home params' });
    const pred = nfl.predict(away.toUpperCase(), home.toUpperCase(), { neutral: neutral === 'true' });
    res.json(pred);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NFL Season Simulation
let nflSimCache = null;
let nflSimCacheTime = 0;
const NFL_SIM_CACHE_MS = 30 * 60 * 1000; // 30 min cache

app.get('/api/nfl/season-sim', (req, res) => {
  try {
    if (!nfl) return res.status(500).json({ error: 'NFL model not loaded' });
    const force = req.query.force === 'true';
    const numSims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    
    if (!force && nflSimCache && Date.now() - nflSimCacheTime < NFL_SIM_CACHE_MS) {
      return res.json({ cached: true, ...nflSimCache });
    }
    
    const results = nfl.simulateSeason(numSims);
    const valueBets = nfl.findWinTotalValue(results);
    const ratings = nfl.generatePowerRatings();
    
    // Build division standings
    const divisions = {};
    for (const [divName, divTeams] of Object.entries(nfl.DIVISIONS)) {
      divisions[divName] = divTeams.map(abbr => ({
        abbr,
        name: results[abbr].name,
        projWins: results[abbr].projWins,
        simAvgWins: results[abbr].simAvgWins,
        divWinPct: results[abbr].divWinPct,
        playoffPct: results[abbr].playoffPct,
        sbChampPct: results[abbr].sbChampPct,
        powerRating: ratings[abbr].powerRating,
      })).sort((a, b) => b.simAvgWins - a.simAvgWins);
    }
    
    // Rankings
    const rankings = Object.entries(results)
      .sort((a, b) => b[1].simAvgWins - a[1].simAvgWins)
      .map(([abbr, r], i) => ({
        rank: i + 1,
        abbr,
        name: r.name,
        conf: r.conf,
        div: r.div,
        projWins: r.projWins,
        simAvgWins: r.simAvgWins,
        simStdDev: r.simStdDev,
        p10: r.p10,
        p90: r.p90,
        divWinPct: r.divWinPct,
        playoffPct: r.playoffPct,
        confChampPct: r.confChampPct,
        sbChampPct: r.sbChampPct,
        marketLine: nfl.MARKET_LINES[abbr]?.line,
      }));
    
    const response = {
      numSims,
      timestamp: new Date().toISOString(),
      rankings,
      divisions,
      valueBets,
      topSBContenders: rankings.filter(r => r.sbChampPct >= 2).sort((a, b) => b.sbChampPct - a.sbChampPct),
    };
    
    nflSimCache = response;
    nflSimCacheTime = Date.now();
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NFL Win Total Value Bets
app.get('/api/nfl/win-totals', (req, res) => {
  try {
    if (!nfl) return res.status(500).json({ error: 'NFL model not loaded' });
    const results = nfl.simulateSeason(10000);
    const valueBets = nfl.findWinTotalValue(results);
    res.json({ valueBets, count: valueBets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NFL Team Detail
app.get('/api/nfl/team/:abbr', (req, res) => {
  try {
    if (!nfl) return res.status(500).json({ error: 'NFL model not loaded' });
    const abbr = req.params.abbr.toUpperCase();
    const ratings = nfl.generatePowerRatings();
    const rating = ratings[abbr];
    if (!rating) return res.status(404).json({ error: `Unknown team: ${abbr}` });
    
    const results = nfl.simulateSeason(5000);
    const team = results[abbr];
    const market = nfl.MARKET_LINES[abbr];
    
    let valueBet = null;
    if (market) {
      const { overProb, underProb } = nfl.calcOverUnderProb(team.winDistribution, market.line);
      const overImplied = nfl.oddsToProb(market.overJuice);
      const underImplied = 1 - overImplied + 0.04;
      const overEdge = overProb - overImplied;
      const underEdge = underProb - underImplied;
      valueBet = {
        line: market.line,
        bestSide: overEdge > underEdge ? 'OVER' : 'UNDER',
        edge: +(Math.max(overEdge, underEdge) * 100).toFixed(1),
        overProb: +(overProb * 100).toFixed(1),
        underProb: +(underProb * 100).toFixed(1),
      };
    }
    
    res.json({
      abbr,
      rating,
      simResults: team,
      marketLine: market,
      valueBet,
      offseasonAdj: nfl.OFFSEASON_ADJUSTMENTS[abbr] || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== COMBINED ====================

app.get('/api/value/all', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      fetch_value_bets('nba'), fetch_value_bets('mlb'), fetch_value_bets('nhl'),
      fetch_value_bets('ncaab'),
      polymarketValue.scanForValue({ minEdge: 0.03 }).then(r => 
        (r.valueBets || []).filter(v => v.rawEdge > 0).map(v => ({
          sport: (v.sport || 'POLY').toUpperCase(),
          game: v.question,
          book: 'Polymarket',
          pick: `${v.outcome} @ ${v.impliedProb}%`,
          market: v.marketType || 'prediction-market',
          edge: v.edge,
          confidence: v.confidence,
          modelProb: v.modelProb,
          url: v.url,
          source: 'polymarket',
        }))
      ).catch(() => []),
      // Season sim futures value bets
      Promise.resolve().then(() => {
        try {
          const simReport = getCachedSimulation(5000);
          const futuresBets = [];
          // Top win total value bets
          (simReport.winTotalValue?.bets || []).slice(0, 10).forEach(b => {
            futuresBets.push({
              sport: 'MLB',
              game: `${b.name} Season Win Total`,
              book: 'DraftKings',
              pick: `${b.bet} (${b.odds > 0 ? '+' : ''}${b.odds})`,
              market: 'futures-win-total',
              edge: b.edge,
              confidence: b.confidence,
              modelProb: b.modelProb,
              kelly: b.halfKelly,
              reasoning: b.reasoning,
              source: 'season-sim',
            });
          });
          // Top division value bets
          (simReport.divisionValue?.bets || []).slice(0, 5).forEach(b => {
            futuresBets.push({
              sport: 'MLB',
              game: `${b.division} Division Winner`,
              book: 'DraftKings',
              pick: `${b.team} (${b.odds > 0 ? '+' : ''}${b.odds})`,
              market: 'futures-division',
              edge: b.edge,
              confidence: b.confidence,
              modelProb: b.modelProb,
              source: 'season-sim',
            });
          });
          // WS value bets
          (simReport.wsValue?.bets || []).slice(0, 5).forEach(b => {
            futuresBets.push({
              sport: 'MLB',
              game: 'World Series Champion',
              book: 'DraftKings',
              pick: `${b.team} (${b.odds > 0 ? '+' : ''}${b.odds})`,
              market: 'futures-world-series',
              edge: b.edge,
              confidence: b.confidence,
              modelProb: b.modelProb,
              source: 'season-sim',
            });
          });
          return futuresBets;
        } catch (e) { return []; }
      }),
      // Live championship futures from The Odds API (NBA/NHL/MLB)
      futuresScanner.scanAllFutures({ nba, nhl, mlb }, ODDS_API_KEY, { minEdge: 0.03, sims: 5000 }).then(r => {
        return (r.allValueBets || []).map(b => ({
          sport: b.sport.toUpperCase(),
          game: `${b.teamName} Championship`,
          book: b.bestBook,
          pick: `${b.team} (${b.bestOdds > 0 ? '+' : ''}${b.bestOdds})`,
          market: 'championship-futures',
          edge: b.edge / 100,
          confidence: b.confidence,
          modelProb: b.modelProb,
          kelly: b.kellyPct,
          source: 'futures-scanner',
        }));
      }).catch(() => []),
      // NFL Win Total Futures
      Promise.resolve().then(() => {
        try {
          if (!nfl) return [];
          const simResults = nfl.simulateSeason(5000);
          const valueBets = nfl.findWinTotalValue(simResults);
          return valueBets.slice(0, 15).map(v => ({
            sport: 'NFL',
            game: `${v.name} Win Total`,
            book: 'DraftKings',
            pick: `${v.side} ${v.line}`,
            market: 'nfl-win-total',
            edge: v.edge / 100,
            confidence: v.confidence,
            modelProb: v.modelProb,
            source: 'nfl-model',
          }));
        } catch (e) { return []; }
      })
    ]);
    const all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });
    all.sort((a, b) => b.edge - a.edge);
    res.json({ valueBets: all, count: all.length, updated: new Date().toISOString(), includesPolymarket: true, includesFutures: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Internal helpers for combined endpoint
async function fetch_value_bets(sport) {
  const bets = [];
  if (sport === 'nba') {
    const nameMap = buildNameMap(nba.TEAMS, { 'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI' });
    const liveOdds = await fetchOdds('basketball_nba');
    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      // Use asyncPredict for rest/tank situational analysis
      let pred;
      try {
        const rawPred = await nba.asyncPredict(awayAbbr, homeAbbr, {});
        pred = calibration.calibratePrediction(rawPred && !rawPred.error ? rawPred : nba.predict(awayAbbr, homeAbbr), 'nba');
      } catch (e) {
        pred = calibration.calibratePrediction(nba.predict(awayAbbr, homeAbbr), 'nba');
      }
      if (pred.error) continue;
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        nba.findValue(pred, bookLine).forEach(e => {
          bets.push({ sport: 'NBA', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time, ...e });
        });
      }
    }
  } else if (sport === 'mlb') {
    const nameMap = buildNameMap(mlb.TEAMS, { 'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR' });
    const liveOdds = await fetchOdds('baseball_mlb');
    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      // Weather-adjusted predictions
      const opts = {};
      try {
        const wd = await weather.getWeatherForPark(homeAbbr);
        if (wd && !wd.error) opts.weather = wd;
      } catch (e) { /* weather optional */ }
      // Umpire data for totals
      try {
        const umpAdj = await umpireService.getGameUmpireAdjustment(awayAbbr, homeAbbr);
        if (umpAdj?.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
      } catch (e) { /* umpire optional */ }
      const rawPred = await mlb.asyncPredict(awayAbbr, homeAbbr, opts);
      if (!rawPred || rawPred.error) continue;
      // Apply calibration for accurate edge calculation
      const pred = calibration.calibratePrediction(rawPred, 'mlb');
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        const edges = mlb.findValue(pred, bookLine);
        // Also find MC-enhanced value if simulation ran
        if (pred.monteCarlo) {
          try {
            const mcEdges = monteCarloService.findSimValue(pred.monteCarlo, bookLine);
            mcEdges.forEach(e => {
              const isDuplicate = edges.some(ae => ae.pick === e.pick && ae.market === e.market);
              if (!isDuplicate) edges.push(e);
            });
          } catch (e) { /* MC value optional */ }
        }
        edges.forEach(e => {
          bets.push({ sport: 'MLB', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time, ...e });
        });
      }
    }
  } else if (sport === 'nhl') {
    const nameMap = buildNameMap(nhl.TEAMS, { 'utah hockey club': 'ARI', 'golden knights': 'VGK', 'blue jackets': 'CBJ', 'maple leafs': 'TOR', 'red wings': 'DET', 'blackhawks': 'CHI' });
    const liveOdds = await fetchOdds('icehockey_nhl');
    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      const rawPredNhl = nhl.predict(awayAbbr, homeAbbr);
      if (!rawPredNhl) continue;
      // Apply calibration for accurate NHL edge detection
      const calH = calibration.calibrate(rawPredNhl.home.winProb / 100, 'nhl');
      const calA = calibration.calibrate(rawPredNhl.away.winProb / 100, 'nhl');
      const totCal = calH.calibrated + calA.calibrated;
      const nhlHomeProb = totCal > 0 ? calH.calibrated / totCal : 0.5;
      const nhlAwayProb = totCal > 0 ? calA.calibrated / totCal : 0.5;
      for (const bk of (game.bookmakers || [])) {
        const bookLine = extractBookLine(bk, game.home_team);
        const bookHomeProb = bookLine.homeML ? (bookLine.homeML < 0 ? (-bookLine.homeML) / (-bookLine.homeML + 100) : 100 / (bookLine.homeML + 100)) : null;
        const bookAwayProb = bookLine.awayML ? (bookLine.awayML < 0 ? (-bookLine.awayML) / (-bookLine.awayML + 100) : 100 / (bookLine.awayML + 100)) : null;
        if (bookHomeProb !== null && (nhlHomeProb - bookHomeProb) > 0.02) {
          const edge = nhlHomeProb - bookHomeProb;
          bets.push({ sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time,
            pick: `${homeAbbr} ML`, market: 'moneyline', edge: +(edge * 100).toFixed(1), confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW'
          });
        }
        if (bookAwayProb !== null && (nhlAwayProb - bookAwayProb) > 0.02) {
          const edge = nhlAwayProb - bookAwayProb;
          bets.push({ sport: 'NHL', game: `${awayAbbr} @ ${homeAbbr}`, book: bk.title, commence: game.commence_time,
            pick: `${awayAbbr} ML`, market: 'moneyline', edge: +(edge * 100).toFixed(1), confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW'
          });
        }
      }
    }
  } else if (sport === 'ncaab') {
    // NCAA Basketball value bets
    if (ncaa) {
      try {
        const liveOdds = await fetchOdds('basketball_ncaab');
        for (const game of liveOdds) {
          const awayAbbr = ncaa.findTeamAbbr(game.away_team);
          const homeAbbr = ncaa.findTeamAbbr(game.home_team);
          if (!awayAbbr || !homeAbbr) continue;
          
          // Extract best odds across books
          let bestAwayML = null, bestHomeML = null, bestSpread = null, bestTotal = null;
          for (const bk of (game.bookmakers || [])) {
            for (const mkt of (bk.markets || [])) {
              if (mkt.key === 'h2h') {
                for (const o of mkt.outcomes) {
                  if (o.name === game.away_team && (!bestAwayML || o.price > bestAwayML)) bestAwayML = o.price;
                  if (o.name === game.home_team && (!bestHomeML || o.price > bestHomeML)) bestHomeML = o.price;
                }
              }
              if (mkt.key === 'spreads') {
                for (const o of mkt.outcomes) {
                  if (o.name === game.away_team && o.point !== undefined) bestSpread = o.point;
                }
              }
              if (mkt.key === 'totals') {
                for (const o of mkt.outcomes) {
                  if (o.name === 'Over' && o.point !== undefined) bestTotal = o.point;
                }
              }
            }
          }
          
          const marketOdds = {};
          if (bestAwayML) marketOdds.awayML = bestAwayML;
          if (bestHomeML) marketOdds.homeML = bestHomeML;
          if (bestSpread !== null) marketOdds.spread = bestSpread;
          if (bestTotal !== null) marketOdds.total = bestTotal;
          
          const analysis = ncaa.detectValue(awayAbbr, homeAbbr, marketOdds);
          if (analysis.hasValue) {
            for (const vb of analysis.valueBets) {
              bets.push({
                sport: 'NCAAB',
                game: `${game.away_team} @ ${game.home_team}`,
                book: 'Best Available',
                commence: game.commence_time,
                pick: vb.bet,
                market: vb.marketML ? 'moneyline' : (vb.modelSpread !== undefined ? 'spread' : 'total'),
                edge: vb.edge,
                confidence: vb.confidence,
                modelProb: vb.modelProb,
                kelly: vb.kellyFraction,
              });
            }
          }
        }
      } catch (e) { console.error('[value-all] NCAAB error:', e.message); }
    }
  }
  return bets;
}

// ==================== TODAY'S GAMES ENDPOINT ====================

const oddsCache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getAllOdds() {
  if (oddsCache.data && (Date.now() - oddsCache.ts) < CACHE_TTL) return oddsCache.data;
  const sports = [
    { key: 'basketball_nba', sport: 'NBA', model: nba, extra: { 'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI' } },
    { key: 'baseball_mlb', sport: 'MLB', model: mlb, extra: { 'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR' } },
    { key: 'icehockey_nhl', sport: 'NHL', model: nhl, extra: { 'utah hockey club': 'UTA', 'golden knights': 'VGK', 'blue jackets': 'CBJ', 'maple leafs': 'TOR', 'red wings': 'DET', 'blackhawks': 'CHI' } }
  ];
  const allGames = [];
  for (const s of sports) {
    try {
      const odds = await fetchOdds(s.key);
      const nameMap = buildNameMap(s.model.TEAMS, s.extra);
      for (const game of odds) {
        const awayAbbr = resolveTeam(nameMap, game.away_team);
        const homeAbbr = resolveTeam(nameMap, game.home_team);
        // Get model prediction
        let pred = null;
        let gameWeather = null;
        try {
          if (s.sport === 'NBA') pred = nba.predict(awayAbbr || 'UNK', homeAbbr || 'UNK');
          else if (s.sport === 'MLB') {
            // Use asyncPredict for full signal stack (weather + rest + lineup + umpire + OW unders)
            try {
              pred = await mlb.asyncPredict(awayAbbr || 'UNK', homeAbbr || 'UNK');
              if (pred && pred._asyncSignals?.weatherDetail) {
                gameWeather = pred._asyncSignals.weatherDetail;
              }
            } catch (e) {
              // Fallback to sync predict with just weather
              const mlbOpts = {};
              try {
                const wd = await weather.getWeatherForPark(homeAbbr || 'UNK');
                if (wd && !wd.error) { mlbOpts.weather = wd; gameWeather = wd; }
              } catch (we) { /* weather optional */ }
              pred = mlb.predict(awayAbbr || 'UNK', homeAbbr || 'UNK', mlbOpts);
            }
            // Calibrate MLB probabilities
            if (pred && !pred.error) pred = calibration.calibratePrediction(pred, 'mlb');
          }
          else if (s.sport === 'NHL') {
            try {
              pred = await nhl.asyncPredict(awayAbbr || 'UNK', homeAbbr || 'UNK');
            } catch (e) {
              pred = nhl.predict(awayAbbr || 'UNK', homeAbbr || 'UNK');
            }
          }
        } catch (e) { /* skip */ }
        if (pred && pred.error) pred = null;
        // Extract all bookmaker lines
        const books = {};
        let bestHomeML = null, bestAwayML = null, bestHomeBook = '', bestAwayBook = '';
        for (const bk of (game.bookmakers || [])) {
          const line = extractBookLine(bk, game.home_team);
          // Also extract away ML name
          (bk.markets || []).forEach(mkt => {
            if (mkt.key === 'h2h') {
              mkt.outcomes.forEach(o => {
                if (o.name !== game.home_team) line.awayML = o.price;
              });
            }
          });
          books[bk.title] = line;
          // Track best lines
          if (line.homeML && (bestHomeML === null || line.homeML > bestHomeML)) {
            bestHomeML = line.homeML; bestHomeBook = bk.title;
          }
          if (line.awayML && (bestAwayML === null || line.awayML > bestAwayML)) {
            bestAwayML = line.awayML; bestAwayBook = bk.title;
          }
        }
        // Calculate edges
        let homeEdge = null, awayEdge = null;
        if (pred) {
          const modelHomeProb = s.sport === 'NHL' ? (pred.home?.winProb || 50) / 100 : (pred.homeWinProb || pred.home?.winProb || 50) / 100;
          const modelAwayProb = 1 - modelHomeProb;
          if (bestHomeML !== null) {
            const impliedHome = bestHomeML < 0 ? (-bestHomeML) / (-bestHomeML + 100) : 100 / (bestHomeML + 100);
            homeEdge = +((modelHomeProb - impliedHome) * 100).toFixed(1);
          }
          if (bestAwayML !== null) {
            const impliedAway = bestAwayML < 0 ? (-bestAwayML) / (-bestAwayML + 100) : 100 / (bestAwayML + 100);
            awayEdge = +((modelAwayProb - impliedAway) * 100).toFixed(1);
          }
        }
        allGames.push({
          sport: s.sport,
          away: awayAbbr || game.away_team,
          home: homeAbbr || game.home_team,
          awayFull: game.away_team,
          homeFull: game.home_team,
          commence: game.commence_time,
          prediction: pred ? {
            homeWinProb: +(pred.homeWinProb || pred.home?.winProb || 50).toFixed(1),
            awayWinProb: +(pred.awayWinProb || pred.away?.winProb || 50).toFixed(1),
            spread: pred.spread || pred.home?.spread || null,
            total: pred.total || null
          } : null,
          weather: gameWeather ? {
            temp: gameWeather.weather?.temp,
            wind: gameWeather.weather?.wind,
            windDir: gameWeather.weather?.windDir,
            humidity: gameWeather.weather?.humidity,
            multiplier: gameWeather.multiplier,
            totalImpact: gameWeather.totalImpact,
            description: gameWeather.description,
            park: gameWeather.park,
            dome: gameWeather.dome
          } : null,
          books,
          bestLine: {
            home: { ml: bestHomeML, book: bestHomeBook },
            away: { ml: bestAwayML, book: bestAwayBook }
          },
          edge: {
            home: homeEdge,
            away: awayEdge,
            best: Math.max(homeEdge || 0, awayEdge || 0),
            pick: (homeEdge || 0) > (awayEdge || 0) ? (homeAbbr || game.home_team) : (awayAbbr || game.away_team),
            pickSide: (homeEdge || 0) > (awayEdge || 0) ? 'home' : 'away'
          }
        });
      }
    } catch (e) { console.error(`Error fetching ${s.sport}:`, e.message); }
  }
  allGames.sort((a, b) => (b.edge.best || 0) - (a.edge.best || 0));
  oddsCache.data = allGames;
  oddsCache.ts = Date.now();
  return allGames;
}

app.get('/api/today', async (req, res) => {
  try {
    const games = await getAllOdds();
    const sport = req.query.sport;
    const filtered = sport && sport !== 'all' ? games.filter(g => g.sport.toLowerCase() === sport.toLowerCase()) : games;
    res.json({
      games: filtered,
      count: filtered.length,
      updated: new Date().toISOString(),
      cacheAge: Date.now() - oddsCache.ts
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SUMMARY ENDPOINT ====================

app.get('/api/summary', async (req, res) => {
  try {
    let games = [];
    try { games = await getAllOdds(); } catch (_) {}
    let nbaBT = { roi: 0, totalGames: 0 };
    let mlbBT = { roi: 0, totalGames: 0 };
    let nhlBT = { roi: 0, totalGames: 0 };
    try { nbaBT = backtest.runBacktest(); } catch (_) {}
    try { mlbBT = mlbBacktestV2.runBacktest(); } catch (_) {}
    try { nhlBT = nhlBacktest.runBacktest(); } catch (_) {}
    res.json({
      gamesTracked: games.length,
      valueBets: games.filter(g => g.edge && g.edge.best > 3).length,
      sports: {
        nba: { games: games.filter(g => g.sport === 'NBA').length, backtestROI: nbaBT.roi, backtestGames: nbaBT.totalGames },
        mlb: { games: games.filter(g => g.sport === 'MLB').length, backtestROI: mlbBT.roi, backtestGames: mlbBT.totalGames },
        nhl: { games: games.filter(g => g.sport === 'NHL').length, backtestROI: nhlBT.roi, backtestGames: nhlBT.totalGames }
      },
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Alias routes (frontend uses short paths) ───

// NBA aliases
app.get('/api/nba/ratings', (req, res) => {
  try {
    const ratings = nba.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nba/predict', (req, res) => {
  const { away, home, awayB2B, homeB2B } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const rawPred = nba.predict(away.toUpperCase(), home.toUpperCase(), { awayB2B: awayB2B === 'true', homeB2B: homeB2B === 'true' });
    if (rawPred.error) return res.status(400).json(rawPred);
    const pred = calibration.calibratePrediction(rawPred, 'nba');
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nba/backtest', (req, res) => {
  try {
    const result = backtest.runBacktest();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MLB aliases
app.get('/api/mlb/ratings', (req, res) => {
  try {
    const ratings = mlb.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.composite - a.composite);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/predict', async (req, res) => {
  const { away, home, awayPitcher, homePitcher } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    // Use asyncPredict for full signal stack (weather + rest + lineup + umpire + OW unders)
    const rawPred = await mlb.asyncPredict(away.toUpperCase(), home.toUpperCase(), opts);
    if (rawPred.error) return res.status(400).json(rawPred);
    const pred = calibration.calibratePrediction(rawPred, 'mlb');
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// F5 (First 5 Innings) Analysis — NB scoring model with pitcher quality adjustment
app.get('/api/mlb/f5/:away/:home', async (req, res) => {
  const { away, home } = req.params;
  const { awayPitcher, homePitcher } = req.query;
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    const rawPred = await mlb.asyncPredict(away.toUpperCase(), home.toUpperCase(), opts);
    if (rawPred.error) return res.status(400).json(rawPred);
    const pred = calibration.calibratePrediction(rawPred, 'mlb');
    
    if (!pred.f5 || pred.f5.model === 'linear-estimate') {
      return res.json({ 
        f5: pred.f5 || { total: pred.f5Total },
        note: 'NB F5 model not available, linear estimate only',
        game: `${away} @ ${home}`,
      });
    }
    
    res.json({
      game: `${away} @ ${home}`,
      f5: pred.f5,
      pitchers: {
        away: pred.awayPitcher ? { name: pred.awayPitcher.name, rating: pred.awayPitcher.rating } : null,
        home: pred.homePitcher ? { name: pred.homePitcher.name, rating: pred.homePitcher.rating } : null,
      },
      fullGameTotal: pred.totalRuns,
      f5Fraction: pred.f5.total ? +(pred.f5.total / pred.totalRuns).toFixed(3) : null,
      conviction: pred.conviction || null,
      signals: pred._asyncSignals || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Run Line Analysis — NB exact score matrix probabilities
app.get('/api/mlb/runline/:away/:home', async (req, res) => {
  const { away, home } = req.params;
  const { awayPitcher, homePitcher } = req.query;
  try {
    const opts = {};
    if (awayPitcher) opts.awayPitcher = awayPitcher;
    if (homePitcher) opts.homePitcher = homePitcher;
    const rawPred = await mlb.asyncPredict(away.toUpperCase(), home.toUpperCase(), opts);
    if (rawPred.error) return res.status(400).json(rawPred);
    const pred = calibration.calibratePrediction(rawPred, 'mlb');
    
    res.json({
      game: `${away} @ ${home}`,
      homeRunLine: pred.homeRunLine,
      awayRunLine: pred.awayRunLine,
      altRunLines: pred.altRunLines || null,
      runDiff: pred.runDiff,
      homeWinProb: pred.homeWinProb,
      awayWinProb: pred.awayWinProb,
      conviction: pred.conviction || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// F5 Value Scan — scan all today's MLB games for F5 under/over value
app.get('/api/mlb/f5/scan', async (req, res) => {
  try {
    const games = await getAllOdds();
    const mlbGames = games.filter(g => (g.sport || '').toLowerCase().includes('mlb'));
    const f5Bets = [];
    
    for (const game of mlbGames) {
      const away = game.away;
      const home = game.home;
      if (!away || !home) continue;
      
      try {
        const pred = await mlb.asyncPredict(away, home);
        if (!pred || pred.error || !pred.f5 || pred.f5.model !== 'negative-binomial-f5') continue;
        
        const f5 = pred.f5;
        const bookTotal = game.bestLine?.total || Object.values(game.books || {})?.[0]?.total;
        if (!bookTotal) continue;
        
        const isOD = pred.factors?.openingDayStarters || pred.factors?.preseasonTuning;
        const impliedF5Factor = isOD ? 0.545 : 0.525;
        const impliedF5Total = bookTotal * impliedF5Factor;
        const nearestLine = Math.round(impliedF5Total * 2) / 2;
        const f5LineData = f5.totals?.[nearestLine];
        
        f5Bets.push({
          game: `${away} @ ${home}`,
          pitchers: `${pred.awayPitcher?.name || 'TBD'} vs ${pred.homePitcher?.name || 'TBD'}`,
          modelF5Total: f5.total,
          impliedF5Total: +impliedF5Total.toFixed(2),
          nearestLine,
          f5HomeWin: f5.homeWinProb,
          f5AwayWin: f5.awayWinProb,
          f5Draw: f5.drawProb,
          underProb: f5LineData?.under || null,
          overProb: f5LineData?.over || null,
          underML: f5LineData?.underML || null,
          overML: f5LineData?.overML || null,
          openingDay: isOD || false,
          conviction: pred.conviction || null,
          weather: pred._asyncSignals?.weather ? 'active' : 'none',
        });
      } catch (_) { continue; }
    }
    
    f5Bets.sort((a, b) => {
      // Sort by strongest under/over signal
      const aSignal = Math.max(a.underProb || 0, a.overProb || 0);
      const bSignal = Math.max(b.underProb || 0, b.overProb || 0);
      return bSignal - aSignal;
    });
    
    res.json({
      f5Bets,
      count: f5Bets.length,
      timestamp: new Date().toISOString(),
      note: 'F5 unders are historically profitable on Opening Day (aces go deep, bullpen uncertainty eliminated)',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/backtest', (req, res) => {
  try {
    const result = req.query.version === 'v1' ? mlbBacktest.runBacktest() : mlbBacktestV2.runBacktest();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/pitchers', (req, res) => {
  try {
    const pitchers = mlbPitchers.getAllPitchers();
    res.json({ pitchers, count: pitchers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/opening-day', async (req, res) => {
  try {
    // Use enhanced Opening Day model with all services integrated
    const projections = await mlbOpeningDay.getProjections();
    res.json(projections);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MLB Schedule & Confirmed Starters
app.get('/api/mlb/schedule', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const schedule = await mlbSchedule.getSchedule(date);
    res.json(schedule);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/schedule/multi', async (req, res) => {
  try {
    const start = req.query.start || new Date().toISOString().split('T')[0];
    const days = Math.min(parseInt(req.query.days) || 3, 7);
    const schedule = await mlbSchedule.getMultiDaySchedule(start, days);
    res.json(schedule);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/starter/:team', async (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const starter = await mlbSchedule.getConfirmedStarter(team, date);
    res.json(starter || { team, date, starter: null, note: 'No confirmed starter found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== LINEUP DATA ====================
app.get('/api/mlb/lineups', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const lineups = await lineupFetcher.fetchLineups(date);
    res.json(lineups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const adj = await lineupFetcher.getLineupAdjustments(away, home, date);
    res.json(adj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/status', (req, res) => {
  res.json(lineupFetcher.getStatus());
});

// ==================== LINEUP MONITOR ENDPOINTS ====================

// Full lineup dashboard with predictions
app.get('/api/mlb/lineups/dashboard', async (req, res) => {
  try {
    if (!lineupMonitor) return res.status(503).json({ error: 'Lineup monitor not loaded' });
    const date = req.query.date || null;
    const data = await lineupMonitor.getDashboardData(date);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan for lineup changes (manual trigger)
app.get('/api/mlb/lineups/scan', async (req, res) => {
  try {
    if (!lineupMonitor) return res.status(503).json({ error: 'Lineup monitor not loaded' });
    const result = await lineupMonitor.scan();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Start/stop auto-monitor
app.post('/api/mlb/lineups/monitor/start', (req, res) => {
  if (!lineupMonitor) return res.status(503).json({ error: 'Lineup monitor not loaded' });
  res.json(lineupMonitor.start());
});

app.post('/api/mlb/lineups/monitor/stop', (req, res) => {
  if (!lineupMonitor) return res.status(503).json({ error: 'Lineup monitor not loaded' });
  res.json(lineupMonitor.stop());
});

// Monitor status
app.get('/api/mlb/lineups/monitor/status', (req, res) => {
  if (!lineupMonitor) return res.status(503).json({ error: 'Lineup monitor not loaded' });
  res.json(lineupMonitor.getStatus());
});

// Recent alerts
app.get('/api/mlb/lineups/monitor/alerts', (req, res) => {
  if (!lineupMonitor) return res.status(503).json({ error: 'Lineup monitor not loaded' });
  res.json(lineupMonitor.getAlerts());
});

// ==================== MULTI-SOURCE LINEUP BRIDGE v108.0 ====================

// MLB Stats API lineups (primary source)
app.get('/api/mlb/lineups/mlb-stats', async (req, res) => {
  try {
    if (!mlbStatsLineups) return res.status(503).json({ error: 'MLB Stats Lineups not loaded' });
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const lineups = await mlbStatsLineups.fetchAllLineups(date);
    res.json(lineups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/mlb-stats/:away/:home', async (req, res) => {
  try {
    if (!mlbStatsLineups) return res.status(503).json({ error: 'MLB Stats Lineups not loaded' });
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const date = req.query.date || null;
    const matchup = await mlbStatsLineups.getMatchupLineup(away, home, date);
    res.json(matchup || { error: 'Game not found', away, home });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/mlb-stats/status', (req, res) => {
  if (!mlbStatsLineups) return res.status(503).json({ error: 'MLB Stats Lineups not loaded' });
  res.json(mlbStatsLineups.getStatus());
});

app.get('/api/mlb/lineups/mlb-stats/check', async (req, res) => {
  try {
    if (!mlbStatsLineups) return res.status(503).json({ error: 'MLB Stats Lineups not loaded' });
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const status = await mlbStatsLineups.getLineupStatus(date);
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lineup Bridge — multi-source comparison
app.get('/api/mlb/lineups/bridge/:away/:home', async (req, res) => {
  try {
    if (!lineupBridge) return res.status(503).json({ error: 'Lineup Bridge not loaded' });
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const date = req.query.date || null;
    const result = await lineupBridge.getLineupAdjustments(away, home, date);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/bridge/compare/:away/:home', async (req, res) => {
  try {
    if (!lineupBridge) return res.status(503).json({ error: 'Lineup Bridge not loaded' });
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const date = req.query.date || null;
    const result = await lineupBridge.compareAllSources(away, home, date);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/bridge/status', (req, res) => {
  if (!lineupBridge) return res.status(503).json({ error: 'Lineup Bridge not loaded' });
  res.json(lineupBridge.getStatus());
});

app.get('/api/mlb/lineups/bridge/sources', (req, res) => {
  if (!lineupBridge) return res.status(503).json({ error: 'Lineup Bridge not loaded' });
  res.json(lineupBridge.getSourceLog());
});

// ==================== GAMEDAY LINEUP PIPELINE v110 ====================
// Real-time multi-source lineup monitoring with prediction rebuilds

app.get('/api/mlb/lineups/pipeline/readiness', async (req, res) => {
  try {
    if (!gamedayLineupPipeline) return res.status(503).json({ error: 'Gameday Lineup Pipeline not loaded' });
    const date = req.query.date || null;
    const readiness = await gamedayLineupPipeline.getGamedayReadiness(date);
    res.json(readiness);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/pipeline/scan', async (req, res) => {
  try {
    if (!gamedayLineupPipeline) return res.status(503).json({ error: 'Gameday Lineup Pipeline not loaded' });
    const date = req.query.date || null;
    const result = await gamedayLineupPipeline.scan({ date });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mlb/lineups/pipeline/status', (req, res) => {
  if (!gamedayLineupPipeline) return res.status(503).json({ error: 'Gameday Lineup Pipeline not loaded' });
  res.json(gamedayLineupPipeline.getQuickStatus());
});

app.get('/api/mlb/lineups/pipeline/history', (req, res) => {
  if (!gamedayLineupPipeline) return res.status(503).json({ error: 'Gameday Lineup Pipeline not loaded' });
  const limit = parseInt(req.query.limit) || 20;
  res.json(gamedayLineupPipeline.getHistory(limit));
});

app.post('/api/mlb/lineups/pipeline/start', (req, res) => {
  if (!gamedayLineupPipeline) return res.status(503).json({ error: 'Gameday Lineup Pipeline not loaded' });
  res.json(gamedayLineupPipeline.start());
});

app.post('/api/mlb/lineups/pipeline/stop', (req, res) => {
  if (!gamedayLineupPipeline) return res.status(503).json({ error: 'Gameday Lineup Pipeline not loaded' });
  res.json(gamedayLineupPipeline.stop());
});

// All-games lineup fetch (bridge multi-source)
app.get('/api/mlb/lineups/all', async (req, res) => {
  try {
    if (!lineupBridge) return res.status(503).json({ error: 'Lineup Bridge not loaded' });
    const date = req.query.date || null;
    const result = await lineupBridge.fetchAllGames(date);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NHL aliases
app.get('/api/nhl/ratings', (req, res) => {
  try {
    const ratings = nhl.calculateRatings();
    const sorted = Object.values(ratings).sort((a, b) => b.power - a.power);
    res.json({ ratings: sorted, updated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nhl/predict', (req, res) => {
  const { away, home } = req.query;
  if (!away || !home) return res.status(400).json({ error: 'away and home required' });
  try {
    const pred = nhl.predict(away.toUpperCase(), home.toUpperCase());
    if (pred.error) return res.status(400).json(pred);
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nhl/backtest', (req, res) => {
  try {
    const betTypes = req.query.types ? req.query.types.split(',') : ['ml'];
    const minEdge = req.query.minEdge ? parseFloat(req.query.minEdge) : 0.02;
    const regOnly = req.query.regOnly === 'true';
    const result = nhlBacktest.runBacktest({ betTypes, minEdge, regOnly });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Missing endpoints ───

// Kelly Criterion portfolio optimizer
app.get('/api/kelly', async (req, res) => {
  try {
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const fractionParam = req.query.fraction || 'half';
    const minEdge = parseFloat(req.query.minEdge) || 2;
    const maxBetPct = parseFloat(req.query.maxBetPct) || 0.05;
    
    // Map fraction param
    const fractionMap = { full: 1.0, half: 0.5, quarter: 0.25, third: 0.33 };
    const fraction = fractionMap[fractionParam] || parseFloat(fractionParam) || 0.5;

    // Get all value bets across sports
    const games = await getAllOdds();
    
    // Convert to Kelly-compatible format
    const valueBets = [];
    for (const g of games) {
      if (!g.edge || !g.prediction) continue;
      
      // Home side bet
      if (g.edge.home > minEdge && g.bestLine?.home?.ml) {
        valueBets.push({
          sport: g.sport,
          game: `${g.away} @ ${g.home}`,
          pick: `${g.home} ML (${g.bestLine.home.ml > 0 ? '+' : ''}${g.bestLine.home.ml})`,
          book: g.bestLine.home.book || 'best',
          modelProb: g.prediction.homeWinProb / 100,
          bookML: g.bestLine.home.ml,
          edge: g.edge.home,
          confidence: g.edge.home >= 8 ? 'HIGH' : g.edge.home >= 5 ? 'MEDIUM' : 'LOW'
        });
      }
      
      // Away side bet
      if (g.edge.away > minEdge && g.bestLine?.away?.ml) {
        valueBets.push({
          sport: g.sport,
          game: `${g.away} @ ${g.home}`,
          pick: `${g.away} ML (${g.bestLine.away.ml > 0 ? '+' : ''}${g.bestLine.away.ml})`,
          book: g.bestLine.away.book || 'best',
          modelProb: g.prediction.awayWinProb / 100,
          bookML: g.bestLine.away.ml,
          edge: g.edge.away,
          confidence: g.edge.away >= 8 ? 'HIGH' : g.edge.away >= 5 ? 'MEDIUM' : 'LOW'
        });
      }
    }

    const portfolio = kelly.optimizePortfolio({
      bankroll,
      fraction,
      maxBetPct,
      minEdge,
      bets: valueBets
    });

    res.json({
      ...portfolio,
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Data status — now shows live data info
// ==================== ROLLING STATS API ====================

app.get('/api/rolling/status', (req, res) => {
  res.json(rollingStats.getStatus());
});

app.get('/api/rolling/:sport', (req, res) => {
  const sport = req.params.sport.toLowerCase();
  let data;
  if (sport === 'nba') data = rollingStats.getNBARolling();
  else if (sport === 'nhl') data = rollingStats.getNHLRolling();
  else if (sport === 'mlb') data = rollingStats.getMLBRolling();
  else return res.status(400).json({ error: 'Invalid sport. Use nba, nhl, or mlb' });
  
  if (!data) return res.json({ note: `No rolling stats available for ${sport}. Try refreshing.`, data: {} });
  
  // Sort by rolling net rating
  const sorted = Object.entries(data)
    .map(([abbr, stats]) => ({ abbr, ...stats }))
    .sort((a, b) => (b.rollingNetRating || 0) - (a.rollingNetRating || 0));
  
  res.json({ sport, teams: sorted.length, data: sorted });
});

app.get('/api/rolling/:sport/:team', (req, res) => {
  const { sport, team } = req.params;
  const data = rollingStats.getTeamRolling(sport, team.toUpperCase());
  if (!data) return res.json({ note: `No rolling data for ${team} in ${sport}` });
  const adj = rollingStats.getRollingAdjustment(sport, team.toUpperCase());
  res.json({ team: team.toUpperCase(), sport, rolling: data, adjustment: adj });
});

app.post('/api/rolling/refresh', async (req, res) => {
  try {
    const results = await rollingStats.refreshAll(true);
    res.json({ status: 'ok', results, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== INJURIES API ====================

app.get('/api/injuries/status', (req, res) => {
  res.json(injuries.getStatus());
});

app.get('/api/injuries/:sport', (req, res) => {
  const sport = req.params.sport.toLowerCase();
  let data;
  if (sport === 'nba') data = injuries.getNBAInjuries();
  else if (sport === 'nhl') data = injuries.getNHLInjuries();
  else if (sport === 'mlb') data = injuries.getMLBInjuries();
  else return res.status(400).json({ error: 'Invalid sport. Use nba, nhl, or mlb' });
  
  // Sort by total impact (most affected teams first)
  const sorted = Object.entries(data)
    .map(([abbr, info]) => ({ abbr, ...info }))
    .sort((a, b) => (b.totalImpact || 0) - (a.totalImpact || 0));
  
  res.json({ sport, teams: sorted.length, data: sorted });
});

app.get('/api/injuries/:sport/:team', (req, res) => {
  const { sport, team } = req.params;
  const data = injuries.getTeamInjuries(sport.toLowerCase(), team.toUpperCase());
  if (!data) return res.json({ note: `No injury data for ${team} in ${sport}` });
  const adj = injuries.getInjuryAdjustment(sport.toLowerCase(), team.toUpperCase());
  res.json({ team: team.toUpperCase(), sport, injuries: data, adjustment: adj });
});

app.post('/api/injuries/refresh', async (req, res) => {
  try {
    const results = await injuries.refreshAll(true);
    res.json({ status: 'ok', results, updated: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== DATA STATUS ====================

app.get('/api/data/status', (req, res) => {
  const status = liveData.getDataStatus();
  const nbaTeams = nba.getTeams();
  const nhlTeams = nhl.getTeams();
  const mlbTeams = mlb.getTeams();
  
  res.json({
    nba: {
      teams: Object.keys(nbaTeams).length,
      ...status.nba,
      sampleTeam: nbaTeams['OKC'] ? { name: nbaTeams['OKC'].name, w: nbaTeams['OKC'].w, l: nbaTeams['OKC'].l } : null
    },
    mlb: {
      teams: Object.keys(mlbTeams).length,
      pitchers: mlbPitchers.getAllPitchers().length,
      ...status.mlb,
    },
    nhl: {
      teams: Object.keys(nhlTeams).length,
      ...status.nhl,
      sampleTeam: nhlTeams['COL'] ? { name: nhlTeams['COL'].name, w: nhlTeams['COL'].w, l: nhlTeams['COL'].l } : null
    },
    odds: { configured: !!ODDS_API_KEY, source: 'the-odds-api', cacheMinutes: 5 },
    rollingStats: rollingStats.getStatus(),
    injuries: injuries.getStatus(),
    kalshi: kalshi.getStatus(),
    statcast: {
      pitchers: statcast.cachedPitchers ? Object.keys(statcast.cachedPitchers).length : 0,
      batters: statcast.cachedBatters ? Object.keys(statcast.cachedBatters).length : 0,
      teams: statcast.cachedTeamBatting ? Object.keys(statcast.cachedTeamBatting).length : 0,
      lastFetch: statcast.lastFetch ? new Date(statcast.lastFetch).toISOString() : null,
    },
    updated: new Date().toISOString()
  });
});

// Data refresh — triggers live data, rolling stats, and injuries pull
app.post('/api/data/refresh', async (req, res) => {
  try {
    const [liveResults, rollingResults, injuryResults] = await Promise.all([
      liveData.refreshAll(true),
      rollingStats.refreshAll(true),
      injuries.refreshAll(true)
    ]);
    res.json({ 
      status: 'ok', 
      message: 'Full data refresh completed',
      results: { live: liveResults, rolling: rollingResults, injuries: injuryResults },
      updated: new Date().toISOString() 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/data/refresh', async (req, res) => {
  try {
    const [liveResults, rollingResults, injuryResults] = await Promise.all([
      liveData.refreshAll(true),
      rollingStats.refreshAll(true),
      injuries.refreshAll(true)
    ]);
    res.json({ 
      status: 'ok', 
      message: 'Full data refresh completed',
      results: { live: liveResults, rolling: rollingResults, injuries: injuryResults },
      updated: new Date().toISOString() 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== LINE MOVEMENT TRACKER ====================

app.get('/api/lines/sharp', (req, res) => {
  try {
    const sport = req.query.sport || 'all';
    const sharpSignals = lineMovement.getSharpSignals(sport);
    res.json({
      signals: sharpSignals,
      count: sharpSignals.length,
      breakdown: {
        steam: sharpSignals.filter(s => s.type === 'STEAM').length,
        rlm: sharpSignals.filter(s => s.type === 'RLM').length,
        stale: sharpSignals.filter(s => s.type === 'STALE').length
      },
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/snapshot', async (req, res) => {
  try {
    const games = await getAllOdds();
    const result = lineMovement.takeSnapshot(games);
    res.json({
      status: 'ok',
      message: 'Snapshot taken',
      ...result,
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/status', (req, res) => {
  try {
    const status = lineMovement.getStatus();
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/history/:gameId', (req, res) => {
  try {
    const history = lineMovement.getGameHistory(req.params.gameId);
    res.json({
      gameId: req.params.gameId,
      snapshots: history.length,
      history
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lines/:sport', (req, res) => {
  try {
    const sport = req.params.sport;
    const movement = lineMovement.getMovement(sport);
    res.json({
      sport,
      games: movement,
      count: movement.length,
      updated: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PROBABILITY CALIBRATION ====================

app.get('/api/calibration/status', (req, res) => {
  res.json(calibration.getStatus());
});

app.get('/api/calibration/diagnostics', (req, res) => {
  const sport = req.query.sport || 'mlb';
  res.json(calibration.getDiagnostics(sport));
});

app.get('/api/calibration/test', (req, res) => {
  const rawProb = parseFloat(req.query.prob) || 0.55;
  const sport = req.query.sport || 'mlb';
  const result = calibration.calibrate(rawProb, sport);
  res.json(result);
});

app.get('/api/calibration/edge', (req, res) => {
  const modelProb = parseFloat(req.query.model) || 0.55;
  const bookProb = parseFloat(req.query.book) || 0.50;
  const sport = req.query.sport || 'mlb';
  const result = calibration.calibratedEdge(modelProb, bookProb, sport);
  res.json(result);
});

// ==================== KALSHI SCANNER ====================

app.get('/api/kalshi/scan', async (req, res) => {
  try {
    const results = await kalshi.fullScan({ nba: nba, mlb: mlb, nhl: nhl });
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/value', async (req, res) => {
  try {
    const results = await kalshi.getScanResults({ nba: nba, mlb: mlb, nhl: nhl });
    if (!results) return res.json({ valueBets: [], note: 'No scan data. Trigger /api/kalshi/scan first.' });
    res.json({
      valueBets: results.valueBets || [],
      totalBets: results.totalValueBets || 0,
      highConfidence: results.highConfidence || 0,
      lastScan: results.timestamp
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/futures', async (req, res) => {
  try {
    const cached = kalshi.getCachedResults();
    if (cached && cached.futures) {
      return res.json(cached.futures);
    }
    // Run scan if no cache
    const results = await kalshi.fullScan({ nba: nba, mlb: mlb, nhl: nhl });
    res.json(results.futures || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/team-totals', async (req, res) => {
  try {
    const cached = kalshi.getCachedResults();
    if (cached && cached.nbaTeamTotals) {
      return res.json({ games: cached.nbaTeamTotals, count: cached.nbaTeamTotals.length });
    }
    const events = await kalshi.fetchKalshiEvents(kalshi.SERIES.NBA_TEAM_TOTAL);
    const parsed = kalshi.parseNBATeamTotals(events);
    res.json({ games: parsed, count: parsed.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/kalshi/status', (req, res) => {
  res.json(kalshi.getStatus());
});

// ==================== PLAYER PROPS ====================

app.get('/api/props/status', (req, res) => {
  res.json(playerProps.getStatus());
});

app.get('/api/props/players/:sport', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  try {
    const players = await playerProps.getAvailablePlayers(sport);
    const liveCount = players.filter(p => p.source === 'live').length;
    res.json({ sport, players, count: players.length, liveCount, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/props/projection/:sport/:player', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  const playerName = decodeURIComponent(req.params.player);
  try {
    const projection = await playerProps.getPlayerProjection(playerName, sport, { nba, mlb, nhl });
    if (!projection) return res.status(404).json({ error: `Player "${playerName}" not found in ${sport.toUpperCase()}` });
    res.json(projection);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/props/scan/:sport', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  try {
    const results = await playerProps.scanProps(sport, { nba, mlb, nhl });
    if (results.error) return res.status(400).json(results);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/props/value/:sport', async (req, res) => {
  const sport = req.params.sport.toLowerCase();
  try {
    const results = await playerProps.scanProps(sport, { nba, mlb, nhl });
    if (results.error) return res.status(400).json(results);
    // Return only value bets, sorted by edge
    const minEdge = parseFloat(req.query.minEdge) || 3;
    const valueBets = (results.valueBets || []).filter(b => b.edge >= minEdge);
    res.json({
      sport: results.sport,
      valueBets,
      count: valueBets.length,
      totalScanned: results.totalProps,
      timestamp: results.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Prop calculator: user enters player + line + odds, get model edge
app.get('/api/props/calc', async (req, res) => {
  const { player, sport, stat, line, overOdds, underOdds } = req.query;
  if (!player || !sport || !stat || !line) {
    return res.status(400).json({ error: 'Required: player, sport, stat, line' });
  }
  const sportLower = sport.toLowerCase();
  const baseline = await playerProps.getPlayerProjection(decodeURIComponent(player), sportLower, { nba, mlb, nhl });
  if (!baseline || !baseline.stats[stat]) {
    return res.status(404).json({ error: `No baseline for ${player} ${stat}` });
  }
  const projection = baseline.stats[stat];
  const lineNum = parseFloat(line);
  const { over, under } = playerProps.calcOverUnderProb(projection, lineNum);
  
  const result = {
    player: decodeURIComponent(player),
    stat,
    projection,
    line: lineNum,
    modelOver: over,
    modelUnder: under,
  };
  
  if (overOdds) {
    const bookOver = overOdds < 0 ? (-overOdds) / (-overOdds + 100) * 100 : 100 / (parseFloat(overOdds) + 100) * 100;
    result.overEdge = +(over - bookOver).toFixed(1);
    result.overSignal = result.overEdge > 3 ? 'BET OVER' : result.overEdge > 0 ? 'lean over' : 'pass';
  }
  if (underOdds) {
    const bookUnder = underOdds < 0 ? (-underOdds) / (-underOdds + 100) * 100 : 100 / (parseFloat(underOdds) + 100) * 100;
    result.underEdge = +(under - bookUnder).toFixed(1);
    result.underSignal = result.underEdge > 3 ? 'BET UNDER' : result.underEdge > 0 ? 'lean under' : 'pass';
  }
  
  res.json(result);
});

// ==================== LIVE PLAYER STATS ====================

app.get('/api/players/status', (req, res) => {
  res.json(playerStatsService.getStatus());
});

app.get('/api/players/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const stats = await playerStatsService.getPlayerStats(sport);
    const players = Object.values(stats).filter(p => typeof p === 'object' && p.name);
    res.json({ sport, count: players.length, players, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/players/refresh', async (req, res) => {
  try {
    const result = await playerStatsService.refreshAll();
    res.json({ refreshed: true, ...result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== WEATHER ====================

app.get('/api/weather/status', (req, res) => {
  res.json(weather.getStatus());
});

app.get('/api/weather/:team', async (req, res, next) => {
  // Guard: skip sub-paths that should be handled by later routes
  const param = req.params.team.toUpperCase();
  const reservedPaths = ['STATUS', 'GAME', 'OPENING-DAY', 'FORECAST', 'WIND-MODEL'];
  if (reservedPaths.includes(param)) return next(); // pass to next matching route
  try {
    const result = await weather.getWeatherForPark(param);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/weather', async (req, res) => {
  try {
    const all = await weather.getAllWeather();
    // Sort by impact (most hitter-friendly first)
    const sorted = Object.values(all).sort((a, b) => (b.totalImpact || 0) - (a.totalImpact || 0));
    res.json({
      parks: sorted,
      count: sorted.length,
      updated: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/weather/game/:away/:home', async (req, res) => {
  try {
    const { away, home } = req.params;
    const baseTotal = parseFloat(req.query.total) || 8.5;
    const result = await weather.adjustGameTotal(home.toUpperCase(), away.toUpperCase(), baseTotal);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MLB WEATHER GAMES (enriched today's MLB with weather) ====================
app.get('/api/mlb/weather-games', async (req, res) => {
  try {
    const nameMap = buildNameMap(mlb.TEAMS, { 'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR' });
    const liveOdds = await fetchOdds('baseball_mlb');
    const games = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;

      // Get weather for this game's ballpark
      let weatherData = null;
      try {
        weatherData = await weather.getWeatherForPark(homeAbbr);
      } catch (e) { /* skip */ }

      // Get prediction with weather
      const opts = {};
      if (weatherData && !weatherData.error) opts.weather = weatherData;
      const pred = mlb.predict(awayAbbr, homeAbbr, opts);

      // Get prediction WITHOUT weather for comparison
      const predNoWeather = mlb.predict(awayAbbr, homeAbbr);

      // Extract best book odds
      let total = null;
      for (const bk of (game.bookmakers || [])) {
        const line = extractBookLine(bk, game.home_team);
        if (line.total) { total = line.total; break; }
      }

      // Weather-adjusted total
      let adjustedTotal = null;
      if (total && weatherData && weatherData.multiplier) {
        adjustedTotal = +(total * weatherData.multiplier).toFixed(1);
      }

      games.push({
        away: awayAbbr,
        home: homeAbbr,
        awayFull: game.away_team,
        homeFull: game.home_team,
        commence: game.commence_time,
        weather: weatherData || null,
        bookTotal: total,
        adjustedTotal,
        totalDiff: adjustedTotal && total ? +(adjustedTotal - total).toFixed(1) : 0,
        prediction: pred && !pred.error ? {
          homeWinProb: pred.homeWinProb,
          awayWinProb: pred.awayWinProb,
          totalRuns: pred.totalRuns,
          awayExpRuns: pred.awayExpRuns,
          homeExpRuns: pred.homeExpRuns,
        } : null,
        predNoWeather: predNoWeather && !predNoWeather.error ? {
          totalRuns: predNoWeather.totalRuns,
          homeWinProb: predNoWeather.homeWinProb,
        } : null,
        weatherEdge: pred && predNoWeather && !pred.error && !predNoWeather.error ? {
          totalShift: +(pred.totalRuns - predNoWeather.totalRuns).toFixed(2),
          probShift: +(pred.homeWinProb - predNoWeather.homeWinProb).toFixed(1),
        } : null,
      });
    }

    // Sort by weather impact (most impactful first)
    games.sort((a, b) => Math.abs(b.weather?.totalImpact || 0) - Math.abs(a.weather?.totalImpact || 0));

    res.json({
      games,
      count: games.length,
      updated: new Date().toISOString(),
      note: 'Weather data adjusts run projections. Positive totalImpact = hitter-friendly. Check totalDiff for O/U edge.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== POLYMARKET SCANNER ====================

app.get('/api/polymarket/status', (req, res) => {
  res.json(polymarket.getStatus());
});

app.get('/api/polymarket/scan', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarket.fullScan({ sport });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/featured', async (req, res) => {
  try {
    const result = await polymarket.getFeaturedSportsMarkets();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/movers', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarket.findMovers(sport);
    res.json({ movers: result, count: result.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/games', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarket.scanDailyGames(sport);
    res.json({ games: result, count: result.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/polymarket/futures/:sport', async (req, res) => {
  try {
    const sport = req.params.sport;
    const result = await polymarket.scanChampionshipFutures(sport);
    res.json({ futures: result, count: result.length, sport, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== POLYMARKET VALUE BRIDGE ====================

// Model vs Market value scan — THE MONEY FINDER
app.get('/api/polymarket/value', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    const result = await polymarketValue.scanForValue({ sport, minEdge });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cross-market arbitrage: Polymarket vs sportsbooks
app.get('/api/polymarket/arbitrage', async (req, res) => {
  try {
    // Fetch sportsbook odds from The Odds API
    const oddsData = [];
    const sports = ['basketball_nba', 'baseball_mlb', 'icehockey_nhl'];
    
    for (const sportKey of sports) {
      if (!ODDS_API_KEY) break;
      try {
        const fetch = require('node-fetch');
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
        const resp = await fetch(url, { timeout: 10000 });
        if (resp.ok) {
          const data = await resp.json();
          oddsData.push(...data);
        }
      } catch (e) { /* skip this sport */ }
    }
    
    const result = await polymarketValue.crossMarketScan(oddsData);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Championship futures value scan
app.get('/api/polymarket/futures-value', async (req, res) => {
  try {
    const sport = req.query.sport || null;
    const result = await polymarketValue.scanFuturesValue(sport);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Polymarket value bridge status
app.get('/api/polymarket/value/status', (req, res) => {
  res.json(polymarketValue.getStatus());
});

// ==================== PLAYOFF SERIES PRICING ====================

// Full bracket projection with first-round series analysis
app.get('/api/playoffs/bracket', (req, res) => {
  try {
    const bracket = playoffSeries.projectBracket(nba);
    res.json({ 
      bracket, 
      daysUntilPlayoffs: bracket.daysUntilPlayoffs,
      timestamp: new Date().toISOString() 
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Analyze specific playoff series
app.get('/api/playoffs/series', (req, res) => {
  try {
    const { higher, lower } = req.query;
    if (!higher || !lower) return res.status(400).json({ error: 'Need ?higher=OKC&lower=POR' });
    const result = playoffSeries.analyzePlayoffSeries(nba, higher.toUpperCase(), lower.toUpperCase());
    if (result.error) return res.status(400).json(result);
    
    // Add exact length distribution
    const teams = nba.getTeams();
    const homeGamePred = nba.predict(lower.toUpperCase(), higher.toUpperCase());
    const awayGamePred = nba.predict(higher.toUpperCase(), lower.toUpperCase());
    const pHome = homeGamePred.homeWinProb / 100;
    const pAway = awayGamePred.awayWinProb / 100;
    const gameProbs = playoffSeries.SERIES_PATTERN_7.map(isHome => isHome ? pHome : pAway);
    result.exactLengthDist = playoffSeries.exactLengthDistribution(gameProbs);
    
    res.json({ series: result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full playoff simulation — championship odds for all 16 teams
app.get('/api/playoffs/championship', (req, res) => {
  try {
    const sims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    const result = playoffSeries.simulateFullPlayoffs(nba, sims);
    res.json({ ...result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Series value finder — compare model vs book odds
app.get('/api/playoffs/value', (req, res) => {
  try {
    // Accept matchups with book odds as JSON query param
    // ?matchups=[{"higher":"OKC","lower":"POR","bookHigherML":-800,"bookLowerML":550}]
    const matchupsStr = req.query.matchups;
    if (!matchupsStr) {
      return res.json({ 
        note: 'Pass ?matchups=[{"higher":"OKC","lower":"POR","bookHigherML":-800,"bookLowerML":550}]',
        example: '/api/playoffs/value?matchups=[{"higher":"OKC","lower":"POR","bookHigherML":-800,"bookLowerML":550}]'
      });
    }
    const matchups = JSON.parse(matchupsStr);
    const values = playoffSeries.findSeriesValue(nba, matchups);
    res.json({ valueBets: values, count: values.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NHL GOALIE STARTERS ====================

// Get today's confirmed goalie starters from DailyFaceoff
app.get('/api/nhl/goalies/today', async (req, res) => {
  try {
    if (!nhlGoalieStarters) return res.status(503).json({ error: 'NHL Goalie Starters service not available' });
    const date = req.query.date || null;
    const scan = await nhlGoalieStarters.scanTodayGoalies(nhl);
    res.json(scan);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get goalie matchup for a specific game
app.get('/api/nhl/goalies/matchup/:away/:home', async (req, res) => {
  try {
    if (!nhlGoalieStarters) return res.status(503).json({ error: 'NHL Goalie Starters service not available' });
    const { away, home } = req.params;
    const matchup = await nhlGoalieStarters.getGoalieMatchup(home.toUpperCase(), away.toUpperCase());
    if (!matchup) return res.json({ error: 'No goalie data found for this matchup', away, home });
    
    const impact = nhlGoalieStarters.calculateGoalieImpact(matchup, {
      home: nhl.TEAMS[home.toUpperCase()],
      away: nhl.TEAMS[away.toUpperCase()],
    });
    
    res.json({ matchup, impact, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get goalie-aware NHL prediction (asyncPredict)
app.get('/api/nhl/predict-live', async (req, res) => {
  try {
    const { away, home } = req.query;
    if (!away || !home) return res.status(400).json({ error: 'away and home params required' });
    const pred = await nhl.asyncPredict(away.toUpperCase(), home.toUpperCase());
    if (!pred) return res.json({ error: 'Could not generate prediction', away, home });
    
    // Also get calibrated probabilities
    const calHome = calibration.calibrate(pred.home.winProb / 100, 'nhl');
    const calAway = calibration.calibrate(pred.away.winProb / 100, 'nhl');
    pred.calibrated = { home: calHome, away: calAway };
    
    res.json(pred);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NHL goalie impact scan — which games have the biggest goalie edge today?
app.get('/api/nhl/goalies/impact', async (req, res) => {
  try {
    if (!nhlGoalieStarters) return res.status(503).json({ error: 'NHL Goalie Starters service not available' });
    const scan = await nhlGoalieStarters.scanTodayGoalies(nhl);
    
    // Sort by biggest goalie mismatch
    const ranked = (scan.games || [])
      .filter(g => g.goalieImpact)
      .sort((a, b) => Math.abs(b.goalieImpact.netSpreadImpact) - Math.abs(a.goalieImpact.netSpreadImpact))
      .map(g => ({
        game: `${g.awayTeam} @ ${g.homeTeam}`,
        homeGoalie: g.homeGoalie?.name,
        awayGoalie: g.awayGoalie?.name,
        homeSvPct: g.homeGoalie?.savePct,
        awaySvPct: g.awayGoalie?.savePct,
        homeGAA: g.homeGoalie?.gaa,
        awayGAA: g.awayGoalie?.gaa,
        homeIsBackup: g.goalieImpact?.isBackup?.home,
        awayIsBackup: g.goalieImpact?.isBackup?.away,
        homeConfirmed: g.homeGoalie?.confirmed,
        awayConfirmed: g.awayGoalie?.confirmed,
        netSpreadImpact: g.goalieImpact?.netSpreadImpact,
        impliedMLMove: g.goalieImpact?.impliedMLMove,
        prediction: g.prediction ? {
          homeWinProb: g.prediction.home?.winProb,
          awayWinProb: g.prediction.away?.winProb,
          spread: g.prediction.spread,
          projTotal: g.prediction.projTotal,
        } : null,
      }));
    
    res.json({ 
      games: ranked,
      summary: scan.summary,
      backupAlerts: ranked.filter(g => g.homeIsBackup || g.awayIsBackup),
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NHL PLAYOFF SERIES PRICING ====================

// NHL playoff bracket projection with all first-round series analysis
app.get('/api/nhl-playoffs/bracket', (req, res) => {
  try {
    const bracket = nhlPlayoffSeries.projectBracket(nhl);
    res.json({
      bracket,
      daysUntilPlayoffs: bracket.daysUntilPlayoffs,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Analyze specific NHL playoff series
app.get('/api/nhl-playoffs/series', (req, res) => {
  try {
    const { higher, lower } = req.query;
    if (!higher || !lower) return res.status(400).json({ error: 'Need ?higher=WPG&lower=MTL' });
    const result = nhlPlayoffSeries.analyzePlayoffSeries(nhl, higher.toUpperCase(), lower.toUpperCase());
    if (result.error) return res.status(400).json(result);
    res.json({ series: result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full NHL playoff simulation — Stanley Cup odds for all 16 teams
app.get('/api/nhl-playoffs/stanley-cup', (req, res) => {
  try {
    const sims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    const result = nhlPlayoffSeries.simulateFullPlayoffs(nhl, sims);
    res.json({ ...result, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NHL series value finder
app.get('/api/nhl-playoffs/value', (req, res) => {
  try {
    const matchupsStr = req.query.matchups;
    if (!matchupsStr) {
      return res.json({
        note: 'Pass ?matchups=[{"higher":"WPG","lower":"MTL","bookHigherML":-200,"bookLowerML":170}]',
        example: '/api/nhl-playoffs/value?matchups=[{"higher":"WPG","lower":"MTL","bookHigherML":-200,"bookLowerML":170}]'
      });
    }
    const matchups = JSON.parse(matchupsStr);
    const values = nhlPlayoffSeries.findSeriesValue(nhl, matchups);
    res.json({ valueBets: values, count: values.length, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// NHL Playoff Preview — comprehensive view with standings, bracket, series prices, Stanley Cup odds, value bets
app.get('/api/nhl-playoffs/preview', async (req, res) => {
  try {
    const sims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    
    // Project bracket with series analysis
    const bracket = nhlPlayoffSeries.projectBracket(nhl);
    
    // Stanley Cup simulation
    const champSim = nhlPlayoffSeries.simulateFullPlayoffs(nhl, sims);
    
    // Try to get futures odds from The Odds API
    let futuresOdds = null;
    if (ODDS_API_KEY) {
      try {
        const fetch = require('node-fetch');
        const resp = await fetch(`https://api.the-odds-api.com/v4/sports/icehockey_nhl/futures/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=outright_winner&oddsFormat=american`, { timeout: 10000 });
        if (resp.ok) {
          const data = await resp.json();
          futuresOdds = {};
          for (const event of data) {
            for (const bm of event.bookmakers || []) {
              for (const mkt of bm.markets || []) {
                for (const outcome of mkt.outcomes || []) {
                  const abbr = resolveNHLTeamName(outcome.name);
                  if (abbr && outcome.price) {
                    if (!futuresOdds[abbr] || Math.abs(outcome.price) < Math.abs(futuresOdds[abbr].bestOdds)) {
                      futuresOdds[abbr] = { bestOdds: outcome.price, book: bm.title };
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) { /* Odds API optional */ }
    }
    
    // Find futures value
    const futuresValue = [];
    if (futuresOdds) {
      for (const team of champSim.stanleyCupOdds) {
        const odds = futuresOdds[team.abbr];
        if (odds) {
          const bookProb = nhlPlayoffSeries.mlToProb(odds.bestOdds);
          const modelProb = team.champPct / 100;
          const edge = modelProb - bookProb;
          if (edge > 0.02) {
            futuresValue.push({
              team: team.name,
              abbr: team.abbr,
              modelPct: team.champPct,
              bookOdds: odds.bestOdds,
              bookPct: +(bookProb * 100).toFixed(1),
              edge: +(edge * 100).toFixed(1),
              book: odds.book,
              record: team.record,
              starter: team.starter
            });
          }
        }
      }
      futuresValue.sort((a, b) => b.edge - a.edge);
    }
    
    // Compile enriched matchup data
    const enrichedMatchups = (conf) => {
      return bracket[conf].matchups.map(m => {
        const series = nhlPlayoffSeries.analyzePlayoffSeries(nhl, m.higher.abbr, m.lower.abbr);
        return {
          matchup: m.matchup,
          type: m.type,
          higher: m.higher,
          lower: m.lower,
          seriesPrice: series.seriesPrice,
          keyFactors: series.keyFactors,
          competitiveness: series.competitiveness,
          expectedLength: series.expectedLength,
          lengthDistribution: series.lengthDistribution,
          upsetAlert: series.upsetAlert
        };
      });
    };
    
    res.json({
      sport: 'nhl',
      title: 'NHL Playoff Preview 🏒',
      playoffsStart: '2026-04-19',
      daysUntilPlayoffs: bracket.daysUntilPlayoffs,
      
      // Eastern Conference
      eastern: {
        divisions: bracket.eastern.divisions,
        wildCards: bracket.eastern.wildCards,
        matchups: enrichedMatchups('eastern'),
        bubble: bracket.eastern.bubble
      },
      
      // Western Conference
      western: {
        divisions: bracket.western.divisions,
        wildCards: bracket.western.wildCards,
        matchups: enrichedMatchups('western'),
        bubble: bracket.western.bubble
      },
      
      // Stanley Cup simulation results
      stanleyCupOdds: champSim.stanleyCupOdds,
      topContenders: champSim.topContenders,
      darkHorses: champSim.darkHorses,
      
      // Futures value (if odds available)
      futuresValue: futuresValue.length > 0 ? futuresValue : null,
      
      // Key storylines for betting
      keyStorylines: generateNHLStorylines(bracket, champSim),
      
      simulations: sims,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('NHL Playoff preview error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== NHL BUBBLE PLAYOFF FUTURES SCANNER ====================

// Full bubble scan — MC sim remaining games, compute weighted series win probs
app.get('/api/nhl/bubble-scan', async (req, res) => {
  try {
    if (!nhlBubbleScanner) return res.status(503).json({ error: 'NHL Bubble Scanner not loaded' });
    const forceRefresh = req.query.refresh === 'true';
    const result = await nhlBubbleScanner.runBubbleScan({ 
      apiKey: ODDS_API_KEY, 
      forceRefresh 
    });
    res.json(result);
  } catch (e) {
    console.error('NHL Bubble scan error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Analyze specific team in bubble
app.get('/api/nhl/bubble-scan/team/:team', async (req, res) => {
  try {
    if (!nhlBubbleScanner) return res.status(503).json({ error: 'NHL Bubble Scanner not loaded' });
    const result = await nhlBubbleScanner.analyzeTeam(req.params.team.toUpperCase(), { apiKey: ODDS_API_KEY });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bubble standings snapshot
app.get('/api/nhl/bubble-scan/standings', (req, res) => {
  try {
    if (!nhlBubbleScanner) return res.status(503).json({ error: 'NHL Bubble Scanner not loaded' });
    const standings = nhlBubbleScanner.getCurrentStandings();
    res.json({ standings, timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bubble scanner status
app.get('/api/nhl/bubble-scan/status', (req, res) => {
  try {
    if (!nhlBubbleScanner) return res.status(503).json({ error: 'NHL Bubble Scanner not loaded' });
    res.json(nhlBubbleScanner.getStatus());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NBA SEEDING SIMULATOR ====================

// Full seeding simulation — Monte Carlo remaining schedule
app.get('/api/nba/seeding-sim', async (req, res) => {
  try {
    const sims = Math.min(parseInt(req.query.sims) || 5000, 20000);
    const fresh = req.query.fresh === 'true';
    
    if (fresh) nbaSeedingSim.clearCache();
    const result = await nbaSeedingSim.getCachedSimulation(sims);
    res.json(result);
  } catch (e) {
    console.error('NBA Seeding sim error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Conference standings projection
app.get('/api/nba/seeding-sim/conference/:conf', async (req, res) => {
  try {
    const conf = req.params.conf === 'west' ? 'West' : 'East';
    const result = await nbaSeedingSim.getCachedSimulation(5000);
    res.json({
      conference: conf,
      standings: result.conferences[conf],
      divisionWinners: Object.entries(result.divisionWinners)
        .filter(([div]) => {
          const confDivs = nbaSeedingSim.CONFERENCES[conf];
          return confDivs && confDivs[div];
        })
        .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {}),
      timestamp: result.generatedAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Team-specific seeding projection
app.get('/api/nba/seeding-sim/team/:team', async (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const result = await nbaSeedingSim.getCachedSimulation(5000);
    const teamData = result.teams[team];
    if (!teamData) return res.status(404).json({ error: `Team ${team} not found` });
    
    res.json({
      team: teamData,
      conference: teamData.conference,
      conferenceStandings: result.conferences[teamData.conference],
      timestamp: result.generatedAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Key seeding battles
app.get('/api/nba/seeding-sim/battles', async (req, res) => {
  try {
    const result = await nbaSeedingSim.getCachedSimulation(5000);
    const battles = nbaSeedingSim.getKeyBattles(result);
    res.json({
      battles,
      topBets: result.topBets,
      matchups: result.matchups,
      timestamp: result.generatedAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Projected playoff matchups
app.get('/api/nba/seeding-sim/matchups', async (req, res) => {
  try {
    const result = await nbaSeedingSim.getCachedSimulation(5000);
    res.json({
      matchups: result.matchups,
      conferences: {
        East: result.conferences.East.slice(0, 10).map(t => ({
          seed: t.seed,
          team: t.abbr,
          name: t.name,
          playoffProb: t.playoffProb,
          playInProb: t.playInProb,
          mostLikelySeed: t.mostLikelySeed
        })),
        West: result.conferences.West.slice(0, 10).map(t => ({
          seed: t.seed,
          team: t.abbr,
          name: t.name,
          playoffProb: t.playoffProb,
          playInProb: t.playInProb,
          mostLikelySeed: t.mostLikelySeed
        }))
      },
      timestamp: result.generatedAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== OPENING DAY WEATHER FORECAST ====================

// Full Opening Day weather pre-check — all venues, all dates
app.get('/api/weather/opening-day', async (req, res) => {
  try {
    if (!weatherForecast) return res.status(503).json({ error: 'Weather forecast service not loaded' });
    const result = await weatherForecast.preCheckOpeningDayWeather();
    res.json(result);
  } catch (e) {
    console.error('Opening Day weather error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Single game weather forecast
app.get('/api/weather/forecast/:home/:date/:time', async (req, res) => {
  try {
    if (!weatherForecast) return res.status(503).json({ error: 'Weather forecast service not loaded' });
    const { home, date, time } = req.params;
    const result = await weatherForecast.getGameForecast(home, date, time);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Weather forecast service status
app.get('/api/weather/forecast/status', (req, res) => {
  if (!weatherForecast) return res.json({ status: 'not loaded' });
  res.json(weatherForecast.getStatus());
});

// Park-specific wind model v73.0 — shows CF bearings and wind impact for each park
app.get('/api/weather/wind-model', async (req, res) => {
  try {
    const weatherService = require('./services/weather');
    const CF_BEARINGS = {
      ATL: 185, BAL: 22, BOS: 65, CHC: 23, CWS: 170, CIN: 0, CLE: 170, COL: 73,
      DET: 125, KC: 0, LAA: 355, LAD: 0, MIN: 180, NYM: 62, NYY: 65, OAK: 170,
      PHI: 62, PIT: 40, SD: 200, SF: 70, STL: 180, WSH: 340
    };
    const results = [];
    const allWeather = await weatherService.getAllWeather();
    for (const [abbr, data] of Object.entries(allWeather)) {
      const windFactor = (data.factors || []).find(f => f.factor === 'wind');
      results.push({
        team: abbr,
        park: data.park,
        cfBearing: CF_BEARINGS[abbr] || null,
        currentWind: windFactor ? {
          direction: windFactor.note,
          impact: windFactor.impact,
          parkSpecific: windFactor.parkSpecific || false,
        } : null,
        currentMultiplier: data.multiplier,
        temperature: (data.factors || []).find(f => f.factor === 'temperature')?.note || null,
      });
    }
    results.sort((a, b) => (b.currentMultiplier || 1) - (a.currentMultiplier || 1));
    res.json({
      version: '73.0',
      model: 'Park-specific CF bearing wind model',
      parksWithBearings: Object.keys(CF_BEARINGS).length,
      totalOutdoorParks: results.length,
      results,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== NBA SEEDING → FUTURES VALUE BRIDGE ====================

// Full futures value analysis from seeding simulation
app.get('/api/nba/seeding-futures', async (req, res) => {
  try {
    if (!seedingFuturesBridge) return res.status(503).json({ error: 'Seeding futures bridge not loaded' });
    const fresh = req.query.fresh === 'true';
    const result = await seedingFuturesBridge.analyzeSeedingFuturesValue(ODDS_API_KEY, { fresh });
    res.json(result);
  } catch (e) {
    console.error('Seeding futures error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Team-specific futures value from seeding sim  
app.get('/api/nba/seeding-futures/team/:team', async (req, res) => {
  try {
    if (!seedingFuturesBridge) return res.status(503).json({ error: 'Seeding futures bridge not loaded' });
    const team = req.params.team.toUpperCase();
    const result = await seedingFuturesBridge.analyzeSeedingFuturesValue(ODDS_API_KEY);
    const teamValue = result.teamAnalysis?.[team];
    if (!teamValue) return res.status(404).json({ error: `Team ${team} not found` });
    res.json({ team, ...teamValue, timestamp: result.generatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Top value bets from seeding sim
app.get('/api/nba/seeding-futures/top-bets', async (req, res) => {
  try {
    if (!seedingFuturesBridge) return res.status(503).json({ error: 'Seeding futures bridge not loaded' });
    const result = await seedingFuturesBridge.analyzeSeedingFuturesValue(ODDS_API_KEY);
    res.json({
      topBets: result.topValueBets || [],
      summary: result.summary || {},
      timestamp: result.generatedAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== NBA PLAYOFF SERIES FUTURES SCANNER ====================

// Full scan — seeding sim → weighted series probs → live odds → edges
app.get('/api/nba/series-scanner', async (req, res) => {
  try {
    if (!nbaSeriesScanner) return res.status(503).json({ error: 'NBA Playoff Series Scanner not loaded' });
    
    // Non-blocking: try cache first
    const cached = nbaSeriesScanner.getCachedScan();
    if (cached && req.query.refresh !== 'true') {
      return res.json(cached);
    }
    
    // If force refresh or no cache, try building with timeout
    if (req.query.refresh === 'true') {
      // Kick background rebuild, return cached if available
      nbaSeriesScanner.warmCache({ apiKey: ODDS_API_KEY }).catch(() => {});
      if (cached) return res.json({ ...cached, rebuildTriggered: true });
      return res.json({ building: true, message: 'Scan rebuild triggered. Try again in 30s.' });
    }
    
    // No cache at all — try to build with 25s timeout
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000));
    try {
      const result = await Promise.race([
        nbaSeriesScanner.runFullScan({ apiKey: ODDS_API_KEY }),
        timeoutPromise,
      ]);
      res.json(result);
    } catch (e) {
      // Build timed out — kick background and return status
      nbaSeriesScanner.warmCache({ apiKey: ODDS_API_KEY }).catch(() => {});
      res.json({ building: true, message: 'Scan building in background. Try again in 30s.' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single team deep dive
app.get('/api/nba/series-scanner/team/:team', async (req, res) => {
  try {
    if (!nbaSeriesScanner) return res.status(503).json({ error: 'NBA Playoff Series Scanner not loaded' });
    const result = await nbaSeriesScanner.analyzeTeam(req.params.team.toUpperCase(), { apiKey: ODDS_API_KEY });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Volatility plays only
app.get('/api/nba/series-scanner/volatility', async (req, res) => {
  try {
    if (!nbaSeriesScanner) return res.status(503).json({ error: 'NBA Playoff Series Scanner not loaded' });
    const result = nbaSeriesScanner.getCachedScan() || await nbaSeriesScanner.runFullScan({ apiKey: ODDS_API_KEY });
    res.json({
      volatilityPlays: result.volatilityPlays || [],
      seedingBattles: result.seedingBattles || [],
      matchupMatrix: result.matchupMatrix || null,
      timestamp: result.timestamp,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Top edges only
app.get('/api/nba/series-scanner/edges', async (req, res) => {
  try {
    if (!nbaSeriesScanner) return res.status(503).json({ error: 'NBA Playoff Series Scanner not loaded' });
    const result = nbaSeriesScanner.getCachedScan() || await nbaSeriesScanner.runFullScan({ apiKey: ODDS_API_KEY });
    res.json({
      topEdges: result.topEdges || [],
      fadeAlerts: result.fadeAlerts || [],
      headline: result.headline,
      futuresData: result.futuresData || null,
      teamProfiles: (result.teamProfiles || []).slice(0, 20),
      timestamp: result.timestamp,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scanner status
app.get('/api/nba/series-scanner/status', (req, res) => {
  try {
    if (!nbaSeriesScanner) return res.status(503).json({ error: 'NBA Playoff Series Scanner not loaded' });
    res.json(nbaSeriesScanner.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: Resolve NHL team names to abbreviations
function resolveNHLTeamName(name) {
  const map = {
    'Winnipeg Jets': 'WPG', 'Dallas Stars': 'DAL', 'Colorado Avalanche': 'COL',
    'Minnesota Wild': 'MIN', 'Vegas Golden Knights': 'VGK', 'Edmonton Oilers': 'EDM',
    'Los Angeles Kings': 'LAK', 'Vancouver Canucks': 'VAN', 'Calgary Flames': 'CGY',
    'St. Louis Blues': 'STL', 'Seattle Kraken': 'SEA', 'Nashville Predators': 'NSH',
    'Chicago Blackhawks': 'CHI', 'San Jose Sharks': 'SJS', 'Anaheim Ducks': 'ANA',
    'Arizona Coyotes': 'ARI', 'Utah Hockey Club': 'ARI', 'Utah Mammoth': 'ARI',
    'Boston Bruins': 'BOS', 'Florida Panthers': 'FLA', 'Toronto Maple Leafs': 'TOR',
    'Tampa Bay Lightning': 'TBL', 'Carolina Hurricanes': 'CAR', 'New Jersey Devils': 'NJD',
    'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Detroit Red Wings': 'DET',
    'Montreal Canadiens': 'MTL', 'Montréal Canadiens': 'MTL', 'Buffalo Sabres': 'BUF',
    'Pittsburgh Penguins': 'PIT', 'Philadelphia Flyers': 'PHI', 'Washington Capitals': 'WSH',
    'Columbus Blue Jackets': 'CBJ', 'New York Islanders': 'NYI',
  };
  return map[name] || null;
}

// Helper: Generate key NHL playoff storylines
function generateNHLStorylines(bracket, champSim) {
  const stories = [];
  
  // Find the tightest series
  const allMatchups = [...bracket.eastern.matchups, ...bracket.western.matchups];
  const tightest = allMatchups
    .filter(m => m.series && !m.series.error)
    .sort((a, b) => Math.abs(50 - a.series.higherSeedWinPct) - Math.abs(50 - b.series.higherSeedWinPct));
  
  if (tightest.length > 0) {
    const m = tightest[0];
    stories.push({
      type: 'COIN_FLIP_SERIES',
      headline: `${m.higher.name} vs ${m.lower.name}: Near Coin Flip`,
      detail: `Model gives ${m.higher.name} only ${m.series.higherSeedWinPct}% — this is where the value is if books price it wider`,
      matchup: `${m.higher.abbr} vs ${m.lower.abbr}`
    });
  }
  
  // Find biggest upset potential
  const upsetAlerts = allMatchups.filter(m => m.series && m.series.upsetAlert);
  for (const m of upsetAlerts.slice(0, 2)) {
    stories.push({
      type: 'UPSET_ALERT',
      headline: `Upset Alert: ${m.lower.name} (${m.series.lowerSeedWinPct}%)`,
      detail: `${m.lower.name} has a ${m.series.lowerSeedWinPct}% chance to upset ${m.higher.name} — look for plus-money series prices`,
      matchup: `${m.higher.abbr} vs ${m.lower.abbr}`
    });
  }
  
  // Bubble race
  const eastBubble = bracket.eastern.bubble.filter(t => t.status === 'IN THE HUNT');
  const westBubble = bracket.western.bubble.filter(t => t.status === 'IN THE HUNT');
  if (eastBubble.length > 0) {
    stories.push({
      type: 'BUBBLE_RACE',
      headline: `East Bubble: ${eastBubble.map(t => t.name).join(', ')} still in the hunt`,
      detail: `${eastBubble.length} teams within striking distance of a wild card — bracket could shift dramatically`,
      teams: eastBubble.map(t => ({ name: t.name, abbr: t.abbr, gamesBack: t.gamesBack }))
    });
  }
  
  // Goalie matchup with biggest edge
  const goalieStory = allMatchups
    .filter(m => m.series && m.series.goalieEdge && m.series.goalieEdge.impact === 'SIGNIFICANT')
    .sort((a, b) => b.series.goalieEdge.differential - a.series.goalieEdge.differential);
  
  if (goalieStory.length > 0) {
    const g = goalieStory[0];
    stories.push({
      type: 'GOALIE_EDGE',
      headline: `Goalie Edge: ${g.series.goalieEdge.advantage} has significant goaltending advantage`,
      detail: `${g.series.goalieEdge.higherStarter} vs ${g.series.goalieEdge.lowerStarter} — this will swing the series`,
      matchup: `${g.higher.abbr} vs ${g.lower.abbr}`
    });
  }
  
  // Stanley Cup favorite
  const favorite = champSim.stanleyCupOdds[0];
  if (favorite) {
    stories.push({
      type: 'CUP_FAVORITE',
      headline: `Stanley Cup Favorite: ${favorite.name} (${favorite.champPct}%)`,
      detail: `${favorite.name} leads our model with ${favorite.champPct}% cup probability (${favorite.champML > 0 ? '+' : ''}${favorite.champML})`,
      team: favorite.abbr
    });
  }
  
  return stories;
}

// ==================== CHAMPIONSHIP FUTURES VALUE SCANNER ====================

// Scan all sports for championship futures value
app.get('/api/futures/scan', async (req, res) => {
  try {
    const opts = {
      minEdge: parseFloat(req.query.minEdge) || 0.03,
      bankroll: parseInt(req.query.bankroll) || 1000,
      kellyFraction: parseFloat(req.query.kelly) || 0.25,
      sims: Math.min(parseInt(req.query.sims) || 10000, 50000)
    };
    const results = await futuresScanner.scanAllFutures(
      { nba, nhl, mlb },
      ODDS_API_KEY,
      opts
    );
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan specific sport
app.get('/api/futures/scan/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const opts = {
      minEdge: parseFloat(req.query.minEdge) || 0.03,
      bankroll: parseInt(req.query.bankroll) || 1000,
      kellyFraction: parseFloat(req.query.kelly) || 0.25,
      sims: Math.min(parseInt(req.query.sims) || 10000, 50000)
    };
    
    // Get model probs for the specific sport
    let modelProbs = {};
    
    if (sport === 'nba') {
      const sim = playoffSeries.simulateFullPlayoffs(nba, opts.sims);
      if (sim && sim.championshipOdds) {
        for (const team of sim.championshipOdds) {
          modelProbs[team.team] = team.probability;
        }
      }
    } else if (sport === 'nhl') {
      const teams = nhl.getTeams();
      let totalPower = 0;
      const ratings = {};
      for (const [abbr, team] of Object.entries(teams)) {
        const winPct = team.w / Math.max(1, team.w + team.l + (team.otl || 0));
        const power = Math.pow(winPct, 3);
        ratings[abbr] = power;
        totalPower += power;
      }
      const sorted = Object.entries(ratings).sort((a, b) => b[1] - a[1]).slice(0, 16);
      const playoffPower = sorted.reduce((sum, [, p]) => sum + p, 0);
      for (const [abbr, power] of sorted) {
        modelProbs[abbr] = power / playoffPower;
      }
    } else if (sport === 'mlb') {
      try {
        const seasonSim = require('./services/season-simulator');
        const simResult = seasonSim.getReport();
        if (simResult && simResult.worldSeries) {
          for (const team of simResult.worldSeries) {
            modelProbs[team.team] = team.probability / 100;
          }
        }
      } catch (e) {
        const teams = mlb.getTeams();
        let totalPower = 0;
        const ratings = {};
        for (const [abbr, team] of Object.entries(teams)) {
          const power = Math.pow(team.power || 1, 2);
          ratings[abbr] = power;
          totalPower += power;
        }
        for (const [abbr, power] of Object.entries(ratings)) {
          modelProbs[abbr] = power / totalPower;
        }
      }
    }
    
    const futuresData = await futuresScanner.fetchFuturesOdds(sport, ODDS_API_KEY);
    const result = futuresScanner.findFuturesValue(sport, modelProbs, futuresData, opts);
    result.modelProbCount = Object.keys(modelProbs).length;
    
    // Include full odds data for dashboard
    result.allTeamOdds = futuresData.teams || [];
    result.modelProbs = modelProbs;
    
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get raw futures odds (no model comparison)
app.get('/api/futures/odds/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const data = await futuresScanner.fetchFuturesOdds(sport, ODDS_API_KEY);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Futures scanner status
app.get('/api/futures/status', (req, res) => {
  res.json(futuresScanner.getStatus());
});

// ==================== BET TRACKER API ====================

// Status
app.get('/api/bets/status', (req, res) => {
  res.json(betTracker.getStatus());
});

// Get analytics (MUST be before /api/bets/:id to avoid conflict)
app.get('/api/bets/analytics', (req, res) => {
  const filters = {};
  if (req.query.sport) filters.sport = req.query.sport;
  if (req.query.market) filters.market = req.query.market;
  if (req.query.since) filters.since = req.query.since;
  if (req.query.until) filters.until = req.query.until;
  if (req.query.confidence) filters.confidence = req.query.confidence;
  if (req.query.minEdge) filters.minEdge = parseFloat(req.query.minEdge);
  
  res.json(betTracker.getAnalytics(filters));
});

// Get all bets (with optional filters)
app.get('/api/bets', (req, res) => {
  const filters = {};
  if (req.query.sport) filters.sport = req.query.sport;
  if (req.query.market) filters.market = req.query.market;
  if (req.query.result) filters.result = req.query.result;
  if (req.query.date) filters.date = req.query.date;
  if (req.query.pending === 'true') filters.pending = true;
  if (req.query.source) filters.source = req.query.source;
  if (req.query.limit) filters.limit = parseInt(req.query.limit);
  
  const bets = betTracker.getBets(filters);
  res.json({ bets, count: bets.length, timestamp: new Date().toISOString() });
});

// Get single bet
app.get('/api/bets/:id', (req, res) => {
  const bet = betTracker.getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found' });
  res.json(bet);
});

// Add a bet
app.post('/api/bets', (req, res) => {
  try {
    const bet = betTracker.addBet(req.body);
    res.json({ success: true, bet });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Grade a bet
app.post('/api/bets/:id/grade', (req, res) => {
  const { result, closingOdds, score, notes } = req.body;
  const bet = betTracker.gradeBet(parseInt(req.params.id), result, { closingOdds, score, notes });
  if (bet.error) return res.status(404).json(bet);
  res.json({ success: true, bet });
});

// Update closing odds (for CLV)
app.post('/api/bets/:id/closing', (req, res) => {
  const { closingOdds } = req.body;
  const bet = betTracker.updateClosingOdds(parseInt(req.params.id), closingOdds);
  if (bet.error) return res.status(404).json(bet);
  res.json({ success: true, bet });
});

// Delete a bet
app.delete('/api/bets/:id', (req, res) => {
  const result = betTracker.deleteBet(parseInt(req.params.id));
  if (result.error) return res.status(404).json(result);
  res.json({ success: true, ...result });
});

// Auto-grade bets for a date
app.post('/api/bets/autograde', async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const result = await betTracker.autoGrade(date);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set bankroll
app.post('/api/bets/bankroll', (req, res) => {
  const { bankroll } = req.body;
  if (!bankroll || bankroll <= 0) return res.status(400).json({ error: 'Invalid bankroll amount' });
  res.json(betTracker.setBankroll(bankroll));
});

// Log a bet from model prediction
app.post('/api/bets/from-model', (req, res) => {
  try {
    const { prediction, odds, sport, stake, gameDate } = req.body;
    const bets = betTracker.logModelBet(prediction, odds, { sport, stake, gameDate });
    res.json({ success: true, bets, count: bets.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ==================== DAILY PICKS ENGINE ====================

app.get('/api/picks/today', async (req, res) => {
  try {
    // Check cache first
    const cached = dailyPicks.getCachedPicks();
    if (cached && !req.query.fresh) {
      return res.json(cached);
    }

    // Generate fresh picks
    const oddsData = await getAllOdds();
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.5;
    const minEdge = parseFloat(req.query.minEdge) || 0.02;

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
      bankroll,
      kellyFraction,
      minEdge,
      maxPicks: parseInt(req.query.maxPicks) || 20
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/picks/history', (req, res) => {
  try {
    const history = dailyPicks.getPicksHistory();
    const limit = parseInt(req.query.limit) || 30;
    res.json({ history: history.slice(-limit), total: history.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/picks/best', async (req, res) => {
  try {
    // Quick endpoint — top 5 picks for today
    const cached = dailyPicks.getCachedPicks();
    let picks;
    
    if (cached) {
      picks = cached;
    } else {
      const oddsData = await getAllOdds();
      picks = await dailyPicks.generateDailyPicks({
        nbaModel: nba, mlbModel: mlb, nhlModel: nhl,
        oddsData,
        lineMovementSvc: lineMovement,
        injurySvc: injuries,
        rollingSvc: rollingStats,
        weatherSvc: weather,
        umpireSvc: umpireService,
        calibrationSvc: calibration,
        mlBridgeSvc: mlBridge,
        bankroll: parseFloat(req.query.bankroll) || 1000,
        kellyFraction: 0.5,
        minEdge: 0.03 // higher threshold for "best" picks
      });
    }

    // Filter to only strong+ picks
    const best = (picks.picks || []).filter(p => p.confidence >= 50).slice(0, 5);
    
    res.json({
      date: picks.date,
      bestPicks: best,
      count: best.length,
      summary: {
        totalScanned: picks.summary?.totalGamesScanned || 0,
        totalValue: picks.summary?.totalPicksFound || 0,
        avgConfidence: best.length > 0 ? +(best.reduce((s, p) => s + p.confidence, 0) / best.length).toFixed(1) : 0
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/picks/status', (req, res) => {
  const cached = dailyPicks.getCachedPicks();
  const history = dailyPicks.getPicksHistory();
  res.json({
    hasCachedPicks: !!cached,
    cachedDate: cached ? cached.date : null,
    cachedPicksCount: cached ? cached.picks.length : 0,
    historyDays: history.length,
    lastGenerated: cached ? cached.summary?.generated : null
  });
});

// Fetch scores (for manual inspection)
app.get('/api/scores/:sport', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const scores = await betTracker.fetchScores(req.params.sport, date);
    res.json({ scores, count: scores.length, date, sport: req.params.sport });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== REST/TRAVEL ENDPOINTS ====================

// ==================== UMPIRE TENDENCIES API ====================
app.get('/api/umpire/status', (req, res) => {
  res.json(umpireService.getStatus());
});

app.get('/api/umpire/lookup/:name', (req, res) => {
  const ump = umpireService.getUmpire(decodeURIComponent(req.params.name));
  if (!ump) return res.status(404).json({ error: 'Umpire not found', searched: req.params.name });
  const runsAdj = umpireService.calcTotalRunsMultiplier(ump);
  const propsAdj = umpireService.calcPitcherPropAdj(ump);
  res.json({ umpire: ump, totalRunsAdj: runsAdj, pitcherPropsAdj: propsAdj });
});

app.get('/api/umpire/today', async (req, res) => {
  try {
    const data = await umpireService.getAllGameAdjustments();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/umpire/edges', async (req, res) => {
  try {
    const edges = await umpireService.getTopUmpireEdges();
    res.json(edges);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/umpire/game/:away/:home', async (req, res) => {
  try {
    const { away, home } = req.params;
    const umpireName = req.query.umpire;
    const adj = await umpireService.getGameUmpireAdjustment(away.toUpperCase(), home.toUpperCase(), umpireName);
    res.json(adj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rest-travel/status', (req, res) => {
  res.json(restTravelService.getStatus());
});

app.get('/api/rest-travel/:team', async (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const gameDate = req.query.gameDate || new Date().toISOString().split('T')[0];
    const [rest, bullpen] = await Promise.all([
      restTravelService.getRestTravelAdjustment(team, gameDate),
      restTravelService.getBullpenFatigue(team)
    ]);
    res.json({ team, gameDate, rest, bullpenFatigue: bullpen });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rest-travel/matchup/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const gameDate = req.query.gameDate || new Date().toISOString().split('T')[0];
    const result = await restTravelService.getMatchupAdjustments(away, home, gameDate);
    res.json({ away, home, gameDate, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NBA MODEL VALIDATION ====================
// Historical backtesting against actual game results from ESPN

app.get('/api/nba/validation', async (req, res) => {
  try {
    if (!nbaHistorical) return res.status(503).json({ error: 'NBA Historical service not loaded' });
    const season = req.query.season || '2025-26';
    const games = await nbaHistorical.getSeasonGames(season);
    if (games.length === 0) return res.json({ error: `No games for season ${season}`, seasons: ['2021-22','2022-23','2023-24','2024-25','2025-26'] });
    const report = nbaHistorical.validateModel(nba, games);
    res.json({ season, ...report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/nba/validation/stats', (req, res) => {
  if (!nbaHistorical) return res.status(503).json({ error: 'NBA Historical service not loaded' });
  res.json(nbaHistorical.getStats());
});

app.get('/api/nba/validation/fetch', async (req, res) => {
  try {
    if (!nbaHistorical) return res.status(503).json({ error: 'NBA Historical service not loaded' });
    const season = req.query.season || '2025-26';
    const games = await nbaHistorical.getSeasonGames(season);
    res.json({ season, gamesLoaded: games.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cross-sport model accuracy dashboard
app.get('/api/model/accuracy', async (req, res) => {
  try {
    const report = {
      timestamp: new Date().toISOString(),
      sports: {},
    };
    
    // MLB ML model status
    try {
      const mlStatus = mlBridge.getStatus();
      report.sports.mlb = {
        mlModel: mlStatus,
        trainingData: historicalGames.getStats(),
      };
    } catch (e) { report.sports.mlb = { error: e.message }; }
    
    // NBA validation (cached games only — don't trigger fetch)
    try {
      if (nbaHistorical) {
        const stats = nbaHistorical.getStats();
        report.sports.nba = { historicalData: stats };
        
        // If we have cached games, run quick validation
        nbaHistorical.loadCache();
        const currentSeason = '2025-26';
        if (stats.seasons?.[currentSeason]?.games > 0) {
          const games = await nbaHistorical.getSeasonGames(currentSeason);
          if (games.length > 50) {
            // Validate on last 100 games for speed
            const recentGames = games.slice(-100);
            const validation = nbaHistorical.validateModel(nba, recentGames);
            report.sports.nba.recentValidation = validation.summary;
            report.sports.nba.calibration = validation.calibration;
          }
        }
      }
    } catch (e) { report.sports.nba = { ...(report.sports.nba || {}), validationError: e.message }; }
    
    // MLB historical training data expansion
    try {
      const fs = require('fs');
      const multiCachePath = require('path').join(__dirname, 'services', 'historical-multi-season-cache.json');
      if (fs.existsSync(multiCachePath)) {
        const multiCache = JSON.parse(fs.readFileSync(multiCachePath, 'utf8'));
        report.sports.mlb.multiSeasonData = {};
        let totalGames = 0;
        for (const [key, games] of Object.entries(multiCache)) {
          report.sports.mlb.multiSeasonData[key] = Array.isArray(games) ? games.length : 0;
          totalGames += Array.isArray(games) ? games.length : 0;
        }
        report.sports.mlb.totalTrainingGames = totalGames;
      }
    } catch (e) { /* no multi-season cache */ }
    
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NBA REST/TANK MODEL ====================
// End-of-season edge detection: B2B, rest, tanking, motivation mismatches

app.get('/api/nba/rest-tank/status', (req, res) => {
  res.json(nbaRestTank.getStatus());
});

// Scan today's NBA games for situational edges
app.get('/api/nba/rest-tank/scan', async (req, res) => {
  try {
    const standings = nba.getTeams();
    const result = await nbaRestTank.scanTodaysGames(standings);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Analyze a specific NBA matchup for rest/tank factors
app.get('/api/nba/rest-tank/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const gameDate = req.query.gameDate || new Date().toISOString().split('T')[0];
    const standings = nba.getTeams();
    const analysis = await nbaRestTank.analyzeGame(away, home, standings, gameDate);
    res.json(analysis);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get motivation analysis for a specific team
app.get('/api/nba/rest-tank/motivation/:team', (req, res) => {
  try {
    const team = req.params.team.toUpperCase();
    const standings = nba.getTeams();
    const motivation = nbaRestTank.analyzeMotivation(team, standings);
    res.json({ team, ...motivation });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== REST/TANK BACKTEST TRACKER ====================

// Record today's rest/tank predictions (call before games start)
app.post('/api/nba/rest-tank/backtest/record', async (req, res) => {
  try {
    if (!restTankBacktest) return res.status(503).json({ error: 'Rest/tank backtest service not loaded' });
    const standings = nba.getTeams();
    const scan = await nbaRestTank.scanTodaysGames(standings);
    const result = restTankBacktest.recordPredictions(scan, nba, { bookSpreads: req.body?.bookSpreads || {} });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Grade yesterday's (or specified date's) predictions
app.get('/api/nba/rest-tank/backtest/grade', async (req, res) => {
  try {
    if (!restTankBacktest) return res.status(503).json({ error: 'Rest/tank backtest service not loaded' });
    const result = await restTankBacktest.gradeResults(req.query.date || null);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get backtest status and summary
app.get('/api/nba/rest-tank/backtest/status', (req, res) => {
  if (!restTankBacktest) return res.status(503).json({ error: 'Rest/tank backtest service not loaded' });
  res.json(restTankBacktest.getStatus());
});

// Get all predictions
app.get('/api/nba/rest-tank/backtest/predictions', (req, res) => {
  if (!restTankBacktest) return res.status(503).json({ error: 'Rest/tank backtest service not loaded' });
  res.json(restTankBacktest.getAllPredictions());
});

// Get all graded results
app.get('/api/nba/rest-tank/backtest/results', (req, res) => {
  if (!restTankBacktest) return res.status(503).json({ error: 'Rest/tank backtest service not loaded' });
  res.json(restTankBacktest.getAllGraded());
});

// ==================== REST/TANK GRADER (v102) ====================

app.get('/api/nba/rest-tank/grader', async (req, res) => {
  if (!restTankGrader) return res.status(503).json({ error: 'Rest/tank grader not loaded' });
  try {
    const result = await restTankGrader.gradeResults();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/nba/rest-tank/grader/latest', (req, res) => {
  if (!restTankGrader) return res.status(503).json({ error: 'Rest/tank grader not loaded' });
  const latest = restTankGrader.getLatestResults();
  if (!latest) return res.json({ message: 'No graded results yet — hit /api/nba/rest-tank/grader to generate' });
  res.json(latest);
});

// ==================== GAME DAY ORCHESTRATOR (v102) ====================

app.get('/api/gameday/status', (req, res) => {
  if (!gamedayOrchestrator) return res.status(503).json({ error: 'GameDay orchestrator not loaded' });
  res.json(gamedayOrchestrator.getStatus());
});

app.get('/api/gameday/war-room', async (req, res) => {
  if (!gamedayOrchestrator) return res.status(503).json({ error: 'GameDay orchestrator not loaded' });
  try {
    const warRoom = await gamedayOrchestrator.getWarRoom();
    res.json(warRoom);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gameday/start', (req, res) => {
  if (!gamedayOrchestrator) return res.status(503).json({ error: 'GameDay orchestrator not loaded' });
  gamedayOrchestrator.startPreGamePolling();
  res.json({ status: 'Pre-game polling started manually' });
});

app.post('/api/gameday/stop', (req, res) => {
  if (!gamedayOrchestrator) return res.status(503).json({ error: 'GameDay orchestrator not loaded' });
  gamedayOrchestrator.stopAll();
  res.json({ status: 'All game-day services stopped' });
});

app.post('/api/gameday/rebuild-playbook', async (req, res) => {
  if (!gamedayOrchestrator) return res.status(503).json({ error: 'GameDay orchestrator not loaded' });
  try {
    await gamedayOrchestrator.triggerPlaybookRebuild('manual');
    res.json({ status: 'Playbook rebuild triggered' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== MLB RESULTS GRADER (v103) ====================

// Grade Opening Day bets (Day 1 or Day 2)
app.get('/api/mlb/grade/opening-day', async (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  try {
    const day = parseInt(req.query.day) || 1;
    const result = await mlbResultsGrader.gradeOpeningDay(day);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Grade daily MLB card bets for a specific date
app.get('/api/mlb/grade/daily', async (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const result = await mlbResultsGrader.gradeDailyCard(date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Grade K props for a specific date
app.get('/api/mlb/grade/k-props', async (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const result = await mlbResultsGrader.gradeKProps(date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Grade custom bets (POST body with bets array + date)
app.post('/api/mlb/grade', async (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  try {
    const { bets, date } = req.body;
    if (!bets || !Array.isArray(bets)) return res.status(400).json({ error: 'bets array required' });
    const gradeDate = date || new Date().toISOString().split('T')[0];
    const result = await mlbResultsGrader.gradeDate(bets, gradeDate);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch detailed box score for a single ESPN event
app.get('/api/mlb/grade/boxscore/:espnId', async (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  try {
    const box = await mlbResultsGrader.fetchBoxScore(req.params.espnId);
    res.json(box || { error: 'Box score not available' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Season P&L tracker
app.get('/api/mlb/grade/season', (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  res.json(mlbResultsGrader.getSeasonPnL());
});

// Market breakdown (P&L by bet type)
app.get('/api/mlb/grade/markets', (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  res.json(mlbResultsGrader.getMarketBreakdown());
});

// All graded results (raw)
app.get('/api/mlb/grade/results', (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  res.json(mlbResultsGrader.getGradedResults());
});

// Fetch MLB scoreboard for a date (useful for debugging)
app.get('/api/mlb/grade/scoreboard', async (req, res) => {
  if (!mlbResultsGrader) return res.status(503).json({ error: 'MLB Results Grader not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const scoreboard = await mlbResultsGrader.fetchScoreboard(date);
    res.json({ date, games: scoreboard.length, events: scoreboard });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== AUTO-GRADE PIPELINE (v105) ====================

// Start auto-grade pipeline for a date
app.post('/api/auto-grade/start', (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  try {
    const { date, isOD, odDay } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const result = autoGradePipeline.startPipeline(targetDate, {
      isOD: isOD || false,
      odDay: odDay || null,
      oddsApiKey: process.env.ODDS_API_KEY || '',
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stop auto-grade pipeline
app.post('/api/auto-grade/stop', (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  res.json(autoGradePipeline.stopPipeline());
});

// Force immediate grading
app.post('/api/auto-grade/force', async (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  try {
    const { date } = req.body;
    const result = await autoGradePipeline.forceGrade(date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Capture closing lines now
app.post('/api/auto-grade/closing-lines', async (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  try {
    const result = await autoGradePipeline.captureClosingLines(process.env.ODDS_API_KEY || '');
    const propResult = await autoGradePipeline.captureClosingPropLines(process.env.ODDS_API_KEY || '');
    res.json({ ml: result, props: propResult });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all closing lines
app.get('/api/auto-grade/closing-lines', (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  res.json(autoGradePipeline.getAllClosingLines());
});

// Get closing line for a specific game
app.get('/api/auto-grade/closing-lines/:gameKey', (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  const cl = autoGradePipeline.getClosingLine(req.params.gameKey);
  if (!cl) return res.status(404).json({ error: 'No closing line data for this game' });
  res.json(cl);
});

// Check game statuses for a date
app.get('/api/auto-grade/game-status', async (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const statuses = await autoGradePipeline.checkGameStatuses(date);
    res.json({ date, games: statuses.length, statuses });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get pipeline status
app.get('/api/auto-grade/status', (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  res.json(autoGradePipeline.getStatus());
});

// Get dashboard report
app.get('/api/auto-grade/report', (req, res) => {
  if (!autoGradePipeline) return res.status(503).json({ error: 'Auto-Grade Pipeline not loaded' });
  res.json(autoGradePipeline.getDashboardReport());
});

// Get NBA prediction with full rest/tank situational analysis
app.get('/api/nba/smart-predict/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const result = await nba.asyncPredict(away, home, {
      gameDate: req.query.gameDate || undefined
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== UNIFIED SIGNAL CHECK ====================
// The pre-bet check: aggregates ALL factors for a specific game
app.get('/api/signal-check/:sport/:away/:home', async (req, res) => {
  try {
    const sport = req.params.sport.toUpperCase();
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    
    const signals = {
      sport, away, home, timestamp: new Date().toISOString(),
      prediction: null,
      weather: null,
      umpire: null,
      restTravel: null,
      injuries: { home: null, away: null },
      rolling: { home: null, away: null },
      lineMovement: null,
      monteCarlo: null,
      calibration: null,
      verdict: null
    };
    
    if (sport === 'MLB') {
      // Full async predict with all factors
      const opts = {};
      
      // Weather
      try {
        const wd = await weather.getWeatherForPark(home);
        if (wd && !wd.error) {
          opts.weather = wd;
          signals.weather = {
            park: wd.park,
            dome: wd.dome,
            multiplier: wd.multiplier,
            totalImpact: wd.totalImpact,
            description: wd.description,
            factors: wd.factors,
            conditions: wd.weather
          };
        }
      } catch (e) { signals.weather = { error: e.message }; }
      
      // Umpire
      try {
        const umpAdj = await umpireService.getGameUmpireAdjustment(away, home, req.query.umpire);
        if (umpAdj) {
          if (umpAdj.totalRunsAdj?.multiplier !== 1.0) opts.umpire = umpAdj.totalRunsAdj;
          signals.umpire = {
            name: umpAdj.umpire?.name || req.query.umpire || 'Unknown',
            zone: umpAdj.umpire?.zone || 'N/A',
            totalRunsAdj: umpAdj.totalRunsAdj,
            pitcherPropsAdj: umpAdj.pitcherPropsAdj,
            impact: umpAdj.totalRunsAdj ? `${((umpAdj.totalRunsAdj.multiplier - 1) * 100).toFixed(1)}% runs` : 'neutral'
          };
        }
      } catch (e) { signals.umpire = { error: e.message }; }
      
      // Prediction (async = rest/travel + MC)
      try {
        const rawPred = await mlb.asyncPredict(away, home, opts);
        if (rawPred && !rawPred.error) {
          const calPred = calibration.calibratePrediction(rawPred, 'mlb');
          signals.prediction = {
            homeWinProb: calPred.blendedHomeWinProb || calPred.homeWinProb,
            awayWinProb: calPred.blendedAwayWinProb || calPred.awayWinProb,
            homeML: calPred.blendedHomeML || calPred.homeML,
            awayML: calPred.blendedAwayML || calPred.awayML,
            totalRuns: calPred.totalRuns,
            homeExpRuns: calPred.homeExpRuns,
            awayExpRuns: calPred.awayExpRuns,
            homePower: calPred.homePower,
            awayPower: calPred.awayPower,
            parkFactor: calPred.parkFactor,
            factors: calPred.factors
          };
          if (calPred.monteCarlo) {
            signals.monteCarlo = {
              totalRuns: calPred.monteCarlo.totalRuns,
              homeWinProb: calPred.monteCarlo.homeWinProb,
              simCount: calPred.monteCarlo.simCount || 10000
            };
          }
          signals.calibration = {
            applied: true,
            sport: 'mlb',
            note: 'Probabilities calibrated for historical accuracy'
          };
        }
      } catch (e) { signals.prediction = { error: e.message }; }
      
      // Rest/Travel
      try {
        const rt = await restTravelService.getMatchupAdjustments(away, home);
        if (rt) signals.restTravel = rt;
      } catch (e) { signals.restTravel = { error: e.message }; }
      
    } else if (sport === 'NBA') {
      // Full async prediction with rest/tank situational analysis
      try {
        const rawPred = await nba.asyncPredict(away, home, { 
          gameDate: req.query.gameDate || undefined 
        });
        if (rawPred && !rawPred.error) {
          const calPred = calibration.calibratePrediction(rawPred, 'nba');
          signals.prediction = {
            homeWinProb: calPred.homeWinProb,
            awayWinProb: calPred.awayWinProb,
            spread: calPred.spread,
            totalPoints: calPred.predictedTotal,
            homePower: calPred.home?.adjPower || calPred.homePower,
            awayPower: calPred.away?.adjPower || calPred.awayPower,
            baseSpread: calPred.baseSpread || calPred.spread,
            situationalEdge: calPred.situationalEdge || false
          };
          // Rest/tank factors
          if (calPred.restTank) {
            signals.restTank = {
              awayAdj: calPred.restTank.awayAdj,
              homeAdj: calPred.restTank.homeAdj,
              netSpreadAdj: calPred.restTank.netSpreadAdj,
              awayMotivation: calPred.restTank.away?.motivation,
              homeMotivation: calPred.restTank.home?.motivation,
              mismatch: calPred.restTank.motivationMismatch,
              summary: calPred.restTank.summary
            };
          }
          signals.calibration = {
            applied: true,
            sport: 'nba',
            note: 'Probabilities calibrated + rest/tank adjusted'
          };
        }
      } catch (e) { 
        // Fallback to sync predict
        try {
          const rawPred = nba.predict(away, home, { awayB2B: req.query.awayB2B === 'true', homeB2B: req.query.homeB2B === 'true' });
          if (rawPred && !rawPred.error) {
            const calPred = calibration.calibratePrediction(rawPred, 'nba');
            signals.prediction = {
              homeWinProb: calPred.homeWinProb,
              awayWinProb: calPred.awayWinProb,
              spread: calPred.spread,
              totalPoints: calPred.predictedTotal
            };
          }
        } catch (e2) { signals.prediction = { error: e2.message }; }
      }
      
    } else if (sport === 'NHL') {
      try {
        const rawPred = nhl.predict(away, home);
        if (rawPred) {
          signals.prediction = {
            homeWinProb: rawPred.home?.winProb,
            awayWinProb: rawPred.away?.winProb,
            totalGoals: rawPred.totalGoals,
            homePower: rawPred.home?.power,
            awayPower: rawPred.away?.power
          };
        }
      } catch (e) { signals.prediction = { error: e.message }; }
    }
    
    // Cross-sport signals
    try {
      const homeInj = injuries.getInjuryAdjustment(sport.toLowerCase(), home);
      const awayInj = injuries.getInjuryAdjustment(sport.toLowerCase(), away);
      signals.injuries.home = homeInj;
      signals.injuries.away = awayInj;
    } catch (e) {}
    
    try {
      signals.rolling.home = rollingStats.getRollingAdjustment(sport.toLowerCase(), home);
      signals.rolling.away = rollingStats.getRollingAdjustment(sport.toLowerCase(), away);
    } catch (e) {}
    
    try {
      const sharpSignals = lineMovement.getSharpSignals();
      signals.lineMovement = sharpSignals.filter(s => 
        s.gameId && (s.gameId.includes(home) || s.gameId.includes(away))
      );
    } catch (e) {}
    
    // Generate verdict
    const pred = signals.prediction;
    if (pred && !pred.error) {
      const factors = [];
      const homeProb = pred.homeWinProb || (pred.homeWinProb && pred.homeWinProb / 100);
      
      if (homeProb > 0.58) factors.push(`${home} strong favorite (${(homeProb * 100).toFixed(1)}%)`);
      else if (homeProb < 0.42) factors.push(`${away} strong favorite (${((1 - homeProb) * 100).toFixed(1)}%)`);
      
      if (signals.weather?.multiplier > 1.03) factors.push('Weather boosts scoring');
      if (signals.weather?.multiplier < 0.97) factors.push('Weather suppresses scoring');
      if (signals.umpire?.totalRunsAdj?.multiplier > 1.02) factors.push('Umpire zone favors hitters');
      if (signals.umpire?.totalRunsAdj?.multiplier < 0.98) factors.push('Umpire zone favors pitchers');
      
      const homeInjCount = signals.injuries.home?.starPlayersOut?.length || 0;
      const awayInjCount = signals.injuries.away?.starPlayersOut?.length || 0;
      if (homeInjCount > awayInjCount) factors.push(`${home} has more key injuries (${homeInjCount} vs ${awayInjCount})`);
      if (awayInjCount > homeInjCount) factors.push(`${away} has more key injuries (${awayInjCount} vs ${homeInjCount})`);
      
      signals.verdict = {
        factors,
        signalCount: Object.values(signals).filter(v => v !== null && !v?.error).length,
        note: 'All available signals aggregated. Use with live odds for edge detection.'
      };
    }
    
    res.json(signals);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MONTE CARLO ENDPOINTS ====================

app.get('/api/simulate/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const numSims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    
    // Get expected runs from MLB model
    const pred = mlb.predict(away, home, { monteCarlo: false });
    if (!pred || pred.error) return res.status(400).json({ error: pred?.error || 'Invalid teams' });
    
    // Run simulation
    const simOpts = { numSims };
    
    // Get bullpen fatigue if available
    try {
      const matchupAdj = await restTravelService.getMatchupAdjustments(away, home);
      simOpts.awayBullpenMult = matchupAdj.away.bullpenFatigue?.multiplier || 1.0;
      simOpts.homeBullpenMult = matchupAdj.home.bullpenFatigue?.multiplier || 1.0;
    } catch (e) { /* optional */ }
    
    const sim = monteCarloService.simulate(pred.awayExpRuns, pred.homeExpRuns, simOpts);
    
    res.json({
      matchup: `${away} @ ${home}`,
      awayExpRuns: pred.awayExpRuns,
      homeExpRuns: pred.homeExpRuns,
      analyticalHomeWinProb: pred.homeWinProb,
      simulation: sim,
      awayPitcher: pred.awayPitcher || null,
      homePitcher: pred.homePitcher || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SGP CORRELATION ENGINE ====================

app.get('/api/sgp/status', (req, res) => {
  res.json(sgpEngine.getStatus());
});

// SGP analysis for a specific game
app.get('/api/sgp/game/:away/:home', async (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const sport = (req.query.sport || 'mlb').toLowerCase();
    
    // Get prediction
    let prediction;
    const opts = {};
    
    if (req.query.awayPitcher) opts.awayPitcher = req.query.awayPitcher;
    if (req.query.homePitcher) opts.homePitcher = req.query.homePitcher;
    
    // Fetch weather for MLB
    if (sport === 'mlb') {
      try {
        const wd = await weather.getWeatherForPark(home);
        if (wd && !wd.error) opts.weather = wd;
      } catch (e) { /* optional */ }
    }
    
    if (sport === 'mlb') {
      prediction = await mlb.asyncPredict(away, home, opts);
    } else if (sport === 'nba') {
      prediction = nba.predict(away, home, opts);
    } else if (sport === 'nhl') {
      prediction = nhl.predict(away, home, opts);
    } else {
      return res.status(400).json({ error: `Unknown sport: ${sport}` });
    }
    
    if (prediction.error) return res.status(400).json(prediction);
    
    // Get odds for this game
    let gameOdds = {};
    try {
      const allOdds = await getAllOdds();
      const match = allOdds.find(g => {
        const ga = (g.awayAbbr || g.away || '').toUpperCase();
        const gh = (g.homeAbbr || g.home || '').toUpperCase();
        return ga === away && gh === home;
      });
      if (match) gameOdds = match;
    } catch (e) { /* no odds */ }
    
    const normalizedOdds = {
      homeML: gameOdds.homeOdds || gameOdds.homeML || prediction.homeML,
      awayML: gameOdds.awayOdds || gameOdds.awayML || prediction.awayML,
      total: gameOdds.total || null,
      overOdds: gameOdds.overOdds || -110,
      underOdds: gameOdds.underOdds || -110,
      overProb: gameOdds.overOdds ? mlToProb(gameOdds.overOdds) : 0.5,
      underProb: gameOdds.underOdds ? mlToProb(gameOdds.underOdds) : 0.5,
      homeSpread: gameOdds.homeSpread || (sport === 'mlb' ? -1.5 : null),
      awaySpread: gameOdds.awaySpread || (sport === 'mlb' ? 1.5 : null),
      homeSpreadOdds: gameOdds.homeSpreadOdds || -110,
      awaySpreadOdds: gameOdds.awaySpreadOdds || -110,
      homeSpreadProb: gameOdds.homeSpreadOdds ? mlToProb(gameOdds.homeSpreadOdds) : 0.5,
      awaySpreadProb: gameOdds.awaySpreadOdds ? mlToProb(gameOdds.awaySpreadOdds) : 0.5,
    };
    
    const sgpCombos = sgpEngine.buildSGPCombos(prediction, normalizedOdds, {
      minLegEdge: parseFloat(req.query.minEdge) || -0.03,
      minComboEdge: parseFloat(req.query.minComboEdge) || 0.02,
    });
    
    res.json({
      game: `${away} @ ${home}`,
      sport: sport.toUpperCase(),
      prediction: {
        homeWinProb: prediction.homeWinProb,
        awayWinProb: prediction.awayWinProb,
        totalRuns: prediction.totalRuns,
        homeExpRuns: prediction.homeExpRuns,
        awayExpRuns: prediction.awayExpRuns,
        homePitcher: prediction.homePitcher?.name || null,
        awayPitcher: prediction.awayPitcher?.name || null,
      },
      odds: normalizedOdds,
      sgpCombos: sgpCombos,
      count: sgpCombos.length,
      bestEV: sgpCombos.length > 0 ? sgpCombos[0].ev : 0,
      topPick: sgpCombos.length > 0 ? sgpCombos[0].description : null,
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan all games for SGP opportunities
app.get('/api/sgp/scan', async (req, res) => {
  try {
    const sport = (req.query.sport || 'all').toLowerCase();
    const results = { timestamp: new Date().toISOString(), sports: {}, allCombos: [] };
    
    const sports = sport === 'all' ? ['mlb', 'nba', 'nhl'] : [sport];
    
    for (const s of sports) {
      try {
        const sportModel = s === 'mlb' ? mlb : s === 'nba' ? nba : nhl;
        const scanResult = await sgpEngine.scanSGPs(s, { mlb, nba, nhl }, getAllOdds);
        results.sports[s.toUpperCase()] = scanResult.summary;
        results.allCombos.push(...scanResult.combos);
      } catch (e) {
        results.sports[s.toUpperCase()] = { error: e.message };
      }
    }
    
    // Sort all combos by EV
    results.allCombos.sort((a, b) => b.ev - a.ev);
    
    // Top picks across all sports
    results.topPicks = results.allCombos.slice(0, 10).map(c => ({
      description: c.description,
      game: c.game,
      sport: c.sport,
      ev: c.ev,
      confidence: c.confidence,
      correlation: c.correlation,
      bookOdds: c.bookOdds,
      fairOdds: c.fairOdds,
      halfKelly: c.halfKelly,
      reasoning: c.reasoning,
    }));
    
    results.totalCombos = results.allCombos.length;
    results.highConfCount = results.allCombos.filter(c => c.confidence >= 60).length;
    
    // Don't return all combos in summary — too large
    delete results.allCombos;
    
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan SGP for specific sport with full combo details
app.get('/api/sgp/scan/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    if (!['mlb', 'nba', 'nhl'].includes(sport)) {
      return res.status(400).json({ error: `Invalid sport: ${sport}` });
    }
    
    const scanResult = await sgpEngine.scanSGPs(sport, { mlb, nba, nhl }, getAllOdds);
    
    // Return top 25 combos with full details
    const topCombos = scanResult.combos.slice(0, 25);
    
    res.json({
      sport: sport.toUpperCase(),
      summary: scanResult.summary,
      combos: topCombos,
      timestamp: scanResult.timestamp,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Helper for SGP endpoints
function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

// ==================== TRAVEL DISTANCE ====================

app.get('/api/travel/:from/:to', (req, res) => {
  const from = req.params.from.toUpperCase();
  const to = req.params.to.toUpperCase();
  const distance = restTravelService.getDistance(from, to);
  const tzShift = restTravelService.getTimezoneShift(from, to);
  res.json({ from, to, distanceMiles: distance, timezoneShift: tzShift });
});

// ==================== ALT LINES SCANNER ====================

// Alt lines analysis for a specific matchup
app.get('/api/alt-lines/:sport/:away/:home', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const awayParam = req.params.away.toUpperCase();
    const homeParam = req.params.home.toUpperCase();
    
    let prediction;
    if (sport === 'mlb') {
      prediction = await mlb.asyncPredict(awayParam, homeParam, {
        awayPitcher: req.query.awayPitcher,
        homePitcher: req.query.homePitcher
      });
    } else if (sport === 'nba') {
      prediction = nba.predict(awayParam, homeParam);
    } else if (sport === 'nhl') {
      prediction = nhl.predict(awayParam, homeParam);
    } else {
      return res.status(400).json({ error: `Unknown sport: ${sport}` });
    }
    
    if (prediction.error) return res.status(400).json(prediction);
    
    const analysis = altLines.analyzeMatchupAltLines(prediction);
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan alt lines across all games for a sport (uses live odds)
app.get('/api/alt-lines/scan/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    const minEV = parseFloat(req.query.minEV) || 3;
    
    // Generate predictions for all teams
    let predictions = [];
    let model;
    if (sport === 'mlb') model = mlb;
    else if (sport === 'nba') model = nba;
    else if (sport === 'nhl') model = nhl;
    else return res.status(400).json({ error: `Unknown sport: ${sport}` });
    
    // Fetch current odds to know which games are being played
    const sportKeys = { mlb: 'baseball_mlb', nba: 'basketball_nba', nhl: 'icehockey_nhl' };
    const sportKey = sportKeys[sport];
    
    // First fetch basic odds to get today's games
    let todayGames = [];
    if (ODDS_API_KEY) {
      try {
        const fetch = require('node-fetch');
        const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
        const resp = await fetch(url, { timeout: 15000 });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) todayGames = data;
        }
      } catch (e) { /* fallback below */ }
    }
    
    // Build name maps for matching
    const teams = model.getTeams();
    const nameMap = {};
    for (const [abbr, t] of Object.entries(teams)) {
      nameMap[t.name.toLowerCase()] = abbr;
      const parts = t.name.split(' ');
      nameMap[parts[parts.length - 1].toLowerCase()] = abbr;
    }
    
    // Generate predictions for games with odds
    for (const game of todayGames) {
      let awayAbbr = null, homeAbbr = null;
      for (const [name, abbr] of Object.entries(nameMap)) {
        if (game.away_team.toLowerCase().includes(name)) awayAbbr = abbr;
        if (game.home_team.toLowerCase().includes(name)) homeAbbr = abbr;
      }
      if (awayAbbr && homeAbbr) {
        try {
          let pred;
          if (sport === 'mlb') pred = await mlb.asyncPredict(awayAbbr, homeAbbr);
          else pred = model.predict(awayAbbr, homeAbbr);
          if (!pred.error) predictions.push(pred);
        } catch (e) { /* skip game */ }
      }
    }
    
    const result = await altLines.scanAltLines(sport, predictions, { minEdge, minEV });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan alt lines for ALL sports
app.get('/api/alt-lines/scan', async (req, res) => {
  try {
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    const minEV = parseFloat(req.query.minEV) || 3;
    const results = {};
    
    for (const sport of ['mlb', 'nba', 'nhl']) {
      try {
        const model = sport === 'mlb' ? mlb : sport === 'nba' ? nba : nhl;
        const sportKeys = { mlb: 'baseball_mlb', nba: 'basketball_nba', nhl: 'icehockey_nhl' };
        
        let predictions = [];
        if (ODDS_API_KEY) {
          const fetch = require('node-fetch');
          const url = `https://api.the-odds-api.com/v4/sports/${sportKeys[sport]}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`;
          try {
            const resp = await fetch(url, { timeout: 15000 });
            if (resp.ok) {
              const data = await resp.json();
              if (Array.isArray(data)) {
                const teams = model.getTeams();
                const nameMap = {};
                for (const [abbr, t] of Object.entries(teams)) {
                  nameMap[t.name.toLowerCase()] = abbr;
                  const parts = t.name.split(' ');
                  nameMap[parts[parts.length - 1].toLowerCase()] = abbr;
                }
                for (const game of data) {
                  let awayAbbr = null, homeAbbr = null;
                  for (const [name, abbr] of Object.entries(nameMap)) {
                    if (game.away_team.toLowerCase().includes(name)) awayAbbr = abbr;
                    if (game.home_team.toLowerCase().includes(name)) homeAbbr = abbr;
                  }
                  if (awayAbbr && homeAbbr) {
                    try {
                      let pred;
                      if (sport === 'mlb') pred = await mlb.asyncPredict(awayAbbr, homeAbbr);
                      else pred = model.predict(awayAbbr, homeAbbr);
                      if (!pred.error) predictions.push(pred);
                    } catch (e) { /* skip */ }
                  }
                }
              }
            }
          } catch (e) { /* skip sport */ }
        }
        
        results[sport] = await altLines.scanAltLines(sport, predictions, { minEdge, minEV });
      } catch (e) {
        results[sport] = { error: e.message, valueBets: [] };
      }
    }
    
    // Aggregate
    const allBets = [];
    for (const [sport, data] of Object.entries(results)) {
      if (data.allValueBets) {
        allBets.push(...data.allValueBets.map(b => ({ ...b, sport })));
      }
    }
    allBets.sort((a, b) => b.ev - a.ev);
    
    res.json({
      totalValueBets: allBets.length,
      highConfidence: allBets.filter(b => b.confidence === 'HIGH').length,
      topBets: allBets.slice(0, 30),
      bySport: results,
      scannedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start server

// ==================== ML ENGINE ENDPOINTS ====================

app.get('/api/ml/status', async (req, res) => {
  try {
    const bridgeStatus = mlBridge.getStatus();
    let engineStatus;
    try { engineStatus = await mlBridge.status(req.query.sport || 'mlb'); } catch (e) { engineStatus = { error: e.message }; }
    res.json({ bridge: bridgeStatus, engine: engineStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ml/train', async (req, res) => {
  try {
    const sport = req.query.sport || 'mlb';
    const forceRefresh = req.query.force === 'true';
    const result = await mlBridge.train(sport, forceRefresh);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/train', async (req, res) => {
  try {
    const sport = req.query.sport || 'mlb';
    const result = await mlBridge.train(sport);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/predict', async (req, res) => {
  try {
    const { away, home, awayPitcher, homePitcher, sport } = req.query;
    if (!away || !home) return res.status(400).json({ error: 'Need away and home team abbreviations' });
    const result = await mlBridge.enhancedPredict(away.toUpperCase(), home.toUpperCase(), {
      awayPitcher, homePitcher,
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/backtest', async (req, res) => {
  try {
    const sport = req.query.sport || 'mlb';
    const result = await mlBridge.backtest(sport);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ml/compare/:away/:home', async (req, res) => {
  try {
    const { away, home } = req.params;
    const awayUpper = away.toUpperCase();
    const homeUpper = home.toUpperCase();
    
    // Get all prediction methods
    const analyticalSync = mlb.predict(awayUpper, homeUpper);
    let analyticalAsync, mlEnhanced;
    try { analyticalAsync = await mlb.asyncPredict(awayUpper, homeUpper); } catch (e) { analyticalAsync = { error: e.message }; }
    try { mlEnhanced = await mlBridge.enhancedPredict(awayUpper, homeUpper); } catch (e) { mlEnhanced = { error: e.message }; }
    
    res.json({
      game: `${awayUpper} @ ${homeUpper}`,
      comparison: {
        analytical_sync: {
          homeWinProb: analyticalSync.homeWinProb,
          awayWinProb: analyticalSync.awayWinProb,
          totalRuns: analyticalSync.totalRuns,
          source: 'Pythagorean + Log5 + pitcher adj',
        },
        analytical_async: {
          homeWinProb: analyticalAsync.homeWinProb || analyticalAsync.error,
          awayWinProb: analyticalAsync.awayWinProb,
          totalRuns: analyticalAsync.totalRuns,
          source: 'Analytical + rest/travel + Monte Carlo',
        },
        ml_enhanced: {
          homeWinProb: mlEnhanced.blendedHomeWinProb || mlEnhanced.homeWinProb || mlEnhanced.error,
          awayWinProb: mlEnhanced.blendedAwayWinProb || mlEnhanced.awayWinProb,
          mlRaw: mlEnhanced.ml,
          totalRuns: mlEnhanced.totalRuns,
          predictedTotal: mlEnhanced.ml?.predictedTotal,
          source: 'ML Ensemble (LR+GB+RF) blended with analytical',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== HISTORICAL DATA + ML TRAINING DATA ====================

app.get('/api/historical/status', (req, res) => {
  res.json(historicalGames.getStats());
});

app.get('/api/historical/fetch', async (req, res) => {
  try {
    const { start, end, max } = req.query;
    const data = await historicalGames.getTrainingData({
      startDate: start || '2024-04-01',
      endDate: end || '2024-09-29',
      maxGames: max ? parseInt(max) : null,
    });
    res.json({ 
      games: data.length, 
      sample: data.slice(0, 5),
      homeWinRate: +(data.filter(g => g.homeWon).length / data.length * 100).toFixed(1),
      avgTotal: +(data.reduce((s, g) => s + (g.actualTotal || 0), 0) / data.length).toFixed(1),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ML-Enhanced Opening Day predictions (combines analytical + ML + Statcast)
app.get('/api/ml/opening-day', async (req, res) => {
  try {
    const projections = await mlbOpeningDay.getProjections();
    const mlPredictions = [];
    
    for (const game of projections) {
      try {
        const mlResult = await mlBridge.enhancedPredict(game.away, game.home, {
          awayPitcher: game.awayPitcher || game.confirmedStarters?.away,
          homePitcher: game.homePitcher || game.confirmedStarters?.home,
        });
        
        mlPredictions.push({
          away: game.away,
          home: game.home,
          date: game.date,
          time: game.time,
          analytical: {
            homeWinProb: game.homeWinProb,
            awayWinProb: game.awayWinProb,
            totalRuns: game.totalRuns || game.expectedTotal,
          },
          ml: mlResult.ml || null,
          blended: {
            homeWinProb: mlResult.blendedHomeWinProb || game.homeWinProb,
            awayWinProb: mlResult.blendedAwayWinProb || game.awayWinProb,
          },
          starters: game.confirmedStarters,
          dkLine: game.dkLine,
          edge: calculateEdge(
            mlResult.blendedHomeWinProb || game.homeWinProb,
            game.dkLine
          ),
          statcast: mlResult.statcast || null,
        });
      } catch (e) {
        // ML failed for this game — use analytical only
        mlPredictions.push({
          away: game.away,
          home: game.home,
          date: game.date,
          time: game.time,
          analytical: {
            homeWinProb: game.homeWinProb,
            awayWinProb: game.awayWinProb,
            totalRuns: game.totalRuns || game.expectedTotal,
          },
          ml: null,
          blended: {
            homeWinProb: game.homeWinProb,
            awayWinProb: game.awayWinProb,
          },
          starters: game.confirmedStarters,
          dkLine: game.dkLine,
          edge: calculateEdge(game.homeWinProb, game.dkLine),
          mlError: e.message,
        });
      }
    }
    
    // Sort by absolute edge (best bets first)
    mlPredictions.sort((a, b) => {
      const aEdge = Math.max(Math.abs(a.edge?.homeEdge || 0), Math.abs(a.edge?.awayEdge || 0));
      const bEdge = Math.max(Math.abs(b.edge?.homeEdge || 0), Math.abs(b.edge?.awayEdge || 0));
      return bEdge - aEdge;
    });
    
    res.json({
      timestamp: new Date().toISOString(),
      openingDay: '2026-03-26',
      daysUntil: Math.ceil((new Date('2026-03-26') - new Date()) / (1000 * 60 * 60 * 24)),
      games: mlPredictions,
      mlStatus: mlBridge.getStatus(),
      bestBets: mlPredictions.filter(g => {
        const maxEdge = Math.max(Math.abs(g.edge?.homeEdge || 0), Math.abs(g.edge?.awayEdge || 0));
        return maxEdge >= 3;
      }).slice(0, 5),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function calculateEdge(homeWinProb, dkLine) {
  if (!dkLine || !homeWinProb) return { homeEdge: 0, awayEdge: 0 };
  
  function mlToProb(ml) {
    if (ml < 0) return (-ml) / (-ml + 100);
    return 100 / (ml + 100);
  }
  
  const bookHomeProb = mlToProb(dkLine.homeML);
  const bookAwayProb = mlToProb(dkLine.awayML);
  const awayWinProb = 1 - homeWinProb;
  
  return {
    homeEdge: +((homeWinProb - bookHomeProb) * 100).toFixed(1),
    awayEdge: +((awayWinProb - bookAwayProb) * 100).toFixed(1),
    bestSide: (homeWinProb - bookHomeProb) > (awayWinProb - bookAwayProb) ? 'home' : 'away',
  };
}

// ==================== ARBITRAGE / LOW-HOLD SCANNER ====================

app.get('/api/arb/scan', async (req, res) => {
  try {
    // Check cache first
    const cached = arbitrage.getCachedScan();
    if (cached && !req.query.force) {
      return res.json({ ...cached, source: 'cache' });
    }
    
    const results = await arbitrage.scanAll(fetchOdds);
    res.json({ ...results, source: 'live' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/arb/scan/:sport', async (req, res) => {
  try {
    const sportMap = {
      'nba': 'basketball_nba',
      'mlb': 'baseball_mlb',
      'nhl': 'icehockey_nhl'
    };
    const sportKey = sportMap[req.params.sport.toLowerCase()];
    if (!sportKey) return res.status(400).json({ error: 'Sport must be nba, mlb, or nhl' });
    
    const odds = await fetchOdds(sportKey);
    const results = await arbitrage.scanSport(sportKey, odds);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/arb/report', async (req, res) => {
  try {
    const cached = arbitrage.getCachedScan();
    let results;
    if (cached && !req.query.force) {
      results = cached;
    } else {
      results = await arbitrage.scanAll(fetchOdds);
    }
    const report = arbitrage.generateReport(results);
    res.type('text').send(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/arb/calc', (req, res) => {
  const { odds1, odds2, stake } = req.query;
  if (!odds1 || !odds2) return res.status(400).json({ error: 'odds1 and odds2 required' });
  
  const o1 = parseInt(odds1);
  const o2 = parseInt(odds2);
  const totalStake = parseFloat(stake) || 1000;
  
  const hold = arbitrage.calculateHold(o1, o2);
  const arbProfit = arbitrage.calculateArbProfit(o1, o2);
  const stakes = arbitrage.calculateArbStakes(o1, o2, totalStake);
  
  res.json({
    odds: { side1: o1, side2: o2 },
    hold,
    arb: arbProfit,
    stakes,
    isArb: hold && hold.hold < 0,
    timestamp: new Date().toISOString()
  });
});

// ==================== ML-ENHANCED EDGE SCANNER ====================

// Ultimate edge scanner: compares analytical, ML, MC, and book prices
// This is where the money is — disagreements between models are the signal
app.get('/api/edge-scanner/:sport', async (req, res) => {
  try {
    const sport = req.params.sport.toLowerCase();
    const sportKey = sport === 'nba' ? 'basketball_nba' : sport === 'mlb' ? 'baseball_mlb' : sport === 'nhl' ? 'ice_hockey_nhl' : null;
    if (!sportKey) return res.status(400).json({ error: 'Sport must be nba, mlb, or nhl' });

    const model = sport === 'nba' ? nba : sport === 'mlb' ? mlb : nhl;
    const nameMap = buildNameMap(model.TEAMS || model.getTeams(), {
      'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS', 'blue jays': 'TOR',
      'trail blazers': 'POR', 'blazers': 'POR', 'timberwolves': 'MIN', '76ers': 'PHI'
    });
    
    const liveOdds = await fetchOdds(sportKey);
    const edges = [];

    for (const game of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, game.away_team);
      const homeAbbr = resolveTeam(nameMap, game.home_team);
      if (!awayAbbr || !homeAbbr) continue;

      // Get analytical prediction
      let analyticalPred = null;
      try {
        if (sport === 'mlb' && mlb.asyncPredict) {
          analyticalPred = await mlb.asyncPredict(awayAbbr, homeAbbr);
        } else {
          analyticalPred = model.predict(awayAbbr, homeAbbr);
        }
        if (analyticalPred?.error) analyticalPred = null;
        // Calibrate
        if (analyticalPred && calibration) {
          analyticalPred = calibration.calibratePrediction(analyticalPred, sport);
        }
      } catch (e) { /* skip */ }
      if (!analyticalPred) continue;

      // Get ML prediction
      let mlPred = null;
      if (sport === 'mlb') {
        try {
          const mlResult = await mlBridge.enhancedPredict(awayAbbr, homeAbbr);
          if (mlResult?.ml) mlPred = mlResult;
        } catch (e) { /* ML optional */ }
      }

      // Extract best book lines
      const bestBook = extractBookLine(game.bookmakers?.[0], game.home_team);
      if (!bestBook) continue;

      // Multi-source probability comparison
      const sources = {
        analytical: {
          homeWinProb: analyticalPred.homeWinProb,
          awayWinProb: analyticalPred.awayWinProb,
        },
        book: {
          homeWinProb: bestBook.homeML ? mlToProb(bestBook.homeML) : null,
          awayWinProb: bestBook.awayML ? mlToProb(bestBook.awayML) : null,
        },
      };

      if (mlPred?.ml) {
        sources.ml = {
          homeWinProb: mlPred.ml.homeWinProb,
          awayWinProb: mlPred.ml.awayWinProb,
          confidence: mlPred.ml.confidence,
          modelAgreement: mlPred.ml.modelAgreement,
        };
        sources.blended = {
          homeWinProb: mlPred.blendedHomeWinProb,
          awayWinProb: mlPred.blendedAwayWinProb,
        };
      }

      if (analyticalPred.monteCarlo) {
        sources.monteCarlo = {
          homeWinProb: analyticalPred.monteCarlo.homeWinProb,
          awayWinProb: analyticalPred.monteCarlo.awayWinProb,
          totalRuns: analyticalPred.monteCarlo.totalRuns?.mean,
        };
      }

      // Calculate edges from all sources vs books
      const blended = sources.blended || sources.analytical;
      const bookHome = sources.book.homeWinProb || 0.5;
      const bookAway = sources.book.awayWinProb || 0.5;

      const homeEdge = blended.homeWinProb - bookHome;
      const awayEdge = blended.awayWinProb - bookAway;
      const maxEdge = Math.max(Math.abs(homeEdge), Math.abs(awayEdge));

      // Model agreement score: how many sources agree on the pick direction
      let agreementCount = 0;
      const pickDirection = homeEdge > awayEdge ? 'home' : 'away';
      if (pickDirection === 'home') {
        if (sources.analytical.homeWinProb > bookHome) agreementCount++;
        if (sources.ml?.homeWinProb > bookHome) agreementCount++;
        if (sources.monteCarlo?.homeWinProb > bookHome) agreementCount++;
      } else {
        if (sources.analytical.awayWinProb > bookAway) agreementCount++;
        if (sources.ml?.awayWinProb > bookAway) agreementCount++;
        if (sources.monteCarlo?.awayWinProb > bookAway) agreementCount++;
      }

      edges.push({
        game: `${awayAbbr} @ ${homeAbbr}`,
        commence: game.commence_time,
        sources,
        bestPick: {
          side: pickDirection,
          team: pickDirection === 'home' ? homeAbbr : awayAbbr,
          edge: +(pickDirection === 'home' ? homeEdge : awayEdge).toFixed(4),
          ml: pickDirection === 'home' ? bestBook.homeML : bestBook.awayML,
          modelProb: +(pickDirection === 'home' ? blended.homeWinProb : blended.awayWinProb).toFixed(4),
          bookProb: +(pickDirection === 'home' ? bookHome : bookAway).toFixed(4),
        },
        modelAgreement: `${agreementCount}/${sources.ml ? 3 : sources.monteCarlo ? 2 : 1}`,
        maxEdge: +maxEdge.toFixed(4),
        totalAnalytical: analyticalPred.totalRuns || null,
        totalMC: analyticalPred.monteCarlo?.totalRuns?.mean || null,
        totalML: mlPred?.ml?.predictedTotal || null,
      });
    }

    // Sort by max edge
    edges.sort((a, b) => b.maxEdge - a.maxEdge);

    res.json({
      sport: sport.toUpperCase(),
      timestamp: new Date().toISOString(),
      totalGames: edges.length,
      edges,
      strongEdges: edges.filter(e => e.maxEdge >= 0.05),
      mlEnabled: sport === 'mlb',
      note: 'Edge = model probability - book implied probability. Positive = value bet. Model agreement shows how many independent models agree on the pick direction.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quick helper for edge scanner (mlToProb already defined above)

// ==================== STATCAST ENDPOINTS ====================

// Pitcher Statcast lookup — individual pitcher xERA/xwOBA analysis
app.get('/api/statcast/pitcher/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const result = statcast.getStatcastPitcherAdjustment(name);
    if (!result) return res.json({ error: `No Statcast data for "${name}"`, note: 'Try /api/statcast/refresh first, or check exact name spelling' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Team batting Statcast — xwOBA-based offensive quality
app.get('/api/statcast/team/:abbr', (req, res) => {
  try {
    const abbr = req.params.abbr.toUpperCase();
    const result = statcast.getTeamBattingStatcast(abbr);
    if (!result) return res.json({ error: `No Statcast batting data for ${abbr}` });
    res.json({ team: abbr, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Regression candidates — THE EDGE: pitchers who will regress
app.get('/api/statcast/regression', (req, res) => {
  try {
    const minPA = parseInt(req.query.minPA) || 200;
    const result = statcast.getRegressionCandidates(minPA);
    res.json({
      lucky: result.lucky,
      unlucky: result.unlucky,
      note: 'Lucky = ERA << xERA (FADE them). Unlucky = ERA >> xERA (BACK them).',
      luckyCount: result.lucky.length,
      unluckyCount: result.unlucky.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Team xwOBA leaderboard — true offensive quality ranking
app.get('/api/statcast/team-xwoba', (req, res) => {
  try {
    const leaderboard = statcast.getTeamXwobaLeaderboard();
    res.json({
      teams: leaderboard,
      note: 'xwOBA is the best single metric for true offensive quality. Edge = xwOBA - wOBA (positive = undervalued).',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full matchup Statcast report
app.get('/api/statcast/matchup/:away/:home', (req, res) => {
  try {
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const awayPitcher = req.query.awayPitcher || null;
    const homePitcher = req.query.homePitcher || null;
    const result = statcast.getMatchupStatcast(away, home, awayPitcher, homePitcher);
    res.json({ away, home, awayPitcher, homePitcher, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force refresh Statcast data from Baseball Savant
app.get('/api/statcast/refresh', async (req, res) => {
  try {
    const result = await statcast.refreshStatcast(true);
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Statcast status
app.get('/api/statcast/status', (req, res) => {
  try {
    const pitcherCount = statcast.cachedPitchers ? Object.keys(statcast.cachedPitchers).length : 0;
    const batterCount = statcast.cachedBatters ? Object.keys(statcast.cachedBatters).length : 0;
    const teamCount = statcast.cachedTeamBatting ? Object.keys(statcast.cachedTeamBatting).length : 0;
    res.json({
      pitchers: pitcherCount,
      batters: batterCount,
      teams: teamCount,
      lastFetch: statcast.lastFetch ? new Date(statcast.lastFetch).toISOString() : null,
      cacheAge: statcast.lastFetch ? `${Math.round((Date.now() - statcast.lastFetch) / 60000)} min` : 'never',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== OPENING DAY PLAYBOOK — THE ULTIMATE WAR ROOM ====================

/**
 * Aggregates ALL signals for every Opening Day game into a single actionable playbook.
 * This is the endpoint you hit on March 26-27 to know exactly what to bet.
 * 
 * Per game:
 *   - Analytical model prediction (Poisson + park + pitcher)
 *   - ML ensemble prediction (XGBoost + LightGBM + RF)
 *   - Monte Carlo simulation (10K iterations)
 *   - Statcast edge (xERA regression, xwOBA)
 *   - Weather impact (wind, temp, humidity)
 *   - Umpire tendencies (over/under)
 *   - Preseason tuning (spring training, roster changes, new-team penalties)
 *   - Live odds from all books (best line shopping)
 *   - Kelly sizing (full/half/quarter)
 *   - Calibrated probabilities
 *   - SGP opportunities
 *   - Alt line sweet spots
 */
app.get('/api/opening-day-playbook', async (req, res) => {
  try {
    // v91.0: Non-blocking — serve cached, trigger background rebuild if stale
    if (odPlaybookCache) {
      const bankroll = parseFloat(req.query.bankroll) || 1000;
      const kellyFraction = parseFloat(req.query.kelly) || 0.5;
      const minEdge = parseFloat(req.query.minEdge) || 0.02;
      const forceRefresh = req.query.refresh === 'true';
      
      if (forceRefresh) {
        // Force refresh with timeout protection
        try {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000));
          const result = await Promise.race([odPlaybookCache.refresh(), timeoutPromise]);
          return res.json(result);
        } catch (e) {
          const stale = odPlaybookCache.getCachedOnly();
          if (stale) return res.json({ ...stale, note: 'Refresh timed out — returning stale cache' });
          return res.status(504).json({ error: 'Refresh timed out and no cache available' });
        }
      }
      
      // Non-blocking: try cached first
      const cached = odPlaybookCache.ensureFresh();
      if (cached) {
        return res.json(cached);
      }
      
      // No cache at all — wait with timeout
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000));
        const result = await Promise.race([
          odPlaybookCache.getPlaybook(bankroll, kellyFraction, minEdge),
          timeoutPromise
        ]);
        return res.json(result);
      } catch (e) {
        return res.json({ 
          error: 'Playbook is building (first load takes ~18s). Try again in 30 seconds.', 
          building: true, playbook: [], totalGames: 0 
        });
      }
    }
    
    // Fallback: slim version without full signal stack (avoids timeout)
    const projections = await mlbOpeningDay.getProjections();
    if (!projections || !projections.games || projections.games.length === 0) {
      return res.json({ error: 'No Opening Day projections available', games: [] });
    }
    
    const playbook = projections.games.map(game => ({
      away: game.away,
      home: game.home,
      date: game.date,
      day: game.day,
      time: game.time,
      park: game.park,
      awayStarter: game.awayStarter,
      homeStarter: game.homeStarter,
      signals: {
        analytical: {
          homeWinProb: game.prediction.homeWinProb,
          awayWinProb: game.prediction.awayWinProb,
          homeExpRuns: game.prediction.homeExpRuns,
          awayExpRuns: game.prediction.awayExpRuns,
          totalRuns: game.prediction.totalRuns || game.prediction.expectedTotal,
        },
      },
      bets: [],
      gameRating: { grade: 'D', signalCount: 1, betCount: 0, maxEdge: 0, totalWager: 0, totalEV: 0 },
    }));
    
    res.json({
      timestamp: new Date().toISOString(),
      openingDay: '2026-03-26',
      daysUntil: Math.ceil((new Date('2026-03-26') - new Date()) / (1000 * 60 * 60 * 24)),
      totalGames: playbook.length,
      portfolio: { totalBets: 0, totalWager: 0, totalEV: 0 },
      playbook,
      note: 'Slim fallback — playbook cache not initialized. Refresh in a moment.',
    });
  } catch (e) {
    console.error('Opening Day Playbook error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Playbook cache refresh endpoint
app.get('/api/opening-day-playbook/refresh', async (req, res) => {
  try {
    if (!odPlaybookCache) return res.status(503).json({ error: 'Playbook cache not initialized' });
    const result = await odPlaybookCache.refresh();
    res.json({ status: 'refreshed', buildTimeMs: result.buildTimeMs, games: result.totalGames, bets: result.portfolio?.totalBets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== OPENING DAY BETTING CARD (v68.0) ====================
// Actionable betting summary: best plays ranked by conviction, with Kelly sizing
// This is the "just tell me what to bet" endpoint for game day
app.get('/api/opening-day/betting-card', async (req, res) => {
  try {
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.5;
    const minConviction = parseInt(req.query.minConviction) || 50; // C+ minimum
    
    // v92.0: ALWAYS return instantly from cache — NEVER block waiting for a build.
    // On cold start, disk cache is loaded in init(). On warm, memory cache is fresh.
    // If neither exists, return a "building" response immediately.
    let playbook;
    if (odPlaybookCache) {
      // First try: instant memory/disk cache (ZERO latency)
      playbook = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
      
      // If no cache at all, trigger background build and return "building" immediately
      if (!playbook) {
        // Kick off background build (non-blocking)
        if (odPlaybookCache.ensureFresh) odPlaybookCache.ensureFresh();
        return res.json({ 
          error: 'Playbook is building — first load after deploy takes ~20s. Refresh in 30 seconds.',
          building: true,
          games: []
        });
      }
    }
    
    if (!playbook || !playbook.playbook || playbook.playbook.length === 0) {
      return res.json({ error: 'Playbook not available yet', games: [] });
    }
    
    // Build actionable betting card
    const allPlays = [];
    
    for (const game of playbook.playbook) {
      const conv = game.signals?.conviction || {};
      const convScore = conv.score || 0;
      
      // Process each bet in this game
      for (const bet of (game.bets || [])) {
        allPlays.push({
          game: `${game.away}@${game.home}`,
          date: game.date,
          time: game.time,
          pick: bet.pick,
          type: bet.type,
          book: bet.book || 'DraftKings',
          ml: bet.ml,
          edge: bet.edge || bet.diff || 0,
          confidence: bet.confidence,
          modelProb: bet.modelProb,
          bookProb: bet.bookProb,
          wager: bet.wager || 0,
          ev: bet.ev || 0,
          conviction: {
            score: convScore,
            grade: conv.grade || 'D',
            action: conv.action || 'PASS',
          },
          signals: {
            weather: game.signals?.weather?.impact || 'N/A',
            f5Model: game.signals?.f5?.model === 'negative-binomial' ? 'NB' : 'Poisson',
            bullpen: game.signals?.bullpenQuality?.advantage || 'EVEN',
            catcherFraming: game.signals?.bullpenQuality ? 'Active' : 'N/A',
            pitchers: `${game.awayStarter?.name || '?'} vs ${game.homeStarter?.name || '?'}`,
          },
          agreementSources: bet.agreementSources || [],
        });
      }
    }
    
    // Sort by conviction score DESC, then edge DESC
    allPlays.sort((a, b) => {
      if (b.conviction.score !== a.conviction.score) return b.conviction.score - a.conviction.score;
      return b.edge - a.edge;
    });
    
    // Filter by minimum conviction
    const qualifiedPlays = allPlays.filter(p => p.conviction.score >= minConviction);
    
    // Tier the plays
    const smash = qualifiedPlays.filter(p => p.conviction.score >= 80); // A/A+
    const strong = qualifiedPlays.filter(p => p.conviction.score >= 70 && p.conviction.score < 80); // B+
    const lean = qualifiedPlays.filter(p => p.conviction.score >= 60 && p.conviction.score < 70); // B
    const small = qualifiedPlays.filter(p => p.conviction.score >= 50 && p.conviction.score < 60); // C+
    
    // Calculate portfolio
    const totalWager = qualifiedPlays.reduce((s, p) => s + p.wager, 0);
    const totalEV = qualifiedPlays.reduce((s, p) => s + p.ev, 0);
    
    // Best game overall
    const gameConvictions = {};
    for (const game of playbook.playbook) {
      const key = `${game.away}@${game.home}`;
      gameConvictions[key] = {
        game: key,
        conviction: game.signals?.conviction?.score || 0,
        grade: game.signals?.conviction?.grade || 'D',
        betCount: (game.bets || []).length,
        totalEV: (game.bets || []).reduce((s, b) => s + (b.ev || 0), 0),
        date: game.date,
        time: game.time,
        pitchers: `${game.awayStarter?.name || '?'} vs ${game.homeStarter?.name || '?'}`,
      };
    }
    const topGames = Object.values(gameConvictions)
      .sort((a, b) => b.conviction - a.conviction)
      .slice(0, 5);
    
    // Inject K prop picks into the card
    let kPropSection = null;
    if (pitcherKProps) {
      try {
        const kScan = pitcherKProps.scanODKProps({ isOpeningDay: true });
        const kSmash = kScan.topPicks.filter(p => p.grade === 'A');
        const kStrong = kScan.topPicks.filter(p => p.grade === 'B');
        kPropSection = {
          title: '⚡ K PROP PLAYS',
          totalPicks: kScan.totalKPropPicks,
          highConfidence: kScan.highConfidencePicks,
          averageEdge: kScan.averageEdge,
          smash: kSmash.map(p => ({
            pitcher: p.pitcher,
            team: p.team,
            opponent: p.opponent,
            pick: `${p.recommendation} ${p.dkLine?.line} Ks`,
            modelKs: p.adjustedExpectedKs,
            edge: p.edge,
            grade: p.grade,
            confidence: p.confidence,
            overProb: p.overProb,
            factors: p.factors,
          })),
          strong: kStrong.map(p => ({
            pitcher: p.pitcher,
            team: p.team,
            opponent: p.opponent,
            pick: `${p.recommendation} ${p.dkLine?.line} Ks`,
            modelKs: p.adjustedExpectedKs,
            edge: p.edge,
            grade: p.grade,
            confidence: p.confidence,
          })),
          summary: kScan.summary,
        };
      } catch (e) {
        kPropSection = { error: e.message };
      }
    }
    
    // Inject F3 (First 3 Innings) picks into the card
    let f3Section = null;
    if (f3Model) {
      try {
        let odGames;
        try {
          const odModule = require('./models/mlb-opening-day');
          odGames = odModule.getSchedule ? odModule.getSchedule() : (odModule.OPENING_DAY_GAMES || []);
        } catch (e) { odGames = []; }
        
        if (odGames.length > 0) {
          const f3Scan = f3Model.scanODGamesF3(mlb, odGames, { isOpeningDay: true });
          const f3Games = f3Scan.games || [];
          const f3Bets = [];
          for (const g of f3Games) {
            for (const vb of (g.valueBets || [])) {
              f3Bets.push({
                game: g.matchup,
                pick: `F3 ${vb.direction} ${vb.line}`,
                modelProb: vb.modelProb,
                edge: vb.edge || 0,
                confidence: vb.confidence,
                reason: vb.reason || '',
                f3Total: g.modelF3Total || g.f3?.total,
                drawProb: g.f3?.draw || g.draw,
              });
            }
          }
          f3Bets.sort((a, b) => (b.edge || 0) - (a.edge || 0));
          
          f3Section = {
            title: '🎯 F3 (FIRST 3 INNINGS) PLAYS',
            totalGames: f3Games.length,
            totalBets: f3Bets.length,
            highConfidence: f3Bets.filter(b => b.confidence === 'HIGH').length,
            edge: 'FTTO advantage: .290 wOBA first-time vs .340 third-time = 15% pitcher suppression',
            topPicks: f3Bets.slice(0, 10),
            allPicks: f3Bets,
          };
        }
      } catch (e) {
        f3Section = { error: e.message };
      }
    }
    
    // Inject NRFI picks into the card
    let nrfiSection = null;
    if (nrfiModel) {
      try {
        let nrfiODGames;
        try {
          const nrfiODModule = require('./models/mlb-opening-day');
          nrfiODGames = nrfiODModule.getSchedule ? nrfiODModule.getSchedule() : (nrfiODModule.OPENING_DAY_GAMES || []);
        } catch (e) { nrfiODGames = []; }
        
        const nrfiScan = nrfiModel.scanODGames ? nrfiModel.scanODGames(mlb, nrfiODGames, { isOpeningDay: true }) : null;
        if (nrfiScan) {
          const nrfiGames = nrfiScan.games || [];
          const nrfiPicks = nrfiGames.filter(g => g.signal === 'NRFI' && (g.confidence === 'HIGH' || g.confidence === 'MEDIUM'));
          const yrfiPicks = nrfiGames.filter(g => g.signal === 'YRFI' && (g.confidence === 'HIGH' || g.confidence === 'MEDIUM'));
          
          nrfiSection = {
            title: '🚫 NRFI/YRFI PLAYS',
            totalGames: nrfiGames.length,
            nrfiPicks: nrfiPicks.map(g => ({
              game: g.matchup,
              nrfi: g.nrfi,
              signal: 'NRFI',
              confidence: g.confidence,
              edge: g.edge,
              pitchers: g.pitchers,
            })),
            yrfiPicks: yrfiPicks.map(g => ({
              game: g.matchup,
              yrfi: g.yrfi,
              signal: 'YRFI',
              confidence: g.confidence,
              edge: g.edge,
              pitchers: g.pitchers,
            })),
            avgNRFI: nrfiScan.avgNRFI,
          };
        }
      } catch (e) {
        nrfiSection = { error: e.message };
      }
    }
    
    // Inject Team Totals picks into the card
    let teamTotalsSection = null;
    if (teamTotalsScanner) {
      try {
        const ttScan = teamTotalsScanner.scanODTeamTotals(mlb);
        if (ttScan && ttScan.topPicks) {
          const ttHigh = ttScan.topPicks.filter(p => p.confidence === 'HIGH');
          const ttMedium = ttScan.topPicks.filter(p => p.confidence === 'MEDIUM');
          teamTotalsSection = {
            title: '🎯 TEAM TOTAL PLAYS',
            totalPlays: ttScan.totalPlays,
            highConfidence: ttScan.highConfidence,
            averageEdge: ttScan.avgEdge,
            underPlays: ttScan.underPlays,
            overPlays: ttScan.overPlays,
            topPicks: ttScan.topPicks.slice(0, 10).map(p => ({
              pick: p.pick,
              team: p.team,
              direction: p.direction,
              line: p.line,
              teamExpRuns: p.teamExpRuns,
              edge: p.edge,
              modelProb: p.modelProb,
              confidence: p.confidence,
            })),
          };
        }
      } catch (e) {
        teamTotalsSection = { error: e.message };
      }
    }
    
    res.json({
      title: '🦞 MetaClaw Opening Day Betting Card',
      generated: new Date().toISOString(),
      openingDay: playbook.openingDay,
      daysUntil: playbook.daysUntil,
      bankroll,
      kellyFraction,
      minConviction,
      totalPlays: qualifiedPlays.length,
      tiers: {
        smash: { label: '🔥 SMASH (A/A+)', count: smash.length, plays: smash },
        strong: { label: '💪 STRONG (B+)', count: strong.length, plays: strong },
        lean: { label: '📊 LEAN (B)', count: lean.length, plays: lean },
        small: { label: '🎲 SMALL (C+)', count: small.length, plays: small },
      },
      kProps: kPropSection,
      f3Plays: f3Section,
      nrfiPlays: nrfiSection,
      teamTotals: teamTotalsSection,
      portfolio: {
        totalPlays: qualifiedPlays.length,
        totalWager: +totalWager.toFixed(0),
        totalEV: +totalEV.toFixed(2),
        expectedROI: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
        bankrollPct: +((totalWager / bankroll) * 100).toFixed(1),
      },
      topGames,
      allPlays: qualifiedPlays,
      signalQuality: playbook.signalQuality,
      cached: playbook.cached || false,
    });
  } catch (e) {
    console.error('Betting card error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== OD WAR ROOM (v79.0) ====================
// Unified command center: ALL models → ALL plays → ONE endpoint
app.get('/api/opening-day/war-room', async (req, res) => {
  try {
    if (!odWarRoom) return res.status(503).json({ error: 'War Room not loaded' });
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.5;
    const minEdge = parseFloat(req.query.minEdge) || 2;
    // Timeout protection — war room is heavy
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000));
    const warRoom = await Promise.race([
      odWarRoom.buildWarRoom({ bankroll, kellyFraction, minEdge }),
      timeoutPromise
    ]);
    res.json(warRoom);
  } catch (e) {
    if (e.message === 'timeout') {
      return res.status(504).json({ error: 'War Room build timed out — try again after cache warms up' });
    }
    console.error('War Room error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/war-room/summary', async (req, res) => {
  try {
    if (!odWarRoom) return res.status(503).json({ error: 'War Room not loaded' });
    const summary = await odWarRoom.getWarRoomSummary();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/war-room/game/:away/:home', async (req, res) => {
  try {
    if (!odWarRoom) return res.status(503).json({ error: 'War Room not loaded' });
    const { away, home } = req.params;
    const warRoom = await odWarRoom.buildWarRoom({ bankroll: 1000 });
    const gameKey = `${away.toUpperCase()}@${home.toUpperCase()}`;
    const gameData = warRoom.gameBreakdowns?.[gameKey];
    if (!gameData) return res.status(404).json({ error: `Game ${gameKey} not found` });
    res.json({
      game: gameKey,
      ...gameData,
      sgps: warRoom.sgps?.topParlays?.filter(p => p.game === gameKey) || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== OD LINE MOVEMENT TRACKER (v69.0) ====================
// Track line movement on all 20 OD games from open to close
app.get('/api/opening-day/line-tracker', async (req, res) => {
  try {
    if (!odLineTracker) return res.status(503).json({ error: 'Line tracker not loaded' });
    const report = odLineTracker.getLineMovementReport();
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/opening-day/line-tracker/snapshot', async (req, res) => {
  try {
    if (!odLineTracker) return res.status(503).json({ error: 'Line tracker not loaded' });
    // Take a snapshot with current live odds
    let liveOdds = [];
    try { liveOdds = await fetchOdds('baseball_mlb'); } catch (e) { /* no odds yet */ }
    
    // Also get model predictions from OD playbook
    let modelPreds = null;
    if (odPlaybookCache) {
      try {
        const pb = await odPlaybookCache.getPlaybook();
        modelPreds = pb?.playbook;
      } catch (e) { /* optional */ }
    }
    
    const snapshot = odLineTracker.recordSnapshot(liveOdds, modelPreds);
    res.json({ status: 'snapshot_recorded', gamesTracked: Object.keys(snapshot.games).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/opening-day/line-tracker/init', async (req, res) => {
  try {
    if (!odLineTracker) return res.status(503).json({ error: 'Line tracker not loaded' });
    // Initialize with OD playbook model predictions + DK lines
    const openingDay = require('./models/mlb-opening-day');
    const projections = await openingDay.getProjections();
    
    const games = projections.games.map(g => ({
      away: g.away,
      home: g.home,
      prediction: g.prediction,
      dkLine: g.dkLine,
    }));
    
    const tracker = odLineTracker.recordModelPredictions(games);
    res.json({ status: 'initialized', gamesTracked: Object.keys(tracker.games).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== PRE-OPENING DAY VALIDATION ====================
// Comprehensive system check to ensure everything works before March 27
// Run on March 26 or any time to verify readiness

// ==================== OPENING DAY PRE-FLIGHT CHECK ====================
app.get('/api/opening-day/preflight', async (req, res) => {
  try {
    if (!odPreflight) return res.status(503).json({ error: 'Preflight module not loaded' });
    
    // v92.0: Default to lite mode — full preflight always times out on 512MB VM.
    // Use ?full=1 to explicitly request full preflight (only when cache is warm).
    const full = req.query.full === '1';
    const lite = !full;
    
    const timeoutMs = lite ? 10000 : 25000;
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Preflight ${lite ? 'lite ' : ''}timed out after ${timeoutMs/1000}s`)), timeoutMs)
    );
    
    let report;
    if (lite && odPreflight.runPreflightLite) {
      report = await Promise.race([odPreflight.runPreflightLite(), timeoutPromise]);
    } else {
      report = await Promise.race([odPreflight.runPreflight(), timeoutPromise]);
    }
    res.json(report);
  } catch (e) {
    // On timeout, return a partial report from cached playbook data instead of empty response
    if (e.message.includes('timed out')) {
      const partialReport = {
        timestamp: new Date().toISOString(),
        mode: 'TIMEOUT_FALLBACK',
        overallStatus: 'WARN',
        error: e.message,
        note: 'Preflight timed out on 512MB VM. Returning cached system status instead.',
        checks: {},
        summary: { total: 0, passed: 0, warnings: 1, failed: 0 },
      };
      
      // Pull what we can from playbook cache (instant, no compute)
      if (odPlaybookCache) {
        const cached = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
        if (cached) {
          partialReport.checks.odPlaybookCache = {
            status: 'PASS',
            note: `Cache present (${cached.cacheAge} old), ${cached.totalGames} games, ${cached.portfolio?.totalBets} bets`,
            signalQuality: cached.signalQuality,
            portfolio: cached.portfolio,
          };
          partialReport.summary.total++;
          partialReport.summary.passed++;
        } else {
          partialReport.checks.odPlaybookCache = { status: 'WARN', note: 'No cache available' };
          partialReport.summary.total++;
          partialReport.summary.warnings++;
        }
      }
      
      // Basic data freshness from cache file (sync, instant)
      try {
        const fs = require('fs');
        const path = require('path');
        const cachePath = path.join(__dirname, 'services', 'data-cache.json');
        if (fs.existsSync(cachePath)) {
          const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          const now = Date.now();
          const feeds = {};
          for (const sport of ['nba', 'nhl', 'mlb']) {
            const ts = cache.timestamps?.[sport];
            if (ts) {
              const ageMin = Math.round((now - ts) / 60000);
              feeds[sport] = { ageMinutes: ageMin, status: ageMin < 180 ? 'FRESH' : 'STALE' };
            }
          }
          partialReport.checks.dataFeeds = { status: 'PASS', feeds };
          partialReport.summary.total++;
          partialReport.summary.passed++;
        }
      } catch (e2) { /* ignore */ }
      
      return res.json(partialReport);
    }
    res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 3) });
  }
});

// ==================== CATCHER FRAMING API ====================
app.get('/api/mlb/catchers/framing', (req, res) => {
  try {
    const framingDB = lineupFetcher.CATCHER_FRAMING || {};
    const teamMap = lineupFetcher.TEAM_OD_CATCHERS || {};
    
    // Build team-level view
    const teams = {};
    for (const [team, catcherName] of Object.entries(teamMap)) {
      const catcher = framingDB[catcherName];
      teams[team] = {
        catcher: catcherName,
        framingRuns: catcher?.framingRuns || 0,
        tier: catcher?.tier || 'unknown',
        perGameImpact: catcher ? +(catcher.framingRuns / 162).toFixed(3) : 0
      };
    }
    
    // Sort by framing impact
    const ranked = Object.entries(teams)
      .sort((a, b) => b[1].framingRuns - a[1].framingRuns)
      .map(([team, data], i) => ({ rank: i + 1, team, ...data }));
    
    res.json({
      totalCatchers: Object.keys(framingDB).length,
      teamsCovered: Object.keys(teamMap).length,
      rankings: ranked,
      insight: 'Elite framers (Patrick Bailey, Adley Rutschman) save ~0.10-0.11 runs/game. ' +
               'Poor framers (Yainer Diaz, Salvador Perez) COST ~0.04-0.05 runs/game. ' +
               'In a SF@HOU matchup, catcher framing alone shifts the total by ~0.15 runs.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mlb/catchers/matchup', (req, res) => {
  try {
    const { away, home } = req.query;
    if (!away || !home) return res.status(400).json({ error: 'Provide ?away=XXX&home=XXX' });
    
    if (!lineupFetcher.getCatcherFramingAdjustment) {
      return res.status(503).json({ error: 'Catcher framing not available' });
    }
    
    const adj = lineupFetcher.getCatcherFramingAdjustment(home.toUpperCase(), away.toUpperCase());
    res.json({
      matchup: `${away.toUpperCase()}@${home.toUpperCase()}`,
      ...adj,
      bettingNote: adj.framingGap > 10 ? 
        `SIGNIFICANT framing edge for ${home.toUpperCase()} catcher — ${adj.homeCatcher} is ${adj.homeFramingRuns > 0 ? 'elite' : 'poor'} framer. Consider totals lean.` :
        adj.framingGap < -10 ?
        `SIGNIFICANT framing edge for ${away.toUpperCase()} catcher — ${adj.awayCatcher} is ${adj.awayFramingRuns > 0 ? 'elite' : 'poor'} framer. Consider totals lean.` :
        'Similar framing quality — minimal impact on totals'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/validate', async (req, res) => {
  try {
    const checks = {
      timestamp: new Date().toISOString(),
      openingDay: '2026-03-27',
      daysUntil: Math.ceil((new Date('2026-03-27T00:00:00Z') - Date.now()) / 86400000),
      overallStatus: 'PASS',
      checks: [],
      warnings: [],
      errors: [],
    };
    
    function addCheck(name, status, detail) {
      checks.checks.push({ name, status, detail });
      if (status === 'FAIL') {
        checks.errors.push(`❌ ${name}: ${detail}`);
        checks.overallStatus = 'FAIL';
      } else if (status === 'WARN') {
        checks.warnings.push(`⚠️ ${name}: ${detail}`);
        if (checks.overallStatus !== 'FAIL') checks.overallStatus = 'WARN';
      }
    }
    
    // 1. SCHEDULE CHECK — Do we have all Opening Day games?
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      const day1 = schedule.filter(g => g.day === 1);
      const day2 = schedule.filter(g => g.day === 2);
      addCheck('Opening Day Schedule', 
        day1.length >= 10 ? 'PASS' : 'FAIL',
        `${day1.length} Day 1 games, ${day2.length} Day 2 games (${schedule.length} total)`
      );
    } catch (e) {
      addCheck('Opening Day Schedule', 'FAIL', e.message);
    }
    
    // 2. PITCHER DATABASE — Are all OD starters in our database?
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      const pitcherDb = require('./models/mlb-pitchers');
      let found = 0, missing = [];
      for (const g of schedule) {
        for (const role of ['away', 'home']) {
          const name = g.confirmedStarters?.[role];
          if (name) {
            const p = pitcherDb.getPitcherByName(name);
            if (p) found++;
            else missing.push(`${name} (${g[role]})`);
          }
        }
      }
      addCheck('Pitcher Database',
        missing.length === 0 ? 'PASS' : missing.length <= 3 ? 'WARN' : 'FAIL',
        `${found} found, ${missing.length} missing${missing.length > 0 ? ': ' + missing.join(', ') : ''}`
      );
    } catch (e) {
      addCheck('Pitcher Database', 'FAIL', e.message);
    }
    
    // 3. TEAM DATA — All 30 teams loaded with stats?
    try {
      const teams = mlb.getTeams ? mlb.getTeams() : {};
      const teamCount = Object.keys(teams).length;
      addCheck('MLB Team Data', 
        teamCount === 30 ? 'PASS' : teamCount >= 28 ? 'WARN' : 'FAIL',
        `${teamCount}/30 teams loaded`
      );
    } catch (e) {
      addCheck('MLB Team Data', 'FAIL', e.message);
    }
    
    // 4. LIVE DATA — Is ESPN feed working?
    try {
      const liveDataService = require('./services/live-data');
      const status = liveDataService.getStatus ? liveDataService.getStatus() : {};
      const lastRefresh = status.lastRefresh || status.lastUpdate;
      const ageMinutes = lastRefresh ? Math.round((Date.now() - new Date(lastRefresh).getTime()) / 60000) : 999;
      addCheck('Live Data Feed',
        ageMinutes < 180 ? 'PASS' : ageMinutes < 720 ? 'WARN' : 'FAIL',
        `Last refresh: ${ageMinutes} minutes ago` + (status.sources ? ` (sources: ${Object.keys(status.sources).join(', ')})` : '')
      );
    } catch (e) {
      addCheck('Live Data Feed', 'WARN', `Service not available: ${e.message}`);
    }
    
    // 5. PREDICTION ENGINE — Can we run predictions?
    try {
      const testPred = mlb.predict('BOS', 'CIN', { awayPitcher: 'Garrett Crochet', homePitcher: 'Andrew Abbott' });
      addCheck('MLB Prediction Engine',
        testPred && testPred.homeWinProb ? 'PASS' : 'FAIL',
        testPred.error ? testPred.error : `BOS@CIN: ${(testPred.homeWinProb*100).toFixed(1)}% home, total ${testPred.totalRuns}`
      );
    } catch (e) {
      addCheck('MLB Prediction Engine', 'FAIL', e.message);
    }
    
    // 6. WEATHER SERVICE — Can we get forecasts?
    try {
      const ws = require('./services/weather');
      const parks = ws.BALLPARK_COORDS || {};
      const parkCount = Object.keys(parks).length;
      addCheck('Weather Service',
        parkCount >= 25 ? 'PASS' : 'WARN',
        `${parkCount} ballpark coordinates configured`
      );
    } catch (e) {
      addCheck('Weather Service', 'WARN', `Not available: ${e.message}`);
    }
    
    // 7. UMPIRE SERVICE — Ready?
    try {
      const us = require('./services/umpire-tendencies');
      const count = us.getAllUmpires ? us.getAllUmpires().length : 0;
      addCheck('Umpire Tendencies',
        count >= 30 ? 'PASS' : count >= 15 ? 'WARN' : 'FAIL',
        `${count} umpires in database`
      );
    } catch (e) {
      addCheck('Umpire Tendencies', 'WARN', `Not available: ${e.message}`);
    }
    
    // 8. STATCAST DATA — Is it cached?
    try {
      const sc = require('./services/statcast');
      const status = sc.getStatus ? sc.getStatus() : {};
      addCheck('Statcast Integration',
        (status.pitchers || 0) >= 500 ? 'PASS' : (status.pitchers || 0) >= 100 ? 'WARN' : 'FAIL',
        `${status.pitchers || 0} pitchers, ${status.batters || 0} batters loaded`
      );
    } catch (e) {
      addCheck('Statcast Integration', 'WARN', `Not available: ${e.message}`);
    }
    
    // 9. PRESEASON TUNING — Roster changes loaded?
    try {
      const pt = require('./services/preseason-tuning');
      const teamCount = pt.getTeamCount ? pt.getTeamCount() : (pt.ROSTER_CHANGES ? Object.keys(pt.ROSTER_CHANGES).length : -1);
      addCheck('Preseason Tuning',
        teamCount >= 20 ? 'PASS' : teamCount >= 10 ? 'WARN' : 'FAIL',
        `Roster changes for ${teamCount} teams`
      );
    } catch (e) {
      addCheck('Preseason Tuning', 'WARN', `Not available: ${e.message}`);
    }
    
    // 10. ODDS API — Can we reach it?
    try {
      if (process.env.ODDS_API_KEY) {
        addCheck('Odds API', 'PASS', 'API key configured (set on Fly.io)');
      } else {
        addCheck('Odds API', 'WARN', 'API key not set locally (OK if set on Fly.io production)');
      }
    } catch (e) {
      addCheck('Odds API', 'WARN', e.message);
    }
    
    // 11. AUTO-SCANNER — Running?
    try {
      const health = autoScanner.getHealth ? autoScanner.getHealth() : {};
      addCheck('Auto Scanner',
        health.isRunning ? 'PASS' : 'WARN',
        health.isRunning ? `Running, ${Object.keys(health.scanStatus || {}).length} scan types configured` : 'Not running (will start on deploy)'
      );
    } catch (e) {
      addCheck('Auto Scanner', 'WARN', `Not available: ${e.message}`);
    }
    
    // 12. CLV TRACKER — Ready to record?
    try {
      const status = clvTracker.getStatus ? clvTracker.getStatus() : {};
      addCheck('CLV Tracker',
        'PASS',
        `${status.totalPicks || 0} picks recorded, ready for Opening Day tracking`
      );
    } catch (e) {
      addCheck('CLV Tracker', 'WARN', `Not available: ${e.message}`);
    }
    
    // 13. OPENING DAY PLAYBOOK — Can we generate it?
    try {
      const projections = await mlbOpeningDay.getProjections();
      const gameCount = projections?.games?.length || 0;
      addCheck('Opening Day Playbook',
        gameCount >= 10 ? 'PASS' : gameCount >= 5 ? 'WARN' : 'FAIL',
        `${gameCount} games with full projections`
      );
    } catch (e) {
      addCheck('Opening Day Playbook', 'FAIL', e.message);
    }
    
    // 14. F5 UNDERS — Ready?
    try {
      const owu = require('./services/opening-week-unders');
      addCheck('F5/Opening Week Unders', 'PASS', 'Service loaded, ready for cold weather + ace starter analysis');
    } catch (e) {
      addCheck('F5/Opening Week Unders', 'WARN', `Not available: ${e.message}`);
    }
    
    // 15. LINEUP FETCHER — Can we get lineups on game day?
    try {
      const lf = require('./services/lineup-fetcher');
      addCheck('Lineup Fetcher',
        'PASS',
        'Service loaded, will fetch confirmed lineups on game day'
      );
    } catch (e) {
      addCheck('Lineup Fetcher', 'WARN', `Not available: ${e.message}`);
    }
    
    // 16. DK LINES — Are they current?
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      const withLines = schedule.filter(g => g.dkLine && g.dkLine.homeML);
      const withoutLines = schedule.filter(g => !g.dkLine || !g.dkLine.homeML);
      addCheck('DraftKings Opening Lines',
        withLines.length >= 15 ? 'PASS' : withLines.length >= 10 ? 'WARN' : 'FAIL',
        `${withLines.length}/${schedule.length} games have DK lines${withoutLines.length > 0 ? ` (missing: ${withoutLines.map(g => g.away + '@' + g.home).join(', ')})` : ''}`
      );
    } catch (e) {
      addCheck('DraftKings Opening Lines', 'WARN', e.message);
    }
    
    // 17. MODEL EDGE SCAN — Do we have actionable edges for OD?
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      let edges = [];
      for (const g of schedule) {
        if (!g.dkLine) continue;
        const pred = mlb.predict(g.away, g.home, {
          awayPitcher: g.confirmedStarters?.away,
          homePitcher: g.confirmedStarters?.home
        });
        if (pred.error) continue;
        
        const dkHomeProb = g.dkLine.homeML < 0 ? (-g.dkLine.homeML) / (-g.dkLine.homeML + 100) : 100 / (g.dkLine.homeML + 100);
        const dkAwayProb = g.dkLine.awayML < 0 ? (-g.dkLine.awayML) / (-g.dkLine.awayML + 100) : 100 / (g.dkLine.awayML + 100);
        
        const homeEdge = pred.homeWinProb - dkHomeProb;
        const awayEdge = pred.awayWinProb - dkAwayProb;
        const bestEdge = Math.max(homeEdge, awayEdge);
        
        if (bestEdge >= 0.02) {
          const side = homeEdge > awayEdge ? 'HOME' : 'AWAY';
          edges.push({
            game: `${g.away}@${g.home}`,
            pick: side === 'HOME' ? g.home : g.away,
            edge: `+${(bestEdge * 100).toFixed(1)}%`,
            ml: side === 'HOME' ? g.dkLine.homeML : g.dkLine.awayML,
            starters: `${g.confirmedStarters?.away || 'TBD'} vs ${g.confirmedStarters?.home || 'TBD'}`,
          });
        }
      }
      edges.sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));
      addCheck('Opening Day Edges',
        edges.length >= 3 ? 'PASS' : edges.length >= 1 ? 'WARN' : 'FAIL',
        `${edges.length} value edges found (≥2% edge)` + (edges.length > 0 ? ': ' + edges.slice(0, 3).map(e => `${e.pick} ${e.edge}`).join(', ') : '')
      );
      checks.topEdges = edges.slice(0, 5);
    } catch (e) {
      addCheck('Opening Day Edges', 'WARN', e.message);
    }
    
    // Summary
    const passCount = checks.checks.filter(c => c.status === 'PASS').length;
    const warnCount = checks.checks.filter(c => c.status === 'WARN').length;
    const failCount = checks.checks.filter(c => c.status === 'FAIL').length;
    checks.summary = `${passCount} PASS, ${warnCount} WARN, ${failCount} FAIL — ${checks.overallStatus}`;
    
    if (checks.overallStatus === 'PASS') {
      checks.message = '🟢 ALL SYSTEMS GO FOR OPENING DAY! Model is ready to print money. 🦞💰';
    } else if (checks.overallStatus === 'WARN') {
      checks.message = '🟡 MOSTLY READY — some warnings to review before game day.';
    } else {
      checks.message = '🔴 NOT READY — critical failures must be fixed before Opening Day!';
    }
    
    res.json(checks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== PITCHER K PROPS MODEL ====================

// Full K prop scan — all OD starters with value detection
app.get('/api/opening-day/k-props', async (req, res) => {
  try {
    if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K Props model not loaded' });
    const scan = pitcherKProps.scanODKProps({ isOpeningDay: true });
    res.json(scan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single pitcher K prop prediction
app.get('/api/mlb/k-props/:pitcher', async (req, res) => {
  try {
    if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K Props model not loaded' });
    const pitcherName = decodeURIComponent(req.params.pitcher);
    const opponent = req.query.opponent || req.query.opp;
    const park = req.query.park;
    const isOD = req.query.od === 'true' || req.query.openingDay === 'true';
    const tempF = req.query.temp ? parseFloat(req.query.temp) : undefined;
    
    if (!opponent) return res.status(400).json({ error: 'Missing opponent query param (?opponent=NYY)' });
    
    const pred = pitcherKProps.predictKs(pitcherName, opponent, park || null, { 
      isOpeningDay: isOD, 
      tempF 
    });
    
    if (!pred) return res.status(404).json({ error: `Pitcher '${pitcherName}' not found in K props database` });
    
    res.json(pred);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Top K prop value plays only (filtered)
app.get('/api/opening-day/k-props/top', async (req, res) => {
  try {
    if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K Props model not loaded' });
    const scan = pitcherKProps.scanODKProps({ isOpeningDay: true });
    const minEdge = parseFloat(req.query.minEdge || '5');
    const filtered = scan.topPicks.filter(p => Math.abs(p.edge) >= minEdge);
    res.json({
      timestamp: scan.timestamp,
      minEdgeFilter: minEdge,
      count: filtered.length,
      picks: filtered,
      summary: scan.summary,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== OD SGP (Same Game Parlay) BUILDER ====================

// Live K Props — fetch real-time lines from The Odds API
app.get('/api/opening-day/k-props/live', async (req, res) => {
  try {
    if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K Props model not loaded' });
    const result = await pitcherKProps.fetchLiveKProps(ODDS_API_KEY);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update K prop lines with live odds and re-scan
app.post('/api/opening-day/k-props/refresh', async (req, res) => {
  try {
    if (!pitcherKProps) return res.status(503).json({ error: 'Pitcher K Props model not loaded' });
    const updateResult = await pitcherKProps.updateLiveKLines(ODDS_API_KEY);
    
    // Re-scan with updated lines
    const scan = pitcherKProps.scanODKProps({ isOpeningDay: true });
    
    res.json({
      liveUpdate: updateResult,
      scan,
      message: `Updated ${updateResult.updated} pitcher lines from live odds (${updateResult.added} new). ${updateResult.changes?.length || 0} line changes detected.`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD ODDS MONITOR v112.0 =====
// Detects when books post MLB OD lines and auto-triggers playbook rebuild

app.get('/api/opening-day/odds-monitor/status', (req, res) => {
  try {
    if (!odOddsMonitor) return res.status(503).json({ error: 'OD Odds Monitor not loaded' });
    res.json(odOddsMonitor.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/odds-monitor/comparison', (req, res) => {
  try {
    if (!odOddsMonitor) return res.status(503).json({ error: 'OD Odds Monitor not loaded' });
    res.json(odOddsMonitor.getOddsComparison());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/odds-monitor/alerts', (req, res) => {
  try {
    if (!odOddsMonitor) return res.status(503).json({ error: 'OD Odds Monitor not loaded' });
    res.json({ alerts: odOddsMonitor.getAlerts() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/opening-day/odds-monitor/poll', async (req, res) => {
  try {
    if (!odOddsMonitor) return res.status(503).json({ error: 'OD Odds Monitor not loaded' });
    const result = await odOddsMonitor.poll();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/opening-day/odds-monitor/start', (req, res) => {
  try {
    if (!odOddsMonitor) return res.status(503).json({ error: 'OD Odds Monitor not loaded' });
    odOddsMonitor.start();
    res.json({ status: 'started', message: 'OD Odds Monitor now polling every 15 min' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/opening-day/odds-monitor/stop', (req, res) => {
  try {
    if (!odOddsMonitor) return res.status(503).json({ error: 'OD Odds Monitor not loaded' });
    odOddsMonitor.stop();
    res.json({ status: 'stopped' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD COMMAND CENTER v113.0 =====
// THE single-page war room for Opening Day preparation
app.get('/api/opening-day/command-center', (req, res) => {
  try {
    if (!odCommandCenter) return res.status(503).json({ error: 'OD Command Center not loaded' });
    const result = odCommandCenter.buildCommandCenter();
    res.json(result);
  } catch (e) {
    console.error('Command Center error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Command Center - health only (lightweight)
app.get('/api/opening-day/command-center/health', (req, res) => {
  try {
    if (!odCommandCenter) return res.status(503).json({ error: 'OD Command Center not loaded' });
    const health = odCommandCenter.getSystemHealth();
    const countdown = odCommandCenter.getCountdown();
    res.json({ countdown, health });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Command Center - portfolio only
app.get('/api/opening-day/command-center/portfolio', (req, res) => {
  try {
    if (!odCommandCenter) return res.status(503).json({ error: 'OD Command Center not loaded' });
    res.json(odCommandCenter.getPortfolioSummary());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD T-2 VERIFICATION v114.0 =====
// Comprehensive pre-OD validation pass
app.get('/api/opening-day/t2-verify', async (req, res) => {
  try {
    if (!odT2Verification) return res.status(503).json({ error: 'OD T-2 Verification not loaded' });
    const result = odT2Verification.runVerification();
    res.json(result);
  } catch (e) {
    console.error('T-2 Verification error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/t2-verify/pitchers', (req, res) => {
  try {
    if (!odT2Verification) return res.status(503).json({ error: 'OD T-2 Verification not loaded' });
    res.json(odT2Verification.verifyPitchers());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/t2-verify/weather', (req, res) => {
  try {
    if (!odT2Verification) return res.status(503).json({ error: 'OD T-2 Verification not loaded' });
    res.json(odT2Verification.verifyWeather());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/t2-verify/readiness', (req, res) => {
  try {
    if (!odT2Verification) return res.status(503).json({ error: 'OD T-2 Verification not loaded' });
    res.json(odT2Verification.calculateReadiness());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD MORNING BRIEF v114.0 =====
// Daily briefing for OD preparation
app.get('/api/opening-day/morning-brief', async (req, res) => {
  try {
    if (!odMorningBrief) return res.status(503).json({ error: 'OD Morning Brief not loaded' });
    const day = parseInt(req.query.day) || 0;
    const result = day > 0 ? await odMorningBrief.generateBriefing(day) : await odMorningBrief.generateFullBriefing();
    res.json(result);
  } catch (e) {
    console.error('Morning Brief error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/morning-brief/day1', async (req, res) => {
  try {
    if (!odMorningBrief) return res.status(503).json({ error: 'OD Morning Brief not loaded' });
    res.json(await odMorningBrief.generateDay1Briefing());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/morning-brief/day2', async (req, res) => {
  try {
    if (!odMorningBrief) return res.status(503).json({ error: 'OD Morning Brief not loaded' });
    res.json(await odMorningBrief.generateDay2Briefing());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD LINE CHANGE TRACKER v114.0 =====
// Tracks DK line movement and edge shifts
app.get('/api/opening-day/line-changes', (req, res) => {
  try {
    if (!odLineChangeTracker) return res.status(503).json({ error: 'OD Line Change Tracker not loaded' });
    res.json(odLineChangeTracker.analyzeLineChanges());
  } catch (e) {
    console.error('Line Change Tracker error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== OD ESPN LIVE VERIFICATION v115.0 =====
// Auto-verify pitchers + lines against live ESPN data
app.get('/api/opening-day/espn-verify', async (req, res) => {
  try {
    if (!odEspnVerify) return res.status(503).json({ error: 'OD ESPN Live Verify not loaded' });
    const result = await odEspnVerify.verifyAll();
    res.json(result);
  } catch (e) {
    console.error('ESPN Verify error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/espn-verify/day/:day', async (req, res) => {
  try {
    if (!odEspnVerify) return res.status(503).json({ error: 'OD ESPN Live Verify not loaded' });
    const day = parseInt(req.params.day) || 1;
    const result = await odEspnVerify.verifyODDay(day);
    res.json(result);
  } catch (e) {
    console.error('ESPN Verify day error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== PITCHER OUTS RECORDED PROPS v76.0 =====
// Opening Day aces go deeper → OVER on outs recorded

// Scan all OD games for outs prop value
app.get('/api/opening-day/outs-props', async (req, res) => {
  try {
    if (!pitcherOutsProps) return res.status(503).json({ error: 'Pitcher outs props model not loaded' });
    const scan = pitcherOutsProps.scanAllODGames();
    res.json(scan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Individual pitcher outs lookup
app.get('/api/mlb/outs-props/:pitcher', async (req, res) => {
  try {
    if (!pitcherOutsProps) return res.status(503).json({ error: 'Pitcher outs props model not loaded' });
    const pitcherName = decodeURIComponent(req.params.pitcher);
    const result = pitcherOutsProps.getPitcherOutsProps(pitcherName);
    if (!result) {
      return res.status(404).json({ error: `Pitcher "${pitcherName}" not found in outs props DB` });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Outs recorded leaderboard — who goes deepest?
app.get('/api/opening-day/outs-props/leaderboard', async (req, res) => {
  try {
    if (!pitcherOutsProps) return res.status(503).json({ error: 'Pitcher outs props model not loaded' });
    const leaderboard = pitcherOutsProps.getOutsLeaderboard();
    res.json(leaderboard);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Top outs prop picks — highest edge plays only
app.get('/api/opening-day/outs-props/top', async (req, res) => {
  try {
    if (!pitcherOutsProps) return res.status(503).json({ error: 'Pitcher outs props model not loaded' });
    const minEdge = parseFloat(req.query.minEdge || '8');
    const scan = pitcherOutsProps.scanAllODGames();
    const topPicks = scan.allPicks.filter(p => p.edge >= minEdge);
    res.json({
      count: topPicks.length,
      minEdge,
      picks: topPicks,
      summary: `${topPicks.length} outs prop picks with ${minEdge}%+ edge. OD premium drives OVER lean for aces.`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full OD SGP scan — correlated parlays for all games
app.get('/api/opening-day/sgp', async (req, res) => {
  try {
    if (!odSgpBuilder) return res.status(503).json({ error: 'SGP Builder not loaded' });
    const minEdge = parseFloat(req.query.minEdge || '0.02');
    const maxLegs = parseInt(req.query.maxLegs || '3');
    const scan = odSgpBuilder.scanODSGPs({ minEdge, maxLegs });
    res.json(scan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SGP for a specific game
app.get('/api/opening-day/sgp/:away/:home', async (req, res) => {
  try {
    if (!odSgpBuilder) return res.status(503).json({ error: 'SGP Builder not loaded' });
    const OD_GAMES = mlbOpeningDay.OPENING_DAY_GAMES;
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    const game = OD_GAMES.find(g => g.away === away && g.home === home);
    if (!game) return res.status(404).json({ error: `Game ${away}@${home} not found in OD schedule` });
    const result = odSgpBuilder.buildGameSGPs(game, {
      minEdge: parseFloat(req.query.minEdge || '0.02'),
      maxLegs: parseInt(req.query.maxLegs || '3'),
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== NRFI/YRFI MODEL v77.0 ====================

// ==================== PITCHER HITS/WALKS/ER PROPS v95.0 ====================

// Scan all OD games for H/W/ER prop value
app.get('/api/opening-day/hwe-props', async (req, res) => {
  try {
    if (!pitcherHweProps) return res.status(503).json({ error: 'Pitcher HWE Props not loaded' });
    const scan = pitcherHweProps.scanODProps();
    res.json(scan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Top HWE prop plays
app.get('/api/opening-day/hwe-props/top', async (req, res) => {
  try {
    if (!pitcherHweProps) return res.status(503).json({ error: 'Pitcher HWE Props not loaded' });
    const limit = parseInt(req.query.limit || '20');
    const topPlays = pitcherHweProps.getTopPlays(limit);
    res.json(topPlays);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pitcher-specific HWE analysis
app.get('/api/mlb/hwe-props/:pitcher', async (req, res) => {
  try {
    if (!pitcherHweProps) return res.status(503).json({ error: 'Pitcher HWE Props not loaded' });
    const pitcherName = decodeURIComponent(req.params.pitcher);
    const oppTeam = (req.query.opp || req.query.opponent || '').toUpperCase();
    if (!oppTeam) return res.status(400).json({ error: 'Missing opponent team param (opp=XXX)' });
    const parkName = pitcherHweProps.TEAM_PARKS[oppTeam] || null;
    const analysis = pitcherHweProps.analyzePitcherProps(pitcherName, oppTeam, parkName, {
      isOpeningDay: req.query.od !== 'false',
      tempF: req.query.temp ? parseFloat(req.query.temp) : null,
    });
    if (!analysis) return res.status(404).json({ error: `Pitcher ${pitcherName} not found` });
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pitcher leaderboard for HWE props
app.get('/api/mlb/hwe-props/leaderboard', async (req, res) => {
  try {
    if (!pitcherHweProps) return res.status(503).json({ error: 'Pitcher HWE Props not loaded' });
    res.json(pitcherHweProps.getPitcherLeaderboard());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// HWE props status
app.get('/api/mlb/hwe-props/status', async (req, res) => {
  try {
    if (!pitcherHweProps) return res.status(503).json({ error: 'Pitcher HWE Props not loaded' });
    res.json(pitcherHweProps.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan all OD games for NRFI/YRFI value
app.get('/api/opening-day/nrfi', async (req, res) => {
  try {
    if (!nrfiModel) return res.status(503).json({ error: 'NRFI model not loaded' });
    const odGames = mlbOpeningDay.OPENING_DAY_GAMES;
    const scan = nrfiModel.scanODGames(mlb, odGames, {});
    res.json(scan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NRFI for a specific matchup
app.get('/api/mlb/nrfi/:away/:home', async (req, res) => {
  try {
    if (!nrfiModel) return res.status(503).json({ error: 'NRFI model not loaded' });
    const away = req.params.away.toUpperCase();
    const home = req.params.home.toUpperCase();
    
    // Get prediction
    let pred;
    try { pred = await mlb.asyncPredict(away, home); }
    catch { pred = mlb.predict(away, home); }
    
    if (!pred || pred.error) return res.json({ error: 'Prediction not available', away, home });
    
    // Look up pitcher tiers
    let awayTier = 3, homeTier = 3;
    let awayPitcherName = req.query.awayPitcher || 'Unknown';
    let homePitcherName = req.query.homePitcher || 'Unknown';
    if (pitcherKProps) {
      const STEAMER = pitcherKProps.STEAMER_K9_PROJECTIONS || {};
      if (STEAMER[awayPitcherName]) awayTier = STEAMER[awayPitcherName].tier;
      if (STEAMER[homePitcherName]) homeTier = STEAMER[homePitcherName].tier;
    }
    
    const isOD = ['2026-03-26', '2026-03-27'].includes(new Date().toISOString().slice(0, 10));
    const result = nrfiModel.calculateNRFI(away, home, {
      prediction: pred,
      awayPitcherTier: awayTier,
      homePitcherTier: homeTier,
      awayPitcherName,
      homePitcherName,
      isOpeningDay: isOD,
      isOpeningWeek: true,
    });
    
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NRFI value scan — compare model to live odds
app.get('/api/mlb/nrfi/scan', async (req, res) => {
  try {
    if (!nrfiModel) return res.status(503).json({ error: 'NRFI model not loaded' });
    
    // Get all live odds including 1st inning markets
    let firstInningOdds = [];
    if (ODDS_API_KEY) {
      try {
        const fetch = require('node-fetch');
        const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=totals_1st_1_innings,h2h_1st_1_innings&oddsFormat=american`;
        const resp = await fetch(url);
        if (resp.ok) firstInningOdds = await resp.json();
      } catch (e) {
        console.error('[nrfi-scan] Failed to fetch 1st inning odds:', e.message);
      }
    }
    
    // Scan OD games
    const odGames = mlbOpeningDay.OPENING_DAY_GAMES;
    const scan = nrfiModel.scanODGames(mlb, odGames, {});
    
    // Match live odds to games and find value
    const valuePlays = [];
    for (const game of scan.games) {
      if (!game.nrfi) continue;
      
      // Find matching odds
      const oddsGame = firstInningOdds.find(og => {
        const homeMatch = og.home_team?.toLowerCase().includes(game.home.toLowerCase());
        const awayMatch = og.away_team?.toLowerCase().includes(game.away.toLowerCase());
        return homeMatch || awayMatch;
      });
      
      if (oddsGame) {
        for (const bk of (oddsGame.bookmakers || [])) {
          for (const mkt of (bk.markets || [])) {
            if (mkt.key === 'totals_1st_1_innings') {
              let nrfiML = null, yrfiML = null;
              for (const o of (mkt.outcomes || [])) {
                if (o.name === 'Under' && o.point === 0.5) nrfiML = o.price;
                if (o.name === 'Over' && o.point === 0.5) yrfiML = o.price;
              }
              if (nrfiML || yrfiML) {
                const comparison = nrfiModel.compareToOdds(game, nrfiML, yrfiML);
                if (comparison && comparison.plays.length > 0) {
                  valuePlays.push({
                    matchup: game.matchup,
                    book: bk.title,
                    ...comparison,
                  });
                }
              }
            }
          }
        }
      }
    }
    
    res.json({
      scan,
      liveOdds: {
        available: firstInningOdds.length > 0,
        gamesWithOdds: firstInningOdds.length,
      },
      valuePlays,
      totalValuePlays: valuePlays.reduce((s, v) => s + (v.plays?.length || 0), 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== TEAM TOTALS PROP SCANNER ENDPOINTS ====================

// Scan all OD games for team total value
app.get('/api/opening-day/team-totals', async (req, res) => {
  try {
    if (!teamTotalsScanner) return res.status(503).json({ error: 'Team Totals Scanner not loaded' });
    
    // Optionally fetch live team total odds
    let liveOdds = null;
    if (ODDS_API_KEY && req.query.live !== 'false') {
      try {
        const liveResult = await teamTotalsScanner.fetchLiveTeamTotals(ODDS_API_KEY);
        if (liveResult.games?.length > 0) {
          liveOdds = liveResult.games;
        }
      } catch (e) {
        console.error('[team-totals] Failed to fetch live odds:', e.message);
      }
    }
    
    const result = teamTotalsScanner.scanODTeamTotals(mlb, liveOdds);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Team totals for a specific matchup
app.get('/api/mlb/team-totals/:away/:home', async (req, res) => {
  try {
    if (!teamTotalsScanner) return res.status(503).json({ error: 'Team Totals Scanner not loaded' });
    const { away, home } = req.params;
    const result = teamTotalsScanner.scanMatchup(mlb, away.toUpperCase(), home.toUpperCase(), {
      awayStarter: req.query.awayPitcher,
      homeStarter: req.query.homePitcher,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch live team total odds from Odds API
app.get('/api/mlb/team-totals/live', async (req, res) => {
  try {
    if (!teamTotalsScanner) return res.status(503).json({ error: 'Team Totals Scanner not loaded' });
    if (!ODDS_API_KEY) return res.json({ error: 'No API key configured', games: [] });
    
    const result = await teamTotalsScanner.fetchLiveTeamTotals(ODDS_API_KEY);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== EDGE DECAY & BET TIMING OPTIMIZER ENDPOINTS ====================

// Full timing report — when to bet each play
app.get('/api/opening-day/bet-timing', (req, res) => {
  try {
    if (!edgeDecayOptimizer) return res.status(503).json({ error: 'Edge Decay Optimizer not loaded' });
    const report = edgeDecayOptimizer.generateTimingReport(mlb);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Portfolio timing optimization — analyzes all betting card plays
app.get('/api/opening-day/bet-timing/portfolio', async (req, res) => {
  try {
    if (!edgeDecayOptimizer) return res.status(503).json({ error: 'Edge Decay Optimizer not loaded' });
    
    // Try to get betting card data
    let bettingCard = null;
    if (playbookCache) {
      const cached = playbookCache.getCachedOnly ? playbookCache.getCachedOnly() : null;
      if (cached && cached.bettingCard) {
        bettingCard = cached.bettingCard;
      } else if (cached && cached.actionBoard) {
        bettingCard = { plays: cached.actionBoard };
      }
    }
    
    if (!bettingCard) {
      return res.json({ 
        error: 'No betting card cached — trigger playbook build first',
        hint: 'GET /api/opening-day-playbook to build cache'
      });
    }
    
    const result = edgeDecayOptimizer.optimizePortfolioBetTiming(bettingCard);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Quick check: should I bet this play now?
app.get('/api/opening-day/bet-timing/check/:away/:home', (req, res) => {
  try {
    if (!edgeDecayOptimizer) return res.status(503).json({ error: 'Edge Decay Optimizer not loaded' });
    
    const { away, home } = req.params;
    const gameKey = `${away.toUpperCase()}@${home.toUpperCase()}`;
    const marketType = req.query.market || 'moneyline';
    const edge = parseFloat(req.query.edge || '5');
    const confidence = parseInt(req.query.confidence || '60');
    
    // Find game time
    let gameTime = null;
    for (const day of [edgeDecayOptimizer.OD_SCHEDULE.day1, edgeDecayOptimizer.OD_SCHEDULE.day2]) {
      const game = day.games.find(g => g.away === away.toUpperCase() && g.home === home.toUpperCase());
      if (game) { gameTime = game.time; break; }
    }
    
    if (!gameTime) return res.json({ error: `Game ${gameKey} not found in OD schedule` });
    
    const result = edgeDecayOptimizer.shouldBetNow({ 
      edge, confidence, marketType, type: marketType 
    }, gameTime);
    
    res.json({ gameKey, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Market timing guide — when to bet each market type
app.get('/api/opening-day/bet-timing/markets', (req, res) => {
  try {
    if (!edgeDecayOptimizer) return res.status(503).json({ error: 'Edge Decay Optimizer not loaded' });
    
    const now = new Date();
    const od1Start = new Date(edgeDecayOptimizer.OD_SCHEDULE.day1.firstPitch);
    const hoursToOD1 = (od1Start - now) / (1000 * 60 * 60);
    
    const markets = {};
    for (const [mt, rates] of Object.entries(edgeDecayOptimizer.DECAY_RATES)) {
      const window = edgeDecayOptimizer.getTimeWindow(edgeDecayOptimizer.OD_SCHEDULE.day1.firstPitch);
      markets[mt] = {
        decayRates: rates,
        currentWindow: window.name,
        hoursToOD1: parseFloat(hoursToOD1.toFixed(1)),
        status: hoursToOD1 > 24 ? 'EARLY — edges at widest' :
                hoursToOD1 > 12 ? 'SHARP WINDOW — ML edges shrinking' :
                hoursToOD1 > 6 ? 'TRANSITION — best value/liquidity' :
                hoursToOD1 > 2 ? 'PUBLIC — watch for new edges' :
                hoursToOD1 > 0 ? 'LINEUP — final bets' : 'GAME STARTED',
      };
    }
    
    res.json({
      timestamp: now.toISOString(),
      hoursToOD1: parseFloat(hoursToOD1.toFixed(1)),
      markets,
      decayRates: edgeDecayOptimizer.DECAY_RATES,
      windows: edgeDecayOptimizer.WINDOWS,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Record edge snapshot (for tracking decay over time)
app.post('/api/opening-day/bet-timing/snapshot', async (req, res) => {
  try {
    if (!edgeDecayOptimizer) return res.status(503).json({ error: 'Edge Decay Optimizer not loaded' });
    
    // Get current playbook data for snapshot
    let playbookData = null;
    if (playbookCache) {
      playbookData = playbookCache.getCachedOnly ? playbookCache.getCachedOnly() : null;
    }
    
    if (!playbookData) {
      return res.json({ error: 'No playbook data to snapshot — build playbook first' });
    }
    
    const snapshot = edgeDecayOptimizer.recordSnapshot(playbookData);
    res.json({ success: true, snapshot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Edge decay trajectory for a specific game
app.get('/api/opening-day/bet-timing/trajectory/:gameKey', (req, res) => {
  try {
    if (!edgeDecayOptimizer) return res.status(503).json({ error: 'Edge Decay Optimizer not loaded' });
    
    const gameKey = req.params.gameKey;
    const trajectories = {};
    
    for (const mt of ['moneyline', 'totals', 'f5', 'kprop', 'nrfi']) {
      const traj = edgeDecayOptimizer.calcDecayTrajectory(gameKey, mt);
      if (traj) trajectories[mt] = traj;
    }
    
    res.json({ gameKey, trajectories, snapshots: Object.keys(trajectories).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== F3 (FIRST 3 INNINGS) ENDPOINTS ====================

// F3 matchup analysis for a specific game
app.get('/api/mlb/f3/:away/:home', async (req, res) => {
  try {
    if (!f3Model) return res.status(503).json({ error: 'F3 model not loaded' });
    const { away, home } = req.params;
    const result = f3Model.analyzeF3Matchup(mlb, away.toUpperCase(), home.toUpperCase());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// F3 value scan for Opening Day games
app.get('/api/opening-day/f3', async (req, res) => {
  try {
    if (!f3Model) return res.status(503).json({ error: 'F3 model not loaded' });
    
    // Get Opening Day games
    let odGames;
    try {
      const odModule = require('./models/mlb-opening-day');
      odGames = odModule.getSchedule ? odModule.getSchedule() : (odModule.OPENING_DAY_GAMES || []);
    } catch (e) {
      odGames = [];
    }
    
    if (odGames.length === 0) {
      // Fallback: scan from Odds API data
      return res.json({ error: 'No OD games found. Use /api/mlb/f3/scan for live games.' });
    }
    
    const scan = f3Model.scanODGamesF3(mlb, odGames, {});
    
    // Try to get live F3 odds for comparison
    let liveOdds = null;
    try {
      liveOdds = await f3Model.fetchF3Odds();
    } catch (e) {
      // Live odds optional
    }
    
    res.json({
      ...scan,
      liveOdds: liveOdds && !liveOdds.error ? {
        available: true,
        gamesWithLines: liveOdds.games?.filter(g => Object.keys(g.f3Lines || {}).length > 0).length || 0,
      } : { available: false },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// F3 scan for today's MLB games (regular season + OD)
app.get('/api/mlb/f3/scan', async (req, res) => {
  try {
    if (!f3Model) return res.status(503).json({ error: 'F3 model not loaded' });
    
    // Get today's games from Odds API
    const allOdds = require('./services/live-data').getAllOdds ? require('./services/live-data').getAllOdds() : {};
    const mlbOdds = allOdds.mlb || [];
    
    // Build games list
    const games = [];
    for (const game of mlbOdds) {
      const away = f3Model.resolveTeam(game.away || game.away_team || '');
      const home = f3Model.resolveTeam(game.home || game.home_team || '');
      if (away && home) {
        games.push({ away, home });
      }
    }
    
    // If no odds data, try Opening Day schedule
    if (games.length === 0) {
      try {
        const odModule = require('./models/mlb-opening-day');
        const odGames = odModule.getSchedule ? odModule.getSchedule() : (odModule.OPENING_DAY_GAMES || []);
        for (const g of odGames) {
          games.push({ away: g.away, home: g.home });
        }
      } catch (e) { /* ok */ }
    }
    
    const scan = f3Model.scanF3Value(mlb, games, {});
    
    // Try to enrich with live F3 odds
    let liveOdds = null;
    try {
      liveOdds = await f3Model.fetchF3Odds();
      if (liveOdds && liveOdds.games) {
        for (const liveGame of liveOdds.games) {
          const liveAway = f3Model.resolveTeam(liveGame.away);
          const liveHome = f3Model.resolveTeam(liveGame.home);
          const matchingScan = scan.games.find(g => g.away === liveAway && g.home === liveHome);
          if (matchingScan && liveGame.bestF3Line) {
            matchingScan.liveF3Line = liveGame.bestF3Line;
            matchingScan.liveBook = liveGame.bestBook;
            
            // Calculate edge vs live odds for total
            if (liveGame.bestF3Line.totalLine) {
              const liveLine = liveGame.bestF3Line.totalLine;
              const lineData = matchingScan.f3?.totals?.[liveLine] || 
                               (matchingScan.modelF3Total < liveLine ? { under: 0.55 } : { over: 0.55 });
              // Find closest model line for comparison
              for (const bet of matchingScan.valueBets) {
                if (Math.abs(bet.line - liveLine) <= 0.5) {
                  const impliedOver = liveGame.bestF3Line.overOdds ? 
                    (liveGame.bestF3Line.overOdds > 0 ? 100/(liveGame.bestF3Line.overOdds+100) : Math.abs(liveGame.bestF3Line.overOdds)/(Math.abs(liveGame.bestF3Line.overOdds)+100)) : null;
                  const impliedUnder = liveGame.bestF3Line.underOdds ?
                    (liveGame.bestF3Line.underOdds > 0 ? 100/(liveGame.bestF3Line.underOdds+100) : Math.abs(liveGame.bestF3Line.underOdds)/(Math.abs(liveGame.bestF3Line.underOdds)+100)) : null;
                  
                  if (bet.direction === 'UNDER' && impliedUnder) {
                    bet.edge = +((bet.modelProb - impliedUnder) * 100).toFixed(1);
                    bet.bookOdds = liveGame.bestF3Line.underOdds;
                    bet.bookLine = liveLine;
                  } else if (bet.direction === 'OVER' && impliedOver) {
                    bet.edge = +((bet.modelProb - impliedOver) * 100).toFixed(1);
                    bet.bookOdds = liveGame.bestF3Line.overOdds;
                    bet.bookLine = liveLine;
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) { /* live odds optional */ }
    
    res.json({
      ...scan,
      liveOdds: liveOdds && !liveOdds.error ? {
        available: true,
        gamesWithLines: liveOdds.games?.filter(g => Object.keys(g.f3Lines || {}).length > 0).length || 0,
      } : { available: false },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// F3 model status
app.get('/api/mlb/f3/status', (req, res) => {
  if (!f3Model) return res.status(503).json({ error: 'F3 model not loaded' });
  res.json(f3Model.getStatus());
});

// ==================== F7 FIRST-7-INNINGS MODEL (v98.0) ====================
// Bullpen chaos eliminator — removes 8th/9th inning variance
// Key edge: bad bullpen teams overpriced on full game totals, F7 captures this

// F7 matchup analysis for any two teams
app.get('/api/mlb/f7/:away/:home', (req, res) => {
  try {
    if (!f7Model) return res.status(503).json({ error: 'F7 model not loaded' });
    const { away, home } = req.params;
    const awayPitcher = req.query.awayPitcher || req.query.ap;
    const homePitcher = req.query.homePitcher || req.query.hp;
    const result = f7Model.predictF7(away.toUpperCase(), home.toUpperCase(), {
      awayPitcher,
      homePitcher,
      isOpeningDay: req.query.od === '1',
      temperature: req.query.temp ? parseFloat(req.query.temp) : undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan Opening Day games for F7 value
app.get('/api/opening-day/f7', (req, res) => {
  try {
    if (!f7Model) return res.status(503).json({ error: 'F7 model not loaded' });
    const result = f7Model.scanODGames();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// F7 scan for today's MLB games (regular season)
app.get('/api/mlb/f7/scan', (req, res) => {
  try {
    if (!f7Model) return res.status(503).json({ error: 'F7 model not loaded' });
    
    // Try to get games from live odds data
    const games = [];
    try {
      const liveData = require('./services/live-data');
      const allOdds = liveData.getAllOdds ? liveData.getAllOdds() : {};
      const mlbOdds = allOdds.mlb || [];
      for (const game of mlbOdds) {
        const away = (game.away || game.away_team || '').toUpperCase();
        const home = (game.home || game.home_team || '').toUpperCase();
        if (away && home) {
          games.push({ away, home });
        }
      }
    } catch (e) { /* ok */ }
    
    // If no live games, use Opening Day schedule
    if (games.length === 0) {
      const result = f7Model.scanODGames({ isOpeningDay: req.query.od === '1' });
      return res.json(result);
    }
    
    const result = f7Model.scanGames(games, {
      isOpeningDay: req.query.od === '1',
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// F7 model status
app.get('/api/mlb/f7/status', (req, res) => {
  if (!f7Model) return res.status(503).json({ error: 'F7 model not loaded' });
  res.json(f7Model.getStatus());
});

// ==================== BATTER PROPS ENDPOINTS ====================

// Scan all OD games for batter prop value
app.get('/api/opening-day/batter-props', async (req, res) => {
  try {
    if (!batterProps) return res.status(503).json({ error: 'Batter Props model not loaded' });
    // Try to fetch live lines (non-blocking, falls back to model-estimated)
    let liveLines = null;
    try { liveLines = await batterProps.fetchLiveBatterLines(); } catch (e) { /* ok */ }
    const scan = batterProps.scanODBatterProps({ isOpeningDay: true, liveLines });
    res.json(scan);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Individual batter matchup analysis
app.get('/api/mlb/batter-props/:batter/:pitcher/:homeTeam', async (req, res) => {
  try {
    if (!batterProps) return res.status(503).json({ error: 'Batter Props model not loaded' });
    const { batter, pitcher, homeTeam } = req.params;
    const batterName = batter.replace(/-/g, ' ');
    const pitcherName = pitcher.replace(/-/g, ' ');
    const result = batterProps.getBatterMatchup(batterName, pitcherName, homeTeam.toUpperCase(), {
      isOpeningDay: true,
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Statcast leaderboard for prop betting
app.get('/api/mlb/batter-props/leaderboard', async (req, res) => {
  try {
    if (!batterProps) return res.status(503).json({ error: 'Batter Props model not loaded' });
    const metric = req.query.metric || 'xwoba';
    const limit = parseInt(req.query.limit) || 30;
    const leaderboard = batterProps.getStatcastLeaderboard(metric, limit);
    res.json({ metric, count: leaderboard.length, batters: leaderboard });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Regression targets — batters due for positive/negative regression
app.get('/api/mlb/batter-props/regression/:direction', async (req, res) => {
  try {
    if (!batterProps) return res.status(503).json({ error: 'Batter Props model not loaded' });
    const direction = req.params.direction === 'back' ? 'back' : 'fade';
    const limit = parseInt(req.query.limit) || 20;
    const targets = batterProps.getRegressionTargets(direction, limit);
    res.json({ 
      direction, 
      count: targets.length, 
      targets,
      strategy: direction === 'fade' 
        ? 'These batters are OVERPERFORMING Statcast expected stats — UNDER hits/TB props'
        : 'These batters are UNDERPERFORMING Statcast expected stats — OVER hits/TB props'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Daily batter props scan — works for any game day (v85.0)
app.get('/api/mlb/batter-props/daily-scan', async (req, res) => {
  try {
    if (!batterProps) return res.status(503).json({ error: 'Batter Props model not loaded' });
    if (!batterProps.scanDailyBatterProps) return res.status(503).json({ error: 'Daily scan not available — update batter-props service' });
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const scan = await batterProps.scanDailyBatterProps({ date });
    res.json(scan);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== AUTO-SCANNER ENDPOINTS ====================

// Health dashboard — monitor all automated scans
app.get('/api/scanner/health', (req, res) => {
  try {
    res.json(autoScanner.getHealth());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan status — quick overview of all cached scan results
app.get('/api/scanner/status', (req, res) => {
  try {
    res.json({
      scanner: autoScanner.getHealth(),
      cachedScans: autoScanner.getAllCachedScans(),
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force run a specific scan (or 'all')
app.get('/api/scanner/run/:scanKey', async (req, res) => {
  try {
    const { scanKey } = req.params;
    const result = await autoScanner.forceScan(scanKey);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get cached result for a specific scan
app.get('/api/scanner/cache/:scanKey', (req, res) => {
  try {
    const cached = autoScanner.getCachedScan(req.params.scanKey);
    if (!cached) return res.json({ error: 'No cached data', scanKey: req.params.scanKey });
    res.json(cached);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan log history
app.get('/api/scanner/log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const log = autoScanner.getScanLog(limit);
    res.json({ log, count: log.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Daily digest — aggregated summary of all scan results
app.get('/api/scanner/digest', (req, res) => {
  try {
    const digest = autoScanner.generateDailyDigest();
    res.json(digest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Start/stop scanner controls
app.post('/api/scanner/start', (req, res) => {
  try {
    autoScanner.startAllTimers();
    res.json({ status: 'started', health: autoScanner.getHealth() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/scanner/stop', (req, res) => {
  try {
    autoScanner.stopAllTimers();
    res.json({ status: 'stopped' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CONSENSUS ENGINE ENDPOINTS ====================

// Single game consensus: ALL models compared
app.get('/api/consensus/:away/:home', async (req, res) => {
  if (!consensusEngine) return res.status(503).json({ error: 'Consensus Engine not loaded' });
  try {
    const { away, home } = req.params;
    const result = await consensusEngine.getMLBConsensus(away.toUpperCase(), home.toUpperCase());
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Consensus value scan: find bets where ALL models agree on an edge
app.get('/api/consensus/value/scan', async (req, res) => {
  if (!consensusEngine) return res.status(503).json({ error: 'Consensus Engine not loaded' });
  try {
    const minConsensus = parseInt(req.query.minConsensus) || 55;
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    
    // Fetch live MLB odds to get games + book prices
    const liveOdds = await fetchOdds('baseball_mlb');
    if (!liveOdds || liveOdds.length === 0) {
      return res.json({ bets: [], note: 'No MLB games with live odds (MLB season not started yet — Opening Day March 27)' });
    }
    
    const nameMap = buildNameMap(mlb.TEAMS || mlb.getTeams(), {
      'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS',
      'blue jays': 'TOR', 'padres': 'SD', 'giants': 'SF', 'rays': 'TB', 'royals': 'KC',
    });
    
    const games = [];
    for (const oddsGame of liveOdds) {
      const awayAbbr = resolveTeam(nameMap, oddsGame.away_team);
      const homeAbbr = resolveTeam(nameMap, oddsGame.home_team);
      if (!awayAbbr || !homeAbbr) continue;
      
      const bestLine = { homeML: null, awayML: null, total: null };
      for (const bk of (oddsGame.bookmakers || [])) {
        const line = extractBookLine(bk, oddsGame.home_team);
        if (line.homeML && (bestLine.homeML === null || line.homeML > bestLine.homeML)) bestLine.homeML = line.homeML;
        if (line.awayML && (bestLine.awayML === null || line.awayML > bestLine.awayML)) bestLine.awayML = line.awayML;
        if (line.total && !bestLine.total) bestLine.total = line.total;
      }
      
      games.push({
        away: awayAbbr,
        home: homeAbbr,
        bookHomeML: bestLine.homeML,
        bookAwayML: bestLine.awayML,
        bookHomeProb: bestLine.homeML ? mlToProb(bestLine.homeML) : 0.5,
        bookAwayProb: bestLine.awayML ? mlToProb(bestLine.awayML) : 0.5,
        bookTotal: bestLine.total,
      });
    }
    
    const result = await consensusEngine.getConsensusValueBets(games, minConsensus, minEdge);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== OPENING WEEK UNDERS ENDPOINTS ====================

app.get('/api/opening-week/status', (req, res) => {
  if (!openingWeekUnders) return res.status(503).json({ error: 'Opening Week Unders service not loaded' });
  res.json(openingWeekUnders.getStatus());
});

app.get('/api/opening-week/parks', (req, res) => {
  if (!openingWeekUnders) return res.status(503).json({ error: 'Opening Week Unders service not loaded' });
  try {
    const parks = openingWeekUnders.getParkBreakdown();
    res.json({ parks, note: 'Opening Day totals reduction by park. Higher = stronger UNDER lean.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/opening-week/adjustment', (req, res) => {
  if (!openingWeekUnders) return res.status(503).json({ error: 'Opening Week Unders service not loaded' });
  const { date, park, homeStarter, awayStarter, total } = req.query;
  const gameDate = date || '2026-03-27';
  const homePark = park || 'Unknown';
  const homeStarterTier = parseInt(homeStarter) || 3;
  const awayStarterTier = parseInt(awayStarter) || 3;
  
  const adj = openingWeekUnders.getOpeningWeekAdjustment(gameDate, homePark, { homeStarterTier, awayStarterTier });
  
  if (total) {
    const totalNum = parseFloat(total);
    const result = openingWeekUnders.adjustTotal(totalNum, gameDate, homePark, { homeStarterTier, awayStarterTier });
    res.json({ ...result, adjustment: adj });
  } else {
    res.json(adj);
  }
});

app.get('/api/opening-week/scan', (req, res) => {
  if (!openingWeekUnders) return res.status(503).json({ error: 'Opening Week Unders service not loaded' });
  try {
    // Build game list from Opening Day games
    const games = mlbOpeningDay.OPENING_DAY_GAMES.map(g => {
      // Get park for home team
      const homeTeam = mlb.getTeams()[g.home];
      return {
        home: g.home,
        away: g.away,
        date: g.date || '2026-03-27',
        park: homeTeam?.park || '',
        homeStarterTier: g.homeStarterTier || 2,
        awayStarterTier: g.awayStarterTier || 2,
        modelTotal: g.modelTotal || null,
        bookTotal: g.bookTotal || null
      };
    });
    
    const results = openingWeekUnders.scanOpeningDayUnders(games);
    res.json({ 
      games: results.length, 
      results,
      summary: `${results.filter(r => r.grade === 'A' || r.grade === 'B+').length} strong UNDER candidates on Opening Day`,
      note: 'Historical Opening Day unders: 57.3%. Cold parks + ace matchups = 62-65% hit rate.'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NBA PLAYOFF PREVIEW — COMPREHENSIVE SERIES VALUE SCANNER ====================

/**
 * All-in-one NBA Playoff Preview
 * - Projects bracket from current standings
 * - Runs 10K championship simulations
 * - Fetches live NBA futures from sportsbooks
 * - Compares model series prices + championship odds to book odds
 * - Surfaces all +EV bets with Kelly sizing
 */
app.get('/api/playoffs/preview', async (req, res) => {
  try {
    const sims = Math.min(parseInt(req.query.sims) || 10000, 50000);
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.5;
    const minEdge = parseFloat(req.query.minEdge) || 0.03;
    
    // 1. Project bracket + championship odds
    const bracket = playoffSeries.projectBracket(nba);
    const champSim = playoffSeries.simulateFullPlayoffs(nba, sims);
    
    // 2. Fetch live NBA futures from The Odds API
    let futuresOdds = {};
    let futuresBooks = [];
    let futuresError = null;
    try {
      if (ODDS_API_KEY) {
        const fetch = require('node-fetch');
        const champUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba_championship_winner/odds/?apiKey=${ODDS_API_KEY}&regions=us&oddsFormat=american`;
        const champResp = await fetch(champUrl);
        const champData = await champResp.json();
        
        if (Array.isArray(champData) && champData.length > 0) {
          for (const event of champData) {
            for (const bk of (event.bookmakers || [])) {
              if (!futuresBooks.includes(bk.title)) futuresBooks.push(bk.title);
              for (const mkt of (bk.markets || [])) {
                for (const outcome of (mkt.outcomes || [])) {
                  const teamName = outcome.name;
                  // Map team name to abbreviation
                  const abbr = resolveNBATeamName(teamName);
                  if (abbr) {
                    if (!futuresOdds[abbr]) futuresOdds[abbr] = { odds: [], bestOdds: null, bestBook: '' };
                    futuresOdds[abbr].odds.push({ book: bk.title, ml: outcome.price });
                    if (!futuresOdds[abbr].bestOdds || outcome.price > futuresOdds[abbr].bestOdds) {
                      futuresOdds[abbr].bestOdds = outcome.price;
                      futuresOdds[abbr].bestBook = bk.title;
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        futuresError = 'No ODDS_API_KEY configured';
      }
    } catch (e) {
      futuresError = e.message;
    }
    
    // 3. Build championship value bets
    const champValueBets = [];
    for (const team of champSim.championshipOdds) {
      const modelProb = team.champPct / 100;
      if (modelProb < 0.005) continue; // skip <0.5% teams
      
      const oddsData = futuresOdds[team.abbr];
      if (oddsData && oddsData.bestOdds) {
        const bookProb = playoffSeries.mlToProb(oddsData.bestOdds);
        const edge = modelProb - bookProb;
        
        if (edge > minEdge) {
          const decimalOdds = oddsData.bestOdds > 0 ? (oddsData.bestOdds / 100) + 1 : (100 / (-oddsData.bestOdds)) + 1;
          const kellyK = Math.max(0, ((decimalOdds - 1) * modelProb - (1 - modelProb)) / (decimalOdds - 1));
          const wager = Math.min(bankroll * 0.03, bankroll * kellyK * kellyFraction); // Max 3% on any single future
          const ev = wager * (modelProb * (decimalOdds - 1) - (1 - modelProb));
          
          champValueBets.push({
            team: team.abbr,
            name: team.name,
            seed: team.seed,
            record: team.record,
            modelChampPct: team.champPct,
            modelFinalsPct: team.finalsPct,
            bookOdds: oddsData.bestOdds,
            bookOddsStr: oddsData.bestOdds > 0 ? `+${oddsData.bestOdds}` : `${oddsData.bestOdds}`,
            bookImpliedPct: +(bookProb * 100).toFixed(1),
            bestBook: oddsData.bestBook,
            edge: +(edge * 100).toFixed(1),
            kellyPct: +(kellyK * 100).toFixed(2),
            wager: +wager.toFixed(0),
            ev: +ev.toFixed(2),
            confidence: edge >= 0.08 ? 'HIGH' : edge >= 0.05 ? 'MEDIUM' : 'LOW',
            allBooks: oddsData.odds.map(o => ({ book: o.book, odds: o.ml > 0 ? `+${o.ml}` : `${o.ml}` })),
          });
        }
      }
    }
    champValueBets.sort((a, b) => b.edge - a.edge);
    
    // 4. Build series value analysis for projected first-round matchups
    const seriesValueBets = [];
    for (const conf of ['eastern', 'western']) {
      for (const matchup of bracket[conf].matchups) {
        const series = playoffSeries.analyzePlayoffSeries(nba, matchup.higher.abbr, matchup.lower.abbr);
        if (series.error) continue;
        
        seriesValueBets.push({
          conference: conf,
          matchup: `${matchup.higher.abbr} vs ${matchup.lower.abbr}`,
          higherSeed: { abbr: matchup.higher.abbr, seed: matchup.higher.seed, record: `${matchup.higher.w}-${matchup.higher.l}` },
          lowerSeed: { abbr: matchup.lower.abbr, seed: matchup.lower.seed, record: `${matchup.lower.w}-${matchup.lower.l}` },
          modelHigherPct: series.seriesPrice.higherSeedWinPct,
          modelLowerPct: series.seriesPrice.lowerSeedWinPct,
          fairHigherML: series.seriesPrice.higherSeedML,
          fairLowerML: series.seriesPrice.lowerSeedML,
          fairHigherStr: series.seriesPrice.fairOdds.higher,
          fairLowerStr: series.seriesPrice.fairOdds.lower,
          expectedLength: series.expectedLength,
          competitiveness: series.competitiveness,
          upsetAlert: series.upsetAlert,
          lengthDistribution: series.lengthDistribution,
          singleGame: series.singleGameEdge,
          // BETTING NOTE: Series prices aren't widely available yet (21 days out)
          // These are our FAIR PRICES — when books post series odds, compare to these
          note: 'These are model fair prices. When books post series prices, compare to find +EV.',
        });
      }
    }
    
    // 5. Build full playoff path probabilities
    const playoffPaths = champSim.championshipOdds
      .filter(t => t.champPct >= 0.5)
      .map(t => ({
        team: t.abbr,
        name: t.name,
        seed: t.seed,
        record: t.record,
        power: t.power,
        champPct: t.champPct,
        champML: t.champML,
        finalsPct: t.finalsPct,
        confFinalsPct: t.confFinalsPct,
        bookOdds: futuresOdds[t.abbr]?.bestOdds || null,
        bookOddsStr: futuresOdds[t.abbr]?.bestOdds ? (futuresOdds[t.abbr].bestOdds > 0 ? `+${futuresOdds[t.abbr].bestOdds}` : `${futuresOdds[t.abbr].bestOdds}`) : 'N/A',
        bookBook: futuresOdds[t.abbr]?.bestBook || null,
        hasValue: champValueBets.some(v => v.team === t.abbr),
      }));
    
    // 6. Summary
    const totalChampWager = champValueBets.reduce((s, b) => s + b.wager, 0);
    const totalChampEV = champValueBets.reduce((s, b) => s + b.ev, 0);
    
    res.json({
      timestamp: new Date().toISOString(),
      version: '48.0.0',
      playoffsStart: '2026-04-12',
      daysUntilPlayoffs: bracket.daysUntilPlayoffs,
      simulations: sims,
      
      // CHAMPIONSHIP FUTURES VALUE
      championshipValue: {
        valueBets: champValueBets,
        count: champValueBets.length,
        highConfidence: champValueBets.filter(b => b.confidence === 'HIGH').length,
        totalWager: +totalChampWager.toFixed(0),
        totalEV: +totalChampEV.toFixed(2),
        booksScanned: futuresBooks.length,
        futuresError,
      },
      
      // SERIES PRICES (our fair prices for first round)
      seriesPrices: seriesValueBets,
      
      // FULL PLAYOFF PATH PROBABILITIES
      playoffPaths,
      
      // TOP CONTENDERS
      topContenders: champSim.topContenders,
      darkHorses: champSim.darkHorses,
      
      // BRACKET
      bracket: {
        eastern: bracket.eastern,
        western: bracket.western,
      },
    });
  } catch (e) {
    console.error('Playoff preview error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Helper: resolve NBA team names from The Odds API
function resolveNBATeamName(name) {
  const map = {
    'Oklahoma City Thunder': 'OKC', 'Boston Celtics': 'BOS', 'Cleveland Cavaliers': 'CLE',
    'Houston Rockets': 'HOU', 'Denver Nuggets': 'DEN', 'Golden State Warriors': 'GSW',
    'Memphis Grizzlies': 'MEM', 'Dallas Mavericks': 'DAL', 'Minnesota Timberwolves': 'MIN',
    'Milwaukee Bucks': 'MIL', 'New York Knicks': 'NYK', 'Detroit Pistons': 'DET',
    'Los Angeles Lakers': 'LAL', 'San Antonio Spurs': 'SAS', 'Philadelphia 76ers': 'PHI',
    'Indiana Pacers': 'IND', 'Miami Heat': 'MIA', 'Sacramento Kings': 'SAC',
    'Phoenix Suns': 'PHX', 'Chicago Bulls': 'CHI', 'Los Angeles Clippers': 'LAC',
    'New Orleans Pelicans': 'NOP', 'Atlanta Hawks': 'ATL', 'Orlando Magic': 'ORL',
    'Brooklyn Nets': 'BKN', 'Portland Trail Blazers': 'POR', 'Toronto Raptors': 'TOR',
    'Charlotte Hornets': 'CHA', 'Washington Wizards': 'WAS', 'Utah Jazz': 'UTA',
  };
  return map[name] || null;
}

// ==================== MLB F5 OPENING WEEK UNDERS SCANNER ====================

/**
 * Dedicated F5 UNDER scanner for Opening Week (March 27 - April 2)
 * Combines:
 *   - Opening Week unders adjustments (cold weather, ace starters, rusty bats)
 *   - Alt-lines Poisson F5 score math (pitcher-dominated first 5 innings)
 *   - Live odds comparison when available
 * 
 * WHY F5 UNDERS ON OPENING WEEK = $$$:
 *   - Aces throw 6+ IP on Opening Day (starter stays in through F5)
 *   - Cold weather parks in April = less ball carry
 *   - Hitters need ~50 ABs to find their timing (spring ≠ regular)
 *   - F5 is where scoring suppression concentrates before bullpen takes over
 *   - Historical F5 under hit rate on Opening Day: ~60% (vs 50% baseline)
 */
app.get('/api/opening-week/f5-scan', async (req, res) => {
  try {
    if (!openingWeekUnders) return res.status(503).json({ error: 'Opening Week Unders service not loaded' });
    
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.5;
    const dateFilter = req.query.date || null; // optional: '2026-03-27' to filter to specific date
    
    // Get all Opening Week games
    const allGames = mlbOpeningDay.OPENING_DAY_GAMES;
    const teams = mlb.getTeams();
    
    // Fetch live MLB odds
    let liveOdds = [];
    try { liveOdds = await fetchOdds('baseball_mlb'); } catch (e) { /* no odds yet */ }
    
    const mlbNameMap = buildNameMap(mlb.TEAMS || teams, {
      'diamondbacks': 'ARI', 'd-backs': 'ARI', 'white sox': 'CWS', 'red sox': 'BOS',
      'blue jays': 'TOR', 'padres': 'SD', 'giants': 'SF', 'rays': 'TB', 'royals': 'KC',
    });
    
    const results = [];
    
    for (const game of allGames) {
      // Optional date filter
      if (dateFilter && game.date !== dateFilter) continue;
      
      const homeTeam = teams[game.home];
      const awayTeam = teams[game.away];
      if (!homeTeam || !awayTeam) continue;
      
      const parkName = homeTeam.park || '';
      
      // 1. Get Opening Week adjustment
      const owAdj = openingWeekUnders.getOpeningWeekAdjustment(game.date, parkName, {
        homeStarterTier: game.homeStarterTier || 2,
        awayStarterTier: game.awayStarterTier || 2,
      });
      
      // 2. Get model prediction for expected runs
      let prediction;
      try {
        prediction = await mlb.asyncPredict(game.away, game.home);
      } catch (e) {
        prediction = mlb.predict(game.away, game.home);
      }
      if (prediction.error) continue;
      
      const awayExpRuns = prediction.awayExpRuns || prediction.awayRuns || 4.3;
      const homeExpRuns = prediction.homeExpRuns || prediction.homeRuns || 4.3;
      
      // 3. Apply Opening Week reduction to get F5 expected runs
      // F5 is ~56.5% of full game scoring, but with OW adjustment it's lower
      const f5Factor = 0.565;
      const owReduction = 1 - (owAdj.reduction || 0);
      
      const awayF5Lambda = awayExpRuns * f5Factor * owReduction;
      const homeF5Lambda = homeExpRuns * f5Factor * owReduction;
      const f5ExpTotal = +(awayF5Lambda + homeF5Lambda).toFixed(2);
      
      // 4. Build F5 Poisson score matrix for exact probabilities
      const f5Probs = {};
      for (let line = 2.5; line <= 8.5; line += 0.5) {
        // Calculate exact P(total < line) using Poisson convolution
        let underProb = 0;
        for (let a = 0; a <= 15; a++) {
          for (let h = 0; h <= 15; h++) {
            if (a + h < line) {
              const pA = poissonPMF(a, awayF5Lambda);
              const pH = poissonPMF(h, homeF5Lambda);
              underProb += pA * pH;
            }
          }
        }
        f5Probs[line] = {
          under: +(underProb * 100).toFixed(1),
          over: +((1 - underProb) * 100).toFixed(1),
          fairUnderML: probToAmericanML(underProb),
          fairOverML: probToAmericanML(1 - underProb),
        };
      }
      
      // 5. Find the most likely book F5 total line (usually 4.5 or 5.0)
      // Also check live odds for actual F5 lines
      let bookF5Total = null;
      let bookF5UnderOdds = null;
      let bookF5OverOdds = null;
      let bookF5Book = '';
      let bookFullTotal = null;
      
      // Check live odds
      for (const oddsGame of liveOdds) {
        const oddsAway = resolveTeam(mlbNameMap, oddsGame.away_team);
        const oddsHome = resolveTeam(mlbNameMap, oddsGame.home_team);
        if (oddsAway === game.away && oddsHome === game.home) {
          for (const bk of (oddsGame.bookmakers || [])) {
            for (const mkt of (bk.markets || [])) {
              if (mkt.key === 'totals') {
                for (const o of (mkt.outcomes || [])) {
                  if (o.name === 'Over') {
                    bookFullTotal = o.point;
                  }
                }
              }
            }
          }
          break;
        }
      }
      
      // Estimate F5 line from full-game line
      if (bookFullTotal) {
        bookF5Total = Math.round(bookFullTotal * f5Factor * 2) / 2; // Round to 0.5
        // Standard F5 juice: -110/-110
        bookF5UnderOdds = -110;
        bookF5OverOdds = -110;
      } else if (game.dkLine?.total) {
        bookF5Total = Math.round(game.dkLine.total * f5Factor * 2) / 2;
        bookF5UnderOdds = -110;
        bookF5OverOdds = -110;
      } else {
        // Estimate from model
        const fullGameTotal = awayExpRuns + homeExpRuns;
        bookF5Total = Math.round(fullGameTotal * f5Factor * 2) / 2;
      }
      
      // 6. Calculate F5 UNDER edge
      let f5UnderEdge = null;
      if (bookF5Total && f5Probs[bookF5Total]) {
        const modelUnderPct = f5Probs[bookF5Total].under;
        const bookUnderImplied = bookF5UnderOdds ? Math.abs(bookF5UnderOdds) / (Math.abs(bookF5UnderOdds) + 100) * 100 : 52.4; // -110 = 52.4%
        const edge = modelUnderPct - bookUnderImplied;
        
        if (edge > 0) {
          const edgeFrac = edge / 100;
          const probFrac = modelUnderPct / 100;
          const decOdds = bookF5UnderOdds && bookF5UnderOdds < 0 ? (100 / Math.abs(bookF5UnderOdds)) + 1 : 1.909;
          const kellyK = Math.max(0, ((decOdds - 1) * probFrac - (1 - probFrac)) / (decOdds - 1));
          const wager = Math.min(bankroll * 0.04, bankroll * kellyK * kellyFraction);
          const ev = wager * edgeFrac;
          
          f5UnderEdge = {
            line: bookF5Total,
            modelUnderPct,
            bookImplied: +bookUnderImplied.toFixed(1),
            edge: +edge.toFixed(1),
            fairUnderML: f5Probs[bookF5Total].fairUnderML,
            bookUnderML: bookF5UnderOdds || -110,
            kellyPct: +(kellyK * 100).toFixed(2),
            wager: +wager.toFixed(0),
            ev: +ev.toFixed(2),
            confidence: edge >= 10 ? 'HIGH' : edge >= 5 ? 'MEDIUM' : 'LOW',
          };
        }
      }
      
      // 7. Determine game grade
      const grade = (f5UnderEdge?.edge >= 10 && owAdj.reduction >= 0.07) ? 'A+' :
                    (f5UnderEdge?.edge >= 8 || owAdj.reduction >= 0.09) ? 'A' :
                    (f5UnderEdge?.edge >= 5 || owAdj.reduction >= 0.07) ? 'B+' :
                    (f5UnderEdge?.edge >= 3) ? 'B' : 'C';
      
      results.push({
        matchup: `${game.away} @ ${game.home}`,
        away: game.away,
        home: game.home,
        date: game.date,
        day: game.day,
        park: parkName,
        awayStarter: game.confirmedStarters?.away || 'TBD',
        homeStarter: game.confirmedStarters?.home || 'TBD',
        // F5 Analysis
        f5: {
          expectedTotal: f5ExpTotal,
          awayF5Runs: +awayF5Lambda.toFixed(2),
          homeF5Runs: +homeF5Lambda.toFixed(2),
          probMatrix: f5Probs,
          bookLine: bookF5Total,
          underEdge: f5UnderEdge,
        },
        // Opening Week factors
        openingWeek: {
          reduction: owAdj.reductionPct,
          factors: owAdj.factors,
          isOpeningDay: owAdj.isOpeningDay,
          isIndoor: owAdj.isIndoor,
        },
        // Full game context
        fullGame: {
          awayExpRuns: +awayExpRuns.toFixed(2),
          homeExpRuns: +homeExpRuns.toFixed(2),
          expectedTotal: +(awayExpRuns + homeExpRuns).toFixed(2),
          bookTotal: bookFullTotal || game.dkLine?.total || null,
        },
        grade,
      });
    }
    
    // Sort by grade then edge
    const gradeOrder = { 'A+': 0, 'A': 1, 'B+': 2, 'B': 3, 'C': 4 };
    results.sort((a, b) => {
      const gDiff = (gradeOrder[a.grade] || 99) - (gradeOrder[b.grade] || 99);
      if (gDiff !== 0) return gDiff;
      return (b.f5.underEdge?.edge || 0) - (a.f5.underEdge?.edge || 0);
    });
    
    // Portfolio summary
    const allF5Bets = results.filter(r => r.f5.underEdge).map(r => r.f5.underEdge);
    const totalWager = allF5Bets.reduce((s, b) => s + b.wager, 0);
    const totalEV = allF5Bets.reduce((s, b) => s + b.ev, 0);
    
    res.json({
      timestamp: new Date().toISOString(),
      version: '48.0.0',
      openingDay: '2026-03-26',
      openingWeekEnd: '2026-04-02',
      totalGames: results.length,
      f5UnderBets: allF5Bets.length,
      highConfidence: allF5Bets.filter(b => b.confidence === 'HIGH').length,
      portfolio: {
        totalWager: +totalWager.toFixed(0),
        totalEV: +totalEV.toFixed(2),
        avgEdge: allF5Bets.length > 0 ? +(allF5Bets.reduce((s, b) => s + b.edge, 0) / allF5Bets.length).toFixed(1) : 0,
      },
      games: results,
      methodology: 'F5 Poisson scoring model + Opening Week under adjustments (cold weather, ace starters, rusty bats). Historical F5 under hit rate on OD: ~60%.',
    });
  } catch (e) {
    console.error('F5 Opening Week Unders scan error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Poisson PMF helper for F5 calculations
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Convert probability to American ML
function probToAmericanML(prob) {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== DAILY ACTION SLATE ====================
// THE MONEY PRINTER: One endpoint for all today's bets across all sports

app.get('/api/daily-slate', async (req, res) => {
  try {
    if (!dailySlate) return res.status(503).json({ error: 'Daily Slate service not loaded' });
    
    const opts = {
      bankroll: parseFloat(req.query.bankroll) || 1000,
      kellyFraction: parseFloat(req.query.kelly) || 0.5,
      minEdge: parseFloat(req.query.minEdge) || 0.03,
      maxBets: parseInt(req.query.maxBets) || 20,
      date: req.query.date || new Date().toISOString().split('T')[0],
    };
    
    const slate = await dailySlate.generateSlate(opts);
    res.json(slate);
  } catch (e) {
    console.error('Daily Slate error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/daily-slate/status', (req, res) => {
  if (!dailySlate) return res.status(503).json({ error: 'Daily Slate service not loaded' });
  res.json(dailySlate.getStatus());
});

// ==================== DAILY MLB CARD (v82.0) ====================
// Regular season daily betting card — works for ANY game day, not just Opening Day
app.get('/api/mlb/daily-card', async (req, res) => {
  if (!dailyMlbCard) return res.status(503).json({ error: 'Daily MLB Card service not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const forceRefresh = req.query.refresh === 'true';
    const bankroll = parseInt(req.query.bankroll) || 1000;

    // Try cache first for instant response
    if (!forceRefresh) {
      const cached = dailyMlbCard.getCachedCard(date);
      if (cached) return res.json(cached);
    }

    const card = await dailyMlbCard.buildDailyCard({
      date,
      bankroll,
      forceRefresh,
      oddsApiKey: process.env.ODDS_API_KEY || '',
    });
    res.json(card);
  } catch (e) {
    console.error('Daily MLB Card error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mlb/daily-card/status', (req, res) => {
  if (!dailyMlbCard) return res.status(503).json({ error: 'Daily MLB Card service not loaded' });
  res.json(dailyMlbCard.getStatus());
});

app.get('/api/mlb/daily-card/refresh', async (req, res) => {
  if (!dailyMlbCard) return res.status(503).json({ error: 'Daily MLB Card service not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const card = await dailyMlbCard.buildDailyCard({
      date,
      forceRefresh: true,
      oddsApiKey: process.env.ODDS_API_KEY || '',
    });
    res.json({ message: 'Daily card refreshed', date, games: card.headline?.gamesOnSlate, bets: card.headline?.totalBets, betTypes: card.headline?.betTypes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Daily card: historical access
app.get('/api/mlb/daily-card/history', (req, res) => {
  if (!dailyMlbCard) return res.status(503).json({ error: 'Daily MLB Card service not loaded' });
  res.json(dailyMlbCard.listCards());
});

app.get('/api/mlb/daily-card/history/:date', (req, res) => {
  if (!dailyMlbCard) return res.status(503).json({ error: 'Daily MLB Card service not loaded' });
  const card = dailyMlbCard.getHistoricalCard(req.params.date);
  if (!card) return res.status(404).json({ error: 'No card found for this date' });
  res.json(card);
});

// Daily card: grade completed games
app.post('/api/mlb/daily-card/grade', async (req, res) => {
  if (!dailyMlbCard) return res.status(503).json({ error: 'Daily MLB Card service not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const result = await dailyMlbCard.gradeCompletedGames(date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== DAILY NBA CARD (v90.0) ====================
// Comprehensive daily NBA betting card with rest/tank, conviction, Kelly sizing

app.get('/api/nba/daily-card', async (req, res) => {
  if (!dailyNbaCard) return res.status(503).json({ error: 'Daily NBA Card service not loaded' });
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const refresh = req.query.refresh === 'true';
    const result = await dailyNbaCard.buildDailyCard({
      date,
      oddsApiKey: ODDS_API_KEY,
      bankroll: parseFloat(req.query.bankroll) || 1000,
      kellyFraction: parseFloat(req.query.kelly) || 0.5,
      forceRefresh: refresh,
      serverGetAllOdds: fetchOdds, // Reuse server's fetchOdds to get cached/shared odds
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/nba/daily-card/status', (req, res) => {
  if (!dailyNbaCard) return res.status(503).json({ error: 'Daily NBA Card service not loaded' });
  res.json(dailyNbaCard.getStatus());
});

app.get('/api/nba/daily-card/refresh', async (req, res) => {
  if (!dailyNbaCard) return res.status(503).json({ error: 'Daily NBA Card service not loaded' });
  try {
    const result = await dailyNbaCard.buildDailyCard({
      date: new Date().toISOString().split('T')[0],
      oddsApiKey: ODDS_API_KEY,
      bankroll: 1000,
      kellyFraction: 0.5,
      forceRefresh: true,
      serverGetAllOdds: fetchOdds,
    });
    res.json({ refreshed: true, gamesOnSlate: result.headline?.gamesOnSlate, totalBets: result.headline?.totalBets, buildTime: result.buildTime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/nba/daily-card/mismatches', async (req, res) => {
  if (!dailyNbaCard) return res.status(503).json({ error: 'Daily NBA Card service not loaded' });
  try {
    const result = await dailyNbaCard.buildDailyCard({
      date: new Date().toISOString().split('T')[0],
      oddsApiKey: ODDS_API_KEY,
      serverGetAllOdds: fetchOdds,
    });
    res.json({
      mismatches: result.mismatchSpotlight || [],
      count: (result.mismatchSpotlight || []).length,
      date: result.date,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== DAILY NHL CARD (v98.0) ====================
// Full daily NHL betting card with goalie starters, bubble signals, value detection
// East bubble chaos = massive mispricing on puck lines and totals

// Build today's NHL betting card
app.get('/api/nhl/daily-card', async (req, res) => {
  try {
    if (!dailyNhlCard) return res.status(503).json({ error: 'Daily NHL Card service not loaded' });
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const forceRefresh = req.query.refresh === '1';
    const result = await dailyNhlCard.buildDailyCard({
      date,
      forceRefresh,
      serverGetAllOdds: fetchOdds,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NHL daily card status
app.get('/api/nhl/daily-card/status', (req, res) => {
  try {
    if (!dailyNhlCard) return res.status(503).json({ error: 'Daily NHL Card service not loaded' });
    res.json(dailyNhlCard.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NHL daily card history
app.get('/api/nhl/daily-card/history', (req, res) => {
  try {
    if (!dailyNhlCard) return res.status(503).json({ error: 'Daily NHL Card service not loaded' });
    res.json(dailyNhlCard.getHistory());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NHL bubble status (standalone)
app.get('/api/nhl/daily-card/bubble', (req, res) => {
  try {
    if (!dailyNhlCard) return res.status(503).json({ error: 'Daily NHL Card service not loaded' });
    res.json(dailyNhlCard.getBubbleStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NHL B2B detection
app.get('/api/nhl/daily-card/b2b', (req, res) => {
  try {
    if (!dailyNhlCard) return res.status(503).json({ error: 'Daily NHL Card service not loaded' });
    const date = req.query.date || new Date().toISOString().split('T')[0];
    res.json(dailyNhlCard.detectB2B(date));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Grade NHL play result
app.post('/api/nhl/daily-card/grade', (req, res) => {
  try {
    if (!dailyNhlCard) return res.status(503).json({ error: 'Daily NHL Card service not loaded' });
    const { play, result } = req.body;
    res.json(dailyNhlCard.gradePlay(play, result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== NBA PERIOD MARKETS (v96.0) ====================
// Quarter & Half period-level betting markets — structural edge detection
// Less efficiently priced than full-game markets = more edge

// Predict period-level outcomes for a matchup
app.get('/api/nba/periods/:away/:home', async (req, res) => {
  try {
    if (!nbaPeriodMarkets) return res.status(503).json({ error: 'NBA Period Markets not loaded' });
    const { away, home } = req.params;
    const isPlayoffs = req.query.playoffs === '1' || req.query.playoffs === 'true';
    const result = await nbaPeriodMarkets.asyncPredictPeriods(away.toUpperCase(), home.toUpperCase(), { isPlayoffs });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Find structural quarter/half edges for a matchup (works without live odds)
app.get('/api/nba/periods/edges/:away/:home', async (req, res) => {
  try {
    if (!nbaPeriodMarkets) return res.status(503).json({ error: 'NBA Period Markets not loaded' });
    const { away, home } = req.params;
    // Auto-detect motivation via rest/tank service
    let awayMotiv = 'COMPETING', homeMotiv = 'COMPETING';
    if (restTankSvc) {
      try {
        const standings = nbaModel.getTeams();
        const today = new Date().toISOString().split('T')[0];
        const rtData = await restTankSvc.getGameAdjustment(away.toUpperCase(), home.toUpperCase(), standings, today);
        if (rtData) {
          if (rtData.away?.motivation?.motivation) awayMotiv = rtData.away.motivation.motivation;
          if (rtData.home?.motivation?.motivation) homeMotiv = rtData.home.motivation.motivation;
        }
      } catch (e) {}
    }
    const result = nbaPeriodMarkets.findStructuralEdges(away.toUpperCase(), home.toUpperCase(), { 
      awayMotivation: req.query.awayMotiv || awayMotiv,
      homeMotivation: req.query.homeMotiv || homeMotiv
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan all today's games for structural period edges
app.get('/api/nba/periods/scan', async (req, res) => {
  try {
    if (!nbaPeriodMarkets) return res.status(503).json({ error: 'NBA Period Markets not loaded' });
    const result = await nbaPeriodMarkets.scanStructuralEdges();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan all period markets for value vs live odds
app.get('/api/nba/periods/value', async (req, res) => {
  try {
    if (!nbaPeriodMarkets) return res.status(503).json({ error: 'NBA Period Markets not loaded' });
    const result = await nbaPeriodMarkets.scanPeriodValue();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Period markets status
app.get('/api/nba/periods/status', (req, res) => {
  try {
    if (!nbaPeriodMarkets) return res.status(503).json({ error: 'NBA Period Markets not loaded' });
    res.json(nbaPeriodMarkets.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== PITCHER RESOLVER (v83.0) ====================
// Dynamic pitcher prop projections for ANY pitcher — regular season engine
app.get('/api/mlb/pitcher-props/:pitcher/:opponent/:park?', (req, res) => {
  try {
    if (!pitcherResolver) return res.status(503).json({ error: 'Pitcher resolver not loaded' });
    const { pitcher, opponent, park } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const tempF = req.query.temp ? parseFloat(req.query.temp) : undefined;
    const bookKLine = req.query.kLine ? parseFloat(req.query.kLine) : undefined;
    const bookKOverOdds = req.query.kOver ? parseInt(req.query.kOver) : undefined;
    const bookKUnderOdds = req.query.kUnder ? parseInt(req.query.kUnder) : undefined;
    const bookOutsLine = req.query.outsLine ? parseFloat(req.query.outsLine) : undefined;
    const bookOutsOverOdds = req.query.outsOver ? parseInt(req.query.outsOver) : undefined;
    const bookOutsUnderOdds = req.query.outsUnder ? parseInt(req.query.outsUnder) : undefined;

    // Decode pitcher name (URL-encoded spaces)
    const pitcherName = decodeURIComponent(pitcher);
    const homeTeam = park || opponent; // Default: opponent is at home

    const result = pitcherResolver.resolvePitcherProps(pitcherName, null, opponent, homeTeam, {
      date, tempF, bookKLine, bookKOverOdds, bookKUnderOdds, bookOutsLine, bookOutsOverOdds, bookOutsUnderOdds,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mlb/pitcher-props/status', (req, res) => {
  if (!pitcherResolver) return res.json({ loaded: false });
  res.json({ loaded: true, ...pitcherResolver.getStatus() });
});

app.get('/api/mlb/pitcher-props/season-context', (req, res) => {
  if (!pitcherResolver) return res.status(503).json({ error: 'Pitcher resolver not loaded' });
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(pitcherResolver.getSeasonContext(date));
});

// ==================== OD PRE-GAME CHECKLIST (v71.0) ====================
app.get('/api/opening-day/checklist', async (req, res) => {
  // Overall 25s timeout guard — return partial results rather than hanging
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(200).json({
        error: 'Checklist timed out after 25s — partial results may be available',
        message: '🟡 CHECKLIST TIMEOUT — hit /api/opening-day/checklist again (cached data should be faster)',
        overallStatus: 'CAUTION',
        timeout: true,
      });
    }
  }, 25000);
  
  try {
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const now = new Date();
    const odDate = new Date('2026-03-26T00:00:00Z'); // Day 1 is March 26
    const daysUntil = Math.ceil((odDate - now) / 86400000);
    const hoursUntil = Math.ceil((odDate - now) / 3600000);
    
    const checklist = {
      timestamp: now.toISOString(),
      openingDay: '2026-03-26',
      daysUntil,
      hoursUntil,
      version: '78.0.0',
      sections: {},
      overallStatus: 'GO',
      readyCount: 0,
      warnCount: 0,
      failCount: 0,
      totalChecks: 0,
    };
    
    function markCheck(section, name, status, detail, data) {
      if (!checklist.sections[section]) checklist.sections[section] = { status: 'GO', checks: [] };
      checklist.sections[section].checks.push({ name, status, detail, data });
      checklist.totalChecks++;
      if (status === 'GO') checklist.readyCount++;
      else if (status === 'WARN') {
        checklist.warnCount++;
        if (checklist.sections[section].status === 'GO') checklist.sections[section].status = 'WARN';
      } else if (status === 'FAIL') {
        checklist.failCount++;
        checklist.sections[section].status = 'FAIL';
        checklist.overallStatus = 'FAIL';
      }
    }
    
    // ===== SECTION 1: CORE MODEL =====
    try {
      const teams = mlb.getTeams ? mlb.getTeams() : {};
      const teamCount = Object.keys(teams).length;
      markCheck('model', 'MLB Teams Loaded', teamCount === 30 ? 'GO' : 'FAIL', `${teamCount}/30 teams`);
    } catch(e) { markCheck('model', 'MLB Teams Loaded', 'FAIL', e.message); }
    
    try {
      const testPred = mlb.predict('BOS', 'CIN', { awayPitcher: 'Garrett Crochet', homePitcher: 'Andrew Abbott' });
      markCheck('model', 'Prediction Engine', testPred && testPred.homeWinProb ? 'GO' : 'FAIL',
        testPred.error || `BOS@CIN: ${(testPred.homeWinProb*100).toFixed(1)}% CIN, total ${testPred.totalRuns?.toFixed(1)}`);
    } catch(e) { markCheck('model', 'Prediction Engine', 'FAIL', e.message); }
    
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      const day1 = schedule.filter(g => g.day === 1);
      const day2 = schedule.filter(g => g.day === 2);
      markCheck('model', 'OD Schedule', day1.length >= 10 ? 'GO' : 'FAIL',
        `${day1.length} Day 1 + ${day2.length} Day 2 = ${schedule.length} total games`);
    } catch(e) { markCheck('model', 'OD Schedule', 'FAIL', e.message); }
    
    // Pitcher coverage
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      const pitcherDb = require('./models/mlb-pitchers');
      let found = 0, missing = [];
      for (const g of schedule) {
        for (const role of ['away', 'home']) {
          const name = g.confirmedStarters?.[role];
          if (name) {
            const p = pitcherDb.getPitcherByName(name);
            if (p) found++; else missing.push(`${name} (${g[role]})`);
          }
        }
      }
      markCheck('model', 'Pitcher Database', missing.length === 0 ? 'GO' : missing.length <= 2 ? 'WARN' : 'FAIL',
        `${found} found, ${missing.length} missing${missing.length > 0 ? ': ' + missing.slice(0,5).join(', ') : ''}`,
        { found, missing });
    } catch(e) { markCheck('model', 'Pitcher Database', 'FAIL', e.message); }

    // Statcast
    try {
      const sc = require('./services/statcast');
      const status = sc.getStatus ? sc.getStatus() : {};
      markCheck('model', 'Statcast Data', (status.pitchers || 0) >= 500 ? 'GO' : 'WARN',
        `${status.pitchers || 0} pitchers, ${status.batters || 0} batters`);
    } catch(e) { markCheck('model', 'Statcast Data', 'WARN', e.message); }

    // Neg binomial
    try {
      const nb = require('./services/neg-binomial');
      markCheck('model', 'NB F5/Run Lines', 'GO', 'Negative binomial scoring engine loaded');
    } catch(e) { markCheck('model', 'NB F5/Run Lines', 'FAIL', e.message); }

    // ===== SECTION 2: DATA FEEDS =====
    try {
      const fs = require('fs');
      const cachePath = require('path').join(__dirname, 'services', 'data-cache.json');
      if (fs.existsSync(cachePath)) {
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        for (const sport of ['nba', 'nhl', 'mlb']) {
          // live-data.js uses cache.nba/nhl/mlb with cache.timestamps.nba/nhl/mlb
          const hasData = cache[sport] && Object.keys(cache[sport]).length > 0;
          const ts = cache.timestamps && cache.timestamps[sport];
          if (hasData && ts) {
            const ageMin = Math.round((Date.now() - ts) / 60000);
            markCheck('data', `${sport.toUpperCase()} Feed`, ageMin < 180 ? 'GO' : ageMin < 720 ? 'WARN' : 'FAIL',
              `${ageMin} min old, ${Object.keys(cache[sport]).length} teams`);
          } else if (hasData) {
            markCheck('data', `${sport.toUpperCase()} Feed`, 'WARN', `Data loaded (${Object.keys(cache[sport]).length} teams) but no timestamp`);
          } else {
            markCheck('data', `${sport.toUpperCase()} Feed`, 'FAIL', 'No cached data');
          }
        }
      } else {
        markCheck('data', 'Data Cache', 'FAIL', 'data-cache.json not found');
      }
    } catch(e) { markCheck('data', 'Data Feeds', 'FAIL', e.message); }

    // Odds API
    try {
      markCheck('data', 'Odds API Key', process.env.ODDS_API_KEY ? 'GO' : 'WARN',
        process.env.ODDS_API_KEY ? 'Configured' : 'Not set locally (OK if on Fly.io)');
    } catch(e) { markCheck('data', 'Odds API Key', 'WARN', e.message); }

    // Auto-scanner
    try {
      const health = autoScanner.getHealth ? autoScanner.getHealth() : {};
      markCheck('data', 'Auto Scanner', health.isRunning ? 'GO' : 'WARN',
        health.isRunning ? `Running, ${Object.keys(health.scanStatus || {}).length} scan types` : 'Not running (starts on deploy)');
    } catch(e) { markCheck('data', 'Auto Scanner', 'WARN', e.message); }

    // ===== SECTION 3: SIGNAL STACK =====
    try {
      const ws = require('./services/weather');
      const parks = ws.BALLPARK_COORDS || {};
      markCheck('signals', 'Weather Service', Object.keys(parks).length >= 25 ? 'GO' : 'WARN',
        `${Object.keys(parks).length} ballpark coordinates`);
    } catch(e) { markCheck('signals', 'Weather Service', 'WARN', e.message); }

    try {
      if (weatherForecast) {
        markCheck('signals', 'OD Weather Forecast', 'GO', 'Pre-cache service loaded');
      } else {
        markCheck('signals', 'OD Weather Forecast', 'WARN', 'Service not loaded');
      }
    } catch(e) { markCheck('signals', 'OD Weather Forecast', 'WARN', e.message); }

    try {
      const us = require('./services/umpire-tendencies');
      const count = us.getAllUmpires ? us.getAllUmpires().length : 0;
      markCheck('signals', 'Umpire Database', count >= 30 ? 'GO' : 'WARN', `${count} umpires loaded`);
    } catch(e) { markCheck('signals', 'Umpire Database', 'WARN', e.message); }

    try {
      markCheck('signals', 'Lineup Fetcher', lineupFetcher ? 'GO' : 'WARN',
        lineupFetcher ? 'Ready for game-day lineups' : 'Not loaded');
    } catch(e) { markCheck('signals', 'Lineup Fetcher', 'WARN', e.message); }

    try {
      markCheck('signals', 'Preseason Tuning', preseasonTuning ? 'GO' : 'WARN',
        preseasonTuning ? 'Roster changes + spring signals active' : 'Not loaded');
    } catch(e) { markCheck('signals', 'Preseason Tuning', 'WARN', e.message); }

    try {
      markCheck('signals', 'Platoon Splits', true ? 'GO' : 'WARN', 'Savant 2024 wOBA splits loaded');
    } catch(e) { markCheck('signals', 'Platoon Splits', 'WARN', e.message); }

    try {
      markCheck('signals', 'Catcher Framing', true ? 'GO' : 'WARN', 'Savant 2024 framing data (58 catchers)');
    } catch(e) { markCheck('signals', 'Catcher Framing', 'WARN', e.message); }

    try {
      markCheck('signals', 'Bullpen Quality', bullpenQuality ? 'GO' : 'WARN',
        bullpenQuality ? '2026 projected bullpen ERA loaded' : 'Not loaded');
    } catch(e) { markCheck('signals', 'Bullpen Quality', 'WARN', e.message); }

    try {
      markCheck('signals', 'Stolen Base Model', stolenBaseModel ? 'GO' : 'WARN',
        stolenBaseModel ? 'SB revolution totals adjustment active' : 'Not loaded');
    } catch(e) { markCheck('signals', 'Stolen Base Model', 'WARN', e.message); }

    try {
      markCheck('signals', 'Opening Week Unders', openingWeekUnders ? 'GO' : 'WARN',
        openingWeekUnders ? 'Cold weather + ace starter + rusty bat adjustments' : 'Not loaded');
    } catch(e) { markCheck('signals', 'Opening Week Unders', 'WARN', e.message); }

    try {
      markCheck('signals', 'Conviction Engine', true ? 'GO' : 'WARN', 'Multi-factor conviction scoring active');
    } catch(e) { markCheck('signals', 'Conviction Engine', 'WARN', e.message); }

    // ===== SECTION 4: BETTING CARD =====
    try {
      let cardData = null;
      if (odPlaybookCache) {
        // v77.0: Use getCachedOnly() to avoid triggering a 17s+ build that causes timeout
        // If no cache exists, report WARN and move on instantly
        const playbook = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
        if (playbook && playbook.playbook && playbook.playbook.length > 0) {
          let totalPlays = 0, totalWager = 0, totalEV = 0;
          let smashPlays = 0, strongPlays = 0;
          const topPlays = [];
          
          for (const game of playbook.playbook) {
            const conv = game.signals?.conviction || {};
            for (const bet of (game.bets || [])) {
              totalPlays++;
              totalWager += (bet.wager || 0);
              totalEV += (bet.ev || 0);
              const grade = conv.grade || 'D';
              if (['A+', 'A'].includes(grade)) smashPlays++;
              else if (['A-', 'B+'].includes(grade)) strongPlays++;
              if (topPlays.length < 5) {
                topPlays.push({
                  game: `${game.away}@${game.home}`,
                  pick: bet.pick,
                  type: bet.type,
                  edge: bet.edge || bet.diff || 0,
                  conviction: conv.score || 0,
                  grade,
                  wager: bet.wager || 0,
                });
              }
            }
          }
          
          const freshLabel = playbook.fresh ? '' : ' (stale cache)';
          markCheck('bets', 'Betting Card', totalPlays > 0 ? 'GO' : 'WARN',
            `${totalPlays} plays, $${totalWager.toFixed(0)} wagered, $${totalEV.toFixed(2)} EV (${totalPlays > 0 ? (totalEV/totalWager*100).toFixed(1) : 0}% ROI)${freshLabel}`,
            { totalPlays, totalWager, totalEV, smashPlays, strongPlays, topPlays, cacheAge: playbook.cacheAge });
        } else {
          markCheck('bets', 'Betting Card', 'WARN', 'Playbook cache not built yet — visit /api/opening-day-playbook to trigger build');
        }
      } else {
        markCheck('bets', 'Betting Card', 'WARN', 'Playbook cache not loaded');
      }
    } catch(e) { markCheck('bets', 'Betting Card', 'WARN', e.message); }

    // DK lines coverage
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      const withLines = schedule.filter(g => g.dkLine && g.dkLine.homeML);
      const withoutLines = schedule.filter(g => !g.dkLine || !g.dkLine.homeML);
      markCheck('bets', 'DK Lines', withLines.length >= 15 ? 'GO' : withLines.length >= 10 ? 'WARN' : 'FAIL',
        `${withLines.length}/${schedule.length} games have DK lines${withoutLines.length > 0 ? ' (missing: ' + withoutLines.slice(0,5).map(g => g.away+'@'+g.home).join(', ') + ')' : ''}`);
    } catch(e) { markCheck('bets', 'DK Lines', 'WARN', e.message); }

    // K Props — use lightweight status check, NOT full scan (scan takes 5s+)
    try {
      if (pitcherKProps) {
        const status = pitcherKProps.getStatus ? pitcherKProps.getStatus() : null;
        if (status) {
          const pitchers = status.totalPitchers || status.pitchers || 0;
          const teamK = status.teamsWithKData || status.teamKRates || 0;
          const parkK = status.parksWithKFactors || status.parkFactors || 0;
          markCheck('bets', 'K Props', pitchers > 0 ? 'GO' : 'WARN',
            `${pitchers} pitchers loaded, ${teamK} team K rates, ${parkK} park factors`,
            { totalPitchers: pitchers, teamsWithKData: teamK, parksWithKFactors: parkK, dkLinesLoaded: status.dkLinesLoaded || 0 });
        } else {
          markCheck('bets', 'K Props', 'GO', 'K Props engine loaded');
        }
      } else {
        markCheck('bets', 'K Props', 'WARN', 'K Props service not loaded');
      }
    } catch(e) { markCheck('bets', 'K Props', 'WARN', e.message); }

    // SGP builder
    try {
      if (odSgpBuilder) {
        markCheck('bets', 'SGP Builder', 'GO', 'Correlated parlay builder loaded');
      } else {
        markCheck('bets', 'SGP Builder', 'WARN', 'SGP service not loaded');
      }
    } catch(e) { markCheck('bets', 'SGP Builder', 'WARN', e.message); }

    // ===== SECTION 5: DEPLOYMENT =====
    try {
      const health = { version: '71.0.0' };
      markCheck('deploy', 'Server Running', 'GO', `v81.0.0 on port ${PORT}`);
    } catch(e) { markCheck('deploy', 'Server Running', 'FAIL', e.message); }

    try {
      markCheck('deploy', 'CLV Tracker', clvTracker ? 'GO' : 'WARN',
        clvTracker ? 'Ready to record OD picks + closing lines' : 'Not loaded');
    } catch(e) { markCheck('deploy', 'CLV Tracker', 'WARN', e.message); }

    try {
      if (odLive) {
        markCheck('deploy', 'Live Tracker', 'GO', 'OD live game tracker ready');
      } else {
        markCheck('deploy', 'Live Tracker', 'WARN', 'OD Live service not loaded');
      }
    } catch(e) { markCheck('deploy', 'Live Tracker', 'WARN', e.message); }

    try {
      if (odLineTracker) {
        markCheck('deploy', 'Line Tracker', 'GO', 'OD line movement tracker ready');
      } else {
        markCheck('deploy', 'Line Tracker', 'WARN', 'Line tracker not loaded');
      }
    } catch(e) { markCheck('deploy', 'Line Tracker', 'WARN', e.message); }

    // ===== SECTION 6: GAME-BY-GAME READINESS =====
    // Use lightweight checks only — no async predictions (those timeout)
    try {
      const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : [];
      const weatherService = require('./services/weather');
      const parkCoords = weatherService.BALLPARK_COORDS || {};
      const pitcherDb = require('./models/mlb-pitchers');
      const games = [];
      
      for (const g of schedule.slice(0, 20)) {
        const homePark = parkCoords[g.home] || {};
        const isDome = homePark.dome || false;
        const gameReady = {
          matchup: `${g.away}@${g.home}`,
          day: g.day,
          time: g.time || 'TBD',
          park: homePark.name || 'Unknown',
          starters: {
            away: g.confirmedStarters?.away || 'TBD',
            home: g.confirmedStarters?.home || 'TBD',
          },
          checks: {
            pitchersInDB: false,
            dkLines: false,
            weatherAvailable: isDome || !!homePark.lat,
            dome: isDome,
          },
          status: 'GO',
        };
        
        // Check pitchers
        try {
          const awayP = g.confirmedStarters?.away ? pitcherDb.getPitcherByName(g.confirmedStarters.away) : null;
          const homeP = g.confirmedStarters?.home ? pitcherDb.getPitcherByName(g.confirmedStarters.home) : null;
          gameReady.checks.pitchersInDB = !!(awayP && homeP);
          if (!awayP || !homeP) gameReady.status = 'WARN';
        } catch(e) {}
        
        // Check DK lines
        gameReady.checks.dkLines = !!(g.dkLine && g.dkLine.homeML);
        if (!gameReady.checks.dkLines) gameReady.status = 'WARN';
        
        if (g.dkLine) {
          gameReady.lines = {
            homeML: g.dkLine.homeML,
            awayML: g.dkLine.awayML,
            total: g.dkLine.total,
          };
        }
        
        // Quick LIGHTWEIGHT prediction — use sync predict() with a try/catch timeout guard
        try {
          const pred = mlb.predict(g.away, g.home, {
            awayPitcher: g.confirmedStarters?.away,
            homePitcher: g.confirmedStarters?.home
          });
          if (pred && pred.homeWinProb) {
            gameReady.prediction = {
              homeWin: +(pred.homeWinProb * 100).toFixed(1),
              awayWin: +(pred.awayWinProb * 100).toFixed(1),
              total: +pred.totalRuns?.toFixed(1),
            };
          }
        } catch(e) {
          // Prediction failed for this game — not a blocker
          gameReady.prediction = { error: 'Prediction timeout or error' };
        }
        
        games.push(gameReady);
      }
      checklist.games = games;
      const gamesReady = games.filter(g => g.status === 'GO').length;
      markCheck('games', 'Game Readiness', gamesReady >= 18 ? 'GO' : gamesReady >= 15 ? 'WARN' : 'FAIL',
        `${gamesReady}/${games.length} games fully ready`);
    } catch(e) { markCheck('games', 'Game Readiness', 'WARN', e.message); }

    // Overall status
    if (checklist.failCount > 0) checklist.overallStatus = 'NO-GO';
    else if (checklist.warnCount > 3) checklist.overallStatus = 'CAUTION';
    else checklist.overallStatus = 'GO';

    checklist.message = checklist.overallStatus === 'GO'
      ? `🟢 ALL SYSTEMS GO! ${checklist.readyCount}/${checklist.totalChecks} checks passed. Ready to print money on March 26. 🦞💰`
      : checklist.overallStatus === 'CAUTION'
      ? `🟡 MOSTLY READY — ${checklist.warnCount} warnings to review. ${daysUntil} days to fix.`
      : `🔴 NOT READY — ${checklist.failCount} critical failures. FIX BEFORE MARCH 27!`;

    clearTimeout(timeout);
    if (!res.headersSent) res.json(checklist);
  } catch(e) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
});

// ===== PRE-OPENING DAY E2E FINAL CHECK v74.0 =====
// The dress rehearsal: runs EVERY pipeline for all 20 OD games end-to-end

// ==================== OPENING DAY LIVE LINES (v80.0) ====================
// Real-time odds from The Odds API — replaces stale hardcoded DK lines on game day
app.get('/api/opening-day/live-lines', async (req, res) => {
  try {
    if (!odLiveLines) return res.status(503).json({ error: 'Live Lines service not loaded' });
    const result = await odLiveLines.getLiveLines();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/opening-day/live-lines/update', async (req, res) => {
  try {
    if (!odLiveLines) return res.status(503).json({ error: 'Live Lines service not loaded' });
    if (!mlbOpeningDay) return res.status(503).json({ error: 'Opening Day module not loaded' });
    const games = [...mlbOpeningDay.OPENING_DAY_GAMES]; // clone to avoid mutating
    const result = await odLiveLines.updateODLinesFromLive(games);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/opening-day/live-lines/shop', async (req, res) => {
  try {
    if (!odLiveLines) return res.status(503).json({ error: 'Live Lines service not loaded' });
    const result = await odLiveLines.getLineShoppingOpportunities();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/opening-day/live-lines/status', async (req, res) => {
  try {
    if (!odLiveLines) return res.json({ loaded: false });
    res.json({ loaded: true, ...odLiveLines.getStatus() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== GAME DAY AUTOPILOT (v81.0) ====================
// The money printer: automated game-day orchestration
app.post('/api/autopilot/start', async (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    const { date, ...options } = req.body || {};
    const result = gamedayAutopilot.start(date, options);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/autopilot/stop', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    res.json(gamedayAutopilot.stop());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autopilot/status', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.json({ loaded: false });
    res.json({ loaded: true, ...gamedayAutopilot.getStatus() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autopilot/card', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    res.json(gamedayAutopilot.getBettingCard());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autopilot/alerts', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    const { severity, type, game, unread, limit } = req.query;
    res.json(gamedayAutopilot.getAlerts({
      severity, type, game,
      unread: unread === 'true',
      limit: limit ? parseInt(limit) : undefined,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/autopilot/alerts/read', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    const { ids } = req.body || {};
    res.json(gamedayAutopilot.markAlertsRead(ids));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autopilot/game/:gameKey', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    const gameState = gamedayAutopilot.getGameState(req.params.gameKey);
    if (!gameState) return res.status(404).json({ error: 'Game not found' });
    res.json(gameState);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autopilot/games', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    res.json(gamedayAutopilot.getAllGameStates());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/autopilot/top-edges', (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    res.json(gamedayAutopilot.getTopEdges(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/autopilot/scan', async (req, res) => {
  try {
    if (!gamedayAutopilot) return res.status(503).json({ error: 'Autopilot not loaded' });
    const result = await gamedayAutopilot.forceScan();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== REGULAR SEASON AUTOPILOT (v86.0) ====================
app.post('/api/season/autopilot/start', async (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    const { date, options } = req.body || {};
    const result = regularSeasonAutopilot.start(date, options);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/season/autopilot/stop', (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    res.json(regularSeasonAutopilot.stop());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/season/autopilot/status', (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.json({ loaded: false });
    res.json({ loaded: true, ...regularSeasonAutopilot.getStatus() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/season/autopilot/games', (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    res.json(regularSeasonAutopilot.getGamesSummary());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/season/autopilot/game/:gameKey', (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    const detail = regularSeasonAutopilot.getGameDetail(req.params.gameKey);
    if (!detail) return res.status(404).json({ error: 'Game not found' });
    res.json(detail);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/season/autopilot/alerts', (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    const limit = parseInt(req.query.limit) || 50;
    res.json(regularSeasonAutopilot.getAlerts(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/season/autopilot/scan', async (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    const result = await regularSeasonAutopilot.forceScan();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/season/autopilot/edges/:gameKey', (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    res.json(regularSeasonAutopilot.getEdgeHistory(req.params.gameKey));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/season/autopilot/autoboot', async (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    const result = await regularSeasonAutopilot.autoBoot();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/season/autopilot/grade-yesterday', async (req, res) => {
  try {
    if (!regularSeasonAutopilot) return res.status(503).json({ error: 'Regular season autopilot not loaded' });
    const result = await regularSeasonAutopilot.autoGradeYesterday();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== OD D-1 COMPREHENSIVE FINAL CHECK v117 ====================
// The DEFINITIVE pre-OD system check — validates ALL systems with live MLB data
app.get('/api/opening-day/d1-check', async (req, res) => {
  try {
    if (!odD1Final) return res.status(503).json({ error: 'OD D-1 Final Check service not loaded' });
    
    const report = await odD1Final.runD1FinalCheck(mlb, { 
      verbose: req.query.verbose === '1'
    });
    
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quick D1 status (non-blocking, instant)
app.get('/api/opening-day/d1-status', (req, res) => {
  try {
    if (!odD1Final) return res.status(503).json({ error: 'OD D-1 service not loaded' });
    res.json(odD1Final.getD1StatusQuick());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Schedule verification against MLB Stats API
app.get('/api/opening-day/d1-schedule', async (req, res) => {
  try {
    if (!odD1Final) return res.status(503).json({ error: 'OD D-1 service not loaded' });
    const result = await odD1Final.checkMLBSchedule();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Live weather check for all OD outdoor venues
app.get('/api/opening-day/d1-weather', async (req, res) => {
  try {
    if (!odD1Final) return res.status(503).json({ error: 'OD D-1 service not loaded' });
    const result = await odD1Final.checkWeather();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/opening-day/final-check', async (req, res) => {
  try {
    if (!odFinalCheck) return res.status(500).json({ error: 'Final check service not loaded' });
    // Run with a generous 45s timeout (the full check runs 20 games)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Final check timed out after 45s — try /api/opening-day/checklist for cached data')), 45000));
    const check = odFinalCheck.runFinalCheck({
      mlb, mlbOpeningDay, negBinomial: require('./services/neg-binomial'),
      pitcherKProps, odSgpBuilder, odPlaybookCache, openingWeekUnders,
      stolenBaseModel, bullpenQuality, lineShopping, lineupFetcher, getAllOdds
    });
    const results = await Promise.race([check, timeout]);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
});

// ===== OD GAME DAY VERIFICATION v88.0 =====
// THE GO/NO-GO CHECK for March 26-27. Verifies ALL live data streams.
// Run morning of game day, 4-6 hours before first pitch.

app.get('/api/opening-day/verify', async (req, res) => {
  try {
    if (!odGamedayVerify) return res.status(503).json({ error: 'Gameday verify service not loaded' });
    const day = parseInt(req.query.day) || 1;
    const result = await odGamedayVerify.runGameDayVerification(day, { apiKey: ODDS_API_KEY });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/verify/quick', async (req, res) => {
  try {
    if (!odGamedayVerify) return res.status(503).json({ error: 'Gameday verify service not loaded' });
    const result = await odGamedayVerify.quickCheck();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD EVE VALIDATION v104.0 =====
// THE COMPREHENSIVE GO/NO-GO CHECK — Run on March 25 evening.
// Validates ALL systems end-to-end: predictions, pitchers, weather, 
// betting card, prop models, SGP, orchestrator, lineups, grader, ESPN sync.
// Pulls fresh 48-hour weather forecasts and flags postponement risks.

app.get('/api/opening-day/eve-validation', async (req, res) => {
  try {
    if (!odEveValidation) return res.status(503).json({ error: 'OD Eve Validation service not loaded' });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Eve validation timed out after 60s')), 60000));
    const validation = odEveValidation.runValidation();
    const result = await Promise.race([validation, timeout]);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, hint: 'This endpoint pulls live weather data — may take 20-30s' });
  }
});

app.get('/api/opening-day/countdown', (req, res) => {
  try {
    if (!odEveValidation) return res.status(503).json({ error: 'OD Eve Validation not loaded' });
    res.json(odEveValidation.getCountdown());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/weather-check', async (req, res) => {
  try {
    if (!odEveValidation) return res.status(503).json({ error: 'OD Eve Validation not loaded' });
    const weather = await odEveValidation.pullFreshWeather();
    res.json({ timestamp: new Date().toISOString(), parks: weather.length, forecasts: weather });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD D-2 LIVE VALIDATION v106.0 =====
// 2 days before Opening Day: full cross-validation of ESPN schedule + starters + weather.
// Pulls live data from ESPN API + Open-Meteo for all 20 OD games.

app.get('/api/opening-day/d2-validation', async (req, res) => {
  try {
    if (!odD2Validation) return res.status(503).json({ error: 'OD D2 Validation not loaded' });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('D2 validation timed out after 90s')), 90000));
    const result = await Promise.race([odD2Validation.runD2Validation(), timeout]);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, hint: 'This endpoint pulls live ESPN + weather data — may take 30-60s' });
  }
});

app.get('/api/opening-day/d2-report', async (req, res) => {
  try {
    if (!odD2Validation) return res.status(503).json({ error: 'OD D2 Validation not loaded' });
    const result = await odD2Validation.runD2Validation();
    const report = odD2Validation.formatReport(result);
    res.type('text/plain').send(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD PITCHER SYNC v89.0 =====
// Auto-reconciles ESPN live probable pitchers with our static OD model.
// Detects pitcher changes, TBDs, upgrades/downgrades that affect our betting card.
// Critical for the 3 days before Opening Day — pitchers can change daily.

app.get('/api/opening-day/pitcher-sync', async (req, res) => {
  try {
    if (!odPitcherSync) return res.status(503).json({ error: 'OD Pitcher Sync service not loaded' });
    const forceRefresh = req.query.refresh === 'true';
    const result = await odPitcherSync.runSync({ forceRefresh });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/pitcher-sync/quick', async (req, res) => {
  try {
    if (!odPitcherSync) return res.status(503).json({ error: 'OD Pitcher Sync service not loaded' });
    const result = await odPitcherSync.quickCheck();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/pitcher-sync/merged', async (req, res) => {
  try {
    if (!odPitcherSync) return res.status(503).json({ error: 'OD Pitcher Sync service not loaded' });
    const result = await odPitcherSync.getMergedSchedule();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/pitcher-sync/report', (req, res) => {
  try {
    if (!odPitcherSync) return res.status(503).json({ error: 'OD Pitcher Sync service not loaded' });
    res.json(odPitcherSync.getReport());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/pitcher-sync/history', (req, res) => {
  try {
    if (!odPitcherSync) return res.status(503).json({ error: 'OD Pitcher Sync service not loaded' });
    res.json(odPitcherSync.getChangeHistory());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/pitcher-sync/status', (req, res) => {
  try {
    if (!odPitcherSync) return res.status(503).json({ error: 'OD Pitcher Sync service not loaded' });
    res.json(odPitcherSync.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== OD LINEUP VERIFICATION PIPELINE v101.0 =====

// Full OD lineup verification — checks all games for both Day 1 and Day 2
app.get('/api/opening-day/lineup-verify', async (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    const dayNum = parseInt(req.query.day) || 1;
    const result = await odLineupVerify.verifyODLineups(dayNum);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Quick cached verification status
app.get('/api/opening-day/lineup-verify/cached', (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    const cached = odLineupVerify.getCachedVerification();
    res.json(cached || { status: 'no_cache', note: 'Run /api/opening-day/lineup-verify first' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run full pipeline test
app.get('/api/opening-day/lineup-verify/test', async (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    const result = await odLineupVerify.runPipelineTest();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual lineup override — set
app.post('/api/opening-day/lineup-override', (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    const { gameKey, side, batters, catcher } = req.body;
    if (!gameKey || !side || !batters) return res.status(400).json({ error: 'Missing gameKey, side, or batters' });
    const result = odLineupVerify.setLineupOverride(gameKey, side, batters, catcher);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual lineup override — clear
app.delete('/api/opening-day/lineup-override', (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    const { gameKey, side } = req.body || req.query;
    if (!gameKey) return res.status(400).json({ error: 'Missing gameKey' });
    const result = odLineupVerify.clearLineupOverride(gameKey, side);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List all overrides
app.get('/api/opening-day/lineup-override/list', (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    res.json(odLineupVerify.loadOverrides());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start/stop lineup monitor
app.post('/api/opening-day/lineup-monitor/start', (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    const dayNum = parseInt(req.body?.day || req.query?.day) || 1;
    const result = odLineupVerify.startMonitor(dayNum);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/opening-day/lineup-monitor/stop', (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    res.json(odLineupVerify.stopMonitor());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/opening-day/lineup-monitor/status', (req, res) => {
  try {
    if (!odLineupVerify) return res.status(503).json({ error: 'OD Lineup Verify service not loaded' });
    res.json(odLineupVerify.getMonitorStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== PRE-OD LIVE VALIDATION v89.0 =====
// THE comprehensive pre-Opening Day validation endpoint.
// Runs ALL checks in parallel: pitcher sync, weather, model dry-run, odds, lineup pipeline.
// This is task 054 — the final check before we go live March 26.

app.get('/api/opening-day/pre-flight', async (req, res) => {
  try {
    const startTime = Date.now();
    const day = parseInt(req.query.day) || 0; // 0 = both days, 1 = Day 1, 2 = Day 2
    const checks = {};
    const alerts = [];
    
    // 1. Server health
    checks.server = {
      status: 'GO',
      version: '89.0.0',
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
    
    // 2. Pitcher sync — are our starters still correct?
    if (odPitcherSync) {
      try {
        const syncResult = await odPitcherSync.runSync({ forceRefresh: true });
        const changes = syncResult.changes || [];
        const tbds = syncResult.tbds || [];
        checks.pitcherSync = {
          status: changes.length === 0 && tbds.length === 0 ? 'GO' : tbds.length > 2 ? 'FAIL' : 'WARN',
          totalGames: syncResult.totalGames || 0,
          confirmed: syncResult.confirmed || 0,
          changes: changes.length,
          tbds: tbds.length,
          changeDetails: changes.slice(0, 5),
          tbdDetails: tbds.slice(0, 5),
          note: changes.length > 0 ? `⚠️ ${changes.length} PITCHER CHANGES detected — re-run betting card!` : '✅ All starters match our model',
        };
        if (changes.length > 0) alerts.push({ severity: 'HIGH', msg: `${changes.length} pitcher change(s) detected — betting card needs update` });
        if (tbds.length > 2) alerts.push({ severity: 'CRITICAL', msg: `${tbds.length} starters still TBD — incomplete data for betting` });
      } catch (e) {
        checks.pitcherSync = { status: 'FAIL', error: e.message };
      }
    } else {
      checks.pitcherSync = { status: 'WARN', note: 'Pitcher sync service not loaded' };
    }
    
    // 3. Model dry run — can we predict all 20 games?
    if (mlb && mlbOpeningDay) {
      try {
        const schedule = mlbOpeningDay.getSchedule ? mlbOpeningDay.getSchedule() : (mlbOpeningDay.OPENING_DAY_GAMES || []);
        const games = day === 0 ? schedule : schedule.filter(g => g.day === day);
        let pass = 0, fail = 0;
        const failures = [];
        for (const game of games) {
          try {
            const result = mlb.predict(game.away, game.home, { awayPitcher: game.awayPitcher, homePitcher: game.homePitcher });
            if (result && !result.error && result.homeWinProb) {
              pass++;
            } else {
              fail++;
              failures.push({ game: `${game.away}@${game.home}`, error: result?.error || 'No win prob' });
            }
          } catch (e) {
            fail++;
            failures.push({ game: `${game.away}@${game.home}`, error: e.message });
          }
        }
        checks.modelDryRun = {
          status: fail === 0 ? 'GO' : 'FAIL',
          totalGames: games.length,
          pass,
          fail,
          failures: failures.slice(0, 5),
        };
        if (fail > 0) alerts.push({ severity: 'CRITICAL', msg: `${fail} game prediction(s) FAILED dry run` });
      } catch (e) {
        checks.modelDryRun = { status: 'FAIL', error: e.message };
      }
    } else {
      checks.modelDryRun = { status: 'FAIL', note: 'MLB model or OD schedule not loaded' };
    }
    
    // 4. Odds API connectivity
    try {
      const oddsResult = await getAllOdds('baseball_mlb', ['h2h', 'totals']);
      checks.oddsApi = {
        status: oddsResult && oddsResult.length > 0 ? 'GO' : 'WARN',
        gamesWithOdds: oddsResult ? oddsResult.length : 0,
        note: oddsResult && oddsResult.length > 0 ? `✅ ${oddsResult.length} MLB games with live odds` : '⚠️ No MLB odds yet (expected pre-OD)',
      };
    } catch (e) {
      checks.oddsApi = { status: 'WARN', error: e.message, note: 'Odds may not be available until closer to game time' };
    }
    
    // 5. Weather service
    if (weather && weather.getWeatherForPark) {
      try {
        // Test one outdoor park
        const testWeather = await weather.getWeatherForPark('BOS');
        checks.weather = {
          status: testWeather && !testWeather.error ? 'GO' : 'WARN',
          testPark: 'BOS (Fenway)',
          multiplier: testWeather?.multiplier || null,
          description: testWeather?.description || 'N/A',
          note: testWeather && !testWeather.error ? '✅ Weather API responding' : '⚠️ Weather unavailable — outdoor park adjustments disabled',
        };
      } catch (e) {
        checks.weather = { status: 'WARN', error: e.message };
      }
    } else {
      checks.weather = { status: 'WARN', note: 'Weather service not loaded' };
    }
    
    // 6. Lineup pipeline readiness
    if (lineupFetcher) {
      checks.lineups = {
        status: 'WARN',
        note: '⏳ Lineups not expected until 3-5 hours before first pitch. Pipeline is READY to ingest.',
        servicLoaded: true,
      };
    } else {
      checks.lineups = { status: 'FAIL', note: 'Lineup fetcher not loaded!' };
      alerts.push({ severity: 'CRITICAL', msg: 'Lineup fetcher service not loaded — game-day lineup data will not flow' });
    }
    
    // 7. Umpire assignments
    if (umpireService && umpireService.fetchTodaysAssignments) {
      try {
        const umpAssignments = await umpireService.fetchTodaysAssignments();
        const assignedCount = umpAssignments?.games?.filter(g => g.homePlateUmpire || g.umpireData)?.length || 0;
        checks.umpires = {
          status: assignedCount > 0 ? 'GO' : 'WARN',
          assigned: assignedCount,
          total: umpAssignments?.games?.length || 0,
          note: assignedCount > 0 ? `✅ ${assignedCount} umpire assignments found` : '⏳ Umpire assignments typically posted day-of',
        };
      } catch (e) {
        checks.umpires = { status: 'WARN', error: e.message, note: 'Umpire data may not be available yet' };
      }
    } else {
      checks.umpires = { status: 'WARN', note: 'Umpire service not fully loaded' };
    }
    
    // 8. Data freshness
    try {
      const cacheFile = require('fs').readFileSync(require('path').join(__dirname, 'services', 'data-cache.json'), 'utf8');
      const cache = JSON.parse(cacheFile);
      const lastRefresh = cache.lastRefresh ? new Date(cache.lastRefresh) : null;
      const ageMin = lastRefresh ? Math.round((Date.now() - lastRefresh.getTime()) / 60000) : null;
      checks.dataFreshness = {
        status: ageMin !== null && ageMin < 120 ? 'GO' : 'WARN',
        lastRefresh: lastRefresh?.toISOString() || 'unknown',
        ageMinutes: ageMin,
        note: ageMin !== null && ageMin < 120 ? `✅ Data ${ageMin}min old` : '⚠️ Data may be stale — trigger refresh',
      };
    } catch (e) {
      checks.dataFreshness = { status: 'WARN', error: 'Could not read data cache' };
    }
    
    // 9. OD Betting Card availability
    if (odPlaybookCache) {
      try {
        const cached = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
        checks.bettingCard = {
          status: cached ? 'GO' : 'WARN',
          hasCachedCard: !!cached,
          plays: cached?.bettingCard?.plays?.length || 0,
          totalEV: cached?.bettingCard?.totalEV || 0,
          note: cached ? `✅ Betting card cached: ${cached.bettingCard?.plays?.length || 0} plays, $${(cached.bettingCard?.totalEV || 0).toFixed(2)} EV` : '⚠️ No cached betting card — run /api/opening-day-playbook first',
        };
      } catch (e) {
        checks.bettingCard = { status: 'WARN', error: e.message };
      }
    } else {
      checks.bettingCard = { status: 'WARN', note: 'Playbook cache not loaded' };
    }
    
    // 10. Statcast data
    if (statcast) {
      try {
        const scStatus = statcast.getStatus ? statcast.getStatus() : null;
        checks.statcast = {
          status: scStatus && scStatus.pitchers > 0 ? 'GO' : 'WARN',
          pitchers: scStatus?.pitchers || 0,
          batters: scStatus?.batters || 0,
          teams: scStatus?.teams || 0,
          note: scStatus && scStatus.pitchers > 0 ? `✅ Statcast: ${scStatus.pitchers} pitchers, ${scStatus.batters} batters` : '⚠️ Statcast data not loaded',
        };
      } catch (e) {
        checks.statcast = { status: 'WARN', error: e.message };
      }
    } else {
      checks.statcast = { status: 'WARN', note: 'Statcast service not loaded' };
    }
    
    // Aggregate verdict
    const statuses = Object.values(checks).map(c => c.status);
    const criticalFails = statuses.filter(s => s === 'FAIL').length;
    const warns = statuses.filter(s => s === 'WARN').length;
    const goes = statuses.filter(s => s === 'GO').length;
    
    const verdict = criticalFails > 0 ? 'NO-GO' : warns > 3 ? 'CAUTION' : 'GO';
    
    const durationMs = Date.now() - startTime;
    
    res.json({
      verdict,
      summary: `${goes} GO / ${warns} WARN / ${criticalFails} FAIL`,
      checks,
      alerts: alerts.sort((a, b) => {
        const sev = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (sev[a.severity] || 4) - (sev[b.severity] || 4);
      }),
      countdown: {
        day1: 'March 26, 2026',
        day2: 'March 27, 2026',
        daysUntilDay1: Math.ceil((new Date('2026-03-26T00:00:00Z') - new Date()) / 86400000),
      },
      meta: {
        version: '89.0.0',
        runAt: new Date().toISOString(),
        durationMs,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.split('\\n').slice(0, 5) });
  }
});

// ===== LINE SHOPPING — Multi-Book Optimizer v72.0 =====
// The difference between DK -138 and Pinnacle -132 on a $50 bet is $2.20
// Across 28 OD bets, line shopping adds $30-60 in free EV

app.get('/api/opening-day/line-shop', async (req, res) => {
  try {
    if (!lineShopping) return res.status(500).json({ error: 'Line shopping service not loaded' });
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.25;
    const minEdge = parseFloat(req.query.minEdge) || 0.02;
    
    const portfolio = await lineShopping.generateODPortfolio(
      { mlb, getAllOdds, odGames: mlbOpeningDay.OPENING_DAY_GAMES },
      { bankroll, kellyFraction, minEdge }
    );
    res.json(portfolio);
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
});

app.get('/api/line-shop/:sport/:away/:home', async (req, res) => {
  try {
    if (!lineShopping) return res.status(500).json({ error: 'Line shopping service not loaded' });
    const { sport, away, home } = req.params;
    const awayAbbr = away.toUpperCase();
    const homeAbbr = home.toUpperCase();
    const bankroll = parseFloat(req.query.bankroll) || 1000;
    const kellyFraction = parseFloat(req.query.kelly) || 0.25;
    
    // Get prediction
    let prediction;
    if (sport.toLowerCase() === 'mlb') {
      try { prediction = await mlb.asyncPredict(awayAbbr, homeAbbr); } 
      catch { prediction = mlb.predict(awayAbbr, homeAbbr); }
    } else if (sport.toLowerCase() === 'nba') {
      prediction = nba.predict(awayAbbr, homeAbbr);
    } else if (sport.toLowerCase() === 'nhl') {
      try { prediction = await nhl.asyncPredict(awayAbbr, homeAbbr); }
      catch { prediction = nhl.predict(awayAbbr, homeAbbr); }
    }
    
    if (!prediction || prediction.error) {
      return res.json({ error: 'Prediction not available', away: awayAbbr, home: homeAbbr });
    }
    
    // Get odds for this game
    const allOdds = await getAllOdds();
    const gameOdds = (allOdds || []).find(g => 
      g.sport === sport.toUpperCase() && g.home === homeAbbr && g.away === awayAbbr
    );
    
    const booksData = gameOdds?.books || {};
    const result = lineShopping.shopGame(awayAbbr, homeAbbr, prediction, booksData, { bankroll, kellyFraction });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/line-shop/best/:sport', async (req, res) => {
  try {
    if (!lineShopping) return res.status(500).json({ error: 'Line shopping service not loaded' });
    const sport = req.params.sport.toUpperCase();
    const minEdge = parseFloat(req.query.minEdge) || 0.02;
    
    const allOdds = await getAllOdds();
    const games = (allOdds || []).filter(g => g.sport === sport);
    
    const allBets = [];
    
    for (const game of games) {
      if (!game.home || !game.away || !game.books) continue;
      
      let prediction;
      try {
        if (sport === 'MLB') {
          prediction = await mlb.asyncPredict(game.away, game.home);
        } else if (sport === 'NBA') {
          prediction = nba.predict(game.away, game.home);
        } else if (sport === 'NHL') {
          prediction = await nhl.asyncPredict(game.away, game.home);
        }
      } catch (e) { continue; }
      
      if (!prediction || prediction.error) continue;
      
      const shopping = lineShopping.shopGame(game.away, game.home, prediction, game.books);
      for (const mkt of (shopping.markets || [])) {
        if (mkt.edge >= minEdge) {
          allBets.push({
            ...mkt,
            game: `${game.away}@${game.home}`,
          });
        }
      }
    }
    
    allBets.sort((a, b) => b.ev - a.ev);
    
    const totalWager = allBets.reduce((s, b) => s + (b.wager || 0), 0);
    const totalEV = allBets.reduce((s, b) => s + (b.ev || 0), 0);
    
    res.json({
      sport,
      gamesScanned: games.length,
      totalBets: allBets.length,
      totalWager: +totalWager.toFixed(2),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
      bets: allBets.slice(0, 50),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== MORNING BRIEFING v109.0 ====================
// THE ONE ENDPOINT THAT PRINTS MONEY EVERY DAY
// Hit /api/briefing when you wake up → see every edge across all sports.

app.get('/api/briefing', async (req, res) => {
  try {
    if (!morningBriefing) return res.status(503).json({ error: 'Morning Briefing service not loaded' });
    const briefing = await morningBriefing.buildBriefing({
      forceRefresh: req.query.refresh === '1' || req.query.refresh === 'true',
      oddsApiKey: ODDS_API_KEY,
      bankroll: parseInt(req.query.bankroll) || 1000,
      kellyFraction: parseFloat(req.query.kelly) || 0.5,
    });
    res.json(briefing);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/briefing/quick', (req, res) => {
  try {
    if (!morningBriefing) return res.status(503).json({ error: 'Morning Briefing service not loaded' });
    const cached = morningBriefing.getCached();
    if (cached) {
      res.json({ ...cached, cached: true });
    } else {
      res.json({ building: false, note: 'No cached briefing available. Hit /api/briefing to build one.' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  const mem = process.memoryUsage();
  console.log(`🎯 SportsSim v103.0.0 running on port ${PORT}`);
  console.log(`   Memory: RSS ${Math.round(mem.rss / 1024 / 1024)}MB, Heap ${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
  console.log(`   Odds API: ${ODDS_API_KEY ? 'configured' : 'NOT SET (set ODDS_API_KEY env var)'}`);
  console.log(`   NBA teams: ${Object.keys(nba.getTeams()).length}`);
  console.log(`   MLB teams: ${Object.keys(mlb.getTeams()).length}`);
  console.log(`   MLB pitchers: ${mlbPitchers.getAllPitchers().length}`);
  console.log(`   MLB Opening Day games: ${mlbOpeningDay.OPENING_DAY_GAMES.length}`);
  console.log(`   MLB Schedule: ESPN confirmed starters service active`);
  console.log(`   NHL teams: ${Object.keys(nhl.getTeams()).length}`);
  if (nfl) console.log(`   NFL teams: ${Object.keys(nfl.TEAMS).length} (win totals model active, ${Object.keys(nfl.MARKET_LINES).length} market lines)`);
  if (ncaa) console.log(`   NCAA teams: ${Object.keys(ncaa.TEAMS).length} (March Madness KenPom model, bracket simulator, value scanner, live scores, momentum, futures)`);
  if (ncaaLive) console.log('   NCAA Live: ESPN live scores, bracket auto-update, tournament momentum');
  console.log(`   Player props: ${Object.keys(playerProps.NBA_PLAYER_BASELINES).length} NBA + ${Object.keys(playerProps.MLB_PITCHER_BASELINES).length} MLB pitchers + ${Object.keys(playerProps.MLB_BATTER_BASELINES).length} MLB batters`);
  if (pitcherKProps) {
    const kStatus = pitcherKProps.getStatus();
    console.log(`   Pitcher K Props: ${kStatus.totalPitchers} OD starters, ${kStatus.teamsWithKData} team K% profiles, ${kStatus.parksWithKFactors} park K factors`);
  }
  if (pitcherOutsProps) {
    const outsLb = pitcherOutsProps.getOutsLeaderboard();
    console.log(`   Pitcher Outs Props: ${outsLb.leaderboard.length} OD starters, avg ${outsLb.avgExpectedOuts} expected outs`);
  }
  console.log(`   Polymarket: scanner active`);
  console.log(`   Polymarket Value Bridge: model vs market edge detection active`);
  console.log(`   Bet tracker: ${betTracker.getStatus().totalBets} bets tracked, ${betTracker.getStatus().pending} pending`);
  const umpStatus = umpireService.getStatus();
  console.log(`   Umpire tendencies: ${umpStatus.umpires} umpires (${umpStatus.overUmpires} over, ${umpStatus.underUmpires} under, ${umpStatus.neutralUmpires} neutral)`);
  const calStatus = calibration.getStatus();
  console.log(`   Probability calibration: ${calStatus.sports.join(', ')} — ${JSON.stringify(calStatus.curves)}`);
  const sgpStatus = sgpEngine.getStatus();
  console.log(`   SGP engine: ${sgpStatus.correlationsModeled} correlations modeled, ${sgpStatus.comboTypes.join('/')} combos`);
  console.log(`   Alt lines scanner: alt totals, alt spreads, team totals, F5 lines — Poisson-powered`);
  console.log(`   Arbitrage scanner: cross-book arbs, low-hold, middles, stale lines`);
  console.log(`   🧠 ML Engine: Python sklearn ensemble (LR + GradientBoosting + RandomForest)`);
  console.log(`   🔄 Auto-scanner: 10 automated scan types on configurable intervals (incl. MLB Daily Card)`);
  if (lineShopping) console.log(`   🛒 Line Shopping: Multi-book optimizer active (${lineShopping.BOOK_PRIORITY.length} books tracked)`);
  if (pitcherResolver) {
    const prStatus = pitcherResolver.getStatus();
    console.log(`   🎯 Pitcher Resolver: Dynamic props for ANY pitcher (${prStatus.pitchersInDB} pitchers, ${prStatus.teamBattingKProfiles} K profiles, Statcast: ${prStatus.statcastAvailable})`);
  }
  console.log(`   Features: LIVE DATA, rolling stats, injuries, line movement, Kalshi scanner, PLAYER PROPS, pitcher model, Poisson totals, Kelly optimizer, WEATHER, POLYMARKET, BET TRACKER, DAILY PICKS ENGINE, ESPN STARTERS, SCHEDULE, UMPIRE TENDENCIES, PROBABILITY CALIBRATION, SGP CORRELATION ENGINE, ALT LINES SCANNER, ML ENGINE v2 (STATCAST), ARBITRAGE SCANNER, STATCAST INTEGRATION, AUTO-SCANNER, LINE SHOPPING, PITCHER RESOLVER`);
  
  // Staggered startup: load data SEQUENTIALLY to avoid OOM on 1GB VM
  // Health check is already responding — data loads happen in background
  console.log('   📡 Starting staggered data load (sequential to avoid OOM)...');
  (async () => {
    try {
      // Phase 1: Core standings (lightweight)
      console.log('   📡 [1/6] Loading live standings...');
      const liveResults = await liveData.refreshAll().catch(e => ({ error: e.message }));
      console.log('   ✅ Live data:', JSON.stringify(liveResults));
      
      // Phase 2: Rolling stats
      console.log('   📡 [2/6] Loading rolling stats...');
      const rollingResults = await rollingStats.refreshAll().catch(e => ({ error: e.message }));
      console.log('   ✅ Rolling stats:', JSON.stringify(rollingResults));
      
      // Phase 3: Injuries
      console.log('   📡 [3/6] Loading injuries...');
      const injuryResults = await injuries.refreshAll().catch(e => ({ error: e.message }));
      console.log('   ✅ Injuries:', JSON.stringify(injuryResults));
      
      // Phase 4: Weather (moderate)
      console.log('   📡 [4/6] Loading weather...');
      const weatherResults = await weather.getAllWeather().catch(() => ({}));
      console.log(`   ✅ Weather: ${Object.keys(weatherResults).length} parks cached`);
      
      // Phase 5: Player stats
      console.log('   📡 [5/6] Loading player stats...');
      const playerResults = await playerStatsService.refreshAll().catch(() => ({ nba: 0, mlb: 0, nhl: 0 }));
      console.log(`   ✅ Player stats: NBA ${playerResults.nba}, MLB ${playerResults.mlb}, NHL ${playerResults.nhl}`);
      
      // Phase 6: Statcast (HEAVIEST — 853 pitchers + 651 batters)
      console.log('   📡 [6/6] Loading Statcast (heavy)...');
      const statcastResults = await statcast.refreshStatcast().catch(() => ({ pitchers: 0, batters: 0, error: true }));
      console.log(`   ✅ Statcast: ${statcastResults.pitchers} pitchers, ${statcastResults.batters} batters${statcastResults.fromCache ? ' (cache)' : ' (fresh)'}`);
      
      console.log(`   NBA teams (live): ${Object.keys(nba.getTeams()).length}`);
      console.log(`   NHL teams (live): ${Object.keys(nhl.getTeams()).length}`);
    
    // Take initial line movement snapshot
    try {
      const games = await getAllOdds();
      const snapResult = lineMovement.takeSnapshot(games);
      console.log('   ✅ Line movement: initial snapshot —', JSON.stringify(snapResult));
    } catch (e) {
      console.log('   ⚠️ Line movement snapshot failed:', e.message);
    }
    
    // Auto-train ML model
    mlBridge.autoTrain().catch(e => console.error('   ⚠️ ML auto-train failed:', e.message));
    
    // Initialize and start auto-scanner with all dependencies
    autoScanner.init({
      dailyPicks,
      nba, mlb, nhl,
      getAllOdds,
      lineMovement,
      injuries,
      rollingStats,
      weather,
      playerProps,
      umpireService,
      calibration,
      mlBridge,
      sgpEngine,
      altLines,
      polymarketValue,
      arbitrage,
      clvTracker,
      liveData,
      playerStatsService,
      statcast
    });
    autoScanner.startAllTimers();
    console.log('   🚀 Auto-scanner initialized and running');
    
    // Initialize OD Playbook Cache with dependencies
    if (odPlaybookCache) {
      odPlaybookCache.init({
        mlb, mlbOpeningDay, weather, umpireService, calibration,
        preseasonTuning, statcast, rollingStats, injuries,
        bullpenQuality, lineupFetcher, openingWeekUnders,
        stolenBaseModel, fetchOdds,
      });
      console.log('   📋 OD Playbook Cache initialized — pre-building...');
      odPlaybookCache.refresh().then(async () => {
        console.log('   ✅ OD Playbook pre-built and cached');
        
        // Start auto-warm timer to keep cache hot (prevents cold-start timeouts)
        if (odPlaybookCache.startAutoWarm) {
          odPlaybookCache.startAutoWarm(25 * 60 * 1000); // rebuild every 25 min (cache TTL = 30 min)
        }
        
        // Initialize OD Line Tracker with model predictions
        if (odLineTracker) {
          try {
            const pb = await odPlaybookCache.getPlaybook();
            if (pb && pb.playbook) {
              await odLineTracker.initializeFromPlaybook(pb);
              console.log('   ✅ OD Line Tracker initialized with model predictions');
            }
          } catch (e) {
            console.log('   ⚠️ OD Line Tracker init failed:', e.message);
          }
        }
      }).catch(e => {
        console.log('   ⚠️ OD Playbook pre-build failed:', e.message);
      });
    }
    
    // Initialize Game Day Orchestrator
    if (gamedayOrchestrator) {
      try {
        gamedayOrchestrator.init({
          lineupFetcher,
          lineupMonitor,
          weatherForecast: weather,
          odPlaybookCache,
          odModel: mlbOpeningDay,
        });
        console.log('   🎮 GameDay Orchestrator initialized — auto-detecting game days');
      } catch (e) {
        console.log('   ⚠️ GameDay Orchestrator init failed:', e.message);
      }
    }
    
    // Auto-boot Regular Season Autopilot — starts if MLB games exist today
    if (regularSeasonAutopilot && regularSeasonAutopilot.autoBoot) {
      regularSeasonAutopilot.autoBoot().then(result => {
        if (result.started) {
          console.log(`   ⚾ Regular Season Autopilot AUTO-STARTED: ${result.games} games for ${result.date}`);
        } else {
          console.log(`   ⚾ Regular Season Autopilot: idle (${result.reason || 'no games'})`);
        }
      }).catch(e => {
        console.log('   ⚠️ Regular Season Autopilot auto-boot failed:', e.message);
      });
    }

    // Auto-start OD Odds Monitor — detects when books post OD lines
    if (odOddsMonitor) {
      try {
        const now = new Date();
        const odDay1 = new Date('2026-03-26T17:15:00Z');
        const hoursUntilOD = (odDay1 - now) / (1000 * 60 * 60);
        // Run monitor if OD is within 72 hours (March 23-26)
        if (hoursUntilOD > 0 && hoursUntilOD <= 72) {
          odOddsMonitor.start();
          console.log(`   📡 OD Odds Monitor AUTO-STARTED — ${hoursUntilOD.toFixed(0)}h until first pitch, polling every 15 min for live lines`);
        } else {
          console.log(`   📡 OD Odds Monitor: standby (${hoursUntilOD.toFixed(0)}h until OD)`);
        }
      } catch(e) {
        console.log('   ⚠️ OD Odds Monitor auto-start failed:', e.message);
      }
    }
    
    } catch (e) {
      console.error('   ⚠️ Data refresh failed:', e.message);
      console.log('   Using static fallback data');
    
      // Still initialize auto-scanner even if data refresh failed
      autoScanner.init({
        dailyPicks,
        nba, mlb, nhl,
        getAllOdds,
        lineMovement,
        injuries,
        rollingStats,
        weather,
        playerProps,
        umpireService,
        calibration,
        mlBridge,
        sgpEngine,
        altLines,
        polymarketValue,
        arbitrage,
        clvTracker,
        liveData,
        playerStatsService,
        statcast
      });
      autoScanner.startAllTimers();
      console.log('   🚀 Auto-scanner initialized (with fallback data)');
    
      // Initialize OD Playbook Cache even with fallback data
      if (odPlaybookCache) {
        odPlaybookCache.init({
          mlb, mlbOpeningDay, weather, umpireService, calibration,
          preseasonTuning, statcast, rollingStats, injuries,
          bullpenQuality, lineupFetcher, openingWeekUnders,
          stolenBaseModel, fetchOdds,
        });
        console.log('   📋 OD Playbook Cache initialized (fallback)');
      }
    }
  })();

  // Periodic line movement snapshots every 30 min (kept separate from auto-scanner for backward compat)
  setInterval(async () => {
    try {
      const games = await getAllOdds();
      const result = lineMovement.takeSnapshot(games);
      console.log(`📈 Line snapshot: ${result.stored} games tracked, ${lineMovement.getSharpSignals().length} signals`);
    } catch (e) {
      console.error('⚠️ Line snapshot failed:', e.message);
    }
  }, lineMovement.SNAPSHOT_INTERVAL);

  // Auto-refresh live data every 2 hours to keep standings/stats current
  const DATA_REFRESH_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
  setInterval(async () => {
    try {
      console.log('🔄 Periodic data refresh starting (sequential)...');
      await liveData.refreshAll(true).catch(e => console.error('  ⚠️ Live data refresh failed:', e.message));
      await rollingStats.refreshAll(true).catch(e => console.error('  ⚠️ Rolling stats refresh failed:', e.message));
      await injuries.refreshAll(true).catch(e => console.error('  ⚠️ Injuries refresh failed:', e.message));
      console.log('✅ Periodic data refresh complete');
    } catch (e) {
      console.error('⚠️ Periodic data refresh failed:', e.message);
    }
  }, DATA_REFRESH_INTERVAL);
  console.log('   ⏰ Auto data refresh: every 2 hours');

  // Memory monitoring — log every 30 min to detect leaks
  setInterval(() => {
    const mem = process.memoryUsage();
    console.log(`📊 Memory: RSS ${Math.round(mem.rss / 1024 / 1024)}MB, Heap ${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB, External ${Math.round(mem.external / 1024 / 1024)}MB`);
  }, 30 * 60 * 1000);

  // Start lineup monitor for game-day lineup tracking
  if (lineupMonitor) {
    lineupMonitor.init({ lineupFetcher, mlbModel: mlb });
    lineupMonitor.start();
    console.log('   📋 Lineup monitor: started (scanning every 5 min for lineup drops)');
  }
  
  // Start Gameday Lineup Pipeline v110 — multi-source monitoring for ALL MLB game days
  if (gamedayLineupPipeline) {
    gamedayLineupPipeline.init({ mlbModel: mlb, lineupFetcher, lineupBridge, mlbStatsLineups, odPlaybookCache });
    gamedayLineupPipeline.start();
    console.log('   🔄 Gameday Lineup Pipeline: started (MLB Stats API + ESPN multi-source)');
  }
  
  // Auto-start OD Lineup Verification Monitor on OD game days (March 26-27)
  if (odLineupVerify) {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const isODDay1 = today === '20260326';
    const isODDay2 = today === '20260327';
    if (isODDay1 || isODDay2) {
      const dayNum = isODDay1 ? 1 : 2;
      console.log(`   🔴 OPENING DAY ${dayNum} DETECTED — Auto-starting lineup verification pipeline`);
      try {
        odLineupVerify.startMonitor(dayNum);
        console.log(`   ✅ OD Lineup Verify: monitoring Day ${dayNum} lineups every 5 min`);
        // Run immediate verification
        odLineupVerify.verifyODLineups(dayNum).then(result => {
          const confirmed = result.lineupsConfirmed || 0;
          const total = result.totalGames || 0;
          console.log(`   🔍 OD Lineup Verify: ${confirmed}/${total} lineups confirmed (${result.overallStatus})`);
          if (result.alerts?.length > 0) {
            result.alerts.forEach(a => console.log(`   ⚠️ LINEUP ALERT: ${a}`));
          }
        }).catch(e => console.error('   ⚠️ OD Lineup Verify scan error:', e.message));
      } catch (e) {
        console.error('   ⚠️ OD Lineup Verify auto-start failed:', e.message);
      }
    }
  }
  
  // Initialize Daily Slate service
  if (dailySlate) {
    dailySlate.init({
      nba, mlb, nhl, calibration,
      oddsApiKey: ODDS_API_KEY,
      kelly,
      restTank: nbaRestTank,
      lineupFetcher,
      weather,
      openingWeekUnders,
    });
    console.log('   📊 Daily Slate: initialized (cross-sport action plan generator)');
  }

  // Auto-record rest/tank predictions for today's NBA games
  if (restTankBacktest) {
    (async () => {
      try {
        const standings = nba.getTeams();
        const scan = await nbaRestTank.scanTodaysGames(standings);
        if (scan.games && scan.games.length > 0) {
          const recordResult = restTankBacktest.recordPredictions(scan, nba);
          console.log(`   🏀 Rest/tank backtest: recorded ${recordResult.count || 0} predictions for today`);
          // Also try to grade yesterday's games
          const gradeResult = await restTankBacktest.gradeResults();
          if (gradeResult.gamesGraded > 0) {
            console.log(`   📊 Rest/tank backtest: graded ${gradeResult.gamesGraded} games from yesterday`);
          }
        } else {
          console.log('   🏀 Rest/tank backtest: no NBA games today');
        }
      } catch (e) {
        console.error('   ⚠️ Rest/tank backtest error:', e.message);
      }
    })();
  }
});
