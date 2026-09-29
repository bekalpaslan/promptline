// Prints one row for the Snapshot table in the MARKETING doc (the living
// Claude doc; docs/MARKETING.md is its local export): stars, forks, open
// issues, Discussions, release downloads, the 14-day traffic and referrers.
// Paste the row into the doc every two weeks; the traffic endpoints keep
// only 14 days, so a late run loses days (the window line says which).
//
//   node scripts/snapshot.mjs [--donations <n>] [--date YYYY-MM-DD]
//                             [--repo owner/name] [--header] [--json]
//
// Everything is read through `gh api` with gh's own login: no token here,
// nothing written to disk, no numbers in the repo. Traffic needs push access;
// without it those cells print n/a. Counts include bots, re-downloads,
// updater fetches (an update downloads the versioned installer), winget and
// Scoop installs, and CI clones: read the trend, not the number. Paste the
// output; don't redirect it from PowerShell 5.1, whose `>` writes UTF-16.
// `--fixture <dir>` is a test hook: it reads graphql.json, releases.json,
// views.json, clones.json and referrers.json from <dir> instead of calling gh.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const REPO = "bekalpaslan/promptline"

export const HEADER =
  "| Date | Stars | Forks | Open issues | Discussions | Latest release: downloads | All releases: downloads | Views 14d (unique) | Clones 14d (unique) | Top referrers | Donations |\n" +
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"

// issues(states: OPEN) leaves out pull requests, unlike REST open_issues_count;
// discussions counts 0, not an error, while Discussions is off.
const GRAPHQL_QUERY =
  "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){stargazerCount forkCount issues(states:OPEN){totalCount} discussions{totalCount}}}"

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

const sumDownloads = (assets) => (assets ?? []).reduce((n, a) => n + (a.download_count ?? 0), 0)

/** Every non-draft release's downloads summed, and the latest stable release
 *  (greatest published_at, prereleases and drafts excluded) with its assets. */
export function summarizeReleases(releases) {
  const live = (releases ?? []).filter((r) => !r.draft)
  const total = live.reduce((n, r) => n + sumDownloads(r.assets), 0)
  const stable = live.filter((r) => !r.prerelease)
  const newest = stable.reduce((best, r) => (!best || r.published_at > best.published_at ? r : best), null)
  if (!newest) return { total, latest: null }
  return {
    total,
    latest: {
      tag: newest.tag_name,
      publishedAt: newest.published_at,
      downloads: sumDownloads(newest.assets),
      assets: (newest.assets ?? []).map((a) => ({ name: a.name, downloads: a.download_count ?? 0 })),
    },
  }
}

/** The 14-day traffic figures. A null input (the endpoint answered 403)
 *  stays null so the row prints n/a and never a false 0. */
export function summarizeTraffic({ views, clones, referrers }) {
  const buckets = views?.views ?? []
  const day = (b) => (b ? String(b.timestamp).slice(0, 10) : null)
  return {
    views: views ? views.count : null,
    viewsUniques: views ? views.uniques : null,
    clones: clones ? clones.count : null,
    clonesUniques: clones ? clones.uniques : null,
    referrers: referrers
      ? [...referrers].sort((a, b) => b.count - a.count || String(a.referrer).localeCompare(String(b.referrer)))
      : null,
    windowStart: day(buckets[0]),
    windowEnd: day(buckets[buckets.length - 1]),
  }
}

/** `name count/uniques`, top five; none when empty, n/a when unknown. */
export function formatReferrers(list) {
  if (!list) return "n/a"
  if (list.length === 0) return "none"
  return list
    .slice(0, 5)
    .map((r) => `${r.referrer} ${r.count}/${r.uniques}`)
    .join(", ")
}

const escapeCell = (value) => String(value).replace(/\|/g, "\\|")

const pair = (n, u) => (n === null || n === undefined ? "n/a" : `${n} (${u})`)

/** One Snapshot table row, columns in HEADER order. */
export function formatRow(s) {
  const cells = [
    s.date,
    s.stars,
    s.forks,
    s.openIssues,
    s.discussions,
    s.latest ? `${s.latest.tag}: ${s.latest.downloads}` : "none",
    s.totalDownloads,
    pair(s.views, s.viewsUniques),
    pair(s.clones, s.clonesUniques),
    formatReferrers(s.referrers),
    s.donations,
  ]
  return `| ${cells.map(escapeCell).join(" | ")} |`
}

/** collect()'s raw object into formatRow's input. */
export function buildSnapshot(raw, { date, donations = "?" } = {}) {
  const releases = summarizeReleases(raw.releases)
  const traffic = summarizeTraffic({ views: raw.views, clones: raw.clones, referrers: raw.referrers })
  return {
    date,
    stars: raw.stars,
    forks: raw.forks,
    openIssues: raw.openIssues,
    discussions: raw.discussions,
    latest: releases.latest,
    totalDownloads: releases.total,
    views: traffic.views,
    viewsUniques: traffic.viewsUniques,
    clones: traffic.clones,
    clonesUniques: traffic.clonesUniques,
    referrers: traffic.referrers,
    windowStart: traffic.windowStart,
    windowEnd: traffic.windowEnd,
    donations,
  }
}

const ghJson = (args) =>
  JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))

/** A traffic call: a 403 (no push access) is null, anything else is real. */
function traffic(gh, args) {
  try {
    return gh(args)
  } catch (err) {
    const text = `${err?.stderr ?? ""} ${err?.message ?? ""}`
    if (text.includes("403")) return null
    throw err
  }
}

/** Reads everything through gh. `gh` takes the args after `api` and returns
 *  parsed JSON; tests pass a fake. */
export async function collect({ repo = REPO, gh = ghJson } = {}) {
  const [owner, name] = repo.split("/")
  const graphql = gh(["graphql", "-f", `query=${GRAPHQL_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`])
  const r = graphql.data.repository
  const releases = gh([`repos/${repo}/releases`, "--paginate", "--slurp"]).flat()
  return {
    repo,
    stars: r.stargazerCount,
    forks: r.forkCount,
    openIssues: r.issues.totalCount,
    discussions: r.discussions.totalCount,
    releases,
    views: traffic(gh, [`repos/${repo}/traffic/views`]),
    clones: traffic(gh, [`repos/${repo}/traffic/clones`]),
    referrers: traffic(gh, [`repos/${repo}/traffic/popular/referrers`]),
  }
}

function readFixture(dir) {
  const read = (file) => {
    const p = path.join(dir, file)
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null
  }
  const r = read("graphql.json").data.repository
  return {
    repo: REPO,
    stars: r.stargazerCount,
    forks: r.forkCount,
    openIssues: r.issues.totalCount,
    discussions: r.discussions.totalCount,
    releases: read("releases.json") ?? [],
    views: read("views.json"),
    clones: read("clones.json"),
    referrers: read("referrers.json"),
  }
}

function usageError(message) {
  console.error(`snapshot: ${message.replace(/^snapshot: /, "")}`)
  return 1
}

const today = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const repo = flag("--repo") ?? REPO
  if (!REPO_RE.test(repo)) return usageError(`--repo must be owner/name, got: ${repo}`)
  const date = flag("--date") ?? today()
  const donations = flag("--donations") ?? "?"
  const fixture = flag("--fixture")

  let raw
  try {
    raw = fixture ? readFixture(fixture) : await collect({ repo })
  } catch (err) {
    const first = String(err?.stderr || err?.message || err).trim().split(/\r?\n/)[0]
    return usageError(`gh failed: ${first}; is gh installed and logged in (gh auth status)?`)
  }

  if (argv.includes("--json")) {
    console.log(JSON.stringify(raw, null, 2))
    return 0
  }

  const s = buildSnapshot(raw, { date, donations })
  const out = []
  if (argv.includes("--header")) out.push(HEADER)
  out.push(formatRow(s), "")
  if (s.latest) {
    const assets = s.latest.assets.map((a) => `${a.name} ${a.downloads}`).join(", ")
    out.push(`latest ${s.latest.tag} (${s.latest.publishedAt.slice(0, 10)}): ${assets}`)
  } else {
    out.push("latest: none")
  }
  out.push(
    s.windowStart
      ? `traffic window ${s.windowStart}..${s.windowEnd}`
      : "traffic window: n/a (needs push access)",
  )
  if (donations === "?") out.push("donations: typed by hand (--donations)")
  console.log(out.join("\n"))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
