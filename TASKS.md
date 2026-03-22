# SportsSim Task Tracker

## 🚨 URGENT
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 062 | **🚨 PRODUCTION DOWN — Memory Fix** | ⏳ IN PROGRESS | P0 | sportssim.fly.dev timing out since ~17:50 UTC. TLS handshake succeeds but app hangs (no HTTP response). Root cause: 256MB VM OOM during startup data refresh (Statcast 853 pitchers + 651 batters + rollingStats + injuries + weather all refreshing simultaneously via Promise.all()). FIX: Bumped fly.toml from 256MB → 512MB, added health check with 120s grace period. Needs git push to trigger GH Actions redeploy. |
| 063 | **NCAA March Madness Model** | ⏳ NEW | P2 | 🎯 NEW EDGE: Sweet 16 happening NOW (March 22). March Madness = massive betting market we're NOT covering. Games today: Iowa vs Florida, SD State vs UConn, Texas Tech vs Arizona, more. Tournament bracket model with KenPom-style ratings would capture edge on upset pricing. Public overvalues seeds, unders are historically profitable. Could be v60 feature. |
| 061 | **asyncPredict Full Signal Stack Fix** | ✅ DONE | P0 | CRITICAL FIX v58.0: asyncPredict() was missing weather+umpire auto-fetch. All prediction paths now get full signal stack via parallel Promise.all(). OD dry run: 21/21 PASS. |
| 054 | **Pre-Opening Day Final Check** | ⏳ QUEUED | P0 | End-to-end test on March 26: MLB lineup pipeline, F5 unders scan, Opening Day Playbook, weather integration, auto-scanner MLB flow. All MUST work for March 27. **4 DAYS LEFT.** BLOCKED: Production must be back up first (task 062). |
| 057 | **NBA Seeding Sim → Futures Value Bridge** | ✅ DONE | P1 | BUILT v55.0: seeding-futures-bridge.js — 10K seeding MC sim → championship/conference probs → live Odds API futures comparison. Model vs market edge detection, FADE detection, volatile matchup edge finder. 3 API endpoints + dashboard tab. |
| 058 | **Opening Day Weather Pre-Check** | ✅ DONE | P1 | BUILT v55.0: weather-forecast.js — Open-Meteo 5-day hourly forecast for all 20 OD games. LIVE DATA: BOS@CIN GM2 = 34°F EXTREME COLD, WSH@CHC = Wrigley wind OUT 17.5mph OVER, 4 games with 28-37mph gusts. Postponement risk assessment, betting impact analysis, Wrigley/Oracle wind detection. Dashboard tab + 3 API endpoints. |
| 059 | **Spring Training Signal Validation** | ✅ DONE | P2 | VALIDATED: LAD 19-8 → stWeight 0.06 (highest), offense +0.6, pitching +0.5. SF 19-9 → stWeight 0.05. ATL 18-6 → stWeight 0.05. ST leaders get appropriately higher weights. SEA 10-17 correctly notes "worst spring but elite pitching = NOISE." Min 8-17 → stWeight 0.03. CWS 15-14 → stWeight 0.03. Weights are 3-6% of prediction = conservative and correct. No changes needed. |
| 060 | **NFL Win Total Futures Model** | ✅ DONE | P2 | BUILT v56.0: Full NFL model — Pythagorean power ratings (N=2.37) for all 32 teams from 2025 ESPN data, 35% mean regression, offseason adjustments, 10K MC season simulation, win total value detection vs DraftKings lines. Key findings: MIA OVER 4.5 (+39.6% edge), BAL UNDER 11.5 (+24.4%), SEA OVER 10.5 (+22.7%), KC bounce-back model (6W→10.2W proj). 30 value bets found. 5 API endpoints + 🏈 NFL Futures dashboard tab with 5 sub-views. Super Bowl probabilities, division projections, game predictor. Draft April 24 = 33-day early mover window. |
| 051 | **NBA Rest/Tank Model Backtest** | ⏳ TRACKING | P1 | Track outcomes of rest/tank predictions to validate model accuracy. |

### Previous URGENT (completed)
| ID | Task | Status | Priority | Notes |
|| #17 | 2026-03-22 09:20 | **MLB Data Validation + FanGraphs RS/RA Blend v41.0** — CRITICAL DATA AUDIT: Validated all 30 MLB teams against ESPN 2025 final standings AND FanGraphs 2026 Depth Charts projected RS/RA. OAK/LAA initially appeared swapped (ESPN labeling issue) but FanGraphs confirms original data correct. All base stats verified ✅. NEW FEATURE: Integrated FanGraphs 2026 projected RS/G and RA/G as 35% blend into season simulator — independent ZiPS+Steamer player-level projections reduce prediction error via ensemble effect. Season sim now produces more conservative, accurate edges: max 5.3W (was 7W+). Model agrees with FanGraphs directionally on 28/30 teams. Also: confirmed tasks 044-047 all completed (NBA rest/tank model, opening week unders, data validation, sim sanity check). |
| #19 | 2026-03-22 12:40 | **🚨 CRITICAL Auto-Scanner Bug Fix + asyncPredict Upgrade v47.0** — Found and fixed TWO critical bugs in auto-scanner.js: (1) predict() args were SWAPPED (home,away instead of away,home) — every auto-scanner value bet had HCA backwards since it was built. Favorites showed as underdogs. (2) MLB homeWinProb scale mismatch — MLB returns 0-1 fraction but scanner divided by 100 = 0.00487 instead of 0.487. UPGRADES: Auto-scanner now uses asyncPredict() for MLB (lineup/rest/opening-week data flows into value detection). Added totals scanning (was only doing moneylines). NHL predict() format handled correctly. /api/value/nba upgraded to asyncPredict for rest/tank analysis. Sport-specific total variance scaling. Tasks 048-050 confirmed DONE (all API endpoints + dashboard tabs were built in prior sessions). |
| #20 | 2026-03-22 14:00 | **Planning Session #20: Phase 2.75 → Phase 2.9** — Phase 2.75 COMPLETE ✅ (playoff preview, lineup pipeline, F5 unders all live). Production health: scanner running but scans 1.2h overdue (reliability concern). Data 70min stale (auto-refresh triggered). KEY FINDINGS: (1) 0 NBA/NHL value bets found today despite 13 games — investigating threshold/odds issues. (2) NHL playoffs 28 days away — COL(100pts)/DAL(96)/CAR(94)/BUF(92) top seeds, but East bubble is WILD with PIT/MTL/BOS/DET ALL at 84pts = volatile matchup projections = early pricing edge. (3) NBA standings updated: OKC 56-15, SAS 53-18, DET 51-19. POR@DEN both B2B tonight (DEN COASTING, POR DESPERATE). (4) MLB Opening Day 5 days away — need final check March 26. NEW TASKS: 052 (NHL playoff series model P0), 053 (NHL goalie starters P0), 054 (pre-OD final check P0), 055 (scanner reliability P1), 056 (daily value gap investigation P1). Priority order: 052 → 053 → 054 → 055 → 056. NHL playoff series model is highest-impact new work — books haven't posted series prices yet for most matchups, and the 84-point East bubble creates asymmetric mispricing opportunity. |
| #21 | 2026-03-22 14:40 | **NHL Playoffs Dashboard + CRITICAL Auto-Scanner Fix + Watchdog v51.0** — THREE major deliverables: (1) 🏒 NHL Playoffs Dashboard Tab — full loadNHLPlayoffsTab() with Stanley Cup probabilities, conference brackets with division standings, wild card race, matchup cards (win%, ML, goalie edge, special teams, home ice), bubble watch, dark horses section, NHL Series Analyzer tool, Round 1 Fair Prices table. (2) 🚨 CRITICAL BUG FIX — Auto-scanner's scanAllValue() was silently finding 0 value bets because it accessed `game.home_team`/`game.away_team` (raw Odds API fields) but getAllOdds() returns enriched objects with `game.home`/`game.away`/`game.books`. Every game was skipped silently. THIS BUG EXISTED SINCE THE AUTO-SCANNER WAS BUILT. Fixed to use enriched data. Also fixed extractBookLine() to include overOdds/underOdds for totals scanning. (3) 🐕 Scanner Watchdog — 15-minute watchdog timer that detects stuck scans (>5min running = timeout), auto-forces re-run of overdue scans (>3x interval in active hours). Prevents the "scans 1.2h overdue" issue. Tasks 052, 055, 056 all DONE. |
| #22 | 2026-03-22 15:00 | **🥅 NHL Goalie Starter Integration v53.0** — MAJOR FEATURE: Full DailyFaceoff goalie starter integration. New `services/nhl-goalie-starters.js` fetches confirmed goalie starters from DailyFaceoff __NEXT_DATA__ JSON with full stats (SV%, GAA, W-L-OTL, confirmation status). Backup detection against 32-team starter depth charts. NHL model now has `asyncPredict()` that auto-fetches today's actual goalie matchup data and adjusts predictions with real SV% instead of static team averages. Wired into ALL prediction paths: /api/value/nhl, /api/value/all, auto-scanner, daily-picks. 4 new API endpoints: /api/nhl/goalies/today, /api/nhl/goalies/matchup/:away/:home, /api/nhl/goalies/impact, /api/nhl/predict-live. New 🥅 NHL Goalies dashboard tab with goalie comparison cards, backup alerts, spread impact analysis. TODAY'S KEY FINDINGS: 8 of 9 games have backup goalies starting (Sunday rest day). VGK@DAL: Hill(.869) vs DeSmith(.907) = 13 cent ML swing. BUF@ANA: Lyon(.914) vs Dostal(.893) = 7 cent move toward BUF. WPG@NYR: Comrie(.895) backup for Hellebuyck → +3.6% NYR win prob shift. Task 053 DONE. |
| #23 | 2026-03-22 16:00 | **Planning Session #23: Phase 2.9 Status + New Edge Research** — PRODUCTION HEALTH: All systems HEALTHY. Data feeds 24min fresh, scanner running with no overdue scans (watchdog working ✅). 0 daily game-day value bets (Sunday afternoon games haven't started yet, expected). 11+ MLB futures value bets live (NYY AL East +22.6%, OAK OVER +17.9%, BAL UNDER +13.5%, CWS OVER +12.7%, CHC OVER +12.6%). NBA Seeding Simulator (v54.0) live and working — key battles identified: TOR/ATL deadlocked for East 6/7, MIN/DEN 0.3 gap for West 4/5, MIA/CHA play-in battle. STANDINGS UPDATE: OKC 56-15 (#1), SAS 53-18, DET 51-19, BOS 47-23, LAL/NYK 46-25. NHL: COL 100pts, DAL 96, CAR 94, BUF 92, MIN 90, TBL 88. East bubble STILL wild: PIT/MTL/BOS/DET ALL 84pts, CBJ/NYI 83pts. MLB Spring Training: LAD 19-8, SF 19-9 lead Cactus. EDGE RESEARCH: (1) Seeding sim battles should pipe into futures value — volatile seeding = mispriced series futures. (2) Opening Day weather pre-caching needed for March 27 accuracy. (3) ST leaders (LAD, SF) may warrant preseason-tuning weight validation. (4) NFL Draft 33 days away — win totals futures are already live, early mover window for NFL model. NEW TASKS: 057 (seeding→futures bridge P1), 058 (OD weather pre-check P1), 059 (ST signal validation P2), 060 (NFL win totals P2). PRIORITIES: 054 (OD final check) remains P0, 057+058 are the highest-impact new work for this week. Phase 2.9 is 80% complete — just the OD final check and weather pre-cache before March 27 D-Day. |
| #24 | 2026-03-22 17:40 | **🚨 CRITICAL: asyncPredict Full Signal Stack + OD Dry Run v58.0** — Found and fixed MAJOR accuracy gap: asyncPredict() was only fetching rest/travel + lineups, but NOT weather or umpire data. This meant auto-scanner, value detection, daily picks, and /api/mlb/predict were ALL running WITHOUT weather adjustments — a 5-15% total runs accuracy miss for outdoor parks. FIX: asyncPredict() now parallel-fetches ALL 4 async signals via Promise.all(): (1) rest/travel, (2) lineups, (3) LIVE WEATHER from Open-Meteo, (4) umpire assignments from DailyFaceoff. Also: Opening Week unders now uses actual pitcher tier from resolved starters (was defaulting to tier 3). Server endpoints upgraded: /api/mlb/predict and value detection MLB path both use asyncPredict now. NEW: test-opening-day-dryrun.js — comprehensive 20-game OD validation. DRY RUN RESULTS: 21/21 PASS ✅, 35/35 pitchers in DB, 13/20 weather active (7 dome correctly excluded), 20/20 OW unders applied, 20/20 rest/travel. VALUE BETS vs DK: DET@SD ML +5.8%, CWS@MIL ML +4.4%, TB@STL ML +3.7%, KC@ATL ML +3.7%. Weather examples: Fenway 42°F wind-in = 0.944x (-5.6% runs), Wrigley wind-out = 1.015x (+1.5% runs), Busch warm = 1.022x. New _asyncSignals tag on every prediction shows which signals were active. Task 061 (asyncPredict signal gap) DONE. |
| #25 | 2026-03-22 18:00 | **Planning Session #25: 🚨 PRODUCTION DOWN + New Edge Discovery** — CRITICAL: sportssim.fly.dev is DOWN. TLS connects but server hangs — zero bytes received on all endpoints including /api/health. Last successful deploy was 17:50 UTC (GH Actions run #74, conclusion:success). Root cause diagnosis: 256MB VM is OOMing during startup — Promise.all() tries to load Statcast (853 pitchers + 651 batters via Python bridge), rollingStats (3 sports × ESPN/NHL APIs), injuries, weather, playerStats ALL simultaneously. The app has grown from ~5 services at launch to 40+ services. FIX: Bumped fly.toml VM memory from 256MB → 512MB. Added Fly.io health check (30s interval, 10s timeout, 120s grace period for /api/health). This will trigger redeploy via GH Actions on push. EDGE RESEARCH: (1) 🎯 NCAA March Madness Sweet 16 is happening TODAY — Iowa vs Florida, SD State vs UConn, Texas Tech vs Arizona. This is a MASSIVE betting market we're completely missing. Tournament bracket model with KenPom-style ratings would capture edge on upset pricing — public overvalues seeds. Created task 063. (2) NBA standings update: TOR(39-30) and ATL(39-32) still battling for E 6/7. PHI also at 39-32. PHX at 39-32 in West. MIN/DEN both 43-28 for W 4/5. These volatile seedings = mispriced series futures. (3) NHL live today: WSH leading COL 1-0 (P2), NYR-WPG tied 2-2 (P3), plus CAR@PIT, BUF@ANA, VGK@DAL. (4) Spring training: NYY 0 PHI 0 (4th), STL 3 HOU 1 (7th). PRIORITIES: (1) Push memory fix to restore production IMMEDIATELY (062 P0). (2) Pre-OD final check once production is back (054 P0). (3) NCAA model as new revenue stream (063 P2). Countdown: MLB OD 5 days, NBA playoffs 21 days, NHL playoffs 28 days. |

----|------|--------|----------|-------|
| 043 | **MLB Roster Changes Audit** | ✅ DONE | P0 | All 30 teams now in ROSTER_CHANGES. BAL fixed (Alonso, O'Neill, Bassitt, Eflin, Baz, Helsley etc). Season sim now projects BAL at 84W (was 77W). |
| 044 | **MLB Base Static Data Validation** | ✅ DONE | P0 | Validated all 30 teams against ESPN 2025 final standings AND FanGraphs Depth Charts. OAK/LAA initially appeared swapped but FanGraphs confirms original data correct. CWS 60-102 confirmed exact. All W-L, RS/G, RA/G match within 0.01. OAK OVER 63.5 edge (sim=69W) is real: both our model and FanGraphs (80W) agree DK undervalues. CWS OVER 58.5 edge (sim=63W) is plausible: FanGraphs has them at 69W. No data errors found. |
| 045 | **Season Sim Sanity Check** | ✅ DONE | P1 | Re-ran with FanGraphs RS/RA blend (35% FG + 65% our model). Max edge now 5.3W (OAK OVER), down from 7W+. All edges ≤5.3W — within normal preseason projection variance. Model agrees with FanGraphs directionally on 28/30 teams. Biggest edges: OAK OVER 63.5 (+5.3W), CWS OVER 58.5 (+4.2W), TOR OVER 79.5 (+3.8W), ATL UNDER 91.5 (-3.8W). |
| 046 | **NBA Rest/Tanking Model** | ✅ DONE | P0 | Full service built: B2B/3in4/4in6 detection, motivation analysis (TANKING/RESTING/DESPERATE/COMPETING), mismatch detection. Wired into asyncPredict() for NBA. Dashboard tab with game-by-game analysis + conference motivation map. API endpoints: /api/nba/rest-tank/scan, /api/nba/rest-tank/:away/:home, /api/nba/rest-tank/motivation/:team. |
| 047 | **MLB Opening Week Unders** | ✅ DONE | P1 | Service built with cold weather, ace starters, rusty bats, expanded rosters factors. Wired into MLB predict(). Dashboard integration. API endpoints. Park-by-park breakdown. |

## Active Sprint
| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| 035 | Polymarket Value Bridge | ✅ DONE | P1 | Model vs market edge detection, cross-market arbitrage, futures value, 6 dashboard sub-tabs |
| 007 | NBA backtest (500+ games) | 🔄 PARTIAL | P1 | 176 games done, need more data |
| 022 | NHL backtest expansion | ⏳ QUEUED | P2 | Add more games for validation |
| 036 | MLB preseason model tuning | ✅ DONE | P1 | Spring training signals, roster changes, new-team pitcher penalties, OD starter premium |
| 037 | Automated daily scan cron | ✅ DONE | P2 | Auto-scanner service built + dashboard tab functional |
| 038 | Opening Day Playbook endpoint | ✅ DONE | P0 | /api/opening-day-playbook aggregates ALL signals, Kelly sizing, game grades |

## Completed
| ID | Task | Completed | Result |
|----|------|-----------|--------|
| 053 | NHL Goalie Starter Integration | 2026-03-22 | DailyFaceoff live data, asyncPredict, backup detection, 4 API endpoints, dashboard tab, full pipeline integration |
| 052 | NHL Playoff Series Dashboard | 2026-03-22 | Full dashboard tab: Stanley Cup odds, bracket, series analyzer, bubble watch, dark horses, futures value |
| 055 | Scanner Reliability Fix | 2026-03-22 | 15-min watchdog timer, stuck scan timeout detection, auto re-run overdue scans |
| 056 | Value Detection Gap Fix | 2026-03-22 | ROOT CAUSE: scanAllValue() used wrong field names (home_team vs home). Fixed + overOdds/underOdds in extractBookLine |
| 048 | NBA Playoff Preview Endpoint | 2026-03-22 | LIVE: /api/playoffs/preview — bracket view, series prices, championship odds, futures scanner |
| 049 | MLB Daily Lineup → Prediction Pipeline | 2026-03-22 | asyncPredict() wired for all MLB value endpoints + auto-scanner |
| 050 | MLB F5 Opening Week Unders Scan | 2026-03-22 | /api/opening-week/f5-scan — Poisson F5 scoring + OW adjustments + dashboard tab |
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
| 037 | Auto-scanner dashboard tab | 2026-03-22 | Auto Scanner dashboard tab functional, start/stop/force-scan controls |
| 038 | Opening Day Playbook | 2026-03-22 | Full war room: analytical+ML+Statcast+weather+umpire+preseason signals, Kelly sizing, game grades A+-D, Action Board |
| 040 | Verify NBA totals in production | 2026-03-22 | NBA totals confirmed at 230.4 (was ~121). All v25-v34 features live. |
| 042 | Season Simulator → API + Dashboard | 2026-03-22 | 8 API endpoints, 🏆 MLB Futures tab with 5 sub-views, futures in /api/value/all |

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
| #11 | 2026-03-22 01:20 | **Polymarket Value Bridge v30.0** — NEW SERVICE: `services/polymarket-value.js` bridges our NBA/MLB/NHL model predictions with Polymarket crowd prices to find +EV prediction market bets. Features: (1) Auto-matches Polymarket questions to model predictions via 300+ team aliases. (2) Calculates true edge with Kelly sizing for all +EV bets. (3) Cross-market arbitrage scanner — compares sportsbook lines to Polymarket prices, finds guaranteed profit opportunities. (4) Championship futures value — power rating simulations vs market odds. (5) Wired into `/api/value/all` combined endpoint — Polymarket value bets now appear alongside sportsbook edges. (6) Dashboard Polymarket tab redesigned with 6 sub-tabs: Model Edge (default), Cross-Market Arb, Futures Value, Featured, Movers, Games. API endpoints: `/api/polymarket/value`, `/api/polymarket/arbitrage`, `/api/polymarket/futures-value`. Task 035 completed. |
| #12 | 2026-03-22 02:00 | **MLB Preseason Tuning v31.0** — OPENING DAY READY: New `services/preseason-tuning.js` wired into MLB model. (1) Spring training signals for all 30 teams — offense/pitching/chemistry ratings weighted at ~3-6% based on team signal strength. (2) 12 key roster changes tracked: Crochet→BOS, Gray→BOS, Peralta→NYM, Ozuna→PIT, Lowe→PIT, Valdez→DET, Kikuchi→LAA, Severino→OAK, Rogers→BAL, Castellanos→SD, and departure impacts. (3) 8 new-team pitcher penalties: pitchers on new teams get 4-6% performance penalty for Opening Day (unfamiliar catchers, new mound, etc.). (4) Opening Day starter premium: starters go 5.8 IP vs 5.5 regular season (bullpens not trusted yet). (5) Bullpen uncertainty ratings by team. (6) All wired into `predict()` — runs automatically during preseason. (7) Dashboard roster changes section added. (8) New API: `/api/model/mlb/preseason-tuning`. Task 036 completed. |
| #13 | 2026-03-22 04:00 | **CRITICAL DEPLOY FIX + Auto-Refresh v34.0** — Planning session discovered ALL Fly.io deploys have been FAILING since v25.0 (5+ commits). Root cause: Dockerfile used `node:20-alpine` with `apk add py3-scipy && pip3 install scikit-learn` — scikit-learn needs C compiler (gcc/meson) which Alpine doesn't include. Every push to main triggered GH Actions → test passed → deploy FAILED. This means the NBA totals bug fix (v21.0), spread calibration (v23.0), Statcast integration (v26.0), Polymarket bridge (v30.0), and Opening Day Playbook (v33.0) NEVER DEPLOYED TO PRODUCTION. Fix: switched to `node:20-slim` (Debian-based) where pip install works natively. Also added 2-hour periodic data auto-refresh — production data was 32+ hours stale because server only refreshed on startup. Tasks 039, 041 completed. |
| #14 | 2026-03-22 04:40 | **MLB Season Simulator Dashboard v36.0** — MAJOR FEATURE: Wired season-simulator.js (Monte Carlo 162-game season sim) to server API + dashboard. 8 new API endpoints: /api/season-sim (full report), /rankings, /win-totals, /divisions, /world-series, /team/:abbr, /top-bets, /refresh. Dashboard: new 🏆 MLB Futures tab with 5 sub-views — Top Bets overview, Power Rankings (30-team table + division bars), Win Totals (OVER/UNDER split vs DK), Division Winners, World Series championship probability chart. Futures value bets wired into /api/value/all. 30-minute cache for expensive sims. Also: Dockerfile updated with xgboost+lightgbm+libgomp1 for ML ensemble, lineup-fetcher.js committed, prod deploy verified (NBA totals 230.4 ✅). Tasks 040, 042 completed. |
| #15 | 2026-03-22 06:00 | **Planning Session: CRITICAL Roster Bug Found** 🚨 — Discovered BAL is COMPLETELY MISSING from ROSTER_CHANGES in preseason-tuning.js. They added Pete Alonso (1B), Tyler O'Neill (OF), Chris Bassitt (SP), Zach Eflin (SP), Shane Baz (SP), Ryan Helsley (closer), Taylor Ward, Leody Taveras — none modeled. Season sim has BAL at 77W (should be ~87-90W). BAL UNDER 88.5 showing as biggest +EV bet at 45.7% edge — this is almost certainly WRONG. Same concern for TOR OVER 79.5 (model has 90W, might be right but need validation). All futures value bets are suspect until roster audit complete. Priority: P0 task 043 to audit all 30 teams' roster changes before Opening Day March 27. Production otherwise healthy — data refreshing every 2hrs, all v25-v36 features live. |
| #16 | 2026-03-22 08:00 | **Planning Session: Status Check & New Edges** — Production healthy: all live data feeds fresh (13 min old), auto-refresh working, 18 value bets detected. Season sim now running with Bayesian calibration. BAL fixed to 84W (was 77W). Key findings: (1) CWS OVER 58.5 shows 33.8% edge (sim=65W) — likely base data issue, CWS base=60-102 but Murakami addition may be overvalued. (2) OAK OVER 63.5 at 26.2% edge (sim=67.8W) — also suspect. (3) BAL UNDER 88.5 at 24% edge is most plausible bet. NEW EDGES IDENTIFIED: (A) NBA rest/tanking model for final 12 games — teams locked in resting stars or tanking creates systematic mispricings. OKC (55-15), SAS (52-18), DET (51-19) may rest. IND (15-55) full tank. (B) MLB Opening Week unders — historical edge with cold weather, ace starters going deep, rusty bats. (C) Daily MLB lineups integration for game-day model. TODAY: 5 NBA games (POR@DEN, BKN@SAC, WAS@NYK, MIN@BOS, TOR@PHX) + 9 NHL games. No MLB until March 27. Tasks 046 (NBA rest/tank model) and 047 (Opening Week unders) created as P0/P1. |
| #17 | 2026-03-22 09:20 | **MLB Data Validation + FanGraphs RS/RA Blend v41.0** — CRITICAL DATA AUDIT: Validated all 30 MLB teams. FanGraphs blend integrated. Max edge 5.3W. Tasks 044-047 all confirmed complete. |
| #18 | 2026-03-22 10:00 | **Planning Session #18: Phase 2.5 Complete → Phase 2.75** — All calibration tasks done ✅. Phase 2.5 officially COMPLETE. Production healthy (data 90min stale, auto-refresh working). Rest/tank model live and detecting edges: today POR@DEN (DESPERATE vs COASTING, -2.0 netAdj) and WAS@NYK (TANKING vs COASTING, +4.3 netAdj) are SIGNIFICANT mismatches. MLB futures: 11+ value bets live (CWS OVER 58.5 +32%, NYY AL East +24.8%, OAK OVER 63.5 +23.8%, BAL UNDER 88.5 +20.5%). NBA playoff seedings nearly locked: OKC(1)/SAS(2) clear top 2 West, DET(1) clear top East. NEW PRIORITIES: (048) NBA Playoff Preview endpoint — wire playoff-series.js to generate series prices BEFORE books adjust. 21 days = still early mover window. (049) MLB Daily Lineup pipeline — MUST be wired by March 27 Opening Day. (050) F5 Opening Week unders scan. (051) Rest/tank model backtest on today's 5 games. Next build session should tackle 048 (NBA playoff preview) as highest-impact new feature. |

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
*Last updated: 2026-03-22 18:00 UTC*
*MLB OPENING DAY: 5 DAYS (March 27) 🔥🔥🔥*
*NBA PLAYOFFS: 21 DAYS (April 12)*
*NHL PLAYOFFS: 28 DAYS (April 19)*
*NFL DRAFT: 33 DAYS (April 24)*
*🚨 PRODUCTION DOWN — fix deploying (256MB→512MB)*
*✅ Phase 2.75 COMPLETE + Phase 3 PARTIAL: NHL playoffs, goalie starters, NBA seeding sim, NFL futures all LIVE*
*✅ CRITICAL FIX v58.0: asyncPredict now auto-fetches weather+umpire+rest+lineup — full signal stack*
*✅ OD DRY RUN: 21/21 PASS, 35/35 pitchers, 13/20 weather active, 4 value bets found*
*🔧 P0: Production memory fix (062), Pre-Opening Day final check (054)*
*🎯 NEW EDGE: NCAA March Madness (063) — Sweet 16 TODAY, massive market not covered*
*Next build priorities: 062 (production fix) → 054 (OD final check March 26) → 063 (NCAA model)*
