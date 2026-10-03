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

test("a row is one pill, the slot key on the title line, and no button inside the option", async ({ page }) => {
  // The pinned rows carry Ctrl+1..5 at the title's right edge, above the row's middle
  const row = page.getByRole("option", { name: "Root cause first", exact: true })
  const key = row.locator("kbd").first()
  await expect(key).toHaveText("Ctrl")
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
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused()
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
  await expect(strip(page)).toHaveText("Copied to clipboard")
  const [call] = await calls(page, "paste_snippet")
  expect(call.args).toMatchObject({ paste: false })
  await expect.poll(() => calls(page, "hide_popup")).toHaveLength(1)
})

test("a paste the backend turned into a copy says the manager was in front", async ({ page }) => {
  await setPasteResult(page, "copied")
  await search(page).fill("Loose prompt")
  await page.keyboard.press("Enter")
  await expect(strip(page)).toHaveText("Copied to clipboard — the manager was in front")
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
  await expect(strip(page)).toContainText("undo")

  // Bare "u" undoes only while the search box is empty
  await search(page).fill("")
  await page.keyboard.press("u")
  await expect.poll(() => calls(page, "add_snippet")).toHaveLength(1)
  await expect(page.getByRole("option", { name: "Loose prompt", exact: true })).toBeVisible()
})

test("Ctrl+N drafts a prompt titled from the clipboard's first line", async ({ page }) => {
  await page.keyboard.press("Control+n")
  const title = page.getByRole("textbox", { name: "Name" })
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
  const card = page.getByRole("tooltip")
  await expect(card).toContainText("TypeError: x is undefined")
  await expect(card.getByText("hidden text")).toHaveAttribute("title", /^The clipboard holds 1 direction control and 1 invisible character:/)
  // A clean clipboard has no mark
  await setClipboard(page, "TypeError: x is undefined")
  await emit(page, "popup-shown")
  await search(page).fill("Root cause first")
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("tooltip")).toContainText("TypeError: x is undefined")
  await expect(page.getByRole("tooltip").getByText("hidden text")).toHaveCount(0)
})

test("the line under the search says what the clipboard holds, and that it is empty", async ({ page }) => {
  // The mock clipboard starts as a TypeError message, shown on the builtin's tint
  await expect(clipLine(page)).toContainText("Clipboard")
  await expect(clipLine(page)).toContainText("TypeError: cannot read properties of undefined")
  await expect(search(page)).toHaveAttribute("aria-describedby", "popup-clip")
  // A ten-line trace is one line here, and says so
  await setClipboard(page, Array.from({ length: 10 }, (_, i) => `  at frame${i} (file.ts:${i}:1)`).join("\n"))
  await emit(page, "popup-shown")
  await expect(clipLine(page)).toContainText("10 lines")
  // Empty: said in words, and every {clipboard} row is described by the line
  await setClipboard(page, "")
  await emit(page, "popup-shown")
  await expect(clipLine(page)).toHaveText(/Clipboard is empty — \{clipboard\} rows paste nothing/)
  const clipRow = page.getByRole("option", { name: "Root cause first", exact: true })
  await expect(clipRow).toHaveAttribute("aria-describedby", "popup-clip")
  await expect(page.getByRole("option", { name: "Loose prompt", exact: true })).not.toHaveAttribute("aria-describedby", /popup-clip/)
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
  const card = page.getByRole("tooltip")
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
  await expect(page.getByText("No matches — Ctrl+N saves the clipboard as a new prompt")).toBeVisible()
  // Ctrl+N with nothing copied is one line in the strip, not a form
  await setClipboard(page, "")
  await emit(page, "popup-shown")
  await page.keyboard.press("Control+n")
  await expect(strip(page)).toHaveText("Copy something first — Ctrl+N saves the clipboard")
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0)
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
  // A pack title is the body size at 600, not a larger step (the header is
  // hidden from assistive tech, so it is found by its text)
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
