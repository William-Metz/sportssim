"""
Historical Data Fetcher — Pulls game data for model training
Sources: basketball-reference.com, baseball-reference.com, hockey-reference.com
"""

import requests
import pandas as pd
import json
import os
import time
from datetime import datetime, timedelta

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; SportsSim/1.0; +https://sportssim.hatch.fun)'
}

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)


def fetch_nba_season(season_year, delay=2):
    """Fetch NBA game results for a full season from basketball-reference.
    
    Args:
        season_year: End year of season (e.g., 2024 for 2023-24 season)
        delay: Seconds between requests (respect rate limits)
    
    Returns:
        DataFrame with game-level data
    """
    games = []
    months = ['october', 'november', 'december', 'january', 'february', 
              'march', 'april', 'may', 'june']
    
    for month in months:
        url = f'https://www.basketball-reference.com/leagues/NBA_{season_year}_games-{month}.html'
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code != 200:
                continue
            
            # Parse HTML tables
            dfs = pd.read_html(resp.text)
            if dfs:
                df = dfs[0]
                # Clean columns
                if 'Date' in df.columns:
                    for _, row in df.iterrows():
                        try:
                            game = {
                                'date': str(row.get('Date', '')),
                                'away_team': str(row.get('Visitor/Neutral', '')),
                                'away_pts': int(row.get('PTS', 0)) if 'PTS' in df.columns else 0,
                                'home_team': str(row.get('Home/Neutral', '')),
                                'home_pts': int(row.get('PTS.1', 0)) if 'PTS.1' in df.columns else 0,
                            }
                            if game['away_team'] and game['home_team'] and game['date'] != 'Playoffs':
                                games.append(game)
                        except (ValueError, TypeError):
                            continue
            
            time.sleep(delay)
        except Exception as e:
            print(f"Error fetching {month} {season_year}: {e}")
            continue
    
    if not games:
        return pd.DataFrame()
    
    df = pd.DataFrame(games)
    df['season'] = season_year
    df['home_win'] = (df['home_pts'] > df['away_pts']).astype(int)
    
    # Save to disk
    path = os.path.join(DATA_DIR, f'nba_{season_year}.csv')
    df.to_csv(path, index=False)
    print(f"Saved {len(df)} NBA games for {season_year} to {path}")
    
    return df


def fetch_nba_team_stats(season_year):
    """Fetch team-level stats (off/def rating, pace) for a season."""
    url = f'https://www.basketball-reference.com/leagues/NBA_{season_year}.html'
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        dfs = pd.read_html(resp.text)
        # Look for the advanced stats table
        for df in dfs:
            if 'ORtg' in df.columns or 'Off Rtg' in df.columns:
                return df
        return None
    except Exception as e:
        print(f"Error fetching team stats: {e}")
        return None


def fetch_mlb_season(season_year, delay=2):
    """Fetch MLB game results for a season from baseball-reference."""
    url = f'https://www.baseball-reference.com/leagues/majors/{season_year}-schedule.shtml'
    games = []
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            dfs = pd.read_html(resp.text)
            for df in dfs:
                if len(df.columns) >= 4:
                    for _, row in df.iterrows():
                        try:
                            game = {
                                'date': str(row.iloc[0]),
                                'away_team': str(row.iloc[1]) if len(row) > 1 else '',
                                'away_runs': int(row.iloc[2]) if len(row) > 2 else 0,
                                'home_team': str(row.iloc[3]) if len(row) > 3 else '',
                                'home_runs': int(row.iloc[4]) if len(row) > 4 else 0,
                            }
                            games.append(game)
                        except (ValueError, TypeError, IndexError):
                            continue
    except Exception as e:
        print(f"Error fetching MLB {season_year}: {e}")
    
    if games:
        df = pd.DataFrame(games)
        df['season'] = season_year
        df['home_win'] = (df['home_runs'] > df['away_runs']).astype(int)
        path = os.path.join(DATA_DIR, f'mlb_{season_year}.csv')
        df.to_csv(path, index=False)
        print(f"Saved {len(df)} MLB games for {season_year}")
        return df
    
    return pd.DataFrame()


def fetch_nhl_season(season_year, delay=2):
    """Fetch NHL game results for a season from hockey-reference."""
    url = f'https://www.hockey-reference.com/leagues/NHL_{season_year}_games.html'
    games = []
    
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            dfs = pd.read_html(resp.text)
            for df in dfs:
                if 'Date' in df.columns:
                    for _, row in df.iterrows():
                        try:
                            game = {
                                'date': str(row.get('Date', '')),
                                'away_team': str(row.get('Visitor', '')),
                                'away_goals': int(row.get('G', 0)),
                                'home_team': str(row.get('Home', '')),
                                'home_goals': int(row.get('G.1', 0)),
                            }
                            if game['date'] != 'Date':
                                games.append(game)
                        except (ValueError, TypeError):
                            continue
    except Exception as e:
        print(f"Error fetching NHL {season_year}: {e}")
    
    if games:
        df = pd.DataFrame(games)
        df['season'] = season_year
        df['home_win'] = (df['home_goals'] > df['away_goals']).astype(int)
        path = os.path.join(DATA_DIR, f'nhl_{season_year}.csv')
        df.to_csv(path, index=False)
        print(f"Saved {len(df)} NHL games for {season_year}")
        return df
    
    return pd.DataFrame()


def fetch_all_historical(sports=None, years=None):
    """Fetch all historical data.
    
    Args:
        sports: List of sports ['nba', 'mlb', 'nhl']. Default: all
        years: Range of years. Default: last 10 seasons
    """
    if sports is None:
        sports = ['nba', 'mlb', 'nhl']
    if years is None:
        current_year = datetime.now().year
        years = range(current_year - 9, current_year + 1)
    
    results = {}
    
    for sport in sports:
        all_games = []
        for year in years:
            print(f"Fetching {sport.upper()} {year}...")
            try:
                if sport == 'nba':
                    df = fetch_nba_season(year)
                elif sport == 'mlb':
                    df = fetch_mlb_season(year)
                elif sport == 'nhl':
                    df = fetch_nhl_season(year)
                else:
                    continue
                
                if len(df) > 0:
                    all_games.append(df)
                time.sleep(3)  # Be polite to servers
            except Exception as e:
                print(f"Error: {e}")
                continue
        
        if all_games:
            combined = pd.concat(all_games, ignore_index=True)
            path = os.path.join(DATA_DIR, f'{sport}_all.csv')
            combined.to_csv(path, index=False)
            results[sport] = len(combined)
            print(f"\n✅ {sport.upper()}: {len(combined)} total games saved to {path}")
    
    return results


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Fetch historical sports data')
    parser.add_argument('--sport', choices=['nba', 'mlb', 'nhl', 'all'], default='all')
    parser.add_argument('--year', type=int, help='Specific season year')
    parser.add_argument('--years', type=int, default=10, help='Number of years to fetch')
    args = parser.parse_args()
    
    sports = [args.sport] if args.sport != 'all' else None
    years = [args.year] if args.year else None
    
    if years is None:
        current_year = datetime.now().year
        years = range(current_year - args.years + 1, current_year + 1)
    
    results = fetch_all_historical(sports=sports, years=years)
    print(f"\n🎯 Done! Results: {results}")
