"""
SportsSim ML API Server
=======================
Lightweight Flask API that serves ML predictions.
Called by the Node.js server for ensemble predictions.

Endpoints:
  GET  /health              — Health check
  GET  /status              — Model status + training stats
  POST /predict/:sport      — Get ML prediction for a game
  POST /train               — Retrain all models
  POST /train/:sport        — Retrain specific sport model
  POST /add-game/:sport     — Add a completed game for retraining
  GET  /features/:sport     — Get feature importance rankings
  POST /compare/:sport      — Compare ML vs analytical model predictions
"""

import json
import sys
import os
import logging
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))

from flask import Flask, request, jsonify
from engine import (
    models, train_all, load_all,
    extract_nba_features, extract_mlb_features, extract_nhl_features,
    load_nba_training_data, load_mlb_training_data,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [ML-API] %(message)s')
logger = logging.getLogger('ml-api')

app = Flask(__name__)

# ==================== ROUTES ====================

@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'service': 'sportssim-ml',
        'version': '1.0.0',
        'models': {
            sport: {
                'trained': m.is_trained,
                'features': len(m.feature_names) if m.feature_names else 0,
            }
            for sport, m in models.items()
        }
    })

@app.route('/status')
def status():
    return jsonify({
        sport: {
            'trained': m.is_trained,
            'train_stats': m.train_stats,
            'features': m.feature_names,
        }
        for sport, m in models.items()
    })

@app.route('/predict/<sport>', methods=['POST'])
def predict(sport):
    """
    Get ML prediction for a game.
    
    POST body should contain game_data dict matching the sport's feature extractor.
    """
    sport = sport.lower()
    model = models.get(sport)
    if not model:
        return jsonify({'error': f'Unknown sport: {sport}'}), 400
    if not model.is_trained:
        return jsonify({'error': f'{sport} model not trained yet', 'fallback': True}), 200
    
    game_data = request.get_json()
    if not game_data:
        return jsonify({'error': 'No game data provided'}), 400
    
    # Extract features based on sport
    extractors = {
        'nba': extract_nba_features,
        'mlb': extract_mlb_features,
        'nhl': extract_nhl_features,
    }
    
    extractor = extractors.get(sport)
    if not extractor:
        return jsonify({'error': f'No feature extractor for {sport}'}), 400
    
    try:
        features = extractor(game_data)
        result = model.predict_spread(features)
        result['sport'] = sport
        return jsonify(result)
    except Exception as e:
        logger.error(f'Prediction error: {e}')
        return jsonify({'error': str(e), 'fallback': True}), 500

@app.route('/train', methods=['POST'])
def train():
    """Retrain all models"""
    try:
        results = train_all()
        return jsonify({
            'status': 'trained',
            'results': results,
        })
    except Exception as e:
        logger.error(f'Training error: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/train/<sport>', methods=['POST'])
def train_sport(sport):
    """Retrain a specific sport model"""
    sport = sport.lower()
    model = models.get(sport)
    if not model:
        return jsonify({'error': f'Unknown sport: {sport}'}), 400
    
    try:
        loaders = {
            'nba': load_nba_training_data,
            'mlb': load_mlb_training_data,
        }
        loader = loaders.get(sport)
        if not loader:
            return jsonify({'error': f'No data loader for {sport}'}), 400
        
        X, y = loader()
        if X is None or len(X) == 0:
            return jsonify({'error': 'No training data available'}), 400
        
        success = model.train(X, y)
        if success:
            model.save()
            return jsonify({'status': 'trained', 'stats': model.train_stats})
        else:
            return jsonify({'error': 'Training failed'}), 500
    except Exception as e:
        logger.error(f'Training error for {sport}: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/features/<sport>')
def features(sport):
    """Get feature importance rankings"""
    sport = sport.lower()
    model = models.get(sport)
    if not model or not model.is_trained:
        return jsonify({'error': f'{sport} model not trained'}), 400
    
    importances = {}
    
    # XGBoost feature importance
    if model.xgb_model and hasattr(model.xgb_model, 'feature_importances_'):
        xgb_imp = dict(zip(model.feature_names, model.xgb_model.feature_importances_))
        importances['xgb'] = dict(sorted(xgb_imp.items(), key=lambda x: x[1], reverse=True))
    
    # LightGBM feature importance
    if model.lgb_model and hasattr(model.lgb_model, 'feature_importances_'):
        lgb_imp = dict(zip(model.feature_names, model.lgb_model.feature_importances_))
        importances['lgb'] = dict(sorted(lgb_imp.items(), key=lambda x: x[1], reverse=True))
    
    # Logistic Regression coefficients
    if model.lr_model and hasattr(model.lr_model, 'coef_'):
        lr_coef = dict(zip(model.feature_names, model.lr_model.coef_[0]))
        importances['lr'] = dict(sorted(lr_coef.items(), key=lambda x: abs(x[1]), reverse=True))
    
    return jsonify(importances)

@app.route('/compare/<sport>', methods=['POST'])
def compare(sport):
    """
    Compare ML prediction vs analytical model prediction.
    Useful for finding where models disagree (potential edge).
    
    POST body: {game_data: {...}, analytical: {homeWinProb, spread, ...}}
    """
    sport = sport.lower()
    model = models.get(sport)
    if not model or not model.is_trained:
        return jsonify({'error': f'{sport} model not trained'}), 400
    
    data = request.get_json()
    if not data or 'game_data' not in data:
        return jsonify({'error': 'Missing game_data'}), 400
    
    game_data = data['game_data']
    analytical = data.get('analytical', {})
    
    extractors = {
        'nba': extract_nba_features,
        'mlb': extract_mlb_features,
        'nhl': extract_nhl_features,
    }
    
    extractor = extractors.get(sport)
    features = extractor(game_data)
    ml_pred = model.predict_spread(features)
    
    # Compare
    ml_home_prob = ml_pred.get('home_win_prob', 0.5)
    analytical_home_prob = analytical.get('homeWinProb', 50) / 100  # convert from % to decimal
    
    disagreement = abs(ml_home_prob - analytical_home_prob)
    
    return jsonify({
        'ml': ml_pred,
        'analytical': analytical,
        'comparison': {
            'ml_home_prob': round(ml_home_prob, 4),
            'analytical_home_prob': round(analytical_home_prob, 4),
            'disagreement': round(disagreement, 4),
            'ml_favors': 'home' if ml_home_prob > 0.5 else 'away',
            'analytical_favors': 'home' if analytical_home_prob > 0.5 else 'away',
            'models_agree': (ml_home_prob > 0.5) == (analytical_home_prob > 0.5),
            'potential_edge': disagreement > 0.05,
        }
    })

@app.route('/batch-predict/<sport>', methods=['POST'])
def batch_predict(sport):
    """
    Predict multiple games at once.
    POST body: {games: [{game_data: {...}}, ...]}
    """
    sport = sport.lower()
    model = models.get(sport)
    if not model or not model.is_trained:
        return jsonify({'error': f'{sport} model not trained'}), 400
    
    data = request.get_json()
    games = data.get('games', [])
    
    extractors = {
        'nba': extract_nba_features,
        'mlb': extract_mlb_features,
        'nhl': extract_nhl_features,
    }
    
    extractor = extractors.get(sport)
    results = []
    
    for game in games:
        try:
            features = extractor(game.get('game_data', game))
            pred = model.predict_spread(features)
            pred['game_id'] = game.get('id', '')
            results.append(pred)
        except Exception as e:
            results.append({'error': str(e), 'game_id': game.get('id', '')})
    
    return jsonify({'predictions': results})


# ==================== STARTUP ====================

def start_server(port=5050):
    """Load models and start the API server"""
    logger.info('Loading saved models...')
    load_all()
    
    # Auto-train if no models loaded
    any_trained = any(m.is_trained for m in models.values())
    if not any_trained:
        logger.info('No saved models found — training from scratch...')
        results = train_all()
        logger.info(f'Training results: {json.dumps(results, indent=2)}')
    
    trained = sum(1 for m in models.values() if m.is_trained)
    logger.info(f'{trained}/{len(models)} models ready')
    
    app.run(host='0.0.0.0', port=port, debug=False)

if __name__ == '__main__':
    port = int(os.environ.get('ML_PORT', 5050))
    start_server(port)
