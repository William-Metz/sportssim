// services/line-shopping.js — Multi-Book Line Shopping Optimizer v72.0
// 
// PURPOSE: On game day, find the BEST available line across all sportsbooks
// for every bet in our portfolio. The difference between DK -138 and Pinnacle -132
// on a $50 bet is $2.20 — across 28 OD bets, that's $30-60 in free EV.
//
// This is the single easiest edge in sports betting: line shopping.
// Most bettors use one book. We use ALL of them.

const BOOK_PRIORITY = [
  // Ordered by general sharpness (sharper = better prices for value bettors)
  'Pinnacle',
  'Circa Sports',
  'BetRivers',
  'BetMGM',
  'DraftKings',
  'FanDuel',
  'Caesars',
  'PointsBet',
  'Bovada',
  'BetOnline.ag',
  'MyBookie.ag',
  'Barstool Sportsbook',
  'WynnBET',
  'bet365',
  'Unibet',
  'SuperBook',
];

// Convert American odds to decimal
function mlToDecimal(ml) {
  if (ml > 0) return 1 + ml / 100;
  if (ml < 0) return 1 + 100 / Math.abs(ml);
  return 1;
}

// Convert American odds to implied probability  
function mlToProb(ml) {
  if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
  if (ml > 0) return 100 / (ml + 100);
  return 0.5;
}

// Convert probability to American odds
function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// Calculate edge: model probability vs implied probability from odds
function calcEdge(modelProb, ml) {
  const impliedProb = mlToProb(ml);
  return modelProb - impliedProb;
}

// Calculate expected value of a bet
function calcEV(modelProb, ml, wager = 100) {
  const decimalOdds = mlToDecimal(ml);
  const ev = modelProb * (decimalOdds - 1) * wager - (1 - modelProb) * wager;
  return ev;
}

// Kelly Criterion sizing
function kellySize(modelProb, ml, bankroll = 1000, fraction = 0.25) {
  const decimal = mlToDecimal(ml);
  const b = decimal - 1;
  const kelly = (modelProb * b - (1 - modelProb)) / b;
  if (kelly <= 0) return 0;
  // Apply fraction (quarter Kelly by default for safety)
  const bet = Math.min(bankroll * kelly * fraction, bankroll * 0.05); // Max 5% bankroll
  return Math.max(0, +bet.toFixed(2));
}

/**
 * Find the best available line across all books for a specific bet
 * @param {Object} booksData - { bookName: { homeML, awayML, overOdds, underOdds, total, spread, ... } }
 * @param {string} betType - 'home_ml', 'away_ml', 'over', 'under', 'home_spread', 'away_spread'
 * @param {number} modelProb - Our model's probability for this outcome
 * @returns {Object} Best line info with comparison
 */
function findBestLine(booksData, betType, modelProb) {
  if (!booksData || Object.keys(booksData).length === 0) {
    return { found: false, reason: 'No book data available' };
  }

  const candidates = [];

  for (const [bookName, line] of Object.entries(booksData)) {
    let ml = null;
    let total = null;
    let spread = null;

    switch (betType) {
      case 'home_ml':
        ml = line.homeML;
        break;
      case 'away_ml':
        ml = line.awayML;
        break;
      case 'over':
        ml = line.overOdds || -110;
        total = line.total;
        break;
      case 'under':
        ml = line.underOdds || -110;
        total = line.total;
        break;
      case 'home_spread':
        ml = line.spreadOdds || -110;
        spread = line.spread;
        break;
      case 'away_spread':
        ml = line.awaySpreadOdds || -110;
        spread = line.awaySpread;
        break;
      default:
        break;
    }

    if (ml !== null && ml !== undefined) {
      const edge = calcEdge(modelProb, ml);
      const ev100 = calcEV(modelProb, ml, 100);
      candidates.push({
        book: bookName,
        ml,
        total,
        spread,
        impliedProb: +mlToProb(ml).toFixed(4),
        edge: +edge.toFixed(4),
        edgePct: +(edge * 100).toFixed(1),
        ev100: +ev100.toFixed(2),
        decimal: +mlToDecimal(ml).toFixed(3),
        isPlusEV: edge > 0,
      });
    }
  }

  if (candidates.length === 0) {
    return { found: false, reason: 'No lines found for this bet type' };
  }

  // Sort by edge (best line = highest edge = most +EV)
  candidates.sort((a, b) => b.edge - a.edge);

  const best = candidates[0];
  const worst = candidates[candidates.length - 1];
  const dk = candidates.find(c => c.book === 'DraftKings') || candidates.find(c => c.book === 'FanDuel');
  
  // How much better is the best line vs DK?
  let improvement = null;
  if (dk && best.book !== dk.book) {
    improvement = {
      vsBook: dk.book,
      mlDiff: best.ml - dk.ml,
      edgeDiff: +(best.edge - dk.edge).toFixed(4),
      evDiff100: +(best.ev100 - dk.ev100).toFixed(2),
      note: best.ev100 > dk.ev100 
        ? `${best.book} saves $${(best.ev100 - dk.ev100).toFixed(2)}/100 vs ${dk.book}`
        : `${dk.book} is already the best line`,
    };
  }

  return {
    found: true,
    best,
    worst,
    dk: dk || null,
    improvement,
    allBooks: candidates,
    bookCount: candidates.length,
    plusEVCount: candidates.filter(c => c.isPlusEV).length,
    spread: best.edge - worst.edge > 0 
      ? +(((best.edge - worst.edge) * 100).toFixed(1)) 
      : 0,
  };
}

/**
 * Generate full line-shopping report for an Opening Day game
 * @param {string} away - Away team abbreviation
 * @param {string} home - Home team abbreviation
 * @param {Object} prediction - Model prediction from asyncPredict
 * @param {Object} booksData - Multi-book odds data
 * @param {Object} opts - Options (bankroll, kellyFraction)
 * @returns {Object} Complete line shopping analysis
 */
function shopGame(away, home, prediction, booksData, opts = {}) {
  const bankroll = opts.bankroll || 1000;
  const kellyFraction = opts.kellyFraction || 0.25;

  if (!prediction || prediction.error) {
    return { error: 'No prediction available', away, home };
  }

  const homeWP = prediction.homeWinProb;
  const awayWP = prediction.awayWinProb;
  const totalRuns = prediction.totalRuns;

  const markets = [];

  // 1. Moneyline: Home
  const homeMLShop = findBestLine(booksData, 'home_ml', homeWP);
  if (homeMLShop.found && homeMLShop.best.isPlusEV) {
    const wager = kellySize(homeWP, homeMLShop.best.ml, bankroll, kellyFraction);
    markets.push({
      market: 'Moneyline',
      pick: `${home} ML`,
      side: 'home',
      modelProb: +(homeWP * 100).toFixed(1),
      ...homeMLShop.best,
      wager,
      ev: +calcEV(homeWP, homeMLShop.best.ml, wager).toFixed(2),
      shopping: homeMLShop,
    });
  }

  // 2. Moneyline: Away
  const awayMLShop = findBestLine(booksData, 'away_ml', awayWP);
  if (awayMLShop.found && awayMLShop.best.isPlusEV) {
    const wager = kellySize(awayWP, awayMLShop.best.ml, bankroll, kellyFraction);
    markets.push({
      market: 'Moneyline',
      pick: `${away} ML`,
      side: 'away',
      modelProb: +(awayWP * 100).toFixed(1),
      ...awayMLShop.best,
      wager,
      ev: +calcEV(awayWP, awayMLShop.best.ml, wager).toFixed(2),
      shopping: awayMLShop,
    });
  }

  // 3. Totals: Over - check multiple lines
  const totalsLines = {};
  for (const [bookName, line] of Object.entries(booksData)) {
    if (line.total) {
      const totalKey = line.total.toString();
      if (!totalsLines[totalKey]) totalsLines[totalKey] = {};
      totalsLines[totalKey][bookName] = line;
    }
  }

  // Find the most common total line
  let primaryTotal = null;
  let maxCount = 0;
  for (const [total, books] of Object.entries(totalsLines)) {
    if (Object.keys(books).length > maxCount) {
      maxCount = Object.keys(books).length;
      primaryTotal = parseFloat(total);
    }
  }

  if (primaryTotal && prediction.totals?.lines) {
    // Get our model's over/under probability for the primary total
    const lineKey = primaryTotal.toString();
    const totalsData = prediction.totals.lines[lineKey] || prediction.totals.lines[primaryTotal.toFixed(1)];
    
    if (totalsData) {
      const overProb = totalsData.over || totalsData.nbOver || 0.5;
      const underProb = totalsData.under || totalsData.nbUnder || 0.5;

      // Over
      const overBooksForLine = {};
      for (const [bookName, line] of Object.entries(booksData)) {
        if (line.total === primaryTotal) overBooksForLine[bookName] = line;
      }
      const overShop = findBestLine(overBooksForLine, 'over', overProb);
      if (overShop.found && overShop.best.isPlusEV) {
        const wager = kellySize(overProb, overShop.best.ml, bankroll, kellyFraction);
        markets.push({
          market: 'Total',
          pick: `OVER ${primaryTotal}`,
          side: 'over',
          modelProb: +(overProb * 100).toFixed(1),
          modelTotal: totalRuns,
          line: primaryTotal,
          ...overShop.best,
          wager,
          ev: +calcEV(overProb, overShop.best.ml, wager).toFixed(2),
          shopping: overShop,
        });
      }

      // Under
      const underShop = findBestLine(overBooksForLine, 'under', underProb);
      if (underShop.found && underShop.best.isPlusEV) {
        const wager = kellySize(underProb, underShop.best.ml, bankroll, kellyFraction);
        markets.push({
          market: 'Total',
          pick: `UNDER ${primaryTotal}`,
          side: 'under',
          modelProb: +(underProb * 100).toFixed(1),
          modelTotal: totalRuns,
          line: primaryTotal,
          ...underShop.best,
          wager,
          ev: +calcEV(underProb, underShop.best.ml, wager).toFixed(2),
          shopping: underShop,
        });
      }
    }
  }

  // 4. F5 (First 5 Innings) markets
  if (prediction.f5) {
    // F5 Over/Under
    const f5Total = prediction.f5.total;
    if (f5Total && prediction.f5.totals) {
      // Check common F5 total lines
      for (const [line, data] of Object.entries(prediction.f5.totals || {})) {
        const f5Line = parseFloat(line);
        if (isNaN(f5Line)) continue;
        
        const f5OverProb = data.over || 0.5;
        const f5UnderProb = data.under || 0.5;
        
        // We'd need F5-specific book data, but most books don't expose F5 via Odds API
        // Use the model probabilities and flag as "model-only" bets
        if (f5UnderProb > 0.55) {
          markets.push({
            market: 'F5 Total',
            pick: `F5 UNDER ${f5Line}`,
            side: 'under',
            modelProb: +(f5UnderProb * 100).toFixed(1),
            modelF5Total: f5Total,
            line: f5Line,
            ml: -110, // Default F5 juice
            book: 'DraftKings (F5)',
            impliedProb: 0.5238,
            edge: +(f5UnderProb - 0.5238).toFixed(4),
            edgePct: +((f5UnderProb - 0.5238) * 100).toFixed(1),
            isPlusEV: f5UnderProb > 0.5238,
            wager: kellySize(f5UnderProb, -110, bankroll, kellyFraction),
            ev: +calcEV(f5UnderProb, -110, kellySize(f5UnderProb, -110, bankroll, kellyFraction)).toFixed(2),
            shopping: { found: false, reason: 'F5 lines not in Odds API — book shop manually' },
            bookShopNote: '⚠️ Check DK/FD/BetMGM for F5 lines — often better at FanDuel',
          });
        }
        if (f5OverProb > 0.55) {
          markets.push({
            market: 'F5 Total',
            pick: `F5 OVER ${f5Line}`,
            side: 'over',
            modelProb: +(f5OverProb * 100).toFixed(1),
            modelF5Total: f5Total,
            line: f5Line,
            ml: -110,
            book: 'DraftKings (F5)',
            impliedProb: 0.5238,
            edge: +(f5OverProb - 0.5238).toFixed(4),
            edgePct: +((f5OverProb - 0.5238) * 100).toFixed(1),
            isPlusEV: f5OverProb > 0.5238,
            wager: kellySize(f5OverProb, -110, bankroll, kellyFraction),
            ev: +calcEV(f5OverProb, -110, kellySize(f5OverProb, -110, bankroll, kellyFraction)).toFixed(2),
            shopping: { found: false, reason: 'F5 lines not in Odds API — book shop manually' },
            bookShopNote: '⚠️ Check DK/FD/BetMGM for F5 lines — often better at FanDuel',
          });
        }
        break; // Only check primary F5 line
      }
    }
  }

  // Sort all markets by EV
  markets.sort((a, b) => b.ev - a.ev);

  const totalWager = markets.reduce((s, m) => s + m.wager, 0);
  const totalEV = markets.reduce((s, m) => s + m.ev, 0);

  return {
    away,
    home,
    game: `${away}@${home}`,
    marketCount: markets.length,
    plusEVCount: markets.filter(m => m.isPlusEV).length,
    markets,
    portfolio: {
      totalWager: +totalWager.toFixed(2),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
    },
    lineSavings: markets.reduce((s, m) => {
      if (m.shopping?.improvement?.evDiff100 > 0) {
        return s + (m.shopping.improvement.evDiff100 * m.wager / 100);
      }
      return s;
    }, 0).toFixed(2),
  };
}

/**
 * Full Opening Day portfolio with line shopping across all games
 * @param {Object} dependencies - { mlb, getAllOdds, odGames, convictionEngine }
 * @param {Object} opts - { bankroll, kellyFraction, minEdge }
 * @returns {Object} Complete OD betting portfolio with line shopping
 */
async function generateODPortfolio(dependencies, opts = {}) {
  const { mlb, getAllOdds, odGames } = dependencies;
  const bankroll = opts.bankroll || 1000;
  const kellyFraction = opts.kellyFraction || 0.25;
  const minEdge = opts.minEdge || 0.02;

  if (!mlb || !getAllOdds || !odGames) {
    return { error: 'Missing dependencies' };
  }

  // Fetch live odds for all games
  let allOdds;
  try {
    allOdds = await getAllOdds();
  } catch (e) {
    return { error: `Failed to fetch odds: ${e.message}` };
  }

  // Build lookup: team abbr → game odds
  const mlbGames = (allOdds || []).filter(g => g.sport === 'MLB');
  const oddsMap = {};
  for (const game of mlbGames) {
    if (game.home && game.away) {
      const key = `${game.away}@${game.home}`;
      oddsMap[key] = game;
    }
  }

  // Process each OD game
  const gameResults = [];
  const allPlays = [];
  let totalLineSavings = 0;

  for (const game of odGames) {
    // Get prediction
    let prediction;
    try {
      prediction = await mlb.asyncPredict(game.away, game.home, {
        awayPitcher: game.confirmedStarters?.away,
        homePitcher: game.confirmedStarters?.home,
        gameDate: game.date || '2026-03-27',
      });
    } catch (e) {
      prediction = mlb.predict(game.away, game.home, {
        awayPitcher: game.confirmedStarters?.away,
        homePitcher: game.confirmedStarters?.home,
      });
    }

    // Get odds data for this game
    const key = `${game.away}@${game.home}`;
    const gameOdds = oddsMap[key];
    const booksData = gameOdds?.books || {};

    // Shop lines
    const shopping = shopGame(game.away, game.home, prediction, booksData, { bankroll, kellyFraction });
    
    // Filter by minimum edge
    shopping.markets = (shopping.markets || []).filter(m => Math.abs(m.edge) >= minEdge);
    
    gameResults.push({
      ...shopping,
      pitchers: `${game.confirmedStarters?.away || '?'} vs ${game.confirmedStarters?.home || '?'}`,
      date: game.date,
      day: game.day,
    });

    for (const market of shopping.markets) {
      allPlays.push({
        ...market,
        game: key,
        pitchers: `${game.confirmedStarters?.away || '?'} vs ${game.confirmedStarters?.home || '?'}`,
      });
    }

    const savings = parseFloat(shopping.lineSavings || 0);
    if (!isNaN(savings)) totalLineSavings += savings;
  }

  // Sort all plays by EV
  allPlays.sort((a, b) => b.ev - a.ev);

  // Calculate portfolio stats
  const totalWager = allPlays.reduce((s, p) => s + (p.wager || 0), 0);
  const totalEV = allPlays.reduce((s, p) => s + (p.ev || 0), 0);

  // Tier plays
  const smashPlays = allPlays.filter(p => p.edgePct >= 10);
  const strongPlays = allPlays.filter(p => p.edgePct >= 5 && p.edgePct < 10);
  const leanPlays = allPlays.filter(p => p.edgePct >= 2 && p.edgePct < 5);

  // Book distribution — how much to deposit at each book
  const bookAllocations = {};
  for (const play of allPlays) {
    const book = play.book || 'DraftKings';
    if (!bookAllocations[book]) bookAllocations[book] = { wager: 0, plays: 0, ev: 0 };
    bookAllocations[book].wager += play.wager || 0;
    bookAllocations[book].plays++;
    bookAllocations[book].ev += play.ev || 0;
  }

  // Format book allocations
  const bookSummary = Object.entries(bookAllocations)
    .map(([book, data]) => ({
      book,
      totalWager: +data.wager.toFixed(2),
      plays: data.plays,
      totalEV: +data.ev.toFixed(2),
      depositNeeded: +Math.ceil(data.wager * 1.2).toFixed(0), // 20% buffer
    }))
    .sort((a, b) => b.totalWager - a.totalWager);

  return {
    timestamp: new Date().toISOString(),
    openingDay: '2026-03-27',
    gamesAnalyzed: gameResults.length,
    totalPlays: allPlays.length,
    smashCount: smashPlays.length,
    strongCount: strongPlays.length,
    leanCount: leanPlays.length,
    portfolio: {
      bankroll,
      totalWager: +totalWager.toFixed(2),
      totalEV: +totalEV.toFixed(2),
      roi: totalWager > 0 ? +((totalEV / totalWager) * 100).toFixed(1) : 0,
      kellyFraction,
      lineSavings: +totalLineSavings.toFixed(2),
    },
    tiers: {
      smash: smashPlays.map(p => ({
        game: p.game,
        pick: p.pick,
        market: p.market,
        book: p.book,
        ml: p.ml,
        edge: p.edgePct + '%',
        modelProb: p.modelProb + '%',
        wager: '$' + (p.wager || 0).toFixed(2),
        ev: '$' + (p.ev || 0).toFixed(2),
        shopNote: p.shopping?.improvement?.note || '',
      })),
      strong: strongPlays.map(p => ({
        game: p.game,
        pick: p.pick,
        market: p.market,
        book: p.book,
        ml: p.ml,
        edge: p.edgePct + '%',
        wager: '$' + (p.wager || 0).toFixed(2),
        ev: '$' + (p.ev || 0).toFixed(2),
      })),
      lean: leanPlays.map(p => ({
        game: p.game,
        pick: p.pick,
        market: p.market,
        book: p.book,
        ml: p.ml,
        edge: p.edgePct + '%',
        wager: '$' + (p.wager || 0).toFixed(2),
        ev: '$' + (p.ev || 0).toFixed(2),
      })),
    },
    bookSummary,
    games: gameResults,
    allPlays,
    meta: {
      version: '72.0',
      model: 'SportsSim MLB v71 + NB F5 + Statcast + Platoon + Framing + Bullpen + Weather + Umpire',
      note: 'Line shopping adds 2-5% ROI improvement over single-book betting',
    },
  };
}

module.exports = {
  findBestLine,
  shopGame,
  generateODPortfolio,
  calcEdge,
  calcEV,
  kellySize,
  mlToDecimal,
  mlToProb,
  probToML,
  BOOK_PRIORITY,
};
