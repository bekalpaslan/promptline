// design/<id>.tokens.json from design/tokens.json's shape and a values file.
//
//   node .claude/skills/monthly-theme/scripts/make-theme.cjs <id> <values.json> "<Label>"
//
// values.json: { "color": {token: {light, dark}}, "shadow": {...}, "radius": {token: "10px"}, "mix": {token: {light: "10%", dark: "10%"}} }
// A colour may be "rgba(r, g, b, a) on #ground": it is composited to hex, so
// the contrast checker (six-digit hex only) can read it. Every token the base
// file declares needs a value; missing ones are listed and nothing is written.
const fs = require("fs")
const path = require("path")
const repo = path.resolve(__dirname, "..", "..", "..", "..")
const [id, valuesFile, label] = process.argv.slice(2)
if (!id || !valuesFile) {
  console.error("usage: make-theme.cjs <id> <values.json> \"<Label>\"")
  process.exit(2)
}
const base = JSON.parse(fs.readFileSync(path.join(repo, "design", "tokens.json"), "utf8"))
const values = JSON.parse(fs.readFileSync(valuesFile, "utf8"))

function composite(spec) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)\s+on\s+(#[0-9a-f]{6})$/i.exec(spec)
  if (!m) return spec
  const [r, g, b] = [m[1], m[2], m[3]].map(Number)
  const a = m[4] === undefined ? 1 : Number(m[4])
  const ground = [1, 3, 5].map((i) => parseInt(m[5].slice(i, i + 2), 16))
  const mix = (c, gnd) => Math.round(a * c + (1 - a) * gnd)
  return "#" + [mix(r, ground[0]), mix(g, ground[1]), mix(b, ground[2])].map((v) => v.toString(16).padStart(2, "0")).join("")
}
const perTheme = (v) => (typeof v === "string" ? composite(v) : { light: composite(v.light), dark: composite(v.dark) })

const out = structuredClone(base)
out.name = `Promptline ${label ?? id}`
const missing = []
const fill = (section, kind) => {
  for (const t of out[section]?.tokens ?? []) {
    const v = values[kind]?.[t.name]
    if (v === undefined) { missing.push(`${kind}.${t.name}`); continue }
    t.value = perTheme(v)
  }
}
fill("color", "color")
fill("shadow", "shadow")
fill("radius", "radius")
fill("mix", "mix")
if (missing.length) {
  console.error("no value for:\n  " + missing.join("\n  "))
  process.exit(1)
}
const target = path.join(repo, "design", `${id}.tokens.json`)
fs.writeFileSync(target, JSON.stringify(out, null, 2).replace(/\n/g, "\r\n") + "\r\n")
console.log(`wrote design/${id}.tokens.json: ${out.color.tokens.length} colours, ${out.radius.tokens.length} radii`)
