#!/usr/bin/env python3
"""
SportsSim ML Engine v1.0 — Python-powered prediction models

Accepts game features as JSON via stdin, outputs calibrated probabilities.
Uses ensemble of Logistic Regression + Random Forest for robust predictions.

Modes:
  - train: Build model from historical game data
  - predict: Generate calibrated probabilities for new games
  - calibrate: Test model calibration on held-out data
  - backtest: Full backtest with betting simulation

Usage:
  echo '{"mode": "train", "data": [...]}' | python3 ml-engine.py
  echo '{"mode": "predict", "games": [...]}' | python3 ml-engine.py
"""

import sys
import json
import math
import os
import pickle
import warnings
from pathlib import Path

warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import brier_score_loss, log_loss, accuracy_score
from scipy.stats import poisson

MODEL_DIR = Path(__file__).parent / 'ml-models'
MODEL_DIR.mkdir(exist_ok=True)

# ==================== FEATURE ENGINEERING ====================

def extract_features(game):
    """
    Extract ML features from a game dict.
    
    Expected game dict keys:
      - awayRsG, homeRsG: runs scored per game
      - awayRaG, homeRaG: runs allowed per game
      - awayW, awayL, homeW, homeL: W/L record
      - awayEra, homeEra: team ERA
      - awayFip, homeFip: team FIP
      - awayWhip, homeWhip: team WHIP
      - awayOps, homeOps: team OPS
      - awayBullpenEra, homeBullpenEra: bullpen ERA
      - awayK9, homeK9: strikeouts per 9
      - parkFactor: park run multiplier
      - awayPitcherRating, homePitcherRating: starter ratings (0-100)
      - awayPitcherEra, homePitcherEra: starter ERA
      - awayPitcherFip, homePitcherFip: starter FIP
      - awayPitcherHand, homePitcherHand: L or R
      - awayRollingAdj, homeRollingAdj: rolling stats adjustment
      - awayInjuryAdj, homeInjuryAdj: injury impact
      
    Returns feature dict.
    """
    features = {}
    
    # ---- Run-based features ----
    awayRsG = game.get('awayRsG', 4.4)
    homeRsG = game.get('homeRsG', 4.4)
    awayRaG = game.get('awayRaG', 4.4)
    homeRaG = game.get('homeRaG', 4.4)
    
    features['run_diff_away'] = awayRsG - awayRaG
    features['run_diff_home'] = homeRsG - homeRaG
    features['run_diff_delta'] = features['run_diff_home'] - features['run_diff_away']
    
    # Pythagorean win expectation
    pyth_exp = 1.83
    away_pyth = awayRsG**pyth_exp / (awayRsG**pyth_exp + awayRaG**pyth_exp) if awayRaG > 0 else 0.5
    home_pyth = homeRsG**pyth_exp / (homeRsG**pyth_exp + homeRaG**pyth_exp) if homeRaG > 0 else 0.5
    features['pyth_away'] = away_pyth
    features['pyth_home'] = home_pyth
    features['pyth_delta'] = home_pyth - away_pyth
    
    # Log5 win probability
    if away_pyth + home_pyth > 0 and away_pyth + home_pyth < 2:
        log5 = (away_pyth - away_pyth * home_pyth) / (away_pyth + home_pyth - 2 * away_pyth * home_pyth)
        features['log5_away'] = log5
    else:
        features['log5_away'] = 0.5
    
    # Actual W/L record-based features
    awayW = game.get('awayW', 81)
    awayL = game.get('awayL', 81)
    homeW = game.get('homeW', 81)
    homeL = game.get('homeL', 81)
    
    away_wpct = awayW / max(1, awayW + awayL)
    home_wpct = homeW / max(1, homeW + homeL)
    features['wpct_away'] = away_wpct
    features['wpct_home'] = home_wpct
    features['wpct_delta'] = home_wpct - away_wpct
    
    # Luck factor (actual - pythagorean)
    features['luck_away'] = away_wpct - away_pyth
    features['luck_home'] = home_wpct - home_pyth
    features['luck_delta'] = features['luck_home'] - features['luck_away']
    
    # ---- Pitching features ----
    lg_era = 4.10
    lg_fip = 4.05
    lg_whip = 1.28
    
    awayEra = game.get('awayEra', lg_era)
    homeEra = game.get('homeEra', lg_era)
    awayFip = game.get('awayFip', lg_fip)
    homeFip = game.get('homeFip', lg_fip)
    awayWhip = game.get('awayWhip', lg_whip)
    homeWhip = game.get('homeWhip', lg_whip)
    
    features['era_delta'] = awayEra - homeEra  # positive = home pitching better
    features['fip_delta'] = awayFip - homeFip
    features['whip_delta'] = awayWhip - homeWhip
    
    # Pitching composite: combine ERA, FIP, WHIP into single score
    away_pitch = (lg_era - awayEra) * 0.3 + (lg_fip - awayFip) * 0.4 + (lg_whip - awayWhip) * 8 * 0.3
    home_pitch = (lg_era - homeEra) * 0.3 + (lg_fip - homeFip) * 0.4 + (lg_whip - homeWhip) * 8 * 0.3
    features['pitch_score_away'] = away_pitch
    features['pitch_score_home'] = home_pitch
    features['pitch_score_delta'] = home_pitch - away_pitch
    
    # ---- Offense features ----
    awayOps = game.get('awayOps', 0.730)
    homeOps = game.get('homeOps', 0.730)
    features['ops_delta'] = homeOps - awayOps
    features['scoring_power_away'] = awayRsG * (awayOps / 0.730)
    features['scoring_power_home'] = homeRsG * (homeOps / 0.730)
    features['scoring_power_delta'] = features['scoring_power_home'] - features['scoring_power_away']
    
    # ---- Bullpen features ----
    awayBullpen = game.get('awayBullpenEra', lg_era)
    homeBullpen = game.get('homeBullpenEra', lg_era)
    features['bullpen_delta'] = awayBullpen - homeBullpen  # positive = home bullpen better
    
    # ---- K/9 features ----
    awayK9 = game.get('awayK9', 8.6)
    homeK9 = game.get('homeK9', 8.6)
    features['k9_delta'] = homeK9 - awayK9
    
    # ---- Park factor ----
    pf = game.get('parkFactor', 1.0)
    features['park_factor'] = pf
    features['park_extreme'] = abs(pf - 1.0)  # how extreme the park is
    
    # ---- Starting pitcher features ----
    awayPRating = game.get('awayPitcherRating', 50)
    homePRating = game.get('homePitcherRating', 50)
    features['pitcher_rating_delta'] = homePRating - awayPRating
    features['pitcher_rating_away'] = awayPRating
    features['pitcher_rating_home'] = homePRating
    
    awayPEra = game.get('awayPitcherEra', lg_era)
    homePEra = game.get('homePitcherEra', lg_era)
    features['pitcher_era_delta'] = awayPEra - homePEra  # positive = home starter better
    
    awayPFip = game.get('awayPitcherFip', lg_fip)
    homePFip = game.get('homePitcherFip', lg_fip)
    features['pitcher_fip_delta'] = awayPFip - homePFip
    
    # Pitcher quality composite (predictive blend)
    away_p_quality = awayPFip * 0.45 + awayPEra * 0.25 + (awayPRating / 100 * lg_fip * 2 if awayPRating else lg_fip) * 0.30
    home_p_quality = homePFip * 0.45 + homePEra * 0.25 + (homePRating / 100 * lg_fip * 2 if homePRating else lg_fip) * 0.30
    features['pitcher_quality_delta'] = away_p_quality - home_p_quality
    
    # Ace matchup indicator
    features['is_ace_matchup'] = 1 if (awayPRating >= 75 and homePRating >= 75) else 0
    features['has_ace'] = 1 if (awayPRating >= 80 or homePRating >= 80) else 0
    features['ace_side'] = 1 if homePRating >= 80 else (-1 if awayPRating >= 80 else 0)
    
    # Pitcher handedness matchup
    awayHand = game.get('awayPitcherHand', 'R')
    homeHand = game.get('homePitcherHand', 'R')
    features['away_pitcher_lhp'] = 1 if awayHand == 'L' else 0
    features['home_pitcher_lhp'] = 1 if homeHand == 'L' else 0
    
    # ---- Rolling stats / form features ----
    awayRollAdj = game.get('awayRollingAdj', 0)
    homeRollAdj = game.get('homeRollingAdj', 0)
    features['rolling_adj_delta'] = homeRollAdj - awayRollAdj
    features['rolling_adj_away'] = awayRollAdj
    features['rolling_adj_home'] = homeRollAdj
    
    # ---- Injury features ----
    awayInjAdj = game.get('awayInjuryAdj', 0)
    homeInjAdj = game.get('homeInjuryAdj', 0)
    features['injury_adj_delta'] = homeInjAdj - awayInjAdj
    
    # ---- Interaction features (non-linear signal) ----
    features['pyth_x_pitcher'] = features['pyth_delta'] * features['pitcher_rating_delta'] / 50
    features['run_diff_x_park'] = features['run_diff_delta'] * pf
    features['offense_x_pitcher'] = features['scoring_power_delta'] * features['pitcher_quality_delta']
    
    # ---- Expected runs (for totals model) ----
    # Away expected = away offense quality * home pitching quality * park
    away_exp = awayRsG * (homeRaG / 4.4) * pf
    home_exp = homeRsG * (awayRaG / 4.4) * pf
    features['away_exp_runs'] = away_exp
    features['home_exp_runs'] = home_exp
    features['total_exp_runs'] = away_exp + home_exp
    
    return features


def features_to_array(features, feature_names):
    """Convert feature dict to numpy array in consistent order."""
    return np.array([features.get(f, 0) for f in feature_names])


# ==================== MODEL TRAINING ====================

FEATURE_NAMES = [
    'run_diff_delta', 'pyth_delta', 'log5_away', 'wpct_delta', 'luck_delta',
    'era_delta', 'fip_delta', 'whip_delta', 'pitch_score_delta',
    'ops_delta', 'scoring_power_delta', 'bullpen_delta', 'k9_delta',
    'park_factor', 'park_extreme',
    'pitcher_rating_delta', 'pitcher_era_delta', 'pitcher_fip_delta',
    'pitcher_quality_delta', 'is_ace_matchup', 'has_ace', 'ace_side',
    'away_pitcher_lhp', 'home_pitcher_lhp',
    'rolling_adj_delta', 'injury_adj_delta',
    'pyth_x_pitcher', 'run_diff_x_park', 'offense_x_pitcher',
]

TOTALS_FEATURE_NAMES = [
    'away_exp_runs', 'home_exp_runs', 'total_exp_runs',
    'park_factor', 'park_extreme',
    'pitch_score_away', 'pitch_score_home',
    'scoring_power_away', 'scoring_power_home',
    'bullpen_delta', 'k9_delta',
    'pitcher_era_delta', 'pitcher_fip_delta',
    'pitcher_rating_away', 'pitcher_rating_home',
    'away_pitcher_lhp', 'home_pitcher_lhp',
    'rolling_adj_away', 'rolling_adj_home',
    'is_ace_matchup',
]


def train_model(games_data, sport='mlb'):
    """
    Train ML ensemble from historical game data.
    
    Each game in games_data should have features + result (homeWon: bool).
    Returns trained model + metrics.
    """
    if not games_data:
        return {'error': 'No training data provided'}
    
    # Extract features and labels
    X_list = []
    y_list = []
    totals_X = []
    totals_y = []
    
    for game in games_data:
        features = extract_features(game)
        X_list.append(features_to_array(features, FEATURE_NAMES))
        y_list.append(1 if game.get('homeWon', False) else 0)
        
        # Totals data
        actual_total = game.get('actualTotal')
        book_total = game.get('bookTotal')
        if actual_total is not None and book_total is not None:
            totals_X.append(features_to_array(features, TOTALS_FEATURE_NAMES))
            totals_y.append(actual_total)
    
    X = np.array(X_list)
    y = np.array(y_list)
    
    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # ----- Moneyline Model: Ensemble -----
    # 1. Logistic Regression (calibrated, interpretable baseline)
    lr = LogisticRegression(
        C=0.5,  # moderate regularization  
        max_iter=1000,
        solver='lbfgs',
        class_weight='balanced'
    )
    
    # 2. Gradient Boosting (captures non-linear interactions)
    gb = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=3,
        learning_rate=0.05,
        min_samples_leaf=5,
        subsample=0.8,
        random_state=42
    )
    
    # 3. Random Forest (robust, handles noise)
    rf = RandomForestClassifier(
        n_estimators=200,
        max_depth=5,
        min_samples_leaf=3,
        class_weight='balanced',
        random_state=42
    )
    
    # Train all models with calibration
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    
    # Cross-validated accuracy
    lr_scores = cross_val_score(lr, X_scaled, y, cv=cv, scoring='accuracy')
    gb_scores = cross_val_score(gb, X_scaled, y, cv=cv, scoring='accuracy')
    rf_scores = cross_val_score(rf, X_scaled, y, cv=cv, scoring='accuracy')
    
    # Train calibrated versions on full data
    lr_cal = CalibratedClassifierCV(lr, cv=5, method='isotonic')
    gb_cal = CalibratedClassifierCV(gb, cv=5, method='isotonic')
    rf_cal = CalibratedClassifierCV(rf, cv=5, method='isotonic')
    
    lr_cal.fit(X_scaled, y)
    gb_cal.fit(X_scaled, y)
    rf_cal.fit(X_scaled, y)
    
    # Also train raw models for feature importance
    lr.fit(X_scaled, y)
    gb.fit(X_scaled, y)
    rf.fit(X_scaled, y)
    
    # Feature importance from gradient boosting
    gb_importance = dict(zip(FEATURE_NAMES, gb.feature_importances_))
    rf_importance = dict(zip(FEATURE_NAMES, rf.feature_importances_))
    
    # LR coefficients (useful for understanding direction)
    lr_coefs = dict(zip(FEATURE_NAMES, lr.coef_[0]))
    
    # Calibration check: predict on training data
    lr_probs = lr_cal.predict_proba(X_scaled)[:, 1]
    gb_probs = gb_cal.predict_proba(X_scaled)[:, 1]
    rf_probs = rf_cal.predict_proba(X_scaled)[:, 1]
    
    # Ensemble: weight by CV accuracy
    total_acc = lr_scores.mean() + gb_scores.mean() + rf_scores.mean()
    lr_weight = lr_scores.mean() / total_acc
    gb_weight = gb_scores.mean() / total_acc
    rf_weight = rf_scores.mean() / total_acc
    
    ensemble_probs = lr_probs * lr_weight + gb_probs * gb_weight + rf_probs * rf_weight
    
    # Clip to [0, 1] to avoid floating-point issues
    ensemble_probs = np.clip(ensemble_probs, 0, 1)
    
    # Metrics
    ensemble_acc = accuracy_score(y, (ensemble_probs > 0.5).astype(int))
    ensemble_brier = brier_score_loss(y, ensemble_probs)
    ensemble_logloss = log_loss(y, ensemble_probs)
    
    # Calibration buckets
    calibration = []
    for low in np.arange(0.3, 0.8, 0.1):
        high = low + 0.1
        mask = (ensemble_probs >= low) & (ensemble_probs < high)
        if mask.sum() > 0:
            calibration.append({
                'bucket': f'{low:.1f}-{high:.1f}',
                'predicted': float(ensemble_probs[mask].mean()),
                'actual': float(y[mask].mean()),
                'count': int(mask.sum())
            })
    
    # ----- Totals Model (regression) -----
    totals_model = None
    totals_metrics = None
    if len(totals_X) > 20:
        totals_X_arr = np.array(totals_X)
        totals_y_arr = np.array(totals_y)
        totals_scaler = StandardScaler()
        totals_X_scaled = totals_scaler.fit_transform(totals_X_arr)
        
        from sklearn.ensemble import GradientBoostingRegressor
        totals_gb = GradientBoostingRegressor(
            n_estimators=150,
            max_depth=3,
            learning_rate=0.05,
            min_samples_leaf=5,
            random_state=42
        )
        totals_gb.fit(totals_X_scaled, totals_y_arr)
        
        totals_pred = totals_gb.predict(totals_X_scaled)
        totals_mae = float(np.mean(np.abs(totals_pred - totals_y_arr)))
        totals_rmse = float(np.sqrt(np.mean((totals_pred - totals_y_arr) ** 2)))
        
        totals_model = {
            'model': totals_gb,
            'scaler': totals_scaler,
        }
        totals_metrics = {
            'mae': round(totals_mae, 3),
            'rmse': round(totals_rmse, 3),
            'games': len(totals_y_arr),
        }
    
    # Save models
    model_data = {
        'sport': sport,
        'lr_cal': lr_cal,
        'gb_cal': gb_cal,
        'rf_cal': rf_cal,
        'scaler': scaler,
        'weights': {'lr': lr_weight, 'gb': gb_weight, 'rf': rf_weight},
        'feature_names': FEATURE_NAMES,
        'totals_model': totals_model,
        'totals_feature_names': TOTALS_FEATURE_NAMES,
    }
    
    model_path = MODEL_DIR / f'{sport}_ensemble.pkl'
    with open(model_path, 'wb') as f:
        pickle.dump(model_data, f)
    
    # Top features
    combined_importance = {}
    for feat in FEATURE_NAMES:
        combined_importance[feat] = (
            gb_importance.get(feat, 0) * 0.5 + 
            rf_importance.get(feat, 0) * 0.3 +
            abs(lr_coefs.get(feat, 0)) * 0.2
        )
    top_features = sorted(combined_importance.items(), key=lambda x: x[1], reverse=True)[:15]
    
    return {
        'status': 'trained',
        'sport': sport,
        'games': len(y),
        'homeWinRate': float(y.mean()),
        'models': {
            'logistic_regression': {
                'cv_accuracy': round(float(lr_scores.mean()), 4),
                'cv_std': round(float(lr_scores.std()), 4),
                'weight': round(lr_weight, 3),
            },
            'gradient_boosting': {
                'cv_accuracy': round(float(gb_scores.mean()), 4),
                'cv_std': round(float(gb_scores.std()), 4),
                'weight': round(gb_weight, 3),
            },
            'random_forest': {
                'cv_accuracy': round(float(rf_scores.mean()), 4),
                'cv_std': round(float(rf_scores.std()), 4),
                'weight': round(rf_weight, 3),
            },
        },
        'ensemble': {
            'accuracy': round(ensemble_acc, 4),
            'brier_score': round(float(ensemble_brier), 4),
            'log_loss': round(float(ensemble_logloss), 4),
        },
        'calibration': calibration,
        'top_features': [{'feature': f, 'importance': round(v, 4)} for f, v in top_features],
        'lr_coefficients': {k: round(v, 4) for k, v in sorted(lr_coefs.items(), key=lambda x: abs(x[1]), reverse=True)[:10]},
        'totals': totals_metrics,
        'model_path': str(model_path),
    }


# ==================== PREDICTION ====================

def load_model(sport='mlb'):
    """Load trained model from disk."""
    model_path = MODEL_DIR / f'{sport}_ensemble.pkl'
    if not model_path.exists():
        return None
    with open(model_path, 'rb') as f:
        return pickle.load(f)


def predict_games(games, sport='mlb'):
    """
    Predict outcomes for a list of games.
    Returns calibrated probabilities from the ensemble.
    """
    model_data = load_model(sport)
    if not model_data:
        return {'error': f'No trained model for {sport}. Run train first.'}
    
    results = []
    for game in games:
        features = extract_features(game)
        X = features_to_array(features, model_data['feature_names']).reshape(1, -1)
        X_scaled = model_data['scaler'].transform(X)
        
        # Get probabilities from each model
        lr_prob = model_data['lr_cal'].predict_proba(X_scaled)[0][1]
        gb_prob = model_data['gb_cal'].predict_proba(X_scaled)[0][1]
        rf_prob = model_data['rf_cal'].predict_proba(X_scaled)[0][1]
        
        weights = model_data['weights']
        ensemble_prob = lr_prob * weights['lr'] + gb_prob * weights['gb'] + rf_prob * weights['rf']
        
        # Ensure probabilities are in reasonable range
        ensemble_prob = max(0.10, min(0.90, ensemble_prob))
        
        away_abbr = game.get('away', '???')
        home_abbr = game.get('home', '???')
        
        result = {
            'away': away_abbr,
            'home': home_abbr,
            'homeWinProb': round(float(ensemble_prob), 4),
            'awayWinProb': round(1 - float(ensemble_prob), 4),
            'homeML': prob_to_ml(ensemble_prob),
            'awayML': prob_to_ml(1 - ensemble_prob),
            'models': {
                'lr': round(float(lr_prob), 4),
                'gb': round(float(gb_prob), 4),
                'rf': round(float(rf_prob), 4),
            },
            'confidence': get_confidence(ensemble_prob),
            'modelAgreement': round(1 - float(np.std([lr_prob, gb_prob, rf_prob])) * 3, 3),
        }
        
        # Totals prediction if model available
        totals_model = model_data.get('totals_model')
        if totals_model and totals_model.get('model'):
            totals_features = features_to_array(features, model_data['totals_feature_names']).reshape(1, -1)
            totals_X_scaled = totals_model['scaler'].transform(totals_features)
            predicted_total = float(totals_model['model'].predict(totals_X_scaled)[0])
            result['predictedTotal'] = round(predicted_total, 1)
        
        results.append(result)
    
    return {'predictions': results}


# ==================== BACKTEST ====================

def run_backtest(games_data, sport='mlb'):
    """
    Full backtest with betting simulation.
    Uses leave-one-out or rolling window to avoid look-ahead bias.
    """
    if len(games_data) < 30:
        return {'error': 'Need at least 30 games for backtest'}
    
    # Extract all features
    all_features = []
    all_labels = []
    all_closing_ml = []
    all_games = []
    
    for game in games_data:
        features = extract_features(game)
        X = features_to_array(features, FEATURE_NAMES)
        all_features.append(X)
        all_labels.append(1 if game.get('homeWon', False) else 0)
        all_closing_ml.append(game.get('closingHomeML', -110))
        all_games.append(game)
    
    X = np.array(all_features)
    y = np.array(all_labels)
    
    # Rolling window backtest (train on first N, predict next batch)
    # This simulates real-world usage where you only have past data
    window_size = max(50, len(X) // 3)
    step_size = 10
    
    predictions = [None] * len(X)
    
    scaler = StandardScaler()
    
    for start_test in range(window_size, len(X), step_size):
        end_test = min(start_test + step_size, len(X))
        
        X_train = X[:start_test]
        y_train = y[:start_test]
        X_test = X[start_test:end_test]
        
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Quick ensemble
        lr = LogisticRegression(C=0.5, max_iter=500)
        gb = GradientBoostingClassifier(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42)
        
        lr.fit(X_train_scaled, y_train)
        gb.fit(X_train_scaled, y_train)
        
        lr_probs = lr.predict_proba(X_test_scaled)[:, 1]
        gb_probs = gb.predict_proba(X_test_scaled)[:, 1]
        
        # Blend: 40% LR, 60% GB (GB handles interactions better)
        ensemble_probs = lr_probs * 0.40 + gb_probs * 0.60
        
        for i, prob in enumerate(ensemble_probs):
            idx = start_test + i
            if idx < len(predictions):
                predictions[idx] = float(max(0.10, min(0.90, prob)))
    
    # Simulate betting
    bets = 0
    wins = 0
    losses = 0
    wagered = 0
    profit = 0
    profit_curve = []
    edge_tiers = {
        '2-5%': {'bets': 0, 'wins': 0, 'profit': 0},
        '5-10%': {'bets': 0, 'wins': 0, 'profit': 0},
        '10%+': {'bets': 0, 'wins': 0, 'profit': 0},
    }
    
    for i, pred in enumerate(predictions):
        if pred is None:
            continue
        
        home_prob = pred
        away_prob = 1 - pred
        home_won = y[i] == 1
        closing_ml = all_closing_ml[i]
        
        book_home_prob = ml_to_prob(closing_ml)
        book_away_prob = 1 - book_home_prob
        
        closing_away_ml = -round(100 * closing_ml / 100) if closing_ml > 0 else round(100 * 100 / (-closing_ml))
        
        home_edge = home_prob - book_home_prob
        away_edge = away_prob - book_away_prob
        
        bet_side = None
        bet_edge = 0
        bet_ml = 0
        
        if home_edge > 0.02 and home_edge >= away_edge:
            bet_side = 'home'
            bet_edge = home_edge
            bet_ml = closing_ml
        elif away_edge > 0.02:
            bet_side = 'away'
            bet_edge = away_edge
            bet_ml = closing_away_ml
        
        if bet_side:
            bets += 1
            bet_won = (bet_side == 'home' and home_won) or (bet_side == 'away' and not home_won)
            payout = bet_ml if bet_ml > 0 else 10000 / (-bet_ml)
            bet_profit = payout if bet_won else -100
            
            wagered += 100
            profit += bet_profit
            if bet_won:
                wins += 1
            else:
                losses += 1
            
            tier = '10%+' if bet_edge >= 0.10 else ('5-10%' if bet_edge >= 0.05 else '2-5%')
            edge_tiers[tier]['bets'] += 1
            if bet_won:
                edge_tiers[tier]['wins'] += 1
            edge_tiers[tier]['profit'] += bet_profit
            
            profit_curve.append({'bet': bets, 'profit': round(profit, 0)})
    
    roi = (profit / wagered * 100) if wagered > 0 else 0
    win_rate = (wins / bets * 100) if bets > 0 else 0
    
    # Calibration for predicted games
    valid_preds = [(predictions[i], y[i]) for i in range(len(predictions)) if predictions[i] is not None]
    pred_arr = np.array([p[0] for p in valid_preds])
    actual_arr = np.array([p[1] for p in valid_preds])
    
    overall_accuracy = accuracy_score(actual_arr, (pred_arr > 0.5).astype(int))
    brier = brier_score_loss(actual_arr, pred_arr)
    
    return {
        'sport': sport,
        'method': 'rolling_window',
        'windowSize': window_size,
        'totalGames': len(games_data),
        'predictedGames': len(valid_preds),
        'accuracy': round(float(overall_accuracy), 4),
        'brierScore': round(float(brier), 4),
        'totalBets': bets,
        'wins': wins,
        'losses': losses,
        'winRate': round(win_rate, 1),
        'wagered': wagered,
        'profit': round(profit, 0),
        'roi': round(roi, 1),
        'edgeTiers': [
            {'tier': k, 'bets': v['bets'], 'wins': v['wins'],
             'winRate': round(v['wins'] / v['bets'] * 100, 1) if v['bets'] > 0 else 0,
             'profit': round(v['profit'], 0),
             'roi': round(v['profit'] / (v['bets'] * 100) * 100, 1) if v['bets'] > 0 else 0}
            for k, v in edge_tiers.items()
        ],
        'profitCurve': profit_curve,
    }


# ==================== HELPERS ====================

def prob_to_ml(prob):
    """Convert probability to American moneyline."""
    prob = max(0.01, min(0.99, prob))
    if prob >= 0.5:
        return int(round(-100 * prob / (1 - prob)))
    return int(round(100 * (1 - prob) / prob))


def ml_to_prob(ml):
    """Convert American moneyline to implied probability."""
    if ml < 0:
        return (-ml) / (-ml + 100)
    return 100 / (ml + 100)


def get_confidence(prob):
    """Classify prediction confidence."""
    spread = abs(prob - 0.5)
    if spread > 0.20:
        return 'HIGH'
    elif spread > 0.10:
        return 'MEDIUM'
    else:
        return 'LOW'


# ==================== MAIN ====================

def main():
    """Read JSON from stdin, execute requested mode, output JSON."""
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({'error': f'Invalid JSON input: {str(e)}'}))
        sys.exit(1)
    
    mode = input_data.get('mode', 'predict')
    sport = input_data.get('sport', 'mlb')
    
    if mode == 'train':
        result = train_model(input_data.get('data', []), sport)
    elif mode == 'predict':
        result = predict_games(input_data.get('games', []), sport)
    elif mode == 'backtest':
        result = run_backtest(input_data.get('data', []), sport)
    elif mode == 'status':
        model = load_model(sport)
        if model:
            result = {
                'status': 'ready',
                'sport': sport,
                'features': model['feature_names'],
                'weights': model['weights'],
                'hasTotals': model.get('totals_model') is not None,
            }
        else:
            result = {'status': 'no_model', 'sport': sport}
    else:
        result = {'error': f'Unknown mode: {mode}'}
    
    print(json.dumps(result))


if __name__ == '__main__':
    main()
