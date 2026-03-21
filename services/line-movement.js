/**
 * Line Movement Tracker — services/line-movement.js
 * 
 * Snapshots odds from /api/today, stores 48hr rolling history,
 * detects sharp money signals: steam moves, reverse line movement, stale lines.
 */

const SNAPSHOT_INTERVAL = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY_MS = 48 * 60 * 60 * 1000; // 48 hours

// In-memory snapshot store: { gameId: [{ ts, books: { bookName: { homeML, awayML, spread, total } } }] }
const snapshots = {};

// Detected signals
let signals = [];

/**
 * Take a snapshot from /api/today game data.
 * @param {Array} games - array of game objects from getAllOdds()
 */
function takeSnapshot(games) {
  if (!Array.isArray(games) || games.length === 0) return { stored: 0 };

  const now = Date.now();
  let stored = 0;

  for (const game of games) {
    const id = game.gameId || `${game.away}-${game.home}-${game.sport}`;
    if (!snapshots[id]) snapshots[id] = [];

    const bookData = {};
    if (game.bookOdds && typeof game.bookOdds === 'object') {
      for (const [bookName, odds] of Object.entries(game.bookOdds)) {
        bookData[bookName] = {
          homeML: odds.homeML || null,
          awayML: odds.awayML || null,
          spread: odds.spread || null,
          total: odds.total || null
        };
      }
    }
    // Also capture consensus / model line if available
    const snap = {
      ts: now,
      books: bookData,
      consensus: {
        homeML: game.homeML || null,
        awayML: game.awayML || null,
        spread: game.spread || null,
        total: game.total || null
      },
      modelProb: game.modelWinProb || null,
      sport: game.sport,
      home: game.home,
      away: game.away
    };

    snapshots[id].push(snap);
    stored++;
  }

  // Prune old data
  pruneOld(now);

  // Detect signals after new snapshot
  signals = detectSignals();

  return { stored, totalGames: Object.keys(snapshots).length, timestamp: new Date(now).toISOString() };
}

function pruneOld(now) {
  const cutoff = now - MAX_HISTORY_MS;
  for (const id of Object.keys(snapshots)) {
    snapshots[id] = snapshots[id].filter(s => s.ts >= cutoff);
    if (snapshots[id].length === 0) delete snapshots[id];
  }
}

/**
 * Detect sharp money signals across all tracked games.
 */
function detectSignals() {
  const detected = [];
  const now = Date.now();

  for (const [gameId, history] of Object.entries(snapshots)) {
    if (history.length < 2) continue;

    const first = history[0];
    const latest = history[history.length - 1];
    const sport = latest.sport || 'Unknown';
    const home = latest.home || gameId.split('-')[1] || '?';
    const away = latest.away || gameId.split('-')[0] || '?';

    // --- STEAM MOVE DETECTION ---
    // Check last 60 min for rapid line movement
    const recentCutoff = now - 60 * 60 * 1000;
    const recentSnaps = history.filter(s => s.ts >= recentCutoff);
    if (recentSnaps.length >= 2) {
      const recentFirst = recentSnaps[0];
      const recentLast = recentSnaps[recentSnaps.length - 1];

      // Spread steam: 1.5+ point swing
      if (recentFirst.consensus.spread != null && recentLast.consensus.spread != null) {
        const spreadDelta = Math.abs(recentLast.consensus.spread - recentFirst.consensus.spread);
        if (spreadDelta >= 1.5) {
          detected.push({
            type: 'STEAM',
            badge: '⚡',
            sport,
            game: `${away} @ ${home}`,
            gameId,
            description: `Spread moved ${recentFirst.consensus.spread} → ${recentLast.consensus.spread} (${spreadDelta.toFixed(1)} pts in ${Math.round((recentLast.ts - recentFirst.ts) / 60000)} min)`,
            delta: spreadDelta,
            market: 'spread',
            direction: recentLast.consensus.spread > recentFirst.consensus.spread ? 'home' : 'away',
            ts: recentLast.ts
          });
        }
      }

      // ML steam: 15+ cent shift (e.g., -150 → -165)
      if (recentFirst.consensus.homeML != null && recentLast.consensus.homeML != null) {
        const mlDelta = Math.abs(recentLast.consensus.homeML - recentFirst.consensus.homeML);
        if (mlDelta >= 15) {
          detected.push({
            type: 'STEAM',
            badge: '⚡',
            sport,
            game: `${away} @ ${home}`,
            gameId,
            description: `Home ML moved ${recentFirst.consensus.homeML} → ${recentLast.consensus.homeML} (${mlDelta} cents in ${Math.round((recentLast.ts - recentFirst.ts) / 60000)} min)`,
            delta: mlDelta,
            market: 'moneyline',
            direction: recentLast.consensus.homeML < recentFirst.consensus.homeML ? 'home' : 'away',
            ts: recentLast.ts
          });
        }
      }

      // Total steam: 1+ point swing
      if (recentFirst.consensus.total != null && recentLast.consensus.total != null) {
        const totalDelta = Math.abs(recentLast.consensus.total - recentFirst.consensus.total);
        if (totalDelta >= 1) {
          detected.push({
            type: 'STEAM',
            badge: '⚡',
            sport,
            game: `${away} @ ${home}`,
            gameId,
            description: `Total moved ${recentFirst.consensus.total} → ${recentLast.consensus.total} (${totalDelta.toFixed(1)} pts in ${Math.round((recentLast.ts - recentFirst.ts) / 60000)} min)`,
            delta: totalDelta,
            market: 'total',
            direction: recentLast.consensus.total > recentFirst.consensus.total ? 'over' : 'under',
            ts: recentLast.ts
          });
        }
      }
    }

    // --- REVERSE LINE MOVEMENT (RLM) ---
    // Compare opening to current: if spread moved toward the underdog while
    // public money is likely on the favorite, that's RLM.
    if (first.consensus.spread != null && latest.consensus.spread != null) {
      const openSpread = first.consensus.spread;
      const currSpread = latest.consensus.spread;
      const spreadShift = currSpread - openSpread;

      // RLM: line moves in the "wrong" direction (toward underdog)
      // If home was favored (negative spread) and spread gets more positive → RLM on away
      // If home was dog (positive spread) and spread gets more negative → RLM on home
      if (Math.abs(spreadShift) >= 0.5) {
        const homeFavored = openSpread < 0;
        const movedTowardDog = (homeFavored && spreadShift > 0) || (!homeFavored && spreadShift < 0);
        if (movedTowardDog) {
          detected.push({
            type: 'RLM',
            badge: '🔥',
            sport,
            game: `${away} @ ${home}`,
            gameId,
            description: `Reverse Line Movement: spread ${openSpread} → ${currSpread} (sharp money on ${homeFavored ? 'away' : 'home'})`,
            delta: Math.abs(spreadShift),
            market: 'spread',
            direction: homeFavored ? 'away' : 'home',
            ts: latest.ts
          });
        }
      }
    }

    // --- STALE LINE DETECTION ---
    // Find books that haven't moved while consensus moved 1+ point
    if (latest.books && Object.keys(latest.books).length > 1 && first.books) {
      const consensusShift = (latest.consensus.spread || 0) - (first.consensus.spread || 0);
      if (Math.abs(consensusShift) >= 1) {
        for (const [book, currentLine] of Object.entries(latest.books)) {
          const openBook = first.books[book];
          if (openBook && currentLine.spread != null && openBook.spread != null) {
            const bookShift = Math.abs(currentLine.spread - openBook.spread);
            if (bookShift < 0.5) {
              detected.push({
                type: 'STALE',
                badge: '🐌',
                sport,
                game: `${away} @ ${home}`,
                gameId,
                description: `${book} stale: spread still ${currentLine.spread} while market moved ${consensusShift.toFixed(1)} pts`,
                book,
                market: 'spread',
                ts: latest.ts
              });
            }
          }
        }
      }
    }
  }

  // Sort by most recent first, deduplicate per game+type+market
  const seen = new Set();
  const unique = [];
  detected.sort((a, b) => b.ts - a.ts);
  for (const s of detected) {
    const key = `${s.gameId}-${s.type}-${s.market}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }

  return unique;
}

/**
 * Get line movement data for a specific sport.
 */
function getMovement(sport) {
  const results = [];
  for (const [gameId, history] of Object.entries(snapshots)) {
    if (history.length === 0) continue;
    const latest = history[history.length - 1];
    if (sport && sport !== 'all' && latest.sport && latest.sport.toLowerCase() !== sport.toLowerCase()) continue;

    const first = history[0];
    results.push({
      gameId,
      sport: latest.sport,
      game: `${latest.away} @ ${latest.home}`,
      home: latest.home,
      away: latest.away,
      snapshots: history.length,
      opening: {
        spread: first.consensus.spread,
        homeML: first.consensus.homeML,
        awayML: first.consensus.awayML,
        total: first.consensus.total
      },
      current: {
        spread: latest.consensus.spread,
        homeML: latest.consensus.homeML,
        awayML: latest.consensus.awayML,
        total: latest.consensus.total
      },
      movement: {
        spread: first.consensus.spread != null && latest.consensus.spread != null
          ? +(latest.consensus.spread - first.consensus.spread).toFixed(1) : null,
        homeML: first.consensus.homeML != null && latest.consensus.homeML != null
          ? latest.consensus.homeML - first.consensus.homeML : null,
        total: first.consensus.total != null && latest.consensus.total != null
          ? +(latest.consensus.total - first.consensus.total).toFixed(1) : null
      },
      signals: signals.filter(s => s.gameId === gameId),
      firstSeen: new Date(first.ts).toISOString(),
      lastUpdated: new Date(latest.ts).toISOString()
    });
  }
  return results;
}

/**
 * Get all detected sharp money signals.
 */
function getSharpSignals(sport) {
  if (sport && sport !== 'all') {
    return signals.filter(s => s.sport.toLowerCase() === sport.toLowerCase());
  }
  return signals;
}

/**
 * Get snapshot history for a specific game.
 */
function getGameHistory(gameId) {
  return snapshots[gameId] || [];
}

/**
 * Get stats about the tracker.
 */
function getStatus() {
  let totalSnaps = 0;
  for (const h of Object.values(snapshots)) totalSnaps += h.length;
  return {
    gamesTracked: Object.keys(snapshots).length,
    totalSnapshots: totalSnaps,
    activeSignals: signals.length,
    signalBreakdown: {
      steam: signals.filter(s => s.type === 'STEAM').length,
      rlm: signals.filter(s => s.type === 'RLM').length,
      stale: signals.filter(s => s.type === 'STALE').length
    },
    oldestSnapshot: Object.values(snapshots).flat().reduce((min, s) => s.ts < min ? s.ts : min, Date.now()),
    newestSnapshot: Object.values(snapshots).flat().reduce((max, s) => s.ts > max ? s.ts : max, 0)
  };
}

module.exports = {
  takeSnapshot,
  getMovement,
  getSharpSignals,
  getGameHistory,
  getStatus,
  SNAPSHOT_INTERVAL
};
