// The launch clip on promptline.cc and in the README (SITE-01, D-01, D-02):
// copy, hotkey, pick, paste in a Windows Terminal running Claude Code, with
// the real popup over it. `npm run clip` runs this via
// playwright.clip.config.ts (playwright.config.ts ignores it), then
// scripts/clip-encode.mjs encodes docs/clip/. Every frame is a screenshot of
// a staged state held for a counted number of frames, never wall-clock
// video, so a rerun writes the same frames (D-01).
import { expect, test, type Page } from "@playwright/test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

const FPS = 15 // documented; scripts/clip-encode.mjs uses the same number
const SECONDS = 10
const OUT = "test-results/clip-frames"
const THEMES = ["light", "dark"] as const satisfies readonly string[]

// Frame counts per state, summing to 150 (10.0s at 15 fps): idle 1.2s,
// selection 0.6s, "Ctrl C" 0.8s, "Ctrl Alt V" + popup 1.0s, four letters at
// 0.2s each, Root cause first selected 0.8s, "Enter" 0.53s, the formed
// prompt in Claude Code's input 4.27s.
const T = { idle: 18, select: 9, copy: 12, summon: 15, letter: 3, picked: 12, enter: 8, pasted: 64 }

interface Scene {
  select(): string
  keys(list: string[] | null): void
  popup(show: boolean): void
  paste(text: string): void
}
interface Call {
  cmd: string
  args?: Record<string, unknown>
}

function reel(page: Page, dir: string) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let n = 0
  return {
    async hold(frames: number) {
      // One screenshot per held state, written `frames` times: the state is
      // static for its whole hold, so this is what makes two runs byte-identical.
      const buf = await page.screenshot({ animations: "disabled", caret: "hide" })
      for (let i = 0; i < frames; i++) {
        writeFileSync(`${dir}/${String(n).padStart(4, "0")}.png`, buf)
        n++
      }
    },
    count() {
      return n
    },
  }
}

const showcase = JSON.parse(readFileSync("e2e/showcase.json", "utf8")) as { clipboard: string }

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

for (const theme of THEMES) {
  test(`clip (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("theme", "system"))
    await page.goto("/e2e/clip-terminal.html")

    const frameEl = await page.locator("#popup").elementHandle()
    const frame = await frameEl!.contentFrame()
    if (!frame) throw new Error("popup iframe has no content frame")
    await frame.waitForFunction(() => (window as unknown as { __mock?: { calls: Call[] } }).__mock?.calls.some((c) => c.cmd === "get_snippets"))

    const r = reel(page, `${OUT}/${theme}`)
    await r.hold(T.idle)

    const copied = await page.evaluate(() => (window as unknown as { scene: Scene }).scene.select())
    expect(copied).toBe(showcase.clipboard)
    await r.hold(T.select)

    await page.evaluate(() => (window as unknown as { scene: Scene }).scene.keys(["Ctrl", "C"]))
    await r.hold(T.copy)

    await page.evaluate(() => (window as unknown as { scene: Scene }).scene.keys(["Ctrl", "Alt", "V"]))
    await page.evaluate(() => (window as unknown as { scene: Scene }).scene.popup(true))
    await expect(frame.getByRole("option").first()).toBeVisible()
    const popupBox = await page.locator("#popup").boundingBox()
    const traceBoxes = await page.locator(".trace").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })))
    if (popupBox) {
      for (const t of traceBoxes) expect(overlaps(popupBox, t)).toBe(false)
    }
    await r.hold(T.summon)

    await page.evaluate(() => (window as unknown as { scene: Scene }).scene.keys(null))
    const search = frame.getByRole("combobox", { name: "Search prompts" })
    let typedSoFar = ""
    for (const letter of "root") {
      typedSoFar += letter
      await search.press(letter)
      await expect(search).toHaveValue(typedSoFar)
      await r.hold(T.letter)
    }

    await expect(frame.getByRole("option").first()).toHaveAccessibleName(/^Root cause first/)
    await r.hold(T.picked)

    await page.evaluate(() => (window as unknown as { scene: Scene }).scene.keys(["Enter"]))
    await r.hold(T.enter)

    await search.press("Enter")
    let calls: Call[] = []
    await expect(async () => {
      calls = await frame.evaluate(() => (window as unknown as { __mock: { calls: Call[] } }).__mock.calls.filter((c) => c.cmd === "paste_snippet"))
      expect(calls.length).toBe(1)
    }).toPass()
    const text = String(calls[0].args!.text)
    const clip = await frame.evaluate(() => (window as unknown as { __mock: { clipboard: string } }).__mock.clipboard)
    // paste_snippet gets {clipboard} unexpanded; Rust substitutes it at paste time, and this is that one step
    const formed = text.split("{clipboard}").join(clip)
    expect(formed.startsWith("Here's the error:")).toBe(true)
    expect(formed).toContain(showcase.clipboard)

    await page.evaluate(() => (window as unknown as { scene: Scene }).scene.popup(false))
    await page.evaluate(() => (window as unknown as { scene: Scene }).scene.keys(null))
    await page.evaluate((t) => (window as unknown as { scene: Scene }).scene.paste(t), formed)
    await expect(page.locator("#typed")).toContainText("TypeError")
    await r.hold(T.pasted)

    expect(r.count()).toBe(FPS * SECONDS)
  })
}
