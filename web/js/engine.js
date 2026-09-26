// Browser port of pipeline/engine.py's analog search, so the What-if sandbox
// and the time slider can ask brand-new questions without a server.
// Must stay numerically in sync with the Python version (checked in dev by
// comparing top analogs for a sample of countries).

export class Engine {
  constructor(d) {
    Object.assign(this, d);
    this.nF = d.features.length;
    this.n = d.row_year.length;
    // Flatten Z into one typed array: row r, feature f -> Z[r * nF + f]; NaN = missing.
    this.Zf = new Float32Array(this.n * this.nF);
    d.Z.forEach((row, r) => row.forEach((v, f) => (this.Zf[r * this.nF + f] = v == null ? NaN : v / 1000)));
    this.wTotal = d.weights.reduce((a, b) => a + b, 0);
    this.rowKey = new Map();
    for (let r = 0; r < this.n; r++) this.rowKey.set(d.row_iso[r] * 10000 + d.row_year[r], r);
    this.isoIndex = Object.fromEntries(d.isos.map((c, i) => [c, i]));
  }

  row(iso, year) { return this.rowKey.get(this.isoIndex[iso] * 10000 + year); }
  z(row) { return Array.from(this.Zf.subarray(row * this.nF, (row + 1) * this.nF)); }
  gdp(isoIdx, year) { const r = this.rowKey.get(isoIdx * 10000 + year); return r == null ? null : this.row_gdp[r]; }

  // Raw indicator value -> z-score, applying the same transform as Python.
  toZ(f, raw) {
    const spec = this.features[f];
    let v = raw;
    if (spec.transform === "log") v = raw > 0 ? Math.log(raw) : NaN;
    else if (spec.transform === "log1p") v = Math.log1p(Math.max(raw, 0));
    return (v - spec.mean) / spec.std;
  }
  fromZ(f, z) {
    const spec = this.features[f], v = z * spec.std + spec.mean;
    return spec.transform === "log" ? Math.exp(v) : spec.transform === "log1p" ? Math.expm1(v) : v;
  }

  // Closest (country, year) per other country, top k, Gaussian-kernel weighted.
  analogs(z0, { excludeIso, maxYear, k = this.K }) {
    const ex = this.isoIndex[excludeIso], nF = this.nF, w = this.weights, Z = this.Zf;
    const best = new Map(); // isoIdx -> {row, dist}
    for (let r = 0; r < this.n; r++) {
      const c = this.row_iso[r];
      if (c === ex || this.row_year[r] > maxYear || Number.isNaN(Z[r * nF])) continue;
      let num = 0, ws = 0;
      for (let f = 0; f < nF; f++) {
        const a = z0[f], b = Z[r * nF + f];
        if (Number.isNaN(a) || Number.isNaN(b) || a == null) continue;
        num += w[f] * (a - b) ** 2; ws += w[f];
      }
      if (ws / this.wTotal < this.minCoverage - 1e-9) continue;
      const dist = Math.sqrt(num / Math.max(ws, 1e-9));
      const cur = best.get(c);
      if (!cur || dist < cur.dist) best.set(c, { row: r, dist });
    }
    const top = [...best.entries()].map(([c, v]) => ({ isoIdx: c, ...v })).sort((a, b) => a.dist - b.dist).slice(0, k);
    const ds = top.map(t => t.dist).sort((a, b) => a - b);
    const mid = ds.length / 2, bw = Math.max(ds.length % 2 ? ds[Math.floor(mid)] : (ds[mid - 1] + ds[mid]) / 2, 1e-6);
    let tot = 0;
    for (const t of top) { t.weight = Math.exp(-0.5 * (t.dist / bw) ** 2); tot += t.weight; }
    return top.map(t => ({
      iso3: this.isos[t.isoIdx], name: this.names[t.isoIdx], isoIdx: t.isoIdx, year: this.row_year[t.row], row: t.row,
      dist: t.dist, similarity: 100 * Math.exp(-t.dist), weight: t.weight / tot,
    }));
  }

  // Distance between an arbitrary fingerprint and one stored row (same metric as analogs()).
  distance(z0, r) {
    let num = 0, ws = 0;
    for (let f = 0; f < this.nF; f++) {
      const a = z0[f], b = this.Zf[r * this.nF + f];
      if (a == null || Number.isNaN(a) || Number.isNaN(b)) continue;
      num += this.weights[f] * (a - b) ** 2; ws += this.weights[f];
    }
    return Math.sqrt(num / Math.max(ws, 1e-9));
  }

  // Era-corrected GDP fan, same math as Engine.forecast(era=...) in Python.
  forecastGDP(analogs, base, horizon = this.horizon) {
    const fan = [];
    for (let h = 1; h <= horizon; h++) {
      const ch = [], wt = [];
      for (const a of analogs) {
        const v0 = this.gdp(a.isoIdx, a.year), v1 = this.gdp(a.isoIdx, a.year + h);
        const era = this.era[a.year];
        if (!v0 || !v1 || !era || era[h - 1] == null) continue;
        ch.push(Math.log(v1 / v0) - era[h - 1] + this.eraLevel[h - 1]);
        wt.push(a.weight);
      }
      if (!ch.length) { fan.push(null); continue; }
      const [p10, p50, p90] = weightedQuantiles(ch, wt, [0.1, 0.5, 0.9]);
      fan.push({ h, p10: base * Math.exp(p10), p50: base * Math.exp(p50), p90: base * Math.exp(p90) });
    }
    return fan;
  }

  // An analog's real GDP path from its matched year, rescaled to start at `base`.
  ghost(a, base, horizon = this.horizon) {
    const v0 = this.gdp(a.isoIdx, a.year), out = [];
    if (!v0) return out;
    for (let h = 0; h <= horizon; h++) {
      const v = this.gdp(a.isoIdx, a.year + h);
      if (v) out.push({ h, y: (v * base) / v0, real: v, yr: a.year + h });
    }
    return out;
  }
}

export function weightedQuantiles(x, w, qs) {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = idx.map(i => x[i]), ws = idx.map(i => w[i]);
  const tot = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  const cdf = ws.map(v => { const c = (acc + v / 2) / tot; acc += v; return c; });
  return qs.map(q => {
    if (q <= cdf[0]) return xs[0];
    if (q >= cdf[cdf.length - 1]) return xs[xs.length - 1];
    let i = 1; while (cdf[i] < q) i++;
    return xs[i - 1] + ((q - cdf[i - 1]) / (cdf[i] - cdf[i - 1])) * (xs[i] - xs[i - 1]);
  });
}
