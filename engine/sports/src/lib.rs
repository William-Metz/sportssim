//! # Engine Sports
//! NBA, MLB, NHL, NFL models: Poisson, Pythagorean, Elo, spread conversion, value detection.

use chrono::{DateTime, Utc};
use engine_core::{
    calc_edge, american_to_prob, decimal_to_prob, kelly_fractional,
    Asset, AssetClass, Signal, SignalDirection,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Poisson Model (MLB/NHL totals & run expectation) ─────────────────────────

/// Poisson probability: P(X=k) = (λ^k * e^-λ) / k!
pub fn poisson_pmf(lambda: f64, k: u32) -> f64 {
    if lambda <= 0.0 {
        return if k == 0 { 1.0 } else { 0.0 };
    }
    let mut ln_result = -(lambda) + (k as f64) * lambda.ln();
    // subtract ln(k!)
    for i in 1..=k {
        ln_result -= (i as f64).ln();
    }
    ln_result.exp()
}

/// Poisson CDF: P(X <= k)
pub fn poisson_cdf(lambda: f64, k: u32) -> f64 {
    (0..=k).map(|i| poisson_pmf(lambda, i)).sum()
}

/// Given home/away expected runs, compute win probability using Poisson.
/// Sums P(home=h)*P(away=a) for all h>a, plus 0.5 * P(tie) for extras approx.
pub fn poisson_win_prob(home_runs: f64, away_runs: f64, max_runs: u32) -> f64 {
    let mut home_win = 0.0;
    let mut tie = 0.0;

    for h in 0..=max_runs {
        let p_h = poisson_pmf(home_runs, h);
        for a in 0..=max_runs {
            let p_a = poisson_pmf(away_runs, a);
            let joint = p_h * p_a;
            if h > a {
                home_win += joint;
            } else if h == a {
                tie += joint;
            }
        }
    }
    // Approximate extra innings: home wins ~52% of ties (home field)
    home_win + tie * 0.52
}

/// Over/under probability for a total line.
/// P(over) = 1 - P(total_runs <= floor(line))
pub fn poisson_over_prob(home_runs: f64, away_runs: f64, line: f64, max_runs: u32) -> f64 {
    let total_lambda = home_runs + away_runs;
    let threshold = line.floor() as u32;
    let under_prob = poisson_cdf(total_lambda, threshold);
    // If line is integer, P(push) = P(exactly line). For half-lines, no push.
    if (line - line.floor()).abs() < 0.01 {
        // Integer line: P(over) = 1 - P(under or push)
        1.0 - under_prob
    } else {
        // Half-line (e.g., 8.5): P(over) = 1 - P(<=8) = 1 - CDF(8)
        1.0 - poisson_cdf(total_lambda, threshold)
    }
}

// ─── Pythagorean Expectation ──────────────────────────────────────────────────

/// Pythagorean expected win%: RS^exp / (RS^exp + RA^exp)
/// MLB exponent ≈ 1.83, NBA ≈ 13.91, NHL ≈ 2.05, NFL ≈ 2.37
pub fn pythagorean_win_pct(runs_scored: f64, runs_allowed: f64, exponent: f64) -> f64 {
    if runs_scored <= 0.0 && runs_allowed <= 0.0 {
        return 0.5;
    }
    let rs_exp = runs_scored.powf(exponent);
    let ra_exp = runs_allowed.powf(exponent);
    if rs_exp + ra_exp == 0.0 {
        return 0.5;
    }
    rs_exp / (rs_exp + ra_exp)
}

/// Sport-specific Pythagorean exponents
pub fn pyth_exponent(sport: &str) -> f64 {
    match sport.to_lowercase().as_str() {
        "mlb" => 1.83,
        "nba" => 13.91,
        "nhl" => 2.05,
        "nfl" => 2.37,
        _ => 2.0,
    }
}

// ─── Elo Rating System ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EloRating {
    pub team: String,
    pub rating: f64,
    pub games_played: u32,
}

impl EloRating {
    pub fn new(team: &str, initial: f64) -> Self {
        Self {
            team: team.to_string(),
            rating: initial,
            games_played: 0,
        }
    }
}

/// Expected score for team A vs team B: E_A = 1 / (1 + 10^((R_B - R_A) / 400))
pub fn elo_expected(rating_a: f64, rating_b: f64) -> f64 {
    1.0 / (1.0 + 10.0_f64.powf((rating_b - rating_a) / 400.0))
}

/// Update Elo ratings after a game.
/// K-factor varies by sport (NFL: 20, NBA: 20, MLB: 4, NHL: 6).
/// Returns (new_rating_a, new_rating_b).
pub fn elo_update(
    rating_a: f64,
    rating_b: f64,
    score_a: f64, // 1.0 = win, 0.5 = draw, 0.0 = loss
    k_factor: f64,
) -> (f64, f64) {
    let expected_a = elo_expected(rating_a, rating_b);
    let expected_b = 1.0 - expected_a;
    let score_b = 1.0 - score_a;

    let new_a = rating_a + k_factor * (score_a - expected_a);
    let new_b = rating_b + k_factor * (score_b - expected_b);
    (new_a, new_b)
}

/// Elo K-factor by sport
pub fn elo_k_factor(sport: &str) -> f64 {
    match sport.to_lowercase().as_str() {
        "nfl" => 20.0,
        "nba" => 20.0,
        "mlb" => 4.0,
        "nhl" => 6.0,
        _ => 10.0,
    }
}

// ─── Spread to Probability Conversion ─────────────────────────────────────────

/// Convert a point spread to win probability using logistic model.
/// Based on empirical data: each point of spread ≈ 2.5-3% win prob shift in NBA/NFL.
pub fn spread_to_prob(spread: f64, sport: &str) -> f64 {
    let factor = match sport.to_lowercase().as_str() {
        "nba" => 15.0,  // calibrated: spread/15 in logistic
        "nfl" => 13.5,
        "nhl" => 8.0,
        "mlb" => 10.0,
        _ => 12.0,
    };
    // logistic: P(home_win) = 1 / (1 + e^(spread / factor))
    // Negative spread = home favored
    1.0 / (1.0 + (-spread / factor).exp())
}

/// Convert win probability to implied spread.
pub fn prob_to_spread(prob: f64, sport: &str) -> f64 {
    let factor = match sport.to_lowercase().as_str() {
        "nba" => 15.0,
        "nfl" => 13.5,
        "nhl" => 8.0,
        "mlb" => 10.0,
        _ => 12.0,
    };
    if prob <= 0.0 || prob >= 1.0 {
        return 0.0;
    }
    -factor * (prob / (1.0 - prob)).ln()
}

// ─── Value Bet Detection ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValueBet {
    pub game: String,
    pub sport: String,
    pub bet_type: String,      // "ML", "Spread", "Total"
    pub side: String,           // "Home", "Away", "Over", "Under"
    pub book: String,
    pub book_odds: f64,         // American odds
    pub model_prob: f64,
    pub implied_prob: f64,
    pub edge: f64,
    pub edge_pct: f64,
    pub kelly_size: f64,        // recommended bet size (fraction of bankroll)
    pub confidence: String,     // "LOW", "MEDIUM", "HIGH", "SMASH"
}

/// Scan for value bets given model prob and market odds.
pub fn find_value(
    game: &str,
    sport: &str,
    bet_type: &str,
    side: &str,
    book: &str,
    book_odds_american: f64,
    model_prob: f64,
    kelly_fraction: f64,
    min_edge: f64,
) -> Option<ValueBet> {
    let implied = american_to_prob(book_odds_american);
    let edge = calc_edge(model_prob, implied);

    if edge < min_edge {
        return None;
    }

    let decimal_odds = engine_core::american_to_decimal(book_odds_american);
    let kelly = kelly_fractional(model_prob, decimal_odds, kelly_fraction);
    let edge_pct = if implied > 0.0 {
        (edge / implied) * 100.0
    } else {
        0.0
    };

    let confidence = match edge_pct {
        e if e >= 15.0 => "SMASH",
        e if e >= 8.0 => "HIGH",
        e if e >= 4.0 => "MEDIUM",
        _ => "LOW",
    };

    Some(ValueBet {
        game: game.to_string(),
        sport: sport.to_string(),
        bet_type: bet_type.to_string(),
        side: side.to_string(),
        book: book.to_string(),
        book_odds: book_odds_american,
        model_prob,
        implied_prob: implied,
        edge,
        edge_pct,
        kelly_size: kelly,
        confidence: confidence.to_string(),
    })
}

// ─── Team Rating Model ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamRating {
    pub team: String,
    pub sport: String,
    pub overall: f64,
    pub offense: f64,
    pub defense: f64,
    pub pythagorean_wpct: f64,
    pub elo: f64,
    pub wins: u32,
    pub losses: u32,
    pub record: String,
}

/// Build a team rating from scoring data.
pub fn build_team_rating(
    team: &str,
    sport: &str,
    points_for: f64,
    points_against: f64,
    games: u32,
    wins: u32,
    losses: u32,
    elo: f64,
) -> TeamRating {
    let ppg = if games > 0 { points_for / games as f64 } else { 0.0 };
    let papg = if games > 0 { points_against / games as f64 } else { 0.0 };
    let exp = pyth_exponent(sport);
    let pyth = pythagorean_win_pct(points_for, points_against, exp);

    TeamRating {
        team: team.to_string(),
        sport: sport.to_string(),
        overall: (ppg - papg) * 10.0, // net rating scaled
        offense: ppg,
        defense: papg,
        pythagorean_wpct: pyth,
        elo,
        wins,
        losses,
        record: format!("{}-{}", wins, losses),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_poisson_pmf() {
        // P(X=3) with λ=4.5
        let p = poisson_pmf(4.5, 3);
        assert!((p - 0.1687).abs() < 0.01);
    }

    #[test]
    fn test_poisson_win_prob() {
        // Home expects 4.5 runs, away 3.8 → home should win >50%
        let hw = poisson_win_prob(4.5, 3.8, 15);
        assert!(hw > 0.5);
        assert!(hw < 0.7);
    }

    #[test]
    fn test_poisson_over() {
        // Total expected 8.3, line 8.5 → over prob should be ~45%
        let over = poisson_over_prob(4.5, 3.8, 8.5, 20);
        assert!(over > 0.35 && over < 0.55);
    }

    #[test]
    fn test_pythagorean() {
        // MLB team: 800 RS, 700 RA → should be ~56%
        let pct = pythagorean_win_pct(800.0, 700.0, 1.83);
        assert!((pct - 0.564).abs() < 0.02);
    }

    #[test]
    fn test_elo() {
        let e = elo_expected(1500.0, 1500.0);
        assert!((e - 0.5).abs() < 0.001);

        let e2 = elo_expected(1600.0, 1400.0);
        assert!(e2 > 0.7);
    }

    #[test]
    fn test_elo_update() {
        let (new_a, new_b) = elo_update(1500.0, 1500.0, 1.0, 20.0);
        assert!(new_a > 1500.0);
        assert!(new_b < 1500.0);
        assert!((new_a - new_b - 20.0).abs() < 0.01);
    }

    #[test]
    fn test_spread_to_prob() {
        // Even spread → ~50%
        let p = spread_to_prob(0.0, "nba");
        assert!((p - 0.5).abs() < 0.001);

        // Home -7 in NBA → ~62%
        let p2 = spread_to_prob(-7.0, "nba");
        assert!(p2 > 0.55 && p2 < 0.70);
    }

    #[test]
    fn test_find_value() {
        let bet = find_value(
            "LAL @ BOS", "nba", "ML", "Home", "DraftKings",
            -150.0, 0.70, 0.25, 0.02,
        );
        assert!(bet.is_some());
        let vb = bet.unwrap();
        assert!(vb.edge > 0.0);
    }
}
