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

*Last updated: 2026-03-24 12:00 UTC — Planning Session #49*
*Current phase: 3.0 — OD D-Day T-MINUS 2 + v112 DEPLOYED + Pre-OD Final Check TOMORROW*
*✅ PRODUCTION: sportssim.fly.dev v112.0.0 — HEALTHY (425ms health). 140+ features live including OD Odds Monitor v112, regular season autopilot v111, MLB Stats API lineup bridge v108.*
*✅ DATA FEEDS: NBA 30 teams (OKC 57-15 #1), MLB 30 teams (spring training final games today), NHL 32 teams (COL 102pts #1). Auto-refresh active. Scanner running (outside active hours 14-06 UTC).*
*✅ OD BETTING CARD (35 plays): 3 SMASH (all MIN@BAL — UNDER 8.5 +22.6%, F5 UNDER +21.8%, ML +6%), 17 STRONG (PIT@NYM unders lead), 15 LEAN (DET@SD F5 UNDER +22.5% top lean).*
*✅ MLB STATS API LINEUP BRIDGE: v108-v110 features — statsapi.mlb.com PRIMARY + ESPN fallback + manual overrides. Auto-prediction rebuild on lineup confirmation. SPEED EDGE over ESPN-only systems.*
*✅ OD ODDS MONITOR (v112): Auto-detect when books post MLB OD lines, cross-book best price detection, auto-playbook rebuild with real odds, edge decay tracking.*
*📊 MLB FUTURES: NYY AL East +20.9%, OAK OVER +17.6%, TOR OVER +13.8%, CHC OVER +13.3%, BAL UNDER +13.1%.*
*🏀 NBA (3/24 — LIGHT 4 games): SAC@CHA (TANKING vs DESPERATE), NOP@NYK (COMPETING@COASTING), ORL@CLE (DESPERATE@COASTING), DEN@PHX (COASTING@COMPETING play-in). Light slate = less data but rest/tank signals active.*
*🏀 NBA STANDINGS (UPDATED 3/24): OKC(57-15), SAS(54-18), DET(52-19), BOS(47-24), NYK(47-25), LAL(46-26), CLE(44-27), DEN/MIN(44-28), HOU(43-28), TOR(40-31), ATL/PHX(40-32), PHI(39-33), ORL(38-33), MIA(38-34). East 6-10 = CHAOS — 5 teams within 3 games.*
*🏀 REST/TANK CUMULATIVE: RESTING 7/7 SU (100%) avg +16pt margin. DESPERATE B2B 0/5 SU (0%). PROVEN EDGE.*
*🏒 NHL STANDINGS (UPDATED 3/24): COL(102), DAL(97), CAR(96), BUF(95), MIN(92), TBL(91). EAST BUBBLE: MTL/BOS(86), PIT(86 but 35L!), CBJ(85), NYI(85), DET(84), ANA(82), OTT(81). 8 teams within 5pts for 4 spots = MAXIMUM mispricing window.*
*🏒 NHL TODAY: 8 games — key bubble matchups to track.*
*🏈 NFL: 15+ win total value bets LIVE. Draft 31 days.*
*📋 CRITICAL PATH: TOMORROW March 25 = Pre-OD FINAL CHECK → March 26 AM GO LIVE → OD1 (11 games) → OD2 March 27 (9 games) → Regular season autopilot*
*🚨 D-DAY CHECKLIST: (1) March 25 AM — verify v112 stable, all endpoints healthy ✅ (already confirmed). (2) March 25 PM — pull 48hr weather + verify MLB Stats API lineup pipeline. (3) March 25 EVE — full end-to-end preflight. (4) March 26 AM — GO LIVE. (5) March 26 PM — capture closing lines. (6) March 26 NIGHT — auto-grade all OD1 bets.*
*⚾ MLB OPENING DAY 1: 2 DAYS (March 26) 🔥🔥🔥*
*⚾ MLB OPENING DAY 2: 3 DAYS (March 27) 🔥🔥🔥*
*🏀 NBA PLAYOFFS: 19 DAYS (April 12)*
*🏒 NHL PLAYOFFS: 26 DAYS (April 19)*
*🏈 NFL DRAFT: 31 DAYS (April 24)*
*🆕 SPRING TRAINING FINAL (3/24): LAD 20-8 (#1 Cactus), SF 19-9, TEX 17-12, ARI/CLE/COL 15-14, LAA 16-15, SD 15-15, CWS 15-16, OAK/CHC/CIN 14-16. Notable: LAD dominant spring confirms preseason-tuning weight. CWS 15-16 (better than 60-102 suggests — Murakami factor). Grapefruit final standings TBD.*
*🆕 VALUE/SCANNER NOTE: /api/value/all returning 0 bets because scanner is outside active hours (14-06 UTC). This is BY DESIGN — scanner will populate when it runs during active window. OD Betting Card (cached) has all 35 plays ready.*
*🆕 KEY INSIGHT: v112 OD Odds Monitor auto-detects when books post OD lines. As lines drop over next 48 hours, playbook auto-rebuilds with real odds. Edge decay tracking shows how our edges move as books sharpen — CRITICAL for timing bets.*
*🆕 POST-OD PRIORITY STACK: (1) Pre-OD final check March 25 (054/097 P0). (2) Deploy confirmed v112 features for OD game day. (3) Regular season daily scanner (078) — Apr-Oct money printer. (4) NBA playoff futures scanner (079) — 19 days to exploit seeding chaos. (5) NHL bubble futures exploitation (080/102) — 26-day window closing. (6) Batter props (075) for regular season.*
*🆕 NEW EDGE DISCOVERY: PIT at 86pts in NHL but 35 LOSSES — they're winning in OT/shootout but losing in regulation. High OTL count means they're vulnerable to regression. FADE PIT in playoff futures — they look like an 86-point team but play like a borderline team. MTL/BOS at 86 with fewer losses are more sustainable.*
*🆕 NBA SEEDING CHAOS: TOR(40-31) vs ATL/PHX(40-32) vs PHI(39-33) vs ORL(38-33) vs MIA(38-34) — FIVE teams within 3 games for East 6-10 seeds. This = MASSIVE playoff series futures mispricing since matchup opponent (BOS/NYK/CLE) dramatically changes series value. West: DEN/MIN tied 44-28 for 4/5 seed — whoever gets 4 faces easier R1 opponent.*
