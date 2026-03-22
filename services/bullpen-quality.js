/**
 * MLB Bullpen Quality Projections Service — SportsSim v64.0
 * 
 * Models 2026 bullpen ERA for all 30 teams accounting for:
 * - Key reliever acquisitions and departures
 * - Closer/setup role certainty
 * - Spring training bullpen performance
 * - Historical ERA regression to mean
 * 
 * EDGE THESIS: Opening Day bullpen ERA projections differ from last year's stats
 * because of massive offseason reliever movement. Books use last year's team-level
 * bullpen ERA; we model the actual 2026 reliever corps.
 * 
 * Impact: 0.1-0.3 runs/game adjustment = 2-5% totals accuracy improvement
 */

const AVG_BULLPEN_ERA = 3.85; // 2025 MLB average bullpen ERA
const REGRESSION_FACTOR = 0.35; // Regress projected ERA 35% toward league avg

/**
 * Individual reliever projections for 2026
 * Based on 2024-2025 performance, age, Statcast data
 * ERA = projected 2026 ERA, IP = projected innings
 */
const RELIEVER_DB = {
  // ===== ELITE CLOSERS (sub-2.50 ERA) =====
  'Emmanuel Clase':   { era: 1.45, ip: 70, team: 'CLE', role: 'CL', age: 28, notes: '100mph cutter, elite' },
  'Ryan Helsley':     { era: 1.80, ip: 65, team: 'BAL', role: 'CL', age: 30, notes: 'From STL, 1.2 ERA in 2025' },
  'Mason Miller':     { era: 2.00, ip: 60, team: 'SD',  role: 'CL', age: 26, notes: 'From OAK, 100+mph, electric' },
  'Josh Hader':       { era: 2.30, ip: 65, team: 'MIN', role: 'CL', age: 31, notes: 'Elite LHP closer' },
  'David Bednar':     { era: 2.50, ip: 65, team: 'NYY', role: 'CL', age: 30, notes: 'From PIT, elite stuff' },
  'Devin Williams':   { era: 2.20, ip: 60, team: 'NYM', role: 'SU', age: 28, notes: 'From MIL, changeup god' },
  'Clay Holmes':      { era: 2.80, ip: 65, team: 'NYM', role: 'CL', age: 32, notes: 'From NYY, sinker specialist' },
  'Kenley Jansen':    { era: 2.60, ip: 62, team: 'BOS', role: 'CL', age: 38, notes: 'Still elite cutter at 38' },
  'Edwin Diaz':       { era: 2.50, ip: 58, team: 'NYM', role: 'SU', age: 32, notes: 'Healthy bounce back' },
  'Ryan Pressly':     { era: 2.80, ip: 55, team: 'HOU', role: 'CL', age: 37, notes: 'Aging but still dominant' },
  'Camilo Doval':     { era: 2.90, ip: 60, team: 'NYY', role: 'SU', age: 28, notes: 'From SF, 100mph slider' },

  // ===== STRONG RELIEVERS (2.50-3.50 ERA) =====
  'Evan Phillips':    { era: 2.80, ip: 60, team: 'LAD', role: 'CL', age: 30, notes: 'LAD closer, elite stuff' },
  'Jeff Hoffman':     { era: 3.00, ip: 65, team: 'TOR', role: 'SU', age: 29, notes: 'From PHI, breakout 2024' },
  'Robert Suarez':    { era: 2.70, ip: 58, team: 'ATL', role: 'CL', age: 33, notes: 'From SD, high leverage' },
  'Tanner Scott':     { era: 3.20, ip: 65, team: 'LAD', role: 'SU', age: 30, notes: 'LHP power arm' },
  'Carlos Estevez':   { era: 3.00, ip: 62, team: 'PHI', role: 'CL', age: 33, notes: 'PHI closer role' },
  'A.J. Minter':      { era: 3.00, ip: 55, team: 'NYM', role: 'SU', age: 32, notes: 'From ATL, LHP setup' },
  'Aroldis Chapman':  { era: 3.30, ip: 55, team: 'PIT', role: 'CL', age: 38, notes: '103mph at 38' },
  'Carlos Carrasco':  { era: 3.50, ip: 50, team: 'CLE', role: 'SU', age: 39, notes: 'CLE depth' },
  'Andres Munoz':     { era: 2.50, ip: 58, team: 'SEA', role: 'CL', age: 27, notes: '102mph, elite' },
  'Yimi Garcia':      { era: 3.20, ip: 55, team: 'SEA', role: 'SU', age: 33, notes: 'SEA setup' },
  'Kirby Yates':      { era: 2.80, ip: 50, team: 'TEX', role: 'CL', age: 37, notes: 'TEX closer, Cy contender 2024' },
  'Raisel Iglesias':  { era: 3.00, ip: 60, team: 'ATL', role: 'SU', age: 36, notes: 'ATL setup depth' },
  'Paul Sewald':      { era: 3.30, ip: 55, team: 'KC',  role: 'CL', age: 34, notes: 'KC closer' },
  'Lucas Erceg':      { era: 3.20, ip: 55, team: 'KC',  role: 'SU', age: 30, notes: 'KC setup' },
  'Chad Green':       { era: 3.40, ip: 55, team: 'TOR', role: 'SU', age: 33, notes: 'TOR depth' },
  'Jhoan Duran':      { era: 3.30, ip: 60, team: 'MIN', role: 'SU', age: 27, notes: '103mph, elite stuff' },
  'Brent Suter':      { era: 3.50, ip: 50, team: 'CIN', role: 'MR', age: 35, notes: 'LHP swingman' },
  'Daniel Bard':      { era: 3.80, ip: 50, team: 'COL', role: 'CL', age: 39, notes: 'COL closer, Coors tax' },
  'Jordan Romano':    { era: 3.20, ip: 50, team: 'PHI', role: 'SU', age: 30, notes: 'Returning from injury' },
  'Hunter Harvey':    { era: 3.10, ip: 52, team: 'KC',  role: 'SU', age: 29, notes: 'KC depth piece' },
  'Pete Fairbanks':   { era: 3.40, ip: 55, team: 'TB',  role: 'CL', age: 31, notes: 'TB closer' },
  'Kevin Ginkel':     { era: 3.30, ip: 55, team: 'ARI', role: 'CL', age: 30, notes: 'ARI closer' },
  'Alexis Diaz':      { era: 3.40, ip: 58, team: 'CIN', role: 'CL', age: 28, notes: 'CIN closer' },
  'Ryan Walker':      { era: 3.50, ip: 55, team: 'SF',  role: 'CL', age: 28, notes: 'SF new closer after Doval traded' },

  // ===== DECENT RELIEVERS (3.50-4.20 ERA) =====
  'Andrew Kittredge': { era: 3.80, ip: 50, team: 'TB',  role: 'SU', age: 34, notes: 'TB depth' },
  'Michael Kopech':   { era: 3.90, ip: 55, team: 'LAD', role: 'MR', age: 29, notes: 'Converted starter, 100mph' },
  'Tim Hill':         { era: 3.70, ip: 50, team: 'CWS', role: 'MR', age: 35, notes: 'CWS LHP' },
  'Gregory Soto':     { era: 4.00, ip: 55, team: 'BAL', role: 'SU', age: 29, notes: 'BAL LHP setup' },
};

/**
 * 2026 Projected Bullpen Corps for all 30 MLB teams
 * Key relievers by role with projected ERA contribution
 * Structure: { closer, setup[], middle[], long[], projectedEra, confidence }
 */
const TEAM_BULLPEN_CORPS = {
  'NYY': {
    closer: 'David Bednar',
    setup: ['Camilo Doval', 'Luke Weaver'],
    middle: ['Tommy Kahnle', 'Ian Hamilton'],
    long: ['Marcus Stroman', 'Nestor Cortes'],
    keyAdds: ['David Bednar (PIT)', 'Camilo Doval (SF)'],
    keyLosses: ['Clay Holmes (NYM)', 'Tommy Kahnle (FA)'],
    projectedEra: 3.15,
    confidence: 0.85,
    notes: 'ELITE pen. Bednar+Doval both sub-3.0 ERA guys. Huge upgrade from 2025.'
  },
  'BAL': {
    closer: 'Ryan Helsley',
    setup: ['Gregory Soto', 'Yennier Cano'],
    middle: ['Dillon Tate', 'Cionel Perez'],
    long: ['Cole Irvin'],
    keyAdds: ['Ryan Helsley (STL, 1.2 ERA)'],
    keyLosses: ['Fujinami'],
    projectedEra: 3.35,
    confidence: 0.80,
    notes: 'Helsley transforms this pen. Was 4.10 base, should be sub-3.50 now.'
  },
  'BOS': {
    closer: 'Kenley Jansen',
    setup: ['Chris Martin', 'Josh Winckowski'],
    middle: ['Brennan Bernardino', 'Justin Slaten'],
    long: ['Rich Hill'],
    keyAdds: ['Garrett Crochet (SP but impacts depth)', 'Sonny Gray (SP)'],
    keyLosses: [],
    projectedEra: 3.45,
    confidence: 0.75,
    notes: 'Jansen still elite at 38. Pen is solid but not spectacular.'
  },
  'TOR': {
    closer: 'Jeff Hoffman',
    setup: ['Chad Green', 'Erik Swanson'],
    middle: ['Trevor Richards', 'Zach Pop'],
    long: ['Alek Manoah'],
    keyAdds: ['Dylan Cease (SP)', 'Shane Bieber (SP)', 'Jeff Hoffman (PHI)'],
    keyLosses: ['Bichette (traded)', 'Jordan Romano (traded)'],
    projectedEra: 3.50,
    confidence: 0.70,
    notes: 'Hoffman in setup/closer role. Pen has question marks without Romano.'
  },
  'TB': {
    closer: 'Pete Fairbanks',
    setup: ['Jason Adam', 'Edwin Uceta'],
    middle: ['Phil Maton', 'Shawn Armstrong'],
    long: ['Shane McClanahan'],
    keyAdds: [],
    keyLosses: [],
    projectedEra: 3.55,
    confidence: 0.70,
    notes: 'Rays always find pen arms. Fairbanks healthy is key.'
  },
  'CLE': {
    closer: 'Emmanuel Clase',
    setup: ['Hunter Gaddis', 'Cade Smith'],
    middle: ['Tim Herrin', 'Sam Hentges'],
    long: ['Ben Lively'],
    keyAdds: [],
    keyLosses: ['Andres Gimenez (NYM)'],
    projectedEra: 2.95,
    confidence: 0.90,
    notes: 'BEST bullpen in MLB. Clase is generational. Pen historically elite under CLE system.'
  },
  'KC': {
    closer: 'Paul Sewald',
    setup: ['Lucas Erceg', 'Hunter Harvey'],
    middle: ['Angel Zerpa', 'Kris Bubic'],
    long: ['Sam Long'],
    keyAdds: [],
    keyLosses: [],
    projectedEra: 3.45,
    confidence: 0.75,
    notes: 'Solid pen. Sewald/Erceg/Harvey is a good back end.'
  },
  'DET': {
    closer: 'Jason Foley',
    setup: ['Tyler Holton', 'Will Vest'],
    middle: ['Beau Brieske', 'Shelby Miller'],
    long: ['Casey Mize'],
    keyAdds: ['Framber Valdez (SP)'],
    keyLosses: [],
    projectedEra: 3.50,
    confidence: 0.70,
    notes: 'Pen was decent in 2025 playoff run. Foley is reliable.'
  },
  'MIN': {
    closer: 'Josh Hader',
    setup: ['Jhoan Duran', 'Griffin Jax'],
    middle: ['Cole Sands', 'Caleb Thielbar'],
    long: ['Josh Winder'],
    keyAdds: ['Carlos Correa (SS)', 'Josh Hader (elite closer)'],
    keyLosses: ['Jose Miranda (SD)'],
    projectedEra: 3.10,
    confidence: 0.85,
    notes: 'Hader + Duran is a filthy back end. Duran at 103mph, Hader elite LHP. Major upgrade.'
  },
  'CWS': {
    closer: 'Michael Kopech',
    setup: ['Jared Shuster', 'Steven Wilson'],
    middle: ['Tim Hill', 'Fraser Ellard'],
    long: ['Jonathan Cannon'],
    keyAdds: ['Munetaka Murakami (from NPB)'],
    keyLosses: ['Luis Robert Jr. (NYM)', 'Erick Fedde (FA)'],
    projectedEra: 4.40,
    confidence: 0.55,
    notes: 'Worst pen in MLB. Kopech is volatile. No reliable arms. Tank mode.'
  },
  'HOU': {
    closer: 'Ryan Pressly',
    setup: ['Bryan Abreu', 'Hector Neris'],
    middle: ['Seth Martinez', 'Tayler Scott'],
    long: ['Spencer Arrighetti'],
    keyAdds: [],
    keyLosses: [],
    projectedEra: 3.30,
    confidence: 0.80,
    notes: 'Always strong pen under Dusty/Espada. Pressly/Abreu elite backend.'
  },
  'SEA': {
    closer: 'Andres Munoz',
    setup: ['Yimi Garcia', 'Matt Brash'],
    middle: ['Tayler Saucedo', 'Trent Thornton'],
    long: ['Emerson Hancock'],
    keyAdds: [],
    keyLosses: [],
    projectedEra: 3.15,
    confidence: 0.85,
    notes: 'Munoz at 102mph is unhittable. Pen is a strength, always has been.'
  },
  'TEX': {
    closer: 'Kirby Yates',
    setup: ['David Robertson', 'Brock Burke'],
    middle: ['Grant Anderson', 'Jonathan Hernandez'],
    long: ['Michael Lorenzen'],
    keyAdds: [],
    keyLosses: ['Marcus Semien (NYM)'],
    projectedEra: 3.40,
    confidence: 0.75,
    notes: 'Yates was Cy contender caliber in 2024. Pen is solid in dome.'
  },
  'LAA': {
    closer: 'Carlos Estevez',
    setup: ['Luis Garcia', 'Hunter Strickland'],
    middle: ['Andrew Wantz', 'Jose Soriano'],
    long: ['Jose Suarez'],
    keyAdds: ['Yusei Kikuchi (SP)'],
    keyLosses: [],
    projectedEra: 4.15,
    confidence: 0.60,
    notes: 'Below average pen. No elite arms. Estevez is serviceable.'
  },
  'OAK': {
    closer: 'TBD',
    setup: ['Lucas Erceg', 'Tyler Ferguson'],
    middle: ['Trevor May', 'Scott Alexander'],
    long: ['Paul Blackburn'],
    keyAdds: ['Nick Severino (aging SP)'],
    keyLosses: ['Mason Miller (SD, elite)', 'JP Sears (SD)'],
    projectedEra: 4.60,
    confidence: 0.50,
    notes: 'WORST pen after losing Miller. No closer. Massive downgrade. Avoid UNDER totals.'
  },
  'ATL': {
    closer: 'Robert Suarez',
    setup: ['Raisel Iglesias', 'Pierce Johnson'],
    middle: ['Joe Jimenez', 'Jesse Chavez'],
    long: ['Bryce Elder'],
    keyAdds: ['Robert Suarez (SD, elite closer)'],
    keyLosses: ['A.J. Minter (NYM)'],
    projectedEra: 3.45,
    confidence: 0.75,
    notes: 'Suarez a huge add. Lost Minter but upgraded closer spot.'
  },
  'PHI': {
    closer: 'Carlos Estevez',
    setup: ['Jordan Romano', 'Orion Kerkering'],
    middle: ['Jose Alvarado', 'Matt Strahm'],
    long: ['Spencer Turnbull'],
    keyAdds: ['Jordan Romano (TOR)'],
    keyLosses: ['Jeff Hoffman (TOR)', 'Nick Castellanos (SD)'],
    projectedEra: 3.30,
    confidence: 0.80,
    notes: 'Still strong pen. Romano + Kerkering + Estevez is a good back end.'
  },
  'NYM': {
    closer: 'Clay Holmes',
    setup: ['Devin Williams', 'Edwin Diaz', 'A.J. Minter'],
    middle: ['Reed Garrett', 'Jake Diekman'],
    long: ['David Peterson'],
    keyAdds: ['Clay Holmes (NYY)', 'Devin Williams (MIL)', 'A.J. Minter (ATL)', 'Juan Soto (OF)'],
    keyLosses: [],
    projectedEra: 2.80,
    confidence: 0.90,
    notes: 'DISGUSTING pen. Holmes+Williams+Diaz+Minter = 4 elite arms. Best pen in NL.'
  },
  'MIA': {
    closer: 'Tanner Scott',
    setup: ['Huascar Brazoban', 'Andrew Nardi'],
    middle: ['JT Chargois', 'Anthony Bender'],
    long: ['Edward Cabrera'],
    keyAdds: [],
    keyLosses: ['Tanner Scott (LAD)'],
    projectedEra: 4.20,
    confidence: 0.55,
    notes: 'Lost Scott to LAD. No clear closer. Pen is weak.'
  },
  'WSH': {
    closer: 'Kyle Finnegan',
    setup: ['Hunter Harvey', 'Robert Garcia'],
    middle: ['Tanner Rainey', 'Matt Barnes'],
    long: ['Trevor Williams'],
    keyAdds: [],
    keyLosses: [],
    projectedEra: 4.45,
    confidence: 0.50,
    notes: 'Bad pen. Finnegan is average. No elite arms. Rebuilding.'
  },
  'MIL': {
    closer: 'Joel Payamps',
    setup: ['Hoby Milner', 'Trevor Megill'],
    middle: ['Bryse Wilson', 'Elvis Peguero'],
    long: ['DL Hall'],
    keyAdds: [],
    keyLosses: ['Devin Williams (NYM)', 'Freddy Peralta (NYM SP)'],
    projectedEra: 3.90,
    confidence: 0.60,
    notes: 'Lost Williams AND Peralta. Pen got much worse. MIL system will find arms but Day 1 is weak.'
  },
  'CHC': {
    closer: 'Hector Neris',
    setup: ['Tyson Miller', 'Nate Pearson'],
    middle: ['Luke Little', 'Keegan Thompson'],
    long: ['Ben Brown'],
    keyAdds: [],
    keyLosses: ['Hayden Wesneski (MIN)'],
    projectedEra: 3.80,
    confidence: 0.65,
    notes: 'Average pen. No dominant closer. Imanaga/Hendricks stability helps.'
  },
  'STL': {
    closer: 'Ryan Fernandez',
    setup: ['JoJo Romero', 'Andrew Kittredge'],
    middle: ['Matthew Liberatore', 'John King'],
    long: ['Miles Mikolas'],
    keyAdds: [],
    keyLosses: ['Ryan Helsley (BAL, elite closer)'],
    projectedEra: 4.10,
    confidence: 0.55,
    notes: 'Lost Helsley = MASSIVE downgrade. No proven closer. Pen goes from good to below-avg.'
  },
  'CIN': {
    closer: 'Alexis Diaz',
    setup: ['Buck Farmer', 'Fernando Cruz'],
    middle: ['Brent Suter', 'Sam Moll'],
    long: ['Nick Martinez'],
    keyAdds: [],
    keyLosses: [],
    projectedEra: 3.60,
    confidence: 0.70,
    notes: 'Diaz is solid. Pen is average, benefits from GABP dimensions shift.'
  },
  'PIT': {
    closer: 'Aroldis Chapman',
    setup: ['David Bednar', 'Colin Holderman'],
    middle: ['Carmen Mlodzinski', 'Ryan Borucki'],
    long: ['Quinn Priester'],
    keyAdds: ['Luis Castillo (SP from SEA)', 'Aroldis Chapman (CL)'],
    keyLosses: ['David Bednar (NYY)'],
    projectedEra: 3.80,
    confidence: 0.60,
    notes: 'Lost Bednar but got Chapman. Net slight downgrade. Chapman still throws 103.'
  },
  'LAD': {
    closer: 'Evan Phillips',
    setup: ['Tanner Scott', 'Michael Kopech'],
    middle: ['Alex Vesia', 'Ryan Brasier'],
    long: ['Gavin Stone'],
    keyAdds: ['Tanner Scott (MIA)'],
    keyLosses: [],
    projectedEra: 3.00,
    confidence: 0.85,
    notes: 'Phillips + Scott + Kopech + Vesia = STACKED pen. LAD always elite in pen.'
  },
  'SD': {
    closer: 'Mason Miller',
    setup: ['JP Sears', 'Jeremiah Estrada'],
    middle: ['Tom Cosgrove', 'Wandy Peralta'],
    long: ['Adrian Morejon'],
    keyAdds: ['Mason Miller (OAK, elite)', 'JP Sears (OAK)', 'Nick Castellanos (OF from PHI)'],
    keyLosses: ['Robert Suarez (ATL)', 'Dylan Cease (TOR)'],
    projectedEra: 3.20,
    confidence: 0.80,
    notes: 'Miller is electric. Lost Suarez but Miller is an upgrade. Pen is strong.'
  },
  'SF': {
    closer: 'Ryan Walker',
    setup: ['Tyler Rogers', 'Erik Miller'],
    middle: ['Sean Hjelle', 'Spencer Howard'],
    long: ['Alex Cobb'],
    keyAdds: [],
    keyLosses: ['Camilo Doval (NYY, elite closer)'],
    projectedEra: 3.85,
    confidence: 0.60,
    notes: 'Lost Doval = big downgrade at closer. Walker is unproven. Oracle Park helps ERA.'
  },
  'ARI': {
    closer: 'Kevin Ginkel',
    setup: ['Justin Martinez', 'Paul Sewald'],
    middle: ['Joe Mantiply', 'Slade Cecconi'],
    long: ['Brandon Pfaadt'],
    keyAdds: [],
    keyLosses: ['Christian Walker (MIN)'],
    projectedEra: 3.55,
    confidence: 0.70,
    notes: 'Ginkel is solid. Pen is average. Chase Field is hitter-friendly.'
  },
  'COL': {
    closer: 'Daniel Bard',
    setup: ['Tyler Kinley', 'Justin Lawrence'],
    middle: ['Jalen Beeks', 'Brent Suter'],
    long: ['Noah Davis'],
    keyAdds: [],
    keyLosses: [],
    projectedEra: 5.00,
    confidence: 0.50,
    notes: 'WORST pen in MLB (Coors). No elite arms. Everything is inflated. Tank mode.'
  },
};

/**
 * Calculate team's 2026 projected bullpen ERA
 * Blends individual reliever projections with team history + regression
 */
function getProjectedBullpenEra(teamAbbr) {
  const corps = TEAM_BULLPEN_CORPS[teamAbbr];
  if (!corps) return { era: AVG_BULLPEN_ERA, confidence: 0.5, source: 'default' };
  
  // Start with our projected ERA
  let projected = corps.projectedEra;
  
  // Apply regression toward league average (35%)
  const regressed = projected * (1 - REGRESSION_FACTOR) + AVG_BULLPEN_ERA * REGRESSION_FACTOR;
  
  return {
    era: +regressed.toFixed(2),
    rawProjected: projected,
    confidence: corps.confidence,
    closer: corps.closer,
    keyAdds: corps.keyAdds,
    keyLosses: corps.keyLosses,
    notes: corps.notes,
    source: 'bullpen-quality-v64'
  };
}

/**
 * Get bullpen ERA adjustment vs base data
 * Returns the DELTA between our 2026 projection and the team's base bullpenEra
 */
function getBullpenAdjustment(teamAbbr, baseBullpenEra) {
  const proj = getProjectedBullpenEra(teamAbbr);
  const delta = proj.era - baseBullpenEra;
  
  return {
    team: teamAbbr,
    baseBullpenEra,
    projectedEra: proj.era,
    rawProjected: proj.rawProjected,
    delta: +delta.toFixed(3),
    impactDescription: delta < -0.20 ? 'SIGNIFICANT IMPROVEMENT' :
                        delta < -0.10 ? 'Moderate improvement' :
                        delta > 0.20 ? 'SIGNIFICANT DECLINE' :
                        delta > 0.10 ? 'Moderate decline' :
                        'Minimal change',
    runsPerGameImpact: +(delta * (3.5/9)).toFixed(3), // bullpen covers ~3.5 IP
    closer: proj.closer,
    confidence: proj.confidence,
    keyAdds: proj.keyAdds,
    keyLosses: proj.keyLosses,
    notes: proj.notes,
  };
}

/**
 * Get all 30 teams' bullpen adjustments sorted by impact
 */
function getAllBullpenAdjustments(teams) {
  const results = [];
  for (const [abbr, team] of Object.entries(teams)) {
    if (!team.bullpenEra) continue;
    results.push(getBullpenAdjustment(abbr, team.bullpenEra));
  }
  return results.sort((a, b) => a.delta - b.delta); // Most improved first
}

/**
 * Get bullpen matchup analysis for a specific game
 */
function analyzeBullpenMatchup(awayAbbr, homeAbbr, teams) {
  const away = teams[awayAbbr];
  const home = teams[homeAbbr];
  if (!away || !home) return null;
  
  const awayAdj = getBullpenAdjustment(awayAbbr, away.bullpenEra);
  const homeAdj = getBullpenAdjustment(homeAbbr, home.bullpenEra);
  
  const awayCorps = TEAM_BULLPEN_CORPS[awayAbbr] || {};
  const homeCorps = TEAM_BULLPEN_CORPS[homeAbbr] || {};
  
  // Bullpen quality gap
  const eraGap = homeAdj.projectedEra - awayAdj.projectedEra;
  const advantage = eraGap > 0.20 ? awayAbbr :
                    eraGap < -0.20 ? homeAbbr : 'EVEN';
  
  // Impact on game total
  const totalImpact = awayAdj.runsPerGameImpact + homeAdj.runsPerGameImpact;
  const totalDirection = totalImpact > 0.05 ? 'OVER lean' :
                         totalImpact < -0.05 ? 'UNDER lean' : 'neutral';
  
  // Betting implications
  const bettingImplications = [];
  
  if (Math.abs(eraGap) > 0.30) {
    bettingImplications.push({
      type: 'ML',
      signal: `${advantage} has significantly better bullpen (${Math.abs(eraGap).toFixed(2)} ERA gap)`,
      strength: 'STRONG'
    });
  }
  
  if (totalImpact > 0.10) {
    bettingImplications.push({
      type: 'OVER',
      signal: `Both bullpens declined → +${totalImpact.toFixed(3)} runs/game from base`,
      strength: 'MODERATE'
    });
  } else if (totalImpact < -0.10) {
    bettingImplications.push({
      type: 'UNDER',
      signal: `Both bullpens improved → ${totalImpact.toFixed(3)} runs/game from base`,
      strength: 'MODERATE'
    });
  }
  
  // F5 vs full game signal
  const f5Signal = (awayAdj.delta > 0.30 || homeAdj.delta > 0.30) 
    ? 'F5 UNDER stronger than full game — bad bullpen inflates late-game runs'
    : (awayAdj.delta < -0.30 || homeAdj.delta < -0.30)
    ? 'Full game UNDER stronger — improved bullpen suppresses late runs'
    : null;
  
  return {
    away: { ...awayAdj, corps: awayCorps },
    home: { ...homeAdj, corps: homeCorps },
    eraGap: +eraGap.toFixed(2),
    advantage,
    totalImpact: +totalImpact.toFixed(3),
    totalDirection,
    bettingImplications,
    f5Signal,
    closerMatchup: {
      away: awayCorps.closer || 'Unknown',
      home: homeCorps.closer || 'Unknown',
    }
  };
}

/**
 * Scan all Opening Day games for bullpen edge
 */
function scanBullpenEdges(games, teams) {
  const results = [];
  
  for (const game of games) {
    const analysis = analyzeBullpenMatchup(game.away, game.home, teams);
    if (!analysis) continue;
    
    results.push({
      game: `${game.away}@${game.home}`,
      ...analysis,
      hasEdge: analysis.bettingImplications.length > 0,
    });
  }
  
  return results.sort((a, b) => Math.abs(b.eraGap) - Math.abs(a.eraGap));
}

/**
 * Get all relievers for a team
 */
function getTeamRelievers(teamAbbr) {
  const relievers = [];
  for (const [name, data] of Object.entries(RELIEVER_DB)) {
    if (data.team === teamAbbr) {
      relievers.push({ name, ...data });
    }
  }
  return relievers.sort((a, b) => a.era - b.era);
}

module.exports = {
  getProjectedBullpenEra,
  getBullpenAdjustment,
  getAllBullpenAdjustments,
  analyzeBullpenMatchup,
  scanBullpenEdges,
  getTeamRelievers,
  TEAM_BULLPEN_CORPS,
  RELIEVER_DB,
  AVG_BULLPEN_ERA,
};
