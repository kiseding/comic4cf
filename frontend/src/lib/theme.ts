// Shared theme apply: html class + html style + theme-color meta + persist
const DARK_BG = "#0d1b2a";
const LIGHT_BG = "#f2f2f4";
const DARK_FG = "#e2e8f0";
const LIGHT_FG = "#1c1c1e";

export type Theme = "auto" | "dark" | "light";

export function getTheme(): Theme {
  try { return (localStorage.getItem("c4cf_theme") as Theme) || "auto"; } catch { return "auto"; }
}

export function isDarkTheme(t: Theme): boolean {
  return t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function setThemeColorMeta(color: string) {
  const head = document.head;
  head.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const m = document.createElement("meta");
  m.name = "theme-color";
  m.content = color;
  head.appendChild(m);
}

export function applyTheme(t: Theme) {
  const h = document.documentElement;
  const dark = isDarkTheme(t);
  h.classList.remove("light", "dark");
  h.classList.add(dark ? "dark" : "light");
  const bg = dark ? DARK_BG : LIGHT_BG;
  h.style.background = bg;
  h.style.color = dark ? DARK_FG : LIGHT_FG;
  setThemeColorMeta(bg);
  try { localStorage.setItem("c4cf_theme", t); } catch {}
}
