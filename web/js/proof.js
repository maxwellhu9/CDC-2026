// Proof: backtest scorecard, method, and a live World Bank API call.
import { App } from "./state.js";
import { GDP, $, fmtUSD } from "./util.js";
import { scoreBars } from "./charts.js";

const LABELS = { no_change: "No change", global_avg: "Historical average", momentum: "Own trend continues",
  ridge: "Linear regression", analog_era: "Twins", blend: "Twins + regression" };
const UNITS = { [GDP]: v => (v * 100).toFixed(1) + " pts", "SP.DYN.LE00.IN": v => v.toFixed(2) + " yrs",
  "SH.DYN.MORT": v => (v * 100).toFixed(1) + " pts", "SP.URB.TOTL.IN.ZS": v => v.toFixed(2) + " pts" };
const DESC = { [GDP]: "Avg. error in 10-yr GDP-per-person growth (log pts)", "SP.DYN.LE00.IN": "Avg. error in 10-yr life-expectancy change",
  "SH.DYN.MORT": "Avg. error in 10-yr child-mortality change (log pts)", "SP.URB.TOTL.IN.ZS": "Avg. error in 10-yr urbanization change (pts)" };
let drawn = false;

export function show() { if (!drawn) { draw(); liveCheck(); } }
export function redraw() { draw(); }

function draw() {
  drawn = true;
  const bt = App.meta.backtest, host = $("pf-scores");
  host.innerHTML = "";
  for (const code of Object.keys(App.meta.outcomes)) {
    const res = bt[code]; if (!res) continue;
    const rows = Object.entries(res.by_model).filter(([k]) => LABELS[k]).map(([k, v]) => ({ k, ...v })).sort((a, b) => a.mae - b.mae);
    const box = document.createElement("div"); box.className = "panel"; host.append(box);
    box.innerHTML = `<p class="ctitle">${App.meta.outcomes[code].label}</p><p class="cnote">${DESC[code]} · n = ${res.n}</p>`;
    const chart = document.createElement("div"); box.append(chart);
    scoreBars(chart, { rows, fmt: UNITS[code], best: rows[0].k, labels: LABELS, ours: k => k === "analog_era" || k === "blend" });
  }
  const gd = bt[GDP].by_model, le = bt["SP.DYN.LE00.IN"].by_model;
  $("pf-note").innerHTML = `Averaging the twins with a regression had the lowest error for GDP
    (${((1 - gd.blend.mae / gd.global_avg.mae) * 100).toFixed(0)}% lower than the historical average) and for life expectancy
    (${((1 - le.blend.mae / le.global_avg.mae) * 100).toFixed(0)}% lower). It lost on the other two. Urbanization changes so smoothly
    that continuing a country's own trend works best, and for child mortality the historical average is slightly better because
    most countries decline at a similar rate. The twins' 80% ranges contained the real GDP outcome
    ${(bt[GDP].coverage80_era * 100).toFixed(0)}% of the time, so they're a bit too narrow.`;
}

async function liveCheck() {
  const el = $("pf-live"), iso = (location.hash.split("/")[2] || "USA").toUpperCase();
  const c = App.data[iso] ? iso : "USA";
  el.textContent = "Checking the World Bank API live…";
  try {
    const r = await fetch(`https://api.worldbank.org/v2/country/${c}/indicator/${GDP}?format=json&mrnev=1`).then(r => r.json());
    const obs = r[1][0];
    el.innerHTML = `Live API check from your browser: <code>api.worldbank.org/v2/country/${c}/indicator/${GDP}?mrnev=1</code> →
      <b>${obs.country.value}, ${obs.date}: ${fmtUSD(obs.value)}</b> per person (API last updated ${r[0].lastupdated}).`;
  } catch { el.textContent = "Live API check unavailable offline. The precomputed data is shown."; }
}
