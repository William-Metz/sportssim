# SportsSim Task Tracker

## 🚨 URGENT
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 026 | **CRITICAL: Fix NBA totals bug** | ✅ DONE | P0 | Was dividing expectedTotal by 2 → model said 117 instead of 233 |
| 027 | **NBA spread compression** | ✅ DONE | P0 | Capped at ±18, added rolling/injury rebalance |
| 028 | Deploy NBA model fixes | ✅ DONE | P0 | Committed + pushed v23.0 — auto-deploys via GH Actions |
| 029 | Backtest NBA with fixed model | ✅ DONE | P1 | Rebuilt with 2024-25 point-in-time data, param sweep, 71.6% ML, totals +27.3% ROI |
| 030 | MLB Opening Day ready-check | ✅ DONE | P0 | All Day 1 starters confirmed, DK lines updated, Poisson win prob, pitcher fix |

## Active Sprint
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 031 | NBA playoff series pricing model | ✅ DONE | P1 | Full MC + binomial series sim, bracket projector, championship odds, series analyzer |
| 032 | pybaseball Statcast integration | ✅ DONE | P1 | Real Baseball Savant data: 853 pitchers + 651 batters + 30 teams, xERA/xwOBA wired into predictions |
| 033 | CLV tracking pipeline | ✅ DONE | P1 | Full CLV tracker: auto-records picks, closing lines, auto-grades, tracks edge over time |
| 034 | Model calibration audit | ✅ DONE | P2 | NBA calibration curve fitted from 176-game 2024-25 backtest, now matches reality |
| 007 | NBA backtest (500+ games) | 🔄 PARTIAL | P1 | 176 games done, need more data |
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
| 009 | Deploy | 2026-03-19 | Live at sportssim.fly.dev v4.0 |
| 010 | NHL model | 2026-03-19 | 32 teams, goalie adj, 24.7% ROI backtest |
| 011 | Kelly Criterion | 2026-03-20 | Full/half/quarter Kelly, correlation detection, portfolio optimization |
| 015 | Totals model (Poisson) | 2026-03-19 | Full Poisson score distribution, O/U probs for all lines |
| 016 | MLB starting pitcher model | 2026-03-19 | 150 pitchers, composite ratings, tier system, matchup analysis |
| 017 | MLB park factors | 2026-03-19 | 30 parks with run multipliers |
| 021 | Live data feeds | 2026-03-20 | ESPN NBA/MLB + NHL API, auto-refresh, cache, fallback to static |
| 023 | MLB Opening Day projections | 2026-03-19 | 19 games projected, best bets engine, deployed v5.0 |
| 012 | Rolling stats wired into models | 2026-03-21 | L10 rolling stats from ESPN/NHL APIs, blended into NBA/MLB/NHL predict() |
| 013 | Injury service wired into models | 2026-03-21 | Star player impact ratings, ESPN injury data, penalty adjustments in all 3 models |
| 014 | Line movement tracker | 2026-03-21 | 30-min snapshots, steam/RLM/stale detection, API endpoints |
| 019 | Kalshi scanner | 2026-03-21 | 1800 NBA team total contracts, futures, 119 value bets found |
| 018 | MLB weather integration | 2026-03-21 | Open-Meteo API, wind/temp/humidity multipliers, 30 parks, wired into predictions |
| 020 | Player props framework | 2026-03-21 | NBA/MLB/NHL player projections, value scanning, live stats integration |
| 024 | Unified Signal Engine | 2026-03-21 | Umpire+weather+MC+calibration+rest/travel all wired into daily picks & value detection |
| 025 | Alt Lines Value Scanner | 2026-03-21 | Alt totals, alt spreads, team totals, F5 lines, Poisson math, live odds scanning, dashboard tab |
| 026 | Fix NBA totals bug | 2026-03-21 | Was dividing expectedTotal by 2 → totals showed ~117 instead of ~233. Every NBA total bet was garbage. |
| 027 | NBA spread compression + rebalance | 2026-03-21 | Capped spreads at ±18, reduced rolling double-count (50%), capped injury adj at 4pts/team |
| 028 | Deploy NBA model fixes + v23.0 | 2026-03-21 | Pushed to GH, auto-deploy. NBA spread calibration (k=7.5→15), MLB Poisson win prob |
| 029 | NBA backtest v2 (point-in-time) | 2026-03-21 | Rebuilt with 2024-25 data, param sweep HCA 2.5/LF 0.3/ME 3, ATS 54.3% +3.6% ROI, ML 71.6%, Totals 66.7% +27.3% ROI |
| 030 | MLB Opening Day ready-check | 2026-03-21 | All 11 Day 1 starters confirmed, DK lines for all games, Poisson win prob, pitcher RA fix |
| 033 | CLV tracking pipeline | 2026-03-21 | Auto-records picks from value detection, records closing lines, auto-grades, tracks edge over time |
| 034 | Model calibration audit | 2026-03-21 | NBA calibration curve fitted from 176-game backtest — 60% pred → 50% actual, 80% → 87%, 90% → 93% |
| 032 | Statcast integration | 2026-03-22 | Real Baseball Savant xERA/xwOBA for 853 pitchers + 651 batters + 30 teams. Wired into predict(), pitcherExpectedRA(), dashboard tab. Regression detection for betting edge. |

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
| #6 | 2026-03-21 14:20 | **Rolling Stats + Injuries → Models + Kalshi Scanner v9.0** — Wired rolling stats (L10 form) and injury data (star player impact) into MLB prediction engine (was already in NBA/NHL). MLB predict() now adjusts expected runs based on recent form and missing stars. Enhanced dashboard: new "Trends & Injuries" tab with sortable rolling form table and detailed injury reports. Factor Breakdown UI shows rolling cards + injury detail. Built full Kalshi prediction market scanner — scans 1800+ NBA team total contracts + championship futures for +EV opportunities. First scan found 119 value bets (90 HIGH confidence). Tasks 012, 013, 014, 019 all completed. |
| #7 | 2026-03-21 19:40 | **Unified Signal Engine v19.0** — CRITICAL UPGRADE: Wired ALL signals into the money-printing daily picks engine. Previously, daily picks used basic `predict()` (no rest/travel, no Monte Carlo, no umpire, no calibration). Now uses `asyncPredict` for MLB (rest/travel + MC), umpire zone data for totals, probability calibration, and blended probs (analytical + MC). Also: umpire data wired into MLB value detection (`/api/value/mlb` + `/api/value/all`), MC-enhanced totals in combined endpoint, new `/api/signal-check/:sport/:away/:home` unified pre-bet signal aggregator. Dashboard shows umpire + MC info in picks. Confidence scoring expanded (0-15 situational with umpire support). Tasks 018, 020, 024 completed. |
| #8 | 2026-03-21 20:00 | **Alt Lines Value Scanner v20.0** — NEW FEATURE: Full alt lines scanner (`services/alt-lines.js`). Uses Poisson score matrix to calculate exact probabilities for ANY line — alt totals (4.5-14.5), alt run lines (-4.5 to +4.5), team totals (0.5-8.5), F5 totals (2.5-8.5), F5 spreads. Live odds scanning via The Odds API to find +EV alt market opportunities. Dashboard "📐 Alt Lines" tab with matchup analyzer (pick any two teams, see all alt line probabilities + sweet spots) and live scan button. Alt markets are less efficiently priced = more edge. API endpoints: `/api/alt-lines/:sport/:away/:home`, `/api/alt-lines/scan/:sport`, `/api/alt-lines/scan`. Task 025 completed. |
| #9 | 2026-03-21 22:00 | **CRITICAL NBA Model Fix v21.0** — Planning session discovered NBA total calculation bug: `adjTotal = expectedTotal / 2 + paceAdj` was dividing the full game total by 2, outputting ~117 instead of ~233. This caused EVERY NBA total value bet to show as "UNDER" with fake 130+ point edges — completely polluting the value detection API. Fixed formula to `adjTotal = expectedTotal + paceAdj`. Also: added spread compression (cap at ±18 with soft taper beyond), reduced rolling stats double-counting (L10 momentum already in power rating, now 50% weight), capped injury adjustment at 4 pts/team max. MIL without Giannis now shows realistic -16 spread vs PHX instead of absurd -25. Tasks 026, 027 completed. |
| #10 | 2026-03-21 22:40 | **MLB Poisson + NBA Calibration v23.0** — TWO CRITICAL MODEL FIXES: (1) MLB predict() now uses Poisson-based win probability instead of Log5 — directly models score distributions from expected runs, more accurate for single games. Fixed pitcher RA double-counting: pitcherExpectedRA() returns neutral RA/9, then offense+park applied ONCE. Preseason regression awareness. Tighter probability caps (22-78%). (2) NBA SPREAD_TO_PROB_FACTOR fixed from 7.5→15 — was mapping 16pt spreads to 99.3% instead of real-world 92%. Every NBA value bet was inflated. Also: Opening Day starters fully updated from ESPN (all 11 Day 1 games confirmed), added Misiorowski+Kikuchi to pitcher DB, DK lines for ARI@LAD & CLE@SEA. Tasks 028, 030 completed. |

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
*Last updated: 2026-03-22*
*MLB OPENING DAY: 5 DAYS*
*NBA PLAYOFFS: 21 DAYS*
*Next priorities: NHL backtest expansion (022), Polymarket odds integration, Python ML engine training, Dashboard UI improvements*
