// Wire a theme into the four places a palette lives, idempotently:
//   scripts/tokens.mjs   PALETTES (file + marker prefix)
//   src/index.css        the two generated regions under :root[data-theme="<id>"]
//   src/lib/prefs.ts     PALETTES (Settings list)
//   ui/core.js           resolvePalette (rewritten to a list of ids)
//
//   node .claude/skills/monthly-theme/scripts/wire-theme.cjs <id> "<Label>" [--dry-run]
//
// Then `npm run tokens` fills the regions. Line endings follow each file.
const fs = require("fs")
const path = require("path")
const repo = path.resolve(__dirname, "..", "..", "..", "..")
const [id, label] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const dry = process.argv.includes("--dry-run")
if (!/^[a-z][a-z0-9-]*$/.test(id || "") || !label) {
  console.error("usage: wire-theme.cjs <id> \"<Label>\" [--dry-run]   (id: lowercase, digits, dashes)")
  process.exit(2)
}
if (!fs.existsSync(path.join(repo, "design", `${id}.tokens.json`))) {
  console.error(`design/${id}.tokens.json is missing: run make-theme.cjs first`)
  process.exit(1)
}

const edits = []
function edit(file, fn) {
  const p = path.join(repo, file)
  const raw = fs.readFileSync(p, "utf8")
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"
  const lf = raw.replace(/\r\n/g, "\n")
  const next = fn(lf)
  if (next === null) { edits.push(`${file}: already wired`); return }
  if (next === lf) throw new Error(`${file}: nothing matched; the file's shape changed, wire by hand`)
  edits.push(`${file}: wired`)
  if (!dry) fs.writeFileSync(p, next.replace(/\n/g, eol))
}

// 1. scripts/tokens.mjs
edit("scripts/tokens.mjs", (s) => {
  if (s.includes(`{ id: "${id}",`)) return null
  const line = `  { id: "${id}", file: path.join(root, "design", "${id}.tokens.json"), prefix: "${id} " },\n`
  return s.replace(/(export const PALETTES = \[\n(?:.*\n)*?)(\]\n)/, (m, body, close) => body + line + close)
})

// 2. src/index.css: regions after the last data-theme block (or after .dark's)
edit("src/index.css", (s) => {
  if (s.includes(`:root[data-theme="${id}"]`)) return null
  const marker = (theme) => `    /* @tokens ${id} ${theme}: generated from design/tokens.json by \`npm run tokens\`; edit the JSON, not these lines */\n    /* @tokens end */\n    --module-border: var(--border);\n}`
  const block =
    `\n/* ${label}: a theme (Settings → Appearance → Theme; BEHAVIOR.md → Theming).\n` +
    `   Values come from design/${id}.tokens.json through the same script. */\n` +
    `:root[data-theme="${id}"] {\n${marker("light")}\n\n:root[data-theme="${id}"].dark {\n${marker("dark")}\n`
  // Insert before the first "Indigo's one structural difference" style comment
  // if present, else after the last theme block (the last `].dark { … }`)
  const anchor = s.indexOf("\n/* Indigo's one structural difference")
  if (anchor >= 0) return s.slice(0, anchor) + "\n" + block + s.slice(anchor)
  const lastDark = s.lastIndexOf('].dark {')
  if (lastDark < 0) throw new Error("no data-theme block to append after")
  const end = s.indexOf("\n}\n", lastDark) + 3
  return s.slice(0, end) + block + s.slice(end)
})

// 3. src/lib/prefs.ts
edit("src/lib/prefs.ts", (s) => {
  if (s.includes(`{ id: "${id}",`)) return null
  const line = `  { id: "${id}", label: "${label}" },\n`
  return s.replace(/(export const PALETTES = \[\n(?:.*\n)*?)(\] as const\n)/, (m, body, close) => body + line + close)
})

// 4. ui/core.js: resolvePalette as a list of ids
edit("ui/core.js", (s) => {
  const fn = /function resolvePalette\(pref\) \{\n([\s\S]*?)\n  \}/.exec(s)
  if (!fn) throw new Error("resolvePalette not found")
  const ids = new Set(["instrument"])
  for (const m of fn[1].matchAll(/'([a-z][a-z0-9-]*)'/g)) ids.add(m[1])
  if (ids.has(id)) return null
  ids.add(id)
  const list = [...ids].filter((x) => x !== "instrument")
  const body = `    return [${list.map((x) => `'${x}'`).join(", ")}].includes(pref) ? pref : 'instrument';`
  return s.replace(fn[0], `function resolvePalette(pref) {\n${body}\n  }`)
})

// core.ts's declared return type lists the ids too
edit("src/lib/core.ts", (s) => {
  const m = /resolvePalette\(pref: string \| null \| undefined\): ([^\n]+)\n/.exec(s)
  if (!m) throw new Error("resolvePalette declaration not found")
  if (m[1].includes(`"${id}"`)) return null
  return s.replace(m[0], `resolvePalette(pref: string | null | undefined): ${m[1].trimEnd()} | "${id}"\n`)
})

console.log(edits.join("\n"))
console.log(dry ? "(dry run, nothing written)" : "now: npm run tokens, then the checks")
