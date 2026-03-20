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
| 009 | Deploy sportssim.hatch.fun | ✅ DONE | P1 | Live at sportssim.fly.dev v6.0 |
| 010 | NHL model | ✅ DONE | P1 | Pythagorean + goalie adj + 32 teams |
| 011 | Kelly Criterion multi-sport | ✅ DONE | P2 | Portfolio optimizer with correlation detection |
| 012 | Rolling stats (all sports) | ⏳ QUEUED | P2 | L10 windows |
| 013 | Injury scraper (all leagues) | ⏳ QUEUED | P2 | ESPN/league APIs |
| 014 | Line movement tracker | ⏳ QUEUED | P2 | Snapshot every 30 min |
| 015 | Totals model (Poisson) | ✅ DONE | P2 | Poisson-based, integrated into MLB model |
| 016 | MLB: starting pitcher model | ✅ DONE | P2 | 150 pitchers, composite ratings, matchup analysis |
| 017 | MLB: park factors | ✅ DONE | P2 | 30 parks with run multipliers |
| 018 | MLB: weather integration | ⏳ QUEUED | P3 | Wind, temp, humidity |
| 019 | Kalshi scanner | ⏳ QUEUED | P2 | Team totals, props |
| 020 | Player props framework | ⏳ QUEUED | P2 | Points, rebounds, Ks, hits |
| 021 | Live data feeds (replace static) | ✅ DONE | P1 | ESPN + NHL API, auto-refresh, 30min cache |
| 022 | NHL backtest expansion | ⏳ QUEUED | P2 | Add more games for validation |
| 023 | MLB Opening Day projections | ✅ DONE | P1 | March 26-27 matchup picks with pitcher analysis |

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
| 011 | Kelly Criterion | 2026-03-20 | Full/half/quarter Kelly, correlation detection, portfolio optimization |
| 015 | Totals model (Poisson) | 2026-03-19 | Full Poisson score distribution, O/U probs for all lines |
| 016 | MLB starting pitcher model | 2026-03-19 | 150 pitchers, composite ratings, tier system, matchup analysis |
| 017 | MLB park factors | 2026-03-19 | 30 parks with run multipliers |
| 021 | Live data feeds | 2026-03-20 | ESPN NBA/MLB + NHL API, auto-refresh, cache, fallback to static |
| 023 | MLB Opening Day projections | 2026-03-19 | 19 games projected, best bets engine, deployed v5.0 |

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
| #4 | 2026-03-19 20:45 | MLB Opening Day Projections v5.0 — Full 19-game schedule (March 26-27), Opening Day model with pitcher matchups, best bets engine (top 5 picks), dedicated dashboard tab with hero countdown + game cards + totals table, deployed to Fly.io v5.0. |
| #5 | 2026-03-20 19:20 | **Live Data Feeds + Kelly Optimizer v6.0** — MAJOR: replaced static data with live feeds from ESPN (NBA/MLB) and NHL official API. All 3 models now auto-refresh from real APIs with 30-min cache and graceful static fallback. Built proper Kelly Criterion portfolio optimizer with same-game correlation detection, confidence weighting, full/half/quarter Kelly sizing, and portfolio-level risk management. NBA now shows real current standings (OKC 55-15, DET 50-19, SAS 52-18). Fly deploy blocked by expired token — code committed and pushed to GitHub. |

---

## Key Results (Session #5)
- **Live Data Service**: `services/live-data.js` — fetches from ESPN (NBA/MLB) + NHL official API
- **NBA Live**: 30 teams with real PPG, OPPG, W/L, L10 from ESPN standings API
- **NHL Live**: 32 teams with real GF/G, GA/G, W/L/OTL, L10 from `api-web.nhle.com`
- **MLB Live**: 30 teams spring training data from ESPN (auto-switches to regular season)
- **Cache System**: `services/data-cache.json`, 30-min TTL, force-refresh support
- **Dynamic Proxy Pattern**: All 3 models use JS Proxy for TEAMS — live data when available, static fallback
- **Kelly Optimizer**: `services/kelly.js` — full Kelly Criterion with:
  - Full/half/quarter Kelly sizing
  - Same-game correlation penalty (29% reduction per correlated bet)
  - Max single-bet cap (5%) and total exposure cap (25%)
  - Confidence-weighted sizing (HIGH/MEDIUM/LOW)
  - Expected ROI and risk assessment
- **API Endpoints**: 
  - `/api/data/status` — shows live data source, freshness, sample teams
  - `/api/data/refresh` — triggers real API pull (was previously stub)
  - `/api/kelly` — portfolio optimization with bankroll/fraction/minEdge params
- **Auto-refresh**: Server pulls live data on startup

### Live Data Comparison (Static → Live)
| Team | Static W-L | Live W-L | Change |
|------|-----------|----------|--------|
| OKC | 54-15 | 55-15 | +1W |
| DET | 39-28 | 50-19 | +11W, massively improved |
| SAS | 32-36 | 52-18 | HUGE jump — Wembanyama effect |
| IND | 34-34 | 15-55 | Collapsed — static was very wrong |
| CHA | 22-44 | 36-34 | Much better than projected |

### Kelly Portfolio Example (1000 bankroll, half-Kelly)
- NHL CAR ML: $50 wager, 10.5% EV
- NBA OKC ML: $35.40 wager, 9.2% EV (corr penalty)  
- NBA DEN ML: $50 wager, 12% EV
- MLB LAD ML: $39.20 wager, 8% EV
- Total: $203.80 wagered, +$20.77 expected profit, 10.2% ROI

---
*Last updated: 2026-03-20*
*MLB OPENING DAY: 7 DAYS*
*Next priorities: Rolling stats (Task 012), Injury scraper (Task 013), Line movement tracker (Task 014)*
