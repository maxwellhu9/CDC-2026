"""Honest out-of-sample test: stand at an origin year T, forecast T -> T+10,
compare to what actually happened.

No peeking: analogs must have year <= T-10 (their 10-year outcome was already
known at T), standardization stats use only years <= T, and every baseline
model is trained only on outcomes observed by T.

Baselines:
  no_change   - tomorrow looks like today (random walk)
  global_avg  - every country gets the average historical 10-year change
  momentum    - each country keeps its own last-10-year trend
  ridge       - linear regression on the exact same fingerprint features
                (the standard "growth regression" an economist would run)
"""
import json

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import Ridge

from engine import ROOT, H, Engine, load_panel
from indicators import OUTCOMES

ORIGINS = [1995, 2000, 2005, 2010, 2014]


def change(v0, v1, mode):
    return np.log(v1 / v0) if mode == "log" else v1 - v0


def run():
    panel = load_panel()
    idx = panel.set_index(["iso3", "year"])
    rows = []
    for T in ORIGINS:
        eng = Engine.build(panel, fit_until=T)
        Zf = np.nan_to_num(eng.Z)  # ridge needs no NaNs: missing -> the mean (0 after standardizing)
        for code, spec in OUTCOMES.items():
            mode = spec["mode"]
            # --- training set for ridge / global_avg: pairs (t, t+10) with t+10 <= T
            cur, fut = panel[code], panel.groupby("iso3")[code].shift(-H)
            y_all = change(cur, fut, mode)
            train = (panel.year + H <= T) & y_all.notna() & np.isfinite(y_all)
            ridge = Ridge(alpha=10.0).fit(Zf[train], y_all[train])
            global_avg = y_all[train].mean()
            era = eng.era_effects(code, known_until=T)

            targets = panel[(panel.year == T) & panel[code].notna() & panel["NY.GDP.PCAP.KD"].notna()]
            for r in targets.itertuples():
                v1 = idx[code].get((r.iso3, T + H))
                vprev = idx[code].get((r.iso3, T - H))
                if v1 is None or np.isnan(v1):
                    continue
                v0 = panel.at[r.Index, code]
                actual = change(v0, v1, mode)
                try:
                    an = eng.find_analogs(r.iso3, T, max_analog_year=T - H)
                except IndexError:
                    continue
                if len(an) < 5:
                    continue
                fc = eng.forecast(r.iso3, T, an, code).iloc[-1]
                fce = eng.forecast(r.iso3, T, an, code, era=era).iloc[-1]
                if np.isnan(fc["mean"]) or np.isnan(fce["mean"]):
                    continue
                p10, p90 = change(v0, fc.p10, mode), change(v0, fc.p90, mode)
                rows.append({
                    "origin": T, "code": code, "iso3": r.iso3, "actual": actual,
                    "analog": fc.change_mean,
                    "ridge": float(ridge.predict(Zf[[r.Index]])[0]),
                    "no_change": 0.0,
                    "global_avg": global_avg,
                    "momentum": change(vprev, v0, mode) if vprev is not None and not np.isnan(vprev) else np.nan,
                    "analog_era": fce.change_mean,
                    "in_band": p10 <= actual <= p90,
                    "in_band_era": change(v0, fce.p10, mode) <= actual <= change(v0, fce.p90, mode),
                })
        print(f"origin {T} done")
    df = pd.DataFrame(rows)
    df["blend"] = (df.analog_era + df.ridge) / 2
    df.to_csv(ROOT / "data" / "backtest_rows.csv", index=False)
    return df


MODELS = ["no_change", "global_avg", "momentum", "ridge", "analog", "analog_era", "blend"]


def summarize(df):
    out = {}
    for code, g in df.groupby("code"):
        g = g.dropna(subset=["momentum"])
        res = {"n": len(g), "coverage80": float(g.in_band.mean()), "coverage80_era": float(g.in_band_era.mean()), "by_model": {}, "by_origin": {}}
        for m in MODELS:
            err = (g[m] - g.actual).abs()
            rho = spearmanr(g[m], g.actual).statistic if g[m].nunique() > 1 else np.nan
            res["by_model"][m] = {"mae": float(err.mean()), "spearman": None if np.isnan(rho) else float(rho)}
        for T, gt in g.groupby("origin"):
            res["by_origin"][int(T)] = {m: float((gt[m] - gt.actual).abs().mean()) for m in MODELS}
        out[code] = res
    return out


if __name__ == "__main__":
    df = run()
    summary = summarize(df)
    (ROOT / "data" / "backtest_summary.json").write_text(json.dumps(summary, indent=1))
    for code, res in summary.items():
        print(f"\n{code}  n={res['n']}  80% band coverage raw={res['coverage80']:.0%} era={res['coverage80_era']:.0%}")
        for m, s in res["by_model"].items():
            print(f"  {m:<11} MAE={s['mae']:.4f}  rank-corr={s['spearman'] if s['spearman'] is None else round(s['spearman'], 3)}")
