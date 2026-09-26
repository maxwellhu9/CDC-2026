# Development Time Machine

**Every country has been here before.** Pick a country and we find the moments in the last 55 years when other
countries looked most like it does today (for example, *Vietnam 2025 ≈ Thailand 2005* or *India 2025 ≈ China 2002*).
Then we use what actually happened to those look-alikes over the next decade to forecast a range of possible futures.

Carolina Data Challenge 2026, Graduate Track. All data comes from the World Bank Indicators API.

## Why this approach

Most development forecasts are regressions: one formula fitted to every country at once. We use **analog forecasting**
instead, a technique from meteorology: find the past states most similar to the present and see what came next. It has
three advantages:

- **Explainable.** "You look like Korea in 2002, and here is what Korea did next" is a statement anyone can check.
- **Honest uncertainty.** The range comes from real historical outcomes, including crashes and booms, not from an
  assumed bell curve.
- **Tested.** Every forecast method is backtested with no look-ahead (see below).

## Pipeline

```
pipeline/fetch.py      World Bank API -> data/panel.parquet (17 indicators x 217 economies x 1970–2025)
pipeline/engine.py     fingerprint, weighted distance, analog search, era-corrected forecast
pipeline/backtest.py   out-of-sample test vs 4 baselines -> data/backtest_summary.json
pipeline/export.py     precompute every country -> web/data/*.json (+ engine.json for the browser)
web/                   static site (D3, ES modules), no build step; installable PWA with offline cache
  js/engine.js         browser port of the analog search (parity-checked against Python)
```

## The app

| Page | What it does |
|---|---|
| **Explore** | A country's 12 look-alikes, ghost paths, a Rewind slider that re-runs the search live for any past year, the fingerprint comparison, and health and urbanization forecasts |
| **Play** | *Guess the Twin*: 5 rounds, pick a country's historical look-alike from 4 options, share a Wordle-style result |
| **What if** | Move policy-style levers (education, fertility, manufacturing…) and watch the look-alikes and forecast change live |
| **World** | Map of projected growth, or of "which era each country lives in," with top and bottom 10 lists |
| **Proof** | Backtest scorecard, method, and a live World Bank API call |

```bash
uv sync
cd pipeline && uv run python fetch.py && uv run python backtest.py && uv run python export.py
python3 -m http.server 8765 --directory ../web
```

## Method

1. **Fingerprint.** Each country-year is a vector of 18 features: GDP per person, economic structure (agriculture,
   manufacturing, trade, investment, resource rents, government spending), health (life expectancy, child mortality),
   demography (fertility, dependency ratio, population growth, urbanization), education (primary, secondary and tertiary
   enrollment), size (population) and momentum (GDP growth over the prior 5 years). Skewed features are log-transformed,
   and every feature is converted to a z-score. We leave out era-specific technology like mobile phones and internet use
   so that 1985 and 2025 can be compared fairly.
2. **Distance.** Weighted RMS distance over the features both country-years report (at least 60% of the weight must
   overlap). Categories are weighted equally, except income, which counts double.
3. **Analogs.** Keep each other country's single best-matching year, only from years with a known 10-year future
   (≤ 2015). Take the 12 closest and weight them with a Gaussian kernel.
4. **Era correction.** Each analog's change is measured relative to the world median change over the same years, then
   the long-run average is added back. This strips out shocks that hit everyone, like the 1980s debt crisis or 2008.
5. **Forecast.** Weighted 10th/50th/90th percentiles of the corrected changes, applied to today's value, for years 1–10.

## Backtest (no look-ahead)

Forecast origins are 1995, 2000, 2005, 2010 and 2014, with 10-year horizons and about 1,000 forecasts per outcome. At
each origin, the analog pool, the standardization stats and every baseline's training data only use information
available at that time. Mean absolute error:

| Model | GDP/person (log) | Life exp. (yrs) | Child mort. (log) | Urban (pts) |
|---|---|---|---|---|
| No change | 0.236 | 2.82 | 0.355 | 3.51 |
| Historical average | 0.188 | 1.80 | **0.180** | 3.21 |
| Own trend continues | 0.244 | 2.17 | 0.196 | **2.49** |
| Ridge regression (same features) | 0.180 | 1.67 | 0.185 | 2.85 |
| Analogs, era-corrected | 0.191 | 1.62 | 0.189 | 2.80 |
| **Analogs + ridge blend** | **0.177** | **1.56** | 0.181 | 2.75 |

The blend is best for GDP and life expectancy. For urbanization, extending a country's own trend wins, and for child
mortality the historical average narrowly wins. The analogs' 80% ranges contain the real outcome about 70–78% of the
time, so they are slightly too narrow.

Data: World Bank Open Data, CC BY 4.0.
