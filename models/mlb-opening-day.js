// models/mlb-opening-day.js — MLB 2026 Opening Day Projections
// Complete schedule: March 26-27, 2026
// Each game has projected starters based on team rotation rankings

const mlb = require('./mlb');
const pitchers = require('./mlb-pitchers');

// ==================== OPENING DAY SCHEDULE ====================

const OPENING_DAY_GAMES = [
  // ===== MARCH 26, 2026 — DAY 1 =====
  // Teams playing both days use their ace on Day 1, #2 on Day 2
  { date: '2026-03-26', day: 1, away: 'PIT', home: 'NYM', time: '1:10 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'CWS', home: 'MIL', time: '2:10 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'WSH', home: 'CHC', time: '2:20 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'MIN', home: 'BAL', time: '3:05 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'BOS', home: 'CIN', time: '4:10 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'LAA', home: 'HOU', time: '4:10 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'DET', home: 'SD',  time: '4:10 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'TB',  home: 'STL', time: '4:15 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'TEX', home: 'PHI', time: '4:05 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'ARI', home: 'LAD', time: '8:08 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-26', day: 1, away: 'CLE', home: 'SEA', time: '9:40 PM ET',  starterIdx: { away: 0, home: 0 } },

  // ===== MARCH 27, 2026 — DAY 2 =====
  { date: '2026-03-27', day: 2, away: 'NYY', home: 'SF',  time: '4:35 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-27', day: 2, away: 'OAK', home: 'TOR', time: '7:07 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-27', day: 2, away: 'COL', home: 'MIA', time: '4:10 PM ET',  starterIdx: { away: 0, home: 0 } },
  { date: '2026-03-27', day: 2, away: 'KC',  home: 'ATL', time: '4:10 PM ET',  starterIdx: { away: 0, home: 0 } },
  // Repeat series — #2 starters
  { date: '2026-03-27', day: 2, away: 'LAA', home: 'HOU', time: '8:15 PM ET',  starterIdx: { away: 1, home: 1 } },
  { date: '2026-03-27', day: 2, away: 'DET', home: 'SD',  time: '4:10 PM ET',  starterIdx: { away: 1, home: 1 } },
  { date: '2026-03-27', day: 2, away: 'CLE', home: 'SEA', time: '9:40 PM ET',  starterIdx: { away: 1, home: 1 } },
  { date: '2026-03-27', day: 2, away: 'ARI', home: 'LAD', time: '9:10 PM ET',  starterIdx: { away: 1, home: 1 } },
];

// ==================== PROJECTION ENGINE ====================

function getProjections() {
  const games = [];

  for (const game of OPENING_DAY_GAMES) {
    const awayRotation = pitchers.getTeamRotation(game.away);
    const homeRotation = pitchers.getTeamRotation(game.home);

    if (!awayRotation || !homeRotation) continue;

    const awayStarter = awayRotation[game.starterIdx.away] || awayRotation[0];
    const homeStarter = homeRotation[game.starterIdx.home] || homeRotation[0];

    // Run the full prediction model with pitchers
    const prediction = mlb.predict(game.away, game.home, {
      awayPitcher: awayStarter.name,
      homePitcher: homeStarter.name
    });

    if (prediction.error) continue;

    // Also run matchup analysis
    const matchup = mlb.analyzeMatchup(game.away, game.home, {
      awayPitcher: awayStarter.name,
      homePitcher: homeStarter.name
    });

    // Park info
    const homeTeam = mlb.TEAMS[game.home];
    const parkName = homeTeam ? homeTeam.park : 'Unknown';
    const parkFactor = mlb.PARK_FACTORS[parkName] || 1.0;

    // Determine the best bet side
    const homeFav = prediction.homeWinProb > prediction.awayWinProb;
    const favTeam = homeFav ? game.home : game.away;
    const favProb = homeFav ? prediction.homeWinProb : prediction.awayWinProb;
    const dogTeam = homeFav ? game.away : game.home;
    const dogProb = homeFav ? prediction.awayWinProb : prediction.homeWinProb;

    // Confidence tier
    const spread = Math.abs(prediction.homeWinProb - prediction.awayWinProb);
    let confidence;
    if (spread >= 0.25) confidence = 'HIGH';
    else if (spread >= 0.12) confidence = 'MEDIUM';
    else confidence = 'LOW';

    // Over/Under analysis
    const totalRuns = prediction.totalRuns;
    let ouSuggestion = null;
    if (prediction.totals && prediction.totals.lines) {
      // Find the line closest to projected total
      const lines = Object.keys(prediction.totals.lines).map(Number).sort((a, b) => a - b);
      let bestLine = 8.5;
      let bestEdge = 0;
      let bestSide = null;
      for (const line of lines) {
        const data = prediction.totals.lines[line];
        const overEdge = data.over - 0.5;
        const underEdge = data.under - 0.5;
        if (overEdge > bestEdge) { bestEdge = overEdge; bestSide = 'Over'; bestLine = line; }
        if (underEdge > bestEdge) { bestEdge = underEdge; bestSide = 'Under'; bestLine = line; }
      }
      if (bestSide && bestEdge > 0.02) {
        ouSuggestion = {
          line: bestLine,
          side: bestSide,
          prob: bestSide === 'Over' ? prediction.totals.lines[bestLine].over : prediction.totals.lines[bestLine].under,
          edge: bestEdge
        };
      }
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
      awayStarter: {
        name: awayStarter.name,
        hand: awayStarter.hand,
        era: awayStarter.era,
        fip: awayStarter.fip,
        xfip: awayStarter.xfip,
        whip: awayStarter.whip,
        k9: awayStarter.k9,
        rating: awayStarter.rating,
        tier: pitchers.getPitcherTier(awayStarter.rating)
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
        tier: pitchers.getPitcherTier(homeStarter.rating)
      },
      prediction: {
        homeWinProb: prediction.homeWinProb,
        awayWinProb: prediction.awayWinProb,
        homeML: prediction.homeML,
        awayML: prediction.awayML,
        homeExpRuns: prediction.homeExpRuns,
        awayExpRuns: prediction.awayExpRuns,
        totalRuns: prediction.totalRuns,
        f5Total: prediction.f5Total,
        runDiff: prediction.runDiff,
        homeRunLine: prediction.homeRunLine,
        awayRunLine: prediction.awayRunLine,
        homePower: prediction.homePower,
        awayPower: prediction.awayPower,
      },
      totals: prediction.totals || null,
      ouSuggestion,
      analysis: {
        favTeam,
        favProb,
        dogTeam,
        dogProb,
        confidence,
        pitcherAdvantage: matchup.matchup ? matchup.matchup.pitcherAdvantage : 'EVEN',
        pitcherSwing: matchup.matchup ? matchup.matchup.pitcherSwing : 0,
        keyFactors: matchup.matchup ? matchup.matchup.keyFactors : [],
      }
    });
  }

  // Sort by date, then by biggest model edge (biggest favorite spread)
  games.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const edgeA = Math.abs(a.prediction.homeWinProb - a.prediction.awayWinProb);
    const edgeB = Math.abs(b.prediction.homeWinProb - b.prediction.awayWinProb);
    return edgeB - edgeA;
  });

  // Identify best bets — top 5 by model confidence
  const bestBets = [...games]
    .sort((a, b) => {
      const spreadA = Math.abs(a.prediction.homeWinProb - a.prediction.awayWinProb);
      const spreadB = Math.abs(b.prediction.homeWinProb - b.prediction.awayWinProb);
      return spreadB - spreadA;
    })
    .slice(0, 5)
    .map(g => ({
      game: `${g.away} @ ${g.home}`,
      date: g.date,
      pick: g.analysis.favTeam,
      prob: g.analysis.favProb,
      ml: g.analysis.favTeam === g.home ? g.prediction.homeML : g.prediction.awayML,
      confidence: g.analysis.confidence,
      pitcher: g.analysis.favTeam === g.home ? g.homeStarter.name : g.awayStarter.name,
      pitcherRating: g.analysis.favTeam === g.home ? g.homeStarter.rating : g.awayStarter.rating,
      reason: g.analysis.keyFactors.join('; ') || 'Strong model projection',
      ouSuggestion: g.ouSuggestion
    }));

  // Summary stats
  const day1 = games.filter(g => g.day === 1);
  const day2 = games.filter(g => g.day === 2);
  const highConf = games.filter(g => g.analysis.confidence === 'HIGH');
  const medConf = games.filter(g => g.analysis.confidence === 'MEDIUM');

  // Countdown
  const openingDay = new Date('2026-03-26T13:00:00-04:00');
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((openingDay - now) / (1000 * 60 * 60 * 24)));

  return {
    title: 'MLB 2026 Opening Day Projections',
    openingDay: '2026-03-26',
    daysUntil,
    totalGames: games.length,
    day1Games: day1.length,
    day2Games: day2.length,
    highConfidence: highConf.length,
    medConfidence: medConf.length,
    bestBets,
    games,
    updated: new Date().toISOString()
  };
}

module.exports = { getProjections, OPENING_DAY_GAMES };
