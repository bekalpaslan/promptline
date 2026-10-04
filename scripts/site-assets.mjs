// Fills site/ with the binaries it doesn't keep in git: the social card, the
// icons, the screenshots and the clip, copied from where they live (docs/,
// src-tauri/icons/), plus what the page actually serves, made here: each
// screenshot and clip poster as lossless WebP, the same pixels at well under
// half the bytes. The PNGs stay as the fallback and for the social tags.
// (No half-size copy for 1x screens: scaled down, the antialiased pixels
// compress worse, and the lossless file comes out larger than the full one.)
//
// The Pages workflow runs this before it uploads site/; run it yourself
// before previewing with `python -m http.server` in site/. Needs ffmpeg.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (...parts) => path.join(ROOT, ...parts)

function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
  if (run.error || run.status !== 0) {
    console.error('site-assets: ffmpeg failed or is not installed (winget install Gyan.FFmpeg)')
    process.exit(1)
  }
}

function webp(from, to) {
  ffmpeg(['-i', from, '-c:v', 'libwebp', '-lossless', '1', to])
}

function pngs(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.png'))
}

fs.copyFileSync(at('docs', 'og.png'), at('site', 'og.png'))
fs.copyFileSync(at('src-tauri', 'icons', '32x32.png'), at('site', 'favicon-32.png'))
fs.copyFileSync(at('src-tauri', 'icons', '128x128@2x.png'), at('site', 'apple-touch-icon.png'))

fs.mkdirSync(at('site', 'shots'), { recursive: true })
for (const name of pngs(at('docs', 'screenshots'))) {
  const from = at('docs', 'screenshots', name)
  const stem = name.slice(0, -'.png'.length)
  fs.copyFileSync(from, at('site', 'shots', name))
  webp(from, at('site', 'shots', `${stem}.webp`))
}

// The GIFs are the README's; the site plays the video
fs.mkdirSync(at('site', 'clip'), { recursive: true })
for (const name of fs.readdirSync(at('docs', 'clip'))) {
  if (!/\.(mp4|webm|png)$/.test(name)) continue
  const from = at('docs', 'clip', name)
  fs.copyFileSync(from, at('site', 'clip', name))
  if (name.endsWith('-poster.png')) webp(from, at('site', 'clip', name.replace(/\.png$/, '.webp')))
}

const bytes = (dir, ext) =>
  fs.readdirSync(dir).filter((n) => n.endsWith(ext)).reduce((sum, n) => sum + fs.statSync(path.join(dir, n)).size, 0)
const kb = (n) => `${Math.round(n / 1024)} KB`
console.log(
  `site-assets: ${pngs(at('site', 'shots')).length} screenshots, ` +
    `${kb(bytes(at('site', 'shots'), '.png'))} as PNG, ${kb(bytes(at('site', 'shots'), '.webp'))} as WebP`,
)
