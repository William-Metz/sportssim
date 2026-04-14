# SportsSim Task Tracker

## Platform Stats
- **114 service modules** | **85,000+ lines of code** | **11,800-line server.js**
- **GitHub:** William-Metz/sportssim | **Live:** sportssim.fly.dev
- **Models:** NBA, MLB, NHL, NCAA | **Markets:** ML, spreads, totals, props, NRFI, F3/F7, SGP, futures

---

## 🚨 PRIORITY: MLB Opening Day (March 27 — 6 DAYS)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| OD-1 | Opening Day command center | ✅ DONE | P0 | 20+ od-* services built |
| OD-2 | Pitcher resolver + sync | ✅ DONE | P0 | Confirms starters from multiple sources |
| OD-3 | Lineup verification pipeline | ✅ DONE | P0 | Fetches + validates confirmed lineups |
| OD-4 | Live odds monitoring | ✅ DONE | P0 | Real-time from The Odds API |
| OD-5 | Opening Day preflight | ✅ DONE | P0 | Full validation chain before game day |
| OD-6 | Eve validation system | ✅ DONE | P0 | Night-before final checks |
| OD-7 | Opening Day live execution | ✅ DONE | P0 | Real-time game day management |
| OD-8 | End-to-end pipeline test | 🔴 TODO | P0 | Run full pipeline dry run before March 27 |
| OD-9 | Verify pitcher data current | 🔴 TODO | P0 | Confirm all 150+ pitchers updated for 2026 |
| OD-10 | Weather check for OD parks | 🔴 TODO | P1 | March weather = cold parks, wind impact |
| OD-11 | Opening week unders validation | ✅ DONE | P1 | Early-season scoring suppressed model |

## 🏀 NBA Playoffs Prep (April 12 — 22 days)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| NBA-1 | Playoff series scanner | ✅ DONE | P0 | Series pricing model |
| NBA-2 | Seeding simulator | ✅ DONE | P1 | Monte Carlo seeding projections |
| NBA-3 | Rest/tank model | ✅ DONE | P1 | End-of-season rest patterns |
| NBA-4 | Period markets model | ✅ DONE | P1 | Quarter/half spreads + totals |
| NBA-5 | Playoff unders rule | 🔴 TODO | P1 | Implement: totals ≤218 → lean Under (56.4% historical) |
| NBA-6 | Injury impact on series prices | 🔴 TODO | P1 | Lakers missing Luka/Reaves = series edge |
| NBA-7 | Play-in tournament model | 🔴 TODO | P2 | High variance play-in games need special handling |
| NBA-8 | Historical playoff CLV analysis | 🔴 TODO | P2 | How do our models perform vs closing lines in playoffs? |

## 🏒 NHL Playoffs Prep (April 19 — 29 days)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| NHL-1 | Playoff series model | ✅ DONE | P0 | Series pricing |
| NHL-2 | Bubble scanner | ✅ DONE | P1 | Tracking bubble teams |
| NHL-3 | Goalie starters tracker | ✅ DONE | P0 | Backup vs starter = #1 edge |
| NHL-4 | Backtest expansion | ⏳ QUEUED | P2 | Add more games for validation |

---

## Core Infrastructure

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 001 | Project structure + backend | ✅ DONE | — | Express + SQLite + multi-sport API |
| 002 | NBA power rating model | ✅ DONE | — | Pythagorean + luck + rolling |
| 003 | MLB model | ✅ DONE | — | Pitching matchups + park factors |
| 004 | The Odds API — all sports | ✅ DONE | — | NBA, MLB, NHL live odds |
| 005 | Value detection engine | ✅ DONE | — | Universal cross-sport edge detection |
| 006 | Dashboard MVP (all sports) | ✅ DONE | — | Multi-sport with switcher |
| 009 | Deploy sportssim.fly.dev | ✅ DONE | — | Live, CI/CD via GitHub Actions |
| 010 | NHL model | ✅ DONE | — | Pythagorean + goalie adj + 32 teams |
| 011 | Kelly Criterion multi-sport | ✅ DONE | — | Portfolio optimizer with correlation |
| 015 | Totals model (Poisson + NegBin) | ✅ DONE | — | Score distributions for all lines |
| 016 | MLB starting pitcher model | ✅ DONE | — | 150 pitchers, composite ratings |
| 017 | MLB park factors | ✅ DONE | — | 30 parks with run multipliers |
| 021 | Live data feeds | ✅ DONE | — | ESPN + NHL API, auto-refresh |

## Advanced Services Built

| Category | Services | Status |
|----------|----------|--------|
| **MLB Props** | batter-props, pitcher-k-props, pitcher-hwe-props, pitcher-outs-props, stolen-base-model | ✅ |
| **MLB Advanced** | bullpen-quality, catcher-framing, platoon-splits, umpire-tendencies, nrfi-model, f3-model, f7-model | ✅ |
| **MLB Data** | statcast, mlb-schedule, mlb-starter-sync, mlb-stats-lineups, mlb-results-grader | ✅ |
| **Weather** | weather, weather-forecast | ✅ |
| **Odds/Lines** | line-movement, line-shopping, alt-lines, arbitrage, consensus-engine | ✅ |
| **Automation** | auto-scanner, gameday-autopilot, gameday-orchestrator, regular-season-autopilot, daily-picks | ✅ |
| **Daily Cards** | daily-mlb-card, daily-nba-card, daily-nhl-card, daily-slate, morning-briefing | ✅ |
| **Tracking** | bet-tracker, auto-grade-pipeline, clv-tracker, calibration | ✅ |
| **Portfolio** | kelly, futures-scanner, sgp-engine, team-totals-scanner | ✅ |
| **Prediction Mkts** | kalshi, polymarket, polymarket-value | ✅ |
| **NBA Advanced** | nba-period-markets, nba-playoff-series-scanner, nba-rest-tank, nba-seeding-sim, nba-historical | ✅ |
| **NHL Advanced** | nhl-bubble-scanner, nhl-goalie-starters, nhl-playoff-series | ✅ |
| **NCAA** | ncaa-bracket-engine, ncaa-live, ncaa-tournament-scanner | ✅ |
| **Simulation** | monte-carlo, neg-binomial, season-simulator, seeding-futures-bridge | ✅ |
| **ML/Data** | ml-bridge, historical-games, player-stats, preseason-tuning | ✅ |
| **Lineups** | lineup-fetcher, lineup-monitor, lineup-bridge, gameday-lineup-pipeline | ✅ |
| **Opening Day** | 20+ od-* services, opening-day-live, opening-day-preflight, opener-eve-verification, opening-week-unders | ✅ |
| **Betting** | pitcher-bayesian-update, pitcher-resolver, rest-tank-backtest, rest-tank-grader, rest-travel, totals-backtest | ✅ |

---

## Next Sprint (March 21-27): Opening Day Readiness

| # | Task | Priority | Est |
|---|------|----------|-----|
| 1 | Full OD pipeline end-to-end dry run | P0 | 2h |
| 2 | Verify pitcher data is 2026-current | P0 | 1h |
| 3 | Weather check integration for OD parks | P1 | 1h |
| 4 | NBA playoff unders rule (≤218 total lean) | P1 | 1h |
| 5 | Fly.io deployment update (token was expired) | P1 | 30m |
| 6 | NBA injury impact on series pricing | P1 | 2h |
| 7 | Push alerts to Telegram/WhatsApp | P2 | 2h |
| 8 | Historical playoff CLV analysis | P2 | 2h |

## Backlog (Post-Opening Day)

| Task | Priority | Target |
|------|----------|--------|
| NFL win totals futures model | P2 | Pre-draft (April 24) |
| Soccer model (EPL, CL) | P3 | Summer |
| UFC/MMA model | P3 | TBD |
| Tennis model | P3 | TBD |
| Full ML ensemble training | P2 | April |
| Market efficiency map (softest books) | P2 | April |
| Live in-game models | P3 | May |
| Model auto-retraining loop | P2 | April |
| Bankroll growth projections dashboard | P3 | May |
| Daily P&L automated report | P2 | April |
| Weekly strategy digest | P3 | April |

---

## Session Log

| Session | Time | What Got Done |
|---------|------|---------------|
| #1 | 2026-03-19 06:33 | Project created, PLAN.md, TASKS.md, initial structure |
| #2 | 2026-03-19 07:00 | Multi-sport dashboard v3.0 — NBA+MLB+NHL models, backtests, value detection |
| #3 | 2026-03-19 18:00 | MLB Starting Pitcher Model + Poisson Totals v4.0 |
| #4 | 2026-03-19 20:45 | MLB Opening Day Projections v5.0 — 19-game schedule |
| #5 | 2026-03-20 19:20 | Live Data Feeds + Kelly Optimizer v6.0 |
| #6+ | 2026-03-20/21 | Massive expansion: 114 services, OD command center, NCAA, props, SGP, arbitrage, prediction markets, automation pipeline, daily cards, morning briefings, line shopping, ML bridge, season simulator, and more |

## Key Results

### Model Performance (Last Known)
- **NBA:** 72.7% ML accuracy (backtest)
- **MLB:** 57.4% ROI (backtest) — strong Opening Day projections
- **NHL:** 24.7% ROI (backtest) — goalie model is the edge
- **Kelly Portfolio Example:** $1000 bankroll, half-Kelly → $203.80 wagered, +$20.77 expected, 10.2% ROI

### Live Data Status
| Source | Sports | Freshness |
|--------|--------|-----------|
| ESPN API | NBA, MLB | 30-min cache |
| NHL Official API | NHL | 30-min cache |
| The Odds API | All | Real-time |
| Statcast | MLB | As available |

### Research Findings (March 21 Planning Review)
- **NBA Playoff Unders:** First-round totals ≤218 → Under 56.4% (VSiN, 6-year sample)
- **NBA Playoff Overs:** Totals >218 → Over 53.5%
- **Series Pricing:** Historically inefficient, especially for #4/#5 matchups
- **Lakers Injury Edge:** Luka Doncic + Austin Reaves out = significant series price impact
- **MLB OD:** Max uncertainty = max model edge. NRFI profitable historically on OD
- **New Data Sources:** OddsJam (arb finder), Opta AI (MLB props), Sportradar (comprehensive)
- **CLV:** The single best predictor of long-term profitability — our CLV tracker is critical

---

*Last updated: 2026-03-21 (Planning Review)*
*MLB OPENING DAY: 6 DAYS* 🔥
*NBA PLAYOFFS: 22 DAYS*
*NHL PLAYOFFS: 29 DAYS*
*Next priorities: OD pipeline test, pitcher data verification, Fly.io deploy fix*
