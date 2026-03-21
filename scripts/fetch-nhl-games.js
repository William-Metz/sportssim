#!/usr/bin/env node
// Fetch real 2024-25 NHL game results for backtest expansion
// Uses NHL official API

const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SportsSim/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Generate moneyline from win probability (approximate closing lines based on team strength)
function generateML(homeWinProb) {
  // Convert probability to American odds
  if (homeWinProb >= 0.5) {
    return Math.round(-100 * homeWinProb / (1 - homeWinProb));
  } else {
    return Math.round(100 * (1 - homeWinProb) / homeWinProb);
  }
}

// Team ID to abbreviation mapping
const TEAM_MAP = {
  1: 'NJD', 2: 'NYI', 3: 'NYR', 4: 'PHI', 5: 'PIT', 6: 'BOS', 7: 'BUF',
  8: 'MTL', 9: 'OTT', 10: 'TOR', 12: 'CAR', 13: 'FLA', 14: 'TBL', 15: 'WSH',
  16: 'CHI', 17: 'DET', 18: 'NSH', 19: 'STL', 20: 'CGY', 21: 'COL', 22: 'EDM',
  23: 'VAN', 24: 'ANA', 25: 'DAL', 26: 'LAK', 28: 'SJS', 29: 'CBJ', 30: 'MIN',
  32: 'WPG', 52: 'WPG', 53: 'ARI', 54: 'VGK', 55: 'SEA', 59: 'UTA'
};

async function main() {
  const games = [];
  
  // Fetch week by week from Oct 2024 through March 2025
  const startDates = [];
  let d = new Date('2024-10-08');
  const end = new Date('2025-03-15');
  while (d <= end) {
    startDates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 7);
  }
  
  for (const date of startDates) {
    try {
      const data = await fetch(`https://api-web.nhle.com/v1/schedule/${date}`);
      if (!data.gameWeek) continue;
      
      for (const day of data.gameWeek) {
        for (const game of day.games) {
          if (game.gameType !== 2) continue; // Regular season only
          if (game.gameState !== 'OFF' && game.gameState !== 'FINAL') continue;
          
          const awayId = game.awayTeam?.id;
          const homeId = game.homeTeam?.id;
          const awayScore = game.awayTeam?.score;
          const homeScore = game.homeTeam?.score;
          
          if (awayScore === undefined || homeScore === undefined) continue;
          if (awayScore === homeScore) continue; // Skip ties (shouldn't happen but just in case)
          
          let away = TEAM_MAP[awayId] || game.awayTeam?.abbrev;
          let home = TEAM_MAP[homeId] || game.homeTeam?.abbrev;
          
          // Map UTA to ARI for our model
          if (away === 'UTA') away = 'ARI';
          if (home === 'UTA') home = 'ARI';
          
          if (!away || !home) continue;
          
          games.push({
            date: day.date,
            away,
            home,
            awayGoals: awayScore,
            homeGoals: homeScore,
            gameId: game.id,
            periodType: game.gameOutcome?.lastPeriodType || 'REG'
          });
        }
      }
      
      // Small delay to be nice to the API
      await new Promise(r => setTimeout(r, 200));
    } catch(e) {
      console.error(`Error fetching ${date}:`, e.message);
    }
  }
  
  console.log(`Fetched ${games.length} games total`);
  
  // Output as JSON
  const fs = require('fs');
  fs.writeFileSync(__dirname + '/../data/nhl-games-2024-25.json', JSON.stringify(games, null, 2));
  console.log('Saved to data/nhl-games-2024-25.json');
  
  // Also output the format needed for backtest
  console.log('\n// Sample format for backtest:');
  games.slice(0, 10).forEach(g => {
    console.log(`  ['${g.away}','${g.home}',${g.awayGoals},${g.homeGoals},'${g.periodType}'],`);
  });
}

main().catch(console.error);
