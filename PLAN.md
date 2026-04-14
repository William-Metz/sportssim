# SportsSim — Master Plan 🦞

## Mission
Build the ultimate +EV sports betting platform across ALL sports, ALL markets. Find every edge. Make maximum money.

## Current Status (April 14, 2026)
- **Version:** v128 (128 feature releases in 26 days)
- **Commits:** 146+ since project start
- **Production:** ✅ LIVE at sportssim.fly.dev (512MB VM, healthy)
- **Services:** 40+ live services (models, scrapers, scanners, dashboards)
- **Live Data:** ESPN (NBA/MLB), NHL API, Statcast, DailyFaceoff, Open-Meteo, Odds API
- **Phase:** 3.5 — Advanced Models + Automation

---

## 🔥 CRITICAL CALENDAR — What's Happening NOW

### TODAY — April 14, 2026
- **NBA Play-In Tournament STARTS TODAY** 🏀
  - West 7v8: PHX Suns (-3.5) vs POR Trail Blazers (+130) — 10pm ET
  - West 9v10: LAC Clippers vs GSW Warriors — 10pm ET
  - East 7v8: ORL Magic (-1.5) vs PHI 76ers (+102) — **Tomorrow** (Apr 15)
  - East 9v10: CHA Hornets vs MIA Heat — **Tomorrow** (Apr 15)
- **MLB Regular Season** — ~2.5 weeks in, daily games
- **NHL Regular Season** — Final week, playoffs April 19

### This Week
- **Apr 14-17:** NBA Play-In Tournament (6 games)
- **Apr 18:** NBA Playoffs Round 1 begins
- **Apr 19:** NHL Playoffs Round 1 begins
- **Apr 24:** NFL Draft

### Upcoming
- **May-June:** NBA/NHL Conference Finals → Finals
- **Late June:** MLB All-Star break approaching
- **September:** NFL kickoff

---

## Sports Coverage (Priority Order for April 2026)

### 🏀 NBA (PLAY-IN TODAY → PLAYOFFS SATURDAY)
**STATUS: Model LIVE, scanner LIVE, predictions LIVE**
- Play-In games are historically UNDERPRICED for upsets
- Playoff series pricing = biggest inefficiency in NBA betting
- Key edges: rest days matter less (both teams resting), home court worth 2-3pts
- Our model: 71% ML accuracy, Totals +27.3% ROI (backtest)
- ATS still needs work (-3.8% ROI) — spreads are sharper
- Futures bridge model: seeding sim → championship odds → market comparison
- **TONIGHT'S PLAY:** PHX vs POR — Suns favored but Blazers 14-10 since Feb 22
- **KEY INSIGHT from research:** Fade Game 1 overreactions, watch line movement for sharp money, unders profitable in playoffs (pace slows), bench depth shrinks

### ⚾ MLB (SEASON UNDERWAY — 2.5 WEEKS IN)
**STATUS: Full model suite LIVE — pitcher matchups, Statcast, weather, park factors, platoons, framing**
- Model backtest: 71% ML accuracy, 30.2% ROI, 42.3% ROI on 10%+ edges
- 167 pitchers in database, 853 Statcast pitchers, 651 batters
- Opening Day analysis deployed and executed (Fried vs Webb opener)
- Live auto-grading pipeline running
- Futures active: NYY AL East +21.3%, OAK OVER +18.7%, BAL UNDER +14.2%
- **NOW NEEDED:** Early season regression detection — which teams are over/under-performing Pythagorean expectations? Small sample = big edges

### 🏒 NHL (PLAYOFFS START APRIL 19 — 5 DAYS)
**STATUS: Model LIVE with goalie starters, playoff dashboard built**
- Colorado Avalanche 52-16 (dominant, #1 seed)
- Goalie starter auto-detection via DailyFaceoff
- Playoff series model + bubble watch dashboard built
- **CRITICAL GAP:** NHL backtest still shows 0 games — need validation data
- **EDGE:** Playoff underdogs historically profitable in NHL (parity sport)

### 🏈 NFL (DRAFT APRIL 24 — 10 DAYS)
**STATUS: Win totals futures model LIVE**
- 32 teams modeled, 30 value bets found
- MIA OVER 4.5 (+39.6% edge), BAL UNDER 11.5 (+24.4%), SEA OVER 10.5 (+22.7%)
- Draft will move lines significantly — early mover advantage NOW
- **NEEDED:** Post-draft adjustments module (picks affect win totals)

### 📊 Prediction Markets
**STATUS: Kalshi scanner LIVE, Polymarket bridge LIVE**
- 119 Kalshi value bets identified, 90 high confidence
- Kalshi expanding into football props/sides/totals (CFTC filing)
- **EDGE:** Wide bid-ask spreads on Kalshi = patient player advantage

### ⚽ Soccer / 🥊 UFC / 🎾 Tennis
**STATUS: Not yet built — backlog**

---

## Architecture (BUILT)

### Core Engine ✅
1. **Universal Model Framework** — Sport-agnostic Pythagorean rating + sport-specific features
2. **Odds Aggregator** — Real-time from DraftKings, FanDuel, BetMGM, Caesars, Pinnacle via The Odds API
3. **Value Engine** — Model vs. book comparison, edge calculation, conviction scoring (0-100)
4. **Bankroll Optimizer** — Kelly Criterion with same-game correlation, full/half/quarter sizing
5. **Backtest Suite** — NBA 176 games, MLB 200 games (NHL needs expansion)
6. **Dashboard** — Multi-sport with 20+ tabs (dark theme, real-time)
7. **Alert System** — Auto-scanner with watchdog, value detection pipeline
8. **Live Data Service** — ESPN + NHL API + Statcast + DailyFaceoff + Open-Meteo

### Model Features (ALL BUILT)
- Pythagorean power ratings (all sports)
- Rolling L10 stats from live APIs
- Injury impact adjustments (star player ratings)
- Rest/tank/motivation model (NBA)
- Starting pitcher matchups + Statcast xERA/xwOBA (MLB)
- Park factors, weather, umpire tendencies (MLB)
- Platoon splits (Savant L/R wOBA data) (MLB)
- Catcher framing (58 Savant catchers) (MLB)
- Stolen base revolution model (MLB)
- Goalie starter detection + backup impact (NHL)
- Negative binomial scoring distributions (MLB F5, run lines)
- Opening week unders adjustment (MLB)
- Season simulator (10K Monte Carlo, win totals futures)
- Seeding simulator → futures bridge (NBA)
- Playoff series pricing model (NHL)
- Edge decay optimizer (bet timing)
- Live bet execution engine
- CLV tracking + auto-grading
- Conviction scoring engine (0-100, A+ to F grades)

### Tech Stack
- **Frontend:** Professional dashboard (dark theme, 20+ tabs, real-time)
- **Backend:** Node.js/Express API (v128, 42KB server.js)
- **Database:** SQLite + JSON caches
- **Services:** 40+ service modules in /services/
- **Odds:** The Odds API (50+ books)
- **Stats:** ESPN, NHL API, Baseball Savant (Statcast), DailyFaceoff, Open-Meteo
- **Hosting:** Fly.io 512MB VM at sportssim.fly.dev
- **Repo:** github.com/William-Metz/sportssim (146+ commits)
- **CI/CD:** GitHub Actions auto-deploy on push

---

## Phase Status

### Phase 1: Foundation ✅ COMPLETE
- [x] Project structure + Express backend
- [x] NBA power rating model
- [x] MLB power rating model (pitching + park factors)
- [x] The Odds API integration (all sports)
- [x] Value detection engine (universal)
- [x] Dashboard MVP (multi-sport)
- [x] Deploy to sportssim.fly.dev
- [x] NBA backtest (176 games)
- [x] MLB Opening Day projections

### Phase 2: Depth ✅ COMPLETE
- [x] NHL model (Pythagorean + goalie adjustments)
- [x] Rolling stats for all sports (ESPN/NHL live APIs)
- [x] Injury scraping (all leagues, ESPN data)
- [x] Totals model (Negative Binomial, all sports)
- [x] Player props framework
- [x] Kelly Criterion multi-sport portfolio optimizer
- [x] Line movement tracking + sharp money detection
- [x] MLB starting pitcher impact model (167 pitchers)
- [x] MLB park factor adjustments (30 parks)
- [x] MLB weather integration (Open-Meteo live)
- [x] Platoon splits (Savant data)
- [x] Catcher framing (Savant data)
- [x] Stolen base model
- [x] Opening week unders model

### Phase 3: Advanced Models 🔄 IN PROGRESS (75%)
- [x] NFL win totals futures model (32 teams, 30 value bets)
- [x] Kalshi scanner (119 value bets, 90 high confidence)
- [x] NHL playoff series model + dashboard
- [x] NBA seeding sim → futures bridge
- [x] Conviction scoring engine
- [x] Edge decay optimizer
- [x] Statcast ML integration (853 pitchers, 651 batters)
- [x] Polymarket value bridge
- [ ] Soccer model (EPL/Champions League) — backlog
- [ ] UFC/MMA model — backlog
- [ ] Tennis model — backlog
- [ ] Same-game parlay correlation engine — backlog
- [ ] Arbitrage scanner (cross-book) — backlog

### Phase 4: Automation & Alerts 🔄 IN PROGRESS (60%)
- [x] Auto-scan on active hours (scanner + watchdog)
- [x] CLV tracking + auto-grading pipeline
- [x] Live bet execution engine
- [x] OD Playbook with conviction grades
- [ ] Push alerts for +EV > 5% (Telegram/WhatsApp) — NOT DONE
- [ ] Bet tracker with full P&L reporting — PARTIAL
- [ ] Daily automated P&L report — NOT DONE
- [ ] Weekly strategy digest — NOT DONE

### Phase 5: Edge Maximization 🔄 IN PROGRESS (30%)
- [x] Statcast ML ensemble
- [x] Edge decay optimizer
- [x] Prop market scanner (K props, player props)
- [ ] Market efficiency map (which books are softest?) — NOT DONE
- [ ] Live in-game models — NOT DONE
- [ ] Alternate line optimizer — PARTIAL
- [ ] Model self-improvement loop — NOT DONE

---

## Key Metrics (Current)

### NBA
| Metric | Value | Target |
|--------|-------|--------|
| ML Accuracy | 71% | >65% ✅ |
| ATS | 50.4% (-3.8% ROI) | >53% ❌ |
| Totals | 66.7% (+27.3% ROI) | >55% ✅✅ |
| Backtest Games | 176 | 500+ |

### MLB
| Metric | Value | Target |
|--------|-------|--------|
| ML Accuracy | 71% | >60% ✅✅ |
| Overall ROI | 30.2% | >10% ✅✅ |
| 10%+ Edge ROI | 42.3% | >20% ✅✅ |
| Totals ROI | 11.9% | >5% ✅ |

### NHL
| Metric | Value | Target |
|--------|-------|--------|
| Backtest Games | 0 | 200+ ❌ |
| Model | Live | ✅ |
| Goalie Integration | Live | ✅ |

---

## Immediate Priorities (April 14-24)

### 🔴 P0 — Do Today
1. **NBA Play-In edges** — PHX vs POR tonight, model predictions vs DK lines
2. **MLB daily value scan** — games today, auto-scanner should catch edges
3. **NHL playoff prep** — 5 days to validate model before real money

### 🟡 P1 — This Week
4. **NBA Playoff series pricing model** — Series bets are where the REAL money is
5. **NHL backtest** — MUST validate before playoffs April 19
6. **MLB early season regression** — Which teams are over/under-performing?
7. **Push alerts** — Telegram/WhatsApp for high-value edges (still not wired!)

### 🟢 P2 — Next 10 Days
8. **NFL Draft adjustments** — Post-draft win total recalculations
9. **NBA Round 1 analysis** — Matchup-specific edges for each series
10. **Bet tracker P&L** — Need to know if we're actually making money

---

## Session Cadence
- **Auto:** Scanner runs every 30min on game days
- **Every 2 hours:** Planning review — assess progress, reprioritize
- **Daily:** Check all sports for today's edges
- **Weekly:** Full performance review, model accuracy audit

---

*Last updated: 2026-04-14*
*Current version: v128*
*Current phase: 3.5 — Advanced Models + Automation*
*🏀 NBA PLAY-IN STARTS TODAY*
*🏒 NHL PLAYOFFS IN 5 DAYS*
*🏈 NFL DRAFT IN 10 DAYS*
