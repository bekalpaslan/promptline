// Prints one row for the Snapshot table in the MARKETING doc (the living
// Claude doc; docs/MARKETING.md is its local export): stars, forks, open
// issues, Discussions, the latest release's downloads split by installer,
// every release's downloads, the 14-day traffic and referrers. Paste the row
// into the doc every two weeks; the traffic endpoints keep only 14 days, so
// a late run loses days (the window line says which).
//
//   node scripts/snapshot.mjs [--donations <n>] [--date YYYY-MM-DD]
//                             [--repo owner/name] [--header] [--json]
//                             [--releases]
//
// Everything is read through `gh api` with gh's own login: no token here,
// nothing written to disk, no numbers in the repo. Traffic needs push access;
// without it those cells print n/a. Views and clones include bots and CI:
// read the trend, not the number. Paste the output; don't redirect it from
// PowerShell 5.1, whose `>` writes UTF-16.
//
// The latest-release cell splits the downloads by installer name, because
// the names tell two populations apart. `Promptline-setup.exe` (site) is
// linked only from the website's Download button, so it is the one trace a
// site visitor leaves anywhere. `Promptline_X.Y.Z_x64-setup.exe` (versioned)
// is what the updater feed, Scoop, komac and winget fetch, and it carries a
// floor of about seven per release that is machinery, not users: komac
// hashes it, Scoop's checkver hashes it, winget validation fetches it on
// every push to the PR, and the maintainer downloads a copy. Re-estimate the
// floor when the winget New-Package PR merges. Retention reads
// versioned(N+1) minus the floor against site(N): the previous release's
// visitors who stayed for the update. `.msi` is the third count; `.sig`
// files are left out, and any other name is listed as "other" when it has
// downloads. Days as latest run from a release's publish time to the next
// stable release's (to now for the latest one; `--date` moves that "now" to
// midnight UTC of the given day), so a count is read per day, not raw.
// `--releases` prints the same per release, oldest first.
//
// `--fixture <dir>` is a test hook: it reads graphql.json, releases.json,
// views.json, clones.json and referrers.json from <dir> instead of calling gh.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const REPO = "bekalpaslan/promptline"

export const HEADER =
  "| Date | Stars | Forks | Open issues | Discussions | Latest release: site / versioned / msi (days latest) | All releases: downloads | Views 14d (unique) | Clones 14d (unique) | Top referrers | Donations |\n" +
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"

// issues(states: OPEN) leaves out pull requests, unlike REST open_issues_count;
// discussions counts 0, not an error, while Discussions is off.
const GRAPHQL_QUERY =
  "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){stargazerCount forkCount issues(states:OPEN){totalCount} discussions{totalCount}}}"

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

const DAY_MS = 86_400_000

const sumDownloads = (assets) => (assets ?? []).reduce((n, a) => n + (a.download_count ?? 0), 0)

/** Which population an asset's downloads belong to: `site` (the stable-named
 *  copy the website links), `versioned` (what the feed, Scoop and winget
 *  fetch), `msi`, `other` for a name this script doesn't know, or null for a
 *  `.sig`, which is never counted. */
export function classifyAsset(name) {
  if (name === "Promptline-setup.exe") return "site"
  if (/^Promptline_.+_x64-setup\.exe$/.test(name)) return "versioned"
  if (name.endsWith(".msi")) return "msi"
  if (name.endsWith(".sig")) return null
  return "other"
}

function countAssets(assets) {
  const counts = { site: 0, versioned: 0, msi: 0, other: 0 }
  for (const a of assets ?? []) {
    const kind = classifyAsset(a.name)
    if (kind) counts[kind] += a.download_count ?? 0
  }
  return counts
}

/** Days from one ISO time to another, one decimal, never negative. */
const daysBetween = (from, to) => Math.max(0, Math.round(((Date.parse(to) - Date.parse(from)) / DAY_MS) * 10) / 10)

/** Every non-draft release's downloads summed; every non-draft release,
 *  oldest first, with its counts and its days as latest (null for a
 *  prerelease, which is never latest); and the latest stable release
 *  (greatest published_at, prereleases and drafts excluded) with its assets.
 *  `now` closes the latest release's days-as-latest. */
export function summarizeReleases(releases, now = new Date()) {
  const nowIso = new Date(now).toISOString()
  const live = (releases ?? [])
    .filter((r) => !r.draft)
    .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)))
  const total = live.reduce((n, r) => n + sumDownloads(r.assets), 0)
  const stable = live.filter((r) => !r.prerelease)
  const list = live.map((r) => {
    const i = stable.indexOf(r)
    const next = i >= 0 ? stable[i + 1] : null
    return {
      tag: r.tag_name,
      publishedAt: r.published_at,
      prerelease: Boolean(r.prerelease),
      daysLatest: i < 0 ? null : daysBetween(r.published_at, next ? next.published_at : nowIso),
      counts: countAssets(r.assets),
    }
  })
  const newest = stable[stable.length - 1]
  if (!newest) return { total, releases: list, latest: null }
  return {
    total,
    releases: list,
    latest: {
      ...list[live.indexOf(newest)],
      assets: (newest.assets ?? []).map((a) => ({
        name: a.name,
        downloads: a.download_count ?? 0,
        kind: classifyAsset(a.name),
      })),
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

/** `3 site / 11 versioned / 1 msi`, plus ` / n other` only when n is nonzero. */
export function formatCounts(c) {
  const text = `${c.site} site / ${c.versioned} versioned / ${c.msi} msi`
  return c.other ? `${text} / ${c.other} other` : text
}

const formatDays = (d) => `${d.toFixed(1)} d latest`

/** One line per release, oldest first: tag, publish date, days as latest
 *  (or prerelease) and the counts; a floor note under them. */
export function formatReleases(list) {
  if (list.length === 0) return "releases: none"
  const width = Math.max(...list.map((r) => r.tag.length))
  const lines = list.map((r) => {
    const when = r.daysLatest === null ? "prerelease".padEnd(14) : formatDays(r.daysLatest).padStart(14)
    return `${r.tag.padEnd(width)}  ${String(r.publishedAt).slice(0, 10)}  ${when}  ${formatCounts(r.counts)}`
  })
  lines.push(
    "",
    "versioned carries a floor of about 7 per release that is machinery, not users",
    "(komac, Scoop checkver, winget validation, the maintainer's copy); site is the website's Download button",
  )
  return lines.join("\n")
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
    s.latest ? `${s.latest.tag}: ${formatCounts(s.latest.counts)} (${formatDays(s.latest.daysLatest)})` : "none",
    s.totalDownloads,
    pair(s.views, s.viewsUniques),
    pair(s.clones, s.clonesUniques),
    formatReferrers(s.referrers),
    s.donations,
  ]
  return `| ${cells.map(escapeCell).join(" | ")} |`
}

/** collect()'s raw object into formatRow's input. */
export function buildSnapshot(raw, { date, donations = "?", now = new Date() } = {}) {
  const releases = summarizeReleases(raw.releases, now)
  const traffic = summarizeTraffic({ views: raw.views, clones: raw.clones, referrers: raw.referrers })
  return {
    date,
    stars: raw.stars,
    forks: raw.forks,
    openIssues: raw.openIssues,
    discussions: raw.discussions,
    latest: releases.latest,
    releases: releases.releases,
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
  const dateFlag = flag("--date")
  const date = dateFlag ?? today()
  const now = dateFlag ? new Date(`${dateFlag}T00:00:00Z`) : new Date()
  if (Number.isNaN(now.getTime())) return usageError(`--date must be YYYY-MM-DD, got: ${dateFlag}`)
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

  const s = buildSnapshot(raw, { date, donations, now })

  if (argv.includes("--releases")) {
    console.log(formatReleases(s.releases))
    return 0
  }

  const out = []
  if (argv.includes("--header")) out.push(HEADER)
  out.push(
    formatRow(s),
    "",
    "Snapshot row for the MARKETING doc: the row above, pasted under the Snapshot table's last row; the lines below say what went into it.",
  )
  if (s.latest) {
    const assets = s.latest.assets
      .map((a) => `${a.name} ${a.downloads} ${a.kind ?? "(left out)"}`)
      .join(", ")
    out.push(
      `latest ${s.latest.tag} (${s.latest.publishedAt.slice(0, 10)}, ${formatDays(s.latest.daysLatest)}): ${assets}`,
    )
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
