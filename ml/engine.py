"""
SportsSim ML Engine v1.0
========================
Ensemble ML models for sports betting predictions.
Trains on historical game data, produces calibrated win probabilities.

Models:
- XGBoost gradient boosting
- LightGBM gradient boosting  
- Logistic Regression (baseline)
- Stacking ensemble (meta-learner on top)

Features extracted per game:
- Power ratings (Pythagorean)
- Point differential
- Recent form (L10 momentum)
- Luck factor (actual vs expected W%)
- Rest/travel adjustments
- Injury impact scores
- Historical H2H performance
- Home/away splits

Serves predictions via HTTP API on port 5050.
"""

import json
import os
import sys
import pickle
import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import StackingClassifier, VotingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import cross_val_score, TimeSeriesSplit
from sklearn.metrics import brier_score_loss, log_loss, accuracy_score
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import lightgbm as lgb

logging.basicConfig(level=logging.INFO, format='%(asctime)s [ML] %(message)s')
logger = logging.getLogger('sportssim-ml')

MODEL_DIR = Path(__file__).parent / 'models_trained'
MODEL_DIR.mkdir(exist_ok=True)

# ==================== FEATURE ENGINEERING ====================

NBA_PYTH_EXP = 13.91
MLB_PYTH_EXP = 1.83
NHL_PYTH_EXP = 2.05

def pyth_win_pct(pf, pa, exp):
    """Pythagorean win expectation"""
    pf_exp = pf ** exp
    pa_exp = pa ** exp
    if pf_exp + pa_exp == 0:
        return 0.5
    return pf_exp / (pf_exp + pa_exp)

def parse_l10(l10_str):
    """Parse L10 record string like '7-3' to win fraction"""
    if not l10_str or not isinstance(l10_str, str):
        return 0.5
    parts = l10_str.split('-')
    if len(parts) != 2:
        return 0.5
    try:
        w, l = int(parts[0]), int(parts[1])
        return w / (w + l) if (w + l) > 0 else 0.5
    except ValueError:
        return 0.5

def extract_nba_features(game_data):
    """
    Extract feature vector for an NBA game.
    
    game_data should contain:
    - away_team: dict with {ppg, oppg, w, l, l10, diff}
    - home_team: dict with {ppg, oppg, w, l, l10, diff}
    - away_b2b: bool
    - home_b2b: bool
    - away_rolling: dict (optional) with {adjFactor, trend}
    - home_rolling: dict (optional) with {adjFactor, trend}
    - away_injury_adj: float (optional)
    - home_injury_adj: float (optional)
    """
    away = game_data.get('away_team', {})
    home = game_data.get('home_team', {})
    
    # Basic stats
    away_ppg = away.get('ppg', 110)
    away_oppg = away.get('oppg', 110)
    home_ppg = home.get('ppg', 110)
    home_oppg = home.get('oppg', 110)
    
    away_w = away.get('w', 41)
    away_l = away.get('l', 41)
    home_w = home.get('w', 41)
    home_l = home.get('l', 41)
    
    away_gp = away_w + away_l or 1
    home_gp = home_w + home_l or 1
    
    # Pythagorean
    away_pyth = pyth_win_pct(away_ppg, away_oppg, NBA_PYTH_EXP)
    home_pyth = pyth_win_pct(home_ppg, home_oppg, NBA_PYTH_EXP)
    
    # Luck
    away_actual_wpct = away_w / away_gp
    home_actual_wpct = home_w / home_gp
    away_luck = away_actual_wpct - away_pyth
    home_luck = home_actual_wpct - home_pyth
    
    # Point differential
    away_diff = away.get('diff', away_ppg - away_oppg)
    home_diff = home.get('diff', home_ppg - home_oppg)
    
    # L10 momentum
    away_l10 = parse_l10(away.get('l10', '5-5'))
    home_l10 = parse_l10(home.get('l10', '5-5'))
    
    # Rolling stats adjustments
    away_rolling_adj = game_data.get('away_rolling', {}).get('adjFactor', 0)
    home_rolling_adj = game_data.get('home_rolling', {}).get('adjFactor', 0)
    
    # Injury adjustments
    away_injury_adj = game_data.get('away_injury_adj', 0)
    home_injury_adj = game_data.get('home_injury_adj', 0)
    
    # Rest
    away_b2b = 1 if game_data.get('away_b2b', False) else 0
    home_b2b = 1 if game_data.get('home_b2b', False) else 0
    
    features = {
        # Power metrics (differentials)
        'diff_diff': away_diff - home_diff,                    # raw point diff gap
        'pyth_diff': away_pyth - home_pyth,                    # pythagorean gap
        'luck_diff': away_luck - home_luck,                    # luck gap
        'wpct_diff': away_actual_wpct - home_actual_wpct,      # actual W% gap
        
        # Team strengths
        'away_off': away_ppg,
        'away_def': away_oppg,
        'home_off': home_ppg,
        'home_def': home_oppg,
        'away_net': away_diff,
        'home_net': home_diff,
        
        # Efficiency matchups
        'off_vs_def_away': away_ppg - home_oppg,   # away offense vs home defense
        'off_vs_def_home': home_ppg - away_oppg,   # home offense vs away defense
        
        # Form & momentum
        'l10_diff': away_l10 - home_l10,
        'away_l10_wpct': away_l10,
        'home_l10_wpct': home_l10,
        'rolling_adj_diff': away_rolling_adj - home_rolling_adj,
        
        # Injury impact
        'injury_adj_diff': away_injury_adj - home_injury_adj,
        
        # Situational
        'away_b2b': away_b2b,
        'home_b2b': home_b2b,
        'rest_diff': home_b2b - away_b2b,    # positive = home more rested
        
        # Advanced
        'pyth_away': away_pyth,
        'pyth_home': home_pyth,
        'away_wpct': away_actual_wpct,
        'home_wpct': home_actual_wpct,
        
        # Pace proxy
        'combined_ppg': (away_ppg + home_ppg) / 2,
        'pace_diff': (away_ppg + away_oppg) - (home_ppg + home_oppg),
    }
    
    return features

def extract_mlb_features(game_data):
    """
    Extract feature vector for an MLB game.
    
    Includes pitcher matchup data, park factors, weather.
    """
    away = game_data.get('away_team', {})
    home = game_data.get('home_team', {})
    
    # Run scoring
    away_rsg = away.get('rsG', 4.5)
    away_rag = away.get('raG', 4.5)
    home_rsg = home.get('rsG', 4.5)
    home_rag = home.get('raG', 4.5)
    
    away_w = away.get('w', 81)
    away_l = away.get('l', 81)
    home_w = home.get('w', 81)
    home_l = home.get('l', 81)
    
    away_gp = away_w + away_l or 1
    home_gp = home_w + home_l or 1
    
    # Pythagorean
    away_pyth = pyth_win_pct(away_rsg, away_rag, MLB_PYTH_EXP)
    home_pyth = pyth_win_pct(home_rsg, home_rag, MLB_PYTH_EXP)
    
    # Luck
    away_luck = (away_w / away_gp) - away_pyth
    home_luck = (home_w / home_gp) - home_pyth
    
    # Pitcher data
    away_pitcher = game_data.get('away_pitcher', {})
    home_pitcher = game_data.get('home_pitcher', {})
    
    away_pitcher_rating = away_pitcher.get('compositeRating', 50)
    home_pitcher_rating = home_pitcher.get('compositeRating', 50)
    away_pitcher_era = away_pitcher.get('era', 4.50)
    home_pitcher_era = home_pitcher.get('era', 4.50)
    away_pitcher_whip = away_pitcher.get('whip', 1.30)
    home_pitcher_whip = home_pitcher.get('whip', 1.30)
    away_pitcher_k9 = away_pitcher.get('k9', 8.0)
    home_pitcher_k9 = home_pitcher.get('k9', 8.0)
    
    # Park factor
    park_factor = game_data.get('park_factor', 1.0)
    
    # Weather
    weather_mult = game_data.get('weather_multiplier', 1.0)
    
    # L10
    away_l10 = parse_l10(away.get('l10', '5-5'))
    home_l10 = parse_l10(home.get('l10', '5-5'))
    
    # Rolling & injury
    away_rolling_adj = game_data.get('away_rolling_adj', 0)
    home_rolling_adj = game_data.get('home_rolling_adj', 0)
    away_injury_adj = game_data.get('away_injury_adj', 0)
    home_injury_adj = game_data.get('home_injury_adj', 0)
    
    # Team advanced stats
    away_ops = away.get('ops', .720)
    home_ops = home.get('ops', .720)
    away_era = away.get('era', 4.00)
    home_era = home.get('era', 4.00)
    away_bullpen_era = away.get('bullpenEra', 3.70)
    home_bullpen_era = home.get('bullpenEra', 3.70)
    
    features = {
        # Run differentials
        'run_diff_diff': (away_rsg - away_rag) - (home_rsg - home_rag),
        'pyth_diff': away_pyth - home_pyth,
        'luck_diff': away_luck - home_luck,
        
        # Pitching matchup (KEY for MLB)
        'pitcher_rating_diff': away_pitcher_rating - home_pitcher_rating,
        'pitcher_era_diff': away_pitcher_era - home_pitcher_era,
        'pitcher_whip_diff': away_pitcher_whip - home_pitcher_whip,
        'pitcher_k9_diff': away_pitcher_k9 - home_pitcher_k9,
        'away_pitcher_rating': away_pitcher_rating,
        'home_pitcher_rating': home_pitcher_rating,
        
        # Team offense vs opposing pitcher
        'away_off_vs_pitcher': away_rsg - home_pitcher_era,
        'home_off_vs_pitcher': home_rsg - away_pitcher_era,
        
        # Bullpen
        'bullpen_diff': away_bullpen_era - home_bullpen_era,
        
        # Advanced batting
        'ops_diff': away_ops - home_ops,
        
        # Park & weather
        'park_factor': park_factor,
        'weather_multiplier': weather_mult,
        
        # Form
        'l10_diff': away_l10 - home_l10,
        'rolling_adj_diff': away_rolling_adj - home_rolling_adj,
        'injury_adj_diff': away_injury_adj - home_injury_adj,
        
        # Raw team strengths
        'away_rsg': away_rsg,
        'home_rsg': home_rsg,
        'away_rag': away_rag,
        'home_rag': home_rag,
        'away_pyth': away_pyth,
        'home_pyth': home_pyth,
        'combined_runs': (away_rsg + home_rsg) / 2,
    }
    
    return features


def extract_nhl_features(game_data):
    """Extract feature vector for an NHL game."""
    away = game_data.get('away_team', {})
    home = game_data.get('home_team', {})
    
    away_gfg = away.get('gfG', 3.0)
    away_gag = away.get('gaG', 3.0)
    home_gfg = home.get('gfG', 3.0)
    home_gag = home.get('gaG', 3.0)
    
    away_w = away.get('w', 41)
    away_l = away.get('l', 41)
    home_w = home.get('w', 41)
    home_l = home.get('l', 41)
    
    away_gp = away_w + away_l or 1
    home_gp = home_w + home_l or 1
    
    away_pyth = pyth_win_pct(away_gfg, away_gag, NHL_PYTH_EXP)
    home_pyth = pyth_win_pct(home_gfg, home_gag, NHL_PYTH_EXP)
    
    away_luck = (away_w / away_gp) - away_pyth
    home_luck = (home_w / home_gp) - home_pyth
    
    away_l10 = parse_l10(away.get('l10', '5-5'))
    home_l10 = parse_l10(home.get('l10', '5-5'))
    
    # Goalie
    away_goalie = game_data.get('away_goalie_sv_pct', 0.910)
    home_goalie = game_data.get('home_goalie_sv_pct', 0.910)
    
    features = {
        'goal_diff_diff': (away_gfg - away_gag) - (home_gfg - home_gag),
        'pyth_diff': away_pyth - home_pyth,
        'luck_diff': away_luck - home_luck,
        
        'away_off': away_gfg,
        'home_off': home_gfg,
        'away_def': away_gag,
        'home_def': home_gag,
        
        'off_vs_def_away': away_gfg - home_gag,
        'off_vs_def_home': home_gfg - away_gag,
        
        'goalie_diff': away_goalie - home_goalie,
        
        'l10_diff': away_l10 - home_l10,
        'rolling_adj_diff': game_data.get('away_rolling_adj', 0) - game_data.get('home_rolling_adj', 0),
        'injury_adj_diff': game_data.get('away_injury_adj', 0) - game_data.get('home_injury_adj', 0),
        
        'away_pyth': away_pyth,
        'home_pyth': home_pyth,
        'away_wpct': away_w / away_gp,
        'home_wpct': home_w / home_gp,
        'combined_goals': (away_gfg + home_gfg) / 2,
    }
    
    return features


# ==================== MODEL TRAINING ====================

class SportModel:
    """
    Ensemble ML model for a single sport.
    Combines XGBoost, LightGBM, and Logistic Regression via stacking.
    """
    
    def __init__(self, sport):
        self.sport = sport
        self.scaler = StandardScaler()
        self.feature_names = None
        self.model = None
        self.xgb_model = None
        self.lgb_model = None
        self.lr_model = None
        self.ensemble = None
        self.is_trained = False
        self.train_stats = {}
        
    def _build_models(self):
        """Build the ensemble model architecture"""
        self.xgb_model = xgb.XGBClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            reg_alpha=0.1,
            reg_lambda=1.0,
            eval_metric='logloss',
            random_state=42,
            verbosity=0,
        )
        
        self.lgb_model = lgb.LGBMClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=42,
            verbose=-1,
        )
        
        self.lr_model = LogisticRegression(
            C=1.0,
            max_iter=1000,
            random_state=42,
        )
        
        # Stacking: XGB + LGB as base, LR as meta-learner
        self.ensemble = StackingClassifier(
            estimators=[
                ('xgb', self.xgb_model),
                ('lgb', self.lgb_model),
            ],
            final_estimator=LogisticRegression(C=1.0, max_iter=1000),
            cv=3,
            passthrough=True,  # pass original features + base model predictions to meta-learner
            n_jobs=-1,
        )
    
    def train(self, X, y, feature_names=None):
        """
        Train the ensemble on historical data.
        
        X: numpy array or DataFrame of features (n_games x n_features)
        y: numpy array of outcomes (1=home win, 0=away win)
        """
        if len(X) < 20:
            logger.warning(f'{self.sport}: Not enough data to train ({len(X)} games). Need at least 20.')
            return False
        
        self._build_models()
        
        if isinstance(X, pd.DataFrame):
            self.feature_names = list(X.columns)
            X_arr = X.values
        else:
            X_arr = np.array(X)
            self.feature_names = feature_names or [f'f{i}' for i in range(X_arr.shape[1])]
        
        y_arr = np.array(y)
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X_arr)
        
        logger.info(f'{self.sport}: Training on {len(X_arr)} games, {X_arr.shape[1]} features')
        
        # Cross-validation scores
        try:
            tscv = TimeSeriesSplit(n_splits=min(5, max(2, len(X_arr) // 20)))
            
            # Individual model CV scores
            xgb_scores = cross_val_score(self.xgb_model, X_scaled, y_arr, cv=tscv, scoring='accuracy')
            lgb_scores = cross_val_score(self.lgb_model, X_scaled, y_arr, cv=tscv, scoring='accuracy')
            lr_scores = cross_val_score(self.lr_model, X_scaled, y_arr, cv=tscv, scoring='accuracy')
            
            logger.info(f'{self.sport} CV Accuracy — XGB: {xgb_scores.mean():.3f} ± {xgb_scores.std():.3f}')
            logger.info(f'{self.sport} CV Accuracy — LGB: {lgb_scores.mean():.3f} ± {lgb_scores.std():.3f}')
            logger.info(f'{self.sport} CV Accuracy — LR:  {lr_scores.mean():.3f} ± {lr_scores.std():.3f}')
        except Exception as e:
            logger.warning(f'{self.sport}: CV failed: {e}')
            xgb_scores = lgb_scores = lr_scores = np.array([0.5])
        
        # Train the full stacking ensemble
        try:
            self.ensemble.fit(X_scaled, y_arr)
            
            # Also train individual models for feature importance
            self.xgb_model.fit(X_scaled, y_arr)
            self.lgb_model.fit(X_scaled, y_arr)
            self.lr_model.fit(X_scaled, y_arr)
            
            # Calibrate the ensemble
            if len(X_arr) >= 50:
                self.model = CalibratedClassifierCV(self.ensemble, cv=3, method='isotonic')
                self.model.fit(X_scaled, y_arr)
            else:
                self.model = self.ensemble
            
            self.is_trained = True
            
            # Training accuracy
            train_pred = self.model.predict(X_scaled)
            train_proba = self.model.predict_proba(X_scaled)[:, 1]
            train_acc = accuracy_score(y_arr, train_pred)
            train_brier = brier_score_loss(y_arr, train_proba)
            train_logloss = log_loss(y_arr, train_proba)
            
            self.train_stats = {
                'games': len(X_arr),
                'features': X_arr.shape[1],
                'train_accuracy': round(train_acc, 4),
                'train_brier': round(train_brier, 4),
                'train_logloss': round(train_logloss, 4),
                'cv_xgb': round(xgb_scores.mean(), 4),
                'cv_lgb': round(lgb_scores.mean(), 4),
                'cv_lr': round(lr_scores.mean(), 4),
                'trained_at': datetime.utcnow().isoformat(),
            }
            
            # Feature importance
            if self.xgb_model and hasattr(self.xgb_model, 'feature_importances_'):
                importances = self.xgb_model.feature_importances_
                top_features = sorted(
                    zip(self.feature_names, importances),
                    key=lambda x: x[1], reverse=True
                )[:10]
                self.train_stats['top_features'] = [
                    {'name': n, 'importance': round(float(v), 4)} for n, v in top_features
                ]
            
            logger.info(f'{self.sport}: Training complete! Accuracy={train_acc:.3f}, Brier={train_brier:.4f}')
            return True
            
        except Exception as e:
            logger.error(f'{self.sport}: Training failed: {e}')
            self.is_trained = False
            return False
    
    def predict(self, features_dict):
        """
        Predict home win probability for a single game.
        
        features_dict: dict of feature name -> value
        Returns: {home_win_prob, away_win_prob, confidence, model_used}
        """
        if not self.is_trained:
            return {'error': 'Model not trained', 'home_win_prob': 0.5, 'away_win_prob': 0.5}
        
        # Build feature vector in correct order
        X = np.array([[features_dict.get(f, 0) for f in self.feature_names]])
        X_scaled = self.scaler.transform(X)
        
        # Get calibrated probability
        proba = self.model.predict_proba(X_scaled)[0]
        home_win_prob = float(proba[1])
        away_win_prob = float(proba[0])
        
        # Also get individual model predictions for analysis
        individual = {}
        try:
            individual['xgb'] = float(self.xgb_model.predict_proba(X_scaled)[0][1])
            individual['lgb'] = float(self.lgb_model.predict_proba(X_scaled)[0][1])
            individual['lr'] = float(self.lr_model.predict_proba(X_scaled)[0][1])
        except Exception:
            pass
        
        # Confidence based on model agreement
        probs = list(individual.values()) + [home_win_prob]
        prob_std = np.std(probs) if len(probs) > 1 else 0
        
        # Higher agreement = higher confidence
        if prob_std < 0.03:
            confidence = 'HIGH'
        elif prob_std < 0.07:
            confidence = 'MEDIUM'
        else:
            confidence = 'LOW'
        
        return {
            'home_win_prob': round(home_win_prob, 4),
            'away_win_prob': round(away_win_prob, 4),
            'confidence': confidence,
            'model_agreement': round(1 - prob_std, 4),
            'individual_models': {k: round(v, 4) for k, v in individual.items()},
            'model': 'ensemble_v1',
        }
    
    def predict_spread(self, features_dict):
        """
        Convert win probability to implied spread.
        Uses logistic inversion.
        """
        pred = self.predict(features_dict)
        if 'error' in pred:
            return pred
        
        home_prob = pred['home_win_prob']
        
        # Logistic inversion: spread = -factor * log10(prob / (1 - prob))
        if home_prob <= 0 or home_prob >= 1:
            spread = 0
        else:
            factor = {'nba': 7.5, 'mlb': 4.0, 'nhl': 1.5}.get(self.sport, 5.0)
            spread = -factor * np.log10(home_prob / (1 - home_prob))
        
        pred['implied_spread'] = round(float(spread), 1)
        return pred
    
    def save(self):
        """Save trained model to disk"""
        if not self.is_trained:
            return False
        filepath = MODEL_DIR / f'{self.sport}_model.pkl'
        with open(filepath, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'ensemble': self.ensemble,
                'xgb': self.xgb_model,
                'lgb': self.lgb_model,
                'lr': self.lr_model,
                'scaler': self.scaler,
                'feature_names': self.feature_names,
                'train_stats': self.train_stats,
            }, f)
        logger.info(f'{self.sport}: Model saved to {filepath}')
        return True
    
    def load(self):
        """Load trained model from disk"""
        filepath = MODEL_DIR / f'{self.sport}_model.pkl'
        if not filepath.exists():
            logger.warning(f'{self.sport}: No saved model found at {filepath}')
            return False
        try:
            with open(filepath, 'rb') as f:
                data = pickle.load(f)
            self.model = data['model']
            self.ensemble = data['ensemble']
            self.xgb_model = data['xgb']
            self.lgb_model = data['lgb']
            self.lr_model = data['lr']
            self.scaler = data['scaler']
            self.feature_names = data['feature_names']
            self.train_stats = data['train_stats']
            self.is_trained = True
            logger.info(f'{self.sport}: Model loaded from {filepath}')
            return True
        except Exception as e:
            logger.error(f'{self.sport}: Failed to load model: {e}')
            return False


# ==================== DATA LOADING ====================

def load_nba_training_data():
    """
    Load NBA backtest games from the JS backtest module's data.
    Returns X (features DataFrame) and y (outcomes array).
    """
    # Read the backtest games from the JS file
    backtest_path = Path(__file__).parent.parent / 'models' / 'backtest.js'
    if not backtest_path.exists():
        logger.error('NBA backtest file not found')
        return None, None
    
    content = backtest_path.read_text()
    
    # Parse the GAMES array
    # Format: [away, home, awayScore, homeScore, closingSpread, closingTotal]
    import re
    games_match = re.search(r'const GAMES = \[(.*?)\];', content, re.DOTALL)
    if not games_match:
        logger.error('Could not parse GAMES array from backtest.js')
        return None, None
    
    games_str = games_match.group(1)
    # Parse individual game arrays
    game_pattern = re.compile(r"\['([A-Z]+)','([A-Z]+)',(\d+),(\d+),([-\d.]+),([\d.]+)\]")
    games = game_pattern.findall(games_str)
    
    if not games:
        logger.error('No games parsed from backtest data')
        return None, None
    
    logger.info(f'Loaded {len(games)} NBA backtest games')
    
    # Also read team data for feature extraction
    nba_path = Path(__file__).parent.parent / 'models' / 'nba.js'
    teams = _parse_static_nba_teams(nba_path)
    
    features_list = []
    outcomes = []
    
    for away, home, away_score, home_score, spread, total in games:
        away_score = int(away_score)
        home_score = int(home_score)
        
        away_team = teams.get(away, _default_nba_team())
        home_team = teams.get(home, _default_nba_team())
        
        game_data = {
            'away_team': away_team,
            'home_team': home_team,
            'away_b2b': False,
            'home_b2b': False,
        }
        
        feats = extract_nba_features(game_data)
        features_list.append(feats)
        outcomes.append(1 if home_score > away_score else 0)
    
    X = pd.DataFrame(features_list)
    y = np.array(outcomes)
    
    logger.info(f'NBA features: {X.shape[1]} features, {sum(y)} home wins / {len(y)-sum(y)} away wins')
    return X, y

def _parse_static_nba_teams(filepath):
    """Parse static team data from nba.js"""
    import re
    if not filepath.exists():
        return {}
    
    content = filepath.read_text()
    teams = {}
    
    # Parse STATIC_TEAMS object
    team_pattern = re.compile(
        r"'([A-Z]+)':\s*\{[^}]*name:'([^']*)'[^}]*w:(\d+)[^}]*l:(\d+)[^}]*ppg:([\d.]+)[^}]*oppg:([\d.]+)[^}]*diff:([-\d.]+)[^}]*l10:'([\d-]+)'"
    )
    
    for m in team_pattern.finditer(content):
        abbr = m.group(1)
        teams[abbr] = {
            'name': m.group(2),
            'w': int(m.group(3)),
            'l': int(m.group(4)),
            'ppg': float(m.group(5)),
            'oppg': float(m.group(6)),
            'diff': float(m.group(7)),
            'l10': m.group(8),
        }
    
    return teams

def _default_nba_team():
    return {'name': 'Unknown', 'w': 41, 'l': 41, 'ppg': 110, 'oppg': 110, 'diff': 0, 'l10': '5-5'}

def _default_mlb_team():
    return {'name': 'Unknown', 'w': 81, 'l': 81, 'rsG': 4.5, 'raG': 4.5, 'ops': .720, 'era': 4.00, 'bullpenEra': 3.70, 'l10': '5-5'}

def load_mlb_training_data():
    """Load MLB backtest data"""
    backtest_path = Path(__file__).parent.parent / 'models' / 'backtest-mlb.js'
    if not backtest_path.exists():
        logger.warning('MLB backtest file not found')
        return None, None
    
    content = backtest_path.read_text()
    
    import re
    games_match = re.search(r'const GAMES = \[(.*?)\];', content, re.DOTALL)
    if not games_match:
        return None, None
    
    games_str = games_match.group(1)
    game_pattern = re.compile(r"\['([A-Z]+)','([A-Z]+)',(\d+),(\d+),([-\d.]+),([\d.]+)\]")
    games = game_pattern.findall(games_str)
    
    if not games:
        return None, None
    
    logger.info(f'Loaded {len(games)} MLB backtest games')
    
    # Read MLB team data
    mlb_path = Path(__file__).parent.parent / 'models' / 'mlb.js'
    teams = _parse_static_mlb_teams(mlb_path)
    
    features_list = []
    outcomes = []
    
    for away, home, away_score, home_score, spread, total in games:
        away_team = teams.get(away, _default_mlb_team())
        home_team = teams.get(home, _default_mlb_team())
        
        game_data = {
            'away_team': away_team,
            'home_team': home_team,
            'park_factor': 1.0,
            'weather_multiplier': 1.0,
        }
        
        feats = extract_mlb_features(game_data)
        features_list.append(feats)
        outcomes.append(1 if int(home_score) > int(away_score) else 0)
    
    X = pd.DataFrame(features_list)
    y = np.array(outcomes)
    return X, y

def _parse_static_mlb_teams(filepath):
    """Parse static MLB team data"""
    import re
    if not filepath.exists():
        return {}
    
    content = filepath.read_text()
    teams = {}
    
    team_pattern = re.compile(
        r"'([A-Z]+)':\s*\{[^}]*name:\s*'([^']*)'[^}]*w:\s*(\d+)[^}]*l:\s*(\d+)[^}]*rsG:\s*([\d.]+)[^}]*raG:\s*([\d.]+)"
    )
    
    for m in team_pattern.finditer(content):
        abbr = m.group(1)
        teams[abbr] = {
            'name': m.group(2),
            'w': int(m.group(3)),
            'l': int(m.group(4)),
            'rsG': float(m.group(5)),
            'raG': float(m.group(6)),
            'l10': '5-5',
        }
    
    return teams


# ==================== GLOBAL MODELS ====================

models = {
    'nba': SportModel('nba'),
    'mlb': SportModel('mlb'),
    'nhl': SportModel('nhl'),
}

def train_all():
    """Train all sport models from available data"""
    results = {}
    
    # NBA
    X_nba, y_nba = load_nba_training_data()
    if X_nba is not None and len(X_nba) > 0:
        success = models['nba'].train(X_nba, y_nba)
        if success:
            models['nba'].save()
        results['nba'] = models['nba'].train_stats if success else {'error': 'Training failed'}
    else:
        results['nba'] = {'error': 'No training data'}
    
    # MLB
    X_mlb, y_mlb = load_mlb_training_data()
    if X_mlb is not None and len(X_mlb) > 0:
        success = models['mlb'].train(X_mlb, y_mlb)
        if success:
            models['mlb'].save()
        results['mlb'] = models['mlb'].train_stats if success else {'error': 'Training failed'}
    else:
        results['mlb'] = {'error': 'No training data'}
    
    return results

def load_all():
    """Load all saved models"""
    for sport in models:
        models[sport].load()


# ==================== CLI ====================

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'train':
        print('🧠 Training all ML models...')
        results = train_all()
        print(json.dumps(results, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] == 'predict':
        # Quick test: predict a game
        load_all()
        sport = sys.argv[2] if len(sys.argv) > 2 else 'nba'
        model = models.get(sport)
        if model and model.is_trained:
            # Test with default features
            if sport == 'nba':
                feats = extract_nba_features({
                    'away_team': {'ppg': 118.4, 'oppg': 107.7, 'w': 55, 'l': 15, 'diff': 10.7, 'l10': '9-1'},
                    'home_team': {'ppg': 117.2, 'oppg': 107.8, 'w': 52, 'l': 14, 'diff': 9.4, 'l10': '8-2'},
                })
            else:
                feats = {}
            result = model.predict_spread(feats)
            print(json.dumps(result, indent=2))
        else:
            print(f'No trained model for {sport}. Run: python engine.py train')
    else:
        print('Usage:')
        print('  python engine.py train     — Train all models')
        print('  python engine.py predict   — Test prediction')
        print('  python engine.py serve     — Start HTTP API server')
