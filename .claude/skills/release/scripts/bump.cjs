// Bump the version in the five places CLAUDE.md → Releasing lists, keeping
// each file's line endings. With no TO, the patch step.
//
//   node .claude/skills/release/scripts/bump.cjs            0.2.18 -> 0.2.19
//   node .claude/skills/release/scripts/bump.cjs 0.3.0      explicit target
const fs = require("fs")
const path = require("path")
const repo = path.resolve(__dirname, "..", "..", "..", "..")
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"))
const from = pkg.version
const to = process.argv[2] ?? from.replace(/(\d+)$/, (n) => String(Number(n) + 1))
if (!/^\d+\.\d+\.\d+$/.test(to)) throw new Error("target must be X.Y.Z, got " + to)
const q = (s) => s.replace(/\./g, "\\.")
const edit = (file, fn) => {
  const p = path.join(repo, file)
  const before = fs.readFileSync(p, "utf8")
  const after = fn(before)
  if (after === before) throw new Error(file + ": " + from + " not found where expected")
  fs.writeFileSync(p, after)
  console.log(file)
}
edit("package.json", (s) => s.replace(`"version": "${from}"`, `"version": "${to}"`))
edit("package-lock.json", (s) => {
  // the root "version" and packages[""].version: the first two occurrences
  let n = 0
  return s.replace(new RegExp(`"version": "${q(from)}"`, "g"), (m) => (n++ < 2 ? `"version": "${to}"` : m))
})
edit("src-tauri/Cargo.toml", (s) => s.replace(`version = "${from}"`, `version = "${to}"`))
edit("src-tauri/Cargo.lock", (s) => s.replace(new RegExp(`(name = "promptline"\\r?\\nversion = )"${q(from)}"`), `$1"${to}"`))
edit("src-tauri/tauri.conf.json", (s) => s.replace(`"version": "${from}"`, `"version": "${to}"`))
console.log(`${from} -> ${to}`)
