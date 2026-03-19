// models/mlb-pitchers.js — MLB Starting Pitcher Database
// All 30 teams, top 5 rotation pitchers with projected 2025 stats
// Stats: ERA, FIP, xFIP, WHIP, K/9, BB/9, HR/9, IP, WAR, hand, composite rating

const PITCHERS = {
  // ==================== AL EAST ====================
  'NYY': [
    { name: 'Gerrit Cole', team: 'NYY', hand: 'R', era: 3.41, fip: 3.28, xfip: 3.35, whip: 1.07, k9: 10.6, bb9: 2.1, hr9: 1.0, ip: 200, war: 5.2 },
    { name: 'Carlos Rodon', team: 'NYY', hand: 'L', era: 4.12, fip: 3.88, xfip: 3.95, whip: 1.22, k9: 10.1, bb9: 3.2, hr9: 1.3, ip: 170, war: 2.8 },
    { name: 'Clarke Schmidt', team: 'NYY', hand: 'R', era: 3.78, fip: 3.65, xfip: 3.72, whip: 1.18, k9: 8.8, bb9: 2.5, hr9: 0.9, ip: 150, war: 2.5 },
    { name: 'Marcus Stroman', team: 'NYY', hand: 'R', era: 4.25, fip: 4.10, xfip: 4.15, whip: 1.28, k9: 7.2, bb9: 2.8, hr9: 1.0, ip: 155, war: 1.8 },
    { name: 'Luis Gil', team: 'NYY', hand: 'R', era: 3.50, fip: 3.42, xfip: 3.55, whip: 1.15, k9: 11.2, bb9: 3.8, hr9: 0.9, ip: 145, war: 3.0 },
  ],
  'BAL': [
    { name: 'Corbin Burnes', team: 'BAL', hand: 'R', era: 3.15, fip: 3.05, xfip: 3.12, whip: 1.08, k9: 9.8, bb9: 2.0, hr9: 0.8, ip: 200, war: 5.5 },
    { name: 'Grayson Rodriguez', team: 'BAL', hand: 'R', era: 3.62, fip: 3.48, xfip: 3.55, whip: 1.15, k9: 9.5, bb9: 2.8, hr9: 0.9, ip: 175, war: 3.5 },
    { name: 'Dean Kremer', team: 'BAL', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 8.2, bb9: 2.5, hr9: 1.2, ip: 155, war: 1.8 },
    { name: 'Albert Suarez', team: 'BAL', hand: 'R', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.20, k9: 7.8, bb9: 2.2, hr9: 1.0, ip: 140, war: 2.0 },
    { name: 'Cade Povich', team: 'BAL', hand: 'L', era: 4.35, fip: 4.15, xfip: 4.25, whip: 1.28, k9: 8.5, bb9: 3.0, hr9: 1.1, ip: 130, war: 1.5 },
  ],
  'BOS': [
    { name: 'Brayan Bello', team: 'BOS', hand: 'R', era: 3.72, fip: 3.58, xfip: 3.65, whip: 1.18, k9: 8.5, bb9: 2.8, hr9: 0.9, ip: 180, war: 3.2 },
    { name: 'Tanner Houck', team: 'BOS', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.12, k9: 9.2, bb9: 2.5, hr9: 0.8, ip: 170, war: 3.5 },
    { name: 'Kutter Crawford', team: 'BOS', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.15, k9: 9.5, bb9: 2.2, hr9: 1.1, ip: 165, war: 2.8 },
    { name: 'Lucas Giolito', team: 'BOS', hand: 'R', era: 4.45, fip: 4.20, xfip: 4.30, whip: 1.30, k9: 9.0, bb9: 3.2, hr9: 1.3, ip: 140, war: 1.5 },
    { name: 'Garrett Whitlock', team: 'BOS', hand: 'R', era: 3.95, fip: 3.80, xfip: 3.88, whip: 1.20, k9: 8.0, bb9: 2.5, hr9: 1.0, ip: 145, war: 2.0 },
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
  ],

  // ==================== AL CENTRAL ====================
  'CLE': [
    { name: 'Tanner Bibee', team: 'CLE', hand: 'R', era: 3.45, fip: 3.30, xfip: 3.38, whip: 1.10, k9: 9.8, bb9: 2.2, hr9: 0.8, ip: 185, war: 4.2 },
    { name: 'Gavin Williams', team: 'CLE', hand: 'R', era: 3.72, fip: 3.55, xfip: 3.62, whip: 1.15, k9: 10.2, bb9: 3.0, hr9: 0.9, ip: 155, war: 3.0 },
    { name: 'Logan Allen', team: 'CLE', hand: 'L', era: 4.05, fip: 3.90, xfip: 3.98, whip: 1.22, k9: 8.0, bb9: 2.8, hr9: 1.0, ip: 165, war: 2.2 },
    { name: 'Ben Lively', team: 'CLE', hand: 'R', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.18, k9: 7.5, bb9: 2.0, hr9: 1.0, ip: 160, war: 2.5 },
    { name: 'Matthew Boyd', team: 'CLE', hand: 'L', era: 4.20, fip: 4.02, xfip: 4.10, whip: 1.25, k9: 8.5, bb9: 2.5, hr9: 1.2, ip: 140, war: 1.5 },
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
    { name: 'Garrett Crochet', team: 'CWS', hand: 'L', era: 3.55, fip: 3.40, xfip: 3.48, whip: 1.08, k9: 12.0, bb9: 2.5, hr9: 0.8, ip: 145, war: 3.5 },
    { name: 'Erick Fedde', team: 'CWS', hand: 'R', era: 3.88, fip: 3.72, xfip: 3.80, whip: 1.18, k9: 8.2, bb9: 2.2, hr9: 1.0, ip: 175, war: 2.5 },
    { name: 'Chris Flexen', team: 'CWS', hand: 'R', era: 5.05, fip: 4.82, xfip: 4.90, whip: 1.38, k9: 6.8, bb9: 3.0, hr9: 1.3, ip: 150, war: 0.2 },
    { name: 'Jonathan Cannon', team: 'CWS', hand: 'R', era: 5.22, fip: 4.95, xfip: 5.02, whip: 1.40, k9: 6.5, bb9: 3.2, hr9: 1.4, ip: 130, war: -0.2 },
    { name: 'Drew Thorpe', team: 'CWS', hand: 'R', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.30, k9: 8.0, bb9: 2.8, hr9: 1.1, ip: 140, war: 1.0 },
  ],

  // ==================== AL WEST ====================
  'HOU': [
    { name: 'Framber Valdez', team: 'HOU', hand: 'L', era: 3.38, fip: 3.25, xfip: 3.32, whip: 1.12, k9: 8.8, bb9: 2.5, hr9: 0.7, ip: 200, war: 4.8 },
    { name: 'Hunter Brown', team: 'HOU', hand: 'R', era: 3.72, fip: 3.55, xfip: 3.62, whip: 1.18, k9: 9.5, bb9: 3.0, hr9: 0.9, ip: 175, war: 3.0 },
    { name: 'Ronel Blanco', team: 'HOU', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.10, k9: 9.0, bb9: 2.5, hr9: 0.8, ip: 160, war: 3.2 },
    { name: 'Spencer Arrighetti', team: 'HOU', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 10.2, bb9: 3.5, hr9: 1.1, ip: 150, war: 1.8 },
    { name: 'Justin Verlander', team: 'HOU', hand: 'R', era: 4.05, fip: 3.88, xfip: 3.95, whip: 1.18, k9: 8.5, bb9: 2.2, hr9: 1.2, ip: 155, war: 2.2 },
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
    { name: 'Max Meyer', team: 'MIA', hand: 'R', era: 4.65, fip: 4.42, xfip: 4.50, whip: 1.28, k9: 8.8, bb9: 3.0, hr9: 1.1, ip: 125, war: 0.8 },
  ],
  'WSH': [
    { name: 'MacKenzie Gore', team: 'WSH', hand: 'L', era: 3.72, fip: 3.58, xfip: 3.65, whip: 1.15, k9: 9.5, bb9: 3.0, hr9: 0.9, ip: 170, war: 3.0 },
    { name: 'Jake Irvin', team: 'WSH', hand: 'R', era: 4.15, fip: 3.98, xfip: 4.05, whip: 1.22, k9: 8.0, bb9: 2.5, hr9: 1.1, ip: 165, war: 2.0 },
    { name: 'Mitchell Parker', team: 'WSH', hand: 'L', era: 4.35, fip: 4.18, xfip: 4.25, whip: 1.25, k9: 8.5, bb9: 2.8, hr9: 1.0, ip: 150, war: 1.5 },
    { name: 'DJ Herz', team: 'WSH', hand: 'L', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.28, k9: 10.0, bb9: 3.5, hr9: 1.1, ip: 130, war: 1.2 },
    { name: 'Patrick Corbin', team: 'WSH', hand: 'L', era: 5.22, fip: 4.95, xfip: 5.02, whip: 1.42, k9: 7.0, bb9: 3.0, hr9: 1.5, ip: 155, war: -0.5 },
  ],

  // ==================== NL CENTRAL ====================
  'MIL': [
    { name: 'Freddy Peralta', team: 'MIL', hand: 'R', era: 3.42, fip: 3.28, xfip: 3.35, whip: 1.10, k9: 10.5, bb9: 2.5, hr9: 0.9, ip: 180, war: 4.2 },
    { name: 'Colin Rea', team: 'MIL', hand: 'R', era: 3.78, fip: 3.65, xfip: 3.72, whip: 1.15, k9: 8.0, bb9: 2.0, hr9: 0.9, ip: 170, war: 2.8 },
    { name: 'Tobias Myers', team: 'MIL', hand: 'R', era: 3.92, fip: 3.78, xfip: 3.85, whip: 1.18, k9: 8.2, bb9: 2.2, hr9: 1.0, ip: 155, war: 2.2 },
    { name: 'Frankie Montas', team: 'MIL', hand: 'R', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 8.5, bb9: 2.5, hr9: 1.2, ip: 145, war: 1.5 },
    { name: 'Aaron Ashby', team: 'MIL', hand: 'L', era: 4.55, fip: 4.35, xfip: 4.42, whip: 1.30, k9: 9.0, bb9: 3.5, hr9: 1.0, ip: 120, war: 1.0 },
  ],
  'CHC': [
    { name: 'Shota Imanaga', team: 'CHC', hand: 'L', era: 3.12, fip: 3.00, xfip: 3.08, whip: 1.02, k9: 10.0, bb9: 1.8, hr9: 0.9, ip: 175, war: 5.0 },
    { name: 'Justin Steele', team: 'CHC', hand: 'L', era: 3.42, fip: 3.28, xfip: 3.35, whip: 1.08, k9: 9.0, bb9: 2.2, hr9: 0.8, ip: 180, war: 4.2 },
    { name: 'Jameson Taillon', team: 'CHC', hand: 'R', era: 4.05, fip: 3.90, xfip: 3.98, whip: 1.22, k9: 7.5, bb9: 2.2, hr9: 1.1, ip: 170, war: 2.0 },
    { name: 'Javier Assad', team: 'CHC', hand: 'R', era: 3.88, fip: 3.75, xfip: 3.82, whip: 1.18, k9: 7.8, bb9: 2.5, hr9: 0.9, ip: 155, war: 2.2 },
    { name: 'Jordan Wicks', team: 'CHC', hand: 'L', era: 4.22, fip: 4.05, xfip: 4.12, whip: 1.25, k9: 8.0, bb9: 3.0, hr9: 1.0, ip: 130, war: 1.2 },
  ],
  'STL': [
    { name: 'Sonny Gray', team: 'STL', hand: 'R', era: 3.45, fip: 3.32, xfip: 3.40, whip: 1.10, k9: 9.5, bb9: 2.5, hr9: 0.9, ip: 185, war: 4.2 },
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
  ],
  'SD': [
    { name: 'Dylan Cease', team: 'SD', hand: 'R', era: 3.45, fip: 3.32, xfip: 3.40, whip: 1.12, k9: 10.5, bb9: 3.0, hr9: 0.8, ip: 185, war: 4.0 },
    { name: 'Yu Darvish', team: 'SD', hand: 'R', era: 3.62, fip: 3.48, xfip: 3.55, whip: 1.10, k9: 9.8, bb9: 2.2, hr9: 1.0, ip: 180, war: 3.5 },
    { name: 'Joe Musgrove', team: 'SD', hand: 'R', era: 3.42, fip: 3.28, xfip: 3.35, whip: 1.08, k9: 9.0, bb9: 2.0, hr9: 0.8, ip: 170, war: 3.8 },
    { name: 'Michael King', team: 'SD', hand: 'R', era: 3.55, fip: 3.42, xfip: 3.50, whip: 1.12, k9: 9.5, bb9: 2.5, hr9: 0.9, ip: 165, war: 3.2 },
    { name: 'Matt Waldron', team: 'SD', hand: 'R', era: 4.12, fip: 3.95, xfip: 4.02, whip: 1.22, k9: 8.0, bb9: 2.5, hr9: 1.0, ip: 155, war: 2.0 },
  ],
  'ARI': [
    { name: 'Zac Gallen', team: 'ARI', hand: 'R', era: 3.35, fip: 3.22, xfip: 3.30, whip: 1.08, k9: 9.0, bb9: 2.2, hr9: 0.8, ip: 185, war: 4.5 },
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
  for (const team of Object.keys(PITCHERS)) {
    for (const p of PITCHERS[team]) {
      const pLower = p.name.toLowerCase();
      // Exact match
      if (pLower === lower) return { ...p };
      // Last name match
      const lastName = pLower.split(' ').pop();
      if (lastName === lower) return { ...p };
      // Partial match (contains)
      if (pLower.includes(lower) || lower.includes(lastName)) return { ...p };
    }
  }
  return null;
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
