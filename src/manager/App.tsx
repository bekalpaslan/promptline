import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { SizeDebug } from "@/lib/SizeDebug"
import { RiCloseLine } from "@remixicon/react"
import { Toaster } from "@/components/ui/sonner"
import { C, isStoreError, type Library, type PackMeta, type Snippet, type SnippetEdit } from "@/lib/core"
import { applyPrefs } from "@/lib/prefs"
import { DEFAULT_PACK, ManagerCtx, type DeleteOpts, type ManagerApi, type Prefs } from "./state"
import { say, sayErr, sayPersistent, sayUndo } from "./status"
import { Sidebar } from "./Sidebar"
import { Editor } from "./Editor"
import { Settings } from "./Settings"
import { GenerateDialog } from "./GenerateDialog"

/** Something Rust needs the user to see; see `notify` in lib.rs */
interface Notice {
  kind: string
  message: string
}

interface Config {
  hotkey: string
  packs?: PackMeta[]
  theme?: string
  density?: string
  scale?: string
  font?: string
  popupSeen?: boolean
}

export function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [packMeta, setPackMeta] = useState<PackMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selection, setSelectionState] = useState<Set<string>>(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [hotkey, setHotkeyState] = useState("ctrl+shift+v")
  const [prefs, setPrefs] = useState<Prefs>({ theme: "dark", density: "comfortable", scale: "100", font: "outfit" })
  const [firstRun, setFirstRun] = useState<"hidden" | "show" | "done">("hidden")
  // The editor's debounced autosave, if one is pending (see quit-requested)
  const pendingFlush = useRef<(() => Promise<void>) | null>(null)

  // Latest snippets for callbacks that outlive a render (event listeners)
  const snippetsRef = useRef(snippets)
  snippetsRef.current = snippets
  // Revision of the library as last read; every full-array save is pinned
  // to it so a stale copy can never overwrite what the popup wrote
  const revisionRef = useRef(0)

  const applyLibrary = useCallback((lib: Library) => {
    snippetsRef.current = lib.snippets
    revisionRef.current = lib.revision
    setSnippets(lib.snippets)
  }, [])

  const reloadLibrary = useCallback(async () => {
    try {
      applyLibrary(await invoke<Library>("get_snippets"))
    } catch (e) {
      sayErr(`Couldn't reload the library: ${e}`)
    }
  }, [applyLibrary])

  const persist = useCallback(async (next: Snippet[]) => {
    setSnippets(next)
    snippetsRef.current = next
    try {
      revisionRef.current = await invoke<number>("save_snippets", {
        snippets: next,
        baseRevision: revisionRef.current,
      })
    } catch (e) {
      // Whatever happened, the UI must show what is on disk, not the
      // change that didn't land
      await reloadLibrary()
      if (isStoreError(e) && e.kind === "stale") {
        sayErr("The library changed in the popup meanwhile — reloaded it; please redo that change")
      } else {
        sayErr(`Couldn't save: ${isStoreError(e) && e.kind === "failed" ? e.message : e}`)
      }
      throw e
    }
  }, [reloadLibrary])

  const updateSnippet = useCallback(async (id: string, edit: SnippetEdit) => {
    try {
      applyLibrary(await invoke<Library>("update_snippet", { id, edit }))
    } catch (e) {
      await reloadLibrary()
      sayErr(`Couldn't save: ${e}`)
      throw e
    }
  }, [applyLibrary, reloadLibrary])

  const persistPacks = useCallback(async (next: PackMeta[]) => {
    setPackMeta(next)
    await invoke("save_packs", { packs: next })
  }, [])

  // Latest pack metadata for the same reason
  const packMetaRef = useRef(packMeta)
  packMetaRef.current = packMeta

  const deleteWithUndo = useCallback(async (ids: Iterable<string>, label: string, opts?: DeleteOpts) => {
    const { kept, removed } = C.removeByIds(snippetsRef.current, ids)
    if (!removed.length && !opts?.pack) return 0
    if (removed.length) await persist(kept)
    const gone = new Set(removed.map((r) => r.item.id))
    setActiveId((id) => (id && gone.has(id) ? null : id))
    setSelectionState((sel) => ([...sel].some((id) => gone.has(id)) ? new Set() : sel))
    setSelectionAnchor((a) => (a && gone.has(a) ? null : a))
    sayUndo(label, () => {
      void (async () => {
        if (removed.length) await persist(C.restoreRemoved(snippetsRef.current, removed))
        // The pack's file was retired to packs/deleted/; an empty path makes
        // ensure_packs_backed give it a fresh one
        if (opts?.pack && !packMetaRef.current.some((p) => p.name === opts.pack!.name))
          await persistPacks([...packMetaRef.current, { ...opts.pack, path: "" }])
        say("Restored")
      })()
    })
    return removed.length
  }, [persist, persistPacks])

  const isLocked = useCallback(
    (name: string) => !!packMeta.find((p) => p.name === name)?.locked,
    [packMeta]
  )

  const packNames = useCallback(
    (extra?: string) => {
      const names = new Set([
        ...packMeta.map((p) => p.name),
        ...snippets.map((s) => s.pack || DEFAULT_PACK),
      ])
      if (extra) names.add(extra)
      return [...names].sort((a, b) => a.localeCompare(b))
    },
    [packMeta, snippets]
  )

  const allTags = useCallback(() => {
    const counts = new Map<string, number>()
    for (const s of snippets)
      for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
  }, [snippets])

  const select = useCallback((id: string | null) => {
    setActiveId(id)
  }, [])

  const setSelection = useCallback((sel: Set<string>, anchor?: string | null) => {
    setSelectionState(sel)
    if (anchor !== undefined) setSelectionAnchor(anchor)
  }, [])

  const newPrompt = useCallback(async (into?: { pack: string; group?: string }) => {
    setSettingsOpen(false)
    // Default to the pack the user last saved a prompt into, not a fixed pack
    const last = localStorage.getItem("lastPack")
    const pack =
      into?.pack && !isLocked(into.pack)
        ? into.pack
        : last && packNames().includes(last) && !isLocked(last)
          ? last
          : isLocked(DEFAULT_PACK)
            ? "Unsorted"
            : DEFAULT_PACK
    const s: Snippet = {
      id: crypto.randomUUID(),
      title: "New prompt",
      text: "",
      tags: [],
      pack,
      group: (into?.pack && !isLocked(into.pack) && into.group) || "",
      uses: 0,
      pinned: false,
      fieldValues: {},
      configValues: {},
    }
    try {
      applyLibrary(await invoke<Library>("add_snippet", { snippet: s }))
    } catch (e) {
      sayErr(`Couldn't create the prompt: ${e}`)
      return
    }
    setSelectionState(new Set([s.id]))
    setSelectionAnchor(s.id)
    setActiveId(s.id)
  }, [isLocked, packNames, applyLibrary])

  const addPack = useCallback(
    async (name: string) => {
      if (!name) return
      if (packNames().includes(name)) {
        sayErr(`Pack "${name}" already exists`)
        return
      }
      // New packs are file-backed: they own a .json under the profile that the
      // app keeps current — grab the file to back up or share the pack.
      let path = ""
      let fileError: string | null = null
      try {
        path = await invoke<string>("create_pack_file", { name })
      } catch (e) {
        fileError = String(e)
      }
      // A pack is just a name, so it exists either way; but say one thing,
      // not a failure and a success at once
      await persistPacks([...packMeta, { name, locked: false, path }])
      if (fileError)
        sayErr(`Pack "${name}" created, but its file couldn't be written (${fileError}) — use "Give this pack a file…" to retry`)
      else say(`Pack "${name}" created`)
    },
    [packMeta, packNames, persistPacks]
  )

  const savePrefs = useCallback(
    async (next: Partial<Prefs>) => {
      const merged = { ...prefs, ...next }
      setPrefs(merged)
      localStorage.setItem("theme", merged.theme)
      localStorage.setItem("density", merged.density)
      localStorage.setItem("scale", merged.scale)
      localStorage.setItem("font", merged.font)
      applyPrefs()
      try {
        await invoke("save_prefs", {
          theme: merged.theme,
          density: merged.density,
          scale: merged.scale,
          font: merged.font,
        })
      } catch (e) {
        sayErr(`Couldn't save the preferences: ${e}`)
      }
    },
    [prefs]
  )

  // ---- Init ----
  useEffect(() => {
    void (async () => {
      try {
        const lib = await invoke<Library>("get_snippets")
        // GC abandoned "+ New" drafts (default title, no text, never used)
        const snips = lib.snippets.filter((s) => !(s.title === "New prompt" && !s.text.trim() && !s.uses))
        if (snips.length !== lib.snippets.length) {
          lib.revision = await invoke<number>("save_snippets", { snippets: snips, baseRevision: lib.revision })
          lib.snippets = snips
        }
        applyLibrary(lib)

        const config = await invoke<Config>("get_config")
        setHotkeyState(config.hotkey)
        setPackMeta(Array.isArray(config.packs) ? config.packs : [])
        const theme = config.theme === "light" ? "light" : "dark"
        const loaded: Prefs = {
          theme,
          density: config.density || "comfortable",
          scale: config.scale || "100",
          font: config.font || "outfit",
        }
        setPrefs(loaded)
        localStorage.setItem("theme", loaded.theme)
        localStorage.setItem("density", loaded.density)
        localStorage.setItem("scale", loaded.scale)
        localStorage.setItem("font", loaded.font)
        applyPrefs()
        if (!config.popupSeen) setFirstRun("show")
      } catch (e) {
        sayPersistent(`Couldn't load the library: ${e}`)
      }
      // Anything Rust hit before this window was listening (a quarantined
      // file, a refused hotkey) is shown now and stays until dismissed
      for (const n of await invoke<Notice[]>("take_notices").catch(() => [] as Notice[])) sayPersistent(n.message)
    })()
  }, [applyLibrary])

  // ---- Events from the Rust side ----
  useEffect(() => {
    const unEdit = listen<string>("edit-prompt", ({ payload }) => {
      setSettingsOpen(false)
      setSelectionState(new Set([payload]))
      setSelectionAnchor(payload)
      setActiveId(payload)
    })
    const unNotice = listen<Notice>("notice", ({ payload }) => sayPersistent(payload.message))
    const unFirst = listen("first-popup", () => {
      setFirstRun((state) => {
        if (state !== "show") return state
        setTimeout(() => setFirstRun("hidden"), 6000)
        return "done"
      })
    })
    // The popup writes too (create-from-clipboard, pins, use counts) — refresh
    const unChanged = listen<number>("snippets-changed", () => void reloadLibrary())
    // Tray Quit asks first so a pending autosave reaches disk; Rust exits on
    // its own after a grace period if this never answers
    const unQuit = listen("quit-requested", () => {
      void (async () => {
        try {
          await pendingFlush.current?.()
        } finally {
          await invoke("quit_now")
        }
      })()
    })
    return () => {
      void unEdit.then((f) => f())
      void unNotice.then((f) => f())
      void unFirst.then((f) => f())
      void unChanged.then((f) => f())
      void unQuit.then((f) => f())
    }
  }, [reloadLibrary])

  const api = useMemo<ManagerApi>(
    () => ({
      snippets,
      packMeta,
      activeId,
      selection,
      selectionAnchor,
      hotkey,
      prefs,
      isLocked,
      packNames,
      allTags,
      persist,
      updateSnippet,
      persistPacks,
      deleteWithUndo,
      select,
      setSelection,
      newPrompt,
      addPack,
      savePrefs,
      setHotkey: setHotkeyState,
      openGenerate: () => setGenOpen(true),
      settingsOpen,
      showSettings: setSettingsOpen,
      pendingFlush,
    }),
    [snippets, packMeta, activeId, selection, selectionAnchor, hotkey, prefs, isLocked, packNames, allTags, persist, updateSnippet, persistPacks, deleteWithUndo, select, setSelection, newPrompt, addPack, savePrefs, settingsOpen]
  )

  const fmtHotkey = C.fmtHotkey(hotkey)

  return (
    <ManagerCtx.Provider value={api}>
      {import.meta.env.DEV && <SizeDebug />}
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {firstRun !== "hidden" && (
          <div className="flex items-center gap-2 border-b border-border bg-primary/8 px-4 py-2 text-xs text-primary">
            {firstRun === "done" ? (
              <span className="text-green-500">✓ That's it — pick a prompt and it pastes right where you were.</span>
            ) : (
              <span>
                Press <kbd className="rounded-sm bg-secondary px-1.5 py-0.5 font-semibold text-foreground">{fmtHotkey}</kbd>{" "}
                in any app to open your prompts — try it now
              </span>
            )}
            <button
              className="ml-auto cursor-pointer text-muted-foreground hover:text-foreground"
              title="Dismiss"
              onClick={() => setFirstRun("hidden")}
            >
              <RiCloseLine className="size-4" />
            </button>
          </div>
        )}

        <main className="flex min-h-0 flex-1">
          <Sidebar />
          {settingsOpen ? <Settings /> : <Editor key={activeId ?? "none"} />}
        </main>

        <GenerateDialog open={genOpen} onOpenChange={setGenOpen} />
        <Toaster position="top-right" />
      </div>
    </ManagerCtx.Provider>
  )
}
