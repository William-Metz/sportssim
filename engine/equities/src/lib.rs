//! # Engine Equities
//! Momentum, mean reversion, stat arb, SMA crossover, RSI, Bollinger Bands, factor models.

use engine_core::{Asset, AssetClass, Signal, SignalDirection};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Price Bar ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceBar {
    pub timestamp: DateTime<Utc>,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

// ─── Simple Moving Average ────────────────────────────────────────────────────

/// Calculate SMA over the last `period` closing prices.
pub fn sma(prices: &[f64], period: usize) -> Option<f64> {
    if prices.len() < period || period == 0 {
        return None;
    }
    let slice = &prices[prices.len() - period..];
    Some(slice.iter().sum::<f64>() / period as f64)
}

/// SMA crossover signal: returns +1 (bullish cross), -1 (bearish cross), 0 (no cross).
/// Fast SMA crosses above slow = bullish. Fast crosses below slow = bearish.
pub fn sma_crossover_signal(prices: &[f64], fast: usize, slow: usize) -> i8 {
    if prices.len() < slow + 1 {
        return 0;
    }
    let prev_prices = &prices[..prices.len() - 1];
    let curr_fast = sma(prices, fast);
    let curr_slow = sma(prices, slow);
    let prev_fast = sma(prev_prices, fast);
    let prev_slow = sma(prev_prices, slow);

    match (curr_fast, curr_slow, prev_fast, prev_slow) {
        (Some(cf), Some(cs), Some(pf), Some(ps)) => {
            if pf <= ps && cf > cs {
                1 // bullish crossover
            } else if pf >= ps && cf < cs {
                -1 // bearish crossover
            } else {
                0
            }
        }
        _ => 0,
    }
}

// ─── Exponential Moving Average ───────────────────────────────────────────────

/// Calculate EMA. Returns a vector of EMA values.
pub fn ema(prices: &[f64], period: usize) -> Vec<f64> {
    if prices.is_empty() || period == 0 {
        return vec![];
    }
    let k = 2.0 / (period as f64 + 1.0);
    let mut result = Vec::with_capacity(prices.len());
    result.push(prices[0]); // seed with first price
    for i in 1..prices.len() {
        let prev = result[i - 1];
        result.push(prices[i] * k + prev * (1.0 - k));
    }
    result
}

// ─── RSI (Relative Strength Index) ───────────────────────────────────────────

/// Calculate RSI for a price series. Returns RSI values (first `period` entries will ramp up).
pub fn rsi(prices: &[f64], period: usize) -> Vec<f64> {
    if prices.len() < 2 || period == 0 {
        return vec![];
    }
    let mut gains = Vec::new();
    let mut losses = Vec::new();
    let mut result = Vec::new();

    for i in 1..prices.len() {
        let change = prices[i] - prices[i - 1];
        if change > 0.0 {
            gains.push(change);
            losses.push(0.0);
        } else {
            gains.push(0.0);
            losses.push(change.abs());
        }
    }

    if gains.len() < period {
        return vec![];
    }

    // Initial average
    let mut avg_gain: f64 = gains[..period].iter().sum::<f64>() / period as f64;
    let mut avg_loss: f64 = losses[..period].iter().sum::<f64>() / period as f64;

    // Pad initial periods
    for _ in 0..period {
        result.push(50.0); // neutral placeholder
    }

    // RSI for first complete period
    let rs = if avg_loss > 0.0 { avg_gain / avg_loss } else { 100.0 };
    result.push(100.0 - (100.0 / (1.0 + rs)));

    // Smoothed RSI
    for i in period..gains.len() {
        avg_gain = (avg_gain * (period as f64 - 1.0) + gains[i]) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + losses[i]) / period as f64;
        let rs = if avg_loss > 0.0 { avg_gain / avg_loss } else { 100.0 };
        result.push(100.0 - (100.0 / (1.0 + rs)));
    }

    result
}

/// RSI signal: <30 = oversold (buy), >70 = overbought (sell)
pub fn rsi_signal(rsi_value: f64) -> i8 {
    if rsi_value < 30.0 {
        1 // oversold → buy
    } else if rsi_value > 70.0 {
        -1 // overbought → sell
    } else {
        0
    }
}

// ─── Bollinger Bands ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BollingerBands {
    pub upper: f64,
    pub middle: f64,
    pub lower: f64,
    pub bandwidth: f64,
    pub percent_b: f64,
}

/// Calculate Bollinger Bands for the current point.
pub fn bollinger_bands(prices: &[f64], period: usize, num_std: f64) -> Option<BollingerBands> {
    if prices.len() < period {
        return None;
    }
    let slice = &prices[prices.len() - period..];
    let mean = slice.iter().sum::<f64>() / period as f64;
    let variance = slice.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / period as f64;
    let std_dev = variance.sqrt();

    let upper = mean + num_std * std_dev;
    let lower = mean - num_std * std_dev;
    let current = *prices.last().unwrap();
    let bandwidth = if mean > 0.0 { (upper - lower) / mean } else { 0.0 };
    let percent_b = if upper > lower {
        (current - lower) / (upper - lower)
    } else {
        0.5
    };

    Some(BollingerBands {
        upper,
        middle: mean,
        lower,
        bandwidth,
        percent_b,
    })
}

/// Bollinger signal: price below lower band = buy, above upper = sell
pub fn bollinger_signal(bb: &BollingerBands, current_price: f64) -> i8 {
    if current_price <= bb.lower {
        1 // below lower band → buy (mean reversion)
    } else if current_price >= bb.upper {
        -1 // above upper band → sell
    } else {
        0
    }
}

// ─── Momentum Factor (12-1 Month) ────────────────────────────────────────────

/// Classic Jegadeesh-Titman momentum: return over months 2-12 (skip most recent month).
/// `monthly_returns` should be at least 12 entries (most recent last).
pub fn momentum_factor(monthly_returns: &[f64]) -> Option<f64> {
    if monthly_returns.len() < 12 {
        return None;
    }
    // Skip last month (month 1), take months 2-12
    let start = monthly_returns.len() - 12;
    let end = monthly_returns.len() - 1; // skip last
    let cum_return: f64 = monthly_returns[start..end]
        .iter()
        .fold(1.0, |acc, r| acc * (1.0 + r));
    Some(cum_return - 1.0) // total return over 11 months
}

/// Rank momentum across a universe. Returns (symbol, momentum) sorted desc.
pub fn rank_momentum(assets: &[(&str, Vec<f64>)]) -> Vec<(String, f64)> {
    let mut ranked: Vec<(String, f64)> = assets
        .iter()
        .filter_map(|(sym, returns)| {
            momentum_factor(returns).map(|m| (sym.to_string(), m))
        })
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked
}

// ─── Mean Reversion (Z-Score) ─────────────────────────────────────────────────

/// Z-score of current price relative to a lookback window.
/// z = (price - mean) / std_dev
pub fn zscore(prices: &[f64], lookback: usize) -> Option<f64> {
    if prices.len() < lookback || lookback == 0 {
        return None;
    }
    let slice = &prices[prices.len() - lookback..];
    let mean = slice.iter().sum::<f64>() / lookback as f64;
    let variance = slice.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / lookback as f64;
    let std_dev = variance.sqrt();
    if std_dev == 0.0 {
        return Some(0.0);
    }
    let current = *prices.last().unwrap();
    Some((current - mean) / std_dev)
}

/// Mean reversion signal: z < -2 = buy, z > 2 = sell
pub fn mean_reversion_signal(z: f64, threshold: f64) -> i8 {
    if z < -threshold {
        1 // oversold → buy
    } else if z > threshold {
        -1 // overbought → sell
    } else {
        0
    }
}

// ─── Pairs Trading (Stat Arb) ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairSpread {
    pub asset_a: String,
    pub asset_b: String,
    pub spread: Vec<f64>,
    pub zscore: f64,
    pub half_life: f64, // estimated mean reversion half-life
    pub correlation: f64,
}

/// Calculate spread between two price series (log ratio).
pub fn pair_spread(prices_a: &[f64], prices_b: &[f64]) -> Vec<f64> {
    prices_a
        .iter()
        .zip(prices_b.iter())
        .map(|(a, b)| {
            if *b > 0.0 && *a > 0.0 {
                (a / b).ln()
            } else {
                0.0
            }
        })
        .collect()
}

/// Correlation between two series.
pub fn correlation(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len().min(b.len());
    if n < 2 {
        return 0.0;
    }
    let mean_a = a[..n].iter().sum::<f64>() / n as f64;
    let mean_b = b[..n].iter().sum::<f64>() / n as f64;

    let mut cov = 0.0;
    let mut var_a = 0.0;
    let mut var_b = 0.0;
    for i in 0..n {
        let da = a[i] - mean_a;
        let db = b[i] - mean_b;
        cov += da * db;
        var_a += da * da;
        var_b += db * db;
    }
    let denom = (var_a * var_b).sqrt();
    if denom == 0.0 {
        0.0
    } else {
        cov / denom
    }
}

/// Estimate half-life of mean reversion via OLS on spread deltas.
/// ΔS_t = α + β * S_{t-1} + ε
/// half_life = -ln(2) / β
pub fn estimate_half_life(spread: &[f64]) -> f64 {
    if spread.len() < 3 {
        return f64::INFINITY;
    }
    let n = spread.len() - 1;
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut sum_xy = 0.0;
    let mut sum_x2 = 0.0;

    for i in 0..n {
        let x = spread[i];
        let y = spread[i + 1] - spread[i];
        sum_x += x;
        sum_y += y;
        sum_xy += x * y;
        sum_x2 += x * x;
    }

    let nf = n as f64;
    let beta = (nf * sum_xy - sum_x * sum_y) / (nf * sum_x2 - sum_x * sum_x);

    if beta >= 0.0 {
        return f64::INFINITY; // not mean-reverting
    }
    -(2.0_f64.ln()) / beta
}

// ─── Composite Signal Generator ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquitySignal {
    pub symbol: String,
    pub timestamp: DateTime<Utc>,
    pub sma_signal: i8,
    pub rsi_signal: i8,
    pub rsi_value: f64,
    pub bollinger_signal: i8,
    pub bollinger_pct_b: f64,
    pub momentum: Option<f64>,
    pub zscore: Option<f64>,
    pub composite_score: f64, // weighted sum of signals
    pub direction: String,    // "LONG", "SHORT", "NEUTRAL"
}

/// Generate composite signal for a stock.
pub fn generate_equity_signal(
    symbol: &str,
    prices: &[f64],
    monthly_returns: &[f64],
) -> Option<EquitySignal> {
    if prices.len() < 50 {
        return None;
    }

    let sma_sig = sma_crossover_signal(prices, 10, 50);
    let rsi_vals = rsi(prices, 14);
    let rsi_val = rsi_vals.last().copied().unwrap_or(50.0);
    let rsi_sig = rsi_signal(rsi_val);
    let bb = bollinger_bands(prices, 20, 2.0);
    let bb_sig = bb.as_ref().map(|b| bollinger_signal(b, *prices.last().unwrap())).unwrap_or(0);
    let bb_pct_b = bb.as_ref().map(|b| b.percent_b).unwrap_or(0.5);
    let mom = momentum_factor(monthly_returns);
    let z = zscore(prices, 20);

    // Composite: weighted average of signals
    let composite = sma_sig as f64 * 0.25
        + rsi_sig as f64 * 0.20
        + bb_sig as f64 * 0.20
        + mom.unwrap_or(0.0).signum() * 0.20
        + z.map(|v| mean_reversion_signal(v, 2.0) as f64).unwrap_or(0.0) * 0.15;

    let direction = if composite > 0.3 {
        "LONG"
    } else if composite < -0.3 {
        "SHORT"
    } else {
        "NEUTRAL"
    };

    Some(EquitySignal {
        symbol: symbol.to_string(),
        timestamp: Utc::now(),
        sma_signal: sma_sig,
        rsi_signal: rsi_sig,
        rsi_value: rsi_val,
        bollinger_signal: bb_sig,
        bollinger_pct_b: bb_pct_b,
        momentum: mom,
        zscore: z,
        composite_score: composite,
        direction: direction.to_string(),
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sma() {
        let prices = vec![10.0, 11.0, 12.0, 11.5, 13.0];
        let s = sma(&prices, 3).unwrap();
        assert!((s - 12.1667).abs() < 0.01);
    }

    #[test]
    fn test_rsi_bounds() {
        let prices: Vec<f64> = (0..100).map(|i| 100.0 + (i as f64) * 0.5).collect();
        let r = rsi(&prices, 14);
        if let Some(last) = r.last() {
            assert!(*last >= 0.0 && *last <= 100.0);
        }
    }

    #[test]
    fn test_bollinger() {
        let prices: Vec<f64> = (0..30).map(|i| 100.0 + (i as f64 * 0.1).sin() * 5.0).collect();
        let bb = bollinger_bands(&prices, 20, 2.0);
        assert!(bb.is_some());
        let b = bb.unwrap();
        assert!(b.upper > b.middle);
        assert!(b.middle > b.lower);
    }

    #[test]
    fn test_zscore() {
        let prices: Vec<f64> = vec![100.0; 20];
        let z = zscore(&prices, 20).unwrap();
        assert!((z - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_correlation() {
        let a = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let b = vec![2.0, 4.0, 6.0, 8.0, 10.0];
        let c = correlation(&a, &b);
        assert!((c - 1.0).abs() < 0.001); // perfect positive
    }

    #[test]
    fn test_momentum() {
        let returns = vec![0.05, 0.03, -0.02, 0.04, 0.01, 0.02, -0.01, 0.03, 0.02, 0.01, 0.04, 0.03];
        let m = momentum_factor(&returns).unwrap();
        assert!(m > 0.0); // positive momentum
    }

    #[test]
    fn test_pair_spread() {
        let a = vec![100.0, 102.0, 101.0, 103.0];
        let b = vec![50.0, 51.0, 50.5, 52.0];
        let s = pair_spread(&a, &b);
        assert_eq!(s.len(), 4);
    }
}
