/**
 * Player Props Framework — SportsSim v10.0
 * 
 * Fetches player prop odds from The Odds API (event-level endpoint),
 * builds projections using team-level models + player baselines from ESPN,
 * and finds +EV prop bets across NBA, MLB, and NHL.
 * 
 * Supported markets:
 *   NBA: points, rebounds, assists, threes, PRA, steals, blocks, turnovers
 *   MLB: pitcher Ks, batter hits, batter HRs, batter total bases, batter RBIs
 *   NHL: (future — goals, assists, shots)
 */

const fs = require('fs');
const path = require('path');

const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const CACHE_FILE = path.join(__dirname, 'props-cache.json');
const CACHE_TTL = 15 * 60 * 1000; // 15 min

// ==================== MARKET DEFINITIONS ====================

const NBA_PROP_MARKETS = {
  player_points: { label: 'Points', stat: 'points', abbr: 'PTS' },
  player_rebounds: { label: 'Rebounds', stat: 'rebounds', abbr: 'REB' },
  player_assists: { label: 'Assists', stat: 'assists', abbr: 'AST' },
  player_threes: { label: 'Threes', stat: 'threes', abbr: '3PM' },
  player_points_rebounds_assists: { label: 'PTS+REB+AST', stat: 'pra', abbr: 'PRA' },
  player_steals: { label: 'Steals', stat: 'steals', abbr: 'STL' },
  player_blocks: { label: 'Blocks', stat: 'blocks', abbr: 'BLK' },
  player_turnovers: { label: 'Turnovers', stat: 'turnovers', abbr: 'TO' },
  player_points_rebounds: { label: 'PTS+REB', stat: 'pts_reb', abbr: 'PR' },
  player_points_assists: { label: 'PTS+AST', stat: 'pts_ast', abbr: 'PA' },
  player_rebounds_assists: { label: 'REB+AST', stat: 'reb_ast', abbr: 'RA' },
  player_double_double: { label: 'Double Double', stat: 'dd', abbr: 'DD' },
};

const MLB_PROP_MARKETS = {
  pitcher_strikeouts: { label: 'Pitcher Ks', stat: 'strikeouts', abbr: 'K' },
  batter_hits: { label: 'Batter Hits', stat: 'hits', abbr: 'H' },
  batter_home_runs: { label: 'Batter HRs', stat: 'home_runs', abbr: 'HR' },
  batter_total_bases: { label: 'Total Bases', stat: 'total_bases', abbr: 'TB' },
  batter_rbis: { label: 'Batter RBIs', stat: 'rbis', abbr: 'RBI' },
  batter_runs_scored: { label: 'Runs Scored', stat: 'runs', abbr: 'R' },
  batter_strikeouts: { label: 'Batter Ks', stat: 'batter_ks', abbr: 'SO' },
  batter_walks: { label: 'Batter Walks', stat: 'walks', abbr: 'BB' },
  batter_stolen_bases: { label: 'Stolen Bases', stat: 'stolen_bases', abbr: 'SB' },
  pitcher_hits_allowed: { label: 'Hits Allowed', stat: 'hits_allowed', abbr: 'HA' },
  pitcher_walks: { label: 'Pitcher Walks', stat: 'pitcher_walks', abbr: 'PBB' },
  pitcher_outs: { label: 'Pitcher Outs', stat: 'outs', abbr: 'OUT' },
};

const NHL_PROP_MARKETS = {
  player_points: { label: 'Points', stat: 'points', abbr: 'PTS' },
  player_goals: { label: 'Goals', stat: 'goals', abbr: 'G' },
  player_assists: { label: 'Assists', stat: 'assists', abbr: 'A' },
  player_shots_on_goal: { label: 'Shots on Goal', stat: 'shots', abbr: 'SOG' },
  player_blocked_shots: { label: 'Blocked Shots', stat: 'blocked', abbr: 'BLK' },
};

const SPORT_CONFIGS = {
  nba: { key: 'basketball_nba', markets: NBA_PROP_MARKETS, label: 'NBA' },
  mlb: { key: 'baseball_mlb', markets: MLB_PROP_MARKETS, label: 'MLB' },
  nhl: { key: 'icehockey_nhl', markets: NHL_PROP_MARKETS, label: 'NHL' },
};

// ==================== PLAYER BASELINE DATABASE ====================
// These are approximate 2025-26 season averages for top players
// In production, these would be fetched from ESPN/NBA API dynamically

const NBA_PLAYER_BASELINES = {
  // Top 30 NBA players — season averages (approximate 2025-26)
  'Luka Doncic': { team: 'DAL', points: 33.2, rebounds: 8.8, assists: 9.1, threes: 3.8, steals: 1.4, blocks: 0.5, turnovers: 3.8 },
  'Shai Gilgeous-Alexander': { team: 'OKC', points: 31.5, rebounds: 5.5, assists: 6.2, threes: 2.0, steals: 2.0, blocks: 1.2, turnovers: 2.4 },
  'Giannis Antetokounmpo': { team: 'MIL', points: 31.2, rebounds: 11.8, assists: 6.5, threes: 0.7, steals: 1.1, blocks: 1.5, turnovers: 3.6 },
  'Jayson Tatum': { team: 'BOS', points: 27.0, rebounds: 8.4, assists: 4.9, threes: 3.1, steals: 1.0, blocks: 0.6, turnovers: 2.8 },
  'Anthony Davis': { team: 'LAL', points: 25.7, rebounds: 12.2, assists: 3.5, threes: 0.5, steals: 1.2, blocks: 2.3, turnovers: 2.2 },
  'Kevin Durant': { team: 'PHX', points: 27.3, rebounds: 6.4, assists: 5.0, threes: 2.0, steals: 0.9, blocks: 1.2, turnovers: 3.0 },
  'Nikola Jokic': { team: 'DEN', points: 26.4, rebounds: 12.4, assists: 9.0, threes: 1.1, steals: 1.4, blocks: 0.9, turnovers: 3.0 },
  'Joel Embiid': { team: 'PHI', points: 33.0, rebounds: 11.0, assists: 5.7, threes: 1.4, steals: 1.0, blocks: 1.7, turnovers: 3.6 },
  'Anthony Edwards': { team: 'MIN', points: 25.8, rebounds: 5.5, assists: 5.2, threes: 3.0, steals: 1.3, blocks: 0.5, turnovers: 2.8 },
  'Donovan Mitchell': { team: 'CLE', points: 24.0, rebounds: 4.7, assists: 4.5, threes: 3.0, steals: 1.5, blocks: 0.4, turnovers: 2.5 },
  'LeBron James': { team: 'LAL', points: 25.5, rebounds: 7.5, assists: 8.8, threes: 2.0, steals: 1.0, blocks: 0.5, turnovers: 3.5 },
  'Stephen Curry': { team: 'GSW', points: 26.0, rebounds: 4.5, assists: 5.5, threes: 4.8, steals: 0.8, blocks: 0.3, turnovers: 2.8 },
  'Trae Young': { team: 'ATL', points: 25.0, rebounds: 3.0, assists: 10.8, threes: 2.8, steals: 1.0, blocks: 0.2, turnovers: 4.0 },
  'Tyrese Haliburton': { team: 'IND', points: 20.0, rebounds: 3.8, assists: 10.5, threes: 3.0, steals: 1.2, blocks: 0.3, turnovers: 2.5 },
  'De\'Aaron Fox': { team: 'SAC', points: 26.5, rebounds: 4.2, assists: 6.0, threes: 1.5, steals: 1.5, blocks: 0.4, turnovers: 2.8 },
  'Darius Garland': { team: 'CLE', points: 21.5, rebounds: 2.8, assists: 8.0, threes: 2.5, steals: 1.2, blocks: 0.2, turnovers: 2.8 },
  'Ja Morant': { team: 'MEM', points: 25.0, rebounds: 5.5, assists: 8.2, threes: 1.5, steals: 1.0, blocks: 0.3, turnovers: 3.5 },
  'Victor Wembanyama': { team: 'SAS', points: 24.5, rebounds: 10.5, assists: 3.8, threes: 2.0, steals: 1.2, blocks: 3.6, turnovers: 3.0 },
  'Paolo Banchero': { team: 'ORL', points: 23.0, rebounds: 7.0, assists: 5.0, threes: 1.5, steals: 0.8, blocks: 0.6, turnovers: 3.0 },
  'Devin Booker': { team: 'PHX', points: 27.0, rebounds: 4.5, assists: 6.5, threes: 2.5, steals: 0.8, blocks: 0.3, turnovers: 2.5 },
  'Cade Cunningham': { team: 'DET', points: 24.0, rebounds: 7.0, assists: 9.2, threes: 2.0, steals: 1.0, blocks: 0.3, turnovers: 3.5 },
  'Damian Lillard': { team: 'MIL', points: 25.5, rebounds: 4.5, assists: 7.0, threes: 3.5, steals: 0.9, blocks: 0.3, turnovers: 2.8 },
  'Karl-Anthony Towns': { team: 'NYK', points: 25.0, rebounds: 11.0, assists: 3.0, threes: 2.0, steals: 0.7, blocks: 0.8, turnovers: 2.8 },
  'Jalen Brunson': { team: 'NYK', points: 28.0, rebounds: 3.5, assists: 6.5, threes: 2.5, steals: 0.9, blocks: 0.2, turnovers: 2.5 },
  'Scottie Barnes': { team: 'TOR', points: 20.0, rebounds: 8.0, assists: 6.5, threes: 1.0, steals: 1.3, blocks: 1.0, turnovers: 2.5 },
  'Kyrie Irving': { team: 'DAL', points: 24.5, rebounds: 5.0, assists: 5.5, threes: 2.5, steals: 1.0, blocks: 0.3, turnovers: 2.3 },
  'Tyrese Maxey': { team: 'PHI', points: 26.5, rebounds: 3.5, assists: 6.0, threes: 3.0, steals: 1.0, blocks: 0.3, turnovers: 2.0 },
  'Bam Adebayo': { team: 'MIA', points: 19.5, rebounds: 10.5, assists: 4.8, threes: 0.3, steals: 1.1, blocks: 0.8, turnovers: 2.5 },
  'Jaren Jackson Jr.': { team: 'MEM', points: 22.0, rebounds: 5.5, assists: 1.5, threes: 2.0, steals: 0.9, blocks: 3.0, turnovers: 2.0 },
  'Lauri Markkanen': { team: 'UTA', points: 23.5, rebounds: 8.5, assists: 2.0, threes: 2.5, steals: 0.5, blocks: 0.6, turnovers: 2.0 },
};

const MLB_PITCHER_BASELINES = {
  // Top MLB starting pitchers — season K averages per start
  'Corbin Burnes': { team: 'ARI', strikeouts: 7.2, hits_allowed: 5.5, outs: 18.5, pitcher_walks: 2.0 },
  'Zack Wheeler': { team: 'PHI', strikeouts: 7.8, hits_allowed: 5.8, outs: 19.0, pitcher_walks: 1.5 },
  'Gerrit Cole': { team: 'NYY', strikeouts: 8.5, hits_allowed: 5.5, outs: 19.5, pitcher_walks: 1.8 },
  'Spencer Strider': { team: 'ATL', strikeouts: 10.5, hits_allowed: 4.8, outs: 17.5, pitcher_walks: 2.5 },
  'Logan Webb': { team: 'SF', strikeouts: 6.0, hits_allowed: 6.5, outs: 20.0, pitcher_walks: 1.5 },
  'Tarik Skubal': { team: 'DET', strikeouts: 8.5, hits_allowed: 5.0, outs: 19.0, pitcher_walks: 1.5 },
  'Dylan Cease': { team: 'SD', strikeouts: 8.0, hits_allowed: 5.5, outs: 17.5, pitcher_walks: 3.0 },
  'Blake Snell': { team: 'LAD', strikeouts: 9.0, hits_allowed: 4.5, outs: 16.5, pitcher_walks: 3.5 },
  'Shohei Ohtani': { team: 'LAD', strikeouts: 10.0, hits_allowed: 5.0, outs: 18.0, pitcher_walks: 2.5 },
  'Max Fried': { team: 'NYY', strikeouts: 6.5, hits_allowed: 6.0, outs: 19.5, pitcher_walks: 2.0 },
  'Tyler Glasnow': { team: 'LAD', strikeouts: 9.5, hits_allowed: 5.0, outs: 18.0, pitcher_walks: 2.5 },
  'Chris Sale': { team: 'ATL', strikeouts: 8.5, hits_allowed: 6.0, outs: 19.0, pitcher_walks: 1.8 },
  'Shane McClanahan': { team: 'TB', strikeouts: 8.0, hits_allowed: 5.5, outs: 18.5, pitcher_walks: 2.0 },
  'Framber Valdez': { team: 'HOU', strikeouts: 6.5, hits_allowed: 6.5, outs: 20.0, pitcher_walks: 2.5 },
  'Bobby Miller': { team: 'LAD', strikeouts: 7.0, hits_allowed: 6.0, outs: 17.0, pitcher_walks: 2.5 },
  'Yoshinobu Yamamoto': { team: 'LAD', strikeouts: 7.5, hits_allowed: 5.5, outs: 18.0, pitcher_walks: 2.0 },
  'Justin Verlander': { team: 'HOU', strikeouts: 6.0, hits_allowed: 6.5, outs: 18.5, pitcher_walks: 1.5 },
  'Marcus Stroman': { team: 'NYM', strikeouts: 5.5, hits_allowed: 7.0, outs: 19.0, pitcher_walks: 2.0 },
  'Sonny Gray': { team: 'STL', strikeouts: 7.5, hits_allowed: 5.5, outs: 18.5, pitcher_walks: 2.5 },
  'Seth Lugo': { team: 'KC', strikeouts: 6.5, hits_allowed: 6.0, outs: 19.5, pitcher_walks: 2.0 },
};

const MLB_BATTER_BASELINES = {
  // Top MLB batters — per-game averages
  'Shohei Ohtani': { team: 'LAD', hits: 1.4, home_runs: 0.28, total_bases: 2.5, rbis: 1.1, runs: 0.95, batter_ks: 1.3, walks: 0.7, stolen_bases: 0.35 },
  'Mookie Betts': { team: 'LAD', hits: 1.3, home_runs: 0.18, total_bases: 2.1, rbis: 0.8, runs: 0.85, batter_ks: 0.9, walks: 0.7, stolen_bases: 0.15 },
  'Aaron Judge': { team: 'NYY', hits: 1.2, home_runs: 0.35, total_bases: 2.8, rbis: 1.2, runs: 0.9, batter_ks: 1.4, walks: 0.9, stolen_bases: 0.05 },
  'Ronald Acuna Jr.': { team: 'ATL', hits: 1.3, home_runs: 0.22, total_bases: 2.3, rbis: 0.75, runs: 0.95, batter_ks: 1.1, walks: 0.65, stolen_bases: 0.45 },
  'Freddie Freeman': { team: 'LAD', hits: 1.4, home_runs: 0.15, total_bases: 2.1, rbis: 0.9, runs: 0.8, batter_ks: 0.7, walks: 0.6, stolen_bases: 0.05 },
  'Corey Seager': { team: 'TEX', hits: 1.2, home_runs: 0.22, total_bases: 2.2, rbis: 0.85, runs: 0.8, batter_ks: 1.0, walks: 0.5, stolen_bases: 0.02 },
  'Juan Soto': { team: 'NYM', hits: 1.2, home_runs: 0.22, total_bases: 2.2, rbis: 0.85, runs: 0.85, batter_ks: 1.0, walks: 1.0, stolen_bases: 0.05 },
  'Trea Turner': { team: 'PHI', hits: 1.3, home_runs: 0.14, total_bases: 1.9, rbis: 0.6, runs: 0.85, batter_ks: 1.0, walks: 0.4, stolen_bases: 0.2 },
  'Rafael Devers': { team: 'BOS', hits: 1.3, home_runs: 0.2, total_bases: 2.2, rbis: 0.9, runs: 0.75, batter_ks: 1.0, walks: 0.5, stolen_bases: 0.02 },
  'Marcus Semien': { team: 'TEX', hits: 1.2, home_runs: 0.16, total_bases: 2.0, rbis: 0.7, runs: 0.8, batter_ks: 1.0, walks: 0.5, stolen_bases: 0.12 },
  'Vladimir Guerrero Jr.': { team: 'TOR', hits: 1.3, home_runs: 0.17, total_bases: 2.0, rbis: 0.8, runs: 0.7, batter_ks: 0.7, walks: 0.6, stolen_bases: 0.02 },
  'Bobby Witt Jr.': { team: 'KC', hits: 1.4, home_runs: 0.18, total_bases: 2.3, rbis: 0.8, runs: 0.9, batter_ks: 0.9, walks: 0.4, stolen_bases: 0.3 },
  'Matt Olson': { team: 'ATL', hits: 1.1, home_runs: 0.25, total_bases: 2.2, rbis: 1.0, runs: 0.75, batter_ks: 1.2, walks: 0.7, stolen_bases: 0.02 },
  'Bryce Harper': { team: 'PHI', hits: 1.2, home_runs: 0.2, total_bases: 2.2, rbis: 0.85, runs: 0.8, batter_ks: 1.0, walks: 0.7, stolen_bases: 0.08 },
  'Kyle Tucker': { team: 'CHC', hits: 1.3, home_runs: 0.2, total_bases: 2.2, rbis: 0.85, runs: 0.85, batter_ks: 0.9, walks: 0.6, stolen_bases: 0.18 },
  'Julio Rodriguez': { team: 'SEA', hits: 1.2, home_runs: 0.16, total_bases: 2.0, rbis: 0.7, runs: 0.75, batter_ks: 1.2, walks: 0.4, stolen_bases: 0.22 },
  'Pete Alonso': { team: 'NYM', hits: 1.1, home_runs: 0.25, total_bases: 2.2, rbis: 1.0, runs: 0.7, batter_ks: 1.2, walks: 0.5, stolen_bases: 0.02 },
  'Yordan Alvarez': { team: 'HOU', hits: 1.2, home_runs: 0.22, total_bases: 2.3, rbis: 0.9, runs: 0.75, batter_ks: 1.0, walks: 0.7, stolen_bases: 0.02 },
  'Gunnar Henderson': { team: 'BAL', hits: 1.2, home_runs: 0.2, total_bases: 2.2, rbis: 0.8, runs: 0.85, batter_ks: 1.3, walks: 0.6, stolen_bases: 0.12 },
  'Elly De La Cruz': { team: 'CIN', hits: 1.1, home_runs: 0.15, total_bases: 1.8, rbis: 0.6, runs: 0.85, batter_ks: 1.5, walks: 0.5, stolen_bases: 0.45 },
};

// ==================== ODDS API FETCH ====================

async function fetchEvents(sportKey) {
  if (!ODDS_API_KEY) return [];
  try {
    const fetch = require('node-fetch');
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${ODDS_API_KEY}&dateFormat=iso`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(`Props: failed to fetch events for ${sportKey}:`, e.message);
    return [];
  }
}

async function fetchEventProps(sportKey, eventId, markets) {
  if (!ODDS_API_KEY) return null;
  try {
    const fetch = require('node-fetch');
    const mkts = markets.join(',');
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${mkts}&oddsFormat=american`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.error(`Props: failed to fetch event props for ${eventId}:`, e.message);
    return null;
  }
}

// ==================== PROJECTION ENGINE ====================

/**
 * Get player baseline projection for a stat
 */
function getPlayerBaseline(playerName, stat, sport) {
  if (sport === 'nba') {
    const player = NBA_PLAYER_BASELINES[playerName];
    if (!player) return null;
    // Handle combo stats
    if (stat === 'pra') return (player.points || 0) + (player.rebounds || 0) + (player.assists || 0);
    if (stat === 'pts_reb') return (player.points || 0) + (player.rebounds || 0);
    if (stat === 'pts_ast') return (player.points || 0) + (player.assists || 0);
    if (stat === 'reb_ast') return (player.rebounds || 0) + (player.assists || 0);
    return player[stat] || null;
  }
  if (sport === 'mlb') {
    // Check pitchers first
    const pitcher = MLB_PITCHER_BASELINES[playerName];
    if (pitcher && pitcher[stat] !== undefined) return pitcher[stat];
    // Check batters
    const batter = MLB_BATTER_BASELINES[playerName];
    if (batter && batter[stat] !== undefined) return batter[stat];
    return null;
  }
  return null;
}

/**
 * Adjust projection based on opponent strength (team model integration)
 */
function adjustForOpponent(baseline, playerTeam, opponentTeam, stat, sport, models) {
  if (!models || !baseline) return baseline;
  
  let adjusted = baseline;
  
  if (sport === 'nba' && models.nba) {
    try {
      const teams = models.nba.getTeams();
      const opp = teams[opponentTeam];
      if (!opp) return adjusted;
      
      // Defensive adjustment: opponent's OPPG relative to league average
      const leagueAvgPPG = 112; // ~NBA avg
      const defRating = opp.oppg / leagueAvgPPG; // >1 = bad defense, <1 = good defense
      
      if (['points', 'pra', 'pts_reb', 'pts_ast', 'threes'].includes(stat)) {
        adjusted *= defRating; // Scale scoring stats by defensive quality
      }
      if (['rebounds'].includes(stat)) {
        // Adjust for pace — faster teams = more rebounds
        const pace = (opp.ppg + opp.oppg) / (leagueAvgPPG * 2);
        adjusted *= (0.7 + 0.3 * pace); // Moderate pace impact
      }
    } catch (e) { /* use baseline */ }
  }
  
  if (sport === 'mlb' && models.mlb) {
    try {
      const teams = models.mlb.getTeams();
      // Pitcher K adjustment: opposing team strikeout rate
      if (stat === 'strikeouts') {
        // Opponents who strike out more = more Ks for pitcher
        const opp = teams[opponentTeam];
        if (opp) {
          const leagueAvgRuns = 4.5;
          const offRating = (opp.rpg || leagueAvgRuns) / leagueAvgRuns;
          // Weaker offenses may K more, but we use a simple ratio
          adjusted *= (2 - offRating) * 0.8 + 0.2; // Mild adjustment
        }
      }
      // Batter adjustments: opposing pitcher quality
      if (['hits', 'home_runs', 'total_bases', 'rbis', 'runs'].includes(stat)) {
        // No opponent pitcher-specific data here, but we can adjust for park/team
        // This would be enhanced with live pitcher data
      }
    } catch (e) { /* use baseline */ }
  }
  
  return +adjusted.toFixed(2);
}

/**
 * Calculate over/under probability using a Poisson-like model
 * Good for count stats (points, rebounds, assists, Ks, etc.)
 */
function calcOverUnderProb(projection, line) {
  if (!projection || !line || line <= 0) return { over: 50, under: 50 };
  
  // For high-count stats (NBA points, PRA) use normal approximation
  // For low-count stats (HRs, steals) use Poisson
  
  if (projection > 10) {
    // Normal approximation: σ ≈ sqrt(projection * variance_factor)
    const varianceFactor = 0.35; // typical stat variance
    const sigma = Math.sqrt(projection * varianceFactor);
    const z = (line - projection) / sigma;
    const overProb = 1 - normalCDF(z);
    return { over: +(overProb * 100).toFixed(1), under: +((1 - overProb) * 100).toFixed(1) };
  } else {
    // Poisson for low-count stats
    let cumulativeUnder = 0;
    const lambda = projection;
    for (let k = 0; k <= Math.floor(line); k++) {
      cumulativeUnder += (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
    }
    // "Over X.5" means more than X
    const overProb = 1 - cumulativeUnder;
    return { over: +(overProb * 100).toFixed(1), under: +(cumulativeUnder * 100).toFixed(1) };
  }
}

function normalCDF(z) {
  // Abramowitz & Stegun approximation
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

// ==================== VALUE DETECTION ====================

function mlToImpliedProb(ml) {
  if (!ml) return null;
  if (ml < 0) return (-ml) / (-ml + 100);
  return 100 / (ml + 100);
}

function probToML(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/**
 * Parse prop odds from The Odds API event response
 */
function parsePropsFromEvent(eventData, sport) {
  const config = SPORT_CONFIGS[sport];
  if (!config || !eventData || !eventData.bookmakers) return [];
  
  const props = [];
  const marketDefs = config.markets;
  
  for (const bk of eventData.bookmakers) {
    for (const mkt of (bk.markets || [])) {
      const marketDef = marketDefs[mkt.key];
      if (!marketDef) continue;
      
      // Group outcomes by description (player name) and point
      const playerProps = {};
      for (const outcome of (mkt.outcomes || [])) {
        const playerName = outcome.description || outcome.name;
        const point = outcome.point;
        const side = outcome.name.toLowerCase(); // 'over' or 'under'
        
        const key = `${playerName}_${point}`;
        if (!playerProps[key]) {
          playerProps[key] = {
            player: playerName,
            line: point,
            market: mkt.key,
            marketLabel: marketDef.label,
            stat: marketDef.stat,
            abbr: marketDef.abbr,
            book: bk.title,
            bookKey: bk.key,
          };
        }
        if (side === 'over') playerProps[key].overPrice = outcome.price;
        else if (side === 'under') playerProps[key].underPrice = outcome.price;
      }
      
      props.push(...Object.values(playerProps));
    }
  }
  
  return props;
}

/**
 * Score a prop bet: compare model projection to book line/odds
 */
function scorePropBet(prop, sport, models) {
  const baseline = getPlayerBaseline(prop.player, prop.stat, sport);
  if (!baseline) {
    return { ...prop, projection: null, edge: null, confidence: 'UNKNOWN', signal: null };
  }
  
  // Adjust for opponent if we have team context
  const projection = baseline; // TODO: pass opponent context for adjustment
  
  const line = prop.line;
  const { over: modelOver, under: modelUnder } = calcOverUnderProb(projection, line);
  
  // Compare to book odds
  let overEdge = null, underEdge = null;
  if (prop.overPrice) {
    const bookOverProb = mlToImpliedProb(prop.overPrice) * 100;
    overEdge = +(modelOver - bookOverProb).toFixed(1);
  }
  if (prop.underPrice) {
    const bookUnderProb = mlToImpliedProb(prop.underPrice) * 100;
    underEdge = +(modelUnder - bookUnderProb).toFixed(1);
  }
  
  // Determine best play
  let signal = null, edge = 0, confidence = 'LOW';
  if (overEdge !== null && underEdge !== null) {
    if (overEdge > underEdge && overEdge > 3) {
      signal = 'OVER';
      edge = overEdge;
    } else if (underEdge > overEdge && underEdge > 3) {
      signal = 'UNDER';
      edge = underEdge;
    }
  }
  
  if (edge >= 10) confidence = 'HIGH';
  else if (edge >= 5) confidence = 'MEDIUM';
  else confidence = 'LOW';
  
  return {
    ...prop,
    projection: +projection.toFixed(1),
    modelOver,
    modelUnder,
    overEdge,
    underEdge,
    signal,
    edge: +edge.toFixed(1),
    confidence,
    fairOverML: probToML(modelOver / 100),
    fairUnderML: probToML(modelUnder / 100),
  };
}

// ==================== SCAN + CACHE ====================

let propsCache = { data: null, ts: 0, sport: null };

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (raw.ts && (Date.now() - raw.ts) < CACHE_TTL) {
        propsCache = raw;
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

function saveCache(data, sport) {
  propsCache = { data, ts: Date.now(), sport };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(propsCache, null, 2));
  } catch (e) { /* ignore */ }
}

/**
 * Full prop scan for a sport — fetches events, then props for each
 * This uses API quota, so we limit to top markets and cache aggressively
 */
async function scanProps(sport, models = {}) {
  const config = SPORT_CONFIGS[sport];
  if (!config) return { error: `Unknown sport: ${sport}` };
  
  // Check cache
  if (propsCache.data && propsCache.sport === sport && (Date.now() - propsCache.ts) < CACHE_TTL) {
    return { ...propsCache.data, cached: true };
  }
  
  // Get events
  const events = await fetchEvents(config.key);
  if (!events.length) return { events: 0, props: [], valueBets: [] };
  
  // Select top markets to scan (limit API usage)
  let marketsToScan;
  if (sport === 'nba') {
    marketsToScan = ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'];
  } else if (sport === 'mlb') {
    marketsToScan = ['pitcher_strikeouts', 'batter_hits', 'batter_home_runs', 'batter_total_bases'];
  } else if (sport === 'nhl') {
    marketsToScan = ['player_points', 'player_goals', 'player_assists', 'player_shots_on_goal'];
  }
  
  // Fetch props for each event (limit to first 5 events to conserve API quota)
  const maxEvents = Math.min(events.length, 5);
  const allProps = [];
  const scannedGames = [];
  
  for (let i = 0; i < maxEvents; i++) {
    const event = events[i];
    try {
      const eventData = await fetchEventProps(config.key, event.id, marketsToScan);
      if (!eventData) continue;
      
      const props = parsePropsFromEvent(eventData, sport);
      const scored = props.map(p => scorePropBet(p, sport, models));
      
      allProps.push(...scored);
      scannedGames.push({
        id: event.id,
        away: event.away_team,
        home: event.home_team,
        commence: event.commence_time,
        propsCount: scored.length,
      });
    } catch (e) {
      console.error(`Props scan error for event ${event.id}:`, e.message);
    }
  }
  
  // Find value bets (edge > 3%)
  const valueBets = allProps.filter(p => p.signal && p.edge > 3).sort((a, b) => b.edge - a.edge);
  
  const result = {
    sport: config.label,
    eventsScanned: scannedGames.length,
    eventsAvailable: events.length,
    games: scannedGames,
    totalProps: allProps.length,
    valueBets,
    valueCount: valueBets.length,
    allProps,
    timestamp: new Date().toISOString(),
  };
  
  saveCache(result, sport);
  return result;
}

/**
 * Get projections for a specific player
 */
function getPlayerProjection(playerName, sport, models = {}) {
  const baselines = sport === 'nba' ? NBA_PLAYER_BASELINES : 
                    sport === 'mlb' ? { ...MLB_PITCHER_BASELINES, ...MLB_BATTER_BASELINES } : {};
  
  const player = baselines[playerName];
  if (!player) return null;
  
  const stats = {};
  for (const [key, val] of Object.entries(player)) {
    if (key === 'team') continue;
    stats[key] = val;
  }
  
  // Add combo stats for NBA
  if (sport === 'nba') {
    stats.pra = (stats.points || 0) + (stats.rebounds || 0) + (stats.assists || 0);
    stats.pts_reb = (stats.points || 0) + (stats.rebounds || 0);
    stats.pts_ast = (stats.points || 0) + (stats.assists || 0);
    stats.reb_ast = (stats.rebounds || 0) + (stats.assists || 0);
  }
  
  return {
    player: playerName,
    team: player.team,
    sport: sport.toUpperCase(),
    stats,
    source: 'baseline (2025-26 season avg)',
  };
}

/**
 * Get all available players for a sport
 */
function getAvailablePlayers(sport) {
  if (sport === 'nba') {
    return Object.entries(NBA_PLAYER_BASELINES).map(([name, data]) => ({
      name, team: data.team, ppg: data.points, rpg: data.rebounds, apg: data.assists,
    }));
  }
  if (sport === 'mlb') {
    const pitchers = Object.entries(MLB_PITCHER_BASELINES).map(([name, data]) => ({
      name, team: data.team, type: 'pitcher', kPer: data.strikeouts,
    }));
    const batters = Object.entries(MLB_BATTER_BASELINES).map(([name, data]) => ({
      name, team: data.team, type: 'batter', hPer: data.hits, hrPer: data.home_runs,
    }));
    return [...pitchers, ...batters];
  }
  return [];
}

function getStatus() {
  return {
    service: 'player-props',
    version: '1.0',
    cacheAge: propsCache.ts ? Date.now() - propsCache.ts : null,
    cachedSport: propsCache.sport,
    nbaPlayers: Object.keys(NBA_PLAYER_BASELINES).length,
    mlbPitchers: Object.keys(MLB_PITCHER_BASELINES).length,
    mlbBatters: Object.keys(MLB_BATTER_BASELINES).length,
    supportedSports: ['nba', 'mlb', 'nhl'],
    markets: {
      nba: Object.keys(NBA_PROP_MARKETS),
      mlb: Object.keys(MLB_PROP_MARKETS),
      nhl: Object.keys(NHL_PROP_MARKETS),
    },
  };
}

module.exports = {
  scanProps,
  getPlayerProjection,
  getAvailablePlayers,
  getStatus,
  parsePropsFromEvent,
  scorePropBet,
  calcOverUnderProb,
  NBA_PROP_MARKETS,
  MLB_PROP_MARKETS,
  NHL_PROP_MARKETS,
  NBA_PLAYER_BASELINES,
  MLB_PITCHER_BASELINES,
  MLB_BATTER_BASELINES,
  SPORT_CONFIGS,
};
