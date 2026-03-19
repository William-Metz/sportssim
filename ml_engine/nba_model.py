"""
NBA ML Model — XGBoost-based game outcome predictor
Uses historical game data + team stats to predict outcomes
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, TimeSeriesSplit
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import json
import os

class NBAModel:
    """XGBoost NBA game prediction model with rolling features"""
    
    def __init__(self):
        self.model = None
        self.scaler = StandardScaler()
        self.feature_names = []
        self.trained = False
    
    def build_features(self, df):
        """Build feature matrix from game-level data.
        
        Expected columns in df:
        - home_team, away_team
        - home_pts, away_pts
        - date (datetime)
        - home_off_rtg, home_def_rtg, away_off_rtg, away_def_rtg
        - home_pace, away_pace
        - home_rest_days, away_rest_days
        - home_win_pct_l10, away_win_pct_l10
        - home_pt_diff_l10, away_pt_diff_l10
        """
        features = pd.DataFrame()
        
        # Power differential
        features['off_rtg_diff'] = df['home_off_rtg'] - df['away_off_rtg']
        features['def_rtg_diff'] = df['away_def_rtg'] - df['home_def_rtg']  # lower is better for defense
        features['net_rtg_diff'] = (df['home_off_rtg'] - df['home_def_rtg']) - (df['away_off_rtg'] - df['away_def_rtg'])
        
        # Pace factor
        features['pace_diff'] = df['home_pace'] - df['away_pace']
        features['avg_pace'] = (df['home_pace'] + df['away_pace']) / 2
        
        # Rest advantage
        features['rest_diff'] = df['home_rest_days'] - df['away_rest_days']
        features['home_b2b'] = (df['home_rest_days'] == 1).astype(int)
        features['away_b2b'] = (df['away_rest_days'] == 1).astype(int)
        
        # Recent form
        features['l10_winpct_diff'] = df['home_win_pct_l10'] - df['away_win_pct_l10']
        features['l10_ptdiff_diff'] = df['home_pt_diff_l10'] - df['away_pt_diff_l10']
        
        # Home court advantage (constant but helps model calibration)
        features['home_court'] = 1.0
        
        # Pythagorean expected win%
        home_pyth = df['home_off_rtg'] ** 14 / (df['home_off_rtg'] ** 14 + df['home_def_rtg'] ** 14)
        away_pyth = df['away_off_rtg'] ** 14 / (df['away_off_rtg'] ** 14 + df['away_def_rtg'] ** 14)
        features['pyth_diff'] = home_pyth - away_pyth
        
        self.feature_names = features.columns.tolist()
        return features
    
    def train(self, df, target_col='home_win'):
        """Train the XGBoost model.
        
        Args:
            df: DataFrame with game data
            target_col: Binary column (1 = home win, 0 = away win)
        """
        X = self.build_features(df)
        y = df[target_col].values
        
        # Time-based split (don't leak future data)
        split_idx = int(len(X) * 0.8)
        X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]
        
        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # XGBoost
        self.model = xgb.XGBClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            reg_alpha=0.1,
            reg_lambda=1.0,
            eval_metric='logloss',
            early_stopping_rounds=20,
            random_state=42
        )
        
        self.model.fit(
            X_train_scaled, y_train,
            eval_set=[(X_test_scaled, y_test)],
            verbose=False
        )
        
        # Evaluate
        y_pred_proba = self.model.predict_proba(X_test_scaled)[:, 1]
        y_pred = (y_pred_proba > 0.5).astype(int)
        
        results = {
            'accuracy': float(accuracy_score(y_test, y_pred)),
            'log_loss': float(log_loss(y_test, y_pred_proba)),
            'brier_score': float(brier_score_loss(y_test, y_pred_proba)),
            'test_size': len(y_test),
            'train_size': len(y_train),
            'feature_importance': dict(zip(self.feature_names, 
                                           [float(x) for x in self.model.feature_importances_]))
        }
        
        self.trained = True
        return results
    
    def predict(self, game_features):
        """Predict a single game.
        
        Args:
            game_features: dict with feature values
            
        Returns:
            dict with home_win_prob, away_win_prob, confidence
        """
        if not self.trained:
            raise ValueError("Model not trained yet")
        
        X = pd.DataFrame([game_features])[self.feature_names]
        X_scaled = self.scaler.transform(X)
        prob = float(self.model.predict_proba(X_scaled)[0, 1])
        
        return {
            'home_win_prob': round(prob * 100, 1),
            'away_win_prob': round((1 - prob) * 100, 1),
            'confidence': 'HIGH' if abs(prob - 0.5) > 0.15 else 'MEDIUM' if abs(prob - 0.5) > 0.08 else 'LOW',
            'raw_prob': prob
        }
    
    def backtest(self, df, target_col='home_win', window=500):
        """Walk-forward backtest with rolling training window.
        
        Trains on last `window` games, predicts next game, rolls forward.
        Returns betting performance metrics.
        """
        results = []
        
        for i in range(window, len(df)):
            train_df = df.iloc[i-window:i]
            test_row = df.iloc[i:i+1]
            
            try:
                X_train = self.build_features(train_df)
                y_train = train_df[target_col].values
                X_test = self.build_features(test_row)
                y_true = test_row[target_col].values[0]
                
                X_train_s = self.scaler.fit_transform(X_train)
                X_test_s = self.scaler.transform(X_test)
                
                model = xgb.XGBClassifier(
                    n_estimators=100, max_depth=3, learning_rate=0.1,
                    subsample=0.8, colsample_bytree=0.8, eval_metric='logloss',
                    random_state=42
                )
                model.fit(X_train_s, y_train, verbose=False)
                
                prob = float(model.predict_proba(X_test_s)[0, 1])
                pred = 1 if prob > 0.5 else 0
                
                results.append({
                    'game_idx': i,
                    'home_win_prob': prob,
                    'predicted': pred,
                    'actual': y_true,
                    'correct': pred == y_true,
                    'edge': abs(prob - 0.5) * 2
                })
            except Exception as e:
                continue
        
        if not results:
            return {'error': 'No backtest results generated'}
        
        results_df = pd.DataFrame(results)
        accuracy = results_df['correct'].mean()
        
        # Simulate betting: only bet when edge > 5%
        bets = results_df[results_df['edge'] > 0.05]
        if len(bets) > 0:
            bet_accuracy = bets['correct'].mean()
            # Assume -110 lines, flat $100 bets
            wins = bets['correct'].sum()
            losses = len(bets) - wins
            profit = wins * 90.91 - losses * 100  # -110 juice
            roi = profit / (len(bets) * 100) * 100
        else:
            bet_accuracy = 0
            roi = 0
            profit = 0
        
        return {
            'total_games': len(results_df),
            'accuracy': round(accuracy * 100, 1),
            'bets_placed': len(bets),
            'bet_accuracy': round(bet_accuracy * 100, 1),
            'roi': round(roi, 1),
            'profit': round(profit, 2),
            'avg_edge': round(results_df['edge'].mean() * 100, 1)
        }
    
    def save(self, path='nba_model.json'):
        """Save model to disk"""
        if self.model:
            self.model.save_model(path.replace('.json', '.xgb'))
            meta = {
                'feature_names': self.feature_names,
                'scaler_mean': self.scaler.mean_.tolist() if hasattr(self.scaler, 'mean_') else [],
                'scaler_scale': self.scaler.scale_.tolist() if hasattr(self.scaler, 'scale_') else [],
                'trained': self.trained
            }
            with open(path, 'w') as f:
                json.dump(meta, f)
    
    def load(self, path='nba_model.json'):
        """Load model from disk"""
        self.model = xgb.XGBClassifier()
        self.model.load_model(path.replace('.json', '.xgb'))
        with open(path) as f:
            meta = json.load(f)
        self.feature_names = meta['feature_names']
        if meta['scaler_mean']:
            self.scaler.mean_ = np.array(meta['scaler_mean'])
            self.scaler.scale_ = np.array(meta['scaler_scale'])
        self.trained = meta['trained']


if __name__ == '__main__':
    print("NBA ML Model initialized. Use data_fetcher.py to get training data, then train.")
    print(f"Features: {NBAModel().build_features.__doc__}")
