// models/mlb-opening-day.js — MLB 2026 Opening Day Projections v3.1
// UPDATED: Real ESPN confirmed starters + DraftKings opening lines
// Updated 2026-03-21 with confirmed data from ESPN schedule (refreshed 22:40 UTC)
//
// Opening Day = MONEY TIME. Every edge counts.

const mlb = require('./mlb');
const pitchers = require('./mlb-pitchers');

// Services (optional — graceful fallback)
let weatherService = null;
let injuryService = null;
let rollingStats = null;
let restTravel = null;
let mlbSchedule = null;
let preseasonTuning = null;
try { weatherService = require('../services/weather'); } catch (e) {}
try { injuryService = require('../services/injuries'); } catch (e) {}
try { rollingStats = require('../services/rolling-stats'); } catch (e) {}
try { restTravel = require('../services/rest-travel'); } catch (e) {}
try { mlbSchedule = require('../services/mlb-schedule'); } catch (e) {}
try { preseasonTuning = require('../services/preseason-tuning'); } catch (e) {}

// ==================== OPENING DAY SCHEDULE ====================
// Full 2026 Opening Day schedule: March 26-27
// CONFIRMED starters from ESPN as of March 21, 2026
// DraftKings opening lines scraped March 21, 2026

const OPENING_DAY_GAMES = [
  // ===== MARCH 26, 2026 — DAY 1 (Thursday) =====
  { 
    date: '2026-03-26', day: 1, away: 'PIT', home: 'NYM', time: '1:15 PM ET',
    confirmedStarters: { away: 'Paul Skenes', home: 'Freddy Peralta' },
    dkLine: { homeML: -126, awayML: 106, total: 6.5 }, // NYM -126, PIT+NYM ace duel — UPDATED 3/24 from ESPN/DK
    broadcast: 'NBC/Peacock',
  },
  { 
    date: '2026-03-26', day: 1, away: 'CWS', home: 'MIL', time: '2:10 PM ET',
    confirmedStarters: { away: 'Shane Smith', home: 'Jacob Misiorowski' },
    dkLine: { homeML: -200, awayML: 170, total: 8.5 }, // MIL -200 — UPDATED 3/24 from ESPN/DK
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'WSH', home: 'CHC', time: '2:20 PM ET',
    confirmedStarters: { away: 'Cade Cavalli', home: 'Matthew Boyd' },
    dkLine: { homeML: -208, awayML: 176, total: 9.0 }, // CHC -208, Wrigley — UPDATED 3/24 from ESPN/DK (total 9.0!)
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'MIN', home: 'BAL', time: '3:05 PM ET',
    confirmedStarters: { away: 'Joe Ryan', home: 'Trevor Rogers' },
    dkLine: { homeML: -150, awayML: 128, total: 8.5 }, // BAL -150, Camden Yards — UPDATED 3/24 from ESPN/DK
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'BOS', home: 'CIN', time: '4:10 PM ET',
    confirmedStarters: { away: 'Garrett Crochet', home: 'Andrew Abbott' },
    dkLine: { homeML: 133, awayML: -157, total: 8.5 }, // BOS -157, GABP — UPDATED 3/24 from ESPN/DK (total moved to 8.5)
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'LAA', home: 'HOU', time: '4:10 PM ET',
    confirmedStarters: { away: 'Jose Soriano', home: 'Hunter Brown' },
    dkLine: { homeML: -187, awayML: 158, total: 8.5 }, // HOU -187, dome — UPDATED 3/24 from ESPN/DK (total 8.5)
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'DET', home: 'SD', time: '4:10 PM ET',
    confirmedStarters: { away: 'Tarik Skubal', home: 'Nick Pivetta' },
    dkLine: { homeML: 117, awayML: -137, total: 7.5 }, // DET -137, Petco pitcher park — UPDATED 3/24 from ESPN/DK (total 7.5)
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'TB', home: 'STL', time: '4:15 PM ET',
    confirmedStarters: { away: 'Drew Rasmussen', home: 'Matthew Liberatore' },
    dkLine: { homeML: 106, awayML: -126, total: 7.5 }, // TB -126, Busch Stadium — UPDATED 3/24 (total 7.5, was 9.0)
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'TEX', home: 'PHI', time: '4:15 PM ET',
    confirmedStarters: { away: 'Nathan Eovaldi', home: 'Cristopher Sanchez' },
    dkLine: { homeML: -150, awayML: 128, total: 8.5 }, // PHI -150, CBP — UPDATED 3/24 from ESPN/DK
    broadcast: null,
  },
  { 
    date: '2026-03-26', day: 1, away: 'ARI', home: 'LAD', time: '8:30 PM ET',
    confirmedStarters: { away: 'Zac Gallen', home: 'Yoshinobu Yamamoto' },
    dkLine: { homeML: -233, awayML: 194, total: 9.5 }, // LAD -233, Dodger Stadium — UPDATED 3/24 (total 9.5! Books love LAD offense)
    broadcast: 'NBC/Peacock',
  },
  { 
    date: '2026-03-26', day: 1, away: 'CLE', home: 'SEA', time: '10:10 PM ET',
    confirmedStarters: { away: 'Tanner Bibee', home: 'Logan Gilbert' },
    dkLine: { homeML: -177, awayML: 150, total: 6.5 }, // SEA -177, T-Mobile pitcher park — UPDATED 3/24 (total 6.5!)
    broadcast: null,
  },

  // ===== MARCH 27, 2026 — DAY 2 (Friday) =====
  { 
    date: '2026-03-27', day: 2, away: 'NYY', home: 'SF', time: '4:35 PM ET',
    confirmedStarters: { away: 'Cam Schlittler', home: 'Logan Webb' },
    dkLine: { homeML: 142, awayML: -168, total: 7.0 }, // NYY -168, Oracle Park pitcher-friendly
    broadcast: null,
  },
  { 
    date: '2026-03-27', day: 2, away: 'OAK', home: 'TOR', time: '7:07 PM ET',
    confirmedStarters: { away: 'Luis Severino', home: 'Kevin Gausman' },
    dkLine: { homeML: -182, awayML: 154, total: 8.0 }, // TOR -182, UPDATED 3/24 from ESPN/DK
    broadcast: null,
  },
  { 
    date: '2026-03-27', day: 2, away: 'COL', home: 'MIA', time: '7:10 PM ET',
    confirmedStarters: { away: 'Kyle Freeland', home: 'Sandy Alcantara' },
    dkLine: { homeML: -177, awayML: 150, total: 7.5 }, // COL@MIA, MIA -177 — UPDATED 3/24 from ESPN/DK
    broadcast: null,
  },
  { 
    date: '2026-03-27', day: 2, away: 'KC', home: 'ATL', time: '7:15 PM ET',
    confirmedStarters: { away: 'Cole Ragans', home: 'Chris Sale' },
    dkLine: { homeML: -152, awayML: 128, total: 8.0 }, // KC@ATL, ATL -152 — UPDATED 3/24 from ESPN/DK
    broadcast: null,
  },
  // Day 2 series continuations (Game 2 starters)
  { 
    date: '2026-03-27', day: 2, away: 'LAA', home: 'HOU', time: '8:10 PM ET',
    confirmedStarters: { away: 'Yusei Kikuchi', home: 'Mike Burrows' },
    dkLine: { homeML: -145, awayML: 122, total: 8.0 }, // HOU home fav, Minute Maid dome
    broadcast: 'Apple TV',
    isGame2: true,
  },
  { 
    date: '2026-03-27', day: 2, away: 'DET', home: 'SD', time: '9:40 PM ET',
    confirmedStarters: { away: 'Framber Valdez', home: 'Michael King' },
    dkLine: { homeML: 128, awayML: -150, total: 7.0 }, // DET fav (Valdez ace), Petco pitchers park
    broadcast: null,
    isGame2: true,
  },
  // CHC@SD removed — CHC plays WSH@CHC on 3/26-3/28, not SD. ESPN confirms 8 Day 2 games only.
  { 
    date: '2026-03-27', day: 2, away: 'ARI', home: 'LAD', time: '10:10 PM ET',
    confirmedStarters: { away: 'Ryne Nelson', home: 'Emmet Sheehan' },
    dkLine: { homeML: -225, awayML: 188, total: 8.0 }, // LAD heavy fav, Sheehan at home
    broadcast: null,
    isGame2: true,
  },
  { 
    date: '2026-03-27', day: 2, away: 'CLE', home: 'SEA', time: '9:40 PM ET',
    confirmedStarters: { away: 'Gavin Williams', home: 'Luis Castillo' },
    dkLine: { homeML: -185, awayML: 156, total: 7.0 }, // SEA home fav, T-Mobile pitcher park
    broadcast: 'Apple TV',
    isGame2: true,
  },
];

// ==================== SPRING TRAINING STANDINGS ====================
// From ESPN/Sportradar as of March 21, 2026
// Cactus League

const SPRING_TRAINING_RECORDS = {
  // Updated from MLB Stats API — March 24, 2026 (final ST week)
  // Cactus League
  'LAD': { w: 20, l: 8, pct: 0.714 },
  'SF':  { w: 19, l: 9, pct: 0.679 },
  'TEX': { w: 17, l: 12, pct: 0.586 },
  'CWS': { w: 15, l: 16, pct: 0.484 },
  'LAA': { w: 16, l: 15, pct: 0.516 },
  'SD':  { w: 15, l: 15, pct: 0.500 },
  'ARI': { w: 15, l: 14, pct: 0.517 },
  'CLE': { w: 15, l: 14, pct: 0.517 },
  'COL': { w: 15, l: 14, pct: 0.517 },
  'CIN': { w: 14, l: 16, pct: 0.467 },
  'OAK': { w: 14, l: 16, pct: 0.467 },
  'MIL': { w: 13, l: 16, pct: 0.448 },
  'CHC': { w: 14, l: 16, pct: 0.467 },
  'SEA': { w: 11, l: 19, pct: 0.367 },
  'KC':  { w: 9, l: 20, pct: 0.310 },
  // Grapefruit League — from MLB Stats API March 24
  'ATL': { w: 20, l: 7, pct: 0.741 },  // ⚡ #1 overall — was underrated
  'NYY': { w: 18, l: 12, pct: 0.600 },
  'STL': { w: 17, l: 9, pct: 0.654 },   // ⚡ Strong spring — up from .462
  'PIT': { w: 17, l: 13, pct: 0.567 },   // ⚡ Much better than .462
  'WSH': { w: 14, l: 11, pct: 0.560 },
  'BOS': { w: 13, l: 15, pct: 0.464 },   // ⚠️ Down from .556
  'BAL': { w: 13, l: 13, pct: 0.500 },
  'TOR': { w: 12, l: 14, pct: 0.462 },
  'NYM': { w: 12, l: 13, pct: 0.480 },
  'TB':  { w: 11, l: 17, pct: 0.393 },   // ⚠️ Down from .500
  'MIA': { w: 11, l: 13, pct: 0.458 },
  'HOU': { w: 11, l: 14, pct: 0.440 },
  'DET': { w: 8, l: 13, pct: 0.381 },    // ⚠️ DOWN from .577 — rough spring
  'PHI': { w: 10, l: 17, pct: 0.370 },   // ⚠️ Down from .500
  'MIN': { w: 10, l: 18, pct: 0.357 },   // ⚠️ Terrible spring
};

// ==================== SPRING TRAINING SIGNALS ====================
// Updated with real 2026 spring training data
const SPRING_TRAINING_SIGNALS = {
  'LAD': { offense: 0.6, pitching: 0.4, note: 'Dominant spring (20-8), Ohtani/Betts/Freeman loaded' },
  'SF':  { offense: 0.4, pitching: 0.3, note: 'Strong spring (19-9), surprise contender signals' },
  'TEX': { offense: 0.3, pitching: 0.2, note: 'Solid spring (17-12), Eovaldi anchoring rotation' },
  'ATL': { offense: 0.5, pitching: 0.5, note: '⚡ BEST spring (20-7, .741), Sale+Acuña+lineup clicking' },
  'STL': { offense: 0.3, pitching: 0.3, note: '⚡ Strong spring (17-9, .654), Liberatore OD starter but team is rolling' },
  'NYY': { offense: 0.3, pitching: 0.3, note: 'Good spring (18-12), deep lineup + rotation' },
  'PIT': { offense: 0.3, pitching: 0.4, note: '⚡ Strong spring (17-13), Skenes ace, Ozuna/Lowe added' },
  'WSH': { offense: 0.1, pitching: 0.0, note: 'Decent spring (14-11), Cavalli getting OD shot' },
  'BOS': { offense: 0.1, pitching: 0.3, note: '⚠️ Below avg spring (13-15), Crochet still elite though' },
  'DET': { offense: -0.1, pitching: 0.4, note: '⚠️ Rough spring (8-13), Skubal still dominant ace but team cold' },
  'NYM': { offense: 0.2, pitching: 0.2, note: 'Peralta acquisition, OK spring (12-13)' },
  'BAL': { offense: 0.2, pitching: 0.1, note: 'Even spring (13-13), Rogers OD starter' },
  'PHI': { offense: 0.0, pitching: 0.1, note: '⚠️ Poor spring (10-17), Sanchez OD, Harper healthy though' },
  'SD':  { offense: 0.1, pitching: 0.1, note: 'Even spring (15-15), Castellanos acquisition' },
  'HOU': { offense: 0.0, pitching: 0.0, note: 'Below avg spring (11-14), rotation rebuild' },
  'CLE': { offense: -0.2, pitching: 0.3, note: 'Decent spring (15-14), elite pitching thin offense' },
  'MIL': { offense: 0.1, pitching: -0.1, note: 'Below avg spring (13-16), lost Peralta+Williams' },
  'CWS': { offense: -0.3, pitching: -0.4, note: 'Near .500 spring (15-16) but still rebuilding — floor raised?' },
  'SEA': { offense: -0.2, pitching: 0.2, note: 'Poor spring (11-19), offense major question mark' },
  'KC':  { offense: -0.2, pitching: 0.1, note: '⚠️ WORST spring (9-20), but Ragans is legit' },
  'COL': { offense: 0.0, pitching: -0.5, note: 'Even spring (15-14), Coors Field pitching nightmare' },
  'OAK': { offense: -0.3, pitching: -0.2, note: 'Below avg spring (14-16), Severino OD starter' },
  'MIA': { offense: -0.2, pitching: 0.2, note: 'Below avg spring (11-13), but Alcantara returning is big' },
  'TOR': { offense: -0.1, pitching: 0.2, note: 'Below avg spring (12-14), Gausman still solid' },
  'MIN': { offense: -0.1, pitching: 0.0, note: '⚠️ Bad spring (10-18), Joe Ryan OD starter — cold bats' },
  'TB':  { offense: -0.2, pitching: 0.1, note: '⚠️ Poor spring (11-17), Rasmussen returning from injury' },
  'CHC': { offense: 0.0, pitching: -0.1, note: 'Below avg spring (14-16), Boyd OD starter concerning' },
  'CIN': { offense: 0.0, pitching: 0.0, note: 'Below avg spring (14-16), Abbott getting OD nod' },
  'LAA': { offense: 0.0, pitching: 0.0, note: 'Decent spring (16-15), Soriano as OD starter' },
};

// ==================== ENHANCED PROJECTION ENGINE ====================

async function getProjections() {
  const games = [];
  
  // Try to fetch latest confirmed starters from ESPN (supplement our hardcoded data)
  let espnStarters = {};
  if (mlbSchedule) {
    try {
      const day1 = await mlbSchedule.getSchedule('2026-03-26');
      const day2 = await mlbSchedule.getSchedule('2026-03-27');
      
      for (const schedule of [day1, day2]) {
        if (!schedule || !schedule.games) continue;
        for (const game of schedule.games) {
          const key = `${game.awayTeam.abbr}@${game.homeTeam.abbr}_${schedule.date}`;
          espnStarters[key] = {
            away: game.awayTeam.probablePitcher?.name || null,
            home: game.homeTeam.probablePitcher?.name || null,
            espnOdds: game.odds || null,
          };
        }
      }
    } catch (e) {
      console.error('Opening Day: ESPN starters fetch failed:', e.message);
    }
  }

  // Fetch all weather data in parallel
  let allWeather = {};
  if (weatherService) {
    try {
      allWeather = await weatherService.getAllWeather();
    } catch (e) {
      console.error('Opening Day: weather fetch failed:', e.message);
    }
  }

  for (const game of OPENING_DAY_GAMES) {
    try {
      // Determine starters: use our confirmed data, supplement with ESPN
      let awayStarterName = game.confirmedStarters?.away;
      let homeStarterName = game.confirmedStarters?.home;
      
      // Try ESPN for any missing starters
      const starterKey = `${game.away}@${game.home}_${game.date}`;
      if (espnStarters[starterKey]) {
        if (!awayStarterName) awayStarterName = espnStarters[starterKey].away;
        if (!homeStarterName) homeStarterName = espnStarters[starterKey].home;
      }
      
      // Fallback to team's ace/rotation
      const awayRotation = pitchers.getTeamRotation(game.away);
      const homeRotation = pitchers.getTeamRotation(game.home);
      
      if (!awayStarterName && awayRotation) {
        awayStarterName = (game.isGame2 ? (awayRotation[1] || awayRotation[0]) : awayRotation[0]).name;
      }
      if (!homeStarterName && homeRotation) {
        homeStarterName = (game.isGame2 ? (homeRotation[1] || homeRotation[0]) : homeRotation[0]).name;
      }

      // Look up pitcher objects
      const awayStarter = pitchers.getPitcherByName(awayStarterName) || 
        (awayRotation ? awayRotation.find(p => p.name.toLowerCase().includes(awayStarterName?.toLowerCase()?.split(' ').pop())) : null) ||
        (awayRotation ? awayRotation[0] : null);
      const homeStarter = pitchers.getPitcherByName(homeStarterName) ||
        (homeRotation ? homeRotation.find(p => p.name.toLowerCase().includes(homeStarterName?.toLowerCase()?.split(' ').pop())) : null) ||
        (homeRotation ? homeRotation[0] : null);

      if (!awayStarter || !homeStarter) continue;

      const starterSource = (game.confirmedStarters?.away && game.confirmedStarters?.home) 
        ? 'ESPN Confirmed' 
        : (game.confirmedStarters?.away || game.confirmedStarters?.home)
          ? 'Partial ESPN / Projected'
          : 'Projected Rotation';

      // Build prediction options with all available factors
      const predOpts = {
        awayPitcher: awayStarter.name,
        homePitcher: homeStarter.name,
        monteCarlo: true,
        numSims: 20000,
      };

      // Weather
      const homeWeather = allWeather[game.home];
      if (homeWeather && !homeWeather.error) {
        predOpts.weather = homeWeather;
      }

      // Rest/Travel (Opening Day = everyone is rested, but travel matters)
      if (restTravel) {
        try {
          const restData = await restTravel.getMatchupAdjustments(game.away, game.home, game.date);
          if (restData) predOpts.restTravel = restData;
        } catch (e) { /* no rest data for opening day is fine */ }
      }

      // Run the full prediction model
      const prediction = mlb.predict(game.away, game.home, predOpts);
      if (prediction.error) continue;

      // Also run matchup analysis
      const matchup = mlb.analyzeMatchup(game.away, game.home, predOpts);

      // Park info
      const homeTeam = mlb.TEAMS[game.home];
      const parkName = homeTeam ? homeTeam.park : 'Unknown';
      const parkFactor = mlb.PARK_FACTORS[parkName] || 1.0;

      // Injury data
      let awayInjuries = null, homeInjuries = null;
      if (injuryService) {
        try {
          awayInjuries = injuryService.getInjuryAdjustment('mlb', game.away);
          homeInjuries = injuryService.getInjuryAdjustment('mlb', game.home);
        } catch (e) {}
      }

      // Spring training signals
      const awaySpring = SPRING_TRAINING_SIGNALS[game.away] || { offense: 0, pitching: 0, note: 'No signal' };
      const homeSpring = SPRING_TRAINING_SIGNALS[game.home] || { offense: 0, pitching: 0, note: 'No signal' };
      const awaySTRecord = SPRING_TRAINING_RECORDS[game.away];
      const homeSTRecord = SPRING_TRAINING_RECORDS[game.home];

      // Use blended MC probability if available
      const bestHomeProb = prediction.blendedHomeWinProb || prediction.homeWinProb;
      const bestAwayProb = prediction.blendedAwayWinProb || prediction.awayWinProb;
      const bestHomeML = prediction.blendedHomeML || prediction.homeML;
      const bestAwayML = prediction.blendedAwayML || prediction.awayML;

      // ==================== LIVE ODDS VALUE DETECTION ====================
      let valueAnalysis = null;
      const dkLine = game.dkLine;
      
      if (dkLine) {
        // Convert DK lines to implied probabilities
        const dkHomeImplied = dkLine.homeML < 0 
          ? (-dkLine.homeML) / (-dkLine.homeML + 100) 
          : 100 / (dkLine.homeML + 100);
        const dkAwayImplied = dkLine.awayML < 0
          ? (-dkLine.awayML) / (-dkLine.awayML + 100)
          : 100 / (dkLine.awayML + 100);
        
        // Remove vig (total implied > 1.0)
        const totalJuice = dkHomeImplied + dkAwayImplied;
        const dkHomeNoVig = dkHomeImplied / totalJuice;
        const dkAwayNoVig = dkAwayImplied / totalJuice;
        
        const homeEdge = bestHomeProb - dkHomeNoVig;
        const awayEdge = bestAwayProb - dkAwayNoVig;
        
        // Calculate EV per $100
        const homeEV = bestHomeProb * (dkLine.homeML > 0 ? dkLine.homeML : 10000 / (-dkLine.homeML)) - (1 - bestHomeProb) * 100;
        const awayEV = bestAwayProb * (dkLine.awayML > 0 ? dkLine.awayML : 10000 / (-dkLine.awayML)) - (1 - bestAwayProb) * 100;
        
        const bestSide = homeEdge > awayEdge ? 'home' : 'away';
        const bestEdge = Math.max(homeEdge, awayEdge);
        const bestEV = bestSide === 'home' ? homeEV : awayEV;
        
        valueAnalysis = {
          draftKings: {
            homeML: dkLine.homeML,
            awayML: dkLine.awayML,
            homeImplied: +(dkHomeNoVig * 100).toFixed(1),
            awayImplied: +(dkAwayNoVig * 100).toFixed(1),
            juice: +((totalJuice - 1) * 100).toFixed(1),
          },
          model: {
            homeProb: +(bestHomeProb * 100).toFixed(1),
            awayProb: +(bestAwayProb * 100).toFixed(1),
            homeML: bestHomeML,
            awayML: bestAwayML,
          },
          edges: {
            home: {
              team: game.home,
              edge: +(homeEdge * 100).toFixed(1),
              ev: +homeEV.toFixed(1),
              hasValue: homeEdge > 0.02,
              rating: homeEdge > 0.08 ? '🔥🔥 STRONG' : homeEdge > 0.04 ? '🔥 GOOD' : homeEdge > 0.02 ? '✅ SLIGHT' : '❌ NO VALUE',
            },
            away: {
              team: game.away,
              edge: +(awayEdge * 100).toFixed(1),
              ev: +awayEV.toFixed(1),
              hasValue: awayEdge > 0.02,
              rating: awayEdge > 0.08 ? '🔥🔥 STRONG' : awayEdge > 0.04 ? '🔥 GOOD' : awayEdge > 0.02 ? '✅ SLIGHT' : '❌ NO VALUE',
            },
          },
          bestBet: bestEdge > 0.02 ? {
            team: bestSide === 'home' ? game.home : game.away,
            side: bestSide,
            ml: bestSide === 'home' ? dkLine.homeML : dkLine.awayML,
            edge: +(bestEdge * 100).toFixed(1),
            ev: +bestEV.toFixed(1),
            confidence: bestEdge > 0.08 ? 'HIGH' : bestEdge > 0.04 ? 'MEDIUM' : 'LOW',
          } : null,
        };
      }

      // Confidence tier — enhanced scoring
      const spread = Math.abs(bestHomeProb - bestAwayProb);
      const pitcherSpread = Math.abs((awayStarter.rating || 50) - (homeStarter.rating || 50));
      let confidenceScore = spread * 100 + pitcherSpread * 0.3;
      if (homeWeather && homeWeather.multiplier && Math.abs(homeWeather.multiplier - 1.0) > 0.03) {
        confidenceScore += 5;
      }
      // Boost confidence if we have DK line and see an edge
      if (valueAnalysis && valueAnalysis.bestBet) {
        confidenceScore += valueAnalysis.bestBet.edge * 2;
      }
      
      let confidence;
      if (confidenceScore >= 30) confidence = 'HIGH';
      else if (confidenceScore >= 15) confidence = 'MEDIUM';
      else confidence = 'LOW';

      // O/U analysis
      let ouSuggestion = null;
      if (prediction.totals && prediction.totals.lines) {
        const lines = Object.keys(prediction.totals.lines).map(Number).sort((a, b) => a - b);
        let bestLine = 8.5, bestEdge = 0, bestSide = null;
        for (const line of lines) {
          const data = prediction.totals.lines[line];
          const overEdge = data.over - 0.522;
          const underEdge = data.under - 0.522;
          if (overEdge > bestEdge) { bestEdge = overEdge; bestSide = 'Over'; bestLine = line; }
          if (underEdge > bestEdge) { bestEdge = underEdge; bestSide = 'Under'; bestLine = line; }
        }
        if (bestSide && bestEdge > 0.02) {
          ouSuggestion = {
            line: bestLine,
            side: bestSide,
            prob: bestSide === 'Over' ? prediction.totals.lines[bestLine].over : prediction.totals.lines[bestLine].under,
            edge: +(bestEdge * 100).toFixed(1),
          };
        }
      }

      // F5 analysis
      let f5Suggestion = null;
      if (prediction.f5Total) {
        const f5Mid = prediction.f5Total;
        const f5Line = Math.round(f5Mid * 2) / 2;
        const f5Diff = f5Mid - f5Line;
        if (Math.abs(f5Diff) >= 0.3) {
          f5Suggestion = {
            line: f5Line,
            side: f5Diff > 0 ? 'Over' : 'Under',
            projected: +f5Mid.toFixed(1),
            diff: +f5Diff.toFixed(1),
          };
        }
      }

      // Build key factors
      const keyFactors = matchup.matchup ? [...matchup.matchup.keyFactors] : [];
      
      if (homeWeather && homeWeather.description && homeWeather.description !== 'Dome stadium — weather irrelevant') {
        keyFactors.push(`⛅ ${homeWeather.description} (${homeWeather.totalImpact > 0 ? '+' : ''}${homeWeather.totalImpact}% run adj)`);
      }
      if (awaySpring.note !== 'No signal') keyFactors.push(`🌴 ${game.away}: ${awaySpring.note}`);
      if (homeSpring.note !== 'No signal') keyFactors.push(`🌴 ${game.home}: ${homeSpring.note}`);
      if (awayInjuries && awayInjuries.starPlayersOut.length > 0) {
        keyFactors.push(`🏥 ${game.away} missing: ${awayInjuries.starPlayersOut.map(p => p.player).join(', ')}`);
      }
      if (homeInjuries && homeInjuries.starPlayersOut.length > 0) {
        keyFactors.push(`🏥 ${game.home} missing: ${homeInjuries.starPlayersOut.map(p => p.player).join(', ')}`);
      }
      keyFactors.push('📌 Opening Day: 35% regression to mean (limited sample)');
      // Add roster change and new-team pitcher factors
      if (preseasonTuning) {
        const awayRoster = preseasonTuning.getRosterChangeAdj(game.away);
        const homeRoster = preseasonTuning.getRosterChangeAdj(game.home);
        if (awayRoster.rsG_adj !== 0 || awayRoster.raG_adj !== 0) {
          keyFactors.push(`🔄 ${game.away} roster changes: ${awayRoster.note || 'Offseason moves'}`);
        }
        if (homeRoster.rsG_adj !== 0 || homeRoster.raG_adj !== 0) {
          keyFactors.push(`🔄 ${game.home} roster changes: ${homeRoster.note || 'Offseason moves'}`);
        }
        // New team pitcher warnings
        const awayNewTeam = preseasonTuning.getNewTeamPenalty(awayStarterName);
        const homeNewTeam = preseasonTuning.getNewTeamPenalty(homeStarterName);
        if (awayNewTeam > 0) {
          keyFactors.push(`⚠️ ${awayStarterName} pitching for NEW team (-${(awayNewTeam * 100).toFixed(0)}% performance penalty)`);
        }
        if (homeNewTeam > 0) {
          keyFactors.push(`⚠️ ${homeStarterName} pitching for NEW team (-${(homeNewTeam * 100).toFixed(0)}% performance penalty)`);
        }
      }
      if (prediction.monteCarlo) {
        keyFactors.push(`🎲 Monte Carlo: ${(prediction.monteCarlo.homeWinProb * 100).toFixed(1)}% home win (20K sims)`);
      }
      if (valueAnalysis && valueAnalysis.bestBet) {
        keyFactors.push(`💰 DK Edge: ${valueAnalysis.bestBet.team} at ${valueAnalysis.bestBet.ml > 0 ? '+' : ''}${valueAnalysis.bestBet.ml} — ${valueAnalysis.bestBet.edge}% edge, ${valueAnalysis.bestBet.confidence}`);
      }

      games.push({
        date: game.date,
        day: game.day,
        time: game.time,
        away: game.away,
        home: game.home,
        awayName: mlb.TEAMS[game.away]?.name || game.away,
        homeName: mlb.TEAMS[game.home]?.name || game.home,
        park: parkName,
        parkFactor,
        broadcast: game.broadcast,
        isGame2: game.isGame2 || false,
        starterSource,
        awayStarter: {
          name: awayStarter.name,
          hand: awayStarter.hand,
          era: awayStarter.era,
          fip: awayStarter.fip,
          xfip: awayStarter.xfip,
          whip: awayStarter.whip,
          k9: awayStarter.k9,
          rating: awayStarter.rating,
          tier: pitchers.getPitcherTier(awayStarter.rating),
          confirmed: !!game.confirmedStarters?.away,
        },
        homeStarter: {
          name: homeStarter.name,
          hand: homeStarter.hand,
          era: homeStarter.era,
          fip: homeStarter.fip,
          xfip: homeStarter.xfip,
          whip: homeStarter.whip,
          k9: homeStarter.k9,
          rating: homeStarter.rating,
          tier: pitchers.getPitcherTier(homeStarter.rating),
          confirmed: !!game.confirmedStarters?.home,
        },
        prediction: {
          homeWinProb: bestHomeProb,
          awayWinProb: bestAwayProb,
          homeML: bestHomeML,
          awayML: bestAwayML,
          homeExpRuns: prediction.homeExpRuns,
          awayExpRuns: prediction.awayExpRuns,
          totalRuns: prediction.totalRuns,
          f5Total: prediction.f5Total,
          runDiff: prediction.runDiff,
          homeRunLine: prediction.homeRunLine,
          awayRunLine: prediction.awayRunLine,
          homePower: prediction.homePower,
          awayPower: prediction.awayPower,
          monteCarlo: prediction.monteCarlo ? {
            homeWinProb: prediction.monteCarlo.homeWinProb,
            awayWinProb: prediction.monteCarlo.awayWinProb,
            totalRuns: prediction.monteCarlo.totalRuns,
            topScores: prediction.monteCarlo.topScores,
            extraInningsPct: prediction.monteCarlo.extraInningsPct,
          } : null,
        },
        totals: prediction.totals || null,
        dkLine: game.dkLine || null,
        ouSuggestion,
        f5Suggestion,
        valueAnalysis,
        weather: homeWeather ? {
          temp: homeWeather.weather?.temp,
          wind: homeWeather.weather?.wind,
          windDir: homeWeather.weather?.windDir,
          humidity: homeWeather.weather?.humidity,
          multiplier: homeWeather.multiplier,
          description: homeWeather.description,
          dome: homeWeather.dome,
          factors: homeWeather.factors,
        } : null,
        injuries: {
          away: awayInjuries ? { count: awayInjuries.starPlayersOut.length, players: awayInjuries.starPlayersOut, adj: awayInjuries.adjFactor } : null,
          home: homeInjuries ? { count: homeInjuries.starPlayersOut.length, players: homeInjuries.starPlayersOut, adj: homeInjuries.adjFactor } : null,
        },
        springTraining: { 
          away: { ...awaySpring, record: awaySTRecord ? `${awaySTRecord.w}-${awaySTRecord.l}` : null },
          home: { ...homeSpring, record: homeSTRecord ? `${homeSTRecord.w}-${homeSTRecord.l}` : null },
        },
        rosterChanges: preseasonTuning ? {
          away: preseasonTuning.getRosterChangeAdj(game.away),
          home: preseasonTuning.getRosterChangeAdj(game.home),
        } : null,
        newTeamPitchers: preseasonTuning ? {
          away: awayStarterName ? { name: awayStarterName, penalty: preseasonTuning.getNewTeamPenalty(awayStarterName) } : null,
          home: homeStarterName ? { name: homeStarterName, penalty: preseasonTuning.getNewTeamPenalty(homeStarterName) } : null,
        } : null,
        analysis: {
          favTeam: bestHomeProb > bestAwayProb ? game.home : game.away,
          favProb: +(Math.max(bestHomeProb, bestAwayProb)).toFixed(3),
          dogTeam: bestHomeProb > bestAwayProb ? game.away : game.home,
          dogProb: +(Math.min(bestHomeProb, bestAwayProb)).toFixed(3),
          confidence,
          confidenceScore: +confidenceScore.toFixed(1),
          pitcherAdvantage: matchup.matchup ? matchup.matchup.pitcherAdvantage : 'EVEN',
          pitcherSwing: matchup.matchup ? matchup.matchup.pitcherSwing : 0,
          keyFactors,
        }
      });
    } catch (e) {
      console.error(`Opening Day projection error for ${game.away}@${game.home}:`, e.message);
    }
  }

  // Sort by date, then confidence score
  games.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (b.analysis.confidenceScore || 0) - (a.analysis.confidenceScore || 0);
  });

  // ==================== BEST BETS (Model vs DraftKings) ====================
  // Now with REAL DraftKings lines — this is where we make money
  const bestBets = [...games]
    .filter(g => g.valueAnalysis && g.valueAnalysis.bestBet)
    .sort((a, b) => (b.valueAnalysis.bestBet?.edge || 0) - (a.valueAnalysis.bestBet?.edge || 0))
    .slice(0, 7)
    .map(g => ({
      game: `${g.away} @ ${g.home}`,
      date: g.date,
      time: g.time,
      pick: g.valueAnalysis.bestBet.team,
      pickSide: g.valueAnalysis.bestBet.side,
      dkML: g.valueAnalysis.bestBet.ml,
      modelProb: g.valueAnalysis.bestBet.side === 'home' ? g.prediction.homeWinProb : g.prediction.awayWinProb,
      dkImplied: g.valueAnalysis.bestBet.side === 'home' ? g.valueAnalysis.draftKings.homeImplied : g.valueAnalysis.draftKings.awayImplied,
      edge: g.valueAnalysis.bestBet.edge,
      ev: g.valueAnalysis.bestBet.ev,
      confidence: g.valueAnalysis.bestBet.confidence,
      pitcher: g.valueAnalysis.bestBet.side === 'home' ? g.homeStarter.name : g.awayStarter.name,
      pitcherRating: g.valueAnalysis.bestBet.side === 'home' ? g.homeStarter.rating : g.awayStarter.rating,
      pitcherTier: g.valueAnalysis.bestBet.side === 'home' ? g.homeStarter.tier : g.awayStarter.tier,
      pitcherConfirmed: g.valueAnalysis.bestBet.side === 'home' ? g.homeStarter.confirmed : g.awayStarter.confirmed,
      reason: g.analysis.keyFactors.slice(0, 3).join(' | ') || 'Strong model projection',
      ouSuggestion: g.ouSuggestion,
      f5Suggestion: g.f5Suggestion,
    }));

  // Also include top model picks even without DK line edge
  const modelPicks = [...games]
    .filter(g => !g.valueAnalysis || !g.valueAnalysis.bestBet)
    .sort((a, b) => (b.analysis.confidenceScore || 0) - (a.analysis.confidenceScore || 0))
    .slice(0, 3)
    .map(g => ({
      game: `${g.away} @ ${g.home}`,
      date: g.date,
      time: g.time,
      pick: g.analysis.favTeam,
      modelProb: g.analysis.favProb,
      modelML: g.analysis.favTeam === g.home ? g.prediction.homeML : g.prediction.awayML,
      confidence: g.analysis.confidence,
      pitcher: g.analysis.favTeam === g.home ? g.homeStarter.name : g.awayStarter.name,
      note: 'No DK line available yet — watch for value when lines post',
    }));

  // Best totals plays
  const bestTotals = [...games]
    .filter(g => g.ouSuggestion && g.ouSuggestion.edge >= 3)
    .sort((a, b) => (b.ouSuggestion?.edge || 0) - (a.ouSuggestion?.edge || 0))
    .slice(0, 5)
    .map(g => ({
      game: `${g.away} @ ${g.home}`,
      date: g.date,
      side: g.ouSuggestion.side,
      line: g.ouSuggestion.line,
      prob: g.ouSuggestion.prob,
      edge: g.ouSuggestion.edge,
      projectedTotal: g.prediction.totalRuns,
      weather: g.weather?.description || null,
      park: `${g.park} (${g.parkFactor}x)`,
    }));

  // Summary
  const day1 = games.filter(g => g.day === 1);
  const day2 = games.filter(g => g.day === 2);
  const confirmedStarters = games.filter(g => g.awayStarter.confirmed || g.homeStarter.confirmed);
  const gamesWithDKLines = games.filter(g => g.valueAnalysis);
  const gamesWithValue = games.filter(g => g.valueAnalysis?.bestBet);
  
  const openingDay = new Date('2026-03-26T13:00:00-04:00');
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((openingDay - now) / (1000 * 60 * 60 * 24)));

  return {
    title: 'MLB 2026 Opening Day Command Center 🦞💰',
    version: '3.0',
    openingDay: '2026-03-26',
    daysUntil,
    totalGames: games.length,
    day1Games: day1.length,
    day2Games: day2.length,
    confirmedStarterGames: confirmedStarters.length,
    gamesWithDKLines: gamesWithDKLines.length,
    gamesWithValue: gamesWithValue.length,
    totalEdgesFound: gamesWithValue.length,
    bestBets,
    modelPicks,
    bestTotals,
    games,
    springTrainingStandings: SPRING_TRAINING_RECORDS,
    features: [
      '🆕 Preseason tuning v3 — roster changes, spring training signals, new-team pitcher penalties',
      '🆕 Opening Day starter premium — starters go 5.8 IP vs 5.5 regular season',
      '🆕 12 offseason roster moves tracked (Crochet→BOS, Ozuna→PIT, Valdez→DET, etc.)',
      '🆕 8 new-team pitcher penalties for pitchers on new squads',
      '🆕 Real DraftKings opening lines (scraped March 21)',
      '🆕 Model vs Books value detection with EV calculation',
      '🆕 ESPN confirmed starters (as of March 21)',
      '🆕 Real spring training records (Cactus + Grapefruit)',
      'Monte Carlo 20K sims per game',
      'Live weather integration (Open-Meteo)',
      'Injury impact adjustments',
      'Early season regression (35% to mean)',
      'Platoon split adjustments',
      'Park factor modeling',
      'Poisson totals with score distributions',
      'F5 (first 5 innings) projections',
      'Bullpen fatigue tracking',
      'Probability calibration',
      'Statcast xERA/xwOBA integration',
    ],
    updated: new Date().toISOString()
  };
}

// getSchedule() returns the static OD schedule array (used by checklist, betting card, etc.)
function getSchedule() {
  return OPENING_DAY_GAMES;
}

module.exports = { getProjections, getSchedule, OPENING_DAY_GAMES, SPRING_TRAINING_RECORDS, SPRING_TRAINING_SIGNALS };
