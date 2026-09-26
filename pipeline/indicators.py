"""The "development fingerprint": indicators that mean the same thing in 1975
as in 2024. We deliberately skip era-bound tech (mobile phones, internet) —
otherwise every country today would look most like another country *today*,
and the whole point is matching across time.

transform: "log" for heavy-tailed quantities, so a jump from $500 -> $1000
counts as much as $20k -> $40k (both are doublings).
group: used to weight categories equally, so e.g. 4 health indicators don't
outvote 1 income indicator.
"""

INDICATORS = {
    # --- income & growth ---
    "NY.GDP.PCAP.KD":     {"label": "GDP per capita (constant 2015 US$)", "short": "GDP / person", "transform": "log", "group": "income"},
    # --- economic structure ---
    "NV.AGR.TOTL.ZS":     {"label": "Agriculture, value added (% of GDP)", "short": "Agriculture % GDP", "transform": "none", "group": "structure"},
    "NV.IND.MANF.ZS":     {"label": "Manufacturing, value added (% of GDP)", "short": "Manufacturing % GDP", "transform": "none", "group": "structure"},
    "NE.TRD.GNFS.ZS":     {"label": "Trade (% of GDP)", "short": "Trade % GDP", "transform": "log", "group": "structure"},
    "NE.GDI.TOTL.ZS":     {"label": "Gross capital formation (% of GDP)", "short": "Investment % GDP", "transform": "none", "group": "structure"},
    "NY.GDP.TOTL.RT.ZS":  {"label": "Total natural resources rents (% of GDP)", "short": "Resource rents % GDP", "transform": "log1p", "group": "structure"},
    "NE.CON.GOVT.ZS":     {"label": "General government final consumption (% of GDP)", "short": "Gov. spending % GDP", "transform": "none", "group": "structure"},
    # --- people ---
    "SP.DYN.LE00.IN":     {"label": "Life expectancy at birth (years)", "short": "Life expectancy", "transform": "none", "group": "health"},
    "SH.DYN.MORT":        {"label": "Under-5 mortality (per 1,000 live births)", "short": "Child mortality", "transform": "log", "group": "health"},
    "SP.DYN.TFRT.IN":     {"label": "Fertility rate (births per woman)", "short": "Fertility", "transform": "none", "group": "demography"},
    "SP.POP.DPND":        {"label": "Age dependency ratio (% of working-age)", "short": "Dependency ratio", "transform": "none", "group": "demography"},
    "SP.POP.GROW":        {"label": "Population growth (annual %)", "short": "Pop. growth", "transform": "none", "group": "demography"},
    "SP.URB.TOTL.IN.ZS":  {"label": "Urban population (% of total)", "short": "Urbanization", "transform": "none", "group": "demography"},
    "SP.POP.TOTL":        {"label": "Population, total", "short": "Population", "transform": "log", "group": "size"},
    # --- human capital ---
    "SE.PRM.ENRR":        {"label": "School enrollment, primary (% gross)", "short": "Primary enrollment", "transform": "none", "group": "education"},
    "SE.SEC.ENRR":        {"label": "School enrollment, secondary (% gross)", "short": "Secondary enrollment", "transform": "none", "group": "education"},
    "SE.TER.ENRR":        {"label": "School enrollment, tertiary (% gross)", "short": "Tertiary enrollment", "transform": "log1p", "group": "education"},
}

# Outcomes we forecast (subset of the above).
OUTCOMES = {
    "NY.GDP.PCAP.KD": {"label": "GDP per capita", "unit": "2015 US$", "mode": "log"},   # forecast log-change
    "SP.DYN.LE00.IN": {"label": "Life expectancy", "unit": "years", "mode": "diff"},   # forecast difference
    "SH.DYN.MORT":    {"label": "Child mortality", "unit": "per 1,000", "mode": "log"},
    "SP.URB.TOTL.IN.ZS": {"label": "Urbanization", "unit": "%", "mode": "diff"},
}
