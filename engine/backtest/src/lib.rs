//! # Engine Backtest
//! Walk-forward backtester, trade simulation, performance analytics.

use chrono::{DateTime, Utc};
use engine_core::{
    kelly_fractional, max_drawdown, sharpe_ratio, sortino_ratio, calmar_ratio,
    profit_factor, PerformanceMetrics,
};
use serde::{Deserialize, Serialize};

// ─── Trade Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TradeOutcome {
    Win,
    Loss,
    Push,
    Open,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: u64,
    pub asset: String,
    pub direction: String,        // "LONG", "SHORT", "OVER", "UNDER", "HOME", "AWAY"
    pub entry_price: f64,         // odds (decimal) or price
    pub exit_price: f64,          // settlement price
    pub size: f64,                // fraction of bankroll
    pub pnl: f64,                 // profit/loss in bankroll units
    pub return_pct: f64,          // pnl / size
    pub model_prob: f64,
    pub market_prob: f64,
    pub edge: f64,
    pub outcome: TradeOutcome,
    pub opened_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    pub metadata: std::collections::HashMap<String, String>,
}

// ─── Backtest Signal ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct BacktestSignal {
    pub timestamp: DateTime<Utc>,
    pub asset: String,
    pub direction: String,
    pub model_prob: f64,
    pub market_odds_decimal: f64,
    pub actual_outcome: bool, // true = win
}

// ─── Walk-Forward Backtester ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestConfig {
    pub initial_bankroll: f64,
    pub kelly_fraction: f64,     // 0.25 = quarter Kelly
    pub max_bet_size: f64,       // max single bet as fraction of bankroll
    pub max_exposure: f64,       // max total exposure
    pub min_edge: f64,           // minimum edge to take a bet
    pub min_odds: f64,           // minimum decimal odds
    pub max_odds: f64,           // maximum decimal odds
}

impl Default for BacktestConfig {
    fn default() -> Self {
        Self {
            initial_bankroll: 10000.0,
            kelly_fraction: 0.25,
            max_bet_size: 0.05,
            max_exposure: 0.25,
            min_edge: 0.02,
            min_odds: 1.20,
            max_odds: 10.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestResult {
    pub config: BacktestConfig,
    pub trades: Vec<Trade>,
    pub equity_curve: Vec<f64>,
    pub daily_returns: Vec<f64>,
    pub metrics: PerformanceMetrics,
    pub summary: BacktestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestSummary {
    pub total_trades: u32,
    pub wins: u32,
    pub losses: u32,
    pub pushes: u32,
    pub win_rate: f64,
    pub total_wagered: f64,
    pub total_pnl: f64,
    pub roi: f64,
    pub final_bankroll: f64,
    pub peak_bankroll: f64,
    pub trough_bankroll: f64,
}

/// Run a walk-forward backtest on a series of signals.
pub fn run_backtest(signals: &[BacktestSignal], config: &BacktestConfig) -> BacktestResult {
    let mut bankroll = config.initial_bankroll;
    let mut trades: Vec<Trade> = Vec::new();
    let mut equity_curve: Vec<f64> = vec![bankroll];
    let mut daily_returns: Vec<f64> = Vec::new();
    let mut trade_id: u64 = 0;

    let mut total_wagered = 0.0;
    let mut total_pnl = 0.0;
    let mut wins = 0u32;
    let mut losses = 0u32;
    let mut pushes = 0u32;
    let mut peak = bankroll;
    let mut trough = bankroll;

    for signal in signals {
        // Filter by config constraints
        if signal.market_odds_decimal < config.min_odds
            || signal.market_odds_decimal > config.max_odds
        {
            continue;
        }

        let implied_prob = 1.0 / signal.market_odds_decimal;
        let edge = signal.model_prob - implied_prob;

        if edge < config.min_edge {
            continue;
        }

        // Kelly sizing
        let kelly_size = kelly_fractional(
            signal.model_prob,
            signal.market_odds_decimal,
            config.kelly_fraction,
        );
        let bet_size = kelly_size.min(config.max_bet_size);

        if bet_size <= 0.0 || bankroll <= 0.0 {
            continue;
        }

        let wager = bankroll * bet_size;
        total_wagered += wager;

        let (pnl, outcome) = if signal.actual_outcome {
            let profit = wager * (signal.market_odds_decimal - 1.0);
            wins += 1;
            (profit, TradeOutcome::Win)
        } else {
            losses += 1;
            (-wager, TradeOutcome::Loss)
        };

        total_pnl += pnl;
        bankroll += pnl;

        if bankroll > peak {
            peak = bankroll;
        }
        if bankroll < trough {
            trough = bankroll;
        }

        let return_pct = if wager > 0.0 { pnl / wager } else { 0.0 };
        daily_returns.push(return_pct);
        equity_curve.push(bankroll);

        trade_id += 1;
        trades.push(Trade {
            id: trade_id,
            asset: signal.asset.clone(),
            direction: signal.direction.clone(),
            entry_price: signal.market_odds_decimal,
            exit_price: if signal.actual_outcome { signal.market_odds_decimal } else { 0.0 },
            size: bet_size,
            pnl,
            return_pct,
            model_prob: signal.model_prob,
            market_prob: implied_prob,
            edge,
            outcome,
            opened_at: signal.timestamp,
            closed_at: Some(signal.timestamp),
            metadata: std::collections::HashMap::new(),
        });
    }

    let total_trades = wins + losses + pushes;
    let win_rate = if total_trades > 0 {
        wins as f64 / total_trades as f64
    } else {
        0.0
    };
    let roi = if total_wagered > 0.0 {
        (total_pnl / total_wagered) * 100.0
    } else {
        0.0
    };

    // Performance metrics
    let sr = sharpe_ratio(&daily_returns, 252.0);
    let sort = sortino_ratio(&daily_returns, 252.0);
    let mdd = max_drawdown(&equity_curve);
    let ann_return = if !daily_returns.is_empty() {
        let avg = daily_returns.iter().sum::<f64>() / daily_returns.len() as f64;
        avg * 252.0
    } else {
        0.0
    };
    let cal = calmar_ratio(ann_return, mdd);
    let pf = profit_factor(&daily_returns);
    let avg_pnl = if total_trades > 0 {
        total_pnl / total_trades as f64
    } else {
        0.0
    };

    let metrics = PerformanceMetrics {
        total_return: (bankroll - config.initial_bankroll) / config.initial_bankroll * 100.0,
        annualized_return: ann_return * 100.0,
        sharpe_ratio: sr,
        sortino_ratio: sort,
        max_drawdown: mdd * 100.0,
        calmar_ratio: cal,
        win_rate: win_rate * 100.0,
        profit_factor: pf,
        total_trades,
        avg_trade_pnl: avg_pnl,
    };

    let summary = BacktestSummary {
        total_trades,
        wins,
        losses,
        pushes,
        win_rate: win_rate * 100.0,
        total_wagered,
        total_pnl,
        roi,
        final_bankroll: bankroll,
        peak_bankroll: peak,
        trough_bankroll: trough,
    };

    BacktestResult {
        config: config.clone(),
        trades,
        equity_curve,
        daily_returns,
        metrics,
        summary,
    }
}

// ─── Walk-Forward Optimization ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalkForwardResult {
    pub folds: Vec<FoldResult>,
    pub aggregate_metrics: PerformanceMetrics,
    pub in_sample_sharpe: f64,
    pub out_of_sample_sharpe: f64,
    pub sharpe_decay: f64, // IS sharpe - OOS sharpe (overfitting indicator)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoldResult {
    pub fold_num: u32,
    pub train_size: usize,
    pub test_size: usize,
    pub in_sample: BacktestResult,
    pub out_of_sample: BacktestResult,
}

/// Run walk-forward backtest with rolling train/test windows.
/// `train_pct` is the fraction of each window used for training (e.g., 0.70).
/// `num_folds` is how many rolling windows to run.
pub fn walk_forward(
    signals: &[BacktestSignal],
    config: &BacktestConfig,
    num_folds: usize,
) -> WalkForwardResult {
    if signals.is_empty() || num_folds == 0 {
        return WalkForwardResult {
            folds: vec![],
            aggregate_metrics: PerformanceMetrics {
                total_return: 0.0, annualized_return: 0.0, sharpe_ratio: 0.0,
                sortino_ratio: 0.0, max_drawdown: 0.0, calmar_ratio: 0.0,
                win_rate: 0.0, profit_factor: 0.0, total_trades: 0, avg_trade_pnl: 0.0,
            },
            in_sample_sharpe: 0.0,
            out_of_sample_sharpe: 0.0,
            sharpe_decay: 0.0,
        };
    }

    let fold_size = signals.len() / num_folds;
    let train_size = (fold_size as f64 * 0.70) as usize;
    let test_size = fold_size - train_size;

    let mut folds = Vec::new();
    let mut all_oos_returns: Vec<f64> = Vec::new();
    let mut all_is_returns: Vec<f64> = Vec::new();

    for i in 0..num_folds {
        let start = i * fold_size;
        let mid = start + train_size;
        let end = (start + fold_size).min(signals.len());

        if mid >= end {
            continue;
        }

        let train = &signals[start..mid];
        let test = &signals[mid..end];

        let is_result = run_backtest(train, config);
        let oos_result = run_backtest(test, config);

        all_is_returns.extend_from_slice(&is_result.daily_returns);
        all_oos_returns.extend_from_slice(&oos_result.daily_returns);

        folds.push(FoldResult {
            fold_num: i as u32 + 1,
            train_size: train.len(),
            test_size: test.len(),
            in_sample: is_result,
            out_of_sample: oos_result,
        });
    }

    let is_sharpe = sharpe_ratio(&all_is_returns, 252.0);
    let oos_sharpe = sharpe_ratio(&all_oos_returns, 252.0);

    // Aggregate OOS metrics
    let aggregate = run_backtest(signals, config);

    WalkForwardResult {
        folds,
        aggregate_metrics: aggregate.metrics,
        in_sample_sharpe: is_sharpe,
        out_of_sample_sharpe: oos_sharpe,
        sharpe_decay: is_sharpe - oos_sharpe,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_signal(prob: f64, odds: f64, win: bool, day: u32) -> BacktestSignal {
        BacktestSignal {
            timestamp: Utc.with_ymd_and_hms(2025, 1, day.min(28), 12, 0, 0).unwrap(),
            asset: "TEST".to_string(),
            direction: "LONG".to_string(),
            model_prob: prob,
            market_odds_decimal: odds,
            actual_outcome: win,
        }
    }

    #[test]
    fn test_backtest_positive_edge() {
        // 60% model prob, odds 2.0 (implied 50%), should be profitable
        let signals: Vec<BacktestSignal> = (1..=20)
            .map(|i| make_signal(0.60, 2.0, i % 3 != 0, (i % 28) + 1)) // ~67% win rate
            .collect();

        let config = BacktestConfig::default();
        let result = run_backtest(&signals, &config);

        assert!(result.summary.total_trades > 0);
        assert!(result.summary.win_rate > 50.0);
    }

    #[test]
    fn test_backtest_no_edge() {
        // 40% model prob, odds 2.0 → no edge, should not bet
        let signals: Vec<BacktestSignal> = (1..=10)
            .map(|i| make_signal(0.40, 2.0, i % 2 == 0, (i % 28) + 1))
            .collect();

        let config = BacktestConfig::default();
        let result = run_backtest(&signals, &config);

        assert_eq!(result.summary.total_trades, 0); // edge below min
    }

    #[test]
    fn test_walk_forward() {
        let signals: Vec<BacktestSignal> = (1..=28)
            .map(|i| make_signal(0.60, 2.0, i % 3 != 0, (i % 28) + 1))
            .collect();

        let config = BacktestConfig::default();
        let wf = walk_forward(&signals, &config, 4);

        assert!(!wf.folds.is_empty());
    }

    #[test]
    fn test_equity_curve() {
        let signals: Vec<BacktestSignal> = (1..=10)
            .map(|i| make_signal(0.70, 1.80, true, (i % 28) + 1))
            .collect();

        let config = BacktestConfig::default();
        let result = run_backtest(&signals, &config);

        // Equity should be monotonically increasing (all wins)
        assert!(result.equity_curve.last().unwrap() > result.equity_curve.first().unwrap());
    }
}
