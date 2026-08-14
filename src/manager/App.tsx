import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { RiCloseLine } from "@remixicon/react"
import { Toaster } from "@/components/ui/sonner"
import { C, type PackMeta, type Snippet } from "@/lib/core"
import { applyPrefs } from "@/lib/prefs"
import { DEFAULT_PACK, ManagerCtx, type ManagerApi, type Prefs } from "./state"
import { say, sayErr } from "./status"
import { Sidebar } from "./Sidebar"
import { Editor } from "./Editor"
import { Settings } from "./Settings"
import { GenerateDialog } from "./GenerateDialog"

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

  // Latest snippets for callbacks that outlive a render (event listeners)
  const snippetsRef = useRef(snippets)
  snippetsRef.current = snippets

  const persist = useCallback(async (next: Snippet[]) => {
    setSnippets(next)
    snippetsRef.current = next
    await invoke("save_snippets", { snippets: next })
  }, [])

  const persistPacks = useCallback(async (next: PackMeta[]) => {
    setPackMeta(next)
    await invoke("save_packs", { packs: next })
  }, [])

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

  const newPrompt = useCallback(async () => {
    setSettingsOpen(false)
    // Default to the pack the user last saved a prompt into, not a fixed pack
    const last = localStorage.getItem("lastPack")
    const pack =
      last && packNames().includes(last) && !isLocked(last)
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
      uses: 0,
      pinned: false,
      fieldValues: {},
      configValues: {},
    }
    await persist([...snippetsRef.current, s])
    setSelectionState(new Set([s.id]))
    setSelectionAnchor(s.id)
    setActiveId(s.id)
  }, [isLocked, packNames, persist])

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
      try {
        path = await invoke<string>("create_pack_file", { name })
      } catch (e) {
        sayErr(String(e))
      }
      await persistPacks([...packMeta, { name, locked: false, path }])
      say(`Pack "${name}" created`)
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
        sayErr(String(e))
      }
    },
    [prefs]
  )

  // ---- Init ----
  useEffect(() => {
    void (async () => {
      let snips = await invoke<Snippet[]>("get_snippets")
      // GC abandoned "+ New" drafts (default title, no text, never used)
      const before = snips.length
      snips = snips.filter((s) => !(s.title === "New prompt" && !s.text.trim() && !s.uses))
      if (snips.length !== before) await invoke("save_snippets", { snippets: snips })
      setSnippets(snips)
      snippetsRef.current = snips

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
    })()
  }, [])

  // ---- Events from the Rust side ----
  useEffect(() => {
    const unEdit = listen<string>("edit-prompt", ({ payload }) => {
      setSettingsOpen(false)
      setSelectionState(new Set([payload]))
      setSelectionAnchor(payload)
      setActiveId(payload)
    })
    const unFirst = listen("first-popup", () => {
      setFirstRun((state) => {
        if (state !== "show") return state
        setTimeout(() => setFirstRun("hidden"), 6000)
        return "done"
      })
    })
    // The popup writes too (create-from-clipboard, pins, use counts) — refresh
    const unChanged = listen("snippets-changed", () => {
      void invoke<Snippet[]>("get_snippets").then((snips) => {
        snippetsRef.current = snips
        setSnippets(snips)
      })
    })
    return () => {
      void unEdit.then((f) => f())
      void unFirst.then((f) => f())
      void unChanged.then((f) => f())
    }
  }, [])

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
      persistPacks,
      select,
      setSelection,
      newPrompt,
      addPack,
      savePrefs,
      setHotkey: setHotkeyState,
      openGenerate: () => setGenOpen(true),
      settingsOpen,
      showSettings: setSettingsOpen,
    }),
    [snippets, packMeta, activeId, selection, selectionAnchor, hotkey, prefs, isLocked, packNames, allTags, persist, persistPacks, select, setSelection, newPrompt, addPack, savePrefs, settingsOpen]
  )

  const fmtHotkey = C.fmtHotkey(hotkey)

  return (
    <ManagerCtx.Provider value={api}>
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
