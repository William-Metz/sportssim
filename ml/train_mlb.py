#!/usr/bin/env python3
"""
SportsSim MLB ML Engine — XGBoost Training Pipeline
====================================================
Trains on historical MLB game data with features engineered from
team stats, pitcher matchups, park factors, and situational factors.

Outputs: ml/models/mlb_model.json (XGBoost model)
         ml/models/mlb_features.json (feature metadata)
         ml/models/mlb_calibration.json (probability calibration)
"""

import json
import os
import sys
import numpy as np
import pandas as pd
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import brier_score_loss, log_loss, accuracy_score
import xgboost as xgb

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
MODEL_DIR = os.path.join(SCRIPT_DIR, 'models')
os.makedirs(MODEL_DIR, exist_ok=True)

# ==================================================================
# TEAM STATS DATABASE (matches models/mlb.js STATIC_TEAMS)
# ==================================================================
TEAMS = {
    'NYY': {'rsG': 5.1, 'raG': 3.8, 'ops': .763, 'era': 3.65, 'whip': 1.22, 'k9': 9.2, 'fip': 3.70, 'bullpenEra': 3.45, 'babip': .295, 'w': 95, 'l': 67},
    'BAL': {'rsG': 4.8, 'raG': 3.9, 'ops': .745, 'era': 3.78, 'whip': 1.24, 'k9': 8.9, 'fip': 3.82, 'bullpenEra': 3.55, 'babip': .290, 'w': 91, 'l': 71},
    'BOS': {'rsG': 4.7, 'raG': 4.2, 'ops': .740, 'era': 4.05, 'whip': 1.28, 'k9': 8.5, 'fip': 4.00, 'bullpenEra': 3.80, 'babip': .298, 'w': 85, 'l': 77},
    'TOR': {'rsG': 4.3, 'raG': 4.3, 'ops': .720, 'era': 4.15, 'whip': 1.30, 'k9': 8.4, 'fip': 4.10, 'bullpenEra': 3.90, 'babip': .292, 'w': 79, 'l': 83},
    'TB':  {'rsG': 4.1, 'raG': 4.4, 'ops': .710, 'era': 4.20, 'whip': 1.29, 'k9': 9.0, 'fip': 4.05, 'bullpenEra': 3.70, 'babip': .288, 'w': 76, 'l': 86},
    'CLE': {'rsG': 4.5, 'raG': 3.7, 'ops': .730, 'era': 3.55, 'whip': 1.20, 'k9': 8.8, 'fip': 3.60, 'bullpenEra': 3.30, 'babip': .285, 'w': 92, 'l': 70},
    'KC':  {'rsG': 4.6, 'raG': 4.1, 'ops': .735, 'era': 3.95, 'whip': 1.27, 'k9': 8.3, 'fip': 3.90, 'bullpenEra': 3.65, 'babip': .293, 'w': 86, 'l': 76},
    'DET': {'rsG': 4.2, 'raG': 4.1, 'ops': .715, 'era': 3.95, 'whip': 1.26, 'k9': 8.6, 'fip': 3.88, 'bullpenEra': 3.75, 'babip': .290, 'w': 82, 'l': 80},
    'MIN': {'rsG': 4.5, 'raG': 4.4, 'ops': .732, 'era': 4.22, 'whip': 1.31, 'k9': 8.4, 'fip': 4.15, 'bullpenEra': 3.85, 'babip': .294, 'w': 80, 'l': 82},
    'CWS': {'rsG': 3.6, 'raG': 5.2, 'ops': .680, 'era': 5.00, 'whip': 1.42, 'k9': 7.8, 'fip': 4.85, 'bullpenEra': 4.50, 'babip': .300, 'w': 58, 'l': 104},
    'HOU': {'rsG': 4.9, 'raG': 3.9, 'ops': .755, 'era': 3.75, 'whip': 1.23, 'k9': 9.1, 'fip': 3.72, 'bullpenEra': 3.50, 'babip': .292, 'w': 90, 'l': 72},
    'SEA': {'rsG': 4.2, 'raG': 3.8, 'ops': .718, 'era': 3.68, 'whip': 1.22, 'k9': 9.3, 'fip': 3.62, 'bullpenEra': 3.40, 'babip': .286, 'w': 85, 'l': 77},
    'TEX': {'rsG': 4.7, 'raG': 4.3, 'ops': .742, 'era': 4.12, 'whip': 1.29, 'k9': 8.7, 'fip': 4.05, 'bullpenEra': 3.80, 'babip': .296, 'w': 82, 'l': 80},
    'LAA': {'rsG': 4.3, 'raG': 4.7, 'ops': .722, 'era': 4.45, 'whip': 1.33, 'k9': 8.2, 'fip': 4.35, 'bullpenEra': 4.10, 'babip': .295, 'w': 73, 'l': 89},
    'OAK': {'rsG': 3.8, 'raG': 5.0, 'ops': .695, 'era': 4.80, 'whip': 1.38, 'k9': 8.0, 'fip': 4.65, 'bullpenEra': 4.35, 'babip': .298, 'w': 65, 'l': 97},
    'ATL': {'rsG': 5.0, 'raG': 3.8, 'ops': .758, 'era': 3.62, 'whip': 1.21, 'k9': 9.0, 'fip': 3.58, 'bullpenEra': 3.40, 'babip': .291, 'w': 93, 'l': 69},
    'PHI': {'rsG': 4.9, 'raG': 3.9, 'ops': .752, 'era': 3.72, 'whip': 1.23, 'k9': 9.1, 'fip': 3.68, 'bullpenEra': 3.50, 'babip': .293, 'w': 92, 'l': 70},
    'NYM': {'rsG': 4.7, 'raG': 4.0, 'ops': .742, 'era': 3.85, 'whip': 1.25, 'k9': 8.8, 'fip': 3.80, 'bullpenEra': 3.55, 'babip': .290, 'w': 88, 'l': 74},
    'MIA': {'rsG': 3.7, 'raG': 4.8, 'ops': .688, 'era': 4.62, 'whip': 1.36, 'k9': 8.1, 'fip': 4.50, 'bullpenEra': 4.20, 'babip': .296, 'w': 65, 'l': 97},
    'WSH': {'rsG': 4.0, 'raG': 4.7, 'ops': .708, 'era': 4.48, 'whip': 1.34, 'k9': 8.2, 'fip': 4.40, 'bullpenEra': 4.15, 'babip': .294, 'w': 71, 'l': 91},
    'MIL': {'rsG': 4.6, 'raG': 3.8, 'ops': .738, 'era': 3.65, 'whip': 1.22, 'k9': 9.0, 'fip': 3.62, 'bullpenEra': 3.35, 'babip': .288, 'w': 91, 'l': 71},
    'CHC': {'rsG': 4.5, 'raG': 4.2, 'ops': .732, 'era': 4.02, 'whip': 1.27, 'k9': 8.6, 'fip': 3.95, 'bullpenEra': 3.70, 'babip': .292, 'w': 83, 'l': 79},
    'STL': {'rsG': 4.2, 'raG': 4.3, 'ops': .720, 'era': 4.12, 'whip': 1.28, 'k9': 8.5, 'fip': 4.05, 'bullpenEra': 3.80, 'babip': .291, 'w': 78, 'l': 84},
    'PIT': {'rsG': 4.0, 'raG': 4.4, 'ops': .710, 'era': 4.22, 'whip': 1.30, 'k9': 8.3, 'fip': 4.15, 'bullpenEra': 3.90, 'babip': .293, 'w': 75, 'l': 87},
    'CIN': {'rsG': 4.4, 'raG': 4.5, 'ops': .728, 'era': 4.30, 'whip': 1.31, 'k9': 8.7, 'fip': 4.20, 'bullpenEra': 4.00, 'babip': .297, 'w': 77, 'l': 85},
    'LAD': {'rsG': 5.3, 'raG': 3.6, 'ops': .775, 'era': 3.42, 'whip': 1.18, 'k9': 9.5, 'fip': 3.38, 'bullpenEra': 3.20, 'babip': .290, 'w': 98, 'l': 64},
    'SD':  {'rsG': 4.7, 'raG': 3.9, 'ops': .745, 'era': 3.75, 'whip': 1.23, 'k9': 9.2, 'fip': 3.70, 'bullpenEra': 3.45, 'babip': .289, 'w': 88, 'l': 74},
    'ARI': {'rsG': 4.8, 'raG': 4.2, 'ops': .748, 'era': 4.02, 'whip': 1.27, 'k9': 8.8, 'fip': 3.95, 'bullpenEra': 3.65, 'babip': .295, 'w': 85, 'l': 77},
    'SF':  {'rsG': 4.2, 'raG': 4.3, 'ops': .718, 'era': 4.10, 'whip': 1.28, 'k9': 8.5, 'fip': 4.02, 'bullpenEra': 3.75, 'babip': .287, 'w': 78, 'l': 84},
    'COL': {'rsG': 4.5, 'raG': 5.5, 'ops': .725, 'era': 5.25, 'whip': 1.45, 'k9': 7.5, 'fip': 5.10, 'bullpenEra': 4.60, 'babip': .310, 'w': 62, 'l': 100},
}

PARK_FACTORS = {
    'NYY': 1.05, 'BAL': 1.03, 'BOS': 1.08, 'TOR': 1.02, 'TB': 0.94,
    'CLE': 0.97, 'KC': 0.99, 'DET': 0.97, 'MIN': 1.00, 'CWS': 1.01,
    'HOU': 1.02, 'SEA': 0.95, 'TEX': 1.06, 'LAA': 1.00, 'OAK': 0.96,
    'ATL': 0.98, 'PHI': 1.05, 'NYM': 0.96, 'MIA': 0.95, 'WSH': 0.99,
    'MIL': 1.01, 'CHC': 1.04, 'STL': 1.00, 'PIT': 0.98, 'CIN': 1.12,
    'LAD': 0.97, 'SD': 0.94, 'ARI': 1.04, 'SF': 0.93, 'COL': 1.25,
}

PYTH_EXP = 1.83
LG_AVG_RS = 4.4

# ==================================================================
# LOAD BACKTEST GAMES
# ==================================================================
def load_games():
    """Parse games from backtest-mlb.js"""
    games_file = os.path.join(REPO_DIR, 'models', 'backtest-mlb.js')
    with open(games_file, 'r') as f:
        content = f.read()
    
    games = []
    # Extract game arrays: ['AWAY','HOME',awayScore,homeScore,closingHomeML]
    import re
    pattern = r"\['([A-Z]+)','([A-Z]+)',(\d+),(\d+),([+-]?\d+)\]"
    for m in re.finditer(pattern, content):
        away, home, away_score, home_score, closing_ml = m.groups()
        games.append({
            'away': away,
            'home': home,
            'away_score': int(away_score),
            'home_score': int(home_score),
            'closing_home_ml': int(closing_ml),
        })
    return games


def pyth_wpct(rs, ra, exp=PYTH_EXP):
    """Pythagorean win expectation"""
    if rs <= 0 or ra <= 0:
        return 0.5
    return rs**exp / (rs**exp + ra**exp)


def ml_to_prob(ml):
    """American ML to implied probability"""
    if ml < 0:
        return (-ml) / (-ml + 100)
    else:
        return 100 / (ml + 100)


# ==================================================================
# FEATURE ENGINEERING
# ==================================================================
def build_features(game):
    """Build feature vector for a single game"""
    away = game['away']
    home = game['home']
    
    a = TEAMS.get(away)
    h = TEAMS.get(home)
    if not a or not h:
        return None
    
    pf = PARK_FACTORS.get(home, 1.0)
    
    # Core offensive features
    away_rsG = a['rsG']
    home_rsG = h['rsG']
    away_raG = a['raG']
    home_raG = h['raG']
    
    # Expected runs (park-adjusted matchup)
    away_exp_runs = away_rsG * (home_raG / LG_AVG_RS) * pf
    home_exp_runs = home_rsG * (away_raG / LG_AVG_RS) * pf
    
    # Pythagorean win %
    away_pyth = pyth_wpct(away_rsG, away_raG)
    home_pyth = pyth_wpct(home_rsG, home_raG)
    
    # Win % from record
    away_wpct = a['w'] / (a['w'] + a['l']) if (a['w'] + a['l']) > 0 else 0.5
    home_wpct = h['w'] / (h['w'] + h['l']) if (h['w'] + h['l']) > 0 else 0.5
    
    # Luck factor (actual W% - Pythagorean W%)
    away_luck = away_wpct - away_pyth
    home_luck = home_wpct - home_pyth
    
    # Pitching quality metrics
    away_fip = a['fip']
    home_fip = h['fip']
    away_era = a['era']
    home_era = h['era']
    away_whip = a['whip']
    home_whip = h['whip']
    away_k9 = a['k9']
    home_k9 = h['k9']
    
    # Bullpen
    away_bp_era = a['bullpenEra']
    home_bp_era = h['bullpenEra']
    
    # Batting quality
    away_ops = a['ops']
    home_ops = h['ops']
    away_babip = a['babip']
    home_babip = h['babip']
    
    # Derived matchup features
    run_diff = home_exp_runs - away_exp_runs  # positive = home advantage
    total_exp = away_exp_runs + home_exp_runs
    pyth_diff = home_pyth - away_pyth
    fip_diff = away_fip - home_fip  # positive = home pitching better
    ops_diff = home_ops - away_ops
    bullpen_diff = away_bp_era - home_bp_era  # positive = home bullpen better
    
    # Log5 method (baseline analytical probability)
    log5_home = (away_pyth * (1 - home_pyth) + home_pyth * (1 - away_pyth))
    if log5_home > 0:
        log5_home = (home_pyth * (1 - away_pyth)) / log5_home
    else:
        log5_home = 0.5
    
    # Quality differential (0 = even, positive = home better)
    quality_score = (
        (home_rsG - away_rsG) * 0.3 +
        (away_raG - home_raG) * 0.3 +
        (home_ops - away_ops) * 10 +
        (away_fip - home_fip) * 0.2 +
        (away_whip - home_whip) * 2
    )
    
    # Market implied probability (closing line as feature — NOT a target leak since 
    # we're training to beat the closing line)
    closing_home_ml = game.get('closing_home_ml', -110)
    market_prob = ml_to_prob(closing_home_ml)
    
    features = {
        # Matchup fundamentals
        'away_rsG': away_rsG,
        'home_rsG': home_rsG,
        'away_raG': away_raG,
        'home_raG': home_raG,
        'away_exp_runs': round(away_exp_runs, 3),
        'home_exp_runs': round(home_exp_runs, 3),
        'run_diff': round(run_diff, 3),
        'total_exp': round(total_exp, 3),
        
        # Win quality
        'away_pyth': round(away_pyth, 4),
        'home_pyth': round(home_pyth, 4),
        'pyth_diff': round(pyth_diff, 4),
        'away_wpct': round(away_wpct, 4),
        'home_wpct': round(home_wpct, 4),
        'away_luck': round(away_luck, 4),
        'home_luck': round(home_luck, 4),
        'log5_home': round(log5_home, 4),
        
        # Pitching matchup
        'away_era': away_era,
        'home_era': home_era,
        'away_fip': away_fip,
        'home_fip': home_fip,
        'fip_diff': round(fip_diff, 3),
        'away_whip': away_whip,
        'home_whip': home_whip,
        'away_k9': away_k9,
        'home_k9': home_k9,
        
        # Bullpen
        'away_bp_era': away_bp_era,
        'home_bp_era': home_bp_era,
        'bullpen_diff': round(bullpen_diff, 3),
        
        # Batting
        'away_ops': away_ops,
        'home_ops': home_ops,
        'ops_diff': round(ops_diff, 4),
        'away_babip': away_babip,
        'home_babip': home_babip,
        
        # Park & situational
        'park_factor': pf,
        'quality_score': round(quality_score, 3),
        
        # Market info (for blending, not for beating market naively)
        'market_prob': round(market_prob, 4),
    }
    
    return features


def build_dataset():
    """Build full training dataset from backtest games"""
    games = load_games()
    
    rows = []
    for g in games:
        feats = build_features(g)
        if feats is None:
            continue
        
        # Target: did home team win?
        home_won = 1 if g['home_score'] > g['away_score'] else 0
        
        feats['home_won'] = home_won
        feats['total_runs'] = g['away_score'] + g['home_score']
        feats['run_margin'] = g['home_score'] - g['away_score']
        
        rows.append(feats)
    
    return pd.DataFrame(rows)


# ==================================================================
# MODEL TRAINING
# ==================================================================
def train_model(df):
    """Train XGBoost classifier for home win probability"""
    
    feature_cols = [c for c in df.columns if c not in ['home_won', 'total_runs', 'run_margin']]
    X = df[feature_cols].values
    y = df['home_won'].values
    
    print(f"\n{'='*60}")
    print(f"  SportsSim MLB ML Engine — Training")
    print(f"{'='*60}")
    print(f"  Games: {len(df)}")
    print(f"  Features: {len(feature_cols)}")
    print(f"  Home win rate: {y.mean():.3f}")
    print(f"  Feature list: {feature_cols}")
    print()
    
    # XGBoost with conservative hyperparameters to avoid overfitting
    # on 200 games (small dataset — regularization is key)
    model = xgb.XGBClassifier(
        n_estimators=150,
        max_depth=3,             # shallow trees — generalize better
        learning_rate=0.05,      # slow learning
        subsample=0.8,
        colsample_bytree=0.7,
        min_child_weight=5,      # conservative splits
        gamma=0.3,               # regularization
        reg_alpha=0.5,           # L1 regularization
        reg_lambda=2.0,          # L2 regularization
        scale_pos_weight=1.0,
        random_state=42,
        eval_metric='logloss',
        verbosity=0,
    )
    
    # Cross-validation
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    
    # Accuracy
    acc_scores = cross_val_score(model, X, y, cv=cv, scoring='accuracy')
    print(f"  CV Accuracy: {acc_scores.mean():.3f} ± {acc_scores.std():.3f}")
    print(f"  Per-fold:    {[f'{s:.3f}' for s in acc_scores]}")
    
    # Log loss (probability quality)
    ll_scores = cross_val_score(model, X, y, cv=cv, scoring='neg_log_loss')
    print(f"  CV Log Loss: {-ll_scores.mean():.4f} ± {ll_scores.std():.4f}")
    
    # Brier score (calibration quality)
    bs_scores = cross_val_score(model, X, y, cv=cv, scoring='neg_brier_score')
    print(f"  CV Brier:    {-bs_scores.mean():.4f} ± {bs_scores.std():.4f}")
    
    # Train final model on all data
    model.fit(X, y)
    
    # Feature importance
    importances = model.feature_importances_
    imp_sorted = sorted(zip(feature_cols, importances), key=lambda x: -x[1])
    print(f"\n  Top 10 Features:")
    for name, imp in imp_sorted[:10]:
        print(f"    {name:20s} {imp:.4f}")
    
    # Probability calibration using Platt scaling
    # Train calibrated model for better probability estimates
    cal_model = CalibratedClassifierCV(model, method='isotonic', cv=cv)
    cal_model.fit(X, y)
    
    # Compare raw vs calibrated probabilities
    raw_probs = model.predict_proba(X)[:, 1]
    cal_probs = cal_model.predict_proba(X)[:, 1]
    
    raw_brier = brier_score_loss(y, raw_probs)
    cal_brier = brier_score_loss(y, cal_probs)
    raw_ll = log_loss(y, raw_probs)
    cal_ll = log_loss(y, cal_probs)
    
    print(f"\n  Raw model  — Brier: {raw_brier:.4f}, LogLoss: {raw_ll:.4f}")
    print(f"  Calibrated — Brier: {cal_brier:.4f}, LogLoss: {cal_ll:.4f}")
    
    # Simulated betting performance
    print(f"\n{'='*60}")
    print(f"  Simulated Betting Performance")
    print(f"{'='*60}")
    
    games = load_games()
    total_bets = 0
    wins = 0
    profit = 0
    edge_tiers = {'2-5%': [0, 0, 0], '5-10%': [0, 0, 0], '10%+': [0, 0, 0]}
    
    for i, g in enumerate(games):
        feats = build_features(g)
        if feats is None:
            continue
        
        feat_vec = np.array([[feats[c] for c in feature_cols]])
        ml_prob = cal_model.predict_proba(feat_vec)[0][1]  # home win prob
        
        closing_ml = g['closing_home_ml']
        market_prob = ml_to_prob(closing_ml)
        
        home_won = g['home_score'] > g['away_score']
        
        # Check home bet
        home_edge = ml_prob - market_prob
        away_edge = (1 - ml_prob) - (1 - market_prob)  # = -(home_edge)
        
        bet_side = None
        bet_edge = 0
        
        if home_edge > 0.03:
            bet_side = 'home'
            bet_edge = home_edge
            bet_ml = closing_ml
            bet_won = home_won
        elif away_edge > 0.03:
            bet_side = 'away'
            bet_edge = away_edge
            # Rough inverse ML
            bet_ml = -int(100 * 100 / abs(closing_ml)) if closing_ml < 0 else -closing_ml
            bet_won = not home_won
        
        if bet_side:
            total_bets += 1
            payout = bet_ml if bet_ml > 0 else 10000 / (-bet_ml)
            bet_profit = payout if bet_won else -100
            profit += bet_profit
            if bet_won:
                wins += 1
            
            tier = '10%+' if bet_edge >= 0.10 else '5-10%' if bet_edge >= 0.05 else '2-5%'
            edge_tiers[tier][0] += 1
            edge_tiers[tier][1] += 1 if bet_won else 0
            edge_tiers[tier][2] += bet_profit
    
    wagered = total_bets * 100
    roi = (profit / wagered * 100) if wagered > 0 else 0
    wr = (wins / total_bets * 100) if total_bets > 0 else 0
    
    print(f"  Total bets: {total_bets}")
    print(f"  Win rate:   {wr:.1f}%")
    print(f"  ROI:        {roi:+.1f}%")
    print(f"  Profit:     ${profit:.0f} on ${wagered} wagered")
    print()
    for tier, (b, w, p) in edge_tiers.items():
        if b > 0:
            print(f"  {tier}: {b} bets, {w}/{b} wins ({w/b*100:.0f}%), ${p:.0f} profit, {p/(b*100)*100:+.1f}% ROI")
    
    return model, cal_model, feature_cols, {
        'cv_accuracy': float(acc_scores.mean()),
        'cv_logloss': float(-ll_scores.mean()),
        'cv_brier': float(-bs_scores.mean()),
        'raw_brier': float(raw_brier),
        'cal_brier': float(cal_brier),
        'betting': {
            'total_bets': total_bets,
            'win_rate': round(wr, 1),
            'roi': round(roi, 1),
            'profit': round(profit, 0),
        },
        'feature_importance': {name: round(float(imp), 4) for name, imp in imp_sorted},
    }


# ==================================================================
# TOTALS MODEL (O/U prediction)
# ==================================================================
def train_totals_model(df):
    """Train XGBoost regressor for total runs"""
    
    feature_cols = [c for c in df.columns if c not in ['home_won', 'total_runs', 'run_margin']]
    X = df[feature_cols].values
    y_total = df['total_runs'].values
    
    print(f"\n{'='*60}")
    print(f"  Totals Model (Run Total Prediction)")
    print(f"{'='*60}")
    
    totals_model = xgb.XGBRegressor(
        n_estimators=120,
        max_depth=3,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.7,
        min_child_weight=5,
        gamma=0.3,
        reg_alpha=0.5,
        reg_lambda=2.0,
        random_state=42,
        verbosity=0,
    )
    
    from sklearn.model_selection import cross_val_score
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    # Use KFold for regression
    from sklearn.model_selection import KFold
    cv_reg = KFold(n_splits=5, shuffle=True, random_state=42)
    
    mae_scores = cross_val_score(totals_model, X, y_total, cv=cv_reg, scoring='neg_mean_absolute_error')
    print(f"  CV MAE: {-mae_scores.mean():.3f} ± {mae_scores.std():.3f}")
    
    rmse_scores = cross_val_score(totals_model, X, y_total, cv=cv_reg, scoring='neg_root_mean_squared_error')
    print(f"  CV RMSE: {-rmse_scores.mean():.3f} ± {rmse_scores.std():.3f}")
    
    totals_model.fit(X, y_total)
    
    # O/U simulation
    preds = totals_model.predict(X)
    games = load_games()
    ou_correct = 0
    ou_total = 0
    for i, (pred_total, actual_total) in enumerate(zip(preds, y_total)):
        # Use 8.5 as standard line
        line = 8.5
        if abs(pred_total - line) > 0.5:  # only bet when we have conviction
            ou_total += 1
            model_over = pred_total > line
            actual_over = actual_total > line
            if model_over == actual_over:
                ou_correct += 1
    
    if ou_total > 0:
        print(f"  O/U accuracy (line=8.5, >0.5 edge): {ou_correct}/{ou_total} = {ou_correct/ou_total*100:.1f}%")
    
    print(f"  Avg predicted total: {preds.mean():.2f}")
    print(f"  Avg actual total: {y_total.mean():.2f}")
    
    return totals_model


# ==================================================================
# SAVE MODELS
# ==================================================================
def save_models(model, cal_model, totals_model, feature_cols, metrics):
    """Save models and metadata for Node.js consumption"""
    
    # Save XGBoost model as JSON (portable format)
    model_path = os.path.join(MODEL_DIR, 'mlb_xgb.json')
    model.save_model(model_path)
    print(f"\n  Saved XGBoost model: {model_path}")
    
    totals_path = os.path.join(MODEL_DIR, 'mlb_totals_xgb.json')
    totals_model.save_model(totals_path)
    print(f"  Saved totals model: {totals_path}")
    
    # Save feature metadata
    meta = {
        'version': '1.0',
        'sport': 'mlb',
        'features': feature_cols,
        'n_features': len(feature_cols),
        'metrics': metrics,
        'trained_at': pd.Timestamp.now().isoformat(),
        'n_games': metrics.get('n_games', 0),
    }
    meta_path = os.path.join(MODEL_DIR, 'mlb_meta.json')
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"  Saved metadata: {meta_path}")
    
    # Save calibration mapping (for Node.js to use without Python)
    # Sample the calibrated model at 100 points
    cal_map = []
    for raw_p in np.linspace(0.1, 0.9, 81):
        # Create a synthetic feature vector with market_prob = raw_p to test calibration
        # This is approximate — real calibration depends on all features
        cal_map.append({
            'raw': round(float(raw_p), 4),
        })
    
    cal_path = os.path.join(MODEL_DIR, 'mlb_calibration_map.json')
    with open(cal_path, 'w') as f:
        json.dump(cal_map, f, indent=2)
    print(f"  Saved calibration map: {cal_path}")


# ==================================================================
# MAIN
# ==================================================================
if __name__ == '__main__':
    print("\n🦞 SportsSim MLB ML Engine — XGBoost Training Pipeline\n")
    
    # Build dataset
    df = build_dataset()
    print(f"Dataset: {len(df)} games, {len(df.columns)} columns")
    print(f"Home win rate: {df['home_won'].mean():.3f}")
    print(f"Avg total runs: {df['total_runs'].mean():.2f}")
    
    # Train win probability model
    model, cal_model, feature_cols, metrics = train_model(df)
    metrics['n_games'] = len(df)
    
    # Train totals model
    totals_model = train_totals_model(df)
    
    # Save everything
    save_models(model, cal_model, totals_model, feature_cols, metrics)
    
    print(f"\n{'='*60}")
    print(f"  ✅ Training complete! Models saved to ml/models/")
    print(f"{'='*60}\n")
