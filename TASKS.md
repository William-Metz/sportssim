# SportsSim Task Tracker

## 🚨 CRITICAL — Fix Now
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 114 | Auto-scanner returning 0 picks | 🚨 INVESTIGATE | P0 | March 22-24 all showing 0 plays — edge threshold too high or data pipeline broken |
| 115 | Rest/tank calibration fix | 🔧 TODO | P0 | RESTING 3/3 wins (elite too deep), DESPERATE 0/3 — reduce both adj multipliers |
| 116 | Fly.io deploy token refresh | 🔧 TODO | P0 | Expired token blocking CI/CD auto-deploys |
| 117 | MLB spring→regular season data transition | 🔧 VERIFY | P0 | Ensure live-data.js switches from spring to regular season correctly |

## Active Sprint — Post-Opening Day
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 118 | MLB Week 1 daily scanning | 🔄 ACTIVE | P1 | Autopilot should pick up regular season games |
| 119 | First real graded ROI results | ⏳ PENDING | P1 | Need actual plays to grade — depends on 114 fix |
| 120 | NBA playoff series model validation | ⏳ QUEUED | P1 | Validate before April 12 playoffs |
| 121 | NHL bubble resolution tracking | 🔄 ACTIVE | P1 | 7+ teams within 4-5 pts, daily monitoring |
| 122 | NFL Draft futures model | ⏳ QUEUED | P2 | Build before April 24 |
| 123 | Push alerts (Telegram/WhatsApp) | ⏳ QUEUED | P2 | Wire notification system for live +EV picks |
| 124 | Model self-improvement loop | ⏳ QUEUED | P2 | Auto-retrain on new results data |

## Completed — Phase 1: Foundation (Sessions #1-5)
| ID | Task | Completed | Result |
|----|------|-----------|--------|
| 001 | Project structure + backend | 2026-03-19 | Express server with multi-sport API |
| 002 | NBA power rating model | 2026-03-19 | 30 teams, Pythagorean + luck, 72.7% ML accuracy |
| 003 | MLB model | 2026-03-19 | 30 teams, pitcher adj + park factors, 57.4% ROI backtest |
| 004 | Odds API integration | 2026-03-19 | NBA, MLB, NHL live odds via The Odds API |
| 005 | Value detection engine | 2026-03-19 | Cross-sport edge detection, /api/value/all |
| 006 | Dashboard MVP | 2026-03-19 | Multi-sport switcher, predictors, backtests |
| 008 | MLB season projections | 2026-03-19 | All 30 teams rated for 2025 |
| 009 | Deploy | 2026-03-19 | Live at sportssim.fly.dev |
| 010 | NHL model | 2026-03-19 | 32 teams, goalie adj, 24.7% ROI backtest |

## Completed — Phase 2: Depth (Sessions #5-20)
| ID | Task | Completed | Result |
|----|------|-----------|--------|
| 011 | Kelly Criterion multi-sport | 2026-03-20 | Full/half/quarter Kelly, correlation detection, portfolio optimization |
| 012 | Rolling stats (all sports) | 2026-03-20 | L10 windows, wired into predictions |
| 013 | Injury scraper (all leagues) | 2026-03-20 | ESPN/league APIs, injury-cache.json |
| 014 | Line movement tracker | 2026-03-20 | Steam moves, RLM, stale line detection v8.0 |
| 015 | Totals model (Poisson) | 2026-03-19 | Poisson score distributions, O/U probabilities |
| 016 | MLB starting pitcher model | 2026-03-19 | 150 pitchers, composite ratings, tier system |
| 017 | MLB park factors | 2026-03-19 | 30 parks with run multipliers |
| 018 | MLB weather integration | 2026-03-20 | Wind, temp, humidity — wired into predictions v11.0 |
| 019 | Kalshi scanner | 2026-03-20 | Team totals, props, event markets v9.0 |
| 021 | Live data feeds | 2026-03-20 | ESPN NBA/MLB + NHL API, auto-refresh, 30min cache |
| 023 | MLB Opening Day projections | 2026-03-19 | 19 games projected, best bets engine |

## Completed — Phase 3: Advanced Models (Sessions #20-54)
| ID | Task | Completed | Result |
|----|------|-----------|--------|
| 025 | NBA playoff series pricing | 2026-03-21 | Series model with home court and matchup adjustments |
| 026 | Statcast integration | 2026-03-21 | Baseball Savant xERA/xwOBA data |
| 028 | Polymarket scanner | 2026-03-21 | Value bridge + cross-market arbitrage detection |
| 030 | Alt lines value scanner | 2026-03-21 | Poisson-powered alt market scanner v20.0 |
| 031 | MLB preseason tuning | 2026-03-21 | Roster changes, spring training signals, OD starter premium |
| 033 | Opening Day Playbook | 2026-03-21 | War room endpoint + dashboard |
| 034 | Bayesian calibration | 2026-03-21 | Season sim MAE 8W → 2.1W vs DK lines |
| 036 | MLB Season Simulator | 2026-03-21 | Dashboard + API + XGBoost |
| 038 | NBA Rest/Tank Model | 2026-03-22 | End-of-season edge detection |
| 043 | NBA Playoff Preview + F5 Unders | 2026-03-22 | Opening week unders scanner |
| 044 | MLB Lineup Monitor | 2026-03-22 | Pipeline + dashboard tab |
| 046 | Opening Day fix + rest/tank backtest | 2026-03-22 | Daily slate tab |
| 051 | NHL Playoffs Dashboard + Watchdog | 2026-03-22 | Auto-scanner fix |
| 056 | Bet tracker + auto-grading + CLV | 2026-03-21 | Closing line capture, post-game grading |
| 060 | Consensus engine | 2026-03-22 | Multi-model agreement scoring |
| 065 | ML engine (XGBoost) | 2026-03-22 | Python ML pipeline + JS bridge |
| 070 | MLB Poisson win prob + calibration | 2026-03-22 | Pitcher fix + NBA spread calibration |
| 075 | Arbitrage scanner | 2026-03-21 | Cross-book arb detection |
| 078 | Regular Season Autopilot | 2026-03-23 | Daily MLB Card + Gameday Autopilot v81/v82 |
| 080 | NHL Bubble Scanner | 2026-03-23 | 7+ teams within 4-5 pts, fade/back signals |
| 082 | MLB Daily Card (NB totals) | 2026-03-23 | NB totals/F5/run-lines, auto-grading, season context |
| 085 | Batter Props daily scan | 2026-03-23 | NBA playoff series improvements |
| 086 | Regular Season Autopilot v86 | 2026-03-23 | Automated daily game-day orchestration |
| 087 | Bayesian Progressive Blend + OD Verify | 2026-03-23 | NHL Bubble Scanner integration |
| 089 | OD Pitcher Sync + Pre-Flight | 2026-03-23 | ESPN live probables reconciliation, GO/NO-GO endpoint |
| 090 | Daily NBA Card | 2026-03-23 | Rest/tank conviction engine, 4 API endpoints |
| 093 | F3 First-3-Innings Model | 2026-03-23 | FTTO advantage + dashboard + 4 endpoints |
| 095 | Pitcher HWE Props | 2026-03-23 | Hits/walks/ER Poisson + Statcast, 5 endpoints |
| 096 | NBA Period Markets | 2026-03-23 | Quarter/half scoring + structural edge scanner |
| 098 | F7 Bullpen Chaos + NHL Daily Card | 2026-03-24 | NB F7 scoring, 30-team bullpen ERA, NHL goalie/bubble signals |
| 100 | Pre-OD Final Check | 2026-03-24 | Critical starter updates + F3/NRFI fixes |
| 105 | Auto-grade pipeline | 2026-03-24 | Closing line capture, game monitor, post-game grading |
| 106 | Team totals scanner + edge decay | 2026-03-24 | Team totals prop scanner, edge decay monitor |
| 108 | MLB Stats API lineup bridge | 2026-03-24 | Multi-source lineup resolution pipeline |
| 112 | OD Odds Monitor | 2026-03-24 | Cross-book detection, auto-playbook rebuild |
| 113 | Fried vs Webb opener rebuild | 2026-03-25 | Critical pitcher correction (Fried not Cole) |
| 120 | Live bet execution engine | 2026-03-24 | Real-time edge detection, Kelly sizing, mobile dashboard |

## Completed — Infrastructure & Fixes
| ID | Task | Completed | Result |
|----|------|-----------|--------|
| — | Grafana monitoring dashboard | 2026-03-20 | Fly.io app + Infinity datasource |
| — | CI/CD auto-deploy | 2026-03-20 | GitHub Actions, self-healing deploys |
| — | Monorepo consolidation | 2026-03-20 | Claw Hub + MLB + NBA under apps/ |
| — | OOM fixes (multiple) | 2026-03-24 | 2GB VM, crash protection, staggered startup |
| — | Healthchecks.io monitoring | 2026-03-20 | External uptime monitoring |
| — | Rust quantitative engine | 2026-03-22 | Sports, equities, crypto, backtest, Actix-web |
| — | NCAA bracket engine | 2026-03-23 | Tournament scanner + live tracker |
| — | Dead app cleanup | 2026-03-25 | Removed MLB/NBA model apps, archived Claw Hub |

## Backlog — Future
| Task | Priority | Notes |
|------|----------|-------|
| NFL win totals futures model | P2 | Build before April 24 draft |
| Soccer model (EPL, CL, MLS) | P3 | Year-round, draw edges |
| UFC/MMA model | P3 | Method of victory, round betting |
| Tennis model | P3 | Surface specialist edges |
| Same-game parlay correlation engine | P2 | SGP engine exists, needs calibration |
| Live in-game model | P3 | Second-half betting |
| Telegram/WhatsApp push alerts | P2 | Real-time +EV notifications |
| Auto-post to Claw Hub | P3 | Daily best plays |
| Bankroll growth projections | P3 | Compound return modeling |
| Market efficiency map | P2 | Which books are softest by sport |
| Model auto-retraining loop | P2 | Self-improvement from results |
| Prop market inefficiency scanner | P2 | Cross-book prop value |
| Alternate line optimizer | P3 | Full alt line grid scanning |

---

## Model Performance Snapshot

### NBA Rest/Tank (March 23 Grading)
- **Games graded:** 6
- **Adjustment helped:** 3/6 (50%)
- **Avg improvement:** -0.1 (marginally hurts)
- **Key insight:** RESTING teams 3/3 wins (elite too deep). DESPERATE teams 0/3.
- **Action:** Reduce RESTING penalty, reduce DESPERATE boost

### MLB (Backtest)
- Moneyline accuracy: ~57.4% ROI (backtest)
- Bayesian calibration: MAE 2.1W vs DK (was 8W pre-calibration)
- Opening Day system: 37 plays, $245 EV, 18.4% projected ROI
- **Real graded results:** Pending — 0 bets graded (spring training only so far)

### NHL (Backtest)
- ROI: 24.7% (backtest)
- Bubble scanner: 7+ teams within 4-5 pts of playoff line

### Cross-Sport Kelly Portfolio (Example)
- NHL CAR ML: $50 wager, 10.5% EV
- NBA OKC ML: $35.40, 9.2% EV
- NBA DEN ML: $50, 12% EV
- MLB LAD ML: $39.20, 8% EV
- Total: $203.80 wagered, +$20.77 expected, 10.2% ROI

---

## Research Notes (March 25 Review)

### Academic
- **arXiv 2303.06021:** ML models for sports betting should optimize for *calibration* over accuracy — well-calibrated probabilities translate to better betting edge detection. Our Bayesian calibration (MAE 2.1W) aligns with this.
- **CLV importance:** Action Network confirms CLV is the gold standard metric for model quality. Our CLV tracker is built but needs real data.

### Market Opportunities
- **MLB Week 1:** Early season lines are historically soft — books still pricing off projections, not results. Our preseason-tuned models have an edge window.
- **NBA end-of-season:** Rest/tank patterns create exploitable mispricings. Need to fix calibration.
- **NHL bubble:** 7+ teams fighting for playoff spots = volatile lines = edges.
- **Opening week totals:** Historically, unders hit at higher rate in first week (pitchers fresh, bullpens unused).

---

## Session Log (Summary)

| Sessions | Period | Major Milestones |
|----------|--------|------------------|
| #1-5 | Mar 19-20 | Foundation: project, 3 sport models, odds API, dashboard, deploy, Kelly, live data |
| #6-10 | Mar 20-21 | Line movement, Kalshi, weather, Polymarket, rolling stats + injuries wired in |
| #11-20 | Mar 21-22 | Statcast, alt lines, preseason tuning, season sim, rest/tank, NHL playoffs |
| #21-30 | Mar 22-23 | Lineup pipeline, daily cards (MLB/NBA/NHL), autopilot, bracket engine |
| #31-40 | Mar 23-24 | F3/F7 models, pitcher HWE props, NBA period markets, batter props |
| #41-50 | Mar 24 | Pre-OD validation, auto-grading, team totals, edge decay, morning briefing |
| #51-54 | Mar 24-25 | Live execution engine, OD preflight GO, Fried correction, opener analysis, cleanup |

---

*Last updated: 2026-03-25*
*Current version: v128*
*MLB Regular Season: LIVE 🔥*
*Next: Fix 0-pick issue, validate real ROI, prep for NBA/NHL playoffs*
