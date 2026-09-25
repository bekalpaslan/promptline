// Exports, from the pack menu and Settings: a pack, or the library as an
// array of packs, in the JSON Import reads (C.packToJson), to the clipboard
// or to a file the user picks (`export_pack_file`, whose Save dialog is
// Rust's; the webview never names a path).
import { invoke } from "@tauri-apps/api/core"
import { C, type Snippet } from "@/lib/core"
import { DEFAULT_PACK } from "./state"
import { say, sayErr } from "./status"

export const packJson = (snippets: Snippet[], name: string) =>
  C.packToJson(name, snippets.filter((s) => (s.pack || DEFAULT_PACK) === name))

/** Every pack that holds a prompt, in the order given */
export const libraryJson = (snippets: Snippet[], names: string[]) =>
  names.map((n) => packJson(snippets, n)).filter((p) => p.prompts.length)

/** The toast's subject for a library export: "3 packs (40 prompts)" */
export const librarySummary = (packs: ReturnType<typeof libraryJson>) =>
  `${C.plural(packs.length, "pack")} (${C.plural(
    packs.reduce((n, p) => n + p.prompts.length, 0),
    "prompt"
  )})`

const text = (data: unknown) => JSON.stringify(data, null, 2)

export function exportToClipboard(data: unknown, what: string) {
  return invoke("set_clipboard_text", { text: text(data) }).then(
    () => say(`${what} copied to clipboard`),
    (e) => sayErr(`Couldn't copy: ${e}`)
  )
}

/** `name` only suggests the file name; a cancelled dialog says nothing */
export function exportToFile(data: unknown, name: string, what: string) {
  return invoke<string | null>("export_pack_file", { name, text: text(data) }).then(
    (path) => {
      if (path) say(`${what} saved to ${path}`)
    },
    (e) => sayErr(`Couldn't save the file: ${e}`)
  )
}
