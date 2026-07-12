// UI preferences — persisted in config.json by the manager (save_prefs) and
// mirrored to localStorage so the popup can apply them without a round-trip.
// Legacy theme values ("sand"/"sundown") were both dark; treat anything but
// "light" as dark.
export function applyPrefs() {
  const theme = localStorage.getItem("theme")
  document.documentElement.classList.toggle("dark", theme !== "light")
  const scale = parseInt(localStorage.getItem("scale") ?? "", 10) || 100
  document.documentElement.style.fontSize = `${(16 * scale) / 100}px`
}

export function isCompact(): boolean {
  return (localStorage.getItem("density") || "comfortable") === "compact"
}
