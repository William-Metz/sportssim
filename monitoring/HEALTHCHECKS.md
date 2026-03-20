# Healthchecks.io Setup Guide

## Quick Setup (2 minutes)

1. Go to https://healthchecks.io/ and sign up (free tier: 20 checks)
2. Create a new project called "SportsSim"
3. Get API key from Project Settings → API Access
4. Create these checks:
   - **sportssim** — Period: 5 min, Grace: 10 min
   - **claw-hub** — Period: 5 min, Grace: 10 min
   - **grafana** — Period: 30 min, Grace: 60 min

## How It Works

Our health monitor cron (runs every 30 min) pings Healthchecks.io after each successful check.
If Healthchecks.io doesn't get a ping within the grace period, it sends an alert.

## Ping URLs (fill in after setup)

```
SPORTSSIM_HC_PING=https://hc-ping.com/<uuid-for-sportssim>
CLAWHUB_HC_PING=https://hc-ping.com/<uuid-for-claw-hub>
GRAFANA_HC_PING=https://hc-ping.com/<uuid-for-grafana>
```

## Alternative: UptimeRobot (also free, no ping needed)

UptimeRobot actively checks YOUR urls from their servers — no cron ping needed.

1. Sign up at https://uptimerobot.com/ (free: 50 monitors, 5-min interval)
2. Add HTTP monitors for:
   - https://sportssim.fly.dev
   - https://claw-hub.hatch.fun
   - https://sportssim-grafana.fly.dev
3. Set up email/webhook alerts
4. Get a public status page at https://stats.uptimerobot.com/your-page

UptimeRobot is simpler — it monitors without needing our cron to ping it.
