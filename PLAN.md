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
- [ ] **Backtest validation on fixed NBA model** — verify rest/tank adjustments improve ATS record (tracking today's 5 games)

## Phase 2.9: Final Pre-Season Sprint (Week 4) — CURRENT 🔥
- [ ] 🚨 **NHL Playoff Series Pricing Model** — NHL playoffs 28 days away (April 19). Build NHL series pricing similar to NBA playoff-series.js. COL(1)/DAL(2)/CAR(3)/BUF(4) are top seeds. Massive East bubble: PIT/MTL/BOS/DET all at 84pts = volatile matchup projections = early pricing edge.
- [ ] 🚨 **NHL Goalie Starter Integration** — Goalie matchups swing NHL lines 5-15 cents. Need daily goalie confirmation scraper (DailyFaceoff style). Wire into NHL predict() for game-day edge.
- [ ] 🚨 **Pre-Opening Day Final Check (March 26)** — End-to-end test: MLB lineup pipeline, F5 unders, Opening Day Playbook, weather integration, auto-scanner MLB scanning all working for March 27.
- [ ] **Scanner Reliability Fix** — Auto-scanner shows scans 1.2h+ overdue despite isRunning=true. May need watchdog/auto-restart mechanism.
- [ ] **NBA/NHL Daily Value Detection** — 0 value bets found today despite 5 NBA + 8 NHL games. Investigate: odds API pull timing? Threshold too strict? Model gaps?

## Phase 3: Advanced Models (Week 3-4)
- [ ] **NHL Playoff Series Model** — Build series pricing + fair prices. COL/DAL/CAR/BUF top seeds. Goalie matchups critical for series pricing.
- [ ] **NBA Playoff Seeding Simulator** — Monte Carlo remaining schedule to project final seedings + matchup probabilities. Current: OKC(1)/SAS(2)/LAL(3)/HOU(4) vs DEN(5)/MIN(6)/TOR(7)/PHX(8) in West. DET(1)/BOS(2)/NYK(3)/CLE(4) vs ATL(5)/PHI(6)/ORL(7)/CHA(8) in East. ~11 games left = some flux.
- [ ] NFL off-season: win total futures model (NFL Draft April 24 — futures markets move)
- [ ] Soccer model (EPL/Champions League)
- [ ] UFC/MMA model
- [ ] Kalshi scanner (all markets) — ✅ NBA done
- [ ] Same-game parlay correlation engine
- [ ] Arbitrage scanner (cross-book)
- [ ] Second-half / live betting model
- [ ] Tennis model
- [ ] **pybaseball Statcast pipeline** — advanced pitcher/batter metrics (✅ DONE — xERA/xwOBA for 853 pitchers)
- [ ] **NHL daily goalie starter integration** — confirmed starters swing lines 5-15 cents
- [ ] **MLB Daily Lineups Integration** — ✅ DONE via asyncPredict()

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

*Last updated: 2026-03-22 14:00 UTC*
*Current phase: 2.9 — Final Pre-Season Sprint*
*✅ Phase 2.5 COMPLETE: All calibration tasks done, rest/tank model live, base data validated*
*✅ Phase 2.75 COMPLETE: NBA playoff preview, MLB lineup pipeline, F5 unders — all live*
*🔧 NEXT: NHL playoff series model, NHL goalie starters, Opening Day final check, scanner reliability*
*⚡ TODAY: 5 NBA games (POR@DEN, BKN@SAC, WAS@NYK, MIN@BOS, TOR@PHX) + 8 NHL games (CAR@PIT, VGK@DAL, LAK@UTA, TBL@CGY + more)*
*📊 PRODUCTION: Live at sportssim.fly.dev, scanner running (some scans overdue), 8+ MLB futures value bets, 0 daily NBA/NHL value (investigating)*
*🏒 NHL STANDINGS: COL 100pts, DAL 96pts, CAR 94pts, BUF 92pts — bubble is WILD (PIT/MTL/BOS/DET all 84pts)*
*🏀 NBA STANDINGS: OKC 56-15, SAS 53-18, DET 51-19, BOS 47-23, LAL 46-25, NYK 46-25*
*MLB OPENING DAY: 5 DAYS (March 27)*
*NBA PLAYOFFS: 21 DAYS (April 12)*
*NHL PLAYOFFS: 28 DAYS (April 19)*
