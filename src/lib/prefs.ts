// UI preferences — persisted in config.json by the manager (save_prefs) and
// mirrored to localStorage so the popup can apply them without a round-trip.
// Legacy theme values ("sand"/"sundown") were both dark; treat anything but
// "light" as dark.
// UI font choices: "outfit" ships with the app, the rest are stock Windows
// fonts so no download is needed. Applied via --app-font, which --font-sans
// (and every font-sans/font-heading utility) resolves to at runtime.
export const FONTS = [
  { id: "outfit", label: "Outfit — default", stack: "'Outfit Variable', sans-serif" },
  { id: "system", label: "System — Segoe UI", stack: "system-ui, 'Segoe UI', sans-serif" },
  { id: "serif", label: "Serif — Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Monospace — Cascadia", stack: "'Cascadia Mono', Consolas, monospace" },
] as const

export function fontStack(id: string): string {
  return FONTS.find((f) => f.id === id)?.stack ?? FONTS[0].stack
}

export function applyPrefs() {
  const theme = localStorage.getItem("theme")
  document.documentElement.classList.toggle("dark", theme !== "light")
  const scale = parseInt(localStorage.getItem("scale") ?? "", 10) || 100
  document.documentElement.style.fontSize = `${(16 * scale) / 100}px`
  const font = localStorage.getItem("font") || "outfit"
  document.documentElement.style.setProperty("--app-font", fontStack(font))
}

export function isCompact(): boolean {
  return (localStorage.getItem("density") || "comfortable") === "compact"
}
