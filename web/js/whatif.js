// What if: move policy-ish levers, re-run the analog search live, compare forecasts.
import { App, bindPicker, go } from "./state.js";
import { GDP, $, pct, flagOf, countUp, fmtFeature } from "./util.js";
import { fanCompare } from "./charts.js";

const LEVERS = [
  ["SE.SEC.ENRR", "Secondary school enrollment"],
  ["SE.TER.ENRR", "Tertiary (college) enrollment"],
  ["SP.DYN.TFRT.IN", "Fertility (births per woman)"],
  ["SH.DYN.MORT", "Child mortality (per 1,000)"],
  ["SP.POP.DPND", "Dependency ratio"],
  ["SP.URB.TOTL.IN.ZS", "Urbanization"],
  ["NV.IND.MANF.ZS", "Manufacturing, % of GDP"],
  ["NE.TRD.GNFS.ZS", "Trade, % of GDP"],
  ["NE.GDI.TOTL.ZS", "Investment, % of GDP"],
  ["NE.CON.GOVT.ZS", "Government spending, % of GDP"],
];
// Presets move levers relative to the country's current values.
const PRESETS = [
  ["More schooling", { "SE.SEC.ENRR": v => v + 25, "SE.TER.ENRR": v => Math.max(v * 2, v + 10) }],
  ["More manufacturing", { "NV.IND.MANF.ZS": v => v + 8, "NE.TRD.GNFS.ZS": v => v * 1.4, "NE.GDI.TOTL.ZS": v => v + 6 }],
  ["Lower fertility", { "SP.DYN.TFRT.IN": v => Math.max(1.4, v - 1.5), "SP.POP.DPND": v => v - 20, "SH.DYN.MORT": v => v * 0.5 }],
  ["More urban", { "SP.URB.TOTL.IN.ZS": v => Math.min(95, v + 20) }],
  ["Bigger government", { "NE.CON.GOVT.ZS": v => v + 8 }],
];
let iso = null, base = null; // base: {z, raw{}, fan, twins, gdp, growth}
const vals = {};             // current lever values (raw units)
const flag = (c) => flagOf(App.flags[c]);
const fi = (code) => App.engine.features.findIndex(f => f.code === code);
const growthOf = (fan, b) => { const e = fan[fan.length - 1]; return e ? Math.log(e.p50 / b) / App.engine.horizon : null; };

export function init() {
  bindPicker($("wi-search"), (c) => go("whatif", c));
  $("wi-reset").onclick = () => { resetVals(); drawLevers(); update(); };
  $("wi-presets").innerHTML = PRESETS.map(([l], i) => `<button class="chip" data-i="${i}">${l}</button>`).join("");
  $("wi-presets").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    resetVals();
    for (const [code, fn] of Object.entries(PRESETS[+b.dataset.i][1])) {
      const cur = base.raw[code]; if (cur == null) continue;
      vals[code] = clampToLever(code, fn(cur));
    }
    document.querySelectorAll("#wi-presets .chip").forEach(c => c.classList.toggle("on", c === b));
    drawLevers(); update();
  };
}

export function show(param) {
  const next = App.data[param] ? param : iso || "NGA";
  if (param !== next) history.replaceState(null, "", `#/whatif/${next}`);
  if (next === iso) return;
  iso = next;
  $("wi-search").value = App.data[iso].name;
  const E = App.engine, d = App.data[iso], row = E.row(iso, d.year);
  const z = E.z(row), gdp = d.forecasts[GDP].base;
  const raw = Object.fromEntries(LEVERS.map(([c]) => [c, d.raw[App.meta.features.findIndex(f => f.code === c)]]));
  const twins = E.analogs(z, { excludeIso: iso, maxYear: E.maxAnalogYear });
  const fan = E.forecastGDP(twins, gdp);
  base = { z, raw, gdp, twins, fan, growth: growthOf(fan, gdp), year: d.year };
  resetVals(); drawLevers(); update(true);
}

export function redraw() { if (iso) update(); }

function range(code) {
  const f = App.engine.features[fi(code)], b = base.raw[code];
  let lo = Math.max(0, f.p02), hi = f.p98;
  if (b != null) { lo = Math.min(lo, b); hi = Math.max(hi, b); }
  return [lo, hi];
}
const clampToLever = (code, v) => { const [lo, hi] = range(code); return Math.min(hi, Math.max(lo, v)); };
function resetVals() {
  for (const [c] of LEVERS) vals[c] = base.raw[c];
  document.querySelectorAll("#wi-presets .chip").forEach(c => c.classList.remove("on"));
}

function drawLevers() {
  $("wi-levers").innerHTML = `<p class="ctitle" style="margin-bottom:4px">Indicators</p><p class="cnote">Starting from ${App.data[iso].name} in ${base.year}. The tick on each slider marks the real value.</p>` +
    LEVERS.map(([code, label]) => {
      const [lo, hi] = range(code), b = base.raw[code], v = vals[code] ?? b;
      const step = (hi - lo) / 200;
      const mark = b == null ? "" : `background: linear-gradient(90deg, transparent calc(${((b - lo) / (hi - lo)) * 100}% - 1px), var(--ink-3) calc(${((b - lo) / (hi - lo)) * 100}% - 1px), var(--ink-3) calc(${((b - lo) / (hi - lo)) * 100}% + 1px), transparent calc(${((b - lo) / (hi - lo)) * 100}% + 1px)) no-repeat 0 50% / 100% 10px;`;
      return `<div class="lever">
        <div class="top"><span>${label}</span><span class="val" id="lv-${cssId(code)}"></span></div>
        <input type="range" data-code="${code}" min="${lo}" max="${hi}" step="${step}" value="${v ?? (lo + hi) / 2}" style="${mark}" ${b == null ? 'title="No recent data. Moving this adds it to the match."' : ""}>
      </div>`;
    }).join("");
  $("wi-levers").querySelectorAll("input").forEach(inp => {
    inp.oninput = () => {
      vals[inp.dataset.code] = +inp.value;
      document.querySelectorAll("#wi-presets .chip").forEach(c => c.classList.remove("on"));
      labelLever(inp.dataset.code); update();
    };
    labelLever(inp.dataset.code);
  });
}

const cssId = (code) => code.replace(/\./g, "_");
function labelLever(code) {
  const v = vals[code], b = base.raw[code], el = $("lv-" + cssId(code));
  if (v == null) { el.innerHTML = `<span class="muted">no data</span>`; return; }
  const d = b == null ? null : v - b;
  const big = d != null && Math.abs(d) > 1e-6 * Math.max(1, Math.abs(b));
  el.innerHTML = `${fmtFeature(code, v)}${big ? `<span class="d ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${fmtFeature(code, Math.abs(d)).replace(/^\+/, "")}</span>` : ""}`;
}

let lastGrowth = null;
function update(first = false) {
  const E = App.engine, d = App.data[iso];
  const z = base.z.slice();
  for (const [code] of LEVERS) if (vals[code] != null) z[fi(code)] = E.toZ(fi(code), vals[code]);
  const twins = E.analogs(z, { excludeIso: iso, maxYear: E.maxAnalogYear });
  const fan = E.forecastGDP(twins, base.gdp);
  const g = growthOf(fan, base.gdp);
  const t = twins[0], was = base.twins[0], changed = t.iso3 !== was.iso3 || t.year !== was.year;
  $("wi-resembles").innerHTML = `${changed ? "Your" : ""} ${flag(iso)} <span class="you">${d.name}</span> ${changed ? "would now look" : "looks"} most like
    ${flag(t.iso3)} <span class="tw">${t.name}</span> in ${t.year} <span class="muted small">(${t.similarity.toFixed(0)}% match)</span>`;
  const baseSet = new Set(base.twins.map(x => x.iso3 + x.year));
  $("wi-twins").innerHTML = twins.slice(0, 8).map(x => `<span class="${baseSet.has(x.iso3 + x.year) ? "" : "new"}">${flag(x.iso3)} ${x.name} ${x.year}</span>`).join("") +
    (twins.some(x => !baseSet.has(x.iso3 + x.year)) ? `<span class="muted small" style="background:none;box-shadow:none">highlighted = new twin</span>` : "");
  const same = Math.abs(g - base.growth) < 5e-5;
  $("wi-delta").innerHTML = same
    ? `<span class="to" id="wi-g"></span><span class="muted">a year · move a slider or pick a preset</span>`
    : `<span class="from">${pct(base.growth)}</span><span class="arrow">→</span><span class="to" id="wi-g" style="color:${g > base.growth ? "var(--you)" : "var(--twin)"}"></span><span class="muted">/yr (${g > base.growth ? "+" : "−"}${Math.abs((g - base.growth) * 100).toFixed(1)} pts)</span>`;
  countUp($("wi-g"), first || lastGrowth == null ? g : lastGrowth, g, v => pct(v), 350);
  lastGrowth = g;
  fanCompare($("wi-chart"), { now: base.year, base: base.gdp, baseFan: base.fan, scenFan: fan });
}
