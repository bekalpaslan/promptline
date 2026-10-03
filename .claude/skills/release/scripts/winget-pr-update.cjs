// Move an open winget-pkgs PR (from the maintainer's fork) to a new version
// of AlpaslanBek.Promptline, as one commit through the Git Data API. For the
// case komac can't handle: the package isn't merged upstream yet, so
// `komac update` says it doesn't exist. No clone: winget-pkgs has paths
// Windows can't check out.
//
//   node .claude/skills/release/scripts/winget-pr-update.cjs <pr-number> <version> <sha256-of-setup-exe> [YYYY-MM-DD]
//
// Reads the PR's current manifests (whatever version they carry), rewrites
// the version, URL, hash, date and notes URL, drops the old folder, adds the
// new one, pushes to the PR branch, retitles the PR. Validation reruns by itself.
const { execSync } = require("child_process")
const [pr, version, sha256, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2)
if (!pr || !/^\d+\.\d+\.\d+$/.test(version || "") || !/^[0-9a-f]{64}$/i.test(sha256 || "")) {
  console.error("usage: winget-pr-update.cjs <pr-number> <version> <sha256> [date]")
  process.exit(2)
}
const id = "AlpaslanBek.Promptline"
const base = "manifests/a/AlpaslanBek/Promptline"
const gh = (args, input) => execSync(`gh ${args}`, { input, encoding: "utf8" })
const api = (method, route, body) =>
  JSON.parse(gh(`api -X ${method} "${route}" -H "Accept: application/vnd.github+json"${body ? " --input -" : ""}`, body ? JSON.stringify(body) : undefined))

const info = JSON.parse(gh(`pr view ${pr} --repo microsoft/winget-pkgs --json headRefName,headRepositoryOwner,headRepository,files`))
const owner = info.headRepositoryOwner.login, repo = info.headRepository.name, branch = info.headRefName
const oldFiles = info.files.map((f) => f.path).filter((p) => p.startsWith(base + "/"))
const oldVersion = oldFiles[0]?.split("/")[4]
if (!oldVersion) throw new Error("the PR carries no Promptline manifests")
if (oldVersion === version) { console.log(`PR ${pr} already at ${version}`); process.exit(0) }
console.log(`PR ${pr}: ${owner}/${repo}@${branch}, ${oldVersion} -> ${version}`)

const head = api("GET", `repos/${owner}/${repo}/git/ref/heads/${branch}`).object.sha
const headCommit = api("GET", `repos/${owner}/${repo}/git/commits/${head}`)
const tree = []
for (const oldPath of oldFiles) {
  const content = Buffer.from(api("GET", `repos/${owner}/${repo}/contents/${oldPath}?ref=${branch}`).content, "base64").toString("utf8")
  const next = content
    .replace(new RegExp(`PackageVersion: ${oldVersion.replace(/\./g, "\\.")}`), `PackageVersion: ${version}`)
    .replace(/ReleaseDate: \d{4}-\d{2}-\d{2}/, `ReleaseDate: ${date}`)
    .replace(/InstallerUrl: .*/, `InstallerUrl: https://github.com/bekalpaslan/promptline/releases/download/v${version}/Promptline_${version}_x64-setup.exe`)
    .replace(/InstallerSha256: [0-9A-Fa-f]{64}/, `InstallerSha256: ${sha256.toUpperCase()}`)
    .replace(/ReleaseNotesUrl: .*/, `ReleaseNotesUrl: https://github.com/bekalpaslan/promptline/releases/tag/v${version}`)
  if (/InstallerSha256:/.test(content) && !next.includes(sha256.toUpperCase())) throw new Error("hash did not land in " + oldPath)
  tree.push({ path: oldPath, mode: "100644", type: "blob", sha: null })
  const blob = api("POST", `repos/${owner}/${repo}/git/blobs`, { content: next, encoding: "utf-8" })
  tree.push({ path: oldPath.replace(`/${oldVersion}/`, `/${version}/`), mode: "100644", type: "blob", sha: blob.sha })
}
const newTree = api("POST", `repos/${owner}/${repo}/git/trees`, { base_tree: headCommit.tree.sha, tree })
const commit = api("POST", `repos/${owner}/${repo}/git/commits`, { message: `New package: ${id} version ${version}`, tree: newTree.sha, parents: [head] })
api("PATCH", `repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false })
gh(`pr edit ${pr} --repo microsoft/winget-pkgs --title "New package: ${id} version ${version}"`)
console.log(`pushed ${commit.sha.slice(0, 7)}; PR retitled`)
