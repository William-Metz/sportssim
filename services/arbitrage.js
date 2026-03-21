/**
 * Arbitrage + Low-Hold + Middle Scanner — SportsSim v22.0
 * 
 * The RISK-FREE money printer. Scans multi-book odds for:
 *   1. True arbitrages (guaranteed profit — both sides sum to <100% implied prob)
 *   2. Low-hold opportunities (combined hold < 3% — near-arb, great for +EV model bets)
 *   3. Middle/pinch opportunities (overlapping spreads/totals between books)
 *   4. Stale line detection (one book lagging, free money before correction)
 * 
 * Uses The Odds API multi-book data (up to 20+ US sportsbooks).
 * 
 * Key insight: True arbs are rare (books are fast), but:
 *   - Low-hold markets amplify our model edge (less vig to overcome)
 *   - Middles happen daily and pay off ~20% of the time at 6:1+
 *   - Stale lines exist because some books update slower than others
 * 
 * API: The Odds API v4 — fetches from all US-region books
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'arb-cache.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 min cache (arb opportunities move fast)

// ==================== ODDS MATH ====================

/**
 * Convert American odds to implied probability
 */
function americanToImplied(odds) {
  if (!odds || odds === 0) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Convert American odds to decimal odds
 */
function americanToDecimal(odds) {
  if (!odds || odds === 0) return null;
  if (odds > 0) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

/**
 * Convert implied probability to American odds
 */
function impliedToAmerican(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Calculate hold (vig/juice) from two-way odds
 * Hold% = (impliedA + impliedB) - 1
 * Negative hold = arbitrage!
 */
function calculateHold(odds1, odds2) {
  const p1 = americanToImplied(odds1);
  const p2 = americanToImplied(odds2);
  if (!p1 || !p2) return null;
  return {
    hold: +(p1 + p2 - 1).toFixed(5),
    holdPct: +((p1 + p2 - 1) * 100).toFixed(3),
    implied1: +p1.toFixed(5),
    implied2: +p2.toFixed(5),
    combined: +(p1 + p2).toFixed(5)
  };
}

/**
 * Calculate arbitrage profit percentage
 * profit% = (1 / combined_implied - 1) * 100
 */
function calculateArbProfit(odds1, odds2) {
  const d1 = americanToDecimal(odds1);
  const d2 = americanToDecimal(odds2);
  if (!d1 || !d2) return null;
  const arbPct = (1 / d1 + 1 / d2);
  if (arbPct >= 1) return null; // Not an arb
  return {
    profitPct: +((1 / arbPct - 1) * 100).toFixed(3),
    arbPct: +arbPct.toFixed(5),
    stake1Pct: +((1 / d1) / arbPct * 100).toFixed(2), // % of total stake on side 1
    stake2Pct: +((1 / d2) / arbPct * 100).toFixed(2), // % of total stake on side 2
    decimal1: +d1.toFixed(3),
    decimal2: +d2.toFixed(3)
  };
}

/**
 * Calculate optimal stake split for an arb
 * Given total bankroll, returns exact wager on each side for guaranteed profit
 */
function calculateArbStakes(odds1, odds2, totalStake) {
  const d1 = americanToDecimal(odds1);
  const d2 = americanToDecimal(odds2);
  if (!d1 || !d2) return null;
  
  const arbPct = 1/d1 + 1/d2;
  if (arbPct >= 1) return null;
  
  const stake1 = totalStake * (1/d1) / arbPct;
  const stake2 = totalStake * (1/d2) / arbPct;
  
  // Profit is the same regardless of which side wins
  const profit1 = stake1 * d1 - totalStake; // profit if side 1 wins
  const profit2 = stake2 * d2 - totalStake; // profit if side 2 wins
  
  return {
    stake1: +stake1.toFixed(2),
    stake2: +stake2.toFixed(2),
    totalStake: totalStake,
    guaranteedProfit: +Math.min(profit1, profit2).toFixed(2),
    profitPct: +(Math.min(profit1, profit2) / totalStake * 100).toFixed(3),
    payout1: +(stake1 * d1).toFixed(2),
    payout2: +(stake2 * d2).toFixed(2)
  };
}

// ==================== MULTI-BOOK SCANNER ====================

/**
 * Extract best odds for each outcome from all bookmakers
 * Returns the best available odds across all books for each side
 */
function findBestOdds(bookmakers, market = 'h2h') {
  const sides = {};
  
  for (const bk of bookmakers) {
    const mkt = (bk.markets || []).find(m => m.key === market);
    if (!mkt) continue;
    
    for (const outcome of mkt.outcomes) {
      const key = market === 'totals' 
        ? `${outcome.name}${outcome.point ? '_' + outcome.point : ''}`
        : outcome.name;
      
      if (!sides[key]) {
        sides[key] = {
          name: outcome.name,
          point: outcome.point,
          bestOdds: outcome.price,
          bestBook: bk.title,
          allOdds: []
        };
      }
      
      sides[key].allOdds.push({
        book: bk.title,
        odds: outcome.price,
        point: outcome.point
      });
      
      if (outcome.price > sides[key].bestOdds) {
        sides[key].bestOdds = outcome.price;
        sides[key].bestBook = bk.title;
      }
    }
  }
  
  return sides;
}

/**
 * Scan a single game for arbitrage opportunities across all markets
 */
function scanGameForArbs(game) {
  const results = {
    game: `${game.away_team} @ ${game.home_team}`,
    gameId: game.id,
    commence: game.commence_time,
    sport: game.sport_key,
    arbs: [],
    lowHolds: [],
    middles: [],
    staleLines: []
  };
  
  const bookmakers = game.bookmakers || [];
  if (bookmakers.length < 2) return results;
  
  // ---- MONEYLINE SCAN ----
  scanMarketForArbs(bookmakers, 'h2h', game, results);
  
  // ---- SPREAD SCAN ----
  scanMarketForArbs(bookmakers, 'spreads', game, results);
  
  // ---- TOTALS SCAN ----
  scanMarketForArbs(bookmakers, 'totals', game, results);
  
  // ---- MIDDLE SCAN (spreads) ----
  scanForMiddles(bookmakers, 'spreads', game, results);
  
  // ---- MIDDLE SCAN (totals) ----
  scanForMiddles(bookmakers, 'totals', game, results);
  
  // ---- STALE LINE DETECTION ----
  detectStaleLines(bookmakers, game, results);
  
  // Deduplicate: same pair of (book1 side1, book2 side2) can appear in reverse order
  const seen = new Set();
  results.arbs = results.arbs.filter(a => {
    const key = [a.side1.book, a.side1.label, a.side2.book, a.side2.label].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const lowSeen = new Set();
  results.lowHolds = results.lowHolds.filter(l => {
    const key = [l.side1.book, l.side1.label, l.side2.book, l.side2.label].sort().join('|');
    if (lowSeen.has(key)) return false;
    lowSeen.add(key);
    return true;
  });
  
  return results;
}

/**
 * Scan a specific market across all book pairs for arbs and low holds
 */
function scanMarketForArbs(bookmakers, market, game, results) {
  // For each pair of books, check if opposite sides create an arb
  for (let i = 0; i < bookmakers.length; i++) {
    const mktI = (bookmakers[i].markets || []).find(m => m.key === market);
    if (!mktI) continue;
    
    for (let j = i + 1; j < bookmakers.length; j++) {
      const mktJ = (bookmakers[j].markets || []).find(m => m.key === market);
      if (!mktJ) continue;
      
      // Group outcomes by their "side"
      const outcomesI = {};
      const outcomesJ = {};
      
      for (const o of mktI.outcomes) {
        const key = market === 'totals' ? o.name : o.name; // Over/Under or TeamName
        outcomesI[key] = { odds: o.price, point: o.point };
      }
      for (const o of mktJ.outcomes) {
        const key = market === 'totals' ? o.name : o.name;
        outcomesJ[key] = { odds: o.price, point: o.point };
      }
      
      // For spreads/totals: only compare same-point opposite sides
      // For ML: compare home vs away
      
      if (market === 'h2h') {
        // Check: Book I home ML vs Book J away ML (and vice versa)
        const homeI = outcomesI[game.home_team];
        const awayI = outcomesI[game.away_team];
        const homeJ = outcomesJ[game.home_team];
        const awayJ = outcomesJ[game.away_team];
        
        // Cross-book: Book I home + Book J away
        if (homeI && awayJ) {
          checkArbPair(homeI.odds, awayJ.odds, bookmakers[i].title, bookmakers[j].title,
            `${game.home_team} ML`, `${game.away_team} ML`, market, null, results);
        }
        // Cross-book: Book J home + Book I away  
        if (homeJ && awayI) {
          checkArbPair(homeJ.odds, awayI.odds, bookmakers[j].title, bookmakers[i].title,
            `${game.home_team} ML`, `${game.away_team} ML`, market, null, results);
        }
      }
      
      if (market === 'spreads') {
        // For spreads: side1 = team1 at point X, side2 = team2 at point -X
        // Both books must have the SAME point for a clean arb
        // But different points can create middles
        const sides = [game.home_team, game.away_team];
        for (const side of sides) {
          const otherSide = side === game.home_team ? game.away_team : game.home_team;
          const sI = outcomesI[side];
          const sJ = outcomesJ[side];
          const oI = outcomesI[otherSide];
          const oJ = outcomesJ[otherSide];
          
          // Cross-book same point: Book I side + Book J otherSide
          if (sI && oJ && sI.point !== undefined && oJ.point !== undefined) {
            // Spreads must be opposite (home -3.5, away +3.5)
            if (Math.abs(sI.point + oJ.point) < 0.01) {
              checkArbPair(sI.odds, oJ.odds, bookmakers[i].title, bookmakers[j].title,
                `${side} ${sI.point > 0 ? '+' : ''}${sI.point}`, 
                `${otherSide} ${oJ.point > 0 ? '+' : ''}${oJ.point}`,
                market, sI.point, results);
            }
          }
        }
      }
      
      if (market === 'totals') {
        const overI = outcomesI['Over'];
        const underI = outcomesI['Under'];
        const overJ = outcomesJ['Over'];
        const underJ = outcomesJ['Under'];
        
        // Cross-book same total: Book I Over + Book J Under
        if (overI && underJ && overI.point === underJ.point) {
          checkArbPair(overI.odds, underJ.odds, bookmakers[i].title, bookmakers[j].title,
            `Over ${overI.point}`, `Under ${underJ.point}`, market, overI.point, results);
        }
        // Cross-book: Book J Over + Book I Under
        if (overJ && underI && overJ.point === underI.point) {
          checkArbPair(overJ.odds, underI.odds, bookmakers[j].title, bookmakers[i].title,
            `Over ${overJ.point}`, `Under ${underI.point}`, market, overJ.point, results);
        }
      }
    }
  }
}

/**
 * Check a pair of odds for arb or low-hold
 */
function checkArbPair(odds1, odds2, book1, book2, side1Label, side2Label, market, point, results) {
  const hold = calculateHold(odds1, odds2);
  if (!hold) return;
  
  const entry = {
    side1: { label: side1Label, book: book1, odds: odds1 },
    side2: { label: side2Label, book: book2, odds: odds2 },
    market,
    point,
    hold: hold.holdPct,
    combined: hold.combined
  };
  
  if (hold.hold < 0) {
    // TRUE ARBITRAGE — guaranteed profit
    const arb = calculateArbProfit(odds1, odds2);
    const stakes = calculateArbStakes(odds1, odds2, 1000);
    results.arbs.push({
      ...entry,
      type: 'ARBITRAGE',
      profit: arb.profitPct,
      arbPct: arb.arbPct,
      exampleStakes: stakes, // on $1000
      urgency: arb.profitPct > 3 ? 'HIGH' : arb.profitPct > 1 ? 'MEDIUM' : 'LOW'
    });
  } else if (hold.holdPct < 3.0) {
    // LOW HOLD — great for model-based bets
    results.lowHolds.push({
      ...entry,
      type: 'LOW_HOLD',
      tier: hold.holdPct < 1.0 ? 'EXCELLENT' : hold.holdPct < 2.0 ? 'GREAT' : 'GOOD'
    });
  }
}

/**
 * Scan for middle opportunities
 * A middle exists when two books have different spread/total lines
 * such that you can bet both sides and potentially win BOTH bets
 */
function scanForMiddles(bookmakers, market, game, results) {
  // Collect all lines from all books
  const lines = [];
  
  for (const bk of bookmakers) {
    const mkt = (bk.markets || []).find(m => m.key === market);
    if (!mkt) continue;
    
    for (const o of mkt.outcomes) {
      lines.push({
        book: bk.title,
        name: o.name,
        odds: o.price,
        point: o.point
      });
    }
  }
  
  if (market === 'spreads') {
    // Find middles: Book A has Home -2.5, Book B has Away +3.5
    // Middle exists if the points don't match (gap between them)
    const homeLines = lines.filter(l => l.name === game.home_team);
    const awayLines = lines.filter(l => l.name === game.away_team);
    
    for (const hl of homeLines) {
      for (const al of awayLines) {
        if (hl.book === al.book) continue; // same book, skip
        
        // Home spread is negative (e.g., -2.5), Away spread is positive (e.g., +3.5)
        // Middle exists if |home_spread| < away_spread (the gap is the middle)
        const homeSpread = hl.point; // e.g., -2.5
        const awaySpread = al.point; // e.g., +3.5
        
        // For a middle: home wins by exactly N where |homeSpread| < N < awaySpread
        // E.g., home -2.5 and away +3.5: if home wins by 3, BOTH bets win
        if (homeSpread < 0 && awaySpread > 0) {
          const gap = awaySpread + homeSpread; // +3.5 + (-2.5) = 1.0
          if (gap > 0) {
            // Calculate middle probability (rough)
            // Each 0.5 point of middle ≈ 3% chance
            const middleProb = Math.min(0.30, gap * 0.06); // rough estimate
            
            // Calculate costs: we're paying vig on both sides
            const holdHome = americanToImplied(hl.odds);
            const holdAway = americanToImplied(al.odds);
            const totalCost = holdHome + holdAway - 1;
            
            // Expected value of the middle
            // If middle hits: win both bets (payout from both)
            // If no middle: lose one, win one (net = -vig)
            const d1 = americanToDecimal(hl.odds);
            const d2 = americanToDecimal(al.odds);
            
            // EV calculation
            const middlePayoff = d1 + d2 - 2; // profit from winning both (per unit)
            const noMiddlePayoff = -totalCost; // net loss from vig when one wins
            const ev = middleProb * middlePayoff + (1 - middleProb) * noMiddlePayoff;
            
            results.middles.push({
              type: 'MIDDLE',
              side1: { label: `${game.home_team} ${homeSpread}`, book: hl.book, odds: hl.odds },
              side2: { label: `${game.away_team} +${awaySpread}`, book: al.book, odds: al.odds },
              market,
              gap: +gap.toFixed(1),
              middleNumbers: `${Math.abs(homeSpread) + 0.5} to ${awaySpread - 0.5}`,
              middleProbability: +(middleProb * 100).toFixed(1),
              ev: +(ev * 100).toFixed(2),
              rating: ev > 0.02 ? 'STRONG' : ev > 0 ? 'MARGINAL' : 'NEGATIVE'
            });
          }
        }
      }
    }
  }
  
  if (market === 'totals') {
    // Find totals middles: Book A has Over 8.5, Book B has Under 9.5
    const overs = lines.filter(l => l.name === 'Over');
    const unders = lines.filter(l => l.name === 'Under');
    
    for (const ov of overs) {
      for (const un of unders) {
        if (ov.book === un.book) continue;
        
        // Middle: Over 8.5 + Under 9.5 → middle on exactly 9
        const gap = un.point - ov.point;
        if (gap > 0) {
          const middleProb = Math.min(0.30, gap * 0.06);
          const d1 = americanToDecimal(ov.odds);
          const d2 = americanToDecimal(un.odds);
          const totalCost = americanToImplied(ov.odds) + americanToImplied(un.odds) - 1;
          const middlePayoff = d1 + d2 - 2;
          const noMiddlePayoff = -totalCost;
          const ev = middleProb * middlePayoff + (1 - middleProb) * noMiddlePayoff;
          
          results.middles.push({
            type: 'TOTAL_MIDDLE',
            side1: { label: `Over ${ov.point}`, book: ov.book, odds: ov.odds },
            side2: { label: `Under ${un.point}`, book: un.book, odds: un.odds },
            market: 'totals',
            gap: +gap.toFixed(1),
            middleNumbers: `${ov.point + 0.5} to ${un.point - 0.5}`,
            middleProbability: +(middleProb * 100).toFixed(1),
            ev: +(ev * 100).toFixed(2),
            rating: ev > 0.02 ? 'STRONG' : ev > 0 ? 'MARGINAL' : 'NEGATIVE'
          });
        }
      }
    }
  }
}

/**
 * Detect stale/lagging lines across books
 * A stale line exists when one book's odds significantly differ from the market consensus
 */
function detectStaleLines(bookmakers, game, results) {
  const markets = ['h2h', 'spreads', 'totals'];
  
  for (const market of markets) {
    // Collect all odds for each outcome
    const outcomeOdds = {};
    
    for (const bk of bookmakers) {
      const mkt = (bk.markets || []).find(m => m.key === market);
      if (!mkt) continue;
      
      for (const o of mkt.outcomes) {
        const key = `${o.name}${o.point !== undefined ? '_' + o.point : ''}`;
        if (!outcomeOdds[key]) {
          outcomeOdds[key] = { name: o.name, point: o.point, odds: [] };
        }
        outcomeOdds[key].odds.push({ book: bk.title, odds: o.price });
      }
    }
    
    // For each outcome, find outliers
    for (const [key, data] of Object.entries(outcomeOdds)) {
      if (data.odds.length < 4) continue; // need enough books for consensus
      
      const allOdds = data.odds.map(o => o.odds).sort((a, b) => a - b);
      const median = allOdds[Math.floor(allOdds.length / 2)];
      const medianImplied = americanToImplied(median);
      
      for (const entry of data.odds) {
        const entryImplied = americanToImplied(entry.odds);
        if (!medianImplied || !entryImplied) continue;
        
        // "Stale" = implied probability differs by >3% from median
        const diff = Math.abs(entryImplied - medianImplied);
        if (diff > 0.03) {
          const direction = entryImplied < medianImplied ? 'PLUS_VALUE' : 'OVERPRICED';
          results.staleLines.push({
            type: 'STALE_LINE',
            outcome: data.name,
            point: data.point,
            market,
            book: entry.book,
            bookOdds: entry.odds,
            bookImplied: +(entryImplied * 100).toFixed(1),
            medianOdds: median,
            medianImplied: +(medianImplied * 100).toFixed(1),
            diffPct: +(diff * 100).toFixed(1),
            direction,
            numBooks: data.odds.length,
            // If this book is giving better odds than market, it's a plus-value opportunity
            actionable: direction === 'PLUS_VALUE'
          });
        }
      }
    }
  }
  
  // Sort stale lines by diff
  results.staleLines.sort((a, b) => b.diffPct - a.diffPct);
  // Keep only top stale lines per game
  results.staleLines = results.staleLines.slice(0, 10);
  
  // Deduplicate middles (same pair can appear in both iteration orders)
  const middleSeen = new Set();
  results.middles = results.middles.filter(m => {
    const key = [m.side1.book, m.side1.label, m.side2.book, m.side2.label].sort().join('|');
    if (middleSeen.has(key)) return false;
    middleSeen.add(key);
    return true;
  });
}

// ==================== MULTI-SPORT SCANNER ====================

/**
 * Scan all games for a sport
 */
async function scanSport(sportKey, oddsData) {
  if (!oddsData || !Array.isArray(oddsData) || oddsData.length === 0) {
    return { sport: sportKey, games: [], arbs: [], lowHolds: [], middles: [], staleLines: [], error: 'No odds data' };
  }
  
  const allResults = {
    sport: sportKey,
    games: [],
    arbs: [],
    lowHolds: [],
    middles: [],
    staleLines: [],
    scanned: oddsData.length,
    timestamp: new Date().toISOString()
  };
  
  for (const game of oddsData) {
    const gameResults = scanGameForArbs(game);
    allResults.games.push({
      game: gameResults.game,
      commence: gameResults.commence,
      arbCount: gameResults.arbs.length,
      lowHoldCount: gameResults.lowHolds.length,
      middleCount: gameResults.middles.length,
      staleCount: gameResults.staleLines.length
    });
    allResults.arbs.push(...gameResults.arbs.map(a => ({ ...a, game: gameResults.game, commence: gameResults.commence })));
    allResults.lowHolds.push(...gameResults.lowHolds.map(l => ({ ...l, game: gameResults.game, commence: gameResults.commence })));
    allResults.middles.push(...gameResults.middles.map(m => ({ ...m, game: gameResults.game, commence: gameResults.commence })));
    allResults.staleLines.push(...gameResults.staleLines.map(s => ({ ...s, game: gameResults.game, commence: gameResults.commence })));
  }
  
  // Sort by quality
  allResults.arbs.sort((a, b) => b.profit - a.profit);
  allResults.lowHolds.sort((a, b) => a.hold - b.hold);
  allResults.middles.sort((a, b) => b.ev - a.ev);
  allResults.staleLines.sort((a, b) => b.diffPct - a.diffPct);
  
  return allResults;
}

/**
 * Scan all sports simultaneously
 */
async function scanAll(fetchOddsFn) {
  const sportKeys = [
    { key: 'basketball_nba', label: 'NBA' },
    { key: 'baseball_mlb', label: 'MLB' },
    { key: 'icehockey_nhl', label: 'NHL' }
  ];
  
  const combined = {
    arbs: [],
    lowHolds: [],
    middles: [],
    staleLines: [],
    sports: {},
    totalGames: 0,
    timestamp: new Date().toISOString()
  };
  
  for (const sport of sportKeys) {
    try {
      const odds = await fetchOddsFn(sport.key);
      const results = await scanSport(sport.key, odds);
      combined.sports[sport.label] = {
        scanned: results.scanned,
        arbs: results.arbs.length,
        lowHolds: results.lowHolds.length,
        middles: results.middles.length,
        staleLines: results.staleLines.length
      };
      combined.totalGames += results.scanned;
      combined.arbs.push(...results.arbs.map(a => ({ ...a, sport: sport.label })));
      combined.lowHolds.push(...results.lowHolds.map(l => ({ ...l, sport: sport.label })));
      combined.middles.push(...results.middles.map(m => ({ ...m, sport: sport.label })));
      combined.staleLines.push(...results.staleLines.map(s => ({ ...s, sport: sport.label })));
    } catch (e) {
      combined.sports[sport.label] = { error: e.message };
    }
  }
  
  // Sort all combined
  combined.arbs.sort((a, b) => b.profit - a.profit);
  combined.lowHolds.sort((a, b) => a.hold - b.hold);
  combined.middles.sort((a, b) => b.ev - a.ev);
  combined.staleLines.sort((a, b) => b.diffPct - a.diffPct);
  
  // Cache results
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(combined, null, 2));
  } catch (e) { /* cache write failed, non-critical */ }
  
  return combined;
}

/**
 * Get cached scan results (for dashboard quick-load)
 */
function getCachedScan() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age < CACHE_TTL) return { ...data, cached: true, age: Math.round(age / 1000) };
    }
  } catch (e) {}
  return null;
}

/**
 * Generate a summary report of opportunities
 */
function generateReport(scanResults) {
  const { arbs, lowHolds, middles, staleLines, sports, totalGames } = scanResults;
  
  let report = `🔍 ARBITRAGE SCAN REPORT\n`;
  report += `═══════════════════════════════\n`;
  report += `Scanned: ${totalGames} games across ${Object.keys(sports).length} sports\n`;
  report += `Time: ${new Date().toISOString()}\n\n`;
  
  // Arbs
  if (arbs.length > 0) {
    report += `💰 TRUE ARBITRAGES (${arbs.length} found)\n`;
    report += `───────────────────────────\n`;
    for (const arb of arbs) {
      report += `  ${arb.sport} | ${arb.game}\n`;
      report += `  ${arb.side1.label} @ ${arb.side1.odds} (${arb.side1.book})\n`;
      report += `  ${arb.side2.label} @ ${arb.side2.odds} (${arb.side2.book})\n`;
      report += `  ✅ GUARANTEED PROFIT: ${arb.profit}%\n`;
      if (arb.exampleStakes) {
        report += `  📊 $1000 play: $${arb.exampleStakes.stake1} / $${arb.exampleStakes.stake2} → $${arb.exampleStakes.guaranteedProfit} profit\n`;
      }
      report += `\n`;
    }
  } else {
    report += `💰 TRUE ARBITRAGES: None found (markets are efficient right now)\n\n`;
  }
  
  // Low holds
  report += `📉 LOW-HOLD MARKETS (${lowHolds.length} found, hold < 3%)\n`;
  report += `───────────────────────────\n`;
  for (const lh of lowHolds.slice(0, 10)) {
    report += `  ${lh.sport || ''} | ${lh.game || ''} | ${lh.market}\n`;
    report += `  ${lh.side1.label} @ ${lh.side1.odds} (${lh.side1.book}) vs ${lh.side2.label} @ ${lh.side2.odds} (${lh.side2.book})\n`;
    report += `  Hold: ${lh.hold}% [${lh.tier}]\n\n`;
  }
  
  // Middles
  if (middles.length > 0) {
    const strongMiddles = middles.filter(m => m.rating !== 'NEGATIVE');
    report += `🎯 MIDDLE OPPORTUNITIES (${strongMiddles.length} actionable)\n`;
    report += `───────────────────────────\n`;
    for (const m of strongMiddles.slice(0, 10)) {
      report += `  ${m.sport || ''} | ${m.game || ''}\n`;
      report += `  ${m.side1.label} @ ${m.side1.odds} (${m.side1.book})\n`;
      report += `  ${m.side2.label} @ ${m.side2.odds} (${m.side2.book})\n`;
      report += `  Gap: ${m.gap} | Middle on: ${m.middleNumbers} (${m.middleProbability}% hit rate)\n`;
      report += `  EV: ${m.ev}% [${m.rating}]\n\n`;
    }
  }
  
  // Stale lines
  if (staleLines.filter(s => s.actionable).length > 0) {
    const actionable = staleLines.filter(s => s.actionable);
    report += `⚡ STALE LINES (${actionable.length} plus-value opportunities)\n`;
    report += `───────────────────────────\n`;
    for (const s of actionable.slice(0, 10)) {
      report += `  ${s.sport || ''} | ${s.game || ''} | ${s.market}\n`;
      report += `  ${s.outcome}${s.point ? ' ' + s.point : ''} @ ${s.bookOdds} (${s.book})\n`;
      report += `  Market median: ${s.medianOdds} | Diff: ${s.diffPct}%\n\n`;
    }
  }
  
  return report;
}

// ==================== EXPORTS ====================

module.exports = {
  // Core math
  americanToImplied,
  americanToDecimal,
  impliedToAmerican,
  calculateHold,
  calculateArbProfit,
  calculateArbStakes,
  
  // Scanning
  findBestOdds,
  scanGameForArbs,
  scanSport,
  scanAll,
  getCachedScan,
  
  // Reporting
  generateReport
};
