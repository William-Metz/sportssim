// models/mlb.js — MLB Baseball Model v3.0
// Pythagorean win expectation, pitcher matchups, park factors, Poisson totals, value detection
// Enhanced with starting pitcher database integration + Opening Day preseason tuning
// v3.0: Spring training signals, roster change impact, OD pitcher premium, new-team penalty

const pitchers = require('./mlb-pitchers');

const PYTH_EXP = 1.83; // Baseball Pythagorean exponent

// Live data integration
let liveData = null;
try { liveData = require('../services/live-data'); } catch (e) { /* fallback to static */ }

// Rolling stats & injury integration
let rollingStats = null;
let injuryService = null;
let restTravel = null;
let monteCarlo = null;
let umpireService = null;
let statcastService = null;
let preseasonTuning = null;
try { rollingStats = require('../services/rolling-stats'); } catch (e) { /* no rolling stats */ }
try { injuryService = require('../services/injuries'); } catch (e) { /* no injury data */ }
try { restTravel = require('../services/rest-travel'); } catch (e) { /* no rest/travel */ }
try { monteCarlo = require('../services/monte-carlo'); } catch (e) { /* no monte carlo */ }
try { umpireService = require('../services/umpire-tendencies'); } catch (e) { /* no umpire data */ }
try { statcastService = require('../services/statcast'); } catch (e) { /* no statcast */ }
try { preseasonTuning = require('../services/preseason-tuning'); } catch (e) { /* no preseason tuning */ }
let lineupFetcher = null;
try { lineupFetcher = require('../services/lineup-fetcher'); } catch (e) { /* no lineup data */ }

// Negative Binomial model — upgrades Poisson for overdispersion in MLB scoring
let negBinomial = null;
try { negBinomial = require('../services/neg-binomial'); } catch (e) { /* fallback to Poisson */ }

/**
 * Get current team data — live if available, static fallback
 * For MLB: during regular season, merge live W/L/runs with static pitching/advanced stats
 * During preseason: use projected stats (static) as primary
 */
function getTeams() {
  if (liveData) {
    const live = liveData.getMLBData();
    if (live && Object.keys(live).length >= 25) {
      // Check if it's real regular season data (not spring training)
      const anyRealGames = Object.values(live).some(t => !t.isSpringTraining && t.gp > 10);
      
      if (anyRealGames) {
        // Regular season: merge live runs data with static pitching metrics
        const merged = {};
        for (const [abbr, staticTeam] of Object.entries(STATIC_TEAMS)) {
          const liveTeam = live[abbr];
          if (liveTeam && !liveTeam.isSpringTraining) {
            merged[abbr] = {
              ...staticTeam,
              w: liveTeam.w,
              l: liveTeam.l,
              rsG: liveTeam.rsG,
              raG: liveTeam.raG,
              l10: liveTeam.l10 || staticTeam.l10,
              _isLiveData: true
            };
          } else {
            merged[abbr] = staticTeam;
          }
        }
        return merged;
      }
    }
  }
  return STATIC_TEAMS;
}

async function refreshData() {
  if (liveData) {
    await liveData.refreshAll(true);
  }
}

// All 30 MLB teams — REAL 2025 final stats from ESPN
// This is the base data — roster change adjustments in preseason-tuning.js modify these
// for 2026 projections. The model applies early-season regression automatically.
// AUDITED 2026-03-22 against ESPN 2025 final standings
const STATIC_TEAMS = {
  // AL East — TOR won division (94W), NYY tied (94W), BOS WC (89W), TB/BAL below
  'NYY': { name: 'New York Yankees', league: 'AL', division: 'East', w: 94, l: 68, rsG: 5.24, raG: 4.23, ops: .765, era: 3.95, whip: 1.24, k9: 9.2, fip: 3.90, bullpenEra: 3.50, babip: .295, park: 'Yankee Stadium', l10: '5-5' },
  'BAL': { name: 'Baltimore Orioles', league: 'AL', division: 'East', w: 75, l: 87, rsG: 4.18, raG: 4.86, ops: .710, era: 4.60, whip: 1.33, k9: 8.5, fip: 4.50, bullpenEra: 4.10, babip: .290, park: 'Camden Yards', l10: '3-7' },
  'BOS': { name: 'Boston Red Sox', league: 'AL', division: 'East', w: 89, l: 73, rsG: 4.85, raG: 4.17, ops: .748, era: 3.90, whip: 1.23, k9: 9.0, fip: 3.85, bullpenEra: 3.55, babip: .292, park: 'Fenway Park', l10: '7-3' },
  'TOR': { name: 'Toronto Blue Jays', league: 'AL', division: 'East', w: 94, l: 68, rsG: 4.93, raG: 4.45, ops: .745, era: 4.15, whip: 1.26, k9: 8.8, fip: 4.10, bullpenEra: 3.70, babip: .290, park: 'Rogers Centre', l10: '5-5' },
  'TB':  { name: 'Tampa Bay Rays', league: 'AL', division: 'East', w: 77, l: 85, rsG: 4.41, raG: 4.22, ops: .718, era: 4.00, whip: 1.25, k9: 9.0, fip: 3.95, bullpenEra: 3.65, babip: .288, park: 'Tropicana Field', l10: '4-6' },
  // AL Central — CLE won div (88W), DET WC (87W), KC solid (82W), MIN/CWS bottom
  'CLE': { name: 'Cleveland Guardians', league: 'AL', division: 'Central', w: 88, l: 74, rsG: 3.97, raG: 4.01, ops: .710, era: 3.78, whip: 1.22, k9: 8.8, fip: 3.72, bullpenEra: 3.40, babip: .285, park: 'Progressive Field', l10: '7-3' },
  'KC':  { name: 'Kansas City Royals', league: 'AL', division: 'Central', w: 82, l: 80, rsG: 4.02, raG: 3.93, ops: .718, era: 3.85, whip: 1.25, k9: 8.3, fip: 3.80, bullpenEra: 3.60, babip: .293, park: 'Kauffman Stadium', l10: '6-4' },
  'DET': { name: 'Detroit Tigers', league: 'AL', division: 'Central', w: 87, l: 75, rsG: 4.68, raG: 4.27, ops: .728, era: 4.02, whip: 1.25, k9: 8.8, fip: 3.95, bullpenEra: 3.55, babip: .290, park: 'Comerica Park', l10: '2-8' },
  'MIN': { name: 'Minnesota Twins', league: 'AL', division: 'Central', w: 70, l: 92, rsG: 4.19, raG: 4.77, ops: .720, era: 4.50, whip: 1.34, k9: 8.2, fip: 4.40, bullpenEra: 4.05, babip: .294, park: 'Target Field', l10: '4-6' },
  'CWS': { name: 'Chicago White Sox', league: 'AL', division: 'Central', w: 60, l: 102, rsG: 3.99, raG: 4.58, ops: .695, era: 4.38, whip: 1.35, k9: 7.8, fip: 4.30, bullpenEra: 4.20, babip: .300, park: 'Guaranteed Rate Field', l10: '3-7' },
  // AL West — SEA won div (90W), HOU WC (87W), TEX .500, OAK/LAA rebuilding
  'HOU': { name: 'Houston Astros', league: 'AL', division: 'West', w: 87, l: 75, rsG: 4.23, raG: 4.10, ops: .730, era: 3.88, whip: 1.25, k9: 8.8, fip: 3.82, bullpenEra: 3.55, babip: .292, park: 'Minute Maid Park', l10: '4-6' },
  'SEA': { name: 'Seattle Mariners', league: 'AL', division: 'West', w: 90, l: 72, rsG: 4.73, raG: 4.28, ops: .730, era: 4.05, whip: 1.24, k9: 9.3, fip: 3.98, bullpenEra: 3.50, babip: .288, park: 'T-Mobile Park', l10: '3-7' },
  'TEX': { name: 'Texas Rangers', league: 'AL', division: 'West', w: 81, l: 81, rsG: 4.22, raG: 3.73, ops: .725, era: 3.60, whip: 1.22, k9: 8.5, fip: 3.55, bullpenEra: 3.45, babip: .290, park: 'Globe Life Field', l10: '2-8' },
  'LAA': { name: 'Los Angeles Angels', league: 'AL', division: 'West', w: 72, l: 90, rsG: 4.15, raG: 5.17, ops: .712, era: 4.90, whip: 1.38, k9: 8.2, fip: 4.80, bullpenEra: 4.30, babip: .295, park: 'Angel Stadium', l10: '3-7' },
  'OAK': { name: 'Oakland Athletics', league: 'AL', division: 'West', w: 76, l: 86, rsG: 4.53, raG: 5.04, ops: .718, era: 4.78, whip: 1.35, k9: 8.2, fip: 4.68, bullpenEra: 4.20, babip: .295, park: 'Coliseum', l10: '5-5' },
  // NL East — PHI won div (96W), NYM bubble (83W), MIA (79W), ATL down (76W), WSH tank (66W)
  'ATL': { name: 'Atlanta Braves', league: 'NL', division: 'East', w: 76, l: 86, rsG: 4.47, raG: 4.53, ops: .730, era: 4.28, whip: 1.28, k9: 8.8, fip: 4.18, bullpenEra: 3.85, babip: .291, park: 'Truist Park', l10: '7-3' },
  'PHI': { name: 'Philadelphia Phillies', league: 'NL', division: 'East', w: 96, l: 66, rsG: 4.80, raG: 4.00, ops: .755, era: 3.78, whip: 1.21, k9: 9.2, fip: 3.72, bullpenEra: 3.45, babip: .291, park: 'Citizens Bank Park', l10: '5-5' },
  'NYM': { name: 'New York Mets', league: 'NL', division: 'East', w: 83, l: 79, rsG: 4.73, raG: 4.41, ops: .738, era: 4.18, whip: 1.27, k9: 8.7, fip: 4.10, bullpenEra: 3.70, babip: .290, park: 'Citi Field', l10: '5-5' },
  'MIA': { name: 'Miami Marlins', league: 'NL', division: 'East', w: 79, l: 83, rsG: 4.38, raG: 4.93, ops: .715, era: 4.65, whip: 1.33, k9: 8.5, fip: 4.55, bullpenEra: 4.10, babip: .290, park: 'LoanDepot Park', l10: '7-3' },
  'WSH': { name: 'Washington Nationals', league: 'NL', division: 'East', w: 66, l: 96, rsG: 4.24, raG: 5.55, ops: .710, era: 5.22, whip: 1.42, k9: 8.2, fip: 5.10, bullpenEra: 4.60, babip: .298, park: 'Nationals Park', l10: '4-6' },
  // NL Central — MIL dominant (97W), CHC WC (92W), CIN bubble (83W), STL/PIT rebuilding
  'MIL': { name: 'Milwaukee Brewers', league: 'NL', division: 'Central', w: 97, l: 65, rsG: 4.98, raG: 3.91, ops: .745, era: 3.70, whip: 1.20, k9: 9.2, fip: 3.65, bullpenEra: 3.30, babip: .290, park: 'American Family Field', l10: '4-6' },
  'CHC': { name: 'Chicago Cubs', league: 'NL', division: 'Central', w: 92, l: 70, rsG: 4.90, raG: 4.01, ops: .745, era: 3.82, whip: 1.22, k9: 8.8, fip: 3.78, bullpenEra: 3.50, babip: .292, park: 'Wrigley Field', l10: '4-6' },
  'STL': { name: 'St. Louis Cardinals', league: 'NL', division: 'Central', w: 78, l: 84, rsG: 4.25, raG: 4.65, ops: .718, era: 4.40, whip: 1.30, k9: 8.3, fip: 4.30, bullpenEra: 3.95, babip: .291, park: 'Busch Stadium', l10: '4-6' },
  'PIT': { name: 'Pittsburgh Pirates', league: 'NL', division: 'Central', w: 71, l: 91, rsG: 3.60, raG: 3.98, ops: .695, era: 3.82, whip: 1.25, k9: 8.5, fip: 3.78, bullpenEra: 3.60, babip: .285, park: 'PNC Park', l10: '6-4' },
  'CIN': { name: 'Cincinnati Reds', league: 'NL', division: 'Central', w: 83, l: 79, rsG: 4.42, raG: 4.20, ops: .732, era: 4.00, whip: 1.26, k9: 8.8, fip: 3.95, bullpenEra: 3.70, babip: .295, park: 'Great American Ball Park', l10: '7-3' },
  // NL West — LAD won div (93W), SD WC (90W), SF .500 (81W), ARI down (80W), COL historic tank (43W)
  'LAD': { name: 'Los Angeles Dodgers', league: 'NL', division: 'West', w: 93, l: 69, rsG: 5.09, raG: 4.22, ops: .770, era: 3.95, whip: 1.22, k9: 9.5, fip: 3.88, bullpenEra: 3.40, babip: .292, park: 'Dodger Stadium', l10: '8-2' },
  'SD':  { name: 'San Diego Padres', league: 'NL', division: 'West', w: 90, l: 72, rsG: 4.33, raG: 3.83, ops: .732, era: 3.65, whip: 1.19, k9: 9.2, fip: 3.60, bullpenEra: 3.35, babip: .287, park: 'Petco Park', l10: '7-3' },
  'ARI': { name: 'Arizona Diamondbacks', league: 'NL', division: 'West', w: 80, l: 82, rsG: 4.88, raG: 4.85, ops: .740, era: 4.55, whip: 1.32, k9: 8.5, fip: 4.45, bullpenEra: 4.00, babip: .298, park: 'Chase Field', l10: '3-7' },
  'SF':  { name: 'San Francisco Giants', league: 'NL', division: 'West', w: 81, l: 81, rsG: 4.35, raG: 4.22, ops: .722, era: 4.00, whip: 1.25, k9: 8.5, fip: 3.95, bullpenEra: 3.70, babip: .287, park: 'Oracle Park', l10: '5-5' },
  'COL': { name: 'Colorado Rockies', league: 'NL', division: 'West', w: 43, l: 119, rsG: 3.69, raG: 6.30, ops: .680, era: 6.10, whip: 1.55, k9: 7.0, fip: 5.90, bullpenEra: 5.30, babip: .315, park: 'Coors Field', l10: '2-8' }
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

// Park factors — multiplier for runs scored (1.0 = neutral)
const PARK_FACTORS = {
  'Coors Field': 1.25, 'Great American Ball Park': 1.12, 'Fenway Park': 1.08,
  'Globe Life Field': 1.06, 'Citizens Bank Park': 1.05, 'Yankee Stadium': 1.05,
  'Wrigley Field': 1.04, 'Chase Field': 1.04, 'Camden Yards': 1.03,
  'Minute Maid Park': 1.02, 'Rogers Centre': 1.02, 'American Family Field': 1.01,
  'Guaranteed Rate Field': 1.01, 'Angel Stadium': 1.00, 'Target Field': 1.00,
  'Busch Stadium': 1.00, 'Nationals Park': 0.99, 'Kauffman Stadium': 0.99,
  'PNC Park': 0.98, 'Truist Park': 0.98, 'Comerica Park': 0.97,
  'Progressive Field': 0.97, 'Dodger Stadium': 0.97, 'Citi Field': 0.96,
  'LoanDepot Park': 0.95, 'T-Mobile Park': 0.95, 'Petco Park': 0.94,
  'Tropicana Field': 0.94, 'Oracle Park': 0.93, 'Coliseum': 0.96
};

// League average baselines
const LG_AVG = { rsG: 4.4, raG: 4.4, era: 4.10, whip: 1.28, k9: 8.6, fip: 4.05 };
const HOME_ADV = 0.540; // 54% historical home win rate in MLB

// ==================== EARLY SEASON REGRESSION ====================
// At the start of the season, preseason projections have higher uncertainty.
// We regress expected runs toward the league average based on how much
// real data we have. After ~40 games, the regression disappears.
// This prevents overconfident bets on Opening Day.
function getEarlySeasonRegression(teamData) {
  // Check if this is real regular season data vs preseason projections
  const gp = (teamData.w || 0) + (teamData.l || 0);
  
  // If the team has played a full 162-game season worth of projected data,
  // check if it's actually a projection by seeing if we're near Opening Day
  const isProjection = gp >= 130 && !teamData._isLiveData;
  
  if (isProjection) return 0.22; // 22% regression for preseason projections
  
  if (gp >= 40) return 0; // full confidence after 40 real games
  if (gp === 0) return 0.35; // truly no data: 35% regression
  // Linear ramp: 35% at 0 games → 0% at 40 games
  return Math.max(0, 0.35 * (1 - gp / 40));
}

// ==================== OPENING DAY CONFIDENCE ====================
// On Opening Day (and early season), predictions should have WIDER error bars.
// Teams haven't established patterns yet — preseason projections have known flaws:
// - Spring training lineups != Opening Day lineups
// - Roster moves, new acquisitions haven't been tested in real games
// - Bullpen roles not established
// - Hitter timing still not game-ready
// This function returns a confidence multiplier for edge calculations
function getPreseasonConfidence(awayTeam, homeTeam) {
  const awayGP = (awayTeam.w || 0) + (awayTeam.l || 0);
  const homeGP = (homeTeam.w || 0) + (homeTeam.l || 0);
  const isAPreseason = awayGP >= 130 && !awayTeam._isLiveData;
  const isHPreseason = homeGP >= 130 && !homeTeam._isLiveData;
  
  if (isAPreseason || isHPreseason) {
    // Opening Day / preseason: predictions are less reliable
    // Return a confidence factor (0-1) that should be used to shrink edges
    return 0.75; // 75% confidence — edges should be reduced by 25%
  }
  
  // Early season with some real data
  const minGP = Math.min(awayGP, homeGP);
  if (minGP < 20) return Math.min(1.0, 0.75 + minGP * 0.0125);
  return 1.0;
}

// ==================== PLATOON SPLITS ====================
// How much each team's offense drops when facing a same-side pitcher
// LHP penalty: multiplier applied to team offense when facing LHP (< 1.0 = worse)
// RHP penalty: multiplier applied when facing RHP (usually ~1.0)
// Teams with more LHH hitters struggle more vs LHP
// Based on 2024 splits data: avg MLB team OPS drops ~30 points vs same-side
const PLATOON_SPLITS = {
  // LHH-heavy lineups (bigger penalty vs LHP)
  'NYY': { vsLHP: 0.92, vsRHP: 1.02 }, // Judge, Soto, Volpe are RHH, but depth is LHH
  'BAL': { vsLHP: 0.95, vsRHP: 1.01 },
  'BOS': { vsLHP: 0.94, vsRHP: 1.01 },
  'TOR': { vsLHP: 0.93, vsRHP: 1.02 },
  'TB':  { vsLHP: 0.96, vsRHP: 1.00 },
  'CLE': { vsLHP: 0.95, vsRHP: 1.01 },
  'KC':  { vsLHP: 0.94, vsRHP: 1.01 },
  'DET': { vsLHP: 0.95, vsRHP: 1.01 },
  'MIN': { vsLHP: 0.93, vsRHP: 1.02 },
  'CWS': { vsLHP: 0.94, vsRHP: 1.01 },
  'HOU': { vsLHP: 0.95, vsRHP: 1.01 }, // Alvarez is LHH
  'SEA': { vsLHP: 0.93, vsRHP: 1.02 }, // Julio is switch but lefty-dominant lineup
  'TEX': { vsLHP: 0.94, vsRHP: 1.01 },
  'LAA': { vsLHP: 0.96, vsRHP: 1.00 },
  'OAK': { vsLHP: 0.95, vsRHP: 1.01 },
  'ATL': { vsLHP: 0.94, vsRHP: 1.02 }, // Olson, Freeman-era but still LHH-heavy
  'PHI': { vsLHP: 0.93, vsRHP: 1.02 }, // Harper, Turner, Bohm mix
  'NYM': { vsLHP: 0.94, vsRHP: 1.01 }, // Soto/Alonso are RHH
  'MIA': { vsLHP: 0.95, vsRHP: 1.01 },
  'WSH': { vsLHP: 0.95, vsRHP: 1.01 },
  'MIL': { vsLHP: 0.94, vsRHP: 1.01 },
  'CHC': { vsLHP: 0.93, vsRHP: 1.02 }, // Bellinger, Happ, Suzuki switch
  'STL': { vsLHP: 0.94, vsRHP: 1.01 },
  'PIT': { vsLHP: 0.95, vsRHP: 1.01 },
  'CIN': { vsLHP: 0.94, vsRHP: 1.01 },
  'LAD': { vsLHP: 0.91, vsRHP: 1.03 }, // Freeman, Ohtani, Betts — VERY lefty-heavy
  'SD':  { vsLHP: 0.94, vsRHP: 1.01 },
  'ARI': { vsLHP: 0.95, vsRHP: 1.01 },
  'SF':  { vsLHP: 0.94, vsRHP: 1.01 },
  'COL': { vsLHP: 0.95, vsRHP: 1.01 },
};

// ==================== CORE MODEL ====================

function pythWinPct(rsG, raG) {
  const rs = Math.pow(rsG, PYTH_EXP);
  const ra = Math.pow(raG, PYTH_EXP);
  return rs / (rs + ra);
}

function calculateRatings() {
  const ratings = {};
  for (const [abbr, t] of Object.entries(TEAMS)) {
    const actualWpct = t.w / (t.w + t.l);
    const pythWpct = pythWinPct(t.rsG, t.raG);
    const luck = actualWpct - pythWpct;
    const runDiff = t.rsG - t.raG;
    
    const parkFactor = PARK_FACTORS[t.park] || 1.0;
    const neutralRsG = t.rsG / parkFactor;
    const neutralRaG = t.raG / (2 - parkFactor);
    const neutralRunDiff = neutralRsG - neutralRaG;
    
    const pitchScore = (LG_AVG.era - t.era) * 0.4 + (LG_AVG.fip - t.fip) * 0.35 + 
                       (LG_AVG.whip - t.whip) * 5 * 0.15 + (t.k9 - LG_AVG.k9) * 0.1;
    const offScore = (t.rsG - LG_AVG.rsG) * 0.5 + (t.ops - 0.730) * 10 * 0.5;
    const bullpenScore = (LG_AVG.era - t.bullpenEra) * 0.5;
    
    const power = neutralRunDiff * 10 + pitchScore * 3 + offScore * 2 + bullpenScore * 2 - luck * 8;
    
    const l10parts = t.l10.split('-');
    const l10wpct = parseInt(l10parts[0]) / 10;
    const momentum = l10wpct - 0.5;

    // Get rotation info
    const rotation = pitchers.getTeamRotation(abbr);
    const rotationRating = rotation ? +(rotation.reduce((s, p) => s + p.rating, 0) / rotation.length).toFixed(1) : null;
    const ace = rotation ? rotation[0] : null;
    
    ratings[abbr] = {
      abbr, name: t.name, league: t.league, division: t.division,
      w: t.w, l: t.l, actualWpct: +(actualWpct.toFixed(3)),
      pythWpct: +(pythWpct.toFixed(3)), luck: +(luck.toFixed(3)),
      rsG: t.rsG, raG: t.raG, runDiff: +(runDiff.toFixed(1)),
      era: t.era, fip: t.fip, whip: t.whip, k9: t.k9,
      ops: t.ops, bullpenEra: t.bullpenEra,
      park: t.park, parkFactor: PARK_FACTORS[t.park] || 1.0,
      pitchScore: +(pitchScore.toFixed(2)), offScore: +(offScore.toFixed(2)),
      bullpenScore: +(bullpenScore.toFixed(2)),
      power: +(power.toFixed(1)), momentum: +(momentum.toFixed(2)),
      l10: t.l10,
      rotationRating,
      aceName: ace ? ace.name : null,
      aceRating: ace ? ace.rating : null
    };
  }
  return ratings;
}

// ==================== PITCHER-ENHANCED PREDICTION ====================

// Resolve pitcher — accepts name string or raw {era, fip, whip} object
function resolvePitcher(pitcherInput, teamAbbr) {
  if (!pitcherInput) return null;
  
  // If it's a string name, look up in DB
  if (typeof pitcherInput === 'string') {
    // Try exact lookup first (using improved getPitcherByName)
    let p = pitchers.getPitcherByName(pitcherInput);
    if (p) return p;
    
    // Try team-specific search with stricter matching
    const rotation = pitchers.getTeamRotation(teamAbbr);
    if (rotation) {
      const lower = pitcherInput.toLowerCase().trim();
      for (const rp of rotation) {
        const rpLower = rp.name.toLowerCase();
        // Exact full name
        if (rpLower === lower) return { ...rp };
        // Exact last name match (full last name must match)
        const rpLastName = rpLower.split(' ').pop();
        const inputLastName = lower.split(' ').pop();
        if (rpLastName === inputLastName && rpLastName.length >= 4) return { ...rp };
      }
    }
    return null;
  }
  
  // If it's an object with raw stats
  if (typeof pitcherInput === 'object') return pitcherInput;
  return null;
}

// Calculate pitcher's raw expected RA/9 (NEUTRAL — no offense or park adjustments)
// Offense and park adjustments are applied ONCE in predict() to avoid double-counting
// If Statcast data is available, blend xERA for more predictive power
function pitcherExpectedRA(pitcher, opposingTeam, parkFactor) {
  if (!pitcher) return null;
  
  const pFip = pitcher.fip || pitcher.era || LG_AVG.fip;
  const pEra = pitcher.era || pitcher.fip || LG_AVG.era;
  const pXfip = pitcher.xfip || pFip;
  
  // Base predictive RA: weight FIP/xFIP more than ERA (more predictive)
  let pitcherRA = pFip * 0.35 + pXfip * 0.35 + pEra * 0.30;
  
  // Small sample size regression: pitchers with < 150 IP should regress toward league avg
  // This catches breakout pitchers on small samples (e.g., 1.81 ERA in 110 IP)
  // and prevents overconfidence on guys with extreme results in limited innings
  const ip = pitcher.ip || 150; // default to full workload if unknown
  if (ip < 150) {
    const regressionFactor = Math.max(0, (150 - ip) / 150) * 0.25; // max 25% regression at 0 IP
    pitcherRA = pitcherRA * (1 - regressionFactor) + LG_AVG.fip * regressionFactor;
  }
  
  // Statcast enhancement: if we have xERA data, blend it in
  // xERA is based on exit velocity, launch angle, and barrel rate — 
  // more predictive than ERA or even FIP for future performance
  if (statcastService && pitcher.name) {
    const scData = statcastService.getStatcastPitcherAdjustment(pitcher.name);
    if (scData && scData.xera > 0 && scData.confidence !== 'LOW') {
      // Blend xERA into pitcherRA calculation (20% weight — supplemental signal)
      // Don't over-weight since FIP/xFIP already capture skill
      const xeraWeight = scData.confidence === 'HIGH' ? 0.20 : 0.12;
      pitcherRA = pitcherRA * (1 - xeraWeight) + scData.xera * xeraWeight;
    }
  }
  
  return pitcherRA;
}

// Pitcher adjustment: blend starter contribution with bullpen
function pitcherAdjustment(teamRaG, teamBullpenEra, pitcher, opposingTeam, parkFactor) {
  if (!pitcher) return teamRaG;
  
  const pitcherRA = pitcherExpectedRA(pitcher, opposingTeam, parkFactor) || teamRaG;
  
  // Starter covers ~5.5 innings, bullpen covers ~3.5
  const starterFraction = 5.5 / 9;
  const bullpenFraction = 3.5 / 9;
  
  const starterContrib = (pitcherRA / 9) * 5.5;
  const bullpenContrib = ((teamBullpenEra || teamRaG) / 9) * 3.5;
  
  return starterContrib + bullpenContrib;
}

function predict(awayAbbr, homeAbbr, opts = {}) {
  const away = TEAMS[awayAbbr];
  const home = TEAMS[homeAbbr];
  if (!away) return { error: `Unknown team: ${awayAbbr}` };
  if (!home) return { error: `Unknown team: ${homeAbbr}` };
  
  const ratings = calculateRatings();
  const awayR = ratings[awayAbbr];
  const homeR = ratings[homeAbbr];
  
  const pf = PARK_FACTORS[home.park] || 1.0;
  
  // Resolve pitchers
  const awayPitcher = resolvePitcher(opts.awayPitcher, awayAbbr) || 
    (opts.awayPitcherEra || opts.awayPitcherFip ? { era: opts.awayPitcherEra, fip: opts.awayPitcherFip, xfip: opts.awayPitcherFip, whip: opts.awayPitcherWhip } : null);
  const homePitcher = resolvePitcher(opts.homePitcher, homeAbbr) ||
    (opts.homePitcherEra || opts.homePitcherFip ? { era: opts.homePitcherEra, fip: opts.homePitcherFip, xfip: opts.homePitcherFip, whip: opts.homePitcherWhip } : null);
  
  // Calculate expected runs
  // On Opening Day / preseason, starters go deeper (~5.8 IP vs 5.5 regular season)
  const isPreseasonPredict = getEarlySeasonRegression(away) > 0 || getEarlySeasonRegression(home) > 0;
  const starterIP = (isPreseasonPredict && preseasonTuning) ? preseasonTuning.getOpeningDayStarterFraction(true) * 9 : 5.5;
  const bullpenIP = 9 - starterIP;
  let awayRaG, homeRaG;
  
  if (homePitcher) {
    // Home pitcher faces away offense — how many runs does the away team score?
    // pitcherExpectedRA returns NEUTRAL pitcher RA/9 (no offense/park adjustments)
    const homePitcherRA = pitcherExpectedRA(homePitcher, away, pf);
    // Blend: starter covers starterIP innings, bullpen covers bullpenIP
    const starterRuns = (homePitcherRA / 9) * starterIP;
    const bullpenRuns = (home.bullpenEra / 9) * bullpenIP;
    const blendedRaG = starterRuns + bullpenRuns;
    // Apply offense quality modifier ONCE and park factor ONCE
    const offMod = away.rsG / LG_AVG.rsG;
    awayRaG = blendedRaG * offMod * pf;
  } else {
    awayRaG = away.rsG * (home.raG / LG_AVG.raG) * pf;
  }
  
  if (awayPitcher) {
    const awayPitcherRA = pitcherExpectedRA(awayPitcher, home, pf);
    const starterRuns = (awayPitcherRA / 9) * starterIP;
    const bullpenRuns = (away.bullpenEra / 9) * bullpenIP;
    const blendedRaG = starterRuns + bullpenRuns;
    const offMod = home.rsG / LG_AVG.rsG;
    homeRaG = blendedRaG * offMod * pf;
  } else {
    homeRaG = home.rsG * (away.raG / LG_AVG.raG) * pf;
  }

  // ==================== EARLY SEASON REGRESSION ====================
  // Regress expected runs toward league average based on sample size
  const awayRegression = getEarlySeasonRegression(away);
  const homeRegression = getEarlySeasonRegression(home);
  if (awayRegression > 0) {
    awayRaG = awayRaG * (1 - awayRegression) + LG_AVG.rsG * awayRegression;
  }
  if (homeRegression > 0) {
    homeRaG = homeRaG * (1 - homeRegression) + LG_AVG.rsG * homeRegression;
  }

  // ==================== PLATOON SPLIT ADJUSTMENT ====================
  // Pitcher handedness significantly affects opposing team offense
  // LHP face teams that may be LHH-heavy (same-side = harder to hit)
  let awayPlatoonAdj = 1.0, homePlatoonAdj = 1.0;
  let awayPlatoonInfo = null, homePlatoonInfo = null;
  
  if (homePitcher && homePitcher.hand) {
    const awaySplits = PLATOON_SPLITS[awayAbbr];
    if (awaySplits) {
      awayPlatoonAdj = homePitcher.hand === 'L' ? awaySplits.vsLHP : awaySplits.vsRHP;
      awayPlatoonInfo = {
        pitcherHand: homePitcher.hand,
        adjustment: +((awayPlatoonAdj - 1) * 100).toFixed(1),
        note: homePitcher.hand === 'L' 
          ? `${awayAbbr} offense ${awaySplits.vsLHP < 0.95 ? 'struggles' : 'slightly weaker'} vs LHP`
          : `${awayAbbr} offense vs RHP (normal)`
      };
    }
  }
  
  if (awayPitcher && awayPitcher.hand) {
    const homeSplits = PLATOON_SPLITS[homeAbbr];
    if (homeSplits) {
      homePlatoonAdj = awayPitcher.hand === 'L' ? homeSplits.vsLHP : homeSplits.vsRHP;
      homePlatoonInfo = {
        pitcherHand: awayPitcher.hand,
        adjustment: +((homePlatoonAdj - 1) * 100).toFixed(1),
        note: awayPitcher.hand === 'L'
          ? `${homeAbbr} offense ${homeSplits.vsLHP < 0.95 ? 'struggles' : 'slightly weaker'} vs LHP`
          : `${homeAbbr} offense vs RHP (normal)`
      };
    }
  }
  
  // Apply platoon adjustments to expected runs
  awayRaG *= awayPlatoonAdj;
  homeRaG *= homePlatoonAdj;

  // ==================== ROLLING STATS ADJUSTMENT ====================
  // Recent form (L10) modifies expected run production
  let awayRollingAdj = 0, homeRollingAdj = 0;
  let awayRolling = null, homeRolling = null;
  if (rollingStats) {
    awayRolling = rollingStats.getRollingAdjustment('mlb', awayAbbr);
    homeRolling = rollingStats.getRollingAdjustment('mlb', homeAbbr);
    // Rolling adj is in runs — positive = team is hot (scoring more / allowing less)
    // Apply to expected runs: hot team scores more, cold team scores less
    awayRollingAdj = awayRolling.adjFactor || 0;
    homeRollingAdj = homeRolling.adjFactor || 0;
  }

  // ==================== INJURY ADJUSTMENT ====================
  // Star players out = fewer runs scored / more runs allowed
  let awayInjuryAdj = 0, homeInjuryAdj = 0;
  let awayInjuries = null, homeInjuries = null;
  if (injuryService) {
    awayInjuries = injuryService.getInjuryAdjustment('mlb', awayAbbr);
    homeInjuries = injuryService.getInjuryAdjustment('mlb', homeAbbr);
    // Injury adj is negative (penalty) — star hitters out = fewer runs, star pitchers out = more runs allowed
    awayInjuryAdj = awayInjuries.adjFactor || 0;
    homeInjuryAdj = homeInjuries.adjFactor || 0;
  }

  // Scale rolling + injury adjustments based on data quality
  // During preseason/spring training, rolling stats are noise (rest starters, use minor leaguers)
  // and injury reports are mixed with "resting" vs real injuries
  const isPreseason = awayRegression > 0 || homeRegression > 0;
  const rollingWeight = isPreseason ? 0.05 : 0.3; // almost zero for preseason, full for regular season
  const injuryWeight = isPreseason ? 0.25 : 0.5;  // reduced for preseason
  
  // Apply rolling + injury adjustments to expected runs
  awayRaG += awayRollingAdj * rollingWeight + awayInjuryAdj * injuryWeight;
  homeRaG += homeRollingAdj * rollingWeight + homeInjuryAdj * injuryWeight;

  // ==================== WEATHER ADJUSTMENT ====================
  // Weather impacts run scoring at outdoor parks
  let weatherData = null;
  if (opts.weather) {
    // Direct weather impact passed in
    weatherData = opts.weather;
  } else {
    // Try to load weather service
    try {
      const weatherService = require('../services/weather');
      const park = weatherService.BALLPARK_COORDS[homeAbbr];
      if (park) {
        // Use cached weather if available, don't make async call in sync predict()
        weatherData = { multiplier: 1.0, factors: [], description: 'N/A' };
        if (park.dome) {
          weatherData.description = 'Dome stadium';
        }
      }
    } catch (e) { /* no weather service */ }
  }
  if (weatherData && weatherData.multiplier && weatherData.multiplier !== 1.0) {
    awayRaG *= weatherData.multiplier;
    homeRaG *= weatherData.multiplier;
  }

  // ==================== UMPIRE TENDENCY ADJUSTMENT ====================
  // Home plate umpire strike zone affects run totals by 0.3-0.5 runs
  let umpireData = null;
  if (opts.umpire && typeof opts.umpire === 'string') {
    // Umpire name passed directly
    if (umpireService) {
      const ump = umpireService.getUmpire(opts.umpire);
      if (ump) {
        umpireData = umpireService.calcTotalRunsMultiplier(ump);
        umpireData.name = ump.name;
        umpireData.zone = ump.zone;
      }
    }
  } else if (opts.umpire && typeof opts.umpire === 'object') {
    // Pre-computed umpire adjustment object
    umpireData = opts.umpire;
  }
  if (umpireData && umpireData.multiplier && umpireData.multiplier !== 1.0) {
    awayRaG *= umpireData.multiplier;
    homeRaG *= umpireData.multiplier;
  }

  // ==================== STATCAST ADJUSTMENT ====================
  // Baseball Savant xERA/xwOBA data — the single most predictive adjustment available.
  // xERA tells us a pitcher's TRUE quality independent of BABIP/sequencing luck.
  // Team xwOBA tells us the TRUE offensive quality independent of BA luck.
  let awayStatcastAdj = 0, homeStatcastAdj = 0;
  let awayStatcastPitcher = null, homeStatcastPitcher = null;
  let awayStatcastBatting = null, homeStatcastBatting = null;
  
  if (statcastService) {
    // Pitcher Statcast regression — adjust for xERA vs ERA gap
    if (homePitcher && homePitcher.name) {
      homeStatcastPitcher = statcastService.getStatcastPitcherAdjustment(homePitcher.name);
      if (homeStatcastPitcher && homeStatcastPitcher.runAdjustment !== 0) {
        // Positive runAdj = pitcher worse than ERA (away team scores MORE)
        // Scale by 0.5 to avoid over-adjusting (Statcast is one signal among many)
        awayStatcastAdj += homeStatcastPitcher.runAdjustment * 0.5;
      }
    }
    if (awayPitcher && awayPitcher.name) {
      awayStatcastPitcher = statcastService.getStatcastPitcherAdjustment(awayPitcher.name);
      if (awayStatcastPitcher && awayStatcastPitcher.runAdjustment !== 0) {
        homeStatcastAdj += awayStatcastPitcher.runAdjustment * 0.5;
      }
    }
    
    // Team batting Statcast edge — xwOBA tells us true offensive quality
    awayStatcastBatting = statcastService.getTeamBattingStatcast(awayAbbr);
    homeStatcastBatting = statcastService.getTeamBattingStatcast(homeAbbr);
    
    if (awayStatcastBatting && awayStatcastBatting.xwobaEdge !== 0) {
      // Positive xwOBA edge = team is BETTER than surface stats (more runs expected)
      awayStatcastAdj += awayStatcastBatting.xwobaEdge * 25; // ~25 runs per 0.010 xwOBA per game
    }
    if (homeStatcastBatting && homeStatcastBatting.xwobaEdge !== 0) {
      homeStatcastAdj += homeStatcastBatting.xwobaEdge * 25;
    }
    
    // Apply Statcast adjustments (capped at ±0.75 runs to prevent over-leverage)
    awayStatcastAdj = Math.max(-0.75, Math.min(0.75, awayStatcastAdj));
    homeStatcastAdj = Math.max(-0.75, Math.min(0.75, homeStatcastAdj));
    awayRaG += awayStatcastAdj;
    homeRaG += homeStatcastAdj;
  }

  // ==================== REST/TRAVEL ADJUSTMENT ====================
  // Applied synchronously from pre-fetched opts.restTravel data
  let awayRestAdj = 0, homeRestAdj = 0;
  let awayRestData = null, homeRestData = null;
  let awayBullpenFatigue = null, homeBullpenFatigue = null;
  
  if (opts.restTravel) {
    awayRestData = opts.restTravel.away?.rest;
    homeRestData = opts.restTravel.home?.rest;
    awayBullpenFatigue = opts.restTravel.away?.bullpenFatigue;
    homeBullpenFatigue = opts.restTravel.home?.bullpenFatigue;
    
    // Rest/travel adjusts run scoring for each team
    awayRestAdj = awayRestData?.adjFactor || 0;
    homeRestAdj = homeRestData?.adjFactor || 0;
    
    // Away team rest affects THEIR run scoring
    awayRaG += awayRestAdj * 0.4;  // positive = rested = more runs, negative = tired = fewer
    homeRaG += homeRestAdj * 0.4;
    
    // Bullpen fatigue affects opponent's late-inning scoring
    if (awayBullpenFatigue && awayBullpenFatigue.multiplier !== 1.0) {
      // Away pitcher bullpen tired → home team scores more
      homeRaG *= (1 + (awayBullpenFatigue.multiplier - 1) * 0.35); // partial effect (bullpen only covers ~3.5 innings)
    }
    if (homeBullpenFatigue && homeBullpenFatigue.multiplier !== 1.0) {
      // Home pitcher bullpen tired → away team scores more
      awayRaG *= (1 + (homeBullpenFatigue.multiplier - 1) * 0.35);
    }
  }

  // ==================== PRESEASON TUNING ADJUSTMENTS ====================
  // Spring training signals, roster changes, new-team pitcher penalties, OD factors
  let awayPreseasonInfo = null, homePreseasonInfo = null;
  if (preseasonTuning && isPreseason) {
    // Get Opening Day adjustments for both teams
    const awayODA = preseasonTuning.getOpeningDayAdjustments(awayAbbr, false);
    const homeODA = preseasonTuning.getOpeningDayAdjustments(homeAbbr, true);
    
    // Apply roster change + spring training adjustments to expected runs
    // awayRaG = runs the away team is expected to score
    // awayODA.offAdj = offensive boost for away team (positive = more runs)
    // awayODA.defAdj = defensive degradation for away team (positive = allows more runs, affects opponent)
    awayRaG += awayODA.offAdj; // Away team scores more/less based on roster+spring offense
    homeRaG += homeODA.offAdj; // Home team scores more/less
    
    // Defensive adjustments affect the OTHER team's scoring
    awayRaG += homeODA.defAdj; // If home team pitching got worse (positive defAdj), away scores more
    homeRaG += awayODA.defAdj; // If away team pitching got worse, home scores more
    
    // Chemistry adjustment (very small)
    awayRaG += awayODA.chemAdj;
    homeRaG += homeODA.chemAdj;
    
    // New-team pitcher penalty: pitchers on new teams perform ~5-8% worse
    // This worsens the pitcher's effective RA, meaning opponent scores more
    if (awayPitcher && awayPitcher.name) {
      const awayNewTeamPenalty = preseasonTuning.getNewTeamPenalty(awayPitcher.name);
      if (awayNewTeamPenalty > 0) {
        // Away pitcher is on a new team → home team scores more
        homeRaG *= (1 + awayNewTeamPenalty);
      }
    }
    if (homePitcher && homePitcher.name) {
      const homeNewTeamPenalty = preseasonTuning.getNewTeamPenalty(homePitcher.name);
      if (homeNewTeamPenalty > 0) {
        // Home pitcher is on a new team → away team scores more
        awayRaG *= (1 + homeNewTeamPenalty);
      }
    }
    
    // Store info for response
    awayPreseasonInfo = {
      springSignal: awayODA.info.springSignal ? {
        offense: awayODA.info.springSignal.offense,
        pitching: awayODA.info.springSignal.pitching,
        note: awayODA.info.springSignal.note,
      } : null,
      rosterChanges: awayODA.info.rosterChanges,
      moves: awayODA.info.moves,
      offAdj: awayODA.offAdj,
      defAdj: awayODA.defAdj,
      newTeamPitcher: (awayPitcher && awayPitcher.name) ? preseasonTuning.getNewTeamPenalty(awayPitcher.name) : 0,
    };
    homePreseasonInfo = {
      springSignal: homeODA.info.springSignal ? {
        offense: homeODA.info.springSignal.offense,
        pitching: homeODA.info.springSignal.pitching,
        note: homeODA.info.springSignal.note,
      } : null,
      rosterChanges: homeODA.info.rosterChanges,
      moves: homeODA.info.moves,
      offAdj: homeODA.offAdj,
      defAdj: homeODA.defAdj,
      newTeamPitcher: (homePitcher && homePitcher.name) ? preseasonTuning.getNewTeamPenalty(homePitcher.name) : 0,
    };
  }

  // ==================== LINEUP ADJUSTMENT ====================
  // Confirmed lineups tell us: star hitters in/out, platoon matchups, catcher framing
  // This runs SYNCHRONOUSLY from pre-fetched opts.lineup data (fetched in asyncPredict)
  let awayLineupAdj = 0, homeLineupAdj = 0;
  let lineupInfo = null;
  if (opts.lineup && opts.lineup.hasData) {
    // Direct run adjustments from lineup analysis
    awayLineupAdj = opts.lineup.awayRunAdj || 0;
    homeLineupAdj = opts.lineup.homeRunAdj || 0;
    
    // Cap at ±0.5 runs (lineup is one signal among many)
    awayLineupAdj = Math.max(-0.5, Math.min(0.5, awayLineupAdj));
    homeLineupAdj = Math.max(-0.5, Math.min(0.5, homeLineupAdj));
    
    awayRaG += awayLineupAdj;
    homeRaG += homeLineupAdj;
    
    lineupInfo = {
      awayAdj: +awayLineupAdj.toFixed(3),
      homeAdj: +homeLineupAdj.toFixed(3),
      awayStars: opts.lineup.details?.awayStars || 0,
      homeStars: opts.lineup.details?.homeStars || 0,
      awayCatcher: opts.lineup.details?.awayCatcher || null,
      homeCatcher: opts.lineup.details?.homeCatcher || null,
    };
  }

  // Ensure sane bounds — CALIBRATION v3: tighter cap reflecting MLB variance
  // Audit: even the most extreme matchups (LAD@OAK, ATL@CWS) only win ~72% at best
  awayRaG = Math.max(1.5, Math.min(10, awayRaG));
  homeRaG = Math.max(1.5, Math.min(10, homeRaG));

  const awayExpRuns = awayRaG;
  const homeExpRuns = homeRaG;
  
  // F5 (first 5 innings) — pitcher dominates this portion
  let f5Factor = 0.565;
  // If we have specific pitcher data, F5 is more pitcher-dependent
  if (homePitcher && awayPitcher) {
    // Better pitchers suppress runs more in F5 since they're still in the game
    const avgPitcherFip = (homePitcher.fip + awayPitcher.fip) / 2;
    const fipAdj = (LG_AVG.fip - avgPitcherFip) / LG_AVG.fip;
    f5Factor = 0.565 - fipAdj * 0.03; // ace matchups = lower F5 total
  }
  const awayExpF5 = awayExpRuns * f5Factor;
  const homeExpF5 = homeExpRuns * f5Factor;
  
  // Win probability: Negative Binomial when available (handles overdispersion),
  // fallback to Poisson. NB better captures variance in extreme matchups.
  // Build game context for NB overdispersion parameter
  const nbOpts = {
    park: home.park,
    homeBullpenEra: home.bullpenEra,
    awayBullpenEra: away.bullpenEra,
    isPreseason: isPreseasonPredict,
    weatherMultiplier: (weatherData && weatherData.multiplier) ? weatherData.multiplier : 1.0,
    awayPitcherRating: awayPitcher ? (awayPitcher.rating || 50) : 50,
    homePitcherRating: homePitcher ? (homePitcher.rating || 50) : 50,
  };
  
  let baseWinProbs;
  let gameR = null;
  if (negBinomial) {
    gameR = negBinomial.getGameR(nbOpts);
    baseWinProbs = negBinomial.negBinWinProb(awayExpRuns, homeExpRuns, gameR);
  } else {
    baseWinProbs = poissonWinProb(awayExpRuns, homeExpRuns);
  }
  
  // Apply home advantage as a probability shift
  // In MLB, home teams win ~54% overall. Our expected runs already include park factors,
  // so home advantage here is just the residual (batting last, familiarity, etc.)
  // CALIBRATION v4: Early-season data shows home win rate drops to ~49.2% in first 2 weeks
  // (2024 data: 128 games, 49.2% HWR vs 52.5% full season). This is because:
  // - Less crowd advantage (everyone's excited, neutral fans attend)
  // - Less familiarity advantage (haven't been home much yet)
  // - Small sample = more random outcomes
  // Scale HCA based on season phase: 0.5% early → 1.8% full season
  const BASE_HCA_SHIFT = 0.018; // ~1.8% home advantage beyond park factors (full season)
  const EARLY_HCA_SHIFT = 0.005; // ~0.5% early season (barely any home edge)
  const isEarlySeason = isPreseasonPredict || awayRegression > 0 || homeRegression > 0;
  const HCA_SHIFT = isEarlySeason ? EARLY_HCA_SHIFT : BASE_HCA_SHIFT;
  
  // CALIBRATION v4: Tighter probability cap for early season.
  // Full season: 0.68 max (audit of 2375 2024 games shows overconfidence at extremes)
  // Early season: 0.64 max (higher variance, less established patterns, preseason projections noisy)
  const MAX_WIN_PROB = isEarlySeason ? 0.64 : 0.68;
  const MIN_WIN_PROB = isEarlySeason ? 0.36 : 0.32;
  let homeWinProb = Math.min(MAX_WIN_PROB, Math.max(MIN_WIN_PROB, baseWinProbs.home + HCA_SHIFT));
  let awayWinProb = 1 - homeWinProb;
  
  // Pitcher quality differential bonus
  // NOTE: Expected runs already incorporate pitcher quality through ERA/FIP adjustments.
  // This additional bonus is for SMALL factors not captured by run expectancy:
  // - Strikeout pitchers suppress variance (fewer baserunners = fewer big innings)
  // - Elite pitchers go deeper into games (less bullpen exposure)
  // On Opening Day, pitcher quality matters MORE because bullpens are equal
  // and the starter drives the game outcome more than usual.
  if (awayPitcher && homePitcher) {
    const awayPRating = awayPitcher.rating || 50;
    const homePRating = homePitcher.rating || 50;
    const ratingDiff = (homePRating - awayPRating) / 100;
    // During preseason, starting pitcher carries more weight
    // Regular season: 0.05 per 100 rating diff, Preseason: 0.08
    const isPreseasonGame = (awayRegression > 0 || homeRegression > 0);
    const pitcherWeight = isPreseasonGame ? 0.08 : 0.05;
    homeWinProb = Math.min(MAX_WIN_PROB, Math.max(MIN_WIN_PROB, homeWinProb + ratingDiff * pitcherWeight));
    awayWinProb = 1 - homeWinProb;
  }
  
  // Momentum nudge (small) — enhanced with rolling stats
  // Suppress momentum in early season (no real data to derive it from)
  const momWeight = isEarlySeason ? 0.005 : 0.02;
  let momAdj = (homeR.momentum - awayR.momentum) * momWeight;
  // If rolling stats are available, also factor in recent trend
  if (awayRolling && homeRolling) {
    const rollingMomWeight = isEarlySeason ? 0.003 : 0.01;
    const rollingMom = ((homeRolling.momentum || 0) - (awayRolling.momentum || 0)) * rollingMomWeight;
    momAdj += rollingMom;
  }
  homeWinProb = Math.min(MAX_WIN_PROB, Math.max(MIN_WIN_PROB, homeWinProb + momAdj));
  awayWinProb = 1 - homeWinProb;
  
  // Total runs
  const totalRuns = awayExpRuns + homeExpRuns;
  
  // Run line probability
  const runDiffMean = homeExpRuns - awayExpRuns;
  const runDiffStd = 3.8;
  const homeRL = normalCDF(runDiffMean - 1.5, runDiffStd);
  const awayRL = 1 - normalCDF(runDiffMean + 1.5, runDiffStd);
  
  const homeML = probToML(homeWinProb);
  const awayML = probToML(awayWinProb);

  // Totals — use Negative Binomial when available (better overdispersion), fallback to Poisson
  let poissonTotals = calculatePoissonTotals(awayExpRuns, homeExpRuns);
  let nbTotals = null;
  if (negBinomial) {
    nbTotals = negBinomial.calculateNBTotals(awayExpRuns, homeExpRuns, nbOpts);
    // Merge NB totals into the main totals object — NB is more accurate for O/U
    // Keep Poisson for backwards compatibility but add NB data
    poissonTotals.model = 'negative-binomial+poisson';
    poissonTotals.nbR = gameR;
    poissonTotals.nbOverdispersion = nbTotals.overdispersion;
    // Override O/U probabilities with NB values (more accurate)
    if (nbTotals.lines) {
      for (const [line, data] of Object.entries(nbTotals.lines)) {
        if (poissonTotals.lines && poissonTotals.lines[line]) {
          poissonTotals.lines[line].nbOver = data.over;
          poissonTotals.lines[line].nbUnder = data.under;
          poissonTotals.lines[line].nbOverML = data.overML;
          poissonTotals.lines[line].nbUnderML = data.underML;
          // Use NB as the primary O/U probability
          poissonTotals.lines[line].over = data.over;
          poissonTotals.lines[line].under = data.under;
          poissonTotals.lines[line].overML = data.overML;
          poissonTotals.lines[line].underML = data.underML;
        }
      }
    }
    // Add NB-specific features
    poissonTotals.teamTotals = nbTotals.teamTotals;
    poissonTotals.specialMarkets = nbTotals.specialMarkets;
    poissonTotals.variance = nbTotals.variance;
    poissonTotals.topScores = nbTotals.topScores;
  }
  
  const result = {
    away: awayAbbr, home: homeAbbr,
    awayName: away.name, homeName: home.name,
    homeWinProb: +(homeWinProb.toFixed(3)),
    awayWinProb: +(awayWinProb.toFixed(3)),
    homeML, awayML,
    homeExpRuns: +(homeExpRuns.toFixed(2)),
    awayExpRuns: +(awayExpRuns.toFixed(2)),
    totalRuns: +(totalRuns.toFixed(1)),
    f5Total: +((awayExpF5 + homeExpF5).toFixed(1)),
    runDiff: +(runDiffMean.toFixed(1)),
    homeRunLine: { spread: -1.5, prob: +(homeRL.toFixed(3)) },
    awayRunLine: { spread: 1.5, prob: +(awayRL.toFixed(3)) },
    parkFactor: pf,
    awayPower: awayR.power,
    homePower: homeR.power,
    totals: poissonTotals,
    factors: {
      awayPythWpct: awayR.pythWpct,
      homePythWpct: homeR.pythWpct,
      awayLuck: awayR.luck,
      homeLuck: homeR.luck,
      parkEffect: pf,
      homeAdv: HOME_ADV,
      awayRolling: awayRolling ? { adj: +awayRollingAdj.toFixed(2), trend: awayRolling.trend, streak: awayRolling.streak, l5: awayRolling.l5Record, l10: awayRolling.l10Record, confidence: awayRolling.confidence } : null,
      homeRolling: homeRolling ? { adj: +homeRollingAdj.toFixed(2), trend: homeRolling.trend, streak: homeRolling.streak, l5: homeRolling.l5Record, l10: homeRolling.l10Record, confidence: homeRolling.confidence } : null,
      awayInjuries: awayInjuries && awayInjuries.starPlayersOut.length > 0 ? { adj: +awayInjuryAdj.toFixed(2), out: awayInjuries.starPlayersOut } : null,
      homeInjuries: homeInjuries && homeInjuries.starPlayersOut.length > 0 ? { adj: +homeInjuryAdj.toFixed(2), out: homeInjuries.starPlayersOut } : null,
      awayPlatoon: awayPlatoonInfo,
      homePlatoon: homePlatoonInfo,
      weather: weatherData ? { multiplier: weatherData.multiplier, impact: weatherData.totalImpact, description: weatherData.description, factors: weatherData.factors } : null,
      umpire: umpireData ? { name: umpireData.name, zone: umpireData.zone, multiplier: umpireData.multiplier, adjustment: umpireData.adjustment, overRate: umpireData.overRate, confidence: umpireData.confidence } : null,
      awayRest: awayRestData ? { adj: +awayRestAdj.toFixed(3), factors: awayRestData.factors, daysSinceLast: awayRestData.daysSinceLast, consecutiveRoad: awayRestData.consecutiveRoad, confidence: awayRestData.confidence } : null,
      homeRest: homeRestData ? { adj: +homeRestAdj.toFixed(3), factors: homeRestData.factors, daysSinceLast: homeRestData.daysSinceLast, consecutiveHome: homeRestData.consecutiveHome, confidence: homeRestData.confidence } : null,
      awayBullpenFatigue: awayBullpenFatigue ? { multiplier: awayBullpenFatigue.multiplier, status: awayBullpenFatigue.status, factors: awayBullpenFatigue.factors } : null,
      homeBullpenFatigue: homeBullpenFatigue ? { multiplier: homeBullpenFatigue.multiplier, status: homeBullpenFatigue.status, factors: homeBullpenFatigue.factors } : null,
      earlySeasonRegression: (awayRegression > 0 || homeRegression > 0) ? { away: +awayRegression.toFixed(3), home: +homeRegression.toFixed(3), note: 'Regressing toward league avg due to small sample' } : null,
      earlySeasonCalibration: isEarlySeason ? { hcaShift: HCA_SHIFT, maxWinProb: MAX_WIN_PROB, minWinProb: MIN_WIN_PROB, note: 'Tighter caps + reduced HCA for early season (49.2% HWR in first 2 weeks)' } : null,
      preseasonTuning: (awayPreseasonInfo || homePreseasonInfo) ? {
        away: awayPreseasonInfo,
        home: homePreseasonInfo,
        note: 'Spring training signals, roster changes, and Opening Day adjustments'
      } : null,
      statcast: (awayStatcastPitcher || homeStatcastPitcher || awayStatcastBatting || homeStatcastBatting) ? {
        awayPitcher: awayStatcastPitcher ? { name: awayStatcastPitcher.name, era: awayStatcastPitcher.era, xera: awayStatcastPitcher.xera, eraGap: awayStatcastPitcher.eraGap, xwoba: awayStatcastPitcher.xwoba, regression: awayStatcastPitcher.regressionDirection, confidence: awayStatcastPitcher.confidence } : null,
        homePitcher: homeStatcastPitcher ? { name: homeStatcastPitcher.name, era: homeStatcastPitcher.era, xera: homeStatcastPitcher.xera, eraGap: homeStatcastPitcher.eraGap, xwoba: homeStatcastPitcher.xwoba, regression: homeStatcastPitcher.regressionDirection, confidence: homeStatcastPitcher.confidence } : null,
        awayBatting: awayStatcastBatting ? { xwoba: awayStatcastBatting.teamXwoba, woba: awayStatcastBatting.teamWoba, edge: awayStatcastBatting.xwobaEdge, multiplier: awayStatcastBatting.offenseMultiplier } : null,
        homeBatting: homeStatcastBatting ? { xwoba: homeStatcastBatting.teamXwoba, woba: homeStatcastBatting.teamWoba, edge: homeStatcastBatting.xwobaEdge, multiplier: homeStatcastBatting.offenseMultiplier } : null,
        awayAdj: +awayStatcastAdj.toFixed(3),
        homeAdj: +homeStatcastAdj.toFixed(3),
        note: 'Statcast xERA/xwOBA adjustments for true quality vs surface stats'
      } : null,
      lineup: lineupInfo,
    }
  };
  
  // ==================== MONTE CARLO SIMULATION ====================
  // Run 10K sims for more accurate distributions (optional, can be slow)
  if (opts.monteCarlo !== false && monteCarlo) {
    try {
      const simOpts = {
        awayBullpenMult: awayBullpenFatigue?.multiplier || 1.0,
        homeBullpenMult: homeBullpenFatigue?.multiplier || 1.0,
        numSims: opts.numSims || 10000,
      };
      const sim = monteCarlo.simulate(awayExpRuns, homeExpRuns, simOpts);
      result.monteCarlo = {
        homeWinProb: sim.homeWinProb,
        awayWinProb: sim.awayWinProb,
        homeML: sim.homeML,
        awayML: sim.awayML,
        totalRuns: sim.totalRuns,
        runLines: sim.runLines,
        totals: sim.totals,
        f5: sim.f5,
        topScores: sim.topScores.slice(0, 8),
        marginDist: sim.marginDist,
        extraInningsPct: sim.extraInningsPct,
      };
      
      // Blend MC win prob with analytical (MC is more accurate for extreme matchups)
      // Weight: 60% Monte Carlo, 40% analytical
      const blendedHomeProb = sim.homeWinProb * 0.6 + result.homeWinProb * 0.4;
      const blendedAwayProb = 1 - blendedHomeProb;
      result.blendedHomeWinProb = +blendedHomeProb.toFixed(4);
      result.blendedAwayWinProb = +blendedAwayProb.toFixed(4);
      result.blendedHomeML = probToML(blendedHomeProb);
      result.blendedAwayML = probToML(blendedAwayProb);
    } catch (e) {
      // Monte Carlo optional — don't break predict()
    }
  }

  // Add pitcher info if available
  if (awayPitcher) {
    result.awayPitcher = {
      name: awayPitcher.name || 'Custom',
      hand: awayPitcher.hand || '?',
      era: awayPitcher.era,
      fip: awayPitcher.fip,
      xfip: awayPitcher.xfip,
      whip: awayPitcher.whip,
      k9: awayPitcher.k9,
      rating: awayPitcher.rating || null,
      tier: awayPitcher.rating ? pitchers.getPitcherTier(awayPitcher.rating) : null
    };
  }
  if (homePitcher) {
    result.homePitcher = {
      name: homePitcher.name || 'Custom',
      hand: homePitcher.hand || '?',
      era: homePitcher.era,
      fip: homePitcher.fip,
      xfip: homePitcher.xfip,
      whip: homePitcher.whip,
      k9: homePitcher.k9,
      rating: homePitcher.rating || null,
      tier: homePitcher.rating ? pitchers.getPitcherTier(homePitcher.rating) : null
    };
  }
  
  return result;
}

// ==================== POISSON TOTALS MODEL ====================

// Pre-compute factorials for Poisson
const FACTORIALS = [1];
for (let i = 1; i <= 25; i++) FACTORIALS[i] = FACTORIALS[i-1] * i;

function poissonPMF(lambda, k) {
  if (k < 0 || k > 25) return 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / FACTORIALS[k];
}

// Calculate win probability directly from Poisson score distribution
// More accurate than Pythagorean for single-game predictions with known pitchers
function poissonWinProb(awayLambda, homeLambda) {
  const maxRuns = 16;
  let awayWin = 0, homeWin = 0, tie = 0;
  
  for (let a = 0; a < maxRuns; a++) {
    for (let h = 0; h < maxRuns; h++) {
      const prob = poissonPMF(awayLambda, a) * poissonPMF(homeLambda, h);
      if (a > h) awayWin += prob;
      else if (h > a) homeWin += prob;
      else tie += prob;
    }
  }
  
  // Split ties proportionally (baseball has extra innings)
  const total = awayWin + homeWin;
  if (total === 0) return { away: 0.5, home: 0.5 };
  
  return {
    away: +(((awayWin + tie * awayWin / total)).toFixed(4)),
    home: +(((homeWin + tie * homeWin / total)).toFixed(4))
  };
}

// Calculate full score distribution and over/under probabilities
function calculatePoissonTotals(awayExpRuns, homeExpRuns) {
  const lambdaAway = Math.max(0.5, awayExpRuns);
  const lambdaHome = Math.max(0.5, homeExpRuns);
  const projTotal = lambdaAway + lambdaHome;
  
  // Build score probability matrix (0-15 runs each)
  const maxRuns = 16;
  const scoreMatrix = [];
  for (let a = 0; a < maxRuns; a++) {
    scoreMatrix[a] = [];
    for (let h = 0; h < maxRuns; h++) {
      scoreMatrix[a][h] = poissonPMF(lambdaAway, a) * poissonPMF(lambdaHome, h);
    }
  }
  
  // Calculate probabilities for common total lines
  const lines = [6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11];
  const totalProbs = {};
  
  for (const line of lines) {
    let overProb = 0;
    let underProb = 0;
    
    for (let a = 0; a < maxRuns; a++) {
      for (let h = 0; h < maxRuns; h++) {
        const total = a + h;
        const prob = scoreMatrix[a][h];
        if (total > line) overProb += prob;
        else if (total < line) underProb += prob;
        // Exact pushes (whole number lines) go to neither
      }
    }
    
    totalProbs[line] = {
      over: +(overProb.toFixed(3)),
      under: +(underProb.toFixed(3)),
      overML: probToML(overProb),
      underML: probToML(underProb)
    };
  }
  
  // Most likely final scores
  const likelyScores = [];
  for (let a = 0; a < 12; a++) {
    for (let h = 0; h < 12; h++) {
      likelyScores.push({ away: a, home: h, prob: scoreMatrix[a][h] });
    }
  }
  likelyScores.sort((a, b) => b.prob - a.prob);
  
  return {
    projTotal: +(projTotal.toFixed(1)),
    awayLambda: +(lambdaAway.toFixed(2)),
    homeLambda: +(lambdaHome.toFixed(2)),
    lines: totalProbs,
    likelyScores: likelyScores.slice(0, 10).map(s => ({
      score: `${s.away}-${s.home}`,
      prob: +(s.prob * 100).toFixed(1)
    }))
  };
}

// Standalone totals prediction
function predictTotal(awayAbbr, homeAbbr, opts = {}) {
  const pred = predict(awayAbbr, homeAbbr, opts);
  if (pred.error) return pred;
  
  return {
    away: awayAbbr, home: homeAbbr,
    awayName: pred.awayName, homeName: pred.homeName,
    awayExpRuns: pred.awayExpRuns,
    homeExpRuns: pred.homeExpRuns,
    ...pred.totals,
    parkFactor: pred.parkFactor,
    awayPitcher: pred.awayPitcher || null,
    homePitcher: pred.homePitcher || null
  };
}

// ==================== MATCHUP ANALYSIS ====================

function analyzeMatchup(awayAbbr, homeAbbr, opts = {}) {
  const pred = predict(awayAbbr, homeAbbr, opts);
  if (pred.error) return pred;
  
  const away = TEAMS[awayAbbr];
  const home = TEAMS[homeAbbr];
  const ratings = calculateRatings();
  
  // Get rotations
  const awayRotation = pitchers.getTeamRotation(awayAbbr) || [];
  const homeRotation = pitchers.getTeamRotation(homeAbbr) || [];
  
  // Analyze specific pitcher matchup
  let pitcherAdvantage = 'EVEN';
  let pitcherSwing = 0;
  if (pred.awayPitcher && pred.homePitcher) {
    const diff = (pred.homePitcher.rating || 50) - (pred.awayPitcher.rating || 50);
    pitcherSwing = diff;
    if (diff > 10) pitcherAdvantage = `${homeAbbr} +${diff}`;
    else if (diff < -10) pitcherAdvantage = `${awayAbbr} +${Math.abs(diff)}`;
  }
  
  // Offense vs pitching matchup
  const offensiveEdge = {
    away: +(away.rsG - LG_AVG.rsG).toFixed(2),
    home: +(home.rsG - LG_AVG.rsG).toFixed(2),
    advantage: away.rsG > home.rsG ? awayAbbr : homeAbbr
  };
  
  const bullpenEdge = {
    away: +(LG_AVG.era - away.bullpenEra).toFixed(2),
    home: +(LG_AVG.era - home.bullpenEra).toFixed(2),
    advantage: away.bullpenEra < home.bullpenEra ? awayAbbr : homeAbbr
  };
  
  // Key factors summary
  const keyFactors = [];
  if (pred.parkFactor > 1.03) keyFactors.push(`🏟️ Hitter-friendly park (${pred.parkFactor}x)`);
  if (pred.parkFactor < 0.96) keyFactors.push(`🏟️ Pitcher-friendly park (${pred.parkFactor}x)`);
  if (pred.awayPitcher && pred.awayPitcher.tier === 'ACE') keyFactors.push(`🔥 ${pred.awayPitcher.name} is an ACE (${pred.awayPitcher.rating})`);
  if (pred.homePitcher && pred.homePitcher.tier === 'ACE') keyFactors.push(`🔥 ${pred.homePitcher.name} is an ACE (${pred.homePitcher.rating})`);
  if (Math.abs(pred.awayPower - pred.homePower) > 15) keyFactors.push(`⚡ Big power rating gap: ${pred.awayPower} vs ${pred.homePower}`);
  if (pred.totalRuns > 9.5) keyFactors.push(`💥 High-scoring projection: ${pred.totalRuns} runs`);
  if (pred.totalRuns < 7) keyFactors.push(`🧊 Low-scoring projection: ${pred.totalRuns} runs`);
  // Rolling stats factors
  if (pred.factors.awayRolling && pred.factors.awayRolling.trend === '🔥🔥') keyFactors.push(`🔥🔥 ${awayAbbr} on fire (L5: ${pred.factors.awayRolling.l5}, ${pred.factors.awayRolling.streak})`);
  if (pred.factors.homeRolling && pred.factors.homeRolling.trend === '🔥🔥') keyFactors.push(`🔥🔥 ${homeAbbr} on fire (L5: ${pred.factors.homeRolling.l5}, ${pred.factors.homeRolling.streak})`);
  if (pred.factors.awayRolling && pred.factors.awayRolling.trend === '🧊🧊') keyFactors.push(`🧊🧊 ${awayAbbr} ice cold (L5: ${pred.factors.awayRolling.l5}, ${pred.factors.awayRolling.streak})`);
  if (pred.factors.homeRolling && pred.factors.homeRolling.trend === '🧊🧊') keyFactors.push(`🧊🧊 ${homeAbbr} ice cold (L5: ${pred.factors.homeRolling.l5}, ${pred.factors.homeRolling.streak})`);
  // Injury factors
  if (pred.factors.awayInjuries) keyFactors.push(`🏥 ${awayAbbr} missing: ${pred.factors.awayInjuries.out.map(p => p.player).join(', ')} (${pred.factors.awayInjuries.adj.toFixed(1)} adj)`);
  if (pred.factors.homeInjuries) keyFactors.push(`🏥 ${homeAbbr} missing: ${pred.factors.homeInjuries.out.map(p => p.player).join(', ')} (${pred.factors.homeInjuries.adj.toFixed(1)} adj)`);
  // Platoon factors
  if (pred.factors.awayPlatoon && Math.abs(pred.factors.awayPlatoon.adjustment) >= 3) {
    keyFactors.push(`🔀 ${pred.factors.awayPlatoon.note} (${pred.factors.awayPlatoon.adjustment}%)`);
  }
  if (pred.factors.homePlatoon && Math.abs(pred.factors.homePlatoon.adjustment) >= 3) {
    keyFactors.push(`🔀 ${pred.factors.homePlatoon.note} (${pred.factors.homePlatoon.adjustment}%)`);
  }
  
  return {
    ...pred,
    matchup: {
      pitcherAdvantage,
      pitcherSwing,
      offensiveEdge,
      bullpenEdge,
      keyFactors,
      awayRotation: awayRotation.map(p => ({ name: p.name, rating: p.rating, tier: pitchers.getPitcherTier(p.rating), era: p.era, fip: p.fip })),
      homeRotation: homeRotation.map(p => ({ name: p.name, rating: p.rating, tier: pitchers.getPitcherTier(p.rating), era: p.era, fip: p.fip }))
    }
  };
}

// ==================== VALUE DETECTION ====================

function findValue(prediction, bookLine) {
  const edges = [];
  const minEdge = 0.02;
  
  // Apply preseason confidence — during Opening Day, require larger edges
  // because our projections are based on preseason data, not real games
  const hasRegression = prediction.factors?.earlySeasonRegression;
  const preseasonMinEdge = hasRegression ? 0.035 : minEdge; // Higher bar for preseason
  
  // Moneyline value
  if (bookLine.homeML) {
    const bookHomeProb = mlToProb(bookLine.homeML);
    const homeEdge = prediction.homeWinProb - bookHomeProb;
    if (homeEdge > preseasonMinEdge) {
      const kelly = kellySize(prediction.homeWinProb, bookLine.homeML);
      edges.push({
        pick: `${prediction.home} ML`, side: 'home', market: 'moneyline',
        modelProb: prediction.homeWinProb, bookProb: +bookHomeProb.toFixed(3),
        edge: +(homeEdge.toFixed(3)), ml: bookLine.homeML,
        ev: +(evPer100(prediction.homeWinProb, bookLine.homeML).toFixed(1)),
        kelly: { full: +(kelly.toFixed(3)), half: +((kelly/2).toFixed(3)) },
        pitcher: prediction.homePitcher ? prediction.homePitcher.name : null
      });
    }
  }
  if (bookLine.awayML) {
    const bookAwayProb = mlToProb(bookLine.awayML);
    const awayEdge = prediction.awayWinProb - bookAwayProb;
    if (awayEdge > preseasonMinEdge) {
      const kelly = kellySize(prediction.awayWinProb, bookLine.awayML);
      edges.push({
        pick: `${prediction.away} ML`, side: 'away', market: 'moneyline',
        modelProb: prediction.awayWinProb, bookProb: +bookAwayProb.toFixed(3),
        edge: +(awayEdge.toFixed(3)), ml: bookLine.awayML,
        ev: +(evPer100(prediction.awayWinProb, bookLine.awayML).toFixed(1)),
        kelly: { full: +(kelly.toFixed(3)), half: +((kelly/2).toFixed(3)) },
        pitcher: prediction.awayPitcher ? prediction.awayPitcher.name : null
      });
    }
  }
  
  // Total value (enhanced with Poisson)
  if (bookLine.total && prediction.totals && prediction.totals.lines) {
    const line = bookLine.total;
    const poissonData = prediction.totals.lines[line];
    
    if (poissonData) {
      // Over value
      const overEdge = poissonData.over - 0.5; // vs -110 juice
      if (overEdge > 0.03) {
        edges.push({
          pick: `Over ${line}`, side: 'over', market: 'total',
          modelProb: poissonData.over, bookTotal: line,
          modelTotal: prediction.totals.projTotal,
          edge: +(overEdge.toFixed(3)),
          diff: +(prediction.totals.projTotal - line).toFixed(1),
          ml: poissonData.overML
        });
      }
      // Under value
      const underEdge = poissonData.under - 0.5;
      if (underEdge > 0.03) {
        edges.push({
          pick: `Under ${line}`, side: 'under', market: 'total',
          modelProb: poissonData.under, bookTotal: line,
          modelTotal: prediction.totals.projTotal,
          edge: +(underEdge.toFixed(3)),
          diff: +(line - prediction.totals.projTotal).toFixed(1),
          ml: poissonData.underML
        });
      }
    } else {
      // Fallback for non-standard lines
      const diff = prediction.totalRuns - line;
      if (Math.abs(diff) > 0.5) {
        const side = diff > 0 ? 'Over' : 'Under';
        edges.push({
          pick: `${side} ${line}`, side: side.toLowerCase(), market: 'total',
          modelTotal: prediction.totalRuns, bookTotal: line,
          edge: +(Math.abs(diff / 10).toFixed(3)), diff: +(diff.toFixed(1))
        });
      }
    }
  }
  
  return edges;
}

// ==================== MATH HELPERS ====================

function normalCDF(x, std) {
  const z = x / std;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

function mlToProb(ml) {
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function evPer100(modelProb, ml) {
  const payout = ml > 0 ? ml : 100 / (-ml / 100);
  return modelProb * payout - (1 - modelProb) * 100;
}

function kellySize(modelProb, ml) {
  const b = ml > 0 ? ml / 100 : 100 / (-ml);
  const q = 1 - modelProb;
  const kelly = (b * modelProb - q) / b;
  return Math.max(0, kelly);
}

// ==================== ASYNC PREDICT (with rest/travel) ====================

/**
 * Async version of predict that fetches rest/travel data automatically
 * Use this from server endpoints for the most accurate predictions
 */
async function asyncPredict(awayAbbr, homeAbbr, opts = {}) {
  // Fetch rest/travel data if not already provided
  if (!opts.restTravel && restTravel) {
    try {
      const gameDate = opts.gameDate || new Date().toISOString().split('T')[0];
      opts.restTravel = await restTravel.getMatchupAdjustments(awayAbbr, homeAbbr, gameDate);
    } catch (e) { /* rest/travel optional */ }
  }
  
  // Fetch lineup data if not already provided
  if (!opts.lineup && lineupFetcher) {
    try {
      const dateStr = opts.gameDate || new Date().toISOString().split('T')[0];
      opts.lineup = await lineupFetcher.getLineupAdjustments(awayAbbr, homeAbbr, dateStr);
    } catch (e) { /* lineup data optional */ }
  }
  
  const result = predict(awayAbbr, homeAbbr, opts);
  
  // Apply Opening Week unders adjustment to totals
  let openingWeekUnders = null;
  try { openingWeekUnders = require('../services/opening-week-unders'); } catch (e) { /* optional */ }
  
  if (openingWeekUnders && result.totalRuns) {
    const gameDate = opts.gameDate || new Date().toISOString().split('T')[0];
    const homeTeam = getTeams()[homeAbbr];
    const homePark = homeTeam?.park || '';
    
    const owAdj = openingWeekUnders.getOpeningWeekAdjustment(gameDate, homePark, {
      homeStarterTier: opts.homeStarterTier || 3,
      awayStarterTier: opts.awayStarterTier || 3
    });
    
    if (owAdj.active && owAdj.reduction > 0) {
      // Adjust the total runs down
      const adjustedTotal = +(result.totalRuns * (1 - owAdj.reduction)).toFixed(1);
      result.openingWeek = {
        active: true,
        reduction: owAdj.reductionPct,
        originalTotal: result.totalRuns,
        adjustedTotal,
        runsReduced: +(result.totalRuns - adjustedTotal).toFixed(1),
        factors: owAdj.factors,
        note: owAdj.note
      };
      result.totalRuns = adjustedTotal;
    }
  }
  
  return result;
}

/**
 * Async matchup analysis with rest/travel
 */
async function asyncMatchup(awayAbbr, homeAbbr, opts = {}) {
  if (!opts.restTravel && restTravel) {
    try {
      const gameDate = opts.gameDate || new Date().toISOString().split('T')[0];
      opts.restTravel = await restTravel.getMatchupAdjustments(awayAbbr, homeAbbr, gameDate);
    } catch (e) { /* rest/travel optional */ }
  }
  
  return analyzeMatchup(awayAbbr, homeAbbr, opts);
}

module.exports = { 
  TEAMS, PARK_FACTORS, PLATOON_SPLITS, getTeams,
  calculateRatings, predict, predictTotal, analyzeMatchup, findValue, 
  asyncPredict, asyncMatchup,
  pythWinPct, calculatePoissonTotals,
  resolvePitcher, refreshData, getPreseasonConfidence
};
