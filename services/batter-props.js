// services/batter-props.js — MLB Batter Props Model v78.0
// =======================================================
// Uses Statcast xBA/xSLG/xwOBA data for 651 batters to model:
//   - Hits (O/U 0.5, 1.5, 2.5)
//   - Home Runs (O/U 0.5)
//   - Total Bases (O/U 1.5, 2.5, 3.5)
//   - RBIs (O/U 0.5, 1.5)
//   - Runs Scored (O/U 0.5, 1.5)
//
// WHY THIS MATTERS: Batter props are the LARGEST prop market in MLB.
// Books price based on recent BA/SLG which are BABIP-noisy.
// Statcast xBA/xSLG are the TRUTH — batters outperforming xBA are due for regression.
// Batters underperforming xBA are underpriced. This is free money.
//
// Model:
//   1. Statcast baseline (xBA, xSLG, xwOBA) → expected per-AB rates
//   2. Pitcher matchup adjustment (pitcher's xBA-against, xwOBA-against)
//   3. Park factor adjustment (HR-friendly vs pitcher-friendly)
//   4. Platoon splits (L/R matchup)
//   5. Opening Day premium (rusty bats = slightly lower hit rates, higher K%)
//   6. Weather adjustment (cold = less power, wind = HR factor)
//   7. Poisson distribution for count props (0, 1, 2, 3+ hits)

const statcast = require('./statcast');
const mlbModel = require('../models/mlb');

// ==================== BATTER PROJECTIONS DATABASE ====================
// Top ~120 OD batters with Steamer/ZiPS projections for lineup positions
// Format: { team, pos, ba, xba, slg, xslg, hr, ab, hand, order }
// This is used when Statcast doesn't have a batter (rookies, minor changes)
// and for lineup ordering to know expected AB count on game day
const OD_BATTER_PROJECTIONS = {
  // ===== LAD =====
  'Shohei Ohtani':    { team: 'LAD', pos: 'DH', ba: 0.310, xba: 0.310, slg: 0.646, xslg: 0.672, hr: 54, ab: 596, hand: 'L', order: 1 },
  'Mookie Betts':     { team: 'LAD', pos: 'SS', ba: 0.281, xba: 0.290, slg: 0.462, xslg: 0.482, hr: 19, ab: 563, hand: 'R', order: 2 },
  'Freddie Freeman':  { team: 'LAD', pos: '1B', ba: 0.282, xba: 0.275, slg: 0.476, xslg: 0.460, hr: 22, ab: 602, hand: 'L', order: 3 },
  'Teoscar Hernandez':{ team: 'LAD', pos: 'RF', ba: 0.272, xba: 0.268, slg: 0.501, xslg: 0.485, hr: 33, ab: 561, hand: 'R', order: 4 },
  'Max Muncy':        { team: 'LAD', pos: '3B', ba: 0.232, xba: 0.248, slg: 0.439, xslg: 0.462, hr: 25, ab: 485, hand: 'L', order: 5 },
  'Tommy Edman':      { team: 'LAD', pos: 'CF', ba: 0.265, xba: 0.258, slg: 0.395, xslg: 0.380, hr: 11, ab: 505, hand: 'S', order: 6 },

  // ===== NYY =====
  'Aaron Judge':      { team: 'NYY', pos: 'CF', ba: 0.322, xba: 0.305, slg: 0.701, xslg: 0.700, hr: 58, ab: 527, hand: 'R', order: 2 },
  'Juan Soto':        { team: 'NYY', pos: 'LF', ba: 0.288, xba: 0.310, slg: 0.569, xslg: 0.655, hr: 41, ab: 531, hand: 'L', order: 1 },
  'Jazz Chisholm Jr': { team: 'NYY', pos: '3B', ba: 0.256, xba: 0.250, slg: 0.455, xslg: 0.440, hr: 24, ab: 529, hand: 'L', order: 3 },
  'Giancarlo Stanton':{ team: 'NYY', pos: 'DH', ba: 0.233, xba: 0.245, slg: 0.475, xslg: 0.500, hr: 27, ab: 378, hand: 'R', order: 4 },
  'Anthony Volpe':    { team: 'NYY', pos: 'SS', ba: 0.252, xba: 0.248, slg: 0.364, xslg: 0.370, hr: 12, ab: 607, hand: 'R', order: 5 },

  // ===== ATL =====
  'Ronald Acuna Jr':  { team: 'ATL', pos: 'RF', ba: 0.217, xba: 0.240, slg: 0.336, xslg: 0.390, hr: 6, ab: 203, hand: 'R', order: 1 },
  'Ozzie Albies':     { team: 'ATL', pos: '2B', ba: 0.258, xba: 0.260, slg: 0.444, xslg: 0.430, hr: 19, ab: 555, hand: 'S', order: 2 },
  'Matt Olson':       { team: 'ATL', pos: '1B', ba: 0.245, xba: 0.256, slg: 0.431, xslg: 0.460, hr: 29, ab: 604, hand: 'L', order: 3 },
  'Marcell Ozuna':    { team: 'ATL', pos: 'DH', ba: 0.302, xba: 0.282, slg: 0.558, xslg: 0.530, hr: 39, ab: 574, hand: 'R', order: 4 },
  'Austin Riley':     { team: 'ATL', pos: '3B', ba: 0.245, xba: 0.258, slg: 0.420, xslg: 0.445, hr: 20, ab: 400, hand: 'R', order: 5 },

  // ===== HOU =====
  'Jose Altuve':      { team: 'HOU', pos: '2B', ba: 0.295, xba: 0.285, slg: 0.429, xslg: 0.415, hr: 16, ab: 568, hand: 'R', order: 1 },
  'Yordan Alvarez':   { team: 'HOU', pos: 'DH', ba: 0.308, xba: 0.300, slg: 0.564, xslg: 0.570, hr: 35, ab: 533, hand: 'L', order: 2 },
  'Alex Bregman':     { team: 'HOU', pos: '3B', ba: 0.260, xba: 0.268, slg: 0.422, xslg: 0.435, hr: 26, ab: 577, hand: 'R', order: 3 },
  'Kyle Tucker':      { team: 'HOU', pos: 'RF', ba: 0.289, xba: 0.292, slg: 0.512, xslg: 0.520, hr: 23, ab: 364, hand: 'L', order: 4 },

  // ===== PHI =====
  'Kyle Schwarber':   { team: 'PHI', pos: 'DH', ba: 0.250, xba: 0.260, slg: 0.504, xslg: 0.520, hr: 38, ab: 527, hand: 'L', order: 1 },
  'Trea Turner':      { team: 'PHI', pos: 'SS', ba: 0.295, xba: 0.288, slg: 0.471, xslg: 0.455, hr: 21, ab: 569, hand: 'R', order: 2 },
  'Bryce Harper':     { team: 'PHI', pos: '1B', ba: 0.285, xba: 0.290, slg: 0.520, xslg: 0.540, hr: 30, ab: 520, hand: 'L', order: 3 },
  'Nick Castellanos': { team: 'PHI', pos: 'RF', ba: 0.276, xba: 0.270, slg: 0.435, xslg: 0.425, hr: 23, ab: 602, hand: 'R', order: 4 },

  // ===== SD =====
  'Fernando Tatis Jr':{ team: 'SD', pos: 'RF', ba: 0.273, xba: 0.278, slg: 0.512, xslg: 0.520, hr: 27, ab: 481, hand: 'R', order: 1 },
  'Manny Machado':    { team: 'SD', pos: '3B', ba: 0.275, xba: 0.270, slg: 0.475, xslg: 0.465, hr: 28, ab: 599, hand: 'R', order: 3 },
  'Xander Bogaerts':  { team: 'SD', pos: 'SS', ba: 0.255, xba: 0.260, slg: 0.380, xslg: 0.395, hr: 12, ab: 400, hand: 'R', order: 4 },

  // ===== DET =====
  'Riley Greene':     { team: 'DET', pos: 'CF', ba: 0.262, xba: 0.268, slg: 0.430, xslg: 0.445, hr: 24, ab: 575, hand: 'L', order: 1 },
  'Colt Keith':       { team: 'DET', pos: '2B', ba: 0.260, xba: 0.255, slg: 0.390, xslg: 0.400, hr: 12, ab: 585, hand: 'L', order: 2 },
  'Matt Vierling':    { team: 'DET', pos: 'RF', ba: 0.258, xba: 0.252, slg: 0.425, xslg: 0.415, hr: 18, ab: 550, hand: 'R', order: 4 },
  'Spencer Torkelson':{ team: 'DET', pos: '1B', ba: 0.229, xba: 0.240, slg: 0.380, xslg: 0.400, hr: 15, ab: 440, hand: 'R', order: 5 },

  // ===== BOS =====
  'Jarren Duran':     { team: 'BOS', pos: 'CF', ba: 0.285, xba: 0.267, slg: 0.492, xslg: 0.456, hr: 21, ab: 616, hand: 'L', order: 1 },
  'Rafael Devers':    { team: 'BOS', pos: '3B', ba: 0.272, xba: 0.278, slg: 0.500, xslg: 0.510, hr: 28, ab: 559, hand: 'L', order: 3 },
  'Masataka Yoshida': { team: 'BOS', pos: 'DH', ba: 0.280, xba: 0.285, slg: 0.420, xslg: 0.430, hr: 12, ab: 450, hand: 'L', order: 5 },

  // ===== BAL =====
  'Gunnar Henderson':  { team: 'BAL', pos: 'SS', ba: 0.281, xba: 0.279, slg: 0.529, xslg: 0.499, hr: 37, ab: 574, hand: 'L', order: 1 },
  'Adley Rutschman':   { team: 'BAL', pos: 'C',  ba: 0.255, xba: 0.262, slg: 0.430, xslg: 0.445, hr: 20, ab: 546, hand: 'S', order: 2 },
  'Anthony Santander': { team: 'BAL', pos: 'RF', ba: 0.235, xba: 0.248, slg: 0.506, xslg: 0.520, hr: 44, ab: 576, hand: 'S', order: 3 },
  'Pete Alonso':       { team: 'BAL', pos: '1B', ba: 0.240, xba: 0.250, slg: 0.459, xslg: 0.470, hr: 34, ab: 560, hand: 'R', order: 4 },

  // ===== SEA =====
  'Julio Rodriguez':   { team: 'SEA', pos: 'CF', ba: 0.260, xba: 0.265, slg: 0.410, xslg: 0.425, hr: 18, ab: 536, hand: 'R', order: 1 },
  'Cal Raleigh':       { team: 'SEA', pos: 'C',  ba: 0.232, xba: 0.240, slg: 0.468, xslg: 0.480, hr: 34, ab: 533, hand: 'S', order: 3 },

  // ===== CLE =====
  'Jose Ramirez':      { team: 'CLE', pos: '3B', ba: 0.279, xba: 0.275, slg: 0.489, xslg: 0.480, hr: 39, ab: 604, hand: 'S', order: 1 },
  'Steven Kwan':       { team: 'CLE', pos: 'LF', ba: 0.292, xba: 0.290, slg: 0.390, xslg: 0.385, hr: 7, ab: 567, hand: 'L', order: 2 },

  // ===== MIN =====
  'Carlos Correa':     { team: 'MIN', pos: 'SS', ba: 0.310, xba: 0.295, slg: 0.470, xslg: 0.460, hr: 18, ab: 455, hand: 'R', order: 1 },
  'Byron Buxton':      { team: 'MIN', pos: 'CF', ba: 0.259, xba: 0.265, slg: 0.475, xslg: 0.490, hr: 26, ab: 382, hand: 'R', order: 3 },
  'Ryan Jeffers':      { team: 'MIN', pos: 'C',  ba: 0.240, xba: 0.245, slg: 0.418, xslg: 0.430, hr: 20, ab: 390, hand: 'R', order: 5 },

  // ===== CIN =====
  'Elly De La Cruz':   { team: 'CIN', pos: 'SS', ba: 0.242, xba: 0.248, slg: 0.425, xslg: 0.440, hr: 25, ab: 582, hand: 'S', order: 1 },
  'Spencer Steer':     { team: 'CIN', pos: '3B', ba: 0.268, xba: 0.270, slg: 0.440, xslg: 0.445, hr: 23, ab: 556, hand: 'R', order: 3 },

  // ===== MIL =====
  'William Contreras': { team: 'MIL', pos: 'C',  ba: 0.280, xba: 0.272, slg: 0.466, xslg: 0.450, hr: 23, ab: 540, hand: 'R', order: 2 },
  'Willy Adames':      { team: 'MIL', pos: 'SS', ba: 0.251, xba: 0.258, slg: 0.462, xslg: 0.475, hr: 32, ab: 575, hand: 'R', order: 1 },

  // ===== TEX =====
  'Corey Seager':      { team: 'TEX', pos: 'SS', ba: 0.268, xba: 0.275, slg: 0.480, xslg: 0.495, hr: 28, ab: 520, hand: 'L', order: 2 },
  'Marcus Semien':     { team: 'TEX', pos: '2B', ba: 0.237, xba: 0.251, slg: 0.391, xslg: 0.406, hr: 23, ab: 610, hand: 'R', order: 1 },
  'Wyatt Langford':    { team: 'TEX', pos: 'LF', ba: 0.247, xba: 0.250, slg: 0.388, xslg: 0.400, hr: 12, ab: 450, hand: 'R', order: 5 },

  // ===== CHC =====
  'Ian Happ':          { team: 'CHC', pos: 'LF', ba: 0.240, xba: 0.250, slg: 0.436, xslg: 0.450, hr: 25, ab: 518, hand: 'S', order: 1 },
  'Dansby Swanson':    { team: 'CHC', pos: 'SS', ba: 0.244, xba: 0.252, slg: 0.404, xslg: 0.415, hr: 17, ab: 543, hand: 'R', order: 2 },
  'Seiya Suzuki':      { team: 'CHC', pos: 'RF', ba: 0.283, xba: 0.278, slg: 0.485, xslg: 0.475, hr: 21, ab: 493, hand: 'R', order: 3 },
  'Cody Bellinger':    { team: 'CHC', pos: 'CF', ba: 0.265, xba: 0.270, slg: 0.426, xslg: 0.435, hr: 18, ab: 505, hand: 'L', order: 4 },

  // ===== SF =====
  'Matt Chapman':      { team: 'SF', pos: '3B', ba: 0.247, xba: 0.252, slg: 0.448, xslg: 0.455, hr: 27, ab: 558, hand: 'R', order: 2 },
  'Jung Hoo Lee':      { team: 'SF', pos: 'CF', ba: 0.262, xba: 0.268, slg: 0.370, xslg: 0.385, hr: 5, ab: 250, hand: 'L', order: 1 },
  'Willy Flores':      { team: 'SF', pos: '1B', ba: 0.270, xba: 0.265, slg: 0.430, xslg: 0.420, hr: 14, ab: 380, hand: 'R', order: 4 },

  // ===== NYM =====
  'Francisco Lindor':  { team: 'NYM', pos: 'SS', ba: 0.273, xba: 0.270, slg: 0.500, xslg: 0.490, hr: 33, ab: 599, hand: 'S', order: 1 },
  'Brandon Nimmo':     { team: 'NYM', pos: 'CF', ba: 0.224, xba: 0.242, slg: 0.398, xslg: 0.420, hr: 23, ab: 541, hand: 'L', order: 3 },
  'Mark Vientos':      { team: 'NYM', pos: '3B', ba: 0.280, xba: 0.272, slg: 0.522, xslg: 0.510, hr: 27, ab: 422, hand: 'R', order: 4 },
  'Jesse Winker':      { team: 'NYM', pos: 'LF', ba: 0.253, xba: 0.260, slg: 0.422, xslg: 0.435, hr: 16, ab: 400, hand: 'L', order: 5 },

  // ===== PIT =====
  'Bryan Reynolds':    { team: 'PIT', pos: 'CF', ba: 0.275, xba: 0.272, slg: 0.462, xslg: 0.455, hr: 24, ab: 573, hand: 'S', order: 2 },
  'Ke\'Bryan Hayes':   { team: 'PIT', pos: '3B', ba: 0.241, xba: 0.250, slg: 0.360, xslg: 0.375, hr: 10, ab: 490, hand: 'R', order: 5 },
  'Oneil Cruz':        { team: 'PIT', pos: 'SS', ba: 0.252, xba: 0.255, slg: 0.467, xslg: 0.475, hr: 21, ab: 500, hand: 'L', order: 1 },

  // ===== TB =====
  'Yandy Diaz':        { team: 'TB', pos: '1B', ba: 0.280, xba: 0.285, slg: 0.398, xslg: 0.405, hr: 14, ab: 570, hand: 'R', order: 1 },
  'Josh Lowe':         { team: 'TB', pos: 'LF', ba: 0.263, xba: 0.258, slg: 0.448, xslg: 0.440, hr: 20, ab: 532, hand: 'L', order: 3 },

  // ===== KC =====
  'Bobby Witt Jr':     { team: 'KC', pos: 'SS', ba: 0.332, xba: 0.310, slg: 0.588, xslg: 0.560, hr: 32, ab: 636, hand: 'R', order: 1 },
  'Salvador Perez':    { team: 'KC', pos: 'C',  ba: 0.271, xba: 0.265, slg: 0.467, xslg: 0.455, hr: 27, ab: 562, hand: 'R', order: 3 },
  'Vinnie Pasquantino':{ team: 'KC', pos: '1B', ba: 0.262, xba: 0.268, slg: 0.445, xslg: 0.455, hr: 19, ab: 540, hand: 'L', order: 4 },

  // ===== STL =====
  'Nolan Arenado':     { team: 'STL', pos: '3B', ba: 0.272, xba: 0.268, slg: 0.432, xslg: 0.425, hr: 16, ab: 521, hand: 'R', order: 3 },
  'Masyn Winn':        { team: 'STL', pos: 'SS', ba: 0.270, xba: 0.265, slg: 0.405, xslg: 0.400, hr: 12, ab: 582, hand: 'R', order: 1 },

  // ===== ARI =====
  'Ketel Marte':       { team: 'ARI', pos: '2B', ba: 0.290, xba: 0.285, slg: 0.535, xslg: 0.520, hr: 33, ab: 562, hand: 'S', order: 1 },
  'Corbin Carroll':    { team: 'ARI', pos: 'CF', ba: 0.223, xba: 0.235, slg: 0.357, xslg: 0.380, hr: 12, ab: 567, hand: 'L', order: 2 },
  'Joc Pederson':      { team: 'ARI', pos: 'DH', ba: 0.252, xba: 0.258, slg: 0.505, xslg: 0.510, hr: 23, ab: 390, hand: 'L', order: 5 },

  // ===== TOR =====
  'Vladimir Guerrero Jr':{ team: 'TOR', pos: '1B', ba: 0.323, xba: 0.312, slg: 0.544, xslg: 0.535, hr: 30, ab: 604, hand: 'R', order: 1 },
  'Bo Bichette':        { team: 'TOR', pos: 'SS', ba: 0.225, xba: 0.240, slg: 0.322, xslg: 0.350, hr: 4, ab: 341, hand: 'R', order: 2 },
  'George Springer':    { team: 'TOR', pos: 'DH', ba: 0.220, xba: 0.235, slg: 0.392, xslg: 0.410, hr: 18, ab: 430, hand: 'R', order: 3 },

  // ===== WSH =====
  'CJ Abrams':         { team: 'WSH', pos: 'SS', ba: 0.240, xba: 0.248, slg: 0.380, xslg: 0.395, hr: 20, ab: 578, hand: 'L', order: 1 },
  'James Wood':        { team: 'WSH', pos: 'CF', ba: 0.258, xba: 0.262, slg: 0.410, xslg: 0.425, hr: 10, ab: 340, hand: 'L', order: 2 },

  // ===== COL =====
  'Ezequiel Tovar':    { team: 'COL', pos: 'SS', ba: 0.268, xba: 0.255, slg: 0.424, xslg: 0.405, hr: 20, ab: 546, hand: 'R', order: 1 },
  'Brenton Doyle':     { team: 'COL', pos: 'CF', ba: 0.260, xba: 0.252, slg: 0.432, xslg: 0.420, hr: 24, ab: 546, hand: 'R', order: 2 },

  // ===== MIA =====
  'Jazz Chisholm':     { team: 'MIA', pos: 'SS', ba: 0.248, xba: 0.255, slg: 0.415, xslg: 0.425, hr: 15, ab: 380, hand: 'L', order: 1 },

  // ===== OAK =====
  'Brent Rooker':      { team: 'OAK', pos: 'DH', ba: 0.293, xba: 0.280, slg: 0.539, xslg: 0.525, hr: 30, ab: 458, hand: 'R', order: 2 },
  'Lawrence Butler':   { team: 'OAK', pos: 'LF', ba: 0.244, xba: 0.250, slg: 0.432, xslg: 0.440, hr: 22, ab: 540, hand: 'L', order: 3 },
};

// ==================== PARK HR FACTORS ====================
// HR-specific park factors (separate from run factors — some parks boost HR but not total runs)
const PARK_HR_FACTORS = {
  'Great American Ball Park': 1.25, // GABP is HR heaven
  'Coors Field': 1.20,              // Thin air + HR carry
  'Yankee Stadium': 1.15,           // Short RF porch
  'Citizens Bank Park': 1.10,       // Hitter-friendly
  'Globe Life Field': 1.08,         // Warm, carry
  'Wrigley Field': 1.05,            // Wind out = HR, wind in = suppressed
  'Camden Yards': 1.05,             // Shortened LF 2022+
  'Fenway Park': 1.03,              // Green Monster giveth
  'Chase Field': 1.03,              // Dry air
  'American Family Field': 1.02,    // Neutral-slight HR boost
  'Minute Maid Park': 1.02,         // Crawford boxes
  'Rogers Centre': 1.01,            // Dome, turf carry
  'Guaranteed Rate Field': 1.01,    // Neutral
  'Target Field': 1.00,             // Neutral
  'Busch Stadium': 1.00,            // Neutral
  'Nationals Park': 0.99,           // Slightly pitcher-leaning
  'Kauffman Stadium': 0.98,         // Big outfield
  'Truist Park': 0.98,              // Neutral-slight suppressor
  'PNC Park': 0.97,                 // Big park
  'Comerica Park': 0.96,            // Deep CF/RF, suppresses HR
  'Citi Field': 0.95,               // Pitcher park
  'Progressive Field': 0.96,        // Deep CF
  'Dodger Stadium': 0.96,           // Marine layer, night suppression
  'LoanDepot Park': 0.94,           // Pitcher park
  'T-Mobile Park': 0.93,            // Marine layer, pitcher park
  'Petco Park': 0.92,               // Elite pitcher park
  'Oracle Park': 0.90,              // Marine layer = HR graveyard
  'Tropicana Field': 0.95,          // Dome, catwalks absorb some
  'Coliseum': 0.94,                 // Foul territory + marine layer
};

// Team → Park name mapping
const TEAM_PARKS = {
  'ARI': 'Chase Field', 'ATL': 'Truist Park', 'BAL': 'Camden Yards', 'BOS': 'Fenway Park',
  'CHC': 'Wrigley Field', 'CIN': 'Great American Ball Park', 'CLE': 'Progressive Field',
  'COL': 'Coors Field', 'CWS': 'Guaranteed Rate Field', 'DET': 'Comerica Park',
  'HOU': 'Minute Maid Park', 'KC': 'Kauffman Stadium', 'LAA': 'Angel Stadium',
  'LAD': 'Dodger Stadium', 'MIA': 'LoanDepot Park', 'MIL': 'American Family Field',
  'MIN': 'Target Field', 'NYM': 'Citi Field', 'NYY': 'Yankee Stadium', 'OAK': 'Coliseum',
  'PHI': 'Citizens Bank Park', 'PIT': 'PNC Park', 'SD': 'Petco Park', 'SF': 'Oracle Park',
  'SEA': 'T-Mobile Park', 'STL': 'Busch Stadium', 'TB': 'Tropicana Field',
  'TEX': 'Globe Life Field', 'TOR': 'Rogers Centre', 'WSH': 'Nationals Park',
};

const DOME_PARKS = new Set([
  'Tropicana Field', 'Globe Life Field', 'Minute Maid Park', 'Chase Field',
  'Rogers Centre', 'LoanDepot Park', 'American Family Field',
]);

// ==================== LEAGUE BASELINES ====================
const LG_AVG = {
  ba: 0.248,    // 2024 MLB league average
  slg: 0.397,
  obp: 0.312,
  woba: 0.315,
  xba: 0.248,
  xslg: 0.397,
  xwoba: 0.315,
  hrPerAB: 0.033,  // ~1 HR per 30 AB
  abPerGame: 4.1,  // average AB per game for a starter
};

// ==================== PITCHER K-RATE EFFECT ON CONTACT ====================
// Pitchers with high K rates suppress hit probability (fewer balls in play)
// Pitchers with low K rates allow more contact = higher hit probability
const PITCHER_K9_EFFECT_ON_HITS = {
  // K/9 tier → hit rate multiplier (more Ks = less contact = fewer hits)
  // This is because hits require balls in play, and high-K pitchers reduce BIP
  high:   0.90,  // K/9 >= 10.0: 10% fewer hits vs league avg
  above:  0.95,  // K/9 >= 9.0: 5% fewer hits
  average: 1.00, // K/9 7.5-9.0: league average
  below:  1.05,  // K/9 6.5-7.5: 5% more hits
  low:    1.10,  // K/9 < 6.5: 10% more hits (lots of contact)
};

// ==================== CORE PREDICTION FUNCTIONS ====================

/**
 * Get batter's Statcast data — prioritize cached Savant data, fallback to OD projections
 */
function getBatterData(batterName) {
  // Try Statcast cache first (real Savant data for 651 batters)
  const batters = statcast.cachedBatters;
  if (batters && batters[batterName]) {
    const sc = batters[batterName];
    return {
      name: batterName,
      source: 'statcast',
      ba: sc.ba,
      xba: sc.xba,
      slg: sc.slg,
      xslg: sc.xslg,
      woba: sc.woba,
      xwoba: sc.xwoba,
      baLuck: sc.baLuck,
      slgLuck: sc.slgLuck,
      wobaLuck: sc.wobaLuck,
      pa: sc.pa,
    };
  }

  // Fallback to OD projections
  const proj = OD_BATTER_PROJECTIONS[batterName];
  if (proj) {
    return {
      name: batterName,
      source: 'projection',
      ba: proj.ba,
      xba: proj.xba,
      slg: proj.slg,
      xslg: proj.xslg,
      woba: (proj.xba * 0.9 + (proj.xslg - proj.xba) * 0.5 + 0.05), // approximate wOBA
      xwoba: (proj.xba * 0.9 + (proj.xslg - proj.xba) * 0.5 + 0.05),
      baLuck: (proj.ba - proj.xba),
      slgLuck: (proj.slg - proj.xslg),
      wobaLuck: 0,
      pa: proj.ab * 1.12, // approx PA from AB
    };
  }

  return null;
}

/**
 * Get pitcher K/9 tier for hit suppression calculation
 */
function getPitcherK9Effect(pitcherName) {
  let k9 = null;
  try {
    const kProps = require('./pitcher-k-props');
    const data = kProps.STEAMER_K9_PROJECTIONS || {};
    if (data[pitcherName]) k9 = data[pitcherName].k9;
  } catch (e) { /* fallback */ }

  if (!k9) k9 = 8.6; // league average

  if (k9 >= 10.0) return { tier: 'high', mult: PITCHER_K9_EFFECT_ON_HITS.high, k9 };
  if (k9 >= 9.0) return { tier: 'above', mult: PITCHER_K9_EFFECT_ON_HITS.above, k9 };
  if (k9 >= 7.5) return { tier: 'average', mult: PITCHER_K9_EFFECT_ON_HITS.average, k9 };
  if (k9 >= 6.5) return { tier: 'below', mult: PITCHER_K9_EFFECT_ON_HITS.below, k9 };
  return { tier: 'low', mult: PITCHER_K9_EFFECT_ON_HITS.low, k9 };
}

/**
 * Get pitcher handedness for platoon split adjustments
 */
function getPitcherHand(pitcherName) {
  try {
    const kProps = require('./pitcher-k-props');
    const data = kProps.STEAMER_K9_PROJECTIONS || {};
    if (data[pitcherName]) return data[pitcherName].hand;
  } catch (e) { /* fallback */ }
  return 'R'; // default
}

/**
 * Calculate platoon split multiplier for batter vs pitcher
 * L vs L = suppressed. R vs L = boosted. L vs R = boosted. R vs R = slightly suppressed.
 */
function getPlatoonHitMult(batterHand, pitcherHand) {
  if (batterHand === 'S') return 1.00; // switch hitters are platoon-immune
  if (batterHand === 'L' && pitcherHand === 'L') return 0.88; // same-side = tough
  if (batterHand === 'R' && pitcherHand === 'L') return 1.06; // opposite = advantage
  if (batterHand === 'L' && pitcherHand === 'R') return 1.03; // slight advantage
  if (batterHand === 'R' && pitcherHand === 'R') return 0.97; // slight disadvantage
  return 1.00;
}

/**
 * Predict batter props for a single batter in a specific game context
 * @param {string} batterName - Full name
 * @param {string} pitcherName - Opposing starting pitcher
 * @param {string} homeTeam - Home team abbreviation (for park)
 * @param {object} options - { isOpeningDay, tempF, isDome, batterHand }
 * @returns {object} Full batter prop prediction with all markets
 */
function predictBatterProps(batterName, pitcherName, homeTeam, options = {}) {
  const { isOpeningDay = true, tempF = null, isDome = false, wind = null } = options;

  const batter = getBatterData(batterName);
  if (!batter) return null;

  const proj = OD_BATTER_PROJECTIONS[batterName] || {};
  const batterHand = options.batterHand || proj.hand || 'R';
  const pitcherHand = getPitcherHand(pitcherName);
  const pitcherK = getPitcherK9Effect(pitcherName);
  const park = TEAM_PARKS[homeTeam] || 'Unknown';
  const parkRunFactor = mlbModel.PARK_FACTORS ? (mlbModel.PARK_FACTORS[park] || 1.0) : 1.0;
  const parkHRFactor = PARK_HR_FACTORS[park] || 1.0;

  // --- BASE RATES ---
  // Use xBA as the primary hit rate (more predictive than BA)
  // Blend: 70% xBA + 30% BA (xBA is truth but BA has some real signal)
  const baseHitRate = batter.xba * 0.70 + batter.ba * 0.30;

  // HR rate from SLG and xSLG — isolate ISO (SLG - BA) for power
  const baseISO = (batter.xslg * 0.70 + batter.slg * 0.30) - baseHitRate;
  const baseHRRate = proj.hr && proj.ab ? (proj.hr / proj.ab) :
    Math.max(0.005, baseISO * 0.25); // approx: ~25% of ISO comes from HR

  // Total bases rate per AB (from SLG which IS total bases per AB)
  const baseTBRate = batter.xslg * 0.70 + batter.slg * 0.30;

  // RBI rate — approximated from slugging + run production context
  // Higher xwOBA = more run production opportunities
  const baseRBIRate = ((batter.xwoba || batter.woba || LG_AVG.woba) - 0.200) * 0.45;

  // Runs scored rate — correlates with OBP/speed
  const baseRunRate = (baseHitRate + 0.08) * 0.35; // rough: (OBP-ish) * base-running factor

  // --- ADJUSTMENTS ---
  let hitMult = 1.0;
  let hrMult = 1.0;
  let tbMult = 1.0;
  let rbiMult = 1.0;
  let runMult = 1.0;
  const adjustments = [];

  // 1. Pitcher K rate effect (high-K pitcher = fewer hits)
  hitMult *= pitcherK.mult;
  if (pitcherK.tier !== 'average') {
    adjustments.push(`Pitcher K rate (${pitcherK.k9} K/9, ${pitcherK.tier}): ${((pitcherK.mult - 1) * 100).toFixed(0)}% hit adj`);
  }

  // 2. Platoon splits
  const platoonMult = getPlatoonHitMult(batterHand, pitcherHand);
  hitMult *= platoonMult;
  // Platoon affects power even more than contact
  hrMult *= (platoonMult < 1 ? platoonMult * 0.9 : platoonMult * 1.1); // amplified for HR
  tbMult *= platoonMult;
  if (Math.abs(platoonMult - 1) > 0.01) {
    const side = platoonMult > 1 ? 'PLATOON ADV' : 'PLATOON DIS';
    adjustments.push(`${side}: ${batterHand} vs ${pitcherHand}HP = ${((platoonMult - 1) * 100).toFixed(0)}%`);
  }

  // 3. Park factor
  hitMult *= Math.pow(parkRunFactor, 0.3); // park has modest effect on hits
  hrMult *= parkHRFactor;
  tbMult *= Math.pow(parkRunFactor, 0.5); // moderate effect on total bases
  rbiMult *= Math.pow(parkRunFactor, 0.6); // stronger effect on RBI (more runs = more RBI)
  runMult *= Math.pow(parkRunFactor, 0.6);
  if (Math.abs(parkRunFactor - 1) > 0.02) {
    adjustments.push(`Park: ${park} (${parkRunFactor.toFixed(2)}x runs, ${parkHRFactor.toFixed(2)}x HR)`);
  }

  // 4. Opening Day premium (rusty bats = lower contact, higher Ks)
  if (isOpeningDay) {
    hitMult *= 0.94; // 6% hit suppression on OD (cold bats, ace starters, first game)
    hrMult *= 0.92;  // 8% HR suppression (timing not sharp yet)
    tbMult *= 0.93;
    rbiMult *= 0.92;
    runMult *= 0.92;
    adjustments.push('Opening Day: -6% hits, -8% HR (rusty bats, aces starting)');
  }

  // 5. Weather adjustments
  if (tempF && !isDome) {
    if (tempF < 45) {
      const coldPenalty = 1 - (45 - tempF) * 0.004; // up to ~8% suppression at 25°F
      hitMult *= coldPenalty;
      hrMult *= coldPenalty * 0.95; // HR hurt even more by cold
      tbMult *= coldPenalty;
      adjustments.push(`Cold weather: ${tempF}°F = ${((coldPenalty - 1) * 100).toFixed(1)}% hit suppression`);
    }
    if (tempF > 85) {
      const heatBoost = 1 + (tempF - 85) * 0.002; // slight boost in heat
      hrMult *= heatBoost;
      tbMult *= heatBoost;
      adjustments.push(`Hot weather: ${tempF}°F = +${((heatBoost - 1) * 100).toFixed(1)}% power boost`);
    }
  }

  // 6. Wind adjustment (for HR specifically)
  if (wind && !isDome) {
    if (wind.direction === 'out' && wind.speed > 10) {
      const windBoost = 1 + (wind.speed - 10) * 0.008;
      hrMult *= windBoost;
      tbMult *= Math.pow(windBoost, 0.5);
      adjustments.push(`Wind out ${wind.speed}mph: +${((windBoost - 1) * 100).toFixed(1)}% HR boost`);
    }
    if (wind.direction === 'in' && wind.speed > 10) {
      const windPenalty = 1 - (wind.speed - 10) * 0.006;
      hrMult *= windPenalty;
      adjustments.push(`Wind in ${wind.speed}mph: ${((windPenalty - 1) * 100).toFixed(1)}% HR suppression`);
    }
  }

  // --- EXPECTED VALUES PER AB ---
  const expectedAB = proj.ab ? (proj.ab / 162) : LG_AVG.abPerGame; // ~4.0-4.2 AB per game
  const adjHitRate = baseHitRate * hitMult;
  const adjHRRate = baseHRRate * hrMult;
  const adjTBRate = baseTBRate * tbMult;
  const adjRBIRate = baseRBIRate * rbiMult;
  const adjRunRate = baseRunRate * runMult;

  // Expected counts for the game
  const expectedHits = adjHitRate * expectedAB;
  const expectedHR = adjHRRate * expectedAB;
  const expectedTB = adjTBRate * expectedAB;
  const expectedRBI = adjRBIRate * expectedAB;
  const expectedRuns = adjRunRate * expectedAB;

  // --- POISSON PROBABILITIES ---
  // Use Poisson distribution for discrete count props
  const hitProbs = poissonDist(expectedHits, 5); // P(0), P(1), P(2), P(3), P(4), P(5+)
  const hrProbs = poissonDist(expectedHR, 3);
  const tbProbs = poissonDist(expectedTB, 8);
  const rbiProbs = poissonDist(expectedRBI, 5);
  const runProbs = poissonDist(expectedRuns, 4);

  // --- MARKET LINES & VALUE ---
  const markets = {};

  // Hits O/U 0.5
  markets.hits_0_5 = buildMarket('Hits', 0.5, expectedHits, hitProbs, 
    1 - hitProbs[0], hitProbs[0]);
  // Hits O/U 1.5
  markets.hits_1_5 = buildMarket('Hits', 1.5, expectedHits, hitProbs,
    1 - hitProbs[0] - hitProbs[1], hitProbs[0] + hitProbs[1]);
  // Hits O/U 2.5
  markets.hits_2_5 = buildMarket('Hits', 2.5, expectedHits, hitProbs,
    1 - hitProbs[0] - hitProbs[1] - hitProbs[2], hitProbs[0] + hitProbs[1] + hitProbs[2]);

  // HR O/U 0.5
  markets.hr_0_5 = buildMarket('Home Runs', 0.5, expectedHR, hrProbs,
    1 - hrProbs[0], hrProbs[0]);

  // Total Bases O/U 0.5
  markets.tb_0_5 = buildMarket('Total Bases', 0.5, expectedTB, tbProbs,
    1 - tbProbs[0], tbProbs[0]);
  // Total Bases O/U 1.5
  markets.tb_1_5 = buildMarket('Total Bases', 1.5, expectedTB, tbProbs,
    1 - tbProbs[0] - tbProbs[1], tbProbs[0] + tbProbs[1]);
  // Total Bases O/U 2.5
  markets.tb_2_5 = buildMarket('Total Bases', 2.5, expectedTB, tbProbs,
    sumProbs(tbProbs, 3), 1 - sumProbs(tbProbs, 3));

  // RBI O/U 0.5
  markets.rbi_0_5 = buildMarket('RBIs', 0.5, expectedRBI, rbiProbs,
    1 - rbiProbs[0], rbiProbs[0]);
  // RBI O/U 1.5
  markets.rbi_1_5 = buildMarket('RBIs', 1.5, expectedRBI, rbiProbs,
    1 - rbiProbs[0] - rbiProbs[1], rbiProbs[0] + rbiProbs[1]);

  // Runs O/U 0.5
  markets.runs_0_5 = buildMarket('Runs', 0.5, expectedRuns, runProbs,
    1 - runProbs[0], runProbs[0]);

  // Luck indicator: is batter overperforming xBA? (fade) or underperforming? (back)
  const luckSignal = batter.baLuck > 0.015 ? 'OVERPERFORMING — fade hit props' :
    batter.baLuck < -0.015 ? 'UNDERPERFORMING — back hit props' : 'NEUTRAL';

  // Confidence grade
  const dataQuality = batter.source === 'statcast' ? 'HIGH' : 'MEDIUM';
  const paConfidence = (batter.pa || 0) >= 400 ? 'HIGH' : (batter.pa || 0) >= 200 ? 'MEDIUM' : 'LOW';

  return {
    batter: batterName,
    team: proj.team || 'UNK',
    position: proj.pos || 'UNK',
    order: proj.order || null,
    hand: batterHand,
    pitcher: pitcherName,
    pitcherHand,
    pitcherK9: pitcherK.k9,
    park,
    parkRunFactor: +parkRunFactor.toFixed(2),
    parkHRFactor: +(PARK_HR_FACTORS[park] || 1.0).toFixed(2),
    source: batter.source,
    dataQuality,
    paConfidence,

    // Statcast truth
    statcast: {
      ba: batter.ba,
      xba: batter.xba,
      slg: batter.slg,
      xslg: batter.xslg,
      woba: batter.woba,
      xwoba: batter.xwoba,
      baLuck: +(batter.baLuck || 0).toFixed(3),
      luckSignal,
    },

    // Expected counts
    expectedAB: +expectedAB.toFixed(1),
    expected: {
      hits: +expectedHits.toFixed(2),
      hr: +expectedHR.toFixed(3),
      totalBases: +expectedTB.toFixed(2),
      rbi: +expectedRBI.toFixed(2),
      runs: +expectedRuns.toFixed(2),
    },

    // Market probabilities
    markets,

    // Adjustments applied
    adjustments,
    multipliers: {
      hits: +hitMult.toFixed(3),
      hr: +hrMult.toFixed(3),
      tb: +tbMult.toFixed(3),
      rbi: +rbiMult.toFixed(3),
      runs: +runMult.toFixed(3),
    },
  };
}

// ==================== POISSON DISTRIBUTION ====================
function poissonPMF(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonDist(lambda, maxK) {
  const probs = [];
  let sum = 0;
  for (let k = 0; k < maxK; k++) {
    const p = poissonPMF(lambda, k);
    probs.push(+p.toFixed(4));
    sum += p;
  }
  probs.push(+(1 - sum).toFixed(4)); // P(maxK+)
  return probs;
}

function sumProbs(probs, fromIndex) {
  let sum = 0;
  for (let i = fromIndex; i < probs.length; i++) sum += probs[i];
  return sum;
}

// ==================== ODDS CONVERSION ====================
function americanToImplied(odds) {
  if (!odds || odds === 0) return 50;
  if (odds > 0) return +(100 / (odds + 100) * 100).toFixed(1);
  return +(Math.abs(odds) / (Math.abs(odds) + 100) * 100).toFixed(1);
}

// ==================== MARKET BUILDER ====================
function buildMarket(label, line, expected, probs, overProb, underProb) {
  // Clamp probabilities
  overProb = Math.max(0.01, Math.min(0.99, overProb));
  underProb = Math.max(0.01, Math.min(0.99, underProb));

  return {
    label: `${label} O/U ${line}`,
    line,
    expected: +expected.toFixed(2),
    overProb: +(overProb * 100).toFixed(1),
    underProb: +(underProb * 100).toFixed(1),
    overFairOdds: probToAmericanOdds(overProb),
    underFairOdds: probToAmericanOdds(underProb),
  };
}

function probToAmericanOdds(prob) {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// ==================== OD SCAN ====================

/**
 * Scan all Opening Day games for batter prop value
 * Returns top value plays across all batters
 */
function scanODBatterProps(options = {}) {
  const { isOpeningDay = true, weatherData = {}, liveLines = null } = options;

  let odGames;
  try {
    const od = require('../models/mlb-opening-day');
    odGames = od.OPENING_DAY_GAMES;
  } catch (e) {
    odGames = [];
  }

  const allPicks = [];
  const gameResults = [];

  for (const game of odGames) {
    const awayStarter = game.confirmedStarters?.away;
    const homeStarter = game.confirmedStarters?.home;
    const park = TEAM_PARKS[game.home] || 'Unknown';
    const isDome = DOME_PARKS.has(park);
    const tempF = weatherData[`${game.away}@${game.home}`]?.temp || null;

    // Find batters for both teams
    const awayBatters = getBattersForTeam(game.away);
    const homeBatters = getBattersForTeam(game.home);

    const gamePicks = [];

    // Away batters face home starter
    for (const batter of awayBatters) {
      if (!homeStarter) continue;
      const pred = predictBatterProps(batter.name, homeStarter, game.home, {
        isOpeningDay,
        tempF,
        isDome,
        batterHand: batter.hand,
      });
      if (pred) {
        const picks = extractValuePicks(pred, game, liveLines);
        gamePicks.push(...picks);
      }
    }

    // Home batters face away starter
    for (const batter of homeBatters) {
      if (!awayStarter) continue;
      const pred = predictBatterProps(batter.name, awayStarter, game.home, {
        isOpeningDay,
        tempF,
        isDome,
        batterHand: batter.hand,
      });
      if (pred) {
        const picks = extractValuePicks(pred, game, liveLines);
        gamePicks.push(...picks);
      }
    }

    gameResults.push({
      game: `${game.away}@${game.home}`,
      date: game.date,
      time: game.time,
      park,
      awayStarter,
      homeStarter,
      picksCount: gamePicks.length,
    });

    allPicks.push(...gamePicks);
  }

  // Sort by edge descending
  allPicks.sort((a, b) => b.edge - a.edge);

  // Top picks (meaningful edge vs book)
  const topPicks = allPicks.filter(p => p.edge >= 8.0);
  const highConf = allPicks.filter(p => p.confidence === 'HIGH');

  return {
    timestamp: new Date().toISOString(),
    isOpeningDay,
    gamesScanned: gameResults.length,
    totalBatterPropPicks: allPicks.length,
    highConfidencePicks: highConf.length,
    topPicksCount: topPicks.length,
    averageEdge: allPicks.length > 0
      ? +(allPicks.reduce((s, p) => s + p.edge, 0) / allPicks.length).toFixed(1) : 0,
    topPicks: topPicks.slice(0, 30),
    allPicks: allPicks.slice(0, 100), // limit response size
    gameDetails: gameResults,
    summary: buildScanSummary(topPicks, allPicks),
    strategy: {
      hitUnders: 'OD aces (K/9 10+) SUPPRESS hits → UNDER 1.5 hits on non-elite batters',
      hrUnders: 'Cold weather + OD = HR suppression → UNDER 0.5 HR on most batters',
      tbOvers: 'xSLG underperformers (slgLuck < -0.03) = TB OVER value',
      rbiContext: 'RBIs depend on lineup context — top-order batters get fewer RBI opportunities',
      luckFades: 'BA > xBA by 0.020+ = BABIP luck regression incoming → UNDER hits',
      luckBacks: 'xBA > BA by 0.020+ = unlucky, true talent higher → OVER hits',
    },
  };
}

function getBattersForTeam(teamAbbr) {
  const batters = [];
  for (const [name, data] of Object.entries(OD_BATTER_PROJECTIONS)) {
    if (data.team === teamAbbr) {
      batters.push({ name, ...data });
    }
  }
  batters.sort((a, b) => (a.order || 99) - (b.order || 99));
  return batters;
}

// ==================== LIVE ODDS INTEGRATION ====================
// Fetch live batter prop lines from The Odds API
let _liveBatterLines = null;
let _liveBatterLinesTs = 0;
const BATTER_LINES_CACHE_MS = 5 * 60 * 1000; // 5 min cache

async function fetchLiveBatterLines() {
  const now = Date.now();
  if (_liveBatterLines && (now - _liveBatterLinesTs) < BATTER_LINES_CACHE_MS) {
    return _liveBatterLines;
  }
  
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;
  
  const markets = ['batter_hits', 'batter_home_runs', 'batter_total_bases', 'batter_rbis', 'batter_runs_scored'];
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}&regions=us&markets=${markets.join(',')}&oddsFormat=american&bookmakers=draftkings,fanduel`;
  
  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    
    if (!Array.isArray(data)) return null;
    
    // Parse into per-batter lookup: { "Aaron Judge": { hits_0_5: { over: -175, under: +145 }, ... } }
    const lines = {};
    for (const event of data) {
      for (const book of (event.bookmakers || [])) {
        if (!['draftkings', 'fanduel'].includes(book.key)) continue;
        for (const market of (book.markets || [])) {
          const marketType = market.key; // batter_hits, batter_home_runs, etc
          for (const outcome of (market.outcomes || [])) {
            const name = outcome.description || outcome.name;
            if (!name) continue;
            if (!lines[name]) lines[name] = {};
            const line = outcome.point || 0.5;
            const mKey = marketType.replace('batter_', '') + '_' + line.toString().replace('.', '_');
            if (!lines[name][mKey]) lines[name][mKey] = {};
            lines[name][mKey][outcome.name.toLowerCase()] = outcome.price;
            lines[name][mKey].line = line;
            lines[name][mKey].book = book.key;
          }
        }
      }
    }
    
    _liveBatterLines = lines;
    _liveBatterLinesTs = now;
    console.log(`[batter-props] Fetched live lines for ${Object.keys(lines).length} batters`);
    return lines;
  } catch (e) {
    console.error('[batter-props] Live lines fetch failed:', e.message);
    return null;
  }
}

// ==================== BATTER-SPECIFIC BOOK IMPLIED PROBS ====================
// Instead of using static average-batter baselines, we estimate what the BOOK
// would price using the batter's SURFACE stats (BA, SLG) — which is what books
// actually use to set lines. Our edge = xBA-based model prob vs BA-based book prob.
//
// The key insight: books price based on BA/SLG (noisy BABIP-dependent surface stats).
// We price based on xBA/xSLG (Statcast truth = contact quality + exit velo + launch angle).
// The DELTA between these is our systematic edge.

function getBatterSpecificBookProbs(batter, proj, pitcherK) {
  // Books price using surface BA/SLG (not xBA/xSLG)
  // They DO adjust for pitcher somewhat, but less precisely than our model
  const surfaceBA = batter.ba || proj.ba || LG_AVG.ba;
  const surfaceSLG = batter.slg || proj.slg || LG_AVG.slg;
  const surfaceISO = surfaceSLG - surfaceBA;
  const expectedAB = proj.ab ? (proj.ab / 162) : LG_AVG.abPerGame;
  
  // Book uses surface BA to price hits (with mild pitcher adj)
  const bookHitRate = surfaceBA * (pitcherK.tier === 'high' ? 0.95 : pitcherK.tier === 'above' ? 0.97 : 1.0);
  const bookHRRate = proj.hr && proj.ab ? (proj.hr / proj.ab) : Math.max(0.005, surfaceISO * 0.25);
  const bookTBRate = surfaceSLG * (pitcherK.tier === 'high' ? 0.95 : 1.0);
  const bookRBIRate = ((batter.woba || LG_AVG.woba) - 0.200) * 0.45;
  const bookRunRate = (surfaceBA + 0.08) * 0.35;
  
  // Generate Poisson probs from book's surface-stat perspective
  const bookHitProbs = poissonDist(bookHitRate * expectedAB, 5);
  const bookHRProbs = poissonDist(bookHRRate * expectedAB, 3);
  const bookTBProbs = poissonDist(bookTBRate * expectedAB, 8);
  const bookRBIProbs = poissonDist(bookRBIRate * expectedAB, 5);
  const bookRunProbs = poissonDist(bookRunRate * expectedAB, 4);
  
  // Add ~3% vig that books typically build in (toward the "popular" side)
  const addVig = (over, under) => {
    return { over: Math.max(5, over * 100 - 1.5), under: Math.min(95, under * 100 + 1.5) };
  };
  
  return {
    hits_0_5: addVig(1 - bookHitProbs[0], bookHitProbs[0]),
    hits_1_5: addVig(1 - bookHitProbs[0] - bookHitProbs[1], bookHitProbs[0] + bookHitProbs[1]),
    hits_2_5: addVig(1 - bookHitProbs[0] - bookHitProbs[1] - bookHitProbs[2], bookHitProbs[0] + bookHitProbs[1] + bookHitProbs[2]),
    hr_0_5: addVig(1 - bookHRProbs[0], bookHRProbs[0]),
    tb_0_5: addVig(1 - bookTBProbs[0], bookTBProbs[0]),
    tb_1_5: addVig(1 - bookTBProbs[0] - bookTBProbs[1], bookTBProbs[0] + bookTBProbs[1]),
    tb_2_5: addVig(sumProbs(bookTBProbs, 3) / 1, 1 - sumProbs(bookTBProbs, 3) / 1),
    rbi_0_5: addVig(1 - bookRBIProbs[0], bookRBIProbs[0]),
    rbi_1_5: addVig(1 - bookRBIProbs[0] - bookRBIProbs[1], bookRBIProbs[0] + bookRBIProbs[1]),
    runs_0_5: addVig(1 - bookRunProbs[0], bookRunProbs[0]),
  };
}

/**
 * Extract specific value picks from a batter prediction
 * Compares model probability vs typical book lines to find TRUE edge
 */
function extractValuePicks(pred, game, liveLines) {
  const picks = [];
  const { markets, batter, team, statcast: sc, expected } = pred;

  // Generate batter-specific book implied probs using their surface BA/SLG
  const batterData = getBatterData(batter);
  const proj = OD_BATTER_PROJECTIONS[batter] || {};
  const pitcherK = getPitcherK9Effect(pred.pitcher);
  const bookProbs = getBatterSpecificBookProbs(
    batterData || { ba: LG_AVG.ba, slg: LG_AVG.slg, woba: LG_AVG.woba },
    proj,
    pitcherK
  );
  
  // Check for live Odds API lines for this batter
  const playerLiveLines = liveLines?.[batter] || null;

  for (const [key, market] of Object.entries(markets)) {
    const bookLine = bookProbs[key];
    if (!bookLine) continue;
    
    // If we have live odds, convert American odds to implied prob and use those instead
    let actualBookLine = bookLine;
    if (playerLiveLines) {
      const liveKey = key.replace('hits', 'hits').replace('hr', 'home_runs').replace('tb', 'total_bases').replace('rbi', 'rbis').replace('runs', 'runs_scored');
      const live = playerLiveLines[liveKey];
      if (live && live.over !== undefined && live.under !== undefined) {
        const overImpl = americanToImplied(live.over);
        const underImpl = americanToImplied(live.under);
        actualBookLine = { over: overImpl, under: underImpl, source: 'live', book: live.book };
      }
    }

    // Calculate edge vs book implied probability
    const overEdge = market.overProb - actualBookLine.over;
    const underEdge = market.underProb - actualBookLine.under;

    // Only flag when we have meaningful edge vs book
    const bestSide = overEdge > underEdge ? 'OVER' : 'UNDER';
    const bestEdge = bestSide === 'OVER' ? overEdge : underEdge;
    const bestProb = bestSide === 'OVER' ? market.overProb : market.underProb;
    const fairOdds = bestSide === 'OVER' ? market.overFairOdds : market.underFairOdds;
    const bookProb = bestSide === 'OVER' ? actualBookLine.over : actualBookLine.under;
    const oddsSource = actualBookLine.source === 'live' ? `LIVE (${actualBookLine.book})` : 'model-estimated';

    // Minimum 5% edge vs book to be actionable
    if (bestEdge < 5) continue;

    // Confidence based on edge size + data quality
    const confidence = bestEdge >= 10 ? 'HIGH' :
      bestEdge >= 6 ? 'MEDIUM' : 'LOW';

    // Grade
    const grade = bestEdge >= 15 ? 'A' :
      bestEdge >= 10 ? 'A-' :
      bestEdge >= 7 ? 'B+' :
      bestEdge >= 4 ? 'B' : 'C';

    picks.push({
      batter,
      team,
      game: `${game.away}@${game.home}`,
      date: game.date,
      pitcher: pred.pitcher,
      pitcherHand: pred.pitcherHand,
      market: market.label,
      marketKey: key,
      side: bestSide,
      line: market.line,
      modelProb: +bestProb.toFixed(1),
      bookImplied: +bookProb.toFixed(1),
      oddsSource,
      edge: +bestEdge.toFixed(1),
      fairOdds,
      expected: market.expected,
      confidence,
      grade,
      luckSignal: sc?.luckSignal || 'NEUTRAL',
      adjustments: pred.adjustments,
    });
  }

  return picks;
}

function buildScanSummary(topPicks, allPicks) {
  if (topPicks.length === 0) return 'No strong batter prop edges found.';

  const smash = topPicks.filter(p => p.grade === 'A' || p.grade === 'A-');
  const strong = topPicks.filter(p => p.grade === 'B+');

  const lines = [];
  lines.push(`🔥 ${topPicks.length} top batter prop picks (${smash.length} SMASH, ${strong.length} STRONG)`);

  // Group by market type
  const hitPicks = topPicks.filter(p => p.marketKey.startsWith('hits'));
  const hrPicks = topPicks.filter(p => p.marketKey.startsWith('hr'));
  const tbPicks = topPicks.filter(p => p.marketKey.startsWith('tb'));
  const rbiPicks = topPicks.filter(p => p.marketKey.startsWith('rbi'));

  if (hitPicks.length > 0) lines.push(`⚾ ${hitPicks.length} hit props`);
  if (hrPicks.length > 0) lines.push(`💣 ${hrPicks.length} HR props`);
  if (tbPicks.length > 0) lines.push(`📊 ${tbPicks.length} total bases props`);
  if (rbiPicks.length > 0) lines.push(`🏠 ${rbiPicks.length} RBI props`);

  // Top 3 plays
  const top3 = topPicks.slice(0, 3);
  for (const p of top3) {
    lines.push(`  ${p.grade} ${p.batter} ${p.market} ${p.side} (${p.edge}% edge, ${p.modelProb}% prob)`);
  }

  return lines.join('\n');
}

// ==================== INDIVIDUAL BATTER LOOKUP ====================
/**
 * Get all prop predictions for a specific batter vs specific pitcher
 */
function getBatterMatchup(batterName, pitcherName, homeTeam, options = {}) {
  const pred = predictBatterProps(batterName, pitcherName, homeTeam, options);
  if (!pred) return { error: `Batter '${batterName}' not found in database` };

  // Add xBA luck analysis
  const luckAnalysis = analyzeLuck(pred);

  return {
    ...pred,
    luckAnalysis,
    bettingSignals: generateBettingSignals(pred),
  };
}

function analyzeLuck(pred) {
  const { statcast: sc } = pred;
  if (!sc) return null;

  const signals = [];

  // BA vs xBA
  if (sc.baLuck > 0.020) {
    signals.push({
      type: 'FADE_HITS',
      severity: 'HIGH',
      message: `BA (.${(sc.ba * 1000).toFixed(0)}) OVERPERFORMING xBA (.${(sc.xba * 1000).toFixed(0)}) by ${(sc.baLuck * 1000).toFixed(0)} pts — BABIP regression coming`,
      recommendation: 'UNDER hits props',
    });
  } else if (sc.baLuck < -0.020) {
    signals.push({
      type: 'BACK_HITS',
      severity: 'HIGH',
      message: `BA (.${(sc.ba * 1000).toFixed(0)}) UNDERPERFORMING xBA (.${(sc.xba * 1000).toFixed(0)}) by ${(Math.abs(sc.baLuck) * 1000).toFixed(0)} pts — unlucky, due for positive regression`,
      recommendation: 'OVER hits props',
    });
  }

  // SLG vs xSLG
  if (sc.slg && sc.xslg) {
    const slgDiff = sc.slg - sc.xslg;
    if (slgDiff > 0.030) {
      signals.push({
        type: 'FADE_POWER',
        severity: 'MEDIUM',
        message: `SLG (.${(sc.slg * 1000).toFixed(0)}) OVERPERFORMING xSLG (.${(sc.xslg * 1000).toFixed(0)}) — power regression incoming`,
        recommendation: 'UNDER total bases',
      });
    } else if (slgDiff < -0.030) {
      signals.push({
        type: 'BACK_POWER',
        severity: 'MEDIUM',
        message: `SLG (.${(sc.slg * 1000).toFixed(0)}) UNDERPERFORMING xSLG (.${(sc.xslg * 1000).toFixed(0)}) — true power higher than results`,
        recommendation: 'OVER total bases',
      });
    }
  }

  return signals;
}

function generateBettingSignals(pred) {
  const signals = [];
  const { markets, statcast: sc, pitcherK9 } = pred;

  // High-K pitcher = UNDER hits
  if (pitcherK9 >= 10.0) {
    signals.push({
      signal: 'ELITE_K_PITCHER',
      direction: 'UNDER hits',
      strength: 'STRONG',
      reason: `Facing ${pitcherK9} K/9 pitcher — high whiff rate suppresses contact`,
    });
  }

  // xBA underperformer vs low-K pitcher = OVER hits
  if (sc?.baLuck < -0.015 && pitcherK9 < 8.0) {
    signals.push({
      signal: 'UNLUCKY_BATTER_VS_LOW_K',
      direction: 'OVER hits',
      strength: 'STRONG',
      reason: `Batter is ${(Math.abs(sc.baLuck) * 1000).toFixed(0)} pts below xBA AND facing contact-friendly pitcher (${pitcherK9} K/9)`,
    });
  }

  // Power hitter in HR-friendly park
  if (pred.expected.hr >= 0.15 && pred.parkHRFactor >= 1.05) {
    signals.push({
      signal: 'POWER_IN_HR_PARK',
      direction: 'OVER HR/TB',
      strength: 'MEDIUM',
      reason: `${pred.expected.hr.toFixed(2)} expected HR in ${pred.park} (${pred.parkHRFactor}x HR factor)`,
    });
  }

  return signals;
}

// ==================== LEADERBOARD ====================
/**
 * Get top batters by Statcast expected stats for prop betting
 */
function getStatcastLeaderboard(metric = 'xwoba', limit = 30) {
  const batters = statcast.cachedBatters;
  if (!batters) return [];

  const list = [];
  for (const [name, data] of Object.entries(batters)) {
    if ((data.pa || 0) < 200) continue; // min 200 PA
    list.push({
      name,
      pa: data.pa,
      ba: data.ba,
      xba: data.xba,
      slg: data.slg,
      xslg: data.xslg,
      woba: data.woba,
      xwoba: data.xwoba,
      baLuck: +(data.baLuck || 0).toFixed(3),
      slgLuck: +((data.slg || 0) - (data.xslg || 0)).toFixed(3),
      wobaLuck: +(data.wobaLuck || 0).toFixed(3),
      luckSignal: data.baLuck > 0.015 ? 'OVERPERFORMING' :
        data.baLuck < -0.015 ? 'UNDERPERFORMING' : 'NEUTRAL',
    });
  }

  // Sort by chosen metric descending
  list.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  return list.slice(0, limit);
}

/**
 * Get regression candidates — batters whose BA/SLG significantly differs from expected
 */
function getRegressionTargets(direction = 'fade', limit = 20) {
  const batters = statcast.cachedBatters;
  if (!batters) return [];

  const list = [];
  for (const [name, data] of Object.entries(batters)) {
    if ((data.pa || 0) < 200) continue;

    const baGap = (data.ba || 0) - (data.xba || 0);
    const slgGap = (data.slg || 0) - (data.xslg || 0);
    const combinedLuck = baGap + slgGap * 0.5;

    // Fade = overperformers (high luck), Back = underperformers (low luck)
    if (direction === 'fade' && combinedLuck > 0.015) {
      list.push({
        name,
        team: getTeamForBatter(name),
        ba: data.ba, xba: data.xba,
        slg: data.slg, xslg: data.xslg,
        baGap: +baGap.toFixed(3),
        slgGap: +slgGap.toFixed(3),
        combinedLuck: +combinedLuck.toFixed(3),
        recommendation: 'UNDER hits/TB — regression coming',
      });
    } else if (direction === 'back' && combinedLuck < -0.015) {
      list.push({
        name,
        team: getTeamForBatter(name),
        ba: data.ba, xba: data.xba,
        slg: data.slg, xslg: data.xslg,
        baGap: +baGap.toFixed(3),
        slgGap: +slgGap.toFixed(3),
        combinedLuck: +combinedLuck.toFixed(3),
        recommendation: 'OVER hits/TB — underperforming true talent',
      });
    }
  }

  list.sort((a, b) => direction === 'fade' 
    ? b.combinedLuck - a.combinedLuck 
    : a.combinedLuck - b.combinedLuck);
  return list.slice(0, limit);
}

function getTeamForBatter(name) {
  const proj = OD_BATTER_PROJECTIONS[name];
  if (proj) return proj.team;
  return 'UNK';
}

// ==================== MODULE EXPORTS ====================
module.exports = {
  predictBatterProps,
  scanODBatterProps,
  getBatterMatchup,
  getStatcastLeaderboard,
  getRegressionTargets,
  getBattersForTeam,
  fetchLiveBatterLines,
  OD_BATTER_PROJECTIONS,
  PARK_HR_FACTORS,
};
