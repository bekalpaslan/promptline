// Dependabot triage for Promptline: the open grouped PRs with their CI
// state and what moved, and the open security alerts with whether the
// package is in the Windows binary (cargo) or the npm tree. Read-only.
//
//   node .claude/skills/dependabot/scripts/triage.cjs
//
// Needs `gh` logged in. cargo tree reads the lock only; no build.
//
// A command that fails is said, never read as an empty answer: "none" and
// "reachable: no" are what alerts get dismissed on, so a `gh` that is
// logged out or a `cargo` that isn't there prints "could not read" (or
// "?" in the reachable column) and the script exits 1.
const { execSync } = require("child_process")
const path = require("path")
const repo = path.resolve(__dirname, "..", "..", "..", "..")
const slug = "bekalpaslan/promptline"
const target = "x86_64-pc-windows-msvc"

let failed = false
const firstLine = (s) => String(s || "").split(/\r?\n/).find((l) => l.trim())?.trim() || "no output"
// { ok, out, err }: stdout is kept on a failure too, because some commands
// answer and exit non-zero at once (`gh pr checks` while a check is
// pending or red, `gh api` with a JSON error body).
const sh = (cmd) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), err: "" }
  } catch (e) {
    return { ok: false, out: String(e.stdout || ""), err: firstLine(e.stderr || e.message) }
  }
}
// The parsed answer, or undefined with `why` when there is none to parse
const gh = (args) => {
  const r = sh(`gh ${args}`)
  if (!r.out.trim()) return r.ok ? { value: null } : { why: r.err }
  try { return { value: JSON.parse(r.out) } } catch { return { why: r.ok ? "not JSON" : r.err } }
}
const unread = (what, why) => {
  failed = true
  console.log(`${what}: could not read (${why})`)
  console.log()
}

const major = (from, to) => parseInt(from.split(".")[0], 10) !== parseInt(to.split(".")[0], 10)
// The Tauri pair moves together and by hand; a plugin minor requires a
// Tauri minor, so the plugins' minors are part of the same jump.
const tauriPair = (name) => /^(tauri|tauri-build|tauri-plugin-.*|@tauri-apps\/api|@tauri-apps\/cli)$/.test(name)
const minor = (v) => v.split(".").slice(0, 2).join(".")
const lockVersion = (lock, name) => new RegExp(`^name = "${name}"\\nversion = "([^"]+)"`, "m").exec(lock)?.[1]

function prs() {
  const got = gh(`pr list --repo ${slug} --author app/dependabot --state open --json number,title,headRefName,headRefOid,body,url`)
  if (!Array.isArray(got.value)) return unread("Open Dependabot PRs", got.why || "not a list")
  const list = got.value
  if (!list.length) { console.log("Open Dependabot PRs: none"); return }
  const masterLock = sh("git show origin/master:src-tauri/Cargo.lock")
  console.log("Open Dependabot PRs")
  console.log("| # | group | CI | moves | flags |")
  console.log("| --- | --- | --- | --- | --- |")
  for (const pr of list) {
    const checks = gh(`pr checks ${pr.number} --repo ${slug} --json name,state`)
    if (!Array.isArray(checks.value)) failed = true
    const ci = Array.isArray(checks.value)
      ? checks.value.filter((c) => c.name === "checks").map((c) => c.state).join("/") || "none"
      : "?"
    const moves = [...pr.body.matchAll(/Updates `([^`]+)` from ([0-9][^ ]*) to ([0-9][^ \n]*)/g)].map((m) => ({ name: m[1], from: m[2], to: m[3] }))
    const flags = []
    for (const m of moves) {
      if (major(m.from, m.to)) flags.push(`major ${m.name} ${m.from}→${m.to}`)
      if (tauriPair(m.name) && minor(m.from) !== minor(m.to)) flags.push(`tauri pair ${m.name} ${m.from}→${m.to}`)
    }
    // The body lists the direct bumps Dependabot intended; the lock holds
    // what Cargo resolved behind them (a plugin minor drags tauri's minor).
    if (/cargo/.test(pr.headRefName)) {
      const content = gh(`api repos/${slug}/contents/src-tauri/Cargo.lock?ref=${pr.headRefOid} --jq .content`)
      const lock = Buffer.from(typeof content.value === "string" ? content.value : "", "base64").toString("utf8")
      const was = lockVersion(masterLock.out, "tauri"), now = lockVersion(lock, "tauri")
      if (was && now) {
        if (minor(was) !== minor(now)) flags.push(`lock resolves tauri ${was}→${now}`)
      } else {
        // "in range" must not be what an unread lock looks like
        failed = true
        flags.push("lock not read")
      }
    }
    const group = /^Bump the ([\w-]+) group/.exec(pr.title)?.[1] || pr.headRefName
    console.log(`| ${pr.number} | ${group} | ${ci} | ${moves.length} | ${flags.join("; ") || "in range"} |`)
  }
  console.log()
}

function reachable(ecosystem, name) {
  if (ecosystem === "rust") {
    const r = sh(`cargo tree --manifest-path src-tauri/Cargo.toml -i ${name} --target ${target}`)
    if (r.ok) return /\S/.test(r.out) ? "yes" : "no"
    // cargo's own "not in the graph" is an answer; anything else is not
    if (/did not match any packages/.test(r.err + r.out)) return "no"
    failed = true
    return "?"
  }
  if (ecosystem === "npm") {
    // Every dependents chain from the package up to the root; a package
    // reached only through shadcn (the CLI) never ships.
    const r = sh(`npm explain ${name} --json`)
    let explained
    try { explained = JSON.parse(r.out) } catch { explained = null }
    if (!Array.isArray(explained)) {
      // npm's own "nothing depends on it" is an answer; anything else is not
      if (/No dependencies found matching/.test(r.err + r.out)) return "no"
      failed = true
      return "?"
    }
    if (!explained.length) return "no"
    const chains = []
    const walk = (n, acc) => {
      const here = [...acc, n.name || "(root)"]
      const deps = n.dependents || []
      if (!deps.length) chains.push(here)
      for (const d of deps) walk(d.from, here)
    }
    for (const e of explained) walk(e, [])
    return chains.every((c) => c.includes("shadcn")) ? "build-time (shadcn only)" : "yes"
  }
  return "?"
}

function alerts() {
  const got = gh(`api "repos/${slug}/dependabot/alerts?state=open&per_page=100"`)
  if (!Array.isArray(got.value)) return unread("Open alerts", got.why || got.value?.message || "alerts off, or no access")
  const list = got.value
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

function orphanBranches() {
  const what = "Dependabot branches with no open PR"
  // Without the PR list every dependabot branch would read as orphaned,
  // beside a hint to delete it
  const got = gh(`pr list --repo ${slug} --author app/dependabot --state open --json headRefName`)
  if (!Array.isArray(got.value)) return unread(what, got.why || "not a list")
  const remote = sh(`git ls-remote --heads origin 'dependabot/*'`)
  if (!remote.ok) return unread(what, remote.err)
  const open = new Set(got.value.map((p) => p.headRefName))
  const heads = remote.out.split(/\r?\n/).map((l) => l.split(/\s+/)[1]).filter(Boolean).map((r) => r.replace("refs/heads/", ""))
  const orphans = heads.filter((b) => !open.has(b))
  console.log(orphans.length ? `${what} (delete with git push origin --delete <branch>): ${orphans.join(", ")}` : `${what}: none`)
  console.log()
}

prs()
alerts()
orphanBranches()
if (failed) process.exitCode = 1
