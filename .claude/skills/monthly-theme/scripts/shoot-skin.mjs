// Shoot the manager and the popup against ?mock=showcase, both modes, with
// and without a skin stylesheet injected (or with a saved palette applied).
// Stages the same screens as e2e/shots.spec.ts. Lives inside the repo so
// Node resolves the repo's Playwright; run it from the repo root:
//
//   node .claude/skills/monthly-theme/scripts/shoot-skin.mjs --skin test-results/skin/ember.css --out test-results/skin/shots
//   node .claude/skills/monthly-theme/scripts/shoot-skin.mjs --palette ember --out test-results/skin/real
//   options: --port 5175  --only popup,manager-overview  --font inter
//
// A Vite dev server must be up on the port (npx vite --port 5175 --strictPort).
import { chromium } from "@playwright/test"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

const arg = (name, def) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : def
}
const SKIN = arg("--skin") ? readFileSync(arg("--skin"), "utf8") : null
const PALETTE = arg("--palette", null)
const FONT = arg("--font", null)
const OUT = arg("--out", "test-results/skin/shots")
const BASE = `http://localhost:${arg("--port", "5175")}`
const ONLY = (arg("--only", "") || "").split(",").filter(Boolean)
mkdirSync(OUT, { recursive: true })

const SIZE = { popup: { width: 400, height: 600 }, manager: { width: 1000, height: 800 } }
const FONT_STACKS = {
  system: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  outfit: "'Outfit Variable', sans-serif",
  inter: "'Inter Variable', sans-serif",
}

async function open(ctx, surface, mode, variant) {
  const page = await ctx.newPage()
  await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" })
  const palette = variant === "skin" && PALETTE ? PALETTE : "instrument"
  await page.addInitScript(
    ({ palette, font }) => {
      localStorage.setItem("theme", "system")
      localStorage.setItem("palette", palette)
      if (font) localStorage.setItem("font", font)
    },
    { palette, font: variant === "skin" ? FONT : null }
  )
  await page.setViewportSize(SIZE[surface])
  await page.goto(BASE + (surface === "popup" ? "/popup.html?mock=showcase" : "/?mock=showcase"))
  await page.waitForFunction(() => window.__mock?.calls.some((c) => c.cmd === "get_snippets"))
  if (surface === "manager" && (PALETTE || FONT)) {
    // The manager loads prefs from the mock config and would reset them; re-apply
    await page.waitForTimeout(300)
    await page.evaluate(
      ({ palette, font }) => {
        localStorage.setItem("palette", palette)
        document.documentElement.dataset.theme = palette
        if (font) document.documentElement.style.setProperty("--app-font", font)
      },
      { palette, font: variant === "skin" && FONT ? FONT_STACKS[FONT] ?? FONT : null }
    )
  }
  if (variant === "skin" && SKIN) await page.addStyleTag({ content: SKIN })
  await page.evaluate(() => document.fonts.ready)
  return page
}

const tree = (page) => page.getByRole("tree", { name: "Library" })
const packRow = (page, name) => tree(page).getByRole("treeitem", { name: new RegExp(`^${name},`) })
async function acmeShop(page) {
  for (const pack of ["Everyday", "Starter", "Session Flow"]) await packRow(page, pack).click()
  await packRow(page, "Acme Shop").click()
  await packRow(page, "Acme Shop").click()
  await page.getByRole("region", { name: "Acme Shop" }).waitFor()
}
async function settle(page) {
  await page.mouse.move(0, SIZE.manager.height - 1)
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((t) => t.remove()))
  await page.waitForTimeout(400)
}

const REPLY = {
  name: "Django API review",
  prompts: [
    { title: "N+1 query hunt", group: "Performance", tags: ["review", "db"], text: "Find N+1 queries in this view and show the select_related or prefetch_related that fixes each.\n\n{clipboard}" },
    { title: "Serializer validation gaps", group: "Correctness", tags: ["review"], text: "List inputs this serializer accepts that it should reject.\n\n{clipboard}" },
    { title: "Permission check audit", group: "Security", tags: ["review", "security"], text: "Which endpoints here skip an object-level permission check?\n\n{clipboard}" },
    { title: "Explain this error", group: "Debugging", tags: ["debug"], text: "Explain this error in plain words: what it means, the single most likely cause, and the first thing to check. No fix yet, and no rewriting my code until I ask.\n\n{clipboard}" },
    { title: "Migration review", group: "Correctness", tags: ["review", "db"], text: "Review this migration for data loss and locking.\n\n{clipboard}" },
  ],
}

const SHOTS = {
  "popup": async (page) => {
    await page.getByRole("option").first().waitFor()
  },
  "popup-preview": async (page) => {
    await page.getByRole("option").first().waitFor()
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowRight")
    await page.getByRole("tooltip").waitFor()
  },
  "popup-search": async (page) => {
    await page.getByRole("combobox", { name: "Search prompts" }).fill("rev")
    await page.getByRole("option").first().waitFor()
  },
  "popup-form": async (page) => {
    await page.getByRole("combobox", { name: "Search prompts" }).fill("three ways")
    await page.getByRole("option").first().waitFor()
    await page.keyboard.press("Enter")
    await page.keyboard.type("cache the product list")
    await page.getByText("Will paste").waitFor()
  },
  "manager-overview": async (page) => {
    await acmeShop(page)
  },
  "manager-editor": async (page) => {
    await acmeShop(page)
    await tree(page).getByRole("treeitem", { name: /^Trace this checkout failure/ }).click()
    await page.getByRole("textbox", { name: "Title" }).waitFor()
  },
  "manager-settings": async (page) => {
    await page.getByRole("button", { name: "Settings" }).click()
    await page.getByRole("heading", { name: "Settings" }).waitFor()
  },
  "manager-generate": async (page) => {
    await page.getByRole("button", { name: "New", exact: true }).click()
    await page.getByRole("menuitem", { name: /Generate/ }).click()
    await page.getByRole("dialog").getByRole("textbox").first().fill("Code review for a Django REST API")
    await page.getByRole("button", { name: "Copy prompt" }).click()
    await page.evaluate((text) => { window.__mock.clipboard = text }, JSON.stringify(REPLY, null, 2))
    await page.getByRole("button", { name: "Import reply from clipboard" }).click()
    await page.getByRole("checkbox", { name: /^Migration review/ }).waitFor()
    await page.getByRole("dialog").evaluate((d) => {
      const scroller = [d, ...d.querySelectorAll("*")].find(
        (e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== "visible"
      )
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
  },
}

const browser = await chromium.launch()
let failed = 0
for (const [name, stage] of Object.entries(SHOTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  for (const mode of ["dark", "light"]) {
    for (const variant of ["now", "skin"]) {
      if (variant === "skin" && !SKIN && !PALETTE) continue
      const ctx = await browser.newContext({ deviceScaleFactor: 2 })
      const surface = name.startsWith("popup") ? "popup" : "manager"
      const page = await open(ctx, surface, mode, variant)
      try {
        await stage(page)
        await settle(page)
        const file = path.join(OUT, `${name}-${mode}-${variant}.png`)
        await page.screenshot({ path: file })
        console.log("wrote", file)
      } catch (e) {
        failed++
        console.error("FAILED", name, mode, variant, e.message.split("\n")[0])
      }
      await ctx.close()
    }
  }
}
await browser.close()
process.exit(failed ? 1 : 0)
