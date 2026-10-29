// Dependabot triage for Promptline: the open grouped PRs with their CI
// state and what moved, and the open security alerts with whether the
// package is in the Windows binary (cargo) or the npm tree. Read-only.
//
//   node .claude/skills/dependabot/scripts/triage.cjs
//
// Needs `gh` logged in. cargo tree reads the lock only; no build.
const { execSync } = require("child_process")
const path = require("path")
const repo = path.resolve(__dirname, "..", "..", "..", "..")
const slug = "bekalpaslan/promptline"
const target = "x86_64-pc-windows-msvc"

const sh = (cmd) => {
  try { return execSync(cmd, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) } catch (e) { return e.stdout || "" }
}
const gh = (args) => JSON.parse(sh(`gh ${args}`) || "null")

const major = (from, to) => parseInt(from.split(".")[0], 10) !== parseInt(to.split(".")[0], 10)
const tauriHalf = (name) => /^(tauri|tauri-build|tauri-plugin-|@tauri-apps\/)/.test(name)

function prs() {
  const list = gh(`pr list --repo ${slug} --author app/dependabot --state open --json number,title,headRefName,body,url`) || []
  if (!list.length) { console.log("Open Dependabot PRs: none"); return }
  console.log("Open Dependabot PRs")
  console.log("| # | group | CI | moves | flags |")
  console.log("| --- | --- | --- | --- | --- |")
  for (const pr of list) {
    const checks = gh(`pr checks ${pr.number} --repo ${slug} --json name,state`) || []
    const ci = checks.filter((c) => c.name === "checks").map((c) => c.state).join("/") || "none"
    const moves = [...pr.body.matchAll(/Updates `([^`]+)` from ([0-9][^ ]*) to ([0-9][^ \n]*)/g)].map((m) => ({ name: m[1], from: m[2], to: m[3] }))
    const flags = []
    for (const m of moves) {
      if (major(m.from, m.to)) flags.push(`major ${m.name} ${m.from}→${m.to}`)
      if (tauriHalf(m.name)) flags.push(`tauri ${m.name} ${m.from}→${m.to}`)
    }
    const group = /^Bump the ([\w-]+) group/.exec(pr.title)?.[1] || pr.headRefName
    console.log(`| ${pr.number} | ${group} | ${ci} | ${moves.length} | ${flags.join("; ") || "in range"} |`)
  }
  console.log()
}

function reachable(ecosystem, name) {
  if (ecosystem === "rust") {
    const out = sh(`cargo tree --manifest-path src-tauri/Cargo.toml -i ${name} --target ${target}`)
    return /\S/.test(out) && !/did not match/.test(out) ? "yes" : "no"
  }
  if (ecosystem === "npm") {
    const out = sh(`npm ls ${name} --all --parseable`)
    if (!/\S/.test(out)) return "no"
    return /node_modules[\\/]shadcn[\\/]/.test(out) && !out.split("\n").some((l) => l && !/shadcn/.test(l)) ? "build-time (shadcn only)" : "yes"
  }
  return "?"
}

function alerts() {
  const list = gh(`api "repos/${slug}/dependabot/alerts?state=open&per_page=100"`) || []
  if (!Array.isArray(list)) { console.log("Open alerts: could not read (alerts off, or no access)"); return }
  if (!list.length) { console.log("Open alerts: none"); return }
  console.log("Open alerts")
  console.log("| # | severity | ecosystem | package | vulnerable | patched | reachable |")
  console.log("| --- | --- | --- | --- | --- | --- | --- |")
  for (const a of list) {
    const p = a.dependency.package
    const v = a.security_vulnerability
    console.log(`| ${a.number} | ${a.security_advisory.severity} | ${p.ecosystem} | ${p.name} | ${v.vulnerable_version_range} | ${v.first_patched_version?.identifier || "none"} | ${reachable(p.ecosystem, p.name)} |`)
  }
  console.log()
}

prs()
alerts()
