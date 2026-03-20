/**
 * SportsSim NHL Model
 * 
 * Pythagorean-based power ratings with goalie adjustment.
 * Math:
 *   Pyth W% = GF^2.05 / (GF^2.05 + GA^2.05)
 *   Power = GoalDiff * (1 - luck_penalty) + momentum
 *   Win Prob = logistic(spread / 4.5) with 2.5% HCA
 *   Goalie adj: starter vs backup save% difference
 */

const HIA = 0.025; // home ice advantage (~52.5%)
const PYTH_EXP = 2.05;
const LUCK_PENALTY = 0.5;
const MOMENTUM_WEIGHT = 0.15;
const SPREAD_FACTOR = 4.5;

// Live data integration
let liveData = null;
try { liveData = require('../services/live-data'); } catch (e) { /* fallback to static */ }

// Static goalie data (not available from standings APIs)
const GOALIE_DATA = {
  'BOS': { starter: 'Swayman', starterSv: 0.918, backupSv: 0.895 },
  'FLA': { starter: 'Bobrovsky', starterSv: 0.915, backupSv: 0.89 },
  'TOR': { starter: 'Stolarz', starterSv: 0.914, backupSv: 0.898 },
  'TBL': { starter: 'Vasilevskiy', starterSv: 0.916, backupSv: 0.892 },
  'CAR': { starter: 'Andersen', starterSv: 0.919, backupSv: 0.9 },
  'NJD': { starter: 'Markstrom', starterSv: 0.91, backupSv: 0.888 },
  'NYR': { starter: 'Shesterkin', starterSv: 0.92, backupSv: 0.885 },
  'OTT': { starter: 'Ullmark', starterSv: 0.912, backupSv: 0.89 },
  'DET': { starter: 'Lyon', starterSv: 0.908, backupSv: 0.892 },
  'MTL': { starter: 'Montembeault', starterSv: 0.905, backupSv: 0.888 },
  'BUF': { starter: 'Luukkonen', starterSv: 0.902, backupSv: 0.885 },
  'PIT': { starter: 'Nedeljkovic', starterSv: 0.906, backupSv: 0.89 },
  'PHI': { starter: 'Fedotov', starterSv: 0.905, backupSv: 0.888 },
  'WSH': { starter: 'Lindgren', starterSv: 0.916, backupSv: 0.895 },
  'CBJ': { starter: 'Merzlikins', starterSv: 0.898, backupSv: 0.882 },
  'NYI': { starter: 'Sorokin', starterSv: 0.914, backupSv: 0.89 },
  'WPG': { starter: 'Hellebuyck', starterSv: 0.924, backupSv: 0.895 },
  'DAL': { starter: 'Oettinger', starterSv: 0.918, backupSv: 0.898 },
  'COL': { starter: 'Georgiev', starterSv: 0.905, backupSv: 0.89 },
  'MIN': { starter: 'Gustavsson', starterSv: 0.917, backupSv: 0.9 },
  'VGK': { starter: 'Hill', starterSv: 0.913, backupSv: 0.895 },
  'EDM': { starter: 'Skinner', starterSv: 0.91, backupSv: 0.892 },
  'LAK': { starter: 'Kuemper', starterSv: 0.912, backupSv: 0.895 },
  'VAN': { starter: 'Demko', starterSv: 0.916, backupSv: 0.888 },
  'CGY': { starter: 'Wolf', starterSv: 0.912, backupSv: 0.892 },
  'STL': { starter: 'Binnington', starterSv: 0.905, backupSv: 0.888 },
  'SEA': { starter: 'Daccord', starterSv: 0.908, backupSv: 0.89 },
  'NSH': { starter: 'Saros', starterSv: 0.915, backupSv: 0.885 },
  'ARI': { starter: 'Vejmelka', starterSv: 0.9, backupSv: 0.882 },
  'ANA': { starter: 'Gibson', starterSv: 0.898, backupSv: 0.88 },
  'CHI': { starter: 'Brossoit', starterSv: 0.895, backupSv: 0.878 },
  'SJS': { starter: 'Blackwood', starterSv: 0.892, backupSv: 0.875 },
};

/**
 * Get current team data — live if available, static fallback
 */
function getTeams() {
  if (liveData) {
    const live = liveData.getNHLData();
    if (live && Object.keys(live).length >= 25) {
      const merged = {};
      for (const [abbr, t] of Object.entries(live)) {
        const goalie = GOALIE_DATA[abbr] || { starter: 'Unknown', starterSv: 0.905, backupSv: 0.888 };
        const staticTeam = STATIC_TEAMS[abbr] || {};
        merged[abbr] = {
          name: t.name,
          w: t.w,
          l: t.l,
          otl: t.otl,
          gf: t.gf,
          ga: t.ga,
          pp: staticTeam.pp || 20.0, // Power play % not in standings API
          pk: staticTeam.pk || 80.0, // Penalty kill % not in standings API
          sv: staticTeam.sv || 0.905,
          l10w: t.l10w,
          l10l: t.l10l,
          starter: goalie.starter,
          starterSv: goalie.starterSv,
          backupSv: goalie.backupSv
        };
      }
      return merged;
    }
  }
  return STATIC_TEAMS;
}

async function refreshData() {
  if (liveData) {
    await liveData.refreshAll(true);
  }
}

const STATIC_TEAMS = {
// Team data entries
  "BOS": {"name": "Boston Bruins", "w": 45, "l": 22, "otl": 5, "gf": 3.28, "ga": 2.65, "pp": 24.1, "pk": 82.3, "sv": 0.912, "l10w": 7, "l10l": 3, "starter": "Swayman", "starterSv": 0.918, "backupSv": 0.895},
  "FLA": {"name": "Florida Panthers", "w": 44, "l": 23, "otl": 5, "gf": 3.35, "ga": 2.72, "pp": 23.8, "pk": 83.1, "sv": 0.91, "l10w": 6, "l10l": 4, "starter": "Bobrovsky", "starterSv": 0.915, "backupSv": 0.89},
  "TOR": {"name": "Toronto Maple Leafs", "w": 43, "l": 21, "otl": 7, "gf": 3.41, "ga": 2.78, "pp": 25.2, "pk": 80.5, "sv": 0.908, "l10w": 6, "l10l": 3, "starter": "Stolarz", "starterSv": 0.914, "backupSv": 0.898},
  "TBL": {"name": "Tampa Bay Lightning", "w": 42, "l": 25, "otl": 5, "gf": 3.22, "ga": 2.71, "pp": 22.5, "pk": 81.8, "sv": 0.911, "l10w": 7, "l10l": 3, "starter": "Vasilevskiy", "starterSv": 0.916, "backupSv": 0.892},
  "CAR": {"name": "Carolina Hurricanes", "w": 41, "l": 24, "otl": 6, "gf": 3.12, "ga": 2.55, "pp": 21.3, "pk": 84.2, "sv": 0.916, "l10w": 5, "l10l": 4, "starter": "Andersen", "starterSv": 0.919, "backupSv": 0.9},
  "NJD": {"name": "New Jersey Devils", "w": 38, "l": 28, "otl": 6, "gf": 3.18, "ga": 2.88, "pp": 22.8, "pk": 79.5, "sv": 0.905, "l10w": 5, "l10l": 5, "starter": "Markstrom", "starterSv": 0.91, "backupSv": 0.888},
  "NYR": {"name": "New York Rangers", "w": 37, "l": 28, "otl": 7, "gf": 3.05, "ga": 2.82, "pp": 23.1, "pk": 80.2, "sv": 0.907, "l10w": 4, "l10l": 5, "starter": "Shesterkin", "starterSv": 0.92, "backupSv": 0.885},
  "OTT": {"name": "Ottawa Senators", "w": 36, "l": 30, "otl": 6, "gf": 3.08, "ga": 2.95, "pp": 21.5, "pk": 78.8, "sv": 0.902, "l10w": 5, "l10l": 5, "starter": "Ullmark", "starterSv": 0.912, "backupSv": 0.89},
  "DET": {"name": "Detroit Red Wings", "w": 35, "l": 31, "otl": 6, "gf": 2.95, "ga": 2.92, "pp": 20.8, "pk": 79.2, "sv": 0.904, "l10w": 4, "l10l": 5, "starter": "Lyon", "starterSv": 0.908, "backupSv": 0.892},
  "MTL": {"name": "Montreal Canadiens", "w": 33, "l": 33, "otl": 6, "gf": 2.85, "ga": 3.05, "pp": 19.5, "pk": 78.1, "sv": 0.899, "l10w": 4, "l10l": 6, "starter": "Montembeault", "starterSv": 0.905, "backupSv": 0.888},
  "BUF": {"name": "Buffalo Sabres", "w": 30, "l": 35, "otl": 7, "gf": 2.78, "ga": 3.15, "pp": 18.9, "pk": 77.5, "sv": 0.896, "l10w": 3, "l10l": 6, "starter": "Luukkonen", "starterSv": 0.902, "backupSv": 0.885},
  "PIT": {"name": "Pittsburgh Penguins", "w": 32, "l": 32, "otl": 8, "gf": 2.92, "ga": 3.02, "pp": 20.2, "pk": 78.5, "sv": 0.901, "l10w": 3, "l10l": 6, "starter": "Nedeljkovic", "starterSv": 0.906, "backupSv": 0.89},
  "PHI": {"name": "Philadelphia Flyers", "w": 31, "l": 33, "otl": 8, "gf": 2.82, "ga": 3.08, "pp": 19.2, "pk": 77.8, "sv": 0.898, "l10w": 4, "l10l": 5, "starter": "Fedotov", "starterSv": 0.905, "backupSv": 0.888},
  "WSH": {"name": "Washington Capitals", "w": 43, "l": 22, "otl": 7, "gf": 3.25, "ga": 2.68, "pp": 24.5, "pk": 82.8, "sv": 0.913, "l10w": 7, "l10l": 2, "starter": "Lindgren", "starterSv": 0.916, "backupSv": 0.895},
  "CBJ": {"name": "Columbus Blue Jackets", "w": 28, "l": 36, "otl": 8, "gf": 2.72, "ga": 3.22, "pp": 18.2, "pk": 76.5, "sv": 0.892, "l10w": 3, "l10l": 7, "starter": "Merzlikins", "starterSv": 0.898, "backupSv": 0.882},
  "NYI": {"name": "New York Islanders", "w": 34, "l": 29, "otl": 9, "gf": 2.88, "ga": 2.82, "pp": 19.8, "pk": 80.5, "sv": 0.908, "l10w": 4, "l10l": 5, "starter": "Sorokin", "starterSv": 0.914, "backupSv": 0.89},
  "WPG": {"name": "Winnipeg Jets", "w": 48, "l": 17, "otl": 6, "gf": 3.52, "ga": 2.48, "pp": 26.1, "pk": 84.5, "sv": 0.918, "l10w": 7, "l10l": 2, "starter": "Hellebuyck", "starterSv": 0.924, "backupSv": 0.895},
  "DAL": {"name": "Dallas Stars", "w": 43, "l": 22, "otl": 7, "gf": 3.18, "ga": 2.58, "pp": 22.8, "pk": 83.5, "sv": 0.915, "l10w": 6, "l10l": 3, "starter": "Oettinger", "starterSv": 0.918, "backupSv": 0.898},
  "COL": {"name": "Colorado Avalanche", "w": 42, "l": 24, "otl": 6, "gf": 3.42, "ga": 2.78, "pp": 25.5, "pk": 81.2, "sv": 0.909, "l10w": 6, "l10l": 3, "starter": "Georgiev", "starterSv": 0.905, "backupSv": 0.89},
  "MIN": {"name": "Minnesota Wild", "w": 41, "l": 25, "otl": 6, "gf": 3.15, "ga": 2.65, "pp": 22.2, "pk": 82.5, "sv": 0.913, "l10w": 6, "l10l": 3, "starter": "Gustavsson", "starterSv": 0.917, "backupSv": 0.9},
  "VGK": {"name": "Vegas Golden Knights", "w": 40, "l": 25, "otl": 7, "gf": 3.22, "ga": 2.75, "pp": 23.5, "pk": 81.8, "sv": 0.91, "l10w": 5, "l10l": 4, "starter": "Hill", "starterSv": 0.913, "backupSv": 0.895},
  "EDM": {"name": "Edmonton Oilers", "w": 39, "l": 26, "otl": 7, "gf": 3.38, "ga": 2.88, "pp": 27.2, "pk": 80.8, "sv": 0.906, "l10w": 5, "l10l": 4, "starter": "Skinner", "starterSv": 0.91, "backupSv": 0.892},
  "LAK": {"name": "Los Angeles Kings", "w": 38, "l": 27, "otl": 7, "gf": 3.05, "ga": 2.78, "pp": 21.5, "pk": 81.2, "sv": 0.909, "l10w": 5, "l10l": 4, "starter": "Kuemper", "starterSv": 0.912, "backupSv": 0.895},
  "VAN": {"name": "Vancouver Canucks", "w": 36, "l": 28, "otl": 8, "gf": 3.08, "ga": 2.92, "pp": 22.2, "pk": 79.5, "sv": 0.903, "l10w": 4, "l10l": 5, "starter": "Demko", "starterSv": 0.916, "backupSv": 0.888},
  "CGY": {"name": "Calgary Flames", "w": 35, "l": 29, "otl": 8, "gf": 2.95, "ga": 2.85, "pp": 20.5, "pk": 80.2, "sv": 0.906, "l10w": 5, "l10l": 4, "starter": "Wolf", "starterSv": 0.912, "backupSv": 0.892},
  "STL": {"name": "St. Louis Blues", "w": 33, "l": 32, "otl": 7, "gf": 2.88, "ga": 3.02, "pp": 20.8, "pk": 78.8, "sv": 0.9, "l10w": 4, "l10l": 5, "starter": "Binnington", "starterSv": 0.905, "backupSv": 0.888},
  "SEA": {"name": "Seattle Kraken", "w": 32, "l": 32, "otl": 8, "gf": 2.82, "ga": 2.98, "pp": 19.5, "pk": 79.2, "sv": 0.902, "l10w": 3, "l10l": 6, "starter": "Daccord", "starterSv": 0.908, "backupSv": 0.89},
  "NSH": {"name": "Nashville Predators", "w": 31, "l": 33, "otl": 8, "gf": 2.78, "ga": 3.05, "pp": 19.2, "pk": 78.5, "sv": 0.899, "l10w": 3, "l10l": 6, "starter": "Saros", "starterSv": 0.915, "backupSv": 0.885},
  "ARI": {"name": "Utah Hockey Club", "w": 28, "l": 36, "otl": 8, "gf": 2.68, "ga": 3.18, "pp": 18.5, "pk": 77.2, "sv": 0.894, "l10w": 2, "l10l": 7, "starter": "Vejmelka", "starterSv": 0.9, "backupSv": 0.882},
  "ANA": {"name": "Anaheim Ducks", "w": 27, "l": 37, "otl": 8, "gf": 2.62, "ga": 3.25, "pp": 17.8, "pk": 76.8, "sv": 0.891, "l10w": 2, "l10l": 7, "starter": "Gibson", "starterSv": 0.898, "backupSv": 0.88},
  "CHI": {"name": "Chicago Blackhawks", "w": 25, "l": 39, "otl": 8, "gf": 2.55, "ga": 3.35, "pp": 17.2, "pk": 76.2, "sv": 0.888, "l10w": 2, "l10l": 8, "starter": "Brossoit", "starterSv": 0.895, "backupSv": 0.878},
  "SJS": {"name": "San Jose Sharks", "w": 23, "l": 40, "otl": 9, "gf": 2.48, "ga": 3.42, "pp": 16.8, "pk": 75.5, "sv": 0.885, "l10w": 1, "l10l": 8, "starter": "Blackwood", "starterSv": 0.892, "backupSv": 0.875},
};

// TEAMS is a dynamic getter — returns live data when available
const TEAMS = new Proxy({}, {
  get(target, prop) { return getTeams()[prop]; },
  ownKeys() { return Object.keys(getTeams()); },
  has(target, prop) { return prop in getTeams(); },
  getOwnPropertyDescriptor(target, prop) {
    const teams = getTeams();
    if (prop in teams) return { configurable: true, enumerable: true, value: teams[prop] };
    return undefined;
  }
});

function pythWinPct(gf, ga) {
  const gfExp = Math.pow(gf, PYTH_EXP);
  return gfExp / (gfExp + Math.pow(ga, PYTH_EXP));
}

function calculateRatings() {
  const ratings = {};
  for (const [code, t] of Object.entries(TEAMS)) {
    const gp = t.w + t.l + t.otl;
    const actualWPct = (t.w + t.otl * 0.5) / gp; // OTL = half a win in standings
    const pythWPct = pythWinPct(t.gf, t.ga);
    const luck = actualWPct - pythWPct;
    const goalDiff = t.gf - t.ga;
    
    // L10 momentum
    const l10WPct = t.l10w / 10;
    const seasonWPct = actualWPct;
    const momentum = l10WPct - seasonWPct;
    
    // Power rating: goal diff adjusted for luck + momentum
    const power = goalDiff - (luck * LUCK_PENALTY * 5) + (momentum * MOMENTUM_WEIGHT * 5);
    
    // Special teams composite
    const specialTeams = (t.pp / 100) + (t.pk / 100) - 1; // net special teams
    
    ratings[code] = {
      code, name: t.name,
      w: t.w, l: t.l, otl: t.otl, gp,
      gf: t.gf, ga: t.ga, goalDiff: +goalDiff.toFixed(2),
      actualWPct: +(actualWPct * 100).toFixed(1),
      pythWPct: +(pythWPct * 100).toFixed(1),
      luck: +(luck * 100).toFixed(1),
      momentum: +(momentum * 100).toFixed(1),
      power: +power.toFixed(2),
      specialTeams: +(specialTeams * 100).toFixed(1),
      pp: t.pp, pk: t.pk, sv: t.sv,
      starter: t.starter, starterSv: t.starterSv, backupSv: t.backupSv
    };
  }
  return ratings;
}

function predict(awayCode, homeCode, options = {}) {
  const ratings = calculateRatings();
  const away = ratings[awayCode];
  const home = ratings[homeCode];
  if (!away || !home) return null;

  // Goalie adjustment: delta from league avg save% (0.905)
  const leagueAvgSv = 0.905;
  let homeGoalieAdj = 0;
  let awayGoalieAdj = 0;
  
  if (options.homeGoalie === 'backup') {
    homeGoalieAdj = (TEAMS[homeCode].backupSv - leagueAvgSv) * 15;
  } else {
    homeGoalieAdj = (TEAMS[homeCode].starterSv - leagueAvgSv) * 15;
  }
  if (options.awayGoalie === 'backup') {
    awayGoalieAdj = (TEAMS[awayCode].backupSv - leagueAvgSv) * 15;
  } else {
    awayGoalieAdj = (TEAMS[awayCode].starterSv - leagueAvgSv) * 15;
  }

  // Spread = power diff + HIA (in goal terms) + goalie adj
  const hiaGoals = HIA * SPREAD_FACTOR * 2; // ~0.225 goals
  const rawSpread = (home.power - away.power) + hiaGoals + homeGoalieAdj - awayGoalieAdj;
  const spread = +rawSpread.toFixed(2);

  // Win probability via logistic
  const homeWinProb = 1 / (1 + Math.pow(10, -spread / SPREAD_FACTOR));
  const awayWinProb = 1 - homeWinProb;

  // Puck line (+/- 1.5) probability
  // Approx: shift spread by 1.5 goals
  const puckLineHomeProb = 1 / (1 + Math.pow(10, -(spread - 1.5) / SPREAD_FACTOR));
  const puckLineAwayProb = 1 / (1 + Math.pow(10, -(-spread - 1.5) / SPREAD_FACTOR));

  // Total projection
  const avgTotal = (TEAMS[awayCode].gf + TEAMS[homeCode].gf + TEAMS[awayCode].ga + TEAMS[homeCode].ga) / 2;
  const projTotal = +avgTotal.toFixed(1);

  // Moneyline conversion
  function probToML(p) {
    if (p >= 0.5) return Math.round(-100 * p / (1 - p));
    return Math.round(100 * (1 - p) / p);
  }

  return {
    away: { code: awayCode, name: away.name, power: away.power, winProb: +(awayWinProb * 100).toFixed(1), ml: probToML(awayWinProb) },
    home: { code: homeCode, name: home.name, power: home.power, winProb: +(homeWinProb * 100).toFixed(1), ml: probToML(homeWinProb) },
    spread: spread,
    projTotal,
    puckLine: {
      home: { line: "-1.5", prob: +(puckLineHomeProb * 100).toFixed(1) },
      away: { line: "+1.5", prob: +((1 - puckLineHomeProb) * 100).toFixed(1) }
    },
    goalieAdj: { home: +homeGoalieAdj.toFixed(2), away: +awayGoalieAdj.toFixed(2) }
  };
}

function findValue(predictions, bookLines) {
  if (!bookLines || !bookLines.length) return [];
  const values = [];
  for (const game of bookLines) {
    const pred = predict(game.awayTeam, game.homeTeam);
    if (!pred) continue;
    
    // Convert book ML to implied prob
    function mlToProb(ml) {
      if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
      return 100 / (ml + 100);
    }
    
    if (game.homeML) {
      const bookHomeProb = mlToProb(game.homeML);
      const edge = pred.home.winProb / 100 - bookHomeProb;
      if (edge > 0.02) {
        values.push({
          game: `${pred.away.name} @ ${pred.home.name}`,
          pick: pred.home.name,
          side: 'home',
          modelProb: pred.home.winProb,
          bookProb: +(bookHomeProb * 100).toFixed(1),
          edge: +(edge * 100).toFixed(1),
          bookML: game.homeML,
          modelML: pred.home.ml,
          kelly: +kellyBet(pred.home.winProb / 100, game.homeML).toFixed(3)
        });
      }
    }
    if (game.awayML) {
      const bookAwayProb = mlToProb(game.awayML);
      const edge = pred.away.winProb / 100 - bookAwayProb;
      if (edge > 0.02) {
        values.push({
          game: `${pred.away.name} @ ${pred.home.name}`,
          pick: pred.away.name,
          side: 'away',
          modelProb: pred.away.winProb,
          bookProb: +(bookAwayProb * 100).toFixed(1),
          edge: +(edge * 100).toFixed(1),
          bookML: game.awayML,
          modelML: pred.away.ml,
          kelly: +kellyBet(pred.away.winProb / 100, game.awayML).toFixed(3)
        });
      }
    }
  }
  return values.sort((a, b) => b.edge - a.edge);
}

function kellyBet(prob, ml) {
  const b = ml > 0 ? ml / 100 : 100 / Math.abs(ml);
  const q = 1 - prob;
  const kelly = (b * prob - q) / b;
  return Math.max(0, kelly);
}

module.exports = { TEAMS, getTeams, calculateRatings, predict, findValue, pythWinPct, refreshData };
