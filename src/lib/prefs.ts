// UI preferences — persisted in config.json by the manager (save_prefs) and
// mirrored to localStorage so the popup can apply them without a round-trip.
// The theme is "system", "light" or "dark" (C.resolveTheme; legacy
// "sand"/"sundown" were both dark and stay dark).
import { C } from "./core"
// UI font choices: the platform UI face is the default (a tool, not a
// website); "outfit" ships with the app, the rest are stock Windows fonts.
// Applied via --app-font, which --font-sans (and every font-sans/font-heading
// utility) resolves to at runtime.
export const FONTS = [
  { id: "system", label: "System — Segoe UI (default)", stack: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" },
  { id: "outfit", label: "Outfit", stack: "'Outfit Variable', sans-serif" },
  { id: "serif", label: "Serif — Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Monospace — Cascadia", stack: "'Cascadia Mono', Consolas, monospace" },
] as const

export function fontStack(id: string): string {
  return FONTS.find((f) => f.id === id)?.stack ?? FONTS[0].stack
}

// "system" follows the OS: apply now, and again whenever Windows switches
// (one listener per window, attached on first use)
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)")
let watchingSystem = false

export function applyPrefs() {
  const theme = localStorage.getItem("theme")
  document.documentElement.classList.toggle("dark", C.resolveTheme(theme, systemDark().matches) === "dark")
  if (!watchingSystem) {
    watchingSystem = true
    systemDark().addEventListener("change", (e) => {
      if (localStorage.getItem("theme") === "system") document.documentElement.classList.toggle("dark", e.matches)
    })
  }
  const scale = parseInt(localStorage.getItem("scale") ?? "", 10) || 100
  document.documentElement.style.fontSize = `${(16 * scale) / 100}px`
  const font = localStorage.getItem("font") || "system"
  document.documentElement.style.setProperty("--app-font", fontStack(font))
}

export function isCompact(): boolean {
  return (localStorage.getItem("density") || "comfortable") === "compact"
}
