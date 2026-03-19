# SportsSim ML Engine

Python-based ML models for sports betting edge detection.

## Models
- **nba_model.py** — XGBoost NBA predictor (rolling features, walk-forward backtest)
- **data_fetcher.py** — Historical data pipeline (basketball-reference, baseball-reference, hockey-reference)

## Setup
```bash
pip install -r requirements.txt
```

## Usage
```bash
# Fetch 10 years of NBA data
python data_fetcher.py --sport nba --years 10

# Train and backtest
python nba_model.py
```

## Features Used
- Offensive/Defensive rating differential
- Net rating differential
- Pace factor
- Rest days advantage (B2B detection)
- L10 rolling win% and point differential
- Pythagorean expected win%
- Home court advantage

## Architecture
```
data_fetcher.py → CSV files → nba_model.py → XGBoost → predictions
                                                          ↓
                                              server.js ← Flask API
```
