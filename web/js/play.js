// Play: "Guess the Twin" — 5 rounds, pick which historical moment a country most resembles today.
import { App, go } from "./state.js";
import { GDP, $, pct, flagOf, shuffle, confetti, fmtFeature, ransomify, doodles } from "./util.js";

const ROUNDS = 5;
const RANKS = [
  [0, "Time Tourist", "🧳"], [2, "Junior Economist", "📊"], [3, "Development Detective", "🔍"],
  [4, "World Bank Material", "🏦"], [5, "Time Lord", "⏳"],
];
let G = null; // game state
const flag = (c) => flagOf(App.flags[c]);
const fi = (code) => App.meta.features.findIndex(f => f.code === code);

export function init() {
  addEventListener("keydown", (e) => {
    if (!document.getElementById("page-play").classList.contains("on") || !G) return;
    if (G.phase === "ask" && /^[1-4]$/.test(e.key)) answer(+e.key - 1);
    else if (e.key === "Enter" && G.phase === "reveal") next();
  });
}

export function show() { if (!G || G.phase === "intro") intro(); }

function intro() {
  G = { phase: "intro" };
  $("game").innerHTML = `
    <div class="panel taped intro pop" style="position:relative">
      <div class="doodle" data-doodle="question" style="left:8%;top:24px;width:30px;height:44px;transform:rotate(-14deg)"></div>
      <div class="doodle" data-doodle="question" style="right:9%;top:40px;width:24px;height:36px;transform:rotate(10deg)"></div>
      <div class="doodle" data-doodle="sparkle" style="right:20%;top:14px;width:20px;height:20px"></div>
      <div class="emoji">🕰️</div>
      <h1 class="ransom" data-ransom="Guess the Twin" style="margin-top:12px;font-size:clamp(30px,6vw,52px)">Guess the Twin</h1>
      <p class="lede" style="margin:0 auto 22px">We show you a country as it is today. You guess which moment in history it most resembles.
        ${ROUNDS} rounds. Think you can read a country's fingerprint?</p>
      <button class="btn big" id="g-start">Start →</button>
      <p class="small muted" style="margin-top:14px">Tip: press 1–4 to answer and Enter to continue.</p>
    </div>`;
  $("g-start").onclick = start;
  ransomify($("game").querySelector("[data-ransom]"));
  doodles($("game"));
}

function start() {
  const popI = fi("SP.POP.TOTL");
  const pool = Object.values(App.data).filter(d => d.twins[0].similarity >= 50 && (d.raw[popI] ?? 0) >= 5e6);
  G = { phase: "ask", rounds: shuffle(pool).slice(0, ROUNDS).map(makeRound), i: 0, score: 0, streak: 0, results: [] };
  ask();
}

// One round: the true twin, one weaker real look-alike, two plausible decoys at a similar income level.
function makeRound(d) {
  const E = App.engine, z0 = E.z(E.row(d.iso3, d.year));
  const opt = (iso3, name, year) => {
    const r = E.row(iso3, year);
    return { iso3, name, year, similarity: r == null ? null : 100 * Math.exp(-E.distance(z0, r)) };
  };
  const correct = { ...opt(d.twins[0].iso3, d.twins[0].name, d.twins[0].year), similarity: d.twins[0].similarity, correct: true, t: d.twins[0] };
  const used = new Set([d.iso3, correct.iso3]);
  const weak = shuffle(d.twins.slice(5)).find(t => !used.has(t.iso3));
  const opts = [correct];
  if (weak) { opts.push(opt(weak.iso3, weak.name, weak.year)); used.add(weak.iso3); }
  const gdp = d.raw[0];
  const decoys = shuffle(Object.values(App.data).map(o => ({ o, t: o.twins[0] })))
    .filter(({ t }) => !used.has(t.iso3) && t.raw[0] && gdp && t.raw[0] / gdp > 0.33 && t.raw[0] / gdp < 3);
  for (const { t } of decoys) {
    if (opts.length >= 4) break;
    if (used.has(t.iso3)) continue;
    opts.push(opt(t.iso3, t.name, t.year)); used.add(t.iso3);
  }
  return { d, opts: shuffle(opts) };
}

function hud() {
  const dots = Array.from({ length: ROUNDS }, (_, i) => {
    const r = G.results[i];
    return `<i class="${r === true ? "ok" : r === false ? "no" : i === G.i ? "cur" : ""}"></i>`;
  }).join("");
  return `<div class="hud"><span>Round ${Math.min(G.i + 1, ROUNDS)} / ${ROUNDS}</span><div class="dots">${dots}</div>
    <span class="score">${G.score} pts${G.streak >= 2 ? ` · 🔥 ${G.streak}` : ""}</span></div>`;
}

function ask() {
  G.phase = "ask";
  const { d, opts } = G.rounds[G.i];
  const facts = [["GDP / person", GDP], ["Life expectancy", "SP.DYN.LE00.IN"], ["Fertility", "SP.DYN.TFRT.IN"],
    ["Urban", "SP.URB.TOTL.IN.ZS"], ["Recent growth", "GDP_GROWTH_5Y"]]
    .map(([l, c]) => `<span class="fact">${l} <b>${fmtFeature(c, d.raw[fi(c)])}</b></span>`).join("");
  $("game").innerHTML = `${hud()}
    <div class="panel taped mystery pop">
      <div class="flagbig">${flag(d.iso3)}</div>
      <div class="q">${d.name}, ${d.year}.<br>Which moment in history does it most resemble?</div>
      <div class="facts">${facts}</div>
    </div>
    <div class="opts">${opts.map((o, i) => `
      <button class="opt" data-i="${i}" style="animation-delay:${i * 60}ms">
        <span class="f">${flag(o.iso3)}</span>
        <span><span class="t">${o.name}</span> <span class="yr">${o.year}</span></span>
        <span class="sim">${o.similarity == null ? "" : o.similarity.toFixed(0) + "% match"}</span>
      </button>`).join("")}
    </div>
    <div id="g-verdict"></div>`;
  document.querySelectorAll(".opt").forEach(b => (b.onclick = () => answer(+b.dataset.i)));
}

function answer(i) {
  if (G.phase !== "ask") return;
  G.phase = "reveal";
  const { d, opts } = G.rounds[G.i];
  const ok = !!opts[i].correct;
  G.results[G.i] = ok;
  if (ok) { G.streak++; G.score += 100 + (G.streak - 1) * 25; } else G.streak = 0;
  document.querySelectorAll(".opt").forEach((b, j) => {
    b.disabled = true; b.classList.add("reveal"); b.style.animation = "none";
    if (opts[j].correct) b.classList.add("right");
    else if (j === i) { b.classList.add("wrong"); b.style.animation = ""; }
    if (j === i) b.insertAdjacentHTML("beforeend", `<span class="stamp ${ok ? "ok" : "no"}">${ok ? "On the nose" : "Nope"}</span>`);
  });
  if (ok) confetti(G.streak >= 3 ? 140 : 80);
  const c = opts.find(o => o.correct), t = c.t;
  const f = d.forecasts[GDP], end = f.fan[f.fan.length - 1];
  const g = Math.log(end[2] / f.base) / App.meta.horizon;
  const cheers = ["Nailed it!", "Spot on!", "Sharp eye!", "Exactly right!", "You're a natural!"];
  $("g-verdict").innerHTML = `
    <div class="verdict pop">
      <div class="big">${ok ? cheers[G.i % cheers.length] : `Not quite. It was ${flag(t.iso3)} ${t.name} in ${t.year}.`}</div>
      <p style="margin:8px 0 0">What happened next: over the following decade, ${t.name}'s GDP per person
        ${t.next_growth == null ? "is unknown" : `${t.next_growth >= 0 ? "grew" : "shrank"} <b>${(Math.abs(t.next_growth) * 100).toFixed(1)}%/yr</b>`}${t.next_le != null ? ` and life expectancy ${t.next_le >= 0 ? "rose" : "fell"} <b>${Math.abs(t.next_le).toFixed(1)} years</b>` : ""}.
        Across all 12 look-alikes, our median forecast for ${d.name} is <b>${pct(g)}/yr</b>.</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn" id="g-next">${G.i + 1 < ROUNDS ? "Next round →" : "See my score →"}</button>
        <button class="btn ghost" id="g-explore">Explore ${d.name}</button>
      </div>
    </div>`;
  $("g-next").onclick = next;
  $("g-explore").onclick = () => go("explore", d.iso3);
  $("g-verdict").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function next() {
  G.i++;
  if (G.i < ROUNDS) return ask();
  G.phase = "end";
  const n = G.results.filter(Boolean).length;
  const [, title, emoji] = [...RANKS].reverse().find(([min]) => n >= min);
  const squares = G.results.map(r => (r ? "🟩" : "🟥")).join("");
  const share = `Development Time Machine: Guess the Twin\n${squares} ${n}/${ROUNDS} · ${G.score} pts · ${title} ${emoji}`;
  if (n >= 4) confetti(180);
  $("game").innerHTML = `
    <div class="panel taped end pop">
      <div style="font-size:52px">${emoji}</div>
      <div class="score">${n}/${ROUNDS}</div>
      <div class="passport">Certified · ${title}</div>
      <p class="muted" style="margin:6px 0 4px">${G.score} points</p>
      <div style="font-size:26px;letter-spacing:4px;margin:10px 0 20px">${squares}</div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn" id="g-again">Play again</button>
        <button class="btn ghost" id="g-share">Share result</button>
      </div>
      <p class="small muted" id="g-copied" style="margin-top:12px;min-height:1.5em"></p>
    </div>`;
  $("g-again").onclick = start;
  $("g-share").onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ text: share + "\n" + location.href.split("#")[0] });
      else { await navigator.clipboard.writeText(share); $("g-copied").textContent = "Copied to clipboard!"; }
    } catch { /* user cancelled */ }
  };
}
