// models/mlb-pitchers.js — MLB Starting Pitcher Database
// All 30 teams, top 5 rotation pitchers with projected 2025 stats
// Stats: ERA, FIP, xFIP, WHIP, K/9, BB/9, HR/9, IP, WAR, hand, composite rating

const PITCHERS = {
  // ==================== AL EAST ====================
  'NYY': [
    { name: 'Max Fried', team: 'NYY', hand: 'L', era: 3.18, fip: 3.05, xfip: 3.12, whip: 1.08, k9: 8.8, bb9: 2.0, hr9: 0.7, ip: 185, war: 5.0 }, // SIGNED from ATL offseason. NYY OD OPENER per MLB Stats API.
    { name: 'Gerrit Cole', team: 'NYY', hand: 'R', era: 3.41, fip: 3.28, xfip: 3.35, whip: 1.07, k9: 10.6, bb9: 2.1, hr9: 1.0, ip: 200, war: 5.2 },
    { name: 'Carlos Rodon', team: 'NYY', hand: 'L', era: 4.12, fip: 3.88, xfip: 3.95, whip: 1.22, k9: 10.1, bb9: 3.2, hr9: 1.3, ip: 170, war: 2.8 },
    { name: 'Clarke Schmidt', team: 'NYY', hand: 'R', era: 3.78, fip: 3.65, xfip: 3.72, whip: 1.18, k9: 8.8, bb9: 2.5, hr9: 0.9, ip: 150, war: 2.5 },
    { name: 'Marcus Stroman', team: 'NYY', hand: 'R', era: 4.25, fip: 4.10, xfip: 4.15, whip: 1.28, k9: 7.2, bb9: 2.8, hr9: 1.0, ip: 155, war: 1.8 },
    { name: 'Luis Gil', team: 'NYY', hand: 'R', era: 3.50, fip: 3.42, xfip: 3.55, whip: 1.15, k9: 11.2, bb9: 3.8, hr9: 0.9, ip: 145, war: 3.0 },
    { name: 'Cam Schlittler', team: 'NYY', hand: 'R', era: 4.50, fip: 4.20, xfip: 4.30, whip: 1.25, k9: 9.0, bb9: 3.5, hr9: 1.0, ip: 60, war: 0.5 }, // Rookie prospect, limited MLB experience. OD Day 2 starter.
  ],
  'BAL': [
    { name: 'Corbin Burnes', team: 'BAL', hand: 'R', era: 3.15, fip: 3.05, xfip: 3.12, whip: 1.08, k9: 9.8, bb9: 2.0, hr9: 0.8, ip: 200, war: 5.5 },
    { name: 'Grayson Rodriguez', team: 'BAL', hand: 'R', era: 3.62, fip: 3.48, xfip: 3.55, whip: 1.15, k9: 9.5, bb9: 2.8, hr9: 0.9, ip: 175, war: 3.5 },
    { name: 'Dean Kremer', team: 'BAL', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 8.2, bb9: 2.5, hr9: 1.2, ip: 155, war: 1.8 },
    { name: 'Albert Suarez', team: 'BAL', hand: 'R', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.20, k9: 7.8, bb9: 2.2, hr9: 1.0, ip: 140, war: 2.0 },
    { name: 'Cade Povich', team: 'BAL', hand: 'L', era: 4.35, fip: 4.15, xfip: 4.25, whip: 1.28, k9: 8.5, bb9: 3.0, hr9: 1.1, ip: 130, war: 1.5 },
    { name: 'Trevor Rogers', team: 'BAL', hand: 'L', era: 1.81, fip: 2.81, xfip: 3.20, whip: 0.90, k9: 8.5, bb9: 2.4, hr9: 0.5, ip: 110, war: 4.5 }, // 2025 breakout with BAL: 9-3, 1.81 ERA in 18 starts — ace-level but only 110 IP (injury concern). Opening Day starter.
  ],
  'BOS': [
    { name: 'Garrett Crochet', team: 'BOS', hand: 'L', era: 3.55, fip: 3.40, xfip: 3.48, whip: 1.08, k9: 12.0, bb9: 2.5, hr9: 0.8, ip: 145, war: 3.5 }, // ACE — acquired from CWS
    { name: 'Sonny Gray', team: 'BOS', hand: 'R', era: 3.45, fip: 3.32, xfip: 3.40, whip: 1.10, k9: 9.5, bb9: 2.5, hr9: 0.9, ip: 185, war: 4.2 }, // #2 — acquired from STL
    { name: 'Brayan Bello', team: 'BOS', hand: 'R', era: 3.72, fip: 3.58, xfip: 3.65, whip: 1.18, k9: 8.5, bb9: 2.8, hr9: 0.9, ip: 180, war: 3.2 },
    { name: 'Tanner Houck', team: 'BOS', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.12, k9: 9.2, bb9: 2.5, hr9: 0.8, ip: 170, war: 3.5 },
    { name: 'Kutter Crawford', team: 'BOS', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.15, k9: 9.5, bb9: 2.2, hr9: 1.1, ip: 165, war: 2.8 },
  ],
  'TOR': [
    { name: 'Kevin Gausman', team: 'TOR', hand: 'R', era: 3.68, fip: 3.52, xfip: 3.60, whip: 1.12, k9: 9.8, bb9: 2.0, hr9: 1.1, ip: 185, war: 3.8 },
    { name: 'Jose Berrios', team: 'TOR', hand: 'R', era: 3.85, fip: 3.72, xfip: 3.78, whip: 1.18, k9: 8.5, bb9: 2.2, hr9: 1.0, ip: 180, war: 3.0 },
    { name: 'Chris Bassitt', team: 'TOR', hand: 'R', era: 4.10, fip: 3.95, xfip: 4.02, whip: 1.25, k9: 8.0, bb9: 2.5, hr9: 1.0, ip: 170, war: 2.2 },
    { name: 'Bowden Francis', team: 'TOR', hand: 'R', era: 4.28, fip: 4.10, xfip: 4.18, whip: 1.22, k9: 9.2, bb9: 2.8, hr9: 1.2, ip: 140, war: 1.5 },
    { name: 'Yariel Rodriguez', team: 'TOR', hand: 'R', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 8.8, bb9: 3.2, hr9: 1.1, ip: 130, war: 1.2 },
  ],
  'TB': [
    { name: 'Zack Littell', team: 'TB', hand: 'R', era: 3.82, fip: 3.68, xfip: 3.75, whip: 1.15, k9: 8.2, bb9: 2.0, hr9: 1.0, ip: 165, war: 2.8 },
    { name: 'Ryan Pepiot', team: 'TB', hand: 'R', era: 3.65, fip: 3.50, xfip: 3.58, whip: 1.12, k9: 10.5, bb9: 2.8, hr9: 0.9, ip: 150, war: 3.0 },
    { name: 'Shane Baz', team: 'TB', hand: 'R', era: 4.15, fip: 3.95, xfip: 4.05, whip: 1.22, k9: 9.8, bb9: 3.0, hr9: 1.1, ip: 130, war: 2.0 },
    { name: 'Taj Bradley', team: 'TB', hand: 'R', era: 4.35, fip: 4.15, xfip: 4.22, whip: 1.25, k9: 9.0, bb9: 3.2, hr9: 1.2, ip: 140, war: 1.5 },
    { name: 'Aaron Civale', team: 'TB', hand: 'R', era: 4.50, fip: 4.30, xfip: 4.38, whip: 1.28, k9: 7.5, bb9: 2.5, hr9: 1.1, ip: 145, war: 1.2 },
    { name: 'Drew Rasmussen', team: 'TB', hand: 'R', era: 2.76, fip: 3.83, xfip: 3.90, whip: 1.02, k9: 7.6, bb9: 2.2, hr9: 1.1, ip: 150, war: 3.4 }, // 2025 comeback: 10-5, 2.76 ERA in 31 starts. Elite ground ball pitcher. Opening Day starter.
  ],

  // ==================== AL CENTRAL ====================
  'CLE': [
    { name: 'Tanner Bibee', team: 'CLE', hand: 'R', era: 3.45, fip: 3.30, xfip: 3.38, whip: 1.10, k9: 9.8, bb9: 2.2, hr9: 0.8, ip: 185, war: 4.2 },
    { name: 'Gavin Williams', team: 'CLE', hand: 'R', era: 3.72, fip: 3.55, xfip: 3.62, whip: 1.15, k9: 10.2, bb9: 3.0, hr9: 0.9, ip: 155, war: 3.0 },
    { name: 'Logan Allen', team: 'CLE', hand: 'L', era: 4.05, fip: 3.90, xfip: 3.98, whip: 1.22, k9: 8.0, bb9: 2.8, hr9: 1.0, ip: 165, war: 2.2 },
    { name: 'Ben Lively', team: 'CLE', hand: 'R', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.18, k9: 7.5, bb9: 2.0, hr9: 1.0, ip: 160, war: 2.5 },
    { name: 'Matthew Boyd', team: 'CHC', hand: 'L', era: 4.20, fip: 4.02, xfip: 4.10, whip: 1.25, k9: 8.5, bb9: 2.5, hr9: 1.2, ip: 140, war: 1.5 }, // SIGNED by CHC offseason 2025-26
  ],
  'KC': [
    { name: 'Seth Lugo', team: 'KC', hand: 'R', era: 3.42, fip: 3.30, xfip: 3.38, whip: 1.10, k9: 8.8, bb9: 1.8, hr9: 0.9, ip: 195, war: 4.5 },
    { name: 'Cole Ragans', team: 'KC', hand: 'L', era: 3.55, fip: 3.40, xfip: 3.48, whip: 1.12, k9: 10.5, bb9: 2.8, hr9: 0.8, ip: 180, war: 3.8 },
    { name: 'Michael Wacha', team: 'KC', hand: 'R', era: 3.75, fip: 3.62, xfip: 3.70, whip: 1.18, k9: 8.2, bb9: 2.2, hr9: 1.0, ip: 175, war: 2.8 },
    { name: 'Brady Singer', team: 'KC', hand: 'R', era: 4.15, fip: 3.98, xfip: 4.05, whip: 1.25, k9: 8.0, bb9: 2.5, hr9: 1.1, ip: 160, war: 2.0 },
    { name: 'Kris Bubic', team: 'KC', hand: 'L', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.32, k9: 7.5, bb9: 3.5, hr9: 1.0, ip: 130, war: 1.0 },
  ],
  'DET': [
    { name: 'Tarik Skubal', team: 'DET', hand: 'L', era: 2.80, fip: 2.72, xfip: 2.85, whip: 0.98, k9: 10.8, bb9: 1.8, hr9: 0.7, ip: 200, war: 6.5 },
    { name: 'Jack Flaherty', team: 'DET', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.12, k9: 10.0, bb9: 2.5, hr9: 1.0, ip: 175, war: 3.5 },
    { name: 'Reese Olson', team: 'DET', hand: 'R', era: 3.92, fip: 3.78, xfip: 3.85, whip: 1.20, k9: 8.5, bb9: 2.5, hr9: 1.0, ip: 160, war: 2.5 },
    { name: 'Casey Mize', team: 'DET', hand: 'R', era: 4.15, fip: 3.98, xfip: 4.05, whip: 1.22, k9: 7.8, bb9: 2.2, hr9: 1.1, ip: 150, war: 2.0 },
    { name: 'Keider Montero', team: 'DET', hand: 'R', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.32, k9: 7.2, bb9: 3.0, hr9: 1.2, ip: 120, war: 0.8 },
  ],
  'MIN': [
    { name: 'Pablo Lopez', team: 'MIN', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.10, k9: 9.5, bb9: 2.0, hr9: 1.0, ip: 190, war: 4.0 },
    { name: 'Joe Ryan', team: 'MIN', hand: 'R', era: 3.72, fip: 3.58, xfip: 3.65, whip: 1.12, k9: 10.0, bb9: 2.2, hr9: 1.2, ip: 175, war: 3.2 },
    { name: 'Bailey Ober', team: 'MIN', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.15, k9: 9.2, bb9: 1.8, hr9: 1.1, ip: 170, war: 3.0 },
    { name: 'Simeon Woods Richardson', team: 'MIN', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 8.0, bb9: 2.8, hr9: 1.0, ip: 150, war: 1.8 },
    { name: 'Chris Paddack', team: 'MIN', hand: 'R', era: 4.45, fip: 4.28, xfip: 4.35, whip: 1.28, k9: 7.8, bb9: 2.5, hr9: 1.2, ip: 140, war: 1.2 },
  ],
  'CWS': [
    { name: 'Garrett Crochet', team: 'BOS', hand: 'L', era: 3.55, fip: 3.40, xfip: 3.48, whip: 1.08, k9: 12.0, bb9: 2.5, hr9: 0.8, ip: 145, war: 3.5 }, // TRADED to BOS offseason 2025-26
    { name: 'Erick Fedde', team: 'CWS', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.18, k9: 8.2, bb9: 2.2, hr9: 1.0, ip: 175, war: 2.5 },
    { name: 'Chris Flexen', team: 'CWS', hand: 'R', era: 5.05, fip: 4.82, xfip: 4.90, whip: 1.38, k9: 6.8, bb9: 3.0, hr9: 1.3, ip: 150, war: 0.2 },
    { name: 'Jonathan Cannon', team: 'CWS', hand: 'R', era: 5.22, fip: 4.95, xfip: 5.02, whip: 1.40, k9: 6.5, bb9: 3.2, hr9: 1.4, ip: 130, war: -0.2 },
    { name: 'Drew Thorpe', team: 'CWS', hand: 'R', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.30, k9: 8.0, bb9: 2.8, hr9: 1.1, ip: 140, war: 1.0 },
    { name: 'Shane Smith', team: 'CWS', hand: 'R', era: 3.81, fip: 4.09, xfip: 4.15, whip: 1.20, k9: 8.9, bb9: 3.6, hr9: 1.1, ip: 146, war: 3.4 }, // 2025 rookie breakout: 7-8, 3.81 ERA in 29 starts
  ],

  // ==================== AL WEST ====================
  'HOU': [
    { name: 'Framber Valdez', team: 'HOU', hand: 'L', era: 3.38, fip: 3.25, xfip: 3.32, whip: 1.12, k9: 8.8, bb9: 2.5, hr9: 0.7, ip: 200, war: 4.8 },
    { name: 'Hunter Brown', team: 'HOU', hand: 'R', era: 3.72, fip: 3.55, xfip: 3.62, whip: 1.18, k9: 9.5, bb9: 3.0, hr9: 0.9, ip: 175, war: 3.0 },
    { name: 'Ronel Blanco', team: 'HOU', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.10, k9: 9.0, bb9: 2.5, hr9: 0.8, ip: 160, war: 3.2 },
    { name: 'Spencer Arrighetti', team: 'HOU', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 10.2, bb9: 3.5, hr9: 1.1, ip: 150, war: 1.8 },
    { name: 'Justin Verlander', team: 'HOU', hand: 'R', era: 4.05, fip: 3.88, xfip: 3.95, whip: 1.18, k9: 8.5, bb9: 2.2, hr9: 1.2, ip: 155, war: 2.2 },
    { name: 'Mike Burrows', team: 'HOU', hand: 'R', era: 4.30, fip: 4.00, xfip: 4.10, whip: 1.22, k9: 9.5, bb9: 3.2, hr9: 1.0, ip: 80, war: 1.0 }, // Young arm acquired from PIT, back-end starter. OD Day 2 start.
  ],
  'SEA': [
    { name: 'Logan Gilbert', team: 'SEA', hand: 'R', era: 3.22, fip: 3.10, xfip: 3.18, whip: 1.05, k9: 9.5, bb9: 1.8, hr9: 0.9, ip: 195, war: 5.0 },
    { name: 'George Kirby', team: 'SEA', hand: 'R', era: 3.35, fip: 3.22, xfip: 3.30, whip: 1.02, k9: 9.0, bb9: 1.5, hr9: 0.9, ip: 190, war: 4.8 },
    { name: 'Luis Castillo', team: 'SEA', hand: 'R', era: 3.62, fip: 3.48, xfip: 3.55, whip: 1.15, k9: 9.2, bb9: 2.5, hr9: 1.0, ip: 185, war: 3.5 },
    { name: 'Bryan Woo', team: 'SEA', hand: 'R', era: 3.45, fip: 3.32, xfip: 3.40, whip: 1.08, k9: 9.8, bb9: 2.0, hr9: 0.9, ip: 150, war: 3.2 },
    { name: 'Bryce Miller', team: 'SEA', hand: 'R', era: 3.78, fip: 3.62, xfip: 3.70, whip: 1.15, k9: 8.8, bb9: 2.2, hr9: 1.0, ip: 175, war: 2.8 },
  ],
  'TEX': [
    { name: 'Nathan Eovaldi', team: 'TEX', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.10, k9: 8.5, bb9: 2.0, hr9: 1.0, ip: 180, war: 3.5 },
    { name: 'Jon Gray', team: 'TEX', hand: 'R', era: 4.15, fip: 3.98, xfip: 4.05, whip: 1.22, k9: 8.2, bb9: 2.5, hr9: 1.1, ip: 165, war: 2.0 },
    { name: 'Andrew Heaney', team: 'TEX', hand: 'L', era: 4.35, fip: 4.15, xfip: 4.22, whip: 1.25, k9: 9.5, bb9: 2.8, hr9: 1.4, ip: 155, war: 1.5 },
    { name: 'Cody Bradford', team: 'TEX', hand: 'L', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.15, k9: 7.8, bb9: 2.0, hr9: 0.9, ip: 140, war: 2.2 },
    { name: 'Kumar Rocker', team: 'TEX', hand: 'R', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 9.0, bb9: 3.2, hr9: 1.2, ip: 130, war: 1.2 },
  ],
  'LAA': [
    { name: 'Yusei Kikuchi', team: 'LAA', hand: 'L', era: 4.05, fip: 3.85, xfip: 3.92, whip: 1.22, k9: 9.5, bb9: 2.8, hr9: 1.1, ip: 167, war: 2.5 }, // Signed w/ LAA offseason
    { name: 'Tyler Anderson', team: 'LAA', hand: 'L', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 7.5, bb9: 2.2, hr9: 1.2, ip: 170, war: 1.8 },
    { name: 'Reid Detmers', team: 'LAA', hand: 'L', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.28, k9: 9.0, bb9: 3.0, hr9: 1.2, ip: 150, war: 1.2 },
    { name: 'Griffin Canning', team: 'LAA', hand: 'R', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.30, k9: 8.5, bb9: 2.8, hr9: 1.3, ip: 140, war: 1.0 },
    { name: 'Patrick Sandoval', team: 'LAA', hand: 'L', era: 4.12, fip: 3.95, xfip: 4.02, whip: 1.22, k9: 8.8, bb9: 3.0, hr9: 1.0, ip: 145, war: 1.8 },
    { name: 'Jose Soriano', team: 'LAA', hand: 'R', era: 4.35, fip: 4.15, xfip: 4.22, whip: 1.25, k9: 8.2, bb9: 2.5, hr9: 1.1, ip: 135, war: 1.5 },
  ],
  'OAK': [
    { name: 'JP Sears', team: 'OAK', hand: 'L', era: 4.35, fip: 4.18, xfip: 4.25, whip: 1.22, k9: 8.0, bb9: 2.5, hr9: 1.2, ip: 170, war: 1.5 },
    { name: 'Mitch Spence', team: 'OAK', hand: 'R', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.30, k9: 7.5, bb9: 2.8, hr9: 1.2, ip: 150, war: 1.0 },
    { name: 'Joey Estes', team: 'OAK', hand: 'R', era: 4.82, fip: 4.58, xfip: 4.65, whip: 1.32, k9: 7.2, bb9: 2.5, hr9: 1.3, ip: 140, war: 0.5 },
    { name: 'Luis Medina', team: 'OAK', hand: 'R', era: 5.15, fip: 4.88, xfip: 4.95, whip: 1.40, k9: 8.5, bb9: 4.0, hr9: 1.2, ip: 120, war: 0.2 },
    { name: 'Osvaldo Bido', team: 'OAK', hand: 'R', era: 4.95, fip: 4.72, xfip: 4.80, whip: 1.35, k9: 7.8, bb9: 3.2, hr9: 1.3, ip: 130, war: 0.5 },
    { name: 'Luis Severino', team: 'OAK', hand: 'R', era: 4.54, fip: 4.10, xfip: 4.20, whip: 1.30, k9: 6.9, bb9: 2.8, hr9: 0.9, ip: 163, war: 1.3 }, // 2025 with OAK: 8-11, 4.54 ERA in 29 starts. Veteran innings eater. Opening Day starter.
  ],

  // ==================== NL EAST ====================
  'ATL': [
    { name: 'Chris Sale', team: 'ATL', hand: 'L', era: 2.95, fip: 2.85, xfip: 2.92, whip: 1.02, k9: 11.0, bb9: 2.0, hr9: 0.8, ip: 190, war: 6.0 },
    { name: 'Spencer Strider', team: 'ATL', hand: 'R', era: 3.22, fip: 3.08, xfip: 3.15, whip: 1.05, k9: 12.5, bb9: 2.5, hr9: 0.8, ip: 150, war: 4.5 },
    { name: 'Max Fried', team: 'ATL', hand: 'L', era: 3.18, fip: 3.05, xfip: 3.12, whip: 1.08, k9: 8.8, bb9: 2.0, hr9: 0.7, ip: 185, war: 5.0 },
    { name: 'Reynaldo Lopez', team: 'ATL', hand: 'R', era: 3.42, fip: 3.30, xfip: 3.38, whip: 1.12, k9: 9.5, bb9: 2.5, hr9: 0.9, ip: 170, war: 3.5 },
    { name: 'Charlie Morton', team: 'ATL', hand: 'R', era: 4.05, fip: 3.88, xfip: 3.95, whip: 1.22, k9: 9.2, bb9: 3.0, hr9: 1.1, ip: 160, war: 2.2 },
  ],
  'PHI': [
    { name: 'Zack Wheeler', team: 'PHI', hand: 'R', era: 3.05, fip: 2.95, xfip: 3.02, whip: 1.05, k9: 10.2, bb9: 2.0, hr9: 0.8, ip: 200, war: 6.0 },
    { name: 'Aaron Nola', team: 'PHI', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.10, k9: 9.5, bb9: 2.2, hr9: 1.0, ip: 195, war: 4.0 },
    { name: 'Ranger Suarez', team: 'PHI', hand: 'L', era: 3.35, fip: 3.22, xfip: 3.30, whip: 1.08, k9: 8.2, bb9: 2.2, hr9: 0.7, ip: 180, war: 4.2 },
    { name: 'Cristopher Sanchez', team: 'PHI', hand: 'L', era: 3.72, fip: 3.58, xfip: 3.65, whip: 1.15, k9: 7.8, bb9: 2.5, hr9: 0.8, ip: 165, war: 2.8 },
    { name: 'Taijuan Walker', team: 'PHI', hand: 'R', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 7.5, bb9: 2.8, hr9: 1.3, ip: 140, war: 0.8 },
  ],
  'NYM': [
    { name: 'Kodai Senga', team: 'NYM', hand: 'R', era: 3.22, fip: 3.10, xfip: 3.18, whip: 1.08, k9: 11.5, bb9: 2.5, hr9: 0.8, ip: 165, war: 4.5 },
    { name: 'Sean Manaea', team: 'NYM', hand: 'L', era: 3.68, fip: 3.55, xfip: 3.62, whip: 1.15, k9: 8.5, bb9: 2.2, hr9: 1.0, ip: 180, war: 3.0 },
    { name: 'David Peterson', team: 'NYM', hand: 'L', era: 3.92, fip: 3.78, xfip: 3.85, whip: 1.20, k9: 8.0, bb9: 2.8, hr9: 0.9, ip: 165, war: 2.5 },
    { name: 'Jose Quintana', team: 'NYM', hand: 'L', era: 4.15, fip: 3.98, xfip: 4.05, whip: 1.25, k9: 7.5, bb9: 2.5, hr9: 1.0, ip: 155, war: 1.8 },
    { name: 'Frankie Montas', team: 'NYM', hand: 'R', era: 4.45, fip: 4.28, xfip: 4.35, whip: 1.28, k9: 8.2, bb9: 2.8, hr9: 1.2, ip: 140, war: 1.2 },
  ],
  'MIA': [
    { name: 'Jesus Luzardo', team: 'MIA', hand: 'L', era: 3.82, fip: 3.65, xfip: 3.72, whip: 1.15, k9: 10.5, bb9: 2.8, hr9: 1.0, ip: 155, war: 3.0 },
    { name: 'Braxton Garrett', team: 'MIA', hand: 'L', era: 4.28, fip: 4.12, xfip: 4.18, whip: 1.25, k9: 8.5, bb9: 2.5, hr9: 1.1, ip: 160, war: 1.5 },
    { name: 'Edward Cabrera', team: 'MIA', hand: 'R', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 9.5, bb9: 3.5, hr9: 1.1, ip: 130, war: 1.0 },
    { name: 'Ryan Weathers', team: 'MIA', hand: 'L', era: 4.82, fip: 4.58, xfip: 4.65, whip: 1.35, k9: 7.8, bb9: 3.2, hr9: 1.2, ip: 120, war: 0.5 },
    { name: 'Eury Perez', team: 'MIA', hand: 'R', era: 4.15, fip: 3.88, xfip: 3.95, whip: 1.18, k9: 9.2, bb9: 2.8, hr9: 1.0, ip: 90, war: 1.5 }, // Elite prospect, big arm. Limited IP in 2025 (injury recovery)
    { name: 'Max Meyer', team: 'MIA', hand: 'R', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.28, k9: 8.8, bb9: 3.0, hr9: 1.1, ip: 125, war: 0.8 },
    { name: 'Sandy Alcantara', team: 'MIA', hand: 'R', era: 5.36, fip: 4.27, xfip: 4.35, whip: 1.27, k9: 7.3, bb9: 2.9, hr9: 1.1, ip: 175, war: 0.5 }, // 2025 return from Tommy John: 11-12, 5.36 ERA in 31 starts. FIP (4.27) much better than ERA — unlucky or still recovering. Former Cy Young winner. Opening Day starter.
  ],
  'WSH': [
    { name: 'MacKenzie Gore', team: 'WSH', hand: 'L', era: 3.72, fip: 3.58, xfip: 3.65, whip: 1.15, k9: 9.5, bb9: 3.0, hr9: 0.9, ip: 170, war: 3.0 },
    { name: 'Jake Irvin', team: 'WSH', hand: 'R', era: 4.15, fip: 3.98, xfip: 4.05, whip: 1.22, k9: 8.0, bb9: 2.5, hr9: 1.1, ip: 165, war: 2.0 },
    { name: 'Mitchell Parker', team: 'WSH', hand: 'L', era: 4.35, fip: 4.18, xfip: 4.25, whip: 1.25, k9: 8.5, bb9: 2.8, hr9: 1.0, ip: 150, war: 1.5 },
    { name: 'DJ Herz', team: 'WSH', hand: 'L', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.28, k9: 10.0, bb9: 3.5, hr9: 1.1, ip: 130, war: 1.2 },
    { name: 'Patrick Corbin', team: 'WSH', hand: 'L', era: 5.22, fip: 4.95, xfip: 5.02, whip: 1.42, k9: 7.0, bb9: 3.0, hr9: 1.5, ip: 155, war: -0.5 },
    { name: 'Cade Cavalli', team: 'WSH', hand: 'R', era: 4.25, fip: 4.53, xfip: 4.45, whip: 1.48, k9: 7.4, bb9: 2.8, hr9: 1.3, ip: 49, war: -0.2 }, // 2025 rookie: 3-1, 4.25 ERA in 10 starts (48.2 IP). High upside arm, small sample. Opening Day starter.
  ],

  // ==================== NL CENTRAL ====================
  'MIL': [
    { name: 'Freddy Peralta', team: 'NYM', hand: 'R', era: 3.42, fip: 3.28, xfip: 3.35, whip: 1.10, k9: 10.5, bb9: 2.5, hr9: 0.9, ip: 180, war: 4.2 }, // TRADED to NYM offseason 2025-26
    { name: 'Colin Rea', team: 'MIL', hand: 'R', era: 3.78, fip: 3.65, xfip: 3.72, whip: 1.15, k9: 8.0, bb9: 2.0, hr9: 0.9, ip: 170, war: 2.8 },
    { name: 'Tobias Myers', team: 'MIL', hand: 'R', era: 3.92, fip: 3.78, xfip: 3.85, whip: 1.18, k9: 8.2, bb9: 2.2, hr9: 1.0, ip: 155, war: 2.2 },
    { name: 'Jacob Misiorowski', team: 'MIL', hand: 'R', era: 4.10, fip: 3.85, xfip: 3.90, whip: 1.28, k9: 10.8, bb9: 4.0, hr9: 0.8, ip: 80, war: 1.0 }, // Top prospect — elite stuff, control issues
    { name: 'Frankie Montas', team: 'MIL', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 8.5, bb9: 2.5, hr9: 1.2, ip: 145, war: 1.5 },
    { name: 'Aaron Ashby', team: 'MIL', hand: 'L', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 9.0, bb9: 3.5, hr9: 1.0, ip: 120, war: 1.0 },
  ],
  'CHC': [
    { name: 'Shota Imanaga', team: 'CHC', hand: 'L', era: 3.12, fip: 3.00, xfip: 3.08, whip: 1.02, k9: 10.0, bb9: 1.8, hr9: 0.9, ip: 175, war: 5.0 },
    { name: 'Justin Steele', team: 'CHC', hand: 'L', era: 3.42, fip: 3.28, xfip: 3.35, whip: 1.08, k9: 9.0, bb9: 2.2, hr9: 0.8, ip: 180, war: 4.2 },
    { name: 'Jameson Taillon', team: 'CHC', hand: 'R', era: 4.05, fip: 3.90, xfip: 3.98, whip: 1.22, k9: 7.5, bb9: 2.2, hr9: 1.1, ip: 170, war: 2.0 },
    { name: 'Javier Assad', team: 'CHC', hand: 'R', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.18, k9: 7.8, bb9: 2.5, hr9: 0.9, ip: 155, war: 2.2 },
    { name: 'Jordan Wicks', team: 'CHC', hand: 'L', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 8.0, bb9: 3.0, hr9: 1.0, ip: 130, war: 1.2 },
    { name: 'Kyle Hendricks', team: 'CHC', hand: 'R', era: 4.78, fip: 4.58, xfip: 4.65, whip: 1.32, k9: 6.2, bb9: 2.0, hr9: 1.3, ip: 120, war: 0.5 }, // Veteran contact manager, low K but great control
  ],
  'STL': [
    { name: 'Sonny Gray', team: 'BOS', hand: 'R', era: 3.45, fip: 3.32, xfip: 3.40, whip: 1.10, k9: 9.5, bb9: 2.5, hr9: 0.9, ip: 185, war: 4.2 }, // TRADED to BOS offseason 2025-26
    { name: 'Miles Mikolas', team: 'STL', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.22, k9: 7.0, bb9: 1.8, hr9: 1.2, ip: 180, war: 1.8 },
    { name: 'Steven Matz', team: 'STL', hand: 'L', era: 4.45, fip: 4.28, xfip: 4.35, whip: 1.28, k9: 7.5, bb9: 2.5, hr9: 1.2, ip: 150, war: 1.2 },
    { name: 'Andre Pallante', team: 'STL', hand: 'R', era: 4.12, fip: 3.95, xfip: 4.02, whip: 1.20, k9: 7.2, bb9: 2.8, hr9: 1.0, ip: 155, war: 1.8 },
    { name: 'Matthew Liberatore', team: 'STL', hand: 'L', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 7.8, bb9: 3.2, hr9: 1.1, ip: 130, war: 1.0 },
  ],
  'PIT': [
    { name: 'Paul Skenes', team: 'PIT', hand: 'R', era: 3.05, fip: 2.92, xfip: 3.00, whip: 1.00, k9: 12.0, bb9: 2.2, hr9: 0.7, ip: 170, war: 5.5 },
    { name: 'Jared Jones', team: 'PIT', hand: 'R', era: 3.72, fip: 3.55, xfip: 3.62, whip: 1.15, k9: 10.5, bb9: 3.0, hr9: 0.9, ip: 155, war: 3.0 },
    { name: 'Mitch Keller', team: 'PIT', hand: 'R', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.18, k9: 8.8, bb9: 2.5, hr9: 1.0, ip: 175, war: 2.8 },
    { name: 'Bailey Falter', team: 'PIT', hand: 'L', era: 4.35, fip: 4.18, xfip: 4.25, whip: 1.25, k9: 7.5, bb9: 2.2, hr9: 1.2, ip: 160, war: 1.5 },
    { name: 'Luis Ortiz', team: 'PIT', hand: 'R', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.28, k9: 8.0, bb9: 2.8, hr9: 1.1, ip: 140, war: 1.0 },
  ],
  'CIN': [
    { name: 'Hunter Greene', team: 'CIN', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.12, k9: 11.5, bb9: 2.8, hr9: 1.0, ip: 175, war: 3.5 },
    { name: 'Andrew Abbott', team: 'CIN', hand: 'L', era: 3.72, fip: 3.58, xfip: 3.65, whip: 1.15, k9: 10.0, bb9: 3.0, hr9: 0.9, ip: 165, war: 2.8 },
    { name: 'Nick Lodolo', team: 'CIN', hand: 'L', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.18, k9: 9.2, bb9: 2.5, hr9: 1.0, ip: 155, war: 2.5 },
    { name: 'Graham Ashcraft', team: 'CIN', hand: 'R', era: 4.35, fip: 4.18, xfip: 4.25, whip: 1.25, k9: 7.5, bb9: 2.5, hr9: 1.2, ip: 150, war: 1.2 },
    { name: 'Brandon Williamson', team: 'CIN', hand: 'L', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.30, k9: 8.5, bb9: 3.2, hr9: 1.1, ip: 130, war: 0.8 },
  ],

  // ==================== NL WEST ====================
  'LAD': [
    { name: 'Yoshinobu Yamamoto', team: 'LAD', hand: 'R', era: 3.05, fip: 2.92, xfip: 3.00, whip: 1.02, k9: 10.5, bb9: 2.0, hr9: 0.7, ip: 185, war: 5.5 },
    { name: 'Tyler Glasnow', team: 'LAD', hand: 'R', era: 3.15, fip: 3.02, xfip: 3.10, whip: 1.05, k9: 11.8, bb9: 2.5, hr9: 0.8, ip: 170, war: 5.0 },
    { name: 'Clayton Kershaw', team: 'LAD', hand: 'L', era: 3.65, fip: 3.52, xfip: 3.60, whip: 1.12, k9: 8.5, bb9: 2.0, hr9: 1.0, ip: 140, war: 2.5 },
    { name: 'Bobby Miller', team: 'LAD', hand: 'R', era: 4.05, fip: 3.88, xfip: 3.95, whip: 1.20, k9: 9.0, bb9: 3.0, hr9: 1.1, ip: 150, war: 2.0 },
    { name: 'Walker Buehler', team: 'LAD', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.15, k9: 9.5, bb9: 2.5, hr9: 1.0, ip: 155, war: 2.8 },
    { name: 'Shohei Ohtani', team: 'LAD', hand: 'L', era: 2.87, fip: 1.89, xfip: 2.50, whip: 1.04, k9: 11.87, bb9: 1.72, hr9: 0.57, ip: 47, war: 2.5 },
    { name: 'Emmet Sheehan', team: 'LAD', hand: 'R', era: 2.82, fip: 3.15, xfip: 3.25, whip: 0.97, k9: 10.9, bb9: 2.5, hr9: 0.8, ip: 73, war: 2.0 }, // 2025 breakout: 6-3, 2.82 ERA, 89 K in 73.1 IP. Electric stuff. WS contributor.
  ],
  'SD': [
    { name: 'Dylan Cease', team: 'SD', hand: 'R', era: 3.45, fip: 3.32, xfip: 3.40, whip: 1.12, k9: 10.5, bb9: 3.0, hr9: 0.8, ip: 185, war: 4.0 },
    { name: 'Yu Darvish', team: 'SD', hand: 'R', era: 3.62, fip: 3.48, xfip: 3.55, whip: 1.10, k9: 9.8, bb9: 2.2, hr9: 1.0, ip: 180, war: 3.5 },
    { name: 'Joe Musgrove', team: 'SD', hand: 'R', era: 3.42, fip: 3.28, xfip: 3.35, whip: 1.08, k9: 9.0, bb9: 2.0, hr9: 0.8, ip: 170, war: 3.8 },
    { name: 'Michael King', team: 'SD', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.12, k9: 9.5, bb9: 2.5, hr9: 0.9, ip: 165, war: 3.2 },
    { name: 'Matt Waldron', team: 'SD', hand: 'R', era: 4.12, fip: 3.95, xfip: 4.02, whip: 1.22, k9: 8.0, bb9: 2.5, hr9: 1.0, ip: 155, war: 2.0 },
    { name: 'Nick Pivetta', team: 'SD', hand: 'R', era: 2.87, fip: 3.10, xfip: 3.20, whip: 0.985, k9: 9.2, bb9: 2.3, hr9: 0.9, ip: 175, war: 5.3 }, // 2025 breakout: 13-5, 2.87 ERA, 0.985 WHIP. Elite. Signed SD offseason.
  ],
  'ARI': [
    { name: 'Zac Gallen', team: 'ARI', hand: 'R', era: 4.83, fip: 4.50, xfip: 4.35, whip: 1.26, k9: 8.2, bb9: 3.1, hr9: 1.5, ip: 192, war: 1.5 }, // 2025 regression: 13-15, 4.83 ERA in 33 starts. FIP 4.50 suggests it's real.
    { name: 'Merrill Kelly', team: 'ARI', hand: 'R', era: 3.62, fip: 3.48, xfip: 3.55, whip: 1.12, k9: 8.5, bb9: 2.0, hr9: 1.0, ip: 180, war: 3.2 },
    { name: 'Brandon Pfaadt', team: 'ARI', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.18, k9: 9.2, bb9: 2.5, hr9: 1.1, ip: 175, war: 2.5 },
    { name: 'Eduardo Rodriguez', team: 'ARI', hand: 'L', era: 4.05, fip: 3.88, xfip: 3.95, whip: 1.22, k9: 8.0, bb9: 2.5, hr9: 1.0, ip: 155, war: 2.0 },
    { name: 'Ryne Nelson', team: 'ARI', hand: 'R', era: 4.35, fip: 4.18, xfip: 4.25, whip: 1.25, k9: 8.0, bb9: 2.8, hr9: 1.2, ip: 145, war: 1.5 },
  ],
  'SF': [
    { name: 'Logan Webb', team: 'SF', hand: 'R', era: 3.25, fip: 3.12, xfip: 3.20, whip: 1.08, k9: 8.5, bb9: 1.8, hr9: 0.8, ip: 200, war: 5.0 },
    { name: 'Blake Snell', team: 'SF', hand: 'L', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.15, k9: 11.5, bb9: 3.5, hr9: 0.8, ip: 160, war: 3.5 },
    { name: 'Robbie Ray', team: 'SF', hand: 'L', era: 4.05, fip: 3.88, xfip: 3.95, whip: 1.22, k9: 10.0, bb9: 3.2, hr9: 1.1, ip: 145, war: 2.0 },
    { name: 'Jordan Hicks', team: 'SF', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.18, k9: 8.2, bb9: 2.5, hr9: 1.0, ip: 165, war: 2.5 },
    { name: 'Mason Black', team: 'SF', hand: 'R', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 8.5, bb9: 3.0, hr9: 1.2, ip: 120, war: 0.8 },
  ],
  'COL': [
    { name: 'Cal Quantrill', team: 'COL', hand: 'R', era: 4.72, fip: 4.52, xfip: 4.60, whip: 1.32, k9: 7.0, bb9: 2.5, hr9: 1.2, ip: 170, war: 1.0 },
    { name: 'Austin Gomber', team: 'COL', hand: 'L', era: 5.05, fip: 4.82, xfip: 4.90, whip: 1.38, k9: 7.5, bb9: 3.0, hr9: 1.4, ip: 155, war: 0.2 },
    { name: 'Kyle Freeland', team: 'COL', hand: 'L', era: 5.35, fip: 5.08, xfip: 5.15, whip: 1.42, k9: 7.0, bb9: 3.2, hr9: 1.5, ip: 150, war: -0.2 },
    { name: 'Ryan Feltner', team: 'COL', hand: 'R', era: 5.15, fip: 4.92, xfip: 5.00, whip: 1.35, k9: 8.0, bb9: 2.8, hr9: 1.4, ip: 145, war: 0.5 },
    { name: 'German Marquez', team: 'COL', hand: 'R', era: 4.85, fip: 4.62, xfip: 4.70, whip: 1.30, k9: 8.5, bb9: 2.5, hr9: 1.3, ip: 130, war: 0.8 }, // Returning from TJ surgery. Coors inflates ERA but solid FIP
    { name: 'Dakota Hudson', team: 'COL', hand: 'R', era: 5.45, fip: 5.18, xfip: 5.25, whip: 1.45, k9: 6.5, bb9: 3.5, hr9: 1.3, ip: 140, war: -0.5 },
  ],
};

// ==================== PITCHER UTILITIES ====================

const LG_AVG_PITCHER = { era: 4.10, fip: 4.05, xfip: 4.10, whip: 1.28, k9: 8.6, bb9: 2.8, hr9: 1.1, ip: 155, war: 2.0 };

// Composite pitcher rating (0-100 scale)
// Weights: FIP 25%, xFIP 20%, WHIP 15%, K/9 15%, BB/9 10%, HR/9 10%, IP 5%
function calculatePitcherRating(p) {
  const fipScore = Math.max(0, (LG_AVG_PITCHER.fip - p.fip) / LG_AVG_PITCHER.fip * 100 + 50);
  const xfipScore = Math.max(0, (LG_AVG_PITCHER.xfip - p.xfip) / LG_AVG_PITCHER.xfip * 100 + 50);
  const whipScore = Math.max(0, (LG_AVG_PITCHER.whip - p.whip) / LG_AVG_PITCHER.whip * 100 + 50);
  const k9Score = Math.max(0, (p.k9 - LG_AVG_PITCHER.k9) / LG_AVG_PITCHER.k9 * 100 + 50);
  const bb9Score = Math.max(0, (LG_AVG_PITCHER.bb9 - p.bb9) / LG_AVG_PITCHER.bb9 * 100 + 50);
  const hr9Score = Math.max(0, (LG_AVG_PITCHER.hr9 - p.hr9) / LG_AVG_PITCHER.hr9 * 100 + 50);
  const ipScore = Math.max(0, (p.ip / LG_AVG_PITCHER.ip) * 50);

  const composite = (
    fipScore * 0.25 +
    xfipScore * 0.20 +
    whipScore * 0.15 +
    k9Score * 0.15 +
    bb9Score * 0.10 +
    hr9Score * 0.10 +
    ipScore * 0.05
  );

  return Math.min(99, Math.max(1, Math.round(composite)));
}

// Add composite ratings to all pitchers
for (const team of Object.keys(PITCHERS)) {
  for (const p of PITCHERS[team]) {
    p.rating = calculatePitcherRating(p);
  }
  // Sort by rating descending (ace first)
  PITCHERS[team].sort((a, b) => b.rating - a.rating);
}

// Fuzzy match pitcher by name
function getPitcherByName(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  
  // Pass 1: Exact full name match (highest priority)
  for (const team of Object.keys(PITCHERS)) {
    for (const p of PITCHERS[team]) {
      if (p.name.toLowerCase() === lower) return { ...p };
    }
  }
  
  // Pass 2: Exact last name match (must match full last name)
  for (const team of Object.keys(PITCHERS)) {
    for (const p of PITCHERS[team]) {
      const pParts = p.name.toLowerCase().split(' ');
      const pLastName = pParts[pParts.length - 1];
      const inputParts = lower.split(' ');
      const inputLastName = inputParts[inputParts.length - 1];
      // Full last name must match exactly
      if (pLastName === inputLastName && pLastName.length >= 4) return { ...p };
    }
  }
  
  // Pass 3: First+Last initial match (e.g., "C. Sale" → "Chris Sale")
  for (const team of Object.keys(PITCHERS)) {
    for (const p of PITCHERS[team]) {
      const pParts = p.name.toLowerCase().split(' ');
      const inputParts = lower.split(' ');
      if (inputParts.length >= 2 && pParts.length >= 2) {
        // Check if input is like "c. sale" or "c sale"
        const inputFirst = inputParts[0].replace('.', '');
        const inputLast = inputParts[inputParts.length - 1];
        const pFirst = pParts[0];
        const pLast = pParts[pParts.length - 1];
        if (inputFirst.length === 1 && inputFirst === pFirst[0] && inputLast === pLast) {
          return { ...p };
        }
      }
    }
  }
  
  // Pass 4: If input is a single word (just last name), exact match only
  if (!lower.includes(' ')) {
    for (const team of Object.keys(PITCHERS)) {
      for (const p of PITCHERS[team]) {
        const pLastName = p.name.toLowerCase().split(' ').pop();
        if (pLastName === lower) return { ...p };
      }
    }
  }
  
  // Pass 5: Fuzzy last-name match (Levenshtein distance ≤ 1)
  // Catches common misspellings: "Burns" → "Burnes", "Degrom" → "deGrom"
  const inputLastName = lower.split(' ').pop();
  if (inputLastName.length >= 4) {
    let bestMatch = null;
    let bestDist = 2; // max distance we'll accept
    for (const team of Object.keys(PITCHERS)) {
      for (const p of PITCHERS[team]) {
        const pLastName = p.name.toLowerCase().split(' ').pop();
        const dist = levenshtein(inputLastName, pLastName);
        if (dist > 0 && dist < bestDist) {
          // If we have a first initial, verify it matches
          const inputParts = lower.split(' ');
          if (inputParts.length >= 2) {
            const inputFirst = inputParts[0].replace('.', '');
            const pFirst = p.name.toLowerCase().split(' ')[0];
            if (inputFirst.length === 1 && inputFirst !== pFirst[0]) continue;
            if (inputFirst.length > 1 && !pFirst.startsWith(inputFirst.substring(0, 3))) continue;
          }
          bestMatch = { ...p };
          bestDist = dist;
        }
      }
    }
    if (bestMatch) return bestMatch;
  }
  
  return null;
}

// Simple Levenshtein distance for fuzzy name matching
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

// Get team rotation
function getTeamRotation(teamAbbr) {
  const abbr = (teamAbbr || '').toUpperCase();
  return PITCHERS[abbr] || null;
}

// Get all pitchers flat list
function getAllPitchers() {
  const all = [];
  for (const team of Object.keys(PITCHERS)) {
    for (const p of PITCHERS[team]) {
      all.push(p);
    }
  }
  return all.sort((a, b) => b.rating - a.rating);
}

// Get top N pitchers across MLB
function getTopPitchers(n = 30) {
  return getAllPitchers().slice(0, n);
}

// Pitcher tier classification
function getPitcherTier(rating) {
  if (rating >= 75) return 'ACE';
  if (rating >= 65) return 'STRONG';
  if (rating >= 55) return 'SOLID';
  if (rating >= 45) return 'AVERAGE';
  if (rating >= 35) return 'BELOW_AVG';
  return 'REPLACEMENT';
}

module.exports = {
  PITCHERS,
  LG_AVG_PITCHER,
  calculatePitcherRating,
  getPitcherByName,
  getTeamRotation,
  getAllPitchers,
  getTopPitchers,
  getPitcherTier
};
