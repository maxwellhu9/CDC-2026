"""Precompute everything the web app shows -> web/data/*.json.

Rule for "today" forecasts: analogs must come from year <= LAST_YEAR - H, i.e.
we only search moments whose following decade has already happened.
"""
import json

import numpy as np
import pandas as pd
import pycountry
from sklearn.linear_model import Ridge

from engine import K, MIN_COVERAGE, MOMENTUM, ROOT, H, Engine, load_panel, transformed
from indicators import INDICATORS, OUTCOMES

WEB = ROOT / "web" / "data"
WEB.mkdir(parents=True, exist_ok=True)
GDP = "NY.GDP.PCAP.KD"


def r(x, nd=3):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), nd)


def main():
    panel = load_panel()
    countries = pd.read_csv(ROOT / "data" / "countries.csv", keep_default_na=False).set_index("iso3")  # "NA" = Namibia, not missing
    last_year = int(panel.loc[panel[GDP].notna(), "year"].max())
    max_analog = last_year - H
    eng = Engine.build(panel)
    eras = {code: eng.era_effects(code, known_until=last_year) for code in OUTCOMES}
    series = panel.set_index(["iso3", "year"])

    # Ridge on the same features, for the blended headline number.
    Zf = np.nan_to_num(eng.Z)
    ridges = {}
    for code, spec in OUTCOMES.items():
        fut = panel.groupby("iso3")[code].shift(-H)
        y = np.log(fut / panel[code]) if spec["mode"] == "log" else fut - panel[code]
        ok = y.notna() & np.isfinite(y)
        ridges[code] = Ridge(alpha=10.0).fit(Zf[ok], y[ok])

    def gdp_path(iso3, y0, y1):
        return [[y, r(series[GDP].get((iso3, y)), 1)] for y in range(y0, y1 + 1)
                if (iso3, y) in series.index and pd.notna(series[GDP].get((iso3, y)))]

    out, summary = {}, []
    for iso3 in sorted(panel.iso3.unique()):
        have = panel[(panel.iso3 == iso3) & panel[GDP].notna()]
        if have.empty or have.year.max() < last_year - 1:
            continue
        now = int(have.year.max())
        row = have.index[have.year == now][0]
        try:
            an = eng.find_analogs(iso3, now, max_analog_year=max_analog)
        except IndexError:
            continue
        if len(an) < 5:
            continue

        feats = eng.features
        z_now = eng.Z[row]
        twins = []
        for a in an.itertuples():
            gd0 = series[GDP].get((a.iso3, a.year))
            gd10 = series[GDP].get((a.iso3, a.year + H))
            le0 = series["SP.DYN.LE00.IN"].get((a.iso3, a.year))
            le10 = series["SP.DYN.LE00.IN"].get((a.iso3, a.year + H))
            twins.append({
                "iso3": a.iso3, "name": countries.at[a.iso3, "name"], "year": int(a.year),
                "dist": r(a.dist), "similarity": r(100 * np.exp(-a.dist), 1), "weight": r(a.weight),
                "z": [r(v, 2) for v in eng.Z[a.row]],
                "raw": [r(series[c].get((a.iso3, a.year)), 2) if c in INDICATORS else r(series[MOMENTUM].get((a.iso3, a.year)), 4) for c in feats],
                "path": gdp_path(a.iso3, a.year - 10, a.year + H),
                "next_growth": r((np.log(gd10 / gd0) / H) if gd0 and gd10 else None, 4),
                "next_le": r(le10 - le0 if le0 and le10 else None, 1),
            })

        forecasts = {}
        for code, spec in OUTCOMES.items():
            base = series[code].get((iso3, now))
            if base is None or np.isnan(base):
                continue
            fc = eng.forecast(iso3, now, an, code, era=eras[code])
            if fc["mean"].isna().all():
                continue
            ridge_ch = float(ridges[code].predict(Zf[[row]])[0])
            ridge_val = base * np.exp(ridge_ch) if spec["mode"] == "log" else base + ridge_ch
            forecasts[code] = {
                "base": r(base, 2),
                "fan": [[now + int(f.h), r(f.p10, 2), r(f.p50, 2), r(f.p90, 2)] for f in fc.itertuples()],
                "blend10": r((fc.iloc[-1]["mean"] + ridge_val) / 2, 2),
                "history": [[y, r(series[code].get((iso3, y)), 2)] for y in range(now - 25, now + 1)
                            if (iso3, y) in series.index and pd.notna(series[code].get((iso3, y)))],
            }

        # Journey: who this country resembled at different points in its own past.
        journey = []
        for y in range(1975, now + 1, 5):
            if not ((panel.iso3 == iso3) & (panel.year == y)).any() or pd.isna(series[GDP].get((iso3, y))):
                continue
            ja = eng.find_analogs(iso3, y, max_analog_year=y, k=1)
            if len(ja):
                j = ja.iloc[0]
                journey.append({"year": y, "twin": j.iso3, "twin_name": countries.at[j.iso3, "name"],
                                "twin_year": int(j.year), "similarity": r(100 * np.exp(-j.dist), 1)})

        g = forecasts.get(GDP)
        growth10 = (np.log(g["fan"][-1][2] / g["base"]) / H) if g and g["fan"][-1][2] else None
        out[iso3] = {
            "iso3": iso3, "name": countries.at[iso3, "name"], "region": countries.at[iso3, "region"],
            "income": countries.at[iso3, "income"], "year": now,
            "z": [r(v, 2) for v in z_now],
            "raw": [r(series[c].get((iso3, now)), 2) if c in INDICATORS else r(series[MOMENTUM].get((iso3, now)), 4) for c in feats],
            "path": gdp_path(iso3, now - 20, now),
            "twins": twins, "forecasts": forecasts, "journey": journey,
        }
        summary.append({"iso3": iso3, "name": out[iso3]["name"], "region": out[iso3]["region"],
                        "growth10": r(growth10, 4), "twin": twins[0]["name"], "twin_year": twins[0]["year"],
                        "similarity": twins[0]["similarity"]})
        print(f"{iso3} {now}: {twins[0]['name']} {twins[0]['year']}")

    meta = {
        "last_year": last_year, "max_analog_year": max_analog, "horizon": H,
        "features": [{"code": c, "label": INDICATORS[c]["label"] if c in INDICATORS else "GDP growth, prior 5 years (annualized)",
                      "short": INDICATORS[c]["short"] if c in INDICATORS else "Recent growth",
                      "group": INDICATORS[c]["group"] if c in INDICATORS else "momentum"} for c in eng.features],
        "outcomes": OUTCOMES,
        "backtest": json.loads((ROOT / "data" / "backtest_summary.json").read_text()),
        # world-atlas map shapes are keyed by ISO numeric code
        "numeric": {c.numeric: c.alpha_3 for c in pycountry.countries if c.alpha_3 in out},
    }
    meta["flags"] = {iso: countries.at[iso, "iso2"] for iso in out}
    (WEB / "countries.json").write_text(json.dumps(out, separators=(",", ":")))
    (WEB / "summary.json").write_text(json.dumps({"meta": meta, "countries": summary}, separators=(",", ":")))
    export_engine(panel, eng, eras, countries, max_analog)
    print(f"exported {len(out)} countries")


def export_engine(panel, eng, eras, countries, max_analog):
    """Everything the browser needs to re-run the analog search itself
    (What-if sandbox, time slider). Z is stored as int(z*1000) to keep it small."""
    X, w = transformed(panel)
    Zi = np.where(np.isnan(eng.Z), None, np.round(eng.Z * 1000)).tolist()
    Zi = [[None if v is None else int(v) for v in row] for row in Zi]
    iso_list = sorted(panel.iso3.unique())
    iso_idx = {c: i for i, c in enumerate(iso_list)}
    era_table, era_level = eras[GDP]
    features = []
    for c in eng.features:
        spec = INDICATORS.get(c, {"transform": "none", "group": "momentum", "short": "Recent growth"})
        raw = panel[c].dropna()
        features.append({"code": c, "transform": spec["transform"], "short": spec["short"],
                         "mean": float(X[c].mean()), "std": float(X[c].std()),
                         "p02": float(raw.quantile(0.02)), "p98": float(raw.quantile(0.98))})
    data = {
        "features": features, "weights": w.tolist(), "K": K, "minCoverage": MIN_COVERAGE,
        "maxAnalogYear": max_analog, "horizon": H,
        "isos": iso_list, "names": [countries.at[c, "name"] if c in countries.index else c for c in iso_list],
        "row_iso": [iso_idx[c] for c in panel.iso3], "row_year": panel.year.astype(int).tolist(),
        "row_gdp": [None if pd.isna(v) else round(float(v), 1) for v in panel[GDP]],
        "Z": Zi,
        # era correction for GDP: world-median log change by (start year, horizon)
        "era": {str(y): [r(era_table.at[y, h], 5) if y in era_table.index and pd.notna(era_table.at[y, h]) else None
                         for h in range(1, H + 1)] for y in era_table.index},
        "eraLevel": [r(era_level[h], 5) for h in range(1, H + 1)],
    }
    (WEB / "engine.json").write_text(json.dumps(data, separators=(",", ":")))


if __name__ == "__main__":
    main()
