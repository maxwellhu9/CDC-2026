// Shared app state + tiny helpers used by every page (kept separate from main.js to avoid import cycles).
export const App = {};

// Wire an <input list="clist"> to call onPick(iso3) when a valid country name is chosen.
export function bindPicker(input, onPick) {
  const go = () => App.byName[input.value] && onPick(App.byName[input.value]);
  input.addEventListener("change", go);
  input.addEventListener("keydown", (e) => e.key === "Enter" && go());
  input.addEventListener("focus", () => input.select());
}

export const go = (page, iso) => { location.hash = `#/${page}${iso ? "/" + iso : ""}`; };
