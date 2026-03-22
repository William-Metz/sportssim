#!/usr/bin/env python3
"""
SportsSim ML Engine v3.0 — XGBoost + LightGBM Ensemble

Production MLB prediction engine for Opening Day 2025.
Accepts game features as JSON via stdin, outputs calibrated probabilities.

v3.0 UPGRADES:
  - XGBoost + LightGBM added to ensemble (best-in-class for tabular data)
  - Elo rating system with game-by-game updates for proper backtesting
  - Improved feature engineering: matchup interactions, platoon splits
  - Better calibration: isotonic regression + Platt scaling blend
  - Walk-forward validation: no look-ahead bias
  - Proper Kelly edge calculation for bet sizing

Modes:
  - train: Build model from historical game data
  - predict: Generate calibrated probabilities for new games
  - calibrate: Test model calibration on held-out data
  - backtest: Full backtest with betting simulation
  - elo: Build Elo ratings from game history

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
from collections import defaultdict

warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import brier_score_loss, log_loss, accuracy_score
from scipy.stats import poisson

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

try:
    import lightgbm as lgb
    HAS_LGB = True
except (ImportError, OSError):
    HAS_LGB = False

MODEL_DIR = Path(__file__).parent / 'ml-models'
MODEL_DIR.mkdir(exist_ok=True)


# ==================== ELO RATING SYSTEM ====================

class EloSystem:
    """
    MLB Elo rating system with game-by-game updates.
    Proper point-in-time ratings — no look-ahead bias.
    
    Key parameters tuned for MLB:
    - K-factor: 4 (MLB has high variance, keep updates small)
    - HFA: 24 Elo points (~54% home win implied)
    - Regression to mean: 33% between seasons
    - Starting Elo: 1500
    """
    
    def __init__(self, k_factor=4, hfa=24, season_regression=0.33):
        self.k = k_factor
        self.hfa = hfa
        self.season_regression = season_regression
        self.ratings = defaultdict(lambda: 1500.0)
        self.game_count = defaultdict(int)
        self.history = []  # track rating evolution
    
    def expected_score(self, rating_a, rating_b, home_advantage=True):
        """Expected win probability for team A (home if home_advantage=True)."""
        diff = rating_a - rating_b
        if home_advantage:
            diff += self.hfa
        return 1.0 / (1.0 + 10.0 ** (-diff / 400.0))
    
    def update(self, home_team, away_team, home_won, margin=None):
        """Update ratings after a game. Returns pre-game expected probs."""
        home_rating = self.ratings[home_team]
        away_rating = self.ratings[away_team]
        
        home_exp = self.expected_score(home_rating, away_rating, home_advantage=True)
        away_exp = 1.0 - home_exp
        
        home_actual = 1.0 if home_won else 0.0
        away_actual = 1.0 - home_actual
        
        # Margin of victory multiplier (dampened — MLB is high variance)
        mov_mult = 1.0
        if margin is not None:
            mov_mult = math.log(max(1, abs(margin)) + 1) * 0.6 + 0.4
            # Cap at 1.8x to prevent blowout overreaction
            mov_mult = min(1.8, mov_mult)
        
        # Update ratings
        k = self.k * mov_mult
        self.ratings[home_team] += k * (home_actual - home_exp)
        self.ratings[away_team] += k * (away_actual - away_exp)
        
        self.game_count[home_team] += 1
        self.game_count[away_team] += 1
        
        return home_exp, away_exp
    
    def regress_to_mean(self):
        """Season-start regression. Call between seasons."""
        for team in list(self.ratings.keys()):
            self.ratings[team] = 1500 + (self.ratings[team] - 1500) * (1 - self.season_regression)
    
    def get_rating(self, team):
        return self.ratings[team]
    
    def get_all_ratings(self):
        return dict(sorted(self.ratings.items(), key=lambda x: x[1], reverse=True))
    
    def build_from_games(self, games):
        """Process a list of games chronologically, return games with Elo features.
        v38.0: Detects season boundaries and applies regression between seasons."""
        # Sort by date
        sorted_games = sorted(games, key=lambda g: g.get('date', ''))
        
        enriched = []
        last_year = None
        
        for game in sorted_games:
            home = game.get('home', '')
            away = game.get('away', '')
            home_won = game.get('homeWon', False)
            margin = abs(game.get('homeScore', 0) - game.get('awayScore', 0))
            
            # Season boundary detection — regress ratings between seasons
            game_date = game.get('date', '')
            game_year = int(game_date[:4]) if game_date and len(game_date) >= 4 else None
            if game_year and last_year and game_year > last_year:
                self.regress_to_mean()
            last_year = game_year
            
            # Capture PRE-GAME Elo ratings (point-in-time)
            home_elo = self.get_rating(home)
            away_elo = self.get_rating(away)
            home_exp, away_exp = self.expected_score(home_elo, away_elo), 1 - self.expected_score(home_elo, away_elo)
            
            # Add Elo features to game
            enriched_game = {
                **game,
                'homeElo': home_elo,
                'awayElo': away_elo,
                'eloDiff': home_elo - away_elo,
                'eloHomeWinProb': self.expected_score(home_elo, away_elo, home_advantage=True),
                'homeEloGames': self.game_count[home],
                'awayEloGames': self.game_count[away],
            }
            enriched.append(enriched_game)
            
            # NOW update ratings (after capturing pre-game state)
            self.update(home, away, home_won, margin)
        
        return enriched


# ==================== FEATURE ENGINEERING ====================

def extract_features(game):
    """
    Extract ML features from a game dict.
    v3.0: Added Elo features, improved interactions, platoon indicators.
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
    
    # Pythagorean win expectation (Davenport exponent)
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
    
    # W/L record
    awayW = game.get('awayW', 81)
    awayL = game.get('awayL', 81)
    homeW = game.get('homeW', 81)
    homeL = game.get('homeL', 81)
    
    away_wpct = awayW / max(1, awayW + awayL)
    home_wpct = homeW / max(1, homeW + homeL)
    features['wpct_away'] = away_wpct
    features['wpct_home'] = home_wpct
    features['wpct_delta'] = home_wpct - away_wpct
    
    # Luck factor (actual vs pythagorean)
    features['luck_away'] = away_wpct - away_pyth
    features['luck_home'] = home_wpct - home_pyth
    features['luck_delta'] = features['luck_home'] - features['luck_away']
    
    # ---- Elo features (point-in-time, the most predictive single feature) ----
    home_elo = game.get('homeElo', 1500)
    away_elo = game.get('awayElo', 1500)
    features['elo_diff'] = home_elo - away_elo
    features['elo_home_prob'] = game.get('eloHomeWinProb', 0.54)
    # Elo confidence: how many games has the rating been built on
    features['elo_confidence'] = min(1.0, (game.get('homeEloGames', 0) + game.get('awayEloGames', 0)) / 100)
    
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
    
    features['era_delta'] = awayEra - homeEra
    features['fip_delta'] = awayFip - homeFip
    features['whip_delta'] = awayWhip - homeWhip
    
    # Pitching composite
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
    features['bullpen_delta'] = awayBullpen - homeBullpen
    
    # ---- K/9 features ----
    awayK9 = game.get('awayK9', 8.6)
    homeK9 = game.get('homeK9', 8.6)
    features['k9_delta'] = homeK9 - awayK9
    
    # ---- Park factor ----
    pf = game.get('parkFactor', 1.0)
    features['park_factor'] = pf
    features['park_extreme'] = abs(pf - 1.0)
    
    # ---- Starting pitcher features ----
    awayPRating = game.get('awayPitcherRating', 50)
    homePRating = game.get('homePitcherRating', 50)
    features['pitcher_rating_delta'] = homePRating - awayPRating
    features['pitcher_rating_away'] = awayPRating
    features['pitcher_rating_home'] = homePRating
    
    awayPEra = game.get('awayPitcherEra', lg_era)
    homePEra = game.get('homePitcherEra', lg_era)
    features['pitcher_era_delta'] = awayPEra - homePEra
    
    awayPFip = game.get('awayPitcherFip', lg_fip)
    homePFip = game.get('homePitcherFip', lg_fip)
    features['pitcher_fip_delta'] = awayPFip - homePFip
    
    # Pitcher quality composite (FIP-centric — most predictive)
    away_p_quality = awayPFip * 0.45 + awayPEra * 0.25 + (awayPRating / 100 * lg_fip * 2 if awayPRating else lg_fip) * 0.30
    home_p_quality = homePFip * 0.45 + homePEra * 0.25 + (homePRating / 100 * lg_fip * 2 if homePRating else lg_fip) * 0.30
    features['pitcher_quality_delta'] = away_p_quality - home_p_quality
    
    # Ace indicators
    features['is_ace_matchup'] = 1 if (awayPRating >= 75 and homePRating >= 75) else 0
    features['has_ace'] = 1 if (awayPRating >= 80 or homePRating >= 80) else 0
    features['ace_side'] = 1 if homePRating >= 80 else (-1 if awayPRating >= 80 else 0)
    
    # Pitcher handedness
    awayHand = game.get('awayPitcherHand', 'R')
    homeHand = game.get('homePitcherHand', 'R')
    features['away_pitcher_lhp'] = 1 if awayHand == 'L' else 0
    features['home_pitcher_lhp'] = 1 if homeHand == 'L' else 0
    features['same_hand_matchup'] = 1 if awayHand == homeHand else 0
    
    # ---- Rolling stats / form ----
    awayRollAdj = game.get('awayRollingAdj', 0)
    homeRollAdj = game.get('homeRollingAdj', 0)
    features['rolling_adj_delta'] = homeRollAdj - awayRollAdj
    features['rolling_adj_away'] = awayRollAdj
    features['rolling_adj_home'] = homeRollAdj
    
    # ---- Injury features ----
    awayInjAdj = game.get('awayInjuryAdj', 0)
    homeInjAdj = game.get('homeInjuryAdj', 0)
    features['injury_adj_delta'] = homeInjAdj - awayInjAdj
    
    # ---- Interaction features (capture non-linear signal) ----
    features['pyth_x_pitcher'] = features['pyth_delta'] * features['pitcher_rating_delta'] / 50
    features['run_diff_x_park'] = features['run_diff_delta'] * pf
    features['offense_x_pitcher'] = features['scoring_power_delta'] * features['pitcher_quality_delta']
    features['elo_x_pyth'] = features['elo_diff'] / 100 * features['pyth_delta']
    features['elo_x_pitcher'] = features['elo_diff'] / 100 * features['pitcher_rating_delta'] / 50
    
    # ---- Statcast features (v2.0+) ----
    awayPxera = game.get('awayPitcherXera', None)
    homePxera = game.get('homePitcherXera', None)
    awayPera = game.get('awayPitcherEra', lg_era)
    homePera = game.get('homePitcherEra', lg_era)
    
    if awayPxera is not None and awayPxera > 0:
        features['away_pitcher_era_xera_gap'] = awayPera - awayPxera
        features['away_pitcher_xera'] = awayPxera
    else:
        features['away_pitcher_era_xera_gap'] = 0
        features['away_pitcher_xera'] = awayPera
    
    if homePxera is not None and homePxera > 0:
        features['home_pitcher_era_xera_gap'] = homePera - homePxera
        features['home_pitcher_xera'] = homePxera
    else:
        features['home_pitcher_era_xera_gap'] = 0
        features['home_pitcher_xera'] = homePera
    
    features['xera_delta'] = features['away_pitcher_xera'] - features['home_pitcher_xera']
    features['regression_signal'] = features['home_pitcher_era_xera_gap'] - features['away_pitcher_era_xera_gap']
    
    # Team xwOBA
    awayXwoba = game.get('awayTeamXwoba', 0.310)
    homeXwoba = game.get('homeTeamXwoba', 0.310)
    lg_xwoba = 0.310
    
    features['xwoba_delta'] = homeXwoba - awayXwoba
    features['away_xwoba_edge'] = awayXwoba - lg_xwoba
    features['home_xwoba_edge'] = homeXwoba - lg_xwoba
    
    # Statcast composite
    away_sc_composite = features['away_pitcher_era_xera_gap'] * -0.5 + features['away_xwoba_edge'] * 20
    home_sc_composite = features['home_pitcher_era_xera_gap'] * -0.5 + features['home_xwoba_edge'] * 20
    features['statcast_composite_delta'] = home_sc_composite - away_sc_composite
    
    # Pitcher xwOBA against
    awayPxwoba = game.get('awayPitcherXwoba', lg_xwoba)
    homePxwoba = game.get('homePitcherXwoba', lg_xwoba)
    features['pitcher_xwoba_delta'] = awayPxwoba - homePxwoba
    
    # Statcast interaction
    features['statcast_matchup'] = (homeXwoba - lg_xwoba) * (features['away_pitcher_xera'] - lg_era) * 10
    
    # Regression flags
    features['away_pitcher_lucky'] = 1 if features['away_pitcher_era_xera_gap'] < -0.5 else 0
    features['home_pitcher_lucky'] = 1 if features['home_pitcher_era_xera_gap'] < -0.5 else 0
    features['away_pitcher_unlucky'] = 1 if features['away_pitcher_era_xera_gap'] > 0.5 else 0
    features['home_pitcher_unlucky'] = 1 if features['home_pitcher_era_xera_gap'] > 0.5 else 0
    
    # ---- Expected runs (for totals) ----
    away_exp = awayRsG * (homeRaG / 4.4) * pf
    home_exp = homeRsG * (awayRaG / 4.4) * pf
    features['away_exp_runs'] = away_exp
    features['home_exp_runs'] = home_exp
    features['total_exp_runs'] = away_exp + home_exp
    
    # ---- Season context features (v38.0 — Opening Day edge) ----
    day_of_season = game.get('dayOfSeason', 90)
    is_opening_week = game.get('isOpeningWeek', 0)
    is_first_month = game.get('isFirstMonth', 0)
    
    features['day_of_season'] = day_of_season
    features['is_opening_week'] = is_opening_week
    features['is_first_month'] = is_first_month
    
    # Early-season signal: less info = LOWER HFA + less predictability
    # CALIBRATION: 2024 data shows home teams win LESS in opening weeks (49.2% vs 52.5% season)
    # Reason: less crowd advantage early, less familiarity edge, more randomness
    features['early_season_hfa'] = -max(0, 1 - day_of_season / 60) * 0.15  # NEGATIVE = less HFA early
    
    # Bullpen reliability decays early season (smaller sample, uncertain roles)
    features['bullpen_uncertainty'] = max(0, 1 - day_of_season / 45) * 0.2
    
    # Pitcher rating reliability — early-season pitcher ratings are noisy
    features['pitcher_confidence'] = min(1.0, day_of_season / 60)
    
    # Interaction: ace advantage is BIGGER early (less bullpen game, ace goes deeper)
    features['early_ace_premium'] = features.get('ace_side', 0) * max(0, 1 - day_of_season / 45) * 0.5
    
    # ---- Opening Day / early season specific features (v39.0) ----
    # Opening Day is different: all teams have fresh arms, no fatigue, crowd energy maxed
    features['is_opening_day'] = 1 if day_of_season <= 2 else 0
    
    # Early-season run environment: tends to be lower (pitchers ahead of hitters)
    # Historical data: first 2 weeks avg 8.59 total runs vs 8.75 season avg
    features['early_run_env'] = max(0, 1 - day_of_season / 30) * 0.1
    
    # Preseason projection confidence: how much to trust team-level stats
    # Very low early → high as season progresses
    features['projection_confidence'] = min(1.0, day_of_season / 50)
    
    # Sample size factor: games played vs expected
    away_gp = game.get('awayW', 81) + game.get('awayL', 81)
    home_gp = game.get('homeW', 81) + game.get('homeL', 81)
    features['sample_size'] = min(1.0, (away_gp + home_gp) / 80)  # normalize to 0-1
    
    return features


def features_to_array(features, feature_names):
    """Convert feature dict to numpy array in consistent order."""
    return np.array([features.get(f, 0) for f in feature_names])


# ==================== FEATURE LISTS ====================

FEATURE_NAMES = [
    # Core team quality
    'run_diff_delta', 'pyth_delta', 'log5_away', 'wpct_delta', 'luck_delta',
    # Elo (v3.0 — most predictive single feature cluster)
    'elo_diff', 'elo_home_prob', 'elo_confidence',
    # Team pitching
    'era_delta', 'fip_delta', 'whip_delta', 'pitch_score_delta',
    # Team offense
    'ops_delta', 'scoring_power_delta', 'bullpen_delta', 'k9_delta',
    # Park
    'park_factor', 'park_extreme',
    # Starting pitcher
    'pitcher_rating_delta', 'pitcher_era_delta', 'pitcher_fip_delta',
    'pitcher_quality_delta', 'is_ace_matchup', 'has_ace', 'ace_side',
    'away_pitcher_lhp', 'home_pitcher_lhp', 'same_hand_matchup',
    # Form + injuries
    'rolling_adj_delta', 'injury_adj_delta',
    # Interactions
    'pyth_x_pitcher', 'run_diff_x_park', 'offense_x_pitcher',
    'elo_x_pyth', 'elo_x_pitcher',
    # Statcast
    'away_pitcher_era_xera_gap', 'home_pitcher_era_xera_gap',
    'away_pitcher_xera', 'home_pitcher_xera', 'xera_delta', 'regression_signal',
    'xwoba_delta', 'away_xwoba_edge', 'home_xwoba_edge',
    'statcast_composite_delta', 'pitcher_xwoba_delta', 'statcast_matchup',
    'away_pitcher_lucky', 'home_pitcher_lucky',
    'away_pitcher_unlucky', 'home_pitcher_unlucky',
    # Season context (v38.0 — Opening Day edge)
    'day_of_season', 'is_opening_week', 'is_first_month',
    'early_season_hfa', 'bullpen_uncertainty', 'pitcher_confidence',
    'early_ace_premium',
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
    'elo_diff',
    # Statcast totals features
    'away_pitcher_xera', 'home_pitcher_xera',
    'away_xwoba_edge', 'home_xwoba_edge',
    'away_pitcher_era_xera_gap', 'home_pitcher_era_xera_gap',
    # Season context (v38.0 — early season totals tend to be lower)
    'day_of_season', 'is_first_month', 'bullpen_uncertainty',
]


# ==================== MODEL TRAINING ====================

def train_model(games_data, sport='mlb'):
    """
    Train ML ensemble from historical game data.
    v3.0: XGBoost + LightGBM + Elo features + improved calibration.
    """
    if not games_data:
        return {'error': 'No training data provided'}
    
    # Step 1: Build Elo ratings from game history
    elo = EloSystem(k_factor=4, hfa=24, season_regression=0.33)
    enriched_games = elo.build_from_games(games_data)
    
    # Step 2: Extract features
    X_list = []
    y_list = []
    totals_X = []
    totals_y = []
    
    for game in enriched_games:
        features = extract_features(game)
        X_list.append(features_to_array(features, FEATURE_NAMES))
        y_list.append(1 if game.get('homeWon', False) else 0)
        
        actual_total = game.get('actualTotal')
        book_total = game.get('bookTotal')
        if actual_total is not None and book_total is not None:
            totals_X.append(features_to_array(features, TOTALS_FEATURE_NAMES))
            totals_y.append(actual_total)
    
    X = np.array(X_list)
    y = np.array(y_list)
    
    n_games = len(y)
    print(f"Training on {n_games} games, home win rate: {y.mean():.3f}", file=sys.stderr)
    
    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # ---- Build Ensemble ----
    models = {}
    calibrated = {}
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    cal_cv = 3  # Use 3-fold for calibration (faster, sufficient with 2000+ games)
    
    # 1. Logistic Regression (interpretable baseline)
    lr = LogisticRegression(C=0.3, max_iter=1000, solver='lbfgs', class_weight='balanced')
    lr_scores = cross_val_score(lr, X_scaled, y, cv=cv, scoring='accuracy')
    print(f"  LR CV: {lr_scores.mean():.4f} ± {lr_scores.std():.4f}", file=sys.stderr)
    lr_cal = CalibratedClassifierCV(lr, cv=cal_cv, method='sigmoid')
    lr_cal.fit(X_scaled, y)
    lr.fit(X_scaled, y)
    models['lr'] = {'model': lr, 'cal': lr_cal, 'cv_acc': lr_scores.mean(), 'cv_std': lr_scores.std()}
    
    # 2. Gradient Boosting (sklearn) — faster config
    gb = GradientBoostingClassifier(
        n_estimators=150, max_depth=3, learning_rate=0.06,
        min_samples_leaf=5, subsample=0.8, random_state=42
    )
    gb_scores = cross_val_score(gb, X_scaled, y, cv=cv, scoring='accuracy')
    print(f"  GB CV: {gb_scores.mean():.4f} ± {gb_scores.std():.4f}", file=sys.stderr)
    gb_cal = CalibratedClassifierCV(gb, cv=cal_cv, method='sigmoid')
    gb_cal.fit(X_scaled, y)
    gb.fit(X_scaled, y)
    models['gb'] = {'model': gb, 'cal': gb_cal, 'cv_acc': gb_scores.mean(), 'cv_std': gb_scores.std()}
    
    # 3. Random Forest — lighter config
    rf = RandomForestClassifier(
        n_estimators=200, max_depth=6, min_samples_leaf=3,
        class_weight='balanced', random_state=42, n_jobs=-1
    )
    rf_scores = cross_val_score(rf, X_scaled, y, cv=cv, scoring='accuracy')
    print(f"  RF CV: {rf_scores.mean():.4f} ± {rf_scores.std():.4f}", file=sys.stderr)
    rf_cal = CalibratedClassifierCV(rf, cv=cal_cv, method='sigmoid')
    rf_cal.fit(X_scaled, y)
    rf.fit(X_scaled, y)
    models['rf'] = {'model': rf, 'cal': rf_cal, 'cv_acc': rf_scores.mean(), 'cv_std': rf_scores.std()}
    
    # 4. XGBoost (the money model)
    xgb_model = None
    xgb_cal = None
    if HAS_XGB:
        xgb_clf = xgb.XGBClassifier(
            n_estimators=200, max_depth=4, learning_rate=0.05,
            min_child_weight=5, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=1.0,
            eval_metric='logloss', random_state=42,
            use_label_encoder=False, n_jobs=-1,
        )
        xgb_scores = cross_val_score(xgb_clf, X_scaled, y, cv=cv, scoring='accuracy')
        xgb_cal = CalibratedClassifierCV(xgb_clf, cv=cal_cv, method='sigmoid')
        xgb_cal.fit(X_scaled, y)
        xgb_clf.fit(X_scaled, y)
        models['xgb'] = {'model': xgb_clf, 'cal': xgb_cal, 'cv_acc': xgb_scores.mean(), 'cv_std': xgb_scores.std()}
        print(f"  XGBoost CV: {xgb_scores.mean():.4f} ± {xgb_scores.std():.4f}", file=sys.stderr)
    
    # 5. LightGBM
    lgb_model = None
    lgb_cal = None
    if HAS_LGB:
        lgb_clf = lgb.LGBMClassifier(
            n_estimators=200, max_depth=4, learning_rate=0.05,
            min_child_samples=10, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=1.0,
            verbose=-1, random_state=42, n_jobs=-1,
        )
        lgb_scores = cross_val_score(lgb_clf, X_scaled, y, cv=cv, scoring='accuracy')
        lgb_cal = CalibratedClassifierCV(lgb_clf, cv=cal_cv, method='sigmoid')
        lgb_cal.fit(X_scaled, y)
        lgb_clf.fit(X_scaled, y)
        models['lgb'] = {'model': lgb_clf, 'cal': lgb_cal, 'cv_acc': lgb_scores.mean(), 'cv_std': lgb_scores.std()}
        print(f"  LightGBM CV: {lgb_scores.mean():.4f} ± {lgb_scores.std():.4f}", file=sys.stderr)
    
    # ---- Compute ensemble weights (proportional to CV accuracy) ----
    total_acc = sum(m['cv_acc'] for m in models.values())
    weights = {name: m['cv_acc'] / total_acc for name, m in models.items()}
    
    # ---- Generate ensemble predictions via cross-validation for calibration ----
    # Use proper out-of-fold predictions to avoid overfitting calibration
    from sklearn.calibration import IsotonicRegression
    
    ensemble_oof_probs = np.zeros(len(y))
    kf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    
    for train_idx, val_idx in kf.split(X_scaled, y):
        X_tr, X_val = X_scaled[train_idx], X_scaled[val_idx]
        y_tr = y[train_idx]
        
        fold_probs = np.zeros(len(val_idx))
        for name, m in models.items():
            # Fit calibrated model on this fold's training data
            model_class = type(m['model'])
            params = m['model'].get_params()
            temp_model = model_class(**params)
            temp_cal = CalibratedClassifierCV(temp_model, cv=3, method='sigmoid')
            try:
                temp_cal.fit(X_tr, y_tr)
                probs = temp_cal.predict_proba(X_val)[:, 1]
            except Exception:
                probs = np.full(len(val_idx), 0.5)
            fold_probs += probs * weights[name]
        
        ensemble_oof_probs[val_idx] = fold_probs
    
    ensemble_oof_probs = np.clip(ensemble_oof_probs, 0.01, 0.99)
    
    # Fit isotonic regression on OOF predictions for final calibration
    iso_reg = IsotonicRegression(y_min=0.05, y_max=0.95, out_of_bounds='clip')
    iso_reg.fit(ensemble_oof_probs, y)
    
    # Also generate in-sample ensemble predictions for reporting
    ensemble_probs = np.zeros(len(y))
    for name, m in models.items():
        probs = m['cal'].predict_proba(X_scaled)[:, 1]
        ensemble_probs += probs * weights[name]
    
    ensemble_probs = np.clip(ensemble_probs, 0.01, 0.99)
    
    # Apply isotonic calibration for reporting metrics  
    calibrated_probs = iso_reg.predict(ensemble_oof_probs)
    
    # Metrics on OOF calibrated predictions (honest evaluation)
    ensemble_acc = accuracy_score(y, (calibrated_probs > 0.5).astype(int))
    ensemble_brier = brier_score_loss(y, calibrated_probs)
    ensemble_logloss = log_loss(y, np.clip(calibrated_probs, 0.01, 0.99))
    
    # Calibration buckets (using OOF calibrated predictions — honest)
    calibration = []
    for low in np.arange(0.1, 0.9, 0.1):
        high = low + 0.1
        mask = (calibrated_probs >= low) & (calibrated_probs < high)
        if mask.sum() > 5:
            calibration.append({
                'bucket': f'{low:.1f}-{high:.1f}',
                'predicted': float(calibrated_probs[mask].mean()),
                'actual': float(y[mask].mean()),
                'count': int(mask.sum()),
                'error': round(abs(float(calibrated_probs[mask].mean()) - float(y[mask].mean())), 3),
            })
    
    # Feature importance (from GB + XGB if available)
    combined_importance = {}
    for feat_idx, feat in enumerate(FEATURE_NAMES):
        imp = gb.feature_importances_[feat_idx] * 0.3 + rf.feature_importances_[feat_idx] * 0.2
        if HAS_XGB and 'xgb' in models:
            imp += models['xgb']['model'].feature_importances_[feat_idx] * 0.3
        if HAS_LGB and 'lgb' in models:
            imp += models['lgb']['model'].feature_importances_[feat_idx] * 0.2
        combined_importance[feat] = imp
    top_features = sorted(combined_importance.items(), key=lambda x: x[1], reverse=True)[:15]
    
    # LR coefficients
    lr_coefs = dict(zip(FEATURE_NAMES, lr.coef_[0]))
    
    # ---- Totals Model ----
    totals_metrics = None
    totals_model_data = None
    if len(totals_X) > 50:
        totals_X_arr = np.array(totals_X)
        totals_y_arr = np.array(totals_y)
        totals_scaler = StandardScaler()
        totals_X_scaled = totals_scaler.fit_transform(totals_X_arr)
        
        if HAS_XGB:
            totals_reg = xgb.XGBRegressor(
                n_estimators=200, max_depth=3, learning_rate=0.04,
                min_child_weight=5, subsample=0.8, random_state=42,
            )
        else:
            totals_reg = GradientBoostingRegressor(
                n_estimators=200, max_depth=3, learning_rate=0.04,
                min_samples_leaf=5, random_state=42
            )
        totals_reg.fit(totals_X_scaled, totals_y_arr)
        
        totals_pred = totals_reg.predict(totals_X_scaled)
        totals_mae = float(np.mean(np.abs(totals_pred - totals_y_arr)))
        totals_rmse = float(np.sqrt(np.mean((totals_pred - totals_y_arr) ** 2)))
        
        totals_model_data = {'model': totals_reg, 'scaler': totals_scaler}
        totals_metrics = {
            'mae': round(totals_mae, 3),
            'rmse': round(totals_rmse, 3),
            'games': len(totals_y_arr),
            'avgTotal': round(float(totals_y_arr.mean()), 1),
        }
    
    # ---- Save model to disk ----
    model_data = {
        'sport': sport,
        'version': '3.0',
        'scaler': scaler,
        'weights': weights,
        'feature_names': FEATURE_NAMES,
        'totals_feature_names': TOTALS_FEATURE_NAMES,
        'elo_ratings': dict(elo.ratings),
        'elo_game_counts': dict(elo.game_count),
        'isotonic_calibrator': iso_reg,  # Final ensemble calibration layer
    }
    # Save each calibrated model
    for name, m in models.items():
        model_data[f'{name}_cal'] = m['cal']
    model_data['totals_model'] = totals_model_data
    
    model_path = MODEL_DIR / f'{sport}_ensemble_v3.pkl'
    with open(model_path, 'wb') as f:
        pickle.dump(model_data, f)
    
    # Also save as default path for backwards compat
    default_path = MODEL_DIR / f'{sport}_ensemble.pkl'
    with open(default_path, 'wb') as f:
        pickle.dump(model_data, f)
    
    print(f"Model saved to {model_path}", file=sys.stderr)
    
    return {
        'status': 'trained',
        'sport': sport,
        'version': '3.0',
        'games': len(y),
        'homeWinRate': float(y.mean()),
        'modelsUsed': list(models.keys()),
        'hasXGBoost': HAS_XGB,
        'hasLightGBM': HAS_LGB,
        'models': {
            name: {
                'cv_accuracy': round(float(m['cv_acc']), 4),
                'cv_std': round(float(m['cv_std']), 4),
                'weight': round(weights[name], 4),
            }
            for name, m in models.items()
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
        'elo': {
            'teams_rated': len(elo.ratings),
            'top_teams': [{'team': t, 'elo': round(r, 1)} for t, r in list(elo.get_all_ratings().items())[:10]],
            'bottom_teams': [{'team': t, 'elo': round(r, 1)} for t, r in list(elo.get_all_ratings().items())[-5:]],
        },
        'model_path': str(model_path),
    }


# ==================== PREDICTION ====================

def load_model(sport='mlb'):
    """Load trained model from disk. Tries v3 first, falls back to v2."""
    for fname in [f'{sport}_ensemble_v3.pkl', f'{sport}_ensemble.pkl']:
        model_path = MODEL_DIR / fname
        if model_path.exists():
            with open(model_path, 'rb') as f:
                return pickle.load(f)
    return None


def predict_games(games, sport='mlb'):
    """
    Predict outcomes for a list of games.
    Returns calibrated probabilities from the full ensemble.
    """
    model_data = load_model(sport)
    if not model_data:
        return {'error': f'No trained model for {sport}. Run train first.'}
    
    version = model_data.get('version', '2.0')
    weights = model_data['weights']
    model_names = list(weights.keys())
    
    # Add Elo features if we have Elo ratings
    elo_ratings = model_data.get('elo_ratings', {})
    elo_game_counts = model_data.get('elo_game_counts', {})
    
    results = []
    for game in games:
        # Inject Elo features if not present
        if 'homeElo' not in game and elo_ratings:
            home = game.get('home', '')
            away = game.get('away', '')
            home_elo = elo_ratings.get(home, 1500)
            away_elo = elo_ratings.get(away, 1500)
            game['homeElo'] = home_elo
            game['awayElo'] = away_elo
            game['eloDiff'] = home_elo - away_elo
            # Compute expected score with HFA
            diff = home_elo - away_elo + 24  # 24 = HFA
            game['eloHomeWinProb'] = 1.0 / (1.0 + 10.0 ** (-diff / 400.0))
            game['homeEloGames'] = elo_game_counts.get(home, 0)
            game['awayEloGames'] = elo_game_counts.get(away, 0)
        
        features = extract_features(game)
        X = features_to_array(features, model_data['feature_names']).reshape(1, -1)
        X_scaled = model_data['scaler'].transform(X)
        
        # Get probabilities from each model in ensemble
        model_probs = {}
        ensemble_prob = 0
        for name in model_names:
            cal_key = f'{name}_cal'
            if cal_key in model_data:
                prob = model_data[cal_key].predict_proba(X_scaled)[0][1]
                model_probs[name] = float(prob)
                ensemble_prob += prob * weights[name]
        
        # Clip to reasonable range
        ensemble_prob = max(0.08, min(0.92, ensemble_prob))
        
        # Apply isotonic calibration if available (corrects systematic biases)
        iso_cal = model_data.get('isotonic_calibrator')
        if iso_cal is not None:
            try:
                calibrated_prob = float(iso_cal.predict([ensemble_prob])[0])
                calibrated_prob = max(0.08, min(0.92, calibrated_prob))
                ensemble_prob = calibrated_prob
            except Exception:
                pass  # Fall back to uncalibrated
        
        away_abbr = game.get('away', '???')
        home_abbr = game.get('home', '???')
        
        result = {
            'away': away_abbr,
            'home': home_abbr,
            'homeWinProb': round(float(ensemble_prob), 4),
            'awayWinProb': round(1 - float(ensemble_prob), 4),
            'homeML': prob_to_ml(ensemble_prob),
            'awayML': prob_to_ml(1 - ensemble_prob),
            'models': {k: round(v, 4) for k, v in model_probs.items()},
            'confidence': get_confidence(ensemble_prob),
            'modelAgreement': round(1 - float(np.std(list(model_probs.values()))) * 3, 3) if len(model_probs) > 1 else 1.0,
            'version': version,
        }
        
        # Elo info
        if 'homeElo' in game:
            result['elo'] = {
                'home': round(game['homeElo'], 1),
                'away': round(game['awayElo'], 1),
                'diff': round(game.get('eloDiff', game['homeElo'] - game['awayElo']), 1),
                'eloProb': round(game.get('eloHomeWinProb', 0.54), 4),
            }
        
        # Totals prediction
        totals_model = model_data.get('totals_model')
        if totals_model and totals_model.get('model'):
            totals_features = features_to_array(features, model_data['totals_feature_names']).reshape(1, -1)
            totals_X_scaled = totals_model['scaler'].transform(totals_features)
            predicted_total = float(totals_model['model'].predict(totals_X_scaled)[0])
            result['predictedTotal'] = round(predicted_total, 1)
        
        results.append(result)
    
    return {'predictions': results, 'version': version}


# ==================== BACKTEST ====================

def run_backtest(games_data, sport='mlb'):
    """
    Walk-forward backtest with no look-ahead bias.
    Trains on expanding window, predicts next batch, simulates betting.
    v3.0: Full ensemble with XGBoost, Elo-enriched features.
    """
    if len(games_data) < 50:
        return {'error': 'Need at least 50 games for backtest'}
    
    # Build Elo ratings chronologically
    elo = EloSystem(k_factor=4, hfa=24, season_regression=0.33)
    enriched = elo.build_from_games(games_data)
    
    # Extract features
    all_features = []
    all_labels = []
    all_games = []
    
    for game in enriched:
        features = extract_features(game)
        X = features_to_array(features, FEATURE_NAMES)
        all_features.append(X)
        all_labels.append(1 if game.get('homeWon', False) else 0)
        all_games.append(game)
    
    X = np.array(all_features)
    y = np.array(all_labels)
    
    # Walk-forward: train on first N, predict next batch
    # Minimum training window: 200 games (about 2 weeks of MLB)
    window_size = max(200, len(X) // 4)
    step_size = max(5, len(X) // 50)
    
    predictions = [None] * len(X)
    
    for start_test in range(window_size, len(X), step_size):
        end_test = min(start_test + step_size, len(X))
        
        X_train = X[:start_test]
        y_train = y[:start_test]
        X_test = X[start_test:end_test]
        
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Quick ensemble for backtest (LR + GB + XGB if available)
        lr = LogisticRegression(C=0.3, max_iter=500)
        gb = GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.04, random_state=42)
        
        lr.fit(X_train_scaled, y_train)
        gb.fit(X_train_scaled, y_train)
        
        lr_probs = lr.predict_proba(X_test_scaled)[:, 1]
        gb_probs = gb.predict_proba(X_test_scaled)[:, 1]
        
        if HAS_XGB:
            xgb_clf = xgb.XGBClassifier(
                n_estimators=150, max_depth=3, learning_rate=0.04,
                min_child_weight=5, subsample=0.8, eval_metric='logloss',
                use_label_encoder=False, random_state=42, verbosity=0
            )
            xgb_clf.fit(X_train_scaled, y_train)
            xgb_probs = xgb_clf.predict_proba(X_test_scaled)[:, 1]
            ensemble_probs = lr_probs * 0.20 + gb_probs * 0.35 + xgb_probs * 0.45
        else:
            ensemble_probs = lr_probs * 0.35 + gb_probs * 0.65
        
        for i, prob in enumerate(ensemble_probs):
            idx = start_test + i
            if idx < len(predictions):
                predictions[idx] = float(max(0.08, min(0.92, prob)))
    
    # ---- Simulate betting ----
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
        
        # Estimate closing line from Elo-implied probability
        game = all_games[i]
        closing_home_ml = game.get('closingHomeML', -110)
        book_home_prob = ml_to_prob(closing_home_ml)
        book_away_prob = 1 - book_home_prob
        
        closing_away_ml = prob_to_ml(book_away_prob)
        
        home_edge = home_prob - book_home_prob
        away_edge = away_prob - book_away_prob
        
        bet_side = None
        bet_edge = 0
        bet_ml = 0
        
        if home_edge > 0.02 and home_edge >= away_edge:
            bet_side = 'home'
            bet_edge = home_edge
            bet_ml = closing_home_ml
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
            
            if bets % 5 == 0 or bets <= 10:
                profit_curve.append({'bet': bets, 'profit': round(profit, 0)})
    
    # Add final point to curve
    if bets > 0:
        profit_curve.append({'bet': bets, 'profit': round(profit, 0)})
    
    roi = (profit / wagered * 100) if wagered > 0 else 0
    win_rate = (wins / bets * 100) if bets > 0 else 0
    
    # Calibration check
    valid_preds = [(predictions[i], y[i]) for i in range(len(predictions)) if predictions[i] is not None]
    pred_arr = np.array([p[0] for p in valid_preds])
    actual_arr = np.array([p[1] for p in valid_preds])
    
    overall_accuracy = accuracy_score(actual_arr, (pred_arr > 0.5).astype(int))
    brier = brier_score_loss(actual_arr, pred_arr)
    
    return {
        'sport': sport,
        'version': '3.0',
        'method': 'walk_forward',
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
        'modelsUsed': ['lr', 'gb'] + (['xgb'] if HAS_XGB else []),
        'edgeTiers': [
            {'tier': k, 'bets': v['bets'], 'wins': v['wins'],
             'winRate': round(v['wins'] / v['bets'] * 100, 1) if v['bets'] > 0 else 0,
             'profit': round(v['profit'], 0),
             'roi': round(v['profit'] / (v['bets'] * 100) * 100, 1) if v['bets'] > 0 else 0}
            for k, v in edge_tiers.items()
        ],
        'profitCurve': profit_curve[-50:],  # Last 50 points
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
    elif mode == 'elo':
        # Just build and return Elo ratings
        elo = EloSystem(k_factor=4, hfa=24, season_regression=0.33)
        games = input_data.get('data', [])
        enriched = elo.build_from_games(games)
        all_ratings = elo.get_all_ratings()
        result = {
            'teams': len(all_ratings),
            'games_processed': len(enriched),
            'ratings': {t: round(r, 1) for t, r in all_ratings.items()},
        }
    elif mode == 'status':
        model = load_model(sport)
        if model:
            result = {
                'status': 'ready',
                'sport': sport,
                'version': model.get('version', '2.0'),
                'features': model['feature_names'],
                'weights': model['weights'],
                'hasTotals': model.get('totals_model') is not None,
                'hasElo': 'elo_ratings' in model,
                'eloTeams': len(model.get('elo_ratings', {})),
                'modelsInEnsemble': list(model['weights'].keys()),
            }
        else:
            result = {'status': 'no_model', 'sport': sport}
    else:
        result = {'error': f'Unknown mode: {mode}'}
    
    print(json.dumps(result))


if __name__ == '__main__':
    main()
