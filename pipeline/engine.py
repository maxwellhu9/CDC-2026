"""Analog ("development twin") engine.

Idea, borrowed from meteorology's analog forecasting (Lorenz 1969): to predict
where a system goes next, find past moments when the system looked most like
it does now, and see what happened after those moments.

Here the "system state" of a country-year is a vector of standardized
indicators (its development fingerprint). For a target (country, year) we
search every *other* country's past years, keep each country's single best
matching year, take the K closest, and use their subsequent trajectories as
a forecast distribution.
"""
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from indicators import INDICATORS, OUTCOMES

ROOT = Path(__file__).resolve().parent.parent

# How much each category counts in the distance. Income level gets double
# weight: two countries at very different income levels are rarely useful
# analogs no matter how similar their demographics are.
GROUP_WEIGHTS = {"income": 2.0, "momentum": 1.0, "structure": 1.0, "health": 1.0,
                 "demography": 1.0, "education": 1.0, "size": 0.5}
MOMENTUM = "GDP_GROWTH_5Y"  # derived: annualized log GDP growth over the previous 5 years
MIN_COVERAGE = 0.6          # both vectors must share >= 60% of total feature weight
K = 12                      # analog countries per forecast
H = 10                      # forecast horizon, years


def load_panel() -> pd.DataFrame:
    panel = pd.read_parquet(ROOT / "data" / "panel.parquet").sort_values(["iso3", "year"])
    codes = list(INDICATORS)
    # Fill small gaps within a country: interpolate interior holes, then carry
    # the last value forward a few years (school enrollment is reported
    # sporadically, and without this almost no country has a "current" value).
    panel[codes] = (panel.groupby("iso3")[codes]
                    .transform(lambda s: s.interpolate(limit=5, limit_area="inside").ffill(limit=5)))
    g = np.log(panel["NY.GDP.PCAP.KD"])
    panel[MOMENTUM] = (g - g.groupby(panel.iso3).shift(5)) / 5
    return panel.reset_index(drop=True)


def transformed(panel: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
    """Apply per-indicator transforms; return feature matrix + weight vector."""
    X = pd.DataFrame(index=panel.index)
    weights = {}
    group_sizes = pd.Series({c: s["group"] for c, s in INDICATORS.items()}).value_counts()
    for code, spec in INDICATORS.items():
        v = panel[code].astype(float)
        if spec["transform"] == "log":
            v = np.log(v.where(v > 0))
        elif spec["transform"] == "log1p":
            v = np.log1p(v.clip(lower=0))
        X[code] = v
        weights[code] = GROUP_WEIGHTS[spec["group"]] / group_sizes[spec["group"]]
    X[MOMENTUM] = panel[MOMENTUM]
    weights[MOMENTUM] = GROUP_WEIGHTS["momentum"]
    return X, np.array([weights[c] for c in X.columns])


@dataclass
class Engine:
    panel: pd.DataFrame
    Z: np.ndarray           # standardized features (NaN = missing)
    w: np.ndarray           # feature weights
    features: list

    @classmethod
    def build(cls, panel: pd.DataFrame, fit_until: int | None = None) -> "Engine":
        """fit_until: compute standardization stats only from years <= this
        (so backtests don't peek at the future, even through the scaling)."""
        X, w = transformed(panel)
        fit = X if fit_until is None else X[panel.year <= fit_until]
        Z = ((X - fit.mean()) / fit.std()).to_numpy()
        return cls(panel, Z, w, list(X.columns))

    def distances(self, row: int, pool: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Weighted RMS distance from `row` to every row in `pool`, using only
        features both have. Returns (distance, shared-weight fraction)."""
        z0 = self.Z[row]
        D = self.Z[pool] - z0
        ok = ~np.isnan(D)
        W = ok * self.w
        wsum = W.sum(1)
        d = np.sqrt(np.nansum(W * np.nan_to_num(D) ** 2, 1) / np.maximum(wsum, 1e-9))
        return d, wsum / self.w.sum()

    def find_analogs(self, iso3: str, year: int, max_analog_year: int, k: int = K) -> pd.DataFrame:
        """Best-matching (country, year) for each other country, top k overall."""
        p = self.panel
        row = p.index[(p.iso3 == iso3) & (p.year == year)][0]
        gdp = ~np.isnan(self.Z[:, 0])
        pool = np.where((p.iso3 != iso3).to_numpy() & (p.year <= max_analog_year).to_numpy() & gdp)[0]
        d, cov = self.distances(row, pool)
        cand = pd.DataFrame({"row": pool, "iso3": p.iso3.to_numpy()[pool],
                             "year": p.year.to_numpy()[pool], "dist": d, "coverage": cov})
        cand = cand[cand.coverage >= MIN_COVERAGE - 1e-9]  # tolerance keeps JS port in sync
        best = cand.loc[cand.groupby("iso3").dist.idxmin()].nsmallest(k, "dist")
        # Gaussian kernel weights, bandwidth = median analog distance:
        # closer twins count more, but no single twin dominates.
        bw = max(best.dist.median(), 1e-6)
        best["weight"] = np.exp(-0.5 * (best.dist / bw) ** 2)
        best["weight"] /= best.weight.sum()
        return best.reset_index(drop=True)

    def value(self, iso3: str, year: int, code: str) -> float:
        s = self.panel.loc[(self.panel.iso3 == iso3) & (self.panel.year == year), code]
        return float(s.iloc[0]) if len(s) else np.nan

    def era_effects(self, code: str, known_until: int, horizon: int = H) -> tuple[pd.DataFrame, dict]:
        """World-median h-year change for each start year ("what the decade did
        to everyone"), plus the long-run average of that, per horizon.

        Why: a 1981 analog then lived through the 1980s debt crisis. Its raw
        growth mixes "countries like this" with "that decade was bad for
        everyone". We keep only the part that beat/trailed the world, then add
        back a typical era. Only uses outcomes observed by `known_until`."""
        mode = OUTCOMES[code]["mode"]
        wide = self.panel.pivot(index="iso3", columns="year", values=code)
        table, level = {}, {}
        for h in range(1, horizon + 1):
            fut = wide.shift(-h, axis=1)
            ch = np.log(fut / wide) if mode == "log" else fut - wide
            med = ch.median(axis=0)
            med = med[(med.index + h) <= known_until].dropna()
            table[h] = med
            level[h] = float(med.mean())
        return pd.DataFrame(table), level

    def forecast(self, iso3: str, year: int, analogs: pd.DataFrame, code: str, horizon: int = H,
                 era: tuple[pd.DataFrame, dict] | None = None) -> pd.DataFrame:
        """For h = 1..horizon: weighted quantiles of analogs' changes, applied to
        the target's current value. log mode -> growth rates; diff -> levels.
        With `era`, each analog's change is measured relative to the world in
        its own decade (see era_effects)."""
        mode = OUTCOMES[code]["mode"]
        base = self.value(iso3, year, code)
        series = self.panel.set_index(["iso3", "year"])[code]
        out = []
        for h in range(1, horizon + 1):
            ch, wt = [], []
            for a in analogs.itertuples():
                v0, v1 = series.get((a.iso3, a.year)), series.get((a.iso3, a.year + h))
                if v0 is None or v1 is None or np.isnan(v0) or np.isnan(v1):
                    continue
                if mode == "log":
                    if v0 <= 0 or v1 <= 0:
                        continue
                    c = np.log(v1 / v0)
                else:
                    c = v1 - v0
                if era is not None:
                    table, level = era
                    if a.year not in table.index:
                        continue
                    c = c - table.at[a.year, h] + level[h]
                ch.append(c)
                wt.append(a.weight)
            if not ch:
                out.append({"h": h, "p10": np.nan, "p50": np.nan, "p90": np.nan, "mean": np.nan})
                continue
            ch, wt = np.array(ch), np.array(wt) / np.sum(wt)
            q = weighted_quantiles(ch, wt, [0.1, 0.5, 0.9])
            m = float(np.sum(ch * wt))
            apply = (lambda c: base * np.exp(c)) if mode == "log" else (lambda c: base + c)
            out.append({"h": h, "p10": apply(q[0]), "p50": apply(q[1]), "p90": apply(q[2]),
                        "mean": apply(m), "change_mean": m, "n": len(ch)})
        return pd.DataFrame(out)


def weighted_quantiles(x, w, qs):
    order = np.argsort(x)
    x, w = x[order], w[order]
    cdf = np.cumsum(w) - 0.5 * w  # midpoint rule, so 1 analog -> its own value
    return np.interp(qs, cdf, x)
