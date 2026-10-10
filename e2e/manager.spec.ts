// The manager against the fake backend: the tree, the editor's autosave,
// the filter, the overview and Settings. BEHAVIOR.md "Shape" is the spec.
import { expect, test } from "@playwright/test"
import { calls, emit, failCommand, library, open, setClipboard, setUpdate } from "./mock"

type P = Parameters<typeof open>[0]
const tree = (page: P) => page.getByRole("tree", { name: "Library" })
const filter = (page: P) => page.getByRole("textbox", { name: "Filter prompts" })
const promptRow = (page: P, title: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${title}(,|$)`) })

const NOTES = "Fixes for the popup.\n\n### Popup\n- **Enter** pastes the prompt.\n"
const V = { version: "9.9.9", notes: NOTES }

test.beforeEach(async ({ page }) => {
  await open(page, "manager")
})

test("the sidebar lists every pack with its count", async ({ page }) => {
  const snippets = await library(page)
  const packs = new Map<string, number>()
  for (const s of snippets) packs.set(s.pack, (packs.get(s.pack) ?? 0) + 1)
  for (const [name, count] of packs) {
    await expect(tree(page).getByRole("treeitem", { name: `${name}, ${count} prompt${count === 1 ? "" : "s"}` })).toBeVisible()
  }
  await expect(page.getByText("Select a prompt to edit it")).toBeVisible()
})

test("the sidebar's edge drags to a width that survives a reload, and a double-click resets it", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: "Prompts" })
  const handle = page.getByRole("separator", { name: "Resize sidebar" })
  const before = (await sidebar.boundingBox())!.width
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 5 })
  await page.mouse.up()
  const dragged = (await sidebar.boundingBox())!.width
  expect(Math.abs(dragged - (before + 120))).toBeLessThan(3)

  await page.reload()
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(dragged, 0)

  // As far as the bounds go, then back to the default
  await handle.dblclick()
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(before, 0)
  await page.mouse.move(box.x + 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + 900, box.y + 200, { steps: 5 })
  await page.mouse.up()
  await expect(handle).toHaveAttribute("aria-valuenow", await handle.getAttribute("aria-valuemax") ?? "")
  await handle.dblclick()
})

test("the sidebar's edge resizes from the keyboard", async ({ page }) => {
  const handle = page.getByRole("separator", { name: "Resize sidebar" })
  await handle.focus()
  const start = Number(await handle.getAttribute("aria-valuenow"))
  await page.keyboard.press("ArrowRight")
  await expect(handle).toHaveAttribute("aria-valuenow", String(start + 16))
  await page.keyboard.press("Shift+ArrowLeft")
  await expect(handle).toHaveAttribute("aria-valuenow", String(start + 16 - 64))
  await page.keyboard.press("Home")
  await expect(handle).toHaveAttribute("aria-valuenow", (await handle.getAttribute("aria-valuemin"))!)
})

test("clicking a prompt opens it in the editor", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Loose prompt")
  await expect(page.getByRole("textbox", { name: "Prompt text" })).toHaveValue("A prompt in no group.")
  // Its place is the crumb line, not a field
  await expect(page.getByRole("button", { name: "Mock Groups", exact: true })).toBeVisible()
})

test("an edit autosaves through the debounce and says Saved once", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  const id = (await library(page)).find((s) => s.title === "Loose prompt")!.id
  const title = page.getByRole("textbox", { name: "Title" })
  await title.fill("Loose prompt, renamed")
  await expect(page.getByText("Saving…")).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible()
  const updates = await calls(page, "update_snippet")
  expect(updates).toHaveLength(1)
  expect(updates[0].args).toMatchObject({ id, edit: { title: "Loose prompt, renamed" } })
  // The tree follows the title
  await expect(promptRow(page, "Loose prompt, renamed")).toBeVisible()
  // The caption clears after its moment
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveCount(0, { timeout: 5_000 })
})

test("Ctrl+F reaches the filter, the tree narrows to hits, Escape clears", async ({ page }) => {
  await page.keyboard.press("Control+f")
  await expect(filter(page)).toBeFocused()
  await page.keyboard.type("bisect")
  await expect(promptRow(page, "Bisect a regression")).toBeVisible()
  await expect(promptRow(page, "Loose prompt")).toHaveCount(0)
  // A pack counts hits over all while a filter holds
  await expect(tree(page).getByRole("treeitem", { name: "Mock Groups, 1 of 4 prompts" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(filter(page)).toHaveValue("")
  await expect(promptRow(page, "Loose prompt")).toBeVisible()
})

test("#tag and >group filter the tree the way the popup searches", async ({ page }) => {
  const debug = (await library(page)).filter((s) => s.tags.includes("debug"))
  await filter(page).fill("#debug")
  // Two packs share a title ("Explain this error"), so count rows per title
  const byTitle = new Map<string, number>()
  for (const s of debug) byTitle.set(s.title, (byTitle.get(s.title) ?? 0) + 1)
  for (const [title, n] of byTitle) await expect(promptRow(page, title)).toHaveCount(n)
  await expect(promptRow(page, "Loose prompt")).toHaveCount(0)
  await filter(page).fill(">Debugging")
  await expect(promptRow(page, "Explain this error")).toBeVisible()
  await expect(promptRow(page, "Review for bugs")).toHaveCount(0)
})

test("the tree is one tab stop and the arrow keys walk it", async ({ page }) => {
  const items = tree(page).getByRole("treeitem")
  const tabStops = await items.evaluateAll((els) => els.filter((el) => el.getAttribute("tabindex") === "0").length)
  expect(tabStops).toBe(1)
  await items.first().focus()
  await page.keyboard.press("ArrowDown")
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press("End")
  await expect(items.last()).toBeFocused()
  await page.keyboard.press("Home")
  await expect(items.first()).toBeFocused()
})

test("the sidebar's rows are the popup's compact rows, and packs sit a row's height apart", async ({ page }) => {
  // One tree on two windows: a title-only row is the 24 px row the
  // popup draws in Compact, under the 28 px headers (2026-10-10)
  const row = await promptRow(page, "Just the command").boundingBox()
  expect(row!.height).toBeCloseTo(24, 0)
  const pack = await tree(page).getByRole("treeitem", { name: "Everyday, 12 prompts" }).boundingBox()
  expect(pack!.height).toBeCloseTo(28, 0)
  // 16 px from a pack's last row to the next pack's header, so a pack
  // reads as a block among rows that tight
  const everyday = await tree(page).locator("[data-pack='Everyday']").boundingBox()
  const next = await tree(page).locator("[data-pack='Mock Groups']").boundingBox()
  expect(next!.y - (everyday!.y + everyday!.height)).toBeCloseTo(16, 0)
})

test("an open pack is the panel: header on the head ground, rows on the body ground, the edge around; folded it is a row", async ({ page }) => {
  const section = tree(page).locator("[data-pack='Mock Groups']")
  const pack = tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })
  const body = section.getByRole("group").first()
  const styleOf = (l: typeof section) => l.evaluate((e) => {
    const s = getComputedStyle(e)
    return { border: parseFloat(s.borderLeftWidth), bg: s.backgroundColor }
  })
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement)
    const paint = (v: string) => { const d = document.createElement("div"); d.style.backgroundColor = v; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c }
    return { card: paint(s.getPropertyValue("--panel-head")), secondary: paint(s.getPropertyValue("--panel-body")) }
  })
  expect(await styleOf(section)).toEqual({ border: 1, bg: tokens.card })
  expect((await styleOf(body)).bg).toBe(tokens.secondary)
  // The frame pulls out by its border: the header's x is the folded one's
  const openX = (await pack.boundingBox())!.x
  await pack.focus()
  await page.keyboard.press("ArrowLeft")
  await expect(pack).toHaveAttribute("aria-expanded", "false")
  expect((await styleOf(section)).border).toBe(0)
  expect((await pack.boundingBox())!.x).toBeCloseTo(openX, 0)
})

test("Left folds a pack and Right unfolds it", async ({ page }) => {
  const pack = tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })
  await expect(pack).toHaveAttribute("aria-expanded", "true")
  await pack.focus()
  await page.keyboard.press("ArrowLeft")
  await expect(pack).toHaveAttribute("aria-expanded", "false")
  await expect(promptRow(page, "Loose prompt")).toHaveCount(0)
  await page.keyboard.press("ArrowRight")
  await expect(pack).toHaveAttribute("aria-expanded", "true")
  await expect(promptRow(page, "Loose prompt")).toBeVisible()
})

test("a pack header's click shows its prompts and opens it in the tree; Left folds it; it is no drag handle", async ({ page }) => {
  const pack = tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })
  await expect(pack).toHaveAttribute("aria-expanded", "true")
  expect(await pack.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer")
  // The click never hides what the pane is about to show
  await pack.click()
  await expect(page.getByRole("region", { name: "Mock Groups", exact: true })).toBeVisible()
  await expect(pack).toHaveAttribute("aria-expanded", "true")
  await expect(promptRow(page, "Loose prompt")).toBeVisible()
  // Folding is the keyboard's (and the chevron's); a click on a folded
  // pack opens it again along with its overview
  await pack.focus()
  await page.keyboard.press("ArrowLeft")
  await expect(pack).toHaveAttribute("aria-expanded", "false")
  await expect(promptRow(page, "Loose prompt")).toHaveCount(0)
  await pack.click()
  await expect(pack).toHaveAttribute("aria-expanded", "true")
  await expect(promptRow(page, "Loose prompt")).toBeVisible()
})

test("an empty library says so under New, and an empty pack offers its first prompt beside the words", async ({ page }) => {
  await open(page, "manager", "empty")
  const sidebar = page.getByRole("complementary", { name: "Prompts" })
  await expect(sidebar.getByText("No packs yet. New makes one.")).toBeVisible()
  await sidebar.getByRole("button", { name: "New" }).click()
  await page.getByRole("menuitem", { name: "Pack", exact: true }).click()
  await page.getByRole("textbox", { name: "Rename New pack" }).press("Enter")
  await expect(sidebar.getByText("No packs yet. New makes one.")).toHaveCount(0)
  const overview = page.getByRole("region", { name: "New pack" })
  await expect(overview.getByText("Empty pack. The first prompt starts it.")).toBeVisible()
  await overview.getByRole("button", { name: "New prompt in New pack" }).click()
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("New prompt")
})

test("a pack moves from its menu and with Alt+Down, and the order is saved", async ({ page }) => {
  const packRows = tree(page).locator('[role="treeitem"][aria-level="1"]')
  const order = async () =>
    (await packRows.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))).map((l) => l.split(",")[0])
  const before = await order()
  expect(before.length).toBeGreaterThan(2)
  // A–Z until the user arranges them
  expect(before).toEqual([...before].sort((a, b) => a.localeCompare(b)))

  await packRows.first().click({ button: "right" })
  await page.getByRole("menuitem", { name: "Move down" }).click()
  const moved = [before[1], before[0], ...before.slice(2)]
  await expect.poll(order).toEqual(moved)
  const [arranged] = await calls(page, "arrange_packs")
  expect(arranged.args?.names).toEqual(moved)

  await packRows.nth(1).focus()
  await page.keyboard.press("Alt+ArrowUp")
  await expect.poll(order).toEqual(before)
})

test("an arranged pack order holds from the first paint, not only after a save", async ({ page }) => {
  // The showcase library's registry is arranged Everyday, Acme Shop, Starter,
  // Session Flow; startup used to read the registry but not the flag, so the
  // manager drew A–Z until its first write
  await open(page, "manager", "showcase")
  const packRows = tree(page).locator('[role="treeitem"][aria-level="1"]')
  await expect
    .poll(async () => (await packRows.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))).map((l) => l.split(",")[0]))
    .toEqual(["Everyday", "Acme Shop", "Starter", "Session Flow"])
})

test("a group moves within its pack from its menu", async ({ page }) => {
  const pack = tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })
  const groups = pack.locator("xpath=..").locator('[role="treeitem"][aria-level="2"][aria-expanded]')
  const order = async () =>
    (await groups.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))).map((l) => l.split(",")[0])
  await expect.poll(order).toEqual(["Debugging", "Review"])
  const saves = (await calls(page, "save_snippets")).length

  await tree(page).getByRole("treeitem", { name: /^Review, / }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Move up" }).click()
  await expect.poll(order).toEqual(["Review", "Debugging"])
  expect((await calls(page, "save_snippets")).length).toBe(saves + 1)
  // At the top already: nothing to save
  await tree(page).getByRole("treeitem", { name: /^Review, / }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Move up" }).click()
  expect((await calls(page, "save_snippets")).length).toBe(saves + 1)
})

test("a pack title opens its overview, a group heading opens the group, Escape goes up", async ({ page }) => {
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click()
  const overview = page.getByRole("region", { name: "Mock Groups" })
  await expect(overview).toBeVisible()
  // Ungrouped prompts first, then each group under its heading
  await expect(overview.getByText("Loose prompt")).toBeVisible()
  const group = overview.getByRole("region", { name: "Debugging" })
  await expect(group).toBeVisible()
  // The heading reads "Debugging, 2 prompts" to assistive tech: the name and what the count counts
  await group.getByRole("button", { name: /^Debugging/ }).click()
  await expect(page.getByRole("region", { name: "Mock Groups › Debugging" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "Mock Groups", exact: true })).toBeVisible()
})

test("a prompt's pack crumb opens the overview, Escape returns to the pack from a prompt", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  // Escape is a mode key only outside a field: with focus on the row it goes up
  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "Mock Groups", exact: true })).toBeVisible()
})

test("the editor names a near-miss placeholder under the prompt text, and has no preview panel", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  await expect(page.getByText("Preview", { exact: true })).toHaveCount(0)
  const text = page.getByRole("textbox", { name: "Prompt text" })
  await expect(page.getByRole("note")).toHaveCount(0)
  await text.fill("Summarize {File} for {reader}")
  // {File} is not a field name (uppercase); {reader} is, so only one is named
  await expect(page.getByRole("note")).toHaveText(/^\{File\} is plain text/)
  await text.fill("Summarize {file} for {reader}")
  await expect(page.getByRole("note")).toHaveCount(0)
})

test("the editor's placeholders are the text's own; the insert menu offers the library's names, not a numbered copy", async ({ page }) => {
  // One prompt uses {goal} with a numbered copy, and {step_2} on its own
  await promptRow(page, "Loose prompt").click()
  await page.getByRole("textbox", { name: "Prompt text" }).fill("Compare {goal} with {goal_2}, then {step_2}.")
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible()
  // The chips are what this text holds, each with a way out of the text
  await expect(page.getByRole("button", { name: "Remove {goal} from the text" })).toBeVisible()
  // Both {goal} and {goal_2} offer the next free copy, counted from the stem
  await expect(page.getByRole("button", { name: "Insert {goal_3}" }).first()).toBeVisible()
  // Another prompt's insert menu offers the library's names: the first and
  // the lone numbered name, not the copy (the + on {goal}'s chip makes that)
  await promptRow(page, "Bisect a regression").click()
  await expect(page.getByRole("button", { name: "Remove {good} from the text" })).toBeVisible()
  await page.getByRole("button", { name: "Insert a placeholder" }).click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem", { name: "{goal}" })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "{step_2}" })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "{goal_2}" })).toHaveCount(0)
  await expect(menu.getByRole("menuitem", { name: "{clipboard}" })).toBeVisible()
  // What is in the text already is not offered again
  await expect(menu.getByRole("menuitem", { name: "{good}" })).toHaveCount(0)
  await menu.getByRole("menuitem", { name: "{clipboard}" }).click()
  await expect(page.getByRole("textbox", { name: "Prompt text" })).toHaveValue(/\{clipboard\}/)
})

test("the crumb's chevron moves the prompt, and the autosave keeps the move", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  await page.getByRole("button", { name: "Move to another pack or group" }).click()
  await page.getByRole("menuitem", { name: "Mock Groups" }).hover()
  const sub = page.getByRole("menu", { name: "Mock Groups" })
  // Where it is reads as the checked item
  await expect(sub.getByRole("menuitemradio", { name: "No group" })).toHaveAttribute("aria-checked", "true")
  await sub.getByRole("menuitemradio", { name: "Debugging" }).click()
  await expect(page.getByRole("button", { name: "Debugging", exact: true })).toBeVisible()
  // An edit that lands after the move writes the new place, not the old
  await page.getByRole("textbox", { name: "Title" }).fill("Loose prompt, grouped")
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible()
  const lib = await library(page)
  expect(lib.find((s) => s.title === "Loose prompt, grouped")).toMatchObject({ pack: "Mock Groups", group: "Debugging" })
})

test("Settings replaces the pane; the gear, pressed, closes it again", async ({ page }) => {
  const gear = page.getByRole("button", { name: "Settings", exact: true })
  await gear.click()
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  await expect(page.getByRole("radiogroup", { name: "Mode" })).toBeVisible()
  await expect(gear).toHaveAttribute("aria-pressed", "true")
  await gear.click()
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0)
})

test("a pack's delete asks in the same dialog, names what goes, and Undo brings the pack back", async ({ page }) => {
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete pack…" }).click()
  const dialog = page.getByRole("dialog", { name: 'Delete pack "Mock Groups"?' })
  await expect(dialog.getByText(/This deletes all 4 prompts in it/)).toBeVisible()
  await dialog.getByRole("button", { name: "Delete pack" }).click()
  await expect(tree(page).getByRole("treeitem", { name: /^Mock Groups/ })).toHaveCount(0)
  await expect.poll(() => calls(page, "delete_pack")).toHaveLength(1)
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })).toBeVisible()
})

test("a library that won't load leaves the hotkey the install actually has, not the new default", async ({ page }) => {
  // WR-03: the hotkey and the rest of the config load on their own, so a
  // failed get_snippets can't leave Settings naming Ctrl+Alt+V on an install
  // that registered Ctrl+Shift+V
  await open(page, "manager", "library-error")
  await expect(page.getByText(/Couldn't load the library/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("title", "Settings — popup hotkey: Ctrl+Shift+V")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Global hotkey" })).toHaveValue("Ctrl+Shift+V")
  await expect(page.getByRole("button", { name: "Reset to Ctrl+Alt+V" })).toBeVisible()
})

test("a mode choice is saved as a preference and applied to the document", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Light" }).click()
  await expect.poll(() => calls(page, "save_prefs")).not.toHaveLength(0)
  const saved = (await calls(page, "save_prefs")).at(-1)!
  expect(saved.args).toMatchObject({ theme: "light" })
  await expect(page.locator("html")).not.toHaveClass(/dark/)
})

test("a theme choice is saved as the palette and keyed on the document, with the mode untouched", async ({ page }) => {
  // A config from before the field reads as Instrument
  await expect(page.locator("html")).toHaveAttribute("data-theme", "instrument")
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("combobox", { name: "Theme" }).selectOption("indigo")
  await expect.poll(() => calls(page, "save_prefs")).not.toHaveLength(0)
  const saved = (await calls(page, "save_prefs")).at(-1)!
  expect(saved.args).toMatchObject({ palette: "indigo", theme: "dark" })
  await expect(page.locator("html")).toHaveAttribute("data-theme", "indigo")
  await expect(page.locator("html")).toHaveClass(/dark/)
  // Indigo's one structural difference: the sidebar's New is the filled accent button
  const newButton = page.getByRole("complementary", { name: "Prompts" }).getByRole("button", { name: "New" })
  await expect
    .poll(() => newButton.evaluate((b) => getComputedStyle(b).borderStyle))
    .toBe("solid")
})

test("a first run shows the empty state and New → Pack makes one to name", async ({ page }) => {
  await open(page, "manager", "empty")
  await expect(page.getByText("No prompts yet")).toBeVisible()
  // The sidebar's New and the empty state's New open the same menu
  await page.getByRole("complementary", { name: "Prompts" }).getByRole("button", { name: "New" }).click()
  await page.getByRole("menuitem", { name: "Pack", exact: true }).click()
  await expect.poll(() => calls(page, "add_pack")).toHaveLength(1)
  expect((await calls(page, "add_pack"))[0].args).toMatchObject({ name: "New pack" })
  // The new pack's overview opens with its name ready to type over
  await expect(page.getByRole("region", { name: "New pack" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Rename New pack" })).toBeFocused()
})

test("New → Prompt in a pack starts a draft in the editor", async ({ page }) => {
  await page.getByRole("complementary", { name: "Prompts" }).getByRole("button", { name: "New" }).click()
  await page.getByRole("menuitem", { name: "Prompt" }).hover()
  await page.getByRole("menu", { name: "Prompt" }).getByRole("menuitem", { name: "Mock Groups" }).click()
  await expect.poll(() => calls(page, "add_snippet")).toHaveLength(1)
  const [added] = await calls(page, "add_snippet")
  expect(added.args).toMatchObject({ snippet: { title: "New prompt", text: "", pack: "Mock Groups" } })
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("New prompt")
  await expect(promptRow(page, "New prompt")).toBeVisible()
})

test("deleting a prompt asks in the one delete dialog, writes the library, and Undo puts it back", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  await page.getByRole("button", { name: "Prompt actions" }).click()
  await page.getByRole("menuitem", { name: "Delete…" }).click()
  const dialog = page.getByRole("dialog", { name: 'Delete "Loose prompt"?' })
  await expect(dialog.getByText("Undo stays on offer")).toBeVisible()
  await dialog.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(promptRow(page, "Loose prompt")).toHaveCount(0)
  // The manager writes the whole list with its base revision (`persist`)
  await expect.poll(() => calls(page, "save_snippets")).toHaveLength(1)
  const [saved] = await calls(page, "save_snippets")
  expect((saved.args!.snippets as { title: string }[]).map((s) => s.title)).not.toContain("Loose prompt")
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(promptRow(page, "Loose prompt")).toBeVisible()
  await expect.poll(() => calls(page, "save_snippets")).toHaveLength(2)
})

test("an import marks a prompt with hidden characters and leaves it unticked", async ({ page }) => {
  // "hi" as Unicode tag characters: invisible in the list, read by a model
  const pack = { name: "Shared", prompts: [
    { title: "Plain", text: "Review this diff", tags: ["review"] },
    { title: "Smuggled", text: "Review this diff\u{E0068}\u{E0069}", tags: ["review"] },
  ] }
  await setClipboard(page, JSON.stringify(pack))
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Import…" }).click()
  await page.getByRole("menuitem", { name: "From clipboard" }).click()
  await expect(page.getByText("2 prompts (1 with hidden text)")).toBeVisible()
  await expect(page.getByRole("checkbox", { name: /^Plain/ })).toHaveAttribute("aria-checked", "true")
  const smuggled = page.getByRole("checkbox", { name: /^Smuggled/ })
  await expect(smuggled).toHaveAttribute("aria-checked", "false")
  await expect(smuggled.getByText("hidden text")).toHaveAttribute("title", /^2 tag characters:/)
  // Only the plain one is added unless the user ticks the other
  await page.getByRole("button", { name: "Add 1 prompt" }).click()
  await expect.poll(async () => (await library(page)).map((s) => s.title)).toContain("Plain")
  expect((await library(page)).map((s) => s.title)).not.toContain("Smuggled")
})

test("a pack and the library export to a file, in the JSON Import reads", async ({ page }) => {
  type Pack = { name: string; prompts: { title: string; group?: string }[] }
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Export to file…" }).click()
  await expect(page.getByText('Pack "Mock Groups" saved to C:\\mock\\export\\Mock Groups.json')).toBeVisible()
  const [packCall] = await calls(page, "export_pack_file")
  expect(packCall.args?.name).toBe("Mock Groups")
  const pack = JSON.parse(String(packCall.args?.text)) as Pack
  expect(pack.name).toBe("Mock Groups")
  expect(pack.prompts.map((p) => p.group ?? "")).toEqual(["Debugging", "Debugging", "Review", ""])

  // Settings exports the whole library as an array of packs
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Export…" }).click()
  await page.getByRole("menuitem", { name: "To file…" }).click()
  const [, libraryCall] = await calls(page, "export_pack_file")
  expect(libraryCall.args?.name).toBe("Promptline library")
  const packs = JSON.parse(String(libraryCall.args?.text)) as Pack[]
  const snippets = await library(page)
  expect(packs.map((p) => p.name).sort()).toEqual([...new Set(snippets.map((s) => s.pack))].sort())
  expect(packs.reduce((n, p) => n + p.prompts.length, 0)).toBe(snippets.length)
})

// ---- Updates --------------------------------------------------------------------------

test("an update offer from the tray or toast shows the version, the notes and two buttons", async ({ page }) => {
  await emit(page, "update-offer", V)
  await expect(page.getByRole("heading", { name: "Promptline 9.9.9 is available" })).toBeVisible()
  const notes = page.getByRole("region", { name: "Release notes" })
  await expect(notes).toContainText("Enter pastes the prompt.")
  await expect(notes.getByRole("heading", { name: "Popup" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Install and restart" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Later" })).toBeVisible()
})

test("Install and restart asks Rust to install the offered update", async ({ page }) => {
  await emit(page, "update-offer", V)
  await page.getByRole("button", { name: "Install and restart" }).click()
  await expect.poll(async () => (await calls(page, "install_update")).length).toBe(1)
})

test("Later closes the offer and silences that version", async ({ page }) => {
  await emit(page, "update-offer", V)
  await page.getByRole("button", { name: "Later" }).click()
  await expect(page.getByRole("heading", { name: "Promptline 9.9.9 is available" })).toHaveCount(0)
  const [call] = await calls(page, "dismiss_update")
  expect(call.args).toEqual({ version: "9.9.9" })
})

test("a store build never opens an update offer", async ({ page }) => {
  await open(page, "manager", "store")
  await emit(page, "update-offer", V)
  await expect(page.getByRole("heading", { name: "Promptline 9.9.9 is available" })).toHaveCount(0)
})

test("Check for updates opens the offer when a newer version is found", async ({ page }) => {
  await setUpdate(page, { next: V })
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Check for updates" }).click()
  await expect(page.getByRole("heading", { name: "Promptline 9.9.9 is available" })).toBeVisible()
  await expect.poll(async () => (await calls(page, "check_for_updates")).length).toBe(1)
})

test("Check for updates says so when the app is current", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Check for updates" }).click()
  await expect(page.getByText("You're on the latest version")).toBeVisible()
})

test("the automatic update check is a setting saved through Rust", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click()
  const checkbox = page.getByRole("checkbox", { name: "Check for updates automatically" })
  await expect(checkbox).toHaveAttribute("aria-checked", "true")
  await checkbox.click()
  await expect(checkbox).toHaveAttribute("aria-checked", "false")
  const [call] = await calls(page, "set_update_check")
  expect(call.args).toEqual({ enabled: false })
})

test("after Later the About card still offers the update", async ({ page }) => {
  await emit(page, "update-offer", V)
  await page.getByRole("button", { name: "Later" }).click()
  await page.getByRole("button", { name: "Settings" }).click()
  const updateButton = page.getByRole("button", { name: "Update to 9.9.9" })
  await expect(updateButton).toBeVisible()
  await updateButton.click()
  await expect(page.getByRole("heading", { name: "Promptline 9.9.9 is available" })).toBeVisible()
})

test("a store build has no update controls in Settings", async ({ page }) => {
  await open(page, "manager", "store")
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(page.getByRole("button", { name: "Check for updates" })).toHaveCount(0)
  await expect(page.getByRole("checkbox", { name: "Check for updates automatically" })).toHaveCount(0)
})

// ---- Hardening (edge cases a real library throws at the manager) ----

test("a held row floats and drops into the pack or group under the pointer", async ({ page }) => {
  const row = promptRow(page, "Bisect a regression")
  const starter = tree(page).getByRole("treeitem", { name: /^Starter, / })
  const ghost = page.locator("[data-drag-ghost]")
  await row.scrollIntoViewIfNeeded()
  const a = (await row.boundingBox())!
  await page.mouse.move(a.x + 40, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(250) // past the 180 ms hold
  await page.mouse.move(a.x + 60, a.y + a.height / 2 + 4, { steps: 2 })
  // The ghost carries the title and follows the pointer; the row stays put
  await expect(ghost).toHaveText("Bisect a regression")
  await expect(row).toHaveAttribute("aria-level", "3")
  await starter.scrollIntoViewIfNeeded()
  const b = (await starter.boundingBox())!
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 4 })
  await expect(starter).toHaveAttribute("data-drop-target", "true")
  expect(await calls(page, "save_snippets")).toHaveLength(0)
  await page.mouse.up()
  await expect.poll(() => calls(page, "save_snippets")).toHaveLength(1)
  const lib = await library(page)
  expect(lib.find((s) => s.title === "Bisect a regression")).toMatchObject({ pack: "Starter", group: "" })
  await expect(page.getByText('Moved "Bisect a regression" to "Starter"')).toBeVisible()
  await expect(ghost).toHaveCount(0)
  await expect(starter).not.toHaveAttribute("data-drop-target", "true")
})

test("the target header is highlighted while hovered and the prompt's own group is no target", async ({ page }) => {
  const row = promptRow(page, "Bisect a regression")
  const own = tree(page).getByRole("treeitem", { name: /^Debugging, / })
  const other = tree(page).getByRole("treeitem", { name: /^Review, / })
  await row.scrollIntoViewIfNeeded()
  const a = (await row.boundingBox())!
  await page.mouse.move(a.x + 40, a.y + a.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(250)
  // Headers can sit under the fold at this viewport: bring each one in first
  const hover = async (l: ReturnType<typeof promptRow>) => {
    await l.scrollIntoViewIfNeeded()
    const b = (await l.boundingBox())!
    await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 4 })
  }
  await hover(own)
  await expect(page.locator("[data-drag-ghost]")).toBeVisible()
  await expect(own).not.toHaveAttribute("data-drop-target", "true")
  await hover(other)
  await expect(other).toHaveAttribute("data-drop-target", "true")
  await expect(own).not.toHaveAttribute("data-drop-target", "true")
  // Over a row inside the group, the group's header is still the target
  await hover(promptRow(page, "Review for bugs"))
  await expect(other).toHaveAttribute("data-drop-target", "true")
  await page.mouse.up()
  await expect.poll(() => calls(page, "save_snippets")).toHaveLength(1)
  expect((await library(page)).find((s) => s.title === "Bisect a regression")).toMatchObject({ pack: "Mock Groups", group: "Review" })
})

test("Ungroup on a selection spanning packs clears the label and leaves each prompt in its pack", async ({ page }) => {
  await promptRow(page, "Bisect a regression").click()
  await promptRow(page, "Root cause first").click({ modifiers: ["Control"] })
  await promptRow(page, "Root cause first").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Ungroup" }).click()
  await expect.poll(() => calls(page, "save_snippets")).toHaveLength(1)
  const lib = await library(page)
  const bisect = lib.find((s) => s.title === "Bisect a regression")!
  const root = lib.find((s) => s.title === "Root cause first")!
  expect(bisect).toMatchObject({ pack: "Mock Groups", group: "" })
  expect(root).toMatchObject({ pack: "Starter", group: "" })
})

test("a clipboard that can't be written says so instead of claiming a copy", async ({ page }) => {
  await failCommand(page, "set_clipboard_text")
  await promptRow(page, "Loose prompt").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Export selection" }).click()
  await expect(page.getByText(/Couldn't copy/)).toBeVisible()
  await expect(page.getByText(/to clipboard$/)).toHaveCount(0)
})

test("the Enter that ends an IME composition doesn't commit a rename", async ({ page }) => {
  const pack = tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })
  await pack.dblclick()
  const field = page.getByRole("textbox", { name: "Rename pack Mock Groups" })
  await field.fill("Mock Gruppen")
  // What a Japanese or Chinese IME sends when Enter picks the candidate
  await field.dispatchEvent("keydown", { key: "Enter", isComposing: true })
  await expect(field).toBeVisible()
  expect(await calls(page, "rename_pack")).toHaveLength(0)
  await field.press("Enter")
  await expect.poll(() => calls(page, "rename_pack")).toHaveLength(1)
  expect((await calls(page, "rename_pack"))[0].args).toMatchObject({ from: "Mock Groups", to: "Mock Gruppen" })
})

test("a library that won't load is said so in the pane, not shown as empty", async ({ page }) => {
  await open(page, "manager", "library-error")
  await expect(page.getByText("The library didn't load")).toBeVisible()
  await expect(page.getByText("No prompts yet")).toHaveCount(0)
  await page.getByRole("button", { name: "Open settings" }).click()
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
})

test("a pack with a long name keeps the menus inside the window", async ({ page }) => {
  const name = "A pack whose name an agent wrote as a whole sentence about the project it surveyed and then some"
  await page.getByRole("complementary", { name: "Prompts" }).getByRole("button", { name: "New" }).click()
  await page.getByRole("menuitem", { name: "Pack", exact: true }).click()
  const field = page.getByRole("textbox", { name: "Rename New pack" })
  await field.fill(name)
  await field.press("Enter")
  await expect(page.getByRole("region", { name })).toBeVisible()
  await promptRow(page, "Loose prompt").click({ button: "right" })
  await page.getByRole("menuitem", { name: new RegExp(`^${name.slice(0, 20)}`) }).hover()
  const sub = page.getByRole("menu", { name })
  await expect(sub).toBeVisible()
  for (const menu of [page.getByRole("menu").first(), sub]) {
    const box = (await menu.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(1000)
  }
})

test("Escape or a lost window put a lifted row back with nothing saved", async ({ page }) => {
  const row = promptRow(page, "Bisect a regression")
  const starter = tree(page).getByRole("treeitem", { name: /^Starter, / })
  const ghost = page.locator("[data-drag-ghost]")
  const lift = async () => {
    await row.scrollIntoViewIfNeeded()
    const a = (await row.boundingBox())!
    await page.mouse.move(a.x + 40, a.y + a.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(250)
    await starter.scrollIntoViewIfNeeded()
    const b = (await starter.boundingBox())!
    await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 4 })
    await expect(starter).toHaveAttribute("data-drop-target", "true")
  }
  await lift()
  await page.keyboard.press("Escape")
  await expect(ghost).toHaveCount(0)
  await expect(starter).not.toHaveAttribute("data-drop-target", "true")
  await page.mouse.up()
  await page.waitForTimeout(100)
  expect(await calls(page, "save_snippets")).toHaveLength(0)
  // Escape cancelled the drag, not the view: the pane is as it was
  await expect(page.getByText("Select a prompt to edit it")).toBeVisible()
  // Alt+Tab while a row is lifted: no release ever comes, and the one that
  // came after the window was back used to drop the row wherever the
  // pointer had last been
  await lift()
  await page.evaluate(() => window.dispatchEvent(new Event("blur")))
  await expect(ghost).toHaveCount(0)
  await page.mouse.up()
  await page.waitForTimeout(100)
  expect(await calls(page, "save_snippets")).toHaveLength(0)
  await expect(row).toHaveAttribute("aria-level", "3")
})

test("Ctrl+N starts a draft where the pane is looking", async ({ page }) => {
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click()
  await expect(page.getByRole("region", { name: "Mock Groups", exact: true })).toBeVisible()
  await page.keyboard.press("Control+n")
  await expect.poll(() => calls(page, "add_snippet")).toHaveLength(1)
  expect((await calls(page, "add_snippet"))[0].args).toMatchObject({ snippet: { pack: "Mock Groups", group: "" } })
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("New prompt")
  // Not while typing: the title field keeps its Ctrl+N
  await page.keyboard.press("Control+n")
  await page.waitForTimeout(100)
  expect(await calls(page, "add_snippet")).toHaveLength(1)
})

test("a typed tag that normalises says what landed", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  // A datalist makes the box a combobox to assistive tech
  const box = page.getByRole("combobox", { name: "Add a tag" })
  await box.fill("Review, PLAN")
  await box.press("Enter")
  await expect(page.getByText("Added #review, #plan")).toBeVisible()
  await expect(page.getByRole("button", { name: "Remove #review" })).toBeVisible()
  // A tag typed as it is stored says nothing
  await box.fill("debug")
  await box.press("Enter")
  await expect(page.getByRole("button", { name: "Remove #debug" })).toBeVisible()
  await expect(page.getByText("Added #debug")).toHaveCount(0)
})

test("an overview card is named by its title, not read out with the clipboard", async ({ page }) => {
  await setClipboard(page, "TypeError: cannot read properties of undefined")
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click()
  // Named by its title and its pin, nothing more
  const card = page.getByRole("region", { name: "Mock Groups", exact: true }).getByRole("button", { name: "Explain this error, pinned", exact: true })
  await expect(card).toBeVisible()
  await expect(card).toContainText("TypeError")
  const asks = page.getByRole("button", { name: "Bisect a regression", exact: true })
  await expect(asks).toHaveAccessibleDescription(/Asks for 2 values/)
})

test("an overview card's copy button copies the prompt as the popup would, without opening it", async ({ page }) => {
  await setClipboard(page, "TypeError: x is undefined")
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click()
  const overview = page.getByRole("region", { name: "Mock Groups", exact: true })
  const clipboardNow = () => page.evaluate(() => (window as unknown as { __mock: { clipboard: string } }).__mock.clipboard)
  // The clipboard goes into {clipboard}; the editor does not open
  await overview.getByRole("button", { name: "Copy Explain this error", exact: true }).click()
  expect(await clipboardNow()).toBe("Explain this error:\n\nTypeError: x is undefined")
  await expect(page.getByText('Copied "Explain this error"')).toBeVisible()
  await expect(overview).toBeVisible()
  // Fill-in fields stay as typed, and the toast says so
  await overview.getByRole("button", { name: "Copy Bisect a regression", exact: true }).click()
  expect(await clipboardNow()).toBe("Help me bisect: it broke between {good} and {bad}.")
  await expect(page.getByText('Copied "Bisect a regression"; fill in 2 fields where you paste it')).toBeVisible()
  // Ctrl+C on a focused card does the same
  await overview.getByRole("button", { name: "Loose prompt", exact: true }).focus()
  await page.keyboard.press("Control+c")
  expect(await clipboardNow()).toBe("A prompt in no group.")
})

test("the editor's copy button copies what is in the fields now, as a card would", async ({ page }) => {
  await setClipboard(page, "TypeError: x is undefined")
  await promptRow(page, "Loose prompt").click()
  const body = page.getByRole("textbox", { name: "Prompt text", exact: true })
  await body.fill("Fix this: {clipboard}")
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as { __mock: { clipboard: string } }).__mock.clipboard)).toBe("Fix this: TypeError: x is undefined")
  await expect(page.getByText('Copied "Loose prompt"')).toBeVisible()
})

test("Auto enter is a switch under the prompt, saved at once and kept out of exports", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  const box = page.getByRole("switch", { name: "Auto enter" })
  await expect(box).not.toBeChecked()
  await box.click()
  await expect(box).toBeChecked()
  await expect.poll(async () => (await library(page)).find((s) => s.title === "Loose prompt")?.autoEnter).toBe(true)
  // Personal state: the pack's export carries no trace of it
  const exported = await page.evaluate(() => {
    const core = (window as unknown as { PromptlineCore: { packToJson(n: string, p: unknown[]): unknown } }).PromptlineCore
    const lib = (window as unknown as { __mock: { library: { snippets: { title: string }[] } } }).__mock.library
    return JSON.stringify(core.packToJson("Mock Groups", lib.snippets.filter((s) => s.title === "Loose prompt")))
  })
  expect(exported).not.toContain("autoEnter")
  await box.click()
  await expect.poll(async () => (await library(page)).find((s) => s.title === "Loose prompt")?.autoEnter).toBeFalsy()
})

test("in One list the pane shows every prompt, each card saying where it lives", async ({ page }) => {
  const total = (await library(page)).length
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click()
  await page.getByRole("button", { name: /^Display options/ }).click()
  await page.getByText("One list", { exact: true }).click()
  // The pack's overview becomes the library's: every prompt, not that pack's four
  const all = page.getByRole("region", { name: "All prompts", exact: true })
  await expect(all).toBeVisible()
  await expect(all.getByRole("button", { name: /^Copy / })).toHaveCount(total)
  await expect(all.getByRole("button", { name: "Bisect a regression", exact: true })).toContainText("Mock Groups › Debugging")
  // It follows the filter like a pack's overview
  await filter(page).fill("bisect")
  await expect(all.getByText(`1 of ${total} match the filter`)).toBeVisible()
  await filter(page).fill("")
  // A card opens the prompt; Escape comes back to the list's overview
  await all.getByRole("button", { name: "Loose prompt", exact: true }).click()
  await expect(all).toBeHidden()
  await page.locator("body").press("Escape")
  await expect(all).toBeVisible()
  // Back in Packs there is no pack it belongs to: the pane goes back to the editor
  await page.getByRole("button", { name: /^Display options/ }).click()
  await page.getByText("Packs", { exact: true }).click()
  await expect(all).toBeHidden()
})

test("the filter's placeholder keeps to 'Filter' in a narrow sidebar", async ({ page }) => {
  await expect(filter(page)).toHaveAttribute("placeholder", "Filter  #tag @pack >group")
  await page.setViewportSize({ width: 560, height: 400 })
  await expect(filter(page)).toHaveAttribute("placeholder", "Filter")
})

test("the overview follows the filter: only the hits, and how many of the pack they are", async ({ page }) => {
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click()
  const overview = page.getByRole("region", { name: "Mock Groups", exact: true })
  await expect(overview.getByRole("button", { name: /^Loose prompt/ })).toBeVisible()
  await filter(page).fill("bisect")
  await expect(overview.getByText("1 of 4 match the filter")).toBeVisible()
  await expect(overview.getByRole("button", { name: /^Bisect a regression/ })).toBeVisible()
  await expect(overview.getByRole("button", { name: /^Loose prompt/ })).toHaveCount(0)
  // A group with no hits is left out, its heading included
  await expect(overview.getByRole("region", { name: "Review" })).toHaveCount(0)
  await filter(page).fill("nothing-like-this")
  await expect(overview.getByText("None of the 4 prompts here match the filter")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(overview.getByRole("button", { name: /^Loose prompt/ })).toBeVisible()
})

test("the overview's title is set at the heading size, and one New prompt is offered per overview", async ({ page }) => {
  await tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" }).click()
  const overview = page.getByRole("region", { name: "Mock Groups", exact: true })
  const title = overview.getByRole("button", { name: /^Mock Groups/ }).first()
  await expect(title).toHaveCSS("font-size", "18px")
  await expect(title).toHaveCSS("font-weight", "600")
  await expect(overview.getByRole("button", { name: /^New prompt in/ })).toHaveCount(1)
  // The group's own overview offers its own
  await overview.getByRole("button", { name: /^Debugging/ }).click()
  await expect(page.getByRole("button", { name: "New prompt in Mock Groups › Debugging" })).toBeVisible()
})

test("the editor's ⋯ is the prompt's row menu", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  await page.getByRole("button", { name: "Prompt actions" }).click()
  const menu = page.getByRole("menu").first()
  for (const name of ["Pin", "Add tag…", "Export selection", "Delete…"]) {
    await expect(menu.getByRole("menuitem", { name })).toBeVisible()
  }
  await expect(menu.getByRole("menuitem", { name: "Mock Groups" })).toBeVisible() // Move to
  await expect(menu.getByRole("menuitem", { name: "Move up" })).toHaveCount(0)
})

test("focus returns to the row that opened a menu, even after another menu was used before", async ({ page }) => {
  // A Display menu opened and closed earlier must not become the opener
  await page.getByRole("button", { name: /^Display options/ }).click()
  await page.keyboard.press("Escape")
  const pack = tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })
  await pack.focus()
  await page.keyboard.press("Shift+F10")
  await page.getByRole("menuitem", { name: "Delete pack…" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()
  await expect(pack).toBeFocused()
})
