// The popup against the fake backend: search, pick, the fill-in form and
// the feedback strip. BEHAVIOR.md "The paste pipeline" is the spec; what
// Rust does with the pick (`paste_snippet` gets `{clipboard}` unexpanded)
// is out of reach here and covered by the Rust tests.
import { expect, test } from "@playwright/test"
import { calls, emit, library, open, setClipboard, setPasteResult } from "./mock"

const search = (page: Parameters<typeof open>[0]) => page.getByRole("combobox", { name: "Search prompts" })
const rows = (page: Parameters<typeof open>[0]) => page.getByRole("option")
// The feedback strip is hidden while empty (`empty:hidden`), so it is
// found by its markup, not its role, and "nothing shown" is toBeHidden. A
// confirmation lands in the polite status region, an error in the alert.
const strip = (page: Parameters<typeof open>[0]) =>
  page.locator(
    '[role="status"][aria-live="polite"]:not(.sr-only):visible, [role="alert"]:not([role="menu"] [role="alert"]):visible'
  )
// The line under the search box that says what the clipboard holds
const clipLine = (page: Parameters<typeof open>[0]) => page.locator("#popup-clip")

test.beforeEach(async ({ page }) => {
  await open(page, "popup")
})

test("lists the seeded library with the search box focused", async ({ page }) => {
  const snippets = await library(page)
  await expect(rows(page)).toHaveCount(snippets.length)
  await expect(search(page)).toBeFocused()
})

test("one 8 px inset: the strips share the search box's edges, and their content starts on one line", async ({ page }) => {
  const x = async (l: ReturnType<typeof rows>) => (await l.boundingBox())!.x
  const box = page.getByRole("search")
  const row = rows(page).first()
  const [boxRect, rowRect] = await Promise.all([box.boundingBox(), row.boundingBox()])
  // A row's fill spans its pack's frame, which is the search box's edges
  // (the boxes stood 8 px in for a while on 2026-10-10)
  expect(Math.abs(rowRect!.x - boxRect!.x)).toBeLessThan(0.6)
  expect(Math.abs(rowRect!.x + rowRect!.width - (boxRect!.x + boxRect!.width))).toBeLessThan(0.6)
  // The search icon, the clipboard icon, a pack's chevron and a row's
  // title start 8 px in (tree.tsx: the title under the chevrons, with no
  // glyph drawn before it, since 2026-10-10). The
  // hint bar is the sidebar's foot, so its first key starts on the strips'
  // edge itself, as the sidebar's legend does under its filter
  const starts = await Promise.all([
    x(box.locator("svg").first()),
    x(clipLine(page).locator("xpath=..").locator("svg").first()),
    x(page.locator("button", { hasText: "Everyday" }).first().locator("svg").first()),
  ])
  for (const s of starts) expect(Math.abs(s - (boxRect!.x + 8))).toBeLessThan(0.6)
  expect(Math.abs((await x(page.getByText("paste", { exact: true }).locator("xpath=..").locator("kbd").first())) - boxRect!.x)).toBeLessThan(0.6)
  expect(Math.abs((await x(row.locator("bdi").first())) - (rowRect!.x + 8))).toBeLessThan(0.6)
  // The fill-in form: fields and the button are boxes, edge to edge; the
  // title and the labels are text, 8 px in
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Enter")
  const field = page.getByRole("textbox", { name: "Good", exact: true })
  const button = page.getByRole("button", { name: /^Paste/ })
  expect(Math.abs((await x(field)) - boxRect!.x)).toBeLessThan(0.6)
  expect(Math.abs((await x(button)) - boxRect!.x)).toBeLessThan(0.6)
  const label = page.locator('label[for="field-good"]')
  const pad = await label.evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft))
  expect(Math.abs((await x(label)) + pad - (boxRect!.x + 8))).toBeLessThan(0.6)
})

test("a row is one pill, the slot key on the title line, and no button inside the option", async ({ page }) => {
  // The slot rows carry their key at the title's right edge, above the
  // row's middle: Ctrl is printed once, on the first, and the rest show
  // their digit alone
  await expect(rows(page).first().locator("kbd")).toHaveText(["Ctrl", "1"])
  const row = page.getByRole("option", { name: "Root cause first", exact: true })
  const key = row.locator("kbd").first()
  await expect(row.locator("kbd")).toHaveText(["3"])
  // Every title starts on one edge, the pack's name column: a group's
  // rows sit where the pack's own do (they hung 21 px further in, past a
  // guide line, until 2026-10-10)
  const edges = await page.getByRole("option").evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.querySelector("bdi")!.getBoundingClientRect().left)))])
  expect(edges).toHaveLength(1)
  const [keyBox, rowBox] = await Promise.all([key.boundingBox(), row.boundingBox()])
  expect(keyBox!.y + keyBox!.height).toBeLessThan(rowBox!.y + rowBox!.height / 2 + 2)
  // A listbox option holds no button: the tag pill is text the row acts on
  await expect(row.getByRole("button")).toHaveCount(0)
  // One pill; the rest fold into +N (this prompt has two tags)
  const two = (await library(page)).find((s) => s.tags.length >= 2)!
  const tagged = page.getByRole("option", { name: two.title, exact: true }).first()
  await expect(tagged.getByText(two.tags[0], { exact: true })).toBeVisible()
  await expect(tagged.getByText(`+${two.tags.length - 1}`, { exact: true })).toBeVisible()
  await expect(tagged.getByText(two.tags[1], { exact: true })).toHaveCount(0)
  // A click on the pill filters by it instead of pasting
  await tagged.getByText(two.tags[0], { exact: true }).click()
  await expect(search(page)).toHaveValue(`#${two.tags[0]} `)
  expect(await calls(page, "paste_snippet")).toHaveLength(0)
})

test("the listbox holds only options and named groups; the fold and filter buttons are hidden from assistive tech", async ({ page }) => {
  const list = page.getByRole("listbox", { name: "Prompts" })
  // getByRole leaves out aria-hidden elements: no button is in the tree
  await expect(list.getByRole("button")).toHaveCount(0)
  await expect(list.getByRole("group", { name: "Everyday", exact: true })).toHaveCount(1)
  await expect(list.getByRole("group", { name: "Everyday", exact: true }).getByRole("group", { name: "Stuck" })).toHaveCount(1)
  // The hidden buttons still work for the mouse, and nothing hidden is a tab stop
  await page.locator("button", { hasText: "Everyday" }).first().click()
  await expect(list.getByRole("group", { name: "Everyday", exact: true }).getByRole("option")).toHaveCount(0)
  await expect(search(page)).toBeFocused()
  expect(await page.locator('[aria-hidden="true"] [tabindex]:not([tabindex="-1"])').count()).toBe(0)
})

test("the selected row carries a Focus bar only once an arrow key has moved it; a fresh popup shows none", async ({ page }) => {
  const bar = (n: number) => rows(page).nth(n).evaluate((e) => getComputedStyle(e).boxShadow)
  // At rest no row carries a bar, the selected first one included, and
  // the pinned rows no longer carry a Warn bar either: the Pinned section
  // says it (both read as a glow on a popup that had just opened,
  // 2026-10-10)
  expect(await bar(0)).toBe("none")
  expect(await bar(1)).toBe("none")
  // The first ↓ brings the Focus bar out on the row it lands on
  await page.keyboard.press("ArrowDown")
  await expect.poll(() => bar(1)).toMatch(/inset/)
  expect(await bar(0)).toBe("none")
  await page.keyboard.press("ArrowUp")
  await expect.poll(() => bar(0)).toMatch(/inset/)
  expect(await bar(1)).toBe("none")
  // A summon starts over without the bar
  await emit(page, "popup-shown")
  await expect.poll(() => bar(0)).toBe("none")
})

test("pack and group headers are the sidebar's tree: a chevron each under the other, nothing filled at rest, the pack's sticky", async ({ page }) => {
  const pack = page.locator("button", { hasText: "Everyday" }).first()
  const group = page.locator("button[aria-expanded]", { hasText: "Stuck" }).first()
  const option = page.getByRole("option").nth(1)
  const fill = (l: typeof pack) => l.evaluate((e) => getComputedStyle(e.parentElement!).backgroundColor)
  const left = (l: typeof pack) => l.evaluate((e) => e.getBoundingClientRect().left)
  const clear = "rgba(0, 0, 0, 0)"
  // Nothing is filled at rest: no row, no header (the 2026-10-09 band went
  // with the one-edge layout when the two trees became one, 2026-10-10)
  expect(await option.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(clear)
  expect(await fill(pack)).toBe(clear)
  expect(await fill(group)).toBe(clear)
  // A folded pack is a plain row, as in the sidebar: its sticky wrapper
  // paints the frame's card ground only while the pack is open
  const wrap = (l: typeof pack) => l.evaluate((e) => getComputedStyle(e.parentElement!.parentElement!).backgroundColor)
  expect(await wrap(pack)).not.toBe(clear)
  await pack.click()
  await expect(pack).toHaveAttribute("aria-expanded", "false")
  expect(await wrap(pack)).toBe(clear)
  await pack.click()
  await expect(pack).toHaveAttribute("aria-expanded", "true")
  // Inside the pack's frame nothing steps: the group's chevron sits under
  // the pack's (its name on the pack's name column), and the group's rows
  // start where the group's header does, with no guide line (gone
  // 2026-10-10: the row's inset is margin enough)
  const groupRow = page.getByRole("group", { name: "Stuck", exact: true }).getByRole("option").first()
  const chevron = (l: typeof pack) => l.locator("svg").first().evaluate((e) => e.getBoundingClientRect().left)
  expect((await chevron(group)) - (await chevron(pack))).toBeCloseTo(0, 0)
  expect((await left(groupRow)) - (await left(group))).toBeCloseTo(0, 0)
  expect(await groupRow.evaluate((e) => parseFloat(getComputedStyle(e.parentElement!).borderLeftWidth))).toBe(0)
  // Scrolled into its pack, the header stays at the top of the list
  const top = await pack.evaluate((e) => {
    let s = e.parentElement
    while (s && getComputedStyle(s).overflowY !== "auto") s = s.parentElement
    s!.scrollTop = e.getBoundingClientRect().top - s!.getBoundingClientRect().top + s!.scrollTop + 60
    return s!.getBoundingClientRect().top
  })
  await expect.poll(() => pack.evaluate((e) => Math.round(e.getBoundingClientRect().top))).toBe(Math.round(top))
})

test("the pointer never moves the selection, the search border lights only while focused, and clearing a query scrolls to the top", async ({ page }) => {
  const first = rows(page).first()
  const third = rows(page).nth(2)
  await expect(first).toHaveAttribute("aria-selected", "true")
  // Two real pointer moves over another row (the first move after a summon only seeds the position)
  await third.hover({ position: { x: 20, y: 10 } })
  await third.hover({ position: { x: 40, y: 12 } })
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect(third).toHaveAttribute("aria-selected", "false")
  // A click still picks the row under the pointer
  await third.click()
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  // The search border: Focus-coloured while focused, Line when not, query or no query
  const box = page.getByRole("search")
  const focusColour = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--focus").trim())
  const toRgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
  await search(page).fill("root")
  await expect(box).toHaveCSS("border-color", toRgb(focusColour))
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(box).not.toHaveCSS("border-color", toRgb(focusColour))
  await search(page).focus()
  // Scroll the browsing list, search, clear: the list starts at the top again
  await search(page).fill("")
  const list = page.getByRole("listbox", { name: "Prompts" })
  await list.evaluate((e) => (e.scrollTop = 200))
  await search(page).fill("root")
  await search(page).fill("")
  await expect.poll(() => list.evaluate((e) => e.scrollTop)).toBe(0)
})

test("a screen reader hears a row's name, and its fill-in count as the description; the rest of the row is decoration", async ({ page }) => {
  const asks = page.getByRole("option", { name: "Just the command", exact: true })
  await expect(asks).toHaveAccessibleDescription(/Asks for 1 value before pasting/)
  // The first line, pill and slot key are aria-hidden: an option's name is its title alone
  const pinned = page.getByRole("option", { name: "Root cause first", exact: true })
  await expect(pinned).toHaveAccessibleName("Root cause first")
  expect(await pinned.locator('[aria-hidden="true"] kbd').count()).toBeGreaterThan(0)
  await expect(page.getByRole("main")).toBeVisible()
  await expect(page.getByRole("button", { name: "New prompt from clipboard (Ctrl N)" })).toBeVisible()
})

test("the clipboard line's Ctrl N key opens the new-prompt form; there is no separate create bar", async ({ page }) => {
  await expect(page.getByText("New prompt from clipboard…")).toHaveCount(0)
  await page.getByRole("button", { name: "New prompt from clipboard" }).click()
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused()
})

test("a title subsequence finds the prompt, a body needs the words", async ({ page }) => {
  await search(page).fill("rvw")
  await expect(rows(page).first()).toHaveAccessibleName(/review/i)
  // "broke between" is only in a body, so it must be contained, not fuzzy
  await search(page).fill("brkbtwn")
  await expect(rows(page)).toHaveCount(0)
  await search(page).fill("broke between")
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toHaveAccessibleName("Bisect a regression")
})

test("a row says why the search found it: where its body matched, and the tag the filter asked for", async ({ page }) => {
  // Found by its body: the second line starts near the match, underlined,
  // in place of the prompt's opening words
  await search(page).fill("broke between")
  const bisect = page.getByRole("option", { name: "Bisect a regression", exact: true })
  await expect(bisect.locator("[data-match]").first()).toHaveText(/broke/i)
  // Found by its title: the second line stays the prompt's own first line
  const body = (await library(page)).find((s) => s.title === "Bisect a regression")!.text.replace(/\s+/g, " ")
  await search(page).fill("Bisect a regression")
  await expect(bisect).toContainText(body.slice(0, 20))
  // "Try a different angle" is tagged flow, then debug: under #debug the
  // pill is debug, with flow folded into +1
  await search(page).fill("#debug")
  const angle = page.getByRole("option", { name: "Try a different angle", exact: true })
  await expect(angle.locator("[data-tag]")).toHaveText("debug")
  await expect(angle).toContainText("+1")
  // One wording for a narrowed list, and one prompt "matches"
  const status = page.locator('.sr-only[role="status"]')
  await expect(status).toHaveText(/^\d+ prompts match$/)
  await search(page).fill("broke between")
  await expect(status).toHaveText("1 prompt matches")
})

test("with no rows the hint bar offers what can still be done", async ({ page }) => {
  const hint = (label: string) => page.getByText(label, { exact: true })
  await search(page).fill("zzzz no such prompt")
  await expect(rows(page)).toHaveCount(0)
  await expect(hint("new prompt")).toBeVisible()
  await expect(hint("close")).toBeVisible()
  // Paste, copy, actions and preview have nothing to act on
  for (const gone of ["paste", "copy", "actions", "preview"]) await expect(hint(gone)).toHaveCount(0)
  // Nothing on the clipboard: nothing to save either, and the Ctrl N key says so
  await setClipboard(page, "")
  await emit(page, "popup-shown")
  await search(page).fill("zzzz no such prompt")
  await expect(hint("new prompt")).toHaveCount(0)
  await expect(hint("close")).toBeVisible()
  await expect(page.getByRole("button", { name: "New prompt from clipboard (Ctrl N)" })).toHaveAttribute("aria-disabled", "true")
})

test("#tag narrows to the prompts carrying it", async ({ page }) => {
  const tagged = (await library(page)).filter((s) => s.tags.includes("debug"))
  await search(page).fill("#debug")
  await expect(rows(page)).toHaveCount(tagged.length)
  // Two packs share a title ("Explain this error"), so count rows per title
  const byTitle = new Map<string, number>()
  for (const s of tagged) byTitle.set(s.title, (byTitle.get(s.title) ?? 0) + 1)
  for (const [title, n] of byTitle) await expect(page.getByRole("option", { name: title, exact: true })).toHaveCount(n)
})

test("Enter pastes the selected prompt and bumps its uses", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await expect(rows(page)).toHaveCount(1)
  const before = (await library(page)).find((s) => s.title === "Loose prompt")!
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  const [call] = await calls(page, "paste_snippet")
  expect(call.args).toMatchObject({ id: before.id, paste: true, text: "A prompt in no group." })
  const after = (await library(page)).find((s) => s.id === before.id)!
  expect(after.uses).toBe(before.uses + 1)
  // Rust hides the popup itself after a paste; nothing to confirm here
  await expect(strip(page)).toBeHidden()
  expect(await calls(page, "hide_popup")).toHaveLength(0)
})

test("Ctrl+Enter copies only, says so, then hides the popup", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Control+Enter")
  // Named, so a copy can't be taken for another row's
  await expect(strip(page)).toHaveText('Copied "Loose prompt" to clipboard')
  const [call] = await calls(page, "paste_snippet")
  expect(call.args).toMatchObject({ paste: false })
  await expect.poll(() => calls(page, "hide_popup")).toHaveLength(1)
})

test("a paste the backend turned into a copy says the manager was in front", async ({ page }) => {
  await setPasteResult(page, "copied")
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Enter")
  await expect(strip(page)).toHaveText('Copied "Loose prompt" to clipboard — the manager was in front')
  await expect.poll(() => calls(page, "hide_popup")).toHaveLength(1)
})

test("a second Enter while a paste is in flight is ignored", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  // Give a stray second call time to land before counting again
  await page.waitForTimeout(200)
  expect(await calls(page, "paste_snippet")).toHaveLength(1)
})

test("a {field} prompt opens a form with every field empty", async ({ page }) => {
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Enter")
  // Labels are sentence case: "good" asks as "Good"
  const good = page.getByRole("textbox", { name: "Good", exact: true })
  const bad = page.getByRole("textbox", { name: "Bad", exact: true })
  await expect(good).toBeFocused()
  await expect(good).toHaveValue("")
  await expect(bad).toHaveValue("")
  await expect(page.getByRole("button", { name: "Paste with 2 fields empty" })).toBeVisible()
  await expect(page.getByText("Will paste")).toBeVisible()

  await good.fill("v1.0")
  await expect(page.getByRole("button", { name: "Paste with 1 field empty" })).toBeVisible()
  await bad.fill("v1.1")
  await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeVisible()

  // Enter in a field submits the form, and only the form
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  const [call] = await calls(page, "paste_snippet")
  expect(call.args).toMatchObject({ paste: true, text: "Help me bisect: it broke between v1.0 and v1.1." })
})

test("Enter in a field goes to the next empty field; it pastes only when none is left ahead", async ({ page }) => {
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Enter")
  const good = page.getByRole("textbox", { name: "Good", exact: true })
  const bad = page.getByRole("textbox", { name: "Bad", exact: true })
  await expect(good).toBeFocused()
  // The bar says what Enter does here
  await expect(page.getByText("next field", { exact: true })).toBeVisible()
  await page.keyboard.type("v1.0")
  await page.keyboard.press("Enter")
  // No paste with "bad" a hole: the caret moved there instead
  await expect(bad).toBeFocused()
  await expect(bad).toBeInViewport({ ratio: 1 })
  expect(await calls(page, "paste_snippet")).toHaveLength(0)
  await expect(page.getByText("next field", { exact: true })).toBeHidden()
  // Enter would send now, with this field a hole: the bar counts it, in
  // Warn, in the button's words
  const holed = page.getByText("paste with 1 field empty", { exact: true })
  await expect(holed).toBeVisible()
  const ink = await page.getByText("back", { exact: true }).evaluate((e) => getComputedStyle(e).color)
  expect(await holed.evaluate((e) => getComputedStyle(e).color)).not.toBe(ink)
  await page.keyboard.type("v1.1")
  await expect(holed).toHaveCount(0)
  await expect(page.getByText("paste", { exact: true })).toBeVisible()
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  const [call] = await calls(page, "paste_snippet")
  expect(call.args).toMatchObject({ paste: true, text: "Help me bisect: it broke between v1.0 and v1.1." })
})

test("a deliberate blank still pastes: Enter from the last field, or Ctrl+Enter from any", async ({ page }) => {
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Enter")
  await page.keyboard.type("v1.0")
  // Ctrl+Enter is "copy now", from the first field too
  await page.keyboard.press("Control+Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  expect((await calls(page, "paste_snippet"))[0].args).toMatchObject({ paste: false, text: "Help me bisect: it broke between v1.0 and ." })
})

test("Enter on the last field pastes with the blanks the button counted", async ({ page }) => {
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Enter")
  const bad = page.getByRole("textbox", { name: "Bad", exact: true })
  await expect(bad).toBeFocused()
  await expect(page.getByRole("button", { name: "Paste with 2 fields empty" })).toBeVisible()
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  expect((await calls(page, "paste_snippet"))[0].args).toMatchObject({ paste: true, text: "Help me bisect: it broke between  and ." })
})

test("Escape leaves the form without hiding the popup", async ({ page }) => {
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("textbox", { name: "good" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("textbox", { name: "good" })).toHaveCount(0)
  await expect(rows(page)).toHaveCount(1)
  expect(await calls(page, "hide_popup")).toHaveLength(0)
})

test("Escape with nothing open hides the popup", async ({ page }) => {
  await page.keyboard.press("Escape")
  await expect.poll(() => calls(page, "hide_popup")).toHaveLength(1)
})

test("a failed paste stays in the strip until Escape, and the prompt is not re-picked", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  // Rust's message (paste.rs PASTE_FAILED_MESSAGE): what failed, then the recovery
  const message = "Couldn't paste into that window. The prompt is on your clipboard: press Ctrl+V there to paste it yourself."
  await emit(page, "paste-failed", { message })
  // An alert, whole, with the dismissal in the hint bar rather than cut off
  // the end of the message at the default width (critique popup P1)
  const alert = page.getByRole("alert")
  await expect(alert).toHaveText(message)
  const box = await alert.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(400)
  await expect(alert).not.toHaveCSS("text-overflow", "ellipsis")
  await expect(page.getByText("dismiss", { exact: true })).toBeVisible()
  await expect(page.getByText("close", { exact: true })).toHaveCount(0)
  // The first Escape only clears the error
  await page.keyboard.press("Escape")
  await expect(strip(page)).toBeHidden()
  await expect(page.getByText("close", { exact: true })).toBeVisible()
  expect(await calls(page, "hide_popup")).toHaveLength(0)
  // The pick is over: Enter picks again
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(2)
})

test("while a failed paste is showing, Enter only dismisses it, and the clipboard line is re-read", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  const [sent] = await calls(page, "paste_snippet")
  // What Rust left on the clipboard: the prompt it could not paste
  await setClipboard(page, String(sent.args!.text))
  const reads = (await calls(page, "get_clipboard_text")).length
  await emit(page, "paste-failed", { message: "Couldn't paste into that window. The prompt is on your clipboard: press Ctrl+V there to paste it yourself." })
  await expect(page.getByRole("alert")).toBeVisible()
  await expect.poll(async () => (await calls(page, "get_clipboard_text")).length).toBeGreaterThan(reads)
  await expect(clipLine(page)).toContainText("Last pasted prompt")
  // The bar leads with the recovery and no longer offers paste
  await expect(page.getByText("in the target", { exact: true })).toBeVisible()
  await expect(page.getByText("paste", { exact: true })).toHaveCount(0)
  // Enter clears the message and sends nothing
  await page.keyboard.press("Enter")
  await expect(strip(page)).toBeHidden()
  expect(await calls(page, "paste_snippet")).toHaveLength(1)
  expect(await calls(page, "hide_popup")).toHaveLength(0)
  await expect(page.getByText("paste", { exact: true })).toBeVisible()
  // The next Enter picks as usual
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(2)
})

test("a failed paste is not retried by any way of picking: a slot key, a click and the panel only clear it", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  const fail = async () => {
    await emit(page, "paste-failed", { message: "Couldn't paste into that window. The prompt is on your clipboard: press Ctrl+V there to paste it yourself." })
    await expect(page.getByRole("alert")).toBeVisible()
  }
  await fail()
  await page.keyboard.press("Control+1")
  await expect(strip(page)).toBeHidden()
  expect(await calls(page, "paste_snippet")).toHaveLength(1)
  await fail()
  await rows(page).first().click()
  await expect(strip(page)).toBeHidden()
  expect(await calls(page, "paste_snippet")).toHaveLength(1)
  await fail()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Enter")
  await expect(strip(page)).toBeHidden()
  expect(await calls(page, "paste_snippet")).toHaveLength(1)
  // The message gone, the same key sends
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(2)
})

test("a fold keeps the selection where it was, tells a screen reader what is folded, and ← after closing a card does not fold", async ({ page }) => {
  const total = await rows(page).count()
  const first = rows(page).first()
  await expect(first).toHaveAttribute("aria-selected", "true")
  // A click on another section's header: the selection stays
  await page.locator("button", { hasText: "Everyday" }).first().click()
  await expect.poll(() => rows(page).count()).toBeLessThan(total)
  await expect(first).toHaveAttribute("aria-selected", "true")
  // The status region says so; the list carries no line about it
  await expect(page.getByRole("status").first()).toContainText("1 section folded")
  await expect(page.getByText("1 section folded", { exact: true })).toHaveCount(0)
  // Ctrl+→ undoes it
  await search(page).press("Control+ArrowRight")
  await expect(rows(page)).toHaveCount(total)
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect(search(page)).toBeFocused()
  // → opens the card, ← closes it, and a ← on its heels does nothing
  const grouped = (await library(page)).findIndex((s) => !s.pinned && s.group)
  expect(grouped).toBeGreaterThanOrEqual(0)
  const pins = (await library(page)).filter((s) => s.pinned).length
  // Past the pins and the first pack's headers, onto its first row
  for (let i = 0; i < pins; i++) await page.keyboard.press("ArrowDown")
  do await page.keyboard.press("ArrowDown")
  while (!(await search(page).getAttribute("aria-activedescendant"))?.startsWith("row-"))
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("note", { name: "Preview" })).toBeVisible()
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("note", { name: "Preview" })).toBeHidden()
  await expect(rows(page)).toHaveCount(total)
  // A deliberate ← later folds, as before, and Ctrl+→ brings it back
  await page.waitForTimeout(450)
  await page.keyboard.press("ArrowLeft")
  await expect.poll(() => rows(page).count()).toBeLessThan(total)
  // Ctrl+→ opens everything; the selection stays on the header ← left it on
  await page.keyboard.press("Control+ArrowRight")
  await expect(page.locator('[role="option"][id^="row-"]')).toHaveCount(total)
  await expect(search(page)).toHaveAttribute("aria-activedescendant", "header-stop")
})

test("Enter during the Copied pause sends nothing more", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Control+Enter")
  await expect(strip(page)).toHaveText('Copied "Loose prompt" to clipboard')
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "hide_popup")).toHaveLength(1)
  const sent = await calls(page, "paste_snippet")
  expect(sent).toHaveLength(1)
  expect(sent[0].args).toMatchObject({ paste: false })
})

test("a hover card leaves the hint bar and the keys to the selected row", async ({ page }) => {
  const first = rows(page).first()
  const third = rows(page).nth(2)
  const thirdTitle = (await third.locator("bdi").first().textContent())!
  await third.hover({ position: { x: 20, y: 10 } })
  await third.hover({ position: { x: 40, y: 12 } })
  const card = page.getByRole("note", { name: "Preview" })
  await expect(card).toBeVisible()
  await expect(card).toContainText(thirdTitle)
  // The bar still speaks for the selected row: no "back", no page keys
  await expect(page.getByText("preview", { exact: true })).toBeVisible()
  await expect(page.getByText("back", { exact: true })).toHaveCount(0)
  await expect(first).toHaveAttribute("aria-selected", "true")
  // Its Copy button carries no key (Ctrl+↵ copies the selected row), and
  // the card sits clear of the row it describes
  await expect(card.getByRole("button", { name: /^Copy/ })).toHaveText("Copy")
  const [cardBox, rowBox] = await Promise.all([card.boundingBox(), third.boundingBox()])
  expect(cardBox!.y >= rowBox!.y + rowBox!.height || cardBox!.y + cardBox!.height <= rowBox!.y).toBe(true)
  // Enter pastes the selected row, as the bar says
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  const [call] = await calls(page, "paste_snippet")
  expect(`row-${String(call.args!.id)}`).toBe(await first.getAttribute("id"))
})

test("a form opened to copy says copy: its heading, its button and the bar", async ({ page }) => {
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Control+Enter")
  await expect(page.getByText("Will copy")).toBeVisible()
  await expect(page.getByText("Will paste")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Copy with 2 fields empty" })).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(page.getByText("copy with 2 fields empty", { exact: true })).toBeVisible()
})

test("Ctrl+Enter copies from the form's button too", async ({ page }) => {
  await search(page).fill("Bisect a regression")
  await page.keyboard.press("Enter")
  await page.getByRole("button", { name: "Paste with 2 fields empty" }).focus()
  await page.keyboard.press("Control+Enter")
  await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
  expect((await calls(page, "paste_snippet"))[0].args).toMatchObject({ paste: false })
})

test("Tab opens the row's actions; delete asks twice and U undoes", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Tab")
  const menu = page.getByRole("menu", { name: "Actions for Loose prompt" })
  await expect(menu).toBeVisible()
  // Each item carries its number key
  await expect(menu.getByRole("menuitem")).toHaveText([/^Paste/, /^Copy only/, /^Pin/, /^Edit in manager/, /^Delete/])
  // Focus is on the highlighted item, so a screen reader hears it move;
  // closing the panel hands focus back to the search box
  await expect(menu.getByRole("menuitem", { name: /^Paste/ })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(menu.getByRole("menuitem", { name: /^Copy only/ })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(search(page)).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(menu).toBeVisible()
  await menu.getByRole("menuitem", { name: /^Delete/ }).click()
  await expect(menu.getByRole("menuitem", { name: /^Really delete\?/ })).toBeVisible()
  await menu.getByRole("menuitem", { name: /^Really delete\?/ }).click()
  await expect.poll(() => calls(page, "delete_snippet")).toHaveLength(1)
  await expect(rows(page)).toHaveCount(0)
  // The offer is a button carrying its keys; with a query typed, U is the
  // query's, so only Ctrl Z is on it
  const undo = strip(page).getByRole("button", { name: /^Undo/ })
  await expect(strip(page)).toContainText('Deleted "Loose prompt"')
  await expect(undo).toHaveText("UndoCtrlZ")

  // Bare "u" undoes only while the search box is empty
  await search(page).fill("")
  await expect(undo).toHaveText("UndoUCtrlZ")
  await page.keyboard.press("u")
  await expect.poll(() => calls(page, "add_snippet")).toHaveLength(1)
  await expect(page.getByRole("option", { name: "Loose prompt", exact: true })).toBeVisible()
})

test("Enter at \"Really delete?\" deletes and never pastes; Esc or moving away withdraws the question", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Tab")
  const menu = page.getByRole("menu", { name: "Actions for Loose prompt" })
  const armed = menu.getByRole("menuitem", { name: /^Really delete\?/ })
  // The digit arms it and takes the highlight and the focus with it
  await page.keyboard.press("5")
  await expect(armed).toBeFocused()
  // The bar and the status region say what Enter does now
  await expect(page.getByText("delete", { exact: true })).toBeVisible()
  await expect(page.getByText("cancel", { exact: true })).toBeVisible()
  await expect(page.locator('.sr-only[role="status"]')).toHaveText(/Really delete Loose prompt\?/)
  // Esc answers no and stays in the panel
  await page.keyboard.press("Escape")
  await expect(menu).toBeVisible()
  await expect(armed).toHaveCount(0)
  await expect(menu.getByRole("menuitem", { name: /^Delete/ })).toBeFocused()
  // Arrowing off an armed item withdraws it too
  await page.keyboard.press("Enter")
  await expect(armed).toBeFocused()
  await page.keyboard.press("ArrowUp")
  await expect(armed).toHaveCount(0)
  await page.keyboard.press("ArrowDown")
  await expect(menu.getByRole("menuitem", { name: /^Delete/ })).toBeFocused()
  // Armed again, Enter is the answer: the prompt is deleted, nothing is pasted
  await page.keyboard.press("5")
  await page.keyboard.press("Enter")
  await expect.poll(() => calls(page, "delete_snippet")).toHaveLength(1)
  expect(await calls(page, "paste_snippet")).toHaveLength(0)
  await expect(menu).toBeHidden()
  await expect(search(page)).toBeFocused()
})

test("a delete's undo survives one hide and summon, then is gone", async ({ page }) => {
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Tab")
  await page.keyboard.press("5")
  await page.keyboard.press("5")
  await expect.poll(() => calls(page, "delete_snippet")).toHaveLength(1)
  const undo = strip(page).getByRole("button", { name: /^Undo/ })
  await expect(undo).toBeVisible()
  // The next summon still offers it, by Ctrl Z and the button only: U is
  // the first letter of whatever the user came back to type
  await emit(page, "popup-shown")
  await expect(strip(page)).toContainText('Deleted "Loose prompt"')
  await expect(undo).toHaveText("UndoCtrlZ")
  await page.keyboard.press("u")
  await expect(search(page)).toHaveValue("u")
  expect(await calls(page, "add_snippet")).toHaveLength(0)
  // The button puts it back and hands the keyboard to the search box
  await undo.click()
  await expect.poll(() => calls(page, "add_snippet")).toHaveLength(1)
  await expect(strip(page)).toContainText('Restored "Loose prompt"')
  await expect(search(page)).toBeFocused()

  // Deleted again and left alone: the summon after next starts clean
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Tab")
  await page.keyboard.press("5")
  await page.keyboard.press("5")
  await expect.poll(() => calls(page, "delete_snippet")).toHaveLength(2)
  await emit(page, "popup-shown")
  await expect(undo).toBeVisible()
  await emit(page, "popup-shown")
  await expect(strip(page)).toBeHidden()
  await page.keyboard.press("Control+z")
  expect(await calls(page, "add_snippet")).toHaveLength(1)
})

test("Ctrl+N drafts a prompt titled from the clipboard's first line", async ({ page }) => {
  await page.keyboard.press("Control+n")
  const title = page.getByRole("textbox", { name: "Title" })
  await expect(title).toBeFocused()
  // The mock clipboard starts as a TypeError message: 40 characters, cut at a word
  await expect(title).toHaveValue("TypeError: cannot read properties of")
})

test("an empty library shows no rows and still hides on Escape", async ({ page }) => {
  await open(page, "popup", "empty")
  await expect(rows(page)).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect.poll(() => calls(page, "hide_popup")).toHaveLength(1)
})

test("the preview flags a clipboard carrying hidden characters", async ({ page }) => {
  // A copied page with a direction override and a zero-width space in it
  await setClipboard(page, "TypeError: x is undefined\u202e\u200b")
  await emit(page, "popup-shown")
  await search(page).fill("Root cause first")
  await page.keyboard.press("ArrowRight")
  const card = page.getByRole("note", { name: "Preview" })
  await expect(card).toContainText("TypeError: x is undefined")
  await expect(card.getByText("hidden text")).toHaveAttribute("title", /^The clipboard holds 1 direction control and 1 invisible character:/)
  // A clean clipboard has no mark
  await setClipboard(page, "TypeError: x is undefined")
  await emit(page, "popup-shown")
  await search(page).fill("Root cause first")
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("note", { name: "Preview" })).toContainText("TypeError: x is undefined")
  await expect(page.getByRole("note", { name: "Preview" }).getByText("hidden text")).toHaveCount(0)
})

test("the line under the search says what the clipboard holds, and that it is empty", async ({ page }) => {
  // The mock clipboard starts as a TypeError message, shown on the builtin's tint
  await expect(clipLine(page)).toContainText("Clipboard")
  await expect(clipLine(page)).toContainText("TypeError: cannot read properties of undefined")
  await expect(search(page)).toHaveAttribute("aria-describedby", "popup-clip")
  // A ten-line trace shows its ends, and says how many lines it has
  await setClipboard(page, Array.from({ length: 10 }, (_, i) => `  at frame${i} (file.ts:${i}:1)`).join("\n"))
  await emit(page, "popup-shown")
  await expect(clipLine(page)).toContainText("10 lines")
  // Empty: said in words, and every {clipboard} row is described by the line
  await setClipboard(page, "")
  await emit(page, "popup-shown")
  await expect(clipLine(page)).toHaveText("Clipboard is empty — prompts paste without it")
  const clipRow = page.getByRole("option", { name: "Root cause first", exact: true })
  await expect(clipRow).toHaveAttribute("aria-describedby", "popup-clip")
  await expect(page.getByRole("option", { name: "Loose prompt", exact: true })).not.toHaveAttribute("aria-describedby", /popup-clip/)
})

test("Ctrl+↓ drops the whole clipboard under its line, line by line; Esc, Enter and typing put it away", async ({ page }) => {
  const trace = ["TypeError: x is undefined", "    at foo (a.ts:1:1)", "", "    at bar (b.ts:2:2)"]
  await setClipboard(page, trace.join("\r\n") + "\r\n")
  await emit(page, "popup-shown")
  const panel = page.getByRole("region", { name: "Clipboard" })
  const toggle = page.getByRole("button", { name: /TypeError: x is undefined/ })
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await search(page).press("Control+ArrowDown")
  await expect(panel).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  // The lines as they paste, indentation and the blank one kept, numbered
  for (const line of trace.filter(Boolean)) await expect(panel).toContainText(line.trim())
  await expect(panel).toContainText("4")
  await expect(page.getByText("Clipboard, 4 lines", { exact: true })).toBeAttached()
  await expect(page.getByText("back", { exact: true })).toBeVisible()
  // Enter puts it away and pastes nothing: the row it would paste is under it
  await search(page).press("Enter")
  await expect(panel).toBeHidden()
  expect((await calls(page)).filter((c) => c.cmd === "paste_snippet")).toHaveLength(0)
  // The line's text is the handle too; Esc closes it without hiding the popup
  await toggle.click()
  await expect(panel).toBeVisible()
  await search(page).press("Escape")
  await expect(panel).toBeHidden()
  expect((await calls(page)).filter((c) => c.cmd === "hide_popup")).toHaveLength(0)
  // Typing goes on into the search box and closes it
  await search(page).press("Control+ArrowDown")
  await expect(panel).toBeVisible()
  await search(page).pressSequentially("ro")
  await expect(panel).toBeHidden()
  await expect(search(page)).toHaveValue("ro")
})

test("Keep open: Ctrl+K or the button keeps the popup up after a paste, and Esc ends it", async ({ page }) => {
  const toggle = page.getByRole("button", { name: "Keep open (Ctrl K)" })
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await search(page).press("Control+k")
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  expect((await calls(page)).filter((c) => c.cmd === "set_keep_open").map((c) => c.args?.on)).toEqual([true])
  // The bar names the key that keeps it, where Esc close was
  await expect(page.getByText("kept open", { exact: true })).toBeVisible()
  // A paste says what landed and leaves the popup up, ready for the next one
  const first = (await rows(page).first().getAttribute("aria-label")) ?? ""
  await search(page).press("Enter")
  await expect(strip(page)).toContainText("Pasted")
  // The next pick waits for the paste thread's Ctrl+V (one paste at a time)
  await page.waitForTimeout(400)
  await search(page).press("Enter")
  await expect.poll(async () => (await calls(page)).filter((c) => c.cmd === "paste_snippet").length).toBe(2)
  expect((await calls(page)).filter((c) => c.cmd === "hide_popup")).toHaveLength(0)
  expect(first).not.toBe("")
  // A copy stays up too
  await page.waitForTimeout(400)
  await search(page).press("Control+Enter")
  await expect(strip(page)).toContainText("Copied")
  await page.waitForTimeout(800)
  expect((await calls(page)).filter((c) => c.cmd === "hide_popup")).toHaveLength(0)
  // Esc closes, which ends it; the next summon starts without it
  await search(page).press("Escape")
  expect((await calls(page)).filter((c) => c.cmd === "hide_popup")).toHaveLength(1)
  await emit(page, "popup-shown")
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  // The button does the same as the key
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
})

test("a prompt set to Auto enter says so, and only a paste asks Rust to press Enter", async ({ page }) => {
  // The top row is set to Auto enter (the editor's toggle)
  const title = await page.evaluate(() => {
    const lib = (window as unknown as { __mock: { library: { snippets: { title: string; pinned: boolean; autoEnter?: boolean }[] } } }).__mock.library
    const s = lib.snippets.find((x) => x.pinned)!
    s.autoEnter = true
    return s.title
  })
  await emit(page, "popup-shown")
  const row = page.getByRole("option", { name: `${title}, auto enter`, exact: true })
  await expect(row.first()).toBeVisible()
  await expect(row.first()).toHaveAttribute("aria-selected", "true")
  // The bar's Enter says what it will do, and stays one line
  await expect(page.getByText("paste and enter", { exact: true })).toBeVisible()
  const [a, b] = await Promise.all([page.getByText("paste and enter", { exact: true }).boundingBox(), page.getByText("close", { exact: true }).boundingBox()])
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
  // A copy never sends
  await search(page).press("Control+Enter")
  await expect.poll(async () => (await calls(page, "paste_snippet")).length).toBe(1)
  expect((await calls(page, "paste_snippet"))[0].args?.autoEnter).toBe(false)
  await emit(page, "popup-shown")
  await search(page).press("Enter")
  await expect.poll(async () => (await calls(page, "paste_snippet")).length).toBe(2)
  expect((await calls(page, "paste_snippet"))[1].args?.autoEnter).toBe(true)
})

test("the resting hint bar stays one line with Keep open, an Auto enter row, or both, at every width", async ({ page }) => {
  const hint = (label: string) => page.getByText(label, { exact: true })
  const oneLine = async (first: string, last: string, what: string) => {
    const [a, b] = await Promise.all([hint(first).boundingBox(), hint(last).boundingBox()])
    expect(Math.abs(a!.y - b!.y), what).toBeLessThan(2)
  }
  const setSend = (on: boolean) =>
    page.evaluate((on) => {
      const lib = (window as unknown as { __mock: { library: { snippets: { pinned: boolean; autoEnter?: boolean }[] } } }).__mock.library
      lib.snippets.find((x) => x.pinned)!.autoEnter = on
    }, on)
  for (const [keep, send] of [[true, false], [false, true], [true, true]] as const) {
    await setSend(send)
    await emit(page, "popup-shown")
    if (keep) await search(page).press("Control+k")
    const first = send ? "paste and enter" : "paste"
    const last = keep ? "kept open" : "close"
    for (const width of [320, 360, 400, 440, 500, 560, 640]) {
      await page.setViewportSize({ width, height: 600 })
      await oneLine(first, last, `keep ${keep}, send ${send}, ${width} px`)
    }
    await page.setViewportSize({ width: 400, height: 600 })
  }
})

test("the hint bar is the window's handle: a press on it moves the popup", async ({ page }) => {
  const bar = page.getByText("close", { exact: true })
  // The bar shows the grab cursor, and grabbing for a moment on a press
  expect(await bar.evaluate((el) => getComputedStyle(el).cursor)).toBe("grab")
  await bar.dispatchEvent("pointerdown", { button: 0 })
  await expect.poll(async () => (await calls(page, "plugin:window|start_dragging")).length).toBe(1)
  expect(await bar.evaluate((el) => getComputedStyle(el).cursor)).toBe("grabbing")
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).cursor)).toBe("grab")
  // Not with the other button
  await bar.dispatchEvent("pointerdown", { button: 2 })
  expect(await calls(page, "plugin:window|start_dragging")).toHaveLength(1)
  // The hand sits in the corner without taking the hints' width: the
  // resting bar stays one line at the default size, five hints and all
  const [first, last] = await Promise.all([page.getByText("paste", { exact: true }).boundingBox(), bar.boundingBox()])
  expect(Math.abs(first!.y - last!.y)).toBeLessThan(2)
  await expect(page.getByText("preview", { exact: true })).toBeVisible()
})

test("the hint bar keeps the strips' insets: kept open, the hand mirrors the first hint, on one line", async ({ page }) => {
  const W = 400
  const edge = async (sel: string, side: "left" | "right") => {
    const box = (await page.locator(sel).first().boundingBox())!
    return side === "left" ? box.x : W - (box.x + box.width)
  }
  // At rest there is no hand, and the hints start on the strips' edge:
  // the bar is the sidebar's foot (components/foot.tsx), edge to edge
  // with the strips' 12 px inset, so its first item lands where the
  // search box starts, as the sidebar's legend does under its filter
  const left = await edge('[role="search"]', "left")
  await expect(page.locator('[title="Drag here to move the popup"]')).toHaveCount(0)
  const boxRight = await edge('[role="search"]', "right")
  const firstHint = await page.getByText("paste", { exact: true }).evaluate((el) => el.parentElement!.getBoundingClientRect().left)
  // Kept open, the hand's right edge mirrors the first hint's left edge
  await search(page).press("Control+k")
  const hand = page.locator('[title="Drag here to move the popup"]')
  await expect(hand).toBeVisible()
  const handRight = await edge('[title="Drag here to move the popup"]', "right")
  expect(Math.abs(handRight - firstHint)).toBeLessThanOrEqual(1)
  expect(Math.abs(boxRight - handRight)).toBeLessThanOrEqual(1)
  expect(Math.abs(firstHint - left)).toBeLessThanOrEqual(1)
  // …and the hints stay on one line beside it
  const [a, b] = await Promise.all([page.getByText("paste", { exact: true }).boundingBox(), page.getByText("kept open", { exact: true }).boundingBox()])
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
})

test("a slot key with the clipboard panel open puts the panel away and pastes nothing", async ({ page }) => {
  await search(page).press("Control+ArrowDown")
  const panel = page.getByRole("region", { name: "Clipboard" })
  await expect(panel).toBeVisible()
  await search(page).press("Control+1")
  await expect(panel).toBeHidden()
  expect((await calls(page)).filter((c) => c.cmd === "paste_snippet")).toHaveLength(0)
})

test("the hint bar names the clipboard panel's keys, keeps a failed paste's recovery first, and stays one line", async ({ page }) => {
  const hint = (label: string) => page.getByText(label, { exact: true })
  const oneLine = async (first: string, last: string) => {
    const [a, b] = await Promise.all([hint(first).boundingBox(), hint(last).boundingBox()])
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
  }
  // A clipboard of several lines prints the key on its own strip, at any
  // width, and the bar leaves it out
  await setClipboard(page, Array.from({ length: 80 }, (_, i) => `  at frame${i} (file.ts:${i}:1)`).join("\n"))
  await emit(page, "popup-shown")
  await expect(page.locator("kbd").filter({ hasText: /^↓$/ })).toBeVisible()
  await page.setViewportSize({ width: 590, height: 600 })
  await expect(hint("clipboard")).toBeHidden()
  await page.setViewportSize({ width: 400, height: 600 })
  // One long line: the key that opens it waits for a window with room for
  // a seventh hint
  await setClipboard(page, "x".repeat(400))
  await emit(page, "popup-shown")
  await expect(hint("clipboard")).toBeHidden()
  await page.setViewportSize({ width: 540, height: 600 })
  await expect(hint("clipboard")).toBeHidden()
  await oneLine("paste", "close")
  await page.setViewportSize({ width: 590, height: 600 })
  await expect(hint("clipboard")).toBeVisible()
  await oneLine("paste", "close")
  await setClipboard(page, Array.from({ length: 80 }, (_, i) => `  at frame${i} (file.ts:${i}:1)`).join("\n"))
  await emit(page, "popup-shown")
  await search(page).press("Control+ArrowDown")
  await expect(hint("scroll")).toBeVisible()
  await expect(hint("page")).toBeVisible()
  await oneLine("scroll", "back")
  for (const width of [320, 400, 440, 500]) {
    await page.setViewportSize({ width, height: 600 })
    await oneLine("scroll", "back")
  }
  await search(page).press("Escape")
  // After a failed paste the recovery leads, in the panel's bar too
  await page.setViewportSize({ width: 320, height: 280 })
  await emit(page, "paste-failed", { message: "Couldn't paste into that window. The prompt is on your clipboard: press Ctrl+V there to paste it yourself." })
  await setClipboard(page, Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n"))
  await search(page).press("Control+ArrowDown")
  await expect(page.getByRole("region", { name: "Clipboard" })).toBeVisible()
  await expect(hint("in the target")).toBeVisible()
  await oneLine("in the target", "back")
  for (const width of [400, 440, 500, 640]) {
    await page.setViewportSize({ width, height: 600 })
    await oneLine("in the target", "back")
  }
})

test("the clipboard panel shows controls instead of obeying them, and says what it left out of a long log", async ({ page }) => {
  await setClipboard(page, "ok\nrm -rf‮ x")
  await emit(page, "popup-shown")
  await search(page).press("Control+ArrowDown")
  const panel = page.getByRole("region", { name: "Clipboard" })
  await expect(panel).toContainText("rm -rf⟨RLO⟩ x")
  await search(page).press("Escape")
  await setClipboard(page, Array.from({ length: 450 }, (_, i) => `log ${i + 1}`).join("\n"))
  await emit(page, "popup-shown")
  await search(page).press("Control+ArrowDown")
  await expect(panel).toContainText("First 400 of 450 lines shown; all of them paste")
  await expect(panel).not.toContainText("log 401")
  // An empty clipboard has nothing to show: Ctrl+↓ opens nothing
  await search(page).press("Escape")
  await setClipboard(page, "")
  await emit(page, "popup-shown")
  await search(page).press("Control+ArrowDown")
  await expect(panel).toBeHidden()
})

test("an empty clipboard hollows a pinned {clipboard} row and the hint bar says Enter pastes without it", async ({ page }) => {
  const pinned = page.getByRole("option", { name: "Root cause first", exact: true })
  const hint = page.getByText("paste without clipboard", { exact: true })
  // Under the Pinned heading the slot says the kind, not the pin again
  await expect(pinned).toHaveAttribute("data-icon", "clipboard")
  await expect(hint).toBeHidden()
  // Empty, or whitespace alone: the pinned row shows the hole like any other
  for (const empty of ["", "  \n\t "]) {
    await setClipboard(page, empty)
    await emit(page, "popup-shown")
    await expect(pinned).toHaveAttribute("data-icon", "clipboard-empty")
    await expect(pinned).toHaveAttribute("aria-describedby", "popup-clip")
    // Once it is the selected row, the bar names what Enter is about to do
    await search(page).fill("Root cause first")
    await expect(pinned).toHaveAttribute("aria-selected", "true")
    await expect(pinned).toHaveAttribute("data-icon", "clipboard-empty")
    await expect(hint).toBeVisible()
  }
  // The action panel replaces the bar's hints, so its items carry the warning
  await page.keyboard.press("Tab")
  await expect(page.getByRole("menuitem", { name: /^Paste without clipboard/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /^Copy without clipboard/ })).toBeVisible()
  await page.keyboard.press("Escape")
  // One line at the default width: nothing in the bar wrapped under the warning
  const [hintBox, escBox] = await Promise.all([hint.boundingBox(), page.getByText("close", { exact: true }).boundingBox()])
  expect(Math.abs(hintBox!.y - escBox!.y)).toBeLessThan(2)
  // A row that pastes no clipboard has nothing to warn about
  await search(page).fill("Loose prompt")
  await expect(page.getByRole("option", { name: "Loose prompt", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(hint).toBeHidden()
  await expect(page.getByText("paste", { exact: true })).toBeVisible()
  // In results a pinned row is told apart by its pin, once there is a clipboard to paste
  await setClipboard(page, "TypeError: x is undefined")
  await emit(page, "popup-shown")
  await search(page).fill("Root cause first")
  await expect(pinned).toHaveAttribute("data-icon", "pin")
  await expect(hint).toBeHidden()
})

test("after a paste the line names the clipboard as the last pasted prompt, not as copied text", async ({ page }) => {
  await search(page).fill("Root cause first")
  await page.keyboard.press("Enter")
  const [call] = await (async () => {
    await expect.poll(() => calls(page, "paste_snippet")).toHaveLength(1)
    return calls(page, "paste_snippet")
  })()
  // Rust expands {clipboard} from the clipboard and writes the result back;
  // the mock does neither, so stage what the real one leaves there
  const sent = String((call.args as { text: string }).text)
  const clip = "TypeError: cannot read properties of undefined (reading 'id')"
  await setClipboard(page, sent.split("{clipboard}").join(clip))
  await emit(page, "popup-shown")
  await expect(clipLine(page)).toContainText("Last pasted prompt")
  // Enter on a {clipboard} row would now paste that prompt inside itself:
  // the label and the Enter hint say so in Warn, and Enter still pastes
  await search(page).fill("Root cause first")
  const wraps = page.getByText("paste, wraps last prompt", { exact: true })
  await expect(wraps).toBeVisible()
  const label = clipLine(page).getByText("Last pasted prompt")
  const ink = await page.getByText("close", { exact: true }).evaluate((e) => getComputedStyle(e).color)
  expect(await label.evaluate((e) => getComputedStyle(e).color)).not.toBe(ink)
  expect(await wraps.evaluate((e) => getComputedStyle(e).color)).toBe(await label.evaluate((e) => getComputedStyle(e).color))
  // The action panel says the same on its two picks
  await page.keyboard.press("Tab")
  await expect(page.getByRole("menuitem", { name: /^Paste, wraps last prompt/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /^Copy, wraps last prompt/ })).toBeVisible()
  await page.keyboard.press("Escape")
  // A row that does not use the clipboard is not warned about
  await search(page).fill("Loose prompt")
  await expect(wraps).toHaveCount(0)
  await expect(page.getByText("paste", { exact: true })).toBeVisible()
  expect(await label.evaluate((e) => getComputedStyle(e).color)).toBe(ink)
  // Anything else on the clipboard is just the clipboard again
  await setClipboard(page, "something new")
  await emit(page, "popup-shown")
  await expect(clipLine(page)).not.toContainText("Last pasted prompt")
  await expect(clipLine(page)).toContainText("something new")
})

test("a direction override on the clipboard is shown as ⟨RLO⟩ and reverses nothing after it", async ({ page }) => {
  await setClipboard(page, "rm -rf‮ dedicated")
  await emit(page, "popup-shown")
  await search(page).fill("Root cause first")
  await page.keyboard.press("ArrowRight")
  const card = page.getByRole("note", { name: "Preview" })
  await expect(card).toContainText("rm -rf⟨RLO⟩ dedicated")
  await expect(card.getByText("hidden text")).toBeVisible()
  // The inserted text is isolated, so the Copy button reads left to right
  await expect(card.getByRole("button", { name: "Copy" })).toBeVisible()
  const [clipBox, copyBox] = await Promise.all([card.locator("bdi").first().boundingBox(), card.getByRole("button", { name: "Copy" }).boundingBox()])
  expect(copyBox!.y).toBeGreaterThan(clipBox!.y)
  // The card carries the whole title, where the row would cut a long one
  await expect(card).toContainText("Root cause first")
})

test("the copy names the next step: the panel's digits, Ctrl+N on no match and on an empty clipboard, a config field's note", async ({ page }) => {
  // The panel hint counts its own items
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Tab")
  await expect(page.getByText("1-5", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  // No match with something on the clipboard points at Ctrl+N
  await search(page).fill("zzzz no such prompt")
  await expect(page.getByRole("listbox", { name: "Prompts" }).getByText("No matches — Ctrl+N saves the clipboard as a new prompt")).toBeVisible()
  // The listbox reads only options, so the status region says the same words
  await expect(page.locator('.sr-only[role="status"]')).toHaveText("No matches — Ctrl+N saves the clipboard as a new prompt")
  // Ctrl+N with nothing copied is one line in the strip, not a form
  await setClipboard(page, "")
  await emit(page, "popup-shown")
  await page.keyboard.press("Control+n")
  await expect(strip(page)).toHaveText("Copy something first — Ctrl+N saves the clipboard")
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveCount(0)
  // An unset {{config}} asks as a field, and says it could be set once
  await search(page).fill("Session kickoff")
  await page.keyboard.press("Enter")
  const field = page.getByRole("textbox", { name: "Standing instructions", exact: true })
  await expect(field).toBeVisible()
  await expect(field).toHaveAccessibleDescription(/set it once in the manager/)
  await expect(page.getByRole("textbox", { name: "Focus", exact: true })).not.toHaveAccessibleDescription(/set it once/)
})

test("UI scale reaches every text role: titles, chips, key caps and the hint bar grow with it", async ({ page }) => {
  // Settings' UI scale sets the root font size; a literal 13px and 11px
  // left row titles, chips and the hint bar fixed while 12px text grew
  const sizeOf = (sel: string) => page.locator(sel).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  expect(await sizeOf('[role="option"] bdi')).toBeCloseTo(13, 0)
  expect(await sizeOf('[role="option"] kbd')).toBeCloseTo(11, 0)
  await page.evaluate(() => localStorage.setItem("scale", "125"))
  await emit(page, "popup-shown")
  await expect.poll(() => sizeOf('[role="option"] bdi')).toBeCloseTo(16.25, 1)
  expect(await sizeOf('[role="option"] kbd')).toBeCloseTo(13.75, 1)
  expect(await sizeOf('[data-tag]')).toBeCloseTo(13.75, 1)
  expect(await sizeOf("#popup-search")).toBeCloseTo(16.25, 1)
  // A pack title is the body size at 600, the sidebar's, not a larger step
  // (the header is hidden from assistive tech, so it is found by its text)
  const header = page.locator("button", { hasText: "Everyday" }).first()
  expect(await header.evaluate((e) => getComputedStyle(e).fontSize)).toBe(await page.locator('[role="option"] bdi').first().evaluate((e) => getComputedStyle(e).fontSize))
  expect(await header.evaluate((e) => getComputedStyle(e).fontWeight)).toBe("600")
  await page.evaluate(() => localStorage.removeItem("scale"))
})

test("the popup paints the saved theme on first load, from the mirrored preference, before asking Rust", async ({ page }) => {
  // The manager mirrors the palette to localStorage like the mode; the popup
  // keys <html> on it in the boot script, so a summon never flashes Instrument
  await expect(page.locator("html")).toHaveAttribute("data-theme", "instrument")
  await page.addInitScript(() => localStorage.setItem("palette", "indigo"))
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "indigo")
  await expect(search(page)).toBeVisible()
  // The search box is Indigo's pill
  await expect
    .poll(() => page.getByRole("search").first().evaluate((e) => getComputedStyle(e).borderRadius))
    .toBe("999px")
})

test("groups follow the library's order, as the manager arranges them, not A–Z", async ({ page }) => {
  const groupsIn = (pack: string) =>
    page.getByRole("group", { name: pack, exact: true }).getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
  await expect.poll(() => groupsIn("Mock Groups")).toEqual(["Debugging", "Review"])
  // The manager's Move up on "Review" saves its prompt ahead of Debugging's
  await page.evaluate(() => {
    const lib = (window as unknown as { __mock: { library: { snippets: { title: string; pack: string }[] } } }).__mock.library
    const at = lib.snippets.findIndex((s) => s.title === "Review for bugs")
    const first = lib.snippets.findIndex((s) => s.pack === "Mock Groups")
    lib.snippets.splice(first, 0, ...lib.snippets.splice(at, 1))
  })
  await emit(page, "popup-shown")
  await expect.poll(() => groupsIn("Mock Groups")).toEqual(["Review", "Debugging"])
})

test("the preview card keeps Copy in view, starts at the clipboard and scrolls from the keyboard", async ({ page }) => {
  const trace = ["TypeError: x is undefined", ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (src/file.ts:${i}:1)`)].join("\n")
  await setClipboard(page, trace)
  await emit(page, "popup-shown")
  await search(page).fill("Bugs only")
  await page.keyboard.press("ArrowRight")
  const card = page.getByRole("note", { name: "Preview" })
  const copy = card.getByRole("button", { name: /^Copy/ })
  // Copy is a row of its own inside the card, carrying its key
  await expect(copy).toHaveText("CopyCtrl↵")
  await expect(copy).toBeInViewport({ ratio: 1 })
  // The clipboard's place in the prompt is on screen without scrolling
  await expect(card.getByTitle("The clipboard as it is now")).toBeInViewport()
  // More than fits: the bar offers the page keys, and they move the text,
  // not the button. The card opened at the clipboard, so up comes first.
  await expect(page.getByText("scroll", { exact: true })).toBeVisible()
  const scroller = card.locator("> div").first()
  const opened = await scroller.evaluate((el) => el.scrollTop)
  expect(opened).toBeGreaterThan(0)
  const copyY = (await copy.boundingBox())!.y
  await page.keyboard.press("PageUp")
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(opened)
  expect((await copy.boundingBox())!.y).toBe(copyY)
  await page.keyboard.press("PageDown")
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(opened)
  // The card stays clear of the hint bar
  const [cardBox, barBox] = await Promise.all([card.boundingBox(), page.getByText("back", { exact: true }).boundingBox()])
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(barBox!.y)
  // ← closes it and the bar goes back to the list's hints
  await page.keyboard.press("ArrowLeft")
  await expect(card).toBeHidden()
  await expect(page.getByText("preview", { exact: true })).toBeVisible()
})

test("typing closes the preview card: it never shows one prompt while Enter pastes another", async ({ page }) => {
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowRight")
  const card = page.getByRole("note", { name: "Preview" })
  await expect(card).toBeVisible()
  // A query moves the selection to its top result; the card goes with the
  // row it described, and the bar is the list's again
  await page.keyboard.type("bisect")
  await expect(card).toBeHidden()
  await expect(page.getByText("preview", { exact: true })).toBeVisible()
  await expect(rows(page).first()).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[aria-describedby~="popup-preview"]')).toHaveCount(0)
  // Reopened, it is the selected row's card, and Enter pastes that row
  await page.keyboard.press("ArrowRight")
  await expect(card).toContainText("Bisect a regression")
  // Clearing the query is a change of list too
  await search(page).fill("")
  await expect(card).toBeHidden()
})

test("at the 320×280 minimum the card takes the list's place, Save prompt stays in view, and a failed paste is read whole", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 280 })
  await page.keyboard.press("ArrowRight")
  const card = page.getByRole("note", { name: "Preview" })
  const list = page.getByRole("listbox", { name: "Prompts" })
  const [cardBox, listBox, barBox] = await Promise.all([card.boundingBox(), list.boundingBox(), page.getByText("back", { exact: true }).boundingBox()])
  // Too short to sit beside the row: it fills the list, and never the hint bar
  expect(Math.abs(cardBox!.y - listBox!.y)).toBeLessThan(2)
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(barBox!.y)
  await expect(card.getByRole("button", { name: /^Copy/ })).toBeInViewport({ ratio: 1 })
  // The bar's hints for the card fit on one line here too
  const [scrollBox, closeBox] = await Promise.all([page.getByText("scroll", { exact: true }).boundingBox(), page.getByText("close", { exact: true }).boundingBox()])
  expect(Math.abs(scrollBox!.y - closeBox!.y)).toBeLessThan(2)
  await page.keyboard.press("ArrowLeft")
  // The whole message, including how to recover
  await emit(page, "paste-failed", { message: "Couldn't paste into that window. The prompt is on your clipboard: press Ctrl+V there to paste it yourself." })
  const alert = strip(page)
  await expect(alert).toContainText("paste it yourself")
  expect(await alert.locator("div").first().evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  await page.keyboard.press("Escape")
  // Ctrl+N: the fields scroll, the button does not
  await page.keyboard.press("Control+n")
  await expect(page.getByRole("button", { name: "Save prompt" })).toBeInViewport({ ratio: 1 })
})

test("at 125% UI scale the hint bar drops hints instead of wrapping", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("scale", "125"))
  await emit(page, "popup-shown")
  const hint = (label: string) => page.getByText(label, { exact: true })
  // The type is a quarter wider, so the default window holds three hints, on one line
  await expect(hint("paste")).toBeVisible()
  await expect(hint("actions")).toBeHidden()
  const [a, b] = await Promise.all([hint("paste").boundingBox(), hint("close").boundingBox()])
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
  // A window widened to match shows all five again
  await page.setViewportSize({ width: 500, height: 600 })
  await expect(hint("actions")).toBeVisible()
  await expect(hint("preview")).toBeVisible()
  await page.evaluate(() => localStorage.removeItem("scale"))
})

test("at the 320 px minimum and 125% a Warn hint stands alone, on one line", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 280 })
  await page.evaluate(() => localStorage.setItem("scale", "125"))
  await setClipboard(page, "")
  await emit(page, "popup-shown")
  await search(page).fill("Root cause first")
  const warn = page.getByText("paste without clipboard", { exact: true })
  await expect(warn).toBeVisible()
  // Esc gave way: with it the bar wrapped and took a row from a window that has one
  await expect(page.getByText("close", { exact: true })).toBeHidden()
  // One line: the bar stands at its own minimum height (the foot's 2rem,
  // 40 px at 125%); a second line would push it past that
  const bar = warn.locator("xpath=../..")
  const [barBox, minH] = await Promise.all([bar.boundingBox(), bar.evaluate((e) => parseFloat(getComputedStyle(e).minHeight))])
  expect(barBox!.height).toBeCloseTo(minH, 0)
  // At 100% the same window has room for both
  await page.evaluate(() => localStorage.removeItem("scale"))
  await emit(page, "popup-shown")
  await search(page).fill("Root cause first")
  await expect(page.getByText("close", { exact: true })).toBeVisible()
})

test("← on a grouped row folds its group and stays on it; → opens it again on its first row", async ({ page }) => {
  const lib = await library(page)
  const target = lib.find((s) => !s.pinned && s.group)!
  const option = page.getByRole("option", { name: target.title, exact: true })
  // Arrow down to the row, then fold its group
  for (let i = 0; i < 40 && (await option.getAttribute("aria-selected")) !== "true"; i++) await page.keyboard.press("ArrowDown")
  await expect(option).toHaveAttribute("aria-selected", "true")
  await page.waitForTimeout(450)
  await page.keyboard.press("ArrowLeft")
  await expect(option).toHaveCount(0)
  // The keyboard is on the fold: no row is selected, the bar says how to open it,
  // and a screen reader hears the group named as folded
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveText(new RegExp(`^${target.group}, folded, `))
  await expect(search(page)).toHaveAttribute("aria-activedescendant", "header-stop")
  await expect(page.getByText("unfold", { exact: true }).last()).toBeVisible()
  // → opens it and stays on its header; → again steps onto its first row
  await page.keyboard.press("ArrowRight")
  const selected = page.locator('[role="option"][aria-selected="true"]')
  await expect(selected).toHaveText(new RegExp(`^${target.group}, open, `))
  await page.keyboard.press("ArrowRight")
  const first = page.getByRole("group", { name: target.group!, exact: true }).getByRole("option").first()
  await expect(first).toHaveAttribute("aria-selected", "true")
  // A second ← steps out: on the folded group it folds the pack, so a pack
  // whose prompts are all grouped folds from the keyboard too
  const pack = target.pack || "My prompts"
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("group", { name: pack, exact: true }).getByRole("option")).toHaveText([new RegExp(`^${pack}, folded, `)])
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("group", { name: pack, exact: true }).getByRole("option").first()).toHaveAttribute("aria-selected", "true")
})

test("↑↓ stop on an open group's header too; ← folds it there and → opens it", async ({ page }) => {
  const target = (await library(page)).find((s) => !s.pinned && s.group)!
  const selected = page.locator('[role="option"][aria-selected="true"]')
  // Down from the top until the keyboard is on the group's header, open
  const open = new RegExp(`^${target.group}, open, `)
  for (let i = 0; i < 60 && !open.test((await selected.textContent()) ?? ""); i++) await page.keyboard.press("ArrowDown")
  await expect(selected).toHaveText(open)
  await expect(page.getByText("fold", { exact: true }).last()).toBeVisible()
  const group = page.getByRole("group", { name: target.group!, exact: true })
  const before = await group.getByRole("option").count()
  await page.keyboard.press("ArrowLeft")
  await expect(selected).toHaveText(new RegExp(`^${target.group}, folded, `))
  await expect(group.getByRole("option")).toHaveCount(1)
  await page.keyboard.press("ArrowRight")
  await expect(selected).toHaveText(open)
  await expect(group.getByRole("option")).toHaveCount(before)
  expect(await calls(page, "paste_snippet")).toHaveLength(0)
})

test("with every pack folded, ↑↓ step through the folds and Enter opens one", async ({ page }) => {
  const list = page.getByRole("listbox", { name: "Prompts" })
  // The packs in the list's order, each folded by a click on its header
  const packs = await list.evaluate((el) =>
    [...el.querySelectorAll("[role=group]:not([role=group] [role=group])")]
      .filter((g) => g.querySelector("button[aria-expanded]"))
      .map((g) => g.getAttribute("aria-label")!)
  )
  expect(packs.length).toBeGreaterThan(1)
  for (const p of packs) await list.getByRole("group", { name: p, exact: true }).locator("button[aria-expanded=true]").first().click()
  const pins = (await library(page)).filter((s) => s.pinned).length
  await expect(rows(page)).toHaveCount(pins)
  const selected = page.locator('[role="option"][aria-selected="true"]')
  // Down past any pins to the first fold, then to the second
  for (let i = 0; i < pins; i++) await page.keyboard.press("ArrowDown")
  await expect(selected).toHaveText(new RegExp(`^${packs[0]}, folded, `))
  await page.keyboard.press("ArrowDown")
  await expect(selected).toHaveText(new RegExp(`^${packs[1]}, folded, `))
  await page.keyboard.press("ArrowUp")
  // Enter opens it and stays on it; nothing was pasted
  await page.keyboard.press("Enter")
  await expect(selected).toHaveText(new RegExp(`^${packs[0]}, open, `))
  await expect.poll(() => page.getByRole("group", { name: packs[0], exact: true }).getByRole("option").count()).toBeGreaterThan(1)
  expect(await calls(page, "paste_snippet")).toHaveLength(0)
})

test("a clipboard of several lines shows its first and last lines, mono, with the count between (critique 2026-10-09)", async ({ page }) => {
  // Two lines: the second is the line a flat preview never reached
  await setClipboard(page, "const user = await getUser(id)\nTypeError: x is undefined")
  await emit(page, "popup-shown")
  const strip = clipLine(page).locator("xpath=../..")
  await expect(strip).toContainText("const user = await getUser(id)")
  await expect(strip).toContainText("TypeError: x is undefined")
  // A trace: first line, the lines between, last line
  const trace = ["Traceback (most recent call last):", '  File "app.py", line 12', "    main()", "KeyError: 'id'"]
  await setClipboard(page, trace.join("\r\n") + "\r\n")
  await emit(page, "popup-shown")
  await expect(strip).toContainText(trace[0])
  await expect(strip).toContainText("⋯ 2 ⋯")
  await expect(strip).toContainText(trace[3])
  const head = clipLine(page).getByText(trace[0], { exact: true })
  expect(await head.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/Cascadia|Consolas|mono/i)
  // Two lines of 16 px with the row's 4 px above and below
  expect((await strip.boundingBox())!.height).toBeCloseTo(40, 0)
  // A screen reader hears both ends and the count, not a flattened trace
  await expect(search(page)).toHaveAccessibleDescription(/Clipboard ?, 4 lines: Traceback \(most recent call last\): ?, 2 lines more, then: KeyError: 'id'/)
  // The whole strip is the panel's handle, its last line included
  await strip.click({ position: { x: 120, y: 30 } })
  await expect(page.getByRole("region", { name: "Clipboard" })).toBeVisible()
  await search(page).press("Escape")
  // The preview card shows the same ends on lines of their own
  await search(page).fill("Root cause first")
  await search(page).press("ArrowRight")
  const card = page.getByRole("note", { name: "Preview" })
  await expect(card).toContainText(trace[0])
  await expect(card).toContainText("⋯ 2 lines ⋯")
  await expect(card).toContainText(trace[3])
  // One line keeps the one-line display
  await setClipboard(page, "npm ERR! missing script: build")
  await emit(page, "popup-shown")
  expect((await clipLine(page).locator("xpath=..").boundingBox())!.height).toBeLessThanOrEqual(20)
})

test("the clipboard panel hangs a wrapped line under its own first character", async ({ page }) => {
  await setClipboard(page, "TypeError: x\n    at " + "veryLongFunctionName.".repeat(12) + "call (a.ts:1:1)")
  await emit(page, "popup-shown")
  await search(page).press("Control+ArrowDown")
  const line = page.getByRole("region", { name: "Clipboard" }).locator("bdi").nth(1)
  const [pad, indent] = await line.evaluate((e) => [parseFloat(getComputedStyle(e).paddingLeft), parseFloat(getComputedStyle(e).textIndent)])
  expect(pad).toBeGreaterThan(0)
  expect(indent).toBeCloseTo(-pad, 1)
})

test("headers: pack 13/600 and group 13/500 as the sidebar's, title 13/500; a header hovers like a row", async ({ page }) => {
  const style = (l: ReturnType<typeof rows>) => l.evaluate((e) => ({ size: getComputedStyle(e).fontSize, weight: getComputedStyle(e).fontWeight }))
  const pack = page.locator("button", { hasText: "Everyday" }).first()
  const group = page.locator("button[aria-expanded]", { hasText: "Stuck" }).first()
  const title = rows(page).first().locator("bdi").first()
  expect(await style(pack)).toEqual({ size: "13px", weight: "600" })
  expect(await style(group)).toEqual({ size: "13px", weight: "500" })
  expect(await style(title)).toEqual({ size: "13px", weight: "500" })
  const row = rows(page).nth(3)
  await row.hover()
  await expect.poll(() => row.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)")
  const rowHover = await row.evaluate((e) => getComputedStyle(e).backgroundColor)
  await pack.hover()
  await expect.poll(() => pack.locator("xpath=..").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(rowHover)
  await page.mouse.move(1, 1)
})

test("every title sits under the chevrons, a group's rows too, as the sidebar's do", async ({ page }) => {
  // A row's title starts at the row's 8 px, where the headers' chevrons
  // do (tree.tsx): a pack's row, a group's header and a group's row all
  // start on one edge, and the headers' names stand 20 px past it. The
  // titles stood on the name column through 2026-10-10
  const left = async (l: ReturnType<typeof rows>) => (await l.boundingBox())!.x
  // Mock Groups has a row outside any group; Stuck is a group in Everyday
  const pack = page.locator("button[aria-expanded]", { hasText: "Mock Groups" }).first()
  const group = page.locator("button[aria-expanded]", { hasText: "Stuck" }).first()
  const stuck = page.getByRole("group", { name: "Stuck", exact: true })
  const packRow = page.getByRole("option", { name: "Loose prompt", exact: true }).locator("bdi").first()
  const groupRow = stuck.getByRole("option").first().locator("bdi").first()
  expect((await left(packRow)) - (await left(pack.locator("svg").first()))).toBeCloseTo(0, 0)
  expect((await left(group.locator("svg").first())) - (await left(pack.locator("svg").first()))).toBeCloseTo(0, 0)
  expect((await left(groupRow)) - (await left(packRow))).toBeCloseTo(0, 0)
  expect((await left(pack.locator("bdi"))) - (await left(packRow))).toBeCloseTo(20, 0)
})

test("counts end on the rows' right edge, and groups follow each other at the rows' 2 px", async ({ page }) => {
  const right = async (l: ReturnType<typeof rows>) => { const b = (await l.boundingBox())!; return b.x + b.width }
  const slot = rows(page).first().locator("kbd").last()
  const packCount = page.locator("button", { hasText: "Everyday" }).first().locator("span").last()
  const groupCount = page.locator("button[aria-expanded]", { hasText: "Stuck" }).first().locator("span").last()
  const edge = await right(slot)
  expect(Math.abs((await right(packCount)) - edge)).toBeLessThan(1)
  expect(Math.abs((await right(groupCount)) - edge)).toBeLessThan(1)
  // Two groups in a row: the next header says where one ends, so it
  // sits at the rows' own 2 px (the 8 px of 2026-10-09 went with the
  // one-edge layout)
  const stuck = page.getByRole("group", { name: "Stuck", exact: true })
  const starting = page.getByRole("group", { name: "Starting", exact: true })
  const [a, b] = await Promise.all([stuck.boundingBox(), starting.boundingBox()])
  expect(b!.y - (a!.y + a!.height)).toBeCloseTo(2, 0)
})
