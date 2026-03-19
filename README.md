# SportsSim 🎯

AI-powered sports betting platform that finds +EV edges across sportsbooks.

## Features
- **NBA Power Ratings** — Pythagorean-based with luck adjustment and momentum
- **Live Odds Scanner** — Real-time lines from DraftKings, FanDuel, BetMGM, Caesars, PointsBet
- **Value Detector** — Model vs. book comparison, surfaces +EV opportunities
- **Backtest Engine** — 200+ game validation with ROI by edge tier
- **Kelly Criterion** — Bankroll-optimal bet sizing

## Stack
- Node.js / Express backend
- Vanilla JS + CSS frontend (dark theme)
- SQLite for data persistence
- The Odds API for live lines
- Deployed on Fly.io

## Run locally
```bash
npm install
ODDS_API_KEY=your_key node server.js
```

## Deploy
```bash
flyctl deploy --remote-only -a sportssim
```

## License
Private — Will Metz / MetaClaw 🦞
# CI/CD trigger 2026-03-19T17:09:22Z
