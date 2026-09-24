// The manager against the fake backend: the tree, the editor's autosave,
// the filter, the overview and Settings. BEHAVIOR.md "Shape" is the spec.
import { expect, test } from "@playwright/test"
import { calls, library, open, setClipboard } from "./mock"

type P = Parameters<typeof open>[0]
const tree = (page: P) => page.getByRole("tree", { name: "Library" })
const filter = (page: P) => page.getByRole("textbox", { name: "Filter prompts" })
const promptRow = (page: P, title: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${title}(,|$)`) })

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

test("clicking a prompt opens it in the editor", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Loose prompt")
  await expect(page.getByRole("textbox", { name: "Prompt text" })).toHaveValue("A prompt in no group.")
  await expect(page.getByRole("combobox", { name: "Pack" })).toHaveValue("Mock Groups")
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

test("a pack header's click folds it and shows its prompts; it is no drag handle", async ({ page }) => {
  const pack = tree(page).getByRole("treeitem", { name: "Mock Groups, 4 prompts" })
  await expect(pack).toHaveAttribute("aria-expanded", "true")
  expect(await pack.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer")
  await pack.click()
  await expect(pack).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("region", { name: "Mock Groups", exact: true })).toBeVisible()
  await pack.click()
  await expect(pack).toHaveAttribute("aria-expanded", "true")
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
  // The heading reads "Debugging 2": the name and the count
  await group.getByRole("button", { name: /^Debugging \d/ }).click()
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

test("a numbered copy of a field used in the library is not offered as a chip", async ({ page }) => {
  // One prompt uses {goal} with a numbered copy, and {step_2} on its own
  await promptRow(page, "Loose prompt").click()
  await page.getByRole("textbox", { name: "Prompt text" }).fill("Compare {goal} with {goal_2}, then {step_2}.")
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible()
  // Another prompt's editor offers the library's names: the first and the
  // lone numbered name, not the copy (the + on {goal}'s chip makes that)
  await promptRow(page, "Bisect a regression").click()
  await page.getByRole("button", { name: "Advanced options" }).click()
  await expect(page.locator('[title="Insert {goal}"]')).toBeVisible()
  await expect(page.locator('[title="Insert {step_2}"]')).toBeVisible()
  await expect(page.locator('[title="Insert {goal_2}"]')).toHaveCount(0)
})

test("Settings replaces the pane and closes again", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  await expect(page.getByRole("radiogroup", { name: "Theme" })).toBeVisible()
  await page.getByRole("button", { name: "Close settings" }).click()
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0)
})

test("a theme choice is saved as a preference and applied to the document", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" }).click()
  await expect.poll(() => calls(page, "save_prefs")).not.toHaveLength(0)
  const saved = (await calls(page, "save_prefs")).at(-1)!
  expect(saved.args).toMatchObject({ theme: "light" })
  await expect(page.locator("html")).not.toHaveClass(/dark/)
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

test("deleting a prompt asks twice, writes the library, and Undo puts it back", async ({ page }) => {
  await promptRow(page, "Loose prompt").click()
  await page.getByRole("button", { name: "Delete prompt" }).click()
  await page.getByRole("button", { name: "Confirm delete" }).click()
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
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("button", { name: "Import from clipboard" }).click()
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
