//! # Engine Core
//! Shared types, Kelly criterion, probability math, position sizing, portfolio risk.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Asset Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum AssetClass {
    SportsBet,
    Equity,
    Crypto,
    Option,
    PredictionMarket,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub symbol: String,
    pub class: AssetClass,
    pub name: String,
}

// ─── Signal / Edge ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SignalDirection {
    Long,  // Buy / Over / Home
    Short, // Sell / Under / Away
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    pub asset: Asset,
    pub direction: SignalDirection,
    pub model_prob: f64,       // our model's probability
    pub market_prob: f64,      // implied from market odds
    pub edge: f64,             // model_prob - market_prob
    pub confidence: f64,       // 0.0 - 1.0
    pub timestamp: DateTime<Utc>,
    pub metadata: HashMap<String, String>,
}

impl Signal {
    pub fn has_edge(&self) -> bool {
        self.edge > 0.0
    }

    pub fn edge_pct(&self) -> f64 {
        if self.market_prob > 0.0 {
            (self.edge / self.market_prob) * 100.0
        } else {
            0.0
        }
    }
}

// ─── Odds Conversion ─────────────────────────────────────────────────────────

/// Convert American odds to implied probability.
/// +150 → 0.4, -200 → 0.6667
pub fn american_to_prob(odds: f64) -> f64 {
    if odds > 0.0 {
        100.0 / (odds + 100.0)
    } else {
        let abs_odds = odds.abs();
        abs_odds / (abs_odds + 100.0)
    }
}

/// Convert decimal odds to implied probability.
/// 2.50 → 0.4, 1.50 → 0.6667
pub fn decimal_to_prob(odds: f64) -> f64 {
    if odds > 0.0 {
        1.0 / odds
    } else {
        0.0
    }
}

/// Convert implied probability to American odds.
pub fn prob_to_american(prob: f64) -> f64 {
    if prob <= 0.0 || prob >= 1.0 {
        return 0.0;
    }
    if prob >= 0.5 {
        -(prob / (1.0 - prob)) * 100.0
    } else {
        ((1.0 - prob) / prob) * 100.0
    }
}

/// Convert American odds to decimal odds.
pub fn american_to_decimal(odds: f64) -> f64 {
    if odds > 0.0 {
        (odds / 100.0) + 1.0
    } else {
        (100.0 / odds.abs()) + 1.0
    }
}

/// Remove vig from a two-way market (home/away implied probs).
/// Returns (true_home_prob, true_away_prob).
pub fn remove_vig(home_implied: f64, away_implied: f64) -> (f64, f64) {
    let total = home_implied + away_implied;
    if total > 0.0 {
        (home_implied / total, away_implied / total)
    } else {
        (0.5, 0.5)
    }
}

// ─── Kelly Criterion ──────────────────────────────────────────────────────────

/// Full Kelly fraction: f* = (bp - q) / b
/// where b = decimal_odds - 1, p = win_prob, q = 1 - p
pub fn kelly_full(win_prob: f64, decimal_odds: f64) -> f64 {
    if decimal_odds <= 1.0 || win_prob <= 0.0 || win_prob >= 1.0 {
        return 0.0;
    }
    let b = decimal_odds - 1.0;
    let p = win_prob;
    let q = 1.0 - p;
    let f = (b * p - q) / b;
    f.max(0.0) // never bet negative
}

/// Fractional Kelly: kelly_full * fraction (typical: 0.25 to 0.33)
pub fn kelly_fractional(win_prob: f64, decimal_odds: f64, fraction: f64) -> f64 {
    kelly_full(win_prob, decimal_odds) * fraction.clamp(0.0, 1.0)
}

/// Kelly for American odds convenience
pub fn kelly_american(win_prob: f64, american_odds: f64, fraction: f64) -> f64 {
    let decimal = american_to_decimal(american_odds);
    kelly_fractional(win_prob, decimal, fraction)
}

/// Multi-bet Kelly: simultaneous independent bets with correlated bankroll impact.
/// Uses iterative approach: allocate Kelly to each bet, then normalize if total > max_exposure.
pub fn kelly_portfolio(
    bets: &[(f64, f64)], // Vec of (win_prob, decimal_odds)
    fraction: f64,
    max_exposure: f64,   // max total bankroll fraction (e.g. 0.25)
) -> Vec<f64> {
    let mut sizes: Vec<f64> = bets
        .iter()
        .map(|(p, odds)| kelly_fractional(*p, *odds, fraction))
        .collect();

    let total: f64 = sizes.iter().sum();
    if total > max_exposure && total > 0.0 {
        let scale = max_exposure / total;
        for s in sizes.iter_mut() {
            *s *= scale;
        }
    }
    sizes
}

// ─── Edge Calculation ─────────────────────────────────────────────────────────

/// Calculate edge: model_prob - implied_prob
pub fn calc_edge(model_prob: f64, implied_prob: f64) -> f64 {
    model_prob - implied_prob
}

/// Calculate expected value per unit wagered
/// EV = (win_prob * net_payout) - (loss_prob * stake)
pub fn expected_value(win_prob: f64, decimal_odds: f64) -> f64 {
    let net = decimal_odds - 1.0;
    (win_prob * net) - (1.0 - win_prob)
}

// ─── Position & Portfolio ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub asset: Asset,
    pub direction: SignalDirection,
    pub size: f64,          // fraction of bankroll
    pub entry_price: f64,   // odds or price at entry
    pub current_price: f64, // current odds or price
    pub pnl: f64,           // realized + unrealized P&L
    pub opened_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Portfolio {
    pub bankroll: f64,
    pub positions: Vec<Position>,
    pub total_pnl: f64,
    pub total_wagered: f64,
    pub win_count: u32,
    pub loss_count: u32,
}

impl Portfolio {
    pub fn new(bankroll: f64) -> Self {
        Self {
            bankroll,
            positions: Vec::new(),
            total_pnl: 0.0,
            total_wagered: 0.0,
            win_count: 0,
            loss_count: 0,
        }
    }

    pub fn win_rate(&self) -> f64 {
        let total = self.win_count + self.loss_count;
        if total == 0 {
            return 0.0;
        }
        self.win_count as f64 / total as f64
    }

    pub fn roi(&self) -> f64 {
        if self.total_wagered > 0.0 {
            (self.total_pnl / self.total_wagered) * 100.0
        } else {
            0.0
        }
    }

    pub fn current_exposure(&self) -> f64 {
        self.positions.iter().map(|p| p.size).sum()
    }
}

// ─── Performance Metrics ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub total_return: f64,
    pub annualized_return: f64,
    pub sharpe_ratio: f64,
    pub sortino_ratio: f64,
    pub max_drawdown: f64,
    pub calmar_ratio: f64,
    pub win_rate: f64,
    pub profit_factor: f64,
    pub total_trades: u32,
    pub avg_trade_pnl: f64,
}

/// Compute Sharpe ratio from a series of returns.
/// sharpe = mean(returns) / std(returns) * sqrt(252) for daily
pub fn sharpe_ratio(returns: &[f64], annualize_factor: f64) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }
    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / n;
    let std_dev = variance.sqrt();
    if std_dev == 0.0 {
        return 0.0;
    }
    (mean / std_dev) * annualize_factor.sqrt()
}

/// Compute Sortino ratio (only penalizes downside volatility).
pub fn sortino_ratio(returns: &[f64], annualize_factor: f64) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }
    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;
    let downside_var = returns
        .iter()
        .filter(|r| **r < 0.0)
        .map(|r| r.powi(2))
        .sum::<f64>()
        / n;
    let downside_std = downside_var.sqrt();
    if downside_std == 0.0 {
        return 0.0;
    }
    (mean / downside_std) * annualize_factor.sqrt()
}

/// Compute maximum drawdown from an equity curve.
pub fn max_drawdown(equity_curve: &[f64]) -> f64 {
    if equity_curve.is_empty() {
        return 0.0;
    }
    let mut peak = equity_curve[0];
    let mut max_dd = 0.0_f64;
    for &val in equity_curve {
        if val > peak {
            peak = val;
        }
        let dd = (peak - val) / peak;
        if dd > max_dd {
            max_dd = dd;
        }
    }
    max_dd
}

/// Calmar ratio = annualized return / max drawdown
pub fn calmar_ratio(annualized_return: f64, max_dd: f64) -> f64 {
    if max_dd == 0.0 {
        return 0.0;
    }
    annualized_return / max_dd
}

/// Profit factor = gross_wins / gross_losses
pub fn profit_factor(returns: &[f64]) -> f64 {
    let gross_wins: f64 = returns.iter().filter(|r| **r > 0.0).sum();
    let gross_losses: f64 = returns.iter().filter(|r| **r < 0.0).map(|r| r.abs()).sum();
    if gross_losses == 0.0 {
        return f64::INFINITY;
    }
    gross_wins / gross_losses
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_american_to_prob() {
        let p = american_to_prob(150.0);
        assert!((p - 0.4).abs() < 0.001);
        let p2 = american_to_prob(-200.0);
        assert!((p2 - 0.6667).abs() < 0.001);
    }

    #[test]
    fn test_decimal_to_prob() {
        assert!((decimal_to_prob(2.5) - 0.4).abs() < 0.001);
        assert!((decimal_to_prob(1.5) - 0.6667).abs() < 0.001);
    }

    #[test]
    fn test_kelly_full() {
        // 55% edge at +110 (decimal 2.10)
        let f = kelly_full(0.55, 2.10);
        assert!((f - 0.141).abs() < 0.01);
    }

    #[test]
    fn test_kelly_no_edge() {
        // 40% at even money should be 0
        let f = kelly_full(0.40, 2.0);
        assert!(f < 0.001);
    }

    #[test]
    fn test_kelly_fractional() {
        let full = kelly_full(0.55, 2.10);
        let quarter = kelly_fractional(0.55, 2.10, 0.25);
        assert!((quarter - full * 0.25).abs() < 0.001);
    }

    #[test]
    fn test_sharpe_ratio() {
        let returns = vec![0.01, 0.02, -0.005, 0.015, -0.01, 0.03, 0.005];
        let sr = sharpe_ratio(&returns, 252.0);
        assert!(sr > 0.0);
    }

    #[test]
    fn test_max_drawdown() {
        let curve = vec![100.0, 105.0, 103.0, 110.0, 95.0, 108.0];
        let dd = max_drawdown(&curve);
        // Peak 110, trough 95 → dd = 15/110 = 0.1364
        assert!((dd - 0.1364).abs() < 0.01);
    }

    #[test]
    fn test_remove_vig() {
        let (h, a) = remove_vig(0.55, 0.50);
        // total = 1.05, true probs = 0.5238, 0.4762
        assert!((h - 0.5238).abs() < 0.01);
        assert!((a - 0.4762).abs() < 0.01);
    }

    #[test]
    fn test_expected_value() {
        // 55% at 2.10 → EV = 0.55*1.10 - 0.45 = 0.155
        let ev = expected_value(0.55, 2.10);
        assert!((ev - 0.155).abs() < 0.01);
    }

    #[test]
    fn test_portfolio_roi() {
        let mut p = Portfolio::new(1000.0);
        p.total_wagered = 500.0;
        p.total_pnl = 50.0;
        assert!((p.roi() - 10.0).abs() < 0.01);
    }
}
