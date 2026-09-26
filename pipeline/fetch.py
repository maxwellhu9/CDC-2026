"""Pull every indicator we need from the World Bank Indicators API (v2).

One request per indicator: /country/all/indicator/{code}?date=1970:2025
returns every country AND every regional aggregate for all years. We drop
aggregates using the /country metadata (aggregates have region.id == "NA").

Raw JSON is cached in data/raw/ so re-runs are instant and we don't hammer
the API during development.
"""
import json
import time
from pathlib import Path

import pandas as pd
import requests

from indicators import INDICATORS

API = "https://api.worldbank.org/v2"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)


def get_all_pages(url: str, params: dict) -> list:
    """The API paginates; metadata lives in element [0], rows in element [1]."""
    rows, page = [], 1
    while True:
        for attempt in range(4):
            try:
                r = requests.get(url, params={**params, "format": "json", "page": page}, timeout=60)
                r.raise_for_status()
                payload = r.json()
                break
            except (requests.RequestException, ValueError):
                time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f"failed: {url} page {page}")
        meta, data = payload[0], payload[1] or []
        rows.extend(data)
        if page >= meta["pages"]:
            return rows
        page += 1


def fetch_countries() -> pd.DataFrame:
    rows = get_all_pages(f"{API}/country", {"per_page": 400})
    df = pd.DataFrame(
        {
            "iso3": r["id"],
            "iso2": r["iso2Code"],
            "name": r["name"],
            "region": r["region"]["value"].strip(),
            "income": r["incomeLevel"]["value"],
            "is_aggregate": r["region"]["id"] == "NA",
        }
        for r in rows
    )
    return df[~df.is_aggregate].drop(columns="is_aggregate")


def fetch_indicator(code: str) -> list:
    cache = RAW / f"{code}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    rows = get_all_pages(f"{API}/country/all/indicator/{code}", {"date": "1970:2025", "per_page": 20000})
    cache.write_text(json.dumps(rows))
    return rows


def main():
    countries = fetch_countries()
    countries.to_csv(ROOT / "data" / "countries.csv", index=False)
    print(f"{len(countries)} countries (aggregates removed)")

    frames = []
    for code, spec in INDICATORS.items():
        rows = fetch_indicator(code)
        df = pd.DataFrame(
            {"iso3": r["countryiso3code"], "year": int(r["date"]), "value": r["value"]}
            for r in rows
            if r["value"] is not None
        )
        df["code"] = code
        frames.append(df)
        print(f"  {code:<24} {len(df):>6} obs  {spec['label']}")

    long = pd.concat(frames)
    long = long[long.iso3.isin(countries.iso3)]
    panel = long.pivot_table(index=["iso3", "year"], columns="code", values="value").reset_index()
    panel.to_parquet(ROOT / "data" / "panel.parquet")
    print(f"panel: {panel.shape[0]} country-years x {panel.shape[1] - 2} indicators")


if __name__ == "__main__":
    main()
