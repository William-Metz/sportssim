// services/preseason-tuning.js — MLB Preseason Model Tuning for Opening Day
// CRITICAL: Opening Day is March 27, 2026 — 5 days away
// 
// This service provides three key enhancements:
// 1. Spring training signal integration into predictions
// 2. Roster change impact adjustments  
// 3. Opening Day-specific factors (starter innings, bullpen unknowns, etc.)
//
// Built for MONEY: Every 1% edge on Opening Day compounds across 15+ games

// ==================== SPRING TRAINING SIGNAL WEIGHTS ====================
// Spring training is a WEAK signal — but it's a signal.
// Research shows spring training ERA correlates ~0.15 with regular season ERA
// (very low, but better than zero). Key signals:
// - Pitcher velocity trends (not captured in W/L)
// - New acquisition team chemistry
// - Lineup health (who's playing the full spring game vs resting)
// - Bullpen roles settling
//
// We weight spring training at ~5% of total prediction for the FIRST week,
// then it decays to 0% by week 3 of the regular season.

const SPRING_TRAINING_SIGNALS = {
  // Format: { offense: [-1, 1], pitching: [-1, 1], chemistry: [-1, 1], note: string }
  // Values based on 2026 spring training performance + context + roster reality
  
  // TOP TIER — Clearly outperforming expectations
  'LAD': { offense: 0.6, pitching: 0.5, chemistry: 0.3, stWeight: 0.06, note: '19-8 best in Cactus, Ohtani/Betts/Freeman/Tucker. Added Roki Sasaki, Edwin Diaz, Tanner Scott. UNFAIR.' },
  'ATL': { offense: 0.3, pitching: 0.4, chemistry: 0.2, stWeight: 0.05, note: '18-6 BEST Grapefruit. Strider healthy, Sale ace, Acuña back. Added Kim, Heim, Iglesias. Bounceback year.' },
  'SF':  { offense: 0.3, pitching: 0.3, chemistry: 0.2, stWeight: 0.05, note: '18-9 surprise. Webb anchoring rotation. Eduardo Rodriguez added.' },
  'DET': { offense: 0.2, pitching: 0.5, chemistry: 0.2, stWeight: 0.05, note: '15-11, Skubal dominant, Valdez acquisition huge' },
  'BOS': { offense: 0.3, pitching: 0.5, chemistry: 0.3, stWeight: 0.05, note: '12-13 but pitching loaded: Crochet+Gray+Suarez+Bello+Sandoval. Contreras bat. Anthony+Mayer promoted.' },
  'NYY': { offense: 0.4, pitching: 0.4, chemistry: 0.2, stWeight: 0.05, note: '17-10 strong spring. Fried+Cole 1-2. Judge+Bellinger+Goldschmidt+McMahon. Bednar+Doval bullpen. STACKED.' },
  
  // SOLID — Meeting or slightly exceeding projections
  'PIT': { offense: 0.3, pitching: 0.4, chemistry: 0.2, stWeight: 0.05, note: 'Skenes ace year 2, added Ozuna+Lowe to lineup. Lost Bednar to NYY.' },
  'TEX': { offense: 0.3, pitching: 0.2, chemistry: 0.1, stWeight: 0.04, note: '16-11 solid, Eovaldi reliable ace' },
  'TOR': { offense: 0.3, pitching: 0.4, chemistry: 0.1, stWeight: 0.04, note: '11-13 meh spring but roster is LOADED: Cease+Bieber+Scherzer+Gausman. Santander+Gimenez+Okamoto. Massive upside.' },
  'NYM': { offense: 0.5, pitching: 0.3, chemistry: 0.1, stWeight: 0.05, note: '12-10 decent. Soto+Lindor+Robert+Bichette+Semien = most expensive lineup ever. Peralta+Holmes+Williams arms.' },
  'PHI': { offense: 0.3, pitching: 0.2, chemistry: 0.1, stWeight: 0.04, note: '10-14 rough spring but roster is deep: Luzardo+Garcia+Painter added. Wheeler/Nola still elite.' },
  'BAL': { offense: 0.4, pitching: 0.3, chemistry: 0.2, stWeight: 0.05, note: '10-13 but MASSIVE upgrades: Alonso+O\'Neill bats, Bassitt+Eflin+Baz rotation, Helsley closing. Young core (Henderson/Rutschman/Cowser) + veterans = legit contender.' },
  'HOU': { offense: 0.4, pitching: 0.1, chemistry: 0.2, stWeight: 0.04, note: '10-13 but Correa BACK + Walker + Hader. Lost Valdez but pitching deep enough. Altuve/Alvarez/Correa scary.' },
  'SD':  { offense: 0.2, pitching: 0.2, chemistry: 0.1, stWeight: 0.04, note: '14-13, added Mason Miller (elite CL), Castellanos, Marquez, Miranda. Lost Cease but King/Darvish/Musgrove rotation. Tatis/Machado/Bogaerts core.' },
  'SEA': { offense: 0.2, pitching: 0.4, chemistry: 0.1, stWeight: 0.04, note: '10-17 WORST spring but actually fixed offense: Naylor/Arozarena/Donovan added. Castillo/Gilbert/Kirby elite. Spring record is NOISE.' },
  
  // MIDDLING — Spring was noise
  'CLE': { offense: -0.1, pitching: 0.3, chemistry: 0.0, stWeight: 0.03, note: '13-13, lost Gimenez+Bieber to TOR. Added Hoskins. Elite pitching but offense still thin.' },
  'CIN': { offense: 0.1, pitching: 0.1, chemistry: 0.0, stWeight: 0.03, note: '13-14, Abbott/Lodolo developing nicely. De La Cruz exciting.' },
  'MIN': { offense: 0.0, pitching: 0.1, chemistry: 0.0, stWeight: 0.03, note: '8-17 worst in Grapefruit but added Bell+Bradley+Outman. Joe Ryan OD starter.' },
  'ARI': { offense: 0.2, pitching: 0.0, chemistry: 0.0, stWeight: 0.03, note: '13-13 even spring. Added Arenado (aging), lost C. Walker to HOU. Marte/Carroll core solid.' },
  'LAA': { offense: 0.0, pitching: 0.0, chemistry: 0.0, stWeight: 0.03, note: '16-14 decent but lost Ward+Sandoval. Added Kikuchi. Rebuilding.' },
  'TB':  { offense: -0.1, pitching: 0.1, chemistry: 0.0, stWeight: 0.03, note: '9-16 rough spring. Lost Lowe. McClanahan returning. Rays always find value.' },
  'OAK': { offense: -0.3, pitching: -0.2, chemistry: -0.1, stWeight: 0.03, note: '13-15 in Cactus. Lost Mason Miller. Severino OD starter. Rebuilding.' },
  'KC':  { offense: -0.1, pitching: 0.2, chemistry: 0.0, stWeight: 0.03, note: '9-18 worst spring, but Ragans/Lugo rotation is legit. Ran it back.' },
  'STL': { offense: -0.2, pitching: -0.4, chemistry: -0.2, stWeight: 0.03, note: '12-14. GUTTED: lost Gray, Helsley, Donovan. Liberatore OD = tanking.' },

  // BELOW EXPECTATIONS  
  'CWS': { offense: 0.1, pitching: -0.3, chemistry: -0.1, stWeight: 0.03, note: '15-13 spring. Murakami is exciting (NPB 56 HR). Still worst pitching staff. But offense has SOME upside now.' },
  'MIL': { offense: 0.0, pitching: -0.2, chemistry: -0.2, stWeight: 0.03, note: '11-15, lost Peralta+Williams+Contreras. Three big losses. Misiorowski is raw but has elite stuff.' },
  'CHC': { offense: -0.1, pitching: -0.2, chemistry: 0.0, stWeight: 0.03, note: '11-16, lost Bellinger+Wesneski. Boyd OD starter = concerning. Suzuki/Hoerner is fine.' },
  'WSH': { offense: -0.2, pitching: -0.2, chemistry: 0.0, stWeight: 0.03, note: '11-15, Cavalli getting OD shot — upside but raw. CJ Abrams developing.' },
  'MIA': { offense: -0.4, pitching: 0.1, chemistry: -0.2, stWeight: 0.03, note: '10-16. Lost Luzardo + De La Cruz. Alcantara back from TJ = upside. Offense is BAD.' },
  'COL': { offense: -0.1, pitching: -0.5, chemistry: -0.1, stWeight: 0.02, note: '13-13 even spring, lost McMahon. Coors is a pitching nightmare. Tanking.' },
};

// ==================== ROSTER CHANGE IMPACT ====================
// Key 2025-26 offseason moves that change team projections
// These adjust the static team ratings that were built on 2025 data
// Format: { rsG_adj, raG_adj, note }
// Positive rsG_adj = team scores MORE runs now
// Positive raG_adj = team ALLOWS more runs now (worse pitching)

const ROSTER_CHANGES = {
  // ===== AL EAST =====
  'BAL': {
    rsG_adj: 0.45, raG_adj: -0.55,
    note: 'MASSIVE overhaul from 75-87 base: Pete Alonso (1B, 35+ HR), Tyler O\'Neill (OF, power), Taylor Ward (OF), Leody Taveras (CF). Pitching: Chris Bassitt (SP, 200IP workhorse), Zach Eflin (SP, elite sinker), Shane Baz (SP, high upside), Ryan Helsley (elite closer, 1.2 ERA). Trevor Rogers OD starter. From 75-87 to legit 85-88W contender. Young core (Henderson/Rutschman/Cowser) was hurt by pitching in 2025.',
    moves: ['Pete Alonso (1B) signed', 'Tyler O\'Neill (OF) signed', 'Chris Bassitt (SP) signed', 'Zach Eflin (SP) signed', 'Shane Baz (SP) traded', 'Ryan Helsley (CL) traded from STL', 'Taylor Ward (OF) traded from LAA', 'Leody Taveras (CF) signed']
  },
  'NYY': {
    rsG_adj: 0.20, raG_adj: -0.20,
    note: 'Major additions: Max Fried (ace LHP), Cody Bellinger (OF/1B switch-hitter), Paul Goldschmidt (1B veteran, declining), Ryan McMahon (3B, 25+ HR power). Bullpen: David Bednar (elite closer from PIT), Camilo Doval (setup). Judge/Soto core already elite.',
    moves: ['Max Fried (SP) from ATL', 'Cody Bellinger (OF/1B) from CHC', 'Paul Goldschmidt (1B) signed', 'Ryan McMahon (3B) from COL', 'David Bednar (CL) from PIT', 'Camilo Doval (RP) from SF']
  },
  'BOS': {
    rsG_adj: 0.08, raG_adj: -0.25,
    note: 'Rotation overhaul: Crochet (ace LHP from CWS) + Sonny Gray (from STL) + Ranger Suarez (elite LHP from PHI) + Patrick Sandoval. Added Willson Contreras (C, big bat) + Aroldis Chapman (RP). Roman Anthony + Marcelo Mayer = elite prospect reinforcements.',
    moves: ['Garrett Crochet (SP) from CWS', 'Sonny Gray (SP) from STL', 'Ranger Suarez (SP) from PHI', 'Patrick Sandoval (SP) from LAA', 'Willson Contreras (C) from MIL', 'Aroldis Chapman (RP) signed']
  },
  'TOR': {
    rsG_adj: 0.15, raG_adj: -0.40,
    note: 'MASSIVE pitching haul on top of 94-68 division winner: Dylan Cease (ace, 224K), Shane Bieber (returning Cy Young winner, injury risk), Max Scherzer (future HOF, age 41 risk), Jeff Hoffman (elite reliever). Added Anthony Santander (OF, 44 HR in 2024) + Andres Gimenez (elite 2B from CLE). Kazuma Okamoto (Japanese power bat from NPB). ERA was 4.15 in 2025 — this pitching haul should drop it substantially. Lost Bichette, but Gimenez is an upgrade.',
    moves: ['Dylan Cease (SP) from SD', 'Shane Bieber (SP) from CLE', 'Max Scherzer (SP) signed', 'Jeff Hoffman (RP) from PHI', 'Anthony Santander (OF) signed', 'Andres Gimenez (2B) from CLE', 'Kazuma Okamoto (1B/3B) from NPB']
  },
  'TB': {
    rsG_adj: 0.05, raG_adj: 0.0,
    note: 'Lost Brandon Lowe to PIT. Added Cedric Mullins (OF from BAL), Gavin Lux (2B from SEA/LAD). Still have McClanahan returning from TJ. Rays always find value.',
    moves: ['Lost Brandon Lowe to PIT', 'Cedric Mullins (OF) from BAL', 'Gavin Lux (2B) signed', 'Shane McClanahan returning from TJ']
  },

  // ===== AL CENTRAL =====
  'CLE': {
    rsG_adj: 0.05, raG_adj: 0.20,
    note: 'Lost Andres Gimenez (elite 2B) + Shane Bieber (SP) to TOR. Added Rhys Hoskins (1B, power bat). Daniel Espino healthy = upside. Offense still a concern.',
    moves: ['Lost Andres Gimenez to TOR', 'Lost Shane Bieber to TOR', 'Rhys Hoskins (1B) signed', 'Daniel Espino (SP) healthy']
  },
  'DET': {
    rsG_adj: 0.05, raG_adj: -0.15,
    note: 'Added Framber Valdez (#2 starter). Rotation is now Skubal+Valdez = elite 1-2 punch.',
    moves: ['Framber Valdez (SP) from HOU']
  },
  'KC': {
    rsG_adj: 0.0, raG_adj: 0.0,
    note: 'Largely ran it back. Ragans/Lugo rotation anchors. Internal development focus.',
    moves: []
  },
  'MIN': {
    rsG_adj: 0.10, raG_adj: -0.10,
    note: 'Added Josh Bell (1B, switch-hitter). Taj Bradley (SP from TB), Mick Abel (SP from PHI), James Outman (OF from LAD). Rotation improving. Still rebuilding.',
    moves: ['Josh Bell (1B) signed', 'Taj Bradley (SP) from TB', 'Mick Abel (SP) from PHI', 'James Outman (OF) from LAD']
  },
  'CWS': {
    rsG_adj: 0.40, raG_adj: 0.05,
    note: 'Lost Crochet to BOS but added MUNETAKA MURAKAMI (3B/DH, 56 HR in NPB — elite power). Curtis Mead (3B from TB), Kyle Teel (C), Miguel Vargas (INF from LAD), Jordan Hicks (SP). From 60-102 disaster — Murakami alone could add 0.3+ RS/G. Still bad pitching (4.38 ERA base) but offense has legit upside now.',
    moves: ['Lost Garrett Crochet to BOS', 'Munetaka Murakami (3B/DH) from NPB', 'Curtis Mead (3B) from TB', 'Kyle Teel (C) promoted', 'Miguel Vargas (INF) from LAD', 'Jordan Hicks (SP) from SF']
  },

  // ===== AL WEST =====
  'HOU': {
    rsG_adj: 0.20, raG_adj: -0.10,
    note: 'CARLOS CORREA IS BACK (SS, elite bat). Christian Walker (1B, 26 HR Gold Glover from ARI). Josh Hader (elite closer). Hayden Wesneski (SP from CHC). Lost Valdez but pitching still deep.',
    moves: ['Carlos Correa (SS) from MIN', 'Christian Walker (1B) from ARI', 'Josh Hader (CL) signed', 'Hayden Wesneski (SP) from CHC', 'Lost Framber Valdez to DET']
  },
  'SEA': {
    rsG_adj: 0.15, raG_adj: 0.0,
    note: 'FINALLY fixed the offense: Josh Naylor (1B, 31 HR from CLE), Randy Arozarena (OF from TB), Brendan Donovan (UTL from STL). Pitching was already elite (Castillo/Gilbert/Kirby). This is the year.',
    moves: ['Josh Naylor (1B) from CLE', 'Randy Arozarena (OF) from TB', 'Brendan Donovan (UTL) from STL']
  },
  'TEX': {
    rsG_adj: 0.0, raG_adj: 0.0,
    note: 'Largely ran it back with Eovaldi + Seager core. Internal development.',
    moves: []
  },
  'LAA': {
    rsG_adj: 0.0, raG_adj: -0.10,
    note: 'Added Yusei Kikuchi (SP). Lost Taylor Ward to BAL, Patrick Sandoval to BOS. Still rebuilding.',
    moves: ['Yusei Kikuchi (SP) signed', 'Lost Taylor Ward to BAL', 'Lost Patrick Sandoval to BOS']
  },
  'OAK': {
    rsG_adj: 0.0, raG_adj: 0.0,
    note: 'Luis Severino OD starter. Still rebuilding. Low expectations.',
    moves: ['Luis Severino (SP) signed']
  },

  // ===== NL EAST =====
  'NYM': {
    rsG_adj: 0.55, raG_adj: -0.40,
    note: 'THE MEGA-TEAM on top of 83-79 base: Juan Soto (OF, 41 HR, 300M contract), Bo Bichette (SS from TOR), Marcus Semien (2B from TEX), Luis Robert Jr. (CF from CWS). Bullpen: Clay Holmes (CL), Devin Williams (elite setup), A.J. Minter. Freddy Peralta (SP from MIL). This lineup is TERRIFYING. Lindor+Soto+Robert+Bichette+Semien. Pitching goes from 4.18 ERA to potentially sub-3.80 with Peralta+Holmes+Williams.',
    moves: ['Juan Soto (OF) signed mega-deal', 'Bo Bichette (SS) from TOR', 'Marcus Semien (2B) from TEX', 'Luis Robert Jr. (CF) from CWS', 'Clay Holmes (CL) signed', 'Devin Williams (RP) from MIL', 'A.J. Minter (RP) from ATL', 'Freddy Peralta (SP) from MIL']
  },
  'ATL': {
    rsG_adj: 0.10, raG_adj: -0.25,
    note: 'Bounceback year from 76-86 — Acuña Jr + Spencer Strider healthy again (both missed most of 2025). Lost Ozuna to PIT, Max Fried to NYY, A.J. Minter to NYM. Added Ha-Seong Kim (UTL), Jonah Heim (C from TEX), Raisel Iglesias (CL). Strider back = rotation goes from bad (4.28 ERA) to potentially elite with Sale 1-2.',
    moves: ['Lost Max Fried to NYY', 'Lost Marcell Ozuna to PIT', 'Lost A.J. Minter to NYM', 'Mike Yastrzemski (OF) from SF', 'Ha-Seong Kim (UTL) from LAD', 'Jonah Heim (C) from TEX', 'Robert Suarez (RP) from SD', 'Raisel Iglesias (CL) signed', 'Spencer Strider returning healthy', 'Ronald Acuña Jr. returning healthy']
  },
  'PHI': {
    rsG_adj: 0.10, raG_adj: -0.10,
    note: 'Lost Castellanos + Jeff Hoffman + Ranger Suarez. Added Jesus Luzardo (SP from MIA, elite stuff), Adolis Garcia (OF, 30+ HR power from TEX), Jhoan Duran (RP, 100+ mph from MIN), Bryan De La Cruz (OF from MIA). Andrew Painter back from TJ = huge.',
    moves: ['Lost Nick Castellanos to SD', 'Lost Jeff Hoffman to TOR', 'Lost Ranger Suarez to BOS', 'Jesus Luzardo (SP) from MIA', 'Adolis Garcia (OF) from TEX', 'Jhoan Duran (RP) from MIN', 'Bryan De La Cruz (OF) from MIA', 'Andrew Painter (SP) returning from TJ']
  },
  'MIA': {
    rsG_adj: -0.15, raG_adj: 0.15,
    note: 'Lost Luzardo + Bryan De La Cruz. Still have Alcantara back from TJ. Full rebuild mode.',
    moves: ['Lost Jesus Luzardo to PHI', 'Lost Bryan De La Cruz to PHI', 'Sandy Alcantara returning from TJ']
  },
  'WSH': {
    rsG_adj: 0.0, raG_adj: 0.0,
    note: 'Cavalli getting OD shot. Still rebuilding. CJ Abrams + James Wood = future core.',
    moves: []
  },

  // ===== NL CENTRAL =====
  'MIL': {
    rsG_adj: -0.15, raG_adj: 0.25,
    note: 'Lost Peralta to NYM, Devin Williams to NYM, Willson Contreras to BOS. Three core pieces gone from a 97-65 team. Misiorowski raw but elite stuff. Still have strong farm system depth.',
    moves: ['Lost Freddy Peralta to NYM', 'Lost Devin Williams to NYM', 'Lost Willson Contreras to BOS']
  },
  'CHC': {
    rsG_adj: -0.20, raG_adj: 0.15,
    note: 'Lost Cody Bellinger to NYY, Hayden Wesneski to HOU from a strong 92-70 team. Boyd OD starter = thin rotation. Suzuki WBC knee injury. Still have Hoerner + Happ core but downgraded.',
    moves: ['Lost Cody Bellinger to NYY', 'Lost Hayden Wesneski to HOU']
  },
  'PIT': {
    rsG_adj: 0.50, raG_adj: 0.05,
    note: 'Added Marcell Ozuna + Brandon Lowe to lineup that scored only 3.60 RS/G in 2025 (worst in NL). Lost David Bednar (CL) to NYY. Massive offensive upgrade — Ozuna (40+ HR) + Lowe (25 HR) to a 71-91 team. Skenes ace year 2.',
    moves: ['Marcell Ozuna (DH/OF) from ATL', 'Brandon Lowe (2B) from TB', 'Lost David Bednar to NYY']
  },
  'STL': {
    rsG_adj: -0.10, raG_adj: 0.35,
    note: 'Lost Sonny Gray to BOS, Ryan Helsley (CL) to BAL, Brendan Donovan to SEA. Gutted from already-bad 78-84 team. Liberatore OD = thin rotation. 4.40 ERA in 2025 will get WORSE.',
    moves: ['Lost Sonny Gray to BOS', 'Lost Ryan Helsley to BAL', 'Lost Brendan Donovan to SEA']
  },
  'CIN': {
    rsG_adj: 0.0, raG_adj: 0.0,
    note: 'Ran it back. Abbott/Lodolo developing. De La Cruz + India core intact.',
    moves: []
  },

  // ===== NL WEST =====
  'LAD': {
    rsG_adj: 0.15, raG_adj: -0.10,
    note: 'Added Kyle Tucker (OF, 30+ HR elite bat from HOU), Roki Sasaki (SP, 100mph from NPB), Edwin Diaz (RP from NYM), Tanner Scott (RP), Hyseong Kim. Ohtani/Betts/Freeman/Tucker. Unfair.',
    moves: ['Kyle Tucker (OF) from HOU', 'Roki Sasaki (SP) from NPB', 'Edwin Diaz (RP) from NYM', 'Tanner Scott (RP) signed', 'Hyseong Kim (UTL) signed']
  },
  'SD': {
    rsG_adj: 0.10, raG_adj: -0.15,
    note: 'Added Nick Castellanos (OF from PHI), Mason Miller (elite closer from OAK, 100+mph), German Marquez (SP returning), Jose Miranda (1B from MIN), JP Sears (SP from OAK), Griffin Canning (SP). Lost Robert Suarez to ATL, Dylan Cease to TOR.',
    moves: ['Nick Castellanos (OF) from PHI', 'Mason Miller (CL) from OAK', 'German Marquez (SP) signed', 'Jose Miranda (1B) from MIN', 'JP Sears (SP) from OAK', 'Griffin Canning (SP) from LAA', 'Lost Dylan Cease to TOR', 'Lost Robert Suarez to ATL']
  },
  'ARI': {
    rsG_adj: 0.15, raG_adj: 0.05,
    note: 'Added Nolan Arenado (3B from STL, declining but still good), Carlos Santana (1B veteran), Tyler Locklear (1B from SEA). Lost Christian Walker (1B) to HOU. Marte/Carroll core intact.',
    moves: ['Nolan Arenado (3B) from STL', 'Carlos Santana (1B) signed', 'Tyler Locklear (1B) from SEA', 'Lost Christian Walker to HOU']
  },
  'SF': {
    rsG_adj: -0.10, raG_adj: 0.10,
    note: 'Lost Camilo Doval (CL) to NYY, Mike Yastrzemski to ATL, Jordan Hicks to CWS. Webb anchors rotation. Eduardo Rodriguez added.',
    moves: ['Lost Camilo Doval to NYY', 'Lost Mike Yastrzemski to ATL', 'Lost Jordan Hicks to CWS', 'Eduardo Rodriguez (SP) signed']
  },
  'COL': {
    rsG_adj: -0.10, raG_adj: 0.05,
    note: 'Lost Ryan McMahon (3B) to NYY. Still Coors with bad pitching. Tanking.',
    moves: ['Lost Ryan McMahon to NYY']
  },
};

// ==================== OPENING DAY SPECIFIC FACTORS ====================

/**
 * On Opening Day, starters go deeper:
 * - Managers want their ace to get the win
 * - Bullpens aren't established yet (less trust)
 * - Pitch counts higher because of extra rest
 * Historical data: OD starters average 5.8 IP vs 5.4 regular season
 * 
 * Returns a starter innings fraction (normally 5.5/9 = 0.611, OD = 5.8/9 = 0.644)
 */
function getOpeningDayStarterFraction(isOpeningDay = true) {
  return isOpeningDay ? 5.8 / 9 : 5.5 / 9;
}

/**
 * Calculate spring training run adjustment
 * Converts spring training signals into a run adjustment per game
 * 
 * @param {string} teamAbbr - Team abbreviation
 * @param {string} side - 'offense' or 'pitching'
 * @returns {number} Run adjustment (positive = more runs)
 */
function getSpringTrainingAdjustment(teamAbbr, side = 'both') {
  const signal = SPRING_TRAINING_SIGNALS[teamAbbr];
  if (!signal) return 0;
  
  const weight = signal.stWeight || 0.03;
  
  if (side === 'offense') {
    return signal.offense * weight * 10; // Scale to ~0.05-0.06 runs per game max
  } else if (side === 'pitching') {
    return signal.pitching * weight * 10; // Negative = allows fewer runs
  }
  
  // Both: combined effect
  // Offense positive = team scores more, pitching positive = team allows fewer
  return (signal.offense - signal.pitching) * weight * 5;
}

/**
 * Get roster change adjustment for a team
 * Returns { rsG_adj, raG_adj } adjustments to expected runs
 */
function getRosterChangeAdj(teamAbbr) {
  return ROSTER_CHANGES[teamAbbr] || { rsG_adj: 0, raG_adj: 0 };
}

/**
 * Combined Opening Day prediction adjustment
 * Integrates spring training, roster changes, and OD-specific factors
 * 
 * @param {string} teamAbbr - Team abbreviation
 * @param {boolean} isHome - Whether team is playing at home
 * @returns {{ offAdj: number, defAdj: number, starterFraction: number, info: object }}
 */
function getOpeningDayAdjustments(teamAbbr, isHome = false) {
  const spring = SPRING_TRAINING_SIGNALS[teamAbbr] || { offense: 0, pitching: 0, chemistry: 0, stWeight: 0.03 };
  const roster = ROSTER_CHANGES[teamAbbr] || { rsG_adj: 0, raG_adj: 0 };
  
  // Offensive adjustment: spring training signal + roster changes
  const rawOffAdj = (spring.offense * (spring.stWeight || 0.03) * 8) + roster.rsG_adj;
  
  // Defensive/pitching adjustment: spring training signal + roster changes
  // Negative defAdj = team allows fewer runs (better pitching)
  const rawDefAdj = -(spring.pitching * (spring.stWeight || 0.03) * 8) + roster.raG_adj;
  
  // Chemistry bonus/penalty for new-look teams
  // Teams with major roster turnover take time to gel
  const chemAdj = spring.chemistry * 0.02; // Very small effect
  
  // Cap adjustments to prevent unrealistic swings
  // For individual game predictions, apply at 65% confidence
  // (offseason WAR projections have ~35% uncertainty even for single games)
  const GAME_CONFIDENCE = 0.65;
  const offAdj = Math.max(-0.35, Math.min(0.35, rawOffAdj * GAME_CONFIDENCE));
  const defAdj = Math.max(-0.40, Math.min(0.40, rawDefAdj * GAME_CONFIDENCE));
  
  return {
    offAdj: +offAdj.toFixed(3),
    defAdj: +defAdj.toFixed(3),
    chemAdj: +chemAdj.toFixed(3),
    starterFraction: getOpeningDayStarterFraction(true),
    info: {
      springSignal: spring,
      rosterChanges: roster.note || null,
      moves: roster.moves || [],
    }
  };
}

/**
 * New team pitcher penalty
 * Pitchers starting for a new team in their first regular season game
 * have historically performed ~5-8% worse than their career averages.
 * Unfamiliarity with catchers, new pitch sequencing, new mound.
 */
const NEW_TEAM_PITCHERS = {
  // SP on new teams — unfamiliar catchers, new mound, new pitch sequencing
  'Garrett Crochet': { from: 'CWS', to: 'BOS', penalty: 0.06 },
  'Sonny Gray': { from: 'STL', to: 'BOS', penalty: 0.04 },
  'Ranger Suarez': { from: 'PHI', to: 'BOS', penalty: 0.05 },
  'Patrick Sandoval': { from: 'LAA', to: 'BOS', penalty: 0.04 },
  'Freddy Peralta': { from: 'MIL', to: 'NYM', penalty: 0.05 },
  'Framber Valdez': { from: 'HOU', to: 'DET', penalty: 0.05 },
  'Yusei Kikuchi': { from: 'TOR', to: 'LAA', penalty: 0.04 },
  'Luis Severino': { from: 'NYM', to: 'OAK', penalty: 0.04 },
  'Trevor Rogers': { from: 'MIA', to: 'BAL', penalty: 0.04 },
  'Max Fried': { from: 'ATL', to: 'NYY', penalty: 0.04 },
  'Dylan Cease': { from: 'SD', to: 'TOR', penalty: 0.05 },
  'Shane Bieber': { from: 'CLE', to: 'TOR', penalty: 0.05 },
  'Max Scherzer': { from: 'TEX', to: 'TOR', penalty: 0.03 }, // Veteran HOF, less affected
  'Jesus Luzardo': { from: 'MIA', to: 'PHI', penalty: 0.05 },
  'Chris Bassitt': { from: 'TOR', to: 'BAL', penalty: 0.04 },
  'Zach Eflin': { from: 'TB', to: 'BAL', penalty: 0.04 },
  'JP Sears': { from: 'OAK', to: 'SD', penalty: 0.04 },
  'Jordan Hicks': { from: 'SF', to: 'CWS', penalty: 0.05 },
  'Taj Bradley': { from: 'TB', to: 'MIN', penalty: 0.05 },
  'Eduardo Rodriguez': { from: 'ARI', to: 'SF', penalty: 0.04 },
  'Hayden Wesneski': { from: 'CHC', to: 'HOU', penalty: 0.04 },
  'German Marquez': { from: 'COL', to: 'SD', penalty: 0.04 },
  // Hitters on new teams (smaller effect)
  'Nick Castellanos': { from: 'PHI', to: 'SD', penalty: 0.02 },
  'Pete Alonso': { from: 'NYM', to: 'BAL', penalty: 0.02 },
  'Juan Soto': { from: 'NYY', to: 'NYM', penalty: 0.02 },
  'Cody Bellinger': { from: 'CHC', to: 'NYY', penalty: 0.02 },
  'Munetaka Murakami': { from: 'NPB', to: 'CWS', penalty: 0.04 }, // NPB transition
  'Roki Sasaki': { from: 'NPB', to: 'LAD', penalty: 0.05 }, // NPB transition, young
  'Kazuma Okamoto': { from: 'NPB', to: 'TOR', penalty: 0.04 }, // NPB transition
};

function getNewTeamPenalty(pitcherName) {
  if (!pitcherName) return 0;
  const entry = NEW_TEAM_PITCHERS[pitcherName];
  return entry ? entry.penalty : 0;
}

/**
 * Enhanced bullpen uncertainty for Opening Day
 * Bullpen roles aren't established yet — closer, setup, mop-up all in flux
 * This adds variance to bullpen-dependent outcomes
 * Returns a multiplier for bullpen ERA uncertainty (1.0 = normal, >1 = more uncertain)
 */
function getBullpenUncertainty(teamAbbr) {
  // Teams with established closers have less uncertainty
  const establishedBullpens = ['LAD', 'NYY', 'PHI', 'HOU', 'SEA', 'SD', 'CLE', 'BAL', 'NYM', 'BOS', 'ATL'];
  if (establishedBullpens.includes(teamAbbr)) return 1.05; // Slight uncertainty
  
  // Teams with major bullpen turnover
  const highUncertainty = ['CWS', 'OAK', 'COL', 'MIA', 'WSH', 'STL', 'MIL', 'CHC'];
  if (highUncertainty.includes(teamAbbr)) return 1.15; // Significant uncertainty
  
  return 1.10; // Default moderate uncertainty
}

/**
 * Day game vs night game adjustment
 * Opening Day day games historically have ~3% higher scoring
 * (offense locked in, adrenaline, packed house, etc.)
 */
function getDayNightAdj(timeET) {
  if (!timeET) return 1.0;
  const hour = parseInt(timeET.split(':')[0]);
  const isPM = timeET.toLowerCase().includes('pm');
  const adjustedHour = isPM && hour !== 12 ? hour + 12 : hour;
  
  // Day games (before 5 PM ET): slight run bump
  if (adjustedHour < 17) return 1.015; // +1.5% runs
  // Night games: neutral
  return 1.0;
}

/**
 * Get RAW combined team adjustment for season simulation
 * The season simulator applies its own confidence scaling (40%), so we return unscaled values.
 * This separates season-level from game-level confidence.
 */
function getTeamAdjustment(teamAbbr) {
  const spring = SPRING_TRAINING_SIGNALS[teamAbbr] || { offense: 0, pitching: 0, chemistry: 0, stWeight: 0.03 };
  const roster = ROSTER_CHANGES[teamAbbr] || { rsG_adj: 0, raG_adj: 0 };
  
  // Raw adjustments (no confidence scaling — season sim does its own)
  const rawOffAdj = (spring.offense * (spring.stWeight || 0.03) * 8) + roster.rsG_adj;
  const rawDefAdj = -(spring.pitching * (spring.stWeight || 0.03) * 8) + roster.raG_adj;
  const chemAdj = spring.chemistry * 0.02;
  
  // Cap at raw maximums
  const offAdj = Math.max(-0.60, Math.min(0.60, rawOffAdj));
  const defAdj = Math.max(-0.65, Math.min(0.65, rawDefAdj));
  
  return {
    offAdj: +offAdj.toFixed(3),
    defAdj: +defAdj.toFixed(3),
    chemAdj: +chemAdj.toFixed(3),
    starterFraction: getOpeningDayStarterFraction(true),
    info: {
      springSignal: spring,
      rosterChanges: roster.note || null,
      moves: roster.moves || [],
    }
  };
}

module.exports = {
  SPRING_TRAINING_SIGNALS,
  ROSTER_CHANGES,
  NEW_TEAM_PITCHERS,
  getSpringTrainingAdjustment,
  getRosterChangeAdj,
  getOpeningDayAdjustments,
  getOpeningDayStarterFraction,
  getNewTeamPenalty,
  getBullpenUncertainty,
  getDayNightAdj,
  getTeamAdjustment,
};
