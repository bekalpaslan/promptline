// The test driver's side of `window.__mock` (src/lib/dev-mock.ts): open a
// window against the fake backend, read the invokes it made, set the
// clipboard and fire backend events. Everything here goes through
// page.evaluate, so a spec never reaches into React.
import type { Page } from "@playwright/test"

export interface Call {
  cmd: string
  args: Record<string, unknown> | undefined
}

export interface MockSnippet {
  id: string
  title: string
  text: string
  tags: string[]
  pack: string
  group: string
  uses: number
  pinned: boolean
}

type Surface = "popup" | "manager"

// `mode` is the `?mock=` value: "" for the seeded library, "empty" for a first run
export async function open(page: Page, surface: Surface, mode = "") {
  const path = surface === "popup" ? "/popup.html" : "/"
  // The real windows: the popup opens at 400×600, the manager at 1000×800
  await page.setViewportSize(surface === "popup" ? { width: 400, height: 600 } : { width: 1000, height: 800 })
  await page.goto(`${path}?mock${mode ? `=${mode}` : ""}`)
  // The mock is installed before React renders, and `get_snippets` is the
  // first thing either window asks for; the first paint follows it
  await page.waitForFunction(() => (window as unknown as { __mock?: { calls: Call[] } }).__mock?.calls.some((c) => c.cmd === "get_snippets"))
}

export function calls(page: Page, cmd?: string): Promise<Call[]> {
  return page.evaluate((cmd) => {
    const all = (window as unknown as { __mock: { calls: Call[] } }).__mock.calls
    return cmd ? all.filter((c) => c.cmd === cmd) : all
  }, cmd)
}

export function library(page: Page): Promise<MockSnippet[]> {
  return page.evaluate(() => (window as unknown as { __mock: { library: { snippets: MockSnippet[] } } }).__mock.library.snippets)
}

export function setClipboard(page: Page, text: string) {
  return page.evaluate((text) => void ((window as unknown as { __mock: { clipboard: string } }).__mock.clipboard = text), text)
}

export function setPasteResult(page: Page, result: "pasted" | "copied") {
  return page.evaluate((result) => void ((window as unknown as { __mock: { pasteResult: string } }).__mock.pasteResult = result), result)
}

export function emit(page: Page, event: string, payload?: unknown) {
  return page.evaluate(
    ([event, payload]) => (window as unknown as { __mock: { emit(e: string, p?: unknown): void } }).__mock.emit(event as string, payload),
    [event, payload]
  )
}
