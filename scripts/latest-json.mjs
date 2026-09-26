// Writes site/latest.json, the tauri-plugin-updater static feed, from a
// release's .sig files.
//
// tauri-plugin-updater 2.12.0's `get_urls` tries `{os}-{arch}-{installer}`
// before falling back to `{os}-{arch}` (confirmed against the resolved crate
// in .planning/phases/03-auto-update/03-01-SUMMARY.md, Outcome A), so this
// feed carries one key per Windows installer: an NSIS install updates via
// NSIS, an MSI install via MSI.
//
//   node scripts/latest-json.mjs --notes <notes.md> [--version X.Y.Z]
//                                [--bundle-dir <dir>] [--out <file>]
//                                [--pub-date <iso>]
//
// Never contacts the network; a Releasing step curls the written URLs
// afterward.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const REPO = "bekalpaslan/promptline"

/** windows-x86_64-{installer} keys (Outcome A: this crate version supports
 *  installer-specific keys, not only the single windows-x86_64 fallback). */
export const PLATFORM_KEYS = { nsis: "windows-x86_64-nsis", msi: "windows-x86_64-msi" }

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/

/** Installer file names for a version, matching CLAUDE.md § Releasing step 3. */
export function assetNames(version) {
  return {
    nsis: `Promptline_${version}_x64-setup.exe`,
    msi: `Promptline_${version}_x64_en-US.msi`,
  }
}

/** Release notes with the `### Install` section (and everything after it)
 *  removed and the remainder trimmed; other `###` sections are kept. */
export function feedNotes(markdown) {
  const at = markdown.indexOf("### Install")
  const cut = at < 0 ? markdown : markdown.slice(0, at)
  return cut.trim()
}

/** The static feed object tauri-plugin-updater reads.
 *  signatures: { nsis: string, msi?: string } — file contents, one platform
 *  key per signature given. baseUrl default is the versioned GitHub release
 *  asset URL (never `latest/download`, per the winget decision). */
export function buildFeed({ version, notes, pubDate, signatures, baseUrl }) {
  if (!VERSION_RE.test(version || "")) throw new Error(`latest-json: not a version (X.Y.Z or X.Y.Z-pre): ${version}`)
  if (!signatures || !signatures.nsis || !signatures.nsis.trim()) {
    throw new Error("latest-json: signatures.nsis is required and cannot be empty")
  }
  const names = assetNames(version)
  const base = baseUrl ?? `https://github.com/${REPO}/releases/download/v${version}/`
  const platforms = {}
  for (const kind of ["nsis", "msi"]) {
    const sig = signatures[kind]
    if (sig == null) continue
    if (!sig.trim()) throw new Error(`latest-json: signatures.${kind} cannot be empty`)
    platforms[PLATFORM_KEYS[kind]] = { signature: sig.trim(), url: base + names[kind] }
  }
  return { version, notes, pub_date: pubDate, platforms }
}

function usageError(message) {
  console.error(`latest-json: ${message}`)
  return 1
}

function readSig(bundleDir, dir, name) {
  const file = path.join(bundleDir, dir, `${name}.sig`)
  if (!fs.existsSync(file)) return { missing: file }
  return { content: fs.readFileSync(file, "utf8") }
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const notesFile = flag("--notes")
  if (!notesFile) return usageError("--notes <file> is required")

  let version = flag("--version")
  if (!version) {
    const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"))
    version = conf.version
  }
  const bundleDir = flag("--bundle-dir") ?? path.join(root, "src-tauri", "target", "release", "bundle")
  const out = flag("--out") ?? path.join(root, "site", "latest.json")
  const pubDate = flag("--pub-date") ?? new Date().toISOString()

  const notes = feedNotes(fs.readFileSync(notesFile, "utf8"))
  const names = assetNames(version)

  const nsisSig = readSig(bundleDir, "nsis", names.nsis)
  if (nsisSig.missing) {
    return usageError(`missing ${nsisSig.missing} — build with TAURI_SIGNING_PRIVATE_KEY set (CLAUDE.md, Releasing step 3)`)
  }
  const msiSig = readSig(bundleDir, "msi", names.msi)
  if (msiSig.missing) {
    return usageError(`missing ${msiSig.missing} — build with TAURI_SIGNING_PRIVATE_KEY set (CLAUDE.md, Releasing step 3)`)
  }

  const feed = buildFeed({
    version,
    notes,
    pubDate,
    signatures: { nsis: nsisSig.content, msi: msiSig.content },
  })

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(feed, null, 2) + "\n")
  console.log(`wrote ${out} for ${version}: ${Object.keys(feed.platforms).join(", ")}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
