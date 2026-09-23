// The popup against the fake backend: search, pick, the fill-in form and
// the feedback strip. BEHAVIOR.md "The paste pipeline" is the spec; what
// Rust does with the pick (`paste_snippet` gets `{clipboard}` unexpanded)
// is out of reach here and covered by the Rust tests.
import { expect, test } from "@playwright/test"
import { calls, emit, library, open, setPasteResult } from "./mock"

const search = (page: Parameters<typeof open>[0]) => page.getByRole("combobox", { name: "Search prompts" })
const rows = (page: Parameters<typeof open>[0]) => page.getByRole("option")
// The feedback strip is hidden while empty (`empty:hidden`), so it is
// found by its markup, not its role, and "nothing shown" is toBeHidden
const strip = (page: Parameters<typeof open>[0]) => page.locator('[role="status"][aria-live="polite"]:not(.sr-only)')

test.beforeEach(async ({ page }) => {
  await open(page, "popup")
})

test("lists the seeded library with the search box focused", async ({ page }) => {
  const snippets = await library(page)
  await expect(rows(page)).toHaveCount(snippets.length)
  await expect(search(page)).toBeFocused()
})

test("a slot key sits on the row's second line, level with the tags", async ({ page }) => {
  // The pinned rows carry Ctrl+1..5; their tags and the key cap share the
  // preview line, so their bottoms agree (it used to float between the lines)
  const row = page.getByRole("option", { name: "Root cause first", exact: true })
  const tag = row.getByRole("button", { name: /#debug/ }).first()
  const key = row.locator("kbd").first()
  await expect(key).toHaveText("Ctrl")
  const [tagBox, keyBox, rowBox] = await Promise.all([tag.boundingBox(), key.boundingBox(), row.boundingBox()])
  const bottom = (b: { y: number; height: number }) => b.y + b.height
  expect(Math.abs(bottom(keyBox!) - bottom(tagBox!))).toBeLessThanOrEqual(1)
  // And below the row's middle, not on it
  expect(keyBox!.y).toBeGreaterThan(rowBox!.y + rowBox!.height / 2 - 2)
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
  const good = page.getByRole("textbox", { name: "good" })
  const bad = page.getByRole("textbox", { name: "bad" })
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
  await emit(page, "paste-failed", { message: "Couldn't paste into that window — the prompt is on your clipboard" })
  await expect(strip(page)).toHaveText("Couldn't paste into that window — the prompt is on your clipboard — Esc to dismiss")
  // The first Escape only clears the error
  await page.keyboard.press("Escape")
  await expect(strip(page)).toBeHidden()
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
