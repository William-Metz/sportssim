//! # Engine Crypto
//! Funding rate arbitrage, DEX price comparison, MVRV signal, on-chain analytics.

use chrono::{DateTime, Utc};
use engine_core::{Asset, AssetClass, Signal, SignalDirection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Funding Rate Arbitrage ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FundingRateArb {
    pub symbol: String,
    pub exchange: String,
    pub perp_price: f64,
    pub spot_price: f64,
    pub funding_rate: f64,       // 8h funding rate (e.g., 0.01 = 1%)
    pub annualized_rate: f64,    // funding_rate * 3 * 365
    pub basis: f64,              // (perp - spot) / spot
    pub direction: String,       // "SHORT_PERP_LONG_SPOT" or "LONG_PERP_SHORT_SPOT"
    pub estimated_apy: f64,
    pub timestamp: DateTime<Utc>,
}

/// Calculate funding rate arbitrage opportunity.
/// Strategy: When funding is positive (longs pay shorts), short the perp + buy spot.
/// When funding is negative, long the perp + sell spot.
pub fn calc_funding_arb(
    symbol: &str,
    exchange: &str,
    perp_price: f64,
    spot_price: f64,
    funding_rate_8h: f64,
) -> FundingRateArb {
    let annualized = funding_rate_8h * 3.0 * 365.0; // 3 funding periods/day * 365 days
    let basis = if spot_price > 0.0 {
        (perp_price - spot_price) / spot_price
    } else {
        0.0
    };

    let (direction, estimated_apy) = if funding_rate_8h > 0.0 {
        // Positive funding: longs pay shorts. Short perp + long spot.
        ("SHORT_PERP_LONG_SPOT".to_string(), annualized)
    } else {
        // Negative funding: shorts pay longs. Long perp + short spot.
        ("LONG_PERP_SHORT_SPOT".to_string(), annualized.abs())
    };

    FundingRateArb {
        symbol: symbol.to_string(),
        exchange: exchange.to_string(),
        perp_price,
        spot_price,
        funding_rate: funding_rate_8h,
        annualized_rate: annualized,
        basis,
        direction,
        estimated_apy,
        timestamp: Utc::now(),
    }
}

/// Scan multiple exchanges for funding arb opportunities.
/// Returns sorted by APY descending.
pub fn scan_funding_arbs(
    data: &[(&str, &str, f64, f64, f64)], // (symbol, exchange, perp, spot, funding_8h)
    min_apy: f64,
) -> Vec<FundingRateArb> {
    let mut arbs: Vec<FundingRateArb> = data
        .iter()
        .map(|(sym, ex, perp, spot, rate)| calc_funding_arb(sym, ex, *perp, *spot, *rate))
        .filter(|a| a.estimated_apy >= min_apy)
        .collect();
    arbs.sort_by(|a, b| b.estimated_apy.partial_cmp(&a.estimated_apy).unwrap_or(std::cmp::Ordering::Equal));
    arbs
}

// ─── DEX Price Comparison ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexPrice {
    pub token: String,
    pub dex: String,
    pub price: f64,
    pub liquidity: f64,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexArbOpportunity {
    pub token: String,
    pub buy_dex: String,
    pub buy_price: f64,
    pub sell_dex: String,
    pub sell_price: f64,
    pub spread_pct: f64,
    pub estimated_profit_bps: f64, // after gas + slippage estimate
    pub min_liquidity: f64,
}

/// Find DEX arbitrage opportunities across multiple DEXes.
/// Compares prices pairwise, accounts for estimated gas + slippage.
pub fn find_dex_arbs(
    prices: &[DexPrice],
    gas_cost_bps: f64,    // gas cost in basis points
    slippage_bps: f64,    // estimated slippage in bps
) -> Vec<DexArbOpportunity> {
    let mut opportunities = Vec::new();

    // Group by token
    let mut by_token: HashMap<String, Vec<&DexPrice>> = HashMap::new();
    for p in prices {
        by_token.entry(p.token.clone()).or_default().push(p);
    }

    for (token, dex_prices) in &by_token {
        for i in 0..dex_prices.len() {
            for j in (i + 1)..dex_prices.len() {
                let a = dex_prices[i];
                let b = dex_prices[j];

                let (buy, sell) = if a.price < b.price {
                    (a, b)
                } else {
                    (b, a)
                };

                if buy.price <= 0.0 {
                    continue;
                }
                let spread_pct = ((sell.price - buy.price) / buy.price) * 10000.0; // bps
                let net_profit = spread_pct - gas_cost_bps - slippage_bps;

                if net_profit > 0.0 {
                    opportunities.push(DexArbOpportunity {
                        token: token.clone(),
                        buy_dex: buy.dex.clone(),
                        buy_price: buy.price,
                        sell_dex: sell.dex.clone(),
                        sell_price: sell.price,
                        spread_pct,
                        estimated_profit_bps: net_profit,
                        min_liquidity: buy.liquidity.min(sell.liquidity),
                    });
                }
            }
        }
    }

    opportunities.sort_by(|a, b| {
        b.estimated_profit_bps
            .partial_cmp(&a.estimated_profit_bps)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    opportunities
}

// ─── MVRV Ratio (Market Value to Realized Value) ──────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MvrvSignal {
    pub asset: String,
    pub mvrv_ratio: f64,
    pub signal: String,     // "UNDERVALUED", "FAIR", "OVERVALUED", "EXTREME_OVERVALUED"
    pub z_score: f64,
    pub timestamp: DateTime<Utc>,
}

/// MVRV ratio signal.
/// MVRV < 1.0 → undervalued (accumulate)
/// MVRV 1.0-2.5 → fair value
/// MVRV 2.5-3.5 → overvalued (reduce)
/// MVRV > 3.5 → extreme (sell)
pub fn mvrv_signal(asset: &str, market_cap: f64, realized_cap: f64) -> MvrvSignal {
    let ratio = if realized_cap > 0.0 {
        market_cap / realized_cap
    } else {
        1.0
    };

    let signal = match ratio {
        r if r < 1.0 => "UNDERVALUED",
        r if r < 2.5 => "FAIR",
        r if r < 3.5 => "OVERVALUED",
        _ => "EXTREME_OVERVALUED",
    };

    // Simplified z-score (historical mean ~1.5, std ~0.8)
    let z = (ratio - 1.5) / 0.8;

    MvrvSignal {
        asset: asset.to_string(),
        mvrv_ratio: ratio,
        signal: signal.to_string(),
        z_score: z,
        timestamp: Utc::now(),
    }
}

// ─── SOPR (Spent Output Profit Ratio) ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoprSignal {
    pub sopr: f64,
    pub signal: String,
    pub description: String,
}

/// SOPR signal.
/// SOPR > 1 → coins moving at profit (bullish in bull markets)
/// SOPR < 1 → coins moving at loss (capitulation if persistent)
/// SOPR = 1 → breakeven (often support/resistance level)
pub fn sopr_signal(sopr: f64) -> SoprSignal {
    let (signal, desc) = if sopr > 1.05 {
        ("PROFIT_TAKING", "Coins moving at significant profit — potential local top")
    } else if sopr > 1.0 {
        ("BULLISH", "Coins moving at slight profit — healthy trend")
    } else if sopr > 0.95 {
        ("BEARISH", "Coins moving at slight loss — selling pressure")
    } else {
        ("CAPITULATION", "Coins moving at significant loss — potential bottom")
    };

    SoprSignal {
        sopr,
        signal: signal.to_string(),
        description: desc.to_string(),
    }
}

// ─── Whale Wallet Tracking ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhaleMovement {
    pub wallet: String,
    pub token: String,
    pub amount: f64,
    pub usd_value: f64,
    pub direction: String, // "INFLOW" (to exchange) or "OUTFLOW" (from exchange)
    pub exchange: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// Aggregate whale movements to determine net flow direction.
/// Net inflow to exchanges = bearish (selling). Net outflow = bullish (accumulating).
pub fn analyze_whale_flows(movements: &[WhaleMovement]) -> (f64, f64, String) {
    let inflow: f64 = movements
        .iter()
        .filter(|m| m.direction == "INFLOW")
        .map(|m| m.usd_value)
        .sum();
    let outflow: f64 = movements
        .iter()
        .filter(|m| m.direction == "OUTFLOW")
        .map(|m| m.usd_value)
        .sum();

    let net = inflow - outflow;
    let signal = if net > 0.0 {
        "BEARISH_NET_INFLOW".to_string()
    } else {
        "BULLISH_NET_OUTFLOW".to_string()
    };

    (inflow, outflow, signal)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_funding_arb_positive() {
        let arb = calc_funding_arb("BTC", "Binance", 65100.0, 65000.0, 0.001);
        assert_eq!(arb.direction, "SHORT_PERP_LONG_SPOT");
        assert!((arb.annualized_rate - 1.095).abs() < 0.01); // ~109.5% APY
    }

    #[test]
    fn test_funding_arb_negative() {
        let arb = calc_funding_arb("ETH", "Bybit", 3400.0, 3420.0, -0.0005);
        assert_eq!(arb.direction, "LONG_PERP_SHORT_SPOT");
    }

    #[test]
    fn test_mvrv_undervalued() {
        let s = mvrv_signal("BTC", 800_000_000_000.0, 900_000_000_000.0);
        assert_eq!(s.signal, "UNDERVALUED");
        assert!(s.mvrv_ratio < 1.0);
    }

    #[test]
    fn test_mvrv_overvalued() {
        let s = mvrv_signal("BTC", 2_000_000_000_000.0, 700_000_000_000.0);
        assert_eq!(s.signal, "OVERVALUED");
    }

    #[test]
    fn test_sopr() {
        let s = sopr_signal(0.90);
        assert_eq!(s.signal, "CAPITULATION");
    }

    #[test]
    fn test_dex_arb() {
        let prices = vec![
            DexPrice { token: "ETH".into(), dex: "Uniswap".into(), price: 3400.0, liquidity: 1_000_000.0, timestamp: Utc::now() },
            DexPrice { token: "ETH".into(), dex: "Sushiswap".into(), price: 3420.0, liquidity: 500_000.0, timestamp: Utc::now() },
        ];
        let arbs = find_dex_arbs(&prices, 5.0, 10.0); // 5bps gas, 10bps slippage
        // Spread = ~59bps, net = ~44bps → should find it
        assert!(!arbs.is_empty());
        assert!(arbs[0].estimated_profit_bps > 0.0);
    }
}
