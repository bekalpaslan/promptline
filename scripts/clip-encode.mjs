// Encodes the launch clip's frames (test-results/clip-frames/<theme>/NNNN.png,
// written by e2e/clip.spec.ts) into docs/clip/: an MP4 and a WebM for the
// site's <video>, a GIF for the README, and the last frame as the poster.
//
//   node scripts/clip-encode.mjs           encode both themes
//   node scripts/clip-encode.mjs --check   only confirm ffmpeg is there
//
// `npm run clip` runs --check, the capture, then this. ffmpeg is a one-time
// install on the maintainer's machine, not an npm dependency:
// `winget install Gyan.FFmpeg` (or `scoop install ffmpeg`).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const FPS = 15 // must equal e2e/clip.spec.ts's FPS
export const GIF_FPS = 10
export const GIF_WIDTH = 720
export const THEMES = ["light", "dark"]
export const FRAMES_DIR = path.join(root, "test-results", "clip-frames")
export const OUT_DIR = path.join(root, "docs", "clip")

export const MISSING = "ffmpeg not found. Install it once with `winget install Gyan.FFmpeg` (or `scoop install ffmpeg`), open a new shell, and rerun `npm run clip`. To use one elsewhere, set FFMPEG to its path."

/** Candidates to probe, in order: an explicit override, PATH, then the two
 *  install locations whose shim a fresh shell may not have on PATH yet. */
export function ffmpegCandidates(env) {
  return [
    env.FFMPEG,
    "ffmpeg",
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
    env.USERPROFILE && path.join(env.USERPROFILE, "scoop", "shims", "ffmpeg.exe"),
  ].filter(Boolean)
}

export function probe(cmd) {
  try {
    execFileSync(cmd, ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function findFfmpeg(env = process.env, test = probe) {
  for (const c of ffmpegCandidates(env)) {
    if (test(c)) return c
  }
  return null
}

export function encodeArgs(theme, format, { framesDir = FRAMES_DIR, outDir = OUT_DIR, palette }) {
  const input = ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(framesDir, theme, "%04d.png")]
  const gifChain = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`
  switch (format) {
    case "mp4":
      return [...input, "-an", "-c:v", "libx264", "-preset", "veryslow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", path.join(outDir, `clip-${theme}.mp4`)]
    case "webm":
      return [...input, "-an", "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-fflags", "+bitexact", path.join(outDir, `clip-${theme}.webm`)]
    case "palette":
      return [...input, "-vf", `${gifChain},palettegen=stats_mode=diff`, palette]
    case "gif":
      return [...input, "-i", palette, "-lavfi", `${gifChain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", path.join(outDir, `clip-${theme}.gif`)]
    default:
      throw new Error(`unknown format ${format}`)
  }
}

export function main(argv) {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    console.error(MISSING)
    return 1
  }
  if (argv.includes("--check")) {
    console.log(`ffmpeg: ${ffmpeg}`)
    return 0
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const theme of THEMES) {
    const dir = path.join(FRAMES_DIR, theme)
    const frames = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : []
    if (frames.length === 0) {
      console.error(`No frames under test-results/clip-frames/${theme}: run \`npm run clip\`, which captures them first.`)
      return 1
    }
    const palette = path.join(FRAMES_DIR, `palette-${theme}.png`)
    for (const format of ["mp4", "webm", "palette", "gif"]) {
      execFileSync(ffmpeg, encodeArgs(theme, format, { palette }), { stdio: "inherit" })
    }
    const lastFrame = path.join(dir, frames.at(-1))
    const poster = path.join(OUT_DIR, `clip-${theme}-poster.png`)
    fs.copyFileSync(lastFrame, poster)
    for (const name of [`clip-${theme}.mp4`, `clip-${theme}.webm`, `clip-${theme}.gif`, `clip-${theme}-poster.png`]) {
      const size = fs.statSync(path.join(OUT_DIR, name)).size
      console.log(`docs/clip/${name}  ${Math.round(size / 1024)} KB`)
    }
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
