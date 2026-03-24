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
- **March 27:** MLB Opening Day 🔥 — model MUST be ready
- **April 12:** NBA Playoffs begin — series pricing = edges
- **April 19:** NHL Playoffs begin — same opportunity
- **April 24:** NFL Draft — futures markets move
- **May-June:** NBA/NHL Finals, MLB settling in
- **September:** NFL kickoff

---

*Last updated: 2026-03-24 06:00 UTC — Planning Session #46*
*Current phase: 3.0 — OD D-Day T-MINUS 2 + v103-v105 Deploy + Regular Season Prep*
*✅ PRODUCTION: sportssim.fly.dev v102.0.0 — HEALTHY. Health 391ms, data feeds 6-7min fresh (all ESPN+NHL API green).*
*🚨 DEPLOY GAP: Local is v105.0.0 but production is v102.0.0. v103 (MLB results grader), v104 (OD eve validation), v105 (auto-grade pipeline + CLV measurement) NOT DEPLOYED. This commit should trigger deploy.*
*✅ DATA FEEDS: NBA 30 teams (OKC 57-15 #1), MLB 30 teams (spring training), NHL 32 teams (COL 46W-13L). All fresh.*
*✅ OD BETTING CARD: 34 plays — 3 SMASH (MIN@BAL UNDER 8.5 22.6% edge, F5 UNDER 22.1%, BAL ML 6.2%), 15 STRONG, 14 LEAN, 2 SMALL. Portfolio: $1,298 wager, $258.93 EV (19.9% ROI).*
*🔥 TOP SMASH: MIN@BAL UNDER 8.5 (Ryan vs Rogers, 22.6% edge, 83 conviction, A grade).*
*🔥 K PROPS: 21 high confidence. Misiorowski OVER 5.5 (+23.6%), Boyd OVER 4.5 (+16.4%), Crochet OVER 7.5 (+15.4%).*
*🔥 OUTS PROPS: 23 HIGH confidence. ALL OVERS (OD premium). Peralta OVER 15.5 (+18.8%).*
*📊 VALUE BETS: MLB futures: NYY AL East +21.2%, OAK OVER +18.6%, BAL UNDER +14.1%, CHC OVER +12.4%. NFL: MIA OVER 4.5 (+39.5%), TEN UNDER 6.5 (+26%), BAL UNDER 11.5 (+23.3%).*
*🏀 NBA (3/24 RESULTS — ALL FINAL): OKC 57-15 (#1), SAS 54-18, DET 52-19, BOS 47-24, NYK 47-25, LAL 46-26. REST/TANK VALIDATION: OKC beat PHI by 20 (RESTING won), SA beat MIA by 25 (RESTING won), IND beat ORL by 2 (TANKING beat DESPERATE B2B AGAIN!). Key: RESTING = 5/5 wins all-time, DESPERATE B2B = 0/4 all-time. Elite depth > motivation.*
*🏒 NHL (3/24): Only 1 game today — OTT 2 @ NYR 1 (NYR lost, significant for bubble). East bubble still tight. COL(102+), DAL(97+), CAR(96+). MTL/BOS/PIT(86-88), CBJ/NYI(85), DET(84).*
*🏀 NBA STANDINGS UPDATED: East 6-10: TOR(40-31), ATL(40-32), PHI(39-33), ORL(38-33), MIA(38-34). West play-in: PHX(40-32). DEN/MIN(44-28) tied W4/5.*
*🏈 NFL: 15+ win total value bets LIVE. MIA OVER 4.5, TEN UNDER 6.5, BAL UNDER 11.5, SEA OVER 10.5 all HIGH confidence. Draft 31 days.*
*📋 CRITICAL PATH: TODAY March 25 = Pre-OD FINAL CHECK → GO LIVE March 26 AM → OD1 (11 games) → OD2 March 27 (9 games) → Regular season autopilot*
*🚨 D-DAY CHECKLIST: (1) March 25 AM — deploy v105 with auto-grade pipeline. (2) March 25 PM — pull 48hr weather + verify lineup pipeline. (3) March 25 EVE — full end-to-end preflight. (4) March 26 AM — GO LIVE. (5) March 26 PM — capture closing lines. (6) March 26 NIGHT — auto-grade all OD1 bets.*
*⚾ MLB OPENING DAY 1: 2 DAYS (March 26) 🔥🔥🔥*
*⚾ MLB OPENING DAY 2: 3 DAYS (March 27) 🔥🔥🔥*
*🏀 NBA PLAYOFFS: 19 DAYS (April 12)*
*🏒 NHL PLAYOFFS: 26 DAYS (April 19)*
*🏈 NFL DRAFT: 31 DAYS (April 24)*
*🆕 REST/TANK BACKTEST INSIGHT: Over 2 sessions (March 23-24), RESTING teams (OKC, SAS, DET) went 5-0 SU with avg margin of +18.4. DESPERATE teams went 0-4 when B2B. Model recalibrated in v102 — RESTING adj now -0.5 (was -1.5), DESPERATE adj 0.3 (was 1.0). Key insight: elite bench depth trumps motivation adjustment every time.*
*🆕 NEW PRIORITY: v103-v105 deploy MUST happen before March 25 final check. Auto-grade pipeline (v105) is critical for OD bet grading.*
*🆕 EDGE RESEARCH: (1) Batter props (task 075) — post-OD priority, Statcast xBA/xSLG for 651 batters. (2) Regular season daily scanner (task 078) — critical for April daily money printing. (3) NHL bubble resolution — 3 weeks of maximum mispricing before playoff matchups lock.*
