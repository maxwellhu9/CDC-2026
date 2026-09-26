// Reusable D3 charts. Each takes a host element and plain data, and replaces the host's content.
import { css, fmtUSD, fmtFeature, logTicks, showTip, hideTip, pct } from "./util.js";

// ---------- Ghost paths: history + rescaled analog futures + fan ----------
// ghosts: [{i, name, year, pts: [{x, y, real, yr}]}], fan: [{x, lo, mid, hi}] starting at `now`.
export function ghostChart(host, { name, hist, now, horizon, ghosts, fan, selected, onSelect, compact = false }) {
  const W = host.clientWidth || 800, H = compact ? Math.max(220, Math.min(300, W * 0.55)) : Math.max(300, Math.min(420, W * 0.5));
  const m = { t: 12, r: !compact && W > 640 ? 170 : 16, b: 28, l: 58 };
  const all = [...hist.map(p => p.y), ...ghosts.flatMap(g => g.pts.map(p => p.y)), ...fan.flatMap(p => [p.lo, p.hi])].filter(v => v > 0);
  const [lo, hi] = d3.extent(all);
  const x = d3.scaleLinear().domain([hist[0].x, now + horizon]).range([m.l, W - m.r]);
  const y = d3.scaleLog().domain([lo / 1.08, hi * 1.08]).range([H - m.b, m.t]);
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.append("g").attr("class", "axis gridline").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).tickValues(logTicks(y.domain())).tickFormat(d3.format("$,.0f")).tickSize(-(W - m.l - m.r)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(W < 520 ? 4 : 8, "d"));
  svg.append("line").attr("x1", x(now)).attr("x2", x(now)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--ink-3")).attr("stroke-dasharray", "3 3");
  svg.append("text").attr("class", "anno").attr("x", x(now) + 6).attr("y", m.t + 14).text("today →");

  const curve = d3.curveMonotoneX;
  svg.append("path").datum(fan).attr("fill", css("--you-soft")).attr("d", d3.area().x(p => x(p.x)).y0(p => y(p.lo)).y1(p => y(p.hi)).curve(curve));
  const line = d3.line().x(p => x(p.x)).y(p => y(p.y)).curve(curve);
  const sel = ghosts.find(g => g.i === selected);
  const gp = svg.append("g").selectAll("path").data(ghosts.filter(g => g !== sel)).join("path")
    .attr("class", "ink").attr("fill", "none").attr("stroke", css("--ghost")).attr("stroke-width", 1.4).attr("d", g => line(g.pts));
  // draw-in animation for the ghost lines
  gp.each(function () { const L = this.getTotalLength(); d3.select(this).attr("stroke-dasharray", `${L} ${L}`).attr("stroke-dashoffset", L).transition().duration(900).delay((_, i) => i * 40).attr("stroke-dashoffset", 0).on("end", function () { d3.select(this).attr("stroke-dasharray", null); }); });
  svg.append("path").datum(fan).attr("fill", "none").attr("stroke", css("--you")).attr("stroke-width", 2).attr("stroke-dasharray", "5 4")
    .attr("d", d3.line().x(p => x(p.x)).y(p => y(p.mid)).curve(curve));
  if (sel) {
    svg.append("path").attr("class", "ink").attr("fill", "none").attr("stroke", css("--twin")).attr("stroke-width", 2.8).attr("d", line(sel.pts));
    const last = sel.pts[sel.pts.length - 1];
    if (m.r > 100) svg.append("text").attr("class", "anno").attr("x", x(last.x) + 6).attr("y", y(last.y) + 6).style("fill", css("--twin")).style("font-weight", 700)
      .text(`${sel.name.length > 18 ? sel.iso3 : sel.name} ${sel.year}–${last.yr}`);
  }
  svg.append("path").datum(hist).attr("class", "ink").attr("fill", "none").attr("stroke", css("--you")).attr("stroke-width", 2.8).attr("d", line);

  const pts = [...hist.map(p => ({ ...p, kind: "you" })), ...ghosts.flatMap(g => g.pts.map(p => ({ ...p, kind: "ghost", g })))];
  const dot = svg.append("circle").attr("r", 5).attr("fill", css("--surface")).attr("stroke-width", 2).style("opacity", 0);
  const nearest = (ev, list = pts) => { const [mx, my] = d3.pointer(ev); return d3.least(list, p => (x(p.x) - mx) ** 2 + (y(p.y) - my) ** 2); };
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .style("cursor", onSelect ? "pointer" : "default")
    .on("mousemove", (ev) => {
      const p = nearest(ev);
      dot.attr("cx", x(p.x)).attr("cy", y(p.y)).attr("stroke", p.kind === "you" ? css("--you") : css("--twin")).style("opacity", 1);
      showTip(p.kind === "you" ? `<b>${name} ${p.x}</b><br>${fmtUSD(p.y)} per person`
        : `<b>${p.g.name} ${p.yr}</b> <span class="m">(${p.yr - p.g.year} yrs after match)</span><br>Actual: ${fmtUSD(p.real)}<br><span class="m">Rescaled to ${name}: ${fmtUSD(p.y)}</span>`, ev);
    })
    .on("mouseleave", () => { dot.style("opacity", 0); hideTip(); })
    .on("click", (ev) => { const p = nearest(ev, pts.filter(p => p.kind === "ghost")); if (p && onSelect) onSelect(p.g.i); });
  host.replaceChildren(svg.node());
}

// ---------- Fingerprint dot plot ----------
export function fingerprint(host, { features, a, b, aLabel, bLabel, aRaw, bRaw, aTitle, bTitle }) {
  const W = host.clientWidth || 800, row = 26, m = { t: 30, r: 16, b: 26, l: W < 480 ? 128 : 170 };
  const H = m.t + m.b + row * features.length;
  const x = d3.scaleLinear().domain([-3, 3]).range([m.l, W - m.r]).clamp(true);
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.append("g").attr("class", "axis gridline").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(W < 480 ? 3 : 6).tickFormat(v => (v > 0 ? "+" : "") + v + "σ").tickSize(-(H - m.t - m.b)));
  const lg = svg.append("g").attr("transform", `translate(${m.l},12)`);
  lg.append("circle").attr("cx", 5).attr("cy", -4).attr("r", 5).attr("fill", css("--you"));
  lg.append("text").attr("x", 14).attr("y", 0).style("fill", css("--ink")).text(aLabel);
  lg.append("circle").attr("cx", 5 + Math.max(90, aLabel.length * 7.5 + 30)).attr("cy", -4).attr("r", 5).attr("fill", css("--twin"));
  lg.append("text").attr("x", 14 + Math.max(90, aLabel.length * 7.5 + 30)).attr("y", 0).style("fill", css("--ink")).text(bLabel);
  const rows = features.map((f, i) => ({ ...f, a: a[i], b: b[i], ra: aRaw?.[i], rb: bRaw?.[i] }));
  const g = svg.append("g").selectAll("g").data(rows).join("g").attr("transform", (_, i) => `translate(0,${m.t + row * i + row / 2})`);
  g.append("text").attr("x", m.l - 10).attr("dy", 4).attr("text-anchor", "end").style("fill", css("--ink")).text(f => f.short);
  const ok = v => v != null && isFinite(v);
  g.filter(f => ok(f.a) && ok(f.b)).append("line").attr("x1", f => x(f.a)).attr("x2", f => x(f.a)).attr("stroke", css("--ghost")).attr("stroke-width", 2)
    .transition().duration(500).attr("x2", f => x(f.b));
  g.filter(f => ok(f.b)).append("circle").attr("cx", f => x(ok(f.a) ? f.a : f.b)).attr("r", 5.5).attr("fill", css("--twin")).attr("stroke", css("--surface")).attr("stroke-width", 2)
    .transition().duration(500).attr("cx", f => x(f.b));
  g.filter(f => ok(f.a)).append("circle").attr("cx", f => x(f.a)).attr("r", 5.5).attr("fill", css("--you")).attr("stroke", css("--surface")).attr("stroke-width", 2);
  g.append("rect").attr("x", 0).attr("y", -row / 2).attr("width", W).attr("height", row).attr("fill", "transparent")
    .on("mousemove", (ev, f) => showTip(`<b>${f.label || f.short}</b><br><span style="color:${css("--you")}">●</span> ${aTitle}: ${fmtFeature(f.code, f.ra)}<br><span style="color:${css("--twin")}">●</span> ${bTitle}: ${fmtFeature(f.code, f.rb)}`, ev))
    .on("mouseleave", hideTip);
  host.replaceChildren(svg.node());
}

// ---------- Small-multiple history + fan ----------
export function fanSmall(host, { hist, fan, fmt, now }) {
  const W = host.clientWidth || 300, H = 170, m = { t: 8, r: 8, b: 24, l: 38 };
  const fan0 = [{ x: now, lo: hist[hist.length - 1].y, mid: hist[hist.length - 1].y, hi: hist[hist.length - 1].y }, ...fan];
  const x = d3.scaleLinear().domain([hist[0].x, fan0[fan0.length - 1].x]).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain(d3.extent([...hist.map(p => p.y), ...fan0.flatMap(p => [p.lo, p.hi])])).nice().range([H - m.b, m.t]);
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.append("g").attr("class", "axis gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4, "d"));
  svg.append("path").datum(fan0).attr("fill", css("--you-soft")).attr("d", d3.area().x(p => x(p.x)).y0(p => y(p.lo)).y1(p => y(p.hi)).curve(d3.curveMonotoneX));
  svg.append("path").datum(fan0).attr("fill", "none").attr("stroke", css("--you")).attr("stroke-width", 2).attr("stroke-dasharray", "5 4")
    .attr("d", d3.line().x(p => x(p.x)).y(p => y(p.mid)).curve(d3.curveMonotoneX));
  svg.append("path").datum(hist).attr("class", "ink").attr("fill", "none").attr("stroke", css("--you")).attr("stroke-width", 2.4).attr("d", d3.line().x(p => x(p.x)).y(p => y(p.y)));
  const pts = [...hist.map(p => ({ x: p.x, v: p.y, t: "actual" })), ...fan.map(p => ({ x: p.x, v: p.mid, lo: p.lo, hi: p.hi, t: "median" }))];
  const rule = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--ink-3")).style("opacity", 0);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", (ev) => {
      const yr = Math.round(x.invert(d3.pointer(ev)[0])); const p = pts.find(p => p.x === yr); if (!p) return;
      rule.attr("x1", x(yr)).attr("x2", x(yr)).style("opacity", 1);
      showTip(`<b>${yr}</b><br>${p.t === "actual" ? fmt(p.v) : `median ${fmt(p.v)}<br><span class="m">80%: ${fmt(p.lo)}–${fmt(p.hi)}</span>`}`, ev);
    })
    .on("mouseleave", () => { rule.style("opacity", 0); hideTip(); });
  host.append(svg.node());
}

// ---------- Two fans compared (What-if) ----------
export function fanCompare(host, { now, base, baseFan, scenFan }) {
  const W = host.clientWidth || 600, H = Math.max(220, Math.min(300, W * 0.5)), m = { t: 10, r: 12, b: 26, l: 58 };
  const mk = (fan) => [{ x: now, lo: base, mid: base, hi: base }, ...fan.filter(Boolean).map(f => ({ x: now + f.h, lo: f.p10, mid: f.p50, hi: f.p90 }))];
  const A = mk(baseFan), B = mk(scenFan);
  const all = [...A, ...B].flatMap(p => [p.lo, p.hi]);
  const x = d3.scaleLinear().domain([now, A[A.length - 1].x]).range([m.l, W - m.r]);
  const y = d3.scaleLog().domain([d3.min(all) / 1.05, d3.max(all) * 1.05]).range([H - m.b, m.t]);
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.append("g").attr("class", "axis gridline").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).tickValues(logTicks(y.domain())).tickFormat(d3.format("$,.0f")).tickSize(-(W - m.l - m.r)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5, "d"));
  const area = d3.area().x(p => x(p.x)).y0(p => y(p.lo)).y1(p => y(p.hi)).curve(d3.curveMonotoneX);
  const line = d3.line().x(p => x(p.x)).y(p => y(p.mid)).curve(d3.curveMonotoneX);
  svg.append("path").datum(B).attr("fill", css("--you-soft")).attr("d", area);
  svg.append("path").datum(A).attr("fill", "none").attr("stroke", css("--ghost")).attr("stroke-width", 2).attr("stroke-dasharray", "5 4").attr("d", line);
  svg.append("path").datum(B).attr("class", "ink").attr("fill", "none").attr("stroke", css("--you")).attr("stroke-width", 2.8).attr("d", line);
  const rule = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--ink-3")).style("opacity", 0);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", (ev) => {
      const yr = Math.round(x.invert(d3.pointer(ev)[0])); const a = A.find(p => p.x === yr), b = B.find(p => p.x === yr); if (!a || !b) return;
      rule.attr("x1", x(yr)).attr("x2", x(yr)).style("opacity", 1);
      showTip(`<b>${yr}</b><br>Starting point: ${fmtUSD(a.mid)}<br>Your scenario: <b>${fmtUSD(b.mid)}</b><br><span class="m">80%: ${fmtUSD(b.lo)}–${fmtUSD(b.hi)}</span>`, ev);
    })
    .on("mouseleave", () => { rule.style("opacity", 0); hideTip(); });
  host.replaceChildren(svg.node());
}

// ---------- Sparkline with a movable marker (Rewind) ----------
export function sparkMarker(host, { path, year, label }) {
  const W = host.clientWidth || 400, H = 170, m = { t: 14, r: 12, b: 24, l: 56 };
  const pts = path.map(([x, y]) => ({ x, y })).filter(p => p.y);
  const x = d3.scaleLinear().domain(d3.extent(pts, p => p.x)).range([m.l, W - m.r]);
  const y = d3.scaleLog().domain(d3.extent(pts, p => p.y)).range([H - m.b, m.t]);
  let svg = d3.select(host).select("svg");
  if (svg.empty() || +svg.attr("data-w") !== W || svg.attr("data-k") !== label) {
    svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("data-w", W).attr("data-k", label);
    svg.append("g").attr("class", "axis gridline").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).tickValues(logTicks(y.domain())).tickFormat(d3.format("$,.0f")).tickSize(-(W - m.l - m.r)));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5, "d"));
    svg.append("path").datum(pts).attr("class", "ink").attr("fill", "none").attr("stroke", css("--you")).attr("stroke-width", 2.4).attr("d", d3.line().x(p => x(p.x)).y(p => y(p.y)));
    svg.append("line").attr("class", "mk").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", css("--twin")).attr("stroke-width", 1.5);
    svg.append("circle").attr("class", "mk").attr("r", 5.5).attr("fill", css("--twin")).attr("stroke", css("--surface")).attr("stroke-width", 2);
    host.replaceChildren(svg.node());
  }
  const p = pts.find(p => p.x === year) || pts[pts.length - 1];
  svg.select("line.mk").attr("x1", x(p.x)).attr("x2", x(p.x));
  svg.select("circle.mk").attr("cx", x(p.x)).attr("cy", y(p.y));
}

// ---------- Horizontal score bars (Proof) ----------
export function scoreBars(host, { rows, fmt, ours, best, labels }) {
  const W = host.clientWidth || 400, row = 28, m = { t: 4, r: 76, b: 4, l: W < 420 ? 150 : 184 }, H = m.t + m.b + row * rows.length;
  const x = d3.scaleLinear().domain([0, d3.max(rows, r => r.mae)]).range([m.l, W - m.r]);
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
  const g = svg.selectAll("g").data(rows).join("g").attr("transform", (_, i) => `translate(0,${m.t + i * row})`);
  g.append("text").attr("x", m.l - 10).attr("y", row / 2 + 4).attr("text-anchor", "end")
    .style("fill", r => ours(r.k) ? css("--ink") : css("--ink-2")).style("font-weight", r => r.k === best ? 600 : 400).text(r => labels[r.k]);
  g.append("rect").attr("class", "ink").attr("x", m.l).attr("y", 6).attr("height", row - 12).attr("rx", 2).attr("width", 0)
    .attr("fill", r => ours(r.k) ? css("--you") : css("--ghost")).transition().duration(700).delay((_, i) => i * 60).attr("width", r => x(r.mae) - m.l);
  g.append("text").attr("x", r => x(r.mae) + 6).attr("y", row / 2 + 4).text(r => fmt(r.mae) + (r.k === best ? "  ★" : ""));
  g.append("rect").attr("width", W).attr("height", row).attr("fill", "transparent")
    .on("mousemove", (ev, r) => showTip(`<b>${labels[r.k]}</b><br>Mean absolute error: ${fmt(r.mae)}<br>Rank correlation with reality: ${r.spearman == null ? "n/a" : r.spearman.toFixed(2)}`, ev))
    .on("mouseleave", hideTip);
  host.replaceChildren(svg.node());
}

// ---------- Choropleth ----------
let WORLD;
export async function choropleth(host, { valueOf, color, tipOf, onClick, selected }) {
  WORLD ||= await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then(r => r.json());
  const feats = topojson.feature(WORLD, WORLD.objects.countries).features.filter(f => f.properties.name !== "Antarctica");
  const W = host.clientWidth || 900, H = W * 0.5;
  const path = d3.geoPath(d3.geoNaturalEarth1().fitSize([W, H], { type: "FeatureCollection", features: feats }));
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.append("g").selectAll("path").data(feats).join("path")
    .attr("d", path).attr("stroke", f => f.id === selected ? css("--ink") : css("--surface")).attr("stroke-width", f => f.id === selected ? 1.8 : 0.6)
    .attr("fill", f => { const v = valueOf(f); return v == null ? css("--nodata") : color(v); })
    .style("cursor", f => valueOf(f) == null ? "default" : "pointer")
    .on("mousemove", (ev, f) => showTip(tipOf(f), ev)).on("mouseleave", hideTip)
    .on("click", (_, f) => onClick(f))
    .filter(f => f.id === selected).raise();
  host.replaceChildren(svg.node());
}
