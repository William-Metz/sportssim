# SportsSim — Master Plan 🦞

## Mission
Build the ultimate +EV sports betting platform across ALL sports, ALL markets. Find every edge. Make maximum money.

## Platform Status: MASSIVE 🚀
- **114 service modules** | **85,000+ lines of code** | **11,800-line server.js**
- Live data from ESPN, NHL API, MLB Statcast
- Multi-sport models: NBA, MLB, NHL, NCAA
- Deployed to sportssim.fly.dev
- GitHub: William-Metz/sportssim

---

## Sports Coverage (Priority Order)

### ⚾ MLB (OPENING DAY MARCH 27 — 6 DAYS! 🔥🔥🔥)
**Status: BATTLE-READY**
- 162-game season = massive sample size = model heaven
- Built: Pitcher model (150+ pitchers), park factors (30 parks), Poisson totals, NRFI, F3/F7 inning models
- Built: Batter props, platoon splits, bullpen quality, catcher framing, stolen base model
- Built: Umpire tendencies, weather integration, Statcast integration
- Built: Opening Day command center (20+ od-* services), lineup pipeline, pitcher resolver
- Built: Opening week unders model, Opening Day live execution system
- Focus: ML, totals, F5, run line (+/-1.5), player props, NRFI
- **EDGE: Opening Day is historically the best day for models — max uncertainty in market**

### 🏀 NBA (Regular season ending, PLAYOFFS APRIL 12)
**Status: PRODUCTION**
- Built: Power ratings (Pythagorean + luck + rolling), period markets, rest/tank model
- Built: Playoff series scanner, seeding simulator, rest-tank grader + backtest
- Built: Daily NBA card generator, historical games database
- **Current standings** (from live data): OKC #1 (62-16), SAS #2 (60-19), DEN #3 (51-28)
- East: DET #1 (57-22), BOS #2 (53-25), NYK #3 (51-28), CLE #4 (50-29)
- KEY INJURIES: Lakers missing Luka Doncic + Austin Reaves
- **EDGE: Playoff series pricing historically inefficient. Unders in low-total first-round games hit 56.4% (totals ≤218)**

### 🏒 NHL (Regular season ending, PLAYOFFS APRIL 19)
**Status: PRODUCTION**
- Built: Pythagorean + goalie adjustments, bubble scanner, goalie starters
- Built: Playoff series model, daily NHL card generator
- Focus: Puck line (+/-1.5), totals, goalie starter edges
- **EDGE: Goalie backup starts massively swing lines — our goalie model catches these**

### 🏈 NFL (Off-season — prep for September)
**Status: BACKLOG**
- NFL Draft April 24 — futures markets will move
- Need: Win totals futures model, draft impact model
- Season starts September — plenty of time to build

### 🏀 NCAA (March Madness)
**Status: BUILT**
- Built: Bracket engine, live scoring, tournament scanner
- Useful for future March Madness and conference tournaments

### 📊 Prediction Markets
**Status: BUILT**
- Built: Kalshi scanner, Polymarket scanner + value detection
- Built: Team totals scanner
- **EDGE: Wide bid-ask spreads = edge for patient players**

---

## Architecture

### Core Engine
1. **Universal Model Framework** — Sport-agnostic rating system + sport-specific features ✅
2. **Odds Aggregator** — Real-time from The Odds API (50+ books) ✅
3. **Value Engine** — Model vs. book, edge calculation, confidence scoring ✅
4. **Bankroll Optimizer** — Kelly Criterion, portfolio-level risk management ✅
5. **Backtest Suite** — Historical validation per sport per market ✅
6. **Dashboard** — Multi-sport, real-time, deployed ✅
7. **Alert System** — Daily cards, morning briefings, auto-scanner ✅
8. **Line Movement Tracker** — Steam moves, RLM, stale lines ✅
9. **Arbitrage Scanner** — Cross-book edge detection ✅
10. **SGP Engine** — Same-game parlay correlation ✅
11. **Season Simulator** — Full Monte Carlo season projection ✅
12. **Auto-Grade Pipeline** — Results grading + CLV tracking ✅

### Model Stack (114 Services)

**Core Models:**
- Pythagorean ratings (NBA, MLB, NHL)
- Poisson/Negative Binomial totals
- Monte Carlo game simulation
- Kelly Criterion portfolio optimization
- Consensus engine (multi-model weighting)
- Calibration service

**MLB Specific (30+ services):**
- Starting pitcher model (150+ pitchers, composite ratings)
- Park factors (30 parks)
- Batter props (hits, HRs, RBIs)
- Pitcher K props, HWE props, outs props
- Platoon splits (L/R matchups)
- Bullpen quality ratings
- Catcher framing impact
- Stolen base model
- Umpire tendencies
- NRFI (No Run First Inning)
- F3 model (First 3 innings)
- F7 model (First 7 innings)
- Weather integration (wind, temp, humidity)
- Statcast integration
- Negative binomial scoring model
- Opening Day command center (20+ od-* services)

**NBA Specific (10+ services):**
- Period markets (quarters/halves)
- Playoff series scanner
- Seeding simulator + futures bridge
- Rest/tank model + grader + backtest
- Historical games database

**NHL Specific (5+ services):**
- Bubble scanner (playoff bubble teams)
- Goalie starters tracker
- Playoff series model

**Cross-Sport:**
- Auto-scanner (every 30 min)
- Daily picks generator
- Morning briefing
- Line movement tracker
- Line shopping (best price across books)
- Arbitrage scanner
- SGP engine (same-game parlays)
- Futures scanner
- Alt-lines optimizer
- Bet tracker + auto-grade pipeline
- CLV tracker
- ML bridge (machine learning integration)
- Lineup fetcher + monitor + bridge
- Season simulator
- Regular season autopilot
- Gameday autopilot + orchestrator

**Prediction Markets:**
- Kalshi scanner
- Polymarket + Polymarket value detector
- Team totals scanner

### Tech Stack
- **Frontend:** Professional dashboard (dark theme, real-time updates)
- **Backend:** Node.js/Express API (11,800-line server.js)
- **Services:** 114 modules (85,000+ lines)
- **Database:** SQLite with JSON caches
- **Odds:** The Odds API (50+ books)
- **Stats:** ESPN API, MLB Statcast, NHL API, NCAA
- **Hosting:** Fly.io at sportssim.fly.dev
- **Repo:** github.com/William-Metz/sportssim
- **CI/CD:** GitHub Actions, auto-deploy
- **Monitoring:** Grafana dashboard, Healthchecks.io

---

## Phase Status

### Phase 1: Foundation ✅ COMPLETE
- [x] Project structure + Express backend
- [x] NBA power rating model
- [x] MLB power rating model  
- [x] NHL power rating model
- [x] The Odds API integration (all sports)
- [x] Value detection engine (universal)
- [x] Dashboard MVP (multi-sport)
- [x] Deploy to Fly.io
- [x] Live data feeds (ESPN, NHL API)

### Phase 2: Depth ✅ MOSTLY COMPLETE
- [x] Rolling stats for all sports
- [x] Injury scraping (all leagues)
- [x] Totals model (Poisson + Neg Binomial)
- [x] Player props framework (multiple sports)
- [x] Kelly Criterion multi-sport portfolio optimizer
- [x] Line movement tracking + sharp money detection
- [x] MLB: starting pitcher impact model
- [x] MLB: park factor adjustments
- [x] MLB: weather integration
- [ ] Historical closing line database (partial — CLV tracker built)

### Phase 3: Advanced Models ✅ MOSTLY COMPLETE
- [x] NCAA bracket engine + tournament scanner
- [x] Kalshi scanner
- [x] Same-game parlay correlation engine (SGP)
- [x] Arbitrage scanner (cross-book)
- [x] Polymarket scanner + value detection
- [x] Season simulator (Monte Carlo)
- [x] NBA playoff series model
- [x] NHL playoff series model
- [ ] NFL model (off-season, September target)
- [ ] Soccer model (EPL/Champions League)
- [ ] UFC/MMA model
- [ ] Tennis model

### Phase 4: Automation & Alerts ✅ MOSTLY COMPLETE
- [x] Auto-scan on game days (auto-scanner)
- [x] Daily card generators (NBA, MLB, NHL)
- [x] Morning briefing system
- [x] Bet tracker + auto-grading
- [x] CLV tracking
- [x] Gameday autopilot + orchestrator
- [x] Regular season autopilot
- [ ] Push alerts to Telegram/WhatsApp (service exists, needs integration)
- [ ] Daily P&L automated report
- [ ] Weekly strategy digest

### Phase 5: Edge Maximization 🔄 IN PROGRESS
- [x] ML bridge (model integration)
- [x] Line shopping across books
- [x] Alt-line optimizer
- [x] Futures value tracker
- [x] Consensus engine (multi-model weighting)
- [x] Calibration service
- [ ] Full ML ensemble training
- [ ] Market efficiency map (which books are softest by sport?)
- [ ] Live in-game models
- [ ] Bankroll growth projections dashboard
- [ ] Model self-improvement loop (auto-retrain)

---

## Upcoming Calendar & Strategy

### 🔥 MARCH 27: MLB Opening Day (6 DAYS)
- Opening Day command center is READY (20+ od-* services)
- Gameday pipeline: pitcher sync → lineup verify → live odds → execution
- Pre-game validation chain: preflight → eve validation → morning protocol → live
- Best edge day of the MLB season — max market uncertainty
- **Action items:** Final validation pass, verify all pitcher data current, test full pipeline end-to-end

### 🏀 APRIL 12: NBA Playoffs Begin
- Playoff series scanner ready
- **Key insight (VSiN):** Unders in first-round games with totals ≤218 hit at 56.4%
- **Key insight:** Series pricing historically inefficient — model vs. market series prices
- Rest/tank patterns will shift — everyone plays now
- Lakers injury situation (Luka/Reaves) creates massive value opportunities

### 🏒 APRIL 19: NHL Playoffs Begin
- Playoff series model ready
- Bubble scanner tracking teams on the edge
- Goalie starter tracking critical — backup vs starter swings are the #1 edge

### 🏈 APRIL 24: NFL Draft
- Futures markets (win totals, division odds) will move heavily
- Build futures impact model before draft

### MAY-JUNE: NBA/NHL Finals + MLB Regular Season
- MLBautopilot should be fully autonomous by then
- Playoff models in production

### SEPTEMBER: NFL Kickoff
- Full NFL model needed by August
- Rest/travel/weather models translate from other sports

---

## Key Metrics to Track
- **ROI** per sport, per market type, per edge tier
- **CLV** — are we beating the closing line?
- **Calibration** — model probabilities match reality?
- **Bankroll growth** — compound returns
- **Edge decay** — how fast do our edges close?
- **Service uptime** — all 114 services operational?
- **Data freshness** — live feeds updating?

## Research Findings (March 21, 2026)

### NBA Playoff Betting Edges
- **Under trend:** First-round games with totals ≤218, Under is 84-65-5 (56.4%)
- **Over trend:** Games with totals >218, Over is 76-66-2 (53.5%)
- **Series pricing:** Historically inefficient — favorites often overpriced
- **Play-in games:** High variance, public overreacts to seeding
- **Injury impact:** Lakers without Luka/Reaves creates massive series pricing edge

### MLB Opening Day Edges
- Maximum market uncertainty = maximum model edge
- Starting pitcher confirmation is the #1 variable (our pitcher resolver handles this)
- Weather on Opening Day matters more than usual (cold weather parks, wind)
- NRFI is historically profitable on Opening Day (pitchers sharp, hitters rusty)
- Opening week unders model shows early-season scoring is suppressed

### New Data Sources to Explore
- **OddsJam:** Arbitrage finder with real-time price comparison (7-day free trial)
- **Sportradar:** Comprehensive real-time data (expensive but powerful)
- **oddsapiR (GitHub):** R package for odds data, could bridge to our ML pipeline
- **Opta AI:** MLB props (free trial available per VSiN)

---

*Last updated: 2026-03-21*
*Current phase: 4-5 (Automation + Edge Maximization)*
*URGENT: MLB Opening Day in 6 days*
*NEXT: NBA Playoffs in 22 days*
