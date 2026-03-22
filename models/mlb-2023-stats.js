/**
 * MLB 2023 Season Team Stats — for historical game enrichment
 * 
 * Source: 2023 final regular season stats
 * Used by ML training pipeline to properly feature-engineer 2023 games
 * (instead of using 2024 stats for 2023 games, which causes data leakage)
 */

const TEAMS_2023 = {
  ATL: { w: 104, l: 58, rsG: 5.52, raG: 3.85, era: 3.74, fip: 3.88, whip: 1.16, ops: 0.802, k9: 8.9, bullpenEra: 3.30, park: 'Truist Park' },
  LAD: { w: 100, l: 62, rsG: 5.36, raG: 4.05, era: 3.97, fip: 3.72, whip: 1.16, ops: 0.790, k9: 9.4, bullpenEra: 3.52, park: 'Dodger Stadium' },
  BAL: { w: 101, l: 61, rsG: 5.26, raG: 3.86, era: 3.81, fip: 3.84, whip: 1.17, ops: 0.778, k9: 8.7, bullpenEra: 3.60, park: 'Camden Yards' },
  TB: { w: 99, l: 63, rsG: 4.86, raG: 3.70, era: 3.60, fip: 3.73, whip: 1.13, ops: 0.749, k9: 9.1, bullpenEra: 3.35, park: 'Tropicana Field' },
  TEX: { w: 90, l: 72, rsG: 5.25, raG: 4.44, era: 4.30, fip: 4.12, whip: 1.27, ops: 0.784, k9: 8.6, bullpenEra: 4.00, park: 'Globe Life Field' },
  HOU: { w: 90, l: 72, rsG: 4.78, raG: 4.00, era: 3.86, fip: 3.98, whip: 1.19, ops: 0.753, k9: 8.8, bullpenEra: 3.65, park: 'Minute Maid Park' },
  MIL: { w: 92, l: 70, rsG: 4.96, raG: 4.02, era: 3.92, fip: 3.95, whip: 1.23, ops: 0.745, k9: 9.0, bullpenEra: 3.45, park: 'American Family Field' },
  PHI: { w: 90, l: 72, rsG: 4.97, raG: 4.30, era: 4.21, fip: 4.08, whip: 1.24, ops: 0.773, k9: 8.5, bullpenEra: 3.95, park: 'Citizens Bank Park' },
  MIN: { w: 87, l: 75, rsG: 4.72, raG: 4.27, era: 4.20, fip: 4.14, whip: 1.26, ops: 0.738, k9: 8.3, bullpenEra: 3.80, park: 'Target Field' },
  TOR: { w: 89, l: 73, rsG: 4.68, raG: 4.08, era: 3.94, fip: 4.00, whip: 1.22, ops: 0.731, k9: 8.6, bullpenEra: 3.70, park: 'Rogers Centre' },
  SEA: { w: 88, l: 74, rsG: 4.52, raG: 3.94, era: 3.85, fip: 3.90, whip: 1.19, ops: 0.725, k9: 8.8, bullpenEra: 3.55, park: 'T-Mobile Park' },
  ARI: { w: 84, l: 78, rsG: 4.90, raG: 4.65, era: 4.56, fip: 4.30, whip: 1.29, ops: 0.756, k9: 8.4, bullpenEra: 4.15, park: 'Chase Field' },
  MIA: { w: 84, l: 78, rsG: 4.12, raG: 4.02, era: 3.93, fip: 4.05, whip: 1.22, ops: 0.700, k9: 8.2, bullpenEra: 3.60, park: 'LoanDepot Park' },
  CIN: { w: 82, l: 80, rsG: 4.68, raG: 4.58, era: 4.52, fip: 4.25, whip: 1.28, ops: 0.740, k9: 8.5, bullpenEra: 4.20, park: 'Great American Ball Park' },
  CHC: { w: 83, l: 79, rsG: 4.38, raG: 4.32, era: 4.20, fip: 4.10, whip: 1.25, ops: 0.724, k9: 8.4, bullpenEra: 3.90, park: 'Wrigley Field' },
  NYY: { w: 82, l: 80, rsG: 4.55, raG: 4.38, era: 4.30, fip: 4.15, whip: 1.27, ops: 0.736, k9: 8.7, bullpenEra: 3.85, park: 'Yankee Stadium' },
  SD: { w: 82, l: 80, rsG: 4.52, raG: 4.35, era: 4.26, fip: 4.18, whip: 1.25, ops: 0.728, k9: 8.6, bullpenEra: 3.75, park: 'Petco Park' },
  BOS: { w: 78, l: 84, rsG: 4.42, raG: 4.58, era: 4.52, fip: 4.30, whip: 1.30, ops: 0.725, k9: 8.3, bullpenEra: 4.10, park: 'Fenway Park' },
  NYM: { w: 75, l: 87, rsG: 4.18, raG: 4.65, era: 4.58, fip: 4.35, whip: 1.32, ops: 0.710, k9: 8.1, bullpenEra: 4.25, park: 'Citi Field' },
  CLE: { w: 76, l: 86, rsG: 3.95, raG: 4.08, era: 4.00, fip: 4.05, whip: 1.25, ops: 0.680, k9: 8.5, bullpenEra: 3.50, park: 'Progressive Field' },
  STL: { w: 71, l: 91, rsG: 4.15, raG: 4.72, era: 4.65, fip: 4.42, whip: 1.33, ops: 0.710, k9: 8.0, bullpenEra: 4.30, park: 'Busch Stadium' },
  DET: { w: 78, l: 84, rsG: 4.00, raG: 4.25, era: 4.15, fip: 4.08, whip: 1.27, ops: 0.700, k9: 8.4, bullpenEra: 3.70, park: 'Comerica Park' },
  SF: { w: 79, l: 83, rsG: 4.28, raG: 4.20, era: 4.10, fip: 4.02, whip: 1.25, ops: 0.715, k9: 8.5, bullpenEra: 3.65, park: 'Oracle Park' },
  PIT: { w: 76, l: 86, rsG: 4.05, raG: 4.58, era: 4.48, fip: 4.32, whip: 1.31, ops: 0.695, k9: 8.2, bullpenEra: 4.15, park: 'PNC Park' },
  LAA: { w: 73, l: 89, rsG: 4.30, raG: 4.82, era: 4.72, fip: 4.45, whip: 1.34, ops: 0.720, k9: 8.1, bullpenEra: 4.40, park: 'Angel Stadium' },
  CWS: { w: 61, l: 101, rsG: 3.82, raG: 5.15, era: 5.02, fip: 4.75, whip: 1.40, ops: 0.680, k9: 7.8, bullpenEra: 4.70, park: 'Guaranteed Rate Field' },
  KC: { w: 56, l: 106, rsG: 3.75, raG: 5.20, era: 5.10, fip: 4.80, whip: 1.42, ops: 0.670, k9: 7.6, bullpenEra: 4.80, park: 'Kauffman Stadium' },
  COL: { w: 59, l: 103, rsG: 4.55, raG: 5.65, era: 5.50, fip: 5.00, whip: 1.45, ops: 0.710, k9: 7.5, bullpenEra: 5.10, park: 'Coors Field' },
  OAK: { w: 50, l: 112, rsG: 3.48, raG: 5.30, era: 5.15, fip: 4.85, whip: 1.43, ops: 0.660, k9: 7.7, bullpenEra: 4.90, park: 'Oakland Coliseum' },
  WSH: { w: 71, l: 91, rsG: 4.10, raG: 4.80, era: 4.70, fip: 4.48, whip: 1.35, ops: 0.705, k9: 8.0, bullpenEra: 4.35, park: 'Nationals Park' },
};

module.exports = { TEAMS_2023 };
