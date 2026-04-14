# SportsSim Task Tracker

*Updated: 2026-04-14 (Planning Session)*
*Version: v128 | 146 commits | 54+ dev sessions*

---

## 🚨 NEW — April 14-24 Priority Tasks

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 114 | **NBA Play-In Game Picks — TONIGHT** | 🆕 NEW | P0 | PHX vs POR tonight 10pm ET. Suns -3.5 / -155 ML. POR 14-10 since Feb 22 (better recent form). Also LAC vs GSW. Model should generate edge analysis for all Play-In games. |
| 115 | **NBA Playoff Series Pricing Model** | 🆕 NEW | P0 | Series bets = biggest NBA edge. Historically #4/#5 matchups mispriced. Build series simulator: home court value, rest between games, coaching adjustments (fade Game 1 overreactions). Bracket: DET/BOS/NYK/CLE vs SAS/OKC/DEN/LAL + play-in winners. |
| 116 | **NHL Backtest Expansion — BEFORE PLAYOFFS** | 🆕 NEW | P0 | NHL playoffs start April 19 (5 DAYS). Model shows 0 backtest games — CANNOT bet real money without validation. Need 200+ historical games to confirm ROI. |
| 117 | **Push Alerts (Telegram/WhatsApp)** | 🆕 NEW | P1 | Still not wired! High-value edges (+5% EV) need instant notifications. Critical for live betting during playoffs. |
| 118 | **MLB Early Season Regression Detector** | 🆕 NEW | P1 | 2.5 weeks of real data. Build Pythagorean W-L vs actual W-L comparison. Teams outperforming → fade, underperforming → buy. Small sample = biggest edges of the MLB season. |
| 119 | **NBA Playoff Unders System** | 🆕 NEW | P1 | Research confirms: playoff totals ≤218 → Under 56.4% historically. Pace slows, defense intensifies, rotations shrink. Build specific playoff total adjustment into NBA model. |
| 120 | **NFL Draft Win Total Adjustments** | 🆕 NEW | P2 | Draft April 24. Need module to recalculate win totals post-draft based on pick quality and positional value. Current futures: MIA OVER 4.5 (+39.6%), BAL UNDER 11.5 (+24.4%). |
| 121 | **Kalshi Data Refresh** | 🆕 NEW | P2 | Last Kalshi scan was March 21 (24+ days stale). 119 value bets found then — need fresh scan. Kalshi expanding to football props/sides/totals. |
| 122 | **Bet Tracker P&L Dashboard** | 🆕 NEW | P2 | Need actual performance tracking. Are our picks making money? Auto-grade system exists but no aggregate P&L view. |
| 123 | **Statcast Data Refresh** | 🆕 NEW | P2 | Last Statcast fetch was March 27. Now have 2+ weeks of 2026 real data. Refresh pitcher xERA/xwOBA for current season regression detection. |

---

## Previously Completed URGENT Tasks (v6→v128)

| ID | Task | Status | Completed | Key Result |
|----|------|--------|-----------|------------|
| 001 | Project structure + backend | ✅ DONE | 2026-03-19 | Express server with multi-sport API |
| 002 | NBA power rating model | ✅ DONE | 2026-03-19 | 30 teams, Pythagorean + luck, 72.7% ML accuracy |
| 003 | MLB model | ✅ DONE | 2026-03-19 | 30 teams, pitcher adj + park factors |
| 004 | Odds API integration | ✅ DONE | 2026-03-19 | NBA, MLB, NHL live odds |
| 005 | Value detection engine | ✅ DONE | 2026-03-19 | Cross-sport edge detection |
| 006 | Dashboard MVP | ✅ DONE | 2026-03-19 | Multi-sport 20+ tabs |
| 009 | Deploy | ✅ DONE | 2026-03-19 | Live at sportssim.fly.dev |
| 010 | NHL model | ✅ DONE | 2026-03-19 | 32 teams, goalie adjustments |
| 011 | Kelly Criterion | ✅ DONE | 2026-03-20 | Full/half/quarter Kelly, correlation detection |
| 012 | Rolling stats | ✅ DONE | 2026-03-21 | L10 from ESPN/NHL APIs |
| 013 | Injury scraper | ✅ DONE | 2026-03-21 | Star player impact ratings |
| 014 | Line movement tracker | ✅ DONE | 2026-03-21 | Steam/RLM/stale detection |
| 016 | MLB pitcher model | ✅ DONE | 2026-03-19 | 167 pitchers, composite ratings |
| 017 | MLB park factors | ✅ DONE | 2026-03-19 | 30 parks with run multipliers |
| 018 | MLB weather | ✅ DONE | 2026-03-21 | Open-Meteo live integration |
| 019 | Kalshi scanner | ✅ DONE | 2026-03-21 | 119 value bets, 90 high confidence |
| 020 | Player props | ✅ DONE | 2026-03-21 | NBA/MLB/NHL projections |
| 021 | Live data feeds | ✅ DONE | 2026-03-20 | ESPN + NHL API auto-refresh |
| 024 | Unified Signal Engine | ✅ DONE | 2026-03-21 | Umpire+weather+MC+calibration |
| 029 | NBA backtest v2 | ✅ DONE | 2026-03-21 | ATS 54.3%, ML 71.6%, Totals +27.3% ROI |
| 032 | Statcast integration | ✅ DONE | 2026-03-22 | 853 pitchers, 651 batters |
| 033 | CLV tracking | ✅ DONE | 2026-03-21 | Auto-grade pipeline |
| 035 | Polymarket bridge | ✅ DONE | 2026-03-21 | Cross-market arbitrage |
| 038 | OD Playbook | ✅ DONE | 2026-03-22 | Full war room, conviction grades |
| 042 | Season simulator | ✅ DONE | 2026-03-22 | 10K MC, futures value |
| 046 | NBA rest/tank model | ✅ DONE | 2026-03-22 | B2B/motivation analysis |
| 052 | NHL playoff dashboard | ✅ DONE | 2026-03-22 | Series pricing, bubble watch |
| 053 | NHL goalie starters | ✅ DONE | 2026-03-22 | DailyFaceoff live data |
| 054 | Pre-OD final check | ✅ DONE | 2026-03-24 | 🟢 GO — 7/9 PASS |
| 057 | NBA seeding→futures | ✅ DONE | 2026-03-22 | 10K MC → championship odds |
| 060 | NFL win totals | ✅ DONE | 2026-03-22 | 32 teams, 30 value bets |
| 061 | asyncPredict fix | ✅ DONE | 2026-03-22 | Full signal stack wired |
| 062 | Production down fix | ✅ DONE | 2026-03-22 | 256MB→512MB VM |
| 064 | Platoon splits | ✅ DONE | 2026-03-22 | Savant 2024 wOBA data |
| 065 | Catcher framing | ✅ DONE | 2026-03-22 | 58 Savant catchers, 15 corrections |
| 066 | OD playbook timeout | ✅ DONE | 2026-03-22 | Parallel cache, 17.7s build |
| 067 | Stolen base model | ✅ DONE | 2026-03-22 | Team SB rates wired in |
| 068 | OD live tracker | ✅ DONE | 2026-03-22 | Real-time bet grading |
| 069 | K props model | ✅ DONE | 2026-03-22 | 37 picks, 22 high confidence |
| 113 | Fried vs Webb analysis | ✅ DONE | 2026-03-25 | NYY@SF opener betting card |

---

## Still Queued (from original backlog)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 007 | NBA backtest (500+ games) | 🔄 PARTIAL | P1 | 176 games done, need 324+ more |
| 022 | NHL backtest expansion | ⏳ QUEUED → **P0** | P0 | CRITICAL before NHL playoffs Apr 19 |
| 063 | NCAA March Madness Model | ⏳ QUEUED | P3 | Tournament over, but next year prep |

---

## Backlog (Revised Priorities)

| Task | Priority | Target |
|------|----------|--------|
| NBA Playoff series pricing model | P0 | This week |
| NHL backtest expansion | P0 | Before Apr 19 |
| Push alerts (Telegram/WhatsApp) | P1 | This week |
| MLB regression detector | P1 | This week |
| NBA playoff unders system | P1 | Before Apr 18 |
| Bet tracker P&L dashboard | P2 | April |
| NFL Draft win total adjustments | P2 | April 24 |
| Kalshi data refresh | P2 | This week |
| Statcast 2026 data refresh | P2 | This week |
| Full ML ensemble training | P2 | April |
| Market efficiency map (softest books) | P2 | April |
| Model auto-retraining loop | P2 | May |
| Soccer model (EPL, CL) | P3 | Summer |
| UFC/MMA model | P3 | TBD |
| Tennis model | P3 | TBD |
| Same-game parlay correlation | P3 | May |
| Arbitrage scanner (cross-book) | P3 | May |
| Live in-game models | P3 | May |
| Daily P&L automated report | P2 | April |
| Weekly strategy digest | P3 | May |
| Bankroll growth projections | P3 | May |

---

## Session Log

| Session | Time | What Got Done |
|---------|------|---------------|
| #1 | 2026-03-19 06:33 | Project created, PLAN.md, TASKS.md, initial structure |
| #2 | 2026-03-19 07:00 | Multi-sport dashboard v3.0 — NBA+MLB+NHL models, backtests, value detection |
| #3 | 2026-03-19 18:00 | MLB Starting Pitcher Model + Poisson Totals v4.0 |
| #4 | 2026-03-19 20:45 | MLB Opening Day Projections v5.0 — 19-game schedule |
| #5 | 2026-03-20 19:20 | Live Data Feeds + Kelly Optimizer v6.0 |
| #6-29 | 2026-03-20/22 | MASSIVE expansion: Rolling stats, injuries, line movement, Kalshi, player props, weather, umpires, alt lines, backtests, Statcast, platoon splits, catcher framing, stolen bases, K props, NHL playoffs, goalie starters, season sim, NFL futures, conviction engine, execution engine, and 20+ more features. v6→v63 |
| #30-54 | 2026-03-22/25 | OD preparation: Full playbook, weather pre-check, pitcher validation, Bayesian updates, live execution engine, OD preflight (🟢 GO), Fried vs Webb analysis, starter sync, production fixes, deployment cleanup. v63→v128 |
| Planning | 2026-04-14 | **THIS SESSION** — Full strategic review. Production healthy at v128. NBA Play-In starts today. NHL playoffs in 5 days. MLB 2.5 weeks in. New tasks 114-123 created. |

---

## Key Results (Current)

### Model Performance
- **NBA:** 71% ML, 50.4% ATS (-3.8% ROI), 66.7% Totals (+27.3% ROI)
- **MLB:** 71% ML, 30.2% ROI overall, 42.3% ROI on 10%+ edges
- **NHL:** Model live but 0 backtest games (CRITICAL GAP)
- **NFL:** 30 futures value bets, MIA OVER 4.5 (+39.6% edge)

### Live Data Status (as of now)
| Source | Status | Freshness |
|--------|--------|-----------|
| ESPN (NBA/MLB) | ✅ Live | 53min |
| NHL Official API | ✅ Live | 53min |
| Injuries (all) | ✅ Live | 23min |
| Rolling Stats | ✅ Live | 53min |
| The Odds API | ✅ Live | Real-time |
| Kalshi | ⚠️ Stale | 24+ days |
| Statcast | ⚠️ Stale | 18 days |

### Active Value Bets (from production)
- **MLB Futures:** NYY AL East +21.3%, OAK OVER +18.7%, BAL UNDER +14.2%, CHC OVER +13.1%, CWS OVER +13.0%
- **NFL Futures:** MIA OVER 4.5 +39.6%, BAL UNDER 11.5 +24.4%, SEA OVER 10.5 +22.7%
- **Kalshi:** 119 value bets (needs refresh)

### Research Findings (April 14 Planning Review)
- **NBA Play-In:** PHX -3.5 vs POR tonight. POR better recent form (14-10 vs 12-12). Embiid out for PHI → Magic should cover in East play-in.
- **NBA Playoff Strategy:** Fade Game 1 overreactions (sharp edge). Unders profitable early in series. Stars play 38-42 min → fatigue mid-series. Home court 2-3pts but less in later rounds.
- **NBA Situational Angles (VSiN):** CLE just 7-21 ATS vs winning teams. DEN 13-1 OVER. ATL 0-7 ATS as small home fav. DAL 2-13 SU vs winning road teams. Top 25 angles all >72% hit rate.
- **NHL Playoff Edge:** Underdog value in NHL playoffs (parity sport). Goalie matchup is everything. Our DailyFaceoff integration is a key edge.
- **MLB:** Fangraphs 2026 projections align with our model on 28/30 teams. Early season small sample = biggest ML edges of the year.
- **Kalshi Expansion:** Filed to offer football props, sides, totals with CFTC. New market = early pricing inefficiency.
- **Data APIs:** pybaseball (Python MLB stats), MLB Stats API, Baseball Savant Statcast — all free. Consider adding nba_api (Python) for more granular NBA data.

---

*Last updated: 2026-04-14 02:55 UTC*
*🏀 NBA PLAY-IN STARTS TODAY — PHX vs POR 10pm ET*
*🏒 NHL PLAYOFFS: April 19 (5 days)*
*🏈 NFL DRAFT: April 24 (10 days)*
*Next: Build tasks 114-116, refresh stale data, get ready for playoff betting*
