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
| 009 | Deploy sportssim.hatch.fun | ✅ DONE | P1 | Live at sportssim.fly.dev v4.0 |
| 010 | NHL model | ✅ DONE | P1 | Pythagorean + goalie adj + 32 teams |
| 011 | Kelly Criterion multi-sport | ⏳ QUEUED | P2 | Portfolio optimization |
| 012 | Rolling stats (all sports) | ⏳ QUEUED | P2 | L10 windows |
| 013 | Injury scraper (all leagues) | ⏳ QUEUED | P2 | ESPN/league APIs |
| 014 | Line movement tracker | ⏳ QUEUED | P2 | Snapshot every 30 min |
| 015 | Totals model (Poisson) | ✅ DONE | P2 | Poisson-based, integrated into MLB model |
| 016 | MLB: starting pitcher model | ✅ DONE | P2 | 150 pitchers, composite ratings, matchup analysis |
| 017 | MLB: park factors | ✅ DONE | P2 | 30 parks with run multipliers |
| 018 | MLB: weather integration | ⏳ QUEUED | P3 | Wind, temp, humidity |
| 019 | Kalshi scanner | ⏳ QUEUED | P2 | Team totals, props |
| 020 | Player props framework | ⏳ QUEUED | P2 | Points, rebounds, Ks, hits |
| 021 | Live data feeds (replace static) | ⏳ QUEUED | P1 | NBA API, MLB Statcast, NHL API |
| 022 | NHL backtest expansion | ⏳ QUEUED | P2 | Add more games for validation |
| 023 | MLB Opening Day projections | ⏳ QUEUED | P1 | March 27 matchup picks with pitcher analysis |

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
| 009 | Deploy | 2026-03-19 | Live at sportssim.fly.dev v4.0 |
| 010 | NHL model | 2026-03-19 | 32 teams, goalie adj, 24.7% ROI backtest |
| 015 | Totals model (Poisson) | 2026-03-19 | Full Poisson score distribution, O/U probs for all lines |
| 016 | MLB starting pitcher model | 2026-03-19 | 150 pitchers, composite ratings, tier system, matchup analysis |
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
| #3 | 2026-03-19 18:00 | MLB Starting Pitcher Model + Poisson Totals v4.0 — 150 pitchers across 30 teams, composite rating system, pitcher-aware predictions, Poisson totals with score distributions, matchup analysis API, dashboard with pitcher dropdowns and rotations tab. Deployed to Fly.io. |

---

## Key Results (Session #3)
- **MLB Pitcher Database**: 150 pitchers across all 30 teams with ERA, FIP, xFIP, WHIP, K/9, BB/9, HR/9, IP, WAR
- **Composite Rating System**: 0-100 scale based on weighted FIP/xFIP/WHIP/K9/BB9/HR9/IP. Top 5: Skubal (80), Skenes (78), Sale (77), Yamamoto (76), Strider (74)
- **Pitcher-Aware Predictions**: Pass pitcher names → auto-resolve stats → win prob shifts by 5-15% based on matchup
- **Poisson Totals**: Full score distribution matrix, O/U probs for lines 6.5-11, most likely final scores
- **Matchup Analysis**: /api/model/mlb/matchup with pitcher advantage, offensive edge, bullpen edge, key factors
- **Dashboard v4.0**: Pitcher dropdowns, pitcher matchup cards, Poisson totals table, Rotations tab (top 20 + all 30 teams)
- **New Endpoints**: /pitchers, /pitchers/:team, /pitchers/top, /matchup, /totals, enhanced /predict
- **Deployed**: sportssim.fly.dev v4.0 ✅

### Example Matchup: NYY (Cole) @ LAD (Yamamoto)
- Without pitchers: LAD 58.4% / NYY 41.6%
- With pitchers: LAD 69.4% / NYY 30.6% (Yamamoto 76 rating vs Cole 68 = +8 swing)
- Poisson total: 8.1 runs, O/U 8.5: Over 41.6% / Under 58.4%

---
*Last updated: 2026-03-19*
*MLB OPENING DAY: 8 DAYS*
*Next priorities: Live data feeds (Task 021), MLB Opening Day projections (Task 023), Kelly Criterion (Task 011)*
