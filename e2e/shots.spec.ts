// The screenshots on promptline.cc and in the README, taken against the
// showcase library (`?mock=showcase`, e2e/showcase.json) at 2x, once per
// theme: `npm run shots` rewrites docs/screenshots/<shot>-<theme>.png and
// the social card docs/og.png. Not part of `npm run test:e2e`
// (playwright.config.ts ignores this file; playwright.shots.config.ts runs
// it). Each shot stages its window through the UI, the way a person would
// get there, so a changed screen shows up in the next run.
import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"

const OUT = "docs/screenshots"
const THEMES = ["light", "dark"] as const
type Theme = (typeof THEMES)[number]
type Surface = "popup" | "manager"

// The windows' real sizes (tauri.conf.json)
const SIZE = { popup: { width: 400, height: 600 }, manager: { width: 1000, height: 800 } }

async function openWindow(page: Page, surface: Surface, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  // The showcase config says "system"; the boot script reads the cached copy
  await page.addInitScript(() => localStorage.setItem("theme", "system"))
  await page.setViewportSize(SIZE[surface])
  await page.goto(surface === "popup" ? "/popup.html?mock=showcase" : "/?mock=showcase")
  await page.waitForFunction(() =>
    (window as unknown as { __mock?: { calls: { cmd: string }[] } }).__mock?.calls.some((c) => c.cmd === "get_snippets")
  )
}

// Nothing hovered, no toast, no caret: the shot is the staged state only
async function settle(page: Page) {
  await page.mouse.move(0, SIZE.manager.height - 1)
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((t) => t.remove()))
  await page.waitForTimeout(250)
}

const tree = (page: Page) => page.getByRole("tree", { name: "Library" })
const packRow = (page: Page, name: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${name},`) })

// The manager with only Acme Shop open, its overview in the pane
async function acmeShop(page: Page, theme: Theme) {
  await openWindow(page, "manager", theme)
  for (const pack of ["Everyday", "Starter", "Session Flow"]) await packRow(page, pack).click()
  // A header click folds and shows; twice leaves it open, overview showing
  await packRow(page, "Acme Shop").click()
  await packRow(page, "Acme Shop").click()
  await expect(page.getByRole("region", { name: "Acme Shop" })).toBeVisible()
}

// A pack an AI chat might send back: three good prompts, one the library
// already has, one carrying Unicode tag characters
const REPLY = {
  name: "Django API review",
  prompts: [
    { title: "N+1 query hunt", group: "Performance", tags: ["review", "db"], text: "Find N+1 queries in this view and show the select_related or prefetch_related that fixes each.\n\n{clipboard}" },
    { title: "Serializer validation gaps", group: "Correctness", tags: ["review"], text: "List inputs this serializer accepts that it should reject.\n\n{clipboard}" },
    { title: "Permission check audit", group: "Security", tags: ["review", "security"], text: "Which endpoints here skip an object-level permission check?\n\n{clipboard}" },
    { title: "Explain this error", group: "Debugging", tags: ["debug"], text: "Explain this error in plain words: what it means, the single most likely cause, and the first thing to check. No fix yet, and no rewriting my code until I ask.\n\n{clipboard}" },
    { title: "Migration review", group: "Correctness", tags: ["review", "db"], text: "Review this migration for data loss and locking.\u{E0073}\u{E0065}\u{E006E}\u{E0064}\n\n{clipboard}" },
  ],
}

const SHOTS: Record<string, (page: Page, theme: Theme) => Promise<void>> = {
  // The popup as the hotkey opens it: pins on Ctrl+1..5, then the packs
  "popup": async (page, theme) => {
    await openWindow(page, "popup", theme)
    await expect(page.getByRole("option").first()).toBeVisible()
  },
  // → on a row: the prompt with the clipboard already in place
  "popup-preview": async (page, theme) => {
    await openWindow(page, "popup", theme)
    await expect(page.getByRole("option").first()).toBeVisible()
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowRight")
    await expect(page.getByRole("tooltip")).toContainText("TypeError")
  },
  // A few letters: titles, tags and text, best first
  "popup-search": async (page, theme) => {
    await openWindow(page, "popup", theme)
    await page.getByRole("combobox", { name: "Search prompts" }).fill("rev")
    await expect(page.getByRole("option").first()).toHaveAccessibleName(/Review against our conventions/)
  },
  // A prompt with a {field}: the form, and what will be pasted
  "popup-form": async (page, theme) => {
    await openWindow(page, "popup", theme)
    await page.getByRole("combobox", { name: "Search prompts" }).fill("three ways")
    await expect(page.getByRole("option").first()).toHaveAccessibleName(/Three ways, pick one/)
    await page.keyboard.press("Enter")
    await page.keyboard.type("cache the product list")
    await expect(page.getByText("Will paste")).toBeVisible()
  },
  // A pack's prompts as cards, the clipboard and saved values filled in
  "manager-overview": async (page, theme) => {
    await acmeShop(page, theme)
  },
  // One prompt: text, tags, fields and a saved config value
  "manager-editor": async (page, theme) => {
    // Advanced options open (the editor remembers it), so the fields and the
    // saved config value show
    await page.addInitScript(() => localStorage.setItem("advancedOpen", "1"))
    await acmeShop(page, theme)
    await tree(page).getByRole("treeitem", { name: /^Trace this checkout failure/ }).click()
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Trace this checkout failure")
    await expect(page.getByText("Config parameters")).toBeVisible()
  },
  // Generate: the reply reviewed prompt by prompt before anything is added
  "manager-generate": async (page, theme) => {
    await openWindow(page, "manager", theme)
    await page.getByRole("button", { name: "New", exact: true }).click()
    await page.getByRole("menuitem", { name: /Generate/ }).click()
    await page.getByRole("dialog").getByRole("textbox").first().fill("Code review for a Django REST API")
    await page.getByRole("button", { name: "Copy prompt" }).click()
    await page.evaluate((text) => {
      ;(window as unknown as { __mock: { clipboard: string } }).__mock.clipboard = text
    }, JSON.stringify(REPLY, null, 2))
    await page.getByRole("button", { name: "Import reply from clipboard" }).click()
    const last = page.getByRole("checkbox", { name: /^Migration review/ })
    await expect(last).toHaveAttribute("aria-checked", "false")
    // The dialog scrolls; show the checklist whole
    await page.getByRole("dialog").evaluate((d) => {
      const scroller = [d, ...d.querySelectorAll("*")].find(
        (e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== "visible"
      )
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
  },
  "manager-settings": async (page, theme) => {
    await openWindow(page, "manager", theme)
    await page.getByRole("button", { name: "Settings" }).click()
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  },
}

for (const theme of THEMES) {
  for (const [name, stage] of Object.entries(SHOTS)) {
    test(`${name} (${theme})`, async ({ page }) => {
      await stage(page, theme)
      await settle(page)
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, animations: "disabled", caret: "hide" })
    })
  }
}

// The social card (og:image, 1200x630): the manager with the popup over it,
// in the dark theme, composed from two fresh captures so it never waits on
// the files above
test("og card", async ({ page, browser }) => {
  await acmeShop(page, "dark")
  await settle(page)
  const manager = await page.screenshot({ animations: "disabled", caret: "hide" })
  const popupPage = await browser.newPage({ deviceScaleFactor: 2 })
  await SHOTS["popup-preview"](popupPage, "dark")
  await settle(popupPage)
  const popup = await popupPage.screenshot({ animations: "disabled", caret: "hide" })
  await popupPage.close()

  const card = readFileSync("e2e/og-card.html", "utf8")
    .replace("{{manager}}", `data:image/png;base64,${manager.toString("base64")}`)
    .replace("{{popup}}", `data:image/png;base64,${popup.toString("base64")}`)
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.setContent(card, { waitUntil: "load" })
  await page.screenshot({ path: "docs/og.png", scale: "css" })
})
