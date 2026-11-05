#!/usr/bin/env node
// Checks a build's updater signatures the way an installed copy will, before
// the tag: each installer's bytes against its .sig under the pubkey in
// tauri.conf.json, and that the .sig names the version. A .sig made with the
// wrong key, or a file changed after signing, would otherwise surface as every
// copy failing at Install. Reads only; never touches the network.
//
//   node .claude/skills/release/scripts/verify-updater-sig.cjs [X.Y.Z]
//        [--bundle-dir <dir>] [--pubkey <base64 text file>]
//
// The version defaults to tauri.conf.json's, the bundle dir to
// src-tauri/target/release/bundle. Exits 1 on any failure.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const root = path.resolve(__dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"))
  process.exit(0)
}

const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"))
const version = argv[0] && !argv[0].startsWith("--") ? argv[0] : conf.version
const bundle = flag("--bundle-dir") ?? path.join(root, "src-tauri", "target", "release", "bundle")
const pubkey = flag("--pubkey") ? fs.readFileSync(flag("--pubkey"), "utf8") : conf.plugins.updater.pubkey

const b64 = (s) => Buffer.from(s.trim(), "base64")

/** minisign's public key line, as a Node key: 2 bytes of algorithm, 8 of key id, 32 of key. */
function publicKey(text) {
  const raw = b64(b64(text).toString().trim().split(/\r?\n/)[1])
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw.subarray(10)])
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" })
}

function check(key, file) {
  const sigFile = `${file}.sig`
  if (!fs.existsSync(file) || !fs.existsSync(sigFile)) return `missing ${fs.existsSync(file) ? sigFile : file}`
  const lines = b64(fs.readFileSync(sigFile, "utf8")).toString().split(/\r?\n/)
  const sig = b64(lines[1])
  const body = sig.subarray(10)
  const comment = lines[2].replace(/^trusted comment: /, "")
  const data = fs.readFileSync(file)
  // "ED" signs the file's blake2b-512, as tauri's signer does; "Ed" the bytes
  const message = sig.subarray(0, 2).toString() === "ED" ? crypto.createHash("blake2b512").update(data).digest() : data
  if (!crypto.verify(null, message, key, body)) return "the signature doesn't match this file under this key"
  if (!crypto.verify(null, Buffer.concat([body, Buffer.from(comment)]), key, b64(lines[3]))) return "the trusted comment fails its signature"
  const field = comment.split("\t").find((f) => f.startsWith("version:"))
  const signed = field ? field.slice("version:".length).trim() : null
  return signed === version ? null : `the signature names ${signed ?? "no version"}, not ${version}`
}

const key = publicKey(pubkey)
let failed = false
for (const file of [
  path.join(bundle, "nsis", `Promptline_${version}_x64-setup.exe`),
  path.join(bundle, "msi", `Promptline_${version}_x64_en-US.msi`),
]) {
  const problem = check(key, file)
  console.log(`${problem ? "FAILED" : "ok"} ${path.basename(file)}${problem ? `: ${problem}` : ""}`)
  failed ||= Boolean(problem)
}
process.exitCode = failed ? 1 : 0
