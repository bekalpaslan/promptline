// A fake Tauri backend for looking at the UI in a plain browser: `npx vite`
// then open `/?mock` (manager) or `/popup.html?mock` (popup). Nothing here
// ships: main.tsx calls it only under `import.meta.env.DEV`, so a build
// drops it. See CLAUDE.md ("Verifying UI changes") for when this is enough
// and when to drive the real app instead.
//
// The library is seeded from packs/*.json plus a small grouped pack (the
// shipped packs have no groups), held in memory per page: the manager and
// the popup are separate pages and don't see each other's writes, and a
// reload starts over. `?mock=empty` starts with no prompts (first run).
//
// `window.__mock` is the handle for a test driver:
//   calls              every invoke as { cmd, args }, oldest first
//   clipboard          what get_clipboard_text answers; set it to change it
//   emit(event, data)  fire a backend event ("edit-prompt", "popup-shown",
//                      "paste-failed" with { message }, …)
//   library            the current { snippets, revision }
//   pasteResult        what paste_snippet answers: "pasted" (default) or
//                      "copied" (the manager was in front, copy-only)
// Commands it doesn't know resolve to null and are logged to the console,
// so a new command shows up there instead of failing silently.

import type { Library, PackMeta, Snippet } from "@/lib/core"
import { C } from "@/lib/core"

interface Call {
  cmd: string
  args: Record<string, unknown> | undefined
}

// Exercises what the shipped packs don't: groups, a {clipboard} and a
// {field} in one pack, a pin
const GROUPED_PACK = {
  name: "Mock Groups",
  prompts: [
    { title: "Explain this error", group: "Debugging", tags: ["debug"], text: "Explain this error:\n\n{clipboard}" },
    { title: "Bisect a regression", group: "Debugging", tags: ["debug"], text: "Help me bisect: it broke between {good} and {bad}." },
    { title: "Review for bugs", group: "Review", tags: ["review"], text: "Review this diff for bugs only:\n\n{clipboard}" },
    { title: "Loose prompt", tags: [], text: "A prompt in no group." },
  ],
}

// What a pack file "on disk" holds when the UI reads one: one prompt that is
// new and one that duplicates a seeded prompt, so import curation has both
// rows to show
const MOCK_FILE_PACK = (path: string) => ({
  name: "From file",
  prompts: [
    { title: `Read from ${path.split(/[\\/]/).pop()}`, tags: ["file"], text: "A prompt that only the file had.\n\n{clipboard}" },
    { title: "Explain this error", tags: ["debug"], text: "Explain this error:\n\n{clipboard}" },
  ],
})

function seed(empty: boolean): Snippet[] {
  if (empty) return []
  const files = import.meta.glob<string>("/packs/*.json", { query: "?raw", import: "default", eager: true })
  const packs = [...Object.values(files).flatMap((raw) => C.parsePacks(raw)), GROUPED_PACK]
  let n = 0
  return packs.flatMap((p) =>
    p.prompts.map((q, i) => ({
      id: `mock-${n++}`,
      title: q.title,
      text: q.text,
      tags: q.tags ?? [],
      pack: p.name,
      group: q.group ?? "",
      uses: Math.max(0, 8 - i),
      pinned: i === 0,
      pinnedAt: i === 0 ? 1 : 0,
      fieldValues: {},
      configValues: {},
    }))
  )
}

export function installMock(mode: string | null) {
  const lib: Library = { snippets: seed(mode === "empty"), revision: 1 }
  let packs: PackMeta[] = []
  const config = { hotkey: "Ctrl+Alt+Space", theme: "dark", density: "comfortable", scale: "100", font: "system" }
  const calls: Call[] = []
  const callbacks = new Map<number, (data: unknown) => void>()
  const listeners = new Map<string, number[]>()
  let nextId = 1

  const snapshot = (): Library => ({ snippets: lib.snippets.map((s) => ({ ...s })), revision: lib.revision })
  const write = (next: Snippet[]) => {
    lib.snippets = next
    lib.revision++
  }
  const byId = (id: unknown) => {
    const s = lib.snippets.find((x) => x.id === id)
    if (!s) throw `No prompt with id ${String(id)}`
    return s
  }

  const mock = {
    calls,
    clipboard: "TypeError: cannot read properties of undefined (reading 'id')",
    library: lib,
    pasteResult: "pasted" as "pasted" | "copied",
    emit(event: string, payload?: unknown) {
      for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload })
    },
  }

  const commands: Record<string, (a: Record<string, unknown>) => unknown> = {
    get_snippets: () => snapshot(),
    get_config: () => ({ ...config, packs, popupSeen: true }),
    take_notices: () => [],
    get_clipboard_text: () => mock.clipboard,
    set_clipboard_text: (a) => void (mock.clipboard = String(a.text)),
    get_autostart: () => false,
    add_snippet: (a) => {
      const s = a.snippet as Snippet
      write([...lib.snippets.filter((x) => x.id !== s.id), s])
      return snapshot()
    },
    update_snippet: (a) => {
      Object.assign(byId(a.id), a.edit)
      write(lib.snippets)
      return snapshot()
    },
    patch_snippet: (a) => {
      const s = byId(a.id)
      const p = a.patch as { pinned?: boolean; fieldValues?: Record<string, string> }
      if (p.pinned !== undefined) Object.assign(s, { pinned: p.pinned, pinnedAt: p.pinned ? Date.now() : 0 })
      if (p.fieldValues) s.fieldValues = p.fieldValues
      write(lib.snippets)
      return snapshot()
    },
    delete_snippet: (a) => {
      write(lib.snippets.filter((x) => x.id !== a.id))
      return snapshot()
    },
    // The revision check is the real one's: a stale base is refused
    save_snippets: (a) => {
      if (a.baseRevision != null && a.baseRevision !== lib.revision) throw { kind: "stale", revision: lib.revision }
      write(a.snippets as Snippet[])
      return lib.revision
    },
    // Pack metadata by intent, each answering with the registry (paths
    // resolved) the way Rust does; a pack that is only a name on prompts
    // gets metadata when locked or given a file
    set_pack_locked: (a) => {
      const name = String(a.name)
      const locked = a.locked === true
      packs = packs.some((p) => p.name === name)
        ? packs.map((p) => (p.name === name ? { ...p, locked } : p))
        : [...packs, { name, locked, path: "" }]
      return packs
    },
    delete_pack: (a) => (packs = packs.filter((p) => p.name !== a.name)),
    add_pack: (a) => {
      const name = String(a.name)
      const taken = [...packs.map((p) => p.name), ...lib.snippets.map((s) => s.pack)].find(
        (n) => n.toLowerCase() === name.toLowerCase()
      )
      if (taken) throw `Pack "${taken}" already exists`
      packs = [...packs, { name, locked: false, path: `C:\\mock\\packs\\${name}.json` }]
      return packs
    },
    add_pack_file: (a) => {
      const name = String(a.name)
      const path = `C:\\mock\\packs\\${name}.json`
      packs = packs.some((p) => p.name === name)
        ? packs.map((p) => (p.name === name ? { ...p, path: p.path || path } : p))
        : [...packs, { name, locked: false, path }]
      return packs
    },
    rename_pack: (a) => {
      packs = packs.map((p) => (p.name === a.from ? { ...p, name: String(a.to) } : p))
      write(lib.snippets.map((s) => (s.pack === a.from ? { ...s, pack: String(a.to) } : s)))
      return snapshot()
    },
    save_prefs: (a) => void Object.assign(config, a),
    set_hotkey: (a) => void (config.hotkey = String(a.hotkey)),
    create_pack_file: (a) => `C:\\mock\\packs\\${String(a.name)}.json`,
    create_generated_file: () => `C:\\mock\\packs\\generated\\mock.json`,
    // File readers answer with a small pack, so the import paths can be
    // walked: Settings' "import from this pack's file" and the generate
    // dialog's agent step both go through `read_pack_file`
    read_pack_file: (a) => JSON.stringify(MOCK_FILE_PACK(String(a.path)), null, 2),
    import_pack_file: () => JSON.stringify(MOCK_FILE_PACK("picked.json"), null, 2),
    // Window and shell commands: nothing to do in a browser, but they must
    // not read as unhandled (an unhandled `hide_popup` would be a real bug)
    edit_in_manager: () => null,
    hide_popup: () => null,
    quit_now: () => null,
    open_url: () => null,
    show_in_folder: () => null,
    set_autostart: () => null,
    // The paste itself can't happen here; `calls` shows what would be pasted.
    // The real one bumps `uses`, and the manager relies on the change event.
    // It answers "pasted", or "copied" when Rust fell back to copy-only
    // because the manager was the foreground window (`pasteResult` sets it)
    paste_snippet: (a) => {
      const s = lib.snippets.find((x) => x.id === a.id)
      if (s) {
        s.uses = (s.uses || 0) + 1
        write(lib.snippets)
      }
      return a.paste ? mock.pasteResult : "copied"
    },
    // @tauri-apps/api/event: listen / unlisten
    "plugin:event|listen": (a) => {
      const ids = listeners.get(String(a.event)) ?? []
      listeners.set(String(a.event), [...ids, a.handler as number])
      return a.handler
    },
    "plugin:event|unlisten": () => null,
  }

  Object.assign(window, {
    __mock: mock,
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "mock" }, currentWebview: { label: "mock" } },
      transformCallback(cb: (data: unknown) => void) {
        const id = nextId++
        callbacks.set(id, cb)
        return id
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      convertFileSrc: (path: string) => path,
      async invoke(cmd: string, args?: Record<string, unknown>) {
        calls.push({ cmd, args })
        const run = commands[cmd]
        if (!run) {
          console.info(`[mock] unhandled command ${cmd}`, args)
          return null
        }
        return run(args ?? {})
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener(event: string, id: number) {
        listeners.set(event, (listeners.get(event) ?? []).filter((x) => x !== id))
      },
    },
  })
  console.info(`[mock] fake Tauri backend: ${lib.snippets.length} prompts`)
}
