// App shell: loads data once, routes between pages via the URL hash (#/page/ISO).
import { Engine } from "./engine.js";
import { debounce, $ } from "./util.js";
import { App } from "./state.js";
import * as explore from "./explore.js";
import * as play from "./play.js";
import * as whatif from "./whatif.js";
import * as world from "./world.js";
import * as proof from "./proof.js";

const PAGES = { explore, play, whatif, world, proof };

let current;
function route() {
  const [, page = "explore", param] = location.hash.split("/");
  const name = PAGES[page] ? page : "explore";
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("on", p.id === "page-" + name));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.page === name));
  if (current !== name) window.scrollTo({ top: 0 });
  current = name;
  PAGES[name].show(param?.toUpperCase());
}

async function init() {
  const [s, c, e] = await Promise.all(["summary", "countries", "engine"].map(f => fetch(`data/${f}.json`).then(r => r.json())));
  Object.assign(App, { meta: s.meta, summary: s.countries, data: c, engine: new Engine(e) });
  App.flags = s.meta.flags;
  App.byName = Object.fromEntries(Object.values(c).map(d => [d.name, d.iso3]));
  $("clist").innerHTML = Object.keys(App.byName).sort().map(n => `<option value="${n}">`).join("");
  document.querySelectorAll(".maxyr").forEach(el => (el.textContent = s.meta.max_analog_year));
  for (const p of Object.values(PAGES)) p.init?.();
  addEventListener("hashchange", route);
  route();
  const rerender = debounce(() => PAGES[current].redraw?.(), 200);
  addEventListener("resize", rerender);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);
}

init();
if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("sw.js");
