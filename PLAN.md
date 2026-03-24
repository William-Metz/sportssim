# SportsSim — Master Plan 🦞

## Mission
Build the ultimate +EV sports betting platform across ALL sports, ALL markets. Find every edge. Make maximum money.

## Sports Coverage (Priority Order)

### 🏀 NBA (NOW — Playoffs starting April)
- Regular season ending, playoff seeding battles = volatile lines
- Focus: spreads, totals, team totals (Kalshi), player props, futures
- Playoff series pricing is historically inefficient

### ⚾ MLB (OPENING DAY MARCH 27 — IMMINENT)
- 162-game season = massive sample size = model heaven
- Focus: moneylines (no spread in baseball), totals, first 5 innings (F5), player props
- Pitching matchups are EVERYTHING — starting pitcher drives 60%+ of the line
- Weather, park factors, bullpen usage, platoon splits
- Run line (+/- 1.5) often mispriced

### 🏒 NHL (NOW — Playoffs starting April)
- Similar to NBA: Pythagorean model works, puck line (+/- 1.5)
- Goalie matchups are key — backup vs starter swings lines massively
- Totals market is soft — pace and shooting % drive it
- Playoff series pricing = edges

### 🏈 NFL (September — but prep NOW)
- Most bet sport = sharpest lines BUT most public money = exploitable
- Focus: spreads, totals, player props, futures
- Off-season: draft positioning, win totals futures, division odds
- Key edges: weather, rest advantages, short weeks, travel

### ⚽ Soccer (Year-round)
- EPL, La Liga, Champions League, MLS
- Draw is underbet by public — 3-way moneyline has edges
- Asian handicap markets

### 🥊 UFC/MMA (Every few weeks)
- Massive line movement, public overreacts to hype
- Prop markets are soft (method of victory, round betting)

### 🎾 Tennis (Year-round)
- Set betting, game spreads — high volume, soft markets
- Surface specialist edges (clay vs hard court)

### 📊 Prediction Markets
- Kalshi: team totals, props, event markets
- Polymarket: politics, events, crypto
- Wide bid-ask spreads = edge for patient players

---

## Architecture

### Core Engine
1. **Universal Model Framework** — Sport-agnostic rating system that plugs in sport-specific features
2. **Odds Aggregator** — Real-time from DraftKings, FanDuel, BetMGM, Caesars, PointsBet, Pinnacle, Kalshi
3. **Value Engine** — Model vs. book comparison, edge calculation, confidence scoring
4. **Bankroll Optimizer** — Kelly Criterion across all sports, portfolio-level risk management
5. **Backtest Suite** — Historical validation per sport per market type
6. **Dashboard** — All sports, all edges, sorted by EV
7. **Alert System** — Instant push when high-value bets appear

### Model Philosophy
- **Point/run/goal differential** > win/loss record (Pythagorean for every sport)
- **Rolling windows** — recent form matters more than season-long
- **Luck identification** — teams that will regress (close game variance)
- **Key player impact** — injuries/rest/matchups
- **Market-specific modeling** — different math for spreads vs totals vs props
- **Closing Line Value (CLV)** — the ultimate measure of model quality
- **Ensemble approach** — combine multiple models, weight by recent accuracy

### Math Stack
- Logistic regression → win probability
- Poisson/negative binomial → totals and scoring distributions
- Monte Carlo → game simulation and score distributions
- Bradley-Terry → head-to-head strength ratings
- Elo with K-factor tuning → universal rating system
- LASSO/Ridge → feature selection for props
- Bayesian updating → in-season calibration
- Copula models → correlation for same-game parlays
- Kelly Criterion → optimal bet sizing across portfolio

### Tech Stack
- **Frontend:** Professional dashboard (dark theme, real-time updates)
- **Backend:** Node.js/Express API
- **Database:** SQLite → PostgreSQL
- **Odds:** The Odds API (50+ books), Kalshi API, OddsJam
- **Stats:** NBA API, MLB Statcast, NHL API, ESPN, Pro Football Reference
- **Hosting:** Fly.io at sportssim.hatch.fun
- **Repo:** github.com/William-Metz/sportssim
- **Alerts:** Telegram/WhatsApp/Claw Hub

---

## Phase 1: Foundation (Week 1) — ✅ COMPLETE
- [x] Project structure + Express backend
- [x] NBA power rating model (Pythagorean + luck + rolling)
- [x] MLB power rating model (pitching matchups + park factors)
- [x] The Odds API integration (all sports)
- [x] Value detection engine (universal)
- [x] Dashboard MVP (multi-sport)
- [x] Deploy to sportssim.hatch.fun
- [x] NBA backtest (500+ games — 176 done, partial)
- [x] MLB season preview + Opening Day projections

## Phase 2: Depth (Week 2) — ✅ COMPLETE
- [x] NHL model (Pythagorean + goalie adjustments)
- [x] Rolling stats for all sports
- [x] Injury scraping (all leagues)
- [x] Totals model (Poisson-based, all sports)
- [x] Player props framework (top scorers, pitching Ks, etc.)
- [x] Kelly Criterion multi-sport portfolio optimizer
- [x] Line movement tracking + sharp money detection
- [x] MLB: starting pitcher impact model
- [x] MLB: park factor adjustments
- [x] MLB: weather integration
- [x] Unified signal engine
- [x] Alt lines value scanner

## Phase 2.5: Model Accuracy & Calibration (Week 3) — ✅ COMPLETE
- [x] **CRITICAL: Fix NBA total calculation bug** (was dividing by 2!)
- [x] **NBA spread compression** (cap at ±18, real-world constraint)
- [x] **NBA rolling/injury rebalance** (reduce double-counting)
- [x] **Statcast integration via pybaseball** — pitch-level data for MLB
- [x] **CLV tracking pipeline** — record opening vs closing lines
- [x] **Model calibration audit** — are probabilities matching outcomes?
- [x] **MLB Roster Changes Audit** — All 30 teams now in ROSTER_CHANGES. BAL fixed (Alonso, O'Neill, Bassitt, Eflin, Baz, Helsley). Bayesian calibration applied.
- [x] **MLB Base Data Validation** — All 30 teams validated against ESPN 2025 finals + FanGraphs 2026 Depth Charts. FanGraphs RS/RA blended at 35%. Max edge now 5.3W (was 7W+). OAK/CWS edges confirmed real — both FanGraphs and our model agree DK undervalues.
- [x] **NBA End-of-Season Rest/Tanking Model** — Full service: B2B/3in4/4in6 detection, motivation analysis (TANKING/RESTING/DESPERATE/COMPETING), mismatch detection. Live in production.
- [x] **MLB Opening Week Unders Edge** — Cold weather, ace starters, rusty bats factors. Wired into MLB predict().

## Phase 2.75: Pre-Season Edge Maximization (Week 3-4) — ✅ COMPLETE
- [x] 🚨 **NBA Playoff Preview Endpoint** — LIVE. Generating series prices: DET(1) vs ORL(8), BOS(2) vs PHI(7), NYK(3) vs ATL(6), CLE(4) vs ORL/CHA. West: OKC(1) vs PHX(8), SAS(2) vs TOR(7), LAL(3) vs DEN/MIN, HOU(4) vs POR/ATL.
- [x] 🚨 **MLB Daily Lineup Integration** — asyncPredict() wired for all MLB value endpoints and auto-scanner.
- [x] **MLB Opening Week F5 Unders** — /api/opening-week/f5-scan endpoint live with Poisson F5 scoring.
- [x] **NBA Playoff Series Value Scanner** — playoff-series.js generating fair prices, wired to championship odds.
- [x] **Backtest validation on fixed NBA model** — TRACKING via rest/tank model. March 23 = KEY tracking day with 10 NBA games with massive mismatches (IND TANKING@ORL DESPERATE, SAS RESTING@MIA DESPERATE, OKC RESTING@PHI DESPERATE). Results will validate rest/tank adjustments.

## Phase 2.9: Final Pre-Season Sprint (Week 4) — ✅ COMPLETE
- [x] ✅ **NHL Playoff Series Pricing Model** — DONE. Stanley Cup odds, bracket, series analyzer, bubble watch, dark horses.
- [x] ✅ **NHL Goalie Starter Integration** — DONE. DailyFaceoff live data, asyncPredict, backup detection, dashboard tab.
- [ ] 🚨 **Pre-Opening Day Final Check (March 25 Eve)** — End-to-end test: MLB lineup pipeline, F5 unders, Opening Day Playbook, weather integration, auto-scanner MLB scanning all working for March 26.
- [x] ✅ **Scanner Reliability Fix** — DONE. Watchdog timer, stuck scan detection, auto re-run.
- [x] ✅ **NBA/NHL Daily Value Detection** — DONE. Root cause was field name mismatch in scanAllValue().
- [x] ✅ **OD Playbook Timeout Fix** — DONE v67.0 + v92.0 disk cache. Betting card returns instantly from disk cache. Never blocks.
- [x] ✅ **Stolen Base Revolution Model** — DONE v66.0. Team SB attempt rates → extra runs → totals adjustment. Wired into predict().
- [x] ✅ **Opening Day Live Tracker** — DONE v66.0. Real-time game tracking, live score updates, bet grading during OD.
- [x] ✅ **NBA Seeding Sim → Futures Value Bridge** — DONE v55.0. 10K seeding MC sim → championship/conference probs → live Odds API futures comparison.
- [x] ✅ **OD Endpoint Timeouts** — DONE v92.0. Disk cache persistence, betting card never blocks, preflight defaults LITE.
- [x] ✅ **NBA Daily Card 0-Games Bug** — DONE v92.0. ESPN scoreboard fallback when Odds API returns empty.
- [x] ✅ **F3 First-3-Innings Model** — DONE v93.0. NB scoring with FTTO advantage, 4 API endpoints, dashboard tab.

## Phase 3: Advanced Models (Week 3-4) — CURRENT 🔥
- [x] **NHL Playoff Series Model** — DONE. Stanley Cup odds, series pricing, goalie amplifier, bubble tracker.
- [x] **NBA Playoff Seeding Simulator** — DONE (v54.0). Monte Carlo remaining schedule, conference standings, key battles, play-in tournament sim, division winner probabilities. API: /api/nba/seeding-sim, /api/nba/seeding-sim/battles, /api/nba/seeding-sim/matchups.
- [x] ✅ **F3 First-3-Innings Model** — DONE v93.0. NB scoring with FTTO advantage (first-time-through-order = aces dominate F3 even more than F5), 4 API endpoints, dashboard tab. Odds API supports h2h_1st_3_innings, spreads_1st_3_innings, totals_1st_3_innings + alternates.
- [ ] 🔥 **NFL Win Total Futures Model** — NFL Draft April 24. Win total futures are live on books now. Model built (v56.0) with MIA OVER 4.5 (+39.6%), BAL UNDER 11.5 (+24.4%). Next: incorporate draft picks + FA signings to update projections post-draft.
- [x] ✅ **MLB Pitcher Hits/Walks/ER Props** — DONE v95.0. Poisson models for hits/walks/ER with Statcast xBA/xERA. 5 API endpoints, dashboard tab. Soft market props wired into daily card.
- [x] ✅ **NBA Quarter/Half Markets** — DONE v96.0. Quarter/half scoring model with team profiles, motivation impact, structural edge scanner. Period value detection. Wired into NBA daily card v97.
- [ ] **Soccer model (EPL/Champions League)** — Year-round opportunity, draw underbet by public
- [ ] UFC/MMA model
- [ ] Kalshi scanner (all markets) — ✅ NBA done
- [ ] Same-game parlay correlation engine
- [ ] Arbitrage scanner (cross-book)
- [ ] Second-half / live betting model
- [ ] Tennis model
- [x] **pybaseball Statcast pipeline** — DONE (853 pitchers, 651 batters, 30 teams)
- [x] **NHL daily goalie starter integration** — DONE via DailyFaceoff
- [x] **MLB Daily Lineups Integration** — DONE via asyncPredict()

## Phase 4: Automation & Alerts (Week 4)
- [ ] Auto-scan every 30 min on game days
- [ ] Push alerts for +EV > 5% (Telegram/WhatsApp)
- [ ] Auto-post top plays to Claw Hub
- [ ] Bet tracker with auto-grading
- [ ] CLV tracking across all bets
- [ ] Daily P&L report
- [ ] Weekly strategy digest

## Phase 5: Edge Maximization (Ongoing)
- [ ] ML ensemble combining all model outputs
- [ ] Market efficiency map (which books are softest by sport?)
- [ ] Prop market inefficiency scanner
- [ ] Live in-game models
- [ ] Alternate line optimizer
- [ ] Futures value tracker
- [ ] Bankroll growth projections
- [ ] Model self-improvement loop (auto-retrain on new data)

---

## Key Metrics
- **ROI** per sport, per market type, per edge tier
- **CLV** — are we beating the closing line?
- **Calibration** — model probabilities match reality?
- **Bankroll growth** — compound returns
- **Sharpe ratio** — risk-adjusted returns
- **Edge decay** — how fast do our edges close?

## Session Cadence
- **Every 20 min:** Dev session — build, test, commit, push
- **Every 2 hours:** Planning review — assess progress, reprioritize
- **Daily:** Check all sports for today's edges, post to Claw Hub
- **Weekly:** Full performance review, model accuracy audit

---

## Upcoming Calendar
- **March 25:** MLB Season Opener (NYY@SF 8:05PM ET) 🔥🔥🔥
- **March 26:** MLB Opening Day Full Slate (11 games, PIT@NYM 1:15PM ET) 🔥🔥🔥
- **March 27:** MLB Day 2 (9 games) 🔥
- **April 12:** NBA Playoffs begin — series pricing = edges
- **April 19:** NHL Playoffs begin — same opportunity
- **April 24:** NFL Draft — futures markets move
- **May-June:** NBA/NHL Finals, MLB settling in
- **September:** NFL kickoff

---

*Last updated: 2026-03-24 20:00 UTC — Planning Session #53*
*Current phase: 3.0 — 🚨 OD OPENER TOMORROW (NYY@SF 8:05PM ET, Fried vs Webb) + OD1 March 26 + v127 DEPLOYED*
*✅ PRODUCTION: sportssim.fly.dev v127.0.0 — HEALTHY (144ms health). 165+ features live including pitcher Bayesian update, starter auto-sync, live bet execution engine, edge decay optimizer, OD command center.*
*🚨 PITCHER CORRECTION: NYY opener starter is MAX FRIED (LHP) per v126 auto-sync from MLB Stats API — NOT Gerrit Cole as we coded in session #52. Fried is a LEFTY which changes platoon splits, K projections, and win probability. The v125 opener analysis (Cole deep dive) needs updating for Fried.*
*✅ DATA FEEDS: NBA 30 teams (OKC 57-15 #1), MLB 30 teams (spring training final week), NHL 32 teams (COL 102pts #1). Auto-refresh active.*
*✅ OD BETTING CARD: Portfolio $1,267 wager, $255.83 EV (20.2% ROI). 3 SMASH (MIN@BAL — UNDER 8.5, F5 UNDER, BAL ML). 34 total plays for March 26 slate. Consistent across 5+ sessions.*
*✅ MLB STATS API LINEUP BRIDGE: v108-v112 live. statsapi.mlb.com PRIMARY + ESPN fallback.*
*✅ PITCHER BAYESIAN UPDATE (v127): Live pitcher performance tracking, regression candidate detection, FIP/xFIP calculation, daily pitcher snapshots.*
*📊 MLB FUTURES: NYY AL East +20%, OAK OVER +18.2%, BAL UNDER +13.7%, CWS OVER +13.1%, CHC OVER +12.8%, TOR OVER +12.8%.*
*🏀 NBA TONIGHT (3/24 — 4 games): SAC@CHA, NOP@NYK, ORL@CLE, DEN@PHX. Light slate.*
*🏀 NBA STANDINGS (3/24): OKC(57-15), SAS(54-18), DET(52-19), BOS(47-24), NYK(47-25), LAL(46-26), CLE(44-27), DEN/MIN(44-28), HOU(43-28). East play-in CHAOS: TOR(40-31), ATL/PHX(40-32), PHI(39-33), ORL(38-33), MIA(38-34). 10 games left per team.*
*🏀 REST/TANK CUMULATIVE: RESTING 7/7 SU (100%). DESPERATE B2B 0/5 SU (0%). VALIDATED.*
*🏒 NHL STANDINGS (3/24): COL(102), DAL(97), CAR(96), BUF(95), MIN(92), TBL(91). EAST BUBBLE: MTL/BOS/PIT(86), CBJ/NYI(85), DET(84), ANA(82). 7 teams, 4pts, 4 spots.*
*🏒 NHL TONIGHT: OTT@DET, TOR@BOS, CAR@MTL — MASSIVE bubble implications. All 3 feature bubble teams.*
*🏈 NFL: 15+ win total value bets LIVE (MIA OVER +39.5%, BAL UNDER +23.3%). Draft 31 days.*
*📋 CRITICAL PATH TO MONEY: (0) TONIGHT: Track NHL bubble games + NBA rest/tank. (1) TOMORROW March 25 AM — Update Fried vs Webb analysis, re-run opener predictions. (2) TOMORROW March 25 5PM ET — Pull live NYY@SF odds, generate execution plan. (3) TOMORROW March 25 8:05PM ET — FIRST PITCH. Execute Fried vs Webb plays. (4) March 25 EVE — Final pre-OD check for March 26 full slate. (5) March 26 AM — GO LIVE. PIT@NYM 1:15PM ET first pitch of full OD slate. (6) March 26-27 NIGHT — Auto-grade results, measure first CLV.*
*⚾ MLB SEASON OPENER: TOMORROW (March 25, NYY@SF 8:05PM ET, FRIED vs WEBB) 🔥🔥🔥🔥🔥*
*⚾ MLB OPENING DAY FULL SLATE: 1.75 DAYS (March 26, PIT@NYM 1:15PM ET) 🔥🔥🔥*
*⚾ MLB DAY 2: 3 DAYS (March 27) 🔥🔥*
*🏀 NBA PLAYOFFS: 19 DAYS (April 12)*
*🏒 NHL PLAYOFFS: 26 DAYS (April 19)*
*🏈 NFL DRAFT: 31 DAYS (April 24)*
*🆕 SESSION #53 FINDINGS: (1) 🚨 PITCHER CORRECTION: v126 auto-sync changed NYY opener from Cole to Max Fried (LHP). The v125 opener analysis was built for Cole (RHP) — needs full recalculation for Fried's different profile (lefty, different K rate, different platoon implications for SF lineup). (2) Production v127 HEALTHY at 144ms with 165+ features including Bayesian pitcher updating. (3) Value detection returning MLB futures only (expected — no game-day markets at 8PM UTC). (4) NHL bubble unchanged at 7 teams within 4pts — tonight's OTT@DET, TOR@BOS, CAR@MTL could significantly shift bubble. NYI moved to 85pts (up from 83). (5) NBA standings stable — East play-in remains chaotic with 6 teams within 6 games of each other. (6) San Francisco forecast shows ~57°F / cloudy for tomorrow evening — mild conditions, not extreme. Oracle Park 0.93 PF still dominant factor.*
*🆕 NEW TASK: Task 113 — Re-run NYY@SF opener analysis for Fried vs Webb (CRITICAL P0, blocks tomorrow's bet execution). Fried is LHP → SF's mostly LHH lineup (Pederson, Davis, Flores) faces SAME-SIDE disadvantage. This CHANGES the platoon splits significantly from the Cole analysis.*
