// World: choropleth of projected growth or "which era each country lives in", plus top/bottom lists.
import { App, go } from "./state.js";
import { $, css, pct, flagOf } from "./util.js";
import { choropleth } from "./charts.js";

let mode = "growth", drawn = false;
const flag = (c) => flagOf(App.flags[c]);

const MODES = {
  growth: {
    value: s => s.growth10,
    bins: [0, 0.01, 0.02, 0.03, 0.04],
    colors: () => [css("--neg"), css("--seq-1"), css("--seq-2"), css("--seq-3"), css("--seq-4"), css("--seq-5")],
    labels: ["< 0%", "0–1%", "1–2%", "2–3%", "3–4%", "> 4%"],
    tip: s => `${pct(s.growth10)}/yr median growth<br><span class="m">looks like ${s.twin} ${s.twin_year}</span>`,
    top: ["🚀 Fastest projected growth", (a, b) => b.growth10 - a.growth10, s => pct(s.growth10) + "/yr"],
    bot: ["🐢 Slowest projected growth", (a, b) => a.growth10 - b.growth10, s => pct(s.growth10) + "/yr"],
  },
  era: {
    value: s => s.twin_year,
    bins: [1980, 1990, 2000, 2010],
    colors: () => [css("--seq-5"), css("--seq-4"), css("--seq-3"), css("--seq-2"), css("--seq-1")],
    labels: ["1970s", "1980s", "1990s", "2000s", "2010s"],
    tip: s => `Lives in <b>${s.twin_year}</b><br><span class="m">looks like ${s.twin} ${s.twin_year} (${s.similarity}%)</span>`,
    top: ["⏪ Furthest back in time", (a, b) => a.twin_year - b.twin_year, s => `${s.twin} ${s.twin_year}`],
    bot: ["⏩ Most recent look-alike", (a, b) => b.twin_year - a.twin_year, s => `${s.twin} ${s.twin_year}`],
  },
};

export function init() {
  $("w-toggle").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    mode = b.dataset.m;
    $("w-toggle").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    draw();
  };
}
export function show() { if (!drawn) draw(); }
export function redraw() { draw(); }

async function draw() {
  drawn = true;
  const M = MODES[mode], S = Object.fromEntries(App.summary.map(s => [s.iso3, s]));
  const color = d3.scaleThreshold(M.bins, M.colors());
  const of = (f) => S[App.meta.numeric[f.id]];
  await choropleth($("w-map"), {
    valueOf: f => { const s = of(f); return s ? M.value(s) : null; },
    color,
    tipOf: f => { const s = of(f); return s ? `<b>${flag(s.iso3)} ${s.name}</b><br>${M.tip(s)}` : `<b>${f.properties.name}</b><br><span class="m">no data</span>`; },
    onClick: f => { const s = of(f); if (s) go("explore", s.iso3); },
  });
  $("w-key").innerHTML = `<div class="legend" style="margin-top:10px">${M.labels.map((l, i) => `<span class="sw" style="--c:${M.colors()[i]}">${l}</span>`).join("")}<span class="sw" style="--c:${css("--nodata")}">no data</span></div>`;
  const list = App.summary.filter(s => M.value(s) != null);
  for (const [key, el] of [["top", "w-top"], ["bot", "w-bot"]]) {
    const [title, cmp, fmt] = M[key];
    $(el + "-t").textContent = title;
    $(el).innerHTML = [...list].sort(cmp).slice(0, 10).map(s => `<li data-iso="${s.iso3}">${flag(s.iso3)} ${s.name}<span class="v">${fmt(s)}</span></li>`).join("");
    $(el).onclick = (e) => { const li = e.target.closest("li"); if (li) go("explore", li.dataset.iso); };
  }
}
