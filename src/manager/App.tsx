import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { SizeDebug } from "@/lib/SizeDebug"
import { RiCloseLine } from "@remixicon/react"
import { Toaster } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"
import { Keys } from "@/components/prompt-bits"
import { C, isStoreError, type Library, type OrderBy, type PackMeta, type Snippet, type SnippetEdit } from "@/lib/core"
import { applyPrefs } from "@/lib/prefs"
import { ManagerCtx, groupKey, type DeleteOpts, type LibraryFocus, type ManagerApi, type Prefs, type Renaming, type View } from "./state"
import { type Config, DEFAULT_PACK, defaultPackFor, isLockedIn, packNames as packNamesOf } from "@/lib/library"
import { useFolds } from "./folds"
import { say, sayErr, sayPersistent, sayUndo, undoLast } from "./status"
import { Sidebar } from "./Sidebar"
import { Editor } from "./Editor"
import { Overview } from "./Overview"
import { Settings } from "./Settings"
import { GenerateDialog } from "./GenerateDialog"

/** Something Rust needs the user to see; see `notify` in lib.rs */
interface Notice {
  kind: string
  message: string
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
  const [prefs, setPrefs] = useState<Prefs>({ theme: "dark", density: "comfortable", scale: "100", font: "system" })
  const [firstRun, setFirstRun] = useState<"hidden" | "show" | "done">("hidden")
  const [view, setView] = useState<View>({ kind: "prompt" })
  // One list order for the sidebar and the overview, so a drag that switches
  // to "custom" in one is what the other draws too
  const [orderBy, setOrderByState] = useState<OrderBy>(() => {
    const saved = localStorage.getItem("orderBy")
    return saved === "title" || saved === "custom" ? saved : "uses"
  })
  const setOrderBy = useCallback((order: OrderBy) => {
    setOrderByState(order)
    localStorage.setItem("orderBy", order)
  }, [])
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

  // Rust reconciles pack metadata on every save (`ensure_packs_backed` gives
  // any pack a prompt names an entry and a file), so after any write the
  // manager re-reads it rather than trusting its own copy
  const refreshPacks = useCallback(async () => {
    try {
      const config = await invoke<Config>("get_config")
      setPackMeta(Array.isArray(config.packs) ? config.packs : [])
    } catch {
      // the next write will try again
    }
  }, [])

  // An updater is applied to the *latest* library, not the render that
  // built the closure: menu actions and Undo callbacks outlive their render,
  // and an array captured then would carry the edits made since back to disk
  // (the revision check can't catch it — the manager's own reloads keep the
  // revision current while the closure's array goes stale)
  const persist = useCallback(async (nextOrUpdate: Snippet[] | ((current: Snippet[]) => Snippet[])) => {
    const next = typeof nextOrUpdate === "function" ? nextOrUpdate(snippetsRef.current) : nextOrUpdate
    setSnippets(next)
    snippetsRef.current = next
    try {
      revisionRef.current = await invoke<number>("save_snippets", {
        snippets: next,
        baseRevision: revisionRef.current,
      })
      await refreshPacks()
    } catch (e) {
      // Whatever happened, the UI must show what is on disk, not the
      // change that didn't land
      await reloadLibrary()
      if (isStoreError(e) && e.kind === "stale") {
        // Whoever wrote (the popup, a second window, a migration) is not
        // known here: a refusal means the change event has not landed yet
        sayErr("The library changed meanwhile — reloaded it; please redo that change")
      } else {
        sayErr(`Couldn't save: ${isStoreError(e) && e.kind === "failed" ? e.message : e}`)
      }
      throw e
    }
  }, [reloadLibrary, refreshPacks])

  const updateSnippet = useCallback(async (id: string, edit: SnippetEdit) => {
    try {
      applyLibrary(await invoke<Library>("update_snippet", { id, edit }))
      await refreshPacks()
    } catch (e) {
      await reloadLibrary()
      sayErr(`Couldn't save: ${e}`)
      throw e
    }
  }, [applyLibrary, reloadLibrary, refreshPacks])

  const persistPacks = useCallback(async (next: PackMeta[]) => {
    setPackMeta(next)
    try {
      await invoke("save_packs", { packs: next })
    } finally {
      await refreshPacks()
    }
  }, [refreshPacks])

  // The sidebar's folds and the inline-rename state live here, not in the
  // sidebar: a rename or a New from the overview has to reach them too
  const { folds, togglePackFold, toggleGroupFold, setAll: setAllFolds, unfold, carryPackFolds, carryGroupFold } = useFolds()
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [renamingGroup, setRenamingGroup] = useState<Renaming | null>(null)

  const renamePack = useCallback(async (from: string, to: string) => {
    try {
      applyLibrary(await invoke<Library>("rename_pack", { from, to }))
      // An overview on the renamed pack follows it, and so do its folds
      setView((v) => (v.kind === "overview" && v.focus.pack === from ? { ...v, focus: { ...v.focus, pack: to } } : v))
      carryPackFolds(from, to)
    } catch (e) {
      sayErr(`Couldn't rename the pack: ${e}`)
      throw e
    } finally {
      await refreshPacks()
    }
  }, [applyLibrary, refreshPacks, carryPackFolds])

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
        // Restoring prompts makes Rust conjure the pack again (with a fresh
        // file, the old one being in packs/deleted/) but without its lock;
        // put the saved metadata back on whichever entry exists now
        if (opts?.pack) {
          const pack = opts.pack
          const cur = packMetaRef.current
          await persistPacks(
            cur.some((p) => p.name === pack.name)
              ? cur.map((p) => (p.name === pack.name ? { ...p, locked: pack.locked } : p))
              : [...cur, { ...pack, path: "" }]
          )
        }
        say("Restored")
      })()
    })
    return removed.length
  }, [persist, persistPacks])

  const isLocked = useCallback((name: string) => isLockedIn(packMeta, name), [packMeta])

  const packNames = useCallback(
    (extra?: string) => packNamesOf(packMeta, snippets, { extra }),
    [packMeta, snippets]
  )

  const allTags = useCallback(() => {
    const counts = new Map<string, number>()
    for (const s of snippets)
      for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
  }, [snippets])

  // Opening a prompt is what brings the editor back from an overview
  const select = useCallback((id: string | null) => {
    setActiveId(id)
    if (id !== null) setView({ kind: "prompt" })
  }, [])

  // A pack or group is selected the way a prompt is: the pane shows it and
  // no prompt stays highlighted beside it
  const openOverview = useCallback((focus: LibraryFocus) => {
    setSettingsOpen(false)
    setActiveId(null)
    setSelectionState(new Set())
    setView({ kind: "overview", focus })
  }, [])
  const showSettings = useCallback((open: boolean) => {
    setSettingsOpen(open)
    if (open) setView({ kind: "prompt" })
  }, [])

  const setSelection = useCallback((sel: Set<string>, anchor?: string | null) => {
    setSelectionState(sel)
    if (anchor !== undefined) setSelectionAnchor(anchor)
  }, [])

  const newPrompt = useCallback(async (into?: { pack: string; group?: string }) => {
    setSettingsOpen(false)
    // Default to the pack the user last saved a prompt into, not a fixed pack
    // (one rule with the popup: library.ts)
    const pack = into?.pack && !isLocked(into.pack) ? into.pack : defaultPackFor(packMeta, snippets)
    const group = (into?.pack && !isLocked(into.pack) && into.group) || ""
    // The draft lands inside: open the pack, and the group, so it is in view
    unfold(pack, group || undefined)
    const s: Snippet = {
      id: crypto.randomUUID(),
      title: "New prompt",
      text: "",
      tags: [],
      pack,
      group,
      uses: 0,
      pinned: false,
      pinnedAt: 0,
      fieldValues: {},
      configValues: {},
    }
    try {
      applyLibrary(await invoke<Library>("add_snippet", { snippet: s }))
      await refreshPacks()
    } catch (e) {
      sayErr(`Couldn't create the prompt: ${e}`)
      return
    }
    setSelectionState(new Set([s.id]))
    setSelectionAnchor(s.id)
    setActiveId(s.id)
    setView({ kind: "prompt" })
  }, [isLocked, packMeta, snippets, applyLibrary, refreshPacks, unfold])

  const foldAll = useCallback(
    (fold: boolean) => {
      if (!fold) return setAllFolds(new Set(), new Set())
      setAllFolds(
        new Set(packNames()),
        new Set(snippets.filter((s) => s.group).map((s) => groupKey(s.pack || DEFAULT_PACK, s.group)))
      )
    },
    [setAllFolds, packNames, snippets]
  )

  const addPack = useCallback(
    async (name: string) => {
      if (!name) return
      // Case variants would read as one pack (and share a file name on
      // Windows), so they count as the same pack
      const taken = packNames().find((p) => p.toLowerCase() === name.toLowerCase())
      if (taken) {
        sayErr(`Pack "${taken}" already exists`)
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
    // StrictMode runs this twice in development; a run whose effect was
    // cleaned up applies nothing, or the second draft sweep would be refused
    // as stale by the first one's save and toast "Couldn't load"
    let cancelled = false
    void (async () => {
      try {
        const lib = await invoke<Library>("get_snippets")
        if (cancelled) return
        // GC abandoned "+ New" drafts (default title, no text, never used)
        const snips = lib.snippets.filter((s) => !C.isEmptyDraft(s))
        if (snips.length !== lib.snippets.length) {
          lib.revision = await invoke<number>("save_snippets", { snippets: snips, baseRevision: lib.revision })
          lib.snippets = snips
        }
        applyLibrary(lib)

        const config = await invoke<Config>("get_config")
        if (cancelled) return
        setHotkeyState(config.hotkey)
        setPackMeta(Array.isArray(config.packs) ? config.packs : [])
        const theme = config.theme === "light" ? "light" : "dark"
        const loaded: Prefs = {
          theme,
          density: config.density || "comfortable",
          scale: config.scale || "100",
          font: config.font || "system",
        }
        setPrefs(loaded)
        localStorage.setItem("theme", loaded.theme)
        localStorage.setItem("density", loaded.density)
        localStorage.setItem("scale", loaded.scale)
        localStorage.setItem("font", loaded.font)
        applyPrefs()
        if (!config.popupSeen) setFirstRun("show")
      } catch (e) {
        if (cancelled) return
        sayPersistent(`Couldn't load the library: ${e}`)
      }
      // Anything Rust hit before this window was listening (a quarantined
      // file, a refused hotkey) is shown now and stays until dismissed
      const notices = await invoke<Notice[]>("take_notices").catch(() => [] as Notice[])
      if (cancelled) return
      for (const n of notices) sayPersistent(n.message)
    })()
    return () => {
      cancelled = true
    }
  }, [applyLibrary])

  // The first-run banner's "done" state fades on its own; the timer lives
  // here rather than inside a state updater, which must stay pure
  useEffect(() => {
    if (firstRun !== "done") return
    const t = setTimeout(() => setFirstRun("hidden"), 6000)
    return () => clearTimeout(t)
  }, [firstRun])

  // ---- Events from the Rust side ----
  useEffect(() => {
    const unEdit = listen<string>("edit-prompt", ({ payload }) => {
      setSettingsOpen(false)
      setSelectionState(new Set([payload]))
      setSelectionAnchor(payload)
      setActiveId(payload)
      setView({ kind: "prompt" })
    })
    const unNotice = listen<Notice>("notice", ({ payload }) => sayPersistent(payload.message))
    const unFirst = listen("first-popup", () => setFirstRun((state) => (state === "show" ? "done" : state)))
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

  // Ctrl+Z outside a text field takes the Undo on offer. Escape leaves
  // Settings; otherwise it goes up a level: from the editor to the
  // overview of the prompt's group (or pack), from a group to its pack.
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
    const onKey = (e: KeyboardEvent) => {
      // Autofill can send a keydown with no key, and a keydown during IME
      // composition carries a key that is not a command: nothing to act on
      if (!e.key || e.isComposing) return
      if (e.key.toLowerCase() === "z" && e.ctrlKey && !e.shiftKey && !e.altKey && !typing(e.target)) {
        if (undoLast()) e.preventDefault()
      } else if (e.key === "Escape" && !typing(e.target) && !e.defaultPrevented) {
        // An armed delete takes the Escape first (capture-phase listeners);
        // a dialog or a context menu closing on it must not also switch the
        // mode behind it (the menu's own listener registers later, so it
        // runs after this one and its preventDefault comes too late)
        if (settingsOpen) setSettingsOpen(false)
        else if (document.querySelector('[role="dialog"], [role="menu"]')) return
        else if (view.kind === "overview") {
          if (view.focus.group) openOverview({ pack: view.focus.pack })
        } else {
          const s = activeId ? snippetsRef.current.find((x) => x.id === activeId) : undefined
          if (s) openOverview({ pack: s.pack || DEFAULT_PACK, group: s.group || undefined })
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [settingsOpen, view, activeId, openOverview])

  const api = useMemo<ManagerApi>(
    () => ({
      snippets,
      packMeta,
      activeId,
      selection,
      selectionAnchor,
      hotkey,
      prefs,
      view,
      openOverview,
      orderBy,
      setOrderBy,
      isLocked,
      packNames,
      allTags,
      persist,
      updateSnippet,
      persistPacks,
      renamePack,
      deleteWithUndo,
      select,
      setSelection,
      newPrompt,
      folds,
      togglePackFold,
      toggleGroupFold,
      foldAll,
      carryGroupFold,
      renaming,
      setRenaming,
      renamingGroup,
      setRenamingGroup,
      addPack,
      savePrefs,
      setHotkey: setHotkeyState,
      openGenerate: () => setGenOpen(true),
      settingsOpen,
      showSettings,
      pendingFlush,
    }),
    [snippets, packMeta, activeId, selection, selectionAnchor, hotkey, prefs, view, openOverview, showSettings, orderBy, setOrderBy, isLocked, packNames, allTags, persist, updateSnippet, persistPacks, renamePack, deleteWithUndo, select, setSelection, newPrompt, folds, togglePackFold, toggleGroupFold, foldAll, carryGroupFold, renaming, renamingGroup, addPack, savePrefs, settingsOpen]
  )

  const fmtHotkey = C.fmtHotkey(hotkey)

  return (
    <ManagerCtx.Provider value={api}>
      {import.meta.env.DEV && <SizeDebug />}
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {firstRun !== "hidden" && (
          <div className="flex items-center gap-2 border-b border-border bg-primary/8 px-4 py-2 text-ui text-primary">
            {firstRun === "done" ? (
              <span className="text-(--success)">✓ That's it — pick a prompt and it pastes right where you were.</span>
            ) : (
              <span>
                Press <Keys combo={fmtHotkey} />{" "}
                in any app to open your prompts — try it now
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-muted-foreground"
              title="Dismiss"
              aria-label="Dismiss"
              onClick={() => setFirstRun("hidden")}
            >
              <RiCloseLine className="size-4" />
            </Button>
          </div>
        )}

        <main className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          {settingsOpen ? (
            <Settings />
          ) : view.kind === "overview" ? (
            <Overview focus={view.focus} />
          ) : (
            <Editor key={activeId ?? "none"} />
          )}
        </main>

        <GenerateDialog open={genOpen} onOpenChange={setGenOpen} />
        {/* Bottom-right: top-right sat over the editor's title row */}
        <Toaster position="bottom-right" />
      </div>
    </ManagerCtx.Provider>
  )
}
