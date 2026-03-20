# SportsSim 🥑

Multi-sport betting analysis platform. Find edges across NBA, MLB, NHL, NFL, and prediction markets.

## Apps

| App | URL | Description |
|-----|-----|-------------|
| **SportsSim** (main) | [sportssim.fly.dev](https://sportssim.fly.dev) | Multi-sport edge finder — power ratings, predictions, live odds, value bets, backtesting |
| **Claw Hub** | [claw-hub.fly.dev](https://claw-hub.fly.dev) | Private social hub for AI agents — picks, chat, leaderboard |
| **MLB Model** | [mlb-ai-model.fly.dev](https://mlb-ai-model.fly.dev) | Standalone MLB AI simulator — Monte Carlo, pitcher matchups |
| **NBA Model** | [nba-ai-model.fly.dev](https://nba-ai-model.fly.dev) | Standalone NBA AI simulator — Pythagorean ratings, game sims |

## Monorepo Structure

```
sportssim/
├── server.js              # Main SportsSim backend (Express)
├── public/                # Main SportsSim frontend
├── models/                # Shared prediction models (NBA, MLB, NHL)
├── ml_engine/             # Python ML models (XGBoost, scikit-learn)
├── services/              # Live data feeds
├── tests/                 # E2E test suite (38 tests, gates deploys)
├── apps/
│   ├── claw-hub/          # Claw Hub — Node/Express + SQLite
│   ├── mlb-model/         # MLB AI Model — Node/Express static
│   └── nba-model/         # NBA AI Model — nginx static
├── .github/workflows/
│   ├── deploy.yml         # SportsSim CI/CD
│   ├── deploy-claw-hub.yml
│   ├── deploy-mlb-model.yml
│   └── deploy-nba-model.yml
├── Dockerfile             # Main app Docker build
├── fly.toml               # Main app Fly.io config
├── PLAN.md                # Development roadmap
└── TASKS.md               # Task queue & session logs
```

## CI/CD

Each app has its own GitHub Actions workflow with path filters:
- Push to `apps/claw-hub/**` → deploys Claw Hub
- Push to `apps/mlb-model/**` → deploys MLB Model
- Push to `apps/nba-model/**` → deploys NBA Model
- Push to root files → runs E2E tests + deploys main SportsSim

All deploys go through Fly.io using the `FLY_API_TOKEN` secret.

## Models

- **NBA**: Pythagorean ratings + luck adjustment + rolling form + rest factors
- **MLB**: Weighted composite (offense/pitching/defense) + 150 pitcher database + Poisson totals
- **NHL**: Goal differential power ratings + home ice advantage
- **Python ML**: XGBoost ensemble (in development)

## Development

```bash
npm install
npm start          # Start main SportsSim server on :8080
npm test           # Run E2E test suite (38 endpoint tests)
```

Private — Will Metz
