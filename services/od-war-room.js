// services/od-war-room.js — Opening Day War Room v79.0
// ===================================================
// THE UNIFIED COMMAND CENTER: Aggregates ALL prop models + game predictions
// into one actionable endpoint for March 26-27 Opening Day execution.
//
// Combines:
//   1. Game-level plays (ML, totals, F5, run lines) from betting card
//   2. K Props (pitcher strikeout over/unders)
//   3. Outs Props (pitcher outs recorded over/unders)
//   4. Batter Props (hits, HR, TB from Statcast xBA/xSLG)
//   5. NRFI/YRFI (1st inning scoring model)
//   6. SGPs (correlated same-game parlays)
//   7. Weather signals
//   8. Line shopping (best price across books)
//
// WHY: On game day, we need ONE place to see everything. Not 8 separate tabs.
// This is the "put on your war paint and print money" endpoint.

// Load all services safely
let odPlaybookCache = null;
let pitcherKProps = null;
let pitcherOutsProps = null;
let batterProps = null;
let nrfiModel = null;
let odSgpBuilder = null;
let lineShopping = null;
let weatherForecast = null;
let teamTendencies = null;

try { odPlaybookCache = require('./od-playbook-cache'); } catch (e) { /* ok */ }
try { pitcherKProps = require('./pitcher-k-props'); } catch (e) { /* ok */ }
try { pitcherOutsProps = require('./pitcher-outs-props'); } catch (e) { /* ok */ }
try { batterProps = require('./batter-props'); } catch (e) { /* ok */ }
try { nrfiModel = require('./nrfi-model'); } catch (e) { /* ok */ }
try { odSgpBuilder = require('./od-sgp-builder'); } catch (e) { /* ok */ }
try { lineShopping = require('./line-shopping'); } catch (e) { /* ok */ }
try { weatherForecast = require('./weather-forecast'); } catch (e) { /* ok */ }
try { teamTendencies = require('./od-team-tendencies'); } catch (e) { /* ok */ }

// ==================== PLAY TYPES ====================
const PLAY_TYPES = {
  ML: { label: 'Moneyline', icon: '💰', category: 'game' },
  TOTAL: { label: 'Total (O/U)', icon: '📊', category: 'game' },
  F5: { label: 'First 5 Innings', icon: '5️⃣', category: 'game' },
  RUN_LINE: { label: 'Run Line', icon: '📏', category: 'game' },
  K_PROP: { label: 'Strikeout Prop', icon: '⚡', category: 'pitcher_prop' },
  OUTS_PROP: { label: 'Outs Recorded', icon: '⏱️', category: 'pitcher_prop' },
  BATTER_HIT: { label: 'Batter Hits', icon: '🏏', category: 'batter_prop' },
  BATTER_HR: { label: 'Batter HR', icon: '💣', category: 'batter_prop' },
  BATTER_TB: { label: 'Batter Total Bases', icon: '🔥', category: 'batter_prop' },
  NRFI: { label: 'NRFI/YRFI', icon: '🚫', category: 'first_inning' },
  SGP: { label: 'Same Game Parlay', icon: '🎰', category: 'sgp' },
};

// ==================== UNIFIED PLAY BUILDER ====================
/**
 * Build ALL plays across ALL models for one OD game
 */
function buildGamePlays(game, options = {}) {
  const plays = [];
  const { bankroll = 1000, kellyFraction = 0.5, isOpeningDay = true } = options;
  const gameKey = `${game.away}@${game.home}`;
  
  // 1. Game-level plays from betting card (ML, totals, F5, run lines)
  if (game.bets) {
    for (const bet of game.bets) {
      plays.push({
        id: `${gameKey}-${bet.type}-${bet.pick}`.replace(/\s+/g, '-').toLowerCase(),
        game: gameKey,
        type: mapBetType(bet.type),
        pick: bet.pick,
        line: bet.ml || bet.line,
        book: bet.book || 'DraftKings',
        edge: +(bet.edge || bet.diff || 0).toFixed(1),
        modelProb: bet.modelProb,
        bookProb: bet.bookProb,
        confidence: bet.confidence || 'MEDIUM',
        wager: bet.wager || 0,
        ev: bet.ev || 0,
        conviction: game.signals?.conviction?.score || 0,
        grade: game.signals?.conviction?.grade || 'C',
        category: 'game',
        source: 'playbook',
      });
    }
  }
  
  // 2. K Props
  if (pitcherKProps && game.confirmedStarters) {
    try {
      for (const role of ['away', 'home']) {
        const pitcher = game.confirmedStarters?.[role === 'away' ? 'away' : 'home'];
        if (!pitcher) continue;
        
        const kData = pitcherKProps.getKPropPrediction(pitcher, {
          opponent: role === 'away' ? game.home : game.away,
          isOpeningDay,
        });
        
        if (kData && kData.edge > 2) {
          plays.push({
            id: `${gameKey}-k-${pitcher}`.replace(/\s+/g, '-').toLowerCase(),
            game: gameKey,
            type: 'K_PROP',
            pick: `${pitcher} ${kData.recommendation} ${kData.dkLine?.line || '?'} Ks`,
            line: kData.dkLine?.odds || null,
            book: 'DraftKings',
            edge: +kData.edge.toFixed(1),
            modelProb: kData.overProb,
            confidence: kData.confidence || 'MEDIUM',
            wager: 0, // K props sized separately
            ev: 0,
            conviction: 0,
            grade: kData.grade || 'C',
            category: 'pitcher_prop',
            source: 'k-props',
            details: {
              pitcher,
              team: role === 'away' ? game.away : game.home,
              modelKs: kData.adjustedExpectedKs,
              dkLine: kData.dkLine?.line,
              factors: kData.factors,
            },
          });
        }
      }
    } catch (e) { /* skip k props for this game */ }
  }
  
  // 3. Outs Props
  if (pitcherOutsProps && game.confirmedStarters) {
    try {
      for (const role of ['away', 'home']) {
        const pitcher = game.confirmedStarters?.[role];
        if (!pitcher) continue;
        
        const outsData = pitcherOutsProps.getPitcherOutsProps(pitcher);
        if (outsData && outsData.edge > 3) {
          plays.push({
            id: `${gameKey}-outs-${pitcher}`.replace(/\s+/g, '-').toLowerCase(),
            game: gameKey,
            type: 'OUTS_PROP',
            pick: `${pitcher} ${outsData.recommendation} ${outsData.line || '?'} outs`,
            line: null,
            book: 'DraftKings',
            edge: +outsData.edge.toFixed(1),
            modelProb: outsData.overProb,
            confidence: outsData.confidence || 'MEDIUM',
            wager: 0,
            ev: 0,
            conviction: 0,
            grade: outsData.grade || 'C',
            category: 'pitcher_prop',
            source: 'outs-props',
            details: {
              pitcher,
              team: role === 'away' ? game.away : game.home,
              modelOuts: outsData.projectedOuts,
              odPremium: outsData.odPremiumApplied,
            },
          });
        }
      }
    } catch (e) { /* skip outs props for this game */ }
  }
  
  // 4. Batter Props
  if (batterProps) {
    try {
      for (const role of ['away', 'home']) {
        const opposingPitcher = game.confirmedStarters?.[role === 'away' ? 'home' : 'away'];
        if (!opposingPitcher) continue;
        
        const teamAbbr = game[role];
        const batters = batterProps.getBattersForTeam(teamAbbr);
        
        // Top 3 batters from each team
        for (const batter of (batters || []).slice(0, 3)) {
          try {
            const pred = batterProps.predictBatterProps(
              batter.name, opposingPitcher, 
              role === 'away' ? game.home : game.away,
              { isOpeningDay, batterHand: batter.hand }
            );
            
            if (!pred) continue;
            
            // Hits O/U
            if (pred.hits && Math.abs(pred.hits.edge) > 3) {
              plays.push({
                id: `${gameKey}-hits-${batter.name}`.replace(/\s+/g, '-').toLowerCase(),
                game: gameKey,
                type: 'BATTER_HIT',
                pick: `${batter.name} ${pred.hits.recommendation} ${pred.hits.line} hits`,
                line: null,
                book: 'DraftKings',
                edge: +pred.hits.edge.toFixed(1),
                modelProb: pred.hits.overProb,
                confidence: pred.hits.confidence || 'MEDIUM',
                wager: 0,
                ev: 0,
                conviction: 0,
                grade: pred.hits.grade || 'C',
                category: 'batter_prop',
                source: 'batter-props',
                details: {
                  batter: batter.name,
                  team: teamAbbr,
                  xba: batter.xba,
                  vsPitcher: opposingPitcher,
                  projectedHits: pred.hits.projectedHits,
                },
              });
            }
            
            // HR O/U
            if (pred.hr && pred.hr.edge > 5) {
              plays.push({
                id: `${gameKey}-hr-${batter.name}`.replace(/\s+/g, '-').toLowerCase(),
                game: gameKey,
                type: 'BATTER_HR',
                pick: `${batter.name} OVER 0.5 HR`,
                line: null,
                book: 'DraftKings',
                edge: +pred.hr.edge.toFixed(1),
                modelProb: pred.hr.overProb,
                confidence: pred.hr.confidence || 'LOW',
                wager: 0,
                ev: 0,
                conviction: 0,
                grade: pred.hr.grade || 'C',
                category: 'batter_prop',
                source: 'batter-props',
                details: {
                  batter: batter.name,
                  team: teamAbbr,
                  xslg: batter.xslg,
                  hrRate: pred.hr.projectedHRRate,
                },
              });
            }
            
            // Total Bases O/U
            if (pred.totalBases && Math.abs(pred.totalBases.edge) > 3) {
              plays.push({
                id: `${gameKey}-tb-${batter.name}`.replace(/\s+/g, '-').toLowerCase(),
                game: gameKey,
                type: 'BATTER_TB',
                pick: `${batter.name} ${pred.totalBases.recommendation} ${pred.totalBases.line} TB`,
                line: null,
                book: 'DraftKings',
                edge: +pred.totalBases.edge.toFixed(1),
                modelProb: pred.totalBases.overProb,
                confidence: pred.totalBases.confidence || 'MEDIUM',
                wager: 0,
                ev: 0,
                conviction: 0,
                grade: pred.totalBases.grade || 'C',
                category: 'batter_prop',
                source: 'batter-props',
                details: {
                  batter: batter.name,
                  team: teamAbbr,
                  projectedTB: pred.totalBases.projected,
                },
              });
            }
          } catch (e) { /* skip this batter */ }
        }
      }
    } catch (e) { /* skip batter props for this game */ }
  }
  
  // 5. NRFI/YRFI
  if (nrfiModel) {
    try {
      const nrfi = nrfiModel.predictNRFI(game.away, game.home, {
        awayPitcher: game.confirmedStarters?.away,
        homePitcher: game.confirmedStarters?.home,
        isOpeningDay,
      });
      
      if (nrfi && nrfi.nrfiEdge > 2) {
        const pick = nrfi.recommendation === 'NRFI' ? 'NRFI (No Run First Inning)' : 'YRFI (Yes Run First Inning)';
        plays.push({
          id: `${gameKey}-nrfi`.replace(/\s+/g, '-').toLowerCase(),
          game: gameKey,
          type: 'NRFI',
          pick,
          line: null,
          book: 'DraftKings',
          edge: +(nrfi.nrfiEdge || 0).toFixed(1),
          modelProb: nrfi.nrfiProb,
          confidence: nrfi.confidence || 'MEDIUM',
          wager: 0,
          ev: 0,
          conviction: 0,
          grade: nrfi.grade || 'C',
          category: 'first_inning',
          source: 'nrfi',
          details: {
            nrfiProb: nrfi.nrfiProb,
            yrfiProb: nrfi.yrfiProb,
            awayPitcherTier: nrfi.awayPitcherTier,
            homePitcherTier: nrfi.homePitcherTier,
            parkFactor: nrfi.parkFactor,
          },
        });
      }
    } catch (e) { /* skip nrfi for this game */ }
  }
  
  return plays;
}

/**
 * Map bet type string to our play type enum
 */
function mapBetType(type) {
  if (!type) return 'ML';
  const t = type.toLowerCase();
  if (t.includes('f5')) return 'F5';
  if (t.includes('run line') || t.includes('spread')) return 'RUN_LINE';
  if (t.includes('total') || t.includes('o/u') || t.includes('over') || t.includes('under')) return 'TOTAL';
  return 'ML';
}

// ==================== WAR ROOM BUILDER ====================
/**
 * Build the complete War Room — aggregates ALL models into unified output
 */
async function buildWarRoom(options = {}) {
  const { bankroll = 1000, kellyFraction = 0.5, minEdge = 2 } = options;
  const startTime = Date.now();
  
  // Get the playbook (cached for speed)
  let playbook = null;
  if (odPlaybookCache) {
    try {
      playbook = odPlaybookCache.getCachedOnly ? odPlaybookCache.getCachedOnly() : null;
      if (!playbook) {
        playbook = await odPlaybookCache.getPlaybook(bankroll, kellyFraction, 0.02);
      }
    } catch (e) { /* no playbook available */ }
  }
  
  if (!playbook || !playbook.playbook || playbook.playbook.length === 0) {
    return { error: 'Playbook not available yet — waiting for cache build', games: [] };
  }
  
  // Build plays for each game
  const allPlays = [];
  const gameBreakdowns = {};
  
  for (const game of playbook.playbook) {
    const gameKey = `${game.away}@${game.home}`;
    const gamePlays = buildGamePlays(game, { bankroll, kellyFraction, isOpeningDay: true });
    
    gameBreakdowns[gameKey] = {
      game: gameKey,
      date: game.date,
      time: game.time,
      awayStarter: game.awayStarter?.name || game.confirmedStarters?.away || '?',
      homeStarter: game.homeStarter?.name || game.confirmedStarters?.home || '?',
      conviction: game.signals?.conviction?.score || 0,
      grade: game.signals?.conviction?.grade || 'C',
      weather: game.signals?.weather?.summary || 'N/A',
      plays: gamePlays,
      playCount: gamePlays.length,
      totalEdge: gamePlays.reduce((s, p) => s + p.edge, 0),
      categories: {
        game: gamePlays.filter(p => p.category === 'game').length,
        pitcher_prop: gamePlays.filter(p => p.category === 'pitcher_prop').length,
        batter_prop: gamePlays.filter(p => p.category === 'batter_prop').length,
        first_inning: gamePlays.filter(p => p.category === 'first_inning').length,
        sgp: gamePlays.filter(p => p.category === 'sgp').length,
      },
    };
    
    allPlays.push(...gamePlays);
  }
  
  // Add SGP section (runs across all games)
  let sgpSection = null;
  if (odSgpBuilder) {
    try {
      const sgpScan = odSgpBuilder.scanODSGPs({ minEdge: 5, maxLegs: 3 });
      if (sgpScan && sgpScan.topParlays) {
        sgpSection = {
          totalParlays: sgpScan.totalParlays || 0,
          highConfidence: sgpScan.highConfidenceParlays || 0,
          topParlays: (sgpScan.topParlays || []).slice(0, 10).map(p => ({
            game: p.game,
            legs: p.legs,
            combinedOdds: p.combinedOdds,
            adjustedProb: p.adjustedProb,
            edge: p.edge,
            ev: p.ev,
            grade: p.grade,
          })),
        };
      }
    } catch (e) { sgpSection = { error: e.message }; }
  }
  
  // Filter and sort
  const qualifiedPlays = allPlays.filter(p => p.edge >= minEdge);
  qualifiedPlays.sort((a, b) => {
    // SMASH plays first (grade A/A+), then by edge
    const gradeOrder = { 'A+': 0, 'A': 1, 'B+': 2, 'B': 3, 'C+': 4, 'C': 5, 'D': 6, 'F': 7 };
    const aGrade = gradeOrder[a.grade] ?? 5;
    const bGrade = gradeOrder[b.grade] ?? 5;
    if (aGrade !== bGrade) return aGrade - bGrade;
    return b.edge - a.edge;
  });
  
  // Tier by confidence
  const tiers = {
    smash: qualifiedPlays.filter(p => p.grade === 'A+' || p.grade === 'A' || p.conviction >= 80),
    strong: qualifiedPlays.filter(p => (p.grade === 'B+' || p.conviction >= 70) && p.conviction < 80 && p.grade !== 'A+' && p.grade !== 'A'),
    lean: qualifiedPlays.filter(p => p.edge >= 5 && !['A+', 'A', 'B+'].includes(p.grade) && p.conviction < 70),
    speculative: qualifiedPlays.filter(p => p.edge >= minEdge && p.edge < 5 && !['A+', 'A', 'B+'].includes(p.grade) && p.conviction < 70),
  };
  
  // Category breakdown
  const byCat = {};
  for (const play of qualifiedPlays) {
    if (!byCat[play.category]) byCat[play.category] = [];
    byCat[play.category].push(play);
  }
  
  // Top plays per category
  const topByCategory = {};
  for (const [cat, plays] of Object.entries(byCat)) {
    topByCategory[cat] = plays
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 5)
      .map(p => ({
        pick: p.pick,
        game: p.game,
        edge: p.edge,
        type: p.type,
        grade: p.grade,
        source: p.source,
      }));
  }
  
  // Portfolio summary
  const gamePlays = qualifiedPlays.filter(p => p.category === 'game');
  const propPlays = qualifiedPlays.filter(p => p.category !== 'game' && p.category !== 'sgp');
  const totalGameWager = gamePlays.reduce((s, p) => s + p.wager, 0);
  const totalGameEV = gamePlays.reduce((s, p) => s + p.ev, 0);
  
  // Game rankings
  const gameRankings = Object.values(gameBreakdowns)
    .sort((a, b) => b.conviction - a.conviction || b.playCount - a.playCount)
    .map((g, i) => ({
      rank: i + 1,
      game: g.game,
      grade: g.grade,
      conviction: g.conviction,
      plays: g.playCount,
      pitchers: `${g.awayStarter} vs ${g.homeStarter}`,
      weather: g.weather,
      date: g.date,
    }));
  
  const buildTime = Date.now() - startTime;
  
  return {
    title: '🦞 MetaClaw Opening Day War Room',
    subtitle: 'ALL models. ALL props. ALL edges. ONE place.',
    generated: new Date().toISOString(),
    buildTimeMs: buildTime,
    openingDay: playbook.openingDay,
    daysUntil: playbook.daysUntil,
    bankroll,
    
    // HEADLINE NUMBERS
    summary: {
      totalPlays: qualifiedPlays.length,
      gameLevelPlays: gamePlays.length,
      propPlays: propPlays.length,
      sgpCount: sgpSection?.totalParlays || 0,
      totalGameWager: +totalGameWager.toFixed(0),
      totalGameEV: +totalGameEV.toFixed(2),
      expectedROI: totalGameWager > 0 ? +((totalGameEV / totalGameWager) * 100).toFixed(1) : 0,
      gamesWithEdge: Object.values(gameBreakdowns).filter(g => g.playCount > 0).length,
      totalGames: playbook.playbook.length,
      avgEdge: qualifiedPlays.length > 0 ? +(qualifiedPlays.reduce((s, p) => s + p.edge, 0) / qualifiedPlays.length).toFixed(1) : 0,
    },
    
    // TIERED PLAYS (decision framework)
    tiers: {
      smash: { label: '🔥 SMASH — Max Bet These', count: tiers.smash.length, plays: tiers.smash },
      strong: { label: '💪 STRONG — Full Unit', count: tiers.strong.length, plays: tiers.strong },
      lean: { label: '📊 LEAN — Half Unit', count: tiers.lean.length, plays: tiers.lean },
      speculative: { label: '🎲 SPECULATIVE — Quarter Unit', count: tiers.speculative.length, plays: tiers.speculative },
    },
    
    // TOP PLAYS BY CATEGORY
    topByCategory,
    
    // GAME-BY-GAME BREAKDOWN
    gameRankings,
    gameBreakdowns,
    
    // SGP SECTION
    sgps: sgpSection,
    
    // CATEGORY COUNTS
    categoryCounts: {
      game: (byCat.game || []).length,
      pitcher_prop: (byCat.pitcher_prop || []).length,
      batter_prop: (byCat.batter_prop || []).length,
      first_inning: (byCat.first_inning || []).length,
      sgp: sgpSection?.totalParlays || 0,
    },
    
    // EXECUTION PLAN (for game day)
    executionPlan: buildExecutionPlan(qualifiedPlays, gameRankings, sgpSection),
    
    // ALL PLAYS (for advanced filtering)
    allPlays: qualifiedPlays,
  };
}

/**
 * Build game-day execution plan with timing and priority
 */
function buildExecutionPlan(plays, gameRankings, sgps) {
  const steps = [];
  
  // Step 1: Pre-game (2 hours before first pitch)
  steps.push({
    phase: '🌅 PRE-GAME (T-2hrs)',
    tasks: [
      'Refresh live lineups — confirm all starters are in',
      'Check weather updates for outdoor parks',
      'Pull latest odds for line movement analysis',
      'Verify umpire assignments are posted',
      'Lock in SMASH and STRONG game-level plays',
    ],
  });
  
  // Step 2: Prop lock (1 hour before)
  const topKPlays = plays.filter(p => p.type === 'K_PROP').slice(0, 5);
  const topOutsPlays = plays.filter(p => p.type === 'OUTS_PROP').slice(0, 3);
  const topBatterPlays = plays.filter(p => ['BATTER_HIT', 'BATTER_HR', 'BATTER_TB'].includes(p.type)).slice(0, 5);
  const nrfiPlays = plays.filter(p => p.type === 'NRFI');
  
  steps.push({
    phase: '🎯 PROP LOCK (T-1hr)',
    tasks: [
      `Lock K prop OVERS: ${topKPlays.map(p => p.pick).join(', ') || 'None'}`,
      `Lock outs OVERS: ${topOutsPlays.map(p => p.pick).join(', ') || 'None'}`,
      `Lock batter props: ${topBatterPlays.map(p => p.pick).join(', ') || 'None'}`,
      `NRFI/YRFI: ${nrfiPlays.map(p => p.pick).join(', ') || 'None'}`,
    ],
  });
  
  // Step 3: SGP entry (30 min before)
  steps.push({
    phase: '🎰 SGP ENTRY (T-30min)',
    tasks: [
      `Top SGPs to build: ${sgps?.topParlays?.slice(0, 3).map(p => p.game).join(', ') || 'Check SGP tab'}`,
      'Build correlated parlays on DraftKings',
      'Verify all legs are available at expected lines',
    ],
  });
  
  // Step 4: First pitch monitoring
  steps.push({
    phase: '⚾ FIRST PITCH',
    tasks: [
      'Monitor NRFI results immediately',
      'Track 1st inning pitcher control (walks = K prop concern)',
      'Note any late scratches → adjust or void props',
    ],
  });
  
  // Step 5: Mid-game
  steps.push({
    phase: '📈 MID-GAME (Innings 3-6)',
    tasks: [
      'Track F5 positions — grade at end of 5th',
      'Monitor starter pitch counts for outs prop outcomes',
      'Check live K counts vs projections',
      'Cash out any SGPs that have hit early legs',
    ],
  });
  
  // Step 6: Late game
  steps.push({
    phase: '🏁 LATE GAME (Innings 7-9)',
    tasks: [
      'Grade all game-level plays (ML, totals, run lines)',
      'Record outcomes for CLV tracking',
      'Calculate P&L across all markets',
      'Update model calibration based on results',
    ],
  });
  
  return steps;
}

/**
 * Quick summary for dashboard hero section
 */
async function getWarRoomSummary() {
  const warRoom = await buildWarRoom({ bankroll: 1000 });
  if (warRoom.error) return warRoom;
  
  return {
    totalPlays: warRoom.summary.totalPlays,
    smashCount: warRoom.tiers.smash.count,
    strongCount: warRoom.tiers.strong.count,
    totalGameEV: warRoom.summary.totalGameEV,
    expectedROI: warRoom.summary.expectedROI,
    gamesWithEdge: warRoom.summary.gamesWithEdge,
    topPlay: warRoom.allPlays[0] || null,
    sgpCount: warRoom.summary.sgpCount,
    categoryCounts: warRoom.categoryCounts,
  };
}

module.exports = {
  buildWarRoom,
  getWarRoomSummary,
  buildGamePlays,
  PLAY_TYPES,
};
