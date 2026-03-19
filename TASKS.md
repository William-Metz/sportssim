# SportsSim Task Tracker

## 🚨 URGENT
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 001 | Project structure + backend | ✅ DONE | P0 | Express + SQLite + multi-sport API |
| 002 | NBA power rating model | ✅ DONE | P0 | Pythagorean + luck + rolling |
| 003 | MLB model — Opening Day March 27! | ✅ DONE | P0 | Pitching matchups + park factors |
| 004 | The Odds API — all sports | ✅ DONE | P0 | NBA, MLB, NHL live odds |
| 005 | Value detection engine | ✅ DONE | P0 | Universal: model vs book, all 3 sports |

## Active Sprint
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 006 | Dashboard MVP (all sports) | ✅ DONE | P1 | Multi-sport with switcher: NBA/MLB/NHL |
| 007 | NBA backtest (500+ games) | 🔄 PARTIAL | P1 | 176 games done, need more data |
| 008 | MLB season projections | ✅ DONE | P1 | All 30 teams rated for 2025 |
| 009 | Deploy sportssim.hatch.fun | ✅ DONE | P1 | Live at sportssim.fly.dev v3.0 |
| 010 | NHL model | ✅ DONE | P1 | Pythagorean + goalie adj + 32 teams |
| 011 | Kelly Criterion multi-sport | ⏳ QUEUED | P2 | Portfolio optimization |
| 012 | Rolling stats (all sports) | ⏳ QUEUED | P2 | L10 windows |
| 013 | Injury scraper (all leagues) | ⏳ QUEUED | P2 | ESPN/league APIs |
| 014 | Line movement tracker | ⏳ QUEUED | P2 | Snapshot every 30 min |
| 015 | Totals model (Poisson) | ⏳ QUEUED | P2 | All sports |
| 016 | MLB: starting pitcher model | ⏳ QUEUED | P2 | ERA, WHIP, K/9, FIP, matchup |
| 017 | MLB: park factors | ✅ DONE | P2 | 30 parks with run multipliers |
| 018 | MLB: weather integration | ⏳ QUEUED | P3 | Wind, temp, humidity |
| 019 | Kalshi scanner | ⏳ QUEUED | P2 | Team totals, props |
| 020 | Player props framework | ⏳ QUEUED | P2 | Points, rebounds, Ks, hits |
| 021 | Live data feeds (replace static) | ⏳ QUEUED | P1 | NBA API, MLB Statcast, NHL API |
| 022 | NHL backtest expansion | ⏳ QUEUED | P2 | Add more games for validation |

## Completed
| ID | Task | Completed | Result |
|----|------|-----------|--------|
| 001 | Project structure + backend | 2026-03-19 | Express server with multi-sport API |
| 002 | NBA power rating model | 2026-03-19 | 30 teams, Pythagorean + luck, 72.7% ML accuracy |
| 003 | MLB model | 2026-03-19 | 30 teams, pitcher adj + park factors, 57.4% ROI backtest |
| 004 | Odds API integration | 2026-03-19 | NBA, MLB, NHL live odds via The Odds API |
| 005 | Value detection engine | 2026-03-19 | Cross-sport edge detection, /api/value/all |
| 006 | Dashboard MVP | 2026-03-19 | Multi-sport switcher, predictors, backtests |
| 008 | MLB season projections | 2026-03-19 | All 30 teams with power ratings |
| 009 | Deploy | 2026-03-19 | Live at sportssim.fly.dev v3.0 |
| 010 | NHL model | 2026-03-19 | 32 teams, goalie adj, 24.7% ROI backtest |
| 017 | MLB park factors | 2026-03-19 | 30 parks with run multipliers |

## Backlog
- NFL win totals futures model
- Soccer model (EPL, CL)
- UFC/MMA model
- Tennis model  
- Arbitrage scanner
- Same-game parlay correlation
- Live in-game model
- Telegram/WhatsApp alerts
- Auto-post to Claw Hub
- Bet tracker + auto-grading
- CLV tracking
- ML ensemble
- Alternate line optimizer
- Prop market scanner
- Bankroll growth projections
- Model auto-retraining

---

## Session Log
| Session | Time | What Got Done |
|---------|------|---------------|
| #1 | 2026-03-19 06:33 | Project created, PLAN.md, TASKS.md, initial structure |
| #2 | 2026-03-19 07:00 | Multi-sport dashboard v3.0 — NBA+MLB+NHL models, backtests, value detection, predictors, deployed to Fly.io. All endpoints tested and passing. |

---

## Key Results (Session #2)
- **NBA Backtest**: 176 games, 71-69 ATS, 72.7% ML accuracy, +10.8% ROI on high-edge bets
- **MLB Backtest**: 200 games, 141-23, 57.4% ROI, 164 value bets found
- **NHL Backtest**: 165 games, 84-41, 24.7% ROI, 125 value bets found
- **Dashboard**: Full multi-sport with sport switcher, predictors (NBA B2B, MLB pitcher ERA/FIP, NHL goalie), backtests, profit curves
- **Value Detection**: Live for all 3 sports via Odds API, /api/value/all combined endpoint
- **Deployed**: sportssim.fly.dev v3.0 ✅

---
*Last updated: 2026-03-19*
*MLB OPENING DAY: 8 DAYS*
*Next priorities: Live data feeds, more backtest games, Kelly Criterion portfolio optimizer*
