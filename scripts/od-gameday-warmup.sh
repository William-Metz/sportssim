#!/bin/bash
# ============================================
# OD Gameday Warm-Up Script v1.0
# ============================================
# Run this 30-60 minutes before first pitch on March 26
# PIT@NYM first pitch: 1:10 PM ET = 17:10 UTC
#
# Usage: bash scripts/od-gameday-warmup.sh
# ============================================

BASE_URL="https://sportssim.fly.dev"
TIMEOUT=30

echo "🦞 MetaClaw Opening Day Warmup — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "================================================================="
echo ""

# Phase 1: Wake the VM
echo "📡 [1/8] Waking Fly.io VM..."
HEALTH=$(curl -s --max-time $TIMEOUT "${BASE_URL}/api/health" 2>/dev/null)
VERSION=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
if [ -n "$VERSION" ]; then
  echo "   ✅ VM awake — version $VERSION"
else
  echo "   ⚠️ VM slow to wake — retrying..."
  sleep 5
  HEALTH=$(curl -s --max-time 60 "${BASE_URL}/api/health" 2>/dev/null)
  VERSION=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
  echo "   ${VERSION:+✅ VM awake — version $VERSION}${VERSION:-❌ VM STILL DOWN}"
fi
echo ""

# Phase 2: Trigger warmup service
echo "🔥 [2/8] Running OD warmup service..."
WARMUP=$(curl -s --max-time 120 "${BASE_URL}/api/od/warmup" 2>/dev/null)
GRADE=$(echo "$WARMUP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('grade','?'))" 2>/dev/null)
PASS_RATE=$(echo "$WARMUP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('passRate','?'))" 2>/dev/null)
echo "   Warmup: $GRADE ($PASS_RATE)"
echo ""

# Phase 3: Pull live weather
echo "🌤️  [3/8] Checking weather for all OD venues..."
WEATHER=$(curl -s --max-time $TIMEOUT "${BASE_URL}/api/opening-day/weather-check" 2>/dev/null)
PARKS=$(echo "$WEATHER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('parks',0))" 2>/dev/null)
echo "   Weather data for $PARKS outdoor parks"
# Flag extreme conditions
echo "$WEATHER" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for f in d.get('forecasts', []):
        fc = f.get('forecast', {})
        team = f.get('team', '?')
        park = f.get('park', '?')
        temp = fc.get('tempF', 0)
        wind = fc.get('windMph', 0)
        precip = fc.get('precipProb', 0)
        flags = []
        if temp < 45: flags.append(f'🥶 COLD {temp}°F')
        if wind > 15: flags.append(f'💨 WIND {wind}mph')
        if precip > 30: flags.append(f'🌧️ RAIN {precip}%')
        if fc.get('isPostponementRisk'): flags.append('🚫 POSTPONEMENT RISK')
        if flags:
            print(f'   ⚠️ {team} ({park}): {\" | \".join(flags)}')
except: pass
" 2>/dev/null
echo ""

# Phase 4: Check pitcher sync
echo "⚾ [4/8] Checking pitcher confirmations..."
PITCHERS=$(curl -s --max-time $TIMEOUT "${BASE_URL}/api/od/pitcher-sync" 2>/dev/null)
echo "$PITCHERS" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    total = d.get('totalGames', 0)
    changes = len(d.get('changes', []))
    tbds = len(d.get('tbdPitchers', []))
    print(f'   Games checked: {total}')
    if changes > 0:
        print(f'   🚨 PITCHER CHANGES: {changes}')
        for c in d.get('changes', []):
            print(f'      {c.get(\"game\",\"?\")} — {c.get(\"change\",\"?\")}')
    if tbds > 0:
        print(f'   ⚠️ TBD pitchers: {tbds}')
    if changes == 0 and tbds == 0:
        print(f'   ✅ All pitchers confirmed')
except Exception as e:
    print(f'   ⚠️ Pitcher sync check: {e}')
" 2>/dev/null
echo ""

# Phase 5: Betting card
echo "💰 [5/8] Loading betting card..."
CARD=$(curl -s --max-time $TIMEOUT "${BASE_URL}/api/opening-day/betting-card" 2>/dev/null)
echo "$CARD" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    plays = d.get('totalPlays', 0)
    tiers = d.get('tiers', {})
    smash = tiers.get('smash', {}).get('count', 0)
    strong = tiers.get('strong', {}).get('count', 0)
    total_ev = sum(p.get('ev', 0) for t in tiers.values() for p in t.get('plays', []))
    total_wager = sum(p.get('wager', 0) for t in tiers.values() for p in t.get('plays', []))
    print(f'   Total plays: {plays} ({smash} SMASH, {strong} STRONG)')
    print(f'   Portfolio: \${total_wager:.0f} wagered, \${total_ev:.2f} EV ({100*total_ev/max(total_wager,1):.1f}% ROI)')
    # Show top SMASH plays
    for p in tiers.get('smash', {}).get('plays', []):
        print(f'   🔥 {p.get(\"game\",\"?\")} {p.get(\"pick\",\"?\")} | edge={p.get(\"edge\",0):.1f}% conv={p.get(\"conviction\",{}).get(\"score\",0)}')
except Exception as e:
    print(f'   ⚠️ Betting card: {e}')
" 2>/dev/null
echo ""

# Phase 6: Live execution engine
echo "🎯 [6/8] Pulling live odds + execution plan..."
EXEC=$(curl -s --max-time 60 "${BASE_URL}/api/od/live-execution" 2>/dev/null)
echo "$EXEC" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    odds_status = d.get('oddsStatus', 'unknown')
    games = len(d.get('games', []))
    action = d.get('actionBoard', {})
    execute = len(action.get('executeNow', []))
    wait_for = len(action.get('waitForBetterPrice', []))
    print(f'   Odds: {odds_status}')
    print(f'   Games analyzed: {games}')
    print(f'   Execute NOW: {execute} | Wait: {wait_for}')
    for p in action.get('executeNow', [])[:5]:
        print(f'   🎯 {p.get(\"game\",\"?\")} {p.get(\"pick\",\"?\")} edge={p.get(\"edge\",0):.1f}%')
except Exception as e:
    print(f'   ⚠️ Live execution: {e}')
" 2>/dev/null
echo ""

# Phase 7: K Props refresh
echo "🔥 [7/8] Refreshing K prop lines from live odds..."
KPROPS=$(curl -s --max-time $TIMEOUT "${BASE_URL}/api/opening-day/k-props/top" 2>/dev/null)
echo "$KPROPS" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    picks = d.get('picks', d.get('topPicks', []))
    print(f'   K prop picks: {len(picks)}')
    for p in picks[:5]:
        pitcher = p.get('pitcher', '?')
        pick_type = p.get('pick', '?')
        edge = p.get('edge', 0)
        print(f'   ⚾ {pitcher} {pick_type} | edge={edge:.1f}%')
except Exception as e:
    print(f'   ⚠️ K props: {e}')
" 2>/dev/null
echo ""

# Phase 8: Memory and system check
echo "🔧 [8/8] System health..."
DEEP=$(curl -s --max-time $TIMEOUT "${BASE_URL}/api/health/deep" 2>/dev/null)
echo "$DEEP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    mem = d.get('memory', {})
    uptime = d.get('uptime', '?')
    rss = mem.get('rss', 0)
    heap = mem.get('heapUsed', 0)
    print(f'   Uptime: {uptime}')
    print(f'   Memory: RSS {rss}MB, Heap {heap}MB')
    if rss > 900:
        print(f'   ⚠️ HIGH MEMORY — consider restarting before game time')
    else:
        print(f'   ✅ Memory OK')
except Exception as e:
    print(f'   ⚠️ Health: {e}')
" 2>/dev/null
echo ""

echo "================================================================="
echo "🦞 Warmup complete! $(date -u '+%H:%M:%S UTC')"
echo ""
echo "NEXT STEPS:"
echo "  1. If any ⚠️ or 🚨 flags above, investigate"
echo "  2. Check /live-execution.html on your phone"
echo "  3. Place SMASH plays FIRST (highest edge, most likely to decay)"
echo "  4. Wait for lineups (~2hr before game) to confirm STRONG plays"
echo "  5. Monitor edge decay throughout the day"
echo ""
echo "🎯 LET'S PRINT MONEY! 🦞"
