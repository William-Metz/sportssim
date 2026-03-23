//! # Engine API
//! Actix-web REST API serving all quantitative modules.

use actix_web::{web, App, HttpServer, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use chrono::Utc;

// ─── Health ───────────────────────────────────────────────────────────────────

async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "engine": "sportssim-rust",
        "version": "0.1.0",
        "timestamp": Utc::now().to_rfc3339(),
        "modules": ["sports", "equities", "crypto", "backtest"]
    }))
}

// ─── Sports Routes ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ValueScanQuery {
    sport: Option<String>,
    min_edge: Option<f64>,
}

async fn sports_value(query: web::Query<ValueScanQuery>) -> impl Responder {
    let sport = query.sport.clone().unwrap_or_else(|| "nba".to_string());
    let min_edge = query.min_edge.unwrap_or(0.03);

    // Demo: generate sample value bets using our models
    let demo_bets = vec![
        engine_sports::find_value(
            "LAL @ BOS", &sport, "ML", "Home", "DraftKings",
            -150.0, 0.68, 0.25, min_edge,
        ),
        engine_sports::find_value(
            "DEN @ PHX", &sport, "Spread", "Away", "FanDuel",
            110.0, 0.55, 0.25, min_edge,
        ),
        engine_sports::find_value(
            "MIL @ NYK", &sport, "Total", "Over", "BetMGM",
            -110.0, 0.58, 0.25, min_edge,
        ),
    ];

    let value_bets: Vec<_> = demo_bets.into_iter().flatten().collect();

    HttpResponse::Ok().json(serde_json::json!({
        "sport": sport,
        "min_edge": min_edge,
        "count": value_bets.len(),
        "value_bets": value_bets,
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn sports_ratings() -> impl Responder {
    // Demo ratings
    let ratings = vec![
        engine_sports::build_team_rating("BOS", "nba", 8500.0, 7800.0, 75, 55, 20, 1650.0),
        engine_sports::build_team_rating("OKC", "nba", 8600.0, 7700.0, 75, 56, 19, 1660.0),
        engine_sports::build_team_rating("DEN", "nba", 8200.0, 7900.0, 75, 48, 27, 1600.0),
        engine_sports::build_team_rating("NYK", "nba", 8100.0, 7850.0, 75, 46, 29, 1590.0),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "ratings": ratings,
        "sport": "nba",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

#[derive(Deserialize)]
struct PredictQuery {
    home: String,
    away: String,
    sport: Option<String>,
}

async fn sports_predict(query: web::Query<PredictQuery>) -> impl Responder {
    let sport = query.sport.clone().unwrap_or_else(|| "mlb".to_string());

    // Demo prediction using Poisson
    let home_runs = 4.5;
    let away_runs = 3.8;
    let win_prob = engine_sports::poisson_win_prob(home_runs, away_runs, 15);
    let over_prob = engine_sports::poisson_over_prob(home_runs, away_runs, 8.5, 20);

    HttpResponse::Ok().json(serde_json::json!({
        "home": query.home,
        "away": query.away,
        "sport": sport,
        "prediction": {
            "home_win_prob": (win_prob * 1000.0).round() / 1000.0,
            "away_win_prob": ((1.0 - win_prob) * 1000.0).round() / 1000.0,
            "expected_home_score": home_runs,
            "expected_away_score": away_runs,
            "expected_total": home_runs + away_runs,
            "over_8_5_prob": (over_prob * 1000.0).round() / 1000.0,
        },
        "model": "poisson",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// ─── Equities Routes ──────────────────────────────────────────────────────────

async fn equities_signals() -> impl Responder {
    // Demo: generate signals for some stocks
    let prices_aapl: Vec<f64> = (0..100).map(|i| 180.0 + (i as f64 * 0.07).sin() * 10.0 + i as f64 * 0.1).collect();
    let monthly_aapl = vec![0.03, 0.02, -0.01, 0.04, 0.01, 0.02, -0.02, 0.03, 0.01, 0.02, 0.04, 0.01];

    let prices_msft: Vec<f64> = (0..100).map(|i| 420.0 + (i as f64 * 0.05).cos() * 15.0 + i as f64 * 0.05).collect();
    let monthly_msft = vec![0.02, 0.01, 0.03, -0.01, 0.02, 0.01, 0.03, -0.02, 0.01, 0.04, 0.02, 0.03];

    let signals: Vec<_> = [
        engine_equities::generate_equity_signal("AAPL", &prices_aapl, &monthly_aapl),
        engine_equities::generate_equity_signal("MSFT", &prices_msft, &monthly_msft),
    ]
    .into_iter()
    .flatten()
    .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "count": signals.len(),
        "signals": signals,
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn equities_momentum() -> impl Responder {
    let assets: Vec<(&str, Vec<f64>)> = vec![
        ("AAPL", vec![0.03, 0.02, -0.01, 0.04, 0.01, 0.02, -0.02, 0.03, 0.01, 0.02, 0.04, 0.01]),
        ("MSFT", vec![0.02, 0.01, 0.03, -0.01, 0.02, 0.01, 0.03, -0.02, 0.01, 0.04, 0.02, 0.03]),
        ("NVDA", vec![0.08, 0.06, 0.04, 0.09, -0.03, 0.07, 0.05, 0.06, 0.04, 0.08, 0.07, 0.05]),
        ("TSLA", vec![-0.02, 0.05, -0.04, 0.08, -0.06, 0.03, -0.01, 0.04, -0.03, 0.02, 0.06, -0.02]),
    ];
    let ranked = engine_equities::rank_momentum(&assets);

    HttpResponse::Ok().json(serde_json::json!({
        "ranked": ranked.iter().map(|(s, m)| serde_json::json!({"symbol": s, "momentum_12_1": m})).collect::<Vec<_>>(),
        "strategy": "12-1 month momentum (Jegadeesh-Titman)",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// ─── Crypto Routes ────────────────────────────────────────────────────────────

async fn crypto_funding() -> impl Responder {
    let arbs = engine_crypto::scan_funding_arbs(
        &[
            ("BTC", "Binance", 65100.0, 65000.0, 0.0010),
            ("BTC", "Bybit", 65080.0, 65000.0, 0.0008),
            ("ETH", "Binance", 3410.0, 3400.0, 0.0012),
            ("ETH", "dYdX", 3415.0, 3400.0, 0.0015),
            ("SOL", "Binance", 145.5, 145.0, 0.0020),
        ],
        10.0, // min 10% APY
    );

    HttpResponse::Ok().json(serde_json::json!({
        "count": arbs.len(),
        "opportunities": arbs,
        "strategy": "Funding rate arbitrage (short perp + long spot when funding positive)",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn crypto_mvrv() -> impl Responder {
    let btc = engine_crypto::mvrv_signal("BTC", 1_300_000_000_000.0, 600_000_000_000.0);
    let eth = engine_crypto::mvrv_signal("ETH", 410_000_000_000.0, 220_000_000_000.0);

    HttpResponse::Ok().json(serde_json::json!({
        "signals": [btc, eth],
        "description": "MVRV < 1.0 = undervalued, 1.0-2.5 = fair, 2.5-3.5 = overvalued, > 3.5 = extreme",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// ─── Backtest Routes ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct BacktestQuery {
    kelly_fraction: Option<f64>,
    min_edge: Option<f64>,
    num_folds: Option<usize>,
}

async fn backtest_run(query: web::Query<BacktestQuery>) -> impl Responder {
    use chrono::TimeZone;

    let mut config = engine_backtest::BacktestConfig::default();
    if let Some(kf) = query.kelly_fraction {
        config.kelly_fraction = kf;
    }
    if let Some(me) = query.min_edge {
        config.min_edge = me;
    }

    // Generate demo signals (simulated season)
    let signals: Vec<engine_backtest::BacktestSignal> = (1..=200)
        .map(|i| {
            let day = ((i - 1) % 28) + 1;
            let month = ((i - 1) / 28) + 1;
            let month = month.min(12) as u32;
            engine_backtest::BacktestSignal {
                timestamp: Utc.with_ymd_and_hms(2025, month, day as u32, 19, 0, 0).unwrap(),
                asset: format!("GAME_{}", i),
                direction: "HOME".to_string(),
                model_prob: 0.55 + (i as f64 * 0.01).sin() * 0.05,
                market_odds_decimal: 1.90 + (i as f64 * 0.02).cos() * 0.15,
                actual_outcome: i % 3 != 0, // ~67% win rate
            }
        })
        .collect();

    let num_folds = query.num_folds.unwrap_or(5);
    let wf_result = engine_backtest::walk_forward(&signals, &config, num_folds);

    HttpResponse::Ok().json(serde_json::json!({
        "type": "walk_forward_backtest",
        "num_signals": signals.len(),
        "num_folds": num_folds,
        "aggregate_metrics": wf_result.aggregate_metrics,
        "in_sample_sharpe": wf_result.in_sample_sharpe,
        "out_of_sample_sharpe": wf_result.out_of_sample_sharpe,
        "sharpe_decay": wf_result.sharpe_decay,
        "overfitting_risk": if wf_result.sharpe_decay > 0.5 { "HIGH" } else if wf_result.sharpe_decay > 0.2 { "MEDIUM" } else { "LOW" },
        "fold_summaries": wf_result.folds.iter().map(|f| serde_json::json!({
            "fold": f.fold_num,
            "train_size": f.train_size,
            "test_size": f.test_size,
            "is_roi": f.in_sample.summary.roi,
            "oos_roi": f.out_of_sample.summary.roi,
            "is_win_rate": f.in_sample.summary.win_rate,
            "oos_win_rate": f.out_of_sample.summary.win_rate,
        })).collect::<Vec<_>>(),
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// ─── Portfolio Routes ─────────────────────────────────────────────────────────

async fn portfolio_optimize() -> impl Responder {
    // Demo: Kelly portfolio optimization across multiple bets
    let bets = vec![
        (0.58, 1.95),  // NBA value bet
        (0.62, 1.80),  // MLB value bet
        (0.55, 2.10),  // NHL value bet
    ];
    let sizes = engine_core::kelly_portfolio(&bets, 0.25, 0.15);

    let allocations: Vec<_> = bets.iter().zip(sizes.iter()).enumerate().map(|(i, ((prob, odds), size))| {
        let labels = ["NBA Game", "MLB Game", "NHL Game"];
        serde_json::json!({
            "bet": labels.get(i).unwrap_or(&"Bet"),
            "model_prob": prob,
            "decimal_odds": odds,
            "kelly_size": (size * 10000.0).round() / 10000.0,
            "ev_per_unit": engine_core::expected_value(*prob, *odds),
        })
    }).collect();

    HttpResponse::Ok().json(serde_json::json!({
        "strategy": "Fractional Kelly (25%) with 15% max exposure cap",
        "allocations": allocations,
        "total_exposure": sizes.iter().sum::<f64>(),
        "timestamp": Utc::now().to_rfc3339()
    }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("ENGINE_PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse::<u16>()
        .unwrap_or(8081);

    println!("🥑 SportsSim Rust Engine starting on port {}", port);
    println!("  Modules: sports, equities, crypto, backtest");
    println!("  Endpoints:");
    println!("    GET /health");
    println!("    GET /api/sports/value?sport=nba&min_edge=0.03");
    println!("    GET /api/sports/ratings");
    println!("    GET /api/sports/predict?home=NYY&away=BOS&sport=mlb");
    println!("    GET /api/equities/signals");
    println!("    GET /api/equities/momentum");
    println!("    GET /api/crypto/funding");
    println!("    GET /api/crypto/mvrv");
    println!("    GET /api/backtest/run?kelly_fraction=0.25&min_edge=0.03");
    println!("    GET /api/portfolio/optimize");

    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/api/sports/value", web::get().to(sports_value))
            .route("/api/sports/ratings", web::get().to(sports_ratings))
            .route("/api/sports/predict", web::get().to(sports_predict))
            .route("/api/equities/signals", web::get().to(equities_signals))
            .route("/api/equities/momentum", web::get().to(equities_momentum))
            .route("/api/crypto/funding", web::get().to(crypto_funding))
            .route("/api/crypto/mvrv", web::get().to(crypto_mvrv))
            .route("/api/backtest/run", web::get().to(backtest_run))
            .route("/api/portfolio/optimize", web::get().to(portfolio_optimize))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
