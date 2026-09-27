// Posts a release announcement on X (Releasing step 7), after the release
// and the feed are live.
//
//   node scripts/post-x.mjs --notes <notes.md> [--version X.Y.Z]
//                           [--text <file>] [--dry-run]
//   node scripts/post-x.mjs --whoami
//
// The post is the notes' lead paragraph (the same file steps 5 and 6 take),
// minus the "Builds on vX.Y.Z" sentence and markdown links, then a line
// naming the version with the release page's url. `--text <file>` posts
// that file verbatim instead. `--dry-run` prints the post and its length
// and never touches the network or the credentials.
//
// Credentials are OAuth 1.0a user-context keys for the maintainer's X
// account, read from the environment and never from a file in the repo:
// X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (the "API Key
// and Secret" and "Access Token and Secret" of the app in the X developer
// portal; the token must have Read and write permission). OAuth 1.0a
// because its tokens don't expire, so the step is one command with no
// login flow; OAuth 2.0 user tokens last two hours and need a refresh.
//
// `--whoami` signs a read of the account behind the keys and prints its
// handle: the check that the four values are right and belong to the
// account meant to post, without posting. Run it when the keys are new.
//
// Before posting, the release page must answer 200: a post must never
// carry a link that 404s (the feed rule, Releasing step 6). A 201 prints
// the post's url; anything else prints the response and exits 1.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readText } from "./read-text.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const REPO = "bekalpaslan/promptline"
export const API_URL = "https://api.x.com/2/tweets"
export const ME_URL = "https://api.x.com/2/users/me"
/** The limit for an account without Premium; weighted, see postLength. */
export const MAX_LENGTH = 280

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/

/** The release page a post links to: the tag's page, never `latest`. */
export function releaseUrl(version) {
  return `https://github.com/${REPO}/releases/tag/v${version}`
}

/** The notes' first paragraph as plain text: markdown links become their
 *  text, and the trailing "Builds on [vX.Y.Z](…)." sentence, which every
 *  release's lead ends with, is dropped (the post links to the release
 *  page, which says it). */
export function leadSentence(markdown) {
  const first = markdown.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/)[0] ?? ""
  return first
    .replace(/\n/g, " ")
    .replace(/\s*Builds on \[[^\]]*\]\([^)]*\)\.?\s*$/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
}

/** The post for a release, from its notes. */
export function postText({ version, notes }) {
  if (!VERSION_RE.test(version || "")) throw new Error(`post-x: not a version (X.Y.Z or X.Y.Z-pre): ${version}`)
  const lead = leadSentence(notes)
  if (!lead) throw new Error("post-x: the notes have no lead paragraph")
  return `${lead}\n\nPromptline ${version}: ${releaseUrl(version)}`
}

/** X's weighted length: a url counts 23 whatever its length, code points in
 *  the Latin, Greek, Cyrillic and general-punctuation ranges count 1, all
 *  others (CJK, emoji) count 2. Same ranges as twitter-text's config v3. */
export function postLength(text) {
  const URL_RE = /https?:\/\/\S+/g
  let length = 0
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    length += weigh(text.slice(last, m.index)) + 23
    last = m.index + m[0].length
  }
  return length + weigh(text.slice(last))
}

function weigh(text) {
  let n = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    const light =
      cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247)
    n += light ? 1 : 2
  }
  return n
}

/** RFC 3986 encoding, which OAuth 1.0a needs and encodeURIComponent
 *  doesn't quite do. */
export function percentEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** The OAuth 1.0a Authorization header for one request (RFC 5849, HMAC-SHA1).
 *  params: query or form-body parameters that join the signature base; a
 *  JSON body contributes none. nonce and timestamp are injectable so the
 *  signature can be checked against a known vector. */
export function oauthHeader({ method, url, credentials, params = {}, nonce, timestamp }) {
  const { apiKey, apiSecret, accessToken, accessSecret } = credentials
  const oauth = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce ?? crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: accessToken,
    oauth_version: "1.0",
  }
  const all = { ...params, ...oauth }
  const normalized = Object.keys(all)
    .map((k) => [percentEncode(k), percentEncode(all[k])])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(normalized)].join("&")
  const key = `${percentEncode(apiSecret)}&${percentEncode(accessSecret)}`
  const signature = crypto.createHmac("sha1", key).update(base).digest("base64")
  const header = { ...oauth, oauth_signature: signature }
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(header[k])}"`)
      .join(", ")
  )
}

export function credentialsFromEnv(env = process.env) {
  const names = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"]
  const missing = names.filter((n) => !env[n])
  if (missing.length) throw new Error(`post-x: set ${missing.join(", ")} (the X app's keys, from the password manager)`)
  return { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET }
}

/** POSTs the text; resolves to the created post's id. */
export async function createPost({ text, credentials, apiUrl = API_URL }) {
  const authorization = oauthHeader({ method: "POST", url: apiUrl, credentials })
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ text }),
  })
  const body = await response.text()
  if (response.status !== 201) throw new Error(`post-x: X answered ${response.status}: ${body}`)
  return JSON.parse(body).data.id
}

/** GETs the account the credentials belong to; resolves to
 *  { id, name, username }. */
export async function whoAmI({ credentials, meUrl = ME_URL }) {
  const authorization = oauthHeader({ method: "GET", url: meUrl, credentials })
  const response = await fetch(meUrl, { headers: { authorization } })
  const body = await response.text()
  if (response.status !== 200) throw new Error(`post-x: X answered ${response.status}: ${body}`)
  return JSON.parse(body).data
}

function usageError(message) {
  console.error(`post-x: ${message.replace(/^post-x: /, "")}`)
  return 1
}

async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const dryRun = argv.includes("--dry-run")
  if (argv.includes("--whoami")) {
    try {
      const me = await whoAmI({ credentials: credentialsFromEnv(), meUrl: flag("--me-url") ?? ME_URL })
      console.log(`the keys post as @${me.username} (${me.name}, id ${me.id})`)
      return 0
    } catch (e) {
      return usageError(e.message)
    }
  }
  const notesFile = flag("--notes")
  const textFile = flag("--text")
  if (!notesFile && !textFile) return usageError("--notes <file> (or --text <file>) is required")

  let version = flag("--version")
  if (!version) {
    const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"))
    version = conf.version
  }
  // Test hooks only: point both at a local server
  const apiUrl = flag("--api-url") ?? API_URL
  const pageUrl = flag("--release-url") ?? releaseUrl(version)

  let text
  try {
    // readText: PowerShell 5.1's `>` writes UTF-16, and a fs.readFileSync
    // "utf8" of that has a NUL after every letter and no blank line
    text = textFile ? readText(textFile).trim() : postText({ version, notes: readText(notesFile) })
  } catch (e) {
    return usageError(e.message)
  }
  const length = postLength(text)
  console.log(`${text}\n\n(${length} of ${MAX_LENGTH} characters)`)
  if (length > MAX_LENGTH) return usageError(`too long by ${length - MAX_LENGTH}; pass a shorter --text <file>`)
  if (dryRun) return 0

  let credentials
  try {
    credentials = credentialsFromEnv()
  } catch (e) {
    return usageError(e.message)
  }

  const page = await fetch(pageUrl, { redirect: "follow" })
  if (page.status !== 200) return usageError(`${pageUrl} answered ${page.status}; create the release first (step 5)`)

  try {
    const id = await createPost({ text, credentials, apiUrl })
    console.log(`posted https://x.com/i/web/status/${id}`)
    return 0
  } catch (e) {
    return usageError(e.message)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // exitCode, not process.exit(): exiting while the TLS socket from a fetch
  // is still closing trips a libuv assertion on Windows (async.c,
  // UV_HANDLE_CLOSING), seen on the first --whoami run
  process.exitCode = await main(process.argv.slice(2))
}
