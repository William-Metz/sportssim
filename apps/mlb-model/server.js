const express = require('express');
const path = require('path');

const app = express();
const PORT = 8080;

// In-memory cache
const cache = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// API key from env
function getApiKey() {
  return process.env.ODDS_API_KEY || '';
}

// Generic fetch helper with built-in Node 20 fetch
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// GET /api/odds — live MLB odds from multiple books
app.get('/api/odds', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.status(500).json({ error: 'ODDS_API_KEY not configured' });
  const cached = getCached('odds');
  if (cached) return res.json(cached);
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${key}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,pointsbet,caesars`;
    const data = await apiFetch(url);
    setCache('odds', data);
    res.json(data);
  } catch (e) {
    console.error('Odds API error:', e.message);
    res.status(502).json({ error: 'Failed to fetch odds', detail: e.message });
  }
});

// GET /api/scores — recent MLB scores
app.get('/api/scores', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.status(500).json({ error: 'ODDS_API_KEY not configured' });
  const cached = getCached('scores');
  if (cached) return res.json(cached);
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${key}&daysFrom=3`;
    const data = await apiFetch(url);
    setCache('scores', data);
    res.json(data);
  } catch (e) {
    console.error('Scores API error:', e.message);
    res.status(502).json({ error: 'Failed to fetch scores', detail: e.message });
  }
});

// GET /api/schedule — today's games (derived from odds)
app.get('/api/schedule', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.status(500).json({ error: 'ODDS_API_KEY not configured' });
  const cached = getCached('odds');
  let data;
  if (cached) {
    data = cached;
  } else {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${key}&regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings`;
      data = await apiFetch(url);
      setCache('odds', data);
    } catch (e) {
      return res.status(502).json({ error: 'Failed to fetch schedule', detail: e.message });
    }
  }
  const today = new Date().toISOString().split('T')[0];
  const todayGames = (data || []).filter(g => {
    return g.commence_time && g.commence_time.startsWith(today);
  });
  res.json(todayGames.map(g => ({
    id: g.id,
    home: g.home_team,
    away: g.away_team,
    commence_time: g.commence_time
  })));
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MLB AI Model server running on port ${PORT}`);
  if (!getApiKey()) {
    console.warn('WARNING: ODDS_API_KEY not set. Live odds endpoints will return errors.');
  }
});
