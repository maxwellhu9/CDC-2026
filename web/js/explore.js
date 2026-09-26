// Explore: one country's look-alikes, ghost paths, rewind slider, fingerprint, other outcomes.
import { App, bindPicker, go } from "./state.js";
import { GDP, $, fmtUSD, pct, flagOf, countUp } from "./util.js";
import { ghostChart, fingerprint, fanSmall, sparkMarker } from "./charts.js";

const QUICK = ["VNM", "IND", "NGA", "CHN", "USA", "BGD", "POL", "KEN", "BRA", "ETH"];
let iso = null, twin = 0, rwTimer = null;

export function init() {
  bindPicker($("ex-search"), (c) => go("explore", c));
  $("ex-random").onclick = () => {
    const pool = Object.keys(App.data).filter(c => c !== iso);
    go("explore", pool[Math.floor(Math.random() * pool.length)]);
  };
  $("ex-quick").innerHTML = QUICK.filter(c => App.data[c]).map(c => `<button class="chip" data-iso="${c}">${flagOf(App.flags[c])} ${App.data[c].name}</button>`).join("");
  $("ex-quick").onclick = (e) => { const b = e.target.closest(".chip"); if (b) go("explore", b.dataset.iso); };
  $("rw-year").oninput = () => { stopRewind(); drawRewind(+$("rw-year").value); };
  $("rw-play").onclick = () => (rwTimer ? stopRewind() : startRewind());
}

export function show(param) {
  const next = App.data[param] ? param : iso || "VNM";
  if (param !== next) history.replaceState(null, "", `#/explore/${next}`);
  if (next === iso) return;
  iso = next; twin = 0;
  $("ex-search").value = App.data[iso].name;
  document.querySelectorAll("#ex-quick .chip").forEach(b => b.classList.toggle("on", b.dataset.iso === iso));
  stopRewind();
  render(true);
}

export function redraw() { if (iso) render(false); }

const flag = (c) => flagOf(App.flags[c]);

function render(animate) {
  const d = App.data[iso];
  drawHeadline(d, animate); drawTwins(d); drawGhost(d); drawFinger(d); drawSmall(d); setupRewind(d);
}

function drawHeadline(d, animate) {
  const t = d.twins[0], f = d.forecasts[GDP], end = f.fan[f.fan.length - 1];
  const g = (v) => Math.log(v / f.base) / App.meta.horizon;
  const le = d.forecasts["SP.DYN.LE00.IN"], leEnd = le && le.fan[le.fan.length - 1];
  $("ex-headline").innerHTML = `
    <div class="big pop">${flag(d.iso3)} <span class="you">${d.name}</span> in ${d.year} looks most like
      ${flag(t.iso3)} <span class="tw">${t.name}</span> in ${t.year}.</div>
    <div class="stats">
      <div class="stat panel pop"><div class="v" id="st-sim"></div><div class="l">match to ${t.name} ${t.year}</div></div>
      <div class="stat panel pop" style="animation-delay:.05s"><div class="v"><span id="st-g"></span><span style="font-size:15px">/yr</span></div>
        <div class="l">median GDP-per-person growth, ${d.year}–${end[0]} (80% range ${pct(g(end[1]))} to ${pct(g(end[3]))})</div></div>
      <div class="stat panel pop" style="animation-delay:.1s"><div class="v" id="st-gdp"></div><div class="l">median GDP per person in ${end[0]}, from ${fmtUSD(f.base)} today</div></div>
      ${leEnd ? `<div class="stat panel pop" style="animation-delay:.15s"><div class="v" id="st-le"></div><div class="l">median life expectancy in ${leEnd[0]}, from ${le.base.toFixed(1)} today</div></div>` : ""}
    </div>`;
  const ms = animate ? 800 : 0;
  countUp($("st-sim"), 0, t.similarity, v => v.toFixed(1) + "%", ms);
  countUp($("st-g"), 0, g(end[2]), v => pct(v), ms);
  countUp($("st-gdp"), f.base, end[2], fmtUSD, ms);
  if (leEnd) countUp($("st-le"), le.base, leEnd[2], v => v.toFixed(1) + " yrs", ms);
}

function drawTwins(d) {
  const maxSim = d3.max(d.twins, t => t.similarity);
  const el = $("ex-twins");
  el.innerHTML = d.twins.map((t, i) => `
    <button class="twin ${i === twin ? "on" : ""}" data-i="${i}" style="animation-delay:${i * 30}ms">
      <div>${flag(t.iso3)} <span class="n">${t.name}</span> <span class="y">${t.year}</span></div>
      <div class="s">${t.similarity}% match · next decade ${t.next_growth == null ? "—" : pct(t.next_growth) + "/yr"}</div>
      <div class="bar"><i style="width:${(t.similarity / maxSim) * 100}%"></i></div>
    </button>`).join("");
  el.onclick = (e) => { const b = e.target.closest(".twin"); if (b) selectTwin(+b.dataset.i); };
}

function selectTwin(i) {
  twin = i;
  const d = App.data[iso];
  $("ex-twins").querySelectorAll(".twin").forEach(x => { x.classList.toggle("on", +x.dataset.i === i); x.style.animation = "none"; });
  drawGhost(d); drawFinger(d);
}

function drawGhost(d) {
  const f = d.forecasts[GDP], now = d.year;
  const ghosts = d.twins.map((t, i) => {
    const v0 = (t.path.find(p => p[0] === t.year) || [])[1];
    return { i, name: t.name, iso3: t.iso3, year: t.year,
      pts: v0 ? t.path.filter(p => p[0] >= t.year).map(([y, v]) => ({ x: now + (y - t.year), y: v * f.base / v0, real: v, yr: y })) : [] };
  }).filter(g => g.pts.length > 1);
  ghostChart($("ex-ghost"), {
    name: d.name, now, horizon: App.meta.horizon, selected: twin, ghosts,
    hist: d.path.map(([x, y]) => ({ x, y })),
    fan: [{ x: now, lo: f.base, mid: f.base, hi: f.base }, ...f.fan.map(([x, lo, mid, hi]) => ({ x, lo, mid, hi }))],
    onSelect: (i) => { selectTwin(i); },
  });
}

function drawFinger(d) {
  const t = d.twins[twin];
  fingerprint($("ex-finger"), {
    features: App.meta.features, a: d.z, b: t.z, aRaw: d.raw, bRaw: t.raw,
    aLabel: `${d.name.length > 14 ? d.iso3 : d.name} ${d.year}`, bLabel: `${t.name.length > 14 ? t.iso3 : t.name} ${t.year}`,
    aTitle: `${d.name} ${d.year}`, bTitle: `${t.name} ${t.year}`,
  });
}

function drawSmall(d) {
  const host = $("ex-small"); host.innerHTML = "";
  const fmts = { "SP.DYN.LE00.IN": v => v.toFixed(1) + " yrs", "SH.DYN.MORT": v => v.toFixed(0) + " per 1,000", "SP.URB.TOTL.IN.ZS": v => v.toFixed(0) + "%" };
  for (const code of Object.keys(fmts)) {
    const f = d.forecasts[code], spec = App.meta.outcomes[code], fmt = fmts[code];
    const box = document.createElement("div"); box.className = "panel"; host.append(box);
    if (!f || !f.history.length) { box.innerHTML = `<p class="ctitle">${spec.label}</p><p class="cnote">Not enough data.</p>`; continue; }
    const end = f.fan[f.fan.length - 1];
    box.innerHTML = `<p class="ctitle">${spec.label}</p><p class="cnote">${fmt(f.base)} now → <b>${fmt(end[2])}</b> by ${end[0]} (80%: ${fmt(end[1])}–${fmt(end[3])})</p>`;
    const chart = document.createElement("div"); box.append(chart);
    fanSmall(chart, { now: d.year, fmt, hist: f.history.map(([x, y]) => ({ x, y })), fan: f.fan.map(([x, lo, mid, hi]) => ({ x, lo, mid, hi })) });
  }
}

// ---------- Rewind: live analog search at any past year ----------
let rwYears = [];
function setupRewind(d) {
  const E = App.engine;
  rwYears = [];
  for (let y = 1975; y <= d.year; y++) { const r = E.row(iso, y); if (r != null && E.row_gdp[r]) rwYears.push(y); }
  const s = $("rw-year");
  s.min = rwYears[0]; s.max = rwYears[rwYears.length - 1]; s.step = 1; s.value = s.max;
  drawRewind(+s.value);
}

function drawRewind(year) {
  const E = App.engine, d = App.data[iso];
  $("rw-label").textContent = year;
  const r = E.row(iso, year);
  const hist = App.engine.row_gdp;
  // Full GDP history for the sparkline (from the engine's panel, not just the last 20 years).
  const path = rwYears.map(y => [y, hist[E.row(iso, y)]]);
  sparkMarker($("rw-chart"), { path, year, label: iso });
  if (r == null || !rwYears.includes(year)) { $("rw-text").innerHTML = `<span class="muted">No data for ${year}.</span>`; return; }
  const [a] = E.analogs(E.z(r), { excludeIso: iso, maxYear: year, k: 3 });
  if (!a) { $("rw-text").innerHTML = `<span class="muted">Not enough data in ${year}.</span>`; return; }
  const when = a.year === year ? "the same year" : a.year;
  $("rw-text").innerHTML = `In <b>${year}</b>, ${flag(iso)} <span class="you">${d.name}</span> looked most like
    ${flag(a.iso3)} <span class="tw">${a.name}</span> in ${when} <span class="muted small">(${a.similarity.toFixed(0)}% match)</span>`;
}

function startRewind() {
  const s = $("rw-year");
  if (+s.value >= +s.max) s.value = s.min;
  $("rw-play").textContent = "❚❚";
  rwTimer = setInterval(() => {
    const v = +s.value + 1;
    if (v > +s.max) return stopRewind();
    s.value = v; drawRewind(v);
  }, 380);
}
function stopRewind() { clearInterval(rwTimer); rwTimer = null; $("rw-play").textContent = "▶"; }
