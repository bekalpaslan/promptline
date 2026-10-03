// Move every source line in the architecture map from the map's recorded
// revision to a new commit, through `git diff -U0` hunks. Prints a table; a
// line that falls inside a changed hunk is flagged for a look by hand.
//
//   node .claude/skills/release/scripts/remap-map.cjs <commit>           dry run
//   node .claude/skills/release/scripts/remap-map.cjs <commit> --write   apply and set revision
//
// Then: archify validate, deliver, visual-check (CLAUDE.md → Architecture map).
const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const repo = path.resolve(__dirname, "..", "..", "..", "..")
const file = path.join(repo, "docs", "architecture", "promptline.architecture.json")
const to = process.argv[2]
const write = process.argv.includes("--write")
if (!to) { console.error("usage: remap-map.cjs <commit> [--write]"); process.exit(2) }
const m = JSON.parse(fs.readFileSync(file, "utf8"))
const from = m.meta.repository.revision

function hunks(p) {
  let out = ""
  try { out = execSync(`git diff -U0 ${from} ${to} -- "${p}"`, { cwd: repo, encoding: "utf8" }) } catch (e) { out = e.stdout || "" }
  const hs = []
  for (const line of out.split("\n")) {
    const mm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (mm) hs.push({ oldStart: +mm[1], oldLen: mm[2] === undefined ? 1 : +mm[2], newStart: +mm[3], newLen: mm[4] === undefined ? 1 : +mm[4] })
  }
  return hs
}
function mapLine(hs, line) {
  let delta = 0
  for (const h of hs) {
    const oldEnd = h.oldStart + h.oldLen - 1
    if (h.oldLen === 0 ? line >= h.oldStart : line > oldEnd) delta += h.newLen - h.oldLen
    else if (h.oldLen > 0 && line >= h.oldStart && line <= oldEnd) return { line: h.newStart, inside: true }
  }
  return { line: line + delta, inside: false }
}
const cache = {}
const rows = []
let flagged = 0
const walk = (o) => {
  if (Array.isArray(o)) o.forEach(walk)
  else if (o && typeof o === "object") {
    if (o.sources) for (const s of o.sources) {
      const hs = cache[s.path] ?? (cache[s.path] = hunks(s.path))
      const a = mapLine(hs, s.line)
      const b = s.end_line ? mapLine(hs, s.end_line) : null
      const check = a.inside || b?.inside
      if (check) flagged++
      rows.push(`${s.path}:${s.line}${s.end_line ? "-" + s.end_line : ""} -> ${a.line}${b ? "-" + b.line : ""}${check ? "  CHECK (inside a changed hunk)" : ""}  ${s.label}`)
      if (write) { s.line = a.line; if (b) s.end_line = b.line }
    }
    for (const k in o) if (k !== "sources") walk(o[k])
  }
}
walk(m)
console.log(rows.join("\n"))
if (write) {
  m.meta.repository.revision = execSync(`git rev-parse ${to}`, { cwd: repo, encoding: "utf8" }).trim()
  const eol = fs.readFileSync(file, "utf8").includes("\r\n") ? "\r\n" : "\n"
  fs.writeFileSync(file, JSON.stringify(m, null, 2).replace(/\n/g, eol) + eol)
  console.log("revision ->", m.meta.repository.revision, flagged ? `(${flagged} pointer(s) to check by hand)` : "")
}
