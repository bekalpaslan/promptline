// Design tokens → src/index.css.
//
// design/tokens.json is the source of truth for every colour, shadow, base
// radius and font stack the app paints with. It is written in the Design
// System artifact's format, so the same file can be published there
// unchanged. This script renders it into the two generated regions of
// src/index.css (the `:root` light block and the `.dark` block), between
// `/* @tokens <theme> … */` and `/* @tokens end */` markers; everything
// outside the markers is hand-written and left alone.
//
// The design-system artifact holds the same file at project/tokens.json.
// Repo -> page: publish design/tokens.json there. Page -> repo: no script can
// reach the artifact (it needs a Claude session), so ask Claude to pull it
// into design/tokens.json and run this. The page normalises the file (weight
// strings, extra style fields, key order); values are what matter.
//
//   node scripts/tokens.mjs          write src/index.css
//   node scripts/tokens.mjs --check  exit 1 if src/index.css is out of date
//
// It also refuses to write when a text/ground pair listed in CONTRAST falls
// under its WCAG floor in either theme: a bad value would otherwise ship
// silently, since nothing else in the build looks at colours.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const TOKENS_PATH = path.join(root, "design", "tokens.json")
export const CSS_PATH = path.join(root, "src", "index.css")

/** Artifact token name → the CSS custom properties it feeds (shadcn's names
 *  plus the app's own). A token absent here is documentation only. */
export const MAP = {
  "surface-0": ["background"],
  "surface-raised": ["card", "popover"],
  "surface-sunk": ["sidebar", "segment-track"],
  control: ["secondary", "muted"],
  "segment-active": ["segment-active"],
  hover: ["hover"],
  selection: ["accent"],
  ink: ["foreground", "card-foreground", "popover-foreground", "secondary-foreground", "accent-foreground"],
  "ink-2": ["muted-foreground"],
  line: ["border"],
  "line-strong": ["input"],
  accent: ["link"],
  focus: ["ring", "focus"],
  "btn-primary": ["primary"],
  "on-btn-primary": ["primary-foreground"],
  danger: ["destructive"],
  warn: ["warn"],
  heading: ["heading"],
  "heading-strong": ["heading-strong"],
  success: ["success"],
  "param-builtin": ["param-builtin"],
  "param-builtin-soft": ["param-builtin-bg"],
  "param-field": ["param-field"],
  "param-field-soft": ["param-field-bg"],
  "param-config": ["param-config"],
  "param-config-soft": ["param-config-bg"],
  "shadow-segment": ["shadow-segment"],
  "shadow-menu": ["shadow-pop"],
  "shadow-pop": ["shadow-shell"],
}

/** Text on ground, with the WCAG floor each pair must clear in every theme.
 *  4.5 is body text; 3 is large text, icons and rings. */
export const CONTRAST = [
  ["ink", "surface-0", 4.5], ["ink", "surface-sunk", 4.5], ["ink", "surface-raised", 4.5], ["ink", "selection", 4.5], ["ink", "hover", 4.5],
  ["ink-2", "surface-0", 4.5], ["ink-2", "surface-sunk", 4.5], ["ink-2", "surface-raised", 4.5], ["ink-2", "selection", 4.5],
  ["ink-3", "surface-0", 4.5], ["ink-3", "surface-sunk", 4.5],
  ["on-btn-primary", "btn-primary", 4.5],
  ["danger", "surface-0", 4.5], ["danger", "danger-soft", 4.5], ["on-danger", "danger", 4.5],
  ["warn", "surface-0", 4.5], ["warn", "surface-sunk", 4.5],
  ["success", "surface-0", 4.5],
  ["heading", "surface-raised", 4.5], ["heading-strong", "surface-sunk", 4.5],
  ["accent", "surface-0", 4.5],
  ["focus", "surface-0", 3], ["focus", "surface-sunk", 3], ["focus", "surface-raised", 3],
  ["param-builtin", "param-builtin-soft", 4.5], ["param-field", "param-field-soft", 4.5], ["param-config", "param-config-soft", 4.5],
]

const themeValue = (token, theme, first) =>
  typeof token.value === "string" ? token.value : (token.value[theme] ?? token.value[first])

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const x = luminance(a), y = luminance(b)
  if (x === null || y === null) return null
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Every CONTRAST pair that misses its floor, per theme. Empty = good. */
export function contrastFailures(tokens) {
  const first = tokens.color.themes[0].id
  const byName = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, t]))
  const out = []
  for (const { id } of tokens.color.themes) {
    for (const [fg, bg, floor] of CONTRAST) {
      if (!byName[fg] || !byName[bg]) { out.push(`${id}: ${fg} on ${bg}: token missing`); continue }
      const ratio = contrast(themeValue(byName[fg], id, first), themeValue(byName[bg], id, first))
      if (ratio === null) out.push(`${id}: ${fg} on ${bg}: not a 6-digit hex, cannot check`)
      else if (ratio < floor) out.push(`${id}: ${fg} on ${bg}: ${ratio.toFixed(2)} < ${floor}`)
    }
  }
  return out
}

/** The generated lines for one theme (no markers, no indentation). */
export function render(tokens, theme) {
  const first = tokens.color.themes[0].id
  const lines = []
  if (theme === first) lines.push(`--app-font: ${tokens.type.families.sans};`)
  const entries = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])]
  for (const t of entries) {
    for (const v of MAP[t.name] ?? []) lines.push(`--${v}: ${themeValue(t, theme, first)};`)
  }
  if (theme === first) {
    const r = tokens.radius.tokens.find((t) => t.name === "radius-2")
    if (r) lines.push(`--radius: ${r.value};`)
  }
  return lines
}

const marker = (theme) => `/* @tokens ${theme}: generated from design/tokens.json by \`npm run tokens\`; edit the JSON, not these lines */`
const END = "/* @tokens end */"

/** css with each theme's region replaced; keeps the file's line endings and indentation. */
export function apply(css, tokens) {
  const eol = css.includes("\r\n") ? "\r\n" : "\n"
  let out = css
  for (const { id } of tokens.color.themes) {
    const start = out.indexOf(marker(id))
    if (start < 0) throw new Error(`src/index.css has no "@tokens ${id}" marker`)
    const end = out.indexOf(END, start)
    if (end < 0) throw new Error(`src/index.css: "@tokens ${id}" region has no end marker`)
    const indent = /(^|\n)([ \t]*)$/.exec(out.slice(0, start))?.[2] ?? "    "
    const body = render(tokens, id).map((l) => indent + l).join(eol)
    out = out.slice(0, start) + marker(id) + eol + body + eol + indent + END + out.slice(end + END.length)
  }
  return out
}

export function readTokens() {
  return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"))
}

function main(argv) {
  const check = argv.includes("--check")
  const tokens = readTokens()
  const failures = contrastFailures(tokens)
  if (failures.length) {
    console.error("design/tokens.json: contrast below floor\n  " + failures.join("\n  "))
    return 1
  }
  const css = fs.readFileSync(CSS_PATH, "utf8")
  const next = apply(css, tokens)
  if (next === css) { console.log("src/index.css is up to date"); return 0 }
  if (check) { console.error("src/index.css is out of date: run `npm run tokens`"); return 1 }
  fs.writeFileSync(CSS_PATH, next)
  console.log("wrote src/index.css")
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
