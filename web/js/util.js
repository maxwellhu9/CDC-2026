// Small shared helpers: formatting, flags, tooltip, animation.

export const GDP = "NY.GDP.PCAP.KD";
export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const fmtUSD = (v) => (v == null ? "—" : "$" + d3.format(",.0f")(v));
export const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + "%");
export const $ = (id) => document.getElementById(id);

// ISO2 "VN" -> 🇻🇳 using regional-indicator symbols.
export const flagOf = (iso2) =>
  iso2 && /^[A-Z]{2}$/.test(iso2) ? `<span class="flag">${String.fromCodePoint(...[...iso2].map(c => 0x1f1a5 + c.charCodeAt(0)))}</span>` : "";

// Human-readable value for any fingerprint feature.
export function fmtFeature(code, v) {
  if (v == null || !isFinite(v)) return "—";
  if (code === GDP) return fmtUSD(v);
  if (code === "SP.POP.TOTL") return d3.format(".3s")(v).replace("G", "B");
  if (code === "GDP_GROWTH_5Y") return pct(v) + "/yr";
  if (code === "SP.DYN.LE00.IN") return v.toFixed(1) + " yrs";
  if (code === "SH.DYN.MORT") return v.toFixed(0) + " per 1k";
  if (code === "SP.DYN.TFRT.IN") return v.toFixed(2);
  if (code === "SP.POP.GROW") return v.toFixed(2) + "%";
  return v.toFixed(1) + "%";
}

const tip = document.getElementById("tip");
export function showTip(html, ev) {
  tip.innerHTML = html; tip.style.opacity = 1;
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = ev.clientY + 14 + tip.offsetHeight > innerHeight ? ev.clientY - tip.offsetHeight - 10 : ev.clientY + 14;
  tip.style.left = Math.max(8, x) + "px"; tip.style.top = y + "px";
}
export const hideTip = () => (tip.style.opacity = 0);

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Animate a number into an element: countUp(el, 0, 3.4, v => v.toFixed(1)).
export function countUp(el, from, to, fmt, ms = 700) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !isFinite(from)) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Readable ticks for a log axis: 1-2-5 steps inside the domain.
export function logTicks([a, b]) {
  const out = [];
  for (let p = Math.floor(Math.log10(a)); p <= Math.ceil(Math.log10(b)); p++)
    for (const m of [1, 2, 5]) { const v = m * 10 ** p; if (v >= a && v <= b) out.push(v); }
  return out.length >= 3 ? out : d3.ticks(a, b, 4);
}

export const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Tiny canvas confetti burst for the game.
export function confetti(n = 90) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas"); c.className = "confetti";
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px";
  document.body.append(c);
  const g = c.getContext("2d"); g.scale(devicePixelRatio, devicePixelRatio);
  const colors = [css("--you"), css("--twin"), "#1baf7a", "#eda100", "#e87ba4"];
  const ps = Array.from({ length: n }, () => ({ x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 12 - 4, r: Math.random() * 6 + 4, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: colors[Math.floor(Math.random() * colors.length)] }));
  const t0 = performance.now();
  const frame = (t) => {
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.a += p.va;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore();
    }
    if (t - t0 < 1800) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- scrapbook decorations ----------
// Ransom-note headline: every letter cut from a different "magazine".
// Deterministic (seeded by letter index) so it looks the same on every load.
const CUTOUTS = [
  { f: "'Abril Fatface', serif", bg: "#fffaf0", c: "#231a12" },
  { f: "'Rubik Mono One', sans-serif", bg: "#df5f36", c: "#fffaf0", s: .78 },
  { f: "'Special Elite', monospace", bg: "#fdf3d6", c: "#2f5fb3" },
  { f: "Fraunces, serif", bg: "#231a12", c: "#fbf6ea" },
  { f: "'Abril Fatface', serif", bg: "#f2c14e", c: "#231a12" },
  { f: "'Rubik Mono One', sans-serif", bg: "#9cc3e6", c: "#231a12", s: .78 },
  { f: "Fraunces, serif", bg: "#fbf6ea", c: "#df5f36" },
  { f: "'Special Elite', monospace", bg: "#e8b4c0", c: "#231a12" },
];
export function ransomify(el) {
  const text = el.dataset.ransom || el.textContent;
  el.setAttribute("aria-label", text);
  let i = 0;
  el.innerHTML = text.split(" ").map(word => `<span class="w" aria-hidden="true">${[...word].map(ch => {
    const k = (i * 7 + ch.charCodeAt(0) * 3) % CUTOUTS.length, st = CUTOUTS[k];
    const r = ((i * 37) % 13) - 6, y = ((i * 53) % 7) - 3;
    i++;
    return `<span class="l" style="--r:${r}deg;font-family:${st.f};background:${st.bg};color:${st.c};transform:rotate(${r}deg) translateY(${y}px);${st.s ? `font-size:${st.s}em;` : ""}animation-delay:${i * 28}ms">${ch}</span>`;
  }).join("")}</span>`).join(" ");
}

const DOODLES = {
  question: `<svg viewBox="0 0 38 54" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M8 14c0-8 7-11 13-10s11 6 9 12-9 8-10 15v5"/><circle cx="20" cy="47" r="2.4" fill="currentColor"/></svg>`,
  sparkle: `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M13 2v7M13 17v7M2 13h7M17 13h7M6 6l3 3M17 17l3 3M20 6l-3 3M6 20l3-3"/></svg>`,
  arrow: `<svg viewBox="0 0 90 50" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M86 8C60 2 30 10 16 36"/><path d="M8 26l8 12 12-6"/></svg>`,
  heart: `<svg viewBox="0 0 30 28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M15 25C5 17 2 12 3 8s7-6 12 0c5-6 11-4 12 0s-2 9-12 17z"/></svg>`,
};
export function doodles(root = document) {
  root.querySelectorAll("[data-doodle]").forEach(el => { if (!el.innerHTML) el.innerHTML = DOODLES[el.dataset.doodle] || ""; });
}
