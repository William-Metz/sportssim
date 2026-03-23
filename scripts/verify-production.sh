#!/bin/bash
# Production Deployment Verification Script
# Run after pushing to verify sportssim.fly.dev is healthy

BASE_URL="${1:-https://sportssim.fly.dev}"
TIMEOUT=30
PASS=0
FAIL=0
WARN=0

echo "🦞 SportsSim Production Verification"
echo "   URL: $BASE_URL"
echo "   Time: $(date -u)"
echo "   ========================"
echo ""

check() {
  local name="$1"
  local endpoint="$2"
  local expect_field="$3"
  
  local response
  response=$(curl -s --max-time $TIMEOUT "$BASE_URL$endpoint" 2>/dev/null)
  local exit_code=$?
  
  if [ $exit_code -ne 0 ] || [ -z "$response" ]; then
    echo "❌ FAIL: $name — no response (timeout or connection error)"
    FAIL=$((FAIL + 1))
    return 1
  fi
  
  if [ -n "$expect_field" ]; then
    if echo "$response" | grep -q "$expect_field"; then
      echo "✅ PASS: $name"
      PASS=$((PASS + 1))
      return 0
    else
      echo "⚠️  WARN: $name — responded but missing '$expect_field'"
      echo "   Response: $(echo "$response" | head -c 200)"
      WARN=$((WARN + 1))
      return 2
    fi
  else
    echo "✅ PASS: $name — got response"
    PASS=$((PASS + 1))
    return 0
  fi
}

echo "=== Core Endpoints ==="
check "Health Check" "/api/health" "ok"
check "Data Summary" "/api/summary" "lastRefresh"
check "Value Detection" "/api/value/all" "bets"

echo ""
echo "=== MLB Model ==="
check "MLB Predict (DET@SD)" "/api/mlb/predict/DET/SD" "homeWinProb"
check "MLB Season Sim" "/api/season-sim/rankings" "teams"
check "MLB Futures Value" "/api/season-sim/top-bets" "bets"

echo ""
echo "=== Opening Day ==="
check "OD Betting Card" "/api/opening-day/betting-card" "plays"
check "OD K Props" "/api/opening-day/k-props" "picks"
check "OD NRFI" "/api/opening-day/nrfi" "picks"
check "OD Checklist" "/api/opening-day/checklist" "sections"

echo ""
echo "=== NBA Model ==="
check "NBA Predict" "/api/nba/predict/LAL/BOS" "homeWinProb"
check "NBA Rest/Tank" "/api/nba/rest-tank/scan" "games"

echo ""
echo "=== NHL Model ==="
check "NHL Predict" "/api/nhl/predict/BOS/NYR" "homeWinProb"

echo ""
echo "=== Dashboard ==="
check "Dashboard HTML" "/" "SportsSim"

echo ""
echo "========================"
echo "Results: ✅ $PASS passed | ⚠️  $WARN warnings | ❌ $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo "🚨 PRODUCTION IS DEGRADED — $FAIL endpoints failing"
  exit 1
elif [ $WARN -gt 0 ]; then
  echo "⚠️  Production is up but $WARN endpoints need attention"
  exit 0
else
  echo "🦞 ALL SYSTEMS GO — Production is fully healthy"
  exit 0
fi
