// Proves the whole auto-update loop on this machine before any real release
// depends on it: two trial builds signed with a throwaway key (never the
// real key at %USERPROFILE%\.tauri\promptline-updater.key, whose password
// stays with the maintainer), a local feed written by the real feed builder
// (scripts/latest-json.mjs), and printed steps for staging and restoring the
// machine so the maintainer only watches the toast and clicks through.
//
//   npm run update:trial
//
// Undo: this script only builds two NSIS installers under
// src-tauri/target/update-trial (gitignored) and writes a feed there; it
// never touches the maintainer's installed Promptline or data folder by
// itself. The printed steps (and 03-05-PLAN.md's Task 1/3) cover staging
// and restoring the machine around a run.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { buildFeed } from "./latest-json.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIR = path.join(root, "src-tauri", "target", "update-trial")
const BUNDLE_DIR = path.join(root, "src-tauri", "target", "release", "bundle", "nsis")

// Pre-releases of the next real version: both sort below 0.2.17, so the
// next real release installs over them cleanly. If the NSIS bundler
// rejects the pre-release form, fall back to plain versions that sort
// ABOVE the installed 0.2.16 — the maintainer must then uninstall the
// trial before reinstalling the real release (Task 3).
const PAIRS = [
  { old: "0.2.17-1", new: "0.2.17-2", aboveInstalled: false },
  { old: "0.2.90", new: "0.2.91", aboveInstalled: true },
]

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, ...opts })
  return r.status === 0
}

function exeName(version) {
  return `Promptline_${version}_x64-setup.exe`
}

function buildOne(version, keyFile, pubkey) {
  const confPath = path.join(DIR, `${version}.conf.json`)
  fs.writeFileSync(
    confPath,
    JSON.stringify(
      {
        version,
        bundle: { createUpdaterArtifacts: true },
        plugins: {
          updater: {
            pubkey,
            endpoints: ["http://127.0.0.1:8765/latest.json"],
            dangerousInsecureTransportProtocol: true,
          },
        },
      },
      null,
      2,
    ),
  )
  const ok = run("npx", ["tauri", "build", "--bundles", "nsis", "--config", confPath], {
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: keyFile, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" },
  })
  if (!ok) return false
  const exe = exeName(version)
  const exeSrc = path.join(BUNDLE_DIR, exe)
  const sigSrc = `${exeSrc}.sig`
  if (!fs.existsSync(exeSrc) || !fs.existsSync(sigSrc)) {
    console.error(`update-trial: expected ${exeSrc}(.sig) after the build, found neither or one missing`)
    return false
  }
  fs.copyFileSync(exeSrc, path.join(DIR, exe))
  fs.copyFileSync(sigSrc, path.join(DIR, `${exe}.sig`))
  return true
}

function tryPair(pair, keyFile, pubkey) {
  return buildOne(pair.old, keyFile, pubkey) && buildOne(pair.new, keyFile, pubkey)
}

function main() {
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })

  const keyFile = path.join(DIR, "trial.key")
  if (!run("npx", ["tauri", "signer", "generate", "--ci", "-p", '""', "-f", "-w", keyFile])) {
    throw new Error("update-trial: failed to generate the throwaway signing key")
  }
  const pubkey = fs.readFileSync(`${keyFile}.pub`, "utf8").trim()

  let used = null
  for (const pair of PAIRS) {
    if (tryPair(pair, keyFile, pubkey)) {
      used = pair
      break
    }
    console.warn(`update-trial: build failed for ${pair.old}/${pair.new}, trying the next fallback pair`)
  }
  if (!used) throw new Error("update-trial: every version pair failed to build; see the tauri build output above")

  if (used.aboveInstalled) {
    console.warn(
      `update-trial: the NSIS bundler rejected the pre-release versions (${PAIRS[0].old}/${PAIRS[0].new}); ` +
        `used ${used.old}/${used.new} instead. These sort ABOVE the installed real version, so the maintainer ` +
        `must uninstall the trial (${used.old} or ${used.new}) before reinstalling the real release in Task 3.`,
    )
  }

  const sig = fs.readFileSync(path.join(DIR, `${exeName(used.new)}.sig`), "utf8")
  const feed = buildFeed({
    version: used.new,
    notes: `Trial update.\n\n### Trial\n- **Install and restart** should bring back ${used.new}.\n`,
    pubDate: new Date().toISOString(),
    signatures: { nsis: sig },
    baseUrl: "http://127.0.0.1:8765/",
  })
  fs.writeFileSync(path.join(DIR, "latest.json"), JSON.stringify(feed, null, 2) + "\n")

  console.log(`
update-trial: done. OLD=${used.old} NEW=${used.new}, written to ${DIR}

Next steps (Claude stages these automatically in Task 1; listed here so the
harness is also useful stand-alone):
  1. Serve the feed:       python -m http.server 8765   (run from ${DIR})
  2. Stop the real app:    Stop-Process -Name promptline -ErrorAction SilentlyContinue
  3. Back up your data:    copy %APPDATA%\\io.github.bekalpaslan.promptline elsewhere first
  4. Install OLD passive:  Start-Process "${path.join(DIR, exeName(used.old))}" -ArgumentList "/P" -Wait
  5. Start it detached:    Start-Process "$env:LOCALAPPDATA\\Promptline\\promptline.exe"
  6. Watch for the toast and the offer for ${used.new} (03-VALIDATION.md's manual-only rows).
  7. Restore: stop the trial, uninstall it if aboveInstalled, reinstall the real release,
     restore the data folder from the backup.

Never reads or uses the real key at %USERPROFILE%\\.tauri\\promptline-updater.key.
`)
}

main()
