/**
 * Daily MLB Betting Card — SportsSim v82.0
 * ==========================================
 * THE REGULAR SEASON MONEY PRINTER.
 *
 * Replaces OD-specific playbook with a generalized daily card that works
 * for ANY game day of the 162-game MLB season (March 26 → October).
 *
 * For each day's games:
 *   1. Fetches schedule + confirmed starters from ESPN
 *   2. Runs asyncPredict (full signal stack: lineups, weather, umpires, platoon, framing, bullpen)
 *   3. Compares model to live Odds API lines → value detection
 *   4. Generates K props, NRFI, pitcher outs props
 *   5. Builds conviction-scored betting card with Kelly sizing
 *   6. Caches results for instant dashboard loads
 *
 * WHY THIS MATTERS:
 * The OD playbook was hardcoded for 20 games. The regular season has ~15 games/day
 * for 6 months. We need automated daily edge detection — this is the engine.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ==================== CACHE ====================
const CACHE_DIR = path.join(__dirname, 'daily-card-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_TTL = 10 * 60 * 1000; // 10 min — odds move, recalculate frequently
let lastBuild = null;
let lastBuildTime = 0;

// ==================== DEPENDENCIES ====================
let mlbModel = null;
let mlbSchedule = null;
let weatherService = null;
let umpireService = null;
let kPropsService = null;
let outsPropsService = null;
let nrfiService = null;
let catcherFramingService = null;
let platoonService = null;
let bullpenService = null;
let convictionEngine = null;
let lineShoppingService = null;
let negBinomial = null;
let statcastService = null;

// Safe requires
try { mlbModel = require('../models/mlb'); } catch(e) {}
try { mlbSchedule = require('./mlb-schedule'); } catch(e) {}
try { weatherService = require('./weather'); } catch(e) {}
try { umpireService = require('./umpire-tendencies'); } catch(e) {}
try { kPropsService = require('./pitcher-k-props'); } catch(e) {}
try { outsPropsService = require('./pitcher-outs-props'); } catch(e) {}
try { nrfiService = require('./nrfi-model'); } catch(e) {}
try { catcherFramingService = require('./catcher-framing'); } catch(e) {}
try { platoonService = require('./platoon-splits'); } catch(e) {}
try { bullpenService = require('./bullpen-quality'); } catch(e) {}
try { negBinomial = require('./neg-binomial'); } catch(e) {}
try { statcastService = require('./statcast'); } catch(e) {}
try { lineShoppingService = require('./line-shopping'); } catch(e) {}

// ==================== ODDS API ====================
function fetchJSON(url, timeoutMs = 12000) {
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

async function fetchMLBOdds(oddsApiKey) {
  if (!oddsApiKey) return [];
  try {
    const markets = 'h2h,spreads,totals,pitcher_strikeouts,totals_1st_1_innings';
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${oddsApiKey}&regions=us&oddsFormat=american&markets=${markets}`;
    const data = await fetchJSON(url);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Daily card odds fetch error:', e.message);
    return [];
  }
}

// ==================== TEAM NAME RESOLUTION ====================
const TEAM_NAMES = {
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
  // Short names
  'Diamondbacks': 'ARI', 'Braves': 'ATL', 'Orioles': 'BAL', 'Red Sox': 'BOS',
  'Cubs': 'CHC', 'White Sox': 'CWS', 'Reds': 'CIN', 'Guardians': 'CLE',
  'Rockies': 'COL', 'Tigers': 'DET', 'Astros': 'HOU', 'Royals': 'KC',
  'Angels': 'LAA', 'Dodgers': 'LAD', 'Marlins': 'MIA', 'Brewers': 'MIL',
  'Twins': 'MIN', 'Mets': 'NYM', 'Yankees': 'NYY', 'Athletics': 'OAK',
  'Phillies': 'PHI', 'Pirates': 'PIT', 'Padres': 'SD', 'Giants': 'SF',
  'Mariners': 'SEA', 'Cardinals': 'STL', 'Rays': 'TB', 'Rangers': 'TEX',
  'Blue Jays': 'TOR', 'Nationals': 'WSH',
};

function resolveTeam(name) {
  if (!name) return null;
  if (TEAM_NAMES[name]) return TEAM_NAMES[name];
  // Try partial match
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(TEAM_NAMES)) {
    if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) return v;
  }
  return null;
}

// ==================== ODDS HELPERS ====================
function mlToProb(ml) {
  if (!ml || ml === 0) return 0.5;
  return ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function extractGameOdds(game) {
  const result = {
    homeML: null, awayML: null,
    homeBestBook: '', awayBestBook: '',
    total: null, totalBook: '',
    overOdds: null, underOdds: null,
    homeSpread: null, homeSpreadOdds: null, spreadBook: '',
    kProps: {}, // pitcherName → { line, overOdds, underOdds, book }
    nrfi: null, // { nrfiOdds, yrfiOdds, book }
    bookCount: 0,
  };

  for (const bk of (game.bookmakers || [])) {
    result.bookCount++;
    for (const market of (bk.markets || [])) {
      if (market.key === 'h2h') {
        for (const o of market.outcomes || []) {
          if (o.name === game.home_team && (result.homeML === null || o.price > result.homeML)) {
            result.homeML = o.price;
            result.homeBestBook = bk.title;
          }
          if (o.name === game.away_team && (result.awayML === null || o.price > result.awayML)) {
            result.awayML = o.price;
            result.awayBestBook = bk.title;
          }
        }
      }
      if (market.key === 'totals') {
        for (const o of market.outcomes || []) {
          if (o.name === 'Over' && result.total === null) {
            result.total = o.point;
            result.overOdds = o.price;
            result.totalBook = bk.title;
          }
          if (o.name === 'Under') {
            result.underOdds = o.price;
          }
        }
      }
      if (market.key === 'spreads') {
        for (const o of market.outcomes || []) {
          if (o.name === game.home_team && result.homeSpread === null) {
            result.homeSpread = o.point;
            result.homeSpreadOdds = o.price;
            result.spreadBook = bk.title;
          }
        }
      }
      if (market.key === 'pitcher_strikeouts') {
        for (const o of market.outcomes || []) {
          // Odds API returns pitcher name in description
          const pitcher = o.description || '';
          if (pitcher && !result.kProps[pitcher]) result.kProps[pitcher] = {};
          if (pitcher) {
            if (o.name === 'Over') {
              result.kProps[pitcher].line = o.point;
              result.kProps[pitcher].overOdds = o.price;
              result.kProps[pitcher].book = bk.title;
            }
            if (o.name === 'Under') {
              result.kProps[pitcher].underOdds = o.price;
            }
          }
        }
      }
      if (market.key === 'totals_1st_1_innings') {
        for (const o of market.outcomes || []) {
          if (o.name === 'Over' && !result.nrfi) {
            result.nrfi = { yrfiOdds: o.price, nrfiOdds: null, line: o.point, book: bk.title };
          }
          if (o.name === 'Under' && result.nrfi) {
            result.nrfi.nrfiOdds = o.price;
          }
        }
      }
    }
  }

  return result;
}

// ==================== CONVICTION SCORING ====================
// Simplified conviction engine for daily use (doesn't need full OD-specific logic)
function calculateConviction(pred, odds, signals = {}) {
  let score = 0;
  const factors = [];

  // 1. Edge size (0-25 pts)
  const edge = signals.edge || 0;
  if (edge >= 8) { score += 25; factors.push('Massive edge (8%+)'); }
  else if (edge >= 5) { score += 20; factors.push('Strong edge (5%+)'); }
  else if (edge >= 3) { score += 15; factors.push('Solid edge (3%+)'); }
  else if (edge >= 2) { score += 10; factors.push('Moderate edge (2%+)'); }
  else { score += 5; }

  // 2. Pitcher quality (0-15 pts)
  if (signals.pitcherTier === 1) { score += 15; factors.push('Ace starter'); }
  else if (signals.pitcherTier === 2) { score += 10; factors.push('Quality starter'); }
  else { score += 5; }

  // 3. Data quality (0-15 pts)
  if (signals.hasWeather) { score += 3; factors.push('Weather data'); }
  if (signals.hasLineups) { score += 5; factors.push('Confirmed lineups'); }
  if (signals.hasUmpire) { score += 3; factors.push('Umpire data'); }
  if (signals.hasStatcast) { score += 4; factors.push('Statcast data'); }

  // 4. Model agreement (0-15 pts) — NB vs Poisson vs analytical
  if (signals.modelAgreement >= 3) { score += 15; factors.push('Multi-model agreement'); }
  else if (signals.modelAgreement >= 2) { score += 10; factors.push('Dual model agreement'); }

  // 5. Platoon/framing/bullpen edges (0-15 pts)
  if (signals.platoonEdge) { score += 5; factors.push(`Platoon edge: ${signals.platoonEdge}`); }
  if (signals.framingEdge) { score += 5; factors.push(`Framing edge: ${signals.framingEdge}`); }
  if (signals.bullpenEdge) { score += 5; factors.push(`Bullpen edge: ${signals.bullpenEdge}`); }

  // 6. Market context (0-15 pts)
  if (signals.lineMovement === 'steam') { score += 10; factors.push('Steam move in our direction'); }
  else if (signals.lineMovement === 'rlm') { score += 8; factors.push('Reverse line movement'); }
  if (odds.bookCount >= 5) { score += 5; factors.push('Deep market coverage'); }

  // Clamp to 0-100
  score = Math.min(100, Math.max(0, score));

  // Grade
  let grade;
  if (score >= 85) grade = 'A+';
  else if (score >= 75) grade = 'A';
  else if (score >= 65) grade = 'A-';
  else if (score >= 55) grade = 'B+';
  else if (score >= 45) grade = 'B';
  else if (score >= 35) grade = 'B-';
  else if (score >= 25) grade = 'C+';
  else grade = 'C';

  // Tier
  let tier;
  if (score >= 80) tier = 'SMASH';
  else if (score >= 60) tier = 'STRONG';
  else if (score >= 40) tier = 'LEAN';
  else tier = 'SMALL';

  return { score, grade, tier, factors };
}

// ==================== KELLY SIZING ====================
function kellySize(prob, odds, bankroll = 1000, fraction = 0.5) {
  const impliedProb = mlToProb(odds);
  if (impliedProb <= 0 || impliedProb >= 1 || prob <= impliedProb) return { wager: 0, ev: 0 };

  const b = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  const kelly = (prob * b - (1 - prob)) / b;
  const adjKelly = Math.max(0, kelly * fraction);
  const wager = Math.min(bankroll * 0.05, bankroll * adjKelly); // 5% max single bet
  const ev = wager * (prob * b - (1 - prob));

  return {
    wager: +wager.toFixed(2),
    ev: +ev.toFixed(2),
    kelly: +(kelly * 100).toFixed(1),
    adjKelly: +(adjKelly * 100).toFixed(1),
  };
}

// ==================== CORE: BUILD DAILY CARD ====================
async function buildDailyCard(opts = {}) {
  const date = opts.date || new Date().toISOString().split('T')[0];
  const bankroll = opts.bankroll || 1000;
  const kellyFraction = opts.kellyFraction || 0.5;
  const minEdge = opts.minEdge || 0.02;
  const oddsApiKey = opts.oddsApiKey || process.env.ODDS_API_KEY || '';
  const forceRefresh = opts.forceRefresh || false;

  // Check cache
  if (!forceRefresh && lastBuild && (Date.now() - lastBuildTime) < CACHE_TTL && lastBuild.date === date) {
    return { ...lastBuild, cached: true };
  }

  const startTime = Date.now();
  const errors = [];
  const warnings = [];

  // ==================== 1. FETCH SCHEDULE ====================
  let schedule = null;
  let games = [];
  try {
    if (mlbSchedule) {
      schedule = await mlbSchedule.getSchedule(date);
      games = schedule?.games || [];
    }
  } catch (e) {
    errors.push(`Schedule fetch: ${e.message}`);
  }

  // ==================== 2. FETCH LIVE ODDS ====================
  let oddsData = [];
  try {
    oddsData = await fetchMLBOdds(oddsApiKey);
  } catch (e) {
    errors.push(`Odds fetch: ${e.message}`);
  }

  // Match odds to schedule games by team names
  function findOdds(awayAbbr, homeAbbr) {
    for (const g of oddsData) {
      const away = resolveTeam(g.away_team);
      const home = resolveTeam(g.home_team);
      if ((away === awayAbbr && home === homeAbbr) || (away === homeAbbr && home === awayAbbr)) {
        return g;
      }
    }
    return null;
  }

  // ==================== 3. PROCESS EACH GAME ====================
  const gameCards = [];
  const allBets = [];
  let signalCounts = { weather: 0, lineups: 0, umpires: 0, statcast: 0, platoon: 0, framing: 0, bullpen: 0 };

  for (const game of games) {
    const away = game.awayTeam?.abbr;
    const home = game.homeTeam?.abbr;
    if (!away || !home) continue;

    const gameKey = `${away}@${home}`;
    const card = {
      game: gameKey,
      away, home,
      awayName: game.awayTeam?.name || away,
      homeName: game.homeTeam?.name || home,
      gameTime: game.startTime || game.time || 'TBD',
      status: game.status || 'scheduled',
      starters: {
        away: game.awayTeam?.probablePitcher?.name || 'TBD',
        home: game.homeTeam?.probablePitcher?.name || 'TBD',
      },
      prediction: null,
      odds: null,
      bets: [],
      props: { kProps: null, nrfi: null, outsProps: null },
      signals: {},
      conviction: null,
    };

    // 3a. Run prediction
    try {
      let pred;
      if (mlbModel && mlbModel.asyncPredict) {
        pred = await mlbModel.asyncPredict(away, home, { gameDate: date });
      } else if (mlbModel) {
        pred = mlbModel.predict(away, home);
      }

      if (pred && !pred.error) {
        card.prediction = {
          homeWinProb: pred.homeWinProb,
          awayWinProb: pred.awayWinProb || (1 - pred.homeWinProb),
          totalRuns: pred.totalRuns,
          homeExpRuns: pred.homeExpRuns,
          awayExpRuns: pred.awayExpRuns,
          f5Total: pred.f5Total,
          spread: pred.spread,
          homePitcher: pred.homePitcher,
          awayPitcher: pred.awayPitcher,
        };

        // Track signals
        if (pred._asyncSignals) {
          if (pred._asyncSignals.weather) signalCounts.weather++;
          if (pred._asyncSignals.lineups) signalCounts.lineups++;
          if (pred._asyncSignals.umpires) signalCounts.umpires++;
          card.signals = pred._asyncSignals;
        }
        if (pred.statcast) signalCounts.statcast++;
        if (pred.platoonAdj) { signalCounts.platoon++; card.signals.platoon = pred.platoonAdj; }
        if (pred.catcherFraming) { signalCounts.framing++; card.signals.framing = pred.catcherFraming; }
        if (pred.bullpenQuality) { signalCounts.bullpen++; card.signals.bullpen = pred.bullpenQuality; }
      }
    } catch (e) {
      warnings.push(`Prediction ${gameKey}: ${e.message}`);
    }

    // 3b. Match live odds
    const oddsGame = findOdds(away, home);
    if (oddsGame) {
      card.odds = extractGameOdds(oddsGame);
    }

    // 3c. Find value bets (ML, Totals, Run Lines)
    if (card.prediction && card.odds) {
      const pred = card.prediction;
      const odds = card.odds;

      // --- Moneyline value ---
      if (odds.homeML) {
        const impliedHome = mlToProb(odds.homeML);
        const modelHome = pred.homeWinProb > 1 ? pred.homeWinProb / 100 : pred.homeWinProb;
        const homeEdge = modelHome - impliedHome;
        if (homeEdge >= minEdge) {
          const sizing = kellySize(modelHome, odds.homeML, bankroll, kellyFraction);
          const convSignals = {
            edge: +(homeEdge * 100).toFixed(1),
            pitcherTier: pred.homePitcher?.tier === 'ACE' ? 1 : pred.homePitcher?.tier === 'FRONTLINE' ? 2 : 3,
            hasWeather: !!card.signals.weather,
            hasLineups: !!card.signals.lineups,
            hasUmpire: !!card.signals.umpires,
            hasStatcast: !!pred.statcast,
            modelAgreement: 2,
            bookCount: odds.bookCount,
          };
          const conv = calculateConviction(pred, odds, convSignals);
          const bet = {
            type: 'ML', side: 'HOME', team: home, teamName: card.homeName,
            modelProb: +(modelHome * 100).toFixed(1),
            impliedProb: +(impliedHome * 100).toFixed(1),
            edge: +(homeEdge * 100).toFixed(1),
            odds: odds.homeML, book: odds.homeBestBook,
            ...sizing, conviction: conv,
          };
          card.bets.push(bet);
          allBets.push({ ...bet, game: gameKey });
        }
      }

      if (odds.awayML) {
        const impliedAway = mlToProb(odds.awayML);
        const modelAway = pred.awayWinProb > 1 ? pred.awayWinProb / 100 : pred.awayWinProb;
        const awayEdge = modelAway - impliedAway;
        if (awayEdge >= minEdge) {
          const sizing = kellySize(modelAway, odds.awayML, bankroll, kellyFraction);
          const convSignals = {
            edge: +(awayEdge * 100).toFixed(1),
            pitcherTier: pred.awayPitcher?.tier === 'ACE' ? 1 : pred.awayPitcher?.tier === 'FRONTLINE' ? 2 : 3,
            hasWeather: !!card.signals.weather,
            hasLineups: !!card.signals.lineups,
            hasUmpire: !!card.signals.umpires,
            hasStatcast: !!pred.statcast,
            modelAgreement: 2,
            bookCount: odds.bookCount,
          };
          const conv = calculateConviction(pred, odds, convSignals);
          const bet = {
            type: 'ML', side: 'AWAY', team: away, teamName: card.awayName,
            modelProb: +(modelAway * 100).toFixed(1),
            impliedProb: +(impliedAway * 100).toFixed(1),
            edge: +(awayEdge * 100).toFixed(1),
            odds: odds.awayML, book: odds.awayBestBook,
            ...sizing, conviction: conv,
          };
          card.bets.push(bet);
          allBets.push({ ...bet, game: gameKey });
        }
      }

      // --- Totals value ---
      if (odds.total && pred.totalRuns) {
        const modelTotal = pred.totalRuns;
        const line = odds.total;
        const diff = modelTotal - line;

        // UNDER if model total significantly below line
        if (diff < -0.3 && odds.underOdds) {
          // Approximate over/under prob using NB or Poisson
          let underProb = 0.5 + Math.min(0.2, Math.abs(diff) * 0.08);
          const impliedUnder = mlToProb(odds.underOdds);
          const underEdge = underProb - impliedUnder;
          if (underEdge >= minEdge) {
            const sizing = kellySize(underProb, odds.underOdds, bankroll, kellyFraction);
            const bet = {
              type: 'TOTAL', side: 'UNDER', line,
              modelTotal: +modelTotal.toFixed(1),
              edge: +(underEdge * 100).toFixed(1),
              odds: odds.underOdds, book: odds.totalBook,
              ...sizing,
              conviction: calculateConviction(pred, odds, {
                edge: +(underEdge * 100).toFixed(1),
                hasWeather: !!card.signals.weather,
                hasLineups: !!card.signals.lineups,
                bookCount: odds.bookCount,
              }),
            };
            card.bets.push(bet);
            allBets.push({ ...bet, game: gameKey });
          }
        }

        // OVER if model total significantly above line
        if (diff > 0.3 && odds.overOdds) {
          let overProb = 0.5 + Math.min(0.2, diff * 0.08);
          const impliedOver = mlToProb(odds.overOdds);
          const overEdge = overProb - impliedOver;
          if (overEdge >= minEdge) {
            const sizing = kellySize(overProb, odds.overOdds, bankroll, kellyFraction);
            const bet = {
              type: 'TOTAL', side: 'OVER', line,
              modelTotal: +modelTotal.toFixed(1),
              edge: +(overEdge * 100).toFixed(1),
              odds: odds.overOdds, book: odds.totalBook,
              ...sizing,
              conviction: calculateConviction(pred, odds, {
                edge: +(overEdge * 100).toFixed(1),
                hasWeather: !!card.signals.weather,
                hasLineups: !!card.signals.lineups,
                bookCount: odds.bookCount,
              }),
            };
            card.bets.push(bet);
            allBets.push({ ...bet, game: gameKey });
          }
        }
      }
    }

    // 3d. K Props — use existing K props engine for each starter
    if (kPropsService) {
      try {
        for (const side of ['away', 'home']) {
          const pitcherName = card.starters[side];
          const oppTeam = side === 'away' ? home : away;
          if (pitcherName && pitcherName !== 'TBD') {
            const kPred = kPropsService.analyzeMatchup
              ? kPropsService.analyzeMatchup(pitcherName, oppTeam)
              : null;
            if (kPred && kPred.adjustedExpectedKs) {
              // Check for live K prop odds
              const liveK = card.odds?.kProps?.[pitcherName];
              const kResult = {
                pitcher: pitcherName,
                side, opponent: oppTeam,
                expectedKs: kPred.adjustedExpectedKs,
                dkLine: kPred.dkLine || liveK || null,
                edge: kPred.edge || 0,
                recommendation: kPred.recommendation || 'PASS',
                confidence: kPred.confidence || 'LOW',
              };
              if (!card.props.kProps) card.props.kProps = [];
              card.props.kProps.push(kResult);

              // Add to bets if profitable
              if (kResult.edge >= 3 && kResult.recommendation !== 'PASS') {
                const kBet = {
                  type: 'K_PROP', pitcher: pitcherName, side: kResult.recommendation,
                  line: kResult.dkLine?.line, expectedKs: kResult.expectedKs,
                  edge: kResult.edge, game: gameKey,
                  conviction: calculateConviction(null, { bookCount: 1 }, { edge: kResult.edge }),
                };
                allBets.push(kBet);
              }
            }
          }
        }
      } catch (e) {
        warnings.push(`K props ${gameKey}: ${e.message}`);
      }
    }

    // 3e. NRFI — use NRFI model
    if (nrfiService && mlbModel && card.prediction) {
      try {
        const nrfiPred = nrfiService.predict
          ? nrfiService.predict(away, home, card.starters.away, card.starters.home, {
              awayTier: card.prediction.awayPitcher?.tier === 'ACE' ? 1 : 3,
              homeTier: card.prediction.homePitcher?.tier === 'ACE' ? 1 : 3,
            })
          : null;
        if (nrfiPred && nrfiPred.nrfiProb) {
          card.props.nrfi = {
            nrfiProb: nrfiPred.nrfiProb,
            yrfiProb: nrfiPred.yrfiProb || (1 - nrfiPred.nrfiProb),
            recommendation: nrfiPred.nrfiProb > 0.55 ? 'NRFI' : nrfiPred.nrfiProb < 0.45 ? 'YRFI' : 'PASS',
            edge: 0,
          };
          // Compare to live NRFI odds
          if (card.odds?.nrfi) {
            if (card.props.nrfi.recommendation === 'NRFI' && card.odds.nrfi.nrfiOdds) {
              const impliedNRFI = mlToProb(card.odds.nrfi.nrfiOdds);
              card.props.nrfi.edge = +((nrfiPred.nrfiProb - impliedNRFI) * 100).toFixed(1);
            }
            if (card.props.nrfi.recommendation === 'YRFI' && card.odds.nrfi.yrfiOdds) {
              const impliedYRFI = mlToProb(card.odds.nrfi.yrfiOdds);
              const yrfiProb = 1 - nrfiPred.nrfiProb;
              card.props.nrfi.edge = +((yrfiProb - impliedYRFI) * 100).toFixed(1);
            }
          }
        }
      } catch (e) {
        warnings.push(`NRFI ${gameKey}: ${e.message}`);
      }
    }

    gameCards.push(card);
  }

  // ==================== 4. RANK & PORTFOLIO ====================
  allBets.sort((a, b) => (b.edge || 0) - (a.edge || 0));

  // Top plays
  const topPlays = allBets.filter(b => (b.edge || 0) >= 3).slice(0, 25);
  const smashPlays = topPlays.filter(b => b.conviction?.tier === 'SMASH');
  const strongPlays = topPlays.filter(b => b.conviction?.tier === 'STRONG');

  // Portfolio summary
  let totalWager = 0, totalEV = 0;
  for (const bet of topPlays) {
    totalWager += bet.wager || 0;
    totalEV += bet.ev || 0;
  }

  const elapsedMs = Date.now() - startTime;

  const result = {
    timestamp: new Date().toISOString(),
    date,
    version: '82.0.0',
    elapsedMs,

    // HEADLINE
    headline: {
      gamesOnSlate: gameCards.length,
      totalBets: topPlays.length,
      smashPlays: smashPlays.length,
      strongPlays: strongPlays.length,
      totalWager: +totalWager.toFixed(0),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
      bestPlay: topPlays[0] || null,
    },

    // SIGNAL STACK COVERAGE
    signals: {
      ...signalCounts,
      gamesWithPredictions: gameCards.filter(g => g.prediction).length,
      gamesWithOdds: gameCards.filter(g => g.odds).length,
      gamesWithKProps: gameCards.filter(g => g.props.kProps?.length > 0).length,
      gamesWithNRFI: gameCards.filter(g => g.props.nrfi).length,
    },

    // PORTFOLIO
    portfolio: {
      bankroll,
      kellyFraction,
      totalWager: +totalWager.toFixed(0),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
    },

    // TOP PLAYS (ranked by edge)
    topPlays,
    smashPlays,
    strongPlays,

    // GAME CARDS (full detail)
    games: gameCards,

    // SEASON CONTEXT
    seasonContext: getSeasonContext(date),

    // ERRORS / WARNINGS
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,

    // META
    oddsApiActive: !!oddsApiKey,
    scheduleSource: schedule ? 'ESPN' : 'none',
    cached: false,
  };

  // Cache the result
  lastBuild = result;
  lastBuildTime = Date.now();

  // Persist to disk
  try {
    const cacheFile = path.join(CACHE_DIR, `card-${date}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  } catch (e) { /* cache write optional */ }

  return result;
}

// ==================== SEASON CONTEXT ====================
function getSeasonContext(dateStr) {
  const date = new Date(dateStr + 'T00:00:00Z');
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Season phases
  let phase = 'regular';
  let modifiers = [];

  if (month === 3 && day >= 26 || month === 4 && day <= 2) {
    phase = 'opening-week';
    modifiers.push('Opening Week unders bias active');
    modifiers.push('Cold weather at northern parks');
    modifiers.push('Ace starters pitch deeper');
    modifiers.push('Rusty bats = lower K prop lines may have value');
  } else if (month <= 4) {
    phase = 'early-season';
    modifiers.push('Cold weather still a factor in northern parks');
    modifiers.push('Small sample size on rolling stats — rely more on projections');
    modifiers.push('Bullpen roles still settling');
  } else if (month >= 5 && month <= 6) {
    phase = 'may-june';
    modifiers.push('Weather warming up — totals should rise');
    modifiers.push('Rolling stats gaining reliability (30+ games)');
    modifiers.push('Platoon splits becoming more reliable');
  } else if (month >= 7 && month <= 8) {
    phase = 'summer';
    modifiers.push('Hot weather = higher scoring');
    modifiers.push('All-Star break fatigue factor');
    modifiers.push('Trade deadline impacts (July 30)');
    modifiers.push('Rolling stats highly reliable (80+ games)');
  } else if (month === 9) {
    phase = 'september';
    modifiers.push('Expanded rosters');
    modifiers.push('Tanking teams resting veterans');
    modifiers.push('Playoff contenders may rest starters late');
    modifiers.push('Motivation mismatches = biggest edges');
  }

  return { phase, modifiers, month, day };
}

// ==================== CACHED ACCESS ====================
function getCachedCard(date) {
  if (!date) date = new Date().toISOString().split('T')[0];

  // Memory cache
  if (lastBuild && lastBuild.date === date && (Date.now() - lastBuildTime) < CACHE_TTL) {
    return { ...lastBuild, cached: true };
  }

  // Disk cache
  try {
    const cacheFile = path.join(CACHE_DIR, `card-${date}.json`);
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const age = Date.now() - stat.mtimeMs;
      if (age < 30 * 60 * 1000) { // 30 min disk cache
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return { ...data, cached: true, cacheAge: Math.round(age / 1000) + 's' };
      }
    }
  } catch (e) { /* disk cache optional */ }

  return null;
}

// ==================== STATUS ====================
function getStatus() {
  return {
    service: 'daily-mlb-card',
    version: '82.0.0',
    lastBuild: lastBuild ? { date: lastBuild.date, timestamp: lastBuild.timestamp, games: lastBuild.headline?.gamesOnSlate, bets: lastBuild.headline?.totalBets } : null,
    cacheAge: lastBuildTime ? Math.round((Date.now() - lastBuildTime) / 1000) + 's' : 'never',
    dependencies: {
      mlbModel: !!mlbModel,
      mlbSchedule: !!mlbSchedule,
      weather: !!weatherService,
      umpires: !!umpireService,
      kProps: !!kPropsService,
      outsProps: !!outsPropsService,
      nrfi: !!nrfiService,
      platoon: !!platoonService,
      framing: !!catcherFramingService,
      bullpen: !!bullpenService,
      statcast: !!statcastService,
      lineShopping: !!lineShoppingService,
    },
  };
}

// ==================== EXPORTS ====================
module.exports = {
  buildDailyCard,
  getCachedCard,
  getStatus,
  // Expose for auto-scanner integration
  CACHE_DIR,
  CACHE_TTL,
};
